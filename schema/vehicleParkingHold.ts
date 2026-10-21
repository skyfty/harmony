import * as THREE from 'three'
import { applyPhysicsVehicleWheelControl } from '@harmony/physics-core'

import { sleepPhysicsBody, stopPhysicsBodyMotion } from './physicsRuntimeBridge'
import type { VehicleDriveVehicle } from './VehicleDriveController'

export const VEHICLE_PARKED_SPEED_EPSILON = 0.08
export const VEHICLE_PARKING_HOLD_SPEED_EPSILON = 0.2

export type VehicleParkingInstanceLike = {
  vehicle: VehicleDriveVehicle
  steerableWheelIndices: number[]
  axisForward: THREE.Vector3
}

const parkedSpeedQuaternion = new THREE.Quaternion()
const parkedSpeedForward = new THREE.Vector3()

export function holdVehicleBrakeSafe(params: {
  vehicleInstance: VehicleParkingInstanceLike
  brakeForce: number
}): void {
  try {
    const vehicle = params.vehicleInstance.vehicle
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
    console.warn('[VehicleParkingHold] hold brake failed', error)
  }
}

export function updateVehicleSpeedAndApplyParkingHoldSafe(params: {
  vehicleInstance: VehicleParkingInstanceLike
  chassisBody: VehicleDriveVehicle['chassisBody']
  throttle: number
  brake: number
  resolvedForwardSpeedMps?: number | null
  parkedSpeedEpsilon?: number
  parkingHoldSpeedEpsilon?: number
  engageParkingHold?: boolean
  resolveBrakeForce: (vehicleInstance: VehicleParkingInstanceLike) => number
}): number {
  const parkedSpeedEpsilon = params.parkedSpeedEpsilon ?? VEHICLE_PARKED_SPEED_EPSILON
  const parkingHoldSpeedEpsilon = params.parkingHoldSpeedEpsilon ?? VEHICLE_PARKING_HOLD_SPEED_EPSILON
  const engageParkingHold = params.engageParkingHold ?? true

  try {
    if (typeof params.resolvedForwardSpeedMps === 'number' && Number.isFinite(params.resolvedForwardSpeedMps)) {
      const forwardSpeed = Math.abs(params.resolvedForwardSpeedMps)
      if (
        engageParkingHold
        && Math.abs(params.throttle) <= 0.05
        && params.brake <= 0.05
        && forwardSpeed <= parkingHoldSpeedEpsilon
      ) {
        holdVehicleBrakeSafe({
          vehicleInstance: params.vehicleInstance,
          brakeForce: params.resolveBrakeForce(params.vehicleInstance),
        })
        stopPhysicsBodyMotion(params.chassisBody)
        sleepPhysicsBody(params.chassisBody, { minSpeedLimit: 0.05, minTimeLimit: 0.05 })
      }
      return forwardSpeed >= parkedSpeedEpsilon ? forwardSpeed : 0
    }

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
        holdVehicleBrakeSafe({
          vehicleInstance: params.vehicleInstance,
          brakeForce: params.resolveBrakeForce(params.vehicleInstance),
        })
        stopPhysicsBodyMotion(params.chassisBody)
        sleepPhysicsBody(params.chassisBody, { minSpeedLimit: 0.05, minTimeLimit: 0.05 })
      }
      return forwardSpeed >= parkedSpeedEpsilon ? forwardSpeed : 0
    }
  } catch (error) {
    console.warn('[VehicleParkingHold] parked-speed update failed', error)
  }

  const speed = Math.sqrt(
    params.chassisBody.velocity.x * params.chassisBody.velocity.x
    + params.chassisBody.velocity.y * params.chassisBody.velocity.y
    + params.chassisBody.velocity.z * params.chassisBody.velocity.z,
  )
  return Number.isFinite(speed) && speed >= parkedSpeedEpsilon ? speed : 0
}
