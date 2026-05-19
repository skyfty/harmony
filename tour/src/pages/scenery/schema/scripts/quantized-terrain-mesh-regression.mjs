import assert from 'node:assert/strict'
import {
  QUANTIZED_TERRAIN_MESH_FORMAT,
  QUANTIZED_TERRAIN_MESH_VERSION,
  decodeQuantizedTerrainMeshGeometry,
  deserializeQuantizedTerrainMesh,
  quantizeTerrainAxis,
  quantizeTerrainHeight,
  serializeQuantizedTerrainMesh,
} from '../dist/index.js'

const bounds = {
  minX: -50,
  minZ: -50,
  maxX: 50,
  maxZ: 50,
}
const minHeight = 100
const maxHeight = 140

const sourceVertices = [
  { x: -50, z: -50, height: 100 },
  { x: 50, z: -50, height: 110 },
  { x: -50, z: 50, height: 130 },
  { x: 50, z: 50, height: 140 },
]

const tile = {
  header: {
    format: QUANTIZED_TERRAIN_MESH_FORMAT,
    version: QUANTIZED_TERRAIN_MESH_VERSION,
    tileId: { level: 0, x: 0, y: 0 },
    bounds,
    center: { x: 0, y: 120, z: 0 },
    minHeight,
    maxHeight,
    boundingSphere: {
      center: { x: 0, y: 120, z: 0 },
      radius: 80,
    },
    horizonOcclusionPoint: null,
    geometricError: 50,
    skirtHeight: 5,
    vertexCount: 0,
    triangleCount: 0,
    hasVertexNormals: false,
    extensions: [],
  },
  u: Uint16Array.from(sourceVertices.map((vertex) => quantizeTerrainAxis(vertex.x, bounds.minX, bounds.maxX))),
  v: Uint16Array.from(sourceVertices.map((vertex) => quantizeTerrainAxis(vertex.z, bounds.minZ, bounds.maxZ))),
  height: Uint16Array.from(sourceVertices.map((vertex) => quantizeTerrainHeight(vertex.height, minHeight, maxHeight))),
  // High-water-mark compatible triangle order.
  indices: Uint32Array.from([0, 1, 2, 1, 3, 2]),
  westIndices: Uint32Array.from([0, 2]),
  southIndices: Uint32Array.from([0, 1]),
  eastIndices: Uint32Array.from([1, 3]),
  northIndices: Uint32Array.from([2, 3]),
}

const serialized = serializeQuantizedTerrainMesh(tile)
assert.ok(serialized.byteLength > 0, 'serialized mesh should not be empty')

const decoded = deserializeQuantizedTerrainMesh(serialized)
assert.ok(decoded, 'serialized mesh should decode')
assert.equal(decoded.header.vertexCount, 4)
assert.equal(decoded.header.triangleCount, 2)
assert.deepEqual([...decoded.u], [...tile.u])
assert.deepEqual([...decoded.v], [...tile.v])
assert.deepEqual([...decoded.height], [...tile.height])
assert.deepEqual([...decoded.indices], [...tile.indices])
assert.deepEqual([...decoded.westIndices], [...tile.westIndices])
assert.deepEqual([...decoded.southIndices], [...tile.southIndices])
assert.deepEqual([...decoded.eastIndices], [...tile.eastIndices])
assert.deepEqual([...decoded.northIndices], [...tile.northIndices])

const geometry = decodeQuantizedTerrainMeshGeometry(decoded)
assert.equal(geometry.positions.length, 12)
assert.deepEqual([...geometry.indices], [...tile.indices])

const epsilon = 0.01
for (let index = 0; index < sourceVertices.length; index += 1) {
  const source = sourceVertices[index]
  assert.ok(Math.abs(geometry.positions[index * 3 + 0] - source.x) <= epsilon, 'x should roundtrip')
  assert.ok(Math.abs(geometry.positions[index * 3 + 1] - source.height) <= epsilon, 'height should roundtrip')
  assert.ok(Math.abs(geometry.positions[index * 3 + 2] - source.z) <= epsilon, 'z should roundtrip')
}

console.log('quantized terrain mesh regression passed')
