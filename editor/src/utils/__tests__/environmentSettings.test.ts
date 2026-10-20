import { describe, expect, it } from 'vitest'
import {
  cloneEnvironmentSettings,
  DEFAULT_ENVIRONMENT_SETTINGS,
  DEFAULT_SLOWROADS_ENVIRONMENT,
  extractEnvironmentSettingsFromNodes,
  isRuntimeEnvironmentSwitchEnabled,
  resolveAutoSlowroadsEnvironment,
  resolveDocumentEnvironment,
  resolveSceneRuntimeEnvironment,
} from '@schema/core'
import { resolveSceneCsmSunPositionFromAngles } from '@schema/sceneCsm'
import * as THREE from 'three'
import { environmentSettingsEqual } from '@/stores/environmentUtils'

describe('environment settings (Slow Roads only)', () => {
  it('defaults contain no background/csm/ambient/orientation fields', () => {
    const settings = DEFAULT_ENVIRONMENT_SETTINGS as unknown as Record<string, unknown>
    expect(settings.background).toBeUndefined()
    expect(settings.csm).toBeUndefined()
    expect(settings.ambientLightColor).toBeUndefined()
    expect(settings.ambientLightIntensity).toBeUndefined()
    expect(settings.environmentOrientationPreset).toBeUndefined()
    expect(settings.environmentRotationDegrees).toBeUndefined()
    expect((settings.slowroads as Record<string, unknown>).showSky).toBeUndefined()
  })

  it('keeps the retained slowroads fields with defaults', () => {
    const settings = cloneEnvironmentSettings()
    expect(settings.slowroads).toEqual(DEFAULT_SLOWROADS_ENVIRONMENT)
    expect(settings.slowroads.showClouds).toBe(true)
    expect(settings.slowroads.showStars).toBe(true)
    expect(settings.slowroads.showSnow).toBe(true)
    expect(settings.slowroads.exposureScale).toBe(1)
    expect(settings.slowroads.controlMode).toBe('default')
  })

  it('drops legacy fields and clamps exposure scale on normalize', () => {
    const settings = cloneEnvironmentSettings({
      slowroads: {
        controlMode: 'manual',
        season: 'autumn',
        timeOfDay: 'evening',
        weather: 'overcast',
        showClouds: false,
        showStars: true,
        showSnow: false,
        exposureScale: 9,
      },
      // 旧字段：应被静默丢弃
      background: { mode: 'hdri', solidColor: '#516175', backgroundAssetId: 'asset-1' },
      csm: { enabled: true, shadowEnabled: true, sunAzimuthDeg: 12, sunElevationDeg: 3 },
      ambientLightColor: '#ffffff',
      ambientLightIntensity: 0.75,
      environmentOrientationPreset: 'zUp',
      environmentRotationDegrees: { x: -90, y: 0, z: 0 },
    } as never)

    const serialized = JSON.stringify(settings)
    expect(serialized).not.toContain('background')
    expect(serialized).not.toContain('csm')
    expect(serialized).not.toContain('sunAzimuthDeg')
    expect(serialized).not.toContain('environmentRotationDegrees')
    expect(serialized).not.toContain('ambientLightIntensity')
    expect(settings.slowroads.season).toBe('autumn')
    expect(settings.slowroads.controlMode).toBe('manual')
    expect(settings.slowroads.timeOfDay).toBe('evening')
    expect(settings.slowroads.weather).toBe('overcast')
    expect(settings.slowroads.showClouds).toBe(false)
    expect(settings.slowroads.showSnow).toBe(false)
    expect(settings.slowroads.exposureScale).toBe(3)
  })

  it('normalizes environment payloads stored on the Environment node', () => {
    const derived = extractEnvironmentSettingsFromNodes([
      {
        id: 'harmony:environment',
        name: 'Environment',
        nodeType: 'Environment',
        userData: {
          environment: {
            background: { mode: 'solidColor', solidColor: '#123456', backgroundAssetId: null },
            slowroads: {
              controlMode: 'default',
              season: 'winter',
              timeOfDay: 'night',
              weather: 'clear',
              exposureScale: 0.5,
            },
          },
        },
      },
    ] as never)
    expect(derived).not.toBeNull()
    expect(derived!.slowroads.season).toBe('winter')
    expect(derived!.slowroads.timeOfDay).toBe('night')
    expect(derived!.slowroads.exposureScale).toBe(0.5)
    expect(derived!.slowroads.controlMode).toBe('default')
    expect(JSON.stringify(derived)).not.toContain('backgroundAssetId')
  })

  it('falls back to defaults for missing documents', () => {
    const settings = resolveDocumentEnvironment(null)
    expect(settings).toEqual(DEFAULT_ENVIRONMENT_SETTINGS)
  })
})

