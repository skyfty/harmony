import * as THREE from 'three'
import type { PurePursuitComponentProps, VehicleComponentProps } from './components'
import type { VehicleDriveVehicle } from './VehicleDriveController'
import type { PolylineMetricData } from './polylineProgress'
import { resolvePathFollowLookaheadDistance, resolvePathFollowPlanarArrivalDistance, resolvePathFollowSample, samplePolylineAtS } from './pathFollowCommon'
import { buildPolylineVertexArcLengths } from './polylineProgress'
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
  speedTargetMps?: number
  forwardSpeedMps?: number
  longitudinalErrorMps?: number
  reverseActive?: boolean

  /** Latched longitudinal mode for engine/brake hysteresis. */
  longitudinalUseEngine?: boolean
  /** Timestamp of the last longitudinal mode switch, used to prevent immediate flip-flopping. */
  longitudinalModeSwitchAtMs?: number
}

const DEFAULT_MAX_STEER_RADIANS = THREE.MathUtils.degToRad(26)

const upAxis = new THREE.Vector3(0, 1, 0)

const chassisQuat = new THREE.Quaternion()
const forwardWorld = new THREE.Vector3()
const lookaheadPoint = new THREE.Vector3()
const rearAxle = new THREE.Vector3()
const toLookahead = new THREE.Vector3()
const desiredDir = new THREE.Vector3()
const cross = new THREE.Vector3()
const planarVelocity = new THREE.Vector3()
const yawTargetQuat = new THREE.Quaternion()
const objectWorldQuat = new THREE.Quaternion()
const currentPositionThree = new THREE.Vector3()
const parkedSpeedQuaternion = new THREE.Quaternion()
const parkedSpeedForward = new THREE.Vector3()
const pathPreviewPoint = new THREE.Vector3()
const pathPreviewFarPoint = new THREE.Vector3()
const pathPreviewDirection = new THREE.Vector3()
const pathCurvePointA = new THREE.Vector3()
const pathCurvePointB = new THREE.Vector3()
const pathCurvePointD = new THREE.Vector3()
const pathCurveDirA = new THREE.Vector3()
const pathCurveDirB = new THREE.Vector3()
const pathCurveDirC = new THREE.Vector3()

// Longitudinal control tuning (runtime-local, intentionally conservative defaults).
// These values are designed to remove "engine/brake" chattering near zero error without affecting normal driving.
const PP_INTEGRAL_LEAK_THRESHOLD_MPS = 0.10
const PP_INTEGRAL_LEAK_RATE_PER_SEC = 1.6
const PP_INTEGRAL_SIGN_MISMATCH_LEAK_RATE_PER_SEC = 5.0
const PP_FORWARD_SPEED_FILTER_RATE_PER_SEC = 10
const PP_LONGITUDINAL_COAST_BAND_MPS = 0.18
const PP_LONGITUDINAL_ERROR_FILTER_RATE_PER_SEC = 6.5
const PP_LONGITUDINAL_ENGINE_ON_THRESHOLD_MPS = 0.30
const PP_LONGITUDINAL_BRAKE_ON_THRESHOLD_MPS = 0.34
const PP_LONGITUDINAL_ENGINE_HOLD_MS = 180
const PP_LONGITUDINAL_BRAKE_HOLD_MS = 320
const PP_ENGINE_FORCE_OUTPUT_SCALE = 0.55
const PP_BRAKE_FORCE_OUTPUT_SCALE = 0.30
const PP_FORWARD_SPEED_CLAMP_MPS = 30
const AUTO_TOUR_CRUISE_SPEED_SCALE = 0.8
const AUTO_TOUR_SPEED_TARGET_RISE_RATE = 2.4
const AUTO_TOUR_SPEED_TARGET_FALL_RATE = 10.0
const AUTO_TOUR_PREVIEW_DISTANCE_MIN_METERS = 6
const AUTO_TOUR_PREVIEW_DISTANCE_MAX_METERS = 20
const AUTO_TOUR_PREVIEW_DISTANCE_SCALE = 2.6
const AUTO_TOUR_PREVIEW_FULL_SLOW_ANGLE = THREE.MathUtils.degToRad(52)
const AUTO_TOUR_HEADING_FULL_SLOW_ANGLE = THREE.MathUtils.degToRad(64)
const AUTO_TOUR_TURN_MIN_SPEED_RATIO = 0.12

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(1, value))
}

