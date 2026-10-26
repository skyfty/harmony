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
  preservePitch = false,
): boolean {
  object.getWorldQuaternion(vehicleWorldQuaternionHelper).normalize()
  target.copy(axisForward).applyQuaternion(vehicleWorldQuaternionHelper)
  if (!preservePitch) {
    target.y = 0
  }
  if (target.lengthSq() < 1e-8) {
    return false
  }
  target.normalize()
  return true
}

export function resolveVehicleSteeringInputFromHeadingChange(params: {
  previousForwardWorld: THREE.Vector3
  currentForwardWorld: THREE.Vector3
  signedTravelDistance: number
  wheelbaseMeters: number
  maxSteerRadians: number
}): number {
  const travelDistance = params.signedTravelDistance
  if (!Number.isFinite(travelDistance) || Math.abs(travelDistance) < 1e-4) {
    return 0
  }
  const previousLength = Math.hypot(
    params.previousForwardWorld.x,
    params.previousForwardWorld.z,
  )
  const currentLength = Math.hypot(
    params.currentForwardWorld.x,
    params.currentForwardWorld.z,
  )
  if (previousLength < 1e-5 || currentLength < 1e-5) {
    return 0
  }
  const previousYaw = Math.atan2(
    -params.previousForwardWorld.z / previousLength,
    params.previousForwardWorld.x / previousLength,
  )
  const currentYaw = Math.atan2(
    -params.currentForwardWorld.z / currentLength,
    params.currentForwardWorld.x / currentLength,
  )
  const yawDelta = Math.atan2(
    Math.sin(currentYaw - previousYaw),
    Math.cos(currentYaw - previousYaw),
  )
  const wheelbase = Number.isFinite(params.wheelbaseMeters)
    ? Math.max(0.1, params.wheelbaseMeters)
    : 1
  const maxSteer = Number.isFinite(params.maxSteerRadians)
    ? Math.max(THREE.MathUtils.degToRad(1), params.maxSteerRadians)
    : THREE.MathUtils.degToRad(30)
  const steerAngle = Math.atan(
    (yawDelta * wheelbase) / Math.max(1e-4, Math.abs(travelDistance)),
  )
  return THREE.MathUtils.clamp(
    steerAngle / maxSteer * Math.sign(travelDistance),
    -1,
    1,
  )
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
