import { configureAssetBlobDownloader } from './assetCache'
import {
  createWorkerAssetBlobDownloader,
} from './assetDownloadWorkerPool'
import {
  configureSkyCubeZipExtractorWorkerFactory,
} from './skyCubeTexture'

export type ScenerySharedWorkerBootstrapOptions = {
  baseUrl: string
  assetDownloadWorkerPath?: string
  skyCubeZipExtractorWorkerPath?: string
}

type ModuleWorkerFactory = () => Worker | null

export const SCENERY_SHARED_WORKER_PATHS = {
  assetDownloadWorkerPath: './workers/assetDownload.worker.ts',
  skyCubeZipExtractorWorkerPath: './workers/skyCubeTexture.worker.ts',
} as const

export function configureScenerySharedWorkers(options: ScenerySharedWorkerBootstrapOptions): void {
  const assetDownloadWorkerPath = options.assetDownloadWorkerPath ?? SCENERY_SHARED_WORKER_PATHS.assetDownloadWorkerPath
  const skyCubeZipExtractorWorkerPath = options.skyCubeZipExtractorWorkerPath ?? SCENERY_SHARED_WORKER_PATHS.skyCubeZipExtractorWorkerPath

  configureAssetBlobDownloader(
    createWorkerAssetBlobDownloader(
      createModuleWorkerFactory(options.baseUrl, assetDownloadWorkerPath),
    ),
  )
  configureSkyCubeZipExtractorWorkerFactory(
    createModuleWorkerFactory(options.baseUrl, skyCubeZipExtractorWorkerPath),
  )
}

function createModuleWorkerFactory(baseUrl: string, workerPath: string): ModuleWorkerFactory {
  return () => {
    if (typeof Worker === 'undefined') {
      return null
    }
    try {
      return new Worker(new URL(workerPath, baseUrl), { type: 'module' })
    } catch {
      return null
    }
  }
}
