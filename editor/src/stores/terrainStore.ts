import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { GroundSculptOperation } from '@harmony/schema'
import type { TerrainScatterCategory } from '@harmony/schema/terrain-scatter'
import type { ProjectAsset } from '@/types/project-asset'
import { terrainScatterPresets } from '@/resources/projectProviders/asset'

export type GroundPanelTab = 'terrain' | TerrainScatterCategory

export const useTerrainStore = defineStore('terrain', () => {
  const brushRadius = ref(3)
  const brushStrength = ref(1.5)
  const brushShape = ref<'circle' | 'square' | 'star'>('circle')
  const brushOperation = ref<GroundSculptOperation>('raise')
  const groundPanelTab = ref<GroundPanelTab>('terrain')
  const scatterCategory = ref<TerrainScatterCategory>('flora')
  const scatterSelectedAsset = ref<ProjectAsset | null>(null)
  const scatterProviderAssetId = ref<string | null>(null)
  const isDigging = computed(() => brushOperation.value === 'depress')
  const scatterPreset = computed(() => terrainScatterPresets[scatterCategory.value])
  const scatterModeActive = computed(() => groundPanelTab.value !== 'terrain' && !!scatterSelectedAsset.value)

  function setGroundPanelTab(tab: GroundPanelTab) {
    groundPanelTab.value = tab
    if (tab !== 'terrain') {
      scatterCategory.value = tab
    }
  }

  function setScatterCategory(category: TerrainScatterCategory) {
    scatterCategory.value = category
    groundPanelTab.value = category
  }

  function setScatterSelection(payload: { asset: ProjectAsset | null; providerAssetId?: string | null }) {
    scatterSelectedAsset.value = payload.asset
    scatterProviderAssetId.value = payload.providerAssetId ?? null
  }
  
  return {
    brushRadius,
    brushStrength,
    brushShape,
    brushOperation,
    isDigging,
    groundPanelTab,
    scatterCategory,
    scatterSelectedAsset,
    scatterProviderAssetId,
    scatterPreset,
    scatterModeActive,
    setGroundPanelTab,
    setScatterCategory,
    setScatterSelection,
  }
})
