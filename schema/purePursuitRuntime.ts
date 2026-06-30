import * as THREE from 'three'
import {
  applyPhysicsVehicleWheelControl,
  blendVehicleGovernorValue,
  resolveVehicleGovernorSmoothedSpeedAbs,
} from '@harmony/physics-core'
import type { PurePursuitComponentProps, VehicleComponentProps } from './components'
import { resolvePathFollowLookaheadDistance, resolvePathFollowPlanarArrivalDistance, resolvePathFollowSample } from './pathFollowCommon'
import { buildPolylineVertexArcLengths } from './polylineProgress'
import { sleepPhysicsBody, stopPhysicsBodyMotion } from './physicsRuntimeBridge'
import type { VehicleDriveVehicle } from './VehicleDriveController'

export const VEHICLE_PARKED_SPEED_EPSILON = 0.08
export const VEHICLE_PARKING_HOLD_SPEED_EPSILON = 0.2

export type PurePursuitVehicleInstanceLike = {
  vehicle: VehicleDriveVehicle
  wheelCount: number
  steerableWheelIndices: number[]
  axisForward: THREE.Vector3
}

export type PurePursuitVehicleSteeringState = {
  lastSteerRad?: number
}

export type PurePursuitVehicleLongitudinalState = {
  lastBrakeForce?: number
  speedTargetMps?: number
  forwardSpeedMps?: number
  longitudinalErrorMps?: number
  reverseActive?: boolean
  longitudinalUseEngine?: boolean
  longitudinalModeSwitchAtMs?: number
  speedIntegral?: number
}

export type PurePursuitVehicleGovernorState = {
  speedGovernorScale?: number
  speedGovernorBrakeAssist?: number
  speedGovernorSmoothedForwardSpeedAbs?: number
  speedGovernorOverHardCap?: boolean
}

export type PurePursuitVehicleControlState = {
  steering?: PurePursuitVehicleSteeringState
  longitudinal?: PurePursuitVehicleLongitudinalState
  governor?: PurePursuitVehicleGovernorState
}

export type PurePursuitVehicleStopState = 'tracking' | 'approach' | 'dock-approach' | 'stopping' | 'hold'

export type PurePursuitVehicleControlResult = {
  reachedStop: boolean
  steeringRad: number
  targetSpeedMps: number
  engineForce: number
  brakeForce: number
  stopState: PurePursuitVehicleStopState
}

const parkedSpeedQuaternion = new THREE.Quaternion()
const parkedSpeedForward = new THREE.Vector3()
const purePursuitChassisPosition = new THREE.Vector3()
const purePursuitChassisQuaternion = new THREE.Quaternion()
const forwardWorld = new THREE.Vector3()
const purePursuitUp = new THREE.Vector3(0, 1, 0)
const purePursuitLookaheadPoint = new THREE.Vector3()
const purePursuitClosestPoint = new THREE.Vector3()
const purePursuitTargetDelta = new THREE.Vector3()
const yawTargetQuat = new THREE.Quaternion()
const objectWorldQuat = new THREE.Quaternion()
const PURE_PURSUIT_DEFAULT_RUNTIME_SPEED_CAP_MPS = 40 / 3.6

const PURE_PURSUIT_STOP_HOLD_BRAKE_MULTIPLIER = 6
function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(1, value))
}

function smoothstep01(value: number): number {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.max(min, Math.min(max, value))
}

function getSafeDeltaSeconds(value: number): number {
  return Number.isFinite(value) ? clampNumber(value, 0, 0.25) : 1 / 60
}

function getSteeringState(state: PurePursuitVehicleControlState): PurePursuitVehicleSteeringState {
  if (!state.steering) {
    state.steering = {}
  }
  return state.steering
}

function getLongitudinalState(state: PurePursuitVehicleControlState): PurePursuitVehicleLongitudinalState {
  if (!state.longitudinal) {
    state.longitudinal = {}
  }
  return state.longitudinal
}

function getGovernorState(state: PurePursuitVehicleControlState): PurePursuitVehicleGovernorState {
  if (!state.governor) {
    state.governor = {}
  }
  return state.governor
}

function getLastSteerRad(state: PurePursuitVehicleControlState): number {
  const steeringState = getSteeringState(state)
  return typeof steeringState.lastSteerRad === 'number' ? steeringState.lastSteerRad : 0
}

function getLastBrakeForce(state: PurePursuitVehicleControlState): number {
  const longitudinalState = getLongitudinalState(state)
  return typeof longitudinalState.lastBrakeForce === 'number' ? longitudinalState.lastBrakeForce : 0
}

export function resetPurePursuitVehicleControlState(state: PurePursuitVehicleControlState): void {
  state.steering = undefined
  state.longitudinal = undefined
  state.governor = undefined
}

function createControlFallbackResult(state: PurePursuitVehicleControlState): PurePursuitVehicleControlResult {
  return {
    reachedStop: false,
    steeringRad: getLastSteerRad(state),
    targetSpeedMps: 0,
    engineForce: 0,
    brakeForce: getLastBrakeForce(state),
    stopState: 'tracking',
  }
}

