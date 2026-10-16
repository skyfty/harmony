import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { fromArrayBuffer } from 'geotiff'
import { TERRAIN_DEM_PACKAGE_VERSION, type TerrainDemPackageSidecar } from '../../../../schema/terrainDemPackage'
import {
  buildTerrainDemSidecar,
  copyRenderTargetTileToOrtho,
  DEM_CELL_SIZE_SNAP_STEPS,
  encodeDemGeoTiff,
  encodeOrthoGeoTiff,
  estimateMedianTriangleEdgeMeters,
  fillDemHoles,
  fillRgbHoles,
  planDemGrid,
  resolveDemGeoReference,
  sampleDemHeights,
  type DemExportFrame,
  type DemGeoReference,
  type DemGridPlan,
} from '../demExport'
import { latLonToUtm } from '../wgs84Utm'

function buildPlaneGeometry(sizeX: number, sizeZ: number, segments: number, height = 0): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(sizeX, sizeZ, segments, segments)
  geometry.rotateX(-Math.PI / 2)
  if (height !== 0) {
    geometry.translate(0, height, 0)
  }
  return geometry
}

function buildQuadStripGeometry(): THREE.BufferGeometry {
  // Two strips along X covering z in [-10, -2] and [2, 10]; the middle band
  // (z in [-2, 2]) is intentionally missing so sampling leaves holes there.
  const positions = [
    -10, 0, -10, 10, 0, -10, 10, 0, -2, -10, 0, -2,
    -10, 0, 2, 10, 0, 2, 10, 0, 10, -10, 0, 10,
  ]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
  return geometry
}

const TEST_FRAME: DemExportFrame = {
  latitudeDegrees: 29.6439555556,
  longitudeDegrees: 91.1158416667,
  groundElevationMeters: 1000,
}

function buildTestGeo(plan: DemGridPlan, frame: DemExportFrame = TEST_FRAME): DemGeoReference {
  return resolveDemGeoReference(plan, frame)
}

