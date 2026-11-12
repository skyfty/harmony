import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildOutlineMeshFromObject, collectOutlinePoints } from '@/utils/outlineMesh'

describe('outline mesh sampling', () => {
  it('samples spatially separated meshes instead of exhausting the budget on the first mesh', () => {
    const root = new THREE.Group()
    for (let index = 0; index < 8; index += 1) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2))
      mesh.position.x = index * 1000
      root.add(mesh)
    }
    root.updateMatrixWorld(true)

    const points = collectOutlinePoints(root, 16, 256)

    expect(points).toHaveLength(16)
    expect(Math.min(...points.map((point) => point.x))).toBeLessThan(100)
    expect(Math.max(...points.map((point) => point.x))).toBeGreaterThan(6900)
  })

  it('uses the complete model bounds for the lazy-load bounding sphere', () => {
    const root = new THREE.Group()
    for (let index = 0; index < 8; index += 1) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2))
      mesh.position.x = index * 1000
      root.add(mesh)
    }
    root.updateMatrixWorld(true)

    const outline = buildOutlineMeshFromObject(root, {
      maxPoints: 16,
      minPoints: 4,
      perMeshSample: 256,
      pointTarget: 16,
    })

    expect(outline).not.toBeNull()
    const sphere = outline?.boundingSphere
    expect(sphere).not.toBeNull()
    expect(sphere!.center.x - sphere!.radius).toBeLessThanOrEqual(0)
    expect(sphere!.center.x + sphere!.radius).toBeGreaterThanOrEqual(7000)
  })
})