function resolvePurePursuitStopOverrides(params: {
  alignYaw: boolean
  clampStopIndex: number
  endIndex: number
  points: THREE.Vector3[]
  forwardWorld: THREE.Vector3
  chassisBody: VehicleDriveVehicle['chassisBody']
  pursuitProps: PurePursuitComponentProps
  vehicleProps: VehicleComponentProps
  dt: number
}): { steeringRad: number; engineForce: number; brakeForceFloor: number } | null {
  const brakeForceMax = Number.isFinite(params.vehicleProps.brakeForceMax) ? Math.max(0, params.vehicleProps.brakeForceMax) : 0
  if (brakeForceMax <= 0) {
    return null
  }

  if (params.alignYaw && params.pursuitProps.dockYawEnabled) {
    const prevIndex = params.clampStopIndex > 0 ? params.clampStopIndex - 1 : Math.min(params.clampStopIndex + 1, params.endIndex)
    const prev = params.points[prevIndex]!
    const stopPoint = params.points[params.clampStopIndex]!
    const tanX = stopPoint.x - prev.x
    const tanZ = stopPoint.z - prev.z
    const tanLen = Math.sqrt(tanX * tanX + tanZ * tanZ)
    const yaw = tanLen > 1e-6
      ? Math.atan2(tanX / tanLen, tanZ / tanLen)
      : Math.atan2(params.forwardWorld.x, params.forwardWorld.z)

    yawTargetQuat.setFromAxisAngle(purePursuitUp, yaw)
    const alphaYaw = 1 - Math.exp(-Math.max(0, params.pursuitProps.dockYawSlerpRate) * params.dt)
    objectWorldQuat.copy(params.chassisBody.quaternion)
    objectWorldQuat.slerp(yawTargetQuat, clamp01(alphaYaw)).normalize()
    params.chassisBody.quaternion.x = objectWorldQuat.x
    params.chassisBody.quaternion.y = objectWorldQuat.y
    params.chassisBody.quaternion.z = objectWorldQuat.z
    params.chassisBody.quaternion.w = objectWorldQuat.w
  }

  params.chassisBody.angularVelocity.x *= 0.85
  params.chassisBody.angularVelocity.y *= 0.6
  params.chassisBody.angularVelocity.z *= 0.85

  return {
    steeringRad: 0,
    engineForce: 0,
    brakeForceFloor: brakeForceMax * PURE_PURSUIT_STOP_HOLD_BRAKE_MULTIPLIER,
  }
}

function resolvePurePursuitSteeringRad(params: {
  vehicleProps: VehicleComponentProps
  wheelbaseMeters: number
  targetLen: number
  forwardWorld: THREE.Vector3
  desiredDir: THREE.Vector3
  lastSteerRad: number
  deltaSeconds: number
}): number {
  const { vehicleProps, wheelbaseMeters, targetLen, forwardWorld, desiredDir, lastSteerRad, deltaSeconds } = params
  const crossY = forwardWorld.x * desiredDir.z - forwardWorld.z * desiredDir.x
  const dot = THREE.MathUtils.clamp(forwardWorld.dot(desiredDir), -1, 1)
  // Steering convention in the vehicle layer is:
  //   positive = right turn, negative = left turn.
  // The geometric cross product sign is opposite to that convention here,
  // so we invert it before converting to a steering angle.
  const alpha = (crossY >= 0 ? -1 : 1) * Math.acos(dot)
  const maxSteerRad = THREE.MathUtils.degToRad(Math.max(0, vehicleProps.maxSteerDegrees))
  const safeMaxSteer = Number.isFinite(maxSteerRad) && maxSteerRad > 1e-6 ? maxSteerRad : THREE.MathUtils.degToRad(26)

  let steeringRad = Math.atan2(2 * wheelbaseMeters * Math.sin(alpha), Math.max(1e-6, targetLen))
  steeringRad = THREE.MathUtils.clamp(steeringRad, -safeMaxSteer, safeMaxSteer)

  const maxSteerStep = THREE.MathUtils.degToRad(Math.max(0, vehicleProps.maxSteerRateDegPerSec)) * deltaSeconds
  return THREE.MathUtils.clamp(steeringRad, lastSteerRad - maxSteerStep, lastSteerRad + maxSteerStep)
}

