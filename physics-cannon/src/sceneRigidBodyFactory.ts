import * as CANNON from 'cannon-es'
import type { PhysicsBodyDesc, PhysicsShapeDesc } from '@harmony/physics-core'
import { createCannonSceneShapeBindings } from './sceneShapeBindings'

const heightfieldBodyRotation = new CANNON.Quaternion()
heightfieldBodyRotation.setFromEuler(-Math.PI / 2, 0, 0, 'XYZ')

export type CannonSceneRigidBodyCreateParams = {
  world: CANNON.World
  shapeMap: Map<number, PhysicsShapeDesc>
  desc: PhysicsBodyDesc
}

export function createCannonSceneRigidBody(params: CannonSceneRigidBodyCreateParams): CANNON.Body {
  const body = new CANNON.Body({
    mass: params.desc.type === 'dynamic' ? Math.max(0, params.desc.mass) : 0,
    type: mapBodyType(params.desc.type),
  })
  ;(body as CANNON.Body & { physicsBodyId?: number }).physicsBodyId = params.desc.id
  body.position.set(...params.desc.transform.position)
  body.quaternion.set(...params.desc.transform.rotation)
  body.linearDamping = params.desc.linearDamping ?? 0.01
  body.angularDamping = params.desc.angularDamping ?? 0.01
  const bindings = createCannonSceneShapeBindings(params.shapeMap, params.desc.shapeId)
  const shouldRotateBodyForHeightfield = bindings.length > 0
    && bindings.every((binding) => binding.shapeKind === 'heightfield')

  if (shouldRotateBodyForHeightfield) {

    body.quaternion.mult(heightfieldBodyRotation, body.quaternion)
  }
  bindings.forEach((binding) => {
    body.addShape(binding.shape, binding.position, binding.quaternion)
  })
  body.updateMassProperties()
  params.world.addBody(body)
  return body
}

function mapBodyType(type: PhysicsBodyDesc['type']): CANNON.BodyType {
  if (type === 'static') {
    return CANNON.Body.STATIC
  }
  if (type === 'kinematic') {
    return CANNON.Body.KINEMATIC
  }
  return CANNON.Body.DYNAMIC
}
