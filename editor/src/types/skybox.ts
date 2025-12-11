import type { SceneSkyboxSettings } from '@harmony/schema'

export type SkyboxParameterKey = Exclude<keyof SceneSkyboxSettings, 'presetId' | 'clouds'>

export interface SkyboxPresetDefinition {
  id: string
  name: string
  description?: string
  settings: Pick<SceneSkyboxSettings, SkyboxParameterKey>
}
