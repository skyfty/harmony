export type EnvironmentBackgroundMode = 'solidColor' | 'hdri' | 'skycube'
export type EnvironmentFogMode = 'none' | 'linear' | 'exp'
export type EnvironmentNorthDirection = '+X' | '-X' | '+Z' | '-Z'

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
  /** Optional gradient background top color (hex). When present, background becomes a vertical gradient. */
  gradientTopColor?: string | null
  /** Gradient vertical offset. Default: 33. */
  gradientOffset?: number
  /** Gradient exponent. Default: 0.6. */
  gradientExponent?: number
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

export interface EnvironmentSettings {
  background: EnvironmentBackgroundSettings
  northDirection?: EnvironmentNorthDirection
  environmentOrientationPreset?: EnvironmentOrientationPreset
  environmentRotationDegrees?: EnvironmentRotationDegrees
  ambientLightColor: string
  ambientLightIntensity: number
  fogMode: EnvironmentFogMode
  fogColor: string
  fogDensity: number
  fogNear: number
  fogFar: number
  fogAutoFitToGround?: boolean
  gravityStrength: number
  collisionRestitution: number
  collisionFriction: number
  csm?: EnvironmentCsmSettings
  viewportPerformanceMode?: boolean
}

export interface EnvironmentCsmSettings {
  enabled: boolean
  shadowEnabled: boolean
  lightColor: string
  lightIntensity: number
  sunAzimuthDeg: number
  sunElevationDeg: number
  cascades: number
  maxFar: number
  shadowMapSize: number
  shadowBias: number
}

export type EnvironmentSettingsPatch = Partial<Omit<EnvironmentSettings, 'background'>> & {
  background?: Partial<EnvironmentBackgroundSettings>
  csm?: Partial<EnvironmentCsmSettings>
}
