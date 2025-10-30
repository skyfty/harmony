import type { Object3D } from 'three'
import type { SceneViewportSettings } from './scene-viewport-settings'
import type { SceneNode, GroundSettings } from '@harmony/scene-schema'
import type { SceneMaterial } from '@/types/material'

export interface SceneHistoryEntry {
  nodes: SceneNode[]
  materials: SceneMaterial[]
  selectedNodeIds: string[]
  selectedNodeId: string | null
  viewportSettings: SceneViewportSettings
  groundSettings: GroundSettings
  resourceProviderId: string
  runtimeSnapshots: Map<string, Object3D>
}
