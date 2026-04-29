import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const importFilePath = path.resolve(process.cwd(), 'src/utils/planningDemImport.ts')
const importSource = fs.readFileSync(importFilePath, 'utf8')

assert.match(
  importSource,
  /const resolution = normalizeResolution\(typeof image\.getResolution === 'function' \? image\.getResolution\(\) : null\)/,
  'planningDemImport should read GeoTIFF resolution metadata when available',
)
assert.match(
  importSource,
  /const geographic = isGeographicCoordinateSpace\(bbox, geoKeys\)/,
  'planningDemImport should distinguish geographic and projected DEM sources',
)
assert.match(
  importSource,
  /const widthSegments = Math\.max\(1, width - 1\)[\s\S]*const heightSegments = Math\.max\(1, height - 1\)/,
  'planningDemImport should compute DEM sample steps from raster segments rather than raw sample counts',
)

const toGroundFilePath = path.resolve(process.cwd(), 'src/utils/planningDemToGround.ts')
const toGroundSource = fs.readFileSync(toGroundFilePath, 'utf8')

assert.match(
  toGroundSource,
  /function resolvePlanningDemLocalEditTileOrigin\(definition: GroundRuntimeDynamicMesh\): \{ originX: number; originZ: number \} \{[\s\S]*definition\.terrainMode === 'infinite'[\s\S]*originX: 0, originZ: 0/,
  'planningDemToGround should align infinite DEM local-edit tiles to the runtime local-edit origin',
)
assert.match(
  toGroundSource,
  /const segments = Math\.max\(1, \(axis === 'x' \? parsedWidth : parsedHeight\) - 1\)/,
  'planningDemToGround should derive source sample step from raster segments to avoid off-by-one shrinkage',
)

console.log('planning-dem-metric-space regression checks passed')