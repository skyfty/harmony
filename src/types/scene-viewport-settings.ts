export type CameraProjectionMode = 'perspective' | 'orthographic'

export interface SceneViewportSettings {
  showGrid: boolean
  showAxes: boolean
  cameraProjection: CameraProjectionMode
}
