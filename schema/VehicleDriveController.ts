import * as THREE from 'three'
import {
  FollowCameraController,
  computeFollowLerpAlpha,
  type CameraFollowContext,
  type CameraFollowPlacement,
  type CameraFollowState,
  type CameraFollowTuning,
} from './followCameraController'
// Local structural types to avoid tight coupling with component module exports
type SceneNode = any
type SceneNodeComponentState<T> = { props: T } | null | undefined
import type { VehicleComponentProps, RigidbodyComponentProps } from './components'
import {
  PURE_PURSUIT_COMPONENT_TYPE,
  clampPurePursuitComponentProps,
  AUTO_TOUR_COMPONENT_TYPE,
  clampAutoTourComponentProps,
} from './components'
import type { BehaviorEventResolution } from './behaviors/runtime'

export type RefLike<T> = { value: T }

export type VehicleDriveCameraMode = 'first-person' | 'follow' | 'free'
export type VehicleDriveOrbitMode = 'follow' | 'free'

export type VehicleDriveControlFlags = {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
  brake: boolean
}

export type VehicleDriveInputState = {
  throttle: number
  steering: number
  brake: number
  analogThrottle?: number
  analogSteering?: number
  analogBrake?: number
}

export type VehicleDriveRuntimeState = {
  active: boolean
  nodeId: string | null
  token: string | null
  vehicle: VehicleDriveVehicle | null
  steerableWheelIndices: number[]
  wheelCount: number
  seatNodeId: string | null
  sourceEvent: unknown | null
}

type VehicleDriveTargetReadiness =
  | { success: true; mode: 'physics'; instance: VehicleInstance; vehicleObject: THREE.Object3D }
  | { success: true; mode: 'transform'; vehicleObject: THREE.Object3D }
  | { success: false; message: string }

export type VehicleDriveVehicle = {
  chassisBody: VehicleDriveChassisBody
  wheelInfos: unknown[]
  applyEngineForce: (force: number, wheelIndex: number) => void
  setSteeringValue: (value: number, wheelIndex: number) => void
  setBrake: (brake: number, wheelIndex: number) => void
}

export type VehicleDriveChassisBody = {
  position: VehicleDriveVec3
  velocity: VehicleDriveVec3
  angularVelocity: VehicleDriveVec3
  quaternion: VehicleDriveQuaternion
  allowSleep?: boolean
  sleepSpeedLimit?: number
  sleepTimeLimit?: number
  sleep?: () => unknown
  wakeUp?: () => unknown
}

export type VehicleDriveVec3 = {
  x: number
  y: number
  z: number
  set: (x: number, y: number, z: number) => unknown
  lengthSquared: () => number
}

export type VehicleDriveQuaternion = { x: number; y: number; z: number; w: number }

export type VehicleDriveCameraRestoreState = {
  hasSnapshot: boolean
  position: THREE.Vector3
  target: THREE.Vector3
  quaternion: THREE.Quaternion
  up: THREE.Vector3
  controlMode: string | null
  isCameraCaged: boolean
  viewMode?: string | null
  viewTargetId?: string | null
  purposeMode?: string | null
}

export type VehicleDriveCameraFollowState = CameraFollowState

export type VehicleFollowPlacement = CameraFollowPlacement

export type VehicleAxisBasis = { right: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 }

export type VehicleInstance = {
  nodeId: string
  vehicle: VehicleDriveVehicle
  wheelCount: number
  steerableWheelIndices: number[]
  wheelBindings?: unknown[]
  forwardAxis?: THREE.Vector3
  axisRight: THREE.Vector3
  axisUp: THREE.Vector3
  axisForward: THREE.Vector3
  axisRightIndex: 0 | 1 | 2
  axisUpIndex: 0 | 1 | 2
  axisForwardIndex: 0 | 1 | 2
  lastChassisPosition?: THREE.Vector3
  hasChassisPositionSample?: boolean
  initialChassisQuaternion?: THREE.Quaternion
}

export type VehicleDriveCameraOptions = { immediate?: boolean; applyOrbitTween?: boolean; followControlsDirty?: boolean }

export type VehicleDriveControllerDeps = {
  vehicleInstances: Map<string, VehicleInstance>
  rigidbodyInstances: Map<string, any>
  nodeObjectMap: Map<string, THREE.Object3D>
  resolveNodeById: (id: string) => SceneNode | null | undefined
  resolveRigidbodyComponent: (node: SceneNode | null | undefined) => SceneNodeComponentState<RigidbodyComponentProps> | null | undefined
  resolveVehicleComponent: (node: SceneNode | null | undefined) => SceneNodeComponentState<VehicleComponentProps> | null | undefined
  isPhysicsEnabled?: () => boolean
  ensureVehicleBindingForNode: (nodeId: string) => void
  normalizeNodeId: (id: string | null | undefined) => string | null
  setCameraViewState?: (mode: string, targetId?: string | null) => void
  setCameraCaging?: (enabled: boolean, options?: { force?: boolean }) => void
  withControlsVerticalFreedom?: <T>(controls: any, callback: () => T) => T
  lockControlsPitchToCurrent?: (controls: any, camera: THREE.PerspectiveCamera) => void
  syncLastFirstPersonStateFromCamera?: () => void
  updateOrbitLookTween?: (delta: number) => void
  onToast?: (message: string) => void
  onResolveBehaviorToken?: (token: string, resolution: BehaviorEventResolution) => void
  followCameraDistanceScale?: number | (() => number)

  // Follow camera fine tuning (optional, typically platform-specific).
  followCameraVelocityLerpSpeed?: number | (() => number)
  followCameraTuning?: Partial<CameraFollowTuning> | (() => Partial<CameraFollowTuning>)

  // Allow host to provide interpolated chassis data (e.g., fixed-step physics interpolation on WeChat).
  resolveChassisWorldPosition?: (nodeId: string, chassisBody: VehicleDriveChassisBody, target: THREE.Vector3) => boolean
  resolveChassisWorldVelocity?: (nodeId: string, chassisBody: VehicleDriveChassisBody, target: THREE.Vector3) => boolean
  onVehicleObjectTransformUpdated?: (nodeId: string, object: THREE.Object3D) => void
}

export type VehicleDriveControllerBindings = {
  state: VehicleDriveRuntimeState
  inputFlags: VehicleDriveControlFlags
  input: VehicleDriveInputState
  cameraMode: RefLike<VehicleDriveCameraMode>
  orbitMode: RefLike<VehicleDriveOrbitMode>
  uiOverride: RefLike<'auto' | 'show' | 'hide'>
  promptBusy: RefLike<boolean>
  exitBusy: RefLike<boolean>
  cameraRestoreState: VehicleDriveCameraRestoreState
  cameraFollowState: VehicleDriveCameraFollowState
  steeringKeyboardValue?: RefLike<number>
}

export type VehicleDriveCameraContext = {
  firstPersonControls?: { object: THREE.Object3D }
  desiredOrbitTarget?: THREE.Vector3
} & CameraFollowContext

type VehicleDriveDebugPayload = Record<string, unknown>

const isWeChatMiniProgram = Boolean((globalThis as typeof globalThis & { wx?: { getSystemInfoSync?: () => unknown } }).wx
  && typeof (globalThis as typeof globalThis & { wx?: { getSystemInfoSync?: () => unknown } }).wx?.getSystemInfoSync === 'function')

function formatVehicleDriveDebugValue(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Number(value.toFixed(3)) : String(value)
  }
  if (Array.isArray(value)) {
    return value.map(item => formatVehicleDriveDebugValue(item))
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return Object.fromEntries(entries.map(([key, entryValue]) => [key, formatVehicleDriveDebugValue(entryValue)]))
  }
  return value
}

