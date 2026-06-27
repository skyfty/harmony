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

export type PurePursuitVehicleControlResult = {
  reachedStop: boolean
  steeringRad: number
  targetSpeedMps: number
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
const PURE_PURSUIT_SPEED_GOVERNOR_SOFT_RATIO = 0.92
const PURE_PURSUIT_SPEED_GOVERNOR_BRAKE_ENTER_OFFSET = 0.45
const PURE_PURSUIT_SPEED_GOVERNOR_BRAKE_EXIT_OFFSET = 0.2
const PURE_PURSUIT_SPEED_GOVERNOR_BRAKE_DEADBAND = 0.35
const PURE_PURSUIT_SPEED_GOVERNOR_BRAKE_BAND = 1.8
const PURE_PURSUIT_SPEED_GOVERNOR_BRAKE_MAX_RATIO = 0.14

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
  }
}

function resolvePurePursuitDockingOverrides(params: {
  dockActive: boolean
  clampStopIndex: number
  endIndex: number
  points: THREE.Vector3[]
  forwardWorld: THREE.Vector3
  chassisBody: VehicleDriveVehicle['chassisBody']
  pursuitProps: PurePursuitComponentProps
  vehicleProps: VehicleComponentProps
  vehicleInstance: PurePursuitVehicleInstanceLike
  dt: number
}): { steeringRad: number; engineForce: number; brakeForceFloor: number } | null {
  if (!params.dockActive) {
    return null
  }

  // 泊车语义集中在这里：锁转向、关动力、强制刹停，并在需要时对齐车身朝向。
  const brakeForceMax = Number.isFinite(params.vehicleProps.brakeForceMax) ? Math.max(0, params.vehicleProps.brakeForceMax) : 0
  if (params.pursuitProps.dockYawEnabled) {
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
  const crossY = forwardWorld.clone().cross(desiredDir).dot(purePursuitUp)
  const dot = THREE.MathUtils.clamp(forwardWorld.dot(desiredDir), -1, 1)
  const alpha = (crossY >= 0 ? 1 : -1) * Math.acos(dot)
  const maxSteerRad = THREE.MathUtils.degToRad(Math.max(0, vehicleProps.maxSteerDegrees))
  const safeMaxSteer = Number.isFinite(maxSteerRad) && maxSteerRad > 1e-6 ? maxSteerRad : THREE.MathUtils.degToRad(26)
  let steeringRad = Math.atan2(2 * wheelbaseMeters * Math.sin(alpha), Math.max(1e-6, targetLen))
  steeringRad = THREE.MathUtils.clamp(steeringRad, -safeMaxSteer, safeMaxSteer)
  const maxSteerStep = THREE.MathUtils.degToRad(Math.max(0, vehicleProps.maxSteerRateDegPerSec)) * deltaSeconds
  return THREE.MathUtils.clamp(steeringRad, lastSteerRad - maxSteerStep, lastSteerRad + maxSteerStep)
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
  } = params

  const steerRatio = Math.min(1, Math.abs(steeringRad) / Math.max(1e-6, THREE.MathUtils.degToRad(Math.max(0, vehicleProps.maxSteerDegrees)) || THREE.MathUtils.degToRad(26)))
  const turnFactor = 1 / (1 + Math.max(0, pursuitProps.curvatureSpeedFactor) * steerRatio)
  const speed = Number.isFinite(speedMps) ? Math.max(0, speedMps) : 0
  const componentSpeedCap = Number.isFinite(pursuitProps.maxSpeedMps) ? Math.max(0, pursuitProps.maxSpeedMps) : speed
  const externalSpeedCap = Number.isFinite(speedCapMps) ? Math.max(0, speedCapMps!) : componentSpeedCap
  const speedCap = Math.min(componentSpeedCap, externalSpeedCap)
  let speedTarget = Math.max(pursuitProps.minSpeedMps, speed * turnFactor)
  if (modeStopping) {
    const approachSpeed = Math.min(pursuitProps.dockMaxSpeedMps, Math.max(0, distanceToEnd * pursuitProps.dockVelocityKp))
    speedTarget = Math.min(speedTarget, approachSpeed)
  }

  const desiredSpeedSigned = speedTarget
  const speedError = desiredSpeedSigned - forwardSignedSpeed
  const speedIntegralMax = Math.max(0, pursuitProps.speedIntegralMax)
  let integral = speedIntegral + speedError * deltaSeconds
  integral = speedIntegralMax > 0 ? THREE.MathUtils.clamp(integral, -speedIntegralMax, speedIntegralMax) : 0
  const absSpeedError = Math.abs(speedError)
  if (Number.isFinite(absSpeedError) && absSpeedError <= 0.10) {
    integral *= Math.exp(-1.6 * Math.max(0, deltaSeconds))
  }
  if (
    integral !== 0
    && Number.isFinite(absSpeedError)
    && absSpeedError <= 0.20
    && Math.sign(integral) !== Math.sign(speedError)
  ) {
    integral *= Math.exp(-5.0 * Math.max(0, deltaSeconds))
  }

  const control = pursuitProps.speedKp * speedError + pursuitProps.speedKi * integral
  const engineForceMax = Number.isFinite(vehicleProps.engineForceMax) ? Math.max(0, vehicleProps.engineForceMax) : 0
  const brakeForceMax = Number.isFinite(vehicleProps.brakeForceMax) ? Math.max(0, vehicleProps.brakeForceMax) : 0
  const engineForceCmd = THREE.MathUtils.clamp(control * engineForceMax, -engineForceMax, engineForceMax)

  const desiredUseEngine = speedError > 0
  let useEngine = typeof lastUseEngine === 'boolean' ? lastUseEngine : desiredUseEngine
  if (absSpeedError > 0.06) {
    useEngine = desiredUseEngine
  }
  let engineForce = useEngine ? Math.max(0, engineForceCmd) : 0
  let brakeForce = !useEngine && modeStopping
    ? Math.min(brakeForceMax, Math.max(0, Math.abs(control) * brakeForceMax))
    : 0

  const hardCap = Math.max(0.1, speedCap)
  const softCap = Math.max(0.1, hardCap * PURE_PURSUIT_SPEED_GOVERNOR_SOFT_RATIO)
  const forwardSpeedAbs = Math.abs(forwardSignedSpeed)
  let speedGovernorScaleValue = typeof speedGovernorScale === 'number' ? clamp01(speedGovernorScale) : 1
  let speedGovernorBrakeAssistValue = typeof speedGovernorBrakeAssist === 'number' ? Math.max(0, speedGovernorBrakeAssist) : 0
  let speedGovernorSmoothedForwardSpeedAbsValue = typeof speedGovernorSmoothedForwardSpeedAbs === 'number'
    ? Math.max(0, speedGovernorSmoothedForwardSpeedAbs)
    : 0
  let speedGovernorOverHardCapValue = speedGovernorOverHardCap === true
  const speedSmoothAlpha = 1 - Math.exp(-6 * deltaSeconds)
  speedGovernorSmoothedForwardSpeedAbsValue += (forwardSpeedAbs - speedGovernorSmoothedForwardSpeedAbsValue) * speedSmoothAlpha
  const speedForGovernor = Math.max(forwardSpeedAbs, speedGovernorSmoothedForwardSpeedAbsValue)
  const acceleratingForward = engineForce > 0 && forwardSignedSpeed >= -0.05
  if (acceleratingForward) {
    const range = Math.max(0.1, hardCap - softCap)
    const excess = Math.max(0, speedForGovernor - softCap)
    const t = Math.min(1, excess / range)
    const smooth = t * t * (3 - 2 * t)
    const scaleTarget = Math.max(0, 1 - smooth)
    const scaleAlpha = 1 - Math.exp(-14 * deltaSeconds)
    speedGovernorScaleValue += (scaleTarget - speedGovernorScaleValue) * scaleAlpha
    engineForce *= speedGovernorScaleValue
  } else {
    const relaxAlpha = 1 - Math.exp(-6 * deltaSeconds)
    speedGovernorScaleValue += (1 - speedGovernorScaleValue) * relaxAlpha
  }

  const hardCapEnter = hardCap + PURE_PURSUIT_SPEED_GOVERNOR_BRAKE_ENTER_OFFSET
  const hardCapExit = hardCap + PURE_PURSUIT_SPEED_GOVERNOR_BRAKE_EXIT_OFFSET
  if (!speedGovernorOverHardCapValue) {
    if (speedForGovernor > hardCapEnter) {
      speedGovernorOverHardCapValue = true
    }
  } else if (speedForGovernor < hardCapExit) {
    speedGovernorOverHardCapValue = false
  }

  const over = speedGovernorOverHardCapValue
    ? Math.max(0, speedForGovernor - (hardCap + PURE_PURSUIT_SPEED_GOVERNOR_BRAKE_DEADBAND))
    : 0
  const brakeRatio = Math.min(1, over / PURE_PURSUIT_SPEED_GOVERNOR_BRAKE_BAND)
  const governorBrakeTarget = brakeRatio * brakeForceMax * PURE_PURSUIT_SPEED_GOVERNOR_BRAKE_MAX_RATIO
  const brakeAlpha = 1 - Math.exp(-4 * deltaSeconds)
  speedGovernorBrakeAssistValue += (governorBrakeTarget - speedGovernorBrakeAssistValue) * brakeAlpha
  brakeForce = Math.min(brakeForceMax, Math.max(brakeForce, speedGovernorBrakeAssistValue))

  const brakeThreshold = Math.max(pursuitProps.brakeDistanceMinMeters, speed * pursuitProps.brakeDistanceSpeedFactor)
  const shouldBrakeNearEnd = modeStopping && distanceToEnd < brakeThreshold
  if (shouldBrakeNearEnd && !dockActive) {
    brakeForce = Math.max(brakeForce, Math.min(brakeForceMax, brakeForceMax * 0.35))
  }

  if (dockActive) {
    brakeForce = Math.max(brakeForce, brakeForceMax * PURE_PURSUIT_STOP_HOLD_BRAKE_MULTIPLIER)
    engineForce = 0
  }

  return {
    speedTargetMps: desiredSpeedSigned,
    engineForce,
    brakeForce,
    speedIntegral: integral,
    speedGovernorScale: speedGovernorScaleValue,
    speedGovernorBrakeAssist: speedGovernorBrakeAssistValue,
    speedGovernorSmoothedForwardSpeedAbs: speedGovernorSmoothedForwardSpeedAbsValue,
    speedGovernorOverHardCap: speedGovernorOverHardCapValue,
    desiredUseEngine: useEngine,
  }
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
  speedCapMps?: number
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


  // 获取车辆实体与车身刚体，后续控制都基于这两个对象执行。
  const vehicle = vehicleInstance.vehicle
  const chassisBody = vehicle.chassisBody

  // 将外部传入的 deltaSeconds 规范化为安全值，避免异常帧时间影响控制稳定性。
  const dt = getSafeDeltaSeconds(params.deltaSeconds)
  // 轮子数量必须有效，否则无法执行轮胎转向和动力输出。
  const wheelCount = Math.max(0, vehicleInstance.wheelCount)

  if (!chassisBody || wheelCount <= 0 || !points || points.length < 2) {
    return createControlFallbackResult(state)
  }

  // 读取车身当前世界坐标位置和姿态，作为本帧控制计算的输入。
  purePursuitChassisPosition.set(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z)
  purePursuitChassisQuaternion
    .set(chassisBody.quaternion.x, chassisBody.quaternion.y, chassisBody.quaternion.z, chassisBody.quaternion.w)
    .normalize()

  // 将车辆定义的前向轴转换到世界坐标系，得到车头实际朝向。
  forwardWorld.copy(vehicleInstance.axisForward)
  forwardWorld.applyQuaternion(purePursuitChassisQuaternion)
  // 纯跟踪只在水平面上工作，因此将 Y 分量清零后重新归一化。
  forwardWorld.y = 0
  if (forwardWorld.lengthSq() < 1e-10) {
    forwardWorld.set(1, 0, 0)
  }
  forwardWorld.normalize()

  const currentPosition = purePursuitChassisPosition
  const currentY = currentPosition.y
  const currentVelocity = chassisBody.velocity
  const forwardSpeed = currentVelocity.x * forwardWorld.x + currentVelocity.y * forwardWorld.y + currentVelocity.z * forwardWorld.z
  const longitudinalState = getLongitudinalState(state)
  const steeringState = getSteeringState(state)
  const governorState = getGovernorState(state)
  longitudinalState.forwardSpeedMps = forwardSpeed
  longitudinalState.reverseActive = false

  // 根据当前速度与配置计算前视距离：速度越高，前视距离通常越大。
  const lookaheadDistance = resolvePathFollowLookaheadDistance({
    speedMps: Math.max(Math.abs(forwardSpeed), Math.max(0, Number.isFinite(speedMps) ? speedMps : 0)),
    baseMeters: pursuitProps.lookaheadBaseMeters,
    speedGain: pursuitProps.lookaheadSpeedGain,
    minMeters: pursuitProps.lookaheadMinMeters,
    maxMeters: pursuitProps.lookaheadMaxMeters,
  })

  // 在 XZ 平面上采样路线，得到最近点和前视点；纯跟踪核心就是朝前视点转向。
  const previewSample = resolvePathFollowSample({
    points,
    loop,
    currentPosition,
    lookaheadDistance,
    mode: 'xz',
    outLookaheadPoint: purePursuitLookaheadPoint,
    outClosestPoint: purePursuitClosestPoint,
  })

  // 如果路线无效，则直接施加安全制动并退出，避免车辆失控。
  if (!previewSample || previewSample.polylineData.totalLength <= 1e-6) {
    holdVehicleBrakeSafe({ vehicleInstance, brakeForce: vehicleProps.brakeForceMax * PURE_PURSUIT_STOP_HOLD_BRAKE_MULTIPLIER })
    return createControlFallbackResult(state)
  }

  // 计算停车目标点：默认取路线终点，也可通过 stopIndex 指定其他点。
  const endIndex = points.length - 1
  const rawStopIndex = typeof stopIndex === 'number' && Number.isFinite(stopIndex) ? Math.floor(stopIndex) : endIndex
  const clampedStopIndex = Math.max(0, Math.min(endIndex, rawStopIndex))
  const stopPoint = points[clampedStopIndex]!
  // 终点的平面距离用于减速、刹车和最终停车判断。
  const distanceToEnd = getPlanarDistance(currentPosition, stopPoint)
  // 在停止模式下，接近目标且允许 docking 时，进入泊车/对准控制状态。
  const dockActive = modeStopping && pursuitProps.dockingEnabled && distanceToEnd <= pursuitProps.dockStartDistanceMeters

  // 轮距用于将目标点相对于后轴来计算转角，这更符合纯跟踪几何模型。
  const wheelbaseMeters = Math.max(0.01, vehicleProps.wheelbaseMeters)
  purePursuitTargetDelta.copy(previewSample.lookaheadPoint).sub(currentPosition)
  purePursuitTargetDelta.y = 0
  const toTargetLen = purePursuitTargetDelta.length()
  // 若前视点与当前位置过近，则无法稳定计算方向，直接返回当前状态。
  if (!Number.isFinite(toTargetLen) || toTargetLen < 1e-6) {
    return createControlFallbackResult(state)
  }

  // 根据车辆朝向和轮距，估算后轴位置，以后轴为几何参考点来计算目标方向。
  const rearAxleX = currentPosition.x - forwardWorld.x * (wheelbaseMeters * 0.5)
  const rearAxleY = currentY - forwardWorld.y * (wheelbaseMeters * 0.5)
  const rearAxleZ = currentPosition.z - forwardWorld.z * (wheelbaseMeters * 0.5)
  // 重新构造从后轴指向前视点的目标向量。
  purePursuitTargetDelta.copy(previewSample.lookaheadPoint)
  purePursuitTargetDelta.x -= rearAxleX
  purePursuitTargetDelta.y -= rearAxleY
  purePursuitTargetDelta.z -= rearAxleZ
  purePursuitTargetDelta.y = 0
  const targetLen = purePursuitTargetDelta.length()
  if (!Number.isFinite(targetLen) || targetLen < 1e-6) {
    return createControlFallbackResult(state)
  }
  const desiredDir = purePursuitTargetDelta.clone().normalize()
  const lastSteer = getLastSteerRad(state)
  const steeringRad = resolvePurePursuitSteeringRad({
    vehicleProps,
    wheelbaseMeters,
    targetLen,
    forwardWorld,
    desiredDir,
    lastSteerRad: lastSteer,
    deltaSeconds: dt,
  })

  const speed = Number.isFinite(speedMps) ? Math.max(0, speedMps) : 0
  const speedCapMps = params.speedCapMps
  const forwardVelocity = new THREE.Vector3(currentVelocity.x, 0, currentVelocity.z)
  const forwardSignedSpeed = forwardVelocity.dot(forwardWorld)
  const lastUseEngine = longitudinalState.longitudinalUseEngine
  const speedIntegral = typeof longitudinalState.speedIntegral === 'number' ? longitudinalState.speedIntegral : 0
  const speedTarget = resolvePurePursuitLongitudinalControl({
    speedMps: speed,
    speedCapMps,
    steeringRad,
    forwardSignedSpeed,
    speedIntegral,
    lastUseEngine,
    speedGovernorScale: governorState.speedGovernorScale,
    speedGovernorBrakeAssist: governorState.speedGovernorBrakeAssist,
    speedGovernorSmoothedForwardSpeedAbs: governorState.speedGovernorSmoothedForwardSpeedAbs,
    speedGovernorOverHardCap: governorState.speedGovernorOverHardCap,
    pursuitProps,
    vehicleProps,
    deltaSeconds: dt,
    modeStopping,
    distanceToEnd,
    dockActive,
  })
  const brakeForceMax = Number.isFinite(vehicleProps.brakeForceMax) ? Math.max(0, vehicleProps.brakeForceMax) : 0

  let finalSteeringRad = steeringRad
  let engineForce = speedTarget.engineForce
  let brakeForce = speedTarget.brakeForce
  if (dockActive) {
    const dockingOverrides = resolvePurePursuitDockingOverrides({
      dockActive,
      clampStopIndex: clampedStopIndex,
      endIndex,
      points,
      forwardWorld,
      chassisBody,
      pursuitProps,
      vehicleProps,
      vehicleInstance,
      dt,
    })
    if (dockingOverrides) {
      finalSteeringRad = dockingOverrides.steeringRad
      engineForce = dockingOverrides.engineForce
      brakeForce = Math.max(brakeForce, dockingOverrides.brakeForceFloor)
    }
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
      steeringState.lastSteerRad = 0
      longitudinalState.speedIntegral = speedTarget.speedIntegral
      longitudinalState.longitudinalUseEngine = speedTarget.desiredUseEngine
      governorState.speedGovernorScale = speedTarget.speedGovernorScale
      governorState.speedGovernorBrakeAssist = speedTarget.speedGovernorBrakeAssist
      governorState.speedGovernorSmoothedForwardSpeedAbs = speedTarget.speedGovernorSmoothedForwardSpeedAbs
      governorState.speedGovernorOverHardCap = speedTarget.speedGovernorOverHardCap
      longitudinalState.speedTargetMps = 0
      longitudinalState.longitudinalErrorMps = -forwardSignedSpeed
      longitudinalState.lastBrakeForce = brakeForce
      return {
        reachedStop: true,
        steeringRad: 0,
        targetSpeedMps: 0,
      }
    }
  }

  steeringState.lastSteerRad = finalSteeringRad
  longitudinalState.speedIntegral = speedTarget.speedIntegral
  longitudinalState.longitudinalUseEngine = speedTarget.desiredUseEngine
  governorState.speedGovernorScale = speedTarget.speedGovernorScale
  governorState.speedGovernorBrakeAssist = speedTarget.speedGovernorBrakeAssist
  governorState.speedGovernorSmoothedForwardSpeedAbs = speedTarget.speedGovernorSmoothedForwardSpeedAbs
  governorState.speedGovernorOverHardCap = speedTarget.speedGovernorOverHardCap
  longitudinalState.speedTargetMps = speedTarget.speedTargetMps
  longitudinalState.longitudinalErrorMps = speedTarget.speedTargetMps - forwardSignedSpeed
  longitudinalState.lastBrakeForce = brakeForce


  applyPhysicsVehicleWheelControl(vehicle, {
    steeringValue: finalSteeringRad,
    engineForce,
    brakeForce,
    steerableWheelIndices: vehicleInstance.steerableWheelIndices,
  })

  vehicle.autoTourTargetSpeedMps = speedTarget.speedTargetMps
  vehicle.autoTourTargetSteeringRad = finalSteeringRad

  return {
    reachedStop: false,
    steeringRad: finalSteeringRad,
    targetSpeedMps: speedTarget.speedTargetMps,
  }
}

export function applyPurePursuitVehicleControlSafe(params: {
  vehicleInstance: PurePursuitVehicleInstanceLike
  points: THREE.Vector3[]
  loop: boolean
  deltaSeconds: number
  speedMps: number
  speedCapMps?: number
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
