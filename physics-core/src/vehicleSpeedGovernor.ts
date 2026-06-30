import type { PhysicsVehicleDesc } from './types'

export type PhysicsWorldVehicleControl = {
  steeringValue: number
  engineForce: number
  brakeForce: number
}

export type PhysicsVehicleSpeedGovernorState = {
  desc: PhysicsVehicleDesc
  speedGovernorScale: number
  speedGovernorBrakeAssist: number
  speedGovernorOverHardCap: boolean
  speedGovernorSmoothedForwardSpeedAbs: number
}

export type PhysicsVehicleSpeedGovernorInput = {
  steeringInput: number
  throttleInput: number
  brakeInput: number
  handbrakeInput: number
  forwardSpeed: number
  deltaSeconds: number
}

export type PhysicsVehicleSpeedGovernorResult = {
  control: PhysicsWorldVehicleControl
  speedForGovernor: number
}

export type PhysicsVehicleWakeInput = Pick<
  PhysicsVehicleSpeedGovernorInput,
  'steeringInput' | 'throttleInput' | 'brakeInput' | 'handbrakeInput'
>

type NormalizedVehicleSpeedGovernorInput = {
  steeringInput: number
  throttleInput: number
  brakeInput: number
  handbrakeInput: number
  forwardSpeed: number
  deltaSeconds: number
}

type VehicleSpeedGovernorContext = {
  input: NormalizedVehicleSpeedGovernorInput
  speedForGovernor: number
  dt: number
  maxSpeedMps: number | null
  throttleActive: boolean
  acceleratingSameDirection: boolean
  hardCap: number
  softCap: number
  brakeBlend: number
}

const VEHICLE_ENGINE_FORCE = 420
const VEHICLE_BRAKE_FORCE = 42
const VEHICLE_STEER_ANGLE = (26 * Math.PI) / 180
const VEHICLE_SPEED_GOVERNOR_SOFT_RATIO = 0.96
const VEHICLE_SPEED_GOVERNOR_BRAKE_ENTER_OFFSET = 0.45
const VEHICLE_SPEED_GOVERNOR_BRAKE_EXIT_OFFSET = 0.2
const VEHICLE_SPEED_GOVERNOR_BRAKE_DEADBAND = 0.35
const VEHICLE_SPEED_GOVERNOR_BRAKE_BAND = 1.8
const VEHICLE_SPEED_GOVERNOR_BRAKE_MAX_RATIO = 0.14
const VEHICLE_BRAKE_RELEASE_SPEED = 0.45
const VEHICLE_WAKE_SPEED_THRESHOLD = 0.2

export function smoothVehicleGovernorValue(
  previousValue: number | undefined,
  targetValue: number,
  deltaSeconds: number,
  rate = 6,
): number {
  const previous = Number.isFinite(previousValue) ? previousValue as number : targetValue
  const alpha = 1 - Math.exp(-Math.max(0, rate) * Math.max(0, deltaSeconds))
  return previous + (targetValue - previous) * alpha
}

export function blendVehicleGovernorValue(
  previousValue: number | undefined,
  targetValue: number,
  previousWeight: number,
  targetWeight: number,
): number {
  const previous = Number.isFinite(previousValue) ? previousValue as number : targetValue
  const safePreviousWeight = clamp(previousWeight, 0, 1)
  const safeTargetWeight = clamp(targetWeight, 0, 1)
  if (safePreviousWeight <= 0 && safeTargetWeight <= 0) {
    return targetValue
  }
  return previous * safePreviousWeight + targetValue * safeTargetWeight
}

export function resolveVehicleGovernorSmoothedSpeedAbs(
  previousSmoothedSpeedAbs: number | undefined,
  forwardSpeed: number,
  deltaSeconds: number,
  rate = 6,
): number {
  const currentSpeedAbs = Math.abs(Number.isFinite(forwardSpeed) ? forwardSpeed : 0)
  const smoothedSpeedAbs = smoothVehicleGovernorValue(previousSmoothedSpeedAbs, currentSpeedAbs, deltaSeconds, rate)
  return Math.max(currentSpeedAbs, smoothedSpeedAbs)
}

