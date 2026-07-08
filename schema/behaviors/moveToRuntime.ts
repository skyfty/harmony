import * as THREE from 'three'
import { syncBodyFromObject, type PhysicsBodyLike, type PhysicsOrientationAdjustment } from '../physicsBodySync'

export type MoveToSubjectType = 'vehicle' | 'character' | 'camera'

export type MoveToTargetPose = {
  position: THREE.Vector3
  forward: THREE.Vector3
  up: THREE.Vector3
  quaternion: THREE.Quaternion
}

export type MoveToCameraPlacement = {
  position: THREE.Vector3
  lookAt: THREE.Vector3
  up: THREE.Vector3
}

export type MoveToRuntimeSession = {
  active: boolean
  token: string | null
  subjectType: MoveToSubjectType | null
  kinetics: boolean
  targetNodeId: string | null
  targetPosition: THREE.Vector3
  targetForward: THREE.Vector3
  targetUp: THREE.Vector3
  targetQuaternion: THREE.Quaternion
  cameraTargetPosition: THREE.Vector3
  cameraTargetLookAt: THREE.Vector3
}

export const MOVE_TO_CAMERA_EYE_HEIGHT = 1.7
export const MOVE_TO_CAMERA_FORWARD_OFFSET = 1.5
export const MOVE_TO_SNAP_DISTANCE = 0.35
export const MOVE_TO_CHARACTER_STOP_DISTANCE = 0.45
export const MOVE_TO_CHARACTER_SLOW_DISTANCE = 2.0
export const MOVE_TO_VEHICLE_STOP_DISTANCE = 1.2
export const MOVE_TO_VEHICLE_SLOW_DISTANCE = 6.0

const targetForwardScratch = new THREE.Vector3()
const targetUpScratch = new THREE.Vector3()
const targetRightScratch = new THREE.Vector3()
const targetMatrixScratch = new THREE.Matrix4()
const objectWorldPositionScratch = new THREE.Vector3()
const objectWorldQuaternionScratch = new THREE.Quaternion()
const worldUpScratch = new THREE.Vector3(0, 1, 0)
const worldForwardScratch = new THREE.Vector3(0, 0, 1)

export function resolveMoveToSubjectType(options: {
  vehicleActive: boolean
  hasControlledCharacter: boolean
}): MoveToSubjectType {
  if (options.vehicleActive) {
    return 'vehicle'
  }
  if (options.hasControlledCharacter) {
    return 'character'
  }
  return 'camera'
}

export function buildMoveToTargetPose(
  targetPosition: THREE.Vector3,
  targetQuaternion: THREE.Quaternion,
): MoveToTargetPose {
  const forward = targetForwardScratch.set(1, 0, 0).applyQuaternion(targetQuaternion)
  if (forward.lengthSq() <= 1e-8) {
    forward.set(1, 0, 0)
  } else {
    forward.normalize()
  }
  const up = targetUpScratch.set(0, 1, 0).applyQuaternion(targetQuaternion)
  if (up.lengthSq() <= 1e-8) {
    up.set(0, 1, 0)
  } else {
    up.normalize()
  }
  targetRightScratch.crossVectors(up, forward)
  if (targetRightScratch.lengthSq() <= 1e-8) {
    targetRightScratch.crossVectors(worldUpScratch, forward)
  }
  if (targetRightScratch.lengthSq() <= 1e-8) {
    targetRightScratch.crossVectors(worldForwardScratch, forward)
  }
  if (targetRightScratch.lengthSq() <= 1e-8) {
    targetRightScratch.set(1, 0, 0)
  } else {
    targetRightScratch.normalize()
  }
  up.crossVectors(forward, targetRightScratch)
  if (up.lengthSq() <= 1e-8) {
    up.copy(worldUpScratch)
  } else {
    up.normalize()
  }
  targetMatrixScratch.makeBasis(targetRightScratch, up, forward)
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(targetMatrixScratch)
  return {
    position: targetPosition.clone(),
    forward: forward.clone(),
    up: up.clone(),
    quaternion,
  }
}

export function buildMoveToCameraPlacement(
  targetPose: MoveToTargetPose,
  options: {
    eyeHeight?: number
    forwardOffset?: number
  } = {},
): MoveToCameraPlacement {
  const eyeHeight = options.eyeHeight ?? MOVE_TO_CAMERA_EYE_HEIGHT
  const forwardOffset = options.forwardOffset ?? MOVE_TO_CAMERA_FORWARD_OFFSET
  const position = targetPose.position.clone()
    .addScaledVector(targetPose.up, eyeHeight)
    .addScaledVector(targetPose.forward, -forwardOffset)
  const lookAt = targetPose.position.clone()
    .addScaledVector(targetPose.forward, forwardOffset)
  return {
    position,
    lookAt,
    up: targetPose.up.clone(),
  }
}

export function applyMoveToObjectWorldPose(
  object: THREE.Object3D,
  worldPosition: THREE.Vector3,
  worldQuaternion: THREE.Quaternion,
): void {
  if (object.parent) {
    object.parent.updateWorldMatrix(true, false)
    object.parent.worldToLocal(objectWorldPositionScratch.copy(worldPosition))
    object.position.copy(objectWorldPositionScratch)
    object.parent.getWorldQuaternion(objectWorldQuaternionScratch).invert()
    object.quaternion.copy(objectWorldQuaternionScratch.multiply(worldQuaternion))
  } else {
    object.position.copy(worldPosition)
    object.quaternion.copy(worldQuaternion)
  }
  object.updateWorldMatrix(false, true)
}

export function createMoveToRuntimeSession(): MoveToRuntimeSession {
  return {
    active: false,
    token: null,
    subjectType: null,
    kinetics: false,
    targetNodeId: null,
    targetPosition: new THREE.Vector3(),
    targetForward: new THREE.Vector3(1, 0, 0),
    targetUp: new THREE.Vector3(0, 1, 0),
    targetQuaternion: new THREE.Quaternion(),
    cameraTargetPosition: new THREE.Vector3(),
    cameraTargetLookAt: new THREE.Vector3(),
  }
}

export function resetMoveToRuntimeSession(session: MoveToRuntimeSession): void {
  session.active = false
  session.token = null
  session.subjectType = null
  session.kinetics = false
  session.targetNodeId = null
  session.targetPosition.set(0, 0, 0)
  session.targetForward.set(1, 0, 0)
  session.targetUp.set(0, 1, 0)
  session.targetQuaternion.identity()
  session.cameraTargetPosition.set(0, 0, 0)
  session.cameraTargetLookAt.set(0, 0, 0)
}

export function applyMoveToTargetPose(
  session: MoveToRuntimeSession,
  targetNodeId: string,
  targetPose: MoveToTargetPose,
): void {
  session.targetNodeId = targetNodeId
  session.targetPosition.copy(targetPose.position)
  session.targetForward.copy(targetPose.forward)
  session.targetUp.copy(targetPose.up)
  session.targetQuaternion.copy(targetPose.quaternion)
}

export function applyMoveToCameraPlacement(
  session: MoveToRuntimeSession,
  placement: MoveToCameraPlacement,
): void {
  session.cameraTargetPosition.copy(placement.position)
  session.cameraTargetLookAt.copy(placement.lookAt)
}

export function syncMoveToRigidBodyFromObject(options: {
  body: PhysicsBodyLike
  object: THREE.Object3D
  orientationAdjustment?: PhysicsOrientationAdjustment | null
}): void {
  syncBodyFromObject(options.body, options.object, options.orientationAdjustment ?? null)
}
