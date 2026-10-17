import * as THREE from 'three'
import {
  buildForestDensityField,
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
  createDemTerrainHeightGrid,
  createDemTerrainMeshBuilder,
  loadTerrainDemRuntimeGrid,
  type DemTerrainMeshBuilder,
} from './demTerrain'
import type { TerrainDemRuntimeGridData } from '../terrainDemRuntimeGrid'
import {
  buildTerrainSurfaceSampler,
  type TerrainSurfaceBounds,
  type TerrainSurfaceSampler,
} from './terrainSurfaceSampler'
import { resolveSeedHeadingRad, traceRoadPath, type RoadTraceNode, type RoadTraceResult } from './roadTrace'
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
  collectFarForestPlacements,
  createFarForestScan,
  stepFarForestScan,
  type FarForestScan,
} from './farForest'
import {
  computeWaterFloodStats,
  WATER_FLOOD_VISIBLE_FRACTION,
  type WaterFloodStats,
} from './waterStats'
import {
  applyProceduralLandscapeSurfaceInjection,
  createProceduralLandscapeSurfaceUniforms,
  type ProceduralLandscapeSurfacePatch,
} from './surfaceMaterial'
import { createRoadBand, type RoadBandHandle, type RoadBandTextures } from './roadBand'
import { createTreeMeshManager, type TreeMeshManager } from './treeMeshes'
import { computeRoadMarkings, type RoadMarkingWeights } from './roadMarkings'
import { DEFAULT_ROAD_STYLE, ROAD_STYLE_PROFILES, isSingleTrackRoad } from './roadStyle'
import { computeWallSegments, type WallSegment } from './walls'
import { createWallLayers, wallFenceSpriteSamples, type WallLayerHandle } from './wallLayer'
import { createWaterPlane, type WaterPlaneHandle } from './waterPlane'
import { getSharedSlowroadsAssetStore, slowroadsSharedRetainIds, type SlowroadsAssetStore } from '../slowroads/assets/assetStore'
import {
  collectSeasonTextureRefs,
  SEASON_CATALOG,
  SHARED_TEXTURES,
  type SeasonId,
} from '../slowroads/core/seasonCatalog'
import { SEASON_PARAMS } from '../slowroads/core/seasonParams'
import { resolveEnvironmentPreset } from '../slowroads/core/environment'
import {
  reportSlowroadsSelfChecks,
  runMaterialUniformCoverageChecks,
  runSlowroadsSeasonChecks,
  runTreeDiscolourationShaderChecks,
} from '../slowroads/render/selfCheck'
import { collectSlowroadsShaderAudits } from './shaderAudit'
import {
  BARRIER_RAIL_REGIONS,
  getBushEntries,
  getConiferCardRegions,
  getGrassEntries,
  gridRegions,
  BROADLEAF_CARD_REGIONS,
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
import { clamp, degreesToRadians, smoothstep } from './noise'
import {
  densifyRoadRows,
  sampleRoadRowColumns,
  type RoadBandRow,
} from './roadBandRows'
import { createDemRoadbedGeometry } from './demRoadbed'
import {
  activeRoadWaypoints,
  clampProceduralLandscapeProps,
  PROCEDURAL_LANDSCAPE_WIND_FACTOR,
  PROCEDURAL_LANDSCAPE_QUALITY_TIERS,
  resolveSurfaceHeightScale,
  resolveSurfaceViewDistanceScale,
  resolveProceduralLandscapeQuality,
  roadFlattenParams,
  roadFeelAngleRad,
  roadHalfWidth,
  type ProceduralLandscapeComponentProps,
  type ProceduralLandscapeEnvironment,
  type ResolvedProceduralLandscapeQuality,
} from './config'
import { transformRoadWaypointsToWorld, type RoadWaypoint } from './roadWaypoints'
import { planEndpointRoadGuide } from './endpointPath'
import { setSlowroadsSceneViewDistanceScale } from '../slowroads/render/environmentRuntime'

const TREE_BATCH_RELEASE_PADDING = 48
const ROAD_BUCKET_LENGTH = 16
const CAMERA_GRASS_BATCH_SIZE = 32
const CAMERA_GRASS_CELL_SIZE = 8
const STREAM_INTERVAL_MS = 200
const STREAM_MOVE_THRESHOLD = 8
const ROAD_FIELD_RESOLUTION = 1024
/** 横坡贴合模式下路面带相对地形的固定抬升（米）。 */
const ROAD_BAND_LIFT = 0.05
/** 贴合模式下路面带的横向采样列数（从左缘到右缘）。 */
const ROAD_BAND_COLUMN_COUNT = 9
/** 贴合模式下路面带的沿路采样间距（米）：追踪节点 8m 之间加密，接住横向折坡。 */
const ROAD_BAND_ROW_SPACING = 2
const DEBUG_ROAD_HEIGHT_OFFSET = 0.6
const SOURCE_CHECK_INTERVAL_MS = 500
const TREE_UNIT_SIZE = 8
const GRASS_UNIT_SIZE = 1.6
const BUSH_UNIT_SIZE = 2
const IMPOSTER_REGIONS: SpriteRegion[] = gridRegions(16, 4, 4096, 1024)
/** 近树卡 LOD dissolve 区间推导（lab main.ts：lod1Horizon = nearDistance / 10）。 */
const CARD_DISSOLVE_INTERVAL_FACTOR = 0.3
/** 木护栏段的世界尺寸（lab：单片面 unitSize 0.35m、alphaTest 0.35）。 */
const BARRIER_UNIT_SIZE = 0.35
/**
 * 远景林（相机锚定多环环带，覆盖近景流式半径 → 雾距之间的可见地形）：
 *  - 重锚阈值：相机水平位移超过它才重建，避免连续重建把扫描摊薄成常态开销；
 *  - 扫描预算：每帧最多处理的候选格数量（分帧摊薄，避免一次重锚卡帧）；
 *  - 外半径：最多覆盖到场景雾远端的 75%（再远已被雾吃掉，实例纯浪费）。
 */
const FAR_FOREST_REANCHOR_DISTANCE = 800
const FAR_FOREST_SCAN_SAMPLES_PER_FRAME = 25_000
const FAR_FOREST_RADIUS_FOG_FACTOR = 0.75
/** 远景环最小可用带宽：雾距小于「近景半径 + 它」时不建环（没有可见空间）。 */
const FAR_FOREST_MIN_BAND_WIDTH = 64
/**
 * 远景环每个物种层的缓冲容量预留比例（预算 × 系数）。
 * 物种按哈希 40/60 分布，0.8× 预算的容量足以覆盖抽样波动，
 * 避免每次重锚重新分配 6 万级实例的几何与属性缓冲。
 */
const FAR_FOREST_SPECIES_CAPACITY_FACTOR = 0.8

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
  /** 当前季节与素材状态（面板展示）。 */
  season: SeasonId
  seasonAssetsReady: boolean
  nearTreeInstances: number
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
  /** 水面是否启用（水线 = 地形最低点 + water.levelOffset）。 */
  waterEnabled: boolean
  /** 当前水线（世界 Y；= 地形最低点 + water.levelOffset）。 */
  waterLevel: number
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
  /** 来自 ComponentFrameState.environment（EnvironmentPanel 设置）。 */
  getSeasonState(): ProceduralLandscapeEnvironmentState | null
}

