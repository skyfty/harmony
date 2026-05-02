import {
  dequantizeTerrainHeight,
  deserializeQuantizedTerrainMesh,
  deserializeQuantizedTerrainPack,
  formatQuantizedTerrainTileKey,
  type GroundTerrainHeightSampler,
  type QuantizedTerrainDatasetRootManifest,
  type QuantizedTerrainMeshData,
} from '@schema'
import { useScenesStore } from '@/stores/scenesStore'

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

export async function createScenesStoreTerrainDatasetHeightSampler(sceneId: string): Promise<GroundTerrainHeightSampler | null> {
  const normalizedSceneId = typeof sceneId === 'string' ? sceneId.trim() : ''
  if (!normalizedSceneId) {
    return null
  }

  const scenesStore = useScenesStore()
  const manifest = await scenesStore.loadTerrainDatasetManifest(normalizedSceneId)
  if (!manifest) {
    return null
  }

  const regionByKey = new Map<string, QuantizedTerrainDatasetRootManifest['regions'][number]>()
  manifest.regions.forEach((region) => {
    regionByKey.set(region.regionKey, region)
  })

  const packCache = new Map<string, ReturnType<typeof deserializeQuantizedTerrainPack> | null>()
  const tileCache = new Map<string, QuantizedTerrainMeshData | null>()
  const loadRegionPack = async (regionKey: string) => {
    if (packCache.has(regionKey)) {
      return packCache.get(regionKey) ?? null
    }
    const region = regionByKey.get(regionKey) ?? null
    if (!region) {
      packCache.set(regionKey, null)
      return null
    }
    const packBuffer = await scenesStore.loadTerrainDatasetRegionPack(normalizedSceneId, region.regionKey)
    if (!packBuffer) {
      packCache.set(regionKey, null)
      return null
    }
    const pack = deserializeQuantizedTerrainPack(packBuffer)
    packCache.set(regionKey, pack)
    return pack
  }

  for (const region of manifest.regions) {
    const pack = await loadRegionPack(region.regionKey)
    if (!pack) {
      continue
    }
    for (const [tileKey, buffer] of Object.entries(pack.entries)) {
      if (tileCache.has(tileKey)) {
        continue
      }
      tileCache.set(tileKey, deserializeQuantizedTerrainMesh(buffer))
    }
  }

  const bounds = manifest.bounds
  const spanX = Math.max(Number.EPSILON, bounds.maxX - bounds.minX)
  const spanZ = Math.max(Number.EPSILON, bounds.maxZ - bounds.minZ)
  const levelScale = 2 ** Math.max(0, Math.trunc(manifest.maxLevel))

  return {
    sampleHeightAtWorld: (x: number, z: number): number | null => {
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
        const tileData = tileCache.get(tileKey) ?? null
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