/**
 * Unit tests for the Ground-Anchor driven mesh collision streamer.
 *
 * The host used to index the source subtree exactly once. The procedural landscape
 * creates its road band / walls asynchronously (after the terrain grid finished
 * rasterizing) and rebuilds them on road edits, so those meshes never became
 * collidable and characters sank through the visible road. These tests lock the
 * incremental re-index: late meshes appear, unchanged meshes keep their bodies
 * (no churn / no collision gap) and hidden / removed / geometry-swapped meshes
 * lose theirs.
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  MESH_COLLISION_MAX_NEW_CHUNKS_PER_SYNC,
  MESH_COLLISION_MAX_NEW_CHUNKS_PER_SYNC_AFTER_CHANGE,
  clearAllMeshCollisionRuntimeHosts,
  syncMeshCollisionRuntimeHost,
  type MeshCollisionChunkShape,
  type MeshCollisionRuntimeDeps,
  type MeshCollisionRuntimeHostSnapshot,
} from '@schema/meshCollisionRuntimeHost'
import { createRoadBand } from '@schema/proceduralLandscape/roadBand'
import type { RoadTraceNode } from '@schema/proceduralLandscape/roadTrace'

interface CreatedBodyRecord {
  shape: MeshCollisionChunkShape
  object: THREE.Object3D
  body: object
}

interface Harness {
  deps: MeshCollisionRuntimeDeps
  created: CreatedBodyRecord[]
  removed: object[]
}

function createHarness(): Harness {
  const created: CreatedBodyRecord[] = []
  const removed: object[] = []
  const world = {
    gravity: new THREE.Vector3(0, -9.81, 0),
    addBody: () => {},
    removeBody: (body: object) => {
      removed.push(body)
    },
  }
  const deps = {
    getPhysicsWorld: () => world,
    ensurePhysicsWorld: () => world,
    createBody: (shape: MeshCollisionChunkShape, object: THREE.Object3D) => {
      const body = { name: '' }
      created.push({ shape, object, body })
      return { body, orientationAdjustment: null }
    },
  } as unknown as MeshCollisionRuntimeDeps
  return { deps, created, removed }
}

function makeTerrainGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(600, 600, 4, 4)
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

function makeRibbonGeometry(
  length: number,
  width: number,
  height: number,
  segments: number,
): THREE.BufferGeometry {
  const halfLength = length / 2
  const halfWidth = width / 2
  const step = length / segments
  const positions: number[] = []
  const indices: number[] = []
  for (let segment = 0; segment <= segments; segment += 1) {
    const x = -halfLength + segment * step
    positions.push(x, height, -halfWidth, x, height, halfWidth)
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const base = segment * 2
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  return geometry
}

function makeDummyTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, 255]),
    1,
    1,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  texture.needsUpdate = true
  return texture
}

function shapeMaxY(shape: MeshCollisionChunkShape): number {
  let maxY = Number.NEGATIVE_INFINITY
  for (let index = 1; index < shape.vertices.length; index += 3) {
    const value = shape.vertices[index]
    if (typeof value === 'number' && value > maxY) {
      maxY = value
    }
  }
  return maxY
}

/** Chunk shapes whose vertices sit above the terrain plane (y > 2.5) are the "band". */
function isBandRecord(record: CreatedBodyRecord): boolean {
  return shapeMaxY(record.shape) > 2.5
}

function syncOnce(
  harness: Harness,
  sourceObject: THREE.Object3D,
  sourceId: string,
  probes: THREE.Vector3[],
): MeshCollisionRuntimeHostSnapshot {
  sourceObject.updateMatrixWorld(true)
  return syncMeshCollisionRuntimeHost({
    enabled: true,
    sourceId,
    sourceObject,
    referenceWorldPositions: probes,
    runtimeDeps: harness.deps,
  })
}

function drain(
  harness: Harness,
  sourceObject: THREE.Object3D,
  sourceId: string,
  probes: THREE.Vector3[],
  maxIterations = 128,
): MeshCollisionRuntimeHostSnapshot {
  let snapshot = syncOnce(harness, sourceObject, sourceId, probes)
  let iterations = 0
  while ((snapshot.indexing || snapshot.pendingChunkCount > 0) && iterations < maxIterations) {
    snapshot = syncOnce(harness, sourceObject, sourceId, probes)
    iterations += 1
  }
  return snapshot
}

afterEach(() => {
  clearAllMeshCollisionRuntimeHosts()
})

