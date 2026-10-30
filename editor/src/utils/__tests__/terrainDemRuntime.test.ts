import { describe, expect, it } from 'vitest'
import {
  decodeTerrainDemRuntimeGrid,
  decodeTerrainDemRuntimeGridFile,
  encodeTerrainDemRuntimeGrid,
  encodeTerrainDemRuntimeGridFile,
  type TerrainDemRuntimeGridData,
} from '@schema/terrainDemRuntimeGrid'
import { planEndpointRoadGuide } from '@schema/proceduralLandscape/endpointPath'
import {
  createDemTerrainHeightGrid,
  createDemTerrainMeshBuilder,
  createTerrainDemRuntimeOrthoTexture,
  sampleVisibleDemSurfaceHeightAt,
  sampleVisibleDemSurfaceNormalAt,
} from '@schema/proceduralLandscape/demTerrain'
import {
  createDemRoadbedGeometry,
  createDemRoadbedTarget,
} from '@schema/proceduralLandscape/demRoadbed'
import { buildRoadProximityIndex } from '@schema/proceduralLandscape/roadProximity'
import { densifyRoadRows } from '@schema/proceduralLandscape/roadBandRows'
import { createRoadCollisionGeometry } from '@schema/proceduralLandscape/roadCollision'
import type { RoadTraceNode } from '@schema/proceduralLandscape/roadTrace'
import * as THREE from 'three'
import {
  clampProceduralLandscapeProps,
  createDefaultProceduralLandscapeProps,
} from '@schema/proceduralLandscape/config'
import { summarizeTerrainPack } from '@schema/terrainPack'

function makeGrid(): TerrainDemRuntimeGridData {
  return {
    width: 3,
    height: 3,
    cellSizeX: 30,
    cellSizeZ: 30,
    minX: -30,
    minZ: -30,
    maxX: 30,
    maxZ: 30,
    minElevation: 3500,
    maxElevation: 3510,
    sourceMinElevation: 3500,
    sourceMaxElevation: 3510,
    anchor: {
      latitudeDegrees: 29.6,
      longitudeDegrees: 91.1,
      groundElevationMeters: 3500,
    },
    crs: { epsg: 32646, zone: 46, hemisphere: 'north' },
    filledRatio: 0.1,
    heights: new Float32Array([
      0, 1, 2,
      3, 4, 5,
      6, 7, 10,
    ]),
  }
}

function makeRidgeGrid(): TerrainDemRuntimeGridData {
  const width = 41
  const height = 21
  const cell = 10
  const heights = new Float32Array(width * height)
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const x = -200 + col * cell
      const z = -100 + row * cell
      heights[row * width + col] = 60 * Math.exp(
        -(x * x) / (70 * 70) - (z * z) / (25 * 25),
      )
    }
  }
  let maxElevation = 0
  for (const value of heights) {
    maxElevation = Math.max(maxElevation, value)
  }
  return {
    width,
    height,
    cellSizeX: cell,
    cellSizeZ: cell,
    minX: -200,
    minZ: -100,
    maxX: 200,
    maxZ: 100,
    minElevation: 0,
    maxElevation,
    sourceMinElevation: 0,
    sourceMaxElevation: maxElevation,
    anchor: {
      latitudeDegrees: 30,
      longitudeDegrees: 110,
      groundElevationMeters: 0,
    },
    crs: { epsg: 32649, zone: 49, hemisphere: 'north' },
    filledRatio: 0,
    heights,
  }
}

