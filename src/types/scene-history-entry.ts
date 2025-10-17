import type { Object3D } from 'three'
import type { SceneNode } from '@/types/scene'
import type { SceneViewportSettings } from './scene-viewport-settings'

export interface SceneHistoryEntry {
  nodes: SceneNode[]
  selectedNodeIds: string[]
  selectedNodeId: string | null
  viewportSettings: SceneViewportSettings
  resourceProviderId: string
  runtimeSnapshots: Map<string, Object3D>
}
