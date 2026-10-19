/**
 * Unit tests for the procedural landscape generation math (height grid
 * rasterization, road tracing, density determinism, chunk planning and the
 * road field encoding). Everything under test is pure so the editor vitest
 * setup is enough.
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  buildTerrainHeightGrid,
  buildTerrainHeightGridFromSources,
  collectTerrainMeshSources,
} from '@schema/proceduralLandscape/terrainSampler'
import { traceRoadPath } from '@schema/proceduralLandscape/roadTrace'
import {
  buildForestDensityField,
  densityClassFromNoise,
} from '@schema/proceduralLandscape/densityField'
import {
  buildRoadFieldData,
  computeRoadEdgeHeights,
  createRoadFieldTexture,
  decodeRoadDistance,
  encodeRoadDistance,
} from '@schema/proceduralLandscape/roadField'
import { createRoadBand } from '@schema/proceduralLandscape/roadBand'
import { isProceduralLandscapeRoadSurface } from '@schema/proceduralLandscape/collisionMetadata'
import { buildTerrainSurfaceSampler } from '@schema/proceduralLandscape/terrainSurfaceSampler'
import { densifyRoadRows, sampleRoadRowColumns } from '@schema/proceduralLandscape/roadBandRows'
import {
  buildRoadProximityIndex,
  verifyRoadProximityIndex,
} from '@schema/proceduralLandscape/roadProximity'
import {
  planCameraGrassChunk,
  planRoadBucket,
  planTreeChunk,
  takeDensityPrefix,
} from '@schema/proceduralLandscape/chunkPlan'
import { fbm2 } from '@schema/proceduralLandscape/noise'
import { createDefaultProceduralLandscapeProps } from '@schema/proceduralLandscape/config'
import {
  activeRoadWaypoints,
  clampProceduralLandscapeProps,
} from '@schema/proceduralLandscape/config'
import {
  collectFarForestPlacements,
  createFarForestScan,
  FAR_FOREST_NEAR_DENSITY_PER_CLASS,
  FAR_FOREST_RINGS,
  planFarForestRings,
  stepFarForestScan,
  type FarForestPlanParams,
  type FarForestRingSpec,
} from '@schema/proceduralLandscape/farForest'
import {
  computeWaterFloodStats,
  resolveWaterLevelForFloodFraction,
  WATER_FLOOD_VISIBLE_FRACTION,
} from '@schema/proceduralLandscape/waterStats'
import {
  clampRoadWaypoints,
  transformRoadWaypointsToWorld,
} from '@schema/proceduralLandscape/roadWaypoints'
import {
  applyProceduralLandscapeSurfaceInjection,
  createProceduralLandscapeSurfaceUniforms,
} from '@schema/proceduralLandscape/surfaceMaterial'
import { PROCEDURAL_LANDSCAPE_COMPONENT_TYPE } from '@schema/components'
import { visitExplicitComponentAssetReferences } from '@/utils/sceneExplicitAssetReferences'
import { computeRoadMarkings } from '@schema/proceduralLandscape/roadMarkings'
import {
  DEFAULT_ROAD_STYLE,
  ROAD_STYLE_PROFILES,
  WALL_NODE_SPACING,
  WALL_SEGMENT_RULES,
} from '@schema/proceduralLandscape/roadStyle'
import { computeWallSegments, type WallTerrainSampling } from '@schema/proceduralLandscape/walls'

function makeGridMesh(
  options: {
    minX?: number
    minZ?: number
    sizeX: number
    sizeZ: number
    segmentsX: number
    segmentsZ: number
    height: (x: number, z: number) => number
  },
): THREE.Mesh {
  const minX = options.minX ?? 0
  const minZ = options.minZ ?? 0
  const positions: number[] = []
  const indices: number[] = []
  const cols = options.segmentsX + 1
  for (let iz = 0; iz <= options.segmentsZ; iz += 1) {
    for (let ix = 0; ix <= options.segmentsX; ix += 1) {
      const x = minX + (ix / options.segmentsX) * options.sizeX
      const z = minZ + (iz / options.segmentsZ) * options.sizeZ
      positions.push(x, options.height(x, z), z)
    }
  }
  for (let iz = 0; iz < options.segmentsZ; iz += 1) {
    for (let ix = 0; ix < options.segmentsX; ix += 1) {
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
  return mesh
}

describe('terrain height grid', () => {
  it('rasterizes a planar slope and samples bilinearly', () => {
    const mesh = makeGridMesh({
      sizeX: 100,
      sizeZ: 100,
      segmentsX: 20,
      segmentsZ: 20,
      height: (x) => x * 0.1,
    })
    const grid = buildTerrainHeightGrid(mesh, { cellSize: 5, maxGridSize: 256 })
    expect(grid).not.toBeNull()
    expect(grid!.sampleHeight(50, 50)).toBeCloseTo(5, 1)
    expect(grid!.sampleHeight(20, 80)).toBeCloseTo(2, 1)
    const normal = grid!.sampleNormal(50, 50)
    expect(normal).not.toBeNull()
    expect(normal!.y).toBeGreaterThan(0.9)
    expect(grid!.contains(50, 50)).toBe(true)
  })

  it('prefers the smallest triangle when LOD tiles overlap', () => {
    const coarse = makeGridMesh({
      sizeX: 100,
      sizeZ: 100,
      segmentsX: 2,
      segmentsZ: 2,
      height: () => 10,
    })
    const fine = makeGridMesh({
      minX: 40,
      minZ: 40,
      sizeX: 20,
      sizeZ: 20,
      segmentsX: 8,
      segmentsZ: 8,
      height: () => 5,
    })
    const root = new THREE.Group()
    root.add(coarse)
    root.add(fine)
    root.updateMatrixWorld(true)
    const grid = buildTerrainHeightGrid(root, { cellSize: 5, maxGridSize: 256 })
    expect(grid).not.toBeNull()
    expect(grid!.sampleHeight(50, 50)).toBeCloseTo(5, 1)
    expect(grid!.sampleHeight(10, 10)).toBeCloseTo(10, 1)
  })

  it('returns null outside the covered area', () => {
    const mesh = makeGridMesh({
      sizeX: 50,
      sizeZ: 50,
      segmentsX: 10,
      segmentsZ: 10,
      height: () => 0,
    })
    const grid = buildTerrainHeightGrid(mesh, { cellSize: 5, maxGridSize: 256 })
    expect(grid).not.toBeNull()
    expect(grid!.contains(80, 80)).toBe(false)
  })

  it('ignores pick proxies, editor-only, hidden and helper meshes', () => {
    const root = new THREE.Group()
    const real = makeGridMesh({
      sizeX: 100,
      sizeZ: 100,
      segmentsX: 10,
      segmentsZ: 10,
      height: () => 3,
    })
    real.name = 'TerrainMesh'
    root.add(real)

    // The editor's instanced-rendering path adds an invisible box pick proxy;
    // it must never be rasterized into the height field.
    const pickProxy = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshBasicMaterial())
    pickProxy.userData.instancedPickProxy = true
    root.add(pickProxy)

    const editorOnly = makeGridMesh({ sizeX: 100, sizeZ: 100, segmentsX: 2, segmentsZ: 2, height: () => 999 })
    editorOnly.userData.editorOnly = true
    root.add(editorOnly)

    const hidden = makeGridMesh({ sizeX: 100, sizeZ: 100, segmentsX: 2, segmentsZ: 2, height: () => 500 })
    hidden.visible = false
    root.add(hidden)

    const outline = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), new THREE.MeshBasicMaterial())
    outline.name = 'InstancedOutline'
    root.add(outline)

    root.updateMatrixWorld(true)
    const sources = collectTerrainMeshSources(root)
    expect(sources).toHaveLength(1)
    expect(sources[0]!.mesh).toBe(real)

    const grid = buildTerrainHeightGrid(root, { cellSize: 5, maxGridSize: 256 })
    expect(grid).not.toBeNull()
    expect(grid!.sampleHeight(50, 50)).toBeCloseTo(3, 1)
  })

  it('respects explicit source matrices for world-space sampling', () => {
    const mesh = makeGridMesh({ sizeX: 10, sizeZ: 10, segmentsX: 2, segmentsZ: 2, height: () => 0 })
    const matrix = new THREE.Matrix4().makeScale(10, 1, 10).setPosition(100, 5, -50)
    const grid = buildTerrainHeightGridFromSources([{ mesh, matrix }], { cellSize: 5, maxGridSize: 256 })
    expect(grid).not.toBeNull()
    expect(grid!.minX).toBeCloseTo(100, 3)
    expect(grid!.sampleHeight(150, 0)).toBeCloseTo(5, 2)
  })
})

describe('road tracing', () => {
  const baseOptions = {
    startX: 200,
    startZ: 200,
    headingRad: 0,
    stepLength: 8,
    feelDistance: 24,
    feelAngleRad: (32 * Math.PI) / 180,
    maxSlope: 0.55,
    maxTurnRad: (4 * Math.PI) / 180,
    maxLength: null,
    margin: 12,
  }

  it('walks straight across a flat terrain and stops at the boundary', () => {
    const mesh = makeGridMesh({
      sizeX: 400,
      sizeZ: 400,
      segmentsX: 40,
      segmentsZ: 40,
      height: () => 0,
    })
    const grid = buildTerrainHeightGrid(mesh, { cellSize: 4, maxGridSize: 512 })!
    const result = traceRoadPath(grid, baseOptions)
    expect(result.nodes.length).toBeGreaterThan(5)
    expect(result.complete).toBe(true)
    expect(result.failureReason).toBe('reached-terrain-boundary')
    for (let i = 1; i < result.nodes.length; i += 1) {
      const node = result.nodes[i]!
      expect(node.x).toBeGreaterThanOrEqual(grid.minX)
      expect(node.x).toBeLessThanOrEqual(grid.maxX)
    }
    for (let i = 2; i < result.nodes.length; i += 1) {
      const previous = result.nodes[i - 1]!
      const current = result.nodes[i]!
      const turn = Math.abs(current.heading - previous.heading)
      expect(turn).toBeLessThanOrEqual(baseOptions.maxTurnRad * 1.01 + 1e-6)
    }
  })

  it('stops when every direction exceeds the slope limit', () => {
    const mesh = makeGridMesh({
      sizeX: 400,
      sizeZ: 400,
      segmentsX: 40,
      segmentsZ: 40,
      height: (x) => x * 1.5,
    })
    const grid = buildTerrainHeightGrid(mesh, { cellSize: 4, maxGridSize: 512 })!
    const result = traceRoadPath(grid, baseOptions)
    expect(result.complete).toBe(false)
    expect(result.failureReason).toBe('blocked')
    expect(result.nodes.length).toBe(1)
  })

  it('is deterministic for identical inputs', () => {
    const mesh = makeGridMesh({
      sizeX: 300,
      sizeZ: 300,
      segmentsX: 30,
      segmentsZ: 30,
      height: (x, z) => Math.sin(x * 0.02) * 4 + Math.cos(z * 0.03) * 2,
    })
    const grid = buildTerrainHeightGrid(mesh, { cellSize: 4, maxGridSize: 512 })!
    const first = traceRoadPath(grid, baseOptions)
    const second = traceRoadPath(grid, baseOptions)
    expect(second.nodes.map((node) => [node.x, node.z, node.y])).toEqual(
      first.nodes.map((node) => [node.x, node.z, node.y]),
    )
  })
})

describe('road waypoint guide mode', () => {
  const baseOptions = {
    startX: 200,
    startZ: 200,
    headingRad: 0,
    stepLength: 8,
    feelDistance: 24,
    feelAngleRad: (32 * Math.PI) / 180,
    maxSlope: 0.55,
    maxTurnRad: (4 * Math.PI) / 180,
    maxLength: null,
    margin: 12,
  }

  function flatGrid(size = 400): ReturnType<typeof buildTerrainHeightGrid> {
    const mesh = makeGridMesh({
      sizeX: size,
      sizeZ: size,
      segmentsX: size / 10,
      segmentsZ: size / 10,
      height: () => 0,
    })
    return buildTerrainHeightGrid(mesh, { cellSize: 4, maxGridSize: 512 })
  }

  it('starts at the first waypoint and ends at the last one in order', () => {
    const grid = flatGrid()!
    const waypoints = [
      { x: 100, z: 100 },
      { x: 110, z: 100 },
      { x: 110, z: 200 },
      { x: 300, z: 200 },
    ]
    const result = traceRoadPath(grid, { ...baseOptions, waypoints, waypointTolerance: 12 })
    expect(result.nodes.length).toBeGreaterThan(2)
    expect(result.complete).toBe(true)
    expect(result.failureReason).toBe('reached-waypoint-end')

    const first = result.nodes[0]!
    expect(first.x).toBeCloseTo(100, 1)
    expect(first.z).toBeCloseTo(100, 1)
    // Initial heading = first -> second waypoint (+X here).
    expect(first.heading).toBeCloseTo(0, 3)

    for (const waypoint of waypoints) {
      const closest = Math.min(
        ...result.nodes.map((node) => Math.hypot(node.x - waypoint.x, node.z - waypoint.z)),
      )
      expect(closest).toBeLessThanOrEqual(12.5)
    }

    const last = result.nodes[result.nodes.length - 1]!
    expect(Math.hypot(last.x - 300, last.z - 200)).toBeLessThanOrEqual(12.5)
  })

  it('aims the initial heading at the second waypoint', () => {
    const grid = flatGrid()!
    const result = traceRoadPath(grid, {
      ...baseOptions,
      waypoints: [{ x: 100, z: 100 }, { x: 100, z: 300 }],
      waypointTolerance: 12,
    })
    const first = result.nodes[0]!
    expect(first.heading).toBeCloseTo(Math.PI / 2, 3)
    const second = result.nodes[1]!
    expect(second.z).toBeGreaterThan(first.z)
  })

  it('is deterministic for identical waypoint inputs', () => {
    const grid = flatGrid()!
    const options = {
      ...baseOptions,
      waypoints: [{ x: 60, z: 60 }, { x: 120, z: 320 }, { x: 340, z: 120 }],
      waypointTolerance: 12,
    }
    const first = traceRoadPath(grid, options)
    const second = traceRoadPath(grid, options)
    expect(second.nodes.map((node) => [node.x, node.z, node.y])).toEqual(
      first.nodes.map((node) => [node.x, node.z, node.y]),
    )
  })

  it('stops at the terrain boundary when a waypoint lies outside the grid', () => {
    const grid = flatGrid()!
    const result = traceRoadPath(grid, {
      ...baseOptions,
      waypoints: [{ x: 50, z: 50 }, { x: 1200, z: 1200 }],
      waypointTolerance: 12,
    })
    expect(result.complete).toBe(true)
    expect(result.failureReason).toBe('reached-terrain-boundary')
    const last = result.nodes[result.nodes.length - 1]!
    expect(last.x).toBeLessThanOrEqual(grid!.maxX)
    expect(last.z).toBeLessThanOrEqual(grid!.maxZ)
  })

  it('keeps the partial path and reports blocked when a slope wall is unreachable', () => {
    const mesh = makeGridMesh({
      sizeX: 400,
      sizeZ: 400,
      segmentsX: 40,
      segmentsZ: 40,
      height: (x) => x * 1.5,
    })
    const grid = buildTerrainHeightGrid(mesh, { cellSize: 4, maxGridSize: 512 })!
    const result = traceRoadPath(grid, {
      ...baseOptions,
      waypoints: [{ x: 100, z: 100 }, { x: 300, z: 100 }],
      waypointTolerance: 12,
    })
    expect(result.complete).toBe(false)
    expect(result.failureReason).toBe('blocked')
    expect(result.nodes.length).toBeGreaterThanOrEqual(1)
  })

  it('still honours the maxLength safety cap in guide mode', () => {
    const grid = flatGrid()!
    const result = traceRoadPath(grid, {
      ...baseOptions,
      waypoints: [{ x: 40, z: 40 }, { x: 360, z: 360 }],
      waypointTolerance: 12,
      maxLength: 50,
    })
    expect(result.complete).toBe(true)
    expect(result.failureReason).toBe('reached-length-limit')
    expect(result.length).toBeLessThanOrEqual(50 + baseOptions.stepLength)
  })

  it('behaves exactly like the legacy trace without an effective waypoint list', () => {
    const mesh = makeGridMesh({
      sizeX: 300,
      sizeZ: 300,
      segmentsX: 30,
      segmentsZ: 30,
      height: (x, z) => Math.sin(x * 0.02) * 4 + Math.cos(z * 0.03) * 2,
    })
    const grid = buildTerrainHeightGrid(mesh, { cellSize: 4, maxGridSize: 512 })!
    const legacy = traceRoadPath(grid, baseOptions)
    const empty = traceRoadPath(grid, { ...baseOptions, waypoints: [], waypointTolerance: 12 })
    const single = traceRoadPath(grid, {
      ...baseOptions,
      waypoints: [{ x: 10, z: 10 }],
      waypointTolerance: 12,
    })
    const serialize = (result: typeof legacy) =>
      result.nodes.map((node) => [node.x, node.z, node.y, node.heading])
    expect(serialize(empty)).toEqual(serialize(legacy))
    expect(serialize(single)).toEqual(serialize(legacy))
    expect(empty.failureReason).toBe(legacy.failureReason)
    expect(single.failureReason).toBe(legacy.failureReason)
  })
})

describe('road waypoint props', () => {
  it('sanitizes waypoint arrays (non-finite, duplicates, cap)', () => {
    const cleaned = clampRoadWaypoints([
      { x: 0, z: 0 },
      { x: 0.1, z: 0.1 },
      { x: 5, z: 5 },
      { x: Number.NaN, z: 1 },
      { x: 7, z: Number.POSITIVE_INFINITY },
      { x: '9', z: '9' },
    ])
    expect(cleaned).toEqual([
      { x: 0, z: 0 },
      { x: 5, z: 5 },
      { x: 9, z: 9 },
    ])
    expect(clampRoadWaypoints('nope')).toEqual([])

    const many = Array.from({ length: 1000 }, (_, index) => ({
      x: index * 2,
      z: 0,
    }))
    expect(clampRoadWaypoints(many)).toHaveLength(1000)
  })

  it('clamps waypoint fields through the component props', () => {
    const defaults = createDefaultProceduralLandscapeProps({ id: 'node-a' })
    expect(defaults.road.waypoints).toEqual([])
    expect(defaults.road.waypointTolerance).toBe(4)

    const clamped = clampProceduralLandscapeProps({
      road: {
        ...defaults.road,
        waypoints: [{ x: 1, z: 2 }, { x: 3, z: 4 }],
        waypointTolerance: 400,
      },
    }, 'node-a')
    expect(clamped.road.waypoints).toEqual([{ x: 1, z: 2 }, { x: 3, z: 4 }])
    expect(clamped.road.waypointTolerance).toBe(64)

    const lower = clampProceduralLandscapeProps({
      road: { ...defaults.road, waypointTolerance: 0 },
    }, 'node-a')
    expect(lower.road.waypointTolerance).toBe(1)
  })

  it('transforms node-local waypoints into world XZ (translate/rotate/scale)', () => {
    const translation = new THREE.Matrix4().makeTranslation(10, 0, 20)
    expect(transformRoadWaypointsToWorld(translation, [{ x: 1, z: 2 }])).toEqual([{ x: 11, z: 22 }])

    const rotation = new THREE.Matrix4().makeRotationY(Math.PI / 2)
    const rotated = transformRoadWaypointsToWorld(rotation, [{ x: 1, z: 0 }])[0]!
    expect(rotated.x).toBeCloseTo(0, 6)
    expect(rotated.z).toBeCloseTo(-1, 6)

    const scale = new THREE.Matrix4().makeScale(2, 1, 3)
    expect(transformRoadWaypointsToWorld(scale, [{ x: 1, z: 1 }])).toEqual([{ x: 2, z: 3 }])

    const combined = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(5, 0, 7)
    const combinedResult = transformRoadWaypointsToWorld(combined, [{ x: 1, z: 0 }])[0]!
    expect(combinedResult.x).toBeCloseTo(5, 6)
    expect(combinedResult.z).toBeCloseTo(6, 6)
  })

  it('returns every clamped waypoint including a single-point draft', () => {
    const defaults = createDefaultProceduralLandscapeProps({ id: 'node-a' })
    const twoPoints = clampProceduralLandscapeProps({
      road: { ...defaults.road, waypoints: [{ x: 1, z: 1 }, { x: 4, z: 6 }] },
    }, 'node-a')
    expect(activeRoadWaypoints(twoPoints)).toHaveLength(2)

    const onePoint = clampProceduralLandscapeProps({
      road: { ...defaults.road, waypoints: [{ x: 1, z: 1 }] },
    }, 'node-a')
    expect(activeRoadWaypoints(onePoint)).toHaveLength(1)

    const matrix = new THREE.Matrix4().makeTranslation(100, 0, 200)
    const world = transformRoadWaypointsToWorld(matrix, activeRoadWaypoints(twoPoints))
    expect(world).toEqual([{ x: 101, z: 201 }, { x: 104, z: 206 }])
  })

  it('keeps a single waypoint available for seeded loops', () => {
    expect(activeRoadWaypoints(createDefaultProceduralLandscapeProps({ id: 'node-a' }))).toHaveLength(0)

    const defaults = createDefaultProceduralLandscapeProps({ id: 'node-a' })
    const onePoint = clampProceduralLandscapeProps({
      road: { ...defaults.road, waypoints: [{ x: 12, z: -8 }] },
    }, 'node-a')
    expect(activeRoadWaypoints(onePoint)).toHaveLength(1)

    const twoPoints = clampProceduralLandscapeProps({
      road: { ...defaults.road, waypoints: [{ x: 12, z: -8 }, { x: 40, z: 22 }] },
    }, 'node-a')
    expect(activeRoadWaypoints(twoPoints)).toHaveLength(2)
  })
})

describe('noise and density field', () => {
  it('keeps value noise deterministic', () => {
    expect(fbm2(7, 1.25, 3.5, 3)).toBe(fbm2(7, 1.25, 3.5, 3))
    expect(fbm2(7, 1.25, 3.5, 3)).not.toBe(fbm2(8, 1.25, 3.5, 3))
  })

  it('classifies density monotonically', () => {
    expect(densityClassFromNoise(0.1, 1)).toBe(0)
    expect(densityClassFromNoise(0.5, 1)).toBe(1)
    expect(densityClassFromNoise(0.62, 1)).toBe(2)
    expect(densityClassFromNoise(0.95, 1)).toBe(3)
    expect(densityClassFromNoise(0.5, 0)).toBe(0)
  })

  it('builds identical density fields for the same seed', () => {
    const options = {
      minX: 0,
      minZ: 0,
      sizeX: 512,
      sizeZ: 512,
      seed: 1234,
      scale: 600,
      coverage: 1,
      resolution: 64,
    }
    const first = buildForestDensityField(options)
    const second = buildForestDensityField(options)
    expect(Array.from(second.data)).toEqual(Array.from(first.data))
    const different = buildForestDensityField({ ...options, seed: 998877 })
    expect(Array.from(different.data)).not.toEqual(Array.from(first.data))
  })
})

describe('chunk planning', () => {
  function createDeps(roadEnabled: boolean) {
    const mesh = makeGridMesh({
      sizeX: 512,
      sizeZ: 512,
      segmentsX: 64,
      segmentsZ: 64,
      height: () => 0,
    })
    const grid = buildTerrainHeightGrid(mesh, { cellSize: 4, maxGridSize: 512 })!
    const density = buildForestDensityField({
      minX: grid.minX,
      minZ: grid.minZ,
      sizeX: grid.maxX - grid.minX,
      sizeZ: grid.maxZ - grid.minZ,
      seed: 42,
      scale: 400,
      coverage: 1,
      resolution: 64,
    })
    const roadPath = roadEnabled
      ? [
          { x: 0, z: 256, y: 0, heading: 0, index: 0, lateral: 0, longitudinal: 0, turn: 0, headingDelta: 0 },
          { x: 512, z: 256, y: 0, heading: 0, index: 1, lateral: 0, longitudinal: 0, turn: 0, headingDelta: 0 },
        ]
      : []
    const roadField = roadEnabled
      ? buildRoadFieldData(roadPath, {
          minX: grid.minX,
          minZ: grid.minZ,
          sizeX: grid.maxX - grid.minX,
          sizeZ: grid.maxZ - grid.minZ,
          minY: 0,
          maxY: 0,
          maxInfluence: 64,
          maxResolution: 256,
        })
      : null
    return { grid, density, roadField }
  }

  it('produces deterministic tree chunk placements', () => {
    const deps = createDeps(true)
    const baseParams = {
      seed: 99,
      chunkSize: 64,
      densityMultiplier: 1,
      maxSlope: 0.2,
      roadClearance: 2,
      roadHalfWidth: 3.5,
      roadShoulderWidth: 2.5,
      minScale: 4,
      maxScale: 9,
      minHeight: null,
    }
    const coordinates: Array<[number, number]> = []
    for (let chunkX = 0; chunkX < 6; chunkX += 1) {
      for (let chunkZ = 0; chunkZ < 6; chunkZ += 1) {
        coordinates.push([chunkX, chunkZ])
      }
    }
    const first = coordinates.map(([chunkX, chunkZ]) => planTreeChunk({ ...baseParams, chunkX, chunkZ }, deps))
    const second = coordinates.map(([chunkX, chunkZ]) => planTreeChunk({ ...baseParams, chunkX, chunkZ }, deps))
    expect(second).toEqual(first)
    const totalTrees = first.reduce((sum, chunk) => sum + chunk.length, 0)
    expect(totalTrees).toBeGreaterThan(0)
  })

  it('keeps the density tier a stable prefix of the full candidate list', () => {
    const deps = createDeps(true)
    const placements = planTreeChunk(
      {
        seed: 7,
        chunkX: 1,
        chunkZ: 1,
        chunkSize: 64,
        densityMultiplier: 1,
        maxSlope: 0.2,
        roadClearance: 2,
        roadHalfWidth: 3.5,
        roadShoulderWidth: 2.5,
        minScale: 4,
        maxScale: 9,
        minHeight: null,
      },
      deps,
    )
    const low = takeDensityPrefix(placements, 0.4)
    const high = takeDensityPrefix(placements, 1)
    expect(high.length).toBe(placements.length)
    expect(low.length).toBeLessThanOrEqual(high.length)
    expect(low).toEqual(placements.slice(0, low.length))
    expect(takeDensityPrefix(placements, 0)).toEqual([])
  })

  it('places roadside grass inside the corridor and bushes near the road', () => {
    const deps = createDeps(true)
    const result = planRoadBucket(
      {
        seed: 5,
        bucketIndex: 0,
        fromX: 0,
        fromZ: 256,
        toX: 16,
        toZ: 256,
        halfWidth: 3.5,
        shoulderWidth: 2.5,
        corridorWidth: 20,
        grassDensity: 1,
        sinkNearRoad: 1.2,
        bushesEnabled: true,
        bushesDensity: 0.5,
        waterLevel: -1e5,
        flowerDensity: 1,
        tallGrassDensity: 1,
      },
      deps,
    )
    expect(result.grass.length).toBeGreaterThan(0)
    for (const placement of result.grass) {
      const distance = deps.roadField!.distanceAt(placement.x, placement.z)
      expect(distance).toBeGreaterThan(3.5)
      expect(distance).toBeLessThan(3.5 + 20 + 1)
    }
    // 灌木层 = 路缘灌木（≤ halfWidth+4）∪ 花草层（lab：横向 0.5..6m）。
    for (const bush of result.bushes) {
      const distance = deps.roadField!.distanceAt(bush.x, bush.z)
      expect(distance).toBeLessThanOrEqual(3.5 + 6 + 0.6)
    }
  })

  it('keeps camera grass chunks deterministic and off the asphalt', () => {
    const deps = createDeps(true)
    const params = {
      seed: 11,
      chunkX: 30,
      chunkZ: 30,
      chunkSize: 8,
      density: 1,
      maxSlope: 0.7,
      roadHalfWidth: 3.5,
      roadShoulderWidth: 2.5,
    }
    const first = planCameraGrassChunk(params, deps)
    const second = planCameraGrassChunk(params, deps)
    expect(second).toEqual(first)
    for (const placement of first) {
      const distance = deps.roadField!.distanceAt(placement.x, placement.z)
      expect(distance).toBeGreaterThan(3.5)
    }
  })
})

describe('road field encoding', () => {
  it('round-trips distances within the encoding step', () => {
    for (const distance of [0, 0.5, 3.2, 12.7, 47.9, 64]) {
      const decoded = decodeRoadDistance(encodeRoadDistance(distance, 64), 64)
      expect(Math.abs(decoded - distance)).toBeLessThanOrEqual(64 / 255 + 1e-6)
    }
  })

  it('builds a road field and texture for a straight path', () => {
    const path = [
      { x: 0, z: 50, y: 10, heading: 0, index: 0, lateral: 0, longitudinal: 0, turn: 0, headingDelta: 0 },
      { x: 100, z: 50, y: 12, heading: 0, index: 1, lateral: 0, longitudinal: 0, turn: 0, headingDelta: 0 },
    ]
    const field = buildRoadFieldData(path, {
      minX: 0,
      minZ: 0,
      sizeX: 100,
      sizeZ: 100,
      minY: 0,
      maxY: 20,
      maxInfluence: 48,
      maxResolution: 128,
    })
    expect(field).not.toBeNull()
    expect(field!.distanceAt(50, 50)).toBeLessThan(1)
    expect(field!.distanceAt(50, 90)).toBeGreaterThan(30)
    const height = field!.heightAt(50, 50)
    expect(height).not.toBeNull()
    expect(height!).toBeGreaterThan(10.5)
    const texture = createRoadFieldTexture(field!)
    expect(texture.image.width).toBe(field!.width)
    expect(texture.image.height).toBe(field!.height)
    texture.dispose()
  })
})

describe('exact road proximity placement (large-terrain regression)', () => {
  /**
   * 用户场景尺度回归：约 39km × 43km 的 GIS 地形 pack。
   *
   * 旧实现把所有「避让公路」的过滤交给覆盖整个 AABB、固定 1024 格的光栅距离场：
   * 格边长 ≈ 42m，远大于 8.5m 路宽与 ~11m 树木净空，路中心线上超过一半的抽样点
   * 被误报为「离路足够远」，树木/草丛因此长到沥青上（用户实测）。
   *
   * 放置过滤现改走精确点-线段距离索引（`roadProximity.ts`，lab `roadProfile`
   * 移植）。本测试同时锁定两条性质：
   *  1) 放置结果对**精确**中心线满足各自净空（树木 ≥ 半宽+路肩+净空，草丛 ≥ 半宽+边距）；
   *  2) 光栅场在该尺度下不再可用于放置（记录缺陷来源，防止回退）。
   */
  const HALF_WIDTH = 4.25
  const SHOULDER = 2.5
  const ROAD_CLEARANCE = 4
  const TREE_CLEARANCE = HALF_WIDTH + SHOULDER + ROAD_CLEARANCE
  const CORRIDOR_WIDTH = 40

  function exactDistanceToNodes(
    nodes: ReadonlyArray<{ x: number; z: number }>,
    x: number,
    z: number,
  ): number {
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

  function makeLargeTerrain(): {
    grid: NonNullable<ReturnType<typeof buildTerrainHeightGrid>>
    density: ReturnType<typeof buildForestDensityField>
    roadNodes: ReturnType<typeof traceRoadPath>['nodes']
  } {
    const mesh = makeGridMesh({
      minX: -20000,
      minZ: -22000,
      sizeX: 40000,
      sizeZ: 43000,
      segmentsX: 100,
      segmentsZ: 108,
      height: (x, z) => 120 + Math.sin(x / 900) * 40 + Math.cos(z / 1100) * 30,
    })
    const grid = buildTerrainHeightGrid(mesh, { cellSize: 64, maxGridSize: 512 })!
    const density = buildForestDensityField({
      minX: grid.minX,
      minZ: grid.minZ,
      sizeX: grid.maxX - grid.minX,
      sizeZ: grid.maxZ - grid.minZ,
      seed: 2026,
      scale: 4000,
      coverage: 1,
      resolution: 96,
    })
    const waypoints = [
      { x: -12000, z: 9000 },
      { x: -4000, z: 2000 },
      { x: 5000, z: -6000 },
      { x: 13000, z: -13000 },
    ]
    const road = traceRoadPath(grid, {
      startX: waypoints[0]!.x,
      startZ: waypoints[0]!.z,
      headingRad: 0,
      waypoints,
      waypointTolerance: 24,
      stepLength: 16,
      feelDistance: 48,
      feelAngleRad: (64 * Math.PI) / 180,
      maxSlope: 0.6,
      maxTurnRad: (8 * Math.PI) / 180,
      maxLength: null,
      margin: Math.max(grid.cellSize * 2, HALF_WIDTH + SHOULDER + 2),
    })
    return { grid, density, roadNodes: road.nodes }
  }

  const INFLUENCE = Math.max(48, 20 + 8, HALF_WIDTH + SHOULDER + CORRIDOR_WIDTH + 8)

  interface LargeTerrainContext {
    grid: NonNullable<ReturnType<typeof buildTerrainHeightGrid>>
    roadNodes: ReturnType<typeof traceRoadPath>['nodes']
    index: NonNullable<ReturnType<typeof buildRoadProximityIndex>>
    deps: {
      grid: NonNullable<ReturnType<typeof buildTerrainHeightGrid>>
      density: ReturnType<typeof buildForestDensityField>
      roadField: NonNullable<ReturnType<typeof buildRoadProximityIndex>>
    }
    exactDistance: (x: number, z: number) => number
  }

  let cachedContext: LargeTerrainContext | null = null

  /** 40km 场景构建较重：同文件内各用例共享一次（vitest 顺序执行）。 */
  function getContext(): LargeTerrainContext {
    if (!cachedContext) {
      const { grid, density, roadNodes } = makeLargeTerrain()
      const index = buildRoadProximityIndex(roadNodes, { maxDistance: INFLUENCE })
      expect(index).not.toBeNull()
      cachedContext = {
        grid,
        roadNodes,
        index: index!,
        deps: { grid, density, roadField: index! },
        exactDistance: (x, z) => exactDistanceToNodes(roadNodes, x, z),
      }
    }
    return cachedContext
  }

  /**
   * 确定性抽样（每 8 个查一个）：逐点全查在 40km 场景上是 O(实例数 × 段数)，
   * 会把用例拖到分钟级；而系统性回归（例如把过滤接回光栅场）会在抽样中大量出现。
   */
  function isSampled(counter: number): boolean {
    return counter % 8 === 0
  }

  it('reports exact centerline distances while the 1024-texel raster misreports them', () => {
    const { grid, roadNodes, index } = getContext()
    expect(roadNodes.length).toBeGreaterThan(50)
    expect(verifyRoadProximityIndex(index, roadNodes)).toBe(true)

    // 光栅场（1024 上限）：40km 地形上格边长 ≈ 42m。记录缺陷来源——
    // 抽样节点里超过 5% 被误报为「离路 ≥ 树木净空」。
    const raster = buildRoadFieldData(roadNodes, {
      minX: grid.minX,
      minZ: grid.minZ,
      sizeX: grid.maxX - grid.minX,
      sizeZ: grid.maxZ - grid.minZ,
      minY: grid.minY,
      maxY: grid.maxY,
      maxInfluence: INFLUENCE,
      maxResolution: 1024,
    })
    expect(raster).not.toBeNull()
    const rasterSamples = roadNodes.filter((_, sampleIndex) => sampleIndex % 16 === 0)
    expect(rasterSamples.length).toBeGreaterThan(20)
    const falseAccepts = rasterSamples.filter(
      (node) => raster!.distanceAt(node.x, node.z) >= TREE_CLEARANCE,
    ).length
    expect(falseAccepts / rasterSamples.length).toBeGreaterThan(0.05)

    // 精确索引在中心线上恒为 0（放置净空的判据）。
    for (const node of rasterSamples) {
      expect(index.distanceAt(node.x, node.z)).toBeLessThanOrEqual(1e-6)
    }
  }, 10_000)

  it('keeps tree chunks clear of the road', () => {
    const { roadNodes, deps, exactDistance } = getContext()

    // ---- 分块树木：净空 = 半宽 + 路肩 + forest.roadClearance ----
    const chunkSize = 192
    const chunkKeys = new Set<string>()
    // 节点按 3 抽样（48m 间距）+ 邻块扩展 192m：覆盖完整，扫描量 1/3。
    for (let nodeIndex = 0; nodeIndex < roadNodes.length; nodeIndex += 3) {
      const node = roadNodes[nodeIndex]!
      const chunkX = Math.floor(node.x / chunkSize)
      const chunkZ = Math.floor(node.z / chunkSize)
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
          chunkKeys.add(`${chunkX + offsetX}:${chunkZ + offsetZ}`)
        }
      }
    }
    let treeCount = 0
    let treeChecked = 0
    for (const key of chunkKeys) {
      const [chunkX, chunkZ] = key.split(':')
      const placements = planTreeChunk(
        {
          seed: 99,
          chunkX: Number(chunkX),
          chunkZ: Number(chunkZ),
          chunkSize,
          densityMultiplier: 1,
          maxSlope: 0.6,
          roadClearance: ROAD_CLEARANCE,
          roadHalfWidth: HALF_WIDTH,
          roadShoulderWidth: SHOULDER,
          minScale: 10,
          maxScale: 24,
          minHeight: null,
        },
        deps,
      )
      for (const placement of placements) {
        treeCount += 1
        if (!isSampled(treeCount)) {
          continue
        }
        treeChecked += 1
        expect(exactDistance(placement.x, placement.z)).toBeGreaterThanOrEqual(TREE_CLEARANCE - 1e-6)
      }
    }
    expect(treeCount).toBeGreaterThan(0)
    expect(treeChecked).toBeGreaterThan(0)
  }, 20_000)

  it('keeps camera grass clear of the road', () => {
    const { roadNodes, deps, exactDistance } = getContext()

    // ---- 相机草：距中心线 ≥ 半宽 + 0.3 ----
    const grassCellSize = 8
    const grassCellKeys = new Set<string>()
    // 每 2 个节点（32m）+ 邻格扩展 24m：沿路覆盖连续。
    for (let nodeIndex = 0; nodeIndex < roadNodes.length; nodeIndex += 2) {
      const node = roadNodes[nodeIndex]!
      const cellX = Math.floor(node.x / grassCellSize)
      const cellZ = Math.floor(node.z / grassCellSize)
      for (let offsetX = -3; offsetX <= 3; offsetX += 1) {
        for (let offsetZ = -3; offsetZ <= 3; offsetZ += 1) {
          grassCellKeys.add(`${cellX + offsetX}:${cellZ + offsetZ}`)
        }
      }
    }
    let cameraGrassCount = 0
    let cameraGrassChecked = 0
    for (const key of grassCellKeys) {
      const [cellX, cellZ] = key.split(':')
      const placements = planCameraGrassChunk(
        {
          seed: 11,
          chunkX: Number(cellX),
          chunkZ: Number(cellZ),
          chunkSize: grassCellSize,
          density: 1,
          maxSlope: 0.7,
          roadHalfWidth: HALF_WIDTH,
          roadShoulderWidth: SHOULDER,
        },
        deps,
      )
      for (const placement of placements) {
        cameraGrassCount += 1
        if (!isSampled(cameraGrassCount)) {
          continue
        }
        cameraGrassChecked += 1
        expect(exactDistance(placement.x, placement.z)).toBeGreaterThanOrEqual(HALF_WIDTH + 0.3 - 1e-6)
      }
    }
    expect(cameraGrassCount).toBeGreaterThan(0)
    expect(cameraGrassChecked).toBeGreaterThan(0)
  }, 20_000)

  it('keeps the roadside corridor band clear of the road', () => {
    const { roadNodes, deps, exactDistance } = getContext()

    // ---- 路边走廊草/灌木：位于 [半宽 + 0.3, 半宽 + 走廊宽] ----
    // 下限来自花草层（lab：lateralStart 0.5、容许 0.2 内差），走廊草带自身是 0.35。
    let corridorGrass = 0
    let corridorBushes = 0
    let corridorGrassChecked = 0
    let corridorBushesChecked = 0
    // 每 8 段（128m）取一个走廊桶：桶内规则与里程无关，沿路均匀覆盖即可。
    for (let i = 0; i + 1 < roadNodes.length; i += 8) {
      const from = roadNodes[i]!
      const to = roadNodes[i + 1]!
      const result = planRoadBucket(
        {
          seed: 5,
          bucketIndex: i,
          fromX: from.x,
          fromZ: from.z,
          toX: to.x,
          toZ: to.z,
          halfWidth: HALF_WIDTH,
          shoulderWidth: SHOULDER,
          corridorWidth: CORRIDOR_WIDTH,
          grassDensity: 1,
          sinkNearRoad: 1.2,
          bushesEnabled: true,
          bushesDensity: 0.6,
          waterLevel: -1e5,
          flowerDensity: 1,
          tallGrassDensity: 1,
        },
        deps,
      )
      for (const placement of result.grass) {
        corridorGrass += 1
        if (!isSampled(corridorGrass)) {
          continue
        }
        corridorGrassChecked += 1
        const distance = exactDistance(placement.x, placement.z)
        expect(distance).toBeGreaterThanOrEqual(HALF_WIDTH + 0.3 - 1e-6)
        expect(distance).toBeLessThanOrEqual(HALF_WIDTH + CORRIDOR_WIDTH + 1e-6)
      }
      for (const placement of result.bushes) {
        corridorBushes += 1
        corridorBushesChecked += 1
        const distance = exactDistance(placement.x, placement.z)
        expect(distance).toBeGreaterThanOrEqual(HALF_WIDTH + 0.3 - 1e-6)
        expect(distance).toBeLessThanOrEqual(HALF_WIDTH + CORRIDOR_WIDTH + 1e-6)
      }
    }
    expect(corridorGrass).toBeGreaterThan(0)
    expect(corridorBushes).toBeGreaterThan(0)
    expect(corridorGrassChecked).toBeGreaterThan(0)
    expect(corridorBushesChecked).toBeGreaterThan(0)
  }, 30_000)

  it('keeps far forest imposters clear of the road', () => {
    const { roadNodes, deps, exactDistance } = getContext()

    // ---- 远景林 imposter：净空与近景树木一致 ----
    const middle = roadNodes[Math.floor(roadNodes.length / 2)]!
    const farForest = planFarForestRings(
      {
        seed: 1234,
        centerX: middle.x,
        centerZ: middle.z,
        innerRadius: 400,
        outerRadius: 2400,
        budget: 6000,
        maxSlope: 0.6,
        roadClearance: TREE_CLEARANCE,
        waterLevel: -1e5,
        minScale: 10,
        maxScale: 24,
        densityMultiplier: 1,
      },
      deps,
    )
    expect(farForest.placements.length).toBeGreaterThan(0)
    for (const placement of farForest.placements) {
      expect(exactDistance(placement.x, placement.z)).toBeGreaterThanOrEqual(TREE_CLEARANCE - 1e-6)
    }
  }, 20_000)
})

