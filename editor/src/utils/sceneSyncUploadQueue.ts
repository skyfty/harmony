import { buildServerApiUrl } from '@/api/serverApiConfig'
import { prepareScenePackageSourceZipFiles } from '@/utils/scenePackageSource'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import { decode, encode } from '@msgpack/msgpack'

const USER_SCENE_API_PREFIX = '/api/user-scenes'
const DEFAULT_DEBOUNCE_MS = 3000

type SceneSyncWorkerUploadRequest = {
  type: 'upload'
  requestId: number
  bundleUrl: string
  authorization: string
  filename: string
  files: Record<string, Uint8Array>
}

type SceneSyncWorkerResultMessage = {
  type: 'result'
  requestId: number
  bundleEtag: string | null
}

type SceneSyncWorkerErrorMessage = {
  type: 'error'
  requestId: number
  message: string
}

type SceneSyncWorkerReadyMessage = {
  type: 'ready'
}

type SceneSyncWorkerPongMessage = {
  type: 'pong'
}

type SceneSyncWorkerMessage =
  | SceneSyncWorkerResultMessage
  | SceneSyncWorkerErrorMessage
  | SceneSyncWorkerReadyMessage
  | SceneSyncWorkerPongMessage

export type SceneSyncUploadSuccess = {
  document: StoredSceneDocument
  bundleEtag: string | null
}

type QueuedSceneSync = {
  document: StoredSceneDocument
  authorization: string
  onSynced?: (result: SceneSyncUploadSuccess) => void | Promise<void>
  onFailed?: (document: StoredSceneDocument, error: unknown) => void
}

type SceneSyncWorkerRuntime = {
  worker: Worker
  nextRequestId: number
  pending: Map<number, {
    resolve: (message: SceneSyncWorkerResultMessage) => void
    reject: (error: Error) => void
  }>
}

function cloneForQueue<T>(value: T): T {
  return decode(encode(value)) as T
}

function normalizeBundleFilename(value: string): string {
  const normalized = value.trim().length ? value.trim() : 'scene'
  const cleaned = normalized
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return `${cleaned.length ? cleaned : 'scene'}.zip`
}

function createSceneSyncWorkerRuntime(): SceneSyncWorkerRuntime {
  if (typeof Worker === 'undefined') {
    throw new Error('当前环境不支持场景同步 Worker')
  }
  const worker = new Worker(new URL('@/workers/sceneSyncUpload.worker.ts', import.meta.url), {
    type: 'module',
  })
  const runtime: SceneSyncWorkerRuntime = {
    worker,
    nextRequestId: 1,
    pending: new Map(),
  }
  worker.onmessage = (event: MessageEvent<SceneSyncWorkerMessage>) => {
    const message = event.data
    if (!message || typeof message !== 'object' || !('type' in message)) {
      return
    }
    if (message.type !== 'result' && message.type !== 'error') {
      return
    }
    const callback = runtime.pending.get(message.requestId)
    if (!callback) {
      return
    }
    runtime.pending.delete(message.requestId)
    if (message.type === 'error') {
      callback.reject(new Error(message.message || '场景同步 Worker 上传失败'))
      return
    }
    callback.resolve(message)
  }
  worker.onerror = (event) => {
    const error = new Error(`场景同步 Worker 失败: ${event.message || 'unknown error'}`)
    const callbacks = Array.from(runtime.pending.values())
    runtime.pending.clear()
    for (const callback of callbacks) {
      callback.reject(error)
    }
    worker.terminate()
  }
  return runtime
}

function requestSceneSyncWorker(
  runtime: SceneSyncWorkerRuntime,
  message: Omit<SceneSyncWorkerUploadRequest, 'requestId'>,
): Promise<SceneSyncWorkerResultMessage> {
  const requestId = runtime.nextRequestId
  runtime.nextRequestId += 1
  return new Promise((resolve, reject) => {
    runtime.pending.set(requestId, { resolve, reject })
    runtime.worker.postMessage({
      ...message,
      requestId,
    } satisfies SceneSyncWorkerUploadRequest)
  })
}

class SceneSyncUploadQueue {
  private readonly pendingBySceneId = new Map<string, QueuedSceneSync>()
  private timer: ReturnType<typeof window.setTimeout> | null = null
  private active = false
  private runtime: SceneSyncWorkerRuntime | null = null

  enqueue(task: QueuedSceneSync): void {
    const sceneId = task.document.id
    if (this.pendingBySceneId.has(sceneId)) {
      this.pendingBySceneId.delete(sceneId)
    }
    this.pendingBySceneId.set(sceneId, {
      ...task,
      document: cloneForQueue(task.document),
    })
    this.schedule(DEFAULT_DEBOUNCE_MS)
  }

  private schedule(delayMs: number): void {
    if (this.timer) {
      window.clearTimeout(this.timer)
    }
    this.timer = window.setTimeout(() => {
      this.timer = null
      void this.pump()
    }, delayMs)
  }

  private async pump(): Promise<void> {
    if (this.active) {
      return
    }
    const next = this.pendingBySceneId.entries().next()
    if (next.done) {
      return
    }

    const [sceneId, task] = next.value
    this.pendingBySceneId.delete(sceneId)
    this.active = true

    try {
      const files = await prepareScenePackageSourceZipFiles({
        project: {
          id: task.document.projectId,
          name: task.document.projectId,
          defaultSceneId: task.document.id,
          lastEditedSceneId: task.document.id,
          sceneOrder: [task.document.id],
        },
        scenes: [{ id: task.document.id, document: cloneForQueue(task.document) }],
      })

      const runtime = this.ensureRuntime()
      const response = await requestSceneSyncWorker(runtime, {
        type: 'upload',
        bundleUrl: buildServerApiUrl(`${USER_SCENE_API_PREFIX}/${encodeURIComponent(task.document.id)}/bundle`),
        authorization: task.authorization,
        filename: normalizeBundleFilename(task.document.name || task.document.id),
        files,
      })
      await task.onSynced?.({ document: task.document, bundleEtag: response.bundleEtag })
    } catch (error) {
      this.disposeRuntime()
      task.onFailed?.(task.document, error)
    } finally {
      this.active = false
      if (this.pendingBySceneId.size > 0) {
        void this.pump()
      }
    }
  }

  private ensureRuntime(): SceneSyncWorkerRuntime {
    if (!this.runtime) {
      this.runtime = createSceneSyncWorkerRuntime()
    }
    return this.runtime
  }

  private disposeRuntime(): void {
    if (!this.runtime) {
      return
    }
    const callbacks = Array.from(this.runtime.pending.values())
    this.runtime.pending.clear()
    this.runtime.worker.terminate()
    for (const callback of callbacks) {
      callback.reject(new Error('场景同步 Worker 已关闭'))
    }
    this.runtime = null
  }
}

const queue = new SceneSyncUploadQueue()

export function enqueueSceneSyncUpload(task: QueuedSceneSync): void {
  queue.enqueue(task)
}