describe('mesh collision runtime host incremental re-index', () => {
  it('indexes a road band that appears after the initial collection', () => {
    const host = new THREE.Group()
    host.add(new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial()))
    const probes = [new THREE.Vector3(0, 0, 0)]
    const harness = createHarness()

    drain(harness, host, 'terrain-node', probes)
    const terrainBodies = harness.created.filter((record) => !isBandRecord(record))
    expect(terrainBodies.length).toBeGreaterThan(0)
    expect(harness.created.filter(isBandRecord)).toHaveLength(0)

    // The procedural landscape creates its road band only once the terrain grid
    // finished rasterizing — long after the initial collision index was built.
    host.add(new THREE.Mesh(makeRibbonGeometry(40, 8, 5, 4), new THREE.MeshBasicMaterial()))
    drain(harness, host, 'terrain-node', probes)

    const bandBodies = harness.created.filter(isBandRecord)
    expect(bandBodies.length).toBeGreaterThan(0)
    expect(shapeMaxY(bandBodies[0]!.shape)).toBeCloseTo(5, 5)
    // Unchanged terrain meshes must not be rebuilt while re-indexing.
    expect(harness.created.filter((record) => !isBandRecord(record))).toHaveLength(terrainBodies.length)
    expect(harness.removed).toHaveLength(0)
  })

  it('does not churn anything when the mesh set is stable', () => {
    const host = new THREE.Group()
    host.add(new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial()))
    host.add(new THREE.Mesh(makeRibbonGeometry(40, 8, 5, 4), new THREE.MeshBasicMaterial()))
    const probes = [new THREE.Vector3(0, 0, 0)]
    const harness = createHarness()
    drain(harness, host, 'terrain-node', probes)

    const createdBefore = harness.created.length
    syncOnce(harness, host, 'terrain-node', probes)
    syncOnce(harness, host, 'terrain-node', probes)
    expect(harness.created).toHaveLength(createdBefore)
    expect(harness.removed).toHaveLength(0)
  })

  it('drops colliders of hidden meshes and restores them when shown again', () => {
    const host = new THREE.Group()
    host.add(new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial()))
    const band = new THREE.Mesh(makeRibbonGeometry(40, 8, 5, 4), new THREE.MeshBasicMaterial())
    host.add(band)
    const probes = [new THREE.Vector3(0, 0, 0)]
    const harness = createHarness()
    drain(harness, host, 'terrain-node', probes)

    const bandBodies = harness.created.filter(isBandRecord).map((record) => record.body)
    expect(bandBodies.length).toBeGreaterThan(0)
    band.visible = false
    drain(harness, host, 'terrain-node', probes)
    for (const body of bandBodies) {
      expect(harness.removed).toContain(body)
    }

    const createdWhileHidden = harness.created.length
    band.visible = true
    drain(harness, host, 'terrain-node', probes)
    expect(harness.created.length).toBeGreaterThan(createdWhileHidden)
    expect(shapeMaxY(harness.created[harness.created.length - 1]!.shape)).toBeCloseTo(5, 5)
  })

  it('retires the chunks of a removed mesh only', () => {
    const host = new THREE.Group()
    host.add(new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial()))
    const band = new THREE.Mesh(makeRibbonGeometry(40, 8, 5, 4), new THREE.MeshBasicMaterial())
    host.add(band)
    const probes = [new THREE.Vector3(0, 0, 0)]
    const harness = createHarness()
    drain(harness, host, 'terrain-node', probes)

    const terrainCreates = harness.created.filter((record) => !isBandRecord(record)).length
    const bandBodies = harness.created.filter(isBandRecord).map((record) => record.body)
    host.remove(band)
    drain(harness, host, 'terrain-node', probes)

    for (const body of bandBodies) {
      expect(harness.removed).toContain(body)
    }
    expect(harness.created.filter((record) => !isBandRecord(record))).toHaveLength(terrainCreates)
  })

  it('rebuilds only the mesh whose geometry was swapped in place', () => {
    const host = new THREE.Group()
    host.add(new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial()))
    const band = new THREE.Mesh(makeRibbonGeometry(40, 8, 5, 4), new THREE.MeshBasicMaterial())
    host.add(band)
    const probes = [new THREE.Vector3(0, 0, 0)]
    const harness = createHarness()
    drain(harness, host, 'terrain-node', probes)

    const terrainCreates = harness.created.filter((record) => !isBandRecord(record)).length
    const oldBandBodies = harness.created.filter(isBandRecord).map((record) => record.body)
    band.geometry = makeRibbonGeometry(40, 8, 9, 4)
    drain(harness, host, 'terrain-node', probes)

    for (const body of oldBandBodies) {
      expect(harness.removed).toContain(body)
    }
    const newBandBodies = harness.created.filter(isBandRecord)
    expect(newBandBodies.length).toBeGreaterThan(0)
    expect(shapeMaxY(newBandBodies[newBandBodies.length - 1]!.shape)).toBeCloseTo(9, 5)
    expect(harness.created.filter((record) => !isBandRecord(record))).toHaveLength(terrainCreates)
  })

  it('never re-indexes on instanced mesh churn (vegetation streaming)', () => {
    const host = new THREE.Group()
    host.add(new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial()))
    const probes = [new THREE.Vector3(0, 0, 0)]
    const harness = createHarness()
    drain(harness, host, 'terrain-node', probes)

    const createdBefore = harness.created.length
    const removedBefore = harness.removed.length
    const instanced = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial(),
      4,
    )
    host.add(instanced)
    syncOnce(harness, host, 'terrain-node', probes)
    host.remove(instanced)
    syncOnce(harness, host, 'terrain-node', probes)

    expect(harness.created).toHaveLength(createdBefore)
    expect(harness.removed).toHaveLength(removedBefore)
  })

  it('raises the creation budget right after the mesh set changed', () => {
    const host = new THREE.Group()
    host.add(new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial()))
    const probes: THREE.Vector3[] = []
    for (let x = -300; x <= 300; x += 100) {
      probes.push(new THREE.Vector3(x, 0, 0))
    }
    const harness = createHarness()
    drain(harness, host, 'terrain-node', probes)

    const createdBefore = harness.created.length
    host.add(new THREE.Mesh(makeRibbonGeometry(600, 8, 5, 24), new THREE.MeshBasicMaterial()))
    const snapshot = syncOnce(harness, host, 'terrain-node', probes)

    const bandBodies = harness.created.slice(createdBefore).filter(isBandRecord)
    expect(snapshot.indexing).toBe(false)
    // The band subdivides into more chunks than the regular per-sync budget would
    // create; the raised budget must drain most of them in the first sync.
    expect(bandBodies.length).toBeGreaterThan(MESH_COLLISION_MAX_NEW_CHUNKS_PER_SYNC)
    expect(bandBodies.length).toBeLessThanOrEqual(MESH_COLLISION_MAX_NEW_CHUNKS_PER_SYNC_AFTER_CHANGE)
    drain(harness, host, 'terrain-node', probes)
    expect(harness.created.filter(isBandRecord).length).toBeGreaterThanOrEqual(12)
  })

  it('keeps the normal per-sync creation budget for the initial index', () => {
    const host = new THREE.Group()
    host.add(new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial()))
    const probes = [new THREE.Vector3(0, 0, 0)]
    const harness = createHarness()

    let createdInFirstReadySync = -1
    let snapshot = syncOnce(harness, host, 'terrain-node', probes)
    for (let iteration = 0; iteration < 64; iteration += 1) {
      if (!snapshot.indexing) {
        createdInFirstReadySync = harness.created.length
        break
      }
      const before = harness.created.length
      snapshot = syncOnce(harness, host, 'terrain-node', probes)
      if (!snapshot.indexing) {
        createdInFirstReadySync = harness.created.length - before
        break
      }
    }
    expect(createdInFirstReadySync).toBeGreaterThan(0)
    expect(createdInFirstReadySync).toBeLessThanOrEqual(MESH_COLLISION_MAX_NEW_CHUNKS_PER_SYNC)
    expect(snapshot.pendingChunkCount).toBeGreaterThan(0)
  })

  it('waits for lazy model placeholders before indexing', () => {
    const host = new THREE.Group()
    host.add(new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial()))
    const placeholder = new THREE.Object3D()
    placeholder.userData.lazyAsset = { placeholder: true, assetId: 'asset-1' }
    host.add(placeholder)
    const probes = [new THREE.Vector3(0, 0, 0)]
    const harness = createHarness()

    const snapshot = syncOnce(harness, host, 'terrain-node', probes)
    expect(snapshot.indexing).toBe(true)
    expect(harness.created).toHaveLength(0)

    host.remove(placeholder)
    drain(harness, host, 'terrain-node', probes)
    expect(harness.created.length).toBeGreaterThan(0)
  })

  it('picks up a real procedural-landscape road band created after the terrain mesh', () => {
    const host = new THREE.Group()
    host.add(new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial()))
    const probes = [new THREE.Vector3(0, 0, 0)]
    const harness = createHarness()
    drain(harness, host, 'terrain-node', probes)
    const terrainCreates = harness.created.length

    const nodes: RoadTraceNode[] = []
    for (let index = 0; index < 12; index += 1) {
      nodes.push({
        x: -60 + index * 10,
        z: 0,
        y: 5,
        heading: 0,
        index,
        lateral: 0,
        longitudinal: 0,
        turn: 0,
        headingDelta: 0,
      })
    }
    const roadBand = createRoadBand({
      nodes,
      halfWidth: 4,
      density: null,
      textures: { base: makeDummyTexture(), overlay: null },
      season: 'spring',
      hostInverse: null,
      lift: 0.3,
    })
    host.add(roadBand.mesh)
    drain(harness, host, 'terrain-node', probes)

    const bandBodies = harness.created.slice(terrainCreates).filter(isBandRecord)
    expect(bandBodies.length).toBeGreaterThan(0)
    expect(shapeMaxY(bandBodies[0]!.shape)).toBeCloseTo(5.3, 4)
    expect(harness.removed).toHaveLength(0)
    roadBand.dispose()
  })
})
