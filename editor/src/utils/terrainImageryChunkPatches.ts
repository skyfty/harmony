import type { ProjectAsset } from '@/types/project-asset'
import type { PlanningTerrainDemData } from '@/types/planning-scene-data'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { computeBlobHash } from '@/utils/blob'
import { loadPlanningDemBlobByHash } from '@/utils/planningDemStorage'
import type { AssetSourceMetadata, GroundDynamicMesh, GroundSurfaceChunkTextureMap } from '@schema/core'
import {
  formatTerrainPaintChunkKey,
  resolveGroundWorldBounds,
  resolveGroundWorkingGridSize,
  resolveTerrainPaintChunkBounds,
} from '@schema/core'
import { resolveGroundChunkCells } from '@schema/groundMesh'

type CanvasLike = OffscreenCanvas | HTMLCanvasElement
type Canvas2DContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export type TerrainImageryChunkPatchResult = {
  groundSurfaceChunks: GroundSurfaceChunkTextureMap | null
  generatedChunkCount: number
  coverageChunkCount: number
  staleAssetIds: string[]
}

export type TerrainImageryChunkCleanupResult = {
  groundSurfaceChunks: GroundSurfaceChunkTextureMap | null
  removedAssetIds: string[]
  removedChunkCount: number
}

type WorldRect = {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

type DecodedImageSource = {
  source: CanvasImageSource
  width: number
  height: number
  close?: () => void
}

type EdgeFeatherOptions = {
  fadeLeft: boolean
  fadeTop: boolean
  fadeRight: boolean
  fadeBottom: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function createCanvas(width: number, height: number): { canvas: CanvasLike; context: Canvas2DContext } | null {
  const safeWidth = Math.max(1, Math.round(width))
  const safeHeight = Math.max(1, Math.round(height))
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(safeWidth, safeHeight)
    const context = canvas.getContext('2d')
    if (context) {
      return { canvas, context }
    }
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas')
    canvas.width = safeWidth
    canvas.height = safeHeight
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

async function decodeImageSource(blob: Blob): Promise<DecodedImageSource> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    }
  }
  if (typeof Image === 'undefined' || typeof URL === 'undefined') {
    throw new Error('Current environment cannot decode terrain orthophoto imagery.')
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      try {
        URL.revokeObjectURL(url)
      } catch {}
      resolve({
        source: image,
        width: Math.max(1, image.naturalWidth || image.width),
        height: Math.max(1, image.naturalHeight || image.height),
      })
    }
    image.onerror = () => {
      try {
        URL.revokeObjectURL(url)
      } catch {}
      reject(new Error('Failed to decode terrain orthophoto image.'))
    }
    image.src = url
  })
}

function resolveOrthophotoCoverageBounds(terrainDem: PlanningTerrainDemData): WorldRect | null {
  const bounds = terrainDem.worldBounds
  if (!bounds) {
    return null
  }
  const minX = Number(bounds.minX)
  const minZ = Number(bounds.minY)
  const maxX = Number(bounds.maxX)
  const maxZ = Number(bounds.maxY)
  if (!Number.isFinite(minX) || !Number.isFinite(minZ) || !Number.isFinite(maxX) || !Number.isFinite(maxZ)) {
    return null
  }
  if (!(maxX > minX) || !(maxZ > minZ)) {
    return null
  }
  return { minX, minZ, maxX, maxZ }
}

function intersectWorldRects(left: WorldRect, right: WorldRect): WorldRect | null {
  const minX = Math.max(left.minX, right.minX)
  const minZ = Math.max(left.minZ, right.minZ)
  const maxX = Math.min(left.maxX, right.maxX)
  const maxZ = Math.min(left.maxZ, right.maxZ)
  if (!(maxX > minX) || !(maxZ > minZ)) {
    return null
  }
  return { minX, minZ, maxX, maxZ }
}

