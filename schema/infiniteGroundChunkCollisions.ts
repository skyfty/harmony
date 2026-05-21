import * as THREE from 'three'

import {
  RIGIDBODY_COMPONENT_TYPE,
  clampRigidbodyComponentProps,
  type RigidbodyComponentProps,
  type RigidbodyPhysicsShape,
} from './components'
import type {
  GroundRuntimeDynamicMesh,
  SceneNode,
  SceneNodeComponentState,
} from './core'
import {
  parseGroundChunkKey,
  resolveGroundChunkCoordFromWorldPosition,
  resolveGroundChunkOrigin,
} from './core'
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

type BoxShapeDefinition = Extract<RigidbodyPhysicsShape, { kind: 'box' }>

type InfiniteGroundChunkColliderSource = 'box'

const GROUND_COLLISION_RADIUS_METERS = 150
const FLAT_COLLIDER_THICKNESS_METERS = 4

export type InfiniteGroundChunkColliderRuntimeDeps = {
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

export type InfiniteGroundChunkColliderSyncParams = {
  enabled: boolean
  groundObject: THREE.Object3D
  groundDefinition: GroundRuntimeDynamicMesh
  camera: THREE.Camera | null | undefined
  sourceId: string
  excludedChunkKeys?: Iterable<string> | null
}

export type InfiniteGroundChunkColliderRuntime = {
  clear: () => void
  sync: (params: InfiniteGroundChunkColliderSyncParams) => void
  getActiveChunkKeys: () => string[]
  getDebugEntries: () => InfiniteGroundChunkColliderDebugEntry[]
}

export type InfiniteGroundChunkColliderDebugEntry = {
  runtimeKey: string
  nodeId: string
  source: InfiniteGroundChunkColliderSource
  instance: RigidbodyInstance
  shapes: BoxShapeDefinition[]
}

export type InfiniteGroundChunkCollisionRuntimeState = {
  enabled: boolean
  sourceId: string
  signature: string
  activeChunkKeys: string[]
}

type ChunkWindow = {
  activeChunkKeys: string[]
  retainedChunkKeys: string[]
}

type CachedBoxShapeEntry = {
  signature: string
  shape: BoxShapeDefinition
}

const infiniteGroundCameraLocalHelper = new THREE.Vector3()

function uniqueSortedKeys(keys: Iterable<string> | null | undefined): string[] {
  return Array.from(new Set(Array.from(keys ?? []).map((key) => key.trim()).filter((key) => key.length > 0))).sort()
}

function resolveChunkSizeMeters(definition: Pick<GroundRuntimeDynamicMesh, 'chunkSizeMeters'>): number {
  const chunkSizeMeters = Number(definition.chunkSizeMeters)
  if (!Number.isFinite(chunkSizeMeters) || chunkSizeMeters <= 1e-6) {
    throw new Error('Invalid infinite ground chunk size')
  }
  return chunkSizeMeters
}

function resolveGroundDefinitionSignature(
  definition: Pick<
    GroundRuntimeDynamicMesh,
    | 'chunkSizeMeters'
    | 'baseHeight'
    | 'chunkManifestRevision'
    | 'surfaceRevision'
  >,
): string {
  return [
    Number(definition.chunkSizeMeters) || 0,
    Number(definition.baseHeight) || 0,
    Math.max(0, Math.trunc(Number(definition.chunkManifestRevision) || 0)),
    Math.max(0, Math.trunc(Number(definition.surfaceRevision) || 0)),
  ].join('|')
}

function stripRuntimeKeyPrefix(runtimeKey: string): string {
  const separatorIndex = runtimeKey.indexOf(':')
  return separatorIndex >= 0 ? runtimeKey.slice(separatorIndex + 1) : runtimeKey
}

function resolveBoxRuntimeKey(chunkKey: string): string {
  return `box:${chunkKey}`
}

function resolveChunkWindow(
  groundObject: THREE.Object3D,
  camera: THREE.Camera,
  chunkSizeMeters: number,
): ChunkWindow {
  groundObject.updateWorldMatrix(true, false)
  camera.updateWorldMatrix(true, false)
  camera.getWorldPosition(infiniteGroundCameraLocalHelper)
  groundObject.worldToLocal(infiniteGroundCameraLocalHelper)

  const centerCoord = resolveGroundChunkCoordFromWorldPosition(
    infiniteGroundCameraLocalHelper.x,
    infiniteGroundCameraLocalHelper.z,
    chunkSizeMeters,
  )
  const activeRadiusChunks = Math.max(1, Math.ceil(GROUND_COLLISION_RADIUS_METERS / chunkSizeMeters))
  const retainRadiusChunks = activeRadiusChunks + 1
  const activeChunkKeys: string[] = []
  const retainedChunkKeys: string[] = []

  for (let chunkZ = centerCoord.chunkZ - retainRadiusChunks; chunkZ <= centerCoord.chunkZ + retainRadiusChunks; chunkZ += 1) {
    for (let chunkX = centerCoord.chunkX - retainRadiusChunks; chunkX <= centerCoord.chunkX + retainRadiusChunks; chunkX += 1) {
      const chunkKey = `${chunkX}:${chunkZ}`
      retainedChunkKeys.push(chunkKey)
      if (
        chunkX >= centerCoord.chunkX - activeRadiusChunks
        && chunkX <= centerCoord.chunkX + activeRadiusChunks
        && chunkZ >= centerCoord.chunkZ - activeRadiusChunks
        && chunkZ <= centerCoord.chunkZ + activeRadiusChunks
      ) {
        activeChunkKeys.push(chunkKey)
      }
    }
  }

  return {
    activeChunkKeys: uniqueSortedKeys(activeChunkKeys),
    retainedChunkKeys: uniqueSortedKeys(retainedChunkKeys),
  }
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

function buildChunkBoxShape(
  chunkKey: string,
  chunkSizeMeters: number,
): BoxShapeDefinition | null {
  const coord = parseGroundChunkKey(chunkKey)
  if (!coord) {
    return null
  }
  const origin = resolveGroundChunkOrigin(coord, chunkSizeMeters)
  const halfThickness = FLAT_COLLIDER_THICKNESS_METERS * 0.5
  return {
    kind: 'box',
    halfExtents: [chunkSizeMeters * 0.5, halfThickness, chunkSizeMeters * 0.5],
    offset: [
      origin.x + chunkSizeMeters * 0.5,
      -halfThickness,
      origin.z + chunkSizeMeters * 0.5,
    ],
    applyScale: false,
  }
}

export function collectInfiniteGroundChunkCollisionKeys(
  definition: Pick<GroundRuntimeDynamicMesh, 'terrainMode' | 'runtimeLoadedTileKeys'> | null | undefined,
): string[] {
  if (!definition || definition.terrainMode !== 'infinite') {
    return []
  }
  return uniqueSortedKeys(definition.runtimeLoadedTileKeys)
}

export function resolveInfiniteGroundChunkCollisionRuntimeState(params: {
  enabled: boolean
  definition: Pick<GroundRuntimeDynamicMesh, 'terrainMode' | 'runtimeLoadedTileKeys'>
  sourceId: string
}): InfiniteGroundChunkCollisionRuntimeState {
  const activeChunkKeys = params.enabled
    ? collectInfiniteGroundChunkCollisionKeys(params.definition)
    : []
  return {
    enabled: params.enabled,
    sourceId: params.sourceId,
    signature: [
      params.enabled ? 1 : 0,
      params.sourceId.trim(),
      activeChunkKeys.join(','),
    ].join('|'),
    activeChunkKeys,
  }
}

export function createInfiniteGroundChunkColliderRuntime(
  deps: InfiniteGroundChunkColliderRuntimeDeps,
): InfiniteGroundChunkColliderRuntime {
  const instances = new Map<string, RigidbodyInstance>()
  const debugShapes = new Map<string, BoxShapeDefinition[]>()
  const boxShapeCache = new Map<string, CachedBoxShapeEntry>()
  const residentChunkKeys = new Set<string>()
  let generation = 0
  let currentSourceId = ''
  let currentDefinitionSignature = ''

  function removeRuntimeKey(runtimeKey: string): void {
    const instance = instances.get(runtimeKey)
    if (instance) {
      removePhysicsBodyBindingBodies(deps.getPhysicsWorld(), instance)
      instances.delete(runtimeKey)
    }
    debugShapes.delete(runtimeKey)
  }

  function clear(): void {
    generation += 1
    residentChunkKeys.clear()
    boxShapeCache.clear()
    Array.from(instances.keys()).forEach(removeRuntimeKey)
    currentSourceId = ''
    currentDefinitionSignature = ''
  }

  function attachShape(
    params: InfiniteGroundChunkColliderSyncParams,
    runtimeKey: string,
    chunkKey: string,
    shape: BoxShapeDefinition | null,
  ): void {
    if (!shape) {
      return
    }
    const { node, component } = createStaticCollisionNode(`ground-collision:${params.sourceId}:${runtimeKey}`)
    const bodyResult = deps.createBody(node, component, shape, params.groundObject)
    if (!bodyResult?.body) {
      debugShapes.set(runtimeKey, [shape])
      return
    }
    const world = deps.ensurePhysicsWorld()
    addPhysicsBodyToWorld(world, bodyResult.body)
    ;(bodyResult.body as PhysicsBodyLike & { name?: string }).name = `infinite-ground:${params.sourceId}:${runtimeKey}`
    instances.set(runtimeKey, {
      nodeId: node.id,
      body: bodyResult.body,
      bodies: [bodyResult.body],
      object: params.groundObject,
      orientationAdjustment: bodyResult.orientationAdjustment,
      syncObjectFromBody: false,
      signature: `box:${chunkKey}`,
    })
    debugShapes.set(runtimeKey, [shape])
  }

  function sync(params: InfiniteGroundChunkColliderSyncParams): void {
    if (!params.enabled || !params.camera) {
      clear()
      return
    }
    const definitionSignature = resolveGroundDefinitionSignature(params.groundDefinition)
    if (currentSourceId !== params.sourceId || currentDefinitionSignature !== definitionSignature) {
      clear()
      currentSourceId = params.sourceId
      currentDefinitionSignature = definitionSignature
    }

    const chunkSizeMeters = resolveChunkSizeMeters(params.groundDefinition)
    const { activeChunkKeys, retainedChunkKeys } = resolveChunkWindow(
      params.groundObject,
      params.camera,
      chunkSizeMeters,
    )
    const excludedChunkKeys = new Set(uniqueSortedKeys(params.excludedChunkKeys))
    const retainedSet = new Set(retainedChunkKeys.filter((chunkKey) => !excludedChunkKeys.has(chunkKey)))
    residentChunkKeys.clear()
    retainedSet.forEach((chunkKey) => residentChunkKeys.add(chunkKey))

    Array.from(instances.keys()).forEach((runtimeKey) => {
      if (!retainedSet.has(stripRuntimeKeyPrefix(runtimeKey))) {
        removeRuntimeKey(runtimeKey)
      }
    })

    for (const chunkKey of activeChunkKeys) {
      if (excludedChunkKeys.has(chunkKey)) {
        continue
      }
      const runtimeKey = resolveBoxRuntimeKey(chunkKey)
      if (instances.has(runtimeKey)) {
        continue
      }
      const shapeSignature = [
        params.sourceId.trim(),
        currentDefinitionSignature,
        runtimeKey,
        Math.max(0, Math.trunc(chunkSizeMeters * 1000)),
      ].join('|')
      const cachedShape = boxShapeCache.get(runtimeKey)
      const shape = cachedShape?.signature === shapeSignature
        ? cachedShape.shape
        : buildChunkBoxShape(chunkKey, chunkSizeMeters)
      if (!shape) {
        throw new Error(`Invalid infinite ground chunk key: ${chunkKey}`)
      }
      boxShapeCache.set(runtimeKey, {
        signature: shapeSignature,
        shape,
      })
      attachShape(params, runtimeKey, chunkKey, shape)
    }
  }

  return {
    clear,
    sync,
    getActiveChunkKeys: () => uniqueSortedKeys(Array.from(residentChunkKeys)),
    getDebugEntries: () => Array.from(instances.entries()).map(([runtimeKey, instance]) => ({
      runtimeKey,
      nodeId: instance.nodeId,
      source: 'box',
      instance,
      shapes: debugShapes.get(runtimeKey)?.map((shape) => ({
        ...shape,
        halfExtents: [...shape.halfExtents] as [number, number, number],
        offset: shape.offset ? [...shape.offset] as [number, number, number] : undefined,
      })) ?? [],
    })),
  }
}
