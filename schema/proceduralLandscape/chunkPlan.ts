import type { LandscapeDensityField } from './densityField'
import { chunkRandom } from './densityField'
import type { RoadFieldData } from './roadField'
import type { TerrainHeightGrid } from './terrainSampler'
import { clamp, clamp01, lerp, smoothstep } from './noise'

export interface LandscapeChunkDeps {
  grid: TerrainHeightGrid
  density: LandscapeDensityField
  roadField: RoadFieldData | null
}

export interface TreePlacement {
  x: number
  z: number
  y: number
  rotation: number
  scale: number
  /** Deterministic 0..1 value used to pick a texture variant at render time. */
  variant: number
  /** 0 = broadleaf（阔叶），1 = conifer（针叶）。 */
  species: 0 | 1
  /** Position in the deterministic candidate list; density tiers keep a prefix. */
  rank: number
}

export interface GrassPlacement extends TreePlacement {
  /** Meters to sink below the sampled terrain height (roadside grass). */
  sink: number
}

export interface TreeChunkParams {
  seed: number
  chunkX: number
  chunkZ: number
  chunkSize: number
  densityMultiplier: number
  maxSlope: number
  roadClearance: number
  roadHalfWidth: number
  roadShoulderWidth: number
  minScale: number
  maxScale: number
  minHeight: number | null
}

export interface RoadBucketParams {
  seed: number
  bucketIndex: number
  fromX: number
  fromZ: number
  toX: number
  toZ: number
  halfWidth: number
  shoulderWidth: number
  corridorWidth: number
  grassDensity: number
  sinkNearRoad: number
  bushesEnabled: boolean
  bushesDensity: number
}

export interface CameraGrassChunkParams {
  seed: number
  chunkX: number
  chunkZ: number
  chunkSize: number
  density: number
  maxSlope: number
  roadHalfWidth: number
  roadShoulderWidth: number
}

const TREE_BASE_PER_CLASS = 8
const MAX_TREE_CANDIDATES_PER_CHUNK = 64
const GRASS_ALONG_SPACING = 1.6
const GRASS_ACROSS_SPACING = 1.4
const CAMERA_GRASS_CANDIDATES = 6

function resolveSlopeFactor(normalY: number): number {
  const slope = clamp01(1 - normalY)
  return 1 - clamp01(slope / 0.6) * 0.8
}

export function planTreeChunk(params: TreeChunkParams, deps: LandscapeChunkDeps): TreePlacement[] {
  const { grid, density, roadField } = deps
  const baseX = params.chunkX * params.chunkSize
  const baseZ = params.chunkZ * params.chunkSize
  const half = params.chunkSize * 0.5

  let classSum = 0
  let classSamples = 0
  for (const [ox, oz] of [[0, 0], [half, 0], [0, half], [half, half], [half * 0.5, half * 0.5]] as const) {
    const x = baseX + ox
    const z = baseZ + oz
    if (!grid.contains(x, z)) {
      continue
    }
    classSum += density.sampleUnit(x, z) * 3
    classSamples += 1
  }
  if (!classSamples) {
    return []
  }
  const classAverage = classSum / classSamples
  if (classAverage <= 0.05) {
    return []
  }
  const candidateCount = Math.min(
    MAX_TREE_CANDIDATES_PER_CHUNK,
    Math.ceil(classAverage * TREE_BASE_PER_CLASS * params.densityMultiplier),
  )

  const placements: TreePlacement[] = []
  for (let i = 0; i < candidateCount; i += 1) {
    const x = baseX + chunkRandom(params.seed, params.chunkX, params.chunkZ, i, 1) * params.chunkSize
    const z = baseZ + chunkRandom(params.seed, params.chunkX, params.chunkZ, i, 2) * params.chunkSize
    if (!grid.contains(x, z)) {
      continue
    }
    const y = grid.sampleHeight(x, z)
    if (y == null) {
      continue
    }
    const normal = grid.sampleNormal(x, z)
    if (!normal) {
      continue
    }
    const slope = clamp01(1 - normal.y)
    if (slope > params.maxSlope) {
      continue
    }
    if (params.minHeight != null && y < params.minHeight) {
      continue
    }
    if (roadField) {
      const distance = roadField.distanceAt(x, z)
      if (distance < params.roadHalfWidth + params.roadShoulderWidth + params.roadClearance) {
        continue
      }
    }
    placements.push({
      x,
      z,
      y,
      rotation: chunkRandom(params.seed, params.chunkX, params.chunkZ, i, 3) * Math.PI * 2,
      scale: lerp(params.minScale, params.maxScale, chunkRandom(params.seed, params.chunkX, params.chunkZ, i, 4)),
      variant: chunkRandom(params.seed, params.chunkX, params.chunkZ, i, 5),
      species: chunkRandom(params.seed, params.chunkX, params.chunkZ, i, 7) < 0.4 ? 1 : 0,
      rank: i,
    })
  }
  return placements
}

