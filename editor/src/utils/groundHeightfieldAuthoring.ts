import type {
  GroundDynamicMesh,
  GroundLocalEditTileData,
  GroundLocalEditTileMap,
  GroundWorldBounds,
} from '@schema/core'
import {
  formatGroundLocalEditTileKey,
  resolveGroundChunkCoordFromWorldPosition,
  resolveGroundEditTileSizeMeters,
  resolveGroundWorldBounds,
  resolveInfiniteGroundGridOriginMeters,
} from '@schema/core'

export function resolveGroundHeightfieldTileGridOrigin(
  definition: Pick<GroundDynamicMesh, 'terrainMode' | 'worldBounds' | 'editTileSizeMeters' | 'cellSize' | 'chunkSizeMeters' | 'renderRadiusChunks' | 'collisionRadiusChunks'>,
  tileSizeMeters = resolveGroundEditTileSizeMeters(definition),
): { originX: number; originZ: number } {
  const safeTileSize = Number.isFinite(tileSizeMeters) && tileSizeMeters > 0
    ? tileSizeMeters
    : resolveGroundEditTileSizeMeters(definition)
  if (definition.terrainMode === 'infinite') {
    const origin = resolveInfiniteGroundGridOriginMeters(safeTileSize)
    return { originX: origin, originZ: origin }
  }
  const bounds = resolveGroundWorldBounds(definition)
  return {
    originX: bounds.minX,
    originZ: bounds.minZ,
  }
}

export function resolveGroundHeightfieldTileWorldMin(
  definition: Pick<GroundDynamicMesh, 'terrainMode' | 'worldBounds' | 'editTileSizeMeters' | 'cellSize' | 'chunkSizeMeters' | 'renderRadiusChunks' | 'collisionRadiusChunks'>,
  tileRow: number,
  tileColumn: number,
  tileSizeMeters = resolveGroundEditTileSizeMeters(definition),
): { minX: number; minZ: number } {
  const { originX, originZ } = resolveGroundHeightfieldTileGridOrigin(definition, tileSizeMeters)
  return {
    minX: originX + Math.trunc(tileColumn) * tileSizeMeters,
    minZ: originZ + Math.trunc(tileRow) * tileSizeMeters,
  }
}

export function resolveGroundHeightfieldTileWorldBounds(
  definition: Pick<GroundDynamicMesh, 'terrainMode' | 'worldBounds' | 'editTileSizeMeters' | 'cellSize' | 'chunkSizeMeters' | 'renderRadiusChunks' | 'collisionRadiusChunks'>,
  tile: Pick<GroundLocalEditTileData, 'tileRow' | 'tileColumn' | 'tileSizeMeters'>,
): GroundWorldBounds | null {
  const tileSizeMeters = Number(tile.tileSizeMeters)
  if (!Number.isFinite(tileSizeMeters) || tileSizeMeters <= 0) {
    return null
  }
  const { minX, minZ } = resolveGroundHeightfieldTileWorldMin(definition, tile.tileRow, tile.tileColumn, tileSizeMeters)
  return {
    minX,
    maxX: minX + tileSizeMeters,
    minZ,
    maxZ: minZ + tileSizeMeters,
  }
}

export function cloneGroundHeightfieldLocalEditTile(tile: GroundLocalEditTileData): GroundLocalEditTileData {
  return {
    ...tile,
    values: Array.isArray(tile.values) ? [...tile.values] : [],
  }
}

export function mergeGroundHeightfieldLocalEditTiles(
  base: GroundLocalEditTileMap | null | undefined,
  incoming: GroundLocalEditTileMap | null | undefined,
): GroundLocalEditTileMap {
  const merged: GroundLocalEditTileMap = {}
  Object.entries(base ?? {}).forEach(([key, tile]) => {
    if (!tile || typeof tile !== 'object') {
      return
    }
    const normalizedKey = typeof tile.key === 'string' && tile.key.trim() ? tile.key.trim() : key
    merged[normalizedKey] = cloneGroundHeightfieldLocalEditTile({
      ...tile,
      key: normalizedKey,
    })
  })
  Object.entries(incoming ?? {}).forEach(([key, tile]) => {
    if (!tile || typeof tile !== 'object') {
      return
    }
    const normalizedKey = typeof tile.key === 'string' && tile.key.trim() ? tile.key.trim() : key
    merged[normalizedKey] = cloneGroundHeightfieldLocalEditTile({
      ...tile,
      key: normalizedKey,
    })
  })
  return merged
}

