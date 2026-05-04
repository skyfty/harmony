import assert from 'node:assert/strict'

import {
  GROUND_HEIGHT_UNSET_VALUE,
  createGroundHeightMap,
  formatGroundLocalEditTileKey,
} from '../dist/index.js'
import {
  analyzeGroundOptimizedMeshUsage,
  createGroundMesh,
  releaseGroundMeshCache,
  sampleGroundHeight,
  sculptGround,
  updateGroundChunks,
} from '../dist/groundMesh.js'

function createGroundDefinition(overrides = {}) {
  const rows = overrides.rows ?? 4
  const columns = overrides.columns ?? 4
  return {
    type: 'Ground',
    terrainMode: overrides.terrainMode ?? 'bounded',
    width: overrides.width ?? columns * 10,
    depth: overrides.depth ?? rows * 10,
    rows,
    columns,
    cellSize: overrides.cellSize ?? 10,
    tileResolution: overrides.tileResolution ?? rows,
    tileSizeMeters: overrides.tileSizeMeters ?? columns * 10,
    editTileSizeMeters: overrides.editTileSizeMeters ?? 10,
    editTileResolution: overrides.editTileResolution ?? 10,
    globalLodCellSize: overrides.globalLodCellSize ?? 10,
    storageMode: overrides.storageMode ?? 'tiled',
    collisionMode: overrides.collisionMode ?? 'heightfield',
    manualHeightMap: overrides.manualHeightMap ?? createGroundHeightMap(rows, columns),
    planningHeightMap: overrides.planningHeightMap ?? createGroundHeightMap(rows, columns),
    planningMetadata: null,
    castShadow: false,
    terrainScatterInstancesUpdatedAt: 0,
    terrainPaint: null,
    groundSurfaceChunks: null,
    optimizedMesh: overrides.optimizedMesh ?? null,
    localEditTiles: overrides.localEditTiles ?? null,
    runtimeHydratedHeightState: overrides.runtimeHydratedHeightState,
    runtimeDisableOptimizedChunks: overrides.runtimeDisableOptimizedChunks,
    runtimeLoadedTileKeys: overrides.runtimeLoadedTileKeys ?? [],
    surfaceRevision: overrides.surfaceRevision ?? 0,
  }
}

function createFlatLocalEditTile({ tileRow, tileColumn, tileSizeMeters, resolution, value }) {
  return {
    key: formatGroundLocalEditTileKey(tileRow, tileColumn),
    tileRow,
    tileColumn,
    tileSizeMeters,
    resolution,
    values: new Array((resolution + 1) * (resolution + 1)).fill(value),
    source: 'manual',
    updatedAt: Date.now(),
  }
}

function testLocalEditTileSampling() {
  const tile = createFlatLocalEditTile({
    tileRow: 0,
    tileColumn: 0,
    tileSizeMeters: 10,
    resolution: 10,
    value: 5,
  })
  const definition = createGroundDefinition({
    terrainMode: 'infinite',
    localEditTiles: { [tile.key]: tile },
  })
  const insideHeight = sampleGroundHeight(definition, 0, 0)
  const outsideHeight = sampleGroundHeight(definition, -19, -19)
  assert.equal(insideHeight, 5, 'sampling inside a local edit tile should return the tile height')
  assert.ok(Math.abs(outsideHeight) < 0.1, 'sampling outside a local edit tile should not use the direct local tile height')
}

function testLocalEditTileEdgeSamplingUsesOnlyRequiredCorners() {
  const resolution = 2
  const values = new Array((resolution + 1) * (resolution + 1)).fill(GROUND_HEIGHT_UNSET_VALUE)
  values[0 * (resolution + 1) + 0] = 2
  values[1 * (resolution + 1) + 0] = 6
  const tile = {
    key: formatGroundLocalEditTileKey(0, 0),
    tileRow: 0,
    tileColumn: 0,
    tileSizeMeters: 10,
    resolution,
    values,
    source: 'manual',
    updatedAt: Date.now(),
  }
  const definition = createGroundDefinition({
    terrainMode: 'infinite',
    localEditTiles: { [tile.key]: tile },
  })
  const sampledHeight = sampleGroundHeight(definition, -5, -2.5)
  assert.equal(sampledHeight, 4, 'sampling on an exact local-edit edge should interpolate only along that edge instead of falling back to the base height')
}

