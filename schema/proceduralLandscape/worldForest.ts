import type { LandscapeDensityField } from './densityField'
import type { RoadProximityIndex } from './roadProximity'
import type { RoadTraceNode } from './roadTrace'
import type { TerrainHeightGrid } from './terrainSampler'
import type { TreePlacement } from './chunkPlan'
import { clamp, clamp01, fbm2, hashUnit, lerp, smoothstep } from './noise'
import {
  slowroadsTreeLineBounds,
  slowroadsTreeLineFactor,
  slowroadsTreeSpeciesAt,
  type TreeLineBounds,
} from './treeSpecies'

export interface WorldForestPlanParams {
  seed: number
  cellSize: number
  maxTrees: number
  maxSlope: number
  /** Absolute road clearance from the road centerline, including half width. */
  roadClearance: number
  waterLevel: number
  minHeight: number | null
  minScale: number
  maxScale: number
  /** Quality-tier density multiplier (high=1, medium=.75, low=.4). */
  densityMultiplier: number
}

export interface WorldForestPlanDeps {
  grid: TerrainHeightGrid
  density: LandscapeDensityField
  roadField: RoadProximityIndex | null
  /** Visible surface after the DEM roadbed has been graded. */
  heightAt(x: number, z: number): number | null
  /** Optional baked spatial species field; falls back to direct sampling. */
  speciesAt?(x: number, z: number): 0 | 1
}

export interface WorldForestScan {
  readonly params: WorldForestPlanParams
  readonly placements: TreePlacement[]
  readonly cols: number
  readonly rows: number
  row: number
  col: number
  processedCells: number
  complete: boolean
}

const CELL_BIAS = 1 << 20
const CELL_STRIDE = 1 << 21

function cellKey(cellX: number, cellZ: number): number {
  return (cellX + CELL_BIAS) * CELL_STRIDE + (cellZ + CELL_BIAS)
}

function slopeAt(grid: TerrainHeightGrid, x: number, z: number): number | null {
  const step = Math.max(0.75, grid.cellSize * 0.5)
  const hx0 = grid.sampleHeight(x - step, z)
  const hx1 = grid.sampleHeight(x + step, z)
  const hz0 = grid.sampleHeight(x, z - step)
  const hz1 = grid.sampleHeight(x, z + step)
  if (hx0 == null || hx1 == null || hz0 == null || hz1 == null) {
    return null
  }
  const dx = (hx1 - hx0) / (step * 2)
  const dz = (hz1 - hz0) / (step * 2)
  return 1 - 1 / Math.sqrt(dx * dx + dz * dz + 1)
}

function makeTree(
  params: WorldForestPlanParams,
  deps: WorldForestPlanDeps,
  x: number,
  z: number,
  y: number,
  cellKeyValue: number,
  salt: number,
  rank: number,
  corridor: boolean,
): TreePlacement {
  const seed = params.seed >>> 0
  const densityValue = clamp01(deps.density.sampleUnit(x, z))
  const species: 0 | 1 = deps.speciesAt
    ? deps.speciesAt(x, z)
    : slowroadsTreeSpeciesAt(seed, x, z)
  const baseScale = lerp(params.minScale, params.maxScale, hashUnit(seed, cellKeyValue, 9 + salt))
  const scale = corridor
    ? baseScale * (0.82 + densityValue * 0.36)
    : baseScale * (2 + hashUnit(seed, cellKeyValue, 10 + salt) * 1.2)
  return {
    x,
    z,
    y,
    rotation: hashUnit(seed, cellKeyValue, 11 + salt) * Math.PI * 2,
    scale,
    variant: hashUnit(seed, cellKeyValue, 13 + salt),
    species,
    rank,
  }
}