describe('official surface parity (slowroads.io)', () => {
  it('no longer exposes the custom heather parameters (official formula instead)', () => {
    const props = createDefaultProceduralLandscapeProps({ id: 'terrain' })
    expect('heatherCoverage' in props.surface).toBe(false)
    expect('heatherStrength' in props.surface).toBe(false)
    expect('heatherStartRatio' in props.surface).toBe(false)
    expect('heatherTransitionRatio' in props.surface).toBe(false)
  })

  it('exposes the official radiance/shadowFactor uniforms with matching defaults', () => {
    const uniforms = createProceduralLandscapeSurfaceUniforms()
    expect(uniforms.uPlRadiance.value).toBe(2)
    expect(uniforms.uPlShadowFactor.value).toBe(1)
  })

  it('injects the official Lambert surface stack (heather formula, radiance composition, ambient shadow)', () => {
    const original = new THREE.MeshStandardMaterial()
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), original)
    const uniforms = createProceduralLandscapeSurfaceUniforms()
    const patch = applyProceduralLandscapeSurfaceInjection([mesh], uniforms)
    expect(patch.hasInjection).toBe(true)

    // 官方材质族：Lambert（无镜面）。
    const material = mesh.material as unknown as THREE.MeshLambertMaterial
    expect((material as unknown as { isMeshLambertMaterial?: boolean }).isMeshLambertMaterial).toBe(true)

    const parameters = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.lambert.vertexShader,
      fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
    } as unknown as Parameters<typeof material.onBeforeCompile>[0]
    material.onBeforeCompile(parameters, { capabilities: { maxTextures: 32 } } as never)

    // 官方 heather 分布公式（与官方地形顶点着色器一致）。
    expect(parameters.fragmentShader).toContain('vFade1 * 350.0')
    expect(parameters.fragmentShader).toContain('plScreen(vFade1, vFade0)')
    // 官方自发光与合成补丁。
    expect(parameters.fragmentShader).toContain('totalEmissiveRadiance = plSeasonalColor * uPlRadiance;')
    expect(parameters.fragmentShader).toContain('reflectedLight.directDiffuse * totalEmissiveRadiance')
    // 官方环境光树影调制。
    expect(parameters.fragmentShader).toContain('plAmbientShadow')
    expect(parameters.fragmentShader).toContain('reflectedLight.indirectDiffuse *= plAmbientShadow;')
    expect(parameters.uniforms.uPlRadiance).toBeTruthy()
    expect(parameters.uniforms.uPlShadowFactor).toBeTruthy()

    patch.restore()
    expect(mesh.material).toBe(original)
  })
})

