import * as THREE from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

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

export type ExportFormat = 'OBJ' | 'PLY' | 'STL' | 'GLTF' | 'GLB'

export interface SceneExportOptions {
    format: ExportFormat
    fileName?: string
    includeTextures?: boolean
    includeAnimations?: boolean
    includeSkybox?: boolean
    includeLights?: boolean
    includeHiddenNodes?: boolean
    includeSkeletons?: boolean
    includeCameras?: boolean
    includeExtras?: boolean
  rotateCoordinateSystem?: boolean
    onProgress?: (progress: number, message?: string) => void
}

export interface GLBExportSettings {
    includeAnimations?: boolean
    onlyVisible?: boolean
    includeCustomExtensions?: boolean
}

type RemovedSceneObject = {
    parent: THREE.Object3D
    object: THREE.Object3D
    index: number
}

const EDITOR_HELPER_TYPES = new Set<string>([
    'GridHelper',
    'AxesHelper',
    'Box3Helper',
    'PointLightHelper',
    'SpotLightHelper',
    'DirectionalLightHelper',
    'RectAreaLightHelper',
    'HemisphereLightHelper',
    'TransformControls',
    'TransformControlsGizmo',
    'TransformControlsPlane',
])

const EDITOR_HELPER_NAMES = new Set<string>([
    'DragPreview',
    'GridHighlight',
])

const LIGHT_HELPER_NAME_SUFFIX = 'LightHelper'

function getAnimations(scene: THREE.Scene) {

    const animations: THREE.AnimationClip[] = [];

    scene.traverse(function (object) {

        animations.push(...object.animations);

    });

    return animations;

}

function shouldExcludeFromGLTF(object: THREE.Object3D) {
    if (!object.parent) {
        return false
    }

    const name = object.name ?? ''
    if (name && (EDITOR_HELPER_NAMES.has(name) || name.endsWith(LIGHT_HELPER_NAME_SUFFIX))) {
        return true
    }

    if (EDITOR_HELPER_TYPES.has(object.type)) {
        return true
    }

    if ((object as any).isTransformControlsRoot) {
        return true
    }

    return false
}

function collectEditorHelpers(root: THREE.Object3D) {
    const helpers: THREE.Object3D[] = []
    const stack: THREE.Object3D[] = [...root.children]

    while (stack.length > 0) {
        const current = stack.pop()
        if (!current) {
            continue
        }
        if (shouldExcludeFromGLTF(current)) {
            helpers.push(current)
            continue
        }

        for (const child of current.children) {
            stack.push(child)
        }
    }

    return helpers
}

function removeEditorHelpers(scene: THREE.Scene) {
    const helpers = collectEditorHelpers(scene)
    const removed: RemovedSceneObject[] = []

    for (const helper of helpers) {
        const parent = helper.parent
        if (!parent) {
            continue
        }

        const index = parent.children.indexOf(helper)
        if (index === -1) {
            continue
        }

        parent.remove(helper)
        removed.push({ parent, object: helper, index })
    }

    return removed
}

export function restoreRemovedObjects(removed: RemovedSceneObject[]) {
    for (const { parent, object, index } of removed) {
        parent.add(object)

        if (index >= 0 && index < parent.children.length - 1) {
            const currentIndex = parent.children.indexOf(object)
            if (currentIndex > -1 && currentIndex !== index) {
                parent.children.splice(currentIndex, 1)
                const targetIndex = Math.min(index, parent.children.length)
                parent.children.splice(targetIndex, 0, object)
            }
        }
    }
}

async function exportGLB(scene: THREE.Scene, settings?: GLBExportSettings) {
    const includeAnimations = settings?.includeAnimations !== false
    const animations = includeAnimations ? getAnimations(scene) : []
    const optimizedAnimations = []
    if (includeAnimations) {
        for ( const animation of animations ) {
            optimizedAnimations.push( animation.clone().optimize() );
        }
    }
    const exporter = new GLTFExporter()
    const result = await exporter.parseAsync( scene,{
        binary: true,
        animations: optimizedAnimations,
        onlyVisible: settings?.onlyVisible ?? true,
        includeCustomExtensions: settings?.includeCustomExtensions ?? true,
    });
    const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
    return blob;
}

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

function rotateSceneForCoordinateSystem(scene: THREE.Scene) {
  // Flip handedness by rotating every root node 180° around the Y axis
  if (!scene.children.length) {
    return
  }
  const rotation = new THREE.Matrix4().makeRotationY(Math.PI)
  for (const child of scene.children) {
    child.applyMatrix4(rotation)
    child.updateMatrixWorld(true)
  }
  scene.applyMatrix4(rotation)
  scene.updateMatrixWorld(true)
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
  removeEditorHelpers(exportScene)

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

  if (options.rotateCoordinateSystem) {
    onProgress(58, 'Adjusting coordinate system...')
    rotateSceneForCoordinateSystem(exportScene)
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
