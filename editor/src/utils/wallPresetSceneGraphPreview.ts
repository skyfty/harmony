import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { WallDynamicMesh } from '@schema'
import { WALL_COMPONENT_TYPE } from '@schema/components'
import { buildWallMesh } from '@schema/sceneGraph/dynamicMeshes/wall'
import { getCachedModelObject } from '@schema/modelObjectCache'
import {
  WALL_INSTANCED_BINDINGS_USERDATA_KEY,
  type WallInstancedBindingSpec,
} from '@schema/wallInstancing'
import { buildWallDynamicMeshFromWorldSegments } from '@/stores/wallUtils'
import { buildWallNodeMaterialsFromPreset } from '@/utils/wallPresetNodeMaterials'
import type { WallPresetData } from '@/utils/wallPreset'

export const WALL_PRESET_PREVIEW_SHARED_ASSET_USERDATA_KEY = '__harmonyWallPresetPreviewSharedAsset'

function normalizeWallInstancedBindingSpecs(object: THREE.Object3D | null | undefined): WallInstancedBindingSpec[] {
  const raw = (object?.userData as Record<string, unknown> | undefined)?.[WALL_INSTANCED_BINDINGS_USERDATA_KEY]
  return Array.isArray(raw)
    ? raw.filter((entry) => Boolean(entry && typeof entry === 'object')) as WallInstancedBindingSpec[]
    : []
}

function hasRenderableMesh(object: THREE.Object3D | null | undefined): boolean {
  if (!object) {
    return false
  }
  let found = false
  object.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      found = true
    }
  })
  return found
}


function resolveWallBindingSourceAssetId(binding: WallInstancedBindingSpec): string {
  const sourceAssetId = typeof binding.sourceAssetId === 'string' ? binding.sourceAssetId.trim() : ''
  if (sourceAssetId.length > 0) {
    return sourceAssetId
  }
  const assetId = typeof binding.assetId === 'string' ? binding.assetId.trim() : ''
  if (!assetId) {
    return ''
  }
  const variantSeparator = assetId.indexOf('#')
  return variantSeparator >= 0 ? assetId.slice(0, variantSeparator) : assetId
}

function cloneWallPreviewAssetObject(source: THREE.Object3D): THREE.Object3D {
  try {
    return cloneSkinned(source)
  } catch {
    return source.clone(true)
  }
}

function resolveWallBindingPreviewSource(binding: WallInstancedBindingSpec, loadedAssetObjects: Map<string, THREE.Object3D>): {
  object: THREE.Object3D | null
  sourceKind: 'loaded-binding' | 'loaded-source' | 'cached-binding' | 'cached-source' | 'missing'
  resolvedAssetId: string | null
} {
  const bindingAssetId = typeof binding.assetId === 'string' ? binding.assetId.trim() : ''
  const sourceAssetId = resolveWallBindingSourceAssetId(binding)

  const loadedBindingObject = bindingAssetId ? loadedAssetObjects.get(bindingAssetId) ?? null : null
  if (loadedBindingObject) {
    return { object: loadedBindingObject, sourceKind: 'loaded-binding', resolvedAssetId: bindingAssetId }
  }

  const loadedSourceObject = sourceAssetId ? loadedAssetObjects.get(sourceAssetId) ?? null : null
  if (loadedSourceObject) {
    return { object: loadedSourceObject, sourceKind: 'loaded-source', resolvedAssetId: sourceAssetId }
  }

  const cachedBindingObject = bindingAssetId ? getCachedModelObject(bindingAssetId)?.object ?? null : null
  if (cachedBindingObject) {
    return { object: cachedBindingObject, sourceKind: 'cached-binding', resolvedAssetId: bindingAssetId }
  }

  const cachedSourceObject = sourceAssetId ? getCachedModelObject(sourceAssetId)?.object ?? null : null
  if (cachedSourceObject) {
    return { object: cachedSourceObject, sourceKind: 'cached-source', resolvedAssetId: sourceAssetId }
  }

  return { object: null, sourceKind: 'missing', resolvedAssetId: null }
}

