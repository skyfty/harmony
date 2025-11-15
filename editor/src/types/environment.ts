export type EnvironmentBackgroundMode = 'skybox' | 'solidColor' | 'hdri'
export type EnvironmentFogMode = 'none' | 'exp'
export type EnvironmentMapMode = 'skybox' | 'custom'

export interface EnvironmentBackgroundSettings {
  mode: EnvironmentBackgroundMode
  solidColor: string
  hdriAssetId: string | null
}

export interface EnvironmentMapSettings {
  mode: EnvironmentMapMode
  hdriAssetId: string | null
}

export interface EnvironmentSettings {
  background: EnvironmentBackgroundSettings
  ambientLightColor: string
  ambientLightIntensity: number
  fogMode: EnvironmentFogMode
  fogColor: string
  fogDensity: number
  environmentMap: EnvironmentMapSettings
}

export type EnvironmentSettingsPatch = Partial<EnvironmentSettings> & {
  background?: Partial<EnvironmentBackgroundSettings>
  environmentMap?: Partial<EnvironmentMapSettings>
}
