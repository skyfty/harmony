import type { Object3D } from 'three'
import type { SceneNode } from '@/types/scene'
import type { EditorTool } from './editor-tool'
import type { ProjectDirectory } from './project-directory'
import type { SceneCameraState } from './scene-camera-state'
import type { PanelVisibilityState } from './panel-visibility-state'
import type { SceneClipboard } from './scene-clipboard'
import type { SceneHistoryEntry } from './scene-history-entry'
import type { StoredSceneDocument } from './stored-scene-document'

export interface SceneState {
  scenes: StoredSceneDocument[]
  currentSceneId: string | null
  nodes: SceneNode[]
  selectedNodeId: string | null
  selectedNodeIds: string[]
  activeTool: EditorTool
  projectTree: ProjectDirectory[]
  activeDirectoryId: string | null
  selectedAssetId: string | null
  camera: SceneCameraState
  panelVisibility: PanelVisibilityState
  resourceProviderId: string
  cameraFocusNodeId: string | null
  cameraFocusRequestId: number
  clipboard: SceneClipboard | null
  draggingAssetObject: Object3D | null
  undoStack: SceneHistoryEntry[]
  redoStack: SceneHistoryEntry[]
  isRestoringHistory: boolean
  activeTransformNodeId: string | null
  transformSnapshotCaptured: boolean
}
