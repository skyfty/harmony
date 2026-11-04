import * as CANNON from 'cannon-es'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { createCannonSceneRigidBody } from '@harmony/physics-cannon'
import type { PhysicsRuntimeBodyEntry } from '@harmony/physics-core'
import type { RoadBandRow } from '@schema/proceduralLandscape/roadBandRows'
import { createRoadBoundaryCollisionGeometry } from '@schema/proceduralLandscape/roadBoundary'
import { createGroundCollisionRuntimeBridgeDeps } from '@schema/groundCollisionRuntimeBridge'

function makeStraightRows(count = 41): RoadBandRow[] {
  return Array.from({ length: count }, (_, index) => ({
    x: -40 + index * 2,
    z: 0,
    y: 10,
    heading: 0,
    index,
    lateral: 0,
    longitudinal: 0,
    turn: 0,
    headingDelta: 0,
    sourceIndex: index,
  }))
}

function addBoundaryCollisionBoxes(
  world: CANNON.World,
  collision: NonNullable<ReturnType<typeof createRoadBoundaryCollisionGeometry>>,
): void {
  expect(collision.colliderBoxes.length).toBeGreaterThan(0)
  let nextId = 1000
  const runtimeDeps = createGroundCollisionRuntimeBridgeDeps({
    enabled: true,
    sceneLoaded: true,
    getPhysicsBridge: () => null,
    runtimeBodyIds: new Set(),
    nextRuntimeId: () => {
      nextId += 1
      return nextId
    },
    enqueueMutation: () => {},
  })
  expect(runtimeDeps).not.toBeNull()
  const bodyResult = runtimeDeps!.createBody(
    null,
    null,
    {
      kind: 'static-box-compound',
      boxes: collision.colliderBoxes,
    },
    new THREE.Group(),
    'road-boundary-test',
  )
  expect(bodyResult).not.toBeNull()
  const entry = (bodyResult!.body as unknown as {
    __runtimeBodyEntry: PhysicsRuntimeBodyEntry
  }).__runtimeBodyEntry
  expect(entry.shapes.some((shape) => shape.kind === 'box')).toBe(true)
  expect(entry.shapes.some((shape) => shape.kind === 'compound')).toBe(true)
  const shapeMap = new Map(entry.shapes.map((shape) => [shape.id, shape]))
  createCannonSceneRigidBody({
    world,
    shapeMap,
    desc: entry.body,
  })
}

describe('road boundary vehicle collision', () => {
  it('does not let a box vehicle chassis pass through the road containment boundary', () => {
    const collision = createRoadBoundaryCollisionGeometry({
      rows: makeStraightRows(),
      halfWidth: 4,
      closed: false,
      rowSpacing: 4,
    })
    expect(collision).not.toBeNull()

    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) })
    world.broadphase = new CANNON.SAPBroadphase(world)
    world.allowSleep = false
    addBoundaryCollisionBoxes(world, collision!)

    const chassis = new CANNON.Body({ mass: 1400, type: CANNON.Body.DYNAMIC })
    chassis.addShape(new CANNON.Box(new CANNON.Vec3(2.1, 0.94, 1.03)))
    chassis.position.set(0, 11, 1)
    chassis.velocity.set(0, 0, 40 / 3.6)
    chassis.updateMassProperties()
    world.addBody(chassis)

    for (let frame = 0; frame < 90; frame += 1) {
      world.step(1 / 60)
    }

    expect(chassis.position.z).toBeLessThan(4)
    expect(chassis.velocity.z).toBeLessThanOrEqual(1)
    collision!.geometry.dispose()
  })
})
