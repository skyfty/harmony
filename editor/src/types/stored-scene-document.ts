import type { SceneNode } from '@/types/scene'
import type { SceneCameraState } from './scene-camera-state'
import type { ProjectAsset } from './project-asset'
import type { AssetIndexEntry } from './asset-index-entry'
import type { SceneViewportSettings } from './scene-viewport-settings'
import type { PanelVisibilityState } from './panel-visibility-state'
import type { PanelPlacementState } from './panel-placement-state'
import type { GroundSettings } from '@harmony/scene-schema'
import type { SceneMaterial } from '@/types/material'

export interface StoredSceneDocument {
  id: string
  name: string
  thumbnail?: string | null
  nodes: SceneNode[]
  materials: SceneMaterial[]
  selectedNodeId: string | null
  selectedNodeIds?: string[]
  camera: SceneCameraState
  viewportSettings: SceneViewportSettings
  groundSettings: GroundSettings
  panelVisibility?: PanelVisibilityState
  panelPlacement?: PanelPlacementState
  resourceProviderId: string
  createdAt: string
  updatedAt: string
  assetCatalog: Record<string, ProjectAsset[]>
  assetIndex: Record<string, AssetIndexEntry>
  packageAssetMap: Record<string, string>
}
