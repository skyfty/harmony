export type {
  EnvironmentSettings,
  EnvironmentNorthDirection,
  SlowroadsEnvironmentSettings,
} from './core';
import type {
  EnvironmentNorthDirection,
  EnvironmentSettings,
  SceneJsonExportDocument,
  SceneNode,
  SlowroadsEnvironmentSettings,
} from './core'
import type { SeasonId, TimeOfDay } from './slowroads/core/environment'

export const DEFAULT_ENVIRONMENT_PHYSICS_ENABLED = true
export const DEFAULT_ENVIRONMENT_PHYSICS_ENGINE = 'cannon' as const
export const DEFAULT_ENVIRONMENT_GRAVITY = 9.81
export const DEFAULT_ENVIRONMENT_RESTITUTION = 0.2
export const DEFAULT_ENVIRONMENT_FRICTION = 0.3
export const DEFAULT_ENVIRONMENT_NORTH_DIRECTION = '+X' as const
export const DEFAULT_ENVIRONMENT_VIEWPORT_PERFORMANCE_MODE = false

export const DEFAULT_SLOWROADS_ENVIRONMENT: import('./core').SlowroadsEnvironmentSettings = {
  controlMode: 'default',
  season: 'spring',
  timeOfDay: 'day',
  weather: 'clear',
  showClouds: true,
  showStars: true,
  showSnow: true,
  exposureScale: 1,
}

export const DEFAULT_ENVIRONMENT_SETTINGS: EnvironmentSettings = {
  northDirection: DEFAULT_ENVIRONMENT_NORTH_DIRECTION,
  slowroads: { ...DEFAULT_SLOWROADS_ENVIRONMENT },
  physicsEnabled: DEFAULT_ENVIRONMENT_PHYSICS_ENABLED,
  physicsEngine: DEFAULT_ENVIRONMENT_PHYSICS_ENGINE,
  viewportPerformanceMode: DEFAULT_ENVIRONMENT_VIEWPORT_PERFORMANCE_MODE,
  gravityStrength: DEFAULT_ENVIRONMENT_GRAVITY,
  collisionRestitution: DEFAULT_ENVIRONMENT_RESTITUTION,
  collisionFriction: DEFAULT_ENVIRONMENT_FRICTION,
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  if (numeric < min) {
    return min
  }
  if (numeric > max) {
    return max
  }
  return numeric
}

function normalizeNorthDirection(value: unknown): EnvironmentNorthDirection {
  if (value === '+X' || value === '-X' || value === '+Z' || value === '-Z') {
    return value
  }
  if (value === '+x') {
    return '+X'
  }
  if (value === '-x') {
    return '-X'
  }
  if (value === '+z') {
    return '+Z'
  }
  if (value === '-z') {
    return '-Z'
  }
  return DEFAULT_ENVIRONMENT_NORTH_DIRECTION
}

