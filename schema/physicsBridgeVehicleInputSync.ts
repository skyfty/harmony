import type {
  PhysicsTransform,
} from '@harmony/physics-core'

// Keep the stop/deadzone threshold small enough that low-speed auto-tour
// cruise values do not get misclassified as "idle" and forced into a hard brake.
export const PHYSICS_BRIDGE_VEHICLE_STOP_INPUT_DEADZONE = 0.01
const PHYSICS_BRIDGE_VEHICLE_INPUT_EPSILON = 1e-4

type PhysicsBridgeVehicleControlInput = {
  steering: number
  throttle: number
  brake: number
}

type PhysicsBridgeVehicleInputSyncBridge = {
  setVehicleInput: (command: { vehicleId: number } & PhysicsBridgeVehicleControlInput) => Promise<void>
  setBodyTransform: (command: {
    bodyId: number
    transform: PhysicsTransform
    resetVelocity?: boolean
  }) => Promise<void>
}

export type PhysicsBridgeVehicleInputSyncState = {
  pendingPromise: Promise<void> | null
  lastDrivenVehicleId: number | null
  lastDrivenNodeId: string | null
  motionInputActive: boolean
  lastSentSteering: number | null
  lastSentThrottle: number | null
  lastSentBrake: number | null
}

export type PhysicsBridgeVehicleInputSyncOptions = {
  state: PhysicsBridgeVehicleInputSyncState
  bridge: PhysicsBridgeVehicleInputSyncBridge | null
  sceneLoaded: boolean
  activeNodeId: string | null
  vehicleIdByNodeId: ReadonlyMap<string, number>
  input: PhysicsBridgeVehicleControlInput
  resolveBodyId: (nodeId: string) => number | null | undefined
  resolveStopTransform: (nodeId: string) => PhysicsTransform | null
  resetLocalVehicleState?: (nodeId: string, transform: PhysicsTransform) => void
  warningPrefix?: string
}

export function createPhysicsBridgeVehicleInputSyncState(): PhysicsBridgeVehicleInputSyncState {
  return {
    pendingPromise: null,
    lastDrivenVehicleId: null,
    lastDrivenNodeId: null,
    motionInputActive: false,
    lastSentSteering: null,
    lastSentThrottle: null,
    lastSentBrake: null,
  }
}

export function resetPhysicsBridgeVehicleInputSyncState(state: PhysicsBridgeVehicleInputSyncState): void {
  state.pendingPromise = null
  state.lastDrivenVehicleId = null
  state.lastDrivenNodeId = null
  state.motionInputActive = false
  state.lastSentSteering = null
  state.lastSentThrottle = null
  state.lastSentBrake = null
}

