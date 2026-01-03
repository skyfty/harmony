import type { SceneNode } from  '@harmony/schema'

export interface EnsureSceneAssetsOptions {
  nodes?: SceneNode[]
  showOverlay?: boolean
  refreshViewport?: boolean

  /**
   * When set, the store will aggregate download progress of all assets required by `nodes`
   * and expose it as a prefab-level progress indicator keyed by this asset id.
   */
  prefabAssetIdForDownloadProgress?: string | null
}
