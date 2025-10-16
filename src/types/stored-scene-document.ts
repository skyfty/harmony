import type { SceneNode } from '@/types/scene'
import type { SceneCameraState } from './scene-camera-state'
import type { ProjectAsset } from './project-asset'
import type { AssetIndexEntry } from './asset-index-entry'
import type { SceneViewportSettings } from './scene-viewport-settings'

export interface StoredSceneDocument {
  id: string
  name: string
  thumbnail?: string | null
  nodes: SceneNode[]
  selectedNodeId: string | null
  selectedNodeIds?: string[]
  camera: SceneCameraState
  viewportSettings: SceneViewportSettings
  resourceProviderId: string
  createdAt: string
  updatedAt: string
  assetCatalog: Record<string, ProjectAsset[]>
  assetIndex: Record<string, AssetIndexEntry>
  packageAssetMap: Record<string, string>
}
