import * as THREE from 'three'
import type {
  GroundDynamicMesh,
  GroundSurfaceChunkLayerRef,
  GroundSurfaceChunkTextureMap,
  GroundSurfaceChunkTextureRef,
  LandformDynamicMesh,
  SceneMaterialProps,
  SceneMaterialTextureRef,
  SceneMaterialTextureSettings,
  SceneNode,
} from '@schema/core'
import {
  formatGroundChunkKey,
  normalizeGroundWorldBounds,
  parseGroundChunkKey,
  resolveGroundChunkCoordFromWorldPosition,
  resolveGroundWorldBounds,
  resolveInfiniteGroundGridOriginMeters,
} from '@schema/core'
import { createTextureSettings } from '@schema/material'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import type { StoredSceneDocument } from '@/types/stored-scene-document'

type CanvasLike = OffscreenCanvas | HTMLCanvasElement
type Canvas2DContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
type ImageDataSource = {
  width: number
  height: number
  data: Uint8ClampedArray
}
type WorldRect = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}
type LandformBakeEntry = {
  node: SceneNode
  layer: LandformSurfaceLayerLike
  order: number
  nodeOrder: number
  worldMatrix: THREE.Matrix4
  worldSurfaceVertices: Array<{ x: number; y: number; z: number }>
  surfaceIndices: number[]
  worldOutlineVertices: Array<{ x: number; y: number; z: number }>
  outlineIndices: number[]
  worldSurfaceSource: 'ground-uv' | 'transformed' | 'transformed-infinite'
}

type LandformFeatherSettings = {
  enabled: boolean
  width: number
}

type LoadedBakedImage = {
  source: CanvasImageSource
  imageData: ImageDataSource
}

export type LandformGroundBakeOptions = {
  maxTextureSize?: number
  maxSplatLayers?: number
  debugBaseTextureOnly?: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1
  }
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function createCanvas(width: number, height: number): { canvas: CanvasLike; context: Canvas2DContext } | null {
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

async function blobToDataUrl(blob: Blob): Promise<string | null> {
  if (typeof FileReader === 'undefined') {
    return null
  }
  return await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
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
  const composition = createCanvas(size.width, size.height)
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

async function blobToCanvasImageSource(blob: Blob): Promise<CanvasImageSource | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob)
    } catch {
      // Fall through to Image element below.
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

function getGroundLandformNodes(nodes: SceneNode[]): SceneNode[] {
  const out: SceneNode[] = []
  const visit = (items: SceneNode[], inheritedVisible = true): void => {
    for (const node of items ?? []) {
      if (!node) {
        continue
      }
      const nodeVisible = inheritedVisible && (node.visible ?? true)
      if (nodeVisible && node.dynamicMesh?.type === 'Landform') {
        out.push(node)
      }
      if (Array.isArray(node.children) && node.children.length) {
        visit(node.children, nodeVisible)
      }
    }
  }
  visit(nodes)
  return out
}

function buildSceneNodeLocalMatrix(node: SceneNode): THREE.Matrix4 {
  const position = new THREE.Vector3(
    Number.isFinite(node.position?.x) ? Number(node.position.x) : 0,
    Number.isFinite(node.position?.y) ? Number(node.position.y) : 0,
    Number.isFinite(node.position?.z) ? Number(node.position.z) : 0,
  )
  const rotation = new THREE.Euler(
    Number.isFinite(node.rotation?.x) ? Number(node.rotation.x) : 0,
    Number.isFinite(node.rotation?.y) ? Number(node.rotation.y) : 0,
    Number.isFinite(node.rotation?.z) ? Number(node.rotation.z) : 0,
    'XYZ',
  )
  const quaternion = new THREE.Quaternion().setFromEuler(rotation)
  const scale = new THREE.Vector3(
    Number.isFinite(node.scale?.x) && Math.abs(Number(node.scale.x)) > 1e-6 ? Number(node.scale.x) : 1,
    Number.isFinite(node.scale?.y) && Math.abs(Number(node.scale.y)) > 1e-6 ? Number(node.scale.y) : 1,
    Number.isFinite(node.scale?.z) && Math.abs(Number(node.scale.z)) > 1e-6 ? Number(node.scale.z) : 1,
  )
  return new THREE.Matrix4().compose(position, quaternion, scale)
}

function parseColor(value: unknown, fallback = '#ffffff'): string {
  return typeof value === 'string' && value.trim().length ? value.trim() : fallback
}

function drawTriangleMask(
  context: Canvas2DContext,
  points: Array<{ x: number; y: number }>,
  alpha = 1,
  fillStyle = '#ffffff',
): void {
  if (points.length < 3) {
    return
  }
  context.save()
  context.globalAlpha = clamp(alpha, 0, 1)
  context.fillStyle = fillStyle
  context.beginPath()
  context.moveTo(points[0]!.x, points[0]!.y)
  context.lineTo(points[1]!.x, points[1]!.y)
  context.lineTo(points[2]!.x, points[2]!.y)
  context.closePath()
  context.fill()
  context.restore()
}

function resolveLayerFeatherSettings(entry: LandformBakeEntry): LandformFeatherSettings {
  const landformMesh = entry.node.dynamicMesh as LandformDynamicMesh | null | undefined
  const enabled = typeof entry.layer.enableFeather === 'boolean'
    ? entry.layer.enableFeather
    : Boolean(landformMesh?.enableFeather)
  const rawWidth = Number.isFinite(entry.layer.feather)
    ? Number(entry.layer.feather)
    : Number(landformMesh?.feather ?? 0)
  return {
    enabled,
    width: Number.isFinite(rawWidth) ? Math.max(0, rawWidth) : 0,
  }
}

function computeLandformEntryMaxFeatherWidth(entry: LandformBakeEntry): number {
  const feather = resolveLayerFeatherSettings(entry)
  return feather.enabled ? feather.width : 0
}

function expandWorldRect(rect: WorldRect, amount: number): WorldRect {
  const safeAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0
  if (safeAmount <= 0) {
    return rect
  }
  return {
    minX: rect.minX - safeAmount,
    maxX: rect.maxX + safeAmount,
    minZ: rect.minZ - safeAmount,
    maxZ: rect.maxZ + safeAmount,
  }
}

function softenMaskImageData(
  source: ImageData,
  featherPixels: number,
  opacity: number,
): ImageData {
  const width = Math.max(1, source.width)
  const height = Math.max(1, source.height)
  const alphaScale = clamp(opacity, 0, 1)
  const out = new ImageData(width, height)
  const sourceData = source.data
  const outData = out.data
  const safeFeatherPixels = Number.isFinite(featherPixels) ? Math.max(0, featherPixels) : 0
  if (safeFeatherPixels <= 0.001) {
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4
      const alpha = (sourceData[offset + 3] ?? 0) / 255
      outData[offset] = 255
      outData[offset + 1] = 255
      outData[offset + 2] = 255
      outData[offset + 3] = Math.round(clamp(alpha * alphaScale, 0, 1) * 255)
    }
    return out
  }

  const pixelCount = width * height
  const distances = new Float32Array(pixelCount)
  const maxDistance = width + height + safeFeatherPixels + 8
  for (let index = 0; index < pixelCount; index += 1) {
    const alpha = sourceData[index * 4 + 3] ?? 0
    distances[index] = alpha > 0 ? maxDistance : 0
  }

  const diagonalCost = Math.SQRT2
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      let best = distances[index]!
      if (x > 0) best = Math.min(best, distances[index - 1]! + 1)
      if (y > 0) best = Math.min(best, distances[index - width]! + 1)
      if (x > 0 && y > 0) best = Math.min(best, distances[index - width - 1]! + diagonalCost)
      if (x + 1 < width && y > 0) best = Math.min(best, distances[index - width + 1]! + diagonalCost)
      distances[index] = best
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x
      let best = distances[index]!
      if (x + 1 < width) best = Math.min(best, distances[index + 1]! + 1)
      if (y + 1 < height) best = Math.min(best, distances[index + width]! + 1)
      if (x + 1 < width && y + 1 < height) best = Math.min(best, distances[index + width + 1]! + diagonalCost)
      if (x > 0 && y + 1 < height) best = Math.min(best, distances[index + width - 1]! + diagonalCost)
      distances[index] = best
    }
  }

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4
    const sourceAlpha = (sourceData[offset + 3] ?? 0) / 255
    const distance = distances[index]!
    const featherWeight = sourceAlpha > 0
      ? smoothstep(0, safeFeatherPixels, Math.max(0, distance - 0.5 + sourceAlpha * 0.5))
      : 0
    const alpha = clamp(sourceAlpha * featherWeight * alphaScale, 0, 1)
    outData[offset] = 255
    outData[offset + 1] = 255
    outData[offset + 2] = 255
    outData[offset + 3] = Math.round(alpha * 255)
  }
  return out
}

