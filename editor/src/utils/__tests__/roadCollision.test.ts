import { describe, expect, it } from 'vitest'

import { createRoadCollisionGeometry } from '@schema/proceduralLandscape/roadCollision'

function makeRows(count: number, spacing = 2) {
  return Array.from({ length: count }, (_, index) => ({
    x: index * spacing,
    z: 0,
    y: 10 + index * 0.02,
    heading: 0,
    index,
    lateral: 0,
    longitudinal: 0,
    turn: 0,
    headingDelta: 0,
    sourceIndex: index,
  }))
}

describe('procedural road collision mesh', () => {
  it('decimates rows and lateral columns while preserving the design height', () => {
    const rows = makeRows(31)
    const result = createRoadCollisionGeometry({
      rows,
      halfWidth: 2,
      rowSpacing: 6,
      columnCount: 5,
      lift: 0.05,
    })

    expect(result).not.toBeNull()
    expect(result!.sourceRowCount).toBe(31)
    expect(result!.rowCount).toBe(11)
    expect(result!.columnCount).toBe(5)
    expect(result!.triangleCount).toBe(80)

    const position = result!.geometry.getAttribute('position')
    expect(position.count).toBe(55)
    expect(position.getY(0)).toBeCloseTo(10.05, 5)
    expect(position.getY(4)).toBeCloseTo(10.05, 5)
    expect(position.getX(0)).toBeCloseTo(0, 5)
    expect(position.getZ(0)).toBeCloseTo(-2, 5)
    expect(position.getZ(4)).toBeCloseTo(2, 5)
  })

  it('returns no geometry for a degenerate road', () => {
    expect(createRoadCollisionGeometry({
      rows: makeRows(1),
      halfWidth: 2,
      rowSpacing: 6,
    })).toBeNull()
  })
})
