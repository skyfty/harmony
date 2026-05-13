import * as THREE from 'three'

import {
  deserializeCompiledGroundCollisionTile,
  type CompiledGroundCollisionTileRecord,
  type CompiledGroundManifest,
} from './compiledGround'
import {
  RIGIDBODY_COMPONENT_TYPE,
  clampRigidbodyComponentProps,
  type RigidbodyComponentProps,
  type RigidbodyPhysicsShape,
  type SceneNode,
  type SceneNodeComponentState,
} from './index'
import type {
  PhysicsBodyBindingEntry as RigidbodyInstance,
  PhysicsBodyLike,
  PhysicsOrientationAdjustment,
} from './physicsBodySync'
import {
  type PhysicsWorldLike,
  addPhysicsBodyToWorld,
  removePhysicsBodyBindingBodies,
} from './physicsRuntimeBridge'

type HeightfieldShapeDefinition = Extract<RigidbodyPhysicsShape, { kind: 'heightfield' }>

export type CompiledGroundCollisionRuntimeState = {
  enabled: boolean
  sourceId: string
  revision: number
  signature: string
  tileKeys: string[]
}

type CompiledGroundCollisionRuntimeDeps = {
  getPhysicsWorld: () => PhysicsWorldLike | null
  ensurePhysicsWorld: () => PhysicsWorldLike
  createBody: (
    node: SceneNode,
    component: SceneNodeComponentState<RigidbodyComponentProps>,
    shapeDefinition: HeightfieldShapeDefinition | null,
    object: THREE.Object3D,
  ) => { body: PhysicsBodyLike; orientationAdjustment: PhysicsOrientationAdjustment | null } | null
  loggerTag?: string
}

type SyncCompiledGroundCollisionTilesParams = {
  enabled: boolean
  groundObject: THREE.Object3D
  camera: THREE.Camera | null | undefined
  sourceId: string
  revision: number
  manifest: CompiledGroundManifest
  loadTileData: (record: CompiledGroundCollisionTileRecord) => Promise<ArrayBuffer | null>
  activeRadiusTiles?: number
  retainRadiusTiles?: number
}

type PendingEntry = {
  signature: string
  promise: Promise<void>
}

function uniqueSortedKeys(keys: Iterable<string> | null | undefined): string[] {
  return Array.from(new Set(Array.from(keys ?? []).map((key) => key.trim()).filter((key) => key.length > 0))).sort()
}

export function collectCompiledGroundCollisionTileKeys(
  manifest: CompiledGroundManifest | null | undefined,
  runtimeLoadedTileKeys?: readonly string[] | null,
): string[] {
  const runtimeKeys = uniqueSortedKeys(runtimeLoadedTileKeys)
  if (runtimeKeys.length > 0) {
    return runtimeKeys
  }
  if (!manifest?.collisionTiles?.length) {
    return []
  }
  return uniqueSortedKeys(manifest.collisionTiles.map((tile) => tile.key))
}

export function resolveCompiledGroundCollisionRuntimeState(params: {
  enabled: boolean
  manifest: CompiledGroundManifest | null | undefined
  runtimeLoadedTileKeys?: readonly string[] | null
  sourceId: string
  revision: number
}): CompiledGroundCollisionRuntimeState {
  const tileKeys = params.enabled
    ? collectCompiledGroundCollisionTileKeys(params.manifest, params.runtimeLoadedTileKeys)
    : []
  return {
    enabled: params.enabled,
    sourceId: params.sourceId,
    revision: Math.max(0, Math.trunc(params.revision)),
    signature: [
      params.enabled ? 1 : 0,
      params.sourceId.trim(),
      Math.max(0, Math.trunc(params.revision)),
      tileKeys.join(','),
    ].join('|'),
    tileKeys,
  }
}

type CompiledGroundCollisionTileGridIndex = {
  rows: Map<number, Map<number, CompiledGroundCollisionTileRecord>>
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
}

export type CompiledGroundCollisionDebugEntry = {
  nodeId: string
  tileKey: string
  instance: RigidbodyInstance
  shapes: HeightfieldShapeDefinition[]
}

const cameraLocalHelper = new THREE.Vector3()
const compiledGroundCollisionTileGridIndexCache = new WeakMap<CompiledGroundManifest, CompiledGroundCollisionTileGridIndex>()

