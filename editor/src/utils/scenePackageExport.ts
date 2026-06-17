import { zipSync, strToU8 } from 'fflate'
import type {
  GroundDynamicMesh,
  SceneAssetOverrideEntry,
  SceneAssetRegistryEntry,
  SceneJsonExportDocument,
  ProjectExportBundleProjectConfig,
  ProjectExportBundleMetadata,
  ProjectExportBundleResourceBreakdown,
} from '@schema/core'
import {
  buildQuantizedTerrainRegionPackPath,
  buildQuantizedTerrainRootManifestPath,
  encodeScenePackageSceneDocument,
  GROUND_SPLAT_SIDECAR_FILENAME,
  GROUND_SCATTER_SIDECAR_FILENAME,
  SCENE_PACKAGE_FORMAT,
  SCENE_PACKAGE_VERSION,
  serializeScenePackageManifest,
  serializeQuantizedTerrainDatasetRootManifest,
  serializeCompiledGroundManifest,
  type QuantizedTerrainDatasetRootManifest,
  type ScenePackageManifestV1,
  type ScenePackageResourceEntry,
} from '@schema/core'

import { inferExtFromMimeType } from '@schema/core'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { useGroundSplatStore } from '@/stores/groundSplatStore'
import { useGroundScatterStore } from '@/stores/groundScatterStore'
import {
  buildAssetRegistryForExport,
  calculateSceneResourceSummary,
  cloneSceneDocumentWithRuntimeGroundSidecars,
  useSceneStore,
} from '@/stores/sceneStore'
import { useScenesStore } from '@/stores/scenesStore'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import type { PlanningSceneData } from '@/types/planning-scene-data'
import type { PlanningScenePackageImageEntry, PlanningScenePackageSidecar } from '@/types/planning-package'
import type { SceneExportEventReporter } from '@/types/scene-export'
import {
  serializePlanningScenePackageSidecar,
} from '@/types/planning-package'
import { getPlanningImageBlobByHash } from '@/utils/planningImageStorage'

import { loadPlanningDemBlobByHash } from '@/utils/planningDemStorage'
import { sha256Hex } from '@harmony/utils/hash'
import { fetchResourceAsset } from '@/api/resourceAssets'
import { mapServerAssetToProjectAsset } from '@/api/serverAssetTypes'
import { buildAssetRegistryAliasMap, normalizeAssetIdWithRegistry } from '@/utils/assetRegistryIdNormalization'
import {
  stripGroundHeightMapsFromSceneDocument,
} from '@/utils/groundHeightSidecar'
import { resolveDocumentGroundNode } from '@schema/groundNode'
import {
  computeSceneCompiledGroundBuildKey,
  computeSceneCompiledGroundSourceSignature,
  getSceneCompiledGroundPackageFileBytes,
  loadSceneCompiledGroundPackageFromCache,
  resolveSceneCompiledGroundPackagePaths,
} from '@/utils/sceneCompiledGroundCache'
import { buildRoadCollisionCompiledExport } from '@/utils/roadCollisionCompiledExport'
import { collectPunchPointsFromNodes } from './sceneExport'
import {
  buildSceneAssetReferenceSummaryMap,
  type SceneAssetReferenceSummary,
} from './sceneAssetDiagnostics'
import {
  BUILTIN_WATER_NORMAL_FILENAME,
  isBuiltinWaterNormalAsset,
} from '@/constants/builtinAssets'
import type { ProjectAsset } from '@/types/project-asset'
import { resolveProjectAssetExtension, shouldExcludeAssetFromRuntimeExport } from '@/utils/assetDependencySubset'
import {
  collectPrefabAssetIdsFromSceneReferences,
  collectRuntimeRequiredConfigAssetIds,
  collectTransitiveConfigDependencyAssetIds,
} from '@/stores/sceneAssetCleanup'
import { attachRoadCollisionCompiledPackagesToDocument } from '@schema/core'

type SceneGroundTerrainOverrideState = {
  runtimeDisableOptimizedChunks?: boolean
  runtimeHydratedHeightState?: 'pristine' | 'dirty' | 'none'
  surfaceRevision?: number
  localEditTiles?: Record<string, unknown> | null
  runtimeManualHeightOverrideCount?: number
  runtimePlanningHeightOverrideCount?: number
}

function hasSceneGroundTerrainOverrides(dynamicMesh: unknown): boolean {
  if (!dynamicMesh || typeof dynamicMesh !== 'object') {
    return false
  }

  const ground = dynamicMesh as SceneGroundTerrainOverrideState
  if (ground.runtimeDisableOptimizedChunks === true || ground.runtimeHydratedHeightState === 'dirty') {
    return true
  }

  if (Number.isFinite(ground.surfaceRevision) && Math.trunc(ground.surfaceRevision as number) > 0) {
    return true
  }

  if (ground.runtimeHydratedHeightState === 'pristine') {
    return false
  }

  const localEditTiles = ground.localEditTiles && typeof ground.localEditTiles === 'object'
    ? Object.values(ground.localEditTiles)
    : []
  if (localEditTiles.length > 0) {
    return true
  }

  const manualOverrideCount = Number(ground.runtimeManualHeightOverrideCount)
  if (Number.isFinite(manualOverrideCount) && manualOverrideCount > 0) {
    return true
  }

  const planningOverrideCount = Number(ground.runtimePlanningHeightOverrideCount)
  return Number.isFinite(planningOverrideCount) && planningOverrideCount > 0
}

function buildEffectiveAssetRegistry(
  document: SceneJsonExportDocument | null | undefined,
): Record<string, SceneAssetRegistryEntry> {
  const out: Record<string, SceneAssetRegistryEntry> = {}
  if (!document || typeof document !== 'object') {
    return out
  }

  const applyEntries = (entries: Record<string, SceneAssetRegistryEntry | SceneAssetOverrideEntry> | null | undefined): void => {
    if (!entries || typeof entries !== 'object') {
      return
    }
    Object.entries(entries).forEach(([assetId, entry]) => {
      if (!entry || typeof entry !== 'object') {
        return
      }
      out[assetId] = { ...entry }
    })
  }

  applyEntries(document.assetRegistry ?? undefined)
  applyEntries(document.projectOverrideAssets ?? undefined)
  applyEntries(document.sceneOverrideAssets ?? undefined)
  return out
}

function collectRuntimeRetainedConfigAssetIds(
  document: SceneJsonExportDocument | null | undefined,
): Set<string> {
  if (!document || typeof document !== 'object' || !('assetCatalog' in document)) {
    return new Set<string>()
  }
  return collectRuntimeRequiredConfigAssetIds(document as StoredSceneDocument)
}

async function collectRuntimeRetainedEmbedAssetIds(
  document: SceneExportDocumentWithEditorFields,
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
        const asset = getAssetFromCatalog(assetCatalog, normalizedAssetId)
        let file: File | null = null
        try {
          file = await assetCache.ensureAssetFile(normalizedAssetId, { asset })
        } catch {
          return null
        }
        if (file) {
          return file.text()
        }
        const cacheEntry = assetCache.getEntry(normalizedAssetId)
        if (cacheEntry.status === 'cached' && cacheEntry.blob) {
          return cacheEntry.blob.text()
        }
        return null
      },
      normalizeAssetId: normalizeExportAssetId,
    },
  )

  transitiveDependencyIds.forEach((assetId) => retainedConfigAssetIds.add(assetId))
  return retainedConfigAssetIds
}

