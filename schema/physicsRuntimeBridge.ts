import type { Object3D } from 'three'
import type {
  PhysicsBodyLike,
  PhysicsOrientationAdjustment,
  PhysicsBodyBindingEntry,
} from './physicsBodySync'

export type PhysicsWorldLike = {
  addBody: (body: PhysicsBodyLike) => unknown
  removeBody?: (body: PhysicsBodyLike) => unknown
}

export type PhysicsBodyFactoryResult = {
  body: PhysicsBodyLike
  orientationAdjustment: PhysicsOrientationAdjustment | null
}

export type PhysicsBodyFactory = (
  node: unknown,
  component: unknown,
  shapeDefinition: unknown,
  object: Object3D,
) => PhysicsBodyFactoryResult | null

export function removePhysicsBodyBindingBodies(
  world: PhysicsWorldLike | null | undefined,
  binding: PhysicsBodyBindingEntry | null | undefined,
): void {
  if (!binding) {
    return
  }
  const bodies = binding.bodies.length > 0 ? binding.bodies : [binding.body]
  if (typeof world?.removeBody !== 'function') {
    return
  }
  for (const body of bodies) {
    world.removeBody(body)
  }
}

export function addPhysicsBodyToWorld(
  world: PhysicsWorldLike | null | undefined,
  body: PhysicsBodyLike | null | undefined,
): void {
  if (!world || !body) {
    return
  }
  world.addBody(body)
}

export function stopPhysicsBodyMotion(body: PhysicsBodyLike | null | undefined): void {
  if (!body) {
    return
  }
  body.velocity.set(0, 0, 0)
  body.angularVelocity.set(0, 0, 0)
}

export function sleepPhysicsBody(
  body: PhysicsBodyLike & {
    allowSleep?: boolean
    sleepSpeedLimit?: number
    sleepTimeLimit?: number
    sleep?: () => unknown
  } | null | undefined,
  options: { minSpeedLimit?: number; minTimeLimit?: number } = {},
): void {
  if (!body) {
    return
  }
  body.allowSleep = true
  if (typeof body.sleepSpeedLimit === 'number') {
    body.sleepSpeedLimit = Math.max(options.minSpeedLimit ?? 0.05, body.sleepSpeedLimit)
  }
  if (typeof body.sleepTimeLimit === 'number') {
    body.sleepTimeLimit = Math.max(options.minTimeLimit ?? 0.05, body.sleepTimeLimit)
  }
  body.sleep?.()
}
