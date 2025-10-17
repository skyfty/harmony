export type CameraProjectionMode = 'perspective' | 'orthographic'

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
  skybox: SceneSkyboxSettings
}
