import { ref } from 'vue'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'
import { useTerrainStore } from '@/stores/terrainStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { assetProvider, terrainScatterPresets, type ScatterAssetOption } from '@/resources/projectProviders/asset'

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

  function computeHorizontalBoundingCircleDiameter(bounds: { min: { x: number; z: number }; max: { x: number; z: number } }): number | null {
    const maxAbsX = Math.max(Math.abs(Number(bounds.min.x)), Math.abs(Number(bounds.max.x)))
    const maxAbsZ = Math.max(Math.abs(Number(bounds.min.z)), Math.abs(Number(bounds.max.z)))
    if (!Number.isFinite(maxAbsX) || !Number.isFinite(maxAbsZ)) {
      return null
    }
    const radius = Math.sqrt(maxAbsX * maxAbsX + maxAbsZ * maxAbsZ)
    if (!Number.isFinite(radius) || radius <= 0) {
      return null
    }
    return radius * 2
  }

  function resolveScatterMaxScale(): number {
    const category = terrainStore.scatterCategory
    const preset = terrainScatterPresets[category]
    const maxScale = Number(preset?.maxScale)
    if (!Number.isFinite(maxScale) || maxScale <= 0) {
      return 1
    }
    return maxScale
  }

  async function applyAutoScatterSpacing(asset: ProjectAsset): Promise<void> {
    if (!asset?.id) {
      return
    }

    try {
      const bounds = await sceneStore.measureModelAssetBoundingBox(asset.id)
      if (!bounds || bounds.isEmpty()) {
        return
      }

      const diameter = computeHorizontalBoundingCircleDiameter(bounds)
      if (diameter == null) {
        return
      }

      const recommendedSpacing = diameter * resolveScatterMaxScale()
      if (!Number.isFinite(recommendedSpacing) || recommendedSpacing <= 0) {
        return
      }

      terrainStore.setScatterSpacing(recommendedSpacing)
    } catch (error) {
      console.warn('Failed to auto-resolve scatter spacing from asset size', asset.id, error)
    }
  }

  async function selectScatterAsset(source: ScatterAssetOption): Promise<ProjectAsset | null> {
    if (selectingAssetId.value) {
      return null
    }
    selectingAssetId.value = source.providerAssetId
    try {
      let selectedAsset: ProjectAsset

      if (source.source === 'scene') {
        await ensureAssetCached(source.asset)
        selectedAsset = source.asset
      } else {
        const registered = sceneStore.ensureSceneAssetRegistered(source.asset, {
          providerId: assetProvider.id,
        })
        await ensureAssetCached(registered)
        selectedAsset = registered
      }

      if (options?.updateTerrainSelection !== false) {
        terrainStore.setScatterSelection({ asset: selectedAsset, providerAssetId: source.providerAssetId })
      }

      await applyAutoScatterSpacing(selectedAsset)
      options?.onSelected?.(selectedAsset, source.providerAssetId)
      return selectedAsset
    } catch (error) {
      console.warn('Failed to prepare scatter asset', error)
      return null
    } finally {
      selectingAssetId.value = null
    }
  }

  return { selectingAssetId, selectScatterAsset }
}
