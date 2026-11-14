import * as THREE from 'three'
import type { SceneNodeMaterial } from '../core'

const ENVIRONMENT_MAP_MATERIAL_TYPES = new Set<string>([
  'MeshStandardMaterial',
  'MeshPhysicalMaterial',
  'MeshPhongMaterial',
])

export function applyHouseRigMaterialEnvironmentPreview(
  target: THREE.Object3D,
  materialConfig: SceneNodeMaterial,
  environmentMap: THREE.Texture | null | undefined,
): void {
  if (
    !environmentMap
    || materialConfig.editorPreviewEnvironment !== 'neutral-pbr'
  ) {
    return
  }
  const applyToMaterial = (material: THREE.Material | null | undefined) => {
    if (!material || !ENVIRONMENT_MAP_MATERIAL_TYPES.has(material.type)) {
      return
    }
    const record = material as THREE.Material & {
      envMap?: THREE.Texture | null
      envMapIntensity?: number
    }
    record.envMap = environmentMap
    if (typeof materialConfig.envMapIntensity === 'number') {
      record.envMapIntensity = Math.max(0, materialConfig.envMapIntensity)
    }
    material.needsUpdate = true
  }
  const visit = (object: THREE.Object3D) => {
    const mesh = object as THREE.Mesh
    if (mesh.isMesh) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(applyToMaterial)
      } else {
        applyToMaterial(mesh.material)
      }
    }
    object.children.forEach(visit)
  }
  visit(target)
}