function resolvePurePursuitGovernorScale(params: {
  speedGovernorScale?: number
  currentSpeedAbs: number
  steeringRad: number
  wheelbaseMeters: number
  distanceToEnd: number
  commandedCruiseSpeed: number
  pursuitProps: PurePursuitComponentProps
  modeStopping: boolean
  dockActive: boolean
  dockHoldActive: boolean
}): number {
  const {
    speedGovernorScale,
    currentSpeedAbs,
    steeringRad,
    wheelbaseMeters,
    distanceToEnd,
    commandedCruiseSpeed,
    pursuitProps,
    modeStopping,
    dockActive,
    dockHoldActive,
  } = params

  const curvatureInfluence = Math.abs(Math.sin(Math.atan2(Math.tan(steeringRad), 1)))
  const curvatureScale = 1 / (1 + Math.max(0, pursuitProps.curvatureSpeedFactor) * curvatureInfluence * Math.max(0.5, wheelbaseMeters * 0.45))
  const approachDistance = resolvePathFollowPlanarArrivalDistance(
    Math.max(currentSpeedAbs, commandedCruiseSpeed),
    pursuitProps.arrivalDistanceMinMeters,
    pursuitProps.arrivalDistanceMaxMeters,
    pursuitProps.arrivalDistanceSpeedFactor,
  )
  const brakeDistance = Math.max(
    approachDistance,
    Math.max(0, pursuitProps.brakeDistanceMinMeters) + Math.max(0, currentSpeedAbs) * Math.max(0, pursuitProps.brakeDistanceSpeedFactor),
  )

  let distanceScale = 1
  if (!modeStopping && !dockHoldActive && Number.isFinite(distanceToEnd)) {
    const approachScale = smoothstep01(clamp01(distanceToEnd / Math.max(approachDistance, 1e-6)))
    const brakeScale = smoothstep01(clamp01(distanceToEnd / Math.max(brakeDistance, 1e-6)))
    distanceScale = Math.min(approachScale, brakeScale)
  }

  let dockScale = 1
  if (dockActive) {
    dockScale = smoothstep01(clamp01(distanceToEnd / Math.max(0.1, pursuitProps.dockStartDistanceMeters)))
  }

  return clamp01(
    blendVehicleGovernorValue(speedGovernorScale, curvatureScale * distanceScale * dockScale, 0.35, 0.65),
  )
}

function resolvePurePursuitTargetSpeed(params: {
  speedMps: number
  speedCapMps?: number
  hardCapMps: number
  speedGovernorScale?: number
  currentSpeedAbs: number
  steeringRad: number
  wheelbaseMeters: number
  distanceToEnd: number
  pursuitProps: PurePursuitComponentProps
  modeStopping: boolean
  dockActive: boolean
  dockHoldActive: boolean
}): {
  targetSpeedMps: number
  governorScale: number
  stopState: PurePursuitVehicleStopState
} {
  const hardCapMps = Number.isFinite(params.speedCapMps)
    ? Math.max(0, params.speedCapMps as number)
    : Math.max(0, params.hardCapMps)
  const commandedCruiseSpeed = clampNumber(Math.max(0, params.speedMps), 0, hardCapMps)
  const governorScale = resolvePurePursuitGovernorScale({
    speedGovernorScale: params.speedGovernorScale,
    currentSpeedAbs: params.currentSpeedAbs,
    steeringRad: params.steeringRad,
    wheelbaseMeters: params.wheelbaseMeters,
    distanceToEnd: params.distanceToEnd,
    commandedCruiseSpeed,
    pursuitProps: params.pursuitProps,
    modeStopping: params.modeStopping,
    dockActive: params.dockActive,
    dockHoldActive: params.dockHoldActive,
  })

  const clampFloor = params.modeStopping || params.dockHoldActive || params.dockActive ? 0 : Math.min(params.pursuitProps.minSpeedMps, commandedCruiseSpeed)
  let targetSpeedMps = commandedCruiseSpeed * governorScale

  if (!params.modeStopping && !params.dockHoldActive) {
    targetSpeedMps = Math.max(targetSpeedMps, clampFloor)
  }
  if (params.dockActive) {
    targetSpeedMps = Math.min(targetSpeedMps, Math.max(0, params.pursuitProps.dockMaxSpeedMps))
  }

  let stopState: PurePursuitVehicleStopState = 'tracking'
  if (params.dockActive) {
    stopState = 'dock-approach'
  } else if (governorScale < 0.98) {
    stopState = 'approach'
  }
  if (params.modeStopping) {
    stopState = 'stopping'
  }

  return {
    targetSpeedMps,
    governorScale,
    stopState,
  }
}

