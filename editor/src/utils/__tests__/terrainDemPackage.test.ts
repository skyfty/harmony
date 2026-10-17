import { describe, expect, it } from 'vitest'
import {
  parseTerrainDemSidecarJson,
  verifyTerrainDemPackageImport,
} from '@/utils/terrainDemPackage'

function createSidecar() {
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
    ortho: null,
    stats: {
      sourceTriangleCount: 1000,
      sampledCellCount: 63001,
      filledCellCount: 12,
      filledRatio: 0.0002,
      warnings: [],
    },
  }
}

describe('terrain DEM metadata asset reader', () => {
  it('parses dem.json and validates the downloaded GeoTIFF dimensions and pixel size', () => {
    const sidecar = parseTerrainDemSidecarJson(
      new TextEncoder().encode(JSON.stringify(createSidecar())),
    )

    expect(sidecar.dem.file).toBe('dem.tif')
    expect(() => verifyTerrainDemPackageImport(sidecar, {
      width: 251,
      height: 251,
      sampleStepMeters: 2,
    })).not.toThrow()
    expect(() => verifyTerrainDemPackageImport(sidecar, {
      width: 250,
      height: 251,
      sampleStepMeters: 2,
    })).toThrow(/251×251/)
    expect(() => verifyTerrainDemPackageImport(sidecar, {
      width: 251,
      height: 251,
      sampleStepMeters: 3,
    })).toThrow(/像素间距/)
  })

  it('rejects invalid JSON', () => {
    expect(() => parseTerrainDemSidecarJson(new TextEncoder().encode('{'))).toThrow(/不是有效的 JSON/)
  })
})
