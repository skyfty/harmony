import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const filePath = path.resolve(process.cwd(), 'src/utils/landformGroundBake.ts')
const source = fs.readFileSync(filePath, 'utf8')

assert.match(
  source,
  /const chunkSurfaceLayers: GroundSurfaceChunkLayerRef\[] = \[]/,
  'landform ground bake should collect per-chunk surface layer descriptors for shader splat input',
)

assert.match(
  source,
  /baseBlendMode: 'shader-splat-v1'/,
  'landform ground bake should mark baked chunks with shader-splat-v1 mode',
)

assert.match(
  source,
  /surfaceLayers: chunkSurfaceLayers/,
  'landform ground bake should write surface layer descriptors into groundSurfaceChunks',
)

assert.match(
  source,
  /debugBaseTextureOnly\?: boolean/,
  'landform ground bake should expose a base-only diagnostic bake mode',
)

assert.match(
  source,
  /debugBaseTextureOnly === true/,
  'base-only diagnostic bake should skip landform overlay work when enabled',
)

console.log('ground-surface-layer regression checks passed')
