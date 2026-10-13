import type { Heightfield } from './heightfield'
import { bakeTerrainHeight, type RoadProfile } from './roadProfile'
import { clamp01, fbm2, hashUnit, smoothstep } from './noise'
import {
  FLOWER_REGIONS,
  NEAR_BROADLEAF_REGIONS,
  NEAR_CONIFER_REGIONS,
  TALL_GRASS_REGIONS,
  TREE_FAR_VARIANTS,
} from './spriteRegions'

/**
 * slowroads-style placement rules:
 *  - trees come from a 0..3 class density map, `ceil(1.4 * (class + rand))`
 *    candidates per 10m cell, filtered by slope / height / road clearance;
 *  - grass lives only inside the road corridor (dense at the edge, thinning
 *    outward, sunk into the verge);
 *  - bushes form a narrow band next to the road.
 */
export interface LabPlacementSettings {
  seed: number
  worldSize: number
  treeDensity: number
  treeSize: number
  grassCorridor: number
  grassDensity: number
  bushDensity: number
  flowerDensity: number
  tallGrassDensity: number
}

export interface TreePlacement {
  x: number
  z: number
  y: number
  rotation: number
  scale: number
  /** 近树卡变体（打包图集区域下标）。 */
  variantNear: number
  /** 远树 imposters 变体（16×4 网格下标）。 */
  variantFar: number
  /** 0 = broadleaf atlas, 1 = conifer atlas. */
  species: 0 | 1
}

export interface SpritePlacement {
  x: number
  z: number
  y: number
  rotation: number
  scale: number
  variant: number
}

export interface LabPlacements {
  trees: TreePlacement[]
  grass: SpritePlacement[]
  bushes: SpritePlacement[]
  flowers: SpritePlacement[]
  tallGrass: SpritePlacement[]
}

export interface TreeDensityField {
  sampleUnit(x: number, z: number): number
  classAt(x: number, z: number): 0 | 1 | 2 | 3
}

export const BROADLEAF_VARIANTS = 3
export const CONIFER_VARIANTS = 8
export const GRASS_VARIANTS = 4
export const BUSH_VARIANTS = 8
export const NEAR_TREE_VARIANTS: Record<0 | 1, number> = {
  0: NEAR_BROADLEAF_REGIONS.length,
  1: NEAR_CONIFER_REGIONS.length,
}

const TREE_CELL_SIZE = 10
const TREE_SLOPE_LIMIT = 0.2
const TREE_ROAD_CLEARANCE = 2
const GRASS_STEP_ALONG = 1.0
const GRASS_STEP_ACROSS = 1.0
const BUSH_STEP_ALONG = 2.0
const BUSH_STEP_ACROSS = 0.9
const MAX_TREES = 120000
const MAX_GRASS = 60000
const MAX_BUSHES = 20000
const MAX_FLOWERS = 12000
const MAX_TALL_GRASS = 20000

export function createTreeDensityField(seed: number, worldSize: number): TreeDensityField {
  const densitySeed = (seed ^ 0x51ed270b) >>> 0
  const wavelength = worldSize * 0.28
  const sampleUnit = (x: number, z: number): number => {
    const value = fbm2(densitySeed, x / wavelength, z / wavelength, 3, 2.05, 0.52)
    return clamp01(value)
  }
  return {
    sampleUnit,
    classAt(x: number, z: number): 0 | 1 | 2 | 3 {
      const value = sampleUnit(x, z)
      if (value >= 0.78) return 3
      if (value >= 0.64) return 2
      if (value >= 0.50) return 1
      return 0
    },
  }
}

function heightFactor(height: number, waterLevel: number): number {
  const aboveWater = height - waterLevel
  if (aboveWater <= 0) {
    return 0
  }
  return aboveWater >= 2 ? 1 : clamp01(aboveWater / 2)
}

function slopeFactor(slop: number): number {
  if (slop > 0.75) {
    return 0
  }
  return 1 - clamp01(slop / 0.6) * 0.85
}

