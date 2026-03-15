import * as THREE from 'three'
import type {
  GroundDynamicMesh,
  SceneNode,
  TerrainPaintBlendMode,
  TerrainPaintLayerDefinition,
  TerrainPaintSettings,
} from './index'
import { stableSerialize } from './stableSerialize'
import { resolveEnabledComponentState } from './componentRuntimeUtils'
import {
  LANDFORMS_COMPONENT_TYPE,
  clampLandformsComponentProps,
  type LandformsBlendMode,
  type LandformsComponentProps,
  type LandformsLayer,
} from './components'
import {
  LANDFORMS_PREVIEW_SIGNATURE_USERDATA_KEY,
  clearLandformsPreviewForGround,
  getLandformsPreviewTexture,
  setLandformsPreviewTexture,
  type LandformsPreviewLoaders,
} from './landformsPreview'
import {
  decodeTerrainPaintMaskTileToData,
  formatTerrainPaintTileKey,
  parseTerrainPaintChunkKey,
  parseTerrainPaintTileKey,
  resolveTerrainPaintChunkBounds,
  resolveTerrainPaintTileWorldBounds,
  resolveTerrainPaintTilesPerAxis,
  sampleTerrainPaintMaskTileValue,
  type TerrainPaintChunkBounds,
} from './terrainPaintTiles'

const DEFAULT_GROUND_SURFACE_PREVIEW_MAX_RESOLUTION = 1024
const MIN_GROUND_SURFACE_PREVIEW_RESOLUTION = 256
const groundSurfacePreviewRequests = new Map<string, Promise<THREE.Texture | null>>()
const DEFAULT_GROUND_SURFACE_PREVIEW_BACKGROUND = '#ffffff'
const GROUND_SURFACE_PREVIEW_DEBUG_FLAG_KEY = '__HARMONY_GROUND_SURFACE_PREVIEW_DEBUG__'
const GROUND_SURFACE_PREVIEW_STATS_KEY = '__HARMONY_GROUND_SURFACE_PREVIEW_STATS__'

type Canvas2DContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

type CanvasLike = OffscreenCanvas | HTMLCanvasElement

export type GroundSurfacePreviewCanvasResult = {
  canvas: CanvasLike
  width: number
  height: number
}

type ImageDataSource = {
  width: number
  height: number
  data: Uint8ClampedArray
}

type LoadedPreviewImage = {
  source: CanvasImageSource
  imageData: ImageDataSource
}

type GroundSurfacePreviewPerfBucket = {
  count: number
  totalMs: number
  maxMs: number
  lastMs: number
  lastDetails: Record<string, unknown>
}

type GroundSurfacePreviewPerfStats = Record<string, GroundSurfacePreviewPerfBucket>

type WorldBounds = {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

type PixelBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type PreparedTerrainPaintChunk = {
  bounds: TerrainPaintChunkBounds
  tileWidth: number
  tileDepth: number
  tilesPerAxisX: number
  tilesPerAxisZ: number
  layerTiles: Map<string, Map<string, Uint8ClampedArray | null>>
}

type CompiledTerrainPaintLayer = {
  id: string
  opacity: number
  blendMode: TerrainPaintBlendMode | null | undefined
  worldSpace: boolean
  rotationSin: number
  rotationCos: number
  scaleX: number
  scaleY: number
  offsetX: number
  offsetY: number
  imageData: ImageDataSource
}

export type GroundSurfacePreviewLoaders = LandformsPreviewLoaders & {
  loadTerrainPaintTextureFromAssetId: (assetId: string, options: { colorSpace: 'srgb' | 'none' }) => Promise<THREE.Texture | null>
  loadTerrainPaintWeightmapDataFromAssetId: (assetId: string, resolution: number) => Promise<Uint8ClampedArray | null>
  loadGroundSurfaceBaseTextureFromUrl: (url: string) => Promise<THREE.Texture | null>
  loadTerrainPaintMaskTileDataFromAssetId: (assetId: string, resolution: number) => Promise<Uint8ClampedArray | null>
}

export type GroundSurfacePreviewOptions = {
  maxResolution?: number
  liveChunkTileMasksByKey?: Map<string, Map<string, Map<string, Uint8ClampedArray | null>>>
  previewRevision?: number
  applyToMaterialMap?: boolean
  reuseCanvas?: CanvasLike | null
  seedTexture?: THREE.Texture | null
}

const GROUND_SURFACE_PREVIEW_ORIGINAL_MAP_KEY = '__groundSurfacePreviewOriginalMap'
const GROUND_SURFACE_PREVIEW_MAP_ACTIVE_KEY = '__groundSurfacePreviewMapActive'
const GROUND_SURFACE_PREVIEW_LIVE_TEXTURE_KEY = '__groundSurfacePreviewLiveTexture'
const extractedPreviewImageDataCache = new WeakMap<object, ImageDataSource>()

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function recordGroundSurfacePreviewPerf(stage: string, durationMs: number, details: Record<string, unknown> = {}): void {
  const globalScope = globalThis as Record<string, unknown>
  let stats = globalScope[GROUND_SURFACE_PREVIEW_STATS_KEY] as GroundSurfacePreviewPerfStats | undefined
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
    stats = {}
    globalScope[GROUND_SURFACE_PREVIEW_STATS_KEY] = stats
  }
  const bucket = stats[stage] ?? {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    lastMs: 0,
    lastDetails: {},
  }
  bucket.count += 1
  bucket.totalMs += durationMs
  bucket.maxMs = Math.max(bucket.maxMs, durationMs)
  bucket.lastMs = durationMs
  bucket.lastDetails = details
  stats[stage] = bucket
  if (globalScope[GROUND_SURFACE_PREVIEW_DEBUG_FLAG_KEY] === true) {
    console.debug('[groundSurfacePreview]', stage, {
      durationMs: Math.round(durationMs * 100) / 100,
      ...details,
    })
  }
}

function buildWorldBounds(minX: number, minZ: number, maxX: number, maxZ: number): WorldBounds | null {
  if (!(maxX > minX) || !(maxZ > minZ)) {
    return null
  }
  return { minX, minZ, maxX, maxZ }
}

