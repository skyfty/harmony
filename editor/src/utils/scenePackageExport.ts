import { zipSync, strToU8 } from 'fflate'
import type {
  SceneAssetOverrideEntry,
  SceneAssetRegistryEntry,
  SceneJsonExportDocument,
  ProjectExportBundleProjectConfig,
  ProjectExportBundleMetadata,
  ProjectExportBundleResourceBreakdown,
} from '@schema'
import {
  encodeScenePackageSceneDocument,
  formatGroundChunkDataPath,
  GROUND_SCATTER_SIDECAR_FILENAME,
  GROUND_PAINT_SIDECAR_FILENAME,
  parseGroundChunkKey,
  SCENE_PACKAGE_FORMAT,
  SCENE_PACKAGE_VERSION,
  type GroundChunkManifest,
  type ScenePackageManifestV1,
  type ScenePackageResourceEntry,
} from '@schema'
import { inferExtFromMimeType } from '@schema'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { useGroundPaintStore } from '@/stores/groundPaintStore'
import { useGroundScatterStore } from '@/stores/groundScatterStore'
import { useGroundHeightmapStore } from '@/stores/groundHeightmapStore'
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
import { computeSha256Hex, getPlanningImageBlobByHash } from '@/utils/planningImageStorage'
import { fetchResourceAsset } from '@/api/resourceAssets'
import { mapServerAssetToProjectAsset } from '@/api/serverAssetTypes'
import { buildAssetRegistryAliasMap, normalizeAssetIdWithRegistry } from '@/utils/assetRegistryIdNormalization'
import {
  GROUND_HEIGHTMAP_SIDECAR_FILENAME,
  createGroundRuntimeMeshFromSidecar,
  stripGroundHeightMapsFromSceneDocument,
} from '@/utils/groundHeightSidecar'
import { attachOptimizedGroundMeshToDocument } from '@/utils/groundOptimizedMeshExport'
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
  collectRuntimeRequiredConfigAssetIds,
  collectTransitiveConfigDependencyAssetIds,
} from '@/stores/sceneAssetCleanup'

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
): string[] {
  const localIds = new Set<string>()
  const effectiveRegistry = buildEffectiveAssetRegistry(document)
  const exportDocument = document as SceneExportDocumentWithEditorFields

  Object.entries(effectiveRegistry).forEach(([assetId, entry]) => {
    const normalized = typeof assetId === 'string' ? assetId.trim() : ''
    if (!normalized) {
      return
    }
    if (shouldSkipRuntimeExportAsset(exportDocument, normalized, retainedConfigAssetIds)) {
      return
    }
    if (entry.sourceType !== 'package') {
      return
    }
    const zipPath = typeof entry.zipPath === 'string' ? entry.zipPath.trim() : ''
    if (zipPath === `local::${normalized}` || zipPath.startsWith('local::')) {
      localIds.add(normalized)
    }
  })

  return Array.from(localIds)
}

export type ScenePackageExportScene = {
  id: string
  document: SceneJsonExportDocument
  planningData?: PlanningSceneData | null
}

// inferExtFromMimeType moved to @schema (assetTypeConversion)

function inferExtFromFilename(filename: string | null | undefined): string | null {
  const raw = typeof filename === 'string' ? filename.trim() : ''
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot <= 0 || dot >= raw.length - 1) return null
  const ext = raw.slice(dot + 1).toLowerCase().trim()
  return ext.length ? ext : null
}

function jsonBytes(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value, null, 2))
}

async function buildGroundChunkPackageManifest(
  sceneId: string,
  manifest: GroundChunkManifest | null,
  loadChunkData: (chunkKey: string) => Promise<ArrayBuffer | null>,
): Promise<{ manifestPath: string; manifest: GroundChunkManifest; files: Record<string, Uint8Array> } | null> {
  if (!manifest || typeof manifest !== 'object') {
    return null
  }

  const sceneRootPath = `scenes/${encodeURIComponent(sceneId)}`
  const nextChunks: GroundChunkManifest['chunks'] = {}
  const files: Record<string, Uint8Array> = {}

  for (const [chunkKey, record] of Object.entries(manifest.chunks ?? {})) {
    const coord = parseGroundChunkKey(chunkKey)
    if (!coord || !record) {
      continue
    }
    const chunkData = await loadChunkData(chunkKey)
    if (!(chunkData instanceof ArrayBuffer)) {
      continue
    }
    const dataPath = formatGroundChunkDataPath(coord, `${sceneRootPath}/ground/chunks`, 'ground.bin')
    nextChunks[chunkKey] = {
      ...record,
      dataPath,
    }
    files[dataPath] = new Uint8Array(chunkData)
  }

  if (!Object.keys(nextChunks).length) {
    return null
  }

  return {
    manifestPath: `${sceneRootPath}/ground-chunk-manifest.json`,
    manifest: {
      ...manifest,
      sceneId,
      chunks: nextChunks,
    },
    files,
  }
}

