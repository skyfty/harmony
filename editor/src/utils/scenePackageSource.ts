import {
  SCENE_PACKAGE_FORMAT,
  SCENE_PACKAGE_VERSION,
  encodeScenePackageSceneDocument,
  inferExtFromMimeType,
  serializeScenePackageManifest,
  type SceneAssetPackageEntry,
  type SceneAssetRegistryEntry,
  type ScenePackageResourceEntry,
  type SceneResourceSummary,
} from '@schema/core'
import { resolveDocumentGroundNode } from '@schema/groundNode'
import { BUILTIN_WATER_NORMAL_FILENAME, isBuiltinWaterNormalAsset } from '@/constants/builtinAssets'
import { fetchResourceAsset } from '@/api/resourceAssets'
import { mapServerAssetToProjectAsset } from '@/api/serverAssetTypes'
import { serializePlanningScenePackageSidecar } from '@/types/planning-package'
import { sha256Hex } from '@harmony/utils/hash'
import {
  buildPackagedAssetPathMap,
  buildPlanningSidecar,
  buildScenePackageZipState,
  buildEffectiveAssetRegistry,
  createScenePackageZipBlob,
  inferExtFromFilename,
  stripGroundBakedTextureAssetIds,
  jsonBytes,
} from '@/utils/scenePackageExport'
import {
  buildSourceAssetRegistryForExport,
  calculateSourceSceneResourceSummary,
} from '@/stores/sceneStore'
import { collectPrefabAssetIdsFromSceneReferences } from '@/stores/sceneAssetCleanup'

interface ScenePackageSourceProjectConfig {
  id: string
  name: string
  defaultSceneId: string | null
  lastEditedSceneId: string | null
  sceneOrder: string[]
}

interface ScenePackageSourceSceneDocument {
  id: string
  projectId: string
  name: string
  thumbnail?: string | null
  nodes: import('@/types/stored-scene-document').StoredSceneDocument['nodes']
  camera?: import('@/types/stored-scene-document').StoredSceneDocument['camera']
  viewportSettings?: import('@/types/stored-scene-document').StoredSceneDocument['viewportSettings']
  shadowsEnabled?: import('@/types/stored-scene-document').StoredSceneDocument['shadowsEnabled']
  environment?: import('@/types/stored-scene-document').StoredSceneDocument['environment']
  groundSettings?: import('@/types/stored-scene-document').StoredSceneDocument['groundSettings']
  panelVisibility?: import('@/types/stored-scene-document').StoredSceneDocument['panelVisibility']
  panelPlacement?: import('@/types/stored-scene-document').StoredSceneDocument['panelPlacement']
  resourceProviderId?: import('@/types/stored-scene-document').StoredSceneDocument['resourceProviderId']
  createdAt: string
  updatedAt: string
  assetCatalog: Record<string, import('@/types/project-asset').ProjectAsset[]>
  assetManifest?: import('@/types/stored-scene-document').StoredSceneDocument['assetManifest']
  assetRegistry?: Record<string, SceneAssetRegistryEntry>
  projectOverrideAssets?: Record<string, SceneAssetRegistryEntry>
  sceneOverrideAssets?: Record<string, SceneAssetRegistryEntry>
  planningData?: import('@/types/planning-scene-data').PlanningSceneData | null
}

export interface ScenePackageSourceScene {
  id: string
  document: ScenePackageSourceSceneDocument
  planningData?: import('@/types/planning-scene-data').PlanningSceneData | null
}

type ScenePackageSourcePayload = {
  project: ScenePackageSourceProjectConfig
  scenes: ScenePackageSourceScene[]
}

type ScenePackageSourceSceneEntry = {
  sceneId: string
  path: string
  planningPath?: string
}

type ScenePackageSourceManifest = {
  format: typeof SCENE_PACKAGE_FORMAT
  version: typeof SCENE_PACKAGE_VERSION
  createdAt: string
  project: { path: string }
  scenes: ScenePackageSourceSceneEntry[]
  resources: ScenePackageResourceEntry[]
}

function cloneSourceSceneDocument(document: ScenePackageSourceSceneDocument): ScenePackageSourceSceneDocument {
  return structuredClone(document)
}

function collectSourceScenePackageAssetIdsForExport(
  document: ScenePackageSourceSceneDocument,
): string[] {
  const effectiveRegistry = buildEffectiveAssetRegistry(document)
  const assetIds = new Set<string>()
  Object.keys(effectiveRegistry).forEach((assetId) => {
    const normalized = typeof assetId === 'string' ? assetId.trim() : ''
    if (normalized) {
      assetIds.add(normalized)
    }
  })
  collectPrefabAssetIdsFromSceneReferences(document as import('@/types/stored-scene-document').StoredSceneDocument, document.assetCatalog ?? {})
    .forEach((assetId) => assetIds.add(assetId))
  return Array.from(assetIds)
}