function collectLocalAssetIdsForExport(
  document: SceneJsonExportDocument,
  retainedConfigAssetIds: ReadonlySet<string> = new Set<string>(),
  options: { packageMode?: ScenePackageExportMode } = {},
): string[] {
  const localIds = new Set<string>()
  const effectiveRegistry = buildEffectiveAssetRegistry(document)
  const exportDocument = document as SceneExportDocumentWithEditorFields
  const packageMode = options.packageMode ?? 'runtime'
  const shouldApplyRuntimeFilter = packageMode === 'runtime'

  Object.entries(effectiveRegistry).forEach(([assetId, entry]) => {
    const normalized = typeof assetId === 'string' ? assetId.trim() : ''
    if (!normalized) {
      return
    }
    if (shouldApplyRuntimeFilter && shouldSkipRuntimeExportAsset(exportDocument, normalized, retainedConfigAssetIds)) {
      return
    }
    if (packageMode !== 'source' && entry.sourceType !== 'package') {
      return
    }
    localIds.add(normalized)
  })

  return Array.from(localIds)
}

function collectScenePackageAssetIdsForExport(
  document: SceneExportDocumentWithEditorFields,
  retainedConfigAssetIds: ReadonlySet<string>,
  options: { packageMode?: ScenePackageExportMode } = {},
): string[] {
  const packageAssetIds = new Set<string>(collectLocalAssetIdsForExport(document, retainedConfigAssetIds, options))
  collectPrefabAssetIdsFromSceneReferences(document as StoredSceneDocument, document.assetCatalog ?? {})
    .forEach((assetId) => packageAssetIds.add(assetId))
  return Array.from(packageAssetIds)
}

function buildPackagedAssetPathMap(
  sharedAssetPathById: ReadonlyMap<string, string>,
  resources: ScenePackageResourceEntry[],
): Map<string, string> {
  const packagedAssetPathById = new Map<string, string>(sharedAssetPathById)
  resources.forEach((entry) => {
    packagedAssetPathById.set(entry.logicalId, entry.path)
  })
  return packagedAssetPathById
}

export type ScenePackageExportScene = {
  id: string
  document: SceneJsonExportDocument
  planningData?: PlanningSceneData | null
}

export type ScenePackagePlanningDataMode = 'withPlanningData' | 'withoutPlanningData'
export type ScenePackageExportMode = 'runtime' | 'source'

// inferExtFromMimeType moved to @schema (assetTypeConversion)

function inferExtFromFilename(filename: string | null | undefined): string | null {
  const raw = typeof filename === 'string' ? filename.trim() : ''
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot <= 0 || dot >= raw.length - 1) return null
  return raw.slice(dot + 1).toLowerCase()
}

function jsonBytes(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value))
}

async function buildTerrainDatasetPackageFiles(
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

  const terrainRoot = `scenes/${encodeURIComponent(normalizedSceneId)}/terrain`
  const rootManifestPath = buildQuantizedTerrainRootManifestPath(terrainRoot)
  const regionsPath = `${terrainRoot}/regions`
  const files: Record<string, Uint8Array> = {
    [rootManifestPath]: serializeQuantizedTerrainDatasetRootManifest(manifest),
  }

  for (const region of manifest.regions ?? []) {
    const regionKey = typeof region.regionKey === 'string' ? region.regionKey.trim() : ''
    if (!regionKey) {
      continue
    }

    const regionPack = await loadRegionPack(regionKey)
    if (!regionPack) {
      throw new Error(`Missing terrain dataset region pack for scene ${normalizedSceneId} (${regionKey})`)
    }

    const regionPath = typeof region.path === 'string' && region.path.trim().length > 0
      ? region.path.trim()
      : buildQuantizedTerrainRegionPackPath(region.regionId, regionsPath)
    files[regionPath] = new Uint8Array(regionPack)
  }

  return {
    rootManifestPath,
    regionsPath: `${regionsPath}/`,
    manifest,
    files,
  }
}

type ResolvedEmbedAsset = {
  assetId: string
  downloadUrl: string | null
  mimeTypeHint?: string | null
  filenameHint?: string | null
  extensionHint?: string | null
}

type SceneResourceSummaryAsset = {
  assetId?: string | null
  downloadUrl?: string | null
  mimeType?: string | null
  filename?: string | null
}

type SceneResourceSummary = {
  assets?: SceneResourceSummaryAsset[] | null
  unknownAssetIds?: string[] | null
  excludedAssetIds?: string[] | null
}

type SceneExportDocumentWithEditorFields = SceneJsonExportDocument & {
  assetUrlOverrides?: Record<string, string>
  resourceSummary?: SceneResourceSummary
  planningData?: unknown
  assetCatalog?: Record<string, ProjectAsset[]>
}

function getAssetFromCatalog(
  catalog: Record<string, ProjectAsset[]> | null | undefined,
  assetId: string,
  assetAliases: ReadonlyMap<string, string> | null | undefined = null,
): ProjectAsset | null {
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
  document: SceneExportDocumentWithEditorFields,
  assetId: string,
  retainedConfigAssetIds: ReadonlySet<string> = new Set<string>(),
  assetAliases: ReadonlyMap<string, string> | null | undefined = null,
): boolean {
  const asset = getAssetFromCatalog(document.assetCatalog, assetId, assetAliases)
  return shouldExcludeAssetFromRuntimeExport(asset, { assetId, retainedConfigAssetIds })
}

type AssetEventContext = {
  assetType?: string | null
  assetSourceType?: string | null
  assetSourceLabel?: string | null
  assetReferenceCount?: number | null
  detail?: string | null
}

function emitSceneExportEvent(reportEvent: SceneExportEventReporter | undefined, event: Parameters<SceneExportEventReporter>[0]): void {
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

function describeSceneName(scene: ScenePackageExportScene): string {
  const rawName = typeof scene.document?.name === 'string' ? scene.document.name.trim() : ''
  return rawName || scene.id
}

function resolveEmbedAssetExtensionHint(asset: ProjectAsset | null | undefined): string | null {
  const extension = resolveProjectAssetExtension(asset ?? null)
  return extension || null
}

function cloneSceneExportDocument<T>(document: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(document)
  }
  return JSON.parse(JSON.stringify(document)) as T
}

function formatAssetReferenceLabel(
  reference: SceneAssetReferenceSummary['references'][number],
  sceneName?: string | null,
): string {
  const segments: string[] = []
  if (sceneName) {
    segments.push(sceneName)
  }
  if (reference.nodeName || reference.nodeId) {
    segments.push(reference.nodeName ? `${reference.nodeName}(${reference.nodeId ?? 'unknown'})` : (reference.nodeId ?? 'unknown-node'))
  } else {
    segments.push(reference.category)
  }
  segments.push(reference.path)
  return segments.join(' -> ')
}