export interface ProceduralLandscapeRuntime {
  attach(host: THREE.Object3D | null): void
  setProps(props: ProceduralLandscapeComponentProps): void
  setEnabled(enabled: boolean): void
  update(deltaTime: number): void
  dispose(): void
  getStats(): ProceduralLandscapeRuntimeStats
  /**
   * Runtime height-field sampling in world XZ (null when the grid is not
   * ready yet or the point lies outside the rasterized coverage).
   */
  sampleTerrainHeight(worldX: number, worldZ: number): number | null
}

let currentEnvironment: ProceduralLandscapeEnvironment = 'preview'

export function setProceduralLandscapeEnvironment(environment: ProceduralLandscapeEnvironment): void {
  currentEnvironment = environment
}

export function getProceduralLandscapeEnvironment(): ProceduralLandscapeEnvironment {
  return currentEnvironment
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

type DirtyFlags = {
  grid: boolean
  world: boolean
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
    dem: jsonKey([props.dem.assetId, props.dem.runtimeGridUrl, props.dem.sampleStep]),
    world: jsonKey([props.seed, props.generationRevision, props.road, props.forest.coverage, props.forest.scale, props.forest.seedOffset]),
    instances: jsonKey([props.forest, props.grass, props.bushes, props.quality]),
    uniforms: jsonKey([props.surface, props.canopy, props.wind, props.road.flattenBand, props.road.flattenStrength]),
    roadDebug: jsonKey(props.debug.showRoadPath),
    chunkDebug: jsonKey(props.debug.showChunks),
  }
  const dirty: DirtyFlags = { grid: false, world: false, instances: false, uniforms: true }
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
  let demMeshBuilder: DemTerrainMeshBuilder | null = null
  let demMesh: THREE.Mesh | null = null
  let demLoadPromise: Promise<void> | null = null
  let demLoadToken = 0
  let demSourceKey = ''
  let demBuildStartedAt = 0
  let demBuildMs = 0
  let demTransformWarning: string | null = null
  let demTransformWarningActive = false
  let demRoadbedMesh: THREE.Mesh | null = null
  let demRoadbedHalfWidth = 0
  let densityField: LandscapeDensityField | null = null
  let variationField: LandscapeDensityField | null = null
  let forestMaskTexture: THREE.DataTexture | null = null
  let variationTexture: THREE.DataTexture | null = null
  let roadResult: RoadTraceResult | null = null
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
  let treeMeshManager: TreeMeshManager | null = null
  let treeMeshInitStarted = false
  let waterPlane: WaterPlaneHandle | null = null
  let barrierLayer: THREE.InstancedMesh | null = null
  let barrierInstances = 0
  /** 远景林根节点（相机锚定多环环带；与分块植被层互不干扰）。 */
  let farForestRoot: THREE.Group | null = null
  /** 远景林两个物种层（复用缓冲，重锚只重写实例属性）。 */
  let farForestLayers: { broadleaf: THREE.InstancedMesh; conifer: THREE.InstancedMesh } | null = null
  let farForestInstances = 0
  let farForestRadius = 0
  /** 当前远景环的锚点（相机世界 XZ；NaN = 尚未建立）。 */
  let farForestAnchorX = Number.NaN
  let farForestAnchorZ = Number.NaN
  /** 远景环参数签名（质量档/种子/网格/雾尺度变化时重建）。 */
  let farForestSignature = ''
  /** 分帧推进中的远景环扫描（null = 空闲）。 */
  let farForestScan: FarForestScan | null = null
  /** 水线诊断（世界构建时按地形直方图统计一次，水位变化时刷新淹没比例）。 */
  let waterFloodStats: WaterFloodStats | null = null
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

  const stats: ProceduralLandscapeRuntimeStats = {
    nodeId: hooks.nodeId,
    phase: 'idle',
    progress: 0,
    warnings: [],
    quality: resolveProceduralLandscapeQuality(props.quality, currentEnvironment),
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
    season: currentSeason,
    seasonAssetsReady: false,
    nearTreeInstances: 0,
    assetTextureCount: 0,
    assetResidentBytes: 0,
    assetDownloadedBytes: 0,
    assetVariant: assetStore.variant,
    barrierInstances: 0,
    wallSegmentCount: 0,
    farTreeInstances: 0,
    farForestRadius: 0,
    waterEnabled: false,
    waterLevel: 0,
    waterFloodedFraction: 0,
    viewDistanceScale: 1,
    demStatus: 'inactive',
    demSourceBytes: null,
    demSampleStep: 1,
    demBuildMs: 0,
    demError: null,
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

  function collectActiveTreePlacements(): TreePlacement[] {
    const out: TreePlacement[] = []
    for (const entry of treeBatches.values()) {
      if (entry.treePlacements.length) {
        out.push(...entry.treePlacements)
      }
    }
    return out
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

  function disposeDemRoadbed(): void {
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
    disposeDemRoadbed()
    disposeDemMesh()
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
    const key = `${props.dem.assetId}|${props.dem.runtimeGridUrl}|${resolveDemSampleStep()}`
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
        demMeshBuilder = createDemTerrainMeshBuilder(data, resolveDemSampleStep())
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
    if (!demMeshBuilder) {
      demMeshBuilder = createDemTerrainMeshBuilder(demGridData, resolveDemSampleStep())
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
      return false
    }
    disposeDemMesh()
    const positionBytes = demGeometry.getAttribute('position')?.array?.byteLength ?? 0
    const normalBytes = demGeometry.getAttribute('normal')?.array?.byteLength ?? 0
    const indexBytes = demGeometry.getIndex()?.array?.byteLength ?? 0
    stats.demMeshBytes = positionBytes + normalBytes + indexBytes
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff })
    const mesh = new THREE.Mesh(demGeometry, material)
    mesh.name = `slowroads-dem-terrain-${hooks.nodeId}`
    mesh.userData.proceduralLandscapeDemTerrain = true
    hostObject.add(mesh)
    demMesh = mesh
    const hostWorld = new THREE.Vector3().setFromMatrixPosition(hostObject.matrixWorld)
    grid = createDemTerrainHeightGrid(demGridData, hostWorld.x, hostWorld.z, hostWorld.y)
    currentTerrainSourceSignature = `dem:${demSourceKey}`
    gridFailed = false
    stats.demStatus = 'ready'
    dirty.grid = false
    dirty.world = false
    buildWorld()
    installSurfaceInjection()
    return true
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
    disposeDemRoadbed()
    forestMaskTexture?.dispose()
    forestMaskTexture = null
    variationTexture?.dispose()
    variationTexture = null
    roadFieldTexture?.dispose()
    roadFieldTexture = createEmptyRoadFieldTexture()
    roadBand?.dispose()
    roadBand = null
    roadMarkings = null
    densityField = null
    variationField = null
    roadResult = null
    roadFieldData = null
    roadEdgeHeights = null
    roadCenterHeights = null
    roadBandRows = null
    roadBandColumns = null
    roadSurfaceSampler = null
    roadProximity = null
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

  /** 水线 = 地形最低点 + water.levelOffset（lab：高度场的固定水位）。 */
  function resolveWaterLevel(): number {
    if (!grid) {
      return 0
    }
    return grid.minY + props.water.levelOffset
  }

  // ---- 远景林（相机锚定多环 LOD）----

  /**
   * 远景环档位：外半径取 `min(档位半径, 雾远端 × 0.75)`，返回 null 表示不建环
   * （low 档关闭 / 预算为 0 / 雾距还没把近景半径之外的可见空间留出来）。
   */
  function resolveFarForestTier(): { radius: number; budget: number } | null {
    const tier = PROCEDURAL_LANDSCAPE_QUALITY_TIERS[resolveQuality()]
    const far = tier.farForest
    if (!far || far.budget <= 0 || far.radius <= 0) {
      return null
    }
    const fogFar = Math.max(1, appliedViewDistanceScale) * 1000
    const radius = Math.min(far.radius, fogFar * FAR_FOREST_RADIUS_FOG_FACTOR)
    if (radius <= tier.viewDistance + FAR_FOREST_MIN_BAND_WIDTH) {
      return null
    }
    return { radius, budget: Math.floor(far.budget) }
  }

  /** 远景环参数签名：任一影响放置的输入变化都要重扫。 */
  function resolveFarForestSignature(): string {
    if (!grid) {
      return ''
    }
    return jsonKey([
      resolveQuality(),
      props.seed,
      props.forest.minScale,
      props.forest.maxScale,
      props.forest.maxSlope,
      resolveForestRoadClearance(),
      props.water.levelOffset,
      grid.cols,
      grid.rows,
      Math.round(grid.minY * 100) / 100,
      appliedViewDistanceScale,
    ])
  }

  function disposeFarForestRing(): void {
    if (farForestLayers) {
      disposeFoliageLayerMesh(farForestLayers.broadleaf)
      disposeFoliageLayerMesh(farForestLayers.conifer)
      farForestLayers = null
    }
    farForestInstances = 0
    farForestRadius = 0
    farForestAnchorX = Number.NaN
    farForestAnchorZ = Number.NaN
    farForestScan = null
  }

  /** 确保两个物种层的网格存在且容量够用（不够才重建；足够时原地复用）。 */
  function ensureFarForestLayers(broadleafCount: number, coniferCount: number, budget: number): void {
    const capacity = Math.max(64, Math.ceil(budget * FAR_FOREST_SPECIES_CAPACITY_FACTOR))
    const broadleafCapacity = Math.max(broadleafCount, capacity)
    const coniferCapacity = Math.max(coniferCount, capacity)
    const existing = farForestLayers
    if (
      existing
      && getFoliageLayerCapacity(existing.broadleaf) >= broadleafCapacity
      && getFoliageLayerCapacity(existing.conifer) >= coniferCapacity
    ) {
      return
    }
    if (existing) {
      disposeFoliageLayerMesh(existing.broadleaf)
      disposeFoliageLayerMesh(existing.conifer)
    }
    if (!farForestRoot) {
      farForestLayers = null
      return
    }
    const handleConifer = getFoliageMaterialHandle(farForestMaterialSpec(1))
    const handleBroadleaf = getFoliageMaterialHandle(farForestMaterialSpec(0))
    farForestLayers = {
      broadleaf: createFoliageLayerMesh([], handleBroadleaf.material, TREE_UNIT_SIZE, hostObject ? hostInverse : null, {
        billboard: true,
        capacity: broadleafCapacity,
      }),
      conifer: createFoliageLayerMesh([], handleConifer.material, TREE_UNIT_SIZE, hostObject ? hostInverse : null, {
        billboard: true,
        capacity: coniferCapacity,
      }),
    }
    farForestRoot.add(farForestLayers.broadleaf)
    farForestRoot.add(farForestLayers.conifer)
  }

  /** 远景树材质：与分块远景 imposter 层共用同一 key（同材质/同雾/同换季通道）。 */
  function farForestMaterialSpec(species: 0 | 1): FoliageMaterialSpec {
    return {
      kind: 'tree',
      tier: 'far',
      species,
      singlePlane: true,
      tint: 0xffffff,
      farTintScale: 1,
      hasAlphaTexture: false,
      hasNormalTexture: true,
      card: 'far',
      distanceAlpha: false,
      useDensityShadow: false,
      key: `tree:far:${species}`,
    }
  }

  function toFarForestInstance(placement: TreePlacement): FoliageSpriteInstance {
    const regionIndex = findRegionIndex(IMPOSTER_REGIONS, placement.variant)
    const region = IMPOSTER_REGIONS[regionIndex] ?? null
    return {
      x: placement.x,
      y: placement.y,
      z: placement.z,
      rotation: placement.rotation,
      // TreePlacement.scale 是米：换算成 8m 基准倍率（与近/远景卡层同一契约）。
      scale: placement.scale / TREE_UNIT_SIZE,
      region,
      cell: Math.min(3, regionIndex % 4),
      roadProx: 0,
    }
  }

  /** 扫描完成：按预算产出实例并就地重写两个物种层。 */
  function applyFarForestScanResult(): void {
    const scan = farForestScan
    farForestScan = null
    if (!scan || !farForestRoot) {
      return
    }
    const result = collectFarForestPlacements(scan)
    const broadleaf: FoliageSpriteInstance[] = []
    const conifer: FoliageSpriteInstance[] = []
    for (const placement of result.placements) {
      const target = placement.species === 1 ? conifer : broadleaf
      target.push(toFarForestInstance(placement))
    }
    ensureFarForestLayers(broadleaf.length, conifer.length, result.budget)
    const layers = farForestLayers
    if (!layers) {
      farForestInstances = 0
      farForestRadius = 0
      return
    }
    const broadleafWritten = updateFoliageLayerMesh(
      layers.broadleaf,
      broadleaf,
      TREE_UNIT_SIZE,
      hostObject ? hostInverse : null,
      { billboard: true },
    )
    const coniferWritten = updateFoliageLayerMesh(
      layers.conifer,
      conifer,
      TREE_UNIT_SIZE,
      hostObject ? hostInverse : null,
      { billboard: true },
    )
    farForestInstances = broadleafWritten + coniferWritten
    farForestRadius = scan.params.outerRadius
  }

  function startFarForestScan(tier: { radius: number; budget: number }, camera: THREE.Vector3): void {
    if (!grid || !densityField) {
      return
    }
    const qualityTier = PROCEDURAL_LANDSCAPE_QUALITY_TIERS[resolveQuality()]
    // dissolve 区间与近树卡距离同源：换档/改近树卡距离后远景 imposter 的
    // 淡入淡出必须跟着走（与分块远景层共用同一材质句柄）。
    applyCardDissolveRange(getFoliageMaterialHandle(farForestMaterialSpec(0)))
    applyCardDissolveRange(getFoliageMaterialHandle(farForestMaterialSpec(1)))
    farForestAnchorX = camera.x
    farForestAnchorZ = camera.z
    farForestScan = createFarForestScan({
      seed: props.seed,
      centerX: camera.x,
      centerZ: camera.z,
      innerRadius: qualityTier.viewDistance,
      outerRadius: tier.radius,
      budget: tier.budget,
      maxSlope: props.forest.maxSlope,
      roadClearance: roadHalfWidth(props) + props.road.shoulderWidth + resolveForestRoadClearance(),
      waterLevel: resolveWaterLevel(),
      minScale: props.forest.minScale,
      maxScale: props.forest.maxScale,
      densityMultiplier: qualityTier.densityMultiplier,
    })
  }

  /**
   * 每帧推进远景林：档位/签名变化或相机离开锚点（> 800m）时重扫，
   * 扫描按采样预算摊薄到多帧；扫完前旧的环保持可见（双缓冲，不闪烁）。
   */
  function updateFarForest(camera: THREE.Vector3): void {
    const tier = resolveFarForestTier()
    if (!tier) {
      if (farForestLayers || farForestScan) {
        disposeFarForestRing()
      }
      farForestSignature = ''
      return
    }
    ensureRoots()
    if (!farForestRoot) {
      return
    }
    const signature = resolveFarForestSignature()
    const anchorMoved = !Number.isFinite(farForestAnchorX)
      || Math.hypot(camera.x - farForestAnchorX, camera.z - farForestAnchorZ) > FAR_FOREST_REANCHOR_DISTANCE
    if (signature !== farForestSignature || (anchorMoved && !farForestScan)) {
      farForestSignature = signature
      startFarForestScan(tier, camera)
    }
    if (farForestScan && grid && densityField) {
      const done = stepFarForestScan(
        farForestScan,
        { grid, density: densityField, roadField: roadProximity },
        FAR_FOREST_SCAN_SAMPLES_PER_FRAME,
      )
      if (done) {
        applyFarForestScanResult()
      }
    }
  }

  function resetAll(): void {
    disposeSurfaceState()
    disposeWorldState()
    disposeWaterAndBarrier()
    disposeFarForestRing()
    disposeDemMesh()
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
    if (
      kind === 'translation'
      && usesDemTerrain()
      && demGridData
      && stats.demStatus === 'ready'
    ) {
      // The DEM mesh is a child of the host and already moved with it. Refresh
      // only the world-space height grid so roads/vegetation follow the node.
      const world = new THREE.Vector3().setFromMatrixPosition(hostObject.matrixWorld)
      grid = createDemTerrainHeightGrid(demGridData, world.x, world.z, world.y)
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

  /**
   * Hand-drawn guide path for the road trace: node-local XZ waypoints are
   * transformed into world XZ (the height grid lives in world space).
   * Fewer than two points = no guide path, and the road is skipped entirely.
   */
  function resolveRoadWaypointsWorld(): RoadWaypoint[] {
    const waypoints = activeRoadWaypoints(props)
    if (waypoints.length < 2 || !hostObject) {
      return []
    }
    hostObject.updateMatrixWorld(true)
    return transformRoadWaypointsToWorld(hostObject.matrixWorld, waypoints)
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

  function buildWorld(): void {
    if (!grid) {
      return
    }
    // The previous roadbed is a surface mesh under the host; remove it before
    // resolving terrain triangles so it cannot be mistaken for raw DEM.
    disposeDemRoadbed()
    const activeGrid = grid
    const bounds = { minX: grid.minX, minZ: grid.minZ, sizeX: grid.maxX - grid.minX, sizeZ: grid.maxZ - grid.minZ }
    densityField = buildForestDensityField({
      ...bounds,
      seed: props.seed,
      seedOffset: props.forest.seedOffset,
      scale: props.forest.scale,
      coverage: props.forest.coverage,
    })
    variationField = buildVariationField({ ...bounds, seed: props.seed, scale: props.forest.scale })
    forestMaskTexture?.dispose()
    forestMaskTexture = createDensityDataTexture(densityField)
    variationTexture?.dispose()
    variationTexture = createDensityDataTexture(variationField)

    roadFieldTexture?.dispose()
    roadFieldTexture = null
    roadResult = null
    roadFieldData = null
    roadEdgeHeights = null
    roadCenterHeights = null
    roadBandRows = null
    roadBandColumns = null
    roadSurfaceSampler = null
    roadProximity = null
    roadBucketTable = []

    // 道路完全由手绘路径生成：不足 2 个路径点时不建路，初始化与清空路径后
    // 都保持无道路状态（等价于关闭公路开关）。追踪器自身的无路径回退分支
    //（startX/startZ/headingRad）由此不再被组件触发。
    const waypointWorld = resolveRoadWaypointsWorld()
    if (props.road.enabled && waypointWorld.length >= 2) {
      let traceWaypoints = waypointWorld
      if (waypointWorld.length === 2) {
        const planned = planEndpointRoadGuide(grid, waypointWorld[0]!, waypointWorld[1]!, {
          maxDeviation: props.road.pathDeviation,
          roadHalfWidth: roadHalfWidth(props),
          shoulderWidth: props.road.shoulderWidth,
          maxSlope: props.road.maxSlope,
          seed: props.seed,
        })
        if (planned.warning) {
          warn(planned.warning)
        }
        traceWaypoints = planned.guide
      }
      // 起点取自路径首点，初始朝向取自首点到次点的走向；首两点重合时
      // traceRoadPath 回退到下面传入的种子朝向。
      roadResult = traceRoadPath(grid, {
        startX: waypointWorld[0]!.x,
        startZ: waypointWorld[0]!.z,
        headingRad: resolveSeedHeadingRad(props.seed),
        waypoints: traceWaypoints,
        waypointTolerance: waypointWorld.length === 2 ? 4 : props.road.waypointTolerance,
        stepLength: props.road.stepLength,
        feelDistance: props.road.feelDistance,
        feelAngleRad: roadFeelAngleRad(props),
        maxSlope: props.road.maxSlope,
        maxTurnRad: degreesToRadians(props.road.maxTurnDeg),
        maxLength: props.road.maxLength,
        margin: Math.max(grid.cellSize * 2, roadHalfWidth(props) + props.road.shoulderWidth + 2),
      })
      if (waypointWorld.length === 2 && roadResult.nodes.length > 1) {
        const end = waypointWorld[1]!
        const last = roadResult.nodes[roadResult.nodes.length - 1]!
        const endY = grid.sampleHeight(end.x, end.z)
        if (endY != null) {
          const previous = roadResult.nodes[roadResult.nodes.length - 2]!
          last.x = end.x
          last.z = end.z
          last.y = endY
          last.heading = Math.atan2(end.z - previous.z, end.x - previous.x)
        }
      }
      if (roadResult.nodes.length > 1) {
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
        const influence = Math.max(48, props.road.flattenBand + 8, roadHalfWidth(props) + props.road.shoulderWidth + props.grass.corridorWidth + 8)
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
        if (usesDemTerrain() && hostObject && roadBandRows) {
          const sideWidth = Math.max(12, activeGrid.cellSize * 0.75)
          const coverageWidth = Math.max(4, activeGrid.cellSize * 0.25)
          const roadbed = createDemRoadbedGeometry({
            rows: roadBandRows,
            halfWidth,
            shoulderWidth: props.road.shoulderWidth,
            sideWidth,
            coverageWidth,
            lateralStep: Math.max(2, Math.min(6, activeGrid.cellSize * 0.1)),
            roadDrop: 0.02,
            edgeDrop: 0.06,
            rawHeightAt: sampledSurfaceHeightAt,
            hostInverse,
          })
          if (roadbed) {
            const mesh = new THREE.Mesh(
              roadbed.geometry,
              new THREE.MeshLambertMaterial({ color: 0xffffff }),
            )
            mesh.name = `slowroads-dem-roadbed-${hooks.nodeId}`
            mesh.userData.proceduralLandscapeDemRoadbed = true
            hostObject.add(mesh)
            demRoadbedMesh = mesh
            demRoadbedHalfWidth = roadbed.meshHalfWidth
          }
        }
      }
      if (roadResult.nodes.length <= 1 || !roadFieldData) {
        if (!roadWarningEmitted) {
          roadWarningEmitted = true
          warn(`road-trace-failed:${roadResult.failureReason ?? 'unknown'}`)
        }
      } else if (!roadResult.complete && roadResult.failureReason === 'blocked') {
        warn('road-blocked-before-boundary')
      }
    }
    if (!roadFieldTexture) {
      roadFieldTexture = createEmptyRoadFieldTexture()
    }

    buildRoadBand()
    applySceneViewDistanceScale()
    applyStaticSurfaceUniforms()
    barrierSignature = resolveBarrierSignature()
    buildWalls()
    buildWater()
    releaseAllBatches()
    dirty.instances = true
    forceStream = true
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
    console.info(`[slowroads] shader audits (${audits.length}): ${signature}`)
    if (signature === lastAuditSignature && audits.length > 1) {
      selfChecksDone = true
    } else {
      lastAuditSignature = signature
    }
    lastSelfCheckAt = elapsedMs
    const seasonResults = seasonChecksRun ? [] : runSlowroadsSeasonChecks()
    if (!seasonChecksRun) {
      seasonChecksRun = true
      reportSlowroadsSelfChecks('season', seasonResults)
    }
    const uniformResults = runMaterialUniformCoverageChecks(
      audits.map((audit) => ({
        name: audit.name,
        vertexShader: audit.vertexShader,
        fragmentShader: audit.fragmentShader,
        uniformKeys: audit.uniformKeys,
      })),
    )
    reportSlowroadsSelfChecks('uniform', uniformResults)
    const treeResults = runTreeDiscolourationShaderChecks(
      audits.map((audit) => ({
        name: audit.name,
        vertexShader: audit.vertexShader,
        fragmentShader: audit.fragmentShader,
      })),
    )
    reportSlowroadsSelfChecks('tree-discolouration', treeResults)
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
    const flatten = roadFlattenParams(props)
    const roadField = roadFieldData
    const waterLevel = resolveWaterLevel()
    const activeGrid = grid
    const sampleRoad = createRoadAlongSampler(roadResult.nodes)
    const wallProbe = {
      length: roadResult.length,
      halfWidth: roadHalfWidth(props),
      waterLevel,
      terrainHeightAt: (x: number, z: number): number => activeGrid.sampleHeight(x, z) ?? waterLevel,
      surfaceHeightAt: (x: number, z: number): number => {
        const terrainY = activeGrid.sampleHeight(x, z)
        if (terrainY == null || !roadField || flatten.strength <= 0) {
          return terrainY ?? waterLevel
        }
        const distance = roadField.distanceAt(x, z)
        const weight = 1 - smoothstep(flatten.innerRadius, flatten.outerRadius, distance)
        if (weight <= 0.001) {
          return terrainY
        }
        const roadHeight = roadField.heightAt(x, z)
        if (roadHeight == null) {
          return terrainY
        }
        return terrainY + (roadHeight - terrainY) * weight * flatten.strength
      },
      sampleRoad,
      shadowAt: (x: number, z: number): number => {
        if (!densityField) {
          return 0
        }
        return forestDensityClassAt(densityField, x, z) / 3
      },
    }
    wallSegments = computeWallSegments(wallProbe, roadResult.nodes, {
      seed: props.seed,
      roadWidth: roadHalfWidth(props) * 2,
      density: props.walls.drystone.density,
      detail: 3,
      style: ROAD_STYLE_PROFILES[DEFAULT_ROAD_STYLE],
    })
    stats.wallSegmentCount = wallSegments.length
    if (!wallSegments.length) {
      return
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
   * 水面（lab water.ts）：世界空间水平面，水线 = 地形最低点 + water.levelOffset。
   *
   * 幂等：季节素材（sea_waves）尚未加载完成时**不**动已有水面（素材到达后由
   * `applySeasonToMaterials` 再调一次补建/换贴图），避免「世界构建早于素材加载 →
   * 水面永不创建」的竞态；尺寸没变时原地更新贴图/水位，不做重建。
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
      return
    }
    const size = Math.max(1, Math.max(grid.maxX - grid.minX, grid.maxZ - grid.minZ) * 1.5)
    const centerX = (grid.minX + grid.maxX) * 0.5
    const centerZ = (grid.minZ + grid.maxZ) * 0.5
    const waterLevel = resolveWaterLevel()
    if (waterPlane && Math.abs(waterPlane.worldSize - size) <= 1e-3) {
      waterPlane.setWavesTexture(waves)
      waterPlane.setWaterLevel(waterLevel)
      waterPlane.mesh.position.x = centerX
      waterPlane.mesh.position.z = centerZ
      waterPlane.setVisible(true)
      return
    }
    waterPlane?.dispose()
    waterPlane = createWaterPlane({ worldSize: size, waterLevel, waves })
    waterPlane.mesh.position.x = centerX
    waterPlane.mesh.position.z = centerZ
    tagArtifact(waterPlane.mesh)
    sceneRoot.add(waterPlane.mesh)
    waterPlane.setVisible(true)
  }

  /**
   * 水线诊断：统计水线以下的地形面积占比。
   * 偏移为 0 时水线 = 地形最低点 → 水面只与最低点相切、被地形整体遮住
   * （用户实测「看不到任何水面」），占比 ≈0 时面板给出提高水线偏移的提示。
   */
  function refreshWaterFloodStats(): void {
    if (!grid) {
      waterFloodStats = null
      return
    }
    waterFloodStats = computeWaterFloodStats(grid, resolveWaterLevel())
    if (props.water.enabled && waterFloodStats.floodedFraction < WATER_FLOOD_VISIBLE_FRACTION) {
      // 水线 = 地形最低点 + 偏移：偏移 0 时水面只与最低点相切、被地形整体遮住。
      warn('water-buried-by-terrain')
    } else {
      // 调高水线偏移（或关掉水面）后这条告警不再成立，别留在面板里误导。
      unwarn('water-buried-by-terrain')
    }
  }

  function buildRoadBand(): void {
    roadBand?.dispose()
    roadBand = null
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
    uniforms.uPlWaterLevel.value = grid.minY
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
    uniforms.uPlShowTextures.value = props.surface.textures && seasonAssets ? 1 : 0
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
    uniforms.uPlFlattenInner.value = flatten.innerRadius
    uniforms.uPlFlattenOuter.value = flatten.outerRadius
    uniforms.uPlFlattenStrength.value = flatten.strength
    uniforms.uPlSurfaceStrength.value = props.surface.enabled ? props.surface.blendStrength : 0
    uniforms.uPlBaseMapBlend.value = props.surface.baseMapMode === 'blend' ? props.surface.baseMapBlend : 0
    uniforms.uPlUvScale.value = props.surface.uvScale
    uniforms.uPlGrassTint.value.set(props.surface.grassTint)
    uniforms.uPlForestTint.value.set(props.surface.forestTint)
    uniforms.uPlRoadTint.value.set(props.surface.roadTint)
    uniforms.uPlGravelTint.value.set(props.surface.gravelTint)
    uniforms.uPlRockSlope.value = props.surface.rockSlopeThreshold
    uniforms.uPlShowCanopy.value = props.canopy.enabled ? 1 : 0
    // Keep the palette path until the seasonal set is complete; otherwise the
    // transparent placeholder would render the terrain black while loading.
    uniforms.uPlShowTextures.value = props.surface.textures && seasonAssets ? 1 : 0
    uniforms.uPlFresnelIntensity.value = appliedLighting.fresnel
    foliageUniforms.meshRadius.value = resolveNearTreeRadius()
    // 近树卡/远景树的切分层级距离与 dissolve 区间同源（lab：lod1Horizon 由近树卡距离推出）。
    foliageUniforms.nearDistance.value = props.forest.nearDistance
      ?? PROCEDURAL_LANDSCAPE_QUALITY_TIERS[resolveQuality()].treeNearDistance
    if (waterPlane) {
      waterPlane.setWaterLevel(resolveWaterLevel())
      waterPlane.setVisible(props.water.enabled)
    }
    if (barrierLayer) {
      barrierLayer.visible = props.walls.fence.enabled
    }
    roadBand?.setVisible(props.road.enabled)
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
    // 近树 3D 网格是 lab/官方观感的一部分（编辑器 / 预览 / 查看器三端一致）；
    // 只有最低画质档（最弱设备）关闭，其余档位使用场景里配置的半径。
    if (resolveQuality() === 'low') {
      return 0
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
        if (handle.spec.tier === 'near') {
          if (handle.spec.species === 0) {
            setFoliageMaterialTextures(handle, {
              atlas: pick(entry.trees.broadleafD.id),
              normal: pick(entry.trees.broadleafN.id),
              noise: pick(SHARED_TEXTURES.noise.id),
              grassVariation: pick(SHARED_TEXTURES.grassVariation.id),
              detailFar: pick(entry.surface.detailFar.id),
              cardNoise,
              densityMap,
              densityMin,
              densitySize,
            })
          } else {
            setFoliageMaterialTextures(handle, {
              atlas: pick(entry.trees.coniferM.id),
              alpha: pick(entry.trees.coniferA.id),
              noise: pick(SHARED_TEXTURES.noise.id),
              grassVariation: pick(SHARED_TEXTURES.grassVariation.id),
              detailFar: pick(entry.surface.detailFar.id),
              cardNoise,
              densityMap,
              densityMin,
              densitySize,
            })
          }
        } else if (handle.spec.species === 0) {
          setFoliageMaterialTextures(handle, {
            atlas: pick(entry.imposters.mapA.id),
            normal: pick(entry.imposters.normA.id),
            noise: pick(SHARED_TEXTURES.noise.id),
            grassVariation: pick(SHARED_TEXTURES.grassVariation.id),
            detailFar: pick(entry.surface.detailFar.id),
            cardNoise,
            densityMap: null,
            densityMin,
            densitySize,
          })
        } else {
          setFoliageMaterialTextures(handle, {
            atlas: pick(entry.imposters.mapB.id),
            normal: pick(entry.imposters.normB.id),
            noise: pick(SHARED_TEXTURES.noise.id),
            grassVariation: pick(SHARED_TEXTURES.grassVariation.id),
            detailFar: pick(entry.surface.detailFar.id),
            cardNoise,
            densityMap: null,
            densityMin,
            densitySize,
          })
        }
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
    const cardDissolveFar = Math.max(40, nearDistance)
    const cardDissolveInterval = Math.max(1, Math.floor(cardDissolveFar * CARD_DISSOLVE_INTERVAL_FACTOR))
    const cardDissolveNear = cardDissolveFar - cardDissolveInterval
    if (handle.spec.card === 'near') {
      setFoliageMaterialCardRange(handle, {
        near: cardDissolveNear,
        far: cardDissolveFar,
        interval: cardDissolveInterval,
      })
    } else if (handle.spec.card === 'far') {
      const imposterDissolveFar = cardDissolveNear + cardDissolveInterval * 0.6
      const imposterDissolveNear = Math.max(1, imposterDissolveFar - cardDissolveInterval)
      setFoliageMaterialCardRange(handle, {
        near: imposterDissolveNear,
        far: imposterDissolveFar,
        interval: cardDissolveInterval,
      })
    }
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
    const season = seasonAssetsSeason ?? currentSeason
    const spec: FoliageMaterialSpec = {
      kind: 'tree',
      tier,
      species,
      singlePlane: tier === 'far',
      tint: 0xffffff,
      farTintScale: 1,
      hasAlphaTexture: tier === 'near' && species === 1,
      hasNormalTexture: tier === 'near' ? species === 0 : true,
      // 近树卡 = 动态 alpha + 距离 dissolve（由 forest.nearDistance 推出）；
      // 远景树 = 朝相机广告牌（16 朝向列 + 角度混列）。
      card: tier === 'near' ? 'near' : 'far',
      distanceAlpha: false,
      // 近树卡用密度树影近似官方 per-instance shadow；远景树不采样密度图。
      useDensityShadow: tier === 'near',
      key: `tree:${tier}:${species}`,
    }
    const handle = getFoliageMaterialHandle(spec)
    applyCardDissolveRange(handle)
    const regions = tier === 'near'
      ? (species === 0 ? BROADLEAF_CARD_REGIONS : getConiferCardRegions(season))
      : IMPOSTER_REGIONS
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
        cell: Math.min(3, regionIndex % 4),
        roadProx: 0,
      }
    })
    const mesh = createFoliageLayerMesh(instances, handle.material, TREE_UNIT_SIZE, hostObject ? hostInverse : null)
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
      distanceAlpha: kind === 'bush',
      useDensityShadow: true,
      key: `${kind}:all`,
    }
    const handle = getFoliageMaterialHandle(spec)
    const entries = kind === 'grass' ? getGrassEntries(season) : getBushEntries(season).filter((item) => item.cell <= 2)
    // 草丛/灌木的 placement.scale 是 slowroads-lab 语义的摆放倍率（不是米）：
    // 世界尺寸 = 基准尺寸（草 1.6m / 灌木 2m，见下方 unit）× 倍率 × 区域相对高度。
    const instances: FoliageSpriteInstance[] = placements.map((placement) => {
      const picked = pickCellEntry(entries, placement.variant)
      // 官方 per-instance groundNormal：草丛/灌木受光与掠射 fresnel 都由它驱动。
      const normal = grid?.sampleNormal(placement.x, placement.z) ?? null
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
        densityMultiplier: props.forest.density,
        maxSlope: props.forest.maxSlope,
        roadClearance: resolveForestRoadClearance(),
        roadHalfWidth: roadHalfWidth(props),
        roadShoulderWidth: props.road.shoulderWidth,
        minScale: props.forest.minScale,
        maxScale: props.forest.maxScale,
        minHeight: props.forest.minHeight,
      },
      { grid, density: densityField, roadField: roadProximity },
    )
    const kept = takeDensityPrefix(placements, tier.densityMultiplier)
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
      { grid, density: densityField, roadField: roadProximity },
    )
    const grass = grassEnabled ? takeDensityPrefix(result.grass, tier.densityMultiplier) : []
    const bushes = bushesEnabled ? takeDensityPrefix(result.bushes, tier.densityMultiplier) : []
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
          { grid, density: densityField, roadField: roadProximity },
        ))
      }
    }
    const kept = takeDensityPrefix(placements, tier.densityMultiplier)
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

    // Trees.
    {
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
      const corridorRadius = tier.grassRadius + props.grass.corridorWidth + ROAD_BUCKET_LENGTH
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
      treeMeshManager.update(camera, collectActiveTreePlacements(), radius, forceStream)
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
    surfacePatch = applyProceduralLandscapeSurfaceInjection(surfaceMeshes, uniforms)
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
    // The GLB aerial base map is only sampled in blend mode; the default
    // replace mode (and a disabled surface) fully takes over the shading, so
    // the external imagery pack can be skipped entirely in those modes.
    stream.setBaseMapStreamingEnabled(
      enabled && props.surface.enabled && props.surface.baseMapMode === 'blend',
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
    stats.roadLength = roadResult?.length ?? 0
    stats.roadNodeCount = roadResult?.nodes.length ?? 0
    stats.roadComplete = roadResult?.complete ?? false
    stats.roadFailureReason = roadResult?.failureReason ?? null
    stats.season = currentSeason
    stats.seasonAssetsReady = seasonAssetsSeason === currentSeason && Boolean(seasonAssets)
    stats.nearTreeInstances = treeMeshManager?.instanceCount ?? 0
    const storeStats = assetStore.stats()
    stats.assetTextureCount = storeStats.textureCount
    stats.assetResidentBytes = storeStats.residentBytes
    stats.assetDownloadedBytes = storeStats.downloadedBytes
    stats.assetVariant = storeStats.variant
    stats.barrierInstances = barrierInstances
    stats.wallSegmentCount = wallSegments.length
    stats.farTreeInstances = farForestInstances
    stats.farForestRadius = farForestRadius
    stats.waterEnabled = Boolean(waterPlane && waterPlane.mesh.visible)
    stats.waterLevel = grid ? resolveWaterLevel() : 0
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
      installSurfaceInjection()
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
  async function loadSeasonAssets(season: SeasonId): Promise<void> {
    if (seasonLoadInFlight && seasonAssetsSeason === season) {
      return
    }
    const token = ++seasonLoadToken
    seasonLoadInFlight = true
    const refs = [...collectSeasonTextureRefs(season), ...Object.values(SHARED_TEXTURES)]
    try {
      const textures = await assetStore.textureSet(refs)
      if (disposed || token !== seasonLoadToken) {
        return
      }
      // 失败保持原季（lab 语义）：缺文件的键用旧贴图兜底，整季全失败则保留旧季。
      const merged = new Map<string, THREE.Texture>(seasonAssets ?? undefined)
      for (const [id, texture] of textures) {
        merged.set(id, texture)
      }
      const required = collectSeasonTextureRefs(season)
      const missing = required.filter((ref) => !merged.has(ref.id))
      seasonAssets = merged
      seasonAssetsSeason = season
      if (missing.length) {
        warn(`season-assets-incomplete:${season}:${missing.length}`)
      }
      const storeStats = assetStore.stats()
      for (const message of storeStats.warnings.slice(0, 3)) {
        warn(`asset:${message}`)
      }
      assetStore.prune(slowroadsSharedRetainIds(required))
      applySeasonToMaterials(season)
    } catch (error) {
      warn(`season-load-failed:${season}:${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (token === seasonLoadToken) {
        seasonLoadInFlight = false
      }
    }
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
    currentSeason = next
    void loadSeasonAssets(next)
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
      // DEM world rebuilds (road edits, host translation) create a fresh
      // roadbed mesh; re-inject the seasonal surface so it is not left white.
      if (usesDemTerrain()) {
        installSurfaceInjection()
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
      if (needsStreaming(camera, elapsedMs)) {
        lastStreamAt = elapsedMs
        lastStreamCamera.copy(camera)
        forceStream = false
        foliageUniforms.cameraPosition.value.copy(camera)
        // 预算用尽但仍有余量任务时继续请求后续帧，直到视野内植被补齐。
        forceStream = streamBatches(camera)
      }
      updateTreeMeshes(camera)
    }
    if (camera && grid) {
      updateFarForest(camera)
    }
    waterPlane?.update()
    if (chunkDebugDirty) {
      chunkDebugDirty = false
      rebuildChunkDebugLines()
    }
    runLandscapeSelfChecks()
    updateStats()
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
      props = clampProceduralLandscapeProps(next, hooks.nodeId)
      const keys = {
        grid: jsonKey(props.sampling),
        dem: jsonKey([props.dem.assetId, props.dem.runtimeGridUrl, props.dem.sampleStep]),
        world: jsonKey([props.seed, props.generationRevision, props.road, props.forest.coverage, props.forest.scale, props.forest.seedOffset]),
        instances: jsonKey([props.forest, props.grass, props.bushes, props.quality]),
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
        roadDebug: jsonKey(props.debug.showRoadPath),
        chunkDebug: jsonKey(props.debug.showChunks),
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
      if (dirty.grid || keys.world !== previousKeys.world) {
        dirty.world = true
        roadWarningEmitted = false
      }
      if (dirty.grid || dirty.world || keys.instances !== previousKeys.instances) {
        dirty.instances = true
        forceStream = true
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
      if (!enabled) {
        releaseAllBatches()
      } else {
        forceStream = true
      }
      syncTerrainTextureStreamGate()
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
    sampleTerrainHeight(worldX: number, worldZ: number): number | null {
      if (!grid) {
        return null
      }
      return grid.sampleHeight(worldX, worldZ)
    },
  }
  runtimeRegistry.set(hooks.nodeId, runtime)
  return runtime
}
