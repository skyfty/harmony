import * as THREE from 'three'
import type { CapsuleCollisionWorld } from './capsuleCollision'

type FootIKLeg = {
  upper: THREE.Object3D
  lower: THREE.Object3D
  foot: THREE.Object3D
  target: THREE.Vector3
  normal: THREE.Vector3
  planted: boolean
}

export type NonPhysicsCharacterFootIK = {
  enabled: boolean
  restore(): void
  update(deltaSeconds: number, grounded: boolean, moving: boolean): void
  dispose(): void
}

type SavedPose = { position: THREE.Vector3; quaternion: THREE.Quaternion }

const UP = new THREE.Vector3(0, 1, 0)
const TEMP_VECTOR_A = new THREE.Vector3()
const TEMP_VECTOR_B = new THREE.Vector3()
const TEMP_VECTOR_C = new THREE.Vector3()
const TEMP_QUATERNION_A = new THREE.Quaternion()
const TEMP_QUATERNION_B = new THREE.Quaternion()

function findBone(root: THREE.Object3D, patterns: RegExp[]): THREE.Object3D | null {
  let result: THREE.Object3D | null = null
  root.traverse((object) => {
    if (result || !object.name) return
    const name = object.name.toLowerCase()
    if (patterns.some((pattern) => pattern.test(name))) result = object
  })
  return result
}

function worldDirection(object: THREE.Object3D, target: THREE.Vector3): THREE.Vector3 {
  object.getWorldDirection(target)
  return target.normalize()
}

function rotateWorldObjectToDirection(
  object: THREE.Object3D,
  from: THREE.Vector3,
  to: THREE.Vector3,
): void {
  if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return
  TEMP_QUATERNION_A.setFromUnitVectors(from.normalize(), to.normalize())
  object.getWorldQuaternion(TEMP_QUATERNION_B)
  const nextWorldQuaternion = TEMP_QUATERNION_A.multiply(TEMP_QUATERNION_B)
  if (object.parent) {
    object.parent.getWorldQuaternion(TEMP_QUATERNION_B).invert()
    object.quaternion.copy(TEMP_QUATERNION_B.multiply(nextWorldQuaternion))
  } else {
    object.quaternion.copy(nextWorldQuaternion)
  }
  object.updateWorldMatrix(true, true)
}

function alignFootToNormal(foot: THREE.Object3D, normal: THREE.Vector3): void {
  const currentUp = worldDirection(foot, TEMP_VECTOR_A).setY(0)
  if (currentUp.lengthSq() < 1e-8) currentUp.copy(UP)
  const targetUp = normal.clone().normalize()
  TEMP_QUATERNION_A.setFromUnitVectors(UP, targetUp)
  foot.getWorldQuaternion(TEMP_QUATERNION_B)
  const nextWorldQuaternion = TEMP_QUATERNION_A.multiply(TEMP_QUATERNION_B)
  if (foot.parent) {
    foot.parent.getWorldQuaternion(TEMP_QUATERNION_B).invert()
    foot.quaternion.copy(TEMP_QUATERNION_B.multiply(nextWorldQuaternion))
  } else {
    foot.quaternion.copy(nextWorldQuaternion)
  }
}

function capturePose(object: THREE.Object3D, poses: Map<THREE.Object3D, SavedPose>): void {
  if (!poses.has(object)) {
    poses.set(object, { position: object.position.clone(), quaternion: object.quaternion.clone() })
  }
}

