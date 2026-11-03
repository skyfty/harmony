import { describe, expect, it } from 'vitest'
import { createAmmoSchemaShape } from '../../../../physics-ammo/src/schemaShapeFactory'

class FakeAmmoVector {
  x = 0
  y = 0
  z = 0

  setValue(x: number, y: number, z: number): void {
    this.x = x
    this.y = y
    this.z = z
  }
}

class FakeTriangleMesh {
  triangles: number[][][] = []

  addTriangle(
    a: FakeAmmoVector,
    b: FakeAmmoVector,
    c: FakeAmmoVector,
  ): void {
    this.triangles.push([
      [a.x, a.y, a.z],
      [b.x, b.y, b.z],
      [c.x, c.y, c.z],
    ])
  }
}

class FakeStaticMeshShape {
  mesh: FakeTriangleMesh

  constructor(mesh: FakeTriangleMesh) {
    this.mesh = mesh
  }
}

describe('Ammo schema static mesh collision', () => {
  it('builds and scales a static mesh for non-dynamic Rigidbody shapes', () => {
    const ammo = {
      btTriangleMesh: FakeTriangleMesh,
      btVector3: FakeAmmoVector,
      btBvhTriangleMeshShape: FakeStaticMeshShape,
      destroy: () => {},
    }
    const built = createAmmoSchemaShape(
      ammo as any,
      {
        kind: 'static-mesh',
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 0, 1],
        ],
        indices: [0, 1, 2],
        applyScale: true,
      },
      { x: 2, y: 3, z: 4 },
      false,
    )
    expect(built).not.toBeNull()
    const shape = built!.shape as FakeStaticMeshShape
    expect(shape.mesh.triangles).toEqual([[
      [0, 0, 0],
      [2, 0, 0],
      [0, 0, 4],
    ]])
  })
})
