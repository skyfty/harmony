import * as THREE from 'three'
import { buildForestDensityField, buildVariationField, createDensityDataTexture, type LandscapeDensityField } from './densityField'
import {
  createTerrainGridBuilder,
  type TerrainGridBuilder,
  type TerrainHeightGrid,
  type TerrainMeshSource,
  collectTerrainMeshSources,
} from './terrainSampler'
import { resolveSeedHeadingRad, traceRoadPath, type RoadTraceNode, type RoadTraceResult } from './roadTrace'
import { buildRoadFieldData, createRoadFieldTexture, type RoadFieldData } from './roadField'
import { planCameraGrassChunk, planRoadBucket, planTreeChunk, takeDensityPrefix, type GrassPlacement, type TreePlacement } from './chunkPlan'
import {
  applyFoliageMaterialSeason,
  createFoliageLayerMesh,
  createFoliageMaterial,
  createFoliageShaderUniforms,
  disposeFoliageLayerMesh,
  setFoliageMaterialTextures,
  type FoliageMaterialHandle,
  type FoliageMaterialSpec,
  type FoliageShaderUniforms,
  type FoliageSpriteInstance,
} from './instancing'
import {
  applyProceduralLandscapeSurfaceInjection,
  createProceduralLandscapeSurfaceUniforms,
  type ProceduralLandscapeSurfacePatch,
} from './surfaceMaterial'
import { createRoadBand, type RoadBandHandle } from './roadBand'
import { createTreeMeshManager, type TreeMeshManager } from './treeMeshes'
import { getSharedSlowroadsAssetStore, slowroadsSharedRetainIds, type SlowroadsAssetStore } from '../slowroads/assets/assetStore'
import {
  collectSeasonTextureRefs,
  SEASON_CATALOG,
  SHARED_TEXTURES,
  type SeasonId,
} from '../slowroads/core/seasonCatalog'
import { SEASON_PARAMS } from '../slowroads/core/seasonParams'
import {
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
import { clamp, degreesToRadians, hashUnit, lerp } from './noise'
import {
  clampProceduralLandscapeProps,
  PROCEDURAL_LANDSCAPE_QUALITY_TIERS,
  resolveProceduralLandscapeQuality,
  roadFlattenParams,
  roadFeelAngleRad,
  roadHalfWidth,
  type ProceduralLandscapeComponentProps,
  type ProceduralLandscapeEnvironment,
  type ResolvedProceduralLandscapeQuality,
} from './config'

const TREE_BATCH_RELEASE_PADDING = 48
const ROAD_BUCKET_LENGTH = 16
const CAMERA_GRASS_BATCH_SIZE = 32
const CAMERA_GRASS_CELL_SIZE = 8
const STREAM_INTERVAL_MS = 200
const STREAM_MOVE_THRESHOLD = 8
const ROAD_FIELD_RESOLUTION = 1024
const DEBUG_ROAD_HEIGHT_OFFSET = 0.6
const SOURCE_CHECK_INTERVAL_MS = 500
const TREE_UNIT_SIZE = 8
const GRASS_UNIT_SIZE = 1.6
const BUSH_UNIT_SIZE = 2
const IMPOSTER_REGIONS: SpriteRegion[] = gridRegions(16, 4, 4096, 1024)
/** 远景树环：相机移动超过该距离后重建（相机锚定，保证视野内始终有树）。 */
const FAR_TREE_REANCHOR_DISTANCE = 800
/** 远景树环外缘相对视距的倍数与内缘系数（内缘略早于分块视距，避免接缝）。 */
const FAR_TREE_RING_INNER_FACTOR = 0.92
const FAR_TREE_RING_OUTER_FACTOR = 2.4
/** 远景树随距离放大的增益：远处 imposter 按比例放大，弥补透视缩小导致的"看不见森林"。 */
const FAR_TREE_SCALE_GAIN = 0.9

let sharedPlaceholderTexture: THREE.DataTexture | null = null

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
  /** 远景全域树层实例数（分块流式之外的静态层）。 */
  farTreeInstances: number
}

export interface ProceduralLandscapeSeasonState {
  season: SeasonId
}

