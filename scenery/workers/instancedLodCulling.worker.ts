/// <reference lib="webworker" />

import {
	computeInstancedLodCullingResult,
	type InstancedLodCullingSyncRequest,
	type InstancedLodCullingRequest,
	type InstancedLodCullingResponse,
	type InstancedLodStaticCandidateSnapshot,
} from '@harmony/schema/core'

const instancedLodStaticCandidateCache: InstancedLodStaticCandidateSnapshot[] = []
let instancedLodSyncedRevision = -1

type WorkerScopeLike = {
  onmessage: ((event: MessageEvent<InstancedLodCullingRequest | InstancedLodCullingSyncRequest>) => void) | null
  postMessage: (message: InstancedLodCullingResponse, transferables?: Transferable[]) => void
}

type WechatWorkerLike = {
  onMessage: (callback: (event: { data: InstancedLodCullingRequest | InstancedLodCullingSyncRequest }) => void) => void
  postMessage: (message: InstancedLodCullingResponse) => void
}

function syncInstancedLodCandidates(message: InstancedLodCullingSyncRequest): void {
  if (message.revision < instancedLodSyncedRevision) {
    return
  }
  instancedLodStaticCandidateCache.length = 0
  for (let i = 0; i < message.candidates.length; i += 1) {
    const candidate = message.candidates[i]
    if (!candidate) {
      continue
    }
    instancedLodStaticCandidateCache.push(candidate)
  }
  instancedLodSyncedRevision = message.revision
}

function createErrorResponse(message: InstancedLodCullingRequest, error: unknown): InstancedLodCullingResponse {
  return {
    kind: 'cull-instanced-lod-result',
    requestId: message.requestId,
    visibleIndices: new Uint32Array(0),
    targetKinds: new Uint8Array(0),
    targetAssetIds: [],
    targetSourceModelAssetIds: [],
    targetFaceCameras: new Uint8Array(0),
    targetForwardAxes: [],
    targetKeys: [],
    error: error instanceof Error ? error.message : String(error),
  }
}

function handleInstancedLodCullingMessage(
  message: InstancedLodCullingRequest | InstancedLodCullingSyncRequest,
  postResponse: (response: InstancedLodCullingResponse) => void,
): void {
  if (!message) {
    return
  }
  if (message.kind === 'sync-instanced-lod-candidates') {
    syncInstancedLodCandidates(message)
    return
  }
  if (message.kind !== 'cull-instanced-lod') {
    return
  }

  try {
    const response = computeInstancedLodCullingResult(message, instancedLodStaticCandidateCache)
    postResponse(response satisfies InstancedLodCullingResponse)
  } catch (error) {
    postResponse(createErrorResponse(message, error))
  }
}

function registerH5Worker(scope: WorkerScopeLike): void {
  scope.onmessage = (event: MessageEvent<InstancedLodCullingRequest | InstancedLodCullingSyncRequest>) => {
    handleInstancedLodCullingMessage(event.data, (response) => {
      scope.postMessage(response, [
        response.visibleIndices.buffer,
        response.targetKinds.buffer,
        response.targetFaceCameras.buffer,
      ])
    })
  }
}

function registerWechatWorker(worker: WechatWorkerLike): void {
  worker.onMessage((event) => {
    handleInstancedLodCullingMessage(event.data, (response) => {
      worker.postMessage(response)
    })
  })
}

const wechatWorker = (globalThis as typeof globalThis & { worker?: WechatWorkerLike }).worker
if (wechatWorker) {
  registerWechatWorker(wechatWorker)
} else {
  registerH5Worker(self as unknown as WorkerScopeLike)
}
