import {
  decodeScenePackageSceneDocument,
  deserializeQuantizedTerrainDatasetRootManifest,
  type QuantizedTerrainDatasetRootManifest,
  readBinaryFileFromScenePackage,
  readTextFileFromScenePackage,
  unzipScenePackage,
  type ScenePackageSceneEntry,
} from '@schema/core'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import type { PlanningSceneData } from '@/types/planning-scene-data'
import { deserializePlanningScenePackageSidecar, type PlanningScenePackageImageEntry } from '@/types/planning-package'
import { stripGroundHeightMapsFromSceneDocument } from '@/utils/groundHeightSidecar'
import { storePlanningImageBlobByHash } from '@/utils/planningImageStorage'
import { storePlanningDemBlobByHash } from '@/utils/planningDemStorage'

export type LoadedScenePackageProject = Record<string, unknown>

export type LoadedStoredScenePackage = {
  project: LoadedScenePackageProject
  scenes: StoredSceneDocument[]
  groundHeightSidecars: Record<string, ArrayBuffer | null>
  groundSplatSidecars: Record<string, ArrayBuffer | null>
  groundScatterSidecars: Record<string, ArrayBuffer | null>
  terrainDatasetManifests: Record<string, QuantizedTerrainDatasetRootManifest | null>
  terrainDatasetRegionPacks: Record<string, Record<string, ArrayBuffer | null>>
}

export type LoadStoredScenePackageOptions = {
  allowLandformNodes?: boolean
}

