import { clamp, degreesToRadians, hashStringToSeed } from './noise'
import {
  DEFAULT_ROAD_STYLE,
  normalizeRoadStyleId,
  ROAD_WIDTH_PRESETS,
  type RoadStyleId,
} from './roadStyle'
import { clampRoadWaypoints, type RoadWaypoint } from './roadWaypoints'

export type ProceduralLandscapeEnvironment = 'editor' | 'preview' | 'viewer'
export type ProceduralLandscapeQuality = 'auto' | 'low' | 'medium' | 'high'
export type ResolvedProceduralLandscapeQuality = 'low' | 'medium' | 'high'

export interface ProceduralLandscapeSamplingProps {
  /** World-space sample cell size of the runtime height field (meters). */
  sampleCellSize: number
  /** Upper bound of samples per axis; the grid is coarsened above this. */
  maxSampleGridSize: number
}

export type ProceduralLandscapeDemSampleStep = 'auto' | 1 | 2 | 4

export interface ProceduralLandscapeDemProps {
  /** Server DEM pack asset id; null keeps the legacy GLB terrain path. */
  assetId: string | null
  /** Preprocessed, deflate-compressed runtime grid URL. */
  runtimeGridUrl: string | null
  runtimeGridBytes: number | null
  /** Upload-time generated orthophoto texture (`hort-v1`). */
  runtimeOrthoUrl: string | null
  runtimeOrthoBytes: number | null
  sampleStep: ProceduralLandscapeDemSampleStep
  sourceZipName: string | null
  width: number | null
  height: number | null
  cellSizeMeters: number | null
  minElevation: number | null
  maxElevation: number | null
  anchor: {
    latitudeDegrees: number
    longitudeDegrees: number
    groundElevationMeters: number
  } | null
  crs: {
    epsg: number
    zone: number
    hemisphere: 'north' | 'south'
  } | null
}

export interface ProceduralLandscapeSurfaceProps {
  /** 地表混合（lab showSurface）：false = proceduralLandscape 完全不接管 GLB 材质。 */
  enabled: boolean
  /** 地表贴图（lab showTextures）：false = 只保留调色板/树影，不采样季节贴图。 */
  textures: boolean
  blendStrength: number
  uvScale: number
  grassTint: string
  forestTint: string
  roadTint: string
  gravelTint: string
  rockSlopeThreshold: number
  /**
   * 地表基色来源：'replace' 程序化季节地表全覆盖写（默认）；
   * 'aerial' 只显示航拍底图；'blend' 按 baseMapBlend 与季节地表混合。
   */
  baseMapMode: ProceduralLandscapeBaseMapMode
  /** baseMapMode='blend' 时的混合强度（0=季节地表，1=航拍底图）。 */
  baseMapBlend: number
  /**
   * 雾/视距尺度倍率：null = 按地形水平尺寸自动（`resolveSurfaceViewDistanceScale`）。
   * 官方雾尺度按 1000m 世界调参；编辑器地形可达数十公里，需要按地形放大视距，
   * 否则 1km 外整片地形变成雾色。
   */
  viewDistanceScale: number | null
}

export type ProceduralLandscapeRoadTermination = 'boundary' | 'loop' | 'dead-end'
export type ProceduralLandscapeRoadStrategy = 'seeded' | 'shortest'
export type ProceduralLandscapeBaseMapMode = 'replace' | 'aerial' | 'blend'

function normalizeRoadTermination(value: unknown): ProceduralLandscapeRoadTermination {
  if (value === 'loop') {
    return 'loop'
  }
  if (value === 'dead-end') {
    return 'dead-end'
  }
  return 'boundary'
}

export interface ProceduralLandscapeRoadRoutingProps {
  strategy: ProceduralLandscapeRoadStrategy
  termination: ProceduralLandscapeRoadTermination
}