function computeTriangleBounds(points: Array<{ x: number; y: number }>): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (points.length < 3) {
    return null
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue
    }
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  if (!(minX < maxX) || !(minY < maxY)) {
    return null
  }
  return { minX, minY, maxX, maxY }
}

function getLayerTileSizePixels(
  layer: LandformSurfaceLayerLike,
  chunkWidth: number,
  chunkDepth: number,
  canvasWidth: number,
  canvasHeight: number,
  textureRef?: SceneMaterialTextureRef | null,
): { width: number; height: number } {
  const settings = createTextureSettings(textureRef?.settings ?? null)
  const uvScale = layer.uvScale
  const repeatWidthMetersBase = Number(uvScale?.x) > 0 ? Number(uvScale?.x) : Math.max(chunkWidth, 1e-6)
  const repeatHeightMetersBase = Number(uvScale?.y) > 0 ? Number(uvScale?.y) : Math.max(chunkDepth, 1e-6)
  const tileSizeWidthMeters = Number(settings.tileSizeMeters?.x)
  const tileSizeHeightMeters = Number(settings.tileSizeMeters?.y)
  const tileWidthScale = Number.isFinite(tileSizeWidthMeters) && tileSizeWidthMeters > 1e-6 ? tileSizeWidthMeters : 1
  const tileHeightScale = Number.isFinite(tileSizeHeightMeters) && tileSizeHeightMeters > 1e-6 ? tileSizeHeightMeters : 1
  const repeatWidthMeters = (repeatWidthMetersBase * tileWidthScale) / Math.max(Math.abs(Number(settings.repeat.x) || 1), 1e-6)
  const repeatHeightMeters = (repeatHeightMetersBase * tileHeightScale) / Math.max(Math.abs(Number(settings.repeat.y) || 1), 1e-6)
  return {
    width: Math.max(1, Math.round((repeatWidthMeters / Math.max(chunkWidth, 1e-6)) * canvasWidth)),
    height: Math.max(1, Math.round((repeatHeightMeters / Math.max(chunkDepth, 1e-6)) * canvasHeight)),
  }
}

type PaintTextureOptions = {
  tilePixels: { width: number; height: number }
  alpha: number
  tintColor?: string | null
  tintOpacity?: number
  textureRef?: SceneMaterialTextureRef | null
  tintBlendMode?: 'overlay' | 'multiply'
}

function paintTiledTextureIntoTriangle(
  context: Canvas2DContext,
  source: LoadedBakedImage,
  triangle: Array<{ x: number; y: number }>,
  options: PaintTextureOptions,
): void {
  const bounds = computeTriangleBounds(triangle)
  if (!bounds) {
    return
  }
  const settings = createTextureSettings(options.textureRef?.settings ?? null)
  const tileWidth = Math.max(1, options.tilePixels.width)
  const tileHeight = Math.max(1, options.tilePixels.height)
  const offsetX = Number(settings.offset.x || 0) * tileWidth
  const offsetY = -Number(settings.offset.y || 0) * tileHeight
  const centerX = Number(settings.center.x || 0) * tileWidth
  const centerY = Number(settings.center.y || 0) * tileHeight
  const flipYScale = settings.flipY ? -1 : 1
  context.save()
  context.beginPath()
  context.moveTo(triangle[0]!.x, triangle[0]!.y)
  context.lineTo(triangle[1]!.x, triangle[1]!.y)
  context.lineTo(triangle[2]!.x, triangle[2]!.y)
  context.closePath()
  context.clip()
  context.globalAlpha = clamp(options.alpha, 0, 1)
  const startX = Math.floor((bounds.minX - offsetX) / tileWidth) * tileWidth + offsetX
  const startY = Math.floor((bounds.minY - offsetY) / tileHeight) * tileHeight + offsetY
  for (let y = startY; y < bounds.maxY + tileHeight; y += tileHeight) {
    for (let x = startX; x < bounds.maxX + tileWidth; x += tileWidth) {
      context.save()
      context.translate(x + centerX, y + centerY)
      if (settings.rotation) {
        context.rotate(settings.rotation)
      }
      context.scale(1, flipYScale)
      context.drawImage(source.source, -centerX, flipYScale < 0 ? -(tileHeight - centerY) : -centerY, tileWidth, tileHeight)
      context.restore()
    }
  }
  if (options.tintColor) {
    context.globalCompositeOperation = options.tintBlendMode === 'multiply' ? 'multiply' : 'source-over'
    context.globalAlpha = clamp((options.tintOpacity ?? 0.28) * options.alpha, 0, 1)
    context.fillStyle = options.tintColor
    context.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
  }
  context.restore()
}

function resolveMaterialTextureRef(
  props: SceneMaterialProps | null | undefined,
  slot: keyof NonNullable<SceneMaterialProps['textures']>,
): SceneMaterialTextureRef | null {
  const candidate = props?.textures?.[slot]
  return candidate && typeof candidate.assetId === 'string' && candidate.assetId.trim().length > 0
    ? candidate
    : null
}

function resolveTextureAssetId(ref: SceneMaterialTextureRef | null | undefined): string | null {
  const assetId = typeof ref?.assetId === 'string' ? ref.assetId.trim() : ''
  return assetId.length > 0 ? assetId : null
}

function resolvePrimaryMaterialProps(node: SceneNode | null | undefined): SceneMaterialProps | null {
  const first = Array.isArray(node?.materials) ? node!.materials[0] : null
  return first ? first as SceneMaterialProps : null
}

function getWorldAlignedTileSizePixels(
  textureRef: SceneMaterialTextureRef | null | undefined,
  worldBounds: WorldRect,
  rectWorld: WorldRect,
  canvasWidth: number,
  canvasHeight: number,
): { width: number; height: number } {
  const settings = createTextureSettings(textureRef?.settings ?? null)
  const worldWidth = Math.max(worldBounds.maxX - worldBounds.minX, 1e-6)
  const worldDepth = Math.max(worldBounds.maxZ - worldBounds.minZ, 1e-6)
  const rectWidth = Math.max(rectWorld.maxX - rectWorld.minX, 1e-6)
  const rectDepth = Math.max(rectWorld.maxZ - rectWorld.minZ, 1e-6)
  const repeatX = Math.max(Math.abs(Number(settings.repeat.x) || 1), 1e-6)
  const repeatY = Math.max(Math.abs(Number(settings.repeat.y) || 1), 1e-6)
  const tileSizeWidthMeters = Number(settings.tileSizeMeters?.x)
  const tileSizeHeightMeters = Number(settings.tileSizeMeters?.y)
  const tileWidthScale = Number.isFinite(tileSizeWidthMeters) && tileSizeWidthMeters > 1e-6 ? tileSizeWidthMeters : 1
  const tileHeightScale = Number.isFinite(tileSizeHeightMeters) && tileSizeHeightMeters > 1e-6 ? tileSizeHeightMeters : 1
  const tileWorldWidth = (worldWidth / repeatX) * tileWidthScale
  const tileWorldHeight = (worldDepth / repeatY) * tileHeightScale
  return {
    width: Math.max(1, Math.round((tileWorldWidth / rectWidth) * canvasWidth)),
    height: Math.max(1, Math.round((tileWorldHeight / rectDepth) * canvasHeight)),
  }
}

