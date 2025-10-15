import type { Vector3Like } from '@/types/scene'

export interface SceneCameraState {
  position: Vector3Like
  target: Vector3Like
  fov: number
}
