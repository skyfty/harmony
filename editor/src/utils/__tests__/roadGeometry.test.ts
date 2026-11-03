import { describe, expect, it } from 'vitest'
import type { RoadTraceNode } from '@schema/proceduralLandscape/roadTrace'
import {
  resolveProceduralLandscapeRoadGeometryLimits,
  validateRoadCenterlineGeometry,
} from '@schema/proceduralLandscape/roadGeometry'

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

  it('keeps the full-width overlap guard while allowing a road-width-aware bend', () => {
    const nodes = [
      node(0, -10, 0),
      node(0, 0, 1),
      node(0, 10, 2),
      node(10, 10, 3),
      node(10, 20, 4),
      node(10, 30, 5),
    ]
    const strict = validateRoadCenterlineGeometry(nodes, {
      clearance: 7,
      minimumTurnRadius: 20,
      maximumHeadingChangeRad: (10 * Math.PI) / 180,
    })
    const relaxed = validateRoadCenterlineGeometry(
      nodes,
      resolveProceduralLandscapeRoadGeometryLimits(7),
    )

    expect(strict.valid).toBe(false)
    expect(strict.minCenterlineClearance).toBeGreaterThanOrEqual(7)
    expect(relaxed.valid).toBe(true)
    expect(relaxed.minCenterlineClearance).toBeGreaterThanOrEqual(7)
  })

  it('scales the minimum radius from road width without dropping overlap checks', () => {
    expect(resolveProceduralLandscapeRoadGeometryLimits(7)).toEqual({
      clearance: 7,
      minimumTurnRadius: 3.5,
      maximumHeadingChangeRad: Math.PI,
    })
    expect(resolveProceduralLandscapeRoadGeometryLimits(12)).toEqual({
      clearance: 12,
      minimumTurnRadius: 6,
      maximumHeadingChangeRad: Math.PI,
    })
  })
})