function buildAssetEventContext(
  summary: SceneAssetReferenceSummary | null | undefined,
  packagedPath: string,
  sceneName?: string | null,
): AssetEventContext {
  const referenceLabels = summary?.references.slice(0, 3).map((reference) => formatAssetReferenceLabel(reference, sceneName)) ?? []
  const detailParts = [
    `packaged=${packagedPath}`,
    summary?.assetType ? `type=${summary.assetType}` : null,
    summary?.sourceType ? `sourceType=${summary.sourceType}` : null,
    summary?.sourceLabel ? `source=${summary.sourceLabel}` : null,
    typeof summary?.referenceCount === 'number' ? `references=${summary.referenceCount}` : null,
    referenceLabels.length ? `paths=${referenceLabels.join(' | ')}` : null,
  ].filter((value): value is string => Boolean(value))

  return {
    assetType: summary?.assetType ? String(summary.assetType) : null,
    assetSourceType: summary?.sourceType ? String(summary.sourceType) : null,
    assetSourceLabel: summary?.sourceLabel ?? null,
    assetReferenceCount: summary?.referenceCount ?? null,
    detail: detailParts.join('\n') || null,
  }
}

function buildCombinedAssetEventContext(
  assetId: string,
  scenes: ScenePackageExportScene[],
  summaryMaps: Map<string, Map<string, SceneAssetReferenceSummary>>,
  packagedPath: string,
): AssetEventContext {
  const matchedSummaries = scenes
    .map((scene) => ({
      sceneName: describeSceneName(scene),
      summary: summaryMaps.get(scene.id)?.get(assetId) ?? null,
    }))
    .filter((entry) => entry.summary)

  const first = matchedSummaries[0]?.summary ?? null
  const referenceLabels = matchedSummaries.flatMap((entry) =>
    entry.summary?.references.slice(0, 2).map((reference) => formatAssetReferenceLabel(reference, entry.sceneName)) ?? [],
  )
  const totalReferenceCount = matchedSummaries.reduce((sum, entry) => sum + (entry.summary?.referenceCount ?? 0), 0)
  const detailParts = [
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
    detail: detailParts.join('\n') || null,
  }
}

function stripGroundBakedTextureAssetIds(groundNode: SceneJsonExportDocument['nodes'][number] | null | undefined): void {
  if (!groundNode || typeof groundNode !== 'object') {
    return
  }

  const dynamicMesh = (groundNode as { dynamicMesh?: Record<string, unknown> | null }).dynamicMesh
  if (!dynamicMesh || typeof dynamicMesh !== 'object') {
    return
  }

  if ('groundSurfaceChunks' in dynamicMesh) {
    dynamicMesh.groundSurfaceChunks = null
  }
  if ('groundSplatBake' in dynamicMesh) {
    dynamicMesh.groundSplatBake = null
  }
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

function requiresGroundSplatSidecar(groundNode: SceneJsonExportDocument['nodes'][number] | null | undefined): boolean {
  if (!groundNode || typeof groundNode !== 'object') {
    return false
  }

  const dynamicMesh = groundNode.dynamicMesh as GroundDynamicMesh | { type?: string } | null | undefined
  if (dynamicMesh?.type !== 'Ground') {
    return false
  }

  const groundDynamicMesh = dynamicMesh as GroundDynamicMesh
  if (groundDynamicMesh.groundSurfaceChunks && Object.keys(groundDynamicMesh.groundSurfaceChunks).length > 0) {
    return true
  }
  if (groundDynamicMesh.groundSplatBake?.chunkTextureMap && Object.keys(groundDynamicMesh.groundSplatBake.chunkTextureMap).length > 0) {
    return true
  }
  return false
}

async function prepareSceneDocumentForPackageExport(
  document: SceneJsonExportDocument,
  options: { preserveLandformNodes?: boolean; packageMode?: ScenePackageExportMode } = {},
): Promise<SceneJsonExportDocument> {
  const cloned = cloneSceneExportDocument(document) as SceneExportDocumentWithEditorFields
  if (!cloned || typeof cloned !== 'object') {
    return document
  }

  const packageMode = options.packageMode ?? 'runtime'
  if (packageMode === 'runtime') {
    if (options.preserveLandformNodes !== true) {
      stripLandformNodes(cloned.nodes ?? [])
      assertNoLandformNodes(cloned.nodes ?? [])
    }
  }
  const looksEditableScene = 'assetCatalog' in cloned
  if (!looksEditableScene) {
    return cloned
  }
  const editable = packageMode === 'runtime'
    ? cloneSceneDocumentWithRuntimeGroundSidecars(cloned as StoredSceneDocument)
    : cloned
  editable.assetRegistry = await buildAssetRegistryForExport(editable as StoredSceneDocument, { packageMode })
  editable.resourceSummary = await calculateSceneResourceSummary(editable as StoredSceneDocument, { embedResources: true })

  const unknownAssetIds = Array.isArray(editable.resourceSummary?.unknownAssetIds)
    ? editable.resourceSummary.unknownAssetIds
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => value.length > 0)
    : []

  if (unknownAssetIds.length) {
    let registryPatched = false
    await Promise.all(
      unknownAssetIds.map(async (assetId) => {
        try {
          const registryEntry = editable.assetRegistry?.[assetId]
          const serverAssetId =
            registryEntry?.sourceType === 'server' && typeof registryEntry.serverAssetId === 'string' && registryEntry.serverAssetId.trim().length
              ? registryEntry.serverAssetId.trim()
              : assetId
          const serverAsset = await fetchResourceAsset(serverAssetId)
          const mapped = mapServerAssetToProjectAsset(serverAsset)
          const downloadUrl = typeof mapped.downloadUrl === 'string' ? mapped.downloadUrl.trim() : ''
          if (!downloadUrl) {
            return
          }
          editable.assetRegistry = {
            ...(editable.assetRegistry ?? {}),
            [assetId]: {
              sourceType: 'url',
              url: downloadUrl,
            },
          }
          registryPatched = true
        } catch (error) {
          console.warn('Failed to resolve export asset download URL', {
            registryAssetId: assetId,
            serverAssetId: editable.assetRegistry?.[assetId]?.sourceType === 'server' && typeof editable.assetRegistry?.[assetId]?.serverAssetId === 'string'
              ? editable.assetRegistry[assetId].serverAssetId
              : assetId,
            sourceType: editable.assetRegistry?.[assetId]?.sourceType ?? null,
            error,
          })
          // Keep unresolved ids; downstream export will report explicit missing downloadUrl if still required.
        }
      }),
    )

    if (registryPatched) {
      editable.resourceSummary = await calculateSceneResourceSummary(editable as StoredSceneDocument, { embedResources: true })
    }
  }

  return editable
}

