import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import type { PurePursuitComponentProps } from './components'

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

type PolylinePlanarData = {
  segmentLengths: number[]
  segmentStarts: number[]
  totalLength: number
  closed: boolean
}

const DEFAULT_MAX_STEER_RADIANS = THREE.MathUtils.degToRad(26)
const REVERSE_ENTER_DOT = -0.2
const REVERSE_EXIT_DOT = 0.2

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

function buildPolylinePlanarData(points: THREE.Vector3[], closed: boolean): PolylinePlanarData | null {
  if (!points || points.length < 2) {
    return null
  }
  const segmentCount = closed ? points.length : points.length - 1
  if (segmentCount <= 0) {
    return null
  }
  const segmentLengths = new Array<number>(segmentCount)
  const segmentStarts = new Array<number>(segmentCount)
  let totalLength = 0
  for (let i = 0; i < segmentCount; i += 1) {
    segmentStarts[i] = totalLength
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.sqrt(dx * dx + dz * dz)
    const safeLen = Number.isFinite(len) ? Math.max(0, len) : 0
    segmentLengths[i] = safeLen
    totalLength += safeLen
  }
  return { segmentLengths, segmentStarts, totalLength, closed }
}

type ClosestPointOnPolyline = {
  segmentIndex: number
  t: number
  s: number
  distanceSq: number
}

function findClosestPointOnPolylineXZ(
  points: THREE.Vector3[],
  data: PolylinePlanarData,
  position: THREE.Vector3,
): ClosestPointOnPolyline {
  const px = position.x
  const pz = position.z
  let bestSegmentIndex = 0
  let bestT = 0
  let bestDistanceSq = Number.POSITIVE_INFINITY
  let bestS = 0

  for (let i = 0; i < data.segmentLengths.length; i += 1) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    const abx = b.x - a.x
    const abz = b.z - a.z
    const apx = px - a.x
    const apz = pz - a.z
    const denom = abx * abx + abz * abz
    const tRaw = denom > 1e-12 ? (apx * abx + apz * abz) / denom : 0
    const t = clamp01(tRaw)
    const cx = a.x + abx * t
    const cz = a.z + abz * t
    const dx = px - cx
    const dz = pz - cz
    const dSq = dx * dx + dz * dz
    if (dSq < bestDistanceSq) {
      bestDistanceSq = dSq
      bestSegmentIndex = i
      bestT = t
      bestS = data.segmentStarts[i]! + data.segmentLengths[i]! * t
    }
  }

  return {
    segmentIndex: bestSegmentIndex,
    t: bestT,
    s: bestS,
    distanceSq: bestDistanceSq,
  }
}

