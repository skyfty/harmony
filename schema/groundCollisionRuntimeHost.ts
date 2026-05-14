import * as THREE from 'three'

import type { CompiledGroundCollisionTileRecord, CompiledGroundManifest, GroundChunkManifest, GroundChunkManifestRecord, GroundRuntimeDynamicMesh, RigidbodyPhysicsShape } from './index'
import { createBackendRigidbodyBody, ensureBackendPhysicsWorld, hasPhysicsBackendBridge } from './physicsBackendBridge'
import { createCompiledGroundCollisionRuntime } from './compiledGroundCollisionRuntime'
import { createInfiniteGroundChunkColliderRuntime } from './infiniteGroundChunkCollisions'
import { type RigidbodyComponentProps, type SceneNode, type SceneNodeComponentState } from './index'
import type { PhysicsBodyLike, PhysicsWorldLike } from './physicsRuntimeBridge'
import { type PhysicsContactSettings, type PhysicsVector3Tuple } from './physicsBackendTypes'

type GroundCollisionRuntimeHostState = {
  world: PhysicsWorldLike | null
  rigidbodyMaterialCache: Map<string, { material: unknown; friction: number; restitution: number }>
  rigidbodyContactMaterialKeys: Set<string>
  compiledRuntime: ReturnType<typeof createCompiledGroundCollisionRuntime>
  infiniteRuntime: ReturnType<typeof createInfiniteGroundChunkColliderRuntime>
  sourceId: string | null
  compiledRevision: number
  infiniteRevision: number
}

const groundCollisionRuntimeHostStateMap = new WeakMap<THREE.Object3D, GroundCollisionRuntimeHostState>()
const groundCollisionRuntimeHostWorldSettings = {
  gravity: [0, -9.81, 0] as PhysicsVector3Tuple,
  fixedTimeStepMs: 1000 / 60,
  maxSubSteps: 4,
}
const groundCollisionRuntimeHostContactSettings: PhysicsContactSettings = {
  contactEquationStiffness: 1e7,
  contactEquationRelaxation: 3,
  frictionEquationStiffness: 1e7,
  frictionEquationRelaxation: 3,
}

function createGroundCollisionRuntimeHostState(): GroundCollisionRuntimeHostState {
  const worldState: { world: PhysicsWorldLike | null } = { world: null }
  const rigidbodyMaterialCache = new Map<string, { material: unknown; friction: number; restitution: number }>()
  const rigidbodyContactMaterialKeys = new Set<string>()

  const ensureWorld = (): PhysicsWorldLike => {
    const world = ensureBackendPhysicsWorld({
      world: worldState.world,
      setWorld: (nextWorld) => {
        worldState.world = nextWorld
      },
      gravity: groundCollisionRuntimeHostWorldSettings.gravity,
      solverIterations: 10,
      solverTolerance: 0.0001,
      contactFriction: 0.3,
      contactRestitution: 0.2,
      contactSettings: groundCollisionRuntimeHostContactSettings,
      rigidbodyMaterialCache,
      rigidbodyContactMaterialKeys,
    })
    worldState.world = world
    return world
  }

  const getWorld = (): PhysicsWorldLike | null => worldState.world

  const createBody = (
    node: SceneNode,
    component: SceneNodeComponentState<RigidbodyComponentProps>,
    shapeDefinition: RigidbodyPhysicsShape | null,
    object: THREE.Object3D,
  ): { body: PhysicsBodyLike; orientationAdjustment: null } | null => {
    const world = ensureWorld()
    object.updateMatrixWorld(true)
    const shapeScale = new THREE.Vector3(1, 1, 1)
    object.getWorldScale(shapeScale)
    const bodyResult = createBackendRigidbodyBody({
      world,
      mass: 0,
      bodyType: component.props.bodyType,
      shapes: shapeDefinition
        ? [{
          definition: shapeDefinition,
        }]
        : [],
      shapeScale,
      rigidbodyMaterialCache,
      rigidbodyContactMaterialKeys,
      friction: component.props.friction,
      restitution: component.props.restitution,
      contactSettings: groundCollisionRuntimeHostContactSettings,
      name: node.id,
    })
    if (!bodyResult) {
      return null
    }
    return {
      body: bodyResult.body,
      orientationAdjustment: null,
    }
  }

  const compiledRuntime = createCompiledGroundCollisionRuntime({
    getPhysicsWorld: getWorld,
    ensurePhysicsWorld: ensureWorld,
    createBody,
    loggerTag: '[GroundCollisionRuntimeHost]',
  })

  const infiniteRuntime = createInfiniteGroundChunkColliderRuntime({
    getPhysicsWorld: getWorld,
    ensurePhysicsWorld: ensureWorld,
    createBody,
    loggerTag: '[GroundCollisionRuntimeHost]',
  })

  return {
    world: null,
    rigidbodyMaterialCache,
    rigidbodyContactMaterialKeys,
    compiledRuntime,
    infiniteRuntime,
    sourceId: null,
    compiledRevision: -1,
    infiniteRevision: -1,
  }
}