function cloneGroundSurfaceChunks(
  value: GroundSurfaceChunkTextureMap | null | undefined,
): GroundSurfaceChunkTextureMap | null {
  if (!value) {
    return null
  }
  const nextEntries = Object.entries(value).map(([key, chunkRef]) => [key, {
    ...chunkRef,
    textureAssetId: typeof chunkRef?.textureAssetId === 'string' && chunkRef.textureAssetId.trim().length > 0
      ? chunkRef.textureAssetId.trim()
      : null,
    normalTextureAssetId: typeof chunkRef?.normalTextureAssetId === 'string' && chunkRef.normalTextureAssetId.trim().length > 0
      ? chunkRef.normalTextureAssetId.trim()
      : null,
    roughnessTextureAssetId: typeof chunkRef?.roughnessTextureAssetId === 'string' && chunkRef.roughnessTextureAssetId.trim().length > 0
      ? chunkRef.roughnessTextureAssetId.trim()
      : null,
    metalnessTextureAssetId: typeof chunkRef?.metalnessTextureAssetId === 'string' && chunkRef.metalnessTextureAssetId.trim().length > 0
      ? chunkRef.metalnessTextureAssetId.trim()
      : null,
    aoTextureAssetId: typeof chunkRef?.aoTextureAssetId === 'string' && chunkRef.aoTextureAssetId.trim().length > 0
      ? chunkRef.aoTextureAssetId.trim()
      : null,
    emissiveTextureAssetId: typeof chunkRef?.emissiveTextureAssetId === 'string' && chunkRef.emissiveTextureAssetId.trim().length > 0
      ? chunkRef.emissiveTextureAssetId.trim()
      : null,
    splatMapAssetIds: Array.isArray(chunkRef?.splatMapAssetIds)
      ? chunkRef.splatMapAssetIds
          .map((assetId) => (typeof assetId === 'string' ? assetId.trim() : ''))
          .filter((assetId) => assetId.length > 0)
      : null,
    layerTextureAssetIds: Array.isArray(chunkRef?.layerTextureAssetIds)
      ? chunkRef.layerTextureAssetIds
          .map((assetId) => (typeof assetId === 'string' ? assetId.trim() : ''))
          .map((assetId) => assetId.length > 0 ? assetId : null)
      : null,
    layerColorTints: Array.isArray(chunkRef?.layerColorTints)
      ? chunkRef.layerColorTints
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .map((value) => value.length > 0 ? value : null)
      : null,
    layerUvScales: Array.isArray(chunkRef?.layerUvScales)
      ? chunkRef.layerUvScales
          .map((value) => {
            if (!value || typeof value !== 'object') {
              return null
            }
            const x = Number((value as { x?: unknown }).x)
            const y = Number((value as { y?: unknown }).y)
            return Number.isFinite(x) && x > 0 && Number.isFinite(y) && y > 0 ? { x, y } : null
          })
      : null,
    revision: Number.isFinite(chunkRef?.revision) ? Math.max(0, Math.trunc(chunkRef.revision)) : 0,
  }] as const)
  return nextEntries.length ? Object.fromEntries(nextEntries) as GroundSurfaceChunkTextureMap : null
}

function isPlanningTerrainImageryAsset(asset: ProjectAsset | null | undefined): boolean {
  if (!asset) {
    return false
  }
  if (Array.isArray(asset.tags) && asset.tags.includes('terrain-imagery')) {
    return true
  }
  return asset.metadata?.generatedBy === 'planning-terrain-imagery'
}

export function stripPlanningOrthophotoGeneratedGroundSurfaceChunks(options: {
  groundSurfaceChunks: GroundSurfaceChunkTextureMap | null | undefined
  getAsset: (assetId: string) => ProjectAsset | null
}): TerrainImageryChunkCleanupResult {
  const current = cloneGroundSurfaceChunks(options.groundSurfaceChunks)
  if (!current) {
    return {
      groundSurfaceChunks: null,
      removedAssetIds: [],
      removedChunkCount: 0,
    }
  }

  const nextEntries: Array<[string, GroundSurfaceChunkTextureMap[string]]> = []
  const removedAssetIds = new Set<string>()
  let removedChunkCount = 0

  for (const [chunkKey, chunkRef] of Object.entries(current)) {
    const textureAssetId = typeof chunkRef.textureAssetId === 'string' ? chunkRef.textureAssetId.trim() : ''
    if (textureAssetId && isPlanningTerrainImageryAsset(options.getAsset(textureAssetId))) {
      removedAssetIds.add(textureAssetId)
      removedChunkCount += 1
      continue
    }
    nextEntries.push([chunkKey, chunkRef])
  }

  return {
    groundSurfaceChunks: nextEntries.length > 0 ? Object.fromEntries(nextEntries) as GroundSurfaceChunkTextureMap : null,
    removedAssetIds: Array.from(removedAssetIds),
    removedChunkCount,
  }
}

