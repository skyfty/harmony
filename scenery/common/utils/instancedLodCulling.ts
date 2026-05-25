import {
	type InstancedLodCullingCandidateSnapshot,
	type InstancedLodCullingRequest,
	type InstancedLodCullingResponse,
	type InstancedLodStaticCandidateSnapshot,
	buildInstancedLodCullingCandidateSnapshot,
	buildInstancedLodCullingRequest,
	buildInstancedLodTargetFromParallelSnapshot,
	computeInstancedLodCullingResult,
} from '@harmony/schema/core'

let instancedLodCullingSyncedRevision = -1
const instancedLodCullingStaticCandidateCache: InstancedLodStaticCandidateSnapshot[] = []

type InstancedLodRuntimeEntryLike = {
  nodeId: string
  snapshot: InstancedLodCullingCandidateSnapshot
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

function syncInstancedLodStaticCandidateCache(
  runtimeEntries: InstancedLodRuntimeEntryLike[],
  runtimeRevision: number,
): void {
  if (runtimeRevision < 0 || runtimeRevision === instancedLodCullingSyncedRevision) {
    return
  }
  instancedLodCullingStaticCandidateCache.length = 0
  instancedLodCullingStaticCandidateCache.push(...buildStaticCandidateSnapshots(runtimeEntries))
  instancedLodCullingSyncedRevision = runtimeRevision
}

export function dispatchInstancedLodCullingRequest(request: InstancedLodCullingRequest): InstancedLodCullingResponse {
  return dispatchInstancedLodCullingRequestWithCandidates(request)
}

export function dispatchInstancedLodCullingRequestWithCandidates(
  request: InstancedLodCullingRequest,
  runtimeEntries: InstancedLodRuntimeEntryLike[] = [],
  runtimeRevision: number = -1,
): InstancedLodCullingResponse {
  syncInstancedLodStaticCandidateCache(runtimeEntries, runtimeRevision)

  try {
    return computeInstancedLodCullingResult(request, instancedLodCullingStaticCandidateCache)
  } catch (error) {
    return createErrorResponse(request, error)
  }
}

export type {
  InstancedLodCullingCandidateSnapshot,
  InstancedLodCullingRequest,
  InstancedLodCullingResponse,
}

export {
  buildInstancedLodCullingCandidateSnapshot,
  buildInstancedLodCullingRequest,
  buildInstancedLodTargetFromParallelSnapshot,
  computeInstancedLodCullingResult,
}
