import * as CANNON from 'cannon-es'
import {
  createCannonShape,
  type CannonShapeDefinition,
  type CannonShapeScaleLike,
} from './shapeFactory'
import {
  ensureCannonRigidbodyMaterial,
  mapCannonLegacyBodyType,
  type CannonContactSettings,
  type CannonLegacyBodyType,
  type CannonRigidbodyMaterialEntry,
} from './materials'

export const COLLISION_GROUP_STATIC_ENV = 1
export const COLLISION_GROUP_DYNAMIC_OBJ = 2
export const COLLISION_GROUP_KINEMATIC_OBJ = 4
export const COLLISION_MASK_STATIC_ENV = COLLISION_GROUP_DYNAMIC_OBJ | COLLISION_GROUP_KINEMATIC_OBJ
export const COLLISION_MASK_DYNAMIC_OBJ =
  COLLISION_GROUP_STATIC_ENV | COLLISION_GROUP_DYNAMIC_OBJ | COLLISION_GROUP_KINEMATIC_OBJ
export const COLLISION_MASK_KINEMATIC_OBJ = COLLISION_GROUP_DYNAMIC_OBJ

export type CannonBodyShapeDefinitionBinding = {
  definition: CannonShapeDefinition
  position?: [number, number, number]
  quaternion?: [number, number, number, number]
}

export type CannonRigidBodyCreateParams = {
  world: CANNON.World
  mass: number
  bodyType: CannonLegacyBodyType
  shapes: CannonBodyShapeDefinitionBinding[]
  shapeScale?: CannonShapeScaleLike
  rigidbodyMaterialCache: Map<string, CannonRigidbodyMaterialEntry>
  rigidbodyContactMaterialKeys: Set<string>
  friction: number
  restitution: number
  contactSettings: CannonContactSettings
  name?: string
}

export function createCannonRigidbodyBody(params: CannonRigidBodyCreateParams): CANNON.Body {
  const body = new CANNON.Body({ mass: params.mass })
  if (params.name) {
    ;(body as CANNON.Body & { name?: string }).name = params.name
  }
  body.type = mapCannonLegacyBodyType(params.bodyType)
  if (body.type === CANNON.Body.STATIC) {
    body.collisionFilterGroup = COLLISION_GROUP_STATIC_ENV
    body.collisionFilterMask = COLLISION_MASK_STATIC_ENV
  } else if (body.type === CANNON.Body.KINEMATIC) {
    body.collisionFilterGroup = COLLISION_GROUP_KINEMATIC_OBJ
    body.collisionFilterMask = COLLISION_MASK_KINEMATIC_OBJ
  } else {
    body.collisionFilterGroup = COLLISION_GROUP_DYNAMIC_OBJ
    body.collisionFilterMask = COLLISION_MASK_DYNAMIC_OBJ
  }
  body.material = ensureCannonRigidbodyMaterial({
    world: params.world,
    rigidbodyMaterialCache: params.rigidbodyMaterialCache,
    rigidbodyContactMaterialKeys: params.rigidbodyContactMaterialKeys,
    friction: params.friction,
    restitution: params.restitution,
    contactSettings: params.contactSettings,
  })
  params.shapes.forEach((binding) => {
    const shape = createCannonShape(binding.definition, undefined, params.shapeScale)
    if (!shape) {
      return
    }
    const position = binding.position ? new CANNON.Vec3(binding.position[0], binding.position[1], binding.position[2]) : undefined
    const quaternion = binding.quaternion
      ? new CANNON.Quaternion(binding.quaternion[0], binding.quaternion[1], binding.quaternion[2], binding.quaternion[3])
      : undefined
    body.addShape(shape, position, quaternion)
  })
  return body
}
