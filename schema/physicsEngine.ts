import * as THREE from 'three'
// @ts-expect-error Ammo wasm module ships without type definitions
import AmmoFactory from 'three/examples/jsm/libs/ammo.wasm.js'
import type { SceneNode } from '@harmony/schema'
import type { RigidbodyPhysicsShape, RigidbodyVector3Tuple } from './components/definitions/rigidbodyComponent'

type AmmoModule = Awaited<ReturnType<typeof AmmoFactory>>

export type PhysicsContactSettings = {
  gravity?: RigidbodyVector3Tuple
  defaultMaterial?: Partial<RigidbodyMaterialEntry>
}

export type RigidbodyMaterialEntry = {
  friction: number
  restitution: number
}

export type RigidbodyOrientationAdjustment = {
  offset?: THREE.Vector3
  quaternion?: THREE.Quaternion
}

export type GroundHeightfieldCacheEntry = {
  signature: string
  shape: AmmoModule['btHeightfieldTerrainShape']
}

export type RigidbodyInstance = {
  nodeId: string
  object: THREE.Object3D
  body: AmmoModule['btRigidBody']
  shape: AmmoModule['btCollisionShape']
  shapeDefinition: RigidbodyPhysicsShape | null
}

type PhysicsWorldContext = {
  Ammo: AmmoModule
  world: AmmoModule['btDiscreteDynamicsWorld']
  configuration: AmmoModule['btDefaultCollisionConfiguration']
  dispatcher: AmmoModule['btCollisionDispatcher']
  broadphase: AmmoModule['btDbvtBroadphase']
  solver: AmmoModule['btSequentialImpulseConstraintSolver']
}

const DEFAULT_GRAVITY: RigidbodyVector3Tuple = [0, -9.81, 0]
const DEFAULT_MATERIAL: RigidbodyMaterialEntry = { friction: 0.8, restitution: 0.05 }
const MIN_HALF_EXTENT = 1e-3
const FIXED_TIME_STEP = 1 / 60
const MAX_SUB_STEPS = 5

let ammoPromise: Promise<AmmoModule> | null = null
let physicsContext: PhysicsWorldContext | null = null
const heightfieldCache = new Map<string, GroundHeightfieldCacheEntry>()

function ensureAmmo(): Promise<AmmoModule> {
  if (!ammoPromise) {
    const wasmUrl = new URL('three/examples/jsm/libs/ammo.wasm.wasm', import.meta.url).href
    ammoPromise = AmmoFactory({
      locateFile(path: string) {
        if (path.endsWith('.wasm')) {
          return wasmUrl
        }
        return new URL(`three/examples/jsm/libs/${path}`, import.meta.url).href
      },
    }) as Promise<AmmoModule>
  }
  return ammoPromise
}

function toBtVec(ammo: AmmoModule, tuple: RigidbodyVector3Tuple): AmmoModule['btVector3'] {
  return new ammo.btVector3(tuple[0], tuple[1], tuple[2])
}

function makeCompoundWithOffset(
  ammo: AmmoModule,
  shape: AmmoModule['btCollisionShape'],
  offset: RigidbodyVector3Tuple,
): AmmoModule['btCompoundShape'] {
  const compound = new ammo.btCompoundShape()
  const transform = new ammo.btTransform()
  transform.setIdentity()
  transform.setOrigin(toBtVec(ammo, offset))
  compound.addChildShape(transform, shape)
  return compound
}

function computeHeightfieldSignature(shape: Extract<RigidbodyPhysicsShape, { kind: 'heightfield' }>): string {
  const rows = shape.matrix.length
  const cols = shape.matrix[0]?.length ?? 0
  let hash = 0
  for (let r = 0; r < rows; r += 1) {
    const row = shape.matrix[r] ?? []
    for (let c = 0; c < cols; c += 1) {
      const value = Math.round((row[c] ?? 0) * 1000)
      hash = (hash * 31 + value) >>> 0
    }
  }
  return [rows, cols, Math.round(shape.elementSize * 1000), Math.round(shape.width * 1000), Math.round(shape.depth * 1000), hash.toString(16)].join('|')
}

function buildBoxShape(
  ammo: AmmoModule,
  shape: Extract<RigidbodyPhysicsShape, { kind: 'box' }>,
  object: THREE.Object3D,
): AmmoModule['btCollisionShape'] {
  const worldScale = new THREE.Vector3()
  object.getWorldScale(worldScale)
  const extents = new ammo.btVector3(
    Math.max(MIN_HALF_EXTENT, Math.abs(shape.halfExtents[0] * worldScale.x)),
    Math.max(MIN_HALF_EXTENT, Math.abs(shape.halfExtents[1] * worldScale.y)),
    Math.max(MIN_HALF_EXTENT, Math.abs(shape.halfExtents[2] * worldScale.z)),
  )
  const box = new ammo.btBoxShape(extents)
  if (shape.offset) {
    return makeCompoundWithOffset(ammo, box, shape.offset)
  }
  return box
}

