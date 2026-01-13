import type {
  GroundSettings,
  SceneNode,
  AssetIndexEntry,
  EnvironmentSettings,
  SceneSkyboxSettings,
  SceneResourceSummary,
} from '@harmony/schema'
import type { SceneCameraState } from './scene-camera-state'
import type { ProjectAsset } from './project-asset'
import type { SceneViewportSettings } from './scene-viewport-settings'
import type { PanelVisibilityState } from './panel-visibility-state'
import type { PanelPlacementState } from './panel-placement-state'
import type { SceneMaterial } from '@/types/material'
import type { PlanningSceneData } from '@/types/planning-scene-data'

export interface StoredSceneDocument {
  id: string
  name: string
  projectId: string
  thumbnail?: string | null
  nodes: SceneNode[]
  materials: SceneMaterial[]
  selectedNodeId: string | null
  selectedNodeIds?: string[]
  camera: SceneCameraState
  viewportSettings: SceneViewportSettings
  skybox: SceneSkyboxSettings
  shadowsEnabled: boolean
  environment?: EnvironmentSettings
  groundSettings: GroundSettings
  panelVisibility?: PanelVisibilityState
  panelPlacement?: PanelPlacementState
  resourceProviderId: string
  createdAt: string
  updatedAt: string
  assetCatalog: Record<string, ProjectAsset[]>
  assetIndex: Record<string, AssetIndexEntry>
  packageAssetMap: Record<string, string>
  resourceSummary?: SceneResourceSummary
  // Optional planning data (2D planning annotations) associated with the scene.
  planningData?: PlanningSceneData | null
}
