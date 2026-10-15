import { describe, expect, it } from 'vitest'
import {
  cloneEnvironmentSettings,
  DEFAULT_ENVIRONMENT_SETTINGS,
  DEFAULT_SLOWROADS_ENVIRONMENT,
  extractEnvironmentSettingsFromNodes,
  resolveDocumentEnvironment,
} from '@schema/core'
import { resolveSceneCsmSunPositionFromAngles } from '@schema/sceneCsm'
import * as THREE from 'three'

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
