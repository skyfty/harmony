import { zipSync, strToU8 } from 'fflate'
import type {
  SceneAssetOverrideEntry,
  SceneAssetRegistryEntry,
  SceneJsonExportDocument,
} from '@schema/core'
import {
  type ScenePackageResourceEntry,
} from '@schema/core'

import { inferExtFromMimeType } from '@schema/core'
import type { PlanningImageData, PlanningSceneData } from '@/types/planning-scene-data'
import type { PlanningScenePackageImageEntry, PlanningScenePackageSidecar } from '@/types/planning-package'
import { getPlanningImageBlobByHash } from '@/utils/planningImageStorage'

import { loadPlanningDemBlobByHash } from '@/utils/planningDemStorage'
import { sha256Hex } from '@harmony/utils/hash'

function cloneSceneAssetRegistryEntries(
  entries: Record<string, SceneAssetRegistryEntry | SceneAssetOverrideEntry> | null | undefined,
): Record<string, SceneAssetRegistryEntry> {
  const out: Record<string, SceneAssetRegistryEntry> = {}
  if (!entries || typeof entries !== 'object') {
    return out
  }
  Object.entries(entries).forEach(([assetId, entry]) => {
    if (!entry || typeof entry !== 'object') {
      return
    }
    out[assetId] = { ...entry }
  })
  return out
}

function mergeSceneAssetRegistryEntries(
  target: Record<string, SceneAssetRegistryEntry>,
  entries: Record<string, SceneAssetRegistryEntry | SceneAssetOverrideEntry> | null | undefined,
): void {
  const cloned = cloneSceneAssetRegistryEntries(entries)
  Object.assign(target, cloned)
}

export function buildEffectiveAssetRegistry(
  document: SceneJsonExportDocument | null | undefined,
): Record<string, SceneAssetRegistryEntry> {
  const out: Record<string, SceneAssetRegistryEntry> = {}
  if (!document || typeof document !== 'object') {
    return out
  }

  mergeSceneAssetRegistryEntries(out, document.assetRegistry ?? undefined)
  mergeSceneAssetRegistryEntries(out, document.projectOverrideAssets ?? undefined)
  mergeSceneAssetRegistryEntries(out, document.sceneOverrideAssets ?? undefined)
  return out
}

export function buildPackagedAssetPathMap(
  sharedAssetPathById: ReadonlyMap<string, string>,
  resources: ScenePackageResourceEntry[],
): Map<string, string> {
  const packagedAssetPathById = new Map<string, string>()
  sharedAssetPathById.forEach((path, assetId) => {
    packagedAssetPathById.set(assetId, path)
  })
  resources.forEach((entry) => {
    packagedAssetPathById.set(entry.logicalId, entry.path)
  })
  return packagedAssetPathById
}

// inferExtFromMimeType moved to @schema (assetTypeConversion)

export function inferExtFromFilename(filename: string | null | undefined): string | null {
  const raw = typeof filename === 'string' ? filename.trim() : ''
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot <= 0 || dot >= raw.length - 1) return null
  return raw.slice(dot + 1).toLowerCase()
}

export function jsonBytes(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value))
}


export type ResolvedEmbedAsset = {
  assetId: string
  downloadUrl: string | null
  mimeTypeHint?: string | null
  filenameHint?: string | null
  extensionHint?: string | null
}

