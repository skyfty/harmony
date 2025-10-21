import type { Object3D } from 'three'
import type { SceneNode } from '@/types/scene'
import type { SceneViewportSettings } from './scene-viewport-settings'
import type { GroundSettings } from './ground-settings'

export interface SceneHistoryEntry {
  nodes: SceneNode[]
  selectedNodeIds: string[]
  selectedNodeId: string | null
  viewportSettings: SceneViewportSettings
  groundSettings: GroundSettings
  resourceProviderId: string
  runtimeSnapshots: Map<string, Object3D>
}