function paintWorldAlignedTextureIntoRect(
  context: Canvas2DContext,
  source: LoadedBakedImage,
  rectWorld: WorldRect,
  worldBounds: WorldRect,
  canvasWidth: number,
  canvasHeight: number,
  textureRef: SceneMaterialTextureRef | null | undefined,
): void {
  const settings = createTextureSettings(textureRef?.settings ?? null)
  const tilePixels = getWorldAlignedTileSizePixels(textureRef, worldBounds, rectWorld, canvasWidth, canvasHeight)
  const tileWidth = Math.max(1, tilePixels.width)
  const tileHeight = Math.max(1, tilePixels.height)
  const worldWidth = Math.max(worldBounds.maxX - worldBounds.minX, 1e-6)
  const worldDepth = Math.max(worldBounds.maxZ - worldBounds.minZ, 1e-6)
  const repeatX = Math.max(Math.abs(Number(settings.repeat.x) || 1), 1e-6)
  const repeatY = Math.max(Math.abs(Number(settings.repeat.y) || 1), 1e-6)
  const uAtLeft = ((rectWorld.minX - worldBounds.minX) / worldWidth) * repeatX + Number(settings.offset.x || 0)
  const vAtTop = ((worldBounds.maxZ - rectWorld.maxZ) / worldDepth) * repeatY + Number(settings.offset.y || 0)
  const startX = -(uAtLeft - Math.floor(uAtLeft)) * tileWidth
  const startY = -(vAtTop - Math.floor(vAtTop)) * tileHeight
  const centerX = Number(settings.center.x || 0) * tileWidth
  const centerY = Number(settings.center.y || 0) * tileHeight
  const flipYScale = settings.flipY ? -1 : 1
  for (let y = startY; y < canvasHeight + tileHeight; y += tileHeight) {
    for (let x = startX; x < canvasWidth + tileWidth; x += tileWidth) {
      context.save()
      context.translate(x + centerX, y + centerY)
      if (settings.rotation) {
        context.rotate(settings.rotation)
      }
      context.scale(1, flipYScale)
      context.drawImage(source.source, -centerX, flipYScale < 0 ? -(tileHeight - centerY) : -centerY, tileWidth, tileHeight)
      context.restore()
    }
  }
}

async function resolveMaterialTextureImage(
  scene: StoredSceneDocument,
  textureRef: SceneMaterialTextureRef | null | undefined,
  cache: Map<string, Promise<LoadedBakedImage | null>>,
): Promise<LoadedBakedImage | null> {
  const assetId = resolveTextureAssetId(textureRef)
  return assetId ? await loadLayerTextureImage(scene, assetId, cache) : null
}

async function paintGroundMaterialBaseIntoChunk(
  scene: StoredSceneDocument,
  draw: {
    albedo: Canvas2DContext
    normal: Canvas2DContext
  },
  size: { width: number; height: number },
  sceneWorldBounds: WorldRect,
  chunkWorldRect: WorldRect,
  groundProps: SceneMaterialProps | null,
  cache: Map<string, Promise<LoadedBakedImage | null>>,
): Promise<void> {
  const albedoTextureRef = resolveMaterialTextureRef(groundProps, 'albedo')
  const normalTextureRef = resolveMaterialTextureRef(groundProps, 'normal')
  const [
    loadedAlbedoTexture,
    loadedNormalTexture,
  ] = await Promise.all([
    resolveMaterialTextureImage(scene, albedoTextureRef, cache),
    resolveMaterialTextureImage(scene, normalTextureRef, cache),
  ])

  const baseColor = parseColor(groundProps?.color)

  draw.albedo.fillStyle = baseColor
  draw.albedo.fillRect(0, 0, size.width, size.height)
  if (loadedAlbedoTexture) {
    paintWorldAlignedTextureIntoRect(draw.albedo, loadedAlbedoTexture, chunkWorldRect, sceneWorldBounds, size.width, size.height, albedoTextureRef)
  }

  draw.normal.fillStyle = 'rgb(128, 128, 255)'
  draw.normal.fillRect(0, 0, size.width, size.height)
  if (loadedNormalTexture) {
    paintWorldAlignedTextureIntoRect(draw.normal, loadedNormalTexture, chunkWorldRect, sceneWorldBounds, size.width, size.height, normalTextureRef)
  }
}
void getLayerTileSizePixels
void paintTiledTextureIntoTriangle
void resolvePrimaryMaterialProps
void paintGroundMaterialBaseIntoChunk

type LandformSurfaceLayerLike = {
  id: string
  order: number
  materialConfigId?: string | null
  materialProps?: SceneMaterialProps | null
  textureAssetIds?: string[] | null
  enableFeather?: boolean
  feather?: number
  uvScale?: { x: number; y: number } | null
}

function resolveLandformSurfaceLayers(node: SceneNode): LandformSurfaceLayerLike[] {
  const raw = node.dynamicMesh?.type === 'Landform'
    ? (node.dynamicMesh.surfaceLayers ?? null)
    : null
  if (Array.isArray(raw) && raw.length > 0) {
    return raw
      .map((layer, order) => ({
        id: typeof layer?.id === 'string' ? layer.id.trim() : '',
        order: Number.isFinite(layer?.order) ? Number(layer.order) : order,
        materialConfigId: typeof layer?.materialConfigId === 'string' && layer.materialConfigId.trim().length
          ? layer.materialConfigId.trim()
          : null,
        materialProps: layer?.materialProps && typeof layer.materialProps === 'object'
          ? (layer.materialProps as SceneMaterialProps)
          : null,
        textureAssetIds: Array.isArray(layer?.textureAssetIds)
          ? layer.textureAssetIds
              .map((value) => (typeof value === 'string' ? value.trim() : ''))
              .filter((value) => value.length > 0)
          : null,
        enableFeather: typeof layer?.enableFeather === 'boolean' ? layer.enableFeather : undefined,
        feather: Number.isFinite(layer?.feather) ? Number(layer.feather) : undefined,
        uvScale: layer?.uvScale && typeof layer.uvScale === 'object'
          ? {
              x: Number((layer.uvScale as { x?: unknown }).x) || 0,
              y: Number((layer.uvScale as { y?: unknown }).y) || 0,
            }
          : null,
      }))
      .filter((layer) => layer.id.length > 0)
      .sort((a, b) => a.order - b.order)
  }
  return Array.isArray(node.materials)
    ? node.materials.map((entry, order) => ({
        id: typeof entry?.id === 'string' ? entry.id.trim() : '',
        order,
        materialConfigId: typeof entry?.id === 'string' && entry.id.trim().length ? entry.id.trim() : null,
        materialProps: entry as SceneMaterialProps,
        textureAssetIds: Object.values((entry as SceneMaterialProps).textures ?? {})
          .map((texture) => (typeof texture?.assetId === 'string' ? texture.assetId.trim() : ''))
          .filter((value) => value.length > 0),
      })).filter((layer) => layer.id.length > 0)
    : []
}

function collectLandformBakeEntries(
  nodes: SceneNode[],
  groundDefinition: GroundDynamicMesh | null = null,
): LandformBakeEntry[] {
  const entries: LandformBakeEntry[] = []
  const visit = (
    items: SceneNode[],
    parentOrderBase = 0,
    parentWorldMatrix = new THREE.Matrix4(),
    inheritedVisible = true,
  ): void => {
    items.forEach((node, index) => {
      if (!node) {
        return
      }
      const nodeOrder = parentOrderBase + index
      const worldMatrix = new THREE.Matrix4().multiplyMatrices(parentWorldMatrix, buildSceneNodeLocalMatrix(node))
      const nodeVisible = inheritedVisible && (node.visible ?? true)
      if (nodeVisible && node.dynamicMesh?.type === 'Landform') {
        const layers = resolveLandformSurfaceLayers(node)
        const worldSurfaceVertices = getSurfaceVertices(node, worldMatrix, groundDefinition)
        const surfaceIndices = getSurfaceIndices(node)
        const worldOutlineVertices = Array.isArray(node.dynamicMesh.vertices)
          ? node.dynamicMesh.vertices
            .map((entry) => {
              if (!Array.isArray(entry) || entry.length < 2) {
                return null
              }
              const localX = Number(entry[0])
              const localZ = Number(entry[1])
              if (!Number.isFinite(localX) || !Number.isFinite(localZ)) {
                return null
              }
              const worldPoint = new THREE.Vector3(localX, 0, localZ).applyMatrix4(worldMatrix)
              return {
                x: worldPoint.x,
                y: worldPoint.y,
                z: worldPoint.z,
              } satisfies { x: number; y: number; z: number }
            })
            .filter((entry): entry is { x: number; y: number; z: number } => Boolean(entry))
          : []
        const outlineIndices = buildOutlineTriangulation(worldOutlineVertices)
        if (!layers.length) {
          entries.push({
            node,
            layer: {
              id: `${node.id}:layer0`,
              order: nodeOrder,
              materialConfigId: null,
              materialProps: null,
              textureAssetIds: null,
            },
            order: nodeOrder,
            nodeOrder,
            worldMatrix: worldMatrix.clone(),
            worldSurfaceVertices: worldSurfaceVertices.vertices,
            surfaceIndices,
            worldOutlineVertices,
            outlineIndices,
            worldSurfaceSource: worldSurfaceVertices.source,
          })
        } else {
          layers.forEach((layer) => {
            entries.push({
              node,
              layer,
              order: Number.isFinite(layer.order) ? Number(layer.order) : nodeOrder,
              nodeOrder,
              worldMatrix: worldMatrix.clone(),
              worldSurfaceVertices: worldSurfaceVertices.vertices,
              surfaceIndices,
              worldOutlineVertices,
              outlineIndices,
              worldSurfaceSource: worldSurfaceVertices.source,
            })
          })
        }
      }
      if (Array.isArray(node.children) && node.children.length) {
        visit(node.children, nodeOrder * 1000, worldMatrix, nodeVisible)
      }
    })
  }
  visit(nodes)
  return entries.sort((a, b) => a.order - b.order || a.nodeOrder - b.nodeOrder || a.layer.id.localeCompare(b.layer.id))
}