export function computePlacements(
  field: Heightfield,
  profile: RoadProfile,
  density: TreeDensityField,
  settings: LabPlacementSettings,
): LabPlacements {
  return {
    trees: computeTreePlacements(field, profile, density, settings),
    grass: computeCorridorPlacements(field, profile, settings, 'grass'),
    bushes: computeCorridorPlacements(field, profile, settings, 'bush'),
    flowers: computeLayerPlacements(field, profile, settings, 'flower'),
    tallGrass: computeLayerPlacements(field, profile, settings, 'tallGrass'),
  }
}

function computeTreePlacements(
  field: Heightfield,
  profile: RoadProfile,
  density: TreeDensityField,
  settings: LabPlacementSettings,
): TreePlacement[] {
  const seed = settings.seed >>> 0
  const cells = Math.floor(settings.worldSize / TREE_CELL_SIZE)
  const halfCells = cells / 2
  const trees: TreePlacement[] = []
  const clearance = profile.halfWidth + profile.shoulderWidth + TREE_ROAD_CLEARANCE

  for (let cellZ = 0; cellZ < cells && trees.length < MAX_TREES; cellZ += 1) {
    for (let cellX = 0; cellX < cells && trees.length < MAX_TREES; cellX += 1) {
      const cellKey = (cellX + 2048) * 4096 + (cellZ + 2048)
      const centerX = (cellX - halfCells + 0.5) * TREE_CELL_SIZE
      const centerZ = (cellZ - halfCells + 0.5) * TREE_CELL_SIZE
      const densityClass = density.classAt(centerX, centerZ)
      if (densityClass === 0) {
        continue
      }
      const unitDensity = densityClass / 3
      const baseCount = Math.ceil(1.4 * (densityClass + hashUnit(seed, cellKey, 101)))
      const count = Math.round(baseCount * settings.treeDensity)
      for (let i = 0; i < count; i += 1) {
        const jitterX = 0.05 + 0.9 * hashUnit(seed, cellKey, i * 8 + 1)
        const jitterZ = 0.05 + 0.9 * hashUnit(seed, cellKey, i * 8 + 2)
        const x = (cellX - halfCells + jitterX) * TREE_CELL_SIZE
        const z = (cellZ - halfCells + jitterZ) * TREE_CELL_SIZE
        if (!field.inBounds(x, z, 8)) {
          continue
        }
        // Use the flattened (baked) terrain height so trees sit on the visible
        // surface, not on the raw noise height under the road cut.
        const y = bakeTerrainHeight(field, profile, x, z).height
        if (y < field.waterLevel + 2) {
          continue
        }
        if (field.sampleSlope(x, z) > TREE_SLOPE_LIMIT) {
          continue
        }
        if (profile.distanceTo(x, z) < clearance) {
          continue
        }
        const baseScale = 1 + 0.15 * (3 * unitDensity - 1)
        const scaleJitter = 1 + (hashUnit(seed, cellKey, i * 8 + 3) - 0.5) * 0.4
        const species: 0 | 1 = hashUnit(seed, cellKey, i * 8 + 4) < 0.5 ? 0 : 1
        const nearVariants = NEAR_TREE_VARIANTS[species]
        trees.push({
          x,
          z,
          y,
          rotation: hashUnit(seed, cellKey, i * 8 + 5) * Math.PI * 2,
          scale: baseScale * scaleJitter * settings.treeSize,
          variantNear: Math.min(nearVariants - 1, Math.floor(hashUnit(seed, cellKey, i * 8 + 6) * nearVariants)),
          variantFar: Math.min(TREE_FAR_VARIANTS - 1, Math.floor(hashUnit(seed, cellKey, i * 8 + 7) * TREE_FAR_VARIANTS)),
          species,
        })
      }
    }
  }
  return trees
}

