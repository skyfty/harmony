import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { resolveSurfaceAlignedQuaternion } from '@/utils/surfacePlacementTransform'

describe('surface placement transform', () => {
  it('aligns local up with a sloped surface normal', () => {
    const normal = new THREE.Vector3(0.2, 1, -0.35).normalize()
    const rotation = resolveSurfaceAlignedQuaternion(normal)
    const alignedUp = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation)

    expect(alignedUp.distanceTo(normal)).toBeLessThan(1e-6)
  })

  it('keeps a horizontal transform for invalid or zero normals', () => {
    const identity = new THREE.Quaternion()

    expect(resolveSurfaceAlignedQuaternion(null).equals(identity)).toBe(true)
    expect(resolveSurfaceAlignedQuaternion(new THREE.Vector3()).equals(identity)).toBe(true)
  })
})
