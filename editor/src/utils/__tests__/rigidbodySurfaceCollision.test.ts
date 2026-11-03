import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { RigidbodyPhysicsShape } from '@schema/components'
import {
  buildStaticMeshShapeFromObject,
  isDegenerateConvexRigidbodyShape,
  shouldReuseGeneratedRigidbodyShape,
  shouldUseExactFlatFloorCollider,
} from '@/utils/rigidbodySurfaceCollision'
import { buildConvexShapeOverlay } from '@/utils/rigidbodyColliderEdit'

describe('flat floor static collision', () => {
  it('selects exact mesh collision only for static convex zero-thickness floors', () => {
    const floor = {
      id: 'flat-floor',
      nodeType: 'Mesh',
      dynamicMesh: {
        type: 'Floor',
        vertices: [[-5, -5], [5, -5], [5, 5], [-5, 5]],
        thickness: 0,
        smooth: 0,
        sideUvScale: { x: 1, y: 1 },
      },
    } as any
    expect(shouldUseExactFlatFloorCollider(floor, {
      bodyType: 'STATIC',
      colliderType: 'convex',
    })).toBe(true)
    expect(shouldUseExactFlatFloorCollider(floor, {
      bodyType: 'DYNAMIC',
      colliderType: 'convex',
    })).toBe(false)
    expect(shouldUseExactFlatFloorCollider(floor, {
      bodyType: 'STATIC',
      colliderType: 'box',
    })).toBe(false)
    floor.dynamicMesh.thickness = 0.1
    expect(shouldUseExactFlatFloorCollider(floor, {
      bodyType: 'STATIC',
      colliderType: 'convex',
    })).toBe(false)
  })

  it('builds a valid host-local static mesh without raising the visual top', () => {
    const root = new THREE.Group()
    root.position.set(10, 42, -4)
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 10, 1, 1),
      new THREE.MeshBasicMaterial(),
    )
    mesh.rotation.x = -Math.PI / 2
    root.add(mesh)
    root.updateMatrixWorld(true)

    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    root.matrixWorld.decompose(position, quaternion, scale)
    const shape = buildStaticMeshShapeFromObject(root, {
      position,
      quaternion,
      scale,
    })
    expect(shape?.kind).toBe('static-mesh')
    if (shape?.kind !== 'static-mesh') {
      throw new Error('Expected a static mesh floor collider')
    }
    expect(shape.vertices.length).toBe(6)
    expect(shape.indices.length).toBe(6)
    shape.vertices.forEach((vertex) => expect(vertex[1]).toBeCloseTo(0, 5))

    const overlay = buildConvexShapeOverlay({
      shape,
      scale: new THREE.Vector3(1, 1, 1),
    })
    expect(overlay).not.toBeNull()
    expect(overlay!.geometry.getAttribute('position').count).toBe(6)
    expect(overlay!.geometry.getIndex()?.count).toBe(6)
  })

  it('detects stale coplanar convex metadata', () => {
    const staleShape: RigidbodyPhysicsShape = {
      kind: 'convex',
      vertices: [[-1, 0, -1], [1, 0, -1], [1, 0.001, 1], [-1, 0.001, 1]],
      faces: [[0, 1, 2, 3]],
      applyScale: true,
    }
    expect(isDegenerateConvexRigidbodyShape(staleShape)).toBe(true)
    expect(isDegenerateConvexRigidbodyShape({
      kind: 'convex',
      vertices: [[-1, 0, -1], [1, 0, -1], [1, 0.05, 1], [-1, 0.05, 1]],
      faces: [[0, 1, 2, 3]],
      applyScale: true,
    })).toBe(false)

    const floor = {
      id: 'flat-floor',
      nodeType: 'Mesh',
      dynamicMesh: {
        type: 'Floor',
        vertices: [[-5, -5], [5, -5], [5, 5], [-5, 5]],
        thickness: 0,
        smooth: 0,
        sideUvScale: { x: 1, y: 1 },
      },
    } as any
    const props = {
      bodyType: 'STATIC' as const,
      colliderType: 'convex' as const,
    }
    expect(shouldReuseGeneratedRigidbodyShape(floor, props, staleShape)).toBe(false)
    expect(shouldReuseGeneratedRigidbodyShape(floor, props, {
      kind: 'static-mesh',
      vertices: [[-1, 0, -1], [1, 0, -1], [0, 0, 1]],
      indices: [0, 1, 2],
      applyScale: true,
    })).toBe(true)
  })
})
