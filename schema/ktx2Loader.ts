import * as THREE from 'three'
import { CompressedTexture } from 'three'
import { KTX2Loader as KTX2LoaderBase } from 'three/examples/jsm/loaders/KTX2Loader.js'

export const DEFAULT_KTX2_TRANSCODER_PATH = '../examples/jsm/libs/basis/'

// Kept for backward compatibility with existing call sites. The loader below
// now prefers the bundled Basis transcoder assets instead of a CDN path.
export const FAST_KTX2_TRANSCODER_PATH = 'https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/libs/basis/'

export interface Ktx2LoaderOptions {
  manager?: THREE.LoadingManager
  transcoderPath?: string
}

type KTX2LoaderWorkerConfig = {
  astcSupported: boolean
  astcHDRSupported: boolean
  etc1Supported: boolean
  etc2Supported: boolean
  dxtSupported: boolean
  bptcSupported: boolean
  pvrtcSupported: boolean
}

const BASIS_TRANSCODER_JS_URL = `${FAST_KTX2_TRANSCODER_PATH}basis_transcoder.js`
const BASIS_TRANSCODER_WASM_URL = `${FAST_KTX2_TRANSCODER_PATH}basis_transcoder.wasm`

const KTX2_STATIC_FIELDS = KTX2LoaderBase as unknown as {
  BasisWorker: { toString(): string }
  EngineFormat: Record<string, unknown>
  EngineType: Record<string, unknown>
  TranscoderFormat: Record<string, unknown>
  BasisFormat: Record<string, unknown>
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch KTX2 transcoder script: ${response.status} ${response.statusText}`)
  }
  return await response.text()
}

async function createKtx2WorkerSource(): Promise<string> {
  const jsContent = await fetchText(BASIS_TRANSCODER_JS_URL)
  const fn = KTX2_STATIC_FIELDS.BasisWorker.toString()
  return [
    '/* constants */',
    'let _EngineFormat = ' + JSON.stringify(KTX2_STATIC_FIELDS.EngineFormat),
    'let _EngineType = ' + JSON.stringify(KTX2_STATIC_FIELDS.EngineType),
    'let _TranscoderFormat = ' + JSON.stringify(KTX2_STATIC_FIELDS.TranscoderFormat),
    'let _BasisFormat = ' + JSON.stringify(KTX2_STATIC_FIELDS.BasisFormat),
    '/* basis_transcoder.js */',
    jsContent,
    '/* worker */',
    fn.substring(fn.indexOf('{') + 1, fn.lastIndexOf('}')),
  ].join('\n')
}

async function fetchWasmBinary(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch KTX2 transcoder wasm: ${response.status} ${response.statusText}`)
  }
  return await response.arrayBuffer()
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

  async init(): Promise<void> {
    if (this.transcoderPending) {
      return await this.transcoderPending
    }

    const workerSource = await createKtx2WorkerSource()
    this.workerSourceURL = URL.createObjectURL(new Blob([workerSource], { type: 'application/javascript' }))

    this.transcoderPending = fetchWasmBinary(BASIS_TRANSCODER_WASM_URL)
      .then((binaryContent) => {
        this.transcoderBinary = binaryContent

        this.workerPool.setWorkerCreator(() => {
          const worker = new Worker(this.workerSourceURL)
          const transcoderBinary = this.transcoderBinary!.slice(0)

          worker.postMessage({ type: 'init', config: this.workerConfig as KTX2LoaderWorkerConfig, transcoderBinary }, [transcoderBinary])

          return worker
        })
      })

    return await this.transcoderPending
  }

  private async fetchAndParse(url: string): Promise<CompressedTexture> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch KTX2 texture: ${response.status} ${response.statusText}`)
    }

    const result = await response.arrayBuffer()
    return await new Promise<CompressedTexture>((resolve, reject) => {
      ;(KTX2LoaderBase.prototype as unknown as {
        parse: (
          this: KTX2Loader,
          data: ArrayBuffer,
          onLoad?: (texture: CompressedTexture) => void,
          onError?: (err: unknown) => void,
        ) => void
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
  if (typeof renderer.dispose === 'function') {
    renderer.dispose()
  }
  if (typeof renderer.forceContextLoss === 'function') {
    renderer.forceContextLoss()
  }
}

export async function createKtx2Loader(
  renderer: THREE.WebGLRenderer,
  options: Ktx2LoaderOptions = {},
): Promise<KTX2Loader> {
  void options.transcoderPath
  const loader = new KTX2Loader(options.manager)
  return loader.detectSupport(renderer)
}
