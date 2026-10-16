import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  GROUND_NODE_ID,
  type CompiledGroundManifest,
  type GroundDynamicMesh,
  type SceneJsonExportDocument,
  type SceneNode,
} from '@schema/core'
import { syncGroundCollisionRuntimeHost } from '@schema/groundCollisionRuntimeHost'
import {
  buildCompiledGroundPackageFiles,
  buildCompiledGroundPackageFilesAsync,
  resolveAdaptiveRenderChunksPerTile,
  resolveCompiledGroundTileLayout,
  type BuildCompiledGroundAsyncOptions,
} from '@/utils/compiledGroundExport'
import { computeSceneCompiledGroundBuildKey } from '@/utils/sceneCompiledGroundCache'

function createGroundDefinition(params: {
  spanX: number
  spanZ: number
  cellSize: number
  chunkSizeMeters?: number
}): GroundDynamicMesh {
  const { spanX, spanZ, cellSize } = params
  const chunkSizeMeters = params.chunkSizeMeters ?? 100
  const columns = Math.max(1, Math.round(spanX / cellSize))
  const rows = Math.max(1, Math.round(spanZ / cellSize))
  const vertexCount = (rows + 1) * (columns + 1)
  const manualHeightMap = new Float64Array(vertexCount)
  const planningHeightMap = new Float64Array(vertexCount)
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const index = row * (columns + 1) + column
      const height = row * 0.01 + column * 0.02
      manualHeightMap[index] = height
      planningHeightMap[index] = height
    }
  }
  return {
    type: 'Ground',
    terrainMode: 'infinite',
    chunkSizeMeters,
    cellSize,
    baseHeight: 0,
    worldBounds: {
      minX: -spanX * 0.5,
      maxX: spanX * 0.5,
      minZ: -spanZ * 0.5,
      maxZ: spanZ * 0.5,
    },
    manualHeightMap,
    planningHeightMap,
  } as unknown as GroundDynamicMesh
}

function createSceneDocument(definition: GroundDynamicMesh, sceneId = 'test-scene'): SceneJsonExportDocument {
  const groundNode = {
    id: GROUND_NODE_ID,
    name: 'Ground',
    dynamicMesh: definition,
    children: [],
  } as unknown as SceneNode
  return {
    id: sceneId,
    name: 'Test Scene',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    nodes: [groundNode],
  } as unknown as SceneJsonExportDocument
}

describe('resolveAdaptiveRenderChunksPerTile', () => {
  const cases: Array<{ label: string; spanX: number; spanZ: number; cellSize: number; expected: number }> = [
    { label: '5km keeps 100m tiles', spanX: 5000, spanZ: 5000, cellSize: 1, expected: 1 },
    { label: '15km widens to 200m tiles', spanX: 15000, spanZ: 15000, cellSize: 1, expected: 2 },
    { label: '34x39km widens to 400m tiles', spanX: 34280, spanZ: 39080, cellSize: 76.33, expected: 4 },
    { label: '60km widens to 800m tiles', spanX: 60000, spanZ: 60000, cellSize: 40, expected: 8 },
    { label: 'fine 2m grid caps the tile span', spanX: 60000, spanZ: 60000, cellSize: 2, expected: 4 },
  ]

  for (const testCase of cases) {
    it(testCase.label, () => {
      const chunks = resolveAdaptiveRenderChunksPerTile({
        coverageSpanX: testCase.spanX,
        coverageSpanZ: testCase.spanZ,
        chunkSizeMeters: 100,
        cellSizeMeters: testCase.cellSize,
      })
      expect(chunks).toBe(testCase.expected)
    })
  }

  it('stays inside the tile budget whenever the resolution cap allows it', () => {
    const chunks = resolveAdaptiveRenderChunksPerTile({
      coverageSpanX: 34280,
      coverageSpanZ: 39080,
      chunkSizeMeters: 100,
      cellSizeMeters: 76.33,
    })
    const tileSize = 100 * chunks
    const tiles = Math.ceil(34280 / tileSize) * Math.ceil(39080 / tileSize)
    expect(tiles).toBeLessThanOrEqual(10000)
  })
})

describe('resolveCompiledGroundTileLayout', () => {
  it('derives the adaptive layout from a large DEM ground definition', () => {
    const definition = createGroundDefinition({ spanX: 34280, spanZ: 39080, cellSize: 76.33 })
    const layout = resolveCompiledGroundTileLayout(definition)
    expect(layout.renderChunksPerTile).toBe(4)
    expect(layout.renderTileSizeMeters).toBe(400)
    expect(layout.chunkSizeMeters).toBe(100)
  })

  it('honours an explicit renderChunksPerTile override', () => {
    const definition = createGroundDefinition({ spanX: 34280, spanZ: 39080, cellSize: 76.33 })
    const layout = resolveCompiledGroundTileLayout(definition, { renderChunksPerTile: 1 })
    expect(layout.renderChunksPerTile).toBe(1)
    expect(layout.renderTileSizeMeters).toBe(100)
  })
})

