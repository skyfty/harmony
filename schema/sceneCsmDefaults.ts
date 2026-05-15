import {
  DEFAULT_CSM_CASCADES,
  DEFAULT_CSM_FADE,
  DEFAULT_CSM_LIGHT_MARGIN,
  DEFAULT_CSM_MAX_CASCADES,
  DEFAULT_CSM_MAX_FAR,
  DEFAULT_CSM_MODE,
  DEFAULT_CSM_NO_LAST_CASCADE_CUT_OFF,
  DEFAULT_CSM_PRACTICAL_MODE_LAMBDA,
  DEFAULT_CSM_SHADOW_BIAS,
  DEFAULT_CSM_SHADOW_MAP_SIZE,
  DEFAULT_CSM_SHADOW_NORMAL_BIAS,
  DEFAULT_COLOR,
  DEFAULT_INTENSITY,
} from './lightDefaults'

export type SceneCsmMode = 'uniform' | 'logarithmic' | 'practical' | 'custom'

export type SceneCsmConfig = {
  enabled?: boolean
  shadowEnabled?: boolean
  cascades?: number
  maxCascades?: number
  maxFar?: number
  mode?: SceneCsmMode
  practicalModeLambda?: number
  shadowMapSize?: number
  shadowBias?: number
  shadowNormalBias?: number
  lightMargin?: number
  fade?: boolean
  noLastCascadeCutOff?: boolean
  lightColor?: import('three').ColorRepresentation
  lightIntensity?: number
}

export type SceneCsmRuntimeProfile = 'desktop' | 'wechat-mini-program'

export const DEFAULT_SCENE_CSM_CONFIG: Readonly<Required<SceneCsmConfig>> = Object.freeze({
  enabled: true,
  shadowEnabled: true,
  cascades: DEFAULT_CSM_CASCADES,
  maxCascades: DEFAULT_CSM_MAX_CASCADES,
  maxFar: DEFAULT_CSM_MAX_FAR,
  mode: DEFAULT_CSM_MODE,
  practicalModeLambda: DEFAULT_CSM_PRACTICAL_MODE_LAMBDA,
  shadowMapSize: DEFAULT_CSM_SHADOW_MAP_SIZE,
  shadowBias: DEFAULT_CSM_SHADOW_BIAS,
  shadowNormalBias: DEFAULT_CSM_SHADOW_NORMAL_BIAS,
  lightMargin: DEFAULT_CSM_LIGHT_MARGIN,
  fade: DEFAULT_CSM_FADE,
  noLastCascadeCutOff: DEFAULT_CSM_NO_LAST_CASCADE_CUT_OFF,
  lightColor: DEFAULT_COLOR,
  lightIntensity: DEFAULT_INTENSITY,
})

export const DEFAULT_SCENE_CSM_SUN_AZIMUTH_DEG = 45
export const DEFAULT_SCENE_CSM_SUN_ELEVATION_DEG = 42
