import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  clampProceduralLandscapeProps,
  cloneProceduralLandscapeProps,
  createDefaultProceduralLandscapeProps,
} from '@schema/proceduralLandscape/config'
import {
  buildScenicTerrainElevationProfile,
  resolveLowlandScenicStart,
  resolveOfficialScenicStartHeading,
  SLOWROADS_HILLS_ROAD_PROFILE,
  SLOWROADS_LOWLAND_ROAD_CONSTRAINTS,
  traceOfficialScenicRoad,
} from '@schema/proceduralLandscape/officialScenicRoad'
import {
  planWaypointRoadRoute,
  type WaypointRoadPlanOptions,
} from '@schema/proceduralLandscape/proceduralRoad'
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
  algorithmVersion: 3,
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

  it('traces deterministically with the fixed Hills profile', () => {
    const grid = makeSyntheticGrid(
      30_000,
      100,
      (x, z) => 1200
        + Math.sin(x / 420) * 90
        + Math.cos(z / 510) * 70
        + Math.sin((x + z) / 230) * 24,
    )
    const origin = { x: -1_800, z: -900 }
    const first = traceOfficialScenicRoad(grid, origin, 912347)
    const second = traceOfficialScenicRoad(grid, origin, 912347)
    const straightRun = (() => {
      let longest = 0
      let current = 0
      for (const node of first.nodes) {
        if (Math.abs(node.headingDelta) < (0.2 * Math.PI) / 180) {
          current += SLOWROADS_HILLS_ROAD_PROFILE.stepLength
          longest = Math.max(longest, current)
        } else {
          current = 0
        }
      }
      return longest
    })()
    const totalTurnDegrees = first.nodes.reduce(
      (sum, node) => sum + Math.abs(node.headingDelta) * 180 / Math.PI,
      0,
    )
    expect(first.nodes.length).toBeGreaterThan(50)
    expect(first.failureReason).toBe('reached-terrain-boundary')
    expect(straightRun).toBeLessThan(3_500)
    expect(totalTurnDegrees / (first.length / 1000)).toBeGreaterThan(10)
    expect(first.officialReverts).toBeGreaterThan(0)
    expect(first.antiTargetTriggers).toBeGreaterThan(0)
    expect(first.nodes.map((node) => [node.x, node.z, node.y])).toEqual(
      second.nodes.map((node) => [node.x, node.z, node.y]),
    )
  })

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

  it('prefers the lowland corridor in version 3', () => {
    const grid = makeSyntheticGrid(
      30_000,
      100,
      (x, z) => 1_000
        + Math.min(1_200, Math.max(0, Math.abs(x) - 900) * 0.32)
        + Math.sin(z / 900) * 18,
    )
    const origin = { x: 0, z: -8_000 }
    const lowland = traceOfficialScenicRoad(grid, origin, 912347, 24, {
      algorithmVersion: 3,
    })
    expect(lowland.failureReason).toBe('reached-terrain-boundary')
    expect(lowland.averageElevationPercentile).toBeLessThan(0.55)
    expect(lowland.lowlandCoverageFraction).toBeGreaterThanOrEqual(0.75)
    expect(lowland.maxForwardGrade).toBeLessThanOrEqual(
      SLOWROADS_LOWLAND_ROAD_CONSTRAINTS.maxGrade + 1e-4,
    )
    expect(lowland.maxCrossSlope).toBeLessThanOrEqual(
      SLOWROADS_LOWLAND_ROAD_CONSTRAINTS.maxCrossSlope + 1e-4,
    )
  })

  it('rejects terrain where every direction exceeds the cross-slope limit', () => {
    const grid = makeSyntheticGrid(
      4_000,
      20,
      (x) => 1_000 + x * 0.5,
    )
    const origin = { x: 0, z: 0 }
    const pure = traceOfficialScenicRoad(grid, origin, 123, 24, {
      algorithmVersion: 2,
    })
    const constrained = traceOfficialScenicRoad(grid, origin, 123, 24, {
      algorithmVersion: 3,
    })
    expect(pure.failureReason).toBe('reached-terrain-boundary')
    expect(constrained.failureReason).toBe('blocked-by-forward-grade')
    expect(constrained.nodes.length).toBeLessThanOrEqual(1)
  })

  it('keeps a high P1 as the start and ramps into lowland preference', () => {
    const grid = makeSyntheticGrid(
      30_000,
      100,
      (x, z) => 1_000
        + Math.min(1_200, Math.max(0, Math.abs(x) - 900) * 0.32)
        + Math.sin(z / 900) * 18,
    )
    const result = traceOfficialScenicRoad(grid, { x: 3_000, z: -8_000 }, 90210, 24, {
      algorithmVersion: 3,
    })
    expect(result.failureReason).toBe('reached-terrain-boundary')
    expect(result.nodes.length).toBeGreaterThan(20)
    expect(result.nodes[0]!.x).toBeCloseTo(3_000, 6)
    expect(result.maxForwardGrade).toBeLessThanOrEqual(
      SLOWROADS_LOWLAND_ROAD_CONSTRAINTS.maxGrade + 1e-4,
    )
    expect(result.averageElevationPercentile).toBeLessThan(0.65)
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

  it('keeps arbitrary waypoint counts and migrates legacy procedural origins', () => {
    const defaults = createDefaultProceduralLandscapeProps({ id: 'terrain-a' })
    const many = Array.from({ length: 900 }, (_, index) => ({ x: index * 2, z: 0 }))
    const clamped = clampProceduralLandscapeProps({
      road: {
        ...defaults.road,
        waypoints: many,
      },
    })
    expect(clamped.road.waypoints).toHaveLength(900)

    const migrated = clampProceduralLandscapeProps({
      seed: 77,
      road: {
        ...defaults.road,
        waypoints: [{ x: 40, z: 20 }],
        mode: 'procedural',
        procedural: {
          origin: { x: 10, z: 20 },
          termination: 'boundary',
        },
      } as any,
    })
    expect(migrated.road.generatedRoute?.waypoints[0]).toEqual({ x: 10, z: 20 })
    expect(migrated.road.generatedRoute?.waypoints[1]).toEqual({ x: 40, z: 20 })
    expect(migrated.road.generatedRoute?.termination).toBe('boundary')
    expect(migrated.road.generatedRoute?.algorithmVersion).toBe(1)
  })

  it('deep-clones generated route waypoints', () => {
    const props = createDefaultProceduralLandscapeProps({ id: 'terrain-a' })
    props.road.generatedRoute = {
      waypoints: [{ x: 1, z: 2 }],
      strategy: 'seeded',
      termination: 'boundary',
      algorithmVersion: 2,
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

  it('preserves legacy loop snapshots and forces version-2 routes open', () => {
    const defaults = createDefaultProceduralLandscapeProps({ id: 'terrain-a' })
    const legacy = clampProceduralLandscapeProps({
      road: {
        ...defaults.road,
        generatedRoute: {
          waypoints: [{ x: 10, z: 20 }],
          strategy: 'seeded',
          termination: 'loop',
          seed: 1,
          waypointTolerance: 4,
          pathDeviation: 60,
          revision: 1,
        } as any,
      },
    })
    expect(legacy.road.generatedRoute?.algorithmVersion).toBe(1)
    expect(legacy.road.generatedRoute?.termination).toBe('loop')

    const current = clampProceduralLandscapeProps({
      road: {
        ...defaults.road,
        generatedRoute: {
          waypoints: [{ x: 10, z: 20 }],
          strategy: 'seeded',
          termination: 'loop',
          algorithmVersion: 2,
          seed: 1,
          waypointTolerance: 4,
          pathDeviation: 60,
          revision: 1,
        },
      },
    })
    expect(current.road.generatedRoute?.termination).toBe('boundary')
  })
})

describe('unified waypoint road planning', () => {
  it('uses only P1 for natural scenic routing and stays open', () => {
    const grid = makeGrid((x, z) => Math.sin(x * 0.01) * 3 + Math.cos(z * 0.013) * 2)
    const waypoints = [
      { x: 250, z: 300 },
      { x: 480, z: 260 },
      { x: 650, z: 470 },
      { x: 360, z: 650 },
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
    expect(first.waypointsPassed).toBe(1)
    expect(first.maxWaypointError).toBeLessThanOrEqual(baseOptions.waypointTolerance)
    expect(second.nodes.map((node) => [node.x, node.z, node.y])).toEqual(
      first.nodes.map((node) => [node.x, node.z, node.y]),
    )
  })

  it('uses terrain-cost shortest routing and extends naturally to the boundary', () => {
    const grid = makeGrid((x, z) => (
      Math.exp(-((x - 470) ** 2 + (z - 450) ** 2) / 9000) * 70
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

  it('keeps version-1 snapshots on the legacy planner', () => {
    const grid = makeGrid()
    const result = planWaypointRoadRoute(grid, {
      ...baseOptions,
      algorithmVersion: 1,
      termination: 'loop',
      waypoints: [{ x: 450, z: 450 }],
    })
    expect(result.closed).toBe(true)
    expect(result.failureReason).toBe('reached-guide-end')
  })

  it('creates an official open route from one waypoint', () => {
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

  it('does not create a road without waypoints', () => {
    const result = planWaypointRoadRoute(makeGrid(), {
      ...baseOptions,
      waypoints: [],
    })
    expect(result.nodes).toHaveLength(0)
    expect(result.failureReason).toBe('no-waypoints')
  })
})
