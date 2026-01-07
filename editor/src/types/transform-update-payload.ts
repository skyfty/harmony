import type { Vector3Like } from '@harmony/schema'
export type { Vector3Like }
export interface TransformUpdatePayload {
  id: string
  position?: Vector3Like
  rotation?: Vector3Like
  scale?: Vector3Like
}
