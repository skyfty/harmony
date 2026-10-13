export type EnvironmentBackgroundMode = 'solidColor' | 'hdri' | 'fastHdri' | 'skycube'
export type EnvironmentNorthDirection = '+X' | '-X' | '+Z' | '-Z'
export type EnvironmentPhysicsEngine = 'ammo' | 'cannon'

export type EnvironmentOrientationPreset = 'yUp' | 'zUp' | 'xUp' | 'custom'

export type SkyCubeBackgroundFormat = 'zip'

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
  backgroundAssetId: string | null
}

export interface EnvironmentSettings {
  background: EnvironmentBackgroundSettings
  northDirection?: EnvironmentNorthDirection
  environmentOrientationPreset?: EnvironmentOrientationPreset
  environmentRotationDegrees?: EnvironmentRotationDegrees
  ambientLightColor: string
  ambientLightIntensity: number
  /** Slow Roads 季节/时间/天气环境（节季素材固定来自在线资产包）。 */
  slowroads: {
    season: 'spring' | 'summer' | 'autumn' | 'winter'
    timeOfDay: 'morning' | 'day' | 'evening' | 'night'
    weather: 'clear' | 'overcast'
    showSky: boolean
    showClouds: boolean
    showStars: boolean
    showSnow: boolean
    exposureScale: number
  }
  physicsEnabled?: boolean
  physicsEngine?: EnvironmentPhysicsEngine
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
