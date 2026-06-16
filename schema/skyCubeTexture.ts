import * as THREE from 'three'
import { unzipSync } from 'fflate'
import { inferMimeTypeFromAssetId } from './assetTypeConversion'

export const SKY_CUBE_FACE_KEYS = [
  'positiveX',
  'negativeX',
  'positiveY',
  'negativeY',
  'positiveZ',
  'negativeZ',
] as const

export type SkyCubeFaceKey = (typeof SKY_CUBE_FACE_KEYS)[number]

export const SKY_CUBE_FACE_ORDER: ReadonlyArray<SkyCubeFaceKey> = SKY_CUBE_FACE_KEYS

export const SKY_CUBE_FACE_LABELS: Record<SkyCubeFaceKey, { label: string; description: string }> = {
  positiveX: { label: '+X', description: 'Right' },
  negativeX: { label: '-X', description: 'Left' },
  positiveY: { label: '+Y', description: 'Top' },
  negativeY: { label: '-Y', description: 'Bottom' },
  positiveZ: { label: '+Z', description: 'Front' },
  negativeZ: { label: '-Z', description: 'Back' },
}

export interface SkyCubeTextureLoadResult {
  texture: THREE.CubeTexture | null
  missingFaces: SkyCubeFaceKey[]
  failedFaces: SkyCubeFaceKey[]
  error?: string
}

export interface SkyCubeTextureLoadOptions {
  /**
   * Passed to the underlying ImageLoader via CubeTextureLoader.
   * Defaults to 'anonymous'.
   */
  crossOrigin?: string
  /**
   * A valid URL used for missing faces. Defaults to a 1x1 black PNG data URL.
   * Using a placeholder allows partial face selection without failing the entire load.
   */
  placeholderUrl?: string
  /**
   * If true, sets texture.colorSpace = THREE.SRGBColorSpace (recommended for LDR images).
   * Defaults to true.
   */
  assumeSrgb?: boolean

  /**
   * If true, flips the cube texture vertically.
   * Defaults to true to match typical image asset orientation in this repo.
   */
  flipY?: boolean
}

export interface SkycubeZipFaceBytes {
  key: SkyCubeFaceKey
  filename: string
  bytes: Uint8Array
  mimeType: string | null
}

export interface ExtractSkycubeZipFacesResult {
  /** Faces in fixed Three.js CubeTextureLoader order: +X, -X, +Y, -Y, +Z, -Z. */
  facesInOrder: Array<SkycubeZipFaceBytes | null>
  missingFaces: SkyCubeFaceKey[]
  /** Additional candidates that matched a face token but were not selected. */
  discarded: Array<{ key: SkyCubeFaceKey; filename: string }>
}

export type SkyCubeZipExtractorWorkerFactory = () => Worker | null

type SerializedSkycubeZipFaceBytes = {
  key: SkyCubeFaceKey
  filename: string
  bytes: ArrayBuffer
  mimeType: string | null
}

type SkyCubeZipExtractorWorkerResult = {
  facesInOrder: Array<SerializedSkycubeZipFaceBytes | null>
  missingFaces: SkyCubeFaceKey[]
  discarded: Array<{ key: SkyCubeFaceKey; filename: string }>
}

type SkyCubeZipExtractorWorkerRequest = {
  type: 'extract'
  requestId: number
  zip: ArrayBuffer
}

type SkyCubeZipExtractorWorkerResponse =
  | {
      type: 'result'
      requestId: number
      result: SkyCubeZipExtractorWorkerResult
    }
  | {
      type: 'error'
      requestId: number
      message: string
    }

type SkyCubeTextureRuntimeState = {
  skyCubeZipExtractorWorkerFactory: SkyCubeZipExtractorWorkerFactory | null
}

const SKY_CUBE_TEXTURE_RUNTIME_STATE_KEY = '__harmony_schema_skycube_texture_runtime_state__'

function getSkyCubeTextureRuntimeState(): SkyCubeTextureRuntimeState {
  const globalObject = globalThis as typeof globalThis & {
    [SKY_CUBE_TEXTURE_RUNTIME_STATE_KEY]?: SkyCubeTextureRuntimeState
  }
  if (!globalObject[SKY_CUBE_TEXTURE_RUNTIME_STATE_KEY]) {
    globalObject[SKY_CUBE_TEXTURE_RUNTIME_STATE_KEY] = {
      skyCubeZipExtractorWorkerFactory: null,
    }
  }
  return globalObject[SKY_CUBE_TEXTURE_RUNTIME_STATE_KEY]!
}

