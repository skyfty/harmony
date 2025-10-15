import type { SceneNode } from '@/types/scene'
import type { SceneCameraState } from './scene-camera-state'

export interface StoredSceneDocument {
  id: string
  name: string
  thumbnail?: string | null
  nodes: SceneNode[]
  selectedNodeId: string | null
  selectedNodeIds?: string[]
  camera: SceneCameraState
  resourceProviderId: string
  createdAt: string
  updatedAt: string
}
