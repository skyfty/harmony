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

  override load(
    url: string,
    onLoad?: (texture: CompressedTexture) => void,
    _onProgress?: (event: ProgressEvent<EventTarget>) => void,
    onError?: (err: unknown) => void,
  ): void {
    void this.fetchAndParse(url)
      .then((texture) => {
        onLoad?.(texture)
      })
      .catch((error) => {
        if (onError) {
          onError(error)
          return
        }

        console.error(error)
      })
  }

  override async loadAsync(
    url: string,
    _onProgress?: (event: ProgressEvent<EventTarget>) => void,
  ): Promise<CompressedTexture> {
    return await this.fetchAndParse(url)
  }

  private async fetchAndParse(url: string): Promise<CompressedTexture> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch KTX2 texture: ${response.status} ${response.statusText}`)
    }

    const result = await response.arrayBuffer()
    return await new Promise<CompressedTexture>((resolve, reject) => {
      ;(KTX2LoaderBase.prototype as unknown as {
        parse: (this: KTX2Loader, data: ArrayBuffer, onLoad?: (texture: CompressedTexture) => void, onError?: (err: unknown) => void) => void
      }).parse.call(
        this,
        result,
        resolve,
        reject,
      )
    })
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
