import type { SceneAssetRegistryEntry, SceneNode } from '@schema/core'

export interface NodePrefabData {
  formatVersion: number
  name: string
  root: SceneNode
  assetRegistry?: Record<string, SceneAssetRegistryEntry>
}
