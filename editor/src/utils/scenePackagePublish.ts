import type { ScenePackageManifestV1, ScenePackageResourceEntry } from '@schema/core'
import {
  encodeScenePackageSceneDocument,
  inferExtFromMimeType,
  SCENE_PACKAGE_FORMAT,
  SCENE_PACKAGE_VERSION,
  serializeCompiledGroundManifest,
  serializeScenePackageManifest,
  serializeGroundScatterSidecar,
  serializeGroundSplatSidecar,
  type ProjectExportBundleMetadata,
  type ProjectExportBundleProjectConfig,
  type ProjectExportBundleResourceBreakdown,
  type GroundRuntimeDynamicMesh,
  type SceneAssetRegistryEntry,
  type SceneJsonExportDocument,
  buildQuantizedTerrainRegionPackPath,
  buildQuantizedTerrainRootManifestPath,
  serializeQuantizedTerrainDatasetRootManifest,
  type SceneResourceSummary,
  type QuantizedTerrainDatasetRootManifest,
} from '@schema/core'
import { resolveDocumentGroundNode } from '@schema/groundNode'
import { GROUND_HEIGHTMAP_SIDECAR_FILENAME } from '@/utils/groundHeightSidecar'
import type { TerrainScatterStoreSnapshot } from '@schema/terrain-scatter'
import { BUILTIN_WATER_NORMAL_FILENAME, isBuiltinWaterNormalAsset } from '@/constants/builtinAssets'
import { fetchResourceAsset } from '@/api/resourceAssets'
import { mapServerAssetToProjectAsset } from '@/api/serverAssetTypes'
import type { SceneExportEventReporter } from '@/types/scene-export'
import { serializePlanningScenePackageSidecar } from '@/types/planning-package'
import { sha256Hex } from '@harmony/utils/hash'
import { useScenesStore } from '@/stores/scenesStore'
import {
  buildPackagedAssetPathMap,
  buildPlanningSidecar,
  buildEffectiveAssetRegistry,
  createScenePackageZipBlob,
  inferExtFromFilename,
  stripGroundBakedTextureAssetIds,
  jsonBytes,
  type ResolvedEmbedAsset,
} from '@/utils/scenePackageExport'
import {
  buildAssetRegistryAliasMap,
  normalizeAssetIdWithRegistry,
} from '@/utils/assetRegistryIdNormalization'
import { resolveProjectAssetExtension, shouldExcludeAssetFromRuntimeExport } from '@/utils/assetDependencySubset'
import {
  calculateRuntimeSceneResourceSummary,
  cloneSceneDocumentWithRuntimeGroundSidecars,
  buildRuntimeAssetRegistryForExport,
} from '@/stores/sceneStore'
import {
  collectPrefabAssetIdsFromSceneReferences,
  collectRuntimeRequiredConfigAssetIds,
  collectTransitiveConfigDependencyAssetIds,
} from '@/stores/sceneAssetCleanup'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { collectPunchPointsFromNodes } from './sceneExport'
import { buildRoadCollisionCompiledExport } from '@/utils/roadCollisionCompiledExport'
import {
  computeSceneCompiledGroundBuildKey,
  computeSceneCompiledGroundSourceSignature,
  ensureSceneCompiledGroundPackage,
  resolveSceneCompiledGroundPackagePaths,
} from '@/utils/sceneCompiledGroundCache'
import type { SceneAssetReferenceSummary } from './sceneAssetDiagnostics'
import { buildSceneAssetReferenceSummaryMap } from './sceneAssetDiagnostics'

interface ScenePackagePublishProjectConfig {
  id: string
  name: string
  defaultSceneId: string | null
  lastEditedSceneId: string | null
  sceneOrder: string[]
  checkpointTotal?: number
  metadata?: ProjectExportBundleMetadata
}

interface ScenePackagePublishSceneDocument {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  environment?: SceneJsonExportDocument['environment']
  nodes: SceneJsonExportDocument['nodes']
  groundSettings?: SceneJsonExportDocument['groundSettings']
  assetRegistry?: Record<string, SceneAssetRegistryEntry>
  projectOverrideAssets?: Record<string, SceneAssetRegistryEntry>
  sceneOverrideAssets?: Record<string, SceneAssetRegistryEntry>
  assetUrlOverrides?: Record<string, string>
  resourceSummary?: SceneResourceSummary
  lazyLoadMeshes?: SceneJsonExportDocument['lazyLoadMeshes']
  assetPreload?: SceneJsonExportDocument['assetPreload']
  punchPoints?: SceneJsonExportDocument['punchPoints']
  couponIds?: SceneJsonExportDocument['couponIds']
  loadProgressHints?: SceneJsonExportDocument['loadProgressHints']
  outlineMeshMap?: SceneJsonExportDocument['outlineMeshMap']
  assetCatalog?: Record<string, import('@/types/project-asset').ProjectAsset[]>
  planningData?: import('@/types/planning-scene-data').PlanningSceneData | null
}

interface ScenePackagePublishScene {
  id: string
  document: ScenePackagePublishSceneDocument
}

type ScenePackagePublishPayload = {
  project: ScenePackagePublishProjectConfig
  scenes: ScenePackagePublishScene[]
  embedAssets: boolean
  updateProgress?: (value: number, message?: string) => void
  reportEvent?: SceneExportEventReporter
}

type ScenePackagePublishZipBuildPayload = {
  project: ScenePackagePublishProjectConfig
  scenes: ScenePackagePublishScene[]
  embedAssets: boolean
  updateProgress?: (value: number, message?: string) => void
  reportEvent?: SceneExportEventReporter
}

type ScenePackagePublishZipBuildState = {
  createdAt: string
  files: Record<string, Uint8Array>
  projectPath: string
  assetCache: ReturnType<typeof useAssetCacheStore>
  scenesStore: ReturnType<typeof useScenesStore>
  manifestScenes: ScenePackagePublishSceneEntry[]
  resources: ScenePackageResourceEntry[]
  sharedAssetPathById: Map<string, string>
  projectWithCheckpointTotal: ScenePackagePublishProjectConfig
  checkpointTotal: number
  sceneReferenceSummaryMaps: Map<string, Map<string, SceneAssetReferenceSummary>>
}

type ScenePackagePublishSceneEntry = ScenePackageManifestV1['scenes'][number]

type ScenePackagePublishManifest = {
  format: typeof SCENE_PACKAGE_FORMAT
  version: typeof SCENE_PACKAGE_VERSION
  createdAt: string
  project: { path: string }
  scenes: ScenePackagePublishSceneEntry[]
  resources: ScenePackageResourceEntry[]
}

type TerrainDatasetManifest = Awaited<ReturnType<ReturnType<typeof useScenesStore>['loadTerrainDatasetManifest']>>

type PublishResourceSummaryAsset = {
  assetId?: string | null
  downloadUrl?: string | null
  mimeType?: string | null
  filename?: string | null
}

function emitSceneExportEvent(
  reportEvent: SceneExportEventReporter | undefined,
  event: Parameters<SceneExportEventReporter>[0],
): void {
  reportEvent?.(event)
}

function describeAssetName(assetId: string, filename?: string | null): string {
  const normalizedFilename = typeof filename === 'string' ? filename.trim() : ''
  if (normalizedFilename) {
    return normalizedFilename
  }
  const normalizedAssetId = typeof assetId === 'string' ? assetId.trim() : ''
  return normalizedAssetId || 'unknown-asset'
}

function describeSceneName(scene: { id: string; document?: { name?: string | null } | null }): string {
  const rawName = typeof scene.document?.name === 'string' ? scene.document.name.trim() : ''
  return rawName || scene.id
}

function resolveEmbedAssetExtensionHint(asset: import('@/types/project-asset').ProjectAsset | null | undefined): string | null {
  const extension = resolveProjectAssetExtension(asset ?? null)
  return extension || null
}

function stripGroundRuntimeUserData(groundNode: SceneJsonExportDocument['nodes'][number] | null | undefined): void {
  if (!groundNode || typeof groundNode !== 'object') {
    return
  }

  const userData = (groundNode as { userData?: Record<string, unknown> | null }).userData
  if (!userData || typeof userData !== 'object') {
    return
  }

  delete userData.compiledGroundEnabled
  delete userData.compiledGroundManifest
  delete userData.compiledGroundBuildKey
  delete userData.runtimeTerrainDatasetManifest
  delete userData.runtimeTerrainDatasetEnabled
  delete userData.runtimeTerrainHeightSampler
}

