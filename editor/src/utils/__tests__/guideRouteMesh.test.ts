import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  applyGuideRouteEditorOverlay,
  createGuideRouteGroup,
  GUIDE_ROUTE_EDITOR_RENDER_OPTIONS,
  updateGuideRouteGroup,
} from '@schema/guideRouteMesh'
import type { GuideRouteDynamicMesh } from '@schema/core'
import { applyMaterialOverrides } from '@schema/material'

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
    const segmentMaterial = segments.material as THREE.MeshBasicMaterial
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    const scale = new THREE.Vector3()

    segments.getMatrixAt(0, matrix)
    matrix.decompose(position, rotation, scale)

    expect(scale.x).toBeCloseTo(0.7)
    expect(scale.y).toBeCloseTo(0.12)
    expect(segments.renderOrder).toBe(10010)
    expect(segments.frustumCulled).toBe(false)
    expect(segmentMaterial.depthTest).toBe(false)
    expect(segmentMaterial.depthWrite).toBe(false)
    expect(segmentMaterial.transparent).toBe(true)
    expect(segmentMaterial.opacity).toBeCloseTo(0.42)
    expect(segmentMaterial.color.getHex()).toBe(0xa8efff)
    expect(segmentMaterial.fog).toBe(false)
    expect(segments.userData.overrideMaterial).toBe(true)
    expect(group.getObjectByName('GuideRouteWaypoints')).toBeUndefined()
  })

  it('upgrades a scene-graph route mesh and protects it from node material overrides', () => {
    const group = createGuideRouteGroup(createDefinition())
    const segments = group.getObjectByName('GuideRouteSegments') as THREE.InstancedMesh

    applyGuideRouteEditorOverlay(segments)

    const material = segments.material as THREE.MeshBasicMaterial
    applyMaterialOverrides(group, [{} as never])
    expect(material).toBeInstanceOf(THREE.MeshBasicMaterial)
    expect(segments.material).toBe(material)
    expect(material.color.getHex()).toBe(0xa8efff)
    expect(material.depthTest).toBe(false)
    expect(material.depthWrite).toBe(false)
    expect(material.transparent).toBe(true)
    expect(material.opacity).toBeCloseTo(0.42)
    expect(material.fog).toBe(false)
    expect(segments.renderOrder).toBe(10010)
    expect(segments.frustumCulled).toBe(false)
    expect(segments.visible).toBe(true)
    expect(segments.userData.overrideMaterial).toBe(true)
    expect(segments.userData.guideRouteEditorOverlay).toBe(true)
  })

  it('keeps endpoint and stop marker materials opaque', () => {
    const group = createGuideRouteGroup(createDefinition())
    const segments = group.getObjectByName('GuideRouteSegments') as THREE.InstancedMesh
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffd54f })
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), markerMaterial)
    group.add(marker)

    applyGuideRouteEditorOverlay(segments)

    expect(marker.material).toBe(markerMaterial)
    expect(markerMaterial.transparent).toBe(false)
    expect(markerMaterial.opacity).toBe(1)
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
    expect(group.getObjectByName('GuideRouteWaypoints')).toBeUndefined()
  })

  it('keeps normal runtime route rendering depth tested', () => {
    const group = createGuideRouteGroup(createDefinition())
    const segments = group.getObjectByName('GuideRouteSegments') as THREE.InstancedMesh

    expect((segments.material as THREE.MeshStandardMaterial).depthTest).toBe(true)
    expect(segments.renderOrder).toBe(0)
    expect(group.getObjectByName('GuideRouteWaypoints')).toBeUndefined()
  })
})