function buildColliderNode(tileKey: string): SceneNode {
  return {
    id: `__compiledGroundCollider:${tileKey}`,
    name: `Compiled Ground Collider ${tileKey}`,
    nodeType: 'Mesh',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
  } as SceneNode
}

function buildStaticRigidbodyComponent(tileKey: string): SceneNodeComponentState<RigidbodyComponentProps> {
  return {
    id: `__compiledGroundColliderComponent:${tileKey}`,
    type: RIGIDBODY_COMPONENT_TYPE,
    enabled: true,
    props: clampRigidbodyComponentProps({ bodyType: 'STATIC', mass: 0 }),
  }
}

function createCollisionProxy(groundObject: THREE.Object3D, centerX: number, centerZ: number): THREE.Object3D {
  const proxy = new THREE.Object3D()
  const center = new THREE.Vector3(centerX, 0, centerZ)
  groundObject.localToWorld(center)
  const worldPosition = new THREE.Vector3()
  const worldQuaternion = new THREE.Quaternion()
  const worldScale = new THREE.Vector3()
  groundObject.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale)
  proxy.position.copy(center)
  proxy.quaternion.copy(worldQuaternion)
  proxy.scale.copy(worldScale)
  proxy.updateMatrixWorld(true)
  return proxy
}

function buildHeightfieldShapeFromTileBuffer(
  record: CompiledGroundCollisionTileRecord,
  buffer: ArrayBuffer | null,
): { shapeDefinition: HeightfieldShapeDefinition; signature: string } | null {
  const decoded = deserializeCompiledGroundCollisionTile(buffer)
  if (!decoded) {
    return null
  }
  const { rows, columns, elementSize } = decoded.header
  const matrix: number[][] = []
  let hash = 0
  for (let column = 0; column <= columns; column += 1) {
    const columnValues: number[] = []
    for (let row = rows; row >= 0; row -= 1) {
      const height = decoded.heights[row * (columns + 1) + column] ?? 0
      columnValues.push(height)
      hash = (hash * 31 + Math.round(height * 1000)) >>> 0
    }
    matrix.push(columnValues)
  }
  const width = columns * elementSize
  const depth = rows * elementSize
  return {
    shapeDefinition: {
      kind: 'heightfield',
      matrix,
      elementSize,
      width,
      depth,
      offset: [-width * 0.5, -depth * 0.5, 0],
      applyScale: false,
    },
    signature: `${record.key}|${rows}|${columns}|${Math.round(elementSize * 1000)}|${Math.round(width * 1000)}|${Math.round(depth * 1000)}|${hash.toString(16)}`,
  }
}

function resolveDesiredCollisionTiles(
  groundObject: THREE.Object3D,
  manifest: CompiledGroundManifest,
  camera: THREE.Camera,
  activeRadiusTiles: number,
  retainRadiusTiles: number,
): {
  desired: CompiledGroundCollisionTileRecord[]
  retainedKeys: Set<string>
} {
  groundObject.updateWorldMatrix(true, false)
  camera.updateWorldMatrix(true, false)
  camera.getWorldPosition(cameraLocalHelper)
  groundObject.worldToLocal(cameraLocalHelper)
  const tileSize = Math.max(1e-6, manifest.collisionTileSizeMeters)
  const centerColumn = Math.floor((cameraLocalHelper.x - manifest.bounds.minX) / tileSize)
  const centerRow = Math.floor((cameraLocalHelper.z - manifest.bounds.minZ) / tileSize)
  const desired: Array<{ record: CompiledGroundCollisionTileRecord; distSq: number }> = []
  const retainedKeys = new Set<string>()
  for (const record of collectCompiledGroundCollisionTilesInRange(
    manifest,
    centerRow - retainRadiusTiles,
    centerRow + retainRadiusTiles,
    centerColumn - retainRadiusTiles,
    centerColumn + retainRadiusTiles,
  )) {
    const dr = record.row - centerRow
    const dc = record.column - centerColumn
    if (Math.abs(dr) <= retainRadiusTiles && Math.abs(dc) <= retainRadiusTiles) {
      retainedKeys.add(record.key)
    }
  }
  for (const record of collectCompiledGroundCollisionTilesInRange(
    manifest,
    centerRow - activeRadiusTiles,
    centerRow + activeRadiusTiles,
    centerColumn - activeRadiusTiles,
    centerColumn + activeRadiusTiles,
  )) {
    const dx = record.centerX - cameraLocalHelper.x
    const dz = record.centerZ - cameraLocalHelper.z
    desired.push({ record, distSq: dx * dx + dz * dz })
  }
  desired.sort((left, right) => left.distSq - right.distSq)
  return {
    desired: desired.map((entry) => entry.record),
    retainedKeys,
  }
}

