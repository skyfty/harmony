import * as THREE from 'three'
import Loader, { type LoaderLoadedPayload, type LoaderProgressPayload } from './loader'
import { createUvDebugMaterial } from './debugTextures'

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

        // const anyMaterial = material as any
        // const opacity = typeof anyMaterial.opacity === 'number' ? anyMaterial.opacity : 1
        // const alphaTest = typeof anyMaterial.alphaTest === 'number' ? anyMaterial.alphaTest : 0
        // const hasAlphaMap = Boolean(anyMaterial.alphaMap)
        // const hasMap = Boolean(anyMaterial.map)
        // const transmission = typeof anyMaterial.transmission === 'number' ? anyMaterial.transmission : 0
        // const thickness = typeof anyMaterial.thickness === 'number' ? anyMaterial.thickness : 0

        // const isActuallyTranslucent = opacity < 0.999 || transmission > 0 || thickness > 0
        // const mightNeedAlpha = hasAlphaMap || alphaTest > 0

        // if (anyMaterial.transparent === true && !isActuallyTranslucent && !mightNeedAlpha && !hasMap) {
        //   anyMaterial.transparent = false
        //   if (typeof anyMaterial.depthWrite === 'boolean') {
        //     anyMaterial.depthWrite = true
        //   }
        // }

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

    // const anyMaterial = material as any
    // const opacity = typeof anyMaterial.opacity === 'number' ? anyMaterial.opacity : 1
    // const alphaTest = typeof anyMaterial.alphaTest === 'number' ? anyMaterial.alphaTest : 0
    // const hasAlphaMap = Boolean(anyMaterial.alphaMap)
    // const hasMap = Boolean(anyMaterial.map)
    // const transmission = typeof anyMaterial.transmission === 'number' ? anyMaterial.transmission : 0
    // const thickness = typeof anyMaterial.thickness === 'number' ? anyMaterial.thickness : 0

    // const isActuallyTranslucent = opacity < 0.999 || transmission > 0 || thickness > 0
    // const mightNeedAlpha = hasAlphaMap || alphaTest > 0

    // if (anyMaterial.transparent === true && !isActuallyTranslucent && !mightNeedAlpha && !hasMap) {
    //   anyMaterial.transparent = false
    //   if (typeof anyMaterial.depthWrite === 'boolean') {
    //     anyMaterial.depthWrite = true
    //   }
    // }

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