describe('computeSceneCompiledGroundBuildKey', () => {
  it('encodes the resolved adaptive tile granularity', () => {
    const large = createGroundDefinition({ spanX: 34280, spanZ: 39080, cellSize: 76.33 })
    const small = createGroundDefinition({ spanX: 2000, spanZ: 2000, cellSize: 2 })
    const largeKey = computeSceneCompiledGroundBuildKey('scene-a', large, 'scene-a-terrain-dem')
    const smallKey = computeSceneCompiledGroundBuildKey('scene-a', small, 'scene-a-terrain-dem')
    expect(largeKey).toContain('renderChunks:4')
    expect(smallKey).toContain('renderChunks:1')
    expect(largeKey).toContain('chunk:100')
    expect(largeKey).toContain('cell:76.33')
    expect(smallKey).toContain('cell:2')
    expect(largeKey).not.toBe(smallKey)
    expect(largeKey).toContain('scene-profile:3')
  })
})

describe('compiled ground collision tiles', () => {
  it('skips collision tiles by default and keeps render tiles unchanged', () => {
    const definition = createGroundDefinition({ spanX: 600, spanZ: 600, cellSize: 4 })
    const document = createSceneDocument(definition)

    const defaultBuild = buildCompiledGroundPackageFiles(document)
    expect(defaultBuild).not.toBeNull()
    expect(defaultBuild!.manifest.collisionTiles).toEqual([])
    expect(Object.keys(defaultBuild!.files).some((path) => path.includes('/collision/'))).toBe(false)

    const withCollision = buildCompiledGroundPackageFiles(document, { includeCollisionTiles: true })
    expect(withCollision).not.toBeNull()
    expect(withCollision!.manifest.collisionTiles.length).toBeGreaterThan(0)
    expect(Object.keys(withCollision!.files).some((path) => path.includes('/collision/'))).toBe(true)

    // Render output must be identical whether or not collision tiles exist.
    expect(JSON.stringify(withCollision!.manifest.renderTiles)).toBe(JSON.stringify(defaultBuild!.manifest.renderTiles))
    const renderPaths = Object.keys(defaultBuild!.files)
    expect(renderPaths.length).toBeGreaterThan(0)
    for (const path of renderPaths) {
      expect(Array.from(withCollision!.files[path]!)).toEqual(Array.from(defaultBuild!.files[path]!))
    }
  })

  it('is deterministic across repeated builds', () => {
    const definition = createGroundDefinition({ spanX: 600, spanZ: 600, cellSize: 4 })
    const document = createSceneDocument(definition)
    const first = buildCompiledGroundPackageFiles(document)
    const second = buildCompiledGroundPackageFiles(document)
    expect(JSON.stringify(second!.manifest)).toBe(JSON.stringify(first!.manifest))
    for (const path of Object.keys(first!.files)) {
      expect(Array.from(second!.files[path]!)).toEqual(Array.from(first!.files[path]!))
    }
  })

  it('applies the collision switch on the async (main-thread) path too', async () => {
    const definition = createGroundDefinition({ spanX: 400, spanZ: 400, cellSize: 4 })
    const document = createSceneDocument(definition)
    const options: BuildCompiledGroundAsyncOptions = { workerCount: 0, yieldEveryTiles: 256 }
    const defaultBuild = await buildCompiledGroundPackageFilesAsync(document, options)
    expect(defaultBuild).not.toBeNull()
    expect(defaultBuild!.manifest.collisionTiles).toEqual([])

    const withCollision = await buildCompiledGroundPackageFilesAsync(document, {
      ...options,
      includeCollisionTiles: true,
    })
    expect(withCollision!.manifest.collisionTiles.length).toBeGreaterThan(0)
  })
})

describe('ground collision runtime fallback', () => {
  it('enables dynamic infinite chunk collision when no collision tiles exist', () => {
    const definition = createGroundDefinition({ spanX: 600, spanZ: 600, cellSize: 4 })
    const document = createSceneDocument(definition)
    const built = buildCompiledGroundPackageFiles(document)
    expect(built!.manifest.collisionTiles).toEqual([])

    const groundObject = new THREE.Object3D()
    groundObject.updateMatrixWorld(true)
    const snapshot = syncGroundCollisionRuntimeHost({
      enabled: true,
      sourceId: 'test-ground',
      groundObject,
      groundMesh: definition as never,
      referenceWorldPositions: [new THREE.Vector3(0, 0, 0)],
      compiledManifest: built!.manifest as CompiledGroundManifest,
      loadCompiledTileData: async () => null,
      runtimeDeps: {
        getPhysicsWorld: () => null,
        ensurePhysicsWorld: () => ({} as never),
        createBody: () => null,
      },
    })

    expect(snapshot.compiledTileKeys).toEqual([])
    expect(snapshot.infiniteChunkKeys.length).toBeGreaterThan(0)

    syncGroundCollisionRuntimeHost({
      enabled: false,
      sourceId: 'test-ground',
      groundObject,
      groundMesh: null,
      referenceWorldPositions: null,
      compiledManifest: null,
    })
  })
})
