import { clamp, degreesToRadians, hashStringToSeed } from './noise'

export type ProceduralLandscapeEnvironment = 'editor' | 'preview' | 'viewer'
export type ProceduralLandscapeQuality = 'auto' | 'low' | 'medium' | 'high'
export type ResolvedProceduralLandscapeQuality = 'low' | 'medium' | 'high'

export interface ProceduralLandscapeSamplingProps {
  /** World-space sample cell size of the runtime height field (meters). */
  sampleCellSize: number
  /** Upper bound of samples per axis; the grid is coarsened above this. */
  maxSampleGridSize: number
}

export interface ProceduralLandscapeSurfaceProps {
  enabled: boolean
  blendStrength: number
  uvScale: number
  grassTint: string
  forestTint: string
  roadTint: string
  gravelTint: string
  rockSlopeThreshold: number
  /**
   * GLB 航拍基色处理：'replace' 官方季节地表全覆盖写（默认）；
   * 'blend' 保留原贴图并按 baseMapBlend 与季节地表混合。
   */
  baseMapMode: 'replace' | 'blend'
  /** baseMapMode='blend' 时的混合强度（0=季节地表，1=原始贴图）。 */
  baseMapBlend: number
}

export interface ProceduralLandscapeRoadProps {
  enabled: boolean
  /** Full road width in meters (both lanes). */
  width: number
  shoulderWidth: number
  /** Null keeps the seeded default start (terrain center search). */
  startX: number | null
  startZ: number | null
  /** Null keeps the seeded default heading. */
  headingDeg: number | null
  /** Null traces until the terrain boundary. */
  maxLength: number | null
  stepLength: number
  feelDistance: number
  feelAngleDeg: number
  maxSlope: number
  maxTurnDeg: number
  flattenBand: number
  flattenStrength: number
}

export interface ProceduralLandscapeForestProps {
  coverage: number
  /** World-space wavelength of the density noise (meters). */
  scale: number
  seedOffset: number
  density: number
  minHeight: number | null
  maxSlope: number
  roadClearance: number
  minScale: number
  maxScale: number
  /** Null uses the quality-tier default. */
  nearDistance: number | null
}

export interface ProceduralLandscapeGrassProps {
  enabled: boolean
  corridorWidth: number
  cameraRadius: number
  density: number
  sinkNearRoad: number
  windEnabled: boolean
}

export interface ProceduralLandscapeBushesProps {
  enabled: boolean
  density: number
}

export interface ProceduralLandscapeDebugProps {
  showRoadPath: boolean
  showChunks: boolean
}

export interface ProceduralLandscapeComponentProps {
  seed: number
  generationRevision: number
  quality: ProceduralLandscapeQuality
  sampling: ProceduralLandscapeSamplingProps
  surface: ProceduralLandscapeSurfaceProps
  road: ProceduralLandscapeRoadProps
  forest: ProceduralLandscapeForestProps
  grass: ProceduralLandscapeGrassProps
  bushes: ProceduralLandscapeBushesProps
  debug: ProceduralLandscapeDebugProps
}

export interface ProceduralLandscapeQualityTier {
  viewDistance: number
  treeNearDistance: number
  grassRadius: number
  treeChunkSize: number
  densityMultiplier: number
  maxBuildTasksPerTick: number
  maxTreeInstances: number
  maxGrassInstances: number
}

export const PROCEDURAL_LANDSCAPE_QUALITY_TIERS: Record<ResolvedProceduralLandscapeQuality, ProceduralLandscapeQualityTier> = {
  low: {
    viewDistance: 256,
    treeNearDistance: 96,
    grassRadius: 48,
    treeChunkSize: 64,
    densityMultiplier: 0.4,
    maxBuildTasksPerTick: 2,
    maxTreeInstances: 6000,
    maxGrassInstances: 12000,
  },
  medium: {
    viewDistance: 640,
    treeNearDistance: 128,
    grassRadius: 64,
    treeChunkSize: 128,
    densityMultiplier: 0.75,
    maxBuildTasksPerTick: 4,
    maxTreeInstances: 12000,
    maxGrassInstances: 24000,
  },
  high: {
    viewDistance: 1200,
    treeNearDistance: 90,
    grassRadius: 80,
    treeChunkSize: 192,
    densityMultiplier: 1,
    maxBuildTasksPerTick: 6,
    maxTreeInstances: 60000,
    maxGrassInstances: 60000,
  },
}

export const PROCEDURAL_LANDSCAPE_AUTO_QUALITY: Record<ProceduralLandscapeEnvironment, ResolvedProceduralLandscapeQuality> = {
  // 与 slowroads-lab 观感一致：编辑器视口默认全量植被密度。
  editor: 'high',
  preview: 'high',
  viewer: 'medium',
}

