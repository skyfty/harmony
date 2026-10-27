import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { conformSegmentsToSurface } from '@/utils/surfaceSegmentConform'

describe('surface segment conforming', () => {
  it('densifies a straight wall segment and samples every vertex height', () => {
    const segments = conformSegmentsToSurface(
      [{
        start: new THREE.Vector3(0, 0, 0),
        end: new THREE.Vector3(12, 0, 0),
      }],
      (x) => x * 0.5,
      3,
    )

    expect(segments).toHaveLength(4)
    expect(segments[0]?.start.y).toBeCloseTo(0)
    expect(segments[segments.length - 1]?.end.y).toBeCloseTo(6)
    for (const segment of segments) {
      expect(segment.start.y).toBeCloseTo(segment.start.x * 0.5)
      expect(segment.end.y).toBeCloseTo(segment.end.x * 0.5)
    }
  })

  it('keeps interpolated endpoint heights when sampling is unavailable', () => {
    const segments = conformSegmentsToSurface(
      [{
        start: new THREE.Vector3(0, 10, 0),
        end: new THREE.Vector3(10, 20, 0),
      }],
      () => null,
      5,
    )

    expect(segments).toHaveLength(2)
    expect(segments[0]?.end.y).toBeCloseTo(15)
    expect(segments[1]?.end.y).toBeCloseTo(20)
  })
})
