import assert from 'node:assert/strict'
import test from 'node:test'
import { zipSync } from 'fflate'
import {
  buildTerrainPackAssetMetadata,
  parseTerrainPackArchive,
  planTerrainPackStorage,
} from '../src/services/terrainPackService'

function createSidecar(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    generator: '3dtiles-viewer',
    createdAt: '2026-10-17T00:00:00.000Z',
    anchor: {
      latitudeDegrees: 29.64396,
      longitudeDegrees: 91.11584,
      groundElevationMeters: 3651.5,
    },
    crs: { type: 'utm', epsg: 32646, zone: 46, hemisphere: 'north', geographicEpsg: 4326 },
    geoTransform: [500000, 2, 0, 3280000, 0, -2],
    elevationDatum: 'wgs84-ellipsoid',
    dem: {
      file: 'dem.tif',
      width: 251,
      height: 251,
      cellSizeMeters: 2,
      minElevationMeters: 3640,
      maxElevationMeters: 3700,
    },
    ortho: {
      file: 'ortho.tif',
      width: 251,
      height: 251,
      cellSizeMeters: 2,
      photometric: 'rgb',
    },
    stats: {
      sourceTriangleCount: 1000,
      sampledCellCount: 63001,
      filledCellCount: 12,
      filledRatio: 0.0002,
      warnings: [],
    },
    ...overrides,
  }
}

function createDemZip(sidecar = createSidecar()): Uint8Array {
  return zipSync({
    'dem.json': new TextEncoder().encode(JSON.stringify(sidecar)),
    'dem.tif': new Uint8Array([1, 2, 3]),
    'ortho.tif': new Uint8Array([4, 5, 6]),
  })
}

test('DEM packs store dem.json plus private raster siblings', () => {
  const archive = parseTerrainPackArchive(createDemZip(), { sourceZipName: 'terrain-dem.zip' })
  const plan = planTerrainPackStorage(archive)

  assert.equal(plan.primaryStoredPath, 'dem.json')
  assert.equal(plan.primarySourcePath, 'dem.json')
  assert.deepEqual(
    plan.entries.map((entry) => [entry.sourcePath, entry.storedPath]),
    [['dem.tif', 'dem.tif'], ['ortho.tif', 'ortho.tif']],
  )
  assert.equal(plan.entries.some((entry) => entry.storedPath.endsWith('.zip')), false)
  const metadata = buildTerrainPackAssetMetadata({ archive, packKey: 'terrain-packs/test' })
  assert.equal(metadata.storageLayout, 'extracted-v2')
  assert.equal(metadata.sidecarFile, 'dem.json')
  assert.equal(metadata.demFile, 'dem.tif')
  assert.equal(metadata.orthoFile, 'ortho.tif')
})

test('DEM sidecar raster paths cannot escape the pack directory', () => {
  const sidecar = createSidecar({
    dem: {
      file: '../dem.tif',
      width: 251,
      height: 251,
      cellSizeMeters: 2,
      minElevationMeters: 3640,
      maxElevationMeters: 3700,
    },
  })

  assert.throws(
    () => parseTerrainPackArchive(createDemZip(sidecar)),
    /相对路径/,
  )
})

test('DEM sidecar referenced ortho must exist in the archive', () => {
  const zip = zipSync({
    'dem.json': new TextEncoder().encode(JSON.stringify(createSidecar())),
    'dem.tif': new Uint8Array([1, 2, 3]),
  })

  assert.throws(
    () => parseTerrainPackArchive(zip),
    /正射栅格不存在/,
  )
})
