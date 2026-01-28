import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useUiStore } from './uiStore'
import type { GroundSculptOperation } from '@harmony/schema'
import type { TerrainScatterCategory } from '@harmony/schema/terrain-scatter'
import type { ProjectAsset } from '@/types/project-asset'
import { terrainScatterPresets } from '@/resources/projectProviders/asset'

export type GroundPanelTab = 'terrain' | 'paint' | TerrainScatterCategory
export const SCATTER_BRUSH_RADIUS_MAX = 20 as const

export const useTerrainStore = defineStore('terrain', () => {
  const brushRadius = ref(3)
  const brushStrength = ref(1.5)
  const brushShape = ref<'circle' | 'square' | 'star'>('circle')
  const brushOperation = ref<GroundSculptOperation | null>(null)
  const groundPanelTab = ref<GroundPanelTab>('terrain')

  // Terrain paint (ground material painting) state.
  const paintSelectedAsset = ref<ProjectAsset | null>(null)
  // 0..1 - maps to neighbor-average smoothing strength/iterations.
  const paintSmoothness = ref(0.25)

  const scatterCategory = ref<TerrainScatterCategory>('flora')
  const scatterSelectedAsset = ref<ProjectAsset | null>(null)
  const scatterProviderAssetId = ref<string | null>(null)
  // Scatter placement brush radius (visual only). Kept independent from terrain sculpt brush and erase radius.
  const scatterBrushRadius = ref(0.5)
  const scatterEraseRadius = ref(1)
  // Scatter density (0-100). Used to scale instance count linearly.
  // Default 60 roughly matches the previous packing factor behavior.
  const scatterDensityPercent = ref(60)
  const isDigging = computed(() => brushOperation.value === 'depress')
  const scatterPreset = computed(() => terrainScatterPresets[scatterCategory.value])
  const scatterModeActive = computed(() =>
    groundPanelTab.value !== 'terrain' && groundPanelTab.value !== 'paint' && !!scatterSelectedAsset.value,
  )
  const paintModeActive = computed(() => groundPanelTab.value === 'paint' && !!paintSelectedAsset.value)

  function setGroundPanelTab(tab: GroundPanelTab) {
    groundPanelTab.value = tab
    if (tab !== 'terrain' && tab !== 'paint') {
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

  function setPaintSelection(asset: ProjectAsset | null) {
    paintSelectedAsset.value = asset
  }

  function setPaintSmoothness(value: number) {
    const num = Number(value)
    paintSmoothness.value = Number.isFinite(num) ? Math.min(1, Math.max(0, num)) : 0.25
  }

  // Keep UI activeSelectionContext in sync: when the user activates terrain sculpt
  // or selects a scatter asset, set the global UI context so other modules can
  // clear themselves. We avoid importing/clearing other stores here to prevent
  // circular dependencies — other stores/components should watch `ui.activeSelectionContext`.
  watch(brushOperation, (next) => {
    const ui = useUiStore()
    if (next) {
      ui.setActiveSelectionContext('terrain-sculpt')
    } else if (ui.activeSelectionContext === 'terrain-sculpt') {
      ui.setActiveSelectionContext(null)
    }
  })

  watch(scatterSelectedAsset, (next) => {
    const ui = useUiStore()
    if (next) {
      ui.setActiveSelectionContext('scatter')
    } else if (ui.activeSelectionContext === 'scatter') {
      ui.setActiveSelectionContext(null)
    }
  })

  watch(paintSelectedAsset, (next) => {
    const ui = useUiStore()
    if (next) {
      ui.setActiveSelectionContext('terrain-paint')
    } else if (ui.activeSelectionContext === 'terrain-paint') {
      ui.setActiveSelectionContext(null)
    }
  })

  function setScatterBrushRadius(value: number) {
    scatterBrushRadius.value = Math.min(SCATTER_BRUSH_RADIUS_MAX, Math.max(0.1, value))
  }

  function setScatterEraseRadius(value: number) {
    scatterEraseRadius.value = Math.min(SCATTER_BRUSH_RADIUS_MAX, Math.max(0.1, value))
  }

  function setScatterDensityPercent(value: number) {
    const num = Number(value)
    const clamped = Number.isFinite(num) ? Math.min(100, Math.max(0, Math.round(num))) : 60
    scatterDensityPercent.value = clamped
  }
  
  return {
    brushRadius,
    brushStrength,
    brushShape,
    brushOperation,
    isDigging,
    groundPanelTab,

    paintSelectedAsset,
    paintSmoothness,
    paintModeActive,

    scatterCategory,
    scatterSelectedAsset,
    scatterProviderAssetId,
    scatterPreset,
    scatterModeActive,
    scatterBrushRadius,
    scatterEraseRadius,
    scatterDensityPercent,
    setBrushOperation,
    setGroundPanelTab,
    setScatterCategory,
    setScatterSelection,
    setPaintSelection,
    setPaintSmoothness,
    setScatterBrushRadius,
    setScatterEraseRadius,
    setScatterDensityPercent,
  }
})
