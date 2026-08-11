import * as THREE from 'three'
import type { CharacterControllerComponentProps } from './components/definitions/characterControllerComponent'
import { writeCharacterLocalForward } from './components/definitions/characterControllerComponent'
import type { CapsuleCollisionWorld, CapsuleInfo } from './capsuleCollision'

export type NonPhysicsCharacterState = {
  nodeId: string
  object: THREE.Object3D
  props: CharacterControllerComponentProps
  capsule: CapsuleInfo
  velocity: THREE.Vector3
  moveDirection: THREE.Vector3
  facingDirection: THREE.Vector3
  cameraForward: THREE.Vector3
  cameraRight: THREE.Vector3
  grounded: boolean
  jumpConsumed: boolean
  yaw: number
  initialized: boolean
}

export type NonPhysicsCharacterInput = {
  moveX: number
  moveZ: number
  turn: number
  jump: boolean
  sprint: boolean
  crouch: boolean
  interact: boolean
  camera: THREE.Camera
}

export type NonPhysicsCharacterResult = {
  grounded: boolean
  justLanded: boolean
  justJumped: boolean
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  velocity: THREE.Vector3
}

const UP = new THREE.Vector3(0, 1, 0)
const DEFAULT_GRAVITY = -9.8
const TEMP_QUATERNION = new THREE.Quaternion()

function approach(current: number, target: number, amount: number): number {
  if (current < target) return Math.min(target, current + amount)
  return Math.max(target, current - amount)
}

function approachAngle(current: number, target: number, amount: number): number {
  const delta = THREE.MathUtils.euclideanModulo(target - current + Math.PI, Math.PI * 2) - Math.PI
  return current + THREE.MathUtils.clamp(delta, -amount, amount)
}

function resolveInitialYaw(object: THREE.Object3D, props: CharacterControllerComponentProps): number {
  object.getWorldQuaternion(TEMP_QUATERNION)
  const localForward = new THREE.Vector3()
  writeCharacterLocalForward(localForward, props.forwardAxis)
  const worldForward = localForward.applyQuaternion(TEMP_QUATERNION).setY(0)
  return worldForward.lengthSq() > 1e-8 ? Math.atan2(worldForward.x, worldForward.z) : 0
}

export function createNonPhysicsCharacterState(params: {
  nodeId: string
  object: THREE.Object3D
  props: CharacterControllerComponentProps
}): NonPhysicsCharacterState {
  const { nodeId, object, props } = params
  const radius = Math.max(0.05, props.colliderRadius)
  const height = Math.max(radius * 2, props.colliderHeight)
  const segmentHeight = Math.max(0, height - radius * 2)
  const segment = new THREE.Line3(
    new THREE.Vector3(0, radius, 0),
    new THREE.Vector3(0, radius + segmentHeight, 0),
  )
  return {
    nodeId,
    object,
    props,
    capsule: { segment, radius },
    velocity: new THREE.Vector3(),
    moveDirection: new THREE.Vector3(),
    facingDirection: new THREE.Vector3(),
    cameraForward: new THREE.Vector3(),
    cameraRight: new THREE.Vector3(),
    grounded: false,
    jumpConsumed: false,
    yaw: resolveInitialYaw(object, props),
    initialized: false,
  }
}

export function resetNonPhysicsCharacterState(
  state: NonPhysicsCharacterState,
  position?: THREE.Vector3,
  quaternion?: THREE.Quaternion,
): void {
  if (position) state.object.position.copy(position)
  if (quaternion) state.object.quaternion.copy(quaternion)
  state.velocity.set(0, 0, 0)
  state.grounded = false
  state.jumpConsumed = false
  state.object.updateMatrixWorld(true)
}

