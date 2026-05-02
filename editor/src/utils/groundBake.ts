import { parseTerrainPaintChunkKey, resolveTerrainPaintChunkBounds, resolveGroundWorldBounds, type GroundDynamicMesh, type SceneNode } from '@schema'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import { computeBlobHash } from '@/utils/blob'

const DEFAULT_BAKED_GROUND_MAX_RESOLUTION = 2048
const MIN_BAKED_GROUND_RESOLUTION = 256

type Canvas2DContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
type CanvasLike = OffscreenCanvas | HTMLCanvasElement

type ImageDataSource = {
  width: number
  height: number
  data: Uint8ClampedArray
}

type LoadedBakedImage = {
  source: CanvasImageSource
  imageData: ImageDataSource
}

export type BakedGroundTextureResult = {
  assetId: string
  blob: Blob
  filename: string
  mimeType: string
  width: number
  height: number
}

function normalizeFinite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

function normalizeDimension(value: number): number {
  return Math.max(1, normalizeFinite(value, 1))
}


function createCompositionCanvas(width: number, height: number): { canvas: CanvasLike; context: Canvas2DContext } | null {
  const normalizedWidth = Math.max(1, Math.round(width))
  const normalizedHeight = Math.max(1, Math.round(height))
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(normalizedWidth, normalizedHeight)
    const context = canvas.getContext('2d')
    if (context) {
      return { canvas, context }
    }
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas')
    canvas.width = normalizedWidth
    canvas.height = normalizedHeight
    const context = canvas.getContext('2d')
    if (context) {
      return { canvas, context }
    }
  }
  return null
}

function computeBakedTextureSize(definition: GroundDynamicMesh, maxResolution: number): { width: number; height: number } {
  const bounds = resolveGroundWorldBounds(definition)
  const groundWidth = normalizeDimension(bounds.maxX - bounds.minX)
  const groundDepth = normalizeDimension(bounds.maxZ - bounds.minZ)
  const maxDimension = Math.max(groundWidth, groundDepth, 1)
  const normalizedMax = Math.max(MIN_BAKED_GROUND_RESOLUTION, Math.round(maxResolution))
  const width = Math.max(
    MIN_BAKED_GROUND_RESOLUTION,
    Math.round((groundWidth / maxDimension) * normalizedMax),
  )
  const height = Math.max(
    MIN_BAKED_GROUND_RESOLUTION,
    Math.round((groundDepth / maxDimension) * normalizedMax),
  )
  return { width, height }
}

function looksLikeHttpUrl(value: string | null | undefined): boolean {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return /^https?:\/\//i.test(trimmed)
}

function findAssetDownloadUrl(scene: StoredSceneDocument, assetId: string): string | null {
  for (const assets of Object.values(scene.assetCatalog ?? {})) {
    const match = assets.find((asset) => asset.id === assetId)
    if (match?.downloadUrl) {
      return match.downloadUrl
    }
  }
  const resourceAsset = scene.resourceSummary?.assets?.find((asset) => asset.assetId === assetId)
  if (resourceAsset?.downloadUrl) {
    return resourceAsset.downloadUrl
  }
  return looksLikeHttpUrl(assetId) ? assetId : null
}

async function resolveSceneAssetBlob(scene: StoredSceneDocument, assetId: string): Promise<Blob | null> {
  const normalizedId = typeof assetId === 'string' ? assetId.trim() : ''
  if (!normalizedId) {
    return null
  }
  const assetCache = useAssetCacheStore()
  let entry = assetCache.getEntry(normalizedId)
  if (entry.status === 'cached' && entry.blob) {
    assetCache.touch(normalizedId)
    return entry.blob
  }
  const indexed = await assetCache.ensureAssetEntry(normalizedId, {
    downloadUrl: findAssetDownloadUrl(scene, normalizedId),
  })
  if (indexed?.status === 'cached' && indexed.blob) {
    assetCache.touch(normalizedId)
    return indexed.blob
  }
  const downloadUrl = findAssetDownloadUrl(scene, normalizedId)
  if (!downloadUrl) {
    return null
  }
  const response = await fetch(downloadUrl, { method: 'GET', credentials: 'omit', cache: 'no-cache' })
  if (!response.ok) {
    return null
  }
  const blob = await response.blob()
  await assetCache.storeAssetBlob(normalizedId, {
    blob,
    mimeType: blob.type || null,
    filename: null,
    downloadUrl,
  })
  assetCache.touch(normalizedId)
  return blob
}

async function resolveUrlBlob(url: string | null | undefined): Promise<Blob | null> {
  const trimmed = typeof url === 'string' ? url.trim() : ''
  if (!trimmed) {
    return null
  }
  const response = await fetch(trimmed, { method: 'GET', credentials: 'omit', cache: 'no-cache' })
  if (!response.ok) {
    return null
  }
  return await response.blob()
}

async function blobToCanvasImageSource(blob: Blob): Promise<CanvasImageSource | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob)
    } catch (_error) {
      // Fall back to Image element below.
    }
  }
  if (typeof Image === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return null
  }
  return await new Promise((resolve) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(blob)
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(null)
    }
    image.src = objectUrl
  })
}

function resolveCanvasImageSourceSize(source: CanvasImageSource): { width: number; height: number } | null {
  const candidate = source as { width?: number; height?: number; videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number }
  const width = candidate.width ?? candidate.videoWidth ?? candidate.naturalWidth ?? 0
  const height = candidate.height ?? candidate.videoHeight ?? candidate.naturalHeight ?? 0
  if (!(width > 0) || !(height > 0)) {
    return null
  }
  return { width, height }
}

