import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const filePath = path.resolve(process.cwd(), 'groundMesh.ts')
const source = fs.readFileSync(filePath, 'utf8')

assert.match(
  source,
  /function resolveInfiniteDenseChunkLoadRadiusChunks\(definition: GroundDynamicMesh\): number \{[\s\S]*runtimeDenseChunkLoadRadiusChunks[\s\S]*return resolveInfiniteRenderRadiusChunks\(definition\)/,
  'dense chunk loading radius should allow a dedicated runtime override before falling back to render radius',
)

assert.match(
  source,
  /const loadRadiusChunks = resolveInfiniteDenseChunkLoadRadiusChunks\(definition\)/,
  'updateGroundChunks should use the dense chunk radius for expensive standalone chunk meshes',
)

assert.match(
  source,
  /const flatLoadRadiusChunks = resolveInfiniteFlatTilingRadiusChunks\(definition\)/,
  'updateGroundChunks should keep a separate buffered radius for flat tiled chunks',
)

console.log('ground-dense-radius regression checks passed')
