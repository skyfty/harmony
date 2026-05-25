import {
	type InstancedLodCullingCandidateSnapshot,
	type InstancedLodCullingRequest,
	type InstancedLodCullingSyncRequest,
	type InstancedLodCullingResponse,
	type InstancedLodStaticCandidateSnapshot,
	buildInstancedLodCullingCandidateSnapshot,
	buildInstancedLodCullingRequest,
	buildInstancedLodCullingSyncRequest,
	buildInstancedLodTargetFromParallelSnapshot,
	computeInstancedLodCullingResult,
} from '@schema/core'

let instancedLodCullingWorker: Worker | null = null
let instancedLodCullingPendingRequestId: number | null = null
let instancedLodCullingLatestResult: InstancedLodCullingResponse | null = null
let instancedLodCullingLastSettledResult: InstancedLodCullingResponse | null = null
let instancedLodCullingSyncedRevision = -1
const instancedLodCullingStaticCandidateCache: InstancedLodStaticCandidateSnapshot[] = []

type InstancedLodRuntimeEntryLike = {
	nodeId: string
	snapshot: InstancedLodCullingCandidateSnapshot
}

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
	return dispatchInstancedLodCullingRequestWithCandidates(request)
}

function buildStaticCandidateSnapshots(entries: InstancedLodRuntimeEntryLike[]): InstancedLodStaticCandidateSnapshot[] {
	const snapshots: InstancedLodStaticCandidateSnapshot[] = []
	for (let i = 0; i < entries.length; i += 1) {
		const entry = entries[i]
		if (!entry) {
			continue
		}
		snapshots.push({
			nodeId: entry.nodeId,
			sourceAssetId: entry.snapshot.sourceAssetId ?? null,
			instanceLayout: entry.snapshot.instanceLayout ?? null,
			lodProps: entry.snapshot.lodProps ?? null,
		})
	}
	return snapshots
}

export function dispatchInstancedLodCullingRequestWithCandidates(
	request: InstancedLodCullingRequest,
	runtimeEntries: InstancedLodRuntimeEntryLike[] = [],
	runtimeRevision = -1,
): boolean {
	if (runtimeRevision >= 0 && runtimeRevision !== instancedLodCullingSyncedRevision) {
		const staticSnapshots = buildStaticCandidateSnapshots(runtimeEntries)
		instancedLodCullingStaticCandidateCache.length = 0
		instancedLodCullingStaticCandidateCache.push(...staticSnapshots)
	}

	const worker = getInstancedLodCullingWorker()
	if (!worker) {
		return false
	}
	if (instancedLodCullingPendingRequestId !== null) {
		return false
	}
	if (runtimeRevision >= 0 && runtimeRevision !== instancedLodCullingSyncedRevision) {
		const staticSnapshots = buildStaticCandidateSnapshots(runtimeEntries)
		const syncRequest: InstancedLodCullingSyncRequest = buildInstancedLodCullingSyncRequest({
			revision: runtimeRevision,
			candidates: staticSnapshots,
		})
		try {
			worker.postMessage(syncRequest)
			instancedLodCullingSyncedRevision = runtimeRevision
		} catch (error) {
			console.warn('[InstancedLodCulling] Failed to post worker sync request', error)
			instancedLodCullingSyncedRevision = -1
		}
	}
	instancedLodCullingPendingRequestId = request.requestId
	try {
		worker.postMessage(request, [
			request.cameraProjectionMatrix.buffer,
			request.cameraMatrixWorldInverse.buffer,
			request.cameraPosition.buffer,
			request.candidateIndices.buffer,
			request.candidateEnableCulling.buffer,
			request.candidateWorldPositions.buffer,
			request.candidateRadii.buffer,
		])
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

export function computeInstancedLodCullingResultWithCache(request: InstancedLodCullingRequest): InstancedLodCullingResponse {
	return computeInstancedLodCullingResult(request, instancedLodCullingStaticCandidateCache)
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
	buildInstancedLodCullingSyncRequest,
	buildInstancedLodTargetFromParallelSnapshot,
	computeInstancedLodCullingResult,
}