function resolveCompiledGroundCollisionTileGridIndex(
  manifest: CompiledGroundManifest,
): CompiledGroundCollisionTileGridIndex {
  const cached = compiledGroundCollisionTileGridIndexCache.get(manifest)
  if (cached) {
    return cached
  }

  const rows = new Map<number, Map<number, CompiledGroundCollisionTileRecord>>()
  let minRow = Number.POSITIVE_INFINITY
  let maxRow = Number.NEGATIVE_INFINITY
  let minColumn = Number.POSITIVE_INFINITY
  let maxColumn = Number.NEGATIVE_INFINITY

  for (const record of manifest.collisionTiles) {
    const row = Math.trunc(Number(record.row) || 0)
    const column = Math.trunc(Number(record.column) || 0)
    let rowEntries = rows.get(row)
    if (!rowEntries) {
      rowEntries = new Map<number, CompiledGroundCollisionTileRecord>()
      rows.set(row, rowEntries)
    }
    rowEntries.set(column, record)
    minRow = Math.min(minRow, row)
    maxRow = Math.max(maxRow, row)
    minColumn = Math.min(minColumn, column)
    maxColumn = Math.max(maxColumn, column)
  }

  const next: CompiledGroundCollisionTileGridIndex = {
    rows,
    minRow: Number.isFinite(minRow) ? minRow : 0,
    maxRow: Number.isFinite(maxRow) ? maxRow : -1,
    minColumn: Number.isFinite(minColumn) ? minColumn : 0,
    maxColumn: Number.isFinite(maxColumn) ? maxColumn : -1,
  }
  compiledGroundCollisionTileGridIndexCache.set(manifest, next)
  return next
}

function collectCompiledGroundCollisionTilesInRange(
  manifest: CompiledGroundManifest,
  minRow: number,
  maxRow: number,
  minColumn: number,
  maxColumn: number,
): CompiledGroundCollisionTileRecord[] {
  const index = resolveCompiledGroundCollisionTileGridIndex(manifest)
  if (index.maxRow < index.minRow || index.maxColumn < index.minColumn) {
    return []
  }

  const clampedMinRow = Math.max(index.minRow, Math.trunc(minRow))
  const clampedMaxRow = Math.min(index.maxRow, Math.trunc(maxRow))
  const clampedMinColumn = Math.max(index.minColumn, Math.trunc(minColumn))
  const clampedMaxColumn = Math.min(index.maxColumn, Math.trunc(maxColumn))
  if (clampedMaxRow < clampedMinRow || clampedMaxColumn < clampedMinColumn) {
    return []
  }

  const records: CompiledGroundCollisionTileRecord[] = []
  for (let row = clampedMinRow; row <= clampedMaxRow; row += 1) {
    const rowEntries = index.rows.get(row)
    if (!rowEntries) {
      continue
    }
    for (let column = clampedMinColumn; column <= clampedMaxColumn; column += 1) {
      const record = rowEntries.get(column)
      if (record) {
        records.push(record)
      }
    }
  }
  return records
}

