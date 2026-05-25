/// <reference lib="webworker" />

import {
	computeInstancedLodCullingResult,
	type InstancedLodCullingSyncRequest,
	type InstancedLodCullingRequest,
	type InstancedLodCullingResponse,
	type InstancedLodStaticCandidateSnapshot,
} from '@schema/core'

const instancedLodStaticCandidateCache: InstancedLodStaticCandidateSnapshot[] = []
let instancedLodSyncedRevision = -1

self.onmessage = (event: MessageEvent<InstancedLodCullingRequest | InstancedLodCullingSyncRequest>) => {
  const message = event.data
  if (!message) {
    return
  }
  if (message.kind === 'sync-instanced-lod-candidates') {
    if (message.revision >= instancedLodSyncedRevision) {
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
    return
  }
  if (!message || message.kind !== 'cull-instanced-lod') {
    return
  }

	try {
		const response = computeInstancedLodCullingResult(message, instancedLodStaticCandidateCache)
		self.postMessage(response satisfies InstancedLodCullingResponse, [
			response.visibleIndices.buffer,
			response.targetKinds.buffer,
			response.targetFaceCameras.buffer,
		])
	} catch (error) {
		const response: InstancedLodCullingResponse = {
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
		self.postMessage(response, [response.visibleIndices.buffer, response.targetKinds.buffer, response.targetFaceCameras.buffer])
	}
}
