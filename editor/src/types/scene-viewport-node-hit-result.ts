import type { Object3D, Vector3 } from 'three'

export interface NodeHitResult {
  nodeId: string
  object: Object3D
  point: Vector3
}
