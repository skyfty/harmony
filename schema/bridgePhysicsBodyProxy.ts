import type * as THREE from 'three'
import type { PhysicsBodyLike } from './physicsBodySync'

function createBridgeMutableVec3(x = 0, y = 0, z = 0): PhysicsBodyLike['position'] {
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
  }
}

function createBridgeMutableQuaternion(x = 0, y = 0, z = 0, w = 1): PhysicsBodyLike['quaternion'] {
  return {
    x,
    y,
    z,
    w,
    set(nextX: number, nextY: number, nextZ: number, nextW: number) {
      this.x = nextX
      this.y = nextY
      this.z = nextZ
      this.w = nextW
      return this
    },
  }
}

export function createBridgePhysicsBodyProxy(
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
): PhysicsBodyLike {
  return {
    position: createBridgeMutableVec3(position.x, position.y, position.z),
    velocity: createBridgeMutableVec3(0, 0, 0),
    angularVelocity: createBridgeMutableVec3(0, 0, 0),
    quaternion: createBridgeMutableQuaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w),
    sleep() {
      return undefined
    },
  }
}
