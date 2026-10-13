import * as THREE from 'three'
import { clamp01, fbm2, hashUnit, lerp } from './noise'

/**
 * A coarse, deterministic scalar field baked over the terrain AABB.
 *
 * The forest density field mirrors slowroads' `treeMap`: values are classified
 * into 0..3 density levels. The very same bytes are uploaded as a DataTexture
 * so the surface shader's canopy mask always matches the CPU side tree
 * placement.
 */
export interface LandscapeDensityField {
  width: number
  height: number
  /** Encoded 0..255 payload (unit value). */
  data: Uint8Array
  minX: number
  minZ: number
  sizeX: number
  sizeZ: number
  sampleUnit(x: number, z: number): number
  memoryBytes: number
}

export interface LandscapeDensityFieldOptions {
  minX: number
  minZ: number
  sizeX: number
  sizeZ: number
  seed: number
  seedOffset?: number
  /** World-space wavelength of the base noise octave. */
  scale: number
  resolution?: number
}

export function densityClassFromNoise(value: number, coverage: number): 0 | 1 | 2 | 3 {
  const c = clamp01(coverage)
  if (c <= 0) {
    return 0
  }
  const t1 = 0.62 - 0.25 * c
  const t2 = 0.74 - 0.22 * c
  const t3 = 0.86 - 0.18 * c
  if (value >= t3) {
    return 3
  }
  if (value >= t2) {
    return 2
  }
  if (value >= t1) {
    return 1
  }
  return 0
}

function resolveResolution(resolution: number | undefined): number {
  const requested = Number.isFinite(resolution) && (resolution as number) > 0 ? Math.round(resolution as number) : 256
  return Math.max(16, Math.min(1024, requested))
}

function createField(
  options: LandscapeDensityFieldOptions,
  evaluate: (x: number, z: number) => number,
): LandscapeDensityField {
  const sizeX = Math.max(1e-3, options.sizeX)
  const sizeZ = Math.max(1e-3, options.sizeZ)
  const width = resolveResolution(options.resolution)
  const aspect = sizeZ / sizeX
  const height = Math.max(16, Math.min(1024, Math.round(width * aspect)))
  const data = new Uint8Array(width * height)

  for (let row = 0; row < height; row += 1) {
    const vz = height === 1 ? 0 : row / (height - 1)
    const z = options.minZ + vz * sizeZ
    for (let col = 0; col < width; col += 1) {
      const vx = width === 1 ? 0 : col / (width - 1)
      const x = options.minX + vx * sizeX
      data[row * width + col] = Math.round(clamp01(evaluate(x, z)) * 255)
    }
  }

  return {
    width,
    height,
    data,
    minX: options.minX,
    minZ: options.minZ,
    sizeX,
    sizeZ,
    sampleUnit(x: number, z: number): number {
      const fx = clamp01((x - this.minX) / this.sizeX)
      const fz = clamp01((z - this.minZ) / this.sizeZ)
      const col = Math.min(this.width - 1, Math.max(0, Math.round(fx * (this.width - 1))))
      const row = Math.min(this.height - 1, Math.max(0, Math.round(fz * (this.height - 1))))
      return (this.data[row * this.width + col] ?? 0) / 255
    },
    memoryBytes: data.byteLength,
  }
}

export function buildForestDensityField(
  options: LandscapeDensityFieldOptions & { coverage: number },
): LandscapeDensityField {
  const seed = (options.seed ^ (options.seedOffset ?? 0)) >>> 0
  const scale = Math.max(8, options.scale)
  return createField(options, (x, z) => {
    const value = fbm2(seed, x / scale, z / scale, 3, 2.05, 0.52)
    const classValue = densityClassFromNoise(value, options.coverage)
    return classValue / 3
  })
}

export function buildVariationField(options: LandscapeDensityFieldOptions): LandscapeDensityField {
  const seed = (options.seed ^ 0x51ed270b) >>> 0
  const scale = Math.max(16, options.scale * 0.35)
  return createField(options, (x, z) => {
    const value = fbm2(seed, x / scale, z / scale, 2, 2.1, 0.55)
    return lerp(0.35, 1, value)
  })
}

export function forestDensityClassAt(field: LandscapeDensityField, x: number, z: number): number {
  return Math.round(field.sampleUnit(x, z) * 3)
}

export function createDensityDataTexture(field: LandscapeDensityField): THREE.DataTexture {
  const rgba = new Uint8Array(field.width * field.height * 4)
  for (let i = 0; i < field.width * field.height; i += 1) {
    const value = field.data[i] ?? 0
    rgba[i * 4] = value
    rgba[i * 4 + 1] = value
    rgba[i * 4 + 2] = value
    rgba[i * 4 + 3] = 255
  }
  const texture = new THREE.DataTexture(rgba, field.width, field.height, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

/** Stable per-chunk deterministic random helper used by the placement planner. */
export function chunkRandom(seed: number, chunkX: number, chunkZ: number, index: number, salt: number): number {
  const key = Math.imul(chunkX | 0, 73856093) ^ Math.imul(chunkZ | 0, 19349663) ^ Math.imul(salt | 0, 83492791)
  return hashUnit(seed, key | 0, (index | 0) * 131 + (salt | 0))
}
