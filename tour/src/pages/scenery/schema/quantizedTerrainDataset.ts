export const QUANTIZED_TERRAIN_DATASET_FORMAT = 'harmony-quantized-terrain-dataset' as const
export const QUANTIZED_TERRAIN_DATASET_VERSION = 1 as const

export type QuantizedTerrainTileId = {
  level: number
  x: number
  y: number
}

export type QuantizedTerrainRegionId = {
  level: number
  x: number
  y: number
}

export type QuantizedTerrainDatasetBounds = {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

export type QuantizedTerrainDatasetBoundingSphere = {
  centerX: number
  centerY: number
  centerZ: number
  radius: number
}

export type QuantizedTerrainDatasetAvailabilityRange = {
  startX: number
  endX: number
  startY: number
  endY: number
}

export type QuantizedTerrainDatasetTileRef = {
  tileKey: string
  tileId: QuantizedTerrainTileId
  geometricError: number
  minHeight: number
  maxHeight: number
  byteOffset: number
  byteLength: number
  bounds: QuantizedTerrainDatasetBounds
  boundingSphere: QuantizedTerrainDatasetBoundingSphere | null
  hasNormals: boolean
  hasWatermask: boolean
  hasOverlay: boolean
  childMask: number
}

export type QuantizedTerrainDatasetRegionPackIndex = {
  regionKey: string
  regionId: QuantizedTerrainRegionId
  path: string
  byteLength: number | null
  tileCount: number
  levelRange: {
    min: number
    max: number
  }
  bounds: QuantizedTerrainDatasetBounds
}

export type QuantizedTerrainDatasetRegionManifest = {
  format: typeof QUANTIZED_TERRAIN_DATASET_FORMAT
  version: typeof QUANTIZED_TERRAIN_DATASET_VERSION
  scenePath: string
  datasetId: string
  regionKey: string
  regionId: QuantizedTerrainRegionId
  packPath: string
  bounds: QuantizedTerrainDatasetBounds
  tiles: QuantizedTerrainDatasetTileRef[]
}

export type QuantizedTerrainDatasetRootManifest = {
  format: typeof QUANTIZED_TERRAIN_DATASET_FORMAT
  version: typeof QUANTIZED_TERRAIN_DATASET_VERSION
  datasetId: string
  scenePath: string
  storageMode: 'region-packs'
  tileScheme: 'quadtree'
  rootLevel: number
  maxLevel: number
  regionLevel: number
  geometricError: number
  bounds: QuantizedTerrainDatasetBounds
  verticalScale: number
  hasNormals: boolean
  hasWatermask: boolean
  hasOverlayLayers: boolean
  rootTiles: QuantizedTerrainTileId[]
  availability: Array<{
    level: number
    ranges: QuantizedTerrainDatasetAvailabilityRange[]
  }>
  regions: QuantizedTerrainDatasetRegionPackIndex[]
}

export function isValidQuantizedTerrainLevel(level: number): boolean {
  return Number.isInteger(level) && level >= 0 && level <= 30
}

export function clampQuantizedTerrainLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 0
  }
  return Math.max(0, Math.min(30, Math.trunc(level)))
}

export function resolveQuantizedTerrainTileSpanMeters(level: number, worldSpanMeters: number): number {
  const normalizedLevel = clampQuantizedTerrainLevel(level)
  const divisor = 2 ** normalizedLevel
  return Math.max(Number.EPSILON, worldSpanMeters / divisor)
}

export function formatQuantizedTerrainTileKey(level: number, x: number, y: number): string {
  return `${Math.trunc(level)}/${Math.trunc(x)}/${Math.trunc(y)}`
}

export function parseQuantizedTerrainTileKey(key: string): QuantizedTerrainTileId | null {
  const trimmed = typeof key === 'string' ? key.trim() : ''
  if (!trimmed) {
    return null
  }
  const parts = trimmed.split('/')
  if (parts.length !== 3) {
    return null
  }
  const level = Number.parseInt(parts[0] ?? '', 10)
  const x = Number.parseInt(parts[1] ?? '', 10)
  const y = Number.parseInt(parts[2] ?? '', 10)
  if (!isValidQuantizedTerrainLevel(level) || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
    return null
  }
  return { level, x, y }
}

export function formatQuantizedTerrainRegionKey(level: number, x: number, y: number): string {
  return `r/${Math.trunc(level)}/${Math.trunc(x)}/${Math.trunc(y)}`
}

