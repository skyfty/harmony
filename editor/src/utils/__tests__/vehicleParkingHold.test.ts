import { describe, expect, it } from 'vitest'
import { CannonPhysicsWorld } from '@harmony/physics-cannon'
import type { PhysicsStepFrame } from '@harmony/physics-core'

function readBodyPosition(frame: PhysicsStepFrame, bodyId: number): [number, number, number] {
  const bodyIndex = Array.from(frame.bodyMeta ?? []).indexOf(bodyId)
  if (bodyIndex < 0) {
    throw new Error(`Missing body ${bodyId}`)
  }
  const base = bodyIndex * 8
  return [
    frame.bodyTransforms[base] ?? 0,
    frame.bodyTransforms[base + 1] ?? 0,
    frame.bodyTransforms[base + 2] ?? 0,
  ]
}

describe('vehicle parking hold', () => {
  it('locks a braked low-speed vehicle to one transform', () => {
    const world = new CannonPhysicsWorld()
    world.setWorldSettings({
      gravity: [0, 0, 0],
      fixedTimeStepMs: 1000 / 60,
      maxSubSteps: 1,
    })
    world.loadScene({
      format: 'harmony-physics',
      materials: [],
      shapes: [{
        id: 1,
        kind: 'box',
        halfExtents: [1, 0.5, 2],
      }],
      bodies: [{
        id: 1,
        type: 'dynamic',
        mass: 150,
        materialId: null,
        shapeId: 1,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1],
        },
      }],
      vehicles: [{
        id: 1,
        bodyId: 1,
        indexRightAxis: 2,
        indexUpAxis: 1,
        indexForwardAxis: 0,
        maxSpeedKmh: 40,
        wheels: [],
      }],
      characters: [],
    })
    world.setBodyVelocity({
      bodyId: 1,
      linearVelocity: [0.1, 0, 0],
      angularVelocity: [0, 0, 0],
    })
    world.setVehicleInput({
      vehicleId: 1,
      steering: 0,
      throttle: 0,
      brake: 1,
    })

    let frame = world.step(1000 / 60)
    for (let index = 0; index < 119; index += 1) {
      frame = world.step(1000 / 60)
    }
    const settledPosition = readBodyPosition(frame, 1)

    for (let index = 0; index < 120; index += 1) {
      frame = world.step(1000 / 60)
    }

    expect(readBodyPosition(frame, 1)).toEqual(settledPosition)
  })
})
