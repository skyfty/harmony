import assert from 'node:assert/strict'

import * as THREE from 'three'

import {
  formatGroundChunkKey,
  resolveGroundChunkOrigin,
  serializeCompiledGroundCollisionTile,
  serializeGroundChunkData,
} from '../dist/index.js'
import {
  clearGroundCollisionRuntimeHost,
  syncGroundCollisionRuntimeHost,
} from '../dist/groundCollisionRuntimeHost.js'

function createPhysicsVector3() {
  return {
    x: 0,
    y: 0,
    z: 0,
    set(x, y, z) {
      this.x = x
      this.y = y
      this.z = z
      return this
    },
  }
}

function createPhysicsBody() {
  return {
    position: createPhysicsVector3(),
    quaternion: {
      x: 0,
      y: 0,
      z: 0,
      w: 1,
      set(x, y, z, w) {
        this.x = x
        this.y = y
        this.z = z
        this.w = w
        return this
      },
    },
    velocity: createPhysicsVector3(),
    angularVelocity: createPhysicsVector3(),
  }
}

function createCompiledGroundManifest() {
  const chunkSizeMeters = 100
  const tileSizeMeters = 100
  const tileKey = '0:0'
  const bounds = {
    minX: -50,
    maxX: 50,
    minY: 0,
    maxY: 10,
    minZ: -50,
    maxZ: 50,
  }
  return {
    version: 1,
    revision: 7,
    sceneId: 'scene:compiled-parity',
    groundNodeId: 'harmony:ground',
    chunkSizeMeters,
    baseHeight: 0,
    renderTileSizeMeters: tileSizeMeters,
    collisionTileSizeMeters: tileSizeMeters,
    coveredChunkBounds: {
      minChunkX: 0,
      maxChunkX: 0,
      minChunkZ: 0,
      maxChunkZ: 0,
    },
    bounds,
    renderTiles: [],
    collisionTiles: [{
      key: tileKey,
      row: 0,
      column: 0,
      centerX: 0,
      centerZ: 0,
      sizeMeters: tileSizeMeters,
      widthMeters: tileSizeMeters,
      depthMeters: tileSizeMeters,
      path: 'compiled/ground/collision/0_0.bin',
      bounds,
      rows: 1,
      columns: 1,
      elementSize: 50,
    }],
  }
}

function createCompiledTileBytes() {
  return serializeCompiledGroundCollisionTile({
    header: {
      version: 1,
      key: '0:0',
      row: 0,
      column: 0,
      bounds: {
        minX: -50,
        maxX: 50,
        minY: 0,
        maxY: 10,
        minZ: -50,
        maxZ: 50,
      },
      rows: 1,
      columns: 1,
      elementSize: 50,
      minHeight: 0,
      maxHeight: 10,
    },
    heights: new Float32Array([
      0, 1,
      2, 3,
    ]),
  })
}

function createGroundChunkBytes(chunkKey, chunkSizeMeters) {
  const coord = chunkKey.split(':').map((value) => Number(value))
  const chunkX = Number.isFinite(coord[0]) ? Math.trunc(coord[0]) : 0
  const chunkZ = Number.isFinite(coord[1]) ? Math.trunc(coord[1]) : 0
  const origin = resolveGroundChunkOrigin({ chunkX, chunkZ }, chunkSizeMeters)
  return serializeGroundChunkData({
    header: {
      version: 1,
      key: formatGroundChunkKey(chunkX, chunkZ),
      chunkX,
      chunkZ,
      originX: origin.x,
      originZ: origin.z,
      chunkSizeMeters,
      resolution: 1,
      cellSize: chunkSizeMeters / 1,
      revision: 1,
      heightMin: 0,
      heightMax: 10,
      updatedAt: 1,
      source: 'runtime',
    },
    heights: new Float32Array([
      0, 1,
      2, 3,
    ]),
  })
}

async function flushAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve))
  await Promise.resolve()
}

