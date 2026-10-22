import * as THREE from 'three'
import {
  buildForestDensityField,
  buildDemForestDensityField,
  buildVariationField,
  createDensityDataTexture,
  forestDensityClassAt,
  type LandscapeDensityField,
} from './densityField'
import {
  createTerrainGridBuilder,
  type TerrainGridBuilder,
  type TerrainHeightGrid,
  type TerrainMeshSource,
  collectTerrainMeshSources,
} from './terrainSampler'
import {
  createDemCoarseSurfaceHeightAt,
  createDemTerrainHeightGrid,
  createDemTerrainMeshBuilder,
  createTerrainDemRuntimeOrthoTexture,
  loadTerrainDemRuntimeGrid,
  loadTerrainDemRuntimeOrtho,
  sampleVisibleDemSurfaceHeightAt,
  type DemTerrainMeshBuilder,
} from './demTerrain'
import type { TerrainDemRuntimeGridData } from '../terrainDemRuntimeGrid'
import { terrainDemRuntimeOrthoCoverage } from '../terrainDemRuntimeOrtho'
import {
  buildTerrainSurfaceSampler,
  type TerrainSurfaceBounds,
  type TerrainSurfaceSampler,
} from './terrainSurfaceSampler'
import type { RoadTraceNode } from './roadTrace'
import {
  buildRoadFieldData,
  computeRoadEdgeHeights,
  createRoadFieldTexture,
  type RoadEdgeHeights,
  type RoadFieldData,
} from './roadField'
import {
  buildRoadProximityIndex,
  verifyRoadProximityIndex,
  type RoadProximityIndex,
} from './roadProximity'
import { planCameraGrassChunk, planRoadBucket, planTreeChunk, takeDensityPrefix, type GrassPlacement, type TreePlacement } from './chunkPlan'
import {
  applyFoliageMaterialSeason,
  createFoliageLayerMesh,
  createFoliageMaterial,
  createFoliageShaderUniforms,
  disposeFoliageLayerMesh,
  getFoliageLayerCapacity,
  setFoliageMaterialCardRange,
  setFoliageMaterialLighting,
  setFoliageMaterialTextures,
  updateFoliageLayerMesh,
  type FoliageMaterialHandle,
  type FoliageMaterialSpec,
  type FoliageShaderUniforms,
  type FoliageSpriteInstance,
} from './instancing'
import {
  createWorldForestPlacementIndex,
  createWorldForestScan,
  planWorldForestCorridor,
  stepWorldForestScan,
  type WorldForestPlacementIndex,
  type WorldForestScan,
} from './worldForest'
import {
  resolveAutoWaterLevel,
  computeWaterFloodStats,
  WATER_FLOOD_VISIBLE_FRACTION,
  type WaterFloodStats,
} from './waterStats'
import {
  applyProceduralLandscapeSurfaceInjection,
  createProceduralLandscapeSurfaceUniforms,
  type ProceduralLandscapeSurfacePatch,
  type ProceduralLandscapeSurfaceOverrides,
} from './surfaceMaterial'
import { createRoadBand, type RoadBandHandle, type RoadBandTextures } from './roadBand'
import { createRoadCollisionGeometry } from './roadCollision'
import {
  markProceduralLandscapeDemTerrain,
  markProceduralLandscapeRoadbedSurface,
  markProceduralLandscapeRoadCollision,
} from './collisionMetadata'
import { createTreeMeshManager, type TreeMeshManager } from './treeMeshes'
import {
  buildTreeSpeciesField,
  slowroadsTreeLineFactor,
  slowroadsTreeLineBounds,
  slowroadsTreeSpeciesAt,
  type TreeSpeciesField,
} from './treeSpecies'
import { computeRoadMarkings, type RoadMarkingWeights } from './roadMarkings'
import {
  DEFAULT_ROAD_STYLE,
  ROAD_STYLE_PROFILES,
  isSingleTrackRoad,
  type RoadStyleId,
} from './roadStyle'
import {
  clipWallSegmentsToExclusions,
  computeWallSegments,
  type WallSegment,
} from './walls'
import { createWallLayers, wallFenceSpriteSamples, type WallLayerHandle } from './wallLayer'
import { createWaterPlane, type WaterPlaneHandle } from './waterPlane'
import { getSharedSlowroadsAssetStore, slowroadsSharedRetainIds, type SlowroadsAssetStore } from '../slowroads/assets/assetStore'
import { collectProceduralLandscapeCoreTextureRefs } from './preload'
import {
  collectLandscapeSharedTextureRefs,
  collectSeasonTextureRefs,
  collectSurfaceTextureRefs,
  SEASON_CATALOG,
  SHARED_TEXTURES,
  type SeasonId,
  type SeasonTextureRef,
  type SeasonTextureRefFilter,
} from '../slowroads/core/seasonCatalog'
import { SEASON_PARAMS } from '../slowroads/core/seasonParams'
import { resolveEnvironmentPreset } from '../slowroads/core/environment'
import {
  resolveAdaptiveCalibrationDecision,
  resolveAdaptiveLandscapeProfile,
  type LandscapeAdaptiveCalibrationState,
  type ProceduralLandscapeAdaptiveProfile,
  type ProceduralLandscapeDeviceProfile,
} from './adaptive'
import {
  runMaterialUniformCoverageChecks,
  runSlowroadsSeasonChecks,
  runTreeDiscolourationShaderChecks,
} from '../slowroads/render/selfCheck'
import { collectSlowroadsShaderAudits } from './shaderAudit'
import {
  BARRIER_RAIL_REGIONS,
  bushVariantEntries,
  grassVariantEntries,
  gridRegions,
  type SpriteCellRegion,
  type SpriteRegion,
} from '../slowroads/core/spriteRegions'
import { getCachedModelObject } from '../modelObjectCache'
import {
  COMPONENT_ARTIFACT_COMPONENT_ID_KEY,
  COMPONENT_ARTIFACT_KEY,
  COMPONENT_ARTIFACT_NODE_ID_KEY,
} from '../components/componentManager'
import { findTerrainTextureStreamFrom } from '../terrainTextureStream'
import { clamp, degreesToRadians, hashUnit, lerp } from './noise'
import {
  densifyRoadRows,
  sampleRoadRowColumns,
  type RoadBandRow,
} from './roadBandRows'
import {
  resolveRoadLanePoseFromRows,
  type RoadLanePose,
} from '../vehicleRoadRespawn'
import {
  createDemRoadbedTarget,
  createDemRoadbedTargetGeometry,
  type DemRoadbedTarget,
} from './demRoadbed'
import { resolveTreeLodBands } from './treeLod'
import {
  clampProceduralLandscapeProps,
  PROCEDURAL_LANDSCAPE_WIND_FACTOR,
  PROCEDURAL_LANDSCAPE_QUALITY_TIERS,
  resolveSurfaceHeightScale,
  resolveSurfaceViewDistanceScale,
  resolveProceduralLandscapeQuality,
  resolveProceduralLandscapeBaseMapBlend,
  resolveProceduralLandscapeBaseMapMode,
  roadFlattenParams,
  roadHalfWidth,
  shouldLoadProceduralLandscapeOrtho,
  type ProceduralLandscapeGeneratedRouteCenterline,
  type ProceduralLandscapeComponentProps,
  type ProceduralLandscapeEnvironment,
  type ProceduralLandscapeGeneratedRouteProps,
  type ProceduralLandscapeRoadProps,
  type ProceduralLandscapeWaterLevelMode,
  type ResolvedProceduralLandscapeQuality,
} from './config'
import { transformRoadWaypointsToWorld, type RoadWaypoint } from './roadWaypoints'
import {
  createCachedCenterlineRoadRoute,
  planWaypointRoadRoute,
  type WaypointRoadPlanResult,
} from './proceduralRoad'
import {
  resolveRoadWaypointPlacement,
  resolveLowlandScenicStart,
  ROAD_WAYPOINT_SNAP_RADIUS,
  SLOWROADS_SCENIC_ROAD_CONSTRAINTS,
  type RoadWaypointPlacementFailureReason,
  type ScenicWaypointPlacement,
} from './officialScenicRoad'
import { setSlowroadsSceneViewDistanceScale } from '../slowroads/render/environmentRuntime'
import {
  filterLandscapeExclusionPlacements,
  getLandscapeExclusionSnapshot,
  landscapeExclusionSignature,
  polylineIntersectsExclusion,
  type LandscapeExclusionCircle,
} from './exclusion'

const TREE_BATCH_RELEASE_PADDING = 48
const ROAD_BUCKET_LENGTH = 16
const CAMERA_GRASS_BATCH_SIZE = 32
const CAMERA_GRASS_CELL_SIZE = 8
const STREAM_INTERVAL_MS = 200
const STREAM_MOVE_THRESHOLD = 8
const NEAR_CARD_REFRESH_DISTANCE = 24
const NEAR_MESH_REFRESH_DISTANCE = 8
const NEAR_ROAD_FALLBACK_SAMPLE_METERS = 10
const NEAR_ROAD_FALLBACK_DEDUPE_CELL_METERS = 5
const ROAD_FIELD_RESOLUTION = 1024
/** 横坡贴合模式下路面带相对地形的固定抬升（米）。 */
const ROAD_BAND_LIFT = 0.05
/** 贴合模式下路面带的横向采样列数（从左缘到右缘）。 */
const ROAD_BAND_COLUMN_COUNT = 9
/** 贴合模式下路面带的沿路采样间距（米）：追踪节点 8m 之间加密，接住横向折坡。 */
const ROAD_BAND_ROW_SPACING = 2
/** 碰撞路面沿路间距：只保留可行走形状，避免 2m 密集三角面造成接触抖动。 */
const ROAD_COLLISION_ROW_SPACING = 4
const ROAD_COLLISION_COLUMN_COUNT_DEM = 3
const ROAD_COLLISION_COLUMN_COUNT_GENERIC = 5
const DEBUG_ROAD_HEIGHT_OFFSET = 0.6
const SOURCE_CHECK_INTERVAL_MS = 500
const TREE_UNIT_SIZE = 8
const GRASS_UNIT_SIZE = 1.6
const BUSH_UNIT_SIZE = 2
const IMPOSTER_REGIONS: SpriteRegion[] = gridRegions(16, 4, 4096, 1024)
/**
 * One front-facing imposter per row. The tree-card atlases pack detached
 * canopies and fallen branches into the same four columns as the upright
 * trees; using a whole column makes those fragments hover beside every tree.
 * The imposter atlas contains only complete, upright trees.
 */
const STATIC_IMPOSTER_REGIONS: SpriteRegion[] = [0, 1, 2, 3].map(
  (row) => IMPOSTER_REGIONS[row * 16 + 8]!,
)
/** 木护栏段的世界尺寸（lab：单片面 unitSize 0.35m、alphaTest 0.35）。 */
const BARRIER_UNIT_SIZE = 0.35
let sharedPlaceholderTexture: THREE.DataTexture | null = null
let sharedRoadFallbackTexture: THREE.DataTexture | null = null

/** 1x1 透明贴图：保持所有 sampler 有绑定，真实素材到达前 alphaTest 全部丢弃。 */
function getSharedPlaceholderTexture(): THREE.DataTexture {
  if (!sharedPlaceholderTexture) {
    sharedPlaceholderTexture = new THREE.DataTexture(
      new Uint8Array([0, 0, 0, 0]),
      1,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    )
    sharedPlaceholderTexture.minFilter = THREE.NearestFilter
    sharedPlaceholderTexture.magFilter = THREE.NearestFilter
    sharedPlaceholderTexture.generateMipmaps = false
    sharedPlaceholderTexture.needsUpdate = true
  }
  return sharedPlaceholderTexture
}

/**
 * Opaque asphalt fallback used until the seasonal road textures finish
 * downloading. The transparent 1x1 placeholder would make the road shader
 * discard every fragment, so the road would vanish for the whole load.
 */
function getSharedRoadFallbackTexture(): THREE.DataTexture {
  if (!sharedRoadFallbackTexture) {
    sharedRoadFallbackTexture = new THREE.DataTexture(
      new Uint8Array([62, 60, 58, 255]),
      1,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    )
    sharedRoadFallbackTexture.minFilter = THREE.NearestFilter
    sharedRoadFallbackTexture.magFilter = THREE.NearestFilter
    sharedRoadFallbackTexture.generateMipmaps = false
    sharedRoadFallbackTexture.needsUpdate = true
  }
  return sharedRoadFallbackTexture
}

export type ProceduralLandscapeStatsPhase =
  | 'idle'
  | 'sampling'
  | 'generating'
  | 'streaming'
  | 'error'
  | 'disabled'

export interface ProceduralLandscapeRuntimeStats {
  nodeId: string
  phase: ProceduralLandscapeStatsPhase
  progress: number
  warnings: string[]
  quality: ResolvedProceduralLandscapeQuality
  exclusionZoneCount: number
  exclusionSignature: string
  treeInstances: number
  grassInstances: number
  bushInstances: number
  batchCount: number
  /** 分块分解：树 / 道路走廊（草+灌木）/ 相机周围草。 */
  treeChunkCount: number
  roadChunkCount: number
  cameraGrassChunkCount: number
  gridCols: number
  gridRows: number
  gridCellSize: number
  averageEdgeLength: number
  memoryBytes: number
  roadLength: number
  roadNodeCount: number
  roadComplete: boolean
  roadFailureReason: string | null
  roadStrategy: 'seeded' | 'shortest' | null
  roadPlannerMode: 'official' | 'guided-global' | 'official-natural' | 'cached-centerline' | null
  roadStyle: RoadStyleId | null
  roadNaturalTargetLength: number
  roadNaturalLaps: number
  roadGuideExpandedStates: number
  roadMaxGuideDeviation: number
  roadUnreachableWaypointIndex: number | null
  roadWaypointCount: number
  roadWaypointsPassed: number
  roadWaypointsSkipped: number
  roadSkippedWaypointIndices: number[]
  roadWaypointsAttempted: number
  roadMaxWaypointError: number
  roadClosed: boolean
  shortestExpandedStates: number
  roadOfficialReverts: number
  roadAntiTargetTriggers: number
  roadTurnOverflows: number
  roadTurnDegreesPerKm: number
  roadMaxStraightRunMeters: number
  roadAverageElevationPercentile: number
  roadMaxElevationPercentile: number
  roadMaxForwardGrade: number
  roadMaxCrossSlope: number
  roadLowlandCoverageFraction: number
  roadSteepReplacementSteps: number
  roadSmoothingFallback: boolean
  roadSmoothingFallbackReason: string | null
  roadDetourRadius: number
  roadMaxDetourDistance: number
  roadDetourRadiusExpanded: boolean
  roadMinCenterlineClearance: number
  roadMinTurnRadius: number
  roadGeometryAutoRepaired: boolean
  roadAutoRepairRoundedCorners: number
  roadMaxAutoRepairWaypointOffset: number
  roadEffectiveWaypointTolerance: number
  /** 当前季节与素材状态（面板展示）。 */
  season: SeasonId
  seasonAssetsReady: boolean
  nearTreeInstances: number
  nearCardInstances: number
  nearTreeReady: boolean
  adaptive: {
    deviceTier: 'low' | 'mid' | 'high' | null
    sceneAreaKm2: number | null
    targetCoverage: number | null
    targetDensity: number | null
    effectiveCoverage: number
    effectiveDensity: number
    targetFps: number | null
    targetTreeCount: number | null
    measuredFps: number | null
    calibrationState: LandscapeAdaptiveCalibrationState
    calibrationAttempts: number
  }
  /** 在线资产库统计（下载/常驻/档位）。 */
  assetTextureCount: number
  assetResidentBytes: number
  assetDownloadedBytes: number
  assetVariant: 'full' | '2048'
  /** 木栏（官方 Fence）横栏精灵实例数。 */
  barrierInstances: number
  /** 路侧墙体段数（Drystone / Barrier / Fence / SeaWall 合计）。 */
  wallSegmentCount: number
  /** 远景林（相机锚定多环环带：近景流式半径 → 雾距）实例数。 */
  farTreeInstances: number
  /** 远景林当前外半径（米；0 = 关闭/尚未建立）。 */
  farForestRadius: number
  worldForestInstances: number
  worldForestBuildMs: number
  broadleafTreeInstances: number
  coniferTreeInstances: number
  coniferTreeFraction: number
  treeLineMidY: number
  treeLineTopY: number
  roadbedHalfWidth: number
  roadbedSideWidth: number
  roadbedCutProx: number
  roadbedMaxCutFill: number
  roadbedCrossSlopeMax: number
  roadbedOuterError: number
  roadbedMaxOuterGap: number
  roadbedOcclusionCount: number
  roadbedAuditSamples: number
  roadbedTriangleCount: number
  /** 水面是否启用。 */
  waterEnabled: boolean
  /** 当前实际水线（世界 Y，已包含自动或手动模式）。 */
  waterLevel: number
  waterLevelMode: ProceduralLandscapeWaterLevelMode
  /** 压缩后的水面 DEM 深度纹理字节数。 */
  waterDepthTextureBytes: number
  /**
   * 水线以下地形面积占比（0..1，采样统计）。
   * ≈0 表示水面与地形最低点相切、被地形整体遮住（看不到任何水面）。
   */
  waterFloodedFraction: number
  /** 当前生效的雾/视距尺度倍率（1 = 与官方/lab 逐字一致）。 */
  viewDistanceScale: number
  /** DEM runtime source status (null asset keeps the GLB terrain path). */
  demStatus: 'inactive' | 'idle' | 'loading' | 'building' | 'ready' | 'error'
  demSourceBytes: number | null
  demSampleStep: number
  demBuildMs: number
  demError: string | null
  demOrthoStatus: 'unavailable' | 'idle' | 'loading' | 'ready' | 'error'
  demOrthoBytes: number | null
  demOrthoWidth: number
  demOrthoHeight: number
  /** Fraction of orthophoto pixels with RGB data (0..1; missing pixels are black). */
  demOrthoCoverage: number
  demOrthoError: string | null
  /** DEM nodes are translation-only; non-identity rotation/scale is reported here. */
  demTransformWarning: string | null
  /** GPU-bound position/normal/index bytes of the generated DEM mesh. */
  demMeshBytes: number
}

export interface ProceduralLandscapeEnvironmentState {
  season: SeasonId
  timeOfDay: 'morning' | 'day' | 'evening' | 'night'
  weather: 'clear' | 'overcast'
}

export interface ProceduralLandscapeRuntimeHooks {
  nodeId: string
  componentId: string
  getHostObject(): THREE.Object3D | null
  getCameraWorldPosition(): THREE.Vector3 | null
  getCameraWorldDirection?(): THREE.Vector3 | null
  /** 来自 ComponentFrameState.environment（EnvironmentPanel 设置）。 */
  getSeasonState(): ProceduralLandscapeEnvironmentState | null
}

export type GuideRouteSurfaceProviderStatus = 'inactive' | 'loading' | 'error' | 'ready'

export type GuideRouteSurfaceBounds = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  minY: number
  maxY: number
  cellSize: number
}

export type GuideRouteSurfaceState = {
  status: GuideRouteSurfaceProviderStatus
  revision: number
  message: string | null
  /** World-space raster bounds used to restrict editor pointer ray marching. */
  bounds?: GuideRouteSurfaceBounds | null
}

export type GuideRouteSurfaceSample = {
  point: THREE.Vector3
  normal: THREE.Vector3
  kind: 'road' | 'terrain'
  distanceToRoad: number | null
  revision: number
}

export type ProceduralLandscapePlacementSurface = {
  /** Monotonic revision for runtime-owned visible surface changes. */
  revision: number
  bounds: GuideRouteSurfaceBounds
  /** Exact visible terrain height at a world-space XZ position. */
  sampleHeightAt(worldX: number, worldZ: number): number | null
}

export interface ProceduralLandscapeRuntime {
  attach(host: THREE.Object3D | null): void
  setProps(props: ProceduralLandscapeComponentProps): void
  setEnabled(enabled: boolean): void
  update(deltaTime: number): void
  dispose(): void
  getStats(): ProceduralLandscapeRuntimeStats
  /** Dry-run a generated route before the editor replaces its current road. */
  validateGeneratedRoad(
    route: ProceduralLandscapeGeneratedRouteProps,
    road: ProceduralLandscapeRoadProps,
  ): ProceduralLandscapeRoadValidation
  /** Editor-authored centerline snapshot in host-node local XZ. */
  getGeneratedRoadCenterlineLocal(): ProceduralLandscapeGeneratedRouteCenterline | null
  /** Nearest right-hand road lane pose for vehicle recovery, in world space. */
  resolveRoadLanePose(
    worldX: number,
    worldZ: number,
    facingYawRad: number,
  ): RoadLanePose | null
  /** Terrain XZ center in host-node local coordinates, when the grid is ready. */
  getTerrainCenterLocal(): RoadWaypoint | null
  /** Low, gentle automatic start near the terrain centre, in local XZ. */
  getScenicStartLocal(): RoadWaypoint | null
  /** Snap a clicked world-space point to a nearby suitable waypoint. */
  resolveScenicWaypointLocal(
    worldX: number,
    worldZ: number,
    maxRadius?: number,
  ): ProceduralLandscapeWaypointResolutionResult
  /**
   * Runtime height-field sampling in world XZ (null when the grid is not
   * ready yet or the point lies outside the rasterized coverage).
   */
  sampleTerrainHeight(worldX: number, worldZ: number): number | null
  /** Ready visible terrain surface used by editor asset placement. */
  getPlacementSurface(): ProceduralLandscapePlacementSurface | null
  /** Shared road-first surface sampling used by Guide Route and AutoTour. */
  getGuideRouteSurfaceState(): GuideRouteSurfaceState
  sampleGuideRouteSurface(
    worldX: number,
    worldZ: number,
    facingYawRad?: number,
  ): GuideRouteSurfaceSample | null
}

export interface ProceduralLandscapeRoadValidation {
  ok: boolean
  failureReason: string | null
  nodeCount: number
  length: number
  unreachableWaypointIndex?: number | null
  centerline: ProceduralLandscapeGeneratedRouteCenterline | null
}

export interface ProceduralLandscapeScenicWaypointResolution extends ScenicWaypointPlacement {
  localX: number
  localZ: number
}

export type ProceduralLandscapeWaypointResolutionFailureReason =
  | RoadWaypointPlacementFailureReason
  | 'terrain-grid-not-ready'
  | 'coordinate-conversion-failed'

export type ProceduralLandscapeWaypointResolutionResult =
  | {
      ok: true
      placement: ProceduralLandscapeScenicWaypointResolution
      snapped: boolean
    }
  | {
      ok: false
      failureReason: ProceduralLandscapeWaypointResolutionFailureReason
    }

let currentEnvironment: ProceduralLandscapeEnvironment = 'preview'
let currentDeviceProfile: ProceduralLandscapeDeviceProfile | null = null
let currentMemoryPressure = false

export function setProceduralLandscapeEnvironment(environment: ProceduralLandscapeEnvironment): void {
  currentEnvironment = environment
}

export function getProceduralLandscapeEnvironment(): ProceduralLandscapeEnvironment {
  return currentEnvironment
}

export function setProceduralLandscapeDeviceProfile(
  profile: ProceduralLandscapeDeviceProfile | null,
): void {
  currentDeviceProfile = profile
}

export function setProceduralLandscapeMemoryPressure(value: boolean): void {
  currentMemoryPressure = value === true
}

const statsRegistry = new Map<string, ProceduralLandscapeRuntimeStats>()

export function getProceduralLandscapeStats(nodeId: string): ProceduralLandscapeRuntimeStats | null {
  return statsRegistry.get(nodeId) ?? null
}

const runtimeRegistry = new Map<string, ProceduralLandscapeRuntime>()

/**
 * 运行期高度场采样（世界 XZ）：编辑器绘制手绘公路路径时用它把路径点贴到
 * 地形表面。网格未构建完成、组件未启用或点在地形范围外时返回 null。
 */
export function sampleProceduralLandscapeTerrainHeight(
  nodeId: string,
  worldX: number,
  worldZ: number,
): number | null {
  const runtime = runtimeRegistry.get(nodeId)
  if (!runtime) {
    return null
  }
  return runtime.sampleTerrainHeight(worldX, worldZ)
}

export function getProceduralLandscapePlacementSurface(
  nodeId: string,
): ProceduralLandscapePlacementSurface | null {
  const runtime = runtimeRegistry.get(nodeId)
  return runtime?.getPlacementSurface() ?? null
}

export function getProceduralLandscapeGuideRouteSurfaceState(
  nodeId: string,
): GuideRouteSurfaceState | null {
  const runtime = runtimeRegistry.get(nodeId)
  return runtime?.getGuideRouteSurfaceState() ?? null
}

export function sampleProceduralLandscapeGuideRouteSurface(
  nodeId: string,
  worldX: number,
  worldZ: number,
  facingYawRad = 0,
): GuideRouteSurfaceSample | null {
  const runtime = runtimeRegistry.get(nodeId)
  return runtime?.sampleGuideRouteSurface(worldX, worldZ, facingYawRad) ?? null
}

export function getProceduralLandscapeTerrainCenterLocal(
  nodeId: string,
): RoadWaypoint | null {
  const runtime = runtimeRegistry.get(nodeId)
  return runtime?.getTerrainCenterLocal() ?? null
}

export function getProceduralLandscapeScenicStartLocal(
  nodeId: string,
): RoadWaypoint | null {
  const runtime = runtimeRegistry.get(nodeId)
  return runtime?.getScenicStartLocal() ?? null
}

export function getProceduralLandscapeRoadCenterlineLocal(
  nodeId: string,
): ProceduralLandscapeGeneratedRouteCenterline | null {
  const runtime = runtimeRegistry.get(nodeId)
  return runtime?.getGeneratedRoadCenterlineLocal() ?? null
}

export function resolveProceduralLandscapeRoadLanePose(
  nodeId: string,
  worldX: number,
  worldZ: number,
  facingYawRad: number,
): RoadLanePose | null {
  const runtime = runtimeRegistry.get(nodeId)
  return runtime?.resolveRoadLanePose(worldX, worldZ, facingYawRad) ?? null
}

export function resolveProceduralLandscapeScenicWaypointLocal(
  nodeId: string,
  worldX: number,
  worldZ: number,
  maxRadius?: number,
): ProceduralLandscapeWaypointResolutionResult {
  const runtime = runtimeRegistry.get(nodeId)
  if (!runtime) {
    return { ok: false, failureReason: 'terrain-grid-not-ready' }
  }
  return runtime.resolveScenicWaypointLocal(worldX, worldZ, maxRadius)
}

