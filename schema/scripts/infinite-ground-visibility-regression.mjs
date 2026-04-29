import assert from 'node:assert/strict'

import * as THREE from 'three'

import { resolveGroundChunkCoordFromWorldPosition } from '../dist/index.js'
import { resolveVisibleInfiniteGroundChunkManifestRecords } from '../dist/groundChunkManifestRuntime.js'
import { resolveInfiniteGroundVisibleChunkWindow } from '../dist/groundMesh.js'

function createInfiniteGroundDefinition(overrides = {}) {
  return {
    type: 'Ground',
    terrainMode: 'infinite',
    width: 800,
    depth: 800,
    rows: 8,
    columns: 8,
    cellSize: 100,
    chunkSizeMeters: overrides.chunkSizeMeters ?? 100,
    renderRadiusChunks: overrides.renderRadiusChunks ?? 1,
    collisionRadiusChunks: overrides.collisionRadiusChunks ?? 1,
    baseHeight: overrides.baseHeight ?? 0,
    castShadow: false,
    farHorizonEnabled: false,
    manualHeightMap: [],
    planningHeightMap: [],
    planningMetadata: null,
    generation: null,
    localEditTiles: null,
    runtimeLoadedTileKeys: [],
    surfaceRevision: 0,
  }
}

function buildManifestRecords(range) {
  const records = {}
  for (let chunkZ = -range; chunkZ <= range; chunkZ += 1) {
    for (let chunkX = -range; chunkX <= range; chunkX += 1) {
      records[`${chunkX}:${chunkZ}`] = {
        key: `${chunkX}:${chunkZ}`,
        chunkX,
        chunkZ,
        originX: chunkX * 100,
        originZ: chunkZ * 100,
        chunkSizeMeters: 100,
        resolution: 10,
        revision: 1,
        updatedAt: 1,
        byteLength: 0,
      }
    }
  }
  return records
}

function testObliqueCameraExpandsVisibleWindowForward() {
  const groundObject = new THREE.Group()
  const groundDefinition = createInfiniteGroundDefinition()
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5000)
  camera.position.set(0, 180, 260)
  camera.lookAt(new THREE.Vector3(0, 0, -140))
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  groundObject.updateMatrixWorld(true)

  const cameraCoord = resolveGroundChunkCoordFromWorldPosition(camera.position.x, camera.position.z, groundDefinition.chunkSizeMeters)
  const centeredMinChunkZ = cameraCoord.chunkZ - groundDefinition.renderRadiusChunks
  const centeredMaxChunkZ = cameraCoord.chunkZ + groundDefinition.renderRadiusChunks

  const visibleWindow = resolveInfiniteGroundVisibleChunkWindow(groundObject, groundDefinition, camera)
  assert.ok(
    visibleWindow.minChunkZ < centeredMinChunkZ,
    `expected oblique viewport footprint to extend in front of the camera beyond centered square window; got minChunkZ=${visibleWindow.minChunkZ}, centeredMinChunkZ=${centeredMinChunkZ}`,
  )
  assert.ok(
    visibleWindow.maxChunkZ >= centeredMaxChunkZ,
    `expected oblique viewport footprint expansion to keep the original centered coverage behind the camera; got maxChunkZ=${visibleWindow.maxChunkZ}, centeredMaxChunkZ=${centeredMaxChunkZ}`,
  )
}

function testManifestResolverUsesExpandedVisibleWindow() {
  const groundObject = new THREE.Group()
  const groundDefinition = createInfiniteGroundDefinition()
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5000)
  camera.position.set(0, 180, 260)
  camera.lookAt(new THREE.Vector3(0, 0, -140))
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  groundObject.updateMatrixWorld(true)

  const manifestRecords = buildManifestRecords(6)
  const visibleKeys = new Set(
    resolveVisibleInfiniteGroundChunkManifestRecords(groundObject, groundDefinition, camera, manifestRecords)
      .map((record) => record.key),
  )
  assert.ok(
    visibleKeys.has('0:-1'),
    'expected manifest visibility to include forward chunks that fall outside the old camera-centered square window',
  )
}

function testExtremeRenderRadiusIsClamped() {
  const groundObject = new THREE.Group()
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5000)
  camera.position.set(0, 180, 260)
  camera.lookAt(new THREE.Vector3(0, 0, -140))
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  groundObject.updateMatrixWorld(true)

  const cappedDefinition = createInfiniteGroundDefinition({ renderRadiusChunks: 64 })
  const extremeDefinition = createInfiniteGroundDefinition({ renderRadiusChunks: 4096 })

  const cappedWindow = resolveInfiniteGroundVisibleChunkWindow(groundObject, cappedDefinition, camera)
  const extremeWindow = resolveInfiniteGroundVisibleChunkWindow(groundObject, extremeDefinition, camera)

  assert.deepEqual(
    extremeWindow,
    cappedWindow,
    'expected extreme render radii to clamp to the same visible window as the safe upper bound',
  )
}

testObliqueCameraExpandsVisibleWindowForward()
testManifestResolverUsesExpandedVisibleWindow()
testExtremeRenderRadiusIsClamped()

console.log('infinite-ground-visibility regression checks passed')