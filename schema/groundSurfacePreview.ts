import * as THREE from 'three'
import type { GroundDynamicMesh, SceneNode, TerrainPaintBlendMode, TerrainPaintLayerDefinition } from './index'
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
import type { TerrainPaintLoaders } from './terrainPaintPreview'
import { resolveGroundChunkCells } from './groundMesh'

const DEFAULT_GROUND_SURFACE_PREVIEW_MAX_RESOLUTION = 1024
const MIN_GROUND_SURFACE_PREVIEW_RESOLUTION = 256
const groundSurfacePreviewRequests = new Map<string, Promise<THREE.Texture | null>>()
const DEFAULT_GROUND_SURFACE_PREVIEW_BACKGROUND = '#ffffff'

type Canvas2DContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

type CanvasLike = OffscreenCanvas | HTMLCanvasElement

type ImageDataSource = {
  width: number
  height: number
  data: Uint8ClampedArray
}

type LoadedPreviewImage = {
  source: CanvasImageSource
  imageData: ImageDataSource
}

export type GroundSurfacePreviewLoaders = TerrainPaintLoaders & LandformsPreviewLoaders & {
  loadGroundSurfaceBaseTextureFromUrl: (url: string) => Promise<THREE.Texture | null>
}

export type GroundSurfacePreviewOptions = {
  maxResolution?: number
  liveChunkPagesByKey?: Map<string, Uint8ClampedArray[]>
  previewRevision?: number
  applyToMaterialMap?: boolean
}

const GROUND_SURFACE_PREVIEW_ORIGINAL_MAP_KEY = '__groundSurfacePreviewOriginalMap'
const GROUND_SURFACE_PREVIEW_MAP_ACTIVE_KEY = '__groundSurfacePreviewMapActive'

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

function terrainPaintChannelIndex(channel: TerrainPaintLayerDefinition['channel']): number {
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

function loadImageDataFromTexture(texture: THREE.Texture | null): LoadedPreviewImage | null {
  const source = (texture?.image as CanvasImageSource | undefined) ?? null
  if (!source) {
    return null
  }
  const imageData = extractImageDataFromSource(source)
  if (!imageData) {
    return null
  }
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
    material.map = texture
    material.needsUpdate = true
  })
}