function resolveGroundProjectedSurfaceVertices(
  node: SceneNode,
  worldMatrix: THREE.Matrix4 | null | undefined,
  groundDefinition: GroundDynamicMesh | null,
): {
  vertices: Array<{ x: number; y: number; z: number }>
  source: 'ground-uv' | 'transformed' | 'transformed-infinite'
} {
  const renderCache = node.dynamicMesh?.type === 'Landform'
    ? (node.dynamicMesh.renderCache ?? null)
    : null
  const surfaceVertices = Array.isArray(renderCache?.surfaceVertices) ? renderCache.surfaceVertices : []
  if (!surfaceVertices.length) {
    return {
      vertices: [],
      source: 'transformed',
    }
  }

  const transformedVertices = surfaceVertices
    .map((entry) => {
      const point = new THREE.Vector3(
        Number((entry as any)?.x) || 0,
        Number((entry as any)?.y) || 0,
        Number((entry as any)?.z) || 0,
      )
      if (worldMatrix) {
        point.applyMatrix4(worldMatrix)
      }
      return point
    })
  const transformedResult = transformedVertices
    .map((point) => ({
      x: point.x,
      y: point.y,
      z: point.z,
    }))
    .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.z))

  if (groundDefinition?.terrainMode === 'infinite') {
    return {
      vertices: transformedResult,
      source: 'transformed-infinite',
    }
  }

  const groundUvs = Array.isArray(renderCache?.surfaceGroundUvs)
    ? renderCache.surfaceGroundUvs
    : []
  if (!groundDefinition || groundUvs.length !== transformedVertices.length) {
    return {
      vertices: transformedResult,
      source: 'transformed',
    }
  }

  const bounds = resolveGroundWorldBounds(groundDefinition)
  const groundWidth = Math.max(bounds.maxX - bounds.minX, Number.EPSILON)
  const groundDepth = Math.max(bounds.maxZ - bounds.minZ, Number.EPSILON)
  return {
    vertices: transformedVertices
      .map((point, index) => {
        const uv = groundUvs[index]
        const u = Number((uv as { x?: unknown } | null | undefined)?.x)
        const v = Number((uv as { y?: unknown } | null | undefined)?.y)
        if (!Number.isFinite(u) || !Number.isFinite(v)) {
          return {
            x: point.x,
            y: point.y,
            z: point.z,
          }
        }
        return {
          x: bounds.minX + u * groundWidth,
          y: point.y,
          z: bounds.minZ + (1 - v) * groundDepth,
        }
      })
      .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.z)),
    source: 'ground-uv',
  }
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
  const cached = assetCache.getEntry(normalizedId)
  if (cached.status === 'cached' && cached.blob) {
    assetCache.touch(normalizedId)
    return cached.blob
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

async function loadLayerTextureImage(
  scene: StoredSceneDocument,
  assetId: string | null | undefined,
  cache: Map<string, Promise<LoadedBakedImage | null>>,
): Promise<LoadedBakedImage | null> {
  const normalized = typeof assetId === 'string' ? assetId.trim() : ''
  if (!normalized) {
    return null
  }
  const existing = cache.get(normalized)
  if (existing) {
    return await existing
  }
  const loading = (async () => {
    const blob = await resolveSceneAssetBlob(scene, normalized)
    if (!blob) {
      return null
    }
    const source = await blobToCanvasImageSource(blob)
    if (!source) {
      return null
    }
    const imageData = extractImageDataFromSource(source)
    if (!imageData) {
      return null
    }
    return { source, imageData }
  })()
  cache.set(normalized, loading)
  return await loading
}

async function resolveLayerTextureRuntimeSource(
  scene: StoredSceneDocument,
  assetId: string | null | undefined,
  cache: Map<string, Promise<string | null>>,
): Promise<string | null> {
  const normalized = typeof assetId === 'string' ? assetId.trim() : ''
  if (!normalized) {
    return null
  }
  const existing = cache.get(normalized)
  if (existing) {
    return await existing
  }
  const loading = (async () => {
    const blob = await resolveSceneAssetBlob(scene, normalized)
    if (blob) {
      const dataUrl = await blobToDataUrl(blob)
      if (typeof dataUrl === 'string' && dataUrl.length > 0) {
        return dataUrl
      }
    }
    return findAssetDownloadUrl(scene, normalized)
  })()
  cache.set(normalized, loading)
  return await loading
}

function resolveLandformMaterialProps(node: SceneNode, layerId?: string | null): SceneMaterialProps | null {
  const layers = resolveLandformSurfaceLayers(node)
  const normalizedLayerId = typeof layerId === 'string' && layerId.trim().length ? layerId.trim() : ''
  const matchedLayer = normalizedLayerId
    ? layers.find((entry) => entry.id === normalizedLayerId || entry.materialConfigId === normalizedLayerId)
    : null
  if (matchedLayer?.materialProps) {
    return matchedLayer.materialProps
  }
  const materials = Array.isArray(node.materials) ? node.materials : []
  if (!materials.length) {
    return null
  }
  const matched = normalizedLayerId
    ? materials.find((entry) => entry?.id === normalizedLayerId)
    : null
  const material = matched ?? materials[0] ?? null
  return material ? (material as SceneMaterialProps) : null
}

function collectSurfaceLayerTextureAssetIds(layers: LandformSurfaceLayerLike[]): string[] {
  const assetIds = new Set<string>()
  layers.forEach((layer) => {
    if (!Array.isArray(layer.textureAssetIds)) {
      return
    }
    layer.textureAssetIds.forEach((assetId) => {
      const normalized = typeof assetId === 'string' ? assetId.trim() : ''
      if (normalized.length > 0) {
        assetIds.add(normalized)
      }
    })
  })
  return Array.from(assetIds)
}

function getSurfaceVertices(
  node: SceneNode,
  worldMatrix?: THREE.Matrix4 | null,
  groundDefinition: GroundDynamicMesh | null = null,
): {
  vertices: Array<{ x: number; y: number; z: number }>
  source: 'ground-uv' | 'transformed' | 'transformed-infinite'
} {
  const renderCache = node.dynamicMesh?.type === 'Landform'
    ? (node.dynamicMesh.renderCache ?? null)
    : null
  if (!Array.isArray(renderCache?.surfaceVertices)) {
    return {
      vertices: [],
      source: 'transformed',
    }
  }
  return resolveGroundProjectedSurfaceVertices(node, worldMatrix, groundDefinition)
}

function getSurfaceIndices(node: SceneNode): number[] {
  const renderCache = node.dynamicMesh?.type === 'Landform'
    ? (node.dynamicMesh.renderCache ?? null)
    : null
  return Array.isArray(renderCache?.surfaceIndices)
    ? renderCache.surfaceIndices
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0)
    : []
}

