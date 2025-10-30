import type { Vector3Like } from  '@harmony/scene-schema'

export interface TransformUpdatePayload {
  id: string
  position?: Vector3Like
  rotation?: Vector3Like
  scale?: Vector3Like
}