export function createCompiledGroundCollisionRuntime(
  deps: CompiledGroundCollisionRuntimeDeps,
): {
  clear: () => void
  sync: (params: SyncCompiledGroundCollisionTilesParams) => void
  getActiveTileKeys: () => string[]
  getDebugEntries: () => CompiledGroundCollisionDebugEntry[]
} {
  const instances = new Map<string, RigidbodyInstance>()
  const debugShapes = new Map<string, HeightfieldShapeDefinition[]>()
  const pending = new Map<string, PendingEntry>()
  let activeSourceId: string | null = null
  let activeRevision = -1

  function clear(): void {
    const world = deps.getPhysicsWorld()
    instances.forEach((instance) => removePhysicsBodyBindingBodies(world, instance))
    instances.clear()
    debugShapes.clear()
    pending.clear()
    activeSourceId = null
    activeRevision = -1
  }

  // 同步地面碰撞瓦片的主逻辑
  function sync(params: SyncCompiledGroundCollisionTilesParams): void {
      // 如果未启用或没有相机，清空所有实例
      if (!params.enabled || !params.camera) {
        clear()
        return
      }
      // 如果数据源或版本发生变化，清空并更新活动源ID和版本号
      if (activeSourceId !== params.sourceId || activeRevision !== params.revision) {
        clear()
        activeSourceId = params.sourceId
        activeRevision = params.revision
      }
      // 计算激活和保留的瓦片半径
      const activeRadiusTiles = Math.max(1, Math.trunc(params.activeRadiusTiles ?? 1)) // 激活区域半径
      const retainRadiusTiles = Math.max(activeRadiusTiles, Math.trunc(params.retainRadiusTiles ?? (activeRadiusTiles + 1))) // 保留区域半径
      // 解析需要加载和保留的瓦片
      const { desired, retainedKeys } = resolveDesiredCollisionTiles(
        params.groundObject,
        params.manifest,
        params.camera,
        activeRadiusTiles,
        retainRadiusTiles,
      )
      // 需要加载的瓦片key集合
      const desiredKeys = new Set(desired.map((record) => record.key))
      const world = deps.getPhysicsWorld()
      // 移除不再需要的瓦片实例
      instances.forEach((instance, key) => {
        if (desiredKeys.has(key) || retainedKeys.has(key)) {
          return
        }
        removePhysicsBodyBindingBodies(world, instance)
        instances.delete(key)
      })

      // 加载需要的瓦片
      for (const record of desired) {
        // 如果已存在或正在加载则跳过
        if (instances.has(record.key) || pending.has(record.key)) {
          continue
        }
        // 生成唯一签名
        const signature = `${record.key}|${record.bounds.minX}|${record.bounds.minZ}|${record.widthMeters}|${record.depthMeters}`
        const pendingEntry: PendingEntry = {
          signature,
          // 异步加载瓦片数据
          promise: params.loadTileData(record)
            .then((buffer) => {
              // 检查数据源和版本是否仍然有效
              if (activeSourceId !== params.sourceId || activeRevision !== params.revision) {
                return
              }
              // 构建高度场形状
              const built = buildHeightfieldShapeFromTileBuffer(record, buffer)
              if (!built) {
                return
              }
              // 检查是否已存在相同签名的实例
              const existing = instances.get(record.key)
              if (existing?.signature === built.signature) {
                return
              }
              // 移除旧实例
              if (existing) {
                removePhysicsBodyBindingBodies(deps.getPhysicsWorld(), existing)
                instances.delete(record.key)
              }
              // 创建碰撞代理
              const proxy = createCollisionProxy(params.groundObject, record.centerX, record.centerZ)
              // 创建刚体
              const bodyEntry = deps.createBody(
                buildColliderNode(record.key),
                buildStaticRigidbodyComponent(record.key),
                built.shapeDefinition,
                proxy,
              )
              if (!bodyEntry) {
                return
              }
              // 添加刚体到物理世界
              const targetWorld = deps.getPhysicsWorld() ?? deps.ensurePhysicsWorld()
              addPhysicsBodyToWorld(targetWorld, bodyEntry.body)
              // 保存实例信息
              instances.set(record.key, {
                nodeId: `__compiledGroundCollider:${record.key}`,
                body: bodyEntry.body,
                bodies: [bodyEntry.body],
                object: null,
                orientationAdjustment: bodyEntry.orientationAdjustment,
                signature: built.signature,
                syncObjectFromBody: false,
              })
              // 保存调试形状
              debugShapes.set(record.key, [built.shapeDefinition])
            })
            .catch((error) => {
              // 加载失败时输出警告
              console.warn(deps.loggerTag ?? '[CompiledGroundCollision]', 'Failed to load compiled ground collision tile', record.key, error)
            })
            .finally(() => {
              // 移除已完成的pending
              const activePending = pending.get(record.key)
              if (activePending?.signature === signature) {
                pending.delete(record.key)
              }
            }),
        }
        // 标记为正在加载
        pending.set(record.key, pendingEntry)
      }
    }

  return {
    clear,
    sync,
    getActiveTileKeys: () => Array.from(instances.keys()),
    getDebugEntries: () => Array.from(instances.entries()).map(([tileKey, instance]) => ({
      nodeId: instance.nodeId,
      tileKey,
      instance,
      shapes: debugShapes.get(tileKey)?.map((shape) => ({
        ...shape,
        matrix: shape.matrix.map((column) => [...column]),
      })) ?? [],
    })),
  }
}
