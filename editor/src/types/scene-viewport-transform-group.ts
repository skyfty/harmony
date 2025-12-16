import type { Object3D, Quaternion, Vector3 } from 'three'

export interface TransformGroupEntry {
  nodeId: string
  object: Object3D
  parent: Object3D | null
  initialPosition: Vector3
  initialQuaternion: Quaternion
  initialScale: Vector3
  initialWorldPosition: Vector3
  initialWorldQuaternion: Quaternion
  initialPivotWorldPosition: Vector3
}

export interface TransformGroupState {
  primaryId: string | null
  entries: Map<string, TransformGroupEntry>
}
