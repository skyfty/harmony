import type {
  GroundDynamicMesh,
  GroundLocalEditTileData,
  GroundLocalEditTileMap,
  GroundWorldBounds,
  TerrainAuthoringBuildResult,
  TerrainAuthoringPatch,
  TerrainAuthoringSource,
} from '@schema/core'
import {
  formatGroundLocalEditTileKey,
  resolveGroundChunkCoordFromWorldPosition,
  resolveInfiniteGroundGridOriginMeters,
} from '@schema/core'

function cloneTerrainAuthoringTile(tile: GroundLocalEditTileData): GroundLocalEditTileData {
  return {
    ...tile,
    values: Array.isArray(tile.values) ? [...tile.values] : [],
  }
}

export function cloneTerrainAuthoringLocalEditTiles(
  localEditTiles: GroundLocalEditTileMap | null | undefined,
): GroundLocalEditTileMap {
  if (!localEditTiles || typeof localEditTiles !== 'object') {
    return {}
  }
  const cloned: GroundLocalEditTileMap = {}
  Object.entries(localEditTiles).forEach(([key, tile]) => {
    if (!tile || typeof tile !== 'object') {
      return
    }
    const normalizedKey = typeof tile.key === 'string' && tile.key.trim() ? tile.key.trim() : key
    cloned[normalizedKey] = cloneTerrainAuthoringTile({
      ...tile,
      key: normalizedKey,
    })
  })
  return cloned
}

export function mergeTerrainAuthoringLocalEditTiles(
  base: GroundLocalEditTileMap | null | undefined,
  incoming: GroundLocalEditTileMap | null | undefined,
): GroundLocalEditTileMap {
  const merged = cloneTerrainAuthoringLocalEditTiles(base)
  Object.entries(cloneTerrainAuthoringLocalEditTiles(incoming)).forEach(([key, tile]) => {
    merged[key] = tile
  })
  return merged
}

export function resolveTerrainAuthoringTileWorldBounds(tile: GroundLocalEditTileData): GroundWorldBounds | null {
  const tileSizeMeters = Number(tile.tileSizeMeters)
  const tileRow = Number(tile.tileRow)
  const tileColumn = Number(tile.tileColumn)
  if (!Number.isFinite(tileSizeMeters) || tileSizeMeters <= 0 || !Number.isFinite(tileRow) || !Number.isFinite(tileColumn)) {
    return null
  }
  const origin = resolveInfiniteGroundGridOriginMeters(tileSizeMeters)
  const minX = origin + tileColumn * tileSizeMeters
  const minZ = origin + tileRow * tileSizeMeters
  return {
    minX,
    maxX: minX + tileSizeMeters,
    minZ,
    maxZ: minZ + tileSizeMeters,
  }
}

function mergeWorldBounds(
  current: GroundWorldBounds | null,
  next: GroundWorldBounds | null,
): GroundWorldBounds | null {
  if (!next) {
    return current
  }
  if (!current) {
    return { ...next }
  }
  return {
    minX: Math.min(current.minX, next.minX),
    maxX: Math.max(current.maxX, next.maxX),
    minZ: Math.min(current.minZ, next.minZ),
    maxZ: Math.max(current.maxZ, next.maxZ),
  }
}

function overlapsBounds(a: GroundWorldBounds, b: GroundWorldBounds): boolean {
  return a.maxX > b.minX
    && a.minX < b.maxX
    && a.maxZ > b.minZ
    && a.minZ < b.maxZ
}

export function collectTerrainAuthoringTilesForWorldBounds(
  localEditTiles: GroundLocalEditTileMap | null | undefined,
  worldBounds: GroundWorldBounds | null | undefined,
): GroundLocalEditTileMap {
  if (!worldBounds) {
    return cloneTerrainAuthoringLocalEditTiles(localEditTiles)
  }
  const collected: GroundLocalEditTileMap = {}
  Object.entries(localEditTiles ?? {}).forEach(([key, tile]) => {
    if (!tile || typeof tile !== 'object') {
      return
    }
    const tileBounds = resolveTerrainAuthoringTileWorldBounds(tile)
    if (!tileBounds || !overlapsBounds(tileBounds, worldBounds)) {
      return
    }
    collected[key] = cloneTerrainAuthoringTile(tile)
  })
  return collected
}