export function createWorldForestScan(params: WorldForestPlanParams, deps: WorldForestPlanDeps): WorldForestScan {
  const { grid } = deps
  const cellSize = Math.max(8, params.cellSize)
  const cols = Math.max(1, Math.ceil((grid.maxX - grid.minX) / cellSize) + 1)
  const rows = Math.max(1, Math.ceil((grid.maxZ - grid.minZ) / cellSize) + 1)
  return {
    params: { ...params, cellSize, maxTrees: Math.max(0, Math.floor(params.maxTrees)) },
    placements: [],
    cols,
    rows,
    row: 0,
    col: 0,
    processedCells: 0,
    complete: params.maxTrees <= 0,
  }
}

/** Advance the world-anchored forest scan without blocking a render frame. */
export function stepWorldForestScan(
  scan: WorldForestScan,
  deps: WorldForestPlanDeps,
  maxCells = 25_000,
): boolean {
  if (scan.complete) {
    return true
  }
  const params = scan.params
  const seed = params.seed >>> 0
  const treeLine = slowroadsTreeLineBounds(deps.grid.minY, deps.grid.maxY)
  let budget = Math.max(1, Math.floor(maxCells))
  while (budget > 0 && !scan.complete) {
    if (scan.row >= scan.rows) {
      scan.complete = true
      break
    }
    const cellSize = params.cellSize
    const cellX = scan.col
    const cellZ = scan.row
    const key = (cellX + 32768) * 65536 + (cellZ + 32768)
    const x = deps.grid.minX + (cellX + 0.08 + hashUnit(seed, key, 1) * 0.84) * cellSize
    const z = deps.grid.minZ + (cellZ + 0.08 + hashUnit(seed, key, 2) * 0.84) * cellSize
    const value = deps.density.sampleUnit(x, z)
    // Low-density noise must produce actual clearings, not a uniform sprinkle
    // of isolated trees. The squared mask keeps forest interiors dense while
    // opening the meadow between woodland blocks.
    const forestMask = smoothstep(0.40, 0.56, value)
    const slope = slopeAt(deps.grid, x, z)
    const y = deps.heightAt(x, z)
    // slowroads' 150m -> 300m density band, remapped to this DEM's relative
    // height. Keep the existing forest mask / grove field as the patch mask.
    const elevationFactor = y == null ? 0 : slowroadsTreeLineFactor(y, treeLine)
    // A 240m field breaks the broad mask into actual groves and meadows.
    // Without this, every high-density cell receives one/two trees and reads as
    // an evenly sprinkled carpet instead of woodland blocks.
    const groveSeed = (seed ^ 0x6d2b79f5) >>> 0
    const grove = smoothstep(
      0.40,
      0.64,
      fbm2(groveSeed, x / 240, z / 240, 2, 2.1, 0.5),
    )
    const roadBlocked = deps.roadField != null
      && deps.roadField.distanceAt(x, z) < params.roadClearance
    if (
      y != null
      && y >= params.waterLevel + 2
      && (params.minHeight == null || y >= params.minHeight)
      && slope != null
      && slope <= params.maxSlope
      && !roadBlocked
      && deps.grid.contains(x, z)
    ) {
      const slopePenalty = 1 - smoothstep(0.24, params.maxSlope, slope) * 0.55
      const patchDensity = forestMask * lerp(0.03, 1, grove)
      const chance = clamp01(
        patchDensity * slopePenalty * elevationFactor * params.densityMultiplier,
      )
      const clusterCount = forestMask > 0.55 && grove > 0.55
        ? (grove > 0.72 && hashUnit(seed, key, 3) < 0.65 ? 3 : 2)
        : 1
      for (let item = 0; item < clusterCount && scan.placements.length < params.maxTrees; item += 1) {
        if (item === 0 && hashUnit(seed, key, 4) >= chance) {
          continue
        }
        const treeX = item === 0
          ? x
          : deps.grid.minX + (cellX + 0.08 + hashUnit(seed, key, 5) * 0.84) * cellSize
        const treeZ = item === 0
          ? z
          : deps.grid.minZ + (cellZ + 0.08 + hashUnit(seed, key, 6) * 0.84) * cellSize
        const treeY = deps.heightAt(treeX, treeZ)
        if (treeY == null || treeY < params.waterLevel + 2) {
          continue
        }
        if (item > 0) {
          const itemTreeLineFactor = slowroadsTreeLineFactor(treeY, treeLine)
          if (
            itemTreeLineFactor <= 0
            || hashUnit(seed, key, 8 + item) >= itemTreeLineFactor
          ) {
            continue
          }
        }
        scan.placements.push(makeTree(
          params,
          deps,
          treeX,
          treeZ,
          treeY,
          key,
          item,
          scan.placements.length,
          false,
        ))
      }
    }
    scan.col += 1
    if (scan.col >= scan.cols) {
      scan.col = 0
      scan.row += 1
    }
    scan.processedCells += 1
    budget -= 1
    if (scan.placements.length >= params.maxTrees) {
      scan.complete = true
    }
  }
  return scan.complete
}