export function createNonPhysicsCharacterFootIK(
  root: THREE.Object3D,
  collisionWorld: CapsuleCollisionWorld,
  options: { enabled?: boolean; maxDistance?: number; soleOffset?: number } = {},
): NonPhysicsCharacterFootIK {
  const hips = findBone(root, [/^hips?$/, /pelvis/, /臀/, /骨盆/])
  const leftUpper = findBone(root, [/left.*(upleg|thigh)/, /(upleg|thigh).*left/, /左.*(大腿|腿)/])
  const leftLower = findBone(root, [/left.*(leg|shin|calf)/, /(leg|shin|calf).*left/, /左.*(小腿|腿)/])
  const leftFoot = findBone(root, [/left.*foot/, /foot.*left/, /左.*脚/])
  const rightUpper = findBone(root, [/right.*(upleg|thigh)/, /(upleg|thigh).*right/, /右.*(大腿|腿)/])
  const rightLower = findBone(root, [/right.*(leg|shin|calf)/, /(leg|shin|calf).*right/, /右.*(小腿|腿)/])
  const rightFoot = findBone(root, [/right.*foot/, /foot.*right/, /右.*脚/])
  const legs: FootIKLeg[] = []
  if (leftUpper && leftLower && leftFoot) {
    legs.push({ upper: leftUpper, lower: leftLower, foot: leftFoot, target: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), planted: false })
  }
  if (rightUpper && rightLower && rightFoot) {
    legs.push({ upper: rightUpper, lower: rightLower, foot: rightFoot, target: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), planted: false })
  }

  const poses = new Map<THREE.Object3D, SavedPose>()
  const enabled = options.enabled !== false && legs.length > 0
  const maxDistance = Math.max(0.25, options.maxDistance ?? 1.5)
  const soleOffset = options.soleOffset ?? 0.02

  return {
    enabled,
    restore() {
      poses.forEach((pose, object) => {
        object.position.copy(pose.position)
        object.quaternion.copy(pose.quaternion)
      })
      poses.clear()
      root.updateMatrixWorld(true)
    },
    update(deltaSeconds, grounded, moving) {
      if (!enabled || !grounded) return
      root.updateMatrixWorld(true)
      const hits: Array<{ leg: FootIKLeg; hit: NonNullable<ReturnType<CapsuleCollisionWorld['probeGround']>> }> = []
      let pelvisOffset = 0
      for (const leg of legs) {
        const footWorld = leg.foot.getWorldPosition(TEMP_VECTOR_A)
        const hit = collisionWorld.probeGround(
          TEMP_VECTOR_B.copy(footWorld).addScaledVector(UP, 0.15),
          maxDistance,
        )
        if (!hit) {
          leg.planted = false
          continue
        }
        leg.planted = !moving
        leg.target.copy(hit.point).addScaledVector(hit.normal, soleOffset)
        leg.normal.copy(hit.normal)
        pelvisOffset += leg.target.y - footWorld.y
        hits.push({ leg, hit })
      }
      if (!hits.length) return

      if (hips) {
        capturePose(hips, poses)
        hips.position.y += THREE.MathUtils.clamp(
          pelvisOffset / hits.length,
          -0.2,
          0.2,
        ) * Math.min(1, deltaSeconds * 12)
        hips.updateWorldMatrix(true, true)
      }

      for (const { leg } of hits) {
        capturePose(leg.upper, poses)
        capturePose(leg.lower, poses)
        capturePose(leg.foot, poses)
        const upperWorld = leg.upper.getWorldPosition(TEMP_VECTOR_A)
        const lowerWorld = leg.lower.getWorldPosition(TEMP_VECTOR_B)
        const footWorld = leg.foot.getWorldPosition(TEMP_VECTOR_C)
        const upperLength = upperWorld.distanceTo(lowerWorld)
        const lowerLength = lowerWorld.distanceTo(footWorld)
        const toTarget = leg.target.clone().sub(upperWorld)
        const maxReach = Math.max(0.01, upperLength + lowerLength - 0.01)
        if (toTarget.length() > maxReach) toTarget.setLength(maxReach)
        rotateWorldObjectToDirection(leg.upper, lowerWorld.sub(upperWorld), toTarget)
        root.updateMatrixWorld(true)
        const nextLowerWorld = leg.lower.getWorldPosition(TEMP_VECTOR_B)
        const nextFootWorld = leg.foot.getWorldPosition(TEMP_VECTOR_C)
        rotateWorldObjectToDirection(leg.lower, nextFootWorld.sub(nextLowerWorld), leg.target.clone().sub(nextLowerWorld))
        root.updateMatrixWorld(true)
        alignFootToNormal(leg.foot, leg.normal)
      }
      root.updateMatrixWorld(true)
    },
    dispose() {
      poses.clear()
      legs.length = 0
    },
  }
}

