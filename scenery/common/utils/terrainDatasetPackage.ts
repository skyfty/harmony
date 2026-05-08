import {
  dequantizeTerrainHeight,
  deserializeQuantizedTerrainPack,
  deserializeQuantizedTerrainMesh,
  formatQuantizedTerrainTileKey,
  parseQuantizedTerrainTileKey,
  readQuantizedTerrainPackEntry,
  resolveQuantizedTerrainRegionIdForTile,
  type GroundTerrainHeightSampler,
  type QuantizedTerrainDatasetRootManifest,
  type QuantizedTerrainMeshData,
  type ScenePackageSceneEntry,
} from '@harmony/schema'
import type { ScenePackageUnzipped } from '@harmony/schema/scenePackageZip'

export function readTerrainDatasetManifestFromScenePackage(
  pkg: ScenePackageUnzipped,
  sceneEntry: Pick<ScenePackageSceneEntry, 'terrain'>,
): QuantizedTerrainDatasetRootManifest | null {
  const rootManifestPath = typeof sceneEntry.terrain?.rootManifestPath === 'string'
    ? sceneEntry.terrain.rootManifestPath.trim()
    : ''
  if (!rootManifestPath) {
    return null
  }
  const bytes = pkg.files[rootManifestPath]
  if (!bytes) {
    throw new Error(`场景包缺少 terrain dataset manifest: ${rootManifestPath}`)
  }
  const text = new TextDecoder().decode(bytes)
  return JSON.parse(text) as QuantizedTerrainDatasetRootManifest
}

