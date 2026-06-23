import * as THREE from 'three'
import type { PurePursuitComponentProps, VehicleComponentProps } from './components'
import type { VehicleDriveVehicle } from './VehicleDriveController'
import {
  resolvePathFollowLookaheadDistance,
  resolvePathFollowSample,
  samplePolylineAtS,
} from './pathFollowCommon'
import { sleepPhysicsBody, stopPhysicsBodyMotion } from './physicsRuntimeBridge'

export const VEHICLE_PARKED_SPEED_EPSILON = 0.08
export const VEHICLE_PARKING_HOLD_SPEED_EPSILON = 0.2

export type PurePursuitVehicleInstanceLike = {
  vehicle: VehicleDriveVehicle
  wheelCount: number
  steerableWheelIndices: number[]
  axisForward: THREE.Vector3
}

export type PurePursuitVehicleControlState = {
  speedIntegral?: number
  lastSteerRad?: number
  lastBrakeForce?: number
  speedTargetMps?: number
  forwardSpeedMps?: number
  longitudinalErrorMps?: number
  reverseActive?: boolean
  /** Latched longitudinal mode for engine/brake hysteresis. */
  longitudinalUseEngine?: boolean
  /** Timestamp of the last longitudinal mode switch, used to prevent immediate flip-flopping. */
  longitudinalModeSwitchAtMs?: number
}

const parkedSpeedQuaternion = new THREE.Quaternion()
const parkedSpeedForward = new THREE.Vector3()
const purePursuitChassisPosition = new THREE.Vector3()
const purePursuitChassisQuaternion = new THREE.Quaternion()
const purePursuitForward = new THREE.Vector3()
const purePursuitRight = new THREE.Vector3()
const purePursuitUp = new THREE.Vector3(0, 1, 0)
const purePursuitLookaheadPoint = new THREE.Vector3()
const purePursuitClosestPoint = new THREE.Vector3()
const purePursuitTargetDelta = new THREE.Vector3()
const purePursuitCurvePointA = new THREE.Vector3()
const purePursuitCurvePointB = new THREE.Vector3()
const purePursuitCurveDirA = new THREE.Vector3()
const purePursuitCurveDirB = new THREE.Vector3()

const PURE_PURSUIT_STOP_HOLD_BRAKE_MULTIPLIER = 6
const PURE_PURSUIT_MIN_WHEELBASE_METERS = 0.25
const PURE_PURSUIT_CRUISE_SPEED_SCALE = 0.9
const PURE_PURSUIT_CURVE_MIN_SPEED_RATIO = 0.4
const PURE_PURSUIT_TARGET_ACCEL_MPS2 = 1.8
const PURE_PURSUIT_TARGET_DECEL_MPS2 = 1.6
const PURE_PURSUIT_TARGET_STOP_DECEL_MPS2 = 0.78
const PURE_PURSUIT_TARGET_STOP_APPROACH_DISTANCE_MIN_METERS = 24
const PURE_PURSUIT_TARGET_STOP_APPROACH_SPEED_FACTOR = 12
const PURE_PURSUIT_TARGET_STOP_APPROACH_BRAKE_FACTOR = 4
const PURE_PURSUIT_TARGET_STOP_EASING_POWER = 1.35
const PURE_PURSUIT_PREVIEW_TURN_FULL_ANGLE = THREE.MathUtils.degToRad(60)

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.max(min, Math.min(max, value))
}

function getSafeDeltaSeconds(value: number): number {
  return Number.isFinite(value) ? clampNumber(value, 0, 0.25) : 1 / 60
}

function getPlanarDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

function smoothStep01(value: number): number {
  const t = clampNumber(value, 0, 1)
  return t * t * (3 - 2 * t)
}

function moveToward(current: number, target: number, maxDelta: number): number {
  if (!Number.isFinite(current)) {
    return target
  }
  if (!Number.isFinite(target)) {
    return current
  }
  const delta = target - current
  if (Math.abs(delta) <= maxDelta) {
    return target
  }
  return current + Math.sign(delta) * Math.max(0, maxDelta)
}