export function planWorldForest(
  params: WorldForestPlanParams,
  deps: WorldForestPlanDeps,
  maxCells = 1_000_000,
): TreePlacement[] {
  const scan = createWorldForestScan(params, deps)
  while (!stepWorldForestScan(scan, deps, maxCells)) {
    // Offline/test helper: run to completion.
  }
  return scan.placements
}

/**
 * Roadside trees keep the nearest LOD populated along arbitrary road paths.
 * Distances use the exact road index, never the DEM row/column directions.
 */
export function planWorldForestCorridor(
  params: WorldForestPlanParams,
  deps: WorldForestPlanDeps,
  nodes: ReadonlyArray<RoadTraceNode>,
  options: {
    maxTrees?: number
    maxDistance?: number
    alongStep?: number
    lateralStep?: number
    nearBeltBands?: number
  } = {},
): TreePlacement[] {
  const roadField = deps.roadField
  if (!roadField || nodes.length < 2) {
    return []
  }
  const seed = params.seed >>> 0
  const treeLine: TreeLineBounds = slowroadsTreeLineBounds(deps.grid.minY, deps.grid.maxY)
  const maxTrees = Math.max(0, Math.floor(options.maxTrees ?? 30_000))
  const maxDistance = Math.max(params.roadClearance + 8, options.maxDistance ?? 150)
  const alongStep = Math.max(2, options.alongStep ?? 4)
  const lateralStep = Math.max(2, options.lateralStep ?? 10)
  const tierDensity = clamp01(params.densityMultiplier)
  const placements: TreePlacement[] = []
  const cumulative: number[] = [0]
  for (let index = 1; index < nodes.length; index += 1) {
    const previous = nodes[index - 1]!
    const current = nodes[index]!
    cumulative.push(cumulative[index - 1]! + Math.hypot(current.x - previous.x, current.z - previous.z))
  }
  const total = cumulative[cumulative.length - 1]!
  const sampleAt = (distance: number): { x: number; z: number; heading: number } | null => {
    const target = clamp(distance, 0, total)
    let low = 0
    let high = cumulative.length - 1
    while (low < high - 1) {
      const middle = (low + high) >> 1
      if (cumulative[middle]! <= target) low = middle
      else high = middle
    }
    const from = nodes[low]!
    const to = nodes[Math.min(nodes.length - 1, low + 1)]!
    const span = Math.max(1e-6, cumulative[Math.min(nodes.length - 1, low + 1)]! - cumulative[low]!)
    const t = (target - cumulative[low]!) / span
    return {
      x: from.x + (to.x - from.x) * t,
      z: from.z + (to.z - from.z) * t,
      heading: from.heading,
    }
  }
  const alongCount = Math.max(1, Math.ceil(total / alongStep))
  const bandCount = Math.max(1, Math.ceil((maxDistance - params.roadClearance) / lateralStep))
  const nearBeltBands = Math.max(0, Math.min(bandCount, Math.floor(options.nearBeltBands ?? 2)))
  for (let along = 0; along < alongCount && placements.length < maxTrees; along += 1) {
    const sample = sampleAt(along * alongStep)
    if (!sample) continue
    const dirX = Math.cos(sample.heading)
    const dirZ = Math.sin(sample.heading)
    const perpX = -dirZ
    const perpZ = dirX
    for (const side of [1, -1] as const) {
      for (let band = 0; band < bandCount && placements.length < maxTrees; band += 1) {
        const lateral = params.roadClearance + band * lateralStep
          + (hashUnit(seed, along, band * 16 + (side > 0 ? 1 : 2)) - 0.5) * lateralStep * 0.8
        const alongJitter = (hashUnit(seed, along, band * 16 + (side > 0 ? 3 : 4)) - 0.5) * alongStep
        const x = sample.x + dirX * alongJitter + perpX * side * lateral
        const z = sample.z + dirZ * alongJitter + perpZ * side * lateral
        if (!deps.grid.contains(x, z) || roadField.distanceAt(x, z) < params.roadClearance) {
          continue
        }
        const densityValue = deps.density.sampleUnit(x, z)
        const nearBelt = band < nearBeltBands
        const densityGate = nearBelt
          ? Math.max(0.7, densityValue * 0.95)
          : densityValue * 0.48
        if (hashUnit(seed, along, band * 16 + (side > 0 ? 5 : 6)) >= densityGate * tierDensity) {
          continue
        }
        const y = deps.heightAt(x, z)
        const slope = slopeAt(deps.grid, x, z)
        if (y == null || y < params.waterLevel + 2 || slope == null || slope > params.maxSlope) {
          continue
        }
        if (params.minHeight != null && y < params.minHeight) {
          continue
        }
        const treeLineFactor = slowroadsTreeLineFactor(y, treeLine)
        if (
          treeLineFactor <= 0
          || hashUnit(seed, along, band * 16 + (side > 0 ? 7 : 8))
            >= treeLineFactor
        ) {
          continue
        }
        const key = (along + 32768) * 65536 + (band + 32768)
        placements.push(makeTree(
          params,
          deps,
          x,
          z,
          y,
          key,
          seenSalt(side, band),
          placements.length,
          true,
        ))
      }
    }
  }
  return placements
}

