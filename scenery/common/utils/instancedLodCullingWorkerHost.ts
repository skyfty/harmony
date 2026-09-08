import {
	buildInstancedLodCullingCandidateSnapshot,
	buildInstancedLodCullingRequest,
	buildInstancedLodCullingSyncRequest,
	buildInstancedLodTargetFromParallelSnapshot,
	computeInstancedLodCullingResult,
	type InstancedLodCullingCandidateSnapshot,
	type InstancedLodCullingRequest,
	type InstancedLodCullingResponse,
	type InstancedLodStaticCandidateSnapshot,
} from '@harmony/schema/core'
import {
	createWechatWorkerFacade,
	isWechatSharedWorkerSupported,
} from '@harmony/utils/wechat-shared-worker'

const INSTANCED_LOD_CULLING_WORKER_TIMEOUT_MS = 1000
const INSTANCED_LOD_CULLING_WORKER_RETRY_MS = 2000

type InstancedLodRuntimeEntryLike = {
  nodeId: string
  snapshot: InstancedLodCullingCandidateSnapshot
}

type InstancedLodCullingDispatchResult = 'posted' | 'busy' | 'unavailable'

type InstancedLodCullingSettledResult = {
  response: InstancedLodCullingResponse
  revision: number
  cameraProjectionMatrix: Float32Array
  cameraMatrixWorldInverse: Float32Array
} | null

type InstancedLodCullingWorkerLike = {
  postMessage: (message: unknown, transferables?: ArrayBuffer[] | Transferable[]) => void
  terminate: () => void
}

type InstancedLodCullingH5WorkerLike = InstancedLodCullingWorkerLike & {
  onmessage: ((event: MessageEvent<InstancedLodCullingResponse>) => void) | null
  onerror: ((event: Event | string) => void) | null
}

let instancedLodCullingRefCount = 0
let instancedLodCullingWorker: InstancedLodCullingWorkerLike | null = null
let instancedLodCullingWorkerSyncedRevision = -1
let instancedLodCullingFallbackSyncedRevision = -1
let instancedLodCullingPendingRequestId: number | null = null
let instancedLodCullingPendingRevision = -1
let instancedLodCullingPendingProjectionMatrix: Float32Array | null = null
let instancedLodCullingPendingMatrixWorldInverse: Float32Array | null = null
let instancedLodCullingPendingWatchdog: ReturnType<typeof setTimeout> | null = null
let instancedLodCullingLatestResult: InstancedLodCullingResponse | null = null
let instancedLodCullingSettledRevision = -1
let instancedLodCullingSettledProjectionMatrix: Float32Array | null = null
let instancedLodCullingSettledMatrixWorldInverse: Float32Array | null = null
let instancedLodCullingEverSettled = false
let instancedLodCullingLastFailureAt = -1
const instancedLodCullingStaticCandidateCache: InstancedLodStaticCandidateSnapshot[] = []

