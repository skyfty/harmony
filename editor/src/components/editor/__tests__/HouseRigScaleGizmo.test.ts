import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  getEndpointGizmoPartInfoFromObject,
} from '@/components/editor/EndpointGizmo'
import {
  createHouseRigScaleGizmoObject,
} from '@/components/editor/HouseRigScaleGizmo'

describe('House Rig scale-style gizmo', () => {
  it('uses an axis rail with an outlined cube instead of an arrowhead', () => {
    const gizmo = createHouseRigScaleGizmoObject({
      axis: 'x',
      color: 0xff5252,
      renderOrder: 1002,
    })

    const cube = gizmo.root.getObjectByName('HouseRigScale_Cube_px') as THREE.Mesh
    const outline = gizmo.root.getObjectByName('HouseRigScale_Outline_px') as THREE.LineSegments
    const hit = gizmo.root.getObjectByName('HouseRigScale_Hit_px') as THREE.Mesh
    expect(cube?.isMesh).toBe(true)
    expect(outline?.isLineSegments).toBe(true)
    expect(hit?.isMesh).toBe(true)
    expect(gizmo.root.getObjectByName('EndpointGizmo_Cone_px')).toBeUndefined()

    const partInfo = getEndpointGizmoPartInfoFromObject(cube)
    expect(partInfo?.kind).toBe('axis')
    if (partInfo?.kind === 'axis') {
      expect(partInfo.axisName).toBe('x')
      expect(partInfo.axis.toArray()).toEqual([1, 0, 0])
    }

    const normalMaterial = cube.material
    gizmo.setState('px', 'active')
    expect(cube.material).not.toBe(normalMaterial)
    gizmo.clearStates()
    expect(cube.material).toBe(normalMaterial)
    expect(hit.material).toBeInstanceOf(THREE.MeshBasicMaterial)
    expect((hit.material as THREE.MeshBasicMaterial).colorWrite).toBe(false)

    gizmo.dispose()
  })
})
