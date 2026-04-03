import * as THREE from 'three'
import Loader, { type LoaderLoadedPayload, type LoaderProgressPayload } from './loader'
import { createUvDebugMaterial } from './debugTextures'
import { MeshBVH } from 'three-mesh-bvh'
import { normalizeScatterMaterials } from './scatterMaterials'

export interface LoadObjectOptions {
  onProgress?: (payload: LoaderProgressPayload) => void
}

function normalizeImportedMeshMaterials(object: THREE.Object3D): void {
  object.traverse((child: THREE.Object3D) => {
    const mesh = child as unknown as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }

    const rawMaterial = (mesh as any).material as THREE.Material | THREE.Material[] | null | undefined
    if (!rawMaterial || (Array.isArray(rawMaterial) && rawMaterial.length === 0)) {
      ;(mesh as any).material = createUvDebugMaterial({
        tint: 0xffffff,
        side: THREE.DoubleSide,
      })
      return
    }
    if (Array.isArray(rawMaterial)) {
      let changed = false
      const normalized = rawMaterial.map((material) => {
        if (!material) {
          changed = true
          return createUvDebugMaterial({
            tint: 0xffffff,
            side: THREE.DoubleSide,
          })
        }

        material.side = THREE.DoubleSide

        material.needsUpdate = true
        return material
      })

      if (changed) {
        ;(mesh as any).material = normalized
      }

      return
    }

    const material = rawMaterial
    if (!material) {
      return
    }

    material.side = THREE.DoubleSide

    material.needsUpdate = true
  })
}

export function prepareImportedObject(object: THREE.Object3D) {
  object.removeFromParent()

  object.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
    child.matrixAutoUpdate = true
  })

  object.updateMatrixWorld(true)

  const boundingBox = new THREE.Box3().setFromObject(object)
  if (!boundingBox.isEmpty()) {
    const center = boundingBox.getCenter(new THREE.Vector3())
    const minY = boundingBox.min.y

    object.position.sub(center)
    object.position.y -= (minY - center.y)
    object.updateMatrixWorld(true)
  }
}

function buildObjectBvh(object: THREE.Object3D): void {
  object.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }

    const geometry = mesh.geometry as THREE.BufferGeometry | undefined
    if (!geometry || !geometry.getAttribute('position')) {
      return
    }

    const anyGeometry = geometry as unknown as { boundsTree?: MeshBVH }
    if (anyGeometry.boundsTree) {
      return
    }

    try {
      anyGeometry.boundsTree = new MeshBVH(geometry)
    } catch (_error) {
      // 忽略 BVH 构建失败，避免影响模型加载
    }
  })
}

export async function loadObjectFromFile(
  file: File,
  extensionOrOptions?: string | LoadObjectOptions,
  optionsParam: LoadObjectOptions = {},
): Promise<THREE.Object3D> {
  const extension = typeof extensionOrOptions === 'string' ? extensionOrOptions : undefined
  const options: LoadObjectOptions = typeof extensionOrOptions === 'object' && extensionOrOptions !== null
    ? (extensionOrOptions as LoadObjectOptions)
    : optionsParam

  return new Promise<THREE.Object3D>((resolve, reject) => {
    const loader = new Loader()

    const cleanup = () => {
      loader.removeEventListener('loaded', handleLoaded)
      if (options.onProgress) {
        loader.removeEventListener('progress', options.onProgress)
      }
    }

    const handleLoaded = (payload: LoaderLoadedPayload) => {
      cleanup()
      if (!payload) {
        reject(new Error('未能加载资源对象'))
        return
      }
      const object = payload as THREE.Object3D
      prepareImportedObject(object)
      normalizeImportedMeshMaterials(object)
      normalizeScatterMaterials(object)
      buildObjectBvh(object)
      resolve(object)
    }

    loader.addEventListener('loaded', handleLoaded)

    if (options.onProgress) {
      loader.addEventListener('progress', options.onProgress)
    }

    try {
      loader.loadFile(file, extension)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
