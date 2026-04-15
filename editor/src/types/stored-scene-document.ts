import type {
  AssetManifest,
  GroundSettings,
  SceneNode,
  EnvironmentSettings,
  SceneAssetOverrideEntry,
  SceneAssetRegistryEntry,
  SceneResourceSummary,
} from '@schema'
import type { SceneCameraState } from './scene-camera-state'
import type { ProjectAsset } from './project-asset'
import type { SceneViewportSettings } from './scene-viewport-settings'
import type { PanelVisibilityState } from './panel-visibility-state'
import type { PanelPlacementState } from './panel-placement-state'
import type { PlanningSceneData } from '@/types/planning-scene-data'

export interface StoredSceneDocument {
  id: string
  name: string
  projectId: string
  thumbnail?: string | null
  nodes: SceneNode[]
  // Legacy persisted fields. Selection is runtime-only and should not be serialized.
  selectedNodeId?: string | null
  selectedNodeIds?: string[]
  camera: SceneCameraState
  viewportSettings: SceneViewportSettings
  shadowsEnabled: boolean
  environment?: EnvironmentSettings
  groundSettings: GroundSettings
  panelVisibility?: PanelVisibilityState
  panelPlacement?: PanelPlacementState
  resourceProviderId: string
  createdAt: string
  updatedAt: string
  assetCatalog: Record<string, ProjectAsset[]>
  assetManifest?: AssetManifest | null
  assetRegistry?: Record<string, SceneAssetRegistryEntry>
  projectOverrideAssets?: Record<string, SceneAssetOverrideEntry>
  sceneOverrideAssets?: Record<string, SceneAssetOverrideEntry>
  resourceSummary?: SceneResourceSummary
  // Optional planning data (2D planning annotations) associated with the scene.
  planningData?: PlanningSceneData | null
}
