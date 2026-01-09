import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import type { PurePursuitComponentProps, VehicleComponentProps } from './components'
import { buildPolylineMetricData, projectPointToPolyline, samplePolylineAtS } from './polylineProgress'

export type PurePursuitVehicleInstanceLike = {
  vehicle: CANNON.RaycastVehicle
  wheelCount: number
  steerableWheelIndices: number[]
  axisForward: THREE.Vector3
}

export type PurePursuitVehicleControlState = {
  speedIntegral?: number
  lastSteerRad?: number
  reverseActive?: boolean
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
const planarEnd = new THREE.Vector3()
const yawTargetQuat = new THREE.Quaternion()
const objectWorldQuat = new THREE.Quaternion()
const currentPositionThree = new THREE.Vector3()

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(1, value))
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
  distanceToTarget: number
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
    distanceToTarget,
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

  const polylineData = buildPolylineMetricData(points, { closed: Boolean(loop), mode: '3d' })
  if (!polylineData) {
    return { reachedStop: false }
  }

  currentPositionThree.set(currentPosition.x, currentPosition.y, currentPosition.z)
  const closest = projectPointToPolyline(points, polylineData, currentPositionThree)

  const lookaheadDistance = Math.max(
    pursuitProps.lookaheadMinMeters,
    Math.min(
      pursuitProps.lookaheadMaxMeters,
      pursuitProps.lookaheadBaseMeters + pursuitProps.lookaheadSpeedGain * speedMps,
    ),
  )

  samplePolylineAtS(points, polylineData, closest.s + lookaheadDistance, lookaheadPoint)

  const endIndex = points.length - 1
  const endPoint = points[endIndex]!
  planarEnd.set(endPoint.x, currentY, endPoint.z)
  const dxEnd = planarEnd.x - currentPosition.x
  const dzEnd = planarEnd.z - currentPosition.z
  const distanceToEnd = Math.sqrt(dxEnd * dxEnd + dzEnd * dzEnd)

  const dockActive = modeStopping && pursuitProps.dockingEnabled && distanceToEnd <= pursuitProps.dockStartDistanceMeters

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
  const reverse = false
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

  const steerRatio = safeMaxSteer > 1e-6 ? Math.min(1, Math.abs(steering) / safeMaxSteer) : 0
  const turnFactor = 1 / (1 + Math.max(0, pursuitProps.curvatureSpeedFactor) * steerRatio)
  let speedTarget = Math.max(pursuitProps.minSpeedMps, speedMps * turnFactor)

  if (modeStopping) {
    const approachSpeed = Math.min(
      pursuitProps.dockMaxSpeedMps,
      Math.max(0, distanceToEnd * pursuitProps.dockVelocityKp),
    )
    speedTarget = Math.min(speedTarget, approachSpeed)
  }

  const desiredSpeedSigned = speedTarget

  planarVelocity.set(chassisBody.velocity.x, 0, chassisBody.velocity.z)
  const forwardSpeed = planarVelocity.dot(forwardWorld)
  const speedError = desiredSpeedSigned - forwardSpeed

  let integral = typeof state.speedIntegral === 'number' ? state.speedIntegral : 0
  integral += speedError * deltaSeconds
  const integralMax = Math.max(0, pursuitProps.speedIntegralMax)
  integral = integralMax > 0 ? THREE.MathUtils.clamp(integral, -integralMax, integralMax) : 0
  state.speedIntegral = integral

  const control = pursuitProps.speedKp * speedError + pursuitProps.speedKi * integral

  const engineForceMax = Number.isFinite(vehicleProps.engineForceMax) ? Math.max(0, vehicleProps.engineForceMax) : 0
  const brakeForceMax = Number.isFinite(vehicleProps.brakeForceMax) ? Math.max(0, vehicleProps.brakeForceMax) : 0
  const engineForceCmd = THREE.MathUtils.clamp(control * engineForceMax, -engineForceMax, engineForceMax)

  const desiredSign = 1
  const useEngine = engineForceCmd * desiredSign >= 0
  let engineForce = useEngine ? engineForceCmd : 0
  let brakeForce = useEngine
    ? 0
    : Math.min(brakeForceMax, Math.max(0, Math.abs(control) * brakeForceMax))

  // NOTE: `distanceToTarget` in AutoTour is the distance to the *current waypoint*.
  // Applying a hard brake floor near every waypoint causes visible stutter on curves (dense waypoints).
  // We only apply this brake-distance rule while stopping near the end.
  const brakeThreshold = Math.max(
    pursuitProps.brakeDistanceMinMeters,
    speedMps * pursuitProps.brakeDistanceSpeedFactor,
  )
  const shouldBrakeNearEnd = modeStopping && distanceToEnd < brakeThreshold
  if (shouldBrakeNearEnd && !dockActive) {
    brakeForce = Math.max(brakeForce, Math.min(brakeForceMax, brakeForceMax * 0.35))
  }

  if (dockActive) {
    steering = 0
    engineForce = 0
    brakeForce = Math.max(brakeForce, brakeForceMax * 6)

    // Do not directly overwrite linear velocity in docking mode.
    // Overwriting velocity can cause the direction to flip as the chassis crosses the endpoint, resulting in jitter.

    if (pursuitProps.dockYawEnabled) {
      const prev = points[Math.max(0, endIndex - 1)]!
      const tanX = endPoint.x - prev.x
      const tanZ = endPoint.z - prev.z
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
    if (distanceToEnd <= stopDistance && planarSpeed <= pursuitProps.dockStopSpeedEpsilonMps) {
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
