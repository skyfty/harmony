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
  /function resolvePlanningDemLocalEditTileOrigin\(definition: GroundRuntimeDynamicMesh\): \{ originX: number; originZ: number \} \{[\s\S]*definition\.terrainMode === 'infinite'[\s\S]*resolveInfiniteGroundGridOriginMeters\(resolvePlanningDemChunkSizeMeters\(\)\)/,
  'planningDemToGround should align infinite DEM local-edit tiles to the centered runtime local-edit origin',
)
assert.match(
  toGroundSource,
  /const segments = Math\.max\(1, \(axis === 'x' \? parsedWidth : parsedHeight\) - 1\)/,
  'planningDemToGround should derive source sample step from raster segments to avoid off-by-one shrinkage',
)
assert.match(
  toGroundSource,
  /return \{\s*minX: -sourceSpan\.widthMeters \* 0\.5,[\s\S]*maxZ: sourceSpan\.depthMeters \* 0\.5,\s*\}/,
  'planningDemToGround should keep DEM target world bounds in source meters centered at the world origin instead of fitting to the ground span',
)
assert.match(
  toGroundSource,
  /function resolvePlanningDemCoveredGridRegion\([\s\S]*overlapMinX = Math\.max\(terrainBounds\.minX, options\.source\.targetWorldBounds\.minX\)[\s\S]*Math\.ceil\(\(overlapMinX - terrainBounds\.minX - epsilon\) \/ cellSize\)[\s\S]*Math\.floor\(\(overlapMaxX - terrainBounds\.minX \+ epsilon\) \/ cellSize\)/,
  'planningDemToGround should clip DEM writes to the actual DEM-covered overlap region instead of stretching across the full ground span',
)

console.log('planning-dem-metric-space regression checks passed')