function formatVehicleDriveDebugPayload(payload: VehicleDriveDebugPayload): string {
  return JSON.stringify(formatVehicleDriveDebugValue(payload))
}
// 车辆引擎最大推力
// WeChat mini-program: lower acceleration to reduce high-speed hitching/jerk.
const VEHICLE_ENGINE_FORCE = 320
// 车辆最大刹车力
const VEHICLE_BRAKE_FORCE = 42
// Default soft/hard speed caps used when no component-level max is present.
const DEFAULT_VEHICLE_SPEED_SOFT_CAP = 8.5
const DEFAULT_VEHICLE_SPEED_HARD_CAP = 12.5
const VEHICLE_SPEED_GOVERNOR_BRAKE_ENTER_OFFSET = 0.45
const VEHICLE_SPEED_GOVERNOR_BRAKE_EXIT_OFFSET = 0.2
const VEHICLE_SPEED_GOVERNOR_BRAKE_DEADBAND = 0.35
const VEHICLE_SPEED_GOVERNOR_BRAKE_BAND = 1.8
const VEHICLE_SPEED_GOVERNOR_BRAKE_MAX_RATIO = 0.18
// 松开油门时的惯性阻尼
const VEHICLE_COASTING_DAMPING = 0.04
// 平滑停车默认阻尼
const VEHICLE_SMOOTH_STOP_DEFAULT_DAMPING = 0.18
// 平滑停车最大阻尼
const VEHICLE_SMOOTH_STOP_MAX_DAMPING = 0.45
// 松开驱动输入时叠加的轻刹强度比例
const VEHICLE_RELEASE_SMOOTH_STOP_BRAKE_RATIO = 0.22
// 平滑停车速度阈值
const VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD = 0.14
const VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD_SQ = VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD * VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD
// 平滑停车最终速度
const VEHICLE_SMOOTH_STOP_FINAL_SPEED = 0.05
const VEHICLE_SMOOTH_STOP_FINAL_SPEED_SQ = VEHICLE_SMOOTH_STOP_FINAL_SPEED * VEHICLE_SMOOTH_STOP_FINAL_SPEED
// 平滑停车最小混合比
const VEHICLE_SMOOTH_STOP_MIN_BLEND = 0.25
// 释放驱动输入的节流死区
const VEHICLE_SMOOTH_STOP_INPUT_DEADZONE = 0.05
// 最大转向角（弧度）
const VEHICLE_STEER_ANGLE = THREE.MathUtils.degToRad(26)
// 转向开始衰减的速度（m/s）
const VEHICLE_STEER_SOFT_CAP = 4.2
// 转向强烈限制的速度（m/s）
const VEHICLE_STEER_HARD_CAP = 10
const VEHICLE_STEER_SOFT_CAP_SQ = VEHICLE_STEER_SOFT_CAP * VEHICLE_STEER_SOFT_CAP
// 相机世界上方向
const VEHICLE_CAMERA_WORLD_UP = new THREE.Vector3(0, 1, 0)
// 第一人称默认观察距离
const VEHICLE_CAMERA_DEFAULT_LOOK_DISTANCE = 6
// 相机高度兜底值
const VEHICLE_CAMERA_FALLBACK_HEIGHT = 1.35
// 相机高度兜底比例
const VEHICLE_CAMERA_FALLBACK_HEIGHT_RATIO = 0.45
// 下车时横向偏移比例
const VEHICLE_EXIT_LATERAL_RATIO = 0.6
// 下车时前向偏移比例
const VEHICLE_EXIT_FORWARD_RATIO = 0.35
// 下车时竖直偏移比例
const VEHICLE_EXIT_VERTICAL_RATIO = 0.25
// 下车时横向最小偏移
const VEHICLE_EXIT_LATERAL_MIN = 1.25
// 下车时前向最小偏移
const VEHICLE_EXIT_FORWARD_MIN = 1.25
// 下车时竖直最小偏移
const VEHICLE_EXIT_VERTICAL_MIN = 0.6
// 车辆尺寸兜底值
const VEHICLE_SIZE_FALLBACK = { width: 2.4, height: 1.4, length: 4.2 }
// 跟随相机最小距离
const VEHICLE_FOLLOW_DISTANCE_MIN = 1
// 跟随相机最大距离
const VEHICLE_FOLLOW_DISTANCE_MAX = 10
// 跟随相机基于转向输入的即时偏航反馈上限
const VEHICLE_FOLLOW_STEER_LOOK_MAX = THREE.MathUtils.degToRad(14)
// 低于该速度时基本不施加转向视觉偏航
const VEHICLE_FOLLOW_STEER_LOOK_SPEED_THRESHOLD = 0.75
// 达到该速度后使用完整的转向视觉偏航
const VEHICLE_FOLLOW_STEER_LOOK_SPEED_FULL = 5.5
// 转向视觉偏航建立速度（越大越接近即时）
// 松开转向后的回正时间常数（秒）；值越小回正越快
const VEHICLE_FOLLOW_STEER_LOOK_RELEASE_TIME_CONSTANT = 0.22
// 非零目标转向时的跟随时间常数（秒）；值越小越跟手
const VEHICLE_FOLLOW_STEER_LOOK_TRACK_TIME_CONSTANT = 0.08
// 跟随相机高度比例（调高让车辆在画面中更靠下）
const VEHICLE_FOLLOW_HEIGHT_RATIO = 0.7 // 降低相机高度比例
const VEHICLE_FOLLOW_HEIGHT_MIN = 4.0   // 降低相机最小高度
const VEHICLE_FOLLOW_DISTANCE_LENGTH_RATIO = 2.8 // 恢复默认距离比例
const VEHICLE_FOLLOW_DISTANCE_WIDTH_RATIO = 0.4
const VEHICLE_FOLLOW_DISTANCE_DIAGONAL_RATIO = 0.45
const VEHICLE_FOLLOW_TARGET_LIFT_RATIO = 0.3 // 降低目标抬升比例
const VEHICLE_FOLLOW_TARGET_LIFT_MIN = 0.5   // 降低最小抬升
// 目标点前向偏移比例
const VEHICLE_FOLLOW_TARGET_FORWARD_RATIO = 0.82
// 目标点最小前向偏移
const VEHICLE_FOLLOW_TARGET_FORWARD_MIN = 3
// 重置车辆时的抬升高度
const VEHICLE_RESET_LIFT = 0.75
const TRANSFORM_DRIVE_MAX_FORWARD_SPEED = 8.5
const TRANSFORM_DRIVE_MAX_REVERSE_SPEED = 3.8
const TRANSFORM_DRIVE_ACCELERATION = 6.5
const TRANSFORM_DRIVE_REVERSE_ACCELERATION = 4.2
const TRANSFORM_DRIVE_BRAKE_DECELERATION = 11
const TRANSFORM_DRIVE_COAST_DECELERATION = 2.8
const TRANSFORM_DRIVE_STEER_RATE = THREE.MathUtils.degToRad(96)
const TRANSFORM_DRIVE_MIN_STEER_FACTOR = 0.32
const TRANSFORM_DRIVE_MIN_SPEED_EPSILON = 1e-3
const TRANSFORM_DRIVE_DIRECTION_CHANGE_DECELERATION = 9.5
const TRANSFORM_DRIVE_STEER_TRACK_SPEED = 12
const TRANSFORM_DRIVE_STEER_RELEASE_SPEED = 8
const TRANSFORM_DRIVE_STEER_IDLE_FACTOR = 0.18
const TRANSFORM_DRIVE_STEER_FULL_SPEED = 5.5
const TRANSFORM_DRIVE_MAX_REVERSE_SPEED_RATIO = 0.45

function clampAxisScalar(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(-1, Math.min(1, value))
}

function getVehicleApproxDimensions(object: THREE.Object3D | null): { width: number; height: number; length: number } {
  if (!object) {
    return { ...VEHICLE_SIZE_FALLBACK }
  }
  const box = new THREE.Box3().setFromObject(object)
  if (!Number.isFinite(box.min.x) || box.isEmpty()) {
    return { ...VEHICLE_SIZE_FALLBACK }
  }
  const size = box.getSize(new THREE.Vector3())
  return {
    width: Math.max(size.x, VEHICLE_SIZE_FALLBACK.width),
    height: Math.max(size.y, VEHICLE_SIZE_FALLBACK.height),
    length: Math.max(size.z, VEHICLE_SIZE_FALLBACK.length),
  }
}

function computeVehicleFollowPlacement(dimensions: { width: number; height: number; length: number }): VehicleFollowPlacement {
  const lengthComponent = dimensions.length * VEHICLE_FOLLOW_DISTANCE_LENGTH_RATIO
  const widthComponent = dimensions.width * VEHICLE_FOLLOW_DISTANCE_WIDTH_RATIO
  const diagonalComponent = Math.hypot(dimensions.length, dimensions.height) * VEHICLE_FOLLOW_DISTANCE_DIAGONAL_RATIO
  const unclampedDistance = Math.max(VEHICLE_FOLLOW_DISTANCE_MIN, lengthComponent + widthComponent + diagonalComponent)
  const distance = Math.min(unclampedDistance, VEHICLE_FOLLOW_DISTANCE_MAX)
  const heightOffset = Math.max(dimensions.height * VEHICLE_FOLLOW_HEIGHT_RATIO, VEHICLE_FOLLOW_HEIGHT_MIN)
  const targetLift = Math.max(dimensions.height * VEHICLE_FOLLOW_TARGET_LIFT_RATIO, VEHICLE_FOLLOW_TARGET_LIFT_MIN)
  const targetForward = Math.max(dimensions.length * VEHICLE_FOLLOW_TARGET_FORWARD_RATIO, VEHICLE_FOLLOW_TARGET_FORWARD_MIN)
  return { distance, heightOffset, targetLift, targetForward }
}

export class VehicleDriveController {
  private readonly deps: VehicleDriveControllerDeps
  private readonly bindings: VehicleDriveControllerBindings
  private readonly followCameraController = new FollowCameraController()
  private speedGovernorScale = 1
  private speedGovernorBrakeAssist = 0
  private speedGovernorSmoothedForwardSpeedAbs = 0
  private speedGovernorOverHardCap = false

  private followCameraVelocityHasSample = false
  private readonly followCameraVelocity = new THREE.Vector3()
  private readonly followCameraVelocityScratch = new THREE.Vector3()
  private readonly followCameraLastAnchor = new THREE.Vector3()
  private followCameraSteerLookAngle = 0

  private readonly temp = {
    box: new THREE.Box3(),
    size: new THREE.Vector3(),
    seatPosition: new THREE.Vector3(),
    seatUp: new THREE.Vector3(),
    seatForward: new THREE.Vector3(),
    seatRight: new THREE.Vector3(),
    cameraLook: new THREE.Vector3(),
    cameraForward: new THREE.Vector3(),
    cameraRight: new THREE.Vector3(),
    cameraUp: new THREE.Vector3(),
    followAnchor: new THREE.Vector3(),
    followOffset: new THREE.Vector3(),
    followTarget: new THREE.Vector3(),
    followWorldOffset: new THREE.Vector3(),
    followPredicted: new THREE.Vector3(),
    predictionOffset: new THREE.Vector3(),
    planarVelocity: new THREE.Vector3(),
    cameraQuaternionInverse: new THREE.Quaternion(),
    resetQuaternion: new THREE.Quaternion(),
    cameraMatrix: new THREE.Matrix4(),
    euler: new THREE.Euler(0, 0, 0, 'YXZ'),
    vehicleDimensions: new THREE.Vector3(),
    tempQuaternion: new THREE.Quaternion(),
    tempVector: new THREE.Vector3(),
  }
  private readonly transformDriveState = {
    speed: 0,
    yaw: 0,
    steering: 0,
    velocityWorld: new THREE.Vector3(),
    worldPosition: new THREE.Vector3(),
    worldQuaternion: new THREE.Quaternion(),
    localPosition: new THREE.Vector3(),
    parentWorldQuaternion: new THREE.Quaternion(),
  }
  private readonly smoothStopState = {
    active: false,
    damping: VEHICLE_SMOOTH_STOP_DEFAULT_DAMPING,
    maxDamping: VEHICLE_SMOOTH_STOP_MAX_DAMPING,
    minBlend: VEHICLE_SMOOTH_STOP_MIN_BLEND,
    stopSpeedSq: VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD_SQ,
    finalSpeedSq: VEHICLE_SMOOTH_STOP_FINAL_SPEED_SQ,
    initialSpeedSq: VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD_SQ,
  }
  private suppressReleaseSmoothStop = false
  private smoothStopDebugLastSampleAt = 0

  constructor(deps: VehicleDriveControllerDeps, bindings: VehicleDriveControllerBindings) {
    this.deps = deps
    this.bindings = bindings
  }

  get state(): VehicleDriveRuntimeState {
    return this.bindings.state
  }

  get input(): VehicleDriveInputState {
    return this.bindings.input
  }

  get inputFlags(): VehicleDriveControlFlags {
    return this.bindings.inputFlags
  }

  get cameraMode(): VehicleDriveCameraMode {
    return this.bindings.cameraMode.value
  }

  set cameraMode(mode: VehicleDriveCameraMode) {
    this.bindings.cameraMode.value = mode
  }

  resetFollowCameraOffset(): void {
    this.resetVehicleFollowLocalOffset()
  }