describe('terrain DEM runtime grid', () => {
  it('roundtrips the compact runtime format and deflate wrapper', () => {
    const source = makeGrid()
    const decoded = decodeTerrainDemRuntimeGrid(encodeTerrainDemRuntimeGrid(source))
    expect(decoded.width).toBe(3)
    expect(decoded.height).toBe(3)
    expect(decoded.anchor.latitudeDegrees).toBeCloseTo(source.anchor.latitudeDegrees)
    expect(decoded.crs.epsg).toBe(32646)
    expect(Array.from(decoded.heights)).toEqual(Array.from(source.heights))
    expect(decoded.filledRatio).toBeCloseTo(0.1)

    const wrapped = decodeTerrainDemRuntimeGridFile(encodeTerrainDemRuntimeGridFile(source))
    expect(Array.from(wrapped.heights)).toEqual(Array.from(source.heights))
  })

  it('creates a world-offset height grid and time-sliced mesh', () => {
    const grid = createDemTerrainHeightGrid(makeGrid(), 100, 200, 50)
    expect(grid.contains(100, 200)).toBe(true)
    expect(grid.minY).toBe(50)
    expect(grid.sampleHeight(100, 200)).toBeCloseTo(54)

    const builder = createDemTerrainMeshBuilder(makeGrid(), 1)
    while (!builder.step(1000)) {
      // deliberately drain the builder
    }
    expect(builder.done).toBe(true)
    expect(builder.vertexCount).toBe(9)
    expect(builder.triangleCount).toBe(8)
    expect(builder.geometry?.getAttribute('position').count).toBe(9)
    const uv = builder.geometry?.getAttribute('uv')
    expect(uv?.count).toBe(9)
    expect([uv?.getX(0), uv?.getY(0)]).toEqual([0, 0])
    expect([uv?.getX(8), uv?.getY(8)]).toEqual([1, 1])
  })

  it('creates an sRGB clamped DEM orthophoto texture', () => {
    const texture = createTerrainDemRuntimeOrthoTexture({
      width: 1,
      height: 1,
      rgb: new Uint8Array([20, 40, 60]),
    }, 'test-ortho')
    expect(texture.image.width).toBe(1)
    expect(texture.image.height).toBe(1)
    expect(texture.name).toBe('test-ortho')
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(texture.flipY).toBe(false)
    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping)
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping)
    texture.dispose()
  })

  it('decimates the runtime mesh by 2x and 4x without changing the bounds', () => {
    const source = makeGrid()
    const size = 9
    const heights = new Float32Array(size * size)
    for (let i = 0; i < heights.length; i += 1) heights[i] = i % 17
    const large = {
      ...source,
      width: size,
      height: size,
      maxX: source.minX + (size - 1) * source.cellSizeX,
      maxZ: source.minZ + (size - 1) * source.cellSizeZ,
      heights,
    }
    const expectations = [
      { step: 1, vertices: 81, triangles: 128 },
      { step: 2, vertices: 25, triangles: 32 },
      { step: 4, vertices: 9, triangles: 8 },
    ]
    for (const expected of expectations) {
      const builder = createDemTerrainMeshBuilder(large, expected.step)
      while (!builder.step(1000)) {
        // drain
      }
      expect(builder.vertexCount).toBe(expected.vertices)
      expect(builder.triangleCount).toBe(expected.triangles)
      const position = builder.geometry!.getAttribute('position')
      expect(position.getX(0)).toBeCloseTo(large.minX)
      expect(position.getX(position.count - 1)).toBeCloseTo(large.maxX)
      expect(position.getZ(position.count - 1)).toBeCloseTo(large.maxZ)
    }
  })

  it('clamps DEM props and keeps endpoint deviation bounded', () => {
    const defaults = createDefaultProceduralLandscapeProps({ id: 'dem' })
    expect(defaults.dem.assetId).toBeNull()
    expect(defaults.road.pathDeviation).toBe(60)
    const clamped = clampProceduralLandscapeProps({
      dem: { assetId: 'asset', runtimeGridUrl: 'https://example.test/grid.bin', sampleStep: 4 },
      road: { pathDeviation: 500 },
    } as never, 'dem')
    expect(clamped.dem.sampleStep).toBe(4)
    expect(clamped.road.pathDeviation).toBe(500)
  })
})

