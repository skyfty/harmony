/**
 * Unit tests for the Ground-Anchor driven mesh collision streamer.
 *
 * The host used to index the source subtree exactly once. The procedural landscape
 * creates its walls asynchronously (after the terrain grid finished rasterizing) and
 * rebuilds them on road edits. These tests lock the incremental re-index: late
 * obstacle meshes appear, unchanged meshes keep their bodies (no churn / no collision
 * gap) and hidden / removed / geometry-swapped meshes lose theirs. The rendered
 * road band stays excluded; the runtime supplies a decimated collision ribbon.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import {
  MESH_COLLISION_ACTIVATION_RADIUS_METERS,
  MESH_COLLISION_MAX_RESIDENT_CHUNKS,
  MESH_COLLISION_MAX_NEW_CHUNKS_PER_SYNC,
  MESH_COLLISION_MAX_NEW_CHUNKS_PER_SYNC_AFTER_CHANGE,
  MESH_COLLISION_RETENTION_RADIUS_METERS,
  clearAllMeshCollisionRuntimeHosts,
  syncMeshCollisionRuntimeHost,
  type MeshCollisionChunkShape,
  type MeshCollisionRuntimeDeps,
  type MeshCollisionRuntimeHostSnapshot,
} from '@schema/meshCollisionRuntimeHost'
import { GROUND_COLLISION_RADIUS_METERS } from '@schema/groundCollisionRuntimeConstants'
import { createRoadBand } from '@schema/proceduralLandscape/roadBand'
import { createRoadCollisionGeometry } from '@schema/proceduralLandscape/roadCollision'
import { createRoadBoundaryCollisionGeometry } from '@schema/proceduralLandscape/roadBoundary'
import type { RoadTraceNode } from '@schema/proceduralLandscape/roadTrace'
import {
  isProceduralLandscapeRoadSurface,
  markProceduralLandscapeDemTerrain,
  markProceduralLandscapeRoadBoundaryCollision,
  markProceduralLandscapeRoadBoundaryVisual,
  markProceduralLandscapeRoadbedSurface,
  markProceduralLandscapeRoadCollision,
} from '@schema/proceduralLandscape/collisionMetadata'

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
    createBody: (shape: MeshCollisionChunkShape, object: THREE.Object3D, name?: string) => {
      const body = { name: name ?? '' }
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

function addSmallObstacle(host: THREE.Group, x: number, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(
    makeRibbonGeometry(2, 2, 5, 1),
    new THREE.MeshBasicMaterial(),
  )
  mesh.position.set(x, 0, z)
  host.add(mesh)
  return mesh
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

/** Chunk shapes whose vertices sit above the terrain plane (y > 2.5) are obstacles. */
function isElevatedRecord(record: CreatedBodyRecord): boolean {
  return shapeMaxY(record.shape) > 2.5
}

function syncOnce(
  harness: Harness,
  sourceObject: THREE.Object3D,
  sourceId: string,
  probes: THREE.Vector3[],
  groundPatchProbes: THREE.Vector3[] = probes,
): MeshCollisionRuntimeHostSnapshot {
  sourceObject.updateMatrixWorld(true)
  return syncMeshCollisionRuntimeHost({
    enabled: true,
    sourceId,
    sourceObject,
    referenceWorldPositions: probes,
    groundPatchReferenceWorldPositions: groundPatchProbes,
    runtimeDeps: harness.deps,
  })
}

function drain(
  harness: Harness,
  sourceObject: THREE.Object3D,
  sourceId: string,
  probes: THREE.Vector3[],
  maxIterations = 128,
  groundPatchProbes: THREE.Vector3[] = probes,
): MeshCollisionRuntimeHostSnapshot {
  let snapshot = syncOnce(harness, sourceObject, sourceId, probes, groundPatchProbes)
  let iterations = 0
  while ((snapshot.indexing || snapshot.pendingChunkCount > 0) && iterations < maxIterations) {
    snapshot = syncOnce(harness, sourceObject, sourceId, probes, groundPatchProbes)
    iterations += 1
  }
  return snapshot
}

afterEach(() => {
  clearAllMeshCollisionRuntimeHosts()
})