/** Fixed editor-authored path rehydrated by preview/viewer. */
export interface ProceduralLandscapeGeneratedRouteCenterline {
  /** Host-local centerline XZ pairs: [x0, z0, x1, z1, ...]. */
  pointsXZ: number[]
  /** DEM sample step used by the editor when the snapshot was authored. */
  authoringSampleStep: number
  /** Runtime height-grid cell size used when the snapshot was authored. */
  authoringCellSize: number
  /** Landscape exclusion signature used when this path was generated. */
  exclusionSignature?: string
}

/** Immutable snapshot used by the runtime until the user regenerates the road. */
export interface ProceduralLandscapeGeneratedRouteProps {
  waypoints: RoadWaypoint[]
  strategy: ProceduralLandscapeRoadStrategy
  termination: ProceduralLandscapeRoadTermination
  style: RoadStyleId
  seed: number
  waypointTolerance: number
  pathDeviation: number
  revision: number
  /** Fixed editor-authored road path, used by preview/viewer instead of replanning. */
  centerline?: ProceduralLandscapeGeneratedRouteCenterline | null
}

export interface ProceduralLandscapeRoadProps {
  enabled: boolean
  routing: ProceduralLandscapeRoadRoutingProps
  /** Official Slow Roads curve style. Width remains independently configurable. */
  style: RoadStyleId
  /**
   * The runtime only builds this committed snapshot. Live waypoint edits stay
   * editable and are marked stale until the user presses Generate.
   */
  generatedRoute: ProceduralLandscapeGeneratedRouteProps | null
  /** Full road width in meters (both lanes). */
  width: number
  shoulderWidth: number
  /**
   * Hand-drawn guide path (host node local XZ). Two or more points are used as
   * ordered must-pass waypoints: the road starts at the first point and its
   * initial heading comes from the first -> second direction. Fewer than two
   * points fall back to the terrain centre and the seeded heading.
   */
  waypoints: RoadWaypoint[]
  /** Maximum centerline distance to every required waypoint (meters). */
  waypointTolerance: number
  /**
   * Soft detour radius for each consecutive waypoint pair and the final
   * tracer corridor around the global guide (meters). A radius miss falls
   * back to unrestricted terrain search and is reported to the editor.
   */
  pathDeviation: number
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
  /** 近树 3D 网格半径（米；0 = 关闭近树 3D 层）。 */
  nearTreeRadius: number
}

export interface ProceduralLandscapeGrassProps {
  enabled: boolean
  corridorWidth: number
  cameraRadius: number
  density: number
  sinkNearRoad: number
  /** 花草密度倍率（花走灌木层，lab flowerDensity）。 */
  flowerDensity: number
  /** 高草密度倍率（高草走草层 cell 2/3，lab tallGrassDensity）。 */
  tallGrassDensity: number
}

export interface ProceduralLandscapeBushesProps {
  enabled: boolean
  density: number
}

/** 树冠色斑（lab showCanopy）：地表按树密度图压暗/染色。 */
export interface ProceduralLandscapeCanopyProps {
  enabled: boolean
}

export type ProceduralLandscapeWaterLevelMode = 'auto' | 'manual'

/**
 * 水面：自动模式按低洼地形比例反解水线；手动模式沿用
 * “地形最低点 + levelOffset”的语义。
 */
export interface ProceduralLandscapeWaterProps {
  enabled: boolean
  levelMode: ProceduralLandscapeWaterLevelMode
  levelOffset: number
}

/**
 * 官方路侧墙体（lab showWalls / showDrystone / showFence / showBarrier / showSeaWall /
 * wallDensity）。放置规则见 `walls.ts`（官方 Barrier/Fence/SeaWall 判定 + 干砌石墙
 * 的地块等价规则）。
 *
 * 旧版 `barrier` 组（下坡落差近似护栏）已废弃：读取时把 `enabled` 映射到
 * `fence` 与 `barrier`，`density` 映射到 `drystone.density`，其余字段一并忽略。
 */
export interface ProceduralLandscapeWallsProps {
  /** 干砌石墙（官方 Drystone）。 */
  drystone: { enabled: boolean; density: number }
  /** 木栏（官方 Fence）。 */
  fence: { enabled: boolean }
  /** 硬护栏（官方 Barrier）。 */
  barrier: { enabled: boolean }
  /** 混凝土海墙（官方 SeaWall）。 */
  seaWall: { enabled: boolean }
}