export function resolveProceduralLandscapeQuality(
  quality: ProceduralLandscapeQuality | string | null | undefined,
  environment: ProceduralLandscapeEnvironment,
): ResolvedProceduralLandscapeQuality {
  if (quality === 'low' || quality === 'medium' || quality === 'high') {
    return quality
  }
  return PROCEDURAL_LANDSCAPE_AUTO_QUALITY[environment] ?? 'medium'
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return clamp(numeric, min, max)
}

function clampNullableNumber(value: unknown, fallback: number | null, min: number, max: number): number | null {
  if (value == null) {
    return fallback
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return clamp(numeric, min, max)
}

function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length ? value.trim() : fallback
}

export function createDefaultProceduralLandscapeProps(node: { id: string }): ProceduralLandscapeComponentProps {
  return {
    seed: hashStringToSeed(node.id || 'procedural-landscape'),
    generationRevision: 0,
    quality: 'auto',
    sampling: {
      sampleCellSize: 2,
      maxSampleGridSize: 2048,
    },
    surface: {
      enabled: true,
      blendStrength: 1,
      uvScale: 10,
      grassTint: '#ffffff',
      forestTint: '#ffffff',
      roadTint: '#ffffff',
      gravelTint: '#ffffff',
      rockSlopeThreshold: 0.35,
      baseMapMode: 'replace',
      baseMapBlend: 0.5,
    },
    road: {
      enabled: true,
      width: 7,
      shoulderWidth: 2.5,
      startX: null,
      startZ: null,
      headingDeg: null,
      maxLength: null,
      stepLength: 8,
      feelDistance: 24,
      feelAngleDeg: 32,
      maxSlope: 0.55,
      maxTurnDeg: 4,
      flattenBand: 10,
      flattenStrength: 1,
    },
    forest: {
      coverage: 1,
      scale: 600,
      seedOffset: 0,
      density: 1,
      minHeight: null,
      maxSlope: 0.45,
      roadClearance: 2,
      // 对齐 slowroads-lab：8m 基准 × 0.56~1.56 ≈ 4.5~12.5m（默认 5~12）。
      minScale: 5,
      maxScale: 12,
      nearDistance: null,
    },
    grass: {
      enabled: true,
      corridorWidth: 20,
      cameraRadius: 60,
      density: 1,
      sinkNearRoad: 1.2,
      windEnabled: true,
    },
    bushes: {
      enabled: true,
      density: 0.6,
    },
    debug: {
      showRoadPath: false,
      showChunks: false,
    },
  }
}

