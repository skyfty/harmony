import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { GroundSculptOperation } from '@harmony/schema'
import type { TerrainScatterCategory } from '@harmony/schema/terrain-scatter'
import type { ProjectAsset } from '@/types/project-asset'
import { terrainScatterPresets } from '@/resources/projectProviders/asset'
import { SCATTER_BRUSH_RADIUS_MAX } from '@/constants/terrainScatter'

export type GroundPanelTab = 'terrain' | TerrainScatterCategory

export const useTerrainStore = defineStore('terrain', () => {
  const brushRadius = ref(3)
  const brushStrength = ref(1.5)
  const brushShape = ref<'circle' | 'square' | 'star'>('circle')
  const brushOperation = ref<GroundSculptOperation | null>(null)
  const groundPanelTab = ref<GroundPanelTab>('terrain')
  const scatterCategory = ref<TerrainScatterCategory>('flora')
  const scatterSelectedAsset = ref<ProjectAsset | null>(null)
  const scatterProviderAssetId = ref<string | null>(null)
  // Scatter placement brush radius (visual only). Kept independent from terrain sculpt brush and erase radius.
  const scatterBrushRadius = ref(0.5)
  const scatterEraseRadius = ref(1)
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

  function setBrushOperation(operation: GroundSculptOperation | null) {
    brushOperation.value = operation
  }

  function setScatterSelection(payload: { asset: ProjectAsset | null; providerAssetId?: string | null }) {
    scatterSelectedAsset.value = payload.asset
    scatterProviderAssetId.value = payload.providerAssetId ?? null
  }

  function setScatterBrushRadius(value: number) {
    scatterBrushRadius.value = Math.min(SCATTER_BRUSH_RADIUS_MAX, Math.max(0.1, value))
  }

  function setScatterEraseRadius(value: number) {
    scatterEraseRadius.value = Math.min(SCATTER_BRUSH_RADIUS_MAX, Math.max(0.1, value))
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
    scatterBrushRadius,
    scatterEraseRadius,
    setBrushOperation,
    setGroundPanelTab,
    setScatterCategory,
    setScatterSelection,
    setScatterBrushRadius,
    setScatterEraseRadius,
  }
})