function resolveChunkKey(chunkRow: number, chunkColumn: number): string {
  return formatGroundChunkKey(chunkColumn, chunkRow)
}

function resolveLandformBakeChunkClipBounds(definition: GroundDynamicMesh): WorldRect | null {
  if (definition.terrainMode === 'infinite') {
    return null
  }
  return normalizeGroundWorldBounds(definition.worldBounds)
}

function parseChunkKey(chunkKey: string): { chunkRow: number; chunkColumn: number } | null {
  const coord = parseGroundChunkKey(chunkKey)
  if (!coord) {
    return null
  }
  return {
    chunkRow: coord.chunkZ,
    chunkColumn: coord.chunkX,
  }
}

function resolveChunkWorldRect(
  chunkRow: number,
  chunkColumn: number,
  chunkSizeMeters: number,
  chunkOrigin: number,
  bounds: WorldRect | null,
): WorldRect | null {
  const rawMinX = chunkOrigin + (chunkColumn * chunkSizeMeters)
  const rawMinZ = chunkOrigin + (chunkRow * chunkSizeMeters)
  const rawMaxX = rawMinX + chunkSizeMeters
  const rawMaxZ = rawMinZ + chunkSizeMeters
  if (!bounds) {
    return {
      minX: rawMinX,
      maxX: rawMaxX,
      minZ: rawMinZ,
      maxZ: rawMaxZ,
    }
  }
  const minX = Math.max(bounds.minX, rawMinX)
  const maxX = Math.min(bounds.maxX, rawMaxX)
  const minZ = Math.max(bounds.minZ, rawMinZ)
  const maxZ = Math.min(bounds.maxZ, rawMaxZ)
  if (!(maxX > minX) || !(maxZ > minZ)) {
    return null
  }
  return { minX, maxX, minZ, maxZ }
}

function resolveChunkCanvasSize(chunkWidth: number, chunkDepth: number, maxTextureSize: number): { width: number; height: number } {
  const safeMax = Math.max(32, Math.round(maxTextureSize))
  const maxDimension = Math.max(chunkWidth, chunkDepth, 1e-6)
  return {
    width: clamp(Math.round((chunkWidth / maxDimension) * safeMax), 32, safeMax),
    height: clamp(Math.round((chunkDepth / maxDimension) * safeMax), 32, safeMax),
  }
}

function createMaskCanvasSet(size: { width: number; height: number }, count: number): Array<{ canvas: CanvasLike; context: Canvas2DContext }> | null {
  const result: Array<{ canvas: CanvasLike; context: Canvas2DContext }> = []
  for (let index = 0; index < count; index += 1) {
    const canvas = createCanvas(size.width, size.height)
    if (!canvas) {
      return null
    }
    canvas.context.clearRect(0, 0, size.width, size.height)
    result.push(canvas)
  }
  return result
}

function rangesOverlap(minA: number, maxA: number, minB: number, maxB: number): boolean {
  return maxA >= minB && maxB >= minA
}

function computeTriangleBoundsXZ(points: Array<{ x: number; z: number }>): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  if (points.length < 3) {
    return null
  }
  let triMinX = Number.POSITIVE_INFINITY
  let triMaxX = Number.NEGATIVE_INFINITY
  let triMinZ = Number.POSITIVE_INFINITY
  let triMaxZ = Number.NEGATIVE_INFINITY
  for (const point of points) {
    triMinX = Math.min(triMinX, point.x)
    triMaxX = Math.max(triMaxX, point.x)
    triMinZ = Math.min(triMinZ, point.z)
    triMaxZ = Math.max(triMaxZ, point.z)
  }
  return { minX: triMinX, maxX: triMaxX, minZ: triMinZ, maxZ: triMaxZ }
}

function cross2d(a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }): number {
  return ((b.x - a.x) * (c.z - a.z)) - ((b.z - a.z) * (c.x - a.x))
}

function pointInRect(point: { x: number; z: number }, rect: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean {
  return point.x >= rect.minX && point.x <= rect.maxX && point.z >= rect.minZ && point.z <= rect.maxZ
}

function pointInTriangle(point: { x: number; z: number }, triangle: Array<{ x: number; z: number }>): boolean {
  if (triangle.length < 3) {
    return false
  }
  const [a, b, c] = triangle
  const c1 = cross2d(a!, b!, point)
  const c2 = cross2d(b!, c!, point)
  const c3 = cross2d(c!, a!, point)
  const hasNegative = c1 < 0 || c2 < 0 || c3 < 0
  const hasPositive = c1 > 0 || c2 > 0 || c3 > 0
  return !(hasNegative && hasPositive)
}

function pointOnSegment(point: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  const cross = cross2d(a, b, point)
  if (Math.abs(cross) > 1e-8) {
    return false
  }
  const minX = Math.min(a.x, b.x) - 1e-8
  const maxX = Math.max(a.x, b.x) + 1e-8
  const minZ = Math.min(a.z, b.z) - 1e-8
  const maxZ = Math.max(a.z, b.z) + 1e-8
  return point.x >= minX && point.x <= maxX && point.z >= minZ && point.z <= maxZ
}

function orientation(a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }): number {
  const value = cross2d(a, b, c)
  if (Math.abs(value) <= 1e-8) {
    return 0
  }
  return value > 0 ? 1 : -1
}

function segmentsIntersect(
  a1: { x: number; z: number },
  a2: { x: number; z: number },
  b1: { x: number; z: number },
  b2: { x: number; z: number },
): boolean {
  const o1 = orientation(a1, a2, b1)
  const o2 = orientation(a1, a2, b2)
  const o3 = orientation(b1, b2, a1)
  const o4 = orientation(b1, b2, a2)
  if (o1 !== o2 && o3 !== o4) {
    return true
  }
  return (o1 === 0 && pointOnSegment(b1, a1, a2))
    || (o2 === 0 && pointOnSegment(b2, a1, a2))
    || (o3 === 0 && pointOnSegment(a1, b1, b2))
    || (o4 === 0 && pointOnSegment(a2, b1, b2))
}

