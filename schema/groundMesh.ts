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
  resolveGroundChunkCoordFromWorldPosition,
  resolveGroundEditCellSize,
  resolveGroundEditTileResolution,
  resolveGroundEditTileSizeMeters,
  resolveGroundWorkingGridSize,
  resolveGroundWorkingSpanMeters,
  type GroundChunkData,
  type GroundChunkManifestRecord,
  type GroundDynamicMesh,
  type GroundGenerationSettings,
  type GroundHeightMap,
  type GroundLocalEditTileData,
  type GroundOptimizedMeshChunkData,
  type GroundOptimizedMeshData,
  type GroundRuntimeDynamicMesh,
  type GroundSculptOperation,
} from './index'
import { addMesh as markInstancedBoundsDirty } from './instancedBoundsTracker'

import {
  computeGroundBaseHeightAtVertex,
  computeGroundBaseHeightRegion,
  type GroundBaseHeightRegion,
  normalizeGroundGenerationSettings,
} from './groundGeneration'

const textureLoader = new THREE.TextureLoader()

const DEFAULT_GROUND_CHUNK_CELLS = 100
const DEFAULT_GROUND_CHUNK_RADIUS_METERS = 200
const GROUND_TRIANGLE_SLICE_EPSILON = 1e-6
const GROUND_TRIANGLE_SLICE_PLANAR_TOLERANCE = 0.004

type GroundChunkKey = string

type GroundChunkSpec = {
  startRow: number
  startColumn: number
  rows: number
  columns: number
}

type GroundChunkRuntime = {
  key: GroundChunkKey
  chunkRow: number
  chunkColumn: number
  spec: GroundChunkSpec
  mesh: THREE.Mesh
}

type GroundCellTriangleDefinition = {
  vertices: [THREE.Vector2, THREE.Vector2, THREE.Vector2]
  heights: [number, number, number]
}

type GroundPlanarSliceRegion = {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
  h00: number
  slopeX: number
  slopeZ: number
}

export type GroundTriangleSliceMesh = {
  vertices: Array<{ x: number; y: number; z: number }>
  indices: number[]
}

type GroundRuntimeState = {
  definitionSignature: string
  chunkCells: number
  castShadow: boolean
  chunks: Map<GroundChunkKey, GroundChunkRuntime>
  flatChunkBatches: Map<string, GroundFlatChunkBatchRuntime>
  hiddenChunkKeys: Set<string>
  hiddenChunkKeysVersion: number
  lastChunkUpdateAt: number

  desiredSignature: string
  lastCameraLocalX: number
  lastCameraLocalZ: number

  pendingCreates: Array<{ key: GroundChunkKey; chunkRow: number; chunkColumn: number; priority: number; distSq: number }>
  pendingDestroys: Array<{ key: GroundChunkKey; distSq: number }>

  meshPool: Map<string, THREE.Mesh[]>
  poolMaxPerSize: number
}

type GroundFlatChunkBatchRuntime = {
  specKey: string
  spec: GroundChunkSpec
  mesh: THREE.InstancedMesh
  chunkKeys: string[]
}

const groundRuntimeStateMap = new WeakMap<THREE.Object3D, GroundRuntimeState>()
let cachedPrototypeMesh: THREE.Mesh | null = null
const infiniteGroundCameraQuaternion = new THREE.Quaternion()

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
  const parts = key.split(':')
  if (parts.length !== 2) {
    return null
  }
  const row = Number(parts[0])
  const column = Number(parts[1])
  if (!Number.isFinite(row) || !Number.isFinite(column)) {
    return null
  }
  return {
    row: Math.trunc(row),
    column: Math.trunc(column),
  }
}

