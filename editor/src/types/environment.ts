export type EnvironmentBackgroundMode = 'skybox' | 'solidColor' | 'hdri' | 'skycube'
export type EnvironmentFogMode = 'none' | 'linear' | 'exp'
export type EnvironmentMapMode = 'skybox' | 'custom'

export type EnvironmentOrientationPreset = 'yUp' | 'zUp' | 'xUp' | 'custom'

export type SkyCubeBackgroundFormat = 'faces' | 'zip'

export interface EnvironmentRotationDegrees {
  x: number
  y: number
  z: number
}

export interface EnvironmentBackgroundSettings {
  mode: EnvironmentBackgroundMode
  solidColor: string
  hdriAssetId: string | null
  skycubeFormat: SkyCubeBackgroundFormat
  skycubeZipAssetId: string | null
  /** SkyCube faces in fixed Three.js CubeTextureLoader order: +X, -X, +Y, -Y, +Z, -Z. */
  positiveXAssetId: string | null
  negativeXAssetId: string | null
  positiveYAssetId: string | null
  negativeYAssetId: string | null
  positiveZAssetId: string | null
  negativeZAssetId: string | null
}

export interface EnvironmentMapSettings {
  mode: EnvironmentMapMode
  hdriAssetId: string | null
}

export interface EnvironmentSettings {
  background: EnvironmentBackgroundSettings
  environmentOrientationPreset?: EnvironmentOrientationPreset
  environmentRotationDegrees?: EnvironmentRotationDegrees
  ambientLightColor: string
  ambientLightIntensity: number
  fogMode: EnvironmentFogMode
  fogColor: string
  fogDensity: number
  fogNear: number
  fogFar: number
  environmentMap: EnvironmentMapSettings
  gravityStrength: number
  collisionRestitution: number
  collisionFriction: number
}

export type EnvironmentSettingsPatch = Partial<Omit<EnvironmentSettings, 'background' | 'environmentMap'>> & {
  background?: Partial<EnvironmentBackgroundSettings>
  environmentMap?: Partial<EnvironmentMapSettings>
}
