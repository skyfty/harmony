import * as THREE from 'three'
import { fetchAssetBlob } from '../assetDownload'
import {
  decodeTerrainDemRuntimeGridFile,
  type TerrainDemRuntimeGridData,
} from '../terrainDemRuntimeGrid'
import type { TerrainHeightGrid } from './terrainSampler'

const demGridLoads = new Map<string, Promise<TerrainDemRuntimeGridData>>()
const demCoverageCache = new WeakMap<TerrainDemRuntimeGridData, Uint8Array>()

export function loadTerrainDemRuntimeGrid(
  url: string,
  onProgress?: (value: number) => void,
): Promise<TerrainDemRuntimeGridData> {
  const normalized = url.trim()
  if (!normalized) {
    return Promise.reject(new Error('DEM runtime grid URL is empty'))
  }
  const cached = demGridLoads.get(normalized)
  if (cached) {
    return cached
  }
  const controller = new AbortController()
  const pending = fetchAssetBlob(normalized, controller, (value) => onProgress?.(value))
    .then((payload) => {
      const bytes = payload.bytes
        ? new Uint8Array(payload.bytes)
        : null
      if (!bytes) {
        throw new Error('DEM runtime grid download returned no bytes')
      }
      return decodeTerrainDemRuntimeGridFile(bytes)
    })
    .catch((error) => {
      demGridLoads.delete(normalized)
      throw error
    })
  demGridLoads.set(normalized, pending)
  return pending
}

export function createDemTerrainHeightGrid(
  data: TerrainDemRuntimeGridData,
  worldOffsetX = 0,
  worldOffsetZ = 0,
  worldOffsetY = 0,
): TerrainHeightGrid {
  const minX = data.minX + worldOffsetX
  const minZ = data.minZ + worldOffsetZ
  const maxX = data.maxX + worldOffsetX
  const maxZ = data.maxZ + worldOffsetZ
  // The decoded grid is immutable, so every translated view can share it.
  const heights = data.heights
  let coverage = demCoverageCache.get(data)
  if (!coverage) {
    coverage = new Uint8Array(heights.length)
    coverage.fill(1)
    demCoverageCache.set(data, coverage)
  }
  const cellSize = Math.max(data.cellSizeX, data.cellSizeZ)
  const grid: TerrainHeightGrid = {
    minX,
    minZ,
    maxX,
    maxZ,
    cellSize,
    cols: data.width,
    rows: data.height,
    minY: worldOffsetY,
    maxY: worldOffsetY + Math.max(0, data.maxElevation - data.minElevation),
    averageEdgeLength: cellSize,
    heights,
    coverage,
    memoryBytes: heights.byteLength + coverage.byteLength,
    contains(x: number, z: number): boolean {
      return x >= minX - cellSize * 0.5 && x <= maxX + cellSize * 0.5
        && z >= minZ - cellSize * 0.5 && z <= maxZ + cellSize * 0.5
    },
    sampleHeight(x: number, z: number): number | null {
      const gx = (x - minX) / data.cellSizeX
      const gz = (z - minZ) / data.cellSizeZ
      if (!Number.isFinite(gx) || !Number.isFinite(gz)) {
        return null
      }
      const col = Math.floor(gx)
      const row = Math.floor(gz)
      if (col < 0 || col >= data.width - 1 || row < 0 || row >= data.height - 1) {
        if (col < 0 || col >= data.width || row < 0 || row >= data.height) {
          return null
        }
      }
      const tx = gx - col
      const tz = gz - row
      const x0 = Math.max(0, Math.min(data.width - 1, col))
      const x1 = Math.max(0, Math.min(data.width - 1, col + 1))
      const z0 = Math.max(0, Math.min(data.height - 1, row))
      const z1 = Math.max(0, Math.min(data.height - 1, row + 1))
      const h00 = heights[z0 * data.width + x0]!
      const h10 = heights[z0 * data.width + x1]!
      const h01 = heights[z1 * data.width + x0]!
      const h11 = heights[z1 * data.width + x1]!
      return worldOffsetY
        + (h00 * (1 - tx) + h10 * tx) * (1 - tz)
        + (h01 * (1 - tx) + h11 * tx) * tz
    },
    sampleNormal(x: number, z: number, target?: THREE.Vector3): THREE.Vector3 | null {
      const hx0 = grid.sampleHeight(x - data.cellSizeX, z)
      const hx1 = grid.sampleHeight(x + data.cellSizeX, z)
      const hz0 = grid.sampleHeight(x, z - data.cellSizeZ)
      const hz1 = grid.sampleHeight(x, z + data.cellSizeZ)
      if (hx0 == null || hx1 == null || hz0 == null || hz1 == null) {
        return null
      }
      const dx = (hx1 - hx0) / (2 * data.cellSizeX)
      const dz = (hz1 - hz0) / (2 * data.cellSizeZ)
      const out = target ?? new THREE.Vector3()
      return out.set(-dx, 1, -dz).normalize()
    },
  }
  return grid
}

