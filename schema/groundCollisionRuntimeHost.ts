import * as THREE from 'three'

import type { CompiledGroundCollisionTileRecord, CompiledGroundManifest, GroundChunkManifest, GroundChunkManifestRecord, GroundRuntimeDynamicMesh, RigidbodyPhysicsShape } from './index'

const groundCollisionRuntimeHostStateMap = new WeakMap<THREE.Object3D, GroundCollisionRuntimeHostState>()


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
