import * as THREE from 'three'
import type {
  GroundDynamicMesh,
  GroundSurfaceChunkTextureMap,
  GroundSurfaceChunkTextureRef,
  LandformDynamicMesh,
  SceneMaterialProps,
  SceneMaterialTextureRef,
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

type LoadedBakedImage = {
  source: CanvasImageSource
  imageData: ImageDataSource
}

export type LandformGroundBakeOptions = {
  maxTextureSize?: number
}

const GROUNDSPLAT_DEBUG_TINT = 'rgba(255, 64, 160, 0.72)'
const GROUNDSPLAT_DEBUG_TINT_ALPHA = 0.72

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
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

function paintScalarTextureTint(
  context: Canvas2DContext,
  triangle: Array<{ x: number; y: number }>,
  color: string,
  alpha: number,
): void {
  const bounds = computeTriangleBounds(triangle)
  if (!bounds) {
    return
  }
  context.save()
  context.beginPath()
  context.moveTo(triangle[0]!.x, triangle[0]!.y)
  context.lineTo(triangle[1]!.x, triangle[1]!.y)
  context.lineTo(triangle[2]!.x, triangle[2]!.y)
  context.closePath()
  context.clip()
  context.globalCompositeOperation = 'multiply'
  context.globalAlpha = clamp(alpha, 0, 1)
  context.fillStyle = color
  context.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
  context.restore()
}

function paintScalarTextureTintRect(
  context: Canvas2DContext,
  width: number,
  height: number,
  color: string,
  alpha: number,
): void {
  context.save()
  context.globalCompositeOperation = 'multiply'
  context.globalAlpha = clamp(alpha, 0, 1)
  context.fillStyle = color
  context.fillRect(0, 0, width, height)
  context.restore()
}

function scaleColor(hex: string, intensity: number): string {
  const color = new THREE.Color(hex)
  const normalized = Math.max(0, intensity)
  color.multiplyScalar(normalized)
  return `rgb(${Math.round(clamp(color.r, 0, 1) * 255)}, ${Math.round(clamp(color.g, 0, 1) * 255)}, ${Math.round(clamp(color.b, 0, 1) * 255)})`
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
    roughness: Canvas2DContext
    metalness: Canvas2DContext
    ao: Canvas2DContext
    emissive: Canvas2DContext
  },
  size: { width: number; height: number },
  sceneWorldBounds: WorldRect,
  chunkWorldRect: WorldRect,
  groundProps: SceneMaterialProps | null,
  cache: Map<string, Promise<LoadedBakedImage | null>>,
): Promise<void> {
  const albedoTextureRef = resolveMaterialTextureRef(groundProps, 'albedo')
  const normalTextureRef = resolveMaterialTextureRef(groundProps, 'normal')
  const roughnessTextureRef = resolveMaterialTextureRef(groundProps, 'roughness')
  const metalnessTextureRef = resolveMaterialTextureRef(groundProps, 'metalness')
  const aoTextureRef = resolveMaterialTextureRef(groundProps, 'ao')
  const emissiveTextureRef = resolveMaterialTextureRef(groundProps, 'emissive')
  const [
    loadedAlbedoTexture,
    loadedNormalTexture,
    loadedRoughnessTexture,
    loadedMetalnessTexture,
    loadedAoTexture,
    loadedEmissiveTexture,
  ] = await Promise.all([
    resolveMaterialTextureImage(scene, albedoTextureRef, cache),
    resolveMaterialTextureImage(scene, normalTextureRef, cache),
    resolveMaterialTextureImage(scene, roughnessTextureRef, cache),
    resolveMaterialTextureImage(scene, metalnessTextureRef, cache),
    resolveMaterialTextureImage(scene, aoTextureRef, cache),
    resolveMaterialTextureImage(scene, emissiveTextureRef, cache),
  ])

  const baseColor = parseColor(groundProps?.color)
  const baseRoughness = clamp(Number(groundProps?.roughness) || 1, 0, 1)
  const baseMetalness = clamp(Number(groundProps?.metalness) || 0, 0, 1)
  const baseAoStrength = clamp(Number(groundProps?.aoStrength) || 1, 0, 1)
  const baseEmissive = parseColor(groundProps?.emissive, '#000000')
  const baseEmissiveIntensity = Math.max(0, Number(groundProps?.emissiveIntensity) || 0)

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

  draw.roughness.fillStyle = 'rgb(255, 255, 255)'
  draw.roughness.fillRect(0, 0, size.width, size.height)
  if (loadedRoughnessTexture) {
    paintWorldAlignedTextureIntoRect(draw.roughness, loadedRoughnessTexture, chunkWorldRect, sceneWorldBounds, size.width, size.height, roughnessTextureRef)
    paintScalarTextureTintRect(draw.roughness, size.width, size.height, scaleColor('#ffffff', baseRoughness), 1)
  } else {
    draw.roughness.fillStyle = scaleColor('#ffffff', baseRoughness)
    draw.roughness.fillRect(0, 0, size.width, size.height)
  }

  draw.metalness.fillStyle = 'rgb(0, 0, 0)'
  draw.metalness.fillRect(0, 0, size.width, size.height)
  if (loadedMetalnessTexture) {
    paintWorldAlignedTextureIntoRect(draw.metalness, loadedMetalnessTexture, chunkWorldRect, sceneWorldBounds, size.width, size.height, metalnessTextureRef)
    paintScalarTextureTintRect(draw.metalness, size.width, size.height, scaleColor('#ffffff', baseMetalness), 1)
  } else {
    draw.metalness.fillStyle = scaleColor('#ffffff', baseMetalness)
    draw.metalness.fillRect(0, 0, size.width, size.height)
  }

  draw.ao.fillStyle = 'rgb(255, 255, 255)'
  draw.ao.fillRect(0, 0, size.width, size.height)
  if (loadedAoTexture) {
    paintWorldAlignedTextureIntoRect(draw.ao, loadedAoTexture, chunkWorldRect, sceneWorldBounds, size.width, size.height, aoTextureRef)
    paintScalarTextureTintRect(draw.ao, size.width, size.height, scaleColor('#ffffff', baseAoStrength), 1)
  } else {
    draw.ao.fillStyle = scaleColor('#ffffff', baseAoStrength)
    draw.ao.fillRect(0, 0, size.width, size.height)
  }

  draw.emissive.fillStyle = 'rgb(0, 0, 0)'
  draw.emissive.fillRect(0, 0, size.width, size.height)
  if (loadedEmissiveTexture) {
    paintWorldAlignedTextureIntoRect(draw.emissive, loadedEmissiveTexture, chunkWorldRect, sceneWorldBounds, size.width, size.height, emissiveTextureRef)
    paintScalarTextureTintRect(draw.emissive, size.width, size.height, scaleColor(baseEmissive, baseEmissiveIntensity), 1)
  } else if (baseEmissiveIntensity > 0) {
    draw.emissive.fillStyle = scaleColor(baseEmissive, baseEmissiveIntensity)
    draw.emissive.fillRect(0, 0, size.width, size.height)
  }
}

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
    const minCoord = resolveGroundChunkCoordFromWorldPosition(minX, minZ, chunkSizeMeters)
    const maxCoord = resolveGroundChunkCoordFromWorldPosition(maxX - maxEdgeEpsilon, maxZ - maxEdgeEpsilon, chunkSizeMeters)
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
        if (geometries.some((geometry) => landformIntersectsChunk(geometry.vertices, geometry.indices, chunkRect))) {
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
  const groundNode = findGroundNode(scene.nodes ?? [])
  const landformNodes = getGroundLandformNodes(scene.nodes)
  if (!landformNodes.length) {
    return null
  }
  const landformEntries = collectLandformBakeEntries(scene.nodes, definition)
  if (!landformEntries.length) {
    return null
  }

  const chunkSizeMetersValue = Number(definition.chunkSizeMeters ?? 0)
  const chunkSizeMeters = Number.isFinite(chunkSizeMetersValue) && chunkSizeMetersValue > 0
    ? chunkSizeMetersValue
    : 100
  const chunkOrigin = resolveInfiniteGroundGridOriginMeters(chunkSizeMeters)
  const authoredBounds = resolveLandformBakeChunkClipBounds(definition)
  const sceneBounds = resolveGroundWorldBounds(definition)
  const affectedChunkKeys = collectLandformBakeAffectedChunkKeys(landformEntries, definition)
  if (!affectedChunkKeys.length) {
    return null
  }
  const maxTextureSize = Math.max(128, Math.round(options.maxTextureSize ?? 1024))
  const nextChunks: GroundSurfaceChunkTextureMap = {}
  const layerTextureCache = new Map<string, Promise<LoadedBakedImage | null>>()
  const layerTextureRuntimeSourceCache = new Map<string, Promise<string | null>>()
  const groundMaterialProps = resolvePrimaryMaterialProps(groundNode)

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
    const minX = chunkRect.minX
    const minZ = chunkRect.minZ
    const chunkWidth = Math.max(1e-6, chunkRect.maxX - chunkRect.minX)
    const chunkDepth = Math.max(1e-6, chunkRect.maxZ - chunkRect.minZ)
    const size = resolveChunkCanvasSize(chunkWidth, chunkDepth, maxTextureSize)
    const canvases = {
      albedo: createCanvas(size.width, size.height),
      normal: createCanvas(size.width, size.height),
      roughness: createCanvas(size.width, size.height),
      metalness: createCanvas(size.width, size.height),
      ao: createCanvas(size.width, size.height),
      emissive: createCanvas(size.width, size.height),
    }
    if (!canvases.albedo || !canvases.normal || !canvases.roughness || !canvases.metalness || !canvases.ao || !canvases.emissive) {
      continue
    }
    const draw = {
      albedo: canvases.albedo.context,
      normal: canvases.normal.context,
      roughness: canvases.roughness.context,
      metalness: canvases.metalness.context,
      ao: canvases.ao.context,
      emissive: canvases.emissive.context,
    }

    const chunkMaxX = chunkRect.maxX
    const chunkMaxZ = chunkRect.maxZ
    await paintGroundMaterialBaseIntoChunk(
      scene,
      draw,
      size,
      sceneBounds,
      {
        minX,
        maxX: chunkMaxX,
        minZ,
        maxZ: chunkMaxZ,
      },
      groundMaterialProps,
      layerTextureCache,
    )
    const chunkBounds = {
      minX,
      maxX: chunkMaxX,
      minZ,
      maxZ: chunkMaxZ,
    }
    const chunkLandforms = landformEntries.filter((entry) => {
      const geometries = collectLandformIntersectionGeometries(entry)
      return geometries.some((geometry) => landformIntersectsChunk(geometry.vertices, geometry.indices, chunkBounds))
    })
    if (!chunkLandforms.length) {
      continue
    }

      const chunkLayers = chunkLandforms
        .slice()
        .sort((a, b) => a.order - b.order || a.nodeOrder - b.nodeOrder || a.layer.id.localeCompare(b.layer.id))
        .slice(0, 8)
      const applyDebugTint = false
      const activeLayerCount = Math.min(8, Math.max(1, chunkLayers.length))
      const chunkLayerTextureAssetIds: Array<string | null> = []
      const chunkLayerColorTints: Array<string | null> = []
      const chunkLayerUvScales: Array<{ x: number; y: number } | null> = []
      const maskCanvases = createMaskCanvasSet(size, activeLayerCount)
      if (!maskCanvases) {
        continue
      }

      for (let entryIndex = 0; entryIndex < chunkLayers.length; entryIndex += 1) {
        const layerEntry = chunkLayers[entryIndex]!
        const landform = layerEntry.node
        const targetLayer = layerEntry.layer
        const props = resolveLandformMaterialProps(landform, targetLayer?.materialConfigId ?? targetLayer?.id ?? null)
        if (!props) {
          continue
        }
        const landformColor = parseColor(props.color)
        const opacity = clamp(Number(props.opacity) || 1, 0, 1)
        const roughness = clamp(Number(props.roughness) || 1, 0, 1)
        const metalness = clamp(Number(props.metalness) || 0, 0, 1)
        const aoStrength = clamp(Number(props.aoStrength) || 1, 0, 1)
        const emissive = parseColor(props.emissive, '#000000')
        const emissiveIntensity = Math.max(0, Number(props.emissiveIntensity) || 0)
        const albedoTextureRef = resolveMaterialTextureRef(props, 'albedo')
        const normalTextureRef = resolveMaterialTextureRef(props, 'normal')
        const roughnessTextureRef = resolveMaterialTextureRef(props, 'roughness')
        const metalnessTextureRef = resolveMaterialTextureRef(props, 'metalness')
        const aoTextureRef = resolveMaterialTextureRef(props, 'ao')
        const emissiveTextureRef = resolveMaterialTextureRef(props, 'emissive')

        const landformMesh = landform.dynamicMesh as LandformDynamicMesh | null | undefined
        const layerFeatherEnabled = typeof targetLayer.enableFeather === 'boolean'
          ? targetLayer.enableFeather
          : Boolean(landformMesh?.enableFeather)
        const layerFeatherWidth = Number.isFinite(targetLayer.feather)
          ? Number(targetLayer.feather)
          : Number(landformMesh?.feather ?? 0)
        const featherRatio = clamp(layerFeatherWidth > 0 ? layerFeatherWidth / Math.max(chunkWidth, chunkDepth) : 0, 0, 0.65)
        const alpha = clamp(layerFeatherEnabled ? Math.max(0.45, 1 - featherRatio * 0.55) : 1, 0, 1)
        const layerIndex = Math.min(maskCanvases.length - 1, entryIndex)
        const maskContext = maskCanvases[layerIndex]?.context ?? null
        const primaryTextureAssetId = resolveTextureAssetId(albedoTextureRef)
          ?? (Array.isArray(targetLayer?.textureAssetIds) ? targetLayer.textureAssetIds[0] ?? null : null)
        const primaryTextureRuntimeSource = primaryTextureAssetId
          ? await resolveLayerTextureRuntimeSource(scene, primaryTextureAssetId, layerTextureRuntimeSourceCache)
          : null
        chunkLayerTextureAssetIds.push(primaryTextureRuntimeSource)
        chunkLayerColorTints.push(landformColor)
        chunkLayerUvScales.push(targetLayer?.uvScale && Number(targetLayer.uvScale.x) > 0 && Number(targetLayer.uvScale.y) > 0
          ? { x: Number(targetLayer.uvScale.x), y: Number(targetLayer.uvScale.y) }
          : { x: Math.max(chunkWidth, 1e-6), y: Math.max(chunkDepth, 1e-6) })
        const loadedLayerTexture = primaryTextureAssetId
          ? await loadLayerTextureImage(scene, primaryTextureAssetId, layerTextureCache)
          : null
        const loadedNormalTexture = resolveTextureAssetId(normalTextureRef)
          ? await loadLayerTextureImage(scene, resolveTextureAssetId(normalTextureRef), layerTextureCache)
          : null
        const loadedRoughnessTexture = resolveTextureAssetId(roughnessTextureRef)
          ? await loadLayerTextureImage(scene, resolveTextureAssetId(roughnessTextureRef), layerTextureCache)
          : null
        const loadedMetalnessTexture = resolveTextureAssetId(metalnessTextureRef)
          ? await loadLayerTextureImage(scene, resolveTextureAssetId(metalnessTextureRef), layerTextureCache)
          : null
        const loadedAoTexture = resolveTextureAssetId(aoTextureRef)
          ? await loadLayerTextureImage(scene, resolveTextureAssetId(aoTextureRef), layerTextureCache)
          : null
        const loadedEmissiveTexture = resolveTextureAssetId(emissiveTextureRef)
          ? await loadLayerTextureImage(scene, resolveTextureAssetId(emissiveTextureRef), layerTextureCache)
          : null
        const albedoTilePixels = getLayerTileSizePixels(targetLayer, chunkWidth, chunkDepth, size.width, size.height, albedoTextureRef)
        const normalTilePixels = getLayerTileSizePixels(targetLayer, chunkWidth, chunkDepth, size.width, size.height, normalTextureRef)
        const roughnessTilePixels = getLayerTileSizePixels(targetLayer, chunkWidth, chunkDepth, size.width, size.height, roughnessTextureRef)
        const metalnessTilePixels = getLayerTileSizePixels(targetLayer, chunkWidth, chunkDepth, size.width, size.height, metalnessTextureRef)
        const aoTilePixels = getLayerTileSizePixels(targetLayer, chunkWidth, chunkDepth, size.width, size.height, aoTextureRef)
        const emissiveTilePixels = getLayerTileSizePixels(targetLayer, chunkWidth, chunkDepth, size.width, size.height, emissiveTextureRef)

        draw.albedo.save()
        draw.albedo.fillStyle = landformColor
        draw.normal.save()
        draw.roughness.save()
        draw.metalness.save()
        draw.ao.save()
        draw.emissive.save()
        const paintGeometries = collectLandformChunkPaintGeometries(layerEntry, chunkBounds)
        let paintedTriangleCount = 0
        for (const geometry of paintGeometries) {
          const vertices = geometry.vertices
          const indices = geometry.indices
          if (!vertices.length || indices.length < 3) {
            continue
          }
          const localPoints = vertices.map((vertex) => ({
            x: ((vertex.x - minX) / chunkWidth) * size.width,
            y: ((chunkMaxZ - vertex.z) / chunkDepth) * size.height,
          }))
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
            if (loadedLayerTexture) {
              paintTiledTextureIntoTriangle(draw.albedo, loadedLayerTexture, [p0, p1, p2], {
                alpha: alpha * opacity,
                tintColor: landformColor,
                tintOpacity: 1,
                tintBlendMode: 'multiply',
                tilePixels: albedoTilePixels,
                textureRef: albedoTextureRef,
              })
            } else {
              drawTriangleMask(draw.albedo, [p0, p1, p2], alpha * opacity, landformColor)
            }
            if (applyDebugTint) {
              drawTriangleMask(draw.albedo, [p0, p1, p2], GROUNDSPLAT_DEBUG_TINT_ALPHA, GROUNDSPLAT_DEBUG_TINT)
            }
            if (loadedNormalTexture) {
              paintTiledTextureIntoTriangle(draw.normal, loadedNormalTexture, [p0, p1, p2], {
                alpha: 1,
                tilePixels: normalTilePixels,
                textureRef: normalTextureRef,
              })
            } else {
              drawTriangleMask(draw.normal, [p0, p1, p2], 1, 'rgb(128, 128, 255)')
            }
            if (loadedRoughnessTexture) {
              paintTiledTextureIntoTriangle(draw.roughness, loadedRoughnessTexture, [p0, p1, p2], {
                alpha: 1,
                tilePixels: roughnessTilePixels,
                textureRef: roughnessTextureRef,
              })
              paintScalarTextureTint(draw.roughness, [p0, p1, p2], scaleColor('#ffffff', roughness), 1)
            } else {
              drawTriangleMask(draw.roughness, [p0, p1, p2], roughness, 'rgb(255, 255, 255)')
            }
            if (loadedMetalnessTexture) {
              paintTiledTextureIntoTriangle(draw.metalness, loadedMetalnessTexture, [p0, p1, p2], {
                alpha: 1,
                tilePixels: metalnessTilePixels,
                textureRef: metalnessTextureRef,
              })
              paintScalarTextureTint(draw.metalness, [p0, p1, p2], scaleColor('#ffffff', metalness), 1)
            } else {
              drawTriangleMask(draw.metalness, [p0, p1, p2], metalness, 'rgb(255, 255, 255)')
            }
            if (loadedAoTexture) {
              paintTiledTextureIntoTriangle(draw.ao, loadedAoTexture, [p0, p1, p2], {
                alpha: 1,
                tilePixels: aoTilePixels,
                textureRef: aoTextureRef,
              })
              paintScalarTextureTint(draw.ao, [p0, p1, p2], scaleColor('#ffffff', aoStrength), 1)
            } else {
              drawTriangleMask(draw.ao, [p0, p1, p2], aoStrength, 'rgb(255, 255, 255)')
            }
            if (loadedEmissiveTexture) {
              paintTiledTextureIntoTriangle(draw.emissive, loadedEmissiveTexture, [p0, p1, p2], {
                alpha: 1,
                tilePixels: emissiveTilePixels,
                textureRef: emissiveTextureRef,
              })
              paintScalarTextureTint(draw.emissive, [p0, p1, p2], scaleColor(emissive, emissiveIntensity), 1)
            } else {
              drawTriangleMask(draw.emissive, [p0, p1, p2], Math.min(1, emissiveIntensity), scaleColor(emissive, 1))
            }
            if (maskContext) {
              drawTriangleMask(maskContext, [p0, p1, p2], alpha * opacity, '#ffffff')
            }
          }
        }
        draw.albedo.restore()
        draw.normal.restore()
        draw.roughness.restore()
        draw.metalness.restore()
        draw.ao.restore()
        draw.emissive.restore()
      }

      const maskImages = await Promise.all(maskCanvases.map(({ canvas }) => canvasToImageData(canvas)))
      const splat0 = createCanvas(size.width, size.height)
      const splat1 = createCanvas(size.width, size.height)
      if (!splat0 || !splat1) {
        continue
      }
      const splat0Data = splat0.context.createImageData(size.width, size.height)
      const splat1Data = splat1.context.createImageData(size.width, size.height)
      const splat0Buffer = splat0Data.data
      const splat1Buffer = splat1Data.data
      const emptyMask = new Uint8ClampedArray(size.width * size.height * 4)
      const packTargets = [splat0Buffer, splat1Buffer]
      for (let channel = 0; channel < 8; channel += 1) {
        const mask = maskImages[channel] ?? { data: emptyMask, width: size.width, height: size.height } as ImageData
        const target = packTargets[Math.floor(channel / 4)]
        if (!target) {
          continue
        }
        packMaskChannel(target, size.width, size.height, mask, channel % 4)
      }
      splat0.context.putImageData(splat0Data, 0, 0)
      splat1.context.putImageData(splat1Data, 0, 0)

      const [albedoBlob, normalBlob, roughnessBlob, metalnessBlob, aoBlob, emissiveBlob, splat0Blob, splat1Blob] = await Promise.all([
        canvasToBlob(canvases.albedo.canvas),
        canvasToBlob(canvases.normal.canvas),
        canvasToBlob(canvases.roughness.canvas),
        canvasToBlob(canvases.metalness.canvas),
        canvasToBlob(canvases.ao.canvas),
        canvasToBlob(canvases.emissive.canvas),
        canvasToBlob(splat0.canvas),
        canvasToBlob(splat1.canvas),
      ])
      const nextChunkRef: GroundSurfaceChunkTextureRef = {
        textureAssetId: albedoBlob ? (await blobToDataUrl(albedoBlob)) : null,
        normalTextureAssetId: normalBlob ? await blobToDataUrl(normalBlob) : null,
        roughnessTextureAssetId: roughnessBlob ? await blobToDataUrl(roughnessBlob) : null,
        metalnessTextureAssetId: metalnessBlob ? await blobToDataUrl(metalnessBlob) : null,
        aoTextureAssetId: aoBlob ? await blobToDataUrl(aoBlob) : null,
        emissiveTextureAssetId: emissiveBlob ? await blobToDataUrl(emissiveBlob) : null,
        splatMapAssetIds: [
          splat0Blob ? await blobToDataUrl(splat0Blob) : null,
          splat1Blob ? await blobToDataUrl(splat1Blob) : null,
        ].filter((value): value is string => typeof value === 'string' && value.length > 0),
        layerTextureAssetIds: chunkLayerTextureAssetIds,
        layerColorTints: chunkLayerColorTints,
        layerUvScales: chunkLayerUvScales,
        revision: Date.now(),
      }
      nextChunks[chunkKey] = nextChunkRef
    }

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
