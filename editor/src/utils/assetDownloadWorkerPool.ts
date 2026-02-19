import type { AssetBlobDownloader, AssetBlobPayload } from '@schema/assetCache'
import { AssetDownloadWorkerUnavailableError } from '@schema/assetCache'

export type AssetDownloadWorkerFactory = () => Worker | null

type AssetDownloadWorkerProgressMessage = {
  type: 'progress'
  requestId: number
  value: number
}

type AssetDownloadWorkerResultMessage = {
  type: 'result'
  requestId: number
  url: string
  mimeType: string | null
  filename: string | null
  buffer: ArrayBuffer
}

type AssetDownloadWorkerErrorMessage = {
  type: 'error'
  requestId: number
  message: string
}

type AssetDownloadWorkerReadyMessage = {
  type: 'ready'
}

type AssetDownloadWorkerPongMessage = {
  type: 'pong'
}

type AssetDownloadWorkerOutgoingMessage =
  | AssetDownloadWorkerProgressMessage
  | AssetDownloadWorkerResultMessage
  | AssetDownloadWorkerErrorMessage
  | AssetDownloadWorkerReadyMessage
  | AssetDownloadWorkerPongMessage

type AssetDownloadWorkerDownloadRequest = {
  type: 'download'
  requestId: number
  urlCandidates: string[]
}

type AssetDownloadWorkerAbortRequest = {
  type: 'abort'
  requestId: number
}

type AssetDownloadWorkerPingRequest = {
  type: 'ping'
}

type AssetDownloadWorkerIncomingMessage =
  | AssetDownloadWorkerDownloadRequest
  | AssetDownloadWorkerAbortRequest
  | AssetDownloadWorkerPingRequest

const DEFAULT_POOL_SIZE = 2

