import type { GroundDynamicMesh, GroundSurfaceChunkTextureMap, GroundSurfaceChunkTextureRef, LandformDynamicMesh, SceneMaterialProps, SceneNode } from '@schema/core'
import { resolveGroundChunkBounds, resolveGroundWorldBounds } from '@schema/core'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import type { StoredSceneDocument } from '@/types/stored-scene-document'

type CanvasLike = OffscreenCanvas | HTMLCanvasElement
type Canvas2DContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
type ImageDataSource = {
  width: number
  height: number
  data: Uint8ClampedArray
}
type LandformBakeEntry = {
  node: SceneNode
  layer: LandformSurfaceLayerLike
  order: number
  nodeOrder: number
}

type LoadedBakedImage = {
  source: CanvasImageSource
  imageData: ImageDataSource
}

export type LandformGroundBakeOptions = {
  maxTextureSize?: number
}

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
  const visit = (items: SceneNode[]): void => {
    for (const node of items ?? []) {
      if (!node) {
        continue
      }
      if (node.dynamicMesh?.type === 'Landform') {
        out.push(node)
      }
      if (Array.isArray(node.children) && node.children.length) {
        visit(node.children)
      }
    }
  }
  visit(nodes)
  return out
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
): { width: number; height: number } {
  const uvScale = layer.uvScale
  const repeatWidthMeters = Number(uvScale?.x) > 0 ? Number(uvScale?.x) : Math.max(chunkWidth, 1e-6)
  const repeatHeightMeters = Number(uvScale?.y) > 0 ? Number(uvScale?.y) : Math.max(chunkDepth, 1e-6)
  return {
    width: Math.max(1, Math.round((repeatWidthMeters / Math.max(chunkWidth, 1e-6)) * canvasWidth)),
    height: Math.max(1, Math.round((repeatHeightMeters / Math.max(chunkDepth, 1e-6)) * canvasHeight)),
  }
}

function paintTiledTextureIntoTriangle(
  context: Canvas2DContext,
  source: LoadedBakedImage,
  triangle: Array<{ x: number; y: number }>,
  alpha: number,
  tintColor: string,
  tilePixels: { width: number; height: number },
): void {
  const bounds = computeTriangleBounds(triangle)
  if (!bounds) {
    return
  }
  const tileWidth = Math.max(1, tilePixels.width)
  const tileHeight = Math.max(1, tilePixels.height)
  context.save()
  context.beginPath()
  context.moveTo(triangle[0]!.x, triangle[0]!.y)
  context.lineTo(triangle[1]!.x, triangle[1]!.y)
  context.lineTo(triangle[2]!.x, triangle[2]!.y)
  context.closePath()
  context.clip()
  context.globalAlpha = clamp(alpha, 0, 1)
  const startX = Math.floor(bounds.minX / tileWidth) * tileWidth
  const startY = Math.floor(bounds.minY / tileHeight) * tileHeight
  for (let y = startY; y < bounds.maxY + tileHeight; y += tileHeight) {
    for (let x = startX; x < bounds.maxX + tileWidth; x += tileWidth) {
      context.drawImage(
        source.source,
        x,
        y,
        tileWidth,
        tileHeight,
      )
    }
  }
  context.globalAlpha = clamp(alpha * 0.28, 0, 1)
  context.fillStyle = tintColor
  context.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
  context.restore()
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

function collectLandformBakeEntries(nodes: SceneNode[]): LandformBakeEntry[] {
  const entries: LandformBakeEntry[] = []
  const visit = (items: SceneNode[], parentOrderBase = 0): void => {
    items.forEach((node, index) => {
      if (!node) {
        return
      }
      const nodeOrder = parentOrderBase + index
      if (node.dynamicMesh?.type === 'Landform') {
        const layers = resolveLandformSurfaceLayers(node)
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
          })
        } else {
          layers.forEach((layer) => {
            entries.push({
              node,
              layer,
              order: Number.isFinite(layer.order) ? Number(layer.order) : nodeOrder,
              nodeOrder,
            })
          })
        }
      }
      if (Array.isArray(node.children) && node.children.length) {
        visit(node.children, nodeOrder * 1000)
      }
    })
  }
  visit(nodes)
  return entries.sort((a, b) => a.order - b.order || a.nodeOrder - b.nodeOrder || a.layer.id.localeCompare(b.layer.id))
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

