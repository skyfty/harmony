import type { AssetIndexEntry, SceneAssetRegistryEntry, SceneNode } from '@schema'

export interface NodePrefabData {
  formatVersion: number
  name: string
  root: SceneNode
  assetRegistry?: Record<string, SceneAssetRegistryEntry>
  assetIndex?: Record<string, AssetIndexEntry>
}
