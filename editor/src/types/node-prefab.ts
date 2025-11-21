import type { AssetIndexEntry, SceneNode } from '@harmony/schema'

export interface NodePrefabData {
  formatVersion: number
  name: string
  root: SceneNode
  assetIndex?: Record<string, AssetIndexEntry>
  packageAssetMap?: Record<string, string>
}