export function validateProceduralLandscapeGeneratedRoute(
  nodeId: string,
  route: ProceduralLandscapeGeneratedRouteProps,
  road: ProceduralLandscapeRoadProps,
): ProceduralLandscapeRoadValidation | null {
  const runtime = runtimeRegistry.get(nodeId)
  return runtime?.validateGeneratedRoad(route, road) ?? null
}

type DirtyFlags = {
  grid: boolean
  world: boolean
  demMesh: boolean
  instances: boolean
  uniforms: boolean
}

type RoadBucketEntry = {
  index: number
  fromX: number
  fromZ: number
  toX: number
  toZ: number
  centerX: number
  centerZ: number
}

type BatchEntry = {
  key: string
  group: THREE.Group
  layers: THREE.InstancedMesh[]
  centerX: number
  centerZ: number
  treeInstances: number
  grassInstances: number
  bushInstances: number
  /** 树块携带放置表，供近树 3D 网格层流式装配。 */
  treePlacements: TreePlacement[]
}

function jsonKey(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export interface DemRoadbedSignatureOptions {
  cellSize: number
  sampleStep: number
  target: DemRoadbedTarget | null
  routeNodeCount: number
  routeLength: number
}

/**
 * Signature for the DEM coarse mesh's baked cut/fill surface.
 *
 * Live waypoint edits are intentionally excluded: only a committed
 * `generatedRoute` can change the roadbed geometry.
 */
export function resolveDemRoadbedSignature(
  props: ProceduralLandscapeComponentProps,
  options: DemRoadbedSignatureOptions,
): string {
  const target = options.target
  return jsonKey([
    props.dem.assetId,
    props.dem.runtimeGridUrl,
    props.dem.runtimeOrthoUrl,
    options.sampleStep,
    options.cellSize,
    props.generationRevision,
    props.seed,
    props.road.enabled,
    props.road.width,
    props.road.shoulderWidth,
    props.road.flattenBand,
    props.road.flattenStrength,
    props.road.maxSlope,
    props.road.generatedRoute,
    options.routeNodeCount,
    Number(options.routeLength.toFixed(3)),
    target
      ? [
          target.halfWidth,
          target.shoulderWidth,
          target.sideWidth,
          target.meshHalfWidth,
          target.coarseClearance,
        ]
      : null,
  ])
}

export function resolveDemSurfaceOverrides(
  role: 'terrain' | 'roadbed',
  cutProx: number,
): ProceduralLandscapeSurfaceOverrides {
  if (role === 'terrain') {
    return {
      uPlRoadbedCutProx: cutProx,
      uPlUseBaseSurface: 0,
      uPlRoadDisplacement: 0,
      // DEM cut/fill is already baked into the generated geometry. Applying
      // the low-resolution road raster again here can lift it above the road.
      uPlFlattenStrength: 0,
    }
  }
  return {
    uPlRoadbedCutProx: 0,
    uPlUseBaseSurface: 1,
    uPlRoadDisplacement: 0,
    uPlFlattenStrength: 0,
    uPlShowCanopy: 0,
    uPlRoadbedBrightness: 1.1,
  }
}

/**
 * 网格自身**或任一祖先**带 artifact 标记时视为 proceduralLandscape 自建物件。
 *
 * 近树 3D 网格、植被批次等只标了容器/组（`treeMeshManager.container`、
 * `foliageRoot` 下的批组），网格自身没有标记；若只检查自身，重新注入地表材质时
 * 会把它们当成 GLB 地形网格接管（表现为「树被地表贴图渲染」——官方地表片元按
 * 世界坐标采样季节贴图，贴到树上就是地形纹理）。
 */
export function isProceduralLandscapeArtifact(object: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object
  while (node) {
    if ((node.userData as Record<string, unknown> | undefined)?.[COMPONENT_ARTIFACT_KEY] === true) {
      return true
    }
    node = node.parent
  }
  return false
}

/**
 * 收集宿主节点下「真正的地形网格」（地表材质注入的目标）。
 * 自建物件（护栏 / 水面 / 植被层 / 近树 3D 网格等，见上）与其整个子树都跳过。
 */
export function collectProceduralLandscapeSurfaceMeshes(hostObject: THREE.Object3D | null): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  if (!hostObject) {
    return meshes
  }
  hostObject.updateMatrixWorld(true)
  hostObject.traverse((child) => {
    const mesh = child as THREE.Mesh & { isMesh?: boolean }
    if (!mesh.isMesh || !mesh.geometry || !mesh.material) {
      return
    }
    if (isProceduralLandscapeArtifact(mesh)) {
      return
    }
    meshes.push(mesh)
  })
  return meshes
}

function buildRoadBucketTable(nodes: RoadTraceNode[], bucketLength: number): RoadBucketEntry[] {
  if (nodes.length < 2) {
    return []
  }
  const cumulative: number[] = [0]
  for (let i = 1; i < nodes.length; i += 1) {
    const previous = nodes[i - 1]!
    const current = nodes[i]!
    cumulative.push(cumulative[i - 1]! + Math.hypot(current.x - previous.x, current.z - previous.z))
  }
  const total = cumulative[cumulative.length - 1]!
  if (total <= 0) {
    return []
  }
  const sampleAt = (distance: number): { x: number; z: number } => {
    const clampedDistance = clamp(distance, 0, total)
    let low = 0
    let high = cumulative.length - 1
    while (low < high - 1) {
      const mid = (low + high) >> 1
      if (cumulative[mid]! <= clampedDistance) {
        low = mid
      } else {
        high = mid
      }
    }
    const segmentLength = Math.max(1e-6, cumulative[high]! - cumulative[low]!)
    const t = (clampedDistance - cumulative[low]!) / segmentLength
    const from = nodes[low]!
    const to = nodes[high]!
    return { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t }
  }
  const bucketCount = Math.max(1, Math.ceil(total / bucketLength))
  const buckets: RoadBucketEntry[] = []
  for (let index = 0; index < bucketCount; index += 1) {
    const start = sampleAt(index * bucketLength)
    const end = sampleAt(Math.min((index + 1) * bucketLength, total))
    buckets.push({
      index,
      fromX: start.x,
      fromZ: start.z,
      toX: end.x,
      toZ: end.z,
      centerX: (start.x + end.x) * 0.5,
      centerZ: (start.z + end.z) * 0.5,
    })
  }
  return buckets
}

/** 公路走廊 AABB（用于真实地形面采样器的索引范围）。 */
function resolveRoadCorridorBounds(
  nodes: ReadonlyArray<RoadTraceNode>,
  margin: number,
): TerrainSurfaceBounds {
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const node of nodes) {
    if (node.x < minX) minX = node.x
    if (node.x > maxX) maxX = node.x
    if (node.z < minZ) minZ = node.z
    if (node.z > maxZ) maxZ = node.z
  }
  return {
    minX: minX - margin,
    minZ: minZ - margin,
    maxX: maxX + margin,
    maxZ: maxZ + margin,
  }
}


function createEmptyRoadFieldTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

function pickCellEntry(entries: ReadonlyArray<SpriteCellRegion>, variant: number): SpriteCellRegion | null {
  if (!entries.length) {
    return null
  }
  const index = Math.min(entries.length - 1, Math.floor(Math.max(0, Math.min(0.9999, variant)) * entries.length))
  return entries[index] ?? null
}

