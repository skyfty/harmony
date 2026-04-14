import * as THREE from 'three'
import Loader, { type LoaderErrorPayload, type LoaderLoadedPayload, type LoaderProgressPayload } from './loader'
import { createUvDebugMaterial } from './debugTextures'
import { MeshBVH } from 'three-mesh-bvh'
import { normalizeScatterMaterials } from './scatterMaterials'

const DEFAULT_OBJECT_LOAD_TIMEOUT_MS = 45000

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

function createLoadTimeoutError(fileName: string): Error {
  return new Error(`加载资源对象超时 (${fileName})`)
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
  const options: LoadObjectOptions = typeof extensionOrOptions === 'object' && extensionOrOptions !== null
    ? (extensionOrOptions as LoadObjectOptions)
    : optionsParam

  return new Promise<THREE.Object3D>((resolve, reject) => {
    const loader = new Loader()
    let settled = false
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null

    const cleanup = () => {
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId)
        timeoutId = null
      }
      loader.removeEventListener('loaded', handleLoaded)
      loader.removeEventListener('error', handleError)
      if (options.onProgress) {
        loader.removeEventListener('progress', options.onProgress)
      }
    }

    timeoutId = globalThis.setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(createLoadTimeoutError(file.name))
    }, DEFAULT_OBJECT_LOAD_TIMEOUT_MS)

    const handleLoaded = (payload: LoaderLoadedPayload) => {
      if (settled) {
        return
      }
      settled = true
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

    const handleError = (payload: LoaderErrorPayload) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(payload instanceof Error ? payload : new Error(String(payload)))
    }

    loader.addEventListener('loaded', handleLoaded)
    loader.addEventListener('error', handleError)

    if (options.onProgress) {
      loader.addEventListener('progress', options.onProgress)
    }

    try {
      loader.loadFile(file)
    } catch (error) {
      settled = true
      cleanup()
      reject(error)
    }
  })
}
