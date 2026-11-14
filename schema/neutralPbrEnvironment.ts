import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

export interface NeutralPbrEnvironment {
  texture: THREE.Texture
  dispose: () => void
}

export function createNeutralPbrEnvironment(
  renderer: THREE.WebGLRenderer,
): NeutralPbrEnvironment {
  const pmremGenerator = new THREE.PMREMGenerator(renderer)
  const roomEnvironment = new RoomEnvironment()
  const renderTarget = pmremGenerator.fromScene(roomEnvironment, 0.04)
  roomEnvironment.dispose()
  pmremGenerator.dispose()
  return {
    texture: renderTarget.texture,
    dispose: () => renderTarget.dispose(),
  }
}
