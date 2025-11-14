
import type {CameraControlMode,CameraProjection } from '@harmony/schema'

export interface SceneViewportSettings {
  showGrid: boolean
  showAxes: boolean
  cameraProjection: CameraProjection
  cameraControlMode: CameraControlMode
}
