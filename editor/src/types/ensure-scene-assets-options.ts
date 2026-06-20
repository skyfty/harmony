import type { SceneNode } from  '@schema'
import type { SceneAssetOverrideEntry, SceneAssetRegistryEntry, SceneResourceSummary } from '@schema/core'
import type { ProjectAsset } from '@/types/project-asset'
import type { StoredSceneDocument } from '@/types/stored-scene-document'

export interface SceneAssetResolutionContext {
  sceneDocument: StoredSceneDocument | null
  assetCatalog: Record<string, ProjectAsset[]>
  assetRegistry: Record<string, SceneAssetRegistryEntry>
  projectOverrideAssets?: Record<string, SceneAssetOverrideEntry> | null
  sceneOverrideAssets?: Record<string, SceneAssetOverrideEntry> | null
  resourceSummary?: SceneResourceSummary | null
}

export interface EnsureSceneAssetsProgress {
  step: string
  detail?: string
  progress: number
  completed: number
  total: number
  assetId?: string
}

export interface EnsureSceneAssetsOptions {
  nodes?: SceneNode[]
  showOverlay?: boolean
  refreshViewport?: boolean
  onProgress?: (progress: EnsureSceneAssetsProgress) => void
  sceneContext?: SceneAssetResolutionContext

  /**
   * When set, the store will aggregate download progress of all assets required by `nodes`
   * and expose it as a prefab-level progress indicator keyed by this asset id.
   */
  prefabAssetIdForDownloadProgress?: string | null
}
