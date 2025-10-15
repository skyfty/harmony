import type { Object3D } from 'three'
import type { SceneNode } from '@/types/scene'
import type { SceneCameraState } from './scene-camera-state'

export interface SceneHistoryEntry {
  nodes: SceneNode[]
  selectedNodeIds: string[]
  selectedNodeId: string | null
  camera: SceneCameraState
  resourceProviderId: string
  runtimeSnapshots: Map<string, Object3D>
}