describe('planDemGrid', () => {
  it('derives the auto cell size from the median triangle edge', () => {
    // PlaneGeometry(100, 100, 50, 50) has 2m axis edges; the triangle median is 2.
    const geometry = buildPlaneGeometry(100, 100, 50)
    const { plan, warnings } = planDemGrid(geometry)
    expect(plan.autoCellSize).toBe(true)
    expect(plan.cellSizeMeters).toBe(2)
    expect(plan.rows).toBe(50)
    expect(plan.cols).toBe(50)
    expect(warnings).toHaveLength(0)
    expect(plan.xMin).toBeCloseTo(-50, 6)
    expect(plan.zMax).toBeCloseTo(50, 6)
  })

  it('snaps odd median edges up to the configured steps', () => {
    // 100m / 33 segments -> ~3.03m edges -> snaps to 5m.
    const geometry = buildPlaneGeometry(100, 100, 33)
    const median = estimateMedianTriangleEdgeMeters(geometry)
    expect(median).toBeGreaterThan(3)
    expect(median).toBeLessThan(3.2)
    const { plan } = planDemGrid(geometry)
    expect(plan.cellSizeMeters).toBe(5)
  })

  it('enlarges a manual cell size until the grid fits the cap', () => {
    const geometry = buildPlaneGeometry(10000, 10000, 10)
    const { plan, warnings } = planDemGrid(geometry, { cellSize: 0.5 })
    expect(plan.rows).toBeLessThanOrEqual(4096)
    expect(plan.cols).toBeLessThanOrEqual(4096)
    expect(plan.cellSizeMeters).toBe(5)
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('rejects empty geometry', () => {
    const geometry = new THREE.BufferGeometry()
    expect(() => planDemGrid(geometry)).toThrow()
  })

  it('keeps the documented snap step ordering', () => {
    expect(DEM_CELL_SIZE_SNAP_STEPS[0]).toBe(0.5)
    expect(DEM_CELL_SIZE_SNAP_STEPS[DEM_CELL_SIZE_SNAP_STEPS.length - 1]).toBe(20)
  })
})

describe('resolveDemGeoReference', () => {
  it('anchors the raster origin at the north-west corner in UTM', () => {
    const geometry = buildPlaneGeometry(100, 100, 50)
    const { plan } = planDemGrid(geometry)
    const geo = buildTestGeo(plan)
    const utm = latLonToUtm(TEST_FRAME.latitudeDegrees, TEST_FRAME.longitudeDegrees)
    expect(geo.epsg).toBe(utm.epsg)
    expect(geo.geoTransform[0]).toBeCloseTo(utm.easting + plan.zMin, 6)
    expect(geo.geoTransform[3]).toBeCloseTo(utm.northing + plan.xMax, 6)
    expect(geo.geoTransform[1]).toBe(plan.cellSizeMeters)
    expect(geo.geoTransform[5]).toBe(-plan.cellSizeMeters)
  })

  it('rejects exports crossing a UTM zone boundary', () => {
    // 5.999E sits just west of the zone 31/32 boundary at 6E; a 2km east
    // extent pushes the raster into zone 32.
    const geometry = buildPlaneGeometry(100, 2000, 10)
    const { plan } = planDemGrid(geometry, { cellSize: 10 })
    const frame: DemExportFrame = { latitudeDegrees: 45, longitudeDegrees: 5.999, groundElevationMeters: 0 }
    expect(() => resolveDemGeoReference(plan, frame)).toThrow(/分带/)
  })
})

describe('sampleDemHeights', () => {
  it('samples a flat plane at the offset ellipsoid height', async () => {
    const geometry = buildPlaneGeometry(20, 20, 10, 5)
    const { plan } = planDemGrid(geometry)
    const result = await sampleDemHeights(geometry, plan, TEST_FRAME)
    const expected = 5 + TEST_FRAME.groundElevationMeters
    expect(result.hitCount).toBe(plan.rows * plan.cols)
    expect(result.filledCount).toBe(0)
    for (const value of result.heights) {
      expect(value).toBeCloseTo(expected, 4)
    }
  })

  it('fills cells the mesh does not cover and reports them through the mask', async () => {
    const geometry = buildQuadStripGeometry()
    const { plan } = planDemGrid(geometry, { cellSize: 2 })
    const result = await sampleDemHeights(geometry, plan, TEST_FRAME)
    expect(result.hitCount).toBeGreaterThan(0)
    expect(result.holeCount).toBeGreaterThan(0)
    expect(result.filledCount).toBe(result.holeCount)
    expect(result.filledRatio).toBeCloseTo(result.holeCount / (plan.rows * plan.cols), 6)
    for (const value of result.heights) {
      expect(Number.isFinite(value)).toBe(true)
    }
    const maskHoles = result.wasHole.reduce((sum, flag) => sum + (flag === 1 ? 1 : 0), 0)
    expect(maskHoles).toBe(result.holeCount)
  })
})

describe('fillDemHoles', () => {
  it('propagates the nearest valid value into holes', () => {
    const rows = 5
    const cols = 5
    const heights = new Float32Array(rows * cols)
    for (let index = 0; index < heights.length; index += 1) {
      heights[index] = index % cols === 2 ? Number.NaN : (index % cols) * 10
    }
    const { filledCount, wasHole } = fillDemHoles(heights, rows, cols)
    expect(filledCount).toBe(rows)
    for (let row = 0; row < rows; row += 1) {
      expect(heights[row * cols + 2]).toBe(10)
      expect(wasHole[row * cols + 2]).toBe(1)
    }
    expect(wasHole[0]).toBe(0)
  })

  it('leaves an all-hole raster untouched', () => {
    const heights = new Float32Array(4)
    heights.fill(Number.NaN)
    const { filledCount } = fillDemHoles(heights, 2, 2)
    expect(filledCount).toBe(0)
  })
})

describe('GeoTIFF encoding', () => {
  it('round-trips DEM values, georeferencing and CRS keys', async () => {
    const plan: DemGridPlan = {
      rows: 4,
      cols: 6,
      cellSizeMeters: 2.5,
      xMin: -5,
      xMax: 5,
      zMin: -7.5,
      zMax: 7.5,
      autoCellSize: false,
    }
    const geo = buildTestGeo(plan)
    const heights = new Float32Array(plan.rows * plan.cols)
    for (let index = 0; index < heights.length; index += 1) {
      heights[index] = 1000 + index * 0.5
    }

    const buffer = encodeDemGeoTiff(heights, plan, geo)
    const tiff = await fromArrayBuffer(buffer)
    const image = await tiff.getImage()

    expect(image.getWidth()).toBe(plan.cols)
    expect(image.getHeight()).toBe(plan.rows)

    const resolution = image.getResolution()
    expect(resolution[0]).toBeCloseTo(plan.cellSizeMeters, 6)
    expect(resolution[1]).toBeCloseTo(-plan.cellSizeMeters, 6)

    const bbox = image.getBoundingBox()
    expect(bbox[0]).toBeCloseTo(geo.geoTransform[0], 4)
    expect(bbox[3]).toBeCloseTo(geo.geoTransform[3], 4)
    expect(bbox[2]).toBeCloseTo(geo.geoTransform[0] + plan.cols * plan.cellSizeMeters, 4)
    expect(bbox[1]).toBeCloseTo(geo.geoTransform[3] - plan.rows * plan.cellSizeMeters, 4)

    const geoKeys = image.getGeoKeys()
    expect(geoKeys?.GTModelTypeGeoKey).toBe(1)
    expect(geoKeys?.GTRasterTypeGeoKey).toBe(1)
    expect(geoKeys?.ProjectedCSTypeGeoKey).toBe(geo.epsg)

    const rasters = await image.readRasters({ interleave: true })
    expect(rasters.length).toBe(heights.length)
    for (let index = 0; index < heights.length; index += 1) {
      expect(Number(rasters[index])).toBeCloseTo(heights[index], 5)
    }
  })

  it('round-trips interleaved RGB ortho values', async () => {
    const plan: DemGridPlan = {
      rows: 2,
      cols: 3,
      cellSizeMeters: 1,
      xMin: 0,
      xMax: 2,
      zMin: 0,
      zMax: 3,
      autoCellSize: false,
    }
    const geo = buildTestGeo(plan)
    const rgb = new Uint8Array([
      10, 20, 30, 40, 50, 60, 70, 80, 90,
      100, 110, 120, 130, 140, 150, 160, 170, 180,
    ])

    const buffer = encodeOrthoGeoTiff(rgb, plan, geo)
    const tiff = await fromArrayBuffer(buffer)
    const image = await tiff.getImage()
    expect(image.getWidth()).toBe(plan.cols)
    expect(image.getHeight()).toBe(plan.rows)
    expect(image.getSamplesPerPixel()).toBe(3)

    const rasters = await image.readRasters({ interleave: true })
    expect(rasters.length).toBe(rgb.length)
    for (let index = 0; index < rgb.length; index += 1) {
      expect(Number(rasters[index])).toBe(rgb[index])
    }
  })
})

describe('copyRenderTargetTileToOrtho', () => {
  it('flips GL bottom-up rows so raster row 0 is the northern edge', () => {
    const tileWidth = 2
    const tileHeight = 3
    const rgba = new Uint8Array(tileWidth * tileHeight * 4)
    for (let y = 0; y < tileHeight; y += 1) {
      for (let x = 0; x < tileWidth; x += 1) {
        const offset = (y * tileWidth + x) * 4
        rgba[offset] = y * 10 + x
        rgba[offset + 1] = 200
        rgba[offset + 2] = 100
        rgba[offset + 3] = 255
      }
    }
    const rgb = new Uint8Array(tileWidth * tileHeight * 3)

    copyRenderTargetTileToOrtho({
      rgba,
      tileWidth,
      tileHeight,
      rasterRowStart: 0,
      rasterColStart: 0,
      rasterRows: tileHeight,
      rasterCols: tileWidth,
      rgb,
    })

    // GL row 2 (top, north) becomes raster row 0.
    expect([rgb[0], rgb[1], rgb[2]]).toEqual([20, 200, 100])
    expect([rgb[3], rgb[4], rgb[5]]).toEqual([21, 200, 100])
    // Raster row 2 comes from GL bottom row 0.
    expect([rgb[12], rgb[13], rgb[14]]).toEqual([0, 200, 100])
    expect([rgb[15], rgb[16], rgb[17]]).toEqual([1, 200, 100])
  })

  it('respects raster offsets and clips out-of-range pixels', () => {
    const rgba = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255])
    const rgb = new Uint8Array(4 * 4 * 3)
    copyRenderTargetTileToOrtho({
      rgba,
      tileWidth: 2,
      tileHeight: 2,
      rasterRowStart: 1,
      rasterColStart: 1,
      rasterRows: 4,
      rasterCols: 4,
      rgb,
    })
    // Tile top-left (GL y=1,x=0) lands at raster (row 1, col 1).
    expect([rgb[(1 * 4 + 1) * 3], rgb[(1 * 4 + 1) * 3 + 1], rgb[(1 * 4 + 1) * 3 + 2]]).toEqual([7, 8, 9])
    // Untouched border stays zeroed.
    expect(rgb[0]).toBe(0)

    const clipped = new Uint8Array(4 * 4 * 3)
    copyRenderTargetTileToOrtho({
      rgba,
      tileWidth: 2,
      tileHeight: 2,
      rasterRowStart: 3,
      rasterColStart: 3,
      rasterRows: 4,
      rasterCols: 4,
      rgb: clipped,
    })
    // Only one pixel remains inside the raster.
    const filled = Array.from(clipped).filter((value) => value !== 0).length
    expect(filled).toBe(3)
  })
})

