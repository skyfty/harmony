import type * as THREE from 'three'
import type { VehicleDriveVehicle } from './VehicleDriveController'

function createBridgeMutableVec3(x = 0, y = 0, z = 0): VehicleDriveVehicle['chassisBody']['position'] {
  return {
    x,
    y,
    z,
    set(nextX: number, nextY: number, nextZ: number) {
      this.x = nextX
      this.y = nextY
      this.z = nextZ
      return this
    },
    lengthSquared() {
      return this.x * this.x + this.y * this.y + this.z * this.z
    },
  }
}

export function createBridgeVehicleProxy(
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  wheelCount: number,
): VehicleDriveVehicle {
  const wheelInfos = Array.from({ length: wheelCount }, () => ({
    steering: 0,
    brake: 0,
    engineForce: 0,
  }))
  return {
    chassisBody: {
      position: createBridgeMutableVec3(position.x, position.y, position.z),
      velocity: createBridgeMutableVec3(0, 0, 0),
      angularVelocity: createBridgeMutableVec3(0, 0, 0),
      quaternion: {
        x: quaternion.x,
        y: quaternion.y,
        z: quaternion.z,
        w: quaternion.w,
      },
      allowSleep: true,
      sleepSpeedLimit: 0.05,
      sleepTimeLimit: 0.05,
    },
    wheelInfos,
    applyEngineForce(force: number, wheelIndex: number) {
      if (wheelInfos[wheelIndex]) {
        wheelInfos[wheelIndex]!.engineForce = force
      }
    },
    setSteeringValue(value: number, wheelIndex: number) {
      if (wheelInfos[wheelIndex]) {
        wheelInfos[wheelIndex]!.steering = value
      }
    },
    setBrake(brake: number, wheelIndex: number) {
      if (wheelInfos[wheelIndex]) {
        wheelInfos[wheelIndex]!.brake = brake
      }
    },
  }
}
