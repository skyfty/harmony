import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { findGuideRouteVertexHandleOwner } from '@/components/editor/GuideRouteVertexRenderer'

describe('GuideRouteVertexRenderer', () => {
  it('resolves handle metadata from a nested gizmo mesh up to its handle root', () => {
    const handle = new THREE.Group()
    handle.userData.handleKey = 'path-1:anchor-1'
    const axis = new THREE.Group()
    const center = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial())
    handle.add(axis)
    axis.add(center)

    expect(findGuideRouteVertexHandleOwner(center)).toBe(handle)
  })

  it('returns null when no handle root is present', () => {
    expect(findGuideRouteVertexHandleOwner(new THREE.Mesh())).toBeNull()
    expect(findGuideRouteVertexHandleOwner(null)).toBeNull()
  })
})
