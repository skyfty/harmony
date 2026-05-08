import {
  fetchTerrainImageryPlan,
  fetchTerrainImageryProviders,
  fetchTerrainImageryTileBlob,
  type TerrainImageryFetchPlan,
  type TerrainImageryProviderSummary,
} from '@/api/terrainImagery'
import type { PlanningTerrainDemData } from '@/types/planning-scene-data'

type CanvasLike = OffscreenCanvas | HTMLCanvasElement
type Canvas2DContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export type TerrainImageryComposeResult = {
  blob: Blob
  width: number
  height: number
  provider: TerrainImageryProviderSummary
  zoom: number
  geographicBounds: TerrainImageryFetchPlan['geographicBounds']
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

async function blobToImageSource(blob: Blob): Promise<CanvasImageSource> {
  if (typeof createImageBitmap === 'function') {
    return await createImageBitmap(blob)
  }
  if (typeof Image === 'undefined' || typeof URL === 'undefined') {
    throw new Error('Current environment cannot decode imagery tiles.')
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      try {
        URL.revokeObjectURL(url)
      } catch {}
      resolve(image)
    }
    image.onerror = () => {
      try {
        URL.revokeObjectURL(url)
      } catch {}
      reject(new Error('Failed to decode terrain imagery tile.'))
    }
    image.src = url
  })
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

function normalizeSourceBounds(dem: PlanningTerrainDemData): {
  west: number
  south: number
  east: number
  north: number
} {
  const bounds = dem.projectedBounds ?? dem.geographicBounds
  const west = Number(bounds?.west)
  const south = Number(bounds?.south)
  const east = Number(bounds?.east)
  const north = Number(bounds?.north)
  if (!Number.isFinite(west) || !Number.isFinite(south) || !Number.isFinite(east) || !Number.isFinite(north)) {
    throw new Error('DEM projected source bounds are missing.')
  }
  if (!(east > west) || !(north > south)) {
    throw new Error('DEM projected source bounds are invalid.')
  }
  return { west, south, east, north }
}

export function getAutomaticTerrainImageryUnsupportedReason(
  dem: PlanningTerrainDemData | null | undefined,
): string | null {
  if (!dem) {
    return 'Import a DEM before fetching terrain imagery.'
  }
  const projectedCrs = typeof dem.projectedCrs === 'string' ? dem.projectedCrs.trim().toUpperCase() : ''
  if (!projectedCrs) {
    return 'Automatic terrain imagery requires a DEM with projected CRS metadata.'
  }
  if (!['EPSG:3857', 'EPSG:102100', 'EPSG:900913'].includes(projectedCrs)) {
    return `Automatic terrain imagery currently supports Web Mercator DEMs only. Current CRS: ${projectedCrs}.`
  }
  try {
    normalizeSourceBounds(dem)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'DEM projected source bounds are invalid.'
  }
}

export function supportsAutomaticTerrainImagery(dem: PlanningTerrainDemData | null | undefined): boolean {
  return getAutomaticTerrainImageryUnsupportedReason(dem) === null
}

export async function composeAutomaticTerrainImagery(
  dem: PlanningTerrainDemData,
  options: {
    providerId?: string | null
    maxOutputSize?: number | null
  } = {},
): Promise<TerrainImageryComposeResult> {
  const projectedCrs = typeof dem.projectedCrs === 'string' ? dem.projectedCrs.trim() : ''
  if (!projectedCrs) {
    throw new Error('DEM projected CRS is missing.')
  }
  const sourceBounds = normalizeSourceBounds(dem)
  const providers = await fetchTerrainImageryProviders()
  const plan = await fetchTerrainImageryPlan({
    providerId: options.providerId ?? null,
    projectedCrs,
    sourceBounds,
    maxOutputSize: options.maxOutputSize ?? 4096,
  })

  const composition = createCanvas(plan.width, plan.height)
  if (!composition) {
    throw new Error('Unable to create terrain imagery composition canvas.')
  }
  const { canvas, context } = composition
  context.clearRect(0, 0, plan.width, plan.height)

  const resolvedTiles = await Promise.all(
    plan.tiles.map(async (tile) => ({
      tile,
      imageSource: await blobToImageSource(await fetchTerrainImageryTileBlob(tile.url)),
    })),
  )

  for (const { tile, imageSource } of resolvedTiles) {
    context.drawImage(
      imageSource,
      Math.round(tile.drawLeft),
      Math.round(tile.drawTop),
      Math.round(tile.drawWidth),
      Math.round(tile.drawHeight),
    )
  }

  const blob = await canvasToBlob(canvas)
  if (!blob) {
    throw new Error('Unable to encode composed terrain imagery.')
  }
  const provider = providers.find((entry) => entry.id === plan.provider.id) ?? plan.provider
  return {
    blob,
    width: plan.width,
    height: plan.height,
    provider,
    zoom: plan.zoom,
    geographicBounds: plan.geographicBounds,
  }
}
