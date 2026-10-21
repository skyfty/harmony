import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  createGuideRouteGroup,
  GUIDE_ROUTE_EDITOR_RENDER_OPTIONS,
  updateGuideRouteGroup,
} from '@schema/guideRouteMesh'
import type { GuideRouteDynamicMesh } from '@schema/core'

function createDefinition(): GuideRouteDynamicMesh {
  return {
    type: 'GuideRoute',
    vertices: [
      { x: 0, y: 1, z: 0 },
      { x: 10, y: 2, z: 0 },
      { x: 20, y: 3, z: 2 },
    ],
  }
}

describe('guideRouteMesh', () => {
  it('renders the editor overlay large and above terrain', () => {
    const group = createGuideRouteGroup(createDefinition(), GUIDE_ROUTE_EDITOR_RENDER_OPTIONS)
    const segments = group.getObjectByName('GuideRouteSegments') as THREE.InstancedMesh
    const waypoints = group.getObjectByName('GuideRouteWaypoints') as THREE.InstancedMesh
    const segmentMaterial = segments.material as THREE.MeshBasicMaterial
    const waypointMaterial = waypoints.material as THREE.MeshBasicMaterial
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    const scale = new THREE.Vector3()

    segments.getMatrixAt(0, matrix)
    matrix.decompose(position, rotation, scale)

    expect(scale.x).toBeCloseTo(0.7)
    expect(scale.y).toBeCloseTo(0.12)
    expect(segments.renderOrder).toBe(9000)
    expect(waypoints.renderOrder).toBe(9001)
    expect(segments.frustumCulled).toBe(false)
    expect(waypoints.frustumCulled).toBe(false)
    expect(segmentMaterial.depthTest).toBe(false)
    expect(segmentMaterial.depthWrite).toBe(false)
    expect(waypointMaterial.depthTest).toBe(false)
    expect(waypointMaterial.depthWrite).toBe(false)
  })

  it('updates overlay instances when route vertices change', () => {
    const group = createGuideRouteGroup(createDefinition(), GUIDE_ROUTE_EDITOR_RENDER_OPTIONS)
    const updated = updateGuideRouteGroup(
      group,
      {
        type: 'GuideRoute',
        vertices: [
          { x: 0, y: 0, z: 0 },
          { x: 5, y: 1, z: 0 },
          { x: 10, y: 2, z: 0 },
          { x: 15, y: 3, z: 0 },
        ],
      },
      GUIDE_ROUTE_EDITOR_RENDER_OPTIONS,
    )

    expect(updated).toBe(true)
    expect((group.getObjectByName('GuideRouteSegments') as THREE.InstancedMesh).count).toBe(3)
    expect((group.getObjectByName('GuideRouteWaypoints') as THREE.InstancedMesh).count).toBe(4)
  })

  it('keeps normal runtime route rendering depth tested', () => {
    const group = createGuideRouteGroup(createDefinition())
    const segments = group.getObjectByName('GuideRouteSegments') as THREE.InstancedMesh
    const waypoints = group.getObjectByName('GuideRouteWaypoints') as THREE.InstancedMesh

    expect((segments.material as THREE.MeshStandardMaterial).depthTest).toBe(true)
    expect((waypoints.material as THREE.MeshStandardMaterial).depthTest).toBe(true)
    expect(segments.renderOrder).toBe(0)
    expect(waypoints.renderOrder).toBe(0)
  })
})
