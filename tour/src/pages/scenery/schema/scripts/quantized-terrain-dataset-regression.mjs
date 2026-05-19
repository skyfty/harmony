import assert from 'node:assert/strict'
import {
  QUANTIZED_TERRAIN_DATASET_FORMAT,
  QUANTIZED_TERRAIN_DATASET_VERSION,
  buildQuantizedTerrainRegionPackPath,
  buildQuantizedTerrainRootManifestPath,
  formatQuantizedTerrainRegionKey,
  formatQuantizedTerrainTileKey,
  getQuantizedTerrainChildMask,
  getQuantizedTerrainChildTileIds,
  getQuantizedTerrainParentTileId,
  parseQuantizedTerrainRegionKey,
  parseQuantizedTerrainTileKey,
  resolveQuantizedTerrainRegionIdForTile,
  resolveQuantizedTerrainTileBounds,
  resolveQuantizedTerrainTileSpanMeters,
} from '../dist/index.js'

assert.equal(QUANTIZED_TERRAIN_DATASET_FORMAT, 'harmony-quantized-terrain-dataset')
assert.equal(QUANTIZED_TERRAIN_DATASET_VERSION, 1)

const tileKey = formatQuantizedTerrainTileKey(6, 21, 9)
assert.equal(tileKey, '6/21/9')
assert.deepEqual(parseQuantizedTerrainTileKey(tileKey), { level: 6, x: 21, y: 9 })
assert.equal(parseQuantizedTerrainTileKey('invalid'), null)

const regionKey = formatQuantizedTerrainRegionKey(4, 3, 1)
assert.equal(regionKey, 'r/4/3/1')
assert.deepEqual(parseQuantizedTerrainRegionKey(regionKey), { level: 4, x: 3, y: 1 })
assert.equal(parseQuantizedTerrainRegionKey('r/4/3'), null)

const parent = getQuantizedTerrainParentTileId({ level: 6, x: 21, y: 9 })
assert.deepEqual(parent, { level: 5, x: 10, y: 4 })
const children = getQuantizedTerrainChildTileIds({ level: 5, x: 10, y: 4 })
assert.deepEqual(children, [
  { level: 6, x: 20, y: 8 },
  { level: 6, x: 21, y: 8 },
  { level: 6, x: 20, y: 9 },
  { level: 6, x: 21, y: 9 },
])
const childMask = getQuantizedTerrainChildMask(children, [
  formatQuantizedTerrainTileKey(6, 20, 8),
  formatQuantizedTerrainTileKey(6, 21, 9),
])
assert.equal(childMask, 0b1001)

const bounds = resolveQuantizedTerrainTileBounds(
  { level: 2, x: 1, y: 3 },
  { minX: -1000, maxX: 3000, minZ: -2000, maxZ: 2000 },
  12,
  87,
)
assert.deepEqual(bounds, {
  minX: 0,
  maxX: 1000,
  minY: 12,
  maxY: 87,
  minZ: 1000,
  maxZ: 2000,
})
assert.equal(resolveQuantizedTerrainTileSpanMeters(2, 4000), 1000)

const regionId = resolveQuantizedTerrainRegionIdForTile({ level: 8, x: 211, y: 154 }, 5)
assert.deepEqual(regionId, { level: 5, x: 26, y: 19 })
assert.equal(buildQuantizedTerrainRegionPackPath(regionId), 'terrain/regions/l5_x26_y19.terrainpack')
assert.equal(buildQuantizedTerrainRootManifestPath(), 'terrain/root.json')

console.log('quantized terrain dataset regression passed')