/** 风摆（lab windEnabled / windStrength，逐层系数见 runtime WIND_FACTOR）。 */
export interface ProceduralLandscapeWindProps {
  enabled: boolean
  strength: number
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
  dem: ProceduralLandscapeDemProps
  surface: ProceduralLandscapeSurfaceProps
  road: ProceduralLandscapeRoadProps
  forest: ProceduralLandscapeForestProps
  grass: ProceduralLandscapeGrassProps
  bushes: ProceduralLandscapeBushesProps
  canopy: ProceduralLandscapeCanopyProps
  water: ProceduralLandscapeWaterProps
  walls: ProceduralLandscapeWallsProps
  wind: ProceduralLandscapeWindProps
  debug: ProceduralLandscapeDebugProps
}

export function shouldLoadProceduralLandscapeOrtho(
  props: Pick<ProceduralLandscapeComponentProps, 'dem' | 'surface'>,
): boolean {
  return Boolean(
    props.dem.runtimeOrthoUrl
    && props.surface.enabled
    && resolveProceduralLandscapeBaseMapMode(props) !== 'replace',
  )
}

/**
 * Resolve the base-map source that can actually render. DEM nodes without a
 * runtime orthophoto fall back to procedural shading; GLB terrain keeps its
 * original material map and therefore supports aerial mode without a URL.
 */
export function resolveProceduralLandscapeBaseMapMode(
  props: Pick<ProceduralLandscapeComponentProps, 'dem' | 'surface'>,
): ProceduralLandscapeBaseMapMode {
  if (!props.surface.enabled) {
    return 'replace'
  }
  if (props.dem.assetId && !props.dem.runtimeOrthoUrl) {
    return 'replace'
  }
  return props.surface.baseMapMode
}

/** Effective shader weight: procedural = 0, aerial = 1, blend = slider value. */
export function resolveProceduralLandscapeBaseMapBlend(
  props: Pick<ProceduralLandscapeComponentProps, 'dem' | 'surface'>,
): number {
  const mode = resolveProceduralLandscapeBaseMapMode(props)
  if (mode === 'aerial') {
    return 1
  }
  if (mode === 'blend') {
    return clampNumber(props.surface.baseMapBlend, 0.5, 0, 1)
  }
  return 0
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
  /**
   * 远景林环带（近景流式半径之外的相机锚定 imposter 林）：
   * `radius` 是外半径上限（米），`budget` 是实例预算（0 = 关闭）。
   * 实际外半径 = min(radius, 0.75 × 场景雾远端)，见 runtime `resolveFarForestTier`。
   */
  farForest: {
    radius: number
    budget: number
  }
  /**
   * World-anchored forest covering the complete terrain. It replaces the old
   * camera-anchored far ring; density changes by tier while coverage remains
   * world-wide.
   */
  worldForest: {
    cellSize: number
    budget: number
  }
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
    farForest: { radius: 0, budget: 0 },
    worldForest: { cellSize: 96, budget: 150_000 },
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
    farForest: { radius: 5000, budget: 28000 },
    worldForest: { cellSize: 64, budget: 450_000 },
  },
  high: {
    viewDistance: 1200,
    treeNearDistance: 190,
    grassRadius: 80,
    treeChunkSize: 192,
    densityMultiplier: 1,
    maxBuildTasksPerTick: 6,
    maxTreeInstances: 60000,
    maxGrassInstances: 60000,
    farForest: { radius: 8000, budget: 64000 },
    // Measured editor budget: 1.16M cards held ~67 FPS and 751k held 93-100
    // FPS in the 1920×1080 viewport. 650k keeps world-wide coverage while
    // restoring the 100 FPS desktop target; medium/low scale down from here.
    worldForest: { cellSize: 40, budget: 1_300_000 },
  },
}

