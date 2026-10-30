import type { BufferGeometry, Mesh, Object3D } from 'three'

import {
  GROUND_COLLISION_SOURCE_COMPONENT_TYPE,
  PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
  type GroundCollisionSourceComponentProps,
} from './components'
import {
  resolveEnabledComponentState,
  type SceneNode,
  type SceneNodeComponentState,
} from './core'
import {
  resolveProceduralLandscapeDemCollisionSampler,
  type ProceduralLandscapeDemCollisionSampler,
  isProceduralLandscapeRoadBoundaryCollision,
  isProceduralLandscapeRoadBoundaryVisual,
  isProceduralLandscapeRoadCollision,
  isProceduralLandscapeRoadbedSurface,
  isProceduralLandscapeRoadSurface,
} from './proceduralLandscape/collisionMetadata'
import type { ProceduralLandscapeComponentProps } from './proceduralLandscape/config'
import {
  getProceduralLandscapeStats,
  type ProceduralLandscapeRuntimeStats,
} from './proceduralLandscape/runtime'

export const DEM_GROUND_COLLISION_READY_TIMEOUT_MS = 30_000
export const DEM_GROUND_COLLISION_READY_POLL_INTERVAL_MS = 50
const DEM_GROUND_COLLISION_READY_PROGRESS_EPSILON = 1e-4

export type DemGroundCollisionSourceStatus =
  | 'inactive'
  | 'idle'
  | 'loading'
  | 'building'
  | 'ready'
  | 'error'
  | 'missing-stats'
  | 'missing-object'
  | 'ready-no-mesh'

export type GroundCollisionSourceTerrainReadinessStatus = 'ready' | 'timeout' | 'aborted'

export type GroundCollisionSourceTerrainReadinessParams = {
  nodes: SceneNode[] | null | undefined
  resolveSourceObject: (nodeId: string) => Object3D | null | undefined
  getStats?: (
    nodeId: string,
  ) => Pick<ProceduralLandscapeRuntimeStats, 'demStatus'>
    & Partial<Pick<ProceduralLandscapeRuntimeStats, 'progress'>>
    | null
    | undefined
  getProgress?: (
    nodeId: string,
    stats: Pick<ProceduralLandscapeRuntimeStats, 'demStatus'>
      & Partial<Pick<ProceduralLandscapeRuntimeStats, 'progress'>>
      | null
      | undefined,
  ) => number | null
  shouldAbort?: () => boolean
  /** Maximum time without a status or numeric-progress change. */
  stallTimeoutMs?: number
  /** Backward-compatible alias for stallTimeoutMs. */
  timeoutMs?: number
  pollIntervalMs?: number
  now?: () => number
  sleep?: (delayMs: number) => Promise<void>
  onPending?: (
    pendingNodeIds: readonly string[],
    statuses: Readonly<Record<string, DemGroundCollisionSourceStatus>>,
  ) => void
}

export type GroundCollisionSourceTerrainReadinessResult = {
  status: GroundCollisionSourceTerrainReadinessStatus
  /** DEM sources that were still not ready when the wait ended. */
  pendingNodeIds: string[]
  /** Sources whose DEM component reported `error`; waiting on them cannot help. */
  skippedNodeIds: string[]
  statuses: Record<string, DemGroundCollisionSourceStatus>
}

export type GroundCollisionCoverageSnapshotLike = {
  indexing?: boolean
  pendingChunkCount?: number
  uncoveredReferenceCount?: number
  referenceGroundCoverage?: ReadonlyArray<{
    covered?: boolean
    groundPatched?: boolean
    resident?: boolean
    active?: boolean
  }>
}

/**
 * A DEM source is usable by the first physics step only after indexing has
 * finished and every live ground reference has an active collision surface.
 */
export function isGroundCollisionCoverageReady(
  snapshot: GroundCollisionCoverageSnapshotLike | null | undefined,
  expectedReferenceCount?: number,
): boolean {
  if (!snapshot || snapshot.indexing === true || (snapshot.pendingChunkCount ?? 0) > 0) {
    return false
  }
  const references = Array.isArray(snapshot.referenceGroundCoverage)
    ? snapshot.referenceGroundCoverage
    : []
  const expectedCount = Math.max(
    0,
    Math.trunc(expectedReferenceCount ?? references.length),
  )
  if (expectedCount === 0 || references.length < expectedCount) {
    return false
  }
  if ((snapshot.uncoveredReferenceCount ?? 0) > 0) {
    return false
  }
  return references
    .slice(0, expectedCount)
    .every((reference) => (
      reference?.covered === true
      && (reference.groundPatched === true || reference.active === true || reference.resident === true)
    ))
}