function normalizeSlowroadsEnvironment(value: unknown): SlowroadsEnvironmentSettings {
  const source = isPlainRecord(value) ? value : {}
  const controlMode = source.controlMode
  const season = source.season
  const timeOfDay = source.timeOfDay
  const weather = source.weather
  return {
    controlMode:
      controlMode === 'manual' || controlMode === 'auto' || controlMode === 'default'
        ? controlMode
        : DEFAULT_SLOWROADS_ENVIRONMENT.controlMode,
    season:
      season === 'spring' || season === 'summer' || season === 'autumn' || season === 'winter'
        ? season
        : DEFAULT_SLOWROADS_ENVIRONMENT.season,
    timeOfDay:
      timeOfDay === 'morning' || timeOfDay === 'day' || timeOfDay === 'evening' || timeOfDay === 'night'
        ? timeOfDay
        : DEFAULT_SLOWROADS_ENVIRONMENT.timeOfDay,
    weather:
      weather === 'clear' || weather === 'overcast'
        ? weather
        : DEFAULT_SLOWROADS_ENVIRONMENT.weather,
    showClouds:
      typeof source.showClouds === 'boolean' ? source.showClouds : DEFAULT_SLOWROADS_ENVIRONMENT.showClouds,
    showStars:
      typeof source.showStars === 'boolean' ? source.showStars : DEFAULT_SLOWROADS_ENVIRONMENT.showStars,
    showSnow:
      typeof source.showSnow === 'boolean' ? source.showSnow : DEFAULT_SLOWROADS_ENVIRONMENT.showSnow,
    exposureScale: clampNumber(
      source.exposureScale,
      0.2,
      3,
      DEFAULT_SLOWROADS_ENVIRONMENT.exposureScale,
    ),
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function cloneEnvironmentSettings(
  source?: Partial<EnvironmentSettings> | EnvironmentSettings | null,
): EnvironmentSettings {
  const normalizedSource = source ?? DEFAULT_ENVIRONMENT_SETTINGS
  return {
    northDirection: normalizeNorthDirection((normalizedSource as any)?.northDirection),
    slowroads: normalizeSlowroadsEnvironment((normalizedSource as { slowroads?: unknown })?.slowroads),
    physicsEnabled:
      typeof (normalizedSource as any)?.physicsEnabled === 'boolean'
        ? (normalizedSource as any).physicsEnabled
        : DEFAULT_ENVIRONMENT_PHYSICS_ENABLED,
    physicsEngine:
      (normalizedSource as any)?.physicsEngine === 'ammo'
        ? 'ammo'
        : 'cannon',
    viewportPerformanceMode:
      typeof (normalizedSource as any)?.viewportPerformanceMode === 'boolean'
        ? (normalizedSource as any).viewportPerformanceMode
        : DEFAULT_ENVIRONMENT_VIEWPORT_PERFORMANCE_MODE,
    gravityStrength: clampNumber(normalizedSource.gravityStrength, 0, 100, DEFAULT_ENVIRONMENT_GRAVITY),
    collisionRestitution: clampNumber(
      normalizedSource.collisionRestitution,
      0,
      1,
      DEFAULT_ENVIRONMENT_RESTITUTION,
    ),
    collisionFriction: clampNumber(
      normalizedSource.collisionFriction,
      0,
      1,
      DEFAULT_ENVIRONMENT_FRICTION,
    ),
  }
}

export function extractEnvironmentSettingsFromNodes(
  nodes: SceneNode[] | null | undefined,
): EnvironmentSettings | null {
  if (!Array.isArray(nodes) || !nodes.length) {
    return null
  }

  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }

    if (node.id === 'harmony:environment' || node.nodeType === 'Environment') {
      const payload = isPlainRecord(node.userData)
        ? ((node.userData as Record<string, unknown>).environment as
            | EnvironmentSettings
            | Partial<EnvironmentSettings>
            | null
            | undefined)
        : null
      return cloneEnvironmentSettings(payload ?? DEFAULT_ENVIRONMENT_SETTINGS)
    }

    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children)
    }
  }

  return null
}

export function resolveDocumentEnvironment(
  document: SceneJsonExportDocument | null | undefined,
): EnvironmentSettings {
  if (!document) {
    return cloneEnvironmentSettings(DEFAULT_ENVIRONMENT_SETTINGS)
  }

  const payload = (document as SceneJsonExportDocument & {
    environment?: Partial<EnvironmentSettings> | EnvironmentSettings | null
  }).environment

  if (payload) {
    return cloneEnvironmentSettings(payload)
  }

  const derived = extractEnvironmentSettingsFromNodes(document.nodes)
  if (derived) {
    return derived
  }

  return cloneEnvironmentSettings(DEFAULT_ENVIRONMENT_SETTINGS)
}

/**
 * 设备本地日期 → 季节，时间 → 时段。
 *
 * 季节采用气象季节（北半球月序）：3–5 春、6–8 夏、9–11 秋、12–2 冬。
 * 时段按产品约定：05–08 早晨、09–16 白天、17–19 傍晚、20–04 夜晚。
 * 该函数只读取本地时间，不依赖经纬度或太阳高度角。
 */
export function resolveAutoSlowroadsEnvironment(
  date: Date = new Date(),
): Pick<SlowroadsEnvironmentSettings, 'season' | 'timeOfDay'> {
  const validDate = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date()
  const month = validDate.getMonth() + 1
  const hour = validDate.getHours()
  const season: SeasonId = month >= 3 && month <= 5
    ? 'spring'
    : month >= 6 && month <= 8
      ? 'summer'
      : month >= 9 && month <= 11
        ? 'autumn'
        : 'winter'
  const timeOfDay: TimeOfDay = hour >= 5 && hour < 9
    ? 'morning'
    : hour >= 9 && hour < 17
      ? 'day'
      : hour >= 17 && hour < 20
        ? 'evening'
        : 'night'
  return { season, timeOfDay }
}

/**
 * 解析 viewer / preview 实际使用的环境。`auto` 只在进入场景时调用一次，
 * 返回副本，不修改场景文档；天气等其余字段保持作者配置。
 */
export function resolveSceneRuntimeEnvironment(
  document: SceneJsonExportDocument | null | undefined,
  now: Date = new Date(),
): EnvironmentSettings {
  const settings = resolveDocumentEnvironment(document)
  if (settings.slowroads.controlMode !== 'auto') {
    return settings
  }
  return {
    ...settings,
    slowroads: {
      ...settings.slowroads,
      ...resolveAutoSlowroadsEnvironment(now),
    },
  }
}

export function isRuntimeEnvironmentSwitchEnabled(settings: EnvironmentSettings): boolean {
  return settings.slowroads.controlMode === 'manual'
}
