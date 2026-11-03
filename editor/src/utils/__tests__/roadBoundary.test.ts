import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import type { RoadBandRow } from '@schema/proceduralLandscape/roadBandRows'
import { createCapsuleCollisionWorld } from '@schema/capsuleCollision'
import type { LandscapeExclusionCircle } from '@schema/proceduralLandscape/exclusion'
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

function makeCircle(
  centerX: number,
  centerZ: number,
  radius: number,
): LandscapeExclusionCircle {
  return {
    id: `opening-${centerX}-${centerZ}`,
    centerX,
    centerZ,
    radius,
  }
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

  it('blocks character capsules approaching from outside and through an end cap', () => {
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

    const outsideHits = world.resolveCapsule(character, {
      segment: new THREE.Line3(
        new THREE.Vector3(5, 10.5, 4.3),
        new THREE.Vector3(5, 12, 4.3),
      ),
      radius: 0.5,
    })
    expect(outsideHits.length).toBeGreaterThan(0)

    const endCapHits = world.resolveCapsule(character, {
      segment: new THREE.Line3(
        new THREE.Vector3(-0.3, 11.5, 0),
        new THREE.Vector3(-0.3, 12.5, 0),
      ),
      radius: 0.5,
    })
    expect(endCapHits.length).toBeGreaterThan(0)
    expect(endCapHits.some((hit) => Math.abs(hit.normal.x) > 0.5)).toBe(true)

    mesh.geometry.dispose()
  })

  it('cuts a sub-sampling-width opening from one roadside wall', () => {
    const rows = makeRows()
    const exclusionCircles = [makeCircle(10, 4, 0.5)]
    const clipped = createRoadBoundaryCollisionGeometry({
      rows,
      halfWidth: 4,
      closed: false,
      rowSpacing: 4,
      exclusionCircles,
    })
    expect(clipped).not.toBeNull()

    const mesh = new THREE.Mesh(
      clipped!.geometry,
      new THREE.MeshBasicMaterial({ visible: false }),
    )
    const world = createCapsuleCollisionWorld()
    world.addMesh(mesh)
    const character = new THREE.Group()
    const gapHits = world.resolveCapsule(character, {
      segment: new THREE.Line3(
        new THREE.Vector3(10, 15.5, 4),
        new THREE.Vector3(10, 17, 4),
      ),
      radius: 0.15,
    })
    expect(gapHits).toHaveLength(0)

    const wallHits = world.resolveCapsule(character, {
      segment: new THREE.Line3(
        new THREE.Vector3(2, 12.5, 4),
        new THREE.Vector3(2, 14, 4),
      ),
      radius: 0.15,
    })
    expect(wallHits.length).toBeGreaterThan(0)

    const segments = createRoadBoundaryWallSegments({
      rows,
      halfWidth: 4,
      closed: false,
      rowSpacing: 4,
      exclusionCircles,
    })
    const rightSide = segments.filter((segment) => (
      segment.side === 1 && segment.distance > 0
    ))
    expect(rightSide).toHaveLength(2)
    expect(rightSide[0]!.points[rightSide[0]!.points.length - 1]!.x).toBeLessThan(10)
    expect(rightSide[1]!.points[0]!.x).toBeGreaterThan(10)

    mesh.geometry.dispose()
  })

  it('merges overlapping exclusion ranges and opens both road sides', () => {
    const rows = makeRows()
    const segments = createRoadBoundaryWallSegments({
      rows,
      halfWidth: 4,
      closed: true,
      rowSpacing: 4,
      exclusionCircles: [
        makeCircle(9, 0, 4.8),
        makeCircle(11, 0, 4.8),
      ],
    })
    expect(segments).toHaveLength(4)
    expect(segments.filter((segment) => segment.distance < 0)).toHaveLength(2)
    expect(segments.filter((segment) => segment.distance > 0)).toHaveLength(2)
  })

  it('opens both the side and end cap without closing the gap', () => {
    const rows = makeRows()
    const exclusionCircles = [makeCircle(0, 0, 1.5)]
    const segments = createRoadBoundaryWallSegments({
      rows,
      halfWidth: 4,
      closed: false,
      rowSpacing: 4,
      exclusionCircles,
    })
    expect(segments.filter((segment) => segment.distance === 0)).toHaveLength(3)
    expect(segments.some((segment) => (
      segment.distance === 0
      && segment.points[0]!.x === 0
      && segment.points[0]!.z === 0
    ))).toBe(false)
  })

  it('returns no boundary geometry when exclusions cover the entire road end', () => {
    const rows = makeRows()
    const options = {
      rows,
      halfWidth: 4,
      closed: false,
      rowSpacing: 4,
      exclusionCircles: [makeCircle(10, 0, 100)],
    }
    expect(createRoadBoundaryCollisionGeometry(options)).toBeNull()
    expect(createRoadBoundaryWallSegments(options)).toHaveLength(0)
  })
})