export function resolveGroundCollisionSurfaceSampler(
  nodes: SceneNode[] | null | undefined,
  resolveSourceObject: (nodeId: string) => Object3D | null | undefined,
): ProceduralLandscapeDemCollisionSampler | null {
  for (const nodeId of collectDemGroundCollisionSourceNodeIds(nodes)) {
    const sourceObject = resolveSourceObject(nodeId)
    if (!sourceObject) {
      continue
    }
    const stack: Object3D[] = [sourceObject]
    while (stack.length > 0) {
      const object = stack.pop()
      if (!object || object.visible === false) {
        continue
      }
      const sampler = resolveProceduralLandscapeDemCollisionSampler(object)
      if (sampler) {
        return sampler
      }
      if (object.children.length > 0) {
        stack.push(...object.children)
      }
    }
  }
  return null
}

export function resolveGroundedCharacterBodyCenterY(
  surfaceY: number,
  currentBodyCenterY: number,
  colliderHeight: number,
  clearanceMeters = 0.02,
): number {
  if (!Number.isFinite(surfaceY) || !Number.isFinite(currentBodyCenterY)) {
    return currentBodyCenterY
  }
  const halfHeight = Math.max(0.05, Number.isFinite(colliderHeight) ? colliderHeight : 0.1) * 0.5
  const clearance = Math.max(0, Number.isFinite(clearanceMeters) ? clearanceMeters : 0.02)
  const footY = currentBodyCenterY - halfHeight
  return footY <= surfaceY + clearance
    ? surfaceY + halfHeight + clearance
    : currentBodyCenterY
}

export function resolveGroundCollisionSourceComponent(
  node: SceneNode | null | undefined,
) {
  return resolveEnabledComponentState<GroundCollisionSourceComponentProps>(
    node,
    GROUND_COLLISION_SOURCE_COMPONENT_TYPE,
  )
}

export function collectGroundCollisionSourceNodeIds(
  nodes: SceneNode[] | null | undefined,
): string[] {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return []
  }
  const nodeIds: string[] = []
  const stack = [...nodes]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    if (resolveGroundCollisionSourceComponent(node)) {
      nodeIds.push(node.id)
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      stack.push(...node.children)
    }
  }
  return nodeIds
}

function isEnabledDemProceduralLandscapeNode(node: SceneNode): boolean {
  const component = node.components?.[PROCEDURAL_LANDSCAPE_COMPONENT_TYPE] as
    | SceneNodeComponentState<Partial<ProceduralLandscapeComponentProps>>
    | undefined
  if (!component || component.enabled === false) {
    return false
  }
  const dem = component.props?.dem
  return Boolean(
    typeof dem?.assetId === 'string'
      && dem.assetId.trim().length > 0
      && typeof dem?.runtimeGridUrl === 'string'
      && dem.runtimeGridUrl.trim().length > 0,
  )
}

/**
 * Nodes whose collision mesh is produced asynchronously by the DEM procedural
 * landscape runtime. A plain Ground Collision Source already has its meshes in
 * the scene subtree and does not need a readiness wait.
 */
export function collectDemGroundCollisionSourceNodeIds(
  nodes: SceneNode[] | null | undefined,
): string[] {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return []
  }
  const nodeIds: string[] = []
  const stack = [...nodes]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    if (
      resolveGroundCollisionSourceComponent(node)
      && isEnabledDemProceduralLandscapeNode(node)
    ) {
      nodeIds.push(node.id)
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      stack.push(...node.children)
    }
  }
  return nodeIds
}

/**
 * Mirrors the mesh collision streamer's eligibility rules closely enough to
 * decide whether a source subtree can contribute a collision chunk yet.
 */
export function hasGroundCollisionMesh(sourceObject: Object3D | null | undefined): boolean {
  if (!sourceObject) {
    return false
  }
  const stack: Object3D[] = [sourceObject]
  while (stack.length > 0) {
    const object = stack.pop()
    if (!object || object.visible === false) {
      continue
    }
    const mesh = object as Mesh & {
      isMesh?: boolean
      isInstancedMesh?: boolean
      geometry?: BufferGeometry
    }
    if (
      mesh.isMesh === true
      && mesh.isInstancedMesh !== true
      && !isProceduralLandscapeRoadSurface(object)
      && !isProceduralLandscapeRoadbedSurface(object)
      && !isProceduralLandscapeRoadCollision(object)
      && !isProceduralLandscapeRoadBoundaryCollision(object)
      && !isProceduralLandscapeRoadBoundaryVisual(object)
    ) {
      const position = mesh.geometry?.getAttribute('position')
      if (position && position.itemSize >= 3 && position.count >= 3) {
        return true
      }
    }
    if (object.children.length > 0) {
      stack.push(...object.children)
    }
  }
  return false
}

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