function resolvePurePursuitDriveForces(params: {
  targetSpeedMps: number
  currentSpeedAbs: number
  hardCapMps: number
  speedIntegral: number
  lastUseEngine?: boolean
  speedGovernorOverHardCap?: boolean
  speedGovernorBrakeAssist?: number
  pursuitProps: PurePursuitComponentProps
  vehicleProps: VehicleComponentProps
  deltaSeconds: number
  modeStopping: boolean
  dockHoldActive: boolean
}): {
  engineForce: number
  brakeForce: number
  speedIntegral: number
  desiredUseEngine: boolean
  speedGovernorBrakeAssist: number
  speedGovernorOverHardCap: boolean
} {
  const {
    targetSpeedMps,
    currentSpeedAbs,
    hardCapMps,
    speedIntegral,
    lastUseEngine,
    speedGovernorOverHardCap,
    speedGovernorBrakeAssist,
    pursuitProps,
    vehicleProps,
    deltaSeconds,
    modeStopping,
    dockHoldActive,
  } = params

  const speedError = targetSpeedMps - currentSpeedAbs
  let nextIntegral = speedIntegral
  if (!dockHoldActive && !modeStopping) {
    const deadband = Math.max(0, pursuitProps.coastDeadbandMps)
    if (Math.abs(speedError) > deadband || targetSpeedMps > deadband) {
      nextIntegral = clampNumber(speedIntegral + speedError * deltaSeconds, -pursuitProps.speedIntegralMax, pursuitProps.speedIntegralMax)
    } else {
      nextIntegral *= 0.5
    }
  } else {
    nextIntegral *= 0.35
  }

  const piTerm = Math.max(0, pursuitProps.speedKp) * speedError + Math.max(0, pursuitProps.speedKi) * nextIntegral
  const engineSpeedCapMps = Math.max(1, hardCapMps)
  const engineForceMax = Math.max(0, vehicleProps.engineForceMax)
  const brakeForceMax = Math.max(0, vehicleProps.brakeForceMax)
  const coastDecelForceLimit = engineForceMax * clamp01(pursuitProps.coastDecelForceFactor)

  const overSpeed = currentSpeedAbs > targetSpeedMps + 0.02
  const desiredUseEngine = (
    piTerm > 0.01
    || speedError < -Math.max(0, pursuitProps.coastDeadbandMps)
  ) && !modeStopping && !dockHoldActive && !Boolean(speedGovernorOverHardCap)
  const brakeAssistScale = clamp01(modeStopping || dockHoldActive ? 1 : 0)
  const brakeAssist = brakeAssistScale * brakeForceMax
  const smoothedBrakeAssist = blendVehicleGovernorValue(speedGovernorBrakeAssist, brakeAssistScale, 0.5, 0.5)

  let engineForce = 0
  let brakeForce = 0
  const shouldUseEngine = desiredUseEngine || (lastUseEngine === true && !overSpeed && !modeStopping && !dockHoldActive)
  if (shouldUseEngine) {
    const throttleResponse = clamp01(Math.max(0, targetSpeedMps) / Math.max(0.1, engineSpeedCapMps))
    const responseGain = 0.55 + 0.45 * throttleResponse
    const rawEngineForce = piTerm * responseGain * engineForceMax / engineSpeedCapMps
    if (speedError < -Math.max(0, pursuitProps.coastDeadbandMps)) {
      engineForce = clampNumber(rawEngineForce, -coastDecelForceLimit, 0)
    } else {
      engineForce = clampNumber(rawEngineForce, 0, engineForceMax)
    }
  }

  if (modeStopping || dockHoldActive) {
    engineForce = 0
    brakeForce = Math.max(brakeForce, brakeAssist)
  }

  return {
    engineForce,
    brakeForce,
    speedIntegral: nextIntegral,
    desiredUseEngine: shouldUseEngine,
    speedGovernorBrakeAssist: smoothedBrakeAssist,
    speedGovernorOverHardCap: currentSpeedAbs >= Math.max(0, hardCapMps) - 1e-3
      || Boolean(speedGovernorOverHardCap),
  }
}

function resolvePurePursuitLongitudinalControl(params: {
  speedMps: number
  speedCapMps?: number
  steeringRad: number
  forwardSignedSpeed: number
  speedIntegral: number
  lastUseEngine?: boolean
  speedGovernorScale?: number
  speedGovernorBrakeAssist?: number
  speedGovernorSmoothedForwardSpeedAbs?: number
  speedGovernorOverHardCap?: boolean
  pursuitProps: PurePursuitComponentProps
  vehicleProps: VehicleComponentProps
  deltaSeconds: number
  modeStopping: boolean
  distanceToEnd: number
  dockActive: boolean
  dockHoldActive: boolean
}): {
  speedTargetMps: number
  engineForce: number
  brakeForce: number
  speedIntegral: number
  speedGovernorScale: number
  speedGovernorBrakeAssist: number
  speedGovernorSmoothedForwardSpeedAbs: number
  speedGovernorOverHardCap: boolean
  desiredUseEngine: boolean
  stopState: PurePursuitVehicleStopState
} {
  const {
    speedMps,
    speedCapMps,
    steeringRad,
    forwardSignedSpeed,
    speedIntegral,
    lastUseEngine,
    speedGovernorScale,
    speedGovernorBrakeAssist,
    speedGovernorSmoothedForwardSpeedAbs,
    speedGovernorOverHardCap,
    pursuitProps,
    vehicleProps,
    deltaSeconds,
    modeStopping,
    distanceToEnd,
    dockActive,
    dockHoldActive,
  } = params

  const hardCapMps = Number.isFinite(speedCapMps) ? Math.max(0, speedCapMps as number) : PURE_PURSUIT_DEFAULT_RUNTIME_SPEED_CAP_MPS
  const currentSpeedAbs = Math.abs(forwardSignedSpeed)
  const wheelbaseMeters = Math.max(0.25, Number.isFinite(vehicleProps.wheelbaseMeters) ? vehicleProps.wheelbaseMeters : 0)

  const nextSmoothedSpeedAbs = resolveVehicleGovernorSmoothedSpeedAbs(
    speedGovernorSmoothedForwardSpeedAbs,
    currentSpeedAbs,
    deltaSeconds,
  )
  const targetSpeed = resolvePurePursuitTargetSpeed({
    speedMps,
    speedCapMps,
    hardCapMps,
    speedGovernorScale,
    currentSpeedAbs,
    steeringRad,
    wheelbaseMeters,
    distanceToEnd,
    pursuitProps,
    modeStopping,
    dockActive,
    dockHoldActive,
  })
  const driveForces = resolvePurePursuitDriveForces({
    targetSpeedMps: targetSpeed.targetSpeedMps,
    currentSpeedAbs,
    hardCapMps,
    speedIntegral,
    lastUseEngine,
    speedGovernorOverHardCap,
    speedGovernorBrakeAssist,
    pursuitProps,
    vehicleProps,
    deltaSeconds,
    modeStopping,
    dockHoldActive,
  })

  return {
    speedTargetMps: targetSpeed.targetSpeedMps,
    engineForce: driveForces.engineForce,
    brakeForce: driveForces.brakeForce,
    speedIntegral: driveForces.speedIntegral,
    speedGovernorScale: targetSpeed.governorScale,
    speedGovernorBrakeAssist: driveForces.speedGovernorBrakeAssist,
    speedGovernorSmoothedForwardSpeedAbs: nextSmoothedSpeedAbs,
    speedGovernorOverHardCap: driveForces.speedGovernorOverHardCap,
    desiredUseEngine: driveForces.desiredUseEngine,
    stopState: targetSpeed.stopState,
  }
}

