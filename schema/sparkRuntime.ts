import * as THREE from 'three'
import { PagedSplats, SparkRenderer, SplatMesh, SplatFileType } from '@sparkjsdev/spark'
import { validateRadRangeResponse } from './radRangeResponse'
import { attachResponseBodyStream } from './responseBodyShim'

const SPARK_RENDERER_KEY = '__harmonySparkRenderer'
const progressiveRadUrls = new Map<string, number>()
let sparkRangeFetchValidationInstalled = false
let originalGlobalFetch: typeof globalThis.fetch | null = null
let validatedGlobalFetch: typeof globalThis.fetch | null = null

type SparkScene = THREE.Scene & { [SPARK_RENDERER_KEY]?: SparkRenderer }
type SparkSplatOwnership = { references: number; disposeSource: () => void }
const sparkSplatOwnership = new WeakMap<object, SparkSplatOwnership>()

function registerSparkSplat(splat: SplatMesh, ownership?: SparkSplatOwnership): void {
  const source = splat.paged ?? splat.packedSplats ?? splat.extSplats
  if (!source) {
    return
  }
  const state = ownership ?? sparkSplatOwnership.get(source) ?? {
    references: 0,
    disposeSource: splat.dispose.bind(splat),
  }
  sparkSplatOwnership.set(source, state)
  state.references += 1
  let disposed = false
  splat.dispose = () => {
    if (disposed) {
      return
    }
    disposed = true
    state.references = Math.max(0, state.references - 1)
    if (state.references === 0) {
      state.disposeSource()
      sparkSplatOwnership.delete(source)
    }
  }
}

export function registerSparkSplatResources(splat: SplatMesh): void {
  registerSparkSplat(splat)
}

