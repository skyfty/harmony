import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const filePath = path.resolve(process.cwd(), 'src/utils/landformGroundBake.ts')
const source = fs.readFileSync(filePath, 'utf8')

assert.match(
  source,
  /function resolveChunkKey\(chunkRow: number, chunkColumn: number\): string \{\s*return formatGroundChunkKey\(chunkColumn, chunkRow\)\s*\}/,
  'landform ground bake should write chunk keys using chunkX:chunkZ ordering',
)

assert.match(
  source,
  /function parseChunkKey\(chunkKey: string\): \{ chunkRow: number; chunkColumn: number \} \| null \{[\s\S]*const coord = parseGroundChunkKey\(chunkKey\)[\s\S]*chunkRow: coord\.chunkZ,[\s\S]*chunkColumn: coord\.chunkX,[\s\S]*\}/,
  'landform ground bake should read chunk keys back using schema chunkX:chunkZ semantics',
)

assert.match(
  source,
  /affectedChunkKeys\.add\(resolveChunkKey\(chunkRow, chunkColumn\)\)/,
  'affected landform bake chunk collection should continue deriving keys from chunk row/column coordinates',
)

console.log('landform-ground-bake chunk key regression checks passed')