export interface ProceduralLandscapeRuntimeHooks {
  nodeId: string
  componentId: string
  getHostObject(): THREE.Object3D | null
  getCameraWorldPosition(): THREE.Vector3 | null
  /** 来自 ComponentFrameState.environment（EnvironmentPanel 设置）。 */
  getSeasonState(): ProceduralLandscapeSeasonState | null
}

export interface ProceduralLandscapeRuntime {
  attach(host: THREE.Object3D | null): void
  setProps(props: ProceduralLandscapeComponentProps): void
  setEnabled(enabled: boolean): void
  update(deltaTime: number): void
  dispose(): void
  getStats(): ProceduralLandscapeRuntimeStats
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
    world: jsonKey([props.seed, props.generationRevision, props.road, props.forest.coverage, props.forest.scale, props.forest.seedOffset]),
    instances: jsonKey([props.forest, props.grass, props.bushes, props.quality]),
    uniforms: jsonKey([props.surface, props.road.flattenBand, props.road.flattenStrength, props.grass.windEnabled]),
    roadDebug: jsonKey(props.debug.showRoadPath),
    chunkDebug: jsonKey(props.debug.showChunks),
  }
  const dirty: DirtyFlags = { grid: false, world: false, instances: false, uniforms: true }
  let forceStream = true
  let enabled = true
  let disposed = false
  let hostObject: THREE.Object3D | null = null
  let hostMatrixSnapshot: THREE.Matrix4 | null = null
  let foliageRoot: THREE.Group | null = null
  let debugRoot: THREE.Group | null = null
  let gridBuilder: TerrainGridBuilder | null = null
  let grid: TerrainHeightGrid | null = null
  let densityField: LandscapeDensityField | null = null
  let variationField: LandscapeDensityField | null = null
  let forestMaskTexture: THREE.DataTexture | null = null
  let variationTexture: THREE.DataTexture | null = null
  let roadResult: RoadTraceResult | null = null
  let roadFieldData: RoadFieldData | null = null
  let roadFieldTexture: THREE.DataTexture | null = createEmptyRoadFieldTexture()
  let roadBucketTable: RoadBucketEntry[] = []
  let surfacePatch: ProceduralLandscapeSurfacePatch | null = null
  let surfaceMeshes: THREE.Mesh[] = []
  let roadBand: RoadBandHandle | null = null
  let treeMeshManager: TreeMeshManager | null = null
  let treeMeshInitStarted = false
  let farTreeRoot: THREE.Group | null = null
  let farTreeLayers: THREE.InstancedMesh[] = []
  let farTreeSignature = ''
  let farTreeInstances = 0
  let farTreeCenterX = Number.NaN
  let farTreeCenterZ = Number.NaN
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
  let currentTerrainSourceSignature = 'unresolved'
  let lastSourceCheckAt = Number.NEGATIVE_INFINITY

  // ---- 季节素材状态 ----
  let currentSeason: SeasonId = hooks.getSeasonState()?.season ?? 'spring'
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
    farTreeInstances: 0,
  }
  statsRegistry.set(hooks.nodeId, stats)

  function warn(message: string): void {
    if (warnings.has(message)) {
      return
    }
    warnings.add(message)
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
    if (!farTreeRoot) {
      farTreeRoot = new THREE.Group()
      farTreeRoot.name = '__ProceduralLandscapeFarTrees'
      tagArtifact(farTreeRoot)
      hostObject.add(farTreeRoot)
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
    forestMaskTexture?.dispose()
    forestMaskTexture = null
    variationTexture?.dispose()
    variationTexture = null
    roadFieldTexture?.dispose()
    roadFieldTexture = createEmptyRoadFieldTexture()
    roadBand?.dispose()
    roadBand = null
    densityField = null
    variationField = null
    roadResult = null
    roadFieldData = null
    roadBucketTable = []
  }

  function resetAll(): void {
    disposeSurfaceState()
    disposeWorldState()
    disposeFarTreeRing()
    gridBuilder = null
    grid = null
  }

  function updateHostSnapshot(): void {
    if (!hostObject) {
      return
    }
    hostObject.updateMatrixWorld(true)
    hostMatrixSnapshot = hostObject.matrixWorld.clone()
    hostInverse.copy(hostObject.matrixWorld).invert()
  }

  const hostInverse = new THREE.Matrix4()

  function hostMatrixChanged(): boolean {
    if (!hostObject || !hostMatrixSnapshot) {
      return false
    }
    hostObject.updateMatrixWorld(true)
    const matrix = hostObject.matrixWorld
    for (let i = 0; i < 16; i += 1) {
      if (Math.abs(matrix.elements[i]! - hostMatrixSnapshot.elements[i]!) > 1e-6) {
        return true
      }
    }
    return false
  }

  function collectSurfaceMeshes(): THREE.Mesh[] {
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
      if (!(mesh.userData as Record<string, unknown>)[COMPONENT_ARTIFACT_KEY]) {
        meshes.push(mesh)
      }
    })
    return meshes
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
    roadBucketTable = []

    if (props.road.enabled) {
      const startX = props.road.startX ?? (grid.minX + grid.maxX) * 0.5
      const startZ = props.road.startZ ?? (grid.minZ + grid.maxZ) * 0.5
      const headingRad = props.road.headingDeg != null
        ? degreesToRadians(props.road.headingDeg)
        : resolveSeedHeadingRad(props.seed)
      roadResult = traceRoadPath(grid, {
        startX,
        startZ,
        headingRad,
        stepLength: props.road.stepLength,
        feelDistance: props.road.feelDistance,
        feelAngleRad: roadFeelAngleRad(props),
        maxSlope: props.road.maxSlope,
        maxTurnRad: degreesToRadians(props.road.maxTurnDeg),
        maxLength: props.road.maxLength,
        margin: Math.max(grid.cellSize * 2, roadHalfWidth(props) + props.road.shoulderWidth + 2),
      })
      if (roadResult.nodes.length > 1) {
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
        })
        if (roadFieldData) {
          roadFieldTexture = createRoadFieldTexture(roadFieldData)
          roadBucketTable = buildRoadBucketTable(roadResult.nodes, ROAD_BUCKET_LENGTH)
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
    applyStaticSurfaceUniforms()
    releaseAllBatches()
    dirty.instances = true
    forceStream = true
  }

  function buildRoadBand(): void {
    roadBand?.dispose()
    roadBand = null
    if (!roadResult || roadResult.nodes.length < 2 || !hostObject) {
      return
    }
    const season = seasonAssets ? seasonAssetsSeason ?? currentSeason : currentSeason
    const baseTexture = textureFor(SEASON_CATALOG[season].road.base.id) ?? getSharedPlaceholderTexture()
    const overlayRef = SEASON_CATALOG[season].road.overlay
    const overlayTexture = overlayRef ? textureFor(overlayRef.id) : null
    roadBand = createRoadBand({
      nodes: roadResult.nodes,
      halfWidth: roadHalfWidth(props),
      stepLength: 2,
      density: densityField,
      textures: { base: baseTexture, overlay: overlayTexture },
      season,
      hostInverse: hostObject ? hostInverse : null,
      // 粗网格地形（3dtiles 导出 GLB 平均 40m+ 三角面）无法精确表达 7m 路基
      // 压平，路面带会被地形三角面穿插；抬升量随源三角面尺寸自适应。
      lift: clamp(0.02 + (grid?.averageEdgeLength ?? 0) * 0.008, 0.02, 0.45),
    })
    roadBand.setVisible(props.road.enabled)
    tagArtifact(roadBand.mesh)
    hostObject.add(roadBand.mesh)
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
    foliageUniforms.meshRadius.value = resolveNearTreeRadius()
    roadBand?.setVisible(props.road.enabled)
    for (const handle of foliageMaterials.values()) {
      handle.uniforms.uPlWindStrength.value = props.grass.windEnabled
        ? (handle.spec.kind === 'grass' ? 0.12 : handle.spec.kind === 'bush' ? 0.07 : 0.03)
        : 0
    }
  }

  function resolveNearTreeRadius(): number {
    if (resolveQuality() !== 'high') {
      return 0
    }
    const tier = PROCEDURAL_LANDSCAPE_QUALITY_TIERS.high
    return props.forest.nearDistance ?? tier.treeNearDistance
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
    switch (handle.spec.kind) {
      case 'grass':
        setFoliageMaterialTextures(handle, {
          atlas: pick(entry.sprites.grassSprites.id),
          noise: pick(SHARED_TEXTURES.noise.id),
          grassVariation: pick(SHARED_TEXTURES.grassVariation.id),
          detailFar: pick(entry.surface.detailFar.id),
        })
        break
      case 'bush':
        setFoliageMaterialTextures(handle, {
          atlas: pick(entry.sprites.bushes.id),
          noise: pick(SHARED_TEXTURES.bushNoise.id),
          grassVariation: pick(SHARED_TEXTURES.grassVariation.id),
          detailFar: pick(entry.surface.detailFar.id),
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
            })
          } else {
            setFoliageMaterialTextures(handle, {
              atlas: pick(entry.trees.coniferM.id),
              alpha: pick(entry.trees.coniferA.id),
              noise: pick(SHARED_TEXTURES.noise.id),
              grassVariation: pick(SHARED_TEXTURES.grassVariation.id),
              detailFar: pick(entry.surface.detailFar.id),
            })
          }
        } else if (handle.spec.species === 0) {
          setFoliageMaterialTextures(handle, {
            atlas: pick(entry.imposters.mapA.id),
            normal: pick(entry.imposters.normA.id),
            noise: pick(SHARED_TEXTURES.noise.id),
            grassVariation: pick(SHARED_TEXTURES.grassVariation.id),
            detailFar: pick(entry.surface.detailFar.id),
          })
        } else {
          setFoliageMaterialTextures(handle, {
            atlas: pick(entry.imposters.mapB.id),
            normal: pick(entry.imposters.normB.id),
            noise: pick(SHARED_TEXTURES.noise.id),
            grassVariation: pick(SHARED_TEXTURES.grassVariation.id),
            detailFar: pick(entry.surface.detailFar.id),
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
      farTintScale: tier === 'far' ? 0.7 : 0.72,
      hasAlphaTexture: tier === 'near' && species === 1,
      hasNormalTexture: species === 0 || tier === 'far' ? false : false,
      key: `tree:${tier}:${species}`,
    }
    spec.hasNormalTexture = tier === 'near' ? species === 0 : true
    const handle = getFoliageMaterialHandle(spec)
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
      key: `${kind}:all`,
    }
    const handle = getFoliageMaterialHandle(spec)
    const entries = kind === 'grass' ? getGrassEntries(season) : getBushEntries(season).filter((item) => item.cell <= 2)
    const instances: FoliageSpriteInstance[] = placements.map((placement) => {
      const picked = pickCellEntry(entries, placement.variant)
      return {
        x: placement.x,
        y: placement.y,
        z: placement.z,
        rotation: placement.rotation,
        scale: placement.scale / (kind === 'grass' ? GRASS_UNIT_SIZE : BUSH_UNIT_SIZE),
        region: picked?.region ?? null,
        cell: picked?.cell ?? 0,
        roadProx: 0,
      }
    })
    const unit = kind === 'grass' ? GRASS_UNIT_SIZE : BUSH_UNIT_SIZE
    const mesh = createFoliageLayerMesh(instances, handle.material, unit, hostObject ? hostInverse : null)
    tagArtifact(mesh)
    batch.group.add(mesh)
    batch.layers.push(mesh)
    return instances.length
  }

  interface FarTreeCandidate {
    x: number
    z: number
    y: number
    rotation: number
    scale: number
    variant: number
    species: 0 | 1
  }

  function disposeFarTreeRing(): void {
    for (const layer of farTreeLayers) {
      disposeFoliageLayerMesh(layer)
    }
    farTreeLayers = []
    farTreeInstances = 0
    farTreeSignature = ''
    farTreeCenterX = Number.NaN
    farTreeCenterZ = Number.NaN
  }

  /**
   * 远景树环：以相机为中心、覆盖分块视距之外到远山（视距 × 2.6）的
   * imposter 环带，与 slowroads-lab 的"满山森林"观感对齐。
   *
   * - 相机锚定：相机水平移动超过 FAR_TREE_REANCHOR_DISTANCE 后重建，
   *   预算始终花在视野附近而不是整个 40km 场景上；
   * - 密度：密度场 × 接受率后按哈希抽稀到预算（均匀而无条纹）；
   * - 尺寸：随距离放大（最多 1 + FAR_TREE_SCALE_GAIN 倍），远景读起来
   *   仍是"森林"而不是"点"；
   * - 预算：high 32000 / medium 16000 / low 0 实例，按物种植入 2 个
   *   InstancedMesh（共 2 个 draw call），材质与分块远树共用
   *   （换季只换纹理，不重建实例）。
   */
  function rebuildFarTreeRing(centerX: number, centerZ: number): void {
    disposeFarTreeRing()
    farTreeCenterX = centerX
    farTreeCenterZ = centerZ
    if (!grid || !densityField || !farTreeRoot || !hostObject) {
      return
    }
    const quality = resolveQuality()
    const budget = quality === 'high' ? 64000 : quality === 'medium' ? 24000 : 0
    const tier = PROCEDURAL_LANDSCAPE_QUALITY_TIERS[quality]
    farTreeSignature = farRingSignature(quality)
    if (budget <= 0) {
      return
    }
    const acceptance = 0.8
    const innerRadius = tier.viewDistance * FAR_TREE_RING_INNER_FACTOR
    const outerRadius = tier.viewDistance * FAR_TREE_RING_OUTER_FACTOR
    const innerSq = innerRadius * innerRadius
    const outerSq = outerRadius * outerRadius
    const cell = 12
    const roadClearance = roadHalfWidth(props) + props.road.shoulderWidth + 2
    const minY = grid.minY + 2
    const maxSlope = props.forest.maxSlope
    const seed = props.seed >>> 0
    const candidates: FarTreeCandidate[] = []
    const minGX = Math.floor(Math.max(grid.minX, centerX - outerRadius) / cell)
    const maxGX = Math.ceil(Math.min(grid.maxX, centerX + outerRadius) / cell)
    const minGZ = Math.floor(Math.max(grid.minZ, centerZ - outerRadius) / cell)
    const maxGZ = Math.ceil(Math.min(grid.maxZ, centerZ + outerRadius) / cell)
    for (let gx = minGX; gx <= maxGX; gx += 1) {
      for (let gz = minGZ; gz <= maxGZ; gz += 1) {
        const x = (gx + hashUnit(seed ^ 0x9e3779b9, gx, gz)) * cell
        const z = (gz + hashUnit(seed ^ 0x85ebca6b, gx, gz)) * cell
        const dx = x - centerX
        const dz = z - centerZ
        const distanceSq = dx * dx + dz * dz
        if (distanceSq < innerSq || distanceSq > outerSq) {
          continue
        }
        if (!grid.contains(x, z)) {
          continue
        }
        const y = grid.sampleHeight(x, z)
        if (y == null || y < minY) {
          continue
        }
        const normal = grid.sampleNormal(x, z)
        if (!normal || 1 - normal.y > maxSlope) {
          continue
        }
        if (roadFieldData && roadFieldData.distanceAt(x, z) < roadClearance) {
          continue
        }
        if (hashUnit(seed ^ 0xc2b2ae35, gx, gz) >= densityField.sampleUnit(x, z) * acceptance) {
          continue
        }
        const distance = Math.sqrt(distanceSq)
        const scaleGain =
          1 + FAR_TREE_SCALE_GAIN * clamp((distance - innerRadius) / Math.max(1, outerRadius - innerRadius), 0, 1)
        candidates.push({
          x,
          z,
          y,
          rotation: hashUnit(seed ^ 0x27d4eb2f, gx, gz) * Math.PI * 2,
          scale:
            lerp(props.forest.minScale, props.forest.maxScale, hashUnit(seed ^ 0x165667b1, gx, gz)) * scaleGain,
          variant: hashUnit(seed ^ 0xd3a2646c, gx, gz),
          species: hashUnit(seed ^ 0xfd7046c5, gx, gz) < 0.4 ? 1 : 0,
        })
      }
    }
    if (!candidates.length) {
      return
    }
    // 哈希抽稀到预算：保持随机分布（步长抽稀会在扫描线上形成规则条纹）。
    const keepProbability = Math.min(1, budget / candidates.length)
    const kept =
      keepProbability >= 1
        ? candidates
        : candidates.filter((candidate, index) => {
            const gx = Math.round(candidate.x / cell)
            const gz = Math.round(candidate.z / cell)
            return hashUnit(seed ^ 0x7feb352d, gx * 73856093 + index, gz * 19349663) < keepProbability
          })
    for (const species of [0, 1] as const) {
      const list = kept.filter((candidate) => candidate.species === species)
      if (!list.length) {
        continue
      }
      const spec: FoliageMaterialSpec = {
        kind: 'tree',
        tier: 'far',
        species,
        singlePlane: true,
        tint: 0xffffff,
        farTintScale: 0.65,
        hasAlphaTexture: false,
        hasNormalTexture: true,
        key: `tree:far:${species}`,
      }
      const handle = getFoliageMaterialHandle(spec)
      const instances: FoliageSpriteInstance[] = list.map((candidate) => {
        const regionIndex = findRegionIndex(IMPOSTER_REGIONS, candidate.variant)
        return {
          x: candidate.x,
          y: candidate.y,
          z: candidate.z,
          rotation: candidate.rotation,
          scale: candidate.scale / TREE_UNIT_SIZE,
          region: IMPOSTER_REGIONS[regionIndex] ?? null,
          cell: Math.min(3, regionIndex % 4),
          roadProx: 0,
        }
      })
      const mesh = createFoliageLayerMesh(instances, handle.material, TREE_UNIT_SIZE, hostObject ? hostInverse : null)
      tagArtifact(mesh)
      farTreeRoot.add(mesh)
      farTreeLayers.push(mesh)
      farTreeInstances += instances.length
    }
    farTreeSignature = farRingSignature(quality)
  }

  function farRingSignature(quality: ResolvedProceduralLandscapeQuality): string {
    const gridKey = grid ? `${grid.cols}x${grid.rows}` : 'none'
    return `${quality}|${props.seed >>> 0}|${gridKey}`
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
        roadClearance: props.forest.roadClearance,
        roadHalfWidth: roadHalfWidth(props),
        roadShoulderWidth: props.road.shoulderWidth,
        minScale: props.forest.minScale,
        maxScale: props.forest.maxScale,
        minHeight: props.forest.minHeight,
      },
      { grid, density: densityField, roadField: roadFieldData },
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
      },
      { grid, density: densityField, roadField: roadFieldData },
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
          { grid, density: densityField, roadField: roadFieldData },
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
    surfaceMeshes = collectSurfaceMeshes()
    surfacePatch = applyProceduralLandscapeSurfaceInjection(surfaceMeshes, uniforms)
    if (!surfacePatch.hasInjection && !surfaceWarningEmitted) {
      surfaceWarningEmitted = true
      warn('surface-injection-unavailable')
    }
  }

  function updateStats(): void {
    stats.phase = !enabled
      ? 'disabled'
      : gridFailed
        ? 'error'
        : gridBuilder
          ? 'sampling'
          : dirty.world || dirty.instances
            ? 'generating'
            : 'streaming'
    stats.progress = gridBuilder ? gridBuilder.progress : grid ? 1 : 0
    stats.quality = resolveQuality()
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
      + (densityField?.memoryBytes ?? 0)
      + (variationField?.memoryBytes ?? 0)
      + (roadFieldData?.memoryBytes ?? 0)
      + (roadFieldData ? roadFieldData.width * roadFieldData.height * 4 : 0)
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
    stats.farTreeInstances = farTreeInstances
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
    const placeholder = getSharedPlaceholderTexture()
    roadBand?.setSeason(season, {
      base: textureFor(entry.road.base.id) ?? placeholder,
      overlay: entry.road.overlay ? textureFor(entry.road.overlay.id) : null,
    })
    applyTreeMeshSeasonTextures()
    // 换季复用放置：只重建植被网格层（不重算 chunkPlan、不重建地形）。
    releaseAllBatches()
    markInstancesDirty()
  }

  function syncSeasonFromFrameState(): void {
    const next = hooks.getSeasonState()?.season ?? 'spring'
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
    if (hostMatrixChanged()) {
      resetAll()
      updateHostSnapshot()
      dirty.grid = true
    }
    if (elapsedMs - lastSourceCheckAt >= SOURCE_CHECK_INTERVAL_MS) {
      lastSourceCheckAt = elapsedMs
      checkTerrainSourceChanges()
    }
    syncSeasonFromFrameState()

    if (dirty.grid) {
      if (!gridBuilder) {
        if (!props.sampling || !hostObject) {
          return
        }
        const resolved = resolveTerrainMeshSources(hostObject)
        currentTerrainSourceSignature = resolved.signature
        gridBuilder = createTerrainGridBuilder(resolved.sources, {
          cellSize: props.sampling.sampleCellSize,
          maxGridSize: props.sampling.maxSampleGridSize,
        })
      }
      const ready = stepGridBuild()
      if (!ready || !grid) {
        updateStats()
        return
      }
      dirty.grid = false
      dirty.world = false
    }

    if (dirty.world) {
      dirty.world = false
      buildWorld()
      rebuildRoadDebugLine()
    }
    if (dirty.uniforms) {
      dirty.uniforms = false
      applyDynamicSurfaceUniforms()
      rebuildRoadDebugLine()
    }
    if (dirty.instances) {
      dirty.instances = false
      releaseAllBatches()
      forceStream = true
      const farCamera = hooks.getCameraWorldPosition()
      if (farCamera) {
        if (farRingSignature(resolveQuality()) !== farTreeSignature) {
          rebuildFarTreeRing(farCamera.x, farCamera.z)
        }
      } else {
        // 相机未知时先作废签名，等下一帧拿到相机位置再重建。
        farTreeSignature = ''
      }
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
      const anchorMoved =
        !Number.isFinite(farTreeCenterX) ||
        Math.hypot(camera.x - farTreeCenterX, camera.z - farTreeCenterZ) > FAR_TREE_REANCHOR_DISTANCE
      if (farRingSignature(resolveQuality()) !== farTreeSignature || anchorMoved) {
        rebuildFarTreeRing(camera.x, camera.z)
      }
      updateTreeMeshes(camera)
    }
    if (chunkDebugDirty) {
      chunkDebugDirty = false
      rebuildChunkDebugLines()
    }
    updateStats()
  }

  return {
    attach(host: THREE.Object3D | null): void {
      if (disposed || hostObject === host) {
        if (host && hostMatrixChanged()) {
          resetAll()
          updateHostSnapshot()
          dirty.grid = true
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
      if (treeMeshManager && treeMeshManager.container.parent !== host) {
        treeMeshManager.container.removeFromParent()
      }
      if (farTreeRoot && farTreeRoot.parent !== host) {
        farTreeRoot.removeFromParent()
      }
      hostObject = host
      if (hostObject) {
        updateHostSnapshot()
        ensureRoots()
        if (treeMeshManager) {
          hostObject.add(treeMeshManager.container)
        }
        if (farTreeRoot) {
          hostObject.add(farTreeRoot)
        }
        gridFailed = false
        dirty.grid = true
      }
    },
    setProps(next: ProceduralLandscapeComponentProps): void {
      if (disposed) {
        return
      }
      props = clampProceduralLandscapeProps(next, hooks.nodeId)
      const keys = {
        grid: jsonKey(props.sampling),
        world: jsonKey([props.seed, props.generationRevision, props.road, props.forest.coverage, props.forest.scale, props.forest.seedOffset]),
        instances: jsonKey([props.forest, props.grass, props.bushes, props.quality]),
        uniforms: jsonKey([props.surface, props.road.flattenBand, props.road.flattenStrength, props.grass.windEnabled]),
        roadDebug: jsonKey(props.debug.showRoadPath),
        chunkDebug: jsonKey(props.debug.showChunks),
      }
      if (keys.grid !== previousKeys.grid) {
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
      disposed = true
      resetAll()
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
      disposeFarTreeRing()
      if (farTreeRoot && hostObject) {
        hostObject.remove(farTreeRoot)
      }
      foliageRoot = null
      debugRoot = null
      farTreeRoot = null
      statsRegistry.delete(hooks.nodeId)
    },
    getStats(): ProceduralLandscapeRuntimeStats {
      return stats
    },
  }
}
