import * as THREE from 'three'
import * as CANNON from 'cannon-es'

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
import type { RigidbodyInstance, RigidbodyOrientationAdjustment } from './physicsEngine'
import { removeRigidbodyInstanceBodies } from './physicsEngine'

type HeightfieldShapeDefinition = Extract<RigidbodyPhysicsShape, { kind: 'heightfield' }>

type CompiledGroundCollisionRuntimeDeps = {
  getPhysicsWorld: () => CANNON.World | null
  ensurePhysicsWorld: () => CANNON.World
  createBody: (
    node: SceneNode,
    component: SceneNodeComponentState<RigidbodyComponentProps>,
    shapeDefinition: HeightfieldShapeDefinition | null,
    object: THREE.Object3D,
  ) => { body: CANNON.Body; orientationAdjustment: RigidbodyOrientationAdjustment | null } | null
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

const cameraLocalHelper = new THREE.Vector3()

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
  return {
    shapeDefinition: {
      kind: 'heightfield',
      matrix,
      elementSize,
      width: record.widthMeters,
      depth: record.depthMeters,
      offset: [-record.widthMeters * 0.5, -record.depthMeters * 0.5, 0],
      applyScale: false,
    },
    signature: `${record.key}|${rows}|${columns}|${Math.round(elementSize * 1000)}|${Math.round(record.widthMeters * 1000)}|${Math.round(record.depthMeters * 1000)}|${hash.toString(16)}`,
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
  camera.getWorldPosition(cameraLocalHelper)
  groundObject.worldToLocal(cameraLocalHelper)
  const tileSize = Math.max(1e-6, manifest.collisionTileSizeMeters)
  const centerColumn = Math.floor((cameraLocalHelper.x - manifest.bounds.minX) / tileSize)
  const centerRow = Math.floor((cameraLocalHelper.z - manifest.bounds.minZ) / tileSize)
  const desired: Array<{ record: CompiledGroundCollisionTileRecord; distSq: number }> = []
  const retainedKeys = new Set<string>()
  for (const record of manifest.collisionTiles) {
    const dr = record.row - centerRow
    const dc = record.column - centerColumn
    if (Math.abs(dr) <= retainRadiusTiles && Math.abs(dc) <= retainRadiusTiles) {
      retainedKeys.add(record.key)
    }
    if (Math.abs(dr) > activeRadiusTiles || Math.abs(dc) > activeRadiusTiles) {
      continue
    }
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

export function createCompiledGroundCollisionRuntime(
  deps: CompiledGroundCollisionRuntimeDeps,
): {
  clear: () => void
  sync: (params: SyncCompiledGroundCollisionTilesParams) => void
} {
  const instances = new Map<string, RigidbodyInstance>()
  const pending = new Map<string, PendingEntry>()
  let activeSourceId: string | null = null
  let activeRevision = -1

  function clear(): void {
    const world = deps.getPhysicsWorld()
    instances.forEach((instance) => removeRigidbodyInstanceBodies(world, instance))
    instances.clear()
    pending.clear()
    activeSourceId = null
    activeRevision = -1
  }

  function sync(params: SyncCompiledGroundCollisionTilesParams): void {
    if (!params.enabled || !params.camera) {
      clear()
      return
    }
    if (activeSourceId !== params.sourceId || activeRevision !== params.revision) {
      clear()
      activeSourceId = params.sourceId
      activeRevision = params.revision
    }
    const activeRadiusTiles = Math.max(1, Math.trunc(params.activeRadiusTiles ?? 2))
    const retainRadiusTiles = Math.max(activeRadiusTiles, Math.trunc(params.retainRadiusTiles ?? (activeRadiusTiles + 1)))
    const { desired, retainedKeys } = resolveDesiredCollisionTiles(
      params.groundObject,
      params.manifest,
      params.camera,
      activeRadiusTiles,
      retainRadiusTiles,
    )
    const desiredKeys = new Set(desired.map((record) => record.key))
    const world = deps.getPhysicsWorld()
    instances.forEach((instance, key) => {
      if (desiredKeys.has(key) || retainedKeys.has(key)) {
        return
      }
      removeRigidbodyInstanceBodies(world, instance)
      instances.delete(key)
    })

    for (const record of desired) {
      if (instances.has(record.key) || pending.has(record.key)) {
        continue
      }
      const signature = `${record.key}|${record.bounds.minX}|${record.bounds.minZ}|${record.widthMeters}|${record.depthMeters}`
      const pendingEntry: PendingEntry = {
        signature,
        promise: params.loadTileData(record)
          .then((buffer) => {
            if (activeSourceId !== params.sourceId || activeRevision !== params.revision) {
              return
            }
            const built = buildHeightfieldShapeFromTileBuffer(record, buffer)
            if (!built) {
              return
            }
            const existing = instances.get(record.key)
            if (existing?.signature === built.signature) {
              return
            }
            if (existing) {
              removeRigidbodyInstanceBodies(deps.getPhysicsWorld(), existing)
              instances.delete(record.key)
            }
            const proxy = createCollisionProxy(params.groundObject, record.centerX, record.centerZ)
            const bodyEntry = deps.createBody(
              buildColliderNode(record.key),
              buildStaticRigidbodyComponent(record.key),
              built.shapeDefinition,
              proxy,
            )
            if (!bodyEntry) {
              return
            }
            const targetWorld = deps.getPhysicsWorld() ?? deps.ensurePhysicsWorld()
            targetWorld.addBody(bodyEntry.body)
            instances.set(record.key, {
              nodeId: `__compiledGroundCollider:${record.key}`,
              body: bodyEntry.body,
              bodies: [bodyEntry.body],
              object: null,
              orientationAdjustment: bodyEntry.orientationAdjustment,
              signature: built.signature,
              syncObjectFromBody: false,
            })
          })
          .catch((error) => {
            console.warn(deps.loggerTag ?? '[CompiledGroundCollision]', 'Failed to load compiled ground collision tile', record.key, error)
          })
          .finally(() => {
            const activePending = pending.get(record.key)
            if (activePending?.signature === signature) {
              pending.delete(record.key)
            }
          }),
      }
      pending.set(record.key, pendingEntry)
    }
  }

  return {
    clear,
    sync,
  }
}
