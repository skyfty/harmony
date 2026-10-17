import { createDemHeightfield, sampleDemGridHeight, type DemTerrainGrid } from './demTerrain'
import { latLonToUtm } from './utm'
import { createTerrainBounds } from './terrainBounds'
import { createTerrainGridSurface, sampleRoadCrossSection } from './terrainSurface'
import { createTerrainGridMeshBuilder } from '../lab/terrainGridMesh'
import type { SelfCheckResult } from './selfCheck'

function makeSyntheticGrid(): DemTerrainGrid {
  return {
    cols: 3,
    rows: 3,
    cellSizeX: 1,
    cellSizeZ: 1,
    bounds: createTerrainBounds(-1, -1, 1, 1),
    heights: new Float32Array([
      5, 5, 5,
      5, 5, 5,
      5, 5, 5,
    ]),
    minHeight: 5,
    maxHeight: 5,
    peakX: 0,
    peakZ: 1,
    waterLevel: -10,
    detailEnabled: false,
    detailAmplitude: 0,
    detailWavelength: 96,
    sourceMinElevation: 5,
    sourceMaxElevation: 5,
    sourceWidth: 3,
    sourceHeight: 3,
    sourceCellSize: 1,
    anchor: { latitudeDegrees: 0, longitudeDegrees: 0, groundElevationMeters: 5 },
    warnings: [],
  }
}

export function runDemTerrainChecks(): SelfCheckResult[] {
  const results: SelfCheckResult[] = []
  const record = (name: string, ok: boolean, detail = ''): void => {
    results.push({ name, ok, detail })
    console.assert(ok, `[slowroads-lab dem-check] ${name}${detail ? ` — ${detail}` : ''}`)
  }

  const utm = latLonToUtm(29.6439555556, 91.1158416667, 46)
  record(
    'WGS84 anchor -> UTM 46N',
    Math.abs(utm.easting - 317615.194) < 1
      && Math.abs(utm.northing - 3280817.401) < 1
      && utm.epsg === 32646,
    `E=${utm.easting.toFixed(2)} N=${utm.northing.toFixed(2)} EPSG=${utm.epsg}`,
  )

  const grid = makeSyntheticGrid()
  const field = createDemHeightfield(grid)
  record('DEM heightfield bilinear sample', Math.abs(field.sampleHeight(0, 0) - 5) < 1e-6)
  record('DEM heightfield flat normal', Math.abs(field.sampleNormal(0, 0).y - 1) < 1e-6)
  record('DEM heightfield flat slope', field.sampleSlope(0, 0) === 0)
  record(
    'DEM heightfield bounds',
    field.bounds.minX === -1 && field.bounds.maxX === 1
      && field.bounds.minZ === -1 && field.bounds.maxZ === 1,
  )
  record('DEM grid exact sample', Math.abs(sampleDemGridHeight(grid, 1, 1) - 5) < 1e-6)

  const envelopeSurface = createTerrainGridSurface({
    cols: 3,
    rows: 3,
    minX: -1,
    minZ: -1,
    cellSizeX: 1,
    cellSizeZ: 1,
    heights: new Float32Array([
      0, 0, 0,
      0, 8, 0,
      0, 0, 0,
    ]),
  })
  record('terrain surface exact peak', Math.abs(envelopeSurface.heightAt(0, 0) - 8) < 1e-6)
  record('terrain surface envelope peak', envelopeSurface.maxHeightAt(0, 0, 1) >= 8 - 1e-6)
  const crossSection = sampleRoadCrossSection(
    envelopeSurface,
    { x: 0, z: 0, heading: 0 },
    1,
    { columnCount: 3, envelopeRadius: 1 },
  )
  record(
    'road cross-section uses surface envelope',
    crossSection.columns.length === 3 && Math.max(...crossSection.columns) >= 8 - 1e-6,
  )

  const builder = createTerrainGridMeshBuilder(grid, { sampleStep: 1 })
  while (!builder.step(1000)) {
    // The synthetic grid is tiny; a single oversized budget finishes it.
  }
  record(
    'DEM rectangular mesh counts',
    builder.vertexCount === 9 && builder.triangleCount === 8,
    `vertices=${builder.vertexCount} triangles=${builder.triangleCount}`,
  )
  record(
    'DEM rectangular mesh geometry',
    builder.geometry?.getAttribute('position').count === 9
      && builder.geometry?.getIndex()?.count === 24,
  )

  return results
}