function resolveWorldRectImageSlice(rect: WorldRect, coverage: WorldRect, width: number, height: number) {
  const coverageWidth = Math.max(1e-6, coverage.maxX - coverage.minX)
  const coverageHeight = Math.max(1e-6, coverage.maxZ - coverage.minZ)
  return {
    x: ((rect.minX - coverage.minX) / coverageWidth) * width,
    y: ((rect.minZ - coverage.minZ) / coverageHeight) * height,
    width: ((rect.maxX - rect.minX) / coverageWidth) * width,
    height: ((rect.maxZ - rect.minZ) / coverageHeight) * height,
  }
}

function resolveChunkTextureSize(chunkBounds: WorldRect, coverage: WorldRect, imageWidth: number, imageHeight: number): {
  width: number
  height: number
} {
  const coverageWidth = Math.max(1e-6, coverage.maxX - coverage.minX)
  const coverageHeight = Math.max(1e-6, coverage.maxZ - coverage.minZ)
  const pixelsPerMeterX = imageWidth / coverageWidth
  const pixelsPerMeterZ = imageHeight / coverageHeight
  return {
    width: clamp(Math.round((chunkBounds.maxX - chunkBounds.minX) * pixelsPerMeterX), 32, 2048),
    height: clamp(Math.round((chunkBounds.maxZ - chunkBounds.minZ) * pixelsPerMeterZ), 32, 2048),
  }
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) {
    return value >= edge1 ? 1 : 0
  }
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function applyEdgeFeatherToAlpha(
  context: Canvas2DContext,
  width: number,
  height: number,
  rect: { x: number; y: number; width: number; height: number },
  feather: EdgeFeatherOptions,
): void {
  if (!feather.fadeLeft && !feather.fadeTop && !feather.fadeRight && !feather.fadeBottom) {
    return
  }
  if (!(width > 0) || !(height > 0)) {
    return
  }

  const rectLeft = clamp(Math.floor(rect.x), 0, Math.max(0, width - 1))
  const rectTop = clamp(Math.floor(rect.y), 0, Math.max(0, height - 1))
  const rectRight = clamp(Math.ceil(rect.x + rect.width), rectLeft + 1, width)
  const rectBottom = clamp(Math.ceil(rect.y + rect.height), rectTop + 1, height)
  const rectWidth = rectRight - rectLeft
  const rectHeight = rectBottom - rectTop
  if (!(rectWidth > 0) || !(rectHeight > 0)) {
    return
  }

  const featherPixelsX = clamp(Math.round(rectWidth * 0.12), 12, 96)
  const featherPixelsY = clamp(Math.round(rectHeight * 0.12), 12, 96)
  const imageData = context.getImageData(0, 0, width, height)
  const pixels = imageData.data

  for (let y = rectTop; y < rectBottom; y += 1) {
    for (let x = rectLeft; x < rectRight; x += 1) {
      const alphaIndex = (y * width + x) * 4 + 3
      const originalAlpha = pixels[alphaIndex] ?? 0
      if (originalAlpha <= 0) {
        continue
      }

      let alphaScale = 1
      if (feather.fadeLeft) {
        alphaScale *= smoothstep(0, featherPixelsX, x - rectLeft)
      }
      if (feather.fadeRight) {
        alphaScale *= smoothstep(0, featherPixelsX, rectRight - 1 - x)
      }
      if (feather.fadeTop) {
        alphaScale *= smoothstep(0, featherPixelsY, y - rectTop)
      }
      if (feather.fadeBottom) {
        alphaScale *= smoothstep(0, featherPixelsY, rectBottom - 1 - y)
      }

      pixels[alphaIndex] = Math.round(originalAlpha * clamp(alphaScale, 0, 1))
    }
  }

  context.putImageData(imageData, 0, 0)
}

