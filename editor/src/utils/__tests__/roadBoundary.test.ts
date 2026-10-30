import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import type { RoadBandRow } from '@schema/proceduralLandscape/roadBandRows'
import { createCapsuleCollisionWorld } from '@schema/capsuleCollision'
import {
  createRoadBoundaryCollisionGeometry,
  createRoadBoundaryWallSegments,
  ROAD_BOUNDARY_COLLISION_HEIGHT,
  ROAD_BOUNDARY_COLLISION_THICKNESS,
} from '@schema/proceduralLandscape/roadBoundary'

function makeRows(count = 11): RoadBandRow[] {
  return Array.from({ length: count }, (_, index) => ({
    x: index * 2,
    z: 0,
    y: 10 + index,
    heading: 0,
    index,
    lateral: 0,
    longitudinal: 0,
    turn: 0,
    headingDelta: 0,
    sourceIndex: index,
  }))
}

describe('road boundary geometry', () => {
  it('builds two continuous side prisms and caps both non-loop ends', () => {
    const rows = makeRows()
    const columns = rows.map((row) => [row.y - 0.25, row.y, row.y + 0.25])
    const result = createRoadBoundaryCollisionGeometry({
      rows,
      columnHeights: columns,
      halfWidth: 4,
      closed: false,
      rowSpacing: 4,
      lift: 0.05,
    })

    expect(result).not.toBeNull()
    expect(result!.sideCount).toBe(2)
    expect(result!.endCapCount).toBe(2)
    expect(result!.rowCount).toBeLessThan(rows.length)
    expect(result!.triangleCount).toBeGreaterThan(0)
    result!.geometry.computeBoundingBox()
    const bounds = result!.geometry.boundingBox!
    expect(bounds.min.x).toBeCloseTo(-ROAD_BOUNDARY_COLLISION_THICKNESS, 6)
    expect(bounds.max.x).toBeCloseTo(
      rows[rows.length - 1]!.x + ROAD_BOUNDARY_COLLISION_THICKNESS,
      5,
    )
    expect(bounds.min.z).toBeCloseTo(-4 - ROAD_BOUNDARY_COLLISION_THICKNESS, 6)
    expect(bounds.max.z).toBeCloseTo(4 + ROAD_BOUNDARY_COLLISION_THICKNESS, 6)
    expect(bounds.min.y).toBeCloseTo(9.8, 6)
    expect(bounds.max.y).toBeCloseTo(
      rows[rows.length - 1]!.y + 0.25 + 0.05 + ROAD_BOUNDARY_COLLISION_HEIGHT,
      5,
    )
    result!.geometry.dispose()
  })

  it('does not cap a closed loop and applies the host inverse transform', () => {
    const rows = makeRows(7)
    const hostInverse = new THREE.Matrix4().makeTranslation(100, 2, -30)
    const result = createRoadBoundaryCollisionGeometry({
      rows,
      halfWidth: 3,
      closed: true,
      rowSpacing: 4,
      hostInverse,
    })

    expect(result).not.toBeNull()
    expect(result!.endCapCount).toBe(0)
    result!.geometry.computeBoundingBox()
    const bounds = result!.geometry.boundingBox!
    expect(bounds.min.x).toBeCloseTo(100, 6)
    expect(bounds.max.x).toBeCloseTo(100 + rows[rows.length - 1]!.x, 6)
    expect(bounds.min.z).toBeCloseTo(-30 - 3 - ROAD_BOUNDARY_COLLISION_THICKNESS, 5)
    expect(bounds.max.z).toBeCloseTo(-30 + 3 + ROAD_BOUNDARY_COLLISION_THICKNESS, 5)
    result!.geometry.dispose()
  })

  it('creates seasonal wall segments matching both sides and the closed state', () => {
    const rows = makeRows(9)
    const columns = rows.map((row) => [row.y - 1, row.y + 1])
    const open = createRoadBoundaryWallSegments({
      rows,
      columnHeights: columns,
      halfWidth: 4,
      closed: false,
      rowSpacing: 4,
      lift: 0.05,
    })
    expect(open).toHaveLength(4)
    expect(open.filter((segment) => segment.side === -1)).toHaveLength(1)
    expect(open.filter((segment) => segment.side === 1)).toHaveLength(3)
    const left = open.find((segment) => segment.side === -1)!
    const right = open.find(
      (segment) => segment.side === 1 && segment.points.length > 2,
    )!
    expect(left.points[0]!.z).toBeCloseTo(-4, 6)
    expect(left.points[0]!.roadY).toBeCloseTo(rows[0]!.y - 1 + 0.05, 6)
    expect(right.points[0]!.z).toBeCloseTo(4, 6)
    expect(right.points[0]!.roadY).toBeCloseTo(rows[0]!.y + 1 + 0.05, 6)

    const closed = createRoadBoundaryWallSegments({
      rows,
      columnHeights: columns,
      halfWidth: 4,
      closed: true,
      rowSpacing: 4,
    })
    expect(closed).toHaveLength(2)
  })

  it('blocks a character capsule against the collision prism', () => {
    const rows = makeRows()
    const collision = createRoadBoundaryCollisionGeometry({
      rows,
      halfWidth: 4,
      closed: false,
      rowSpacing: 4,
    })
    expect(collision).not.toBeNull()
    const mesh = new THREE.Mesh(
      collision!.geometry,
      new THREE.MeshBasicMaterial({ visible: false }),
    )
    const world = createCapsuleCollisionWorld()
    world.addMesh(mesh)
    const character = new THREE.Group()
    const capsule = {
      segment: new THREE.Line3(
        new THREE.Vector3(5, 15.5, 3.8),
        new THREE.Vector3(5, 17, 3.8),
      ),
      radius: 0.5,
    }

    const hits = world.resolveCapsule(character, capsule)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((hit) => Math.abs(hit.normal.z) > 0.5)).toBe(true)
    mesh.geometry.dispose()
  })
})
