import * as THREE from 'three'
import polygonClipping from 'polygon-clipping'
import type {
  Pair as PolygonClippingPair,
  Ring as PolygonClippingRing,
  MultiPolygon as PolygonClippingMultiPolygon,
} from 'polygon-clipping'
import {
  createGroundHeightMap,
  ensureGroundHeightMap,
  formatGroundLocalEditTileKey,
  parseGroundChunkKey,
  GROUND_TERRAIN_CHUNK_SIZE_METERS,
  getGroundVertexIndex,
  GROUND_HEIGHT_UNSET_VALUE,
  resolveInfiniteGroundGridOriginMeters,
  resolveGroundChunkCoordFromWorldPosition,
  resolveGroundEditCellSize,
  resolveGroundEditTileResolution,
  resolveGroundEditTileSizeMeters,
  resolveGroundWorldBounds,
  resolveGroundWorkingGridSize,
} from './groundRuntimeHelpers'
import type {
  GroundTerrainHeightSampler,
  GroundSurfaceChunkLayerRef,
  GroundDynamicMesh,
  CompiledGroundManifest,
  GroundGenerationSettings,
  GroundHeightMap,
  GroundPlanningMetadata,
  GroundLocalEditTileData,
  GroundLocalEditTileMap,
  GroundOptimizedMeshChunkData,
  GroundOptimizedMeshData,
  GroundRuntimeDynamicMesh,
  GroundSculptOperation,
  SceneMaterialTextureSettings,
} from './core'
import { resolveGroundTileMaterialMap } from './core'
import { addMesh as markInstancedBoundsDirty } from './instancedBoundsTracker'
import { createTextureSettings } from './material'
import { hashString, stableSerialize } from './stableSerialize'

import {
  computeGroundBaseHeightAtVertex,
  computeGroundBaseHeightRegion,
  sampleGroundBaseHeightAtWorld,
  type GroundBaseHeightRegion,
  normalizeGroundGenerationSettings,
} from './groundGeneration'

const textureLoader = new THREE.TextureLoader()

const DEFAULT_GROUND_CHUNK_CELLS = 100
const DEFAULT_GROUND_CHUNK_RADIUS_METERS = 200
const GROUND_TRIANGLE_SLICE_EPSILON = 1e-6
const GROUND_TRIANGLE_SLICE_PLANAR_TOLERANCE = 0.004
const GROUND_TRIANGLE_SLICE_MAX_PLANAR_REGION_CELLS = 4096
const GROUND_TRIANGLE_SLICE_MAX_COVERED_CELLS = 6000
const GROUND_TRIANGLE_SLICE_MAX_FRAGMENT_COUNT = 8192
const GROUND_TRIANGLE_SLICE_MAX_INTERSECTION_BUDGET = 12000
const GROUND_TRIANGLE_SLICE_MAX_PLANAR_REGION_RATIO = 0.45
const GROUND_TRIANGLE_SLICE_MAX_TRIANGLE_CELL_RATIO = 0.35
const GROUND_FLAT_TILING_MIN_RADIUS_CHUNKS = 32
const GROUND_FLAT_TILING_BUFFER_MIN_CHUNKS = 8
const GROUND_FLAT_TILING_BUFFER_FACTOR = 0.5
const GROUND_FLAT_TILING_RELEASE_BUFFER_MIN_CHUNKS = 12
const GROUND_FLAT_TILING_RELEASE_BUFFER_FACTOR = 0.35
const GROUND_FLAT_CHUNK_ASYNC_BUILD_BATCH_SIZE = 4096
const GROUND_LOCAL_EDIT_TILE_COVERAGE_BUCKET_CHUNKS = 4

type GroundLocalEditTileCache = {
  tiles: GroundLocalEditTileData[]
  lookup: Map<string, GroundLocalEditTileData>
}

type GroundLocalEditTileCoverageIndexCache = {
  cacheKey: string
  index: Map<string, GroundLocalEditTileData[]>
}

const EMPTY_GROUND_LOCAL_EDIT_TILE_CACHE: GroundLocalEditTileCache = {
  tiles: [],
  lookup: new Map<string, GroundLocalEditTileData>(),
}
const groundLocalEditTileCacheBySource = new WeakMap<GroundLocalEditTileMap, GroundLocalEditTileCache>()
const groundLocalEditTileCoverageIndexBySource = new WeakMap<GroundLocalEditTileMap, GroundLocalEditTileCoverageIndexCache>()

type GroundChunkKey = string

/** 地面块规格定义 - 描述地面块在全局网格中的位置和大小 */
type GroundChunkSpec = {
  /** 地面块开始的行索引 */
  startRow: number
  /** 地面块开始的列索引 */
  startColumn: number
  /** 地面块包含的行数（单元格数） */
  rows: number
  /** 地面块包含的列数（单元格数） */
  columns: number
}

/** 地面块运行时数据 - 存储地面块在运行时的动态信息，包括网格和位置 */
type GroundChunkRuntime = {
  /** 地面块的唯一标识符 */
  key: GroundChunkKey
  /** 地面块所在的行坐标 */
  chunkRow: number
  /** 地面块所在的列坐标 */
  chunkColumn: number
  /** 地面块的规格信息 */
  spec: GroundChunkSpec
  /** 地面块对应的Three.js网格对象 */
  mesh: THREE.Mesh
}

/** 地面单元格三角形定义 - 描述单个地面单元格中的三角形几何信息 */
type GroundCellTriangleDefinition = {
  /** 三角形的三个顶点坐标（使用2D向量表示水平位置） */
  vertices: [THREE.Vector2, THREE.Vector2, THREE.Vector2]
  /** 三角形三个顶点对应的高度值 */
  heights: [number, number, number]
}

/** 平面地面切片区域 - 定义地面上的平面区域及其高度信息 */
type GroundPlanarSliceRegion = {
  /** 切片区域的开始行索引 */
  startRow: number
  /** 切片区域的结束行索引 */
  endRow: number
  /** 切片区域的开始列索引 */
  startColumn: number
  /** 切片区域的结束列索引 */
  endColumn: number
  /** 切片区域左上角（0,0）位置的高度值 */
  h00: number
  /** 沿X轴方向的斜率（高度在X方向的变化率） */
  slopeX: number
  /** 沿Z轴方向的斜率（高度在Z方向的变化率） */
  slopeZ: number
}

/** 地面三角形切片网格 - 用于表示地面区域的三角形网格数据，支持精确和近似两种模式 */
export type GroundTriangleSliceMesh = {
  /** 网格顶点数组，每个顶点包含x、y、z三个坐标分量 */
  vertices: Array<{ x: number; y: number; z: number }>
  /** 三角形索引数组，通过顶点索引定义三角形的拓扑结构 */
  indices: number[]
  /** 网格生成模式：'exact'表示精确计算，'approx'表示近似计算 */
  mode?: 'exact' | 'approx'
}

/** 地面运行时状态类型定义 */
type GroundRuntimeState = {
  /** 定义签名，用于标识地面配置的唯一性 */
  definitionSignature: string
  /** 每个地面块包含的单元格数量 */
  chunkCells: number
  /** 是否投射阴影 */
  castShadow: boolean
  /** 所有地面块的运行时数据映射，使用块坐标作为键 */
  chunks: Map<GroundChunkKey, GroundChunkRuntime>
  /** 平面地面块批次的集合，用于优化渲染性能 */
  flatChunkBatches: Map<string, GroundFlatChunkBatchRuntime>
  /** 平面地面块铺贴是否已初始化 */
  flatTilingInitialized: boolean
  /** 平面地面块铺贴的版本号，用于跟踪更新 */
  flatTilingVersion: number
  /** 平面地面块铺贴的最小行索引 */
  flatTilingMinChunkRow: number
  /** 平面地面块铺贴的最大行索引 */
  flatTilingMaxChunkRow: number
  /** 平面地面块铺贴的最小列索引 */
  flatTilingMinChunkColumn: number
  /** 平面地面块铺贴的最大列索引 */
  flatTilingMaxChunkColumn: number
  /** 平面地面块的键集合，存储当前活跃的块 */
  flatChunkKeys: Set<string>
  /** 上次同步平面地面块铺贴时的版本号 */
  lastFlatChunkSyncTilingVersion: number
  /** 上次同步隐藏块键时的版本号 */
  lastFlatChunkSyncHiddenChunkKeysVersion: number
  /** 隐藏地面块的键集合 */
  hiddenChunkKeys: Set<string>
  /** 隐藏块键集合的版本号 */
  hiddenChunkKeysVersion: number
  /** 可见地面块键的缓存数组 */
  visibleChunkKeysCache: string[]
  /** 可见块键集合的版本号 */
  visibleChunkKeysVersion: number
  /** 可见块键缓存的版本号 */
  visibleChunkKeysCacheVersion: number
  /** 可见地面块签名的缓存字符串 */
  visibleChunkSignatureCache: string
  /** 可见块签名缓存的版本号 */
  visibleChunkSignatureCacheVersion: number
  /** 上次更新块的时间戳 */
  lastChunkUpdateAt: number

  /** 期望的签名值，用于检测配置是否变化 */
  desiredSignature: string
  /** 上次摄像机在本地坐标系中的X位置 */
  lastCameraLocalX: number
  /** 上次摄像机在本地坐标系中的Z位置 */
  lastCameraLocalZ: number
  /** 待创建的地面块数组，按优先级排序 */
  pendingCreates: Array<{ key: GroundChunkKey; chunkRow: number; chunkColumn: number; priority: number; distSq: number }>
  /** 待销毁的地面块数组 */
  pendingDestroys: Array<{ key: GroundChunkKey; distSq: number }>

  /** 三维网格对象池，按尺寸类别存储可重复使用的网格 */
  meshPool: Map<string, THREE.Mesh[]>
  /** 每种尺寸网格对象池的最大容量 */
  poolMaxPerSize: number
}

type GroundTextureTraversalCache = {
  version: number
  meshes: THREE.Mesh[]
}

type GroundFlatChunkBatchRuntime = {
  specKey: string
  spec: GroundChunkSpec
  mesh: THREE.InstancedMesh
  chunkKeys: string[]
  pendingChunkKeys: Set<string>
  instanceCapacity: number
  instanceHeightCache: Map<string, number>
  asyncBuildInFlight: boolean
}

type GroundFlatTilingExpansion = {
  hadPreviousBounds: boolean
  previousMinChunkRow: number
  previousMaxChunkRow: number
  previousMinChunkColumn: number
  previousMaxChunkColumn: number
  nextMinChunkRow: number
  nextMaxChunkRow: number
  nextMinChunkColumn: number
  nextMaxChunkColumn: number
}

type GroundWorldBoundsCacheEntry = {
  key: string
  bounds: ReturnType<typeof resolveGroundWorldBounds>
}

type GroundWorkingGridSizeCacheEntry = {
  key: string
  gridSize: { rows: number; columns: number }
}

type GroundDefinitionStructureSignatureCacheEntry = {
  baseKey: string
  localEditTiles: GroundLocalEditTileMap | null
  signature: string
}

export type GroundHeightSamplingContext = {
  bounds: ReturnType<typeof resolveGroundWorldBounds>
  cellSize: number
  rows: number
  columns: number
  terrainSampler: GroundTerrainHeightSampler | null
}

export type GroundTriangleSamplingContext = GroundHeightSamplingContext & {
  vertexHeightCache: Map<number, number>
  cellTriangleCache: Map<number, [GroundCellTriangleDefinition, GroundCellTriangleDefinition]>
}

function resolveRuntimeTerrainHeightSampler(
  definition: Pick<GroundRuntimeDynamicMesh, 'runtimeTerrainHeightSampler'>,
): GroundTerrainHeightSampler | null {
  // 运行时采样器可能来自外部注入，因此这里先取出候选对象，再做方法级别的校验。
  // 只要没有 `sampleHeightAtWorld` 这个可调用入口，就说明这个对象不能安全用于地形采样。
  const candidate = (definition.runtimeTerrainHeightSampler as GroundTerrainHeightSampler | null | undefined) ?? null
  return candidate && typeof candidate.sampleHeightAtWorld === 'function' ? candidate : null
}

export type GroundFlatChunkInstanceMatrixBuildResult = {
  chunkKeys: string[]
  matrices: Float32Array
}

export type GroundFlatChunkInstanceMatrixBuilder = (params: {
  definition: GroundRuntimeDynamicMesh
  definitionSignature: string
  chunkKeys: string[]
}) => Promise<GroundFlatChunkInstanceMatrixBuildResult> | null

// 存储地形运行时状态的弱引用映射表
const groundRuntimeStateMap = new WeakMap<THREE.Object3D, GroundRuntimeState>()
// 缓存地形世界边界信息的弱引用映射表
const groundWorldBoundsCache = new WeakMap<object, GroundWorldBoundsCacheEntry>()
// 缓存地形工作网格大小的弱引用映射表
const groundWorkingGridSizeCache = new WeakMap<object, GroundWorkingGridSizeCacheEntry>()
// 缓存地形定义结构签名的弱引用映射表
const groundDefinitionStructureSignatureCache = new WeakMap<object, GroundDefinitionStructureSignatureCacheEntry>()
// 运行时块索引缓存，存储行列信息
const runtimeChunkIndexCache = new Map<string, { row: number; column: number }>()
// 地形平面块实例矩阵构建器函数
let groundFlatChunkInstanceMatrixBuilder: GroundFlatChunkInstanceMatrixBuilder | null = null
// 缓存的原型网格
let cachedPrototypeMesh: THREE.Mesh | null = null
// 无限地形摄像机四元数
const infiniteGroundCameraQuaternion = new THREE.Quaternion()
// 地形平面块实例矩阵基础变换（绕X轴旋转-90度）
const groundFlatChunkInstanceMatrixBase = Float32Array.from(
  new THREE.Matrix4()
    .compose(
      new THREE.Vector3(0, 0, 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)),
      new THREE.Vector3(1, 1, 1),
    )
    .elements,
)

function resolveGroundWorldBoundsCached(
  definition: Pick<GroundDynamicMesh, 'worldBounds' | 'chunkSizeMeters' | 'renderRadiusChunks' | 'collisionRadiusChunks'>,
): ReturnType<typeof resolveGroundWorldBounds> {
  const rawBounds = definition.worldBounds
  const key = rawBounds && typeof rawBounds === 'object'
    ? [
      Number(rawBounds.minX),
      Number(rawBounds.maxX),
      Number(rawBounds.minZ),
      Number(rawBounds.maxZ),
      Number(definition.chunkSizeMeters),
      Number(definition.renderRadiusChunks),
      Number(definition.collisionRadiusChunks),
    ].join('|')
    : [
      'none',
      Number(definition.chunkSizeMeters),
      Number(definition.renderRadiusChunks),
      Number(definition.collisionRadiusChunks),
    ].join('|')
  const cached = groundWorldBoundsCache.get(definition as object)
  if (cached?.key === key) {
    return cached.bounds
  }
  const bounds = resolveGroundWorldBounds(definition)
  groundWorldBoundsCache.set(definition as object, { key, bounds })
  return bounds
}

function resolveGroundWorkingGridSizeCached(
  definition: Pick<GroundDynamicMesh, 'cellSize' | 'worldBounds' | 'chunkSizeMeters' | 'renderRadiusChunks' | 'collisionRadiusChunks'>,
): { rows: number; columns: number } {
  const bounds = resolveGroundWorldBoundsCached(definition)
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
  const key = [
    cellSize,
    bounds.minX,
    bounds.maxX,
    bounds.minZ,
    bounds.maxZ,
  ].join('|')
  const cached = groundWorkingGridSizeCache.get(definition as object)
  if (cached?.key === key) {
    return cached.gridSize
  }
  const gridSize = {
    rows: Math.max(1, Math.round((bounds.maxZ - bounds.minZ) / cellSize)),
    columns: Math.max(1, Math.round((bounds.maxX - bounds.minX) / cellSize)),
  }
  groundWorkingGridSizeCache.set(definition as object, { key, gridSize })
  return gridSize
}

function createGroundHeightSamplingContext(definition: GroundRuntimeDynamicMesh): GroundHeightSamplingContext {
  const gridSize = resolveGroundWorkingGridSizeCached(definition)
  return {
    bounds: resolveGroundWorldBoundsCached(definition),
    cellSize: Number.isFinite(definition.cellSize) && definition.cellSize > 1e-6 ? definition.cellSize : 1,
    rows: gridSize.rows,
    columns: gridSize.columns,
    terrainSampler: resolveRuntimeTerrainHeightSampler(definition),
  }
}

/**
 * Pre-builds a GroundHeightSamplingContext for the given definition, suitable for
 * reuse across many sampleGroundHeightWithContext calls in a tight loop (e.g. scatter
 * preview placement). Avoids re-reading Vue reactive properties on every sample.
 */
export function prepareGroundHeightSamplingContext(definition: GroundDynamicMesh): {
  runtimeDefinition: GroundRuntimeDynamicMesh
  context: GroundHeightSamplingContext
} {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  return { runtimeDefinition, context: createGroundHeightSamplingContext(runtimeDefinition) }
}

function createGroundTriangleSamplingContext(definition: GroundRuntimeDynamicMesh): GroundTriangleSamplingContext {
  return {
    ...createGroundHeightSamplingContext(definition),
    vertexHeightCache: new Map<number, number>(),
    cellTriangleCache: new Map<number, [GroundCellTriangleDefinition, GroundCellTriangleDefinition]>(),
  }
}

/**
 * Pre-builds a GroundTriangleSamplingContext for reuse across many
 * sampleGroundTriangleHeightWithContext calls in a tight loop.
 */
export function prepareGroundTriangleHeightSamplingContext(definition: GroundDynamicMesh): {
  runtimeDefinition: GroundRuntimeDynamicMesh
  context: GroundTriangleSamplingContext
} {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  return { runtimeDefinition, context: createGroundTriangleSamplingContext(runtimeDefinition) }
}

function resolveGroundGridWorldBounds(
  definition: Pick<GroundDynamicMesh, 'worldBounds' | 'chunkSizeMeters' | 'renderRadiusChunks' | 'collisionRadiusChunks'>,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  return resolveGroundWorldBounds(definition)
}

function resolveGroundWorldXForColumn(
  definition: Pick<GroundDynamicMesh, 'cellSize' | 'worldBounds' | 'chunkSizeMeters' | 'renderRadiusChunks' | 'collisionRadiusChunks'>,
  column: number,
): number {
  const bounds = resolveGroundGridWorldBounds(definition)
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 1e-6 ? definition.cellSize : 1
  return bounds.minX + column * cellSize
}

function resolveGroundWorldZForRow(
  definition: Pick<GroundDynamicMesh, 'cellSize' | 'worldBounds' | 'chunkSizeMeters' | 'renderRadiusChunks' | 'collisionRadiusChunks'>,
  row: number,
): number {
  const bounds = resolveGroundGridWorldBounds(definition)
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 1e-6 ? definition.cellSize : 1
  return bounds.minZ + row * cellSize
}


function createSeededRandom(seed: number): () => number {
  let value = seed % 2147483647
  if (value <= 0) {
    value += 2147483646
  }
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

function buildPermutationTable(random: () => number): number[] {
  const permutation = new Array(256).fill(0).map((_, index) => index)
  for (let i = permutation.length - 1; i > 0; i -= 1) {
    const swapIndex = Math.floor(random() * (i + 1))
    const temp = permutation[i]!
    permutation[i] = permutation[swapIndex]!
    permutation[swapIndex] = temp
  }
  const table = new Array(512)
  for (let i = 0; i < 512; i += 1) {
    table[i] = permutation[i & 255]!
  }
  return table
}

function createPerlinNoise(seed?: number) {
  const random = seed === undefined ? Math.random : createSeededRandom(Math.floor(seed))
  const P = buildPermutationTable(random)

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
  const lerp = (t: number, a: number, b: number) => a + t * (b - a)
  const grad = (hash: number, x: number, y: number, z: number) => {
    const h = hash & 15
    const u = h < 8 ? x : y
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z
    const first = (h & 1) === 0 ? u : -u
    const second = (h & 2) === 0 ? v : -v
    return first + second
  }

  return (x: number, y: number, z: number) => {
    let X = Math.floor(x) & 255
    let Y = Math.floor(y) & 255
    let Z = Math.floor(z) & 255
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)
    const zf = z - Math.floor(z)
    const u = fade(xf)
    const v = fade(yf)
    const w = fade(zf)

    const A = P[X]! + Y
    const AA = P[A]! + Z
    const AB = P[A + 1]! + Z
    const B = P[X + 1]! + Y
    const BA = P[B]! + Z
    const BB = P[B + 1]! + Z

    return lerp(
      w,
      lerp(
        v,
        lerp(u, grad(P[AA]!, xf, yf, zf), grad(P[BA]!, xf - 1, yf, zf)),
        lerp(u, grad(P[AB]!, xf, yf - 1, zf), grad(P[BB]!, xf - 1, yf - 1, zf)),
      ),
      lerp(
        v,
        lerp(u, grad(P[AA + 1]!, xf, yf, zf - 1), grad(P[BA + 1]!, xf - 1, yf, zf - 1)),
        lerp(u, grad(P[AB + 1]!, xf, yf - 1, zf - 1), grad(P[BB + 1]!, xf - 1, yf - 1, zf - 1)),
      ),
    )
  }
}

function groundChunkKey(chunkRow: number, chunkColumn: number): GroundChunkKey {
  return `${chunkRow}:${chunkColumn}`
}

function resolveRuntimeChunkIndexFromRuntimeKey(
  key: string,
): { row: number; column: number } | null {
  const cached = runtimeChunkIndexCache.get(key)
  if (cached) {
    return cached
  }
  const separatorIndex = key.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex >= key.length - 1 || key.indexOf(':', separatorIndex + 1) !== -1) {
    return null
  }
  const row = Number(key.slice(0, separatorIndex))
  const column = Number(key.slice(separatorIndex + 1))
  if (!Number.isFinite(row) || !Number.isFinite(column)) {
    return null
  }
  const resolved = {
    row: Math.trunc(row),
    column: Math.trunc(column),
  }
  runtimeChunkIndexCache.set(key, resolved)
  return resolved
}

function resolveSharedGroundChunkKeyFromRuntimeKey(key: string): string | null {
  const separatorIndex = key.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
    return null
  }
  return `${key.slice(separatorIndex + 1)}:${key.slice(0, separatorIndex)}`
}

function resolveRuntimeGroundChunkKeyFromSharedKey(key: string): string | null {
  const parsed = parseGroundChunkKey(key)
  if (!parsed) {
    return null
  }
  return groundChunkKey(parsed.chunkZ, parsed.chunkX)
}

function resolveOptimizedMesh(definition: GroundDynamicMesh | null | undefined): GroundOptimizedMeshData | null {
  const optimizedMesh = definition?.optimizedMesh
  if (!optimizedMesh || !Array.isArray(optimizedMesh.chunks) || optimizedMesh.chunks.length === 0) {
    return null
  }
  if (!Number.isFinite(optimizedMesh.chunkCells) || optimizedMesh.chunkCells <= 0) {
    return null
  }
  const sourceChunkCells = optimizedMesh.sourceChunkCells
  if (typeof sourceChunkCells !== 'number' || !Number.isFinite(sourceChunkCells) || sourceChunkCells <= 0) {
    return null
  }
  return optimizedMesh
}

function invalidateGroundDefinitionStructureSignature(definition: GroundDynamicMesh): void {
  groundDefinitionStructureSignatureCache.delete(definition as object)
}

function definitionStructureSignature(definition: GroundDynamicMesh): string {
  const gridSize = resolveGroundWorkingGridSizeCached(definition)
  const columns = gridSize.columns
  const rows = gridSize.rows
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 1e-6 ? definition.cellSize : 1
  const bounds = resolveGroundWorldBoundsCached(definition)
  const width = bounds.maxX - bounds.minX
  const depth = bounds.maxZ - bounds.minZ
  const runtimeDefinition = definition as GroundRuntimeDynamicMesh
  const optimizedMesh = definition.optimizedMesh
  const optimizedSignature = optimizedMesh
    ? `${optimizedMesh.chunkCells}:${optimizedMesh.chunkCount}:${optimizedMesh.optimizedVertexCount}:${optimizedMesh.optimizedTriangleCount}`
    : 'none'
  const bakedSurfaceChunkSignature = resolveGroundTileMaterialMap(definition)
    ? Object.keys(resolveGroundTileMaterialMap(definition) ?? {}).sort().join(',')
    : 'none'
  const surfaceRevision = Number.isFinite(definition.surfaceRevision) ? Math.trunc(definition.surfaceRevision as number) : 0
  const optimizedChunkState = runtimeDefinition.runtimeDisableOptimizedChunks === true ? 'disabled' : 'enabled'
  const hydratedHeightState = runtimeDefinition.runtimeHydratedHeightState ?? 'none'
  const loadedTileCount = Array.isArray(runtimeDefinition.runtimeLoadedTileKeys)
    ? runtimeDefinition.runtimeLoadedTileKeys.length
    : 0
  const tileResolution = Math.trunc(resolveGroundEditTileResolution(definition))
  const localEditTileSource = runtimeDefinition.localEditTiles && typeof runtimeDefinition.localEditTiles === 'object'
    ? runtimeDefinition.localEditTiles
    : null
  const baseKey = [
    columns,
    rows,
    cellSize.toFixed(6),
    width.toFixed(6),
    depth.toFixed(6),
    surfaceRevision,
    optimizedSignature,
    bakedSurfaceChunkSignature,
    optimizedChunkState,
    hydratedHeightState,
    tileResolution,
    loadedTileCount,
  ].join('|')
  const cached = groundDefinitionStructureSignatureCache.get(definition as object)
  if (cached?.baseKey === baseKey && cached.localEditTiles === localEditTileSource) {
    return cached.signature
  }
  const localEditTiles = runtimeDefinition.localEditTiles && typeof runtimeDefinition.localEditTiles === 'object'
    ? Object.values(runtimeDefinition.localEditTiles)
    : []
  const localEditSignature = localEditTiles.length
    ? `${localEditTiles.length}:${localEditTiles.reduce((maxUpdatedAt, tile) => {
      const updatedAt = Number(tile?.updatedAt)
      return Number.isFinite(updatedAt) ? Math.max(maxUpdatedAt, Math.trunc(updatedAt)) : maxUpdatedAt
    }, 0)}`
    : 'none'
  const signature = `${baseKey}|${localEditSignature}`
  groundDefinitionStructureSignatureCache.set(definition as object, {
    baseKey,
    localEditTiles: localEditTileSource,
    signature,
  })
  return signature
}

export function resolveGroundDefinitionStructureSignature(definition: GroundDynamicMesh): string {
  return definitionStructureSignature(definition)
}

export function setGroundFlatChunkInstanceMatrixBuilder(builder: GroundFlatChunkInstanceMatrixBuilder | null): void {
  groundFlatChunkInstanceMatrixBuilder = typeof builder === 'function' ? builder : null
}

function resolveInfiniteChunkSizeMeters(definition: Pick<GroundDynamicMesh, 'chunkSizeMeters'>): number {
  // 这是无限地形最基础的尺度换算：世界坐标里移动多少米，对应 chunk 坐标跨过一格。
  // 如果这里算错，后面所有 chunkKey、窗口边界、拾取和实例平铺的位置都会整体偏移。
  // 没有显式配置时回退到默认值，保证旧场景数据缺少该字段时依然能运行。
  const explicit = Number(definition.chunkSizeMeters)
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit
  }
  return GROUND_TERRAIN_CHUNK_SIZE_METERS
}

function resolveInfiniteRenderRadiusChunks(definition: GroundDynamicMesh): number {
  // 这个值不是“场景上限”，只是相机周围的保留半径：
  // - 太小会导致边缘 chunk 频繁进出视野，产生抖动；
  // - 太大只会增加内存和创建成本，不应该再被人为截断成一个固定上限。
  // 因此这里只保留最小值保护，防止 0 或负数把窗口直接退化掉。
  const explicit = Number(definition.renderRadiusChunks)
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(1, Math.trunc(explicit))
  }
  return 4
}

function resolveInfiniteFlatTilingRadiusChunks(definition: GroundDynamicMesh): number {
  const baseRadius = resolveInfiniteRenderRadiusChunks(definition)
  const bufferChunks = Math.max(
    GROUND_FLAT_TILING_BUFFER_MIN_CHUNKS,
    Math.ceil(baseRadius * GROUND_FLAT_TILING_BUFFER_FACTOR),
  )
  return Math.max(GROUND_FLAT_TILING_MIN_RADIUS_CHUNKS, baseRadius + bufferChunks)
}

function resolveInfiniteFlatTilingReleaseRadiusChunks(definition: GroundDynamicMesh): number {
  const loadRadiusChunks = resolveInfiniteFlatTilingRadiusChunks(definition)
  const baseRadius = resolveInfiniteRenderRadiusChunks(definition)
  const releaseBufferChunks = Math.max(
    GROUND_FLAT_TILING_RELEASE_BUFFER_MIN_CHUNKS,
    Math.ceil(baseRadius * GROUND_FLAT_TILING_RELEASE_BUFFER_FACTOR),
  )
  return loadRadiusChunks + releaseBufferChunks
}

function resolveInfiniteDenseChunkLoadRadiusChunks(definition: GroundDynamicMesh): number {
  const runtimeDenseRadius = Number((definition as GroundDynamicMesh & {
    runtimeDenseChunkLoadRadiusChunks?: unknown
  }).runtimeDenseChunkLoadRadiusChunks)
  if (Number.isFinite(runtimeDenseRadius) && runtimeDenseRadius > 0) {
    return Math.max(1, Math.trunc(runtimeDenseRadius))
  }
  return resolveInfiniteRenderRadiusChunks(definition)
}

function updateInfiniteFlatTilingBounds(
  state: GroundRuntimeState,
  cameraChunkCoord: { chunkX: number; chunkZ: number },
  loadRadiusChunks: number,
): GroundFlatTilingExpansion | null {
  const minChunkRow = Math.trunc(cameraChunkCoord.chunkZ - loadRadiusChunks)
  const maxChunkRow = Math.trunc(cameraChunkCoord.chunkZ + loadRadiusChunks)
  const minChunkColumn = Math.trunc(cameraChunkCoord.chunkX - loadRadiusChunks)
  const maxChunkColumn = Math.trunc(cameraChunkCoord.chunkX + loadRadiusChunks)

  if (!state.flatTilingInitialized) {
    state.flatTilingInitialized = true
    state.flatTilingVersion += 1
    state.flatTilingMinChunkRow = minChunkRow
    state.flatTilingMaxChunkRow = maxChunkRow
    state.flatTilingMinChunkColumn = minChunkColumn
    state.flatTilingMaxChunkColumn = maxChunkColumn
    return {
      hadPreviousBounds: false,
      previousMinChunkRow: minChunkRow,
      previousMaxChunkRow: maxChunkRow,
      previousMinChunkColumn: minChunkColumn,
      previousMaxChunkColumn: maxChunkColumn,
      nextMinChunkRow: minChunkRow,
      nextMaxChunkRow: maxChunkRow,
      nextMinChunkColumn: minChunkColumn,
      nextMaxChunkColumn: maxChunkColumn,
    }
  }

  const previousMinChunkRow = state.flatTilingMinChunkRow
  const previousMaxChunkRow = state.flatTilingMaxChunkRow
  const previousMinChunkColumn = state.flatTilingMinChunkColumn
  const previousMaxChunkColumn = state.flatTilingMaxChunkColumn
  const nextMinChunkRow = Math.min(state.flatTilingMinChunkRow, minChunkRow)
  const nextMaxChunkRow = Math.max(state.flatTilingMaxChunkRow, maxChunkRow)
  const nextMinChunkColumn = Math.min(state.flatTilingMinChunkColumn, minChunkColumn)
  const nextMaxChunkColumn = Math.max(state.flatTilingMaxChunkColumn, maxChunkColumn)
  const changed = nextMinChunkRow !== state.flatTilingMinChunkRow
    || nextMaxChunkRow !== state.flatTilingMaxChunkRow
    || nextMinChunkColumn !== state.flatTilingMinChunkColumn
    || nextMaxChunkColumn !== state.flatTilingMaxChunkColumn
  if (changed) {
    state.flatTilingVersion += 1
    state.flatTilingMinChunkRow = nextMinChunkRow
    state.flatTilingMaxChunkRow = nextMaxChunkRow
    state.flatTilingMinChunkColumn = nextMinChunkColumn
    state.flatTilingMaxChunkColumn = nextMaxChunkColumn
    return {
      hadPreviousBounds: true,
      previousMinChunkRow,
      previousMaxChunkRow,
      previousMinChunkColumn,
      previousMaxChunkColumn,
      nextMinChunkRow,
      nextMaxChunkRow,
      nextMinChunkColumn,
      nextMaxChunkColumn,
    }
  }
  return null
}

function resolveGroundRuntimeMaterial(root: THREE.Group, state: GroundRuntimeState): THREE.Material {
  const cachedMaterialValue = (root.userData as Record<string, unknown> | undefined)?.groundMaterial
  const cachedMaterial = Array.isArray(cachedMaterialValue)
    ? (cachedMaterialValue[0] as THREE.Material | undefined)
    : (cachedMaterialValue as THREE.Material | undefined)

  if (cachedMaterial) {
    return cachedMaterial
  }

  let resolvedChildMaterial: THREE.Material | undefined
  root.traverse((child) => {
    if (resolvedChildMaterial || !(child as THREE.Mesh).isMesh) {
      return
    }
    const meshMaterial = (child as THREE.Mesh).material
    const resolved = Array.isArray(meshMaterial)
      ? (meshMaterial[0] as THREE.Material | undefined)
      : (meshMaterial as THREE.Material | undefined)
    if (resolved && !isGroundChunkTexturedMaterial(resolved)) {
      resolvedChildMaterial = resolved
    }
  })
  if (resolvedChildMaterial) {
    return resolvedChildMaterial
  }

  const firstExistingChunk = state.chunks.values().next().value as GroundChunkRuntime | undefined
  const existingMaterial = firstExistingChunk?.mesh?.material
  const resolvedExistingMaterial = Array.isArray(existingMaterial)
    ? (existingMaterial[0] as THREE.Material | undefined)
    : (existingMaterial as THREE.Material | undefined)
  if (resolvedExistingMaterial) {
    return resolvedExistingMaterial
  }

  if (cachedPrototypeMesh) {
    const prototypeMaterial = cachedPrototypeMesh.material
    const resolvedPrototypeMaterial = Array.isArray(prototypeMaterial)
      ? (prototypeMaterial[0] as THREE.Material | undefined)
      : (prototypeMaterial as THREE.Material | undefined)
    if (resolvedPrototypeMaterial) {
      return resolvedPrototypeMaterial
    }
  }

  return new THREE.MeshStandardMaterial({
    color: '#707070',
    roughness: 1,
    metalness: 0.1,
  })
}

function buildFlatGroundChunkGeometry(spec: GroundChunkSpec, cellSize: number): THREE.PlaneGeometry {
  // flat chunk 不需要为每个 chunk 单独生成地形起伏网格，因为它本身代表的是“没有局部雕刻的平坦区块”。
  // 这里生成的只是一个按 chunk 尺寸裁出来的平面，后续通过 InstancedMesh 批量复制和摆放。
  // 真正的高度信息来自共享的地形采样链，不在这里重复计算。
  const width = Math.max(1, Math.trunc(spec.columns)) * cellSize
  const depth = Math.max(1, Math.trunc(spec.rows)) * cellSize
  return new THREE.PlaneGeometry(width, depth, 1, 1)
}

function buildDenseFlatGroundChunkGeometry(
  definition: GroundRuntimeDynamicMesh,
  spec: GroundChunkSpec,
): THREE.PlaneGeometry {
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
  const geometry = buildFlatGroundChunkGeometry(spec, cellSize)
  const chunkBounds = resolveGroundChunkWorldBoundsFromSpec(definition, spec)
  const centerX = (chunkBounds.minX + chunkBounds.maxX) * 0.5
  const centerZ = (chunkBounds.minZ + chunkBounds.maxZ) * 0.5
  const baseHeight = Number(definition.baseHeight)
  const centerY = Number.isFinite(baseHeight) ? baseHeight : 0
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(centerX, centerY, centerZ)
  return geometry
}

function resolveInfiniteNearChunkWindowBounds(
  centerCoord: { chunkX: number; chunkZ: number },
  chunkSizeMeters: number,
  renderRadiusChunks: number,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  // 这个函数只做兜底：如果相机视锥求交失败、或者调用时根本没有相机，就至少根据中心 chunk 算出一个可用窗口。
  // 它不是全局边界，也不是“最大渲染范围”，只是为了避免窗口被算成空集，导致 chunk 一帧都不加载。
  const minX = (centerCoord.chunkX - renderRadiusChunks) * chunkSizeMeters
  const maxX = (centerCoord.chunkX + renderRadiusChunks + 1) * chunkSizeMeters
  const minZ = (centerCoord.chunkZ - renderRadiusChunks) * chunkSizeMeters
  const maxZ = (centerCoord.chunkZ + renderRadiusChunks + 1) * chunkSizeMeters
  return { minX, maxX, minZ, maxZ }
}

type InfiniteGroundVisibleChunkWindow = {
  minChunkX: number
  maxChunkX: number
  minChunkZ: number
  maxChunkZ: number
  localBounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  centerCoord: { chunkX: number; chunkZ: number }
}

const infiniteGroundViewportSamplePoints: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
]

const infiniteGroundVisibleWindowPlane = new THREE.Plane()
const infiniteGroundVisibleWindowPlanePoint = new THREE.Vector3()
const infiniteGroundVisibleWindowPlaneNormal = new THREE.Vector3()
const infiniteGroundVisibleWindowCameraWorld = new THREE.Vector3()
const infiniteGroundVisibleWindowSampleWorld = new THREE.Vector3()
const infiniteGroundVisibleWindowSampleLocal = new THREE.Vector3()
const infiniteGroundVisibleWindowRayOrigin = new THREE.Vector3()
const infiniteGroundVisibleWindowRayDirection = new THREE.Vector3()
const infiniteGroundVisibleWindowRay = new THREE.Ray()

function resolveInfiniteGroundVisibleLocalBounds(
  root: THREE.Object3D,
  definition: GroundDynamicMesh,
  camera: THREE.Camera | null,
  chunkSizeMeters: number,
  renderRadiusChunks: number,
): { minX: number; maxX: number; minZ: number; maxZ: number; centerCoord: { chunkX: number; chunkZ: number } } {
  // 这个函数的职责非常窄：只回答“相机当前能看见哪一块地面”。
  // 它不参与任何 chunk 上限判断，也不负责决定地形最多能延伸多远。
  // 如果这里和窗口上限逻辑混在一起，后面很容易再次把无限地形误写回有限地形。
  // Only the root world transform is needed for world/local conversion here.
  // Avoid recursively updating every streamed child chunk on each camera tick.
  root.updateWorldMatrix(true, false)

  const baseHeight = typeof definition.baseHeight === 'number' && Number.isFinite(definition.baseHeight)
    ? definition.baseHeight
    : 0

  let localX = 0
  let localZ = 0
  if (camera) {
    camera.updateMatrixWorld(true)
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera || (camera as THREE.OrthographicCamera).isOrthographicCamera) {
      ;(camera as THREE.PerspectiveCamera | THREE.OrthographicCamera).updateProjectionMatrix()
    }
    camera.getWorldPosition(infiniteGroundVisibleWindowCameraWorld)
    infiniteGroundVisibleWindowSampleLocal.copy(infiniteGroundVisibleWindowCameraWorld)
    root.worldToLocal(infiniteGroundVisibleWindowSampleLocal)
    localX = infiniteGroundVisibleWindowSampleLocal.x
    localZ = infiniteGroundVisibleWindowSampleLocal.z
  }

  const centerCoord = resolveGroundChunkCoordFromWorldPosition(localX, localZ, chunkSizeMeters)
  const fallbackBounds = resolveInfiniteNearChunkWindowBounds(centerCoord, chunkSizeMeters, renderRadiusChunks)

  if (!camera) {
    // 没有相机时，视锥采样无从谈起，只能回退到“中心 chunk + 半径”的保底窗口。
    // 这样做的目的不是精确，而是确保至少有一圈 chunk 可见，避免初始化阶段出现空场景。
    return {
      ...fallbackBounds,
      centerCoord,
    }
  }

  infiniteGroundVisibleWindowPlanePoint.set(0, baseHeight, 0)
  root.localToWorld(infiniteGroundVisibleWindowPlanePoint)
  infiniteGroundVisibleWindowPlaneNormal.set(0, 1, 0)
  root.getWorldQuaternion(infiniteGroundCameraQuaternion)
  infiniteGroundVisibleWindowPlaneNormal.applyQuaternion(infiniteGroundCameraQuaternion).normalize()
  infiniteGroundVisibleWindowPlane.setFromNormalAndCoplanarPoint(
    infiniteGroundVisibleWindowPlaneNormal,
    infiniteGroundVisibleWindowPlanePoint,
  )

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  let sumX = 0
  let sumZ = 0
  let intersectionCount = 0

  for (const [ndcX, ndcY] of infiniteGroundViewportSamplePoints) {
    // 用 3x3 采样点覆盖整个视口，是为了避免“只采中心点”导致窗口偏窄，进而出现相机平移后 chunk 跟不上视野边缘的情况。
    // 这也是为什么窗口看起来不像纯粹由相机位置决定，而是由“中心 + 视锥边缘”共同决定。
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      infiniteGroundVisibleWindowRayOrigin.set(ndcX, ndcY, -1).unproject(camera)
      camera.getWorldDirection(infiniteGroundVisibleWindowRayDirection)
    } else {
      camera.getWorldPosition(infiniteGroundVisibleWindowRayOrigin)
      infiniteGroundVisibleWindowSampleWorld.set(ndcX, ndcY, 0.5).unproject(camera)
      infiniteGroundVisibleWindowRayDirection
        .copy(infiniteGroundVisibleWindowSampleWorld)
        .sub(infiniteGroundVisibleWindowRayOrigin)
        .normalize()
    }

    if (infiniteGroundVisibleWindowRayDirection.lengthSq() <= 1e-12) {
      continue
    }

    infiniteGroundVisibleWindowRay.set(
      infiniteGroundVisibleWindowRayOrigin,
      infiniteGroundVisibleWindowRayDirection,
    )
    if (!infiniteGroundVisibleWindowRay.intersectPlane(infiniteGroundVisibleWindowPlane, infiniteGroundVisibleWindowSampleWorld)) {
      continue
    }

    infiniteGroundVisibleWindowSampleLocal.copy(infiniteGroundVisibleWindowSampleWorld)
    root.worldToLocal(infiniteGroundVisibleWindowSampleLocal)
    minX = Math.min(minX, infiniteGroundVisibleWindowSampleLocal.x)
    maxX = Math.max(maxX, infiniteGroundVisibleWindowSampleLocal.x)
    minZ = Math.min(minZ, infiniteGroundVisibleWindowSampleLocal.z)
    maxZ = Math.max(maxZ, infiniteGroundVisibleWindowSampleLocal.z)
    sumX += infiniteGroundVisibleWindowSampleLocal.x
    sumZ += infiniteGroundVisibleWindowSampleLocal.z
    intersectionCount += 1
  }

  if (intersectionCount <= 0) {
    // 如果所有采样点都没和地面平面稳定相交，就继续沿用保底窗口。
    // 宁可多加载一点，也不要把窗口算成空的；空窗口会直接表现成“相机动了但地形不再延伸”。
    return {
      ...fallbackBounds,
      centerCoord,
    }
  }

  const focusX = sumX / intersectionCount
  const focusZ = sumZ / intersectionCount
  const paddingMeters = chunkSizeMeters
  return {
    // 最终窗口取“保底中心窗口”和“视锥求交窗口”的并集。
    // 这么做可以兼顾两个目标：
    // 1) 相机中心附近始终保留足够 chunk；
    // 2) 视野边缘提前补 chunk，避免平移时边缘突然露白。
    minX: Math.min(fallbackBounds.minX, focusX - paddingMeters),
    maxX: Math.max(fallbackBounds.maxX, focusX + paddingMeters),
    minZ: Math.min(fallbackBounds.minZ, focusZ - paddingMeters),
    maxZ: Math.max(fallbackBounds.maxZ, focusZ + paddingMeters),
    centerCoord,
  }
}

export function resolveInfiniteGroundVisibleChunkWindow(
  root: THREE.Object3D,
  definition: GroundDynamicMesh,
  camera: THREE.Camera | null,
): InfiniteGroundVisibleChunkWindow {
  // 这是无限地形的总入口之一：它输出“当前需要保留/加载的 chunk 范围”。
  // 这里不能夹带任何全局最大边界，否则 infinite 模式会在移动若干次后再次卡死在某个上限上。
  const chunkSizeMeters = resolveInfiniteChunkSizeMeters(definition)
  const renderRadiusChunks = resolveInfiniteRenderRadiusChunks(definition)
  const localBounds = resolveInfiniteGroundVisibleLocalBounds(root, definition, camera, chunkSizeMeters, renderRadiusChunks)
  const centeredMinChunkX = localBounds.centerCoord.chunkX - renderRadiusChunks
  const centeredMaxChunkX = localBounds.centerCoord.chunkX + renderRadiusChunks
  const centeredMinChunkZ = localBounds.centerCoord.chunkZ - renderRadiusChunks
  const centeredMaxChunkZ = localBounds.centerCoord.chunkZ + renderRadiusChunks
  const epsilon = Math.max(1e-9, chunkSizeMeters * 1e-9)
  const boundsMinCoord = resolveGroundChunkCoordFromWorldPosition(localBounds.minX, localBounds.minZ, chunkSizeMeters)
  const boundsMaxCoord = resolveGroundChunkCoordFromWorldPosition(
    localBounds.maxX - epsilon,
    localBounds.maxZ - epsilon,
    chunkSizeMeters,
  )
  return {
    minChunkX: Math.min(centeredMinChunkX, boundsMinCoord.chunkX),
    maxChunkX: Math.max(centeredMaxChunkX, boundsMaxCoord.chunkX),
    minChunkZ: Math.min(centeredMinChunkZ, boundsMinCoord.chunkZ),
    maxChunkZ: Math.max(centeredMaxChunkZ, boundsMaxCoord.chunkZ),
    localBounds,
    centerCoord: localBounds.centerCoord,
  }
}

function clampInclusive(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

function resolveEditingChunkCells(definition: GroundDynamicMesh): number {
  // Keep chunk size reasonable even when cellSize is not 1.
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
  const targetMeters = DEFAULT_GROUND_CHUNK_CELLS
  const candidate = Math.max(4, Math.round(targetMeters / Math.max(1e-6, cellSize)))
  return Math.max(4, Math.min(512, Math.trunc(candidate)))
}

function resolveRuntimeChunkCells(definition: GroundDynamicMesh): number {
  const optimizedMesh = resolveOptimizedMesh(definition)
  if (optimizedMesh) {
    const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
    if (!hasRuntimeGroundHeightOverrides(runtimeDefinition)) {
      return Math.max(4, Math.trunc(optimizedMesh.chunkCells))
    }
  }
  return resolveEditingChunkCells(definition)
}

export function resolveGroundChunkCells(definition: GroundDynamicMesh): number {
  return resolveEditingChunkCells(definition)
}

export function resolveGroundRuntimeChunkCells(definition: GroundDynamicMesh): number {
  return resolveRuntimeChunkCells(definition)
}

export type GroundOptimizedMeshUsageAnalysis = {
  hasOptimizedMesh: boolean
  optimizedChunkCells: number | null
  sourceChunkCells: number | null
  runtimeChunkCells: number
  sourceTriangleCount: number
  optimizedTriangleCount: number
  surfaceRevision: number
  runtimeHydratedHeightState: 'pristine' | 'dirty' | 'none'
  runtimeDisableOptimizedChunks: boolean
  canUseOptimizedMesh: boolean
  reason:
    | 'no-optimized-mesh'
    | 'runtime-disable-flag'
    | 'hydrated-state-dirty'
    | 'surface-revision-dirty'
    | 'manual-height-overrides-present'
    | 'planning-height-overrides-present'
    | 'optimized-ready'
}

export function analyzeGroundOptimizedMeshUsage(definition: GroundDynamicMesh): GroundOptimizedMeshUsageAnalysis {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  const optimizedMesh = resolveOptimizedMesh(definition)
  const hydratedHeightState = runtimeDefinition.runtimeHydratedHeightState ?? 'none'
  const surfaceRevision = Number.isFinite(runtimeDefinition.surfaceRevision)
    ? Math.max(0, Math.trunc(runtimeDefinition.surfaceRevision as number))
    : 0
  const sourceChunkCells = resolveEditingChunkCells(definition)

  if (!optimizedMesh) {
    return {
      hasOptimizedMesh: false,
      optimizedChunkCells: null,
      sourceChunkCells: null,
      runtimeChunkCells: sourceChunkCells,
      sourceTriangleCount: 0,
      optimizedTriangleCount: 0,
      surfaceRevision,
      runtimeHydratedHeightState: hydratedHeightState,
      runtimeDisableOptimizedChunks: runtimeDefinition.runtimeDisableOptimizedChunks === true,
      canUseOptimizedMesh: false,
      reason: 'no-optimized-mesh',
    }
  }

  const base = {
    hasOptimizedMesh: true,
    optimizedChunkCells: Math.max(1, Math.trunc(optimizedMesh.chunkCells)),
    sourceChunkCells: Math.max(1, Math.trunc(optimizedMesh.sourceChunkCells)),
    sourceTriangleCount: Math.max(0, Math.trunc(optimizedMesh.sourceTriangleCount)),
    optimizedTriangleCount: Math.max(0, Math.trunc(optimizedMesh.optimizedTriangleCount)),
    surfaceRevision,
    runtimeHydratedHeightState: hydratedHeightState,
    runtimeDisableOptimizedChunks: runtimeDefinition.runtimeDisableOptimizedChunks === true,
  } as const

  if (runtimeDefinition.runtimeDisableOptimizedChunks === true) {
    return {
      ...base,
      runtimeChunkCells: sourceChunkCells,
      canUseOptimizedMesh: false,
      reason: 'runtime-disable-flag',
    }
  }

  if (runtimeDefinition.runtimeHydratedHeightState === 'dirty') {
    return {
      ...base,
      runtimeChunkCells: sourceChunkCells,
      canUseOptimizedMesh: false,
      reason: 'hydrated-state-dirty',
    }
  }

  if (surfaceRevision > 0) {
    return {
      ...base,
      runtimeChunkCells: sourceChunkCells,
      canUseOptimizedMesh: false,
      reason: 'surface-revision-dirty',
    }
  }

  if (runtimeDefinition.runtimeHydratedHeightState === 'pristine') {
    return {
      ...base,
      runtimeChunkCells: Math.max(1, Math.trunc(optimizedMesh.chunkCells)),
      canUseOptimizedMesh: true,
      reason: 'optimized-ready',
    }
  }

  const terrainHeightMap = runtimeDefinition.terrainHeightMap
  const limit = terrainHeightMap?.length ?? 0
  for (let index = 0; index < limit; index += 1) {
    const planning = terrainHeightMap[index]
    if (typeof planning === 'number' && Number.isFinite(planning)) {
      return {
        ...base,
        runtimeChunkCells: sourceChunkCells,
        canUseOptimizedMesh: false,
        reason: 'planning-height-overrides-present',
      }
    }
  }

  return {
    ...base,
    runtimeChunkCells: Math.max(1, Math.trunc(optimizedMesh.chunkCells)),
    canUseOptimizedMesh: true,
    reason: 'optimized-ready',
  }
}

export function setGroundRuntimeOptimizedChunksEnabled(
  definition: GroundDynamicMesh,
  enabled: boolean,
): GroundRuntimeDynamicMesh {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  runtimeDefinition.runtimeDisableOptimizedChunks = !enabled
  return runtimeDefinition
}

export function markGroundOptimizedMeshReady(
  definition: GroundDynamicMesh,
  optimizedMesh?: GroundOptimizedMeshData | null,
): GroundRuntimeDynamicMesh {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  if (optimizedMesh !== undefined) {
    runtimeDefinition.optimizedMesh = optimizedMesh
  }
  runtimeDefinition.surfaceRevision = 0
  runtimeDefinition.runtimeHydratedHeightState = 'pristine'
  runtimeDefinition.runtimeDisableOptimizedChunks = false
  return runtimeDefinition
}

export function resolveGroundChunkRadiusMeters(definition: GroundDynamicMesh): number {
  return resolveGroundChunkRadius(definition)
}

function resolveGroundChunkRadius(definition: GroundDynamicMesh): number {
  // Default to a moderate radius; keep streaming window smaller by default.
  const bounds = resolveGroundWorldBounds(definition)
  const width = Math.max(0, bounds.maxX - bounds.minX)
  const depth = Math.max(0, bounds.maxZ - bounds.minZ)
  const halfDiagonal = Math.sqrt(width * width + depth * depth) * 0.5
  // Bound the streaming radius so we don't accidentally load the entire ground for mid-sized scenes.
  // Keep a small minimum to avoid thrashing when the camera jitters.
  return Math.max(80, Math.min(2000, Math.min(DEFAULT_GROUND_CHUNK_RADIUS_METERS, halfDiagonal)))
}

function clampVertexIndex(value: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  if (value < 0) {
    return 0
  }
  if (value > max) {
    return max
  }
  return value
}

function ensureGroundRuntimeDefinition(definition: GroundDynamicMesh): GroundRuntimeDynamicMesh {
  // 将普通地形定义视为运行时定义来处理，并补齐编辑、采样和缓存所需的运行时字段。
  const runtimeDefinition = definition as GroundRuntimeDynamicMesh
  // 根据当前世界边界、cellSize 和 chunk 参数计算工作网格尺寸。
  // 后续所有高度图、编辑图和采样索引都要依赖这个尺寸，所以这里必须先统一。
  const gridSize = resolveGroundWorkingGridSizeCached(runtimeDefinition)
  // 规划高度图用于未提交前的预览态或规划态数据，同样需要和当前工作网格严格对齐。
  runtimeDefinition.terrainHeightMap = ensureGroundHeightMap(
    runtimeDefinition.terrainHeightMap,
    gridSize.rows,
    gridSize.columns,
  )
  // 运行时已加载的 tile key 必须是数组，后续遍历和追加时才能保持稳定行为。
  if (!Array.isArray(runtimeDefinition.runtimeLoadedTileKeys)) {
    runtimeDefinition.runtimeLoadedTileKeys = []
  }
  return runtimeDefinition
}

function countGroundHeightOverrides(map: GroundHeightMap | null | undefined): number {
  const length = map?.length ?? 0
  let count = 0
  for (let index = 0; index < length; index += 1) {
    if (Number.isFinite(map![index])) {
      count += 1
    }
  }
  return count
}

function adjustRuntimeGroundHeightOverrideCount(
  definition: GroundRuntimeDynamicMesh,
  map: GroundHeightMap,
  delta: number,
): void {
  if (!Number.isFinite(delta) || delta === 0) {
    return
  }

  if (definition.runtimeEditHeightOverrideSourceRef === map && Number.isFinite(definition.runtimeEditHeightOverrideCount)) {
    definition.runtimeEditHeightOverrideCount = Math.max(
      0,
      Math.trunc(definition.runtimeEditHeightOverrideCount as number) + Math.trunc(delta),
    )
    definition.runtimeEditHeightOverrideSourceLength = map.length
  }
}

function ensureRuntimeGroundHeightOverrideCounts(definition: GroundRuntimeDynamicMesh): void {
  const terrainHeightMap = definition.terrainHeightMap
  const planningLength = terrainHeightMap?.length ?? 0

  if (
    definition.runtimeEditHeightOverrideSourceRef !== terrainHeightMap
    || definition.runtimeEditHeightOverrideSourceLength !== planningLength
    || !Number.isFinite(definition.runtimeEditHeightOverrideCount)
  ) {
    definition.runtimeEditHeightOverrideCount = countGroundHeightOverrides(terrainHeightMap)
    definition.runtimeEditHeightOverrideSourceRef = terrainHeightMap
    definition.runtimeEditHeightOverrideSourceLength = planningLength
  }
}

function hasRuntimeGroundHeightOverrides(definition: GroundRuntimeDynamicMesh): boolean {
  if (definition.runtimeDisableOptimizedChunks === true || definition.runtimeHydratedHeightState === 'dirty') {
    return true
  }

  if (Number.isFinite(definition.surfaceRevision) && Math.trunc(definition.surfaceRevision as number) > 0) {
    definition.runtimeHydratedHeightState = 'dirty'
    definition.runtimeDisableOptimizedChunks = true
    return true
  }

  if (definition.runtimeHydratedHeightState === 'pristine') {
    definition.runtimeDisableOptimizedChunks = false
    return false
  }

  const localEditTiles = definition.localEditTiles && typeof definition.localEditTiles === 'object'
    ? Object.values(definition.localEditTiles)
    : []
  if (localEditTiles.length > 0) {
    definition.runtimeHydratedHeightState = 'dirty'
    definition.runtimeDisableOptimizedChunks = true
    return true
  }

  ensureRuntimeGroundHeightOverrideCounts(definition)
  const editOverrideCount = definition.runtimeEditHeightOverrideCount
  if (Number.isFinite(editOverrideCount)) {
    if ((editOverrideCount ?? 0) > 0) {
      definition.runtimeHydratedHeightState = 'dirty'
      definition.runtimeDisableOptimizedChunks = true
      return true
    }
    definition.runtimeDisableOptimizedChunks = false
    return false
  }

  definition.runtimeDisableOptimizedChunks = false
  return false
}

function invalidateGroundLocalEditTileCaches(definition: GroundRuntimeDynamicMesh): void {
  invalidateGroundDefinitionStructureSignature(definition)
  const source = definition.localEditTiles && typeof definition.localEditTiles === 'object'
    ? definition.localEditTiles
    : null
  if (source) {
    groundLocalEditTileCacheBySource.delete(source)
    groundLocalEditTileCoverageIndexBySource.delete(source)
  }
  definition.runtimeLocalEditTileArrayCache = undefined
  definition.runtimeLocalEditTileLookupCache = undefined
  definition.runtimeLocalEditTileCoverageIndexCache = undefined
  definition.runtimeLocalEditTileSourceRef = undefined
  definition.runtimeLocalEditTileCoverageIndexSourceRef = undefined
  definition.runtimeLocalEditTileCoverageIndexBucketChunks = undefined
}

function resolveGroundLocalEditTileCacheFromSource(source: GroundLocalEditTileMap | null): GroundLocalEditTileCache {
  if (!source) {
    return EMPTY_GROUND_LOCAL_EDIT_TILE_CACHE
  }
  const cached = groundLocalEditTileCacheBySource.get(source)
  if (cached) {
    return cached
  }

  const tiles = Object.values(source)
  const lookup = new Map<string, GroundLocalEditTileData>()
  for (const tile of tiles) {
    lookup.set(formatGroundLocalEditTileKey(tile.tileRow, tile.tileColumn), tile)
  }
  const next = { tiles, lookup }
  groundLocalEditTileCacheBySource.set(source, next)
  return next
}

function ensureGroundLocalEditTileCaches(
  definition: GroundDynamicMesh,
): {
  tiles: GroundLocalEditTileData[]
  lookup: Map<string, GroundLocalEditTileData>
} {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  const source = runtimeDefinition.localEditTiles && typeof runtimeDefinition.localEditTiles === 'object'
    ? runtimeDefinition.localEditTiles
    : null

  if (!source) {
    runtimeDefinition.runtimeLocalEditTileArrayCache = EMPTY_GROUND_LOCAL_EDIT_TILE_CACHE.tiles
    runtimeDefinition.runtimeLocalEditTileLookupCache = EMPTY_GROUND_LOCAL_EDIT_TILE_CACHE.lookup
    runtimeDefinition.runtimeLocalEditTileCoverageIndexCache = new Map<string, GroundLocalEditTileData[]>()
    runtimeDefinition.runtimeLocalEditTileSourceRef = null
    runtimeDefinition.runtimeLocalEditTileCoverageIndexSourceRef = null
    runtimeDefinition.runtimeLocalEditTileCoverageIndexBucketChunks = GROUND_LOCAL_EDIT_TILE_COVERAGE_BUCKET_CHUNKS
    return {
      tiles: runtimeDefinition.runtimeLocalEditTileArrayCache,
      lookup: runtimeDefinition.runtimeLocalEditTileLookupCache,
    }
  }

  if (
    runtimeDefinition.runtimeLocalEditTileSourceRef !== source
    || !Array.isArray(runtimeDefinition.runtimeLocalEditTileArrayCache)
    || !(runtimeDefinition.runtimeLocalEditTileLookupCache instanceof Map)
  ) {
    const cache = resolveGroundLocalEditTileCacheFromSource(source)
    runtimeDefinition.runtimeLocalEditTileArrayCache = cache.tiles
    runtimeDefinition.runtimeLocalEditTileLookupCache = cache.lookup
    runtimeDefinition.runtimeLocalEditTileSourceRef = source
  }

  return {
    tiles: runtimeDefinition.runtimeLocalEditTileArrayCache,
    lookup: runtimeDefinition.runtimeLocalEditTileLookupCache,
  }
}

function ensureGroundLocalEditTileCachesFromRuntime(
  definition: GroundRuntimeDynamicMesh,
): {
  tiles: GroundLocalEditTileData[]
  lookup: Map<string, GroundLocalEditTileData>
} {
  const source = definition.localEditTiles && typeof definition.localEditTiles === 'object'
    ? definition.localEditTiles
    : null

  if (!source) {
    definition.runtimeLocalEditTileArrayCache = EMPTY_GROUND_LOCAL_EDIT_TILE_CACHE.tiles
    definition.runtimeLocalEditTileLookupCache = EMPTY_GROUND_LOCAL_EDIT_TILE_CACHE.lookup
    definition.runtimeLocalEditTileSourceRef = null
    return {
      tiles: definition.runtimeLocalEditTileArrayCache,
      lookup: definition.runtimeLocalEditTileLookupCache,
    }
  }

  if (
    definition.runtimeLocalEditTileSourceRef !== source
    || !Array.isArray(definition.runtimeLocalEditTileArrayCache)
    || !(definition.runtimeLocalEditTileLookupCache instanceof Map)
  ) {
    const cache = resolveGroundLocalEditTileCacheFromSource(source)
    definition.runtimeLocalEditTileArrayCache = cache.tiles
    definition.runtimeLocalEditTileLookupCache = cache.lookup
    definition.runtimeLocalEditTileSourceRef = source
  }

  return {
    tiles: definition.runtimeLocalEditTileArrayCache,
    lookup: definition.runtimeLocalEditTileLookupCache,
  }
}

function resolveGroundLocalEditTileLookupFromRuntime(
  definition: GroundRuntimeDynamicMesh,
): Map<string, GroundLocalEditTileData> | null {
  const source = definition.localEditTiles && typeof definition.localEditTiles === 'object'
    ? definition.localEditTiles
    : null

  if (!source) {
    if (definition.runtimeLocalEditTileSourceRef === null && definition.runtimeLocalEditTileLookupCache instanceof Map) {
      return definition.runtimeLocalEditTileLookupCache
    }
    return null
  }

  if (
    definition.runtimeLocalEditTileSourceRef === source
    && definition.runtimeLocalEditTileLookupCache instanceof Map
  ) {
    return definition.runtimeLocalEditTileLookupCache
  }

  const cache = resolveGroundLocalEditTileCacheFromSource(source)
  definition.runtimeLocalEditTileArrayCache = cache.tiles
  definition.runtimeLocalEditTileLookupCache = cache.lookup
  definition.runtimeLocalEditTileSourceRef = source
  return cache.lookup
}

function resolveGroundLocalEditTileCoverageBucketKey(chunkRow: number, chunkColumn: number, bucketChunks = GROUND_LOCAL_EDIT_TILE_COVERAGE_BUCKET_CHUNKS): string {
  const safeBucketChunks = Math.max(1, Math.trunc(bucketChunks))
  return `${Math.floor(chunkRow / safeBucketChunks)}:${Math.floor(chunkColumn / safeBucketChunks)}`
}

function ensureGroundLocalEditTileCoverageIndex(
  definition: GroundRuntimeDynamicMesh,
): Map<string, GroundLocalEditTileData[]> {
  const runtimeDefinition = definition
  const tiles = ensureGroundLocalEditTileCachesFromRuntime(runtimeDefinition).tiles
  const bucketChunks = GROUND_LOCAL_EDIT_TILE_COVERAGE_BUCKET_CHUNKS
  const sourceRef = runtimeDefinition.localEditTiles && typeof runtimeDefinition.localEditTiles === 'object'
    ? runtimeDefinition.localEditTiles
    : null
  const chunkSizeMeters = resolveInfiniteChunkSizeMeters(runtimeDefinition)
  const sharedCoverageCacheKey = `${bucketChunks}:${chunkSizeMeters}`

  if (
    !sourceRef
    && runtimeDefinition.runtimeLocalEditTileCoverageIndexCache instanceof Map
    && runtimeDefinition.runtimeLocalEditTileCoverageIndexSourceRef === sourceRef
    && runtimeDefinition.runtimeLocalEditTileCoverageIndexBucketChunks === bucketChunks
  ) {
    return runtimeDefinition.runtimeLocalEditTileCoverageIndexCache
  }

  if (sourceRef) {
    const shared = groundLocalEditTileCoverageIndexBySource.get(sourceRef)
    if (shared?.cacheKey === sharedCoverageCacheKey) {
      runtimeDefinition.runtimeLocalEditTileCoverageIndexCache = shared.index
      runtimeDefinition.runtimeLocalEditTileCoverageIndexSourceRef = sourceRef
      runtimeDefinition.runtimeLocalEditTileCoverageIndexBucketChunks = bucketChunks
      return shared.index
    }
  }

  const index = new Map<string, GroundLocalEditTileData[]>()
  if (tiles.length) {
    for (const tile of tiles) {
      const tileSizeMeters = Number(tile.tileSizeMeters)
      if (!Number.isFinite(tileSizeMeters) || tileSizeMeters <= 0) {
        continue
      }
      const { minX, minZ } = resolveGroundLocalEditTileWorldMinFromRuntime(runtimeDefinition, tile.tileRow, tile.tileColumn, tileSizeMeters)
      const maxX = minX + tileSizeMeters
      const maxZ = minZ + tileSizeMeters
      const maxEdgeEpsilon = Math.max(1e-9, chunkSizeMeters * 1e-9)
      const minChunk = resolveGroundChunkCoordFromWorldPosition(minX, minZ, chunkSizeMeters)
      const maxChunk = resolveGroundChunkCoordFromWorldPosition(maxX - maxEdgeEpsilon, maxZ - maxEdgeEpsilon, chunkSizeMeters)
      const minBucketRow = Math.floor(minChunk.chunkZ / bucketChunks)
      const maxBucketRow = Math.floor(maxChunk.chunkZ / bucketChunks)
      const minBucketColumn = Math.floor(minChunk.chunkX / bucketChunks)
      const maxBucketColumn = Math.floor(maxChunk.chunkX / bucketChunks)

      for (let bucketRow = minBucketRow; bucketRow <= maxBucketRow; bucketRow += 1) {
        for (let bucketColumn = minBucketColumn; bucketColumn <= maxBucketColumn; bucketColumn += 1) {
          const bucketKey = `${bucketRow}:${bucketColumn}`
          const bucket = index.get(bucketKey)
          if (bucket) {
            bucket.push(tile)
          } else {
            index.set(bucketKey, [tile])
          }
        }
      }
    }
  }

  runtimeDefinition.runtimeLocalEditTileCoverageIndexCache = index
  runtimeDefinition.runtimeLocalEditTileCoverageIndexSourceRef = sourceRef
  runtimeDefinition.runtimeLocalEditTileCoverageIndexBucketChunks = bucketChunks
  if (sourceRef) {
    groundLocalEditTileCoverageIndexBySource.set(sourceRef, {
      cacheKey: sharedCoverageCacheKey,
      index,
    })
  }
  return index
}

function getGroundLocalEditTileCandidatesForChunk(
  runtimeDefinition: GroundRuntimeDynamicMesh,
  spec: GroundChunkSpec,
  tiles: ReadonlyArray<GroundLocalEditTileData> = ensureGroundLocalEditTileCachesFromRuntime(runtimeDefinition).tiles,
): ReadonlyArray<GroundLocalEditTileData> {
  if (!tiles.length) {
    return tiles
  }

  const index = ensureGroundLocalEditTileCoverageIndex(runtimeDefinition)
  if (!index.size) {
    return tiles
  }

  const cellSize = Number.isFinite(runtimeDefinition.cellSize) && runtimeDefinition.cellSize > 1e-6
    ? runtimeDefinition.cellSize
    : 1
  const chunkSizeMeters = resolveInfiniteChunkSizeMeters(runtimeDefinition)
  const chunkOrigin = resolveInfiniteGroundGridOriginMeters(chunkSizeMeters)
  const chunkMinX = chunkOrigin + spec.startColumn * cellSize
  const chunkMinZ = chunkOrigin + spec.startRow * cellSize
  const chunkCoord = resolveGroundChunkCoordFromWorldPosition(chunkMinX, chunkMinZ, chunkSizeMeters)
  const bucketKey = resolveGroundLocalEditTileCoverageBucketKey(chunkCoord.chunkZ, chunkCoord.chunkX)
  return index.get(bucketKey) ?? []
}

function getGroundLocalEditTiles(definition: GroundDynamicMesh): GroundLocalEditTileData[] {
  return ensureGroundLocalEditTileCaches(definition).tiles
}

function resolveGroundLocalEditTileGridOriginFromRuntime(
  definition: GroundRuntimeDynamicMesh,
  tileSizeMeters = resolveGroundEditTileSizeMeters(definition),
): { cacheKey: string; originX: number; originZ: number } {
  const safeTileSize = Number.isFinite(tileSizeMeters) && tileSizeMeters > 0
    ? tileSizeMeters
    : resolveGroundEditTileSizeMeters(definition)
  const cacheKey = `infinite:${safeTileSize}`
  const cached = definition.runtimeLocalEditTileGridOriginCache
  if (cached?.cacheKey === cacheKey) {
    return cached
  }
  const next = {
    cacheKey,
    originX: resolveInfiniteGroundGridOriginMeters(safeTileSize),
    originZ: resolveInfiniteGroundGridOriginMeters(safeTileSize),
  }
  definition.runtimeLocalEditTileGridOriginCache = next
  return next
}

function resolveGroundLocalEditTileGridOrigin(
  definition: GroundDynamicMesh,
  tileSizeMeters = resolveGroundEditTileSizeMeters(definition),
): { originX: number; originZ: number } {
  return resolveGroundLocalEditTileGridOriginFromRuntime(ensureGroundRuntimeDefinition(definition), tileSizeMeters)
}

function resolveGroundLocalEditTileCoordAtWorldFromRuntime(
  definition: GroundRuntimeDynamicMesh,
  x: number,
  z: number,
  tileSizeMeters: number,
): { tileRow: number; tileColumn: number } | null {
  if (!Number.isFinite(tileSizeMeters) || tileSizeMeters <= 0) {
    return null
  }
  const { originX, originZ } = resolveGroundLocalEditTileGridOriginFromRuntime(definition, tileSizeMeters)
  const tileColumn = Math.floor((x - originX) / tileSizeMeters)
  const tileRow = Math.floor((z - originZ) / tileSizeMeters)
  if (!Number.isFinite(tileRow) || !Number.isFinite(tileColumn)) {
    return null
  }
  return {
    tileRow,
    tileColumn,
  }
}

function resolveGroundLocalEditTileCoordAtWorld(
  definition: GroundDynamicMesh,
  x: number,
  z: number,
  tileSizeMeters: number,
): { tileRow: number; tileColumn: number } | null {
  return resolveGroundLocalEditTileCoordAtWorldFromRuntime(ensureGroundRuntimeDefinition(definition), x, z, tileSizeMeters)
}

function resolveGroundLocalEditTileWorldMin(
  definition: GroundDynamicMesh,
  tileRow: number,
  tileColumn: number,
  tileSizeMeters: number,
): { minX: number; minZ: number } {
  const { originX, originZ } = resolveGroundLocalEditTileGridOrigin(definition, tileSizeMeters)
  return {
    minX: originX + tileColumn * tileSizeMeters,
    minZ: originZ + tileRow * tileSizeMeters,
  }
}

function resolveGroundLocalEditTileWorldMinFromRuntime(
  definition: GroundRuntimeDynamicMesh,
  tileRow: number,
  tileColumn: number,
  tileSizeMeters: number,
): { minX: number; minZ: number } {
  const { originX, originZ } = resolveGroundLocalEditTileGridOriginFromRuntime(definition, tileSizeMeters)
  return {
    minX: originX + tileColumn * tileSizeMeters,
    minZ: originZ + tileRow * tileSizeMeters,
  }
}

function getGroundLocalEditHeightAtGlobalVertex(
  definition: GroundRuntimeDynamicMesh,
  globalRow: number,
  globalColumn: number,
  resolution = resolveGroundEditTileResolution(definition),
): number | null {
  const safeResolution = Math.max(1, Math.trunc(resolution))
  const lookup = resolveGroundLocalEditTileLookupFromRuntime(definition)
  if (!(lookup instanceof Map) || lookup.size === 0) {
    return null
  }

  const baseTileRow = Math.floor(globalRow / safeResolution)
  const baseTileColumn = Math.floor(globalColumn / safeResolution)
  const baseLocalRow = globalRow - baseTileRow * safeResolution
  const baseLocalColumn = globalColumn - baseTileColumn * safeResolution

  const candidateRows = baseLocalRow === 0
    ? [
      { tileRow: baseTileRow, localRow: 0 },
      { tileRow: baseTileRow - 1, localRow: safeResolution },
    ]
    : [{ tileRow: baseTileRow, localRow: baseLocalRow }]
  const candidateColumns = baseLocalColumn === 0
    ? [
      { tileColumn: baseTileColumn, localColumn: 0 },
      { tileColumn: baseTileColumn - 1, localColumn: safeResolution },
    ]
    : [{ tileColumn: baseTileColumn, localColumn: baseLocalColumn }]

  for (const rowCandidate of candidateRows) {
    for (const columnCandidate of candidateColumns) {
      const tile = lookup.get(formatGroundLocalEditTileKey(rowCandidate.tileRow, columnCandidate.tileColumn))
      if (!tile) {
        continue
      }
      const value = getGroundLocalEditTileStoredValue(tile, rowCandidate.localRow, columnCandidate.localColumn)
      if (Number.isFinite(value)) {
        return value
      }
    }
  }
  return null
}

function interpolateCatmullRomScalar(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (
    (2 * p1)
    + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  )
}


function sampleGroundLocalEditHeightAtWorldFromRuntime(
  runtimeDefinition: GroundRuntimeDynamicMesh,
  x: number,
  z: number,
): number | null {
  const tileSizeMeters = resolveGroundEditTileSizeMeters(runtimeDefinition)
  const resolution = resolveGroundEditTileResolution(runtimeDefinition)
  if (!(tileSizeMeters > 0) || !(resolution > 0)) {
    return null
  }
  const lookup = resolveGroundLocalEditTileLookupFromRuntime(runtimeDefinition)
  if (!(lookup instanceof Map) || lookup.size === 0) {
    return null
  }

  const { originX, originZ } = resolveGroundLocalEditTileGridOriginFromRuntime(runtimeDefinition, tileSizeMeters)
  const cellSize = tileSizeMeters / Math.max(1, resolution)
  if (!(cellSize > 0)) {
    return null
  }
  const sampleX = (x - originX) / Math.max(cellSize, Number.EPSILON)
  const sampleZ = (z - originZ) / Math.max(cellSize, Number.EPSILON)
  if (!Number.isFinite(sampleX) || !Number.isFinite(sampleZ)) {
    return null
  }
  const column0 = Math.floor(sampleX)
  const row0 = Math.floor(sampleZ)
  const column1 = column0 + 1
  const row1 = row0 + 1
  const blendX = clampInclusive(sampleX - column0, 0, 1)
  const blendZ = clampInclusive(sampleZ - row0, 0, 1)

  const read = (row: number, column: number): number | null => getGroundLocalEditHeightAtGlobalVertex(runtimeDefinition, row, column, resolution)
  const cubicSamples: number[][] = []
  let canUseCubic = true
  for (let rowOffset = -1; rowOffset <= 2; rowOffset += 1) {
    const sampleRow: number[] = []
    for (let columnOffset = -1; columnOffset <= 2; columnOffset += 1) {
      const value = read(row0 + rowOffset, column0 + columnOffset)
      if (!Number.isFinite(value)) {
        canUseCubic = false
        break
      }
      sampleRow.push(value as number)
    }
    if (!canUseCubic) {
      break
    }
    cubicSamples.push(sampleRow)
  }
  if (canUseCubic && cubicSamples.length === 4 && cubicSamples.every((row) => row.length === 4)) {
    const interpolatedRows = cubicSamples.map((row) => interpolateCatmullRomScalar(row[0]!, row[1]!, row[2]!, row[3]!, blendX))
    return interpolateCatmullRomScalar(
      interpolatedRows[0]!,
      interpolatedRows[1]!,
      interpolatedRows[2]!,
      interpolatedRows[3]!,
      blendZ,
    )
  }

  const h00 = read(row0, column0)
  const h10 = read(row0, column1)
  const h01 = read(row1, column0)
  const h11 = read(row1, column1)
  const blendEpsilon = 1e-6
  const usesLeftColumn = blendX <= blendEpsilon
  const usesRightColumn = blendX >= 1 - blendEpsilon
  const usesTopRow = blendZ <= blendEpsilon
  const usesBottomRow = blendZ >= 1 - blendEpsilon

  if (usesLeftColumn && usesTopRow) {
    return h00
  }
  if (usesRightColumn && usesTopRow) {
    return h10
  }
  if (usesLeftColumn && usesBottomRow) {
    return h01
  }
  if (usesRightColumn && usesBottomRow) {
    return h11
  }
  if (usesLeftColumn) {
    if (h00 === null || h01 === null) {
      return null
    }
    return h00 + (h01 - h00) * blendZ
  }
  if (usesRightColumn) {
    if (h10 === null || h11 === null) {
      return null
    }
    return h10 + (h11 - h10) * blendZ
  }
  if (usesTopRow) {
    if (h00 === null || h10 === null) {
      return null
    }
    return h00 + (h10 - h00) * blendX
  }
  if (usesBottomRow) {
    if (h01 === null || h11 === null) {
      return null
    }
    return h01 + (h11 - h01) * blendX
  }
  if (h00 === null || h10 === null || h01 === null || h11 === null) {
    return null
  }
  const hx0 = h00 + (h10 - h00) * blendX
  const hx1 = h01 + (h11 - h01) * blendX
  return hx0 + (hx1 - hx0) * blendZ
}

function chunkIntersectsGroundLocalEditTileFromRuntime(
  runtimeDefinition: GroundRuntimeDynamicMesh,
  spec: GroundChunkSpec,
  tiles: ReadonlyArray<GroundLocalEditTileData> = getGroundLocalEditTiles(runtimeDefinition),
): boolean {
  const candidateTiles = getGroundLocalEditTileCandidatesForChunk(runtimeDefinition, spec, tiles)
  if (!candidateTiles.length) {
    return false
  }
  const cellSize = Number.isFinite(runtimeDefinition.cellSize) && runtimeDefinition.cellSize > 1e-6
    ? runtimeDefinition.cellSize
    : 1
  const chunkSizeMeters = resolveGroundEditTileSizeMeters(runtimeDefinition)
  const chunkOrigin = resolveInfiniteGroundGridOriginMeters(chunkSizeMeters)
  const chunkMinX = chunkOrigin + spec.startColumn * cellSize
  const chunkMaxX = chunkOrigin + (spec.startColumn + spec.columns) * cellSize
  const chunkMinZ = chunkOrigin + spec.startRow * cellSize
  const chunkMaxZ = chunkOrigin + (spec.startRow + spec.rows) * cellSize
  return candidateTiles.some((tile) => {
    const tileSizeMeters = Number(tile.tileSizeMeters)
    if (!Number.isFinite(tileSizeMeters) || tileSizeMeters <= 0) {
      return false
    }
    const { minX: tileMinX, minZ: tileMinZ } = resolveGroundLocalEditTileWorldMinFromRuntime(runtimeDefinition, tile.tileRow, tile.tileColumn, tileSizeMeters)
    const tileMaxX = tileMinX + tileSizeMeters
    const tileMaxZ = tileMinZ + tileSizeMeters
    return tileMaxX > chunkMinX
      && tileMinX < chunkMaxX
      && tileMaxZ > chunkMinZ
      && tileMinZ < chunkMaxZ
  })
}

function resolveGroundChunkWorldBoundsFromSpec(
  definition: Pick<GroundDynamicMesh, 'cellSize' | 'worldBounds' | 'chunkSizeMeters' | 'renderRadiusChunks' | 'collisionRadiusChunks'>,
  spec: GroundChunkSpec,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 1e-6 ? definition.cellSize : 1
  const chunkSizeMeters = resolveInfiniteChunkSizeMeters(definition)
  const chunkOrigin = resolveInfiniteGroundGridOriginMeters(chunkSizeMeters)
  return {
    minX: chunkOrigin + spec.startColumn * cellSize,
    maxX: chunkOrigin + (spec.startColumn + spec.columns) * cellSize,
    minZ: chunkOrigin + spec.startRow * cellSize,
    maxZ: chunkOrigin + (spec.startRow + spec.rows) * cellSize,
  }
}

export function canTreatGroundChunkAsFlatPlane(
  definition: GroundDynamicMesh,
  chunkRow: number,
  chunkColumn: number,
  options: { allowBakedSurfaceTexture?: boolean } = {},
): boolean {
  const normalizedChunkRow = Math.trunc(Number(chunkRow))
  const normalizedChunkColumn = Math.trunc(Number(chunkColumn))
  if (!Number.isFinite(normalizedChunkRow) || !Number.isFinite(normalizedChunkColumn)) {
    return false
  }
  void definition
  void options
  return true
}

  function resolveImportedLocalEditCellSize(definition: GroundRuntimeDynamicMesh): number | null {
    const metadata = definition.planningMetadata as GroundPlanningMetadata | null | undefined
    const demSource = metadata?.demSource
    if (!demSource) {
      return null
    }
    const effectiveCellSize = Number(demSource.localEditCellSize)
    if (Number.isFinite(effectiveCellSize) && effectiveCellSize > 0) {
      return Math.max(1e-6, effectiveCellSize)
    }
    const appliedSampleStepMeters = Number(demSource.appliedSampleStepMeters)
    if (Number.isFinite(appliedSampleStepMeters) && appliedSampleStepMeters > 0) {
      return Math.max(1e-6, appliedSampleStepMeters)
    }
    const candidates = [demSource.sampleStepMeters, demSource.sampleStepX, demSource.sampleStepY]
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
    if (!candidates.length) {
      return null
    }
    return Math.max(1e-6, Math.min(...candidates))
  }

  function resolveGroundChunkLocalEditCellSize(definition: GroundRuntimeDynamicMesh, spec: GroundChunkSpec): number {
    const baseCellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 1e-6 ? definition.cellSize : 1
    const tiles = getGroundLocalEditTiles(definition)
    const candidateTiles = getGroundLocalEditTileCandidatesForChunk(definition, spec, tiles)
    if (!candidateTiles.length) {
      return baseCellSize
    }

    const { minX: chunkMinX, maxX: chunkMaxX, minZ: chunkMinZ, maxZ: chunkMaxZ } = resolveGroundChunkWorldBoundsFromSpec(definition, spec)

    let hasImportedTiles = false
    const overlappingImportedTileKeys: string[] = []
    const overlappingNonDemTileKeys: string[] = []
    for (const tile of candidateTiles) {
      const tileSizeMeters = Number(tile.tileSizeMeters)
      if (!Number.isFinite(tileSizeMeters) || tileSizeMeters <= 0) {
        return baseCellSize
      }
      const { minX: tileMinX, minZ: tileMinZ } = resolveGroundLocalEditTileWorldMinFromRuntime(definition, tile.tileRow, tile.tileColumn, tileSizeMeters)
      const tileMaxX = tileMinX + tileSizeMeters
      const tileMaxZ = tileMinZ + tileSizeMeters
      if (!(tileMaxX > chunkMinX && tileMinX < chunkMaxX && tileMaxZ > chunkMinZ && tileMinZ < chunkMaxZ)) {
        continue
      }
      if (tile.source !== 'dem') {
        overlappingNonDemTileKeys.push(formatGroundLocalEditTileKey(tile.tileRow, tile.tileColumn))
        return baseCellSize
      }
      hasImportedTiles = true
      overlappingImportedTileKeys.push(formatGroundLocalEditTileKey(tile.tileRow, tile.tileColumn))
    }

    if (!hasImportedTiles) {
      return baseCellSize
    }

    const importedCellSize = resolveImportedLocalEditCellSize(definition)
    const resolvedCellSize = importedCellSize ? Math.max(baseCellSize, importedCellSize) : baseCellSize

    return resolvedCellSize
  }

type GroundChunkGeometryLayout = {
  segmentRows: number
  segmentColumns: number
  stepX: number
  stepZ: number
}

function resolveGroundChunkGeometryLayout(definition: GroundRuntimeDynamicMesh, spec: GroundChunkSpec): GroundChunkGeometryLayout {
  const baseRows = Math.max(1, Math.trunc(spec.rows))
  const baseColumns = Math.max(1, Math.trunc(spec.columns))
  const baseCellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 1e-6 ? definition.cellSize : 1
  const localEditCellSize = resolveGroundChunkLocalEditCellSize(definition, spec)
  if (localEditCellSize <= baseCellSize) {
    return {
      segmentRows: baseRows,
      segmentColumns: baseColumns,
      stepX: baseCellSize,
      stepZ: baseCellSize,
    }
  }
  const worldWidth = baseColumns * baseCellSize
  const worldDepth = baseRows * baseCellSize
  const segmentColumns = Math.max(1, Math.ceil(worldWidth / localEditCellSize))
  const segmentRows = Math.max(1, Math.ceil(worldDepth / localEditCellSize))

  return {
    segmentRows,
    segmentColumns,
    stepX: worldWidth / segmentColumns,
    stepZ: worldDepth / segmentRows,
  }
}

/**
 * 计算某个顶点的“最终有效高度”。
 *
 * 这里的地形高度不是单一来源，而是由三层概念叠加得到：
 * 1. base: 纯程序化生成得到的基础高度，代表未做任何额外编辑时的原始地形。
 * 2. planning: 规划层高度，代表生成/规划流程想要得到的目标地形。
 * 3. manual: 手工层高度，代表用户雕刻后保存下来的绝对高度。
 *
 * 当前实现并不是简单地在 planning 与 manual 之间二选一，而是保留“手工层相对 base 的偏移量”：
 * manual - base = 用户相对原始地形做出的雕刻量。
 *
 * 最终把这段雕刻量叠加到 planning 上：
 * effective = planning + (manual - base)
 *
 * 这样做的目的，是当规划层重新生成或被调整后，用户之前的雕刻结果仍能尽量保持：
 * 用户修改的是“相对地形的局部塑形”，而不是把规划层完全覆盖掉。
 */
export function resolveGroundEffectiveHeightAtVertex(definition: GroundDynamicMesh, row: number, column: number): number {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  const localEditSample = sampleGroundLocalEditHeightAtWorldFromRuntime(
    runtimeDefinition,
    resolveGroundWorldXForColumn(runtimeDefinition, column),
    resolveGroundWorldZForRow(runtimeDefinition, row),
  )
  if (Number.isFinite(localEditSample)) {
    return localEditSample as number
  }
  const terrainSampler = resolveRuntimeTerrainHeightSampler(runtimeDefinition)
  const terrainSample = terrainSampler
    ? terrainSampler.sampleHeightAtWorld(
        resolveGroundWorldXForColumn(runtimeDefinition, column),
        resolveGroundWorldZForRow(runtimeDefinition, row),
      )
    : null
  // 原始程序化地形高度，若存在 infinite/compiled 采样器则将其视为基础层。
  const base = Number.isFinite(terrainSample)
    ? (terrainSample as number)
    : computeGroundBaseHeightAtVertex(runtimeDefinition, row, column)
  const gridSize = resolveGroundWorkingGridSize(runtimeDefinition)
  const heightIndex = getGroundVertexIndex(gridSize.columns, row, column)
  // 规划/自动生成层的绝对高度；若无规划覆盖则同样退回 base。
  const planningRaw = runtimeDefinition.terrainHeightMap[heightIndex]
  const planning = typeof planningRaw === 'number' && Number.isFinite(planningRaw) ? planningRaw : base
  return planning
}

/**
 * Fast-path vertex height lookup using a pre-computed sampling context.
 * Avoids redundant calls to ensureGroundRuntimeDefinition, resolveGroundWorkingGridSize,
 * resolveGroundWorldXForColumn/ZForRow on every vertex — critical in scatter preview hot loops.
 */
function resolveGroundEffectiveHeightAtVertexWithContext(
  runtimeDefinition: GroundRuntimeDynamicMesh,
  row: number,
  column: number,
  columns: number,
  boundsMinX: number,
  boundsMinZ: number,
  cellSize: number,
  terrainSampler: GroundTerrainHeightSampler | null,
): number {
  const worldX = boundsMinX + column * cellSize
  const worldZ = boundsMinZ + row * cellSize
  const localEditSample = sampleGroundLocalEditHeightAtWorldFromRuntime(runtimeDefinition, worldX, worldZ)
  if (Number.isFinite(localEditSample)) {
    return localEditSample as number
  }
  if (terrainSampler) {
    const sampled = terrainSampler.sampleHeightAtWorld(worldX, worldZ)
    if (Number.isFinite(sampled)) {
      return sampled as number
    }
  }
  const base = computeGroundBaseHeightAtVertex(runtimeDefinition, row, column)
  const heightIndex = getGroundVertexIndex(columns, row, column)
  const planningRaw = runtimeDefinition.terrainHeightMap[heightIndex]
  const planning = typeof planningRaw === 'number' && Number.isFinite(planningRaw) ? planningRaw : base
  return planning
}

function sampleGroundHeightOutsideWorkingBounds(
  definition: GroundRuntimeDynamicMesh,
  x: number,
  z: number,
  terrainSampler: GroundTerrainHeightSampler | null | undefined = null,
): number {
  const safeTerrainSampler = terrainSampler && typeof terrainSampler.sampleHeightAtWorld === 'function'
    ? terrainSampler
    : null
  if (definition.terrainMode === 'infinite') {
    if (safeTerrainSampler) {
      const sampled = safeTerrainSampler.sampleHeightAtWorld(x, z)
      if (Number.isFinite(sampled)) {
        return sampled as number
      }
    }
    return sampleGroundBaseHeightAtWorld(definition, x, z)
  }
  return 0
}

export type GroundEffectiveHeightRegion = GroundBaseHeightRegion & {
  heightMin: number
  heightMax: number
}

export type GroundHeightFieldSampler = {
  rows: number
  columns: number
  getManualHeight: (row: number, column: number) => number
  getPlanningHeight: (row: number, column: number) => number
}

export function sampleGroundEffectiveHeightRegion(
  definition: GroundDynamicMesh,
  minRowInput: number,
  maxRowInput: number,
  minColumnInput: number,
  maxColumnInput: number,
): GroundEffectiveHeightRegion {
  return sampleGroundEffectiveHeightRegionInternal(definition, minRowInput, maxRowInput, minColumnInput, maxColumnInput, true)
}

function sampleGroundEffectiveHeightRegionInternal(
  definition: GroundDynamicMesh,
  minRowInput: number,
  maxRowInput: number,
  minColumnInput: number,
  maxColumnInput: number,
  includeLocalEdit: boolean,
): GroundEffectiveHeightRegion {
  // 先拿到运行时版本的地形定义，确保后续采样使用的是带缓存、带派生状态的对象。
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)

  // 先生成“基础高度区间”。
  // 这里的 baseRegion 只负责基础地形/原始地形的高度采样，不包含 manual、planning、local edit 等叠加层。
  // 后续会在这个基础上逐格补齐最终有效高度。
  const baseRegion = computeGroundBaseHeightRegion(runtimeDefinition, minRowInput, maxRowInput, minColumnInput, maxColumnInput)
  const { minRow, maxRow, minColumn, maxColumn, stride, values: baseValues } = baseRegion

  // 输出数组按 baseRegion 的 stride 和长度来分配，保证和基础采样区域完全对齐。
  // 这里最终写入的是“有效高度”，也就是用户真正会在编辑器里看到的结果。
  const total = baseValues.length
  const values = new Float32Array(total)

  // 记录当前区域的高度范围，方便后续做包围盒、调试信息或统计。
  let heightMin = 0
  let heightMax = 0

  // 如果采样范围无效，直接返回一个空的有效高度区域。
  // 这样上层可以统一处理，不需要单独判断异常情况。
  if (stride <= 0 || maxRow < minRow || maxColumn < minColumn) {
    return { ...baseRegion, values, heightMin, heightMax }
  }

  // 预先准备几个运行时缓存：
  // - gridSize：当前地形网格大小，用来从 row/column 计算 planning 的索引
  // - planningRegion：如果 runtime 已经能一次性返回整个区间，就直接复用，避免逐点查找
  // - terrainSampler：如果有外部地形采样器，就允许把采样点落到更高层的地形数据上
  const gridSize = resolveGroundWorkingGridSize(runtimeDefinition)
  const planningRegion = runtimeDefinition.runtimeSampleHeightRegion?.('planning', minRow, maxRow, minColumn, maxColumn)

  // 只有当 runtime 返回的区间和当前请求完全一致时，才安全复用它们。
  // 否则会出现 stride 或边界不一致的问题，所以必须回退到逐点读取。
  const canUsePlanningRegion = planningRegion
    && planningRegion.minRow === minRow
    && planningRegion.maxRow === maxRow
    && planningRegion.minColumn === minColumn
    && planningRegion.maxColumn === maxColumn
    && planningRegion.stride === stride
  const planningValues = canUsePlanningRegion ? planningRegion.values : null
  const terrainSampler = resolveRuntimeTerrainHeightSampler(runtimeDefinition)

  // local edit / terrainSampler 只在需要时才解析世界坐标边界。
  // 这样可以避免纯 base 采样路径额外创建不必要的世界坐标数据。
  const bounds = includeLocalEdit || terrainSampler ? resolveGroundGridWorldBounds(runtimeDefinition) : null
  const cellSize = Number.isFinite(runtimeDefinition.cellSize) && runtimeDefinition.cellSize > 1e-6
    ? runtimeDefinition.cellSize
    : 1

  // 逐个顶点计算最终有效高度：
  // 1. 先拿基础高度 base
  // 2. 如果启用了 local edit，就优先使用 local edit 的世界坐标采样结果
  // 3. 否则按 terrainSampler / planning / manual 的顺序合成最终高度
  // 4. 同时顺手统计 min / max，供后续使用
  for (let row = minRow; row <= maxRow; row += 1) {
    const baseOffset = (row - minRow) * stride
    const worldZ = bounds ? bounds.minZ + row * cellSize : 0
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const offset = baseOffset + (column - minColumn)
      const base = baseValues[offset] ?? 0
      const worldX = bounds ? bounds.minX + column * cellSize : 0

      // local edit 是最高优先级：
      // 只要当前点命中了局部雕刻 tile，就直接返回局部雕刻后的高度，
      // 这样可以保证编辑器里看到的形状与局部覆盖数据一致。
      const localEditSample = includeLocalEdit
        ? sampleGroundLocalEditHeightAtWorldFromRuntime(runtimeDefinition, worldX, worldZ)
        : null

      let effective: number
      if (Number.isFinite(localEditSample)) {
        effective = localEditSample as number
      } else {
        // 若没有 local edit，则考虑 terrainSampler 提供的外部地形采样。
        // 如果外部采样无效，就回退到 base 高度，保证函数总能返回一个确定值。
        const sampled = terrainSampler ? terrainSampler.sampleHeightAtWorld(worldX, worldZ) : null
        const terrainBase = Number.isFinite(sampled) ? (sampled as number) : base

        // localEdit 已经在最前面处理过；若没有局部覆盖，这里只保留规划层高度。
        const heightIndex = getGroundVertexIndex(gridSize.columns, row, column)
        const planningRaw = planningValues ? planningValues[offset] : runtimeDefinition.terrainHeightMap[heightIndex]
        const planning = typeof planningRaw === 'number' && Number.isFinite(planningRaw) ? planningRaw : terrainBase
        effective = planning
      }

      // 把最终有效高度写回输出区间，并同步更新统计范围。
      values[offset] = effective
      heightMin = Math.min(heightMin, effective)
      heightMax = Math.max(heightMax, effective)
    }
  }

  // 返回的 region 同时包含：
  // - 采样范围 min/max/stride
  // - 有效高度数组 values
  // - 当前区间的高度最小值和最大值
  return {
    minRow,
    maxRow,
    minColumn,
    maxColumn,
    stride,
    values,
    heightMin,
    heightMax,
  }
}

export function resolveGroundEffectiveHeightAtVertexFromSampler(
  definition: GroundDynamicMesh,
  sampler: GroundHeightFieldSampler,
  row: number,
  column: number,
): number {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  const base = computeGroundBaseHeightAtVertex(runtimeDefinition, row, column)
  const manualRaw = sampler.getManualHeight(row, column)
  const manual = Number.isFinite(manualRaw) ? manualRaw : base
  const planningRaw = sampler.getPlanningHeight(row, column)
  const planning = Number.isFinite(planningRaw) ? planningRaw : base
  return planning + (manual - base)
}

export function sampleGroundEffectiveHeightRegionFromSampler(
  definition: GroundDynamicMesh,
  sampler: GroundHeightFieldSampler,
  minRowInput: number,
  maxRowInput: number,
  minColumnInput: number,
  maxColumnInput: number,
): GroundEffectiveHeightRegion {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  const baseRegion = computeGroundBaseHeightRegion(runtimeDefinition, minRowInput, maxRowInput, minColumnInput, maxColumnInput)
  const { minRow, maxRow, minColumn, maxColumn, stride, values: baseValues } = baseRegion
  const total = baseValues.length
  const values = new Float32Array(total)
  let heightMin = 0
  let heightMax = 0

  if (stride <= 0 || maxRow < minRow || maxColumn < minColumn) {
    return { ...baseRegion, values, heightMin, heightMax }
  }

  for (let row = minRow; row <= maxRow; row += 1) {
    const baseOffset = (row - minRow) * stride
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const offset = baseOffset + (column - minColumn)
      const base = baseValues[offset] ?? 0
      const manualRaw = sampler.getManualHeight(row, column)
      const planningRaw = sampler.getPlanningHeight(row, column)
      const manual = Number.isFinite(manualRaw) ? manualRaw : base
      const planning = Number.isFinite(planningRaw) ? planningRaw : base
      const effective = planning + (manual - base)
      values[offset] = effective
      heightMin = Math.min(heightMin, effective)
      heightMax = Math.max(heightMax, effective)
    }
  }

  return {
    minRow,
    maxRow,
    minColumn,
    maxColumn,
    stride,
    values,
    heightMin,
    heightMax,
  }
}

function setHeightOverrideValue(definition: GroundRuntimeDynamicMesh, map: GroundHeightMap, row: number, column: number, value: number): void {
  const gridSize = resolveGroundWorkingGridSize(definition)
  const heightIndex = getGroundVertexIndex(gridSize.columns, row, column)
  const previousValue = map[heightIndex]
  const hadOverride = typeof previousValue === 'number' && Number.isFinite(previousValue)
  const baseHeight = computeGroundBaseHeightAtVertex(definition, row, column)
  // Preserve more precision for sculpt edits so small but visible changes
  // do not get rounded back to the base surface.
  let rounded = Math.round(value * 10000) / 10000
  let baseRounded = Math.round(baseHeight * 10000) / 10000
  if (Object.is(rounded, -0)) rounded = 0
  if (Object.is(baseRounded, -0)) baseRounded = 0
  if (rounded === baseRounded) {
    map[heightIndex] = GROUND_HEIGHT_UNSET_VALUE
    if (hadOverride) {
      adjustRuntimeGroundHeightOverrideCount(definition, map, -1)
    }
    return
  }
  map[heightIndex] = rounded
  if (!hadOverride) {
    adjustRuntimeGroundHeightOverrideCount(definition, map, 1)
  }
}

export function setPlanningHeightOverrideValue(definition: GroundRuntimeDynamicMesh, map: GroundHeightMap, row: number, column: number, value: number): void {
  setHeightOverrideValue(definition, map, row, column, value)
}

function setGroundCoverageHeightOverrideForEffectiveValue(
  definition: GroundRuntimeDynamicMesh,
  x: number,
  z: number,
  effectiveHeight: number,
): void {
  const localPlacement = shouldUseGroundLocalEditTiles(definition)
    ? resolveGroundLocalEditVertexPlacement(definition, x, z)
    : null
  if (!localPlacement) {
    return
  }

  const blendEpsilon = 1e-6
  const useLeftColumn = localPlacement.tx <= blendEpsilon
  const useRightColumn = localPlacement.tx >= 1 - blendEpsilon
  const useTopRow = localPlacement.tz <= blendEpsilon
  const useBottomRow = localPlacement.tz >= 1 - blendEpsilon
  if (useLeftColumn && useTopRow) {
    setGroundLocalEditTileValue(definition, localPlacement.tileRow, localPlacement.tileColumn, localPlacement.row0, localPlacement.column0, effectiveHeight)
    return
  }
  if (useRightColumn && useTopRow) {
    setGroundLocalEditTileValue(definition, localPlacement.tileRow, localPlacement.tileColumn, localPlacement.row0, localPlacement.column1, effectiveHeight)
    return
  }
  if (useLeftColumn && useBottomRow) {
    setGroundLocalEditTileValue(definition, localPlacement.tileRow, localPlacement.tileColumn, localPlacement.row1, localPlacement.column0, effectiveHeight)
    return
  }
  if (useRightColumn && useBottomRow) {
    setGroundLocalEditTileValue(definition, localPlacement.tileRow, localPlacement.tileColumn, localPlacement.row1, localPlacement.column1, effectiveHeight)
    return
  }
  setGroundLocalEditTileValue(definition, localPlacement.tileRow, localPlacement.tileColumn, localPlacement.row0, localPlacement.column0, effectiveHeight)
}

function sampleNeighborAverage(
  definition: GroundRuntimeDynamicMesh,
  row: number,
  column: number,
  maxRow: number,
  maxColumn: number,
): number {
  let sum = 0
  let count = 0
  for (let r = Math.max(0, row - 1); r <= Math.min(maxRow, row + 1); r += 1) {
    for (let c = Math.max(0, column - 1); c <= Math.min(maxColumn, column + 1); c += 1) {
      // 平滑操作必须基于最终有效高度采样邻域，
      // 否则会忽略 planning 与 manual 两层叠加后的真实地表形态。
      sum += resolveGroundEffectiveHeightAtVertex(definition, r, c)
      count += 1
    }
  }
  return count > 0 ? sum / count : 0
}

function sampleGroundSmoothAverageAtPoint(definition: GroundRuntimeDynamicMesh, x: number, z: number): number {
  const sampleDelta = Math.max(Number.EPSILON, resolveGroundEditCellSize(definition))
  let sum = 0
  let count = 0
  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
      sum += sampleGroundHeight(definition, x + columnOffset * sampleDelta, z + rowOffset * sampleDelta)
      count += 1
    }
  }
  return count > 0 ? sum / count : 0
}

type GroundHeightDeltaAccumulatorEntry = {
  mode: 'coarse' | 'local'
  delta: number
  weight: number
  row?: number
  column?: number
  tileRow?: number
  tileColumn?: number
  localRow?: number
  localColumn?: number
  tileSizeMeters?: number
  resolution?: number
}

function shouldUseGroundLocalEditTiles(definition: GroundRuntimeDynamicMesh): boolean {
  const editCellSize = resolveGroundEditCellSize(definition)
  return editCellSize > 0
}

function ensureGroundLocalEditTileStorage(
  definition: GroundRuntimeDynamicMesh,
  tileRow: number,
  tileColumn: number,
  tileSizeMeters = resolveGroundEditTileSizeMeters(definition),
  resolution = resolveGroundEditTileResolution(definition),
): GroundLocalEditTileData {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  const key = formatGroundLocalEditTileKey(tileRow, tileColumn)
  runtimeDefinition.localEditTiles ??= {}
  const existing = runtimeDefinition.localEditTiles[key]
  const expectedLength = (Math.max(1, resolution) + 1) * (Math.max(1, resolution) + 1)
  if (existing && Array.isArray(existing.values) && existing.values.length === expectedLength) {
    return existing
  }
  const values = new Array<number>(expectedLength).fill(GROUND_HEIGHT_UNSET_VALUE)
  if (existing?.values?.length) {
    const limit = Math.min(expectedLength, existing.values.length)
    for (let index = 0; index < limit; index += 1) {
      const value = Number(existing.values[index])
      values[index] = Number.isFinite(value) ? value : GROUND_HEIGHT_UNSET_VALUE
    }
  }
  const created: GroundLocalEditTileData = {
    key,
    tileRow,
    tileColumn,
    tileSizeMeters,
    resolution: Math.max(1, resolution),
    values,
    source: existing?.source ?? null,
    updatedAt: existing?.updatedAt,
  }
  runtimeDefinition.localEditTiles[key] = created
  invalidateGroundLocalEditTileCaches(runtimeDefinition)
  return created
}

function setGroundLocalEditTileValue(
  definition: GroundRuntimeDynamicMesh,
  tileRow: number,
  tileColumn: number,
  localRow: number,
  localColumn: number,
  value: number,
  source: 'manual' | 'mixed' = 'manual',
): void {
  const tile = ensureGroundLocalEditTileStorage(definition, tileRow, tileColumn)
  const resolution = Math.max(1, Math.trunc(tile.resolution))
  if (localRow < 0 || localColumn < 0 || localRow > resolution || localColumn > resolution) {
    return
  }
  const index = localRow * (resolution + 1) + localColumn
  tile.values[index] = Number.isFinite(value) ? value : GROUND_HEIGHT_UNSET_VALUE
  tile.updatedAt = Date.now()
  tile.source = tile.source === 'dem' || tile.source === 'mixed' ? 'mixed' : source
  invalidateGroundDefinitionStructureSignature(definition)
}

function getGroundLocalEditTileStoredValue(
  tile: GroundLocalEditTileData,
  localRow: number,
  localColumn: number,
): number | null {
  const resolution = Math.max(1, Math.trunc(tile.resolution))
  if (localRow < 0 || localColumn < 0 || localRow > resolution || localColumn > resolution) {
    return null
  }
  const raw = Number(tile.values[localRow * (resolution + 1) + localColumn])
  return Number.isFinite(raw) ? raw : null
}

function resolveGroundLocalEditVertexPlacement(
  definition: GroundRuntimeDynamicMesh,
  x: number,
  z: number,
): {
  tileRow: number
  tileColumn: number
  tileSizeMeters: number
  resolution: number
  row0: number
  row1: number
  column0: number
  column1: number
  tx: number
  tz: number
} | null {
  if (!shouldUseGroundLocalEditTiles(definition)) {
    return null
  }
  const tileSizeMeters = resolveGroundEditTileSizeMeters(definition)
  const resolution = resolveGroundEditTileResolution(definition)
  if (!(tileSizeMeters > 0) || !(resolution > 0)) {
    return null
  }
  const coord = resolveGroundLocalEditTileCoordAtWorld(definition, x, z, tileSizeMeters)
  if (!coord) {
    return null
  }
  const { minX, minZ } = resolveGroundLocalEditTileWorldMin(definition, coord.tileRow, coord.tileColumn, tileSizeMeters)
  const localX = clampInclusive((x - minX) / Math.max(tileSizeMeters, Number.EPSILON), 0, 1) * resolution
  const localZ = clampInclusive((z - minZ) / Math.max(tileSizeMeters, Number.EPSILON), 0, 1) * resolution
  const column0 = clampVertexIndex(Math.floor(localX), resolution)
  const row0 = clampVertexIndex(Math.floor(localZ), resolution)
  return {
    tileRow: coord.tileRow,
    tileColumn: coord.tileColumn,
    tileSizeMeters,
    resolution,
    row0,
    row1: clampVertexIndex(row0 + 1, resolution),
    column0,
    column1: clampVertexIndex(column0 + 1, resolution),
    tx: clampInclusive(localX - column0, 0, 1),
    tz: clampInclusive(localZ - row0, 0, 1),
  }
}

function resolveGroundSculptSubdivisions(definition: GroundRuntimeDynamicMesh): number {
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 1e-6 ? definition.cellSize : 1
  const editCellSize = resolveGroundEditCellSize(definition)
  if (!(editCellSize > 0) || editCellSize >= cellSize) {
    return 1
  }
  return Math.max(1, Math.min(8, Math.ceil(cellSize / editCellSize)))
}

type GroundSculptSampleWindow = {
  originX: number
  originZ: number
  minColumn: number
  maxColumn: number
  minRow: number
  maxRow: number
}

function resolveGroundSculptSampleWindow(
  sampleStep: number,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): GroundSculptSampleWindow {
  const originX = 0
  const originZ = 0
  const minColumnRaw = Math.floor((bounds.minX - originX) / sampleStep)
  const maxColumnRaw = Math.ceil((bounds.maxX - originX) / sampleStep)
  const minRowRaw = Math.floor((bounds.minZ - originZ) / sampleStep)
  const maxRowRaw = Math.ceil((bounds.maxZ - originZ) / sampleStep)
  return {
    originX,
    originZ,
    minColumn: minColumnRaw,
    maxColumn: maxColumnRaw,
    minRow: minRowRaw,
    maxRow: maxRowRaw,
  }
}

function accumulateGroundDeltaAtPoint(
  definition: GroundRuntimeDynamicMesh,
  accumulator: Map<number, GroundHeightDeltaAccumulatorEntry>,
  x: number,
  z: number,
  delta: number,
  sampleWeight: number,
): void {
  if (!Number.isFinite(delta) || !Number.isFinite(sampleWeight) || sampleWeight <= 0) {
    return
  }
  const localPlacement = resolveGroundLocalEditVertexPlacement(definition, x, z)
  if (localPlacement) {
    const write = (localRow: number, localColumn: number, weight: number) => {
      if (weight <= 0) {
        return
      }
      const index = `${localPlacement.tileRow}:${localPlacement.tileColumn}:${localRow}:${localColumn}`
      const entry = accumulator.get(index as unknown as number) ?? {
        mode: 'local' as const,
        delta: 0,
        weight: 0,
        tileRow: localPlacement.tileRow,
        tileColumn: localPlacement.tileColumn,
        localRow,
        localColumn,
        tileSizeMeters: localPlacement.tileSizeMeters,
        resolution: localPlacement.resolution,
      }
      entry.delta += delta * weight * sampleWeight
      entry.weight += weight * sampleWeight
      accumulator.set(index as unknown as number, entry)
    }

    write(localPlacement.row0, localPlacement.column0, (1 - localPlacement.tx) * (1 - localPlacement.tz))
    write(localPlacement.row0, localPlacement.column1, localPlacement.tx * (1 - localPlacement.tz))
    write(localPlacement.row1, localPlacement.column0, (1 - localPlacement.tx) * localPlacement.tz)
    write(localPlacement.row1, localPlacement.column1, localPlacement.tx * localPlacement.tz)
    return
  }

  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 1e-6 ? definition.cellSize : 1
  const gridSize = resolveGroundWorkingGridSize(definition)
  const columns = gridSize.columns
  const rows = gridSize.rows
  const bounds = resolveGroundGridWorldBounds(definition)
  const localColumnFloat = Math.max(0, Math.min(columns, (x - bounds.minX) / cellSize))
  const localRowFloat = Math.max(0, Math.min(rows, (z - bounds.minZ) / cellSize))
  const column0 = Math.max(0, Math.min(columns, Math.floor(localColumnFloat)))
  const row0 = Math.max(0, Math.min(rows, Math.floor(localRowFloat)))
  const column1 = Math.max(0, Math.min(columns, column0 + 1))
  const row1 = Math.max(0, Math.min(rows, row0 + 1))
  const tx = localColumnFloat - column0
  const tz = localRowFloat - row0

  const write = (row: number, column: number, weight: number) => {
    if (weight <= 0) {
      return
    }
    const index = getGroundVertexIndex(columns, row, column)
    const entry = accumulator.get(index) ?? { mode: 'coarse' as const, delta: 0, weight: 0, row, column }
    entry.delta += delta * weight * sampleWeight
    entry.weight += weight * sampleWeight
    accumulator.set(index, entry)
  }

  write(row0, column0, (1 - tx) * (1 - tz))
  write(row0, column1, tx * (1 - tz))
  write(row1, column0, (1 - tx) * tz)
  write(row1, column1, tx * tz)
}

function applyAccumulatedGroundDeltas(
  definition: GroundRuntimeDynamicMesh,
  accumulator: Map<number, GroundHeightDeltaAccumulatorEntry>,
): boolean {
  // 标记本次批量应用过程中是否实际修改了地形数据。
  let modified = false
  // 工作网格尺寸用于把累积器中的顶点索引还原为行列坐标。
  const gridSize = resolveGroundWorkingGridSize(definition)
  const columns = gridSize.columns
  accumulator.forEach((entry, index) => {
    // 没有有效权重，或者累计高度变化不是有限数值时，直接跳过，避免写入非法结果。
    if (!(entry.weight > 0) || !Number.isFinite(entry.delta)) {
      return
    }

    // local 模式表示变化量要写入局部编辑瓦片，而不是基础粗网格顶点。
    if (entry.mode === 'local') {
      // 所有索引都做整数化，防止外部传入小数或 undefined 导致寻址异常。
      const tileRow = Math.trunc(entry.tileRow ?? 0)
      const tileColumn = Math.trunc(entry.tileColumn ?? 0)
      const localRow = Math.trunc(entry.localRow ?? 0)
      const localColumn = Math.trunc(entry.localColumn ?? 0)
      // 确保目标局部编辑瓦片已创建，并且使用累积条目记录的瓦片尺寸与分辨率。
      const tile = ensureGroundLocalEditTileStorage(
        definition,
        tileRow,
        tileColumn,
        entry.tileSizeMeters,
        entry.resolution,
      )
      // 分辨率至少为 1，避免后续根据局部坐标换算世界坐标时出现除零。
      const resolution = Math.max(1, Math.trunc(tile.resolution))
      // 先解析瓦片左上角（或最小坐标）在世界空间中的位置，再还原该局部采样点的世界坐标。
      const { minX, minZ } = resolveGroundLocalEditTileWorldMin(definition, tileRow, tileColumn, tile.tileSizeMeters)
      const x = minX + (localColumn / resolution) * tile.tileSizeMeters
      const z = minZ + (localRow / resolution) * tile.tileSizeMeters
      // 优先读取瓦片中已经存在的存储值；如果该点尚未被写入，则回退到当前地形采样高度。
      const storedHeight = getGroundLocalEditTileStoredValue(tile, localRow, localColumn)
      const currentHeight = storedHeight ?? sampleGroundHeight(definition, x, z)
      // entry.delta / entry.weight 表示该点的加权平均高度改变量。
      const nextHeight = currentHeight + entry.delta / entry.weight
      // 将最终高度写回局部编辑瓦片，使局部精细编辑结果生效。
      setGroundLocalEditTileValue(definition, tileRow, tileColumn, localRow, localColumn, nextHeight)
      modified = true
      return
    }

    // coarse 模式下，累积器键值是基础网格顶点索引，需要换算成行列位置。
    const row = Math.floor(index / (columns + 1))
    const column = index % (columns + 1)
    // 读取该有效顶点当前高度，再叠加平均改变量。
    const currentHeight = resolveGroundEffectiveHeightAtVertex(definition, row, column)
    const nextHeight = currentHeight + entry.delta / entry.weight
    // 通过覆盖值接口写入，确保后续读取到的是编辑后的有效高度。
    setGroundCoverageHeightOverrideForEffectiveValue(definition, resolveGroundWorldXForColumn(definition, column), resolveGroundWorldZForRow(definition, row), nextHeight)
    modified = true
  })
  // 返回是否有任何顶点或局部瓦片被修改，用于上层决定是否继续触发刷新逻辑。
  return modified
}

function applyCircularRaiseDepressSubsampled(
  definition: GroundRuntimeDynamicMesh,
  params: Pick<SculptParams, 'point' | 'radius' | 'strength' | 'operation'>,
): boolean {
  // 圆形抬升/下压工具：在采样窗口内进行子采样，再把结果按权重回写到地形。
  const { point, radius, strength, operation } = params
  const subdivisions = resolveGroundSculptSubdivisions(definition)
  const useLocalEditWindow = shouldUseGroundLocalEditTiles(definition)
  // 如果既没有启用子采样，也没有启用局部编辑窗口，则该高精度路径无需执行。
  if (subdivisions <= 1 && !useLocalEditWindow) {
    return false
  }
  // 单元尺寸兜底为 1，避免异常 cellSize 导致步长不可用。
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 1e-6 ? definition.cellSize : 1
  // 启用局部编辑瓦片时，优先使用局部编辑分辨率；否则使用基础网格的子采样步长。
  const sampleStep = useLocalEditWindow
    ? Math.min(cellSize, Math.max(resolveGroundEditCellSize(definition), Number.EPSILON))
    : cellSize / subdivisions
  const localX = point.x
  const localZ = point.z
  // 基于圆形影响范围生成采样窗口，减少不必要的遍历。
  const window = resolveGroundSculptSampleWindow(sampleStep, {
    minX: localX - radius,
    maxX: localX + radius,
    minZ: localZ - radius,
    maxZ: localZ + radius,
  })
  // depress 为向下，其余视为向上。
  const direction = operation === 'depress' ? -1 : 1
  // 累积器负责收集所有采样点对网格顶点或局部瓦片点的贡献。
  const accumulator = new Map<number, GroundHeightDeltaAccumulatorEntry>()
  // 每个子采样点的基础权重，保证 subdivision 越高时总体强度不会无限放大。
  const sampleWeight = 1 / (Math.max(1, subdivisions) * Math.max(1, subdivisions))

  // 在采样窗口内逐点遍历，对圆形区域内部的采样点计算抬升/下压影响。
  for (let row = window.minRow; row <= window.maxRow; row += 1) {
    const z = window.originZ + row * sampleStep
    for (let column = window.minColumn; column <= window.maxColumn; column += 1) {
      const x = window.originX + column * sampleStep
      const dx = x - localX
      const dz = z - localZ
      const distSq = dx * dx + dz * dz
      // 圆外的采样点不产生影响。
      if (distSq >= radius * radius) {
        continue
      }
      const dist = Math.sqrt(distSq)
      // 使用余弦曲线让中心影响最大、边缘逐渐衰减，形成更平滑的笔刷效果。
      let influence = Math.cos((dist / radius) * (Math.PI / 2))
      // 叠加轻微噪声，避免雕刻结果过于机械、绝对平滑。
      const noiseVal = sculptNoise(x * 0.05, z * 0.05, 0)
      influence *= 1.0 + noiseVal * 0.1
      // strength 与方向共同决定最终高度增量，0.3 是当前工具的经验缩放系数。
      const delta = direction * strength * influence * 0.3
      // 将该采样点的影响分发到邻近控制点或局部编辑采样点中。
      accumulateGroundDeltaAtPoint(definition, accumulator, x, z, delta, sampleWeight)
    }
  }

  // 统一应用累积结果，避免在采样过程中重复读写导致结果不稳定。
  return applyAccumulatedGroundDeltas(definition, accumulator)
}

function applyPolygonRaiseDepressSubsampled(
  definition: GroundRuntimeDynamicMesh,
  polygonBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  normalizedPolygon: SculptPolygonPoint[],
  params: Pick<SculptParams, 'operation' | 'strength' | 'depth' | 'slope'>,
): boolean {
  // 多边形抬升/下压工具：先收集所有位于多边形内部的采样点，再统一计算边界渐变与高度变化。
  const subdivisions = resolveGroundSculptSubdivisions(definition)
  const useLocalEditWindow = shouldUseGroundLocalEditTiles(definition)
  // 仅在启用子采样或局部编辑瓦片时走该精细路径。
  if (subdivisions <= 1 && !useLocalEditWindow) {
    return false
  }
  // 保证采样步长的基础尺寸合法。
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 1e-6 ? definition.cellSize : 1
  // 根据当前编辑模式选择采样步长，局部编辑优先使用更细的编辑网格分辨率。
  const sampleStep = useLocalEditWindow
    ? Math.min(cellSize, Math.max(resolveGroundEditCellSize(definition), Number.EPSILON))
    : cellSize / subdivisions
  // 只在多边形包围盒内采样，降低计算开销。
  const window = resolveGroundSculptSampleWindow(sampleStep, polygonBounds)
  const direction = params.operation === 'depress' ? -1 : 1
  // depth 用于控制带坡度时的绝对高度影响，非法值回退到 0。
  const effectiveDepth = Number.isFinite(params.depth) ? Math.max(0, params.depth ?? 0) : 0
  // slope 控制从边界向内的渐变宽度，默认值为 0.5。
  const effectiveSlope = Number.isFinite(params.slope) ? params.slope ?? 0.5 : 0.5
  const accumulator = new Map<number, GroundHeightDeltaAccumulatorEntry>()
  const sampleWeight = 1 / (Math.max(1, subdivisions) * Math.max(1, subdivisions))
  // 先缓存所有候选采样点以及其到边界的距离，后续统一计算 ramp 参数。
  const candidates: Array<{ x: number; z: number; boundaryDistance: number }> = []
  let maxBoundaryDistance = 0

  // 遍历包围盒中的采样点，只保留真正落在多边形内部的点。
  for (let row = window.minRow; row <= window.maxRow; row += 1) {
    const z = window.originZ + row * sampleStep
    for (let column = window.minColumn; column <= window.maxColumn; column += 1) {
      const x = window.originX + column * sampleStep
      const samplePoint = { x, z }
      // 多边形外部点不参与本次雕刻。
      if (!isPointInsideSculptPolygonXZ(samplePoint, normalizedPolygon)) {
        continue
      }
      // 记录采样点到最近边界的距离，以便后续构造边缘缓坡或平台效果。
      const boundaryDistance = computeSculptPolygonBoundaryDistance(samplePoint, normalizedPolygon)
      maxBoundaryDistance = Math.max(maxBoundaryDistance, boundaryDistance)
      candidates.push({ x, z, boundaryDistance })
    }
  }

  // 没有任何命中点时，说明包围盒内没有有效编辑区域。
  if (!candidates.length) {
    return false
  }

  // 根据最大边界距离、深度与坡度推导渐变带宽度。
  const rampWidth = computePolygonRaiseDepressRampWidth(maxBoundaryDistance, effectiveDepth, effectiveSlope)
  for (const candidate of candidates) {
    // 未指定 depth 时，使用 strength 驱动一个统一的平坦增量。
    let delta = direction * params.strength * 0.3
    if (effectiveDepth > 0) {
      // 指定 depth 后，根据候选点距边界的距离采样剖面曲线，形成边缘过渡效果。
      const profile = computePolygonRaiseDepressProfile(candidate.boundaryDistance, rampWidth)
      delta = direction * effectiveDepth * profile
    }
    // 将当前采样点的结果累计到对应的地形控制点。
    accumulateGroundDeltaAtPoint(definition, accumulator, candidate.x, candidate.z, delta, sampleWeight)
  }

  // 最后统一回写累计后的高度变化。
  return applyAccumulatedGroundDeltas(definition, accumulator)
}

function applyCircularSurfaceSubsampled(
  definition: GroundRuntimeDynamicMesh,
  params: Pick<SculptParams, 'point' | 'radius' | 'strength' | 'operation' | 'targetHeight'>,
): boolean {
  const { point, radius, strength, operation, targetHeight } = params
  const subdivisions = resolveGroundSculptSubdivisions(definition)
  const useLocalEditWindow = shouldUseGroundLocalEditTiles(definition)
  if (subdivisions <= 1 && !useLocalEditWindow) {
    return false
  }
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 1e-6 ? definition.cellSize : 1
  const sampleStep = useLocalEditWindow
    ? Math.min(cellSize, Math.max(resolveGroundEditCellSize(definition), Number.EPSILON))
    : cellSize / subdivisions
  const localX = point.x
  const localZ = point.z
  const window = resolveGroundSculptSampleWindow(sampleStep, {
    minX: localX - radius,
    maxX: localX + radius,
    minZ: localZ - radius,
    maxZ: localZ + radius,
  })
  const accumulator = new Map<number, GroundHeightDeltaAccumulatorEntry>()
  const sampleWeight = 1 / (Math.max(1, subdivisions) * Math.max(1, subdivisions))

  for (let row = window.minRow; row <= window.maxRow; row += 1) {
    const z = window.originZ + row * sampleStep
    for (let column = window.minColumn; column <= window.maxColumn; column += 1) {
      const x = window.originX + column * sampleStep
      const dx = x - localX
      const dz = z - localZ
      const distSq = dx * dx + dz * dz
      if (distSq >= radius * radius) {
        continue
      }

      const dist = Math.sqrt(distSq)
      let influence = Math.cos((dist / radius) * (Math.PI / 2))
      const noiseVal = sculptNoise(x * 0.05, z * 0.05, 0)
      influence *= 1.0 + noiseVal * 0.1

      const currentHeight = sampleGroundHeight(definition, x, z)
      let nextHeight = currentHeight

      if (operation === 'smooth') {
        const average = sampleGroundSmoothAverageAtPoint(definition, x, z)
        const smoothingFactor = Math.min(1, strength * 0.25)
        nextHeight = currentHeight + (average - currentHeight) * smoothingFactor * influence
      } else if (operation === 'flatten') {
        const reference = targetHeight ?? currentHeight
        const flattenFactor = Math.min(1, strength * 0.4)
        nextHeight = currentHeight + (reference - currentHeight) * flattenFactor * influence
      } else {
        const reference = targetHeight ?? 0
        const flattenFactor = Math.min(1, 0.2 + strength * 0.3)
        nextHeight = currentHeight + (reference - currentHeight) * flattenFactor * influence
      }

      accumulateGroundDeltaAtPoint(definition, accumulator, x, z, nextHeight - currentHeight, sampleWeight)
    }
  }

  if (operation === 'flatten-zero') {
    const smoothingBand = Math.max(cellSize * 1.5, radius * 0.35)
    if (smoothingBand > 0) {
      const smoothingRadius = radius + smoothingBand
      const smoothWindow = resolveGroundSculptSampleWindow(sampleStep, {
        minX: localX - smoothingRadius,
        maxX: localX + smoothingRadius,
        minZ: localZ - smoothingRadius,
        maxZ: localZ + smoothingRadius,
      })
      const smoothingStrengthBase = Math.min(1, 0.2 + strength * 0.15)
      for (let row = smoothWindow.minRow; row <= smoothWindow.maxRow; row += 1) {
        const z = smoothWindow.originZ + row * sampleStep
        for (let column = smoothWindow.minColumn; column <= smoothWindow.maxColumn; column += 1) {
          const x = smoothWindow.originX + column * sampleStep
          const dx = x - localX
          const dz = z - localZ
          const dist = Math.sqrt(dx * dx + dz * dz)
          if (dist <= radius || dist > smoothingRadius) {
            continue
          }
          const taper = 1 - (dist - radius) / smoothingBand
          const smoothingFactor = smoothingStrengthBase * taper
          if (smoothingFactor <= 0) {
            continue
          }
          const currentHeight = sampleGroundHeight(definition, x, z)
          const average = sampleGroundSmoothAverageAtPoint(definition, x, z)
          const smoothedHeight = currentHeight + (average - currentHeight) * smoothingFactor
          accumulateGroundDeltaAtPoint(definition, accumulator, x, z, smoothedHeight - currentHeight, sampleWeight)
        }
      }
    }
  }

  return applyAccumulatedGroundDeltas(definition, accumulator)
}

function applyPolygonSurfaceSubsampled(
  definition: GroundRuntimeDynamicMesh,
  polygonBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  normalizedPolygon: SculptPolygonPoint[],
  params: Pick<SculptParams, 'operation' | 'strength' | 'targetHeight'>,
): boolean {
  const subdivisions = resolveGroundSculptSubdivisions(definition)
  const useLocalEditWindow = shouldUseGroundLocalEditTiles(definition)
  if (subdivisions <= 1 && !useLocalEditWindow) {
    return false
  }
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 1e-6 ? definition.cellSize : 1
  const sampleStep = useLocalEditWindow
    ? Math.min(cellSize, Math.max(resolveGroundEditCellSize(definition), Number.EPSILON))
    : cellSize / subdivisions
  const window = resolveGroundSculptSampleWindow(sampleStep, polygonBounds)
  const accumulator = new Map<number, GroundHeightDeltaAccumulatorEntry>()
  const sampleWeight = 1 / (Math.max(1, subdivisions) * Math.max(1, subdivisions))

  for (let row = window.minRow; row <= window.maxRow; row += 1) {
    const z = window.originZ + row * sampleStep
    for (let column = window.minColumn; column <= window.maxColumn; column += 1) {
      const x = window.originX + column * sampleStep
      const samplePoint = { x, z }
      if (!isPointInsideSculptPolygonXZ(samplePoint, normalizedPolygon)) {
        continue
      }

      const currentHeight = sampleGroundHeight(definition, x, z)
      let nextHeight = currentHeight
      if (params.operation === 'smooth') {
        const average = sampleGroundSmoothAverageAtPoint(definition, x, z)
        const smoothingFactor = Math.min(1, params.strength * 0.25)
        nextHeight = currentHeight + (average - currentHeight) * smoothingFactor
      } else if (params.operation === 'flatten') {
        const reference = params.targetHeight ?? currentHeight
        const flattenFactor = Math.min(1, params.strength * 0.4)
        nextHeight = currentHeight + (reference - currentHeight) * flattenFactor
      } else {
        const reference = params.targetHeight ?? 0
        const flattenFactor = Math.min(1, 0.2 + params.strength * 0.3)
        nextHeight = currentHeight + (reference - currentHeight) * flattenFactor
      }

      accumulateGroundDeltaAtPoint(definition, accumulator, x, z, nextHeight - currentHeight, sampleWeight)
    }
  }

  return applyAccumulatedGroundDeltas(definition, accumulator)
}

function sanitizeGroundClippingLoop(loop: THREE.Vector2[]): THREE.Vector2[] {
  const cleaned: THREE.Vector2[] = []
  for (const point of loop) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue
    }
    const next = new THREE.Vector2(point.x, point.y)
    const previous = cleaned[cleaned.length - 1]
    if (previous && previous.distanceToSquared(next) <= GROUND_TRIANGLE_SLICE_EPSILON * GROUND_TRIANGLE_SLICE_EPSILON) {
      continue
    }
    cleaned.push(next)
  }

  if (
    cleaned.length >= 3
    && cleaned[0]!.distanceToSquared(cleaned[cleaned.length - 1]!) <= GROUND_TRIANGLE_SLICE_EPSILON * GROUND_TRIANGLE_SLICE_EPSILON
  ) {
    cleaned.pop()
  }

  return cleaned
}

function computeGroundLoopArea(points: THREE.Vector2[]): number {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    area += current.x * next.y - next.x * current.y
  }
  return area * 0.5
}

function ensureGroundLoopWinding(points: THREE.Vector2[], ccw: boolean): THREE.Vector2[] {
  if (points.length < 3) {
    return points
  }
  const area = computeGroundLoopArea(points)
  const isCcw = area > 0
  if (isCcw === ccw) {
    return points
  }
  return [...points].reverse()
}

function vector2LoopToGroundClippingRing(loop: THREE.Vector2[]): PolygonClippingRing {
  const sanitized = sanitizeGroundClippingLoop(loop)
  const ring: PolygonClippingRing = []
  sanitized.forEach((point) => {
    ring.push([point.x, point.y] as PolygonClippingPair)
  })
  return ring
}

function groundClippingRingToVector2Loop(ring: PolygonClippingRing): THREE.Vector2[] {
  const loop: THREE.Vector2[] = []
  ring.forEach((pair) => {
    if (!Array.isArray(pair) || pair.length < 2) {
      return
    }
    const x = Number(pair[0])
    const y = Number(pair[1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return
    }
    loop.push(new THREE.Vector2(x, y))
  })
  return sanitizeGroundClippingLoop(loop)
}

function resolveGroundCellTriangleDefinitions(
  definition: GroundDynamicMesh,
  row: number,
  column: number,
): [GroundCellTriangleDefinition, GroundCellTriangleDefinition] {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  const cellSize = Number.isFinite(runtimeDefinition.cellSize) && runtimeDefinition.cellSize > 1e-6
    ? runtimeDefinition.cellSize
    : 1
  const bounds = resolveGroundGridWorldBounds(runtimeDefinition)
  const x0 = bounds.minX + column * cellSize
  const x1 = x0 + cellSize
  const z0 = bounds.minZ + row * cellSize
  const z1 = z0 + cellSize

  const a = new THREE.Vector2(x0, z0)
  const b = new THREE.Vector2(x1, z0)
  const c = new THREE.Vector2(x0, z1)
  const d = new THREE.Vector2(x1, z1)

  const hA = resolveGroundEffectiveHeightAtVertex(runtimeDefinition, row, column)
  const hB = resolveGroundEffectiveHeightAtVertex(runtimeDefinition, row, column + 1)
  const hC = resolveGroundEffectiveHeightAtVertex(runtimeDefinition, row + 1, column)
  const hD = resolveGroundEffectiveHeightAtVertex(runtimeDefinition, row + 1, column + 1)

  return [
    { vertices: [a, c, b], heights: [hA, hC, hB] },
    { vertices: [b, c, d], heights: [hB, hC, hD] },
  ]
}

function resolveGroundEffectiveHeightAtVertexWithTriangleContext(
  runtimeDefinition: GroundRuntimeDynamicMesh,
  row: number,
  column: number,
  context: GroundTriangleSamplingContext,
): number {
  const heightIndex = getGroundVertexIndex(context.columns, row, column)
  const cachedHeight = context.vertexHeightCache.get(heightIndex)
  if (typeof cachedHeight === 'number' && Number.isFinite(cachedHeight)) {
    return cachedHeight
  }
  const height = resolveGroundEffectiveHeightAtVertexWithContext(
    runtimeDefinition,
    row,
    column,
    context.columns,
    context.bounds.minX,
    context.bounds.minZ,
    context.cellSize,
    context.terrainSampler,
  )
  context.vertexHeightCache.set(heightIndex, height)
  return height
}

function resolveGroundCellTriangleDefinitionsWithContext(
  runtimeDefinition: GroundRuntimeDynamicMesh,
  row: number,
  column: number,
  context: GroundTriangleSamplingContext,
): [GroundCellTriangleDefinition, GroundCellTriangleDefinition] {
  const cellKey = (row * (context.columns + 1)) + column
  const cachedTriangles = context.cellTriangleCache.get(cellKey)
  if (cachedTriangles) {
    return cachedTriangles
  }
  const cellSize = context.cellSize > 1e-6 ? context.cellSize : 1
  const x0 = context.bounds.minX + column * cellSize
  const x1 = x0 + cellSize
  const z0 = context.bounds.minZ + row * cellSize
  const z1 = z0 + cellSize

  const a = new THREE.Vector2(x0, z0)
  const b = new THREE.Vector2(x1, z0)
  const c = new THREE.Vector2(x0, z1)
  const d = new THREE.Vector2(x1, z1)

  const hA = resolveGroundEffectiveHeightAtVertexWithTriangleContext(runtimeDefinition, row, column, context)
  const hB = resolveGroundEffectiveHeightAtVertexWithTriangleContext(runtimeDefinition, row, column + 1, context)
  const hC = resolveGroundEffectiveHeightAtVertexWithTriangleContext(runtimeDefinition, row + 1, column, context)
  const hD = resolveGroundEffectiveHeightAtVertexWithTriangleContext(runtimeDefinition, row + 1, column + 1, context)

  const triangles: [GroundCellTriangleDefinition, GroundCellTriangleDefinition] = [
    { vertices: [a, c, b], heights: [hA, hC, hB] },
    { vertices: [b, c, d], heights: [hB, hC, hD] },
  ]
  context.cellTriangleCache.set(cellKey, triangles)
  return triangles
}

function interpolateGroundTrianglePlaneHeight(
  triangle: GroundCellTriangleDefinition,
  x: number,
  z: number,
): number | null {
  const [a, b, c] = triangle.vertices
  const [hA, hB, hC] = triangle.heights
  const denominator = ((b.y - c.y) * (a.x - c.x)) + ((c.x - b.x) * (a.y - c.y))
  if (Math.abs(denominator) <= GROUND_TRIANGLE_SLICE_EPSILON) {
    return null
  }
  const weightA = (((b.y - c.y) * (x - c.x)) + ((c.x - b.x) * (z - c.y))) / denominator
  const weightB = (((c.y - a.y) * (x - c.x)) + ((a.x - c.x) * (z - c.y))) / denominator
  const weightC = 1 - weightA - weightB
  return hA * weightA + hB * weightB + hC * weightC
}

function resolveGroundRegionPlane(
  definition: GroundDynamicMesh,
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number,
): GroundPlanarSliceRegion {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  const rowSpan = Math.max(1, endRow - startRow)
  const columnSpan = Math.max(1, endColumn - startColumn)
  const h00 = resolveGroundEffectiveHeightAtVertex(runtimeDefinition, startRow, startColumn)
  const h10 = resolveGroundEffectiveHeightAtVertex(runtimeDefinition, startRow, endColumn)
  const h01 = resolveGroundEffectiveHeightAtVertex(runtimeDefinition, endRow, startColumn)
  return {
    startRow,
    endRow,
    startColumn,
    endColumn,
    h00,
    slopeX: (h10 - h00) / columnSpan,
    slopeZ: (h01 - h00) / rowSpan,
  }
}

function sampleGroundRegionPlaneHeight(region: GroundPlanarSliceRegion, row: number, column: number): number {
  return region.h00 + region.slopeX * (column - region.startColumn) + region.slopeZ * (row - region.startRow)
}

function regionMatchesGroundPlane(
  definition: GroundDynamicMesh,
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number,
  tolerance: number,
): boolean {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  const region = resolveGroundRegionPlane(runtimeDefinition, startRow, endRow, startColumn, endColumn)
  const cornerHeight = resolveGroundEffectiveHeightAtVertex(runtimeDefinition, endRow, endColumn)
  const cornerPlane = sampleGroundRegionPlaneHeight(region, endRow, endColumn)
  if (Math.abs(cornerHeight - cornerPlane) > tolerance) {
    return false
  }

  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = startColumn; column <= endColumn; column += 1) {
      const actual = resolveGroundEffectiveHeightAtVertex(runtimeDefinition, row, column)
      const expected = sampleGroundRegionPlaneHeight(region, row, column)
      if (Math.abs(actual - expected) > tolerance) {
        return false
      }
    }
  }

  return true
}

function buildGroundPlanarSliceRegionPolygon(
  definition: GroundDynamicMesh,
  region: GroundPlanarSliceRegion,
): THREE.Vector2[] {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  const cellSize = Number.isFinite(runtimeDefinition.cellSize) && runtimeDefinition.cellSize > 1e-6
    ? runtimeDefinition.cellSize
    : 1
  const bounds = resolveGroundGridWorldBounds(runtimeDefinition)
  const x0 = bounds.minX + region.startColumn * cellSize
  const x1 = bounds.minX + region.endColumn * cellSize
  const z0 = bounds.minZ + region.startRow * cellSize
  const z1 = bounds.minZ + region.endRow * cellSize
  return [
    new THREE.Vector2(x0, z0),
    new THREE.Vector2(x1, z0),
    new THREE.Vector2(x1, z1),
    new THREE.Vector2(x0, z1),
  ]
}

function resolveGroundPlanarSliceRegions(
  definition: GroundDynamicMesh,
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number,
  tolerance: number,
  maxFragments: number = Number.POSITIVE_INFINITY,
): { planarRegions: GroundPlanarSliceRegion[]; triangleCells: Array<{ row: number; column: number }>; aborted: boolean } {
  const visited = new Set<string>()
  const planarRegions: GroundPlanarSliceRegion[] = []
  const triangleCells: Array<{ row: number; column: number }> = []
  let aborted = false

  const isVisited = (row: number, column: number) => visited.has(`${row}:${column}`)
  const markVisited = (row0: number, row1: number, column0: number, column1: number) => {
    for (let row = row0; row < row1; row += 1) {
      for (let column = column0; column < column1; column += 1) {
        visited.add(`${row}:${column}`)
      }
    }
  }
  const canUseRegion = (row0: number, row1: number, column0: number, column1: number): boolean => {
    for (let row = row0; row < row1; row += 1) {
      for (let column = column0; column < column1; column += 1) {
        if (isVisited(row, column)) {
          return false
        }
      }
    }
    return regionMatchesGroundPlane(definition, row0, row1, column0, column1, tolerance)
  }

  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = startColumn; column <= endColumn; column += 1) {
      if (isVisited(row, column)) {
        continue
      }
      if ((planarRegions.length + triangleCells.length) >= maxFragments) {
        aborted = true
        break
      }

      if (!regionMatchesGroundPlane(definition, row, row + 1, column, column + 1, tolerance)) {
        visited.add(`${row}:${column}`)
        triangleCells.push({ row, column })
        continue
      }

      let regionEndColumn = column + 1
      while (regionEndColumn < endColumn + 1 && canUseRegion(row, row + 1, column, regionEndColumn + 1)) {
        regionEndColumn += 1
      }

      let regionEndRow = row + 1
      while (regionEndRow < endRow + 1 && canUseRegion(row, regionEndRow + 1, column, regionEndColumn)) {
        regionEndRow += 1
      }

      const region = resolveGroundRegionPlane(definition, row, regionEndRow, column, regionEndColumn)
      planarRegions.push(region)
      markVisited(row, regionEndRow, column, regionEndColumn)
    }
    if (aborted) {
      break
    }
  }

  return { planarRegions, triangleCells, aborted }
}

function appendGroundSlicePolygon(
  contour: THREE.Vector2[],
  holes: THREE.Vector2[][],
  resolveHeight: (x: number, z: number) => number,
  vertices: Array<{ x: number; y: number; z: number }>,
  indices: number[],
  vertexIndexByKey: Map<string, number>,
): void {
  const resolveVertexIndex = (point: THREE.Vector2): number => {
    const key = `${point.x.toFixed(6)},${point.y.toFixed(6)}`
    const cached = vertexIndexByKey.get(key)
    if (cached !== undefined) {
      return cached
    }
    const nextIndex = vertices.length
    vertices.push({
      x: point.x,
      y: resolveHeight(point.x, point.y),
      z: point.y,
    })
    vertexIndexByKey.set(key, nextIndex)
    return nextIndex
  }

  if (contour.length < 3) {
    return
  }

  const faces = THREE.ShapeUtils.triangulateShape(contour, holes)
  if (!Array.isArray(faces) || !faces.length) {
    return
  }

  const triangulationPoints: THREE.Vector2[] = [...contour]
  holes.forEach((hole) => {
    triangulationPoints.push(...hole)
  })

  faces.forEach((face) => {
    if (!Array.isArray(face) || face.length !== 3) {
      return
    }
    const p0 = triangulationPoints[face[0]!]
    const p1 = triangulationPoints[face[1]!]
    const p2 = triangulationPoints[face[2]!]
    if (!p0 || !p1 || !p2) {
      return
    }
    const i0 = resolveVertexIndex(p0)
    const i1 = resolveVertexIndex(p1)
    const i2 = resolveVertexIndex(p2)
    if (i0 === i1 || i1 === i2 || i0 === i2) {
      return
    }
    const area = new THREE.Vector3(
      vertices[i1]!.x - vertices[i0]!.x,
      0,
      vertices[i1]!.z - vertices[i0]!.z,
    ).cross(
      new THREE.Vector3(
        vertices[i2]!.x - vertices[i0]!.x,
        0,
        vertices[i2]!.z - vertices[i0]!.z,
      ),
    ).y
    if (Math.abs(area) <= GROUND_TRIANGLE_SLICE_EPSILON) {
      return
    }
    indices.push(i0, i1, i2)
  })
}

function appendGroundSliceClip(
  clip: PolygonClippingMultiPolygon,
  resolveHeight: (x: number, z: number) => number,
  vertices: Array<{ x: number; y: number; z: number }>,
  indices: number[],
  vertexIndexByKey: Map<string, number>,
): void {
  if (!Array.isArray(clip) || !clip.length) {
    return
  }

  for (const polygonEntry of clip) {
    if (!Array.isArray(polygonEntry) || !polygonEntry.length) {
      continue
    }
    const contour = ensureGroundLoopWinding(
      groundClippingRingToVector2Loop(polygonEntry[0] as PolygonClippingRing),
      true,
    )
    if (contour.length < 3) {
      continue
    }
    const holes = polygonEntry
      .slice(1)
      .map((ring) => ensureGroundLoopWinding(groundClippingRingToVector2Loop(ring as PolygonClippingRing), false))
      .filter((ring) => ring.length >= 3)

    appendGroundSlicePolygon(contour, holes, resolveHeight, vertices, indices, vertexIndexByKey)
  }
}

function computeGroundLoopBounds(points: THREE.Vector2[]): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  if (!points.length) {
    return null
  }
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  points.forEach((point) => {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minZ = Math.min(minZ, point.y)
    maxZ = Math.max(maxZ, point.y)
  })
  return { minX, maxX, minZ, maxZ }
}

function groundSliceBoundsOverlap(
  a: { minX: number; maxX: number; minZ: number; maxZ: number },
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxZ < b.minZ || a.minZ > b.maxZ)
}

function groundSlicePointInPolygon(point: THREE.Vector2, polygon: THREE.Vector2[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index]!
    const previousPoint = polygon[previous]!
    const intersects = ((currentPoint.y > point.y) !== (previousPoint.y > point.y))
      && (point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) / ((previousPoint.y - currentPoint.y) || 1e-12) + currentPoint.x)
    if (intersects) {
      inside = !inside
    }
  }
  return inside
}

function groundSliceCross2d(a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2): number {
  return ((b.x - a.x) * (c.y - a.y)) - ((b.y - a.y) * (c.x - a.x))
}

function groundSlicePointOnSegment(point: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): boolean {
  const cross = groundSliceCross2d(a, b, point)
  if (Math.abs(cross) > 1e-8) {
    return false
  }
  const minX = Math.min(a.x, b.x) - 1e-8
  const maxX = Math.max(a.x, b.x) + 1e-8
  const minZ = Math.min(a.y, b.y) - 1e-8
  const maxZ = Math.max(a.y, b.y) + 1e-8
  return point.x >= minX && point.x <= maxX && point.y >= minZ && point.y <= maxZ
}

function groundSliceOrientation(a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2): number {
  const value = groundSliceCross2d(a, b, c)
  if (Math.abs(value) <= 1e-8) {
    return 0
  }
  return value > 0 ? 1 : -1
}

function groundSliceSegmentsIntersect(a1: THREE.Vector2, a2: THREE.Vector2, b1: THREE.Vector2, b2: THREE.Vector2): boolean {
  const o1 = groundSliceOrientation(a1, a2, b1)
  const o2 = groundSliceOrientation(a1, a2, b2)
  const o3 = groundSliceOrientation(b1, b2, a1)
  const o4 = groundSliceOrientation(b1, b2, a2)
  if (o1 !== o2 && o3 !== o4) {
    return true
  }
  return (o1 === 0 && groundSlicePointOnSegment(b1, a1, a2))
    || (o2 === 0 && groundSlicePointOnSegment(b2, a1, a2))
    || (o3 === 0 && groundSlicePointOnSegment(a1, b1, b2))
    || (o4 === 0 && groundSlicePointOnSegment(a2, b1, b2))
}

function groundSliceEdgesIntersect(loopA: THREE.Vector2[], loopB: THREE.Vector2[]): boolean {
  for (let indexA = 0; indexA < loopA.length; indexA += 1) {
    const a0 = loopA[indexA]!
    const a1 = loopA[(indexA + 1) % loopA.length]!
    for (let indexB = 0; indexB < loopB.length; indexB += 1) {
      const b0 = loopB[indexB]!
      const b1 = loopB[(indexB + 1) % loopB.length]!
      if (groundSliceSegmentsIntersect(a0, a1, b0, b1)) {
        return true
      }
    }
  }
  return false
}

function groundSliceLoopContainedByPolygon(loop: THREE.Vector2[], polygon: THREE.Vector2[]): boolean {
  if (!loop.length || !polygon.length) {
    return false
  }
  if (loop.some((point) => !groundSlicePointInPolygon(point, polygon) && !polygon.some((vertex) => point.distanceToSquared(vertex) <= 1e-12))) {
    return false
  }
  return !groundSliceEdgesIntersect(loop, polygon)
}

function buildGroundSliceTriangleBounds(triangle: GroundCellTriangleDefinition): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const [a, b, c] = triangle.vertices
  return {
    minX: Math.min(a.x, b.x, c.x),
    maxX: Math.max(a.x, b.x, c.x),
    minZ: Math.min(a.y, b.y, c.y),
    maxZ: Math.max(a.y, b.y, c.y),
  }
}

type GroundTriangleSliceDegradeReason = 'fragment-budget' | 'fragmentation' | 'covered-cell-budget'

function shouldDegradeGroundTriangleSlice(
  coveredCellCount: number,
  planarRegionCount: number,
  triangleCellCount: number,
  aborted: boolean,
): GroundTriangleSliceDegradeReason | null {
  if (coveredCellCount > GROUND_TRIANGLE_SLICE_MAX_COVERED_CELLS) {
    return 'covered-cell-budget'
  }
  if (aborted) {
    return 'fragment-budget'
  }
  const intersectionBudget = planarRegionCount + (triangleCellCount * 2)
  if (intersectionBudget > GROUND_TRIANGLE_SLICE_MAX_INTERSECTION_BUDGET) {
    return 'fragment-budget'
  }
  if (coveredCellCount <= 0) {
    return null
  }
  if ((planarRegionCount / coveredCellCount) > GROUND_TRIANGLE_SLICE_MAX_PLANAR_REGION_RATIO) {
    return 'fragmentation'
  }
  if ((triangleCellCount / coveredCellCount) > GROUND_TRIANGLE_SLICE_MAX_TRIANGLE_CELL_RATIO) {
    return 'fragmentation'
  }
  return null
}

export function sampleGroundTriangleHeight(definition: GroundDynamicMesh, x: number, z: number): number {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  const gridSize = resolveGroundWorkingGridSize(runtimeDefinition)
  const columns = gridSize.columns
  const rows = gridSize.rows
  const cellSize = Number.isFinite(runtimeDefinition.cellSize) && runtimeDefinition.cellSize > 1e-6
    ? runtimeDefinition.cellSize
    : 1
  const bounds = resolveGroundGridWorldBounds(runtimeDefinition)

  const localColumnFloat = clampInclusive((x - bounds.minX) / cellSize, 0, columns)
  const localRowFloat = clampInclusive((z - bounds.minZ) / cellSize, 0, rows)
  const cellColumn = clampInclusive(
    Math.floor(Math.min(localColumnFloat, columns - GROUND_TRIANGLE_SLICE_EPSILON)),
    0,
    Math.max(0, columns - 1),
  )
  const cellRow = clampInclusive(
    Math.floor(Math.min(localRowFloat, rows - GROUND_TRIANGLE_SLICE_EPSILON)),
    0,
    Math.max(0, rows - 1),
  )
  const tx = clampInclusive(localColumnFloat - cellColumn, 0, 1)
  const tz = clampInclusive(localRowFloat - cellRow, 0, 1)
  const triangles = resolveGroundCellTriangleDefinitions(runtimeDefinition, cellRow, cellColumn)
  const triangle = tx + tz <= 1 + GROUND_TRIANGLE_SLICE_EPSILON ? triangles[0] : triangles[1]
  const sampled = interpolateGroundTrianglePlaneHeight(triangle, x, z)
  return Number.isFinite(sampled) ? (sampled as number) : sampleGroundHeight(runtimeDefinition, x, z)
}

/**
 * Samples triangle height using a pre-built GroundTriangleSamplingContext.
 * Reuses cached cell vertex heights across many calls in a build loop.
 */
export function sampleGroundTriangleHeightWithContext(
  runtimeDefinition: GroundRuntimeDynamicMesh,
  context: GroundTriangleSamplingContext,
  x: number,
  z: number,
): number {
  const columns = context.columns
  const rows = context.rows
  const cellSize = context.cellSize > 1e-6 ? context.cellSize : 1
  const bounds = context.bounds

  const localColumnFloat = clampInclusive((x - bounds.minX) / cellSize, 0, columns)
  const localRowFloat = clampInclusive((z - bounds.minZ) / cellSize, 0, rows)
  const cellColumn = clampInclusive(
    Math.floor(Math.min(localColumnFloat, columns - GROUND_TRIANGLE_SLICE_EPSILON)),
    0,
    Math.max(0, columns - 1),
  )
  const cellRow = clampInclusive(
    Math.floor(Math.min(localRowFloat, rows - GROUND_TRIANGLE_SLICE_EPSILON)),
    0,
    Math.max(0, rows - 1),
  )
  const tx = clampInclusive(localColumnFloat - cellColumn, 0, 1)
  const tz = clampInclusive(localRowFloat - cellRow, 0, 1)
  const triangles = resolveGroundCellTriangleDefinitionsWithContext(runtimeDefinition, cellRow, cellColumn, context)
  const triangle = tx + tz <= 1 + GROUND_TRIANGLE_SLICE_EPSILON ? triangles[0] : triangles[1]
  const sampled = interpolateGroundTrianglePlaneHeight(triangle, x, z)
  return Number.isFinite(sampled) ? (sampled as number) : sampleGroundHeight(runtimeDefinition, x, z)
}

export function sliceGroundTrianglesByPolygon(
  definition: GroundDynamicMesh,
  polygon: Array<THREE.Vector2 | { x: number; y: number } | [number, number]>,
  options: { mergePlanarRegions?: boolean } = {},
): GroundTriangleSliceMesh {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  const footprint = sanitizeGroundClippingLoop(
    polygon.map((entry) => {
      if (entry instanceof THREE.Vector2) {
        return entry.clone()
      }
      if (Array.isArray(entry)) {
        return new THREE.Vector2(Number(entry[0]), Number(entry[1]))
      }
      return new THREE.Vector2(Number(entry.x), Number(entry.y))
    }),
  )
  if (footprint.length < 3) {
    return {
      vertices: [],
      indices: [],
      mode: 'exact',
    }
  }

  const gridSize = resolveGroundWorkingGridSize(runtimeDefinition)
  const columns = gridSize.columns
  const rows = gridSize.rows
  const cellSize = Number.isFinite(runtimeDefinition.cellSize) && runtimeDefinition.cellSize > 1e-6
    ? runtimeDefinition.cellSize
    : 1
  const bounds = resolveGroundGridWorldBounds(runtimeDefinition)

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  footprint.forEach((point) => {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minZ = Math.min(minZ, point.y)
    maxZ = Math.max(maxZ, point.y)
  })

  const startColumn = clampInclusive(Math.floor((minX - bounds.minX) / cellSize), 0, Math.max(0, columns - 1))
  const endColumn = clampInclusive(Math.floor((maxX - bounds.minX) / cellSize), 0, Math.max(0, columns - 1))
  const startRow = clampInclusive(Math.floor((minZ - bounds.minZ) / cellSize), 0, Math.max(0, rows - 1))
  const endRow = clampInclusive(Math.floor((maxZ - bounds.minZ) / cellSize), 0, Math.max(0, rows - 1))
  const coveredCellCount = Math.max(0, endColumn - startColumn + 1) * Math.max(0, endRow - startRow + 1)

  const footprintPolygon: PolygonClippingMultiPolygon = [[vector2LoopToGroundClippingRing(footprint)]]
  const footprintBounds = { minX, maxX, minZ, maxZ }
  const vertices: Array<{ x: number; y: number; z: number }> = []
  const indices: number[] = []
  const vertexIndexByKey = new Map<string, number>()

  const allowPlanarRegionMerge = options.mergePlanarRegions !== false
    && coveredCellCount <= GROUND_TRIANGLE_SLICE_MAX_PLANAR_REGION_CELLS
  const { planarRegions, triangleCells, aborted } = allowPlanarRegionMerge
    ? resolveGroundPlanarSliceRegions(
      runtimeDefinition,
      startRow,
      endRow,
      startColumn,
      endColumn,
      GROUND_TRIANGLE_SLICE_PLANAR_TOLERANCE,
      GROUND_TRIANGLE_SLICE_MAX_FRAGMENT_COUNT,
    )
    : {
      planarRegions: [] as GroundPlanarSliceRegion[],
      triangleCells: Array.from({ length: endRow - startRow + 1 }, (_, rowOffset) => rowOffset + startRow)
        .flatMap((row) => Array.from({ length: endColumn - startColumn + 1 }, (_, columnOffset) => ({
          row,
          column: columnOffset + startColumn,
        }))),
      aborted: false,
    }
  const degradeReason = shouldDegradeGroundTriangleSlice(
    coveredCellCount,
    planarRegions.length,
    triangleCells.length,
    aborted,
  )
  if (degradeReason) {
    return {
      vertices: [],
      indices: [],
      mode: 'approx',
    }
  }

  planarRegions.forEach((region) => {
    const regionPolygon = buildGroundPlanarSliceRegionPolygon(runtimeDefinition, region)
    const regionBounds = computeGroundLoopBounds(regionPolygon)
    if (!regionBounds || !groundSliceBoundsOverlap(footprintBounds, regionBounds)) {
      return
    }
    if (groundSliceLoopContainedByPolygon(regionPolygon, footprint)) {
      appendGroundSlicePolygon(
        regionPolygon,
        [],
        (x, z) => {
          const localColumn = (x - bounds.minX) / cellSize
          const localRow = (z - bounds.minZ) / cellSize
          return region.h00
            + region.slopeX * (localColumn - region.startColumn)
            + region.slopeZ * (localRow - region.startRow)
        },
        vertices,
        indices,
        vertexIndexByKey,
      )
      return
    }
    const clip = polygonClipping.intersection(
      footprintPolygon as any,
      [[vector2LoopToGroundClippingRing(regionPolygon)]] as any,
    ) as PolygonClippingMultiPolygon
    appendGroundSliceClip(
      clip,
      (x, z) => {
        const localColumn = (x - bounds.minX) / cellSize
        const localRow = (z - bounds.minZ) / cellSize
        return region.h00
          + region.slopeX * (localColumn - region.startColumn)
          + region.slopeZ * (localRow - region.startRow)
      },
      vertices,
      indices,
      vertexIndexByKey,
    )
  })

  triangleCells.forEach(({ row, column }) => {
    const triangles = resolveGroundCellTriangleDefinitions(runtimeDefinition, row, column)
    triangles.forEach((triangle) => {
      const triangleBounds = buildGroundSliceTriangleBounds(triangle)
      if (!groundSliceBoundsOverlap(footprintBounds, triangleBounds)) {
        return
      }
      if (groundSliceLoopContainedByPolygon(triangle.vertices, footprint)) {
        appendGroundSlicePolygon(
          triangle.vertices,
          [],
          (x, z) => {
            const sampled = interpolateGroundTrianglePlaneHeight(triangle, x, z)
            return Number.isFinite(sampled) ? (sampled as number) : sampleGroundTriangleHeight(runtimeDefinition, x, z)
          },
          vertices,
          indices,
          vertexIndexByKey,
        )
        return
      }
      const clip = polygonClipping.intersection(
        footprintPolygon as any,
        [[vector2LoopToGroundClippingRing(triangle.vertices)]] as any,
      ) as PolygonClippingMultiPolygon
      appendGroundSliceClip(
        clip,
        (x, z) => {
          const sampled = interpolateGroundTrianglePlaneHeight(triangle, x, z)
          return Number.isFinite(sampled) ? (sampled as number) : sampleGroundTriangleHeight(runtimeDefinition, x, z)
        },
        vertices,
        indices,
        vertexIndexByKey,
      )
    })
  })

  return { vertices, indices, mode: 'exact' }
}

export function sampleGroundHeight(definition: GroundDynamicMesh, x: number, z: number): number {
  // 先把定义补成运行时可用形态，避免后续访问工作网格、高度图或运行时采样器时缺字段。
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  // 本地编辑层拥有最高优先级：如果当前位置已经被编辑数据覆盖，就直接返回覆盖高度。
  const localEditSample = sampleGroundLocalEditHeightAtWorldFromRuntime(runtimeDefinition, x, z)
  if (Number.isFinite(localEditSample)) {
    return localEditSample as number
  }
  // 获取当前工作网格的行列数量，用来把世界坐标映射到地形网格索引。
  const gridSize = resolveGroundWorkingGridSizeCached(runtimeDefinition)
  const columns = gridSize.columns
  const rows = gridSize.rows
  // cellSize 必须是一个正数；如果定义里出现非法值，这里回退到 1，避免除零或索引异常。
  const cellSize = Number.isFinite(runtimeDefinition.cellSize) && runtimeDefinition.cellSize > 1e-6
    ? runtimeDefinition.cellSize
    : 1
  // 当前地形的世界边界，用于判断采样点是否落在工作范围内。
  const bounds = resolveGroundWorldBoundsCached(runtimeDefinition)
  // 运行时采样器是底层地形来源的回退入口，边界外或缺省值场景会用到它。
  const terrainSampler = resolveRuntimeTerrainHeightSampler(runtimeDefinition)
  // 如果点已经超出当前工作边界，就不再强行走内部网格插值，而是交给边界外逻辑处理。
  if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) {
    return sampleGroundHeightOutsideWorkingBounds(
      runtimeDefinition,
      x,
      z,
      terrainSampler,
    )
  }

  // 将世界坐标换算成工作网格中的浮点列/行坐标。
  // 保留小数部分，是为了后面的双线性插值能够得到连续、平滑的高度过渡。
  const boundsMinX = bounds.minX
  const boundsMinZ = bounds.minZ
  const localColumnFloat = clampInclusive((x - boundsMinX) / cellSize, 0, columns)
  const localRowFloat = clampInclusive((z - boundsMinZ) / cellSize, 0, rows)

  // 取当前采样点所在单元格的四个角点索引。
  // 这里通过 floor 找左上角，再向右下各取一个邻点，形成插值所需的四个采样点。
  const column0 = clampVertexIndex(Math.floor(localColumnFloat), columns)
  const row0 = clampVertexIndex(Math.floor(localRowFloat), rows)
  const column1 = clampVertexIndex(column0 + 1, columns)
  const row1 = clampVertexIndex(row0 + 1, rows)

  // 当前点在单元格内部的横向/纵向权重，限制在 [0, 1]，用于插值。
  const tx = clampInclusive(localColumnFloat - column0, 0, 1)
  const tz = clampInclusive(localRowFloat - row0, 0, 1)

  // 读取四个角点的“有效高度”。
  // 这个函数会把手动编辑、规划态覆盖和基础地形统一折算到同一个结果上。
  const h00 = resolveGroundEffectiveHeightAtVertexWithContext(runtimeDefinition, row0, column0, columns, boundsMinX, boundsMinZ, cellSize, terrainSampler)
  const h10 = resolveGroundEffectiveHeightAtVertexWithContext(runtimeDefinition, row0, column1, columns, boundsMinX, boundsMinZ, cellSize, terrainSampler)
  const h01 = resolveGroundEffectiveHeightAtVertexWithContext(runtimeDefinition, row1, column0, columns, boundsMinX, boundsMinZ, cellSize, terrainSampler)
  const h11 = resolveGroundEffectiveHeightAtVertexWithContext(runtimeDefinition, row1, column1, columns, boundsMinX, boundsMinZ, cellSize, terrainSampler)

  // 先在 X 方向插值，再在 Z 方向插值，得到单元格内任意点的平滑高度值。
  const hx0 = h00 + (h10 - h00) * tx
  const hx1 = h01 + (h11 - h01) * tx
  return hx0 + (hx1 - hx0) * tz
}

/**
 * Samples the ground height at (x, z) using a pre-built GroundHeightSamplingContext.
 * Use prepareGroundHeightSamplingContext once before a scatter/sampling loop to avoid
 * re-reading Vue reactive properties on every call.
 */
export function sampleGroundHeightWithContext(
  runtimeDefinition: GroundRuntimeDynamicMesh,
  context: GroundHeightSamplingContext,
  x: number,
  z: number,
): number {
  const localEditSample = sampleGroundLocalEditHeightAtWorldFromRuntime(runtimeDefinition, x, z)
  if (Number.isFinite(localEditSample)) {
    return localEditSample as number
  }
  const { bounds, columns, rows, cellSize, terrainSampler } = context
  if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) {
    return sampleGroundHeightOutsideWorkingBounds(runtimeDefinition, x, z, terrainSampler)
  }
  const boundsMinX = bounds.minX
  const boundsMinZ = bounds.minZ
  const localColumnFloat = clampInclusive((x - boundsMinX) / cellSize, 0, columns)
  const localRowFloat = clampInclusive((z - boundsMinZ) / cellSize, 0, rows)
  const column0 = clampVertexIndex(Math.floor(localColumnFloat), columns)
  const row0 = clampVertexIndex(Math.floor(localRowFloat), rows)
  const column1 = clampVertexIndex(column0 + 1, columns)
  const row1 = clampVertexIndex(row0 + 1, rows)
  const tx = clampInclusive(localColumnFloat - column0, 0, 1)
  const tz = clampInclusive(localRowFloat - row0, 0, 1)
  const h00 = resolveGroundEffectiveHeightAtVertexWithContext(runtimeDefinition, row0, column0, columns, boundsMinX, boundsMinZ, cellSize, terrainSampler)
  const h10 = resolveGroundEffectiveHeightAtVertexWithContext(runtimeDefinition, row0, column1, columns, boundsMinX, boundsMinZ, cellSize, terrainSampler)
  const h01 = resolveGroundEffectiveHeightAtVertexWithContext(runtimeDefinition, row1, column0, columns, boundsMinX, boundsMinZ, cellSize, terrainSampler)
  const h11 = resolveGroundEffectiveHeightAtVertexWithContext(runtimeDefinition, row1, column1, columns, boundsMinX, boundsMinZ, cellSize, terrainSampler)
  const hx0 = h00 + (h10 - h00) * tx
  const hx1 = h01 + (h11 - h01) * tx
  return hx0 + (hx1 - hx0) * tz
}

export function sampleGroundNormal(
  definition: GroundRuntimeDynamicMesh,
  x: number,
  z: number,
  target?: THREE.Vector3,
): THREE.Vector3 {
  const result = target ?? new THREE.Vector3()
  const delta = Math.max(0.01, definition.cellSize * 0.5)
  const heightL = sampleGroundHeight(definition, x - delta, z)
  const heightR = sampleGroundHeight(definition, x + delta, z)
  const heightF = sampleGroundHeight(definition, x, z + delta)
  const heightB = sampleGroundHeight(definition, x, z - delta)
  const dx = heightL - heightR
  const dz = heightB - heightF
  result.set(dx, delta * 2, dz)
  if (result.lengthSq() === 0) {
    result.set(0, 1, 0)
  } else {
    result.normalize()
  }
  return result
}

function buildGroundGeometry(definition: GroundRuntimeDynamicMesh): THREE.BufferGeometry {
  const gridSize = resolveGroundWorkingGridSize(definition)
  const columns = gridSize.columns
  const rows = gridSize.rows
  const vertexColumns = columns + 1
  const vertexRows = rows + 1
  const vertexCount = vertexColumns * vertexRows
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = new Uint32Array(columns * rows * 6)

  const bounds = resolveGroundWorldBounds(definition)
  const cellSize = definition.cellSize
  const heightRegion = sampleGroundEffectiveHeightRegion(definition, 0, rows, 0, columns)
  const heightValues = heightRegion.values
  const heightStride = heightRegion.stride

  let vertexIndex = 0
  for (let row = 0; row <= rows; row += 1) {
    const z = bounds.minZ + row * cellSize
    const heightOffset = row * heightStride
    for (let column = 0; column <= columns; column += 1) {
      const x = bounds.minX + column * cellSize
      const height = heightValues[heightOffset + column] ?? 0

      positions[vertexIndex * 3 + 0] = x
      positions[vertexIndex * 3 + 1] = height
      positions[vertexIndex * 3 + 2] = z

      normals[vertexIndex * 3 + 0] = 0
      normals[vertexIndex * 3 + 1] = 1
      normals[vertexIndex * 3 + 2] = 0

      uvs[vertexIndex * 2 + 0] = columns === 0 ? 0 : column / columns
      uvs[vertexIndex * 2 + 1] = rows === 0 ? 0 : 1 - row / rows

      vertexIndex += 1
    }
  }

  let indexPointer = 0
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * vertexColumns + column
      const b = a + 1
      const c = (row + 1) * vertexColumns + column
      const d = c + 1

      indices[indexPointer + 0] = a
      indices[indexPointer + 1] = c
      indices[indexPointer + 2] = b
      indices[indexPointer + 3] = b
      indices[indexPointer + 4] = c
      indices[indexPointer + 5] = d
      indexPointer += 6
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function resolveOptimizedChunkForSpec(
  definition: GroundDynamicMesh,
  spec: GroundChunkSpec,
): GroundOptimizedMeshChunkData | null {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  if (chunkIntersectsGroundLocalEditTileFromRuntime(runtimeDefinition, spec) || hasRuntimeGroundHeightOverrides(runtimeDefinition)) {
    return null
  }
  const optimizedMesh = resolveOptimizedMesh(definition)
  if (!optimizedMesh) {
    return null
  }
  return optimizedMesh.chunks.find((chunk) => (
    chunk.startRow === spec.startRow
    && chunk.startColumn === spec.startColumn
    && chunk.rows === spec.rows
    && chunk.columns === spec.columns
  )) ?? null
}

function createGroundOptimizedChunkGeometry(chunk: GroundOptimizedMeshChunkData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(chunk.positions), 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(chunk.uvs), 2))
  const indexArray = chunk.positions.length / 3 > 65535
    ? new Uint32Array(chunk.indices)
    : new Uint16Array(chunk.indices)
  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function computeHeightfieldNormals(
  positions: Float32Array,
  normals: Float32Array,
  rows: number,
  columns: number,
  stepX: number,
  stepZ: number,
): void {
  const safeStepX = Math.max(Math.abs(stepX), Number.EPSILON)
  const safeStepZ = Math.max(Math.abs(stepZ), Number.EPSILON)
  const vertexColumns = columns + 1

  for (let row = 0; row <= rows; row += 1) {
    const rowUp = row > 0 ? row - 1 : row
    const rowDown = row < rows ? row + 1 : row
    const sampleSpanZ = Math.max(1, rowDown - rowUp) * safeStepZ

    for (let column = 0; column <= columns; column += 1) {
      const columnLeft = column > 0 ? column - 1 : column
      const columnRight = column < columns ? column + 1 : column
      const sampleSpanX = Math.max(1, columnRight - columnLeft) * safeStepX

      const centerIndex = row * vertexColumns + column
      const leftIndex = row * vertexColumns + columnLeft
      const rightIndex = row * vertexColumns + columnRight
      const upIndex = rowUp * vertexColumns + column
      const downIndex = rowDown * vertexColumns + column

      const leftHeight = positions[leftIndex * 3 + 1] ?? 0
      const rightHeight = positions[rightIndex * 3 + 1] ?? 0
      const upHeight = positions[upIndex * 3 + 1] ?? 0
      const downHeight = positions[downIndex * 3 + 1] ?? 0

      const slopeX = (rightHeight - leftHeight) / sampleSpanX
      const slopeZ = (downHeight - upHeight) / sampleSpanZ
      const nx = -slopeX
      const ny = 1
      const nz = -slopeZ
      const invLength = 1 / Math.max(Math.hypot(nx, ny, nz), Number.EPSILON)

      normals[centerIndex * 3 + 0] = nx * invLength
      normals[centerIndex * 3 + 1] = ny * invLength
      normals[centerIndex * 3 + 2] = nz * invLength
    }
  }
}

type GroundHeightSampleCache = Map<number, Map<number, number>>

type GroundNormalScratch = {
  normalA: THREE.Vector3
  normalB: THREE.Vector3
  blended: THREE.Vector3
  boundaryNormal: THREE.Vector3
  cornerNormalA: THREE.Vector3
  cornerNormalB: THREE.Vector3
  cornerNormalC: THREE.Vector3
  cornerNormalD: THREE.Vector3
  cornerAverage: THREE.Vector3
}

function createGroundNormalScratch(): GroundNormalScratch {
  return {
    normalA: new THREE.Vector3(),
    normalB: new THREE.Vector3(),
    blended: new THREE.Vector3(),
    boundaryNormal: new THREE.Vector3(),
    cornerNormalA: new THREE.Vector3(),
    cornerNormalB: new THREE.Vector3(),
    cornerNormalC: new THREE.Vector3(),
    cornerNormalD: new THREE.Vector3(),
    cornerAverage: new THREE.Vector3(),
  }
}

function sampleGroundHeightCached(
  definition: GroundDynamicMesh,
  x: number,
  z: number,
  cache: GroundHeightSampleCache,
): number {
  // 这里使用两层 Map 缓存：
  // 第一层按 x 分桶，第二层按 z 存储结果，这样可以高频复用重复采样点的高度值。
  const xCache = cache.get(x)
  const cached = xCache?.get(z)
  if (typeof cached === 'number' && Number.isFinite(cached)) {
    return cached
  }
  // 缓存未命中时，回到标准采样函数计算一次高度。
  const height = sampleGroundHeight(definition, x, z)
  // 将这次计算结果写回缓存，供后续同坐标或重复邻近查询复用。
  if (xCache) {
    xCache.set(z, height)
  } else {
    cache.set(x, new Map<number, number>([[z, height]]))
  }
  return height
}

function sampleGroundNormalWithHeightCache(
  definition: GroundRuntimeDynamicMesh,
  x: number,
  z: number,
  target: THREE.Vector3 | undefined,
  heightCache: GroundHeightSampleCache,
): THREE.Vector3 {
  const result = target ?? new THREE.Vector3()
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
  const delta = Math.max(0.01, cellSize * 0.5)
  const heightL = sampleGroundHeightCached(definition, x - delta, z, heightCache)
  const heightR = sampleGroundHeightCached(definition, x + delta, z, heightCache)
  const heightF = sampleGroundHeightCached(definition, x, z + delta, heightCache)
  const heightB = sampleGroundHeightCached(definition, x, z - delta, heightCache)
  const dx = heightL - heightR
  const dz = heightB - heightF
  result.set(dx, delta * 2, dz)
  if (result.lengthSq() === 0) {
    result.set(0, 1, 0)
  } else {
    result.normalize()
  }
  return result
}

function computeSampledGroundNormals(
  definition: GroundRuntimeDynamicMesh,
  positions: Float32Array,
  normals: Float32Array,
  heightCache: GroundHeightSampleCache,
  scratch: GroundNormalScratch,
): void {
  const normal = new THREE.Vector3()
  const vertexCount = Math.min(
    Math.floor(positions.length / 3),
    Math.floor(normals.length / 3),
  )
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    const offset = vertexIndex * 3
    const x = positions[offset] ?? 0
    const z = positions[offset + 2] ?? 0
    sampleGroundSeamAwareNormal(definition, x, z, normal, heightCache, scratch)
    normals[offset] = normal.x
    normals[offset + 1] = normal.y
    normals[offset + 2] = normal.z
  }
}

export type GroundGeometryUpdateRegion = {
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
}

function sampleGroundSeamAwareNormal(
  definition: GroundRuntimeDynamicMesh,
  x: number,
  z: number,
  target?: THREE.Vector3,
  heightCache?: GroundHeightSampleCache,
  scratch?: GroundNormalScratch,
): THREE.Vector3 {
  const workingHeightCache = heightCache ?? new Map<number, Map<number, number>>()
  const result = sampleGroundNormalWithHeightCache(definition, x, z, target, workingHeightCache)
  void scratch
  // The old seam-aware branch only mattered for the removed GroundChunk split path.
  // Keep the function as a thin wrapper so sampled normals still work for the remaining runtime path.
  return result
}

function buildGroundChunkGeometry(definition: GroundRuntimeDynamicMesh, spec: GroundChunkSpec): THREE.BufferGeometry {
  // 这个函数负责把“一个 chunk 范围内的地形高度场”转换成 Three.js 的 BufferGeometry。
  // 它的输出是独立的 chunk mesh 几何，不是整张地形的总网格。
  // 这样做的好处是：局部雕刻后只需要重建受影响的 chunk，而不必重算全场。
  const optimizedChunk = resolveOptimizedChunkForSpec(definition, spec)
  if (optimizedChunk) {
    // 如果这个 chunk 已经存在可直接复用的优化数据，就优先走烘焙/优化后的几何生成路径。
    // 这样可以跳过高度采样和拓扑重建，减少运行时开销。
    return createGroundOptimizedChunkGeometry(optimizedChunk)
  }

  // chunkCells 表示运行时地形按多大的 cell 组织 chunk。
  // 这里先把 spec 的起点换算成当前 chunk 所属的 chunk 行列，用于判断是否能退化成平面。
  const chunkCells = resolveRuntimeChunkCells(definition)
  const chunkRow = Math.trunc(spec.startRow / Math.max(1, chunkCells))
  const chunkColumn = Math.trunc(spec.startColumn / Math.max(1, chunkCells))
  if (canTreatGroundChunkAsFlatPlane(definition, chunkRow, chunkColumn, { allowBakedSurfaceTexture: true })) {
    // 没有局部雕刻、也没有必须保留的 baked surface 纹理时，这个 chunk 可以走平面快速路径。
    // 平面路径通常会更轻量，适合大面积未编辑区域。
    return buildDenseFlatGroundChunkGeometry(definition, spec)
  }

  // 根据 chunk 的几何规格，计算最终渲染用的分段布局。
  // 这里的 segmentRows / segmentColumns 可能和原始 chunkCells 不完全一致，
  // 目的是让世界尺寸、采样精度和局部编辑采样能够在同一个几何里对齐。
  const layout = resolveGroundChunkGeometryLayout(definition, spec)
  const chunkColumns = layout.segmentColumns
  const chunkRows = layout.segmentRows
  const vertexColumns = chunkColumns + 1
  const vertexRows = chunkRows + 1
  const vertexCount = vertexColumns * vertexRows

  // 按顶点数预分配 position / normal / uv / index 缓冲区。
  // 先申请连续数组，再逐点/逐三角形写入，比动态 push 更稳定，也更适合 Three.js 的 BufferAttribute。
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = new Uint32Array(chunkColumns * chunkRows * 6)

  // 高度采样缓存：同一 chunk 内多个顶点可能会重复访问同一个世界坐标附近的高度值，
  // 先缓存再复用，可以减少 sampleGroundHeightCached 的重复计算。
  const heightCache: GroundHeightSampleCache = new Map<number, Map<number, number>>()
  const normalScratch = createGroundNormalScratch()

  // 计算当前 chunk 在世界坐标中的左上角/起始点。
  // 后续每个局部顶点都要在这个起点基础上加偏移，才能得到世界空间坐标。
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 1e-6 ? definition.cellSize : 1
  const chunkSizeMeters = resolveInfiniteChunkSizeMeters(definition)
  const chunkOrigin = resolveInfiniteGroundGridOriginMeters(chunkSizeMeters)
  const startX = chunkOrigin + spec.startColumn * cellSize
  const startZ = chunkOrigin + spec.startRow * cellSize

  // 常规路径：一次性取出当前 chunk 覆盖区域的高度矩阵。
  // 这会给后续逐顶点写 position 提供一个连续的 height buffer。
  const heightRegion = sampleGroundEffectiveHeightRegion(
      definition,
      spec.startRow,
      spec.startRow + spec.rows,
      spec.startColumn,
      spec.startColumn + spec.columns,
    )
  const heightValues = heightRegion?.values
  const heightStride = heightRegion?.stride ?? 0

  // 逐顶点填充 position / normal / uv。
  // position.xz 由 chunk 起点和局部网格坐标决定，position.y 则来自高度采样结果。
  // uv 使用 chunk 内的归一化坐标，保证贴图在 chunk 内可以平滑铺开。
  // 这里按“行优先”的顺序遍历 chunk 内的每一个网格顶点。
  // 顶点数量比单元格数量多一行、多一列，因此循环条件使用 `<=`，
  // 这样才能把边界上的顶点也完整写入缓冲区。
  let vertexIndex = 0
  for (let localRow = 0; localRow <= chunkRows; localRow += 1) {
    // 当前顶点在世界空间中的 Z 坐标，由 chunk 起点加上行方向步进得到。
    const z = startZ + localRow * layout.stepZ
    for (let localColumn = 0; localColumn <= chunkColumns; localColumn += 1) {
      // 当前顶点在世界空间中的 X 坐标，由 chunk 起点加上列方向步进得到。
      const x = startX + localColumn * layout.stepX
      // 采样该顶点对应的地形高度。
      // - 若启用了 world-space 采样，则直接按世界坐标从缓存/采样函数取高度；
      // - 否则优先使用预先计算好的 heightRegion；
      // - 如果 region 中没有对应值，再回退到缓存采样，避免出现空洞。
      const height =  heightValues?.[localRow * heightStride + localColumn] ?? 0
      // 将局部顶点位置映射到 0~1 的 UV 空间。
      // U 沿列方向从左到右线性增长，V 沿行方向从上到下反向归一化，
      // 这样贴图在整个 chunk 上的朝向和视觉效果会更稳定。
      const u = chunkColumns === 0 ? 0 : localColumn / chunkColumns
      const v = chunkRows === 0 ? 0 : 1 - (localRow / chunkRows)

      // position: x / y / z 直接写入对应的顶点槽位。
      positions[vertexIndex * 3 + 0] = x
      positions[vertexIndex * 3 + 1] = height
      positions[vertexIndex * 3 + 2] = z

      // 当前地形网格默认按“朝上”的平面处理，法线先统一写成 (0, 1, 0)。
      // 如果后续有基于坡度的平滑法线计算，这里通常会被更精细的结果覆盖。
      normals[vertexIndex * 3 + 0] = 0
      normals[vertexIndex * 3 + 1] = 1
      normals[vertexIndex * 3 + 2] = 0

      // UV 按顶点顺序写入，供材质采样、纹理拼接或后续着色逻辑使用。
      uvs[vertexIndex * 2 + 0] = u
      uvs[vertexIndex * 2 + 1] = v

      // 当前顶点写完后，指针后移到下一个顶点槽位。
      vertexIndex += 1
    }
  }

  // 逐单元格写三角形索引。
  // 每个四边形 cell 会拆成两个三角形，形成标准的地形网格拓扑。
  let indexPointer = 0
  for (let row = 0; row < chunkRows; row += 1) {
    for (let column = 0; column < chunkColumns; column += 1) {
      const a = row * vertexColumns + column
      const b = a + 1
      const c = (row + 1) * vertexColumns + column
      const d = c + 1

      indices[indexPointer + 0] = a
      indices[indexPointer + 1] = c
      indices[indexPointer + 2] = b
      indices[indexPointer + 3] = b
      indices[indexPointer + 4] = c
      indices[indexPointer + 5] = d
      indexPointer += 6
    }
  }

  // 将原始 typed array 封装成 BufferGeometry 属性。
  // 这样 Three.js 才能在 GPU 上正确使用这些顶点、法线和 UV 数据。
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))

  // 法线重新计算是为了让地形明暗跟随真实起伏。
  // 如果使用了世界坐标采样或局部编辑 tile，就需要更精确的采样式法线；
  // 否则规则 heightfield 的标准法线计算就足够了。
  if (shouldUseGroundLocalEditTiles(definition)) {
    computeSampledGroundNormals(definition, positions, normals, heightCache, normalScratch)
  } else {
    computeHeightfieldNormals(positions, normals, chunkRows, chunkColumns, layout.stepX, layout.stepZ)
  }

  // 几何变化后要刷新包围信息。
  // bounding box / sphere 会影响视锥裁剪、拾取和部分空间查询逻辑。
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function computeChunkSpec(definition: GroundDynamicMesh, chunkRow: number, chunkColumn: number): GroundChunkSpec {
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
  const chunkSpanMeters = resolveInfiniteChunkSizeMeters(definition)
  const chunkSpanCells = Math.max(1, Math.round(chunkSpanMeters / Math.max(cellSize, Number.EPSILON)))
  const startRow = chunkRow * chunkSpanCells
  const startColumn = chunkColumn * chunkSpanCells
  return {
    startRow,
    startColumn,
    rows: chunkSpanCells,
    columns: chunkSpanCells,
  }
}

function ensureGroundRuntimeState(root: THREE.Object3D, definition: GroundDynamicMesh): GroundRuntimeState {
  const signature = definitionStructureSignature(definition)
  const existing = groundRuntimeStateMap.get(root)
  const chunkCells = resolveRuntimeChunkCells(definition)
  const desiredCastShadow = definition.castShadow === true
  if (existing && existing.definitionSignature === signature && existing.chunkCells === chunkCells) {
    existing.flatTilingVersion = Number.isFinite(existing.flatTilingVersion) ? existing.flatTilingVersion : 0
    existing.flatChunkKeys = existing.flatChunkKeys instanceof Set ? existing.flatChunkKeys : new Set<string>()
    if (existing.flatChunkKeys.size === 0 && existing.flatChunkBatches.size > 0) {
      syncGroundFlatChunkKeyCache(existing)
    }
    existing.lastFlatChunkSyncTilingVersion = Number.isFinite(existing.lastFlatChunkSyncTilingVersion)
      ? existing.lastFlatChunkSyncTilingVersion
      : -1
    existing.lastFlatChunkSyncHiddenChunkKeysVersion = Number.isFinite(existing.lastFlatChunkSyncHiddenChunkKeysVersion)
      ? existing.lastFlatChunkSyncHiddenChunkKeysVersion
      : -1
    existing.flatChunkBatches.forEach((batch) => {
      batch.pendingChunkKeys = batch.pendingChunkKeys instanceof Set ? batch.pendingChunkKeys : new Set<string>()
      batch.asyncBuildInFlight = batch.asyncBuildInFlight === true
    })
    existing.visibleChunkSignatureCache = typeof existing.visibleChunkSignatureCache === 'string'
      ? existing.visibleChunkSignatureCache
      : ''
    existing.visibleChunkSignatureCacheVersion = Number.isFinite(existing.visibleChunkSignatureCacheVersion)
      ? existing.visibleChunkSignatureCacheVersion
      : -1
    if (existing.castShadow !== desiredCastShadow) {
      existing.castShadow = desiredCastShadow
      for (const runtime of existing.chunks.values()) {
        runtime.mesh.castShadow = desiredCastShadow
      }
    }
    return existing
  }

  if (existing) {
    existing.chunks.forEach((entry) => {
      entry.mesh.geometry?.dispose?.()
      // Materials are managed externally (SceneGraph/editor), do not dispose here.
      entry.mesh.removeFromParent()
    })

    existing.flatChunkBatches.forEach((batch) => {
      batch.mesh.removeFromParent()
      try {
        ;(batch.mesh.geometry as any)?.dispose?.()
      } catch (_error) {
        /* noop */
      }
    })
    existing.flatChunkBatches.clear()

    existing.meshPool.forEach((entries) => {
      entries.forEach((mesh) => {
        try {
          ;(mesh.geometry as any)?.dispose?.()
        } catch (_error) {
          /* noop */
        }
        const material = Array.isArray(mesh.material) ? (mesh.material[0] ?? null) : (mesh.material ?? null)
        if (material) {
          disposeGroundChunkTexturedMaterial(material)
        }
      })
    })
    existing.meshPool.clear()
    existing.pendingCreates = []
    existing.pendingDestroys = []
  }

  const next: GroundRuntimeState = {
    definitionSignature: signature,
    chunkCells,
    castShadow: desiredCastShadow,
    chunks: new Map(),
    flatChunkBatches: new Map(),
    flatTilingInitialized: false,
    flatTilingVersion: 0,
    flatTilingMinChunkRow: 0,
    flatTilingMaxChunkRow: 0,
    flatTilingMinChunkColumn: 0,
    flatTilingMaxChunkColumn: 0,
    flatChunkKeys: new Set(),
    lastFlatChunkSyncTilingVersion: -1,
    lastFlatChunkSyncHiddenChunkKeysVersion: -1,
    hiddenChunkKeys: new Set(),
    hiddenChunkKeysVersion: 0,
    visibleChunkKeysCache: [],
    visibleChunkKeysVersion: 0,
    visibleChunkKeysCacheVersion: -1,
    visibleChunkSignatureCache: '',
    visibleChunkSignatureCacheVersion: -1,
    lastChunkUpdateAt: 0,

    desiredSignature: '',
    lastCameraLocalX: 0,
    lastCameraLocalZ: 0,

    pendingCreates: [],
    pendingDestroys: [],

    meshPool: new Map(),
    poolMaxPerSize: 8,
  }
  groundRuntimeStateMap.set(root, next)
  return next
}

function markGroundVisibleChunkKeysDirty(state: GroundRuntimeState): void {
  state.visibleChunkKeysVersion += 1
}

function updateGroundChunkSignatureHash(hash: number, key: string): number {
  let next = hash | 0
  for (let index = 0; index < key.length; index += 1) {
    next = ((next * 33) ^ key.charCodeAt(index)) | 0
  }
  return next
}

function chunkPoolKey(spec: GroundChunkSpec): string {
  const rows = Math.max(1, Math.trunc(spec.rows))
  const columns = Math.max(1, Math.trunc(spec.columns))
  return `${rows}x${columns}`
}

function sampleGroundFlatChunkInstanceHeight(
  batch: GroundFlatChunkBatchRuntime,
  definition: GroundRuntimeDynamicMesh,
  key: string,
  _x: number,
  _z: number,
  _context: GroundHeightSamplingContext,
): number {
  const cached = batch.instanceHeightCache.get(key)
  if (typeof cached === 'number' && Number.isFinite(cached)) {
    return cached
  }
  const baseHeight = Number(definition.baseHeight)
  const height = Number.isFinite(baseHeight) ? baseHeight : 0
  batch.instanceHeightCache.set(key, height)
  return height
}

function canBuildGroundFlatChunkInstancesAsync(definition: GroundRuntimeDynamicMesh): boolean {
  return !!groundFlatChunkInstanceMatrixBuilder
    && !definition.runtimeTerrainHeightSampler
}

function syncGroundFlatChunkKeyCache(state: GroundRuntimeState): void {
  const keys = new Set<string>()
  state.flatChunkBatches.forEach((batch) => {
    batch.chunkKeys.forEach((key) => {
      keys.add(key)
    })
    batch.pendingChunkKeys.forEach((key) => {
      keys.add(key)
    })
  })
  state.flatChunkKeys = keys
}

function resolveGroundFlatChunkBatchCapacity(requiredCount: number, currentCapacity = 0): number {
  const required = Math.max(1, Math.trunc(requiredCount))
  const current = Math.max(0, Math.trunc(currentCapacity))
  if (required <= current) {
    return current
  }
  if (current <= 0) {
    return Math.max(16, required)
  }
  return Math.max(required, Math.ceil(current * 1.5))
}

function copyGroundFlatChunkInstanceMatrices(
  source: THREE.InstancedMesh,
  target: THREE.InstancedMesh,
  instanceCount: number,
): void {
  const copyLength = Math.max(0, Math.trunc(instanceCount)) * 16
  if (copyLength <= 0) {
    return
  }
  const sourceArray = source.instanceMatrix.array as Float32Array
  const targetArray = target.instanceMatrix.array as Float32Array
  targetArray.set(sourceArray.subarray(0, copyLength), 0)
  target.instanceMatrix.needsUpdate = true
}

function writeGroundFlatChunkInstanceMatrix(
  targetArray: Float32Array,
  index: number,
  x: number,
  y: number,
  z: number,
): void {
  const offset = Math.max(0, Math.trunc(index)) * 16
  targetArray.set(groundFlatChunkInstanceMatrixBase, offset)
  targetArray[offset + 12] = x
  targetArray[offset + 13] = y
  targetArray[offset + 14] = z
}

function copyGroundFlatChunkInstanceMatrixBuffer(
  targetArray: Float32Array,
  startIndex: number,
  matrices: Float32Array,
  instanceCount: number,
): void {
  const safeCount = Math.max(0, Math.trunc(instanceCount))
  if (safeCount <= 0) {
    return
  }
  const sourceLength = Math.min(matrices.length, safeCount * 16)
  if (sourceLength <= 0) {
    return
  }
  targetArray.set(matrices.subarray(0, sourceLength), Math.max(0, Math.trunc(startIndex)) * 16)
}

export function buildGroundFlatChunkInstanceMatrices(
  definition: GroundRuntimeDynamicMesh,
  chunkKeys: string[],
): GroundFlatChunkInstanceMatrixBuildResult {
  const matrices = new Float32Array(Math.max(0, Math.trunc(chunkKeys.length)) * 16)
  const resolvedKeys: string[] = []
  const chunkSizeMeters = resolveInfiniteChunkSizeMeters(definition)
  const chunkOrigin = resolveInfiniteGroundGridOriginMeters(chunkSizeMeters)
  const baseHeight = Number(definition.baseHeight)
  const planeHeight = Number.isFinite(baseHeight) ? baseHeight : 0
  let writeIndex = 0

  chunkKeys.forEach((key) => {
    const indices = resolveRuntimeChunkIndexFromRuntimeKey(key)
    if (!indices) {
      return
    }
    const centerX = chunkOrigin + (indices.column * chunkSizeMeters) + (chunkSizeMeters * 0.5)
    const centerZ = chunkOrigin + (indices.row * chunkSizeMeters) + (chunkSizeMeters * 0.5)
    writeGroundFlatChunkInstanceMatrix(matrices, writeIndex, centerX, planeHeight, centerZ)
    resolvedKeys.push(key)
    writeIndex += 1
  })

  return {
    chunkKeys: resolvedKeys,
    matrices: writeIndex === chunkKeys.length ? matrices : matrices.subarray(0, writeIndex * 16).slice(),
  }
}

function refreshGroundFlatChunkBatchInstances(
  batch: GroundFlatChunkBatchRuntime,
  definition: GroundRuntimeDynamicMesh,
  chunkKeys: string[],
): void {
  // 这一段把一组“完全平坦、没有局部雕刻”的 chunk 变成 InstancedMesh 批次。
  // 这么做的收益是：
  // - 所有平坦 chunk 共享几何和材质；
  // - 相机移动时只改 instance 矩阵，不需要每个 chunk 都重建 Mesh；
  // - 大多数地形都能走这条快路径，只有被局部雕刻影响的 chunk 才保留独立 Mesh。
  let writtenCount = 0
  const chunkSizeMeters = resolveInfiniteChunkSizeMeters(definition)
  const chunkOrigin = resolveInfiniteGroundGridOriginMeters(chunkSizeMeters)
  const heightSamplingContext = createGroundHeightSamplingContext(definition)
  const matrixArray = batch.mesh.instanceMatrix.array as Float32Array

  if (chunkKeys.length > batch.instanceCapacity) {
    batch.instanceCapacity = resolveGroundFlatChunkBatchCapacity(chunkKeys.length, batch.instanceCapacity)
  }
  chunkKeys.forEach((key, index) => {
    // 这里不要直接用 key 里的 row/column 去猜位置，而要回到 chunkSpec。
    // 原因是 chunkSpec 已经包含 startRow/startColumn/rows/columns 的完整切片信息，
    // 这样即使边缘 chunk 尺寸不满整格，instance 的位置也不会算偏。
    const indices = resolveRuntimeChunkIndexFromRuntimeKey(key)
    if (!indices) {
      return
    }
    const centerX = chunkOrigin + (indices.column * chunkSizeMeters) + (chunkSizeMeters * 0.5)
    const centerZ = chunkOrigin + (indices.row * chunkSizeMeters) + (chunkSizeMeters * 0.5)
    const centerY = sampleGroundFlatChunkInstanceHeight(batch, definition, key, centerX, centerZ, heightSamplingContext)
    writeGroundFlatChunkInstanceMatrix(matrixArray, index, centerX, centerY, centerZ)
    writtenCount += 1
  })
  batch.mesh.count = writtenCount
  batch.mesh.instanceMatrix.needsUpdate = true
  markInstancedBoundsDirty(batch.mesh)
  batch.mesh.visible = writtenCount > 0
  batch.mesh.userData.groundChunkBatch = {
    specKey: batch.specKey,
    chunkKeys: [...chunkKeys],
  }
  batch.chunkKeys = [...chunkKeys]
}

function appendGroundFlatChunkBatchInstances(
  batch: GroundFlatChunkBatchRuntime,
  definition: GroundRuntimeDynamicMesh,
  chunkKeys: string[],
): void {
  if (chunkKeys.length === 0) {
    return
  }

  const nextKeys = [...batch.chunkKeys]
  const chunkSizeMeters = resolveInfiniteChunkSizeMeters(definition)
  const chunkOrigin = resolveInfiniteGroundGridOriginMeters(chunkSizeMeters)
  const heightSamplingContext = createGroundHeightSamplingContext(definition)
  const matrixArray = batch.mesh.instanceMatrix.array as Float32Array
  let writeIndex = batch.chunkKeys.length

  chunkKeys.forEach((key) => {
    const indices = resolveRuntimeChunkIndexFromRuntimeKey(key)
    if (!indices) {
      return
    }

    const centerX = chunkOrigin + (indices.column * chunkSizeMeters) + (chunkSizeMeters * 0.5)
    const centerZ = chunkOrigin + (indices.row * chunkSizeMeters) + (chunkSizeMeters * 0.5)
    const centerY = sampleGroundFlatChunkInstanceHeight(batch, definition, key, centerX, centerZ, heightSamplingContext)
    writeGroundFlatChunkInstanceMatrix(matrixArray, writeIndex, centerX, centerY, centerZ)
    nextKeys.push(key)
    writeIndex += 1
  })

  batch.mesh.count = writeIndex
  batch.mesh.instanceMatrix.needsUpdate = true
  markInstancedBoundsDirty(batch.mesh)
  batch.mesh.visible = writeIndex > 0
  batch.mesh.userData.groundChunkBatch = {
    specKey: batch.specKey,
    chunkKeys: [...nextKeys],
  }
  batch.chunkKeys = nextKeys
}

function appendGroundFlatChunkBatchInstanceMatrices(
  batch: GroundFlatChunkBatchRuntime,
  chunkKeys: string[],
  matrices: Float32Array,
): void {
  if (chunkKeys.length === 0) {
    return
  }
  const nextKeys = [...batch.chunkKeys]
  const targetArray = batch.mesh.instanceMatrix.array as Float32Array
  const writeIndex = batch.chunkKeys.length
  copyGroundFlatChunkInstanceMatrixBuffer(targetArray, writeIndex, matrices, chunkKeys.length)
  nextKeys.push(...chunkKeys)
  batch.mesh.count = writeIndex + chunkKeys.length
  batch.mesh.instanceMatrix.needsUpdate = true
  markInstancedBoundsDirty(batch.mesh)
  batch.mesh.visible = batch.mesh.count > 0
  batch.mesh.userData.groundChunkBatch = {
    specKey: batch.specKey,
    chunkKeys: [...nextKeys],
  }
  batch.chunkKeys = nextKeys
}

function compactGroundFlatChunkBatchInstances(
  batch: GroundFlatChunkBatchRuntime,
  chunkKeys: string[],
): void {
  const targetArray = batch.mesh.instanceMatrix.array as Float32Array
  const nextKeys = [...batch.chunkKeys]
  const keepKeys = new Set(chunkKeys)

  // 删除时不再维持原始顺序：把最后一个实例交换到被删位置，再弹出尾部。
  // 对 InstancedMesh 来说，实例顺序本身没有渲染语义，这样可以把压缩从大量内存搬移降成 O(removedCount)。
  for (let readIndex = nextKeys.length - 1; readIndex >= 0; readIndex -= 1) {
    const key = nextKeys[readIndex]!
    if (keepKeys.has(key)) {
      continue
    }

    const lastIndex = nextKeys.length - 1
    if (readIndex !== lastIndex) {
      const lastKey = nextKeys[lastIndex]!
      const readOffset = readIndex * 16
      const lastOffset = lastIndex * 16
      for (let i = 0; i < 16; i += 1) {
        const temp = targetArray[readOffset + i]!
        targetArray[readOffset + i] = targetArray[lastOffset + i]!
        targetArray[lastOffset + i] = temp
      }
      nextKeys[readIndex] = lastKey
    }
    nextKeys.pop()
  }

  batch.mesh.count = nextKeys.length
  batch.mesh.instanceMatrix.needsUpdate = true
  markInstancedBoundsDirty(batch.mesh)
  batch.mesh.visible = nextKeys.length > 0
  batch.mesh.userData.groundChunkBatch = {
    specKey: batch.specKey,
    chunkKeys: [...nextKeys],
  }
  batch.chunkKeys = nextKeys
}

function scheduleGroundFlatChunkBatchInstanceBuild(
  root: THREE.Group,
  _state: GroundRuntimeState,
  batch: GroundFlatChunkBatchRuntime,
  definition: GroundRuntimeDynamicMesh,
): void {
  if (!groundFlatChunkInstanceMatrixBuilder || batch.asyncBuildInFlight || batch.pendingChunkKeys.size <= 0) {
    return
  }
  const pendingChunkKeys = Array.from(batch.pendingChunkKeys).slice(0, GROUND_FLAT_CHUNK_ASYNC_BUILD_BATCH_SIZE)
  const definitionSignature = definitionStructureSignature(definition)
  batch.asyncBuildInFlight = true
  const request = groundFlatChunkInstanceMatrixBuilder({
    definition,
    definitionSignature,
    chunkKeys: pendingChunkKeys,
  })
  if (!request) {
    batch.asyncBuildInFlight = false
    return
  }
  void request
    .then((result) => {
      const activeState = groundRuntimeStateMap.get(root)
      if (!activeState) {
        return
      }
      const activeBatch = activeState.flatChunkBatches.get(batch.specKey)
      if (!activeBatch || activeBatch !== batch) {
        return
      }
      let pendingChanged = false
      const acceptedKeys: string[] = []
      const acceptedMatrices = new Float32Array(result.chunkKeys.length * 16)
      let acceptedWriteIndex = 0
      const resolvedKeySet = new Set<string>()
      result.chunkKeys.forEach((key, index) => {
        resolvedKeySet.add(key)
        if (!activeBatch.pendingChunkKeys.has(key)) {
          return
        }
        activeBatch.pendingChunkKeys.delete(key)
        pendingChanged = true
        if (activeState.hiddenChunkKeys.has(key) || activeState.chunks.has(key)) {
          return
        }
        acceptedKeys.push(key)
        const sourceOffset = index * 16
        acceptedMatrices.set(result.matrices.subarray(sourceOffset, sourceOffset + 16), acceptedWriteIndex * 16)
        acceptedWriteIndex += 1
      })
      pendingChunkKeys.forEach((key) => {
        if (!resolvedKeySet.has(key) && activeBatch.pendingChunkKeys.delete(key)) {
          pendingChanged = true
        }
      })
      if (!acceptedKeys.length) {
        if (pendingChanged) {
          syncGroundFlatChunkKeyCache(activeState)
          markGroundVisibleChunkKeysDirty(activeState)
        }
        return
      }
      appendGroundFlatChunkBatchInstanceMatrices(
        activeBatch,
        acceptedKeys,
        acceptedWriteIndex === acceptedKeys.length && acceptedKeys.length === result.chunkKeys.length
          ? result.matrices
          : acceptedMatrices.subarray(0, acceptedWriteIndex * 16),
      )
      syncGroundFlatChunkKeyCache(activeState)
      markGroundVisibleChunkKeysDirty(activeState)
    })
    .catch(() => {
      /* noop */
    })
    .finally(() => {
      const activeState = groundRuntimeStateMap.get(root)
      if (!activeState) {
        return
      }
      const activeBatch = activeState?.flatChunkBatches.get(batch.specKey)
      if (!activeBatch || activeBatch !== batch) {
        return
      }
      batch.asyncBuildInFlight = false
      if (batch.pendingChunkKeys.size > 0) {
        scheduleGroundFlatChunkBatchInstanceBuild(root, activeState, batch, definition)
      }
    })
}

function appendGroundFlatChunkGroup(
  target: Map<string, { spec: GroundChunkSpec; keys: string[] }>,
  spec: GroundChunkSpec,
  key: string,
): void {
  const specKey = chunkPoolKey(spec)
  const entry = target.get(specKey)
  if (entry) {
    entry.keys.push(key)
    return
  }
  target.set(specKey, { spec, keys: [key] })
}

function collectGroundFlatChunkGroupsInRange(
  target: Map<string, { spec: GroundChunkSpec; keys: string[] }>,
  definition: GroundRuntimeDynamicMesh,
  state: GroundRuntimeState,
  range: {
    minChunkRow: number
    maxChunkRow: number
    minChunkColumn: number
    maxChunkColumn: number
  }
): void {
  if (range.minChunkRow > range.maxChunkRow || range.minChunkColumn > range.maxChunkColumn) {
    return
  }
  for (let cr = range.minChunkRow; cr <= range.maxChunkRow; cr += 1) {
    for (let cc = range.minChunkColumn; cc <= range.maxChunkColumn; cc += 1) {
      const key = groundChunkKey(cr, cc)
      if (state.chunks.has(key) || state.flatChunkKeys.has(key) || state.hiddenChunkKeys.has(key)) {
        continue
      }

      const spec = computeChunkSpec(definition, cr, cc)
      appendGroundFlatChunkGroup(target, spec, key)
    }
  }
}

function compareGroundFlatChunkKeyDistanceToCamera(
  left: string,
  right: string,
  cameraChunkCoord: { chunkX: number; chunkZ: number } | null,
): number {
  if (!cameraChunkCoord) {
    return 0
  }
  const leftIndex = resolveRuntimeChunkIndexFromRuntimeKey(left)
  const rightIndex = resolveRuntimeChunkIndexFromRuntimeKey(right)
  if (!leftIndex || !rightIndex) {
    return 0
  }
  const leftRowDelta = Math.abs(leftIndex.row - cameraChunkCoord.chunkZ)
  const leftColumnDelta = Math.abs(leftIndex.column - cameraChunkCoord.chunkX)
  const rightRowDelta = Math.abs(rightIndex.row - cameraChunkCoord.chunkZ)
  const rightColumnDelta = Math.abs(rightIndex.column - cameraChunkCoord.chunkX)
  const leftRingDistance = Math.max(leftRowDelta, leftColumnDelta)
  const rightRingDistance = Math.max(rightRowDelta, rightColumnDelta)
  if (leftRingDistance !== rightRingDistance) {
    return leftRingDistance - rightRingDistance
  }
  const leftManhattanDistance = leftRowDelta + leftColumnDelta
  const rightManhattanDistance = rightRowDelta + rightColumnDelta
  if (leftManhattanDistance !== rightManhattanDistance) {
    return leftManhattanDistance - rightManhattanDistance
  }
  if (leftIndex.row !== rightIndex.row) {
    return leftIndex.row - rightIndex.row
  }
  return leftIndex.column - rightIndex.column
}

function sortGroundFlatChunkKeysByCameraPriority(
  chunkKeys: string[],
  cameraChunkCoord: { chunkX: number; chunkZ: number } | null,
): string[] {
  if (!cameraChunkCoord || chunkKeys.length <= 1) {
    return chunkKeys
  }
  chunkKeys.sort((left, right) => compareGroundFlatChunkKeyDistanceToCamera(left, right, cameraChunkCoord))
  return chunkKeys
}

function isGroundFlatChunkKeyWithinChunkWindow(
  key: string,
  range: {
    minChunkRow: number
    maxChunkRow: number
    minChunkColumn: number
    maxChunkColumn: number
  },
): boolean {
  const indices = resolveRuntimeChunkIndexFromRuntimeKey(key)
  if (!indices) {
    return false
  }
  return indices.row >= range.minChunkRow
    && indices.row <= range.maxChunkRow
    && indices.column >= range.minChunkColumn
    && indices.column <= range.maxChunkColumn
}

function syncGroundFlatChunkBatches(
  root: THREE.Group,
  state: GroundRuntimeState,
  definition: GroundRuntimeDynamicMesh,
  desiredFlatChunkGroups: Map<string, { spec: GroundChunkSpec; keys: string[] }>,
  cameraChunkCoord: { chunkX: number; chunkZ: number } | null = null,
  releaseWindow: {
    minChunkRow: number
    maxChunkRow: number
    minChunkColumn: number
    maxChunkColumn: number
  } | null = null,
): void {
  // 这里只同步 flat chunk 批次，不碰雕刻 chunk 的独立 Mesh。
  // 这条分离非常关键：一旦 flat / sculpted 混在同一个集合里，后续释放、拾取、以及编辑后的降级/升级都会很难维护。
  // 这里的策略是“窗口只负责补充新出现的 flat chunk”，而不是把窗口外已经创建过的 flat chunk 再卸载掉。
  if (desiredFlatChunkGroups.size === 0 && state.flatChunkBatches.size === 0) {
    return
  }

  const material = resolveGroundRuntimeMaterial(root, state)
  const nextBatches = new Map<string, GroundFlatChunkBatchRuntime>(state.flatChunkBatches)
  const hiddenChunkKeysChanged = state.lastFlatChunkSyncHiddenChunkKeysVersion !== state.hiddenChunkKeysVersion
  const batchesNeedingAsyncBuild = new Set<GroundFlatChunkBatchRuntime>()
  const requiredChunkKeys = new Set<string>()
  let changed = false

  desiredFlatChunkGroups.forEach((group, specKey) => {
    group.keys.forEach((key) => {
      if (typeof key === 'string' && key.length > 0) {
        requiredChunkKeys.add(key)
      }
    })
    const existing = state.flatChunkBatches.get(specKey)
    if (existing) {
      existing.pendingChunkKeys = existing.pendingChunkKeys instanceof Set ? existing.pendingChunkKeys : new Set<string>()
      existing.asyncBuildInFlight = existing.asyncBuildInFlight === true
      const existingKeys = existing.chunkKeys
      const nextKeysToAppend: string[] = []
      group.keys.forEach((key) => {
        if (
          typeof key === 'string'
          && key.length > 0
          && !state.chunks.has(key)
          && !state.hiddenChunkKeys.has(key)
          && !existing.pendingChunkKeys.has(key)
        ) {
          nextKeysToAppend.push(key)
        }
      })
      sortGroundFlatChunkKeysByCameraPriority(nextKeysToAppend, cameraChunkCoord)
      const pendingKeyCountAfterAppend = existing.pendingChunkKeys.size + nextKeysToAppend.length
      const nextKeyCount = existingKeys.length + pendingKeyCountAfterAppend
      const capacityTargetCount = canBuildGroundFlatChunkInstancesAsync(definition)
        ? existingKeys.length + Math.min(pendingKeyCountAfterAppend, GROUND_FLAT_CHUNK_ASYNC_BUILD_BATCH_SIZE)
        : nextKeyCount
      const needsResize = capacityTargetCount > existing.instanceCapacity
      if (needsResize) {
        const nextCapacity = resolveGroundFlatChunkBatchCapacity(capacityTargetCount, existing.instanceCapacity)
        const geometry = buildFlatGroundChunkGeometry(group.spec, Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1)
        const resizedMesh = new THREE.InstancedMesh(geometry, material, nextCapacity)
        resizedMesh.name = existing.mesh.name
        resizedMesh.receiveShadow = existing.mesh.receiveShadow
        resizedMesh.castShadow = existing.mesh.castShadow
        resizedMesh.frustumCulled = false
        resizedMesh.count = existing.mesh.count
        resizedMesh.userData.dynamicMeshType = 'Ground'
        resizedMesh.userData.groundChunkBatch = {
          specKey,
          chunkKeys: [...existingKeys],
        }
        copyGroundFlatChunkInstanceMatrices(existing.mesh, resizedMesh, existingKeys.length)
        existing.mesh.removeFromParent()
        try {
          ;(existing.mesh.geometry as any)?.dispose?.()
        } catch (_error) {
          /* noop */
        }
        existing.mesh = resizedMesh
        existing.instanceCapacity = nextCapacity
        root.add(resizedMesh)
        changed = true
      }
      if (!(existing.instanceHeightCache instanceof Map)) {
        existing.instanceHeightCache = new Map<string, number>()
      }
      existing.spec = group.spec
      if (nextKeysToAppend.length > 0) {
        // 同规格批次直接复用，不重新创建 geometry。
        // 这里会把新进入视野的 flat chunk 追加进缓存，但不会把已经加载的旧 chunk 因为相机移动而删掉。
        if (canBuildGroundFlatChunkInstancesAsync(definition)) {
          existing.pendingChunkKeys = new Set<string>([
            ...nextKeysToAppend,
            ...Array.from(existing.pendingChunkKeys),
          ])
          batchesNeedingAsyncBuild.add(existing)
        } else {
          appendGroundFlatChunkBatchInstances(existing, definition, nextKeysToAppend)
        }
        changed = true
      }
      nextBatches.set(specKey, existing)
      return
    }

    // 只有首次出现的规格才新建 geometry + InstancedMesh。
    // 这意味着绝大多数 chunk 进入缓存后，后续只是换矩阵，不再重复分配大块几何资源。
    const prioritizedGroupKeys = sortGroundFlatChunkKeysByCameraPriority([...group.keys], cameraChunkCoord)
    const geometry = buildFlatGroundChunkGeometry(group.spec, Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1)
    const initialInstanceTargetCount = canBuildGroundFlatChunkInstancesAsync(definition)
      ? Math.min(prioritizedGroupKeys.length, GROUND_FLAT_CHUNK_ASYNC_BUILD_BATCH_SIZE)
      : prioritizedGroupKeys.length
    const instanceCapacity = resolveGroundFlatChunkBatchCapacity(initialInstanceTargetCount)
    const mesh = new THREE.InstancedMesh(geometry, material, instanceCapacity)
    mesh.name = `GroundFlatChunks:${specKey}`
    mesh.receiveShadow = true
    mesh.castShadow = state.castShadow
    mesh.frustumCulled = false
    mesh.count = 0
    mesh.visible = false
    mesh.userData.dynamicMeshType = 'Ground'
    mesh.userData.groundChunkBatch = {
      specKey,
      chunkKeys: [],
    }

    const batch: GroundFlatChunkBatchRuntime = {
      specKey,
      spec: group.spec,
      mesh,
      chunkKeys: [],
      pendingChunkKeys: new Set<string>(),
      instanceCapacity,
      instanceHeightCache: new Map<string, number>(),
      asyncBuildInFlight: false,
    }
    if (canBuildGroundFlatChunkInstancesAsync(definition)) {
      batch.pendingChunkKeys = new Set<string>(prioritizedGroupKeys)
      batchesNeedingAsyncBuild.add(batch)
    } else {
      refreshGroundFlatChunkBatchInstances(batch, definition, prioritizedGroupKeys)
    }
    root.add(mesh)
    nextBatches.set(specKey, batch)
    changed = true
  })

  // nextBatches.forEach((batch, specKey) => {
  //   const nextKeys = batch.chunkKeys.filter((key) => {
  //     if (state.chunks.has(key) || state.hiddenChunkKeys.has(key)) {
  //       return false
  //     }
  //     return requiredChunkKeys.has(key)
  //   })
  //   const nextPendingKeys = Array.from(batch.pendingChunkKeys).filter((key) => {
  //     if (state.chunks.has(key) || state.hiddenChunkKeys.has(key)) {
  //       return false
  //     }
  //     return requiredChunkKeys.has(key)
  //   })
  //   if (nextKeys.length === batch.chunkKeys.length && nextPendingKeys.length === batch.pendingChunkKeys.size) {
  //     return
  //   }
  //   batch.pendingChunkKeys = new Set<string>(nextPendingKeys)
  //   if (nextKeys.length !== batch.chunkKeys.length) {
  //     compactGroundFlatChunkBatchInstances(batch, nextKeys)
  //   }
  //   if (!nextKeys.length && nextPendingKeys.length === 0) {
  //     batch.mesh.removeFromParent()
  //     try {
  //       ;(batch.mesh.geometry as any)?.dispose?.()
  //     } catch (_error) {
  //       /* noop */
  //     }
  //     nextBatches.delete(specKey)
  //   }
  //   changed = true
  // })

  if (hiddenChunkKeysChanged) {
    nextBatches.forEach((batch, specKey) => {
      if (!(batch.instanceHeightCache instanceof Map)) {
        batch.instanceHeightCache = new Map<string, number>()
      }
      const nextKeys = batch.chunkKeys.filter((key) => !state.chunks.has(key) && !state.hiddenChunkKeys.has(key))
      const nextPendingKeys = Array.from(batch.pendingChunkKeys).filter((key) => !state.chunks.has(key) && !state.hiddenChunkKeys.has(key))
      if (!nextKeys.length && nextPendingKeys.length === 0) {
        batch.mesh.removeFromParent()
        try {
          ;(batch.mesh.geometry as any)?.dispose?.()
        } catch (_error) {
          /* noop */
        }
        nextBatches.delete(specKey)
        changed = true
        return
      }
      if (nextKeys.length !== batch.chunkKeys.length) {
        refreshGroundFlatChunkBatchInstances(batch, definition, nextKeys)
        changed = true
      }
      if (nextPendingKeys.length !== batch.pendingChunkKeys.size) {
        batch.pendingChunkKeys = new Set<string>(nextPendingKeys)
        changed = true
      }
    })
  }
  if (releaseWindow) {
    nextBatches.forEach((batch, specKey) => {
      const nextKeys = batch.chunkKeys.filter((key) => {
        if (state.chunks.has(key) || state.hiddenChunkKeys.has(key)) {
          return false
        }
        return isGroundFlatChunkKeyWithinChunkWindow(key, releaseWindow)
      })
      const nextPendingKeys = Array.from(batch.pendingChunkKeys).filter((key) => {
        if (state.chunks.has(key) || state.hiddenChunkKeys.has(key)) {
          return false
        }
        return isGroundFlatChunkKeyWithinChunkWindow(key, releaseWindow)
      })
      if (nextKeys.length === batch.chunkKeys.length && nextPendingKeys.length === batch.pendingChunkKeys.size) {
        return
      }
      const nextLoadedKeySet = new Set<string>(nextKeys)
      const nextPendingKeySet = new Set<string>(nextPendingKeys)
      const removedLoadedKeys = batch.chunkKeys.filter((key) => !nextLoadedKeySet.has(key))
      const removedPendingKeys = Array.from(batch.pendingChunkKeys).filter((key) => !nextPendingKeySet.has(key))
      batch.pendingChunkKeys = new Set<string>(nextPendingKeys)
      if (nextKeys.length !== batch.chunkKeys.length) {
        compactGroundFlatChunkBatchInstances(batch, nextKeys)
      }
      if (!nextKeys.length && nextPendingKeys.length === 0) {
        batch.mesh.removeFromParent()
        try {
          ;(batch.mesh.geometry as any)?.dispose?.()
        } catch (_error) {
          /* noop */
        }
        nextBatches.delete(specKey)
      }
      removedLoadedKeys.forEach((key) => {
        batch.instanceHeightCache.delete(key)
      })
      removedPendingKeys.forEach((key) => {
        batch.instanceHeightCache.delete(key)
      })
      changed = true
    })
  }
  state.flatChunkBatches = nextBatches
  if (changed) {
    syncGroundFlatChunkKeyCache(state)
    markGroundVisibleChunkKeysDirty(state)
  }
  if (batchesNeedingAsyncBuild.size > 0) {
    batchesNeedingAsyncBuild.forEach((batch) => {
      scheduleGroundFlatChunkBatchInstanceBuild(root, state, batch, definition)
    })
  }
}

function releaseChunkToPool(state: GroundRuntimeState, runtime: GroundChunkRuntime): void {
  const geometry = runtime.mesh.geometry
  if (!(geometry instanceof THREE.BufferGeometry)) {
    disposeChunk(runtime)
    return
  }

  const key = chunkPoolKey(runtime.spec)
  const bucket = state.meshPool.get(key) ?? []
  if (bucket.length >= Math.max(0, Math.trunc(state.poolMaxPerSize))) {
    disposeChunk(runtime)
    return
  }

  const parent = runtime.mesh.parent
  runtime.mesh.removeFromParent()
  runtime.mesh.visible = false
  bucket.push(runtime.mesh)
  state.meshPool.set(key, bucket)
  if (parent && (parent as THREE.Object3D).isObject3D) {
    markGroundTextureTraversalCacheDirty(parent as THREE.Object3D)
  }
}

function disposeChunk(runtime: GroundChunkRuntime): void {
  const parent = runtime.mesh.parent
  try {
    runtime.mesh.geometry?.dispose?.()
  } catch (_error) {
    /* noop */
  }
  const material = Array.isArray(runtime.mesh.material) ? (runtime.mesh.material[0] ?? null) : (runtime.mesh.material ?? null)
  if (material) {
    disposeGroundChunkTexturedMaterial(material)
  }
  delete runtime.mesh.userData.groundChunkTextureReady
  runtime.mesh.removeFromParent()
  if (parent && (parent as THREE.Object3D).isObject3D) {
    markGroundTextureTraversalCacheDirty(parent as THREE.Object3D)
  }
}

const sculptNoise = createPerlinNoise(911)

type GroundChunkBudget = {
  maxCreatePerUpdate?: number
  maxDestroyPerUpdate?: number
  maxMs?: number
}

export function applyGroundGeneration(
  definition: GroundRuntimeDynamicMesh,
  settings: GroundGenerationSettings,
): GroundGenerationSettings {
  const normalized = normalizeGroundGenerationSettings(settings)
  definition.generation = normalized
  // Generation is evaluated on demand; keep explicit edits as sparse absolute overrides.
  const gridSize = resolveGroundWorkingGridSize(definition)
  definition.terrainHeightMap = createGroundHeightMap(gridSize.rows, gridSize.columns)
  return normalized
}

export interface SculptParams {
  point: THREE.Vector3
  radius: number
  strength: number
  shape: 'circle' | 'polygon'
  operation: GroundSculptOperation
  targetHeight?: number
  polygonPoints?: THREE.Vector3[]
  depth?: number
  slope?: number
}

type SculptPolygonPoint = {
  x: number
  z: number
}

type SmoothedSculptPolygonOptions = {
  cellSize?: number
  cornerSmoothing?: number
}

const SCULPT_POLYGON_EPSILON = 1e-6
const SCULPT_POLYGON_CORNER_COS_STRAIGHT_THRESHOLD = Math.cos((5 * Math.PI) / 180)
const SCULPT_POLYGON_CORNER_COS_UTURN_THRESHOLD = Math.cos((170 * Math.PI) / 180)
const SCULPT_POLYGON_DEFAULT_CORNER_SMOOTHING = 0.2

function getSculptPolygonPointDistanceSqXZ(a: SculptPolygonPoint, b: SculptPolygonPoint): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return dx * dx + dz * dz
}

function clampSculptPolygonUnit(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.max(0, Math.min(1, numeric))
}

function sanitizeSculptPolygonContourPoints(points: THREE.Vector3[]): THREE.Vector3[] {
  if (!Array.isArray(points) || points.length < 3) {
    return []
  }
  const normalized: THREE.Vector3[] = []
  const epsilonSq = SCULPT_POLYGON_EPSILON * SCULPT_POLYGON_EPSILON
  for (const point of points) {
    if (!(point instanceof THREE.Vector3) || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
      continue
    }
    const candidate = point.clone()
    const previous = normalized[normalized.length - 1]
    if (previous) {
      const dx = candidate.x - previous.x
      const dz = candidate.z - previous.z
      if ((dx * dx) + (dz * dz) <= epsilonSq) {
        continue
      }
    }
    normalized.push(candidate)
  }
  if (normalized.length >= 2) {
    const first = normalized[0]
    const last = normalized[normalized.length - 1]
    if (first && last) {
      const dx = first.x - last.x
      const dz = first.z - last.z
      if ((dx * dx) + (dz * dz) <= epsilonSq) {
        normalized.pop()
      }
    }
  }
  return normalized.length >= 3 ? normalized : []
}

function computeSculptPolygonSegmentLengthXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(b.x - a.x, b.z - a.z)
}

function computeSmoothedSculptPolygonCornerCutDistance(params: {
  smoothing: number
  inLength: number
  outLength: number
  cosTheta: number
  cellSize: number
}): number {
  const smoothing = clampSculptPolygonUnit(params.smoothing, 0)
  if (smoothing <= 0) {
    return 0
  }
  const minLength = Math.min(params.inLength, params.outLength)
  if (!(minLength > SCULPT_POLYGON_EPSILON)) {
    return 0
  }
  if (params.cosTheta >= SCULPT_POLYGON_CORNER_COS_STRAIGHT_THRESHOLD) {
    return 0
  }

  let maxRatio = 0.45
  if (params.cosTheta <= SCULPT_POLYGON_CORNER_COS_UTURN_THRESHOLD) {
    maxRatio = Math.min(maxRatio, 0.25)
  }

  const cellSize = Math.max(0, params.cellSize)
  const requested = Math.max(Math.min(cellSize * 0.25, 0.75), smoothing * minLength)
  const maxAllowed = maxRatio * minLength
  const cut = Math.min(requested, maxAllowed)
  return cut > SCULPT_POLYGON_EPSILON ? cut : 0
}

function sampleSculptPolygonQuadraticBezierPoint(
  start: THREE.Vector3,
  control: THREE.Vector3,
  end: THREE.Vector3,
  t: number,
): THREE.Vector3 {
  const oneMinusT = 1 - t
  const startWeight = oneMinusT * oneMinusT
  const controlWeight = 2 * oneMinusT * t
  const endWeight = t * t
  return new THREE.Vector3(
    (start.x * startWeight) + (control.x * controlWeight) + (end.x * endWeight),
    (start.y * startWeight) + (control.y * controlWeight) + (end.y * endWeight),
    (start.z * startWeight) + (control.z * controlWeight) + (end.z * endWeight),
  )
}

function appendSculptPolygonContourPoint(target: THREE.Vector3[], point: THREE.Vector3): void {
  const previous = target[target.length - 1]
  if (previous) {
    const dx = previous.x - point.x
    const dz = previous.z - point.z
    if ((dx * dx) + (dz * dz) <= SCULPT_POLYGON_EPSILON * SCULPT_POLYGON_EPSILON) {
      return
    }
  }
  target.push(point)
}

export function buildSmoothedSculptPolygonContour(
  points: THREE.Vector3[],
  options: SmoothedSculptPolygonOptions = {},
): THREE.Vector3[] {
  const sanitizedPoints = sanitizeSculptPolygonContourPoints(points)
  if (sanitizedPoints.length < 3) {
    return sanitizedPoints.map((point) => point.clone())
  }

  const cellSize = Math.max(0, Number(options.cellSize) || 0)
  const smoothing = clampSculptPolygonUnit(options.cornerSmoothing, SCULPT_POLYGON_DEFAULT_CORNER_SMOOTHING)
  if (smoothing <= 0) {
    return sanitizedPoints.map((point) => point.clone())
  }

  type CornerInfo = {
    vertex: THREE.Vector3
    enter: THREE.Vector3
    exit: THREE.Vector3
    rounded: boolean
    curveSegments: number
  }

  const cornerInfos: CornerInfo[] = sanitizedPoints.map((vertex, index) => {
    const previous = sanitizedPoints[(index - 1 + sanitizedPoints.length) % sanitizedPoints.length]!
    const next = sanitizedPoints[(index + 1) % sanitizedPoints.length]!
    const inLength = computeSculptPolygonSegmentLengthXZ(previous, vertex)
    const outLength = computeSculptPolygonSegmentLengthXZ(vertex, next)
    if (!(inLength > SCULPT_POLYGON_EPSILON) || !(outLength > SCULPT_POLYGON_EPSILON)) {
      return {
        vertex: vertex.clone(),
        enter: vertex.clone(),
        exit: vertex.clone(),
        rounded: false,
        curveSegments: 0,
      }
    }

    const inDirection = new THREE.Vector2(vertex.x - previous.x, vertex.z - previous.z)
    const outDirection = new THREE.Vector2(next.x - vertex.x, next.z - vertex.z)
    const cosTheta = THREE.MathUtils.clamp(inDirection.dot(outDirection) / (inLength * outLength), -1, 1)
    const cut = computeSmoothedSculptPolygonCornerCutDistance({
      smoothing,
      inLength,
      outLength,
      cosTheta,
      cellSize,
    })
    if (!(cut > SCULPT_POLYGON_EPSILON)) {
      return {
        vertex: vertex.clone(),
        enter: vertex.clone(),
        exit: vertex.clone(),
        rounded: false,
        curveSegments: 0,
      }
    }

    const enterT = THREE.MathUtils.clamp(cut / inLength, 0, 0.49)
    const exitT = THREE.MathUtils.clamp(cut / outLength, 0, 0.49)
    const enter = vertex.clone().lerp(previous, enterT)
    const exit = vertex.clone().lerp(next, exitT)
    const approxCurveLength = enter.distanceTo(vertex) + vertex.distanceTo(exit)
    const segmentTarget = Math.max(0.25, Math.min(cellSize * 0.25, 0.75))
    const curveSegments = Math.max(3, Math.min(12, Math.ceil(approxCurveLength / segmentTarget)))

    return {
      vertex: vertex.clone(),
      enter,
      exit,
      rounded: true,
      curveSegments,
    }
  })

  const contour: THREE.Vector3[] = []
  appendSculptPolygonContourPoint(contour, cornerInfos[0]!.enter.clone())
  for (let index = 0; index < cornerInfos.length; index += 1) {
    const current = cornerInfos[index]!
    const next = cornerInfos[(index + 1) % cornerInfos.length]!
    if (current.rounded) {
      for (let segment = 1; segment <= current.curveSegments; segment += 1) {
        const t = segment / current.curveSegments
        appendSculptPolygonContourPoint(
          contour,
          sampleSculptPolygonQuadraticBezierPoint(current.enter, current.vertex, current.exit, t),
        )
      }
    } else {
      appendSculptPolygonContourPoint(contour, current.vertex.clone())
    }
    appendSculptPolygonContourPoint(contour, next.enter.clone())
  }

  if (contour.length >= 2) {
    const first = contour[0]
    const last = contour[contour.length - 1]
    if (first && last) {
      const dx = first.x - last.x
      const dz = first.z - last.z
      if ((dx * dx) + (dz * dz) <= SCULPT_POLYGON_EPSILON * SCULPT_POLYGON_EPSILON) {
        contour.pop()
      }
    }
  }

  return contour.length >= 3 ? contour : sanitizedPoints.map((point) => point.clone())
}

function normalizeSculptPolygonPointsXZ(points: THREE.Vector3[]): SculptPolygonPoint[] {
  if (points.length < 3) {
    return []
  }
  const normalized: SculptPolygonPoint[] = []
  const epsilonSq = SCULPT_POLYGON_EPSILON * SCULPT_POLYGON_EPSILON
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) {
      continue
    }
    const candidate = { x: point.x, z: point.z }
    const previous = normalized[normalized.length - 1]
    if (previous && getSculptPolygonPointDistanceSqXZ(previous, candidate) <= epsilonSq) {
      continue
    }
    normalized.push(candidate)
  }
  if (normalized.length >= 2) {
    const first = normalized[0]
    const last = normalized[normalized.length - 1]
    if (first && last && getSculptPolygonPointDistanceSqXZ(first, last) <= epsilonSq) {
      normalized.pop()
    }
  }
  return normalized.length >= 3 ? normalized : []
}

function isPointOnSculptPolygonSegmentXZ(point: SculptPolygonPoint, a: SculptPolygonPoint, b: SculptPolygonPoint): boolean {
  const epsilon = SCULPT_POLYGON_EPSILON
  const abx = b.x - a.x
  const abz = b.z - a.z
  const apx = point.x - a.x
  const apz = point.z - a.z
  const cross = apx * abz - apz * abx
  if (Math.abs(cross) > epsilon) {
    return false
  }
  const dot = apx * abx + apz * abz
  if (dot < -epsilon) {
    return false
  }
  const lengthSq = abx * abx + abz * abz
  if (dot - lengthSq > epsilon) {
    return false
  }
  return true
}

function isPointInsideSculptPolygonXZ(point: SculptPolygonPoint, polygonPoints: SculptPolygonPoint[]): boolean {
  if (polygonPoints.length < 3) {
    return false
  }
  let inside = false
  for (let index = 0, previousIndex = polygonPoints.length - 1; index < polygonPoints.length; previousIndex = index, index += 1) {
    const a = polygonPoints[index]
    const b = polygonPoints[previousIndex]
    if (!a || !b) {
      continue
    }
    if (isPointOnSculptPolygonSegmentXZ(point, a, b)) {
      return true
    }
    const intersects = ((a.z > point.z) !== (b.z > point.z))
      && (point.x < (((b.x - a.x) * (point.z - a.z)) / ((b.z - a.z) || Number.EPSILON)) + a.x)
    if (intersects) {
      inside = !inside
    }
  }
  return inside
}

function distancePointToSculptSegmentXZ(point: SculptPolygonPoint, a: SculptPolygonPoint, b: SculptPolygonPoint): number {
  const abx = b.x - a.x
  const abz = b.z - a.z
  const lengthSq = abx * abx + abz * abz
  if (lengthSq <= SCULPT_POLYGON_EPSILON * SCULPT_POLYGON_EPSILON) {
    return Math.hypot(point.x - a.x, point.z - a.z)
  }
  const t = Math.min(1, Math.max(0, (((point.x - a.x) * abx) + ((point.z - a.z) * abz)) / lengthSq))
  const closestX = a.x + abx * t
  const closestZ = a.z + abz * t
  return Math.hypot(point.x - closestX, point.z - closestZ)
}

function computeSculptPolygonBoundaryDistance(point: SculptPolygonPoint, polygonPoints: SculptPolygonPoint[]): number {
  let minDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < polygonPoints.length; index += 1) {
    const a = polygonPoints[index]
    const b = polygonPoints[(index + 1) % polygonPoints.length]
    if (!a || !b) {
      continue
    }
    minDistance = Math.min(minDistance, distancePointToSculptSegmentXZ(point, a, b))
  }
  return Number.isFinite(minDistance) ? minDistance : 0
}

function computeSculptPolygonBounds(polygonPoints: SculptPolygonPoint[]): {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
} {
  return polygonPoints.reduce(
    (bounds, polygonPoint) => ({
      minX: Math.min(bounds.minX, polygonPoint.x),
      maxX: Math.max(bounds.maxX, polygonPoint.x),
      minZ: Math.min(bounds.minZ, polygonPoint.z),
      maxZ: Math.max(bounds.maxZ, polygonPoint.z),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY,
    },
  )
}

function smoothstepScalar(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) {
    return value >= edge1 ? 1 : 0
  }
  let t = (value - edge0) / (edge1 - edge0)
  t = Math.max(0, Math.min(1, t))
  return t * t * (3 - (2 * t))
}

function computePolygonRaiseDepressRampWidth(maxBoundaryDistance: number, depth: number, slope: number): number {
  if (!(maxBoundaryDistance > 1e-6) || !(depth > 0)) {
    return 0
  }
  const clampedSlope = Math.max(0, Number.isFinite(slope) ? slope : 0.5)
  const requestedBand = depth * (0.75 + clampedSlope)
  return Math.max(1e-6, Math.min(maxBoundaryDistance, requestedBand))
}

function computePolygonRaiseDepressProfile(distanceToBoundary: number, rampWidth: number): number {
  if (!(distanceToBoundary > 1e-6) || !(rampWidth > 1e-6)) {
    return 0
  }
  return smoothstepScalar(0, rampWidth, distanceToBoundary)
}

export function sculptGround(definition: GroundRuntimeDynamicMesh, params: SculptParams): boolean {
  const { point, radius, strength, shape, operation, targetHeight, polygonPoints, depth, slope } = params
  const cellSize = definition.cellSize
  const gridSize = resolveGroundWorkingGridSize(definition)
  const columns = gridSize.columns
  const rows = gridSize.rows
  const bounds = resolveGroundGridWorldBounds(definition)

  // 采样点使用本地坐标
  const localX = point.x
  const localZ = point.z

  // 多边形模式下先复制并归一化轮廓点，避免直接修改输入参数
  const sculptPolygonContour = shape === 'polygon'
    ? (polygonPoints ?? []).map((polygonPoint) => polygonPoint.clone())
    : []
  const normalizedPolygon = shape === 'polygon' ? normalizeSculptPolygonPointsXZ(sculptPolygonContour) : []
  if (shape === 'polygon' && normalizedPolygon.length < 3) {
    return false
  }

  // 计算雕刻影响范围的边界盒
  const polygonBounds = computeSculptPolygonBounds(normalizedPolygon)

  const minCol = shape === 'polygon'
    ? Math.floor((polygonBounds.minX - bounds.minX) / cellSize)
    : Math.floor((localX - radius - bounds.minX) / cellSize)
  const maxCol = shape === 'polygon'
    ? Math.ceil((polygonBounds.maxX - bounds.minX) / cellSize)
    : Math.ceil((localX + radius - bounds.minX) / cellSize)
  const minRow = shape === 'polygon'
    ? Math.floor((polygonBounds.minZ - bounds.minZ) / cellSize)
    : Math.floor((localZ - radius - bounds.minZ) / cellSize)
  const maxRow = shape === 'polygon'
    ? Math.ceil((polygonBounds.maxZ - bounds.minZ) / cellSize)
    : Math.ceil((localZ + radius - bounds.minZ) / cellSize)

  let modified = false
  let heightMap = definition.terrainHeightMap

  if (shape === 'polygon') {
    // 多边形抬升/下压优先尝试子采样路径，提高大面积编辑效率
    if (operation === 'raise' || operation === 'depress') {
      const subsampled = applyPolygonRaiseDepressSubsampled(definition, polygonBounds, normalizedPolygon, {
        operation,
        strength,
        depth,
        slope,
      })
      if (subsampled) {
        definition.terrainHeightMap = heightMap
        return true
      }
    }

    // 多边形平滑与填平也优先走子采样逻辑
    if ((operation === 'smooth' || operation === 'flatten' || operation === 'flatten-zero') && applyPolygonSurfaceSubsampled(definition, polygonBounds, normalizedPolygon, {
      operation,
      strength,
      targetHeight,
    })) {
      definition.terrainHeightMap = heightMap
      return true
    }

    const polygonCandidates: Array<{
      row: number
      col: number
      boundaryDistance: number
      currentHeight: number
    }> = []
    let maxBoundaryDistance = 0

    // 收集多边形内部的候选顶点，并统计最大边界距离
    for (let row = Math.max(0, minRow); row <= Math.min(rows, maxRow); row++) {
      for (let col = Math.max(0, minCol); col <= Math.min(columns, maxCol); col++) {
        const x = bounds.minX + col * cellSize
        const z = bounds.minZ + row * cellSize
        const samplePoint = { x, z }
        if (!isPointInsideSculptPolygonXZ(samplePoint, normalizedPolygon)) {
          continue
        }
        const boundaryDistance = computeSculptPolygonBoundaryDistance(samplePoint, normalizedPolygon)
        maxBoundaryDistance = Math.max(maxBoundaryDistance, boundaryDistance)
        polygonCandidates.push({
          row,
          col,
          boundaryDistance,
          currentHeight: resolveGroundEffectiveHeightAtVertex(definition, row, col),
        })
      }
    }

    if (!polygonCandidates.length) {
      return false
    }

    const effectiveDepth = Number.isFinite(depth) ? Math.max(0, depth ?? 0) : 0
    const effectiveSlope = Number.isFinite(slope) ? slope ?? 0.5 : 0.5
    const rampWidth = computePolygonRaiseDepressRampWidth(maxBoundaryDistance, effectiveDepth, effectiveSlope)

    // 按操作类型计算新的顶点高度
    for (const candidate of polygonCandidates) {
      const { row, col, boundaryDistance, currentHeight } = candidate
      let nextHeight = currentHeight

      if (operation === 'smooth') {
        const average = sampleNeighborAverage(definition, row, col, rows, columns)
        const smoothingFactor = Math.min(1, strength * 0.25)
        nextHeight = currentHeight + (average - currentHeight) * smoothingFactor
      } else if (operation === 'flatten') {
        const reference = targetHeight ?? currentHeight
        const flattenFactor = Math.min(1, strength * 0.4)
        nextHeight = currentHeight + (reference - currentHeight) * flattenFactor
      } else if (operation === 'flatten-zero') {
        const reference = targetHeight ?? 0
        const flattenFactor = Math.min(1, 0.2 + strength * 0.3)
        nextHeight = currentHeight + (reference - currentHeight) * flattenFactor
      } else {
        const direction = operation === 'depress' ? -1 : 1
        if (effectiveDepth > 0) {
          const profile = computePolygonRaiseDepressProfile(boundaryDistance, rampWidth)
          nextHeight = currentHeight + direction * effectiveDepth * profile
        } else {
          nextHeight = currentHeight + direction * strength * 0.3
        }
      }

      setGroundCoverageHeightOverrideForEffectiveValue(definition, bounds.minX + col * cellSize, bounds.minZ + row * cellSize, nextHeight)
      modified = true
    }

    if (modified) {
      definition.terrainHeightMap = heightMap
    }
    return modified
  }

  if ((operation === 'raise' || operation === 'depress') && applyCircularRaiseDepressSubsampled(definition, {
    point,
    radius,
    strength,
    operation,
  })) {
    definition.terrainHeightMap = heightMap
    return true
  }

  if ((operation === 'smooth' || operation === 'flatten' || operation === 'flatten-zero') && applyCircularSurfaceSubsampled(definition, {
    point,
    radius,
    strength,
    operation,
    targetHeight,
  })) {
    definition.terrainHeightMap = heightMap
    return true
  }

  // 圆形模式下逐网格遍历影响范围内的顶点
  for (let row = Math.max(0, minRow); row <= Math.min(rows, maxRow); row++) {
    for (let col = Math.max(0, minCol); col <= Math.min(columns, maxCol); col++) {
      const x = bounds.minX + col * cellSize
      const z = bounds.minZ + row * cellSize

      // 超出半径范围的点不受影响
      const dx = x - localX
      const dz = z - localZ
      const distSq = dx * dx + dz * dz
      if (distSq >= radius * radius) {
        continue
      }

      // 根据距离计算影响权重，并叠加噪声让边缘更自然
      const dist = Math.sqrt(distSq)
      let influence = Math.cos((dist / radius) * (Math.PI / 2))
      const noiseVal = sculptNoise(x * 0.05, z * 0.05, 0)
      influence *= 1.0 + noiseVal * 0.1

      const currentHeight = resolveGroundEffectiveHeightAtVertex(definition, row, col)
      let nextHeight = currentHeight

      if (operation === 'smooth') {
        const average = sampleNeighborAverage(definition, row, col, rows, columns)
        const smoothingFactor = Math.min(1, strength * 0.25)
        nextHeight = currentHeight + (average - currentHeight) * smoothingFactor * influence
      } else if (operation === 'flatten') {
        const reference = targetHeight ?? currentHeight
        const flattenFactor = Math.min(1, strength * 0.4)
        nextHeight = currentHeight + (reference - currentHeight) * flattenFactor * influence
      } else if (operation === 'flatten-zero') {
        const reference = targetHeight ?? 0
        const flattenFactor = Math.min(1, 0.2 + strength * 0.3)
        nextHeight = currentHeight + (reference - currentHeight) * flattenFactor * influence
      } else {
        const direction = operation === 'depress' ? -1 : 1
        const offset = direction * strength * influence * 0.3
        nextHeight = currentHeight + offset
      }

      setGroundCoverageHeightOverrideForEffectiveValue(definition, x, z, nextHeight)
      modified = true
    }
  }
  if (operation === 'flatten-zero') {
    // flatten-zero 额外处理外围过渡带，减少边缘突变
    const smoothingBand = Math.max(cellSize * 1.5, radius * 0.35)
    if (smoothingBand > 0) {
      const bandRows = Math.ceil(smoothingBand / cellSize)
      const smoothingRadius = radius + smoothingBand
      const smoothingStrengthBase = Math.min(1, 0.2 + strength * 0.15)
      const smoothingMinRow = Math.max(0, minRow - bandRows)
      const smoothingMaxRow = Math.min(rows, maxRow + bandRows)
      const smoothingMinCol = Math.max(0, minCol - bandRows)
      const smoothingMaxCol = Math.min(columns, maxCol + bandRows)
      for (let row = smoothingMinRow; row <= smoothingMaxRow; row++) {
        for (let col = smoothingMinCol; col <= smoothingMaxCol; col++) {
          const x = bounds.minX + col * cellSize
          const z = bounds.minZ + row * cellSize
          const dx = x - localX
          const dz = z - localZ
          const dist = Math.sqrt(dx * dx + dz * dz)
          // 只处理外圈过渡带
          if (dist <= radius || dist > smoothingRadius) {
            continue
          }
          const taper = 1 - (dist - radius) / smoothingBand
          const smoothingFactor = smoothingStrengthBase * taper
          if (smoothingFactor <= 0) {
            continue
          }
          const currentHeight = resolveGroundEffectiveHeightAtVertex(definition, row, col)
          const average = sampleNeighborAverage(definition, row, col, rows, columns)
          const smoothedHeight = currentHeight + (average - currentHeight) * smoothingFactor
          setGroundCoverageHeightOverrideForEffectiveValue(definition, x, z, smoothedHeight)
          modified = true
        }
      }
    }
  }
  if (modified) {
    definition.terrainHeightMap = heightMap
  }
  return modified
}

export function updateGroundGeometry(geometry: THREE.BufferGeometry, definition: GroundRuntimeDynamicMesh): boolean {
  const gridSize = resolveGroundWorkingGridSize(definition)
  const columns = gridSize.columns
  const rows = gridSize.rows
  const vertexColumns = columns + 1
  const vertexRows = rows + 1
  const expectedVertexCount = vertexColumns * vertexRows

  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
  const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined

  if (!positionAttr || positionAttr.count !== expectedVertexCount || !normalAttr || normalAttr.count !== expectedVertexCount || !uvAttr || uvAttr.count !== expectedVertexCount) {
    return false
  }

  const bounds = resolveGroundWorldBounds(definition)
  const cellSize = definition.cellSize
  const heightRegion = sampleGroundEffectiveHeightRegion(definition, 0, rows, 0, columns)
  const heightValues = heightRegion.values
  const heightStride = heightRegion.stride

  let vertexIndex = 0
  for (let row = 0; row <= rows; row += 1) {
    const z = bounds.minZ + row * cellSize
    const heightOffset = row * heightStride
    for (let column = 0; column <= columns; column += 1) {
      const x = bounds.minX + column * cellSize
      const height = heightValues[heightOffset + column] ?? 0

      positionAttr.setXYZ(vertexIndex, x, height, z)
      uvAttr.setXY(vertexIndex, columns === 0 ? 0 : column / columns, rows === 0 ? 0 : 1 - row / rows)
      vertexIndex += 1
    }
  }

  positionAttr.needsUpdate = true
  computeHeightfieldNormals(positionAttr.array as Float32Array, normalAttr.array as Float32Array, rows, columns, cellSize, cellSize)
  normalAttr.needsUpdate = true
  uvAttr.needsUpdate = true
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return true
}

type GroundTextureMetadata = {
  groundDynamic?: boolean
  groundTextureCacheKey?: string | null
}
type GroundRuntimeMaterialMetadata = {
  groundChunkTextured?: boolean
  groundTextureSource?: string | null
  groundTextureSignature?: string | null
  groundSplatShader?: boolean
  groundMaterialCacheKey?: string | null
}

type GroundTextureCacheEntry = {
  key: string
  texture: THREE.Texture
  refCount: number
  ready: boolean
  failed: boolean
  readyListeners: Set<() => void>
}

type GroundMaterialCacheEntry = {
  key: string
  material: THREE.Material
  refCount: number
  ready: boolean
  textureKeys: string[]
  readyListeners: Set<() => void>
}

type GroundChunkRuntimeSurfaceLayer = {
  albedoSource: string | null
  albedoTextureSettings: SceneMaterialTextureSettings | null
  normalSource: string | null
  normalTextureSettings: SceneMaterialTextureSettings | null
  colorTint: string | null
  opacity: number
  uvScale: { x: number; y: number } | null
  maskChannel: number
  featherEnabled: boolean
  featherWidth: number
}

type GroundChunkTextureRuntimeState = {
  chunkBounds: { minX: number; minZ: number; width: number; depth: number }
  layerTextures: Array<THREE.Texture | null>
  layerNormalTextures: Array<THREE.Texture | null>
  layerStates: GroundChunkRuntimeSurfaceLayer[]
  splatMaps: THREE.Texture[]
}

export type GroundSplatRuntimeProfile = {
  maxLayers?: number | null
  enableLayerNormalMap?: boolean | null
}

const GROUND_SPLAT_SHADER_HOOK_INSTALLED = '__groundSplatShaderHookInstalled'
const GROUND_SPLAT_SHADER_REF = '__groundSplatShaderRef'
const GROUND_SPLAT_ORIGINAL_ON_BEFORE_COMPILE = '__groundSplatOriginalOnBeforeCompile'
const GROUND_SPLAT_ORIGINAL_PROGRAM_CACHE_KEY = '__groundSplatOriginalProgramCacheKey'
const GROUND_SPLAT_RUNTIME_STATE = '__groundSplatRuntimeState'
const GROUND_SPLAT_LAYER_TEXTURES = '__groundSplatLayerTextures'
const GROUND_SPLAT_LAYER_NORMAL_TEXTURES = '__groundSplatLayerNormalTextures'
const GROUND_SPLAT_MASK_TEXTURES = '__groundSplatMaskTextures'
const GROUND_SPLAT_MAX_LAYERS = 4
const groundTextureCache = new Map<string, GroundTextureCacheEntry>()
const groundMaterialCache = new Map<string, GroundMaterialCacheEntry>()
// Keep the first shader version conservative so it stays under common WebGL fragment sampler limits
// after accounting for base ground maps, environment lighting, and shadow samplers.
const GROUND_SPLAT_SHADER_MAX_LAYERS = 4
function isDynamicGroundTexture(texture: THREE.Texture | null | undefined): boolean {
  if (!texture) {
    return false
  }
  const userData = texture.userData as GroundTextureMetadata | undefined
  return Boolean(userData?.groundDynamic)
}

function markDynamicGroundTexture(texture: THREE.Texture): void {
  const userData = (texture.userData ??= {}) as GroundTextureMetadata
  userData.groundDynamic = true
}

function resolveGroundTextureCacheKey(
  source: string,
  options: {
    flipY?: boolean
    textureSettingsKey?: string | null
  } = {},
): string {
  return [
    source.trim(),
    options.flipY === false ? 'flip:0' : 'flip:1',
    options.textureSettingsKey?.trim() || 'settings:none',
  ].join('|')
}

function isGroundTextureReady(texture: THREE.Texture | null | undefined): boolean {
  if (!texture) {
    return true
  }
  const cacheKey = (texture.userData as GroundTextureMetadata | undefined)?.groundTextureCacheKey
  if (!cacheKey) {
    const image = (texture as THREE.Texture & { image?: { complete?: boolean } }).image
    return image ? image.complete !== false : true
  }
  const entry = groundTextureCache.get(cacheKey)
  return entry ? entry.ready && !entry.failed : true
}

function trackGroundTextureReady(texture: THREE.Texture | null | undefined, listener: () => void): void {
  if (!texture) {
    listener()
    return
  }
  const cacheKey = (texture.userData as GroundTextureMetadata | undefined)?.groundTextureCacheKey
  if (!cacheKey) {
    listener()
    return
  }
  const entry = groundTextureCache.get(cacheKey)
  if (!entry || entry.ready || entry.failed) {
    listener()
    return
  }
  entry.readyListeners.add(listener)
}

function retainGroundTextureCacheEntry(entry: GroundTextureCacheEntry): void {
  entry.refCount += 1
}

function releaseGroundTexture(texture: THREE.Texture | null | undefined): void {
  if (!texture) {
    return
  }
  const cacheKey = (texture.userData as GroundTextureMetadata | undefined)?.groundTextureCacheKey
  if (!cacheKey) {
    if (isDynamicGroundTexture(texture)) {
      disposeGroundTexture(texture)
    }
    return
  }
  const entry = groundTextureCache.get(cacheKey)
  if (!entry) {
    if (isDynamicGroundTexture(texture)) {
      disposeGroundTexture(texture)
    }
    return
  }
  entry.refCount = Math.max(0, entry.refCount - 1)
}

function retainGroundChunkTexturedMaterial(material: THREE.Material | null | undefined): void {
  if (!material) {
    return
  }
  const cacheKey = (material.userData as GroundRuntimeMaterialMetadata | undefined)?.groundMaterialCacheKey
  if (!cacheKey) {
    return
  }
  const entry = groundMaterialCache.get(cacheKey)
  if (entry) {
    entry.refCount += 1
  }
}

function subscribeGroundMaterialReady(material: THREE.Material | null | undefined, listener: () => void): void {
  if (!material) {
    listener()
    return
  }
  const cacheKey = (material.userData as GroundRuntimeMaterialMetadata | undefined)?.groundMaterialCacheKey
  if (!cacheKey) {
    listener()
    return
  }
  const entry = groundMaterialCache.get(cacheKey)
  if (!entry || entry.ready) {
    listener()
    return
  }
  entry.readyListeners.add(listener)
}

function finalizeGroundMaterialCacheEntry(entry: GroundMaterialCacheEntry): void {
  if (entry.ready) {
    return
  }
  const allReady = entry.textureKeys.every((key) => {
    const textureEntry = groundTextureCache.get(key)
    return !textureEntry || textureEntry.ready || textureEntry.failed
  })
  if (!allReady) {
    return
  }
  entry.ready = true
  entry.readyListeners.forEach((listener) => listener())
  entry.readyListeners.clear()
}

function createGroundMaterialCacheEntry(
  key: string,
  material: THREE.Material,
  textures: Array<THREE.Texture | null | undefined>,
): GroundMaterialCacheEntry {
  const textureKeys = textures
    .map((texture) => (texture?.userData as GroundTextureMetadata | undefined)?.groundTextureCacheKey ?? null)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
  const entry: GroundMaterialCacheEntry = {
    key,
    material,
    refCount: 1,
    ready: textureKeys.every((textureKey) => {
      const textureEntry = groundTextureCache.get(textureKey)
      return !textureEntry || textureEntry.ready || textureEntry.failed
    }),
    textureKeys,
    readyListeners: new Set(),
  }
  textureKeys.forEach((textureKey) => {
    const textureEntry = groundTextureCache.get(textureKey)
    if (!textureEntry || textureEntry.ready || textureEntry.failed) {
      return
    }
    textureEntry.readyListeners.add(() => finalizeGroundMaterialCacheEntry(entry))
  })
  const userData = (material.userData ??= {}) as GroundRuntimeMaterialMetadata
  userData.groundMaterialCacheKey = key
  groundMaterialCache.set(key, entry)
  finalizeGroundMaterialCacheEntry(entry)
  return entry
}

function setGroundChunkTextureReady(mesh: THREE.Mesh, ready: boolean): void {
  mesh.userData.groundChunkTextureReady = ready
}

function syncGroundChunkTextureReadyFromMaterial(mesh: THREE.Mesh, material: THREE.Material | null | undefined): void {
  if (!material || !isGroundChunkTexturedMaterial(material)) {
    setGroundChunkTextureReady(mesh, true)
    return
  }
  const cacheKey = (material.userData as GroundRuntimeMaterialMetadata | undefined)?.groundMaterialCacheKey
  if (!cacheKey) {
    const typed = material as THREE.MeshStandardMaterial & Record<string, unknown>
    const textures: Array<THREE.Texture | null | undefined> = [
      typed.map ?? null,
      typed.normalMap ?? null,
      ...(Array.isArray(typed[GROUND_SPLAT_LAYER_TEXTURES]) ? typed[GROUND_SPLAT_LAYER_TEXTURES] as Array<THREE.Texture | null> : []),
      ...(Array.isArray(typed[GROUND_SPLAT_LAYER_NORMAL_TEXTURES]) ? typed[GROUND_SPLAT_LAYER_NORMAL_TEXTURES] as Array<THREE.Texture | null> : []),
      ...(Array.isArray(typed[GROUND_SPLAT_MASK_TEXTURES]) ? typed[GROUND_SPLAT_MASK_TEXTURES] as Array<THREE.Texture | null> : []),
    ]
    const ready = textures.every((texture) => isGroundTextureReady(texture))
    setGroundChunkTextureReady(mesh, ready)
    if (!ready) {
      textures.forEach((texture) => {
        if (!texture || isGroundTextureReady(texture)) {
          return
        }
        trackGroundTextureReady(texture, () => {
          if (mesh.material === material) {
            syncGroundChunkTextureReadyFromMaterial(mesh, material)
          }
        })
      })
    }
    return
  }
  const entry = groundMaterialCache.get(cacheKey)
  const ready = entry ? entry.ready : true
  setGroundChunkTextureReady(mesh, ready)
  if (!ready) {
    subscribeGroundMaterialReady(material, () => {
      if (mesh.material === material) {
        syncGroundChunkTextureReadyFromMaterial(mesh, material)
      }
    })
  }
}

export function isGroundChunkTextureReady(mesh: THREE.Mesh | null | undefined): boolean {
  if (!mesh) {
    return true
  }
  return mesh.userData?.groundChunkTextureReady !== false
}

export function onGroundChunkTextureReady(mesh: THREE.Mesh | null | undefined, listener: () => void): void {
  if (!mesh) {
    listener()
    return
  }
  if (isGroundChunkTextureReady(mesh)) {
    listener()
    return
  }
  const material = Array.isArray(mesh.material) ? (mesh.material[0] ?? null) : (mesh.material ?? null)
  syncGroundChunkTextureReadyFromMaterial(mesh, material)
  if (isGroundChunkTextureReady(mesh)) {
    listener()
    return
  }
  subscribeGroundMaterialReady(material, () => {
    if (mesh.material === material && isGroundChunkTextureReady(mesh)) {
      listener()
    }
  })
}

function clearDynamicGroundFlag(texture: THREE.Texture | null | undefined): void {
  if (!texture) {
    return
  }
  const userData = texture.userData as GroundTextureMetadata | undefined
  if (userData && 'groundDynamic' in userData) {
    delete userData.groundDynamic
  }
}

function disposeGroundTexture(texture: THREE.Texture | null | undefined) {
  if (!texture) {
    return
  }
  texture.dispose()
  clearDynamicGroundFlag(texture)
}

function loadGroundTextureFromSource(
  source: string | null | undefined,
  textureName: string,
  options: { flipY?: boolean; textureSettingsKey?: string | null } = {},
): THREE.Texture | null {
  const normalizedSource = typeof source === 'string' ? source.trim() : ''
  if (!normalizedSource) {
    return null
  }
  const cacheKey = resolveGroundTextureCacheKey(normalizedSource, options)
  const cached = groundTextureCache.get(cacheKey)
  if (cached) {
    retainGroundTextureCacheEntry(cached)
    cached.texture.name = textureName
    return cached.texture
  }
  const texture = textureLoader.load(
    normalizedSource,
    () => {
      const entry = groundTextureCache.get(cacheKey)
      if (!entry) {
        return
      }
      entry.ready = true
      entry.failed = false
      entry.readyListeners.forEach((listener) => listener())
      entry.readyListeners.clear()
    },
    undefined,
    () => {
      const entry = groundTextureCache.get(cacheKey)
      if (!entry) {
        return
      }
      entry.failed = true
      entry.ready = true
      entry.readyListeners.forEach((listener) => listener())
      entry.readyListeners.clear()
    },
  )
  applyGroundTextureSamplingDefaults(texture)
  if (typeof options.flipY === 'boolean') {
    texture.flipY = options.flipY
  }
  texture.name = textureName
  markDynamicGroundTexture(texture)
  const userData = (texture.userData ??= {}) as GroundTextureMetadata
  userData.groundTextureCacheKey = cacheKey
  groundTextureCache.set(cacheKey, {
    key: cacheKey,
    texture,
    refCount: 1,
    ready: false,
    failed: false,
    readyListeners: new Set(),
  })
  return texture
}

function isGroundChunkTexturedMaterial(material: THREE.Material | null | undefined): boolean {
  if (!material) {
    return false
  }
  const userData = material.userData as GroundRuntimeMaterialMetadata | undefined
  return Boolean(userData?.groundChunkTextured)
}

function markGroundChunkTexturedMaterial(material: THREE.Material, signature: string, source: string | null): void {
  const userData = (material.userData ??= {}) as GroundRuntimeMaterialMetadata
  userData.groundChunkTextured = true
  userData.groundTextureSignature = signature
  userData.groundTextureSource = source
  userData.groundSplatShader = signature.includes('ground-splat-v1')
}

function markGroundTextureTraversalCacheDirty(target: THREE.Object3D): void {
  const userData = (target.userData ??= {}) as Record<string, unknown>
  const currentVersion = Number.isFinite(userData.groundTextureTraversalCacheVersion as number)
    ? Math.max(0, Math.trunc(userData.groundTextureTraversalCacheVersion as number))
    : 0
  userData.groundTextureTraversalCacheVersion = currentVersion + 1
  delete userData.groundTextureTraversalCache
  delete userData.groundTextureTraversalAppliedSignature
}

function getGroundTextureTraversalCache(root: THREE.Object3D): GroundTextureTraversalCache {
  const userData = (root.userData ??= {}) as Record<string, unknown>
  const version = Number.isFinite(userData.groundTextureTraversalCacheVersion as number)
    ? Math.max(0, Math.trunc(userData.groundTextureTraversalCacheVersion as number))
    : 0
  const cached = userData.groundTextureTraversalCache as GroundTextureTraversalCache | undefined
  if (cached && cached.version === version) {
    return cached
  }

  const meshes: THREE.Mesh[] = []
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    if (mesh.userData?.groundChunkBatch) {
      return
    }
    if (mesh.userData?.compiledGroundTile) {
      meshes.push(mesh)
    }
  })

  const nextCache: GroundTextureTraversalCache = {
    version,
    meshes,
  }
  userData.groundTextureTraversalCache = nextCache
  return nextCache
}

function clearGroundRuntimeMaterialMetadata(material: THREE.Material): void {
  const userData = material.userData as GroundRuntimeMaterialMetadata | undefined
  if (!userData) {
    return
  }
  delete userData.groundChunkTextured
  delete userData.groundTextureSignature
  delete userData.groundTextureSource
  delete userData.groundSplatShader
  delete userData.groundMaterialCacheKey
}

function applyGroundTextureSamplingDefaults(texture: THREE.Texture): void {
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = Math.min(16, texture.anisotropy || 8)
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.colorSpace = THREE.SRGBColorSpace
}

function resolveGroundTextureWrapMode(mode: string | null | undefined): THREE.Wrapping {
  switch (mode) {
    case 'MirroredRepeatWrapping':
      return THREE.MirroredRepeatWrapping
    case 'ClampToEdgeWrapping':
      return THREE.ClampToEdgeWrapping
    case 'RepeatWrapping':
    default:
      return THREE.RepeatWrapping
  }
}

function applyGroundLayerTextureSettings(
  texture: THREE.Texture,
  settings: SceneMaterialTextureSettings | null | undefined,
): void {
  const resolved = createTextureSettings(settings ?? null)
  texture.wrapS = resolveGroundTextureWrapMode(resolved.wrapS)
  texture.wrapT = resolveGroundTextureWrapMode(resolved.wrapT)
  texture.flipY = resolved.flipY
  texture.generateMipmaps = resolved.generateMipmaps
  texture.premultiplyAlpha = resolved.premultiplyAlpha
  texture.needsUpdate = true
}

function createGroundSplatLayerTexture(
  source: string | null | undefined,
  index: number,
  settings: SceneMaterialTextureSettings | null | undefined,
): THREE.Texture | null {
  const texture = loadGroundTextureFromSource(source, `GroundSplatLayer${index + 1}`, {
    flipY: settings?.flipY,
    textureSettingsKey: stableSerialize(createTextureSettings(settings ?? null)),
  })
  if (!texture) {
    return null
  }
  applyGroundLayerTextureSettings(texture, settings)
  return texture
}

function summarizeGroundMeshUvBounds(mesh: THREE.Mesh): {
  minU: number
  maxU: number
  minV: number
  maxV: number
} | null {
  const geometry = mesh.geometry
  if (!(geometry instanceof THREE.BufferGeometry)) {
    return null
  }
  const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!uvAttr || uvAttr.count <= 0 || uvAttr.itemSize < 2) {
    return null
  }
  let minU = Number.POSITIVE_INFINITY
  let maxU = Number.NEGATIVE_INFINITY
  let minV = Number.POSITIVE_INFINITY
  let maxV = Number.NEGATIVE_INFINITY
  for (let index = 0; index < uvAttr.count; index += 1) {
    const u = uvAttr.getX(index)
    const v = uvAttr.getY(index)
    if (u < minU) minU = u
    if (u > maxU) maxU = u
    if (v < minV) minV = v
    if (v > maxV) maxV = v
  }
  if (!Number.isFinite(minU) || !Number.isFinite(maxU) || !Number.isFinite(minV) || !Number.isFinite(maxV)) {
    return null
  }
  return {
    minU: Number(minU.toFixed(6)),
    maxU: Number(maxU.toFixed(6)),
    minV: Number(minV.toFixed(6)),
    maxV: Number(maxV.toFixed(6)),
  }
}

function isGroundChunkLocalUvBounds(
  uvBounds: {
    minU: number
    maxU: number
    minV: number
    maxV: number
  } | null,
): boolean {
  if (!uvBounds) {
    return false
  }
  const epsilon = 1e-3
  return Math.abs(uvBounds.minU - 0) <= epsilon
    && Math.abs(uvBounds.maxU - 1) <= epsilon
    && Math.abs(uvBounds.minV - 0) <= epsilon
    && Math.abs(uvBounds.maxV - 1) <= epsilon
}

function resolveGroundChunkTextureWindowFromMeshBounds(
  definition: GroundDynamicMesh,
  mesh: THREE.Mesh,
): {
  offsetX: number
  offsetY: number
  repeatX: number
  repeatY: number
} | null {
  const geometry = mesh.geometry
  if (!(geometry instanceof THREE.BufferGeometry)) {
    return null
  }
  if (!geometry.boundingBox) {
    geometry.computeBoundingBox()
  }
  const bounds = geometry.boundingBox
  if (!bounds) {
    return null
  }
  const groundBounds = resolveGroundWorldBounds(definition)
  const groundWidth = Math.max(groundBounds.maxX - groundBounds.minX, Number.EPSILON)
  const groundDepth = Math.max(groundBounds.maxZ - groundBounds.minZ, Number.EPSILON)
  const minU = clampInclusive((bounds.min.x - groundBounds.minX) / groundWidth, 0, 1)
  const maxU = clampInclusive((bounds.max.x - groundBounds.minX) / groundWidth, 0, 1)
  const minZRatio = clampInclusive((bounds.min.z - groundBounds.minZ) / groundDepth, 0, 1)
  const maxZRatio = clampInclusive((bounds.max.z - groundBounds.minZ) / groundDepth, 0, 1)
  const spanX = Math.max(maxU - minU, Number.EPSILON)
  const spanY = Math.max(maxZRatio - minZRatio, Number.EPSILON)
  const repeatX = 1 / spanX
  const repeatY = 1 / spanY
  return {
    offsetX: -minU * repeatX,
    offsetY: -(1 - maxZRatio) * repeatY,
    repeatX,
    repeatY,
  }
}

function resolveGroundChunkTextureWindow(
  definition: GroundDynamicMesh,
  spec: Pick<GroundChunkSpec, 'startRow' | 'startColumn' | 'rows' | 'columns'>,
): {
  offsetX: number
  offsetY: number
  repeatX: number
  repeatY: number
} {
  const chunkBounds = resolveGroundChunkWorldBoundsFromSpec(definition, spec)
  const bounds = resolveGroundWorldBounds(definition)
  const groundWidth = Math.max(bounds.maxX - bounds.minX, Number.EPSILON)
  const groundDepth = Math.max(bounds.maxZ - bounds.minZ, Number.EPSILON)
  const minU = clampInclusive((chunkBounds.minX - bounds.minX) / groundWidth, 0, 1)
  const maxU = clampInclusive((chunkBounds.maxX - bounds.minX) / groundWidth, 0, 1)
  const minZRatio = clampInclusive((chunkBounds.minZ - bounds.minZ) / groundDepth, 0, 1)
  const maxZRatio = clampInclusive((chunkBounds.maxZ - bounds.minZ) / groundDepth, 0, 1)
  const spanX = Math.max(maxU - minU, Number.EPSILON)
  const spanY = Math.max(maxZRatio - minZRatio, Number.EPSILON)
  const repeatX = 1 / spanX
  const repeatY = 1 / spanY
  return {
    offsetX: -minU * repeatX,
    offsetY: -(1 - maxZRatio) * repeatY,
    repeatX,
    repeatY,
  }
}

function resolveGroundBaseMaterialSignature(baseMaterial: THREE.Material): string {
  const baseStandard = baseMaterial as THREE.MeshStandardMaterial & {
    metalness?: number
    roughness?: number
    flatShading?: boolean
    envMapIntensity?: number
  }
  return [
    baseMaterial.type,
    baseMaterial.uuid,
    baseMaterial.name,
    baseMaterial.side,
    baseMaterial.depthTest === false ? 0 : 1,
    baseStandard.envMap ? baseStandard.envMap.uuid : 'noenvmap',
    baseStandard.map ? baseStandard.map.uuid : 'nomap',
    baseStandard.normalMap ? baseStandard.normalMap.uuid : 'nonormalmap',
    baseStandard.alphaMap ? baseStandard.alphaMap.uuid : 'noalphamap',
    (baseMaterial as THREE.Material & { fog?: boolean }).fog === false ? 0 : 1,
    (baseMaterial as THREE.Material & { toneMapped?: boolean }).toneMapped === false ? 0 : 1,
    typeof baseStandard.roughness === 'number' ? Number(baseStandard.roughness.toFixed(6)) : 'na',
    typeof baseStandard.metalness === 'number' ? Number(baseStandard.metalness.toFixed(6)) : 'na',
    baseStandard.flatShading === true ? 1 : 0,
    typeof baseStandard.envMapIntensity === 'number' ? Number(baseStandard.envMapIntensity.toFixed(6)) : 'na',
  ].join('|')
}

function resolveGroundTextureWindowSignature(window: {
  offsetX: number
  offsetY: number
  repeatX: number
  repeatY: number
}): string {
  return [
    Number(window.offsetX.toFixed(6)),
    Number(window.offsetY.toFixed(6)),
    Number(window.repeatX.toFixed(6)),
    Number(window.repeatY.toFixed(6)),
  ].join('|')
}

function disposeGroundChunkTexturedMaterial(material: THREE.Material | null | undefined): void {
  if (!material || !isGroundChunkTexturedMaterial(material)) {
    return
  }
  const cacheKey = (material.userData as GroundRuntimeMaterialMetadata | undefined)?.groundMaterialCacheKey
  if (cacheKey) {
    const cached = groundMaterialCache.get(cacheKey)
    if (cached) {
      cached.refCount = Math.max(0, cached.refCount - 1)
      return
    }
  }
  const typed = material as unknown as Record<string, unknown>
  ;[
    'map',
    'normalMap',
  ].forEach((key) => {
    const texture = typed[key] as THREE.Texture | null | undefined
    releaseGroundTexture(texture)
    typed[key] = null
  })
  const layerTextures = Array.isArray(typed[GROUND_SPLAT_LAYER_TEXTURES])
    ? typed[GROUND_SPLAT_LAYER_TEXTURES] as Array<THREE.Texture | null>
    : []
  layerTextures.forEach((texture) => {
    releaseGroundTexture(texture)
  })
  const layerNormalTextures = Array.isArray(typed[GROUND_SPLAT_LAYER_NORMAL_TEXTURES])
    ? typed[GROUND_SPLAT_LAYER_NORMAL_TEXTURES] as Array<THREE.Texture | null>
    : []
  layerNormalTextures.forEach((texture) => {
    releaseGroundTexture(texture)
  })
  const maskTextures = Array.isArray(typed[GROUND_SPLAT_MASK_TEXTURES])
    ? typed[GROUND_SPLAT_MASK_TEXTURES] as Array<THREE.Texture | null>
    : []
  maskTextures.forEach((texture) => {
    releaseGroundTexture(texture)
  })
  clearGroundSplatMaterialUniforms(material)
  delete typed[GROUND_SPLAT_LAYER_TEXTURES]
  delete typed[GROUND_SPLAT_LAYER_NORMAL_TEXTURES]
  delete typed[GROUND_SPLAT_MASK_TEXTURES]
  delete typed[GROUND_SPLAT_RUNTIME_STATE]
  clearGroundRuntimeMaterialMetadata(material)
  material.dispose()
}

type GroundChunkTextureBundleSources = {
  baseBlendMode: 'shader-splat-v1' | null
  albedo: string | null
  normal: string | null
  splatMaps: string[]
  surfaceLayers: GroundChunkRuntimeSurfaceLayer[]
  revision: number
}

function normalizeGroundChunkRuntimeSurfaceLayer(
  layer: GroundSurfaceChunkLayerRef | null | undefined,
  fallbackTexture: string | null,
  fallbackTint: string | null,
  fallbackUvScale: { x: number; y: number } | null,
  index: number,
): GroundChunkRuntimeSurfaceLayer {
  const opacity = Number(layer?.opacity)
  const featherWidth = Number(layer?.featherWidth)
  const uvScaleX = Number(layer?.uvScale?.x)
  const uvScaleY = Number(layer?.uvScale?.y)
  return {
    albedoSource: typeof layer?.albedoSource === 'string' && layer.albedoSource.trim().length > 0
      ? layer.albedoSource.trim()
      : fallbackTexture,
    albedoTextureSettings: layer?.albedoTextureSettings ? createTextureSettings(layer.albedoTextureSettings) : null,
    normalSource: typeof layer?.normalSource === 'string' && layer.normalSource.trim().length > 0
      ? layer.normalSource.trim()
      : null,
    normalTextureSettings: layer?.normalTextureSettings ? createTextureSettings(layer.normalTextureSettings) : null,
    colorTint: typeof layer?.colorTint === 'string' && layer.colorTint.trim().length > 0
      ? layer.colorTint.trim()
      : fallbackTint,
    opacity: Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1,
    uvScale: Number.isFinite(uvScaleX) && uvScaleX > 0 && Number.isFinite(uvScaleY) && uvScaleY > 0
      ? { x: uvScaleX, y: uvScaleY }
      : fallbackUvScale,
    maskChannel: Number.isInteger(layer?.maskChannel) && Number(layer?.maskChannel) >= 0 && Number(layer?.maskChannel) < GROUND_SPLAT_MAX_LAYERS
      ? Number(layer?.maskChannel)
      : index,
    featherEnabled: typeof layer?.featherEnabled === 'boolean' ? layer.featherEnabled : false,
    featherWidth: Number.isFinite(featherWidth) ? Math.max(0, featherWidth) : 0,
  }
}

function resolveCompiledGroundTileChunkKey(
  rootUserData: Record<string, unknown>,
  definition: GroundDynamicMesh,
  compiledGroundTileKey: string | null | undefined,
  mesh: THREE.Mesh | null = null,
): string | null {
  const normalizedTileKey = typeof compiledGroundTileKey === 'string' ? compiledGroundTileKey.trim() : ''
  const compiledGroundManifest = rootUserData.compiledGroundManifest as CompiledGroundManifest | null | undefined
  const safeChunkSizeMeters = Number.isFinite(definition.chunkSizeMeters) && Number(definition.chunkSizeMeters) > 0
    ? Number(definition.chunkSizeMeters)
    : compiledGroundManifest && Number.isFinite(compiledGroundManifest.chunkSizeMeters) && Number(compiledGroundManifest.chunkSizeMeters) > 0
      ? Number(compiledGroundManifest.chunkSizeMeters)
      : 1
  if (compiledGroundManifest && Array.isArray(compiledGroundManifest.renderTiles) && normalizedTileKey) {
    const record = compiledGroundManifest.renderTiles.find((entry) => entry?.key === normalizedTileKey) ?? null
    if (record) {
      const coord = resolveGroundChunkCoordFromWorldPosition(
        Number(record.centerX) || 0,
        Number(record.centerZ) || 0,
        safeChunkSizeMeters,
      )
      return `${coord.chunkX}:${coord.chunkZ}`
    }
  }
  if (!mesh) {
    return null
  }
  mesh.geometry?.computeBoundingBox?.()
  const boundingBox = mesh.geometry?.boundingBox ?? null
  if (!boundingBox) {
    return null
  }
  const center = boundingBox.getCenter(new THREE.Vector3())
  const worldCenter = mesh.localToWorld(center)
  const coord = resolveGroundChunkCoordFromWorldPosition(
    Number(worldCenter.x) || 0,
    Number(worldCenter.z) || 0,
    safeChunkSizeMeters,
  )
  return `${coord.chunkX}:${coord.chunkZ}`
}

function resolveGroundChunkTextureBundleSources(
  definition: GroundDynamicMesh,
  chunkKey: string | null,
): GroundChunkTextureBundleSources | null {
  const tileMaterialMap = resolveGroundTileMaterialMap(definition)
  if (!chunkKey || !tileMaterialMap) {
    return null
  }
  const entry = tileMaterialMap[chunkKey] ?? null
  if (!entry) {
    return null
  }
  const albedo = typeof entry.textureAssetId === 'string' ? entry.textureAssetId.trim() : ''
  const normal = typeof entry.normalTextureAssetId === 'string' ? entry.normalTextureAssetId.trim() : ''
  const splatMaps = Array.isArray(entry.splatMapAssetIds)
    ? entry.splatMapAssetIds
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0)
    : []
  const directSurfaceLayers = Array.isArray(entry.surfaceLayers) ? entry.surfaceLayers : []
  const surfaceLayers = Array.from({ length: Math.min(GROUND_SPLAT_MAX_LAYERS, directSurfaceLayers.length) }, (_, index) => {
    return normalizeGroundChunkRuntimeSurfaceLayer(
      directSurfaceLayers[index] ?? null,
      null,
      null,
      null,
      index,
    )
  }).filter((layer) => Boolean(layer.albedoSource) || Boolean(layer.normalSource) || Boolean(layer.colorTint))
  return {
    baseBlendMode: entry.baseBlendMode === 'shader-splat-v1' ? 'shader-splat-v1' : null,
    albedo: albedo || null,
    normal: normal || null,
    splatMaps,
    surfaceLayers,
    revision: Number.isFinite(entry.revision) ? Math.max(0, Math.trunc(entry.revision)) : 0,
  }
}

function loadGroundChunkSplatMaps(sources: string[], chunkKey: string): THREE.Texture[] {
  void chunkKey
  if (!Array.isArray(sources) || sources.length === 0) {
    return []
  }
  const textures = sources
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0)
    .map((value, index) => {
      const texture = loadGroundTextureFromSource(value, `GroundChunkSplatMap${index + 1}`, { flipY: false })
      if (texture) {
        texture.colorSpace = THREE.NoColorSpace
      }
      return texture
    })
    .filter((texture): texture is THREE.Texture => Boolean(texture))
  if (textures.length > 1) {
    textures.length = 1
  }
  return textures.slice(0, 1)
}

function normalizeGroundSplatRuntimeProfile(
  profile: GroundSplatRuntimeProfile | null | undefined,
): { maxLayers: number; enableLayerNormalMap: boolean } {
  const maxLayers = Number(profile?.maxLayers)
  return {
    maxLayers: Number.isFinite(maxLayers)
      ? Math.max(0, Math.min(GROUND_SPLAT_SHADER_MAX_LAYERS, Math.trunc(maxLayers)))
      : GROUND_SPLAT_SHADER_MAX_LAYERS,
    enableLayerNormalMap: profile?.enableLayerNormalMap === true,
  }
}

function createGroundSplatSignature(
  chunkKey: string,
  baseMaterialSignature: string,
  bundle: GroundChunkTextureBundleSources,
  profile?: GroundSplatRuntimeProfile | null,
): string {
  const runtimeProfile = normalizeGroundSplatRuntimeProfile(profile)
  return [
    'ground-splat-v1',
    chunkKey,
    baseMaterialSignature,
    `layers:${runtimeProfile.maxLayers}`,
    `normals:${runtimeProfile.enableLayerNormalMap ? 1 : 0}`,
    bundle.splatMaps.slice(0, 1).join('|'),
    hashString(stableSerialize({
      baseBlendMode: bundle.baseBlendMode,
      surfaceLayers: bundle.surfaceLayers.slice(0, runtimeProfile.maxLayers).map((layer) => ({
        albedoSource: layer.albedoSource,
        albedoTextureSettings: layer.albedoTextureSettings,
        normalSource: layer.normalSource,
        normalTextureSettings: layer.normalTextureSettings,
        colorTint: layer.colorTint,
        opacity: layer.opacity,
        uvScale: layer.uvScale,
        maskChannel: layer.maskChannel,
        featherEnabled: layer.featherEnabled,
        featherWidth: layer.featherWidth,
      })),
    })),
  ].join('|')
}

function buildGroundSplatChunkBounds(
  definition: GroundDynamicMesh,
  spec: Pick<GroundChunkSpec, 'startRow' | 'startColumn' | 'rows' | 'columns'> | null,
  mesh: THREE.Mesh,
): { minX: number; minZ: number; width: number; depth: number } | null {
  if (spec) {
    const bounds = resolveGroundChunkWorldBoundsFromSpec(definition, spec as GroundChunkSpec)
    return {
      minX: bounds.minX,
      minZ: bounds.minZ,
      width: Math.max(bounds.maxX - bounds.minX, Number.EPSILON),
      depth: Math.max(bounds.maxZ - bounds.minZ, Number.EPSILON),
    }
  }
  mesh.geometry?.computeBoundingBox?.()
  const boundingBox = mesh.geometry?.boundingBox ?? null
  if (!boundingBox) {
    return null
  }
  const min = mesh.localToWorld(boundingBox.min.clone())
  const max = mesh.localToWorld(boundingBox.max.clone())
  return {
    minX: Math.min(min.x, max.x),
    minZ: Math.min(min.z, max.z),
    width: Math.max(Math.abs(max.x - min.x), Number.EPSILON),
    depth: Math.max(Math.abs(max.z - min.z), Number.EPSILON),
  }
}

function createGroundSplatLayerTransform(
  layer: GroundChunkRuntimeSurfaceLayer,
): {
  uvScale: THREE.Vector2
  transform: THREE.Vector4
  rotation: THREE.Vector4
} {
  const settings = createTextureSettings(layer.albedoTextureSettings ?? null)
  const uvScale = {
    x: Number.isFinite(layer.uvScale?.x) && Number(layer.uvScale?.x) > 1e-6 ? Number(layer.uvScale?.x) : 1,
    y: Number.isFinite(layer.uvScale?.y) && Number(layer.uvScale?.y) > 1e-6 ? Number(layer.uvScale?.y) : 1,
  }
  const tileScaleX = Number.isFinite(settings.tileSizeMeters.x) && settings.tileSizeMeters.x > 1e-6 ? settings.tileSizeMeters.x : 1
  const tileScaleY = Number.isFinite(settings.tileSizeMeters.y) && settings.tileSizeMeters.y > 1e-6 ? settings.tileSizeMeters.y : 1
  const repeatX = Number.isFinite(settings.repeat.x) ? settings.repeat.x : 1
  const repeatY = Number.isFinite(settings.repeat.y) ? settings.repeat.y : 1
  return {
    uvScale: new THREE.Vector2(uvScale.x, uvScale.y),
    transform: new THREE.Vector4(
      repeatX / (uvScale.x * tileScaleX),
      repeatY / (uvScale.y * tileScaleY),
      Number.isFinite(settings.offset.x) ? settings.offset.x : 0,
      Number.isFinite(settings.offset.y) ? settings.offset.y : 0,
    ),
    rotation: new THREE.Vector4(
      Math.cos(Number.isFinite(settings.rotation) ? settings.rotation : 0),
      Math.sin(Number.isFinite(settings.rotation) ? settings.rotation : 0),
      Number.isFinite(settings.center.x) ? settings.center.x : 0,
      Number.isFinite(settings.center.y) ? settings.center.y : 0,
    ),
  }
}

function ensureGroundSplatShaderHooks(material: THREE.MeshStandardMaterial): boolean {
  const typed = material as THREE.MeshStandardMaterial & Record<string, unknown>
  if (typed[GROUND_SPLAT_SHADER_HOOK_INSTALLED] === true) {
    return false
  }
  const originalOnBeforeCompile = material.onBeforeCompile
  const originalCustomProgramCacheKey = material.customProgramCacheKey
  typed[GROUND_SPLAT_ORIGINAL_ON_BEFORE_COMPILE] = originalOnBeforeCompile
  typed[GROUND_SPLAT_ORIGINAL_PROGRAM_CACHE_KEY] = originalCustomProgramCacheKey

  const layerUniformDeclarations = Array.from({ length: GROUND_SPLAT_SHADER_MAX_LAYERS }, (_, index) => `
uniform sampler2D groundSplatLayerMap${index};
uniform sampler2D groundSplatLayerNormalMap${index};
uniform bool groundSplatLayerHasMap${index};
uniform bool groundSplatLayerHasNormalMap${index};
uniform bool groundSplatLayerEnabled${index};
uniform vec3 groundSplatLayerTint${index};
uniform float groundSplatLayerOpacity${index};
uniform vec2 groundSplatLayerUvScale${index};
uniform vec4 groundSplatLayerTransform${index};
uniform vec4 groundSplatLayerRotation${index};`).join('\n')

  const layerBlendBlocks = Array.from({ length: GROUND_SPLAT_SHADER_MAX_LAYERS }, (_, index) => {
    const maskSample = 'groundSplatMaskSample0'
    const maskChannel = ['r', 'g', 'b', 'a'][index % 4]
    return `
if (groundSplatLayerEnabled${index}) {
  vec2 groundSplatUv${index} = vec2(
    vGroundSplatWorldXZ.x * groundSplatLayerTransform${index}.x,
    vGroundSplatWorldXZ.y * groundSplatLayerTransform${index}.y
  ) + groundSplatLayerTransform${index}.zw;
  vec2 groundSplatCentered${index} = groundSplatUv${index} - groundSplatLayerRotation${index}.zw;
  groundSplatUv${index} = vec2(
    groundSplatCentered${index}.x * groundSplatLayerRotation${index}.x - groundSplatCentered${index}.y * groundSplatLayerRotation${index}.y,
    groundSplatCentered${index}.x * groundSplatLayerRotation${index}.y + groundSplatCentered${index}.y * groundSplatLayerRotation${index}.x
  ) + groundSplatLayerRotation${index}.zw;
  vec3 groundSplatLayerColor${index} = groundSplatLayerHasMap${index}
    ? texture2D(groundSplatLayerMap${index}, groundSplatUv${index}).rgb
    : vec3(1.0);
  groundSplatLayerColor${index} *= groundSplatLayerTint${index};
  float groundSplatMask${index} = clamp(${maskSample}.${maskChannel} * groundSplatLayerOpacity${index}, 0.0, 1.0);
  groundSplatLayerWeightSum += groundSplatMask${index};
  groundSplatLayerColorSum += groundSplatLayerColor${index} * groundSplatMask${index};
  if (groundSplatLayerHasNormalMap${index}) {
    vec3 groundSplatLayerNormal${index} = texture2D(groundSplatLayerNormalMap${index}, groundSplatUv${index}).xyz * 2.0 - 1.0;
    groundSplatNormalMixed += groundSplatLayerNormal${index} * groundSplatMask${index};
    groundSplatNormalWeight += groundSplatMask${index};
  }
}`
  }).join('\n')

  material.onBeforeCompile = (shader, renderer) => {
    typed[GROUND_SPLAT_SHADER_REF] = shader
    shader.uniforms.groundSplatEnabled = { value: false }
    shader.uniforms.groundSplatChunkRect = { value: new THREE.Vector4(0, 0, 1, 1) }
    shader.uniforms.groundSplatMask0 = { value: null }
    shader.uniforms.groundSplatHasMask0 = { value: false }
    for (let index = 0; index < GROUND_SPLAT_SHADER_MAX_LAYERS; index += 1) {
      shader.uniforms[`groundSplatLayerMap${index}`] = { value: null }
      shader.uniforms[`groundSplatLayerNormalMap${index}`] = { value: null }
      shader.uniforms[`groundSplatLayerHasMap${index}`] = { value: false }
      shader.uniforms[`groundSplatLayerHasNormalMap${index}`] = { value: false }
      shader.uniforms[`groundSplatLayerEnabled${index}`] = { value: false }
      shader.uniforms[`groundSplatLayerTint${index}`] = { value: new THREE.Color('#ffffff') }
      shader.uniforms[`groundSplatLayerOpacity${index}`] = { value: 0 }
      shader.uniforms[`groundSplatLayerUvScale${index}`] = { value: new THREE.Vector2(1, 1) }
      shader.uniforms[`groundSplatLayerTransform${index}`] = { value: new THREE.Vector4(1, 1, 0, 0) }
      shader.uniforms[`groundSplatLayerRotation${index}`] = { value: new THREE.Vector4(1, 0, 0, 0) }
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundSplatWorldXZ;')
      .replace(
        '#include <worldpos_vertex>',
        `vec4 worldPosition = vec4( transformed, 1.0 );

#ifdef USE_BATCHING

	worldPosition = batchingMatrix * worldPosition;

#endif

#ifdef USE_INSTANCING

	worldPosition = instanceMatrix * worldPosition;

#endif

worldPosition = modelMatrix * worldPosition;
vGroundSplatWorldXZ = vec2(worldPosition.x, worldPosition.z);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vGroundSplatWorldXZ;
uniform bool groundSplatEnabled;
uniform vec4 groundSplatChunkRect;
uniform sampler2D groundSplatMask0;
uniform bool groundSplatHasMask0;
${layerUniformDeclarations}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
float groundSplatNormalWeight = 0.0;
vec3 groundSplatNormalMixed = vec3(0.0);
if (groundSplatEnabled) {
  vec2 groundSplatMaskUv = vec2(
    clamp((vGroundSplatWorldXZ.x - groundSplatChunkRect.x) / max(groundSplatChunkRect.z, 1e-6), 0.0, 1.0),
    clamp(((groundSplatChunkRect.y + groundSplatChunkRect.w) - vGroundSplatWorldXZ.y) / max(groundSplatChunkRect.w, 1e-6), 0.0, 1.0)
  );
  vec4 groundSplatMaskSample0 = groundSplatHasMask0 ? texture2D(groundSplatMask0, groundSplatMaskUv) : vec4(0.0);
  float groundSplatLayerWeightSum = 0.0;
  vec3 groundSplatLayerColorSum = vec3(0.0);
  ${layerBlendBlocks}
  float groundSplatNormalizedLayerWeight = clamp(groundSplatLayerWeightSum, 0.0, 1.0);
  float groundSplatBaseWeight = max(1.0 - groundSplatNormalizedLayerWeight, 0.0);
  diffuseColor.rgb = (diffuseColor.rgb * groundSplatBaseWeight) + groundSplatLayerColorSum;
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
#ifdef USE_NORMALMAP_TANGENTSPACE
if (groundSplatEnabled && groundSplatNormalWeight > 0.0001) {
  vec3 groundSplatLayerNormalWeighted = normalize(groundSplatNormalMixed / groundSplatNormalWeight);
  float groundSplatLayerNormalBlendWeight = clamp(groundSplatNormalWeight, 0.0, 1.0);
  normal = normalize((normal * (1.0 - groundSplatLayerNormalBlendWeight)) + (normalize(tbn * groundSplatLayerNormalWeighted) * groundSplatLayerNormalBlendWeight));
}
#endif`,
      )
    originalOnBeforeCompile?.(shader, renderer)
    syncGroundSplatMaterialUniforms(material, typed[GROUND_SPLAT_RUNTIME_STATE] as GroundChunkTextureRuntimeState | null | undefined)
  }

  material.customProgramCacheKey = () => {
    const originalKey = typeof originalCustomProgramCacheKey === 'function'
      ? originalCustomProgramCacheKey.call(material)
      : 'ground-splat'
    return `${originalKey}|ground-splat-v1`
  }

  typed[GROUND_SPLAT_SHADER_HOOK_INSTALLED] = true
  typed.userData = {
    ...(typed.userData ?? {}),
    groundSplatShader: true,
  }
  material.needsUpdate = true
  return true
}

function syncGroundSplatMaterialUniforms(
  material: THREE.Material | null | undefined,
  state: GroundChunkTextureRuntimeState | null | undefined,
): void {
  if (!material || !(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    return
  }
  const typed = material as THREE.MeshStandardMaterial & Record<string, unknown>
  typed[GROUND_SPLAT_RUNTIME_STATE] = state ?? null
  const shader = typed[GROUND_SPLAT_SHADER_REF] as
    | { uniforms?: Record<string, { value: unknown }> }
    | undefined
  if (!shader?.uniforms) {
    return
  }
  const enabled = Boolean(state && state.layerStates.length > 0)
  const setUniform = (key: string, value: unknown) => {
    if (shader.uniforms?.[key]) {
      shader.uniforms[key]!.value = value
    }
  }
  setUniform('groundSplatEnabled', enabled)
  setUniform('groundSplatChunkRect', state
    ? new THREE.Vector4(state.chunkBounds.minX, state.chunkBounds.minZ, state.chunkBounds.width, state.chunkBounds.depth)
    : new THREE.Vector4(0, 0, 1, 1))
  setUniform('groundSplatMask0', state?.splatMaps[0] ?? null)
  setUniform('groundSplatHasMask0', Boolean(state?.splatMaps[0]))
  for (let index = 0; index < GROUND_SPLAT_SHADER_MAX_LAYERS; index += 1) {
    const layer = state?.layerStates[index] ?? null
    const layerTexture = state?.layerTextures[index] ?? null
    const layerNormalTexture = state?.layerNormalTextures[index] ?? null
    const tint = new THREE.Color(layer?.colorTint || '#ffffff')
    const transformState = layer ? createGroundSplatLayerTransform(layer) : {
      uvScale: new THREE.Vector2(1, 1),
      transform: new THREE.Vector4(1, 1, 0, 0),
      rotation: new THREE.Vector4(1, 0, 0, 0),
    }
    setUniform(`groundSplatLayerMap${index}`, layerTexture)
    setUniform(`groundSplatLayerNormalMap${index}`, layerNormalTexture)
    setUniform(`groundSplatLayerHasMap${index}`, Boolean(layerTexture))
    setUniform(`groundSplatLayerHasNormalMap${index}`, Boolean(layerNormalTexture))
    setUniform(`groundSplatLayerEnabled${index}`, Boolean(layer))
    setUniform(`groundSplatLayerTint${index}`, tint)
    setUniform(`groundSplatLayerOpacity${index}`, layer ? layer.opacity : 0)
    setUniform(`groundSplatLayerUvScale${index}`, transformState.uvScale)
    setUniform(`groundSplatLayerTransform${index}`, transformState.transform)
    setUniform(`groundSplatLayerRotation${index}`, transformState.rotation)
  }
}

function clearGroundSplatMaterialUniforms(material: THREE.Material | null | undefined): void {
  syncGroundSplatMaterialUniforms(material, null)
}

function createGroundChunkSplatRuntimeState(
  definition: GroundDynamicMesh,
  mesh: THREE.Mesh,
  spec: Pick<GroundChunkSpec, 'startRow' | 'startColumn' | 'rows' | 'columns'> | null,
  bundle: GroundChunkTextureBundleSources,
  profile?: GroundSplatRuntimeProfile | null,
): GroundChunkTextureRuntimeState | null {
  const runtimeProfile = normalizeGroundSplatRuntimeProfile(profile)
  const activeLayers = bundle.surfaceLayers.slice(0, runtimeProfile.maxLayers)
  if (bundle.baseBlendMode !== 'shader-splat-v1' || activeLayers.length === 0) {
    return null
  }
  const chunkBounds = buildGroundSplatChunkBounds(definition, spec, mesh)
  if (!chunkBounds) {
    return null
  }
  const maskSources = bundle.splatMaps.slice(0, 1)
  const splatMaps = loadGroundChunkSplatMaps(maskSources, 'ground-splat')
  if (maskSources.length > 0 && splatMaps.length !== maskSources.length) {
    splatMaps.forEach((texture) => disposeGroundTexture(texture))
    return null
  }
  const layerTextures = activeLayers.map((layer, index) => {
    if (!layer.albedoSource) {
      return null
    }
    return createGroundSplatLayerTexture(layer.albedoSource, index, layer.albedoTextureSettings)
  })
  const layerNormalTextures = runtimeProfile.enableLayerNormalMap
    ? activeLayers.map((layer, index) => {
      if (!layer.normalSource) {
        return null
      }
      const texture = createGroundSplatLayerTexture(layer.normalSource, index, layer.normalTextureSettings)
      if (texture) {
        texture.colorSpace = THREE.NoColorSpace
      }
      return texture
    })
    : activeLayers.map(() => null)
  return {
    chunkBounds,
    layerTextures,
    layerNormalTextures,
    layerStates: activeLayers,
    splatMaps,
  }
}

function disposeGroundChunkSplatRuntimeState(state: GroundChunkTextureRuntimeState | null | undefined): void {
  if (!state) {
    return
  }
  state.layerTextures.forEach((texture) => {
    releaseGroundTexture(texture)
  })
  state.layerNormalTextures.forEach((texture) => {
    releaseGroundTexture(texture)
  })
  state.splatMaps.forEach((texture) => {
    releaseGroundTexture(texture)
  })
}

function createGroundChunkTexturedMaterial(baseMaterial: THREE.Material): THREE.MeshStandardMaterial {
  const baseStandard = baseMaterial as THREE.MeshStandardMaterial & {
    metalness?: number
    roughness?: number
    flatShading?: boolean
    envMapIntensity?: number
  }
  const nextMaterial = new THREE.MeshStandardMaterial({
    // Baked chunk albedo already contains the resolved ground + landform base color.
    // Keep runtime chunk materials white so we do not multiply that color a second time.
    color: '#ffffff',
    roughness: typeof baseStandard.roughness === 'number' ? baseStandard.roughness : 0.85,
    metalness: typeof baseStandard.metalness === 'number' ? baseStandard.metalness : 0.05,
  })
  nextMaterial.name = baseMaterial.name ? `${baseMaterial.name} Terrain` : 'Ground Terrain'
  nextMaterial.side = baseMaterial.side
  nextMaterial.depthTest = baseMaterial.depthTest
  nextMaterial.depthWrite = true
  nextMaterial.transparent = false
  nextMaterial.opacity = 1
  nextMaterial.alphaTest = 0
  nextMaterial.wireframe = false
  nextMaterial.fog = (baseMaterial as THREE.Material & { fog?: boolean }).fog ?? nextMaterial.fog
  nextMaterial.toneMapped = (baseMaterial as THREE.Material & { toneMapped?: boolean }).toneMapped ?? nextMaterial.toneMapped
  nextMaterial.flatShading = Boolean(baseStandard.flatShading)
  if (typeof baseStandard.envMapIntensity === 'number') {
    nextMaterial.envMapIntensity = baseStandard.envMapIntensity
  }
  nextMaterial.emissive.set('#000000')
  nextMaterial.emissiveIntensity = 0
  nextMaterial.normalMap = null
  nextMaterial.displacementMap = null
  return nextMaterial
}

function createGroundChunkSplatMaterial(baseMaterial: THREE.Material): THREE.MeshStandardMaterial | null {
  if (!(baseMaterial as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    return null
  }
  const nextMaterial = (baseMaterial as THREE.MeshStandardMaterial).clone()
  nextMaterial.name = baseMaterial.name ? `${baseMaterial.name} GroundSplat` : 'Ground Splat'
  nextMaterial.depthWrite = true
  nextMaterial.transparent = false
  nextMaterial.opacity = 1
  nextMaterial.alphaTest = 0
  nextMaterial.wireframe = false
  nextMaterial.roughnessMap = null
  nextMaterial.metalnessMap = null
  nextMaterial.aoMap = null
  nextMaterial.emissiveMap = null
  ensureGroundSplatShaderHooks(nextMaterial)
  return nextMaterial
}

function applyGroundTextureToChunkMesh(
  mesh: THREE.Mesh,
  definition: GroundDynamicMesh,
  chunkKey: string | null,
  spec: Pick<GroundChunkSpec, 'startRow' | 'startColumn' | 'rows' | 'columns'> | null,
  baseMaterial: THREE.Material,
  baseTexture: THREE.Texture | null,
  baseMaterialSignature: string,
  options: {
    isCompiledGroundTile?: boolean
    compiledGroundTileKey?: string | null
    groundSplatRuntimeProfile?: GroundSplatRuntimeProfile | null
  } = {},
): void {
  void baseTexture
  const currentMaterial = Array.isArray(mesh.material) ? (mesh.material[0] ?? null) : (mesh.material ?? null)
  const userData = mesh.userData as Record<string, unknown>
  if (!chunkKey) {
    if (options.isCompiledGroundTile) {
      const tileLabel = options.compiledGroundTileKey ?? mesh.name ?? 'unknown'
      throw new Error(
        `Missing baked ground chunk key for compiled ground tile ${tileLabel}.`,
      )
    }
    if (currentMaterial && currentMaterial !== baseMaterial) {
      disposeGroundChunkTexturedMaterial(currentMaterial)
    }
    if (mesh.material !== baseMaterial) {
      mesh.material = baseMaterial
    }
    delete userData.groundChunkSplatMaps
    setGroundChunkTextureReady(mesh, true)
    return
  }
  const bundle = resolveGroundChunkTextureBundleSources(definition, chunkKey)
  const activeSource = bundle?.albedo ?? null
  if (bundle && !resolveGroundTileMaterialMap(definition)) {
    throw new Error(`Missing baked ground tile material map for chunk ${chunkKey}.`)
  }
  const hasBakedBundle = Boolean(
    activeSource
    || bundle?.normal
    || (bundle?.splatMaps?.length ?? 0) > 0,
  )

  if (!hasBakedBundle) {
    // Compiled ground tiles may span many chunk coordinates, while baked surface data is sparse
    // and only authored for chunks that actually need landform/texture blending.
    // When a tile resolves to a chunk key without an authored bundle, fall back to the base ground
    // material instead of treating it as a hard runtime error.
    if (currentMaterial && currentMaterial !== baseMaterial) {
      disposeGroundChunkTexturedMaterial(currentMaterial)
    }
    if (mesh.material !== baseMaterial) {
      mesh.material = baseMaterial
    }
    delete userData.groundChunkSplatMaps
    setGroundChunkTextureReady(mesh, true)
    return
  }

  const uvBounds = summarizeGroundMeshUvBounds(mesh)
  const useLocalUvWindow = isGroundChunkLocalUvBounds(uvBounds)
  const meshBoundsWindow = useLocalUvWindow
    ? resolveGroundChunkTextureWindowFromMeshBounds(definition, mesh)
    : null
  const safeWindow = useLocalUvWindow
    ? {
      offsetX: 0,
      offsetY: 0,
      repeatX: 1,
      repeatY: 1,
    }
    : (meshBoundsWindow ?? (spec ? resolveGroundChunkTextureWindow(definition, spec) : null) ?? {
      offsetX: 0,
      offsetY: 0,
      repeatX: 1,
      repeatY: 1,
    })
  const windowSignature = resolveGroundTextureWindowSignature(safeWindow)
  const splatRuntimeState = bundle
    ? createGroundChunkSplatRuntimeState(definition, mesh, spec, bundle, options.groundSplatRuntimeProfile)
    : null
  const shouldUseShaderSplat = Boolean(splatRuntimeState && chunkKey && bundle?.surfaceLayers.length)
  const signatureBase = bundle
    ? `${baseMaterialSignature}|chunk-rev:${bundle.revision}`
    : `${baseMaterialSignature}|chunk-rev:0`

  if (shouldUseShaderSplat && chunkKey && bundle) {
    const signature = createGroundSplatSignature(chunkKey, signatureBase, bundle, options.groundSplatRuntimeProfile)
    const cachedEntry = groundMaterialCache.get(signature)
    const nextMaterial = cachedEntry?.material ?? createGroundChunkSplatMaterial(baseMaterial)
    if (nextMaterial) {
      if (!cachedEntry) {
        markGroundChunkTexturedMaterial(nextMaterial, signature, activeSource)
        syncGroundSplatMaterialUniforms(nextMaterial, splatRuntimeState)
        const typed = nextMaterial as THREE.MeshStandardMaterial & Record<string, unknown>
        typed[GROUND_SPLAT_LAYER_TEXTURES] = splatRuntimeState?.layerTextures ?? []
        typed[GROUND_SPLAT_LAYER_NORMAL_TEXTURES] = splatRuntimeState?.layerNormalTextures ?? []
        typed[GROUND_SPLAT_MASK_TEXTURES] = splatRuntimeState?.splatMaps ?? []
        typed.userData = {
          ...(typed.userData ?? {}),
          groundChunkSplatMapIds: bundle.splatMaps,
          groundSplatLayerNormalMapEnabled: Boolean(splatRuntimeState?.layerNormalTextures.some(Boolean)),
        }
        if (bundle.normal) {
          typed.normalMap = loadGroundTextureFromSource(bundle.normal, 'GroundChunkNormalMap', {
            flipY: false,
            textureSettingsKey: `${windowSignature}|normal`,
          })
        }
        typed.needsUpdate = true
        createGroundMaterialCacheEntry(signature, nextMaterial, [
          typed.normalMap ?? null,
          ...(splatRuntimeState?.layerTextures ?? []),
          ...(splatRuntimeState?.layerNormalTextures ?? []),
          ...(splatRuntimeState?.splatMaps ?? []),
        ])
      }
      userData.groundChunkSplatMaps = (nextMaterial as THREE.MeshStandardMaterial & Record<string, unknown>)[GROUND_SPLAT_MASK_TEXTURES] ?? []
      if (currentMaterial && currentMaterial !== baseMaterial && currentMaterial !== nextMaterial) {
        disposeGroundChunkTexturedMaterial(currentMaterial)
      }
      if (mesh.material !== nextMaterial) {
        if (cachedEntry) {
          retainGroundChunkTexturedMaterial(nextMaterial)
        }
        mesh.material = nextMaterial
      }
      syncGroundChunkTextureReadyFromMaterial(mesh, nextMaterial)
      return
    }

    disposeGroundChunkSplatRuntimeState(splatRuntimeState)
  }

  const signature = [
    'ground-chunk-albedo-v2',
    bundle?.albedo ?? 'none',
    bundle?.normal ?? 'none',
    bundle ? bundle.splatMaps.join('|') : 'none',
    signatureBase,
    windowSignature,
  ].join('|')
  const cachedEntry = groundMaterialCache.get(signature)
  if (cachedEntry) {
    if (currentMaterial && currentMaterial !== baseMaterial && currentMaterial !== cachedEntry.material) {
      disposeGroundChunkTexturedMaterial(currentMaterial)
    }
    if (mesh.material !== cachedEntry.material) {
      retainGroundChunkTexturedMaterial(cachedEntry.material)
      mesh.material = cachedEntry.material
    }
    const cachedTyped = cachedEntry.material as THREE.MeshStandardMaterial & Record<string, unknown>
    userData.groundChunkSplatMaps = Array.isArray(cachedTyped[GROUND_SPLAT_MASK_TEXTURES])
      ? cachedTyped[GROUND_SPLAT_MASK_TEXTURES] as THREE.Texture[]
      : []
    disposeGroundChunkSplatRuntimeState(splatRuntimeState)
    syncGroundChunkTextureReadyFromMaterial(mesh, cachedEntry.material)
    return
  }

  // groundTileMaterialMap[*].textureAssetId is treated as the final baked albedo for this tile.
  // Ground inspector color reaches baked chunks through landform/ground bake, so the runtime
  // chunk material must stay white and only contribute non-color material properties here.
  const nextMaterial = createGroundChunkTexturedMaterial(baseMaterial)
  markGroundChunkTexturedMaterial(nextMaterial, signature, activeSource)
  const typed = nextMaterial as THREE.MeshStandardMaterial & {
    map?: THREE.Texture | null
    normalMap?: THREE.Texture | null
    roughnessMap?: THREE.Texture | null
    metalnessMap?: THREE.Texture | null
    aoMap?: THREE.Texture | null
    emissiveMap?: THREE.Texture | null
    needsUpdate?: boolean
  }
  const previousSplatMaps = Array.isArray(userData.groundChunkSplatMaps)
    ? userData.groundChunkSplatMaps.filter((entry): entry is THREE.Texture => Boolean(entry))
    : []
  previousSplatMaps.forEach((texture) => {
    releaseGroundTexture(texture)
  })
  if (activeSource) {
    const texture = loadGroundTextureFromSource(activeSource, 'GroundChunkAlbedo', {
      flipY: false,
      textureSettingsKey: `${windowSignature}|albedo`,
    })
    if (!texture) {
      throw new Error(`Failed to load baked albedo texture for ground chunk ${chunkKey}.`)
    }
    applyGroundTextureSamplingDefaults(texture)
    texture.offset.set(safeWindow.offsetX, safeWindow.offsetY)
    texture.repeat.set(safeWindow.repeatX, safeWindow.repeatY)
    markDynamicGroundTexture(texture)
    typed.map = texture
  }
  if (bundle?.normal) {
    typed.normalMap = loadGroundTextureFromSource(bundle.normal, 'GroundChunkNormalMap', {
      flipY: false,
      textureSettingsKey: `${windowSignature}|normal`,
    })
  }
  const splatMapSources = bundle?.splatMaps ?? []
  // These splat maps and layer metadata are preserved for future true shader-based splatting,
  // but the current editor/runtime path still consumes the pre-baked per-chunk texture bundle.
  userData.groundChunkSplatMaps = loadGroundChunkSplatMaps(splatMapSources, chunkKey)
  typed.userData = {
    ...(typed.userData ?? {}),
    groundChunkSplatMapIds: splatMapSources,
  }
  typed.needsUpdate = true
  createGroundMaterialCacheEntry(signature, nextMaterial, [
    typed.map ?? null,
    typed.normalMap ?? null,
    ...(Array.isArray(userData.groundChunkSplatMaps) ? userData.groundChunkSplatMaps as THREE.Texture[] : []),
  ])

  if (currentMaterial && currentMaterial !== baseMaterial) {
    disposeGroundChunkTexturedMaterial(currentMaterial)
  }
  disposeGroundChunkSplatRuntimeState(splatRuntimeState)
  mesh.material = nextMaterial
  syncGroundChunkTextureReadyFromMaterial(mesh, nextMaterial)
}

export function applyGroundTextureToRuntimeChunkMesh(params: {
  mesh: THREE.Mesh
  definition: GroundDynamicMesh
  baseMaterial: THREE.Material
  baseMaterialSignature?: string | null
  chunkKey?: string | null
  compiledGroundTileKey?: string | null
  rootUserData?: Record<string, unknown> | null | undefined
  groundSplatRuntimeProfile?: GroundSplatRuntimeProfile | null
}): string | null {
  const {
    mesh,
    definition,
    baseMaterial,
    baseMaterialSignature,
    chunkKey = null,
    compiledGroundTileKey = null,
    rootUserData = null,
    groundSplatRuntimeProfile = null,
  } = params
  const isCompiledGroundTile = mesh.userData?.compiledGroundTile === true || Boolean(compiledGroundTileKey)
  const resolvedChunkKey = chunkKey
    ?? resolveCompiledGroundTileChunkKey(rootUserData ?? {}, definition, compiledGroundTileKey, mesh)
  const compiledManifest = rootUserData?.compiledGroundManifest as { revision?: unknown } | null | undefined
  const compiledManifestRevision = Number(compiledManifest?.revision)
  const cacheScopeSignature = [
    typeof rootUserData?.compiledGroundBuildKey === 'string' ? rootUserData.compiledGroundBuildKey : '',
    Number.isFinite(compiledManifestRevision)
      ? Math.max(0, Math.trunc(compiledManifestRevision))
      : 0,
  ].join('|')
  const resolvedBaseMaterialSignature = typeof baseMaterialSignature === 'string' && baseMaterialSignature.trim().length > 0
    ? `${baseMaterialSignature}|scope:${cacheScopeSignature}`
    : `${resolveGroundBaseMaterialSignature(baseMaterial)}|scope:${cacheScopeSignature}`

  applyGroundTextureToChunkMesh(
    mesh,
    definition,
    resolvedChunkKey,
    null,
    baseMaterial,
    null,
    resolvedBaseMaterialSignature,
    {
      isCompiledGroundTile,
      compiledGroundTileKey,
      groundSplatRuntimeProfile,
    },
  )

  return resolvedChunkKey
}

function applyGroundTextureToObject(object: THREE.Object3D, definition: GroundDynamicMesh): void {
  const root = object as THREE.Object3D & { userData?: Record<string, unknown> }
  const rootUserData = (root.userData ??= {}) as Record<string, unknown>
  const groundSplatRuntimeProfile = (definition as GroundDynamicMesh & {
    groundSplatRuntimeProfile?: GroundSplatRuntimeProfile | null
  }).groundSplatRuntimeProfile ?? null
  const cachedBaseMaterial = rootUserData.groundMaterial
  const baseMaterial = cachedBaseMaterial && !Array.isArray(cachedBaseMaterial)
    ? cachedBaseMaterial as THREE.Material
    : null
  const compiledManifest = rootUserData.compiledGroundManifest as { revision?: unknown } | null | undefined
  const compiledManifestRevision = Number(compiledManifest?.revision)
  const traversalVersion = Number.isFinite(rootUserData.groundTextureTraversalCacheVersion as number)
    ? Math.max(0, Math.trunc(rootUserData.groundTextureTraversalCacheVersion as number))
    : 0
  const normalizedProfile = normalizeGroundSplatRuntimeProfile(groundSplatRuntimeProfile)
  const currentSignature = [
    traversalVersion,
    typeof rootUserData.compiledGroundBuildKey === 'string' ? rootUserData.compiledGroundBuildKey : '',
    Number.isFinite(compiledManifestRevision) ? Math.max(0, Math.trunc(compiledManifestRevision)) : 0,
    Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0,
    Number.isFinite(definition.groundSplatBake?.revision)
      ? Math.max(0, Math.trunc(definition.groundSplatBake?.revision as number))
      : 0,
    baseMaterial ? resolveGroundBaseMaterialSignature(baseMaterial) : 'nobase',
    normalizedProfile.maxLayers,
    normalizedProfile.enableLayerNormalMap ? 1 : 0,
  ].join('|')
  if (rootUserData.groundTextureTraversalAppliedSignature === currentSignature) {
    return
  }

  const traversalCache = getGroundTextureTraversalCache(root)
  traversalCache.meshes.forEach((mesh) => {
    const isCompiledGroundTile = mesh.userData?.compiledGroundTile === true
    const compiledGroundTileKey = typeof mesh.userData?.compiledGroundTileKey === 'string'
      ? mesh.userData.compiledGroundTileKey
      : null
    const currentMaterial = Array.isArray(mesh.material) ? (mesh.material[0] ?? null) : (mesh.material ?? null)
    const chunkBaseMaterial = baseMaterial ?? currentMaterial
    const chunkBaseMaterialSignature = chunkBaseMaterial
      ? resolveGroundBaseMaterialSignature(chunkBaseMaterial)
      : 'none'
    if (isCompiledGroundTile && chunkBaseMaterial) {
      applyGroundTextureToRuntimeChunkMesh({
        mesh,
        definition,
        baseMaterial: chunkBaseMaterial,
        baseMaterialSignature: chunkBaseMaterialSignature,
        compiledGroundTileKey,
        rootUserData,
        groundSplatRuntimeProfile,
      })
    }
  })
  rootUserData.groundTextureTraversalAppliedSignature = currentSignature
}

export function createGroundMesh(definition: GroundDynamicMesh): THREE.Object3D {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  // Prototype mesh retained for material/metadata defaults.
  if (!cachedPrototypeMesh) {
    const geometry = buildGroundChunkGeometry(runtimeDefinition, { startRow: 0, startColumn: 0, rows: 1, columns: 1 })
    const material = new THREE.MeshStandardMaterial({
      color: '#707070',
      roughness: 0.85,
      metalness: 0.05,
    })
    cachedPrototypeMesh = new THREE.Mesh(geometry, material)
    cachedPrototypeMesh.name = 'GroundPrototype'
    cachedPrototypeMesh.receiveShadow = true
    cachedPrototypeMesh.castShadow = false
    cachedPrototypeMesh.userData.dynamicMeshType = 'Ground'
  }

  const group = new THREE.Group()
  group.name = 'Ground'
  group.userData.dynamicMeshType = 'Ground'
  ensureGroundRuntimeState(group, runtimeDefinition)
  const cellSize = Number.isFinite(runtimeDefinition.cellSize) && runtimeDefinition.cellSize > 0 ? runtimeDefinition.cellSize : 1
  const seedRadius = Math.max(50, resolveRuntimeChunkCells(runtimeDefinition) * cellSize * 1.5)
  updateGroundChunks(group, runtimeDefinition, null, { radius: seedRadius })
  return group
}

export function setGroundMaterial(target: THREE.Object3D, material: THREE.Material | THREE.Material[]): void {
  const resolvedMaterial = Array.isArray(material) ? material[0] : material
  if (!resolvedMaterial) {
    return
  }

  const userData = (target.userData ??= {}) as Record<string, unknown>
  userData.groundMaterial = resolvedMaterial
  markGroundTextureTraversalCacheDirty(target)

  target.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      if (mesh.userData?.compiledGroundTile) {
        return
      }
      const currentMaterial = Array.isArray(mesh.material) ? (mesh.material[0] ?? null) : (mesh.material ?? null)
      if (currentMaterial && currentMaterial !== resolvedMaterial) {
        disposeGroundChunkTexturedMaterial(currentMaterial)
      }
      mesh.material = resolvedMaterial
    }
  })
}

export function refreshGroundChunkMaterials(target: THREE.Object3D, definition: GroundDynamicMesh): void {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  applyGroundTextureToObject(target, runtimeDefinition)
}

/**
 * Set the material used for sculpted (heightmap) ground chunks.
 * When set, sculpted chunks use this material instead of the shared groundMaterial.
 * Falls back to groundMaterial when null is passed.
 */
export function setGroundSculptedMaterial(target: THREE.Object3D, material: THREE.Material | null): void {
  const userData = (target.userData ??= {}) as Record<string, unknown>
  if (material) {
    userData.groundSculptedMaterial = material
  } else {
    delete userData.groundSculptedMaterial
  }
  markGroundTextureTraversalCacheDirty(target)
}

export function updateGroundChunks(
  target: THREE.Object3D,
  definition: GroundRuntimeDynamicMesh,
  camera: THREE.Camera | null,
  options: {
    radius?: number
    budget?: GroundChunkBudget | null
    force?: boolean
    minIntervalMs?: number
    minCameraMoveMeters?: number
  } = {},
): void {  
  const root = resolveGroundRuntimeGroup(target)
  if (!root) {
    // 没有找到运行时 ground group，说明当前对象还没挂上地形运行状态；这时直接退出，不做任何加载/卸载。
    return
  }
  const state = ensureGroundRuntimeState(root, definition)
  // const forceDenseChunkMeshes = runtimeDefinition.runtimeDisableOptimizedChunks === true
  const forceDenseChunkMeshes = false;//runtimeDefinition.runtimeDisableOptimizedChunks === true

  if (forceDenseChunkMeshes && state.flatChunkBatches.size > 0) {
    clearGroundFlatChunkBatches(root)
  }
  const now = Date.now()
  const force = options.force === true
  const minIntervalMs = Math.max(0, Math.trunc(Number.isFinite(options.minIntervalMs as number) ? (options.minIntervalMs as number) : 120))

  const chunkCells = state.chunkCells
  // cellSize 是单个网格单元在世界坐标里的尺寸。
  // 后面所有 loadRadius / unloadRadius / chunk 中心点位置，都要乘这个值才能从“格子数”换成“米”。
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
  const chunkSizeMeters = resolveInfiniteChunkSizeMeters(definition)

  let localX = 0
  let localZ = 0

  if (camera) {
    // We only need the runtime group's world transform to convert camera space.
    // Updating children recursively turns chunk streaming checks into a full-scene walk.
    root.updateWorldMatrix(true, false)
  }

  if (camera) {
    const cameraWorld = new THREE.Vector3()
    camera.getWorldPosition(cameraWorld)
    const cameraLocal = root.worldToLocal(cameraWorld)
    localX = cameraLocal.x
    localZ = cameraLocal.z
  }

  const cameraChunkCoord = resolveGroundChunkCoordFromWorldPosition(localX, localZ, chunkSizeMeters)

  const loadRadiusChunks = resolveInfiniteDenseChunkLoadRadiusChunks(definition)
  const flatReleaseRadiusChunks = resolveInfiniteFlatTilingReleaseRadiusChunks(definition)
  const flatLoadRadiusChunks = resolveInfiniteFlatTilingRadiusChunks(definition)
  const flatTilingExpansion = updateInfiniteFlatTilingBounds(state, cameraChunkCoord, flatLoadRadiusChunks)
  const flatTilingChanged = flatTilingExpansion !== null
  const unloadRadiusChunks = loadRadiusChunks + Math.max(4, Math.ceil(loadRadiusChunks * 0.5))

  const dxMoved = localX - (state.lastCameraLocalX ?? 0)
  const dzMoved = localZ - (state.lastCameraLocalZ ?? 0)
  const movedSq = dxMoved * dxMoved + dzMoved * dzMoved
  // 只有在相机真的移动过一定距离时，才值得重新构建窗口和重排 chunk 队列。
  // 否则相机只是轻微抖动，也会造成不必要的加载/卸载波动。
  const chunkWorldSize = Math.max(1, chunkCells) * cellSize
  const moveThreshold = Number.isFinite(options.minCameraMoveMeters as number)
    ? Math.max(0, Number(options.minCameraMoveMeters))
    : Math.max(cellSize * 2, chunkWorldSize * 0.01)
  const moveThresholdSq = moveThreshold * moveThreshold
  const normalizeChunkRow = (value: number) => Math.trunc(value)
  const normalizeChunkColumn = (value: number) => Math.trunc(value)

  const minLoadChunkColumn = normalizeChunkColumn(cameraChunkCoord.chunkX - loadRadiusChunks)
  const maxLoadChunkColumn = normalizeChunkColumn(cameraChunkCoord.chunkX + loadRadiusChunks)
  const minLoadChunkRow = normalizeChunkRow(cameraChunkCoord.chunkZ - loadRadiusChunks)
  const maxLoadChunkRow = normalizeChunkRow(cameraChunkCoord.chunkZ + loadRadiusChunks)

  const flatMinLoadChunkColumn = normalizeChunkColumn(state.flatTilingMinChunkColumn)
  const flatMaxLoadChunkColumn = normalizeChunkColumn(state.flatTilingMaxChunkColumn)
  const flatMinLoadChunkRow = normalizeChunkRow(state.flatTilingMinChunkRow)
  const flatMaxLoadChunkRow = normalizeChunkRow(state.flatTilingMaxChunkRow)
  const flatMinReleaseChunkColumn = normalizeChunkColumn(cameraChunkCoord.chunkX - flatReleaseRadiusChunks)
  const flatMaxReleaseChunkColumn = normalizeChunkColumn(cameraChunkCoord.chunkX + flatReleaseRadiusChunks)
  const flatMinReleaseChunkRow = normalizeChunkRow(cameraChunkCoord.chunkZ - flatReleaseRadiusChunks)
  const flatMaxReleaseChunkRow = normalizeChunkRow(cameraChunkCoord.chunkZ + flatReleaseRadiusChunks)

  const minUnloadChunkColumn = normalizeChunkColumn(cameraChunkCoord.chunkX - unloadRadiusChunks)
  const maxUnloadChunkColumn = normalizeChunkColumn(cameraChunkCoord.chunkX + unloadRadiusChunks)
  const minUnloadChunkRow = normalizeChunkRow(cameraChunkCoord.chunkZ - unloadRadiusChunks)
  const maxUnloadChunkRow = normalizeChunkRow(cameraChunkCoord.chunkZ + unloadRadiusChunks)

  const nextDesiredSignature = [
    chunkCells,
    minLoadChunkRow,
    maxLoadChunkRow,
    minLoadChunkColumn,
    maxLoadChunkColumn,
    minUnloadChunkRow,
    maxUnloadChunkRow,
    minUnloadChunkColumn,
    maxUnloadChunkColumn,
    Math.round(loadRadiusChunks * 1000),
    `${cameraChunkCoord.chunkX}:${cameraChunkCoord.chunkZ}:${loadRadiusChunks}:${flatLoadRadiusChunks}:${unloadRadiusChunks}:${flatMinLoadChunkRow}:${flatMaxLoadChunkRow}:${flatMinLoadChunkColumn}:${flatMaxLoadChunkColumn}`,
    state.hiddenChunkKeysVersion,
  ].join('|')
  // 这个 signature 是“当前应该保留哪些 chunk”的摘要；只要它变了，就说明窗口发生了实质变化。
  const desiredWindowChanged = nextDesiredSignature !== state.desiredSignature
  const hasPendingWork = false
  let desiredFlatChunkGroups: Map<string, { spec: GroundChunkSpec; keys: string[] }> | null = null
  const flatChunkGroups = new Map<string, { spec: GroundChunkSpec; keys: string[] }>()

  // Force mode should at least guarantee the camera's core chunk exists.
  let allowBypassInterval = false
  if (force && camera) {
    // force 模式下至少确保相机正下方的核心 chunk 已经存在，避免强刷时先出现空洞。
    // 这条逻辑的目的不是优化，而是保证调试、手动刷新或初始化时“中心不会缺块”。
    const coreKey = groundChunkKey(cameraChunkCoord.chunkZ, cameraChunkCoord.chunkX)
    if (!state.chunks.has(coreKey)) {
      allowBypassInterval = true
    }
  }

  if (!allowBypassInterval && now - state.lastChunkUpdateAt < minIntervalMs) {
    // 冷却时间内直接返回，避免同一帧内因为多个系统重复调用而把 chunk 队列反复打乱。
    return
  }

  if (!force) {
    // Only update when the camera moved enough (or when we have pending work).
    if (!hasPendingWork && !desiredWindowChanged && movedSq < moveThresholdSq) {
      // 相机没明显移动、窗口也没变化、队列里也没有待处理工作时，什么都不做。
      return
    }
  }

  state.lastChunkUpdateAt = now
  state.lastCameraLocalX = localX
  state.lastCameraLocalZ = localZ

  if (state.chunks.size > 0) {
    state.chunks.forEach((runtime) => {
      releaseChunkToPool(state, runtime)
    })
    state.chunks.clear()
    state.pendingCreates = []
    state.pendingDestroys = []
    markGroundVisibleChunkKeysDirty(state)
  }

  // Rebuild pending queues when the desired window changes.
  if (force || nextDesiredSignature !== state.desiredSignature) {
    // 只有当目标窗口真的变化时，才重建创建/销毁队列。
    // 这样可以把“持续加载”与“窗口变化”分离开，避免每一帧都重新排序整个 chunk 集合。
    state.desiredSignature = nextDesiredSignature
    state.pendingCreates = []
    state.pendingDestroys = []
  } else {
    // Drop stale pending work.
    // 如果窗口没变，就只清理那些因为外部状态变化而变得不再有效的待处理项，不重新构建整个队列。
    state.pendingCreates = []
    state.pendingDestroys = []
  }

  // flat 分组不直接创建 Mesh，而是先收集起来，后面统一交给 syncGroundFlatChunkBatches(...) 同步。
  const shouldSyncFlatChunks = force
    || desiredWindowChanged
    || flatTilingChanged
    || state.lastFlatChunkSyncTilingVersion < 0
    || state.lastFlatChunkSyncHiddenChunkKeysVersion !== state.hiddenChunkKeysVersion

  if (!forceDenseChunkMeshes && shouldSyncFlatChunks) {
    const needsFullFlatChunkScan = force
      || desiredWindowChanged
      || state.lastFlatChunkSyncTilingVersion < 0
      || state.lastFlatChunkSyncHiddenChunkKeysVersion !== state.hiddenChunkKeysVersion
      || !flatTilingExpansion
      || !flatTilingExpansion.hadPreviousBounds
    // When the desired load window moves, overlap zones can transition from sculpted chunks
    // back to flat instancing without any flat-tiling expansion. Re-scan the full flat window
    // so those keys are re-collected instead of silently dropping out of the batched mesh.

    if (needsFullFlatChunkScan) {
      collectGroundFlatChunkGroupsInRange(
        flatChunkGroups,
        definition,
        state,
        {
          minChunkRow: flatMinLoadChunkRow,
          maxChunkRow: flatMaxLoadChunkRow,
          minChunkColumn: flatMinLoadChunkColumn,
          maxChunkColumn: flatMaxLoadChunkColumn,
        }
      )
    } else {
      const overlapMinChunkRow = Math.max(flatTilingExpansion.nextMinChunkRow, flatTilingExpansion.previousMinChunkRow)
      const overlapMaxChunkRow = Math.min(flatTilingExpansion.nextMaxChunkRow, flatTilingExpansion.previousMaxChunkRow)
      if (flatTilingExpansion.nextMinChunkRow < flatTilingExpansion.previousMinChunkRow) {
        collectGroundFlatChunkGroupsInRange(
          flatChunkGroups,
          definition,
          state,
          {
            minChunkRow: flatTilingExpansion.nextMinChunkRow,
            maxChunkRow: flatTilingExpansion.previousMinChunkRow - 1,
            minChunkColumn: flatTilingExpansion.nextMinChunkColumn,
            maxChunkColumn: flatTilingExpansion.nextMaxChunkColumn,
          }
        )
      }
      if (flatTilingExpansion.nextMaxChunkRow > flatTilingExpansion.previousMaxChunkRow) {
        collectGroundFlatChunkGroupsInRange(
          flatChunkGroups,
          definition,
          state,
          {
            minChunkRow: flatTilingExpansion.previousMaxChunkRow + 1,
            maxChunkRow: flatTilingExpansion.nextMaxChunkRow,
            minChunkColumn: flatTilingExpansion.nextMinChunkColumn,
            maxChunkColumn: flatTilingExpansion.nextMaxChunkColumn,
          }
        )
      }
      if (overlapMinChunkRow <= overlapMaxChunkRow) {
        if (flatTilingExpansion.nextMinChunkColumn < flatTilingExpansion.previousMinChunkColumn) {
          collectGroundFlatChunkGroupsInRange(
            flatChunkGroups,
            definition,
            state,
            {
              minChunkRow: overlapMinChunkRow,
              maxChunkRow: overlapMaxChunkRow,
              minChunkColumn: flatTilingExpansion.nextMinChunkColumn,
              maxChunkColumn: flatTilingExpansion.previousMinChunkColumn - 1,
            }
          )
        }
        if (flatTilingExpansion.nextMaxChunkColumn > flatTilingExpansion.previousMaxChunkColumn) {
          collectGroundFlatChunkGroupsInRange(
            flatChunkGroups,
            definition,
            state,
            {
              minChunkRow: overlapMinChunkRow,
              maxChunkRow: overlapMaxChunkRow,
              minChunkColumn: flatTilingExpansion.previousMaxChunkColumn + 1,
              maxChunkColumn: flatTilingExpansion.nextMaxChunkColumn,
            }
          )
        }
      }
    }

    desiredFlatChunkGroups = flatChunkGroups

  // 同步 flat 批次。这里既会追加新的 flat chunk，也会把现在必须走独立 Mesh 的 key 从批次里剔除。
  // 这样 landform baked chunk 在显示纹理时可以从 flat -> dense，而清空 baked 数据后又能退回 flat。
    syncGroundFlatChunkBatches(
      root,
      state,
      definition,
      desiredFlatChunkGroups,
      cameraChunkCoord,
      {
        minChunkRow: flatMinReleaseChunkRow,
        maxChunkRow: flatMaxReleaseChunkRow,
        minChunkColumn: flatMinReleaseChunkColumn,
        maxChunkColumn: flatMaxReleaseChunkColumn,
      },
    )
    state.lastFlatChunkSyncTilingVersion = state.flatTilingVersion
    state.lastFlatChunkSyncHiddenChunkKeysVersion = state.hiddenChunkKeysVersion
  } else if (forceDenseChunkMeshes && state.flatChunkBatches.size > 0) {
    clearGroundFlatChunkBatches(root)
  }

  void options.budget

  applyGroundTextureToObject(root, definition)
}

export function syncGroundChunkLoadingMode(
  target: THREE.Object3D,
  definition: GroundDynamicMesh,
  camera: THREE.Camera | null,
  options: Parameters<typeof updateGroundChunks>[3] = {},
): void {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  const root = resolveGroundRuntimeGroup(target)
  if (!root) {
    return
  }
  updateGroundChunks(root, runtimeDefinition, camera, options)
}

export function clearGroundFlatChunkBatches(target: THREE.Object3D): boolean {
  const root = resolveGroundRuntimeGroup(target)
  if (!root) {
    return false
  }
  const state = groundRuntimeStateMap.get(root)
  if (!state || state.flatChunkBatches.size <= 0) {
    return false
  }

  state.flatChunkBatches.forEach((batch) => {
    batch.mesh.removeFromParent()
    try {
      ;(batch.mesh.geometry as any)?.dispose?.()
    } catch (_error) {
      /* noop */
    }
  })
  state.flatChunkBatches.clear()
  state.flatChunkKeys.clear()
  state.lastFlatChunkSyncTilingVersion = -1
  state.lastFlatChunkSyncHiddenChunkKeysVersion = state.hiddenChunkKeysVersion
  state.desiredSignature = ''
  syncGroundFlatChunkKeyCache(state)
  markGroundVisibleChunkKeysDirty(state)
  return true
}

export function hasPendingGroundChunkWork(target: THREE.Object3D): boolean {
  const root = resolveGroundRuntimeGroup(target)
  if (!root) {
    return false
  }
  const state = groundRuntimeStateMap.get(root)
  if (!state) {
    return false
  }
  if (state.pendingCreates.length > 0 || state.pendingDestroys.length > 0) {
    return true
  }
  for (const batch of state.flatChunkBatches.values()) {
    if (batch.pendingChunkKeys.size > 0 || batch.asyncBuildInFlight) {
      return true
    }
  }
  return false
}

/**
 * 更新地面网格
 * 该函数处理两种场景：单个网格(Mesh)或网格组(Group)
 * 如果是单个网格，直接更新其几何和纹理
 * 如果是网格组，通过分块系统进行更新
 */
export function updateGroundMesh(target: THREE.Object3D, definition: GroundDynamicMesh) {
  // 确保并获取运行时定义，包含该地面定义的缓存和预处理数据
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  
  // 检查目标是否为单个网格对象
  if ((target as any)?.isMesh) {
    const mesh = target as THREE.Mesh
    
    // 如果网格的几何不是缓冲区几何，则创建新的缓冲区几何
    if (!(mesh.geometry instanceof THREE.BufferGeometry)) {
      mesh.geometry = buildGroundGeometry(runtimeDefinition)
    }
    
    // 获取缓冲区几何并尝试更新
    const bufferGeometry = mesh.geometry as THREE.BufferGeometry
    const updated = updateGroundGeometry(bufferGeometry, runtimeDefinition)
    
    // 如果更新失败，重新构建几何
    if (!updated) {
      bufferGeometry.dispose()
      mesh.geometry = buildGroundGeometry(runtimeDefinition)
    }
    
    // 将运行时定义的纹理应用到网格
    applyGroundTextureToObject(mesh, runtimeDefinition)
    return
  }

  // 处理网格组的情况，通过分块系统管理
  const group = resolveGroundRuntimeGroup(target)
  if (!group) {
    return
  }
  
  // 确保运行时状态存在
  ensureGroundRuntimeState(group, runtimeDefinition)
  
  // 更新所有分块，传递 null 表示更新所有分块而不是特定分块集合
  updateGroundChunks(group, runtimeDefinition, null)
  
  // 将纹理应用到网格组
  applyGroundTextureToObject(group, runtimeDefinition)
}

function resolveGroundRuntimeGroup(target: THREE.Object3D): THREE.Group | null {
  if (!target) {
    return null
  }

  const userData = (target as any).userData as Record<string, unknown> | undefined

  const fromUserData = (userData as any)?.groundMesh as THREE.Object3D | undefined
  if (fromUserData && (fromUserData as any).isGroup && groundRuntimeStateMap.get(fromUserData)) {
    // If a caller mistakenly created chunk runtime state on the container (instead of the
    // canonical groundMesh group), purge it to avoid duplicate overlapping meshes.
    if (fromUserData !== target) {
      const orphanState = groundRuntimeStateMap.get(target)
      if (orphanState) {
        orphanState.chunks.forEach((entry) => disposeChunk(entry))
        orphanState.chunks.clear()
        groundRuntimeStateMap.delete(target)
      }
    }
    if (userData) {
      ;(userData as any).__harmonyGroundRuntimeGroup = fromUserData
    }
    return fromUserData as THREE.Group
  }

  const cached = userData?.__harmonyGroundRuntimeGroup as THREE.Object3D | undefined
  if (cached && (cached as any).isGroup && groundRuntimeStateMap.get(cached)) {
    return cached as THREE.Group
  }

  if ((target as any).isGroup && groundRuntimeStateMap.get(target)) {
    if (userData) {
      ;(userData as any).__harmonyGroundRuntimeGroup = target
    }
    return target as THREE.Group
  }

  let found: THREE.Group | null = null
  target.traverse((child) => {
    if (found) {
      return
    }
    if ((child as any).isGroup && groundRuntimeStateMap.get(child)) {
      found = child as THREE.Group
    }
  })

  if (found && userData) {
    ;(userData as any).__harmonyGroundRuntimeGroup = found
  }
  return found
}

export function resolveInfiniteGroundChunkKeyFromInstanceId(
  target: THREE.Object3D,
  instanceId: number,
): string | null {
  const group = resolveGroundRuntimeGroup(target)
  if (!group) {
    return null
  }
  const batchData = (target as any)?.userData?.groundChunkBatch as { chunkKeys?: string[] } | undefined
  if (batchData && Array.isArray(batchData.chunkKeys)) {
    if (Number.isInteger(instanceId) && instanceId >= 0 && instanceId < batchData.chunkKeys.length) {
      const batchKey = batchData.chunkKeys[instanceId]
      if (typeof batchKey === 'string' && batchKey.length > 0) {
        return batchKey
      }
    }
  }
  return null
}

export function getVisibleInfiniteGroundChunkKeys(target: THREE.Object3D): string[] {
  const group = resolveGroundRuntimeGroup(target)
  if (!group) {
    return []
  }
  const state = groundRuntimeStateMap.get(group)
  if (!state) {
    return []
  }
  if (state.visibleChunkKeysCacheVersion === state.visibleChunkKeysVersion) {
    return state.visibleChunkKeysCache
  }

  // 返回当前场景里已经可见的所有 chunk key，包括普通 chunk Mesh 和 flat InstancedMesh 批次。
  // 这个集合常被拾取、可见范围同步和调试工具复用，所以一定要同时覆盖两条渲染路径。
  const visibleKeys = new Set<string>()
  state.chunks.forEach((_runtime, key) => {
    if (state.hiddenChunkKeys.has(key)) {
      return
    }
    const sharedKey = resolveSharedGroundChunkKeyFromRuntimeKey(key)
    if (sharedKey) {
      visibleKeys.add(sharedKey)
    }
  })
  state.flatChunkBatches.forEach((batch) => {
    batch.chunkKeys.forEach((key) => {
      if (state.hiddenChunkKeys.has(key)) {
        return
      }
      const sharedKey = resolveSharedGroundChunkKeyFromRuntimeKey(key)
      if (sharedKey) {
        visibleKeys.add(sharedKey)
      }
    })
  })

  state.visibleChunkKeysCache = Array.from(visibleKeys)
  state.visibleChunkKeysCacheVersion = state.visibleChunkKeysVersion
  return state.visibleChunkKeysCache
}

export function getVisibleInfiniteGroundChunkVersion(target: THREE.Object3D): number | null {
  const group = resolveGroundRuntimeGroup(target)
  if (!group) {
    return null
  }
  const state = groundRuntimeStateMap.get(group)
  if (!state) {
    return null
  }
  return state.visibleChunkKeysVersion
}

export function getVisibleInfiniteGroundChunkSignature(target: THREE.Object3D): string {
  const group = resolveGroundRuntimeGroup(target)
  if (!group) {
    return '0:0'
  }
  const state = groundRuntimeStateMap.get(group)
  if (!state) {
    return '0:0'
  }
  if (state.visibleChunkSignatureCacheVersion === state.visibleChunkKeysVersion) {
    return state.visibleChunkSignatureCache
  }

  let count = 0
  let hash = 0
  state.chunks.forEach((_runtime, key) => {
    if (state.hiddenChunkKeys.has(key)) {
      return
    }
    count += 1
    hash = updateGroundChunkSignatureHash(hash, key)
  })
  state.flatChunkKeys.forEach((key) => {
    if (state.chunks.has(key) || state.hiddenChunkKeys.has(key)) {
      return
    }
    count += 1
    hash = updateGroundChunkSignatureHash(hash, key)
  })

  const signature = `${count}:${hash}`
  state.visibleChunkSignatureCache = signature
  state.visibleChunkSignatureCacheVersion = state.visibleChunkKeysVersion
  return signature
}

export function setInfiniteGroundHiddenChunkKeys(
  target: THREE.Object3D,
  chunkKeys: Iterable<string>,
): boolean {
  
  const group = resolveGroundRuntimeGroup(target)
  if (!group) {
    return false
  }
  const state = groundRuntimeStateMap.get(group)
  if (!state) {
    return false
  }

  const nextHiddenChunkKeys = new Set<string>()
  for (const key of chunkKeys) {
    if (typeof key === 'string' && key.length > 0) {
      const runtimeKey = resolveRuntimeGroundChunkKeyFromSharedKey(key)
      if (runtimeKey) {
        nextHiddenChunkKeys.add(runtimeKey)
      }
    }
  }

  let changed = nextHiddenChunkKeys.size !== state.hiddenChunkKeys.size
  if (!changed) {
    for (const key of nextHiddenChunkKeys) {
      if (!state.hiddenChunkKeys.has(key)) {
        changed = true
        break
      }
    }
  }
  if (!changed) {
    return false
  }

  // 隐藏 chunk 的语义是“这批 key 本轮不该再参与加载或渲染”。
  // 所以普通 chunk 和 flat 批次都要一起清掉，否则就会出现“key 已经隐藏了，但画面里还留着旧实例”的错觉。
  state.hiddenChunkKeys = nextHiddenChunkKeys
  state.hiddenChunkKeysVersion += 1
  markGroundVisibleChunkKeysDirty(state)
  state.desiredSignature = ''
  state.pendingCreates = state.pendingCreates.filter((entry) => !nextHiddenChunkKeys.has(entry.key))
  state.chunks.forEach((runtime, key) => {
    if (!nextHiddenChunkKeys.has(key)) {
      return
    }
    releaseChunkToPool(state, runtime)
    state.chunks.delete(key)
    markGroundVisibleChunkKeysDirty(state)
  })
  state.flatChunkBatches.forEach((batch, specKey) => {
    const nextKeys = batch.chunkKeys.filter((key) => !nextHiddenChunkKeys.has(key))
    const nextPendingKeys = Array.from(batch.pendingChunkKeys).filter((key) => !nextHiddenChunkKeys.has(key))
    if (nextKeys.length === batch.chunkKeys.length && nextPendingKeys.length === batch.pendingChunkKeys.size) {
      return
    }
    const nextKeySet = new Set<string>(nextKeys)
    const nextPendingKeySet = new Set<string>(nextPendingKeys)
    const removedLoadedKeys = batch.chunkKeys.filter((key) => !nextKeySet.has(key))
    const removedPendingKeys = Array.from(batch.pendingChunkKeys).filter((key) => !nextPendingKeySet.has(key))
    batch.pendingChunkKeys = new Set<string>(nextPendingKeys)
    if (nextKeys.length !== batch.chunkKeys.length) {
      compactGroundFlatChunkBatchInstances(batch, nextKeys)
    }
    if (!nextKeys.length && nextPendingKeys.length === 0) {
      batch.mesh.removeFromParent()
      try {
        ;(batch.mesh.geometry as any)?.dispose?.()
      } catch (_error) {
        /* noop */
      }
      state.flatChunkBatches.delete(specKey)
    }
    removedLoadedKeys.forEach((key) => {
      batch.instanceHeightCache.delete(key)
    })
    removedPendingKeys.forEach((key) => {
      batch.instanceHeightCache.delete(key)
    })
    markGroundVisibleChunkKeysDirty(state)
  })
  syncGroundFlatChunkKeyCache(state)
  return true
}

export function releaseGroundMeshCache(disposeResources = true) {
  if (!cachedPrototypeMesh) {
    return
  }
  cachedPrototypeMesh.removeFromParent()
  if (disposeResources) {
    cachedPrototypeMesh.geometry?.dispose?.()
    const material = cachedPrototypeMesh.material
    if (Array.isArray(material)) {
      material.forEach((entry) => entry?.dispose?.())
    } else {
      material?.dispose?.()
    }
  }
  cachedPrototypeMesh = null
}