function getSurfaceVertices(node: SceneNode): Array<{ x: number; y: number; z: number }> {
  const renderCache = node.dynamicMesh?.type === 'Landform'
    ? (node.dynamicMesh.renderCache ?? null)
    : null
  return Array.isArray(renderCache?.surfaceVertices)
    ? renderCache.surfaceVertices
        .map((entry) => ({
          x: Number((entry as any)?.x) || 0,
          y: Number((entry as any)?.y) || 0,
          z: Number((entry as any)?.z) || 0,
        }))
        .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.z))
    : []
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
  return `${Math.trunc(chunkRow)}:${Math.trunc(chunkColumn)}`
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
    target[dstOffset] = Math.max(target[dstOffset] ?? 0, source.data[srcOffset] ?? 0)
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
  const landformNodes = getGroundLandformNodes(scene.nodes)
  if (!landformNodes.length) {
    return null
  }
  const landformEntries = collectLandformBakeEntries(scene.nodes)
  if (!landformEntries.length) {
    return null
  }

  const bounds = resolveGroundWorldBounds(definition)
  const chunkBounds = resolveGroundChunkBounds(definition)
  if (!chunkBounds) {
    return null
  }

  const chunkSizeMetersValue = Number(definition.chunkSizeMeters ?? 0)
  const chunkSizeMeters = Number.isFinite(chunkSizeMetersValue) && chunkSizeMetersValue > 0
    ? chunkSizeMetersValue
    : 100
  const maxTextureSize = Math.max(128, Math.round(options.maxTextureSize ?? 1024))
  const nextChunks: GroundSurfaceChunkTextureMap = {}
  const layerTextureCache = new Map<string, Promise<LoadedBakedImage | null>>()

  for (let chunkRow = chunkBounds.minChunkZ; chunkRow <= chunkBounds.maxChunkZ; chunkRow += 1) {
    for (let chunkColumn = chunkBounds.minChunkX; chunkColumn <= chunkBounds.maxChunkX; chunkColumn += 1) {
      const minX = bounds.minX + (chunkColumn * chunkSizeMeters)
      const minZ = bounds.minZ + (chunkRow * chunkSizeMeters)
      const chunkWidth = Math.max(1e-6, Math.min(chunkSizeMeters, bounds.maxX - minX))
      const chunkDepth = Math.max(1e-6, Math.min(chunkSizeMeters, bounds.maxZ - minZ))
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
      const chunkKey = resolveChunkKey(chunkRow, chunkColumn)
      const draw = {
        albedo: canvases.albedo.context,
        normal: canvases.normal.context,
        roughness: canvases.roughness.context,
        metalness: canvases.metalness.context,
        ao: canvases.ao.context,
        emissive: canvases.emissive.context,
      }

      draw.albedo.fillStyle = '#ffffff'
      draw.albedo.fillRect(0, 0, size.width, size.height)
      draw.normal.fillStyle = 'rgb(128, 128, 255)'
      draw.normal.fillRect(0, 0, size.width, size.height)
      draw.roughness.fillStyle = 'rgb(255, 255, 255)'
      draw.roughness.fillRect(0, 0, size.width, size.height)
      draw.metalness.fillStyle = 'rgb(0, 0, 0)'
      draw.metalness.fillRect(0, 0, size.width, size.height)
      draw.ao.fillStyle = 'rgb(255, 255, 255)'
      draw.ao.fillRect(0, 0, size.width, size.height)
      draw.emissive.fillStyle = 'rgb(0, 0, 0)'
      draw.emissive.fillRect(0, 0, size.width, size.height)

      const chunkMaxX = minX + chunkWidth
      const chunkMaxZ = minZ + chunkDepth
      const chunkLandforms = landformEntries.filter((entry) => {
        const vertices = getSurfaceVertices(entry.node)
        return vertices.some((vertex) => vertex.x >= minX && vertex.x <= chunkMaxX && vertex.z >= minZ && vertex.z <= chunkMaxZ)
      })
      if (!chunkLandforms.length) {
        continue
      }

      const chunkLayers = chunkLandforms
        .slice()
        .sort((a, b) => a.order - b.order || a.nodeOrder - b.nodeOrder || a.layer.id.localeCompare(b.layer.id))
        .slice(0, 8)
      const activeLayerCount = Math.min(8, Math.max(1, chunkLayers.length))
      const maskCanvases = createMaskCanvasSet(size, activeLayerCount)
      if (!maskCanvases) {
        continue
      }

      for (let entryIndex = 0; entryIndex < chunkLayers.length; entryIndex += 1) {
        const layerEntry = chunkLayers[entryIndex]!
        const landform = layerEntry.node
        const vertices = getSurfaceVertices(landform)
        const indices = getSurfaceIndices(landform)
        const targetLayer = layerEntry.layer
        const props = resolveLandformMaterialProps(landform, targetLayer?.materialConfigId ?? targetLayer?.id ?? null)
        if (!vertices.length || indices.length < 3 || !props) {
          continue
        }
        const landformColor = parseColor(props.color)
        const roughness = clamp(Number(props.roughness) || 1, 0, 1)
        const metalness = clamp(Number(props.metalness) || 0, 0, 1)
        const aoStrength = clamp(Number(props.aoStrength) || 1, 0, 1)
        const emissive = parseColor(props.emissive, '#000000')

        const localPoints = vertices.map((vertex) => ({
          x: ((vertex.x - minX) / chunkWidth) * size.width,
          y: ((chunkMaxZ - vertex.z) / chunkDepth) * size.height,
        }))
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
        const primaryTextureAssetId = Array.isArray(targetLayer?.textureAssetIds) ? targetLayer.textureAssetIds[0] ?? null : null
        const loadedLayerTexture = primaryTextureAssetId
          ? await loadLayerTextureImage(scene, primaryTextureAssetId, layerTextureCache)
          : null
        const tilePixels = getLayerTileSizePixels(targetLayer, chunkWidth, chunkDepth, size.width, size.height)

        draw.albedo.save()
        draw.albedo.fillStyle = landformColor
        draw.normal.save()
        draw.roughness.save()
        draw.metalness.save()
        draw.ao.save()
        draw.emissive.save()
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
          if (loadedLayerTexture) {
            paintTiledTextureIntoTriangle(draw.albedo, loadedLayerTexture, [p0, p1, p2], alpha, landformColor, tilePixels)
          } else {
            drawTriangleMask(draw.albedo, [p0, p1, p2], alpha, landformColor)
          }
          drawTriangleMask(draw.normal, [p0, p1, p2], 1, 'rgb(128, 128, 255)')
          drawTriangleMask(draw.roughness, [p0, p1, p2], roughness, 'rgb(255, 255, 255)')
          drawTriangleMask(draw.metalness, [p0, p1, p2], metalness, 'rgb(255, 255, 255)')
          drawTriangleMask(draw.ao, [p0, p1, p2], aoStrength, 'rgb(255, 255, 255)')
          drawTriangleMask(draw.emissive, [p0, p1, p2], 1, emissive)
          if (maskContext) {
            drawTriangleMask(maskContext, [p0, p1, p2], alpha, '#ffffff')
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
        revision: Date.now(),
      }
      nextChunks[chunkKey] = nextChunkRef
    }
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

  const baked = await bakeLandformGroundSurfaceChunks(scene, groundNode.dynamicMesh, options)
  if (!baked) {
    groundNode.dynamicMesh = {
      ...groundNode.dynamicMesh,
      groundSurfaceChunks: null,
      groundSplatBake: null,
    }
    return null
  }
  const landformNodes = getGroundLandformNodes(scene.nodes ?? [])
  const layerTextureAssetIds = Array.from(new Set(
    landformNodes.flatMap((node) => collectSurfaceLayerTextureAssetIds(resolveLandformSurfaceLayers(node))),
  ))

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
