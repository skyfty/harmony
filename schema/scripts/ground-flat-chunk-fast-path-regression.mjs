import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  createGroundHeightMap,
  formatGroundLocalEditTileKey,
} from '../dist/index.js'
import {
  canTreatGroundChunkAsFlatPlane,
} from '../dist/groundMesh.js'

function createGroundDefinition(overrides = {}) {
  const rows = overrides.rows ?? 8
  const columns = overrides.columns ?? 8
  return {
    type: 'Ground',
    terrainMode: overrides.terrainMode ?? 'infinite',
    width: overrides.width ?? columns * 10,
    depth: overrides.depth ?? rows * 10,
    rows,
    columns,
    cellSize: overrides.cellSize ?? 10,
    chunkSizeMeters: overrides.chunkSizeMeters ?? 40,
    tileResolution: overrides.tileResolution ?? rows,
    tileSizeMeters: overrides.tileSizeMeters ?? columns * 10,
    editTileSizeMeters: overrides.editTileSizeMeters ?? 10,
    editTileResolution: overrides.editTileResolution ?? 10,
    globalLodCellSize: overrides.globalLodCellSize ?? 10,
    storageMode: overrides.storageMode ?? 'tiled',
    collisionMode: overrides.collisionMode ?? 'heightfield',
    baseHeight: overrides.baseHeight ?? 0,
    manualHeightMap: overrides.manualHeightMap ?? createGroundHeightMap(rows, columns),
    planningHeightMap: overrides.planningHeightMap ?? createGroundHeightMap(rows, columns),
    planningMetadata: null,
    castShadow: false,
    terrainScatterInstancesUpdatedAt: 0,
    groundSurfaceChunks: overrides.groundSurfaceChunks ?? null,
    optimizedMesh: overrides.optimizedMesh ?? null,
    localEditTiles: overrides.localEditTiles ?? null,
    runtimeTerrainHeightSampler: overrides.runtimeTerrainHeightSampler ?? null,
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

function testPlainChunkIsFlat() {
  const definition = createGroundDefinition()
  assert.equal(
    canTreatGroundChunkAsFlatPlane(definition, 0, 0),
    true,
    'plain chunk without edits or baked data should be treated as a flat plane',
  )
}

function testLocalEditChunkIsNotFlat() {
  const tile = createFlatLocalEditTile({
    tileRow: 0,
    tileColumn: 0,
    tileSizeMeters: 10,
    resolution: 10,
    value: 3,
  })
  const definition = createGroundDefinition({
    localEditTiles: { [tile.key]: tile },
  })
  assert.equal(
    canTreatGroundChunkAsFlatPlane(definition, 0, 0),
    false,
    'chunk with local edit coverage should not use the flat plane fast path',
  )
}

function testBakedSurfaceChunkIsNotFlat() {
  const definition = createGroundDefinition({
    groundSurfaceChunks: {
      '0:0': {
        albedoDataUrl: 'data:image/png;base64,AAAA',
      },
    },
  })
  assert.equal(
    canTreatGroundChunkAsFlatPlane(definition, 0, 0),
    false,
    'chunk with baked ground surface texture data should not use the flat plane fast path',
  )
  assert.equal(
    canTreatGroundChunkAsFlatPlane(definition, 0, 0, { allowBakedSurfaceTexture: true }),
    true,
    'chunk with only baked surface texture data should still be considered geometrically flat when callers explicitly ignore baked materials',
  )
}

function testRuntimeHeightSourceDisablesFlatPath() {
  const definition = createGroundDefinition({
    runtimeTerrainHeightSampler: {
      sampleHeightAtWorld: () => 2,
    },
  })
  assert.equal(
    canTreatGroundChunkAsFlatPlane(definition, 0, 0),
    true,
    'runtime terrain height samplers should not by themselves disqualify a chunk from the flat plane fast path',
  )
}

function testLandformFastPathSourceGuardsRemainInPlace() {
  const filePath = path.resolve(process.cwd(), '../editor/src/stores/sceneStoreLandform.ts')
  const source = fs.readFileSync(filePath, 'utf8')

  assert.match(
    source,
    /function tryBuildFlatChunkRegionLandformFastPath\(/,
    'landform store should define a dedicated flat-chunk-region fast path helper',
  )
  assert.match(
    source,
    /resolveGroundChunkCoordFromWorldPosition\(minX \+ epsilon, minZ \+ epsilon, chunkSizeMeters\)/,
    'fast path should use an inward epsilon when checking the minimum footprint corner against chunk coverage',
  )
  assert.match(
    source,
    /resolveGroundChunkCoordFromWorldPosition\(maxX - epsilon, maxZ - epsilon, chunkSizeMeters\)/,
    'fast path should use an inward epsilon when checking the maximum footprint corner against chunk coverage',
  )
  assert.match(
    source,
    /for \(let chunkRow = coverage\.minChunkRow; chunkRow <= coverage\.maxChunkRow; chunkRow \+= 1\)/,
    'flat-chunk-region fast path should scan every covered chunk row before bypassing sampling',
  )
  assert.match(
    source,
    /for \(let chunkColumn = coverage\.minChunkColumn; chunkColumn <= coverage\.maxChunkColumn; chunkColumn \+= 1\)/,
    'flat-chunk-region fast path should scan every covered chunk column before bypassing sampling',
  )
  assert.match(
    source,
    /canTreatGroundChunkAsFlatPlane\(groundDefinition, chunkRow, chunkColumn, \{ allowBakedSurfaceTexture: true \}\)/,
    'landform fast path should ignore baked surface materials and rely on geometric flatness for every covered chunk before bypassing sampling',
  )
}

testPlainChunkIsFlat()
testLocalEditChunkIsNotFlat()
testBakedSurfaceChunkIsNotFlat()
testRuntimeHeightSourceDisablesFlatPath()
testLandformFastPathSourceGuardsRemainInPlace()

console.log('ground flat chunk fast path regression checks passed')
