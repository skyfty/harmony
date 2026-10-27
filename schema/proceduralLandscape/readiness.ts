import {
  getProceduralLandscapeStats,
  type ProceduralLandscapeRuntimeStats,
} from './runtime'

export const PROCEDURAL_LANDSCAPE_SCENE_READY_TIMEOUT_MS = 30_000
export const PROCEDURAL_LANDSCAPE_SCENE_READY_POLL_INTERVAL_MS = 100
const PROCEDURAL_LANDSCAPE_SCENE_READY_PROGRESS_EPSILON = 1e-4

export type ProceduralLandscapeSceneNodeStatus =
  | 'missing-runtime'
  | 'dem-loading'
  | 'dem-building'
  | 'world-building'
  | 'textures-loading'
  | 'disabled'
  | 'error'
  | 'ready'

export interface ProceduralLandscapeSceneNodeReadiness {
  status: ProceduralLandscapeSceneNodeStatus
  ready: boolean
  failed: boolean
  stats: ProceduralLandscapeRuntimeStats | null
}

export interface ProceduralLandscapeSceneReadyOptions {
  nodeIds: ReadonlyArray<string>
  getStats?: (nodeId: string) => ProceduralLandscapeRuntimeStats | null
  getProgress?: (nodeId: string, stats: ProceduralLandscapeRuntimeStats | null) => number | null
  shouldAbort?: () => boolean
  /** Maximum time without a status or numeric-progress change. */
  stallTimeoutMs?: number
  /** Backward-compatible alias for stallTimeoutMs. */
  timeoutMs?: number
  pollIntervalMs?: number
  now?: () => number
  sleep?: (delayMs: number) => Promise<void>
  onPending?: (
    pendingNodeIds: string[],
    statuses: Record<string, ProceduralLandscapeSceneNodeStatus>,
    failedNodeIds: string[],
  ) => void
}

export interface ProceduralLandscapeSceneReadyResult {
  status: 'ready' | 'timeout' | 'aborted'
  pendingNodeIds: string[]
  failedNodeIds: string[]
  statuses: Record<string, ProceduralLandscapeSceneNodeStatus>
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

export function resolveProceduralLandscapeSceneNodeReadiness(
  stats: ProceduralLandscapeRuntimeStats | null,
): ProceduralLandscapeSceneNodeReadiness {
  if (!stats) {
    return { status: 'missing-runtime', ready: false, failed: false, stats: null }
  }
  if (stats.phase === 'error' || stats.demStatus === 'error') {
    return { status: 'error', ready: false, failed: true, stats }
  }
  if (stats.phase === 'disabled') {
    return { status: 'disabled', ready: false, failed: true, stats }
  }
  if (stats.demStatus !== 'inactive' && stats.demStatus !== 'ready') {
    return {
      status: stats.demStatus === 'building' ? 'dem-building' : 'dem-loading',
      ready: false,
      failed: false,
      stats,
    }
  }
  if (stats.phase !== 'streaming') {
    return { status: 'world-building', ready: false, failed: false, stats }
  }
  if (!stats.seasonAssetsReady) {
    return { status: 'textures-loading', ready: false, failed: false, stats }
  }
  return { status: 'ready', ready: true, failed: false, stats }
}

/**
 * Wait until every enabled procedural landscape has finished its DEM mesh,
 * initial world build and the terrain core of its current-season material bind.
 * Optional foliage/road/wall/water atlases and camera-dependent vegetation
 * streaming are intentionally outside this readiness boundary.
 */
export async function waitForProceduralLandscapeSceneReady(
  options: ProceduralLandscapeSceneReadyOptions,
): Promise<ProceduralLandscapeSceneReadyResult> {
  const nodeIds = [...new Set(
    options.nodeIds
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean),
  )]
  const getStats = options.getStats ?? getProceduralLandscapeStats
  const shouldAbort = options.shouldAbort ?? (() => false)
  const stallTimeoutMs = Math.max(
    0,
    options.stallTimeoutMs
      ?? options.timeoutMs
      ?? PROCEDURAL_LANDSCAPE_SCENE_READY_TIMEOUT_MS,
  )
  const pollIntervalMs = Math.max(
    1,
    options.pollIntervalMs ?? PROCEDURAL_LANDSCAPE_SCENE_READY_POLL_INTERVAL_MS,
  )
  const now = options.now ?? defaultNow
  const sleep = options.sleep ?? defaultSleep
  let lastActivityAt = now()
  let lastPendingSignature = ''

  const buildResult = (
    status: ProceduralLandscapeSceneReadyResult['status'],
    pendingNodeIds: string[],
    failedNodeIds: string[],
    statuses: Record<string, ProceduralLandscapeSceneNodeStatus>,
  ): ProceduralLandscapeSceneReadyResult => ({
    status,
    pendingNodeIds,
    failedNodeIds,
    statuses,
  })

  if (nodeIds.length === 0) {
    return buildResult('ready', [], [], {})
  }

  while (true) {
    if (shouldAbort()) {
      return buildResult('aborted', [...nodeIds], [], {})
    }

    const pendingNodeIds: string[] = []
    const failedNodeIds: string[] = []
    const statuses: Record<string, ProceduralLandscapeSceneNodeStatus> = {}
    const progressValues: Array<number | null> = []
    nodeIds.forEach((nodeId) => {
      const stats = getStats(nodeId)
      const readiness = resolveProceduralLandscapeSceneNodeReadiness(stats)
      statuses[nodeId] = readiness.status
      const rawProgress = options.getProgress
        ? options.getProgress(nodeId, stats)
        : stats?.progress
      progressValues.push(
        typeof rawProgress === 'number' && Number.isFinite(rawProgress)
          ? Math.max(0, Math.min(1, rawProgress))
          : null,
      )
      if (readiness.failed) {
        failedNodeIds.push(nodeId)
      } else if (!readiness.ready) {
        pendingNodeIds.push(nodeId)
      }
    })

    if (pendingNodeIds.length === 0) {
      return buildResult('ready', [], failedNodeIds, statuses)
    }

    const pendingSignature = nodeIds
      .map((nodeId, index) => {
        const progress = progressValues[index]
        return `${nodeId}:${statuses[nodeId] ?? ''}:${
          progress == null
            ? ''
            : Math.round(progress / PROCEDURAL_LANDSCAPE_SCENE_READY_PROGRESS_EPSILON)
        }`
      })
      .join('|')
    if (pendingSignature !== lastPendingSignature) {
      lastPendingSignature = pendingSignature
      lastActivityAt = now()
      options.onPending?.(pendingNodeIds, statuses, failedNodeIds)
    }

    if (now() - lastActivityAt >= stallTimeoutMs) {
      return buildResult('timeout', pendingNodeIds, failedNodeIds, statuses)
    }
    await sleep(pollIntervalMs)
  }
}
