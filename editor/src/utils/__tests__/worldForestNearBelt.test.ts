import { describe, expect, it } from 'vitest'
import { planWorldForestCorridor } from '@schema/proceduralLandscape/worldForest'
import { buildRoadProximityIndex } from '@schema/proceduralLandscape/roadProximity'
import type { LandscapeDensityField } from '@schema/proceduralLandscape/densityField'
import type { RoadTraceNode } from '@schema/proceduralLandscape/roadTrace'
import type { TerrainHeightGrid } from '@schema/proceduralLandscape/terrainSampler'

function createFlatGrid(size = 400): TerrainHeightGrid {
  const cellSize = 10
  const count = Math.floor(size / cellSize) + 1
  const heights = new Float32Array(count * count).fill(10)
  return {
    minX: 0,
    minZ: 0,
    maxX: size,
    maxZ: size,
    cellSize,
    cols: count,
    rows: count,
    minY: 0,
    maxY: 100,
    averageEdgeLength: cellSize,
    heights,
    coverage: new Uint8Array(count * count).fill(1),
    memoryBytes: heights.byteLength + count * count,
    contains: (x, z) => x >= 0 && x <= size && z >= 0 && z <= size,
    sampleHeight: () => 10,
    sampleNormal: () => null,
  }
}

function createSparseDensity(): LandscapeDensityField {
  return {
    width: 1,
    height: 1,
    data: new Uint8Array([0]),
    minX: 0,
    minZ: 0,
    sizeX: 400,
    sizeZ: 400,
    sampleUnit: () => 0,
    memoryBytes: 1,
  }
}

function createRoadNodes(): RoadTraceNode[] {
  return Array.from({ length: 9 }, (_, index) => ({
    x: 200,
    z: 40 + index * 40,
    y: 10,
    heading: Math.PI / 2,
    index,
    lateral: 0,
    longitudinal: 0,
    turn: 0,
    headingDelta: 0,
  }))
}

describe('world forest near-road belt', () => {
  it('keeps the innermost road bands populated when surrounding density is sparse', () => {
    const grid = createFlatGrid()
    const nodes = createRoadNodes()
    const roadField = buildRoadProximityIndex(nodes, { maxDistance: 80 })
    expect(roadField).not.toBeNull()
    if (!roadField) {
      return
    }

    const placements = planWorldForestCorridor(
      {
        seed: 1234,
        cellSize: 64,
        maxTrees: 1000,
        maxSlope: 0.5,
        roadClearance: 10,
        waterLevel: 0,
        minHeight: null,
        minScale: 5,
        maxScale: 12,
        densityMultiplier: 0.75,
      },
      {
        grid,
        density: createSparseDensity(),
        roadField,
        heightAt: () => 10,
        speciesAt: () => 0,
      },
      nodes,
      {
        maxTrees: 1000,
        maxDistance: 80,
        nearBeltBands: 2,
      },
    )

    expect(placements.length).toBeGreaterThan(0)
    expect(placements.some((placement) => (
      roadField.distanceAt(placement.x, placement.z) <= 35
    ))).toBe(true)
  })

  it('does not create the near belt when forest density is disabled', () => {
    const grid = createFlatGrid()
    const nodes = createRoadNodes()
    const roadField = buildRoadProximityIndex(nodes, { maxDistance: 80 })
    expect(roadField).not.toBeNull()
    if (!roadField) {
      return
    }

    const placements = planWorldForestCorridor(
      {
        seed: 1234,
        cellSize: 64,
        maxTrees: 1000,
        maxSlope: 0.5,
        roadClearance: 10,
        waterLevel: 0,
        minHeight: null,
        minScale: 5,
        maxScale: 12,
        densityMultiplier: 0,
      },
      {
        grid,
        density: createSparseDensity(),
        roadField,
        heightAt: () => 10,
        speciesAt: () => 0,
      },
      nodes,
      {
        maxTrees: 1000,
        maxDistance: 80,
        nearBeltBands: 2,
      },
    )

    expect(placements).toHaveLength(0)
  })
})
