import type { Object3D } from 'three'
import type { SceneNode } from '@/types/scene'
import type { EditorTool } from './editor-tool'
import type { ProjectAsset } from './project-asset'
import type { ProjectDirectory } from './project-directory'
import type { SceneCameraState } from './scene-camera-state'
import type { PanelVisibilityState } from './panel-visibility-state'
import type { SceneClipboard } from './scene-clipboard'
import type { SceneHistoryEntry } from './scene-history-entry'
import type { StoredSceneDocument } from './stored-scene-document'
import type { AssetIndexEntry } from './asset-index-entry'
import type { SceneViewportSettings } from './scene-viewport-settings'

export interface SceneState {
  scenes: StoredSceneDocument[]
  currentSceneId: string | null
  nodes: SceneNode[]
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
