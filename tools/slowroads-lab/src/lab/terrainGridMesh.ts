import * as THREE from 'three'
import { sampleDemGridHeight, type DemTerrainGrid } from '../core/demTerrain'
import type { Heightfield } from '../core/heightfield'
import type { RoadbedTarget } from '../core/roadbed'
import { bakeTerrainHeight, type RoadProfile } from '../core/roadProfile'
import {
  createTerrainGridSurface,
  sampleRoadCrossSection,
  type TerrainSurfaceHeightSource,
} from '../core/terrainSurface'

export interface TerrainGridMeshBuilderOptions {
  /** 1 = native DEM grid, 2 = half, 4 = quarter. */
  sampleStep?: number
  /** Optional road flattening baked into the coarse terrain. */
  field?: Heightfield
  roadProfile?: RoadProfile | null
  /** Cut/fill roadbed used by the DEM scene. */
  roadbed?: RoadbedTarget | null
}

export interface TerrainGridMeshBuilder {
  step(budgetMs?: number): boolean
  readonly progress: number
  readonly geometry: THREE.BufferGeometry | null
  readonly vertexCount: number
  readonly triangleCount: number
  readonly cols: number
  readonly rows: number
  readonly cellSizeX: number
  readonly cellSizeZ: number
  readonly surface: TerrainSurfaceHeightSource | null
}

/**
 * Builds a rectangular terrain mesh from an already-baked DEM height grid.
 * Detail noise is evaluated once while creating the grid, never per vertex.
 */
