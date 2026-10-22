import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  PlacementSurfaceTargetIndex,
  isPlacementSurfaceRaycastCandidate,
} from '@/utils/placementSurfaceTargetIndex'

function createTerrainMesh(y = 30): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(10, 10)
  geometry.rotateX(-Math.PI / 2)
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
  mesh.position.y = y
  return mesh
}

describe('placement surface target index', () => {
  it('refreshes a node when an asynchronous runtime surface is attached', () => {
    const host = new THREE.Group()
    const objects = new Map<string, THREE.Object3D>([['terrain', host]])
    const index = new PlacementSurfaceTargetIndex({
      getObject: (nodeId) => objects.get(nodeId),
      getInstancedTargets: () => [],
      getInstancedRevision: () => 0,
    })

    index.rebuild(objects.keys())
    expect(index.ensureUpToDate()).toHaveLength(0)

    const terrain = createTerrainMesh()
    host.add(terrain)
    index.refreshNode('terrain')

    expect(index.ensureUpToDate()).toEqual([terrain])
  })

  it('drops stale runtime geometry after the node surface is rebuilt', () => {
    const host = new THREE.Group()
    const original = createTerrainMesh(10)
    const replacement = createTerrainMesh(40)
    host.add(original)
    const index = new PlacementSurfaceTargetIndex({
      getObject: () => host,
      getInstancedTargets: () => [],
      getInstancedRevision: () => 0,
    })

    index.rebuild(['terrain'])
    expect(index.ensureUpToDate()).toEqual([original])

    host.remove(original)
    host.add(replacement)
    index.refreshNode('terrain')

    expect(index.ensureUpToDate()).toEqual([replacement])
  })

  it('excludes meshes without a usable position attribute', () => {
    const empty = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
    expect(isPlacementSurfaceRaycastCandidate(empty)).toBe(false)

    const valid = createTerrainMesh()
    expect(isPlacementSurfaceRaycastCandidate(valid)).toBe(true)
  })
})
