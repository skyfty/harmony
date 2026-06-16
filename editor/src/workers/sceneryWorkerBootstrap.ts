import { configureAssetBlobDownloader } from '@schema/assetCache'
import {
  createWorkerAssetBlobDownloader,
} from '@schema/assetDownloadWorkerPool'

type ModuleWorkerFactory = () => Worker | null

export const SCENERY_SHARED_WORKER_PATHS = {
  assetDownloadWorkerPath: './assetDownload.worker.ts',
} as const

export function configureScenerySharedWorkers(): void {
  configureAssetBlobDownloader(
    createWorkerAssetBlobDownloader(
      createModuleWorkerFactory('asset-download', SCENERY_SHARED_WORKER_PATHS.assetDownloadWorkerPath),
    ),
  )
}

function createModuleWorkerFactory(workerName: string, workerPath: string): ModuleWorkerFactory {
  return () => {
    if (typeof Worker === 'undefined') {
      console.warn('[harmony-editor][workers] worker API unavailable', { workerName, workerPath })
      return null
    }
    try {
      const resolvedUrl = new URL(workerPath, import.meta.url)
      return new Worker(resolvedUrl, { type: 'module' })
    } catch (error) {
      console.warn('[harmony-editor][workers] failed to create worker', {
        workerName,
        workerPath,
        message: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }
}