function samplePolylineAtS(
  points: THREE.Vector3[],
  data: PolylinePlanarData,
  s: number,
  y: number,
  out: THREE.Vector3,
): void {
  if (!Number.isFinite(s)) {
    s = 0
  }
  const total = data.totalLength
  if (total <= 1e-8) {
    const first = points[0]!
    out.set(first.x, y, first.z)
    return
  }
  let normalizedS = s
  if (data.closed) {
    normalizedS = ((normalizedS % total) + total) % total
  } else {
    normalizedS = Math.max(0, Math.min(total, normalizedS))
  }

  let segIndex = 0
  for (let i = 0; i < data.segmentStarts.length; i += 1) {
    const start = data.segmentStarts[i]!
    const end = start + data.segmentLengths[i]!
    if (normalizedS <= end || i === data.segmentStarts.length - 1) {
      segIndex = i
      break
    }
  }

  const segStart = data.segmentStarts[segIndex]!
  const segLen = Math.max(1e-8, data.segmentLengths[segIndex]!)
  const t = clamp01((normalizedS - segStart) / segLen)
  const a = points[segIndex]!
  const b = points[(segIndex + 1) % points.length]!
  out.set(a.x + (b.x - a.x) * t, y, a.z + (b.z - a.z) * t)
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
    Number.isFinite(pursuitProps.maxSteerDegrees)
      ? pursuitProps.maxSteerDegrees
      : THREE.MathUtils.radToDeg(DEFAULT_MAX_STEER_RADIANS),
  )
  const maxSteerRateRadPerSec = THREE.MathUtils.degToRad(
    Number.isFinite(pursuitProps.maxSteerRateDegPerSec) ? pursuitProps.maxSteerRateDegPerSec : 140,
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

  const polylineData = buildPolylinePlanarData(points, Boolean(loop))
  if (!polylineData) {
    return { reachedStop: false }
  }

  currentPositionThree.set(currentPosition.x, currentPosition.y, currentPosition.z)
  const closest = findClosestPointOnPolylineXZ(points, polylineData, currentPositionThree)

  const lookaheadDistance = Math.max(
    pursuitProps.lookaheadMinMeters,
    Math.min(
      pursuitProps.lookaheadMaxMeters,
      pursuitProps.lookaheadBaseMeters + pursuitProps.lookaheadSpeedGain * speedMps,
    ),
  )

  samplePolylineAtS(points, polylineData, closest.s + lookaheadDistance, currentY, lookaheadPoint)

  const endIndex = points.length - 1
  const endPoint = points[endIndex]!
  planarEnd.set(endPoint.x, currentY, endPoint.z)
  const dxEnd = planarEnd.x - currentPosition.x
  const dzEnd = planarEnd.z - currentPosition.z
  const distanceToEnd = Math.sqrt(dxEnd * dxEnd + dzEnd * dzEnd)

  const dockActive = modeStopping && pursuitProps.dockingEnabled && distanceToEnd <= pursuitProps.dockStartDistanceMeters

  const wheelbaseMeters = Math.max(0.01, pursuitProps.wheelbaseMeters)
  rearAxle.set(currentPosition.x, currentY, currentPosition.z)
  rearAxle.addScaledVector(forwardWorld, -wheelbaseMeters * 0.5)

  toLookahead.copy(lookaheadPoint).sub(rearAxle)
  toLookahead.y = 0
  const toTargetLen = toLookahead.length()
  if (!Number.isFinite(toTargetLen) || toTargetLen < 1e-6) {
    return { reachedStop: false }
  }

  desiredDir.copy(toLookahead).normalize()

  const forwardDotTarget = THREE.MathUtils.clamp(forwardWorld.dot(desiredDir), -1, 1)
  const reversePrev = Boolean(state.reverseActive)
  const reverse = reversePrev
    ? forwardDotTarget < REVERSE_EXIT_DOT
    : forwardDotTarget < REVERSE_ENTER_DOT
  state.reverseActive = reverse

  const crossY = cross.copy(forwardWorld).cross(desiredDir).dot(upAxis)
  const dot = THREE.MathUtils.clamp(forwardWorld.dot(desiredDir), -1, 1)
  const alpha = (crossY >= 0 ? 1 : -1) * Math.acos(dot)

  const safeMaxSteer = Number.isFinite(maxSteerRad) && maxSteerRad > 1e-6 ? maxSteerRad : DEFAULT_MAX_STEER_RADIANS
  let steering = Math.atan2(2 * wheelbaseMeters * Math.sin(alpha), Math.max(1e-6, toTargetLen))
  steering = THREE.MathUtils.clamp(steering, -safeMaxSteer, safeMaxSteer)
  if (reverse) {
    steering = -steering
  }

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

  const desiredSpeedSigned = reverse ? -speedTarget : speedTarget

  planarVelocity.set(chassisBody.velocity.x, 0, chassisBody.velocity.z)
  const forwardSpeed = planarVelocity.dot(forwardWorld)
  const speedError = desiredSpeedSigned - forwardSpeed

  let integral = typeof state.speedIntegral === 'number' ? state.speedIntegral : 0
  integral += speedError * deltaSeconds
  const integralMax = Math.max(0, pursuitProps.speedIntegralMax)
  integral = integralMax > 0 ? THREE.MathUtils.clamp(integral, -integralMax, integralMax) : 0
  state.speedIntegral = integral

  const control = pursuitProps.speedKp * speedError + pursuitProps.speedKi * integral
  const engineForceCmd = THREE.MathUtils.clamp(
    control * pursuitProps.engineForceMax,
    -pursuitProps.engineForceMax,
    pursuitProps.engineForceMax,
  )

  const desiredSign = desiredSpeedSigned >= 0 ? 1 : -1
  const useEngine = engineForceCmd * desiredSign >= 0
  let engineForce = useEngine ? engineForceCmd : 0
  let brakeForce = useEngine
    ? 0
    : Math.min(pursuitProps.brakeForceMax, Math.max(0, Math.abs(control) * pursuitProps.brakeForceMax))

  const shouldBrake = distanceToTarget < Math.max(
    pursuitProps.brakeDistanceMinMeters,
    speedMps * pursuitProps.brakeDistanceSpeedFactor,
  )
  if (shouldBrake && !dockActive) {
    brakeForce = Math.max(brakeForce, Math.min(pursuitProps.brakeForceMax, pursuitProps.brakeForceMax * 0.35))
  }

  if (dockActive) {
    steering = 0
    engineForce = 0
    brakeForce = Math.max(brakeForce, pursuitProps.brakeForceMax * 6)

    const errX = planarEnd.x - currentPosition.x
    const errZ = planarEnd.z - currentPosition.z
    const errLen = Math.sqrt(errX * errX + errZ * errZ)
    if (errLen > 1e-6) {
      const desiredDockSpeed = Math.min(pursuitProps.dockMaxSpeedMps, errLen * pursuitProps.dockVelocityKp)
      chassisBody.velocity.x = (errX / errLen) * desiredDockSpeed
      chassisBody.velocity.z = (errZ / errLen) * desiredDockSpeed
    } else {
      chassisBody.velocity.x = 0
      chassisBody.velocity.z = 0
    }

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
    if (distanceToEnd <= pursuitProps.dockStopEpsilonMeters && planarSpeed <= pursuitProps.dockStopSpeedEpsilonMps) {
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
