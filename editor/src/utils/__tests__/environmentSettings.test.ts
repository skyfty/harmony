import { describe, expect, it } from 'vitest'
import {
  cloneEnvironmentSettings,
  DEFAULT_ENVIRONMENT_SETTINGS,
  DEFAULT_SLOWROADS_ENVIRONMENT,
  extractEnvironmentSettingsFromNodes,
  resolveDocumentEnvironment,
} from '@schema/core'
import { resolveSceneCsmSunPositionFromAngles } from '@schema/sceneCsm'
import {
  SLOWROADS_SUN_AZIMUTH_DEG,
  SLOWROADS_SUN_ELEVATION_DEG,
} from '@schema/slowroads/core/environment'

/** slowroads-lab 的固定太阳向量 (0.42, 0.72, 0.28).normalize()。 */
const LAB_SUN_DIRECTION = (() => {
  const length = Math.hypot(0.42, 0.72, 0.28)
  return { x: 0.42 / length, y: 0.72 / length, z: 0.28 / length }
})()

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
  })

  it('drops legacy fields and clamps exposure scale on normalize', () => {
    const settings = cloneEnvironmentSettings({
      slowroads: {
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
            slowroads: { season: 'winter', timeOfDay: 'night', weather: 'clear', exposureScale: 0.5 },
          },
        },
      },
    ] as never)
    expect(derived).not.toBeNull()
    expect(derived!.slowroads.season).toBe('winter')
    expect(derived!.slowroads.timeOfDay).toBe('night')
    expect(derived!.slowroads.exposureScale).toBe(0.5)
    expect(JSON.stringify(derived)).not.toContain('backgroundAssetId')
  })

  it('falls back to defaults for missing documents', () => {
    const settings = resolveDocumentEnvironment(null)
    expect(settings).toEqual(DEFAULT_ENVIRONMENT_SETTINGS)
  })
})

describe('slowroads fixed sun direction', () => {
  it('matches the lab constant vector', () => {
    const position = resolveSceneCsmSunPositionFromAngles(
      SLOWROADS_SUN_AZIMUTH_DEG,
      SLOWROADS_SUN_ELEVATION_DEG,
      1,
    )
    expect(position.x).toBeCloseTo(LAB_SUN_DIRECTION.x, 3)
    expect(position.y).toBeCloseTo(LAB_SUN_DIRECTION.y, 3)
    expect(position.z).toBeCloseTo(LAB_SUN_DIRECTION.z, 3)
  })
})