function stripLandformNodes(nodes: SceneJsonExportDocument['nodes']): void {
  if (!Array.isArray(nodes)) {
    return
  }
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (!node || typeof node !== 'object') {
      continue
    }
    const dynamicMesh = (node as { dynamicMesh?: { type?: string } | null }).dynamicMesh
    if (dynamicMesh?.type === 'Landform') {
      nodes.splice(index, 1)
      continue
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      stripLandformNodes(node.children)
      if (node.children.length === 0) {
        delete node.children
      }
    }
  }
}

function assertNoLandformNodes(nodes: SceneJsonExportDocument['nodes'], path = 'root'): void {
  if (!Array.isArray(nodes)) {
    return
  }
  nodes.forEach((node, index) => {
    if (!node || typeof node !== 'object') {
      return
    }
    const nextPath = `${path}.nodes[${index}]`
    const dynamicMesh = (node as { dynamicMesh?: { type?: string } | null }).dynamicMesh
    if (dynamicMesh?.type === 'Landform') {
      throw new Error(`Scene export still contains unsupported Landform data at ${nextPath}. Bake landforms before export.`)
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      assertNoLandformNodes(node.children, `${nextPath}.children`)
    }
  })
}

function getAssetFromCatalog(
  catalog: Record<string, import('@/types/project-asset').ProjectAsset[]> | null | undefined,
  assetId: string,
  assetAliases: ReadonlyMap<string, string> | null | undefined = null,
): import('@/types/project-asset').ProjectAsset | null {
  const normalizedAssetId = typeof assetId === 'string' ? assetId.trim() : ''
  if (!normalizedAssetId || !catalog) {
    return null
  }

  const canonicalAssetId = assetAliases?.get(normalizedAssetId) ?? normalizedAssetId
  const candidateAssetIds = new Set<string>([normalizedAssetId, canonicalAssetId])
  if (assetAliases) {
    for (const [alias, mappedAssetId] of assetAliases.entries()) {
      if (mappedAssetId === canonicalAssetId) {
        candidateAssetIds.add(alias)
      }
    }
  }

  for (const assets of Object.values(catalog)) {
    const found = assets.find((asset) => candidateAssetIds.has(asset.id))
    if (found) {
      return found
    }
  }
  return null
}

function shouldSkipRuntimeExportAsset(
  document: ScenePackagePublishSceneDocument,
  assetId: string,
  retainedConfigAssetIds: ReadonlySet<string> = new Set<string>(),
  assetAliases: ReadonlyMap<string, string> | null | undefined = null,
): boolean {
  const asset = getAssetFromCatalog(document.assetCatalog, assetId, assetAliases)
  return shouldExcludeAssetFromRuntimeExport(asset, { assetId, retainedConfigAssetIds })
}

function resolveTerrainPackagePaths(sceneId: string): {
  terrainRoot: string
  rootManifestPath: string
  regionsPath: string
} {
  const terrainRoot = `scenes/${encodeURIComponent(sceneId)}/terrain`
  return {
    terrainRoot,
    rootManifestPath: buildQuantizedTerrainRootManifestPath(terrainRoot),
    regionsPath: `${terrainRoot}/regions`,
  }
}

async function collectTerrainDatasetRegionPackFiles(options: {
  sceneId: string
  manifest: QuantizedTerrainDatasetRootManifest
  loadRegionPack: (regionKey: string) => Promise<ArrayBuffer | null>
  regionsPath: string
  files: Record<string, Uint8Array>
}): Promise<void> {
  const { sceneId, manifest, loadRegionPack, regionsPath, files } = options
  for (const region of manifest.regions ?? []) {
    const regionKey = typeof region.regionKey === 'string' ? region.regionKey.trim() : ''
    if (!regionKey) {
      continue
    }

    const regionPack = await loadRegionPack(regionKey)
    if (!regionPack) {
      throw new Error(`Missing terrain dataset region pack for scene ${sceneId} (${regionKey})`)
    }

    const regionPath = typeof region.path === 'string' && region.path.trim().length > 0
      ? region.path.trim()
      : buildQuantizedTerrainRegionPackPath(region.regionId, regionsPath)
    files[regionPath] = new Uint8Array(regionPack)
  }
}

async function buildPublishTerrainDatasetPackageFiles(
  sceneId: string,
  manifest: QuantizedTerrainDatasetRootManifest | null | undefined,
  loadRegionPack: (regionKey: string) => Promise<ArrayBuffer | null>,
): Promise<{
  rootManifestPath: string
  regionsPath: string
  manifest: QuantizedTerrainDatasetRootManifest
  files: Record<string, Uint8Array>
} | null> {
  if (!manifest) {
    return null
  }

  const normalizedSceneId = typeof sceneId === 'string' ? sceneId.trim() : ''
  if (!normalizedSceneId) {
    return null
  }

  const paths = resolveTerrainPackagePaths(normalizedSceneId)
  const files: Record<string, Uint8Array> = {
    [paths.rootManifestPath]: serializeQuantizedTerrainDatasetRootManifest(manifest),
  }

  await collectTerrainDatasetRegionPackFiles({
    sceneId: normalizedSceneId,
    manifest,
    loadRegionPack,
    regionsPath: paths.regionsPath,
    files,
  })

  return {
    rootManifestPath: paths.rootManifestPath,
    regionsPath: paths.regionsPath,
    manifest,
    files,
  }
}

function buildPublishCombinedAssetEventContext(
  assetId: string,
  scenes: ScenePackagePublishScene[],
  summaryMaps: Map<string, Map<string, SceneAssetReferenceSummary>>,
  packagedPath: string,
) {
  const matchedSummaries = scenes
    .map((scene) => ({
      sceneName: describeSceneName(scene),
      summary: summaryMaps.get(scene.id)?.get(assetId) ?? null,
    }))
    .filter((entry) => entry.summary)

  const first = matchedSummaries[0]?.summary ?? null
  const referenceLabels = matchedSummaries.flatMap((entry) =>
    entry.summary?.references.slice(0, 2).map((reference) => `${entry.sceneName} -> ${reference.path}`) ?? [],
  )
  const totalReferenceCount = matchedSummaries.reduce((sum, entry) => sum + (entry.summary?.referenceCount ?? 0), 0)
  const detail = [
    `packaged=${packagedPath}`,
    first?.assetType ? `type=${first.assetType}` : null,
    first?.sourceType ? `sourceType=${first.sourceType}` : null,
    first?.sourceLabel ? `source=${first.sourceLabel}` : null,
    totalReferenceCount > 0 ? `references=${totalReferenceCount}` : null,
    referenceLabels.length ? `paths=${referenceLabels.slice(0, 4).join(' | ')}` : null,
  ].filter((value): value is string => Boolean(value))

  return {
    assetType: first?.assetType ? String(first.assetType) : null,
    assetSourceType: first?.sourceType ? String(first.sourceType) : null,
    assetSourceLabel: first?.sourceLabel ?? null,
    assetReferenceCount: totalReferenceCount || null,
    detail: detail.join('\n') || null,
  }
}

function cloneSceneDocumentForPublishPackageExport(
  document: SceneJsonExportDocument,
): ScenePackagePublishSceneDocument {
  return cloneSceneDocumentWithRuntimeGroundSidecars(structuredClone(document) as import('@/types/stored-scene-document').StoredSceneDocument) as ScenePackagePublishSceneDocument
}

function buildPublishSceneGroundSplatSidecar(
  document: ScenePackagePublishSceneDocument,
): ArrayBuffer | null {
  const groundNode = resolveDocumentGroundNode(document)
  if (!groundNode || groundNode.dynamicMesh?.type !== 'Ground') {
    return null
  }
  const definition = groundNode.dynamicMesh as GroundRuntimeDynamicMesh
  const groundSurfaceChunks = definition.groundSurfaceChunks ?? definition.groundSplatBake?.chunkTextureMap ?? null
  if (!groundSurfaceChunks || Object.keys(groundSurfaceChunks).length <= 0) {
    return null
  }
  return serializeGroundSplatSidecar({
    groundNodeId: groundNode.id,
    revision: Number.isFinite(definition.groundSplatBake?.revision)
      ? Math.max(0, Math.trunc(Number(definition.groundSplatBake?.revision)))
      : 0,
    surfaceLayerTextureAssetIds: definition.groundSplatBake?.surfaceLayerTextureAssetIds ?? null,
    groundSurfaceChunks,
  })
}