export function clampProceduralLandscapeProps(
  props: Partial<ProceduralLandscapeComponentProps> | null | undefined,
  fallbackNodeId = 'procedural-landscape',
): ProceduralLandscapeComponentProps {
  const defaults = createDefaultProceduralLandscapeProps({ id: fallbackNodeId })
  const sampling = props?.sampling as Partial<ProceduralLandscapeSamplingProps> | undefined
  const surface = props?.surface as Partial<ProceduralLandscapeSurfaceProps> | undefined
  const road = props?.road as Partial<ProceduralLandscapeRoadProps> | undefined
  const forest = props?.forest as Partial<ProceduralLandscapeForestProps> | undefined
  const grass = props?.grass as Partial<ProceduralLandscapeGrassProps> | undefined
  const bushes = props?.bushes as Partial<ProceduralLandscapeBushesProps> | undefined
  const debug = props?.debug as Partial<ProceduralLandscapeDebugProps> | undefined

  const minScale = clampNumber(forest?.minScale, defaults.forest.minScale, 0.5, 40)
  const maxScale = clampNumber(forest?.maxScale, defaults.forest.maxScale, minScale, 60)
  const quality = props?.quality === 'low' || props?.quality === 'medium' || props?.quality === 'high' || props?.quality === 'auto'
    ? props.quality
    : defaults.quality

  return {
    seed: Math.round(clampNumber(props?.seed, defaults.seed, 0, 0xffffffff)) >>> 0,
    generationRevision: Math.round(clampNumber(props?.generationRevision, 0, 0, 0x7fffffff)),
    quality,
    sampling: {
      sampleCellSize: clampNumber(sampling?.sampleCellSize, defaults.sampling.sampleCellSize, 0.5, 16),
      maxSampleGridSize: Math.round(clampNumber(sampling?.maxSampleGridSize, defaults.sampling.maxSampleGridSize, 128, 4096)),
    },
    surface: {
      enabled: surface?.enabled !== false,
      blendStrength: clampNumber(surface?.blendStrength, defaults.surface.blendStrength, 0, 1),
      uvScale: clampNumber(surface?.uvScale, defaults.surface.uvScale, 1, 200),
      grassTint: normalizeColor(surface?.grassTint, defaults.surface.grassTint),
      forestTint: normalizeColor(surface?.forestTint, defaults.surface.forestTint),
      roadTint: normalizeColor(surface?.roadTint, defaults.surface.roadTint),
      gravelTint: normalizeColor(surface?.gravelTint, defaults.surface.gravelTint),
      rockSlopeThreshold: clampNumber(surface?.rockSlopeThreshold, defaults.surface.rockSlopeThreshold, 0.05, 0.9),
      baseMapMode: surface?.baseMapMode === 'blend' ? 'blend' : 'replace',
      baseMapBlend: clampNumber(surface?.baseMapBlend, defaults.surface.baseMapBlend, 0, 1),
    },
    road: {
      enabled: road?.enabled !== false,
      width: clampNumber(road?.width, defaults.road.width, 3, 24),
      shoulderWidth: clampNumber(road?.shoulderWidth, defaults.road.shoulderWidth, 0, 10),
      startX: clampNullableNumber(road?.startX, defaults.road.startX, -1e7, 1e7),
      startZ: clampNullableNumber(road?.startZ, defaults.road.startZ, -1e7, 1e7),
      headingDeg: clampNullableNumber(road?.headingDeg, defaults.road.headingDeg, -360, 360),
      maxLength: clampNullableNumber(road?.maxLength, defaults.road.maxLength, 16, 100000),
      stepLength: clampNumber(road?.stepLength, defaults.road.stepLength, 2, 32),
      feelDistance: clampNumber(road?.feelDistance, defaults.road.feelDistance, 4, 80),
      feelAngleDeg: clampNumber(road?.feelAngleDeg, defaults.road.feelAngleDeg, 5, 80),
      maxSlope: clampNumber(road?.maxSlope, defaults.road.maxSlope, 0.08, 2),
      maxTurnDeg: clampNumber(road?.maxTurnDeg, defaults.road.maxTurnDeg, 0.5, 20),
      flattenBand: clampNumber(road?.flattenBand, defaults.road.flattenBand, 2, 60),
      flattenStrength: clampNumber(road?.flattenStrength, defaults.road.flattenStrength, 0, 1),
    },
    forest: {
      coverage: clampNumber(forest?.coverage, defaults.forest.coverage, 0, 1),
      scale: clampNumber(forest?.scale, defaults.forest.scale, 50, 4000),
      seedOffset: Math.round(clampNumber(forest?.seedOffset, defaults.forest.seedOffset, -1e6, 1e6)),
      density: clampNumber(forest?.density, defaults.forest.density, 0, 4),
      minHeight: clampNullableNumber(forest?.minHeight, defaults.forest.minHeight, -1e5, 1e5),
      maxSlope: clampNumber(forest?.maxSlope, defaults.forest.maxSlope, 0.02, 1),
      roadClearance: clampNumber(forest?.roadClearance, defaults.forest.roadClearance, 0, 50),
      minScale,
      maxScale,
      nearDistance: clampNullableNumber(forest?.nearDistance, defaults.forest.nearDistance, 16, 600),
    },
    grass: {
      enabled: grass?.enabled !== false,
      corridorWidth: clampNumber(grass?.corridorWidth, defaults.grass.corridorWidth, 2, 120),
      cameraRadius: clampNumber(grass?.cameraRadius, defaults.grass.cameraRadius, 0, 400),
      density: clampNumber(grass?.density, defaults.grass.density, 0, 4),
      sinkNearRoad: clampNumber(grass?.sinkNearRoad, defaults.grass.sinkNearRoad, 0, 5),
      windEnabled: grass?.windEnabled !== false,
    },
    bushes: {
      enabled: bushes?.enabled !== false,
      density: clampNumber(bushes?.density, defaults.bushes.density, 0, 2),
    },
    debug: {
      showRoadPath: debug?.showRoadPath === true,
      showChunks: debug?.showChunks === true,
    },
  }
}

export function cloneProceduralLandscapeProps(
  props: ProceduralLandscapeComponentProps,
): ProceduralLandscapeComponentProps {
  return {
    ...props,
    sampling: { ...props.sampling },
    surface: { ...props.surface },
    road: { ...props.road },
    forest: { ...props.forest },
    grass: { ...props.grass },
    bushes: { ...props.bushes },
    debug: { ...props.debug },
  }
}

export function roadHalfWidth(props: ProceduralLandscapeComponentProps): number {
  return Math.max(0.5, props.road.width * 0.5)
}

export function roadFlattenParams(props: ProceduralLandscapeComponentProps): {
  innerRadius: number
  outerRadius: number
  strength: number
} {
  const innerRadius = roadHalfWidth(props) + props.road.shoulderWidth
  const outerRadius = Math.max(innerRadius + 0.5, props.road.flattenBand)
  return { innerRadius, outerRadius, strength: props.road.flattenStrength }
}

export function roadFeelAngleRad(props: ProceduralLandscapeComponentProps): number {
  return degreesToRadians(props.road.feelAngleDeg)
}
