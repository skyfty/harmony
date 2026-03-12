import {
  resolveEnabledComponentState,
  type GroundDynamicMesh,
  type SceneNode,
  type TerrainPaintBlendMode,
  type TerrainPaintChannel,
  type TerrainPaintLayerDefinition,
  type TerrainPaintSettings,
} from '@schema'
import { resolveGroundChunkCells } from '@schema/groundMesh'
import { decodeWeightmapToData } from '@schema/terrainPaintPreview'
import {
  LANDFORMS_COMPONENT_TYPE,
  clampLandformsComponentProps,
  type LandformsBlendMode,
  type LandformsComponentProps,
  type LandformsLayer,
} from '@schema/components'
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

type ChunkBounds = {
  minX: number
  minZ: number
  width: number
  depth: number
}

type PreparedPaintChunk = {
  bounds: ChunkBounds
  pages: Array<Uint8ClampedArray | null>
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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  if (value <= 0) {
    return 0
  }
  if (value >= 1) {
    return 1
  }
  return value
}

function repeat01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  const wrapped = value - Math.floor(value)
  return wrapped < 0 ? wrapped + 1 : wrapped
}

function terrainPaintChannelIndex(channel: TerrainPaintChannel): number {
  switch (channel) {
    case 'g':
      return 1
    case 'b':
      return 2
    case 'a':
      return 3
    default:
      return 0
  }
}