export function restoreGroundSurfacePreviewMaterialMap(root: THREE.Object3D | null | undefined): void {
  if (!root) {
    return
  }
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
  const top: [number, number, number, number] = [mix(c00[0], c10[0], tx), mix(c00[1], c10[1], tx), mix(c00[2], c10[2], tx), mix(c00[3], c10[3], tx)]
  const bottom: [number, number, number, number] = [mix(c01[0], c11[0], tx), mix(c01[1], c11[1], tx), mix(c01[2], c11[2], tx), mix(c01[3], c11[3], tx)]
  return [mix(top[0], bottom[0], ty), mix(top[1], bottom[1], ty), mix(top[2], bottom[2], ty), mix(top[3], bottom[3], ty)]
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
      return [1 - (1 - baseColor[0]) * (1 - layerColor[0]), 1 - (1 - baseColor[1]) * (1 - layerColor[1]), 1 - (1 - baseColor[2]) * (1 - layerColor[2])]
    case 'overlay':
      return [overlayChannel(baseColor[0], layerColor[0]), overlayChannel(baseColor[1], layerColor[1]), overlayChannel(baseColor[2], layerColor[2])]
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

function buildGroundSurfacePreviewSignature(groundNode: SceneNode, definition: GroundDynamicMesh, options: GroundSurfacePreviewOptions): string {
  const component = resolveEnabledComponentState<LandformsComponentProps>(groundNode, LANDFORMS_COMPONENT_TYPE)
  const props = component ? clampLandformsComponentProps(component.props) : { layers: [] }
  const terrainPaint = definition.terrainPaint ?? null
  const liveKeys = options.liveChunkPagesByKey ? Array.from(options.liveChunkPagesByKey.keys()).sort() : []
  return stableSerialize({
    width: normalizeDimension(definition.width),
    depth: normalizeDimension(definition.depth),
    textureDataUrl: definition.textureDataUrl ?? null,
    terrainPaint,
    landforms: props.layers.filter((layer) => layer.enabled && typeof layer.assetId === 'string' && layer.assetId.trim().length),
    liveChunkKeys: liveKeys,
    previewRevision: options.previewRevision ?? 0,
    maxResolution: options.maxResolution ?? DEFAULT_GROUND_SURFACE_PREVIEW_MAX_RESOLUTION,
  })
}

async function composeGroundSurfacePreviewTexture(
  groundNode: SceneNode,
  definition: GroundDynamicMesh,
  loaders: GroundSurfacePreviewLoaders,
  options: GroundSurfacePreviewOptions,
): Promise<THREE.Texture | null> {
  const composition = createCompositionCanvas(
    computePreviewTextureSize(definition, options.maxResolution ?? DEFAULT_GROUND_SURFACE_PREVIEW_MAX_RESOLUTION).width,
    computePreviewTextureSize(definition, options.maxResolution ?? DEFAULT_GROUND_SURFACE_PREVIEW_MAX_RESOLUTION).height,
  )
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

  const terrainPaint = definition.terrainPaint ?? null
  if (terrainPaint && terrainPaint.version === 2 && Array.isArray(terrainPaint.layers) && terrainPaint.layers.length) {
    const sortedLayers = [...terrainPaint.layers].sort((left, right) => getTerrainPaintLayerSlotIndex(left) - getTerrainPaintLayerSlotIndex(right))
    const layerImages = new Map<string, LoadedPreviewImage>()
    for (const layer of sortedLayers) {
      const assetId = typeof layer.textureAssetId === 'string' ? layer.textureAssetId.trim() : ''
      if (!assetId || layerImages.has(assetId)) {
        continue
      }
      const texture = await loaders.loadTerrainPaintTextureFromAssetId(assetId, { colorSpace: 'srgb' })
      const loaded = loadImageDataFromTexture(texture)
      if (loaded) {
        layerImages.set(assetId, loaded)
      }
    }
    const output = context.getImageData(0, 0, width, height)
    const outputData = output.data
    const groundWidth = Math.max(1e-6, normalizeDimension(definition.width))
    const groundDepth = Math.max(1e-6, normalizeDimension(definition.depth))
    const halfWidth = groundWidth * 0.5
    const halfDepth = groundDepth * 0.5
    const persistedChunkEntries = Object.entries(terrainPaint.chunks ?? {})
    const liveChunkEntries = options.liveChunkPagesByKey
      ? Array.from(options.liveChunkPagesByKey.keys()).map((chunkKey) => [chunkKey, null] as const)
      : []
    const chunkEntries = new Map<string, { pages?: Array<{ logicalId: string }> } | null>()
    persistedChunkEntries.forEach(([chunkKey, chunkRef]) => {
      chunkEntries.set(chunkKey, chunkRef)
    })
    liveChunkEntries.forEach(([chunkKey]) => {
      if (!chunkEntries.has(chunkKey)) {
        chunkEntries.set(chunkKey, null)
      }
    })
    for (const [chunkKey, chunkRef] of chunkEntries.entries()) {
      const [rowText, colText] = chunkKey.split(':')
      const chunkRow = Number.parseInt(rowText ?? '', 10)
      const chunkColumn = Number.parseInt(colText ?? '', 10)
      if (!Number.isFinite(chunkRow) || !Number.isFinite(chunkColumn)) {
        continue
      }
      const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
      const chunkCells = Math.max(1, resolveGroundChunkCells(definition))
      const startColumn = chunkColumn * chunkCells
      const startRow = chunkRow * chunkCells
      const effectiveColumns = Math.max(0, Math.min(chunkCells, Math.max(0, definition.columns - startColumn)))
      const effectiveRows = Math.max(0, Math.min(chunkCells, Math.max(0, definition.rows - startRow)))
      const chunkWidth = effectiveColumns * cellSize
      const chunkDepth = effectiveRows * cellSize
      if (!(chunkWidth > 0) || !(chunkDepth > 0)) {
        continue
      }
      const minX = -definition.width * 0.5 + startColumn * cellSize
      const minZ = -definition.depth * 0.5 + startRow * cellSize
      const startX = Math.max(0, Math.floor(((minX + halfWidth) / groundWidth) * width))
      const endX = Math.min(width, Math.ceil(((minX + chunkWidth + halfWidth) / groundWidth) * width))
      const startY = Math.max(0, Math.floor(((minZ + halfDepth) / groundDepth) * height))
      const endY = Math.min(height, Math.ceil(((minZ + chunkDepth + halfDepth) / groundDepth) * height))
      if (startX >= endX || startY >= endY) {
        continue
      }
      const livePages = options.liveChunkPagesByKey?.get(chunkKey) ?? null
      const persistedPages = Array.isArray(chunkRef?.pages) ? chunkRef.pages : []
      const resolvedPages: Array<Uint8ClampedArray | null> = []
      const pageCount = Math.max(livePages?.length ?? 0, persistedPages.length)
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        const livePage = livePages?.[pageIndex] ?? null
        if (livePage) {
          resolvedPages.push(livePage)
          continue
        }
        const logicalId = typeof persistedPages[pageIndex]?.logicalId === 'string' ? persistedPages[pageIndex]!.logicalId.trim() : ''
        if (!logicalId) {
          resolvedPages.push(null)
          continue
        }
        resolvedPages.push(await loaders.loadTerrainPaintWeightmapDataFromAssetId(logicalId, terrainPaint.weightmapResolution))
      }
      for (let y = startY; y < endY; y += 1) {
        const worldZ = ((y + 0.5) / height) * groundDepth - halfDepth
        const meshV = clamp01((worldZ - minZ) / Math.max(1e-6, chunkDepth))
        const groundV = clamp01((worldZ + halfDepth) / groundDepth)
        for (let x = startX; x < endX; x += 1) {
          const worldX = ((x + 0.5) / width) * groundWidth - halfWidth
          const meshU = clamp01((worldX - minX) / Math.max(1e-6, chunkWidth))
          const groundU = clamp01((worldX + halfWidth) / groundWidth)
          const pixelOffset = (y * width + x) * 4
          let color: [number, number, number] = [
            (outputData[pixelOffset] ?? 255) / 255,
            (outputData[pixelOffset + 1] ?? 255) / 255,
            (outputData[pixelOffset + 2] ?? 255) / 255,
          ]
          for (const layer of sortedLayers) {
            const assetId = typeof layer.textureAssetId === 'string' ? layer.textureAssetId.trim() : ''
            const texture = assetId ? layerImages.get(assetId) : null
            if (!texture) {
              continue
            }
            const weight = readWeightValue(
              resolvedPages[layer.pageIndex] ?? null,
              terrainPaint.weightmapResolution,
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
            color = [
              blended[0] * layerAlpha + color[0] * (1 - layerAlpha),
              blended[1] * layerAlpha + color[1] * (1 - layerAlpha),
              blended[2] * layerAlpha + color[2] * (1 - layerAlpha),
            ]
          }
          outputData[pixelOffset] = Math.round(clamp01(color[0]) * 255)
          outputData[pixelOffset + 1] = Math.round(clamp01(color[1]) * 255)
          outputData[pixelOffset + 2] = Math.round(clamp01(color[2]) * 255)
          outputData[pixelOffset + 3] = 255
        }
      }
    }
    context.putImageData(output, 0, 0)
  }

  const previewTexture = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement)
  previewTexture.wrapS = THREE.ClampToEdgeWrapping
  previewTexture.wrapT = THREE.ClampToEdgeWrapping
  previewTexture.minFilter = THREE.LinearFilter
  previewTexture.magFilter = THREE.LinearFilter
  ;(previewTexture as any).colorSpace = (THREE as any).SRGBColorSpace ?? (previewTexture as any).colorSpace
  previewTexture.needsUpdate = true
  return previewTexture
}

