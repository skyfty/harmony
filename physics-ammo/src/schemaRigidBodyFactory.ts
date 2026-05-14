import { createAmmoTransform, createAmmoVector3, type AmmoApi } from './ammoHelpers'
import { defineAmmoBodyAccessors } from './bodyAccessors'
import { createAmmoSchemaShape, type SchemaShapeDefinition } from './schemaShapeFactory'
import type {
  PhysicsContactSettings,
  PhysicsRigidbodyBodyType,
  PhysicsRigidbodyMaterialEntry,
  PhysicsShapeScale,
  PhysicsWorldLike,
} from '@harmony/physics-bridge'

export type SchemaBodyShapeBinding = {
  definition: SchemaShapeDefinition
  position?: [number, number, number]
  quaternion?: [number, number, number, number]
}

const heightfieldQuaternion: [number, number, number, number] = [
  Math.sin(-Math.PI / 4),
  0,
  0,
  Math.cos(-Math.PI / 4),
]

export type SchemaRigidBodyCreateParams = {
  world: PhysicsWorldLike
  mass: number
  bodyType: PhysicsRigidbodyBodyType
  shapes: SchemaBodyShapeBinding[]
  shapeScale?: PhysicsShapeScale | null
  rigidbodyMaterialCache: Map<string, PhysicsRigidbodyMaterialEntry>
  rigidbodyContactMaterialKeys: Set<string>
  friction: number
  restitution: number
  contactSettings: PhysicsContactSettings
  name?: string
}

export function createAmmoSchemaRigidBody(ammo: AmmoApi, params: SchemaRigidBodyCreateParams): any {
  const safeScale = normalizeShapeScale(params.shapeScale)
  const compoundShape = new ammo.btCompoundShape(true)
  const cleanup: Array<() => void> = [() => ammo.destroy(compoundShape)]

  params.shapes.forEach((binding) => {
    const shape = createAmmoSchemaShape(ammo, binding.definition, safeScale)
    if (!shape) {
      return
    }
    const childTransform = createAmmoTransform(ammo, {
      position: binding.position ?? [0, 0, 0],
      rotation: binding.quaternion ?? (
        binding.definition.kind === 'heightfield'
          ? heightfieldQuaternion
          : [0, 0, 0, 1]
      ),
    })
    compoundShape.addChildShape(childTransform, shape.shape ?? shape)
    cleanup.push(...shape.cleanup)
    cleanup.push(() => ammo.destroy(childTransform))
  })

  const startTransform = createAmmoTransform(ammo, { position: [0, 0, 0], rotation: [0, 0, 0, 1] })
  const motionState = new ammo.btDefaultMotionState(startTransform)
  const localInertia = createAmmoVector3(ammo, [0, 0, 0])
  const mass = params.bodyType === 'DYNAMIC' ? Math.max(0, params.mass) : 0
  if (mass > 0) {
    compoundShape.calculateLocalInertia?.(mass, localInertia)
  }
  const constructionInfo = new ammo.btRigidBodyConstructionInfo(mass, motionState, compoundShape, localInertia)
  constructionInfo.set_m_friction?.(Math.max(0, params.friction))
  constructionInfo.set_m_restitution?.(Math.max(0, params.restitution))
  const body = new ammo.btRigidBody(constructionInfo)
  body.__ammoBody = body
  body.__harmonyShapeBindings = params.shapes
  defineAmmoBodyAccessors(ammo, body)
  if (params.bodyType === 'KINEMATIC') {
    body.setCollisionFlags((body.getCollisionFlags?.() ?? 0) | 2)
    body.setActivationState?.(4)
  }
  body.setUserIndex?.(Number.isFinite(Number(params.name?.split(':').pop())) ? Number(params.name?.split(':').pop()) : 0)
  params.world.addBody(body)
  return {
    body,
    orientationAdjustment: null,
    cleanup: [
      ...cleanup,
      () => ammo.destroy(startTransform),
      () => ammo.destroy(motionState),
      () => ammo.destroy(localInertia),
      () => ammo.destroy(constructionInfo),
      () => ammo.destroy(body),
      () => params.world.removeBody?.(body),
    ],
  }
}

function normalizeShapeScale(scaleLike: SchemaRigidBodyCreateParams['shapeScale']): { x: number; y: number; z: number } {
  const sx = typeof scaleLike?.x === 'number' && Number.isFinite(scaleLike.x) ? Math.abs(scaleLike.x) : 1
  const sy = typeof scaleLike?.y === 'number' && Number.isFinite(scaleLike.y) ? Math.abs(scaleLike.y) : 1
  const sz = typeof scaleLike?.z === 'number' && Number.isFinite(scaleLike.z) ? Math.abs(scaleLike.z) : 1
  return {
    x: sx > 0 ? sx : 1,
    y: sy > 0 ? sy : 1,
    z: sz > 0 ? sz : 1,
  }
}
