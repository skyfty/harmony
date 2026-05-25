/// <reference lib="webworker" />

import {
	computeInstancedLodCullingResult,
	type InstancedLodCullingRequest,
	type InstancedLodCullingResponse,
} from '@schema/core'

self.onmessage = (event: MessageEvent<InstancedLodCullingRequest>) => {
	const message = event.data
	if (!message || message.kind !== 'cull-instanced-lod') {
		return
	}

	try {
		const response = computeInstancedLodCullingResult(message)
		self.postMessage(response satisfies InstancedLodCullingResponse)
	} catch (error) {
		const response: InstancedLodCullingResponse = {
			kind: 'cull-instanced-lod-result',
			requestId: message.requestId,
			visibleIds: [],
			targets: [],
			error: error instanceof Error ? error.message : String(error),
		}
		self.postMessage(response)
	}
}