function resolveGroundChunkRecords(manifest: GroundChunkManifest | null | undefined): Record<string, GroundChunkManifestRecord> | undefined {
  if (!manifest?.chunks) {
    return undefined
  }
  return manifest.chunks
}

export type SyncGroundCollisionRuntimeHostParams = {
  enabled: boolean
  sourceId: string
  groundObject: THREE.Object3D | null
  groundMesh: GroundRuntimeDynamicMesh | null | undefined
  camera: THREE.Camera | null | undefined
  compiledManifest?: CompiledGroundManifest | null | undefined
  loadCompiledTileData?: (record: CompiledGroundCollisionTileRecord) => Promise<ArrayBuffer | null>
  groundChunkManifest?: GroundChunkManifest | null | undefined
  loadGroundChunkData?: (chunkKey: string) => Promise<ArrayBuffer | null>
}

export type GroundCollisionRuntimeHostStateSnapshot = {
  compiledTileKeys: string[]
  infiniteChunkKeys: string[]
}

export function syncGroundCollisionRuntimeHost(
  params: SyncGroundCollisionRuntimeHostParams,
): GroundCollisionRuntimeHostStateSnapshot {
  const compiledManifest = params.compiledManifest ?? null
  const groundChunkManifest = params.groundChunkManifest ?? null
  const groundObject = params.groundObject
  const groundMesh = params.groundMesh ?? null
  const camera = params.camera ?? null
  const sourceId = params.sourceId.trim()

  if (!params.enabled || !groundObject || !groundMesh || !camera || !sourceId) {
    if (groundObject) {
      const state = groundCollisionRuntimeHostStateMap.get(groundObject)
      state?.compiledRuntime.clear()
      state?.infiniteRuntime.clear()
    }
    return { compiledTileKeys: [], infiniteChunkKeys: [] }
  }

  let state = groundCollisionRuntimeHostStateMap.get(groundObject)
  if (!state) {
    state = createGroundCollisionRuntimeHostState()
    groundCollisionRuntimeHostStateMap.set(groundObject, state)
  }

  if (!hasPhysicsBackendBridge()) {
    return {
      compiledTileKeys: state.compiledRuntime.getActiveTileKeys(),
      infiniteChunkKeys: Array.isArray(groundMesh.runtimeLoadedTileKeys) ? [...groundMesh.runtimeLoadedTileKeys] : [],
    }
  }

  if (compiledManifest && params.loadCompiledTileData) {
    state.compiledRuntime.sync({
      enabled: true,
      groundObject,
      camera,
      sourceId,
      revision: Math.max(0, Math.trunc(Number(compiledManifest.revision) || 0)),
      manifest: compiledManifest,
      loadTileData: params.loadCompiledTileData,
    })
  } else {
    state.compiledRuntime.clear()
  }

  state.infiniteRuntime.sync({
    enabled: groundMesh.terrainMode === 'infinite',
    groundObject,
    groundDefinition: groundMesh,
    camera,
    sourceId,
    manifestRevision: Math.max(0, Math.trunc(Number(groundMesh.chunkManifestRevision) || 0)),
    manifestRecords: resolveGroundChunkRecords(groundChunkManifest),
    loadChunkData: params.loadGroundChunkData
      ? async (record) => params.loadGroundChunkData?.(record.key) ?? null
      : undefined,
  })

  state.sourceId = sourceId
  state.compiledRevision = compiledManifest ? Math.max(0, Math.trunc(Number(compiledManifest.revision) || 0)) : -1
  state.infiniteRevision = Math.max(0, Math.trunc(Number(groundMesh.chunkManifestRevision) || 0))
  return {
    compiledTileKeys: state.compiledRuntime.getActiveTileKeys(),
    infiniteChunkKeys: Array.isArray(groundMesh.runtimeLoadedTileKeys) ? [...groundMesh.runtimeLoadedTileKeys] : [],
  }
}

export function clearGroundCollisionRuntimeHost(groundObject: THREE.Object3D | null | undefined): void {
  if (!groundObject) {
    return
  }
  const state = groundCollisionRuntimeHostStateMap.get(groundObject)
  if (!state) {
    return
  }
  state.compiledRuntime.clear()
  state.infiniteRuntime.clear()
  groundCollisionRuntimeHostStateMap.delete(groundObject)
}