function stripEditorOnlySceneFields(
  document: SceneExportDocumentWithEditorFields,
  retainedConfigAssetIds: ReadonlySet<string> = new Set<string>(),
  options: { includePlanningData?: boolean } = {},
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

  if (document.projectOverrideAssets) {
    document.projectOverrideAssets = filterAssetMap(document.projectOverrideAssets) ?? {}
  }
  if (document.sceneOverrideAssets) {
    document.sceneOverrideAssets = filterAssetMap(document.sceneOverrideAssets) ?? {}
  }
  if (Array.isArray(document.resourceSummary?.assets)) {
    document.resourceSummary.assets = document.resourceSummary.assets.filter((entry) => {
      const assetId = typeof entry?.assetId === 'string' ? entry.assetId.trim() : ''
      return !assetId || !shouldSkipRuntimeExportAsset(document, assetId, retainedConfigAssetIds)
    })
  }
  if (Array.isArray(document.resourceSummary?.unknownAssetIds)) {
    document.resourceSummary.unknownAssetIds = document.resourceSummary.unknownAssetIds.filter((assetId) => {
      const normalizedAssetId = typeof assetId === 'string' ? assetId.trim() : ''
      return !normalizedAssetId || !shouldSkipRuntimeExportAsset(document, normalizedAssetId, retainedConfigAssetIds)
    })
  }
  if (Array.isArray(document.resourceSummary?.excludedAssetIds)) {
    document.resourceSummary.excludedAssetIds = document.resourceSummary.excludedAssetIds.filter((assetId) => {
      const normalizedAssetId = typeof assetId === 'string' ? assetId.trim() : ''
      return Boolean(normalizedAssetId)
    })
  }
  if ('assetUrlOverrides' in document) {
    delete document.assetUrlOverrides
  }
  if ('resourceSummary' in document) {
    delete document.resourceSummary
  }
  if (!options.includePlanningData && 'planningData' in document) {
    delete document.planningData
  }

}