function materializeWallInstancedBindingsToPreviewMeshes(options: {
  wallObject: THREE.Object3D
  loadedAssetObjects: Map<string, THREE.Object3D>
}): { created: number; missingAssetIds: string[] } {
  const bindings = normalizeWallInstancedBindingSpecs(options.wallObject)
  if (!bindings.length) {
    return { created: 0, missingAssetIds: [] }
  }

  const materializedGroup = new THREE.Group()
  materializedGroup.name = 'WallPresetInstancedPreviewMeshes'
  const missingAssetIds = new Set<string>()
  let created = 0

  bindings.forEach((binding) => {
    const sourceAssetId = resolveWallBindingSourceAssetId(binding)
    if (!sourceAssetId) {
      return
    }

    const resolvedSource = resolveWallBindingPreviewSource(binding, options.loadedAssetObjects)
    const sourceObject = resolvedSource.object
    if (!sourceObject) {
      missingAssetIds.add(sourceAssetId)
      return
    }

    const localMatrices = Array.isArray(binding.localMatrices) ? binding.localMatrices : []
    localMatrices.forEach((matrix) => {
      if (!(matrix instanceof THREE.Matrix4)) {
        return
      }
      const cloned = cloneWallPreviewAssetObject(sourceObject)
      prepareWallPreviewImportedObject(cloned)
      cloned.traverse((child: THREE.Object3D) => {
        const mesh = child as THREE.Mesh
        if (!mesh?.isMesh) {
          return
        }
        mesh.userData = {
          ...(mesh.userData ?? {}),
          [WALL_PRESET_PREVIEW_SHARED_ASSET_USERDATA_KEY]: true,
        }
      })
      cloned.applyMatrix4(matrix)
      materializedGroup.add(cloned)
      created += 1
    })
  })

  if (created > 0) {
    options.wallObject.add(materializedGroup)
  }
  return { created, missingAssetIds: Array.from(missingAssetIds) }
}

export function prepareWallPreviewImportedObject(object: THREE.Object3D): THREE.Object3D {
  object.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh
    if (!mesh || !mesh.isMesh) {
      return
    }
    mesh.castShadow = true
    mesh.receiveShadow = true
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((mat) => {
        if (!mat) {
          return
        }
        mat.side = THREE.DoubleSide
        mat.needsUpdate = true
      })
    } else if (mesh.material) {
      mesh.material.side = THREE.DoubleSide
      mesh.material.needsUpdate = true
    }
  })
  return object
}

export function buildWallPresetPreviewDynamicMesh(
  preset: WallPresetData,
  options: { rectSizeMeters?: number } = {},
): WallDynamicMesh {
  const rectSize = typeof options.rectSizeMeters === 'number' && Number.isFinite(options.rectSizeMeters)
    ? Math.max(0.1, options.rectSizeMeters)
    : 3
  const half = rectSize * 0.5
  const built = buildWallDynamicMeshFromWorldSegments(
    [
      { start: { x: -half, y: 0, z: -half }, end: { x: half, y: 0, z: -half } },
      { start: { x: half, y: 0, z: -half }, end: { x: half, y: 0, z: half } },
      { start: { x: half, y: 0, z: half }, end: { x: -half, y: 0, z: half } },
      { start: { x: -half, y: 0, z: half }, end: { x: -half, y: 0, z: -half } },
    ],
    {
      height: preset.wallProps.height,
      width: preset.wallProps.width,
      thickness: preset.wallProps.thickness,
    },
  )

  if (!built) {
    throw new Error('无法构建墙体预览几何')
  }

  return {
    ...built.definition,
    bodyMaterialConfigId: preset.wallProps.bodyMaterialConfigId ?? preset.materialOrder?.[0] ?? null,
  }
}

export async function buildWallPresetPreviewObject(options: {
  preset: WallPresetData
  loadAssetMesh: (assetId: string) => Promise<THREE.Object3D | null>
}): Promise<THREE.Object3D | null> {
  const definition = buildWallPresetPreviewDynamicMesh(options.preset, { rectSizeMeters: 10 })
  const loadedAssetObjects = new Map<string, THREE.Object3D>()

  const node = {
    id: 'wall-preset-preview-node',
    name: options.preset.name || 'Wall Preset Preview',
    nodeType: 'Mesh',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    dynamicMesh: definition,
    components: {
      [WALL_COMPONENT_TYPE]: {
        enabled: true,
        props: options.preset.wallProps,
      },
    },
    materials: buildWallNodeMaterialsFromPreset(options.preset, []),
  } as any

  const tracedLoadAssetMesh = async (assetId: string): Promise<THREE.Object3D | null> => {
    const loaded = await options.loadAssetMesh(assetId)
    if (loaded) {
      loadedAssetObjects.set(assetId, loaded)
    }
    return loaded
  }

  const wallObject = await buildWallMesh(
    {
      loadAssetMesh: tracedLoadAssetMesh,
      resolveNodeMaterials: async () => [],
      pickMaterialAssignment: () => null,
      applyTransform: () => {},
      applyVisibility: () => {},
    },
    definition,
    node,
  )

  if (wallObject) {
    if (!hasRenderableMesh(wallObject)) {
      materializeWallInstancedBindingsToPreviewMeshes({
        wallObject,
        loadedAssetObjects,
      })
    }
  }

  return wallObject
}