function smoothStep01(value: number): number {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

function formatDebugNumber(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : 'NaN'
}

function angleBetweenPlanarDirections(a: THREE.Vector3, b: THREE.Vector3): number {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1)
  return Math.acos(dot)
}

function samplePlanarDirectionAtS(
  points: readonly THREE.Vector3[],
  polylineData: PolylineMetricData,
  s0: number,
  s1: number,
  outDirection: THREE.Vector3,
): number {
  samplePolylineAtS(points, polylineData, s0, pathCurvePointA)
  samplePolylineAtS(points, polylineData, s1, pathCurvePointB)
  outDirection.copy(pathCurvePointB).sub(pathCurvePointA)
  outDirection.y = 0
  const length = outDirection.length()
  if (length > 1e-6) {
    outDirection.multiplyScalar(1 / length)
    return length
  }
  outDirection.set(0, 0, 0)
  return 0
}

function setCannonQuaternionFromThree(target: any, q: THREE.Quaternion): void {
  if (!target) {
    return
  }
  target.x = q.x
  target.y = q.y
  target.z = q.z
  target.w = q.w
}

export function updateVehicleSpeedAndApplyParkingHoldSafe(params: {
  vehicleInstance: PurePursuitVehicleInstanceLike
  chassisBody: VehicleDriveVehicle['chassisBody']
  throttle: number
  brake: number
  parkedSpeedEpsilon?: number
  parkingHoldSpeedEpsilon?: number
  resolveBrakeForce: (vehicleInstance: PurePursuitVehicleInstanceLike) => number
}): number {
  const parkedSpeedEpsilon = params.parkedSpeedEpsilon ?? VEHICLE_PARKED_SPEED_EPSILON
  const parkingHoldSpeedEpsilon = params.parkingHoldSpeedEpsilon ?? VEHICLE_PARKING_HOLD_SPEED_EPSILON

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
        Math.abs(params.throttle) <= 0.05
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
}): { reachedStop: boolean } {
  const {
    vehicleInstance,
    points,
    loop,
    deltaSeconds,
    speedMps,
    pursuitProps,
    vehicleProps,
    state,
    modeStopping,
    stopIndex,
  } = params

  const instance = vehicleInstance
  const vehicle = instance.vehicle
  const chassisBody = vehicle.chassisBody

  const currentPosition = chassisBody.position
  const currentY = currentPosition.y

  const maxSteerRad = THREE.MathUtils.degToRad(
    Number.isFinite(vehicleProps.maxSteerDegrees)
      ? vehicleProps.maxSteerDegrees
      : THREE.MathUtils.radToDeg(DEFAULT_MAX_STEER_RADIANS),
  )
  const maxSteerRateRadPerSec = THREE.MathUtils.degToRad(
    Number.isFinite(vehicleProps.maxSteerRateDegPerSec) ? vehicleProps.maxSteerRateDegPerSec : 140,
  )
  const maxSteerStep = Math.max(0, maxSteerRateRadPerSec) * deltaSeconds

  chassisQuat
    .set(chassisBody.quaternion.x, chassisBody.quaternion.y, chassisBody.quaternion.z, chassisBody.quaternion.w)
    .normalize()

  forwardWorld.copy(instance.axisForward)
  forwardWorld.applyQuaternion(chassisQuat)
  forwardWorld.y = 0
  if (forwardWorld.lengthSq() < 1e-10) {
    forwardWorld.set(1, 0, 0)
  }
  forwardWorld.normalize()

  currentPositionThree.set(currentPosition.x, currentPosition.y, currentPosition.z)
  const lookaheadDistance = resolvePathFollowLookaheadDistance({
    speedMps,
    baseMeters: pursuitProps.lookaheadBaseMeters,
    speedGain: pursuitProps.lookaheadSpeedGain,
    minMeters: pursuitProps.lookaheadMinMeters,
    maxMeters: pursuitProps.lookaheadMaxMeters,
  })
  const pathSample = resolvePathFollowSample({
    points,
    loop,
    currentPosition: currentPositionThree,
    lookaheadDistance,
    outLookaheadPoint: lookaheadPoint,
  })
  if (!pathSample) {
    return { reachedStop: false }
  }

  const endIndex = points.length - 1
  const rawStopIndex = typeof stopIndex === 'number' && Number.isFinite(stopIndex) ? Math.floor(stopIndex) : endIndex
  const clampedStopIndex = Math.max(0, Math.min(endIndex, rawStopIndex))
  const stopPoint = points[clampedStopIndex]!
  const waypointArcLengths = buildPolylineVertexArcLengths(points, pathSample.polylineData)
  const stopArcLength = waypointArcLengths[clampedStopIndex] ?? pathSample.polylineData.totalLength
  const routeDistanceToEnd = Math.max(0, stopArcLength - pathSample.projection.s)
  const previewDistance = Math.max(
    AUTO_TOUR_PREVIEW_DISTANCE_MIN_METERS,
    Math.min(
      AUTO_TOUR_PREVIEW_DISTANCE_MAX_METERS,
      Math.max(lookaheadDistance * AUTO_TOUR_PREVIEW_DISTANCE_SCALE, lookaheadDistance + 2),
    ),
  )
  const brakeThreshold = resolvePathFollowPlanarArrivalDistance(
    speedMps,
    pursuitProps.brakeDistanceMinMeters,
    Math.max(pursuitProps.brakeDistanceMinMeters, pursuitProps.dockStartDistanceMeters),
    pursuitProps.brakeDistanceSpeedFactor,
  )
  const stopEnvelopeDistance = Math.max(
    pursuitProps.dockStartDistanceMeters,
    brakeThreshold,
    speedMps * Math.max(1, pursuitProps.dockVelocityKp),
    previewDistance * 0.85,
  )
  const dockActive = modeStopping && pursuitProps.dockingEnabled && routeDistanceToEnd <= stopEnvelopeDistance
  const dockProgress = modeStopping && pursuitProps.dockingEnabled
    ? smoothStep01(1 - routeDistanceToEnd / Math.max(1e-6, stopEnvelopeDistance))
    : 0
  const terminalTaperDistance = modeStopping && pursuitProps.dockingEnabled
    ? Math.max(
        pursuitProps.dockStartDistanceMeters,
        brakeThreshold,
        Math.min(stopEnvelopeDistance, speedMps * Math.max(0.75, pursuitProps.dockVelocityKp * 0.22)),
      )
    : stopEnvelopeDistance
  const terminalProgress = modeStopping && pursuitProps.dockingEnabled
    ? smoothStep01(1 - routeDistanceToEnd / Math.max(1e-6, terminalTaperDistance))
    : 0

  const wheelbaseMeters = Math.max(0.01, vehicleProps.wheelbaseMeters)
  rearAxle.set(currentPosition.x, currentY, currentPosition.z)
  rearAxle.addScaledVector(forwardWorld, -wheelbaseMeters * 0.5)

  toLookahead.copy(lookaheadPoint).sub(rearAxle)
  toLookahead.y = 0
  const toTargetLen = toLookahead.length()
  if (!Number.isFinite(toTargetLen) || toTargetLen < 1e-6) {
    return { reachedStop: false }
  }

  desiredDir.copy(toLookahead).normalize()

  // For auto-tour behavior we prefer stability near the endpoint.
  // Disallow reversing entirely to avoid forward/backward oscillation when the lookahead point ends up behind the vehicle.
  state.reverseActive = false

  const crossY = cross.copy(forwardWorld).cross(desiredDir).dot(upAxis)
  const dot = THREE.MathUtils.clamp(forwardWorld.dot(desiredDir), -1, 1)
  const alpha = (crossY >= 0 ? 1 : -1) * Math.acos(dot)

  const safeMaxSteer = Number.isFinite(maxSteerRad) && maxSteerRad > 1e-6 ? maxSteerRad : DEFAULT_MAX_STEER_RADIANS
  let steering = Math.atan2(2 * wheelbaseMeters * Math.sin(alpha), Math.max(1e-6, toTargetLen))
  steering = THREE.MathUtils.clamp(steering, -safeMaxSteer, safeMaxSteer)

  const lastSteer = typeof state.lastSteerRad === 'number' ? state.lastSteerRad : 0
  steering = THREE.MathUtils.clamp(steering, lastSteer - maxSteerStep, lastSteer + maxSteerStep)
  state.lastSteerRad = steering

  const componentMaxSpeed = Number.isFinite(pursuitProps.maxSpeedMps) ? pursuitProps.maxSpeedMps : Number.POSITIVE_INFINITY
  const cruiseSpeed = Math.max(0, Math.min(speedMps * AUTO_TOUR_CRUISE_SPEED_SCALE, componentMaxSpeed))
  samplePolylineAtS(points, pathSample.polylineData, pathSample.projection.s + previewDistance, pathPreviewPoint)
  samplePolylineAtS(points, pathSample.polylineData, pathSample.projection.s + previewDistance + Math.max(1, previewDistance * 0.35), pathPreviewFarPoint)
  pathPreviewDirection.copy(pathPreviewFarPoint).sub(pathPreviewPoint)
  pathPreviewDirection.y = 0
  const previewLength = pathPreviewDirection.length()
  if (previewLength > 1e-6) {
    pathPreviewDirection.multiplyScalar(1 / previewLength)
  }

  const curveProbeDistance = Math.max(previewDistance * 0.7, lookaheadDistance + 3)
  const curveProbeNear = Math.max(2, curveProbeDistance * 0.45)
  const curveProbeMid = Math.max(curveProbeNear + 1, curveProbeDistance * 0.95)
  const curveProbeFar = Math.max(curveProbeMid + 1, curveProbeDistance * 1.55)
  const curveProbeExtra = Math.max(1.5, curveProbeDistance * 0.45)
  samplePlanarDirectionAtS(points, pathSample.polylineData, pathSample.projection.s + curveProbeNear, pathSample.projection.s + curveProbeMid, pathCurveDirA)
  samplePlanarDirectionAtS(points, pathSample.polylineData, pathSample.projection.s + curveProbeMid, pathSample.projection.s + curveProbeFar, pathCurveDirB)
  samplePlanarDirectionAtS(points, pathSample.polylineData, pathSample.projection.s + curveProbeFar, pathSample.projection.s + curveProbeFar + curveProbeExtra, pathCurveDirC)
  samplePlanarDirectionAtS(points, pathSample.polylineData, pathSample.projection.s + curveProbeFar + curveProbeExtra, pathSample.projection.s + curveProbeFar + curveProbeExtra * 2, pathCurvePointD)

  const headingErrorRad = Math.acos(THREE.MathUtils.clamp(forwardWorld.dot(desiredDir), -1, 1))
  const previewTurnAngleRad = previewLength > 1e-6
    ? Math.acos(THREE.MathUtils.clamp(desiredDir.dot(pathPreviewDirection), -1, 1))
    : 0
  const curveTurnAngleRad = Math.max(
    angleBetweenPlanarDirections(pathCurveDirA, pathCurveDirB),
    angleBetweenPlanarDirections(pathCurveDirB, pathCurveDirC),
    angleBetweenPlanarDirections(pathCurveDirC, pathCurvePointD),
  )
  const headingTurnSeverity = THREE.MathUtils.clamp(headingErrorRad / AUTO_TOUR_HEADING_FULL_SLOW_ANGLE, 0, 1)
  const previewTurnSeverity = THREE.MathUtils.clamp(previewTurnAngleRad / AUTO_TOUR_PREVIEW_FULL_SLOW_ANGLE, 0, 1)
  const curveTurnSeverity = THREE.MathUtils.clamp(curveTurnAngleRad / THREE.MathUtils.degToRad(50), 0, 1)
  const steerSeverity = safeMaxSteer > 1e-6 ? Math.abs(steering) / safeMaxSteer : 0
  const turnSeverity = Math.max(headingTurnSeverity, previewTurnSeverity, curveTurnSeverity, steerSeverity)
  const minSpeedRatio = Math.min(
    1,
    Math.max(
      AUTO_TOUR_TURN_MIN_SPEED_RATIO,
      cruiseSpeed > 1e-6 ? pursuitProps.minSpeedMps / cruiseSpeed : AUTO_TOUR_TURN_MIN_SPEED_RATIO,
    ),
  )
  const curvatureFactor = Math.max(0, pursuitProps.curvatureSpeedFactor)
  const curveIntensity = THREE.MathUtils.clamp(
    (turnSeverity * 0.35 + curveTurnSeverity * 0.65) * (1 + curvatureFactor * 0.25),
    0,
    1,
  )
  const curveFloorRatio = Math.min(
    0.9,
    Math.max(
      minSpeedRatio,
      modeStopping ? THREE.MathUtils.lerp(0.10, 0.30, 1 - terminalProgress) : 0.45,
    ),
  )
  const curveDamping = Math.max(
    curveFloorRatio,
    curveFloorRatio + (1 - curveFloorRatio) * Math.pow(1 - curveIntensity, 1.55),
  )
  let rawSpeedTarget = Math.max(
    pursuitProps.minSpeedMps,
    cruiseSpeed * curveDamping,
  )

  if (modeStopping) {
    const terminalSpeedRatio = THREE.MathUtils.lerp(
      Math.max(0.04, minSpeedRatio * 0.35),
      0.035,
      terminalProgress,
    )
    const terminalMaxSpeed = Math.max(
      pursuitProps.dockStopSpeedEpsilonMps,
      cruiseSpeed * terminalSpeedRatio,
    )
    const terminalSpeedTarget = THREE.MathUtils.lerp(
      Math.max(pursuitProps.minSpeedMps, pursuitProps.dockStopSpeedEpsilonMps),
      Math.min(pursuitProps.dockMaxSpeedMps, cruiseSpeed, rawSpeedTarget),
      1 - terminalProgress,
    )
    const dockSpeedTarget = THREE.MathUtils.lerp(
      Math.max(pursuitProps.minSpeedMps, pursuitProps.dockStopSpeedEpsilonMps),
      Math.min(pursuitProps.dockMaxSpeedMps, cruiseSpeed, rawSpeedTarget),
      Math.pow(1 - dockProgress, 1.45),
    )
    rawSpeedTarget = Math.min(rawSpeedTarget, dockSpeedTarget, terminalSpeedTarget, terminalMaxSpeed)
  }

  const previousSpeedTarget = typeof state.speedTargetMps === 'number' ? Math.max(0, state.speedTargetMps) : rawSpeedTarget
  const dynamicSpeedTargetFallRate = modeStopping
    ? AUTO_TOUR_SPEED_TARGET_FALL_RATE + terminalProgress * 24
    : AUTO_TOUR_SPEED_TARGET_FALL_RATE
  const speedTargetAlpha = 1 - Math.exp(-Math.max(0, rawSpeedTarget < previousSpeedTarget ? dynamicSpeedTargetFallRate : AUTO_TOUR_SPEED_TARGET_RISE_RATE) * Math.max(0, deltaSeconds))
  const speedTarget = previousSpeedTarget + (rawSpeedTarget - previousSpeedTarget) * speedTargetAlpha
  state.speedTargetMps = speedTarget

  const desiredSpeedSigned = speedTarget
  try {
    ;(vehicle as any).__harmonyDesiredSpeedMps = desiredSpeedSigned
  } catch {
    // best-effort telemetry for bridge sync
  }

  planarVelocity.set(chassisBody.velocity.x, 0, chassisBody.velocity.z)
  const forwardSpeedRaw = planarVelocity.dot(forwardWorld)
  const forwardSpeedClamped = THREE.MathUtils.clamp(forwardSpeedRaw, -PP_FORWARD_SPEED_CLAMP_MPS, PP_FORWARD_SPEED_CLAMP_MPS)
  const previousForwardSpeed = typeof state.forwardSpeedMps === 'number' ? state.forwardSpeedMps : forwardSpeedClamped
  const forwardSpeedAlpha = 1 - Math.exp(-Math.max(0, PP_FORWARD_SPEED_FILTER_RATE_PER_SEC) * Math.max(0, deltaSeconds))
  const forwardSpeed = previousForwardSpeed + (forwardSpeedClamped - previousForwardSpeed) * forwardSpeedAlpha
  state.forwardSpeedMps = forwardSpeed
  const speedError = desiredSpeedSigned - forwardSpeed
  const previousLongitudinalError = typeof state.longitudinalErrorMps === 'number'
    ? state.longitudinalErrorMps
    : speedError
  const longitudinalErrorSignChanged =
    Math.abs(previousLongitudinalError) > 1e-3
    && Math.abs(speedError) > 1e-3
    && Math.sign(previousLongitudinalError) !== Math.sign(speedError)
  const longitudinalErrorAlpha = 1 - Math.exp(-Math.max(0, longitudinalErrorSignChanged ? PP_LONGITUDINAL_ERROR_FILTER_RATE_PER_SEC * 0.45 : PP_LONGITUDINAL_ERROR_FILTER_RATE_PER_SEC) * Math.max(0, deltaSeconds))
  const longitudinalError = previousLongitudinalError + (speedError - previousLongitudinalError) * longitudinalErrorAlpha
  state.longitudinalErrorMps = longitudinalError

  let integral = typeof state.speedIntegral === 'number' ? state.speedIntegral : 0
  integral += speedError * deltaSeconds
  const integralMax = Math.max(0, pursuitProps.speedIntegralMax)
  integral = integralMax > 0 ? THREE.MathUtils.clamp(integral, -integralMax, integralMax) : 0

  // Integral leak to reduce overshoot and eliminate sign-flip chatter near steady-state.
  const absSpeedError = Math.abs(speedError)
  if (Number.isFinite(absSpeedError) && absSpeedError <= PP_INTEGRAL_LEAK_THRESHOLD_MPS) {
    const leak = Math.exp(-PP_INTEGRAL_LEAK_RATE_PER_SEC * Math.max(0, deltaSeconds))
    integral *= leak
  }
  if (
    integral !== 0 &&
    Number.isFinite(absSpeedError) &&
    absSpeedError <= PP_INTEGRAL_LEAK_THRESHOLD_MPS * 2 &&
    Math.sign(integral) !== Math.sign(speedError)
  ) {
    const leak = Math.exp(-PP_INTEGRAL_SIGN_MISMATCH_LEAK_RATE_PER_SEC * Math.max(0, deltaSeconds))
    integral *= leak
  }

  state.speedIntegral = integral

  const control = pursuitProps.speedKp * longitudinalError + pursuitProps.speedKi * integral

  const engineForceMax = Number.isFinite(vehicleProps.engineForceMax) ? Math.max(0, vehicleProps.engineForceMax) : 0
  const brakeForceMax = Number.isFinite(vehicleProps.brakeForceMax) ? Math.max(0, vehicleProps.brakeForceMax) : 0
  const engineForceCmd = THREE.MathUtils.clamp(control * engineForceMax * PP_ENGINE_FORCE_OUTPUT_SCALE, -engineForceMax, engineForceMax)

  // Hysteresis on longitudinal mode (engine vs brake) to avoid jitter from tiny sign changes around zero.
  // Decide direction from speed error (stable physical signal) and latch within a deadband.
  const desiredUseEngine = longitudinalError >= PP_LONGITUDINAL_ENGINE_ON_THRESHOLD_MPS
  const lastUseEngine = typeof state.longitudinalUseEngine === 'boolean' ? state.longitudinalUseEngine : desiredUseEngine
  let useEngine = lastUseEngine
  const now = Date.now()
  const lastSwitchAtMs = typeof state.longitudinalModeSwitchAtMs === 'number' ? state.longitudinalModeSwitchAtMs : 0
  const holdMs = useEngine ? PP_LONGITUDINAL_ENGINE_HOLD_MS : PP_LONGITUDINAL_BRAKE_HOLD_MS
  const holdElapsed = now - lastSwitchAtMs >= holdMs
  if (holdElapsed) {
    if (lastUseEngine) {
      if (longitudinalError <= -PP_LONGITUDINAL_BRAKE_ON_THRESHOLD_MPS) {
        useEngine = false
      }
    } else if (desiredUseEngine) {
      useEngine = true
    }
  }
  if (useEngine !== lastUseEngine) {
    state.longitudinalModeSwitchAtMs = now
    state.speedIntegral = 0
    integral = 0
  }
  state.longitudinalUseEngine = useEngine

  const inCoastZone = Math.abs(longitudinalError) <= PP_LONGITUDINAL_COAST_BAND_MPS
  let engineForce = 0
  let brakeForce = 0
  if (!inCoastZone) {
    engineForce = useEngine ? Math.min(engineForceMax, Math.max(0, engineForceCmd)) : 0
    brakeForce = useEngine ? 0 : Math.min(brakeForceMax, Math.max(0, Math.abs(control) * brakeForceMax * PP_BRAKE_FORCE_OUTPUT_SCALE))
  }

  // NOTE: We now gate the end-brake floor by remaining route arc length instead of straight-line distance.
  // This keeps braking early enough on bends without reintroducing stutter at dense intermediate waypoints.
  const shouldBrakeNearEnd = modeStopping && routeDistanceToEnd < brakeThreshold
  if (shouldBrakeNearEnd && !dockActive) {
    brakeForce = Math.max(brakeForce, Math.min(brakeForceMax, brakeForceMax * THREE.MathUtils.lerp(0.08, 0.24, terminalProgress)))
  }

  if (dockActive) {
    steering = 0
    engineForce = 0
    const dockBrakeForce = brakeForceMax * THREE.MathUtils.lerp(0.06, 0.42, terminalProgress)
    const overspeedBrakeForce = Math.min(
      brakeForceMax,
      Math.max(0, -longitudinalError) * brakeForceMax * 1.0,
    )
    brakeForce = Math.max(brakeForce, dockBrakeForce, overspeedBrakeForce)

    // Do not directly overwrite linear velocity in docking mode.
    // Overwriting velocity can cause the direction to flip as the chassis crosses the endpoint, resulting in jitter.

    if (pursuitProps.dockYawEnabled) {
      const prevIndex = clampedStopIndex > 0 ? clampedStopIndex - 1 : Math.min(clampedStopIndex + 1, endIndex)
      const prev = points[prevIndex]!
      const tanX = stopPoint.x - prev.x
      const tanZ = stopPoint.z - prev.z
      const tanLen = Math.sqrt(tanX * tanX + tanZ * tanZ)
      const yaw = tanLen > 1e-6
        ? Math.atan2(tanX / tanLen, tanZ / tanLen)
        : Math.atan2(forwardWorld.x, forwardWorld.z)

      yawTargetQuat.setFromAxisAngle(upAxis, yaw)
      const alphaYaw = 1 - Math.exp(-Math.max(0, pursuitProps.dockYawSlerpRate) * deltaSeconds)

      objectWorldQuat.copy(chassisQuat)
      objectWorldQuat.slerp(yawTargetQuat, clamp01(alphaYaw)).normalize()
      setCannonQuaternionFromThree(chassisBody.quaternion, objectWorldQuat)
    }

    chassisBody.angularVelocity.x *= 0.85
    chassisBody.angularVelocity.y *= 0.6
    chassisBody.angularVelocity.z *= 0.85
  }

  if (modeStopping && routeDistanceToEnd <= Math.max(stopEnvelopeDistance * 1.5, Math.max(3, brakeThreshold * 1.25))) {
    // Formatted string logging for endpoint braking diagnostics.
    // This is intentionally always-on for debugging the terminal stop transition.
    console.log(
      `[PurePursuitRuntime] node=${vehicleInstance as any && (vehicleInstance as any).nodeId ? (vehicleInstance as any).nodeId : 'unknown'} `
      + `phase=${dockActive ? 'dock-active' : shouldBrakeNearEnd ? 'end-brake' : 'approach'} `
      + `routeRemaining=${formatDebugNumber(routeDistanceToEnd)}m `
      + `stopEnvelope=${formatDebugNumber(stopEnvelopeDistance)}m `
      + `terminalTaper=${formatDebugNumber(terminalTaperDistance)}m `
      + `brakeThreshold=${formatDebugNumber(brakeThreshold)}m `
      + `dockProgress=${formatDebugNumber(dockProgress * 100, 0)}% `
      + `terminalProgress=${formatDebugNumber(terminalProgress * 100, 0)}% `
      + `terminalMaxSpeed=${formatDebugNumber(modeStopping ? Math.max(pursuitProps.dockStopSpeedEpsilonMps, cruiseSpeed * THREE.MathUtils.lerp(Math.max(0.04, minSpeedRatio * 0.35), 0.035, terminalProgress)) : cruiseSpeed)} `
      + `dockFallRate=${formatDebugNumber(dynamicSpeedTargetFallRate, 1)} `
      + `speedMps=${formatDebugNumber(speedMps)} `
      + `cruiseMps=${formatDebugNumber(cruiseSpeed)} `
      + `speedTargetMps=${formatDebugNumber(speedTarget)} `
      + `forwardSpeedMps=${formatDebugNumber(forwardSpeed)} `
      + `longitudinalErrorMps=${formatDebugNumber(longitudinalError)} `
      + `engineForce=${formatDebugNumber(engineForce, 1)} `
      + `brakeForce=${formatDebugNumber(brakeForce, 1)} `
      + `steerRad=${formatDebugNumber(steering, 3)}`,
    )
  }

  for (let index = 0; index < instance.wheelCount; index += 1) {
    vehicle.setBrake(brakeForce, index)
    vehicle.applyEngineForce(engineForce, index)
    vehicle.setSteeringValue(0, index)
  }
  instance.steerableWheelIndices.forEach((wheelIndex) => {
    vehicle.setSteeringValue(steering, wheelIndex)
  })

  if (modeStopping) {
    const vx = chassisBody.velocity.x
    const vz = chassisBody.velocity.z
    const planarSpeed = Math.sqrt(vx * vx + vz * vz)

    // Tolerant stopping: once we're within the docking zone, we only require a sufficiently low planar speed.
    // This avoids hunting around the exact endpoint.
    const stopDistance = Math.max(pursuitProps.dockStopEpsilonMeters, pursuitProps.dockStartDistanceMeters)
    if (routeDistanceToEnd <= stopDistance && planarSpeed <= pursuitProps.dockStopSpeedEpsilonMps) {
      chassisBody.velocity.x = 0
      chassisBody.velocity.z = 0
      chassisBody.angularVelocity.x = 0
      chassisBody.angularVelocity.y = 0
      chassisBody.angularVelocity.z = 0
      return { reachedStop: true }
    }
  }

  return { reachedStop: false }
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
}): { reachedStop: boolean } {
  try {
    return applyPurePursuitVehicleControl(params)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[PurePursuitRuntime] vehicle control failed', error)
    return { reachedStop: false }
  }
}

export function holdVehicleBrakeSafe(params: {
  vehicleInstance: PurePursuitVehicleInstanceLike
  brakeForce: number
}): void {
  const { vehicleInstance, brakeForce } = params
  try {
    const vehicle = vehicleInstance.vehicle
    for (let index = 0; index < vehicleInstance.wheelCount; index += 1) {
      vehicle.setBrake(brakeForce, index)
      vehicle.applyEngineForce(0, index)
      vehicle.setSteeringValue(0, index)
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[PurePursuitRuntime] vehicle hold brake failed', error)
  }
}