function testSculptWritesLocalEditTiles() {
  const definition = createGroundDefinition({
    rows: 8,
    columns: 8,
    width: 80,
    depth: 80,
    cellSize: 10,
    editTileSizeMeters: 10,
    editTileResolution: 10,
  })
  const changed = sculptGround(definition, {
    point: { x: 5, y: 0, z: 5 },
    radius: 3,
    strength: 1,
    shape: 'circle',
    operation: 'raise',
  })
  assert.equal(changed, true, 'sculpting should modify a fine-edit ground')
  assert.ok(definition.localEditTiles && Object.keys(definition.localEditTiles).length > 0, 'sculpting should create local edit tiles')
  const sampledHeight = sampleGroundHeight(definition, 5, 5)
  assert.ok(sampledHeight > 0, 'sculpted local edit tiles should affect sampled ground height')
  const manualHasFinite = Array.from({ length: definition.manualHeightMap.length }).some((_, index) => Number.isFinite(definition.manualHeightMap[index]))
  assert.equal(manualHasFinite, false, 'fine sculpting should not write coarse manual overrides by default')
}

function testInfiniteSculptWritesWorldSpaceLocalEditTilesOutsideBounds() {
  const definition = createGroundDefinition({
    terrainMode: 'infinite',
    rows: 8,
    columns: 8,
    width: 80,
    depth: 80,
    cellSize: 10,
    editTileSizeMeters: 10,
    editTileResolution: 10,
  })
  const changed = sculptGround(definition, {
    point: { x: -85, y: 0, z: -85 },
    radius: 4,
    strength: 1,
    shape: 'circle',
    operation: 'raise',
  })
  assert.equal(changed, true, 'infinite sculpting should modify terrain outside the old bounded extents')
  const expectedTileKey = formatGroundLocalEditTileKey(-8, -8)
  assert.ok(definition.localEditTiles?.[expectedTileKey], 'infinite sculpting should create a world-space local edit tile with negative coordinates when needed')
  const sampledHeight = sampleGroundHeight(definition, -85, -85)
  assert.ok(sampledHeight > 0, 'infinite sculpting outside the old bounded extents should affect sampled height at the sculpt point')
}

function testLocalEditTilesDoNotGloballyDisableOptimizedMesh() {
  const tile = createFlatLocalEditTile({
    tileRow: 0,
    tileColumn: 0,
    tileSizeMeters: 10,
    resolution: 10,
    value: 2,
  })
  const definition = createGroundDefinition({
    optimizedMesh: {
      chunkCells: 4,
      sourceChunkCells: 4,
      chunkCount: 1,
      sourceVertexCount: 4,
      sourceTriangleCount: 2,
      optimizedVertexCount: 4,
      optimizedTriangleCount: 2,
      chunks: [{
        startRow: 0,
        startColumn: 0,
        rows: 4,
        columns: 4,
        positions: [0, 0, 0, 10, 0, 0, 0, 0, 10, 10, 0, 10],
        uvs: [0, 0, 1, 0, 0, 1, 1, 1],
        indices: [0, 2, 1, 1, 2, 3],
      }],
    },
    localEditTiles: { [tile.key]: tile },
  })
  const usage = analyzeGroundOptimizedMeshUsage(definition)
  assert.equal(usage.canUseOptimizedMesh, true, 'local edit tiles should not globally disable optimized mesh usage')
  assert.equal(usage.reason, 'optimized-ready', 'optimized mesh should remain globally available when only local edit tiles are present')
}

function testLocalEditCoverageIndexDoesNotClampToCentralEightByEightChunks() {
  const localEditTiles = {}
  for (let tileRow = -8; tileRow <= 7; tileRow += 1) {
    for (let tileColumn = -8; tileColumn <= 7; tileColumn += 1) {
      const tile = createFlatLocalEditTile({
        tileRow,
        tileColumn,
        tileSizeMeters: 100,
        resolution: 1,
        value: 1,
      })
      localEditTiles[tile.key] = tile
    }
  }

  const definition = createGroundDefinition({
    terrainMode: 'infinite',
    rows: 8,
    columns: 8,
    cellSize: 10,
    chunkSizeMeters: 100,
    editTileSizeMeters: 100,
    editTileResolution: 1,
    localEditTiles,
  })

  const ground = createGroundMesh(definition)
  updateGroundChunks(ground, definition, null, { budget: null, force: true, minIntervalMs: 0 })
  let independentChunkMeshCount = 0
  ground.traverse((child) => {
    if (child?.isMesh && typeof child.name === 'string' && child.name.startsWith('GroundChunk:')) {
      independentChunkMeshCount += 1
    }
  })
  releaseGroundMeshCache()

  assert.equal(
    independentChunkMeshCount,
    16 * 16,
    'local edit tile coverage should classify all imported DEM chunks, not only the central 8x8 chunk window',
  )
}

testLocalEditTileSampling()
testLocalEditTileEdgeSamplingUsesOnlyRequiredCorners()
testSculptWritesLocalEditTiles()
testInfiniteSculptWritesWorldSpaceLocalEditTilesOutsideBounds()
testLocalEditTilesDoNotGloballyDisableOptimizedMesh()
testLocalEditCoverageIndexDoesNotClampToCentralEightByEightChunks()

console.log('ground-local-edit regression checks passed')
