import { describe, expect, it } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import {
  buildTerrainDemSidecar,
  encodeDemGeoTiff,
  resolveDemGeoReference,
  type DemExportFrame,
  type DemGridPlan,
} from '../../../../tools/3dtiles-viewer/src/demExport'
import { parsePlanningDemBlob } from '../planningDemImport'
import {
  isTerrainDemPackageZip,
  parseTerrainDemPackageZip,
  parseTerrainDemSidecarJson,
  verifyTerrainDemPackageImport,
} from '../terrainDemPackageZip'

const FRAME: DemExportFrame = {
  latitudeDegrees: 29.6439555556,
  longitudeDegrees: 91.1158416667,
  groundElevationMeters: 3651.5,
}
const CELL_SIZE = 2

function buildPlan(rows: number, cols: number): DemGridPlan {
  return {
    rows,
    cols,
    cellSizeMeters: CELL_SIZE,
    xMin: -rows,
    xMax: rows,
    zMin: -cols,
    zMax: cols,
    autoCellSize: false,
  }
}

function buildTerrainDemPackageFixture() {
  const plan = buildPlan(4, 6)
  const geo = resolveDemGeoReference(plan, FRAME)
  const heights = new Float32Array(plan.rows * plan.cols)
  for (let index = 0; index < heights.length; index += 1) {
    heights[index] = 3600 + index * 0.25
  }
  const demTif = encodeDemGeoTiff(heights, plan, geo)
  const sidecar = buildTerrainDemSidecar({
    frame: FRAME,
    plan,
    geo,
    heights,
    sample: { hitCount: heights.length, filledCount: 0, filledRatio: 0 },
    sourceTriangleCount: 1234,
    hasOrtho: false,
    warnings: [],
    createdAt: new Date('2026-02-03T04:05:06Z'),
  })
  const zip = zipSync({
    'dem.tif': new Uint8Array(demTif),
    'dem.json': new TextEncoder().encode(JSON.stringify(sidecar)),
  })
  return { plan, geo, heights, sidecar, zip }
}

describe('isTerrainDemPackageZip', () => {
  it('detects zip uploads case-insensitively', () => {
    expect(isTerrainDemPackageZip('terrain-dem-29.6-91.1.zip')).toBe(true)
    expect(isTerrainDemPackageZip('TERRAIN.ZIP', null)).toBe(true)
    expect(isTerrainDemPackageZip('dem.tif', 'image/tiff')).toBe(false)
  })
})

describe('parseTerrainDemPackageZip', () => {
  it('unpacks the DEM raster and sidecar', () => {
    const { sidecar, zip } = buildTerrainDemPackageFixture()
    const contents = parseTerrainDemPackageZip(zip)
    expect(contents.dem.filename).toBe('dem.tif')
    expect(contents.dem.mimeType).toBe('image/tiff')
    expect(contents.ortho).toBeNull()
    expect(contents.sidecar).toEqual(sidecar)
    expect(contents.sidecar.dem.width).toBe(6)
    expect(contents.sidecar.dem.height).toBe(4)
    expect(contents.sidecar.crs.epsg).toBe(32646)
  })

  it('finds files inside a nested folder', () => {
    const { zip } = buildTerrainDemPackageFixture()
    const entries = unzipSync(zip)
    const nested = zipSync(
      Object.fromEntries(Object.entries(entries).map(([name, bytes]) => [`terrain/${name}`, bytes])),
    )
    const contents = parseTerrainDemPackageZip(nested)
    expect(contents.sidecar.dem.width).toBe(6)
  })

  it('rejects archives without a sidecar or DEM', () => {
    expect(() => parseTerrainDemPackageZip(zipSync({ 'readme.txt': new TextEncoder().encode('nope') })))
      .toThrow(/dem\.json/)
    const demOnly = encodeDemGeoTiff(new Float32Array(4), buildPlan(2, 2), resolveDemGeoReference(buildPlan(2, 2), FRAME))
    expect(() => parseTerrainDemPackageZip(zipSync({ 'dem.tif': new Uint8Array(demOnly) })))
      .toThrow(/dem\.json/)
    const { sidecar } = buildTerrainDemPackageFixture()
    expect(() => parseTerrainDemPackageZip(zipSync({
      'dem.json': new TextEncoder().encode(JSON.stringify(sidecar)),
    }))).toThrow(/dem\.tif/)
  })

  it('rejects corrupt archives and unsupported sidecar versions', () => {
    expect(() => parseTerrainDemPackageZip(new Uint8Array([1, 2, 3, 4]))).toThrow(/zip|dem\.json/)
    const versionTwo = { ...buildTerrainDemPackageFixture().sidecar, version: 2 }
    expect(() => parseTerrainDemSidecarJson(new TextEncoder().encode(JSON.stringify(versionTwo))))
      .toThrow(/版本/)
  })
})

describe('terrain DEM package -> planning DEM import', () => {
  it('imports the packaged GeoTIFF through the planning DEM pipeline', async () => {
    const { plan, heights, zip, sidecar } = buildTerrainDemPackageFixture()
    const contents = parseTerrainDemPackageZip(zip)

    const result = await parsePlanningDemBlob(contents.dem.blob, 'dem.tif', 'image/tiff', { createPreview: false })
    expect(result.width).toBe(plan.cols)
    expect(result.height).toBe(plan.rows)
    expect(result.sampleStepMeters).toBeCloseTo(CELL_SIZE, 6)
    expect(result.projectedCrs).toBe('EPSG:32646')
    expect(result.worldBounds).toEqual({ minX: -5, minY: -3, maxX: 5, maxY: 3 })
    expect(result.rasterData?.[0] ?? Number.NaN).toBeCloseTo(heights[0] ?? Number.NaN, 4)
    expect(result.rasterData?.[heights.length - 1] ?? Number.NaN)
      .toBeCloseTo(heights[heights.length - 1] ?? Number.NaN, 3)

    expect(() => verifyTerrainDemPackageImport(sidecar, result)).not.toThrow()
  })

  it('detects a sidecar that no longer matches the raster', async () => {
    const { zip, sidecar } = buildTerrainDemPackageFixture()
    const contents = parseTerrainDemPackageZip(zip)
    const result = await parsePlanningDemBlob(contents.dem.blob, 'dem.tif', 'image/tiff', { createPreview: false })

    expect(() => verifyTerrainDemPackageImport(
      { ...sidecar, dem: { ...sidecar.dem, width: sidecar.dem.width + 1 } },
      result,
    )).toThrow(/不一致/)
    expect(() => verifyTerrainDemPackageImport(
      { ...sidecar, dem: { ...sidecar.dem, cellSizeMeters: CELL_SIZE * 2 } },
      result,
    )).toThrow(/像素间距/)
  })
})
