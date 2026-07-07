import { rotateVectorByQuaternion } from './worldMath'
import type { PhysicsCharacterDesc, PhysicsQuaternion } from './types'

export type PhysicsCharacterMotorGroundProbe = {
  hit: boolean
  distance: number
  normalY: number
  normal?: [number, number, number]
}

export type PhysicsCharacterMotorState = {
  grounded: boolean
  jumpBuffered: boolean
  verticalVelocity: number
  yaw: number
  coyoteTimeRemaining: number
}

export type PhysicsCharacterMotorInput = {
  moveX: number
  moveZ: number
  yaw?: number | null
  jump: boolean
  sprint: boolean
  crouch: boolean
  interact?: boolean
  deltaSeconds: number
  gravityY: number
  probe: PhysicsCharacterMotorGroundProbe
  contactNormalY?: number | null
}

export type PhysicsCharacterMotorStepResult = {
  yaw: number
  grounded: boolean
  linearVelocity: [number, number, number]
}

const COYOTE_TIME_SECONDS = 0.12
const GROUND_PROBE_EPSILON = 0.08
const GROUND_SNAP_DISTANCE = 0.18
const GROUND_STICK_VELOCITY = -2

export function createPhysicsCharacterMotorState(initialYaw = Math.PI): PhysicsCharacterMotorState {
  return {
    grounded: false,
    jumpBuffered: false,
    verticalVelocity: 0,
    yaw: initialYaw,
    coyoteTimeRemaining: 0,
  }
}

export function resolvePhysicsCharacterMotorYawFromWorldQuaternion(
  quaternion: PhysicsQuaternion | { x?: number; y?: number; z?: number; w?: number } | null | undefined,
  forwardAxis: PhysicsCharacterDesc['forwardAxis'],
): number {
  const localForward = resolveCharacterLocalForwardVector(forwardAxis)
  const worldForward = rotateVectorByQuaternion(localForward, quaternion)
  const horizontalLength = Math.hypot(worldForward[0], worldForward[2])
  if (!(horizontalLength > 1e-6)) {
    return Math.PI
  }
  return Math.atan2(worldForward[0], worldForward[2])
}

export function stepPhysicsCharacterMotor(
  desc: PhysicsCharacterDesc,
  state: PhysicsCharacterMotorState,
  input: PhysicsCharacterMotorInput,
): PhysicsCharacterMotorStepResult {
  const deltaSeconds = Number.isFinite(input.deltaSeconds) ? Math.max(0, input.deltaSeconds) : 0
  const slopeLimitRadians = (Math.max(0, Math.min(89, desc.slopeLimitDegrees)) * Math.PI) / 180
  const minGroundNormalY = Math.cos(slopeLimitRadians)
  const probeGrounded = input.probe.hit
    && input.probe.distance <= (Math.max(0.01, desc.stepHeight) + GROUND_PROBE_EPSILON)
    && input.probe.normalY >= minGroundNormalY
  const contactGrounded = Number.isFinite(input.contactNormalY ?? NaN)
    ? (input.contactNormalY as number) >= minGroundNormalY
    : false
  const grounded = probeGrounded || contactGrounded
  const groundNormal = resolveGroundNormal(input)

  if (typeof input.yaw === 'number' && Number.isFinite(input.yaw)) {
    state.yaw = input.yaw
  }
  if (grounded) {
    state.coyoteTimeRemaining = COYOTE_TIME_SECONDS
    if (state.verticalVelocity < 0) {
      state.verticalVelocity = 0
    }
  } else if (deltaSeconds > 0) {
    state.coyoteTimeRemaining = Math.max(0, state.coyoteTimeRemaining - deltaSeconds)
  }

  const movementMagnitude = Math.min(1, Math.hypot(input.moveX, input.moveZ))
  const speed = resolveCharacterSpeed(desc, movementMagnitude, input)
  const forwardX = Math.sin(state.yaw)
  const forwardZ = Math.cos(state.yaw)
  const rightX = -forwardZ
  const rightZ = forwardX
  let planarX = forwardX * input.moveZ + rightX * input.moveX
  let planarZ = forwardZ * input.moveZ + rightZ * input.moveX
  const planarLength = Math.hypot(planarX, planarZ)
  if (planarLength > 1e-6) {
    planarX /= planarLength
    planarZ /= planarLength
    if (grounded && groundNormal) {
      const projected = projectDirectionOntoGround([planarX, 0, planarZ], groundNormal)
      const projectedLength = Math.hypot(projected[0], projected[2])
      if (projectedLength > 1e-6) {
        planarX = projected[0] / projectedLength
        planarZ = projected[2] / projectedLength
      }
    }
    planarX *= speed
    planarZ *= speed
  } else {
    planarX = 0
    planarZ = 0
  }

  if (!grounded && desc.airControl < 1) {
    const airControl = Math.max(0, Math.min(1, desc.airControl))
    planarX *= airControl
    planarZ *= airControl
  }

  if (input.jump && (grounded || state.coyoteTimeRemaining > 0)) {
    state.verticalVelocity = Math.max(0, desc.jumpImpulse)
    state.coyoteTimeRemaining = 0
    state.jumpBuffered = true
  } else {
    state.jumpBuffered = false
  }

  if (!grounded && deltaSeconds > 0) {
    state.verticalVelocity += input.gravityY * deltaSeconds
  } else if (grounded && !state.jumpBuffered) {
    state.verticalVelocity = Math.min(0, state.verticalVelocity)
    if (probeGrounded && input.probe.distance <= GROUND_SNAP_DISTANCE) {
      state.verticalVelocity = Math.min(0, Math.max(state.verticalVelocity, GROUND_STICK_VELOCITY))
    }
  }

  state.grounded = grounded && !state.jumpBuffered
  return {
    yaw: state.yaw,
    grounded: state.grounded,
    linearVelocity: [planarX, state.verticalVelocity, planarZ],
  }
}