export function createTerrainGridMeshBuilder(
  grid: DemTerrainGrid,
  options: TerrainGridMeshBuilderOptions = {},
): TerrainGridMeshBuilder {
  const sampleStep = Math.max(1, Math.min(8, Math.round(options.sampleStep ?? 1)))
  const cols = Math.max(2, Math.round((grid.cols - 1) / sampleStep) + 1)
  const rows = Math.max(2, Math.round((grid.rows - 1) / sampleStep) + 1)
  const cellSizeX = grid.bounds.sizeX / (cols - 1)
  const cellSizeZ = grid.bounds.sizeZ / (rows - 1)
  const totalVertices = cols * rows
  const totalTriangles = (cols - 1) * (rows - 1) * 2

  const heights = new Float32Array(totalVertices)
  const positions = new Float32Array(totalVertices * 3)
  const normals = new Float32Array(totalVertices * 3)
  const roadProx = new Float32Array(totalVertices)
  const indices = new Uint32Array(totalTriangles * 3)

  let phase: 'heights' | 'positions' | 'indices' | 'finalize' | 'done' = 'heights'
  let rowCursor = 0
  let geometry: THREE.BufferGeometry | null = null
  let surface: TerrainSurfaceHeightSource | null = null
  const totalRowWork = rows * 3

  const runHeightsRow = (row: number): void => {
    const z = grid.bounds.minZ + row * cellSizeZ
    const rowOffset = row * cols
    for (let col = 0; col < cols; col += 1) {
      const x = grid.bounds.minX + col * cellSizeX
      const index = rowOffset + col
      if (options.roadbed) {
        roadProx[index] = options.roadbed.roadProximityAt(x, z)
        heights[index] = options.roadbed.distanceAt(x, z) <= options.roadbed.influenceHalfWidth
          ? options.roadbed.coarseHeightAt(x, z)
          : sampleDemGridHeight(grid, x, z)
      } else if (options.field && options.roadProfile) {
        const baked = bakeTerrainHeight(options.field, options.roadProfile, x, z)
        heights[index] = baked.height
        roadProx[index] = baked.roadProx
      } else {
        heights[index] = sampleDemGridHeight(grid, x, z)
      }
    }
  }

  const runPositionsRow = (row: number): void => {
    const z = grid.bounds.minZ + row * cellSizeZ
    const rowOffset = row * cols
    for (let col = 0; col < cols; col += 1) {
      const x = grid.bounds.minX + col * cellSizeX
      const index = rowOffset + col
      const height = heights[index]!
      positions[index * 3] = x
      positions[index * 3 + 1] = height
      positions[index * 3 + 2] = z

      const left = heights[rowOffset + Math.max(0, col - 1)]!
      const right = heights[rowOffset + Math.min(cols - 1, col + 1)]!
      const up = heights[Math.max(0, row - 1) * cols + col]!
      const down = heights[Math.min(rows - 1, row + 1) * cols + col]!
      const dx = (right - left) / Math.max(1e-4, cellSizeX * 2)
      const dz = (down - up) / Math.max(1e-4, cellSizeZ * 2)
      const inverseLength = 1 / Math.hypot(dx, 1, dz)
      normals[index * 3] = -dx * inverseLength
      normals[index * 3 + 1] = inverseLength
      normals[index * 3 + 2] = -dz * inverseLength
    }
  }

  const runIndicesRow = (row: number): void => {
    let cursor = row * (cols - 1) * 6
    const rowOffset = row * cols
    for (let col = 0; col < cols - 1; col += 1) {
      const a = rowOffset + col
      const b = a + 1
      const c = a + cols
      const d = c + 1
      indices[cursor] = a
      indices[cursor + 1] = c
      indices[cursor + 2] = d
      indices[cursor + 3] = a
      indices[cursor + 4] = d
      indices[cursor + 5] = b
      cursor += 6
    }
  }

  const finalize = (): void => {
    const next = new THREE.BufferGeometry()
    next.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    next.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    next.setAttribute('aRoadProx', new THREE.BufferAttribute(roadProx, 1))
    next.setIndex(new THREE.BufferAttribute(indices, 1))
    const radius = 0.5 * Math.hypot(grid.bounds.sizeX, grid.bounds.sizeZ, grid.maxHeight - grid.minHeight)
    next.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(grid.bounds.centerX, (grid.minHeight + grid.maxHeight) * 0.5, grid.bounds.centerZ),
      radius,
    )
    next.boundingBox = new THREE.Box3(
      new THREE.Vector3(grid.bounds.minX, grid.minHeight, grid.bounds.minZ),
      new THREE.Vector3(grid.bounds.maxX, grid.maxHeight, grid.bounds.maxZ),
    )
    geometry = next
    surface = createTerrainGridSurface({
      cols,
      rows,
      minX: grid.bounds.minX,
      minZ: grid.bounds.minZ,
      cellSizeX,
      cellSizeZ,
      heights,
    })
    phase = 'done'
  }

  return {
    step(budgetMs = 10): boolean {
      const start = performance.now()
      while (phase !== 'done') {
        if (performance.now() - start >= budgetMs) {
          break
        }
        if (phase === 'heights') {
          runHeightsRow(rowCursor)
          rowCursor += 1
          if (rowCursor >= rows) {
            phase = 'positions'
            rowCursor = 0
          }
          continue
        }
        if (phase === 'positions') {
          runPositionsRow(rowCursor)
          rowCursor += 1
          if (rowCursor >= rows) {
            phase = 'indices'
            rowCursor = 0
          }
          continue
        }
        if (phase === 'indices') {
          runIndicesRow(rowCursor)
          rowCursor += 1
          if (rowCursor >= rows - 1) {
            phase = 'finalize'
          }
          continue
        }
        if (phase === 'finalize') {
          finalize()
        }
      }
      return phase === 'done'
    },
    get progress(): number {
      if (phase === 'done') {
        return 1
      }
      const done = phase === 'heights' ? 0 : phase === 'positions' ? rows : phase === 'indices' ? rows * 2 : totalRowWork - 1
      return Math.min(1, (done + rowCursor) / totalRowWork)
    },
    get geometry(): THREE.BufferGeometry | null {
      return geometry
    },
    get vertexCount(): number {
      return totalVertices
    },
    get triangleCount(): number {
      return totalTriangles
    },
    get cols(): number {
      return cols
    },
    get rows(): number {
      return rows
    },
    get cellSizeX(): number {
      return cellSizeX
    },
    get cellSizeZ(): number {
      return cellSizeZ
    },
    get surface(): TerrainSurfaceHeightSource | null {
      return surface
    },
  }
}

/**
 * A high-resolution terrain strip around the road. The coarse DEM mesh stays
 * cheap; this strip supplies the 7m road cut and verge at roughly 1.5m
 * resolution so the road no longer becomes a 30m-wide smear.
 */
