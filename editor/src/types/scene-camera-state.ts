import type { Vector3Like } from '@schema/core'
export interface SceneCameraState {
  position: Vector3Like
  target: Vector3Like
  fov: number
  forward?: Vector3Like
}
