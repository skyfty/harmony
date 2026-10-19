import { describe, expect, it } from 'vitest'
import {
  repairRoadCenterlineGeometry,
} from '@schema/proceduralLandscape/proceduralRoad'
import type { RoadTraceNode } from '@schema/proceduralLandscape/roadTrace'
import { validateRoadCenterlineGeometry } from '@schema/proceduralLandscape/roadGeometry'
import type { TerrainHeightGrid } from '@schema/proceduralLandscape/terrainSampler'

function makeGrid(
  heightAt: (x: number, z: number) => number = () => 1_000,
  size = 4_000,
  cellSize = 20,
): TerrainHeightGrid {
  const cols = Math.floor(size / cellSize) + 1
  const rows = cols
  const minX = -size * 0.5
  const minZ = -size * 0.5
  const heights = new Float32Array(cols * rows)
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const height = heightAt(minX + col * cellSize, minZ + row * cellSize)
      heights[row * cols + col] = height
      minY = Math.min(minY, height)
      maxY = Math.max(maxY, height)
    }
  }
  return {
    minX,
    minZ,
    maxX: minX + size,
    maxZ: minZ + size,
    cellSize,
    cols,
    rows,
    minY,
    maxY,
    averageEdgeLength: cellSize,
    heights,
    coverage: new Uint8Array(cols * rows).fill(1),
    memoryBytes: heights.byteLength + cols * rows,
    contains: (x, z) => x >= minX && x <= minX + size && z >= minZ && z <= minZ + size,
    sampleHeight: (x, z) => (
      x >= minX && x <= minX + size && z >= minZ && z <= minZ + size
        ? heightAt(x, z)
        : null
    ),
    sampleNormal: () => null,
  }
}

function line(
  from: { x: number; z: number },
  to: { x: number; z: number },
  spacing = 8,
): Array<{ x: number; z: number }> {
  const length = Math.hypot(to.x - from.x, to.z - from.z)
  const count = Math.max(1, Math.ceil(length / spacing))
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count
    return {
      x: from.x + (to.x - from.x) * t,
      z: from.z + (to.z - from.z) * t,
    }
  })
}

function nodesFrom(
  points: Array<{ x: number; z: number }>,
  yAt: (point: { x: number; z: number }) => number = () => 1_000,
): RoadTraceNode[] {
  return points.map((point, index) => ({
    x: point.x,
    z: point.z,
    y: yAt(point),
    heading: 0,
    index,
    lateral: 0,
    longitudinal: 0,
    turn: 0,
    headingDelta: 0,
  }))
}

const repairOptions = {
  waypointTolerance: 30,
  clearance: 7,
  minimumTurnRadius: 20,
  maximumHeadingChangeRad: (10 * Math.PI) / 180,
}

const sharpRoutes = [
  {
    name: '90 degree turn',
    points: (): Array<{ x: number; z: number }> => [
      ...line({ x: -600, z: 0 }, { x: 0, z: 0 }).slice(0, -1),
      ...line({ x: 0, z: 0 }, { x: 0, z: 600 }),
    ],
    waypoints: [
      { x: -600, z: 0 },
      { x: 0, z: 0 },
      { x: 0, z: 600 },
    ],
  },
  {
    name: '45 degree turn',
    points: (): Array<{ x: number; z: number }> => [
      ...line({ x: -600, z: 0 }, { x: 0, z: 0 }).slice(0, -1),
      ...line({ x: 0, z: 0 }, { x: 424.264, z: 424.264 }),
    ],
    waypoints: [
      { x: -600, z: 0 },
      { x: 0, z: 0 },
      { x: 424.264, z: 424.264 },
    ],
  },
  {
    name: 'short reversal',
    points: (): Array<{ x: number; z: number }> => [
      ...line({ x: -600, z: 0 }, { x: 0, z: 0 }).slice(0, -1),
      ...line({ x: 0, z: 0 }, { x: -20, z: 8 }).slice(0, -1),
      ...line({ x: -20, z: 8 }, { x: 0, z: 400 }).slice(0, -1),
      ...line({ x: 0, z: 400 }, { x: 0, z: 600 }),
    ],
    waypoints: [
      { x: -600, z: 0 },
      { x: 0, z: 600 },
    ],
  },
]

describe('automatic road centerline repair', () => {
  for (const route of sharpRoutes) {
    it(`rounds a ${route.name} into a drivable curve`, () => {
      const grid = makeGrid()
      const result = repairRoadCenterlineGeometry(
        grid,
        nodesFrom(route.points()),
        route.waypoints,
        repairOptions.waypointTolerance,
        repairOptions.clearance,
        repairOptions.minimumTurnRadius,
        repairOptions.maximumHeadingChangeRad,
      )
      expect(result).not.toBeNull()
      expect(result!.roundedCorners).toBeGreaterThan(0)
      expect(result!.maxWaypointOffset).toBeLessThanOrEqual(30)
      const geometry = validateRoadCenterlineGeometry(result!.nodes, repairOptions)
      expect(geometry.valid).toBe(true)
      expect(geometry.minTurnRadius).toBeGreaterThanOrEqual(19.95)
      expect(geometry.maxHeadingChangeRad).toBeLessThanOrEqual(
        repairOptions.maximumHeadingChangeRad,
      )
      expect(geometry.minCenterlineClearance).toBeGreaterThanOrEqual(7)
    })
  }

  it('refuses to move a waypoint farther than 30m', () => {
    const grid = makeGrid()
    const result = repairRoadCenterlineGeometry(
      grid,
      nodesFrom(line({ x: -600, z: 0 }, { x: 600, z: 0 })),
      [
        { x: -600, z: 0 },
        { x: 0, z: 50 },
        { x: 600, z: 0 },
      ],
      repairOptions.waypointTolerance,
      repairOptions.clearance,
      repairOptions.minimumTurnRadius,
      repairOptions.maximumHeadingChangeRad,
    )
    expect(result).toBeNull()
  })

  it('refuses a repair that cannot meet the terrain grade limit', () => {
    const grid = makeGrid((x) => 1_000 + x * 0.8)
    const result = repairRoadCenterlineGeometry(
      grid,
      nodesFrom(
        sharpRoutes[0]!.points(),
        (point) => 1_000 + point.x * 0.8,
      ),
      sharpRoutes[0]!.waypoints,
      repairOptions.waypointTolerance,
      repairOptions.clearance,
      repairOptions.minimumTurnRadius,
      repairOptions.maximumHeadingChangeRad,
    )
    expect(result).toBeNull()
  })

  it('is deterministic for the same input', () => {
    const grid = makeGrid()
    const nodes = nodesFrom(sharpRoutes[0]!.points())
    const first = repairRoadCenterlineGeometry(
      grid,
      nodes,
      sharpRoutes[0]!.waypoints,
      repairOptions.waypointTolerance,
      repairOptions.clearance,
      repairOptions.minimumTurnRadius,
      repairOptions.maximumHeadingChangeRad,
    )
    const second = repairRoadCenterlineGeometry(
      grid,
      nodes,
      sharpRoutes[0]!.waypoints,
      repairOptions.waypointTolerance,
      repairOptions.clearance,
      repairOptions.minimumTurnRadius,
      repairOptions.maximumHeadingChangeRad,
    )
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(second!.nodes.map((node) => [node.x, node.z, node.y])).toEqual(
      first!.nodes.map((node) => [node.x, node.z, node.y]),
    )
  })
})