export interface DemTerrainMeshBuilder {
  step(budgetMs?: number): boolean
  readonly done: boolean
  readonly geometry: THREE.BufferGeometry | null
  readonly progress: number
  readonly vertexCount: number
  readonly triangleCount: number
  readonly sampleStep: number
  readonly error: string | null
}

/** Time-sliced rectangular DEM mesh. Positions stay local; the host node owns XZ placement. */
export function createDemTerrainMeshBuilder(
  data: TerrainDemRuntimeGridData,
  requestedStep: number,
): DemTerrainMeshBuilder {
  const sampleStep = Math.max(1, Math.min(8, Math.round(requestedStep)))
  const cols = Math.max(2, Math.floor((data.width - 1) / sampleStep) + 1)
  const rows = Math.max(2, Math.floor((data.height - 1) / sampleStep) + 1)
  const cellSizeX = (data.maxX - data.minX) / (cols - 1)
  const cellSizeZ = (data.maxZ - data.minZ) / (rows - 1)
  const vertexCount = cols * rows
  const triangleCount = (cols - 1) * (rows - 1) * 2
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const indices = new Uint32Array(triangleCount * 3)
  const heights = new Float32Array(vertexCount)
  let phase: 'heights' | 'positions' | 'indices' | 'done' | 'error' = 'heights'
  let rowCursor = 0
  let geometry: THREE.BufferGeometry | null = null
  let error: string | null = null

  const sampleGridHeight = (col: number, row: number): number => {
    const sourceCol = Math.min(data.width - 1, col * sampleStep)
    const sourceRow = Math.min(data.height - 1, row * sampleStep)
    return data.heights[sourceRow * data.width + sourceCol]!
  }

  const buildPositions = (row: number): void => {
    const z = data.minZ + row * cellSizeZ
    for (let col = 0; col < cols; col += 1) {
      const x = data.minX + col * cellSizeX
      const index = row * cols + col
      const height = sampleGridHeight(col, row)
      heights[index] = height
      positions[index * 3] = x
      positions[index * 3 + 1] = height
      positions[index * 3 + 2] = z
      const left = sampleGridHeight(Math.max(0, col - 1), row)
      const right = sampleGridHeight(Math.min(cols - 1, col + 1), row)
      const up = sampleGridHeight(col, Math.max(0, row - 1))
      const down = sampleGridHeight(col, Math.min(rows - 1, row + 1))
      const dx = (right - left) / Math.max(1e-4, cellSizeX * 2)
      const dz = (down - up) / Math.max(1e-4, cellSizeZ * 2)
      const inverseLength = 1 / Math.hypot(dx, 1, dz)
      normals[index * 3] = -dx * inverseLength
      normals[index * 3 + 1] = inverseLength
      normals[index * 3 + 2] = -dz * inverseLength
    }
  }

  const buildIndices = (row: number): void => {
    let cursor = row * (cols - 1) * 6
    const rowOffset = row * cols
    for (let col = 0; col < cols - 1; col += 1) {
      const a = rowOffset + col
      const b = a + 1
      const c = a + cols
      const d = c + 1
      indices[cursor++] = a
      indices[cursor++] = c
      indices[cursor++] = d
      indices[cursor++] = a
      indices[cursor++] = d
      indices[cursor++] = b
    }
  }

  return {
    step(budgetMs = 10): boolean {
      const started = typeof performance !== 'undefined' ? performance.now() : Date.now()
      while (phase !== 'done' && phase !== 'error') {
        if ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started >= budgetMs) {
          break
        }
        if (phase === 'heights') {
          const row = rowCursor
          for (let col = 0; col < cols; col += 1) {
            heights[row * cols + col] = sampleGridHeight(col, row)
          }
          rowCursor += 1
          if (rowCursor >= rows) {
            phase = 'positions'
            rowCursor = 0
          }
          continue
        }
        if (phase === 'positions') {
          buildPositions(rowCursor)
          rowCursor += 1
          if (rowCursor >= rows) {
            phase = 'indices'
            rowCursor = 0
          }
          continue
        }
        if (phase === 'indices') {
          buildIndices(rowCursor)
          rowCursor += 1
          if (rowCursor >= rows - 1) {
            geometry = new THREE.BufferGeometry()
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
            geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
            geometry.setIndex(new THREE.BufferAttribute(indices, 1))
            geometry.computeBoundingSphere()
            geometry.computeBoundingBox()
            phase = 'done'
          }
        }
      }
      return phase === 'done' || phase === 'error'
    },
    get done(): boolean {
      return phase === 'done' || phase === 'error'
    },
    get geometry(): THREE.BufferGeometry | null {
      return geometry
    },
    get progress(): number {
      if (phase === 'done') return 1
      if (phase === 'error') return 0
      const total = rows * 3
      const done = phase === 'heights' ? rowCursor : phase === 'positions' ? rows + rowCursor : rows * 2 + rowCursor
      return Math.min(1, done / total)
    },
    get vertexCount(): number {
      return vertexCount
    },
    get triangleCount(): number {
      return triangleCount
    },
    get sampleStep(): number {
      return sampleStep
    },
    get error(): string | null {
      return error
    },
  }
}
