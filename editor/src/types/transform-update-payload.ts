import * as THREE from 'three'
export interface TransformUpdatePayload {
  id: string
  position?: THREE.Vector3
  rotation?: THREE.Vector3
  scale?: THREE.Vector3
}
