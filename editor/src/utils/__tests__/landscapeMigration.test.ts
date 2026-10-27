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
import {
  createDemCoarseSurfaceHeightAt,
  createDemTerrainMeshBuilder,
} from '@schema/proceduralLandscape/demTerrain'
import { createDefaultProceduralLandscapeProps } from '@schema/proceduralLandscape/config'
import {
  resolveDemRoadbedSignature,
  resolveDemSurfaceOverrides,
} from '@schema/proceduralLandscape/runtime'
import { densifyRoadRows } from '@schema/proceduralLandscape/roadBandRows'
import { buildRoadProximityIndex } from '@schema/proceduralLandscape/roadProximity'
import type { LandscapeDensityField } from '@schema/proceduralLandscape/densityField'
import type { RoadTraceNode } from '@schema/proceduralLandscape/roadTrace'
import type { TerrainHeightGrid } from '@schema/proceduralLandscape/terrainSampler'
import type { TerrainDemRuntimeGridData } from '@schema/terrainDemRuntimeGrid'

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

function makeDemRuntimeGrid(
  size = 7,
  cellSize = 30,
  heightAt: (x: number, z: number) => number = (x, z) => z * 0.4 + x * 0.05,
): TerrainDemRuntimeGridData {
  const width = size
  const height = size
  const heights = new Float32Array(width * height)
  let maxElevation = 0
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const value = heightAt(col * cellSize, row * cellSize)
      heights[row * width + col] = value
      maxElevation = Math.max(maxElevation, value)
    }
  }
  return {
    width,
    height,
    cellSizeX: cellSize,
    cellSizeZ: cellSize,
    minX: 0,
    minZ: 0,
    maxX: (width - 1) * cellSize,
    maxZ: (height - 1) * cellSize,
    minElevation: 0,
    maxElevation,
    sourceMinElevation: 0,
    sourceMaxElevation: maxElevation,
    anchor: {
      latitudeDegrees: 0,
      longitudeDegrees: 0,
      groundElevationMeters: 0,
    },
    crs: {
      epsg: 32646,
      zone: 46,
      hemisphere: 'north',
    },
    filledRatio: 1,
    heights,
  }
}

function sampleDemHeight(data: TerrainDemRuntimeGridData, x: number, z: number): number {
  const fx = Math.max(0, Math.min(data.width - 1, x / data.cellSizeX))
  const fz = Math.max(0, Math.min(data.height - 1, z / data.cellSizeZ))
  const col = Math.min(data.width - 2, Math.floor(fx))
  const row = Math.min(data.height - 2, Math.floor(fz))
  const tx = fx - col
  const tz = fz - row
  const h00 = data.heights[row * data.width + col]!
  const h10 = data.heights[row * data.width + col + 1]!
  const h01 = data.heights[(row + 1) * data.width + col]!
  const h11 = data.heights[(row + 1) * data.width + col + 1]!
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz)
    + (h01 * (1 - tx) + h11 * tx) * tz
}

function buildDemGeometry(
  data: TerrainDemRuntimeGridData,
  roadbed: ReturnType<typeof createDemRoadbedTarget> | null,
  worldOffset: { x: number; y: number; z: number } | null = null,
): THREE.BufferGeometry {
  const builder = createDemTerrainMeshBuilder(data, 1, { roadbed, worldOffset })
  while (!builder.step(250)) {
    // Tiny fixture: this normally finishes on the first step.
  }
  expect(builder.error).toBeNull()
  expect(builder.geometry).not.toBeNull()
  return builder.geometry!
}

function geometryHeightAt(
  geometry: THREE.BufferGeometry,
  x: number,
  z: number,
): number | null {
  const position = geometry.getAttribute('position')
  for (let index = 0; index < position.count; index += 1) {
    if (
      Math.abs(position.getX(index) - x) <= 1e-4
      && Math.abs(position.getZ(index) - z) <= 1e-4
    ) {
      return position.getY(index)
    }
  }
  return null
}

