import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { buildRoadPreviewBuild } from '@/components/editor/RoadPreviewRenderer'

describe('road placement height sampling', () => {
  it('samples intermediate road heights from the active surface', () => {
    const build = buildRoadPreviewBuild(
      [new THREE.Vector3(0, 20, 0)],
      new THREE.Vector3(10, 20, 0),
      2,
      {
        heightSampler: (x) => 20 + x,
        samplingDensityFactor: 1,
      },
    )
    const heights = build?.definition.segmentHeights?.[0] ?? []

    expect(heights.length).toBeGreaterThan(2)
    expect(heights[0]).toBeCloseTo(20)
    expect(heights[heights.length - 1]).toBeCloseTo(30)
    expect(heights.some((height) => height > 20 && height < 30)).toBe(true)
  })

  it('falls back to endpoint interpolation when a surface sample is unavailable', () => {
    const build = buildRoadPreviewBuild(
      [new THREE.Vector3(0, 12, 0)],
      new THREE.Vector3(10, 22, 0),
      2,
      {
        heightSampler: () => Number.NaN,
        samplingDensityFactor: 1,
      },
    )
    const heights = build?.definition.segmentHeights?.[0] ?? []

    expect(heights[0]).toBeCloseTo(12)
    expect(heights[heights.length - 1]).toBeCloseTo(22)
    expect(heights.some((height) => height > 12 && height < 22)).toBe(true)
    expect(heights.every((height) => height !== 0)).toBe(true)
  })
})
