import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  clampProceduralLandscapeProps,
  cloneProceduralLandscapeProps,
  createDefaultProceduralLandscapeProps,
} from '@schema/proceduralLandscape/config'
import {
  buildScenicTerrainElevationProfile,
  projectWaypointCapture,
  resolveLowlandScenicStart,
  resolveLowlandScenicWaypoint,
  resolveOfficialScenicStartHeading,
  resolveRoadWaypointPlacement,
  SLOWROADS_SCENIC_ROAD_CONSTRAINTS,
} from '@schema/proceduralLandscape/officialScenicRoad'
import {
  planWaypointRoadRoute,
  type WaypointRoadPlanOptions,
} from '@schema/proceduralLandscape/proceduralRoad'
import {
  buildGlobalScenicGuide,
  roundGuideJoints,
} from '@schema/proceduralLandscape/globalScenicGuide'
import {
  minBezierCenterlineRadius,
  smoothPlanarCenterline,
} from '@schema/proceduralLandscape/centerlineBezier'
import {
  buildTerrainHeightGrid,
  type TerrainHeightGrid,
} from '@schema/proceduralLandscape/terrainSampler'

function makeGrid(height: (x: number, z: number) => number = () => 0): TerrainHeightGrid {
  const size = 900
  const segments = 90
  const positions: number[] = []
  const indices: number[] = []
  const cols = segments + 1
  for (let iz = 0; iz <= segments; iz += 1) {
    for (let ix = 0; ix <= segments; ix += 1) {
      const x = (ix / segments) * size
      const z = (iz / segments) * size
      positions.push(x, height(x, z), z)
    }
  }
  for (let iz = 0; iz < segments; iz += 1) {
    for (let ix = 0; ix < segments; ix += 1) {
      const a = iz * cols + ix
      const b = a + 1
      const c = a + cols
      const d = c + 1
      indices.push(a, b, d, a, d, c)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  const mesh = new THREE.Mesh(geometry)
  mesh.updateMatrixWorld(true)
  return buildTerrainHeightGrid(mesh, { cellSize: 5, maxGridSize: 1024 })!
}

const baseOptions: Omit<WaypointRoadPlanOptions, 'waypoints'> = {
  strategy: 'seeded',
  termination: 'boundary',
  seed: 912347,
  waypointTolerance: 4,
  pathDeviation: 60,
  stepLength: 8,
  feelDistance: 24,
  feelAngleRad: (32 * Math.PI) / 180,
  maxSlope: 0.55,
  maxTurnRad: (4 * Math.PI) / 180,
  margin: 12,
}

function makeSyntheticGrid(
  size = 30_000,
  cellSize = 100,
  heightFn: (x: number, z: number) => number = () => 0,
): TerrainHeightGrid {
  const cols = Math.floor(size / cellSize) + 1
  const rows = cols
  const minX = -size * 0.5
  const minZ = -size * 0.5
  const heights = new Float32Array(cols * rows)
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (let row = 0; row < rows; row += 1) {
    const z = minZ + row * cellSize
    for (let col = 0; col < cols; col += 1) {
      const x = minX + col * cellSize
      const height = heightFn(x, z)
      heights[row * cols + col] = height
      minY = Math.min(minY, height)
      maxY = Math.max(maxY, height)
    }
  }
  const sampleHeight = (x: number, z: number): number | null => {
    const gx = (x - minX) / cellSize
    const gz = (z - minZ) / cellSize
    if (gx < 0 || gx > cols - 1 || gz < 0 || gz > rows - 1) {
      return null
    }
    const col = Math.min(cols - 2, Math.floor(gx))
    const row = Math.min(rows - 2, Math.floor(gz))
    const tx = gx - col
    const tz = gz - row
    const h00 = heights[row * cols + col]!
    const h10 = heights[row * cols + col + 1]!
    const h01 = heights[(row + 1) * cols + col]!
    const h11 = heights[(row + 1) * cols + col + 1]!
    return h00 * (1 - tx) * (1 - tz)
      + h10 * tx * (1 - tz)
      + h01 * (1 - tx) * tz
      + h11 * tx * tz
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
    sampleHeight,
    sampleNormal: () => null,
  }
}

describe('official Slow Roads Hills midline', () => {
  it('derives the start heading from the local contour', () => {
    const grid = makeSyntheticGrid(
      2_000,
      20,
      (x, z) => x * 0.2 + z * 0.1,
    )
    const heading = resolveOfficialScenicStartHeading(grid, -200, -100)
    expect(Number.isFinite(heading)).toBe(true)
    expect(Math.abs(heading)).toBeGreaterThan(0.1)
    expect(Math.abs(heading)).toBeLessThan(Math.PI - 0.1)
  })

  it('projects a crossing segment into the waypoint tolerance disc', () => {
    const capture = projectWaypointCapture(
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 5, z: 2.5 },
      3,
    )
    expect(capture).not.toBeNull()
    expect(capture!.x).toBeCloseTo(5, 6)
    expect(capture!.z).toBeCloseTo(0, 6)
    expect(capture!.distance).toBeCloseTo(2.5, 6)
    expect(
      projectWaypointCapture(
        { x: 0, z: 0 },
        { x: 10, z: 0 },
        { x: 5, z: 2.5 },
        2,
      ),
    ).toBeNull()
  })

  it('traces deterministically with the global guided planner', () => {
    const grid = makeSyntheticGrid(
      30_000,
      100,
      (x, z) => 1200
        + Math.sin(x / 420) * 90
        + Math.cos(z / 510) * 70
        + Math.sin((x + z) / 230) * 24,
    )
    const origin = { x: -1_800, z: -900 }
    const first = planWaypointRoadRoute(grid, {
      ...baseOptions,
      waypoints: [origin],
    })
    const second = planWaypointRoadRoute(grid, {
      ...baseOptions,
      waypoints: [origin],
    })
    expect(first.nodes.length).toBeGreaterThan(50)
    expect(first.failureReason).toBe('reached-terrain-boundary')
    expect(first.nodes.map((node) => [node.x, node.z, node.y])).toEqual(
      second.nodes.map((node) => [node.x, node.z, node.y]),
    )
  }, 30_000)

  it('builds monotonically increasing DEM elevation percentiles', () => {
    const grid = makeSyntheticGrid(
      4_000,
      20,
      (x) => 1_000 + x * 0.2,
    )
    const profile = buildScenicTerrainElevationProfile(grid)
    expect(profile.minY).toBeLessThan(profile.lowlandHeight)
    expect(profile.lowlandHeight).toBeLessThan(profile.lowlandCoverageHeight)
    expect(profile.lowlandCoverageHeight).toBeLessThan(profile.preferenceCeilingHeight)
    expect(profile.percentileAtHeight(profile.lowlandHeight)).toBeCloseTo(0.4, 1)
    expect(profile.percentileAtHeight(profile.preferenceCeilingHeight)).toBeCloseTo(0.7, 1)
  })

  it('chooses a low gentle automatic start near a steep preferred centre', () => {
    const grid = makeSyntheticGrid(
      30_000,
      100,
      (x, z) => 1_000
        + Math.min(1_200, Math.max(0, Math.abs(x) - 900) * 0.32)
        + Math.sin(z / 900) * 18,
    )
    const preferred = { x: 3_000, z: -8_000 }
    const start = resolveLowlandScenicStart(grid, preferred.x, preferred.z)
    expect(start).not.toBeNull()
    const preferredHeight = grid.sampleHeight(preferred.x, preferred.z)!
    const startHeight = grid.sampleHeight(start!.x, start!.z)!
    expect(startHeight).toBeLessThan(preferredHeight)
    expect(Math.abs(start!.x)).toBeLessThan(2_500)
  })

  it('snaps an invalid clicked waypoint to a nearby suitable position', () => {
    const grid = makeSyntheticGrid(
      4_000,
      100,
      (x) => 1_000 + (x > 0 && x < 300 ? 300 : 0),
    )
    const valid = resolveLowlandScenicWaypoint(grid, -500, 0)
    expect(valid).not.toBeNull()
    expect(valid!.distanceFromClick).toBeCloseTo(0, 6)

    const snapped = resolveLowlandScenicWaypoint(grid, 150, 0)
    expect(snapped).not.toBeNull()
    expect(snapped!.distanceFromClick).toBeGreaterThan(0)
    expect(snapped!.distanceFromClick).toBeLessThanOrEqual(500)
    expect(snapped!.elevationPercentile).toBeLessThanOrEqual(0.7)
    expect(snapped!.gradient).toBeLessThanOrEqual(0.35)
  })

  it('returns no snapped waypoint when the search radius has no valid terrain', () => {
    const grid = makeSyntheticGrid(
      4_000,
      20,
      (x) => 1_000 + x * 0.5,
    )
    expect(resolveLowlandScenicWaypoint(grid, 0, 0, 50)).toBeNull()
  })

  it('uses the current relaxed cross-slope limit for waypoint placement', () => {
    const grid = makeSyntheticGrid(
      4_000,
      20,
      (x) => 1_000 + x * 0.4,
    )
    expect(resolveLowlandScenicWaypoint(
      grid,
      0,
      0,
      500,
      { maxCrossSlope: 0.35 },
    )).toBeNull()
    const relaxed = resolveLowlandScenicWaypoint(grid, 0, 0, 500)
    expect(relaxed).not.toBeNull()
    expect(relaxed!.distanceFromClick).toBeCloseTo(0, 6)
    expect(relaxed!.gradient).toBeLessThanOrEqual(
      SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope + 1e-4,
    )
  })

  it('accepts a high gentle waypoint without the scenic lowland ceiling', () => {
    const grid = makeSyntheticGrid(
      4_000,
      20,
      (x, z) => 1_000 + (Math.hypot(x, z) < 400 ? 2_000 : 0),
    )

    expect(resolveLowlandScenicWaypoint(grid, 0, 0, 50)).toBeNull()

    const placement = resolveRoadWaypointPlacement(grid, 0, 0, 50)
    expect(placement.ok).toBe(true)
    if (!placement.ok) {
      return
    }
    expect(placement.snapped).toBe(false)
    expect(placement.placement.distanceFromClick).toBe(0)
    expect(placement.placement.gradient).toBeLessThanOrEqual(
      SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope,
    )
  })

  it('rejects a steep waypoint when no nearby point is buildable', () => {
    const grid = makeSyntheticGrid(
      4_000,
      20,
      (x) => 1_000 + x * 0.8,
    )
    const placement = resolveRoadWaypointPlacement(grid, 0, 0, 50)
    expect(placement).toEqual({
      ok: false,
      failureReason: 'too-steep',
    })
  })

  it('snaps only within the explicit 50m road-waypoint radius', () => {
    const plateauStartingAt = (startX: number) => (x: number) => (
      x >= startX && x <= startX + 80
        ? 1_000 + startX * 2
        : 1_000 + x * 2
    )
    const nearGrid = makeSyntheticGrid(4_000, 20, plateauStartingAt(20))
    const near = resolveRoadWaypointPlacement(nearGrid, 0, 0, 40)
    expect(near.ok).toBe(true)
    if (near.ok) {
      expect(near.snapped).toBe(true)
      expect(near.placement.distanceFromClick).toBeCloseTo(40, 6)
    }
    expect(resolveRoadWaypointPlacement(nearGrid, 0, 0, 30)).toMatchObject({
      ok: false,
      failureReason: 'too-steep',
    })

    const farGrid = makeSyntheticGrid(4_000, 20, plateauStartingAt(40))
    expect(resolveRoadWaypointPlacement(farGrid, 0, 0, 50)).toMatchObject({
      ok: false,
      failureReason: 'too-steep',
    })
    const farther = resolveRoadWaypointPlacement(farGrid, 0, 0, 80)
    expect(farther.ok).toBe(true)
    if (farther.ok) {
      expect(farther.placement.distanceFromClick).toBeCloseTo(60, 6)
    }
  })

  it('reports outside-terrain placement failures', () => {
    const grid = makeSyntheticGrid(4_000, 20)
    expect(
      resolveRoadWaypointPlacement(grid, grid.maxX + 100, 0, 0),
    ).toEqual({
      ok: false,
      failureReason: 'outside-terrain',
    })
  })

  it('follows every mandatory waypoint around a hill and reaches the boundary', () => {
    const grid = makeSyntheticGrid(
      30_000,
      100,
      (x, z) => 1_000 + Math.exp(
        -((x / 700) ** 2 + (z / 700) ** 2),
      ) * 1_200,
    )
    const waypoints = [
      { x: -2_400, z: -700 },
      { x: 2_400, z: -600 },
      { x: 2_400, z: 600 },
    ]
    const options = {
      ...baseOptions,
      waypoints,
    }
    const first = planWaypointRoadRoute(grid, options)
    const second = planWaypointRoadRoute(grid, options)
    expect(
      first.complete,
      `${first.failureReason} / passed ${first.waypointsPassed} / skipped ${JSON.stringify(first.skippedWaypointIndices)} / error ${first.maxWaypointError}`,
    ).toBe(true)
    expect(first.failureReason).toBe('reached-terrain-boundary')
    expect(first.waypointsPassed).toBe(waypoints.length)
    expect(first.waypointsSkipped).toBe(0)
    expect(first.skippedWaypointIndices).toEqual([])
    expect(first.maxWaypointError).toBeLessThanOrEqual(
      options.waypointTolerance + 1e-4,
    )
    expect(first.maxForwardGrade).toBeLessThanOrEqual(
      SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade + 1e-4,
    )
    expect(first.maxCrossSlope).toBeLessThanOrEqual(
      SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope + 1e-4,
    )
    expect(first.plannerMode).toBe('guided-global')
    expect(first.guideExpandedStates).toBeGreaterThan(0)
    expect(second.nodes.map((node) => [node.x, node.z, node.y])).toEqual(
      first.nodes.map((node) => [node.x, node.z, node.y]),
    )
  }, 30_000)

  it('fails instead of skipping a waypoint isolated by a cliff', () => {
    const grid = makeSyntheticGrid(
      12_000,
      100,
      (x, z) => Math.hypot(x - 3_000, z) < 160 ? 2_000 : 1_000,
    )
    const result = planWaypointRoadRoute(grid, {
      ...baseOptions,
      waypoints: [
        { x: -3_000, z: 0 },
        { x: 3_000, z: 0 },
      ],
    })
    expect(result.complete).toBe(false)
    expect(result.failureReason).toBe('waypoint-unreachable')
    expect(result.unreachableWaypointIndex).toBe(1)
    expect(result.waypointsSkipped).toBe(0)
    expect(result.skippedWaypointIndices).toEqual([])
    expect(result.nodes).toHaveLength(0)
  })

  it('accepts a 25% grade corridor with the current hard limit', () => {
    const grid = makeSyntheticGrid(
      20_000,
      100,
      (x) => 1_000 + x * 0.25,
    )
    const waypoints = [
      { x: -3_000, z: 0 },
      { x: 3_000, z: 0 },
    ]
    const relaxed = planWaypointRoadRoute(grid, {
      ...baseOptions,
      waypoints,
    })
    expect(relaxed.complete).toBe(true)
    expect(relaxed.waypointsPassed).toBe(2)
    expect(relaxed.maxForwardGrade).toBeLessThanOrEqual(
      SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade + 1e-4,
    )
  })

  it('dead-end routing stops exactly at the last waypoint', () => {
    const grid = makeGrid()
    const waypoints = [
      { x: 150, z: 300 },
      { x: 450, z: 420 },
      { x: 750, z: 300 },
    ]
    const result = planWaypointRoadRoute(grid, {
      ...baseOptions,
      termination: 'dead-end',
      waypoints,
    })
    const last = result.nodes[result.nodes.length - 1]!
    expect(
      result.complete,
      `${result.failureReason} nodes ${result.nodes.length} closed ${result.closed} passed ${result.waypointsPassed}/${result.waypointCount} closure ${result.closureHeadingErrorRad}`,
    ).toBe(true)
    expect(result.closed).toBe(false)
    expect(result.failureReason).toBe('reached-route-end')
    expect(result.waypointsPassed).toBe(3)
    expect(Math.hypot(
      last.x - waypoints[2]!.x,
      last.z - waypoints[2]!.z,
    )).toBeLessThanOrEqual(1e-3)
  })

  it('multi-waypoint loop closes back onto P1', () => {
    const grid = makeGrid()
    const waypoints = [
      { x: 150, z: 300 },
      { x: 450, z: 320 },
      { x: 720, z: 520 },
    ]
    const result = planWaypointRoadRoute(grid, {
      ...baseOptions,
      termination: 'loop',
      waypoints,
    })
    const first = result.nodes[0]!
    const last = result.nodes[result.nodes.length - 1]!
    expect(
      result.complete,
      `${result.failureReason} nodes ${result.nodes.length} closed ${result.closed} passed ${result.waypointsPassed}/${result.waypointCount} closure ${result.closureHeadingErrorRad}`,
    ).toBe(true)
    expect(result.closed).toBe(true)
    expect(result.failureReason).toBe('reached-route-start')
    expect(result.waypointsPassed).toBe(3)
    expect(last.x).toBeCloseTo(first.x, 6)
    expect(last.z).toBeCloseTo(first.z, 6)
    expect(result.closureHeadingErrorRad).toBeLessThanOrEqual(Math.PI / 4)
  })

  it('creates a single-point loop and rejects a single dead end', () => {
    const grid = makeGrid()
    const origin = { x: 450, z: 450 }
    const loop = planWaypointRoadRoute(grid, {
      ...baseOptions,
      termination: 'loop',
      waypoints: [origin],
    })
    expect(
      loop.complete,
      `${loop.failureReason} nodes ${loop.nodes.length} closed ${loop.closed} passed ${loop.waypointsPassed}/${loop.waypointCount} closure ${loop.closureHeadingErrorRad}`,
    ).toBe(true)
    expect(loop.closed).toBe(true)
    expect(loop.waypointsPassed).toBe(1)
    expect(loop.nodes[0]!.x).toBeCloseTo(
      loop.nodes[loop.nodes.length - 1]!.x,
      6,
    )
    expect(loop.nodes[0]!.z).toBeCloseTo(
      loop.nodes[loop.nodes.length - 1]!.z,
      6,
    )

    const deadEnd = planWaypointRoadRoute(grid, {
      ...baseOptions,
      termination: 'dead-end',
      waypoints: [origin],
    })
    expect(deadEnd.complete).toBe(false)
    expect(deadEnd.failureReason).toBe('route-too-short')
  })

})

describe('unified waypoint road configuration', () => {
  it('defaults to natural seeded open routing with no committed road', () => {
    const defaults = createDefaultProceduralLandscapeProps({ id: 'terrain-a' })
    expect(defaults.road.routing).toEqual({
      strategy: 'seeded',
      termination: 'boundary',
    })
    expect(defaults.road.generatedRoute).toBeNull()
    expect(defaults.road.waypointTolerance).toBe(4)
  })

  it('keeps arbitrary waypoint counts', () => {
    const defaults = createDefaultProceduralLandscapeProps({ id: 'terrain-a' })
    const many = Array.from({ length: 900 }, (_, index) => ({ x: index * 2, z: 0 }))
    const clamped = clampProceduralLandscapeProps({
      road: {
        ...defaults.road,
        waypoints: many,
      },
    })
    expect(clamped.road.waypoints).toHaveLength(900)
  })

  it('deep-clones generated route waypoints', () => {
    const props = createDefaultProceduralLandscapeProps({ id: 'terrain-a' })
    props.road.generatedRoute = {
      waypoints: [{ x: 1, z: 2 }],
      strategy: 'seeded',
      termination: 'boundary',
      seed: 1,
      waypointTolerance: 4,
      pathDeviation: 60,
      revision: 1,
    }
    const clone = cloneProceduralLandscapeProps(props)
    expect(clone.road.generatedRoute?.waypoints[0]).toEqual({ x: 1, z: 2 })
    expect(clone.road.generatedRoute?.waypoints[0]).not.toBe(
      props.road.generatedRoute.waypoints[0],
    )
  })

  it('preserves all termination modes in live routing and snapshots', () => {
    const defaults = createDefaultProceduralLandscapeProps({ id: 'terrain-a' })
    for (const termination of ['loop', 'boundary', 'dead-end'] as const) {
      const props = clampProceduralLandscapeProps({
        road: {
          ...defaults.road,
          routing: { strategy: 'seeded', termination },
          generatedRoute: {
            waypoints: [{ x: 10, z: 20 }],
            strategy: 'seeded',
            termination,
            seed: 1,
            waypointTolerance: 4,
            pathDeviation: 60,
            revision: 1,
          },
        },
      })
      expect(props.road.routing.termination).toBe(termination)
      expect(props.road.generatedRoute?.termination).toBe(termination)
    }
  })
})

describe('unified waypoint road planning', () => {
  it('rounds a right-angle guide joint with a Bezier arc near the waypoint', () => {
    const grid = makeGrid()
    const points: Array<{ x: number; z: number }> = []
    for (let x = 300; x <= 450; x += 8) {
      points.push({ x, z: 450 })
    }
    const jointIndex = points.length - 1
    for (let z = 458; z <= 600; z += 8) {
      points.push({ x: 450, z })
    }
    const rounded = roundGuideJoints(
      grid,
      points,
      [jointIndex],
      8,
      12,
      1,
    )
    expect(rounded).not.toEqual(points)
    expect(rounded[0]).toEqual(points[0])
    expect(rounded[rounded.length - 1]).toEqual(points[points.length - 1])
    expect(Math.min(...rounded.map((point) => Math.hypot(
      point.x - 450,
      point.z - 450,
    )))).toBeLessThanOrEqual(12)

    let maxTurn = 0
    for (let index = 2; index < rounded.length; index += 1) {
      const a = rounded[index - 2]!
      const b = rounded[index - 1]!
      const c = rounded[index]!
      const headingA = Math.atan2(b.z - a.z, b.x - a.x)
      const headingB = Math.atan2(c.z - b.z, c.x - b.x)
      maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(
        Math.sin(headingB - headingA),
        Math.cos(headingB - headingA),
      )))
    }
    expect(maxTurn).toBeLessThan((35 * Math.PI) / 180)
  })

  it('does not leave a 90-degree turn on the rendered centerline', () => {
    const grid = makeGrid()
    const waypoint = { x: 450, z: 450 }
    const result = planWaypointRoadRoute(grid, {
      ...baseOptions,
      termination: 'boundary',
      waypoints: [
        { x: 250, z: 450 },
        waypoint,
        { x: 450, z: 650 },
      ],
    })
    expect(result.complete).toBe(true)
    expect(result.waypointsPassed).toBe(3)
    const nearby = result.nodes.filter((node) => Math.hypot(
      node.x - waypoint.x,
      node.z - waypoint.z,
    ) <= 180)
    let maxTurn = 0
    let maxTurnNode = -1
    for (let index = 1; index < nearby.length; index += 1) {
      const turn = Math.abs(nearby[index]!.headingDelta)
      if (turn > maxTurn) {
        maxTurn = turn
        maxTurnNode = index
      }
    }
    expect(
      maxTurn,
      `maxTurn at ${maxTurnNode}: ${JSON.stringify(nearby[maxTurnNode - 1])} -> ${JSON.stringify(nearby[maxTurnNode])} -> ${JSON.stringify(nearby[maxTurnNode + 1])}`,
    ).toBeLessThan((15 * Math.PI) / 180)
  })

  it('rounds guide joins before the official tracer consumes them', () => {
    const grid = makeGrid()
    const waypoint = { x: 450, z: 450 }
    const guide = buildGlobalScenicGuide(grid, [
      { x: 250, z: 450 },
      waypoint,
      { x: 450, z: 650 },
    ], {
      seed: baseOptions.seed,
      stepLength: baseOptions.stepLength,
      pathDeviation: baseOptions.pathDeviation,
      margin: baseOptions.margin,
      termination: 'boundary',
      preferredGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.preferredGrade,
      maxGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade,
      maxCrossSlope: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope * 0.9,
      crossSlopeWeight: 18,
      waypointTolerance: baseOptions.waypointTolerance,
    })
    expect(guide.failureReason).toBeNull()
    const nearby = guide.points.filter((point) => Math.hypot(
      point.x - waypoint.x,
      point.z - waypoint.z,
    ) <= 60)
    let maxTurn = 0
    for (let index = 2; index < nearby.length; index += 1) {
      const a = nearby[index - 2]!
      const b = nearby[index - 1]!
      const c = nearby[index]!
      const headingA = Math.atan2(b.z - a.z, b.x - a.x)
      const headingB = Math.atan2(c.z - b.z, c.x - b.x)
      maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(
        Math.sin(headingB - headingA),
        Math.cos(headingB - headingA),
      )))
    }
    expect(maxTurn).toBeLessThan((35 * Math.PI) / 180)
  })

  it('removes A* staircase zigzags from the smoothed centerline', () => {
    const points = Array.from({ length: 61 }, (_, index) => ({
      x: index * 10,
      z: index % 2 === 0 ? -9 : 9,
    }))
    const smoothed = smoothPlanarCenterline(points, {
      radius: 30,
      sampleSpacing: 2,
      controlSpacing: 33,
    })
    const countHeadingFlips = (line: ReadonlyArray<{ x: number; z: number }>): number => {
      let previousSign = 0
      let flips = 0
      for (let index = 2; index < line.length; index += 1) {
        const a = line[index - 2]!
        const b = line[index - 1]!
        const c = line[index]!
        const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x)
        const sign = Math.abs(cross) <= 1e-9 ? 0 : Math.sign(cross)
        if (sign !== 0 && previousSign !== 0 && sign !== previousSign) {
          flips += 1
        }
        if (sign !== 0) {
          previousSign = sign
        }
      }
      return flips
    }
    expect(countHeadingFlips(smoothed)).toBeLessThan(countHeadingFlips(points) * 0.25)
    expect(minBezierCenterlineRadius(smoothed)).toBeGreaterThanOrEqual(24)
  })

  it('passes ordered waypoints and continues to the boundary', () => {
    const grid = makeSyntheticGrid(
      30_000,
      100,
      (x, z) => 1_200
        + Math.sin(x / 1_400) * 12
        + Math.cos(z / 1_700) * 9,
    )
    const origin = { x: -1_800, z: -900 }
    const waypoints = [
      origin,
      { x: -300, z: 1_200 },
      { x: 1_200, z: 2_800 },
      { x: 2_200, z: 4_200 },
    ]
    const first = planWaypointRoadRoute(grid, {
      ...baseOptions,
      waypoints,
    })
    const second = planWaypointRoadRoute(grid, {
      ...baseOptions,
      waypoints,
    })
    expect(first.failureReason).toBe('reached-terrain-boundary')
    expect(first.closed).toBe(false)
    expect(
      first.waypointsPassed,
      `${first.failureReason} skipped ${JSON.stringify(first.skippedWaypointIndices)} attempted ${first.waypointsAttempted} nodes ${first.nodes.length} closest ${waypoints.map((point) => Math.min(...first.nodes.map((node) => Math.hypot(node.x - point.x, node.z - point.z))).toFixed(1)).join(',')}`,
    ).toBe(waypoints.length)
    expect(first.waypointsSkipped).toBe(0)
    expect(first.maxWaypointError).toBeLessThanOrEqual(baseOptions.waypointTolerance)
    expect(second.nodes.map((node) => [node.x, node.z, node.y])).toEqual(
      first.nodes.map((node) => [node.x, node.z, node.y]),
    )
  }, 30_000)

  it('uses terrain-cost shortest routing and extends naturally to the boundary', () => {
    const grid = makeGrid((x, z) => (
      Math.exp(-((x - 470) ** 2 + (z - 450) ** 2) / 9000) * 40
    ))
    const waypoints = [
      { x: 250, z: 450 },
      { x: 450, z: 350 },
      { x: 680, z: 450 },
    ]
    const result = planWaypointRoadRoute(grid, {
      ...baseOptions,
      strategy: 'shortest',
      termination: 'boundary',
      waypoints,
    })
    expect(
      result.complete,
      `${result.failureReason} / err ${result.maxWaypointError} / nodes ${result.nodes.length} / passed ${result.waypointsPassed}`,
    ).toBe(true)
    expect(result.waypointsPassed).toBe(3)
    expect(result.maxWaypointError).toBeLessThanOrEqual(4)
    expect(result.maxForwardGrade).toBeLessThanOrEqual(0.28 + 1e-4)
    expect(result.maxCrossSlope).toBeLessThanOrEqual(0.45 + 1e-4)
    expect(result.failureReason).toBe('reached-terrain-boundary')
    const last = result.nodes[result.nodes.length - 1]!
    expect(
      last.x <= 20
      || last.x >= 880
      || last.z <= 20
      || last.z >= 880,
      `boundary tail stopped at ${last.x}, ${last.z}`,
    ).toBe(true)
  })

  it('shortest routing supports dead ends without a boundary tail', () => {
    const grid = makeGrid()
    const waypoints = [
      { x: 250, z: 450 },
      { x: 450, z: 350 },
      { x: 680, z: 450 },
    ]
    const result = planWaypointRoadRoute(grid, {
      ...baseOptions,
      strategy: 'shortest',
      termination: 'dead-end',
      waypoints,
    })
    const last = result.nodes[result.nodes.length - 1]!
    expect(result.complete).toBe(true)
    expect(result.failureReason).toBe('reached-route-end')
    expect(result.waypointsPassed).toBe(3)
    expect(Math.hypot(
      last.x - waypoints[2]!.x,
      last.z - waypoints[2]!.z,
    )).toBeLessThanOrEqual(1e-3)
  })

  it('creates an open route from one waypoint', () => {
    const grid = makeGrid()
    const origin = { x: 450, z: 450 }
    const result = planWaypointRoadRoute(grid, {
      ...baseOptions,
      waypoints: [origin],
    })
    expect(result.complete).toBe(true)
    expect(result.closed).toBe(false)
    expect(result.failureReason).toBe('reached-terrain-boundary')
    expect(result.nodes.length).toBeGreaterThan(20)
    expect(result.maxWaypointError).toBeLessThanOrEqual(4)
  })

  it('can use terrain shortest routing for a single-point loop scaffold', () => {
    const grid = makeGrid()
    const result = planWaypointRoadRoute(grid, {
      ...baseOptions,
      strategy: 'shortest',
      termination: 'loop',
      waypoints: [{ x: 450, z: 450 }],
    })
    expect(result.complete).toBe(true)
    expect(result.closed).toBe(true)
    expect(result.waypointsPassed).toBe(1)
    expect(result.maxWaypointError).toBeLessThanOrEqual(4)
  })

  it('uses a soft waypoint detour radius before expanding the search', () => {
    const grid = makeSyntheticGrid(
      4_000,
      20,
      (x, z) => (
        Math.abs(x) < 120 && Math.abs(z) < 260
          ? 2_000
          : 1_000
      ),
    )
    const waypoints = [
      { x: -600, z: 0 },
      { x: 600, z: 0 },
    ]
    const constrained = planWaypointRoadRoute(grid, {
      ...baseOptions,
      waypoints,
      pathDeviation: 500,
      termination: 'dead-end',
    })
    expect(constrained.complete).toBe(true)
    expect(constrained.waypointsPassed).toBe(2)
    expect(constrained.detourRadiusExpanded).toBe(false)
    expect(constrained.maxDetourDistance).toBeLessThanOrEqual(500)

    const expanded = planWaypointRoadRoute(grid, {
      ...baseOptions,
      waypoints,
      pathDeviation: 100,
      termination: 'dead-end',
    })
    expect(expanded.complete).toBe(true)
    expect(expanded.waypointsPassed).toBe(2)
    expect(expanded.detourRadiusExpanded).toBe(true)
    expect(expanded.maxDetourDistance).toBeGreaterThan(100)
  }, 30_000)

  it('does not create a road without waypoints', () => {
    const result = planWaypointRoadRoute(makeGrid(), {
      ...baseOptions,
      waypoints: [],
    })
    expect(result.nodes).toHaveLength(0)
    expect(result.failureReason).toBe('no-waypoints')
  })
})