export function resolveVehicleGovernorOverHardCap(
  previousOverHardCap: boolean | undefined,
  speedForGovernor: number,
  hardCap: number,
  enterOffset = VEHICLE_SPEED_GOVERNOR_BRAKE_ENTER_OFFSET,
  exitOffset = VEHICLE_SPEED_GOVERNOR_BRAKE_EXIT_OFFSET,
): boolean {
  if (!Number.isFinite(hardCap)) {
    return false
  }

  const safeHardCap = Math.max(0, hardCap)
  const wasOverHardCap = Boolean(previousOverHardCap)
  if (!wasOverHardCap) {
    return speedForGovernor > safeHardCap + Math.max(0, enterOffset)
  }

  return speedForGovernor >= safeHardCap + Math.max(0, exitOffset)
}

export function stepPhysicsVehicleSpeedGovernor(
  state: PhysicsVehicleSpeedGovernorState,
  input: PhysicsVehicleSpeedGovernorInput,
): PhysicsVehicleSpeedGovernorResult {
  const normalizedInput = normalizeVehicleSpeedGovernorInput(input)
  const steeringValue = normalizedInput.steeringInput * VEHICLE_STEER_ANGLE
  const context = createVehicleSpeedGovernorContext(state, normalizedInput)
  const speedForGovernor = updateVehicleSpeedGovernorSpeed(state, context)
  context.speedForGovernor = speedForGovernor
  context.brakeBlend = smoothstep(0.08, VEHICLE_BRAKE_RELEASE_SPEED, speedForGovernor)
  const engineForce = resolveVehicleEngineForce(state, context)
  const brakeForce = resolveVehicleBrakeForce(state, context)

  return {
    control: {
      steeringValue,
      engineForce,
      brakeForce,
    },
    speedForGovernor,
  }
}

export function shouldWakePhysicsVehicle(
  input: PhysicsVehicleWakeInput,
  speedForGovernor: number,
): boolean {
  return speedForGovernor > VEHICLE_WAKE_SPEED_THRESHOLD
    || Math.abs(input.throttleInput) > 0.001
    || Math.abs(input.steeringInput) > 0.001
    || Math.abs(input.brakeInput) > 0.001
    || Math.abs(input.handbrakeInput) > 0.001
}

function updateVehicleSpeedGovernorSpeed(
  state: PhysicsVehicleSpeedGovernorState,
  context: VehicleSpeedGovernorContext,
): number {
  state.speedGovernorSmoothedForwardSpeedAbs = resolveVehicleGovernorSmoothedSpeedAbs(
    state.speedGovernorSmoothedForwardSpeedAbs,
    context.input.forwardSpeed,
    context.dt,
  )
  return state.speedGovernorSmoothedForwardSpeedAbs
}

function resolveVehicleEngineForce(
  state: PhysicsVehicleSpeedGovernorState,
  context: VehicleSpeedGovernorContext,
): number {
  const throttleInput = context.input.throttleInput
  let engineForce = throttleInput * VEHICLE_ENGINE_FORCE
  const { dt } = context

  if (!context.throttleActive || context.maxSpeedMps == null) {
    relaxVehicleSpeedGovernor(state, dt)
    return engineForce * state.speedGovernorScale
  }

  if (!context.acceleratingSameDirection) {
    relaxVehicleSpeedGovernor(state, dt)
    return engineForce * state.speedGovernorScale
  }

  updateVehicleSpeedGovernorScale(state, context)
  engineForce *= state.speedGovernorScale
  return engineForce
}

function updateVehicleBrakeAssist(
  state: PhysicsVehicleSpeedGovernorState,
  context: VehicleSpeedGovernorContext,
): void {
  const { speedForGovernor, hardCap, dt } = context
  state.speedGovernorOverHardCap = resolveVehicleGovernorOverHardCap(
    state.speedGovernorOverHardCap,
    speedForGovernor,
    hardCap,
  )

  const over = state.speedGovernorOverHardCap
    ? Math.max(0, speedForGovernor - (hardCap + VEHICLE_SPEED_GOVERNOR_BRAKE_DEADBAND))
    : 0
  const brakeRatio = Math.min(1, over / VEHICLE_SPEED_GOVERNOR_BRAKE_BAND)
  const brakeTarget = brakeRatio * VEHICLE_BRAKE_FORCE * VEHICLE_SPEED_GOVERNOR_BRAKE_MAX_RATIO
  state.speedGovernorBrakeAssist = smoothVehicleGovernorValue(state.speedGovernorBrakeAssist, brakeTarget, dt, 4)
}

