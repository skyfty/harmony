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
  buildGroundHeightfieldPatch,
  collectGroundHeightfieldChunkKeysFromTiles,
  collectGroundHeightfieldTilesForChunkKeys,
  mergeGroundHeightfieldLocalEditTiles,
  resolveGroundHeightfieldTileWorldBounds,
} from '@/utils/groundHeightfieldAuthoring'

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
  return mergeGroundHeightfieldLocalEditTiles(base, incoming)
}

export function resolveTerrainAuthoringTileWorldBounds(
  definition: Pick<GroundDynamicMesh, 'terrainMode' | 'worldBounds' | 'editTileSizeMeters' | 'cellSize' | 'chunkSizeMeters' | 'renderRadiusChunks' | 'collisionRadiusChunks'>,
  tile: GroundLocalEditTileData,
): GroundWorldBounds | null {
  return resolveGroundHeightfieldTileWorldBounds(definition, tile)
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
    const tileBounds = resolveTerrainAuthoringTileWorldBounds({
      terrainMode: 'infinite',
      worldBounds: null,
      editTileSizeMeters: tile.tileSizeMeters,
      cellSize: tile.tileSizeMeters,
      chunkSizeMeters: tile.tileSizeMeters,
      renderRadiusChunks: 1,
      collisionRadiusChunks: 1,
    }, tile)
    if (!tileBounds || !overlapsBounds(tileBounds, worldBounds)) {
      return
    }
    collected[key] = cloneTerrainAuthoringTile(tile)
  })
  return collected
}

void mergeWorldBounds

export function collectTerrainAuthoringChunkKeysFromTiles(
  definition: GroundDynamicMesh,
  localEditTiles: GroundLocalEditTileMap | null | undefined,
): string[] {
  return collectGroundHeightfieldChunkKeysFromTiles(definition, localEditTiles)
}

export function collectTerrainAuthoringTilesForChunkKeys(
  definition: GroundDynamicMesh,
  localEditTiles: GroundLocalEditTileMap | null | undefined,
  chunkKeys: Iterable<string> | null | undefined,
): GroundLocalEditTileMap {
  return collectGroundHeightfieldTilesForChunkKeys(definition, localEditTiles, chunkKeys)
}

export function buildTerrainAuthoringPatch(options: {
  definition: GroundDynamicMesh
  source: TerrainAuthoringSource
  localEditTiles: GroundLocalEditTileMap | null | undefined
  affectedChunkKeys?: string[] | null
  worldBounds?: GroundWorldBounds | null
  affectedRegion?: TerrainAuthoringPatch['affectedRegion']
  updatedAt?: number
}): TerrainAuthoringPatch {
  const patch = buildGroundHeightfieldPatch({
    definition: options.definition,
    source: options.source,
    localEditTiles: options.localEditTiles,
    affectedChunkKeys: options.affectedChunkKeys,
    worldBounds: options.worldBounds ?? null,
    affectedRegion: options.affectedRegion ?? null,
    updatedAt: options.updatedAt,
  })
  return {
    source: patch.source,
    localEditTiles: patch.localEditTiles,
    affectedChunkKeys: patch.affectedChunkKeys,
    worldBounds: patch.worldBounds,
    affectedRegion: patch.affectedRegion,
    updatedAt: patch.updatedAt,
  }
}

export function buildTerrainAuthoringResult(options: {
  definition: GroundDynamicMesh
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
  return mergeGroundHeightfieldLocalEditTiles(base, patch.localEditTiles)
}
