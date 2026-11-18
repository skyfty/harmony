import { describe, expect, it } from 'vitest'

import {
  buildRoadFieldData,
  buildRoadFieldDataSteps,
} from '@schema/proceduralLandscape/roadField'

function createPath() {
  return Array.from({ length: 8 }, (_value, index) => ({
    x: index * 10,
    y: index * 0.2,
    z: index * 2,
    heading: 0,
  }))
}

const options = {
  minX: -20,
  minZ: -20,
  sizeX: 120,
  sizeZ: 80,
  minY: -10,
  maxY: 20,
  maxInfluence: 12,
  maxResolution: 64,
}

describe('road field cooperative generation', () => {
  it('yields while building a road raster', () => {
    let nowMs = 0
    const steps = buildRoadFieldDataSteps(createPath(), {
      ...options,
      sliceNow: () => {
        nowMs += 10
        return nowMs
      },
      sliceBudgetMs: 8,
    })
    let yieldCount = 0
    let result = steps.next()
    while (!result.done) {
      yieldCount += 1
      result = steps.next()
    }

    expect(yieldCount).toBeGreaterThan(0)
    expect(result.value?.width).toBeGreaterThan(1)
  })

  it('preserves the synchronous road field result', () => {
    const field = buildRoadFieldData(createPath(), options)
    expect(field).not.toBeNull()
    expect(field?.distance.length).toBe((field?.width ?? 0) * (field?.height ?? 0))
  })
})
