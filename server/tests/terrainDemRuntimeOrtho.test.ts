import assert from 'node:assert/strict'
import test from 'node:test'
import { writeArrayBuffer } from 'geotiff'
import { decodeTerrainDemRuntimeOrthoFile } from '@harmony/schema/terrainDemRuntimeOrtho'
import type { TerrainDemPackageSidecar } from '@harmony/schema/terrainDemPackage'
import { buildTerrainDemRuntimeOrtho } from '../src/services/terrainDemRuntimeOrthoService'

function createSidecar(width: number, height: number): TerrainDemPackageSidecar {
  return {
    version: 1,
    generator: '3dtiles-viewer',
    createdAt: '2026-10-19T00:00:00.000Z',
    anchor: {
      latitudeDegrees: 39.8267,
      longitudeDegrees: 118.42935277777778,
      groundElevationMeters: 83,
    },
    crs: {
      type: 'utm',
      epsg: 32650,
      zone: 50,
      hemisphere: 'north',
      geographicEpsg: 4326,
    },
    geoTransform: [500000, 10, 0, 4400000, 0, -10],
    elevationDatum: 'wgs84-ellipsoid',
    dem: {
      file: 'dem.tif',
      width,
      height,
      cellSizeMeters: 10,
      minElevationMeters: 0,
      maxElevationMeters: 1,
    },
    ortho: {
      file: 'ortho.tif',
      width,
      height,
      cellSizeMeters: 10,
      photometric: 'rgb',
    },
    stats: {
      sourceTriangleCount: 1,
      sampledCellCount: width * height,
      filledCellCount: 0,
      filledRatio: 0,
      warnings: [],
    },
  }
}

function encodeRgbTiff(
  width: number,
  height: number,
  rgb: Uint8Array,
): Uint8Array {
  return new Uint8Array(writeArrayBuffer(rgb, {
    height,
    width,
    ModelPixelScale: [10, 10, 0],
    ModelTiepoint: [0, 0, 0, 500000, 4400000, 0],
    GTModelTypeGeoKey: 1,
    GTRasterTypeGeoKey: 1,
    GeographicTypeGeoKey: 4326,
    GeogCitationGeoKey: 'WGS 84',
    ProjectedCSTypeGeoKey: 32650,
  } as Parameters<typeof writeArrayBuffer>[1]))
}

test('runtime ortho flips north-up rows to south-up texture rows', async () => {
  const width = 2
  const height = 2
  const rgb = new Uint8Array([
    255, 0, 0,
    0, 255, 0,
    0, 0, 255,
    255, 255, 0,
  ])
  const result = await buildTerrainDemRuntimeOrtho({
    orthoBytes: encodeRgbTiff(width, height, rgb),
    sidecar: createSidecar(width, height),
  })
  const decoded = decodeTerrainDemRuntimeOrthoFile(result.bytes)
  assert.equal(decoded.width, 2)
  assert.equal(decoded.height, 2)
  assert.deepEqual(Array.from(decoded.rgb), [
    0, 0, 255,
    255, 255, 0,
    255, 0, 0,
    0, 255, 0,
  ])
})

test('runtime ortho downsamples to the requested maximum size', async () => {
  const width = 4
  const height = 4
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      rgb[offset] = y * 40
      rgb[offset + 1] = x * 40
      rgb[offset + 2] = 10
    }
  }
  const result = await buildTerrainDemRuntimeOrtho({
    orthoBytes: encodeRgbTiff(width, height, rgb),
    sidecar: createSidecar(width, height),
    maxSize: 2,
  })
  const decoded = decodeTerrainDemRuntimeOrthoFile(result.bytes)
  assert.equal(decoded.width, 2)
  assert.equal(decoded.height, 2)
  assert.equal(decoded.rgb[0], 100)
  assert.equal(decoded.rgb[1], 20)
  assert.equal(decoded.rgb[3], 100)
  assert.equal(result.warnings.length, 1)
})

test('runtime ortho expands grayscale samples to RGB', async () => {
  const width = 2
  const height = 1
  const result = await buildTerrainDemRuntimeOrtho({
    orthoBytes: encodeRgbTiff(width, height, new Uint8Array([10, 220])),
    sidecar: createSidecar(width, height),
  })
  const decoded = decodeTerrainDemRuntimeOrthoFile(result.bytes)
  assert.deepEqual(Array.from(decoded.rgb), [10, 10, 10, 220, 220, 220])
})
