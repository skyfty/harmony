import type { Object3D, Vector3 } from 'three'

export interface NodeHitResult {
  nodeId: string
  object: Object3D
  point: Vector3

  /** Optional sub-selection for Road dynamic meshes. */
  roadSegmentIndex?: number | null
}