  private getFollowDistanceScale(): number {
    const raw = this.deps.followCameraDistanceScale
    const resolved = typeof raw === 'function' ? raw() : raw
    if (typeof resolved !== 'number' || !Number.isFinite(resolved)) {
      return 1
    }
    // Clamp to a safe range to avoid extreme jumps
    return Math.max(0.5, Math.min(3, resolved))
  }

  private getFollowCameraVelocityLerpSpeed(): number {
    const raw = this.deps.followCameraVelocityLerpSpeed
    const resolved = typeof raw === 'function' ? raw() : raw
    if (typeof resolved !== 'number' || !Number.isFinite(resolved)) {
      return 8
    }
    return Math.max(0, Math.min(30, resolved))
  }

  private getFollowCameraTuning(): Partial<CameraFollowTuning> | undefined {
    const raw = this.deps.followCameraTuning
    const resolved = typeof raw === 'function' ? raw() : raw
    if (!resolved || typeof resolved !== 'object') {
      return undefined
    }
    return resolved
  }

  get orbitMode(): VehicleDriveOrbitMode {
    return this.bindings.orbitMode.value
  }

  set orbitMode(mode: VehicleDriveOrbitMode) {
    this.bindings.orbitMode.value = mode
  }

  setUiOverride(mode: 'auto' | 'show' | 'hide') {
    this.bindings.uiOverride.value = mode
  }

  private debugLog(event: string, payload: VehicleDriveDebugPayload): void {
    console.log(`[VehicleDriveController] ${event} ${formatVehicleDriveDebugPayload(payload)}`)
  }

  requestSmoothStop(options: { damping?: number; stopSpeed?: number; finalSpeed?: number; initialSpeed?: number; minBlend?: number; maxDamping?: number } = {}): void {
    if (!this.state.active) {
      return
    }
    const damping = typeof options.damping === 'number' ? options.damping : VEHICLE_SMOOTH_STOP_DEFAULT_DAMPING
    const stopSpeed = typeof options.stopSpeed === 'number' ? options.stopSpeed : VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD
    const finalSpeed = typeof options.finalSpeed === 'number' ? options.finalSpeed : VEHICLE_SMOOTH_STOP_FINAL_SPEED
    const initialSpeed = typeof options.initialSpeed === 'number' && Number.isFinite(options.initialSpeed)
      ? Math.max(options.initialSpeed, stopSpeed)
      : Math.sqrt(this.smoothStopState.stopSpeedSq)
    const maxDamping = typeof options.maxDamping === 'number' ? options.maxDamping : VEHICLE_SMOOTH_STOP_MAX_DAMPING
    const minBlend = typeof options.minBlend === 'number' ? options.minBlend : VEHICLE_SMOOTH_STOP_MIN_BLEND
    this.smoothStopState.active = true
    this.smoothStopState.damping = Math.max(
      VEHICLE_COASTING_DAMPING,
      Math.min(maxDamping, damping),
    )
    this.smoothStopState.maxDamping = Math.max(VEHICLE_COASTING_DAMPING, maxDamping)
    this.smoothStopState.minBlend = THREE.MathUtils.clamp(minBlend, 0, 1)
    this.smoothStopState.stopSpeedSq = Math.max(1e-4, stopSpeed * stopSpeed)
    this.smoothStopState.finalSpeedSq = Math.max(1e-4, finalSpeed * finalSpeed)
    this.smoothStopState.initialSpeedSq = Math.max(this.smoothStopState.stopSpeedSq, initialSpeed * initialSpeed, 1e-4)
    this.smoothStopDebugLastSampleAt = 0
    this.debugLog('requestSmoothStop', {
      nodeId: this.state.nodeId,
      damping: this.smoothStopState.damping,
      maxDamping: this.smoothStopState.maxDamping,
      minBlend: this.smoothStopState.minBlend,
      stopSpeed: Math.sqrt(this.smoothStopState.stopSpeedSq),
      finalSpeed: Math.sqrt(this.smoothStopState.finalSpeedSq),
      initialSpeed: Math.sqrt(this.smoothStopState.initialSpeedSq),
    })
  }

  clearSmoothStop(reason = 'unspecified', payload: VehicleDriveDebugPayload = {}): void {
    const wasActive = this.smoothStopState.active
    this.smoothStopState.active = false
    this.smoothStopState.damping = VEHICLE_SMOOTH_STOP_DEFAULT_DAMPING
    this.smoothStopState.maxDamping = VEHICLE_SMOOTH_STOP_MAX_DAMPING
    this.smoothStopState.minBlend = VEHICLE_SMOOTH_STOP_MIN_BLEND
    this.smoothStopState.stopSpeedSq = VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD_SQ
    this.smoothStopState.finalSpeedSq = VEHICLE_SMOOTH_STOP_FINAL_SPEED_SQ
    this.smoothStopState.initialSpeedSq = VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD_SQ
    this.smoothStopDebugLastSampleAt = 0
    if (wasActive) {
      this.debugLog('clearSmoothStop', {
        nodeId: this.state.nodeId,
        reason,
        ...payload,
      })
    }
  }

  private resetSpeedGovernor(): void {
    this.speedGovernorScale = 1
    this.speedGovernorBrakeAssist = 0
    this.speedGovernorSmoothedForwardSpeedAbs = 0
    this.speedGovernorOverHardCap = false
  }

  private stopVehicleBodyImmediately(vehicle: VehicleDriveVehicle, wheelCount: number, chassisBody: VehicleDriveChassisBody | null): void {
    if (!chassisBody) {
      return
    }
    try {
      chassisBody.wakeUp?.()
    } catch {
      // best-effort
    }
    try {
      for (let index = 0; index < wheelCount; index += 1) {
        vehicle.applyEngineForce(0, index)
        vehicle.setSteeringValue(0, index)
        vehicle.setBrake(VEHICLE_BRAKE_FORCE, index)
      }
    } catch {
      // best-effort
    }
    try {
      chassisBody.allowSleep = true
      chassisBody.sleepSpeedLimit = Math.max(0.05, chassisBody.sleepSpeedLimit ?? 0)
      chassisBody.sleepTimeLimit = Math.max(0.05, chassisBody.sleepTimeLimit ?? 0)
      chassisBody.velocity.set(0, 0, 0)
      chassisBody.angularVelocity.set(0, 0, 0)
      chassisBody.sleep?.()
    } catch {
      // best-effort
    }
  }

  resetInputs(): void {
    const flags = this.inputFlags
    flags.forward = false
    flags.backward = false
    flags.left = false
    flags.right = false
    flags.brake = false
    if (this.bindings.steeringKeyboardValue) {
      this.bindings.steeringKeyboardValue.value = 0
    }
    const input = this.input
    input.throttle = 0
    input.brake = 0
    input.steering = 0
    input.analogThrottle = 0
    input.analogSteering = 0
    input.analogBrake = 0
    this.clearSmoothStop()
    this.suppressReleaseSmoothStop = true
    this.recomputeInputs()
  }

  private maybeTriggerReleaseSmoothStop(previousThrottle: number, previousBrake: number): void {
    if (this.suppressReleaseSmoothStop) {
      this.suppressReleaseSmoothStop = false
      this.debugLog('skipReleaseSmoothStop', {
        nodeId: this.state.nodeId,
        reason: 'suppressedAfterReset',
      })
      return
    }
    if (!this.state.active) {
      this.debugLog('skipReleaseSmoothStop', {
        nodeId: this.state.nodeId,
        reason: 'inactiveDriveState',
      })
      return
    }
    const nextThrottle = Math.abs(this.input.throttle)
    const nextBrake = Math.abs(this.input.brake)
    const wasDriving = Math.abs(previousThrottle) > VEHICLE_SMOOTH_STOP_INPUT_DEADZONE
    const isDriving = nextThrottle > VEHICLE_SMOOTH_STOP_INPUT_DEADZONE
    const wasBraking = Math.abs(previousBrake) > VEHICLE_SMOOTH_STOP_INPUT_DEADZONE
    const isBraking = nextBrake > VEHICLE_SMOOTH_STOP_INPUT_DEADZONE
    if (!wasDriving || isDriving || wasBraking || isBraking) {
      this.debugLog('skipReleaseSmoothStop', {
        nodeId: this.state.nodeId,
        reason: 'releaseConditionsNotMet',
        previousThrottle,
        previousBrake,
        nextThrottle,
        nextBrake,
        wasDriving,
        isDriving,
        wasBraking,
        isBraking,
      })
      return
    }
    const currentSpeed = this.getCurrentSpeed()
    this.debugLog('triggerReleaseImmediateStop', {
      nodeId: this.state.nodeId,
      previousThrottle,
      previousBrake,
      currentSpeed,
    })
    const nodeId = this.state.nodeId
    const instance = nodeId ? this.deps.vehicleInstances.get(nodeId) ?? null : null
    const vehicle = instance?.vehicle ?? null
    const chassisBody = vehicle?.chassisBody ?? null
    if (vehicle && chassisBody) {
      const wheelCount = instance?.wheelCount ?? vehicle.wheelInfos.length
      this.stopVehicleBodyImmediately(vehicle, wheelCount, chassisBody)
      this.transformDriveState.speed = 0
      this.transformDriveState.velocityWorld.set(0, 0, 0)
      this.transformDriveState.yaw = this.transformDriveState.yaw
      this.clearSmoothStop('releaseImmediateStop', {
        currentSpeed,
      })
      return
    }

    this.transformDriveState.speed = 0
    this.transformDriveState.velocityWorld.set(0, 0, 0)
    this.clearSmoothStop('releaseImmediateStop', {
      currentSpeed,
      path: 'transform',
    })
  }

  setControlFlag(action: keyof VehicleDriveControlFlags, active: boolean): void {
    if (!this.state.active) {
      return
    }
    const flags = this.inputFlags
    if (flags[action] === active) {
      return
    }
    flags[action] = active
    if (action === 'forward' && active) {
      flags.backward = false
    }
    if (action === 'backward' && active) {
      flags.forward = false
    }
    this.recomputeInputs()
  }

