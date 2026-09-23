
import type {
  CameraControlMode,
  CameraProjection,
  TransformPivotMode,
  TransformSpace,
} from '@schema/core'

export type SceneViewportSnapMode = 'off' | 'vertex'

export interface SceneViewportSettings {
  showGrid: boolean
  showAxes: boolean
  cameraProjection: CameraProjection
  cameraControlMode: CameraControlMode
  /** Transform gizmo orientation: 'auto' keeps the legacy per-tool behavior. */
  transformSpace: TransformSpace
  /** Transform gizmo anchor: 'auto' keeps the legacy per-node behavior. */
  transformPivotMode: TransformPivotMode

  // Vertex snap (Blender-like vertex alignment)
  snapMode: SceneViewportSnapMode
  snapThresholdPx: number
}
