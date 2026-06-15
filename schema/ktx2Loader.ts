import * as THREE from 'three'
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

type KTX2LoaderClass = new (manager?: THREE.LoadingManager) => KTX2Loader

let ktx2LoaderClassPromise: Promise<KTX2LoaderClass> | null = null
const ktx2LoaderCache = new Map<string, Promise<KTX2Loader>>()

const DEFAULT_KTX2_TRANSCODER_PATH = '../examples/jsm/libs/basis/'
export const FAST_KTX2_TRANSCODER_PATH = 'https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/libs/basis/'

export interface Ktx2LoaderOptions {
  manager?: THREE.LoadingManager
  transcoderPath?: string
}

export function createKtx2SupportRenderer(): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  return renderer
}

export function disposeKtx2SupportRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.dispose()
  if (typeof renderer.forceContextLoss === 'function') {
    renderer.forceContextLoss()
  }
}

export async function createKtx2Loader(
  renderer: THREE.WebGLRenderer,
  options: Ktx2LoaderOptions = {},
): Promise<KTX2Loader> {
  const transcoderPath = options.transcoderPath ?? DEFAULT_KTX2_TRANSCODER_PATH
  const cacheKey = transcoderPath
  const cachedLoaderPromise = ktx2LoaderCache.get(cacheKey)
  if (cachedLoaderPromise) {
    return await cachedLoaderPromise
  }

  const loaderPromise = (async (): Promise<KTX2Loader> => {
    if (!ktx2LoaderClassPromise) {
      ktx2LoaderClassPromise = import('three/examples/jsm/loaders/KTX2Loader.js').then(
        (module) => module.KTX2Loader as KTX2LoaderClass,
      )
    }
    const LoaderClass = await ktx2LoaderClassPromise
    return new LoaderClass(options.manager)
      .setTranscoderPath(transcoderPath)
      .detectSupport(renderer)
  })()

  ktx2LoaderCache.set(cacheKey, loaderPromise)
  try {
    return await loaderPromise
  } catch (error) {
    if (ktx2LoaderCache.get(cacheKey) === loaderPromise) {
      ktx2LoaderCache.delete(cacheKey)
    }
    throw error
  }
}
