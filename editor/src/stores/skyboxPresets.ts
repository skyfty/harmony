import type { SkyboxPresetDefinition } from '@/types/skybox'
import type { SceneSkyboxSettings } from '@harmony/schema'
import { sanitizeCloudSettings } from '@schema/cloudRenderer'

export const SKYBOX_PRESETS: SkyboxPresetDefinition[] = [
  {
    id: 'clear-day',
    name: 'Clear Day',
    settings: {
      exposure: 0.6,
      turbidity: 4,
      rayleigh: 1.25,
      mieCoefficient: 0.0025,
      mieDirectionalG: 0.75,
      elevation: 22,
      azimuth: 145,
    },
  },
  {
    id: 'golden-hour',
    name: 'Golden Hour',
    settings: {
      exposure: 0.5,
      turbidity: 6,
      rayleigh: 1.2,
      mieCoefficient: 0.01,
      mieDirectionalG: 0.95,
      elevation: 12,
      azimuth: 205,
    },
  },
  {
    id: 'overcast',
    name: 'Overcast Diffuse',
    settings: {
      exposure: 0.35,
      turbidity: 10,
      rayleigh: 1.8,
      mieCoefficient: 0.005,
      mieDirectionalG: 0.8,
      elevation: 60,
      azimuth: 160,
    },
  },
  {
    id: 'midnight',
    name: 'Starry Night',
    settings: {
      exposure: 0.22,
      turbidity: 2.5,
      rayleigh: 0.7,
      mieCoefficient: 0.0008,
      mieDirectionalG: 0.65,
      elevation: 6,
      azimuth: 40,
    },
  },
]

export const SKYBOX_PRESET_MAP = new Map<string, SkyboxPresetDefinition>(
  SKYBOX_PRESETS.map((preset) => [preset.id, preset]),
)

export const DEFAULT_SKYBOX_PRESET_ID = 'clear-day'
export const CUSTOM_SKYBOX_PRESET_ID = 'custom'

export function resolveSkyboxPreset(presetId: string | null | undefined): SkyboxPresetDefinition | null {
  if (!presetId) {
    return null
  }
  return SKYBOX_PRESET_MAP.get(presetId) ?? null
}

export function normalizeSkyboxSettings(settings?: Partial<SceneSkyboxSettings> | null): SceneSkyboxSettings {
  const requestedPresetId = settings?.presetId ?? DEFAULT_SKYBOX_PRESET_ID
  const basePresetId = SKYBOX_PRESET_MAP.has(requestedPresetId)
    ? requestedPresetId
    : DEFAULT_SKYBOX_PRESET_ID
  const basePreset = SKYBOX_PRESET_MAP.get(basePresetId) ?? SKYBOX_PRESETS[0]!
  const clouds = sanitizeCloudSettings(settings?.clouds)

  return {
    presetId: requestedPresetId,
    exposure: settings?.exposure ?? basePreset.settings.exposure,
    turbidity: settings?.turbidity ?? basePreset.settings.turbidity,
    rayleigh: settings?.rayleigh ?? basePreset.settings.rayleigh,
    mieCoefficient: settings?.mieCoefficient ?? basePreset.settings.mieCoefficient,
    mieDirectionalG: settings?.mieDirectionalG ?? basePreset.settings.mieDirectionalG,
    elevation: settings?.elevation ?? basePreset.settings.elevation,
    azimuth: settings?.azimuth ?? basePreset.settings.azimuth,
    clouds: clouds ?? null,
  }
}

export function cloneSkyboxSettings(settings: SceneSkyboxSettings): SceneSkyboxSettings {
  return normalizeSkyboxSettings({ ...settings })
}

export const DEFAULT_SKYBOX_SETTINGS = normalizeSkyboxSettings()
