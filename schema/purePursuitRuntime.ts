import * as THREE from 'three'
import { applyPhysicsVehicleWheelControl } from '@harmony/physics-core'
import type { PurePursuitComponentProps, VehicleComponentProps } from './components'
import { resolvePathFollowLookaheadDistance, resolvePathFollowSample } from './pathFollowCommon'
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

export type PurePursuitVehicleControlState = {
  speedIntegral?: number
  lastSteerRad?: number
  lastBrakeForce?: number
  speedTargetMps?: number
  forwardSpeedMps?: number
  longitudinalErrorMps?: number
  reverseActive?: boolean
  longitudinalUseEngine?: boolean
  longitudinalModeSwitchAtMs?: number
}

export type PurePursuitVehicleControlResult = {
  reachedStop: boolean
  steeringRad: number
  targetSpeedMps: number
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
const yawTargetQuat = new THREE.Quaternion()
const objectWorldQuat = new THREE.Quaternion()

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(1, value))
}

const PURE_PURSUIT_STOP_HOLD_BRAKE_MULTIPLIER = 6
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
    stopIndex,
  } = params

  const vehicle = vehicleInstance.vehicle
  const chassisBody = vehicle.chassisBody
  const dt = getSafeDeltaSeconds(params.deltaSeconds)
  const wheelCount = Math.max(0, vehicleInstance.wheelCount)

  if (!chassisBody || wheelCount <= 0 || !points || points.length < 2) {
    vehicle.autoTourDebugWorldPosition = undefined
    return {
      reachedStop: false,
      steeringRad: typeof state.lastSteerRad === 'number' ? state.lastSteerRad : 0,
      targetSpeedMps: 0,
    }
  }

  purePursuitChassisPosition.set(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z)
  purePursuitChassisQuaternion
    .set(chassisBody.quaternion.x, chassisBody.quaternion.y, chassisBody.quaternion.z, chassisBody.quaternion.w)
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

  const currentPosition = purePursuitChassisPosition
  const currentY = currentPosition.y
  const currentVelocity = chassisBody.velocity
  const forwardSpeed = currentVelocity.x * purePursuitForward.x
    + currentVelocity.y * purePursuitForward.y
    + currentVelocity.z * purePursuitForward.z

  state.forwardSpeedMps = forwardSpeed
  state.reverseActive = false

  const lookaheadDistance = resolvePathFollowLookaheadDistance({
    speedMps: Math.max(Math.abs(forwardSpeed), Math.max(0, Number.isFinite(speedMps) ? speedMps : 0)),
    baseMeters: pursuitProps.lookaheadBaseMeters,
    speedGain: pursuitProps.lookaheadSpeedGain,
    minMeters: pursuitProps.lookaheadMinMeters,
    maxMeters: pursuitProps.lookaheadMaxMeters,
  })

  const previewSample = resolvePathFollowSample({
    points,
    loop,
    currentPosition,
    lookaheadDistance,
    mode: 'xz',
    outLookaheadPoint: purePursuitLookaheadPoint,
    outClosestPoint: purePursuitClosestPoint,
  })

  if (!previewSample || previewSample.polylineData.totalLength <= 1e-6) {
    holdVehicleBrakeSafe({ vehicleInstance, brakeForce: vehicleProps.brakeForceMax * PURE_PURSUIT_STOP_HOLD_BRAKE_MULTIPLIER })
    vehicle.autoTourDebugWorldPosition = undefined
    return {
      reachedStop: false,
      steeringRad: typeof state.lastSteerRad === 'number' ? state.lastSteerRad : 0,
      targetSpeedMps: 0,
    }
  }

  const endIndex = points.length - 1
  const rawStopIndex = typeof stopIndex === 'number' && Number.isFinite(stopIndex) ? Math.floor(stopIndex) : endIndex
  const clampedStopIndex = Math.max(0, Math.min(endIndex, rawStopIndex))
  const stopPoint = points[clampedStopIndex]!
  const stopS = resolveRouteVertexS(points, clampedStopIndex, loop)
  let adjustedStopS = stopS
  if (loop && adjustedStopS < previewSample.projection.s) {
    adjustedStopS += previewSample.polylineData.totalLength
  }
  const distanceToEnd = getPlanarDistance(currentPosition, stopPoint)
  const dockActive = modeStopping && pursuitProps.dockingEnabled && distanceToEnd <= pursuitProps.dockStartDistanceMeters

  const wheelbaseMeters = Math.max(0.01, vehicleProps.wheelbaseMeters)
  purePursuitTargetDelta.copy(previewSample.lookaheadPoint).sub(currentPosition)
  purePursuitTargetDelta.y = 0
  const toTargetLen = purePursuitTargetDelta.length()
  if (!Number.isFinite(toTargetLen) || toTargetLen < 1e-6) {
    return { reachedStop: false, steeringRad: typeof state.lastSteerRad === 'number' ? state.lastSteerRad : 0, targetSpeedMps: 0 }
  }

  const rearAxleX = currentPosition.x - purePursuitForward.x * (wheelbaseMeters * 0.5)
  const rearAxleY = currentY - purePursuitForward.y * (wheelbaseMeters * 0.5)
  const rearAxleZ = currentPosition.z - purePursuitForward.z * (wheelbaseMeters * 0.5)
  purePursuitTargetDelta.copy(previewSample.lookaheadPoint)
  purePursuitTargetDelta.x -= rearAxleX
  purePursuitTargetDelta.y -= rearAxleY
  purePursuitTargetDelta.z -= rearAxleZ
  purePursuitTargetDelta.y = 0
  const targetLen = purePursuitTargetDelta.length()
  if (!Number.isFinite(targetLen) || targetLen < 1e-6) {
    return { reachedStop: false, steeringRad: typeof state.lastSteerRad === 'number' ? state.lastSteerRad : 0, targetSpeedMps: 0 }
  }
  const desiredDir = purePursuitTargetDelta.clone().normalize()
  const crossY = purePursuitForward.clone().cross(desiredDir).dot(purePursuitUp)
  const dot = THREE.MathUtils.clamp(purePursuitForward.dot(desiredDir), -1, 1)
  const alpha = (crossY >= 0 ? 1 : -1) * Math.acos(dot)

  const maxSteerRad = THREE.MathUtils.degToRad(Math.max(0, vehicleProps.maxSteerDegrees))
  const safeMaxSteer = Number.isFinite(maxSteerRad) && maxSteerRad > 1e-6 ? maxSteerRad : THREE.MathUtils.degToRad(26)
  let steeringRad = Math.atan2(2 * wheelbaseMeters * Math.sin(alpha), Math.max(1e-6, targetLen))
  steeringRad = THREE.MathUtils.clamp(steeringRad, -safeMaxSteer, safeMaxSteer)
  const lastSteer = typeof state.lastSteerRad === 'number' ? state.lastSteerRad : 0
  const maxSteerStep = THREE.MathUtils.degToRad(Math.max(0, vehicleProps.maxSteerRateDegPerSec)) * dt
  steeringRad = THREE.MathUtils.clamp(steeringRad, lastSteer - maxSteerStep, lastSteer + maxSteerStep)
  state.lastSteerRad = steeringRad

  const steerRatio = safeMaxSteer > 1e-6 ? Math.min(1, Math.abs(steeringRad) / safeMaxSteer) : 0
  const turnFactor = 1 / (1 + Math.max(0, pursuitProps.curvatureSpeedFactor) * steerRatio)
  const componentMaxSpeed = Number.isFinite(pursuitProps.maxSpeedMps) ? pursuitProps.maxSpeedMps : Number.POSITIVE_INFINITY
  const speed = Math.max(0, Math.min(speedMps, componentMaxSpeed))
  let speedTarget = Math.max(pursuitProps.minSpeedMps, speed * turnFactor)
  if (modeStopping) {
    const approachSpeed = Math.min(pursuitProps.dockMaxSpeedMps, Math.max(0, distanceToEnd * pursuitProps.dockVelocityKp))
    speedTarget = Math.min(speedTarget, approachSpeed)
  }

  const desiredSpeedSigned = speedTarget
  const planarVelocity = new THREE.Vector3(currentVelocity.x, 0, currentVelocity.z)
  const forwardSignedSpeed = planarVelocity.dot(purePursuitForward)
  const speedError = desiredSpeedSigned - forwardSignedSpeed

  let integral = typeof state.speedIntegral === 'number' ? state.speedIntegral : 0
  integral += speedError * dt
  const integralMax = Math.max(0, pursuitProps.speedIntegralMax)
  integral = integralMax > 0 ? THREE.MathUtils.clamp(integral, -integralMax, integralMax) : 0

  const absSpeedError = Math.abs(speedError)
  if (Number.isFinite(absSpeedError) && absSpeedError <= 0.10) {
    integral *= Math.exp(-1.6 * Math.max(0, dt))
  }
  if (
    integral !== 0
    && Number.isFinite(absSpeedError)
    && absSpeedError <= 0.20
    && Math.sign(integral) !== Math.sign(speedError)
  ) {
    integral *= Math.exp(-5.0 * Math.max(0, dt))
  }
  state.speedIntegral = integral

  const control = pursuitProps.speedKp * speedError + pursuitProps.speedKi * integral
  const engineForceMax = Number.isFinite(vehicleProps.engineForceMax) ? Math.max(0, vehicleProps.engineForceMax) : 0
  const brakeForceMax = Number.isFinite(vehicleProps.brakeForceMax) ? Math.max(0, vehicleProps.brakeForceMax) : 0
  const engineForceCmd = THREE.MathUtils.clamp(control * engineForceMax, -engineForceMax, engineForceMax)

  const desiredUseEngine = speedError > 0
  const lastUseEngine = typeof state.longitudinalUseEngine === 'boolean' ? state.longitudinalUseEngine : desiredUseEngine
  let useEngine = lastUseEngine
  if (absSpeedError > 0.06) {
    useEngine = desiredUseEngine
  }
  state.longitudinalUseEngine = useEngine

  let engineForce = useEngine ? Math.max(0, engineForceCmd) : 0
  let brakeForce = useEngine ? 0 : Math.min(brakeForceMax, Math.max(0, Math.abs(control) * brakeForceMax))

  const brakeThreshold = Math.max(pursuitProps.brakeDistanceMinMeters, speed * pursuitProps.brakeDistanceSpeedFactor)
  const shouldBrakeNearEnd = modeStopping && distanceToEnd < brakeThreshold
  if (shouldBrakeNearEnd && !dockActive) {
    brakeForce = Math.max(brakeForce, Math.min(brakeForceMax, brakeForceMax * 0.35))
  }

  if (dockActive) {
    steeringRad = 0
    engineForce = 0
    brakeForce = Math.max(brakeForce, brakeForceMax * PURE_PURSUIT_STOP_HOLD_BRAKE_MULTIPLIER)

    if (pursuitProps.dockYawEnabled) {
      const prevIndex = clampedStopIndex > 0 ? clampedStopIndex - 1 : Math.min(clampedStopIndex + 1, endIndex)
      const prev = points[prevIndex]!
      const tanX = stopPoint.x - prev.x
      const tanZ = stopPoint.z - prev.z
      const tanLen = Math.sqrt(tanX * tanX + tanZ * tanZ)
      const yaw = tanLen > 1e-6
        ? Math.atan2(tanX / tanLen, tanZ / tanLen)
        : Math.atan2(purePursuitForward.x, purePursuitForward.z)
      yawTargetQuat.setFromAxisAngle(purePursuitUp, yaw)
      const alphaYaw = 1 - Math.exp(-Math.max(0, pursuitProps.dockYawSlerpRate) * dt)
      objectWorldQuat.copy(purePursuitChassisQuaternion)
      objectWorldQuat.slerp(yawTargetQuat, clamp01(alphaYaw)).normalize()
      chassisBody.quaternion.x = objectWorldQuat.x
      chassisBody.quaternion.y = objectWorldQuat.y
      chassisBody.quaternion.z = objectWorldQuat.z
      chassisBody.quaternion.w = objectWorldQuat.w
    }

    chassisBody.angularVelocity.x *= 0.85
    chassisBody.angularVelocity.y *= 0.6
    chassisBody.angularVelocity.z *= 0.85
  }

  console.log('steeringRad', steeringRad, 'engineForce', engineForce, 'brakeForce', brakeForce, 'desiredSpeedSigned', desiredSpeedSigned, 'distanceToEnd', distanceToEnd, 'dockActive', dockActive)

  applyPhysicsVehicleWheelControl(vehicle, {
    steeringValue: steeringRad,
    engineForce,
    brakeForce,
    steerableWheelIndices: vehicleInstance.steerableWheelIndices,
  })

  vehicle.autoTourTargetSpeedMps = desiredSpeedSigned
  vehicle.autoTourTargetSteeringRad = steeringRad
  vehicle.autoTourDebugWorldPosition = {
    x: purePursuitLookaheadPoint.x,
    y: purePursuitLookaheadPoint.y,
    z: purePursuitLookaheadPoint.z,
  }

  if (modeStopping) {
    const planarSpeed = Math.sqrt(currentVelocity.x * currentVelocity.x + currentVelocity.z * currentVelocity.z)
    const stopDistance = Math.max(pursuitProps.dockStopEpsilonMeters, pursuitProps.dockStartDistanceMeters)
    if (distanceToEnd <= stopDistance && planarSpeed <= pursuitProps.dockStopSpeedEpsilonMps) {
      holdVehicleBrakeSafe({ vehicleInstance, brakeForce: brakeForceMax * PURE_PURSUIT_STOP_HOLD_BRAKE_MULTIPLIER })
      chassisBody.velocity.x = 0
      chassisBody.velocity.z = 0
      chassisBody.angularVelocity.x = 0
      chassisBody.angularVelocity.y = 0
      chassisBody.angularVelocity.z = 0
      return {
        reachedStop: true,
        steeringRad: 0,
        targetSpeedMps: 0,
      }
    }
  }

  state.longitudinalErrorMps = speedError
  state.lastBrakeForce = brakeForce

  return {
    reachedStop: false,
    steeringRad,
    targetSpeedMps: desiredSpeedSigned,
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