function triangleIntersectsChunk(
  points: Array<{ x: number; z: number }>,
  chunkBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean {
  const bounds = computeTriangleBoundsXZ(points)
  if (!bounds) {
    return false
  }
  if (
    !rangesOverlap(bounds.minX, bounds.maxX, chunkBounds.minX, chunkBounds.maxX)
    || !rangesOverlap(bounds.minZ, bounds.maxZ, chunkBounds.minZ, chunkBounds.maxZ)
  ) {
    return false
  }

  if (points.some((point) => pointInRect(point, chunkBounds))) {
    return true
  }

  const rectCorners = [
    { x: chunkBounds.minX, z: chunkBounds.minZ },
    { x: chunkBounds.maxX, z: chunkBounds.minZ },
    { x: chunkBounds.maxX, z: chunkBounds.maxZ },
    { x: chunkBounds.minX, z: chunkBounds.maxZ },
  ]
  if (rectCorners.some((corner) => pointInTriangle(corner, points))) {
    return true
  }

  const triangleEdges: Array<[{ x: number; z: number }, { x: number; z: number }]> = [
    [points[0]!, points[1]!],
    [points[1]!, points[2]!],
    [points[2]!, points[0]!],
  ]
  const rectEdges: Array<[{ x: number; z: number }, { x: number; z: number }]> = [
    [rectCorners[0]!, rectCorners[1]!],
    [rectCorners[1]!, rectCorners[2]!],
    [rectCorners[2]!, rectCorners[3]!],
    [rectCorners[3]!, rectCorners[0]!],
  ]
  return triangleEdges.some(([a1, a2]) => rectEdges.some(([b1, b2]) => segmentsIntersect(a1, a2, b1, b2)))
}

function landformIntersectsChunk(
  vertices: Array<{ x: number; y: number; z: number }>,
  indices: number[],
  chunkBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean {
  if (!vertices.length) {
    return false
  }
  if (!indices.length) {
    return vertices.some((vertex) => (
      vertex.x >= chunkBounds.minX
      && vertex.x <= chunkBounds.maxX
      && vertex.z >= chunkBounds.minZ
      && vertex.z <= chunkBounds.maxZ
    ))
  }
  for (let index = 0; index + 2 < indices.length; index += 3) {
    const p0 = vertices[indices[index]!] ?? null
    const p1 = vertices[indices[index + 1]!] ?? null
    const p2 = vertices[indices[index + 2]!] ?? null
    if (!p0 || !p1 || !p2) {
      continue
    }
    if (triangleIntersectsChunk([
      { x: p0.x, z: p0.z },
      { x: p1.x, z: p1.z },
      { x: p2.x, z: p2.z },
    ], chunkBounds)) {
      return true
    }
  }
  return false
}

function buildOutlineTriangulation(vertices: Array<{ x: number; y: number; z: number }>): number[] {
  if (vertices.length < 3) {
    return []
  }
  const contour = vertices.map((vertex) => new THREE.Vector2(vertex.x, vertex.z))
  const faces = THREE.ShapeUtils.triangulateShape(contour, [])
  const indices: number[] = []
  faces.forEach((face) => {
    if (Array.isArray(face) && face.length === 3) {
      indices.push(face[0]!, face[1]!, face[2]!)
    }
  })
  return indices
}

function collectLandformIntersectionGeometries(entry: LandformBakeEntry): Array<{
  vertices: Array<{ x: number; y: number; z: number }>
  indices: number[]
}> {
  const geometries: Array<{
    vertices: Array<{ x: number; y: number; z: number }>
    indices: number[]
  }> = []
  if (entry.worldSurfaceVertices.length >= 3 && entry.surfaceIndices.length >= 3) {
    geometries.push({
      vertices: entry.worldSurfaceVertices,
      indices: entry.surfaceIndices,
    })
  }
  if (entry.worldOutlineVertices.length >= 3) {
    const outlineIndices = entry.outlineIndices.length >= 3
      ? entry.outlineIndices
      : buildOutlineTriangulation(entry.worldOutlineVertices)
    if (outlineIndices.length >= 3) {
      geometries.push({
        vertices: entry.worldOutlineVertices,
        indices: outlineIndices,
      })
    }
  }
  return geometries
}

function collectLandformChunkPaintGeometries(
  entry: LandformBakeEntry,
  chunkBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): Array<{
  source: 'surface' | 'outline'
  vertices: Array<{ x: number; y: number; z: number }>
  indices: number[]
}> {
  const geometries: Array<{
    source: 'surface' | 'outline'
    vertices: Array<{ x: number; y: number; z: number }>
    indices: number[]
  }> = []
  const surfaceHits = landformIntersectsChunk(entry.worldSurfaceVertices, entry.surfaceIndices, chunkBounds)
  if (surfaceHits && entry.worldSurfaceVertices.length >= 3 && entry.surfaceIndices.length >= 3) {
    geometries.push({
      source: 'surface',
      vertices: entry.worldSurfaceVertices,
      indices: entry.surfaceIndices,
    })
  }
  const outlineHits = landformIntersectsChunk(entry.worldOutlineVertices, entry.outlineIndices, chunkBounds)
  if (outlineHits && entry.worldOutlineVertices.length >= 3) {
    const outlineIndices = entry.outlineIndices.length >= 3
      ? entry.outlineIndices
      : buildOutlineTriangulation(entry.worldOutlineVertices)
    if (outlineIndices.length >= 3) {
      geometries.push({
        source: 'outline',
        vertices: entry.worldOutlineVertices,
        indices: outlineIndices,
      })
    }
  }
  return geometries
}

function collectLandformBakeAffectedChunkKeys(
  entries: LandformBakeEntry[],
  definition: GroundDynamicMesh,
): string[] {
  const chunkSizeMetersValue = Number(definition.chunkSizeMeters ?? 0)
  const chunkSizeMeters = Number.isFinite(chunkSizeMetersValue) && chunkSizeMetersValue > 0
    ? chunkSizeMetersValue
    : 100
  const chunkOrigin = resolveInfiniteGroundGridOriginMeters(chunkSizeMeters)
  const authoredBounds = resolveLandformBakeChunkClipBounds(definition)
  const maxEdgeEpsilon = Math.max(1e-9, chunkSizeMeters * 1e-9)
  const affectedChunkKeys = new Set<string>()

  for (const entry of entries) {
    const geometries = collectLandformIntersectionGeometries(entry)
    if (!geometries.length) {
      continue
    }
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    geometries.forEach((geometry) => {
      for (const vertex of geometry.vertices) {
        if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.z)) {
          continue
        }
        minX = Math.min(minX, vertex.x)
        maxX = Math.max(maxX, vertex.x)
        minZ = Math.min(minZ, vertex.z)
        maxZ = Math.max(maxZ, vertex.z)
      }
    })
    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
      continue
    }
    const featherWidth = computeLandformEntryMaxFeatherWidth(entry)
    const queryMinX = minX - featherWidth
    const queryMaxX = maxX + featherWidth
    const queryMinZ = minZ - featherWidth
    const queryMaxZ = maxZ + featherWidth
    const expandedEntryBounds = {
      minX: queryMinX,
      maxX: queryMaxX,
      minZ: queryMinZ,
      maxZ: queryMaxZ,
    }
    const minCoord = resolveGroundChunkCoordFromWorldPosition(queryMinX, queryMinZ, chunkSizeMeters)
    const maxCoord = resolveGroundChunkCoordFromWorldPosition(queryMaxX - maxEdgeEpsilon, queryMaxZ - maxEdgeEpsilon, chunkSizeMeters)
    const minChunkRow = Math.min(minCoord.chunkZ, maxCoord.chunkZ)
    const maxChunkRow = Math.max(minCoord.chunkZ, maxCoord.chunkZ)
    const minChunkColumn = Math.min(minCoord.chunkX, maxCoord.chunkX)
    const maxChunkColumn = Math.max(minCoord.chunkX, maxCoord.chunkX)
    for (let chunkRow = minChunkRow; chunkRow <= maxChunkRow; chunkRow += 1) {
      for (let chunkColumn = minChunkColumn; chunkColumn <= maxChunkColumn; chunkColumn += 1) {
        const chunkRect = resolveChunkWorldRect(chunkRow, chunkColumn, chunkSizeMeters, chunkOrigin, authoredBounds)
        if (!chunkRect) {
          continue
        }
        if (
          rangesOverlap(chunkRect.minX, chunkRect.maxX, expandedEntryBounds.minX, expandedEntryBounds.maxX)
          && rangesOverlap(chunkRect.minZ, chunkRect.maxZ, expandedEntryBounds.minZ, expandedEntryBounds.maxZ)
          && geometries.some((geometry) => landformIntersectsChunk(geometry.vertices, geometry.indices, expandWorldRect(chunkRect, featherWidth)))
        ) {
          affectedChunkKeys.add(resolveChunkKey(chunkRow, chunkColumn))
        }
      }
    }
  }

  return Array.from(affectedChunkKeys).sort((left, right) => {
    const leftParts = parseChunkKey(left)
    const rightParts = parseChunkKey(right)
    if (!leftParts || !rightParts) {
      return left.localeCompare(right)
    }
    return leftParts.chunkColumn - rightParts.chunkColumn || leftParts.chunkRow - rightParts.chunkRow
  })
}

function packMaskChannel(
  target: Uint8ClampedArray,
  targetWidth: number,
  targetHeight: number,
  source: ImageData,
  channelIndex: number,
): void {
  const safeChannelIndex = Math.max(0, Math.min(3, Math.trunc(channelIndex)))
  const expectedLength = targetWidth * targetHeight
  const limit = Math.min(expectedLength, source.data.length / 4)
  for (let pixelIndex = 0; pixelIndex < limit; pixelIndex += 1) {
    const srcOffset = pixelIndex * 4
    const dstOffset = srcOffset + safeChannelIndex
    const maskValue = source.data[srcOffset + 3] ?? 0
    target[dstOffset] = Math.max(target[dstOffset] ?? 0, maskValue)
    target[srcOffset + 3] = 255
  }
}

async function canvasToImageData(canvas: CanvasLike): Promise<ImageData | null> {
  const context = 'getContext' in canvas ? canvas.getContext('2d') : null
  if (!context || !('getImageData' in context)) {
    return null
  }
  try {
    return context.getImageData(0, 0, canvas.width, canvas.height)
  } catch {
    return null
  }
}