function mergeWorldBounds(target: WorldBounds | null, next: WorldBounds | null): WorldBounds | null {
  if (!next) {
    return target
  }
  if (!target) {
    return { ...next }
  }
  target.minX = Math.min(target.minX, next.minX)
  target.minZ = Math.min(target.minZ, next.minZ)
  target.maxX = Math.max(target.maxX, next.maxX)
  target.maxZ = Math.max(target.maxZ, next.maxZ)
  return target
}

function resolveWorldBoundsToPixelBounds(
  bounds: WorldBounds | null,
  definition: GroundDynamicMesh,
  width: number,
  height: number,
): PixelBounds | null {
  if (!bounds) {
    return null
  }
  const groundWidth = Math.max(1e-6, normalizeDimension(definition.width))
  const groundDepth = Math.max(1e-6, normalizeDimension(definition.depth))
  const halfWidth = groundWidth * 0.5
  const halfDepth = groundDepth * 0.5
  const minX = Math.max(0, Math.floor(((bounds.minX + halfWidth) / groundWidth) * width))
  const maxX = Math.min(width, Math.ceil(((bounds.maxX + halfWidth) / groundWidth) * width))
  const minY = Math.max(0, Math.floor(((bounds.minZ + halfDepth) / groundDepth) * height))
  const maxY = Math.min(height, Math.ceil(((bounds.maxZ + halfDepth) / groundDepth) * height))
  if (!(maxX > minX) || !(maxY > minY)) {
    return null
  }
  return { minX, minY, maxX, maxY }
}

function resolveTextureCanvas(texture: THREE.Texture | null | undefined): CanvasLike | null {
  const image = texture?.image as unknown
  if (!image || typeof image !== 'object') {
    return null
  }
  if (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas) {
    return image
  }
  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
    return image
  }
  return null
}

function resolveTextureImageSource(texture: THREE.Texture | null | undefined): CanvasImageSource | null {
  const image = texture?.image as CanvasImageSource | undefined
  return image ?? null
}

function getGroundSurfacePreviewLiveTexture(root: THREE.Object3D | null | undefined): THREE.Texture | null {
  return ((root?.userData as Record<string, unknown> | undefined)?.[GROUND_SURFACE_PREVIEW_LIVE_TEXTURE_KEY] as THREE.Texture | null | undefined) ?? null
}

function setGroundSurfacePreviewLiveTexture(root: THREE.Object3D, texture: THREE.Texture | null): void {
  ;(root.userData as Record<string, unknown>)[GROUND_SURFACE_PREVIEW_LIVE_TEXTURE_KEY] = texture
}

function clearGroundSurfacePreviewLiveTexture(root: THREE.Object3D | null | undefined): void {
  const texture = getGroundSurfacePreviewLiveTexture(root)
  if (texture) {
    texture.dispose()
  }
  if (root?.userData) {
    delete (root.userData as Record<string, unknown>)[GROUND_SURFACE_PREVIEW_LIVE_TEXTURE_KEY]
  }
}

function releaseGroundSurfacePreviewLiveTextureIfDifferent(root: THREE.Object3D | null | undefined, nextTexture: THREE.Texture | null): void {
  const liveTexture = getGroundSurfacePreviewLiveTexture(root)
  if (!liveTexture || liveTexture === nextTexture) {
    return
  }
  liveTexture.dispose()
  if (root?.userData) {
    delete (root.userData as Record<string, unknown>)[GROUND_SURFACE_PREVIEW_LIVE_TEXTURE_KEY]
  }
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

function computePreviewTextureSize(definition: GroundDynamicMesh, maxResolution: number): { width: number; height: number } {
  const groundWidth = normalizeDimension(definition.width)
  const groundDepth = normalizeDimension(definition.depth)
  const maxDimension = Math.max(groundWidth, groundDepth, 1)
  const normalizedMax = Math.max(MIN_GROUND_SURFACE_PREVIEW_RESOLUTION, Math.round(maxResolution))
  const width = Math.max(
    MIN_GROUND_SURFACE_PREVIEW_RESOLUTION,
    Math.round((groundWidth / maxDimension) * normalizedMax),
  )
  const height = Math.max(
    MIN_GROUND_SURFACE_PREVIEW_RESOLUTION,
    Math.round((groundDepth / maxDimension) * normalizedMax),
  )
  return { width, height }
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
  const cacheKey = typeof source === 'object' && source ? source as object : null
  const size = resolveCanvasImageSourceSize(source)
  if (!size) {
    return null
  }
  if (cacheKey) {
    const cached = extractedPreviewImageDataCache.get(cacheKey)
    if (cached && cached.width === size.width && cached.height === size.height) {
      recordGroundSurfacePreviewPerf('extract-image-data-cache-hit', 0, {
        width: size.width,
        height: size.height,
      })
      return cached
    }
  }
  const composition = createCompositionCanvas(size.width, size.height)
  if (!composition) {
    return null
  }
  const startTime = nowMs()
  composition.context.clearRect(0, 0, size.width, size.height)
  composition.context.drawImage(source, 0, 0, size.width, size.height)
  const imageData = composition.context.getImageData(0, 0, size.width, size.height)
  const extracted = {
    width: imageData.width,
    height: imageData.height,
    data: imageData.data,
  }
  if (cacheKey) {
    extractedPreviewImageDataCache.set(cacheKey, extracted)
  }
  recordGroundSurfacePreviewPerf('extract-image-data', nowMs() - startTime, {
    width: size.width,
    height: size.height,
  })
  return extracted
}

function loadImageDataFromTexture(texture: THREE.Texture | null): LoadedPreviewImage | null {
  const startTime = nowMs()
  const source = (texture?.image as CanvasImageSource | undefined) ?? null
  if (!source) {
    return null
  }
  const imageData = extractImageDataFromSource(source)
  if (!imageData) {
    return null
  }
  recordGroundSurfacePreviewPerf('load-texture-image-data', nowMs() - startTime, {
    textureUuid: texture?.uuid ?? null,
    width: imageData.width,
    height: imageData.height,
  })
  return { source, imageData }
}

function mix(a: number, b: number, factor: number): number {
  return a + (b - a) * factor
}

function forEachGroundPreviewMaterial(root: THREE.Object3D, visitor: (material: THREE.MeshStandardMaterial) => void): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    const material = mesh.material
    if (Array.isArray(material)) {
      material.forEach((entry) => {
        if (entry instanceof THREE.MeshStandardMaterial) {
          visitor(entry)
        }
      })
      return
    }
    if (material instanceof THREE.MeshStandardMaterial) {
      visitor(material)
    }
  })
}

