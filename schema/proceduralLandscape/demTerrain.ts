import * as THREE from 'three'
import { fetchAssetBlob } from '../assetDownload'
import {
  decodeTerrainDemRuntimeGridFile,
  type TerrainDemRuntimeGridData,
} from '../terrainDemRuntimeGrid'
import {
  decodeTerrainDemRuntimeOrthoFile,
  terrainDemRuntimeOrthoToRgba,
  type TerrainDemRuntimeOrthoData,
} from '../terrainDemRuntimeOrtho'
import type { TerrainHeightGrid } from './terrainSampler'
import type { DemRoadbedTarget } from './demRoadbed'

const demGridLoads = new Map<string, Promise<TerrainDemRuntimeGridData>>()
const demOrthoLoads = new Map<string, Promise<TerrainDemRuntimeOrthoData>>()
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
  sampleStep = 1,
): TerrainHeightGrid {
  const minX = data.minX + worldOffsetX
  const minZ = data.minZ + worldOffsetZ
  const maxX = data.maxX + worldOffsetX
  const maxZ = data.maxZ + worldOffsetZ
  const step = Math.max(1, Math.min(8, Math.round(sampleStep)))
  const cols = Math.max(2, Math.floor((data.width - 1) / step) + 1)
  const rows = Math.max(2, Math.floor((data.height - 1) / step) + 1)
  const cellSizeX = (data.maxX - data.minX) / (cols - 1)
  const cellSizeZ = (data.maxZ - data.minZ) / (rows - 1)
  // Vegetation must sample the same decimated vertices as the rendered DEM
  // mesh. Sampling the full-resolution raster here makes trees hover over or
  // sink into the coarse triangles on ridges and steep slopes.
  const heights = new Float32Array(cols * rows)
  let minHeight = Number.POSITIVE_INFINITY
  let maxHeight = Number.NEGATIVE_INFINITY
  for (let row = 0; row < rows; row += 1) {
    const sourceRow = Math.min(data.height - 1, row * step)
    for (let col = 0; col < cols; col += 1) {
      const sourceCol = Math.min(data.width - 1, col * step)
      const height = data.heights[sourceRow * data.width + sourceCol]!
      heights[row * cols + col] = height
      if (height < minHeight) minHeight = height
      if (height > maxHeight) maxHeight = height
    }
  }
  let coverage = demCoverageCache.get(data)
  if (!coverage || coverage.length !== heights.length) {
    coverage = new Uint8Array(heights.length)
    coverage.fill(1)
    demCoverageCache.set(data, coverage)
  }
  const cellSize = Math.max(cellSizeX, cellSizeZ)
  const grid: TerrainHeightGrid = {
    minX,
    minZ,
    maxX,
    maxZ,
    cellSize,
    cols,
    rows,
    minY: worldOffsetY + (Number.isFinite(minHeight) ? minHeight : 0),
    maxY: worldOffsetY + (Number.isFinite(maxHeight) ? maxHeight : 0),
    averageEdgeLength: cellSize,
    heights,
    coverage,
    memoryBytes: heights.byteLength + coverage.byteLength,
    contains(x: number, z: number): boolean {
      return x >= minX - cellSize * 0.5 && x <= maxX + cellSize * 0.5
        && z >= minZ - cellSize * 0.5 && z <= maxZ + cellSize * 0.5
    },
    sampleHeight(x: number, z: number): number | null {
      const gx = (x - minX) / cellSizeX
      const gz = (z - minZ) / cellSizeZ
      if (!Number.isFinite(gx) || !Number.isFinite(gz)) {
        return null
      }
      if (gx < 0 || gx > cols - 1 || gz < 0 || gz > rows - 1) {
        return null
      }
      const col = Math.max(0, Math.min(cols - 2, Math.floor(gx)))
      const row = Math.max(0, Math.min(rows - 2, Math.floor(gz)))
      const tx = Math.max(0, Math.min(1, gx - col))
      const tz = Math.max(0, Math.min(1, gz - row))
      const h00 = heights[row * cols + col]!
      const h10 = heights[row * cols + col + 1]!
      const h01 = heights[(row + 1) * cols + col]!
      const h11 = heights[(row + 1) * cols + col + 1]!
      // Match the DEM mesh's two triangles exactly (a-c-d then a-d-b); a
      // bilinear sample still differs from the rendered surface on ridges.
      const surfaceHeight = tz >= tx
        ? h00 + (h01 - h00) * tz + (h11 - h01) * tx
        : h00 + (h10 - h00) * tx + (h11 - h10) * tz
      return worldOffsetY
        + surfaceHeight
    },
    sampleNormal(x: number, z: number, target?: THREE.Vector3): THREE.Vector3 | null {
      const hx0 = grid.sampleHeight(x - cellSizeX, z)
      const hx1 = grid.sampleHeight(x + cellSizeX, z)
      const hz0 = grid.sampleHeight(x, z - cellSizeZ)
      const hz1 = grid.sampleHeight(x, z + cellSizeZ)
      if (hx0 == null || hx1 == null || hz0 == null || hz1 == null) {
        return null
      }
      const dx = (hx1 - hx0) / (2 * cellSizeX)
      const dz = (hz1 - hz0) / (2 * cellSizeZ)
      const out = target ?? new THREE.Vector3()
      return out.set(-dx, 1, -dz).normalize()
    },
  }
  return grid
}