export function collectGroundHeightfieldChunkKeysFromTiles(
  definition: Pick<GroundDynamicMesh, 'terrainMode' | 'worldBounds' | 'editTileSizeMeters' | 'cellSize' | 'chunkSizeMeters' | 'renderRadiusChunks' | 'collisionRadiusChunks'>,
  localEditTiles: GroundLocalEditTileMap | null | undefined,
): string[] {
  const tileMap = localEditTiles && typeof localEditTiles === 'object' ? localEditTiles : null
  if (!tileMap) {
    return []
  }
  const rawChunkSizeMeters = Number(definition.chunkSizeMeters)
  const chunkSizeMeters = Number.isFinite(rawChunkSizeMeters) && rawChunkSizeMeters > 0
    ? rawChunkSizeMeters
    : 1
  const chunkKeys = new Set<string>()
  Object.values(tileMap).forEach((tile) => {
    const tileBounds = resolveGroundHeightfieldTileWorldBounds(definition, tile)
    if (!tileBounds) {
      return
    }
    const maxEdgeEpsilon = Math.max(1e-9, chunkSizeMeters * 1e-9)
    const minCoord = resolveGroundChunkCoordFromWorldPosition(tileBounds.minX, tileBounds.minZ, chunkSizeMeters)
    const maxCoord = resolveGroundChunkCoordFromWorldPosition(tileBounds.maxX - maxEdgeEpsilon, tileBounds.maxZ - maxEdgeEpsilon, chunkSizeMeters)
    for (let row = minCoord.chunkZ; row <= maxCoord.chunkZ; row += 1) {
      for (let column = minCoord.chunkX; column <= maxCoord.chunkX; column += 1) {
        chunkKeys.add(formatGroundLocalEditTileKey(row, column))
      }
    }
  })
  return Array.from(chunkKeys)
}

export function collectGroundHeightfieldTilesForChunkKeys(
  definition: Pick<GroundDynamicMesh, 'terrainMode' | 'worldBounds' | 'editTileSizeMeters' | 'cellSize' | 'chunkSizeMeters' | 'renderRadiusChunks' | 'collisionRadiusChunks'>,
  localEditTiles: GroundLocalEditTileMap | null | undefined,
  chunkKeys: Iterable<string> | null | undefined,
): GroundLocalEditTileMap {
  const requested = new Set<string>()
  if (chunkKeys) {
    for (const key of chunkKeys) {
      if (typeof key === 'string' && key.length > 0) {
        requested.add(key)
      }
    }
  }
  if (!requested.size) {
    return {}
  }
  const collected: GroundLocalEditTileMap = {}
  Object.entries(localEditTiles ?? {}).forEach(([key, tile]) => {
    if (!tile || typeof tile !== 'object') {
      return
    }
    const tileChunkKeys = collectGroundHeightfieldChunkKeysFromTiles(definition, { [key]: tile })
    if (!tileChunkKeys.some((chunkKey) => requested.has(chunkKey))) {
      return
    }
    collected[key] = cloneGroundHeightfieldLocalEditTile(tile)
  })
  return collected
}

export function buildGroundHeightfieldPatch(options: {
  definition: Pick<GroundDynamicMesh, 'terrainMode' | 'worldBounds' | 'editTileSizeMeters' | 'cellSize' | 'chunkSizeMeters' | 'renderRadiusChunks' | 'collisionRadiusChunks'>
  source: 'manual' | 'dem' | 'mixed'
  localEditTiles: GroundLocalEditTileMap | null | undefined
  affectedChunkKeys?: string[] | null
  worldBounds?: GroundWorldBounds | null
  affectedRegion?: {
    minRow: number
    maxRow: number
    minColumn: number
    maxColumn: number
  } | null
  updatedAt?: number
}): {
  source: 'manual' | 'dem' | 'mixed'
  localEditTiles: GroundLocalEditTileMap
  affectedChunkKeys: string[]
  worldBounds: GroundWorldBounds | null
  affectedRegion: {
    minRow: number
    maxRow: number
    minColumn: number
    maxColumn: number
  } | null
  updatedAt: number
} {
  const localEditTiles = mergeGroundHeightfieldLocalEditTiles(options.localEditTiles, null)
  let worldBounds = options.worldBounds ?? null
  if (!worldBounds) {
    Object.values(localEditTiles).forEach((tile) => {
      const tileBounds = resolveGroundHeightfieldTileWorldBounds(options.definition, tile)
      if (!tileBounds) {
        return
      }
      worldBounds = worldBounds
        ? {
            minX: Math.min(worldBounds.minX, tileBounds.minX),
            maxX: Math.max(worldBounds.maxX, tileBounds.maxX),
            minZ: Math.min(worldBounds.minZ, tileBounds.minZ),
            maxZ: Math.max(worldBounds.maxZ, tileBounds.maxZ),
          }
        : { ...tileBounds }
    })
  }
  const affectedChunkKeys = Array.isArray(options.affectedChunkKeys) && options.affectedChunkKeys.length
    ? Array.from(new Set(options.affectedChunkKeys.filter((key) => typeof key === 'string' && key.length > 0)))
    : collectGroundHeightfieldChunkKeysFromTiles(options.definition, localEditTiles)
  return {
    source: options.source,
    localEditTiles,
    affectedChunkKeys,
    worldBounds,
    affectedRegion: options.affectedRegion ?? null,
    updatedAt: Number.isFinite(options.updatedAt) ? Number(options.updatedAt) : Date.now(),
  }
}