export const PROCEDURAL_LANDSCAPE_AUTO_QUALITY: Record<ProceduralLandscapeEnvironment, ResolvedProceduralLandscapeQuality> = {
  // 与 slowroads-lab 观感一致：编辑器视口默认全量植被密度。
  editor: 'high',
  preview: 'high',
  // Match the editor's full vegetation layout. Adaptive density calibration still
  // reduces coverage on slower devices, while explicit quality settings still win.
  viewer: 'high',
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

const GENERATED_ROUTE_CENTERLINE_MAX_POINTS = 100_000
const GENERATED_ROUTE_CENTERLINE_MAX_COORDINATE = 10_000_000

export function clampGeneratedRouteCenterline(
  value: unknown,
): ProceduralLandscapeGeneratedRouteCenterline | null {
  const raw = value as Partial<ProceduralLandscapeGeneratedRouteCenterline> | null | undefined
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.pointsXZ)) {
    return null
  }
  if (
    raw.pointsXZ.length < 4
    || raw.pointsXZ.length > GENERATED_ROUTE_CENTERLINE_MAX_POINTS * 2
    || raw.pointsXZ.length % 2 !== 0
  ) {
    return null
  }
  const pointsXZ: number[] = []
  pointsXZ.length = raw.pointsXZ.length
  for (let index = 0; index < raw.pointsXZ.length; index += 1) {
    const coordinate = Number(raw.pointsXZ[index])
    if (
      !Number.isFinite(coordinate)
      || Math.abs(coordinate) > GENERATED_ROUTE_CENTERLINE_MAX_COORDINATE
    ) {
      return null
    }
    pointsXZ[index] = coordinate
  }
  return {
    pointsXZ,
    authoringSampleStep: Math.round(clampNumber(raw.authoringSampleStep, 1, 1, 8)),
    authoringCellSize: clampNumber(raw.authoringCellSize, 1, 0.01, 100_000),
    ...(typeof raw.exclusionSignature === 'string'
      ? { exclusionSignature: raw.exclusionSignature.slice(0, 65_536) }
      : {}),
  }
}

export function cloneGeneratedRouteCenterline(
  value: ProceduralLandscapeGeneratedRouteCenterline | null | undefined,
): ProceduralLandscapeGeneratedRouteCenterline | null {
  if (!value) {
    return null
  }
  return {
    pointsXZ: [...value.pointsXZ],
    authoringSampleStep: value.authoringSampleStep,
    authoringCellSize: value.authoringCellSize,
    ...(value.exclusionSignature !== undefined
      ? { exclusionSignature: value.exclusionSignature }
      : {}),
  }
}

function clampGeneratedRoute(
  value: unknown,
  fallbackSeed: number,
  fallbackPathDeviation: number,
): ProceduralLandscapeGeneratedRouteProps | null {
  const raw = value as Partial<ProceduralLandscapeGeneratedRouteProps> | null | undefined
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const waypoints = clampRoadWaypoints(raw.waypoints)
  if (!waypoints.length) {
    return null
  }
  return {
    waypoints,
    strategy: raw.strategy === 'shortest' ? 'shortest' : 'seeded',
    termination: normalizeRoadTermination(raw.termination),
    style: normalizeRoadStyleId(raw.style),
    seed: Math.round(clampNumber(raw.seed, fallbackSeed, 0, 0xffffffff)) >>> 0,
    waypointTolerance: clampNumber(raw.waypointTolerance, 4, 1, 64),
    pathDeviation: clampNumber(raw.pathDeviation, fallbackPathDeviation, 10, 500),
    revision: Math.round(clampNumber(raw.revision, 0, 0, 0x7fffffff)),
    centerline: clampGeneratedRouteCenterline(raw.centerline),
  }
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
    dem: {
      assetId: null,
      runtimeGridUrl: null,
      runtimeGridBytes: null,
      runtimeOrthoUrl: null,
      runtimeOrthoBytes: null,
      sampleStep: 'auto',
      sourceZipName: null,
      width: null,
      height: null,
      cellSizeMeters: null,
      minElevation: null,
      maxElevation: null,
      anchor: null,
      crs: null,
    },
    surface: {
      enabled: true,
      textures: true,
      blendStrength: 1,
      uvScale: 10,
      grassTint: '#ffffff',
      forestTint: '#ffffff',
      roadTint: '#ffffff',
      gravelTint: '#ffffff',
      rockSlopeThreshold: 0.35,
      baseMapMode: 'replace',
      baseMapBlend: 0.5,
      viewDistanceScale: null,
    },
    road: {
      enabled: true,
      routing: {
        strategy: 'seeded',
        termination: 'boundary',
      },
      generatedRoute: null,
      style: DEFAULT_ROAD_STYLE,
      width: 7,
      shoulderWidth: 2.5,
      waypoints: [],
      waypointTolerance: 4,
      pathDeviation: 60,
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
      // lab DEFAULT_LAB_SETTINGS：近树卡 190m、近树 3D 半径 90m。
      nearDistance: 190,
      nearTreeRadius: 90,
    },
    grass: {
      enabled: true,
      corridorWidth: 20,
      cameraRadius: 60,
      density: 1,
      sinkNearRoad: 1.2,
      flowerDensity: 1,
      tallGrassDensity: 1,
    },
    bushes: {
      enabled: true,
      density: 0.6,
    },
    canopy: {
      enabled: true,
    },
    water: {
      enabled: true,
      levelMode: 'auto',
      levelOffset: 0,
    },
    walls: {
      drystone: { enabled: true, density: 1 },
      fence: { enabled: true },
      barrier: { enabled: true },
      seaWall: { enabled: true },
    },
    wind: {
      enabled: true,
      strength: 1,
    },
    debug: {
      showRoadPath: false,
      showChunks: false,
    },
  }
}

