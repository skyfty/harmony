import * as THREE from 'three'
import Loader, { type LoaderLoadedPayload, type LoaderProgressPayload } from '@schema/loader'

export interface LoadObjectOptions {
  onProgress?: (payload: LoaderProgressPayload) => void
}

export function prepareImportedObject(object: THREE.Object3D) {
  object.removeFromParent()

  object.traverse((child) => {
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

export async function loadObjectFromFile(file: File, options: LoadObjectOptions = {}): Promise<THREE.Object3D> {
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
      resolve(object)
    }

    loader.addEventListener('loaded', handleLoaded)

    if (options.onProgress) {
      loader.addEventListener('progress', options.onProgress)
    }

    try {
      loader.loadFile(file)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