async function sha256Hex(input: string): Promise<string> {
  const text = typeof input === 'string' ? input : String(input)
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const bytes = new TextEncoder().encode(text)
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const view = new Uint8Array(digest)
      let out = ''
      for (let i = 0; i < view.length; i += 1) {
        out += view[i]!.toString(16).padStart(2, '0')
      }
      return out
    }
  } catch (_error) {
    // fall through
  }

  // Fallback (non-crypto hash): stable enough for filenames.
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i)
  }
  return `djb2_${(hash >>> 0).toString(16).padStart(8, '0')}`
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

function stripGroundBakedTextureAssetIds(nodes: SceneJsonExportDocument['nodes']): void {
  for (const node of nodes) {
    if (node.dynamicMesh?.type === 'Ground') {
      node.dynamicMesh.terrainPaintBakedTextureAssetId = null
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      stripGroundBakedTextureAssetIds(node.children)
    }
  }
}

async function prepareSceneDocumentForPackageExport(document: SceneJsonExportDocument): Promise<SceneJsonExportDocument> {
  const cloned = cloneSceneExportDocument(document) as SceneExportDocumentWithEditorFields
  if (!cloned || typeof cloned !== 'object') {
    return document
  }
  stripGroundBakedTextureAssetIds(cloned.nodes ?? [])
  const looksEditableScene = 'assetCatalog' in cloned
  if (!looksEditableScene) {
    return cloned
  }
  const editable = cloneSceneDocumentWithRuntimeGroundSidecars(cloned as StoredSceneDocument)
  editable.assetRegistry = await buildAssetRegistryForExport(editable)
  editable.resourceSummary = await calculateSceneResourceSummary(editable, { embedResources: true })

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
      editable.resourceSummary = await calculateSceneResourceSummary(editable, { embedResources: true })
    }
  }

  return editable
}

function findGroundNode(nodes: SceneJsonExportDocument['nodes']): SceneJsonExportDocument['nodes'][number] | null {
  for (const node of nodes) {
    if (node.dynamicMesh?.type === 'Ground') {
      return node
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      const nested = findGroundNode(node.children)
      if (nested) {
        return nested
      }
    }
  }
  return null
}

function emitGroundOptimizationDiagnostics(
  reportEvent: SceneExportEventReporter | undefined,
  sceneId: string,
  sceneName: string,
  groundNode: SceneJsonExportDocument['nodes'][number] | null,
): void {
  const optimizedMesh = groundNode?.dynamicMesh?.type === 'Ground' ? groundNode.dynamicMesh.optimizedMesh : null
  if (!optimizedMesh) {
    return
  }

  const sourceTriangles = Math.max(0, Math.trunc(optimizedMesh.sourceTriangleCount ?? 0))
  const optimizedTriangles = Math.max(0, Math.trunc(optimizedMesh.optimizedTriangleCount ?? 0))
  const reduction = sourceTriangles > 0
    ? Math.max(0, Math.min(1, 1 - optimizedTriangles / sourceTriangles))
    : 0
  const percentText = `${Math.round(reduction * 100)}%`
  const detail = [
    `sourceTriangles=${sourceTriangles}`,
    `optimizedTriangles=${optimizedTriangles}`,
    `chunkCells=${optimizedMesh.chunkCells}`,
    `sourceChunkCells=${optimizedMesh.sourceChunkCells}`,
    `chunkCount=${optimizedMesh.chunkCount}`,
  ].join(', ')

  emitSceneExportEvent(reportEvent, {
    phase: 'diagnostics',
    level: 'info',
    status: 'completed',
    sceneId,
    sceneName,
    detail,
    message: `Ground optimized mesh reduced triangles by ${percentText} (${sourceTriangles} -> ${optimizedTriangles})`,
  })

  if (sourceTriangles > 0 && reduction < 0.15) {
    emitSceneExportEvent(reportEvent, {
      phase: 'diagnostics',
      level: 'warning',
      status: 'completed',
      sceneId,
      sceneName,
      detail,
      message: 'Ground optimized mesh produced limited simplification; inspect terrain flatness and render chunk sizing.',
    })
  }
}