function resolvePurePursuitControlStopOutcome(params: {
  steeringRad: number
  speedTarget: ReturnType<typeof resolvePurePursuitLongitudinalControl>
  dockHoldActive: boolean
  modeStopping: boolean
  loop: boolean
  dockActive: boolean
  remainingDistanceToEnd: number
  remainingDistanceToStop: number
  forwardSpeed: number
  targetIndex: number
  points: THREE.Vector3[]
  forwardWorld: THREE.Vector3
  chassisBody: VehicleDriveVehicle['chassisBody']
  pursuitProps: PurePursuitComponentProps
  vehicleProps: VehicleComponentProps
  dt: number
}): {
  steeringRad: number
  targetSpeedMps: number
  engineForce: number
  brakeForce: number
  stopState: PurePursuitVehicleStopState
  reachedStop: boolean
} {
  const {
    steeringRad,
    speedTarget,
    dockHoldActive,
    modeStopping,
    loop,
    dockActive,
    remainingDistanceToEnd,
    remainingDistanceToStop,
    forwardSpeed,
    targetIndex,
    points,
    forwardWorld,
    chassisBody,
    pursuitProps,
    vehicleProps,
    dt,
  } = params

  let nextSteeringRad = steeringRad
  let nextTargetSpeedMps = speedTarget.speedTargetMps
  let nextEngineForce = speedTarget.engineForce
  let nextBrakeForce = speedTarget.brakeForce
  let nextStopState = speedTarget.stopState
  let reachedStop = false

  if (dockHoldActive) {
    const stopOverrides = resolvePurePursuitStopOverrides({
      alignYaw: true,
      clampStopIndex: targetIndex,
      endIndex: points.length - 1,
      points,
      forwardWorld,
      chassisBody,
      pursuitProps,
      vehicleProps,
      dt,
    })
    if (stopOverrides) {
      nextSteeringRad = stopOverrides.steeringRad
      nextEngineForce = stopOverrides.engineForce
      nextBrakeForce = Math.max(nextBrakeForce, stopOverrides.brakeForceFloor)
    }
    nextTargetSpeedMps = 0
    reachedStop = true
    nextStopState = 'hold'
  } else if (modeStopping) {
    nextStopState = 'stopping'
    if (
      remainingDistanceToStop <= Math.max(0, pursuitProps.dockStopEpsilonMeters)
      && Math.abs(forwardSpeed) <= Math.max(0, pursuitProps.dockStopSpeedEpsilonMps)
    ) {
      reachedStop = true
    }
  }

  if (!reachedStop && dockActive && nextStopState === 'dock-approach') {
    nextStopState = 'dock-approach'
  } else if (!reachedStop && nextStopState === 'tracking' && !loop && remainingDistanceToEnd <= Math.max(0, pursuitProps.arrivalDistanceMaxMeters)) {
    nextStopState = 'approach'
  }

  if (reachedStop) {
    nextTargetSpeedMps = 0
    nextEngineForce = 0
    nextBrakeForce = Math.max(nextBrakeForce, Math.max(0, vehicleProps.brakeForceMax) * PURE_PURSUIT_STOP_HOLD_BRAKE_MULTIPLIER)
  }

  return {
    steeringRad: nextSteeringRad,
    targetSpeedMps: nextTargetSpeedMps,
    engineForce: nextEngineForce,
    brakeForce: nextBrakeForce,
    stopState: nextStopState,
    reachedStop,
  }
}