async function buildSourceSceneResourcePath(sceneId: string, assetId: string, entry: { filename?: string | null; mimeType?: string | null }): Promise<string> {
  if (isBuiltinWaterNormalAsset(assetId)) {
    return `scenes/${encodeURIComponent(sceneId)}/resources/${BUILTIN_WATER_NORMAL_FILENAME}`
  }
  const hash = await sha256Hex(assetId)
  const safeName = hash.length > 16 ? hash.slice(0, 16) : hash
  const ext = inferExtFromFilename(entry.filename) ?? inferExtFromMimeType(entry.mimeType ?? '') ?? 'bin'
  return `scenes/${encodeURIComponent(sceneId)}/resources/${safeName}.${ext}`
}

function updateSourceSceneAssetRegistry(
  preparedDocument: ScenePackageSourceSceneDocument,
  assetId: string,
  resourcePath: string,
  entry: { bytes?: number | null; assetType?: SceneAssetPackageEntry['assetType'] | null; name?: string | null },
): void {
  const existing = preparedDocument.assetRegistry?.[assetId]
  if (!existing || existing.sourceType !== 'package') {
    return
  }
  const nextEntry: SceneAssetPackageEntry = {
    ...existing,
    sourceType: 'package',
    zipPath: resourcePath,
    inline: existing.inline,
    bytes: entry.bytes ?? undefined,
    assetType: entry.assetType ?? undefined,
    name: entry.name ?? undefined,
  }
  if (preparedDocument.assetRegistry) {
    preparedDocument.assetRegistry[assetId] = nextEntry
  }
}

async function normalizeSourceSceneDocument(document: ScenePackageSourceScene['document']): Promise<ScenePackageSourceSceneDocument> {
  const preparedDocument = cloneSourceSceneDocument(document)
  if ('assetCatalog' in preparedDocument) {
    await attachSourceSceneAssetMetadata(preparedDocument)
  }
  stripGroundBakedTextureAssetIds(resolveDocumentGroundNode(preparedDocument))
  return preparedDocument
}

async function writeSourceScenePackageLocalAssets(options: {
  state: ReturnType<typeof buildScenePackageZipState>
  preparedDocument: ScenePackageSourceSceneDocument
  assetIds: string[]
  resourcePathForAsset: (assetId: string, blob: Blob, entry: { filename?: string | null; mimeType?: string | null }) => Promise<string>
  updateResourceRegistry?: (assetId: string, resourcePath: string, entry: { sourceType?: string | null; inline?: string | null; bytes?: number | null; assetType?: SceneAssetPackageEntry['assetType'] | null; name?: string | null }) => void
}): Promise<void> {
  const {
    state,
    preparedDocument,
    assetIds,
    resourcePathForAsset,
    updateResourceRegistry,
  } = options

  for (let aIndex = 0; aIndex < assetIds.length; aIndex += 1) {
    const assetId = assetIds[aIndex]!
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
    updateResourceRegistry?.(assetId, resourcePath, {
      bytes: preparedDocument.assetRegistry?.[assetId]?.bytes ?? null,
      assetType: preparedDocument.assetRegistry?.[assetId]?.assetType ?? null,
      name: preparedDocument.assetRegistry?.[assetId]?.name ?? null,
    })
  }
}

function finalizeSourceScenePackageZipState(
  state: ReturnType<typeof buildScenePackageZipState>,
  payload: ScenePackageSourcePayload,
  manifestScenes: ScenePackageSourceSceneEntry[],
): void {
  const manifest: ScenePackageSourceManifest = {
    format: SCENE_PACKAGE_FORMAT,
    version: SCENE_PACKAGE_VERSION,
    createdAt: state.createdAt,
    project: { path: state.projectPath },
    scenes: manifestScenes,
    resources: state.resources,
  }
  const manifestBytes = serializeScenePackageManifest(manifest)
  state.files[state.projectPath] = jsonBytes(payload.project)
  state.files['manifest.bin'] = manifestBytes
}

