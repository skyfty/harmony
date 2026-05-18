import type { PhysicsShapeDesc, PhysicsTransform } from '@harmony/physics-core'
import { createAmmoShape, type BuiltAmmoShape } from './shapeFactory'
import type { AmmoApi, AmmoQuaternion, AmmoVector3 } from './ammoHelpers'

export type AmmoSceneShapeBinding = {
  shape: BuiltAmmoShape['shape']
  position: AmmoVector3
  quaternion: AmmoQuaternion
  cleanup: BuiltAmmoShape['cleanup']
}

export function createAmmoSceneShapeBindings(
  ammo: AmmoApi,
  shapeMap: Map<number, PhysicsShapeDesc>,
  shapeId: number,
  dynamic: boolean,
): AmmoSceneShapeBinding[] {
  const shapeDesc = shapeMap.get(shapeId)
  if (!shapeDesc) {
    throw new Error(`Unknown physics shape: ${shapeId}`)
  }
  if (shapeDesc.kind === 'compound') {
    return shapeDesc.children.flatMap((child) => {
      const childBindings = createAmmoSceneShapeBindings(ammo, shapeMap, child.shapeId, dynamic)
      return childBindings.map((binding) => composeAmmoSceneShapeBinding(binding, child.transform))
    })
  }
  const built = createAmmoShape(ammo, shapeDesc, dynamic)
  return [{
    shape: built.shape,
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    cleanup: built.cleanup,
  }]
}

function composeAmmoSceneShapeBinding(
  binding: AmmoSceneShapeBinding,
  transform: PhysicsTransform,
): AmmoSceneShapeBinding {
  const parentPosition = vec3FromTuple(transform.position)
  const parentQuaternion = quatFromTuple(transform.rotation)
  const rotatedPosition = rotateVectorByQuaternion(binding.position, parentQuaternion)
  const position: AmmoVector3 = [
    parentPosition[0] + rotatedPosition[0],
    parentPosition[1] + rotatedPosition[1],
    parentPosition[2] + rotatedPosition[2],
  ]
  const quaternion = multiplyQuaternions(parentQuaternion, binding.quaternion)
  return {
    shape: binding.shape,
    position,
    quaternion,
    cleanup: binding.cleanup,
  }
}

function vec3FromTuple(tuple: PhysicsTransform['position']): AmmoVector3 {
  return [tuple[0] ?? 0, tuple[1] ?? 0, tuple[2] ?? 0]
}

function quatFromTuple(tuple: PhysicsTransform['rotation']): AmmoQuaternion {
  return [tuple[0] ?? 0, tuple[1] ?? 0, tuple[2] ?? 0, tuple[3] ?? 1]
}

function rotateVectorByQuaternion(vector: AmmoVector3, quaternion: AmmoQuaternion): AmmoVector3 {
  const [qx, qy, qz, qw] = normalizeQuaternion(quaternion)
  const [vx, vy, vz] = vector
  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ]
}

function multiplyQuaternions(left: AmmoQuaternion, right: AmmoQuaternion): AmmoQuaternion {
  const [lx, ly, lz, lw] = normalizeQuaternion(left)
  const [rx, ry, rz, rw] = normalizeQuaternion(right)
  return [
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
    lw * rw - lx * rx - ly * ry - lz * rz,
  ]
}

function normalizeQuaternion(quaternion: AmmoQuaternion): AmmoQuaternion {
  const length = Math.hypot(quaternion[0], quaternion[1], quaternion[2], quaternion[3])
  if (!Number.isFinite(length) || length <= 1e-12) {
    return [0, 0, 0, 1]
  }
  return [
    quaternion[0] / length,
    quaternion[1] / length,
    quaternion[2] / length,
    quaternion[3] / length,
  ]
}