async function main() {
  const groundObject = new THREE.Group()
  groundObject.updateMatrixWorld(true)
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000)
  camera.position.set(0, 20, 0)
  camera.lookAt(0, 0, -1)
  camera.updateMatrixWorld(true)

  const chunkSizeMeters = 100
  const manifestRecords = {}
  for (let chunkZ = -2; chunkZ <= 2; chunkZ += 1) {
    for (let chunkX = -2; chunkX <= 2; chunkX += 1) {
      const chunkKey = formatGroundChunkKey(chunkX, chunkZ)
      const origin = resolveGroundChunkOrigin({ chunkX, chunkZ }, chunkSizeMeters)
      manifestRecords[chunkKey] = {
        key: chunkKey,
        chunkX,
        chunkZ,
        originX: origin.x,
        originZ: origin.z,
        chunkSizeMeters,
        resolution: 1,
        revision: 1,
        heightMin: 0,
        heightMax: 10,
        dataPath: `ground/chunks/${chunkKey}.bin`,
        updatedAt: 1,
        source: 'runtime',
      }
    }
  }

  const compiledManifest = createCompiledGroundManifest()
  const compiledBytes = createCompiledTileBytes()
  const groundChunkBytes = new Map(
    Object.keys(manifestRecords).map((key) => [key, createGroundChunkBytes(key, chunkSizeMeters)]),
  )
  const createdBodies = []
  const addedBodies = []
  const removedBodies = []
  const runtimeDeps = {
    getPhysicsWorld: () => ({
      addBody(body) {
        addedBodies.push(body)
      },
      removeBody(body) {
        removedBodies.push(body)
      },
    }),
    ensurePhysicsWorld: () => ({
      addBody(body) {
        addedBodies.push(body)
      },
      removeBody(body) {
        removedBodies.push(body)
      },
    }),
    createBody: (_node, _component, shapeDefinition) => {
      const body = createPhysicsBody()
      createdBodies.push({ body, shapeDefinition })
      return {
        body,
        orientationAdjustment: null,
      }
    },
  }

  const snapshot = syncGroundCollisionRuntimeHost({
    enabled: true,
    sourceId: 'scene:compiled-parity',
    groundObject,
    groundMesh: {
      type: 'Ground',
      terrainMode: 'infinite',
      width: 100,
      depth: 100,
      rows: 1,
      columns: 1,
      cellSize: 100,
      chunkSizeMeters,
      renderRadiusChunks: 1,
      collisionRadiusChunks: 1,
      baseHeight: 0,
      castShadow: false,
      farHorizonEnabled: false,
      manualHeightMap: [],
      planningHeightMap: [],
      planningMetadata: null,
      generation: null,
      localEditTiles: null,
      runtimeLoadedTileKeys: [],
      surfaceRevision: 0,
    },
    camera,
    compiledManifest,
    loadCompiledTileData: async (record) => (record.key === '0:0' ? compiledBytes : null),
    groundChunkManifest: {
      version: 1,
      sceneId: 'scene:compiled-parity',
      chunkSizeMeters,
      baseHeight: 0,
      revision: 11,
      updatedAt: 1,
      chunks: manifestRecords,
    },
    loadGroundChunkData: async (chunkKey) => groundChunkBytes.get(chunkKey)?.slice(0) ?? null,
    runtimeDeps,
  })

  await flushAsyncWork()

  assert.deepEqual(snapshot.compiledTileKeys, ['0:0'], 'compiled collision should activate the covered tile near the vehicle reference')
  assert.ok(
    !snapshot.infiniteChunkKeys.includes('0:0'),
    'infinite collision should exclude chunk keys already covered by compiled ground',
  )
  assert.ok(
    snapshot.infiniteChunkKeys.length > 0,
    'infinite collision should still retain nearby chunk keys outside compiled coverage',
  )

  const compiledBodies = addedBodies.filter((body) => String(body.name ?? '').startsWith('compiled-ground:'))
  const infiniteBodies = addedBodies.filter((body) => String(body.name ?? '').startsWith('infinite-ground:'))
  assert.equal(compiledBodies.length, 1, 'expected exactly one compiled collision body for the compiled tile')
  assert.ok(infiniteBodies.length > 0, 'expected infinite collision bodies to still be generated around the vehicle')
  assert.ok(
    infiniteBodies.every((body) => !String(body.name ?? '').includes(':0:0')),
    'infinite collision should not generate a body for the compiled-covered chunk key 0:0',
  )
  assert.equal(
    createdBodies.filter((entry) => entry.shapeDefinition?.kind === 'heightfield').length,
    addedBodies.length,
    'all generated ground collision bodies should be heightfields in this scenario',
  )

  clearGroundCollisionRuntimeHost(groundObject)
  await flushAsyncWork()

  assert.ok(removedBodies.length >= addedBodies.length, 'clearing the runtime should release the generated bodies')

  console.log('compiled-ground collision parity regression checks passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
