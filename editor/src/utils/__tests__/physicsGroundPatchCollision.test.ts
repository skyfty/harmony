import * as CANNON from 'cannon-es'
import { describe, expect, it } from 'vitest'

function createCapsuleShapes(radius: number, height: number) {
  const cylinderHalfHeight = Math.max(0, height * 0.5 - radius)
  const cylinder = new CANNON.Cylinder(radius, radius, cylinderHalfHeight * 2, 16)
  cylinder.transformAllPoints(
    new CANNON.Vec3(0, 0, 0),
    new CANNON.Quaternion().setFromEuler(Math.PI / 2, 0, 0, 'XYZ'),
  )
  return [
    { shape: cylinder, position: new CANNON.Vec3(0, 0, 0) },
    { shape: new CANNON.Sphere(radius), position: new CANNON.Vec3(0, cylinderHalfHeight, 0) },
    { shape: new CANNON.Sphere(radius), position: new CANNON.Vec3(0, -cylinderHalfHeight, 0) },
  ]
}

describe('dynamic character capsule against DEM ground patch', () => {
  it('lands on a sampled ground patch instead of tunnelling through it', () => {
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.8, 0) })
    world.broadphase = new CANNON.SAPBroadphase(world)

    const vertices: number[] = []
    const indices: number[] = []
    const cellsPerSide = 8
    const cellSize = 2
    for (let row = 0; row <= cellsPerSide; row += 1) {
      for (let column = 0; column <= cellsPerSide; column += 1) {
        vertices.push(
          (column - cellsPerSide / 2) * cellSize,
          0,
          (row - cellsPerSide / 2) * cellSize,
        )
      }
    }
    const verticesPerSide = cellsPerSide + 1
    for (let row = 0; row < cellsPerSide; row += 1) {
      for (let column = 0; column < cellsPerSide; column += 1) {
        const a = row * verticesPerSide + column
        const b = a + 1
        const c = a + verticesPerSide
        const d = c + 1
        indices.push(a, c, d, a, d, b)
      }
    }

    const ground = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC })
    ground.addShape(new CANNON.Trimesh(vertices, indices))
    world.addBody(ground)

    const character = new CANNON.Body({ mass: 80, type: CANNON.Body.DYNAMIC })
    character.position.set(0, 3, 0)
    createCapsuleShapes(0.35, 1.7).forEach((part) => {
      character.addShape(part.shape, part.position)
    })
    character.updateMassProperties()
    world.addBody(character)

    for (let frame = 0; frame < 240; frame += 1) {
      world.step(1 / 60)
    }

    expect(character.position.y).toBeGreaterThan(0.6)
    expect(character.position.y).toBeLessThan(1.1)
    expect(world.contacts.length).toBeGreaterThan(0)
  })
})
