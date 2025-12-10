import * as THREE from 'three'
import * as CANNON from 'cannon-es'
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
  vehicle: CANNON.RaycastVehicle | null
  steerableWheelIndices: number[]
  wheelCount: number
  seatNodeId: string | null
  sourceEvent: unknown | null
}

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

export type VehicleDriveCameraFollowState = {
  desiredPosition: THREE.Vector3
  desiredTarget: THREE.Vector3
  currentPosition: THREE.Vector3
  currentTarget: THREE.Vector3
  desiredAnchor: THREE.Vector3
  currentAnchor: THREE.Vector3
  anchorHoldSeconds: number
  lastVelocityDirection: THREE.Vector3
  heading: THREE.Vector3
  initialized: boolean
  localOffset: THREE.Vector3
  hasLocalOffset: boolean
  shouldHoldAnchorForReverse: boolean
}

export type VehicleFollowPlacement = {
  distance: number
  heightOffset: number
  targetLift: number
  targetForward: number
}

export type VehicleAxisBasis = { right: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 }

export type VehicleInstance = {
  nodeId: string
  vehicle: CANNON.RaycastVehicle
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
  setCameraViewState?: (mode: unknown, targetId?: string | null) => void
  setCameraCaging?: (enabled: boolean, options?: { force?: boolean }) => void
  runWithProgrammaticCameraMutation?: (fn: () => void) => void
  lockControlsPitchToCurrent?: (controls: any, camera: THREE.PerspectiveCamera) => void
  syncLastFirstPersonStateFromCamera?: () => void
  updateOrbitLookTween?: (delta: number) => void
  onToast?: (message: string) => void
  onResolveBehaviorToken?: (token: string, resolution: BehaviorEventResolution | { type: string; message?: string }) => void
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
  camera: THREE.PerspectiveCamera | null
  mapControls?: { target: THREE.Vector3; update: () => void; enablePan?: boolean; minDistance?: number; maxDistance?: number }
  firstPersonControls?: { object: THREE.Object3D }
  desiredOrbitTarget?: THREE.Vector3
}

const VEHICLE_ENGINE_FORCE = 320
const VEHICLE_BRAKE_FORCE = 42
const VEHICLE_SPEED_SOFT_CAP = 8.5 // m/s (~30 km/h) before gentle limiting
const VEHICLE_SPEED_HARD_CAP = 12.5 // m/s (~45 km/h) absolute upper bound
const VEHICLE_SPEED_SOFT_CAP_SQ = VEHICLE_SPEED_SOFT_CAP * VEHICLE_SPEED_SOFT_CAP
const VEHICLE_SPEED_HARD_CAP_SQ = VEHICLE_SPEED_HARD_CAP * VEHICLE_SPEED_HARD_CAP
const VEHICLE_SPEED_LIMIT_DAMPING = 0.08
const VEHICLE_COASTING_DAMPING = 0.04
const VEHICLE_SMOOTH_STOP_DEFAULT_DAMPING = 0.28
const VEHICLE_SMOOTH_STOP_MAX_DAMPING = 0.6
const VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD = 0.18
const VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD_SQ = VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD * VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD
const VEHICLE_STEER_ANGLE = THREE.MathUtils.degToRad(26)
const VEHICLE_STEER_SOFT_CAP = 4.2 // m/s speed where steering starts damping
const VEHICLE_STEER_HARD_CAP = 10 // m/s speed where steering is strongly limited
const VEHICLE_STEER_SOFT_CAP_SQ = VEHICLE_STEER_SOFT_CAP * VEHICLE_STEER_SOFT_CAP
const VEHICLE_CAMERA_WORLD_UP = new THREE.Vector3(0, 1, 0)
const VEHICLE_CAMERA_DEFAULT_LOOK_DISTANCE = 6
const VEHICLE_CAMERA_FALLBACK_HEIGHT = 1.35
const VEHICLE_CAMERA_FALLBACK_HEIGHT_RATIO = 0.45
const VEHICLE_EXIT_LATERAL_RATIO = 0.6
const VEHICLE_EXIT_FORWARD_RATIO = 0.35
const VEHICLE_EXIT_VERTICAL_RATIO = 0.25
const VEHICLE_EXIT_LATERAL_MIN = 1.25
const VEHICLE_EXIT_FORWARD_MIN = 1.25
const VEHICLE_EXIT_VERTICAL_MIN = 0.6
const VEHICLE_SIZE_FALLBACK = { width: 2.4, height: 1.4, length: 4.2 }
const VEHICLE_FOLLOW_DISTANCE_MIN = 1
const VEHICLE_FOLLOW_DISTANCE_MAX = 10
const VEHICLE_FOLLOW_HEIGHT_RATIO = 1.35
const VEHICLE_FOLLOW_HEIGHT_MIN = 4.8
const VEHICLE_FOLLOW_DISTANCE_LENGTH_RATIO = 1.8
const VEHICLE_FOLLOW_DISTANCE_WIDTH_RATIO = 0.4
const VEHICLE_FOLLOW_DISTANCE_DIAGONAL_RATIO = 0.35
const VEHICLE_FOLLOW_TARGET_LIFT_RATIO = 0.9
const VEHICLE_FOLLOW_TARGET_LIFT_MIN = 3
const VEHICLE_FOLLOW_POSITION_LERP_SPEED = 8
const VEHICLE_FOLLOW_TARGET_LERP_SPEED = 10
const VEHICLE_FOLLOW_HEADING_LERP_SPEED = 5.5
const VEHICLE_FOLLOW_TARGET_FORWARD_RATIO = 0.55
const VEHICLE_FOLLOW_TARGET_FORWARD_MIN = 1.8
const VEHICLE_FOLLOW_LOOKAHEAD_TIME = 0.18
const VEHICLE_FOLLOW_LOOKAHEAD_DISTANCE_MAX = 3
const VEHICLE_FOLLOW_LOOKAHEAD_MIN_SPEED_SQ = 0.9
const VEHICLE_FOLLOW_ANCHOR_LERP_SPEED = 4.5
const VEHICLE_FOLLOW_BACKWARD_DOT_THRESHOLD = -0.25
const VEHICLE_FOLLOW_FORWARD_RELEASE_DOT = 0.25
const VEHICLE_FOLLOW_COLLISION_LOCK_SPEED_SQ = 1.21
const VEHICLE_FOLLOW_COLLISION_DIRECTION_DOT_THRESHOLD = -0.35
const VEHICLE_FOLLOW_COLLISION_HOLD_TIME = 0.8
const VEHICLE_RESET_LIFT = 0.75
const VEHICLE_CAMERA_MOVING_SPEED_SQ = 0.04