function computeCorridorPlacements(
  field: Heightfield,
  profile: RoadProfile,
  settings: LabPlacementSettings,
  kind: 'grass' | 'bush',
): SpritePlacement[] {
  const seed = (settings.seed ^ (kind === 'grass' ? 0x9a13 : 0x44c1)) >>> 0
  const out: SpritePlacement[] = []
  const cap = kind === 'grass' ? MAX_GRASS : MAX_BUSHES
  const maxDistance = kind === 'grass'
    ? settings.grassCorridor
    : 4
  const alongStep = kind === 'grass' ? GRASS_STEP_ALONG : BUSH_STEP_ALONG
  const acrossStep = kind === 'grass' ? GRASS_STEP_ACROSS : BUSH_STEP_ACROSS
  const lateralStart = kind === 'grass' ? 0.45 : 0.5
  const lateralEnd = kind === 'grass'
    ? settings.grassCorridor
    : maxDistance
  const lateralCount = Math.max(1, Math.ceil((lateralEnd - lateralStart) / acrossStep))
  const alongCount = Math.max(1, Math.ceil(profile.length / alongStep))

  for (let along = 0; along < alongCount && out.length < cap; along += 1) {
    const sample = profile.sampleAt(along * alongStep)
    const dirX = Math.cos(sample.heading)
    const dirZ = Math.sin(sample.heading)
    const perpX = -dirZ
    const perpZ = dirX
    for (let lateralIndex = 0; lateralIndex < lateralCount; lateralIndex += 1) {
      const baseLateral = profile.halfWidth + lateralStart + lateralIndex * acrossStep
      for (const side of [1, -1]) {
        const keyB = (side > 0 ? 1 : 0) * 4096 + lateralIndex
        const jitterAlong = (hashUnit(seed, along, keyB * 8 + 1) - 0.5) * alongStep
        const jitterLateral = (hashUnit(seed, along, keyB * 8 + 2) - 0.5) * acrossStep * 0.8
        const lateral = baseLateral + jitterLateral
        const x = sample.x + dirX * jitterAlong + perpX * side * lateral
        const z = sample.z + dirZ * jitterAlong + perpZ * side * lateral
        if (!field.inBounds(x, z, 4)) {
          continue
        }
        const distance = profile.distanceTo(x, z)
        if (kind === 'grass' && (distance < profile.halfWidth + 0.35 || distance > profile.halfWidth + settings.grassCorridor)) {
          continue
        }
        if (kind === 'bush' && (distance < profile.halfWidth + 0.4 || distance > profile.halfWidth + 4)) {
          continue
        }
        const y = bakeTerrainHeight(field, profile, x, z).height
        if (y < field.waterLevel + 0.5) {
          continue
        }
        const slope = field.sampleSlope(x, z)
        if (slope > 0.75) {
          continue
        }

        let chance: number
        if (kind === 'grass') {
          const corridor = settings.grassCorridor
          const corridorFalloff = 1 - smoothstep(
            profile.halfWidth + corridor * 0.55,
            profile.halfWidth + corridor,
            distance,
          )
          chance = corridorFalloff * slopeFactor(slope) * heightFactor(y, field.waterLevel) * settings.grassDensity * 0.75
        } else {
          const band = smoothstep(profile.halfWidth + 0.4, profile.halfWidth + 1.2, distance)
            * (1 - smoothstep(profile.halfWidth + 2.5, profile.halfWidth + 4, distance))
          chance = band * slopeFactor(slope) * heightFactor(y, field.waterLevel) * settings.bushDensity * 0.35
        }
        if (hashUnit(seed, along, keyB * 8 + 3) >= chance) {
          continue
        }

        let sink = 0
        if (kind === 'grass') {
          const edge = profile.halfWidth + 1.2
          sink = distance < edge ? edge - distance : distance / 20
        }
        const variantCount = kind === 'grass' ? GRASS_VARIANTS : BUSH_VARIANTS
        out.push({
          x,
          z,
          y: y - sink,
          rotation: hashUnit(seed, along, keyB * 8 + 4) * Math.PI * 2,
          scale: kind === 'grass'
            ? 0.7 + hashUnit(seed, along, keyB * 8 + 5) * 0.6
            : 0.7 + hashUnit(seed, along, keyB * 8 + 5) * 0.7,
          variant: Math.min(variantCount - 1, Math.floor(hashUnit(seed, along, keyB * 8 + 6) * variantCount)),
        })
      }
    }
  }
  return out
}

