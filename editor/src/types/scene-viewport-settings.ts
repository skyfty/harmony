export type CameraProjectionMode = 'perspective' | 'orthographic'
export type CameraControlMode = 'orbit' | 'map'

export interface SceneSkyboxSettings {
  presetId: string
  exposure: number
  turbidity: number
  rayleigh: number
  mieCoefficient: number
  mieDirectionalG: number
  elevation: number
  azimuth: number
}

export interface SceneViewportSettings {
  showGrid: boolean
  showAxes: boolean
  cameraProjection: CameraProjectionMode
  cameraControlMode: CameraControlMode
  skybox: SceneSkyboxSettings
}