function samplePlanarDirectionBetween(
  points: readonly THREE.Vector3[],
  sample: NonNullable<ReturnType<typeof resolvePathFollowSample>>,
  fromS: number,
  toS: number,
  outDirection: THREE.Vector3,
): boolean {
  samplePolylineAtS(points, sample.polylineData, fromS, purePursuitCurvePointA)
  samplePolylineAtS(points, sample.polylineData, toS, purePursuitCurvePointB)
  outDirection.copy(purePursuitCurvePointB).sub(purePursuitCurvePointA)
  outDirection.y = 0
  const lengthSq = outDirection.lengthSq()
  if (lengthSq <= 1e-8) {
    outDirection.set(0, 0, 0)
    return false
  }
  outDirection.multiplyScalar(1 / Math.sqrt(lengthSq))
  return true
}

function resolvePreviewTurnSeverity(
  points: readonly THREE.Vector3[],
  sample: NonNullable<ReturnType<typeof resolvePathFollowSample>>,
  lookaheadDistance: number,
): number {
  if (!sample) {
    return 0
  }
  const previewNear = Math.max(2.8, lookaheadDistance * 1.2)
  const previewFar = Math.max(previewNear + 4.5, lookaheadDistance * 3.6)
  const currentS = sample.projection.s
  const okA = samplePlanarDirectionBetween(
    points,
    sample,
    currentS,
    currentS + previewNear,
    purePursuitCurveDirA,
  )
  const okB = samplePlanarDirectionBetween(
    points,
    sample,
    currentS + previewNear,
    currentS + previewFar,
    purePursuitCurveDirB,
  )
  if (!okA || !okB) {
    return 0
  }

  const angle = Math.acos(THREE.MathUtils.clamp(purePursuitCurveDirA.dot(purePursuitCurveDirB), -1, 1))
  return smoothStep01(angle / PURE_PURSUIT_PREVIEW_TURN_FULL_ANGLE)
}

function resolveRouteVertexS(points: readonly THREE.Vector3[], index: number, loop: boolean): number {
  if (!points.length) {
    return 0
  }
  const maxIndex = points.length - 1
  const targetIndex = loop
    ? ((Math.floor(index) % points.length) + points.length) % points.length
    : clampNumber(Math.floor(index), 0, maxIndex)

  let s = 0
  for (let i = 0; i < targetIndex; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    if (!a || !b) {
      continue
    }
    const dx = b.x - a.x
    const dz = b.z - a.z
    const length = Math.sqrt(dx * dx + dz * dz)
    if (Number.isFinite(length)) {
      s += length
    }
  }
  return s
}

export type PurePursuitVehicleControlResult = {
  reachedStop: boolean
  steeringRad: number
  targetSpeedMps: number
}