function resolveCharacterSpeed(
  desc: PhysicsCharacterDesc,
  movementMagnitude: number,
  input: Pick<PhysicsCharacterMotorInput, 'crouch' | 'sprint'>,
): number {
  if (input.crouch) {
    return Math.max(0, desc.walkSpeed * 0.4)
  }
  if (input.sprint && movementMagnitude > 0.05) {
    return Math.max(0, desc.sprintSpeed)
  }
  if (movementMagnitude >= 0.85) {
    return Math.max(0, desc.sprintSpeed)
  }
  if (movementMagnitude >= 0.5) {
    return Math.max(0, desc.runSpeed)
  }
  return Math.max(0, desc.walkSpeed)
}

function resolveGroundNormal(
  input: Pick<PhysicsCharacterMotorInput, 'probe' | 'contactNormalY'>,
): [number, number, number] | null {
  const probeNormal = input.probe.normal
  if (Array.isArray(probeNormal)) {
    const normalized = normalizeVector(probeNormal)
    if (normalized[1] > 1e-4) {
      return normalized
    }
  }
  if (typeof input.contactNormalY === 'number' && Number.isFinite(input.contactNormalY) && input.contactNormalY > 1e-4) {
    const horizontalScale = Math.sqrt(Math.max(0, 1 - input.contactNormalY * input.contactNormalY))
    return normalizeVector([0, input.contactNormalY, horizontalScale])
  }
  return null
}

function projectDirectionOntoGround(
  direction: [number, number, number],
  normal: [number, number, number],
): [number, number, number] {
  const dot = direction[0] * normal[0] + direction[1] * normal[1] + direction[2] * normal[2]
  return [
    direction[0] - normal[0] * dot,
    direction[1] - normal[1] * dot,
    direction[2] - normal[2] * dot,
  ]
}

function normalizeVector(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2])
  if (!(length > 1e-6)) {
    return [0, 1, 0]
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

function resolveCharacterLocalForwardVector(forwardAxis: PhysicsCharacterDesc['forwardAxis']): [number, number, number] {
  switch (forwardAxis) {
    case '-x':
      return [-1, 0, 0]
    case '+z':
      return [0, 0, 1]
    case '-z':
      return [0, 0, -1]
    case '+x':
    default:
      return [1, 0, 0]
  }
}