function validateSparkRangeResponse(request: Request, response: Response): Response {
  if (!request.headers.has('Range')) {
    return response
  }
  try {
    validateRadRangeResponse(request.headers.get('Range'), response)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${detail} for ${request.url}`, { cause: error })
  }
  // Spark only pages RAD files through ranges, so the missing `body` shim can
  // stay scoped to those responses instead of changing every fetch response in
  // the mini program. @see attachResponseBodyStream
  return attachResponseBodyStream(response)
}

/**
 * Spark reports every unusable range answer as
 * `Failed to fetch "<url>": <status> <statusText>`, which reads like a CDN or
 * HTTP-status problem even when the request itself succeeded. Rewrite that one
 * message so the console points at the real suspects.
 *
 * @see createPagedRadSplatFromUrl
 */
function explainPagedRadFailure(error: unknown, url: string): unknown {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (!/^Failed to fetch "/.test(message)) {
    return error
  }
  return new Error(
    `RAD 流式加载失败：${message}；range 响应已通过 HTTP 校验（或未进入校验），`
    + `spark 拒绝它的常见原因是运行时的 Response 缺少 body（小程序 fetch polyfill 需由 `
    + `installMiniProgramPolyfillGuards 补 body 兼容层）。url=${url}`,
    { cause: error },
  )
}

function retainProgressiveRadUrl(url: string): void {
  progressiveRadUrls.set(url, (progressiveRadUrls.get(url) ?? 0) + 1)
  if (sparkRangeFetchValidationInstalled || typeof globalThis.fetch !== 'function') {
    return
  }
  originalGlobalFetch = globalThis.fetch
  const originalFetch = originalGlobalFetch.bind(globalThis)
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? new Request(input, init) : new Request(input, init)
    const shouldValidate = progressiveRadUrls.has(request.url) && request.headers.has('Range')
    const response = await originalFetch(request)
    return shouldValidate ? validateSparkRangeResponse(request, response) : response
  }
  validatedGlobalFetch = globalThis.fetch
  sparkRangeFetchValidationInstalled = true
}

function releaseProgressiveRadUrl(url: string): void {
  const references = progressiveRadUrls.get(url) ?? 0
  if (references <= 1) {
    progressiveRadUrls.delete(url)
  } else {
    progressiveRadUrls.set(url, references - 1)
  }
  if (!progressiveRadUrls.size && validatedGlobalFetch && originalGlobalFetch && globalThis.fetch === validatedGlobalFetch) {
    globalThis.fetch = originalGlobalFetch
    originalGlobalFetch = null
    validatedGlobalFetch = null
    sparkRangeFetchValidationInstalled = false
  }
}

/** Build a paged Spark RAD mesh; RAD LoD chunks are not exposed in numSplats until rendered. */
export async function createPagedRadSplat(bytes: ArrayBuffer, filename: string): Promise<SplatMesh> {
  const paged = new PagedSplats({
    fileBytes: new Uint8Array(bytes),
    fileType: SplatFileType.RAD,
  })
  try {
    const { meta } = await paged.getRadMeta()
    if (!Number.isSafeInteger(meta.count) || meta.count <= 0 || meta.chunks.length === 0) {
      throw new Error(`RAD 文件元数据无效或没有 splat 数据 (${filename})`)
    }
    if (meta.chunks.some((chunk) => Boolean(chunk.filename))) {
      throw new Error(`RAD 文件依赖外部 chunk 文件，不能单独导入 (${filename})；请导入整套 RAD 资源`)
    }
    const splat = new SplatMesh({ paged, lod: true })
    splat.name = filename
    splat.userData = {
      ...splat.userData,
      __harmonySparkSplat: true,
      __harmonySplatCount: meta.count,
      __harmonyLocalBounds: null,
    }
    splat.clone = (recursive = true) => cloneSparkSplat(splat, recursive)
    registerSparkSplatResources(splat)
    return splat
  } catch (error) {
    paged.dispose()
    throw error
  }
}

/**
 * Build a URL-backed RAD source after verifying that the origin honors byte
 * ranges. Spark's pager issues its own range requests after this probe.
 */
export async function createPagedRadSplatFromUrl(url: string, filename: string): Promise<SplatMesh | null> {
  if (!/^https?:\/\//i.test(url) || typeof fetch !== 'function' || typeof Request !== 'function') {
    return null
  }

  let probe: Response
  try {
    probe = await fetch(new Request(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
    }))
  } catch {
    return null
  }

  const contentRange = probe.headers.get('Content-Range')
  if (probe.status !== 206 || !/^bytes\s+0-0\/\d+$/i.test(contentRange ?? '')) {
    await probe.body?.cancel().catch(() => undefined)
    return null
  }
  const probeBytes = await probe.arrayBuffer().catch(() => new ArrayBuffer(0))
  if (probeBytes.byteLength !== 1) {
    return null
  }

  retainProgressiveRadUrl(url)
  const paged = new PagedSplats({ rootUrl: url, fileType: SplatFileType.RAD })
  try {
    const { meta } = await paged.getRadMeta()
    if (!Number.isSafeInteger(meta.count) || meta.count <= 0 || meta.chunks.length === 0) {
      throw new Error(`RAD 文件元数据无效或没有 splat 数据 (${filename})`)
    }
    if (meta.chunks.some((chunk) => Boolean(chunk.filename))) {
      throw new Error(`RAD 文件依赖外部 chunk 文件，不能单独导入 (${filename})；请导入整套 RAD 资源`)
    }
    const splat = new SplatMesh({ paged, lod: true })
    const originalDispose = splat.dispose.bind(splat)
    splat.dispose = () => {
      originalDispose()
      releaseProgressiveRadUrl(url)
    }
    splat.name = filename
    splat.userData = {
      ...splat.userData,
      __harmonySparkSplat: true,
      __harmonyProgressiveRad: true,
      __harmonySplatCount: meta.count,
      __harmonyLocalBounds: null,
    }
    splat.clone = (recursive = true) => cloneSparkSplat(splat, recursive)
    registerSparkSplatResources(splat)
    return splat
  } catch (error) {
    paged.dispose()
    releaseProgressiveRadUrl(url)
    throw explainPagedRadFailure(error, url)
  }
}

/** Attach Spark's renderer hook once to a Three.js scene. */
export function attachSparkRenderer(scene: THREE.Scene, renderer: THREE.WebGLRenderer): SparkRenderer {
  const sparkScene = scene as SparkScene
  if (sparkScene[SPARK_RENDERER_KEY]) {
    return sparkScene[SPARK_RENDERER_KEY]!
  }

  const sparkRenderer = new SparkRenderer({ renderer })
  sparkRenderer.name = 'HarmonySparkRenderer'
  sparkRenderer.userData.__harmonySparkRenderer = true
  sparkScene[SPARK_RENDERER_KEY] = sparkRenderer
  scene.add(sparkRenderer)
  return sparkRenderer
}

export function cloneSparkSplat(source: SplatMesh, recursive = true): SplatMesh {
  if (!source.packedSplats && !source.paged && !source.extSplats) {
    throw new Error('Spark splat asset has no shareable data source')
  }
  const sourceData = source.paged ?? source.packedSplats ?? source.extSplats!
  const cloned = source.paged
    ? new SplatMesh({ paged: source.paged })
    : source.packedSplats
      ? new SplatMesh({ packedSplats: source.packedSplats })
      : new SplatMesh({ extSplats: source.extSplats! })
  registerSparkSplat(cloned, sparkSplatOwnership.get(sourceData))
  cloned.name = source.name
  cloned.position.copy(source.position)
  cloned.quaternion.copy(source.quaternion)
  cloned.scale.copy(source.scale)
  cloned.visible = source.visible
  cloned.userData = { ...source.userData }
  if (recursive) {
    for (const child of source.children) {
      cloned.add(child.clone(true))
    }
  }
  cloned.clone = (nextRecursive = true) => cloneSparkSplat(cloned, nextRecursive)
  return cloned
}

/** Dispose Spark-owned GPU resources before the owning Three renderer is destroyed. */
export function disposeSparkScene(scene: THREE.Scene | null | undefined): void {
  if (!scene) {
    return
  }
  const sparkScene = scene as SparkScene
  const sparkRenderer = sparkScene[SPARK_RENDERER_KEY]
  if (sparkRenderer) {
    scene.remove(sparkRenderer)
    sparkRenderer.dispose()
    delete sparkScene[SPARK_RENDERER_KEY]
  }
  scene.traverse((object) => {
    disposeSparkObject(object)
  })
}

export function getSparkSplatBounds(object: THREE.Object3D): THREE.Box3 | null {
  const splat = object as SplatMesh
  if (!(splat instanceof SplatMesh) || !splat.isInitialized) {
    return null
  }
  try {
    const bounds = splat.getBoundingBox(false)
    return bounds.isEmpty() ? null : bounds
  } catch {
    return null
  }
}

export function disposeSparkObject(object: THREE.Object3D): void {
  const splat = object as SplatMesh
  if (!(splat instanceof SplatMesh)) {
    return
  }
  if (splat.userData?.__harmonySparkDisposed !== true) {
    splat.userData.__harmonySparkDisposed = true
    splat.dispose()
  }
}