function geometrySurfaceHeightAt(
  geometry: THREE.BufferGeometry,
  x: number,
  z: number,
): number | null {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  if (!index) {
    return null
  }
  let best: number | null = null
  for (let cursor = 0; cursor + 2 < index.count; cursor += 3) {
    const ia = index.getX(cursor)
    const ib = index.getX(cursor + 1)
    const ic = index.getX(cursor + 2)
    const ax = position.getX(ia)
    const az = position.getZ(ia)
    const bx = position.getX(ib)
    const bz = position.getZ(ib)
    const cx = position.getX(ic)
    const cz = position.getZ(ic)
    const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    if (Math.abs(denominator) < 1e-9) {
      continue
    }
    const wa = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator
    const wb = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator
    const wc = 1 - wa - wb
    if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) {
      continue
    }
    const height = wa * position.getY(ia) + wb * position.getY(ib) + wc * position.getY(ic)
    if (best == null || height > best) {
      best = height
    }
  }
  return best
}

describe('tree LOD bands', () => {
  it('stays monotonic for default and extreme slider values', () => {
    for (const nearDistance of [190, 40, 300] as const) {
      const bands = resolveTreeLodBands(nearDistance)
      expect(bands.cardNear).toBeLessThan(bands.cardFar)
      expect(bands.cardFar).toBe(Math.max(40, nearDistance))
      expect(bands.cardNear).toBeGreaterThanOrEqual(20)
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

  it('samples the same coarse triangles that the DEM builder renders', () => {
    const data = makeDemRuntimeGrid(9, 30)
    const worldOffset = { x: 500, y: 20, z: -300 }
    const rawAt = createDemCoarseSurfaceHeightAt(data, 1, { worldOffset })
    const roadNodes = [
      60,
      100,
      140,
      180,
    ].map((localX, index) => {
      const x = localX + worldOffset.x
      const z = 120 + worldOffset.z
      return {
        x,
        z,
        y: rawAt(x, z)!,
        heading: 0,
        index,
        lateral: 0,
        longitudinal: 0,
        turn: 0,
        headingDelta: 0,
      } satisfies RoadTraceNode
    })
    const roadField = buildRoadProximityIndex(roadNodes, { maxDistance: 90 })!
    const target = createDemRoadbedTarget({
      roadField,
      rawHeightAt: rawAt,
      halfWidth: 3.5,
      shoulderWidth: 2.5,
      demCellSize: 30,
      sideWidth: 24,
      coverageWidth: 10.5,
      coarseClearance: 2,
    })
    for (const sampleStep of [1, 3]) {
      const coarseSurfaceHeightAt = createDemCoarseSurfaceHeightAt(data, sampleStep, {
        roadbed: target,
        worldOffset,
      })
      const builder = createDemTerrainMeshBuilder(data, sampleStep, {
        roadbed: target,
        worldOffset,
      })
      while (!builder.step(250)) {
        // Tiny fixture: this normally finishes on the first step.
      }
      expect(builder.geometry).not.toBeNull()
      const geometry = builder.geometry!

      for (const localX of [45.5, 78.25, 120.75, 176.5]) {
        for (const localZ of [72.3, 96.5, 120, 143.7, 168.9]) {
          const localSurface = geometrySurfaceHeightAt(geometry, localX, localZ)
          const coarseSurface = coarseSurfaceHeightAt(
            localX + worldOffset.x,
            localZ + worldOffset.z,
          )
          expect(localSurface).not.toBeNull()
          expect(coarseSurface).not.toBeNull()
          expect(coarseSurface!).toBeCloseTo(localSurface! + worldOffset.y, 5)
        }
      }
    }
  })

  it('buries every outer roadbed edge below the visible coarse DEM', () => {
    const worldOffset = { x: 500, y: 20, z: -300 }
    const surfaces = [
      { name: 'flat', heightAt: () => 55 },
      { name: 'uphill', heightAt: (x: number, z: number) => 22 + x * 0.12 + z * 0.08 },
      { name: 'downhill', heightAt: (x: number, z: number) => 130 - x * 0.1 - z * 0.06 },
    ] as const
    const roadElevations = [
      { name: 'at-grade', offset: 0 },
      { name: 'fill', offset: 6 },
      { name: 'cut', offset: -6 },
    ] as const
    const cellPhases = [0, 5, 11, 17, 23, 29]
    const burialDepth = 0.3
    const skirtDepth = 0.5
    const lift = 0.01

    for (const surface of surfaces) {
      const data = makeDemRuntimeGrid(9, 30, surface.heightAt)
      const rawAt = createDemCoarseSurfaceHeightAt(data, 1, { worldOffset })
      for (const elevation of roadElevations) {
        for (const phase of cellPhases) {
          const roadZ = 95 + phase + worldOffset.z
          const roadNodes = [60, 100, 140, 180].map((localX, index) => {
            const x = localX + worldOffset.x
            return {
              x,
              z: roadZ,
              y: rawAt(x, roadZ)! + elevation.offset,
              heading: 0,
              index,
              lateral: 0,
              longitudinal: 0,
              turn: 0,
              headingDelta: 0,
            } satisfies RoadTraceNode
          })
          const roadField = buildRoadProximityIndex(roadNodes, { maxDistance: 90 })
          expect(roadField, `${surface.name}/${elevation.name}/${phase}`).not.toBeNull()
          if (!roadField) continue
          const target = createDemRoadbedTarget({
            roadField,
            rawHeightAt: rawAt,
            halfWidth: 3.5,
            shoulderWidth: 2.5,
            demCellSize: 30,
            sideWidth: 24,
            coverageWidth: 10.5,
            coarseClearance: 2,
          })
          const coarseSurfaceHeightAt = createDemCoarseSurfaceHeightAt(data, 1, {
            roadbed: target,
            worldOffset,
          })
          const result = createDemRoadbedTargetGeometry(
            densifyRoadRows(roadNodes, 2),
            target,
            {
              lateralStep: 3,
              lift,
              asphaltOverlap: 0.5,
              coarseSurfaceHeightAt,
              burialDepth,
              edgeSkirtDepth: skirtDepth,
              hostInverse: new THREE.Matrix4(),
            },
          )
          expect(result, `${surface.name}/${elevation.name}/${phase}`).not.toBeNull()
          if (!result) continue
          expect(result.maxOuterGap, `${surface.name}/${elevation.name}/${phase}`)
            .toBeLessThanOrEqual(1e-6)

          const position = result.geometry.getAttribute('position')
          const heightsByOuterEdge = new Map<string, number[]>()
          for (let index = 0; index < position.count; index += 1) {
            const x = position.getX(index)
            const z = position.getZ(index)
            if (Math.abs(roadField.distanceAt(x, z) - target.meshHalfWidth) > 0.02) {
              continue
            }
            const key = `${x.toFixed(4)}:${z.toFixed(4)}`
            const heights = heightsByOuterEdge.get(key) ?? []
            heights.push(position.getY(index))
            heightsByOuterEdge.set(key, heights)
          }
          expect(heightsByOuterEdge.size).toBeGreaterThan(0)
          for (const [key, heights] of heightsByOuterEdge) {
            const [edgeXText, edgeZText] = key.split(':')
            const edgeX = Number(edgeXText)
            const edgeZ = Number(edgeZText)
            const surfaceY = Math.max(...heights)
            const skirtY = Math.min(...heights)
            expect(surfaceY).toBeLessThanOrEqual(
              coarseSurfaceHeightAt(edgeX, edgeZ)! - burialDepth + lift + 1e-5,
            )
            expect(surfaceY - skirtY).toBeCloseTo(skirtDepth, 4)
          }
        }
      }
    }
  })

  it("keeps the outer edge buried where an elevated hairpin's aprons overlap", () => {
    const data = makeDemRuntimeGrid(11, 30, () => 70)
    const centerX = 150
    const centerZ = 150
    const radius = 24
    const nodeCount = 81
    const roadNodes = Array.from({ length: nodeCount }, (_, index) => {
      const angle = -Math.PI / 2 + Math.PI * (index / (nodeCount - 1))
      const nextAngle = -Math.PI / 2 + Math.PI * Math.min(1, (index + 1) / (nodeCount - 1))
      return {
        x: centerX + Math.cos(angle) * radius,
        z: centerZ + Math.sin(angle) * radius,
        y: 90 + 10 * (index / (nodeCount - 1)),
        heading: Math.atan2(
          Math.sin(nextAngle) - Math.sin(angle),
          Math.cos(nextAngle) - Math.cos(angle),
        ),
        index,
        lateral: 0,
        longitudinal: 0,
        turn: 0,
        headingDelta: 0,
      } satisfies RoadTraceNode
    })
    const roadField = buildRoadProximityIndex(roadNodes, { maxDistance: 90 })
    expect(roadField).not.toBeNull()
    if (!roadField) return
    const rawHeightAt = createDemCoarseSurfaceHeightAt(data, 1)
    const target = createDemRoadbedTarget({
      roadField,
      rawHeightAt,
      halfWidth: 3.5,
      shoulderWidth: 2.5,
      demCellSize: 30,
      sideWidth: 24,
      coverageWidth: 10.5,
      coarseClearance: 2,
    })
    const result = createDemRoadbedTargetGeometry(
      densifyRoadRows(roadNodes, 2),
      target,
      {
        lateralStep: 3,
        lift: 0.01,
        asphaltOverlap: 0.5,
        coarseSurfaceHeightAt: createDemCoarseSurfaceHeightAt(data, 1, {
          roadbed: target,
        }),
        burialDepth: 0.3,
        edgeSkirtDepth: 0.5,
        hostInverse: new THREE.Matrix4(),
      },
    )
    expect(result).not.toBeNull()
    expect(result!.maxOuterGap).toBeLessThanOrEqual(1e-6)
  })

  it('rebuilds the coarse DEM from the latest committed roadbed target', () => {
    const data = makeDemRuntimeGrid()
    const worldOffset = { x: 500, y: 20, z: -300 }
    const rawAt = (x: number, z: number): number => (
      sampleDemHeight(data, x - worldOffset.x, z - worldOffset.z) + worldOffset.y
    )
    const roadNode = (index: number, x: number, z: number): RoadTraceNode => ({
      ...node(index, x, rawAt(x, z)),
      z,
    })
    const roadAt = (z: number): ReturnType<typeof buildRoadProximityIndex> => (
      buildRoadProximityIndex([
        roadNode(0, worldOffset.x, worldOffset.z + z),
        roadNode(1, worldOffset.x + 180, worldOffset.z + z),
      ], { maxDistance: 80 })
    )
    const firstRoad = roadAt(90)
    const secondRoad = roadAt(150)
    expect(firstRoad).not.toBeNull()
    expect(secondRoad).not.toBeNull()
    if (!firstRoad || !secondRoad) return

    const makeTarget = (roadField: NonNullable<ReturnType<typeof roadAt>>) => createDemRoadbedTarget({
      roadField,
      rawHeightAt: rawAt,
      halfWidth: 2,
      shoulderWidth: 2.5,
      demCellSize: 30,
      sideWidth: 15,
      coverageWidth: 4,
      coarseClearance: 2,
    })
    const firstTarget = makeTarget(firstRoad)
    const secondTarget = makeTarget(secondRoad)
    const rawMesh = buildDemGeometry(data, null)
    const firstMesh = buildDemGeometry(data, firstTarget, worldOffset)
    const secondMesh = buildDemGeometry(data, secondTarget, worldOffset)

    const rawAtFirst = geometryHeightAt(rawMesh, 90, 90)!
    const rawAtSecond = geometryHeightAt(rawMesh, 90, 150)!
    expect(geometryHeightAt(firstMesh, 90, 90)!).toBeLessThan(rawAtFirst - 1)
    expect(geometryHeightAt(firstMesh, 90, 150)!).toBeCloseTo(rawAtSecond, 4)
    expect(geometryHeightAt(secondMesh, 90, 150)!).toBeLessThan(rawAtSecond - 1)

    // Simulate the generated high-resolution roadbed and ensure neither the
    // coarse mesh nor the roadbed rises above the asphalt surface.
    const rows = densifyRoadRows([
      roadNode(0, worldOffset.x, worldOffset.z + 90),
      roadNode(1, worldOffset.x + 180, worldOffset.z + 90),
    ], 4)
    const roadbed = createDemRoadbedTargetGeometry(rows, firstTarget, {
      lateralStep: 3,
      lift: 0.01,
      asphaltOverlap: 0.5,
      hostInverse: new THREE.Matrix4(),
    })
    expect(roadbed).not.toBeNull()
    if (!roadbed) return

    const overlapPosition = roadbed.geometry.getAttribute('position')
    let minimumRoadDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < overlapPosition.count; index += 1) {
      const x = overlapPosition.getX(index)
      const y = overlapPosition.getY(index)
      const z = overlapPosition.getZ(index)
      const distance = firstRoad.distanceAt(x, z)
      minimumRoadDistance = Math.min(
        minimumRoadDistance,
        distance,
      )
      if (distance < firstTarget.halfWidth) {
        expect(y).toBeLessThanOrEqual(firstRoad.heightAt(x, z)! - 0.03)
      }
    }
    expect(minimumRoadDistance).toBeLessThanOrEqual(firstTarget.halfWidth - 0.45)

    const auditAsphalt = (geometry: THREE.BufferGeometry): void => {
      const position = geometry.getAttribute('position')
      for (let index = 0; index < position.count; index += 1) {
        const x = position.getX(index)
        const z = position.getZ(index)
        if (firstRoad.distanceAt(x, z) > firstTarget.halfWidth) {
          continue
        }
        const designY = firstRoad.heightAt(x, z)
        expect(designY).not.toBeNull()
        expect(position.getY(index)).toBeLessThan(designY! + 0.05 - 1e-4)
      }
    }
    auditAsphalt(firstMesh)
    auditAsphalt(roadbed.geometry)

    const roadbedPosition = roadbed.geometry.getAttribute('position')
    const roadbedIndex = roadbed.geometry.getIndex()
    expect(roadbedIndex).not.toBeNull()
    for (let triangle = 0; triangle < roadbedIndex!.count; triangle += 3) {
      const a = roadbedIndex!.getX(triangle)
      const b = roadbedIndex!.getX(triangle + 1)
      const c = roadbedIndex!.getX(triangle + 2)
      const centerX = (roadbedPosition.getX(a) + roadbedPosition.getX(b) + roadbedPosition.getX(c)) / 3
      const centerZ = (roadbedPosition.getZ(a) + roadbedPosition.getZ(b) + roadbedPosition.getZ(c)) / 3
      expect(firstRoad.distanceAt(centerX, centerZ)).toBeGreaterThanOrEqual(
        firstTarget.halfWidth - 0.5 - 1e-4,
      )
    }
  })

  it('changes the DEM signature only for committed road geometry or grading settings', () => {
    const props = createDefaultProceduralLandscapeProps({ id: 'dem-roadbed-signature' })
    const options = {
      cellSize: 30,
      sampleStep: 1,
      target: null,
      routeNodeCount: 0,
      routeLength: 0,
    }
    const initial = resolveDemRoadbedSignature(props, options)
    const draftOnly = {
      ...props,
      road: {
        ...props.road,
        waypoints: [{ x: 10, z: 20 }],
      },
    }
    expect(resolveDemRoadbedSignature(draftOnly, options)).toBe(initial)

    const committed = {
      ...props,
      generationRevision: 1,
      road: {
        ...props.road,
        enabled: true,
        generatedRoute: {
          waypoints: [{ x: 10, z: 20 }],
          strategy: 'seeded' as const,
          termination: 'boundary' as const,
          style: 'normal' as const,
          seed: 1,
          waypointTolerance: 12,
          pathDeviation: 160,
          revision: 1,
        },
      },
    }
    const committedSignature = resolveDemRoadbedSignature(committed, {
      ...options,
      routeNodeCount: 50,
      routeLength: 800,
    })
    expect(committedSignature).not.toBe(initial)
    expect(resolveDemRoadbedSignature({
      ...committed,
      road: { ...committed.road, generatedRoute: null },
    }, options)).not.toBe(committedSignature)
    expect(resolveDemRoadbedSignature({
      ...committed,
      road: { ...committed.road, width: 6 },
    }, options)).not.toBe(committedSignature)
  })

  it('disables raster vertex flattening for both already-graded DEM surfaces', () => {
    expect(resolveDemSurfaceOverrides('terrain', 2.75)).toMatchObject({
      uPlRoadbedCutProx: 2.75,
      uPlFlattenStrength: 0,
      uPlRoadDisplacement: 0,
    })
    expect(resolveDemSurfaceOverrides('roadbed', 0)).toMatchObject({
      uPlRoadbedCutProx: 0,
      uPlFlattenStrength: 0,
      uPlRoadDisplacement: 0,
    })
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
