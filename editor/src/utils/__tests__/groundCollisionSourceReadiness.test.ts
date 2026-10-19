import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  GROUND_COLLISION_SOURCE_COMPONENT_TYPE,
  PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
} from '@schema/components'
import type { SceneNode } from '@schema/core'
import {
  collectDemGroundCollisionSourceNodeIds,
  hasGroundCollisionMesh,
  waitForGroundCollisionSourceTerrainReady,
} from '@schema/groundCollisionSourceRuntime'
import {
  markProceduralLandscapeRoadbedSurface,
  markProceduralLandscapeRoadCollision,
} from '@schema/proceduralLandscape/collisionMetadata'

type NodeOptions = {
  groundCollisionEnabled?: boolean
  hasGroundCollision?: boolean
  landscapeEnabled?: boolean
  hasLandscape?: boolean
  demAssetId?: string | null
  runtimeGridUrl?: string | null
  children?: SceneNode[]
}

function makeNode(id: string, options: NodeOptions = {}): SceneNode {
  const components: Record<string, any> = {}
  if (options.hasGroundCollision !== false) {
    components[GROUND_COLLISION_SOURCE_COMPONENT_TYPE] = {
      id: `${id}-ground-collision`,
      type: GROUND_COLLISION_SOURCE_COMPONENT_TYPE,
      enabled: options.groundCollisionEnabled ?? true,
      props: { label: id },
    }
  }
  if (options.hasLandscape !== false) {
    components[PROCEDURAL_LANDSCAPE_COMPONENT_TYPE] = {
      id: `${id}-landscape`,
      type: PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
      enabled: options.landscapeEnabled ?? true,
      props: {
        dem: {
          assetId: options.demAssetId === undefined ? 'asset-dem' : options.demAssetId,
          runtimeGridUrl: options.runtimeGridUrl === undefined
            ? 'https://example.test/dem-grid.bin'
            : options.runtimeGridUrl,
        },
      },
    }
  }
  return {
    id,
    name: id,
    nodeType: 'Group',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    components,
    children: options.children ?? [],
  }
}

function makeTerrainObject(): THREE.Group {
  const group = new THREE.Group()
  group.add(new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100, 2, 2),
    new THREE.MeshBasicMaterial(),
  ))
  return group
}

function makeClock() {
  let tick = 0
  return {
    now: () => tick * 10,
    sleep: async () => {
      tick += 1
    },
    getTick: () => tick,
  }
}