describe('fillRgbHoles', () => {
  it('fills masked pixels from the nearest valid colour', () => {
    const rows = 3
    const cols = 3
    const rgb = new Uint8Array(rows * cols * 3)
    const wasHole = new Uint8Array(rows * cols)
    for (let index = 0; index < rows * cols; index += 1) {
      rgb[index * 3] = index + 1
      if (index % cols === 1) {
        wasHole[index] = 1
      }
    }
    const filled = fillRgbHoles(rgb, wasHole, rows, cols)
    expect(filled).toBe(3)
    // Hole cells (column 1) copy from their left neighbour (column 0).
    expect(rgb[(0 * 3 + 1) * 3]).toBe(rgb[(0 * 3 + 0) * 3])
    expect(rgb[(1 * 3 + 1) * 3]).toBe(rgb[(1 * 3 + 0) * 3])
    expect(rgb[(1 * 3 + 1) * 3 + 2]).toBe(rgb[(1 * 3 + 0) * 3 + 2])
  })
})

describe('buildTerrainDemSidecar', () => {
  it('produces a schema-compatible sidecar', () => {
    const geometry = buildPlaneGeometry(100, 100, 50)
    const { plan, warnings } = planDemGrid(geometry)
    const geo = buildTestGeo(plan)
    const heights = new Float32Array(plan.rows * plan.cols).fill(1005)
    heights[0] = 1000
    heights[1] = 1010

    const sidecar = buildTerrainDemSidecar({
      frame: TEST_FRAME,
      plan,
      geo,
      heights,
      sample: { hitCount: heights.length, filledCount: 0, filledRatio: 0 },
      sourceTriangleCount: 5000,
      hasOrtho: true,
      warnings,
      createdAt: new Date('2026-01-02T03:04:05Z'),
    })

    expect(sidecar.version).toBe(TERRAIN_DEM_PACKAGE_VERSION)
    const typed: TerrainDemPackageSidecar = sidecar
    expect(typed.generator).toBe('3dtiles-viewer')
    expect(typed.createdAt).toBe('2026-01-02T03:04:05.000Z')
    expect(typed.dem.file).toBe('dem.tif')
    expect(typed.dem.width).toBe(plan.cols)
    expect(typed.dem.minElevationMeters).toBe(1000)
    expect(typed.dem.maxElevationMeters).toBe(1010)
    expect(typed.ortho?.file).toBe('ortho.tif')
    expect(typed.crs.type).toBe('utm')
    expect(typed.elevationDatum).toBe('wgs84-ellipsoid')
    expect(typed.stats.sourceTriangleCount).toBe(5000)
  })

  it('records a null ortho raster when imagery is skipped', () => {
    const geometry = buildPlaneGeometry(20, 20, 10)
    const { plan, warnings } = planDemGrid(geometry)
    const geo = buildTestGeo(plan)
    const heights = new Float32Array(plan.rows * plan.cols).fill(1)
    const sidecar = buildTerrainDemSidecar({
      frame: TEST_FRAME,
      plan,
      geo,
      heights,
      sample: { hitCount: heights.length, filledCount: 0, filledRatio: 0 },
      sourceTriangleCount: 200,
      hasOrtho: false,
      warnings,
    })
    expect(sidecar.ortho).toBeNull()
  })
})