function buildPublishSceneGroundScatterSidecar(
  document: ScenePackagePublishSceneDocument,
): ArrayBuffer | null {
  const groundNode = resolveDocumentGroundNode(document)
  if (!groundNode || groundNode.dynamicMesh?.type !== 'Ground') {
    return null
  }
  const definition = groundNode.dynamicMesh as GroundRuntimeDynamicMesh & { terrainScatter?: TerrainScatterStoreSnapshot | null }
  const terrainScatter = definition.terrainScatter ?? null
  if (!terrainScatter || !Array.isArray(terrainScatter.layers) || terrainScatter.layers.length <= 0) {
    return null
  }
  return serializeGroundScatterSidecar({
    groundNodeId: groundNode.id,
    terrainScatter,
  })
}

function collectRuntimeRetainedConfigAssetIds(
  document: ScenePackagePublishSceneDocument | null | undefined,
): Set<string> {
  if (!document || typeof document !== 'object' || !('assetCatalog' in document)) {
    return new Set<string>()
  }
  return collectRuntimeRequiredConfigAssetIds(document as import('@/types/stored-scene-document').StoredSceneDocument)
}

async function loadRetainedEmbedAssetText(options: {
  assetCatalog: Record<string, import('@/types/project-asset').ProjectAsset[]>
  assetCache: ReturnType<typeof useAssetCacheStore>
  assetId: string
}): Promise<string | null> {
  const { assetCatalog, assetCache, assetId } = options
  const asset = getAssetFromCatalog(assetCatalog, assetId)
  let file: File | null = null
  try {
    file = await assetCache.ensureAssetFile(assetId, { asset })
  } catch {
    return null
  }
  if (file) {
    return await file.text()
  }
  const cacheEntry = assetCache.getEntry(assetId)
  if (cacheEntry.status === 'cached' && cacheEntry.blob) {
    return await cacheEntry.blob.text()
  }
  return null
}

async function collectRuntimeRetainedEmbedAssetIds(
  document: ScenePackagePublishSceneDocument,
): Promise<Set<string>> {
  const retainedConfigAssetIds = collectRuntimeRetainedConfigAssetIds(document)
  if (!retainedConfigAssetIds.size) {
    return retainedConfigAssetIds
  }

  const assetCatalog = document.assetCatalog ?? {}
  const effectiveAssetRegistry = buildEffectiveAssetRegistry(document)
  const normalizeExportAssetId = (assetId: string): string | null => normalizeAssetIdWithRegistry(assetId, effectiveAssetRegistry)
  const assetCache = useAssetCacheStore()
  const transitiveDependencyIds = await collectTransitiveConfigDependencyAssetIds(
    retainedConfigAssetIds,
    assetCatalog,
    {
      loadPrefab: async (assetId) => {
        throw new Error(`Unexpected prefab traversal while collecting retained embed assets (${assetId})`)
      },
      loadConfigAssetText: async (assetId) => {
        const normalizedAssetId = normalizeExportAssetId(assetId)
        if (!normalizedAssetId) {
          return null
        }
        return await loadRetainedEmbedAssetText({
          assetCatalog,
          assetCache,
          assetId: normalizedAssetId,
        })
      },
      normalizeAssetId: normalizeExportAssetId,
    },
  )

  transitiveDependencyIds.forEach((assetId) => retainedConfigAssetIds.add(assetId))
  return retainedConfigAssetIds
}

function collectPublishScenePackageAssetIdsForExport(
  document: ScenePackagePublishSceneDocument,
  retainedConfigAssetIds: ReadonlySet<string>,
): string[] {
  const packageAssetIds = new Set<string>()
  const effectiveRegistry = buildEffectiveAssetRegistry(document)
  Object.entries(effectiveRegistry).forEach(([assetId, entry]) => {
    const normalized = typeof assetId === 'string' ? assetId.trim() : ''
    if (!normalized) {
      return
    }
    if (shouldSkipRuntimeExportAsset(document, normalized, retainedConfigAssetIds)) {
      return
    }
    if (entry.sourceType === 'package') {
      packageAssetIds.add(normalized)
    }
  })
  collectPrefabAssetIdsFromSceneReferences(document as import('@/types/stored-scene-document').StoredSceneDocument, document.assetCatalog ?? {})
    .forEach((assetId) => packageAssetIds.add(assetId))
  return Array.from(packageAssetIds)
}

async function attachPublishSceneAssetMetadata(
  editable: ScenePackagePublishSceneDocument,
): Promise<ScenePackagePublishSceneDocument> {
  const sceneDocument = editable as import('@/types/stored-scene-document').StoredSceneDocument
  editable.assetRegistry = await buildRuntimeAssetRegistryForExport(sceneDocument)
  editable.resourceSummary = await calculateRuntimeSceneResourceSummary(sceneDocument)
  const assetCatalog = editable.assetCatalog ?? {}
  const unknownAssetIds = Array.isArray(editable.resourceSummary?.unknownAssetIds) ? editable.resourceSummary.unknownAssetIds : []
  if (unknownAssetIds.length) {
    await Promise.all(unknownAssetIds.map(async (assetId) => {
      const normalized = typeof assetId === 'string' ? assetId.trim() : ''
      if (!normalized) {
        return
      }
      const registryEntry = editable.assetRegistry?.[normalized]
      const serverAssetId =
        registryEntry?.sourceType === 'server' && typeof registryEntry.serverAssetId === 'string' && registryEntry.serverAssetId.trim().length
          ? registryEntry.serverAssetId.trim()
          : normalized
      try {
        const serverAsset = await fetchResourceAsset(serverAssetId)
        const mapped = mapServerAssetToProjectAsset(serverAsset)
        const downloadUrl = typeof mapped.downloadUrl === 'string' ? mapped.downloadUrl.trim() : ''
        if (!downloadUrl) {
          return
        }
        editable.assetRegistry = {
          ...(editable.assetRegistry ?? {}),
          [normalized]: {
            sourceType: 'url',
            url: downloadUrl,
          },
        }
      } catch (error) {
        console.warn('Failed to resolve publish asset download URL', {
          registryAssetId: normalized,
          serverAssetId,
          error,
        })
      }
    }))
  }
  void assetCatalog
  delete editable.resourceSummary
  return editable
}

function stripEditorOnlySceneFields(
  document: ScenePackagePublishSceneDocument,
  retainedConfigAssetIds: ReadonlySet<string> = new Set<string>(),
): void {
  const filterAssetMap = <T>(value: Record<string, T> | null | undefined): Record<string, T> | undefined => {
    if (!value || typeof value !== 'object') {
      return undefined
    }
    const filtered = Object.fromEntries(
      Object.entries(value).filter(([assetId]) => !shouldSkipRuntimeExportAsset(document, assetId, retainedConfigAssetIds)),
    )
    return Object.keys(filtered).length ? filtered : undefined
  }

  const resourceSummary = document.resourceSummary
  if (Array.isArray(resourceSummary?.assets)) {
    resourceSummary.assets = resourceSummary.assets.filter((entry) => {
      const assetId = typeof entry?.assetId === 'string' ? entry.assetId.trim() : ''
      return !assetId || !shouldSkipRuntimeExportAsset(document, assetId, retainedConfigAssetIds)
    })
  }
  if (Array.isArray(resourceSummary?.unknownAssetIds)) {
    resourceSummary.unknownAssetIds = resourceSummary.unknownAssetIds.filter((assetId) => {
      const normalizedAssetId = typeof assetId === 'string' ? assetId.trim() : ''
      return !normalizedAssetId || !shouldSkipRuntimeExportAsset(document, normalizedAssetId, retainedConfigAssetIds)
    })
  }
  if (Array.isArray(resourceSummary?.excludedAssetIds)) {
    resourceSummary.excludedAssetIds = resourceSummary.excludedAssetIds.filter((assetId) => {
      const normalizedAssetId = typeof assetId === 'string' ? assetId.trim() : ''
      return Boolean(normalizedAssetId)
    })
  }

  if (document.projectOverrideAssets) {
    document.projectOverrideAssets = filterAssetMap(document.projectOverrideAssets) ?? {}
  }
  if (document.sceneOverrideAssets) {
    document.sceneOverrideAssets = filterAssetMap(document.sceneOverrideAssets) ?? {}
  }
  delete document.assetUrlOverrides
  delete document.resourceSummary
}

