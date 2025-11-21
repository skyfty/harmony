import type { NodePrefabData } from './node-prefab'

export interface ClipboardEntry {
  sourceId: string
  prefab: NodePrefabData
  serialized: string
  dependencyAssetIds: string[]
}