function applyGroundSurfacePreviewToMaterialMap(root: THREE.Object3D, texture: THREE.Texture): void {
  forEachGroundPreviewMaterial(root, (material) => {
    const userData = (material.userData ??= {}) as Record<string, unknown>
    if (!(GROUND_SURFACE_PREVIEW_ORIGINAL_MAP_KEY in userData)) {
      userData[GROUND_SURFACE_PREVIEW_ORIGINAL_MAP_KEY] = material.map ?? null
    }
    userData[GROUND_SURFACE_PREVIEW_MAP_ACTIVE_KEY] = true
    if (material.map !== texture) {
      material.map = texture
      material.needsUpdate = true
    }
  })
}

export function restoreGroundSurfacePreviewMaterialMap(root: THREE.Object3D | null | undefined): void {
  if (!root) {
    return
  }
  clearGroundSurfacePreviewLiveTexture(root)
  forEachGroundPreviewMaterial(root, (material) => {
    const userData = (material.userData ?? {}) as Record<string, unknown>
    if (!(GROUND_SURFACE_PREVIEW_ORIGINAL_MAP_KEY in userData)) {
      return
    }
    material.map = (userData[GROUND_SURFACE_PREVIEW_ORIGINAL_MAP_KEY] as THREE.Texture | null | undefined) ?? null
    delete userData[GROUND_SURFACE_PREVIEW_ORIGINAL_MAP_KEY]
    delete userData[GROUND_SURFACE_PREVIEW_MAP_ACTIVE_KEY]
    material.needsUpdate = true
  })
}

