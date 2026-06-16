import { configureAssetBlobDownloader } from '@harmony/schema/assetCache'
import {
  createWorkerAssetBlobDownloader,
} from '@harmony/schema/assetDownloadWorkerPool'
import {
  configureSkyCubeZipExtractorWorkerFactory,
} from '@harmony/schema/skyCubeTexture'

type ModuleWorkerFactory = () => Worker | null

export const SCENERY_SHARED_WORKER_PATHS = {
  assetDownloadWorkerPath: './assetDownload.worker.ts',
  skyCubeZipExtractorWorkerPath: './skyCubeTexture.worker.ts',
} as const

export function configureScenerySharedWorkers(): void {
  console.info('[harmony-scenery][workers] configuring scenery shared workers', {
    assetDownloadWorkerPath: SCENERY_SHARED_WORKER_PATHS.assetDownloadWorkerPath,
    skyCubeZipExtractorWorkerPath: SCENERY_SHARED_WORKER_PATHS.skyCubeZipExtractorWorkerPath,
  })

  configureAssetBlobDownloader(
    createWorkerAssetBlobDownloader(
      createModuleWorkerFactory('asset-download', SCENERY_SHARED_WORKER_PATHS.assetDownloadWorkerPath),
    ),
  )
  configureSkyCubeZipExtractorWorkerFactory(
    createModuleWorkerFactory('skycube-zip', SCENERY_SHARED_WORKER_PATHS.skyCubeZipExtractorWorkerPath),
  )
}

function createModuleWorkerFactory(workerName: string, workerPath: string): ModuleWorkerFactory {
  return () => {
    if (typeof Worker === 'undefined') {
      console.warn('[harmony-scenery][workers] worker API unavailable', { workerName, workerPath })
      return null
    }
    try {
      const resolvedUrl = new URL(workerPath, import.meta.url)
      console.info('[harmony-scenery][workers] creating worker', {
        workerName,
        workerPath,
        resolvedUrl: resolvedUrl.href,
      })
      return new Worker(resolvedUrl, { type: 'module' })
    } catch (error) {
      console.warn('[harmony-scenery][workers] failed to create worker', {
        workerName,
        workerPath,
        message: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }
}