  recomputeInputs(): void {
    const previousThrottle = this.input.throttle
    const previousBrake = this.input.brake
    const { input, inputFlags, bindings } = this
    // Start with any analog inputs (e.g., joystick) then override with digital flags/keyboard when present.
    let throttle = clampAxisScalar(typeof input.analogThrottle === 'number' ? input.analogThrottle : input.throttle)
    let steering = clampAxisScalar(typeof input.analogSteering === 'number' ? input.analogSteering : input.steering)
    let brake = clampAxisScalar(typeof input.analogBrake === 'number' ? input.analogBrake : input.brake)

    if (inputFlags.forward && !inputFlags.backward) {
      throttle = 1
    } else if (inputFlags.backward && !inputFlags.forward) {
      throttle = -1
    }

    if (bindings.steeringKeyboardValue && bindings.steeringKeyboardValue.value !== 0) {
      steering = clampAxisScalar(bindings.steeringKeyboardValue.value)
    }
    if (inputFlags.left !== inputFlags.right) {
      steering = inputFlags.right ? 1 : -1
    }

    if (inputFlags.brake) {
      brake = 1
    }

    input.throttle = throttle
    input.steering = clampAxisScalar(steering)
    input.brake = clampAxisScalar(brake)
    if (Math.abs(input.throttle) > VEHICLE_SMOOTH_STOP_INPUT_DEADZONE || Math.abs(input.brake) > VEHICLE_SMOOTH_STOP_INPUT_DEADZONE) {
      this.clearSmoothStop('inputReapplied', {
        throttle: input.throttle,
        brake: input.brake,
        steering: input.steering,
      })
    }
    this.maybeTriggerReleaseSmoothStop(previousThrottle, previousBrake)
  }

