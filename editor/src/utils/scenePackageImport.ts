import {
  decodeScenePackageSceneDocument,
  type GroundChunkManifest,
  type QuantizedTerrainDatasetRootManifest,
  readBinaryFileFromScenePackage,
  readTextFileFromScenePackage,
  unzipScenePackage,
  type ScenePackageSceneEntry,
} from '@schema'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import type { PlanningSceneData } from '@/types/planning-scene-data'
import type { PlanningScenePackageImageEntry, PlanningScenePackageSidecar } from '@/types/planning-package'
import { stripGroundHeightMapsFromSceneDocument } from '@/utils/groundHeightSidecar'
import { storePlanningImageBlobByHash } from '@/utils/planningImageStorage'

export type LoadedScenePackageProject = Record<string, unknown>

export type LoadedStoredScenePackage = {
  project: LoadedScenePackageProject
  scenes: StoredSceneDocument[]
  groundHeightSidecars: Record<string, ArrayBuffer | null>
  groundScatterSidecars: Record<string, ArrayBuffer | null>
  groundPaintSidecars: Record<string, ArrayBuffer | null>
  groundChunkManifests: Record<string, GroundChunkManifest | null>
  groundChunkData: Record<string, Record<string, ArrayBuffer | null>>
  terrainDatasetManifests: Record<string, QuantizedTerrainDatasetRootManifest | null>
  terrainDatasetRegionPacks: Record<string, Record<string, ArrayBuffer | null>>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizePlanningPackageImageEntry(raw: unknown): PlanningScenePackageImageEntry | null {
  if (!isPlainObject(raw)) {
    return null
  }
  const imageId = typeof raw.imageId === 'string' ? raw.imageId.trim() : ''
  if (!imageId) {
    return null
  }
  return {
    imageId,
    imageHash: typeof raw.imageHash === 'string' && raw.imageHash.trim().length ? raw.imageHash.trim() : null,
    resourcePath: typeof raw.resourcePath === 'string' && raw.resourcePath.trim().length ? raw.resourcePath.trim() : null,
    filename: typeof raw.filename === 'string' ? raw.filename : null,
    mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : null,
  }
}

function normalizePlanningSidecar(raw: unknown): PlanningScenePackageSidecar | null {
  if (!isPlainObject(raw)) {
    return null
  }
  const version = Number(raw.version)
  if (version !== 1) {
    return null
  }
  const planningData = isPlainObject(raw.planningData) ? (raw.planningData as unknown as PlanningSceneData) : null
  const images = Array.isArray(raw.images)
    ? raw.images.map((entry) => normalizePlanningPackageImageEntry(entry)).filter((entry): entry is PlanningScenePackageImageEntry => !!entry)
    : []
  return {
    version: 1,
    planningData,
    images,
  }
}

async function restoreRuntimeResourcesFromPackage(zip: ReturnType<typeof unzipScenePackage>): Promise<void> {
  const assetCache = useAssetCacheStore()
  for (const entry of zip.manifest.resources ?? []) {
    if (entry.resourceType === 'planningImage') {
      continue
    }
    const bytes = zip.files[entry.path]
    if (!bytes) {
      throw new Error(`Missing resource file in scene bundle: ${entry.path}`)
    }
    const mimeType = entry.mimeType || 'application/octet-stream'
    const filename = `${entry.logicalId}.${entry.ext}`
    const blob = new Blob([new Uint8Array(bytes)], { type: mimeType })
    await assetCache.storeAssetBlob(entry.logicalId, { blob, mimeType, filename })
  }
}

async function applyPlanningSidecarToScene(
  zip: ReturnType<typeof unzipScenePackage>,
  sceneEntry: ScenePackageSceneEntry,
  rawScene: StoredSceneDocument,
): Promise<StoredSceneDocument> {
  if (!sceneEntry.planningPath) {
    return rawScene
  }

  const sidecarText = readTextFileFromScenePackage(zip, sceneEntry.planningPath)
  const rawSidecar = JSON.parse(sidecarText) as unknown
  const sidecar = normalizePlanningSidecar(rawSidecar)
  if (!sidecar?.planningData) {
    return rawScene
  }

  const imageEntryById = new Map(sidecar.images.map((entry) => [entry.imageId, entry]))
  const nextPlanningData = JSON.parse(JSON.stringify(sidecar.planningData)) as PlanningSceneData

  for (const image of nextPlanningData.images ?? []) {
    const entry = imageEntryById.get(image.id)
    if (!entry) {
      image.url = image.imageHash ? '' : image.url
      continue
    }
    image.imageHash = entry.imageHash ?? image.imageHash
    image.filename = entry.filename ?? image.filename ?? null
    image.mimeType = entry.mimeType ?? image.mimeType ?? null
    image.url = image.imageHash ? '' : image.url

    if (!entry.imageHash || !entry.resourcePath) {
      continue
    }

    const bytes = zip.files[entry.resourcePath]
    if (!bytes) {
      throw new Error(`Missing planning image resource in scene bundle: ${entry.resourcePath}`)
    }
    const blob = new Blob([new Uint8Array(bytes)], { type: entry.mimeType ?? image.mimeType ?? 'application/octet-stream' })
    await storePlanningImageBlobByHash(entry.imageHash, blob)
  }

  return {
    ...rawScene,
    planningData: nextPlanningData,
  }
}

function extractGroundHeightSidecarFromPackage(
  zip: ReturnType<typeof unzipScenePackage>,
  sceneEntry: ScenePackageSceneEntry,
  rawScene: StoredSceneDocument,
): ArrayBuffer | null {
  void zip
  void sceneEntry
  void rawScene
  return null
}

function extractGroundScatterSidecarFromPackage(
  zip: ReturnType<typeof unzipScenePackage>,
  sceneEntry: ScenePackageSceneEntry,
  rawScene: StoredSceneDocument,
): ArrayBuffer | null {
  const hasGroundNode = Array.isArray(rawScene.nodes)
    && rawScene.nodes.some((node) => node?.dynamicMesh?.type === 'Ground')
  if (!hasGroundNode) {
    return null
  }
  const sidecarPath = sceneEntry.groundScatterPath
  if (!sidecarPath) {
    return null
  }
  const bytes = zip.files[sidecarPath]
  if (!bytes) {
    throw new Error(`Missing ground scatter sidecar in scene bundle: ${sidecarPath}`)
  }
  return new Uint8Array(bytes).buffer
}

function extractGroundPaintSidecarFromPackage(
  zip: ReturnType<typeof unzipScenePackage>,
  sceneEntry: ScenePackageSceneEntry,
  rawScene: StoredSceneDocument,
): ArrayBuffer | null {
  const hasGroundNode = Array.isArray(rawScene.nodes)
    && rawScene.nodes.some((node) => node?.dynamicMesh?.type === 'Ground')
  if (!hasGroundNode) {
    return null
  }
  const sidecarPath = sceneEntry.groundPaintPath
  if (!sidecarPath) {
    return null
  }
  const bytes = zip.files[sidecarPath]
  if (!bytes) {
    throw new Error(`Missing ground paint sidecar in scene bundle: ${sidecarPath}`)
  }
  return new Uint8Array(bytes).buffer
}

function extractGroundChunkManifestFromPackage(
  zip: ReturnType<typeof unzipScenePackage>,
  sceneEntry: ScenePackageSceneEntry,
): GroundChunkManifest | null {
  void zip
  void sceneEntry
  return null
}

function extractGroundChunkDataFromPackage(
  zip: ReturnType<typeof unzipScenePackage>,
  manifest: GroundChunkManifest | null,
): Record<string, ArrayBuffer | null> {
  if (!manifest || !manifest.chunks || typeof manifest.chunks !== 'object') {
    return {}
  }

  const out: Record<string, ArrayBuffer | null> = {}
  for (const [chunkKey, record] of Object.entries(manifest.chunks)) {
    const dataPath = typeof record?.dataPath === 'string' ? record.dataPath.trim() : ''
    if (!dataPath) {
      out[chunkKey] = null
      continue
    }
    const bytes = zip.files[dataPath]
    if (!bytes) {
      throw new Error(`Missing ground chunk data in scene bundle: ${dataPath}`)
    }
    out[chunkKey] = new Uint8Array(bytes).buffer
  }
  return out
}

function extractTerrainDatasetManifestFromPackage(
  zip: ReturnType<typeof unzipScenePackage>,
  sceneEntry: ScenePackageSceneEntry,
): QuantizedTerrainDatasetRootManifest | null {
  const manifestPath = typeof sceneEntry.terrain?.rootManifestPath === 'string'
    ? sceneEntry.terrain.rootManifestPath.trim()
    : ''
  if (!manifestPath) {
    return null
  }
  return JSON.parse(readTextFileFromScenePackage(zip, manifestPath)) as QuantizedTerrainDatasetRootManifest
}

function extractTerrainDatasetRegionPacksFromPackage(
  zip: ReturnType<typeof unzipScenePackage>,
  manifest: QuantizedTerrainDatasetRootManifest | null,
): Record<string, ArrayBuffer | null> {
  if (!manifest || !Array.isArray(manifest.regions)) {
    return {}
  }
  const out: Record<string, ArrayBuffer | null> = {}
  for (const region of manifest.regions) {
    const regionKey = typeof region?.regionKey === 'string' ? region.regionKey.trim() : ''
    const regionPath = typeof region?.path === 'string' ? region.path.trim() : ''
    if (!regionKey) {
      continue
    }
    if (!regionPath) {
      out[regionKey] = null
      continue
    }
    const bytes = zip.files[regionPath]
    if (!bytes) {
      throw new Error(`Missing terrain dataset region pack in scene bundle: ${regionPath}`)
    }
    out[regionKey] = new Uint8Array(bytes).buffer
  }
  return out
}

export async function loadStoredScenesFromScenePackage(zipBytes: ArrayBuffer): Promise<LoadedStoredScenePackage> {
  const zip = unzipScenePackage(zipBytes)
  await restoreRuntimeResourcesFromPackage(zip)

  const projectText = readTextFileFromScenePackage(zip, zip.manifest.project.path)
  const project = (JSON.parse(projectText) as LoadedScenePackageProject) ?? {}
  const scenes: StoredSceneDocument[] = []
  const groundHeightSidecars: Record<string, ArrayBuffer | null> = {}
  const groundScatterSidecars: Record<string, ArrayBuffer | null> = {}
  const groundPaintSidecars: Record<string, ArrayBuffer | null> = {}
  const groundChunkManifests: Record<string, GroundChunkManifest | null> = {}
  const groundChunkData: Record<string, Record<string, ArrayBuffer | null>> = {}
  const terrainDatasetManifests: Record<string, QuantizedTerrainDatasetRootManifest | null> = {}
  const terrainDatasetRegionPacks: Record<string, Record<string, ArrayBuffer | null>> = {}
  for (const sceneEntry of zip.manifest.scenes ?? []) {
    const rawScene = decodeScenePackageSceneDocument(readBinaryFileFromScenePackage(zip, sceneEntry.path)) as unknown
    if (!isPlainObject(rawScene)) {
      throw new Error(`Invalid scene document in scene bundle: ${sceneEntry.path}`)
    }
    const sceneDocument = stripGroundHeightMapsFromSceneDocument(rawScene as unknown as StoredSceneDocument)
    groundHeightSidecars[sceneEntry.sceneId] = extractGroundHeightSidecarFromPackage(zip, sceneEntry, sceneDocument)
    groundScatterSidecars[sceneEntry.sceneId] = extractGroundScatterSidecarFromPackage(zip, sceneEntry, sceneDocument)
    groundPaintSidecars[sceneEntry.sceneId] = extractGroundPaintSidecarFromPackage(zip, sceneEntry, sceneDocument)
    groundChunkManifests[sceneEntry.sceneId] = extractGroundChunkManifestFromPackage(zip, sceneEntry)
    groundChunkData[sceneEntry.sceneId] = extractGroundChunkDataFromPackage(zip, groundChunkManifests[sceneEntry.sceneId] ?? null)
    terrainDatasetManifests[sceneEntry.sceneId] = extractTerrainDatasetManifestFromPackage(zip, sceneEntry)
    terrainDatasetRegionPacks[sceneEntry.sceneId] = extractTerrainDatasetRegionPacksFromPackage(zip, terrainDatasetManifests[sceneEntry.sceneId] ?? null)
    const withPlanning = await applyPlanningSidecarToScene(zip, sceneEntry, sceneDocument)
    scenes.push(withPlanning)
  }

  return {
    project,
    scenes,
    groundHeightSidecars,
    groundScatterSidecars,
    groundPaintSidecars,
    groundChunkManifests,
    groundChunkData,
    terrainDatasetManifests,
    terrainDatasetRegionPacks,
  }
}
