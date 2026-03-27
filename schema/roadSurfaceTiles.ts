import type { RoadDynamicMesh } from './index'

export type RoadSurfaceChunkKeyParts = {
  chunkRow: number
  chunkColumn: number
}

export type RoadSurfaceChunkBounds = {
  minX: number
  minZ: number
  width: number
  depth: number
}

function clampFinite(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function normalizeChunkSizeMeters(definition: Pick<RoadDynamicMesh, 'chunkSizeMeters'>): number {
  return Math.max(1, clampFinite(definition.chunkSizeMeters, 32))
}

export function formatRoadSurfaceChunkKey(chunkRow: number, chunkColumn: number): string {
  return `${Math.trunc(chunkRow)}:${Math.trunc(chunkColumn)}`
}

export function parseRoadSurfaceChunkKey(value: string | null | undefined): RoadSurfaceChunkKeyParts | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    return null
  }
  const [rowText, columnText] = normalized.split(':')
  const chunkRow = Number.parseInt(rowText ?? '', 10)
  const chunkColumn = Number.parseInt(columnText ?? '', 10)
  if (!Number.isFinite(chunkRow) || !Number.isFinite(chunkColumn)) {
    return null
  }
  return { chunkRow, chunkColumn }
}

export function resolveRoadSurfaceChunkBounds(
  definition: Pick<RoadDynamicMesh, 'chunkSizeMeters'>,
  chunkRow: number,
  chunkColumn: number,
): RoadSurfaceChunkBounds {
  const chunkSizeMeters = normalizeChunkSizeMeters(definition)
  return {
    minX: Math.trunc(chunkColumn) * chunkSizeMeters,
    minZ: Math.trunc(chunkRow) * chunkSizeMeters,
    width: chunkSizeMeters,
    depth: chunkSizeMeters,
  }
}

export function resolveRoadSurfaceChunkKeyForLocalPoint(
  definition: Pick<RoadDynamicMesh, 'chunkSizeMeters'>,
  localX: number,
  localZ: number,
): string {
  const chunkSizeMeters = normalizeChunkSizeMeters(definition)
  const chunkColumn = Math.floor(localX / chunkSizeMeters)
  const chunkRow = Math.floor(localZ / chunkSizeMeters)
  return formatRoadSurfaceChunkKey(chunkRow, chunkColumn)
}

export function collectRoadSurfaceChunkKeysForCircle(
  definition: Pick<RoadDynamicMesh, 'chunkSizeMeters'>,
  centerX: number,
  centerZ: number,
  radius: number,
): string[] {
  const chunkSizeMeters = normalizeChunkSizeMeters(definition)
  const normalizedRadius = Math.max(0, clampFinite(radius, 0))
  const minColumn = Math.floor((centerX - normalizedRadius) / chunkSizeMeters)
  const maxColumn = Math.floor((centerX + normalizedRadius) / chunkSizeMeters)
  const minRow = Math.floor((centerZ - normalizedRadius) / chunkSizeMeters)
  const maxRow = Math.floor((centerZ + normalizedRadius) / chunkSizeMeters)
  const result: string[] = []
  for (let chunkRow = minRow; chunkRow <= maxRow; chunkRow += 1) {
    for (let chunkColumn = minColumn; chunkColumn <= maxColumn; chunkColumn += 1) {
      result.push(formatRoadSurfaceChunkKey(chunkRow, chunkColumn))
    }
  }
  return result
}

export function collectRoadSurfaceChunkKeysForStrip(
  definition: Pick<RoadDynamicMesh, 'chunkSizeMeters'>,
  polyline: Array<{ x: number; z: number }>,
  width: number,
): string[] {
  if (!Array.isArray(polyline) || polyline.length === 0) {
    return []
  }
  const normalizedHalfWidth = Math.max(0, clampFinite(width, 0) * 0.5)
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const point of polyline) {
    minX = Math.min(minX, clampFinite(point.x, 0) - normalizedHalfWidth)
    minZ = Math.min(minZ, clampFinite(point.z, 0) - normalizedHalfWidth)
    maxX = Math.max(maxX, clampFinite(point.x, 0) + normalizedHalfWidth)
    maxZ = Math.max(maxZ, clampFinite(point.z, 0) + normalizedHalfWidth)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minZ) || !Number.isFinite(maxX) || !Number.isFinite(maxZ)) {
    return []
  }
  const chunkSizeMeters = normalizeChunkSizeMeters(definition)
  const minColumn = Math.floor(minX / chunkSizeMeters)
  const maxColumn = Math.floor(maxX / chunkSizeMeters)
  const minRow = Math.floor(minZ / chunkSizeMeters)
  const maxRow = Math.floor(maxZ / chunkSizeMeters)
  const result: string[] = []
  for (let chunkRow = minRow; chunkRow <= maxRow; chunkRow += 1) {
    for (let chunkColumn = minColumn; chunkColumn <= maxColumn; chunkColumn += 1) {
      result.push(formatRoadSurfaceChunkKey(chunkRow, chunkColumn))
    }
  }
  return result
}