function stripEditorOnlySceneFields(
  document: SceneExportDocumentWithEditorFields,
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

  if (document.assetRegistry) {
    document.assetRegistry = filterAssetMap(document.assetRegistry) ?? {}
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
  if ('planningData' in document) {
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
    } else if (entry.resourceType === 'terrainWeightmap') {
      addBreakdownBytes(breakdown, 'terrainBytes', size)
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
    } else if (path === 'manifest.json') {
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
  const resolvedHash = await computeSha256Hex(buffer)
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
  const nextPlanningData = JSON.parse(JSON.stringify(planningData)) as PlanningSceneData
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

  const planningPath = `scenes/${encodedSceneId}/planning.json`
  return {
    planningPath,
    sidecar: {
      version: 1,
      planningData: nextPlanningData,
      images,
    },
  }
}

export async function exportScenePackageZip(payload: {
  project: ProjectExportBundleProjectConfig
  scenes: ScenePackageExportScene[]
  embedAssets?: boolean
  includePlanningData?: boolean
  updateProgress?: (value: number, message?: string) => void
  reportEvent?: SceneExportEventReporter
}): Promise<Blob> {
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
  const groundHeightmapStore = useGroundHeightmapStore()
  const scenesStore = useScenesStore()
  const sceneStore = useSceneStore()
  const resources: ScenePackageResourceEntry[] = []
  const sceneReferenceSummaryMaps = new Map<string, Map<string, SceneAssetReferenceSummary>>()

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
          throw new Error(
            `Missing downloadUrl for embedded asset (assetId=${item.assetId}). ` +
              `Ensure the scene includes resourceSummary.assets[].downloadUrl for all runtime assets, or that the asset is cached locally before exporting.`,
          )
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
    const preparedDocument = await prepareSceneDocumentForPackageExport(scene.document)
    const scenePath = `scenes/${encodeURIComponent(scene.id)}/scene.bin`
    let planningPath: string | undefined
    let groundHeightsPath: string | undefined
    let groundChunkManifestPath: string | undefined
    let groundScatterPath: string | undefined
    let groundPaintPath: string | undefined

    // Collect local asset IDs from effective registry and explicit local source metadata.
    const sidecarSource = typeof structuredClone === 'function'
      ? structuredClone(preparedDocument)
      : JSON.parse(JSON.stringify(preparedDocument))
    const groundNode = findGroundNode(sidecarSource.nodes)
    const useLegacyGroundHeightSidecar = groundNode?.dynamicMesh?.type === 'Ground'
    let groundHeightSidecar = useLegacyGroundHeightSidecar
      ? (scene.id === sceneStore.currentSceneId
          ? groundHeightmapStore.buildSceneDocumentSidecar(groundNode)
          : await scenesStore.loadGroundHeightSidecar(scene.id))
      : null
    const groundScatterSidecar = scene.id === sceneStore.currentSceneId
      ? useGroundScatterStore().buildSceneDocumentSidecar(scene.id, groundNode)
      : await scenesStore.loadGroundScatterSidecar(scene.id)
    const groundPaintSidecar = scene.id === sceneStore.currentSceneId
      ? useGroundPaintStore().buildSceneDocumentSidecar(scene.id, groundNode)
      : await scenesStore.loadGroundPaintSidecar(scene.id)
    // Legacy scenes can still contain Ground nodes before sidecar persistence runs; generate a fallback sidecar for upload consistency.
    if (useLegacyGroundHeightSidecar && groundNode && !groundHeightSidecar) {
      groundHeightSidecar = groundHeightmapStore.buildSceneDocumentSidecar(groundNode)
    }
    if (groundNode?.dynamicMesh?.type === 'Ground') {
      if (groundHeightSidecar) {
        groundNode.dynamicMesh = createGroundRuntimeMeshFromSidecar(groundNode.dynamicMesh, groundHeightSidecar)
      }
      attachOptimizedGroundMeshToDocument(sidecarSource as SceneJsonExportDocument)
      emitGroundOptimizationDiagnostics(payload.reportEvent, scene.id, sceneName, groundNode)

      const storedGroundChunkManifest = await scenesStore.loadGroundChunkManifest(scene.id)
      const packagedGroundChunkManifest = await buildGroundChunkPackageManifest(
        scene.id,
        storedGroundChunkManifest,
        (chunkKey) => scenesStore.loadGroundChunkData(scene.id, chunkKey),
      )
      if (packagedGroundChunkManifest) {
        groundChunkManifestPath = packagedGroundChunkManifest.manifestPath
        files[groundChunkManifestPath] = jsonBytes(packagedGroundChunkManifest.manifest)
        Object.assign(files, packagedGroundChunkManifest.files)
        emitSceneExportEvent(payload.reportEvent, {
          phase: 'sidecar',
          level: 'info',
          status: 'completed',
          sceneId: scene.id,
          sceneName,
          detail: groundChunkManifestPath,
          message: `已写入无限地形 chunk manifest`,
        })
      }
    }
    stripGroundHeightMapsFromSceneDocument(sidecarSource as StoredSceneDocument)
    const docClone = sidecarSource as SceneExportDocumentWithEditorFields
    const retainedConfigAssetIds = collectRuntimeRetainedConfigAssetIds(docClone)
    stripEditorOnlySceneFields(docClone, retainedConfigAssetIds)

    const localAssetIds = collectLocalAssetIdsForExport(docClone, retainedConfigAssetIds)
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
        throw new Error(`Missing local asset resource (assetId=${assetId}); please ensure the local asset has been written to IndexedDB before exporting.`)
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
    if (groundHeightSidecar) {
      groundHeightsPath = `scenes/${encodeURIComponent(scene.id)}/${GROUND_HEIGHTMAP_SIDECAR_FILENAME}`
      files[groundHeightsPath] = new Uint8Array(groundHeightSidecar)
      emitSceneExportEvent(payload.reportEvent, {
        phase: 'sidecar',
        level: 'info',
        status: 'completed',
        sceneId: scene.id,
        sceneName,
        detail: groundHeightsPath,
        message: `已写入地形高度 sidecar`,
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
    if (groundPaintSidecar) {
      groundPaintPath = `scenes/${encodeURIComponent(scene.id)}/${GROUND_PAINT_SIDECAR_FILENAME}`
      files[groundPaintPath] = new Uint8Array(groundPaintSidecar)
      emitSceneExportEvent(payload.reportEvent, {
        phase: 'sidecar',
        level: 'info',
        status: 'completed',
        sceneId: scene.id,
        sceneName,
        detail: groundPaintPath,
        message: `已写入地表绘制 sidecar`,
      })
    }
    if (payload.includePlanningData && scene.planningData) {
      const planningSidecar = await buildPlanningSidecar(scene.id, scene.planningData, files, resources)
      planningPath = planningSidecar.planningPath
      files[planningPath] = jsonBytes(planningSidecar.sidecar)
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
      groundChunkManifestPath,
      groundHeightsPath,
      groundScatterPath,
      groundPaintPath,
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

  const manifestBytes = jsonBytes(manifest)
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
  files['manifest.json'] = manifestBytes
  emitSceneExportEvent(payload.reportEvent, {
    phase: 'manifest',
    level: 'info',
    status: 'completed',
    detail: 'manifest.json',
    message: `清单文件已生成 (${manifest.scenes.length} 个场景, ${manifest.resources.length} 个资源)`,
  })

  payload.updateProgress?.(96, 'Compressing ZIP…')
  emitSceneExportEvent(payload.reportEvent, {
    phase: 'archive',
    level: 'info',
    status: 'running',
    progress: 96,
    detail: 'manifest.json',
    message: '开始压缩 ZIP 包',
  })
  const zipBytes = zipSync(files, { level: 6 })
  // fflate returns Uint8Array<ArrayBufferLike> which fails BlobPart typing; copy into ArrayBuffer.
  const zipArrayBuffer = new ArrayBuffer(zipBytes.byteLength)
  new Uint8Array(zipArrayBuffer).set(zipBytes)
  emitSceneExportEvent(payload.reportEvent, {
    phase: 'archive',
    level: 'success',
    status: 'completed',
    progress: 100,
    detail: `${Object.keys(files).length} files`,
    message: 'ZIP 压缩完成',
  })
  return new Blob([zipArrayBuffer], { type: 'application/zip' })
}
