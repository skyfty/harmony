
import type {SceneSkyboxSettings,CameraControlMode,CameraProjection } from '@harmony/schema'

export interface SceneViewportSettings {
  showGrid: boolean
  showAxes: boolean
  cameraProjection: CameraProjection
  cameraControlMode: CameraControlMode
  shadowsEnabled: boolean
  skybox: SceneSkyboxSettings
}
