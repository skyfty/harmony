import type {
  GroundSettings,
  SceneAssetOverrideEntry,
  SceneAssetRegistryEntry,
  SceneMaterial,
  SceneNode,
  EnvironmentSettings,
  SceneSkyboxSettings,
} from '@schema'
import type { SceneCameraState } from './scene-camera-state'
import type { SceneViewportSettings } from './scene-viewport-settings'
import type { PanelVisibilityState } from './panel-visibility-state'
import type { PanelPlacementState } from './panel-placement-state'
import type { ProjectAsset } from './project-asset'

export interface PresetSceneSummary {
  id: string
  name: string
  thumbnailUrl: string | null
  description?: string | null
}

export interface PresetSceneDocument {
  name?: string
  thumbnail?: string | null
  nodes?: SceneNode[]
  materials?: SceneMaterial[]
  selectedNodeId?: string | null
  selectedNodeIds?: string[]
  camera?: SceneCameraState
  viewportSettings?: Partial<SceneViewportSettings>
  skybox?: Partial<SceneSkyboxSettings>
  shadowsEnabled?: boolean
  environment?: Partial<EnvironmentSettings>
  groundSettings?: Partial<GroundSettings>
  panelVisibility?: Partial<PanelVisibilityState>
  panelPlacement?: Partial<PanelPlacementState>
  resourceProviderId?: string
  createdAt?: string
  updatedAt?: string
  assetCatalog?: Record<string, ProjectAsset[]>
  assetRegistry?: Record<string, SceneAssetRegistryEntry>
  projectOverrideAssets?: Record<string, SceneAssetOverrideEntry>
  sceneOverrideAssets?: Record<string, SceneAssetOverrideEntry>
}

export interface PresetSceneDetail extends PresetSceneSummary {
  document: PresetSceneDocument
}