export async function buildGroundSurfaceChunksFromPlanningOrthophoto(options: {
  terrainDem: PlanningTerrainDemData
  definition: GroundDynamicMesh
  groundNodeId: string
  existingGroundSurfaceChunks?: GroundSurfaceChunkTextureMap | null
  registerAssets: (assets: ProjectAsset[], options?: {
    categoryId?: string | ((asset: ProjectAsset) => string)
    source?: AssetSourceMetadata
    internal?: boolean | ((asset: ProjectAsset) => boolean)
    isEditorOnly?: boolean | ((asset: ProjectAsset) => boolean)
    commitOptions?: { updateNodes?: boolean }
    autoSave?: boolean
  }) => ProjectAsset[]
  revision?: number
}): Promise<TerrainImageryChunkPatchResult> {
  const orthophotoHash = typeof options.terrainDem.orthophoto?.sourceFileHash === 'string'
    ? options.terrainDem.orthophoto.sourceFileHash.trim()
    : ''
  if (!orthophotoHash) {
    return {
      groundSurfaceChunks: cloneGroundSurfaceChunks(options.existingGroundSurfaceChunks),
      generatedChunkCount: 0,
      coverageChunkCount: 0,
      staleAssetIds: [],
    }
  }

  const coverageBounds = resolveOrthophotoCoverageBounds(options.terrainDem)
  if (!coverageBounds) {
    return {
      groundSurfaceChunks: cloneGroundSurfaceChunks(options.existingGroundSurfaceChunks),
      generatedChunkCount: 0,
      coverageChunkCount: 0,
      staleAssetIds: [],
    }
  }

  const orthophotoBlob = await loadPlanningDemBlobByHash(orthophotoHash)
  if (!orthophotoBlob) {
    throw new Error('Planning orthophoto blob is missing from local storage.')
  }

  const decoded = await decodeImageSource(orthophotoBlob)
  try {
    const nextGroundSurfaceChunks = cloneGroundSurfaceChunks(options.existingGroundSurfaceChunks) ?? {}
    const assetsToRegister: ProjectAsset[] = []
    const assetCache = useAssetCacheStore()
    const revision = Number.isFinite(options.revision) ? Math.max(0, Math.trunc(options.revision as number)) : Date.now()

    const chunkCells = resolveGroundChunkCells(options.definition)
    const gridSize = resolveGroundWorkingGridSize(options.definition)
    const chunkRows = Math.max(1, Math.ceil(Math.max(1, gridSize.rows) / Math.max(1, chunkCells)))
    const chunkColumns = Math.max(1, Math.ceil(Math.max(1, gridSize.columns) / Math.max(1, chunkCells)))
    const groundBounds = resolveGroundWorldBounds(options.definition)

    let coverageChunkCount = 0
    let generatedChunkCount = 0
    const staleAssetIds = new Set<string>()

    for (let chunkRow = 0; chunkRow < chunkRows; chunkRow += 1) {
      for (let chunkColumn = 0; chunkColumn < chunkColumns; chunkColumn += 1) {
        const chunkKey = formatTerrainPaintChunkKey(chunkRow, chunkColumn)
        const chunkBoundsRaw = resolveTerrainPaintChunkBounds(options.definition, chunkRow, chunkColumn)
        if (!chunkBoundsRaw) {
          continue
        }
        const chunkBounds: WorldRect = {
          minX: chunkBoundsRaw.minX,
          minZ: chunkBoundsRaw.minZ,
          maxX: chunkBoundsRaw.minX + chunkBoundsRaw.width,
          maxZ: chunkBoundsRaw.minZ + chunkBoundsRaw.depth,
        }
        const clippedToGround = intersectWorldRects(chunkBounds, {
          minX: groundBounds.minX,
          minZ: groundBounds.minZ,
          maxX: groundBounds.maxX,
          maxZ: groundBounds.maxZ,
        })
        if (!clippedToGround) {
          const previousAssetId = nextGroundSurfaceChunks[chunkKey]?.textureAssetId?.trim() ?? ''
          if (previousAssetId) {
            staleAssetIds.add(previousAssetId)
          }
          delete nextGroundSurfaceChunks[chunkKey]
          continue
        }

        const coverageIntersection = intersectWorldRects(clippedToGround, coverageBounds)
        if (!coverageIntersection) {
          continue
        }

        coverageChunkCount += 1
        const previousAssetId = nextGroundSurfaceChunks[chunkKey]?.textureAssetId?.trim() ?? ''
        if (previousAssetId) {
          staleAssetIds.add(previousAssetId)
        }
        delete nextGroundSurfaceChunks[chunkKey]

        const textureSize = resolveChunkTextureSize(clippedToGround, coverageBounds, decoded.width, decoded.height)
        const composition = createCanvas(textureSize.width, textureSize.height)
        if (!composition) {
          throw new Error('Unable to create chunk orthophoto composition canvas.')
        }
        const { canvas, context } = composition
        context.clearRect(0, 0, textureSize.width, textureSize.height)

        const sourceRect = resolveWorldRectImageSlice(coverageIntersection, coverageBounds, decoded.width, decoded.height)
        const destinationRect = resolveWorldRectImageSlice(coverageIntersection, clippedToGround, textureSize.width, textureSize.height)
        context.drawImage(
          decoded.source,
          sourceRect.x,
          sourceRect.y,
          sourceRect.width,
          sourceRect.height,
          destinationRect.x,
          destinationRect.y,
          destinationRect.width,
          destinationRect.height,
        )
        applyEdgeFeatherToAlpha(context, textureSize.width, textureSize.height, destinationRect, {
          fadeLeft: coverageIntersection.minX > clippedToGround.minX + 1e-6,
          fadeTop: coverageIntersection.minZ > clippedToGround.minZ + 1e-6,
          fadeRight: coverageIntersection.maxX < clippedToGround.maxX - 1e-6,
          fadeBottom: coverageIntersection.maxZ < clippedToGround.maxZ - 1e-6,
        })

        const chunkBlob = await canvasToBlob(canvas)
        if (!chunkBlob) {
          continue
        }

        const textureAssetId = await computeBlobHash(chunkBlob)
        const filename = `ground-surface-chunk_${options.groundNodeId}_${chunkKey}.png`
        await assetCache.storeAssetBlob(textureAssetId, {
          blob: chunkBlob,
          mimeType: 'image/png',
          filename,
          downloadUrl: textureAssetId,
          contentHash: textureAssetId,
        })
        assetsToRegister.push({
          id: textureAssetId,
          name: filename,
          type: 'texture',
          downloadUrl: textureAssetId,
          previewColor: '#ffffff',
          thumbnail: null,
          description: `Planning orthophoto chunk (${options.groundNodeId}:${chunkKey})`,
          tags: ['terrain-imagery', 'ground-surface-chunk'],
          gleaned: true,
          extension: 'png',
          metadata: {
            generatedBy: 'planning-terrain-imagery',
            groundNodeId: options.groundNodeId,
            chunkKey,
            orthophotoHash,
          },
        })
        nextGroundSurfaceChunks[chunkKey] = {
          textureAssetId,
          revision,
        }
        generatedChunkCount += 1
      }
    }

    if (assetsToRegister.length > 0) {
      options.registerAssets(assetsToRegister, {
        source: { type: 'local' },
        internal: true,
        commitOptions: { updateNodes: false },
        autoSave: false,
      })
    }

    return {
      groundSurfaceChunks: Object.keys(nextGroundSurfaceChunks).length > 0 ? nextGroundSurfaceChunks : null,
      generatedChunkCount,
      coverageChunkCount,
      staleAssetIds: Array.from(staleAssetIds).filter((assetId) => !assetsToRegister.some((asset) => asset.id === assetId)),
    }
  } finally {
    decoded.close?.()
  }
}
