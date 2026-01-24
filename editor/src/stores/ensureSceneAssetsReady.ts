import type { WatchStopHandle } from 'vue'
import type { Object3D } from 'three'
import type { SceneNode } from '@harmony/schema'
import type { EnsureSceneAssetsOptions } from '@/types/ensure-scene-assets-options'
import type { ProjectAsset } from '@/types/project-asset'
import type { ModelInstanceGroup } from '@schema/modelObjectCache'

type WatchFn = typeof import('vue').watch

type AssetLoadError = { assetId: string; message: string }

type RuntimeBuildResult = { node: SceneNode; runtimeObject: Object3D }

type OverlayController = {
  showLoadingOverlay: (options: {
    title: string
    message: string
    mode: 'determinate' | 'indeterminate'
    progress: number
    closable: boolean
    autoClose: boolean
    autoCloseDelay?: number
  }) => void
  updateLoadingOverlay: (options: {
    title?: string
    message?: string
    mode?: 'determinate' | 'indeterminate'
    progress?: number
    closable?: boolean
    autoClose?: boolean
    autoCloseDelay?: number
  }) => void
  updateLoadingProgress: (percent: number, options: { autoClose: boolean; autoCloseDelay?: number }) => void
  hideLoadingOverlay: (force?: boolean) => void
}

type AssetCacheEntryLike = {
  status: string
  progress?: number
  filename?: string | null
  downloadUrl?: string | null
  error?: string | null
}

type AssetCacheLike = {
  getEntry: (assetId: string) => AssetCacheEntryLike
  hasCache: (assetId: string) => boolean
  touch: (assetId: string) => void
  loadFromIndexedDb: (assetId: string) => Promise<unknown>
  downloadAsset: (assetId: string, downloadUrl: string, label: string) => Promise<unknown>
  createFileFromCache: (assetId: string) => File | null
  releaseInMemoryBlob: (assetId: string) => void
}

type PrefabProgressEntry = {
  active: boolean
  progress: number
  error: string | null
  assetIds: string[]
}

type PrefabProgressCallbacks = {
  init: (key: string, entry: PrefabProgressEntry) => void
  update: (key: string, entry: PrefabProgressEntry) => void
  finalize: (key: string, entry: PrefabProgressEntry) => void
  clear: (key: string) => void
}

