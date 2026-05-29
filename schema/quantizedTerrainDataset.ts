import { decode, encode } from '@msgpack/msgpack'
import {
  normalizeBounds3D,
  isPlainObject,
  normalizeFiniteNumber,
  normalizeInteger,
  normalizeString,
} from './valueNormalization'

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

function normalizeTileId(value: unknown): QuantizedTerrainTileId | null {
  if (!isPlainObject(value)) {
    return null
  }
  const level = normalizeInteger(value.level, Number.NaN)
  const x = normalizeInteger(value.x, Number.NaN)
  const y = normalizeInteger(value.y, Number.NaN)
  if (!Number.isFinite(level) || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
    return null
  }
  return { level, x, y }
}

function normalizeAvailabilityRange(value: unknown): QuantizedTerrainDatasetAvailabilityRange | null {
  if (!isPlainObject(value)) {
    return null
  }
  const startX = normalizeInteger(value.startX, Number.NaN)
  const endX = normalizeInteger(value.endX, Number.NaN)
  const startY = normalizeInteger(value.startY, Number.NaN)
  const endY = normalizeInteger(value.endY, Number.NaN)
  if (![startX, endX, startY, endY].every(Number.isFinite)) {
    return null
  }
  return { startX, endX, startY, endY }
}

function normalizeRegionPackIndex(value: unknown): QuantizedTerrainDatasetRegionPackIndex | null {
  if (!isPlainObject(value)) {
    return null
  }
  const regionKey = normalizeString(value.regionKey)
  const path = normalizeString(value.path)
  const regionId = normalizeTileId(value.regionId)
  const bounds = normalizeBounds3D(value.bounds)
  if (!regionKey || !path || !regionId || !bounds) {
    return null
  }
  const levelRange = isPlainObject(value.levelRange)
    ? {
        min: normalizeInteger(value.levelRange.min, Number.NaN),
        max: normalizeInteger(value.levelRange.max, Number.NaN),
      }
    : null
  if (!levelRange || !Number.isFinite(levelRange.min) || !Number.isFinite(levelRange.max)) {
    return null
  }
  return {
    regionKey,
    regionId,
    path,
    byteLength: value.byteLength == null ? null : Math.max(0, normalizeInteger(value.byteLength, 0)),
    tileCount: Math.max(0, normalizeInteger(value.tileCount, 0)),
    levelRange,
    bounds,
  }
}

export function normalizeQuantizedTerrainDatasetRootManifest(input: unknown): QuantizedTerrainDatasetRootManifest | null {
  if (!isPlainObject(input) || input.format !== QUANTIZED_TERRAIN_DATASET_FORMAT || input.version !== QUANTIZED_TERRAIN_DATASET_VERSION) {
    return null
  }
  const datasetId = normalizeString(input.datasetId)
  const scenePath = normalizeString(input.scenePath)
  const storageMode = input.storageMode === 'region-packs' ? 'region-packs' : null
  const tileScheme = input.tileScheme === 'quadtree' ? 'quadtree' : null
  const bounds = normalizeBounds3D(input.bounds)
  if (!datasetId || !scenePath || !storageMode || !tileScheme || !bounds) {
    return null
  }
  const rootLevel = Math.max(0, normalizeInteger(input.rootLevel, 0))
  const maxLevel = Math.max(rootLevel, normalizeInteger(input.maxLevel, rootLevel))
  const regionLevel = Math.max(0, normalizeInteger(input.regionLevel, 0))
  const rootTiles = Array.isArray(input.rootTiles)
    ? input.rootTiles.map((entry) => normalizeTileId(entry)).filter((entry): entry is QuantizedTerrainTileId => entry !== null)
    : []
  const availability = Array.isArray(input.availability)
    ? input.availability
        .map((entry) => {
          if (!isPlainObject(entry) || !Array.isArray(entry.ranges)) {
            return null
          }
          const level = normalizeInteger(entry.level, Number.NaN)
          if (!Number.isFinite(level)) {
            return null
          }
          const ranges = entry.ranges
            .map((range) => normalizeAvailabilityRange(range))
            .filter((range): range is QuantizedTerrainDatasetAvailabilityRange => range !== null)
          return { level, ranges }
        })
        .filter((entry): entry is { level: number; ranges: QuantizedTerrainDatasetAvailabilityRange[] } => entry !== null)
    : []
  const regions = Array.isArray(input.regions)
    ? input.regions
        .map((entry) => normalizeRegionPackIndex(entry))
        .filter((entry): entry is QuantizedTerrainDatasetRegionPackIndex => entry !== null)
    : []
  return {
    format: QUANTIZED_TERRAIN_DATASET_FORMAT,
    version: QUANTIZED_TERRAIN_DATASET_VERSION,
    datasetId,
    scenePath,
    storageMode,
    tileScheme,
    rootLevel,
    maxLevel,
    regionLevel,
    geometricError: normalizeFiniteNumber(input.geometricError, 0),
    bounds,
    verticalScale: normalizeFiniteNumber(input.verticalScale, 1),
    hasNormals: Boolean(input.hasNormals),
    hasWatermask: Boolean(input.hasWatermask),
    hasOverlayLayers: Boolean(input.hasOverlayLayers),
    rootTiles,
    availability,
    regions,
  }
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
  return `${normalizedRoot}/root.bin`
}

export function serializeQuantizedTerrainDatasetRootManifest(manifest: QuantizedTerrainDatasetRootManifest): Uint8Array {
  return encode(manifest)
}

export function deserializeQuantizedTerrainDatasetRootManifest(payload: ArrayBuffer | Uint8Array): QuantizedTerrainDatasetRootManifest | null {
  try {
    const decoded = decode(payload instanceof Uint8Array ? payload : new Uint8Array(payload)) as unknown
    return normalizeQuantizedTerrainDatasetRootManifest(decoded)
  } catch (_error) {
    return null
  }
}
