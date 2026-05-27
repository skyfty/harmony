import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const filePath = path.resolve(process.cwd(), 'groundMesh.ts')
const source = fs.readFileSync(filePath, 'utf8')

assert.match(
  source,
  /function resolveGroundSurfaceSharedKeyFromChunkMeta\([\s\S]*return resolveSharedGroundChunkKeyFromRuntimeKey\(groundChunkKey\(Math\.trunc\(row\), Math\.trunc\(column\)\)\)/,
  'ground mesh should derive baked surface lookup keys from runtime row/column via shared chunk key conversion',
)

assert.match(
  source,
  /const chunkKey = chunkMeta[\s\S]*resolveGroundSurfaceSharedKeyFromChunkMeta\(chunkMeta\.chunkRow, chunkMeta\.chunkColumn\)/,
  'runtime ground chunk materials should convert chunkMeta row/column into shared chunk keys before surface lookup',
)

assert.match(
  source,
  /const hasBakedSurfaceChunk = hasGroundChunkSurfaceTextureData\([\s\S]*resolveSharedGroundChunkKeyFromRuntimeKey\(key\)/,
  'flat chunk selection should check baked surface coverage using shared chunk keys, not runtime row/column keys',
)

assert.match(
  source,
  /const chunkKey = resolveCompiledGroundTileChunkKey\(root\.userData \?\? \{\}, definition, compiledGroundTileKey, mesh\)/,
  'compiled ground tiles should continue resolving shared chunk keys through the compiled ground path',
)

console.log('ground-surface shared key regression checks passed')
