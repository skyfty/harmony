import { describe, expect, it } from 'vitest'
import {
  fitTerrainFlatteningTransition,
} from '@schema/proceduralLandscape/terrainTransitionFit'
import type {
  DemTerrainFlatteningTarget,
} from '@schema/proceduralLandscape/terrainFlattening'

function makeTarget(blendWidth: number): DemTerrainFlatteningTarget {
  return {
    gradeY: 40,
    influenceWidth: blendWidth,
    snapshot: {
      edgeBlendWidth: blendWidth,
      footprint: {
        kind: 'polygon',
        contourWorldXZ: [
          [-10, -10],
          [10, -10],
          [10, 10],
          [-10, 10],
        ],
      },
    },
  } as unknown as DemTerrainFlatteningTarget
}

describe('terrain transition fitting', () => {
  it('widens a steep polygon edge until the complete smoothstep profile fits', () => {
    const result = fitTerrainFlatteningTransition(
      makeTarget(24),
      () => 50,
      {
        maxGradeDegrees: 10,
        minBlendWidth: 8,
        maxBlendWidth: 100,
        perimeterSpacing: 5,
        profileSamples: 16,
        widthStep: 2,
      },
    )

    expect(result.reason).toBe('widen')
    expect(result.requiresChange).toBe(true)
    expect(result.recommendedBlendWidth).toBeGreaterThanOrEqual(84)
    expect(result.recommendedBlendWidth).toBeLessThanOrEqual(90)
    expect(result.recommendedMaxGradeDegrees).toBeLessThanOrEqual(10.001)
    expect(result.worstPoint?.heightDelta).toBeCloseTo(10)
  })

  it('leaves an already gentle transition unchanged', () => {
    const result = fitTerrainFlatteningTransition(
      makeTarget(100),
      () => 50,
      {
        maxGradeDegrees: 10,
        maxBlendWidth: 100,
      },
    )

    expect(result.reason).toBe('within-threshold')
    expect(result.requiresChange).toBe(false)
    expect(result.recommendedBlendWidth).toBe(100)
  })

  it('reports unsupported and unavailable terrain cases without fabricating a fit', () => {
    const corridor = makeTarget(24)
    corridor.snapshot.footprint = {
      kind: 'corridor',
      chains: [],
      halfWidth: 2,
    }
    expect(fitTerrainFlatteningTransition(corridor, () => 50).reason)
      .toBe('unsupported-footprint')

    expect(fitTerrainFlatteningTransition(makeTarget(24), () => null).reason)
      .toBe('insufficient-samples')
  })
})