export function clampProceduralLandscapeProps(
  props: (
    Omit<Partial<ProceduralLandscapeComponentProps>, 'water'>
    & { water?: Partial<ProceduralLandscapeWaterProps> }
  ) | null | undefined,
  fallbackNodeId = 'procedural-landscape',
): ProceduralLandscapeComponentProps {
  const defaults = createDefaultProceduralLandscapeProps({ id: fallbackNodeId })
  const sampling = props?.sampling as Partial<ProceduralLandscapeSamplingProps> | undefined
  const dem = props?.dem as Partial<ProceduralLandscapeDemProps> | undefined
  const surface = props?.surface as Partial<ProceduralLandscapeSurfaceProps> | undefined
  const road = props?.road as Partial<ProceduralLandscapeRoadProps> | undefined
  const forest = props?.forest as Partial<ProceduralLandscapeForestProps> | undefined
  const grass = props?.grass as Partial<ProceduralLandscapeGrassProps> | undefined
  const bushes = props?.bushes as Partial<ProceduralLandscapeBushesProps> | undefined
  const canopy = props?.canopy as Partial<ProceduralLandscapeCanopyProps> | undefined
  const water = props?.water as Partial<ProceduralLandscapeWaterProps> | undefined
  const walls = props?.walls as Partial<ProceduralLandscapeWallsProps> | undefined
  // 旧版 `barrier` 组（下坡落差近似）废弃后的读入映射。
  const legacyBarrier = (props as { barrier?: Record<string, unknown> } | null | undefined)?.barrier
  const legacyBarrierEnabled = legacyBarrier ? legacyBarrier.enabled !== false : true
  const legacyBarrierDensity = typeof legacyBarrier?.density === 'number'
    ? legacyBarrier.density as number
    : null
  const wallGroupEnabled = (
    value: { enabled?: unknown } | undefined,
    fallback: boolean,
  ): boolean => (value ? value.enabled !== false : fallback)
  const wind = props?.wind as Partial<ProceduralLandscapeWindProps> | undefined
  const debug = props?.debug as Partial<ProceduralLandscapeDebugProps> | undefined

  const minScale = clampNumber(forest?.minScale, defaults.forest.minScale, 0.5, 40)
  const maxScale = clampNumber(forest?.maxScale, defaults.forest.maxScale, minScale, 60)
  const quality = props?.quality === 'low' || props?.quality === 'medium' || props?.quality === 'high' || props?.quality === 'auto'
    ? props.quality
    : defaults.quality
  const demSampleStep: ProceduralLandscapeDemSampleStep = dem?.sampleStep === 1 || dem?.sampleStep === 2 || dem?.sampleStep === 4
    ? dem.sampleStep
    : 'auto'
  const demAnchor = dem?.anchor && Number.isFinite(dem.anchor.latitudeDegrees)
    && Number.isFinite(dem.anchor.longitudeDegrees)
    && Number.isFinite(dem.anchor.groundElevationMeters)
    ? {
        latitudeDegrees: dem.anchor.latitudeDegrees,
        longitudeDegrees: dem.anchor.longitudeDegrees,
        groundElevationMeters: dem.anchor.groundElevationMeters,
      }
    : null
  const demCrs = dem?.crs && Number.isFinite(dem.crs.epsg) && Number.isFinite(dem.crs.zone)
    ? {
        epsg: Math.round(dem.crs.epsg),
        zone: Math.round(dem.crs.zone),
        hemisphere: dem.crs.hemisphere === 'south' ? 'south' as const : 'north' as const,
      }
    : null
  const seedValue = Math.round(clampNumber(props?.seed, defaults.seed, 0, 0xffffffff)) >>> 0
  const inferredWaterLevelMode: ProceduralLandscapeWaterLevelMode = (
    water?.levelMode === 'auto' || water?.levelMode === 'manual'
      ? water.levelMode
      : typeof water?.levelOffset === 'number' && water.levelOffset !== 0
        ? 'manual'
        : 'auto'
  )
  const waypointTolerance = clampNumber(
    road?.waypointTolerance,
    defaults.road.waypointTolerance,
    1,
    64,
  )
  const pathDeviation = clampNumber(
    road?.pathDeviation,
    defaults.road.pathDeviation,
    10,
    500,
  )
  const waypoints = clampRoadWaypoints(road?.waypoints)
  const hasGeneratedRouteField = Boolean(
    road && Object.prototype.hasOwnProperty.call(road, 'generatedRoute'),
  )
  let generatedRoute = hasGeneratedRouteField
    ? clampGeneratedRoute(road?.generatedRoute, seedValue, pathDeviation)
    : null
  const routing = road?.routing

  return {
    seed: seedValue,
    generationRevision: Math.round(clampNumber(props?.generationRevision, 0, 0, 0x7fffffff)),
    quality,
    sampling: {
      sampleCellSize: clampNumber(sampling?.sampleCellSize, defaults.sampling.sampleCellSize, 0.5, 16),
      maxSampleGridSize: Math.round(clampNumber(sampling?.maxSampleGridSize, defaults.sampling.maxSampleGridSize, 128, 4096)),
    },
    dem: {
      assetId: typeof dem?.assetId === 'string' && dem.assetId.trim().length ? dem.assetId.trim() : null,
      runtimeGridUrl: typeof dem?.runtimeGridUrl === 'string' && dem.runtimeGridUrl.trim().length
        ? dem.runtimeGridUrl.trim()
        : null,
      runtimeGridBytes: clampNullableNumber(dem?.runtimeGridBytes, null, 0, Number.MAX_SAFE_INTEGER),
      runtimeOrthoUrl: typeof dem?.runtimeOrthoUrl === 'string' && dem.runtimeOrthoUrl.trim().length
        ? dem.runtimeOrthoUrl.trim()
        : null,
      runtimeOrthoBytes: clampNullableNumber(dem?.runtimeOrthoBytes, null, 0, Number.MAX_SAFE_INTEGER),
      sampleStep: demSampleStep,
      sourceZipName: typeof dem?.sourceZipName === 'string' && dem.sourceZipName.trim().length
        ? dem.sourceZipName.trim()
        : null,
      width: clampNullableNumber(dem?.width, null, 2, 100000),
      height: clampNullableNumber(dem?.height, null, 2, 100000),
      cellSizeMeters: clampNullableNumber(dem?.cellSizeMeters, null, 0.01, 100000),
      minElevation: clampNullableNumber(dem?.minElevation, null, -1e6, 1e6),
      maxElevation: clampNullableNumber(dem?.maxElevation, null, -1e6, 1e6),
      anchor: demAnchor,
      crs: demCrs,
    },
    surface: {
      enabled: surface?.enabled !== false,
      textures: surface?.textures !== false,
      blendStrength: clampNumber(surface?.blendStrength, defaults.surface.blendStrength, 0, 1),
      uvScale: clampNumber(surface?.uvScale, defaults.surface.uvScale, 1, 200),
      grassTint: normalizeColor(surface?.grassTint, defaults.surface.grassTint),
      forestTint: normalizeColor(surface?.forestTint, defaults.surface.forestTint),
      roadTint: normalizeColor(surface?.roadTint, defaults.surface.roadTint),
      gravelTint: normalizeColor(surface?.gravelTint, defaults.surface.gravelTint),
      rockSlopeThreshold: clampNumber(surface?.rockSlopeThreshold, defaults.surface.rockSlopeThreshold, 0.05, 0.9),
      baseMapMode: surface?.baseMapMode === 'aerial'
        ? 'aerial'
        : surface?.baseMapMode === 'blend'
          ? 'blend'
          : 'replace',
      baseMapBlend: clampNumber(surface?.baseMapBlend, defaults.surface.baseMapBlend, 0, 1),
      viewDistanceScale: clampNullableNumber(surface?.viewDistanceScale, defaults.surface.viewDistanceScale, 1, 16),
    },
    road: {
      enabled: road?.enabled !== false,
      routing: {
        strategy: routing?.strategy === 'shortest' ? 'shortest' : 'seeded',
        termination: normalizeRoadTermination(routing?.termination),
      },
      generatedRoute,
      style: normalizeRoadStyleId(road?.style),
      // 下限取官方 NARROW 档：< 2.25m 才会切到单车道贴图（`isSingleTrackRoad`）。
      width: clampNumber(road?.width, defaults.road.width, ROAD_WIDTH_PRESETS.narrow, 24),
      shoulderWidth: clampNumber(road?.shoulderWidth, defaults.road.shoulderWidth, 0, 10),
      waypoints,
      waypointTolerance,
      pathDeviation,
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
      nearTreeRadius: clampNumber(forest?.nearTreeRadius, defaults.forest.nearTreeRadius, 0, 300),
    },
    grass: {
      enabled: grass?.enabled !== false,
      corridorWidth: clampNumber(grass?.corridorWidth, defaults.grass.corridorWidth, 2, 120),
      cameraRadius: clampNumber(grass?.cameraRadius, defaults.grass.cameraRadius, 0, 400),
      density: clampNumber(grass?.density, defaults.grass.density, 0, 4),
      sinkNearRoad: clampNumber(grass?.sinkNearRoad, defaults.grass.sinkNearRoad, 0, 5),
      flowerDensity: clampNumber(grass?.flowerDensity, defaults.grass.flowerDensity, 0, 4),
      tallGrassDensity: clampNumber(grass?.tallGrassDensity, defaults.grass.tallGrassDensity, 0, 4),
    },
    bushes: {
      enabled: bushes?.enabled !== false,
      density: clampNumber(bushes?.density, defaults.bushes.density, 0, 2),
    },
    canopy: {
      enabled: canopy?.enabled !== false,
    },
    water: {
      enabled: water?.enabled !== false,
      levelMode: inferredWaterLevelMode,
      // 水线语义 = 地形最低点 + 偏移。偏移范围按真实地形放宽到 ±1000m：
      // 编辑器地形起伏可达 2000m+，旧 ±50m 无法把低地调到水面以上（看不到任何水面）。
      levelOffset: clampNumber(water?.levelOffset, defaults.water.levelOffset, -1000, 1000),
    },
    walls: {
      drystone: {
        enabled: wallGroupEnabled(walls?.drystone, legacyBarrierEnabled),
        density: clampNumber(
          walls?.drystone?.density,
          legacyBarrierDensity ?? defaults.walls.drystone.density,
          0,
          1,
        ),
      },
      fence: { enabled: wallGroupEnabled(walls?.fence, legacyBarrierEnabled) },
      barrier: { enabled: wallGroupEnabled(walls?.barrier, legacyBarrierEnabled) },
      seaWall: { enabled: wallGroupEnabled(walls?.seaWall, legacyBarrierEnabled) },
    },
    wind: {
      enabled: wind?.enabled !== false,
      strength: clampNumber(wind?.strength, defaults.wind.strength, 0, 3),
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
    dem: {
      ...props.dem,
      anchor: props.dem.anchor ? { ...props.dem.anchor } : null,
      crs: props.dem.crs ? { ...props.dem.crs } : null,
    },
    surface: { ...props.surface },
    road: {
      ...props.road,
      routing: { ...props.road.routing },
      generatedRoute: props.road.generatedRoute
        ? {
            ...props.road.generatedRoute,
            waypoints: props.road.generatedRoute.waypoints.map((point) => ({ ...point })),
            centerline: cloneGeneratedRouteCenterline(props.road.generatedRoute.centerline),
          }
        : null,
      waypoints: props.road.waypoints.map((waypoint) => ({ x: waypoint.x, z: waypoint.z })),
    },
    forest: { ...props.forest },
    grass: { ...props.grass },
    bushes: { ...props.bushes },
    canopy: { ...props.canopy },
    water: { ...props.water },
    walls: {
      drystone: { ...props.walls.drystone },
      fence: { ...props.walls.fence },
      barrier: { ...props.walls.barrier },
      seaWall: { ...props.walls.seaWall },
    },
    wind: { ...props.wind },
    debug: { ...props.debug },
  }
}

/** 逐层风摆系数（lab `WIND_FACTOR`；护栏固定 0）。 */
export const PROCEDURAL_LANDSCAPE_WIND_FACTOR = {
  grass: 0.1,
  bush: 0.06,
  tree: 0.03,
  barrier: 0,
} as const

/**
 * 雾/视距尺度倍率：官方雾尺度按 1000m 世界调参（lab 1600m 世界刚好被包住）；
 * 编辑器地形可达数十公里，直接套官方尺度会让 1km 以外整片地形变成雾色。
 * 自动档按地形水平尺寸给出 `clamp(max(sizeX,sizeZ)/3000, 1, 16)` × 官方 1000m
 * —— 地形 ≤3km 时恒为 1×，与 lab DEM 大世界的取景规则一致。显式给出 `surface.viewDistanceScale`
 * 时按它夹紧。
 */
export function resolveSurfaceViewDistanceScale(
  props: ProceduralLandscapeComponentProps,
  horizontalSizeMeters: number,
): number {
  if (props.surface.viewDistanceScale != null) {
    return clamp(props.surface.viewDistanceScale, 1, 16)
  }
  return clamp(Math.max(1, horizontalSizeMeters) / 3000, 1, 16)
}

/**
 * 地表高度带归一化（迁移端新增）：官方地表公式按「水面以上 0..300m」调参；
 * lab 世界起伏仅 ±40m 故把高度 ×4（lab 常量，逐字一致）。编辑器真实地形起伏可达
 * 数百米，直接代入真实米数会让 heather / light grass 等高度项在大片区域饱和
 * （地表整片发灰发白）。这里按实测起伏归一化：起伏 ≤60m 时系数为 4（与 lab 相同），
 * 更大时按比例压缩并夹在 [0.25, 4]，使整带落在官方 300m 内。
 * 仅 height 项参与缩放；沙带 / 树影（heightRel/4）等仍按真实米数。
 */
export function resolveSurfaceHeightScale(reliefMeters: number): number {
  if (!(reliefMeters > 0)) {
    return 4
  }
  return clamp(Math.min(4, 300 / reliefMeters), 0.25, 4)
}

export function roadHalfWidth(props: ProceduralLandscapeComponentProps): number {
  return Math.max(0.5, props.road.width * 0.5)
}

/** Current editable waypoint draft (one point is valid for seeded/boundary routes). */
export function activeRoadWaypoints(props: ProceduralLandscapeComponentProps): RoadWaypoint[] {
  return props.road.waypoints.length ? props.road.waypoints : []
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