export async function bakeLandformGroundSurfaceChunks(
  scene: StoredSceneDocument,
  definition: GroundDynamicMesh,
  options: LandformGroundBakeOptions = {},
): Promise<GroundSurfaceChunkTextureMap | null> {
  // 这个函数的目标很简单：
  // 把场景里的 landform（地形/地貌覆盖层）按 ground chunk 分块烘焙成 mask + 图层元数据，
  // 但不再烘焙 ground 底图本身。
  //
  // 这样 runtime 就可以继续保留 ground 的原始材质，只把 landform 作为覆盖层叠加上去。
  //
  // 它不是在“生成地形几何”，而是在“生成地表渲染用的叠加数据”。
  // 所以这里的核心工作是：
  // 1. 找到会影响地表的 landform 节点
  // 2. 找到这些 landform 实际覆盖到哪些 ground chunk
  // 3. 逐块把 landform 图层画进离屏 canvas
  // 4. 把 mask 通道重新打包成最终可给 shader 用的纹理
  const landformNodes = getGroundLandformNodes(scene.nodes)
  if (!landformNodes.length) {
    // 场景里根本没有 landform，就不需要烘焙任何地表图。
    return null
  }
  const landformEntries = collectLandformBakeEntries(scene.nodes, definition)
  if (!landformEntries.length) {
    // 没有可参与烘焙的有效几何数据，也直接返回。
    return null
  }

  // chunkSizeMeters 决定 ground 被切成多大的世界单位分块。
  // 如果外部没有给合法值，就回退到 100m，避免后面所有计算都失去基准。
  const chunkSizeMetersValue = Number(definition.chunkSizeMeters ?? 0)
  const chunkSizeMeters = Number.isFinite(chunkSizeMetersValue) && chunkSizeMetersValue > 0
    ? chunkSizeMetersValue
    : 100
  // chunkOrigin 是无限地形网格的原点，用于把世界坐标稳定映射到 chunk 坐标。
  // authoredBounds 则是“作者显式指定的地形边界”：
  // - 无限地形时为 null
  // - 有限地形时会把超出边界的 chunk 裁掉
  const chunkOrigin = resolveInfiniteGroundGridOriginMeters(chunkSizeMeters)
  const authoredBounds = resolveLandformBakeChunkClipBounds(definition)

  // 先做一次粗筛：只找“确实被 landform 覆盖到”的 chunk。
  // 这样后面不会无意义地给整张地表都生成贴图。
  const affectedChunkKeys = collectLandformBakeAffectedChunkKeys(landformEntries, definition)
  if (!affectedChunkKeys.length) {
    return null
  }

  // 最终输出纹理尺寸的上限。
  // 这里不是固定大小，而是根据 chunk 的实际世界尺寸按比例缩放后再限制最大值。
  const maxTextureSize = Math.max(128, Math.round(options.maxTextureSize ?? 1024))

  // nextChunks 就是最终返回的结果：chunkKey -> GroundSurfaceChunkTextureRef。
  // 这些缓存用来避免同一张贴图反复解码/转 dataURL。
  const nextChunks: GroundSurfaceChunkTextureMap = {}
  const layerTextureRuntimeSourceCache = new Map<string, Promise<string | null>>()

  // 逐个处理受影响的 chunk。
  for (const chunkKey of affectedChunkKeys) {
    const chunkIndices = parseChunkKey(chunkKey)
    if (!chunkIndices) {
      continue
    }
    const chunkRect = resolveChunkWorldRect(
      chunkIndices.chunkRow,
      chunkIndices.chunkColumn,
      chunkSizeMeters,
      chunkOrigin,
      authoredBounds,
    )
    if (!chunkRect) {
      continue
    }
    // 当前 chunk 的世界坐标范围。
    // 这个范围会被后续用于：
    // - 把 world vertex 坐标映射到 canvas 像素坐标
    // - 计算纹理平铺（tiling）大小
    const minX = chunkRect.minX
    const minZ = chunkRect.minZ
    const chunkWidth = Math.max(1e-6, chunkRect.maxX - chunkRect.minX)
    const chunkDepth = Math.max(1e-6, chunkRect.maxZ - chunkRect.minZ)

    // 把 chunk 的世界尺寸换算成离屏画布尺寸。
    // 这里仍然需要 size，因为 mask 纹理要和 chunk 分辨率对齐。
    const size = resolveChunkCanvasSize(chunkWidth, chunkDepth, maxTextureSize)
    const chunkMaxX = chunkRect.maxX
    const chunkMaxZ = chunkRect.maxZ
    const chunkBounds = {
      minX,
      maxX: chunkMaxX,
      minZ,
      maxZ: chunkMaxZ,
    }
    const chunkLandforms = landformEntries.filter((entry) => {
      const geometries = collectLandformIntersectionGeometries(entry)
      const featherWidth = computeLandformEntryMaxFeatherWidth(entry)
      const queryBounds = expandWorldRect(chunkBounds, featherWidth)
      return geometries.some((geometry) => landformIntersectsChunk(geometry.vertices, geometry.indices, queryBounds))
    })
    if (!chunkLandforms.length) {
      continue
    }

    // 按层级顺序排序，并且最多取 4 层。
    // 小程序运行时只采样一张 RGBA mask，避免额外纹理采样和 shader 分支。
    const maxSplatLayers = Math.max(1, Math.min(4, Math.trunc(Number(options.maxSplatLayers) || 4)))
    const chunkLayers = chunkLandforms
      .slice()
      .sort((a, b) => a.order - b.order || a.nodeOrder - b.nodeOrder || a.layer.id.localeCompare(b.layer.id))
      .slice(0, maxSplatLayers)

    // feather 是图层边缘柔化效果。
    // 它最终会影响 mask alpha，从而让图层在边缘过渡更自然。
    const activeLayerCount = Math.min(4, Math.max(1, chunkLayers.length))
    const chunkSurfaceLayers: GroundSurfaceChunkLayerRef[] = []

    // 为每个图层准备一张独立 mask 画布。
    // 这些 mask 最后会被打包进一张 RGBA 纹理，供 shader 读取每层权重。
    const maskCanvases = createMaskCanvasSet(size, activeLayerCount)
    if (!maskCanvases) {
      continue
    }
    const layerFeatherSettings: LandformFeatherSettings[] = []
    let chunkPaintedTriangleCount = 0

    // 逐图层烘焙。
    for (let entryIndex = 0; entryIndex < chunkLayers.length; entryIndex += 1) {
      const layerEntry = chunkLayers[entryIndex]!
      const landform = layerEntry.node
      const targetLayer = layerEntry.layer

      // 图层材质优先取 layer 自己绑定的 materialConfigId / materialProps，
      // 找不到时再退回到节点默认材质。
      const props = resolveLandformMaterialProps(landform, targetLayer?.materialConfigId ?? targetLayer?.id ?? null)
      if (!props) {
        continue
      }

      // 当前图层的可视化参数：
      // - color：用作 landform 覆盖层的色调参考
      // - opacity：整体透明度
      // - albedo/normal：用于告诉运行时 layer 应该加载什么纹理
      const landformColor = parseColor(props.color)
      const opacity = clamp(Number(props.opacity) || 1, 0, 1)
      const albedoTextureRef = resolveMaterialTextureRef(props, 'albedo')
      const normalTextureRef = resolveMaterialTextureRef(props, 'normal')

      // feather 既可以来自图层自身，也可以继承 landform 的全局设置。
      // 它用于让图层边缘不要过于生硬。
      const featherSettings = resolveLayerFeatherSettings(layerEntry)

      // 图层顺序对应 mask 通道序号。
      // 第 0~3 层进唯一的 splat0。
      const layerIndex = Math.min(maskCanvases.length - 1, entryIndex)
      const maskContext = maskCanvases[layerIndex]?.context ?? null
      layerFeatherSettings[layerIndex] = featherSettings

      // 这层最终用于 shader 的主纹理来源。
      // 优先取 albedo 贴图；如果没有，则尝试 layer 自己声明的 textureAssetIds。
      const primaryTextureAssetId = resolveTextureAssetId(albedoTextureRef)
        ?? (Array.isArray(targetLayer?.textureAssetIds) ? targetLayer.textureAssetIds[0] ?? null : null)
      const primaryTextureRuntimeSource = primaryTextureAssetId
        ? await resolveLayerTextureRuntimeSource(scene, primaryTextureAssetId, layerTextureRuntimeSourceCache)
        : null
      const normalTextureAssetId = resolveTextureAssetId(normalTextureRef)
      const normalTextureRuntimeSource = normalTextureAssetId
        ? await resolveLayerTextureRuntimeSource(scene, normalTextureAssetId, layerTextureRuntimeSourceCache)
        : null

      // UV scale 决定这层在 chunk 内如何重复平铺。
      // 如果 layer 没有明确给，就回退到 1，保持导出结果和 preview/runtime 的默认语义一致。
      const chunkLayerUvScale = targetLayer?.uvScale && Number(targetLayer.uvScale.x) > 0 && Number(targetLayer.uvScale.y) > 0
        ? { x: Number(targetLayer.uvScale.x), y: Number(targetLayer.uvScale.y) }
        : { x: 1, y: 1 }

      // 这里把“将来 shader 需要知道的信息”先整理进 chunkSurfaceLayers，
      // 最终会写入 GroundSurfaceChunkTextureRef.surfaceLayers。
      const albedoTextureSettings = albedoTextureRef?.settings
        ? createTextureSettings(albedoTextureRef.settings as Partial<SceneMaterialTextureSettings>)
        : null
      const normalTextureSettings = normalTextureRef?.settings
        ? createTextureSettings(normalTextureRef.settings as Partial<SceneMaterialTextureSettings>)
        : null
      chunkSurfaceLayers.push({
        albedoSource: primaryTextureRuntimeSource,
        albedoTextureSettings,
        normalSource: normalTextureRuntimeSource,
        normalTextureSettings,
        colorTint: landformColor,
        opacity,
        uvScale: chunkLayerUvScale,
        maskChannel: layerIndex,
        featherEnabled: featherSettings.enabled,
        featherWidth: featherSettings.width,
      })

      // 取出当前 chunk 内真正需要绘制的几何片段。
      // 这里可能同时包含 surface 和 outline 两类来源。
      let paintedTriangleCount = 0
      const paintGeometries = collectLandformChunkPaintGeometries(layerEntry, chunkBounds)
      for (const geometry of paintGeometries) {
        const vertices = geometry.vertices
        const indices = geometry.indices
        if (!vertices.length || indices.length < 3) {
          continue
        }

        // 把世界坐标转换成当前 chunk 画布内的局部像素坐标。
        // x 使用 chunk 左边界归一化，y 使用 z 轴并做反向映射，
        // 这样 mask 和 chunk 俯视方向一致。
        const localPoints = vertices.map((vertex) => ({
          x: ((vertex.x - minX) / chunkWidth) * size.width,
          y: ((chunkMaxZ - vertex.z) / chunkDepth) * size.height,
        }))

        // 一个 geometry 可能包含很多三角形，这里按 index 每三个一组来画。
        for (let index = 0; index + 2 < indices.length; index += 3) {
          const i0 = indices[index]!
          const i1 = indices[index + 1]!
          const i2 = indices[index + 2]!
          const p0 = localPoints[i0]
          const p1 = localPoints[i1]
          const p2 = localPoints[i2]
          if (!p0 || !p1 || !p2) {
            continue
          }
          paintedTriangleCount += 1
          chunkPaintedTriangleCount += 1

          if (maskContext) {
            drawTriangleMask(maskContext, [p0, p1, p2], 1, '#ffffff')
          }
        }
      }

      // 如果这个图层在当前 chunk 里没有实际画出任何三角形，就跳过后续打包。
      if (paintedTriangleCount <= 0) {
        continue
      }
    }

    if (chunkPaintedTriangleCount <= 0 || chunkSurfaceLayers.length <= 0) {
      continue
    }

    // 把每个独立 mask 画布读回 ImageData，按每层 feather 生成空间渐变权重后再打包。
    const metersPerPixel = Math.max(chunkWidth / Math.max(1, size.width), chunkDepth / Math.max(1, size.height), 1e-6)
    const maskImages = await Promise.all(maskCanvases.map(async ({ canvas }, index) => {
      const rawMask = await canvasToImageData(canvas)
      if (!rawMask) {
        return null
      }
      const feather = layerFeatherSettings[index]
      const featherPixels = feather?.enabled && feather.width > 0
        ? feather.width / metersPerPixel
        : 0
      return softenMaskImageData(rawMask, featherPixels, 1)
    }))

    // splat 纹理只输出一张 RGBA 图：
    // splat0 = layer 0~3
    const splat0 = createCanvas(size.width, size.height)
    if (!splat0) {
      continue
    }
    const splat0Data = splat0.context.createImageData(size.width, size.height)
    const splat0Buffer = splat0Data.data
    const emptyMask = new Uint8ClampedArray(size.width * size.height * 4)
    for (let channel = 0; channel < 4; channel += 1) {
      const mask = maskImages[channel] ?? { data: emptyMask, width: size.width, height: size.height } as ImageData
      // 把单独的 mask 通道压进 RGBA 的某个分量里。
      // 这一步的结果就是 shader 可直接读取的 splat map。
      packMaskChannel(splat0Buffer, size.width, size.height, mask, channel)
    }
    splat0.context.putImageData(splat0Data, 0, 0)

    // 最后把 canvas 编码成 blob，再转成 dataURL。
    // 这样 GroundSurfaceChunkTextureRef 就能直接携带可序列化的纹理数据。
    const splat0Blob = await canvasToBlob(splat0.canvas)
    const nextChunkRef: GroundSurfaceChunkTextureRef = {
      baseBlendMode: 'shader-splat-v1',
      textureAssetId: null,
      normalTextureAssetId: null,
      splatMapAssetIds: [splat0Blob ? await blobToDataUrl(splat0Blob) : null]
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
      surfaceLayers: chunkSurfaceLayers,
      revision: Date.now(),
    }
    nextChunks[chunkKey] = nextChunkRef
  }

  // 如果这轮烘焙一个 chunk 都没生成，就返回 null，
  // 这样上层可以明确知道“没有新结果”，而不是一个空对象。
  return Object.keys(nextChunks).length > 0 ? nextChunks : null
}

