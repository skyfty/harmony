import * as THREE from 'three'
export interface SceneCameraState {
  position: THREE.Vector3
  target: THREE.Vector3
  fov: number
  forward?: THREE.Vector3
}
