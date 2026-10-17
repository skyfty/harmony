import type { LandscapeDensityField } from './densityField'
import { chunkRandom } from './densityField'
import type { RoadDistanceSource } from './roadProximity'
import type { TerrainHeightGrid } from './terrainSampler'
import { clamp, clamp01, lerp, smoothstep } from './noise'

export interface LandscapeChunkDeps {
  grid: TerrainHeightGrid
  density: LandscapeDensityField
  /**
   * 距离来源：生产路径传精确道路距离索引（`roadProximity.ts`），
   * 光栅距离场（`roadField.ts`）只服务着色器与地形压平。
   */
  roadField: RoadDistanceSource | null
  /** Final visible surface (roadbed included). Defaults to the raw grid. */
  surfaceHeightAt?: (x: number, z: number) => number | null
  /** Normal of the final visible surface. Defaults to the raw grid. */
  surfaceNormalAt?: (x: number, z: number) => { x: number; y: number; z: number } | null
}

export interface TreePlacement {
  x: number
  z: number
  y: number
  rotation: number
  /**
   * 树的世界高度（米）。树卡层按 `scale / TREE_UNIT_SIZE` 换算为 8m 基准倍率，
   * 近树网格层（treeMeshes）直接按米制渲染（世界高度 = scale），两层同尺寸。
   */
  scale: number
  /** Deterministic 0..1 value used to pick a texture variant at render time. */
  variant: number
  /** 0 = broadleaf（阔叶），1 = conifer（针叶）。 */
  species: 0 | 1
  /** Position in the deterministic candidate list; density tiers keep a prefix. */
  rank: number
}

/**
 * 草丛/灌木放置。
 *
 * 注意 `scale` 语义与树不同：这里是对应精灵基准尺寸（草 1.6m / 灌木 2m）的摆放倍率
 * （对齐 slowroads-lab），世界尺寸 = 基准 × 倍率 × 区域相对高度，不是米。
 */