export function planRoadBucket(
  params: RoadBucketParams,
  deps: LandscapeChunkDeps,
): { grass: GrassPlacement[]; bushes: GrassPlacement[] } {
  const { grid, roadField } = deps
  const dx = params.toX - params.fromX
  const dz = params.toZ - params.fromZ
  const segmentLength = Math.hypot(dx, dz)
  if (segmentLength <= 1e-4) {
    return { grass: [], bushes: [] }
  }
  const dirX = dx / segmentLength
  const dirZ = dz / segmentLength
  const perpX = -dirZ
  const perpZ = dirX

  const alongCount = Math.max(1, Math.ceil(segmentLength / GRASS_ALONG_SPACING))
  const lateralMax = params.halfWidth + params.corridorWidth
  const acrossCount = Math.max(1, Math.ceil((lateralMax - params.halfWidth) / GRASS_ACROSS_SPACING))
  const grass: GrassPlacement[] = []
  const bushes: GrassPlacement[] = []
  let candidateIndex = 0
  const bucketRandom = (index: number, salt: number): number =>
    chunkRandom(params.seed, params.bucketIndex, 739, index, salt)

  for (let along = 0; along < alongCount; along += 1) {
    const t = alongCount === 1 ? 0.5 : along / (alongCount - 1)
    const basePointX = params.fromX + dx * t
    const basePointZ = params.fromZ + dz * t
    for (let across = 1; across <= acrossCount; across += 1) {
      for (const side of [1, -1] as const) {
        const index = candidateIndex
        candidateIndex += 1
        const baseLateral = params.halfWidth + 0.35 + (across - 1) * GRASS_ACROSS_SPACING
        const alongJitter = (bucketRandom(index, 1) - 0.5) * GRASS_ALONG_SPACING
        const lateralJitter = (bucketRandom(index, 2) - 0.5) * GRASS_ACROSS_SPACING * 0.8
        const x = basePointX + dirX * alongJitter + perpX * side * (baseLateral + lateralJitter)
        const z = basePointZ + dirZ * alongJitter + perpZ * side * (baseLateral + lateralJitter)
        if (!grid.contains(x, z)) {
          continue
        }
        const distance = roadField ? roadField.distanceAt(x, z) : baseLateral
        if (distance < params.halfWidth + 0.35) {
          continue
        }
        if (distance > lateralMax) {
          continue
        }
        const y = grid.sampleHeight(x, z)
        if (y == null) {
          continue
        }
        const normal = grid.sampleNormal(x, z)
        if (!normal) {
          continue
        }
        const slope = clamp01(1 - normal.y)
        if (slope > 0.75) {
          continue
        }

        const corridorFalloff = 1 - smoothstep(
          params.halfWidth + params.corridorWidth * 0.55,
          params.halfWidth + params.corridorWidth,
          distance,
        )
        const slopeFactor = resolveSlopeFactor(normal.y)

        if (params.bushesEnabled) {
          const nearRoad = distance >= params.halfWidth + 0.4 && distance <= params.halfWidth + 4
          if (nearRoad) {
            const bushChance = params.bushesDensity * 0.05 * corridorFalloff
            if (bucketRandom(index, 3) < bushChance) {
              bushes.push({
                x,
                z,
                y,
                rotation: bucketRandom(index, 4) * Math.PI * 2,
                scale: 0.7 + bucketRandom(index, 5) * 0.7,
                variant: bucketRandom(index, 6),
                species: 0,
                rank: index,
                sink: 0,
              })
            }
          }
        }

        const grassChance = corridorFalloff * slopeFactor * params.grassDensity * 0.5
        if (bucketRandom(index, 7) >= grassChance) {
          continue
        }
        const sinkFraction = 1 - clamp01((distance - params.halfWidth) / 1.5)
        grass.push({
          x,
          z,
          y: y - params.sinkNearRoad * sinkFraction,
          rotation: bucketRandom(index, 8) * Math.PI * 2,
          scale: 0.7 + bucketRandom(index, 9) * 0.6,
          variant: bucketRandom(index, 10),
          species: 0,
          rank: index,
          sink: params.sinkNearRoad * sinkFraction,
        })
      }
    }
  }
  return { grass, bushes }
}

export function planCameraGrassChunk(
  params: CameraGrassChunkParams,
  deps: LandscapeChunkDeps,
): GrassPlacement[] {
  const { grid, density, roadField } = deps
  const baseX = params.chunkX * params.chunkSize
  const baseZ = params.chunkZ * params.chunkSize
  const placements: GrassPlacement[] = []
  for (let i = 0; i < CAMERA_GRASS_CANDIDATES; i += 1) {
    const x = baseX + chunkRandom(params.seed, params.chunkX, params.chunkZ, i, 1) * params.chunkSize
    const z = baseZ + chunkRandom(params.seed, params.chunkX, params.chunkZ, i, 2) * params.chunkSize
    if (!grid.contains(x, z)) {
      continue
    }
    const y = grid.sampleHeight(x, z)
    if (y == null) {
      continue
    }
    const normal = grid.sampleNormal(x, z)
    if (!normal) {
      continue
    }
    const slope = clamp01(1 - normal.y)
    if (slope > params.maxSlope) {
      continue
    }
    if (roadField) {
      const distance = roadField.distanceAt(x, z)
      if (distance < params.roadHalfWidth + 0.3) {
        continue
      }
    }
    const forestClass = density.sampleUnit(x, z) * 3
    const suppression = 1 - clamp01(forestClass / 3) * 0.65
    const chance = clamp01(resolveSlopeFactor(normal.y) * suppression * params.density * 0.5)
    if (chunkRandom(params.seed, params.chunkX, params.chunkZ, i, 3) >= chance) {
      continue
    }
    placements.push({
      x,
      z,
      y,
      rotation: chunkRandom(params.seed, params.chunkX, params.chunkZ, i, 4) * Math.PI * 2,
      scale: 0.6 + chunkRandom(params.seed, params.chunkX, params.chunkZ, i, 5) * 0.6,
      variant: chunkRandom(params.seed, params.chunkX, params.chunkZ, i, 6),
      species: 0,
      rank: i,
      sink: 0,
    })
  }
  return placements
}

export function takeDensityPrefix<T extends { rank: number }>(items: T[], multiplier: number): T[] {
  if (!items.length) {
    return items
  }
  const ratio = clamp(multiplier, 0, 1)
  if (ratio <= 0) {
    return []
  }
  const count = Math.max(1, Math.ceil(items.length * ratio))
  return count >= items.length ? items : items.slice(0, count)
}