export async function renderWallPresetThumbnailDataUrl(options: {
  preset: WallPresetData
  loadAssetMesh: (assetId: string) => Promise<THREE.Object3D | null>
  width: number
  height: number
}): Promise<string | null> {
  const wallObject = await buildWallPresetPreviewObject({
    preset: options.preset,
    loadAssetMesh: options.loadAssetMesh,
  })
  if (!wallObject) {
    return null
  }

  const disposeObject = (object: THREE.Object3D | null): void => {
    if (!object) {
      return
    }
    object.traverse((child: THREE.Object3D) => {
      const mesh = child as THREE.Mesh
      if (!mesh?.isMesh) {
        return
      }
      if ((mesh.userData as Record<string, unknown> | undefined)?.[WALL_PRESET_PREVIEW_SHARED_ASSET_USERDATA_KEY]) {
        return
      }
      mesh.geometry?.dispose?.()
      const material = mesh.material
      if (Array.isArray(material)) {
        material.forEach((entry) => entry?.dispose?.())
      } else {
        material?.dispose?.()
      }
    })
  }

  const fitCamera = (camera: THREE.PerspectiveCamera, object: THREE.Object3D): void => {
    const box = new THREE.Box3().setFromObject(object)
    if (box.isEmpty()) {
      camera.position.set(4, 3, 4)
      camera.lookAt(0, 0, 0)
      return
    }
    const center = box.getCenter(new THREE.Vector3())

    const corners: THREE.Vector3[] = [
      new THREE.Vector3(box.min.x, box.min.y, box.min.z),
      new THREE.Vector3(box.min.x, box.min.y, box.max.z),
      new THREE.Vector3(box.min.x, box.max.y, box.min.z),
      new THREE.Vector3(box.min.x, box.max.y, box.max.z),
      new THREE.Vector3(box.max.x, box.min.y, box.min.z),
      new THREE.Vector3(box.max.x, box.min.y, box.max.z),
      new THREE.Vector3(box.max.x, box.max.y, box.min.z),
      new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    ]

    const forward = new THREE.Vector3(1, 0.32, 1).normalize()
    const worldUp = new THREE.Vector3(0, 1, 0)
    const right = new THREE.Vector3().crossVectors(forward, worldUp)
    if (right.lengthSq() < 1e-6) {
      right.set(1, 0, 0)
    } else {
      right.normalize()
    }
    const up = new THREE.Vector3().crossVectors(right, forward).normalize()

    let halfWidth = 0
    let halfHeight = 0
    let halfDepth = 0
    corners.forEach((corner) => {
      const relative = corner.clone().sub(center)
      halfWidth = Math.max(halfWidth, Math.abs(relative.dot(right)))
      halfHeight = Math.max(halfHeight, Math.abs(relative.dot(up)))
      halfDepth = Math.max(halfDepth, Math.abs(relative.dot(forward)))
    })

    const vFov = THREE.MathUtils.degToRad(camera.fov)
    const hFov = 2 * Math.atan(Math.tan(vFov * 0.5) * camera.aspect)
    const distanceForWidth = halfWidth / Math.max(Math.tan(hFov * 0.5), 1e-5)
    const distanceForHeight = halfHeight / Math.max(Math.tan(vFov * 0.5), 1e-5)
    const fitDistance = Math.max(distanceForWidth, distanceForHeight, halfDepth + 0.1)
    const margin = 1.08
    const distance = fitDistance * margin

    const size = box.getSize(new THREE.Vector3())
    const radius = Math.max(size.length() * 0.5, 0.1)
    const cameraPosition = center.clone().addScaledVector(forward, distance)
    camera.position.copy(cameraPosition)
    camera.near = Math.max(0.01, distance - radius * 1.5)
    camera.far = Math.max(100, distance + radius * 1.5)
    camera.lookAt(center)
    camera.updateProjectionMatrix()

  }

  const width = Math.max(1, Math.round(options.width))
  const height = Math.max(1, Math.round(options.height))

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  scene.background = null
  const camera = new THREE.PerspectiveCamera(45, width / Math.max(height, 1), 0.1, 1000)

  const ambient = new THREE.AmbientLight(0xffffff, 1.5)
  const directional = new THREE.DirectionalLight(0xffffff, 2)
  directional.position.set(5, 10, 7.5)
  const fill = new THREE.DirectionalLight(0xffffff, 1)
  fill.position.set(-5, 2, -6)

  scene.add(ambient)
  scene.add(directional)
  scene.add(fill)
  scene.add(wallObject)

  fitCamera(camera, wallObject)
  renderer.render(scene, camera)

  const dataUrl = renderer.domElement.toDataURL('image/png')

  scene.remove(wallObject)
  scene.remove(ambient)
  scene.remove(directional)
  scene.remove(fill)
  disposeObject(wallObject)

  renderer.dispose()
  if (typeof renderer.forceContextLoss === 'function') {
    renderer.forceContextLoss()
  }

  return dataUrl
}
