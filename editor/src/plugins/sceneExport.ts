import * as THREE from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { exportGLB, type SceneExportOptions } from '@/plugins/exporter'

export type SceneExportResult = {
  blob: Blob
  fileName: string
}

const MATERIAL_TEXTURE_KEYS = [
  'map',
  'normalMap',
  'metalnessMap',
  'roughnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
  'lightMap',
  'specularMap',
  'envMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'transmissionMap',
  'thicknessMap',
  'displacementMap',
  'bumpMap',
  'gradientMap',
] as const

function normalizeBaseFileName(input?: string): string {
  const fallback = 'scene-export'
  if (!input) {
    return fallback
  }
  const trimmed = input.trim()
  const withoutExtension = trimmed.replace(/\.glb$/i, '')
  const sanitized = withoutExtension.replace(/[^a-zA-Z0-9-_. ]+/g, '_').trim()
  return sanitized || fallback
}

function cloneMeshMaterials(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!(mesh as any)?.isMesh) {
      return
    }
    const material = mesh.material
    if (Array.isArray(material)) {
      mesh.material = material.map((entry) => entry?.clone?.() ?? entry)
    } else if (material?.clone) {
      mesh.material = material.clone()
    }
  })
}

function stripMaterialTextures(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!(mesh as any)?.isMesh) {
      return
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((material) => {
      if (!material) {
        return
      }
  const matAny = material as unknown as Record<string, unknown>
      for (const key of MATERIAL_TEXTURE_KEYS) {
        if (matAny[key]) {
          matAny[key] = null
        }
      }
      material.needsUpdate = true
    })
  })
}

function removeLights(root: THREE.Object3D) {
  const collected: THREE.Object3D[] = []
  root.traverse((node) => {
    if ((node as any)?.isLight) {
      collected.push(node)
    }
  })
  collected.forEach((light) => light.parent?.remove(light))
}

function removeCameras(root: THREE.Object3D) {
  const collected: THREE.Object3D[] = []
  root.traverse((node) => {
    if ((node as any)?.isCamera) {
      collected.push(node)
    }
  })
  collected.forEach((cameraObject) => cameraObject.parent?.remove(cameraObject))
}

function removeSkybox(scene: THREE.Scene) {
  const skybox = scene.getObjectByName('HarmonySky')
  if (skybox?.parent) {
    skybox.parent.remove(skybox)
  }
  scene.environment = null
  scene.background = null
}

function stripSkeletonData(root: THREE.Object3D) {
  const skinnedMeshes: THREE.SkinnedMesh[] = []
  const bones: THREE.Object3D[] = []

  root.traverse((node) => {
    if ((node as any)?.isSkinnedMesh) {
      skinnedMeshes.push(node as THREE.SkinnedMesh)
    } else if ((node as any)?.isBone) {
      bones.push(node)
    }
  })

  skinnedMeshes.forEach((skinned) => {
    const parent = skinned.parent ?? root
    const originalIndex = parent.children.indexOf(skinned)
    const geometry = skinned.geometry.clone()
    if ('deleteAttribute' in geometry) {
      if (geometry.getAttribute('skinIndex')) {
        geometry.deleteAttribute('skinIndex')
      }
      if (geometry.getAttribute('skinWeight')) {
        geometry.deleteAttribute('skinWeight')
      }
    }

    const replacement = new THREE.Mesh(geometry, skinned.material)
    replacement.name = skinned.name
    replacement.position.copy(skinned.position)
    replacement.quaternion.copy(skinned.quaternion)
    replacement.scale.copy(skinned.scale)
    replacement.castShadow = skinned.castShadow
    replacement.receiveShadow = skinned.receiveShadow
    replacement.visible = skinned.visible
    replacement.matrix.copy(skinned.matrix)
    replacement.matrixAutoUpdate = skinned.matrixAutoUpdate
    replacement.frustumCulled = skinned.frustumCulled
    replacement.renderOrder = skinned.renderOrder
    replacement.userData = { ...skinned.userData }
    if (skinned.morphTargetInfluences) {
      replacement.morphTargetInfluences = [...skinned.morphTargetInfluences]
    }
    if (skinned.morphTargetDictionary) {
      replacement.morphTargetDictionary = { ...skinned.morphTargetDictionary }
    }

    parent.remove(skinned)
    parent.add(replacement)

    if (originalIndex >= 0) {
      const currentIndex = parent.children.indexOf(replacement)
      if (currentIndex > -1 && currentIndex !== originalIndex) {
        parent.children.splice(currentIndex, 1)
        parent.children.splice(Math.min(originalIndex, parent.children.length), 0, replacement)
      }
    }
  })

  bones.forEach((bone) => bone.parent?.remove(bone))
}

export function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.style.display = 'none'
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  requestAnimationFrame(() => URL.revokeObjectURL(url))
}

export async function prepareSceneExport(scene: THREE.Scene, options: SceneExportOptions): Promise<SceneExportResult> {
  if (!scene) {
    throw new Error('Scene not initialized')
  }

  const format = options.format ?? 'GLB'
  if (format !== 'GLB') {
    throw new Error(`Unsupported export format: ${format}`)
  }

  const onProgress = options.onProgress ?? (() => {})
  const includeTextures = options.includeTextures ?? true
  const includeAnimations = options.includeAnimations ?? true
  const includeSkybox = options.includeSkybox ?? true
  const includeLights = options.includeLights ?? true
  const includeHiddenNodes = options.includeHiddenNodes ?? true
  const includeSkeletons = options.includeSkeletons ?? true
  const includeCameras = options.includeCameras ?? true
  const includeExtras = options.includeExtras ?? true

  const baseName = normalizeBaseFileName(options.fileName)
  const fileName = `${baseName}.glb`

  onProgress(5, 'Cloning scene data...')
  const exportScene = clone(scene) as THREE.Scene

  onProgress(12, 'Preparing materials...')
  cloneMeshMaterials(exportScene)

  if (!includeSkybox) {
    onProgress(20, 'Removing skybox...')
    removeSkybox(exportScene)
  }

  if (!includeLights) {
    onProgress(28, 'Removing lights...')
    removeLights(exportScene)
  }

  if (!includeCameras) {
    onProgress(34, 'Removing cameras...')
    removeCameras(exportScene)
  }

  if (!includeSkeletons) {
    onProgress(42, 'Stripping skeleton data...')
    stripSkeletonData(exportScene)
  }

  if (!includeTextures) {
    onProgress(50, 'Stripping textures...')
    stripMaterialTextures(exportScene)
  }

  onProgress(65, 'Generating GLB file...')
  const blob = await exportGLB(exportScene, {
    includeAnimations,
    onlyVisible: includeHiddenNodes ? false : true,
    includeCustomExtensions: includeExtras,
  })

  onProgress(95, 'Preparing download...')
  onProgress(100, 'Export complete')

  return {
    blob,
    fileName,
  }
}