function seenSalt(side: number, band: number): number {
  return 31 + side * 7 + band * 13
}

export interface WorldForestPlacementIndex {
  readonly placements: ReadonlyArray<TreePlacement>
  readonly cellSize: number
  readonly memoryBytes: number
  queryCircle(x: number, z: number, radius: number): TreePlacement[]
}

export function createWorldForestPlacementIndex(
  placements: ReadonlyArray<TreePlacement>,
  cellSize = 64,
): WorldForestPlacementIndex {
  const size = Math.max(16, cellSize)
  const buckets = new Map<number, number[]>()
  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index]!
    const key = cellKey(Math.floor(placement.x / size), Math.floor(placement.z / size))
    const bucket = buckets.get(key)
    if (bucket) bucket.push(index)
    else buckets.set(key, [index])
  }
  return {
    placements,
    cellSize: size,
    memoryBytes: placements.length * 48 + buckets.size * 40,
    queryCircle(x: number, z: number, radius: number): TreePlacement[] {
      const result: TreePlacement[] = []
      const radiusSq = Math.max(0, radius) ** 2
      const minX = Math.floor((x - radius) / size)
      const maxX = Math.floor((x + radius) / size)
      const minZ = Math.floor((z - radius) / size)
      const maxZ = Math.floor((z + radius) / size)
      for (let cellX = minX; cellX <= maxX; cellX += 1) {
        for (let cellZ = minZ; cellZ <= maxZ; cellZ += 1) {
          const bucket = buckets.get(cellKey(cellX, cellZ))
          if (!bucket) continue
          for (const index of bucket) {
            const placement = placements[index]
            if (!placement) continue
            const dx = placement.x - x
            const dz = placement.z - z
            if (dx * dx + dz * dz <= radiusSq) {
              result.push(placement)
            }
          }
        }
      }
      return result
    },
  }
}
