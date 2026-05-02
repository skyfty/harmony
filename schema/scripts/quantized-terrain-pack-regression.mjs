import assert from 'node:assert/strict'
import {
  QUANTIZED_TERRAIN_PACK_FORMAT,
  QUANTIZED_TERRAIN_PACK_VERSION,
  deserializeQuantizedTerrainPack,
  readQuantizedTerrainPackEntry,
  serializeQuantizedTerrainPack,
} from '../dist/index.js'

const tileA = Uint8Array.from([1, 2, 3, 4]).buffer
const tileB = Uint8Array.from([5, 6, 7]).buffer

const pack = {
  header: {
    format: QUANTIZED_TERRAIN_PACK_FORMAT,
    version: QUANTIZED_TERRAIN_PACK_VERSION,
    datasetId: 'dataset-demo',
    regionKey: 'r/5/10/12',
    tileCount: 0,
    entries: [],
  },
  entries: {
    '6/20/24': tileA,
    '6/21/24': tileB,
  },
}

const serialized = serializeQuantizedTerrainPack(pack)
assert.ok(serialized.byteLength > 0, 'serialized pack should not be empty')

const decoded = deserializeQuantizedTerrainPack(serialized)
assert.ok(decoded, 'serialized pack should decode')
assert.equal(decoded.header.datasetId, 'dataset-demo')
assert.equal(decoded.header.regionKey, 'r/5/10/12')
assert.equal(decoded.header.tileCount, 2)
assert.deepEqual(decoded.header.entries.map((entry) => entry.tileKey), ['6/20/24', '6/21/24'])

assert.deepEqual(Array.from(new Uint8Array(readQuantizedTerrainPackEntry(decoded, '6/20/24') ?? new ArrayBuffer(0))), [1, 2, 3, 4])
assert.deepEqual(Array.from(new Uint8Array(readQuantizedTerrainPackEntry(decoded, '6/21/24') ?? new ArrayBuffer(0))), [5, 6, 7])
assert.equal(readQuantizedTerrainPackEntry(decoded, '6/20/25'), null)

console.log('quantized terrain pack regression passed')
