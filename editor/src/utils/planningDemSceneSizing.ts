import type { PlanningSceneData, PlanningTerrainDemData } from '@/types/planning-scene-data'

export interface PlanningDemGroundSize {
  width: number
  depth: number
}

const DEFAULT_TERRAIN_LAYER = {
  id: 'terrain-layer',
  name: 'Terrain',
  kind: 'terrain' as const,
  visible: true,
  color: '#6D4C41',
  locked: false,
  conversionEnabled: true,
}

function clampPositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function roundToFriendlyMeters(value: number): number {
  const safe = clampPositive(value, 1)
  const step = safe < 50 ? 1 : safe < 200 ? 5 : safe < 1000 ? 10 : safe < 5000 ? 25 : safe < 20000 ? 50 : 100
  return Math.max(1, Math.round(safe / step) * step)
}

function looksLikeGeographicBounds(bounds: { west: number; south: number; east: number; north: number }): boolean {
  return (
    Math.abs(bounds.west) <= 180
    && Math.abs(bounds.east) <= 180
    && Math.abs(bounds.south) <= 90
    && Math.abs(bounds.north) <= 90
  )
}

function metersPerDegreeLatitude(latDegrees: number): number {
  const lat = (latDegrees * Math.PI) / 180
  return 111132.92 - 559.82 * Math.cos(2 * lat) + 1.175 * Math.cos(4 * lat) - 0.0023 * Math.cos(6 * lat)
}

function metersPerDegreeLongitude(latDegrees: number): number {
  const lat = (latDegrees * Math.PI) / 180
  return 111412.84 * Math.cos(lat) - 93.5 * Math.cos(3 * lat) + 0.118 * Math.cos(5 * lat)
}

function deriveGroundSizeFromGeographicBounds(bounds: { west: number; south: number; east: number; north: number }): PlanningDemGroundSize {
  const latCenter = (bounds.south + bounds.north) * 0.5
  const widthMeters = Math.abs(bounds.east - bounds.west) * metersPerDegreeLongitude(latCenter)
  const depthMeters = Math.abs(bounds.north - bounds.south) * metersPerDegreeLatitude(latCenter)
  return {
    width: roundToFriendlyMeters(widthMeters),
    depth: roundToFriendlyMeters(depthMeters),
  }
}

function deriveGroundSizeFromSampleStep(dem: PlanningTerrainDemData): PlanningDemGroundSize | null {
  const sampleStep = Number(dem.sampleStepMeters)
  const width = Number(dem.width)
  const height = Number(dem.height)
  if (!Number.isFinite(sampleStep) || sampleStep <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null
  }
  return {
    width: roundToFriendlyMeters(Math.max(1, width - 1) * sampleStep),
    depth: roundToFriendlyMeters(Math.max(1, height - 1) * sampleStep),
  }
}

function deriveGroundSizeFromWorldBounds(dem: PlanningTerrainDemData): PlanningDemGroundSize | null {
  const bounds = dem.worldBounds
  if (!bounds) {
    return null
  }
  const width = Number(bounds.maxX) - Number(bounds.minX)
  const depth = Number(bounds.maxY) - Number(bounds.minY)
  if (!Number.isFinite(width) || !Number.isFinite(depth) || width <= 0 || depth <= 0) {
    return null
  }
  return {
    width: roundToFriendlyMeters(width),
    depth: roundToFriendlyMeters(depth),
  }
}

export function suggestPlanningDemGroundSize(dem: PlanningTerrainDemData): PlanningDemGroundSize {
  if (dem.geographicBounds && looksLikeGeographicBounds(dem.geographicBounds)) {
    return deriveGroundSizeFromGeographicBounds(dem.geographicBounds)
  }
  return deriveGroundSizeFromSampleStep(dem) ?? deriveGroundSizeFromWorldBounds(dem) ?? {
    width: roundToFriendlyMeters(Number.isFinite(Number(dem.width)) ? Math.max(1, Number(dem.width) - 1) : 100),
    depth: roundToFriendlyMeters(Number.isFinite(Number(dem.height)) ? Math.max(1, Number(dem.height) - 1) : 100),
  }
}

export function buildPlanningDataFromDem(dem: PlanningTerrainDemData): PlanningSceneData {
  return {
    version: 1,
    activeLayerId: DEFAULT_TERRAIN_LAYER.id,
    layers: [DEFAULT_TERRAIN_LAYER],
    polygons: [],
    polylines: [],
    images: [],
    terrain: {
      version: 1,
      dem,
    },
  }
}