describe('runtime season/time control mode', () => {
  function createDocument(
    controlMode: 'manual' | 'auto' | 'default',
    season: 'spring' | 'summer' | 'autumn' | 'winter' = 'spring',
    timeOfDay: 'morning' | 'day' | 'evening' | 'night' = 'day',
  ) {
    return {
      id: 'scene',
      name: 'Scene',
      createdAt: '',
      updatedAt: '',
      nodes: [],
      environment: {
        slowroads: {
          controlMode,
          season,
          timeOfDay,
          weather: 'overcast' as const,
          showClouds: false,
          showStars: true,
          showSnow: false,
          exposureScale: 1.4,
        },
        physicsEngine: 'cannon' as const,
        gravityStrength: 9.81,
        collisionRestitution: 0.2,
        collisionFriction: 0.3,
      },
    }
  }

  it('maps local months and hours to meteorological seasons and practical bands', () => {
    expect(resolveAutoSlowroadsEnvironment(new Date(2026, 1, 20, 4, 59))).toEqual({
      season: 'winter',
      timeOfDay: 'night',
    })
    expect(resolveAutoSlowroadsEnvironment(new Date(2026, 2, 1, 5, 0))).toEqual({
      season: 'spring',
      timeOfDay: 'morning',
    })
    expect(resolveAutoSlowroadsEnvironment(new Date(2026, 4, 31, 8, 59))).toEqual({
      season: 'spring',
      timeOfDay: 'morning',
    })
    expect(resolveAutoSlowroadsEnvironment(new Date(2026, 5, 1, 9, 0))).toEqual({
      season: 'summer',
      timeOfDay: 'day',
    })
    expect(resolveAutoSlowroadsEnvironment(new Date(2026, 8, 1, 16, 59))).toEqual({
      season: 'autumn',
      timeOfDay: 'day',
    })
    expect(resolveAutoSlowroadsEnvironment(new Date(2026, 8, 1, 17, 0))).toEqual({
      season: 'autumn',
      timeOfDay: 'evening',
    })
    expect(resolveAutoSlowroadsEnvironment(new Date(2026, 10, 30, 19, 59))).toEqual({
      season: 'autumn',
      timeOfDay: 'evening',
    })
    expect(resolveAutoSlowroadsEnvironment(new Date(2026, 10, 30, 20, 0))).toEqual({
      season: 'autumn',
      timeOfDay: 'night',
    })
    expect(resolveAutoSlowroadsEnvironment(new Date(2026, 11, 1, 12, 0))).toEqual({
      season: 'winter',
      timeOfDay: 'day',
    })
  })

  it('auto overrides only season and time while preserving weather and toggles', () => {
    const document = createDocument('auto', 'spring', 'morning')
    const before = JSON.stringify(document)
    const resolved = resolveSceneRuntimeEnvironment(document, new Date(2026, 9, 20, 18, 30))

    expect(resolved.slowroads.season).toBe('autumn')
    expect(resolved.slowroads.timeOfDay).toBe('evening')
    expect(resolved.slowroads.weather).toBe('overcast')
    expect(resolved.slowroads.showClouds).toBe(false)
    expect(resolved.slowroads.exposureScale).toBe(1.4)
    expect(JSON.stringify(document)).toBe(before)
  })

  it('manual and default preserve authored season/time and only manual shows controls', () => {
    const manual = resolveSceneRuntimeEnvironment(
      createDocument('manual', 'winter', 'night'),
      new Date(2026, 5, 1, 12, 0),
    )
    const fixed = resolveSceneRuntimeEnvironment(
      createDocument('default', 'summer', 'evening'),
      new Date(2026, 11, 1, 3, 0),
    )

    expect(manual.slowroads.season).toBe('winter')
    expect(manual.slowroads.timeOfDay).toBe('night')
    expect(isRuntimeEnvironmentSwitchEnabled(manual)).toBe(true)
    expect(fixed.slowroads.season).toBe('summer')
    expect(fixed.slowroads.timeOfDay).toBe('evening')
    expect(isRuntimeEnvironmentSwitchEnabled(fixed)).toBe(false)
  })

  it('normalizes missing or invalid control mode to manual for legacy scenes', () => {
    const legacy = cloneEnvironmentSettings({
      slowroads: {
        season: 'spring',
        timeOfDay: 'day',
        weather: 'clear',
        showClouds: true,
        showStars: true,
        showSnow: true,
        exposureScale: 1,
      } as never,
    })
    expect(legacy.slowroads.controlMode).toBe('default')
    expect(cloneEnvironmentSettings({
      slowroads: { ...legacy.slowroads, controlMode: 'invalid' as never },
    }).slowroads.controlMode).toBe('default')
  })

  it('treats control mode as a persisted environment change', () => {
    const fixed = cloneEnvironmentSettings()
    const manual = cloneEnvironmentSettings({
      slowroads: { ...fixed.slowroads, controlMode: 'manual' },
    })
    expect(environmentSettingsEqual(fixed, manual)).toBe(false)
  })
})

describe('slowroads fixed sun direction', () => {
  it('points straight down (official (0,1,0), no azimuth/elevation settings)', () => {
    // 三端 CSM 统一 syncSun(new THREE.Vector3(0, 1000, 0))：与官方 (0,1,0) 同向。
    const sun = new THREE.Vector3(0, 1000, 0).normalize()
    expect(sun.x).toBe(0)
    expect(sun.y).toBe(1)
    expect(sun.z).toBe(0)
    // 角度辅助函数把高度夹在 89°（用户不再有方位/高度设置）。
    const clamped = resolveSceneCsmSunPositionFromAngles(0, 90, 1)
    expect(clamped.y).toBeGreaterThan(0.99)
  })
})