export function updateVehicleSpeedAndApplyParkingHoldSafe(params: {
  vehicleInstance: PurePursuitVehicleInstanceLike
  chassisBody: VehicleDriveVehicle['chassisBody']
  throttle: number
  brake: number
  resolvedForwardSpeedMps?: number | null
  parkedSpeedEpsilon?: number
  parkingHoldSpeedEpsilon?: number
  engageParkingHold?: boolean
  resolveBrakeForce: (vehicleInstance: PurePursuitVehicleInstanceLike) => number
}): number {
  const parkedSpeedEpsilon = params.parkedSpeedEpsilon ?? VEHICLE_PARKED_SPEED_EPSILON
  const parkingHoldSpeedEpsilon = params.parkingHoldSpeedEpsilon ?? VEHICLE_PARKING_HOLD_SPEED_EPSILON
  const engageParkingHold = params.engageParkingHold ?? true

  try {
    if (typeof params.resolvedForwardSpeedMps === 'number' && Number.isFinite(params.resolvedForwardSpeedMps)) {
      const forwardSpeed = Math.abs(params.resolvedForwardSpeedMps)
      if (
        engageParkingHold
        && Math.abs(params.throttle) <= 0.05
        && params.brake <= 0.05
        && forwardSpeed <= parkingHoldSpeedEpsilon
      ) {
        const brakeForce = params.resolveBrakeForce(params.vehicleInstance)
        holdVehicleBrakeSafe({ vehicleInstance: params.vehicleInstance, brakeForce })
        stopPhysicsBodyMotion(params.chassisBody)
        sleepPhysicsBody(params.chassisBody, { minSpeedLimit: 0.05, minTimeLimit: 0.05 })
      }

      return forwardSpeed >= parkedSpeedEpsilon ? forwardSpeed : 0
    }

    parkedSpeedQuaternion.set(
      params.chassisBody.quaternion.x,
      params.chassisBody.quaternion.y,
      params.chassisBody.quaternion.z,
      params.chassisBody.quaternion.w,
    )
    parkedSpeedForward.copy(params.vehicleInstance.axisForward).applyQuaternion(parkedSpeedQuaternion)
    const forwardLengthSq = parkedSpeedForward.x * parkedSpeedForward.x
      + parkedSpeedForward.y * parkedSpeedForward.y
      + parkedSpeedForward.z * parkedSpeedForward.z

    if (forwardLengthSq > 1e-8) {
      parkedSpeedForward.multiplyScalar(1 / Math.sqrt(forwardLengthSq))
      const forwardSpeed = Math.abs(
        params.chassisBody.velocity.x * parkedSpeedForward.x
        + params.chassisBody.velocity.y * parkedSpeedForward.y
        + params.chassisBody.velocity.z * parkedSpeedForward.z,
      )

      if (
        engageParkingHold
        && Math.abs(params.throttle) <= 0.05
        && params.brake <= 0.05
        && forwardSpeed <= parkingHoldSpeedEpsilon
      ) {
        const brakeForce = params.resolveBrakeForce(params.vehicleInstance)
        holdVehicleBrakeSafe({ vehicleInstance: params.vehicleInstance, brakeForce })
        stopPhysicsBodyMotion(params.chassisBody)
        sleepPhysicsBody(params.chassisBody, { minSpeedLimit: 0.05, minTimeLimit: 0.05 })
      }

      return forwardSpeed >= parkedSpeedEpsilon ? forwardSpeed : 0
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[PurePursuitRuntime] vehicle parked-speed update failed', error)
  }

  const speed = Math.sqrt(
    params.chassisBody.velocity.x * params.chassisBody.velocity.x
    + params.chassisBody.velocity.y * params.chassisBody.velocity.y
    + params.chassisBody.velocity.z * params.chassisBody.velocity.z,
  )
  return Number.isFinite(speed) && speed >= parkedSpeedEpsilon ? speed : 0
}

export function applyPurePursuitVehicleControl(params: {
  vehicleInstance: PurePursuitVehicleInstanceLike
  points: THREE.Vector3[]
  loop: boolean
  deltaSeconds: number
  speedMps: number
  speedCapMps?: number
  resolvedForwardSpeedMps?: number | null
  pursuitProps: PurePursuitComponentProps
  vehicleProps: VehicleComponentProps
  state: PurePursuitVehicleControlState
  modeStopping: boolean
  /** Optional index to treat as the stopping/docking target (defaults to route end). */
  stopIndex?: number
}): PurePursuitVehicleControlResult {
  const {
    vehicleInstance,
    points,
    loop,
    speedMps,
    speedCapMps,
    pursuitProps,
    vehicleProps,
    state,
    modeStopping,
    stopIndex,
  } = params

  const vehicle = vehicleInstance.vehicle
  const chassisBody = vehicle.chassisBody
  const dt = getSafeDeltaSeconds(params.deltaSeconds)
  const wheelCount = Math.max(0, vehicleInstance.wheelCount)

  if (!chassisBody || wheelCount <= 0 || !points || points.length < 2) {
    return createControlFallbackResult(state)
  }

  purePursuitChassisPosition.set(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z)
  purePursuitChassisQuaternion
    .set(chassisBody.quaternion.x, chassisBody.quaternion.y, chassisBody.quaternion.z, chassisBody.quaternion.w)
    .normalize()

  forwardWorld.copy(vehicleInstance.axisForward)
  forwardWorld.applyQuaternion(purePursuitChassisQuaternion)
  forwardWorld.y = 0
  if (forwardWorld.lengthSq() < 1e-10) {
    forwardWorld.set(1, 0, 0)
  }
  forwardWorld.normalize()

  const currentPosition = purePursuitChassisPosition
  const fallbackCurrentVelocity = chassisBody.velocity
  const fallbackForwardSpeed = fallbackCurrentVelocity.x * forwardWorld.x + fallbackCurrentVelocity.y * forwardWorld.y + fallbackCurrentVelocity.z * forwardWorld.z
  const forwardSpeed = typeof params.resolvedForwardSpeedMps === 'number' && Number.isFinite(params.resolvedForwardSpeedMps)
    ? params.resolvedForwardSpeedMps
    : fallbackForwardSpeed
  const longitudinalState = getLongitudinalState(state)
  const steeringState = getSteeringState(state)
  const governorState = getGovernorState(state)

  longitudinalState.forwardSpeedMps = forwardSpeed
  longitudinalState.reverseActive = forwardSpeed < -0.12

  const speedSample = Math.max(0, Math.abs(forwardSpeed))
  const lookaheadDistance = resolvePathFollowLookaheadDistance({
    speedMps: speedSample,
    baseMeters: pursuitProps.lookaheadBaseMeters,
    speedGain: pursuitProps.lookaheadSpeedGain,
    minMeters: pursuitProps.lookaheadMinMeters,
    maxMeters: pursuitProps.lookaheadMaxMeters,
  })

  const sample = resolvePathFollowSample({
    points,
    loop,
    currentPosition,
    lookaheadDistance,
    mode: 'xz',
    outLookaheadPoint: purePursuitLookaheadPoint,
    outClosestPoint: purePursuitClosestPoint,
  })
  if (!sample) {
    return createControlFallbackResult(state)
  }

  const waypointArcLengths = buildPolylineVertexArcLengths(points, sample.polylineData)
  const targetIndex = Math.min(points.length - 1, Math.max(0, Number.isFinite(stopIndex ?? NaN) ? Math.floor(stopIndex as number) : points.length - 1))
  const stopTargetS = loop
    ? sample.projection.s
    : (() => {
      if (targetIndex >= points.length - 1) {
        return sample.polylineData.totalLength
      }
      return waypointArcLengths[targetIndex] ?? sample.polylineData.totalLength
    })()

  const remainingDistanceToEnd = loop
    ? Number.POSITIVE_INFINITY
    : Math.max(0, sample.polylineData.totalLength - sample.projection.s)
  const remainingDistanceToStop = loop
    ? Number.POSITIVE_INFINITY
    : Math.max(0, stopTargetS - sample.projection.s)

  const targetPosition = purePursuitLookaheadPoint
  const desiredDir = purePursuitTargetDelta.copy(targetPosition).sub(currentPosition)
  desiredDir.y = 0
  const targetLen = Math.sqrt(desiredDir.x * desiredDir.x + desiredDir.z * desiredDir.z)
  if (targetLen < 1e-6) {
    const closest = purePursuitClosestPoint
    desiredDir.copy(sample.projection.closestPoint ?? closest).sub(currentPosition)
    desiredDir.y = 0
  }
  const normalizedTargetLen = Math.sqrt(desiredDir.x * desiredDir.x + desiredDir.z * desiredDir.z)
  if (normalizedTargetLen < 1e-6) {
    desiredDir.copy(forwardWorld)
  } else {
    desiredDir.multiplyScalar(1 / normalizedTargetLen)
  }

  const lastSteerRad = getLastSteerRad(state)
  const wheelbaseMeters = Math.max(0.35, Number.isFinite(vehicleProps.wheelbaseMeters) ? vehicleProps.wheelbaseMeters : 0)
  const steeringRad = resolvePurePursuitSteeringRad({
    vehicleProps,
    wheelbaseMeters,
    targetLen: Math.max(1e-6, normalizedTargetLen),
    forwardWorld,
    desiredDir,
    lastSteerRad,
    deltaSeconds: dt,
  })

  const dockActive = Boolean(
    pursuitProps.dockingEnabled
    && !loop
    && remainingDistanceToEnd <= Math.max(0, pursuitProps.dockStartDistanceMeters),
  )
  const dockHoldActive = Boolean(
    !loop
    && (
      (dockActive && remainingDistanceToStop <= Math.max(0, pursuitProps.dockStopEpsilonMeters))
      || (modeStopping && remainingDistanceToStop <= Math.max(0, pursuitProps.dockStopEpsilonMeters))
    ),
  )

  const speedTarget = resolvePurePursuitLongitudinalControl({
    speedMps,
    speedCapMps,
    steeringRad,
    forwardSignedSpeed: forwardSpeed,
    speedIntegral: typeof longitudinalState.speedIntegral === 'number' ? longitudinalState.speedIntegral : 0,
    lastUseEngine: longitudinalState.longitudinalUseEngine,
    speedGovernorScale: governorState.speedGovernorScale,
    speedGovernorBrakeAssist: governorState.speedGovernorBrakeAssist,
    speedGovernorSmoothedForwardSpeedAbs: governorState.speedGovernorSmoothedForwardSpeedAbs,
    speedGovernorOverHardCap: governorState.speedGovernorOverHardCap,
    pursuitProps,
    vehicleProps,
    deltaSeconds: dt,
    modeStopping,
    distanceToEnd: dockHoldActive ? remainingDistanceToStop : remainingDistanceToEnd,
    dockActive,
    dockHoldActive,
  })

  const stopOutcome = resolvePurePursuitControlStopOutcome({
    steeringRad,
    speedTarget,
    dockHoldActive,
    modeStopping,
    loop,
    dockActive,
    remainingDistanceToEnd,
    remainingDistanceToStop,
    forwardSpeed,
    targetIndex,
    points,
    forwardWorld,
    chassisBody,
    pursuitProps,
    vehicleProps,
    dt,
  })

  longitudinalState.speedTargetMps = stopOutcome.targetSpeedMps
  longitudinalState.longitudinalErrorMps = stopOutcome.targetSpeedMps - Math.abs(forwardSpeed)
  longitudinalState.speedIntegral = speedTarget.speedIntegral
  longitudinalState.longitudinalUseEngine = speedTarget.desiredUseEngine
  longitudinalState.lastBrakeForce = stopOutcome.brakeForce
  longitudinalState.longitudinalModeSwitchAtMs = speedTarget.desiredUseEngine !== Boolean(longitudinalState.longitudinalUseEngine)
    ? Date.now()
    : longitudinalState.longitudinalModeSwitchAtMs

  governorState.speedGovernorScale = speedTarget.speedGovernorScale
  governorState.speedGovernorBrakeAssist = speedTarget.speedGovernorBrakeAssist
  governorState.speedGovernorSmoothedForwardSpeedAbs = speedTarget.speedGovernorSmoothedForwardSpeedAbs
  governorState.speedGovernorOverHardCap = speedTarget.speedGovernorOverHardCap

  steeringState.lastSteerRad = stopOutcome.steeringRad
  vehicle.autoTourTargetSpeedMps = stopOutcome.targetSpeedMps
  vehicle.autoTourTargetSteeringRad = stopOutcome.steeringRad

  return {
    reachedStop: stopOutcome.reachedStop,
    steeringRad: stopOutcome.steeringRad,
    targetSpeedMps: stopOutcome.targetSpeedMps,
    engineForce: stopOutcome.engineForce,
    brakeForce: stopOutcome.brakeForce,
    stopState: stopOutcome.stopState,
  }
}

export function applyPurePursuitVehicleControlSafe(params: {
  vehicleInstance: PurePursuitVehicleInstanceLike
  points: THREE.Vector3[]
  loop: boolean
  deltaSeconds: number
  speedMps: number
  speedCapMps?: number
  resolvedForwardSpeedMps?: number | null
  pursuitProps: PurePursuitComponentProps
  vehicleProps: VehicleComponentProps
  state: PurePursuitVehicleControlState
  modeStopping: boolean
  distanceToTarget: number
  stopIndex?: number
}): PurePursuitVehicleControlResult {
  try {
    return applyPurePursuitVehicleControl(params)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[PurePursuitRuntime] vehicle control failed', error)
    return {
      reachedStop: false,
      steeringRad: 0,
      targetSpeedMps: 0,
      engineForce: 0,
      brakeForce: 0,
      stopState: 'tracking',
    }
  }
}

export function holdVehicleBrakeSafe(params: {
  vehicleInstance: PurePursuitVehicleInstanceLike
  brakeForce: number
}): void {
  try {
    const vehicle = params.vehicleInstance.vehicle
    vehicle.autoTourTargetSpeedMps = 0
    vehicle.autoTourTargetSteeringRad = 0
    applyPhysicsVehicleWheelControl(vehicle, {
      steeringValue: 0,
      engineForce: 0,
      brakeForce: Math.max(0, params.brakeForce),
      steerableWheelIndices: params.vehicleInstance.steerableWheelIndices,
    })
    const chassisBody = vehicle.chassisBody
    stopPhysicsBodyMotion(chassisBody)
    sleepPhysicsBody(chassisBody, { minSpeedLimit: 0.05, minTimeLimit: 0.05 })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[PurePursuitRuntime] vehicle hold brake failed', error)
  }
}