export async function prepareScenePackageSourceZipFiles(payload: ScenePackageSourcePayload): Promise<Record<string, Uint8Array>> {
  const state = buildScenePackageZipState(payload)
  const {
    files,
    resources,
    sharedAssetPathById,
  } = state
  const manifestScenes: ScenePackageSourceSceneEntry[] = []

  for (let sIndex = 0; sIndex < payload.scenes.length; sIndex += 1) {
    const scene = payload.scenes[sIndex]!
    const preparedDocument = await normalizeSourceSceneDocument(scene.document)
    const scenePath = `scenes/${encodeURIComponent(scene.id)}/scene.bin`
    let planningPath: string | undefined
    const sceneSourcePackageAssetIds = new Set<string>(
      collectSourceScenePackageAssetIdsForExport(
        preparedDocument,
      ),
    )
    const localAssetIds = Array.from(sceneSourcePackageAssetIds)

    await writeSourceScenePackageLocalAssets({
      state,
      preparedDocument,
      assetIds: localAssetIds,
      resourcePathForAsset: (assetId, _blob, entry) => buildSourceSceneResourcePath(scene.id, assetId, entry),
      updateResourceRegistry: (assetId, resourcePath, entry) => {
        updateSourceSceneAssetRegistry(preparedDocument, assetId, resourcePath, entry)
      },
    })

    const packagedAssetPathById = buildPackagedAssetPathMap(sharedAssetPathById, resources)
    if (preparedDocument.assetRegistry) {
      Object.entries(preparedDocument.assetRegistry).forEach(([assetId, entry]) => {
        const packagedPath = packagedAssetPathById.get(assetId)
        if (!packagedPath || !entry) {
          return
        }
        preparedDocument.assetRegistry![assetId] = {
          sourceType: 'package',
          zipPath: packagedPath,
          inline: entry.sourceType === 'package' ? entry.inline : undefined,
          bytes: entry.bytes,
          assetType: entry.assetType,
          name: entry.name,
        }
      })
    }
    files[scenePath] = encodeScenePackageSceneDocument(preparedDocument)
    if (scene.planningData) {
      const planningSidecar = await buildPlanningSidecar(scene.id, scene.planningData, files, resources)
      planningPath = planningSidecar.planningPath
      files[planningPath] = serializePlanningScenePackageSidecar(planningSidecar.sidecar)
    }
    manifestScenes.push({
      sceneId: scene.id,
      path: scenePath,
      planningPath,
    })
  }
  finalizeSourceScenePackageZipState(state, payload, manifestScenes)
  return files
}

export async function exportScenePackageSourceZip(payload: ScenePackageSourcePayload): Promise<Blob> {
  const files = await prepareScenePackageSourceZipFiles(payload)
  const blob = createScenePackageZipBlob(files)
  return blob
}

type SourceSceneEditableDocument = ScenePackageSourceSceneDocument & {
  resourceSummary?: SceneResourceSummary | null
  assetRegistry?: Record<string, SceneAssetRegistryEntry>
}

async function resolveUnknownSourceExportAssetUrls(
  editable: SourceSceneEditableDocument,
  rebuildResourceSummary: () => Promise<SceneResourceSummary>,
): Promise<void> {
  const unknownAssetIds = Array.isArray(editable.resourceSummary?.unknownAssetIds)
    ? editable.resourceSummary.unknownAssetIds
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => value.length > 0)
    : []

  if (!unknownAssetIds.length) {
    return
  }

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
        const mappedAsset = mapServerAssetToProjectAsset(serverAsset)
        const downloadUrl = typeof mappedAsset.downloadUrl === 'string' ? mappedAsset.downloadUrl.trim() : ''
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
        console.warn('Failed to resolve source asset download URL', {
          registryAssetId: assetId,
          serverAssetId: editable.assetRegistry?.[assetId]?.sourceType === 'server' && typeof editable.assetRegistry?.[assetId]?.serverAssetId === 'string'
            ? editable.assetRegistry[assetId].serverAssetId
            : assetId,
          sourceType: editable.assetRegistry?.[assetId]?.sourceType ?? null,
          error,
        })
      }
    }),
  )

  if (registryPatched) {
    editable.resourceSummary = await rebuildResourceSummary()
  }
}

async function attachSourceSceneAssetMetadata(
  editable: ScenePackageSourceSceneDocument,
): Promise<ScenePackageSourceSceneDocument> {
  const sceneDocument = editable as import('@/types/stored-scene-document').StoredSceneDocument
  const working = editable as SourceSceneEditableDocument
  const rebuildResourceSummary = async (): Promise<SceneResourceSummary> => await calculateSourceSceneResourceSummary(sceneDocument)
  working.assetRegistry = await buildSourceAssetRegistryForExport(sceneDocument)
  working.resourceSummary = await rebuildResourceSummary()
  await resolveUnknownSourceExportAssetUrls(working, rebuildResourceSummary)
  delete working.resourceSummary
  return working
}