export function configureSkyCubeZipExtractorWorkerFactory(factory: SkyCubeZipExtractorWorkerFactory | null): void {
  getSkyCubeTextureRuntimeState().skyCubeZipExtractorWorkerFactory = factory
}

const DEFAULT_PLACEHOLDER_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6X9o0wAAAAASUVORK5CYII='

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function normalizeSkyCubeUrls(
  urlsInOrder: ReadonlyArray<string | null | undefined>,
): Array<string | null> {
  const result: Array<string | null> = []
  for (let i = 0; i < SKY_CUBE_FACE_KEYS.length; i += 1) {
    result.push(normalizeUrl(urlsInOrder[i]) ?? null)
  }
  return result
}

export async function loadSkyCubeTexture(
  urlsInOrder: ReadonlyArray<string | null | undefined>,
  options: SkyCubeTextureLoadOptions = {},
): Promise<SkyCubeTextureLoadResult> {
  const normalized = normalizeSkyCubeUrls(urlsInOrder)
  const missingFaces: SkyCubeFaceKey[] = []

  const placeholderUrl = normalizeUrl(options.placeholderUrl) ?? DEFAULT_PLACEHOLDER_PNG
  const resolvedUrls = normalized.map((url, index) => {
    if (url) {
      return url
    }
    missingFaces.push(SKY_CUBE_FACE_KEYS[index]!)
    return placeholderUrl
  })

  if (missingFaces.length === SKY_CUBE_FACE_KEYS.length) {
    return {
      texture: null,
      missingFaces,
      failedFaces: [],
    }
  }

  const loader = new THREE.CubeTextureLoader()
  loader.setCrossOrigin(options.crossOrigin ?? 'anonymous')

  try {
    const texture = await loader.loadAsync(resolvedUrls)
    texture.flipY = options.flipY ?? true
    if (options.assumeSrgb !== false) {
      texture.colorSpace = THREE.SRGBColorSpace
    }
    texture.needsUpdate = true
    return {
      texture,
      missingFaces,
      failedFaces: [],
    }
  } catch (error) {
    return {
      texture: null,
      missingFaces,
      failedFaces: [...SKY_CUBE_FACE_KEYS],
      error: (error as Error)?.message ?? String(error),
    }
  }
}

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

function normalizeZipEntryName(name: string): string {
  return name.replace(/\\/g, '/').toLowerCase()
}

function containsFaceToken(nameLower: string, token: string): { index: number } | null {
  // Require non-alphanumeric boundaries to avoid accidental matches (e.g. "complex" containing "px").
  const re = new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, 'i')
  const match = re.exec(nameLower)
  if (!match) {
    return null
  }
  return { index: match.index }
}

function scoreCandidate(filenameLower: string, tokenIndex: number): number {
  // Lower score wins.
  // Prefer earlier token matches and shorter filenames.
  return tokenIndex * 1000 + filenameLower.length
}

/**
 * Extracts SkyCube face images from a `.skycube` zip archive.
 *
 * Matching rule: any zip entry whose filename contains `px|nx|py|ny|pz|nz` as a token
 * (case-insensitive, separated by non-alphanumeric boundaries) is considered.
 */