describe('endpoint road planner', () => {
  it('keeps a flat route between endpoints and respects the corridor', () => {
    const grid = createDemTerrainHeightGrid(makeGrid(), 0, 0)
    const result = planEndpointRoadGuide(
      grid,
      { x: -20, z: 0 },
      { x: 20, z: 0 },
      { maxDeviation: 10, roadHalfWidth: 3.5, shoulderWidth: 2.5, maxSlope: 0.55, seed: 7 },
    )
    expect(result.guide[0]).toEqual({ x: -20, z: 0 })
    expect(result.guide[result.guide.length - 1]).toEqual({ x: 20, z: 0 })
    expect(result.maxDeviation).toBeLessThanOrEqual(10)
    expect(result.guide.every((point) => Number.isFinite(point.x) && Number.isFinite(point.z))).toBe(true)
  })

  it('is deterministic and falls back explicitly when endpoints are too short', () => {
    const grid = createDemTerrainHeightGrid(makeGrid(), 0, 0)
    const options = { maxDeviation: 10, roadHalfWidth: 3.5, shoulderWidth: 2.5, maxSlope: 0.55, seed: 1 }
    const a = planEndpointRoadGuide(grid, { x: -20, z: 0 }, { x: 20, z: 0 }, options)
    const b = planEndpointRoadGuide(grid, { x: -20, z: 0 }, { x: 20, z: 0 }, options)
    expect(a.guide).toEqual(b.guide)
    const short = planEndpointRoadGuide(grid, { x: 0, z: 0 }, { x: 0.1, z: 0 }, options)
    expect(short.warning).toBe('endpoint-path-too-short')
  })

  it('detours around a steep ridge while staying inside the deviation corridor', () => {
    const data = makeRidgeGrid()
    const grid = createDemTerrainHeightGrid(data, 0, 0)
    const start = { x: -180, z: 0 }
    const end = { x: 180, z: 0 }
    const maxDeviation = 60
    const result = planEndpointRoadGuide(grid, start, end, {
      maxDeviation,
      roadHalfWidth: 3.5,
      shoulderWidth: 2.5,
      maxSlope: 0.55,
      seed: 3,
    })
    expect(result.warning).toBeNull()
    expect(result.guide[0]).toEqual(start)
    expect(result.guide[result.guide.length - 1]).toEqual(end)
    expect(result.maxDeviation).toBeGreaterThan(20)
    expect(result.maxDeviation).toBeLessThanOrEqual(maxDeviation)

    let maxHeight = 0
    let maxLateral = 0
    let maxSpacing = 0
    for (let index = 0; index < result.guide.length; index += 1) {
      const point = result.guide[index]!
      maxHeight = Math.max(maxHeight, grid.sampleHeight(point.x, point.z) ?? 0)
      maxLateral = Math.max(maxLateral, Math.abs(point.z))
      if (index > 0) {
        const previous = result.guide[index - 1]!
        maxSpacing = Math.max(maxSpacing, Math.hypot(point.x - previous.x, point.z - previous.z))
      }
    }
    // The direct chord crosses the 60m ridge; the chosen route follows the
    // low saddle inside the allowed corridor.
    expect(maxHeight).toBeLessThan(20)
    expect(maxLateral).toBeLessThanOrEqual(maxDeviation + 0.5)
    expect(maxSpacing).toBeLessThanOrEqual(16.1)
  })
})