async function collectPublishEmbedAssetsFromScenes(
  scenes: ScenePackagePublishScene[],
): Promise<Map<string, ResolvedEmbedAsset>> {
  const out = new Map<string, ResolvedEmbedAsset>()
  for (const scene of scenes) {
    const doc = scene.document
    const retainedConfigAssetIds = await collectRuntimeRetainedEmbedAssetIds(doc)
    const effectiveRegistry = buildEffectiveAssetRegistry(doc)
    const assetAliases = buildAssetRegistryAliasMap(effectiveRegistry)
    const resourceAssets = Array.isArray(doc.resourceSummary?.assets) ? doc.resourceSummary.assets as PublishResourceSummaryAsset[] : []
    const entryHasLocalSource = (assetId: string): boolean => {
      const entry = effectiveRegistry[assetId]
      return Boolean(entry && entry.sourceType === 'package' && typeof entry.zipPath === 'string' && entry.zipPath.trim().startsWith('local::'))
    }

    for (const item of resourceAssets) {
      const assetId = typeof item?.assetId === 'string' ? item.assetId.trim() : ''
      if (!assetId) continue
      const canonicalAssetId = assetAliases.get(assetId) ?? assetId
      if (shouldSkipRuntimeExportAsset(doc, canonicalAssetId, retainedConfigAssetIds, assetAliases)) continue
      const downloadUrl = typeof item?.downloadUrl === 'string' ? item.downloadUrl.trim() : ''
      if (!downloadUrl || entryHasLocalSource(canonicalAssetId)) continue
      const asset = getAssetFromCatalog(doc.assetCatalog, canonicalAssetId, assetAliases)
      if (!out.has(canonicalAssetId)) {
        out.set(canonicalAssetId, {
          assetId: canonicalAssetId,
          downloadUrl,
          mimeTypeHint: typeof item?.mimeType === 'string' ? item.mimeType : null,
          filenameHint: typeof item?.filename === 'string' ? item.filename : null,
          extensionHint: resolveEmbedAssetExtensionHint(asset),
        })
      }
    }

    for (const [assetId, registryEntry] of Object.entries(effectiveRegistry)) {
      const normalized = typeof assetId === 'string' ? assetId.trim() : ''
      if (!normalized) {
        continue
      }
      const canonicalAssetId = assetAliases.get(normalized) ?? normalized
      if (out.has(canonicalAssetId) || shouldSkipRuntimeExportAsset(doc, canonicalAssetId, retainedConfigAssetIds, assetAliases)) {
        continue
      }
      if (entryHasLocalSource(canonicalAssetId)) {
        continue
      }
      let downloadUrl: string | null = null
      if (registryEntry.sourceType === 'url') {
        downloadUrl = typeof registryEntry.url === 'string' ? registryEntry.url.trim() : null
      }
      if (!downloadUrl && /^(https?:)?\/\//i.test(normalized)) {
        downloadUrl = normalized
      }
      const asset = getAssetFromCatalog(doc.assetCatalog, canonicalAssetId, assetAliases)
      out.set(canonicalAssetId, {
        assetId: canonicalAssetId,
        downloadUrl,
        extensionHint: resolveEmbedAssetExtensionHint(asset),
      })
    }
  }
  return out
}

function countSceneCheckpoints(document: SceneJsonExportDocument | null | undefined): number {
  if (!document || typeof document !== 'object') {
    return 0
  }

  if (Array.isArray(document.punchPoints)) {
    return document.punchPoints.length
  }

  return collectPunchPointsFromNodes(document.nodes).length
}

function countSceneNodes(nodes: SceneJsonExportDocument['nodes'] | null | undefined): number {
  if (!Array.isArray(nodes)) {
    return 0
  }
  let total = 0
  for (const node of nodes) {
    if (!node || typeof node !== 'object') {
      continue
    }
    total += 1
    const children = (node as { children?: SceneJsonExportDocument['nodes'] }).children
    total += countSceneNodes(children)
  }
  return total
}

function resourceEntrySize(entry: ScenePackageResourceEntry, files: Record<string, Uint8Array>): number {
  const explicit = Number(entry.size)
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit)
  }
  return files[entry.path]?.byteLength ?? 0
}

function addBreakdownBytes(
  breakdown: ProjectExportBundleResourceBreakdown,
  key: keyof ProjectExportBundleResourceBreakdown,
  value: number,
): void {
  if (!Number.isFinite(value) || value <= 0) {
    return
  }
  breakdown[key] += Math.floor(value)
}

function isTerrainPackagePath(path: string): boolean {
  return path.includes('/ground-tiles/')
    || path.includes('/ground-collision/')
    || path.includes('/ground/chunks/')
    || path.endsWith('/ground-terrain.json')
    || path.endsWith('/ground-collision.json')
    || path.endsWith('/ground-chunk-manifest.json')
}

function isSceneDocumentPath(path: string): boolean {
  return /^scenes\/[^/]+\/scene\.bin$/u.test(path)
}

function buildAssetSourceTotals(scenes: ScenePackagePublishScene[]): {
  assetBytes: number
  assetCount: number
  packageAssetBytes: number
  packageAssetCount: number
  serverAssetBytes: number
  serverAssetCount: number
} {
  let packageAssetBytes = 0
  let packageAssetCount = 0
  let serverAssetBytes = 0
  let serverAssetCount = 0

  for (const scene of scenes) {
    const assets = Array.isArray(scene.document?.resourceSummary?.assets) ? scene.document.resourceSummary.assets : []
    for (const asset of assets) {
      const size = Math.floor(Number(asset?.bytes) || 0)
      const isEmbedded = asset?.embedded === true || asset?.source === 'embedded'
      if (isEmbedded) {
        packageAssetBytes += size
        packageAssetCount += 1
      } else {
        serverAssetBytes += size
        serverAssetCount += 1
      }
    }
  }

  return {
    assetBytes: packageAssetBytes + serverAssetBytes,
    assetCount: packageAssetCount + serverAssetCount,
    packageAssetBytes,
    packageAssetCount,
    serverAssetBytes,
    serverAssetCount,
  }
}

function classifyProjectExportResourceType(
  resourceType: ScenePackageResourceEntry['resourceType'],
): keyof ProjectExportBundleResourceBreakdown | null {
  switch (resourceType) {
    case 'localAsset':
      return 'localAssetBytes'
    case 'planningImage':
      return 'planningImageBytes'
    case 'other':
      return 'embeddedAssetBytes'
    default:
      return 'otherBytes'
  }
}

function classifyProjectExportFilePath(
  path: string,
): keyof ProjectExportBundleResourceBreakdown | null {
  if (isSceneDocumentPath(path)) {
    return 'sceneDocumentBytes'
  }
  if (isTerrainPackagePath(path)) {
    return 'terrainBytes'
  }
  if (path === 'manifest.bin') {
    return 'manifestBytes'
  }
  if (path === 'project/project.json') {
    return 'projectBytes'
  }
  if (path.startsWith('scenes/')) {
    return 'sidecarBytes'
  }
  return 'otherBytes'
}

