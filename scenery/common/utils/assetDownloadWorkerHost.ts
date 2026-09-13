import { isWechatSharedWorkerSupported } from '@harmony/utils/wechat-shared-worker'

export type AssetDownloadWorkerFactory = () => Worker | null

/**
 * Creates the factory consumed by @harmony/schema/assetDownloadWorkerPool.
 *
 * Returning null makes the pool throw AssetDownloadWorkerUnavailableError, which
 * fetchAssetBlob catches and falls back to the in-thread downloader. This keeps
 * a request from ever being stranded waiting on a worker that cannot answer.
 */
export function createAssetDownloadWorkerFactory(): AssetDownloadWorkerFactory {
  return () => {
    // WeChat mini-program workers have NO network API (no wx.request /
    // wx.downloadFile / fetch), so a download literally cannot run in the
    // worker there. Keep WeChat downloads on the main thread, where
    // uni.downloadFile already streams to a temp file in the native layer.
    if (isWechatSharedWorkerSupported()) {
      return null
    }

    if (typeof Worker === 'undefined') {
      return null
    }

    try {
      return new Worker(
        new URL('../../workers/assetDownload.worker.ts', import.meta.url),
        { type: 'module' },
      ) as Worker
    } catch (error) {
      console.warn('[Scenery][AssetDownload] failed to create H5 download worker', error)
      return null
    }
  }
}
