import * as THREE from 'three'
import { clamp } from './noise'
import { COMPONENT_ARTIFACT_KEY } from '../components/componentManager'
import {
  PROCEDURAL_LANDSCAPE_ROADBED_SURFACE_USER_DATA_KEY,
  PROCEDURAL_LANDSCAPE_ROAD_COLLISION_USER_DATA_KEY,
  PROCEDURAL_LANDSCAPE_ROAD_SURFACE_USER_DATA_KEY,
} from './collisionMetadata'

/**
 * Runtime height field rasterized from a real terrain mesh (for example a GLB
 * exported by the 3dtiles-viewer tool). This is the project's equivalent of the
 * slowroads heightmap: all road tracing / vegetation placement samples it
 * instead of touching the source geometry again.
 */
export interface TerrainHeightGrid {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
  cellSize: number
  cols: number
  rows: number
  minY: number
  maxY: number
  averageEdgeLength: number
  heights: Float32Array
  coverage: Uint8Array
  memoryBytes: number
  contains(x: number, z: number): boolean
  sampleHeight(x: number, z: number): number | null
  sampleNormal(x: number, z: number, target?: THREE.Vector3): THREE.Vector3 | null
}

export interface TerrainGridBuildOptions {
  /** Requested world-space cell size in meters. */
  cellSize?: number
  /** Maximum number of samples per axis (grid is coarsened above this). */
  maxGridSize?: number
}

export interface TerrainGridBuilder {
  /** Advances the build; returns true when the result (or failure) is ready. */
  step(): boolean
  readonly done: boolean
  readonly progress: number
  readonly result: TerrainHeightGrid | null
  readonly error: string | null
}

/** A mesh plus the world matrix that should be applied to its geometry. */
export interface TerrainMeshSource {
  mesh: THREE.Mesh
  matrix: THREE.Matrix4
}

type MeshSource = {
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute
  index: THREE.BufferAttribute | null
  matrix: THREE.Matrix4
  vertexCount: number
  triangleCount: number
}

const VERTEX_BUDGET_PER_STEP = 250_000
const TRIANGLE_BUDGET_PER_STEP = 60_000

const scratchA = new THREE.Vector3()
const scratchB = new THREE.Vector3()
const scratchC = new THREE.Vector3()

/** Viewport helper meshes never describe real terrain geometry. */
const TERRAIN_MESH_SKIP_NAME_PATTERN = /pick\s*proxy|instanced\s*outline|lod\s*helper/i

/**
 * Runtime-generated landscape meshes are not terrain inputs. In particular the
 * rebuilt DEM mesh already contains the previous cut/fill pass; feeding it back
 * into the sampler makes successive width edits dig progressively deeper.
 */
const TERRAIN_MESH_SKIP_USER_DATA_FLAGS = [
  'proceduralLandscapeDemTerrain',
  PROCEDURAL_LANDSCAPE_ROADBED_SURFACE_USER_DATA_KEY,
  PROCEDURAL_LANDSCAPE_ROAD_COLLISION_USER_DATA_KEY,
  PROCEDURAL_LANDSCAPE_ROAD_SURFACE_USER_DATA_KEY,
] as const

export function isTerrainSourceMesh(mesh: THREE.Mesh): boolean {
  const typed = mesh as THREE.Mesh & {
    isMesh?: boolean
    isInstancedMesh?: boolean
    isSkinnedMesh?: boolean
  }
  if (!typed.isMesh || !mesh.geometry) {
    return false
  }
  // Instanced meshes keep their per-instance transforms outside matrixWorld;
  // skinned meshes deform at runtime. Neither describes a static terrain.
  if (typed.isInstancedMesh || typed.isSkinnedMesh) {
    return false
  }
  if (mesh.visible === false) {
    return false
  }
  const userData = mesh.userData as Record<string, unknown> | undefined
  if (userData) {
    if (userData.instancedPickProxy === true) {
      return false
    }
    if (userData.editorOnly === true) {
      return false
    }
    if (userData[COMPONENT_ARTIFACT_KEY] === true) {
      return false
    }
    if (TERRAIN_MESH_SKIP_USER_DATA_FLAGS.some((flag) => userData[flag] === true)) {
      return false
    }
  }
  if (typeof mesh.name === 'string' && TERRAIN_MESH_SKIP_NAME_PATTERN.test(mesh.name)) {
    return false
  }
  const position = mesh.geometry.getAttribute('position')
  if (!position || position.count < 3) {
    return false
  }
  const index = mesh.geometry.getIndex()
  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3)
  return triangleCount > 0
}

