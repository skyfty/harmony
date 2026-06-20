import type { WatchStopHandle } from 'vue'
import type { Object3D } from 'three'
import type { SceneAssetRegistryEntry, SceneNode } from '@schema/core'
import { cloneImportedObject } from '@schema/assetImport'
import { canNodeUseRuntimeModelInstancing } from '@schema/runtimeModelInstancing'
import { readServerDownloadBaseUrl } from '@/api/serverApiConfig'
import type { EnsureSceneAssetsOptions, EnsureSceneAssetsProgress } from '@/types/ensure-scene-assets-options'
import type { ProjectAsset } from '@/types/project-asset'
import type { ModelInstanceGroup } from '@schema/modelObjectCache'
import { resolveServerAssetDownloadUrl } from '@schema/core'
import {
  collectRuntimeModelNodesByAssetId,
  collectSceneNodeDependencyAssetIds,
} from '@/utils/sceneAssetCollectors'

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
  restoreAssetEntry: (assetId: string) => Promise<unknown>
  downloadAsset: (assetId: string, downloadUrl: string, label: string) => Promise<unknown>
  createFileFromCache: (assetId: string) => File | null
  ensureAssetFile: (assetId: string, options?: { asset?: ProjectAsset | null }) => Promise<File | null>
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
  getAssetRegistryEntry: (assetId: string) => SceneAssetRegistryEntry | null

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
    getAssetRegistryEntry,
  } = args

  const normalizeUrl =    (value: string | null | undefined): string | null => {
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

  const formatDebugLog = (title: string, payload: Record<string, unknown>): string => {
    try {
      return `${title}\n${JSON.stringify(payload, null, 2)}`
    } catch (error) {
      return `${title}\n{"error":"Failed to stringify debug payload","message":"${(error as Error)?.message ?? String(error)}"}`
    }
  }

  const describeAsset = (asset: ProjectAsset | null): Record<string, unknown> => {
    if (!asset) {
      return { asset: null }
    }
    return {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      extension: asset.extension ?? null,
      downloadUrl: normalizeUrl(asset.downloadUrl) ?? null,
      description: normalizeUrl(asset.description) ?? asset.description ?? null,
      fileKey: asset.fileKey ?? null,
      source: asset.source ? { ...asset.source } : null,
      internal: asset.internal ?? null,
      gleaned: asset.gleaned ?? null,
    }
  }

  const describeRegistryEntry = (entry: SceneAssetRegistryEntry | null): Record<string, unknown> => {
    if (!entry) {
      return { registryEntry: null }
    }
    switch (entry.sourceType) {
      case 'server':
        return {
          sourceType: entry.sourceType,
          serverAssetId: entry.serverAssetId ?? null,
          fileKey: entry.fileKey ?? null,
          resolvedUrl: normalizeUrl(entry.resolvedUrl) ?? null,
          bytes: entry.bytes ?? null,
          assetType: entry.assetType ?? null,
          name: entry.name ?? null,
        }
      case 'package':
        return {
          sourceType: entry.sourceType,
          zipPath: entry.zipPath,
          inline: entry.inline ?? null,
          bytes: entry.bytes ?? null,
          assetType: entry.assetType ?? null,
          name: entry.name ?? null,
        }
      case 'url':
        return {
          sourceType: entry.sourceType,
          url: normalizeUrl(entry.url) ?? null,
          bytes: entry.bytes ?? null,
          assetType: entry.assetType ?? null,
          name: entry.name ?? null,
        }
      default:
        return { registryEntry: 'unknown' }
    }
  }

  const describeCacheEntry = (entry: AssetCacheEntryLike | null | undefined): Record<string, unknown> => {
    if (!entry) {
      return { cacheEntry: null }
    }
    return {
      status: entry.status,
      progress: typeof entry.progress === 'number' && Number.isFinite(entry.progress) ? entry.progress : null,
      filename: entry.filename ?? null,
      downloadUrl: normalizeUrl(entry.downloadUrl) ?? null,
      error: entry.error ?? null,
    }
  }

  const emitProgress = (payload: EnsureSceneAssetsProgress) => {
    options.onProgress?.({
      ...payload,
      progress: clampPercent(payload.progress),
      completed: Math.max(0, Math.trunc(payload.completed)),
      total: Math.max(0, Math.trunc(payload.total)),
    })
  }

  const targetNodes = Array.isArray(options.nodes) ? options.nodes : defaultNodes
  if (!targetNodes.length) {
    emitProgress({
      step: 'Scene assets ready',
      detail: 'No scene assets need loading.',
      progress: 100,
      completed: 0,
      total: 0,
    })
    if (options.showOverlay) {
      ui.hideLoadingOverlay(true)
    }
    return { queuedRuntimeRefreshPatches: false }
  }

  const runtimeAssetNodeMap = collectRuntimeModelNodesByAssetId(targetNodes)
  const dependencyAssetIds = collectSceneNodeDependencyAssetIds(targetNodes)
  const allAssetIds = Array.from(new Set<string>([
    ...runtimeAssetNodeMap.keys(),
    ...dependencyAssetIds,
  ]))

  if (allAssetIds.length === 0) {
    emitProgress({
      step: 'Scene assets ready',
      detail: 'No referenced assets found in the scene.',
      progress: 100,
      completed: 0,
      total: 0,
    })
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

  const trackedAssetIds = shouldReportPrefabProgress ? allAssetIds : []
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
        emitProgress({
          step: 'Downloading scene assets',
          detail: `${displayName} (${normalizedProgress}%)`,
          progress: aggregateProgress,
          completed: watchArgs.completedBeforeAsset,
          total: watchArgs.overlayTotal,
          assetId: watchArgs.assetId,
        })
        if (shouldShowOverlay) {
          ui.updateLoadingOverlay({
            message: `Downloading asset: ${displayName} (${normalizedProgress}%)`,
            progress: aggregateProgress,
            mode: 'determinate',
          })
          ui.updateLoadingProgress(aggregateProgress, { autoClose: false })
        }
      },
      { immediate: true },
    )
  }

  const ensureEntryDownloadUrl = (entry: { downloadUrl?: string | null }, fallbackDownloadUrl: string | null) => {
    if (!normalizeUrl(entry.downloadUrl) && fallbackDownloadUrl) {
      entry.downloadUrl = fallbackDownloadUrl
    }
  }

  const resolveAssetDownloadUrlCandidate = (
    asset: ProjectAsset | null,
    registryEntry: SceneAssetRegistryEntry | null,
  ): string | null => {
    const directCandidate = normalizeUrl(asset?.downloadUrl) ?? normalizeUrl(asset?.description)
    if (registryEntry?.sourceType === 'url') {
      return normalizeUrl(registryEntry.url) ?? directCandidate
    }
    if (registryEntry?.sourceType === 'server') {
      return resolveServerAssetDownloadUrl({
        assetBaseUrl: readServerDownloadBaseUrl(),
        fileKey: typeof registryEntry.fileKey === 'string' && registryEntry.fileKey.trim().length > 0
          ? registryEntry.fileKey
          : asset?.fileKey ?? null,
        resolvedUrl: registryEntry.resolvedUrl ?? null,
        downloadUrl: directCandidate,
      }) ?? directCandidate
    }
    return directCandidate
  }

  const ensureAssetCached = async (resolveArgs: {
    assetId: string
    assetLabel: string
    completedBeforeAsset: number
    overlayTotal: number
  }): Promise<void> => {
    const { assetId, assetLabel, completedBeforeAsset, overlayTotal } = resolveArgs
    const asset = getAsset(assetId)
    const registryEntry = getAssetRegistryEntry(assetId)
    const fallbackDownloadUrl = resolveAssetDownloadUrlCandidate(asset, registryEntry)
    let entry = assetCache.getEntry(assetId)
    ensureEntryDownloadUrl(entry, fallbackDownloadUrl)

    if (entry.status !== 'cached') {
      await assetCache.restoreAssetEntry(assetId)
      entry = assetCache.getEntry(assetId)
      ensureEntryDownloadUrl(entry, fallbackDownloadUrl)
    }

    const downloadUrl = normalizeUrl(entry?.downloadUrl) ?? fallbackDownloadUrl
    if (!assetCache.hasCache(assetId)) {
      if (!downloadUrl) {
        console.warn(formatDebugLog('[ensureSceneAssetsReady] Missing asset download URL', {
          assetId,
          assetLabel,
          completedBeforeAsset,
          overlayTotal,
          asset: describeAsset(asset),
          registryEntry: describeRegistryEntry(registryEntry),
          cacheEntry: describeCacheEntry(entry),
          resolved: {
            fallbackDownloadUrl: fallbackDownloadUrl ?? null,
            entryDownloadUrl: normalizeUrl(entry?.downloadUrl) ?? null,
            hasCache: assetCache.hasCache(assetId),
          },
        }))
        throw new Error('Missing asset download URL')
      }
      let stopDownloadWatcher: WatchStopHandle | null = null
      try {
        if (shouldShowOverlay || typeof options.onProgress === 'function') {
          stopDownloadWatcher = startAssetDownloadOverlayWatcher({
            assetId,
            assetLabel,
            completedBeforeAsset,
            overlayTotal,
          })
        }
        await assetCache.downloadAsset(assetId, downloadUrl, assetLabel)
      } finally {
        stopDownloadWatcher?.()
      }
      return
    }

    assetCache.touch(assetId)
  }

  const resolveAssetBaseObject = async (resolveArgs: {
    assetId: string
    shouldCacheModelObject: boolean
  }): Promise<{ baseObjectResolved: Object3D; modelGroup: ModelInstanceGroup | null; canUseInstancing: boolean }> => {
    const { assetId, shouldCacheModelObject } = resolveArgs

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

    if (!baseObject) {
      const file = await assetCache.ensureAssetFile(assetId, { asset: getAsset(assetId) })
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

      if (!runtimeObject && canUseInstancing && !metadata && modelGroup && canNodeUseRuntimeModelInstancing(node)) {
        runtimeObject = createInstancedRuntimeProxy(node, modelGroup) ?? null
      }

      if (metadata && Array.isArray(metadata.objectPath)) {
        const target = findObjectByPath(baseObjectResolved, metadata.objectPath) ?? baseObjectResolved
        runtimeObject = cloneImportedObject(target)
        const descendantKey = metadata.objectPath.join('.')
        const descendantPaths = descendantCache.get(descendantKey) ?? []
        pruneCloneByRelativePaths(runtimeObject, descendantPaths)
      } else if (!runtimeObject) {
        const reuseOriginal = !shouldCacheModelObject && !baseObjectAssigned
        runtimeObject = reuseOriginal ? baseObjectResolved : cloneImportedObject(baseObjectResolved)
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

  const total = allAssetIds.length
  let completed = 0
  const errors: AssetLoadError[] = []
  let queuedRuntimeRefreshPatches = false

  emitProgress({
    step: 'Preparing scene assets',
    detail: `${total} assets queued for loading.`,
    progress: 0,
    completed: 0,
    total,
  })

  try {
    for (const assetId of allAssetIds) {
      const nodesForAsset = runtimeAssetNodeMap.get(assetId) ?? []
      const shouldBuildRuntime = nodesForAsset.length > 0
      const asset = getAsset(assetId)
      const assetLabel = normalizeUrl(asset?.name) ?? nodesForAsset[0]?.name ?? assetId

      try {
        emitProgress({
          step: 'Loading scene assets',
          detail: `${assetLabel} (${completed + 1}/${total})`,
          progress: total > 0 ? Math.round((completed / total) * 100) : 100,
          completed,
          total,
          assetId,
        })
        if (shouldShowOverlay) {
          ui.updateLoadingOverlay({
            message: `Loading asset: ${assetLabel}`,
          })
        }

        const shouldCacheModelObject = shouldBuildRuntime && (asset?.type === 'model' || asset?.type === 'mesh')
        const completedBeforeAsset = completed
        const overlayTotal = total > 0 ? total : 1

        await ensureAssetCached({
          assetId,
          assetLabel,
          completedBeforeAsset,
          overlayTotal,
        })

        // Component/material dependencies should be prefetched but do not produce runtime objects.
        if (!shouldBuildRuntime) {
          emitProgress({
            step: 'Prepared scene dependency',
            detail: assetLabel,
            progress: total > 0 ? Math.round(((completed + 1) / total) * 100) : 100,
            completed: completed + 1,
            total,
            assetId,
          })
          continue
        }

        const { baseObjectResolved, modelGroup, canUseInstancing } = await resolveAssetBaseObject({
          assetId,
          shouldCacheModelObject,
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
        const failedAsset = getAsset(assetId)
        const failedRegistryEntry = getAssetRegistryEntry(assetId)
        const failedCacheEntry = assetCache.getEntry(assetId)
        const failedFallbackDownloadUrl = resolveAssetDownloadUrlCandidate(failedAsset, failedRegistryEntry)
        console.warn(formatDebugLog('[ensureSceneAssetsReady] Failed to load asset', {
          assetId,
          assetLabel,
          message,
          errorName: error instanceof Error ? error.name : null,
          errorStack: error instanceof Error ? error.stack ?? null : null,
          asset: describeAsset(failedAsset),
          registryEntry: describeRegistryEntry(failedRegistryEntry),
          cacheEntry: describeCacheEntry(failedCacheEntry),
          resolved: {
            fallbackDownloadUrl: failedFallbackDownloadUrl ?? null,
            entryDownloadUrl: normalizeUrl(failedCacheEntry?.downloadUrl) ?? null,
            hasCache: assetCache.hasCache(assetId),
          },
        }))
        emitProgress({
          step: 'Scene asset failed',
          detail: `${assetLabel}: ${message}`,
          progress: total > 0 ? Math.round((completed / total) * 100) : 100,
          completed,
          total,
          assetId,
        })
        if (shouldShowOverlay) {
          ui.updateLoadingOverlay({
            message: `Failed to load asset ${assetLabel}: ${message}`,
            closable: true,
            autoClose: false,
          })
        }
      } finally {
        completed += 1
        emitProgress({
          step: errors.length === 0 ? 'Scene assets readying' : 'Continuing after asset error',
          detail: `${completed}/${total} assets processed.`,
          progress: total > 0 ? Math.round((completed / total) * 100) : 100,
          completed,
          total,
          assetId,
        })
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
    runtimeAssetNodeMap.forEach((nodesForAsset) => {
      nodesForAsset.forEach((node) => {
        const ok = queueSceneNodePatch(node.id, ['runtime'], { bumpVersion: false })
        queued = queued || ok
      })
    })
    if (queued) {
      queuedRuntimeRefreshPatches = true
    }
  }

  emitProgress({
    step: errors.length === 0 ? 'Scene assets ready' : 'Scene assets completed with warnings',
    detail: errors.length === 0
      ? `${completed}/${total} assets loaded successfully.`
      : `${errors.length} assets failed to load. Check console logs for details.`,
    progress: 100,
    completed,
    total,
  })

  return { queuedRuntimeRefreshPatches }
}
