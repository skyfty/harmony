import type {
  CompiledGroundCollisionTileData,
  CompiledGroundRenderTileData,
  GroundDynamicMesh,
} from '@schema'
import {
  computeCompiledGroundBoundsFromPositions,
  resolveGroundChunkCoordFromWorldPosition,
  resolveGroundChunkOrigin,
  resolveGroundWorldBounds,
  resolveInfiniteGroundGridOriginMeters,
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

type GroundLocalEditTileLike = NonNullable<GroundDynamicMesh['localEditTiles']>[string]

export type CompiledGroundRenderChunkDiagnostic = {
  chunkKey: string
  regionMinX: number
  regionMinZ: number
  regionWidthMeters: number
  regionDepthMeters: number
  sampleStepMeters: number
  localEditTileKey: string | null
  localEditSource: string | null
  localEditResolution: number | null
  localEditCellSize: number | null
}

function resolveGroundBaseCellSize(definition: GroundDynamicMesh): number {
  return Number.isFinite(definition.cellSize) && definition.cellSize > 1e-6 ? definition.cellSize : 1
}

function resolveFallbackCompiledSampleStepMeters(
  definition: GroundDynamicMesh,
  sampleStepMeters?: number,
): number {
  const baseCellSize = resolveGroundBaseCellSize(definition)
  return Number.isFinite(sampleStepMeters) && (sampleStepMeters ?? 0) > 1e-6
    ? Math.max(baseCellSize, Number(sampleStepMeters))
    : baseCellSize
}

function resolveGroundChunkSizeMeters(definition: GroundDynamicMesh): number {
  return Number.isFinite(definition.chunkSizeMeters) && (definition.chunkSizeMeters ?? 0) > 1e-6
    ? Number(definition.chunkSizeMeters)
    : 100
}

function resolveGroundLocalEditTileWorldBounds(tile: GroundLocalEditTileLike): {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
} | null {
  const tileSizeMeters = Number(tile.tileSizeMeters)
  if (!Number.isFinite(tileSizeMeters) || tileSizeMeters <= 1e-6) {
    return null
  }
  const origin = resolveInfiniteGroundGridOriginMeters(tileSizeMeters)
  const minX = origin + Math.trunc(Number(tile.tileColumn) || 0) * tileSizeMeters
  const minZ = origin + Math.trunc(Number(tile.tileRow) || 0) * tileSizeMeters
  return {
    minX,
    minZ,
    maxX: minX + tileSizeMeters,
    maxZ: minZ + tileSizeMeters,
  }
}

function resolveGroundLocalEditTileCellSize(tile: GroundLocalEditTileLike): number | null {
  const tileSizeMeters = Number(tile.tileSizeMeters)
  const resolution = Math.max(1, Math.trunc(Number(tile.resolution) || 0))
  if (!Number.isFinite(tileSizeMeters) || tileSizeMeters <= 1e-6 || resolution <= 0) {
    return null
  }
  const cellSize = tileSizeMeters / resolution
  return Number.isFinite(cellSize) && cellSize > 1e-6 ? cellSize : null
}

function findCompiledGroundLocalEditTileForRegion(
  definition: GroundDynamicMesh,
  minX: number,
  minZ: number,
  widthMeters: number,
  depthMeters: number,
): { key: string; tile: GroundLocalEditTileLike } | null {
  const localEditTileMap = definition.localEditTiles && typeof definition.localEditTiles === 'object'
    ? definition.localEditTiles
    : null
  if (!localEditTileMap) {
    return null
  }
  const maxX = minX + widthMeters
  const maxZ = minZ + depthMeters
  const chunkSizeMeters = resolveGroundChunkSizeMeters(definition)
  const minCoord = resolveGroundChunkCoordFromWorldPosition(minX, minZ, chunkSizeMeters)
  const maxCoord = resolveGroundChunkCoordFromWorldPosition(maxX - Number.EPSILON, maxZ - Number.EPSILON, chunkSizeMeters)

  for (let chunkZ = minCoord.chunkZ; chunkZ <= maxCoord.chunkZ; chunkZ += 1) {
    for (let chunkX = minCoord.chunkX; chunkX <= maxCoord.chunkX; chunkX += 1) {
      const key = `${chunkZ}:${chunkX}`
      const tile = localEditTileMap[key]
      if (tile && typeof tile === 'object') {
        return { key, tile }
      }
    }
  }

  for (const [key, tile] of Object.entries(localEditTileMap)) {
    if (!tile || typeof tile !== 'object') {
      continue
    }
    const bounds = resolveGroundLocalEditTileWorldBounds(tile)
    if (!bounds || !regionOverlapsBounds(minX, minZ, maxX, maxZ, bounds)) {
      continue
    }
    return { key, tile }
  }

  return null
}

function regionOverlapsBounds(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
): boolean {
  return bounds.maxX > minX
    && bounds.minX < maxX
    && bounds.maxZ > minZ
    && bounds.minZ < maxZ
}

function resolveCompiledGroundLocalEditSampleStepMeters(
  definition: GroundDynamicMesh,
  minX: number,
  minZ: number,
  widthMeters: number,
  depthMeters: number,
): number | null {
  const localEditTileMap = definition.localEditTiles && typeof definition.localEditTiles === 'object'
    ? definition.localEditTiles
    : null
  if (!localEditTileMap) {
    return null
  }
  const localEditTiles = Object.values(localEditTileMap)
  if (!localEditTiles.length) {
    return null
  }
  const maxX = minX + widthMeters
  const maxZ = minZ + depthMeters
  const chunkSizeMeters = resolveGroundChunkSizeMeters(definition)
  const minCoord = resolveGroundChunkCoordFromWorldPosition(minX, minZ, chunkSizeMeters)
  const maxCoord = resolveGroundChunkCoordFromWorldPosition(maxX - Number.EPSILON, maxZ - Number.EPSILON, chunkSizeMeters)
  let resolved: number | null = null
  let foundDirectTile = false

  for (let chunkZ = minCoord.chunkZ; chunkZ <= maxCoord.chunkZ; chunkZ += 1) {
    for (let chunkX = minCoord.chunkX; chunkX <= maxCoord.chunkX; chunkX += 1) {
      const tile = localEditTileMap[`${chunkZ}:${chunkX}`]
      if (!tile || typeof tile !== 'object') {
        continue
      }
      const resolution = Math.max(1, Math.trunc(Number(tile.resolution) || 0))
      const tileSizeMeters = Number(tile.tileSizeMeters)
      if (!Number.isFinite(tileSizeMeters) || tileSizeMeters <= 1e-6) {
        continue
      }
      const cellSize = tileSizeMeters / resolution
      if (!Number.isFinite(cellSize) || cellSize <= 1e-6) {
        continue
      }
      foundDirectTile = true
      resolved = resolved === null ? cellSize : Math.min(resolved, cellSize)
    }
  }

  if (foundDirectTile) {
    return resolved
  }

  for (const tile of localEditTiles) {
    if (!tile || typeof tile !== 'object') {
      continue
    }
    const tileBounds = resolveGroundLocalEditTileWorldBounds(tile)
    if (!tileBounds || !regionOverlapsBounds(minX, minZ, maxX, maxZ, tileBounds)) {
      continue
    }
    const resolution = Math.max(1, Math.trunc(Number(tile.resolution) || 0))
    const tileSizeMeters = Number(tile.tileSizeMeters)
    if (!Number.isFinite(tileSizeMeters) || tileSizeMeters <= 1e-6) {
      continue
    }
    const cellSize = tileSizeMeters / resolution
    if (!Number.isFinite(cellSize) || cellSize <= 1e-6) {
      continue
    }
    resolved = resolved === null ? cellSize : Math.min(resolved, cellSize)
  }
  return resolved
}

function resolveCompiledGroundRegionSampleStepMeters(
  definition: GroundDynamicMesh,
  minX: number,
  minZ: number,
  widthMeters: number,
  depthMeters: number,
  sampleStepMeters?: number,
): number {
  const localEditStep = resolveCompiledGroundLocalEditSampleStepMeters(
    definition,
    minX,
    minZ,
    widthMeters,
    depthMeters,
  )
  if (localEditStep !== null) {
    return localEditStep
  }
  return resolveFallbackCompiledSampleStepMeters(definition, sampleStepMeters)
}

export function collectCompiledGroundRenderChunkDiagnostics(
  definition: GroundDynamicMesh,
  minX: number,
  minZ: number,
  widthMeters: number,
  depthMeters: number,
  sampleStepMeters?: number,
): CompiledGroundRenderChunkDiagnostic[] {
  const chunkSizeMeters = resolveGroundChunkSizeMeters(definition)
  const maxX = minX + widthMeters
  const maxZ = minZ + depthMeters
  const minCoord = resolveGroundChunkCoordFromWorldPosition(minX, minZ, chunkSizeMeters)
  const maxCoord = resolveGroundChunkCoordFromWorldPosition(maxX - Number.EPSILON, maxZ - Number.EPSILON, chunkSizeMeters)
  const diagnostics: CompiledGroundRenderChunkDiagnostic[] = []

  for (let chunkZ = minCoord.chunkZ; chunkZ <= maxCoord.chunkZ; chunkZ += 1) {
    for (let chunkX = minCoord.chunkX; chunkX <= maxCoord.chunkX; chunkX += 1) {
      const origin = resolveGroundChunkOrigin({ chunkX, chunkZ }, chunkSizeMeters)
      const regionMinX = Math.max(minX, origin.x)
      const regionMinZ = Math.max(minZ, origin.z)
      const regionMaxX = Math.min(maxX, origin.x + chunkSizeMeters)
      const regionMaxZ = Math.min(maxZ, origin.z + chunkSizeMeters)
      const regionWidthMeters = regionMaxX - regionMinX
      const regionDepthMeters = regionMaxZ - regionMinZ
      if (!(regionWidthMeters > 1e-6) || !(regionDepthMeters > 1e-6)) {
        continue
      }
      const localEditMatch = findCompiledGroundLocalEditTileForRegion(
        definition,
        regionMinX,
        regionMinZ,
        regionWidthMeters,
        regionDepthMeters,
      )
      const localEditCellSize = localEditMatch ? resolveGroundLocalEditTileCellSize(localEditMatch.tile) : null
      diagnostics.push({
        chunkKey: `${chunkX}:${chunkZ}`,
        regionMinX,
        regionMinZ,
        regionWidthMeters,
        regionDepthMeters,
        sampleStepMeters: resolveCompiledGroundRegionSampleStepMeters(
          definition,
          regionMinX,
          regionMinZ,
          regionWidthMeters,
          regionDepthMeters,
          sampleStepMeters,
        ),
        localEditTileKey: localEditMatch?.key ?? null,
        localEditSource: localEditMatch?.tile.source ?? null,
        localEditResolution: localEditMatch ? Math.max(1, Math.trunc(Number(localEditMatch.tile.resolution) || 0)) : null,
        localEditCellSize,
      })
    }
  }

  return diagnostics
}

function buildRegularGridRenderTileGeometry(
  definition: GroundDynamicMesh,
  worldBounds: ReturnType<typeof resolveGroundWorldBounds>,
  minX: number,
  minZ: number,
  widthMeters: number,
  depthMeters: number,
  sampleStepMeters?: number,
): CompiledGroundRenderTileData | null {
  const cellSize = resolveFallbackCompiledSampleStepMeters(definition, sampleStepMeters)
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
      uvs[vertexIndex * 2 + 0] = widthMeters > 1e-6 ? (x - minX) / widthMeters : 0
      uvs[vertexIndex * 2 + 1] = depthMeters > 1e-6 ? 1 - ((z - minZ) / depthMeters) : 1
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

function mergeRenderTileGeometries(
  parts: CompiledGroundRenderTileData[],
): CompiledGroundRenderTileData | null {
  if (!parts.length) {
    return null
  }
  if (parts.length === 1) {
    return parts[0] ?? null
  }
  let totalVertexCount = 0
  let totalIndexCount = 0
  for (const part of parts) {
    totalVertexCount += part.positions.length / 3
    totalIndexCount += part.indices.length
  }
  const positions = new Float32Array(totalVertexCount * 3)
  const normals = new Float32Array(totalVertexCount * 3)
  const uvs = new Float32Array(totalVertexCount * 2)
  const indices = new Uint32Array(totalIndexCount)
  let vertexOffset = 0
  let positionOffset = 0
  let uvOffset = 0
  let indexOffset = 0
  for (const part of parts) {
    positions.set(part.positions, positionOffset)
    normals.set(part.normals, positionOffset)
    uvs.set(part.uvs, uvOffset)
    for (let index = 0; index < part.indices.length; index += 1) {
      indices[indexOffset + index] = part.indices[index]! + vertexOffset
    }
    vertexOffset += part.positions.length / 3
    positionOffset += part.positions.length
    uvOffset += part.uvs.length
    indexOffset += part.indices.length
  }
  return {
    header: {
      version: 1,
      key: '',
      row: 0,
      column: 0,
      bounds: computeCompiledGroundBoundsFromPositions(positions),
      vertexCount: totalVertexCount,
      triangleCount: indices.length / 3,
      indexCount: indices.length,
    },
    positions,
    normals,
    uvs,
    indices,
  }
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
  sampleStepMeters?: number,
): CompiledGroundRenderTileData | null {
  const localEditTiles = definition.localEditTiles && typeof definition.localEditTiles === 'object'
    ? Object.keys(definition.localEditTiles)
    : []
  if (!localEditTiles.length) {
    return buildRegularGridRenderTileGeometry(
      definition,
      worldBounds,
      minX,
      minZ,
      widthMeters,
      depthMeters,
      sampleStepMeters,
    )
  }

  const chunkSizeMeters = resolveGroundChunkSizeMeters(definition)
  const maxX = minX + widthMeters
  const maxZ = minZ + depthMeters
  const minCoord = resolveGroundChunkCoordFromWorldPosition(minX, minZ, chunkSizeMeters)
  const maxCoord = resolveGroundChunkCoordFromWorldPosition(maxX - Number.EPSILON, maxZ - Number.EPSILON, chunkSizeMeters)
  const parts: CompiledGroundRenderTileData[] = []

  for (let chunkZ = minCoord.chunkZ; chunkZ <= maxCoord.chunkZ; chunkZ += 1) {
    for (let chunkX = minCoord.chunkX; chunkX <= maxCoord.chunkX; chunkX += 1) {
      const origin = resolveGroundChunkOrigin({ chunkX, chunkZ }, chunkSizeMeters)
      const regionMinX = Math.max(minX, origin.x)
      const regionMinZ = Math.max(minZ, origin.z)
      const regionMaxX = Math.min(maxX, origin.x + chunkSizeMeters)
      const regionMaxZ = Math.min(maxZ, origin.z + chunkSizeMeters)
      const regionWidthMeters = regionMaxX - regionMinX
      const regionDepthMeters = regionMaxZ - regionMinZ
      if (!(regionWidthMeters > 1e-6) || !(regionDepthMeters > 1e-6)) {
        continue
      }
      const regionSampleStepMeters = resolveCompiledGroundRegionSampleStepMeters(
        definition,
        regionMinX,
        regionMinZ,
        regionWidthMeters,
        regionDepthMeters,
        sampleStepMeters,
      )
      const part = buildRegularGridRenderTileGeometry(
        definition,
        worldBounds,
        regionMinX,
        regionMinZ,
        regionWidthMeters,
        regionDepthMeters,
        regionSampleStepMeters,
      )
      if (part) {
        parts.push(part)
      }
    }
  }

  return mergeRenderTileGeometries(parts)
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
  const step = resolveCompiledGroundRegionSampleStepMeters(
    definition,
    minX,
    minZ,
    widthMeters,
    depthMeters,
    sampleStepMeters,
  )
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
