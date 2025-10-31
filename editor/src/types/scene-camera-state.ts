import type { Vector3Like } from '@harmony/schema'
export interface SceneCameraState {
  position: Vector3Like
  target: Vector3Like
  fov: number
  forward?: Vector3Like
}