async function collectEmbedAssetsFromScenes(
  scenes: ScenePackageExportScene[],
  options: { includeAllRuntimeAssets: boolean },
): Promise<Map<string, ResolvedEmbedAsset>> {
  const out = new Map<string, ResolvedEmbedAsset>()

  for (const scene of scenes) {
    const doc = scene?.document as SceneExportDocumentWithEditorFields | null | undefined
    if (!doc || typeof doc !== 'object') {
      continue
    }
    const retainedConfigAssetIds = await collectRuntimeRetainedEmbedAssetIds(doc)

    const effectiveRegistry = buildEffectiveAssetRegistry(doc)
    const assetAliases = buildAssetRegistryAliasMap(effectiveRegistry)
    const resourceAssets = Array.isArray(doc.resourceSummary?.assets) ? doc.resourceSummary.assets : []

    // Prefer resourceSummary entries (they often include downloadUrl).
    const entryHasLocalSource = (assetId: string): boolean => {
      const entry = effectiveRegistry[assetId]
      if (!entry || entry.sourceType !== 'package') {
        return false
      }
      const zipPath = typeof entry.zipPath === 'string' ? entry.zipPath.trim() : ''
      return zipPath.startsWith('local::')
    }

    for (const item of resourceAssets) {
      const assetId = typeof item?.assetId === 'string' ? item.assetId.trim() : ''
      if (!assetId) continue
      const canonicalAssetId = assetAliases.get(assetId) ?? assetId
      if (shouldSkipRuntimeExportAsset(doc, canonicalAssetId, retainedConfigAssetIds, assetAliases)) continue
      if (!options.includeAllRuntimeAssets && !retainedConfigAssetIds.has(canonicalAssetId)) continue
      const downloadUrl = typeof item?.downloadUrl === 'string' ? item.downloadUrl.trim() : ''
      if (!downloadUrl) continue
      const asset = getAssetFromCatalog(doc.assetCatalog, canonicalAssetId, assetAliases)

      // Skip already-known local assets.
      if (entryHasLocalSource(canonicalAssetId)) {
        continue
      }

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

    // Registry-first: collect non-local candidate ids from effective registry.
    for (const [assetId, registryEntry] of Object.entries(effectiveRegistry)) {
      const normalized = typeof assetId === 'string' ? assetId.trim() : ''
      if (!normalized || out.has(normalized)) {
        continue
      }
      const canonicalAssetId = assetAliases.get(normalized) ?? normalized
      if (shouldSkipRuntimeExportAsset(doc, canonicalAssetId, retainedConfigAssetIds, assetAliases)) {
        continue
      }
      if (!options.includeAllRuntimeAssets && !retainedConfigAssetIds.has(canonicalAssetId)) {
        continue
      }

      if (entryHasLocalSource(canonicalAssetId)) {
        continue
      }

      let downloadUrl: string | null = null
      if (registryEntry.sourceType === 'url') {
        const resolvedUrl = typeof registryEntry.url === 'string' ? registryEntry.url.trim() : ''
        if (resolvedUrl) {
          downloadUrl = resolvedUrl
        }
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

  const computed = collectPunchPointsFromNodes(document.nodes)
  return computed.length
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

function buildAssetSourceTotals(scenes: ScenePackageExportScene[]): {
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

function buildProjectExportMetadata(options: {
  createdAt: string
  checkpointTotal: number
  files: Record<string, Uint8Array>
  manifestBytes: number
  projectBytes: number
  project: ProjectExportBundleProjectConfig
  resources: ScenePackageResourceEntry[]
  scenes: ScenePackageExportScene[]
}): ProjectExportBundleMetadata {
  const breakdown: ProjectExportBundleResourceBreakdown = {
    localAssetBytes: 0,
    embeddedAssetBytes: 0,
    planningImageBytes: 0,
    terrainBytes: 0,
    sidecarBytes: 0,
    sceneDocumentBytes: 0,
    manifestBytes: options.manifestBytes,
    projectBytes: options.projectBytes,
    otherBytes: 0,
  }
  const resourcePathSet = new Set(options.resources.map((entry) => entry.path))
  const resourceBytesBySceneId = new Map<string, number>()

  for (const entry of options.resources) {
    const size = resourceEntrySize(entry, options.files)
    if (entry.resourceType === 'localAsset') {
      addBreakdownBytes(breakdown, 'localAssetBytes', size)
    } else if (entry.resourceType === 'planningImage') {
      addBreakdownBytes(breakdown, 'planningImageBytes', size)
    } else if (entry.resourceType === 'other') {
      addBreakdownBytes(breakdown, 'embeddedAssetBytes', size)
    } else {
      addBreakdownBytes(breakdown, 'otherBytes', size)
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
    const size = bytes.byteLength
    if (isSceneDocumentPath(path)) {
      addBreakdownBytes(breakdown, 'sceneDocumentBytes', size)
    } else if (isTerrainPackagePath(path)) {
      addBreakdownBytes(breakdown, 'terrainBytes', size)
    } else if (path === 'manifest.bin') {
      addBreakdownBytes(breakdown, 'manifestBytes', size)
    } else if (path === 'project/project.json') {
      addBreakdownBytes(breakdown, 'projectBytes', size)
    } else if (path.startsWith('scenes/')) {
      addBreakdownBytes(breakdown, 'sidecarBytes', size)
    } else {
      addBreakdownBytes(breakdown, 'otherBytes', size)
    }
  }

  const sceneSummaries = options.scenes.map((scene) => {
    const encodedSceneId = encodeURIComponent(scene.id)
    const sceneRoot = `scenes/${encodedSceneId}/`
    let sceneDocumentBytes = 0
    let sidecarBytes = 0
    for (const [path, bytes] of Object.entries(options.files)) {
      if (!path.startsWith(sceneRoot) || resourcePathSet.has(path)) {
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
      resourceBytes: resourceBytesBySceneId.get(scene.id) ?? 0,
    }
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
    breakdown,
    largestResources: options.resources
      .map((entry) => ({
        logicalId: entry.logicalId,
        resourceType: entry.resourceType,
        path: entry.path,
        size: resourceEntrySize(entry, options.files),
        mimeType: entry.mimeType ?? null,
        ext: entry.ext ?? null,
      }))
      .sort((left, right) => right.size - left.size)
      .slice(0, 10),
    sceneSummaries,
  }
}

async function resolvePlanningImageBlob(image: {
  imageHash?: string | null
  url?: string | null
  mimeType?: string | null
  filename?: string | null
}): Promise<{ blob: Blob; imageHash: string; mimeType: string; filename: string | null } | null> {
  const hash = typeof image.imageHash === 'string' ? image.imageHash.trim() : ''
  if (hash) {
    const blob = await getPlanningImageBlobByHash(hash)
    if (!blob) {
      throw new Error(`Missing planning image resource (imageHash=${hash}); please reopen the planning image before exporting.`)
    }
    return {
      blob,
      imageHash: hash,
      mimeType: image.mimeType ?? blob.type ?? 'application/octet-stream',
      filename: image.filename ?? null,
    }
  }

  const url = typeof image.url === 'string' ? image.url.trim() : ''
  if (!url) {
    return null
  }
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to read planning image from local URL (${response.status})`)
  }
  const blob = await response.blob()
  const buffer = await blob.arrayBuffer()
  const resolvedHash = sha256Hex(buffer)
  return {
    blob: new Blob([buffer], { type: blob.type || image.mimeType || 'application/octet-stream' }),
    imageHash: resolvedHash,
    mimeType: image.mimeType ?? blob.type ?? 'application/octet-stream',
    filename: image.filename ?? null,
  }
}

async function buildPlanningSidecar(
  sceneId: string,
  planningData: PlanningSceneData,
  files: Record<string, Uint8Array>,
  resources: ScenePackageResourceEntry[],
): Promise<{ planningPath: string; sidecar: PlanningScenePackageSidecar }> {
  const encodedSceneId = encodeURIComponent(sceneId)
  const nextPlanningData = structuredClone(planningData) as PlanningSceneData
  const images: PlanningScenePackageImageEntry[] = []
  const resourcePathByHash = new Map<string, string>()

  for (const image of nextPlanningData.images ?? []) {
    const resolved = await resolvePlanningImageBlob(image)
    if (!resolved) {
      images.push({
        imageId: image.id,
        imageHash: typeof image.imageHash === 'string' ? image.imageHash : null,
        resourcePath: null,
        filename: image.filename ?? null,
        mimeType: image.mimeType ?? null,
      })
      continue
    }

    image.imageHash = resolved.imageHash
    image.filename = image.filename ?? resolved.filename ?? null
    image.mimeType = image.mimeType ?? resolved.mimeType
    image.url = ''

    let resourcePath = resourcePathByHash.get(resolved.imageHash) ?? null
    if (!resourcePath) {
      const ext = inferExtFromFilename(image.filename) ?? inferExtFromMimeType(image.mimeType ?? resolved.mimeType) ?? 'bin'
      const safeName = resolved.imageHash.length > 16 ? resolved.imageHash.slice(0, 16) : resolved.imageHash
      resourcePath = `scenes/${encodedSceneId}/planning-resources/${safeName}.${ext}`
      files[resourcePath] = new Uint8Array(await resolved.blob.arrayBuffer())
      resourcePathByHash.set(resolved.imageHash, resourcePath)
      resources.push({
        logicalId: `planningImage::${sceneId}::${image.id}`,
        resourceType: 'planningImage',
        path: resourcePath,
        ext,
        mimeType: image.mimeType ?? resolved.mimeType,
        size: resolved.blob.size,
        hash: resolved.imageHash,
      })
    }

    images.push({
      imageId: image.id,
      imageHash: resolved.imageHash,
      resourcePath,
      filename: image.filename ?? resolved.filename ?? null,
      mimeType: image.mimeType ?? resolved.mimeType,
    })
  }

  let orthophoto: PlanningScenePackageSidecar['orthophoto'] = null
  const orthophotoHash = typeof nextPlanningData.terrain?.dem?.orthophoto?.sourceFileHash === 'string'
    ? nextPlanningData.terrain.dem.orthophoto.sourceFileHash.trim()
    : ''
  if (orthophotoHash) {
    const orthophotoBlob = await loadPlanningDemBlobByHash(orthophotoHash)
    if (!orthophotoBlob) {
      throw new Error(`Missing planning orthophoto resource (imageHash=${orthophotoHash}); please reopen the orthophoto before exporting.`)
    }
    const orthophotoMimeType = nextPlanningData.terrain?.dem?.orthophoto?.mimeType ?? orthophotoBlob.type ?? 'application/octet-stream'
    const orthophotoFilename = nextPlanningData.terrain?.dem?.orthophoto?.filename ?? 'orthophoto'
    const orthophotoExt = inferExtFromFilename(orthophotoFilename) ?? inferExtFromMimeType(orthophotoMimeType) ?? 'bin'
    const safeName = orthophotoHash.length > 16 ? orthophotoHash.slice(0, 16) : orthophotoHash
    const orthophotoPath = `scenes/${encodedSceneId}/planning-resources/${safeName}.${orthophotoExt}`
    if (!files[orthophotoPath]) {
      files[orthophotoPath] = new Uint8Array(await orthophotoBlob.arrayBuffer())
      resources.push({
        logicalId: `planningOrthophoto::${sceneId}`,
        resourceType: 'planningImage',
        path: orthophotoPath,
        ext: orthophotoExt,
        mimeType: orthophotoMimeType,
        size: orthophotoBlob.size,
        hash: orthophotoHash,
      })
    }
    orthophoto = {
      sourceFileHash: orthophotoHash,
      resourcePath: orthophotoPath,
      filename: orthophotoFilename,
      mimeType: orthophotoMimeType,
    }
  }

  const planningPath = `scenes/${encodedSceneId}/planning.bin`
  return {
    planningPath,
    sidecar: {
      version: 1,
      planningData: nextPlanningData,
      images,
      orthophoto,
    },
  }
}

export async function exportScenePackageZip(payload: {
  project: ProjectExportBundleProjectConfig
  scenes: ScenePackageExportScene[]
  embedAssets?: boolean
  planningDataMode: ScenePackagePlanningDataMode
  packageMode?: ScenePackageExportMode
  preserveLandformNodes?: boolean
  updateProgress?: (value: number, message?: string) => void
  reportEvent?: SceneExportEventReporter
}): Promise<Blob> {
  const files = await prepareScenePackageZipFiles(payload)
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

export async function prepareScenePackageZipFiles(payload: {
  project: ProjectExportBundleProjectConfig
  scenes: ScenePackageExportScene[]
  embedAssets?: boolean
  planningDataMode: ScenePackagePlanningDataMode
  packageMode?: ScenePackageExportMode
  preserveLandformNodes?: boolean
  updateProgress?: (value: number, message?: string) => void
  reportEvent?: SceneExportEventReporter
}): Promise<Record<string, Uint8Array>> {
  const createdAt = new Date().toISOString()

  const files: Record<string, Uint8Array> = {}

  // project
  const projectPath = 'project/project.json'
  let checkpointTotal = 0
  for (const scene of payload.scenes) {
    checkpointTotal += countSceneCheckpoints(scene.document)
  }
  let projectWithCheckpointTotal: ProjectExportBundleProjectConfig = {
    ...payload.project,
    checkpointTotal,
  }
  emitSceneExportEvent(payload.reportEvent, {
    phase: 'project',
    level: 'info',
    status: 'running',
    message: `已写入工程配置 (${payload.scenes.length} 个场景)`,
    current: payload.scenes.length,
    total: payload.scenes.length,
  })

  // scenes + per-scene resources (referenced local assets)
  const manifestScenes: ScenePackageManifestV1['scenes'] = []
  const assetCache = useAssetCacheStore()
  const scenesStore = useScenesStore()
  const sceneStore = useSceneStore()
  const resources: ScenePackageResourceEntry[] = []
  const sceneReferenceSummaryMaps = new Map<string, Map<string, SceneAssetReferenceSummary>>()
  const includePlanningData = payload.planningDataMode === 'withPlanningData'
  const packageMode = payload.packageMode ?? 'runtime'
  const includeRuntimeData = packageMode === 'runtime'

  payload.scenes.forEach((scene) => {
    const document = scene.document as SceneExportDocumentWithEditorFields
    const effectiveRegistry = buildEffectiveAssetRegistry(document)
    sceneReferenceSummaryMaps.set(
      scene.id,
      buildSceneAssetReferenceSummaryMap(document as any, effectiveRegistry),
    )
  })

  // Shared (project-wide) embedded assets
  const sharedAssetPathById = new Map<string, string>()
  const embedAssets = await collectEmbedAssetsFromScenes(payload.scenes, {
    includeAllRuntimeAssets: payload.embedAssets === true,
  })
  if (embedAssets.size > 0) {
    const total = embedAssets.size
    let done = 0

    emitSceneExportEvent(payload.reportEvent, {
      phase: 'asset',
      level: 'info',
      status: total > 0 ? 'running' : 'completed',
      message: total > 0 ? `开始处理共享嵌入资产 (${total})` : '没有需要嵌入的共享资产',
      current: 0,
      total,
    })

    for (const item of embedAssets.values()) {
      const assetName = describeAssetName(item.assetId, item.filenameHint)
      emitSceneExportEvent(payload.reportEvent, {
        phase: 'asset',
        level: 'info',
        status: 'running',
        assetId: item.assetId,
        assetName,
        current: done + 1,
        total,
        message: `正在嵌入共享资产 ${assetName}`,
      })

      done += 1
      const ratio = total > 0 ? done / total : 1
      payload.updateProgress?.(85 + Math.round(6 * ratio), `Embedding assets… (${done}/${total})`)

      // Prefer cached blob to avoid refetch.
      let blob: Blob | null = null
      let mimeType = item.mimeTypeHint ?? null
      let filename = item.filenameHint ?? null

      const cached = assetCache.getEntry(item.assetId)
      if (cached?.status === 'cached' && cached.blob) {
        blob = cached.blob
        mimeType = cached.mimeType ?? blob.type ?? mimeType
        filename = cached.filename ?? filename
      }

      if (!blob) {
        if (!item.downloadUrl) {
          continue;
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

      // Store in a shared folder (`resources/`); stable hashed name to avoid path issues.
      const hash = await sha256Hex(item.assetId)
      const safeName = hash.length > 16 ? hash.slice(0, 16) : hash
      const resourcePath = `resources/${safeName}.${ext}`
      const assetContext = buildCombinedAssetEventContext(item.assetId, payload.scenes, sceneReferenceSummaryMaps, resourcePath)

      // De-dup: if two ids map to same path (shouldn't), last one wins.
      files[resourcePath] = bytes
      sharedAssetPathById.set(item.assetId, resourcePath)
      resources.push({
        logicalId: item.assetId,
        resourceType: 'other',
        path: resourcePath,
        ext,
        mimeType: mimeType ?? 'application/octet-stream',
        size: blob.size,
        hash,
      })
      emitSceneExportEvent(payload.reportEvent, {
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
        message: `共享资产已写入 ${assetName}`,
      })
    }
  }

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
      message: `开始打包场景 ${sceneName}`,
    })
    const preparedDocument = await prepareSceneDocumentForPackageExport(scene.document, {
      preserveLandformNodes: payload.preserveLandformNodes === true || packageMode === 'source',
      packageMode,
    })
    const scenePath = `scenes/${encodeURIComponent(scene.id)}/scene.bin`
    let planningPath: string | undefined
    let groundSplatPath: string | undefined
    let groundScatterPath: string | undefined
    let terrain: ScenePackageManifestV1['scenes'][number]['terrain'] | undefined
    let compiledGround: ScenePackageManifestV1['scenes'][number]['compiledGround'] | undefined
    let roadCollision: ScenePackageManifestV1['scenes'][number]['roadCollision'] | undefined
    const groundNode = resolveDocumentGroundNode(preparedDocument)
    const hasGroundSplatSidecarRequirement = requiresGroundSplatSidecar(groundNode)
    const storedTerrainDatasetManifest = await scenesStore.loadTerrainDatasetManifest(scene.id)
    const groundSplatSidecar = includeRuntimeData
      ? useGroundSplatStore().buildSceneDocumentSidecar(scene.id, groundNode)
        ?? await scenesStore.loadGroundSplatSidecar(scene.id)
      : null
    const groundScatterSidecar = scene.id === sceneStore.currentSceneId
          ? useGroundScatterStore().buildSceneDocumentSidecar(scene.id, groundNode)
          : await scenesStore.loadGroundScatterSidecar(scene.id)
    if (includeRuntimeData && groundNode?.dynamicMesh?.type === 'Ground') {
      const compiledGroundStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const compiledGroundBuildKey = computeSceneCompiledGroundBuildKey(
        scene.id,
        groundNode.dynamicMesh,
        storedTerrainDatasetManifest?.datasetId ?? null,
      )
      const compiledGroundSourceSignature = computeSceneCompiledGroundSourceSignature(
        scene.id,
        groundNode.dynamicMesh,
        storedTerrainDatasetManifest?.datasetId ?? null,
      )
      emitSceneExportEvent(payload.reportEvent, {
        phase: 'sidecar',
        level: 'info',
        status: 'running',
        sceneId: scene.id,
        sceneName,
        detail: compiledGroundBuildKey,
        message: 'Loading compiled ground cache...',
      })
      const cacheLoad = await loadSceneCompiledGroundPackageFromCache(compiledGroundBuildKey, {
        sourceSignature: compiledGroundSourceSignature,
      })
      const compiledGroundPackage = cacheLoad.pkg
      if (compiledGroundPackage) {
        const compiledGroundPaths = resolveSceneCompiledGroundPackagePaths(scene.id)
        compiledGround = {
          manifestPath: compiledGroundPaths.manifestPath,
          renderRootPath: compiledGroundPaths.renderRootPath,
          collisionRootPath: compiledGroundPaths.collisionRootPath,
        }
        files[compiledGroundPaths.manifestPath] = serializeCompiledGroundManifest(compiledGroundPackage.manifest)
        Object.assign(files, getSceneCompiledGroundPackageFileBytes(compiledGroundPackage))
        groundNode.userData = {
          ...(groundNode.userData ?? {}),
          compiledGroundEnabled: true,
          compiledGroundManifest: compiledGroundPackage.manifest,
        }
        
        emitSceneExportEvent(payload.reportEvent, {
          phase: 'sidecar',
          level: 'info',
          status: 'completed',
          sceneId: scene.id,
          sceneName,
          detail: compiledGroundPaths.manifestPath,
          message: `Compiled ground cache packaged (${Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - compiledGroundStartedAt)} ms)`,
        })
      } else {
        const shouldRequireCompiledGround =  hasSceneGroundTerrainOverrides(groundNode.dynamicMesh)
        if (shouldRequireCompiledGround) {
          throw new Error(
            cacheLoad.diagnostics.status === 'partial' || cacheLoad.diagnostics.status === 'corrupt'
              ? `Compiled ground cache is invalid for scene ${scene.id}. Reopen the scene in editor to rebuild terrain cache before export.`
              : `Compiled ground cache is missing for scene ${scene.id}. Open the scene in editor to build terrain cache before export.`,
          )
        }

        emitSceneExportEvent(payload.reportEvent, {
          phase: 'sidecar',
          level: 'info',
          status: 'skipped',
          sceneId: scene.id,
          sceneName,
          message: 'Skipped compiled ground cache packaging for empty scene terrain.',
        })
      }

      const packagedTerrainDataset = await buildTerrainDatasetPackageFiles(
        scene.id,
        storedTerrainDatasetManifest,
        (regionKey) => scenesStore.loadTerrainDatasetRegionPack(scene.id, regionKey),
      )
      if (packagedTerrainDataset) {
        terrain = {
          datasetId: packagedTerrainDataset.manifest.datasetId,
          rootManifestPath: packagedTerrainDataset.rootManifestPath,
          regionsPath: packagedTerrainDataset.regionsPath,
        }
        files[packagedTerrainDataset.rootManifestPath] = serializeQuantizedTerrainDatasetRootManifest(packagedTerrainDataset.manifest)
        Object.assign(files, packagedTerrainDataset.files)
        emitSceneExportEvent(payload.reportEvent, {
          phase: 'sidecar',
          level: 'info',
          status: 'completed',
          sceneId: scene.id,
          sceneName,
          detail: packagedTerrainDataset.rootManifestPath,
          message: `已写入 quantized terrain dataset`,
        })
      }
    }
    if (includeRuntimeData && hasGroundSplatSidecarRequirement && !groundSplatSidecar) {
      throw new Error(`Ground baked splat sidecar is required for scene ${scene.id} before export.`)
    }
    if (includeRuntimeData) {
      const roadCollisionExport = buildRoadCollisionCompiledExport(preparedDocument as SceneJsonExportDocument)
      if (roadCollisionExport.manifest.roads.length > 0) {
        roadCollision = {
          manifestPath: roadCollisionExport.manifestPath,
        }
        attachRoadCollisionCompiledPackagesToDocument(
          preparedDocument as SceneJsonExportDocument,
          roadCollisionExport.packagesByNodeId,
        )
        Object.assign(files, roadCollisionExport.files)
        emitSceneExportEvent(payload.reportEvent, {
          phase: 'sidecar',
          level: 'info',
          status: 'completed',
          sceneId: scene.id,
          sceneName,
          detail: roadCollisionExport.manifestPath,
          message: `Road collision cache packaged (${roadCollisionExport.manifest.roads.length})`,
        })
      }
    }
    stripGroundHeightMapsFromSceneDocument(preparedDocument as StoredSceneDocument)
    const docClone = preparedDocument as SceneExportDocumentWithEditorFields
    const retainedConfigAssetIds = collectRuntimeRetainedConfigAssetIds(docClone)
    if (packageMode === 'runtime') {
      stripEditorOnlySceneFields(docClone, retainedConfigAssetIds, { includePlanningData })
    }
    const localAssetIds = collectScenePackageAssetIdsForExport(docClone, retainedConfigAssetIds, { packageMode })
    const sceneAssetReferenceSummaries = sceneReferenceSummaryMaps.get(scene.id) ?? new Map<string, SceneAssetReferenceSummary>()
    const excludedAssetIds = Array.isArray(docClone.resourceSummary?.excludedAssetIds)
      ? docClone.resourceSummary.excludedAssetIds
          .map((assetId) => (typeof assetId === 'string' ? assetId.trim() : ''))
          .filter((assetId) => assetId.length > 0)
      : []

    if (excludedAssetIds.length) {
      emitSceneExportEvent(payload.reportEvent, {
        phase: 'asset',
        level: 'warning',
        status: 'skipped',
        sceneId: scene.id,
        sceneName,
        current: excludedAssetIds.length,
        total: excludedAssetIds.length,
        detail: excludedAssetIds.join(', '),
        message: `已跳过 ${excludedAssetIds.length} 个仅编辑器配置资产`,
      })
    }

    if (!Array.isArray(docClone.punchPoints) || docClone.punchPoints.length === 0) {
      const computedPunchPoints = collectPunchPointsFromNodes(docClone.nodes)
      if (computedPunchPoints.length) {
        docClone.punchPoints = computedPunchPoints
      }
    }

    for (let aIndex = 0; aIndex < localAssetIds.length; aIndex += 1) {
      const assetId = localAssetIds[aIndex]!
      const cachedEntry = assetCache.getEntry(assetId)
      const assetName = describeAssetName(assetId, cachedEntry.filename)
      emitSceneExportEvent(payload.reportEvent, {
        phase: 'asset',
        level: 'info',
        status: 'running',
        sceneId: scene.id,
        sceneName,
        assetId,
        assetName,
        current: aIndex + 1,
        total: localAssetIds.length,
        message: `正在打包本地资产 ${assetName}`,
      })
      const ratio = localAssetIds.length ? (aIndex + 1) / localAssetIds.length : 1
      payload.updateProgress?.(85 + Math.round(10 * ratio), `Packaging local assets… (${aIndex + 1}/${localAssetIds.length})`)

      let entry = assetCache.getEntry(assetId)
      if (entry.status !== 'cached' || !entry.blob) {
        await assetCache.ensureAssetEntry(assetId)
        entry = assetCache.getEntry(assetId)
      }
      if (entry.status !== 'cached' || !entry.blob) {
        continue
        // throw new Error(`Missing local asset resource (assetId=${assetId}); please ensure the local asset has been written to IndexedDB before exporting.`)
      }

      const blob = entry.blob
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const mimeType = entry.mimeType ?? blob.type ?? 'application/octet-stream'
      const ext = inferExtFromFilename(entry.filename) ?? inferExtFromMimeType(mimeType) ?? 'bin'
      const hash = await sha256Hex(assetId)
      const safeName = hash.length > 16 ? hash.slice(0, 16) : hash

      // Place resources under the corresponding scene directory
      const resourcePath = isBuiltinWaterNormalAsset(assetId)
        ? `scenes/${encodeURIComponent(scene.id)}/resources/${BUILTIN_WATER_NORMAL_FILENAME}`
        : `scenes/${encodeURIComponent(scene.id)}/resources/${safeName}.${ext}`
      const assetContext = buildAssetEventContext(sceneAssetReferenceSummaries.get(assetId), resourcePath, sceneName)

      files[resourcePath] = bytes
      resources.push({
        logicalId: assetId,
        resourceType: 'localAsset',
        path: resourcePath,
        ext,
        mimeType,
        size: blob.size,
        hash,
      })
      if (docClone.assetRegistry?.[assetId]?.sourceType === 'package') {
        docClone.assetRegistry[assetId] = {
          ...docClone.assetRegistry[assetId],
          zipPath: resourcePath,
        }
      }
      emitSceneExportEvent(payload.reportEvent, {
        phase: 'asset',
        level: 'success',
        status: 'completed',
        sceneId: scene.id,
        sceneName,
        assetId,
        assetName,
        assetType: assetContext.assetType,
        assetSourceType: assetContext.assetSourceType,
        assetSourceLabel: assetContext.assetSourceLabel,
        assetReferenceCount: assetContext.assetReferenceCount,
        current: aIndex + 1,
        total: localAssetIds.length,
        detail: assetContext.detail,
        message: `本地资产已写入 ${assetName}`,
      })
    }

    const packagedAssetPathById = buildPackagedAssetPathMap(sharedAssetPathById, resources)
    if (docClone.assetRegistry) {
      Object.entries(docClone.assetRegistry).forEach(([assetId, entry]) => {
        const packagedPath = packagedAssetPathById.get(assetId)
        if (!packagedPath || !entry) {
          return
        }
        docClone.assetRegistry![assetId] = {
          sourceType: 'package',
          zipPath: packagedPath,
          inline: entry.sourceType === 'package' ? entry.inline : undefined,
          bytes: entry.bytes,
          assetType: entry.assetType,
          name: entry.name,
        }
      })
    }
    if (packageMode !== 'runtime') {
      stripGroundRuntimeUserData(groundNode)
    }
    stripGroundBakedTextureAssetIds(groundNode)
    if (packageMode === 'runtime') {
      stripEditorOnlySceneFields(docClone, retainedConfigAssetIds, { includePlanningData })
    }
    // Add the prepared binary scene document to files and manifest.
    files[scenePath] = encodeScenePackageSceneDocument(docClone)
    emitSceneExportEvent(payload.reportEvent, {
      phase: 'scene',
      level: 'success',
      status: 'completed',
      sceneId: scene.id,
      sceneName,
      current: sIndex + 1,
      total: payload.scenes.length,
      detail: scenePath,
      message: `场景二进制已写入 ${sceneName}`,
    })
    if (groundSplatSidecar) {
      groundSplatPath = `scenes/${encodeURIComponent(scene.id)}/${GROUND_SPLAT_SIDECAR_FILENAME}`
      files[groundSplatPath] = new Uint8Array(groundSplatSidecar)
      emitSceneExportEvent(payload.reportEvent, {
        phase: 'sidecar',
        level: 'info',
        status: 'completed',
        sceneId: scene.id,
        sceneName,
        detail: groundSplatPath,
        message: `已写入 ground splat sidecar`,
      })
    }
    if (groundScatterSidecar) {
      groundScatterPath = `scenes/${encodeURIComponent(scene.id)}/${GROUND_SCATTER_SIDECAR_FILENAME}`
      files[groundScatterPath] = new Uint8Array(groundScatterSidecar)
      emitSceneExportEvent(payload.reportEvent, {
        phase: 'sidecar',
        level: 'info',
        status: 'completed',
        sceneId: scene.id,
        sceneName,
        detail: groundScatterPath,
        message: `已写入地表散布 sidecar`,
      })
    }
    if (includePlanningData && scene.planningData) {
      const planningSidecar = await buildPlanningSidecar(scene.id, scene.planningData, files, resources)
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
      groundSplatPath,
      groundScatterPath,
      terrain,
      compiledGround,
      roadCollision,
    })
  }

  const manifest: ScenePackageManifestV1 = {
    format: SCENE_PACKAGE_FORMAT,
    version: SCENE_PACKAGE_VERSION,
    createdAt,
    project: { path: projectPath },
    scenes: manifestScenes,
    resources,
  }

  const manifestBytes = serializeScenePackageManifest(manifest)
  let projectBytes = jsonBytes(projectWithCheckpointTotal)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const metadata = buildProjectExportMetadata({
      createdAt,
      checkpointTotal,
      files,
      manifestBytes: manifestBytes.byteLength,
      projectBytes: projectBytes.byteLength,
      project: projectWithCheckpointTotal,
      resources,
      scenes: payload.scenes,
    })
    const nextProject = {
      ...projectWithCheckpointTotal,
      metadata,
    }
    const nextProjectBytes = jsonBytes(nextProject)
    projectWithCheckpointTotal = nextProject
    if (nextProjectBytes.byteLength === projectBytes.byteLength) {
      projectBytes = nextProjectBytes
      break
    }
    projectBytes = nextProjectBytes
  }

  files[projectPath] = projectBytes
  files['manifest.bin'] = manifestBytes
  emitSceneExportEvent(payload.reportEvent, {
    phase: 'manifest',
    level: 'info',
    status: 'completed',
    detail: 'manifest.bin',
    message: `清单文件已生成 (${manifest.scenes.length} 个场景, ${manifest.resources.length} 个资源)`,
  })

  emitSceneExportEvent(payload.reportEvent, {
    phase: 'archive',
    level: 'info',
    status: 'running',
    progress: 96,
    detail: 'manifest.bin',
    message: 'ZIP 文件列表已准备完成',
  })
  return files
}

export function createScenePackageZipBlob(files: Record<string, Uint8Array>): Blob {
  const zipBytes = zipSync(files, { level: 6 })
  // fflate returns Uint8Array<ArrayBufferLike> which fails BlobPart typing; copy into ArrayBuffer.
  const zipArrayBuffer = new ArrayBuffer(zipBytes.byteLength)
  new Uint8Array(zipArrayBuffer).set(zipBytes)
  return new Blob([zipArrayBuffer], { type: 'application/zip' })
}
