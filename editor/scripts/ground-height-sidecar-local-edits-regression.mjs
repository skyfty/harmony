import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const filePath = path.resolve(process.cwd(), 'src/utils/groundHeightSidecar.ts')
const source = fs.readFileSync(filePath, 'utf8')

assert.match(
  source,
  /export const GROUND_HEIGHTMAP_SIDECAR_VERSION = 5/,
  'groundHeightSidecar should bump the sidecar version when persisting localEditTiles payloads',
)
assert.match(
  source,
  /type GroundHeightSidecarLayout = \{[\s\S]*localEditTilesByteLength: number[\s\S]*localEditTilesOffset: number/,
  'groundHeightSidecar should track localEditTiles payload offsets in the binary layout',
)
assert.match(
  source,
  /function encodeLocalEditTilesPayload\(localEditTiles: GroundLocalEditTileMap \| null \| undefined\): Uint8Array/,
  'groundHeightSidecar should encode localEditTiles payloads into the sidecar',
)
assert.match(
  source,
  /const LOCAL_EDIT_TILE_SECTION_HEADER_BYTES = 8[\s\S]*const LOCAL_EDIT_TILE_BINARY_HEADER_BYTES = 32/,
  'groundHeightSidecar should use a binary localEditTiles section layout',
)
assert.match(
  source,
  /localEditTiles,\s*\n\s*surfaceRevision:/,
  'groundHeightSidecar should restore localEditTiles from the sidecar payload only',
)
assert.doesNotMatch(
  source,
  /JSON\.(stringify|parse)/,
  'groundHeightSidecar should not use JSON payloads for planning metadata or localEditTiles sidecars',
)

console.log('ground-height-sidecar local edit regression checks passed')