import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import {
  FollowCameraController,
  computeFollowLerpAlpha,
  type CameraFollowContext,
  type CameraFollowPlacement,
  type CameraFollowState,
} from './followCameraController'
// Local structural types to avoid tight coupling with component module exports
type SceneNode = any
type SceneNodeComponentState<T> = { props: T } | null | undefined
import type { VehicleComponentProps, RigidbodyComponentProps } from './components'
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
  ensurePhysicsWorld: () => void
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
// 车辆引擎最大推力
const VEHICLE_ENGINE_FORCE = 320
// 车辆最大刹车力
const VEHICLE_BRAKE_FORCE = 42
// 车辆速度软上限（m/s，约30km/h），超过后逐渐限制
const VEHICLE_SPEED_SOFT_CAP = 8.5
// 车辆速度硬上限（m/s，约45km/h），绝对不能超过
const VEHICLE_SPEED_HARD_CAP = 12.5
// 松开油门时的惯性阻尼
const VEHICLE_COASTING_DAMPING = 0.04
// 平滑停车默认阻尼
const VEHICLE_SMOOTH_STOP_DEFAULT_DAMPING = 0.18
// 平滑停车最大阻尼
const VEHICLE_SMOOTH_STOP_MAX_DAMPING = 0.45
// 平滑停车速度阈值
const VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD = 0.14
const VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD_SQ = VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD * VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD
// 平滑停车最终速度
const VEHICLE_SMOOTH_STOP_FINAL_SPEED = 0.05
const VEHICLE_SMOOTH_STOP_FINAL_SPEED_SQ = VEHICLE_SMOOTH_STOP_FINAL_SPEED * VEHICLE_SMOOTH_STOP_FINAL_SPEED
// 平滑停车最小混合比
const VEHICLE_SMOOTH_STOP_MIN_BLEND = 0.25
const isWeChatMiniProgram = Boolean((globalThis as typeof globalThis & { wx?: { getSystemInfoSync?: () => unknown } }).wx
  && typeof (globalThis as typeof globalThis & { wx?: { getSystemInfoSync?: () => unknown } }).wx?.getSystemInfoSync === 'function')
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

  private followCameraVelocityHasSample = false
  private readonly followCameraVelocity = new THREE.Vector3()
  private readonly followCameraVelocityScratch = new THREE.Vector3()
  private readonly followCameraLastAnchor = new THREE.Vector3()

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
    vehicleDimensions: new THREE.Vector3(),
    tempQuaternion: new THREE.Quaternion(),
    tempVector: new THREE.Vector3(),
  }
  private readonly smoothStopState = {
    active: false,
    damping: VEHICLE_SMOOTH_STOP_DEFAULT_DAMPING,
    stopSpeedSq: VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD_SQ,
    initialSpeedSq: VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD_SQ,
  }

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

  get orbitMode(): VehicleDriveOrbitMode {
    return this.bindings.orbitMode.value
  }

  set orbitMode(mode: VehicleDriveOrbitMode) {
    this.bindings.orbitMode.value = mode
  }

  setUiOverride(mode: 'auto' | 'show' | 'hide') {
    this.bindings.uiOverride.value = mode
  }

  requestSmoothStop(options: { damping?: number; stopSpeed?: number; initialSpeed?: number } = {}): void {
    if (!this.state.active) {
      return
    }
    const damping = typeof options.damping === 'number' ? options.damping : VEHICLE_SMOOTH_STOP_DEFAULT_DAMPING
    const stopSpeed = typeof options.stopSpeed === 'number' ? options.stopSpeed : VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD
    const initialSpeed = typeof options.initialSpeed === 'number' && Number.isFinite(options.initialSpeed)
      ? Math.max(options.initialSpeed, stopSpeed)
      : Math.sqrt(this.smoothStopState.stopSpeedSq)
    this.smoothStopState.active = true
    this.smoothStopState.damping = Math.max(
      VEHICLE_COASTING_DAMPING,
      Math.min(VEHICLE_SMOOTH_STOP_MAX_DAMPING, damping),
    )
    this.smoothStopState.stopSpeedSq = Math.max(1e-4, stopSpeed * stopSpeed)
    this.smoothStopState.initialSpeedSq = Math.max(this.smoothStopState.stopSpeedSq, initialSpeed * initialSpeed, 1e-4)
  }

  clearSmoothStop(): void {
    this.smoothStopState.active = false
    this.smoothStopState.initialSpeedSq = VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD_SQ
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
    this.clearSmoothStop()
    this.recomputeInputs()
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
    const { input, inputFlags, bindings } = this
    // Start with any analog inputs (e.g., joystick) then override with digital flags/keyboard when present.
    let throttle = clampAxisScalar(input.throttle)
    let steering = clampAxisScalar(input.steering)
    let brake = clampAxisScalar(input.brake)

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
  }

  prepareTarget(nodeId: string | null | undefined): { success: true; instance: VehicleInstance } | { success: false; message: string } {
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
    if (!vehicleComponent || !rigidbodyComponent) {
      return { success: false, message: '车辆需要同时启用 Rigidbody 与 Vehicle 组件。' }
    }
    this.deps.ensurePhysicsWorld()
    this.deps.ensureVehicleBindingForNode(normalized)
    const instance = this.deps.vehicleInstances.get(normalized)
    const rigidbody = this.deps.rigidbodyInstances.get(normalized)
    const vehicleObject = this.deps.nodeObjectMap.get(normalized) ?? null
    if (!instance || !rigidbody || !vehicleObject) {
      return { success: false, message: '车辆尚未准备就绪，请稍后再试。' }
    }
    return { success: true, instance }
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
    state.vehicle = readiness.instance.vehicle
    state.wheelCount = readiness.instance.wheelCount
    state.steerableWheelIndices = [...readiness.instance.steerableWheelIndices]
    state.sourceEvent = event as unknown
    this.bindings.exitBusy.value = false
    this.cameraMode = 'follow'
    this.bindings.cameraFollowState.initialized = false
    this.resetFollowCameraOffset()
    this.resetInputs()
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
        ;(chassisBody as CANNON.Body & { sleep?: () => void }).sleep?.()
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
        ;(body as CANNON.Body & { sleep?: () => void }).sleep?.()
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
    this.bindings.cameraFollowState.initialized = false
    this.resetFollowCameraOffset()
    this.clearSmoothStop()
    this.followCameraVelocityHasSample = false
    this.followCameraVelocity.set(0, 0, 0)
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

    if (Math.abs(throttle) > 0.05) {
      smoothStop.active = false
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

      // forwardSpeedAbs can be used for conditional logic if needed

      // Smooth speed governor (preferred over directly editing velocity):
      // - scales engine force down to 0 when approaching hard cap
      // - applies a gentle brake assist only when above hard cap
      // This avoids a physics "fight" that can cause oscillation under constant throttle.
      sameDirection = throttleSign !== 0 ? Math.sign(forwardVelocity) === throttleSign : null
      const acceleratingForward = !!(sameDirection && throttleSign !== 0)
      if (acceleratingForward) {
        const range = Math.max(0.1, VEHICLE_SPEED_HARD_CAP - VEHICLE_SPEED_SOFT_CAP)
        const excess = Math.max(0, forwardSpeedAbs - VEHICLE_SPEED_SOFT_CAP)
        const t = Math.min(1, excess / range)
        // Smoothstep (0..1), then invert to get scale (1..0)
        const smooth = t * t * (3 - 2 * t)
        const scaleTarget = Math.max(0, 1 - smooth)
        const scaleAlpha = 1 - Math.exp(-10 * dt)
        this.speedGovernorScale += (scaleTarget - this.speedGovernorScale) * scaleAlpha
        engineForce *= this.speedGovernorScale

        // Brake assist kicks in only after crossing hard cap, and ramps smoothly.
        const over = Math.max(0, forwardSpeedAbs - VEHICLE_SPEED_HARD_CAP)
        const brakeBand = 0.9 // m/s (~3.2km/h)
        const brakeRatio = Math.min(1, over / brakeBand)
        const brakeTarget = brakeRatio * VEHICLE_BRAKE_FORCE * 0.35
        const brakeAlpha = 1 - Math.exp(-8 * dt)
        this.speedGovernorBrakeAssist += (brakeTarget - this.speedGovernorBrakeAssist) * brakeAlpha
      } else {
        // Relax governor when not accelerating forward.
        const relaxAlpha = 1 - Math.exp(-6 * dt)
        this.speedGovernorScale += (1 - this.speedGovernorScale) * relaxAlpha
        this.speedGovernorBrakeAssist += (0 - this.speedGovernorBrakeAssist) * relaxAlpha
      }

      if (Math.abs(throttle) < 0.05) {
        let damping = VEHICLE_COASTING_DAMPING
        if (smoothStop.active) {
          const startSpeedSq = Math.max(1e-4, smoothStop.initialSpeedSq)
          const progress = startSpeedSq > 0 ? 1 - Math.min(1, speedSq / startSpeedSq) : 1
          const eased = progress > 0 ? progress * progress : 0
          const blend = Math.max(VEHICLE_SMOOTH_STOP_MIN_BLEND, Math.min(1, eased))
          const targetDamping = Math.min(smoothStop.damping, VEHICLE_SMOOTH_STOP_MAX_DAMPING)
          damping = THREE.MathUtils.lerp(VEHICLE_COASTING_DAMPING, targetDamping, blend)
        }
        const clampedDamping = Math.min(0.95, Math.max(0, damping))
        const factor = isWeChatMiniProgram
          ? Math.exp(-Math.max(0, -Math.log(1 - clampedDamping) * 60) * dt)
          : 1 - clampedDamping
        velocity.set(velocity.x * factor, velocity.y * factor, velocity.z * factor)
        if (smoothStop.active) {
          const nextSpeedSq = velocity.lengthSquared()
          if (nextSpeedSq <= VEHICLE_SMOOTH_STOP_FINAL_SPEED_SQ) {
            velocity.set(0, 0, 0)
            smoothStop.active = false
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
    const brakeForce = Math.min(VEHICLE_BRAKE_FORCE, Math.max(0, baseBrakeForce + this.speedGovernorBrakeAssist))
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

  resetPose(): boolean {
    const state = this.state
    if (!state.nodeId) {
      return false
    }
    const rigidbody = this.deps.rigidbodyInstances.get(state.nodeId)
    const instance = this.deps.vehicleInstances.get(state.nodeId)
    if (!rigidbody || !instance || !rigidbody.body || !rigidbody.object) {
      return false
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
      temp.seatForward.set(0, 0, -1).applyQuaternion(temp.tempQuaternion)
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

    // Camera velocity: use anchor differencing (planar) + smoothing instead of raw chassis velocity.
    // Physics velocity can include wheel-contact noise which becomes visible as camera micro-jitter.
    if (options.immediate) {
      this.followCameraVelocityHasSample = false
      this.followCameraVelocity.set(0, 0, 0)
      this.followCameraLastAnchor.copy(temp.followAnchor)
      this.followCameraVelocityHasSample = true
    } else if (deltaSeconds > 0 && this.followCameraVelocityHasSample) {
      const dt = Math.max(1e-6, Math.min(0.25, deltaSeconds))
      this.followCameraVelocityScratch
        .copy(temp.followAnchor)
        .sub(this.followCameraLastAnchor)
        .multiplyScalar(1 / dt)
      this.followCameraVelocityScratch.y = 0
      const alpha = computeFollowLerpAlpha(dt, 8)
      this.followCameraVelocity.lerp(this.followCameraVelocityScratch, alpha)
    } else if (!this.followCameraVelocityHasSample && deltaSeconds > 0) {
      this.followCameraVelocity.set(0, 0, 0)
      this.followCameraVelocityHasSample = true
    }
    this.followCameraLastAnchor.copy(temp.followAnchor)

    const updateOrbitLookTween = this.deps.updateOrbitLookTween

    return this.followCameraController.update({
      follow,
      placement,
      anchorWorld: temp.followAnchor,
      desiredForwardWorld: temp.seatForward,
      velocityWorld: this.followCameraVelocity,
      deltaSeconds,
      ctx,
      worldUp: VEHICLE_CAMERA_WORLD_UP,
      distanceScale: this.getFollowDistanceScale(),
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
    const bodyPosition = instance?.vehicle?.chassisBody?.position
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
