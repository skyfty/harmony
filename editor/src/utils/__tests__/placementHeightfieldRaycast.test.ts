import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { intersectRayWithPlacementHeightfield } from '@/utils/placementHeightfieldRaycast'

describe('placement heightfield raycast', () => {
  it('returns the visible terrain height under a top-down pointer ray', () => {
    const point = intersectRayWithPlacementHeightfield(
      new THREE.Ray(new THREE.Vector3(25, 80, 35), new THREE.Vector3(0, -1, 0)),
      {
        minX: 0,
        maxX: 50,
        minY: 10,
        maxY: 90,
        minZ: 0,
        maxZ: 70,
        cellSize: 2,
      },
      () => 32.5,
    )

    expect(point?.x).toBeCloseTo(25)
    expect(point?.y).toBeCloseTo(32.5)
    expect(point?.z).toBeCloseTo(35)
  })

  it('does not fall back to a plane outside the procedural terrain bounds', () => {
    const point = intersectRayWithPlacementHeightfield(
      new THREE.Ray(new THREE.Vector3(200, 80, 200), new THREE.Vector3(0, -1, 0)),
      {
        minX: 0,
        maxX: 50,
        minY: 10,
        maxY: 90,
        minZ: 0,
        maxZ: 70,
        cellSize: 2,
      },
      () => 32.5,
    )

    expect(point).toBeNull()
  })

  it('refines a sloped terrain crossing between coarse march samples', () => {
    const point = intersectRayWithPlacementHeightfield(
      new THREE.Ray(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, -1, 0).normalize()),
      {
        minX: -1,
        maxX: 2,
        minY: 0,
        maxY: 2,
        minZ: -1,
        maxZ: 1,
        cellSize: 2,
      },
      (worldX) => worldX,
    )

    expect(point?.x).toBeCloseTo(0.5, 2)
    expect(point?.y).toBeCloseTo(0.5, 2)
    expect(point?.z).toBeCloseTo(0, 2)
  })
})
