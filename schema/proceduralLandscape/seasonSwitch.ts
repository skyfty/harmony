import type { SceneNode } from '../core'
import {
  collectProceduralLandscapeCoreTexturePreloadForNodes,
  collectProceduralLandscapeTexturePreloadForNodes,
} from './preload'
import {
  getProceduralLandscapeStats,
  type ProceduralLandscapeRuntimeStats,
} from './runtime'
import {
  resolveSeasonTextureRefsByIds,
  type SeasonId,
  type SeasonTextureRef,
} from '../slowroads/core/seasonCatalog'
import {
  getSharedSlowroadsAssetStore,
  type SlowroadsAssetStore,
} from '../slowroads/assets/assetStore'

export interface SeasonAssetPreloadProgress {
  season: SeasonId
  loaded: number
  total: number
}

export interface SeasonAssetPreloadOptions {
  assetStore?: SlowroadsAssetStore
  onProgress?: (progress: SeasonAssetPreloadProgress) => void
}

export const PROCEDURAL_LANDSCAPE_SEASON_PRELOAD_TIMEOUT_MS = 30_000

export function withProceduralLandscapeSeasonPreloadTimeout<T>(
  promise: Promise<T>,
  timeoutMs = PROCEDURAL_LANDSCAPE_SEASON_PRELOAD_TIMEOUT_MS,
): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_resolve, reject) => {
    handle = setTimeout(() => {
      reject(new Error(`季节资源预载超时（${Math.round(timeoutMs / 1000)}s）`))
    }, Math.max(1, timeoutMs))
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (handle !== null) {
      clearTimeout(handle)
      handle = null
    }
  })
}

export interface SeasonAssetPreloadResult {
  season: SeasonId
  refs: SeasonTextureRef[]
  textures: Map<string, import('three').Texture>
  missingIds: string[]
  coreMissingIds: string[]
}

/**
 * Warm every texture that active procedural landscapes may bind for the target
 * season. The shared asset store deduplicates in-flight requests, so the
 * landscape runtime reuses these textures instead of downloading them again.
 */
export async function preloadProceduralLandscapeSeasonAssets(
  nodes: SceneNode[] | null | undefined,
  season: SeasonId,
  options: SeasonAssetPreloadOptions = {},
): Promise<SeasonAssetPreloadResult> {
  const preload = collectProceduralLandscapeTexturePreloadForNodes(nodes, season)
  const corePreload = collectProceduralLandscapeCoreTexturePreloadForNodes(nodes, season)
  const allIds = new Set<string>(preload?.textureIds ?? [])
  corePreload?.textureIds.forEach((id) => allIds.add(id))
  const { refs } = resolveSeasonTextureRefsByIds([...allIds].sort())
  const coreIds = new Set(corePreload?.textureIds ?? [])

  if (!refs.length) {
    options.onProgress?.({ season, loaded: 0, total: 0 })
    return {
      season,
      refs: [],
      textures: new Map(),
      missingIds: [],
      coreMissingIds: [],
    }
  }

  const assetStore = options.assetStore ?? getSharedSlowroadsAssetStore()
  const textures = await assetStore.textureSet(refs, (loaded, total) => {
    options.onProgress?.({ season, loaded, total })
  })
  const missingIds = refs.filter((ref) => !textures.has(ref.id)).map((ref) => ref.id)
  return {
    season,
    refs,
    textures,
    missingIds,
    coreMissingIds: missingIds.filter((id) => coreIds.has(id)),
  }
}

export const PROCEDURAL_LANDSCAPE_SEASON_APPLY_TIMEOUT_MS = 5_000
export const PROCEDURAL_LANDSCAPE_SEASON_APPLY_POLL_INTERVAL_MS = 100

export type ProceduralLandscapeSeasonApplyStatus = 'ready' | 'timeout' | 'aborted'

export interface ProceduralLandscapeSeasonApplyResult {
  status: ProceduralLandscapeSeasonApplyStatus
  pendingNodeIds: string[]
}

export interface WaitForProceduralLandscapeSeasonAppliedOptions {
  nodeIds: ReadonlyArray<string>
  season: SeasonId
  getStats?: (nodeId: string) => ProceduralLandscapeRuntimeStats | null
  shouldAbort?: () => boolean
  timeoutMs?: number
  pollIntervalMs?: number
  now?: () => number
  sleep?: (delayMs: number) => Promise<void>
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

/**
 * Wait until every active landscape runtime reports the target season's core
 * textures bound. This closes the gap between the download animation and the
 * actual material swap so the reveal never exposes the previous season.
 */
export async function waitForProceduralLandscapeSeasonApplied(
  options: WaitForProceduralLandscapeSeasonAppliedOptions,
): Promise<ProceduralLandscapeSeasonApplyResult> {
  const nodeIds = [...new Set(
    options.nodeIds
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean),
  )]
  if (!nodeIds.length) {
    return { status: 'ready', pendingNodeIds: [] }
  }

  const getStats = options.getStats ?? getProceduralLandscapeStats
  const shouldAbort = options.shouldAbort ?? (() => false)
  const timeoutMs = Math.max(
    0,
    options.timeoutMs ?? PROCEDURAL_LANDSCAPE_SEASON_APPLY_TIMEOUT_MS,
  )
  const pollIntervalMs = Math.max(
    1,
    options.pollIntervalMs ?? PROCEDURAL_LANDSCAPE_SEASON_APPLY_POLL_INTERVAL_MS,
  )
  const now = options.now ?? defaultNow
  const sleep = options.sleep ?? defaultSleep
  const deadline = now() + timeoutMs

  while (true) {
    if (shouldAbort()) {
      return { status: 'aborted', pendingNodeIds: [...nodeIds] }
    }
    const pendingNodeIds = nodeIds.filter((nodeId) => {
      const stats = getStats(nodeId)
      return !stats || stats.season !== options.season || !stats.seasonAssetsReady
    })
    if (!pendingNodeIds.length) {
      return { status: 'ready', pendingNodeIds: [] }
    }
    if (now() >= deadline) {
      return { status: 'timeout', pendingNodeIds }
    }
    await sleep(pollIntervalMs)
  }
}