  getCurrentSpeed(): number {
    const state = this.state
    if (!state.active) {
      return 0
    }
    if (!state.vehicle) {
      return Math.abs(this.transformDriveState.speed)
    }
    const velocity = state.vehicle.chassisBody?.velocity ?? null
    if (!velocity) {
      return 0
    }
    const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z)
    return Number.isFinite(speed) ? speed : 0
  }

  private setObjectWorldPose(object: THREE.Object3D, worldPosition: THREE.Vector3, worldQuaternion: THREE.Quaternion): void {
    if (object.parent) {
      object.parent.updateMatrixWorld(true)
      this.transformDriveState.localPosition.copy(worldPosition)
      object.parent.worldToLocal(this.transformDriveState.localPosition)
      object.position.copy(this.transformDriveState.localPosition)
      object.parent.getWorldQuaternion(this.transformDriveState.parentWorldQuaternion)
      this.transformDriveState.parentWorldQuaternion.invert()
      object.quaternion.copy(this.transformDriveState.parentWorldQuaternion.multiply(worldQuaternion))
    } else {
      object.position.copy(worldPosition)
      object.quaternion.copy(worldQuaternion)
    }
    object.updateMatrixWorld(true)
  }

  private notifyVehicleObjectTransformUpdated(nodeId: string, object: THREE.Object3D): void {
    this.deps.onVehicleObjectTransformUpdated?.(nodeId, object)
  }

  private getTransformVehicleObject(nodeId: string | null | undefined): THREE.Object3D | null {
    const normalized = this.deps.normalizeNodeId(nodeId)
    if (!normalized) {
      return null
    }
    return this.deps.nodeObjectMap.get(normalized) ?? null
  }

  private extractWorldYawRadians(object: THREE.Object3D): number {
    object.updateMatrixWorld(true)
    object.getWorldQuaternion(this.temp.tempQuaternion)
    this.temp.euler.setFromQuaternion(this.temp.tempQuaternion)
    return Number.isFinite(this.temp.euler.y) ? this.temp.euler.y : 0
  }

  private initializeTransformDrive(object: THREE.Object3D): void {
    this.transformDriveState.speed = 0
    this.transformDriveState.steering = 0
    this.transformDriveState.velocityWorld.set(0, 0, 0)
    this.transformDriveState.yaw = this.extractWorldYawRadians(object)
  }

  private resolveTransformDriveSpeedCaps(nodeId: string): { forward: number; reverse: number } {
    let forward = TRANSFORM_DRIVE_MAX_FORWARD_SPEED
    try {
      const node = this.deps.resolveNodeById(nodeId) ?? null
      if (node) {
        const pureComp = node.components?.[PURE_PURSUIT_COMPONENT_TYPE] as any
        if (pureComp && pureComp.enabled) {
          const pureProps = clampPurePursuitComponentProps(pureComp.props ?? null)
          if (Number.isFinite(pureProps.maxSpeedMps) && pureProps.maxSpeedMps > 0) {
            forward = Math.min(forward, pureProps.maxSpeedMps)
          }
        }
        const autoComp = node.components?.[AUTO_TOUR_COMPONENT_TYPE] as any
        if (autoComp && autoComp.enabled) {
          const autoProps = clampAutoTourComponentProps(autoComp.props ?? null)
          if (Number.isFinite(autoProps.maxSpeedMps) && autoProps.maxSpeedMps > 0) {
            forward = Math.min(forward, autoProps.maxSpeedMps)
          }
        }
      }
    } catch {
      forward = TRANSFORM_DRIVE_MAX_FORWARD_SPEED
    }

    forward = Math.max(2.5, forward)
    const reverse = Math.max(1.5, Math.min(TRANSFORM_DRIVE_MAX_REVERSE_SPEED, forward * TRANSFORM_DRIVE_MAX_REVERSE_SPEED_RATIO))
    return { forward, reverse }
  }

  prepareTarget(nodeId: string | null | undefined): VehicleDriveTargetReadiness {
    const normalized = this.deps.normalizeNodeId(nodeId)
    if (!normalized) {
      return { success: false, message: '缺少车辆节点' }
    }
    const nodeState = this.deps.resolveNodeById(normalized)
    if (!nodeState) {
      return { success: false, message: '车辆节点不存在。' }
    }
    const vehicleComponent = this.deps.resolveVehicleComponent(nodeState)
    const rigidbodyComponent = this.deps.resolveRigidbodyComponent(nodeState)
    const physicsEnabled = this.deps.isPhysicsEnabled?.() !== false
    if (!vehicleComponent) {
      return { success: false, message: '车辆需要启用 Vehicle 组件。' }
    }
    const vehicleObject = this.deps.nodeObjectMap.get(normalized) ?? null
    if (!vehicleObject) {
      return { success: false, message: '车辆尚未准备就绪，请稍后再试。' }
    }
    if (!rigidbodyComponent || !physicsEnabled) {
      return { success: true, mode: 'transform', vehicleObject }
    }
    this.deps.ensureVehicleBindingForNode(normalized)
    const instance = this.deps.vehicleInstances.get(normalized)
    if (!instance) {
      return { success: false, message: '车辆尚未准备就绪，请稍后再试。' }
    }
    return { success: true, mode: 'physics', instance, vehicleObject }
  }

  snapshotCamera(ctx: VehicleDriveCameraContext): void {
    const restore = this.bindings.cameraRestoreState
    if (!ctx.camera) {
      restore.hasSnapshot = false
      return
    }
    restore.position.copy(ctx.camera.position)
    restore.quaternion.copy(ctx.camera.quaternion)
    restore.up.copy(ctx.camera.up)
    if (ctx.mapControls) {
      restore.target.copy(ctx.mapControls.target)
    }
    restore.hasSnapshot = true
  }

  restoreCamera(ctx: VehicleDriveCameraContext): void {
    const restore = this.bindings.cameraRestoreState
    if (!ctx.camera || !restore.hasSnapshot) {
      if (this.deps.setCameraCaging) {
        this.deps.setCameraCaging(false)
      }
      restore.hasSnapshot = false
      return
    }
    ctx.camera!.position.copy(restore.position)
    ctx.camera!.up.copy(restore.up)
    ctx.camera!.quaternion.copy(restore.quaternion)
    ctx.camera!.updateMatrixWorld(true)
    if (ctx.mapControls) {
      ctx.mapControls.target.copy(restore.target)
      ctx.mapControls.update?.()
    } else {
      ctx.camera!.lookAt(restore.target)
    }

    if (this.deps.lockControlsPitchToCurrent && ctx.mapControls && ctx.camera) {
      this.deps.lockControlsPitchToCurrent(ctx.mapControls, ctx.camera)
    }
    if (this.deps.setCameraCaging) {
      this.deps.setCameraCaging(restore.isCameraCaged)
    }
    if (this.deps.setCameraViewState) {
      this.deps.setCameraViewState(restore.viewMode ?? 'level', restore.viewTargetId ?? null)
    }
    restore.hasSnapshot = false
  }

  startDrive(event: { token?: string | null; nodeId?: string | null; targetNodeId?: string | null; seatNodeId?: string | null }, ctx: VehicleDriveCameraContext): { success: true } | { success: false; message: string } {
    const targetNodeId = this.deps.normalizeNodeId(event.targetNodeId ?? event.nodeId)
    if (!targetNodeId) {
      return { success: false, message: '缺少驾驶目标' }
    }
    const readiness = this.prepareTarget(targetNodeId)
    if (!readiness.success) {
      return readiness
    }
    this.snapshotCamera(ctx)
    const seatNodeId = this.deps.normalizeNodeId(event.seatNodeId)
    const state = this.state
    state.active = true
    state.nodeId = targetNodeId
    state.seatNodeId = seatNodeId
    state.token = event.token ?? null
    if (readiness.mode === 'physics') {
      state.vehicle = readiness.instance.vehicle
      state.wheelCount = readiness.instance.wheelCount
      state.steerableWheelIndices = [...readiness.instance.steerableWheelIndices]
    } else {
      state.vehicle = null
      state.wheelCount = 0
      state.steerableWheelIndices = []
      this.initializeTransformDrive(readiness.vehicleObject)
    }
    state.sourceEvent = event as unknown
    this.bindings.exitBusy.value = false
    this.cameraMode = 'follow'
    this.bindings.cameraFollowState.initialized = false
    this.followCameraSteerLookAngle = 0
    this.resetFollowCameraOffset()
    this.resetInputs()
    this.resetSpeedGovernor()
    if (this.deps.setCameraViewState) {
      this.deps.setCameraViewState('watching', targetNodeId)
    }
    if (this.deps.setCameraCaging) {
      this.deps.setCameraCaging(true)
    }
    this.setUiOverride('show')
    return { success: true }
  }

  stopDrive(options: { resolution?: BehaviorEventResolution; preserveCamera?: boolean } = {}, ctx?: VehicleDriveCameraContext): void {
    const state = this.state
    if (!state.active) {
      return
    }

    const nodeId = state.nodeId
    const token = state.token
    const instance = nodeId ? this.deps.vehicleInstances.get(nodeId) ?? null : null
    const chassisBody = instance?.vehicle?.chassisBody ?? null
    // (Removed unused debug snapshots)
    // stopDrive: begin (debug logs removed)

    // --- HARD STOP ---
    // RaycastVehicle keeps last engine/brake/steer values if we stop calling it.
    // Clear all control state and forcibly stop the chassis body to guarantee that exiting drive leaves the vehicle static.
    this.resetInputs()
    this.resetSpeedGovernor()
    if (instance?.vehicle) {
      try {
        const vehicle = instance.vehicle
        const wheelCount = Math.max(0, instance.wheelCount ?? vehicle.wheelInfos?.length ?? 0)
        for (let i = 0; i < wheelCount; i += 1) {
          vehicle.applyEngineForce(0, i)
          vehicle.setSteeringValue(0, i)
          vehicle.setBrake(VEHICLE_BRAKE_FORCE, i)
        }
      } catch {
        // best-effort
      }
    }
    if (chassisBody) {
      try {
        chassisBody.allowSleep = true
        // Treat tiny residual jitter as sleep-eligible.
        chassisBody.sleepSpeedLimit = Math.max(0.05, chassisBody.sleepSpeedLimit ?? 0)
        chassisBody.sleepTimeLimit = Math.max(0.05, chassisBody.sleepTimeLimit ?? 0)
        chassisBody.velocity.set(0, 0, 0)
        chassisBody.angularVelocity.set(0, 0, 0)
        chassisBody.sleep?.()
      } catch {
        // best-effort
      }
    }
    // Some runtimes use rigidbodyInstances as the authoritative body; also stop it to avoid drift.
    const rigidbodyEntry = nodeId ? (this.deps.rigidbodyInstances.get(nodeId) ?? null) : null
    const body = rigidbodyEntry?.body ?? null
    if (body) {
      try {
        body.allowSleep = true
        body.sleepSpeedLimit = Math.max(0.05, body.sleepSpeedLimit ?? 0)
        body.sleepTimeLimit = Math.max(0.05, body.sleepTimeLimit ?? 0)
        body.velocity.set(0, 0, 0)
        body.angularVelocity.set(0, 0, 0)
        body.sleep?.()
      } catch {
        // best-effort
      }
    }
    state.active = false
    state.nodeId = null
    state.seatNodeId = null
    state.token = null
    state.vehicle = null
    state.steerableWheelIndices = []
    state.wheelCount = 0
    state.sourceEvent = null
    this.transformDriveState.speed = 0
    this.transformDriveState.yaw = 0
    this.transformDriveState.steering = 0
    this.transformDriveState.velocityWorld.set(0, 0, 0)
    this.bindings.cameraFollowState.initialized = false
    this.resetFollowCameraOffset()
    this.clearSmoothStop()
    this.followCameraVelocityHasSample = false
    this.followCameraVelocity.set(0, 0, 0)
    this.followCameraSteerLookAngle = 0
    this.bindings.exitBusy.value = false
    this.cameraMode = 'first-person'
    if (this.deps.setCameraCaging) {
      this.deps.setCameraCaging(false, { force: true })
    }
    if (!options.preserveCamera && ctx) {
      this.restoreCamera(ctx)
    }
    this.setUiOverride('hide')
    if (token && this.deps.onResolveBehaviorToken) {
      this.deps.onResolveBehaviorToken(token, options.resolution ?? { type: 'continue' })
    }

    // stopDrive: end (debug logs removed)
  }

  applyForces(deltaSeconds?: number): void {
    const state = this.state
    if (!state.active || !state.nodeId) {
      return
    }
    if (!state.vehicle || this.deps.isPhysicsEnabled?.() === false) {
      if (state.vehicle && this.deps.isPhysicsEnabled?.() === false) {
        const vehicleObject = this.deps.nodeObjectMap.get(state.nodeId) ?? null
        if (vehicleObject) {
          this.initializeTransformDrive(vehicleObject)
          state.vehicle = null
          state.wheelCount = 0
          state.steerableWheelIndices = []
        }
      }
      this.applyTransformDrive(state.nodeId, deltaSeconds)
      return
    }
    const instance = this.deps.vehicleInstances.get(state.nodeId)
    if (!instance) {
      return
    }
    const vehicle = instance.vehicle
    const chassisBody = vehicle.chassisBody ?? null
    const velocity = chassisBody?.velocity ?? null
    const throttle = this.input.throttle
    const steeringInput = this.input.steering
    const brakeInput = this.input.brake
    const smoothStop = this.smoothStopState

    if (Math.abs(throttle) > 0.05 && smoothStop.active) {
      this.clearSmoothStop('physicsThrottleReapplied', {
        throttle,
        brakeInput,
        steeringInput,
      })
    }
    const engineForceRaw = throttle * VEHICLE_ENGINE_FORCE
    let engineForce = engineForceRaw
    let speedSq = 0
    let forwardVelocity: number | null = null
    let forwardSpeedAbs = 0
    let sameDirection: boolean | null = null

    if (velocity && chassisBody && instance.axisForward) {
      speedSq = velocity.lengthSquared()
      const throttleSign = Math.sign(throttle)

      const dt = typeof deltaSeconds === 'number' && Number.isFinite(deltaSeconds)
        ? Math.max(0, Math.min(0.25, deltaSeconds))
        : 1 / 60

      // Compute forward velocity once. Using total speed (|v|) for limiting can cause oscillation
      // if there's small lateral/vertical velocity noise at high speed.
      this.temp.tempQuaternion.set(
        chassisBody.quaternion.x,
        chassisBody.quaternion.y,
        chassisBody.quaternion.z,
        chassisBody.quaternion.w,
      )
      const forwardWorld = this.temp.cameraForward
      forwardWorld.copy(instance.axisForward).normalize()
      if (forwardWorld.lengthSq() < 1e-6) {
        forwardWorld.set(0, 0, 1)
      }
      forwardWorld.applyQuaternion(this.temp.tempQuaternion).normalize()
      forwardVelocity = velocity.x * forwardWorld.x + velocity.y * forwardWorld.y + velocity.z * forwardWorld.z
      forwardSpeedAbs = Math.abs(forwardVelocity)

      // Smooth speed reading to avoid tiny physics noise causing visible push-pull near caps.
      const speedSmoothAlpha = 1 - Math.exp(-6 * dt)
      this.speedGovernorSmoothedForwardSpeedAbs += (forwardSpeedAbs - this.speedGovernorSmoothedForwardSpeedAbs) * speedSmoothAlpha
      const speedForGovernor = Math.max(forwardSpeedAbs, this.speedGovernorSmoothedForwardSpeedAbs)

      // forwardSpeedAbs can be used for conditional logic if needed

      // Smooth speed governor (preferred over directly editing velocity):
      // - scales engine force down to 0 when approaching hard cap
      // - applies a gentle brake assist only when above hard cap
      // This avoids a physics "fight" that can cause oscillation under constant throttle.
      sameDirection = throttleSign !== 0 ? Math.sign(forwardVelocity) === throttleSign : null
      const acceleratingForward = !!(sameDirection && throttleSign !== 0)
        
      // Determine per-node soft/hard speed caps. If a PurePursuit or AutoTour component
      // defines `maxSpeedMps`, use it to cap soft/hard limits for the currently-driven node.
      let softCap = DEFAULT_VEHICLE_SPEED_SOFT_CAP
      let hardCap = DEFAULT_VEHICLE_SPEED_HARD_CAP
      try {
        const node = state.nodeId ? this.deps.resolveNodeById(state.nodeId) ?? null : null
        if (node) {
          const pureComp = node.components?.[PURE_PURSUIT_COMPONENT_TYPE] as any
          if (pureComp && pureComp.enabled) {
            const pp = clampPurePursuitComponentProps(pureComp.props ?? null)
            if (Number.isFinite(pp.maxSpeedMps)) {
              softCap = Math.max(softCap, pp.maxSpeedMps)
              hardCap = Math.max(hardCap, pp.maxSpeedMps)
            }
          }
          const autoComp = node.components?.[AUTO_TOUR_COMPONENT_TYPE] as any
          if (autoComp && autoComp.enabled) {
            const at = clampAutoTourComponentProps(autoComp.props ?? null)
            if (Number.isFinite(at.maxSpeedMps)) {
              softCap = Math.max(softCap, at.maxSpeedMps)
              hardCap = Math.max(hardCap, at.maxSpeedMps)
            }
          }
        }
      } catch {
        // best-effort: fallback to defaults on any lookup/clamp error
        softCap = DEFAULT_VEHICLE_SPEED_SOFT_CAP
        hardCap = DEFAULT_VEHICLE_SPEED_HARD_CAP
      }
      if (acceleratingForward) {
        const range = Math.max(0.1, hardCap - softCap)
        const excess = Math.max(0, speedForGovernor - softCap)
        const t = Math.min(1, excess / range)
        // Smoothstep (0..1), then invert to get scale (1..0)
        const smooth = t * t * (3 - 2 * t)
        const scaleTarget = Math.max(0, 1 - smooth)
        const scaleAlpha = 1 - Math.exp(-14 * dt)
        this.speedGovernorScale += (scaleTarget - this.speedGovernorScale) * scaleAlpha
        engineForce *= this.speedGovernorScale

        // Brake assist is only for sustained overspeed after engine force has already been scaled down.
        // Keep a dead-band above the hard cap so the vehicle settles instead of point-braking.
        const hardCapEnter = hardCap + VEHICLE_SPEED_GOVERNOR_BRAKE_ENTER_OFFSET
        const hardCapExit = hardCap + VEHICLE_SPEED_GOVERNOR_BRAKE_EXIT_OFFSET
        if (!this.speedGovernorOverHardCap) {
          if (speedForGovernor > hardCapEnter) {
            this.speedGovernorOverHardCap = true
          }
        } else if (speedForGovernor < hardCapExit) {
          this.speedGovernorOverHardCap = false
        }
        const over = this.speedGovernorOverHardCap
          ? Math.max(0, speedForGovernor - (hardCap + VEHICLE_SPEED_GOVERNOR_BRAKE_DEADBAND))
          : 0
        const brakeRatio = Math.min(1, over / VEHICLE_SPEED_GOVERNOR_BRAKE_BAND)
        const brakeTarget = brakeRatio * VEHICLE_BRAKE_FORCE * VEHICLE_SPEED_GOVERNOR_BRAKE_MAX_RATIO
        const brakeAlpha = 1 - Math.exp(-4 * dt)
        this.speedGovernorBrakeAssist += (brakeTarget - this.speedGovernorBrakeAssist) * brakeAlpha
      } else {
        // Relax governor when not accelerating forward.
        const relaxAlpha = 1 - Math.exp(-6 * dt)
        this.speedGovernorScale += (1 - this.speedGovernorScale) * relaxAlpha
        this.speedGovernorBrakeAssist += (0 - this.speedGovernorBrakeAssist) * relaxAlpha
        this.speedGovernorOverHardCap = false
      }

      if (Math.abs(throttle) < 0.05) {
        let damping = VEHICLE_COASTING_DAMPING
        let blend = 0
        let targetDamping = damping
        let releaseBrakeForce = 0
        if (smoothStop.active) {
          const startSpeedSq = Math.max(1e-4, smoothStop.initialSpeedSq)
          const progress = startSpeedSq > 0 ? 1 - Math.min(1, speedSq / startSpeedSq) : 1
          const eased = progress > 0 ? progress * progress : 0
          blend = Math.max(smoothStop.minBlend, Math.min(1, eased))
          targetDamping = Math.min(smoothStop.damping, smoothStop.maxDamping)
          damping = THREE.MathUtils.lerp(VEHICLE_COASTING_DAMPING, targetDamping, blend)
          releaseBrakeForce = VEHICLE_BRAKE_FORCE * VEHICLE_RELEASE_SMOOTH_STOP_BRAKE_RATIO * blend
        }
        const clampedDamping = Math.min(0.95, Math.max(0, damping))
        const factor = isWeChatMiniProgram
          ? Math.exp(-Math.max(0, -Math.log(1 - clampedDamping) * 60) * dt)
          : 1 - clampedDamping
        velocity.set(velocity.x * factor, velocity.y * factor, velocity.z * factor)
        if (smoothStop.active) {
          const nextSpeedSq = velocity.lengthSquared()
          const now = Date.now()
          if (this.smoothStopDebugLastSampleAt === 0 || now - this.smoothStopDebugLastSampleAt >= 120) {
            this.smoothStopDebugLastSampleAt = now
            this.debugLog('smoothStopSamplePhysics', {
              nodeId: state.nodeId,
              speedBefore: Math.sqrt(Math.max(0, speedSq)),
              speedAfter: Math.sqrt(Math.max(0, nextSpeedSq)),
              damping,
              factor,
              blend,
              targetDamping,
              releaseBrakeForce,
              brakeInput,
              throttle,
              finalSpeed: Math.sqrt(smoothStop.finalSpeedSq),
              velocity: {
                x: velocity.x,
                y: velocity.y,
                z: velocity.z,
              },
            })
          }
          if (nextSpeedSq <= smoothStop.finalSpeedSq) {
            this.stopVehicleBodyImmediately(vehicle, instance.wheelCount ?? vehicle.wheelInfos.length, chassisBody)
            this.clearSmoothStop('physicsFinalSnap', {
              speedAfter: Math.sqrt(Math.max(0, nextSpeedSq)),
              finalSpeed: Math.sqrt(smoothStop.finalSpeedSq),
            })
            speedSq = 0
          } else {
            speedSq = nextSpeedSq
          }
        } else {
          speedSq = velocity.lengthSquared()
        }
      }

    }
    let steeringValue = steeringInput * VEHICLE_STEER_ANGLE
    if (speedSq > VEHICLE_STEER_SOFT_CAP_SQ) {
      const speed = Math.sqrt(speedSq)
      const range = Math.max(0.1, VEHICLE_STEER_HARD_CAP - VEHICLE_STEER_SOFT_CAP)
      const excess = Math.min(Math.max(0, speed - VEHICLE_STEER_SOFT_CAP), range)
      const slowRatio = Math.min(1, excess / range)
      steeringValue *= 1 - 0.65 * slowRatio
    }
    const baseBrakeForce = brakeInput * VEHICLE_BRAKE_FORCE
    const releaseBrakeForce = this.smoothStopState.active
      ? VEHICLE_BRAKE_FORCE * VEHICLE_RELEASE_SMOOTH_STOP_BRAKE_RATIO * this.smoothStopState.minBlend
      : 0
    const brakeForce = Math.min(VEHICLE_BRAKE_FORCE, Math.max(0, baseBrakeForce + this.speedGovernorBrakeAssist + releaseBrakeForce))
    for (let index = 0; index < vehicle.wheelInfos.length; index += 1) {
      vehicle.setBrake(brakeForce, index)
    }
    for (let index = 0; index < vehicle.wheelInfos.length; index += 1) {
      const steerable = instance.steerableWheelIndices.includes(index)
      if (steerable) {
        vehicle.setSteeringValue(steeringValue, index)
        vehicle.applyEngineForce(engineForce, index)
      }
    }
  }

  private applyTransformDrive(nodeId: string, deltaSeconds?: number): void {
    const object = this.getTransformVehicleObject(nodeId)
    if (!object) {
      return
    }
    const dt = typeof deltaSeconds === 'number' && Number.isFinite(deltaSeconds)
      ? Math.max(0, Math.min(0.25, deltaSeconds))
      : 1 / 60
    const throttle = this.input.throttle
    const steeringInput = THREE.MathUtils.clamp(this.input.steering, -1, 1)
    const brakeInput = THREE.MathUtils.clamp(this.input.brake, 0, 1)
    const speedCaps = this.resolveTransformDriveSpeedCaps(nodeId)
    let speed = this.transformDriveState.speed

    const steeringTrackAlpha = 1 - Math.exp(-(Math.abs(steeringInput) > 0.001 ? TRANSFORM_DRIVE_STEER_TRACK_SPEED : TRANSFORM_DRIVE_STEER_RELEASE_SPEED) * dt)
    this.transformDriveState.steering += (steeringInput - this.transformDriveState.steering) * steeringTrackAlpha
    if (Math.abs(this.transformDriveState.steering) < 1e-4) {
      this.transformDriveState.steering = 0
    }

    if (brakeInput > 0.001) {
      speed = THREE.MathUtils.damp(speed, 0, TRANSFORM_DRIVE_BRAKE_DECELERATION * brakeInput, dt)
    } else if (Math.abs(throttle) > 0.05) {
      const acceleratingReverse = throttle < 0
      const throttleSign = Math.sign(throttle)
      const speedSign = Math.sign(speed)
      const accel = acceleratingReverse ? TRANSFORM_DRIVE_REVERSE_ACCELERATION : TRANSFORM_DRIVE_ACCELERATION
      if (speedSign !== 0 && throttleSign !== 0 && speedSign !== throttleSign) {
        speed = THREE.MathUtils.damp(speed, 0, TRANSFORM_DRIVE_DIRECTION_CHANGE_DECELERATION, dt)
      } else {
        speed += throttle * accel * dt
      }
      speed = THREE.MathUtils.clamp(speed, -speedCaps.reverse, speedCaps.forward)
    } else {
      let decel = TRANSFORM_DRIVE_COAST_DECELERATION
      if (this.smoothStopState.active) {
        const releaseBrakeDecel = TRANSFORM_DRIVE_BRAKE_DECELERATION * VEHICLE_RELEASE_SMOOTH_STOP_BRAKE_RATIO * this.smoothStopState.minBlend
        decel = Math.max(
          decel,
          Math.min(
            TRANSFORM_DRIVE_BRAKE_DECELERATION,
            Math.max(this.smoothStopState.damping, VEHICLE_RELEASE_SMOOTH_STOP_BRAKE_RATIO) * TRANSFORM_DRIVE_BRAKE_DECELERATION,
            releaseBrakeDecel,
          ),
        )
      }
      speed = THREE.MathUtils.damp(speed, 0, decel, dt)
    }

    if (Math.abs(speed) < TRANSFORM_DRIVE_MIN_SPEED_EPSILON) {
      speed = 0
    }
    if (this.smoothStopState.active) {
      const now = Date.now()
      if (this.smoothStopDebugLastSampleAt === 0 || now - this.smoothStopDebugLastSampleAt >= 120) {
        this.smoothStopDebugLastSampleAt = now
        this.debugLog('smoothStopSampleTransform', {
          nodeId,
          speed,
          throttle,
          brakeInput,
          damping: this.smoothStopState.damping,
          maxDamping: this.smoothStopState.maxDamping,
          minBlend: this.smoothStopState.minBlend,
          finalSpeed: Math.sqrt(this.smoothStopState.finalSpeedSq),
        })
      }
    }

    const absSpeed = Math.abs(speed)
  const speedRatio = Math.min(1, absSpeed / Math.max(1, speedCaps.forward))
    const steerFactor = THREE.MathUtils.lerp(1, TRANSFORM_DRIVE_MIN_STEER_FACTOR, speedRatio)
  const steerDirection = speed < -TRANSFORM_DRIVE_MIN_SPEED_EPSILON ? -1 : 1
  const steerSpeedBlend = Math.min(1, absSpeed / TRANSFORM_DRIVE_STEER_FULL_SPEED)
  const steerAuthority = THREE.MathUtils.lerp(TRANSFORM_DRIVE_STEER_IDLE_FACTOR, 1, steerSpeedBlend)
  this.transformDriveState.yaw += this.transformDriveState.steering * steerDirection * TRANSFORM_DRIVE_STEER_RATE * steerFactor * steerAuthority * dt

    object.updateMatrixWorld(true)
    object.getWorldPosition(this.transformDriveState.worldPosition)
    this.transformDriveState.worldQuaternion.setFromAxisAngle(VEHICLE_CAMERA_WORLD_UP, this.transformDriveState.yaw)
    this.transformDriveState.velocityWorld.set(
      Math.cos(this.transformDriveState.yaw),
      0,
      -Math.sin(this.transformDriveState.yaw),
    )
    if (this.transformDriveState.velocityWorld.lengthSq() > 1e-8) {
      this.transformDriveState.velocityWorld.normalize().multiplyScalar(speed)
      this.transformDriveState.worldPosition.addScaledVector(this.transformDriveState.velocityWorld, dt)
    } else {
      this.transformDriveState.velocityWorld.set(0, 0, 0)
    }

    this.setObjectWorldPose(object, this.transformDriveState.worldPosition, this.transformDriveState.worldQuaternion)
    this.notifyVehicleObjectTransformUpdated(nodeId, object)
    this.transformDriveState.speed = speed

    if (this.smoothStopState.active && absSpeed * absSpeed <= this.smoothStopState.finalSpeedSq) {
      this.transformDriveState.speed = 0
      this.transformDriveState.velocityWorld.set(0, 0, 0)
      this.clearSmoothStop('transformFinalSnap', {
        speed: absSpeed,
        finalSpeed: Math.sqrt(this.smoothStopState.finalSpeedSq),
      })
    }
  }

  resetPose(): boolean {
    const state = this.state
    if (!state.nodeId) {
      return false
    }
    if (!state.vehicle) {
      const object = this.getTransformVehicleObject(state.nodeId)
      if (!object) {
        return false
      }
      object.updateMatrixWorld(true)
      object.getWorldPosition(this.transformDriveState.worldPosition)
      this.transformDriveState.worldPosition.y += VEHICLE_RESET_LIFT
      this.transformDriveState.yaw = this.extractWorldYawRadians(object)
      this.transformDriveState.worldQuaternion.setFromAxisAngle(VEHICLE_CAMERA_WORLD_UP, this.transformDriveState.yaw)
      this.transformDriveState.speed = 0
      this.transformDriveState.velocityWorld.set(0, 0, 0)
      this.setObjectWorldPose(object, this.transformDriveState.worldPosition, this.transformDriveState.worldQuaternion)
      this.notifyVehicleObjectTransformUpdated(state.nodeId, object)
      this.resetSpeedGovernor()
      this.bindings.cameraFollowState.initialized = false
      return true
    }
    const rigidbody = this.deps.rigidbodyInstances.get(state.nodeId)
    const instance = this.deps.vehicleInstances.get(state.nodeId)
    if (!instance) {
      return false
    }
    if (!rigidbody || !rigidbody.body || !rigidbody.object) {
      const object = this.getTransformVehicleObject(state.nodeId)
      if (!object) {
        return false
      }
      const temp = this.temp
      object.updateMatrixWorld(true)
      object.getWorldPosition(temp.cameraForward)
      const chassisBody = instance.vehicle?.chassisBody ?? null
      const chassisPosition = temp.seatPosition.set(
        chassisBody?.position?.x ?? temp.cameraForward.x,
        chassisBody?.position?.y ?? temp.cameraForward.y,
        chassisBody?.position?.z ?? temp.cameraForward.z,
      )
      chassisPosition.y += VEHICLE_RESET_LIFT
      const sourceQuaternion = temp.tempQuaternion
      if (instance.initialChassisQuaternion) {
        sourceQuaternion.copy(instance.initialChassisQuaternion)
      } else {
        object.getWorldQuaternion(sourceQuaternion)
      }
      const worldForward = temp.seatForward.copy(instance.axisForward).applyQuaternion(sourceQuaternion)
      if (worldForward.lengthSq() < 1e-6) {
        worldForward.set(0, 0, 1)
      }
      worldForward.y = 0
      if (worldForward.lengthSq() < 1e-6) {
        worldForward.set(0, 0, 1)
      } else {
        worldForward.normalize()
      }
      const worldUp = temp.seatUp.set(0, 1, 0)
      const worldRight = temp.seatRight.copy(worldUp).cross(worldForward)
      if (worldRight.lengthSq() < 1e-6) {
        worldRight.set(1, 0, 0)
      } else {
        worldRight.normalize()
      }
      const correctedForward = temp.cameraForward.copy(worldRight).cross(worldUp)
      if (correctedForward.lengthSq() < 1e-6) {
        correctedForward.set(0, 0, 1)
      } else {
        correctedForward.normalize()
      }
      temp.cameraMatrix.makeBasis(worldRight, worldUp, correctedForward)
      temp.resetQuaternion.setFromRotationMatrix(temp.cameraMatrix)
      this.setObjectWorldPose(object, chassisPosition, temp.resetQuaternion)
      this.notifyVehicleObjectTransformUpdated(state.nodeId, object)
      if (chassisBody) {
        chassisBody.position.set(chassisPosition.x, chassisPosition.y, chassisPosition.z)
        chassisBody.velocity.set(0, 0, 0)
        chassisBody.angularVelocity.set(0, 0, 0)
        chassisBody.quaternion.x = temp.resetQuaternion.x
        chassisBody.quaternion.y = temp.resetQuaternion.y
        chassisBody.quaternion.z = temp.resetQuaternion.z
        chassisBody.quaternion.w = temp.resetQuaternion.w
      }
      this.resetSpeedGovernor()
      this.bindings.cameraFollowState.initialized = false
      return true
    }
    const temp = this.temp
    const chassisPosition = temp.seatPosition.set(
      rigidbody.body.position.x,
      rigidbody.body.position.y,
      rigidbody.body.position.z,
    )
    chassisPosition.y += VEHICLE_RESET_LIFT
    const sourceQuaternion = temp.tempQuaternion
    if (instance.initialChassisQuaternion) {
      sourceQuaternion.copy(instance.initialChassisQuaternion)
    } else {
      rigidbody.object.updateMatrixWorld(true)
      rigidbody.object.getWorldQuaternion(sourceQuaternion)
    }
    const worldForward = temp.seatForward.copy(instance.axisForward).applyQuaternion(sourceQuaternion)
    if (worldForward.lengthSq() < 1e-6) {
      worldForward.set(0, 0, 1)
    }
    worldForward.y = 0
    if (worldForward.lengthSq() < 1e-6) {
      worldForward.set(0, 0, 1)
    } else {
      worldForward.normalize()
    }
    const worldUp = temp.seatUp.set(0, 1, 0)
    const worldRight = temp.seatRight.copy(worldUp).cross(worldForward)
    if (worldRight.lengthSq() < 1e-6) {
      worldRight.set(1, 0, 0)
    } else {
      worldRight.normalize()
    }
    const correctedForward = temp.cameraForward.copy(worldRight).cross(worldUp)
    if (correctedForward.lengthSq() < 1e-6) {
      correctedForward.set(0, 0, 1)
    } else {
      correctedForward.normalize()
    }
    temp.cameraMatrix.makeBasis(worldRight, worldUp, correctedForward)
    temp.resetQuaternion.setFromRotationMatrix(temp.cameraMatrix)
    rigidbody.body.position.set(chassisPosition.x, chassisPosition.y, chassisPosition.z)
    rigidbody.body.velocity.set(0, 0, 0)
    rigidbody.body.angularVelocity.set(0, 0, 0)
    rigidbody.body.quaternion.set(
      temp.resetQuaternion.x,
      temp.resetQuaternion.y,
      temp.resetQuaternion.z,
      temp.resetQuaternion.w,
    )
    rigidbody.object.position.copy(chassisPosition)
    rigidbody.object.quaternion.copy(temp.resetQuaternion)
    rigidbody.object.updateMatrixWorld(true)
    this.resetSpeedGovernor()
    this.bindings.cameraFollowState.initialized = false
    return true
  }

  private computeVehicleBasis(seatObject: THREE.Object3D | null, vehicleObject: THREE.Object3D | null, instance: VehicleInstance | null): boolean {
    const temp = this.temp
    const reference = seatObject ?? vehicleObject
    if (!reference) {
      return false
    }
    if (seatObject) {
      seatObject.updateMatrixWorld(true)
      seatObject.getWorldPosition(temp.seatPosition)
    } else if (vehicleObject) {
      this.computeFallbackSeat(vehicleObject, temp.seatPosition)
    } else {
      reference.updateMatrixWorld(true)
      reference.getWorldPosition(temp.seatPosition)
    }
    if (vehicleObject && instance) {
      vehicleObject.updateMatrixWorld(true)
      vehicleObject.getWorldQuaternion(temp.tempQuaternion)
      temp.seatForward.copy(instance.axisForward).applyQuaternion(temp.tempQuaternion)
      temp.seatUp.copy(instance.axisUp).applyQuaternion(temp.tempQuaternion)
    } else {
      reference.updateMatrixWorld(true)
      reference.getWorldQuaternion(temp.tempQuaternion)
      temp.seatForward.set(1, 0, 0).applyQuaternion(temp.tempQuaternion)
      temp.seatUp.set(0, 1, 0).applyQuaternion(temp.tempQuaternion)
    }
    if (temp.seatForward.lengthSq() < 1e-8) {
      temp.seatForward.set(0, 0, -1)
    } else {
      temp.seatForward.normalize()
    }
    if (temp.seatUp.lengthSq() < 1e-8) {
      temp.seatUp.copy(VEHICLE_CAMERA_WORLD_UP)
    } else {
      temp.seatUp.normalize()
    }
    temp.seatRight.copy(temp.seatForward).cross(temp.seatUp)
    if (temp.seatRight.lengthSq() < 1e-8) {
      temp.seatRight.copy(VEHICLE_CAMERA_WORLD_UP).cross(temp.seatForward)
    }
    if (temp.seatRight.lengthSq() < 1e-8) {
      temp.seatRight.set(1, 0, 0)
    } else {
      temp.seatRight.normalize()
    }
    temp.seatUp.crossVectors(temp.seatRight, temp.seatForward)
    if (temp.seatUp.lengthSq() < 1e-8) {
      temp.seatUp.copy(VEHICLE_CAMERA_WORLD_UP)
    } else {
      temp.seatUp.normalize()
    }
    return true
  }

  private computeFallbackSeat(object: THREE.Object3D, target: THREE.Vector3): void {
    const temp = this.temp
    temp.box.makeEmpty()
    temp.box.setFromObject(object)
    if (temp.box.isEmpty()) {
      object.getWorldPosition(target)
      target.addScaledVector(VEHICLE_CAMERA_WORLD_UP, VEHICLE_CAMERA_FALLBACK_HEIGHT)
      return
    }
    temp.box.getCenter(target)
    temp.box.getSize(temp.size)
    const upOffset = Math.max(temp.size.y * VEHICLE_CAMERA_FALLBACK_HEIGHT_RATIO, VEHICLE_CAMERA_FALLBACK_HEIGHT)
    target.addScaledVector(VEHICLE_CAMERA_WORLD_UP, upOffset)
  }

  private resetVehicleFollowLocalOffset(): void {
    const follow = this.bindings.cameraFollowState
    follow.localOffset.set(0, 0, 0)
    follow.hasLocalOffset = false
  }

  updateCamera(delta: number, ctx: VehicleDriveCameraContext, options: VehicleDriveCameraOptions = {}): boolean {
    const state = this.state
    if (!state.active || !ctx.camera) {
      return false
    }
    const vehicleNodeId = this.deps.normalizeNodeId(state.nodeId)
    if (!vehicleNodeId) {
      return false
    }
    const seatNodeId = state.seatNodeId
    const seatObject = seatNodeId ? this.deps.nodeObjectMap.get(seatNodeId) ?? null : null
    const vehicleObject = this.deps.nodeObjectMap.get(vehicleNodeId) ?? null
    const instance = this.deps.vehicleInstances.get(vehicleNodeId) ?? null
    if (!this.computeVehicleBasis(seatObject, vehicleObject, instance)) {
      return false
    }
    if (this.cameraMode === 'follow') {
      return this.updateFollowCamera(vehicleObject, instance, delta, ctx, options)
    }
    if (this.cameraMode === 'first-person') {
      return this.updateFirstPersonCamera(ctx)
    }
    return false
  }

  private updateFollowCamera(
    vehicleObject: THREE.Object3D | null,
    instance: VehicleInstance | null,
    deltaSeconds: number,
    ctx: VehicleDriveCameraContext,
    options: VehicleDriveCameraOptions,
  ): boolean {
    const follow = this.bindings.cameraFollowState
    const temp = this.temp
    const placement = computeVehicleFollowPlacement(getVehicleApproxDimensions(vehicleObject))

    this.computeVehicleFollowAnchor(vehicleObject, instance, temp.seatPosition, temp.followAnchor)

    // Camera velocity: prefer a single stable source for all platforms.
    // Use physics velocity when the host can supply it; otherwise fall back to anchor differencing.
    if (options.immediate) {
      this.followCameraVelocityHasSample = false
      this.followCameraVelocity.set(0, 0, 0)
      this.followCameraLastAnchor.copy(temp.followAnchor)
      this.followCameraVelocityHasSample = true
    } else if (deltaSeconds > 0 && this.followCameraVelocityHasSample) {
      const dt = Math.max(1e-6, Math.min(0.25, deltaSeconds))
      const chassisBody = instance?.vehicle?.chassisBody ?? null
      const nodeId = this.deps.normalizeNodeId(instance?.nodeId)
      const resolvedNodeId = nodeId ?? null
      const resolveVelocity = resolvedNodeId && chassisBody ? this.deps.resolveChassisWorldVelocity : undefined

      if (resolveVelocity && resolveVelocity(resolvedNodeId!, chassisBody!, this.followCameraVelocityScratch)) {
        // Use host-provided velocity when available to keep sampling consistent across platforms.
      } else {
        this.followCameraVelocityScratch
          .copy(temp.followAnchor)
          .sub(this.followCameraLastAnchor)
          .multiplyScalar(1 / dt)
      }
      this.followCameraVelocityScratch.y = 0
      const alpha = computeFollowLerpAlpha(dt, this.getFollowCameraVelocityLerpSpeed())
      this.followCameraVelocity.lerp(this.followCameraVelocityScratch, alpha)
    } else if (!this.followCameraVelocityHasSample && deltaSeconds > 0) {
      this.followCameraVelocity.set(0, 0, 0)
      this.followCameraVelocityHasSample = true
    }
    this.followCameraLastAnchor.copy(temp.followAnchor)

    const desiredFollowForward = temp.cameraForward.copy(temp.seatForward)
    desiredFollowForward.y = 0
    if (desiredFollowForward.lengthSq() < 1e-6) {
      desiredFollowForward.set(0, 0, 1)
    } else {
      desiredFollowForward.normalize()
    }

    const steeringInput = THREE.MathUtils.clamp(this.input.steering, -1, 1)
    const planarSpeed = Math.sqrt(this.followCameraVelocity.x * this.followCameraVelocity.x + this.followCameraVelocity.z * this.followCameraVelocity.z)
    const steerLookRange = Math.max(1e-3, VEHICLE_FOLLOW_STEER_LOOK_SPEED_FULL - VEHICLE_FOLLOW_STEER_LOOK_SPEED_THRESHOLD)
    const steerLookBlend = planarSpeed <= VEHICLE_FOLLOW_STEER_LOOK_SPEED_THRESHOLD
      ? 0
      : Math.min(1, (planarSpeed - VEHICLE_FOLLOW_STEER_LOOK_SPEED_THRESHOLD) / steerLookRange)
    const targetSteerLookAngle = steeringInput * VEHICLE_FOLLOW_STEER_LOOK_MAX * steerLookBlend
    if (options.immediate || deltaSeconds <= 0) {
      this.followCameraSteerLookAngle = targetSteerLookAngle
    } else {
      // Use exponential responses so feel is consistent across variable frame times.
      if (Math.abs(targetSteerLookAngle) <= 1e-5) {
        const releaseAlpha = 1 - Math.exp(-deltaSeconds / Math.max(1e-4, VEHICLE_FOLLOW_STEER_LOOK_RELEASE_TIME_CONSTANT))
        this.followCameraSteerLookAngle += (0 - this.followCameraSteerLookAngle) * releaseAlpha
      } else {
        const trackTime = Math.max(1e-4, VEHICLE_FOLLOW_STEER_LOOK_TRACK_TIME_CONSTANT)
        const trackAlpha = 1 - Math.exp(-deltaSeconds / trackTime)
        this.followCameraSteerLookAngle += (targetSteerLookAngle - this.followCameraSteerLookAngle) * trackAlpha
      }

      // Tiny residuals near center can look like jitter; snap them to zero.
      if (Math.abs(this.followCameraSteerLookAngle) < THREE.MathUtils.degToRad(0.2)) {
        this.followCameraSteerLookAngle = 0
      }
    }

    if (Math.abs(this.followCameraSteerLookAngle) > 1e-4) {
      desiredFollowForward.applyAxisAngle(VEHICLE_CAMERA_WORLD_UP, this.followCameraSteerLookAngle)
      if (desiredFollowForward.lengthSq() > 1e-6) {
        desiredFollowForward.normalize()
      }
    }

    const updateOrbitLookTween = this.deps.updateOrbitLookTween
    const tuning = this.getFollowCameraTuning()

    return this.followCameraController.update({
      follow,
      placement,
      anchorWorld: temp.followAnchor,
      desiredForwardWorld: desiredFollowForward,
      velocityWorld: this.followCameraVelocity,
      deltaSeconds,
      ctx,
      worldUp: VEHICLE_CAMERA_WORLD_UP,
      distanceScale: this.getFollowDistanceScale(),
      ...(tuning ? { tuning } : {}),
      applyOrbitTween: options.applyOrbitTween ?? false,
      followControlsDirty: options.followControlsDirty ?? false,
      immediate: options.immediate ?? false,
      ...(updateOrbitLookTween ? { onUpdateOrbitLookTween: updateOrbitLookTween } : {}),
    })
  }

  private updateFirstPersonCamera(ctx: VehicleDriveCameraContext): boolean {
    const temp = this.temp
    if (!ctx.camera) {
      return false
    }
    ctx.camera.position.copy(temp.seatPosition)
    ctx.camera.up.copy(temp.seatUp)
    ctx.camera.lookAt(temp.cameraLook.copy(temp.seatPosition).addScaledVector(temp.seatForward, VEHICLE_CAMERA_DEFAULT_LOOK_DISTANCE))
    if (ctx.mapControls) {
      ctx.mapControls!.target.copy(temp.cameraLook)
      ctx.mapControls!.update?.()
    }
   
    this.deps.syncLastFirstPersonStateFromCamera?.()
    return true
  }

  private computeVehicleFollowAnchor(
    vehicleObject: THREE.Object3D | null,
    instance: VehicleInstance | null,
    fallbackPosition: THREE.Vector3,
    target: THREE.Vector3,
  ): void {
    const physicsEnabled = this.deps.isPhysicsEnabled?.() !== false
    const chassisBody = instance?.vehicle?.chassisBody ?? null
    const nodeId = this.deps.normalizeNodeId(instance?.nodeId)
    const resolvePosition = physicsEnabled && nodeId && chassisBody ? this.deps.resolveChassisWorldPosition : undefined
    if (nodeId && chassisBody && resolvePosition && resolvePosition(nodeId, chassisBody, target)) {
      return
    }
    const bodyPosition = physicsEnabled ? chassisBody?.position : null
    if (bodyPosition) {
      target.set(bodyPosition.x, bodyPosition.y, bodyPosition.z)
      return
    }
    if (!vehicleObject) {
      target.copy(fallbackPosition)
      return
    }
    const temp = this.temp
    temp.box.makeEmpty()
    temp.box.setFromObject(vehicleObject)
    if (temp.box.isEmpty()) {
      target.copy(fallbackPosition)
      return
    }
    temp.box.getCenter(target)
  }

  alignExitCamera(ctx: VehicleDriveCameraContext): boolean {
    if (!ctx.camera) {
      return false
    }
    const state = this.state
    const vehicleNodeId = this.deps.normalizeNodeId(state.nodeId)
    if (!vehicleNodeId) {
      return false
    }
    const seatNodeId = state.seatNodeId
    const seatObject = seatNodeId ? this.deps.nodeObjectMap.get(seatNodeId) ?? null : null
    const vehicleObject = this.deps.nodeObjectMap.get(vehicleNodeId) ?? null
    const instance = this.deps.vehicleInstances.get(vehicleNodeId) ?? null
    if (!this.computeVehicleBasis(seatObject, vehicleObject, instance)) {
      return false
    }
    const dimensions = getVehicleApproxDimensions(vehicleObject)
    const lateralOffset = Math.max(dimensions.width * VEHICLE_EXIT_LATERAL_RATIO, VEHICLE_EXIT_LATERAL_MIN)
    const verticalOffset = Math.max(dimensions.height * VEHICLE_EXIT_VERTICAL_RATIO, VEHICLE_EXIT_VERTICAL_MIN)
    const forwardOffset = Math.max(dimensions.length * VEHICLE_EXIT_FORWARD_RATIO, VEHICLE_EXIT_FORWARD_MIN)
    this.temp.seatPosition.addScaledVector(this.temp.seatRight, -lateralOffset)
    this.temp.seatPosition.addScaledVector(this.temp.seatUp, verticalOffset)
    this.temp.cameraLook.copy(this.temp.seatPosition).addScaledVector(this.temp.seatForward, forwardOffset)
    ctx.camera!.position.copy(this.temp.seatPosition)
    ctx.camera!.up.copy(this.temp.seatUp)
    ctx.camera!.lookAt(this.temp.cameraLook)
    if (ctx.mapControls) {
      ctx.mapControls.target.copy(this.temp.cameraLook)
      ctx.mapControls.update?.()
    }
    if (this.deps.lockControlsPitchToCurrent && ctx.mapControls && ctx.camera) {
      this.deps.lockControlsPitchToCurrent(ctx.mapControls, ctx.camera)
    }
    return true
  }

  toggleCameraMode(): void {
    this.cameraMode = this.cameraMode === 'follow' ? 'first-person' : 'follow'
  }
}
