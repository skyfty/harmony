import { describe, expect, it } from 'vitest'
import type { RoadTraceNode } from '@schema/proceduralLandscape/roadTrace'
import { validateRoadCenterlineGeometry } from '@schema/proceduralLandscape/roadGeometry'

function node(x: number, z: number, index: number): RoadTraceNode {
  return {
    x,
    z,
    y: 0,
    heading: 0,
    index,
    lateral: 0,
    longitudinal: 0,
    turn: 0,
    headingDelta: 0,
  }
}

describe('road centerline geometry', () => {
  it('rejects overlapping switchbacks that are narrower than the road', () => {
    const nodes = [
      node(0, 0, 0),
      node(20, 0, 1),
      node(20, 8, 2),
      node(0, 8, 3),
      node(0, 16, 4),
      node(20, 16, 5),
    ]
    const geometry = validateRoadCenterlineGeometry(nodes, {
      clearance: 18,
      minimumTurnRadius: 8,
    })
    expect(geometry.valid).toBe(false)
    expect(geometry.minCenterlineClearance).toBeLessThan(18)
  })

  it('accepts a smooth open curve', () => {
    const nodes: RoadTraceNode[] = []
    for (let index = 0; index <= 40; index += 1) {
      const t = index / 40
      nodes.push(node(t * 80, Math.sin(t * Math.PI) * 18, index))
    }
    const geometry = validateRoadCenterlineGeometry(nodes, {
      clearance: 14,
      minimumTurnRadius: 8,
    })
    expect(geometry.valid).toBe(true)
    expect(geometry.minCenterlineClearance).toBeGreaterThanOrEqual(14)
  })
})
