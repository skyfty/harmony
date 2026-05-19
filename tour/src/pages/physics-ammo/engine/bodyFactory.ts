import type {
  PhysicsBodyDesc,
  PhysicsMaterialDesc,
} from '@harmony/physics-core'
import { createAmmoTransform, createAmmoVector3, type AmmoApi } from './ammoHelpers'
import type { AmmoSceneShapeBinding } from './sceneShapeBindings'

const BT_COLLISION_FLAG_KINEMATIC_OBJECT = 2
const BT_DISABLE_DEACTIVATION = 4

export type BuiltAmmoBody = {
  body: any
  cleanup: Array<() => void>
}

export function createAmmoRigidBody(params: {
  ammo: AmmoApi
  world: any
  materials: PhysicsMaterialDesc[]
  shapes: AmmoSceneShapeBinding[]
  desc: PhysicsBodyDesc
}): BuiltAmmoBody {
  const { ammo, world, materials, shapes, desc } = params
  const compoundShape = new ammo.btCompoundShape(true)
  const cleanup: Array<() => void> = [() => ammo.destroy(compoundShape)]
  shapes.forEach((binding) => {
    const childTransform = createAmmoTransform(ammo, {
      position: binding.position,
      rotation: binding.quaternion,
    })
    compoundShape.addChildShape(childTransform, binding.shape)
    cleanup.push(...binding.cleanup)
    cleanup.push(() => ammo.destroy(childTransform))
  })
  const startTransform = createAmmoTransform(ammo, desc.transform)
  const motionState = new ammo.btDefaultMotionState(startTransform)

  const localInertia = createAmmoVector3(ammo, [0, 0, 0])
  const dynamicMass = desc.type === 'dynamic' ? Math.max(0, desc.mass) : 0
  if (dynamicMass > 0) {
    compoundShape.calculateLocalInertia(dynamicMass, localInertia)
  }

  const constructionInfo = new ammo.btRigidBodyConstructionInfo(
    dynamicMass,
    motionState,
    compoundShape,
    localInertia,
  )
  const material = resolveMaterial(materials, desc.materialId)
  if (material) {
    constructionInfo.set_m_friction?.(material.friction)
    constructionInfo.set_m_restitution?.(material.restitution)
  }
  constructionInfo.set_m_linearDamping?.(Math.max(0, desc.linearDamping ?? 0))
  constructionInfo.set_m_angularDamping?.(Math.max(0, desc.angularDamping ?? 0))

  const body = new ammo.btRigidBody(constructionInfo)
  body.setUserIndex?.(desc.id)
  body.setDamping?.(
    Math.max(0, desc.linearDamping ?? 0),
    Math.max(0, desc.angularDamping ?? 0),
  )
  if (material) {
    body.setFriction?.(material.friction)
    body.setRestitution?.(material.restitution)
  }
  if (desc.type === 'kinematic') {
    body.setCollisionFlags((body.getCollisionFlags?.() ?? 0) | BT_COLLISION_FLAG_KINEMATIC_OBJECT)
    body.setActivationState?.(BT_DISABLE_DEACTIVATION)
  }
  world.addRigidBody(body)

  return {
    body,
    cleanup: [
      ...cleanup,
      () => ammo.destroy(startTransform),
      () => ammo.destroy(motionState),
      () => ammo.destroy(localInertia),
      () => ammo.destroy(constructionInfo),
      () => ammo.destroy(body),
      () => world.removeRigidBody(body),
    ],
  }
}

function resolveMaterial(materials: PhysicsMaterialDesc[], materialId: number | null): PhysicsMaterialDesc | null {
  if (materialId == null) {
    return null
  }
  return materials.find((entry) => entry.id === materialId) ?? null
}