export function collectTerrainAuthoringChunkKeysFromTiles(
  definition: Pick<GroundDynamicMesh, 'chunkSizeMeters'>,
  localEditTiles: GroundLocalEditTileMap | null | undefined,
): string[] {
  const tileMap = localEditTiles && typeof localEditTiles === 'object' ? localEditTiles : null
  if (!tileMap) {
    return []
  }
  const chunkSizeMeters = Number.isFinite(definition.chunkSizeMeters) && definition.chunkSizeMeters > 0
    ? definition.chunkSizeMeters
    : GROUND_TERRAIN_CHUNK_SIZE_METERS
  const chunkKeys = new Set<string>()
  Object.values(tileMap).forEach((tile) => {
    if (!tile || typeof tile !== 'object') {
      return
    }
    const bounds = resolveTerrainAuthoringTileWorldBounds(tile)
    if (!bounds) {
      return
    }
    const maxEdgeEpsilon = Math.max(1e-9, chunkSizeMeters * 1e-9)
    const minCoord = resolveGroundChunkCoordFromWorldPosition(bounds.minX, bounds.minZ, chunkSizeMeters)
    const maxCoord = resolveGroundChunkCoordFromWorldPosition(bounds.maxX - maxEdgeEpsilon, bounds.maxZ - maxEdgeEpsilon, chunkSizeMeters)
    for (let row = minCoord.chunkZ; row <= maxCoord.chunkZ; row += 1) {
      for (let column = minCoord.chunkX; column <= maxCoord.chunkX; column += 1) {
        chunkKeys.add(formatGroundLocalEditTileKey(row, column))
      }
    }
  })
  return Array.from(chunkKeys)
}

export function collectTerrainAuthoringTilesForChunkKeys(
  definition: Pick<GroundDynamicMesh, 'chunkSizeMeters'>,
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
    const tileChunkKeys = collectTerrainAuthoringChunkKeysFromTiles(definition, { [key]: tile })
    if (!tileChunkKeys.some((chunkKey) => requested.has(chunkKey))) {
      return
    }
    collected[key] = cloneTerrainAuthoringTile(tile)
  })
  return collected
}

export function buildTerrainAuthoringPatch(options: {
  definition: Pick<GroundDynamicMesh, 'chunkSizeMeters'>
  source: TerrainAuthoringSource
  localEditTiles: GroundLocalEditTileMap | null | undefined
  affectedChunkKeys?: string[] | null
  worldBounds?: GroundWorldBounds | null
  affectedRegion?: TerrainAuthoringPatch['affectedRegion']
  updatedAt?: number
}): TerrainAuthoringPatch {
  const localEditTiles = cloneTerrainAuthoringLocalEditTiles(options.localEditTiles)
  let worldBounds = options.worldBounds ?? null
  if (!worldBounds) {
    Object.values(localEditTiles).forEach((tile) => {
      worldBounds = mergeWorldBounds(worldBounds, resolveTerrainAuthoringTileWorldBounds(tile))
    })
  }
  const affectedChunkKeys = Array.isArray(options.affectedChunkKeys) && options.affectedChunkKeys.length
    ? Array.from(new Set(options.affectedChunkKeys.filter((key) => typeof key === 'string' && key.length > 0)))
    : collectTerrainAuthoringChunkKeysFromTiles(options.definition, localEditTiles)
  return {
    source: options.source,
    localEditTiles,
    affectedChunkKeys,
    worldBounds,
    affectedRegion: options.affectedRegion ?? null,
    updatedAt: Number.isFinite(options.updatedAt) ? Number(options.updatedAt) : Date.now(),
  }
}

export function buildTerrainAuthoringResult(options: {
  definition: Pick<GroundDynamicMesh, 'chunkSizeMeters'>
  source: TerrainAuthoringSource
  localEditTiles: GroundLocalEditTileMap | null | undefined
  affectedChunkKeys?: string[] | null
  worldBounds?: GroundWorldBounds | null
  affectedRegion?: TerrainAuthoringPatch['affectedRegion']
  updatedAt?: number
}): TerrainAuthoringBuildResult {
  const patch = buildTerrainAuthoringPatch(options)
  return {
    patch,
    dirtyChunkKeys: [...patch.affectedChunkKeys],
    localEditTiles: patch.localEditTiles,
  }
}

export function applyTerrainAuthoringPatch(
  base: GroundLocalEditTileMap | null | undefined,
  patch: Pick<TerrainAuthoringPatch, 'localEditTiles'>,
): GroundLocalEditTileMap {
  return mergeTerrainAuthoringLocalEditTiles(base, patch.localEditTiles)
}