function resolveSourceStatus(params: {
  nodeId: string
  resolveSourceObject: GroundCollisionSourceTerrainReadinessParams['resolveSourceObject']
  getStats: NonNullable<GroundCollisionSourceTerrainReadinessParams['getStats']>
}): { status: DemGroundCollisionSourceStatus; ready: boolean; skipped: boolean } {
  const object = params.resolveSourceObject(params.nodeId) ?? null
  const stats = params.getStats(params.nodeId)
  if (stats?.demStatus === 'error') {
    return { status: stats.demStatus, ready: false, skipped: true }
  }
  if (!object) {
    return { status: 'missing-object', ready: false, skipped: false }
  }
  if (!stats) {
    return { status: 'missing-stats', ready: false, skipped: false }
  }
  if (stats.demStatus !== 'ready') {
    return { status: stats.demStatus, ready: false, skipped: false }
  }
  if (!hasGroundCollisionMesh(object)) {
    return { status: 'ready-no-mesh', ready: false, skipped: false }
  }
  return { status: 'ready', ready: true, skipped: false }
}

/**
 * Waits until every DEM-backed Ground Collision Source has finished building
 * its runtime mesh. Physics must stay suspended during this wait: the DEM mesh
 * can take much longer to appear than a character takes to fall a few metres,
 * so starting the first physics step earlier causes terrain tunnelling.
 */
export async function waitForGroundCollisionSourceTerrainReady(
  params: GroundCollisionSourceTerrainReadinessParams,
): Promise<GroundCollisionSourceTerrainReadinessResult> {
  const nodeIds = collectDemGroundCollisionSourceNodeIds(params.nodes)
  if (nodeIds.length === 0) {
    return {
      status: 'ready',
      pendingNodeIds: [],
      skippedNodeIds: [],
      statuses: {},
    }
  }

  const getStats = params.getStats ?? getProceduralLandscapeStats
  const shouldAbort = params.shouldAbort ?? (() => false)
  const stallTimeoutMs = Math.max(
    0,
    params.stallTimeoutMs
      ?? params.timeoutMs
      ?? DEM_GROUND_COLLISION_READY_TIMEOUT_MS,
  )
  const pollIntervalMs = Math.max(
    1,
    params.pollIntervalMs ?? DEM_GROUND_COLLISION_READY_POLL_INTERVAL_MS,
  )
  const now = params.now ?? defaultNow
  const sleep = params.sleep ?? defaultSleep
  let lastActivityAt = now()
  const skippedNodeIds = new Set<string>()
  let lastPendingSignature = ''

  const buildResult = (
    status: GroundCollisionSourceTerrainReadinessStatus,
    pendingNodeIds: string[],
    statuses: Record<string, DemGroundCollisionSourceStatus>,
  ): GroundCollisionSourceTerrainReadinessResult => ({
    status,
    pendingNodeIds,
    skippedNodeIds: nodeIds.filter((nodeId) => skippedNodeIds.has(nodeId)),
    statuses,
  })

  while (true) {
    if (shouldAbort()) {
      return buildResult('aborted', [...nodeIds], {})
    }

    const pendingNodeIds: string[] = []
    const statuses: Record<string, DemGroundCollisionSourceStatus> = {}
    const progressValues: Array<number | null> = []
    nodeIds.forEach((nodeId) => {
      const stats = getStats(nodeId)
      const result = resolveSourceStatus({
        nodeId,
        resolveSourceObject: params.resolveSourceObject,
        getStats: () => stats,
      })
      statuses[nodeId] = result.status
      const rawProgress = params.getProgress
        ? params.getProgress(nodeId, stats)
        : stats?.progress
      progressValues.push(
        typeof rawProgress === 'number' && Number.isFinite(rawProgress)
          ? Math.max(0, Math.min(1, rawProgress))
          : null,
      )
      if (result.skipped) {
        skippedNodeIds.add(nodeId)
        return
      }
      if (!result.ready) {
        pendingNodeIds.push(nodeId)
      }
    })

    if (pendingNodeIds.length === 0) {
      return buildResult('ready', [], statuses)
    }

    const pendingSignature = nodeIds
      .map((nodeId, index) => {
        const progress = progressValues[index]
        return `${nodeId}:${statuses[nodeId] ?? ''}:${
          progress == null
            ? ''
            : Math.round(progress / DEM_GROUND_COLLISION_READY_PROGRESS_EPSILON)
        }`
      })
      .join('|')
    if (pendingSignature !== lastPendingSignature) {
      lastPendingSignature = pendingSignature
      lastActivityAt = now()
      params.onPending?.(pendingNodeIds, statuses)
    }

    if (now() - lastActivityAt >= stallTimeoutMs) {
      return buildResult('timeout', pendingNodeIds, statuses)
    }
    await sleep(pollIntervalMs)
  }
}
