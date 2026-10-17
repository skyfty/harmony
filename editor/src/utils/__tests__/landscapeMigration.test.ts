import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  createWorldForestPlacementIndex,
  planWorldForest,
} from '@schema/proceduralLandscape/worldForest'
import { planRoadBucket } from '@schema/proceduralLandscape/chunkPlan'
import { resolveTreeLodBands } from '@schema/proceduralLandscape/treeLod'
import {
  createDemRoadbedTargetGeometry,
  createDemRoadbedTarget,
} from '@schema/proceduralLandscape/demRoadbed'
import { densifyRoadRows } from '@schema/proceduralLandscape/roadBandRows'
import { buildRoadProximityIndex } from '@schema/proceduralLandscape/roadProximity'
import type { LandscapeDensityField } from '@schema/proceduralLandscape/densityField'
import type { RoadTraceNode } from '@schema/proceduralLandscape/roadTrace'
import type { TerrainHeightGrid } from '@schema/proceduralLandscape/terrainSampler'

function makeGrid(size = 200, heightAt: (x: number, z: number) => number = () => 10): TerrainHeightGrid {
  const cellSize = 10
  const cols = Math.floor(size / cellSize) + 1
  const rows = cols
  const heights = new Float32Array(cols * rows)
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      heights[row * cols + col] = heightAt(col * cellSize, row * cellSize)
    }
  }
  const grid: TerrainHeightGrid = {
    minX: 0,
    minZ: 0,
    maxX: size,
    maxZ: size,
    cellSize,
    cols,
    rows,
    minY: 0,
    maxY: 100,
    averageEdgeLength: cellSize,
    heights,
    coverage: new Uint8Array(cols * rows).fill(1),
    memoryBytes: heights.byteLength + cols * rows,
    contains: (x, z) => x >= 0 && x <= size && z >= 0 && z <= size,
    sampleHeight(x, z) {
      const col = Math.max(0, Math.min(cols - 1, Math.round(x / cellSize)))
      const row = Math.max(0, Math.min(rows - 1, Math.round(z / cellSize)))
      return heights[row * cols + col] ?? null
    },
    sampleNormal: () => null,
  }
  return grid
}

function makeDensity(): LandscapeDensityField {
  const width = 32
  const height = 32
  const data = new Uint8Array(width * height).fill(255)
  return {
    width,
    height,
    data,
    minX: 0,
    minZ: 0,
    sizeX: 200,
    sizeZ: 200,
    sampleUnit: () => 1,
    memoryBytes: data.byteLength,
  }
}

describe('tree LOD bands', () => {
  it('stays monotonic for default and extreme slider values', () => {
    for (const [nearDistance, meshRadius] of [
      [190, 90],
      [40, 90],
      [300, 300],
      [190, 0],
      [40, 300],
    ] as const) {
      const bands = resolveTreeLodBands(nearDistance, meshRadius)
      expect(bands.cardNear).toBeLessThan(bands.cardFar)
      if (meshRadius === 0) {
        expect(bands.meshNear).toBe(0)
        expect(bands.meshFar).toBe(0)
      } else {
        expect(bands.meshNear).toBeLessThan(bands.meshFar)
        expect(bands.meshFar).toBeLessThan(bands.cardNear)
      }
    }
  })
})

describe('world forest', () => {
  it('is deterministic and respects its instance budget', () => {
    const grid = makeGrid()
    const density = makeDensity()
    const params = {
      seed: 123,
      cellSize: 20,
      maxTrees: 50,
      maxSlope: 1,
      roadClearance: 0,
      waterLevel: -10,
      minHeight: null,
      minScale: 5,
      maxScale: 12,
      densityMultiplier: 1,
    }
    const deps = { grid, density, roadField: null, heightAt: (x: number, z: number) => grid.sampleHeight(x, z) }
    const first = planWorldForest(params, deps)
    const second = planWorldForest(params, deps)
    expect(first.length).toBe(50)
    expect(first).toEqual(second)
  })

  it('queries exactly the same placements inside a radius', () => {
    const placements = [
      { x: 10, z: 10, y: 0, rotation: 0, scale: 8, variant: 0, species: 0 as const, rank: 0 },
      { x: 100, z: 100, y: 0, rotation: 0, scale: 8, variant: 0, species: 0 as const, rank: 1 },
    ]
    const index = createWorldForestPlacementIndex(placements)
    expect(index.queryCircle(15, 15, 20)).toEqual([placements[0]])
  })
})