function resolveVehicleBrakeForce(
  state: PhysicsVehicleSpeedGovernorState,
  context: VehicleSpeedGovernorContext,
): number {
  const assistedBrake = Math.max(context.input.brakeInput, context.input.handbrakeInput)
    * VEHICLE_BRAKE_FORCE
    * context.brakeBlend
  return Math.min(VEHICLE_BRAKE_FORCE, Math.max(0, assistedBrake + state.speedGovernorBrakeAssist))
}

function relaxVehicleSpeedGovernor(state: PhysicsVehicleSpeedGovernorState, deltaSeconds: number): void {
  state.speedGovernorScale = smoothVehicleGovernorValue(state.speedGovernorScale, 1, deltaSeconds, 6)
  state.speedGovernorBrakeAssist = smoothVehicleGovernorValue(state.speedGovernorBrakeAssist, 0, deltaSeconds, 6)
  state.speedGovernorOverHardCap = false
}

function resolveVehicleMaxSpeedMps(maxSpeedKmh: number | null | undefined): number {
  if (typeof maxSpeedKmh !== 'number' || !Number.isFinite(maxSpeedKmh) || maxSpeedKmh <= 0) {
    return 45 / 3.6
  }
  return maxSpeedKmh / 3.6
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1
  }
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function normalizeVehicleSpeedGovernorInput(
  input: PhysicsVehicleSpeedGovernorInput,
): NormalizedVehicleSpeedGovernorInput {
  return {
    steeringInput: clamp(input.steeringInput, -1, 1),
    throttleInput: clamp(input.throttleInput, -1, 1),
    brakeInput: clamp(input.brakeInput, 0, 1),
    handbrakeInput: clamp(input.handbrakeInput, 0, 1),
    forwardSpeed: Number.isFinite(input.forwardSpeed) ? input.forwardSpeed : 0,
    deltaSeconds: Math.max(0, Number.isFinite(input.deltaSeconds) ? input.deltaSeconds : 0),
  }
}

function createVehicleSpeedGovernorContext(
  state: PhysicsVehicleSpeedGovernorState,
  input: NormalizedVehicleSpeedGovernorInput,
): VehicleSpeedGovernorContext {
  const dt = Math.max(1 / 240, Math.min(0.25, input.deltaSeconds))
  const maxSpeedMps = resolveVehicleMaxSpeedMps(state.desc.maxSpeedKmh)
  const throttleActive = Math.abs(input.throttleInput) > 0.05
  const acceleratingSameDirection = throttleActive
    && maxSpeedMps != null
    && Math.sign(input.forwardSpeed) === Math.sign(input.throttleInput)
    && Math.sign(input.throttleInput) !== 0
  const hardCap = maxSpeedMps == null ? Number.NaN : Math.max(0.1, maxSpeedMps)
  const softCap = maxSpeedMps == null ? Number.NaN : Math.max(0.1, hardCap * VEHICLE_SPEED_GOVERNOR_SOFT_RATIO)
  return {
    input,
    speedForGovernor: Math.max(Math.abs(input.forwardSpeed), state.speedGovernorSmoothedForwardSpeedAbs),
    dt,
    maxSpeedMps,
    throttleActive,
    acceleratingSameDirection,
    hardCap,
    softCap,
    brakeBlend: 0,
  }
}

function updateVehicleSpeedGovernorScale(
  state: PhysicsVehicleSpeedGovernorState,
  context: VehicleSpeedGovernorContext,
): void {
  const range = Math.max(0.1, context.hardCap - context.softCap)
  const excess = Math.max(0, context.speedForGovernor - context.softCap)
  const t = Math.min(1, excess / range)
  const smooth = t * t * (3 - 2 * t)
  const scaleTarget = Math.max(0, 1 - smooth)
  state.speedGovernorScale = smoothVehicleGovernorValue(state.speedGovernorScale, scaleTarget, context.dt, 14)
  updateVehicleBrakeAssist(state, context)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