export function updateNonPhysicsCharacter(
  state: NonPhysicsCharacterState,
  input: NonPhysicsCharacterInput,
  collisionWorld: CapsuleCollisionWorld,
  rawDeltaSeconds: number,
): NonPhysicsCharacterResult {
  const deltaSeconds = THREE.MathUtils.clamp(rawDeltaSeconds, 0, 1 / 30)
  const wasGrounded = state.grounded
  const props = state.props
  const inputMagnitude = Math.min(1, Math.hypot(input.moveX, input.moveZ))

  input.camera.getWorldDirection(state.cameraForward)
  state.cameraForward.y = 0
  if (state.cameraForward.lengthSq() < 1e-8) state.cameraForward.set(0, 0, -1)
  else state.cameraForward.normalize()
  state.cameraRight.crossVectors(state.cameraForward, UP).normalize()
  state.moveDirection.copy(state.cameraForward)
    .multiplyScalar(input.moveZ)
    .addScaledVector(state.cameraRight, input.moveX)
  if (state.moveDirection.lengthSq() > 1e-8) state.moveDirection.normalize()
  else state.moveDirection.set(0, 0, 0)

  let speed = props.walkSpeed
  if (input.crouch) speed *= 0.4
  else if (input.sprint && inputMagnitude > 0.05) speed = props.sprintSpeed
  else if (inputMagnitude >= 0.85) speed = props.sprintSpeed
  else if (inputMagnitude >= 0.5) speed = props.runSpeed

  const targetX = state.moveDirection.x * speed
  const targetZ = state.moveDirection.z * speed
  const hasInput = state.moveDirection.lengthSq() > 1e-8
  const acceleration = Math.max(0, (hasInput ? 30 : 30) * Math.max(speed, 1) * deltaSeconds)
  state.velocity.x = approach(state.velocity.x, targetX, acceleration)
  state.velocity.z = approach(state.velocity.z, targetZ, acceleration)

  const groundProbe = collisionWorld.probeGround(
    state.object.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.05, 0)),
    Math.max(0.2, props.stepHeight + state.capsule.radius + 0.15),
  )
  const minGroundNormalY = Math.cos(THREE.MathUtils.degToRad(props.slopeLimitDegrees))
  const probeGrounded = Boolean(
    groundProbe
    && groundProbe.distance <= props.stepHeight + 0.08
    && groundProbe.normal.y >= minGroundNormalY,
  )
  if (probeGrounded && state.velocity.y <= 0) {
    state.grounded = true
    state.velocity.y = 0
    const currentWorldY = state.object.getWorldPosition(new THREE.Vector3()).y
    const targetWorldY = groundProbe!.point.y + state.capsule.radius
    const correction = targetWorldY - currentWorldY
    if (Math.abs(correction) <= props.stepHeight + 0.2) state.object.position.y += correction
  } else {
    state.grounded = false
  }

  let justJumped = false
  if (input.jump && state.grounded && !state.jumpConsumed) {
    state.velocity.y = Math.max(0, props.jumpImpulse)
    state.grounded = false
    state.jumpConsumed = true
    justJumped = true
  } else if (!input.jump) {
    state.jumpConsumed = false
  }
  if (!state.grounded) state.velocity.y += DEFAULT_GRAVITY * deltaSeconds

  const move = new THREE.Vector3(
    state.velocity.x * deltaSeconds,
    state.velocity.y * deltaSeconds,
    state.velocity.z * deltaSeconds,
  )
  const distance = move.length()
  const stepCount = Math.max(1, Math.ceil(distance / Math.max(0.01, state.capsule.radius * 0.8)))
  const stepMove = move.multiplyScalar(1 / stepCount)
  for (let i = 0; i < stepCount; i += 1) {
    state.object.position.add(stepMove)
    state.object.updateMatrixWorld(true)
    const hits = collisionWorld.resolveCapsule(state.object, state.capsule)
    for (const hit of hits) {
      state.object.position.addScaledVector(hit.normal, hit.depth)
      state.object.updateMatrixWorld(true)
      if (state.velocity.dot(hit.normal) < 0) {
        state.velocity.addScaledVector(hit.normal, -state.velocity.dot(hit.normal))
      }
    }
  }

  if (state.moveDirection.lengthSq() > 1e-8) {
    const targetYaw = Math.atan2(state.moveDirection.x, state.moveDirection.z)
    state.yaw = approachAngle(
      state.yaw,
      targetYaw,
      THREE.MathUtils.degToRad(props.turnRateDegreesPerSecond) * deltaSeconds,
    )
  } else if (Math.abs(input.turn) > 1e-4) {
    state.yaw += THREE.MathUtils.degToRad(props.turnRateDegreesPerSecond) * input.turn * deltaSeconds
  }

  const localForward = new THREE.Vector3()
  writeCharacterLocalForward(localForward, props.forwardAxis)
  const targetDirection = new THREE.Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw))
  const baseYaw = Math.atan2(localForward.x, localForward.z)
  state.object.getWorldQuaternion(TEMP_QUATERNION)
  const worldYaw = Math.atan2(targetDirection.x, targetDirection.z)
  const rotation = new THREE.Euler(0, worldYaw - baseYaw, 0)
  state.object.quaternion.setFromEuler(rotation)
  state.object.updateMatrixWorld(true)
  state.initialized = true

  if (state.grounded) state.velocity.y = 0
  return {
    grounded: state.grounded,
    justLanded: !wasGrounded && state.grounded,
    justJumped,
    position: state.object.getWorldPosition(new THREE.Vector3()),
    quaternion: state.object.getWorldQuaternion(new THREE.Quaternion()),
    velocity: state.velocity.clone(),
  }
}