function buildConvexHullShape(
  ammo: AmmoModule,
  shape: Extract<RigidbodyPhysicsShape, { kind: 'convex' }>,
  object: THREE.Object3D,
): AmmoModule['btCollisionShape'] {
  const hull = new ammo.btConvexHullShape()
  const worldScale = new THREE.Vector3()
  object.getWorldScale(worldScale)
  for (const vertex of shape.vertices) {
    const vec = new ammo.btVector3(
      vertex[0] * worldScale.x,
      vertex[1] * worldScale.y,
      vertex[2] * worldScale.z,
    )
    hull.addPoint(vec, true)
  }
  if (shape.offset) {
    return makeCompoundWithOffset(ammo, hull, shape.offset)
  }
  return hull
}

function buildHeightfieldShape(
  ammo: AmmoModule,
  shape: Extract<RigidbodyPhysicsShape, { kind: 'heightfield' }>,
): AmmoModule['btCollisionShape'] {
  const signature = computeHeightfieldSignature(shape)
  const cached = heightfieldCache.get(signature)
  if (cached) {
    return cached.shape
  }
  const width = Math.max(1, shape.matrix.length)
  const depth = Math.max(1, shape.matrix[0]?.length ?? 1)
  const data = new Float32Array(width * depth)
  let minHeight = Number.POSITIVE_INFINITY
  let maxHeight = Number.NEGATIVE_INFINITY
  for (let x = 0; x < width; x += 1) {
    const column = shape.matrix[x] ?? []
    for (let z = 0; z < depth; z += 1) {
      const value = column[z] ?? 0
      const index = x * depth + z
      data[index] = value
      if (value < minHeight) {
        minHeight = value
      }
      if (value > maxHeight) {
        maxHeight = value
      }
    }
  }
  if (!Number.isFinite(minHeight)) {
    minHeight = 0
  }
  if (!Number.isFinite(maxHeight)) {
    maxHeight = 0
  }
  const heightScale = 1
  const upAxis = 1
  const dataType = ammo.PHY_FLOAT
  const flipQuadEdges = false
  const heightfield = new ammo.btHeightfieldTerrainShape(width, depth, data, heightScale, minHeight, maxHeight, upAxis, dataType, flipQuadEdges)
  const scaling = new ammo.btVector3(shape.elementSize, 1, shape.elementSize)
  heightfield.setLocalScaling(scaling)
  if (shape.offset) {
    const compound = makeCompoundWithOffset(ammo, heightfield, shape.offset)
    heightfieldCache.set(signature, { signature, shape: compound as unknown as AmmoModule['btHeightfieldTerrainShape'] })
    return compound
  }
  heightfieldCache.set(signature, { signature, shape: heightfield })
  return heightfield
}

function buildCollisionShape(
  ammo: AmmoModule,
  definition: RigidbodyPhysicsShape | null,
  object: THREE.Object3D,
): AmmoModule['btCollisionShape'] {
  if (definition?.kind === 'box') {
    return buildBoxShape(ammo, definition, object)
  }
  if (definition?.kind === 'convex') {
    return buildConvexHullShape(ammo, definition, object)
  }
  if (definition?.kind === 'heightfield') {
    return buildHeightfieldShape(ammo, definition)
  }
  // Fallback to a small box when no shape is supplied.
  return new ammo.btBoxShape(new ammo.btVector3(0.5, 0.5, 0.5))
}

export async function ensurePhysicsWorld(settings?: PhysicsContactSettings): Promise<PhysicsWorldContext> {
  if (physicsContext) {
    if (settings?.gravity) {
      const [gx, gy, gz] = settings.gravity
      physicsContext.world.setGravity(new physicsContext.Ammo.btVector3(gx, gy, gz))
    }
    return physicsContext
  }
  const Ammo = await ensureAmmo()
  const configuration = new Ammo.btDefaultCollisionConfiguration()
  const dispatcher = new Ammo.btCollisionDispatcher(configuration)
  const broadphase = new Ammo.btDbvtBroadphase()
  const solver = new Ammo.btSequentialImpulseConstraintSolver()
  const world = new Ammo.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, configuration)
  const gravity = settings?.gravity ?? DEFAULT_GRAVITY
  world.setGravity(toBtVec(Ammo, gravity))
  physicsContext = { Ammo, world, configuration, dispatcher, broadphase, solver }
  return physicsContext
}

export function resetPhysicsWorld(): void {
  if (physicsContext?.world) {
    const world = physicsContext.world
    const numBodies = world.getNumCollisionObjects()
    for (let i = numBodies - 1; i >= 0; i -= 1) {
      const obj = world.getCollisionObjectArray().at(i)
      world.removeCollisionObject(obj)
    }
  }
  physicsContext = null
  heightfieldCache.clear()
}

