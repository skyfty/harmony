import type { Euler, Object3D, Plane, Vector3 } from 'three'

export interface SelectionDragCompanion {
  nodeId: string
  object: Object3D
  parent: Object3D | null
  initialLocalPosition: Vector3
  initialWorldPosition: Vector3
}

export interface SelectionDragState {
  nodeId: string
  object: Object3D
  plane: Plane
  pointerOffset: Vector3
  initialLocalPosition: Vector3
  initialWorldPosition: Vector3
  initialRotation: Euler
  parent: Object3D | null
  companions: SelectionDragCompanion[]
  hasDragged: boolean
}