function resolveRuntimeChunkIndexFromSharedKey(
  key: string,
): { row: number; column: number } | null {
  // 现在 ground 只保留无限地形语义，shared key 直接被视为真实 chunk 坐标。
  // 不再保留有限模式的边界裁剪参数，避免后续维护者误以为这里还有“场景上限”。
  const parsed = parseGroundChunkKey(key)
  if (parsed) {
    return {
      row: Math.trunc(parsed.chunkZ),
      column: Math.trunc(parsed.chunkX),
    }
  }
  const parts = key.split(':')
  if (parts.length !== 2) {
    return null
  }
  const row = Number(parts[0])
  const column = Number(parts[1])
  if (!Number.isFinite(row) || !Number.isFinite(column)) {
    return null
  }
  return {
    row: Math.trunc(row),
    column: Math.trunc(column),
  }
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

function definitionStructureSignature(definition: GroundDynamicMesh): string {
  const gridSize = resolveGroundWorkingGridSize(definition)
  const columns = gridSize.columns
  const rows = gridSize.rows
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
  const spanMeters = resolveGroundWorkingSpanMeters(definition)
  const width = spanMeters
  const depth = spanMeters
  const runtimeDefinition = definition as GroundRuntimeDynamicMesh
  const optimizedMesh = definition.optimizedMesh
  const optimizedSignature = optimizedMesh
    ? `${optimizedMesh.chunkCells}:${optimizedMesh.chunkCount}:${optimizedMesh.optimizedVertexCount}:${optimizedMesh.optimizedTriangleCount}`
    : 'none'
  const surfaceRevision = Number.isFinite(definition.surfaceRevision) ? Math.trunc(definition.surfaceRevision as number) : 0
  const optimizedChunkState = runtimeDefinition.runtimeDisableOptimizedChunks === true ? 'disabled' : 'enabled'
  const hydratedHeightState = runtimeDefinition.runtimeHydratedHeightState ?? 'none'
  const loadedTileCount = Array.isArray(runtimeDefinition.runtimeLoadedTileKeys)
    ? runtimeDefinition.runtimeLoadedTileKeys.length
    : 0
  const tileResolution = Math.trunc(resolveGroundEditTileResolution(definition))
  const localEditTiles = runtimeDefinition.localEditTiles && typeof runtimeDefinition.localEditTiles === 'object'
    ? Object.values(runtimeDefinition.localEditTiles)
    : []
  const localEditSignature = localEditTiles.length
    ? `${localEditTiles.length}:${localEditTiles.reduce((maxUpdatedAt, tile) => {
      const updatedAt = Number(tile?.updatedAt)
      return Number.isFinite(updatedAt) ? Math.max(maxUpdatedAt, Math.trunc(updatedAt)) : maxUpdatedAt
    }, 0)}`
    : 'none'
  return `${columns}|${rows}|${cellSize.toFixed(6)}|${width.toFixed(6)}|${depth.toFixed(6)}|${surfaceRevision}|${optimizedSignature}|${optimizedChunkState}|${hydratedHeightState}|${tileResolution}|${loadedTileCount}|${localEditSignature}`
}

function resolveInfiniteChunkSizeMeters(definition: GroundDynamicMesh): number {
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
    resolvedChildMaterial = Array.isArray(meshMaterial)
      ? (meshMaterial[0] as THREE.Material | undefined)
      : (meshMaterial as THREE.Material | undefined)
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
  root.updateMatrixWorld(true)

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
  return {
    minChunkX: centeredMinChunkX,
    maxChunkX: centeredMaxChunkX,
    minChunkZ: centeredMinChunkZ,
    maxChunkZ: centeredMaxChunkZ,
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

  const manualHeightMap = runtimeDefinition.manualHeightMap
  const planningHeightMap = runtimeDefinition.planningHeightMap
  const limit = Math.max(manualHeightMap?.length ?? 0, planningHeightMap?.length ?? 0)
  for (let index = 0; index < limit; index += 1) {
    const manual = manualHeightMap[index]
    if (typeof manual === 'number' && Number.isFinite(manual)) {
      return {
        ...base,
        runtimeChunkCells: sourceChunkCells,
        canUseOptimizedMesh: false,
        reason: 'manual-height-overrides-present',
      }
    }
    const planning = planningHeightMap[index]
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
  const halfDiagonal = resolveGroundWorkingSpanMeters(definition) * 0.5
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
  const runtimeDefinition = definition as GroundRuntimeDynamicMesh
  const gridSize = resolveGroundWorkingGridSize(runtimeDefinition)
  runtimeDefinition.manualHeightMap = ensureGroundHeightMap(
    runtimeDefinition.manualHeightMap,
    gridSize.rows,
    gridSize.columns,
  )
  runtimeDefinition.planningHeightMap = ensureGroundHeightMap(
    runtimeDefinition.planningHeightMap,
    gridSize.rows,
    gridSize.columns,
  )
  if (!Array.isArray(runtimeDefinition.runtimeLoadedTileKeys)) {
    runtimeDefinition.runtimeLoadedTileKeys = []
  }
  return runtimeDefinition
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

  const manualOverrideCount = definition.runtimeManualHeightOverrideCount
  const planningOverrideCount = definition.runtimePlanningHeightOverrideCount
  if (Number.isFinite(manualOverrideCount) || Number.isFinite(planningOverrideCount)) {
    if ((manualOverrideCount ?? 0) > 0 || (planningOverrideCount ?? 0) > 0) {
      definition.runtimeHydratedHeightState = 'dirty'
      definition.runtimeDisableOptimizedChunks = true
      return true
    }
    definition.runtimeDisableOptimizedChunks = false
    return false
  }

  const manualHeightMap = definition.manualHeightMap
  const planningHeightMap = definition.planningHeightMap
  const limit = Math.max(manualHeightMap?.length ?? 0, planningHeightMap?.length ?? 0)
  for (let index = 0; index < limit; index += 1) {
    const manual = manualHeightMap[index]
    if (typeof manual === 'number' && Number.isFinite(manual)) {
      definition.runtimeHydratedHeightState = 'dirty'
      definition.runtimeDisableOptimizedChunks = true
      return true
    }
    const planning = planningHeightMap[index]
    if (typeof planning === 'number' && Number.isFinite(planning)) {
      definition.runtimeHydratedHeightState = 'dirty'
      definition.runtimeDisableOptimizedChunks = true
      return true
    }
  }

  definition.runtimeDisableOptimizedChunks = false
  return false
}

function invalidateGroundLocalEditTileCaches(definition: GroundRuntimeDynamicMesh): void {
  definition.runtimeLocalEditTileArrayCache = undefined
  definition.runtimeLocalEditTileLookupCache = undefined
  definition.runtimeLocalEditTileSourceRef = undefined
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
    runtimeDefinition.runtimeLocalEditTileArrayCache = []
    runtimeDefinition.runtimeLocalEditTileLookupCache = new Map<string, GroundLocalEditTileData>()
    runtimeDefinition.runtimeLocalEditTileSourceRef = null
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
    const tiles = Object.values(source)
    const lookup = new Map<string, GroundLocalEditTileData>()
    for (const tile of tiles) {
      lookup.set(formatGroundLocalEditTileKey(tile.tileRow, tile.tileColumn), tile)
    }
    runtimeDefinition.runtimeLocalEditTileArrayCache = tiles
    runtimeDefinition.runtimeLocalEditTileLookupCache = lookup
    runtimeDefinition.runtimeLocalEditTileSourceRef = source
  }

  return {
    tiles: runtimeDefinition.runtimeLocalEditTileArrayCache,
    lookup: runtimeDefinition.runtimeLocalEditTileLookupCache,
  }
}

function getGroundLocalEditTiles(definition: GroundDynamicMesh): GroundLocalEditTileData[] {
  return ensureGroundLocalEditTileCaches(definition).tiles
}

function resolveGroundLocalEditTileGridOriginFromRuntime(
  definition: GroundRuntimeDynamicMesh,
): { originX: number; originZ: number } {
  const cached = definition.runtimeLocalEditTileGridOriginCache
  if (cached?.cacheKey === 'infinite') {
    return cached
  }
  const next = {
    cacheKey: 'infinite',
    originX: 0,
    originZ: 0,
  }
  definition.runtimeLocalEditTileGridOriginCache = next
  return next
}

function resolveGroundLocalEditTileGridOrigin(definition: GroundDynamicMesh): { originX: number; originZ: number } {
  return resolveGroundLocalEditTileGridOriginFromRuntime(ensureGroundRuntimeDefinition(definition))
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
  const { originX, originZ } = resolveGroundLocalEditTileGridOriginFromRuntime(definition)
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
  const { originX, originZ } = resolveGroundLocalEditTileGridOrigin(definition)
  return {
    minX: originX + tileColumn * tileSizeMeters,
    minZ: originZ + tileRow * tileSizeMeters,
  }
}

function findGroundLocalEditTileAtWorldFromRuntime(
  definition: GroundRuntimeDynamicMesh,
  x: number,
  z: number,
): GroundLocalEditTileData | null {
  const tileSizeMeters = Number(definition.editTileSizeMeters)
  if (!Number.isFinite(tileSizeMeters) || tileSizeMeters <= 0) {
    return null
  }
  const coord = resolveGroundLocalEditTileCoordAtWorldFromRuntime(definition, x, z, tileSizeMeters)
  if (!coord) {
    return null
  }
  const key = formatGroundLocalEditTileKey(coord.tileRow, coord.tileColumn)
  const directMatch = definition.localEditTiles?.[key] ?? null
  if (directMatch) {
    return directMatch
  }
  return ensureGroundLocalEditTileCaches(definition).lookup.get(key) ?? null
}

function sampleGroundLocalEditHeightAtWorld(
  definition: GroundDynamicMesh,
  x: number,
  z: number,
): number | null {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  const tile = findGroundLocalEditTileAtWorldFromRuntime(runtimeDefinition, x, z)
  if (!tile) {
    return null
  }
  const tileSizeMeters = Number(tile.tileSizeMeters)
  const resolution = Math.max(1, Math.trunc(Number(tile.resolution) || 0))
  if (!Number.isFinite(tileSizeMeters) || tileSizeMeters <= 0 || resolution <= 0) {
    return null
  }
  const { originX, originZ } = resolveGroundLocalEditTileGridOriginFromRuntime(runtimeDefinition)
  const minX = originX + tile.tileColumn * tileSizeMeters
  const minZ = originZ + tile.tileRow * tileSizeMeters
  const maxX = minX + tileSizeMeters
  const maxZ = minZ + tileSizeMeters
  if (x < minX || x > maxX || z < minZ || z > maxZ) {
    return null
  }
  const values = Array.isArray(tile.values) ? tile.values : []
  const tx = clampInclusive((x - minX) / Math.max(tileSizeMeters, Number.EPSILON), 0, 1)
  const tz = clampInclusive((z - minZ) / Math.max(tileSizeMeters, Number.EPSILON), 0, 1)
  const sampleX = tx * resolution
  const sampleZ = tz * resolution
  const column0 = clampVertexIndex(Math.floor(sampleX), resolution)
  const row0 = clampVertexIndex(Math.floor(sampleZ), resolution)
  const column1 = clampVertexIndex(column0 + 1, resolution)
  const row1 = clampVertexIndex(row0 + 1, resolution)
  const blendX = clampInclusive(sampleX - column0, 0, 1)
  const blendZ = clampInclusive(sampleZ - row0, 0, 1)
  const rowStride = resolution + 1
  const read = (row: number, column: number): number | null => {
    const raw = Number(values[row * rowStride + column])
    return Number.isFinite(raw) ? raw : null
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

function chunkIntersectsGroundLocalEditTile(definition: GroundDynamicMesh, spec: GroundChunkSpec): boolean {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  const tiles = getGroundLocalEditTiles(runtimeDefinition)
  if (!tiles.length) {
    return false
  }
  const spanMeters = resolveGroundWorkingSpanMeters(runtimeDefinition)
  const halfWidth = spanMeters * 0.5
  const halfDepth = spanMeters * 0.5
  const cellSize = Number.isFinite(runtimeDefinition.cellSize) && runtimeDefinition.cellSize > 1e-6
    ? runtimeDefinition.cellSize
    : 1
  const chunkMinX = -halfWidth + spec.startColumn * cellSize
  const chunkMaxX = -halfWidth + (spec.startColumn + spec.columns) * cellSize
  const chunkMinZ = -halfDepth + spec.startRow * cellSize
  const chunkMaxZ = -halfDepth + (spec.startRow + spec.rows) * cellSize
  return tiles.some((tile) => {
    const tileSizeMeters = Number(tile.tileSizeMeters)
    if (!Number.isFinite(tileSizeMeters) || tileSizeMeters <= 0) {
      return false
    }
    const { minX: tileMinX, minZ: tileMinZ } = resolveGroundLocalEditTileWorldMin(runtimeDefinition, tile.tileRow, tile.tileColumn, tileSizeMeters)
    const tileMaxX = tileMinX + tileSizeMeters
    const tileMaxZ = tileMinZ + tileSizeMeters
    return tileMaxX > chunkMinX
      && tileMinX < chunkMaxX
      && tileMaxZ > chunkMinZ
      && tileMinZ < chunkMaxZ
  })
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
  if (!chunkIntersectsGroundLocalEditTile(definition, spec)) {
    return {
      segmentRows: baseRows,
      segmentColumns: baseColumns,
      stepX: baseCellSize,
      stepZ: baseCellSize,
    }
  }
  const refinedCellSize = resolveGroundEditCellSize(definition)
  if (!(refinedCellSize > 0) || refinedCellSize >= baseCellSize) {
    return {
      segmentRows: baseRows,
      segmentColumns: baseColumns,
      stepX: baseCellSize,
      stepZ: baseCellSize,
    }
  }
  const worldWidth = baseColumns * baseCellSize
  const worldDepth = baseRows * baseCellSize
  const segmentColumns = Math.max(baseColumns, Math.ceil(worldWidth / refinedCellSize))
  const segmentRows = Math.max(baseRows, Math.ceil(worldDepth / refinedCellSize))
  return {
    segmentRows,
    segmentColumns,
    stepX: worldWidth / segmentColumns,
    stepZ: worldDepth / segmentRows,
  }
}

function getPlanningVertexHeight(definition: GroundRuntimeDynamicMesh, row: number, column: number): number {
  // planningHeightMap 保存的是“规划/自动生成层”的绝对高度。
  // 它表示在基础地形之上，规划阶段希望该顶点呈现的目标基准高度；
  // 如果没有显式记录，则回退到基础高度，表示规划层对该点没有额外改动。
  const gridSize = resolveGroundWorkingGridSize(definition)
  const raw = definition.planningHeightMap[getGroundVertexIndex(gridSize.columns, row, column)]
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw
  }
  return computeGroundBaseHeightAtVertex(definition, row, column)
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
  const cellSize = Number.isFinite(runtimeDefinition.cellSize) && runtimeDefinition.cellSize > 1e-6
    ? runtimeDefinition.cellSize
    : 1
  const spanMeters = resolveGroundWorkingSpanMeters(runtimeDefinition)
  const halfWidth = spanMeters * 0.5
  const halfDepth = spanMeters * 0.5
  const localEditSample = sampleGroundLocalEditHeightAtWorld(
    runtimeDefinition,
    -halfWidth + column * cellSize,
    -halfDepth + row * cellSize,
  )
  if (Number.isFinite(localEditSample)) {
    return localEditSample as number
  }
  // 原始程序化地形高度。
  const base = computeGroundBaseHeightAtVertex(runtimeDefinition, row, column)
  const gridSize = resolveGroundWorkingGridSize(runtimeDefinition)
  const heightIndex = getGroundVertexIndex(gridSize.columns, row, column)
  // 用户手工雕刻后的绝对高度；若无手工覆盖则退回 base。
  const manualRaw = runtimeDefinition.manualHeightMap[heightIndex]
  const manual = typeof manualRaw === 'number' && Number.isFinite(manualRaw) ? manualRaw : base
  // 规划/自动生成层的绝对高度；若无规划覆盖则同样退回 base。
  const planningRaw = runtimeDefinition.planningHeightMap[heightIndex]
  const planning = typeof planningRaw === 'number' && Number.isFinite(planningRaw) ? planningRaw : base
  // 保留 manual 相对 base 的编辑增量，再把这个增量叠加到 planning 上，得到最终显示/采样高度。
  return planning + (manual - base)
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
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  const baseRegion = computeGroundBaseHeightRegion(runtimeDefinition, minRowInput, maxRowInput, minColumnInput, maxColumnInput)
  const { minRow, maxRow, minColumn, maxColumn, stride, values: baseValues } = baseRegion
  const total = baseValues.length
  const values = new Float32Array(total)
  const manualHeightMap = runtimeDefinition.manualHeightMap
  const planningHeightMap = runtimeDefinition.planningHeightMap
  const useLocalEditTiles = shouldUseGroundLocalEditTiles(runtimeDefinition)
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
      const effective = useLocalEditTiles
        ? resolveGroundEffectiveHeightAtVertex(runtimeDefinition, row, column)
        : (() => {
            const gridSize = resolveGroundWorkingGridSize(runtimeDefinition)
            const heightIndex = getGroundVertexIndex(gridSize.columns, row, column)
            const manualRaw = manualHeightMap[heightIndex]
            const planningRaw = planningHeightMap[heightIndex]
            const manual = typeof manualRaw === 'number' && Number.isFinite(manualRaw) ? manualRaw : base
            const planning = typeof planningRaw === 'number' && Number.isFinite(planningRaw) ? planningRaw : base
            return planning + (manual - base)
          })()
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

function sampleGroundEffectiveHeightRegionWithoutLocalEdit(
  definition: GroundRuntimeDynamicMesh,
  minRowInput: number,
  maxRowInput: number,
  minColumnInput: number,
  maxColumnInput: number,
): GroundEffectiveHeightRegion {
  return sampleGroundEffectiveHeightRegion(definition, minRowInput, maxRowInput, minColumnInput, maxColumnInput)
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

/**
 * 已知某个顶点期望达到的“最终有效高度”，反推出 manualHeightMap 中应写入的手工层绝对高度。
 *
 * 由 resolveGroundEffectiveHeightAtVertex 的公式：
 * effective = planning + (manual - base)
 * 可推导出：
 * manual = base + (effective - planning)
 *
 * 这个函数用于雕刻、平滑、压低等编辑操作。
 * 编辑工具面对的是用户看到的最终地形高度，因此先在 effective 空间里算出目标值，
 * 再通过这里把目标值转换回 manual 层保存，避免直接破坏规划层数据。
 */
export function resolveGroundManualHeightForEffectiveTarget(
  definition: GroundRuntimeDynamicMesh,
  row: number,
  column: number,
  effectiveHeight: number,
): number {
  const base = computeGroundBaseHeightAtVertex(definition, row, column)
  const planning = getPlanningVertexHeight(definition, row, column)
  // 把“最终想看到的高度”换算为 manual 层需要记录的绝对高度。
  return base + (effectiveHeight - planning)
}

function setHeightOverrideValue(definition: GroundRuntimeDynamicMesh, map: GroundHeightMap, row: number, column: number, value: number): void {
  const gridSize = resolveGroundWorkingGridSize(definition)
  const heightIndex = getGroundVertexIndex(gridSize.columns, row, column)
  const baseHeight = computeGroundBaseHeightAtVertex(definition, row, column)
  let rounded = Math.round(value * 100) / 100
  let baseRounded = Math.round(baseHeight * 100) / 100
  if (Object.is(rounded, -0)) rounded = 0
  if (Object.is(baseRounded, -0)) baseRounded = 0
  if (rounded === baseRounded) {
    map[heightIndex] = GROUND_HEIGHT_UNSET_VALUE
    return
  }
  map[heightIndex] = rounded
}

export function setManualHeightOverrideValue(definition: GroundRuntimeDynamicMesh, map: GroundHeightMap, row: number, column: number, value: number): void {
  setHeightOverrideValue(definition, map, row, column, value)
}

export function setPlanningHeightOverrideValue(definition: GroundRuntimeDynamicMesh, map: GroundHeightMap, row: number, column: number, value: number): void {
  setHeightOverrideValue(definition, map, row, column, value)
}

function setManualHeightOverrideForEffectiveValue(
  definition: GroundRuntimeDynamicMesh,
  map: GroundHeightMap,
  row: number,
  column: number,
  effectiveHeight: number,
): void {
  // 外部编辑逻辑通常基于最终效果高度进行运算，
  // 这里统一把 effective 高度反解到 manual 层，再复用普通写入逻辑。
  const manualHeight = resolveGroundManualHeightForEffectiveTarget(definition, row, column, effectiveHeight)
  setManualHeightOverrideValue(definition, map, row, column, manualHeight)
}

function setGroundCoverageHeightOverrideForEffectiveValue(
  definition: GroundRuntimeDynamicMesh,
  map: GroundHeightMap,
  row: number,
  column: number,
  x: number,
  z: number,
  effectiveHeight: number,
): void {
  const localPlacement = shouldUseGroundLocalEditTiles(definition)
    ? resolveGroundLocalEditVertexPlacement(definition, x, z)
    : null
  if (!localPlacement) {
    setManualHeightOverrideForEffectiveValue(definition, map, row, column, effectiveHeight)
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

  setManualHeightOverrideForEffectiveValue(definition, map, row, column, effectiveHeight)
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
  const spanMeters = resolveGroundWorkingSpanMeters(definition)
  const halfWidth = spanMeters * 0.5
  const halfDepth = spanMeters * 0.5
  const gridSize = resolveGroundWorkingGridSize(definition)
  const columns = gridSize.columns
  const rows = gridSize.rows
  const localColumnFloat = Math.max(0, Math.min(columns, (x + halfWidth) / cellSize))
  const localRowFloat = Math.max(0, Math.min(rows, (z + halfDepth) / cellSize))
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
  map: GroundHeightMap,
  accumulator: Map<number, GroundHeightDeltaAccumulatorEntry>,
): boolean {
  let modified = false
  const gridSize = resolveGroundWorkingGridSize(definition)
  const columns = gridSize.columns
  accumulator.forEach((entry, index) => {
    if (!(entry.weight > 0) || !Number.isFinite(entry.delta)) {
      return
    }
    if (entry.mode === 'local') {
      const tileRow = Math.trunc(entry.tileRow ?? 0)
      const tileColumn = Math.trunc(entry.tileColumn ?? 0)
      const localRow = Math.trunc(entry.localRow ?? 0)
      const localColumn = Math.trunc(entry.localColumn ?? 0)
      const tile = ensureGroundLocalEditTileStorage(
        definition,
        tileRow,
        tileColumn,
        entry.tileSizeMeters,
        entry.resolution,
      )
      const resolution = Math.max(1, Math.trunc(tile.resolution))
      const { minX, minZ } = resolveGroundLocalEditTileWorldMin(definition, tileRow, tileColumn, tile.tileSizeMeters)
      const x = minX + (localColumn / resolution) * tile.tileSizeMeters
      const z = minZ + (localRow / resolution) * tile.tileSizeMeters
      const storedHeight = getGroundLocalEditTileStoredValue(tile, localRow, localColumn)
      const currentHeight = storedHeight ?? sampleGroundHeight(definition, x, z)
      const nextHeight = currentHeight + entry.delta / entry.weight
      setGroundLocalEditTileValue(definition, tileRow, tileColumn, localRow, localColumn, nextHeight)
      modified = true
      return
    }
    const row = Math.floor(index / (columns + 1))
    const column = index % (columns + 1)
    const currentHeight = resolveGroundEffectiveHeightAtVertex(definition, row, column)
    const nextHeight = currentHeight + entry.delta / entry.weight
    setManualHeightOverrideForEffectiveValue(definition, map, row, column, nextHeight)
    modified = true
  })
  return modified
}

function applyCircularRaiseDepressSubsampled(
  definition: GroundRuntimeDynamicMesh,
  map: GroundHeightMap,
  params: Pick<SculptParams, 'point' | 'radius' | 'strength' | 'operation'>,
): boolean {
  const { point, radius, strength, operation } = params
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
  const direction = operation === 'depress' ? -1 : 1
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
      const delta = direction * strength * influence * 0.3
      accumulateGroundDeltaAtPoint(definition, accumulator, x, z, delta, sampleWeight)
    }
  }

  return applyAccumulatedGroundDeltas(definition, map, accumulator)
}

function applyPolygonRaiseDepressSubsampled(
  definition: GroundRuntimeDynamicMesh,
  map: GroundHeightMap,
  polygonBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  normalizedPolygon: SculptPolygonPoint[],
  params: Pick<SculptParams, 'operation' | 'strength' | 'depth' | 'slope'>,
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
  const direction = params.operation === 'depress' ? -1 : 1
  const effectiveDepth = Number.isFinite(params.depth) ? Math.max(0, params.depth ?? 0) : 0
  const effectiveSlope = Number.isFinite(params.slope) ? params.slope ?? 0.5 : 0.5
  const accumulator = new Map<number, GroundHeightDeltaAccumulatorEntry>()
  const sampleWeight = 1 / (Math.max(1, subdivisions) * Math.max(1, subdivisions))
  const candidates: Array<{ x: number; z: number; boundaryDistance: number }> = []
  let maxBoundaryDistance = 0

  for (let row = window.minRow; row <= window.maxRow; row += 1) {
    const z = window.originZ + row * sampleStep
    for (let column = window.minColumn; column <= window.maxColumn; column += 1) {
      const x = window.originX + column * sampleStep
      const samplePoint = { x, z }
      if (!isPointInsideSculptPolygonXZ(samplePoint, normalizedPolygon)) {
        continue
      }
      const boundaryDistance = computeSculptPolygonBoundaryDistance(samplePoint, normalizedPolygon)
      maxBoundaryDistance = Math.max(maxBoundaryDistance, boundaryDistance)
      candidates.push({ x, z, boundaryDistance })
    }
  }

  if (!candidates.length) {
    return false
  }

  const rampWidth = computePolygonRaiseDepressRampWidth(maxBoundaryDistance, effectiveDepth, effectiveSlope)
  for (const candidate of candidates) {
    let delta = direction * params.strength * 0.3
    if (effectiveDepth > 0) {
      const profile = computePolygonRaiseDepressProfile(candidate.boundaryDistance, rampWidth)
      delta = direction * effectiveDepth * profile
    }
    accumulateGroundDeltaAtPoint(definition, accumulator, candidate.x, candidate.z, delta, sampleWeight)
  }

  return applyAccumulatedGroundDeltas(definition, map, accumulator)
}

function applyCircularSurfaceSubsampled(
  definition: GroundRuntimeDynamicMesh,
  map: GroundHeightMap,
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

  return applyAccumulatedGroundDeltas(definition, map, accumulator)
}

function applyPolygonSurfaceSubsampled(
  definition: GroundRuntimeDynamicMesh,
  map: GroundHeightMap,
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

  return applyAccumulatedGroundDeltas(definition, map, accumulator)
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
  const spanMeters = resolveGroundWorkingSpanMeters(runtimeDefinition)
  const halfWidth = spanMeters * 0.5
  const halfDepth = spanMeters * 0.5

  const x0 = -halfWidth + column * cellSize
  const x1 = x0 + cellSize
  const z0 = -halfDepth + row * cellSize
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
  const spanMeters = resolveGroundWorkingSpanMeters(runtimeDefinition)
  const halfWidth = spanMeters * 0.5
  const halfDepth = spanMeters * 0.5
  const x0 = -halfWidth + region.startColumn * cellSize
  const x1 = -halfWidth + region.endColumn * cellSize
  const z0 = -halfDepth + region.startRow * cellSize
  const z1 = -halfDepth + region.endRow * cellSize
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
): { planarRegions: GroundPlanarSliceRegion[]; triangleCells: Array<{ row: number; column: number }> } {
  const visited = new Set<string>()
  const planarRegions: GroundPlanarSliceRegion[] = []
  const triangleCells: Array<{ row: number; column: number }> = []

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
  }

  return { planarRegions, triangleCells }
}

function appendGroundSliceClip(
  clip: PolygonClippingMultiPolygon,
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

    const faces = THREE.ShapeUtils.triangulateShape(contour, holes)
    if (!Array.isArray(faces) || !faces.length) {
      continue
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
}

export function sampleGroundTriangleHeight(definition: GroundDynamicMesh, x: number, z: number): number {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  const gridSize = resolveGroundWorkingGridSize(runtimeDefinition)
  const columns = gridSize.columns
  const rows = gridSize.rows
  const spanMeters = resolveGroundWorkingSpanMeters(runtimeDefinition)
  const halfWidth = spanMeters * 0.5
  const halfDepth = spanMeters * 0.5
  const cellSize = Number.isFinite(runtimeDefinition.cellSize) && runtimeDefinition.cellSize > 1e-6
    ? runtimeDefinition.cellSize
    : 1

  const localColumnFloat = clampInclusive((x + halfWidth) / cellSize, 0, columns)
  const localRowFloat = clampInclusive((z + halfDepth) / cellSize, 0, rows)
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
    return { vertices: [], indices: [] }
  }

  const gridSize = resolveGroundWorkingGridSize(runtimeDefinition)
  const columns = gridSize.columns
  const rows = gridSize.rows
  const spanMeters = resolveGroundWorkingSpanMeters(runtimeDefinition)
  const halfWidth = spanMeters * 0.5
  const halfDepth = spanMeters * 0.5
  const cellSize = Number.isFinite(runtimeDefinition.cellSize) && runtimeDefinition.cellSize > 1e-6
    ? runtimeDefinition.cellSize
    : 1

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

  const startColumn = clampInclusive(Math.floor((minX + halfWidth) / cellSize), 0, Math.max(0, columns - 1))
  const endColumn = clampInclusive(Math.floor((maxX + halfWidth) / cellSize), 0, Math.max(0, columns - 1))
  const startRow = clampInclusive(Math.floor((minZ + halfDepth) / cellSize), 0, Math.max(0, rows - 1))
  const endRow = clampInclusive(Math.floor((maxZ + halfDepth) / cellSize), 0, Math.max(0, rows - 1))

  const footprintPolygon: PolygonClippingMultiPolygon = [[vector2LoopToGroundClippingRing(footprint)]]
  const vertices: Array<{ x: number; y: number; z: number }> = []
  const indices: number[] = []
  const vertexIndexByKey = new Map<string, number>()

  const mergePlanarRegions = options.mergePlanarRegions !== false
  const { planarRegions, triangleCells } = mergePlanarRegions
    ? resolveGroundPlanarSliceRegions(
      runtimeDefinition,
      startRow,
      endRow,
      startColumn,
      endColumn,
      GROUND_TRIANGLE_SLICE_PLANAR_TOLERANCE,
    )
    : {
      planarRegions: [] as GroundPlanarSliceRegion[],
      triangleCells: Array.from({ length: endRow - startRow + 1 }, (_, rowOffset) => rowOffset + startRow)
        .flatMap((row) => Array.from({ length: endColumn - startColumn + 1 }, (_, columnOffset) => ({
          row,
          column: columnOffset + startColumn,
        }))),
    }

  planarRegions.forEach((region) => {
    const clip = polygonClipping.intersection(
      footprintPolygon as any,
      [[vector2LoopToGroundClippingRing(buildGroundPlanarSliceRegionPolygon(runtimeDefinition, region))]] as any,
    ) as PolygonClippingMultiPolygon
    appendGroundSliceClip(
      clip,
      (x, z) => {
        const localColumn = (x + halfWidth) / cellSize
        const localRow = (z + halfDepth) / cellSize
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

  return { vertices, indices }
}

export function sampleGroundHeight(definition: GroundDynamicMesh, x: number, z: number): number {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  const localEditSample = sampleGroundLocalEditHeightAtWorld(runtimeDefinition, x, z)
  if (Number.isFinite(localEditSample)) {
    return localEditSample as number
  }
  const gridSize = resolveGroundWorkingGridSize(runtimeDefinition)
  const columns = gridSize.columns
  const rows = gridSize.rows
  const spanMeters = resolveGroundWorkingSpanMeters(runtimeDefinition)
  const halfWidth = spanMeters * 0.5
  const halfDepth = spanMeters * 0.5
  const cellSize = Number.isFinite(runtimeDefinition.cellSize) && runtimeDefinition.cellSize > 1e-6
    ? runtimeDefinition.cellSize
    : 1

  const localColumnFloat = clampInclusive((x + halfWidth) / cellSize, 0, columns)
  const localRowFloat = clampInclusive((z + halfDepth) / cellSize, 0, rows)

  const column0 = clampVertexIndex(Math.floor(localColumnFloat), columns)
  const row0 = clampVertexIndex(Math.floor(localRowFloat), rows)
  const column1 = clampVertexIndex(column0 + 1, columns)
  const row1 = clampVertexIndex(row0 + 1, rows)

  const tx = clampInclusive(localColumnFloat - column0, 0, 1)
  const tz = clampInclusive(localRowFloat - row0, 0, 1)

  const h00 = resolveGroundEffectiveHeightAtVertex(runtimeDefinition, row0, column0)
  const h10 = resolveGroundEffectiveHeightAtVertex(runtimeDefinition, row0, column1)
  const h01 = resolveGroundEffectiveHeightAtVertex(runtimeDefinition, row1, column0)
  const h11 = resolveGroundEffectiveHeightAtVertex(runtimeDefinition, row1, column1)

  const hx0 = h00 + (h10 - h00) * tx
  const hx1 = h01 + (h11 - h01) * tx
  return hx0 + (hx1 - hx0) * tz
}

function sampleGroundHeightWithVertexCache(
  definition: GroundDynamicMesh,
  x: number,
  z: number,
  vertexHeightCache: Map<number, number>,
): number {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  const localEditSample = sampleGroundLocalEditHeightAtWorld(runtimeDefinition, x, z)
  if (Number.isFinite(localEditSample)) {
    return localEditSample as number
  }
  const gridSize = resolveGroundWorkingGridSize(runtimeDefinition)
  const columns = gridSize.columns
  const rows = gridSize.rows
  const spanMeters = resolveGroundWorkingSpanMeters(runtimeDefinition)
  const halfWidth = spanMeters * 0.5
  const halfDepth = spanMeters * 0.5
  const cellSize = Number.isFinite(runtimeDefinition.cellSize) && runtimeDefinition.cellSize > 1e-6
    ? runtimeDefinition.cellSize
    : 1

  const localColumnFloat = clampInclusive((x + halfWidth) / cellSize, 0, columns)
  const localRowFloat = clampInclusive((z + halfDepth) / cellSize, 0, rows)

  const column0 = clampVertexIndex(Math.floor(localColumnFloat), columns)
  const row0 = clampVertexIndex(Math.floor(localRowFloat), rows)
  const column1 = clampVertexIndex(column0 + 1, columns)
  const row1 = clampVertexIndex(row0 + 1, rows)

  const tx = clampInclusive(localColumnFloat - column0, 0, 1)
  const tz = clampInclusive(localRowFloat - row0, 0, 1)

  const resolveCachedVertexHeight = (row: number, column: number): number => {
    const heightIndex = getGroundVertexIndex(columns, row, column)
    const cachedHeight = vertexHeightCache.get(heightIndex)
    if (typeof cachedHeight === 'number' && Number.isFinite(cachedHeight)) {
      return cachedHeight
    }
    const height = resolveGroundEffectiveHeightAtVertex(runtimeDefinition, row, column)
    vertexHeightCache.set(heightIndex, height)
    return height
  }

  const h00 = resolveCachedVertexHeight(row0, column0)
  const h10 = resolveCachedVertexHeight(row0, column1)
  const h01 = resolveCachedVertexHeight(row1, column0)
  const h11 = resolveCachedVertexHeight(row1, column1)

  const hx0 = h00 + (h10 - h00) * tx
  const hx1 = h01 + (h11 - h01) * tx
  return hx0 + (hx1 - hx0) * tz
}

export function buildGroundChunkDataFromManifestRecord(
  definition: GroundDynamicMesh,
  record: GroundChunkManifestRecord,
): GroundChunkData {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  const resolution = Math.max(1, Math.trunc(record.resolution))
  const cellSize = record.chunkSizeMeters / resolution
  const heights = new Float32Array((resolution + 1) * (resolution + 1))
  const vertexHeightCache = new Map<number, number>()
  let heightMin = Number.POSITIVE_INFINITY
  let heightMax = Number.NEGATIVE_INFINITY

  let offset = 0
  for (let row = 0; row <= resolution; row += 1) {
    for (let column = 0; column <= resolution; column += 1) {
      const sampleX = record.originX + column * cellSize
      const sampleZ = record.originZ + row * cellSize
      const height = sampleGroundHeightWithVertexCache(runtimeDefinition, sampleX, sampleZ, vertexHeightCache)
      heights[offset] = height
      heightMin = Math.min(heightMin, height)
      heightMax = Math.max(heightMax, height)
      offset += 1
    }
  }

  return {
    header: {
      version: 1,
      key: record.key,
      chunkX: record.chunkX,
      chunkZ: record.chunkZ,
      originX: record.originX,
      originZ: record.originZ,
      chunkSizeMeters: record.chunkSizeMeters,
      resolution,
      cellSize,
      revision: Math.max(0, Math.trunc(record.revision)),
      heightMin: Number.isFinite(heightMin) ? heightMin : 0,
      heightMax: Number.isFinite(heightMax) ? heightMax : 0,
      updatedAt: Math.max(0, Math.trunc(record.updatedAt)),
      source: record.source ?? null,
    },
    heights,
  }
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

  const spanMeters = resolveGroundWorkingSpanMeters(definition)
  const halfWidth = spanMeters * 0.5
  const halfDepth = spanMeters * 0.5
  const cellSize = definition.cellSize
  const heightRegion = sampleGroundEffectiveHeightRegion(definition, 0, rows, 0, columns)
  const heightValues = heightRegion.values
  const heightStride = heightRegion.stride

  let vertexIndex = 0
  for (let row = 0; row <= rows; row += 1) {
    const z = -halfDepth + row * cellSize
    const heightOffset = row * heightStride
    for (let column = 0; column <= columns; column += 1) {
      const x = -halfWidth + column * cellSize
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
  if (chunkIntersectsGroundLocalEditTile(runtimeDefinition, spec) || hasRuntimeGroundHeightOverrides(runtimeDefinition)) {
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

function applyGroundOptimizedChunkGeometry(
  geometry: THREE.BufferGeometry,
  chunk: GroundOptimizedMeshChunkData,
): boolean {
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(chunk.positions), 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(chunk.uvs), 2))
  const indexArray = chunk.positions.length / 3 > 65535
    ? new Uint32Array(chunk.indices)
    : new Uint16Array(chunk.indices)
  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return true
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

function buildGroundChunkGeometry(definition: GroundRuntimeDynamicMesh, spec: GroundChunkSpec): THREE.BufferGeometry {
  const optimizedChunk = resolveOptimizedChunkForSpec(definition, spec)
  if (optimizedChunk) {
    return createGroundOptimizedChunkGeometry(optimizedChunk)
  }

  const gridSize = resolveGroundWorkingGridSize(definition)
  const columns = gridSize.columns
  const rows = gridSize.rows
  const layout = resolveGroundChunkGeometryLayout(definition, spec)
  const chunkColumns = layout.segmentColumns
  const chunkRows = layout.segmentRows
  const vertexColumns = chunkColumns + 1
  const vertexRows = chunkRows + 1
  const vertexCount = vertexColumns * vertexRows
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = new Uint32Array(chunkColumns * chunkRows * 6)

  const spanMeters = resolveGroundWorkingSpanMeters(definition)
  const halfWidth = spanMeters * 0.5
  const halfDepth = spanMeters * 0.5
  const startX = -halfWidth + spec.startColumn * definition.cellSize
  const startZ = -halfDepth + spec.startRow * definition.cellSize
  const heightRegion = sampleGroundEffectiveHeightRegionWithoutLocalEdit(
    definition,
    spec.startRow,
    spec.startRow + spec.rows,
    spec.startColumn,
    spec.startColumn + spec.columns,
  )
  const heightValues = heightRegion.values
  const heightStride = heightRegion.stride

  let vertexIndex = 0
  for (let localRow = 0; localRow <= chunkRows; localRow += 1) {
    const z = startZ + localRow * layout.stepZ
    for (let localColumn = 0; localColumn <= chunkColumns; localColumn += 1) {
      const x = startX + localColumn * layout.stepX
      const height = heightValues[localRow * heightStride + localColumn] ?? sampleGroundHeight(definition, x, z)
      const columnRatio = columns === 0 ? 0 : clampInclusive((x + halfWidth) / Math.max(spanMeters, Number.EPSILON), 0, 1)
      const rowRatio = rows === 0 ? 0 : clampInclusive((z + halfDepth) / Math.max(spanMeters, Number.EPSILON), 0, 1)

      positions[vertexIndex * 3 + 0] = x
      positions[vertexIndex * 3 + 1] = height
      positions[vertexIndex * 3 + 2] = z

      normals[vertexIndex * 3 + 0] = 0
      normals[vertexIndex * 3 + 1] = 1
      normals[vertexIndex * 3 + 2] = 0

      uvs[vertexIndex * 2 + 0] = columnRatio
      uvs[vertexIndex * 2 + 1] = 1 - rowRatio

      vertexIndex += 1
    }
  }

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

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  computeHeightfieldNormals(positions, normals, chunkRows, chunkColumns, layout.stepX, layout.stepZ)
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
    hiddenChunkKeys: new Set(),
    hiddenChunkKeysVersion: 0,
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

function chunkPoolKey(spec: GroundChunkSpec): string {
  const rows = Math.max(1, Math.trunc(spec.rows))
  const columns = Math.max(1, Math.trunc(spec.columns))
  return `${rows}x${columns}`
}

function disposeGroundFlatChunkBatch(batch: GroundFlatChunkBatchRuntime): void {
  batch.mesh.removeFromParent()
  try {
    ;(batch.mesh.geometry as any)?.dispose?.()
  } catch (_error) {
    /* noop */
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
  const instanceMatrix = new THREE.Matrix4()
  const instancePosition = new THREE.Vector3()
  const instanceRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
  const instanceScale = new THREE.Vector3(1, 1, 1)
  const sampleInstances: Array<{
    index: number
    key: string
    chunkRow: number
    chunkColumn: number
    x: number
    z: number
    rows: number
    columns: number
    chunkSizeMeters: number
  }> = []
  const chunkSizeMeters = resolveInfiniteChunkSizeMeters(definition)

  batch.mesh.count = chunkKeys.length
  chunkKeys.forEach((key, index) => {
    // 这里不要直接用 key 里的 row/column 去猜位置，而要回到 chunkSpec。
    // 原因是 chunkSpec 已经包含 startRow/startColumn/rows/columns 的完整切片信息，
    // 这样即使边缘 chunk 尺寸不满整格，instance 的位置也不会算偏。
    const indices = resolveRuntimeChunkIndexFromRuntimeKey(key)
    if (!indices) {
      return
    }
    const chunkSpec = computeChunkSpec(definition, indices.row, indices.column)
    instancePosition.set(
      indices.column * chunkSizeMeters + (chunkSizeMeters * 0.5),
      0,
      indices.row * chunkSizeMeters + (chunkSizeMeters * 0.5),
    )
    if (sampleInstances.length < 4) {
      sampleInstances.push({
        index,
        key,
        chunkRow: indices.row,
        chunkColumn: indices.column,
        x: instancePosition.x,
        z: instancePosition.z,
        rows: chunkSpec.rows,
        columns: chunkSpec.columns,
        chunkSizeMeters,
      })
    }
    instanceMatrix.compose(instancePosition, instanceRotation, instanceScale)
    batch.mesh.setMatrixAt(index, instanceMatrix)
  })
  batch.mesh.instanceMatrix.needsUpdate = true
  markInstancedBoundsDirty(batch.mesh)
  batch.mesh.userData.groundChunkBatch = {
    specKey: batch.specKey,
    chunkKeys: [...chunkKeys],
  }
  batch.chunkKeys = [...chunkKeys]
}

function syncGroundFlatChunkBatches(
  root: THREE.Group,
  state: GroundRuntimeState,
  definition: GroundRuntimeDynamicMesh,
  desiredFlatChunkGroups: Map<string, { spec: GroundChunkSpec; keys: string[] }>,
): void {
  // 这里只同步 flat chunk 批次，不碰雕刻 chunk 的独立 Mesh。
  // 这条分离非常关键：一旦 flat / sculpted 混在同一个集合里，后续释放、拾取、以及编辑后的降级/升级都会很难维护。
  if (desiredFlatChunkGroups.size === 0) {
    state.flatChunkBatches.forEach((batch) => disposeGroundFlatChunkBatch(batch))
    state.flatChunkBatches.clear()
    return
  }

  const material = resolveGroundRuntimeMaterial(root, state)
  const nextBatches = new Map<string, GroundFlatChunkBatchRuntime>()

  desiredFlatChunkGroups.forEach((group, specKey) => {
    const existing = state.flatChunkBatches.get(specKey)
    if (existing) {
      // 同规格批次直接复用，不重新创建 geometry。
      // 这里只刷新 instance 数量和矩阵，是为了避免每次相机移动都把 InstancedMesh 整体重建一遍。
      existing.spec = group.spec
      refreshGroundFlatChunkBatchInstances(existing, definition, group.keys)
      nextBatches.set(specKey, existing)
      return
    }

    // 只有首次出现的规格才新建 geometry + InstancedMesh。
    // 这意味着绝大多数 chunk 进入缓存后，后续只是换矩阵，不再重复分配大块几何资源。
    const geometry = buildFlatGroundChunkGeometry(group.spec, Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1)
    const mesh = new THREE.InstancedMesh(geometry, material, group.keys.length)
    mesh.name = `GroundFlatChunks:${specKey}`
    mesh.receiveShadow = true
    mesh.castShadow = state.castShadow
    mesh.userData.dynamicMeshType = 'Ground'
    mesh.userData.groundChunkBatch = {
      specKey,
      chunkKeys: [...group.keys],
    }

    const batch: GroundFlatChunkBatchRuntime = {
      specKey,
      spec: group.spec,
      mesh,
      chunkKeys: [],
    }
    refreshGroundFlatChunkBatchInstances(batch, definition, group.keys)
    root.add(mesh)
    nextBatches.set(specKey, batch)
  })

  state.flatChunkBatches.forEach((batch, specKey) => {
    if (!nextBatches.has(specKey)) {
      // 本帧不再需要的平坦批次直接释放，避免它们在场景树里残留并继续参与渲染/拾取。
      disposeGroundFlatChunkBatch(batch)
    }
  })
  state.flatChunkBatches = nextBatches
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

  runtime.mesh.removeFromParent()
  runtime.mesh.visible = false
  bucket.push(runtime.mesh)
  state.meshPool.set(key, bucket)
}

function ensureChunkMesh(
  root: THREE.Group,
  state: GroundRuntimeState,
  definition: GroundRuntimeDynamicMesh,
  chunkRow: number,
  chunkColumn: number,
): GroundChunkRuntime {
  const key = groundChunkKey(chunkRow, chunkColumn)
  const existing = state.chunks.get(key)
  if (existing) {
    return existing
  }
  const spec = computeChunkSpec(definition, chunkRow, chunkColumn)
  let material = resolveGroundRuntimeMaterial(root, state)

  // Fallback placeholder (shared material should be set/cached by SceneGraph/editor).
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      color: '#707070',
      roughness: 1.0,
      metalness: 0.1,
    })
  }

  const poolKey = chunkPoolKey(spec)
  const pool = state.meshPool.get(poolKey)
  const pooledMesh = pool && pool.length ? pool.pop() : undefined
  if (pool && pool.length === 0) {
    state.meshPool.delete(poolKey)
  }

  const mesh = pooledMesh ?? new THREE.Mesh(buildGroundChunkGeometry(definition, spec), material)
  if (mesh.material !== material) {
    mesh.material = material
  }

  // If we reused a pooled mesh, refresh its geometry for the new chunk spec.
  if (pooledMesh) {
    const bufferGeometry = mesh.geometry
    if (bufferGeometry instanceof THREE.BufferGeometry) {
      const ok = updateChunkGeometry(bufferGeometry, definition, spec)
      if (!ok) {
        bufferGeometry.dispose()
        mesh.geometry = buildGroundChunkGeometry(definition, spec)
      }
    } else {
      mesh.geometry = buildGroundChunkGeometry(definition, spec)
    }
  }

  mesh.name = `GroundChunk:${chunkRow},${chunkColumn}`
  mesh.receiveShadow = true
  mesh.castShadow = state.castShadow
  mesh.userData.dynamicMeshType = 'Ground'
  mesh.userData.groundChunk = { ...spec, chunkRow, chunkColumn }
  mesh.visible = true
  root.add(mesh)
  const runtime: GroundChunkRuntime = { key, chunkRow, chunkColumn, spec, mesh }
  state.chunks.set(key, runtime)
  return runtime
}

function disposeChunk(runtime: GroundChunkRuntime): void {
  try {
    runtime.mesh.geometry?.dispose?.()
  } catch (_error) {
    /* noop */
  }
  runtime.mesh.removeFromParent()
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
  definition.planningHeightMap = createGroundHeightMap(gridSize.rows, gridSize.columns)
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
  const spanMeters = resolveGroundWorkingSpanMeters(definition)
  const halfWidth = spanMeters * 0.5
  const halfDepth = spanMeters * 0.5
  const cellSize = definition.cellSize
  const gridSize = resolveGroundWorkingGridSize(definition)
  const columns = gridSize.columns
  const rows = gridSize.rows

  // Point is in local coordinates
  const localX = point.x
  const localZ = point.z

  const sculptPolygonContour = shape === 'polygon'
    ? (polygonPoints ?? []).map((polygonPoint) => polygonPoint.clone())
    : []
  const normalizedPolygon = shape === 'polygon' ? normalizeSculptPolygonPointsXZ(sculptPolygonContour) : []
  if (shape === 'polygon' && normalizedPolygon.length < 3) {
    return false
  }

  const polygonBounds = computeSculptPolygonBounds(normalizedPolygon)

  const minCol = shape === 'polygon'
    ? Math.floor((polygonBounds.minX + halfWidth) / cellSize)
    : Math.floor((localX - radius + halfWidth) / cellSize)
  const maxCol = shape === 'polygon'
    ? Math.ceil((polygonBounds.maxX + halfWidth) / cellSize)
    : Math.ceil((localX + radius + halfWidth) / cellSize)
  const minRow = shape === 'polygon'
    ? Math.floor((polygonBounds.minZ + halfDepth) / cellSize)
    : Math.floor((localZ - radius + halfDepth) / cellSize)
  const maxRow = shape === 'polygon'
    ? Math.ceil((polygonBounds.maxZ + halfDepth) / cellSize)
    : Math.ceil((localZ + radius + halfDepth) / cellSize)

  let modified = false
  let heightMap = definition.manualHeightMap

  if (shape === 'polygon') {
    if (operation === 'raise' || operation === 'depress') {
      const subsampled = applyPolygonRaiseDepressSubsampled(definition, heightMap, polygonBounds, normalizedPolygon, {
        operation,
        strength,
        depth,
        slope,
      })
      if (subsampled) {
        definition.manualHeightMap = heightMap
        return true
      }
    }

    if ((operation === 'smooth' || operation === 'flatten' || operation === 'flatten-zero') && applyPolygonSurfaceSubsampled(definition, heightMap, polygonBounds, normalizedPolygon, {
      operation,
      strength,
      targetHeight,
    })) {
      definition.manualHeightMap = heightMap
      return true
    }

    const polygonCandidates: Array<{
      row: number
      col: number
      boundaryDistance: number
      currentHeight: number
    }> = []
    let maxBoundaryDistance = 0

    for (let row = Math.max(0, minRow); row <= Math.min(rows, maxRow); row++) {
      for (let col = Math.max(0, minCol); col <= Math.min(columns, maxCol); col++) {
        const x = -halfWidth + col * cellSize
        const z = -halfDepth + row * cellSize
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

      setGroundCoverageHeightOverrideForEffectiveValue(definition, heightMap, row, col, -halfWidth + col * cellSize, -halfDepth + row * cellSize, nextHeight)
      modified = true
    }

    if (modified) {
      definition.manualHeightMap = heightMap
    }
    return modified
  }

  if ((operation === 'raise' || operation === 'depress') && applyCircularRaiseDepressSubsampled(definition, heightMap, {
    point,
    radius,
    strength,
    operation,
  })) {
    definition.manualHeightMap = heightMap
    return true
  }

  if ((operation === 'smooth' || operation === 'flatten' || operation === 'flatten-zero') && applyCircularSurfaceSubsampled(definition, heightMap, {
    point,
    radius,
    strength,
    operation,
    targetHeight,
  })) {
    definition.manualHeightMap = heightMap
    return true
  }

  for (let row = Math.max(0, minRow); row <= Math.min(rows, maxRow); row++) {
    for (let col = Math.max(0, minCol); col <= Math.min(columns, maxCol); col++) {
      const x = -halfWidth + col * cellSize
      const z = -halfDepth + row * cellSize

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

      setGroundCoverageHeightOverrideForEffectiveValue(definition, heightMap, row, col, x, z, nextHeight)
      modified = true
    }
  }
  if (operation === 'flatten-zero') {
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
          const x = -halfWidth + col * cellSize
          const z = -halfDepth + row * cellSize
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
          const currentHeight = resolveGroundEffectiveHeightAtVertex(definition, row, col)
          const average = sampleNeighborAverage(definition, row, col, rows, columns)
          const smoothedHeight = currentHeight + (average - currentHeight) * smoothingFactor
          setGroundCoverageHeightOverrideForEffectiveValue(definition, heightMap, row, col, x, z, smoothedHeight)
          modified = true
        }
      }
    }
  }
  if (modified) {
    definition.manualHeightMap = heightMap
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

  const spanMeters = resolveGroundWorkingSpanMeters(definition)
  const halfWidth = spanMeters * 0.5
  const halfDepth = spanMeters * 0.5
  const cellSize = definition.cellSize
  const heightRegion = sampleGroundEffectiveHeightRegion(definition, 0, rows, 0, columns)
  const heightValues = heightRegion.values
  const heightStride = heightRegion.stride

  let vertexIndex = 0
  for (let row = 0; row <= rows; row += 1) {
    const z = -halfDepth + row * cellSize
    const heightOffset = row * heightStride
    for (let column = 0; column <= columns; column += 1) {
      const x = -halfWidth + column * cellSize
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

type GroundTextureMetadata = { groundDynamic?: boolean }

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

function applyGroundTextureToMaterial(material: THREE.Material, definition: GroundDynamicMesh): void {
  const typed = material as THREE.MeshStandardMaterial & { map?: THREE.Texture | null; needsUpdate?: boolean }
  if (!('map' in typed)) {
    return
  }

  const previousTexture = typed.map ?? null
  const wasDynamicTextureApplied = isDynamicGroundTexture(previousTexture)
  if (definition.textureDataUrl && wasDynamicTextureApplied) {
    disposeGroundTexture(previousTexture)
  }

  if (!definition.textureDataUrl) {
    if (wasDynamicTextureApplied) {
      disposeGroundTexture(previousTexture)
      typed.map = null
      typed.needsUpdate = true
    }
    return
  }

  const texture = textureLoader.load(definition.textureDataUrl, () => {
    typed.needsUpdate = true
  })
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = Math.min(16, texture.anisotropy || 8)
  texture.name = definition.textureName ?? 'GroundTexture'
  markDynamicGroundTexture(texture)
  typed.map = texture
  typed.needsUpdate = true
}

function applyGroundTextureToObject(object: THREE.Object3D, definition: GroundDynamicMesh): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    const material = mesh.material
    if (Array.isArray(material)) {
      material.forEach((entry) => entry && applyGroundTextureToMaterial(entry, definition))
    } else if (material) {
      applyGroundTextureToMaterial(material, definition)
    }
  })
}

export function applyGroundTextureToGroundObject(object: THREE.Object3D, definition: GroundDynamicMesh): void {
  applyGroundTextureToObject(object, definition)
}

export type GroundGeometryUpdateRegion = {
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
}

function updateChunkGeometry(geometry: THREE.BufferGeometry, definition: GroundRuntimeDynamicMesh, spec: GroundChunkSpec): boolean {
  const optimizedChunk = resolveOptimizedChunkForSpec(definition, spec)
  if (optimizedChunk) {
    return applyGroundOptimizedChunkGeometry(geometry, optimizedChunk)
  }

  const gridSize = resolveGroundWorkingGridSize(definition)
  const columns = gridSize.columns
  const rows = gridSize.rows
  const layout = resolveGroundChunkGeometryLayout(definition, spec)
  const chunkColumns = layout.segmentColumns
  const chunkRows = layout.segmentRows
  const expectedVertexCount = (chunkColumns + 1) * (chunkRows + 1)
  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
  const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!positionAttr || !normalAttr || !uvAttr || positionAttr.count !== expectedVertexCount || normalAttr.count !== expectedVertexCount || uvAttr.count !== expectedVertexCount) {
    return false
  }
  const spanMeters = resolveGroundWorkingSpanMeters(definition)
  const halfWidth = spanMeters * 0.5
  const halfDepth = spanMeters * 0.5
  const startX = -halfWidth + spec.startColumn * definition.cellSize
  const startZ = -halfDepth + spec.startRow * definition.cellSize
  const heightRegion = sampleGroundEffectiveHeightRegionWithoutLocalEdit(
    definition,
    spec.startRow,
    spec.startRow + spec.rows,
    spec.startColumn,
    spec.startColumn + spec.columns,
  )
  const heightValues = heightRegion.values
  const heightStride = heightRegion.stride

  let vertexIndex = 0
  for (let localRow = 0; localRow <= chunkRows; localRow += 1) {
    const z = startZ + localRow * layout.stepZ
    for (let localColumn = 0; localColumn <= chunkColumns; localColumn += 1) {
      const x = startX + localColumn * layout.stepX
      const height = heightValues[localRow * heightStride + localColumn] ?? sampleGroundHeight(definition, x, z)
      const columnRatio = columns === 0 ? 0 : clampInclusive((x + halfWidth) / Math.max(spanMeters, Number.EPSILON), 0, 1)
      const rowRatio = rows === 0 ? 0 : clampInclusive((z + halfDepth) / Math.max(spanMeters, Number.EPSILON), 0, 1)
      positionAttr.setXYZ(vertexIndex, x, height, z)
      uvAttr.setXY(vertexIndex, columnRatio, 1 - rowRatio)
      vertexIndex += 1
    }
  }
  positionAttr.needsUpdate = true
  computeHeightfieldNormals(positionAttr.array as Float32Array, normalAttr.array as Float32Array, chunkRows, chunkColumns, layout.stepX, layout.stepZ)
  normalAttr.needsUpdate = true
  uvAttr.needsUpdate = true
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return true
}

function updateChunkGeometryRegion(
  geometry: THREE.BufferGeometry,
  definition: GroundRuntimeDynamicMesh,
  spec: GroundChunkSpec,
  region: GroundGeometryUpdateRegion,
  options: { computeNormals?: boolean } = {},
): boolean {
  const optimizedChunk = resolveOptimizedChunkForSpec(definition, spec)
  if (optimizedChunk) {
    return applyGroundOptimizedChunkGeometry(geometry, optimizedChunk)
  }

  const layout = resolveGroundChunkGeometryLayout(definition, spec)
  const chunkColumns = Math.max(1, Math.trunc(layout.segmentColumns))
  const chunkRows = Math.max(1, Math.trunc(layout.segmentRows))
  const vertexColumns = chunkColumns + 1
  const expectedVertexCount = (chunkColumns + 1) * (chunkRows + 1)
  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
  const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!positionAttr || !normalAttr || !uvAttr || positionAttr.count !== expectedVertexCount || normalAttr.count !== expectedVertexCount || uvAttr.count !== expectedVertexCount) {
    return false
  }

  const spanMeters = resolveGroundWorkingSpanMeters(definition)
  const halfWidth = spanMeters * 0.5
  const halfDepth = spanMeters * 0.5
  const cellSize = definition.cellSize
  const startX = -halfWidth + spec.startColumn * cellSize
  const startZ = -halfDepth + spec.startRow * cellSize
  const chunkMaxX = startX + chunkColumns * layout.stepX
  const chunkMaxZ = startZ + chunkRows * layout.stepZ

  const regionStartRow = clampInclusive(region.minRow, spec.startRow, spec.startRow + spec.rows)
  const regionEndRow = clampInclusive(region.maxRow, spec.startRow, spec.startRow + spec.rows)
  const regionStartColumn = clampInclusive(region.minColumn, spec.startColumn, spec.startColumn + spec.columns)
  const regionEndColumn = clampInclusive(region.maxColumn, spec.startColumn, spec.startColumn + spec.columns)

  const updateMinX = -halfWidth + regionStartColumn * cellSize
  const updateMaxX = -halfWidth + regionEndColumn * cellSize
  const updateMinZ = -halfDepth + regionStartRow * cellSize
  const updateMaxZ = -halfDepth + regionEndRow * cellSize

  const startLocalColumn = clampInclusive(Math.floor((Math.max(startX, updateMinX) - startX) / layout.stepX), 0, chunkColumns)
  const endLocalColumn = clampInclusive(Math.ceil((Math.min(chunkMaxX, updateMaxX) - startX) / layout.stepX), 0, chunkColumns)
  const startLocalRow = clampInclusive(Math.floor((Math.max(startZ, updateMinZ) - startZ) / layout.stepZ), 0, chunkRows)
  const endLocalRow = clampInclusive(Math.ceil((Math.min(chunkMaxZ, updateMaxZ) - startZ) / layout.stepZ), 0, chunkRows)

  if (startLocalColumn > endLocalColumn || startLocalRow > endLocalRow) {
    return true
  }

  for (let localRow = startLocalRow; localRow <= endLocalRow; localRow += 1) {
    const z = startZ + localRow * layout.stepZ
    for (let localColumn = startLocalColumn; localColumn <= endLocalColumn; localColumn += 1) {
      const x = startX + localColumn * layout.stepX
      const vertexIndex = localRow * vertexColumns + localColumn
      const height = sampleGroundHeight(definition, x, z)
      positionAttr.setXYZ(vertexIndex, x, height, z)
    }
  }
  positionAttr.needsUpdate = true
  if (options.computeNormals !== false) {
    computeHeightfieldNormals(positionAttr.array as Float32Array, normalAttr.array as Float32Array, chunkRows, chunkColumns, layout.stepX, layout.stepZ)
    normalAttr.needsUpdate = true
  }
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return true
}

function refreshChunkRuntimeGeometry(
  runtime: GroundChunkRuntime,
  definition: GroundRuntimeDynamicMesh,
  options: {
    region?: GroundGeometryUpdateRegion
    computeNormals?: boolean
  } = {},
): boolean {
  const currentGeometry = runtime.mesh.geometry
  if (!(currentGeometry instanceof THREE.BufferGeometry)) {
    runtime.mesh.geometry = buildGroundChunkGeometry(definition, runtime.spec)
    return true
  }
  const updated = options.region
    ? updateChunkGeometryRegion(currentGeometry, definition, runtime.spec, options.region, { computeNormals: options.computeNormals })
    : updateChunkGeometry(currentGeometry, definition, runtime.spec)
  if (updated) {
    return true
  }
  currentGeometry.dispose()
  runtime.mesh.geometry = buildGroundChunkGeometry(definition, runtime.spec)
  return true
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
  group.userData.groundChunked = true
  ensureGroundRuntimeState(group, runtimeDefinition)
  const cellSize = Number.isFinite(runtimeDefinition.cellSize) && runtimeDefinition.cellSize > 0 ? runtimeDefinition.cellSize : 1
  const seedRadius = Math.max(50, resolveRuntimeChunkCells(runtimeDefinition) * cellSize * 1.5)
  updateGroundChunks(group, runtimeDefinition, null, { radius: seedRadius })
  applyGroundTextureToObject(group, runtimeDefinition)
  return group
}

export function setGroundMaterial(target: THREE.Object3D, material: THREE.Material | THREE.Material[]): void {
  const resolvedMaterial = Array.isArray(material) ? material[0] : material
  if (!resolvedMaterial) {
    return
  }

  const userData = (target.userData ??= {}) as Record<string, unknown>
  userData.groundMaterial = resolvedMaterial

  target.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      mesh.material = resolvedMaterial
    }
  })
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
  const now = Date.now()
  const force = options.force === true
  const minIntervalMs = Math.max(0, Math.trunc(Number.isFinite(options.minIntervalMs as number) ? (options.minIntervalMs as number) : 120))

  const chunkCells = state.chunkCells
  // cellSize 是单个网格单元在世界坐标里的尺寸。
  // 后面所有 loadRadius / unloadRadius / chunk 中心点位置，都要乘这个值才能从“格子数”换成“米”。
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1

  let localX = 0
  let localZ = 0
  const visibleWindow = camera ? resolveInfiniteGroundVisibleChunkWindow(root, definition, camera) : null
  const loadRadius = visibleWindow
    ? Math.max(1, Math.max(
      (visibleWindow.maxChunkX - visibleWindow.minChunkX + 1) * 0.5,
      (visibleWindow.maxChunkZ - visibleWindow.minChunkZ + 1) * 0.5,
    ) * Math.max(1, chunkCells) * cellSize)
    : (typeof options.radius === 'number' && Number.isFinite(options.radius) && options.radius > 0
      ? options.radius
      : resolveGroundChunkRadius(definition))

  // unloadRadius 比 loadRadius 稍大一圈，目的是给相机微小抖动和边界切换留缓冲。
  // 如果两者完全一致，chunk 会在边缘来回创建/销毁，表现成明显的闪烁和抖动。
  const unloadRadius = loadRadius + Math.max(1, chunkCells) * cellSize

  if (camera) {
    root.updateMatrixWorld(true)
    const cameraWorld = new THREE.Vector3()
    camera.getWorldPosition(cameraWorld)
    const cameraLocal = root.worldToLocal(cameraWorld)
    localX = cameraLocal.x
    localZ = cameraLocal.z
  }

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

  const spanMeters = resolveGroundWorkingSpanMeters(definition)
  const halfWidth = spanMeters * 0.5
  const halfDepth = spanMeters * 0.5
  const minLoadChunkColumn = visibleWindow
    ? normalizeChunkColumn(visibleWindow.minChunkX)
    : normalizeChunkColumn(Math.floor((localX - loadRadius + halfWidth) / cellSize / chunkCells))
  const maxLoadChunkColumn = visibleWindow
    ? normalizeChunkColumn(visibleWindow.maxChunkX)
    : normalizeChunkColumn(Math.floor((localX + loadRadius + halfWidth) / cellSize / chunkCells))
  const minLoadChunkRow = visibleWindow
    ? normalizeChunkRow(visibleWindow.minChunkZ)
    : normalizeChunkRow(Math.floor((localZ - loadRadius + halfDepth) / cellSize / chunkCells))
  const maxLoadChunkRow = visibleWindow
    ? normalizeChunkRow(visibleWindow.maxChunkZ)
    : normalizeChunkRow(Math.floor((localZ + loadRadius + halfDepth) / cellSize / chunkCells))

  const minUnloadChunkColumn = visibleWindow
    ? normalizeChunkColumn(visibleWindow.minChunkX - 1)
    : normalizeChunkColumn(Math.floor((localX - unloadRadius + halfWidth) / cellSize / chunkCells))
  const maxUnloadChunkColumn = visibleWindow
    ? normalizeChunkColumn(visibleWindow.maxChunkX + 1)
    : normalizeChunkColumn(Math.floor((localX + unloadRadius + halfWidth) / cellSize / chunkCells))
  const minUnloadChunkRow = visibleWindow
    ? normalizeChunkRow(visibleWindow.minChunkZ - 1)
    : normalizeChunkRow(Math.floor((localZ - unloadRadius + halfDepth) / cellSize / chunkCells))
  const maxUnloadChunkRow = visibleWindow
    ? normalizeChunkRow(visibleWindow.maxChunkZ + 1)
    : normalizeChunkRow(Math.floor((localZ + unloadRadius + halfDepth) / cellSize / chunkCells))

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
    Math.round(loadRadius * 1000),
    visibleWindow ? `${visibleWindow.centerCoord.chunkX}:${visibleWindow.centerCoord.chunkZ}:${visibleWindow.minChunkX}:${visibleWindow.maxChunkX}:${visibleWindow.minChunkZ}:${visibleWindow.maxChunkZ}` : 'no-visible-window',
    state.hiddenChunkKeysVersion,
  ].join('|')
  // 这个 signature 是“当前应该保留哪些 chunk”的摘要；只要它变了，就说明窗口发生了实质变化。
  const desiredWindowChanged = nextDesiredSignature !== state.desiredSignature
  const hasPendingWork = state.pendingCreates.length > 0 || state.pendingDestroys.length > 0
  let desiredFlatChunkGroups: Map<string, { spec: GroundChunkSpec; keys: string[] }> | null = null

  // Force mode should at least guarantee the camera's core chunk exists.
  let allowBypassInterval = false
  if (force && camera) {
    // force 模式下至少确保相机正下方的核心 chunk 已经存在，避免强刷时先出现空洞。
    // 这条逻辑的目的不是优化，而是保证调试、手动刷新或初始化时“中心不会缺块”。
    const cameraColumn = Math.floor((localX + halfWidth) / cellSize)
    const cameraRow = Math.floor((localZ + halfDepth) / cellSize)
    const cameraChunkColumn = normalizeChunkColumn(Math.floor(cameraColumn / chunkCells))
    const cameraChunkRow = normalizeChunkRow(Math.floor(cameraRow / chunkCells))
    const coreKey = groundChunkKey(cameraChunkRow, cameraChunkColumn)
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

  // Rebuild pending queues when the desired window changes.
  if (force || nextDesiredSignature !== state.desiredSignature) {
    // 只有当目标窗口真的变化时，才重建创建/销毁队列。
    // 这样可以把“持续加载”与“窗口变化”分离开，避免每一帧都重新排序整个 chunk 集合。
    state.desiredSignature = nextDesiredSignature

    // Create queue (nearest-first).
    // 创建队列按距离从近到远排序，保证相机附近优先出现内容，远处 chunk 可以稍后再补。
    const creates: Array<{ key: GroundChunkKey; chunkRow: number; chunkColumn: number; priority: number; distSq: number }> = []
    const flatChunkGroups = new Map<string, { spec: GroundChunkSpec; keys: string[] }>()
    const transitionToFlatKeys = new Set<string>()

    // Prefer a 3x3 core around the camera chunk in force mode.
    let forceCore: Set<string> | null = null
    if (force && camera) {
      // forceCore 是一个 3x3 核心区优先集合：调试或强刷时先保中心，再补外围。
      // 这样即使预算很小，也能先让相机周围看起来“站稳”，而不是先加载远处 chunk。
      const cameraColumn = Math.floor((localX + halfWidth) / cellSize)
      const cameraRow = Math.floor((localZ + halfDepth) / cellSize)
      const cameraChunkColumn = normalizeChunkColumn(Math.floor(cameraColumn / chunkCells))
      const cameraChunkRow = normalizeChunkRow(Math.floor(cameraRow / chunkCells))
      forceCore = new Set<string>()
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const cr = cameraChunkRow + dr
          const cc = cameraChunkColumn + dc
          if (cr < minLoadChunkRow || cr > maxLoadChunkRow || cc < minLoadChunkColumn || cc > maxLoadChunkColumn) {
            continue
          }
          forceCore.add(groundChunkKey(cr, cc))
        }
      }
    }

    for (let cr = minLoadChunkRow; cr <= maxLoadChunkRow; cr += 1) {
      for (let cc = minLoadChunkColumn; cc <= maxLoadChunkColumn; cc += 1) {
        const key = groundChunkKey(cr, cc)
        // 已经存在的 chunk 或被隐藏的 chunk，不应该再次进入创建队列。
        if (state.chunks.has(key) || state.hiddenChunkKeys.has(key)) {
          continue
        }

        const spec = computeChunkSpec(definition, cr, cc)
        // 先算出这个 chunk 的中心点位置，再与相机位置比较，用于创建优先级排序。
        const centerX = -halfWidth + (spec.startColumn + spec.columns * 0.5) * cellSize
        const centerZ = -halfDepth + (spec.startRow + spec.rows * 0.5) * cellSize
        const dx = centerX - localX
        const dz = centerZ - localZ
        const priority = forceCore && forceCore.has(key) ? -1 : 0
        if (chunkIntersectsGroundLocalEditTile(definition, spec)) {
          // 只要这个 chunk 覆盖到了局部雕刻瓦片，就必须走独立 Mesh 路径，不能并入平面实例批次。
          // 因为一旦并入实例批次，单独的雕刻编辑就无法只改这一块，而必须把整批都拆开，代价更高。
          creates.push({ key, chunkRow: cr, chunkColumn: cc, priority, distSq: dx * dx + dz * dz })
        } else {
          // 没有局部雕刻的 chunk 进入 flat 分组，后续会被合并成 InstancedMesh 批次。
          // 这就是 hybrid 方案的关键：大部分地形走快路径，只有少量被编辑过的区域保留慢路径。
          if (state.chunks.has(key)) {
            transitionToFlatKeys.add(key)
          }
          // flat chunk 按 spec 分组，是为了让相同尺寸的 chunk 共用一套 InstancedMesh 几何。
          const specKey = chunkPoolKey(spec)
          const entry = flatChunkGroups.get(specKey)
          if (entry) {
            entry.keys.push(key)
          } else {
            flatChunkGroups.set(specKey, {
              spec,
              keys: [key],
            })
          }
        }
      }
    }

    creates.sort((a, b) => (a.priority - b.priority) || (a.distSq - b.distSq))
    state.pendingCreates = creates
    // flat 分组不直接创建 Mesh，而是先收集起来，后面统一交给 syncGroundFlatChunkBatches(...) 同步。
    desiredFlatChunkGroups = flatChunkGroups

    transitionToFlatKeys.forEach((key) => {
      // 当 chunk 从独立 Mesh 退回平面实例时，必须先释放旧 Mesh，避免同一块地形同时存在两份渲染对象。
      // 这个步骤如果漏掉，会出现“画面看起来没问题，但内存/渲染数量一直上涨”的隐性问题。
      const runtime = state.chunks.get(key)
      if (!runtime) {
        return
      }
      releaseChunkToPool(state, runtime)
      state.chunks.delete(key)
    })

    // Destroy queue (farthest-first outside unload radius).
    // 卸载队列按距离从远到近排序，优先删除最远的 chunk，保留相机附近的内容。
    const destroys: Array<{ key: GroundChunkKey; distSq: number }> = []
    state.chunks.forEach((entry, key) => {
      if (state.hiddenChunkKeys.has(key)) {
        // 隐藏的 chunk 直接视为“必须卸载”，并给一个无穷大距离，确保它们总是最先被清理。
        destroys.push({ key, distSq: Number.POSITIVE_INFINITY })
        return
      }
      if (
        entry.chunkRow >= minUnloadChunkRow &&
        entry.chunkRow <= maxUnloadChunkRow &&
        entry.chunkColumn >= minUnloadChunkColumn &&
        entry.chunkColumn <= maxUnloadChunkColumn
      ) {
        // 落在卸载缓冲区里的 chunk 继续保留，避免相机稍微挪动时立刻把它删掉。
        return
      }
      const spec = entry.spec
      // 对于真正要卸载的 chunk，再按它的中心点与相机距离排序，越远越先删。
      const centerX = -halfWidth + (spec.startColumn + spec.columns * 0.5) * cellSize
      const centerZ = -halfDepth + (spec.startRow + spec.rows * 0.5) * cellSize
      const dx = centerX - localX
      const dz = centerZ - localZ
      destroys.push({ key, distSq: dx * dx + dz * dz })
    })
    destroys.sort((a, b) => b.distSq - a.distSq)
    state.pendingDestroys = destroys
  } else {
    // Drop stale pending work.
    // 如果窗口没变，就只清理那些因为外部状态变化而变得不再有效的待处理项，不重新构建整个队列。
    if (state.pendingCreates.length) {
      state.pendingCreates = state.pendingCreates.filter((entry) => !state.chunks.has(entry.key))
    }
    if (state.pendingDestroys.length) {
      state.pendingDestroys = state.pendingDestroys.filter((entry) => state.chunks.has(entry.key))
    }
  }

  if (desiredFlatChunkGroups) {
    // 每次窗口变化后，同步 flat 批次，这一步决定了“平铺延伸”的实际可见范围。
    // 如果这里不更新，chunk 可能已经创建/删除了，但平面实例还停留在旧位置，看起来就像“地形不跟着相机走”。
    syncGroundFlatChunkBatches(root, state, definition, desiredFlatChunkGroups)
  }

  const defaultBudget: GroundChunkBudget | null = camera
    ? ({ maxCreatePerUpdate: 6, maxDestroyPerUpdate: 8 } satisfies GroundChunkBudget)
    : null
  // 没有显式预算时，给摄像机驱动的更新一个保守默认值：
  // 创建数量不要太大，否则会卡；销毁数量也不要太大，否则会导致边缘内容瞬间消失。
  const effectiveBudget: GroundChunkBudget | null = options.budget === undefined ? defaultBudget : (options.budget as GroundChunkBudget | null)
  const maxCreate = effectiveBudget ? (Number.isFinite(effectiveBudget.maxCreatePerUpdate as number) ? Math.max(0, Math.trunc(effectiveBudget.maxCreatePerUpdate as number)) : Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY
  const maxDestroy = effectiveBudget ? (Number.isFinite(effectiveBudget.maxDestroyPerUpdate as number) ? Math.max(0, Math.trunc(effectiveBudget.maxDestroyPerUpdate as number)) : Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY
  const maxMs = effectiveBudget ? (Number.isFinite(effectiveBudget.maxMs as number) ? Math.max(0, Number(effectiveBudget.maxMs)) : Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY
  const budgetStart = Date.now()

  // 这个闭包把“预算剩余时间”统一成一个判断，后面创建/卸载都能复用。
  const withinTimeBudget = () => (Date.now() - budgetStart) <= maxMs

  // Load chunks within the tighter load radius (nearest-first).
  // 下面开始真正执行队列：先创建，再卸载。
  // 这样做的好处是窗口变化时优先补内容，避免先删后建导致地形短暂空洞。
  let stitchRegion: GroundGeometryUpdateRegion | null = null
  const touchedChunkKeys = new Set<string>()
  const mergeRegion = (current: GroundGeometryUpdateRegion | null, next: GroundGeometryUpdateRegion): GroundGeometryUpdateRegion => {
    if (!current) {
      return { ...next }
    }
    return {
      minRow: Math.min(current.minRow, next.minRow),
      maxRow: Math.max(current.maxRow, next.maxRow),
      minColumn: Math.min(current.minColumn, next.minColumn),
      maxColumn: Math.max(current.maxColumn, next.maxColumn),
    }
  }

  let createdCount = 0
  if (state.pendingCreates.length && maxCreate > 0) {
    const pending = state.pendingCreates
    let processed = 0
    for (processed = 0; processed < pending.length; processed += 1) {
      if (createdCount >= maxCreate || !withinTimeBudget()) {
        // 预算用完就停止创建，避免一帧内创建过多 chunk 导致卡顿。
        break
      }
      const entry = pending[processed]!
      if (state.chunks.has(entry.key)) {
        continue
      }
      const runtime = ensureChunkMesh(root, state, definition, entry.chunkRow, entry.chunkColumn)
      createdCount += 1
      touchedChunkKeys.add(runtime.key)

      // 新 chunk 创建后，记下它影响的地形区域，后面统一做法线 stitching。
      stitchRegion = mergeRegion(stitchRegion, {
        minRow: runtime.spec.startRow,
        maxRow: runtime.spec.startRow + Math.max(1, runtime.spec.rows),
        minColumn: runtime.spec.startColumn,
        maxColumn: runtime.spec.startColumn + Math.max(1, runtime.spec.columns),
      })
    }

    // Keep remaining items (and drop any that got created).
    // 已创建的条目从待创建列表中移除，剩下的继续留待下一帧处理。
    state.pendingCreates = pending
      .slice(processed)
      .filter((entry) => !state.chunks.has(entry.key))
  }

  // Unload chunks outside the unload radius with a budget.
  let destroyedCount = 0
  if (state.pendingDestroys.length && maxDestroy > 0) {
    const pending = state.pendingDestroys
    let processed = 0
    for (processed = 0; processed < pending.length; processed += 1) {
      if (destroyedCount >= maxDestroy || !withinTimeBudget()) {
        // 同样，卸载也受预算约束，防止一口气删太多 chunk 造成画面跳变或主线程抖动。
        break
      }
      const entry = pending[processed]!
      const runtime = state.chunks.get(entry.key)
      if (!runtime) {
        continue
      }
      // 先把 runtime 放回池子或释放资源，再从 state.chunks 中移除，避免引用悬空。
      releaseChunkToPool(state, runtime)
      state.chunks.delete(entry.key)
      destroyedCount += 1
    }
    // 卸载完成后，保留还没来得及处理的剩余项，等下一帧继续。
    state.pendingDestroys = pending
      .slice(processed)
      .filter((entry) => state.chunks.has(entry.key))
  }

  // Newly created chunks compute normals in isolation; stitch boundaries to avoid visible seams.
  if (stitchRegion) {
    // 新 chunk 是独立算法线的，边界上会天然有一点不连续；这里统一 stitching，避免块与块之间出现明暗断层。
    stitchGroundChunkNormals(root, definition, stitchRegion, touchedChunkKeys)
  }
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

export function updateGroundMesh(target: THREE.Object3D, definition: GroundDynamicMesh) {
  const runtimeDefinition = ensureGroundRuntimeDefinition(definition)
  if ((target as any)?.isMesh) {
    const mesh = target as THREE.Mesh
    if (!(mesh.geometry instanceof THREE.BufferGeometry)) {
      mesh.geometry = buildGroundGeometry(runtimeDefinition)
    }
    const bufferGeometry = mesh.geometry as THREE.BufferGeometry
    const updated = updateGroundGeometry(bufferGeometry, runtimeDefinition)
    if (!updated) {
      bufferGeometry.dispose()
      mesh.geometry = buildGroundGeometry(runtimeDefinition)
    }
    applyGroundTextureToObject(mesh, runtimeDefinition)
    return
  }

  const group = resolveGroundRuntimeGroup(target)
  if (!group) {
    return
  }
  ensureGroundRuntimeState(group, runtimeDefinition)
  updateGroundChunks(group, runtimeDefinition, null)
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

export function updateGroundMeshRegion(
  target: THREE.Object3D,
  definition: GroundRuntimeDynamicMesh,
  region: GroundGeometryUpdateRegion,
  options: { computeNormals?: boolean; touchedChunkKeys?: Iterable<string> | null } = {},
): boolean {
  const group = resolveGroundRuntimeGroup(target)
  if (!group) {
    return false
  }
  const state = groundRuntimeStateMap.get(group)
  if (!state) {
    return false
  }
  // touchedChunkKeys 表示“这次编辑真实波及到哪些 chunk”，比整块 region 扫描更精准。
  // region 只是一个大概范围，而 chunk key 才是能精确驱动重建、同步和 stitching 的最小单位。
  // 现在只保留无限地形语义，所以这里不再做任何 0..maxIndex 裁剪。
  const filteredChunkKeys = options.touchedChunkKeys
    ? Array.from(options.touchedChunkKeys).filter((key) => typeof key === 'string' && key.length > 0)
    : []
  let updated = false
  if (filteredChunkKeys.length) {
    const visited = new Set<string>()
    for (const key of filteredChunkKeys) {
      const indices = resolveRuntimeChunkIndexFromSharedKey(key)
      if (!indices) {
        continue
      }
      const runtimeKey = groundChunkKey(indices.row, indices.column)
      if (visited.has(runtimeKey)) {
        continue
      }
      visited.add(runtimeKey)
      const entry = state.chunks.get(runtimeKey)
      if (!entry) {
        continue
      }
      const ok = refreshChunkRuntimeGeometry(entry, definition, {
        region,
        computeNormals: options.computeNormals,
      })
      updated = updated || ok
    }
    return updated
  }
  state.chunks.forEach((entry) => {
    const overlaps = !(
      region.maxRow < entry.spec.startRow ||
      region.minRow > entry.spec.startRow + entry.spec.rows ||
      region.maxColumn < entry.spec.startColumn ||
      region.minColumn > entry.spec.startColumn + entry.spec.columns
    )
    if (!overlaps) {
      return
    }
    const ok = refreshChunkRuntimeGeometry(entry, definition, {
      region,
      computeNormals: options.computeNormals,
    })
    updated = updated || ok
  })
  return updated
}

export function ensureGroundChunkMeshesForKeys(
  target: THREE.Object3D,
  definition: GroundRuntimeDynamicMesh,
  chunkKeys: Iterable<string> | null | undefined,
): boolean {
  const group = resolveGroundRuntimeGroup(target)
  if (!group || !chunkKeys) {
    return false
  }

  const state = groundRuntimeStateMap.get(group) ?? ensureGroundRuntimeState(group, definition)
  // 这个接口给编辑器侧“按 key 预热 chunk”使用。
  // 现在 ground 已经只有无限模式，因此这里直接把 key 当作真实 chunk 坐标，不再进行边界裁剪。
  const visited = new Set<string>()
  let created = false

  for (const key of chunkKeys) {
    if (typeof key !== 'string' || key.length === 0) {
      continue
    }
    const indices = resolveRuntimeChunkIndexFromSharedKey(key)
    if (!indices) {
      continue
    }
    const runtimeKey = groundChunkKey(indices.row, indices.column)
    if (visited.has(runtimeKey)) {
      continue
    }
    visited.add(runtimeKey)
    if (state.chunks.has(runtimeKey)) {
      continue
    }
    ensureChunkMesh(group, state, definition, indices.row, indices.column)
    created = true
  }

  return created
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
  const directChunk = (target as any)?.userData?.groundChunk as { chunkRow?: number; chunkColumn?: number } | undefined
  if (directChunk && Number.isInteger(directChunk.chunkRow) && Number.isInteger(directChunk.chunkColumn)) {
    return groundChunkKey(directChunk.chunkRow as number, directChunk.chunkColumn as number)
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
  // 返回当前场景里已经可见的所有 chunk key，包括普通 chunk Mesh 和 flat InstancedMesh 批次。
  // 这个集合常被拾取、可见范围同步和调试工具复用，所以一定要同时覆盖两条渲染路径。
  const visibleKeys = new Set<string>(state.chunks.keys())
  state.flatChunkBatches.forEach((batch) => {
    batch.chunkKeys.forEach((key) => visibleKeys.add(key))
  })
  return Array.from(visibleKeys)
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
      nextHiddenChunkKeys.add(key)
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
  state.desiredSignature = ''
  state.pendingCreates = state.pendingCreates.filter((entry) => !nextHiddenChunkKeys.has(entry.key))
  state.flatChunkBatches.forEach((batch) => disposeGroundFlatChunkBatch(batch))
  state.flatChunkBatches.clear()
  state.chunks.forEach((runtime, key) => {
    if (!nextHiddenChunkKeys.has(key)) {
      return
    }
    releaseChunkToPool(state, runtime)
    state.chunks.delete(key)
  })
  return true
}

function averageNormalsOnEdge(params: {
  geometryA: THREE.BufferGeometry
  specA: GroundChunkSpec
  geometryB: THREE.BufferGeometry
  specB: GroundChunkSpec
  mode: 'right' | 'down'
}): boolean {
  const { geometryA, specA, geometryB, specB, mode } = params
  const normalAttrA = geometryA.getAttribute('normal') as THREE.BufferAttribute | undefined
  const normalAttrB = geometryB.getAttribute('normal') as THREE.BufferAttribute | undefined
  if (!normalAttrA || !normalAttrB) {
    return false
  }
  const normalsA = normalAttrA.array as Float32Array
  const normalsB = normalAttrB.array as Float32Array
  if (!(normalsA instanceof Float32Array) || !(normalsB instanceof Float32Array)) {
    return false
  }

  const colsA = Math.max(1, Math.trunc(specA.columns))
  const rowsA = Math.max(1, Math.trunc(specA.rows))
  const colsB = Math.max(1, Math.trunc(specB.columns))
  const rowsB = Math.max(1, Math.trunc(specB.rows))
  const vertexColumnsA = colsA + 1
  const vertexColumnsB = colsB + 1

  let touched = false
  if (mode === 'right') {
    const edgeColumnA = specA.startColumn + colsA
    if (edgeColumnA !== specB.startColumn) {
      return false
    }
    const rowStart = Math.max(specA.startRow, specB.startRow)
    const rowEnd = Math.min(specA.startRow + rowsA, specB.startRow + rowsB)
    for (let row = rowStart; row <= rowEnd; row += 1) {
      const localRowA = row - specA.startRow
      const localRowB = row - specB.startRow
      const idxA = localRowA * vertexColumnsA + colsA
      const idxB = localRowB * vertexColumnsB + 0
      const a3 = idxA * 3
      const b3 = idxB * 3
      if (a3 + 2 >= normalsA.length || b3 + 2 >= normalsB.length) {
        continue
      }
      const ax = normalsA[a3] ?? 0
      const ay = normalsA[a3 + 1] ?? 0
      const az = normalsA[a3 + 2] ?? 0
      const bx = normalsB[b3] ?? 0
      const by = normalsB[b3 + 1] ?? 0
      const bz = normalsB[b3 + 2] ?? 0
      let nx = ax + bx
      let ny = ay + by
      let nz = az + bz
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len
      ny /= len
      nz /= len
      normalsA[a3] = nx
      normalsA[a3 + 1] = ny
      normalsA[a3 + 2] = nz
      normalsB[b3] = nx
      normalsB[b3 + 1] = ny
      normalsB[b3 + 2] = nz
      touched = true
    }
  } else {
    const edgeRowA = specA.startRow + rowsA
    if (edgeRowA !== specB.startRow) {
      return false
    }
    const colStart = Math.max(specA.startColumn, specB.startColumn)
    const colEnd = Math.min(specA.startColumn + colsA, specB.startColumn + colsB)
    for (let col = colStart; col <= colEnd; col += 1) {
      const localColA = col - specA.startColumn
      const localColB = col - specB.startColumn
      const idxA = rowsA * vertexColumnsA + localColA
      const idxB = 0 * vertexColumnsB + localColB
      const a3 = idxA * 3
      const b3 = idxB * 3
      if (a3 + 2 >= normalsA.length || b3 + 2 >= normalsB.length) {
        continue
      }
      const ax = normalsA[a3] ?? 0
      const ay = normalsA[a3 + 1] ?? 0
      const az = normalsA[a3 + 2] ?? 0
      const bx = normalsB[b3] ?? 0
      const by = normalsB[b3 + 1] ?? 0
      const bz = normalsB[b3 + 2] ?? 0
      let nx = ax + bx
      let ny = ay + by
      let nz = az + bz
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len
      ny /= len
      nz /= len
      normalsA[a3] = nx
      normalsA[a3 + 1] = ny
      normalsA[a3 + 2] = nz
      normalsB[b3] = nx
      normalsB[b3 + 1] = ny
      normalsB[b3 + 2] = nz
      touched = true
    }
  }

  if (touched) {
    normalAttrA.needsUpdate = true
    normalAttrB.needsUpdate = true
  }
  return touched
}

export function stitchGroundChunkNormals(
  target: THREE.Object3D,
  definition: GroundRuntimeDynamicMesh,
  region: GroundGeometryUpdateRegion | null = null,
  touchedChunkKeys: Iterable<string> | null = null,
): boolean {
  const group = resolveGroundRuntimeGroup(target)
  if (!group) {
    return false
  }
  const state = groundRuntimeStateMap.get(group)
  if (!state) {
    return false
  }
  void definition

  const filteredChunkKeys = touchedChunkKeys ? Array.from(touchedChunkKeys).filter((key) => typeof key === 'string' && key.length > 0) : []
  if (filteredChunkKeys.length) {
    const visitedEdges = new Set<string>()
    const stitchEdge = (anchorRow: number, anchorColumn: number, mode: 'right' | 'down'): boolean => {
      // 只有相邻 chunk 都是独立 Mesh 时，边界法线拼接才有意义；flat 批次不参与这条流程。
      // flat chunk 没有独立雕刻边界，强行拼接只会让逻辑复杂但结果没有收益。
      const edgeKey = `${mode}:${anchorRow}:${anchorColumn}`
      if (visitedEdges.has(edgeKey)) {
        return false
      }
      visitedEdges.add(edgeKey)

      const current = state.chunks.get(groundChunkKey(anchorRow, anchorColumn))
      if (!current || !(current.mesh.geometry instanceof THREE.BufferGeometry)) {
        return false
      }

      const neighbor = mode === 'right'
        ? state.chunks.get(groundChunkKey(anchorRow, anchorColumn + 1))
        : state.chunks.get(groundChunkKey(anchorRow + 1, anchorColumn))
      if (!neighbor || !(neighbor.mesh.geometry instanceof THREE.BufferGeometry)) {
        return false
      }

      return averageNormalsOnEdge({
        geometryA: current.mesh.geometry,
        specA: current.spec,
        geometryB: neighbor.mesh.geometry,
        specB: neighbor.spec,
        mode,
      })
    }

    let stitched = false
    for (const key of filteredChunkKeys) {
      const indices = resolveRuntimeChunkIndexFromSharedKey(key)
      if (!indices) {
        continue
      }
      const row = indices.row
      const column = indices.column

      stitched = stitchEdge(row, column, 'right') || stitched
      stitched = stitchEdge(row, column, 'down') || stitched
      if (column > 0) {
        stitched = stitchEdge(row, column - 1, 'right') || stitched
      }
      if (row > 0) {
        stitched = stitchEdge(row - 1, column, 'down') || stitched
      }
    }
    return stitched
  }
  if (!region) {
    return false
  }

  // 目前 ground 只保留无限模式，因此没有“整网格批量扫描”的必要。
  // 没有 touchedChunkKeys 时，说明这次更新没有足够精确的 chunk 级信息可用于法线拼接。
  return false

  /*
  const minChunkRow = Math.floor(region.minRow / chunkCells) - 1
  const maxChunkRow = Math.floor(region.maxRow / chunkCells) + 1
  const minChunkColumn = Math.floor(region.minColumn / chunkCells) - 1
  const maxChunkColumn = Math.floor(region.maxColumn / chunkCells) + 1

  let stitched = false
  for (let r = minChunkRow; r <= maxChunkRow; r += 1) {
    for (let c = minChunkColumn; c <= maxChunkColumn; c += 1) {
      const current = state.chunks.get(groundChunkKey(r, c))
      if (!current) {
        continue
      }
      const geometryA = current.mesh.geometry
      if (!(geometryA instanceof THREE.BufferGeometry)) {
        continue
      }
      // Stitch with right neighbor.
      const right = state.chunks.get(groundChunkKey(r, c + 1))
      if (right && right.mesh.geometry instanceof THREE.BufferGeometry) {
        stitched = averageNormalsOnEdge({
          geometryA,
          specA: current.spec,
          geometryB: right.mesh.geometry,
          specB: right.spec,
          mode: 'right',
        }) || stitched
      }
      // Stitch with down neighbor.
      const down = state.chunks.get(groundChunkKey(r + 1, c))
      if (down && down.mesh.geometry instanceof THREE.BufferGeometry) {
        stitched = averageNormalsOnEdge({
          geometryA,
          specA: current.spec,
          geometryB: down.mesh.geometry,
          specB: down.spec,
          mode: 'down',
        }) || stitched
      }
    }
  }
  return stitched
  */
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
