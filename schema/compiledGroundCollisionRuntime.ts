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


  function clear(): void {

  }

  // 同步地面碰撞瓦片的主逻辑
  function sync(params: SyncCompiledGroundCollisionTilesParams): void {
     
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