function getTerrainPaintLayerSlotIndex(layer: TerrainPaintLayerDefinition): number {
  return Math.max(0, Math.floor(layer.pageIndex)) * 4 + terrainPaintChannelIndex(layer.channel)
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
  const groundWidth = normalizeDimension(definition.width)
  const groundDepth = normalizeDimension(definition.depth)
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
  const indexed = await assetCache.loadFromIndexedDb(normalizedId)
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

function sampleImageData(image: ImageDataSource, u: number, v: number, wrap: 'repeat' | 'clamp'): [number, number, number, number] {
  if (!(image.width > 0) || !(image.height > 0)) {
    return [1, 1, 1, 1]
  }
  const normalizedU = wrap === 'repeat' ? repeat01(u) : clamp01(u)
  const normalizedV = wrap === 'repeat' ? repeat01(v) : clamp01(v)
  const x = normalizedU * Math.max(0, image.width - 1)
  const y = normalizedV * Math.max(0, image.height - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(image.width - 1, x0 + 1)
  const y1 = Math.min(image.height - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  const read = (sampleX: number, sampleY: number): [number, number, number, number] => {
    const offset = (sampleY * image.width + sampleX) * 4
    return [
      (image.data[offset] ?? 0) / 255,
      (image.data[offset + 1] ?? 0) / 255,
      (image.data[offset + 2] ?? 0) / 255,
      (image.data[offset + 3] ?? 0) / 255,
    ]
  }
  const c00 = read(x0, y0)
  const c10 = read(x1, y0)
  const c01 = read(x0, y1)
  const c11 = read(x1, y1)
  const mix = (a: number, b: number, factor: number) => a + (b - a) * factor
  const top: [number, number, number, number] = [
    mix(c00[0], c10[0], tx),
    mix(c00[1], c10[1], tx),
    mix(c00[2], c10[2], tx),
    mix(c00[3], c10[3], tx),
  ]
  const bottom: [number, number, number, number] = [
    mix(c01[0], c11[0], tx),
    mix(c01[1], c11[1], tx),
    mix(c01[2], c11[2], tx),
    mix(c01[3], c11[3], tx),
  ]
  return [
    mix(top[0], bottom[0], ty),
    mix(top[1], bottom[1], ty),
    mix(top[2], bottom[2], ty),
    mix(top[3], bottom[3], ty),
  ]
}

function resolveLayerCompositeOperation(mode: LandformsBlendMode): GlobalCompositeOperation {
  switch (mode) {
    case 'multiply':
      return 'multiply'
    case 'screen':
      return 'screen'
    case 'overlay':
      return 'overlay'
    default:
      return 'source-over'
  }
}

function applyLayerMask(context: Canvas2DContext, layer: LandformsLayer, width: number, height: number): void {
  const shape = layer.mask.shape
  if (shape === 'none') {
    return
  }
  const centerX = width * normalizeFinite(layer.mask.center.x, 0.5)
  const centerY = height * normalizeFinite(layer.mask.center.y, 0.5)
  const sizeX = width * Math.max(0, normalizeFinite(layer.mask.size.x, 1))
  const sizeY = height * Math.max(0, normalizeFinite(layer.mask.size.y, 1))
  context.beginPath()
  if (shape === 'circle') {
    context.ellipse(centerX, centerY, Math.max(1, sizeX * 0.5), Math.max(1, sizeY * 0.5), 0, 0, Math.PI * 2)
  } else {
    context.rect(centerX - sizeX * 0.5, centerY - sizeY * 0.5, Math.max(1, sizeX), Math.max(1, sizeY))
  }
  context.clip()
}

function drawLayerTiled(
  context: Canvas2DContext,
  image: CanvasImageSource,
  layer: LandformsLayer,
  width: number,
  height: number,
): void {
  const repeatX = Math.max(0.001, normalizeFinite(layer.tileScale.x, 1))
  const repeatY = Math.max(0.001, normalizeFinite(layer.tileScale.y, 1))
  const tileWidth = layer.worldSpace ? width / repeatX : Math.min(width, height) / repeatX
  const tileHeight = layer.worldSpace ? height / repeatY : Math.min(width, height) / repeatY
  const offsetX = normalizeFinite(layer.offset.x, 0) * tileWidth
  const offsetY = normalizeFinite(layer.offset.y, 0) * tileHeight
  const drawStartX = -tileWidth * 2 + offsetX
  const drawStartY = -tileHeight * 2 + offsetY
  const drawEndX = width + tileWidth * 2
  const drawEndY = height + tileHeight * 2
  for (let y = drawStartY; y < drawEndY; y += tileHeight) {
    for (let x = drawStartX; x < drawEndX; x += tileWidth) {
      context.drawImage(image, x, y, tileWidth, tileHeight)
    }
  }
}

async function renderBaseTexture(
  context: Canvas2DContext,
  definition: GroundDynamicMesh,
  width: number,
  height: number,
): Promise<void> {
  context.clearRect(0, 0, width, height)
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

async function renderLandforms(
  scene: StoredSceneDocument,
  groundNode: SceneNode,
  context: Canvas2DContext,
  width: number,
  height: number,
): Promise<boolean> {
  const component = resolveEnabledComponentState<LandformsComponentProps>(groundNode, LANDFORMS_COMPONENT_TYPE)
  if (!component) {
    return false
  }
  const props = clampLandformsComponentProps(component.props)
  const activeLayers = props.layers.filter((layer) => layer.enabled && typeof layer.assetId === 'string' && layer.assetId.trim().length)
  if (!activeLayers.length) {
    return false
  }
  for (const layer of activeLayers) {
    const assetId = layer.assetId?.trim()
    if (!assetId) {
      continue
    }
    const blob = await resolveSceneAssetBlob(scene, assetId)
    if (!blob) {
      continue
    }
    const loaded = await loadImageFromBlob(blob)
    if (!loaded) {
      continue
    }
    context.save()
    context.globalAlpha = clamp01(normalizeFinite(layer.opacity, 1))
    context.globalCompositeOperation = resolveLayerCompositeOperation(layer.blendMode)
    applyLayerMask(context, layer, width, height)
    context.translate(width * 0.5, height * 0.5)
    context.rotate((normalizeFinite(layer.rotationDeg, 0) * Math.PI) / 180)
    context.translate(-width * 0.5, -height * 0.5)
    drawLayerTiled(context, loaded.source, layer, width, height)
    context.restore()
  }
  return true
}

function resolvePaintChunkBounds(
  definition: GroundDynamicMesh,
  chunkCells: number,
  chunkRow: number,
  chunkColumn: number,
): ChunkBounds | null {
  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
  const startColumn = chunkColumn * Math.max(1, chunkCells)
  const startRow = chunkRow * Math.max(1, chunkCells)
  const effectiveColumns = Math.max(0, Math.min(chunkCells, Math.max(0, definition.columns - startColumn)))
  const effectiveRows = Math.max(0, Math.min(chunkCells, Math.max(0, definition.rows - startRow)))
  const width = effectiveColumns * cellSize
  const depth = effectiveRows * cellSize
  if (!(width > 0) || !(depth > 0)) {
    return null
  }
  const minX = -halfWidth + startColumn * cellSize
  const minZ = -halfDepth + startRow * cellSize
  return { minX, minZ, width, depth }
}

function terrainPaintBlendColor(
  baseColor: [number, number, number],
  layerColor: [number, number, number],
  blendMode: TerrainPaintBlendMode | null | undefined,
): [number, number, number] {
  const overlayChannel = (base: number, layer: number): number => {
    if (base < 0.5) {
      return 2 * base * layer
    }
    return 1 - 2 * (1 - base) * (1 - layer)
  }
  switch (blendMode) {
    case 'multiply':
      return [baseColor[0] * layerColor[0], baseColor[1] * layerColor[1], baseColor[2] * layerColor[2]]
    case 'screen':
      return [
        1 - (1 - baseColor[0]) * (1 - layerColor[0]),
        1 - (1 - baseColor[1]) * (1 - layerColor[1]),
        1 - (1 - baseColor[2]) * (1 - layerColor[2]),
      ]
    case 'overlay':
      return [
        overlayChannel(baseColor[0], layerColor[0]),
        overlayChannel(baseColor[1], layerColor[1]),
        overlayChannel(baseColor[2], layerColor[2]),
      ]
    default:
      return layerColor
  }
}

function transformTerrainPaintUv(
  meshUv: [number, number],
  worldUv: [number, number],
  layer: TerrainPaintLayerDefinition,
): [number, number] {
  const baseUv = layer.worldSpace ? worldUv : meshUv
  const rotation = (normalizeFinite(layer.rotationDeg, 0) * Math.PI) / 180
  const s = Math.sin(rotation)
  const c = Math.cos(rotation)
  const centeredX = baseUv[0] - 0.5
  const centeredY = baseUv[1] - 0.5
  const rotatedX = c * centeredX - s * centeredY
  const rotatedY = s * centeredX + c * centeredY
  return [
    rotatedX * normalizeFinite(layer.tileScale.x, 1) + 0.5 + normalizeFinite(layer.offset.x, 0),
    rotatedY * normalizeFinite(layer.tileScale.y, 1) + 0.5 + normalizeFinite(layer.offset.y, 0),
  ]
}

function readWeightValue(page: Uint8ClampedArray | null, resolution: number, u: number, v: number, channelIndex: number): number {
  if (!page || resolution <= 0) {
    return 0
  }
  const image: ImageDataSource = { width: resolution, height: resolution, data: page }
  return sampleImageData(image, u, v, 'clamp')[channelIndex] ?? 0
}

async function prepareTerrainPaintChunks(
  scene: StoredSceneDocument,
  definition: GroundDynamicMesh,
  settings: TerrainPaintSettings,
): Promise<Map<string, PreparedPaintChunk>> {
  const chunkCells = resolveGroundChunkCells(definition)
  const prepared = new Map<string, PreparedPaintChunk>()
  const chunkEntries = Object.entries(settings.chunks ?? {})
  for (const [chunkKey, chunkRef] of chunkEntries) {
    const parts = chunkKey.split(':')
    const chunkRow = Number.parseInt(parts[0] ?? '', 10)
    const chunkColumn = Number.parseInt(parts[1] ?? '', 10)
    if (!Number.isFinite(chunkRow) || !Number.isFinite(chunkColumn)) {
      continue
    }
    const bounds = resolvePaintChunkBounds(definition, chunkCells, chunkRow, chunkColumn)
    if (!bounds) {
      continue
    }
    const pages: Array<Uint8ClampedArray | null> = []
    const refs = Array.isArray(chunkRef?.pages) ? chunkRef.pages : []
    for (const ref of refs) {
      const logicalId = typeof ref?.logicalId === 'string' ? ref.logicalId.trim() : ''
      if (!logicalId) {
        pages.push(null)
        continue
      }
      const blob = await resolveSceneAssetBlob(scene, logicalId)
      if (!blob) {
        pages.push(null)
        continue
      }
      try {
        pages.push(await decodeWeightmapToData(blob, settings.weightmapResolution))
      } catch (_error) {
        pages.push(null)
      }
    }
    prepared.set(chunkKey, { bounds, pages })
  }
  return prepared
}

async function renderTerrainPaint(
  scene: StoredSceneDocument,
  definition: GroundDynamicMesh,
  context: Canvas2DContext,
  width: number,
  height: number,
): Promise<boolean> {
  const settings = (definition as any)?.terrainPaint as TerrainPaintSettings | null | undefined
  if (!settings || settings.version !== 2 || !Array.isArray(settings.layers) || !settings.layers.length) {
    return false
  }
  const chunkEntries = Object.entries(settings.chunks ?? {})
  if (!chunkEntries.length) {
    return false
  }
  const sortedLayers = [...settings.layers]
    .sort((left, right) => getTerrainPaintLayerSlotIndex(left) - getTerrainPaintLayerSlotIndex(right))

  const layerImages = new Map<string, LoadedBakedImage>()
  for (const layer of sortedLayers) {
    const assetId = typeof layer.textureAssetId === 'string' ? layer.textureAssetId.trim() : ''
    if (!assetId || layerImages.has(assetId)) {
      continue
    }
    const blob = await resolveSceneAssetBlob(scene, assetId)
    if (!blob) {
      continue
    }
    const loaded = await loadImageFromBlob(blob)
    if (loaded) {
      layerImages.set(assetId, loaded)
    }
  }

  const preparedChunks = await prepareTerrainPaintChunks(scene, definition, settings)
  if (!preparedChunks.size || !layerImages.size) {
    return false
  }

  const output = context.getImageData(0, 0, width, height)
  const outputData = output.data
  const groundWidth = Math.max(1e-6, normalizeDimension(definition.width))
  const groundDepth = Math.max(1e-6, normalizeDimension(definition.depth))
  const halfWidth = groundWidth * 0.5
  const halfDepth = groundDepth * 0.5

  for (const chunk of preparedChunks.values()) {
    const startX = Math.max(0, Math.floor(((chunk.bounds.minX + halfWidth) / groundWidth) * width))
    const endX = Math.min(width, Math.ceil(((chunk.bounds.minX + chunk.bounds.width + halfWidth) / groundWidth) * width))
    const startY = Math.max(0, Math.floor(((chunk.bounds.minZ + halfDepth) / groundDepth) * height))
    const endY = Math.min(height, Math.ceil(((chunk.bounds.minZ + chunk.bounds.depth + halfDepth) / groundDepth) * height))
    if (startX >= endX || startY >= endY) {
      continue
    }
    for (let y = startY; y < endY; y += 1) {
      const worldZ = ((y + 0.5) / height) * groundDepth - halfDepth
      const meshV = clamp01((worldZ - chunk.bounds.minZ) / Math.max(1e-6, chunk.bounds.depth))
      const groundV = clamp01((worldZ + halfDepth) / groundDepth)
      for (let x = startX; x < endX; x += 1) {
        const worldX = ((x + 0.5) / width) * groundWidth - halfWidth
        const meshU = clamp01((worldX - chunk.bounds.minX) / Math.max(1e-6, chunk.bounds.width))
        const groundU = clamp01((worldX + halfWidth) / groundWidth)
        const pixelOffset = (y * width + x) * 4
        let color: [number, number, number] = [
          (outputData[pixelOffset] ?? 255) / 255,
          (outputData[pixelOffset + 1] ?? 255) / 255,
          (outputData[pixelOffset + 2] ?? 255) / 255,
        ]
        let alpha = (outputData[pixelOffset + 3] ?? 0) / 255
        for (const layer of sortedLayers) {
          const assetId = typeof layer.textureAssetId === 'string' ? layer.textureAssetId.trim() : ''
          const texture = assetId ? layerImages.get(assetId) : null
          if (!texture) {
            continue
          }
          const weight = readWeightValue(
            chunk.pages[layer.pageIndex] ?? null,
            settings.weightmapResolution,
            meshU,
            meshV,
            terrainPaintChannelIndex(layer.channel),
          )
          if (weight <= 0) {
            continue
          }
          const layerUv = transformTerrainPaintUv([meshU, meshV], [groundU, groundV], layer)
          const sample = sampleImageData(texture.imageData, layerUv[0], layerUv[1], 'repeat')
          const blended = terrainPaintBlendColor(color, [sample[0], sample[1], sample[2]], layer.blendMode)
          const layerAlpha = clamp01(normalizeFinite(layer.opacity, 1)) * sample[3] * weight
          if (layerAlpha <= 0) {
            continue
          }
          const nextAlpha = layerAlpha + alpha * (1 - layerAlpha)
          if (nextAlpha <= 0) {
            color = [0, 0, 0]
            alpha = 0
            continue
          }
          color = [
            (blended[0] * layerAlpha + color[0] * alpha * (1 - layerAlpha)) / nextAlpha,
            (blended[1] * layerAlpha + color[1] * alpha * (1 - layerAlpha)) / nextAlpha,
            (blended[2] * layerAlpha + color[2] * alpha * (1 - layerAlpha)) / nextAlpha,
          ]
          alpha = nextAlpha
        }
        outputData[pixelOffset] = Math.round(clamp01(color[0]) * 255)
        outputData[pixelOffset + 1] = Math.round(clamp01(color[1]) * 255)
        outputData[pixelOffset + 2] = Math.round(clamp01(color[2]) * 255)
        outputData[pixelOffset + 3] = Math.round(clamp01(alpha) * 255)
      }
    }
  }

  context.putImageData(output, 0, 0)
  return true
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

function hasLandformsContent(groundNode: SceneNode): boolean {
  const component = resolveEnabledComponentState<LandformsComponentProps>(groundNode, LANDFORMS_COMPONENT_TYPE)
  if (!component) {
    return false
  }
  const props = clampLandformsComponentProps(component.props)
  return props.layers.some((layer) => layer.enabled && typeof layer.assetId === 'string' && layer.assetId.trim().length)
}

function hasTerrainPaintContent(definition: GroundDynamicMesh): boolean {
  const settings = (definition as any)?.terrainPaint as TerrainPaintSettings | null | undefined
  if (!settings || settings.version !== 2) {
    return false
  }
  if (!Array.isArray(settings.layers) || settings.layers.length === 0) {
    return false
  }
  return Object.values(settings.chunks ?? {}).some((chunk) => Array.isArray(chunk?.pages) && chunk.pages.some((page) => typeof page?.logicalId === 'string' && page.logicalId.trim().length))
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
  const hasBakeContent = hasLandformsContent(groundNode) || hasTerrainPaintContent(definition)
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
  await renderLandforms(scene, groundNode, context, size.width, size.height)
  await renderTerrainPaint(scene, definition, context, size.width, size.height)
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