function clampAxisScalar(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(-1, Math.min(1, value))
}

function computeVehicleFollowLerpAlpha(delta: number, speed: number): number {
  if (!Number.isFinite(delta) || delta <= 0) {
    return 0
  }
  if (speed <= 0) {
    return 1
  }
  return 1 - Math.exp(-speed * delta)
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

function composeVehicleLocalVector(local: THREE.Vector3, basis: VehicleAxisBasis, target: THREE.Vector3): THREE.Vector3 {
  return target
    .set(0, 0, 0)
    .addScaledVector(basis.right, local.x)
    .addScaledVector(basis.up, local.y)
    .addScaledVector(basis.forward, local.z)
}

function projectVehicleVectorToBasis(vector: THREE.Vector3, basis: VehicleAxisBasis, target: THREE.Vector3): THREE.Vector3 {
  target.set(vector.dot(basis.right), vector.dot(basis.up), vector.dot(basis.forward))
  return target
}

export class VehicleDriveController {
  private readonly deps: VehicleDriveControllerDeps
  private readonly bindings: VehicleDriveControllerBindings
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

  requestSmoothStop(options: { damping?: number; stopSpeed?: number } = {}): void {
    if (!this.state.active) {
      return
    }
    const damping = typeof options.damping === 'number' ? options.damping : VEHICLE_SMOOTH_STOP_DEFAULT_DAMPING
    const stopSpeed = typeof options.stopSpeed === 'number' ? options.stopSpeed : VEHICLE_SMOOTH_STOP_SPEED_THRESHOLD
    this.smoothStopState.active = true
    this.smoothStopState.damping = Math.max(
      VEHICLE_COASTING_DAMPING,
      Math.min(VEHICLE_SMOOTH_STOP_MAX_DAMPING, damping),
    )
    this.smoothStopState.stopSpeedSq = Math.max(1e-4, stopSpeed * stopSpeed)
  }

  clearSmoothStop(): void {
    this.smoothStopState.active = false
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
    const run = this.deps.runWithProgrammaticCameraMutation ?? ((fn: () => void) => fn())
    run(() => {
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
    })
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

  stopDrive(options: { resolution?: { type: string; message?: string }; preserveCamera?: boolean } = {}, ctx?: VehicleDriveCameraContext): void {
    const state = this.state
    if (!state.active) {
      return
    }
    const token = state.token
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
  }

  applyForces(): void {
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
    let engineForce = throttle * VEHICLE_ENGINE_FORCE
    let speedSq = 0
    if (velocity && chassisBody && instance.axisForward) {
      speedSq = velocity.lengthSquared()
      const throttleSign = Math.sign(throttle)
      if (throttleSign !== 0 && speedSq > VEHICLE_SPEED_SOFT_CAP_SQ) {
        const speed = Math.sqrt(speedSq)
        const range = Math.max(0.1, VEHICLE_SPEED_HARD_CAP - VEHICLE_SPEED_SOFT_CAP)
        const excess = Math.min(Math.max(0, speed - VEHICLE_SPEED_SOFT_CAP), range)
        const slowRatio = Math.min(1, excess / range)
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
        const forwardVelocity = velocity.x * forwardWorld.x + velocity.y * forwardWorld.y + velocity.z * forwardWorld.z
        const sameDirection = Math.sign(forwardVelocity) === throttleSign
        if (sameDirection) {
          engineForce *= 1 - 0.7 * slowRatio
          if (speedSq >= VEHICLE_SPEED_HARD_CAP_SQ && throttleSign > 0) {
            engineForce = 0
          }
        }
      }
      if (speedSq >= VEHICLE_SPEED_HARD_CAP_SQ) {
        velocity.scale(1 - VEHICLE_SPEED_LIMIT_DAMPING, velocity)
      } else if (Math.abs(throttle) < 0.05) {
        const baseDamping = smoothStop.active ? smoothStop.damping : VEHICLE_COASTING_DAMPING
        const damping = Math.min(0.95, Math.max(0, baseDamping))
        velocity.scale(1 - damping, velocity)
        if (smoothStop.active) {
          const nextSpeedSq = velocity.lengthSquared()
          if (nextSpeedSq <= smoothStop.stopSpeedSq) {
            velocity.set(0, 0, 0)
            smoothStop.active = false
            speedSq = 0
          } else {
            speedSq = nextSpeedSq
          }
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
    const brakeForce = brakeInput * VEHICLE_BRAKE_FORCE
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

  private ensureVehicleFollowLocalOffset(placement: VehicleFollowPlacement): void {
    const follow = this.bindings.cameraFollowState
    if (!follow.hasLocalOffset) {
      follow.localOffset.set(0, placement.heightOffset, -placement.distance)
      follow.hasLocalOffset = true
      return
    }
    this.clampVehicleFollowLocalOffset(placement)
  }

  private resetVehicleFollowLocalOffset(): void {
    const follow = this.bindings.cameraFollowState
    follow.localOffset.set(0, 0, 0)
    follow.hasLocalOffset = false
  }

  private enforceVehicleFollowBehind(placement: VehicleFollowPlacement): void {
    const follow = this.bindings.cameraFollowState
    const local = follow.localOffset
    const minBack = Math.max(placement.distance, VEHICLE_FOLLOW_DISTANCE_MIN)
    const forwardComponent = local.z
    if (!Number.isFinite(forwardComponent)) {
      local.set(0, placement.heightOffset, -minBack)
      follow.hasLocalOffset = true
      return
    }
    if (forwardComponent > -minBack) {
      local.z = -minBack
      follow.hasLocalOffset = true
    }
  }

  private clampVehicleFollowLocalOffset(placement?: VehicleFollowPlacement): void {
    const follow = this.bindings.cameraFollowState
    const local = follow.localOffset
    const length = local.length()
    const minDistance = VEHICLE_FOLLOW_DISTANCE_MIN
    const maxDistance = VEHICLE_FOLLOW_DISTANCE_MAX
    const fallbackHeight = placement ? Math.max(placement.heightOffset, VEHICLE_FOLLOW_HEIGHT_MIN) : VEHICLE_FOLLOW_HEIGHT_MIN
    const fallbackDistance = placement ? Math.max(placement.distance, VEHICLE_FOLLOW_DISTANCE_MIN) : VEHICLE_FOLLOW_DISTANCE_MIN
    if (!Number.isFinite(length) || length < 1e-3) {
      local.set(0, fallbackHeight, -Math.max(minDistance, fallbackDistance))
      return
    }
    const clamped = Math.min(maxDistance, Math.max(minDistance, length))
    if (Math.abs(clamped - length) > 1e-4) {
      local.multiplyScalar(clamped / length)
    }
  }

  private updateVehicleFollowLocalOffsetFromCamera(
    anchor: THREE.Vector3,
    basis: VehicleAxisBasis,
    quaternion: THREE.Quaternion,
    cameraPosition: THREE.Vector3,
  ): void {
    const follow = this.bindings.cameraFollowState
    const temp = this.temp
    temp.followWorldOffset.copy(cameraPosition).sub(anchor)
    temp.cameraQuaternionInverse.copy(quaternion).invert()
    temp.followOffset.copy(temp.followWorldOffset).applyQuaternion(temp.cameraQuaternionInverse)
    projectVehicleVectorToBasis(temp.followOffset, basis, follow.localOffset)
    follow.hasLocalOffset = true
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
    const worldUp = VEHICLE_CAMERA_WORLD_UP
    const placement = computeVehicleFollowPlacement(getVehicleApproxDimensions(vehicleObject))
    const distanceScale = this.getFollowDistanceScale()
    placement.distance = Math.min(
      VEHICLE_FOLLOW_DISTANCE_MAX,
      Math.max(VEHICLE_FOLLOW_DISTANCE_MIN, placement.distance * distanceScale),
    )
    const vehicleVelocity = instance?.vehicle?.chassisBody?.velocity ?? null
    this.computeVehicleFollowAnchor(vehicleObject, instance, temp.seatPosition, temp.followAnchor)
    const predictedAnchor = temp.followPredicted.copy(temp.followAnchor)
    let lookaheadActive = false
    if (vehicleVelocity) {
      temp.planarVelocity.set(vehicleVelocity.x, 0, vehicleVelocity.z)
      const planarSpeedSq = temp.planarVelocity.lengthSq()
      if (planarSpeedSq > VEHICLE_FOLLOW_LOOKAHEAD_MIN_SPEED_SQ) {
        temp.predictionOffset.copy(temp.planarVelocity)
        temp.predictionOffset.multiplyScalar(VEHICLE_FOLLOW_LOOKAHEAD_TIME)
        const offsetLength = temp.predictionOffset.length()
        if (offsetLength > VEHICLE_FOLLOW_LOOKAHEAD_DISTANCE_MAX) {
          temp.predictionOffset.multiplyScalar(VEHICLE_FOLLOW_LOOKAHEAD_DISTANCE_MAX / offsetLength)
        }
        lookaheadActive = true
      }
      if (planarSpeedSq > VEHICLE_FOLLOW_COLLISION_LOCK_SPEED_SQ) {
        const normalizedDir = temp.tempVector.copy(temp.planarVelocity)
        const dirLength = normalizedDir.length()
        if (dirLength > 1e-6 && follow.lastVelocityDirection.lengthSq() > 1e-6) {
          normalizedDir.multiplyScalar(1 / dirLength)
          if (normalizedDir.dot(follow.lastVelocityDirection) < VEHICLE_FOLLOW_COLLISION_DIRECTION_DOT_THRESHOLD) {
            follow.anchorHoldSeconds = VEHICLE_FOLLOW_COLLISION_HOLD_TIME
            follow.shouldHoldAnchorForReverse = true
          }
        }
      }
      const movementDot = temp.planarVelocity.dot(follow.heading)
      if (planarSpeedSq > 1e-6) {
        temp.tempVector.copy(temp.planarVelocity).normalize()
        follow.lastVelocityDirection.copy(temp.tempVector)
        if (movementDot > VEHICLE_FOLLOW_FORWARD_RELEASE_DOT) {
          follow.shouldHoldAnchorForReverse = false
        }
      }
    } else {
      temp.planarVelocity.set(0, 0, 0)
      follow.lastVelocityDirection.set(0, 0, 0)
    }
    if (follow.anchorHoldSeconds > 0) {
      follow.anchorHoldSeconds = Math.max(0, follow.anchorHoldSeconds - deltaSeconds)
    }

    if (!follow.initialized) {
      follow.heading.copy(temp.seatForward)
      follow.heading.y = 0
      if (follow.heading.lengthSq() < 1e-6) {
        follow.heading.set(0, 0, 1)
      } else {
        follow.heading.normalize()
      }
      follow.anchorHoldSeconds = 0
      follow.lastVelocityDirection.set(0, 0, 0)
      follow.shouldHoldAnchorForReverse = false
    }

    const speedSq = vehicleVelocity ? vehicleVelocity.lengthSquared() : 0
    const isVehicleMoving = speedSq > VEHICLE_CAMERA_MOVING_SPEED_SQ
    const desiredHeading = temp.cameraForward
    if (temp.seatForward.lengthSq() > 1e-6) {
      desiredHeading.copy(temp.seatForward)
    } else if (follow.heading.lengthSq() > 1e-6) {
      desiredHeading.copy(follow.heading)
    } else {
      desiredHeading.set(0, 0, 1)
    }
    desiredHeading.y = 0
    if (desiredHeading.lengthSq() < 1e-6) {
      desiredHeading.set(0, 0, 1)
    } else {
      desiredHeading.normalize()
    }

    const headingLerp = follow.initialized ? computeVehicleFollowLerpAlpha(deltaSeconds, VEHICLE_FOLLOW_HEADING_LERP_SPEED) : 1
    follow.heading.lerp(desiredHeading, headingLerp)
    if (follow.heading.lengthSq() < 1e-6) {
      follow.heading.copy(desiredHeading)
    } else {
      follow.heading.normalize()
    }

    const headingForward = temp.cameraForward.copy(follow.heading)
    const headingRight = temp.cameraRight.crossVectors(worldUp, headingForward)
    if (headingRight.lengthSq() < 1e-6) {
      headingRight.set(1, 0, 0)
    } else {
      headingRight.normalize()
    }
    const headingUp = temp.cameraUp.copy(worldUp)
    const movingBackward = vehicleVelocity
      ? temp.planarVelocity.dot(follow.heading) < VEHICLE_FOLLOW_BACKWARD_DOT_THRESHOLD
      : false
    const reversing = movingBackward
    follow.shouldHoldAnchorForReverse = reversing
    if (lookaheadActive) {
      if (reversing) {
        const lookaheadLength = temp.predictionOffset.length()
        if (lookaheadLength > 1e-6) {
          temp.tempVector.copy(follow.heading)
          if (temp.tempVector.lengthSq() < 1e-6) {
            temp.tempVector.copy(temp.planarVelocity)
          }
          if (temp.tempVector.lengthSq() < 1e-6) {
            temp.tempVector.set(0, 0, 1)
          }
          temp.tempVector.normalize().multiplyScalar(-lookaheadLength)
          predictedAnchor.add(temp.tempVector)
        }
      } else {
        predictedAnchor.add(temp.predictionOffset)
      }
    }
    follow.desiredAnchor.copy(predictedAnchor)
    const anchorHoldActive = follow.anchorHoldSeconds > 0
    const baseAnchorAlpha = options.immediate || !follow.initialized
      ? 1
      : computeVehicleFollowLerpAlpha(deltaSeconds, VEHICLE_FOLLOW_ANCHOR_LERP_SPEED)
    const anchorAlpha = anchorHoldActive ? 0 : baseAnchorAlpha
    if (anchorAlpha >= 1) {
      follow.currentAnchor.copy(follow.desiredAnchor)
    } else if (anchorAlpha > 0) {
      follow.currentAnchor.lerp(follow.desiredAnchor, anchorAlpha)
    }
    const anchorForCamera = follow.currentAnchor

    this.ensureVehicleFollowLocalOffset(placement)
    this.enforceVehicleFollowBehind(placement)

    const targetOffsetLocal = temp.followOffset.set(0, placement.targetLift, placement.targetForward)
    const targetWorldOffset = temp.followTarget
      .copy(headingRight)
      .multiplyScalar(targetOffsetLocal.x)
      .addScaledVector(headingUp, targetOffsetLocal.y)
      .addScaledVector(headingForward, targetOffsetLocal.z)
    follow.desiredTarget.copy(anchorForCamera).add(targetWorldOffset)

    const mapControls = ctx.mapControls
    if (mapControls) {
      mapControls.target.copy(follow.desiredTarget)
      if (options.applyOrbitTween && this.deps.updateOrbitLookTween) {
        this.deps.updateOrbitLookTween(deltaSeconds)
      }
      mapControls.update?.()
    }

    const allowCameraAdjustments = !isVehicleMoving
    let userAdjusted = allowCameraAdjustments && Boolean(options.followControlsDirty)
    if (allowCameraAdjustments && !userAdjusted && follow.initialized && ctx.camera) {
      const deltaPosition = ctx.camera.position.distanceTo(follow.currentPosition)
      userAdjusted = deltaPosition > 1e-3
    }
    if (allowCameraAdjustments && userAdjusted && ctx.camera) {
      temp.followWorldOffset.copy(ctx.camera.position).sub(anchorForCamera)
      follow.localOffset.set(
        temp.followWorldOffset.dot(headingRight),
        temp.followWorldOffset.dot(headingUp),
        temp.followWorldOffset.dot(headingForward),
      )
      follow.hasLocalOffset = true
      this.enforceVehicleFollowBehind(placement)
      this.clampVehicleFollowLocalOffset(placement)
    }

    const desiredWorldOffset = temp.followWorldOffset
      .copy(headingRight)
      .multiplyScalar(follow.localOffset.x)
      .addScaledVector(headingUp, follow.localOffset.y)
      .addScaledVector(headingForward, follow.localOffset.z)
    follow.desiredPosition.copy(anchorForCamera).add(desiredWorldOffset)

    const immediate = Boolean(options.immediate) || !follow.initialized
    if (immediate) {
      follow.currentPosition.copy(follow.desiredPosition)
      follow.currentTarget.copy(follow.desiredTarget)
      follow.initialized = true
    } else {
      const positionAlpha = computeVehicleFollowLerpAlpha(deltaSeconds, VEHICLE_FOLLOW_POSITION_LERP_SPEED)
      const targetAlpha = computeVehicleFollowLerpAlpha(deltaSeconds, VEHICLE_FOLLOW_TARGET_LERP_SPEED)
      follow.currentPosition.lerp(follow.desiredPosition, positionAlpha)
      follow.currentTarget.lerp(follow.desiredTarget, targetAlpha)
    }

    const run = this.deps.runWithProgrammaticCameraMutation ?? ((fn: () => void) => fn())
    run(() => {
      ctx.camera!.position.copy(follow.currentPosition)
      ctx.camera!.up.copy(headingUp)
      if (mapControls) {
          mapControls.target.copy(follow.currentTarget)
          ctx.camera!.lookAt(follow.currentTarget)
          mapControls.update?.()
      } else {
        ctx.camera!.lookAt(follow.currentTarget)
      }
    })
    follow.initialized = true
    return true
  }

  private updateFirstPersonCamera(ctx: VehicleDriveCameraContext): boolean {
    const run = this.deps.runWithProgrammaticCameraMutation ?? ((fn: () => void) => fn())
    const temp = this.temp
    run(() => {
      if (!ctx.camera) {
        return
      }
      ctx.camera.position.copy(temp.seatPosition)
      ctx.camera.up.copy(temp.seatUp)
      ctx.camera.lookAt(temp.cameraLook.copy(temp.seatPosition).addScaledVector(temp.seatForward, VEHICLE_CAMERA_DEFAULT_LOOK_DISTANCE))
      if (ctx.mapControls) {
        ctx.mapControls!.target.copy(temp.cameraLook)
        ctx.mapControls!.update?.()
      }
    })
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

  private resolveVehicleAxisBasis(instance: VehicleInstance | null): VehicleAxisBasis {
    if (!instance) {
      return { right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), forward: new THREE.Vector3(0, 0, 1) }
    }
    return { right: instance.axisRight, up: instance.axisUp, forward: instance.axisForward }
  }

  private resolveVehicleFollowWorldOffset(local: THREE.Vector3, basis: VehicleAxisBasis, quaternion: THREE.Quaternion, target: THREE.Vector3): THREE.Vector3 {
    composeVehicleLocalVector(local, basis, target)
    return target.applyQuaternion(quaternion)
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
    const run = this.deps.runWithProgrammaticCameraMutation ?? ((fn: () => void) => fn())
    run(() => {
      ctx.camera!.position.copy(this.temp.seatPosition)
      ctx.camera!.up.copy(this.temp.seatUp)
      ctx.camera!.lookAt(this.temp.cameraLook)
      if (ctx.mapControls) {
        ctx.mapControls.target.copy(this.temp.cameraLook)
        ctx.mapControls.update?.()
      }
    })
    if (this.deps.lockControlsPitchToCurrent && ctx.mapControls && ctx.camera) {
      this.deps.lockControlsPitchToCurrent(ctx.mapControls, ctx.camera)
    }
    return true
  }

  toggleCameraMode(): void {
    this.cameraMode = this.cameraMode === 'follow' ? 'first-person' : 'follow'
  }
}
