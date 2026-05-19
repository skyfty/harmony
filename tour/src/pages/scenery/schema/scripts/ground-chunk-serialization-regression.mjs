import assert from 'node:assert/strict'
import { serializeGroundChunkData, deserializeGroundChunkData } from '../dist/index.js'

const source = {
  header: {
    version: 1,
    key: '3:-7',
    chunkX: 3,
    chunkZ: -7,
    originX: 128,
    originZ: -256,
    chunkSizeMeters: 32,
    resolution: 3,
    cellSize: 10.6666666667,
    revision: 42,
    heightMin: -1.5,
    heightMax: 9.25,
    updatedAt: 1700000000000,
    source: 'manual',
  },
  heights: Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
}

const encoded = serializeGroundChunkData(source)
assert.ok(encoded instanceof ArrayBuffer, 'serializeGroundChunkData should return an ArrayBuffer')

const decoded = deserializeGroundChunkData(encoded)
assert.ok(decoded, 'deserializeGroundChunkData should round-trip serialized chunk data')
assert.equal(decoded.header.key, source.header.key)
assert.equal(decoded.header.chunkX, source.header.chunkX)
assert.equal(decoded.header.chunkZ, source.header.chunkZ)
assert.equal(decoded.header.resolution, source.header.resolution)
assert.equal(decoded.heights.length, source.heights.length)
assert.deepEqual(Array.from(decoded.heights), Array.from(source.heights))

console.log('ground-chunk-serialization regression checks passed')