export function loadTerrainDemRuntimeOrtho(
  url: string,
  onProgress?: (value: number) => void,
): Promise<TerrainDemRuntimeOrthoData> {
  const normalized = url.trim()
  if (!normalized) {
    return Promise.reject(new Error('DEM runtime ortho URL is empty'))
  }
  const cached = demOrthoLoads.get(normalized)
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
        throw new Error('DEM runtime ortho download returned no bytes')
      }
      return decodeTerrainDemRuntimeOrthoFile(bytes)
    })
    .catch((error) => {
      demOrthoLoads.delete(normalized)
      throw error
    })
  demOrthoLoads.set(normalized, pending)
  return pending
}

export function createTerrainDemRuntimeOrthoTexture(
  data: TerrainDemRuntimeOrthoData,
  name = 'dem-runtime-ortho',
): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    terrainDemRuntimeOrthoToRgba(data),
    data.width,
    data.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  texture.name = name
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.flipY = false
  texture.needsUpdate = true
  return texture
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

export interface DemTerrainMeshBuilderOptions {
  roadbed?: DemRoadbedTarget | null
  /**
   * World-space translation of the host node. DEM positions and heights stay
   * local, while the roadbed target is defined in world space.
   */
  worldOffset?: {
    x: number
    y: number
    z: number
  } | null
}

/** Time-sliced rectangular DEM mesh. Positions stay local; the host node owns XZ placement. */
export function createDemTerrainMeshBuilder(
  data: TerrainDemRuntimeGridData,
  requestedStep: number,
  options: DemTerrainMeshBuilderOptions = {},
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
  const uvs = new Float32Array(vertexCount * 2)
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

  const sampleVisibleHeight = (x: number, z: number, col: number, row: number): number => {
    const worldX = x + (options.worldOffset?.x ?? 0)
    const worldZ = z + (options.worldOffset?.z ?? 0)
    if (options.roadbed && options.roadbed.distanceAt(worldX, worldZ) <= options.roadbed.influenceHalfWidth) {
      return options.roadbed.coarseHeightAt(worldX, worldZ) - (options.worldOffset?.y ?? 0)
    }
    return sampleGridHeight(col, row)
  }

  const buildPositions = (row: number): void => {
    const z = data.minZ + row * cellSizeZ
    for (let col = 0; col < cols; col += 1) {
      const x = data.minX + col * cellSizeX
      const index = row * cols + col
      const height = sampleVisibleHeight(x, z, col, row)
      heights[index] = height
      positions[index * 3] = x
      positions[index * 3 + 1] = height
      positions[index * 3 + 2] = z
      uvs[index * 2] = col / Math.max(1, cols - 1)
      uvs[index * 2 + 1] = row / Math.max(1, rows - 1)
      const left = heights[row * cols + Math.max(0, col - 1)]!
      const right = heights[row * cols + Math.min(cols - 1, col + 1)]!
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
            geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
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