function buildProjectExportResourceBreakdown(options: {
  files: Record<string, Uint8Array>
  resources: ScenePackageResourceEntry[]
}): {
  breakdown: ProjectExportBundleResourceBreakdown
  resourcePathSet: Set<string>
  resourceBytesBySceneId: Map<string, number>
} {
  const breakdown: ProjectExportBundleResourceBreakdown = {
    localAssetBytes: 0,
    embeddedAssetBytes: 0,
    planningImageBytes: 0,
    terrainBytes: 0,
    sidecarBytes: 0,
    sceneDocumentBytes: 0,
    manifestBytes: 0,
    projectBytes: 0,
    otherBytes: 0,
  }
  const resourcePathSet = new Set(options.resources.map((entry) => entry.path))
  const resourceBytesBySceneId = new Map<string, number>()

  for (const entry of options.resources) {
    const size = resourceEntrySize(entry, options.files)
    const breakdownKey = classifyProjectExportResourceType(entry.resourceType)
    if (breakdownKey) {
      addBreakdownBytes(breakdown, breakdownKey, size)
    }

    const match = entry.path.match(/^scenes\/([^/]+)\//u)
    if (match?.[1]) {
      const sceneId = decodeURIComponent(match[1])
      resourceBytesBySceneId.set(sceneId, (resourceBytesBySceneId.get(sceneId) ?? 0) + size)
    }
  }

  for (const [path, bytes] of Object.entries(options.files)) {
    if (resourcePathSet.has(path)) {
      continue
    }
    const breakdownKey = classifyProjectExportFilePath(path)
    if (breakdownKey) {
      addBreakdownBytes(breakdown, breakdownKey, bytes.byteLength)
    }
  }

  return {
    breakdown,
    resourcePathSet,
    resourceBytesBySceneId,
  }
}

function buildProjectExportSceneSummaries(options: {
  files: Record<string, Uint8Array>
  scenes: ScenePackagePublishScene[]
  resourcePathSet: ReadonlySet<string>
  resourceBytesBySceneId: ReadonlyMap<string, number>
}): Array<{
  sceneId: string
  name: string | null
  checkpointTotal: number
  nodeCount: number
  sceneDocumentBytes: number
  sidecarBytes: number
  resourceBytes: number
}> {
  return options.scenes.map((scene) => {
    const encodedSceneId = encodeURIComponent(scene.id)
    const sceneRoot = `scenes/${encodedSceneId}/`
    let sceneDocumentBytes = 0
    let sidecarBytes = 0
    for (const [path, bytes] of Object.entries(options.files)) {
      if (!path.startsWith(sceneRoot) || options.resourcePathSet.has(path)) {
        continue
      }
      if (path === `${sceneRoot}scene.bin`) {
        sceneDocumentBytes += bytes.byteLength
      } else {
        sidecarBytes += bytes.byteLength
      }
    }
    return {
      sceneId: scene.id,
      name: typeof scene.document?.name === 'string' ? scene.document.name : null,
      checkpointTotal: countSceneCheckpoints(scene.document),
      nodeCount: countSceneNodes(scene.document?.nodes),
      sceneDocumentBytes,
      sidecarBytes,
      resourceBytes: options.resourceBytesBySceneId.get(scene.id) ?? 0,
    }
  })
}

function buildProjectExportLargestResources(options: {
  resources: ScenePackageResourceEntry[]
  files: Record<string, Uint8Array>
}): Array<{
  logicalId: string
  resourceType: ScenePackageResourceEntry['resourceType']
  path: string
  size: number
  mimeType: string | null
  ext: string | null
}> {
  return options.resources
    .map((entry) => ({
      logicalId: entry.logicalId,
      resourceType: entry.resourceType,
      path: entry.path,
      size: resourceEntrySize(entry, options.files),
      mimeType: entry.mimeType ?? null,
      ext: entry.ext ?? null,
    }))
    .sort((left, right) => right.size - left.size)
    .slice(0, 10)
}

function buildProjectExportMetadata(options: {
  createdAt: string
  checkpointTotal: number
  files: Record<string, Uint8Array>
  manifestBytes: number
  projectBytes: number
  project: ProjectExportBundleProjectConfig
  resources: ScenePackageResourceEntry[]
  scenes: ScenePackagePublishScene[]
}): ProjectExportBundleMetadata {
  const resourceBreakdown = buildProjectExportResourceBreakdown({
    files: options.files,
    resources: options.resources,
  })
  resourceBreakdown.breakdown.manifestBytes = options.manifestBytes
  resourceBreakdown.breakdown.projectBytes = options.projectBytes
  const sceneSummaries = buildProjectExportSceneSummaries({
    files: options.files,
    scenes: options.scenes,
    resourcePathSet: resourceBreakdown.resourcePathSet,
    resourceBytesBySceneId: resourceBreakdown.resourceBytesBySceneId,
  })
  const fileBytes = Object.values(options.files).reduce((sum, bytes) => sum + bytes.byteLength, 0)
  const manifestResourceBytes = options.resources.reduce((sum, entry) => sum + resourceEntrySize(entry, options.files), 0)
  const nodeCountTotal = sceneSummaries.reduce((sum, scene) => sum + scene.nodeCount, 0)
  const assetSourceTotals = buildAssetSourceTotals(options.scenes)

  return {
    generatedAt: options.createdAt,
    sceneCount: options.scenes.length,
    sceneOrder: [...options.project.sceneOrder],
    checkpointTotal: options.checkpointTotal,
    nodeCountTotal,
    resourceCount: options.resources.length,
    packageAssetCount: assetSourceTotals.packageAssetCount,
    packageAssetBytes: assetSourceTotals.packageAssetBytes,
    serverAssetCount: assetSourceTotals.serverAssetCount,
    serverAssetBytes: assetSourceTotals.serverAssetBytes,
    assetCount: assetSourceTotals.assetCount,
    assetBytes: assetSourceTotals.assetBytes,
    manifestResourceBytes,
    uncompressedEntryBytes: fileBytes + options.manifestBytes + options.projectBytes,
    zipEntryCount: Object.keys(options.files).length + 2,
    breakdown: resourceBreakdown.breakdown,
    largestResources: buildProjectExportLargestResources({
      resources: options.resources,
      files: options.files,
    }),
    sceneSummaries,
  }
}
type PublishLocalAssetContext = {
  assetType?: string | null
  assetSourceType?: string | null
  assetSourceLabel?: string | null
  assetReferenceCount?: number | null
  detail?: string | null
}

function buildPublishLocalAssetContext(
  assetId: string,
  resourcePath: string,
  sceneName: string,
  sceneAssetReferenceSummaries: Map<string, SceneAssetReferenceSummary>,
): PublishLocalAssetContext {
  const summary = sceneAssetReferenceSummaries.get(assetId) ?? null
  const detailParts = [`packaged=${resourcePath}`]
  if (summary?.assetType) {
    detailParts.push(`type=${summary.assetType}`)
  }
  if (summary?.sourceType) {
    detailParts.push(`sourceType=${summary.sourceType}`)
  }
  if (summary?.sourceLabel) {
    detailParts.push(`source=${summary.sourceLabel}`)
  }
  if (summary?.referenceCount) {
    detailParts.push(`references=${summary.referenceCount}`)
  }
  if (sceneName) {
    detailParts.push(`scene=${sceneName}`)
  }
  return {
    assetType: summary?.assetType ? String(summary.assetType) : null,
    assetSourceType: summary?.sourceType ? String(summary.sourceType) : null,
    assetSourceLabel: summary?.sourceLabel ?? null,
    assetReferenceCount: summary?.referenceCount ?? null,
    detail: detailParts.join('\n') || null,
  }
}

async function writePublishScenePackageLocalAssets(options: {
  state: ScenePackagePublishZipBuildState
  payload: ScenePackagePublishPayload
  reportEvent?: SceneExportEventReporter
  scene: ScenePackagePublishScene
  preparedDocument: ScenePackagePublishSceneDocument
  sceneAssetReferenceSummaries: Map<string, SceneAssetReferenceSummary>
  assetIds: string[]
  resourcePathForAsset: (assetId: string, blob: Blob, entry: { filename?: string | null; mimeType?: string | null }) => Promise<string>
  itemMessage: (assetName: string) => string
  completedMessage: (assetName: string) => string
  progressMessage: (current: number, total: number) => string
  updateResourceRegistry?: (assetId: string, resourcePath: string, entry: { sourceType?: string | null; inline?: string | null; bytes?: number | null; assetType?: SceneAssetRegistryEntry['assetType'] | null; name?: string | null }) => void
}): Promise<void> {
  const {
    state,
    payload,
    reportEvent,
    scene,
    preparedDocument,
    sceneAssetReferenceSummaries,
    assetIds,
    resourcePathForAsset,
    itemMessage,
    completedMessage,
    progressMessage,
    updateResourceRegistry,
  } = options

  for (let aIndex = 0; aIndex < assetIds.length; aIndex += 1) {
    const assetId = assetIds[aIndex]!
    const cachedEntry = state.assetCache.getEntry(assetId)
    const assetName = describeAssetName(assetId, cachedEntry.filename)
    emitSceneExportEvent(reportEvent, {
      phase: 'asset',
      level: 'info',
      status: 'running',
      sceneId: scene.id,
      sceneName: describeSceneName(scene),
      assetId,
      assetName,
      current: aIndex + 1,
      total: assetIds.length,
      message: itemMessage(assetName),
    })
    const ratio = assetIds.length ? (aIndex + 1) / assetIds.length : 1
    payload.updateProgress?.(85 + Math.round(10 * ratio), progressMessage(aIndex + 1, assetIds.length))
    let entry = state.assetCache.getEntry(assetId)
    if (entry.status !== 'cached' || !entry.blob) {
      await state.assetCache.ensureAssetEntry(assetId)
      entry = state.assetCache.getEntry(assetId)
    }
    if (entry.status !== 'cached' || !entry.blob) {
      continue
    }
    const blob = entry.blob
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const mimeType = entry.mimeType ?? blob.type ?? 'application/octet-stream'
    const ext = inferExtFromFilename(entry.filename) ?? inferExtFromMimeType(mimeType) ?? 'bin'
    const resourcePath = await resourcePathForAsset(assetId, blob, { filename: entry.filename, mimeType })
    const assetContext = buildPublishLocalAssetContext(assetId, resourcePath, describeSceneName(scene), sceneAssetReferenceSummaries)
    state.files[resourcePath] = bytes
    state.resources.push({
      logicalId: assetId,
      resourceType: 'localAsset',
      path: resourcePath,
      ext,
      mimeType,
      size: blob.size,
      hash: await sha256Hex(assetId),
    })
    const registryEntry = preparedDocument.assetRegistry?.[assetId]
    updateResourceRegistry?.(assetId, resourcePath, {
      sourceType: registryEntry?.sourceType ?? null,
      inline: registryEntry?.sourceType === 'package' ? registryEntry.inline ?? null : null,
      bytes: registryEntry?.bytes ?? null,
      assetType: registryEntry?.assetType ?? null,
      name: registryEntry?.name ?? null,
    })
    emitSceneExportEvent(reportEvent, {
      phase: 'asset',
      level: 'success',
      status: 'completed',
      sceneId: scene.id,
      sceneName: describeSceneName(scene),
      assetId,
      assetName,
      assetType: assetContext.assetType,
      assetSourceType: assetContext.assetSourceType,
      assetSourceLabel: assetContext.assetSourceLabel,
      assetReferenceCount: assetContext.assetReferenceCount,
      current: aIndex + 1,
      total: assetIds.length,
      detail: assetContext.detail,
      message: completedMessage(assetName),
    })
  }
}

async function writePublishSharedEmbeddedScenePackageAssets(options: {
  state: ScenePackagePublishZipBuildState
  payload: ScenePackagePublishPayload
  reportEvent?: SceneExportEventReporter
  embedAssets: Map<string, ResolvedEmbedAsset>
  startMessage: string
  emptyMessage: string
  itemMessage: (assetName: string) => string
  completedMessage: (assetName: string) => string
  progressMessage: (done: number, total: number) => string
  resolveAssetContext: (options: { item: ResolvedEmbedAsset; resourcePath: string }) => { assetType?: string | null; assetSourceType?: string | null; assetSourceLabel?: string | null; assetReferenceCount?: number | null; detail?: string | null }
}): Promise<void> {
  const {
    state,
    payload,
    reportEvent,
    embedAssets,
    startMessage,
    emptyMessage,
    itemMessage,
    completedMessage,
    progressMessage,
    resolveAssetContext,
  } = options

  if (embedAssets.size > 0) {
    const total = embedAssets.size
    let done = 0
    emitSceneExportEvent(reportEvent, {
      phase: 'asset',
      level: 'info',
      status: total > 0 ? 'running' : 'completed',
      message: total > 0 ? startMessage : emptyMessage,
      current: 0,
      total,
    })
    for (const item of embedAssets.values()) {
      const assetName = describeAssetName(item.assetId, item.filenameHint)
      emitSceneExportEvent(reportEvent, {
        phase: 'asset',
        level: 'info',
        status: 'running',
        assetId: item.assetId,
        assetName,
        current: done + 1,
        total,
        message: itemMessage(assetName),
      })
      done += 1
      const ratio = total > 0 ? done / total : 1
      payload.updateProgress?.(85 + Math.round(6 * ratio), progressMessage(done, total))
      let blob: Blob | null = null
      let mimeType = item.mimeTypeHint ?? null
      let filename = item.filenameHint ?? null
      const cached = state.assetCache.getEntry(item.assetId)
      if (cached?.status === 'cached' && cached.blob) {
        blob = cached.blob
        mimeType = cached.mimeType ?? blob.type ?? mimeType
        filename = cached.filename ?? filename
      }
      if (!blob) {
        if (!item.downloadUrl) {
          continue
        }
        const response = await fetch(item.downloadUrl, { method: 'GET', credentials: 'omit', cache: 'no-cache' })
        if (!response.ok) {
          throw new Error(`Failed to download asset for embedding: ${item.assetId} (${response.status})`)
        }
        const contentType = response.headers.get('Content-Type')
        if (contentType && !mimeType) {
          mimeType = contentType
        }
        blob = await response.blob()
        mimeType = mimeType ?? blob.type ?? 'application/octet-stream'
      }
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const ext = item.extensionHint ?? inferExtFromFilename(filename) ?? inferExtFromMimeType(mimeType ?? '') ?? 'bin'
      const hash = await sha256Hex(item.assetId)
      const safeName = hash.length > 16 ? hash.slice(0, 16) : hash
      const resourcePath = `resources/${safeName}.${ext}`
      const assetContext = resolveAssetContext({ item, resourcePath })
      state.files[resourcePath] = bytes
      state.sharedAssetPathById.set(item.assetId, resourcePath)
      state.resources.push({
        logicalId: item.assetId,
        resourceType: 'other',
        path: resourcePath,
        ext,
        mimeType: mimeType ?? 'application/octet-stream',
        size: blob.size,
        hash,
      })
      emitSceneExportEvent(reportEvent, {
        phase: 'asset',
        level: 'success',
        status: 'completed',
        assetId: item.assetId,
        assetName,
        assetType: assetContext.assetType,
        assetSourceType: assetContext.assetSourceType,
        assetSourceLabel: assetContext.assetSourceLabel,
        assetReferenceCount: assetContext.assetReferenceCount,
        current: done,
        total,
        detail: assetContext.detail,
        message: completedMessage(assetName),
      })
    }
  }
}

function buildPublishScenePackageZipState(payload: ScenePackagePublishZipBuildPayload): ScenePackagePublishZipBuildState {
  const createdAt = new Date().toISOString()
  const files: Record<string, Uint8Array> = {}
  const projectPath = 'project/project.json'
  const assetCache = useAssetCacheStore()
  const scenesStore = useScenesStore()
  const manifestScenes: ScenePackagePublishSceneEntry[] = []
  const resources: ScenePackageResourceEntry[] = []
  let checkpointTotal = 0
  payload.scenes.forEach((scene) => {
    checkpointTotal += countSceneCheckpoints(scene.document)
  })
  const projectWithCheckpointTotal: ScenePackagePublishProjectConfig = {
    ...payload.project,
    checkpointTotal,
  }
  const sceneReferenceSummaryMaps = new Map<string, Map<string, SceneAssetReferenceSummary>>()

  payload.scenes.forEach((scene) => {
    const document = scene.document as ScenePackagePublishSceneDocument
    const effectiveRegistry = buildEffectiveAssetRegistry(document)
    sceneReferenceSummaryMaps.set(
      scene.id,
      buildSceneAssetReferenceSummaryMap(
        document as import('@/types/stored-scene-document').StoredSceneDocument,
        effectiveRegistry,
      ),
    )
  })

  return {
    createdAt,
    files,
    projectPath,
    assetCache,
    scenesStore,
    manifestScenes,
    resources,
    sharedAssetPathById: new Map<string, string>(),
    projectWithCheckpointTotal,
    checkpointTotal,
    sceneReferenceSummaryMaps,
  }
}

async function buildPublishTerrainPackage(
  sceneId: string,
  groundNode: NonNullable<ReturnType<typeof resolveDocumentGroundNode>>,
  storedTerrainDatasetManifest: TerrainDatasetManifest | null,
  scenesStore: ReturnType<typeof useScenesStore>,
): Promise<{ terrain: NonNullable<ScenePackageManifestV1['scenes'][number]['terrain']>; files: Record<string, Uint8Array> } | null> {
  if (!groundNode || !groundNode.dynamicMesh || !storedTerrainDatasetManifest) {
    return null
  }
  const terrainPackage = await buildPublishTerrainDatasetPackageFiles(sceneId, storedTerrainDatasetManifest, async (regionKey) => {
    return await scenesStore.loadTerrainDatasetRegionPack(sceneId, regionKey)
  })
  if (!terrainPackage) {
    return null
  }
  return {
    terrain: {
      datasetId: storedTerrainDatasetManifest.datasetId,
      rootManifestPath: terrainPackage.rootManifestPath,
      regionsPath: terrainPackage.regionsPath,
    },
    files: terrainPackage.files,
  }
}

async function attachPublishTerrainPackage(
  sceneId: string,
  groundNode: NonNullable<ReturnType<typeof resolveDocumentGroundNode>>,
  storedTerrainDatasetManifest: TerrainDatasetManifest | null,
  scenesStore: ReturnType<typeof useScenesStore>,
  files: Record<string, Uint8Array>,
): Promise<ScenePackageManifestV1['scenes'][number]['terrain'] | undefined> {
  const terrainPackage = await buildPublishTerrainPackage(sceneId, groundNode, storedTerrainDatasetManifest, scenesStore)
  if (!terrainPackage) {
    return undefined
  }
  Object.assign(files, terrainPackage.files)
  return terrainPackage.terrain
}

function buildPublishCompiledGroundKeys(
  sceneId: string,
  groundMesh: unknown,
  datasetId: string | null | undefined,
): { buildKey: string; sourceSignature: string } {
  const normalizedGroundMesh = groundMesh as import('@schema/core').GroundDynamicMesh
  return {
    buildKey: computeSceneCompiledGroundBuildKey(sceneId, normalizedGroundMesh, datasetId ?? null),
    sourceSignature: computeSceneCompiledGroundSourceSignature(sceneId, normalizedGroundMesh, datasetId ?? null),
  }
}

function writePublishCompiledGroundFiles(
  sceneId: string,
  compiled: Awaited<ReturnType<typeof ensureSceneCompiledGroundPackage>>,
  files: Record<string, Uint8Array>,
): ScenePackageManifestV1['scenes'][number]['compiledGround'] {
  const compiledPaths = resolveSceneCompiledGroundPackagePaths(sceneId)
  files[compiledPaths.manifestPath] = serializeCompiledGroundManifest(compiled.manifest)
  compiled.files.forEach((bytes, path) => {
    files[path] = new Uint8Array(bytes)
  })
  return {
    manifestPath: compiledPaths.manifestPath,
    renderRootPath: compiledPaths.renderRootPath,
    collisionRootPath: compiledPaths.collisionRootPath,
  }
}

async function attachPublishCompiledGroundPackage(options: {
  sceneId: string
  groundNode: NonNullable<ReturnType<typeof resolveDocumentGroundNode>>
  preparedDocument: SceneJsonExportDocument
  storedTerrainDatasetManifest: TerrainDatasetManifest | null
  scenesWorkspaceId: string | null
  files: Record<string, Uint8Array>
}): Promise<ScenePackageManifestV1['scenes'][number]['compiledGround'] | undefined> {
  const { sceneId, groundNode, preparedDocument, storedTerrainDatasetManifest, scenesWorkspaceId, files } = options
  if (!groundNode || !groundNode.dynamicMesh) {
    return undefined
  }
  const { buildKey, sourceSignature } = buildPublishCompiledGroundKeys(
    sceneId,
    groundNode.dynamicMesh,
    storedTerrainDatasetManifest?.datasetId ?? null,
  )
  const compiled = await ensureSceneCompiledGroundPackage(preparedDocument, buildKey, {
    workspaceId: scenesWorkspaceId,
    sourceSignature,
  })
  return writePublishCompiledGroundFiles(sceneId, compiled, files)
}

function buildPublishRoadCollisionPackage(
  preparedDocument: SceneJsonExportDocument,
): { roadCollision?: ScenePackageManifestV1['scenes'][number]['roadCollision']; files: Record<string, Uint8Array> } {
  const roadCollisionExport = buildRoadCollisionCompiledExport(preparedDocument)
  return {
    roadCollision: roadCollisionExport.manifest.roads.length > 0
      ? { manifestPath: roadCollisionExport.manifestPath }
      : undefined,
    files: roadCollisionExport.files,
  }
}

function applyPublishPackagedAssetPaths(options: {
  document: ScenePackagePublishSceneDocument
  sharedAssetPathById: ReadonlyMap<string, string>
  resources: ScenePackageResourceEntry[]
}): void {
  const { document, sharedAssetPathById, resources } = options
  const packagedAssetPathById = buildPackagedAssetPathMap(sharedAssetPathById, resources)
  if (!document.assetRegistry) {
    return
  }
  Object.entries(document.assetRegistry).forEach(([assetId, entry]) => {
    const packagedPath = packagedAssetPathById.get(assetId)
    if (!packagedPath || !entry) {
      return
    }
    document.assetRegistry![assetId] = {
      sourceType: 'package',
      zipPath: packagedPath,
      inline: entry.sourceType === 'package' ? entry.inline : undefined,
      bytes: entry.bytes,
      assetType: entry.assetType,
      name: entry.name,
    }
  })
}

function stripPublishSceneDocument(
  preparedDocument: ScenePackagePublishSceneDocument,
): void {
  stripGroundRuntimeUserData(resolveDocumentGroundNode(preparedDocument))
  stripEditorOnlySceneFields(preparedDocument, collectRuntimeRetainedConfigAssetIds(preparedDocument))
}

function finalizePublishScenePackageZipState(
  state: ScenePackagePublishZipBuildState,
  payload: ScenePackagePublishPayload,
  manifestScenes: ScenePackagePublishSceneEntry[],
): void {
  const manifest: ScenePackagePublishManifest = {
    format: SCENE_PACKAGE_FORMAT,
    version: SCENE_PACKAGE_VERSION,
    createdAt: state.createdAt,
    project: { path: state.projectPath },
    scenes: manifestScenes,
    resources: state.resources,
  }

  const manifestBytes = serializeScenePackageManifest(manifest)
  let projectBytes = jsonBytes(state.projectWithCheckpointTotal)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const metadata = buildProjectExportMetadata({
      createdAt: state.createdAt,
      checkpointTotal: state.checkpointTotal,
      files: state.files,
      manifestBytes: manifestBytes.byteLength,
      projectBytes: projectBytes.byteLength,
      project: state.projectWithCheckpointTotal,
      resources: state.resources,
      scenes: payload.scenes,
    })
    const nextProject = { ...state.projectWithCheckpointTotal, metadata }
    const nextProjectBytes = jsonBytes(nextProject)
    state.projectWithCheckpointTotal = nextProject
    if (nextProjectBytes.byteLength === projectBytes.byteLength) {
      projectBytes = nextProjectBytes
      break
    }
    projectBytes = nextProjectBytes
  }

  state.files[state.projectPath] = projectBytes
  state.files['manifest.bin'] = manifestBytes
  emitSceneExportEvent(payload.reportEvent, {
    phase: 'manifest',
    level: 'info',
    status: 'completed',
    detail: 'manifest.bin',
        message: `清单文件已生成 (${manifestScenes.length} 个场景, ${state.resources.length} 个资源)`,
  })
  emitSceneExportEvent(payload.reportEvent, {
    phase: 'archive',
    level: 'info',
    status: 'running',
    progress: 96,
    detail: 'manifest.bin',
    message: 'ZIP 文件列表已准备完成',
  })
}

