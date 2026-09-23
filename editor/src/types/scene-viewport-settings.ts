
import type { CameraControlMode, CameraProjection, TransformSpace } from '@schema/core'

export type SceneViewportSnapMode = 'off' | 'vertex'

export interface SceneViewportSettings {
  showGrid: boolean
  showAxes: boolean
  cameraProjection: CameraProjection
  cameraControlMode: CameraControlMode
  /** Transform gizmo orientation: 'auto' keeps the legacy per-tool behavior. */
  transformSpace: TransformSpace

  // Vertex snap (Blender-like vertex alignment)
  snapMode: SceneViewportSnapMode
  snapThresholdPx: number
}