function sampleImageData(image: ImageDataSource, u: number, v: number, wrap: 'repeat' | 'clamp', target: Float32Array): void {
  if (!(image.width > 0) || !(image.height > 0)) {
    target[0] = 1
    target[1] = 1
    target[2] = 1
    target[3] = 1
    return
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
  const rowStride = image.width * 4
  const offset00 = y0 * rowStride + x0 * 4
  const offset10 = y0 * rowStride + x1 * 4
  const offset01 = y1 * rowStride + x0 * 4
  const offset11 = y1 * rowStride + x1 * 4
  for (let channelIndex = 0; channelIndex < 4; channelIndex += 1) {
    const top = mix((image.data[offset00 + channelIndex] ?? 0) / 255, (image.data[offset10 + channelIndex] ?? 0) / 255, tx)
    const bottom = mix((image.data[offset01 + channelIndex] ?? 0) / 255, (image.data[offset11 + channelIndex] ?? 0) / 255, tx)
    target[channelIndex] = mix(top, bottom, ty)
  }
}

function sampleTerrainPaintColorInto(
  meshU: number,
  meshV: number,
  worldU: number,
  worldV: number,
  layer: Pick<CompiledTerrainPaintLayer, 'worldSpace' | 'rotationSin' | 'rotationCos' | 'scaleX' | 'scaleY' | 'offsetX' | 'offsetY' | 'imageData'>,
  target: Float32Array,
): void {
  const baseU = layer.worldSpace ? worldU : meshU
  const baseV = layer.worldSpace ? worldV : meshV
  const centeredX = baseU - 0.5
  const centeredY = baseV - 0.5
  const rotatedX = layer.rotationCos * centeredX - layer.rotationSin * centeredY
  const rotatedY = layer.rotationSin * centeredX + layer.rotationCos * centeredY
  sampleImageData(
    layer.imageData,
    rotatedX * layer.scaleX + 0.5 + layer.offsetX,
    rotatedY * layer.scaleY + 0.5 + layer.offsetY,
    'repeat',
    target,
  )
}

function compileCurrentTerrainPaintLayer(layer: TerrainPaintLayerDefinition, imageData: ImageDataSource): CompiledTerrainPaintLayer {
  const rotation = (normalizeFinite(layer.rotationDeg, 0) * Math.PI) / 180
  return {
    id: layer.id,
    opacity: clamp01(normalizeFinite(layer.opacity, 1)),
    blendMode: layer.blendMode,
    worldSpace: layer.worldSpace === true,
    rotationSin: Math.sin(rotation),
    rotationCos: Math.cos(rotation),
    scaleX: normalizeFinite(layer.tileScale.x, 1),
    scaleY: normalizeFinite(layer.tileScale.y, 1),
    offsetX: normalizeFinite(layer.offset.x, 0),
    offsetY: normalizeFinite(layer.offset.y, 0),
    imageData,
  }
}

async function composeCurrentTerrainPaintIntoCanvas(params: {
  context: Canvas2DContext
  width: number
  height: number
  definition: GroundDynamicMesh
  terrainPaint: TerrainPaintSettings
  liveChunkTileMasksByKey?: Map<string, Map<string, Map<string, Uint8ClampedArray | null>>>
  loaders: GroundSurfacePreviewLoaders
  shouldAbort: () => boolean
  incremental: boolean
}): Promise<boolean> {
  const { context, width, height, definition, terrainPaint, liveChunkTileMasksByKey, loaders, shouldAbort, incremental } = params
  const composeStartTime = nowMs()
  const activeLayers = terrainPaint.layers.filter((layer) => layer.enabled !== false && layer.textureAssetId.length > 0)
  if (!activeLayers.length) {
    return false
  }

  const compiledLayers: CompiledTerrainPaintLayer[] = []
  const sampleScratch = new Float32Array(4)
  for (const layer of activeLayers) {
    const texture = await loaders.loadTerrainPaintTextureFromAssetId(layer.textureAssetId, { colorSpace: 'srgb' })
    if (shouldAbort()) {
      return false
    }
    const loaded = loadImageDataFromTexture(texture)
    if (loaded) {
      compiledLayers.push(compileCurrentTerrainPaintLayer(layer, loaded.imageData))
    }
  }
  if (!compiledLayers.length) {
    return false
  }

  const preparedChunks = new Map<string, PreparedTerrainPaintChunk>()

  const chunkKeys = new Set<string>()
  if (!incremental) {
    Object.keys(terrainPaint.chunks ?? {}).forEach((chunkKey) => {
      if (typeof chunkKey === 'string' && chunkKey.trim().length) {
        chunkKeys.add(chunkKey.trim())
      }
    })
  }
  if (liveChunkTileMasksByKey) {
    Array.from(liveChunkTileMasksByKey.keys()).forEach((chunkKey) => {
      const normalizedChunkKey = typeof chunkKey === 'string' ? chunkKey.trim() : ''
      if (normalizedChunkKey) {
        chunkKeys.add(normalizedChunkKey)
      }
    })
  }

  for (const chunkKey of chunkKeys) {
    const chunkState = terrainPaint.chunks?.[chunkKey]
    const liveChunkLayers = liveChunkTileMasksByKey?.get(chunkKey)
    const parts = parseTerrainPaintChunkKey(chunkKey)
    if (!parts) {
      continue
    }
    const bounds = resolveTerrainPaintChunkBounds(definition, parts.chunkRow, parts.chunkColumn)
    if (!bounds) {
      continue
    }
    const tilesPerAxisX = resolveTerrainPaintTilesPerAxis(bounds.width, terrainPaint.tileWorldSize)
    const tilesPerAxisZ = resolveTerrainPaintTilesPerAxis(bounds.depth, terrainPaint.tileWorldSize)
    const layerTiles = new Map<string, Map<string, Uint8ClampedArray | null>>()
    for (const layer of compiledLayers) {
      const tileRefs = chunkState?.layers?.[layer.id]?.tiles ?? {}
      const tileMap = new Map<string, Uint8ClampedArray | null>()
      const liveLayerTiles = liveChunkLayers?.get(layer.id)
      if (liveLayerTiles) {
        for (const [tileKey, tileMask] of liveLayerTiles.entries()) {
          const normalizedTileKey = typeof tileKey === 'string' ? tileKey.trim() : ''
          if (!normalizedTileKey) {
            continue
          }
          tileMap.set(normalizedTileKey, tileMask ? new Uint8ClampedArray(tileMask) : null)
        }
      }
      for (const [tileKey, tileRef] of Object.entries(tileRefs)) {
        if (tileMap.has(tileKey)) {
          continue
        }
        const logicalId = typeof tileRef?.logicalId === 'string' ? tileRef.logicalId.trim() : ''
        if (!logicalId) {
          continue
        }
        const data = await loaders.loadTerrainPaintMaskTileDataFromAssetId(logicalId, terrainPaint.tileResolution)
        if (shouldAbort()) {
          return false
        }
        tileMap.set(tileKey, data)
      }
      if (tileMap.size) {
        layerTiles.set(layer.id, tileMap)
      }
    }
    if (!layerTiles.size) {
      continue
    }
    preparedChunks.set(chunkKey, {
      bounds: bounds as TerrainPaintChunkBounds,
      tileWidth: bounds.width / Math.max(1, tilesPerAxisX),
      tileDepth: bounds.depth / Math.max(1, tilesPerAxisZ),
      tilesPerAxisX,
      tilesPerAxisZ,
      layerTiles,
    })
  }
  if (!preparedChunks.size) {
    return false
  }

  let dirtyWorldBounds: WorldBounds | null = null
  if (incremental && liveChunkTileMasksByKey?.size) {
    for (const [chunkKey, liveLayerMap] of liveChunkTileMasksByKey.entries()) {
      const preparedChunk = preparedChunks.get(chunkKey)
      if (!preparedChunk) {
        continue
      }
      let chunkDirtyBounds: WorldBounds | null = null
      for (const tileMap of liveLayerMap.values()) {
        for (const tileKey of tileMap.keys()) {
          const tileParts = parseTerrainPaintTileKey(tileKey)
          if (!tileParts) {
            chunkDirtyBounds = mergeWorldBounds(
              chunkDirtyBounds,
              buildWorldBounds(
                preparedChunk.bounds.minX,
                preparedChunk.bounds.minZ,
                preparedChunk.bounds.minX + preparedChunk.bounds.width,
                preparedChunk.bounds.minZ + preparedChunk.bounds.depth,
              ),
            )
            continue
          }
          const tileBounds = resolveTerrainPaintTileWorldBounds(
            preparedChunk.bounds,
            tileParts.tileRow,
            tileParts.tileColumn,
            terrainPaint.tileWorldSize,
          )
          chunkDirtyBounds = mergeWorldBounds(
            chunkDirtyBounds,
            buildWorldBounds(
              tileBounds.minX,
              tileBounds.minZ,
              tileBounds.minX + tileBounds.width,
              tileBounds.minZ + tileBounds.depth,
            ),
          )
        }
      }
      dirtyWorldBounds = mergeWorldBounds(
        dirtyWorldBounds,
        chunkDirtyBounds ?? buildWorldBounds(
          preparedChunk.bounds.minX,
          preparedChunk.bounds.minZ,
          preparedChunk.bounds.minX + preparedChunk.bounds.width,
          preparedChunk.bounds.minZ + preparedChunk.bounds.depth,
        ),
      )
    }
  }
  if (!dirtyWorldBounds) {
    for (const chunk of preparedChunks.values()) {
      dirtyWorldBounds = mergeWorldBounds(
        dirtyWorldBounds,
        buildWorldBounds(
          chunk.bounds.minX,
          chunk.bounds.minZ,
          chunk.bounds.minX + chunk.bounds.width,
          chunk.bounds.minZ + chunk.bounds.depth,
        ),
      )
    }
  }
  const dirtyPixelBounds = resolveWorldBoundsToPixelBounds(dirtyWorldBounds, definition, width, height)
  if (!dirtyPixelBounds) {
    return false
  }

  const output = context.getImageData(
    dirtyPixelBounds.minX,
    dirtyPixelBounds.minY,
    dirtyPixelBounds.maxX - dirtyPixelBounds.minX,
    dirtyPixelBounds.maxY - dirtyPixelBounds.minY,
  )
  const outputData = output.data
  const groundWidth = Math.max(1e-6, normalizeDimension(definition.width))
  const groundDepth = Math.max(1e-6, normalizeDimension(definition.depth))
  const halfWidth = groundWidth * 0.5
  const halfDepth = groundDepth * 0.5

  for (const chunk of preparedChunks.values()) {
    const { bounds } = chunk
    const startX = Math.max(dirtyPixelBounds.minX, Math.floor(((bounds.minX + halfWidth) / groundWidth) * width))
    const endX = Math.min(dirtyPixelBounds.maxX, Math.ceil(((bounds.minX + bounds.width + halfWidth) / groundWidth) * width))
    const startY = Math.max(dirtyPixelBounds.minY, Math.floor(((bounds.minZ + halfDepth) / groundDepth) * height))
    const endY = Math.min(dirtyPixelBounds.maxY, Math.ceil(((bounds.minZ + bounds.depth + halfDepth) / groundDepth) * height))
    if (startX >= endX || startY >= endY) {
      continue
    }
    for (let y = startY; y < endY; y += 1) {
      if (((y - startY) & 7) === 0 && shouldAbort()) {
        return false
      }
      const worldZ = ((y + 0.5) / height) * groundDepth - halfDepth
      const groundV = clamp01((worldZ + halfDepth) / groundDepth)
      for (let x = startX; x < endX; x += 1) {
        const worldX = ((x + 0.5) / width) * groundWidth - halfWidth
        const groundU = clamp01((worldX + halfWidth) / groundWidth)
        const localTileColumn = Math.min(chunk.tilesPerAxisX - 1, Math.max(0, Math.floor((worldX - bounds.minX) / Math.max(chunk.tileWidth, 1e-6))))
        const localTileRow = Math.min(chunk.tilesPerAxisZ - 1, Math.max(0, Math.floor((worldZ - bounds.minZ) / Math.max(chunk.tileDepth, 1e-6))))
        const tileKey = formatTerrainPaintTileKey(localTileRow, localTileColumn)
        const tileU = clamp01(((worldX - bounds.minX) - localTileColumn * chunk.tileWidth) / Math.max(chunk.tileWidth, 1e-6))
        const tileV = clamp01(((worldZ - bounds.minZ) - localTileRow * chunk.tileDepth) / Math.max(chunk.tileDepth, 1e-6))
        const pixelOffset = (((y - dirtyPixelBounds.minY) * output.width) + (x - dirtyPixelBounds.minX)) * 4
        let colorR = (outputData[pixelOffset] ?? 255) / 255
        let colorG = (outputData[pixelOffset + 1] ?? 255) / 255
        let colorB = (outputData[pixelOffset + 2] ?? 255) / 255
        for (const layer of compiledLayers) {
          const tileMap = chunk.layerTiles.get(layer.id)
          const tileMask = tileMap?.get(tileKey) ?? null
          const weight = sampleTerrainPaintMaskTileValue(tileMask, terrainPaint.tileResolution, tileU, tileV)
          if (weight <= 0) {
            continue
          }
            sampleTerrainPaintColorInto(groundU, groundV, groundU, groundV, layer, sampleScratch)
          const layerAlpha = layer.opacity * (sampleScratch[3] ?? 0) * weight
          if (layerAlpha <= 0) {
            continue
          }
          let blendedR = sampleScratch[0] ?? 0
          let blendedG = sampleScratch[1] ?? 0
          let blendedB = sampleScratch[2] ?? 0
          switch (layer.blendMode) {
            case 'multiply':
              blendedR = colorR * blendedR
              blendedG = colorG * blendedG
              blendedB = colorB * blendedB
              break
            case 'screen':
              blendedR = 1 - (1 - colorR) * (1 - blendedR)
              blendedG = 1 - (1 - colorG) * (1 - blendedG)
              blendedB = 1 - (1 - colorB) * (1 - blendedB)
              break
            case 'overlay':
              blendedR = colorR < 0.5 ? 2 * colorR * blendedR : 1 - 2 * (1 - colorR) * (1 - blendedR)
              blendedG = colorG < 0.5 ? 2 * colorG * blendedG : 1 - 2 * (1 - colorG) * (1 - blendedG)
              blendedB = colorB < 0.5 ? 2 * colorB * blendedB : 1 - 2 * (1 - colorB) * (1 - blendedB)
              break
            default:
              break
          }
          colorR = blendedR * layerAlpha + colorR * (1 - layerAlpha)
          colorG = blendedG * layerAlpha + colorG * (1 - layerAlpha)
          colorB = blendedB * layerAlpha + colorB * (1 - layerAlpha)
        }
        outputData[pixelOffset] = Math.round(clamp01(colorR) * 255)
        outputData[pixelOffset + 1] = Math.round(clamp01(colorG) * 255)
        outputData[pixelOffset + 2] = Math.round(clamp01(colorB) * 255)
        outputData[pixelOffset + 3] = 255
      }
    }
  }

  context.putImageData(output, dirtyPixelBounds.minX, dirtyPixelBounds.minY)
  recordGroundSurfacePreviewPerf('compose-terrain-paint', nowMs() - composeStartTime, {
    incremental,
    width,
    height,
    activeLayerCount: compiledLayers.length,
    preparedChunkCount: preparedChunks.size,
    dirtyWidth: output.width,
    dirtyHeight: output.height,
    liveChunkCount: liveChunkTileMasksByKey?.size ?? 0,
  })
  return true
}

function buildGroundSurfacePreviewSignature(groundNode: SceneNode, definition: GroundDynamicMesh, options: GroundSurfacePreviewOptions): string {
  const component = resolveEnabledComponentState<LandformsComponentProps>(groundNode, LANDFORMS_COMPONENT_TYPE)
  const props = component ? clampLandformsComponentProps(component.props) : { layers: [] }
  const terrainPaint = definition.terrainPaint ?? null
  const liveTileKeys = options.liveChunkTileMasksByKey ? Array.from(options.liveChunkTileMasksByKey.keys()).sort() : []
  return stableSerialize({
    width: normalizeDimension(definition.width),
    depth: normalizeDimension(definition.depth),
    textureDataUrl: definition.textureDataUrl ?? null,
    terrainPaint,
    landforms: props.layers.filter((layer) => layer.enabled && typeof layer.assetId === 'string' && layer.assetId.trim().length),
    liveChunkTileKeys: liveTileKeys,
    previewRevision: options.previewRevision ?? 0,
    maxResolution: options.maxResolution ?? DEFAULT_GROUND_SURFACE_PREVIEW_MAX_RESOLUTION,
  })
}

export async function composeGroundSurfacePreviewCanvas(
  groundNode: SceneNode,
  definition: GroundDynamicMesh,
  loaders: GroundSurfacePreviewLoaders,
  options: GroundSurfacePreviewOptions,
  shouldAbort: () => boolean = () => false,
): Promise<GroundSurfacePreviewCanvasResult | null> {
  const composeStartTime = nowMs()
  const previewSize = computePreviewTextureSize(definition, options.maxResolution ?? DEFAULT_GROUND_SURFACE_PREVIEW_MAX_RESOLUTION)
  const reuseCanvas = options.reuseCanvas
  const seedTexture = options.seedTexture ?? null
  const seedImageSource = resolveTextureImageSource(seedTexture)
  const canReuseCanvas = Boolean(
    reuseCanvas
    && (((reuseCanvas as HTMLCanvasElement).width ?? (reuseCanvas as OffscreenCanvas).width) === previewSize.width)
    && (((reuseCanvas as HTMLCanvasElement).height ?? (reuseCanvas as OffscreenCanvas).height) === previewSize.height),
  )
  const canSeedFromTexture = Boolean(!canReuseCanvas && seedImageSource)
  const composition = canReuseCanvas
    ? (() => {
      const context = reuseCanvas!.getContext('2d') as Canvas2DContext | null
      return context ? { canvas: reuseCanvas!, context } : null
    })()
    : createCompositionCanvas(previewSize.width, previewSize.height)
  if (!composition) {
    return null
  }
  const { canvas, context } = composition
  const width = (canvas as HTMLCanvasElement).width ?? (canvas as OffscreenCanvas).width
  const height = (canvas as HTMLCanvasElement).height ?? (canvas as OffscreenCanvas).height
  const incrementalTerrainPaint = Boolean((canReuseCanvas || canSeedFromTexture) && options.liveChunkTileMasksByKey?.size)
  if (!incrementalTerrainPaint) {
    context.clearRect(0, 0, width, height)
    context.save()
    context.globalCompositeOperation = 'source-over'
    context.globalAlpha = 1
    context.fillStyle = DEFAULT_GROUND_SURFACE_PREVIEW_BACKGROUND
    context.fillRect(0, 0, width, height)
    context.restore()
  } else if (canSeedFromTexture && seedImageSource) {
    context.clearRect(0, 0, width, height)
    context.drawImage(seedImageSource, 0, 0, width, height)
    recordGroundSurfacePreviewPerf('seed-live-preview-from-texture', 0, {
      width,
      height,
      textureUuid: seedTexture?.uuid ?? null,
      previewRevision: options.previewRevision ?? 0,
    })
  }

  const baseUrl = typeof definition.textureDataUrl === 'string' ? definition.textureDataUrl.trim() : ''
  if (baseUrl && !incrementalTerrainPaint) {
    const baseTexture = await loaders.loadGroundSurfaceBaseTextureFromUrl(baseUrl)
    if (shouldAbort()) {
      return null
    }
    const loadedBase = loadImageDataFromTexture(baseTexture)
    if (loadedBase) {
      context.drawImage(loadedBase.source, 0, 0, width, height)
    }
  }

  const component = resolveEnabledComponentState<LandformsComponentProps>(groundNode, LANDFORMS_COMPONENT_TYPE)
  if (component && !incrementalTerrainPaint) {
    const props = clampLandformsComponentProps(component.props)
    for (const layer of props.layers.filter((entry) => entry.enabled && typeof entry.assetId === 'string' && entry.assetId.trim().length)) {
      const texture = await loaders.loadLandformsTextureFromAssetId(layer.assetId!.trim())
      if (shouldAbort()) {
        return null
      }
      const loaded = loadImageDataFromTexture(texture)
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
  }

  const currentTerrainPaint = definition.terrainPaint ?? null
  if (currentTerrainPaint && currentTerrainPaint.version === 3 && Array.isArray(currentTerrainPaint.layers) && currentTerrainPaint.layers.length) {
    const didComposeCurrentTerrainPaint = await composeCurrentTerrainPaintIntoCanvas({
      context,
      width,
      height,
      definition,
      terrainPaint: currentTerrainPaint,
      liveChunkTileMasksByKey: options.liveChunkTileMasksByKey,
      loaders,
      shouldAbort,
      incremental: incrementalTerrainPaint,
    })
    if (didComposeCurrentTerrainPaint) {
      recordGroundSurfacePreviewPerf('compose-preview-canvas', nowMs() - composeStartTime, {
        width,
        height,
        incrementalTerrainPaint,
        seededFromTexture: canSeedFromTexture,
        liveChunkCount: options.liveChunkTileMasksByKey?.size ?? 0,
        previewRevision: options.previewRevision ?? 0,
      })
      return { canvas, width, height }
    }
  }

  recordGroundSurfacePreviewPerf('compose-preview-canvas', nowMs() - composeStartTime, {
    width,
    height,
    incrementalTerrainPaint,
    seededFromTexture: canSeedFromTexture,
    liveChunkCount: options.liveChunkTileMasksByKey?.size ?? 0,
    previewRevision: options.previewRevision ?? 0,
  })
  return { canvas, width, height }
}

function configureGroundSurfacePreviewTexture(texture: THREE.Texture, canvas: CanvasLike): THREE.Texture {
  texture.image = canvas as unknown as HTMLCanvasElement
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  ;(texture as any).colorSpace = (THREE as any).SRGBColorSpace ?? (texture as any).colorSpace
  texture.needsUpdate = true
  return texture
}

async function composeGroundSurfacePreviewTexture(
  groundNode: SceneNode,
  definition: GroundDynamicMesh,
  loaders: GroundSurfacePreviewLoaders,
  options: GroundSurfacePreviewOptions,
  existingTexture: THREE.Texture | null = null,
  shouldAbort: () => boolean = () => false,
): Promise<THREE.Texture | null> {
  const result = await composeGroundSurfacePreviewCanvas(groundNode, definition, loaders, options, shouldAbort)
  if (!result) {
    return null
  }
  if (existingTexture) {
    return configureGroundSurfacePreviewTexture(existingTexture, result.canvas)
  }
  return configureGroundSurfacePreviewTexture(new THREE.CanvasTexture(result.canvas as unknown as HTMLCanvasElement), result.canvas)
}

export async function convertGroundSurfacePreviewCanvasToBlob(canvas: CanvasLike): Promise<Blob | null> {
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

export function createDefaultGroundSurfacePreviewLoaders(
  resolveAssetUrlFromCache: (assetId: string) => Promise<{ url: string | null } | null>,
): GroundSurfacePreviewLoaders {
  const textureLoader = new THREE.TextureLoader()
  const terrainTextureCache = new Map<string, Promise<THREE.Texture | null>>()
  const terrainWeightmapCache = new Map<string, Promise<Uint8ClampedArray | null>>()
  const terrainMaskTileCache = new Map<string, Promise<Uint8ClampedArray | null>>()
  const landformsTextureCache = new Map<string, Promise<THREE.Texture | null>>()
  const baseTextureCache = new Map<string, Promise<THREE.Texture | null>>()

  function loadTerrainTextureCached(assetId: string, options: { colorSpace: 'srgb' | 'none' }): Promise<THREE.Texture | null> {
    const key = `${assetId}|${options.colorSpace}`
    const cached = terrainTextureCache.get(key)
    if (cached) {
      recordGroundSurfacePreviewPerf('load-terrain-texture-cache-hit', 0, {
        assetId,
        colorSpace: options.colorSpace,
      })
      return cached
    }
    const pending = (async () => {
      const loadStartTime = nowMs()
      const resolved = await resolveAssetUrlFromCache(assetId)
      if (!resolved?.url) {
        return null
      }
      try {
        const texture = await textureLoader.loadAsync(resolved.url)
        ;(texture as any).colorSpace = options.colorSpace === 'none'
          ? ((THREE as any).NoColorSpace ?? undefined)
          : ((THREE as any).SRGBColorSpace ?? (texture as any).colorSpace)
        texture.needsUpdate = true
        recordGroundSurfacePreviewPerf('load-terrain-texture', nowMs() - loadStartTime, {
          assetId,
          colorSpace: options.colorSpace,
          width: (texture.image as { width?: number } | undefined)?.width ?? null,
          height: (texture.image as { height?: number } | undefined)?.height ?? null,
        })
        return texture
      } catch (error) {
        console.warn('[groundSurfacePreview] Failed to load terrain paint texture', assetId, error)
        terrainTextureCache.delete(key)
        return null
      }
    })()
    terrainTextureCache.set(key, pending)
    return pending
  }

  function loadTerrainWeightmapCached(assetId: string, resolution: number): Promise<Uint8ClampedArray | null> {
    const normalizedResolution = Math.max(1, Math.round(resolution))
    const key = `${assetId}|${normalizedResolution}`
    const cached = terrainWeightmapCache.get(key)
    if (cached) {
      return cached
    }
    const pending = (async () => {
      const resolved = await resolveAssetUrlFromCache(assetId)
      if (!resolved?.url) {
        return null
      }
      try {
        const response = await fetch(resolved.url, { credentials: 'include' })
        if (!response.ok) {
          return null
        }
        const blob = await response.blob()
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const expectedLength = normalizedResolution * normalizedResolution * 4
        if (bytes.length === expectedLength) {
          return new Uint8ClampedArray(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + expectedLength))
        }
        if (bytes.length >= 10 && bytes[0] === 0x48 && bytes[1] === 0x57 && bytes[2] === 0x50 && bytes[3] === 0x31) {
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
          const payloadLen = view.getUint32(6, true)
          const payloadOffset = 10
          if (payloadOffset + payloadLen > bytes.length) {
            return null
          }
          return new Uint8ClampedArray(bytes.buffer.slice(bytes.byteOffset + payloadOffset, bytes.byteOffset + payloadOffset + payloadLen))
        }
        return null
      } catch (error) {
        console.warn('[groundSurfacePreview] Failed to load terrain paint weightmap', assetId, error)
        terrainWeightmapCache.delete(key)
        return null
      }
    })()
    terrainWeightmapCache.set(key, pending)
    return pending
  }

  function loadTerrainMaskTileCached(assetId: string, resolution: number): Promise<Uint8ClampedArray | null> {
    const normalizedResolution = Math.max(1, Math.round(resolution))
    const key = `${assetId}|${normalizedResolution}`
    const cached = terrainMaskTileCache.get(key)
    if (cached) {
      recordGroundSurfacePreviewPerf('load-mask-tile-cache-hit', 0, {
        assetId,
        resolution: normalizedResolution,
      })
      return cached
    }
    const pending = (async () => {
      const loadStartTime = nowMs()
      const resolved = await resolveAssetUrlFromCache(assetId)
      if (!resolved?.url) {
        return null
      }
      try {
        const response = await fetch(resolved.url, { credentials: 'include' })
        if (!response.ok) {
          return null
        }
        const blob = await response.blob()
        const data = await decodeTerrainPaintMaskTileToData(blob, normalizedResolution)
        recordGroundSurfacePreviewPerf('load-mask-tile', nowMs() - loadStartTime, {
          assetId,
          resolution: normalizedResolution,
          byteLength: data.byteLength,
        })
        return data
      } catch (error) {
        console.warn('[groundSurfacePreview] Failed to load terrain paint mask tile', assetId, error)
        terrainMaskTileCache.delete(key)
        return null
      }
    })()
    terrainMaskTileCache.set(key, pending)
    return pending
  }

  function loadLandformsTextureCached(assetId: string): Promise<THREE.Texture | null> {
    const key = assetId
    const cached = landformsTextureCache.get(key)
    if (cached) {
      return cached
    }
    const pending = (async () => {
      const resolved = await resolveAssetUrlFromCache(assetId)
      if (!resolved?.url) {
        return null
      }
      try {
        const texture = await textureLoader.loadAsync(resolved.url)
        ;(texture as any).colorSpace = (THREE as any).SRGBColorSpace ?? (texture as any).colorSpace
        texture.needsUpdate = true
        return texture
      } catch (error) {
        console.warn('[groundSurfacePreview] Failed to load landforms texture', assetId, error)
        landformsTextureCache.delete(key)
        return null
      }
    })()
    landformsTextureCache.set(key, pending)
    return pending
  }

  function loadGroundBaseTextureCached(url: string): Promise<THREE.Texture | null> {
    const key = url
    const cached = baseTextureCache.get(key)
    if (cached) {
      return cached
    }
    const pending = (async () => {
      try {
        const texture = await textureLoader.loadAsync(url)
        ;(texture as any).colorSpace = (THREE as any).SRGBColorSpace ?? (texture as any).colorSpace
        texture.needsUpdate = true
        return texture
      } catch (error) {
        console.warn('[groundSurfacePreview] Failed to load ground base texture', url, error)
        baseTextureCache.delete(key)
        return null
      }
    })()
    baseTextureCache.set(key, pending)
    return pending
  }

  const terrainLoader: Pick<GroundSurfacePreviewLoaders, 'loadTerrainPaintTextureFromAssetId' | 'loadTerrainPaintWeightmapDataFromAssetId' | 'loadTerrainPaintMaskTileDataFromAssetId'> = {
    async loadTerrainPaintTextureFromAssetId(assetId: string, options: { colorSpace: 'srgb' | 'none' }) {
      return await loadTerrainTextureCached(assetId, options)
    },
    async loadTerrainPaintWeightmapDataFromAssetId(assetId: string, resolution: number) {
      return await loadTerrainWeightmapCached(assetId, resolution)
    },
    async loadTerrainPaintMaskTileDataFromAssetId(assetId: string, resolution: number) {
      return await loadTerrainMaskTileCached(assetId, resolution)
    },
  }

  const landformsLoader: LandformsPreviewLoaders = {
    async loadLandformsTextureFromAssetId(assetId) {
      return await loadLandformsTextureCached(assetId)
    },
  }

  return {
    ...terrainLoader,
    ...landformsLoader,
    async loadGroundSurfaceBaseTextureFromUrl(url) {
      const normalized = typeof url === 'string' ? url.trim() : ''
      if (!normalized) {
        return null
      }
      return await loadGroundBaseTextureCached(normalized)
    },
  }
}

export function syncGroundSurfacePreviewForGround(
  groundObject: THREE.Object3D,
  groundNode: SceneNode,
  dynamicMesh: GroundDynamicMesh,
  loaders: GroundSurfacePreviewLoaders,
  getToken: () => number,
  options: GroundSurfacePreviewOptions = {},
): boolean {
  if (!groundObject || !groundNode || dynamicMesh.type !== 'Ground') {
    restoreGroundSurfacePreviewMaterialMap(groundObject)
    clearLandformsPreviewForGround(groundObject)
    return false
  }
  const hasTerrainPaint = Boolean(dynamicMesh.terrainPaint?.layers?.some((layer) => layer.enabled !== false && typeof layer.textureAssetId === 'string' && layer.textureAssetId.trim().length))
  const component = resolveEnabledComponentState<LandformsComponentProps>(groundNode, LANDFORMS_COMPONENT_TYPE)
  const landformsProps = component ? clampLandformsComponentProps(component.props) : null
  const hasLandforms = Boolean(landformsProps?.layers?.some((layer) => layer.enabled && typeof layer.assetId === 'string' && layer.assetId.trim().length))
  if (!hasTerrainPaint && !hasLandforms) {
    restoreGroundSurfacePreviewMaterialMap(groundObject)
    clearLandformsPreviewForGround(groundObject)
    return false
  }
  const hasLiveChunkPreview = (options.liveChunkTileMasksByKey?.size ?? 0) > 0
  if (hasLiveChunkPreview) {
    const token = getToken()
    const existingLiveTexture = getGroundSurfacePreviewLiveTexture(groundObject)
    const seedTexture = existingLiveTexture ? null : getLandformsPreviewTexture(groundObject)
    const reuseCanvas = resolveTextureCanvas(existingLiveTexture)
    void composeGroundSurfacePreviewTexture(
      groundNode,
      dynamicMesh,
      loaders,
      {
        ...options,
        reuseCanvas,
        seedTexture,
      },
      existingLiveTexture,
      () => getToken() !== token,
    ).then((texture) => {
      if (getToken() !== token) {
        if (texture && texture !== existingLiveTexture) {
          texture.dispose()
        }
        return
      }
      if (!texture) {
        return
      }
      setGroundSurfacePreviewLiveTexture(groundObject, texture)
      if (options.applyToMaterialMap === true) {
        applyGroundSurfacePreviewToMaterialMap(groundObject, texture)
      }
    }).catch((error) => {
      console.warn('[groundSurfacePreview] Failed to compose live surface preview texture', error)
    })
    return true
  }
  const signature = buildGroundSurfacePreviewSignature(groundNode, dynamicMesh, options)
  const currentSignature = ((groundObject.userData as any)?.[LANDFORMS_PREVIEW_SIGNATURE_USERDATA_KEY] as string | null | undefined) ?? null
  if (currentSignature === signature && getLandformsPreviewTexture(groundObject)) {
    releaseGroundSurfacePreviewLiveTextureIfDifferent(groundObject, getLandformsPreviewTexture(groundObject))
    return true
  }
  const token = getToken()
  let pending = groundSurfacePreviewRequests.get(signature)
  if (!pending) {
    pending = composeGroundSurfacePreviewTexture(groundNode, dynamicMesh, loaders, options, null, () => getToken() !== token)
    groundSurfacePreviewRequests.set(signature, pending)
  }
  pending.then((texture) => {
    groundSurfacePreviewRequests.delete(signature)
    if (getToken() !== token) {
      texture?.dispose()
      return
    }
    if (!texture) {
      console.log('[groundSurfacePreview] preview missing texture', {
        previewRevision: options.previewRevision ?? null,
      })
      return
    }
    console.log('[groundSurfacePreview] preview applied', {
      previewRevision: options.previewRevision ?? null,
      textureUuid: texture.uuid,
      liveChunkCount: options.liveChunkTileMasksByKey?.size ?? 0,
    })
    if (options.applyToMaterialMap === true) {
      applyGroundSurfacePreviewToMaterialMap(groundObject, texture)
    }
    setLandformsPreviewTexture(groundObject, signature, texture)
    releaseGroundSurfacePreviewLiveTextureIfDifferent(groundObject, texture)
  }).catch((error) => {
    groundSurfacePreviewRequests.delete(signature)
    console.warn('[groundSurfacePreview] Failed to compose surface preview texture', error)
  })
  return true
}
