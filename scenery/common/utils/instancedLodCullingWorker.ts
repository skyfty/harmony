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
} from '@harmony/schema/core'

type InstancedLodCullingWorkerLike = {
  postMessage: (message: unknown, transferables?: Transferable[]) => void
  terminate: () => void
}

type H5InstancedLodCullingWorkerLike = InstancedLodCullingWorkerLike & {
  onmessage: ((event: MessageEvent<InstancedLodCullingResponse>) => void) | null
  onerror: ((event: Event | string) => void) | null
}

type WechatInstancedLodCullingWorkerLike = InstancedLodCullingWorkerLike & {
  onMessage?: (callback: (event: { data: InstancedLodCullingResponse }) => void) => void
  onProcessKilled?: (callback: (event: unknown) => void) => void
}

let instancedLodCullingWorker: InstancedLodCullingWorkerLike | null = null
let instancedLodCullingPendingRequestId: number | null = null
let instancedLodCullingLatestResult: InstancedLodCullingResponse | null = null
let instancedLodCullingLastSettledResult: InstancedLodCullingResponse | null = null
let instancedLodCullingSyncedRevision = -1
const instancedLodCullingStaticCandidateCache: InstancedLodStaticCandidateSnapshot[] = []

type InstancedLodRuntimeEntryLike = {
  nodeId: string
  snapshot: InstancedLodCullingCandidateSnapshot
}

function handleInstancedLodCullingWorkerMessage(data: InstancedLodCullingResponse): void {
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

function handleInstancedLodCullingWorkerFailure(worker: InstancedLodCullingWorkerLike, event: unknown): void {
  console.warn('[Scenery][InstancedLodCulling] Worker failed', event)
  instancedLodCullingPendingRequestId = null
  instancedLodCullingLatestResult = null
  worker.terminate()
  instancedLodCullingWorker = null
}

function postInstancedLodCullingMessage(
  worker: InstancedLodCullingWorkerLike,
  message: InstancedLodCullingRequest | InstancedLodCullingSyncRequest,
  transferables?: Transferable[],
): void {
  if ('onMessage' in worker && typeof (worker as WechatInstancedLodCullingWorkerLike).onMessage === 'function') {
    worker.postMessage(message)
    return
  }
  worker.postMessage(message, transferables)
}

function createH5InstancedLodCullingWorker(): H5InstancedLodCullingWorkerLike | null {
  if (typeof Worker === 'undefined') {
    return null
  }
  const worker = new Worker(new URL('../../workers/instancedLodCulling.worker.ts', import.meta.url), {
    type: 'module',
  }) as H5InstancedLodCullingWorkerLike
  worker.onmessage = (event: MessageEvent<InstancedLodCullingResponse>) => {
    handleInstancedLodCullingWorkerMessage(event.data)
  }
  worker.onerror = (event) => {
    handleInstancedLodCullingWorkerFailure(worker, event)
  }
  return worker
}

function createMpWeixinInstancedLodCullingWorker(): WechatInstancedLodCullingWorkerLike | null {
  const wxAny = (globalThis as typeof globalThis & {
    wx?: {
      createWorker?: (scriptPath: string) => WechatInstancedLodCullingWorkerLike | null
    }
  }).wx
  if (!wxAny || typeof wxAny.createWorker !== 'function') {
    return null
  }
  const worker = wxAny.createWorker('pages/scenery/workers/instancedLodCulling.worker.js')
  if (!worker) {
    return null
  }
  worker.onMessage?.((event) => {
    handleInstancedLodCullingWorkerMessage(event.data)
  })
  worker.onProcessKilled?.((event) => {
    handleInstancedLodCullingWorkerFailure(worker, event)
  })
  return worker
}

function getInstancedLodCullingWorker(): InstancedLodCullingWorkerLike | null {
  if (instancedLodCullingWorker) {
    return instancedLodCullingWorker
  }
  try {
    // #ifdef H5
    const h5Worker = createH5InstancedLodCullingWorker()
    if (h5Worker) {
      instancedLodCullingWorker = h5Worker
      return h5Worker
    }
    // #endif
    // #ifdef MP-WEIXIN
    const mpWorker = createMpWeixinInstancedLodCullingWorker()
    if (mpWorker) {
      instancedLodCullingWorker = mpWorker
      return mpWorker
    }
    // #endif
    return null
  } catch (error) {
    console.warn('[Scenery][InstancedLodCulling] Unable to initialize worker; falling back to main thread', error)
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
	runtimeRevision: number = -1,
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
      postInstancedLodCullingMessage(worker, syncRequest)
      instancedLodCullingSyncedRevision = runtimeRevision
    } catch (error) {
      console.warn('[Scenery][InstancedLodCulling] Failed to post worker sync request', error)
      instancedLodCullingSyncedRevision = -1
    }
  }
	instancedLodCullingPendingRequestId = request.requestId
	try {
		postInstancedLodCullingMessage(worker, request, [
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
    console.warn('[Scenery][InstancedLodCulling] Failed to post worker request', error)
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