export function parseQuantizedTerrainRegionKey(key: string): QuantizedTerrainRegionId | null {
  const trimmed = typeof key === 'string' ? key.trim() : ''
  if (!trimmed) {
    return null
  }
  const parts = trimmed.split('/')
  if (parts.length !== 4 || parts[0] !== 'r') {
    return null
  }
  const level = Number.parseInt(parts[1] ?? '', 10)
  const x = Number.parseInt(parts[2] ?? '', 10)
  const y = Number.parseInt(parts[3] ?? '', 10)
  if (!isValidQuantizedTerrainLevel(level) || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
    return null
  }
  return { level, x, y }
}

export function getQuantizedTerrainChildTileIds(tileId: QuantizedTerrainTileId): QuantizedTerrainTileId[] {
  const level = clampQuantizedTerrainLevel(tileId.level + 1)
  const x = Math.max(0, Math.trunc(tileId.x)) * 2
  const y = Math.max(0, Math.trunc(tileId.y)) * 2
  return [
    { level, x, y },
    { level, x: x + 1, y },
    { level, x, y: y + 1 },
    { level, x: x + 1, y: y + 1 },
  ]
}

export function getQuantizedTerrainParentTileId(tileId: QuantizedTerrainTileId): QuantizedTerrainTileId | null {
  if (!isValidQuantizedTerrainLevel(tileId.level) || tileId.level <= 0) {
    return null
  }
  return {
    level: tileId.level - 1,
    x: Math.floor(Math.max(0, tileId.x) / 2),
    y: Math.floor(Math.max(0, tileId.y) / 2),
  }
}

export function getQuantizedTerrainChildMask(children: QuantizedTerrainTileId[], availableKeys: Iterable<string>): number {
  const available = new Set(availableKeys)
  let mask = 0
  children.forEach((tileId, index) => {
    if (available.has(formatQuantizedTerrainTileKey(tileId.level, tileId.x, tileId.y))) {
      mask |= 1 << index
    }
  })
  return mask
}

export function resolveQuantizedTerrainTileBounds(tileId: QuantizedTerrainTileId, worldBounds: Pick<QuantizedTerrainDatasetBounds, 'minX' | 'maxX' | 'minZ' | 'maxZ'>, minHeight = 0, maxHeight = 0): QuantizedTerrainDatasetBounds {
  const level = clampQuantizedTerrainLevel(tileId.level)
  const scale = 2 ** level
  const width = Math.max(Number.EPSILON, worldBounds.maxX - worldBounds.minX)
  const depth = Math.max(Number.EPSILON, worldBounds.maxZ - worldBounds.minZ)
  const tileWidth = width / scale
  const tileDepth = depth / scale
  const x = Math.max(0, Math.trunc(tileId.x))
  const y = Math.max(0, Math.trunc(tileId.y))
  return {
    minX: worldBounds.minX + x * tileWidth,
    maxX: worldBounds.minX + (x + 1) * tileWidth,
    minY: minHeight,
    maxY: maxHeight,
    minZ: worldBounds.minZ + y * tileDepth,
    maxZ: worldBounds.minZ + (y + 1) * tileDepth,
  }
}

export function resolveQuantizedTerrainRegionIdForTile(tileId: QuantizedTerrainTileId, regionLevel: number): QuantizedTerrainRegionId {
  const normalizedRegionLevel = clampQuantizedTerrainLevel(regionLevel)
  if (tileId.level <= normalizedRegionLevel) {
    return {
      level: tileId.level,
      x: Math.max(0, Math.trunc(tileId.x)),
      y: Math.max(0, Math.trunc(tileId.y)),
    }
  }
  const shift = tileId.level - normalizedRegionLevel
  return {
    level: normalizedRegionLevel,
    x: Math.floor(Math.max(0, tileId.x) / (2 ** shift)),
    y: Math.floor(Math.max(0, tileId.y) / (2 ** shift)),
  }
}

export function buildQuantizedTerrainRegionPackPath(regionId: QuantizedTerrainRegionId, root = 'terrain/regions'): string {
  const normalizedRoot = typeof root === 'string' && root.trim().length ? root.replace(/\/$/, '') : 'terrain/regions'
  return `${normalizedRoot}/l${Math.trunc(regionId.level)}_x${Math.trunc(regionId.x)}_y${Math.trunc(regionId.y)}.terrainpack`
}

export function buildQuantizedTerrainRootManifestPath(root = 'terrain'): string {
  const normalizedRoot = typeof root === 'string' && root.trim().length ? root.replace(/\/$/, '') : 'terrain'
  return `${normalizedRoot}/root.json`
}
