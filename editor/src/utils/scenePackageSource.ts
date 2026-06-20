import {
  SCENE_PACKAGE_FORMAT,
  SCENE_PACKAGE_VERSION,
  encodeScenePackageSceneDocument,
  inferExtFromMimeType,
  serializeScenePackageManifest,
  type SceneAssetPackageEntry,
  type SceneAssetRegistryEntry,
  type ScenePackageResourceEntry,
} from '@schema/core'
import { resolveDocumentGroundNode } from '@schema/groundNode'
import { BUILTIN_WATER_NORMAL_FILENAME, isBuiltinWaterNormalAsset } from '@/constants/builtinAssets'
import { GROUND_HEIGHTMAP_SIDECAR_FILENAME } from '@/utils/groundHeightSidecar'
import { serializePlanningScenePackageSidecar } from '@/types/planning-package'
import { sha256Hex } from '@harmony/utils/hash'
import {
  buildPlanningSidecar,
  createScenePackageZipBlob,
  inferExtFromFilename,
  stripGroundBakedTextureAssetIds,
  jsonBytes,
} from '@/utils/scenePackageExport'
import { collectPrefabAssetIdsFromSceneReferences } from '@/stores/sceneAssetCleanup'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { useScenesStore } from '@/stores/scenesStore'

interface ScenePackageSourceProjectConfig {
  id: string
  name: string
  defaultSceneId: string | null
  lastEditedSceneId: string | null
  sceneOrder: string[]
}

interface ScenePackageSourceSceneDocument {
  id: string
  projectId?: string
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
  assetCatalog?: Record<string, import('@/types/project-asset').ProjectAsset[]>
  assetManifest?: import('@/types/stored-scene-document').StoredSceneDocument['assetManifest']
  assetRegistry?: Record<string, SceneAssetRegistryEntry>
  planningData?: import('@/types/planning-scene-data').PlanningSceneData | null
}

export interface ScenePackageSourceScene {
  id: string
  document: ScenePackageSourceSceneDocument
}

type ScenePackageSourcePayload = {
  project: ScenePackageSourceProjectConfig
  scenes: ScenePackageSourceScene[]
}

type ScenePackageSourceSceneEntry = {
  sceneId: string
  path: string
  planningPath?: string
  groundHeightPath?: string
  groundSplatPath?: string
  groundScatterPath?: string
}

type ScenePackageSourceManifest = {
  format: typeof SCENE_PACKAGE_FORMAT
  version: typeof SCENE_PACKAGE_VERSION
  createdAt: string
  project: { path: string }
  scenes: ScenePackageSourceSceneEntry[]
  resources: ScenePackageResourceEntry[]
}

type ScenePackageSourceZipBuildPayload = {
  project: ScenePackageSourceProjectConfig
  scenes: ScenePackageSourceScene[]
}

type ScenePackageSourceZipBuildState = {
  createdAt: string
  files: Record<string, Uint8Array>
  projectPath: string
  assetCache: ReturnType<typeof useAssetCacheStore>
  scenesStore: ReturnType<typeof useScenesStore>
  manifestScenes: ScenePackageSourceSceneEntry[]
  resources: ScenePackageResourceEntry[]
}

function cloneSourceSceneDocument(document: ScenePackageSourceSceneDocument): ScenePackageSourceSceneDocument {
  return structuredClone(document)
}

function collectSourceScenePackageAssetIdsForExport(
  document: ScenePackageSourceSceneDocument,
): string[] {
  const assetIds = new Set<string>()
  Object.keys(document.assetRegistry ?? {}).forEach((assetId) => {
    const normalized = typeof assetId === 'string' ? assetId.trim() : ''
    if (normalized) {
      if (document.assetRegistry?.[normalized]?.sourceType === 'server') {
        return
      }
      assetIds.add(normalized)
    }
  })
  collectPrefabAssetIdsFromSceneReferences(document as import('@/types/stored-scene-document').StoredSceneDocument, document.assetCatalog ?? {})
    .forEach((assetId) => {
      if (document.assetRegistry?.[assetId]?.sourceType === 'server') {
        return
      }
      assetIds.add(assetId)
    })
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
  stripGroundBakedTextureAssetIds(resolveDocumentGroundNode(preparedDocument))
  return preparedDocument
}

async function writeSourceScenePackageLocalAssets(options: {
  state: ScenePackageSourceZipBuildState
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
  state: ScenePackageSourceZipBuildState,
  payload: ScenePackageSourceZipBuildPayload,
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

function buildScenePackageSourceZipState(_payload: ScenePackageSourceZipBuildPayload): ScenePackageSourceZipBuildState {
  const createdAt = new Date().toISOString()
  const files: Record<string, Uint8Array> = {}
  const projectPath = 'project/project.json'
  const assetCache = useAssetCacheStore()
  const scenesStore = useScenesStore()
  const manifestScenes: ScenePackageSourceSceneEntry[] = []
  const resources: ScenePackageResourceEntry[] = []

  return {
    createdAt,
    files,
    projectPath,
    assetCache,
    scenesStore,
    manifestScenes,
    resources,
  }
}

export async function prepareScenePackageSourceZipFiles(payload: ScenePackageSourcePayload): Promise<Record<string, Uint8Array>> {
  const state = buildScenePackageSourceZipState(payload)
  const {
    files,
    resources,
  } = state
  const manifestScenes: ScenePackageSourceSceneEntry[] = []

  for (let sIndex = 0; sIndex < payload.scenes.length; sIndex += 1) {
    const scene = payload.scenes[sIndex]!
    const preparedDocument = await normalizeSourceSceneDocument(scene.document)
    const scenePath = `scenes/${encodeURIComponent(scene.id)}/scene.bin`
    let planningPath: string | undefined
    let groundHeightPath: string | undefined
    let groundSplatPath: string | undefined
    let groundScatterPath: string | undefined
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

    files[scenePath] = encodeScenePackageSceneDocument(preparedDocument)
    if (scene.document.planningData) {
      const planningSidecar = await buildPlanningSidecar(scene.id, scene.document.planningData, files, resources)
      planningPath = planningSidecar.planningPath
      files[planningPath] = serializePlanningScenePackageSidecar(planningSidecar.sidecar)
    }

    const groundHeightSidecar = await state.scenesStore.loadGroundHeightSidecar(scene.id)
    if (groundHeightSidecar) {
      groundHeightPath = `scenes/${encodeURIComponent(scene.id)}/${GROUND_HEIGHTMAP_SIDECAR_FILENAME}`
      files[groundHeightPath] = new Uint8Array(groundHeightSidecar)
    }

    const groundSplatSidecar = await state.scenesStore.loadGroundSplatSidecar(scene.id)
    if (groundSplatSidecar) {
      groundSplatPath = `scenes/${encodeURIComponent(scene.id)}/ground-splat.bin`
      files[groundSplatPath] = new Uint8Array(groundSplatSidecar)
    }

    const groundScatterSidecar = await state.scenesStore.loadGroundScatterSidecar(scene.id)
    if (groundScatterSidecar) {
      groundScatterPath = `scenes/${encodeURIComponent(scene.id)}/ground-scatter.bin`
      files[groundScatterPath] = new Uint8Array(groundScatterSidecar)
    }

    manifestScenes.push({
      sceneId: scene.id,
      path: scenePath,
      planningPath,
      groundHeightPath,
      groundSplatPath,
      groundScatterPath,
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