export async function bakeLandformGroundSplatForSceneDocument(
  scene: StoredSceneDocument,
  options: LandformGroundBakeOptions = {},
): Promise<GroundSurfaceChunkTextureMap | null> {
  const groundNode = findGroundNode(scene.nodes ?? [])
  if (!groundNode?.dynamicMesh || groundNode.dynamicMesh.type !== 'Ground') {
    return null
  }

  const landformNodes = getGroundLandformNodes(scene.nodes ?? [])
  if (!landformNodes.length) {
    groundNode.dynamicMesh = {
      ...groundNode.dynamicMesh,
      groundSurfaceChunks: null,
      groundSplatBake: null,
    }
    return null
  }

  const layerTextureAssetIds = Array.from(new Set(
    landformNodes.flatMap((node) => collectSurfaceLayerTextureAssetIds(resolveLandformSurfaceLayers(node))),
  ))

  const baked = await bakeLandformGroundSurfaceChunks(scene, groundNode.dynamicMesh, options)
  if (!baked) {
    groundNode.dynamicMesh = {
      ...groundNode.dynamicMesh,
      groundSurfaceChunks: null,
      groundSplatBake: null,
    }
    return null
  }

  const nextGroundMesh: GroundDynamicMesh = {
    ...groundNode.dynamicMesh,
    groundSurfaceChunks: baked,
    groundSplatBake: {
      revision: Date.now(),
      chunkTextureMap: baked,
      surfaceLayerTextureAssetIds: layerTextureAssetIds.length ? layerTextureAssetIds : null,
    },
  }
  groundNode.dynamicMesh = nextGroundMesh
  return baked
}

function findGroundNode(nodes: SceneNode[]): SceneNode | null {
  for (const node of nodes ?? []) {
    if (node?.dynamicMesh?.type === 'Ground') {
      return node
    }
    if (Array.isArray(node?.children) && node.children.length > 0) {
      const nested = findGroundNode(node.children)
      if (nested) {
        return nested
      }
    }
  }
  return null
}
