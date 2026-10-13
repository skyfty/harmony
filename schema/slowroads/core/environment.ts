import type { SeasonId } from './seasonCatalog'
import { ENVIRONMENT_PRESETS as RAW_ENVIRONMENT_PRESETS } from './environmentPresets.generated'

export type { SeasonId }

/**
 * slowroads 环境状态（平台无关核心层）：季节 × 时间 × 天气。
 *
 * 官方预设（从线上包体提取，见 environmentPresets.generated.ts）驱动
 * 光照、三色高度雾、水面颜色、云层、星空（夜晴）与降雪（冬季阴天）。
 * 迁移目标：由 editor 的 EnvironmentPanel 设置（EnvironmentSettings 的
 * season/timeOfDay/weather 字段），经 ComponentFrameState 下发，由
 * proceduralLandscape 等组件读取并应用同一套预设表。
 */

export type TimeOfDay = 'morning' | 'day' | 'evening' | 'night'
export type Weather = 'clear' | 'overcast'

export const TIME_OF_DAY_ORDER: readonly TimeOfDay[] = ['morning', 'day', 'evening', 'night']
export const WEATHER_ORDER: readonly Weather[] = ['clear', 'overcast']

export const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  morning: '早晨',
  day: '白天',
  evening: '傍晚',
  night: '夜晚',
}

export const WEATHER_LABELS: Record<Weather, string> = {
  clear: '晴',
  overcast: '阴',
}

export interface EnvironmentState {
  season: SeasonId
  timeOfDay: TimeOfDay
  weather: Weather
}

export const DEFAULT_ENVIRONMENT_STATE: EnvironmentState = {
  season: 'spring',
  timeOfDay: 'day',
  weather: 'clear',
}

export interface EnvironmentPreset {
  lights: {
    sun: { col: string; intensity: number }
    ambient: { col: string; intensity: number }
    /** 水面/玻璃菲涅尔强度（lab 用于水面反射强度）。 */
    fresnelFactor: number
    /** 树冠/水面的自发光系数（依赖车灯，lab 暂不生效）。 */
    radiance: number
  }
  fog: {
    colA: string
    colB: string
    /** 官方允许缺省，缺省时回退 colB。 */
    colC: string | null
    /** 视距比例（官方：实际距离 = viewDistance × 该值）。 */
    near: number
    far: number
    /** 正=地面雾层高度，负=低空雾层深度（米）；0 = 关闭。 */
    hazeHeight: number
    hazeIntensity: number
  }
  water: {
    base: string
    body: string
    highlight: string
    underwater: string
  }
  clouds: {
    hasClouds: boolean
    highlight: string
    lowlight: string
    shelfHeight0: number
    shelfHeight1: number
    skyScale0: number
    skyScale1: number
    /** 混合模式：0/1/2/3/4（4 与 5 官方均为空实现 = 不绘制）。 */
    mode: number
  }
  /** 夜晴星空。 */
  stars?: {
    density: number
    horizonOffset: number
    horizonScale: number
    horizonOpacity: number
  }
  /** 冬季阴天降雪。 */
  snow?: {
    density: number
    col: string
    speed: number
  }
}

/** 官方预设表（生成数据按完整接口类型收窄，便于消费方使用可选字段）。 */
export const ENVIRONMENT_PRESETS = RAW_ENVIRONMENT_PRESETS as unknown as Record<
  SeasonId,
  Record<TimeOfDay, Record<Weather, EnvironmentPreset>>
>

export function resolveEnvironmentPreset(state: EnvironmentState): EnvironmentPreset {
  return ENVIRONMENT_PRESETS[state.season][state.timeOfDay][state.weather]
}

export function fogColorC(preset: EnvironmentPreset): string {
  return preset.fog.colC ?? preset.fog.colB
}

/**
 * 官方视距常数（Hills 场景默认 graphics preset：tileSize 1000 → 视距 1000m，
 * 云高 300m；雾距离 = 视距 × 预设比例，雾密度 = sqrt(5)/fogFar）。
 */
export const ENVIRONMENT_VIEW_DISTANCE = 1000
export const ENVIRONMENT_CLOUD_ALTITUDE = 300

export interface ResolvedFogParams {
  near: number
  far: number
  density: number
  hazeHeight: number
  hazeIntensity: number
}

export function resolveFogParams(preset: EnvironmentPreset, viewDistance = ENVIRONMENT_VIEW_DISTANCE): ResolvedFogParams {
  const far = Math.max(1, viewDistance * preset.fog.far)
  const near = viewDistance * preset.fog.near
  return {
    near,
    far,
    density: Math.sqrt(5 / (far * far)),
    hazeHeight: preset.fog.hazeHeight,
    hazeIntensity: preset.fog.hazeIntensity,
  }
}
