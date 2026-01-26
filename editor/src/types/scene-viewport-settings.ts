
import type { CameraControlMode, CameraProjection } from '@harmony/schema'

export type SceneViewportSnapMode = 'off' | 'vertex'

export interface SceneViewportSettings {
  showGrid: boolean
  showAxes: boolean
  cameraProjection: CameraProjection
  cameraControlMode: CameraControlMode

  // Vertex snap (Blender-like vertex alignment)
  snapMode: SceneViewportSnapMode
  snapThresholdPx: number

  // Debug: show sampled vertices for current hover/candidate
  showVertexOverlay: boolean
}
