import { describe, expect, it } from 'vitest'
import {
  classifyLandscapeDevice,
  resolveAdaptiveCalibrationDecision,
  resolveAdaptiveLandscapeProfile,
  type ProceduralLandscapeAdaptiveProfile,
} from '@schema/proceduralLandscape/adaptive'

const LIO_DEVICE = {
  platform: 'android',
  benchmarkLevel: 26,
  memoryMb: 7468,
  cpuCores: 8,
  maxTextureSize: 16383,
}

function profile(overrides: Partial<ProceduralLandscapeAdaptiveProfile> = {}): ProceduralLandscapeAdaptiveProfile {
  return {
    deviceTier: 'mid',
    sceneAreaKm2: 1663,
    targetCoverage: 0.7,
    targetDensity: 0.7,
    targetFps: 40,
    targetTreesPerKm2: 30,
    targetTreeCount: 49_890,
    calibrationStep: 0.06,
    minFps: 35,
    maxFps: 48,
    ...overrides,
  }
}

describe('adaptive landscape profile', () => {
  it('classifies the LIO device as mid and resolves a 0.70 large-scene target', () => {
    expect(classifyLandscapeDevice(LIO_DEVICE)).toBe('mid')
    const resolved = resolveAdaptiveLandscapeProfile({
      device: LIO_DEVICE,
      sceneAreaKm2: 1663,
      environment: 'viewer',
      quality: 'auto',
    })
    expect(resolved).toMatchObject({
      deviceTier: 'mid',
      targetCoverage: 0.7,
      targetDensity: 0.7,
      targetFps: 40,
      targetTreesPerKm2: 30,
      targetTreeCount: 49_890,
    })
  })

  it('adapts by device tier and clamps scene area adjustments', () => {
    const low = resolveAdaptiveLandscapeProfile({
      device: { benchmarkLevel: 8, memoryMb: 3072, maxTextureSize: 2048 },
      sceneAreaKm2: 20,
      environment: 'viewer',
      quality: 'auto',
    })
    expect(low?.deviceTier).toBe('low')
    expect(low?.targetCoverage).toBe(0.6)

    const high = resolveAdaptiveLandscapeProfile({
      device: { benchmarkLevel: 45, memoryMb: 12288, maxTextureSize: 16384 },
      sceneAreaKm2: 3000,
      environment: 'viewer',
      quality: 'auto',
    })
    expect(high?.deviceTier).toBe('high')
    expect(high?.targetCoverage).toBe(0.8)

    const tiny = resolveAdaptiveLandscapeProfile({
      device: LIO_DEVICE,
      sceneAreaKm2: 10,
      environment: 'viewer',
      quality: 'auto',
    })
    expect(tiny?.targetCoverage).toBe(0.8)
  })

  it('does not adapt manual quality or the editor', () => {
    expect(resolveAdaptiveLandscapeProfile({
      device: LIO_DEVICE,
      sceneAreaKm2: 1663,
      environment: 'viewer',
      quality: 'low',
    })).toBeNull()
    expect(resolveAdaptiveLandscapeProfile({
      device: LIO_DEVICE,
      sceneAreaKm2: 1663,
      environment: 'editor',
      quality: 'auto',
    })).toBeNull()
  })
})

describe('adaptive calibration', () => {
  it('decreases only when FPS is below target or memory is critical', () => {
    expect(resolveAdaptiveCalibrationDecision({
      fps: 30,
      treeCount: 50_000,
      memoryPressure: false,
      profile: profile(),
      attempts: 0,
    })).toMatchObject({ action: 'decrease', coverage: 0.64, density: 0.64 })

    expect(resolveAdaptiveCalibrationDecision({
      fps: 55,
      treeCount: 40_000,
      memoryPressure: true,
      profile: profile(),
      attempts: 0,
    })).toMatchObject({ action: 'decrease' })
  })

  it('increases when FPS has headroom and the forest is below target', () => {
    expect(resolveAdaptiveCalibrationDecision({
      fps: 55,
      treeCount: 34_000,
      memoryPressure: false,
      profile: profile(),
      attempts: 0,
    })).toMatchObject({ action: 'increase', coverage: 0.76, density: 0.76 })

    expect(resolveAdaptiveCalibrationDecision({
      fps: 55,
      treeCount: 48_000,
      memoryPressure: false,
      profile: profile(),
      attempts: 0,
    })).toMatchObject({ action: 'keep' })
  })

  it('never rebuilds twice for one scene load', () => {
    expect(resolveAdaptiveCalibrationDecision({
      fps: 20,
      treeCount: 20_000,
      memoryPressure: true,
      profile: profile({ targetCoverage: 0.64 }),
      attempts: 1,
    })).toEqual({ action: 'keep', coverage: 0.64, density: 0.64 })
  })
})
