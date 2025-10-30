import type {SceneSkyboxSettings } from '@harmony/scene-schema'

export type SkyboxParameterKey = Exclude<keyof SceneSkyboxSettings, 'presetId'>

export interface SkyboxPresetDefinition {
  id: string
  name: string
  description?: string
  settings: Pick<SceneSkyboxSettings, SkyboxParameterKey>
}