export function stripGroundBakedTextureAssetIds(groundNode: SceneJsonExportDocument['nodes'][number] | null | undefined): void {
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


export async function resolvePlanningImageBlob(image: {
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

async function appendPlanningImageResource(options: {
  sceneId: string
  encodedSceneId: string
  image: PlanningImageData
  resolved: Awaited<ReturnType<typeof resolvePlanningImageBlob>>
  files: Record<string, Uint8Array>
  resources: ScenePackageResourceEntry[]
  resourcePathByHash: Map<string, string>
}): Promise<PlanningScenePackageImageEntry> {
  const { sceneId, encodedSceneId, image, resolved, files, resources, resourcePathByHash } = options
  if (!resolved) {
    return {
      imageId: image.id,
      imageHash: typeof image.imageHash === 'string' ? image.imageHash : null,
      resourcePath: null,
      filename: image.filename ?? null,
      mimeType: image.mimeType ?? null,
    }
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

  return {
    imageId: image.id,
    imageHash: resolved.imageHash,
    resourcePath,
    filename: image.filename ?? resolved.filename ?? null,
    mimeType: image.mimeType ?? resolved.mimeType,
  }
}

async function collectPlanningImageSidecarEntries(options: {
  sceneId: string
  encodedSceneId: string
  planningData: PlanningSceneData
  files: Record<string, Uint8Array>
  resources: ScenePackageResourceEntry[]
}): Promise<PlanningScenePackageImageEntry[]> {
  const { sceneId, encodedSceneId, planningData, files, resources } = options
  const images: PlanningScenePackageImageEntry[] = []
  const resourcePathByHash = new Map<string, string>()
  for (const image of planningData.images ?? []) {
    const resolved = await resolvePlanningImageBlob(image)
    images.push(await appendPlanningImageResource({
      sceneId,
      encodedSceneId,
      image,
      resolved,
      files,
      resources,
      resourcePathByHash,
    }))
  }
  return images
}

async function attachPlanningOrthophotoResource(options: {
  sceneId: string
  encodedSceneId: string
  planningData: PlanningSceneData
  files: Record<string, Uint8Array>
  resources: ScenePackageResourceEntry[]
}): Promise<PlanningScenePackageSidecar['orthophoto']> {
  const { sceneId, encodedSceneId, planningData, files, resources } = options
  const orthophotoHash = typeof planningData.terrain?.dem?.orthophoto?.sourceFileHash === 'string'
    ? planningData.terrain.dem.orthophoto.sourceFileHash.trim()
    : ''
  if (!orthophotoHash) {
    return null
  }
  const orthophotoBlob = await loadPlanningDemBlobByHash(orthophotoHash)
  if (!orthophotoBlob) {
    throw new Error(`Missing planning orthophoto resource (imageHash=${orthophotoHash}); please reopen the orthophoto before exporting.`)
  }
  const orthophotoMimeType = planningData.terrain?.dem?.orthophoto?.mimeType ?? orthophotoBlob.type ?? 'application/octet-stream'
  const orthophotoFilename = planningData.terrain?.dem?.orthophoto?.filename ?? 'orthophoto'
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
  return {
    sourceFileHash: orthophotoHash,
    resourcePath: orthophotoPath,
    filename: orthophotoFilename,
    mimeType: orthophotoMimeType,
  }
}

export async function buildPlanningSidecar(
  sceneId: string,
  planningData: PlanningSceneData,
  files: Record<string, Uint8Array>,
  resources: ScenePackageResourceEntry[],
): Promise<{ planningPath: string; sidecar: PlanningScenePackageSidecar }> {
  const encodedSceneId = encodeURIComponent(sceneId)
  const nextPlanningData = structuredClone(planningData) as PlanningSceneData
  const images = await collectPlanningImageSidecarEntries({
    sceneId,
    encodedSceneId,
    planningData: nextPlanningData,
    files,
    resources,
  })

  const orthophoto = await attachPlanningOrthophotoResource({
    sceneId,
    encodedSceneId,
    planningData: nextPlanningData,
    files,
    resources,
  })

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

export function createScenePackageZipBlob(files: Record<string, Uint8Array>): Blob {
  const zipBytes = zipSync(files, { level: 6 })
  // fflate returns Uint8Array<ArrayBufferLike> which fails BlobPart typing; copy into ArrayBuffer.
  const zipArrayBuffer = new ArrayBuffer(zipBytes.byteLength)
  new Uint8Array(zipArrayBuffer).set(zipBytes)
  return new Blob([zipArrayBuffer], { type: 'application/zip' })
}
