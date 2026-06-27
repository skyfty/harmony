export type VehicleLongitudinalControlState = {
  filteredForwardSpeedMps: number
  speedIntegral: number
  throttle: number
  lastTargetSpeedMps: number
}

export type VehicleLongitudinalControlOptions = {
  state: VehicleLongitudinalControlState
  targetSpeedMps: number
  currentForwardSpeedMps: number
  maxSpeedMps?: number
  deltaSeconds: number
  speedFilterRate?: number
  proportionalGain?: number
  integralGain?: number
  integralLimit?: number
  throttleRiseRate?: number
  throttleFallRate?: number
  speedDeadbandMps?: number
}

const DEFAULT_SPEED_FILTER_RATE = 7
const DEFAULT_PROPORTIONAL_GAIN = 1.15
const DEFAULT_INTEGRAL_GAIN = 0.55
const DEFAULT_INTEGRAL_LIMIT = 1.75
const DEFAULT_THROTTLE_RISE_RATE = 3.2
const DEFAULT_THROTTLE_FALL_RATE = 4.8
const DEFAULT_SPEED_DEADBAND_MPS = 0.08

function clampSigned(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function createVehicleLongitudinalControlState(): VehicleLongitudinalControlState {
  return {
    filteredForwardSpeedMps: 0,
    speedIntegral: 0,
    throttle: 0,
    lastTargetSpeedMps: 0,
  }
}

export function resetVehicleLongitudinalControlState(state: VehicleLongitudinalControlState): void {
  state.filteredForwardSpeedMps = 0
  state.speedIntegral = 0
  state.throttle = 0
  state.lastTargetSpeedMps = 0
}

export function resolveVehicleLongitudinalThrottle(options: VehicleLongitudinalControlOptions): number {
  const {
    state,
    targetSpeedMps,
    currentForwardSpeedMps,
    maxSpeedMps,
    deltaSeconds,
    speedFilterRate = DEFAULT_SPEED_FILTER_RATE,
    proportionalGain = DEFAULT_PROPORTIONAL_GAIN,
    integralGain = DEFAULT_INTEGRAL_GAIN,
    integralLimit = DEFAULT_INTEGRAL_LIMIT,
    throttleRiseRate = DEFAULT_THROTTLE_RISE_RATE,
    throttleFallRate = DEFAULT_THROTTLE_FALL_RATE,
    speedDeadbandMps = DEFAULT_SPEED_DEADBAND_MPS,
  } = options

  const dt = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(0.25, deltaSeconds)) : 1 / 60
  const rawTarget = Number.isFinite(targetSpeedMps) ? targetSpeedMps : 0
  const targetMagnitude = Math.abs(rawTarget)
  const targetSign = Math.sign(rawTarget)
  if (targetMagnitude <= speedDeadbandMps) {
    resetVehicleLongitudinalControlState(state)
    return 0
  }

  const vehicleMaxSpeedValue = maxSpeedMps ?? 0
  const vehicleMaxSpeed = Number.isFinite(vehicleMaxSpeedValue) ? Math.max(0, vehicleMaxSpeedValue) : 0
  const controlReferenceSpeed = Math.max(targetMagnitude, vehicleMaxSpeed, 1)
  const filteredRate = Math.max(0, speedFilterRate)
  const filterAlpha = filteredRate > 0 ? 1 - Math.exp(-filteredRate * dt) : 1
  const currentSpeed = Number.isFinite(currentForwardSpeedMps) ? currentForwardSpeedMps : 0

  if (state.lastTargetSpeedMps !== 0 && Math.sign(state.lastTargetSpeedMps) !== targetSign) {
    state.speedIntegral = 0
    state.throttle = 0
    state.filteredForwardSpeedMps = currentSpeed
  }
  state.lastTargetSpeedMps = rawTarget

  state.filteredForwardSpeedMps += (currentSpeed - state.filteredForwardSpeedMps) * filterAlpha
  const observedSpeed = state.filteredForwardSpeedMps
  const speedError = rawTarget - observedSpeed
  const errorForControl = Math.abs(speedError) <= speedDeadbandMps ? 0 : speedError
  const normalizedError = errorForControl / Math.max(0.5, controlReferenceSpeed * 0.65)

  state.speedIntegral = clampSigned(
    state.speedIntegral + normalizedError * dt,
    -Math.max(0, integralLimit),
    Math.max(0, integralLimit),
  )

  if (errorForControl === 0) {
    state.speedIntegral *= Math.exp(-4 * dt)
  } else if (errorForControl < 0 && state.throttle <= 0.02) {
    state.speedIntegral *= Math.exp(-6 * dt)
  }

  const throttleTarget = clampSigned(
    normalizedError * proportionalGain + state.speedIntegral * integralGain,
    -1,
    1,
  )
  const previousThrottle = clampSigned(state.throttle, -1, 1)
  const smoothingRate = Math.abs(throttleTarget) >= Math.abs(previousThrottle) ? throttleRiseRate : throttleFallRate
  const smoothingAlpha = smoothingRate > 0 ? 1 - Math.exp(-smoothingRate * dt) : 1
  const nextThrottle = previousThrottle + (throttleTarget - previousThrottle) * smoothingAlpha

  state.throttle = clampSigned(nextThrottle, -1, 1)
  return state.throttle
}
