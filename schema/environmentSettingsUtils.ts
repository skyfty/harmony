export type { EnvironmentSettings, EnvironmentNorthDirection } from './core';
import type {
  EnvironmentNorthDirection,
  EnvironmentSettings,
  SceneJsonExportDocument,
  SceneNode,
  SlowroadsEnvironmentSettings,
} from './core'

export const DEFAULT_ENVIRONMENT_PHYSICS_ENABLED = true
export const DEFAULT_ENVIRONMENT_PHYSICS_ENGINE = 'cannon' as const
export const DEFAULT_ENVIRONMENT_GRAVITY = 9.81
export const DEFAULT_ENVIRONMENT_RESTITUTION = 0.2
export const DEFAULT_ENVIRONMENT_FRICTION = 0.3
export const DEFAULT_ENVIRONMENT_NORTH_DIRECTION = '+X' as const
export const DEFAULT_ENVIRONMENT_VIEWPORT_PERFORMANCE_MODE = false

export const DEFAULT_SLOWROADS_ENVIRONMENT: import('./core').SlowroadsEnvironmentSettings = {
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
  const season = source.season
  const timeOfDay = source.timeOfDay
  const weather = source.weather
  return {
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
