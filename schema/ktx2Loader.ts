import * as THREE from 'three'
import { KTX2Loader as KTX2LoaderBase } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { CompressedTexture } from "three";

const DEFAULT_KTX2_TRANSCODER_PATH = '../examples/jsm/libs/basis/'
export const FAST_KTX2_TRANSCODER_PATH = 'https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/libs/basis/'

export interface Ktx2LoaderOptions {
  manager?: THREE.LoadingManager
  transcoderPath?: string
}

export class KTX2Loader extends KTX2LoaderBase {

  constructor(manager?: THREE.LoadingManager) {
    super(manager)
  }

  async loadAsync(url: string, _onProgress?: (event: ProgressEvent<EventTarget>) => void): Promise<THREE.Texture> {
    const response = await fetch(url)
    const result = await response.arrayBuffer()
    return this.parse(result)
  }

  async parse(data: ArrayBuffer, onLoad?: (texture: CompressedTexture) => void, onError?: (err: unknown) => void):void {
    return super.parse(data, onLoad, onError)
  }
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
  return new KTX2Loader(options.manager)
      .setTranscoderPath(transcoderPath)
      .detectSupport(renderer)
}
