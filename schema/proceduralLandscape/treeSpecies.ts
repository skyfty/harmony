import { clamp01, fbm2 } from './noise'

/**
 * slowroads.io main-forest tree types.
 *
 * The official terrain forest does not roll a per-tree 25% conifer chance.
 * `getTreesAt()` reads a low-frequency `typeMap` and rounds it at 0.5, which
 * produces broadleaf / conifer stands. The map uses a 3000m tile, 11x11 base
 * resolution and four octaves (upscale 2), i.e. a ~273m base feature. The 25%
 * random `getTreeType()` path is only used by extra wall / field trees.
 *
 * We reproduce the same spatial behaviour with the shared deterministic fbm
 * field instead of the official per-tile Alea sequence. Coordinates are world
 * XZ, so every LOD and every placement pass gets the same species at the same
 * location.
 */
export const SLOWROADS_TREE_TYPE_TILE_SIZE = 3000
export const SLOWROADS_TREE_TYPE_RESOLUTION = 11
export const SLOWROADS_TREE_TYPE_DEPTH = 4
export const SLOWROADS_TREE_TYPE_UPSCALE = 2
export const SLOWROADS_TREE_TYPE_THRESHOLD = 0.5
export const SLOWROADS_TREE_TYPE_FEATURE_METERS =
  SLOWROADS_TREE_TYPE_TILE_SIZE / SLOWROADS_TREE_TYPE_RESOLUTION

const TREE_TYPE_SEED_SALT = 0x9e3779b9
const DEFAULT_FIELD_RESOLUTION = 512
const MIN_FIELD_RESOLUTION = 16
const MAX_FIELD_RESOLUTION = 1024

export interface TreeSpeciesFieldOptions {
  minX: number
  minZ: number
  sizeX: number
  sizeZ: number
  seed: number
  /** Target samples along the longer axis. Defaults to 512. */
  resolution?: number
}

export interface TreeSpeciesField {
  width: number
  height: number
  /** 0..255 encoded species-map value; 0.5 is the species threshold. */
  data: Uint8Array
  minX: number
  minZ: number
  sizeX: number
  sizeZ: number
  sampleSpecies(x: number, z: number): 0 | 1
  memoryBytes: number
}

export interface TreeLineBounds {
  /** slowroads' 150m band, mapped to the middle of the DEM elevation range. */
  midY: number
  /** slowroads' 300m tree line, mapped to the DEM's highest point. */
  topY: number
  /** False for flat terrain; the tree line must not cut a flat world. */
  enabled: boolean
}

function resolveFieldResolution(value: number | undefined): number {
  const requested = Number.isFinite(value) && (value as number) > 0
    ? Math.round(value as number)
    : DEFAULT_FIELD_RESOLUTION
  return Math.max(MIN_FIELD_RESOLUTION, Math.min(MAX_FIELD_RESOLUTION, requested))
}

function sampleTreeTypeValue(seed: number, x: number, z: number): number {
  return clamp01(fbm2(
    (seed ^ TREE_TYPE_SEED_SALT) >>> 0,
    x / SLOWROADS_TREE_TYPE_FEATURE_METERS,
    z / SLOWROADS_TREE_TYPE_FEATURE_METERS,
    SLOWROADS_TREE_TYPE_DEPTH,
    2,
    0.5,
  ))
}

/** Direct world-space species sample used when no baked field is available. */
export function slowroadsTreeSpeciesAt(seed: number, x: number, z: number): 0 | 1 {
  return sampleTreeTypeValue(seed, x, z) >= SLOWROADS_TREE_TYPE_THRESHOLD ? 1 : 0
}

/**
 * Bake the spatial species field once per terrain build. A 512-axis field is
 * ~80m per texel on a 40km DEM, enough for the official ~273m stands while
 * avoiding a four-octave fbm evaluation for every tree placement.
 */
export function buildTreeSpeciesField(options: TreeSpeciesFieldOptions): TreeSpeciesField {
  const sizeX = Math.max(1e-3, options.sizeX)
  const sizeZ = Math.max(1e-3, options.sizeZ)
  const target = resolveFieldResolution(options.resolution)
  const aspect = sizeZ / sizeX
  const width = aspect >= 1 ? target : Math.max(1, Math.round(target * (sizeX / sizeZ)))
  const height = aspect >= 1 ? Math.max(1, Math.round(target * aspect)) : target
  const data = new Uint8Array(width * height)
  const seed = options.seed >>> 0
  const fieldMinX = options.minX
  const fieldMinZ = options.minZ

  for (let row = 0; row < height; row += 1) {
    const vz = height === 1 ? 0 : row / (height - 1)
    const z = options.minZ + vz * sizeZ
    for (let col = 0; col < width; col += 1) {
      const vx = width === 1 ? 0 : col / (width - 1)
      const x = options.minX + vx * sizeX
      data[row * width + col] = Math.round(sampleTreeTypeValue(seed, x, z) * 255)
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
    sampleSpecies(x: number, z: number): 0 | 1 {
      const fx = clamp01((x - fieldMinX) / sizeX) * (width - 1)
      const fz = clamp01((z - fieldMinZ) / sizeZ) * (height - 1)
      const x0 = Math.floor(fx)
      const z0 = Math.floor(fz)
      const x1 = Math.min(width - 1, x0 + 1)
      const z1 = Math.min(height - 1, z0 + 1)
      const tx = fx - x0
      const tz = fz - z0
      const v00 = data[z0 * width + x0] ?? 0
      const v10 = data[z0 * width + x1] ?? 0
      const v01 = data[z1 * width + x0] ?? 0
      const v11 = data[z1 * width + x1] ?? 0
      const value = (
        (v00 * (1 - tx) + v10 * tx) * (1 - tz)
        + (v01 * (1 - tx) + v11 * tx) * tz
      ) / 255
      return value >= SLOWROADS_TREE_TYPE_THRESHOLD ? 1 : 0
    },
    memoryBytes: data.byteLength,
  }
}

/**
 * Map slowroads' 150/300m tree-density band onto the DEM's relative height.
 * The lowest half of the DEM is the full-density band; the highest point is
 * the tree line.
 */
export function slowroadsTreeLineBounds(minY: number, maxY: number): TreeLineBounds {
  const span = maxY - minY
  if (!(span > 1e-3)) {
    return { midY: maxY + 1, topY: maxY + 2, enabled: false }
  }
  return {
    midY: minY + span * 0.5,
    topY: maxY,
    enabled: true,
  }
}

/** Linear 1 -> 0 density factor matching slowroads' 150m -> 300m falloff. */
export function slowroadsTreeLineFactor(y: number, bounds: TreeLineBounds): number {
  if (!bounds.enabled) {
    return 1
  }
  return clamp01((bounds.topY - y) / Math.max(1e-3, bounds.topY - bounds.midY))
}
