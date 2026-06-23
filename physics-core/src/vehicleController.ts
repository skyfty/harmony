export type PhysicsVehicleDriveState = {
  vehicleId: number | null
  active: boolean
  steering: number
  throttle: number
  brake: number
}

export type PhysicsVehicleWheelControlCommand = {
  steeringValue: number
  engineForce: number
  brakeForce: number
  steerableWheelIndices: readonly number[]
  applyControlsToAllWheels?: boolean
}

type PhysicsVehicleWheelControlTarget = {
  wheelInfos?: unknown[]
  setSteeringValue: (value: number, wheelIndex: number) => void
  applyEngineForce: (force: number, wheelIndex: number) => void
  setBrake: (brake: number, wheelIndex: number) => void
}

export function createIdleVehicleDriveState(): PhysicsVehicleDriveState {
  return {
    vehicleId: null,
    active: false,
    steering: 0,
    throttle: 0,
    brake: 0,
  }
}

export function applyPhysicsVehicleWheelControl(
  vehicle: PhysicsVehicleWheelControlTarget,
  command: PhysicsVehicleWheelControlCommand,
): void {
  const wheelCount = Math.max(0, vehicle.wheelInfos?.length ?? 0)
  const steerableWheelIndices = new Set(command.steerableWheelIndices)

  console.log(`Applying vehicle wheel control: ${JSON.stringify(command)}, wheelCount: ${wheelCount}`)

  for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex += 1) {
    const applyControlToWheel = command.applyControlsToAllWheels === true || steerableWheelIndices.has(wheelIndex)
    vehicle.setSteeringValue(applyControlToWheel ? command.steeringValue : 0, wheelIndex)
    vehicle.applyEngineForce(applyControlToWheel ? command.engineForce : 0, wheelIndex)
    vehicle.setBrake(command.brakeForce, wheelIndex)
  }
}
