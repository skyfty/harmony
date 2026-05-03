import type {
  PhysicsTransform,
} from '@harmony/physics-core'

export const PHYSICS_BRIDGE_VEHICLE_STOP_INPUT_DEADZONE = 0.05

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
  }
}

export function resetPhysicsBridgeVehicleInputSyncState(state: PhysicsBridgeVehicleInputSyncState): void {
  state.pendingPromise = null
  state.lastDrivenVehicleId = null
  state.lastDrivenNodeId = null
  state.motionInputActive = false
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

  const motionInputActive =
    Math.abs(input.throttle) > PHYSICS_BRIDGE_VEHICLE_STOP_INPUT_DEADZONE
    || Math.abs(input.brake) > PHYSICS_BRIDGE_VEHICLE_STOP_INPUT_DEADZONE
  const shouldStopImmediately = state.motionInputActive && !motionInputActive
  const bridgeBrake = motionInputActive ? input.brake : 1

  state.lastDrivenVehicleId = vehicleId
  state.lastDrivenNodeId = activeNodeId
  state.motionInputActive = motionInputActive

  const inputPromise = bridge.setVehicleInput({
    vehicleId,
    steering: input.steering,
    throttle: input.throttle,
    brake: bridgeBrake,
  })
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
