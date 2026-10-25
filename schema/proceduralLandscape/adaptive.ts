import type {
  ProceduralLandscapeEnvironment,
  ProceduralLandscapeQuality,
} from './config'

export type LandscapeDeviceTier = 'low' | 'mid' | 'high'

export interface ProceduralLandscapeDeviceProfile {
  platform?: string | null
  benchmarkLevel?: number | null
  memoryMb?: number | null
  cpuCores?: number | null
  maxTextureSize?: number | null
}

export interface ProceduralLandscapeAdaptiveProfile {
  deviceTier: LandscapeDeviceTier
  sceneAreaKm2: number
  targetCoverage: number
  targetDensity: number
  targetFps: number
  targetTreesPerKm2: number
  targetTreeCount: number
  calibrationStep: number
  minFps: number
  maxFps: number
  /**
   * Runtime calibration rebuilds the full procedural world and is therefore
   * disabled for embedded viewers. Their initial device-tier target is still
   * applied, but remains fixed for the lifetime of the world.
   */
  runtimeCalibrationEnabled: boolean
}

export type LandscapeAdaptiveCalibrationState =
  | 'disabled'
  | 'waiting'
  | 'settling'
  | 'measuring'
  | 'done'

export interface AdaptiveCalibrationInput {
  fps: number
  treeCount: number
  memoryPressure: boolean
  profile: ProceduralLandscapeAdaptiveProfile
  attempts: number
}

export interface AdaptiveCalibrationDecision {
  action: 'increase' | 'decrease' | 'keep'
  coverage: number
  density: number
}

const DEVICE_TARGET_COVERAGE: Record<LandscapeDeviceTier, number> = {
  low: 0.55,
  mid: 0.75,
  high: 0.90,
}

const DEVICE_TARGET_TREES_PER_KM2: Record<LandscapeDeviceTier, number> = {
  low: 20,
  mid: 30,
  high: 40,
}

const TARGET_FPS = 40
const MIN_TARGET_FPS = 35
const MAX_TARGET_FPS = 48
const CALIBRATION_STEP = 0.06
const MIN_FOREST_SCALE = 0.45
const MAX_FOREST_SCALE = 1

function finitePositive(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function classifyLandscapeDevice(
  profile: ProceduralLandscapeDeviceProfile | null | undefined,
): LandscapeDeviceTier {
  const benchmark = finitePositive(profile?.benchmarkLevel)
  const memory = finitePositive(profile?.memoryMb)
  const maxTextureSize = finitePositive(profile?.maxTextureSize)
  if ((benchmark != null && benchmark >= 35)
    || (memory != null && memory >= 8192 && (maxTextureSize == null || maxTextureSize >= 8192))) {
    return 'high'
  }
  if ((benchmark != null && benchmark < 15)
    || (memory != null && memory < 4096)
    || (maxTextureSize != null && maxTextureSize < 4096)) {
    return 'low'
  }
  return 'mid'
}

export function resolveAdaptiveLandscapeProfile(options: {
  device: ProceduralLandscapeDeviceProfile | null | undefined
  sceneAreaKm2: number
  environment: ProceduralLandscapeEnvironment
  quality: ProceduralLandscapeQuality | string | null | undefined
}): ProceduralLandscapeAdaptiveProfile | null {
  if (options.environment === 'editor' || options.quality !== 'auto') {
    return null
  }
  const deviceTier = classifyLandscapeDevice(options.device)
  const sceneAreaKm2 = Math.max(0.001, Number(options.sceneAreaKm2) || 0)
  let target = DEVICE_TARGET_COVERAGE[deviceTier]
  if (sceneAreaKm2 > 2000) {
    target -= 0.10
  } else if (sceneAreaKm2 > 500) {
    target -= 0.05
  } else if (sceneAreaKm2 < 50) {
    target += 0.05
  }
  target = round(clamp(target, MIN_FOREST_SCALE, MAX_FOREST_SCALE))
  const targetTreesPerKm2 = DEVICE_TARGET_TREES_PER_KM2[deviceTier]
  return {
    deviceTier,
    sceneAreaKm2,
    targetCoverage: target,
    targetDensity: target,
    targetFps: TARGET_FPS,
    targetTreesPerKm2,
    targetTreeCount: Math.max(1000, Math.round(sceneAreaKm2 * targetTreesPerKm2)),
    calibrationStep: CALIBRATION_STEP,
    minFps: MIN_TARGET_FPS,
    maxFps: MAX_TARGET_FPS,
    runtimeCalibrationEnabled: options.environment !== 'viewer',
  }
}

export function resolveAdaptiveCalibrationDecision(
  input: AdaptiveCalibrationInput,
): AdaptiveCalibrationDecision {
  const current = input.profile.targetCoverage
  if (input.attempts >= 1) {
    return { action: 'keep', coverage: current, density: current }
  }
  if (!Number.isFinite(input.fps) || input.fps < input.profile.minFps || input.memoryPressure) {
    const next = round(clamp(current - input.profile.calibrationStep, MIN_FOREST_SCALE, MAX_FOREST_SCALE))
    return { action: 'decrease', coverage: next, density: next }
  }
  const treeTarget = input.profile.targetTreeCount
  if (input.fps > input.profile.maxFps
    && treeTarget > 0
    && input.treeCount < treeTarget * 0.9) {
    const next = round(clamp(current + input.profile.calibrationStep, MIN_FOREST_SCALE, MAX_FOREST_SCALE))
    return { action: next === current ? 'keep' : 'increase', coverage: next, density: next }
  }
  return { action: 'keep', coverage: current, density: current }
}