function createTransform(ammo: AmmoModule, object: THREE.Object3D): AmmoModule['btTransform'] {
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  object.updateMatrixWorld(true)
  object.getWorldPosition(position)
  object.getWorldQuaternion(quaternion)
  const transform = new ammo.btTransform()
  transform.setIdentity()
  transform.setOrigin(new ammo.btVector3(position.x, position.y, position.z))
  transform.setRotation(new ammo.btQuaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w))
  return transform
}

function applyMaterial(body: AmmoModule['btRigidBody'], material: Partial<RigidbodyMaterialEntry> | undefined): void {
  const friction = typeof material?.friction === 'number' ? material.friction : DEFAULT_MATERIAL.friction
  const restitution = typeof material?.restitution === 'number' ? material.restitution : DEFAULT_MATERIAL.restitution
  body.setFriction(friction)
  body.setRestitution(restitution)
}

export async function createRigidbodyBody(options: {
  nodeId: string
  object: THREE.Object3D
  shape: RigidbodyPhysicsShape | null
  mass?: number
  material?: Partial<RigidbodyMaterialEntry>
  contactSettings?: PhysicsContactSettings
}): Promise<RigidbodyInstance | null> {
  const context = await ensurePhysicsWorld(options.contactSettings)
  const { Ammo, world } = context
  const shape = buildCollisionShape(Ammo, options.shape, options.object)
  const mass = Math.max(0, options.mass ?? 0)
  const transform = createTransform(Ammo, options.object)
  const motionState = new Ammo.btDefaultMotionState(transform)
  const localInertia = new Ammo.btVector3(0, 0, 0)
  if (mass > 0) {
    shape.calculateLocalInertia(mass, localInertia)
  }
  const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia)
  const body = new Ammo.btRigidBody(rbInfo)
  applyMaterial(body, options.material)
  body.setActivationState(Ammo.DISABLE_DEACTIVATION)
  world.addRigidBody(body)
  return {
    nodeId: options.nodeId,
    object: options.object,
    body,
    shape,
    shapeDefinition: options.shape,
  }
}

export function syncBodyFromObject(instance: RigidbodyInstance): void {
  if (!physicsContext?.Ammo) {
    return
  }
  const Ammo = physicsContext.Ammo
  const transform = createTransform(Ammo, instance.object)
  instance.body.setWorldTransform(transform)
  const motionState = instance.body.getMotionState()
  motionState?.setWorldTransform(transform)
}

export function syncObjectFromBody(instance: RigidbodyInstance, onSyncInstanced?: (object: THREE.Object3D) => void): void {
  if (!physicsContext?.Ammo) {
    return
  }
  const Ammo = physicsContext.Ammo
  const motionState = instance.body.getMotionState()
  if (!motionState) {
    return
  }
  const transform = new Ammo.btTransform()
  motionState.getWorldTransform(transform)
  const origin = transform.getOrigin()
  const rotation = transform.getRotation()
  instance.object.position.set(origin.x(), origin.y(), origin.z())
  instance.object.quaternion.set(rotation.x(), rotation.y(), rotation.z(), rotation.w())
  instance.object.updateMatrixWorld(true)
  if (onSyncInstanced) {
    onSyncInstanced(instance.object)
  }
}

export function destroyRigidbodyInstance(instance: RigidbodyInstance): void {
  if (!physicsContext?.world) {
    return
  }
  physicsContext.world.removeRigidBody(instance.body)
  if (physicsContext.Ammo?.destroy) {
    const Ammo = physicsContext.Ammo
    const motionState = instance.body.getMotionState()
    if (motionState) {
      Ammo.destroy(motionState)
    }
    Ammo.destroy(instance.body)
  }
}

export function stepPhysicsWorld(delta: number): void {
  if (!physicsContext?.world) {
    return
  }
  const clampedDelta = Math.max(0, Math.min(delta, 1))
  try {
    physicsContext.world.stepSimulation(clampedDelta, MAX_SUB_STEPS, FIXED_TIME_STEP)
  } catch (error) {
    console.warn('[physicsEngine] stepSimulation failed', error)
  }
}

export function updateGravity(gravity: RigidbodyVector3Tuple): void {
  if (!physicsContext?.world || !physicsContext.Ammo) {
    return
  }
  physicsContext.world.setGravity(toBtVec(physicsContext.Ammo, gravity))
}

export function resolveRigidbodyShapeFromNode(node: SceneNode | null | undefined): RigidbodyPhysicsShape | null {
  const metadata = node?.components?.rigidbody?.metadata as Record<string, unknown> | undefined
  const shape = metadata?.__harmonyRigidbody as { shape?: RigidbodyPhysicsShape | null } | undefined
  if (shape && shape.shape) {
    return shape.shape
  }
  return null
}
