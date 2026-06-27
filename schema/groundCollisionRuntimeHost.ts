import * as THREE from 'three'

import { collectCompiledGroundCoveredChunkKeys, type CompiledGroundCollisionTileRecord, type CompiledGroundManifest } from './compiledGround'
import { createCompiledGroundCollisionRuntime } from './compiledGroundCollisionRuntime'
import { createInfiniteGroundChunkColliderRuntime, type InfiniteGroundChunkColliderRuntime, type InfiniteGroundChunkColliderRuntimeDeps } from './infiniteGroundChunkCollisions'
import type {
  GroundRuntimeDynamicMesh,
  SceneNode,
  SceneNodeComponentState,
} from './core'
import type {
  RigidbodyPhysicsShape,
  RigidbodyComponentProps,
} from './components'
import type { PhysicsBodyLike, PhysicsOrientationAdjustment } from './physicsBodySync'
import type { PhysicsWorldLike } from './physicsRuntimeBridge'

const groundCollisionRuntimeHostStateMap = new WeakMap<THREE.Object3D, GroundCollisionRuntimeHostState>()

type GroundCollisionRuntimeHostState = {
  compiledRuntime: ReturnType<typeof createCompiledGroundCollisionRuntime>
  infiniteRuntime: InfiniteGroundChunkColliderRuntime
  lastActiveWindowSignature: string
}

type GroundCollisionRuntimeDeps = {
  getPhysicsWorld?: () => PhysicsWorldLike | null
  ensurePhysicsWorld?: () => PhysicsWorldLike
  createBody?: (
    node: SceneNode,
    component: SceneNodeComponentState<RigidbodyComponentProps>,
    shapeDefinition: RigidbodyPhysicsShape | null,
    object: THREE.Object3D,
  ) => { body: PhysicsBodyLike; orientationAdjustment: PhysicsOrientationAdjustment | null } | null
  loggerTag?: string
}

function ensureHostState(
  groundObject: THREE.Object3D,
  runtimeDeps: GroundCollisionRuntimeDeps | null | undefined,
): GroundCollisionRuntimeHostState | null {
  const deps = runtimeDeps
  if (!deps || !deps.getPhysicsWorld || !deps.ensurePhysicsWorld || !deps.createBody) {
    return null
  }
  const existing = groundCollisionRuntimeHostStateMap.get(groundObject)
  if (existing) {
    return existing
  }
  const sharedDeps: InfiniteGroundChunkColliderRuntimeDeps = {
    getPhysicsWorld: deps.getPhysicsWorld,
    ensurePhysicsWorld: deps.ensurePhysicsWorld,
    createBody: deps.createBody,
    loggerTag: deps.loggerTag,
  }
  const state: GroundCollisionRuntimeHostState = {
    compiledRuntime: createCompiledGroundCollisionRuntime(sharedDeps),
    infiniteRuntime: createInfiniteGroundChunkColliderRuntime(sharedDeps),
    lastActiveWindowSignature: '',
  }
  groundCollisionRuntimeHostStateMap.set(groundObject, state)
  return state
}

export type SyncGroundCollisionRuntimeHostParams = {
  enabled: boolean
  sourceId: string
  groundObject: THREE.Object3D | null
  groundMesh: GroundRuntimeDynamicMesh | null | undefined
  referenceWorldPositions: readonly THREE.Vector3[] | null | undefined
  compiledManifest?: CompiledGroundManifest | null | undefined
  loadCompiledTileData?: (record: CompiledGroundCollisionTileRecord) => Promise<ArrayBuffer | null>
  runtimeDeps?: GroundCollisionRuntimeDeps | null | undefined
}

export type GroundCollisionRuntimeHostStateSnapshot = {
  compiledTileKeys: string[]
  infiniteChunkKeys: string[]
}

export function syncGroundCollisionRuntimeHost(
  params: SyncGroundCollisionRuntimeHostParams,
): GroundCollisionRuntimeHostStateSnapshot {
  const {
    enabled,
    sourceId,
    groundObject,
    groundMesh,
    referenceWorldPositions,
    compiledManifest,
    loadCompiledTileData,
    runtimeDeps,
  } = params
  const references = Array.isArray(referenceWorldPositions)
    ? referenceWorldPositions.filter((position) => Boolean(position))
    : []
  if (!enabled || !groundObject || !groundMesh || references.length === 0) {
    clearGroundCollisionRuntimeHost(groundObject)
    return {
      compiledTileKeys: [],
      infiniteChunkKeys: [],
    }
  }

  const state = ensureHostState(groundObject, runtimeDeps)
  if (!state) {
    clearGroundCollisionRuntimeHost(groundObject)
    return {
      compiledTileKeys: [],
      infiniteChunkKeys: [],
    }
  }

  const compiledRevision = Math.max(0, Math.trunc(Number(compiledManifest?.revision) || 0))
  const compiledEnabled = Boolean(compiledManifest?.collisionTiles?.length)
  if (compiledEnabled && typeof loadCompiledTileData === 'function' && compiledManifest) {
    state.compiledRuntime.sync({
      enabled: true,
      groundObject,
      referenceWorldPositions: references,
      sourceId,
      revision: compiledRevision,
      manifest: compiledManifest,
      loadTileData: loadCompiledTileData,
    })
  } else if (compiledEnabled && compiledManifest) {
    state.compiledRuntime.sync({
      enabled: true,
      groundObject,
      referenceWorldPositions: references,
      sourceId,
      revision: compiledRevision,
      manifest: compiledManifest,
      loadTileData: async () => null,
    })
  } else {
    state.compiledRuntime.clear()
  }

  const excludedChunkKeys = compiledEnabled ? collectCompiledGroundCoveredChunkKeys(compiledManifest) : []
  if (groundMesh.terrainMode === 'infinite') {
    state.infiniteRuntime.sync({
      enabled: true,
      groundObject,
      groundDefinition: groundMesh,
      referenceWorldPositions: references,
      sourceId,
      excludedChunkKeys,
    })
  } else {
    state.infiniteRuntime.clear()
  }

  const compiledTileKeys = state.compiledRuntime.getActiveTileKeys()
  const infiniteChunkKeys = state.infiniteRuntime.getActiveChunkKeys()
  state.lastActiveWindowSignature = [
    sourceId.trim(),
    ...references.map((position) => `${Math.round(position.x * 100)}:${Math.round(position.z * 100)}`),
    compiledTileKeys.join(','),
    infiniteChunkKeys.join(','),
  ].join('|')

  return {
    compiledTileKeys,
    infiniteChunkKeys,
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
