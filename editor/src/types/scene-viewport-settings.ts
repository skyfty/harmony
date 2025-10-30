
import type {SceneSkyboxSettings } from '@harmony/schema'
export type CameraProjectionMode = 'perspective' | 'orthographic'
export type CameraControlMode = 'orbit' | 'map'
export type { SceneSkyboxSettings }

export interface SceneViewportSettings {
  showGrid: boolean
  showAxes: boolean
  cameraProjection: CameraProjectionMode
  cameraControlMode: CameraControlMode
  shadowsEnabled: boolean
  skybox: SceneSkyboxSettings
}
