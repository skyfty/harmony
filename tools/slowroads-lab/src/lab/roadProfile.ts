import type { Heightfield } from './heightfield'
import type { RoadNode } from './roadTrace'
import { clamp, lerp, smoothstep } from './noise'

/**
 * Spatial queries against the traced road: distance to the midline, the road
 * surface height at the closest point, and the terrain flattening rule. A
 * uniform segment grid keeps per-vertex queries fast enough to bake a
 * million-vertex terrain.
 */
export interface RoadProfileOptions {
  halfWidth: number
  shoulderWidth: number
  flattenBand: number
  /** How much the road surface sits below the surrounding terrain. */
  roadDrop?: number
  /** Distances beyond this are clamped (meters). */
  maxQueryDistance?: number
}

export interface RoadClosestPoint {
  distance: number
  height: number
}

export interface RoadProfile {
  nodes: RoadNode[]
  length: number
  halfWidth: number
  shoulderWidth: number
  flattenBand: number
  roadDrop: number
  maxQueryDistance: number
  sampleAt(distance: number): { x: number; z: number; y: number; heading: number }
  closestPoint(x: number, z: number): RoadClosestPoint | null
  distanceTo(x: number, z: number): number
  /** d - halfWidth: negative on the asphalt, 0 at the asphalt edge. */
  roadProximityAt(x: number, z: number): number
}

const CELL_SIZE = 32

export function createRoadProfile(
  nodes: RoadNode[],
  options: RoadProfileOptions,
): RoadProfile {
  const halfWidth = options.halfWidth
  const shoulderWidth = options.shoulderWidth
  const flattenBand = options.flattenBand
  const roadDrop = options.roadDrop ?? 0.05
  const maxQueryDistance = options.maxQueryDistance ?? 72

  const cumulative = new Float32Array(nodes.length)
  for (let i = 1; i < nodes.length; i += 1) {
    const previous = nodes[i - 1]!
    const current = nodes[i]!
    cumulative[i] = cumulative[i - 1]! + Math.hypot(current.x - previous.x, current.z - previous.z)
  }
  const length = nodes.length ? cumulative[nodes.length - 1]! : 0

  // Segment grid: every segment is registered in all cells its bbox grown by
  // maxQueryDistance touches, so a query only has to scan its own cell.
  const segmentCount = Math.max(0, nodes.length - 1)
  const cells = new Map<number, number[]>()
  const keyFor = (cellX: number, cellZ: number): number => (cellX + 512) * 1024 + (cellZ + 512)
  for (let i = 0; i < segmentCount; i += 1) {
    const from = nodes[i]!
    const to = nodes[i + 1]!
    const minX = Math.min(from.x, to.x) - maxQueryDistance
    const maxX = Math.max(from.x, to.x) + maxQueryDistance
    const minZ = Math.min(from.z, to.z) - maxQueryDistance
    const maxZ = Math.max(from.z, to.z) + maxQueryDistance
    const cellX0 = Math.floor(minX / CELL_SIZE)
    const cellX1 = Math.floor(maxX / CELL_SIZE)
    const cellZ0 = Math.floor(minZ / CELL_SIZE)
    const cellZ1 = Math.floor(maxZ / CELL_SIZE)
    for (let cellX = cellX0; cellX <= cellX1; cellX += 1) {
      for (let cellZ = cellZ0; cellZ <= cellZ1; cellZ += 1) {
        const key = keyFor(cellX, cellZ)
        const list = cells.get(key)
        if (list) {
          list.push(i)
        } else {
          cells.set(key, [i])
        }
      }
    }
  }

  const closestPoint = (x: number, z: number): RoadClosestPoint | null => {
    const key = keyFor(Math.floor(x / CELL_SIZE), Math.floor(z / CELL_SIZE))
    const list = cells.get(key)
    if (!list || !list.length) {
      return null
    }
    let bestDistanceSq = Number.POSITIVE_INFINITY
    let bestHeight = 0
    for (const index of list) {
      const from = nodes[index]!
      const to = nodes[index + 1]!
      const segX = to.x - from.x
      const segZ = to.z - from.z
      const segLengthSq = segX * segX + segZ * segZ
      if (segLengthSq <= 1e-9) {
        continue
      }
      const t = clamp(((x - from.x) * segX + (z - from.z) * segZ) / segLengthSq, 0, 1)
      const px = from.x + segX * t
      const pz = from.z + segZ * t
      const dx = x - px
      const dz = z - pz
      const distanceSq = dx * dx + dz * dz
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq
        bestHeight = lerp(from.y, to.y, t)
      }
    }
    if (!Number.isFinite(bestDistanceSq)) {
      return null
    }
    const distance = Math.sqrt(bestDistanceSq)
    if (distance > maxQueryDistance) {
      return null
    }
    return { distance, height: bestHeight }
  }

  const sampleAt = (distance: number): { x: number; z: number; y: number; heading: number } => {
    const clampedDistance = clamp(distance, 0, length)
    let low = 0
    let high = nodes.length - 1
    while (low < high - 1) {
      const mid = (low + high) >> 1
      if (cumulative[mid]! <= clampedDistance) {
        low = mid
      } else {
        high = mid
      }
    }
    const from = nodes[low]!
    const to = nodes[Math.min(nodes.length - 1, low + 1)]!
    const segmentLength = Math.max(1e-6, cumulative[high]! - cumulative[low]!)
    const t = (clampedDistance - cumulative[low]!) / segmentLength
    return {
      x: lerp(from.x, to.x, t),
      z: lerp(from.z, to.z, t),
      y: lerp(from.y, to.y, t),
      heading: from.heading,
    }
  }

  return {
    nodes,
    length,
    halfWidth,
    shoulderWidth,
    flattenBand,
    roadDrop,
    maxQueryDistance,
    sampleAt,
    closestPoint,
    distanceTo(x: number, z: number): number {
      const closest = closestPoint(x, z)
      return closest ? closest.distance : maxQueryDistance
    },
    roadProximityAt(x: number, z: number): number {
      const closest = closestPoint(x, z)
      return (closest ? closest.distance : maxQueryDistance) - halfWidth
    },
  }
}

export interface TerrainBakeResult {
  height: number
  /** d - halfWidth (clamped to the query distance when far from the road). */
  roadProx: number
}

/** Applies the slowroads-style flattening cut to a terrain height sample. */
export function bakeTerrainHeight(
  field: Heightfield,
  profile: RoadProfile,
  x: number,
  z: number,
  baseHeight?: number,
): TerrainBakeResult {
  const height = baseHeight ?? field.sampleHeight(x, z)
  const closest = profile.closestPoint(x, z)
  if (!closest) {
    return { height, roadProx: profile.maxQueryDistance - profile.halfWidth }
  }
  const inner = profile.halfWidth + profile.shoulderWidth
  const weight = 1 - smoothstep(inner, inner + profile.flattenBand, closest.distance)
  const roadProx = closest.distance - profile.halfWidth
  if (weight <= 0.001) {
    return { height, roadProx }
  }
  return {
    height: lerp(height, closest.height - profile.roadDrop, weight),
    roadProx,
  }
}
