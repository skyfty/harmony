import * as THREE from 'three'
import type {
  GroundDynamicMesh,
  SceneNode,
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
  parseTerrainPaintChunkKey,
  type TerrainPaintChunkBounds,
  resolveTerrainPaintChunkBounds,
} from './terrainPaintTiles'

const DEFAULT_GROUND_SURFACE_PREVIEW_MAX_RESOLUTION = 1024
const MIN_GROUND_SURFACE_PREVIEW_RESOLUTION = 256
const groundSurfacePreviewRequests = new Map<string, Promise<THREE.Texture | null>>()
const DEFAULT_GROUND_SURFACE_PREVIEW_BACKGROUND = '#ffffff'
const GROUND_SURFACE_PREVIEW_DEBUG_FLAG_KEY = '__HARMONY_GROUND_SURFACE_PREVIEW_DEBUG__'
const GROUND_SURFACE_PREVIEW_STATS_KEY = '__HARMONY_GROUND_SURFACE_PREVIEW_STATS__'

type Canvas2DContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

type CanvasLike = OffscreenCanvas | HTMLCanvasElement

export type GroundSurfaceLiveChunkPreview = {
  chunkKey: string
  bounds: TerrainPaintChunkBounds
  canvas: CanvasLike
  revision: number
}

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

export type GroundSurfacePreviewLoaders = LandformsPreviewLoaders & {
  loadTerrainPaintTextureFromAssetId: (assetId: string, options: { colorSpace: 'srgb' | 'none' }) => Promise<THREE.Texture | null>
  loadGroundSurfaceBaseTextureFromUrl: (url: string) => Promise<THREE.Texture | null>
}