export interface GrassPlacement extends TreePlacement {
  /** Meters to sink below the sampled terrain height (roadside grass). */
  sink: number
  /** 官方 roadProx = 距路缘距离 - halfWidth（草丛调色板贴近道路时的明度抑制）。 */
  roadProx?: number
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
  /** 水线（世界 Y）；水线以下 0.5m 内不生草。 */
  waterLevel: number
  /** 花草密度倍率（花走灌木层，lab flowerDensity）。 */
  flowerDensity: number
  /** 高草密度倍率（高草走草层 cell 2/3，lab tallGrassDensity）。 */
  tallGrassDensity: number
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

// 与 slowroads-lab 的树/草密度对齐（lab 世界约 15.5k 树/km²、草走廊近 0.9/m²）。
// 分块边长 192m（36,864 m²）：类均值≈1.5 时 224×1.5≈336 棵/分块 ≈ 9.1k 树/km²。
const TREE_BASE_PER_CLASS = 224
const MAX_TREE_CANDIDATES_PER_CHUNK = 768
const GRASS_ALONG_SPACING = 1.2
const GRASS_ACROSS_SPACING = 1.0
const CAMERA_GRASS_CANDIDATES = 6

function resolveSlopeFactor(normalY: number): number {
  const slope = clamp01(1 - normalY)
  return 1 - clamp01(slope / 0.6) * 0.8
}

/** lab `heightFactor`：水线以上 2m 内线性淡出。 */
function resolveHeightFactor(height: number, waterLevel: number): number {
  const aboveWater = height - waterLevel
  if (aboveWater <= 0) {
    return 0
  }
  return aboveWater >= 2 ? 1 : clamp01(aboveWater / 2)
}

export function planTreeChunk(params: TreeChunkParams, deps: LandscapeChunkDeps): TreePlacement[] {
  const { grid, density, roadField } = deps
  const heightAt = deps.surfaceHeightAt ?? ((x: number, z: number) => grid.sampleHeight(x, z))
  const normalAt = deps.surfaceNormalAt ?? ((x: number, z: number) => grid.sampleNormal(x, z))
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
    const y = heightAt(x, z)
    if (y == null) {
      continue
    }
    const normal = normalAt(x, z)
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
  const heightAt = deps.surfaceHeightAt ?? ((x: number, z: number) => grid.sampleHeight(x, z))
  const normalAt = deps.surfaceNormalAt ?? ((x: number, z: number) => grid.sampleNormal(x, z))
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
        const y = heightAt(x, z)
        if (y == null) {
          continue
        }
        const normal = normalAt(x, z)
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
        const heightFactor = resolveHeightFactor(y, params.waterLevel)
        if (heightFactor <= 0) {
          continue
        }

        if (params.bushesEnabled) {
          const nearRoad = distance >= params.halfWidth + 0.4 && distance <= params.halfWidth + 4
          if (nearRoad) {
            const bushChance = params.bushesDensity * 0.05 * corridorFalloff * heightFactor
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
                roadProx: distance - params.halfWidth,
              })
            }
          }
        }

        const grassChance = corridorFalloff * slopeFactor * heightFactor * params.grassDensity * 0.85
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
          roadProx: distance - params.halfWidth,
        })
      }
    }
  }

  // ---- 花草层（→ 灌木层）与高草层（→ 草层）：比路缘带更靠外（lab
  // computeLayerPlacements）。花草横向 0.5..6m、高草 1m..min(20, 走廊宽)。
  const layerRandom = (along: number, keyB: number, salt: number): number =>
    chunkRandom(params.seed, params.bucketIndex, 741, along * 8192 + keyB, salt)
  const emitOuterLayer = (kind: 'flower' | 'tallGrass'): void => {
    const isFlower = kind === 'flower'
    const density = isFlower ? params.flowerDensity : params.tallGrassDensity
    if (density <= 0) {
      return
    }
    const alongStep = isFlower ? 1.5 : 1.2
    const acrossStep = isFlower ? 0.9 : 1.3
    const lateralStart = isFlower ? 0.5 : 1.0
    const lateralEnd = isFlower ? 6 : Math.max(6, Math.min(20, params.corridorWidth))
    const alongCount = Math.max(1, Math.ceil(segmentLength / alongStep))
    const lateralCount = Math.max(1, Math.ceil((lateralEnd - lateralStart) / acrossStep))
    for (let along = 0; along < alongCount; along += 1) {
      const t = alongCount === 1 ? 0.5 : along / (alongCount - 1)
      const sampleX = params.fromX + dx * t
      const sampleZ = params.fromZ + dz * t
      for (let lateralIndex = 0; lateralIndex < lateralCount; lateralIndex += 1) {
        const baseLateral = params.halfWidth + lateralStart + lateralIndex * acrossStep
        for (const side of [1, -1] as const) {
          const keyB = (side > 0 ? 1 : 0) * 4096 + lateralIndex
          const jitterAlong = (layerRandom(along, keyB, 1) - 0.5) * alongStep
          const jitterLateral = (layerRandom(along, keyB, 2) - 0.5) * acrossStep * 0.8
          const lateral = baseLateral + jitterLateral
          const x = sampleX + dirX * jitterAlong + perpX * side * lateral
          const z = sampleZ + dirZ * jitterAlong + perpZ * side * lateral
          if (!grid.contains(x, z)) {
            continue
          }
          const distance = roadField ? roadField.distanceAt(x, z) : lateral
          if (distance < params.halfWidth + lateralStart - 0.2 || distance > params.halfWidth + lateralEnd + 0.6) {
            continue
          }
          const y = heightAt(x, z)
          if (y == null) {
            continue
          }
          const heightFactor = resolveHeightFactor(y, params.waterLevel)
          if (heightFactor <= 0) {
            continue
          }
          const normal = normalAt(x, z)
          if (!normal) {
            continue
          }
          const slope = clamp01(1 - normal.y)
          if (slope > 0.7) {
            continue
          }
          const falloff = isFlower
            ? 1 - smoothstep(params.halfWidth + 3.0, params.halfWidth + lateralEnd, distance)
            : 1 - smoothstep(params.halfWidth + lateralEnd * 0.55, params.halfWidth + lateralEnd, distance)
          const chance = falloff * resolveSlopeFactor(normal.y) * heightFactor * density * (isFlower ? 0.5 : 0.55)
          if (layerRandom(along, keyB, 3) >= chance) {
            continue
          }
          const variantHash = layerRandom(along, keyB, 6)
          const placement: GrassPlacement = {
            x,
            z,
            // lab：花草层贴地 -0.12；高草贴地。
            y: isFlower ? y - 0.12 : y,
            rotation: layerRandom(along, keyB, 4) * Math.PI * 2,
            scale: isFlower
              ? 0.8 + layerRandom(along, keyB, 5) * 0.5
              : 0.7 + layerRandom(along, keyB, 5) * 0.6,
            // 高草偏向大草格（cell 2）；花草均匀分布。
            variant: isFlower ? variantHash : 0.38 + variantHash * 0.37,
            species: 0,
            rank: lateralIndex,
            sink: isFlower ? 0.12 : 0,
            roadProx: distance - params.halfWidth,
          }
          if (isFlower) {
            if (params.bushesEnabled) {
              bushes.push(placement)
            }
          } else {
            grass.push(placement)
          }
        }
      }
    }
  }
  emitOuterLayer('flower')
  emitOuterLayer('tallGrass')

  return { grass, bushes }
}

export function planCameraGrassChunk(
  params: CameraGrassChunkParams,
  deps: LandscapeChunkDeps,
): GrassPlacement[] {
  const { grid, density, roadField } = deps
  const heightAt = deps.surfaceHeightAt ?? ((x: number, z: number) => grid.sampleHeight(x, z))
  const normalAt = deps.surfaceNormalAt ?? ((x: number, z: number) => grid.sampleNormal(x, z))
  const baseX = params.chunkX * params.chunkSize
  const baseZ = params.chunkZ * params.chunkSize
  const placements: GrassPlacement[] = []
  for (let i = 0; i < CAMERA_GRASS_CANDIDATES; i += 1) {
    const x = baseX + chunkRandom(params.seed, params.chunkX, params.chunkZ, i, 1) * params.chunkSize
    const z = baseZ + chunkRandom(params.seed, params.chunkX, params.chunkZ, i, 2) * params.chunkSize
    if (!grid.contains(x, z)) {
      continue
    }
    const y = heightAt(x, z)
    if (y == null) {
      continue
    }
    const normal = normalAt(x, z)
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
          roadProx: roadField ? Math.max(0, roadField.distanceAt(x, z) - params.roadHalfWidth) : 0,
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
