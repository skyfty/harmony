import {
  deserializeQuantizedTerrainPack,
  readQuantizedTerrainPackEntry,
  type QuantizedTerrainDatasetRegionPackIndex,
  type QuantizedTerrainDatasetRootManifest,
} from '@schema'
import { useScenesStore } from '@/stores/scenesStore'

export type TerrainDatasetTileSource = {
  manifest: QuantizedTerrainDatasetRootManifest
  region: QuantizedTerrainDatasetRegionPackIndex
  tileBuffer: ArrayBuffer
}

export interface TerrainDatasetProvider {
  loadManifest(sceneId: string): Promise<QuantizedTerrainDatasetRootManifest | null>
  loadRegionPack(sceneId: string, regionKey: string): Promise<ArrayBuffer | null>
  loadTile(sceneId: string, tileKey: string): Promise<TerrainDatasetTileSource | null>
}

export function createScenesStoreTerrainDatasetProvider(): TerrainDatasetProvider {
  const scenesStore = useScenesStore()
  return {
    async loadManifest(sceneId: string): Promise<QuantizedTerrainDatasetRootManifest | null> {
      return await scenesStore.loadTerrainDatasetManifest(sceneId)
    },
    async loadRegionPack(sceneId: string, regionKey: string): Promise<ArrayBuffer | null> {
      return await scenesStore.loadTerrainDatasetRegionPack(sceneId, regionKey)
    },
    async loadTile(sceneId: string, tileKey: string): Promise<TerrainDatasetTileSource | null> {
      const manifest = await scenesStore.loadTerrainDatasetManifest(sceneId)
      if (!manifest) {
        return null
      }
      for (const region of manifest.regions) {
        const regionPackBuffer = await scenesStore.loadTerrainDatasetRegionPack(sceneId, region.regionKey)
        const regionPack = deserializeQuantizedTerrainPack(regionPackBuffer)
        if (!regionPack) {
          continue
        }
        const tileBuffer = readQuantizedTerrainPackEntry(regionPack, tileKey)
        if (!tileBuffer) {
          continue
        }
        return {
          manifest,
          region,
          tileBuffer,
        }
      }
      return null
    },
  }
}