export function createRoadCorridorGeometry(
  profile: RoadProfile,
  surface: TerrainSurfaceHeightSource,
  options: {
    alongStep?: number
    crossStep?: number
    corridorHalfWidth?: number
    envelopeRadius?: number
    clearance?: number
    /** Road-band columns used to keep the apron strictly below the asphalt. */
    roadColumns?: readonly (readonly number[])[] | null
    roadColumnStep?: number
  } = {},
): THREE.BufferGeometry {
  const alongStep = Math.max(1, options.alongStep ?? 3)
  const crossStep = Math.max(0.5, options.crossStep ?? 1.5)
  const halfWidth = Math.max(
    profile.halfWidth + profile.shoulderWidth,
    options.corridorHalfWidth ?? (profile.halfWidth + profile.shoulderWidth + profile.flattenBand + 6),
  )
  const crossCount = Math.max(3, Math.ceil((halfWidth * 2) / crossStep) + 1)
  const alongCount = Math.max(2, Math.ceil(profile.length / alongStep) + 1)
  const alongSpacing = profile.length / (alongCount - 1)
  const crossSpacing = (halfWidth * 2) / (crossCount - 1)
  const vertexCount = alongCount * crossCount
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const heights = new Float32Array(vertexCount)
  const roadProx = new Float32Array(vertexCount)
  const indices = new Uint32Array((alongCount - 1) * (crossCount - 1) * 6)
  // The strip follows the conservative surface envelope; this small lift keeps
  // it above the coarse triangles while the road band gets its own clearance.
  const stripLift = options.clearance ?? 0.01
  const roadColumns = options.roadColumns ?? null
  const roadColumnStep = Math.max(0.5, options.roadColumnStep ?? 2)

  const roadHeightAt = (distance: number, lateral: number): number | null => {
    if (!roadColumns?.length || Math.abs(lateral) > profile.halfWidth) {
      return null
    }
    const rowPos = Math.min(roadColumns.length - 1, Math.max(0, distance / roadColumnStep))
    const rowLow = Math.floor(rowPos)
    const rowHigh = Math.min(roadColumns.length - 1, rowLow + 1)
    const rowF = rowPos - rowLow
    const columnsLow = roadColumns[rowLow]!
    const columnsHigh = roadColumns[rowHigh]!
    if (columnsLow.length < 2 || columnsHigh.length < 2) {
      return null
    }
    const columnPos = ((lateral + profile.halfWidth) / (profile.halfWidth * 2)) * (columnsLow.length - 1)
    const columnLow = Math.floor(columnPos)
    const columnHigh = Math.min(columnsLow.length - 1, columnLow + 1)
    const columnF = columnPos - columnLow
    const atLow = columnsLow[columnLow]! + (columnsLow[columnHigh]! - columnsLow[columnLow]!) * columnF
    const atHigh = columnsHigh[columnLow]! + (columnsHigh[columnHigh]! - columnsHigh[columnLow]!) * columnF
    return atLow + (atHigh - atLow) * rowF
  }

  for (let row = 0; row < alongCount; row += 1) {
    const distance = Math.min(profile.length, row * alongSpacing)
    const sample = profile.sampleAt(distance)
    const dirX = Math.cos(sample.heading)
    const dirZ = Math.sin(sample.heading)
    const perpX = -dirZ
    const perpZ = dirX
    const crossSection = sampleRoadCrossSection(surface, sample, halfWidth, {
      columnCount: crossCount,
      envelopeRadius: options.envelopeRadius,
    })
    for (let col = 0; col < crossCount; col += 1) {
      const lateral = -halfWidth + col * crossSpacing
      const x = sample.x + perpX * lateral
      const z = sample.z + perpZ * lateral
      const index = row * crossCount + col
      const roadHeight = roadHeightAt(distance, lateral)
      // Inside the asphalt footprint the apron sits below the road band.
      // Outside it uses the conservative surface envelope.
      heights[index] = roadHeight == null
        ? crossSection.columns[col]!
        : roadHeight - 0.02
      roadProx[index] = profile.roadProximityAt(x, z)
      positions[index * 3] = x
      positions[index * 3 + 1] = heights[index]! + stripLift
      positions[index * 3 + 2] = z
    }
  }

  for (let row = 0; row < alongCount; row += 1) {
    for (let col = 0; col < crossCount; col += 1) {
      const index = row * crossCount + col
      const left = heights[row * crossCount + Math.max(0, col - 1)]!
      const right = heights[row * crossCount + Math.min(crossCount - 1, col + 1)]!
      const up = heights[Math.max(0, row - 1) * crossCount + col]!
      const down = heights[Math.min(alongCount - 1, row + 1) * crossCount + col]!
      const dx = (right - left) / Math.max(1e-4, crossSpacing * 2)
      const dz = (down - up) / Math.max(1e-4, alongSpacing * 2)
      const inverseLength = 1 / Math.hypot(dx, 1, dz)
      normals[index * 3] = -dx * inverseLength
      normals[index * 3 + 1] = inverseLength
      normals[index * 3 + 2] = -dz * inverseLength
    }
  }

  let cursor = 0
  for (let row = 0; row < alongCount - 1; row += 1) {
    for (let col = 0; col < crossCount - 1; col += 1) {
      const a = row * crossCount + col
      const b = a + 1
      const c = a + crossCount
      const d = c + 1
      indices[cursor] = a
      indices[cursor + 1] = c
      indices[cursor + 2] = d
      indices[cursor + 3] = a
      indices[cursor + 4] = d
      indices[cursor + 5] = b
      cursor += 6
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('aRoadProx', new THREE.BufferAttribute(roadProx, 1))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return geometry
}

/**
 * High-resolution cut/fill roadbed. Its outer row/column samples the raw
 * terrain, so it is a replacement surface for the graded coarse mesh rather
 * than a floating apron.
 */
export function createRoadbedGeometry(
  profile: RoadProfile,
  roadbed: RoadbedTarget,
  options: { alongStep?: number; crossStep?: number; lift?: number } = {},
): THREE.BufferGeometry {
  const alongStep = Math.max(1, options.alongStep ?? 2)
  const crossStep = Math.max(0.5, options.crossStep ?? 1.5)
  const lift = options.lift ?? 0.01
  const halfWidth = roadbed.meshHalfWidth
  const crossCount = Math.max(3, Math.ceil((halfWidth * 2) / crossStep) + 1)
  const alongCount = Math.max(2, Math.ceil(profile.length / alongStep) + 1)
  const alongSpacing = profile.length / (alongCount - 1)
  const crossSpacing = (halfWidth * 2) / (crossCount - 1)
  const vertexCount = alongCount * crossCount
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const heights = new Float32Array(vertexCount)
  const roadProx = new Float32Array(vertexCount)
  const baseHeights = new Float32Array(vertexCount)
  const baseNormals = new Float32Array(vertexCount * 3)
  const indices = new Uint32Array((alongCount - 1) * (crossCount - 1) * 6)

  for (let row = 0; row < alongCount; row += 1) {
    const sample = profile.sampleAt(Math.min(profile.length, row * alongSpacing))
    const perpX = -Math.sin(sample.heading)
    const perpZ = Math.cos(sample.heading)
    for (let col = 0; col < crossCount; col += 1) {
      const lateral = -halfWidth + col * crossSpacing
      const x = sample.x + perpX * lateral
      const z = sample.z + perpZ * lateral
      const index = row * crossCount + col
      heights[index] = Math.abs(lateral) >= roadbed.outerHalfWidth
        ? roadbed.rawHeightAt(x, z)
        : roadbed.heightAt(x, z)
      roadProx[index] = roadbed.roadProximityAt(x, z)
      baseHeights[index] = roadbed.rawHeightAt(x, z)
      const baseNormal = roadbed.rawNormalAt(x, z)
      baseNormals[index * 3] = baseNormal.x
      baseNormals[index * 3 + 1] = baseNormal.y
      baseNormals[index * 3 + 2] = baseNormal.z
      positions[index * 3] = x
      positions[index * 3 + 1] = heights[index]! + lift
      positions[index * 3 + 2] = z
    }
  }

  for (let row = 0; row < alongCount; row += 1) {
    for (let col = 0; col < crossCount; col += 1) {
      const index = row * crossCount + col
      const left = heights[row * crossCount + Math.max(0, col - 1)]!
      const right = heights[row * crossCount + Math.min(crossCount - 1, col + 1)]!
      const up = heights[Math.max(0, row - 1) * crossCount + col]!
      const down = heights[Math.min(alongCount - 1, row + 1) * crossCount + col]!
      const dx = (right - left) / Math.max(1e-4, crossSpacing * 2)
      const dz = (down - up) / Math.max(1e-4, alongSpacing * 2)
      const inverseLength = 1 / Math.hypot(dx, 1, dz)
      normals[index * 3] = -dx * inverseLength
      normals[index * 3 + 1] = inverseLength
      normals[index * 3 + 2] = -dz * inverseLength
    }
  }

  let cursor = 0
  for (let row = 0; row < alongCount - 1; row += 1) {
    for (let col = 0; col < crossCount - 1; col += 1) {
      const a = row * crossCount + col
      const b = a + 1
      const c = a + crossCount
      const d = c + 1
      indices[cursor] = a
      indices[cursor + 1] = c
      indices[cursor + 2] = d
      indices[cursor + 3] = a
      indices[cursor + 4] = d
      indices[cursor + 5] = b
      cursor += 6
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('aRoadProx', new THREE.BufferAttribute(roadProx, 1))
  geometry.setAttribute('aBaseHeight', new THREE.BufferAttribute(baseHeights, 1))
  geometry.setAttribute('aBaseNormal', new THREE.BufferAttribute(baseNormals, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return geometry
}
