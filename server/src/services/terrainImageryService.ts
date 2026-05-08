import { appConfig } from '@/config/env'

export type TerrainImageryProviderSummary = {
  id: string
  label: string
  attribution: string | null
  minZoom: number
  maxZoom: number
  supportsProjectedCrs: string[]
}

export type TerrainImageryFetchPlanTile = {
  z: number
  x: number
  y: number
  url: string
  drawLeft: number
  drawTop: number
  drawWidth: number
  drawHeight: number
}

export type TerrainImageryFetchPlan = {
  provider: TerrainImageryProviderSummary
  projectedCrs: string
  sourceBounds: {
    west: number
    south: number
    east: number
    north: number
  }
  geographicBounds: {
    west: number
    south: number
    east: number
    north: number
  }
  width: number
  height: number
  zoom: number
  tileSize: number
  tiles: TerrainImageryFetchPlanTile[]
}

type TerrainImageryProviderDefinition = TerrainImageryProviderSummary & {
  tileTemplate: string
}

type TerrainImageryFetchPlanInput = {
  providerId?: string | null
  projectedCrs?: string | null
  sourceBounds?: Partial<Record<'west' | 'south' | 'east' | 'north', unknown>> | null
  maxOutputSize?: number | null
}

const WEB_MERCATOR_CRS = new Set(['EPSG:3857', 'EPSG:102100', 'EPSG:900913'])
const DEFAULT_TILE_SIZE = 256

function normalizeFinite(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeProjectedCrs(value: string | null | undefined): string {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (!normalized) {
    throw new Error('projectedCrs is required')
  }
  return normalized
}

function ensureSupportedProjectedCrs(projectedCrs: string): void {
  if (!WEB_MERCATOR_CRS.has(projectedCrs)) {
    throw new Error(`Unsupported projected CRS for terrain imagery: ${projectedCrs}. Only EPSG:3857 is supported in this MVP.`)
  }
}

function normalizeSourceBounds(
  raw: TerrainImageryFetchPlanInput['sourceBounds'],
): { west: number; south: number; east: number; north: number } {
  const west = normalizeFinite(raw?.west)
  const south = normalizeFinite(raw?.south)
  const east = normalizeFinite(raw?.east)
  const north = normalizeFinite(raw?.north)
  if (west === null || south === null || east === null || north === null) {
    throw new Error('sourceBounds are required')
  }
  if (!(east > west) || !(north > south)) {
    throw new Error('sourceBounds are invalid')
  }
  return { west, south, east, north }
}

function projectMercatorXToLongitude(x: number): number {
  return (x / 20037508.34) * 180
}

function projectMercatorYToLatitude(y: number): number {
  const normalized = (y / 20037508.34) * 180
  return (180 / Math.PI) * (2 * Math.atan(Math.exp((normalized * Math.PI) / 180)) - Math.PI / 2)
}

function longitudeToWorldPixelX(longitude: number, zoom: number): number {
  const worldSize = DEFAULT_TILE_SIZE * Math.pow(2, zoom)
  return ((longitude + 180) / 360) * worldSize
}

function latitudeToWorldPixelY(latitude: number, zoom: number): number {
  const worldSize = DEFAULT_TILE_SIZE * Math.pow(2, zoom)
  const sinLatitude = Math.sin((clamp(latitude, -85.05112878, 85.05112878) * Math.PI) / 180)
  const mercator = 0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)
  return mercator * worldSize
}

function buildProviders(): TerrainImageryProviderDefinition[] {
  const configuredMinZoom = Number.isFinite(appConfig.terrainImagery.minZoom) ? Math.trunc(appConfig.terrainImagery.minZoom) : 0
  const configuredMaxZoom = Number.isFinite(appConfig.terrainImagery.maxZoom) ? Math.trunc(appConfig.terrainImagery.maxZoom) : 19
  const minZoom = clamp(configuredMinZoom, 0, 22)
  const maxZoom = clamp(configuredMaxZoom, minZoom, 22)
  return [
    {
      id: 'esri-world-imagery',
      label: 'Esri World Imagery',
      attribution: appConfig.terrainImagery.xyzAttribution,
      minZoom,
      maxZoom,
      supportsProjectedCrs: ['EPSG:3857'],
      tileTemplate: appConfig.terrainImagery.xyzTileTemplate,
    },
  ]
}

function resolveProvider(providerId: string | null | undefined): TerrainImageryProviderDefinition {
  const allProviders = buildProviders()
  const normalizedProviderId = typeof providerId === 'string' && providerId.trim().length
    ? providerId.trim()
    : appConfig.terrainImagery.defaultProviderId
  const provider = allProviders.find((entry) => entry.id === normalizedProviderId)
  if (!provider) {
    throw new Error(`Unknown terrain imagery provider: ${normalizedProviderId}`)
  }
  return provider
}

