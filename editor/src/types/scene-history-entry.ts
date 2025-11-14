import type { Object3D } from 'three'
import type { SceneViewportSettings } from './scene-viewport-settings'
import type { SceneNode, GroundSettings, EnvironmentSettings, SceneSkyboxSettings } from '@harmony/schema'
import type { SceneMaterial } from '@/types/material'

export interface SceneHistoryEntry {
  nodes: SceneNode[]
  materials: SceneMaterial[]
  selectedNodeIds: string[]
  selectedNodeId: string | null
  viewportSettings: SceneViewportSettings
  skybox: SceneSkyboxSettings
  shadowsEnabled: boolean
  environment: EnvironmentSettings
  groundSettings: GroundSettings
  resourceProviderId: string
  runtimeSnapshots: Map<string, Object3D>
}
