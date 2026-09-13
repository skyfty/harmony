import { isWechatSharedWorkerSupported } from '@harmony/utils/wechat-shared-worker'

export type GltfParseWorkerFactory = () => Worker | null

/**
 * Creates the factory consumed by @harmony/schema/gltfParse.
 *
 * GLB texture decoding inside the worker needs OffscreenCanvas + createImageBitmap,
 * which the WeChat mini-program worker does not provide. On those platforms the
 * factory returns null and the caller falls back to the synchronous
 * GLTFLoader.parse path on the main thread.
 */
export function createGltfParseWorkerFactory(): GltfParseWorkerFactory {
  return () => {
    if (isWechatSharedWorkerSupported()) {
      return null
    }

    if (typeof Worker === 'undefined') {
      return null
    }

    // #ifdef H5
    // GLB texture decoding inside the worker needs OffscreenCanvas +
    // createImageBitmap. Keep the worker H5-only; on mini-program builds the
    // block below is stripped so the worker (and its GLTFLoader bundle) is never
    // emitted into the package.
    try {
      return new Worker(
        new URL('../../workers/gltfParse.worker.ts', import.meta.url),
        { type: 'module' },
      ) as Worker
    } catch (error) {
      console.warn('[Scenery][GltfParse] failed to create H5 gltf parse worker', error)
    }
    // #endif

    return null
  }
}