describe('roadside walls + road markings (official equivalent rules)', () => {
  const style = ROAD_STYLE_PROFILES[DEFAULT_ROAD_STYLE]

  /** 造一条笔直道路 + 缓坡地形的采样器（等价 lab 的 heightfield/roadProfile 组合）。 */
  function makeWallSampling(roadWidth: number): {
    sampling: WallTerrainSampling
    nodes: Array<{ index: number; headingDelta: number }>
  } {
    const length = 600
    const terrainAt = (x: number, z: number): number => 20 + Math.sin(z / 40) * 8 + x * 0.02
    const roadY = (along: number): number => terrainAt(0, along)
    const nodes = Array.from({ length: Math.floor(length / 8) + 1 }, (_, index) => ({
      index,
      headingDelta: 0.01,
    }))
    const sampling: WallTerrainSampling = {
      length,
      halfWidth: roadWidth * 0.5,
      waterLevel: 0,
      terrainHeightAt: terrainAt,
      surfaceHeightAt: (x, z) => terrainAt(x, z),
      sampleRoad: (along) => ({ x: 0, z: along, y: roadY(along), heading: 0 }),
      shadowAt: () => 0,
    }
    return { sampling, nodes }
  }

  it('places walls at the official distances and honours segment length rules', () => {
    const { sampling, nodes } = makeWallSampling(7)
    const segments = computeWallSegments(sampling, nodes as never, {
      seed: 7,
      roadWidth: 7,
      density: 1,
      detail: 3,
      style,
    })
    expect(segments.length).toBeGreaterThan(0)
    for (const segment of segments) {
      const nodes = (segment.endAlong - segment.startAlong) / WALL_NODE_SPACING
      const minNodes = segment.type === 'barrier' || segment.type === 'fence'
        ? WALL_SEGMENT_RULES.minRunNodes
        : 1
      expect(nodes).toBeLessThanOrEqual(WALL_SEGMENT_RULES.maxRunNodes + 1e-6)
      expect(nodes).toBeGreaterThanOrEqual(minNodes - 1e-6)
      const expected = segment.type === 'drystone'
        ? 7 + 2
        : sampling.halfWidth + (segment.type === 'seaWall' ? 0.8 : 0.4)
      expect(Math.abs(segment.distance)).toBeCloseTo(expected, 6)
      expect(segment.points.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('is deterministic for the same seed and reacts to density', () => {
    const { sampling, nodes } = makeWallSampling(7)
    const settings = { seed: 42, roadWidth: 7, density: 1, detail: 3, style }
    const first = computeWallSegments(sampling, nodes as never, settings)
    const second = computeWallSegments(sampling, nodes as never, settings)
    expect(first.map((s) => [s.type, s.side, s.startAlong, s.endAlong]))
      .toEqual(second.map((s) => [s.type, s.side, s.startAlong, s.endAlong]))
    const sparse = computeWallSegments(sampling, nodes as never, { ...settings, density: 0.2 })
    expect(sparse.length).toBeLessThanOrEqual(first.length)
  })

  it('marks solid lines only after enough look-ahead and keeps the tail dashed', () => {
    const nodes = Array.from({ length: 80 }, (_, index) => ({
      x: index * 8,
      z: Math.sin(index / 6) * 24,
      y: 0,
      heading: Math.cos(index / 6) * 0.3,
      index,
      lateral: Math.sin(index / 5) * 1.4,
      longitudinal: Math.cos(index / 4) * 0.4,
      turn: Math.sin(index / 6) * 0.3,
      headingDelta: Math.cos(index / 6) * 0.06,
    }))
    const weights = computeRoadMarkings(nodes as never, {
      style,
      nodeSpacing: 8,
      shadowAt: () => 0.1,
      edgeOffset: 3.5,
      waterLevel: 0,
    })
    expect(weights).toHaveLength(nodes.length)
    expect(weights.every((w) => typeof w.solid === 'boolean')).toBe(true)
    // 官方没有足够前瞻时不判定：尾部 markingsMargin-1 个节点不允许实线。
    const tail = weights.slice(-(style.markingsMargin - 1))
    expect(tail.every((w) => !w.solidLeft && !w.solidRight)).toBe(true)
  })
})

describe('asset references', () => {
  it('no longer collects procedural landscape asset slots (assets come from the online bundle)', () => {
    const collected: Array<{ assetId: string | null | undefined; path: string }> = []
    visitExplicitComponentAssetReferences(
      PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
      {
        // 旧文档里可能残留的 assets 字段必须被忽略（不做旧场景兼容）。
        assets: { surfaceGrassAssetId: 'grass-surface' },
      },
      (reference) => collected.push(reference),
    )
    expect(collected).toHaveLength(0)
  })
})

describe('far forest rings', () => {
  function createFarForestDeps(height?: (x: number, z: number) => number) {
    const mesh = makeGridMesh({
      sizeX: 4000,
      sizeZ: 4000,
      segmentsX: 80,
      segmentsZ: 80,
      height: height ?? ((x, z) => 40 + Math.sin(x / 260) * 18 + Math.cos(z / 310) * 12),
    })
    const grid = buildTerrainHeightGrid(mesh, { cellSize: 20, maxGridSize: 512 })!
    const density = buildForestDensityField({
      minX: grid.minX,
      minZ: grid.minZ,
      sizeX: grid.maxX - grid.minX,
      sizeZ: grid.maxZ - grid.minZ,
      seed: 42,
      scale: 400,
      coverage: 1,
      resolution: 64,
    })
    return { grid, density, roadField: null }
  }

  function makeFarForestParams(overrides: Partial<FarForestPlanParams> = {}): FarForestPlanParams {
    return {
      seed: 1234,
      centerX: 2000,
      centerZ: 2000,
      innerRadius: 400,
      outerRadius: 1800,
      budget: 6000,
      maxSlope: 0.45,
      roadClearance: 6,
      // 水线远低于地形：不参与过滤（默认地形高度 ≈ 20..70m）。
      waterLevel: -1000,
      minScale: 5,
      maxScale: 12,
      densityMultiplier: 1,
      ...overrides,
    }
  }

  it('plans deterministically and never exceeds the budget', () => {
    const deps = createFarForestDeps()
    const params = makeFarForestParams({ budget: 500 })
    const first = planFarForestRings(params, deps)
    const second = planFarForestRings(params, deps)
    expect(first.placements.length).toBe(second.placements.length)
    expect(first.placements.map((p) => [p.x, p.z, p.scale, p.species]))
      .toEqual(second.placements.map((p) => [p.x, p.z, p.scale, p.species]))
    expect(first.placements.length).toBeGreaterThan(0)
    expect(first.placements.length).toBeLessThanOrEqual(params.budget)
  })

  it('keeps every instance inside the ring band and inside the terrain', () => {
    const deps = createFarForestDeps()
    const params = makeFarForestParams({ budget: 4000 })
    const result = planFarForestRings(params, deps)
    const span = params.outerRadius - params.innerRadius
    expect(result.placements.length).toBeGreaterThan(0)
    for (const placement of result.placements) {
      const distance = Math.hypot(placement.x - params.centerX, placement.z - params.centerZ)
      // 候选点由格内抖动生成，最远可能越过环带半个格（环3 格 64m）。
      expect(distance).toBeGreaterThanOrEqual(params.innerRadius - 32)
      expect(distance).toBeLessThanOrEqual(params.outerRadius + 32)
      expect(span).toBeGreaterThan(0)
      expect(deps.grid.contains(placement.x, placement.z)).toBe(true)
    }
  })

  it('prioritises the near ring when the budget is tight', () => {
    const deps = createFarForestDeps()
    const rings: FarForestRingSpec[] = [
      { startFraction: 0, endFraction: 0.5, cellSize: 12, densityScale: 1, scaleGainStart: 1, scaleGainEnd: 1, budgetShare: 0.5 },
      { startFraction: 0.5, endFraction: 1, cellSize: 12, densityScale: 1, scaleGainStart: 1, scaleGainEnd: 1, budgetShare: 0.5 },
    ]
    const budget = 120
    const result = planFarForestRings(makeFarForestParams({ budget, rings }), deps)
    expect(result.placements.length).toBeLessThanOrEqual(budget)
    expect(result.ringCounts[0]).toBeGreaterThan(0)
    expect(result.ringCounts[0]).toBeLessThanOrEqual(Math.floor(budget * 0.5))
    expect(result.ringCounts[1]).toBeLessThanOrEqual(Math.floor(budget * 0.5))
  })

  it('scales instances up with distance and yields nothing without budget', () => {
    const deps = createFarForestDeps()
    const params = makeFarForestParams({ budget: 6000, rings: FAR_FOREST_RINGS })
    const result = planFarForestRings(params, deps)
    expect(result.placements.length).toBeGreaterThan(0)
    const span = params.outerRadius - params.innerRadius
    const firstBand = result.placements.filter(
      (p) => Math.hypot(p.x - params.centerX, p.z - params.centerZ) <= params.innerRadius + span * 0.26,
    )
    const outerBand = result.placements.filter(
      (p) => Math.hypot(p.x - params.centerX, p.z - params.centerZ) >= params.innerRadius + span * 0.61,
    )
    expect(firstBand.length).toBeGreaterThan(0)
    expect(outerBand.length).toBeGreaterThan(0)
    const maxNear = Math.max(...firstBand.map((p) => p.scale))
    const maxFar = Math.max(...outerBand.map((p) => p.scale))
    expect(maxFar).toBeGreaterThan(maxNear * 1.5)

    const empty = planFarForestRings(makeFarForestParams({ budget: 0 }), deps)
    expect(empty.placements).toHaveLength(0)
    expect(empty.ringCounts.every((count) => count === 0)).toBe(true)
  })

  it('applies the slope / waterline / road-clearance filters', () => {
    const deps = createFarForestDeps((x, z) => 40 + Math.sin(x / 260) * 18 + Math.cos(z / 310) * 12)
    const params = makeFarForestParams({ budget: 2000 })
    const baseline = planFarForestRings(params, deps)
    expect(baseline.placements.length).toBeGreaterThan(0)

    // 水线抬到地形之上：全部被过滤。
    const flooded = planFarForestRings({ ...params, waterLevel: 500 }, deps)
    expect(flooded.placements).toHaveLength(0)

    // 起伏地形上 maxSlope = 0：全部被过滤（法线必然偏离竖直）。
    const steep = planFarForestRings({ ...params, maxSlope: 0 }, deps)
    expect(steep.placements).toHaveLength(0)

    // 道路净空大到盖住整个环带：全部被过滤。
    const road = planFarForestRings(
      { ...params, roadClearance: 10_000 },
      {
        ...deps,
        roadField: {
          width: 2,
          height: 2,
          memoryBytes: 0,
          distanceAt: () => 0,
        } as never,
      },
    )
    expect(road.placements).toHaveLength(0)
  })

  it('amortizes the lattice scan across steps without changing the result', () => {
    const deps = createFarForestDeps()
    const params = makeFarForestParams({ budget: 2000 })
    const sync = planFarForestRings(params, deps)
    const scan = createFarForestScan(params)
    let guard = 0
    while (!scan.complete && guard < 10_000) {
      stepFarForestScan(scan, deps, 500)
      guard += 1
    }
    expect(scan.complete).toBe(true)
    const stepped = collectFarForestPlacements(scan)
    expect(stepped.placements.map((p) => [p.x, p.z, p.scale, p.species]))
      .toEqual(sync.placements.map((p) => [p.x, p.z, p.scale, p.species]))
  })

  it('maps the near-field tree density onto the ring lattice', () => {
    // 平坦地形 + 恒定最高密度等级（sampleUnit = 1 → 等级 3）+ 足够预算：
    // 期望实例数 = 格网密度 × 环带面积 × 接受概率
    //   accept = densityScale × 近景基准(6070/等级) × 等级3 / 格网密度
    const mesh = makeGridMesh({
      sizeX: 4000,
      sizeZ: 4000,
      segmentsX: 20,
      segmentsZ: 20,
      height: () => 0,
    })
    const grid = buildTerrainHeightGrid(mesh, { cellSize: 20, maxGridSize: 512 })!
    const density = {
      width: 1,
      height: 1,
      data: new Uint8Array([255]),
      minX: grid.minX,
      minZ: grid.minZ,
      sizeX: grid.maxX - grid.minX,
      sizeZ: grid.maxZ - grid.minZ,
      sampleUnit: () => 1,
      memoryBytes: 1,
    }
    const innerRadius = 400
    const outerRadius = 1000
    const rings: FarForestRingSpec[] = [
      { startFraction: 0, endFraction: 1, cellSize: 16, densityScale: 0.12, scaleGainStart: 1, scaleGainEnd: 1, budgetShare: 1 },
    ]
    const result = planFarForestRings(
      makeFarForestParams({ innerRadius, outerRadius, budget: 100_000, rings }),
      { grid, density, roadField: null },
    )
    const areaKm2 = (Math.PI * (outerRadius * outerRadius - innerRadius * innerRadius)) / 1_000_000
    const latticeDensity = 1_000_000 / (16 * 16)
    const acceptance = (0.12 * FAR_FOREST_NEAR_DENSITY_PER_CLASS * 3) / latticeDensity
    const expected = areaKm2 * latticeDensity * Math.min(1, acceptance)
    expect(result.placements.length).toBeGreaterThan(expected * 0.8)
    expect(result.placements.length).toBeLessThan(expected * 1.2)
  })
})

describe('water flood stats', () => {
  function createSlopedGrid() {
    const mesh = makeGridMesh({
      sizeX: 1000,
      sizeZ: 1000,
      segmentsX: 40,
      segmentsZ: 40,
      // 高度 0..100m 的斜坡：最低点在 minX/minZ 角。
      height: (x, z) => (x + z) * 0.05,
    })
    return buildTerrainHeightGrid(mesh, { cellSize: 20, maxGridSize: 256 })!
  }

  it('reports ~0 flooded area when the waterline sits at the terrain minimum', () => {
    const grid = createSlopedGrid()
    const stats = computeWaterFloodStats(grid, grid.minY)
    expect(stats.sampledCells).toBeGreaterThan(0)
    expect(stats.floodedFraction).toBeLessThan(WATER_FLOOD_VISIBLE_FRACTION)
  })

  it('resolves a level that floods the requested area fraction', () => {
    const grid = createSlopedGrid()
    const level = resolveWaterLevelForFloodFraction(grid, 0.05)
    expect(level).not.toBeNull()
    const stats = computeWaterFloodStats(grid, level!)
    expect(stats.floodedFraction).toBeGreaterThan(0.03)
    expect(stats.floodedFraction).toBeLessThan(0.08)
    const higher = resolveWaterLevelForFloodFraction(grid, 0.5)!
    expect(higher).toBeGreaterThan(level!)
  })

  it('widens the waterline offset range for real terrains', () => {
    const wide = clampProceduralLandscapeProps({ water: { enabled: true, levelOffset: 250 } })
    expect(wide.water.levelOffset).toBe(250)
    expect(clampProceduralLandscapeProps({ water: { enabled: true, levelOffset: 5000 } }).water.levelOffset).toBe(1000)
    expect(clampProceduralLandscapeProps({ water: { enabled: true, levelOffset: -5000 } }).water.levelOffset).toBe(-1000)
    // 旧文档里的 ±50m 夹紧会把大地形的水线偏移吃掉（水位永远贴近最低点）。
    expect(clampProceduralLandscapeProps({ water: { enabled: true, levelOffset: 120 } }).water.levelOffset).toBe(120)
  })
})

describe('road cross-slope drape (贴合横坡)', () => {
  const makeNode = (x: number, z: number, y: number, heading = 0) => ({
    x,
    z,
    y,
    heading,
    index: 0,
    lateral: 0,
    longitudinal: 0,
    turn: 0,
    headingDelta: 0,
  })

  it('marks the procedural road surface for collision tooling', () => {
    const handle = createRoadBand({
      nodes: [makeNode(0, 0, 10), makeNode(10, 0, 10)],
      halfWidth: 3,
      density: null,
      textures: { base: new THREE.Texture(), overlay: null },
      season: 'summer',
      hostInverse: null,
      lift: 0.05,
    })
    expect(isProceduralLandscapeRoadSurface(handle.mesh)).toBe(true)
    handle.dispose()
  })

  it('samples edge heights with midline fallback and drop clamping', () => {
    const nodes = [makeNode(0, 0, 10), makeNode(4, 0, 11)]
    // heading=0 → left = 中心 − (0, hW)（z=−hW），right = z=+hW。
    const terrain = (x: number, z: number): number | null => (
      z === -3 ? 8.5 + 0.25 * x : z === 3 ? 11.5 + 0.25 * x : null
    )

    const heights = computeRoadEdgeHeights(nodes, terrain, 3, Number.POSITIVE_INFINITY)
    expect(heights[0]).toEqual({ left: 8.5, right: 11.5 })
    expect(heights[1]).toEqual({ left: 9.5, right: 12.5 })

    const clamped = computeRoadEdgeHeights(nodes, terrain, 3, 1)
    expect(clamped[0]!.right).toBe(11)
    expect(clamped[1]!.left).toBe(10)

    const missing = computeRoadEdgeHeights(nodes, () => null, 3, Number.POSITIVE_INFINITY)
    expect(missing[0]).toEqual({ left: 10, right: 10 })
    expect(missing[1]).toEqual({ left: 11, right: 11 })
  })

  it('drapes band vertices onto edge terrain and tilts cross-section normals', () => {
    const handle = createRoadBand({
      nodes: [makeNode(0, 0, 10), makeNode(10, 0, 10)],
      halfWidth: 3,
      density: null,
      textures: { base: new THREE.Texture(), overlay: null },
      season: 'summer',
      hostInverse: null,
      lift: 0.05,
      columnHeights: [
        [9, 11],
        [9, 11],
      ],
    })
    const position = handle.mesh.geometry.getAttribute('position')
    // side −1（left，z=−3）与 side +1（right，z=+3）。
    expect(position.getZ(0)).toBeCloseTo(-3)
    expect(position.getY(0)).toBeCloseTo(9.05)
    expect(position.getZ(1)).toBeCloseTo(3)
    expect(position.getY(1)).toBeCloseTo(11.05)
    const normal = handle.mesh.geometry.getAttribute('normal')
    // drop=2、heading=0 → normal = normalize(0, 2×3, −2)。
    const length = Math.sqrt(36 + 4)
    expect(normal.getX(0)).toBeCloseTo(0)
    expect(normal.getY(0)).toBeCloseTo(6 / length)
    expect(normal.getZ(0)).toBeCloseTo(-2 / length)
    handle.dispose()
  })

  it('keeps the flat horizontal band when columnHeights is omitted', () => {
    const handle = createRoadBand({
      nodes: [makeNode(0, 0, 10), makeNode(10, 0, 10)],
      halfWidth: 3,
      density: null,
      textures: { base: new THREE.Texture(), overlay: null },
      season: 'summer',
      hostInverse: null,
      lift: 0.05,
    })
    const position = handle.mesh.geometry.getAttribute('position')
    expect(position.getY(0)).toBeCloseTo(10.05)
    expect(position.getY(1)).toBeCloseTo(10.05)
    const normal = handle.mesh.geometry.getAttribute('normal')
    expect(normal.getX(0)).toBeCloseTo(0, 10)
    expect(normal.getY(0)).toBeCloseTo(1, 10)
    expect(normal.getZ(0)).toBeCloseTo(0, 10)
    handle.dispose()
  })

  it('follows a multi-column cross-section (crease inside the road)', () => {
    const columnHeights = [
      [10, 9.6, 9.2, 8.9, 8.75, 8.7, 8.8],
      [10, 9.6, 9.2, 8.9, 8.75, 8.7, 8.8],
    ]
    const handle = createRoadBand({
      nodes: [makeNode(0, 0, 10), makeNode(10, 0, 10)],
      halfWidth: 3,
      density: null,
      textures: { base: new THREE.Texture(), overlay: null },
      season: 'summer',
      hostInverse: null,
      lift: 0.05,
      columnHeights,
    })
    const position = handle.mesh.geometry.getAttribute('position')
    // 7 列 × 2 节点：第 0 节点列为 0..6，第 1 节点列为 7..13。
    expect(position.count).toBe(14)
    expect(position.getX(0)).toBeCloseTo(0)
    expect(position.getZ(0)).toBeCloseTo(-3)
    expect(position.getY(0)).toBeCloseTo(10.05)
    expect(position.getZ(3)).toBeCloseTo(0)
    expect(position.getY(3)).toBeCloseTo(8.9 + 0.05)
    expect(position.getZ(6)).toBeCloseTo(3)
    expect(position.getY(6)).toBeCloseTo(8.8 + 0.05)
    const uv = handle.mesh.geometry.getAttribute('uv')
    expect(uv.getX(0)).toBeCloseTo(0)
    expect(uv.getX(3)).toBeCloseTo(0.5)
    expect(uv.getX(6)).toBeCloseTo(1)
    // 折坡处法线应倾斜（非 (0,1,0)）。
    const normal = handle.mesh.geometry.getAttribute('normal')
    const tilt = Math.hypot(normal.getX(2), normal.getZ(2))
    expect(tilt).toBeGreaterThan(0.02)
    handle.dispose()
  })

  it('bakes draped heights into the road field (center, edge and outer platform)', () => {
    const field = buildRoadFieldData(
      [makeNode(0, 50, 10), makeNode(100, 50, 12)],
      {
        minX: 0,
        minZ: 0,
        sizeX: 100,
        sizeZ: 100,
        minY: 0,
        maxY: 20,
        maxInfluence: 48,
        maxResolution: 101,
        edgeHeights: [
          { left: 8, right: 13 },
          { left: 10, right: 15 },
        ],
        halfWidth: 5,
      },
    )
    expect(field).not.toBeNull()
    expect(field!.heightAt(50, 50)).toBeCloseTo(11, 5)
    expect(field!.heightAt(50, 45)).toBeCloseTo(9, 5)
    expect(field!.heightAt(50, 60)).toBeCloseTo(14, 5)
  })

  it('computes edge heights from a terrain sampler inside the field builder', () => {
    const field = buildRoadFieldData(
      [makeNode(0, 50, 10), makeNode(100, 50, 12)],
      {
        minX: 0,
        minZ: 0,
        sizeX: 100,
        sizeZ: 100,
        minY: 0,
        maxY: 20,
        maxInfluence: 48,
        maxResolution: 101,
        terrainHeightAt: (x, z) => 10 + (z - 50) * 0.4 + (x >= 100 ? 2 : 0),
        halfWidth: 5,
      },
    )
    expect(field).not.toBeNull()
    expect(field!.heightAt(50, 50)).toBeCloseTo(11, 5)
    expect(field!.heightAt(50, 45)).toBeCloseTo(9, 5)
    expect(field!.heightAt(50, 60)).toBeCloseTo(13, 5)
  })

  it('prefers mesh-sampled center heights when baking the draped profile', () => {
    const field = buildRoadFieldData(
      [makeNode(0, 50, 10), makeNode(100, 50, 12)],
      {
        minX: 0,
        minZ: 0,
        sizeX: 100,
        sizeZ: 100,
        minY: 0,
        maxY: 20,
        maxInfluence: 48,
        maxResolution: 101,
        edgeHeights: [
          { left: 8, right: 13 },
          { left: 10, right: 15 },
        ],
        centerHeights: [12, 14],
        halfWidth: 5,
      },
    )
    expect(field).not.toBeNull()
    // 中线高度来自 centerHeights（12/14 → 13），而不是追踪节点（10/12 → 11）。
    expect(field!.heightAt(50, 50)).toBeCloseTo(13, 5)
  })

  it('densifies trace rows with shortest-arc headings and source mapping', () => {
    const rows = densifyRoadRows([
      makeNode(0, 0, 10, 0),
      makeNode(10, 0, 12, Math.PI / 2),
    ], 2)
    // 10m 段按 2m 加密 → 4 行插值 + 首尾节点 = 6 行。
    expect(rows.length).toBe(6)
    expect(rows.map((row) => Number(row.x.toFixed(3)))).toEqual([0, 2, 4, 6, 8, 10])
    expect(rows[3]!.y).toBeCloseTo(11.2, 5)
    expect(rows[3]!.heading).toBeCloseTo((Math.PI / 2) * 0.6, 5)
    expect(rows.slice(0, 5).every((row) => row.sourceIndex === 0)).toBe(true)
    expect(rows[5]!.sourceIndex).toBe(1)
  })

  it('samples the conservative column envelope and clamps the lateral drop', () => {
    const row = { x: 0, z: 0, y: 10, heading: 0 }
    // 沿 z 的横坡：h = 10 + z/10；邻域包络沿 +z 侧抬升 0.25/10。
    const surface = (_x: number, z: number): number => 10 + z / 10
    const columns = sampleRoadRowColumns(row, surface, 5, 3, Number.POSITIVE_INFINITY)
    expect(columns[0]).toBeCloseTo(10 - 0.5 + 0.025, 5)
    expect(columns[1]).toBeCloseTo(10.025, 5)
    expect(columns[2]).toBeCloseTo(10 + 0.5 + 0.025, 5)

    const clamped = sampleRoadRowColumns(row, surface, 5, 3, 0.4)
    expect(clamped[0]).toBeCloseTo(9.6, 5)
    expect(clamped[2]).toBeCloseTo(10.4, 5)

    const fallback = sampleRoadRowColumns(row, () => null, 5, 3, 0.4)
    expect(fallback).toEqual([10, 10, 10])
  })
})

describe('terrain surface sampler (真实三角面采样)', () => {
  function makeSource(positions: number[], index: number[]): { mesh: THREE.Mesh; matrix: THREE.Matrix4 } {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setIndex(index)
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
    return { mesh, matrix: new THREE.Matrix4() }
  }

  it('interpolates exact triangle planes and keeps the top surface on overlap', () => {
    // 折脊：T1 → y = 0.2x + 0.2z；T2 → y = −0.2x + 0.6z（沿对角线相接）。
    const ridge = makeSource(
      [0, 0, 0, 10, 2, 0, 10, 4, 10, 0, 6, 10],
      [0, 1, 2, 0, 2, 3],
    )
    // 下方的整片平板（不应被选中）与局部上方的平板（应被选中）。
    const below = makeSource(
      [0, -5, 0, 10, -5, 0, 10, -5, 10, 0, -5, 10],
      [0, 1, 2, 0, 2, 3],
    )
    const above = makeSource(
      [5, 5, 0, 10, 5, 0, 10, 5, 5],
      [0, 1, 2],
    )
    const sampler = buildTerrainSurfaceSampler([ridge, below, above], { minX: 0, minZ: 0, maxX: 10, maxZ: 10 })
    expect(sampler).not.toBeNull()
    expect(sampler!.triangleCount).toBe(5)
    expect(sampler!.heightAt(1, 1)).toBeCloseTo(0.4, 5)
    expect(sampler!.heightAt(2, 5)).toBeCloseTo(2.6, 5)
    expect(sampler!.heightAt(8, 2)).toBeCloseTo(5, 5)
    expect(sampler!.heightAt(20, 20)).toBeNull()
  })

  it('skips degenerate 2D triangles (chunk skirts) and returns null without coverage', () => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      0, -50, 0,
      0, -50, 10,
    ], 3))
    geometry.setIndex([0, 1, 2])
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
    const sampler = buildTerrainSurfaceSampler(
      [{ mesh, matrix: new THREE.Matrix4() }],
      { minX: -5, minZ: -5, maxX: 5, maxZ: 15 },
    )
    expect(sampler).toBeNull()
  })
})