export function updateVehicleSpeedAndApplyParkingHoldSafe(params: {
  vehicleInstance: PurePursuitVehicleInstanceLike
  chassisBody: VehicleDriveVehicle['chassisBody']
  throttle: number
  brake: number
  parkedSpeedEpsilon?: number
  parkingHoldSpeedEpsilon?: number
  engageParkingHold?: boolean
  resolveBrakeForce: (vehicleInstance: PurePursuitVehicleInstanceLike) => number
}): number {
  const parkedSpeedEpsilon = params.parkedSpeedEpsilon ?? VEHICLE_PARKED_SPEED_EPSILON
  const parkingHoldSpeedEpsilon = params.parkingHoldSpeedEpsilon ?? VEHICLE_PARKING_HOLD_SPEED_EPSILON
  const engageParkingHold = params.engageParkingHold ?? true

  try {
    parkedSpeedQuaternion.set(
      params.chassisBody.quaternion.x,
      params.chassisBody.quaternion.y,
      params.chassisBody.quaternion.z,
      params.chassisBody.quaternion.w,
    )
    parkedSpeedForward.copy(params.vehicleInstance.axisForward).applyQuaternion(parkedSpeedQuaternion)
    const forwardLengthSq =
      parkedSpeedForward.x * parkedSpeedForward.x
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
    pursuitProps,
    vehicleProps,
    state,
    modeStopping,
  } = params
  const vehicle = vehicleInstance.vehicle
  const chassisBody = vehicle.chassisBody
  const dt = getSafeDeltaSeconds(params.deltaSeconds)
  const wheelCount = Math.max(0, vehicleInstance.wheelCount)
  if (!chassisBody || wheelCount <= 0 || !points || points.length < 2) {
    return {
      reachedStop: false,
      steeringRad: Number.isFinite(state.lastSteerRad) ? state.lastSteerRad! : 0,
      targetSpeedMps: 0,
    }
  }

  purePursuitChassisPosition.set(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z)
  purePursuitChassisQuaternion
    .set(
      chassisBody.quaternion.x,
      chassisBody.quaternion.y,
      chassisBody.quaternion.z,
      chassisBody.quaternion.w,
    )
    .normalize()

  purePursuitForward.copy(vehicleInstance.axisForward)
  if (purePursuitForward.lengthSq() <= 1e-8) {
    purePursuitForward.set(0, 0, 1)
  }
  purePursuitForward.normalize().applyQuaternion(purePursuitChassisQuaternion)
  purePursuitForward.y = 0
  if (purePursuitForward.lengthSq() <= 1e-8) {
    purePursuitForward.set(0, 0, 1)
  } else {
    purePursuitForward.normalize()
  }
  purePursuitRight.crossVectors(purePursuitUp, purePursuitForward)
  if (purePursuitRight.lengthSq() <= 1e-8) {
    purePursuitRight.set(1, 0, 0)
  } else {
    purePursuitRight.normalize()
  }

  const velocity = chassisBody.velocity
  const forwardSpeedMps =
    velocity.x * purePursuitForward.x
    + velocity.y * purePursuitForward.y
    + velocity.z * purePursuitForward.z
  const absoluteForwardSpeedMps = Math.abs(Number.isFinite(forwardSpeedMps) ? forwardSpeedMps : 0)
  state.forwardSpeedMps = forwardSpeedMps
  state.reverseActive = false

  const lookaheadDistance = resolvePathFollowLookaheadDistance({
    speedMps: Math.max(absoluteForwardSpeedMps, Math.max(0, Number.isFinite(speedMps) ? speedMps : 0)),
    baseMeters: pursuitProps.lookaheadBaseMeters,
    speedGain: pursuitProps.lookaheadSpeedGain,
    minMeters: pursuitProps.lookaheadMinMeters,
    maxMeters: pursuitProps.lookaheadMaxMeters,
  })
  const sample = resolvePathFollowSample({
    points,
    loop,
    currentPosition: purePursuitChassisPosition,
    lookaheadDistance,
    mode: 'xz',
    outLookaheadPoint: purePursuitLookaheadPoint,
    outClosestPoint: purePursuitClosestPoint,
  })
  if (!sample || sample.polylineData.totalLength <= 1e-6) {
    const holdBrakeForce = vehicleProps.brakeForceMax * PURE_PURSUIT_STOP_HOLD_BRAKE_MULTIPLIER
    holdVehicleBrakeSafe({ vehicleInstance, brakeForce: holdBrakeForce })
    return {
      reachedStop: false,
      steeringRad: Number.isFinite(state.lastSteerRad) ? state.lastSteerRad! : 0,
      targetSpeedMps: 0,
    }
  }

  let distanceToStop = Number.POSITIVE_INFINITY
  let directDistanceToStop = Number.POSITIVE_INFINITY
  if (modeStopping) {
    const stopIndex = typeof params.stopIndex === 'number' && Number.isFinite(params.stopIndex)
      ? Math.floor(params.stopIndex)
      : points.length - 1
    const normalizedStopIndex = loop
      ? ((stopIndex % points.length) + points.length) % points.length
      : clampNumber(stopIndex, 0, points.length - 1)
    const stopPoint = points[normalizedStopIndex] ?? points[points.length - 1]!
    const stopS = resolveRouteVertexS(points, normalizedStopIndex, loop)
    let adjustedStopS = stopS
    if (loop && adjustedStopS < sample.projection.s) {
      adjustedStopS += sample.polylineData.totalLength
    }
    distanceToStop = Math.max(0, adjustedStopS - sample.projection.s)
    directDistanceToStop = getPlanarDistance(purePursuitChassisPosition, stopPoint)
    const clampedLookaheadS = Math.min(sample.projection.s + sample.lookaheadDistance, adjustedStopS)
    samplePolylineAtS(points, sample.polylineData, clampedLookaheadS, purePursuitLookaheadPoint)

    if (
      directDistanceToStop <= pursuitProps.dockStopEpsilonMeters
      && absoluteForwardSpeedMps <= pursuitProps.dockStopSpeedEpsilonMps
    ) {
      const holdBrakeForce = vehicleProps.brakeForceMax * PURE_PURSUIT_STOP_HOLD_BRAKE_MULTIPLIER
      holdVehicleBrakeSafe({ vehicleInstance, brakeForce: holdBrakeForce })
      stopPhysicsBodyMotion(chassisBody)
      sleepPhysicsBody(chassisBody, { minSpeedLimit: 0.05, minTimeLimit: 0.05 })
      state.speedIntegral = 0
      state.speedTargetMps = 0
      state.longitudinalErrorMps = 0
      state.lastSteerRad = 0
      state.lastBrakeForce = holdBrakeForce
      state.longitudinalUseEngine = false
      return {
        reachedStop: true,
        steeringRad: 0,
        targetSpeedMps: 0,
      }
    }
  }

  purePursuitTargetDelta.copy(purePursuitLookaheadPoint).sub(purePursuitChassisPosition)
  purePursuitTargetDelta.y = 0
  const targetDistanceSq = Math.max(1e-6, purePursuitTargetDelta.lengthSq())
  const lateralError = purePursuitTargetDelta.dot(purePursuitRight)
  const curvature = clampNumber((2 * lateralError) / targetDistanceSq, -10, 10)
  const wheelbase = Math.max(PURE_PURSUIT_MIN_WHEELBASE_METERS, vehicleProps.wheelbaseMeters || 0)
  const maxSteerRad = THREE.MathUtils.degToRad(Math.max(0, vehicleProps.maxSteerDegrees))
  const rawSteerRad = clampNumber(Math.atan(wheelbase * curvature), -maxSteerRad, maxSteerRad)
  const lastSteerRad = Number.isFinite(state.lastSteerRad) ? state.lastSteerRad! : 0
  const maxSteerStep = THREE.MathUtils.degToRad(Math.max(0, vehicleProps.maxSteerRateDegPerSec)) * dt
  const steeringRad = maxSteerStep > 0
    ? lastSteerRad + clampNumber(rawSteerRad - lastSteerRad, -maxSteerStep, maxSteerStep)
    : rawSteerRad
  state.lastSteerRad = steeringRad

  const vehicleSpeedCap = vehicleProps.maxSpeedKmh > 0
    ? vehicleProps.maxSpeedKmh / 3.6
    : Number.POSITIVE_INFINITY
  const pursuitSpeedCap = pursuitProps.maxSpeedMps > 0
    ? pursuitProps.maxSpeedMps
    : Number.POSITIVE_INFINITY
  const requestedSpeed = Math.max(0, Number.isFinite(speedMps) ? speedMps : 0)
  const baseTargetSpeed = Math.max(
    0,
    Math.min(requestedSpeed * PURE_PURSUIT_CRUISE_SPEED_SCALE, vehicleSpeedCap, pursuitSpeedCap),
  )
  const steerSeverity = maxSteerRad > 1e-6 ? Math.abs(steeringRad) / maxSteerRad : 0
  const curvatureSeverity = smoothStep01(
    Math.abs(curvature)
      * Math.max(PURE_PURSUIT_MIN_WHEELBASE_METERS, wheelbase)
      * Math.max(0.4, pursuitProps.curvatureSpeedFactor),
  )
  const previewTurnSeverity = resolvePreviewTurnSeverity(points, sample, lookaheadDistance)
  const turnSeverity = Math.max(steerSeverity, curvatureSeverity, previewTurnSeverity)
  const curveMinRatio = clampNumber(PURE_PURSUIT_CURVE_MIN_SPEED_RATIO, 0.05, 1)
  const curveSpeedRatio = THREE.MathUtils.lerp(1, curveMinRatio, smoothStep01(turnSeverity))
  const turnSpeedCap = baseTargetSpeed * THREE.MathUtils.lerp(1, 0.12, smoothStep01(Math.max(turnSeverity, previewTurnSeverity)))
  let rawTargetSpeedMps = Math.min(baseTargetSpeed * curveSpeedRatio, turnSpeedCap)
  if (!modeStopping && baseTargetSpeed > 0) {
    const minimumCruiseFloor = Math.max(0.18, Math.min(pursuitProps.minSpeedMps, baseTargetSpeed * 0.35))
    rawTargetSpeedMps = Math.max(minimumCruiseFloor, rawTargetSpeedMps)
  }

  if (modeStopping) {
    const brakeDistance = Math.max(
      0,
      pursuitProps.brakeDistanceMinMeters + absoluteForwardSpeedMps * Math.max(0, pursuitProps.brakeDistanceSpeedFactor),
    )
    const stopDistance = Math.min(distanceToStop, directDistanceToStop)
    if (Number.isFinite(stopDistance) && brakeDistance > 1e-6) {
      const stopApproachDistance = Math.max(
        PURE_PURSUIT_TARGET_STOP_APPROACH_DISTANCE_MIN_METERS,
        brakeDistance * PURE_PURSUIT_TARGET_STOP_APPROACH_BRAKE_FACTOR,
        absoluteForwardSpeedMps * PURE_PURSUIT_TARGET_STOP_APPROACH_SPEED_FACTOR,
        pursuitProps.dockStartDistanceMeters * 2,
      )
      const stopProgress = smoothStep01(stopDistance / Math.max(1e-6, stopApproachDistance))
      rawTargetSpeedMps *= Math.pow(stopProgress, PURE_PURSUIT_TARGET_STOP_EASING_POWER)
      rawTargetSpeedMps = Math.min(
        rawTargetSpeedMps,
        Math.sqrt(Math.max(0, 2 * PURE_PURSUIT_TARGET_STOP_DECEL_MPS2 * stopDistance)),
      )
    }
    if (
      pursuitProps.dockingEnabled
      && Number.isFinite(stopDistance)
      && stopDistance <= pursuitProps.dockStartDistanceMeters
    ) {
      const dockProgress = smoothStep01(stopDistance / Math.max(1e-6, pursuitProps.dockStartDistanceMeters))
      const dockLimit = THREE.MathUtils.lerp(
        Math.max(0, pursuitProps.dockStopSpeedEpsilonMps),
        Math.max(0, pursuitProps.dockMaxSpeedMps),
        dockProgress,
      )
      rawTargetSpeedMps = Math.min(rawTargetSpeedMps, dockLimit)
    }
    if (Number.isFinite(stopDistance) && stopDistance <= pursuitProps.dockStopEpsilonMeters) {
      rawTargetSpeedMps = 0
    }
  }
  rawTargetSpeedMps = Number.isFinite(rawTargetSpeedMps) ? Math.max(0, rawTargetSpeedMps) : 0

  const previousTargetSpeed = Number.isFinite(state.speedTargetMps)
    ? Math.max(0, state.speedTargetMps!)
    : Math.min(rawTargetSpeedMps, absoluteForwardSpeedMps)
  const isSlowing = rawTargetSpeedMps < previousTargetSpeed
  const targetRate = isSlowing
    ? (modeStopping ? PURE_PURSUIT_TARGET_STOP_DECEL_MPS2 : PURE_PURSUIT_TARGET_DECEL_MPS2)
    : PURE_PURSUIT_TARGET_ACCEL_MPS2
  const targetSpeedMps = moveToward(previousTargetSpeed, rawTargetSpeedMps, targetRate * dt)
  state.speedTargetMps = targetSpeedMps

  const currentForwardSpeedMps = Math.max(0, forwardSpeedMps)


  const speedError = targetSpeedMps - currentForwardSpeedMps
  state.longitudinalErrorMps = speedError
  state.speedIntegral = 0
  state.longitudinalUseEngine = true
  state.longitudinalModeSwitchAtMs = undefined
  state.lastBrakeForce = 0

  return {
    reachedStop: false,
    steeringRad,
    targetSpeedMps,
  }
}

export function applyPurePursuitVehicleControlSafe(params: {
  vehicleInstance: PurePursuitVehicleInstanceLike
  points: THREE.Vector3[]
  loop: boolean
  deltaSeconds: number
  speedMps: number
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
    }
  }
}

export function holdVehicleBrakeSafe(params: {
  vehicleInstance: PurePursuitVehicleInstanceLike
  brakeForce: number
}): void {
  const { vehicleInstance } = params
  try {
    const vehicle = vehicleInstance.vehicle
    vehicle.autoTourTargetSpeedMps = 0
    vehicle.autoTourTargetSteeringRad = 0
    const chassisBody = vehicleInstance.vehicle.chassisBody
    stopPhysicsBodyMotion(chassisBody)
    sleepPhysicsBody(chassisBody, { minSpeedLimit: 0.05, minTimeLimit: 0.05 })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[PurePursuitRuntime] vehicle hold brake failed', error)
  }
}
