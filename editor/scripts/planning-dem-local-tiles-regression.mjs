import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const filePath = path.resolve(process.cwd(), 'src/utils/planningDemToGround.ts')
const source = fs.readFileSync(filePath, 'utf8')

const tileFunctionMatch = source.match(/export async function buildPlanningDemGroundTileData\([\s\S]*?return \{([\s\S]*?)\n\}/)
assert.ok(tileFunctionMatch, 'buildPlanningDemGroundTileData should exist in planningDemToGround.ts')

const functionBody = tileFunctionMatch[0]
assert.match(
  functionBody,
  /const region = buildPlanningDemTileHeightRegion\(/,
  'DEM tile conversion should compute a bounded tile region before generating local edit tiles',
)
assert.match(
  functionBody,
  /startRow:\s*region\.startRow[\s\S]*endRow:\s*region\.endRow[\s\S]*startColumn:\s*region\.startColumn[\s\S]*endColumn:\s*region\.endColumn/,
  'DEM tile conversion should scope local edit tile generation to the requested tile region',
)
assert.doesNotMatch(
  functionBody,
  /startRow:\s*0[\s\S]*endRow:\s*Math\.max\(1, Math\.trunc\(options\.definition\.rows\)\)[\s\S]*startColumn:\s*0[\s\S]*endColumn:\s*Math\.max\(1, Math\.trunc\(options\.definition\.columns\)\)/,
  'DEM tile conversion should not generate local edit tiles for the full ground in the tile-specific path',
)

console.log('planning-dem-local-tiles regression checks passed')