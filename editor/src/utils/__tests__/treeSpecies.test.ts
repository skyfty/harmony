import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { LandscapeDensityField } from '@schema/proceduralLandscape/densityField'
import { planTreeChunk } from '@schema/proceduralLandscape/chunkPlan'
import { planFarForestRings } from '@schema/proceduralLandscape/farForest'
import type { TerrainHeightGrid } from '@schema/proceduralLandscape/terrainSampler'
import {
  buildTreeSpeciesField,
  SLOWROADS_TREE_TYPE_FEATURE_METERS,
  slowroadsTreeLineBounds,
  slowroadsTreeLineFactor,
  slowroadsTreeSpeciesAt,
} from '@schema/proceduralLandscape/treeSpecies'
import { planWorldForest } from '@schema/proceduralLandscape/worldForest'

function makeGrid(
  size = 512,
  heightAt: (x: number, z: number) => number = () => 0,
): TerrainHeightGrid {
  const cellSize = 16
  const cols = Math.floor(size / cellSize) + 1
  const rows = cols
  const heights = new Float32Array(cols * rows)
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const y = heightAt(col * cellSize, row * cellSize)
      heights[row * cols + col] = y
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  return {
    minX: 0,
    minZ: 0,
    maxX: size,
    maxZ: size,
    cellSize,
    cols,
    rows,
    minY,
    maxY,
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
    sampleNormal: () => new THREE.Vector3(0, 1, 0),
  }
}

function makeDensity(size: number): LandscapeDensityField {
  return {
    width: 1,
    height: 1,
    data: new Uint8Array([255]),
    minX: 0,
    minZ: 0,
    sizeX: size,
    sizeZ: size,
    sampleUnit: () => 1,
    memoryBytes: 1,
  }
}

describe('slowroads tree species policy', () => {
  it('uses the official ~273m spatial feature scale', () => {
    expect(SLOWROADS_TREE_TYPE_FEATURE_METERS).toBeCloseTo(3000 / 11, 6)
  })

  it('is deterministic and independent of elevation', () => {
    const first = slowroadsTreeSpeciesAt(123, 1840, -920)
    const second = slowroadsTreeSpeciesAt(123, 1840, -920)
    expect(first).toBe(second)
    expect([0, 1]).toContain(first)
  })

  it('bakes a deterministic field with both species present', () => {
    const options = {
      minX: -5000,
      minZ: -5000,
      sizeX: 10_000,
      sizeZ: 10_000,
      seed: 456268425,
      resolution: 256,
    }
    const field = buildTreeSpeciesField(options)
    const second = buildTreeSpeciesField(options)
    expect(field.data).toEqual(second.data)

    let conifer = 0
    let total = 0
    for (let z = -5000; z <= 5000; z += 100) {
      for (let x = -5000; x <= 5000; x += 100) {
        total += 1
        conifer += field.sampleSpecies(x, z)
      }
    }
    const fraction = conifer / total
    expect(fraction).toBeGreaterThan(0.25)
    expect(fraction).toBeLessThan(0.75)
  })

  it('produces spatial stands rather than per-tree confetti', () => {
    const field = buildTreeSpeciesField({
      minX: 0,
      minZ: 0,
      sizeX: 6000,
      sizeZ: 6000,
      seed: 1489682577,
      resolution: 512,
    })
    let same = 0
    let total = 0
    for (let z = 100; z < 5900; z += 60) {
      let previous = field.sampleSpecies(0, z)
      for (let x = 60; x < 5900; x += 60) {
        const current = field.sampleSpecies(x, z)
        total += 1
        if (current === previous) same += 1
        previous = current
      }
    }
    expect(same / total).toBeGreaterThan(0.6)
  })

  it('maps the official 150m/300m band onto relative DEM height', () => {
    const bounds = slowroadsTreeLineBounds(1000, 2000)
    expect(bounds.enabled).toBe(true)
    expect(bounds.midY).toBe(1500)
    expect(bounds.topY).toBe(2000)
    expect(slowroadsTreeLineFactor(1000, bounds)).toBe(1)
    expect(slowroadsTreeLineFactor(1500, bounds)).toBe(1)
    expect(slowroadsTreeLineFactor(1750, bounds)).toBeCloseTo(0.5)
    expect(slowroadsTreeLineFactor(2000, bounds)).toBe(0)

    const flat = slowroadsTreeLineBounds(42, 42)
    expect(flat.enabled).toBe(false)
    expect(slowroadsTreeLineFactor(42, flat)).toBe(1)
  })

  it('uses the same species in world forest placements', () => {
    const grid = makeGrid(512, () => 100)
    const field = buildTreeSpeciesField({
      minX: grid.minX,
      minZ: grid.minZ,
      sizeX: grid.maxX - grid.minX,
      sizeZ: grid.maxZ - grid.minZ,
      seed: 123,
      resolution: 128,
    })
    const placements = planWorldForest({
      seed: 123,
      cellSize: 20,
      maxTrees: 5000,
      maxSlope: 1,
      roadClearance: 0,
      waterLevel: -10,
      minHeight: null,
      minScale: 5,
      maxScale: 12,
      densityMultiplier: 1,
    }, {
      grid,
      density: makeDensity(512),
      roadField: null,
      heightAt: (x, z) => grid.sampleHeight(x, z),
      speciesAt: (x, z) => field.sampleSpecies(x, z),
    })
    expect(placements.length).toBeGreaterThan(500)
    for (const placement of placements) {
      expect(placement.species).toBe(field.sampleSpecies(placement.x, placement.z))
    }
  })

  it('stops world forest placements at the relative tree line', () => {
    const grid = makeGrid(512, (_x, z) => z * 2)
    const placements = planWorldForest({
      seed: 321,
      cellSize: 20,
      maxTrees: 2000,
      maxSlope: 1,
      roadClearance: 0,
      waterLevel: -10,
      minHeight: null,
      minScale: 5,
      maxScale: 12,
      densityMultiplier: 1,
    }, {
      grid,
      density: makeDensity(512),
      roadField: null,
      heightAt: (x, z) => grid.sampleHeight(x, z),
    })
    expect(placements.length).toBeGreaterThan(0)
    expect(Math.max(...placements.map((placement) => placement.y))).toBeLessThan(grid.maxY)
  })

  it('uses the same spatial species in chunk and far-forest paths', () => {
    const grid = makeGrid(2048, () => 0)
    const density = makeDensity(2048)
    const chunk = planTreeChunk({
      seed: 777,
      chunkX: 0,
      chunkZ: 0,
      chunkSize: 256,
      densityMultiplier: 1,
      maxSlope: 1,
      roadClearance: 0,
      roadHalfWidth: 0,
      roadShoulderWidth: 0,
      minScale: 5,
      maxScale: 12,
      minHeight: null,
    }, { grid, density, roadField: null })
    expect(chunk.length).toBeGreaterThan(0)
    for (const placement of chunk) {
      expect(placement.species).toBe(slowroadsTreeSpeciesAt(777, placement.x, placement.z))
    }

    const far = planFarForestRings({
      seed: 777,
      centerX: 1024,
      centerZ: 1024,
      innerRadius: 300,
      outerRadius: 900,
      budget: 20_000,
      maxSlope: 1,
      roadClearance: 0,
      waterLevel: -10,
      minScale: 5,
      maxScale: 12,
      densityMultiplier: 1,
    }, { grid, density, roadField: null })
    expect(far.placements.length).toBeGreaterThan(0)
    for (const placement of far.placements) {
      expect(placement.species).toBe(slowroadsTreeSpeciesAt(777, placement.x, placement.z))
    }
  })
})
