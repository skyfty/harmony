import type {
  CompiledGroundCollisionTileData,
  CompiledGroundRenderTileData,
  GroundDynamicMesh,
} from '@schema'
import {
  computeCompiledGroundBoundsFromPositions,
  resolveGroundWorldBounds,
} from '@schema'
import { sampleGroundHeight } from '@schema/groundMesh'

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

export function sampleCompiledGroundHeight(
  definition: GroundDynamicMesh,
  worldBounds: ReturnType<typeof resolveGroundWorldBounds>,
  x: number,
  z: number,
): number {
  if (x >= worldBounds.minX && x <= worldBounds.maxX && z >= worldBounds.minZ && z <= worldBounds.maxZ) {
    const sampled = sampleGroundHeight(definition as any, x, z)
    return Number.isFinite(sampled) ? sampled : 0
  }
  if (definition.terrainMode === 'infinite' && Number.isFinite(definition.baseHeight)) {
    return Number(definition.baseHeight)
  }
  const clampedX = clamp(x, worldBounds.minX, worldBounds.maxX)
  const clampedZ = clamp(z, worldBounds.minZ, worldBounds.maxZ)
  const sampled = sampleGroundHeight(definition as any, clampedX, clampedZ)
  return Number.isFinite(sampled)
    ? sampled
    : (Number.isFinite(definition.baseHeight) ? Number(definition.baseHeight) : 0)
}

export function computeRegularGridNormals(
  heights: Float32Array,
  rows: number,
  columns: number,
  stepX: number,
  stepZ: number,
): Float32Array {
  const normals = new Float32Array((rows + 1) * (columns + 1) * 3)

  for (let row = 0; row <= rows; row += 1) {
    const upRow = row > 0 ? row - 1 : row
    const downRow = row < rows ? row + 1 : row
    const deltaZ = Math.max((downRow - upRow) * stepZ, 1e-6)

    for (let column = 0; column <= columns; column += 1) {
      const leftColumn = column > 0 ? column - 1 : column
      const rightColumn = column < columns ? column + 1 : column
      const deltaX = Math.max((rightColumn - leftColumn) * stepX, 1e-6)

      const leftHeight = heights[row * (columns + 1) + leftColumn] ?? 0
      const rightHeight = heights[row * (columns + 1) + rightColumn] ?? 0
      const upHeight = heights[upRow * (columns + 1) + column] ?? 0
      const downHeight = heights[downRow * (columns + 1) + column] ?? 0

      const tangentXX = deltaX
      const tangentXY = rightHeight - leftHeight
      const tangentXZ = 0

      const tangentZX = 0
      const tangentZY = downHeight - upHeight
      const tangentZZ = deltaZ

      let nx = tangentZY * tangentXZ - tangentZZ * tangentXY
      let ny = tangentZZ * tangentXX - tangentZX * tangentXZ
      let nz = tangentZX * tangentXY - tangentZY * tangentXX

      const length = Math.hypot(nx, ny, nz)
      if (length > 1e-6) {
        nx /= length
        ny /= length
        nz /= length
      } else {
        nx = 0
        ny = 1
        nz = 0
      }

      const offset = (row * (columns + 1) + column) * 3
      normals[offset + 0] = nx
      normals[offset + 1] = ny
      normals[offset + 2] = nz
    }
  }

  return normals
}

export function buildRenderTileGeometry(
  definition: GroundDynamicMesh,
  worldBounds: ReturnType<typeof resolveGroundWorldBounds>,
  minX: number,
  minZ: number,
  widthMeters: number,
  depthMeters: number,
): CompiledGroundRenderTileData | null {
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 1e-6 ? definition.cellSize : 1
  const columns = Math.max(1, Math.round(widthMeters / cellSize))
  const rows = Math.max(1, Math.round(depthMeters / cellSize))
  const stepX = widthMeters / columns
  const stepZ = depthMeters / rows
  const vertexCount = (columns + 1) * (rows + 1)
  const positions = new Float32Array(vertexCount * 3)
  const heights = new Float32Array(vertexCount)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = new Uint32Array(rows * columns * 6)

  let vertexIndex = 0
  for (let row = 0; row <= rows; row += 1) {
    const z = minZ + row * stepZ
    for (let column = 0; column <= columns; column += 1) {
      const x = minX + column * stepX
      const height = sampleCompiledGroundHeight(definition, worldBounds, x, z)
      const safeHeight = Number.isFinite(height) ? height : 0
      positions[vertexIndex * 3 + 0] = x
      positions[vertexIndex * 3 + 1] = safeHeight
      positions[vertexIndex * 3 + 2] = z
      heights[vertexIndex] = safeHeight
      uvs[vertexIndex * 2 + 0] = column / columns
      uvs[vertexIndex * 2 + 1] = 1 - (row / rows)
      vertexIndex += 1
    }
  }

  let indexOffset = 0
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column
      const b = a + 1
      const c = (row + 1) * (columns + 1) + column
      const d = c + 1
      indices[indexOffset + 0] = a
      indices[indexOffset + 1] = c
      indices[indexOffset + 2] = b
      indices[indexOffset + 3] = b
      indices[indexOffset + 4] = c
      indices[indexOffset + 5] = d
      indexOffset += 6
    }
  }

  const normals = computeRegularGridNormals(heights, rows, columns, stepX, stepZ)

  return {
    header: {
      version: 1,
      key: '',
      row: 0,
      column: 0,
      bounds: computeCompiledGroundBoundsFromPositions(positions),
      vertexCount,
      triangleCount: indices.length / 3,
      indexCount: indices.length,
    },
    positions,
    normals,
    uvs,
    indices,
  }
}

export function buildCollisionTileData(
  definition: GroundDynamicMesh,
  worldBounds: ReturnType<typeof resolveGroundWorldBounds>,
  minX: number,
  minZ: number,
  widthMeters: number,
  depthMeters: number,
  sampleStepMeters: number,
): CompiledGroundCollisionTileData {
  const step = Math.max(1e-6, sampleStepMeters)
  const columns = Math.max(1, Math.round(widthMeters / step))
  const rows = Math.max(1, Math.round(depthMeters / step))
  const stepX = widthMeters / columns
  const stepZ = depthMeters / rows
  const elementSize = Math.max(stepX, stepZ)
  const heights = new Float32Array((rows + 1) * (columns + 1))
  let minHeight = Number.POSITIVE_INFINITY
  let maxHeight = Number.NEGATIVE_INFINITY

  let offset = 0
  for (let row = 0; row <= rows; row += 1) {
    const z = minZ + row * stepZ
    for (let column = 0; column <= columns; column += 1) {
      const x = minX + column * stepX
      const height = sampleCompiledGroundHeight(definition, worldBounds, x, z)
      const safeHeight = Number.isFinite(height) ? height : 0
      heights[offset] = safeHeight
      minHeight = Math.min(minHeight, safeHeight)
      maxHeight = Math.max(maxHeight, safeHeight)
      offset += 1
    }
  }

  return {
    header: {
      version: 1,
      key: '',
      row: 0,
      column: 0,
      bounds: {
        minX,
        minY: Number.isFinite(minHeight) ? minHeight : 0,
        minZ,
        maxX: minX + widthMeters,
        maxY: Number.isFinite(maxHeight) ? maxHeight : 0,
        maxZ: minZ + depthMeters,
      },
      rows,
      columns,
      elementSize,
      minHeight: Number.isFinite(minHeight) ? minHeight : 0,
      maxHeight: Number.isFinite(maxHeight) ? maxHeight : 0,
    },
    heights,
  }
}
