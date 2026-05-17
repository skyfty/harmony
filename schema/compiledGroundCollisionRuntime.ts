import * as THREE from 'three'

import {
  deserializeCompiledGroundCollisionTile,
  type CompiledGroundCollisionTileData,
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

const GROUND_COLLISION_RADIUS_METERS = 150

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
    shapeDefinition: RigidbodyPhysicsShape | null,
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

type CollisionTileWindow = {
  activeKeys: string[]
  retainedKeys: string[]
  desiredRecords: CompiledGroundCollisionTileRecord[]
}

const compiledGroundCameraLocalHelper = new THREE.Vector3()


function uniqueSortedKeys(keys: Iterable<string> | null | undefined): string[] {
  return Array.from(new Set(Array.from(keys ?? []).map((key) => key.trim()).filter((key) => key.length > 0))).sort()
}

function convertHeightsToMatrix(
  heights: Float32Array,
  rows: number,
  columns: number,
): number[][] {
  const pointsPerRow = columns + 1
  const matrix: number[][] = []
  for (let column = 0; column <= columns; column += 1) {
    const values: number[] = []
    for (let row = rows; row >= 0; row -= 1) {
      values.push(heights[row * pointsPerRow + column] ?? 0)
    }
    matrix.push(values)
  }
  return matrix
}

function buildHeightfieldShapeFromCompiledTile(
  data: CompiledGroundCollisionTileData,
): HeightfieldShapeDefinition {
  const rows = Math.max(1, Math.trunc(Number(data.header.rows) || 0))
  const columns = Math.max(1, Math.trunc(Number(data.header.columns) || 0))
  const elementSize = Number(data.header.elementSize)
  if (!Number.isFinite(elementSize) || elementSize <= 1e-6) {
    throw new Error(`Invalid compiled ground collision tile element size: ${String(data.header.key ?? '')}`)
  }
  const width = columns * elementSize
  const depth = rows * elementSize
  return {
    kind: 'heightfield',
    matrix: convertHeightsToMatrix(data.heights, rows, columns),
    elementSize,
    width,
    depth,
    offset: [-width * 0.5, -depth * 0.5, 0],
    applyScale: false,
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

function createStaticCollisionNode(nodeId: string): {
  node: SceneNode
  component: SceneNodeComponentState<RigidbodyComponentProps>
} {
  const component: SceneNodeComponentState<RigidbodyComponentProps> = {
    id: `${nodeId}:rigidbody`,
    type: RIGIDBODY_COMPONENT_TYPE,
    enabled: true,
    props: clampRigidbodyComponentProps({
      bodyType: 'STATIC',
      mass: 0,
      targetNodeId: nodeId,
    }),
  }
  return {
    node: {
      id: nodeId,
      name: nodeId,
      nodeType: 'object',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      components: {
        [RIGIDBODY_COMPONENT_TYPE]: component,
      },
    } as unknown as SceneNode,
    component,
  }
}

function resolveCollisionTileWindow(
  groundObject: THREE.Object3D,
  manifest: CompiledGroundManifest,
  camera: THREE.Camera,
  activeRadiusTiles?: number,
  retainRadiusTiles?: number,
): CollisionTileWindow {
  groundObject.updateWorldMatrix(true, false)
  camera.updateWorldMatrix(true, false)
  camera.getWorldPosition(compiledGroundCameraLocalHelper)
  groundObject.worldToLocal(compiledGroundCameraLocalHelper)

  const tileSizeMeters = Math.max(1e-6, Number(manifest.collisionTileSizeMeters) || 1)
  const resolvedActiveRadiusTiles = Math.max(
    1,
    Math.trunc(activeRadiusTiles ?? Math.ceil(GROUND_COLLISION_RADIUS_METERS / tileSizeMeters)),
  )
  const resolvedRetainRadiusTiles = Math.max(
    resolvedActiveRadiusTiles,
    Math.trunc(retainRadiusTiles ?? (resolvedActiveRadiusTiles + 1)),
  )
  const activeRadiusMeters = resolvedActiveRadiusTiles * tileSizeMeters
  const retainRadiusMeters = resolvedRetainRadiusTiles * tileSizeMeters

  const desired: Array<{ record: CompiledGroundCollisionTileRecord; distSq: number }> = []
  const retained: string[] = []
  for (const record of manifest.collisionTiles ?? []) {
    const centerX = Number.isFinite(Number(record.centerX)) ? Number(record.centerX) : ((Number(record.bounds?.minX) || 0) + (Number(record.bounds?.maxX) || 0)) * 0.5
    const centerZ = Number.isFinite(Number(record.centerZ)) ? Number(record.centerZ) : ((Number(record.bounds?.minZ) || 0) + (Number(record.bounds?.maxZ) || 0)) * 0.5
    const dx = centerX - compiledGroundCameraLocalHelper.x
    const dz = centerZ - compiledGroundCameraLocalHelper.z
    const distSq = dx * dx + dz * dz
    if (distSq <= retainRadiusMeters * retainRadiusMeters) {
      retained.push(record.key)
      if (distSq <= activeRadiusMeters * activeRadiusMeters) {
        desired.push({ record, distSq })
      }
    }
  }
  desired.sort((left, right) => left.distSq - right.distSq)
  return {
    activeKeys: desired.map((entry) => entry.record.key),
    retainedKeys: uniqueSortedKeys(retained),
    desiredRecords: desired.map((entry) => entry.record),
  }
}

export function collectCompiledGroundCollisionTileKeys(
  manifest: CompiledGroundManifest | null | undefined,
  runtimeLoadedTileKeys?: readonly string[] | null,
): string[] {
  void manifest
  return uniqueSortedKeys(runtimeLoadedTileKeys)
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

export type CompiledGroundCollisionDebugEntry = {
  nodeId: string
  tileKey: string
  instance: RigidbodyInstance
  shapes: HeightfieldShapeDefinition[]
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
  const pendingLoads = new Map<string, PendingEntry>()
  let residentTileKeys: string[] = []
  let generation = 0
  let currentSourceId = ''
  let currentRevision = -1
  let lastWindowSignature = ''

  function removeInstance(tileKey: string): void {
    const instance = instances.get(tileKey)
    if (!instance) {
      return
    }
    removePhysicsBodyBindingBodies(deps.getPhysicsWorld(), instance)
    instances.delete(tileKey)
    debugShapes.delete(tileKey)
  }

  function clear(): void {
    generation += 1
    residentTileKeys = []
    pendingLoads.clear()
    Array.from(instances.keys()).forEach(removeInstance)
    currentSourceId = ''
    currentRevision = -1
    lastWindowSignature = ''
  }

  function sync(params: SyncCompiledGroundCollisionTilesParams): void {
    if (!params.enabled || !params.camera || !params.manifest?.collisionTiles?.length) {
      clear()
      return
    }
    if (currentSourceId !== params.sourceId || currentRevision !== params.revision) {
      clear()
      currentSourceId = params.sourceId
      currentRevision = params.revision
    }

    const window = resolveCollisionTileWindow(
      params.groundObject,
      params.manifest,
      params.camera,
      params.activeRadiusTiles,
      params.retainRadiusTiles,
    )
    const windowSignature = [
      params.sourceId.trim(),
      Math.max(0, Math.trunc(Number(params.revision) || 0)),
      window.activeKeys.join(','),
      window.retainedKeys.join(','),
    ].join('|')
    if (windowSignature !== lastWindowSignature) {
      lastWindowSignature = windowSignature
    }
    const retainedKeySet = new Set(window.retainedKeys)
    residentTileKeys = window.retainedKeys

    Array.from(instances.keys()).forEach((tileKey) => {
      if (!retainedKeySet.has(tileKey)) {
        removeInstance(tileKey)
      }
    })
    Array.from(pendingLoads.keys()).forEach((tileKey) => {
      if (!retainedKeySet.has(tileKey)) {
        pendingLoads.delete(tileKey)
      }
    })

    for (const record of window.desiredRecords) {
      if (instances.has(record.key) || pendingLoads.has(record.key)) {
        continue
      }
      const pendingSignature = `${params.sourceId}|${params.revision}|${record.key}|${record.path}`
      const pendingGeneration = generation
      const promise = params.loadTileData(record)
        .then((buffer) => {
          const pending = pendingLoads.get(record.key)
          if (!pending || pending.signature !== pendingSignature) {
            return
          }
          if (pendingGeneration !== generation || !retainedKeySet.has(record.key)) {
            return
          }
          const tileData = deserializeCompiledGroundCollisionTile(buffer)
          if (!tileData) {
            throw new Error(`Invalid compiled ground collision tile payload: ${record.path}`)
          }
          const shape = buildHeightfieldShapeFromCompiledTile(tileData)
          const proxy = createCollisionProxy(params.groundObject, Number(record.centerX) || 0, Number(record.centerZ) || 0)
          const { node, component } = createStaticCollisionNode(`ground-collision:${params.sourceId}:compiled:${record.key}`)
          const bodyResult = deps.createBody(node, component, shape, proxy)
          if (!bodyResult?.body) {
            throw new Error(`Failed to create compiled ground collision body for tile: ${record.key}`)
          }
          const world = deps.ensurePhysicsWorld()
          addPhysicsBodyToWorld(world, bodyResult.body)
          ;(bodyResult.body as PhysicsBodyLike & { name?: string }).name = `compiled-ground:${params.sourceId}:${record.key}`
          instances.set(record.key, {
            nodeId: node.id,
            body: bodyResult.body,
            bodies: [bodyResult.body],
            object: params.groundObject,
            orientationAdjustment: bodyResult.orientationAdjustment,
            syncObjectFromBody: false,
            signature: pendingSignature,
          })

        })
        .finally(() => {
          const currentPending = pendingLoads.get(record.key)
          if (currentPending?.signature === pendingSignature) {
            pendingLoads.delete(record.key)
          }
        })
      pendingLoads.set(record.key, {
        signature: pendingSignature,
        promise,
      })
    }
  }

  return {
    clear,
    sync,
    getActiveTileKeys: () => [...residentTileKeys],
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
