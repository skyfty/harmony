import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const importFilePath = path.resolve(process.cwd(), 'src/utils/planningDemImport.ts')
const importSource = fs.readFileSync(importFilePath, 'utf8')

assert.match(
	importSource,
	/export const PLANNING_PNG_HEIGHTMAP_CONTRACT = \{[\s\S]*seaLevelGray: 32,[\s\S]*metersPerGray: 20,[\s\S]*minElevation: -640,[\s\S]*maxElevation: 4460,[\s\S]*\} as const/,
	'planningDemImport should expose the fixed Harmony PNG DEM contract constants',
)
assert.match(
	importSource,
	/return \(normalizedGrayValue - PLANNING_PNG_HEIGHTMAP_CONTRACT\.seaLevelGray\) \* PLANNING_PNG_HEIGHTMAP_CONTRACT\.metersPerGray/,
	'planningDemImport should decode PNG elevation from the fixed sea-level gray and meters-per-gray contract',
)
assert.match(
	importSource,
	/if \(width < 2 \|\| height < 2\)[\s\S]*const rasterData = new Float32Array\(width \* height\)/,
	'planningDemImport should treat the full PNG as terrain data and require at least a 2x2 image',
)
assert.match(
	importSource,
	/rasterData\[index\] = decodePlanningPngHeightmapElevation\(red\)/,
	'planningDemImport should decode every terrain pixel with the fixed PNG DEM contract',
)
assert.match(
	importSource,
	/height,[\s\S]*minElevation: PLANNING_PNG_HEIGHTMAP_CONTRACT\.minElevation,[\s\S]*maxElevation: PLANNING_PNG_HEIGHTMAP_CONTRACT\.maxElevation/,
	'planningDemImport should publish raw terrain dimensions and contract-derived elevation bounds',
)

const dialogFilePath = path.resolve(process.cwd(), 'src/components/layout/PlanningDialog.vue')
const dialogSource = fs.readFileSync(dialogFilePath, 'utf8')

assert.match(
	dialogSource,
	/const planningPngHeightmapProtocolHint = `Harmony PNG DEM protocol: gray \$\{PLANNING_PNG_HEIGHTMAP_CONTRACT\.seaLevelGray\} = 0m, \$\{PLANNING_PNG_HEIGHTMAP_CONTRACT\.metersPerGray\}m per gray, valid range \$\{PLANNING_PNG_HEIGHTMAP_CONTRACT\.minElevation\}m to \$\{PLANNING_PNG_HEIGHTMAP_CONTRACT\.maxElevation\}m\.`/,
	'PlanningDialog should explain the fixed Harmony PNG DEM protocol to users',
)
assert.doesNotMatch(
	dialogSource,
	/selectedDemMinElevationModel|selectedDemMaxElevationModel/,
	'PlanningDialog should no longer expose editable PNG min/max elevation controls',
)

console.log('planning-dem-png-contract regression checks passed')