function buildStaticCandidateSnapshots(
  entries: InstancedLodRuntimeEntryLike[],
): InstancedLodStaticCandidateSnapshot[] {
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

function syncInstancedLodCullingFallbackCache(
  runtimeEntries: InstancedLodRuntimeEntryLike[],
  runtimeRevision: number,
): void {
  if (runtimeRevision < 0 || runtimeRevision === instancedLodCullingFallbackSyncedRevision) {
    return
  }
  instancedLodCullingStaticCandidateCache.length = 0
  instancedLodCullingStaticCandidateCache.push(...buildStaticCandidateSnapshots(runtimeEntries))
  instancedLodCullingFallbackSyncedRevision = runtimeRevision
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

function collectRequestTransferables(request: InstancedLodCullingRequest): ArrayBuffer[] {
  return [
    request.cameraProjectionMatrix.buffer,
    request.cameraMatrixWorldInverse.buffer,
    request.cameraPosition.buffer,
    request.candidateIndices.buffer,
    request.candidateEnableCulling.buffer,
    request.candidateWorldPositions.buffer,
    request.candidateRadii.buffer,
  ]
}

function clearInstancedLodCullingPendingWatchdog(): void {
  if (instancedLodCullingPendingWatchdog !== null) {
    clearTimeout(instancedLodCullingPendingWatchdog)
    instancedLodCullingPendingWatchdog = null
  }
}

function startInstancedLodCullingPendingWatchdog(worker: InstancedLodCullingWorkerLike): void {
  clearInstancedLodCullingPendingWatchdog()
  if (typeof setTimeout !== 'function') {
    return
  }
  instancedLodCullingPendingWatchdog = setTimeout(() => {
    instancedLodCullingPendingWatchdog = null
    if (instancedLodCullingPendingRequestId !== null && instancedLodCullingWorker === worker) {
      handleInstancedLodCullingWorkerFailure(
        worker,
        new Error('Instanced LOD culling worker response timed out'),
      )
    }
  }, INSTANCED_LOD_CULLING_WORKER_TIMEOUT_MS)
}

function handleInstancedLodCullingWorkerFailure(
  worker: InstancedLodCullingWorkerLike,
  event: unknown,
): void {
  console.warn('[Scenery][InstancedLodCulling] Worker failed', event)
  if (instancedLodCullingWorker === worker) {
    instancedLodCullingWorker = null
  }
  clearInstancedLodCullingPendingWatchdog()
  instancedLodCullingPendingRequestId = null
  instancedLodCullingPendingProjectionMatrix = null
  instancedLodCullingPendingMatrixWorldInverse = null
  instancedLodCullingLatestResult = null
  instancedLodCullingEverSettled = false
  instancedLodCullingLastFailureAt = Date.now()
  try {
    worker.terminate()
  } catch (error) {
    console.warn('[Scenery][InstancedLodCulling] Failed to terminate worker', error)
  }
}

function handleInstancedLodCullingWorkerMessage(
  worker: InstancedLodCullingWorkerLike,
  data: unknown,
): void {
  if (!data || typeof data !== 'object') {
    return
  }
  const response = data as InstancedLodCullingResponse
  if (response.kind !== 'cull-instanced-lod-result') {
    return
  }
  if (instancedLodCullingPendingRequestId === null || response.requestId !== instancedLodCullingPendingRequestId) {
    return
  }
  if (typeof response.error === 'string') {
    handleInstancedLodCullingWorkerFailure(worker, new Error(response.error))
    return
  }
  clearInstancedLodCullingPendingWatchdog()
  instancedLodCullingPendingRequestId = null
  instancedLodCullingLatestResult = response
  instancedLodCullingSettledRevision = instancedLodCullingPendingRevision
  instancedLodCullingSettledProjectionMatrix = instancedLodCullingPendingProjectionMatrix
  instancedLodCullingSettledMatrixWorldInverse = instancedLodCullingPendingMatrixWorldInverse
  instancedLodCullingEverSettled = true
}

function createH5InstancedLodCullingWorker(): InstancedLodCullingWorkerLike | null {
  if (typeof Worker === 'undefined') {
    return null
  }
  try {
    const worker = new Worker(
      new URL('../../workers/instancedLodCulling.worker.ts', import.meta.url),
      { type: 'module' },
    ) as unknown as InstancedLodCullingH5WorkerLike
    worker.onmessage = (event: MessageEvent<InstancedLodCullingResponse>) => {
      handleInstancedLodCullingWorkerMessage(worker, event.data)
    }
    worker.onerror = (event) => {
      handleInstancedLodCullingWorkerFailure(worker, event)
    }
    return worker
  } catch (error) {
    console.warn('[Scenery][InstancedLodCulling] Failed to create H5 worker', error)
    return null
  }
}

function createMpInstancedLodCullingWorker(): InstancedLodCullingWorkerLike | null {
  if (!isWechatSharedWorkerSupported()) {
    return null
  }
  try {
    const worker = createWechatWorkerFacade('instancedLodCulling.worker.js')
    worker.onMessage((event) => {
      handleInstancedLodCullingWorkerMessage(worker as unknown as InstancedLodCullingWorkerLike, event.data)
    })
    return worker as unknown as InstancedLodCullingWorkerLike
  } catch (error) {
    console.warn('[Scenery][InstancedLodCulling] Failed to create WeChat shared worker client', error)
    return null
  }
}

function ensureInstancedLodCullingWorker(): InstancedLodCullingWorkerLike | null {
  if (instancedLodCullingWorker) {
    return instancedLodCullingWorker
  }
  if (instancedLodCullingRefCount <= 0) {
    return null
  }
  const now = Date.now()
  if (
    instancedLodCullingLastFailureAt >= 0
    && now - instancedLodCullingLastFailureAt < INSTANCED_LOD_CULLING_WORKER_RETRY_MS
  ) {
    return null
  }
  const worker = createMpInstancedLodCullingWorker() ?? createH5InstancedLodCullingWorker()
  if (!worker) {
    instancedLodCullingLastFailureAt = Date.now()
    return null
  }
  instancedLodCullingWorker = worker
  instancedLodCullingWorkerSyncedRevision = -1
  instancedLodCullingEverSettled = false
  return worker
}

function postInstancedLodCullingMessage(
  worker: InstancedLodCullingWorkerLike,
  message: unknown,
  transferables?: ArrayBuffer[],
): void {
  if (transferables && transferables.length > 0) {
    worker.postMessage(message, transferables)
    return
  }
  worker.postMessage(message)
}

function disposeInstancedLodCullingWorker(): void {
  clearInstancedLodCullingPendingWatchdog()
  const worker = instancedLodCullingWorker
  instancedLodCullingWorker = null
  if (worker) {
    try {
      worker.terminate()
    } catch (error) {
      console.warn('[Scenery][InstancedLodCulling] Failed to dispose worker', error)
    }
  }
  instancedLodCullingPendingRequestId = null
  instancedLodCullingPendingProjectionMatrix = null
  instancedLodCullingPendingMatrixWorldInverse = null
  instancedLodCullingLatestResult = null
  instancedLodCullingSettledRevision = -1
  instancedLodCullingSettledProjectionMatrix = null
  instancedLodCullingSettledMatrixWorldInverse = null
  instancedLodCullingEverSettled = false
  instancedLodCullingWorkerSyncedRevision = -1
  instancedLodCullingFallbackSyncedRevision = -1
  instancedLodCullingStaticCandidateCache.length = 0
}

export function acquireInstancedLodCullingWorker(): void {
  instancedLodCullingRefCount += 1
}

export function releaseInstancedLodCullingWorker(): void {
  instancedLodCullingRefCount = Math.max(0, instancedLodCullingRefCount - 1)
  if (instancedLodCullingRefCount === 0) {
    disposeInstancedLodCullingWorker()
  }
}

export function resetInstancedLodCullingWorker(): void {
  releaseInstancedLodCullingWorker()
}

export function hasInstancedLodCullingSettledResult(): boolean {
  return instancedLodCullingEverSettled
}

export function isInstancedLodCullingRequestPending(): boolean {
  return instancedLodCullingPendingRequestId !== null
}

export function dispatchInstancedLodCullingRequestToWorker(
  request: InstancedLodCullingRequest,
  runtimeEntries: InstancedLodRuntimeEntryLike[] = [],
  runtimeRevision = -1,
): InstancedLodCullingDispatchResult {
  if (!request || request.kind !== 'cull-instanced-lod') {
    return 'unavailable'
  }
  if (instancedLodCullingRefCount <= 0) {
    instancedLodCullingRefCount = 1
  }
  const worker = ensureInstancedLodCullingWorker()
  if (!worker) {
    return 'unavailable'
  }
  if (instancedLodCullingPendingRequestId !== null) {
    return 'busy'
  }

  if (runtimeRevision >= 0 && runtimeRevision !== instancedLodCullingWorkerSyncedRevision) {
    const syncRequest = buildInstancedLodCullingSyncRequest({
      revision: runtimeRevision,
      candidates: buildStaticCandidateSnapshots(runtimeEntries),
    })
    try {
      postInstancedLodCullingMessage(worker, syncRequest)
      instancedLodCullingWorkerSyncedRevision = runtimeRevision
    } catch (error) {
      console.warn('[Scenery][InstancedLodCulling] Failed to post worker sync request', error)
      instancedLodCullingWorkerSyncedRevision = -1
      handleInstancedLodCullingWorkerFailure(worker, error)
      return 'unavailable'
    }
  }

  instancedLodCullingPendingRequestId = request.requestId
  instancedLodCullingPendingRevision = runtimeRevision
  instancedLodCullingPendingProjectionMatrix = new Float32Array(request.cameraProjectionMatrix)
  instancedLodCullingPendingMatrixWorldInverse = new Float32Array(request.cameraMatrixWorldInverse)
  try {
    postInstancedLodCullingMessage(worker, request, collectRequestTransferables(request))
    startInstancedLodCullingPendingWatchdog(worker)
    return 'posted'
  } catch (error) {
    console.warn('[Scenery][InstancedLodCulling] Failed to post worker request', error)
    instancedLodCullingPendingRequestId = null
    instancedLodCullingPendingProjectionMatrix = null
    instancedLodCullingPendingMatrixWorldInverse = null
    handleInstancedLodCullingWorkerFailure(worker, error)
    return 'unavailable'
  }
}

export function computeInstancedLodCullingResultSync(
  request: InstancedLodCullingRequest,
  runtimeEntries: InstancedLodRuntimeEntryLike[] = [],
  runtimeRevision = -1,
): InstancedLodCullingResponse {
  syncInstancedLodCullingFallbackCache(runtimeEntries, runtimeRevision)
  try {
    return computeInstancedLodCullingResult(request, instancedLodCullingStaticCandidateCache)
  } catch (error) {
    return createErrorResponse(request, error)
  }
}

export function consumeInstancedLodCullingResult(): InstancedLodCullingSettledResult {
  if (!instancedLodCullingLatestResult) {
    return null
  }
  const result = instancedLodCullingLatestResult
  instancedLodCullingLatestResult = null
  return {
    response: result,
    revision: instancedLodCullingSettledRevision,
    cameraProjectionMatrix: instancedLodCullingSettledProjectionMatrix ?? new Float32Array(16),
    cameraMatrixWorldInverse: instancedLodCullingSettledMatrixWorldInverse ?? new Float32Array(16),
  }
}

export type {
  InstancedLodCullingCandidateSnapshot,
  InstancedLodCullingRequest,
  InstancedLodCullingResponse,
  InstancedLodStaticCandidateSnapshot,
}

export {
  buildInstancedLodCullingCandidateSnapshot,
  buildInstancedLodCullingRequest,
  buildInstancedLodCullingSyncRequest,
  buildInstancedLodTargetFromParallelSnapshot,
}
