import * as THREE from 'three'

export type VehicleVisualMotionSource = 'physics' | 'visual'

type Vec3Like = { x: number; y: number; z: number }
type QuatLike = { x: number; y: number; z: number; w: number }

const vehicleWorldQuaternionHelper = new THREE.Quaternion()
const signedTravelForwardHelper = new THREE.Vector3()

export function resolveVehicleVisualMotionPose(params: {
  tourActive: boolean
  object: THREE.Object3D | null
  chassisPosition: Vec3Like
  chassisQuaternion: QuatLike
  positionOut: THREE.Vector3
  quaternionOut: THREE.Quaternion
}): VehicleVisualMotionSource {
  if (params.tourActive && params.object) {
    params.object.getWorldPosition(params.positionOut)
    params.object.getWorldQuaternion(params.quaternionOut).normalize()
    return 'visual'
  }
  params.positionOut.set(
    params.chassisPosition.x,
    params.chassisPosition.y,
    params.chassisPosition.z,
  )
  params.quaternionOut
    .set(
      params.chassisQuaternion.x,
      params.chassisQuaternion.y,
      params.chassisQuaternion.z,
      params.chassisQuaternion.w,
    )
    .normalize()
  return 'physics'
}

export function resolveWheelSpinAxisInObjectSpace(params: {
  axleAxis: THREE.Vector3
  vehicleWorldQuaternion: THREE.Quaternion
  parentWorldQuaternionInverse: THREE.Quaternion
  baseQuaternionInverse: THREE.Quaternion
  target: THREE.Vector3
}): THREE.Vector3 {
  const { target } = params
  target.copy(params.axleAxis)
    .applyQuaternion(params.vehicleWorldQuaternion)
    .applyQuaternion(params.parentWorldQuaternionInverse)
    .applyQuaternion(params.baseQuaternionInverse)
  if (target.lengthSq() < 1e-10) {
    target.set(1, 0, 0)
  } else {
    target.normalize()
  }
  return target
}

export function resolveVehicleVisualForwardWorld(
  object: THREE.Object3D,
  axisForward: THREE.Vector3,
  target: THREE.Vector3,
): boolean {
  object.getWorldQuaternion(vehicleWorldQuaternionHelper).normalize()
  target.copy(axisForward).applyQuaternion(vehicleWorldQuaternionHelper)
  target.y = 0
  if (target.lengthSq() < 1e-8) {
    return false
  }
  target.normalize()
  return true
}

export function resolveSignedVehicleTravel(
  displacementWorld: THREE.Vector3,
  axisForward: THREE.Vector3,
  vehicleWorldQuaternion: THREE.Quaternion,
): number {
  signedTravelForwardHelper
    .copy(axisForward)
    .applyQuaternion(vehicleWorldQuaternion)
  if (signedTravelForwardHelper.lengthSq() < 1e-10) {
    signedTravelForwardHelper.set(0, 0, 1)
  } else {
    signedTravelForwardHelper.normalize()
  }
  return displacementWorld.dot(signedTravelForwardHelper)
}

export function resolveVehicleWheelRollDelta(params: {
  signedTravel: number
  radius: number
  frozen?: boolean
}): number {
  if (params.frozen || !Number.isFinite(params.signedTravel) || !Number.isFinite(params.radius)) {
    return 0
  }
  const radius = Math.max(Math.abs(params.radius), 1e-6)
  const rollDelta = -params.signedTravel / radius
  return Number.isFinite(rollDelta) ? rollDelta : 0
}
