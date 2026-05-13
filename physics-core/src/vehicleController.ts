export type PhysicsVehicleDriveState = {
  vehicleId: number | null
  active: boolean
  steering: number
  throttle: number
  brake: number
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