function extractImageDataFromSource(source: CanvasImageSource): ImageDataSource | null {
  const size = resolveCanvasImageSourceSize(source)
  if (!size) {
    return null
  }
  const composition = createCompositionCanvas(size.width, size.height)
  if (!composition) {
    return null
  }
  composition.context.clearRect(0, 0, size.width, size.height)
  composition.context.drawImage(source, 0, 0, size.width, size.height)
  const imageData = composition.context.getImageData(0, 0, size.width, size.height)
  return {
    width: imageData.width,
    height: imageData.height,
    data: imageData.data,
  }
}

async function loadImageFromBlob(blob: Blob): Promise<LoadedBakedImage | null> {
  const source = await blobToCanvasImageSource(blob)
  if (!source) {
    return null
  }
  const imageData = extractImageDataFromSource(source)
  if (!imageData) {
    return null
  }
  return { source, imageData }
}


async function renderBaseTexture(
  context: Canvas2DContext,
  definition: GroundDynamicMesh,
  width: number,
  height: number,
): Promise<void> {
  context.clearRect(0, 0, width, height)
  context.save()
  context.globalCompositeOperation = 'source-over'
  context.globalAlpha = 1
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.restore()
  if (!definition.textureDataUrl) {
    return
  }
  const blob = await resolveUrlBlob(definition.textureDataUrl)
  if (!blob) {
    return
  }
  const loaded = await loadImageFromBlob(blob)
  if (!loaded) {
    return
  }
  context.drawImage(loaded.source, 0, 0, width, height)
}

// Landforms feature removed — previously implemented here; keep as no-op.
async function renderLandforms(): Promise<boolean> {
  return false
}

async function renderGroundSurfaceChunks(
  scene: StoredSceneDocument,
  definition: GroundDynamicMesh,
  context: Canvas2DContext,
  width: number,
  height: number,
): Promise<boolean> {
  const chunkEntries = Object.entries(definition.groundSurfaceChunks ?? {})
    .filter(([, chunkRef]) => typeof chunkRef?.textureAssetId === 'string' && chunkRef.textureAssetId.trim().length)
  if (!chunkEntries.length) {
    return false
  }
  const groundBounds = resolveGroundWorldBounds(definition)
  const groundWidth = Math.max(1e-6, normalizeDimension(groundBounds.maxX - groundBounds.minX))
  const groundDepth = Math.max(1e-6, normalizeDimension(groundBounds.maxZ - groundBounds.minZ))
  let drewAny = false

  for (const [chunkKey, chunkRef] of chunkEntries) {
    const parts = parseTerrainPaintChunkKey(chunkKey)
    if (!parts) {
      continue
    }
    const bounds = resolveTerrainPaintChunkBounds(definition, parts.chunkRow, parts.chunkColumn)
    if (!bounds) {
      continue
    }
    const textureAssetId = chunkRef?.textureAssetId?.trim() ?? ''
    if (!textureAssetId) {
      continue
    }
    const blob = await resolveSceneAssetBlob(scene, textureAssetId)
    if (!blob) {
      continue
    }
    const loaded = await loadImageFromBlob(blob)
    if (!loaded) {
      continue
    }
    const drawX = Math.floor(((bounds.minX - groundBounds.minX) / groundWidth) * width)
    const drawY = Math.floor(((bounds.minZ - groundBounds.minZ) / groundDepth) * height)
    const drawWidth = Math.max(1, Math.ceil((bounds.width / groundWidth) * width))
    const drawHeight = Math.max(1, Math.ceil((bounds.depth / groundDepth) * height))
    context.drawImage(loaded.source, drawX, drawY, drawWidth, drawHeight)
    drewAny = true
  }

  return drewAny
}

async function canvasToBlob(canvas: CanvasLike): Promise<Blob | null> {
  if ('convertToBlob' in canvas && typeof canvas.convertToBlob === 'function') {
    return await canvas.convertToBlob({ type: 'image/png' })
  }
  if ('toBlob' in canvas && typeof canvas.toBlob === 'function') {
    return await new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png')
    })
  }
  return null
}

// Landforms feature removed — no-op helper removed.

function hasTerrainPaintContent(definition: GroundDynamicMesh): boolean {
  return Object.values(definition.groundSurfaceChunks ?? {}).some((chunkRef) => typeof chunkRef?.textureAssetId === 'string' && chunkRef.textureAssetId.trim().length)
}

export async function bakeGroundSurfaceTexture(
  scene: StoredSceneDocument,
  options: { maxResolution?: number } = {},
): Promise<BakedGroundTextureResult | null> {
  const groundNode = findGroundNode(scene.nodes)
  const definition = groundNode?.dynamicMesh
  if (!groundNode || !definition || definition.type !== 'Ground') {
    return null
  }
  const hasBakeContent = hasTerrainPaintContent(definition)
  if (!hasBakeContent) {
    return null
  }
  const maxResolution = options.maxResolution ?? DEFAULT_BAKED_GROUND_MAX_RESOLUTION
  const size = computeBakedTextureSize(definition, maxResolution)
  const composition = createCompositionCanvas(size.width, size.height)
  if (!composition) {
    return null
  }
  const { canvas, context } = composition
  await renderBaseTexture(context, definition, size.width, size.height)
  await renderLandforms()
  await renderGroundSurfaceChunks(scene, definition, context, size.width, size.height)
  const blob = await canvasToBlob(canvas)
  if (!blob) {
    return null
  }
  const assetId = await computeBlobHash(blob)
  return {
    assetId,
    blob,
    filename: `ground-baked-${scene.id}.png`,
    mimeType: 'image/png',
    width: size.width,
    height: size.height,
  }
}

function findGroundNode(nodes: SceneNode[]): SceneNode | null {
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