/**
 * 花草层与高草层：都贴着道路走廊生长，但比路缘草带更靠外，
 * 用各自的门限 + 坡度/高度过滤控制密度。
 */
function computeLayerPlacements(
  field: Heightfield,
  profile: RoadProfile,
  settings: LabPlacementSettings,
  kind: 'flower' | 'tallGrass',
): SpritePlacement[] {
  const isFlower = kind === 'flower'
  const seed = (settings.seed ^ (isFlower ? 0x4d2b : 0x7a51)) >>> 0
  const alongStep = isFlower ? 1.5 : 1.2
  const acrossStep = isFlower ? 0.9 : 1.3
  const lateralStart = isFlower ? 0.5 : 1.0
  const lateralEnd = isFlower ? 6 : Math.max(6, Math.min(20, settings.grassCorridor))
  const lateralCount = Math.max(1, Math.ceil((lateralEnd - lateralStart) / acrossStep))
  const alongCount = Math.max(1, Math.ceil(profile.length / alongStep))
  const cap = isFlower ? MAX_FLOWERS : MAX_TALL_GRASS
  const density = isFlower ? settings.flowerDensity : settings.tallGrassDensity
  const variantCount = isFlower ? FLOWER_REGIONS.length : TALL_GRASS_REGIONS.length
  const out: SpritePlacement[] = []

  for (let along = 0; along < alongCount && out.length < cap; along += 1) {
    const sample = profile.sampleAt(along * alongStep)
    const dirX = Math.cos(sample.heading)
    const dirZ = Math.sin(sample.heading)
    const perpX = -dirZ
    const perpZ = dirX
    for (let lateralIndex = 0; lateralIndex < lateralCount; lateralIndex += 1) {
      const baseLateral = profile.halfWidth + lateralStart + lateralIndex * acrossStep
      for (const side of [1, -1]) {
        const keyB = (side > 0 ? 1 : 0) * 4096 + lateralIndex
        const jitterAlong = (hashUnit(seed, along, keyB * 8 + 1) - 0.5) * alongStep
        const jitterLateral = (hashUnit(seed, along, keyB * 8 + 2) - 0.5) * acrossStep * 0.8
        const lateral = baseLateral + jitterLateral
        const x = sample.x + dirX * jitterAlong + perpX * side * lateral
        const z = sample.z + dirZ * jitterAlong + perpZ * side * lateral
        if (!field.inBounds(x, z, 4)) {
          continue
        }
        const distance = profile.distanceTo(x, z)
        if (distance < profile.halfWidth + lateralStart - 0.2 || distance > profile.halfWidth + lateralEnd + 0.6) {
          continue
        }
        const y = bakeTerrainHeight(field, profile, x, z).height
        if (y < field.waterLevel + 0.5) {
          continue
        }
        const slope = field.sampleSlope(x, z)
        if (slope > 0.7) {
          continue
        }
        const falloff = isFlower
          ? 1 - smoothstep(profile.halfWidth + 3.0, profile.halfWidth + lateralEnd, distance)
          : 1 - smoothstep(profile.halfWidth + lateralEnd * 0.55, profile.halfWidth + lateralEnd, distance)
        const chance = falloff * slopeFactor(slope) * heightFactor(y, field.waterLevel) * density * (isFlower ? 0.5 : 0.55)
        if (hashUnit(seed, along, keyB * 8 + 3) >= chance) {
          continue
        }
        out.push({
          x,
          z,
          y: y - 0.12,
          rotation: hashUnit(seed, along, keyB * 8 + 4) * Math.PI * 2,
          scale: isFlower
            ? 0.8 + hashUnit(seed, along, keyB * 8 + 5) * 0.5
            : 0.7 + hashUnit(seed, along, keyB * 8 + 5) * 0.6,
          variant: Math.min(variantCount - 1, Math.floor(hashUnit(seed, along, keyB * 8 + 6) * variantCount)),
        })
      }
    }
  }
  return out
}
