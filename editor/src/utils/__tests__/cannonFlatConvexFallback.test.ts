import * as CANNON from 'cannon-es'
import { describe, expect, it } from 'vitest'
import { createPlanarConvexFallbackShape } from '../../../../physics-cannon/src/planarConvexFallback'

describe('Cannon flat convex fallback', () => {
  it('uses a static triangle mesh instead of constructing a degenerate convex hull', () => {
    const shape = createPlanarConvexFallbackShape({
      id: 1,
      kind: 'convex-hull',
      vertices: new Float32Array([
        -2, 0, -1,
        2, 0, -1,
        2, 0, 1,
        -2, 0, 1,
      ]),
      faces: [[0, 1, 2, 3]],
      applyScale: false,
    })
    expect(shape?.type).toBe(CANNON.Shape.types.TRIMESH)
  })
})
