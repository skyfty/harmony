/**
 * Unit tests for the exact road proximity index (slowroads-lab
 * `core/roadProfile.ts` port). The index replaces the 1024-texel raster road
 * field for every placement-time distance query, so it must be exact on any
 * terrain scale and behave identically at spatial-hash cell boundaries.
 */
import { describe, expect, it } from 'vitest'
import {
  buildRoadProximityIndex,
  verifyRoadProximityIndex,
} from '@schema/proceduralLandscape/roadProximity'
import type { RoadTraceNode } from '@schema/proceduralLandscape/roadTrace'

function makeNode(x: number, z: number, y: number, index: number, heading = 0): RoadTraceNode {
  return { x, z, y, heading, index, lateral: 0, longitudinal: 0, turn: 0, headingDelta: 0 }
}

function makePolyline(
  points: Array<[number, number]>,
  height: (x: number, z: number) => number = () => 0,
): RoadTraceNode[] {
  return points.map(([x, z], index) => makeNode(x, z, height(x, z), index))
}

function bruteForceDistance(nodes: ReadonlyArray<RoadTraceNode>, x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const from = nodes[i]!
    const to = nodes[i + 1]!
    const segX = to.x - from.x
    const segZ = to.z - from.z
    const segLengthSq = segX * segX + segZ * segZ
    if (segLengthSq <= 1e-9) {
      continue
    }
    const t = Math.max(0, Math.min(1, ((x - from.x) * segX + (z - from.z) * segZ) / segLengthSq))
    const dx = x - (from.x + segX * t)
    const dz = z - (from.z + segZ * t)
    best = Math.min(best, Math.sqrt(dx * dx + dz * dz))
  }
  return best
}

describe('road proximity index', () => {
  it('matches a brute-force point-to-segment distance across the whole map', () => {
    const nodes = makePolyline(
      [[0, 0], [100, 30], [180, -40], [260, 10], [400, 0]],
      (x, z) => 120 + x * 0.01 + z * 0.02,
    )
    const index = buildRoadProximityIndex(nodes, { maxDistance: 64 })
    expect(index).not.toBeNull()
    let checked = 0
    for (let x = -80; x <= 480; x += 7) {
      for (let z = -120; z <= 80; z += 11) {
        const expected = Math.min(bruteForceDistance(nodes, x, z), index!.range)
        expect(index!.distanceAt(x, z)).toBeCloseTo(expected, 5)
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(1000)
  })

  it('is exact on spatial-hash cell boundaries', () => {
    const nodes = makePolyline([[32, 32], [-64, 32], [-64, -96], [128, -96]])
    const index = buildRoadProximityIndex(nodes, { maxDistance: 96 })!
    for (const epsilon of [-1e-6, 0, 1e-6]) {
      for (const coordinate of [-96, -64, -32, 0, 32, 64, 96, 128]) {
        const samples: Array<[number, number]> = [
          [coordinate + epsilon, 0],
          [0, coordinate + epsilon],
          [coordinate + epsilon, coordinate + epsilon],
          [32 + epsilon, -96 + epsilon],
        ]
        for (const [x, z] of samples) {
          const expected = Math.min(bruteForceDistance(nodes, x, z), index.range)
          expect(index.distanceAt(x, z)).toBeCloseTo(expected, 5)
        }
      }
    }
  })

  it('caps queries at range and interpolates the road height at the closest point', () => {
    const nodes = makePolyline([[0, 0], [0, 200]], (_x, z) => z * 0.1)
    const index = buildRoadProximityIndex(nodes, { maxDistance: 50 })!
    expect(index.range).toBe(50)
    expect(index.distanceAt(500, 100)).toBe(50)
    expect(index.heightAt(500, 100)).toBeNull()
    expect(index.distanceAt(10, 50)).toBeCloseTo(10, 6)
    expect(index.heightAt(10, 50)).toBeCloseTo(5, 6)

    const diagonal = buildRoadProximityIndex(makePolyline(
      [[0, 0], [100, 100]],
      (x, z) => (x + z) * 0.25,
    ))!
    expect(diagonal.distanceAt(60, 40)).toBeCloseTo(Math.sqrt(200), 6)
    expect(diagonal.heightAt(60, 40)).toBeCloseTo(25, 6)
  })

  it('rejects degenerate inputs and skips zero-length segments', () => {
    expect(buildRoadProximityIndex([])).toBeNull()
    expect(buildRoadProximityIndex(makePolyline([[0, 0]]))).toBeNull()
    expect(buildRoadProximityIndex(makePolyline([[5, 5], [5, 5], [5, 5]]))).toBeNull()

    const mixed = makePolyline([[0, 0], [0, 0], [0, 40], [0, 40], [0, 80]])
    const index = buildRoadProximityIndex(mixed)
    expect(index).not.toBeNull()
    expect(index!.segmentCount).toBe(2)
    expect(index!.distanceAt(10, 40)).toBeCloseTo(10, 6)
  })

  it('stays exact with huge world offsets (40km+ terrain pack scale)', () => {
    // 用户场景尺度：地形横跨约 39km × 43km，道路节点坐标在 ±20km 量级。
    const nodes = makePolyline(
      [[-12000, 9000], [-4000, 2000], [5000, -6000], [13000, -13000]],
      (x, z) => 320 + x * 0.001 + z * 0.002,
    )
    const index = buildRoadProximityIndex(nodes, { maxDistance: 55 })
    expect(index).not.toBeNull()
    for (let i = 0; i < nodes.length - 1; i += 1) {
      const from = nodes[i]!
      const to = nodes[i + 1]!
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const x = from.x + (to.x - from.x) * t
        const z = from.z + (to.z - from.z) * t
        // 旧光栅场在该尺度上格边长 ≈ 40m，中心线会被误报“离路数十米”。
        expect(index!.distanceAt(x, z)).toBeCloseTo(0, 6)
        expect(index!.heightAt(x, z)).toBeCloseTo(from.y + (to.y - from.y) * t, 6)
      }
    }
  })

  it('is deterministic across rebuilds', () => {
    const nodes = makePolyline([[0, 0], [90, 45], [180, -30]], (x, z) => x * 0.05 + z * 0.1)
    const first = buildRoadProximityIndex(nodes)!
    const second = buildRoadProximityIndex(nodes)!
    for (const [x, z] of [[0, 0], [37, -55], [180, 20], [-40, 90]] as const) {
      expect(first.distanceAt(x, z)).toBe(second.distanceAt(x, z))
      expect(first.heightAt(x, z)).toBe(second.heightAt(x, z))
    }
  })

  it('verifies itself against brute force and catches a lying source', () => {
    const nodes = makePolyline([[0, 0], [120, 40], [240, -20]])
    const index = buildRoadProximityIndex(nodes, { maxDistance: 72 })!
    expect(verifyRoadProximityIndex(index, nodes)).toBe(true)
    const lying = { range: 72, distanceAt: () => 0, heightAt: () => null }
    expect(verifyRoadProximityIndex(lying, nodes)).toBe(false)
  })
})
