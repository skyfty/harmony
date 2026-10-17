import * as THREE from 'three'
import { fbm2 } from './noise'
import { createTerrainBounds, type TerrainBounds } from './terrainBounds'

/**
 * The lab's slowroads-style heightmap: seeded fbm noise sampled analytically
 * (equivalent to slowroads' `heightmap.getXZ`). Later, when the logic moves to
 * the editor, only this sampler is replaced by a GLB mesh sampler — every
 * consumer below (road trace, flattening, placement) works against this
 * interface.
 */
export interface HeightfieldOptions {
  seed: number
  worldSize: number
  baseAmplitude?: number
  detailAmplitude?: number
  baseWavelength?: number
  detailWavelength?: number
  waterLevel?: number
}

export interface Heightfield {
  /** Authoritative rectangular extent. The square aliases below only describe
   * the procedural fallback world. */
  bounds: TerrainBounds
  worldSize: number
  halfSize: number
  waterLevel: number
  minHeight: number
  maxHeight: number
  inBounds(x: number, z: number, margin?: number): boolean
  contains(x: number, z: number, margin?: number): boolean
  sampleHeight(x: number, z: number): number
  sampleNormal(x: number, z: number, target?: THREE.Vector3): THREE.Vector3
  /** 0 = flat, 1 = vertical. */
  sampleSlope(x: number, z: number): number
}

const NORMAL_EPSILON = 1.5

export function createHeightfield(options: HeightfieldOptions): Heightfield {
  const seed = options.seed >>> 0
  const worldSize = options.worldSize
  const halfSize = worldSize * 0.5
  const bounds = createTerrainBounds(-halfSize, -halfSize, halfSize, halfSize)
  const baseAmplitude = options.baseAmplitude ?? 30
  const detailAmplitude = options.detailAmplitude ?? 10
  const baseWavelength = options.baseWavelength ?? 520
  const detailWavelength = options.detailWavelength ?? 170
  const waterLevel = options.waterLevel ?? -12
  const detailSeed = (seed ^ 0x9e3779b9) >>> 0
  const midSeed = (seed ^ 0x27d4eb2f) >>> 0
  const midAmplitude = 8
  const midWavelength = 260

  const sampleHeight = (x: number, z: number): number => {
    const base = (fbm2(seed, x / baseWavelength, z / baseWavelength, 4) - 0.5) * 2
    const mid = (fbm2(midSeed, x / midWavelength, z / midWavelength, 2) - 0.5) * 2
    const detail = (fbm2(detailSeed, x / detailWavelength, z / detailWavelength, 2) - 0.5) * 2
    return base * baseAmplitude + mid * midAmplitude + detail * detailAmplitude
  }

  let minHeight = Number.POSITIVE_INFINITY
  let maxHeight = Number.NEGATIVE_INFINITY
  const probeStep = worldSize / 64
  for (let z = -halfSize; z <= halfSize + 1e-6; z += probeStep) {
    for (let x = -halfSize; x <= halfSize + 1e-6; x += probeStep) {
      const height = sampleHeight(x, z)
      if (height < minHeight) minHeight = height
      if (height > maxHeight) maxHeight = height
    }
  }

  return {
    bounds,
    worldSize,
    halfSize,
    waterLevel,
    minHeight,
    maxHeight,
    inBounds(x: number, z: number, margin = 0): boolean {
      return this.contains(x, z, margin)
    },
    contains(x: number, z: number, margin = 0): boolean {
      return x >= bounds.minX + margin && x <= bounds.maxX - margin
        && z >= bounds.minZ + margin && z <= bounds.maxZ - margin
    },
    sampleHeight,
    sampleNormal(x: number, z: number, target?: THREE.Vector3): THREE.Vector3 {
      const dx = (sampleHeight(x + NORMAL_EPSILON, z) - sampleHeight(x - NORMAL_EPSILON, z)) / (2 * NORMAL_EPSILON)
      const dz = (sampleHeight(x, z + NORMAL_EPSILON) - sampleHeight(x, z - NORMAL_EPSILON)) / (2 * NORMAL_EPSILON)
      const out = target ?? new THREE.Vector3()
      return out.set(-dx, 1, -dz).normalize()
    },
    sampleSlope(x: number, z: number): number {
      const normal = this.sampleNormal(x, z)
      return Math.max(0, 1 - normal.y)
    },
  }
}