export type GroundSurfacePreviewOptions = {
  maxResolution?: number
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

function resolveTextureImageSource(texture: THREE.Texture | null | undefined): CanvasImageSource | null {
  const image = texture?.image as CanvasImageSource | undefined
  return image ?? null
}

function getGroundSurfacePreviewLiveTexture(root: THREE.Object3D | null | undefined): THREE.Texture | null {
  return ((root?.userData as Record<string, unknown> | undefined)?.[GROUND_SURFACE_PREVIEW_LIVE_TEXTURE_KEY] as THREE.Texture | null | undefined) ?? null
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

function setGroundSurfacePreviewLiveTexture(root: THREE.Object3D | null | undefined, texture: THREE.Texture | null): void {
  if (!root?.userData) {
    return
  }
  if (texture) {
    ;(root.userData as Record<string, unknown>)[GROUND_SURFACE_PREVIEW_LIVE_TEXTURE_KEY] = texture
    return
  }
  delete (root.userData as Record<string, unknown>)[GROUND_SURFACE_PREVIEW_LIVE_TEXTURE_KEY]
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

function getGroundPreviewMaterialMap(root: THREE.Object3D | null | undefined): THREE.Texture | null {
  let resolved: THREE.Texture | null = null
  if (!root) {
    return resolved
  }
  forEachGroundPreviewMaterial(root, (material) => {
    if (!resolved && material.map) {
      resolved = material.map
    }
  })
  return resolved
}

export function syncGroundSurfaceLiveChunkPreviews(params: {
  groundObject: THREE.Object3D
  groundNode: SceneNode
  dynamicMesh: GroundDynamicMesh
  chunkPreviews: GroundSurfaceLiveChunkPreview[]
  maxResolution?: number
  applyToMaterialMap?: boolean
}): boolean {
  const { groundObject, groundNode, dynamicMesh, chunkPreviews, maxResolution, applyToMaterialMap } = params
  if (!groundObject || !groundNode || dynamicMesh.type !== 'Ground') {
    return false
  }
  const validPreviews = chunkPreviews.filter((entry) => entry?.canvas && Number.isFinite(entry.bounds?.width) && Number.isFinite(entry.bounds?.depth))
  if (!validPreviews.length) {
    return false
  }

  const previewSize = computePreviewTextureSize(dynamicMesh, maxResolution ?? DEFAULT_GROUND_SURFACE_PREVIEW_MAX_RESOLUTION)
  let liveTexture = getGroundSurfacePreviewLiveTexture(groundObject)
  const existingCanvas = liveTexture?.image as CanvasLike | undefined
  const canReuseCanvas = Boolean(
    existingCanvas
    && 'getContext' in existingCanvas
    && (((existingCanvas as HTMLCanvasElement).width ?? (existingCanvas as OffscreenCanvas).width) === previewSize.width)
    && (((existingCanvas as HTMLCanvasElement).height ?? (existingCanvas as OffscreenCanvas).height) === previewSize.height),
  )
  const composition = canReuseCanvas
    ? (() => {
      const context = existingCanvas!.getContext('2d') as Canvas2DContext | null
      return context ? { canvas: existingCanvas!, context } : null
    })()
    : createCompositionCanvas(previewSize.width, previewSize.height)
  if (!composition) {
    return false
  }

  const { canvas, context } = composition
  const width = (canvas as HTMLCanvasElement).width ?? (canvas as OffscreenCanvas).width
  const height = (canvas as HTMLCanvasElement).height ?? (canvas as OffscreenCanvas).height
  if (!canReuseCanvas) {
    const seedTexture = getLandformsPreviewTexture(groundObject) ?? getGroundPreviewMaterialMap(groundObject)
    const seedSource = resolveTextureImageSource(seedTexture)
    context.clearRect(0, 0, width, height)
    if (seedSource) {
      context.drawImage(seedSource, 0, 0, width, height)
    } else {
      context.save()
      context.globalCompositeOperation = 'source-over'
      context.globalAlpha = 1
      context.fillStyle = DEFAULT_GROUND_SURFACE_PREVIEW_BACKGROUND
      context.fillRect(0, 0, width, height)
      context.restore()
    }
  }

  const groundWidth = Math.max(1e-6, normalizeDimension(dynamicMesh.width))
  const groundDepth = Math.max(1e-6, normalizeDimension(dynamicMesh.depth))
  const halfWidth = groundWidth * 0.5
  const halfDepth = groundDepth * 0.5
  for (const preview of validPreviews) {
    const drawX = Math.floor(((preview.bounds.minX + halfWidth) / groundWidth) * width)
    const drawY = Math.floor(((preview.bounds.minZ + halfDepth) / groundDepth) * height)
    const drawWidth = Math.max(1, Math.ceil((preview.bounds.width / groundWidth) * width))
    const drawHeight = Math.max(1, Math.ceil((preview.bounds.depth / groundDepth) * height))
    context.drawImage(preview.canvas, drawX, drawY, drawWidth, drawHeight)
  }

  const nextTexture = liveTexture && canReuseCanvas
    ? configureGroundSurfacePreviewTexture(liveTexture, canvas)
    : configureGroundSurfacePreviewTexture(new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement), canvas)
  if (liveTexture && nextTexture !== liveTexture) {
    liveTexture.dispose()
  }
  liveTexture = nextTexture
  setGroundSurfacePreviewLiveTexture(groundObject, liveTexture)
  if (applyToMaterialMap === true) {
    applyGroundSurfacePreviewToMaterialMap(groundObject, liveTexture)
  }
  return true
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

async function composeGroundSurfaceChunksIntoCanvas(params: {
  context: Canvas2DContext
  width: number
  height: number
  definition: GroundDynamicMesh
  loaders: GroundSurfacePreviewLoaders
  shouldAbort: () => boolean
}): Promise<boolean> {
  const { context, width, height, definition, loaders, shouldAbort } = params
  const chunkEntries = Object.entries(definition.groundSurfaceChunks ?? {})
    .filter(([, chunkRef]) => typeof chunkRef?.textureAssetId === 'string' && chunkRef.textureAssetId.trim().length)
  if (!chunkEntries.length) {
    return false
  }

  const groundWidth = Math.max(1e-6, normalizeDimension(definition.width))
  const groundDepth = Math.max(1e-6, normalizeDimension(definition.depth))
  const halfWidth = groundWidth * 0.5
  const halfDepth = groundDepth * 0.5
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
    const texture = await loaders.loadTerrainPaintTextureFromAssetId(textureAssetId, { colorSpace: 'srgb' })
    if (shouldAbort()) {
      return false
    }
    const loaded = loadImageDataFromTexture(texture)
    if (!loaded) {
      continue
    }
    const drawX = Math.floor(((bounds.minX + halfWidth) / groundWidth) * width)
    const drawY = Math.floor(((bounds.minZ + halfDepth) / groundDepth) * height)
    const drawWidth = Math.max(1, Math.ceil((bounds.width / groundWidth) * width))
    const drawHeight = Math.max(1, Math.ceil((bounds.depth / groundDepth) * height))
    context.drawImage(loaded.source, drawX, drawY, drawWidth, drawHeight)
    drewAny = true
  }

  return drewAny
}

function buildGroundSurfacePreviewSignature(groundNode: SceneNode, definition: GroundDynamicMesh, options: GroundSurfacePreviewOptions): string {
  const component = resolveEnabledComponentState<LandformsComponentProps>(groundNode, LANDFORMS_COMPONENT_TYPE)
  const props = component ? clampLandformsComponentProps(component.props) : { layers: [] }
  return stableSerialize({
    width: normalizeDimension(definition.width),
    depth: normalizeDimension(definition.depth),
    textureDataUrl: definition.textureDataUrl ?? null,
    groundSurfaceChunks: definition.groundSurfaceChunks ?? null,
    landforms: props.layers.filter((layer) => layer.enabled && typeof layer.assetId === 'string' && layer.assetId.trim().length),
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
  context.clearRect(0, 0, width, height)
  context.save()
  context.globalCompositeOperation = 'source-over'
  context.globalAlpha = 1
  context.fillStyle = DEFAULT_GROUND_SURFACE_PREVIEW_BACKGROUND
  context.fillRect(0, 0, width, height)
  context.restore()

  const baseUrl = typeof definition.textureDataUrl === 'string' ? definition.textureDataUrl.trim() : ''
  if (baseUrl) {
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
  if (component) {
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

  await composeGroundSurfaceChunksIntoCanvas({
    context,
    width,
    height,
    definition,
    loaders,
    shouldAbort,
  })
  if (shouldAbort()) {
    return null
  }

  recordGroundSurfacePreviewPerf('compose-preview-canvas', nowMs() - composeStartTime, {
    width,
    height,
    seededFromTexture: canSeedFromTexture,
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

  const terrainLoader: Pick<GroundSurfacePreviewLoaders, 'loadTerrainPaintTextureFromAssetId'> = {
    async loadTerrainPaintTextureFromAssetId(assetId: string, options: { colorSpace: 'srgb' | 'none' }) {
      return await loadTerrainTextureCached(assetId, options)
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
  const hasTerrainPaint = Boolean(
    Object.values(dynamicMesh.groundSurfaceChunks ?? {}).some((chunkRef) => typeof chunkRef?.textureAssetId === 'string' && chunkRef.textureAssetId.trim().length),
  )
  const component = resolveEnabledComponentState<LandformsComponentProps>(groundNode, LANDFORMS_COMPONENT_TYPE)
  const landformsProps = component ? clampLandformsComponentProps(component.props) : null
  const hasLandforms = Boolean(landformsProps?.layers?.some((layer) => layer.enabled && typeof layer.assetId === 'string' && layer.assetId.trim().length))
  if (!hasTerrainPaint && !hasLandforms) {
    restoreGroundSurfacePreviewMaterialMap(groundObject)
    clearLandformsPreviewForGround(groundObject)
    return false
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
