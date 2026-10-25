import * as THREE from 'three'

export interface SceneSunLightRuntime {
  readonly light: THREE.DirectionalLight
  sync(position: THREE.Vector3, intensity: number, color: THREE.ColorRepresentation): void
  dispose(): void
}

export function createSceneSunLightRuntime(scene: THREE.Scene): SceneSunLightRuntime {
  const light = new THREE.DirectionalLight('#ffffff', 3)
  light.name = 'scene-sun-light'
  light.castShadow = false
  light.position.set(0, 1000, 0)
  light.target.position.set(0, 0, 0)
  scene.add(light)
  scene.add(light.target)

  return {
    light,
    sync(position, intensity, color) {
      light.position.copy(position)
      light.intensity = Number.isFinite(intensity) ? Math.max(0, intensity) : 0
      light.color.set(color)
      light.target.updateMatrixWorld()
    },
    dispose() {
      light.removeFromParent()
      light.target.removeFromParent()
      light.dispose()
    },
  }
}