export function extractSkycubeZipFaces(zip: ArrayBuffer | Uint8Array): ExtractSkycubeZipFacesResult {
  const files = unzipSync(toUint8Array(zip))

  const tokenToKey: Record<string, SkyCubeFaceKey> = {
    px: 'positiveX',
    nx: 'negativeX',
    py: 'positiveY',
    ny: 'negativeY',
    pz: 'positiveZ',
    nz: 'negativeZ',
  }

  const best: Partial<Record<SkyCubeFaceKey, { filename: string; bytes: Uint8Array; score: number }>> = {}
  const discarded: Array<{ key: SkyCubeFaceKey; filename: string }> = []

  for (const [rawName, bytes] of Object.entries(files)) {
    if (!bytes || !(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      continue
    }
    if (rawName.endsWith('/')) {
      continue
    }
    const nameLower = normalizeZipEntryName(rawName)
    for (const token of Object.keys(tokenToKey)) {
      const hit = containsFaceToken(nameLower, token)
      if (!hit) {
        continue
      }
      const key = tokenToKey[token]!
      const score = scoreCandidate(nameLower, hit.index)
      const existing = best[key]
      if (!existing || score < existing.score) {
        if (existing) {
          discarded.push({ key, filename: existing.filename })
        }
        best[key] = { filename: rawName, bytes, score }
      } else {
        discarded.push({ key, filename: rawName })
      }
      break
    }
  }

  const facesInOrder: Array<SkycubeZipFaceBytes | null> = []
  const missingFaces: SkyCubeFaceKey[] = []
  for (const key of SKY_CUBE_FACE_ORDER) {
    const selected = best[key]
    if (!selected) {
      facesInOrder.push(null)
      missingFaces.push(key)
      continue
    }
    facesInOrder.push({
      key,
      filename: selected.filename,
      bytes: selected.bytes,
      mimeType: inferMimeTypeFromAssetId(selected.filename),
    })
  }

  return {
    facesInOrder,
    missingFaces,
    discarded,
  }
}

export async function extractSkycubeZipFacesAsync(zip: ArrayBuffer | Uint8Array): Promise<ExtractSkycubeZipFacesResult> {
  const factory = getSkyCubeTextureRuntimeState().skyCubeZipExtractorWorkerFactory
  if (typeof Worker === 'undefined' || typeof factory !== 'function') {
    throw new Error('SkyCube ZIP worker 未配置')
  }
  const worker = factory()
  if (!worker) {
    throw new Error('SkyCube ZIP worker 创建失败')
  }
  console.info('[harmony-schema][skycube-zip] using worker extractor')
  return await extractSkycubeZipFacesViaWorker(worker, zip)
}

async function extractSkycubeZipFacesViaWorker(
  worker: Worker,
  zip: ArrayBuffer | Uint8Array,
): Promise<ExtractSkycubeZipFacesResult> {
  const payload = zip instanceof Uint8Array
    ? zip.slice().buffer
    : new Uint8Array(zip).slice().buffer
  const requestId = Math.floor(Math.random() * 1_000_000_000)

  return await new Promise<ExtractSkycubeZipFacesResult>((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', handleMessage)
      worker.removeEventListener('messageerror', handleMessageError)
      worker.removeEventListener('error', handleError)
      try {
        worker.terminate()
      } catch {
        // ignore
      }
    }

    const handleMessageError = () => {
      cleanup()
      reject(new Error('SkyCube ZIP worker 消息解析失败'))
    }

    const handleError = () => {
      cleanup()
      reject(new Error('SkyCube ZIP worker 执行失败'))
    }

    const handleMessage = (event: MessageEvent<SkyCubeZipExtractorWorkerResponse>) => {
      const message = event.data
      if (!message || typeof message !== 'object' || message.requestId !== requestId) {
        return
      }
      if (message.type === 'error') {
        cleanup()
        reject(new Error(message.message))
        return
      }
      cleanup()
      resolve(rehydrateSkycubeZipFaces(message.result))
    }

    worker.addEventListener('message', handleMessage)
    worker.addEventListener('messageerror', handleMessageError)
    worker.addEventListener('error', handleError)

    try {
      worker.postMessage({ type: 'extract', requestId, zip: payload } satisfies SkyCubeZipExtractorWorkerRequest, [payload])
    } catch (error) {
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

function rehydrateSkycubeZipFaces(result: SkyCubeZipExtractorWorkerResult): ExtractSkycubeZipFacesResult {
  return {
    missingFaces: Array.isArray(result.missingFaces) ? [...result.missingFaces] : [],
    discarded: Array.isArray(result.discarded)
      ? result.discarded
          .filter((item) => item && typeof item.key === 'string' && typeof item.filename === 'string')
          .map((item) => ({ key: item.key, filename: item.filename }))
      : [],
    facesInOrder: Array.isArray(result.facesInOrder)
      ? result.facesInOrder.map((face) => {
          if (!face) {
            return null
          }
          return {
            key: face.key,
            filename: face.filename,
            bytes: new Uint8Array(face.bytes),
            mimeType: face.mimeType,
          }
        })
      : [],
  }
}

export function disposeSkyCubeTexture(texture: THREE.CubeTexture | null | undefined): void {
  if (!texture) {
    return
  }
  texture.dispose()
}
