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
const forwardWorld = new THREE.Vector3()
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


  // 获取车辆实体与车身刚体，后续控制都基于这两个对象执行。
  const vehicle = vehicleInstance.vehicle
  const chassisBody = vehicle.chassisBody

  // 将外部传入的 deltaSeconds 规范化为安全值，避免异常帧时间影响控制稳定性。
  const dt = getSafeDeltaSeconds(params.deltaSeconds)
  // 轮子数量必须有效，否则无法执行轮胎转向和动力输出。
  const wheelCount = Math.max(0, vehicleInstance.wheelCount)

  if (!chassisBody || wheelCount <= 0 || !points || points.length < 2) {
    return {
      reachedStop: false,
      steeringRad: typeof state.lastSteerRad === 'number' ? state.lastSteerRad : 0,
      targetSpeedMps: 0,
    }
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
  state.forwardSpeedMps = forwardSpeed
  state.reverseActive = false

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
    return {
      reachedStop: false,
      steeringRad: typeof state.lastSteerRad === 'number' ? state.lastSteerRad : 0,
      targetSpeedMps: 0,
    }
  }

  // 计算停车目标点：默认取路线终点，也可通过 stopIndex 指定其他点。
  const endIndex = points.length - 1
  const rawStopIndex = typeof stopIndex === 'number' && Number.isFinite(stopIndex) ? Math.floor(stopIndex) : endIndex
  const clampedStopIndex = Math.max(0, Math.min(endIndex, rawStopIndex))
  const stopPoint = points[clampedStopIndex]!
  // stopS 是目标点在路径上的弧长位置；环路下可能需要偏移到当前采样位置之后。
  const stopS = resolveRouteVertexS(points, clampedStopIndex, loop)
  let adjustedStopS = stopS
  if (loop && adjustedStopS < previewSample.projection.s) {
    adjustedStopS += previewSample.polylineData.totalLength
  }
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
    return { reachedStop: false, steeringRad: typeof state.lastSteerRad === 'number' ? state.lastSteerRad : 0, targetSpeedMps: 0 }
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
    return { reachedStop: false, steeringRad: typeof state.lastSteerRad === 'number' ? state.lastSteerRad : 0, targetSpeedMps: 0 }
  }
  // 目标方向与车头方向的夹角决定需要向左还是向右打轮。
  const desiredDir = purePursuitTargetDelta.clone().normalize()
  const crossY = forwardWorld.clone().cross(desiredDir).dot(purePursuitUp)
  const dot = THREE.MathUtils.clamp(forwardWorld.dot(desiredDir), -1, 1)
  const alpha = (crossY >= 0 ? 1 : -1) * Math.acos(dot)

  // 读取车辆最大转角限制，避免输出超出物理约束的转向命令。
  const maxSteerRad = THREE.MathUtils.degToRad(Math.max(0, vehicleProps.maxSteerDegrees))
  const safeMaxSteer = Number.isFinite(maxSteerRad) && maxSteerRad > 1e-6 ? maxSteerRad : THREE.MathUtils.degToRad(26)
  // 纯跟踪公式：根据目标角度和目标距离计算理论转角。
  let steeringRad = Math.atan2(2 * wheelbaseMeters * Math.sin(alpha), Math.max(1e-6, targetLen))
  steeringRad = THREE.MathUtils.clamp(steeringRad, -safeMaxSteer, safeMaxSteer)
  // 限制每帧转向变化幅度，减少抖动和突变。
  const lastSteer = typeof state.lastSteerRad === 'number' ? state.lastSteerRad : 0
  const maxSteerStep = THREE.MathUtils.degToRad(Math.max(0, vehicleProps.maxSteerRateDegPerSec)) * dt
  steeringRad = THREE.MathUtils.clamp(steeringRad, lastSteer - maxSteerStep, lastSteer + maxSteerStep)
  state.lastSteerRad = steeringRad

  // 转角越大，说明弯道越急，因此允许的目标速度应越低。
  const steerRatio = safeMaxSteer > 1e-6 ? Math.min(1, Math.abs(steeringRad) / safeMaxSteer) : 0
  const turnFactor = 1 / (1 + Math.max(0, pursuitProps.curvatureSpeedFactor) * steerRatio)
  const componentMaxSpeed = Number.isFinite(pursuitProps.maxSpeedMps) ? pursuitProps.maxSpeedMps : Number.POSITIVE_INFINITY
  const speed = Math.max(0, Math.min(speedMps, componentMaxSpeed))
  // 期望速度由输入速度和弯道降速因子共同决定，同时不低于最小速度。
  let speedTarget = Math.max(pursuitProps.minSpeedMps, speed * turnFactor)
  if (modeStopping) {
    // 停止模式下，再按距离终点的剩余距离进一步降低目标速度。
    const approachSpeed = Math.min(pursuitProps.dockMaxSpeedMps, Math.max(0, distanceToEnd * pursuitProps.dockVelocityKp))
    speedTarget = Math.min(speedTarget, approachSpeed)
  }

  
  // 纵向控制的目标速度与当前前进速度作差，得到速度误差。
  const desiredSpeedSigned = speedTarget
  const planarVelocity = new THREE.Vector3(currentVelocity.x, 0, currentVelocity.z)
  const forwardSignedSpeed = planarVelocity.dot(forwardWorld)
  const speedError = desiredSpeedSigned - forwardSignedSpeed

  // 积分项用于消除长期稳态误差。
  let integral = typeof state.speedIntegral === 'number' ? state.speedIntegral : 0
  integral += speedError * dt
  const integralMax = Math.max(0, pursuitProps.speedIntegralMax)
  integral = integralMax > 0 ? THREE.MathUtils.clamp(integral, -integralMax, integralMax) : 0

  // 当误差很小时，逐步衰减积分，降低来回摆动概率。
  const absSpeedError = Math.abs(speedError)
  if (Number.isFinite(absSpeedError) && absSpeedError <= 0.10) {
    integral *= Math.exp(-1.6 * Math.max(0, dt))
  }
  // 若积分方向与当前误差方向相反，则快速衰减，避免控制“顶牛”。
  if (
    integral !== 0
    && Number.isFinite(absSpeedError)
    && absSpeedError <= 0.20
    && Math.sign(integral) !== Math.sign(speedError)
  ) {
    integral *= Math.exp(-5.0 * Math.max(0, dt))
  }
  state.speedIntegral = integral

  // 通过 PI 控制器将速度误差转换为纵向控制量。
  const control = pursuitProps.speedKp * speedError + pursuitProps.speedKi * integral
  const engineForceMax = Number.isFinite(vehicleProps.engineForceMax) ? Math.max(0, vehicleProps.engineForceMax) : 0
  const brakeForceMax = Number.isFinite(vehicleProps.brakeForceMax) ? Math.max(0, vehicleProps.brakeForceMax) : 0
  const engineForceCmd = THREE.MathUtils.clamp(control * engineForceMax, -engineForceMax, engineForceMax)

  // 根据误差正负判断当前应优先使用油门还是刹车。
  const desiredUseEngine = speedError > 0
  const lastUseEngine = typeof state.longitudinalUseEngine === 'boolean' ? state.longitudinalUseEngine : desiredUseEngine
  let useEngine = lastUseEngine
  if (absSpeedError > 0.06) {
    // 当误差足够大时，快速切换纵向输出模式；误差很小时保持上一状态减少频繁切换。
    useEngine = desiredUseEngine
  }
  state.longitudinalUseEngine = useEngine
  // 调试日志：帮助观察速度误差、控制量及最终油门/刹车选择。
  // 将控制输出拆分为发动机力和刹车力。
  let engineForce = useEngine ? Math.max(0, engineForceCmd) : 0
  let brakeForce = useEngine ? 0 : Math.min(brakeForceMax, Math.max(0, Math.abs(control) * brakeForceMax))

  // 接近终点时提前增加制动，避免进入停车区时速度过高。
  const brakeThreshold = Math.max(pursuitProps.brakeDistanceMinMeters, speed * pursuitProps.brakeDistanceSpeedFactor)
  const shouldBrakeNearEnd = modeStopping && distanceToEnd < brakeThreshold
  if (shouldBrakeNearEnd && !dockActive) {
    brakeForce = Math.max(brakeForce, Math.min(brakeForceMax, brakeForceMax * 0.35))
  }

  // 泊车状态下锁定转向、关闭动力并施加更强的制动力。
  if (dockActive) {
    steeringRad = 0
    engineForce = 0
    brakeForce = Math.max(brakeForce, brakeForceMax * PURE_PURSUIT_STOP_HOLD_BRAKE_MULTIPLIER)

    if (pursuitProps.dockYawEnabled) {
      // 允许在泊车时对齐朝向，使车身姿态更接近路径切线方向。
      const prevIndex = clampedStopIndex > 0 ? clampedStopIndex - 1 : Math.min(clampedStopIndex + 1, endIndex)
      const prev = points[prevIndex]!
      const tanX = stopPoint.x - prev.x
      const tanZ = stopPoint.z - prev.z
      const tanLen = Math.sqrt(tanX * tanX + tanZ * tanZ)
      const yaw = tanLen > 1e-6
        ? Math.atan2(tanX / tanLen, tanZ / tanLen)
        : Math.atan2(forwardWorld.x, forwardWorld.z)
      yawTargetQuat.setFromAxisAngle(purePursuitUp, yaw)
      const alphaYaw = 1 - Math.exp(-Math.max(0, pursuitProps.dockYawSlerpRate) * dt)
      objectWorldQuat.copy(purePursuitChassisQuaternion)
      objectWorldQuat.slerp(yawTargetQuat, clamp01(alphaYaw)).normalize()
      chassisBody.quaternion.x = objectWorldQuat.x
      chassisBody.quaternion.y = objectWorldQuat.y
      chassisBody.quaternion.z = objectWorldQuat.z
      chassisBody.quaternion.w = objectWorldQuat.w
    }

    // 缓和角速度，帮助车辆尽快稳定下来。
    chassisBody.angularVelocity.x *= 0.85
    chassisBody.angularVelocity.y *= 0.6
    chassisBody.angularVelocity.z *= 0.85
  }

  // 将最终控制量下发给车辆物理轮组。
  applyPhysicsVehicleWheelControl(vehicle, {
    steeringValue: steeringRad,
    engineForce,
    brakeForce,
    steerableWheelIndices: vehicleInstance.steerableWheelIndices,
  })

  // 记录本帧目标速度、目标转角与调试点，方便外部界面或日志系统使用。
  vehicle.autoTourTargetSpeedMps = desiredSpeedSigned
  vehicle.autoTourTargetSteeringRad = steeringRad


  if (modeStopping) {
    // 进入最终停车判定：距离足够近且速度足够低时，视为到站。
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

  // 保存纵向误差与刹车输出，供下一帧控制平滑衔接。
  state.longitudinalErrorMps = speedError
  state.lastBrakeForce = brakeForce

  // 返回本帧结果：是否到站、当前转角和目标速度。
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