export async function updateSceneAssets(args: {
  options: EnsureSceneAssetsOptions
  defaultNodes: SceneNode[]

  assetCache: AssetCacheLike
  ui: OverlayController
  watch: WatchFn

  getAsset: (assetId: string) => ProjectAsset | null
  collectNodesByAssetId: (nodes: SceneNode[]) => Map<string, SceneNode[]>

  // model/object helpers
  getCachedModelObject: (assetId: string) => ModelInstanceGroup | null
  getOrLoadModelObject: (assetId: string, loader: () => Promise<Object3D>) => Promise<ModelInstanceGroup>
  loadObjectFromFile: (file: File, extension?: string) => Promise<Object3D>

  // runtime building helpers
  createInstancedRuntimeProxy: (node: SceneNode, group: ModelInstanceGroup, sourceAssetId?: string) => Object3D | null
  findObjectByPath: (root: Object3D, path: number[]) => Object3D | null
  pruneCloneByRelativePaths: (root: Object3D, relativePaths: number[][]) => void
  isPathAncestor: (base: number[], candidate: number[]) => boolean

  // runtime registration stays in sceneStore.ts
  registerRuntimeForNode: (node: SceneNode, runtimeObject: Object3D) => void

  // patching/version bump
  queueSceneNodePatch: (nodeId: string, fields: string[], options: { bumpVersion: boolean }) => boolean

  prefabProgress: PrefabProgressCallbacks
}): Promise<{ queuedRuntimeRefreshPatches: boolean }> {
  const {
    options,
    defaultNodes,
    assetCache,
    ui,
    watch,
    getAsset,
    collectNodesByAssetId,
    getCachedModelObject,
    getOrLoadModelObject,
    loadObjectFromFile,
    createInstancedRuntimeProxy,
    findObjectByPath,
    pruneCloneByRelativePaths,
    isPathAncestor,
    registerRuntimeForNode,
    queueSceneNodePatch,
    prefabProgress,
  } = args

  const normalizeUrl = (value: string | null | undefined): string | null => {
    if (!value) {
      return null
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  const clampPercent = (value: unknown): number => {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0
    return Math.max(0, Math.min(100, Math.round(numeric)))
  }

  const targetNodes = Array.isArray(options.nodes) ? options.nodes : defaultNodes
  if (!targetNodes.length) {
    if (options.showOverlay) {
      ui.hideLoadingOverlay(true)
    }
    return { queuedRuntimeRefreshPatches: false }
  }

  const assetNodeMap = collectNodesByAssetId(targetNodes)
  if (assetNodeMap.size === 0) {
    if (options.showOverlay) {
      ui.hideLoadingOverlay(true)
    }
    return { queuedRuntimeRefreshPatches: false }
  }

  const shouldShowOverlay = options.showOverlay ?? true
  const refreshViewport = options.refreshViewport ?? options.nodes === undefined

  const prefabProgressKey = typeof options.prefabAssetIdForDownloadProgress === 'string'
    ? options.prefabAssetIdForDownloadProgress.trim()
    : ''
  const shouldReportPrefabProgress = prefabProgressKey.length > 0

  const trackedAssetIds = shouldReportPrefabProgress ? Array.from(assetNodeMap.keys()) : []
  let stopPrefabProgressWatcher: WatchStopHandle | null = null
  let prefabProgressEntry: PrefabProgressEntry | null = null

  const computePrefabAggregateProgress = (assetIds: string[]): {
    active: boolean
    progress: number
    error: string | null
  } => {
    if (!assetIds.length) {
      return { active: false, progress: 100, error: null }
    }
    let sum = 0
    let missing = 0
    let downloading = 0
    let errorCount = 0
    let firstError: string | null = null

    for (const id of assetIds) {
      const entry = assetCache.getEntry(id)
      const cached = assetCache.hasCache(id) || entry?.status === 'cached'
      if (cached) {
        sum += 100
        continue
      }
      if (entry?.status === 'downloading') {
        downloading += 1
        sum += clampPercent(entry.progress)
        continue
      }
      if (entry?.status === 'error') {
        errorCount += 1
        if (!firstError) {
          firstError = entry.error ?? '资源下载失败'
        }
        // Treat errored assets as 0% for aggregate.
        sum += 0
        continue
      }
      // Not cached yet; download may start later in the loop.
      missing += 1
      sum += 0
    }

    const progress = Math.round(sum / assetIds.length)
    const active = downloading > 0 || missing > 0
    const error = errorCount > 0
      ? (errorCount === 1 ? firstError : `${errorCount} assets failed`)
      : null
    return { active, progress, error }
  }

  const startPrefabAggregateProgressWatcher = (assetIds: string[], key: string): WatchStopHandle => {
    return watch(
      () =>
        assetIds.map((id) => {
          const entry = assetCache.getEntry(id)
          return [entry?.status ?? 'idle', entry?.progress ?? 0, entry?.error ?? null] as const
        }),
      () => {
        const next = computePrefabAggregateProgress(assetIds)
        if (!prefabProgressEntry) {
          return
        }
        prefabProgressEntry = {
          ...prefabProgressEntry,
          active: next.active,
          progress: next.progress,
          error: next.error,
        }
        prefabProgress.update(key, prefabProgressEntry)
      },
      { immediate: true },
    )
  }

  const startAssetDownloadOverlayWatcher = (watchArgs: {
    assetId: string
    assetLabel: string
    completedBeforeAsset: number
    overlayTotal: number
  }): WatchStopHandle => {
    return watch(
      () => {
        const current = assetCache.getEntry(watchArgs.assetId)
        return [current.status, current.progress, current.filename] as const
      },
      ([status, progress, filename]) => {
        if (status !== 'downloading') {
          return
        }
        const numericProgress = typeof progress === 'number' && Number.isFinite(progress) ? progress : 0
        const normalizedProgress = Math.max(0, Math.round(numericProgress))
        const displayName = filename?.trim() || watchArgs.assetLabel
        const aggregateProgress = Math.max(
          0,
          Math.min(100, Math.round(((watchArgs.completedBeforeAsset + normalizedProgress / 100) / watchArgs.overlayTotal) * 100)),
        )
        ui.updateLoadingOverlay({
          message: `Downloading asset: ${displayName} (${normalizedProgress}%)`,
          progress: aggregateProgress,
          mode: 'determinate',
        })
        ui.updateLoadingProgress(aggregateProgress, { autoClose: false })
      },
      { immediate: true },
    )
  }

  const ensureEntryDownloadUrl = (entry: { downloadUrl?: string | null }, fallbackDownloadUrl: string | null) => {
    if (!normalizeUrl(entry.downloadUrl) && fallbackDownloadUrl) {
      entry.downloadUrl = fallbackDownloadUrl
    }
  }

  const resolveAssetBaseObject = async (resolveArgs: {
    assetId: string
    assetLabel: string
    fallbackDownloadUrl: string | null
    shouldCacheModelObject: boolean
    completedBeforeAsset: number
    overlayTotal: number
  }): Promise<{ baseObjectResolved: Object3D; modelGroup: ModelInstanceGroup | null; canUseInstancing: boolean }> => {
    const { assetId, assetLabel, fallbackDownloadUrl, shouldCacheModelObject, completedBeforeAsset, overlayTotal } = resolveArgs

    let modelGroup: ModelInstanceGroup | null = null
    let baseObject: Object3D | null = null

    if (shouldCacheModelObject) {
      const cachedGroup = getCachedModelObject(assetId)
      if (cachedGroup) {
        modelGroup = cachedGroup
        baseObject = cachedGroup.object
        assetCache.touch(assetId)
      }
    }

    let stopDownloadWatcher: WatchStopHandle | null = null
    if (!baseObject) {
      let entry = assetCache.getEntry(assetId)
      ensureEntryDownloadUrl(entry, fallbackDownloadUrl)

      if (entry.status !== 'cached') {
        await assetCache.loadFromIndexedDb(assetId)
        entry = assetCache.getEntry(assetId)
        ensureEntryDownloadUrl(entry, fallbackDownloadUrl)
      }

      const downloadUrl = normalizeUrl(entry?.downloadUrl) ?? fallbackDownloadUrl

      try {
        if (!assetCache.hasCache(assetId)) {
          if (!downloadUrl) {
            throw new Error('Missing asset download URL')
          }

          if (shouldShowOverlay) {
            stopDownloadWatcher = startAssetDownloadOverlayWatcher({
              assetId,
              assetLabel,
              completedBeforeAsset,
              overlayTotal,
            })
          }

          await assetCache.downloadAsset(assetId, downloadUrl, assetLabel)
          if (shouldShowOverlay) {
            ui.updateLoadingOverlay({
              message: `Loading asset: ${assetLabel}`,
            })
          }
        } else {
          assetCache.touch(assetId)
        }
      } finally {
        stopDownloadWatcher?.()
      }

      const file = assetCache.createFileFromCache(assetId)
      if (!file) {
        throw new Error('Missing asset file in cache')
      }

      if (shouldCacheModelObject) {
        const loadedGroup = await getOrLoadModelObject(assetId, () => loadObjectFromFile(file, getAsset(assetId)?.extension ?? undefined))
        modelGroup = loadedGroup
        baseObject = loadedGroup.object
        assetCache.releaseInMemoryBlob(assetId)
      } else {
        baseObject = await loadObjectFromFile(file, getAsset(assetId)?.extension ?? undefined)
      }
    }

    if (!baseObject) {
      throw new Error('Failed to resolve base object')
    }

    const baseObjectResolved = modelGroup?.object ?? baseObject
    const canUseInstancing = Boolean(modelGroup?.meshes.length)
    return { baseObjectResolved, modelGroup, canUseInstancing }
  }

  const buildRuntimeObjectsForAssetNodes = (buildArgs: {
    nodesForAsset: SceneNode[]
    baseObjectResolved: Object3D
    modelGroup: ModelInstanceGroup | null
    canUseInstancing: boolean
    shouldCacheModelObject: boolean
  }): RuntimeBuildResult[] => {
    const { nodesForAsset, baseObjectResolved, modelGroup, canUseInstancing, shouldCacheModelObject } = buildArgs

    const metadataEntries = nodesForAsset
      .map((node) => {
        const metadata = node.importMetadata
        return metadata && Array.isArray(metadata.objectPath)
          ? { node, path: metadata.objectPath }
          : null
      })
      .filter((entry): entry is { node: SceneNode; path: number[] } => Boolean(entry))

    const descendantCache = new Map<string, number[][]>()
    metadataEntries.forEach((entry) => {
      const basePath = entry.path
      const key = basePath.join('.')
      const descendants: number[][] = []
      metadataEntries.forEach((candidate) => {
        if (candidate === entry) {
          return
        }
        if (isPathAncestor(basePath, candidate.path)) {
          descendants.push(candidate.path.slice(basePath.length))
        }
      })
      descendantCache.set(key, descendants)
    })

    let baseObjectAssigned = false
    const results: RuntimeBuildResult[] = []

    nodesForAsset.forEach((node) => {
      const metadata = node.importMetadata
      let runtimeObject: Object3D | null = null

      if (!runtimeObject && canUseInstancing && !metadata && modelGroup) {
        runtimeObject = createInstancedRuntimeProxy(node, modelGroup) ?? null
      }

      if (metadata && Array.isArray(metadata.objectPath)) {
        const target = findObjectByPath(baseObjectResolved, metadata.objectPath) ?? baseObjectResolved
        runtimeObject = target.clone(true)
        const descendantKey = metadata.objectPath.join('.')
        const descendantPaths = descendantCache.get(descendantKey) ?? []
        pruneCloneByRelativePaths(runtimeObject, descendantPaths)
      } else if (!runtimeObject) {
        const reuseOriginal = !shouldCacheModelObject && !baseObjectAssigned
        runtimeObject = reuseOriginal ? baseObjectResolved : baseObjectResolved.clone(true)
        baseObjectAssigned = baseObjectAssigned || reuseOriginal
      }

      if (!runtimeObject) {
        throw new Error('Failed to create runtime object')
      }

      runtimeObject.name = node.name ?? runtimeObject.name
      results.push({ node, runtimeObject })
    })

    return results
  }

  if (shouldReportPrefabProgress) {
    prefabProgressEntry = {
      active: true,
      progress: 0,
      error: null,
      assetIds: trackedAssetIds,
    }
    prefabProgress.init(prefabProgressKey, prefabProgressEntry)
    stopPrefabProgressWatcher = startPrefabAggregateProgressWatcher(trackedAssetIds, prefabProgressKey)
  }

  if (shouldShowOverlay) {
    ui.showLoadingOverlay({
      title: 'Loading Scene Assets',
      message: 'Preparing assets…',
      mode: 'determinate',
      progress: 0,
      closable: false,
      autoClose: false,
    })
  }

  const total = assetNodeMap.size
  let completed = 0
  const errors: AssetLoadError[] = []
  let queuedRuntimeRefreshPatches = false

  try {
    for (const [assetId, nodesForAsset] of assetNodeMap.entries()) {
      const asset = getAsset(assetId)
      const assetLabel = normalizeUrl(asset?.name) ?? nodesForAsset[0]?.name ?? assetId
      const fallbackDownloadUrl = normalizeUrl(asset?.downloadUrl) ?? normalizeUrl(asset?.description)

      try {
        if (shouldShowOverlay) {
          ui.updateLoadingOverlay({
            message: `Loading asset: ${assetLabel}`,
          })
        }

        const shouldCacheModelObject = asset?.type === 'model' || asset?.type === 'mesh'
        const completedBeforeAsset = completed
        const overlayTotal = total > 0 ? total : 1

        const { baseObjectResolved, modelGroup, canUseInstancing } = await resolveAssetBaseObject({
          assetId,
          assetLabel,
          fallbackDownloadUrl,
          shouldCacheModelObject,
          completedBeforeAsset,
          overlayTotal,
        })

        const runtimeObjects = buildRuntimeObjectsForAssetNodes({
          nodesForAsset,
          baseObjectResolved,
          modelGroup,
          canUseInstancing,
          shouldCacheModelObject,
        })

        runtimeObjects.forEach(({ node, runtimeObject }) => {
          registerRuntimeForNode(node, runtimeObject)
        })
      } catch (error) {
        const message = (error as Error).message ?? 'Unknown error'
        errors.push({ assetId, message })
        console.warn(`Failed to load asset ${assetId}`, error)
        if (shouldShowOverlay) {
          ui.updateLoadingOverlay({
            message: `Failed to load asset ${assetLabel}: ${message}`,
            closable: true,
            autoClose: false,
          })
        }
      } finally {
        completed += 1
        if (shouldShowOverlay) {
          const percent = Math.round((completed / total) * 100)
          ui.updateLoadingProgress(percent, { autoClose: false })
        }
      }
    }
  } finally {
    stopPrefabProgressWatcher?.()
    if (shouldReportPrefabProgress) {
      const next = computePrefabAggregateProgress(trackedAssetIds)
      if (errors.length > 0) {
        const base: PrefabProgressEntry = prefabProgressEntry ?? {
          active: false,
          progress: next.progress,
          error: next.error,
          assetIds: trackedAssetIds,
        }
        prefabProgressEntry = {
          ...base,
          active: false,
          progress: next.progress,
          error: errors.length === 1 ? errors[0]?.message ?? next.error : `${errors.length} assets failed`,
          assetIds: trackedAssetIds,
        }
        prefabProgress.finalize(prefabProgressKey, prefabProgressEntry)
      } else {
        prefabProgressEntry = null
        prefabProgress.clear(prefabProgressKey)
      }
    }
  }

  if (shouldShowOverlay) {
    if (errors.length === 0) {
      ui.updateLoadingOverlay({
        message: 'Assets loaded successfully',
        autoClose: true,
        autoCloseDelay: 600,
      })
      ui.updateLoadingProgress(100, { autoClose: true, autoCloseDelay: 600 })
    } else {
      ui.updateLoadingOverlay({
        message: `${errors.length} assets failed to load. Please check the logs.`,
        closable: true,
        autoClose: false,
      })
      ui.updateLoadingProgress(100, { autoClose: false })
    }
  }

  if (errors.length === 0 && refreshViewport) {
    // Avoid forcing a full scene graph reconcile.
    // Signal consumers (viewport) to refresh/recreate affected runtime objects incrementally.
    let queued = false
    assetNodeMap.forEach((nodesForAsset) => {
      nodesForAsset.forEach((node) => {
        const ok = queueSceneNodePatch(node.id, ['runtime'], { bumpVersion: false })
        queued = queued || ok
      })
    })
    if (queued) {
      queuedRuntimeRefreshPatches = true
    }
  }

  return { queuedRuntimeRefreshPatches }
}