describe('mesh collision runtime host incremental re-index', () => {
  it('indexes a late obstacle mesh that appears after the initial collection', () => {
    const host = new THREE.Group()
    host.add(new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial()))
    const probes = [new THREE.Vector3(0, 0, 0)]
    const harness = createHarness()

    drain(harness, host, 'terrain-node', probes)
    const terrainBodies = harness.created.filter((record) => !isElevatedRecord(record))
    expect(terrainBodies.length).toBeGreaterThan(0)
    expect(harness.created.filter(isElevatedRecord)).toHaveLength(0)

    // Walls are created only once the terrain grid finished rasterizing — long after
    // the initial collision index was built.
    const wall = new THREE.Mesh(makeRibbonGeometry(40, 8, 5, 4), new THREE.MeshBasicMaterial())
    wall.name = 'slowroads-wall-drystone-mesh'
    host.add(wall)
    drain(harness, host, 'terrain-node', probes)

    const obstacleBodies = harness.created.filter(isElevatedRecord)
    expect(obstacleBodies.length).toBeGreaterThan(0)
    expect(shapeMaxY(obstacleBodies[0]!.shape)).toBeCloseTo(5, 5)
    // Unchanged terrain meshes must not be rebuilt while re-indexing.
    expect(harness.created.filter((record) => !isElevatedRecord(record))).toHaveLength(terrainBodies.length)
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
    const obstacle = new THREE.Mesh(makeRibbonGeometry(40, 8, 5, 4), new THREE.MeshBasicMaterial())
    host.add(obstacle)
    const probes = [new THREE.Vector3(0, 0, 0)]
    const harness = createHarness()
    drain(harness, host, 'terrain-node', probes)

    const obstacleBodies = harness.created.filter(isElevatedRecord).map((record) => record.body)
    expect(obstacleBodies.length).toBeGreaterThan(0)
    obstacle.visible = false
    drain(harness, host, 'terrain-node', probes)
    for (const body of obstacleBodies) {
      expect(harness.removed).toContain(body)
    }

    const createdWhileHidden = harness.created.length
    obstacle.visible = true
    drain(harness, host, 'terrain-node', probes)
    expect(harness.created.length).toBeGreaterThan(createdWhileHidden)
    expect(shapeMaxY(harness.created[harness.created.length - 1]!.shape)).toBeCloseTo(5, 5)
  })

  it('retires the chunks of a removed mesh only', () => {
    const host = new THREE.Group()
    host.add(new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial()))
    const obstacle = new THREE.Mesh(makeRibbonGeometry(40, 8, 5, 4), new THREE.MeshBasicMaterial())
    host.add(obstacle)
    const probes = [new THREE.Vector3(0, 0, 0)]
    const harness = createHarness()
    drain(harness, host, 'terrain-node', probes)

    const terrainCreates = harness.created.filter((record) => !isElevatedRecord(record)).length
    const obstacleBodies = harness.created.filter(isElevatedRecord).map((record) => record.body)
    host.remove(obstacle)
    drain(harness, host, 'terrain-node', probes)

    for (const body of obstacleBodies) {
      expect(harness.removed).toContain(body)
    }
    expect(harness.created.filter((record) => !isElevatedRecord(record))).toHaveLength(terrainCreates)
  })

  it('rebuilds only the mesh whose geometry was swapped in place', () => {
    const host = new THREE.Group()
    host.add(new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial()))
    const obstacle = new THREE.Mesh(makeRibbonGeometry(40, 8, 5, 4), new THREE.MeshBasicMaterial())
    host.add(obstacle)
    const probes = [new THREE.Vector3(0, 0, 0)]
    const harness = createHarness()
    drain(harness, host, 'terrain-node', probes)

    const terrainCreates = harness.created.filter((record) => !isElevatedRecord(record)).length
    const oldObstacleBodies = harness.created.filter(isElevatedRecord).map((record) => record.body)
    obstacle.geometry = makeRibbonGeometry(40, 8, 9, 4)
    drain(harness, host, 'terrain-node', probes)

    for (const body of oldObstacleBodies) {
      expect(harness.removed).toContain(body)
    }
    const newObstacleBodies = harness.created.filter(isElevatedRecord)
    expect(newObstacleBodies.length).toBeGreaterThan(0)
    expect(shapeMaxY(newObstacleBodies[newObstacleBodies.length - 1]!.shape)).toBeCloseTo(9, 5)
    expect(harness.created.filter((record) => !isElevatedRecord(record))).toHaveLength(terrainCreates)
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
    const obstacle = new THREE.Mesh(makeRibbonGeometry(600, 8, 5, 24), new THREE.MeshBasicMaterial())
    obstacle.name = 'slowroads-wall-drystone-mesh'
    host.add(obstacle)
    const snapshot = syncOnce(harness, host, 'terrain-node', probes)

    const obstacleBodies = harness.created.slice(createdBefore).filter(isElevatedRecord)
    expect(snapshot.indexing).toBe(false)
    // The obstacle subdivides into more chunks than the regular per-sync budget would
    // create; the raised budget must drain most of them in the first sync.
    expect(obstacleBodies.length).toBeGreaterThan(MESH_COLLISION_MAX_NEW_CHUNKS_PER_SYNC)
    expect(obstacleBodies.length).toBeLessThanOrEqual(MESH_COLLISION_MAX_NEW_CHUNKS_PER_SYNC_AFTER_CHANGE)
    drain(harness, host, 'terrain-node', probes)
    expect(harness.created.filter(isElevatedRecord).length).toBeGreaterThanOrEqual(12)
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

  it('excludes the dense rendered road band from collision', () => {
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
    expect(isProceduralLandscapeRoadSurface(roadBand.mesh)).toBe(true)
    host.add(roadBand.mesh)
    drain(harness, host, 'terrain-node', probes)

    expect(harness.created).toHaveLength(terrainCreates)
    expect(harness.removed).toHaveLength(0)
    roadBand.dispose()
  })

  it('keeps walls collidable alongside an excluded road band', () => {
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
    const wall = new THREE.Mesh(makeRibbonGeometry(40, 4, 6, 4), new THREE.MeshBasicMaterial())
    wall.name = 'slowroads-wall-drystone-mesh'
    host.add(roadBand.mesh)
    host.add(wall)
    drain(harness, host, 'terrain-node', probes)

    const obstacleBodies = harness.created.slice(terrainCreates)
    expect(obstacleBodies.length).toBeGreaterThan(0)
    for (const record of obstacleBodies) {
      expect(shapeMaxY(record.shape)).toBeCloseTo(6, 5)
      expect((record.body as { name?: string }).name).toContain(':mesh:')
    }
    roadBand.dispose()
  })

  it('indexes the decimated procedural road collision ribbon', () => {
    const host = new THREE.Group()
    host.add(new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial()))
    const probes = [new THREE.Vector3(0, 0, 0)]
    const harness = createHarness()
    drain(harness, host, 'terrain-node', probes)
    const terrainCreates = harness.created.length

    const rows = Array.from({ length: 61 }, (_, index) => ({
      x: -30 + index,
      z: 0,
      y: 5,
      heading: 0,
      index,
      lateral: 0,
      longitudinal: 0,
      turn: 0,
      headingDelta: 0,
      sourceIndex: index,
    }))
    const collision = createRoadCollisionGeometry({
      rows,
      halfWidth: 2,
      rowSpacing: 6,
      columnCount: 5,
      lift: 0.05,
    })
    expect(collision).not.toBeNull()
    const mesh = new THREE.Mesh(collision!.geometry, new THREE.MeshBasicMaterial())
    host.add(mesh)
    drain(harness, host, 'terrain-node', probes)

    const roadBodies = harness.created.slice(terrainCreates).filter(isElevatedRecord)
    expect(roadBodies.length).toBeGreaterThan(0)
    expect(shapeMaxY(roadBodies[0]!.shape)).toBeCloseTo(5.05, 5)
  })

  it('indexes the boundary collider without duplicating its rendered wall', () => {
    const host = new THREE.Group()
    const terrain = new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial())
    markProceduralLandscapeDemTerrain(terrain, {
      cellSize: 2,
      sampleHeightAt: () => 0,
    })
    host.add(terrain)
    const probes = [new THREE.Vector3(0, 0, 0)]
    const harness = createHarness()
    drain(harness, host, 'terrain-node', probes)
    const terrainCreates = harness.created.length

    const rows = Array.from({ length: 61 }, (_, index) => ({
      x: -30 + index,
      z: 0,
      y: 5,
      heading: 0,
      index,
      lateral: 0,
      longitudinal: 0,
      turn: 0,
      headingDelta: 0,
      sourceIndex: index,
    }))
    const visual = new THREE.Mesh(
      makeRibbonGeometry(40, 4, 6, 4),
      new THREE.MeshBasicMaterial(),
    )
    markProceduralLandscapeRoadBoundaryVisual(visual)
    host.add(visual)
    drain(harness, host, 'terrain-node', probes)
    expect(harness.created).toHaveLength(terrainCreates)

    const collision = createRoadBoundaryCollisionGeometry({
      rows,
      halfWidth: 2,
      closed: false,
      rowSpacing: 4,
      lift: 0.05,
    })
    expect(collision).not.toBeNull()
    const collisionMesh = new THREE.Mesh(
      collision!.geometry,
      new THREE.MeshBasicMaterial({ visible: false }),
    )
    markProceduralLandscapeRoadBoundaryCollision(collisionMesh)
    host.add(collisionMesh)
    drain(harness, host, 'terrain-node', probes)

    const boundaryBodies = harness.created
      .slice(terrainCreates)
      .filter(isElevatedRecord)
    expect(boundaryBodies.length).toBeGreaterThan(0)
    expect(boundaryBodies.some((record) => shapeMaxY(record.shape) > 7.9)).toBe(true)
    expect(boundaryBodies.some((record) => (
      String((record.body as { name?: string }).name ?? '').includes(':road-boundary:')
    ))).toBe(true)
  })

  it('excludes the dense rendered DEM roadbed from collision', () => {
    const host = new THREE.Group()
    host.add(new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial()))
    const probes = [new THREE.Vector3(0, 0, 0)]
    const harness = createHarness()
    drain(harness, host, 'terrain-node', probes)
    const terrainCreates = harness.created.length

    const roadbed = new THREE.Mesh(makeRibbonGeometry(40, 30, 5, 4), new THREE.MeshBasicMaterial())
    markProceduralLandscapeRoadbedSurface(roadbed)
    host.add(roadbed)
    drain(harness, host, 'terrain-node', probes)

    expect(harness.created).toHaveLength(terrainCreates)
  })

  it('indexes the decimated DEM roadbed collision ribbon', () => {
    const host = new THREE.Group()
    host.add(new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial()))
    const probes = [new THREE.Vector3(0, 0, 0)]
    const harness = createHarness()
    drain(harness, host, 'terrain-node', probes)
    const terrainCreates = harness.created.length

    const roadbedCollision = new THREE.Mesh(
      makeRibbonGeometry(40, 30, 5, 4),
      new THREE.MeshBasicMaterial(),
    )
    markProceduralLandscapeRoadCollision(roadbedCollision)
    host.add(roadbedCollision)
    drain(harness, host, 'terrain-node', probes)

    const roadbedBodies = harness.created.slice(terrainCreates).filter(isElevatedRecord)
    expect(roadbedBodies.length).toBeGreaterThan(0)
    expect(shapeMaxY(roadbedBodies[0]!.shape)).toBeCloseTo(5, 5)
    expect((roadbedBodies[0]!.body as { name?: string }).name).toContain(':roadbed:')
  })

  it('uses the patched current-vehicle surface as the sole ground collision owner', () => {
    const host = new THREE.Group()
    const terrain = new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial())
    markProceduralLandscapeDemTerrain(terrain, {
      cellSize: 2,
      sampleHeightAt: () => 5,
    })
    host.add(terrain)

    const roadbedCollision = new THREE.Mesh(
      makeRibbonGeometry(80, 30, 5, 8),
      new THREE.MeshBasicMaterial(),
    )
    markProceduralLandscapeRoadCollision(roadbedCollision)
    host.add(roadbedCollision)

    const wall = new THREE.Mesh(
      makeRibbonGeometry(40, 4, 6, 4),
      new THREE.MeshBasicMaterial(),
    )
    wall.name = 'slowroads-wall-test'
    host.add(wall)

    const harness = createHarness()
    const snapshot = drain(
      harness,
      host,
      'single-owner-node',
      [new THREE.Vector3(0, 0, 0)],
    )
    const bodyNames = harness.created.map((record) => String(
      (record.body as { name?: string }).name ?? '',
    ))

    expect(snapshot.referenceGroundCoverage[0]?.groundPatched).toBe(true)
    expect(snapshot.groundPatchCount).toBe(1)
    expect(bodyNames.some((name) => name.includes(':dem-terrain:'))).toBe(false)
    expect(bodyNames.some((name) => name.includes(':roadbed:'))).toBe(false)
    expect(bodyNames.some((name) => name.includes(':mesh:'))).toBe(true)
    const patch = harness.created.find((record) => (
      String((record.body as { name?: string }).name ?? '').includes(':ground-patch:')
    ))
    expect(patch).toBeTruthy()
    expect(shapeMaxY(patch!.shape)).toBeCloseTo(5, 5)
  })

  it('keeps obstacle streaming on all anchors while patching only the current vehicle', () => {
    const host = new THREE.Group()
    const terrain = new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial())
    markProceduralLandscapeDemTerrain(terrain, {
      cellSize: 2,
      sampleHeightAt: () => 0,
    })
    host.add(terrain)
    addSmallObstacle(host, 0)
    addSmallObstacle(host, 80)

    const harness = createHarness()
    const snapshot = drain(
      harness,
      host,
      'shared-obstacle-node',
      [new THREE.Vector3(0, 0, 0), new THREE.Vector3(80, 0, 0)],
      128,
      [new THREE.Vector3(0, 0, 0)],
    )
    const obstacleNames = harness.created
      .map((record) => String((record.body as { name?: string }).name ?? ''))
      .filter((name) => name.includes(':mesh:'))

    expect(snapshot.referenceGroundCoverage).toHaveLength(1)
    expect(snapshot.referenceGroundCoverage[0]?.groundPatched).toBe(true)
    expect(obstacleNames).toHaveLength(2)
  })

  it('keeps DEM and roadbed fallback collision when the near patch cannot be sampled', () => {
    const host = new THREE.Group()
    const terrain = new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial())
    let sampledHeight: number | null = null
    markProceduralLandscapeDemTerrain(terrain, {
      cellSize: 2,
      sampleHeightAt: () => sampledHeight,
    })
    host.add(terrain)

    const roadbedCollision = new THREE.Mesh(
      makeRibbonGeometry(80, 30, 5, 8),
      new THREE.MeshBasicMaterial(),
    )
    markProceduralLandscapeRoadCollision(roadbedCollision)
    host.add(roadbedCollision)

    const harness = createHarness()
    const snapshot = drain(
      harness,
      host,
      'fallback-node',
      [new THREE.Vector3(0, 0, 0)],
    )
    const bodyNames = harness.created.map((record) => String(
      (record.body as { name?: string }).name ?? '',
    ))

    expect(snapshot.referenceGroundCoverage[0]?.groundPatched).toBe(false)
    expect(snapshot.groundPatchCount).toBe(0)
    expect(bodyNames.some((name) => name.includes(':dem-terrain:'))).toBe(true)
    expect(bodyNames.some((name) => name.includes(':roadbed:'))).toBe(true)

    const roadbedFallback = harness.created.find((record) => (
      String((record.body as { name?: string }).name ?? '').includes(':roadbed:')
    ))
    sampledHeight = 5
    const recovered = drain(
      harness,
      host,
      'fallback-node',
      [new THREE.Vector3(0, 0, 0)],
    )
    expect(recovered.referenceGroundCoverage[0]?.groundPatched).toBe(true)
    expect(harness.removed).toContain(roadbedFallback!.body)
  })

  it('uses a tighter mesh collision window than ground tile streaming', () => {
    expect(GROUND_COLLISION_RADIUS_METERS).toBe(150)
    expect(MESH_COLLISION_ACTIVATION_RADIUS_METERS).toBe(100)
    expect(MESH_COLLISION_RETENTION_RADIUS_METERS).toBe(150)
    expect(MESH_COLLISION_MAX_RESIDENT_CHUNKS).toBe(32)
  })

  it('activates a chunk whose AABB is just inside 100m', () => {
    const host = new THREE.Group()
    addSmallObstacle(host, 100)
    const harness = createHarness()

    drain(harness, host, 'boundary-node', [new THREE.Vector3(0, 0, 0)])

    expect(harness.created).toHaveLength(1)
  })

  it('does not activate a chunk whose AABB is just outside 100m', () => {
    const host = new THREE.Group()
    addSmallObstacle(host, 102)
    const harness = createHarness()

    drain(harness, host, 'boundary-node', [new THREE.Vector3(0, 0, 0)])

    expect(harness.created).toHaveLength(0)
  })

  it('retains a resident chunk at 149m and removes it at 151m', () => {
    const host = new THREE.Group()
    addSmallObstacle(host, 0)
    const harness = createHarness()
    drain(harness, host, 'retention-node', [new THREE.Vector3(0, 0, 0)])
    expect(harness.created).toHaveLength(1)
    const body = harness.created[0]!.body

    syncOnce(harness, host, 'retention-node', [new THREE.Vector3(150, 0, 0)])
    expect(harness.removed).not.toContain(body)

    syncOnce(harness, host, 'retention-node', [new THREE.Vector3(152, 0, 0)])
    expect(harness.removed).toContain(body)
  })

  it('keeps only the nearest 32 resident chunks', () => {
    const host = new THREE.Group()
    for (let index = 0; index < 40; index += 1) {
      addSmallObstacle(
        host,
        (index % 8) * 6 - 21,
        Math.floor(index / 8) * 6 - 12,
      )
    }
    const harness = createHarness()
    const snapshot = drain(harness, host, 'cap-node', [new THREE.Vector3(0, 0, 0)])

    expect(snapshot.chunkCount).toBe(32)
    expect(harness.created).toHaveLength(32)
  })

  it('keeps the DEM chunk under an anchor when obstacle chunks exceed the budget', () => {
    const host = new THREE.Group()
    for (let index = 0; index < 40; index += 1) {
      addSmallObstacle(
        host,
        (index % 8) * 4 - 14,
        Math.floor(index / 8) * 4 - 10,
      )
    }
    const terrain = new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial())
    markProceduralLandscapeDemTerrain(terrain)
    host.add(terrain)

    const harness = createHarness()
    const snapshot = drain(
      harness,
      host,
      'ground-priority-node',
      [new THREE.Vector3(0, 0, 0)],
    )

    expect(snapshot.chunkCount).toBe(MESH_COLLISION_MAX_RESIDENT_CHUNKS)
    expect(snapshot.groundSourceCount).toBe(1)
    expect(snapshot.groundChunkCount).toBeGreaterThan(0)
    expect(snapshot.uncoveredReferenceCount).toBe(0)
    expect(snapshot.referenceGroundCoverage[0]?.covered).toBe(true)
    expect(harness.created.filter((record) => !isElevatedRecord(record)).length).toBeGreaterThan(0)
    expect(
      harness.created.some((record) => (
        (record.body as { name?: string }).name?.includes(':dem-terrain:') === true
      )),
    ).toBe(true)
  })

  it('keeps one mandatory DEM chunk for every separated Ground Anchor', () => {
    const host = new THREE.Group()
    for (let index = 0; index < 40; index += 1) {
      addSmallObstacle(host, 0, 0)
    }
    const terrain = new THREE.Mesh(makeTerrainGeometry(), new THREE.MeshBasicMaterial())
    markProceduralLandscapeDemTerrain(terrain)
    host.add(terrain)

    const harness = createHarness()
    const snapshot = drain(
      harness,
      host,
      'multi-anchor-node',
      [
        new THREE.Vector3(-250, 0, 0),
        new THREE.Vector3(250, 0, 0),
      ],
    )

    expect(snapshot.referenceGroundCoverage).toHaveLength(2)
    expect(snapshot.referenceGroundCoverage.every((entry) => entry.covered)).toBe(true)
    expect(new Set(
      snapshot.referenceGroundCoverage.map((entry) => entry.chunkKey),
    ).size).toBe(2)
  })

  it('moves mandatory DEM coverage across consecutive collision cells', () => {
    const host = new THREE.Group()
    const geometry = new THREE.PlaneGeometry(1200, 240, 800, 160).rotateX(-Math.PI / 2)
    const terrain = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
    markProceduralLandscapeDemTerrain(terrain)
    host.add(terrain)

    const harness = createHarness()
    const chunkKeys: string[] = []
    ;[-400, 0, 400].forEach((x) => {
      const snapshot = drain(
        harness,
        host,
        'moving-ground-node',
        [new THREE.Vector3(x, 0, 0)],
      )
      expect(snapshot.referenceGroundCoverage[0]?.covered).toBe(true)
      chunkKeys.push(snapshot.referenceGroundCoverage[0]?.chunkKey ?? '')
    })

    expect(new Set(chunkKeys).size).toBe(3)
  })

  it('keeps a sampled ground patch under moving anchors', () => {
    const host = new THREE.Group()
    const terrain = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200, 20, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial(),
    )
    markProceduralLandscapeDemTerrain(terrain, {
      cellSize: 10,
      sampleHeightAt: () => 0,
    })
    host.add(terrain)
    const harness = createHarness()
    const getPatchBodies = (): object[] => harness.created
      .filter((record) => (
        typeof (record.body as { name?: unknown }).name === 'string'
        && (record.body as { name: string }).name.includes(':ground-patch:')
      ))
      .map((record) => record.body)

    const first = drain(
      harness,
      host,
      'ground-patch-node',
      [new THREE.Vector3(0, 0, 0)],
    )
    const firstPatches = getPatchBodies()
    expect(first.referenceGroundCoverage[0]?.chunkKey).toBe('ground-patch:0')
    expect(firstPatches).toHaveLength(1)

    const second = drain(
      harness,
      host,
      'ground-patch-node',
      [new THREE.Vector3(64, 0, 0)],
    )
    const secondPatches = getPatchBodies()
    expect(second.referenceGroundCoverage[0]?.chunkKey).toBe('ground-patch:0')
    expect(secondPatches).toHaveLength(2)
    expect(harness.removed).toContain(firstPatches[0])
  })

  it('builds a fine visible-surface fallback under an active DEM chunk', () => {
    const host = new THREE.Group()
    const terrain = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200, 20, 20)
        .rotateX(-Math.PI / 2)
        .translate(0, 40, 0),
      new THREE.MeshBasicMaterial(),
    )
    const visibleSurfaceHeightAt = (x: number, z: number): number => 5 + x * 0.01 + z * 0.02
    markProceduralLandscapeDemTerrain(terrain, {
      cellSize: 10,
      sampleHeightAt: visibleSurfaceHeightAt,
    })
    host.add(terrain)
    const harness = createHarness()

    const snapshot = drain(
      harness,
      host,
      'visible-surface-node',
      [new THREE.Vector3(0, 0, 0)],
    )
    expect(snapshot.referenceGroundCoverage[0]?.chunkKey).toBe('ground-patch:0')
    expect(snapshot.groundChunkCount).toBe(1)
    expect(snapshot.chunkCount).toBe(1)
    const patch = harness.created.find((record) => (
      typeof (record.body as { name?: unknown }).name === 'string'
      && (record.body as { name: string }).name.includes(':ground-patch:')
    ))
    expect(patch).toBeDefined()
    const { vertices } = patch!.shape
    const uniqueX = new Set<number>()
    const uniqueZ = new Set<number>()
    for (let index = 0; index < vertices.length; index += 3) {
      const x = vertices[index]!
      const y = vertices[index + 1]!
      const z = vertices[index + 2]!
      expect(y).toBeCloseTo(visibleSurfaceHeightAt(x, z), 5)
      expect(y).toBeLessThan(20)
      uniqueX.add(x)
      uniqueZ.add(z)
    }
    expect(uniqueX.size).toBe(17)
    expect(uniqueZ.size).toBe(17)
    expect(Math.min(...uniqueX)).toBeCloseTo(-16, 5)
    expect(Math.max(...uniqueX)).toBeCloseTo(16, 5)
    expect(Math.min(...uniqueZ)).toBeCloseTo(-16, 5)
    expect(Math.max(...uniqueZ)).toBeCloseTo(16, 5)
  })

  it('warns once when every DEM ground chunk is outside the activation radius', () => {
    const host = new THREE.Group()
    const terrain = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100, 4, 4).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial(),
    )
    markProceduralLandscapeDemTerrain(terrain)
    host.add(terrain)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const harness = createHarness()
      const snapshot = drain(
        harness,
        host,
        'outside-dem-node',
        [new THREE.Vector3(400, 0, 0)],
      )
      expect(snapshot.groundSourceCount).toBe(1)
      expect(snapshot.uncoveredReferenceCount).toBe(1)
      expect(snapshot.referenceGroundCoverage[0]?.covered).toBe(false)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })
})