export function createDefaultGroundSurfacePreviewLoaders(
  resolveAssetUrlFromCache: (assetId: string) => Promise<{ url: string | null } | null>,
): GroundSurfacePreviewLoaders {
  const textureLoader = new THREE.TextureLoader()
  const terrainLoader: TerrainPaintLoaders = {
    async loadTerrainPaintTextureFromAssetId(assetId, options) {
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
        return texture
      } catch (error) {
        console.warn('[groundSurfacePreview] Failed to load terrain paint texture', assetId, error)
        return null
      }
    },
    async loadTerrainPaintWeightmapDataFromAssetId(assetId, resolution) {
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
        const expectedLength = Math.max(1, Math.round(resolution)) * Math.max(1, Math.round(resolution)) * 4
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
        return null
      }
    },
  }

  const landformsLoader: LandformsPreviewLoaders = {
    async loadLandformsTextureFromAssetId(assetId) {
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
        return null
      }
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
      try {
        const texture = await textureLoader.loadAsync(normalized)
        ;(texture as any).colorSpace = (THREE as any).SRGBColorSpace ?? (texture as any).colorSpace
        texture.needsUpdate = true
        return texture
      } catch (error) {
        console.warn('[groundSurfacePreview] Failed to load ground base texture', normalized, error)
        return null
      }
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
  const hasTerrainPaint = Boolean(dynamicMesh.terrainPaint?.layers?.length)
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
    return true
  }
  const token = getToken()
  let pending = groundSurfacePreviewRequests.get(signature)
  if (!pending) {
    pending = composeGroundSurfacePreviewTexture(groundNode, dynamicMesh, loaders, options)
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
      liveChunkCount: options.liveChunkPagesByKey?.size ?? 0,
    })
    if (options.applyToMaterialMap === true) {
      applyGroundSurfacePreviewToMaterialMap(groundObject, texture)
    }
    setLandformsPreviewTexture(groundObject, signature, texture)
  }).catch((error) => {
    groundSurfacePreviewRequests.delete(signature)
    console.warn('[groundSurfacePreview] Failed to compose surface preview texture', error)
  })
  return true
}
