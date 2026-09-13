import { isWechatSharedWorkerSupported } from '@harmony/utils/wechat-shared-worker'

export type GltfParseWorkerFactory = () => Worker | null

/**
 * Whether this platform can host a worker-side GLB parse at all.
 *
 * GLB texture decoding inside the worker needs OffscreenCanvas + createImageBitmap,
 * which the WeChat mini-program worker does not provide, and mini-program runtimes
 * have no Worker global either. This is a *platform* capability check and does not
 * create a worker, so it is cheap to call before touching any asset bytes.
 */
export function isGltfParseWorkerPlatformSupported(): boolean {
  if (isWechatSharedWorkerSupported()) {
    return false
  }
  return typeof Worker !== 'undefined'
}

/**
 * Creates the factory consumed by @harmony/schema/gltfParse.
 *
 * Returns null when the platform cannot host the worker at all. That matters for
 * more than tidiness: the caller (schema/assetImport) reads the whole GLB into an
 * ArrayBuffer before attempting the worker parse, so a factory that merely *fails
 * at call time* still costs a full redundant file read on every model. Reporting
 * the platform limitation up front keeps that read off the main thread path.
 */
export function createGltfParseWorkerFactory(): GltfParseWorkerFactory | null {
  if (!isGltfParseWorkerPlatformSupported()) {
    return null
  }

  return (): Worker | null => {
    // #ifdef H5
    // GLB texture decoding inside the worker needs OffscreenCanvas +
    // createImageBitmap. Keep the worker H5-only; on mini-program builds the
    // block below is stripped so the worker (and its GLTFLoader bundle) is never
    // emitted into the package.
    try {
      return new Worker(
        new URL('../../workers/gltfParse.worker.ts', import.meta.url),
        { type: 'module' },
      )
    } catch (error) {
      console.warn('[Scenery][GltfParse] failed to create H5 gltf parse worker', error)
    }
    // #endif

    return null
  }
}