function chooseZoomLevel(
  provider: TerrainImageryProviderDefinition,
  bounds: { west: number; south: number; east: number; north: number },
  maxOutputSize: number,
): number {
  const configuredMaxOutput = Number.isFinite(appConfig.terrainImagery.maxOutputSize) && appConfig.terrainImagery.maxOutputSize > 0
    ? Math.trunc(appConfig.terrainImagery.maxOutputSize)
    : 4096
  const safeRequestedOutput = Number.isFinite(maxOutputSize) && maxOutputSize > 0
    ? Math.trunc(maxOutputSize)
    : configuredMaxOutput
  const safeMaxOutput = clamp(safeRequestedOutput, 256, Math.max(256, configuredMaxOutput))
  for (let zoom = provider.maxZoom; zoom >= provider.minZoom; zoom -= 1) {
    const pixelWidth = Math.abs(longitudeToWorldPixelX(bounds.east, zoom) - longitudeToWorldPixelX(bounds.west, zoom))
    const pixelHeight = Math.abs(latitudeToWorldPixelY(bounds.south, zoom) - latitudeToWorldPixelY(bounds.north, zoom))
    if (pixelWidth <= safeMaxOutput && pixelHeight <= safeMaxOutput) {
      return zoom
    }
  }
  return provider.minZoom
}

function buildTileUrl(provider: TerrainImageryProviderDefinition, z: number, x: number, y: number): string {
  return provider.tileTemplate
    .replaceAll('{z}', String(z))
    .replaceAll('{x}', String(x))
    .replaceAll('{y}', String(y))
}

function buildProxyTileUrl(providerId: string, z: number, x: number, y: number): string {
  return `/api/terrain-imagery/providers/${encodeURIComponent(providerId)}/tiles/${z}/${x}/${y}`
}

export function listTerrainImageryProviders(): TerrainImageryProviderSummary[] {
  return buildProviders().map(({ tileTemplate: _tileTemplate, ...provider }) => provider)
}

export function buildTerrainImageryFetchPlan(input: TerrainImageryFetchPlanInput): TerrainImageryFetchPlan {
  const projectedCrs = normalizeProjectedCrs(input.projectedCrs ?? null)
  ensureSupportedProjectedCrs(projectedCrs)

  const provider = resolveProvider(input.providerId ?? null)
  const sourceBounds = normalizeSourceBounds(input.sourceBounds)
  const geographicBounds = {
    west: projectMercatorXToLongitude(sourceBounds.west),
    south: projectMercatorYToLatitude(sourceBounds.south),
    east: projectMercatorXToLongitude(sourceBounds.east),
    north: projectMercatorYToLatitude(sourceBounds.north),
  }
  const requestedMaxOutputSize = Number.isFinite(input.maxOutputSize) && Number(input.maxOutputSize) > 0
    ? Number(input.maxOutputSize)
    : appConfig.terrainImagery.maxOutputSize
  const zoom = chooseZoomLevel(provider, geographicBounds, requestedMaxOutputSize)
  const left = longitudeToWorldPixelX(geographicBounds.west, zoom)
  const right = longitudeToWorldPixelX(geographicBounds.east, zoom)
  const top = latitudeToWorldPixelY(geographicBounds.north, zoom)
  const bottom = latitudeToWorldPixelY(geographicBounds.south, zoom)
  const width = Math.max(1, Math.ceil(right - left))
  const height = Math.max(1, Math.ceil(bottom - top))

  const minTileX = Math.floor(left / DEFAULT_TILE_SIZE)
  const maxTileX = Math.floor((right - 1e-6) / DEFAULT_TILE_SIZE)
  const minTileY = Math.floor(top / DEFAULT_TILE_SIZE)
  const maxTileY = Math.floor((bottom - 1e-6) / DEFAULT_TILE_SIZE)
  const maxTileIndex = Math.max(0, Math.pow(2, zoom) - 1)
  const tiles: TerrainImageryFetchPlanTile[] = []

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const normalizedTileX = clamp(tileX, 0, maxTileIndex)
      const normalizedTileY = clamp(tileY, 0, maxTileIndex)
      const tileLeft = normalizedTileX * DEFAULT_TILE_SIZE
      const tileTop = normalizedTileY * DEFAULT_TILE_SIZE
      tiles.push({
        z: zoom,
        x: normalizedTileX,
        y: normalizedTileY,
        url: buildProxyTileUrl(provider.id, zoom, normalizedTileX, normalizedTileY),
        drawLeft: tileLeft - left,
        drawTop: tileTop - top,
        drawWidth: DEFAULT_TILE_SIZE,
        drawHeight: DEFAULT_TILE_SIZE,
      })
    }
  }

  return {
    provider: {
      id: provider.id,
      label: provider.label,
      attribution: provider.attribution,
      minZoom: provider.minZoom,
      maxZoom: provider.maxZoom,
      supportsProjectedCrs: [...provider.supportsProjectedCrs],
    },
    projectedCrs,
    sourceBounds,
    geographicBounds,
    width,
    height,
    zoom,
    tileSize: DEFAULT_TILE_SIZE,
    tiles,
  }
}

export async function fetchTerrainImageryTile(
  providerId: string,
  z: number,
  x: number,
  y: number,
): Promise<{ buffer: ArrayBuffer; contentType: string | null; cacheControl: string | null }> {
  const provider = resolveProvider(providerId)
  const url = buildTileUrl(provider, z, x, y)
  const controller = new AbortController()
  const requestTimeoutMs = Number.isFinite(appConfig.terrainImagery.requestTimeoutMs) && appConfig.terrainImagery.requestTimeoutMs > 0
    ? Math.trunc(appConfig.terrainImagery.requestTimeoutMs)
    : 15000
  const timeoutId = setTimeout(() => controller.abort(), Math.max(1000, requestTimeoutMs))
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*',
      },
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch terrain imagery tile (${response.status})`)
    }
    return {
      buffer: await response.arrayBuffer(),
      contentType: response.headers.get('content-type'),
      cacheControl: response.headers.get('cache-control'),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}
