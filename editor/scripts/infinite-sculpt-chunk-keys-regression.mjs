import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const viewportFilePath = path.resolve(process.cwd(), 'src/components/editor/SceneViewport.vue')
const groundEditorFilePath = path.resolve(process.cwd(), 'src/components/editor/GroundEditor.ts')

const viewportSource = fs.readFileSync(viewportFilePath, 'utf8')
const groundEditorSource = fs.readFileSync(groundEditorFilePath, 'utf8')

const persistMatch = viewportSource.match(/async function persistViewportInfiniteGroundChunks\(params:[\s\S]*?\n}\n/)
assert.ok(persistMatch, 'persistViewportInfiniteGroundChunks should exist in SceneViewport.vue')

const persistFunctionBody = persistMatch[0]
assert.match(
  persistFunctionBody,
  /const chunkKeys = Array\.isArray\(params\.chunkKeys\) && params\.chunkKeys\.length > 0[\s\S]*:\s*collectViewportGroundChunkKeysFromRegion\(params\.definition, params\.affectedRegion, params\.chunkCells\)/,
  'Infinite ground chunk persistence should prefer explicit chunkKeys before falling back to affectedRegion-derived keys',
)
assert.match(
  persistFunctionBody,
  /Array\.from\(new Set\(params\.chunkKeys\.map\(\(value\) => \(typeof value === 'string' \? value\.trim\(\) : ''\)\)\.filter\(Boolean\)\)\)/,
  'Infinite ground chunk persistence should normalize and deduplicate explicit chunk keys before saving chunks',
)

const commitMatch = groundEditorSource.match(/function commitSculptSession\(selectedNode: SceneNode \| null\): boolean {[\s\S]*?\n\t}\n/)
assert.ok(commitMatch, 'commitSculptSession should exist in GroundEditor.ts')

const commitFunctionBody = commitMatch[0]
assert.match(
  commitFunctionBody,
  /const chunkKeys = sculptSessionState\.touchedChunkKeys\.size[\s\S]*Array\.from\(sculptSessionState\.touchedChunkKeys\)/,
  'GroundEditor sculpt commits should emit explicit touched chunk keys when the session tracked any',
)
assert.match(
  commitFunctionBody,
  /options\.onSculptCommitApplied\?\.\([\s\S]*chunkKeys,[\s\S]*chunkCells:/,
  'GroundEditor sculpt commits should pass chunkKeys into onSculptCommitApplied payloads',
)

assert.match(
  groundEditorSource,
  /updateGroundMeshRegion\(session\.groundObject, session\.definition, region, \{ touchedChunkKeys \}\)/,
  'Polygon sculpt refresh should update chunk geometry using touchedChunkKeys in infinite mode',
)
assert.match(
  groundEditorSource,
  /updateGroundMeshRegion\(groundObject, definition, mergedRegion, \{ touchedChunkKeys \}\)/,
  'Brush sculpt refresh should update chunk geometry using touchedChunkKeys in infinite mode',
)
assert.match(
  groundEditorSource,
  /stitchGroundChunkNormals\(session\.groundObject, session\.definition, padded, touchedChunkKeys\)/,
  'Polygon sculpt normal stitching should use touchedChunkKeys to stitch the affected infinite chunks',
)
assert.match(
  groundEditorSource,
  /stitchGroundChunkNormals\(groundObject, definition, padded, touchedChunkKeys\)/,
  'Brush sculpt normal stitching should use touchedChunkKeys to stitch the affected infinite chunks',
)

console.log('infinite-sculpt-chunk-keys regression checks passed')