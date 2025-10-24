import type { Object3D } from 'three'
import type { SceneNode } from '@/types/scene'
import type { EditorTool } from './editor-tool'
import type { ProjectAsset } from './project-asset'
import type { ProjectDirectory } from './project-directory'
import type { SceneCameraState } from './scene-camera-state'
import type { PanelVisibilityState } from './panel-visibility-state'
import type { SceneClipboard } from './scene-clipboard'
import type { SceneHistoryEntry } from './scene-history-entry'
import type { AssetIndexEntry } from './asset-index-entry'
import type { SceneViewportSettings } from './scene-viewport-settings'
import type { GroundSettings } from './ground-settings'
import type { SceneMaterial } from '@/types/material'

export interface SceneState {
  currentSceneId: string | null
  currentSceneMeta: {
    name: string
    thumbnail: string | null
    createdAt: string
    updatedAt: string
  } | null
  nodes: SceneNode[]
  materials: SceneMaterial[]
  selectedNodeId: string | null
  selectedNodeIds: string[]
  activeTool: EditorTool
  projectTree: ProjectDirectory[]
  assetCatalog: Record<string, ProjectAsset[]>
  assetIndex: Record<string, AssetIndexEntry>
  packageAssetMap: Record<string, string>
  packageDirectoryCache: Record<string, ProjectDirectory[]>
  packageDirectoryLoaded: Record<string, boolean>
  activeDirectoryId: string | null
  selectedAssetId: string | null
  camera: SceneCameraState
  viewportSettings: SceneViewportSettings
  groundSettings: GroundSettings
  panelVisibility: PanelVisibilityState
  projectPanelTreeSize: number
  resourceProviderId: string
  cameraFocusNodeId: string | null
  cameraFocusRequestId: number
  clipboard: SceneClipboard | null
  draggingAssetId: string | null
  draggingAssetObject: Object3D | null
  undoStack: SceneHistoryEntry[]
  redoStack: SceneHistoryEntry[]
  isRestoringHistory: boolean
  activeTransformNodeId: string | null
  transformSnapshotCaptured: boolean
  pendingTransformSnapshot: SceneHistoryEntry | null
  isSceneReady: boolean
}
