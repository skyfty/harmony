import {
	type InstancedLodCullingCandidateSnapshot,
	type InstancedLodCullingRequest,
	type InstancedLodCullingResponse,
	buildInstancedLodCullingCandidateSnapshot,
	buildInstancedLodCullingRequest,
	computeInstancedLodCullingResult,
} from '@schema/core'

let instancedLodCullingWorker: Worker | null = null
let instancedLodCullingPendingRequestId: number | null = null
let instancedLodCullingLatestResult: InstancedLodCullingResponse | null = null
let instancedLodCullingLastSettledResult: InstancedLodCullingResponse | null = null

function getInstancedLodCullingWorker(): Worker | null {
	if (typeof Worker === 'undefined') {
		return null
	}
	if (instancedLodCullingWorker) {
		return instancedLodCullingWorker
	}
	try {
		instancedLodCullingWorker = new Worker(new URL('@/workers/instancedLodCulling.worker.ts', import.meta.url), {
			type: 'module',
		})
		instancedLodCullingWorker.onmessage = (event: MessageEvent<InstancedLodCullingResponse>) => {
			const data = event.data
			if (!data || data.kind !== 'cull-instanced-lod-result') {
				return
			}
			if (instancedLodCullingPendingRequestId !== data.requestId) {
				return
			}
			instancedLodCullingPendingRequestId = null
			instancedLodCullingLatestResult = data
			instancedLodCullingLastSettledResult = data
		}
		instancedLodCullingWorker.onerror = (event) => {
			console.warn('[InstancedLodCulling] Worker failed', event)
			instancedLodCullingPendingRequestId = null
			instancedLodCullingLatestResult = null
			instancedLodCullingWorker?.terminate()
			instancedLodCullingWorker = null
		}
		return instancedLodCullingWorker
	} catch (error) {
		console.warn('[InstancedLodCulling] Unable to initialize worker; falling back to main thread', error)
		instancedLodCullingWorker = null
		return null
	}
}

export function dispatchInstancedLodCullingRequest(request: InstancedLodCullingRequest): boolean {
	const worker = getInstancedLodCullingWorker()
	if (!worker) {
		return false
	}
	if (instancedLodCullingPendingRequestId !== null) {
		return false
	}
	instancedLodCullingPendingRequestId = request.requestId
	try {
		worker.postMessage(request)
		return true
	} catch (error) {
		console.warn('[InstancedLodCulling] Failed to post worker request', error)
		instancedLodCullingPendingRequestId = null
		return false
	}
}

export function consumeInstancedLodCullingResult(): InstancedLodCullingResponse | null {
	if (!instancedLodCullingLatestResult) {
		return null
	}
	const result = instancedLodCullingLatestResult
	instancedLodCullingLatestResult = null
	return result
}

export function getLastInstancedLodCullingResult(): InstancedLodCullingResponse | null {
	return instancedLodCullingLastSettledResult
}

export function hasInstancedLodCullingWorker(): boolean {
	return instancedLodCullingWorker !== null
}

export type {
	InstancedLodCullingCandidateSnapshot,
	InstancedLodCullingRequest,
	InstancedLodCullingResponse,
}

export {
	buildInstancedLodCullingCandidateSnapshot,
	buildInstancedLodCullingRequest,
	computeInstancedLodCullingResult,
}