/**
 * Collects the meshes that describe the node's real geometry. Editor-only
 * helpers (for example the invisible box "pick proxy" the instanced-rendering
 * path adds) are filtered out so a height field can never be built from them.
 */
export function collectTerrainMeshSources(root: THREE.Object3D): TerrainMeshSource[] {
  root.updateMatrixWorld(true)
  const sources: TerrainMeshSource[] = []
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!isTerrainSourceMesh(mesh)) {
      return
    }
    sources.push({ mesh, matrix: mesh.matrixWorld })
  })
  return sources
}

function toMeshSources(sources: TerrainMeshSource[]): MeshSource[] {
  const result: MeshSource[] = []
  for (const source of sources) {
    const position = source.mesh.geometry.getAttribute('position')
    if (!position) {
      continue
    }
    const index = source.mesh.geometry.getIndex()
    const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3)
    if (triangleCount <= 0) {
      continue
    }
    result.push({
      position,
      index,
      matrix: source.matrix,
      vertexCount: position.count,
      triangleCount,
    })
  }
  return result
}

function createGridFromArrays(
  params: {
    minX: number
    minZ: number
    cellSize: number
    cols: number
    rows: number
    heights: Float32Array
    coverage: Uint8Array
    averageEdgeLength: number
  },
): TerrainHeightGrid {
  const { minX, minZ, cellSize, cols, rows, heights, coverage } = params
  const maxX = minX + (cols - 1) * cellSize
  const maxZ = minZ + (rows - 1) * cellSize
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (let i = 0; i < heights.length; i += 1) {
    if (coverage[i]) {
      const y = heights[i]!
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (!Number.isFinite(minY)) {
    minY = 0
    maxY = 0
  }

  const grid: TerrainHeightGrid = {
    minX,
    minZ,
    maxX,
    maxZ,
    cellSize,
    cols,
    rows,
    minY,
    maxY,
    averageEdgeLength: params.averageEdgeLength,
    heights,
    coverage,
    memoryBytes: heights.byteLength + coverage.byteLength,
    contains(x: number, z: number): boolean {
      return x >= grid.minX - cellSize * 0.5 && x <= grid.maxX + cellSize * 0.5
        && z >= grid.minZ - cellSize * 0.5 && z <= grid.maxZ + cellSize * 0.5
    },
    sampleHeight(x: number, z: number): number | null {
      const gx = (x - grid.minX) / cellSize
      const gz = (z - grid.minZ) / cellSize
      const x0 = Math.floor(gx)
      const z0 = Math.floor(gz)
      const tx = gx - x0
      const tz = gz - z0
      let weightSum = 0
      let valueSum = 0
      for (let dz = 0; dz <= 1; dz += 1) {
        const zi = z0 + dz
        if (zi < 0 || zi >= grid.rows) continue
        const wz = dz === 0 ? 1 - tz : tz
        for (let dx = 0; dx <= 1; dx += 1) {
          const xi = x0 + dx
          if (xi < 0 || xi >= grid.cols) continue
          const wx = dx === 0 ? 1 - tx : tx
          const idx = zi * grid.cols + xi
          if (!coverage[idx]) continue
          const w = wx * wz
          weightSum += w
          valueSum += heights[idx]! * w
        }
      }
      return weightSum > 0 ? valueSum / weightSum : null
    },
    sampleNormal(x: number, z: number, target?: THREE.Vector3): THREE.Vector3 | null {
      const h = grid.cellSize
      const hx0 = grid.sampleHeight(x - h, z)
      const hx1 = grid.sampleHeight(x + h, z)
      const hz0 = grid.sampleHeight(x, z - h)
      const hz1 = grid.sampleHeight(x, z + h)
      if (hx0 == null || hx1 == null || hz0 == null || hz1 == null) {
        return null
      }
      const dx = (hx1 - hx0) / (2 * h)
      const dz = (hz1 - hz0) / (2 * h)
      const out = target ?? new THREE.Vector3()
      out.set(-dx, 1, -dz).normalize()
      return out
    },
  }
  return grid
}

export function createTerrainGridBuilder(
  inputSources: TerrainMeshSource[],
  options: TerrainGridBuildOptions = {},
): TerrainGridBuilder {
  const requestedCellSize = clamp(options.cellSize ?? 2, 0.25, 64)
  const maxGridSize = Math.max(32, Math.min(4096, Math.round(options.maxGridSize ?? 1024)))

  let phase: 'collect' | 'bounds' | 'init' | 'triangles' | 'dilate' | 'done' | 'error' = 'collect'
  let sources: MeshSource[] = []
  let sourcesTotalVertices = 0
  let verticesVisited = 0
  let trianglesProcessed = 0
  let boundsMinX = Number.POSITIVE_INFINITY
  let boundsMinZ = Number.POSITIVE_INFINITY
  let boundsMaxX = Number.NEGATIVE_INFINITY
  let boundsMaxZ = Number.NEGATIVE_INFINITY
  let edgeSum = 0
  let edgeCount = 0
  let cellSize = requestedCellSize
  let cols = 0
  let rows = 0
  let minX = 0
  let minZ = 0
  let heights = new Float32Array(0)
  let cellArea = new Float32Array(0)
  let coverage = new Uint8Array(0)
  let result: TerrainHeightGrid | null = null
  let error: string | null = null

  const progress = (): number => {
    switch (phase) {
      case 'collect':
        return 0
      case 'bounds':
        return sourcesTotalVertices > 0 ? (verticesVisited / sourcesTotalVertices) * 0.55 : 0.55
      case 'init':
        return 0.6
      case 'triangles': {
        const total = sources.reduce((sum, source) => sum + source.triangleCount, 0)
        return 0.6 + (total > 0 ? (trianglesProcessed / total) * 0.35 : 0.35)
      }
      case 'dilate':
        return 0.97
      case 'done':
        return 1
      default:
        return 0
    }
  }

  const stepBounds = (): void => {
    let budget = VERTEX_BUDGET_PER_STEP
    let sourceIndex = 0
    let vertexCursor = 0
    // Find where we left off (encoded by verticesVisited against per-source counts).
    let remaining = verticesVisited
    while (sourceIndex < sources.length && remaining >= sources[sourceIndex]!.vertexCount) {
      remaining -= sources[sourceIndex]!.vertexCount
      sourceIndex += 1
    }
    vertexCursor = remaining

    while (sourceIndex < sources.length && budget > 0) {
      const source = sources[sourceIndex]!
      const { position, matrix } = source
      const limit = Math.min(source.vertexCount, vertexCursor + budget)
      for (let i = vertexCursor; i < limit; i += 1) {
        scratchA.fromBufferAttribute(position, i).applyMatrix4(matrix)
        if (scratchA.x < boundsMinX) boundsMinX = scratchA.x
        if (scratchA.x > boundsMaxX) boundsMaxX = scratchA.x
        if (scratchA.z < boundsMinZ) boundsMinZ = scratchA.z
        if (scratchA.z > boundsMaxZ) boundsMaxZ = scratchA.z
      }
      const visited = limit - vertexCursor
      budget -= visited
      verticesVisited += visited
      vertexCursor = limit
      if (vertexCursor >= source.vertexCount) {
        sourceIndex += 1
        vertexCursor = 0
      } else {
        break
      }
    }

    if (verticesVisited >= sourcesTotalVertices) {
      if (!Number.isFinite(boundsMinX) || !Number.isFinite(boundsMinZ)) {
        error = 'empty-bounds'
        phase = 'error'
        return
      }
      phase = 'init'
    }
  }

  const stepInit = (): void => {
    const sizeX = Math.max(boundsMaxX - boundsMinX, requestedCellSize)
    const sizeZ = Math.max(boundsMaxZ - boundsMinZ, requestedCellSize)
    cellSize = Math.max(requestedCellSize, sizeX / (maxGridSize - 1), sizeZ / (maxGridSize - 1))
    cols = Math.max(2, Math.min(maxGridSize, Math.ceil(sizeX / cellSize) + 1))
    rows = Math.max(2, Math.min(maxGridSize, Math.ceil(sizeZ / cellSize) + 1))
    // Keep cells square by expanding the extent if rounding shrank the grid.
    cellSize = Math.max(cellSize, sizeX / (cols - 1), sizeZ / (rows - 1))
    minX = boundsMinX
    minZ = boundsMinZ
    heights = new Float32Array(cols * rows)
    heights.fill(Number.NaN)
    cellArea = new Float32Array(cols * rows)
    cellArea.fill(Number.POSITIVE_INFINITY)
    coverage = new Uint8Array(cols * rows)
    trianglesProcessed = 0
    phase = 'triangles'
  }

  const stepTriangles = (): void => {
    let budget = TRIANGLE_BUDGET_PER_STEP
    let sourceIndex = 0
    let remaining = trianglesProcessed
    while (sourceIndex < sources.length && remaining >= sources[sourceIndex]!.triangleCount) {
      remaining -= sources[sourceIndex]!.triangleCount
      sourceIndex += 1
    }
    let triangleCursor = remaining

    while (sourceIndex < sources.length && budget > 0) {
      const source = sources[sourceIndex]!
      const { position, index, matrix } = source
      const limit = Math.min(source.triangleCount, triangleCursor + budget)
      const useIndex = index != null
      for (let t = triangleCursor; t < limit; t += 1) {
        const i0 = useIndex ? index!.getX(t * 3) : t * 3
        const i1 = useIndex ? index!.getX(t * 3 + 1) : t * 3 + 1
        const i2 = useIndex ? index!.getX(t * 3 + 2) : t * 3 + 2
        scratchA.fromBufferAttribute(position, i0).applyMatrix4(matrix)
        scratchB.fromBufferAttribute(position, i1).applyMatrix4(matrix)
        scratchC.fromBufferAttribute(position, i2).applyMatrix4(matrix)

        edgeSum += scratchA.distanceTo(scratchB) + scratchB.distanceTo(scratchC) + scratchC.distanceTo(scratchA)
        edgeCount += 3

        const area2 = Math.abs(
          (scratchB.x - scratchA.x) * (scratchC.z - scratchA.z)
          - (scratchC.x - scratchA.x) * (scratchB.z - scratchA.z),
        )
        const area = area2 * 0.5
        if (area <= 1e-9) {
          continue
        }

        const tMinX = Math.min(scratchA.x, scratchB.x, scratchC.x)
        const tMaxX = Math.max(scratchA.x, scratchB.x, scratchC.x)
        const tMinZ = Math.min(scratchA.z, scratchB.z, scratchC.z)
        const tMaxZ = Math.max(scratchA.z, scratchB.z, scratchC.z)
        const c0 = clamp(Math.floor((tMinX - minX) / cellSize), 0, cols - 1)
        const c1 = clamp(Math.floor((tMaxX - minX) / cellSize), 0, cols - 1)
        const r0 = clamp(Math.floor((tMinZ - minZ) / cellSize), 0, rows - 1)
        const r1 = clamp(Math.floor((tMaxZ - minZ) / cellSize), 0, rows - 1)
        const denom = (scratchB.z - scratchC.z) * (scratchA.x - scratchC.x)
          + (scratchC.x - scratchB.x) * (scratchA.z - scratchC.z)
        if (Math.abs(denom) < 1e-12) {
          continue
        }
        for (let rowIndex = r0; rowIndex <= r1; rowIndex += 1) {
          const pz = minZ + rowIndex * cellSize
          for (let colIndex = c0; colIndex <= c1; colIndex += 1) {
            const cellIndex = rowIndex * cols + colIndex
            if (cellArea[cellIndex]! <= area) {
              continue
            }
            const px = minX + colIndex * cellSize
            const w0 = ((scratchB.z - scratchC.z) * (px - scratchC.x) + (scratchC.x - scratchB.x) * (pz - scratchC.z)) / denom
            const w1 = ((scratchC.z - scratchA.z) * (px - scratchC.x) + (scratchA.x - scratchC.x) * (pz - scratchC.z)) / denom
            const w2 = 1 - w0 - w1
            const epsilon = -1e-6
            if (w0 < epsilon || w1 < epsilon || w2 < epsilon) {
              continue
            }
            heights[cellIndex] = w0 * scratchA.y + w1 * scratchB.y + w2 * scratchC.y
            cellArea[cellIndex] = area
            coverage[cellIndex] = 1
          }
        }
      }
      const processed = limit - triangleCursor
      budget -= processed
      trianglesProcessed += processed
      triangleCursor = limit
      if (triangleCursor >= source.triangleCount) {
        sourceIndex += 1
        triangleCursor = 0
      } else {
        break
      }
    }

    const totalTriangles = sources.reduce((sum, source) => sum + source.triangleCount, 0)
    if (trianglesProcessed >= totalTriangles) {
      phase = 'dilate'
    }
  }

  const stepDilate = (): void => {
    // Fill single-cell holes left by triangles that fall between sample centers.
    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
      for (let colIndex = 0; colIndex < cols; colIndex += 1) {
        const cellIndex = rowIndex * cols + colIndex
        if (coverage[cellIndex]) {
          continue
        }
        let sum = 0
        let count = 0
        if (colIndex > 0 && coverage[cellIndex - 1]) {
          sum += heights[cellIndex - 1]!
          count += 1
        }
        if (colIndex < cols - 1 && coverage[cellIndex + 1]) {
          sum += heights[cellIndex + 1]!
          count += 1
        }
        if (rowIndex > 0 && coverage[cellIndex - cols]) {
          sum += heights[cellIndex - cols]!
          count += 1
        }
        if (rowIndex < rows - 1 && coverage[cellIndex + cols]) {
          sum += heights[cellIndex + cols]!
          count += 1
        }
        if (count >= 2) {
          heights[cellIndex] = sum / count
          coverage[cellIndex] = 1
        }
      }
    }
    phase = 'done'
  }

  const builder: TerrainGridBuilder = {
    step(): boolean {
      if (phase === 'done' || phase === 'error') {
        return true
      }
      if (phase === 'collect') {
        sources = toMeshSources(inputSources)
        if (!sources.length) {
          error = 'no-mesh-source'
          phase = 'error'
          return true
        }
        sourcesTotalVertices = sources.reduce((sum, source) => sum + source.vertexCount, 0)
        phase = 'bounds'
        return false
      }
      if (phase === 'bounds') {
        stepBounds()
        return (phase as string) === 'error'
      }
      if (phase === 'init') {
        stepInit()
        return false
      }
      if (phase === 'triangles') {
        stepTriangles()
        return false
      }
      if (phase === 'dilate') {
        stepDilate()
        result = createGridFromArrays({
          minX,
          minZ,
          cellSize,
          cols,
          rows,
          heights,
          coverage,
          averageEdgeLength: edgeCount > 0 ? edgeSum / edgeCount : cellSize,
        })
        return true
      }
      return true
    },
    get done() {
      return phase === 'done' || phase === 'error'
    },
    get progress() {
      return progress()
    },
    get result() {
      return result
    },
    get error() {
      return error
    },
  }
  return builder
}

export function buildTerrainHeightGrid(
  root: THREE.Object3D,
  options: TerrainGridBuildOptions = {},
): TerrainHeightGrid | null {
  return buildTerrainHeightGridFromSources(collectTerrainMeshSources(root), options)
}

export function buildTerrainHeightGridFromSources(
  sources: TerrainMeshSource[],
  options: TerrainGridBuildOptions = {},
): TerrainHeightGrid | null {
  const builder = createTerrainGridBuilder(sources, options)
  let guard = 0
  while (!builder.step()) {
    guard += 1
    if (guard > 100000) {
      break
    }
  }
  return builder.result
}