function normalizePoolSize(): number {
  const hc = (globalThis as unknown as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency
  const suggested = typeof hc === 'number' && isFinite(hc) ? Math.max(1, Math.min(4, Math.floor(hc - 1))) : DEFAULT_POOL_SIZE
  return Math.max(1, suggested)
}

type QueuedTask = {
  requestId: number
  urlCandidates: string[]
  controller: AbortController
  onProgress: (value: number) => void
  resolve: (value: AssetBlobPayload) => void
  reject: (error: unknown) => void
  abortListener?: () => void
  assignedSlot?: WorkerSlot
  settled?: boolean
}

class AssetDownloadWorkerPool {
  private readonly poolSize: number
  private readonly workers: WorkerSlot[] = []
  private readonly queue: QueuedTask[] = []
  private nextRequestId = 1
  private disposed = false
  private factorySnapshot: AssetDownloadWorkerFactory

  constructor(factorySnapshot: AssetDownloadWorkerFactory, poolSize: number) {
    this.factorySnapshot = factorySnapshot
    this.poolSize = Math.max(1, poolSize)
  }

  dispose(): void {
    this.disposed = true
    while (this.queue.length) {
      const task = this.queue.shift()!
      task.reject(new AssetDownloadWorkerUnavailableError('资源下载 Worker 不可用'))
    }
    for (const slot of this.workers) {
      slot.dispose()
    }
    this.workers.length = 0
  }

  private ensureWorkers(): void {
    if (this.disposed) {
      return
    }
    if (typeof Worker === 'undefined') {
      throw new AssetDownloadWorkerUnavailableError('当前环境不支持 Worker')
    }

    // Drop dead workers so we can recreate them.
    for (let index = this.workers.length - 1; index >= 0; index -= 1) {
      if (!this.workers[index]!.isAlive()) {
        this.workers[index]!.dispose()
        this.workers.splice(index, 1)
      }
    }

    while (this.workers.length < this.poolSize) {
      const worker = this.factorySnapshot()
      if (!worker) {
        throw new AssetDownloadWorkerUnavailableError('资源下载 Worker 创建失败')
      }
      const slot = new WorkerSlot(worker)
      this.workers.push(slot)
    }
  }

  submit(urlCandidates: string[], controller: AbortController, onProgress: (value: number) => void): Promise<AssetBlobPayload> {
    if (this.disposed) {
      return Promise.reject(new AssetDownloadWorkerUnavailableError('资源下载 Worker 不可用'))
    }
    this.ensureWorkers()

    if (controller.signal.aborted) {
      return Promise.reject(createAbortError())
    }

    const requestId = this.nextRequestId++
    return new Promise<AssetBlobPayload>((resolve: (value: AssetBlobPayload) => void, reject: (reason?: unknown) => void) => {
      const task: QueuedTask = {
        requestId,
        urlCandidates,
        controller,
        onProgress,
        resolve,
        reject,
      }

      const abortListener = () => {
        if (task.settled) {
          return
        }
        task.settled = true
        this.removeQueuedTask(task)
        task.assignedSlot?.abort(requestId)
        reject(createAbortError())
      }

      task.abortListener = abortListener
      controller.signal.addEventListener('abort', abortListener)

      this.queue.push(task)
      this.pump()
    })
  }

  private removeQueuedTask(task: QueuedTask): void {
    const index = this.queue.indexOf(task)
    if (index >= 0) {
      this.queue.splice(index, 1)
    }
  }

  private pump(): void {
    if (this.disposed) {
      return
    }
    for (const slot of this.workers) {
      if (slot.isBusy()) {
        continue
      }
      const task = this.queue.shift()
      if (!task) {
        break
      }
      if (task.controller.signal.aborted) {
        task.settled = true
        task.controller.signal.removeEventListener('abort', task.abortListener!)
        task.reject(createAbortError())
        continue
      }
      task.assignedSlot = slot
      slot
        .run(task)
        .then(task.resolve)
        .catch(task.reject)
        .then(() => {
          task.settled = true
          task.controller.signal.removeEventListener('abort', task.abortListener!)
          this.pump()
        })
    }
  }
}

class WorkerSlot {
  private readonly worker: Worker
  private busy = false
  private activeRequestId: number | null = null
  private activeResolve: ((value: AssetBlobPayload) => void) | null = null
  private activeReject: ((error: unknown) => void) | null = null
  private activeOnProgress: ((value: number) => void) | null = null
  private activeTimeoutHandle: number | null = null
  private readonly slotId: number
  private alive = true
  private handshakeOk = false
  private handshakeWaiters: Array<() => void> = []

  private static nextSlotId = 1

  private debugEnabled(): boolean {
    return (globalThis as unknown as { __HARMONY_ASSET_DOWNLOAD_DEBUG__?: boolean }).__HARMONY_ASSET_DOWNLOAD_DEBUG__ === true
  }

  private debugLog(message: string, extra?: unknown): void {
    if (!this.debugEnabled()) {
      return
    }
    if (extra !== undefined) {
      // eslint-disable-next-line no-console
      console.debug(`[asset-download][slot:${this.slotId}] ${message}`, extra)
      return
    }
    // eslint-disable-next-line no-console
    console.debug(`[asset-download][slot:${this.slotId}] ${message}`)
  }

  constructor(worker: Worker) {
    this.worker = worker
    this.slotId = WorkerSlot.nextSlotId++

    this.worker.addEventListener('error', (event) => {
      this.debugLog('worker error event', event)
      this.alive = false
      if (this.activeRequestId !== null) {
        this.finishError(new AssetDownloadWorkerUnavailableError('资源下载 Worker 脚本加载失败'))
      }
    })

    this.worker.addEventListener('messageerror', (event) => {
      this.debugLog('worker messageerror event', event)
      this.alive = false
      if (this.activeRequestId !== null) {
        this.finishError(new AssetDownloadWorkerUnavailableError('资源下载 Worker 消息解析失败'))
      }
    })

    this.worker.addEventListener('message', (event: MessageEvent<AssetDownloadWorkerOutgoingMessage>) => {
      const message = event.data
      if (!message || typeof message !== 'object') {
        return
      }

      if (message.type === 'ready' || message.type === 'pong') {
        this.handshakeOk = true
        const waiters = this.handshakeWaiters
        this.handshakeWaiters = []
        for (const wake of waiters) {
          try {
            wake()
          } catch {
            /* noop */
          }
        }
        this.debugLog(`handshake: ${message.type}`)
        return
      }

      if (this.activeRequestId === null || message.requestId !== this.activeRequestId) {
        return
      }

      this.debugLog('received message', message)

      if (message.type === 'progress') {
        const value = typeof message.value === 'number' && isFinite(message.value) ? message.value : 0
        const normalized = Math.max(0, Math.min(99, Math.round(value)))
        this.activeOnProgress?.(normalized)
        return
      }

      if (message.type === 'result') {
        const buffer = message.buffer
        const blob = new Blob([buffer], { type: message.mimeType ?? 'application/octet-stream' })
        this.activeOnProgress?.(100)
        this.finishSuccess({
          blob,
          mimeType: message.mimeType,
          filename: message.filename,
          url: message.url,
        })
        return
      }

      if (message.type === 'error') {
        const err = message.message === 'Aborted' ? createAbortError() : new Error(message.message)
        this.finishError(err)
      }
    })
  }

  isBusy(): boolean {
    return this.busy
  }

  isAlive(): boolean {
    return this.alive
  }

  private async ensureHandshake(timeoutMs: number): Promise<void> {
    if (!this.alive) {
      throw new AssetDownloadWorkerUnavailableError('资源下载 Worker 不可用')
    }
    if (this.handshakeOk) {
      return
    }

    try {
      this.worker.postMessage({ type: 'ping' } satisfies AssetDownloadWorkerIncomingMessage)
    } catch {
      this.alive = false
      throw new AssetDownloadWorkerUnavailableError('资源下载 Worker 创建失败')
    }

    await new Promise<void>((resolve: () => void, reject: (reason?: unknown) => void) => {
      const timer = setTimeout(() => {
        const idx = this.handshakeWaiters.indexOf(resolve)
        if (idx >= 0) {
          this.handshakeWaiters.splice(idx, 1)
        }
        reject(new AssetDownloadWorkerUnavailableError('资源下载 Worker 无响应（可能脚本加载失败）'))
      }, timeoutMs) as unknown as number

      const wake = () => {
        clearTimeout(timer)
        resolve()
      }

      this.handshakeWaiters.push(wake)
    })
  }

  run(task: QueuedTask): Promise<AssetBlobPayload> {
    this.busy = true
    this.activeRequestId = task.requestId

    return new Promise<AssetBlobPayload>((resolve: (value: AssetBlobPayload) => void, reject: (reason?: unknown) => void) => {
      this.activeResolve = resolve
      this.activeReject = reject
      this.activeOnProgress = task.onProgress

      this.ensureHandshake(1500)
        .then(() => {
          if (this.activeRequestId !== task.requestId) {
            return
          }

          const timeoutMs = 1200_000
          this.activeTimeoutHandle = setTimeout(() => {
            if (this.activeRequestId === task.requestId) {
              this.debugLog(`watchdog timeout after ${timeoutMs}ms`)
              this.finishError(new Error('资源下载超时（Worker 无响应）'))
            }
          }, timeoutMs) as unknown as number

          const message: AssetDownloadWorkerDownloadRequest = {
            type: 'download',
            requestId: task.requestId,
            urlCandidates: task.urlCandidates,
          }

          try {
            this.debugLog('postMessage download', message)
            this.worker.postMessage(message satisfies AssetDownloadWorkerIncomingMessage)
          } catch (error) {
            this.finishError(error instanceof Error ? error : new Error(String(error)))
          }
        })
        .catch((error) => {
          this.alive = false
          try {
            this.worker.terminate()
          } catch {
            /* noop */
          }
          this.finishError(error)
        })
    })
  }

  abort(requestId: number): void {
    try {
      this.debugLog('postMessage abort', { requestId })
      this.worker.postMessage({ type: 'abort', requestId } satisfies AssetDownloadWorkerIncomingMessage)
    } catch {
      /* noop */
    }
  }

  dispose(): void {
    try {
      this.alive = false
      this.worker.terminate()
    } catch {
      /* noop */
    }
  }

  private finishSuccess(payload: AssetBlobPayload): void {
    const resolve = this.activeResolve
    this.resetActive()
    resolve?.(payload)
  }

  private finishError(error: unknown): void {
    const reject = this.activeReject
    this.resetActive()
    reject?.(error)
  }

  private resetActive(): void {
    if (this.activeTimeoutHandle !== null) {
      clearTimeout(this.activeTimeoutHandle)
      this.activeTimeoutHandle = null
    }
    this.busy = false
    this.activeRequestId = null
    this.activeResolve = null
    this.activeReject = null
    this.activeOnProgress = null
  }
}

export function createWorkerAssetBlobDownloader(
  factory: AssetDownloadWorkerFactory,
  options: {
    poolSize?: number
  } = {},
): AssetBlobDownloader {
  if (typeof factory !== 'function') {
    throw new AssetDownloadWorkerUnavailableError('资源下载 Worker 未配置')
  }

  let pool: AssetDownloadWorkerPool | null = null

  const poolSize = typeof options.poolSize === 'number' && isFinite(options.poolSize) ? Math.max(1, options.poolSize) : normalizePoolSize()

  return async (urlCandidates: string[], controller: AbortController, onProgress: (value: number) => void) => {
    if (!pool) {
      pool = new AssetDownloadWorkerPool(factory, poolSize)
    }
    return await pool.submit(urlCandidates, controller, onProgress)
  }
}

function createAbortError(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('Aborted', 'AbortError')
  }
  const error = new Error('Aborted')
  ;(error as { name?: string }).name = 'AbortError'
  return error
}