export function createProceduralLandscapeRuntime(hooks: ProceduralLandscapeRuntimeHooks): ProceduralLandscapeRuntime {
  const uniforms = createProceduralLandscapeSurfaceUniforms()
  const foliageUniforms: FoliageShaderUniforms = createFoliageShaderUniforms()
  const assetStore: SlowroadsAssetStore = getSharedSlowroadsAssetStore()

  let props = clampProceduralLandscapeProps(null, hooks.nodeId)
  let previousKeys = {
    grid: jsonKey(props.sampling),
    dem: jsonKey([
      props.dem.assetId,
      props.dem.runtimeGridUrl,
      props.dem.runtimeOrthoUrl,
      props.dem.sampleStep,
    ]),
    world: jsonKey([
      props.seed,
      props.generationRevision,
      props.road.generatedRoute,
      props.road.enabled,
      props.road.width,
      props.road.shoulderWidth,
      props.road.stepLength,
      props.road.feelDistance,
      props.road.feelAngleDeg,
      props.road.maxSlope,
      props.road.maxTurnDeg,
      props.road.flattenBand,
      props.road.flattenStrength,
      props.forest.coverage,
      props.forest.scale,
      props.forest.seedOffset,
    ]),
    forest: jsonKey([
      props.seed,
      props.forest.coverage,
      props.forest.scale,
      props.forest.seedOffset,
      props.forest.density,
      props.forest.maxSlope,
      props.forest.minHeight,
      props.forest.minScale,
      props.forest.maxScale,
      props.quality,
    ]),
    instances: jsonKey([props.grass, props.bushes, props.quality]),
    waterSpatial: jsonKey([props.water.levelMode, props.water.levelOffset]),
    lod: jsonKey([props.forest.nearDistance, props.forest.nearTreeRadius, props.quality]),
    uniforms: jsonKey([props.surface, props.canopy, props.wind, props.road.flattenBand, props.road.flattenStrength]),
    textureNeeds: jsonKey([
      props.surface.enabled,
      props.surface.textures,
      props.forest.coverage,
      props.forest.density,
      props.grass.enabled,
      props.bushes.enabled,
      props.road.enabled,
      props.road.width,
      props.walls.drystone.enabled,
      props.walls.fence.enabled,
      props.walls.barrier.enabled,
      props.walls.seaWall.enabled,
      props.water.enabled,
    ]),
    roadDebug: jsonKey(props.debug.showRoadPath),
    chunkDebug: jsonKey(props.debug.showChunks),
  }
  const dirty: DirtyFlags = {
    grid: false,
    world: false,
    demMesh: false,
    instances: false,
    uniforms: true,
  }
  let appliedExclusionCircles: LandscapeExclusionCircle[] = []
  let exclusionCapturePending = true
  let landscapeWorldBuilt = false
  let forceStream = true
  let enabled = true
  let disposed = false
  let hostObject: THREE.Object3D | null = null
  let hostMatrixSnapshot: THREE.Matrix4 | null = null
  const hostRotationSnapshot = new THREE.Quaternion()
  const hostScaleSnapshot = new THREE.Vector3(1, 1, 1)
  let foliageRoot: THREE.Group | null = null
  let debugRoot: THREE.Group | null = null
  let gridBuilder: TerrainGridBuilder | null = null
  let grid: TerrainHeightGrid | null = null
  let demGridData: TerrainDemRuntimeGridData | null = null
  let demGridSampleStep = 1
  let demMeshBuilder: DemTerrainMeshBuilder | null = null
  let demMesh: THREE.Mesh | null = null
  let guideRouteSurfaceRevision = 0
  let demRoadbedSignature = ''
  let demMeshRoadbedSignature = ''
  let demMeshBuildRoadbedSignature = ''
  let demWorldBuilt = false
  let demLoadPromise: Promise<void> | null = null
  let demLoadToken = 0
  let demSourceKey = ''
  let demOrthoTexture: THREE.DataTexture | null = null
  let demOrthoLoadPromise: Promise<void> | null = null
  let demOrthoLoadToken = 0
  let demOrthoSourceKey = ''
  let demBuildStartedAt = 0
  let demBuildMs = 0
  let demTransformWarning: string | null = null
  let demTransformWarningActive = false
  let demRoadbedMesh: THREE.Mesh | null = null
  let demRoadbedCollisionMesh: THREE.Mesh | null = null
  let demRoadbedHalfWidth = 0
  let densityField: LandscapeDensityField | null = null
  let treeSpeciesField: TreeSpeciesField | null = null
  let variationField: LandscapeDensityField | null = null
  let forestMaskTexture: THREE.DataTexture | null = null
  let variationTexture: THREE.DataTexture | null = null
  let roadResult: WaypointRoadPlanResult | null = null
  let roadPlanFailureReason: string | null = null
  let invalidRoadGeometryClearance = 0
  let invalidRoadGeometryTurnRadius = 0
  let roadFieldData: RoadFieldData | null = null
  /** 贴合：与 roadResult.nodes 对齐的左右缘地形高度（压平场用）。 */
  let roadEdgeHeights: RoadEdgeHeights[] | null = null
  /** 贴合：与 roadResult.nodes 对齐的中线真实面高度（压平场用）。 */
  let roadCenterHeights: number[] | null = null
  /** 贴合：路面带行采样（追踪节点按 2m 加密）与逐行横向剖面。 */
  let roadBandRows: RoadBandRow[] | null = null
  let roadBandColumns: number[][] | null = null
  /** 公路走廊的真实三角面采样器（带面/压平场的共同高度来源）。 */
  let roadSurfaceSampler: TerrainSurfaceSampler | null = null
  /**
   * 精确道路距离索引（段空间哈希）：放置过滤与 per-instance `roadProx` 的唯一
   * 距离来源。光栅场在数十公里地形上格边长 40m+，会把路面上的候选误判为
   * 「离路足够远」；该索引精度不受地形尺度影响（slowroads-lab `roadProfile` 移植）。
   */
  let roadProximity: RoadProximityIndex | null = null
  let roadFieldTexture: THREE.DataTexture | null = createEmptyRoadFieldTexture()
  let roadBucketTable: RoadBucketEntry[] = []
  let surfacePatch: ProceduralLandscapeSurfacePatch | null = null
  let surfaceMeshes: THREE.Mesh[] = []
  let roadBand: RoadBandHandle | null = null
  let roadCollisionMesh: THREE.Mesh | null = null
  let treeMeshManager: TreeMeshManager | null = null
  let treeMeshInitStarted = false
  let waterPlane: WaterPlaneHandle | null = null
  let barrierLayer: THREE.InstancedMesh | null = null
  let barrierInstances = 0
  /** World-anchored full-terrain forest. */
  let farForestRoot: THREE.Group | null = null
  /** Two static far-card layers containing every world forest placement. */
  let farForestLayers: { broadleaf: THREE.InstancedMesh; conifer: THREE.InstancedMesh } | null = null
  let farForestInstances = 0
  let farForestRadius = 0
  let worldForestBroadleafInstances = 0
  let worldForestConiferInstances = 0
  let worldForestScan: WorldForestScan | null = null
  let worldForestIndex: WorldForestPlacementIndex | null = null
  let worldForestRevision = 0
  let worldForestPlacements: TreePlacement[] = []
  let worldForestCorridor: TreePlacement[] = []
  let worldForestBuildMs = 0
  let worldForestBuildStartedAt = 0
  let demRoadbedTarget: DemRoadbedTarget | null = null
  let demRoadbedSideWidth = 0
  let demRoadbedCutProx = 0
  let demRoadbedMaxCutFill = 0
  let demRoadbedMaxOuterGap = 0
  let demRoadbedOcclusionCount = 0
  let demRoadbedAuditSamples = 0
  let demRoadbedTriangleCount = 0
  let nearCardLayers: { broadleaf: THREE.InstancedMesh; conifer: THREE.InstancedMesh } | null = null
  const nearCardCamera = new THREE.Vector2(Number.NaN, Number.NaN)
  const nearMeshCamera = new THREE.Vector2(Number.NaN, Number.NaN)
  let nearMeshForestRevision = -1
  /** 水线诊断（世界构建时按地形直方图统计一次，水位变化时刷新淹没比例）。 */
  let waterFloodStats: WaterFloodStats | null = null
  let cachedAutoWaterGrid: TerrainHeightGrid | null = null
  let cachedAutoWaterLevel = 0
  /** 官方墙体网格层（Drystone / Barrier / SeaWall）与最近一次放置结果。 */
  let wallLayer: WallLayerHandle | null = null
  let wallSegments: WallSegment[] = []
  let roadMarkings: RoadMarkingWeights[] | null = null
  /** 水面挂在场景根（世界空间水平面）；从宿主节点向上解析。 */
  let sceneRoot: THREE.Object3D | null = null
  let appliedViewDistanceScale = 1
  const treeBatches = new Map<string, BatchEntry>()
  const roadBatches = new Map<string, BatchEntry>()
  const cameraGrassBatches = new Map<string, BatchEntry>()
  const foliageMaterials = new Map<string, FoliageMaterialHandle>()
  const warnings = new Set<string>()
  let treeInstances = 0
  let grassInstances = 0
  let bushInstances = 0
  let lastStreamAt = Number.NEGATIVE_INFINITY
  let accumulatedTime = 0
  let elapsedMs = 0
  const lastStreamCamera = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN)
  let roadDebugLine: THREE.Line | null = null
  let chunkDebugLines: THREE.LineSegments | null = null
  let chunkDebugDirty = true
  let surfaceWarningEmitted = false
  let roadWarningEmitted = false
  let gridFailed = false
  /** 墙体/水面层签名（参数变化时只重建这两层）。 */
  let barrierSignature = ''
  let selfChecksDone = false
  let lastAuditSignature = ''
  let lastSelfCheckAt = Number.NEGATIVE_INFINITY
  let seasonChecksRun = false
  let currentTerrainSourceSignature = 'unresolved'
  let lastSourceCheckAt = Number.NEGATIVE_INFINITY

  // ---- 季节素材状态 ----
  let currentSeason: SeasonId = hooks.getSeasonState()?.season ?? 'spring'
  let appliedLightingKey = ''
  /** 最近一次下发的官方光照参数（新材质创建后需要补齐）。 */
  const appliedLighting = { radiance: 2, shadowFactor: 1, fresnel: 1 }
  let seasonAssets: Map<string, THREE.Texture> | null = null
  let seasonAssetsSeason: SeasonId | null = null
  let seasonLoadToken = 0
  let seasonLoadInFlight = false
  let seasonCoreAssetsReady = false
  let surfaceTexturesReady = false
  let lastLoadedTextureNeedsKey = ''
  let roadTexturesRequested = false
  let wallTexturesRequested = false
  let waterTextureRequested = false
  let effectiveForestCoverage = props.forest.coverage
  let effectiveForestDensity = props.forest.density
  let adaptiveProfile: ProceduralLandscapeAdaptiveProfile | null = null
  let adaptiveState: LandscapeAdaptiveCalibrationState = 'disabled'
  let adaptiveAttempts = 0
  let adaptiveMeasuredFps: number | null = null
  let adaptiveSettledAt = 0
  let adaptiveMeasureStartedAt = 0
  let adaptiveMeasureFrames = 0
  let adaptiveMeasureSeconds = 0
  let adaptiveSceneKey = ''

  const stats: ProceduralLandscapeRuntimeStats = {
    nodeId: hooks.nodeId,
    phase: 'idle',
    progress: 0,
    warnings: [],
    quality: resolveProceduralLandscapeQuality(props.quality, currentEnvironment),
    exclusionZoneCount: 0,
    exclusionSignature: '',
    treeInstances: 0,
    grassInstances: 0,
    bushInstances: 0,
    batchCount: 0,
    treeChunkCount: 0,
    roadChunkCount: 0,
    cameraGrassChunkCount: 0,
    gridCols: 0,
    gridRows: 0,
    gridCellSize: 0,
    averageEdgeLength: 0,
    memoryBytes: 0,
    roadLength: 0,
    roadNodeCount: 0,
    roadComplete: false,
    roadFailureReason: null,
    roadStrategy: null,
    roadPlannerMode: null,
    roadStyle: null,
    roadNaturalTargetLength: 0,
    roadNaturalLaps: 0,
    roadGuideExpandedStates: 0,
    roadMaxGuideDeviation: 0,
    roadUnreachableWaypointIndex: null,
    roadWaypointCount: 0,
    roadWaypointsPassed: 0,
    roadWaypointsSkipped: 0,
    roadSkippedWaypointIndices: [],
    roadWaypointsAttempted: 0,
    roadMaxWaypointError: 0,
    roadClosed: false,
    shortestExpandedStates: 0,
    roadOfficialReverts: 0,
    roadAntiTargetTriggers: 0,
    roadTurnOverflows: 0,
    roadTurnDegreesPerKm: 0,
    roadMaxStraightRunMeters: 0,
    roadAverageElevationPercentile: 0,
    roadMaxElevationPercentile: 0,
    roadMaxForwardGrade: 0,
    roadMaxCrossSlope: 0,
    roadLowlandCoverageFraction: 0,
    roadSteepReplacementSteps: 0,
    roadSmoothingFallback: false,
    roadSmoothingFallbackReason: null,
    roadDetourRadius: props.road.pathDeviation,
    roadMaxDetourDistance: 0,
    roadDetourRadiusExpanded: false,
    roadMinCenterlineClearance: 0,
    roadMinTurnRadius: 0,
    roadGeometryAutoRepaired: false,
    roadAutoRepairRoundedCorners: 0,
    roadMaxAutoRepairWaypointOffset: 0,
    roadEffectiveWaypointTolerance: props.road.waypointTolerance,
    season: currentSeason,
    seasonAssetsReady: false,
    nearTreeInstances: 0,
    nearCardInstances: 0,
    nearTreeReady: false,
    adaptive: {
      deviceTier: null,
      sceneAreaKm2: null,
      targetCoverage: null,
      targetDensity: null,
      effectiveCoverage: props.forest.coverage,
      effectiveDensity: props.forest.density,
      targetFps: null,
      targetTreeCount: null,
      measuredFps: null,
      calibrationState: 'disabled',
      calibrationAttempts: 0,
    },
    assetTextureCount: 0,
    assetResidentBytes: 0,
    assetDownloadedBytes: 0,
    assetVariant: assetStore.variant,
    barrierInstances: 0,
    wallSegmentCount: 0,
    farTreeInstances: 0,
    farForestRadius: 0,
    worldForestInstances: 0,
    worldForestBuildMs: 0,
    broadleafTreeInstances: 0,
    coniferTreeInstances: 0,
    coniferTreeFraction: 0,
    treeLineMidY: 0,
    treeLineTopY: 0,
    roadbedHalfWidth: 0,
    roadbedSideWidth: 0,
    roadbedCutProx: 0,
    roadbedMaxCutFill: 0,
    roadbedCrossSlopeMax: 0,
    roadbedOuterError: 0,
    roadbedMaxOuterGap: 0,
    roadbedOcclusionCount: 0,
    roadbedAuditSamples: 0,
    roadbedTriangleCount: 0,
    waterEnabled: false,
    waterLevel: 0,
    waterLevelMode: props.water.levelMode,
    waterDepthTextureBytes: 0,
    waterFloodedFraction: 0,
    viewDistanceScale: 1,
    demStatus: 'inactive',
    demSourceBytes: null,
    demSampleStep: 1,
    demBuildMs: 0,
    demError: null,
    demOrthoStatus: 'unavailable',
    demOrthoBytes: null,
    demOrthoWidth: 0,
    demOrthoHeight: 0,
    demOrthoCoverage: 0,
    demOrthoError: null,
    demTransformWarning: null,
    demMeshBytes: 0,
  }
  statsRegistry.set(hooks.nodeId, stats)

  function warn(message: string): void {
    if (warnings.has(message)) {
      return
    }
    warnings.add(message)
    stats.warnings = Array.from(warnings)
  }

  /** 撤回一条可自我解除的告警（例如水位调高后「水面被遮住」不再成立）。 */
  function unwarn(message: string): void {
    if (!warnings.delete(message)) {
      return
    }
    stats.warnings = Array.from(warnings)
  }

  function resolveQuality(): ResolvedProceduralLandscapeQuality {
    return resolveProceduralLandscapeQuality(props.quality, currentEnvironment)
  }

  function textureFor(refId: string): THREE.Texture | null {
    return seasonAssets?.get(refId) ?? null
  }

  function ensureRoots(): void {
    if (!hostObject) {
      return
    }
    if (!foliageRoot) {
      foliageRoot = new THREE.Group()
      foliageRoot.name = '__ProceduralLandscapeFoliage'
      tagArtifact(foliageRoot)
      hostObject.add(foliageRoot)
    }
    if (!debugRoot) {
      debugRoot = new THREE.Group()
      debugRoot.name = '__ProceduralLandscapeDebug'
      tagArtifact(debugRoot)
      hostObject.add(debugRoot)
    }
    if (!farForestRoot) {
      // 远景林（相机锚定环带）：与分块植被层分开挂，便于整环释放/重锚。
      farForestRoot = new THREE.Group()
      farForestRoot.name = '__ProceduralLandscapeFarForest'
      tagArtifact(farForestRoot)
      hostObject.add(farForestRoot)
    }
    if (!sceneRoot) {
      // 水面是世界空间水平面（宿主的旋转会让它倾斜），挂到场景根。
      let node: THREE.Object3D | null = hostObject
      while (node.parent) {
        node = node.parent
      }
      sceneRoot = node
    }
  }

  function tagArtifact(object: THREE.Object3D): void {
    object.userData[COMPONENT_ARTIFACT_KEY] = true
    object.userData[COMPONENT_ARTIFACT_NODE_ID_KEY] = hooks.nodeId
    object.userData[COMPONENT_ARTIFACT_COMPONENT_ID_KEY] = hooks.componentId
  }

  function releaseBatch(entry: BatchEntry, target: Map<string, BatchEntry>): void {
    for (const layer of entry.layers) {
      disposeFoliageLayerMesh(layer)
    }
    entry.group.removeFromParent()
    entry.group.clear()
    treeInstances -= entry.treeInstances
    grassInstances -= entry.grassInstances
    bushInstances -= entry.bushInstances
    target.delete(entry.key)
    chunkDebugDirty = true
  }

  function releaseAllBatches(): void {
    for (const entry of Array.from(treeBatches.values())) {
      releaseBatch(entry, treeBatches)
    }
    for (const entry of Array.from(roadBatches.values())) {
      releaseBatch(entry, roadBatches)
    }
    for (const entry of Array.from(cameraGrassBatches.values())) {
      releaseBatch(entry, cameraGrassBatches)
    }
    treeInstances = 0
    grassInstances = 0
    bushInstances = 0
  }

  function collectActiveTreePlacements(camera: THREE.Vector3, radius: number): TreePlacement[] {
    if (!worldForestIndex || radius <= 0) {
      return []
    }
    return worldForestIndex.queryCircle(camera.x, camera.z, radius + 32)
  }

  function buildNearRoadFallbackPlacements(
    existing: ReadonlyArray<TreePlacement>,
  ): TreePlacement[] {
    if (!grid || !densityField || !roadResult || roadResult.nodes.length < 2) {
      return []
    }
    const treeLine = slowroadsTreeLineBounds(grid.minY, grid.maxY)
    const waterLevel = resolveWaterLevel()
    // Fallback trees must clear the drivable surface and shoulder. They are
    // generated once from fixed road nodes, never from the moving camera.
    const clearance = roadHalfWidth(props) + props.road.shoulderWidth + props.forest.roadClearance
    const nodeSpacing = roadResult.length / Math.max(1, roadResult.nodes.length - 1)
    const nodeStride = Math.max(1, Math.round(NEAR_ROAD_FALLBACK_SAMPLE_METERS / nodeSpacing))
    const dedupeCellSize = NEAR_ROAD_FALLBACK_DEDUPE_CELL_METERS
    const occupied = new Set<string>()
    for (const placement of existing) {
      occupied.add(
        `${Math.round(placement.x / dedupeCellSize)},${Math.round(placement.z / dedupeCellSize)}`,
      )
    }
    const placements: TreePlacement[] = []
    let sampleOrdinal = 0
    for (let index = 0; index < roadResult.nodes.length; index += nodeStride) {
      const node = roadResult.nodes[index]!
      const dirX = Math.cos(node.heading)
      const dirZ = Math.sin(node.heading)
      const perpX = -dirZ
      const perpZ = dirX
      const bandCount = sampleOrdinal % 2 === 0 ? 2 : 1
      sampleOrdinal += 1
      for (const side of [1, -1] as const) {
        for (let band = 0; band < bandCount; band += 1) {
          const lateralJitter = hashUnit(props.seed ^ 0x44b7a2d3, index, side * 17 + band) * 2.5
          const alongJitter = (hashUnit(props.seed ^ 0x9e3779b9, index, side * 31 + band) - 0.5) * 2
          const lateral = clearance + 1.5 + band * 7 + lateralJitter
          const x = node.x + dirX * alongJitter + perpX * side * lateral
          const z = node.z + dirZ * alongJitter + perpZ * side * lateral
          if (!grid.contains(x, z)) {
            continue
          }
          if (roadProximity != null && roadProximity.distanceAt(x, z) < clearance) {
            continue
          }
          const cellX = Math.round(x / dedupeCellSize)
          const cellZ = Math.round(z / dedupeCellSize)
          let occupiedNearby = false
          for (let cellOffsetX = -1; cellOffsetX <= 1 && !occupiedNearby; cellOffsetX += 1) {
            for (let cellOffsetZ = -1; cellOffsetZ <= 1; cellOffsetZ += 1) {
              if (occupied.has(`${cellX + cellOffsetX},${cellZ + cellOffsetZ}`)) {
                occupiedNearby = true
                break
              }
            }
          }
          if (occupiedNearby) {
            continue
          }
          const y = visibleForestHeightAt(x, z)
          const normal = visibleForestNormalAt(x, z)
          const slope = normal ? 1 - clamp(normal.y, -1, 1) : 0
          if (y == null) {
            continue
          }
          if (y < waterLevel + 0.5) {
            continue
          }
          if (slope > Math.max(props.forest.maxSlope, 0.8)) {
            continue
          }
          if (slowroadsTreeLineFactor(y, treeLine) <= 0) {
            continue
          }
          const species = treeSpeciesField
            ? treeSpeciesField.sampleSpecies(x, z)
            : slowroadsTreeSpeciesAt(props.seed, x, z)
          const keyX = Math.round(x * 10)
          const keyZ = Math.round(z * 10)
          placements.push({
            x,
            z,
            y,
            rotation: hashUnit(props.seed ^ 0x85ebca6b, keyX, keyZ) * Math.PI * 2,
            scale: lerp(
              props.forest.minScale,
              props.forest.maxScale,
              hashUnit(props.seed ^ 0xc2b2ae35, keyX, keyZ),
            ),
            variant: hashUnit(props.seed ^ 0x27d4eb2f, keyX, keyZ),
            species,
            rank: 0,
          })
          occupied.add(`${cellX},${cellZ}`)
        }
      }
    }
    return filterExcludedTrees(placements)
  }

  function usesDemTerrain(): boolean {
    return Boolean(props.dem.assetId && props.dem.runtimeGridUrl)
  }

  function resolveDemSampleStep(): number {
    if (props.dem.sampleStep === 1 || props.dem.sampleStep === 2 || props.dem.sampleStep === 4) {
      return props.dem.sampleStep
    }
    // Large DEM grids are for authoring in the editor; preview and the
    // mini-program viewer use coarser runtime grids by default.
    if (currentEnvironment === 'preview') {
      return 2
    }
    if (currentEnvironment === 'viewer') {
      return 4
    }
    const quality = resolveQuality()
    return quality === 'low' ? 4 : quality === 'medium' ? 2 : 1
  }

  /** Keep vegetation off the DEM cut/fill roadbed, not just off the asphalt. */
  function resolveForestRoadClearance(): number {
    const base = props.forest.roadClearance
    return demRoadbedHalfWidth > 0 ? Math.max(base, demRoadbedHalfWidth) : base
  }

  function captureAppliedExclusionsIfNeeded(): void {
    if (landscapeWorldBuilt && !exclusionCapturePending) {
      return
    }
    appliedExclusionCircles = getLandscapeExclusionSnapshot()
    stats.exclusionZoneCount = appliedExclusionCircles.length
    stats.exclusionSignature = landscapeExclusionSignature(appliedExclusionCircles)
    exclusionCapturePending = false
  }

  function resolveRoadExclusionMargin(): number {
    return roadHalfWidth(props)
      + props.road.shoulderWidth
      + Math.max(2, props.road.flattenBand)
      + 0.5
  }

  function treeExclusionMargin(placement: TreePlacement): number {
    return Math.max(1.25, placement.scale * 0.35)
  }

  function grassExclusionMargin(placement: GrassPlacement): number {
    return Math.max(0.2, placement.scale * 0.5)
  }

  function bushExclusionMargin(placement: GrassPlacement): number {
    return Math.max(0.35, placement.scale * 0.9)
  }

  function filterExcludedTrees(placements: TreePlacement[]): TreePlacement[] {
    return filterLandscapeExclusionPlacements(
      placements,
      appliedExclusionCircles,
      treeExclusionMargin,
    )
  }

  function disposeDemMesh(): void {
    if (demMesh) {
      demMesh.removeFromParent()
      demMesh.geometry.dispose()
      const material = demMesh.material
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose())
      } else {
        material.dispose()
      }
      demMesh = null
    }
    demMeshBuilder = null
  }

  function disposeDemOrthoTexture(): void {
    demOrthoLoadToken += 1
    demOrthoLoadPromise = null
    demOrthoTexture?.dispose()
    demOrthoTexture = null
    demOrthoSourceKey = ''
    stats.demOrthoStatus = props.dem.runtimeOrthoUrl ? 'idle' : 'unavailable'
    stats.demOrthoBytes = props.dem.runtimeOrthoBytes ?? null
    stats.demOrthoWidth = 0
    stats.demOrthoHeight = 0
    stats.demOrthoCoverage = 0
    stats.demOrthoError = null
  }

  function syncDemOrthoTextureBinding(): void {
    if (!demMesh) {
      return
    }
    const shouldBind = Boolean(
      enabled
      && props.surface.enabled
      && resolveProceduralLandscapeBaseMapMode(props) !== 'replace'
      && demOrthoTexture,
    )
    const materials = Array.isArray(demMesh.material)
      ? demMesh.material
      : [demMesh.material]
    for (const material of materials) {
      const mapped = material as THREE.MeshLambertMaterial
      const nextMap = shouldBind ? demOrthoTexture : null
      if (mapped.map === nextMap) {
        continue
      }
      mapped.map = nextMap
      mapped.needsUpdate = true
    }
  }

  function ensureDemOrthoTexture(): void {
    if (!enabled || !shouldLoadProceduralLandscapeOrtho(props)) {
      syncDemOrthoTextureBinding()
      if (!props.dem.runtimeOrthoUrl) {
        stats.demOrthoStatus = 'unavailable'
      }
      return
    }
    const url = props.dem.runtimeOrthoUrl
    if (!url) {
      stats.demOrthoStatus = 'unavailable'
      syncDemOrthoTextureBinding()
      return
    }
    if (demOrthoTexture) {
      stats.demOrthoStatus = 'ready'
      syncDemOrthoTextureBinding()
      return
    }
    if (demOrthoLoadPromise && demOrthoSourceKey === url) {
      return
    }
    const token = ++demOrthoLoadToken
    const key = url
    demOrthoSourceKey = key
    stats.demOrthoStatus = 'loading'
    stats.demOrthoError = null
    demOrthoLoadPromise = loadTerrainDemRuntimeOrtho(url)
      .then((data) => {
        if (disposed || token !== demOrthoLoadToken || key !== props.dem.runtimeOrthoUrl) {
          return
        }
        const texture = createTerrainDemRuntimeOrthoTexture(
          data,
          `dem-ortho-${hooks.nodeId}`,
        )
        demOrthoTexture = texture
        stats.demOrthoStatus = 'ready'
        stats.demOrthoBytes = data.width * data.height * 4
        stats.demOrthoWidth = data.width
        stats.demOrthoHeight = data.height
        stats.demOrthoCoverage = terrainDemRuntimeOrthoCoverage(data)
        stats.demOrthoError = null
        syncDemOrthoTextureBinding()
      })
      .catch((error) => {
        if (disposed || token !== demOrthoLoadToken) {
          return
        }
        stats.demOrthoStatus = 'error'
        stats.demOrthoError = error instanceof Error ? error.message : String(error)
        warn(`dem-ortho-load-failed:${stats.demOrthoError}`)
      })
      .finally(() => {
        if (token === demOrthoLoadToken) {
          demOrthoLoadPromise = null
        }
      })
  }

  function disposeDemRoadbed(): void {
    if (demRoadbedCollisionMesh) {
      demRoadbedCollisionMesh.removeFromParent()
      demRoadbedCollisionMesh.geometry.dispose()
      const collisionMaterial = demRoadbedCollisionMesh.material
      if (Array.isArray(collisionMaterial)) {
        collisionMaterial.forEach((entry) => entry.dispose())
      } else {
        collisionMaterial.dispose()
      }
      demRoadbedCollisionMesh = null
    }
    if (!demRoadbedMesh) {
      demRoadbedHalfWidth = 0
      return
    }
    demRoadbedMesh.removeFromParent()
    demRoadbedMesh.geometry.dispose()
    const material = demRoadbedMesh.material
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose())
    } else {
      material.dispose()
    }
    demRoadbedMesh = null
    demRoadbedHalfWidth = 0
  }

  function disposeDemSource(): void {
    demLoadToken += 1
    demLoadPromise = null
    demGridData = null
    disposeDemOrthoTexture()
    disposeDemRoadbed()
    disposeDemMesh()
    demRoadbedSignature = ''
    demMeshRoadbedSignature = ''
    demMeshBuildRoadbedSignature = ''
    dirty.demMesh = false
    demWorldBuilt = false
    demSourceKey = ''
    demBuildMs = 0
    stats.demMeshBytes = 0
    stats.demStatus = usesDemTerrain() ? 'idle' : 'inactive'
    stats.demSourceBytes = null
    stats.demError = null
  }

  function startDemLoad(): void {
    if (!usesDemTerrain() || demLoadPromise) {
      return
    }
    const key = `${props.dem.assetId}|${props.dem.runtimeGridUrl}|${props.dem.runtimeOrthoUrl}|${resolveDemSampleStep()}`
    demSourceKey = key
    const token = ++demLoadToken
    stats.demStatus = 'loading'
    stats.demError = null
    stats.demSourceBytes = props.dem.runtimeGridBytes
    demLoadPromise = loadTerrainDemRuntimeGrid(props.dem.runtimeGridUrl!, (value) => {
      if (token === demLoadToken) {
        stats.progress = Math.max(stats.progress, value * 0.35)
      }
    })
      .then((data) => {
        if (token !== demLoadToken) {
          return
        }
        demGridData = data
        stats.demSourceBytes = data.heights.byteLength
        stats.demStatus = 'building'
        demBuildStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
        dirty.grid = true
      })
      .catch((error) => {
        if (token !== demLoadToken) {
          return
        }
        demLoadPromise = null
        stats.demStatus = 'error'
        stats.demError = error instanceof Error ? error.message : String(error)
        gridFailed = true
        dirty.grid = false
        warn(`dem-load-failed:${stats.demError}`)
      })
  }

  function stepDemBuild(): boolean {
    if (!hostObject) {
      return false
    }
    if (!demGridData) {
      startDemLoad()
      return false
    }
    if (!demWorldBuilt) {
      const hostWorld = new THREE.Vector3().setFromMatrixPosition(hostObject.matrixWorld)
      demGridSampleStep = resolveDemSampleStep()
      grid = createDemTerrainHeightGrid(
        demGridData,
        hostWorld.x,
        hostWorld.z,
        hostWorld.y,
        demGridSampleStep,
      )
      currentTerrainSourceSignature = `dem-raw:${demSourceKey}`
      gridFailed = false
      buildWorld()
      dirty.world = false
      dirty.instances = false
      demWorldBuilt = true
      return false
    }
    if (!demMeshBuilder) {
      const hostWorld = new THREE.Vector3().setFromMatrixPosition(hostObject.matrixWorld)
      demMeshBuildRoadbedSignature = demRoadbedSignature
      demMeshBuilder = createDemTerrainMeshBuilder(demGridData, demGridSampleStep, {
        roadbed: demRoadbedTarget,
        worldOffset: {
          x: hostWorld.x,
          y: hostWorld.y,
          z: hostWorld.z,
        },
      })
      demBuildStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
      stats.demStatus = 'building'
    }
    const ready = demMeshBuilder.step(8)
    demBuildMs = demMeshBuilder.done
      ? (typeof performance !== 'undefined' ? performance.now() : Date.now()) - demBuildStartedAt
      : 0
    stats.demBuildMs = demBuildMs
    stats.progress = 0.35 + demMeshBuilder.progress * 0.65
    if (!ready) {
      return false
    }
    const demGeometry = demMeshBuilder.geometry
    if (!demGeometry) {
      stats.demStatus = 'error'
      stats.demError = 'DEM terrain mesh generation failed'
      gridFailed = true
      dirty.demMesh = false
      return false
    }
    const completedRoadbedSignature = demMeshBuildRoadbedSignature
    disposeDemMesh()
    demMeshBuildRoadbedSignature = ''
    const positionBytes = demGeometry.getAttribute('position')?.array?.byteLength ?? 0
    const normalBytes = demGeometry.getAttribute('normal')?.array?.byteLength ?? 0
    const indexBytes = demGeometry.getIndex()?.array?.byteLength ?? 0
    stats.demMeshBytes = positionBytes + normalBytes + indexBytes
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff })
    const mesh = new THREE.Mesh(demGeometry, material)
    mesh.name = `slowroads-dem-terrain-${hooks.nodeId}`
    markProceduralLandscapeDemTerrain(mesh, {
      cellSize: Math.max(1, (demGridData?.cellSizeX ?? 1) * demGridSampleStep),
      sampleHeightAt: (worldX, worldZ) => (
        sampleVisibleDemSurfaceHeightAt(grid, demRoadbedTarget, worldX, worldZ)
      ),
    })
    hostObject.add(mesh)
    demMesh = mesh
    demMeshRoadbedSignature = completedRoadbedSignature
    currentTerrainSourceSignature = `dem:${demSourceKey}`
    stats.demStatus = 'ready'
    guideRouteSurfaceRevision += 1
    dirty.grid = false
    dirty.world = false
    dirty.demMesh = false
    installSurfaceInjection()
    syncDemOrthoTextureBinding()
    ensureDemOrthoTexture()
    return true
  }

  function disposeRoadCollisionMesh(): void {
    if (!roadCollisionMesh) {
      return
    }
    roadCollisionMesh.removeFromParent()
    roadCollisionMesh.geometry.dispose()
    const material = roadCollisionMesh.material
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose())
    } else {
      material.dispose()
    }
    roadCollisionMesh = null
  }

  function disposeSurfaceState(): void {
    surfacePatch?.restore()
    surfacePatch = null
    surfaceMeshes = []
    roadDebugLine?.geometry.dispose()
    if (roadDebugLine && debugRoot) {
      debugRoot.remove(roadDebugLine)
    }
    roadDebugLine = null
    chunkDebugLines?.geometry.dispose()
    if (chunkDebugLines && debugRoot) {
      debugRoot.remove(chunkDebugLines)
    }
    chunkDebugLines = null
  }

  function disposeWorldState(): void {
    releaseAllBatches()
    disposeWorldForest()
    disposeDemRoadbed()
    forestMaskTexture?.dispose()
    forestMaskTexture = null
    variationTexture?.dispose()
    variationTexture = null
    roadFieldTexture?.dispose()
    roadFieldTexture = createEmptyRoadFieldTexture()
    roadBand?.dispose()
    roadBand = null
    disposeRoadCollisionMesh()
    roadMarkings = null
    densityField = null
    treeSpeciesField = null
    variationField = null
    roadResult = null
    roadPlanFailureReason = null
    invalidRoadGeometryClearance = 0
    invalidRoadGeometryTurnRadius = 0
    roadFieldData = null
    roadEdgeHeights = null
    roadCenterHeights = null
    roadBandRows = null
    roadBandColumns = null
    roadSurfaceSampler = null
    roadProximity = null
    demRoadbedTarget = null
    demRoadbedSideWidth = 0
    demRoadbedCutProx = 0
    demRoadbedMaxCutFill = 0
    demRoadbedMaxOuterGap = 0
    demRoadbedOcclusionCount = 0
    demRoadbedAuditSamples = 0
    demRoadbedTriangleCount = 0
    stats.roadbedOuterError = 0
    roadBucketTable = []
  }

  function disposeWaterAndBarrier(): void {
    waterPlane?.dispose()
    waterPlane = null
    if (barrierLayer) {
      disposeFoliageLayerMesh(barrierLayer)
      barrierLayer = null
    }
    barrierInstances = 0
    wallLayer?.dispose()
    wallLayer = null
    wallSegments = []
  }

  /**
   * Effective water line. Auto mode targets the lowest ~3% of covered terrain;
   * manual mode keeps the original minY + levelOffset behavior.
   */
  function resolveWaterLevel(): number {
    if (!grid) {
      return 0
    }
    if (props.water.levelMode === 'auto') {
      if (cachedAutoWaterGrid !== grid) {
        cachedAutoWaterGrid = grid
        cachedAutoWaterLevel = resolveAutoWaterLevel(grid, { maxSamplesPerAxis: 256 })
      }
      return cachedAutoWaterLevel
    }
    return grid.minY + props.water.levelOffset
  }

  // ---- World-anchored full forest ----

  function visibleForestHeightAt(x: number, z: number): number | null {
    if (demRoadbedTarget && demRoadbedTarget.distanceAt(x, z) <= demRoadbedTarget.meshHalfWidth) {
      return demRoadbedTarget.heightAt(x, z) + 0.01
    }
    return grid?.sampleHeight(x, z) ?? null
  }

  function visibleForestNormalAt(x: number, z: number): { x: number; y: number; z: number } | null {
    if (!demRoadbedTarget || demRoadbedTarget.distanceAt(x, z) > demRoadbedTarget.meshHalfWidth) {
      const normal = grid?.sampleNormal(x, z)
      return normal ? { x: normal.x, y: normal.y, z: normal.z } : null
    }
    const step = Math.max(0.75, (grid?.cellSize ?? 30) * 0.05)
    const dx = (demRoadbedTarget.heightAt(x + step, z) - demRoadbedTarget.heightAt(x - step, z)) / (2 * step)
    const dz = (demRoadbedTarget.heightAt(x, z + step) - demRoadbedTarget.heightAt(x, z - step)) / (2 * step)
    const inverseLength = 1 / Math.hypot(dx, 1, dz)
    return { x: -dx * inverseLength, y: inverseLength, z: -dz * inverseLength }
  }

  function disposeNearCardLayers(): void {
    if (nearCardLayers) {
      disposeFoliageLayerMesh(nearCardLayers.broadleaf)
      disposeFoliageLayerMesh(nearCardLayers.conifer)
      nearCardLayers = null
    }
    nearCardCamera.set(Number.NaN, Number.NaN)
  }

  function disposeWorldForest(): void {
    if (farForestLayers) {
      disposeFoliageLayerMesh(farForestLayers.broadleaf)
      disposeFoliageLayerMesh(farForestLayers.conifer)
      farForestLayers = null
    }
    for (const entry of Array.from(treeBatches.values())) {
      releaseBatch(entry, treeBatches)
    }
    disposeNearCardLayers()
    farForestInstances = 0
    farForestRadius = 0
    worldForestScan = null
    worldForestIndex = null
    worldForestPlacements = []
    worldForestCorridor = []
    worldForestBuildMs = 0
    worldForestBroadleafInstances = 0
    worldForestConiferInstances = 0
    nearMeshCamera.set(Number.NaN, Number.NaN)
    nearMeshForestRevision = -1
  }

  /** 远景树材质：与分块远景 imposter 层共用同一 key（同材质/同雾/同换季通道）。 */
  function farForestMaterialSpec(species: 0 | 1): FoliageMaterialSpec {
    return {
      kind: 'tree',
      tier: 'all',
      species,
      singlePlane: true,
      staticBillboard: true,
      alphaTestOverride: species === 1 ? 0.12 : 0.15,
      tint: 0xffffff,
      farTintScale: 1,
      hasAlphaTexture: false,
      hasNormalTexture: true,
      card: null,
      lodFade: 'far-card',
      distanceAlpha: false,
      useDensityShadow: false,
      key: `tree:world:${species}`,
    }
  }

  function nearCardMaterialSpec(species: 0 | 1): FoliageMaterialSpec {
    return {
      kind: 'tree',
      tier: 'all',
      species,
      singlePlane: true,
      staticBillboard: true,
      tint: 0xffffff,
      farTintScale: 1,
      hasAlphaTexture: false,
      hasNormalTexture: true,
      card: 'near',
      lodFade: 'near-card',
      distanceAlpha: false,
      useDensityShadow: true,
      key: `tree:near-cards:${species}`,
    }
  }

  /**
   * Both near cards and world/far cards use the imposter atlas. The four-column
   * tree-card atlases contain detached canopies and fallen branches, which read
   * as floating vegetation and dark strips in the sky when mapped to one card.
   */
  function imposterSpriteForPlacement(
    placement: TreePlacement,
  ): FoliageSpriteInstance {
    const row = Math.min(3, Math.floor(Math.max(0, Math.min(0.9999, placement.variant)) * 4))
    const region = STATIC_IMPOSTER_REGIONS[row]!
    return {
      x: placement.x,
      y: placement.y,
      z: placement.z,
      rotation: placement.rotation,
      scale: placement.scale / TREE_UNIT_SIZE,
      region,
      cell: row,
      roadProx: 0,
    }
  }

  function buildWorldForestLayers(placements: ReadonlyArray<TreePlacement>): void {
    if (!farForestRoot) {
      return
    }
    if (farForestLayers) {
      disposeFoliageLayerMesh(farForestLayers.broadleaf)
      disposeFoliageLayerMesh(farForestLayers.conifer)
      farForestLayers = null
    }
    worldForestPlacements = placements.slice()
    worldForestIndex = createWorldForestPlacementIndex(worldForestPlacements)
    worldForestRevision += 1
    nearCardCamera.set(Number.NaN, Number.NaN)
    nearMeshCamera.set(Number.NaN, Number.NaN)
    const broadleaf: FoliageSpriteInstance[] = []
    const conifer: FoliageSpriteInstance[] = []
    for (const placement of worldForestPlacements) {
      ;(placement.species === 1 ? conifer : broadleaf).push(
        imposterSpriteForPlacement(placement),
      )
    }
    worldForestBroadleafInstances = broadleaf.length
    worldForestConiferInstances = conifer.length
    const handleConifer = getFoliageMaterialHandle(farForestMaterialSpec(1))
    const handleBroadleaf = getFoliageMaterialHandle(farForestMaterialSpec(0))
    farForestLayers = {
      broadleaf: createFoliageLayerMesh(
        broadleaf,
        handleBroadleaf.material,
        TREE_UNIT_SIZE,
        hostObject ? hostInverse : null,
        { singlePlane: true, staticBillboard: true },
      ),
      conifer: createFoliageLayerMesh(
        conifer,
        handleConifer.material,
        TREE_UNIT_SIZE,
        hostObject ? hostInverse : null,
        { singlePlane: true, staticBillboard: true },
      ),
    }
    farForestRoot.add(farForestLayers.broadleaf, farForestLayers.conifer)
    farForestInstances = worldForestPlacements.length
    farForestRadius = grid
      ? Math.max(grid.maxX - grid.minX, grid.maxZ - grid.minZ) * 0.5
      : 0
    worldForestBuildMs = worldForestBuildStartedAt > 0
      ? (typeof performance !== 'undefined' ? performance.now() : Date.now()) - worldForestBuildStartedAt
      : 0
    applyTreeLodBands()
  }

  function startWorldForest(): void {
    disposeWorldForest()
    if (!grid || !densityField) {
      return
    }
    const tier = PROCEDURAL_LANDSCAPE_QUALITY_TIERS[resolveQuality()]
    const roadClearance = roadHalfWidth(props) + props.road.shoulderWidth + resolveForestRoadClearance()
    const params = {
      seed: props.seed,
      cellSize: tier.worldForest.cellSize,
      maxTrees: tier.worldForest.budget,
      // slowroads-lab uses 0.6 for the DEM-wide forest. A stricter saved value
      // leaves the mountain slopes bare even though the full tree budget is
      // available, which reads as a sudden loss of forest coverage.
      maxSlope: usesDemTerrain()
        ? Math.max(props.forest.maxSlope, 0.6)
        : props.forest.maxSlope,
      roadClearance,
      waterLevel: resolveWaterLevel(),
      minHeight: props.forest.minHeight,
      minScale: props.forest.minScale,
      maxScale: props.forest.maxScale,
      densityMultiplier: tier.densityMultiplier * effectiveForestDensity,
    }
    const deps = {
      grid,
      density: densityField,
      roadField: roadProximity,
      heightAt: visibleForestHeightAt,
      speciesAt: treeSpeciesField
        ? (x: number, z: number) => treeSpeciesField!.sampleSpecies(x, z)
        : undefined,
    }
    worldForestCorridor = roadResult
      ? planWorldForestCorridor(params, deps, roadResult.nodes, {
          alongStep: 3,
          lateralStep: 8,
          nearBeltBands: 3,
        })
      : []
    worldForestScan = createWorldForestScan(params, deps)
    worldForestBuildStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  }

  function updateWorldForest(): void {
    if (!worldForestScan || !grid || !densityField) {
      return
    }
    const done = stepWorldForestScan(
      worldForestScan,
      {
        grid,
        density: densityField,
        roadField: roadProximity,
        heightAt: visibleForestHeightAt,
        speciesAt: treeSpeciesField
          ? (x: number, z: number) => treeSpeciesField!.sampleSpecies(x, z)
          : undefined,
      },
      25_000,
    )
    if (done) {
      let placements = worldForestCorridor.concat(worldForestScan.placements)
      placements.push(...buildNearRoadFallbackPlacements(placements))
      placements = filterExcludedTrees(placements)
      worldForestScan = null
      buildWorldForestLayers(placements)
    }
  }

  function updateNearTreeLayers(camera: THREE.Vector3): void {
    if (!worldForestIndex || !farForestRoot || !hostObject) {
      return
    }
    const bands = resolveTreeLodBands(
      props.forest.nearDistance ?? PROCEDURAL_LANDSCAPE_QUALITY_TIERS[resolveQuality()].treeNearDistance,
      resolveNearTreeRadius(),
    )
    if (
      nearCardLayers
      && Math.hypot(camera.x - nearCardCamera.x, camera.z - nearCardCamera.y)
        < NEAR_CARD_REFRESH_DISTANCE
    ) {
      return
    }
    const indexedNearCards = worldForestIndex.queryCircle(camera.x, camera.z, bands.cardFar + 32)
    const nearCards = indexedNearCards.sort((a, b) => (
      (a.x - camera.x) ** 2 + (a.z - camera.z) ** 2
      - ((b.x - camera.x) ** 2 + (b.z - camera.z) ** 2)
    ))
    const broadleaf: FoliageSpriteInstance[] = []
    const conifer: FoliageSpriteInstance[] = []
    for (const placement of nearCards) {
      ;(placement.species === 1 ? conifer : broadleaf).push(
        imposterSpriteForPlacement(placement),
      )
    }
    const handleConifer = getFoliageMaterialHandle(nearCardMaterialSpec(1))
    const handleBroadleaf = getFoliageMaterialHandle(nearCardMaterialSpec(0))
    applyCardDissolveRange(handleBroadleaf)
    applyCardDissolveRange(handleConifer)
    if (
      nearCardLayers
      && getFoliageLayerCapacity(nearCardLayers.broadleaf) >= broadleaf.length
      && getFoliageLayerCapacity(nearCardLayers.conifer) >= conifer.length
    ) {
      updateFoliageLayerMesh(
        nearCardLayers.broadleaf,
        broadleaf,
        TREE_UNIT_SIZE,
        hostInverse,
        { staticBillboard: true },
      )
      updateFoliageLayerMesh(
        nearCardLayers.conifer,
        conifer,
        TREE_UNIT_SIZE,
        hostInverse,
        { staticBillboard: true },
      )
    } else {
      disposeNearCardLayers()
      const broadleafCapacity = Math.ceil(broadleaf.length * 1.25) + 64
      const coniferCapacity = Math.ceil(conifer.length * 1.25) + 64
      nearCardLayers = {
        broadleaf: createFoliageLayerMesh(
          broadleaf,
          handleBroadleaf.material,
          TREE_UNIT_SIZE,
          hostInverse,
          { singlePlane: true, staticBillboard: true, capacity: broadleafCapacity },
        ),
        conifer: createFoliageLayerMesh(
          conifer,
          handleConifer.material,
          TREE_UNIT_SIZE,
          hostInverse,
          { singlePlane: true, staticBillboard: true, capacity: coniferCapacity },
        ),
      }
      farForestRoot.add(nearCardLayers.broadleaf, nearCardLayers.conifer)
    }
    nearCardCamera.set(camera.x, camera.z)
  }

  function resetAll(): void {
    disposeSurfaceState()
    disposeWorldState()
    disposeWaterAndBarrier()
    disposeWorldForest()
    disposeDemMesh()
    demRoadbedSignature = ''
    demMeshRoadbedSignature = ''
    demMeshBuildRoadbedSignature = ''
    dirty.demMesh = false
    gridBuilder = null
    grid = null
  }

  function updateHostSnapshot(): void {
    if (!hostObject) {
      return
    }
    hostObject.updateMatrixWorld(true)
    hostMatrixSnapshot = hostObject.matrixWorld.clone()
    hostObject.matrixWorld.decompose(new THREE.Vector3(), hostRotationSnapshot, hostScaleSnapshot)
    hostInverse.copy(hostObject.matrixWorld).invert()
  }

  const hostInverse = new THREE.Matrix4()

  /**
   * Classify host changes so a DEM node can be translated without rebuilding
   * its 1.8M-vertex mesh. Rotation and scale remain unsupported for DEM.
   */
  function resolveHostTransformChange(): 'none' | 'translation' | 'other' {
    if (!hostObject || !hostMatrixSnapshot) {
      return 'none'
    }
    hostObject.updateMatrixWorld(true)
    const matrix = hostObject.matrixWorld
    let changed = false
    for (let i = 0; i < 16; i += 1) {
      if (Math.abs(matrix.elements[i]! - hostMatrixSnapshot.elements[i]!) > 1e-6) {
        changed = true
        break
      }
    }
    if (!changed) {
      return 'none'
    }
    const position = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    matrix.decompose(position, rotation, scale)
    const rotationDot = Math.abs(
      rotation.x * hostRotationSnapshot.x
      + rotation.y * hostRotationSnapshot.y
      + rotation.z * hostRotationSnapshot.z
      + rotation.w * hostRotationSnapshot.w,
    )
    const rotationDelta = 2 * Math.acos(Math.min(1, rotationDot))
    const scaleDelta = Math.max(
      Math.abs(scale.x - hostScaleSnapshot.x),
      Math.abs(scale.y - hostScaleSnapshot.y),
      Math.abs(scale.z - hostScaleSnapshot.z),
    )
    return rotationDelta > 1e-5 || scaleDelta > 1e-5 ? 'other' : 'translation'
  }

  function applyHostTransformChange(kind: 'none' | 'translation' | 'other'): void {
    if (kind === 'none' || !hostObject) {
      return
    }
    updateHostSnapshot()
    guideRouteSurfaceRevision += 1
    if (
      kind === 'translation'
      && usesDemTerrain()
      && demGridData
      && stats.demStatus === 'ready'
    ) {
      // The DEM mesh is a child of the host and already moved with it. Refresh
      // only the world-space height grid so roads/vegetation follow the node.
      const world = new THREE.Vector3().setFromMatrixPosition(hostObject.matrixWorld)
      grid = createDemTerrainHeightGrid(demGridData, world.x, world.z, world.y, demGridSampleStep)
      dirty.world = true
      dirty.instances = true
      forceStream = true
      return
    }
    resetAll()
    dirty.grid = true
  }

  function collectSurfaceMeshes(): THREE.Mesh[] {
    return collectProceduralLandscapeSurfaceMeshes(hostObject)
  }

  function buildCenterlineLocalSnapshot(
    host: THREE.Object3D,
    nodes: ReadonlyArray<RoadTraceNode>,
    authoringSampleStep: number,
    authoringCellSize: number,
  ): ProceduralLandscapeGeneratedRouteCenterline | null {
    if (nodes.length < 2) {
      return null
    }
    host.updateMatrixWorld(true)
    const inverse = new THREE.Matrix4().copy(host.matrixWorld).invert()
    const point = new THREE.Vector3()
    const pointsXZ: number[] = []
    for (const node of nodes) {
      point.set(node.x, node.y, node.z).applyMatrix4(inverse)
      if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) {
        return null
      }
      pointsXZ.push(point.x, point.z)
    }
    return {
      pointsXZ,
      authoringSampleStep,
      authoringCellSize,
      exclusionSignature: landscapeExclusionSignature(appliedExclusionCircles),
    }
  }

  function planGeneratedRoad(
    activeGrid: TerrainHeightGrid,
    host: THREE.Object3D,
    route: ProceduralLandscapeGeneratedRouteProps,
    road: ProceduralLandscapeRoadProps,
  ): WaypointRoadPlanResult | null {
    if (!route.waypoints.length) {
      return null
    }
    host.updateMatrixWorld(true)
    const currentExclusionSignature = landscapeExclusionSignature(appliedExclusionCircles)
    const exclusionMargin = resolveRoadExclusionMargin()
    const cachedPointsXZ = route.centerline?.pointsXZ
    let cachedFallback: WaypointRoadPlanResult | null = null
    if (cachedPointsXZ?.length) {
      const centerlineWorld: RoadWaypoint[] = []
      const point = new THREE.Vector3()
      for (let index = 0; index + 1 < cachedPointsXZ.length; index += 2) {
        point
          .set(cachedPointsXZ[index]!, 0, cachedPointsXZ[index + 1]!)
          .applyMatrix4(host.matrixWorld)
        centerlineWorld.push({ x: point.x, z: point.z })
      }
      const cached = createCachedCenterlineRoadRoute(activeGrid, {
        centerline: centerlineWorld,
        termination: route.termination,
        feelDistance: road.feelDistance,
        feelAngleRad: degreesToRadians(road.feelAngleDeg),
        maxSlope: road.maxSlope,
        waypointCount: route.waypoints.length,
      })
      if (cached) {
        cachedFallback = cached
        const exclusionSignatureMatches = currentExclusionSignature
          === (route.centerline?.exclusionSignature ?? '')
        const crossesExclusion = polylineIntersectsExclusion(
          centerlineWorld,
          appliedExclusionCircles,
          exclusionMargin,
        )
        if (exclusionSignatureMatches && !crossesExclusion) {
          return cached
        }
      } else {
        warn('road-centerline-snapshot-unusable')
      }
    }
    const waypointsWorld = transformRoadWaypointsToWorld(host.matrixWorld, route.waypoints)
    if (!waypointsWorld.length) {
      return null
    }
    const traceMargin = Math.max(
      activeGrid.cellSize * 2,
      Math.max(0.5, road.width * 0.5) + road.shoulderWidth + 2,
    )
    const planned = planWaypointRoadRoute(activeGrid, {
      waypoints: waypointsWorld,
      strategy: route.strategy,
      termination: route.termination,
      style: route.style,
      seed: route.seed,
      waypointTolerance: route.waypointTolerance,
      pathDeviation: route.pathDeviation,
      stepLength: road.stepLength,
      feelDistance: road.feelDistance,
      feelAngleRad: degreesToRadians(road.feelAngleDeg),
      maxSlope: road.maxSlope,
      maxTurnRad: degreesToRadians(road.maxTurnDeg),
      margin: traceMargin,
      routeClearance: Math.max(
        7,
        road.width,
      ),
      minimumTurnRadius: 20,
      maximumHeadingChangeRad: (10 * Math.PI) / 180,
      exclusionCircles: appliedExclusionCircles,
      exclusionMargin,
    })
    if (planned?.complete) {
      return planned
    }
    if (cachedFallback?.complete) {
      warn('landscape-exclusion-road-unavoidable')
      return {
        ...cachedFallback,
        complete: false,
        failureReason: planned?.failureReason ?? 'blocked-by-exclusion-zone',
      }
    }
    return planned
  }

  function buildTerrainSourceSignature(
    mode: 'direct' | 'cached' | 'empty',
    assetId: string | null,
    sources: TerrainMeshSource[],
  ): string {
    const parts: string[] = []
    for (const source of sources) {
      const geometry = source.mesh.geometry
      const position = geometry.getAttribute('position')
      const index = geometry.getIndex()
      parts.push(`${geometry.uuid}:${position ? position.count : 0}:${index ? index.count : 0}`)
    }
    return `${mode}:${assetId ?? ''}:${sources.length}:${parts.join('|')}`
  }

  /**
   * 解析节点真正的几何网格。导入模型节点默认走共享 InstancedMesh 缓存，
   * 其运行时对象只带一个不可见的 pick proxy；proceduralLandscape 会强制普通
   * Object3D 路径（见 runtimeModelInstancing），这里的回退保证即使遇到 proxy
   * 也能用共享缓存模型 + 世界矩阵重建高度场。
   */
  function resolveTerrainMeshSources(host: THREE.Object3D): {
    sources: TerrainMeshSource[]
    signature: string
  } {
    const direct = collectTerrainMeshSources(host)
    if (direct.length) {
      return { sources: direct, signature: buildTerrainSourceSignature('direct', null, direct) }
    }
    const instancedAssetId = typeof host.userData?.instancedAssetId === 'string'
      ? host.userData.instancedAssetId.trim()
      : ''
    if (!instancedAssetId.length) {
      return { sources: [], signature: 'empty:' }
    }
    const cached = getCachedModelObject(instancedAssetId)
    if (!cached?.object) {
      return { sources: [], signature: `pending:${instancedAssetId}` }
    }
    cached.object.updateMatrixWorld(true)
    const rootInverse = new THREE.Matrix4().copy(cached.object.matrixWorld).invert()
    const relativeMatrix = new THREE.Matrix4()
    const worldMatrix = new THREE.Matrix4()
    const sources: TerrainMeshSource[] = []
    for (const source of collectTerrainMeshSources(cached.object)) {
      relativeMatrix.multiplyMatrices(rootInverse, source.matrix)
      worldMatrix.multiplyMatrices(host.matrixWorld, relativeMatrix)
      sources.push({ mesh: source.mesh, matrix: worldMatrix.clone() })
    }
    return { sources, signature: buildTerrainSourceSignature('cached', instancedAssetId, sources) }
  }

  function checkTerrainSourceChanges(): void {
    if (!hostObject) {
      return
    }
    if (usesDemTerrain()) {
      return
    }
    const { signature } = resolveTerrainMeshSources(hostObject)
    if (signature === currentTerrainSourceSignature) {
      return
    }
    const hadBuiltContent = Boolean(grid || gridBuilder || gridFailed)
    currentTerrainSourceSignature = signature
    if (hadBuiltContent) {
      resetAll()
      gridFailed = false
      updateHostSnapshot()
    }
    dirty.grid = true
  }

  function resetAdaptiveState(): void {
    adaptiveProfile = null
    adaptiveState = 'disabled'
    adaptiveAttempts = 0
    adaptiveMeasuredFps = null
    adaptiveSettledAt = 0
    adaptiveMeasureStartedAt = 0
    adaptiveMeasureFrames = 0
    adaptiveMeasureSeconds = 0
    adaptiveSceneKey = ''
    effectiveForestCoverage = props.forest.coverage
    effectiveForestDensity = props.forest.density
  }

  function buildWorld(): void {
    if (!grid) {
      return
    }
    captureAppliedExclusionsIfNeeded()
    // The previous roadbed is a surface mesh under the host; remove it before
    // resolving terrain triangles so it cannot be mistaken for raw DEM.
    disposeDemRoadbed()
    demRoadbedTarget = null
    demRoadbedSideWidth = 0
    demRoadbedCutProx = 0
    demRoadbedMaxCutFill = 0
    demRoadbedMaxOuterGap = 0
    demRoadbedOcclusionCount = 0
    demRoadbedAuditSamples = 0
    demRoadbedTriangleCount = 0
    stats.roadbedOuterError = 0
    const activeGrid = grid
    const bounds = { minX: grid.minX, minZ: grid.minZ, sizeX: grid.maxX - grid.minX, sizeZ: grid.maxZ - grid.minZ }
    const sceneAreaKm2 = Math.max(0.001, (bounds.sizeX * bounds.sizeZ) / 1_000_000)
    const adaptiveSceneSignature = jsonKey([
      props.seed,
      props.quality,
      props.forest.coverage,
      props.forest.density,
      bounds.sizeX,
      bounds.sizeZ,
      currentDeviceProfile,
    ])
    const nextAdaptiveProfile = resolveAdaptiveLandscapeProfile({
      device: currentDeviceProfile,
      sceneAreaKm2,
      environment: currentEnvironment,
      quality: props.quality,
    })
    if (adaptiveSceneSignature !== adaptiveSceneKey || (!nextAdaptiveProfile && adaptiveProfile)) {
      adaptiveSceneKey = adaptiveSceneSignature
      adaptiveProfile = nextAdaptiveProfile
      adaptiveAttempts = 0
      adaptiveMeasuredFps = null
      adaptiveSettledAt = 0
      adaptiveMeasureStartedAt = 0
      adaptiveMeasureFrames = 0
      adaptiveMeasureSeconds = 0
      if (nextAdaptiveProfile) {
        effectiveForestCoverage = nextAdaptiveProfile.targetCoverage
        effectiveForestDensity = nextAdaptiveProfile.targetDensity
        adaptiveState = 'waiting'
      } else {
        effectiveForestCoverage = props.forest.coverage
        effectiveForestDensity = props.forest.density
        adaptiveState = 'disabled'
      }
    }
    densityField = usesDemTerrain()
      ? buildDemForestDensityField({
          ...bounds,
          seed: props.seed,
          seedOffset: props.forest.seedOffset,
          scale: props.forest.scale,
          coverage: effectiveForestCoverage,
        })
      : buildForestDensityField({
          ...bounds,
          seed: props.seed,
          seedOffset: props.forest.seedOffset,
          scale: props.forest.scale,
          coverage: effectiveForestCoverage,
        })
    treeSpeciesField = buildTreeSpeciesField({
      ...bounds,
      seed: props.seed,
    })
    variationField = buildVariationField({ ...bounds, seed: props.seed, scale: props.forest.scale })
    forestMaskTexture?.dispose()
    forestMaskTexture = createDensityDataTexture(densityField)
    variationTexture?.dispose()
    variationTexture = createDensityDataTexture(variationField)

    roadFieldTexture?.dispose()
    roadFieldTexture = null
    roadResult = null
    roadPlanFailureReason = null
    invalidRoadGeometryClearance = 0
    invalidRoadGeometryTurnRadius = 0
    roadFieldData = null
    roadEdgeHeights = null
    roadCenterHeights = null
    roadBandRows = null
    roadBandColumns = null
    roadSurfaceSampler = null
    roadProximity = null
    roadBucketTable = []

    const generatedRoute = props.road.generatedRoute
    if (
      props.road.enabled
      && generatedRoute
      && hostObject
    ) {
      const plannedRoad = planGeneratedRoad(
        grid,
        hostObject,
        generatedRoute,
        props.road,
      )
      if (plannedRoad?.failureReason === 'road-geometry-self-overlap') {
        // Never render a self-overlapping centerline: its road band folds
        // back over itself and produces large overlapping triangle fans.
        roadPlanFailureReason = plannedRoad.failureReason
        invalidRoadGeometryClearance =
          plannedRoad.minCenterlineClearance ?? 0
        invalidRoadGeometryTurnRadius = plannedRoad.minTurnRadius ?? 0
        roadResult = null
      } else {
        roadResult = plannedRoad
      }
      guideRouteSurfaceRevision += 1
    }
    if (roadResult && roadResult.nodes.length > 1) {
        const halfWidth = roadHalfWidth(props)
        // 贴合地形：高度场（数十公里地形上格距 22m）对折坡/山脊是低通近似，
        // 与可见三角面能差出米级——路面必须采样**真实渲染面**（三角面精确
        // 定位 + 重心插值），否则会被地形压住或悬空。走廊很小，索引代价可忽略。
        const maxLateralDrop = halfWidth * Math.max(1, props.road.maxSlope)
        const meshSources = hostObject ? resolveTerrainMeshSources(hostObject).sources : []
        const corridorMargin = halfWidth + 16
        roadSurfaceSampler = meshSources.length
          ? buildTerrainSurfaceSampler(
              meshSources,
              resolveRoadCorridorBounds(roadResult.nodes, corridorMargin),
            )
          : null
        const sampledSurfaceHeightAt = (x: number, z: number): number | null => (
          roadSurfaceSampler?.heightAt(x, z) ?? activeGrid.sampleHeight(x, z)
        )
        roadEdgeHeights = computeRoadEdgeHeights(
          roadResult.nodes,
          sampledSurfaceHeightAt,
          halfWidth,
          maxLateralDrop,
        )
        roadCenterHeights = roadResult.nodes.map((node) => (
          sampleRoadRowColumns(node, sampledSurfaceHeightAt, halfWidth, 1, maxLateralDrop)[0]!
        ))
        roadBandRows = densifyRoadRows(roadResult.nodes, ROAD_BAND_ROW_SPACING)
        // DEM roads use one design height per row (no lateral bank). The
        // roadbed below provides the cut/fill transition to the raw terrain.
        roadBandColumns = roadBandRows.map((row) => (
          usesDemTerrain()
            ? new Array<number>(ROAD_BAND_COLUMN_COUNT).fill(row.y)
            : sampleRoadRowColumns(row, sampledSurfaceHeightAt, halfWidth, ROAD_BAND_COLUMN_COUNT, maxLateralDrop)
        ))
        const demRoadbedSpan = usesDemTerrain()
          ? roadHalfWidth(props) + props.road.shoulderWidth
            + Math.max(30, activeGrid.cellSize * 1.5)
            + activeGrid.cellSize * 0.5 + 8
          : 0
        const influence = Math.max(
          48,
          props.road.flattenBand + 8,
          roadHalfWidth(props) + props.road.shoulderWidth + props.grass.corridorWidth + 8,
          demRoadbedSpan,
        )
        roadFieldData = buildRoadFieldData(roadResult.nodes, {
          minX: grid.minX,
          minZ: grid.minZ,
          sizeX: bounds.sizeX,
          sizeZ: bounds.sizeZ,
          minY: grid.minY,
          maxY: grid.maxY,
          maxInfluence: influence,
          maxResolution: ROAD_FIELD_RESOLUTION,
          edgeHeights: roadEdgeHeights,
          halfWidth,
          centerHeights: roadCenterHeights,
        })
        if (roadFieldData) {
          roadFieldTexture = createRoadFieldTexture(roadFieldData)
          roadBucketTable = buildRoadBucketTable(roadResult.nodes, ROAD_BUCKET_LENGTH)
        }
        // 放置过滤改走精确距离索引：光栅场只在数十公里地形上格边长 40m+，
        // 植被净空（默认 ~10m）完全被量化误差淹没（见 roadProximity.ts）。
        roadProximity = buildRoadProximityIndex(roadResult.nodes, { maxDistance: influence })
        if (roadProximity && !verifyRoadProximityIndex(roadProximity, roadResult.nodes)) {
          warn('road-proximity-index-mismatch')
        } else {
          unwarn('road-proximity-index-mismatch')
        }
        if (usesDemTerrain() && hostObject && roadBandRows && roadProximity) {
          demRoadbedTarget = createDemRoadbedTarget({
            roadField: roadProximity,
            rawHeightAt: sampledSurfaceHeightAt,
            halfWidth,
            shoulderWidth: props.road.shoulderWidth,
            demCellSize: activeGrid.cellSize,
            // A 45m swept side slope self-overlaps on the editor's tight
            // hairpins and produces large faceted aprons. Keep the cut/fill
            // transition local to the road and let the untouched DEM resume
            // beyond it.
            sideWidth: Math.max(15, activeGrid.cellSize * 0.8),
            coverageWidth: Math.max(4, activeGrid.cellSize * 0.35),
            // The 30m coarse triangles interpolate across the roadbed design
            // surface; a 2m safety drop keeps them below the 3m-sampled
            // high-resolution roadbed on steep, curved sections.
            coarseClearance: 2,
          })
          demRoadbedSideWidth = demRoadbedTarget.sideWidth
          demRoadbedHalfWidth = demRoadbedTarget.meshHalfWidth
          const roadbedWorldOffset = new THREE.Vector3().setFromMatrixPosition(hostObject.matrixWorld)
          const coarseSurfaceHeightAt = demGridData
            ? createDemCoarseSurfaceHeightAt(demGridData, demGridSampleStep, {
                roadbed: demRoadbedTarget,
                worldOffset: {
                  x: roadbedWorldOffset.x,
                  y: roadbedWorldOffset.y,
                  z: roadbedWorldOffset.z,
                },
              })
            : null
          // Keep the shader cut limited to the actual asphalt + shoulder.
          // A 60m distance-field cut is a circular tube, while the high-res
          // roadbed is a swept ribbon; on hairpins the two disagree and leave
          // terrain holes. Coarse side-slope triangles are already graded
          // below the high-res roadbed, so they must not be cut by distance.
          demRoadbedCutProx = Math.max(0, props.road.shoulderWidth + 0.25)
          const roadbed = createDemRoadbedTargetGeometry(roadBandRows, demRoadbedTarget, {
            lateralStep: 3,
            lift: 0.01,
            asphaltOverlap: 0.5,
            coarseSurfaceHeightAt,
            burialDepth: 0.3,
            edgeSkirtDepth: 0.5,
            hostInverse,
          })
          if (roadbed) {
            const mesh = new THREE.Mesh(
              roadbed.geometry,
              new THREE.MeshLambertMaterial({
                color: 0xffffff,
                side: THREE.DoubleSide,
              }),
            )
            mesh.name = `slowroads-dem-roadbed-${hooks.nodeId}`
            mesh.userData.proceduralLandscapeDemRoadbed = true
            markProceduralLandscapeRoadbedSurface(mesh)
            hostObject.add(mesh)
            demRoadbedMesh = mesh
            const collisionRoadbed = createDemRoadbedTargetGeometry(roadBandRows, demRoadbedTarget, {
              lateralStep: 8,
              rowSpacing: 8,
              lift: 0.01,
              asphaltOverlap: 0.5,
              coarseSurfaceHeightAt,
              burialDepth: 0.3,
              edgeSkirtDepth: 0.5,
              hostInverse,
            })
            if (collisionRoadbed) {
              const collisionMaterial = new THREE.MeshBasicMaterial()
              collisionMaterial.visible = false
              const collisionMesh = new THREE.Mesh(collisionRoadbed.geometry, collisionMaterial)
              collisionMesh.name = `slowroads-dem-roadbed-collision-${hooks.nodeId}`
              markProceduralLandscapeRoadCollision(collisionMesh)
              tagArtifact(collisionMesh)
              hostObject.add(collisionMesh)
              demRoadbedCollisionMesh = collisionMesh
            }
            demRoadbedMaxCutFill = roadbed.maxCutFill
            demRoadbedMaxOuterGap = roadbed.maxOuterGap
            demRoadbedTriangleCount = roadbed.triangleCount
            stats.roadbedOuterError = roadbed.outerError
            const auditStride = Math.max(1, Math.floor(roadBandRows.length / 4096))
            for (let rowIndex = 0; rowIndex < roadBandRows.length; rowIndex += auditStride) {
              const row = roadBandRows[rowIndex]!
              const normalX = -Math.sin(row.heading)
              const normalZ = Math.cos(row.heading)
              for (let sample = 0; sample < 17; sample += 1) {
                const lateral = -demRoadbedTarget.meshHalfWidth
                  + (sample / 16) * demRoadbedTarget.meshHalfWidth * 2
                const x = row.x + normalX * lateral
                const z = row.z + normalZ * lateral
                const targetY = demRoadbedTarget.heightAt(x, z)
                const coarseY = coarseSurfaceHeightAt?.(x, z)
                  ?? demRoadbedTarget.coarseHeightAt(x, z)
                const rawY = demRoadbedTarget.rawHeightAt(x, z)
                demRoadbedMaxCutFill = Math.max(demRoadbedMaxCutFill, Math.abs(targetY - rawY))
                demRoadbedAuditSamples += 1
                const cut = demRoadbedTarget.distanceAt(x, z) < demRoadbedCutProx
                if (!cut && coarseY > targetY + 1e-3) {
                  demRoadbedOcclusionCount += 1
                }
              }
            }
          }
        }
    }
    demRoadbedSignature = resolveDemRoadbedSignature(props, {
      cellSize: activeGrid.cellSize,
      sampleStep: demGridSampleStep,
      target: demRoadbedTarget,
      routeNodeCount: roadResult?.nodes.length ?? 0,
      routeLength: roadResult?.length ?? 0,
    })
    if (demMeshBuilder && demMeshBuildRoadbedSignature !== demRoadbedSignature) {
      // A newer roadbed was committed while the previous mesh was still being
      // generated. Restart from the new target; keep any completed mesh visible.
      demMeshBuilder = null
      demMeshBuildRoadbedSignature = ''
    }
    if (demMesh && demMeshRoadbedSignature !== demRoadbedSignature) {
      dirty.demMesh = true
    }
    if (roadResult && (roadResult.nodes.length <= 1 || !roadFieldData)) {
      if (!roadWarningEmitted) {
        roadWarningEmitted = true
        warn(`road-trace-failed:${roadResult.failureReason ?? 'unknown'}`)
      }
    } else if (roadResult && !roadResult.complete && roadResult.failureReason) {
      warn(`road-route-${roadResult.failureReason}`)
    }
    if (roadResult && roadResult.nodes.length >= 2) {
      if (!roadTexturesRequested) {
        roadTexturesRequested = true
        void loadSeasonAssets(currentSeason, { force: true })
      }
    } else if (roadTexturesRequested) {
      roadTexturesRequested = false
      seasonAssetsSeason = null
      void loadSeasonAssets(currentSeason, { force: true })
    }
    if (!roadFieldTexture) {
      roadFieldTexture = createEmptyRoadFieldTexture()
    }

    buildRoadBand()
    guideRouteSurfaceRevision += 1
    applySceneViewDistanceScale()
    applyStaticSurfaceUniforms()
    barrierSignature = resolveBarrierSignature()
    buildWalls()
    buildWater()
    releaseAllBatches()
    startWorldForest()
    // Every world rebuild (startup, adaptive calibration, road edits, host
    // translation) replaces the DEM roadbed with a fresh white material. Keep
    // the re-injection here so no caller can forget it and expose that mesh.
    installSurfaceInjection()
    dirty.instances = true
    forceStream = true
    landscapeWorldBuilt = true
  }

  /**
   * 雾/视距尺度自适应（迁移端）：官方雾尺度按 1000m 世界调参，编辑器地形可达
   * 数十公里；`surface.viewDistanceScale` 留空时按地形水平尺寸给出倍率，
   * 环境运行时据此重推场景组 / 天空组（2 × 视距）/ 云层。
   */
  function applySceneViewDistanceScale(): void {
    if (!grid) {
      return
    }
    const horizontalSize = Math.max(grid.maxX - grid.minX, grid.maxZ - grid.minZ)
    appliedViewDistanceScale = resolveSurfaceViewDistanceScale(props, horizontalSize)
    setSlowroadsSceneViewDistanceScale(appliedViewDistanceScale)
  }

  /** 墙体/水面层签名：这些参数变化时只需重建这两层（墙体放置依赖道路形状与水位）。 */
  function resolveBarrierSignature(): string {
    return jsonKey([
      props.walls,
      props.water,
      props.road.enabled,
      props.road.width,
      props.road.shoulderWidth,
      props.road.flattenBand,
      props.road.flattenStrength,
      props.seed,
    ])
  }

  /**
   * 启动自检（世界构建 + 材质编译完成后跑一次）：
   *  - 季节目录（贴图槽位/色彩空间/别名一致性/alphaTest 表/树卡变色幅度语义）；
   *  - 景观材质 uniform 覆盖审计（着色器声明的 uniform 必须在 JS 表里）；
   *  - 树卡变色着色器源码断言（因子只出现在顶点噪声公式一次、片元消费 varying）。
   * 失败写入面板 warnings。
   */
  function runLandscapeSelfChecks(): void {
    if (selfChecksDone) {
      return
    }
    if (elapsedMs - lastSelfCheckAt < 1000) {
      return
    }
    const audits = collectSlowroadsShaderAudits(sceneRoot ?? hostObject)
    if (!audits.length) {
      // 材质还没编译（onBeforeCompile 未触发）：下一帧再试。
      return
    }
    // 材质是随渲染逐步编译的：签名不变时才算「收敛」，跑完停用；签名变化时重跑审计
    // （面板 warnings 会在每次失败时补齐）。
    const signature = audits.map((audit) => audit.name).sort().join('|')
    if (signature === lastAuditSignature && audits.length > 1) {
      selfChecksDone = true
    } else {
      lastAuditSignature = signature
    }
    lastSelfCheckAt = elapsedMs
    const seasonResults = seasonChecksRun ? [] : runSlowroadsSeasonChecks()
    if (!seasonChecksRun) {
      seasonChecksRun = true
    }
    const uniformResults = runMaterialUniformCoverageChecks(
      audits.map((audit) => ({
        name: audit.name,
        vertexShader: audit.vertexShader,
        fragmentShader: audit.fragmentShader,
        uniformKeys: audit.uniformKeys,
      })),
    )
    const treeResults = runTreeDiscolourationShaderChecks(
      audits.map((audit) => ({
        name: audit.name,
        vertexShader: audit.vertexShader,
        fragmentShader: audit.fragmentShader,
      })),
    )
    for (const result of [...seasonResults, ...uniformResults, ...treeResults]) {
      if (!result.ok) {
        warn(`self-check:${result.name}`)
      }
    }
  }

  /** 沿路里程采样器（官方 `nodeSpacing` 网格用）。 */
  function createRoadAlongSampler(
    nodes: ReadonlyArray<RoadTraceNode>,
  ): (along: number) => { x: number; z: number; y: number; heading: number } {
    const cumulative = new Float64Array(nodes.length)
    for (let i = 1; i < nodes.length; i += 1) {
      const previous = nodes[i - 1]!
      const current = nodes[i]!
      cumulative[i] = cumulative[i - 1]! + Math.hypot(current.x - previous.x, current.z - previous.z)
    }
    const total = cumulative[nodes.length - 1] ?? 0
    return (along: number) => {
      const clamped = Math.max(0, Math.min(total, along))
      let low = 0
      let high = nodes.length - 1
      while (low < high - 1) {
        const mid = (low + high) >> 1
        if (cumulative[mid]! <= clamped) {
          low = mid
        } else {
          high = mid
        }
      }
      const from = nodes[low]!
      const to = nodes[Math.min(nodes.length - 1, low + 1)]!
      const span = Math.max(1e-6, cumulative[Math.min(nodes.length - 1, low + 1)]! - cumulative[low]!)
      const t = (clamped - cumulative[low]!) / span
      return {
        x: from.x + (to.x - from.x) * t,
        z: from.z + (to.z - from.z) * t,
        y: from.y + (to.y - from.y) * t,
        heading: from.heading,
      }
    }
  }

  /**
   * 官方路侧墙体层（Drystone / Barrier / Fence / SeaWall）：
   *  - 放置由 `computeWallSegments` 按官方判定与段长规则给出；
   *  - 木栏沿用植被精灵层（BARRIER_RAIL_REGIONS），其余三类走 `createWallLayers` 网格；
   *  - 与 lab 的差异只在取样入口：这里地形来自导入网格，压平后的可见地表按
   *    地表顶点着色器的同一公式（`plWeight = 1 - smoothstep(inner, outer, distance)`，
   *    `delta = (roadHeight - terrainY) * weight * strength`）在 JS 侧复算。
   */
  function buildWalls(): void {
    if (barrierLayer) {
      disposeFoliageLayerMesh(barrierLayer)
      barrierLayer = null
    }
    barrierInstances = 0
    wallLayer?.dispose()
    wallLayer = null
    wallSegments = []
    if (
      !grid
      || !roadResult
      || roadResult.nodes.length < 2
      || !foliageRoot
      || !hostObject
    ) {
      return
    }
    const waterLevel = resolveWaterLevel()
    const sampleRoad = createRoadAlongSampler(roadResult.nodes)
    const wallProbe = {
      length: roadResult.length,
      halfWidth: roadHalfWidth(props),
      waterLevel,
      terrainHeightAt: (x: number, z: number): number => visibleForestHeightAt(x, z) ?? waterLevel,
      surfaceHeightAt: (x: number, z: number): number => visibleForestHeightAt(x, z) ?? waterLevel,
      sampleRoad,
      shadowAt: (x: number, z: number): number => {
        if (!densityField) {
          return 0
        }
        return forestDensityClassAt(densityField, x, z) / 3
      },
    }
    wallSegments = clipWallSegmentsToExclusions(
      computeWallSegments(wallProbe, roadResult.nodes, {
        seed: props.seed,
        roadWidth: roadHalfWidth(props) * 2,
        density: props.walls.drystone.density,
        detail: 3,
        style: ROAD_STYLE_PROFILES[DEFAULT_ROAD_STYLE],
      }),
      appliedExclusionCircles,
      0.75,
    )
    stats.wallSegmentCount = wallSegments.length
    if (!wallSegments.length) {
      if (wallTexturesRequested) {
        wallTexturesRequested = false
        seasonAssetsSeason = null
        void loadSeasonAssets(currentSeason, { force: true })
      }
      return
    }
    if (!wallTexturesRequested) {
      wallTexturesRequested = true
      void loadSeasonAssets(currentSeason, { force: true })
    }

    // ---- 木栏（官方 Fence）：沿用植被精灵层的双横栏区域 ----
    if (props.walls.fence.enabled) {
      const fenceSamples = wallFenceSpriteSamples(wallSegments)
      if (fenceSamples.length) {
        const spec: FoliageMaterialSpec = {
          kind: 'barrier',
          tier: 'all',
          species: 0,
          singlePlane: true,
          tint: 0xffffff,
          farTintScale: 1,
          hasAlphaTexture: false,
          hasNormalTexture: false,
          card: null,
          lodFade: null,
          staticBillboard: false,
          distanceAlpha: false,
          useDensityShadow: false,
          key: 'barrier:all',
        }
        const handle = getFoliageMaterialHandle(spec)
        const instances: FoliageSpriteInstance[] = fenceSamples.map((sample) => ({
          x: sample.x,
          y: sample.y,
          z: sample.z,
          rotation: sample.rotation,
          scale: 1,
          region: BARRIER_RAIL_REGIONS[sample.variant] ?? BARRIER_RAIL_REGIONS[0] ?? null,
          cell: sample.variant,
          roadProx: 0,
        }))
        const mesh = createFoliageLayerMesh(
          instances,
          handle.material,
          BARRIER_UNIT_SIZE,
          hostInverse,
          { billboard: false },
        )
        tagArtifact(mesh)
        foliageRoot.add(mesh)
        barrierLayer = mesh
        barrierInstances = instances.length
      }
    }

    // ---- 石墙 / 硬护栏 / 海墙：网格层 ----
    const entry = SEASON_CATALOG[seasonAssetsSeason ?? currentSeason]
    const placeholder = getSharedPlaceholderTexture()
    wallLayer = createWallLayers({
      segments: wallSegments,
      textures: {
        drystone: textureFor(entry.walls.drystone.id) ?? placeholder,
        barrier: textureFor(entry.walls.barrier.id) ?? placeholder,
        seaWall: textureFor(entry.walls.seaWall.id) ?? placeholder,
      },
      shadowFactor: SEASON_PARAMS[seasonAssetsSeason ?? currentSeason].shadowFactor,
      radiance: appliedLighting.radiance,
      hostInverse,
    })
    wallLayer.setVisibility({
      drystone: props.walls.drystone.enabled,
      barrier: props.walls.barrier.enabled,
      seaWall: props.walls.seaWall.enabled,
    })
    for (const child of wallLayer.group.children) {
      tagArtifact(child)
    }
    hostObject.add(wallLayer.group)
  }

  /**
   * Slow Roads water surface: a world-space horizontal plane whose effective
   * water line comes from either the auto lowland quantile or manual offset.
   * The DEM depth texture gives the shader the same shoreline/depth response as
   * the source scene without duplicating every terrain vertex.
   */
  function buildWater(): void {
    if (!grid || !props.water.enabled || !sceneRoot) {
      waterPlane?.dispose()
      waterPlane = null
      waterFloodStats = null
      unwarn('water-buried-by-terrain')
      return
    }
    // 水线诊断与季节素材无关：先算淹没比例（面板提示用），再决定能否建面。
    refreshWaterFloodStats()
    const waves = textureFor(SHARED_TEXTURES.seaWaves.id)
    if (!waves) {
      if (
        props.water.enabled
        && waterFloodStats
        && waterFloodStats.floodedFraction >= WATER_FLOOD_VISIBLE_FRACTION
        && !waterTextureRequested
      ) {
        waterTextureRequested = true
        void loadSeasonAssets(currentSeason, { force: true })
      }
      return
    }
    waterTextureRequested = false
    const size = Math.max(1, Math.max(grid.maxX - grid.minX, grid.maxZ - grid.minZ) * 1.5)
    const centerX = (grid.minX + grid.maxX) * 0.5
    const centerZ = (grid.minZ + grid.maxZ) * 0.5
    const waterLevel = resolveWaterLevel()
    if (waterPlane && Math.abs(waterPlane.worldSize - size) <= 1e-3) {
      waterPlane.setWavesTexture(waves)
      waterPlane.setTerrainGrid(grid)
      waterPlane.setWaterLevel(waterLevel)
      waterPlane.setExclusionCircles(appliedExclusionCircles)
      waterPlane.mesh.position.x = centerX
      waterPlane.mesh.position.z = centerZ
      waterPlane.setVisible(true)
      return
    }
    waterPlane?.dispose()
    waterPlane = createWaterPlane({
      worldSize: size,
      centerX,
      centerZ,
      waterLevel,
      waves,
      terrainGrid: grid,
      exclusionCircles: appliedExclusionCircles,
    })
    waterPlane.mesh.position.x = centerX
    waterPlane.mesh.position.z = centerZ
    tagArtifact(waterPlane.mesh)
    sceneRoot.add(waterPlane.mesh)
    waterPlane.setVisible(true)
  }

  /** Diagnose a manually selected water line that remains buried by terrain. */
  function refreshWaterFloodStats(): void {
    if (!grid) {
      waterFloodStats = null
      return
    }
    waterFloodStats = computeWaterFloodStats(grid, resolveWaterLevel())
    if (
      props.water.enabled
      && props.water.levelMode === 'manual'
      && waterFloodStats.floodedFraction < WATER_FLOOD_VISIBLE_FRACTION
    ) {
      warn('water-buried-by-terrain')
    } else {
      // 调高水线偏移（或关掉水面）后这条告警不再成立，别留在面板里误导。
      unwarn('water-buried-by-terrain')
    }
  }

  function buildRoadBand(): void {
    roadBand?.dispose()
    roadBand = null
    disposeRoadCollisionMesh()
    if (!roadResult || roadResult.nodes.length < 2 || !hostObject) {
      return
    }
    const season = seasonAssets ? seasonAssetsSeason ?? currentSeason : currentSeason
    // 建带子时就把季节贴图集写进去（createRoadBand 内部会立即套用划线/拉伸），
    // 不要等换季的 applySeasonToMaterials —— 重建后不套用会让划线消失。
    const textures = roadBandTexturesFor(season)
    const halfWidth = roadHalfWidth(props)
    const singleTrack = isSingleTrackRoad(halfWidth * 2)
    // 官方划线权重（宽路才启用）：树影取路缘森林密度，海拔门限以水位为零点。
    roadMarkings = singleTrack
      ? null
      : computeRoadMarkings(roadResult.nodes, {
          style: ROAD_STYLE_PROFILES[DEFAULT_ROAD_STYLE],
          nodeSpacing: props.road.stepLength,
          shadowAt: (x: number, z: number) => (
            densityField ? forestDensityClassAt(densityField, x, z) / 3 : 0
          ),
          edgeOffset: halfWidth,
          waterLevel: resolveWaterLevel(),
        })
    // 带子按加密行铺设（2m 一档），划线权重按来源节点映射到行。
    const bandRows = roadBandRows ?? roadResult.nodes
    const collisionRows = roadBandRows
      ?? bandRows.map((row, sourceIndex) => ({ ...row, sourceIndex }))
    const markingsForRows = roadMarkings && roadMarkings.length ? roadMarkings : null
    const bandMarkings = markingsForRows
      ? (roadBandRows
          ? roadBandRows.map((row) => markingsForRows[Math.min(markingsForRows.length - 1, row.sourceIndex)]!)
          : markingsForRows)
      : null
    roadBand = createRoadBand({
      nodes: bandRows,
      halfWidth,
      stepLength: 2,
      density: densityField,
      textures,
      season,
      markings: bandMarkings,
      nodeSpacing: props.road.stepLength,
      hostInverse: hostObject ? hostInverse : null,
      // 贴合地形：每列取真实三角面高度，抬升只需固定小常量防止 z-fighting。
      lift: ROAD_BAND_LIFT,
      columnHeights: roadBandColumns,
    })
    roadBand.setVisible(props.road.enabled)
    roadBand.setRadiance(appliedLighting.radiance)
    // 重建会复用 createRoadBand 的初始 fresnel，环境光照值要一起补上。
    roadBand.setFresnel(appliedLighting.fresnel)
    tagArtifact(roadBand.mesh)
    hostObject.add(roadBand.mesh)
    const collisionGeometry = createRoadCollisionGeometry({
      rows: collisionRows,
      columnHeights: roadBandColumns,
      halfWidth,
      rowSpacing: ROAD_COLLISION_ROW_SPACING,
      columnCount: usesDemTerrain()
        ? ROAD_COLLISION_COLUMN_COUNT_DEM
        : ROAD_COLLISION_COLUMN_COUNT_GENERIC,
      lift: ROAD_BAND_LIFT,
      hostInverse,
    })
    if (collisionGeometry) {
      const collisionMaterial = new THREE.MeshBasicMaterial()
      collisionMaterial.visible = false
      const collisionMesh = new THREE.Mesh(collisionGeometry.geometry, collisionMaterial)
      collisionMesh.name = `slowroads-road-collision-${hooks.nodeId}`
      collisionMesh.visible = props.road.enabled
      markProceduralLandscapeRoadCollision(collisionMesh)
      tagArtifact(collisionMesh)
      hostObject.add(collisionMesh)
      roadCollisionMesh = collisionMesh
    }
  }

  /** 当前季节 + 路宽对应的官方路面贴图集（单车道 `roadSingle` / 宽路 `road` + 划线）。 */
  function roadBandTexturesFor(season: SeasonId): RoadBandTextures {
    const entry = SEASON_CATALOG[season]
    const roadFallback = getSharedRoadFallbackTexture()
    if (isSingleTrackRoad(roadHalfWidth(props) * 2)) {
      return {
        base: textureFor(entry.road.single.base.id) ?? roadFallback,
        overlay: entry.road.single.overlay
          ? textureFor(entry.road.single.overlay.id) ?? roadFallback
          : null,
        paint: null,
        textureStretch: entry.road.single.stretch ?? 2,
      }
    }
    const paint = entry.road.wide.paint
    return {
      base: textureFor(entry.road.wide.base.id) ?? roadFallback,
      overlay: entry.road.wide.overlay
        ? textureFor(entry.road.wide.overlay.id) ?? roadFallback
        : null,
      paint: paint
        ? {
            dashed: textureFor(paint.dashed.id) ?? roadFallback,
            solid: textureFor(paint.solid.id) ?? roadFallback,
            solidLeft: textureFor(paint.solidLeft.id) ?? roadFallback,
            solidRight: textureFor(paint.solidRight.id) ?? roadFallback,
            mergeLeft: textureFor(paint.mergeLeft.id) ?? roadFallback,
            mergeRight: textureFor(paint.mergeRight.id) ?? roadFallback,
          }
        : null,
      textureStretch: entry.road.wide.stretch ?? 1,
    }
  }

  function applyStaticSurfaceUniforms(): void {
    if (!grid) {
      return
    }
    uniforms.uPlTerrainMin.value.set(grid.minX, grid.minZ)
    uniforms.uPlTerrainSize.value.set(
      Math.max(0.001, grid.maxX - grid.minX),
      Math.max(0.001, grid.maxZ - grid.minZ),
    )
    uniforms.uPlHeightMin.value = grid.minY
    uniforms.uPlHeightRange.value = Math.max(0.001, grid.maxY - grid.minY)
    const treeLine = slowroadsTreeLineBounds(grid.minY, grid.maxY)
    uniforms.uPlTreeLineMidY.value = treeLine.midY
    uniforms.uPlTreeLineTopY.value = treeLine.topY
    stats.treeLineMidY = treeLine.midY
    stats.treeLineTopY = treeLine.topY
    // 地表高度带归一化：lab 世界起伏 ±40m 时恒为 4（逐字一致）；编辑器真实地形
    // 按实测起伏压缩到 [0.25, 4]，避免 heather / light grass 高度项整片饱和。
    uniforms.uPlHeightScale.value = resolveSurfaceHeightScale(grid.maxY - grid.minY)
    uniforms.uPlRoadField.value = roadFieldTexture
    uniforms.uPlForestMask.value = forestMaskTexture
    uniforms.uPlRoadFieldRange.value = roadFieldData ? roadFieldData.range : 64
    uniforms.uPlRoadHalfWidth.value = roadHalfWidth(props)
    uniforms.uPlRoadShoulderWidth.value = props.road.shoulderWidth
    applySeasonUniformsToSurface()
  }

  function applySeasonUniformsToSurface(): void {
    const entry = SEASON_CATALOG[seasonAssetsSeason ?? currentSeason]
    const params = SEASON_PARAMS[seasonAssetsSeason ?? currentSeason]
    const placeholder = getSharedPlaceholderTexture()
    uniforms.uPlShowTextures.value = props.surface.textures && surfaceTexturesReady ? 1 : 0
    uniforms.uPlSeasonIndex.value = params.index
    uniforms.uPlGrassColA.value.set(params.grassColA)
    uniforms.uPlGrassColB.value.set(params.grassColB)
    uniforms.uPlPeakColA.value.set(params.peakColA)
    uniforms.uPlPeakColB.value.set(params.peakColB)
    uniforms.uPlRoadCol.value.set(params.roadCol)
    uniforms.uPlNoiseTex.value = textureFor(SHARED_TEXTURES.noise.id) ?? placeholder
    uniforms.uPlGrassTex.value = textureFor(entry.surface.grass.id) ?? placeholder
    uniforms.uPlForestTex.value = textureFor(entry.surface.forest.id) ?? placeholder
    uniforms.uPlHeatherTex.value = textureFor(entry.surface.heather.id) ?? placeholder
    uniforms.uPlGravelTex.value = textureFor(entry.surface.gravel.id) ?? placeholder
    uniforms.uPlRockTex.value = textureFor(entry.surface.rock.id) ?? placeholder
    uniforms.uPlSandTex.value = textureFor(entry.surface.sand.id) ?? placeholder
    uniforms.uPlDetailNearTex.value = textureFor(entry.surface.detailNear.id) ?? placeholder
    uniforms.uPlDetailFarTex.value = textureFor(entry.surface.detailFar.id) ?? placeholder
    uniforms.uPlRockBumpTex.value = textureFor(SHARED_TEXTURES.rockBump.id) ?? placeholder
    uniforms.uPlGrassVariation.value = textureFor(SHARED_TEXTURES.grassVariation.id) ?? placeholder
  }

  function applyDynamicSurfaceUniforms(): void {
    const flatten = roadFlattenParams(props)
    // The shoreline shader must follow the same effective line as the water mesh.
    uniforms.uPlWaterLevel.value = resolveWaterLevel()
    uniforms.uPlFlattenInner.value = flatten.innerRadius
    uniforms.uPlFlattenOuter.value = flatten.outerRadius
    uniforms.uPlFlattenStrength.value = flatten.strength
    uniforms.uPlSurfaceStrength.value = props.surface.enabled ? props.surface.blendStrength : 0
    uniforms.uPlBaseMapBlend.value = resolveProceduralLandscapeBaseMapBlend(props)
    ensureDemOrthoTexture()
    uniforms.uPlUvScale.value = props.surface.uvScale
    uniforms.uPlGrassTint.value.set(props.surface.grassTint)
    uniforms.uPlForestTint.value.set(props.surface.forestTint)
    uniforms.uPlRoadTint.value.set(props.surface.roadTint)
    uniforms.uPlGravelTint.value.set(props.surface.gravelTint)
    uniforms.uPlRockSlope.value = props.surface.rockSlopeThreshold
    uniforms.uPlShowCanopy.value = props.canopy.enabled ? 1 : 0
    // Keep the palette path until the seasonal set is complete; otherwise the
    // transparent placeholder would render the terrain black while loading.
    uniforms.uPlShowTextures.value = props.surface.textures && surfaceTexturesReady ? 1 : 0
    uniforms.uPlFresnelIntensity.value = appliedLighting.fresnel
    applyTreeLodBands()
    if (waterPlane) {
      waterPlane.setWaterLevel(resolveWaterLevel())
      waterPlane.setVisible(props.water.enabled)
    }
    if (barrierLayer) {
      barrierLayer.visible = props.walls.fence.enabled
    }
    roadBand?.setVisible(props.road.enabled)
    if (roadCollisionMesh) {
      roadCollisionMesh.visible = props.road.enabled
    }
    for (const handle of foliageMaterials.values()) {
      const factor = handle.spec.kind === 'barrier'
        ? PROCEDURAL_LANDSCAPE_WIND_FACTOR.barrier
        : handle.spec.kind === 'grass'
          ? PROCEDURAL_LANDSCAPE_WIND_FACTOR.grass
          : handle.spec.kind === 'bush'
            ? PROCEDURAL_LANDSCAPE_WIND_FACTOR.bush
            : PROCEDURAL_LANDSCAPE_WIND_FACTOR.tree
      handle.uniforms.uPlWindStrength.value = props.wind.enabled ? factor * props.wind.strength : 0
    }
  }

  function resolveNearTreeRadius(): number {
    // Keep a short 3D layer even on the low tier so nearby trees keep their
    // modeled detail without paying medium/high's full-terrain forest budget.
    // Weak devices still get a smaller radius and the low world-forest cap.
    if (resolveQuality() === 'low') {
      return Math.min(props.forest.nearTreeRadius, 60)
    }
    return props.forest.nearTreeRadius
  }

  function foliageMaterialKey(spec: FoliageMaterialSpec): string {
    return spec.key
  }

  function getFoliageMaterialHandle(spec: FoliageMaterialSpec): FoliageMaterialHandle {
    const key = foliageMaterialKey(spec)
    const existing = foliageMaterials.get(key)
    if (existing) {
      return existing
    }
    const handle = createFoliageMaterial(spec, foliageUniforms, {
      season: seasonAssetsSeason ?? currentSeason,
      discolouration: SEASON_PARAMS[seasonAssetsSeason ?? currentSeason].treeDiscolouration,
      hasSnow: SEASON_PARAMS[seasonAssetsSeason ?? currentSeason].hasSnow,
    })
    applyFoliageSeasonToHandle(handle)
    setFoliageMaterialLighting(handle, appliedLighting)
    foliageMaterials.set(key, handle)
    return handle
  }

  function applyFoliageSeasonToHandle(handle: FoliageMaterialHandle): void {
    const season = seasonAssetsSeason ?? currentSeason
    const params = SEASON_PARAMS[season]
    applyFoliageMaterialSeason(handle, {
      season,
      discolouration: params.treeDiscolouration,
      hasSnow: params.hasSnow,
    })
    const store = seasonAssets
    const entry = SEASON_CATALOG[season]
    const placeholder = getSharedPlaceholderTexture()
    const pick = (id: string): THREE.Texture => store?.get(id) ?? placeholder
    // 树密度图（per-instance 树影 + 变色噪声）与官方树卡噪声（noise_fine）。
    const densityMap = forestMaskTexture
    const densityMin = grid ? new THREE.Vector2(grid.minX, grid.minZ) : null
    const densitySize = grid
      ? new THREE.Vector2(Math.max(0.001, grid.maxX - grid.minX), Math.max(0.001, grid.maxZ - grid.minZ))
      : null
    const cardNoise = pick(SHARED_TEXTURES.noise.id)
    switch (handle.spec.kind) {
      case 'grass':
        setFoliageMaterialTextures(handle, {
          atlas: pick(entry.sprites.grassSprites.id),
          noise: pick(SHARED_TEXTURES.noise.id),
          grassVariation: pick(SHARED_TEXTURES.grassVariation.id),
          detailFar: pick(entry.surface.detailFar.id),
          cardNoise,
          densityMap,
          densityMin,
          densitySize,
        })
        break
      case 'bush':
        setFoliageMaterialTextures(handle, {
          atlas: pick(entry.sprites.bushes.id),
          noise: pick(SHARED_TEXTURES.bushNoise.id),
          grassVariation: pick(SHARED_TEXTURES.grassVariation.id),
          detailFar: pick(entry.surface.detailFar.id),
          cardNoise,
          densityMap,
          densityMin,
          densitySize,
        })
        break
      case 'barrier':
        // 木栏贴图来自当前季节的 `walls.fence` 槽（官方 spring_wall_barrier_wood）。
        setFoliageMaterialTextures(handle, {
          atlas: pick(SEASON_CATALOG[seasonAssetsSeason ?? currentSeason].walls.fence.id),
          noise: pick(SHARED_TEXTURES.noise.id),
          grassVariation: pick(SHARED_TEXTURES.grassVariation.id),
          detailFar: pick(entry.surface.detailFar.id),
          cardNoise,
          densityMap: null,
          densityMin,
          densitySize,
        })
        break
      case 'tree':
        // All procedural-landscape tree cards use the clean imposter atlas.
        // The tree-card atlas columns contain detached canopies and fallen
        // branches, which appear as floating trees/dark strips when mapped to
        // one quad.
        setFoliageMaterialTextures(handle, {
          atlas: pick(handle.spec.species === 0
            ? entry.imposters.mapA.id
            : entry.imposters.mapB.id),
          normal: pick(handle.spec.species === 0
            ? entry.imposters.normA.id
            : entry.imposters.normB.id),
          noise: pick(SHARED_TEXTURES.noise.id),
          grassVariation: pick(SHARED_TEXTURES.grassVariation.id),
          detailFar: pick(entry.surface.detailFar.id),
          cardNoise,
          densityMap: handle.spec.tier === 'near' ? densityMap : null,
          densityMin,
          densitySize,
        })
        break
    }
  }

  function markInstancesDirty(): void {
    if (dirty.instances) {
      return
    }
    dirty.instances = true
    forceStream = true
  }

  function findRegionIndex(regions: ReadonlyArray<SpriteRegion | null>, variant: number): number {
    if (!regions.length) {
      return 0
    }
    return Math.min(regions.length - 1, Math.floor(Math.max(0, Math.min(0.9999, variant)) * regions.length))
  }

  /**
   * 近树卡 / 远景树的 dissolve 区间（lab main.ts：lod1Horizon = 近树卡距离/10，
   * 近树卡 dissolveFar = max(40, nearDistance)、区间 = 30%；imposter 略早登场）。
   */
  function applyCardDissolveRange(handle: FoliageMaterialHandle): void {
    const tier = PROCEDURAL_LANDSCAPE_QUALITY_TIERS[resolveQuality()]
    const nearDistance = props.forest.nearDistance ?? tier.treeNearDistance
    const bands = resolveTreeLodBands(nearDistance, resolveNearTreeRadius())
    setFoliageMaterialCardRange(handle, {
      near: bands.cardNear,
      far: bands.cardFar,
      interval: Math.max(1, bands.cardFar - bands.cardNear),
    })
  }

  function applyTreeLodBands(): void {
    const tier = PROCEDURAL_LANDSCAPE_QUALITY_TIERS[resolveQuality()]
    const bands = resolveTreeLodBands(
      props.forest.nearDistance ?? tier.treeNearDistance,
      resolveNearTreeRadius(),
    )
    // updateTreeMeshes() enables this only when the 3D layer is ready and has
    // instances, so near cards never disappear into an empty mesh layer.
    foliageUniforms.meshRadius.value = 0
    foliageUniforms.nearDistance.value = props.forest.nearDistance ?? tier.treeNearDistance
    for (const handle of foliageMaterials.values()) {
      if (handle.spec.kind === 'tree') {
        applyCardDissolveRange(handle)
      }
    }
    treeMeshManager?.setLodBand(bands.meshNear, bands.meshFar)
  }

  function addTreeLayer(
    batch: BatchEntry,
    placements: TreePlacement[],
    tier: 'near' | 'far',
    species: 0 | 1,
  ): number {
    if (!placements.length) {
      return 0
    }
    const spec: FoliageMaterialSpec = {
      kind: 'tree',
      tier,
      species,
      singlePlane: true,
      staticBillboard: true,
      tint: 0xffffff,
      farTintScale: 1,
      hasAlphaTexture: false,
      hasNormalTexture: true,
      // 近树卡 = 动态 alpha + 距离 dissolve（由 forest.nearDistance 推出）；
      // 远景树 = 静态朝相机树卡。不能走 imposter 的近距离 dissolve，否则
      // 全图森林会在近树卡距离之外整片被裁掉。
      card: tier === 'near' ? 'near' : null,
      lodFade: tier === 'near' ? 'near-card' : 'far-card',
      distanceAlpha: false,
      // 近树卡用密度树影近似官方 per-instance shadow；远景树不采样密度图。
      useDensityShadow: tier === 'near',
      key: `tree:${tier}:${species}`,
    }
    const handle = getFoliageMaterialHandle(spec)
    applyCardDissolveRange(handle)
    const regions = STATIC_IMPOSTER_REGIONS
    const instances: FoliageSpriteInstance[] = placements.map((placement) => {
      const regionIndex = findRegionIndex(regions, placement.variant)
      const region = regions[regionIndex] ?? null
      return {
        x: placement.x,
        y: placement.y,
        z: placement.z,
        rotation: placement.rotation,
        // TreePlacement.scale 是米：换算成 8m 基准倍率交给卡层（与近树网格层同一契约）。
        scale: placement.scale / TREE_UNIT_SIZE,
        region,
        cell: regionIndex,
        roadProx: 0,
      }
    })
    const mesh = createFoliageLayerMesh(
      instances,
      handle.material,
      TREE_UNIT_SIZE,
      hostObject ? hostInverse : null,
      { singlePlane: true, staticBillboard: true },
    )
    tagArtifact(mesh)
    batch.group.add(mesh)
    batch.layers.push(mesh)
    return instances.length
  }

  function addSpriteLayer(
    batch: BatchEntry,
    placements: ReadonlyArray<GrassPlacement>,
    kind: 'grass' | 'bush',
  ): number {
    if (!placements.length) {
      return 0
    }
    const season = seasonAssetsSeason ?? currentSeason
    const spec: FoliageMaterialSpec = {
      kind,
      tier: 'all',
      species: 0,
      singlePlane: false,
      tint: 0xffffff,
      farTintScale: 1,
      hasAlphaTexture: false,
      hasNormalTexture: false,
      card: null,
      lodFade: null,
      staticBillboard: false,
      distanceAlpha: kind === 'bush',
      useDensityShadow: true,
      key: `${kind}:all`,
    }
    const handle = getFoliageMaterialHandle(spec)
    const entries = kind === 'grass' ? grassVariantEntries(season) : bushVariantEntries(season)
    // 草丛/灌木的 placement.scale 是 slowroads-lab 语义的摆放倍率（不是米）：
    // 世界尺寸 = 基准尺寸（草 1.6m / 灌木 2m，见下方 unit）× 倍率 × 区域相对高度。
    const instances: FoliageSpriteInstance[] = placements.map((placement) => {
      const picked = pickCellEntry(entries, placement.variant)
      // 官方 per-instance groundNormal：草丛/灌木受光与掠射 fresnel 都由它驱动。
      const normal = visibleForestNormalAt(placement.x, placement.z)
      return {
        x: placement.x,
        y: placement.y,
        z: placement.z,
        rotation: placement.rotation,
        scale: placement.scale,
        region: picked?.region ?? null,
        cell: picked?.cell ?? 0,
        // 官方 roadProx = 距路缘距离 - halfWidth：草丛调色板贴近道路时的明度抑制。
        roadProx: placement.roadProx ?? 0,
        groundNormal: normal ? { x: normal.x, y: normal.y, z: normal.z } : null,
      }
    })
    const unit = kind === 'grass' ? GRASS_UNIT_SIZE : BUSH_UNIT_SIZE
    const mesh = createFoliageLayerMesh(instances, handle.material, unit, hostObject ? hostInverse : null)
    tagArtifact(mesh)
    batch.group.add(mesh)
    batch.layers.push(mesh)
    return instances.length
  }

  function createBatch(key: string): BatchEntry {
    const group = new THREE.Group()
    group.name = `__ProceduralLandscapeBatch_${key}`
    tagArtifact(group)
    return {
      key,
      group,
      layers: [],
      centerX: 0,
      centerZ: 0,
      treeInstances: 0,
      grassInstances: 0,
      bushInstances: 0,
      treePlacements: [],
    }
  }

  function buildTreeChunk(chunkX: number, chunkZ: number, camera: THREE.Vector3): void {
    if (!grid || !densityField || !foliageRoot) {
      return
    }
    const tier = PROCEDURAL_LANDSCAPE_QUALITY_TIERS[resolveQuality()]
    const chunkKey = `t:${chunkX}:${chunkZ}`
    if (treeInstances >= tier.maxTreeInstances) {
      warn('tree-instance-budget-reached')
      // 预算已满：把该分块记为已完成，避免流式永久重试同一个分块。
      const empty = createBatch(chunkKey)
      empty.centerX = (chunkX + 0.5) * tier.treeChunkSize
      empty.centerZ = (chunkZ + 0.5) * tier.treeChunkSize
      treeBatches.set(chunkKey, empty)
      return
    }
    const chunkSize = tier.treeChunkSize
    const placements = planTreeChunk(
      {
        seed: props.seed,
        chunkX,
        chunkZ,
        chunkSize,
        densityMultiplier: effectiveForestDensity,
        maxSlope: props.forest.maxSlope,
        roadClearance: resolveForestRoadClearance(),
        roadHalfWidth: roadHalfWidth(props),
        roadShoulderWidth: props.road.shoulderWidth,
        minScale: props.forest.minScale,
        maxScale: props.forest.maxScale,
        minHeight: props.forest.minHeight,
      },
      {
        grid,
        density: densityField,
        roadField: roadProximity,
        surfaceHeightAt: visibleForestHeightAt,
        surfaceNormalAt: visibleForestNormalAt,
      },
    )
    const kept = filterExcludedTrees(
      takeDensityPrefix(placements, tier.densityMultiplier),
    )
    const key = chunkKey
    if (!kept.length) {
      // 记录空分块：否则每帧都会把邻近的空块当成待建任务重复规划，
      // 一直吃掉流式预算，草/灌木层永远得不到构建机会。
      const empty = createBatch(key)
      empty.centerX = (chunkX + 0.5) * chunkSize
      empty.centerZ = (chunkZ + 0.5) * chunkSize
      treeBatches.set(key, empty)
      return
    }
    const nearDistance = props.forest.nearDistance ?? tier.treeNearDistance
    const nearPlacements: TreePlacement[] = []
    const farPlacements: TreePlacement[] = []
    for (const placement of kept) {
      const distance = Math.hypot(placement.x - camera.x, placement.z - camera.z)
      if (distance <= nearDistance) {
        nearPlacements.push(placement)
      } else {
        farPlacements.push(placement)
      }
    }
    const batch = createBatch(key)
    let added = 0
    added += addTreeLayer(batch, nearPlacements.filter((tree) => tree.species === 0), 'near', 0)
    added += addTreeLayer(batch, nearPlacements.filter((tree) => tree.species === 1), 'near', 1)
    added += addTreeLayer(batch, farPlacements.filter((tree) => tree.species === 0), 'far', 0)
    added += addTreeLayer(batch, farPlacements.filter((tree) => tree.species === 1), 'far', 1)
    if (added <= 0) {
      return
    }
    batch.centerX = (chunkX + 0.5) * chunkSize
    batch.centerZ = (chunkZ + 0.5) * chunkSize
    batch.treeInstances = added
    batch.treePlacements = kept
    foliageRoot.add(batch.group)
    treeBatches.set(key, batch)
    treeInstances += added
    chunkDebugDirty = true
  }

  function buildRoadBucket(entry: RoadBucketEntry): void {
    if (!grid || !densityField || !foliageRoot) {
      return
    }
    const grassEnabled = props.grass.enabled
    const bushesEnabled = props.bushes.enabled && props.bushes.density > 0
    if (!grassEnabled && !bushesEnabled) {
      return
    }
    const tier = PROCEDURAL_LANDSCAPE_QUALITY_TIERS[resolveQuality()]
    const result = planRoadBucket(
      {
        seed: props.seed,
        bucketIndex: entry.index,
        fromX: entry.fromX,
        fromZ: entry.fromZ,
        toX: entry.toX,
        toZ: entry.toZ,
        halfWidth: roadHalfWidth(props),
        shoulderWidth: props.road.shoulderWidth,
        corridorWidth: props.grass.corridorWidth,
        grassDensity: grassEnabled ? props.grass.density : 0,
        sinkNearRoad: props.grass.sinkNearRoad,
        bushesEnabled,
        bushesDensity: props.bushes.density,
        waterLevel: resolveWaterLevel(),
        flowerDensity: props.grass.flowerDensity,
        tallGrassDensity: props.grass.tallGrassDensity,
      },
      {
        grid,
        density: densityField,
        roadField: roadProximity,
        surfaceHeightAt: visibleForestHeightAt,
        surfaceNormalAt: visibleForestNormalAt,
      },
    )
    const grass = grassEnabled
      ? filterLandscapeExclusionPlacements(
          takeDensityPrefix(result.grass, tier.densityMultiplier),
          appliedExclusionCircles,
          grassExclusionMargin,
        )
      : []
    const bushes = bushesEnabled
      ? filterLandscapeExclusionPlacements(
          takeDensityPrefix(result.bushes, tier.densityMultiplier),
          appliedExclusionCircles,
          bushExclusionMargin,
        )
      : []
    const key = `r:${entry.index}`
    if (!grass.length && !bushes.length) {
      // 记录空分块，避免流式每帧重复规划（否则会一直占用预算）。
      const empty = createBatch(key)
      empty.centerX = entry.centerX
      empty.centerZ = entry.centerZ
      roadBatches.set(key, empty)
      return
    }
    if (grassInstances >= tier.maxGrassInstances) {
      warn('grass-instance-budget-reached')
      return
    }
    const batch = createBatch(key)
    const grassAdded = addSpriteLayer(batch, grass, 'grass')
    const bushAdded = addSpriteLayer(batch, bushes, 'bush')
    if (grassAdded + bushAdded <= 0) {
      return
    }
    batch.centerX = entry.centerX
    batch.centerZ = entry.centerZ
    batch.grassInstances = grassAdded
    batch.bushInstances = bushAdded
    foliageRoot.add(batch.group)
    roadBatches.set(key, batch)
    grassInstances += grassAdded
    bushInstances += bushAdded
  }

  function buildCameraGrassBatch(batchX: number, batchZ: number): void {
    if (!grid || !densityField || !foliageRoot) {
      return
    }
    if (!props.grass.enabled) {
      return
    }
    const tier = PROCEDURAL_LANDSCAPE_QUALITY_TIERS[resolveQuality()]
    if (grassInstances >= tier.maxGrassInstances) {
      warn('grass-instance-budget-reached')
      return
    }
    const baseX = batchX * CAMERA_GRASS_BATCH_SIZE
    const baseZ = batchZ * CAMERA_GRASS_BATCH_SIZE
    const cellsPerAxis = Math.max(1, Math.round(CAMERA_GRASS_BATCH_SIZE / CAMERA_GRASS_CELL_SIZE))
    const placements: GrassPlacement[] = []
    for (let cellX = 0; cellX < cellsPerAxis; cellX += 1) {
      for (let cellZ = 0; cellZ < cellsPerAxis; cellZ += 1) {
        const absoluteCellX = batchX * cellsPerAxis + cellX
        const absoluteCellZ = batchZ * cellsPerAxis + cellZ
        placements.push(...planCameraGrassChunk(
          {
            seed: props.seed,
            chunkX: absoluteCellX,
            chunkZ: absoluteCellZ,
            chunkSize: CAMERA_GRASS_CELL_SIZE,
            density: props.grass.density,
            maxSlope: 0.7,
            roadHalfWidth: roadHalfWidth(props),
            roadShoulderWidth: props.road.shoulderWidth,
          },
          {
            grid,
            density: densityField,
            roadField: roadProximity,
            surfaceHeightAt: visibleForestHeightAt,
            surfaceNormalAt: visibleForestNormalAt,
          },
        ))
      }
    }
    const kept = filterLandscapeExclusionPlacements(
      takeDensityPrefix(placements, tier.densityMultiplier),
      appliedExclusionCircles,
      grassExclusionMargin,
    )
    const key = `g:${batchX}:${batchZ}`
    if (!kept.length) {
      // 记录空分块（相机在网格外/全是陡坡等），避免流式每帧重试。
      const empty = createBatch(key)
      empty.centerX = baseX + CAMERA_GRASS_BATCH_SIZE * 0.5
      empty.centerZ = baseZ + CAMERA_GRASS_BATCH_SIZE * 0.5
      cameraGrassBatches.set(key, empty)
      return
    }
    const batch = createBatch(key)
    const added = addSpriteLayer(batch, kept, 'grass')
    if (added <= 0) {
      return
    }
    batch.centerX = baseX + CAMERA_GRASS_BATCH_SIZE * 0.5
    batch.centerZ = baseZ + CAMERA_GRASS_BATCH_SIZE * 0.5
    batch.grassInstances = added
    foliageRoot.add(batch.group)
    cameraGrassBatches.set(key, batch)
    grassInstances += added
  }

  /**
   * 流式补齐相机周围的分块。返回 true 表示本轮预算用尽但仍有待建任务，
   * 调用方应继续请求下一帧（否则相机静止时会停在半成品状态——
   * 编辑器里会出现"只有相机附近一小块有植被"的现象）。
   */
  function streamBatches(camera: THREE.Vector3): boolean {
    if (!grid || !densityField) {
      return false
    }
    const tier = PROCEDURAL_LANDSCAPE_QUALITY_TIERS[resolveQuality()]
    let budget = tier.maxBuildTasksPerTick
    let pendingLeft = false

    // Trees are supplied by the world-anchored placement index. The old chunk
    // planner remains as a fallback only while no world scan/index exists.
    if (!worldForestScan && !worldForestIndex) {
      const treeSize = tier.treeChunkSize
      const treeRadius = tier.viewDistance
      const treeMinX = Math.floor((camera.x - treeRadius) / treeSize)
      const treeMaxX = Math.floor((camera.x + treeRadius) / treeSize)
      const treeMinZ = Math.floor((camera.z - treeRadius) / treeSize)
      const treeMaxZ = Math.floor((camera.z + treeRadius) / treeSize)
      const pendingTrees: Array<{ x: number; z: number }> = []
      const pendingTreeCap = budget * 4
      for (let chunkX = treeMinX; chunkX <= treeMaxX && pendingTrees.length <= pendingTreeCap; chunkX += 1) {
        for (let chunkZ = treeMinZ; chunkZ <= treeMaxZ; chunkZ += 1) {
          const centerX = (chunkX + 0.5) * treeSize
          const centerZ = (chunkZ + 0.5) * treeSize
          if (Math.hypot(centerX - camera.x, centerZ - camera.z) > treeRadius + treeSize * 0.5) {
            continue
          }
          if (treeBatches.has(`t:${chunkX}:${chunkZ}`)) {
            continue
          }
          pendingTrees.push({ x: chunkX, z: chunkZ })
        }
      }
      for (const entry of Array.from(treeBatches.values())) {
        if (Math.hypot(entry.centerX - camera.x, entry.centerZ - camera.z) > treeRadius + treeSize * 0.5 + TREE_BATCH_RELEASE_PADDING) {
          releaseBatch(entry, treeBatches)
        }
      }
      pendingTrees.sort((a, b) => {
        const distanceA = Math.hypot((a.x + 0.5) * treeSize - camera.x, (a.z + 0.5) * treeSize - camera.z)
        const distanceB = Math.hypot((b.x + 0.5) * treeSize - camera.x, (b.z + 0.5) * treeSize - camera.z)
        return distanceA - distanceB
      })
      for (const task of pendingTrees) {
        if (budget <= 0) {
          pendingLeft = true
          break
        }
        buildTreeChunk(task.x, task.z, camera)
        budget -= 1
      }
      if (pendingLeft === false && pendingTrees.length >= pendingTreeCap) {
        // 待建列表被上限截断，可能还有更多分块未收集。
        pendingLeft = true
      }
    }

    // Road corridor grass / bushes.
    if (roadBucketTable.length) {
      // Keep roadside shrubs visible through the near-card tree range. The old
      // 80m grass tier ended long before tree cards did, leaving a bare band.
      const nearForestDistance = props.forest.nearDistance ?? tier.treeNearDistance
      const corridorRadius = Math.max(tier.grassRadius, nearForestDistance)
        + props.grass.corridorWidth
        + ROAD_BUCKET_LENGTH
      for (const entry of Array.from(roadBatches.values())) {
        if (Math.hypot(entry.centerX - camera.x, entry.centerZ - camera.z) > corridorRadius + TREE_BATCH_RELEASE_PADDING) {
          releaseBatch(entry, roadBatches)
        }
      }
      const wantRoadFoliage = props.grass.enabled || (props.bushes.enabled && props.bushes.density > 0)
      if (wantRoadFoliage) {
        const pendingBuckets = roadBucketTable
          .filter((entry) => !roadBatches.has(`r:${entry.index}`))
          .filter((entry) => Math.hypot(entry.centerX - camera.x, entry.centerZ - camera.z) <= corridorRadius)
          .sort((a, b) => {
            const distanceA = Math.hypot(a.centerX - camera.x, a.centerZ - camera.z)
            const distanceB = Math.hypot(b.centerX - camera.x, b.centerZ - camera.z)
            return distanceA - distanceB
          })
        for (const entry of pendingBuckets) {
          if (budget <= 0) {
            pendingLeft = true
            break
          }
          buildRoadBucket(entry)
          budget -= 1
        }
      }
    }

    // Camera-centric grass.
    if (props.grass.enabled && props.grass.cameraRadius > 0) {
      const grassRadius = Math.min(tier.grassRadius, props.grass.cameraRadius)
      const size = CAMERA_GRASS_BATCH_SIZE
      const minX = Math.floor((camera.x - grassRadius) / size)
      const maxX = Math.floor((camera.x + grassRadius) / size)
      const minZ = Math.floor((camera.z - grassRadius) / size)
      const maxZ = Math.floor((camera.z + grassRadius) / size)
      const pendingGrass: Array<{ x: number; z: number }> = []
      for (let batchX = minX; batchX <= maxX; batchX += 1) {
        for (let batchZ = minZ; batchZ <= maxZ; batchZ += 1) {
          const centerX = (batchX + 0.5) * size
          const centerZ = (batchZ + 0.5) * size
          if (Math.hypot(centerX - camera.x, centerZ - camera.z) > grassRadius + size * 0.5) {
            continue
          }
          if (cameraGrassBatches.has(`g:${batchX}:${batchZ}`)) {
            continue
          }
          pendingGrass.push({ x: batchX, z: batchZ })
        }
      }
      for (const entry of Array.from(cameraGrassBatches.values())) {
        if (Math.hypot(entry.centerX - camera.x, entry.centerZ - camera.z) > grassRadius + size * 0.5 + TREE_BATCH_RELEASE_PADDING) {
          releaseBatch(entry, cameraGrassBatches)
        }
      }
      pendingGrass.sort((a, b) => {
        const distanceA = Math.hypot((a.x + 0.5) * size - camera.x, (a.z + 0.5) * size - camera.z)
        const distanceB = Math.hypot((b.x + 0.5) * size - camera.x, (b.z + 0.5) * size - camera.z)
        return distanceA - distanceB
      })
      for (const task of pendingGrass) {
        if (budget <= 0) {
          pendingLeft = true
          break
        }
        buildCameraGrassBatch(task.x, task.z)
        budget -= 1
      }
    }
    return pendingLeft
  }

  function updateTreeMeshes(camera: THREE.Vector3): void {
    const radius = resolveNearTreeRadius()
    if (radius <= 0) {
      if (treeMeshManager) {
        treeMeshManager.setVisible(false)
      }
      return
    }
    if (!treeMeshManager && !treeMeshInitStarted && hostObject) {
      treeMeshInitStarted = true
      void createTreeMeshManager({ assetStore, hostInverse: hostObject ? hostInverse : null }).then((manager) => {
        if (disposed) {
          manager.dispose()
          return
        }
        treeMeshManager = manager
        manager.setSeason({
          season: seasonAssetsSeason ?? currentSeason,
          textures: null,
          discolouration: SEASON_PARAMS[seasonAssetsSeason ?? currentSeason].treeDiscolouration,
          hasSnow: SEASON_PARAMS[seasonAssetsSeason ?? currentSeason].hasSnow,
        })
        manager.setLighting({ radiance: appliedLighting.radiance, shadowFactor: appliedLighting.shadowFactor })
        const tier = PROCEDURAL_LANDSCAPE_QUALITY_TIERS[resolveQuality()]
        const bands = resolveTreeLodBands(
          props.forest.nearDistance ?? tier.treeNearDistance,
          resolveNearTreeRadius(),
        )
        manager.setLodBand(bands.meshNear, bands.meshFar)
        if (grid) {
          manager.setDensity(
            forestMaskTexture,
            new THREE.Vector2(grid.minX, grid.minZ),
            new THREE.Vector2(Math.max(0.001, grid.maxX - grid.minX), Math.max(0.001, grid.maxZ - grid.minZ)),
          )
        }
        manager.setDiscolourationNoise(textureFor(SHARED_TEXTURES.noise.id))
        tagArtifact(manager.container)
        hostObject?.add(manager.container)
        applyTreeMeshSeasonTextures()
        manager.setVisible(true)
      }).catch(() => {
        treeMeshInitStarted = false
      })
    }
    if (treeMeshManager) {
      treeMeshManager.setVisible(true)
      const moved = !Number.isFinite(nearMeshCamera.x)
        || Math.hypot(camera.x - nearMeshCamera.x, camera.z - nearMeshCamera.y)
          >= NEAR_MESH_REFRESH_DISTANCE
      const forestChanged = nearMeshForestRevision !== worldForestRevision
      const refresh = moved || forceStream || forestChanged
      if (refresh) {
        const placements = collectActiveTreePlacements(camera, radius)
        nearMeshCamera.set(camera.x, camera.z)
        nearMeshForestRevision = worldForestRevision
        // `refresh` is the single source of truth for re-anchoring. Forcing the
        // manager prevents its own move threshold from clearing a populated
        // instance buffer with the empty placement list of a skipped frame.
        treeMeshManager.update(camera, placements, radius, true)
      }
      // Hand off to the 3D layer only when it is ready and populated. Its fade
      // band now matches the card collapse band, so the two LODs cross-fade
      // instead of drawing overlapping billboards across the same tree.
      foliageUniforms.meshRadius.value = treeMeshManager.ready && treeMeshManager.instanceCount > 0
        ? radius
        : 0
    }
  }

  function applyTreeMeshSeasonTextures(): void {
    if (!treeMeshManager) {
      return
    }
    const season = seasonAssetsSeason ?? currentSeason
    const entry = SEASON_CATALOG[season]
    const placeholder = getSharedPlaceholderTexture()
    treeMeshManager.setSeason({
      season,
      textures: {
        broadleafD: textureFor(entry.trees.broadleafD.id) ?? placeholder,
        broadleafN: textureFor(entry.trees.broadleafN.id) ?? placeholder,
        coniferM: textureFor(entry.trees.coniferM.id) ?? placeholder,
        coniferA: textureFor(entry.trees.coniferA.id) ?? placeholder,
      },
      discolouration: SEASON_PARAMS[season].treeDiscolouration,
      hasSnow: SEASON_PARAMS[season].hasSnow,
    })
    treeMeshManager.setLighting({ radiance: appliedLighting.radiance, shadowFactor: appliedLighting.shadowFactor })
    treeMeshManager.setDiscolourationNoise(textureFor(SHARED_TEXTURES.noise.id))
  }

  function rebuildRoadDebugLine(): void {
    if (!debugRoot) {
      return
    }
    roadDebugLine?.geometry.dispose()
    if (roadDebugLine) {
      debugRoot.remove(roadDebugLine)
      roadDebugLine = null
    }
    if (!props.debug.showRoadPath || !roadResult || roadResult.nodes.length < 2) {
      return
    }
    const positions = new Float32Array(roadResult.nodes.length * 3)
    roadResult.nodes.forEach((node, index) => {
      const y = node.y + DEBUG_ROAD_HEIGHT_OFFSET
      const local = new THREE.Vector3(node.x, y, node.z).applyMatrix4(hostInverse)
      positions[index * 3] = local.x
      positions[index * 3 + 1] = local.y
      positions[index * 3 + 2] = local.z
    })
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const material = new THREE.LineBasicMaterial({ color: 0xffd166 })
    roadDebugLine = new THREE.Line(geometry, material)
    tagArtifact(roadDebugLine)
    debugRoot.add(roadDebugLine)
  }

  function rebuildChunkDebugLines(): void {
    if (!debugRoot) {
      return
    }
    chunkDebugLines?.geometry.dispose()
    if (chunkDebugLines) {
      debugRoot.remove(chunkDebugLines)
      chunkDebugLines = null
    }
    if (!props.debug.showChunks || !treeBatches.size) {
      return
    }
    const tier = PROCEDURAL_LANDSCAPE_QUALITY_TIERS[resolveQuality()]
    const size = tier.treeChunkSize
    const points: number[] = []
    const half = size * 0.5
    for (const entry of treeBatches.values()) {
      const center = new THREE.Vector3(entry.centerX, grid ? (grid.minY + grid.maxY) * 0.5 : 0, entry.centerZ).applyMatrix4(hostInverse)
      const height = grid ? Math.max(4, (grid.maxY - grid.minY) * 0.5) : 8
      const corners = [
        [-half, -height, -half], [half, -height, -half], [half, height, -half], [-half, height, -half],
        [-half, -height, half], [half, -height, half], [half, height, half], [-half, height, half],
      ] as const
      const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as const
      for (const [a, b] of edges) {
        const from = corners[a]!
        const to = corners[b]!
        points.push(center.x + from[0], center.y + from[1], center.z + from[2])
        points.push(center.x + to[0], center.y + to[1], center.z + to[2])
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3))
    chunkDebugLines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x4cc9f0 }))
    tagArtifact(chunkDebugLines)
    debugRoot.add(chunkDebugLines)
  }

  function installSurfaceInjection(): void {
    if (!hostObject) {
      return
    }
    surfacePatch?.restore()
    surfacePatch = null
    surfaceMeshes = collectSurfaceMeshes()
    surfacePatch = applyProceduralLandscapeSurfaceInjection(surfaceMeshes, uniforms, {
      overridesForMesh: (mesh) => {
        if (!usesDemTerrain()) {
          return null
        }
        if (mesh === demMesh) {
          return resolveDemSurfaceOverrides('terrain', demRoadbedCutProx)
        }
        if (mesh === demRoadbedMesh) {
          return resolveDemSurfaceOverrides('roadbed', 0)
        }
        return null
      },
    })
    if (!surfacePatch.hasInjection && !surfaceWarningEmitted) {
      surfaceWarningEmitted = true
      warn('surface-injection-unavailable')
    }
  }

  function syncTerrainTextureStreamGate(): void {
    if (!hostObject) {
      return
    }
    const stream = findTerrainTextureStreamFrom(hostObject)
    if (!stream) {
      return
    }
    // The GLB aerial base map is sampled in aerial and blend modes. In
    // procedural mode (or with the surface disabled) it can be skipped.
    stream.setBaseMapStreamingEnabled(
      enabled && resolveProceduralLandscapeBaseMapMode(props) !== 'replace',
    )
  }

  function updateStats(): void {
    stats.phase = !enabled
      ? 'disabled'
      : gridFailed
        ? 'error'
        : gridBuilder || (usesDemTerrain() && stats.demStatus !== 'ready')
          ? 'sampling'
          : dirty.world || dirty.instances
            ? 'generating'
            : 'streaming'
    stats.progress = gridBuilder
      ? gridBuilder.progress
      : usesDemTerrain() && demMeshBuilder
        ? 0.35 + demMeshBuilder.progress * 0.65
        : grid ? 1 : 0
    stats.quality = resolveQuality()
    if (!usesDemTerrain()) {
      stats.demStatus = 'inactive'
      stats.demSourceBytes = null
      stats.demError = null
      demTransformWarning = null
    } else {
      stats.demSampleStep = resolveDemSampleStep()
      stats.demBuildMs = demBuildMs
      const rotationAngle = 2 * Math.acos(Math.min(1, Math.abs(hostRotationSnapshot.w)))
      const scaleDelta = Math.max(
        Math.abs(hostScaleSnapshot.x - 1),
        Math.abs(hostScaleSnapshot.y - 1),
        Math.abs(hostScaleSnapshot.z - 1),
      )
      demTransformWarning = rotationAngle > 0.01 || scaleDelta > 1e-4
        ? 'DEM 地形仅支持平移：旋转或缩放会让道路、植被与高程采样错位。'
        : null
      if (demTransformWarning) {
        if (!demTransformWarningActive) {
          warn('dem-transform-unsupported')
        }
        demTransformWarningActive = true
      } else {
        demTransformWarningActive = false
      }
    }
    stats.demTransformWarning = demTransformWarning
    stats.treeInstances = treeInstances
    stats.grassInstances = grassInstances
    stats.bushInstances = bushInstances
    stats.batchCount = treeBatches.size + roadBatches.size + cameraGrassBatches.size
    stats.treeChunkCount = treeBatches.size
    stats.roadChunkCount = roadBatches.size
    stats.cameraGrassChunkCount = cameraGrassBatches.size
    stats.gridCols = grid?.cols ?? 0
    stats.gridRows = grid?.rows ?? 0
    stats.gridCellSize = grid?.cellSize ?? 0
    stats.averageEdgeLength = grid?.averageEdgeLength ?? 0
    stats.memoryBytes = (grid?.memoryBytes ?? 0)
      + stats.demMeshBytes
      + (densityField?.memoryBytes ?? 0)
      + (variationField?.memoryBytes ?? 0)
      + (roadFieldData?.memoryBytes ?? 0)
      + (roadFieldData ? roadFieldData.width * roadFieldData.height * 4 : 0)
      + (roadProximity?.memoryBytes ?? 0)
      + (worldForestIndex?.memoryBytes ?? 0)
    stats.roadLength = roadResult?.length ?? 0
    stats.roadNodeCount = roadResult?.nodes.length ?? 0
    stats.roadComplete = roadResult?.complete ?? false
    stats.roadFailureReason = roadResult?.failureReason ?? roadPlanFailureReason
    stats.roadStrategy = props.road.generatedRoute?.strategy ?? null
    stats.roadPlannerMode = roadResult?.plannerMode ?? null
    stats.roadStyle = props.road.generatedRoute?.style ?? null
    stats.roadNaturalTargetLength = roadResult?.naturalTargetLength ?? 0
    stats.roadNaturalLaps = roadResult?.naturalLaps ?? 0
    stats.roadGuideExpandedStates = roadResult?.guideExpandedStates ?? 0
    stats.roadMaxGuideDeviation = roadResult?.maxGuideDeviation ?? 0
    stats.roadUnreachableWaypointIndex = roadResult?.unreachableWaypointIndex ?? null
    stats.roadWaypointCount = roadResult?.waypointCount ?? props.road.generatedRoute?.waypoints.length ?? 0
    stats.roadWaypointsPassed = roadResult?.waypointsPassed ?? 0
    stats.roadWaypointsSkipped = roadResult?.waypointsSkipped ?? 0
    stats.roadSkippedWaypointIndices = [...(roadResult?.skippedWaypointIndices ?? [])]
    stats.roadWaypointsAttempted = roadResult?.waypointsAttempted ?? 0
    stats.roadMaxWaypointError = roadResult?.maxWaypointError ?? 0
    stats.roadClosed = roadResult?.closed ?? false
    stats.shortestExpandedStates = roadResult?.shortestExpandedStates ?? 0
    stats.roadOfficialReverts = roadResult?.officialReverts ?? 0
    stats.roadAntiTargetTriggers = roadResult?.antiTargetTriggers ?? 0
    stats.roadTurnOverflows = roadResult?.turnOverflows ?? 0
    stats.roadAverageElevationPercentile = roadResult?.averageElevationPercentile ?? 0
    stats.roadMaxElevationPercentile = roadResult?.maxElevationPercentile ?? 0
    stats.roadMaxForwardGrade = roadResult?.maxForwardGrade ?? 0
    stats.roadMaxCrossSlope = roadResult?.maxCrossSlope ?? 0
    stats.roadLowlandCoverageFraction = roadResult?.lowlandCoverageFraction ?? 0
    stats.roadSteepReplacementSteps = roadResult?.steepReplacementSteps ?? 0
    stats.roadSmoothingFallback = roadResult?.smoothingFallback ?? false
    stats.roadSmoothingFallbackReason = roadResult?.smoothingFallbackReason ?? null
    stats.roadDetourRadius = roadResult?.detourRadius ?? props.road.generatedRoute?.pathDeviation ?? props.road.pathDeviation
    stats.roadMaxDetourDistance = roadResult?.maxDetourDistance ?? 0
    stats.roadDetourRadiusExpanded = roadResult?.detourRadiusExpanded ?? false
    stats.roadMinCenterlineClearance =
      roadResult?.minCenterlineClearance ?? invalidRoadGeometryClearance
    stats.roadMinTurnRadius =
      roadResult?.minTurnRadius ?? invalidRoadGeometryTurnRadius
    stats.roadGeometryAutoRepaired =
      roadResult?.geometryAutoRepaired ?? false
    stats.roadAutoRepairRoundedCorners =
      roadResult?.autoRepairRoundedCorners ?? 0
    stats.roadMaxAutoRepairWaypointOffset =
      roadResult?.maxAutoRepairWaypointOffset ?? 0
    stats.roadEffectiveWaypointTolerance =
      roadResult?.effectiveWaypointTolerance ?? props.road.waypointTolerance
    if (roadResult && roadResult.nodes.length > 1 && roadResult.length > 0) {
      let totalTurnRadians = 0
      let maxStraightRun = 0
      let straightRun = 0
      for (let index = 1; index < roadResult.nodes.length; index += 1) {
        const node = roadResult.nodes[index]!
        const previous = roadResult.nodes[index - 1]!
        totalTurnRadians += Math.abs(node.headingDelta)
        const segmentLength = Math.hypot(node.x - previous.x, node.z - previous.z)
        if (Math.abs(node.headingDelta) < (0.2 * Math.PI) / 180) {
          straightRun += segmentLength
          maxStraightRun = Math.max(maxStraightRun, straightRun)
        } else {
          straightRun = 0
        }
      }
      stats.roadTurnDegreesPerKm = totalTurnRadians * 180 / Math.PI / (roadResult.length / 1000)
      stats.roadMaxStraightRunMeters = maxStraightRun
    } else {
      stats.roadTurnDegreesPerKm = 0
      stats.roadMaxStraightRunMeters = 0
    }
    stats.season = currentSeason
    // Scene readiness only waits for the small terrain core. Optional foliage,
    // road, wall and water atlases continue streaming after the first frame.
    stats.seasonAssetsReady = seasonAssetsSeason === currentSeason
      && Boolean(seasonAssets)
      && seasonCoreAssetsReady
    stats.nearTreeInstances = treeMeshManager?.instanceCount ?? 0
    stats.nearCardInstances = (nearCardLayers?.broadleaf.count ?? 0) + (nearCardLayers?.conifer.count ?? 0)
    stats.nearTreeReady = treeMeshManager?.ready === true
    stats.adaptive = {
      deviceTier: adaptiveProfile?.deviceTier ?? null,
      sceneAreaKm2: adaptiveProfile?.sceneAreaKm2 ?? null,
      targetCoverage: adaptiveProfile?.targetCoverage ?? null,
      targetDensity: adaptiveProfile?.targetDensity ?? null,
      effectiveCoverage: effectiveForestCoverage,
      effectiveDensity: effectiveForestDensity,
      targetFps: adaptiveProfile?.targetFps ?? null,
      targetTreeCount: adaptiveProfile?.targetTreeCount ?? null,
      measuredFps: adaptiveMeasuredFps,
      calibrationState: adaptiveState,
      calibrationAttempts: adaptiveAttempts,
    }
    const storeStats = assetStore.stats()
    stats.assetTextureCount = storeStats.textureCount
    stats.assetResidentBytes = storeStats.residentBytes
    stats.assetDownloadedBytes = storeStats.downloadedBytes
    stats.assetVariant = storeStats.variant
    stats.barrierInstances = barrierInstances
    stats.wallSegmentCount = wallSegments.length
    stats.farTreeInstances = farForestInstances
    stats.farForestRadius = farForestRadius
    stats.worldForestInstances = farForestInstances
    stats.worldForestBuildMs = worldForestBuildMs
    stats.broadleafTreeInstances = worldForestBroadleafInstances
    stats.coniferTreeInstances = worldForestConiferInstances
    stats.coniferTreeFraction = farForestInstances > 0
      ? worldForestConiferInstances / farForestInstances
      : 0
    stats.roadbedHalfWidth = demRoadbedHalfWidth
    stats.roadbedSideWidth = demRoadbedSideWidth
    stats.roadbedCutProx = demRoadbedCutProx
    stats.roadbedMaxCutFill = demRoadbedMaxCutFill
    stats.roadbedCrossSlopeMax = 0
    stats.roadbedOcclusionCount = demRoadbedOcclusionCount
    stats.roadbedMaxOuterGap = demRoadbedMaxOuterGap
    stats.roadbedAuditSamples = demRoadbedAuditSamples
    stats.roadbedTriangleCount = demRoadbedTriangleCount
    stats.waterEnabled = Boolean(waterPlane && waterPlane.mesh.visible)
    stats.waterLevel = grid ? resolveWaterLevel() : 0
    stats.waterLevelMode = props.water.levelMode
    stats.waterDepthTextureBytes = waterPlane?.depthTextureBytes ?? 0
    stats.waterFloodedFraction = waterFloodStats?.floodedFraction ?? 0
    stats.viewDistanceScale = appliedViewDistanceScale
  }

  function needsStreaming(camera: THREE.Vector3, nowMs: number): boolean {
    if (forceStream) {
      return true
    }
    if (nowMs - lastStreamAt < STREAM_INTERVAL_MS) {
      return false
    }
    if (!Number.isFinite(lastStreamCamera.x)) {
      return true
    }
    return lastStreamCamera.distanceTo(camera) >= STREAM_MOVE_THRESHOLD
  }

  function stepGridBuild(): boolean {
    if (!gridBuilder) {
      return true
    }
    const done = gridBuilder.step()
    if (!done) {
      return false
    }
    if (gridBuilder.result) {
      grid = gridBuilder.result
      gridBuilder = null
      buildWorld()
      return true
    }
    const error = gridBuilder.error ?? 'unknown'
    gridBuilder = null
    warn(`terrain-grid-failed:${error}`)
    gridFailed = true
    dirty.grid = false
    return false
  }

  // ---- 季节素材加载 ----
  type LandscapeTextureNeeds = SeasonTextureRefFilter & { water: boolean }

  function resolveSeasonTextureNeeds(): LandscapeTextureNeeds {
    const roadWidth = roadHalfWidth(props) * 2
    const singleTrack = isSingleTrackRoad(roadWidth)
    const roadReady = Boolean(roadResult && roadResult.nodes.length >= 2)
    return {
      surface: props.surface.enabled && props.surface.textures,
      forest: effectiveForestCoverage > 0 && effectiveForestDensity > 0,
      grass: props.grass.enabled,
      bushes: props.bushes.enabled,
      // Road textures are loaded only after the trace produced a usable path.
      roadSingle: props.road.enabled && roadReady && singleTrack,
      roadWide: props.road.enabled && roadReady && !singleTrack,
      // Wall textures are loaded only after wall placement produced segments.
      walls: wallSegments.length > 0,
      // sea_waves is loaded only when the water line is actually visible.
      water: Boolean(
        props.water.enabled
        && waterFloodStats
        && waterFloodStats.floodedFraction >= WATER_FLOOD_VISIBLE_FRACTION,
      ),
    }
  }

  async function loadSeasonAssets(season: SeasonId, options: { force?: boolean } = {}): Promise<void> {
    const needs = resolveSeasonTextureNeeds()
    const needsKey = jsonKey(needs)
    if (
      !options.force
      && seasonAssetsSeason === season
      && lastLoadedTextureNeedsKey === needsKey
      && seasonAssets
    ) {
      return
    }
    if (
      !options.force
      && seasonLoadInFlight
      && seasonAssetsSeason === season
      && lastLoadedTextureNeedsKey === needsKey
    ) {
      return
    }
    const token = ++seasonLoadToken
    seasonLoadInFlight = true
    seasonCoreAssetsReady = false
    const required = collectSeasonTextureRefs(season, needs)
    const shared = collectLandscapeSharedTextureRefs({
      surface: needs.surface,
      forest: needs.forest,
      grass: needs.grass,
      bushes: needs.bushes,
      water: needs.water,
    })
    const refs = [...required, ...shared]
    const coreRefs = collectProceduralLandscapeCoreTextureRefs(season, {
      surface: needs.surface,
      foliage: needs.forest || needs.grass || needs.bushes,
    })
    const coreIds = new Set(coreRefs.map((ref) => ref.id))
    const entryRefs = refs.filter((ref) => coreIds.has(ref.id))
    const deferredRefs = refs.filter((ref) => !coreIds.has(ref.id))
    const mergeTextures = (textures: Map<string, THREE.Texture>): void => {
      const merged = new Map<string, THREE.Texture>(seasonAssets ?? undefined)
      for (const [id, texture] of textures) {
        merged.set(id, texture)
      }
      seasonAssets = merged
      seasonAssetsSeason = season
      surfaceTexturesReady = needs.surface === true
        && collectSurfaceTextureRefs(season).every((ref) => merged.has(ref.id))
    }
    const applyArrivingTexture = (ref: SeasonTextureRef, texture: THREE.Texture): void => {
      if (disposed || token !== seasonLoadToken) {
        return
      }
      mergeTextures(new Map([[ref.id, texture]]))
      // Bind every arrived texture immediately. This is intentionally lighter
      // than applySeasonToMaterials(): it must not rebuild instancing for each
      // individual PNG.
      applyStreamingSeasonTextures(season)
    }
    try {
      if (entryRefs.length) {
        const textures = await assetStore.textureSet(
          entryRefs,
          undefined,
          { onTexture: applyArrivingTexture },
        )
        if (disposed || token !== seasonLoadToken) {
          return
        }
        mergeTextures(textures)
      }
      seasonCoreAssetsReady = true
      // Commit the first complete terrain frame before optional atlases settle.
      applySeasonToMaterials(season)

      if (deferredRefs.length) {
        const textures = await assetStore.textureSet(
          deferredRefs,
          undefined,
          { onTexture: applyArrivingTexture },
        )
        if (disposed || token !== seasonLoadToken) {
          return
        }
        mergeTextures(textures)
      }
      if (disposed || token !== seasonLoadToken) {
        return
      }
      const merged = seasonAssets ?? new Map<string, THREE.Texture>()
      const missing = required.filter((ref) => !merged.has(ref.id))
      lastLoadedTextureNeedsKey = needsKey
      if (merged.has(SHARED_TEXTURES.seaWaves.id)) {
        waterTextureRequested = false
      }
      if (missing.length) {
        warn(`season-assets-incomplete:${season}:${missing.length}`)
      }
      const storeStats = assetStore.stats()
      for (const message of storeStats.warnings.slice(0, 3)) {
        warn(`asset:${message}`)
      }
      // Scene-entry preloading intentionally warms the full current-season set,
      // including road/wall textures that only become active after the world is
      // built. Keep that whole season resident until the next season is loaded;
      // pruning to the immediate `required` subset would evict and re-download.
      assetStore.prune(slowroadsSharedRetainIds(collectSeasonTextureRefs(season)))
      applySeasonToMaterials(season)
    } catch (error) {
      warn(`season-load-failed:${season}:${error instanceof Error ? error.message : String(error)}`)
      if (token === seasonLoadToken) {
        // A failed optional batch must not leave the scene stuck in a 30s
        // readiness timeout. The error remains visible in warnings.
        seasonCoreAssetsReady = true
        applySeasonToMaterials(season)
      }
    } finally {
      if (token === seasonLoadToken) {
        seasonLoadInFlight = false
      }
    }
  }

  function applyStreamingSeasonTextures(season: SeasonId): void {
    applySeasonUniformsToSurface()
    for (const handle of foliageMaterials.values()) {
      applyFoliageSeasonToHandle(handle)
    }
    const entry = SEASON_CATALOG[season]
    roadBand?.setSeason(season, roadBandTexturesFor(season))
    if (wallLayer) {
      wallLayer.setTextures(
        {
          drystone: textureFor(entry.walls.drystone.id) ?? getSharedPlaceholderTexture(),
          barrier: textureFor(entry.walls.barrier.id) ?? getSharedPlaceholderTexture(),
          seaWall: textureFor(entry.walls.seaWall.id) ?? getSharedPlaceholderTexture(),
        },
        SEASON_PARAMS[season].shadowFactor,
        appliedLighting.radiance,
      )
    }
    applyTreeMeshSeasonTextures()
    buildWater()
  }

  function applySeasonToMaterials(season: SeasonId): void {
    applySeasonUniformsToSurface()
    for (const handle of foliageMaterials.values()) {
      applyFoliageSeasonToHandle(handle)
    }
    const entry = SEASON_CATALOG[season]
    roadBand?.setSeason(season, roadBandTexturesFor(season))
    if (wallLayer) {
      wallLayer.setTextures(
        {
          drystone: textureFor(entry.walls.drystone.id) ?? getSharedPlaceholderTexture(),
          barrier: textureFor(entry.walls.barrier.id) ?? getSharedPlaceholderTexture(),
          seaWall: textureFor(entry.walls.seaWall.id) ?? getSharedPlaceholderTexture(),
        },
        SEASON_PARAMS[season].shadowFactor,
        appliedLighting.radiance,
      )
    }
    applyTreeMeshSeasonTextures()
    // 水面：素材（sea_waves）到达后补建，换季换水波贴图（世界构建早于素材加载时
    // buildWater() 会因为拿不到贴图而跳过，这里保证最终一定会建出来）。
    buildWater()
    // 换季复用放置：只重建植被网格层（不重算 chunkPlan、不重建地形）。
    releaseAllBatches()
    markInstancesDirty()
  }

  /**
   * 官方环境光照同步：把当前季/时间/天气预设的 `lights.radiance` 与当季
   * `effects.shadowFactor` 下发给地表、道路与植被材质（官方 radiance 消费点：
   * 地表/草/灌木/道路 = radiance，树卡与远景树 = radiance/2）。
   */
  function applyEnvironmentLighting(state: ProceduralLandscapeEnvironmentState): void {
    const preset = resolveEnvironmentPreset(state)
    const radiance = preset.lights.radiance ?? 0
    const shadowFactor = SEASON_PARAMS[state.season].shadowFactor
    const fresnel = preset.lights.fresnelFactor ?? 1
    appliedLighting.radiance = radiance
    appliedLighting.shadowFactor = shadowFactor
    appliedLighting.fresnel = fresnel
    uniforms.uPlRadiance.value = radiance
    uniforms.uPlShadowFactor.value = shadowFactor
    uniforms.uPlFresnelIntensity.value = fresnel
    roadBand?.setRadiance(radiance)
    roadBand?.setFresnel(fresnel)
    if (wallLayer) {
      const entry = SEASON_CATALOG[seasonAssetsSeason ?? currentSeason]
      wallLayer.setTextures(
        {
          drystone: textureFor(entry.walls.drystone.id) ?? getSharedPlaceholderTexture(),
          barrier: textureFor(entry.walls.barrier.id) ?? getSharedPlaceholderTexture(),
          seaWall: textureFor(entry.walls.seaWall.id) ?? getSharedPlaceholderTexture(),
        },
        shadowFactor,
        radiance,
      )
    }
    treeMeshManager?.setLighting({ radiance, shadowFactor })
    for (const handle of foliageMaterials.values()) {
      setFoliageMaterialLighting(handle, { radiance, shadowFactor, fresnel })
    }
  }

  function syncSeasonFromFrameState(): void {
    const environmentState = hooks.getSeasonState()
    const next = environmentState?.season ?? 'spring'
    const nextTimeOfDay = environmentState?.timeOfDay ?? 'day'
    const nextWeather = environmentState?.weather ?? 'clear'
    const lightingKey = `${next}|${nextTimeOfDay}|${nextWeather}`
    if (lightingKey !== appliedLightingKey) {
      appliedLightingKey = lightingKey
      applyEnvironmentLighting({ season: next, timeOfDay: nextTimeOfDay, weather: nextWeather })
    }
    if (next === currentSeason && (seasonAssetsSeason === next || seasonLoadInFlight)) {
      return
    }
    if (next !== currentSeason) {
      roadTexturesRequested = false
      wallTexturesRequested = false
      waterTextureRequested = false
    }
    currentSeason = next
    void loadSeasonAssets(next)
  }

  function updateAdaptiveCalibration(deltaTime: number): void {
    if (!adaptiveProfile || adaptiveState === 'disabled' || adaptiveState === 'done') {
      return
    }
    if (adaptiveState === 'waiting') {
      const storeStats = assetStore.stats()
      if (worldForestBuildMs > 0
        && farForestInstances > 0
        && !worldForestScan
        && storeStats.pendingDownloads === 0
        && stats.phase === 'streaming') {
        adaptiveState = 'settling'
        adaptiveSettledAt = elapsedMs + 5000
      }
      return
    }
    if (adaptiveState === 'settling') {
      if (elapsedMs >= adaptiveSettledAt) {
        adaptiveState = 'measuring'
        adaptiveMeasureStartedAt = elapsedMs
        adaptiveMeasureFrames = 0
        adaptiveMeasureSeconds = 0
      }
      return
    }
    if (deltaTime > 0) {
      adaptiveMeasureFrames += 1
      adaptiveMeasureSeconds += deltaTime
    }
    if (elapsedMs - adaptiveMeasureStartedAt < 5000) {
      return
    }
    const fps = adaptiveMeasureSeconds > 0
      ? adaptiveMeasureFrames / adaptiveMeasureSeconds
      : 0
    adaptiveMeasuredFps = Number.isFinite(fps) ? fps : null
    const decision = resolveAdaptiveCalibrationDecision({
      fps,
      treeCount: farForestInstances,
      memoryPressure: currentMemoryPressure,
      profile: adaptiveProfile,
      attempts: adaptiveAttempts,
    })
    if (decision.action !== 'keep' && adaptiveAttempts < 1) {
      adaptiveAttempts = 1
      effectiveForestCoverage = decision.coverage
      effectiveForestDensity = decision.density
      adaptiveState = 'done'
      buildWorld()
    } else {
      adaptiveState = 'done'
    }
  }

  function runtimeUpdate(deltaTime: number): void {
    if (disposed) {
      return
    }
    elapsedMs += deltaTime * 1000
    accumulatedTime += deltaTime
    foliageUniforms.time.value = accumulatedTime

    if (!enabled) {
      releaseAllBatches()
      updateStats()
      return
    }
    if (!hostObject) {
      updateStats()
      return
    }
    ensureRoots()
    applyHostTransformChange(resolveHostTransformChange())
    if (elapsedMs - lastSourceCheckAt >= SOURCE_CHECK_INTERVAL_MS) {
      lastSourceCheckAt = elapsedMs
      checkTerrainSourceChanges()
    }
    syncSeasonFromFrameState()

    if (props.dem.assetId && !props.dem.runtimeGridUrl) {
      stats.demStatus = 'error'
      stats.demError = 'DEM 资源包缺少 runtime grid，请重新上传。'
      gridFailed = true
      updateStats()
      return
    }

    if (dirty.grid) {
      if (usesDemTerrain()) {
        const ready = stepDemBuild()
        if (!ready) {
          updateStats()
          return
        }
        dirty.grid = false
        dirty.world = false
      } else if (!gridBuilder) {
        if (!props.sampling || !hostObject) {
          return
        }
        const resolved = resolveTerrainMeshSources(hostObject)
        currentTerrainSourceSignature = resolved.signature
        gridBuilder = createTerrainGridBuilder(resolved.sources, {
          cellSize: props.sampling.sampleCellSize,
          maxGridSize: props.sampling.maxSampleGridSize,
        })
      } else {
        const ready = stepGridBuild()
        if (!ready || !grid) {
          updateStats()
          return
        }
        dirty.grid = false
        dirty.world = false
      }
    }

    if (dirty.world) {
      dirty.world = false
      buildWorld()
      rebuildRoadDebugLine()
    }
    if (dirty.demMesh) {
      if (!usesDemTerrain() || !demGridData) {
        dirty.demMesh = false
      } else {
        const ready = stepDemBuild()
        if (!ready) {
          updateStats()
          return
        }
      }
    }
    if (dirty.uniforms) {
      dirty.uniforms = false
      applyDynamicSurfaceUniforms()
      rebuildRoadDebugLine()
      // 护栏 / 水面参数（尺寸、密度、水位）变化：只重建这两层，不动世界。
      const nextBarrierSignature = resolveBarrierSignature()
      if (nextBarrierSignature !== barrierSignature) {
        barrierSignature = nextBarrierSignature
        buildWalls()
        buildWater()
      }
    }
    if (dirty.instances) {
      dirty.instances = false
      releaseAllBatches()
      forceStream = true
    }

    const camera = hooks.getCameraWorldPosition()
    if (camera && grid) {
      // LOD dissolve must follow the camera every frame, not only when the
      // 200ms streaming tick runs (2.8m at 14m/s is visible on steep slopes).
      foliageUniforms.cameraPosition.value.copy(camera)
      if (needsStreaming(camera, elapsedMs)) {
        lastStreamAt = elapsedMs
        lastStreamCamera.copy(camera)
        forceStream = false
        // 预算用尽但仍有余量任务时继续请求后续帧，直到视野内植被补齐。
        forceStream = streamBatches(camera)
      }
      updateWorldForest()
      updateNearTreeLayers(camera)
      updateTreeMeshes(camera)
    }
    waterPlane?.update()
    if (chunkDebugDirty) {
      chunkDebugDirty = false
      rebuildChunkDebugLines()
    }
    runLandscapeSelfChecks()
    updateStats()
    updateAdaptiveCalibration(deltaTime)
  }

  const runtime: ProceduralLandscapeRuntime = {
    attach(host: THREE.Object3D | null): void {
      if (disposed || hostObject === host) {
        if (host) {
          applyHostTransformChange(resolveHostTransformChange())
        }
        return
      }
      resetAll()
      if (foliageRoot && foliageRoot.parent !== host) {
        foliageRoot.removeFromParent()
        foliageRoot.clear()
        foliageRoot = null
      }
      if (debugRoot && debugRoot.parent !== host) {
        debugRoot.removeFromParent()
        debugRoot.clear()
        debugRoot = null
      }
      if (farForestRoot && farForestRoot.parent !== host) {
        farForestRoot.removeFromParent()
        farForestRoot.clear()
        farForestRoot = null
      }
      if (treeMeshManager && treeMeshManager.container.parent !== host) {
        treeMeshManager.container.removeFromParent()
      }
      hostObject = host
      guideRouteSurfaceRevision += 1
      if (hostObject) {
        updateHostSnapshot()
        ensureRoots()
        if (treeMeshManager) {
          hostObject.add(treeMeshManager.container)
        }
        gridFailed = false
        dirty.grid = true
      }
      syncTerrainTextureStreamGate()
    },
    setProps(next: ProceduralLandscapeComponentProps): void {
      if (disposed) {
        return
      }
      const previousGenerationRevision = props.generationRevision
      const previousGeneratedRouteKey = jsonKey(props.road.generatedRoute)
      props = clampProceduralLandscapeProps(next, hooks.nodeId)
      if (
        previousGenerationRevision !== props.generationRevision
        || previousGeneratedRouteKey !== jsonKey(props.road.generatedRoute)
      ) {
        exclusionCapturePending = true
      }
      guideRouteSurfaceRevision += 1
      const keys = {
        grid: jsonKey(props.sampling),
        dem: jsonKey([
          props.dem.assetId,
          props.dem.runtimeGridUrl,
          props.dem.runtimeOrthoUrl,
          props.dem.sampleStep,
        ]),
        world: jsonKey([
          props.seed,
          props.generationRevision,
          props.road.generatedRoute,
          props.road.enabled,
          props.road.width,
          props.road.shoulderWidth,
          props.road.stepLength,
          props.road.feelDistance,
          props.road.feelAngleDeg,
          props.road.maxSlope,
          props.road.maxTurnDeg,
          props.road.flattenBand,
          props.road.flattenStrength,
          props.forest.coverage,
          props.forest.scale,
          props.forest.seedOffset,
        ]),
        forest: jsonKey([
          props.seed,
          props.forest.coverage,
          props.forest.scale,
          props.forest.seedOffset,
          props.forest.density,
          props.forest.maxSlope,
          props.forest.minHeight,
          props.forest.minScale,
          props.forest.maxScale,
          props.quality,
        ]),
        instances: jsonKey([props.grass, props.bushes, props.quality]),
        waterSpatial: jsonKey([props.water.levelMode, props.water.levelOffset]),
        lod: jsonKey([props.forest.nearDistance, props.forest.nearTreeRadius, props.quality]),
        uniforms: jsonKey([
          props.surface,
          props.canopy,
          props.wind,
          props.walls,
          props.water,
          props.road.enabled,
          props.road.width,
          props.road.shoulderWidth,
          props.road.flattenBand,
          props.road.flattenStrength,
        ]),
        textureNeeds: jsonKey([
          props.surface.enabled,
          props.surface.textures,
          props.forest.coverage,
          props.forest.density,
          props.grass.enabled,
          props.bushes.enabled,
          props.road.enabled,
          props.road.width,
          props.walls.drystone.enabled,
          props.walls.fence.enabled,
          props.walls.barrier.enabled,
          props.walls.seaWall.enabled,
          props.water.enabled,
        ]),
        roadDebug: jsonKey(props.debug.showRoadPath),
        chunkDebug: jsonKey(props.debug.showChunks),
      }
      const forestControlsChanged = keys.forest !== previousKeys.forest
      const waterSpatialChanged = keys.waterSpatial !== previousKeys.waterSpatial
      if (forestControlsChanged) {
        resetAdaptiveState()
      }
      if (keys.textureNeeds !== previousKeys.textureNeeds) {
        seasonLoadToken += 1
        seasonLoadInFlight = false
        seasonCoreAssetsReady = false
        seasonAssetsSeason = null
        lastLoadedTextureNeedsKey = ''
        roadTexturesRequested = false
        wallTexturesRequested = false
        waterTextureRequested = false
      }
      if (keys.dem !== previousKeys.dem) {
        disposeDemSource()
      }
      if (keys.grid !== previousKeys.grid || keys.dem !== previousKeys.dem) {
        dirty.grid = true
        gridBuilder = null
        grid = null
        gridFailed = false
        disposeWorldState()
      }
      if (dirty.grid || keys.world !== previousKeys.world || forestControlsChanged) {
        dirty.world = true
        roadWarningEmitted = false
      }
      if (dirty.grid || dirty.world || keys.instances !== previousKeys.instances) {
        dirty.instances = true
        forceStream = true
      }
      if (waterSpatialChanged) {
        releaseAllBatches()
        dirty.instances = true
        forceStream = true
        if (grid && densityField) {
          startWorldForest()
        }
      }
      if (forestControlsChanged && grid && densityField && !dirty.world) {
        startWorldForest()
      }
      if (keys.lod !== previousKeys.lod) {
        applyTreeLodBands()
      }
      if (keys.uniforms !== previousKeys.uniforms) {
        dirty.uniforms = true
      }
      if (keys.roadDebug !== previousKeys.roadDebug) {
        dirty.uniforms = true
      }
      if (keys.chunkDebug !== previousKeys.chunkDebug) {
        chunkDebugDirty = true
        dirty.uniforms = true
      }
      previousKeys = keys
      syncTerrainTextureStreamGate()
    },
    setEnabled(value: boolean): void {
      if (disposed || enabled === value) {
        return
      }
      enabled = value
      guideRouteSurfaceRevision += 1
      if (!enabled) {
        releaseAllBatches()
      } else {
        forceStream = true
      }
      syncTerrainTextureStreamGate()
      syncDemOrthoTextureBinding()
      if (enabled) {
        ensureDemOrthoTexture()
      }
    },
    update(deltaTime: number): void {
      try {
        runtimeUpdate(deltaTime)
      } catch (error) {
        stats.phase = 'error'
        warn(`runtime-error:${error instanceof Error ? error.message : String(error)}`)
      }
    },
    dispose(): void {
      if (disposed) {
        return
      }
      if (hostObject) {
        findTerrainTextureStreamFrom(hostObject)?.setBaseMapStreamingEnabled(true)
      }
      disposed = true
      resetAll()
      disposeDemSource()
      for (const handle of foliageMaterials.values()) {
        handle.material.dispose()
      }
      foliageMaterials.clear()
      treeMeshManager?.dispose()
      treeMeshManager = null
      roadBand?.dispose()
      roadBand = null
      disposeRoadCollisionMesh()
      roadFieldTexture?.dispose()
      roadFieldTexture = null
      forestMaskTexture?.dispose()
      forestMaskTexture = null
      variationTexture?.dispose()
      variationTexture = null
      if (foliageRoot && hostObject) {
        hostObject.remove(foliageRoot)
      }
      if (debugRoot && hostObject) {
        hostObject.remove(debugRoot)
      }
      if (farForestRoot && hostObject) {
        hostObject.remove(farForestRoot)
      }
      disposeWaterAndBarrier()
      foliageRoot = null
      debugRoot = null
      farForestRoot = null
      waterFloodStats = null
      sceneRoot = null
      statsRegistry.delete(hooks.nodeId)
      runtimeRegistry.delete(hooks.nodeId)
    },
    getStats(): ProceduralLandscapeRuntimeStats {
      return stats
    },
    validateGeneratedRoad(route, road): ProceduralLandscapeRoadValidation {
      if (!grid || !hostObject) {
        return {
          ok: false,
          failureReason: 'terrain-grid-not-ready',
          nodeCount: 0,
          length: 0,
          unreachableWaypointIndex: null,
          centerline: null,
        }
      }
      appliedExclusionCircles = getLandscapeExclusionSnapshot()
      stats.exclusionZoneCount = appliedExclusionCircles.length
      stats.exclusionSignature = landscapeExclusionSignature(appliedExclusionCircles)
      exclusionCapturePending = false
      const result = planGeneratedRoad(grid, hostObject, route, road)
      if (!result || result.nodes.length < 2) {
        return {
          ok: false,
          failureReason: result?.failureReason ?? 'no-waypoints',
          nodeCount: result?.nodes.length ?? 0,
          length: result?.length ?? 0,
          unreachableWaypointIndex: result?.unreachableWaypointIndex ?? null,
          centerline: null,
        }
      }
      {
        if (
          (result.maxForwardGrade ?? 0)
          > SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade + 1e-4
        ) {
          return {
            ok: false,
            failureReason: 'road-forward-grade-limit',
            nodeCount: result.nodes.length,
            length: result.length,
            unreachableWaypointIndex: result.unreachableWaypointIndex ?? null,
            centerline: null,
          }
        }
        if (
          (result.maxCrossSlope ?? 0)
          > SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope + 1e-4
        ) {
          return {
            ok: false,
            failureReason: 'road-cross-slope-limit',
            nodeCount: result.nodes.length,
            length: result.length,
            unreachableWaypointIndex: result.unreachableWaypointIndex ?? null,
            centerline: null,
          }
        }
      }
      return {
        ok: result.complete,
        failureReason: result.complete
          ? null
          : (result.failureReason ?? 'road-route-incomplete'),
        nodeCount: result.nodes.length,
        length: result.length,
        unreachableWaypointIndex: result.unreachableWaypointIndex ?? null,
        centerline: result.complete
          ? buildCenterlineLocalSnapshot(
              hostObject,
              result.nodes,
              Math.max(1, demGridSampleStep),
              grid.cellSize,
            )
          : null,
      }
    },
    getGeneratedRoadCenterlineLocal(): ProceduralLandscapeGeneratedRouteCenterline | null {
      const saved = props.road.generatedRoute?.centerline
      const currentExclusionSignature = landscapeExclusionSignature(appliedExclusionCircles)
      if (
        saved?.pointsXZ.length
        && (saved.exclusionSignature ?? '') === currentExclusionSignature
      ) {
        return {
          pointsXZ: [...saved.pointsXZ],
          authoringSampleStep: saved.authoringSampleStep,
          authoringCellSize: saved.authoringCellSize,
          exclusionSignature: saved.exclusionSignature ?? '',
        }
      }
      if (!grid || !hostObject || !roadResult || roadResult.nodes.length < 2) {
        return null
      }
      return buildCenterlineLocalSnapshot(
        hostObject,
        roadResult.nodes,
        Math.max(1, demGridSampleStep),
        grid.cellSize,
      )
    },
    resolveRoadLanePose(
      worldX: number,
      worldZ: number,
      facingYawRad: number,
    ): RoadLanePose | null {
      if (!props.road.enabled) {
        return null
      }
      const rows = roadBandRows ?? roadResult?.nodes ?? null
      if (!rows || rows.length < 2) {
        return null
      }
      return resolveRoadLanePoseFromRows(rows, {
        worldX,
        worldZ,
        facingYawRad,
        halfWidth: roadHalfWidth(props),
        columnHeights: roadBandRows ? roadBandColumns : null,
        surfaceLift: ROAD_BAND_LIFT,
      })
    },
    getTerrainCenterLocal(): RoadWaypoint | null {
      if (!grid || !hostObject) {
        return null
      }
      hostObject.updateMatrixWorld(true)
      const world = new THREE.Vector3(
        (grid.minX + grid.maxX) * 0.5,
        0,
        (grid.minZ + grid.maxZ) * 0.5,
      )
      const local = hostObject.worldToLocal(world)
      return Number.isFinite(local.x) && Number.isFinite(local.z)
        ? { x: local.x, z: local.z }
        : null
    },
    getScenicStartLocal(): RoadWaypoint | null {
      if (!grid || !hostObject) {
        return null
      }
      const centerX = (grid.minX + grid.maxX) * 0.5
      const centerZ = (grid.minZ + grid.maxZ) * 0.5
      const start = resolveLowlandScenicStart(grid, centerX, centerZ)
      if (!start) {
        return null
      }
      hostObject.updateMatrixWorld(true)
      const local = hostObject.worldToLocal(new THREE.Vector3(start.x, 0, start.z))
      return Number.isFinite(local.x) && Number.isFinite(local.z)
        ? { x: local.x, z: local.z }
        : null
    },
    resolveScenicWaypointLocal(
      worldX: number,
      worldZ: number,
      maxRadius = ROAD_WAYPOINT_SNAP_RADIUS,
    ): ProceduralLandscapeWaypointResolutionResult {
      if (!grid || !hostObject) {
        return { ok: false, failureReason: 'terrain-grid-not-ready' }
      }
      const resolved = resolveRoadWaypointPlacement(
        grid,
        worldX,
        worldZ,
        maxRadius,
        {
          maxCrossSlope: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope,
        },
      )
      if (!resolved.ok) {
        return resolved
      }
      hostObject.updateMatrixWorld(true)
      const local = hostObject.worldToLocal(
        new THREE.Vector3(resolved.placement.x, 0, resolved.placement.z),
      )
      if (!Number.isFinite(local.x) || !Number.isFinite(local.z)) {
        return { ok: false, failureReason: 'coordinate-conversion-failed' }
      }
      return {
        ok: true,
        snapped: resolved.snapped,
        placement: {
          ...resolved.placement,
          localX: local.x,
          localZ: local.z,
        },
      }
    },
    sampleTerrainHeight(worldX: number, worldZ: number): number | null {
      if (!grid) {
        return null
      }
      return grid.sampleHeight(worldX, worldZ)
    },
    getPlacementSurface(): ProceduralLandscapePlacementSurface | null {
      if (!enabled || !grid || gridFailed) {
        return null
      }
      if (usesDemTerrain() && stats.demStatus !== 'ready') {
        return null
      }
      const activeGrid = grid
      return {
        revision: guideRouteSurfaceRevision,
        bounds: {
          minX: activeGrid.minX,
          maxX: activeGrid.maxX,
          minZ: activeGrid.minZ,
          maxZ: activeGrid.maxZ,
          minY: activeGrid.minY,
          maxY: activeGrid.maxY,
          cellSize: activeGrid.cellSize,
        },
        sampleHeightAt: (worldX: number, worldZ: number) => (
          usesDemTerrain()
            ? sampleVisibleDemSurfaceHeightAt(activeGrid, demRoadbedTarget, worldX, worldZ)
            : activeGrid.sampleHeight(worldX, worldZ)
        ),
      }
    },
    getGuideRouteSurfaceState(): GuideRouteSurfaceState {
      if (!enabled) {
        return {
          status: 'inactive',
          revision: guideRouteSurfaceRevision,
          message: 'Procedural Landscape is disabled.',
          bounds: null,
        }
      }
      if (gridFailed || stats.demStatus === 'error') {
        return {
          status: 'error',
          revision: guideRouteSurfaceRevision,
          message: stats.demError ?? 'Terrain generation failed.',
          bounds: null,
        }
      }
      if (!grid || (usesDemTerrain() && stats.demStatus !== 'ready')) {
        return {
          status: 'loading',
          revision: guideRouteSurfaceRevision,
          message: usesDemTerrain() ? `DEM terrain is ${stats.demStatus}.` : 'Terrain grid is not ready.',
          bounds: null,
        }
      }
      return {
        status: 'ready',
        revision: guideRouteSurfaceRevision,
        message: null,
        bounds: {
          minX: grid.minX,
          maxX: grid.maxX,
          minZ: grid.minZ,
          maxZ: grid.maxZ,
          minY: grid.minY,
          maxY: grid.maxY,
          cellSize: grid.cellSize,
        },
      }
    },
    sampleGuideRouteSurface(
      worldX: number,
      worldZ: number,
      facingYawRad = 0,
    ): GuideRouteSurfaceSample | null {
      if (!enabled || !grid || !Number.isFinite(worldX) || !Number.isFinite(worldZ)) {
        return null
      }

      const terrainY = grid.sampleHeight(worldX, worldZ)
      if (terrainY == null) {
        return null
      }

      let centerY = terrainY
      let kind: GuideRouteSurfaceSample['kind'] = 'terrain'
      let distanceToRoad: number | null = null
      if (props.road.enabled) {
        const rows = roadBandRows ?? roadResult?.nodes ?? null
        if (rows && rows.length >= 2) {
          const pose = resolveRoadLanePoseFromRows(rows, {
            worldX,
            worldZ,
            facingYawRad,
            halfWidth: roadHalfWidth(props),
            columnHeights: roadBandRows ? roadBandColumns : null,
            surfaceLift: ROAD_BAND_LIFT,
          })
          const roadLimit = roadHalfWidth(props) + Math.max(0, props.road.shoulderWidth)
          if (pose && pose.distance <= roadLimit) {
            centerY = pose.y
            kind = 'road'
            distanceToRoad = pose.distance
          }
        }
      }

      const delta = Math.max(0.5, grid.cellSize * 0.5)
      const left = grid.sampleHeight(worldX - delta, worldZ)
      const right = grid.sampleHeight(worldX + delta, worldZ)
      const back = grid.sampleHeight(worldX, worldZ - delta)
      const front = grid.sampleHeight(worldX, worldZ + delta)
      const normal = new THREE.Vector3()
      if (left != null && right != null && back != null && front != null) {
        normal.set(
          -(right - left) / (delta * 2),
          1,
          -(front - back) / (delta * 2),
        ).normalize()
      } else {
        normal.set(0, 1, 0)
      }

      return {
        point: new THREE.Vector3(worldX, centerY, worldZ),
        normal,
        kind,
        distanceToRoad,
        revision: guideRouteSurfaceRevision,
      }
    },
  }
  runtimeRegistry.set(hooks.nodeId, runtime)
  return runtime
}