describe('DEM roadbed', () => {
  it('samples the visible roadbed for collision and falls back to DEM off-road', () => {
    const grid = createDemTerrainHeightGrid(makeGrid())
    const nodes: RoadTraceNode[] = [
      {
        x: -30,
        y: 10,
        z: 0,
        heading: 0,
        index: 0,
        lateral: 0,
        longitudinal: 0,
        turn: 0,
        headingDelta: 0,
      },
      {
        x: 30,
        y: 10,
        z: 0,
        heading: 0,
        index: 1,
        lateral: 0,
        longitudinal: 0,
        turn: 0,
        headingDelta: 0,
      },
    ]
    const roadField = buildRoadProximityIndex(nodes, { maxDistance: 60 })
    expect(roadField).not.toBeNull()
    const roadbed = createDemRoadbedTarget({
      roadField: roadField!,
      rawHeightAt: (_x, z) => 20 + z * 0.6,
      halfWidth: 3.5,
      shoulderWidth: 2.5,
      demCellSize: 20,
      sideWidth: 8,
      coverageWidth: 2,
      roadSurfaceLift: 0.05,
    })

    // The raw terrain rises across the corridor, while the road design stays flat.
    expect(roadbed.rawHeightAt(0, 0)).toBeCloseTo(20, 5)
    expect(roadbed.heightAt(0, 0)).toBeCloseTo(9.95, 5)
    expect(roadbed.walkableHeightAt(0, 0)).toBeCloseTo(10.05, 5)
    expect(sampleVisibleDemSurfaceHeightAt(grid, roadbed, 0, 0)).toBeCloseTo(10.05, 5)
    expect(sampleVisibleDemSurfaceHeightAt(grid, roadbed, 0, 5.5)).toBeCloseTo(9.95, 5)
    expect(sampleVisibleDemSurfaceHeightAt(grid, roadbed, 0, 0)!).toBeGreaterThan(10)

    const rows = densifyRoadRows(nodes, 2)
    const collision = createRoadCollisionGeometry({
      rows,
      halfWidth: 3.5,
      rowSpacing: 2,
      columnCount: 5,
      lift: 0.05,
    })
    expect(collision).not.toBeNull()
    const collisionPosition = collision!.geometry.getAttribute('position')
    const centerIndex = Math.floor(collision!.columnCount / 2)
    expect(collisionPosition.getY(centerIndex)).toBeCloseTo(
      sampleVisibleDemSurfaceHeightAt(grid, roadbed, 0, 0)!,
      3,
    )

    const roadbedNormal = sampleVisibleDemSurfaceNormalAt(grid, roadbed, 0, 10, 0.5)
    expect(roadbedNormal).not.toBeNull()
    expect(roadbedNormal!.length()).toBeCloseTo(1, 6)
    expect(roadbedNormal!.y).toBeGreaterThan(0)
    expect(roadbedNormal!.z).toBeLessThan(-0.5)

    // Outside the generated roadbed, collision continues to follow the visible DEM.
    expect(sampleVisibleDemSurfaceHeightAt(grid, roadbed, 0, 20)).toBeCloseTo(
      grid.sampleHeight(0, 20)!,
      5,
    )
    const outsideNormal = sampleVisibleDemSurfaceNormalAt(grid, roadbed, 0, 20, 0.5)
    const rawOutsideNormal = new THREE.Vector3(
      -(grid.sampleHeight(0.5, 20)! - grid.sampleHeight(-0.5, 20)!),
      1,
      -(grid.sampleHeight(0, 20.5)! - grid.sampleHeight(0, 19.5)!),
    ).normalize()
    expect(outsideNormal).not.toBeNull()
    expect(rawOutsideNormal).not.toBeNull()
    expect(outsideNormal!.distanceTo(rawOutsideNormal!)).toBeLessThan(1e-6)
  })

  it('keeps the carriageway flat and meets the raw terrain at the outer edge', () => {
    const rows = densifyRoadRows([
      { x: 0, z: 0, y: 100, heading: 0, index: 0, lateral: 0, longitudinal: 0, turn: 0, headingDelta: 0 },
      { x: 200, z: 0, y: 100, heading: 0, index: 1, lateral: 0, longitudinal: 0, turn: 0, headingDelta: 0 },
    ], 10)
    const rawHeightAt = (x: number, z: number): number => 120 + x * 0.05 + Math.abs(z) * 0.2
    const result = createDemRoadbedGeometry({
      rows,
      halfWidth: 3.5,
      shoulderWidth: 2.5,
      sideWidth: 12,
      coverageWidth: 4,
      roadDrop: 0.02,
      edgeDrop: 0.06,
      lateralStep: 2,
      rawHeightAt,
      hostInverse: new THREE.Matrix4(),
    })
    expect(result).not.toBeNull()
    expect(result!.triangleCount).toBeGreaterThan(0)
    const position = result!.geometry.getAttribute('position')
    const normal = result!.geometry.getAttribute('normal')
    const columns = (result!.vertexCount / rows.length) | 0
    let upward = 0
    for (let i = 0; i < normal.count; i += 1) {
      if (normal.getY(i) > 0) upward += 1
    }
    expect(upward).toBe(normal.count)

    // Two central columns sit inside the asphalt/shoulder band: exactly flat.
    const centerLeft = Math.floor((columns - 1) / 2)
    const centerRight = Math.ceil((columns - 1) / 2)
    expect(position.getY(centerLeft)).toBeCloseTo(99.98, 5)
    expect(position.getY(centerRight)).toBeCloseTo(99.98, 5)

    // Coverage ring tucks slightly under the raw terrain at both edges.
    for (const col of [0, columns - 1]) {
      const x = position.getX(col)
      const z = position.getZ(col)
      expect(position.getY(col)).toBeCloseTo(rawHeightAt(x, z) - 0.06, 5)
    }
  })
})

describe('DEM pack metadata', () => {
  it('keeps the sidecar hole-fill warning for the admin/editor UI', () => {
    const summary = summarizeTerrainPack(
      [
        { path: 'dem.tif', bytes: 10 },
        { path: 'dem.json', bytes: 10 },
      ],
      {
        sidecar: {
          version: 1,
          generator: '3dtiles-viewer',
          createdAt: '2026-01-01T00:00:00.000Z',
          anchor: { latitudeDegrees: 29.6, longitudeDegrees: 91.1, groundElevationMeters: 3500 },
          crs: { type: 'utm', epsg: 32646, zone: 46, hemisphere: 'north', geographicEpsg: 4326 },
          geoTransform: [0, 30, 0, 1000, 0, -30],
          elevationDatum: 'wgs84-ellipsoid',
          dem: {
            file: 'dem.tif',
            width: 2,
            height: 2,
            cellSizeMeters: 30,
            minElevationMeters: 3500,
            maxElevationMeters: 3510,
          },
          ortho: null,
          stats: {
            sourceTriangleCount: 0,
            sampledCellCount: 100,
            filledCellCount: 28,
            filledRatio: 0.278,
            warnings: ['采样空洞占比 27.8%，已用最近有效值填充。'],
          },
        },
      },
    )
    expect(summary.warnings.some((warning) => warning.includes('27.8%'))).toBe(true)
    expect(summary.warnings.some((warning) => warning.includes('采样空洞占比'))).toBe(true)
  })
})