export function syncPhysicsBridgeVehicleInput(options: PhysicsBridgeVehicleInputSyncOptions): void {
  const {
    state,
    bridge,
    sceneLoaded,
    activeNodeId,
    vehicleIdByNodeId,
    input,
    warningPrefix = '[PhysicsBridgeVehicleInput]',
  } = options

  if (!bridge || !sceneLoaded || state.pendingPromise) {
    return
  }

  if (!activeNodeId) {
    if (typeof state.lastDrivenVehicleId !== 'number') {
      state.lastDrivenNodeId = null
      state.motionInputActive = false
      state.lastSentSteering = null
      state.lastSentThrottle = null
      state.lastSentBrake = null
      return
    }
    const lastDrivenNodeId = state.lastDrivenNodeId
    const inputPromise = bridge.setVehicleInput({
      vehicleId: state.lastDrivenVehicleId,
      steering: 0,
      throttle: 0,
      brake: 1,
    })
    const stopPromise = lastDrivenNodeId
      ? stopPhysicsBridgeVehicleImmediately(options, lastDrivenNodeId)
      : Promise.resolve()
    state.pendingPromise = settleVehicleInputPromises([inputPromise, stopPromise], `${warningPrefix} Failed to clear vehicle input`)
      .finally(() => {
        state.lastDrivenVehicleId = null
        state.lastDrivenNodeId = null
        state.motionInputActive = false
        state.lastSentSteering = null
        state.lastSentThrottle = null
        state.lastSentBrake = null
        state.pendingPromise = null
      })
    return
  }

  const vehicleId = vehicleIdByNodeId.get(activeNodeId)
  if (typeof vehicleId !== 'number') {
    return
  }

  if (typeof state.lastDrivenVehicleId === 'number' && state.lastDrivenVehicleId !== vehicleId) {
    const lastDrivenNodeId = state.lastDrivenNodeId
    const inputPromise = bridge.setVehicleInput({
      vehicleId: state.lastDrivenVehicleId,
      steering: 0,
      throttle: 0,
      brake: 1,
    })
    const stopPromise = lastDrivenNodeId
      ? stopPhysicsBridgeVehicleImmediately(options, lastDrivenNodeId)
      : Promise.resolve()
    void Promise.allSettled([inputPromise, stopPromise])
    state.motionInputActive = false
  }

  // 判断当前是否有有效的运动输入：
  // 当油门或刹车的绝对值超过死区阈值时，认为玩家正在主动控制车辆。
  // 使用死区是为了防止极小的输入值（如自动巡游的低速值）被误判为空闲状态。
  const motionInputActive =
    Math.abs(input.throttle) > PHYSICS_BRIDGE_VEHICLE_STOP_INPUT_DEADZONE
    || Math.abs(input.brake) > PHYSICS_BRIDGE_VEHICLE_STOP_INPUT_DEADZONE


  // 判断是否需要立即停车：
  // 当上一帧存在运动输入，而当前帧运动输入消失时，触发立即停车逻辑，
  // 防止车辆因惯性继续滑行。
  const shouldStopImmediately = state.motionInputActive && !motionInputActive

  // 计算实际发送给物理引擎的刹车值：
  // 若当前有运动输入，使用玩家输入的刹车值；
  // 否则强制将刹车设为 1（全力刹车），确保车辆停止。
  const bridgeBrake = motionInputActive ? input.brake : 1

  // 判断是否需要向物理桥发送新的输入指令，满足以下任一条件则需要同步：
  // 1. 当前驾驶的车辆与上次不同（切换了车辆）
  // 2. 任意上次发送的输入值为 null（首次发送，尚未初始化）
  // 3. 转向、油门或刹车的变化量超过浮点精度阈值（输入发生了有效变化）
  const shouldSyncInput =
    state.lastDrivenVehicleId !== vehicleId
    || state.lastSentSteering === null
    || state.lastSentThrottle === null
    || state.lastSentBrake === null
    || Math.abs(state.lastSentSteering - input.steering) > PHYSICS_BRIDGE_VEHICLE_INPUT_EPSILON
    || Math.abs(state.lastSentThrottle - input.throttle) > PHYSICS_BRIDGE_VEHICLE_INPUT_EPSILON
    || Math.abs(state.lastSentBrake - bridgeBrake) > PHYSICS_BRIDGE_VEHICLE_INPUT_EPSILON

  state.lastDrivenVehicleId = vehicleId
  state.lastDrivenNodeId = activeNodeId
  state.motionInputActive = motionInputActive
  if (!shouldSyncInput && !shouldStopImmediately) {
    return
  }
  state.lastSentSteering = input.steering
  state.lastSentThrottle = input.throttle
  state.lastSentBrake = bridgeBrake
  const inputPromise = shouldSyncInput
    ? bridge.setVehicleInput({
      vehicleId,
      steering: input.steering,
      throttle: input.throttle,
      brake: bridgeBrake,
    })
    : Promise.resolve()
  const stopPromise = shouldStopImmediately
    ? stopPhysicsBridgeVehicleImmediately(options, activeNodeId)
    : Promise.resolve()
  state.pendingPromise = settleVehicleInputPromises([inputPromise, stopPromise], `${warningPrefix} Failed to sync vehicle input`)
    .finally(() => {
      state.pendingPromise = null
    })
}

async function stopPhysicsBridgeVehicleImmediately(
  options: PhysicsBridgeVehicleInputSyncOptions,
  nodeId: string,
): Promise<void> {
  const { bridge, resolveBodyId, resolveStopTransform, resetLocalVehicleState } = options
  if (!bridge) {
    return
  }
  const bodyId = resolveBodyId(nodeId)
  if (typeof bodyId !== 'number') {
    return
  }
  const transform = resolveStopTransform(nodeId)
  if (!transform) {
    return
  }
  resetLocalVehicleState?.(nodeId, transform)
  await bridge.setBodyTransform({
    bodyId,
    transform,
    resetVelocity: true,
  })
}

function settleVehicleInputPromises(promises: Array<Promise<void>>, warningMessage: string): Promise<void> {
  return Promise.allSettled(promises)
    .then((results) => {
      results.forEach((result) => {
        if (result.status === 'rejected') {
          console.warn(warningMessage, result.reason)
        }
      })
    })
    .then(() => undefined)
}
