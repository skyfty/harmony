import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  selectNearestPlacementSurfaceHit,
  type PlacementSurfaceHit,
} from '@/utils/placementSurfaceHit'

function createHit(nodeId: string, distance: number): PlacementSurfaceHit {
  return {
    point: new THREE.Vector3(0, distance, 0),
    normal: new THREE.Vector3(0, 1, 0),
    nodeId,
    distance,
  }
}

describe('placement surface hit selection', () => {
  it('selects a closer procedural landscape over a farther scene surface', () => {
    const sceneHit = createHit('ground', 50)
    const proceduralHit = createHit('dem', 20)

    expect(selectNearestPlacementSurfaceHit([sceneHit, proceduralHit])).toBe(proceduralHit)
  })

  it('selects a closer scene surface over a farther procedural landscape', () => {
    const sceneHit = createHit('bridge', 10)
    const proceduralHit = createHit('dem', 30)

    expect(selectNearestPlacementSurfaceHit([sceneHit, proceduralHit])).toBe(sceneHit)
  })

  it('keeps input order for equal-distance candidates', () => {
    const first = createHit('ground', 25)
    const second = createHit('dem', 25)

    expect(selectNearestPlacementSurfaceHit([first, second])).toBe(first)
  })

  it('ignores missing and non-finite candidates', () => {
    const hit = createHit('dem', 12)

    expect(selectNearestPlacementSurfaceHit([null, createHit('invalid', Number.NaN), hit])).toBe(hit)
  })
})