describe('DEM ground collision source readiness', () => {
  it('collects only enabled DEM procedural landscape sources', () => {
    const children = [
      makeNode('plain-ground', { hasLandscape: false }),
      makeNode('glb-landscape', { demAssetId: null, runtimeGridUrl: null }),
      makeNode('disabled-source', { groundCollisionEnabled: false }),
      makeNode('disabled-landscape', { landscapeEnabled: false }),
      makeNode('missing-grid-url', { runtimeGridUrl: null }),
    ]
    const root = makeNode('root', { children })

    expect(collectDemGroundCollisionSourceNodeIds([root])).toEqual(['root'])

    const nested = makeNode('nested-dem', {
      children: [makeNode('nested-child-dem')],
    })
    expect(collectDemGroundCollisionSourceNodeIds([nested])).toEqual([
      'nested-dem',
      'nested-child-dem',
    ])
  })

  it('waits through idle/loading/building until the DEM mesh is ready', async () => {
    const node = makeNode('terrain')
    const sourceObject = makeTerrainObject()
    const states: Array<'inactive' | 'idle' | 'loading' | 'building' | 'ready'> = [
      'inactive',
      'idle',
      'loading',
      'building',
      'ready',
    ]
    const clock = makeClock()

    const result = await waitForGroundCollisionSourceTerrainReady({
      nodes: [node],
      resolveSourceObject: () => sourceObject,
      getStats: () => ({ demStatus: states[Math.min(clock.getTick(), states.length - 1)]! }),
      timeoutMs: 1_000,
      pollIntervalMs: 10,
      now: clock.now,
      sleep: clock.sleep,
    })

    expect(result.status).toBe('ready')
    expect(result.pendingNodeIds).toEqual([])
    expect(result.statuses.terrain).toBe('ready')
    expect(clock.getTick()).toBeGreaterThanOrEqual(4)
  })

  it('treats ready DEM stats without an indexed mesh as still pending', async () => {
    const node = makeNode('terrain')
    const clock = makeClock()

    const result = await waitForGroundCollisionSourceTerrainReady({
      nodes: [node],
      resolveSourceObject: () => new THREE.Group(),
      getStats: () => ({ demStatus: 'ready' }),
      timeoutMs: 20,
      pollIntervalMs: 10,
      now: clock.now,
      sleep: clock.sleep,
    })

    expect(result.status).toBe('timeout')
    expect(result.pendingNodeIds).toEqual(['terrain'])
    expect(result.statuses.terrain).toBe('ready-no-mesh')
  })

  it('does not resolve before a late DEM terrain mesh appears', async () => {
    const node = makeNode('terrain')
    const sourceObject = new THREE.Group()
    let tick = 0
    let demReady = false
    const result = await waitForGroundCollisionSourceTerrainReady({
      nodes: [node],
      resolveSourceObject: () => sourceObject,
      getStats: () => ({ demStatus: demReady ? 'ready' : 'loading' }),
      timeoutMs: 1_000,
      pollIntervalMs: 10,
      now: () => tick * 10,
      sleep: async () => {
        tick += 1
        if (tick >= 3) {
          sourceObject.add(new THREE.Mesh(
            new THREE.PlaneGeometry(10, 10),
            new THREE.MeshBasicMaterial(),
          ))
          demReady = true
        }
      },
    })

    expect(result.status).toBe('ready')
    expect(result.statuses.terrain).toBe('ready')
    expect(tick).toBeGreaterThanOrEqual(3)
  })

  it('skips DEM sources that reported an error instead of waiting forever', async () => {
    const node = makeNode('terrain')
    const result = await waitForGroundCollisionSourceTerrainReady({
      nodes: [node],
      resolveSourceObject: () => null,
      getStats: () => ({ demStatus: 'error' }),
    })

    expect(result.status).toBe('ready')
    expect(result.pendingNodeIds).toEqual([])
    expect(result.skippedNodeIds).toEqual(['terrain'])
    expect(result.statuses.terrain).toBe('error')
  })

  it('returns immediately when aborted', async () => {
    const node = makeNode('terrain')
    const result = await waitForGroundCollisionSourceTerrainReady({
      nodes: [node],
      resolveSourceObject: () => makeTerrainObject(),
      getStats: () => ({ demStatus: 'loading' }),
      shouldAbort: () => true,
    })

    expect(result.status).toBe('aborted')
    expect(result.pendingNodeIds).toEqual(['terrain'])
  })

  it('does not wait when the scene has no DEM-backed collision source', async () => {
    const result = await waitForGroundCollisionSourceTerrainReady({
      nodes: [makeNode('glb-landscape', { demAssetId: null, runtimeGridUrl: null })],
      resolveSourceObject: () => makeTerrainObject(),
      getStats: () => ({ demStatus: 'loading' }),
    })

    expect(result.status).toBe('ready')
    expect(result.pendingNodeIds).toEqual([])
  })
})

describe('hasGroundCollisionMesh', () => {
  it('requires a visible non-instanced mesh with a position attribute', () => {
    expect(hasGroundCollisionMesh(makeTerrainObject())).toBe(true)

    const hidden = new THREE.Group()
    const hiddenMesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial())
    hiddenMesh.visible = false
    hidden.add(hiddenMesh)
    expect(hasGroundCollisionMesh(hidden)).toBe(false)

    const instanced = new THREE.Group()
    instanced.add(new THREE.InstancedMesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshBasicMaterial(),
      1,
    ))
    expect(hasGroundCollisionMesh(instanced)).toBe(false)

    const emptyGeometry = new THREE.Group()
    emptyGeometry.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()))
    expect(hasGroundCollisionMesh(emptyGeometry)).toBe(false)

    const roadCollision = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshBasicMaterial(),
    )
    markProceduralLandscapeRoadCollision(roadCollision)
    const roadCollisionGroup = new THREE.Group()
    roadCollisionGroup.add(roadCollision)
    expect(hasGroundCollisionMesh(roadCollisionGroup)).toBe(false)

    const roadbed = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshBasicMaterial(),
    )
    markProceduralLandscapeRoadbedSurface(roadbed)
    const roadbedGroup = new THREE.Group()
    roadbedGroup.add(roadbed)
    expect(hasGroundCollisionMesh(roadbedGroup)).toBe(false)
  })
})