describe('DEM roadbed target', () => {
  function node(index: number, x: number, y: number): RoadTraceNode {
    return {
      x,
      z: 100,
      y,
      heading: 0,
      index,
      lateral: 0,
      longitudinal: 0,
      turn: 0,
      headingDelta: 0,
    }
  }

  it('keeps one design height across the carriageway and meets raw terrain outside', () => {
    const roadField = buildRoadProximityIndex([
      node(0, 0, 0),
      node(1, 200, 0),
    ], { maxDistance: 120 })
    expect(roadField).not.toBeNull()
    if (!roadField) return
    const target = createDemRoadbedTarget({
      roadField,
      rawHeightAt: x => x * 0.2,
      halfWidth: 3.5,
      shoulderWidth: 2.5,
      demCellSize: 30,
    })
    const left = target.heightAt(100, 95.5)
    const right = target.heightAt(100, 104.5)
    expect(left).toBeCloseTo(right, 6)
    expect(target.rawHeightAt(100, 100 - target.outerHalfWidth))
      .toBeCloseTo(target.heightAt(100, 100 - target.outerHalfWidth), 6)
    expect(target.coarseHeightAt(100, 100)).toBeLessThan(target.heightAt(100, 100))
  })

  it('builds upward-facing roadbed triangles so Lambert lighting matches the terrain', () => {
    const nodes = [
      node(0, 0, 0),
      node(1, 200, 0),
    ]
    const roadField = buildRoadProximityIndex(nodes, { maxDistance: 120 })
    expect(roadField).not.toBeNull()
    if (!roadField) return
    const target = createDemRoadbedTarget({
      roadField,
      rawHeightAt: x => x * 0.2,
      halfWidth: 3.5,
      shoulderWidth: 2.5,
      demCellSize: 30,
    })
    const result = createDemRoadbedTargetGeometry(
      densifyRoadRows(nodes, 4),
      target,
      { lateralStep: 3, hostInverse: new THREE.Matrix4() },
    )
    expect(result).not.toBeNull()
    const geometry = result!.geometry
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()!
    const a = new THREE.Vector3().fromBufferAttribute(position, index.getX(0))
    const b = new THREE.Vector3().fromBufferAttribute(position, index.getX(1))
    const c = new THREE.Vector3().fromBufferAttribute(position, index.getX(2))
    const normal = b.sub(a).cross(c.sub(a)).normalize()
    expect(normal.y).toBeGreaterThan(0.9)
  })
})

describe('vegetation surface sampling', () => {
  it('places corridor grass on the final roadbed surface instead of the raw DEM', () => {
    const nodes = [
      { x: 0, z: 100, y: 10, heading: 0, index: 0, lateral: 0, longitudinal: 0, turn: 0, headingDelta: 0 },
      { x: 120, z: 100, y: 10, heading: 0, index: 1, lateral: 0, longitudinal: 0, turn: 0, headingDelta: 0 },
    ]
    const roadField = buildRoadProximityIndex(nodes, { maxDistance: 80 })
    expect(roadField).not.toBeNull()
    if (!roadField) return
    const result = planRoadBucket(
      {
        seed: 1,
        bucketIndex: 0,
        fromX: 0,
        fromZ: 100,
        toX: 120,
        toZ: 100,
        halfWidth: 3.5,
        shoulderWidth: 2.5,
        corridorWidth: 12,
        grassDensity: 1,
        sinkNearRoad: 0,
        bushesEnabled: false,
        bushesDensity: 0,
        waterLevel: 0,
        flowerDensity: 0,
        tallGrassDensity: 0,
      },
      {
        grid: makeGrid(),
        density: makeDensity(),
        roadField,
        surfaceHeightAt: () => 20,
        surfaceNormalAt: () => ({ x: 0, y: 1, z: 0 }),
      },
    )
    expect(result.grass.length).toBeGreaterThan(0)
    for (const placement of result.grass) {
      expect(placement.y).toBeGreaterThanOrEqual(19.5)
    }
  })
})
