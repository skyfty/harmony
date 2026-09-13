import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import Loader, { type LoaderErrorPayload, type LoaderLoadedPayload, type LoaderProgressPayload } from './loader'
import { createUvDebugMaterial } from './debugTextures'
import { normalizeScatterMaterials } from './scatterMaterials'
import { isGltfParseWorkerConfigured, parseGltfWithWorker } from './gltfParse'

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
        side: THREE.FrontSide,
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
            side: THREE.FrontSide,
          })
        }

        material.side = THREE.FrontSide

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

    material.side = THREE.FrontSide

    material.needsUpdate = true
  })
}

export function prepareImportedObject(object: THREE.Object3D) {
  object.removeFromParent()

  object.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      const geometry = mesh.geometry as THREE.BufferGeometry | undefined
      const morphAttributes = geometry?.morphAttributes
      const morphTargets = morphAttributes?.position || morphAttributes?.normal || morphAttributes?.color || null
      if (morphTargets && morphTargets.length > 0 && !mesh.morphTargetInfluences) {
        mesh.morphTargetInfluences = new Array(morphTargets.length).fill(0)
      }
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
  return new Error(`Timed out while loading asset object (${fileName})`)
}

export function cloneImportedObject(source: THREE.Object3D): THREE.Object3D {
  const cloned = cloneSkinned(source)
  const sourceAnimations = (source as unknown as { animations?: THREE.AnimationClip[] })?.animations ?? []

  if (sourceAnimations.length) {
    const animations = sourceAnimations.map((clip) => clip.clone())
    ;(cloned as unknown as { animations?: THREE.AnimationClip[] }).animations = animations
    cloned.userData = cloned.userData ?? {}
    cloned.userData.__animations = animations.map((clip) => clip.name)
    return cloned
  }

  const userDataAnimationNames = Array.isArray((source as any)?.userData?.__animations)
    ? ((source as any).userData.__animations as string[]).filter((name) => typeof name === 'string' && name.trim().length)
    : []
  if (userDataAnimationNames.length) {
    cloned.userData = cloned.userData ?? {}
    cloned.userData.__animations = [...userDataAnimationNames]
  }

  return cloned
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(reader.result as ArrayBuffer))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('读取资源文件失败')))
    reader.addEventListener('abort', () => reject(new Error('读取资源文件被取消')))
    reader.readAsArrayBuffer(file)
  })
}

async function tryLoadGlbViaWorker(file: File): Promise<THREE.Object3D | null> {
  try {
    const buffer = await readFileAsArrayBuffer(file)
    const object = await parseGltfWithWorker(buffer)
    if (!object) {
      return null
    }
    prepareImportedObject(object)
    normalizeImportedMeshMaterials(object)
    normalizeScatterMaterials(object)
    return object
  } catch {
    return null
  }
}

export async function loadObjectFromFile(
  file: File,
  extensionOrOptions?: string | LoadObjectOptions,
  optionsParam: LoadObjectOptions = {},
): Promise<THREE.Object3D> {
  const options: LoadObjectOptions = typeof extensionOrOptions === 'object' && extensionOrOptions !== null
    ? (extensionOrOptions as LoadObjectOptions)
    : optionsParam

  const inferredExt = typeof extensionOrOptions === 'string'
    ? extensionOrOptions.toLowerCase()
    : (file.name.split('.').pop() ?? '').toLowerCase()

  // Offload the CPU-heavy GLB parse (JSON + accessor decode + geometry build) to
  // a worker when configured. The serializer is conservative: anything it cannot
  // faithfully represent returns null and we fall through to the synchronous
  // GLTFLoader.parse path below.
  if (inferredExt === 'glb' && isGltfParseWorkerConfigured()) {
    const workerResult = await tryLoadGlbViaWorker(file)
    if (workerResult) {
      return workerResult
    }
  }

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

    const handleLoaded = async (payload: LoaderLoadedPayload) => {
      if (settled) {
        return
      }
      try {
        if (!payload) {
          throw new Error('Failed to load asset object')
        }
        const object = payload as THREE.Object3D
        prepareImportedObject(object)
        normalizeImportedMeshMaterials(object)
        normalizeScatterMaterials(object)
        if (settled) {
          return
        }
        settled = true
        cleanup()
        resolve(object)
      } catch (error) {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
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
