import type { Vector3Like } from '@schema'
export interface SceneCameraState {
  position: Vector3Like
  target: Vector3Like
  fov: number
  forward?: Vector3Like
}