function formatScenePackageImportLog(label: string, payload: Record<string, unknown>): string {
  return `${label}: ${JSON.stringify(payload, null, 2)}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertNoLandformNodes(nodes: StoredSceneDocument['nodes'], path = 'root'): void {
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
      throw new Error(`Scene package contains unsupported Landform runtime data at ${nextPath}. Export must bake landforms before packaging.`)
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      assertNoLandformNodes(node.children as StoredSceneDocument['nodes'], `${nextPath}.children`)
    }
  })
}

async function restoreRuntimeResourcesFromPackage(zip: ReturnType<typeof unzipScenePackage>): Promise<void> {
  const assetCache = useAssetCacheStore()
  const resourceEntries = (zip.manifest.resources ?? []).filter((entry) => entry.resourceType !== 'planningImage')
  console.info(formatScenePackageImportLog('Scene package resource restore start', {
    resourceCount: resourceEntries.length,
    resourceIds: resourceEntries.map((entry) => entry.logicalId),
  }))
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
    console.info(formatScenePackageImportLog('Scene package resource restored', {
      logicalId: entry.logicalId,
      resourceType: entry.resourceType,
      path: entry.path,
      mimeType,
      filename,
      byteLength: bytes.byteLength,
      cachedStatus: assetCache.getEntry(entry.logicalId)?.status ?? null,
      hasBlob: !!assetCache.getEntry(entry.logicalId)?.blob,
    }))
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

  const sidecar = deserializePlanningScenePackageSidecar(readBinaryFileFromScenePackage(zip, sceneEntry.planningPath))
  if (!sidecar?.planningData) {
    return rawScene
  }

  const imageEntryById = new Map<string, PlanningScenePackageImageEntry>(
    sidecar.images.map((entry) => [entry.imageId, entry] as const),
  )
  const nextPlanningData = structuredClone(sidecar.planningData) as PlanningSceneData

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

  const orthophotoEntry = sidecar.orthophoto
  if (
    orthophotoEntry?.sourceFileHash
    && orthophotoEntry.resourcePath
    && nextPlanningData.terrain?.dem?.orthophoto
  ) {
    const bytes = zip.files[orthophotoEntry.resourcePath]
    if (!bytes) {
      throw new Error(`Missing planning orthophoto resource in scene bundle: ${orthophotoEntry.resourcePath}`)
    }
    const blob = new Blob([new Uint8Array(bytes)], {
      type: orthophotoEntry.mimeType ?? nextPlanningData.terrain.dem.orthophoto.mimeType ?? 'application/octet-stream',
    })
    await storePlanningDemBlobByHash(orthophotoEntry.sourceFileHash, blob)
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

function extractGroundSplatSidecarFromPackage(
  zip: ReturnType<typeof unzipScenePackage>,
  sceneEntry: ScenePackageSceneEntry,
  rawScene: StoredSceneDocument,
): ArrayBuffer | null {
  const hasGroundNode = Array.isArray(rawScene.nodes)
    && rawScene.nodes.some((node) => node?.dynamicMesh?.type === 'Ground')
  if (!hasGroundNode) {
    return null
  }
  const sidecarPath = sceneEntry.groundSplatPath
  if (!sidecarPath) {
    return null
  }
  const bytes = zip.files[sidecarPath]
  if (!bytes) {
    throw new Error(`Missing ground splat sidecar in scene bundle: ${sidecarPath}`)
  }
  return new Uint8Array(bytes).buffer
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
  return deserializeQuantizedTerrainDatasetRootManifest(readBinaryFileFromScenePackage(zip, manifestPath))
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

export async function loadStoredScenesFromScenePackage(
  zipBytes: ArrayBuffer,
  options: LoadStoredScenePackageOptions = {},
): Promise<LoadedStoredScenePackage> {
  const zip = unzipScenePackage(zipBytes)
  await restoreRuntimeResourcesFromPackage(zip)

  const projectText = readTextFileFromScenePackage(zip, zip.manifest.project.path)
  const project = (JSON.parse(projectText) as LoadedScenePackageProject) ?? {}
  const scenes: StoredSceneDocument[] = []
  const groundHeightSidecars: Record<string, ArrayBuffer | null> = {}
  const groundSplatSidecars: Record<string, ArrayBuffer | null> = {}
  const groundScatterSidecars: Record<string, ArrayBuffer | null> = {}
  const terrainDatasetManifests: Record<string, QuantizedTerrainDatasetRootManifest | null> = {}
  const terrainDatasetRegionPacks: Record<string, Record<string, ArrayBuffer | null>> = {}
  for (const sceneEntry of zip.manifest.scenes ?? []) {
    const rawScene = decodeScenePackageSceneDocument(readBinaryFileFromScenePackage(zip, sceneEntry.path)) as unknown
    if (!isPlainObject(rawScene)) {
      throw new Error(`Invalid scene document in scene bundle: ${sceneEntry.path}`)
    }
    const sceneDocument = stripGroundHeightMapsFromSceneDocument(rawScene as unknown as StoredSceneDocument)
    if (options.allowLandformNodes !== true) {
      assertNoLandformNodes(sceneDocument.nodes, `scenes[${sceneEntry.sceneId}]`)
    }
    groundHeightSidecars[sceneEntry.sceneId] = extractGroundHeightSidecarFromPackage(zip, sceneEntry, sceneDocument)
    groundSplatSidecars[sceneEntry.sceneId] = extractGroundSplatSidecarFromPackage(zip, sceneEntry, sceneDocument)
    groundScatterSidecars[sceneEntry.sceneId] = extractGroundScatterSidecarFromPackage(zip, sceneEntry, sceneDocument)
    terrainDatasetManifests[sceneEntry.sceneId] = extractTerrainDatasetManifestFromPackage(zip, sceneEntry)
    terrainDatasetRegionPacks[sceneEntry.sceneId] = extractTerrainDatasetRegionPacksFromPackage(zip, terrainDatasetManifests[sceneEntry.sceneId] ?? null)
    const withPlanning = await applyPlanningSidecarToScene(zip, sceneEntry, sceneDocument)
    scenes.push(withPlanning)
  }

  return {
    project,
    scenes,
    groundHeightSidecars,
    groundSplatSidecars,
    groundScatterSidecars,
    terrainDatasetManifests,
    terrainDatasetRegionPacks,
  }
}