export function readTerrainDatasetRegionPackFromScenePackage(
  pkg: ScenePackageUnzipped,
  manifest: QuantizedTerrainDatasetRootManifest | null,
  regionKey: string,
): ArrayBuffer | null {
  if (!manifest || !Array.isArray(manifest.regions)) {
    return null
  }
  const normalizedRegionKey = typeof regionKey === 'string' ? regionKey.trim() : ''
  if (!normalizedRegionKey) {
    return null
  }
  const region = manifest.regions.find((entry) => entry.regionKey === normalizedRegionKey) ?? null
  const regionPath = typeof region?.path === 'string' ? region.path.trim() : ''
  if (!regionPath) {
    return null
  }
  const bytes = pkg.files[regionPath]
  if (!bytes) {
    throw new Error(`场景包缺少 terrain dataset region pack: ${regionPath}`)
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function inferTileGridShape(tileData: QuantizedTerrainMeshData): { rows: number; columns: number } | null {
  const vertexCount = tileData.header.vertexCount
  if (!vertexCount || tileData.u.length !== vertexCount || tileData.v.length !== vertexCount || vertexCount < 4) {
    return null
  }

  const rowsFromEdges = tileData.westIndices.length - 1
  const columnsFromEdges = tileData.southIndices.length - 1
  if (rowsFromEdges >= 1 && columnsFromEdges >= 1 && (rowsFromEdges + 1) * (columnsFromEdges + 1) === vertexCount) {
    return { rows: rowsFromEdges, columns: columnsFromEdges }
  }

  let columns = -1
  for (let index = 1; index < tileData.v.length; index += 1) {
    if (tileData.v[index] !== tileData.v[0]) {
      columns = index - 1
      break
    }
  }
  if (columns < 1) {
    return null
  }

  const rows = Math.floor(vertexCount / (columns + 1)) - 1
  if (rows < 1 || (rows + 1) * (columns + 1) !== vertexCount) {
    return null
  }

  return { rows, columns }
}

function sampleQuantizedTerrainMeshHeight(tileData: QuantizedTerrainMeshData, x: number, z: number): number | null {
  const shape = inferTileGridShape(tileData)
  if (!shape) {
    return null
  }

  const { rows, columns } = shape
  const bounds = tileData.header.bounds
  const spanX = Math.max(Number.EPSILON, bounds.maxX - bounds.minX)
  const spanZ = Math.max(Number.EPSILON, bounds.maxZ - bounds.minZ)
  const ratioX = Math.min(1, Math.max(0, (x - bounds.minX) / spanX))
  const ratioZ = Math.min(1, Math.max(0, (z - bounds.minZ) / spanZ))
  const localColumn = ratioX * columns
  const localRow = ratioZ * rows
  const column0 = Math.max(0, Math.min(columns, Math.floor(localColumn)))
  const row0 = Math.max(0, Math.min(rows, Math.floor(localRow)))
  const column1 = Math.min(columns, column0 + 1)
  const row1 = Math.min(rows, row0 + 1)
  const tx = Math.min(1, Math.max(0, localColumn - column0))
  const tz = Math.min(1, Math.max(0, localRow - row0))

  const index = (row: number, column: number) => row * (columns + 1) + column
  const h00 = dequantizeTerrainHeight(tileData.height[index(row0, column0)] ?? 0, tileData.header.minHeight, tileData.header.maxHeight)
  const h10 = dequantizeTerrainHeight(tileData.height[index(row0, column1)] ?? 0, tileData.header.minHeight, tileData.header.maxHeight)
  const h01 = dequantizeTerrainHeight(tileData.height[index(row1, column0)] ?? 0, tileData.header.minHeight, tileData.header.maxHeight)
  const h11 = dequantizeTerrainHeight(tileData.height[index(row1, column1)] ?? 0, tileData.header.minHeight, tileData.header.maxHeight)
  const hx0 = h00 + (h10 - h00) * tx
  const hx1 = h01 + (h11 - h01) * tx
  return hx0 + (hx1 - hx0) * tz
}

export function createTerrainDatasetHeightSamplerFromScenePackage(
  pkg: ScenePackageUnzipped,
  sceneEntry: Pick<ScenePackageSceneEntry, 'terrain'>,
): GroundTerrainHeightSampler | null {
  const manifest = readTerrainDatasetManifestFromScenePackage(pkg, sceneEntry)
  if (!manifest) {
    return null
  }

  const tileCache = new Map<string, QuantizedTerrainMeshData | null>()
  const packCache = new Map<string, ReturnType<typeof deserializeQuantizedTerrainPack> | null>()
  const levelScale = 2 ** Math.max(0, Math.trunc(manifest.maxLevel))
  const bounds = manifest.bounds
  const spanX = Math.max(Number.EPSILON, bounds.maxX - bounds.minX)
  const spanZ = Math.max(Number.EPSILON, bounds.maxZ - bounds.minZ)
  const regionByKey = new Map<string, (typeof manifest.regions)[number]>()
  for (const region of manifest.regions) {
    regionByKey.set(region.regionKey, region)
  }

  const loadRegionPack = (regionKey: string): ReturnType<typeof deserializeQuantizedTerrainPack> | null => {
    if (packCache.has(regionKey)) {
      return packCache.get(regionKey) ?? null
    }
    const region = regionByKey.get(regionKey) ?? null
    if (!region) {
      packCache.set(regionKey, null)
      return null
    }
    const packBuffer = readTerrainDatasetRegionPackFromScenePackage(pkg, manifest, regionKey)
    if (!packBuffer) {
      packCache.set(regionKey, null)
      return null
    }
    const pack = deserializeQuantizedTerrainPack(packBuffer)
    packCache.set(regionKey, pack)
    return pack
  }

  const loadTile = (tileKey: string): QuantizedTerrainMeshData | null => {
    if (tileCache.has(tileKey)) {
      return tileCache.get(tileKey) ?? null
    }
    const tileId = parseQuantizedTerrainTileKey(tileKey)
    if (!tileId) {
      tileCache.set(tileKey, null)
      return null
    }
    const regionId = resolveQuantizedTerrainRegionIdForTile(tileId, manifest.regionLevel)
    const regionKey = `r/${regionId.level}/${regionId.x}/${regionId.y}`
    const pack = loadRegionPack(regionKey)
    if (!pack) {
      tileCache.set(tileKey, null)
      return null
    }
    const buffer = readQuantizedTerrainPackEntry(pack, tileKey)
    if (!buffer) {
      tileCache.set(tileKey, null)
      return null
    }
    const decoded = deserializeQuantizedTerrainMesh(buffer)
    tileCache.set(tileKey, decoded)
    return decoded
  }

  return {
    sampleHeightAtWorld(x: number, z: number): number | null {
      if (!Number.isFinite(x) || !Number.isFinite(z)) {
        return null
      }
      if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) {
        return null
      }

      const tileX = Math.min(levelScale - 1, Math.max(0, Math.floor(((x - bounds.minX) / spanX) * levelScale)))
      const tileY = Math.min(levelScale - 1, Math.max(0, Math.floor(((z - bounds.minZ) / spanZ) * levelScale)))

      for (let level = manifest.maxLevel; level >= manifest.rootLevel; level -= 1) {
        const shift = Math.max(0, manifest.maxLevel - level)
        const parentX = Math.floor(tileX / (2 ** shift))
        const parentY = Math.floor(tileY / (2 ** shift))
        const tileKey = formatQuantizedTerrainTileKey(level, parentX, parentY)
        const tileData = loadTile(tileKey)
        if (!tileData) {
          continue
        }
        const sampled = sampleQuantizedTerrainMeshHeight(tileData, x, z)
        if (Number.isFinite(sampled)) {
          return sampled as number
        }
      }

      return null
    },
  }
}
