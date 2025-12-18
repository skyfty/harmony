import { ref } from 'vue'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'
import { useTerrainStore } from '@/stores/terrainStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { assetProvider } from '@/resources/projectProviders/asset'

interface UseScatterAssetSelectionOptions {
  updateTerrainSelection?: boolean
  onSelected?: (asset: ProjectAsset, providerAssetId: string) => void
}

export function useScatterAssetSelection(options?: UseScatterAssetSelectionOptions) {
  const sceneStore = useSceneStore()
  const terrainStore = useTerrainStore()
  const assetCacheStore = useAssetCacheStore()
  const selectingAssetId = ref<string | null>(null)

  async function ensureAssetCached(asset: ProjectAsset) {
    if (assetCacheStore.hasCache(asset.id)) {
      return
    }
    await assetCacheStore.downloaProjectAsset(asset)
  }

  async function selectScatterAsset(sourceAsset: ProjectAsset): Promise<ProjectAsset | null> {
    if (selectingAssetId.value) {
      return null
    }
    selectingAssetId.value = sourceAsset.id
    try {
      const registered = sceneStore.copyPackageAssetToAssets(assetProvider.id, sourceAsset)
      await ensureAssetCached(registered)
      if (options?.updateTerrainSelection !== false) {
        terrainStore.setScatterSelection({ asset: registered, providerAssetId: sourceAsset.id })
      }
      options?.onSelected?.(registered, sourceAsset.id)
      return registered
    } catch (error) {
      console.warn('Failed to prepare scatter asset', error)
      return null
    } finally {
      selectingAssetId.value = null
    }
  }

  return { selectingAssetId, selectScatterAsset }
}