export async function prepareScenePackagePublishZipFiles(payload: ScenePackagePublishPayload): Promise<Record<string, Uint8Array>> {
  const state = buildPublishScenePackageZipState(payload)
  const {
    files,
    scenesStore,
    resources,
    sceneReferenceSummaryMaps,
    sharedAssetPathById,
  } = state
  const manifestScenes = state.manifestScenes
  if (payload.embedAssets) {
    const embedAssets = await collectPublishEmbedAssetsFromScenes(payload.scenes)
    await writePublishSharedEmbeddedScenePackageAssets({
      state,
      payload,
      reportEvent: payload.reportEvent,
      embedAssets,
      startMessage: '开始处理运行时嵌入资产',
      emptyMessage: '没有需要嵌入的运行时资产',
      itemMessage: (assetName) => `正在嵌入运行时资产 ${assetName}`,
      completedMessage: (assetName) => `运行时资产已写入 ${assetName}`,
      progressMessage: (done, total) => `Embedding assets… (${done}/${total})`,
      resolveAssetContext: ({ item, resourcePath }) =>
        buildPublishCombinedAssetEventContext(item.assetId, payload.scenes, state.sceneReferenceSummaryMaps, resourcePath),
    })
  }

  const scenesWorkspaceId = scenesStore.workspaceId

  for (let sIndex = 0; sIndex < payload.scenes.length; sIndex += 1) {
    const scene = payload.scenes[sIndex]!
    const sceneName = describeSceneName(scene)
    emitSceneExportEvent(payload.reportEvent, {
      phase: 'scene',
      level: 'info',
      status: 'running',
      sceneId: scene.id,
      sceneName,
      current: sIndex + 1,
      total: payload.scenes.length,
      message: `开始编译场景 ${sceneName}`,
    })
    const preparedDocument = cloneSceneDocumentForPublishPackageExport(scene.document)
    stripLandformNodes(preparedDocument.nodes ?? [])
    assertNoLandformNodes(preparedDocument.nodes ?? [])
    if ('assetCatalog' in preparedDocument) {
      await attachPublishSceneAssetMetadata(preparedDocument)
    }
    const scenePath = `scenes/${encodeURIComponent(scene.id)}/scene.bin`
    let planningPath: string | undefined
    let groundHeightPath: string | undefined
    let groundSplatPath: string | undefined
    let groundScatterPath: string | undefined
    let terrain: ScenePackageManifestV1['scenes'][number]['terrain'] | undefined
    let compiledGround: ScenePackageManifestV1['scenes'][number]['compiledGround'] | undefined
    let roadCollision: ScenePackageManifestV1['scenes'][number]['roadCollision'] | undefined
    const groundNode = resolveDocumentGroundNode(preparedDocument)
    const storedTerrainDatasetManifest = await scenesStore.loadTerrainDatasetManifest(scene.id)
    const sceneRuntimeAssetIds = new Set<string>(
      collectPublishScenePackageAssetIdsForExport(
        preparedDocument,
        collectRuntimeRetainedConfigAssetIds(preparedDocument),
      ),
    )
    const localAssetIds = Array.from(sceneRuntimeAssetIds)
    const sceneAssetReferenceSummaries = sceneReferenceSummaryMaps.get(scene.id) ?? new Map<string, SceneAssetReferenceSummary>()

    const punchPoints = preparedDocument.punchPoints
    if (!Array.isArray(punchPoints) || punchPoints.length === 0) {
      const computedPunchPoints = collectPunchPointsFromNodes(preparedDocument.nodes)
      if (computedPunchPoints.length) {
        preparedDocument.punchPoints = computedPunchPoints
      }
    }

    await writePublishScenePackageLocalAssets({
      state,
      payload,
      reportEvent: payload.reportEvent,
      scene,
      preparedDocument,
      sceneAssetReferenceSummaries,
      assetIds: localAssetIds,
      resourcePathForAsset: async (assetId, _blob, entry) => {
        if (isBuiltinWaterNormalAsset(assetId)) {
          return `scenes/${encodeURIComponent(scene.id)}/resources/${BUILTIN_WATER_NORMAL_FILENAME}`
        }
        const hash = await sha256Hex(assetId)
        const safeName = hash.length > 16 ? hash.slice(0, 16) : hash
        const ext = inferExtFromFilename(entry.filename) ?? inferExtFromMimeType(entry.mimeType ?? '') ?? 'bin'
        return `scenes/${encodeURIComponent(scene.id)}/resources/${safeName}.${ext}`
      },
      itemMessage: (assetName) => `正在打包运行时资产 ${assetName}`,
      completedMessage: (assetName) => `运行时资产已写入 ${assetName}`,
      progressMessage: (current, total) => `Packaging runtime assets… (${current}/${total})`,
      updateResourceRegistry: (assetId, resourcePath, entry) => {
        const existing = preparedDocument.assetRegistry?.[assetId]
        if (existing?.sourceType === 'package') {
          preparedDocument.assetRegistry![assetId] = {
            ...existing,
            zipPath: resourcePath,
            inline: entry.inline ?? undefined,
            bytes: entry.bytes ?? undefined,
            assetType: entry.assetType ?? undefined,
            name: entry.name ?? undefined,
          }
        }
      },
    })
    applyPublishPackagedAssetPaths({
      document: preparedDocument,
      sharedAssetPathById,
      resources,
    })

    const groundHeightSidecar = await scenesStore.loadGroundHeightSidecar(scene.id)
    if (groundHeightSidecar) {
      groundHeightPath = `scenes/${encodeURIComponent(scene.id)}/${GROUND_HEIGHTMAP_SIDECAR_FILENAME}`
      files[groundHeightPath] = new Uint8Array(groundHeightSidecar)
    }
    const groundSplatSidecar = buildPublishSceneGroundSplatSidecar(preparedDocument)
    if (groundSplatSidecar) {
      groundSplatPath = `scenes/${encodeURIComponent(scene.id)}/ground-splat.bin`
      files[groundSplatPath] = new Uint8Array(groundSplatSidecar)
    }
    const groundScatterSidecar = buildPublishSceneGroundScatterSidecar(preparedDocument)
    if (groundScatterSidecar) {
      groundScatterPath = `scenes/${encodeURIComponent(scene.id)}/ground-scatter.bin`
      files[groundScatterPath] = new Uint8Array(groundScatterSidecar)
    }

    stripGroundBakedTextureAssetIds(groundNode)

    terrain = await attachPublishTerrainPackage(scene.id, groundNode as NonNullable<ReturnType<typeof resolveDocumentGroundNode>>, storedTerrainDatasetManifest, scenesStore, files)
    compiledGround = await attachPublishCompiledGroundPackage({
      sceneId: scene.id,
      groundNode: groundNode as NonNullable<ReturnType<typeof resolveDocumentGroundNode>>,
      preparedDocument: preparedDocument as SceneJsonExportDocument,
      storedTerrainDatasetManifest,
      scenesWorkspaceId,
      files,
    })
    const roadCollisionPackage = buildPublishRoadCollisionPackage(preparedDocument as SceneJsonExportDocument)
    Object.assign(files, roadCollisionPackage.files)
    roadCollision = roadCollisionPackage.roadCollision

    stripPublishSceneDocument(preparedDocument)

    files[scenePath] = encodeScenePackageSceneDocument(preparedDocument as SceneJsonExportDocument)
    emitSceneExportEvent(payload.reportEvent, {
      phase: 'scene',
      level: 'success',
      status: 'completed',
      sceneId: scene.id,
      sceneName,
      current: sIndex + 1,
      total: payload.scenes.length,
      detail: scenePath,
      message: `运行时场景已写入 ${sceneName}`,
    })
    if (scene.document.planningData) {
      const planningSidecar = await buildPlanningSidecar(scene.id, scene.document.planningData, files, resources)
      planningPath = planningSidecar.planningPath
      files[planningPath] = serializePlanningScenePackageSidecar(planningSidecar.sidecar)
      emitSceneExportEvent(payload.reportEvent, {
        phase: 'sidecar',
        level: 'info',
        status: 'completed',
        sceneId: scene.id,
        sceneName,
        detail: planningPath,
        message: `已写入规划数据 sidecar`,
      })
    }
    manifestScenes.push({
      sceneId: scene.id,
      path: scenePath,
      planningPath,
      groundHeightPath,
      groundSplatPath,
      groundScatterPath,
      terrain,
      compiledGround,
      roadCollision,
    })
  }
  finalizePublishScenePackageZipState(state, payload, manifestScenes)
  return files
}

export async function exportScenePackagePublishZip(payload: ScenePackagePublishPayload): Promise<Blob> {
  const files = await prepareScenePackagePublishZipFiles(payload)
  payload.updateProgress?.(96, 'Compressing ZIP…')
  const blob = createScenePackageZipBlob(files)
  emitSceneExportEvent(payload.reportEvent, {
    phase: 'archive',
    level: 'success',
    status: 'completed',
    progress: 100,
    detail: `${Object.keys(files).length} files`,
    message: 'ZIP 压缩完成',
  })
  return blob
}
