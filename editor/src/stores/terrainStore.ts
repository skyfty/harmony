import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useUiStore } from './uiStore'
import {
  clampTerrainPaintLayerStyle,
  type GroundSculptOperation,
  type TerrainPaintLayerStyle,
} from '@schema'
import type { TerrainScatterBrushShape, TerrainScatterCategory } from '@schema/terrain-scatter'
import type { ProjectAsset } from '@/types/project-asset'
import { terrainScatterPresets } from '@/resources/projectProviders/asset'

export type GroundPanelTab = 'terrain' | 'paint' | TerrainScatterCategory
export const SCATTER_BRUSH_RADIUS_MAX = 20 as const
export const SCATTER_SPACING_MAX = 20 as const
const PAINT_CONTEXT_INTENT_TTL_MS = 1800 as const
const PAINT_CONTEXT_SYNC_DEBOUNCE_MS = 80 as const
const TERRAIN_PAINT_DEFAULT_FEATHER = 0.6 as const

export type TerrainPaintBrushSettings = TerrainPaintLayerStyle & {
  feather: number
}

function clampTerrainPaintBrushSettings(value: Partial<TerrainPaintBrushSettings> | null | undefined): TerrainPaintBrushSettings {
  const style = clampTerrainPaintLayerStyle(value)
  const featherValue = typeof value?.feather === 'number' ? value.feather : Number(value?.feather)
  return {
    ...style,
    feather: Number.isFinite(featherValue) ? Math.min(1, Math.max(0, featherValue)) : TERRAIN_PAINT_DEFAULT_FEATHER,
  }
}

function createDefaultTerrainPaintBrushSettings(): TerrainPaintBrushSettings {
  return clampTerrainPaintBrushSettings(null)
}

export const useTerrainStore = defineStore('terrain', () => {
  const paintContextIntentAtMs = ref(0)
  let paintContextSyncTimer: number | null = null

  function clearPaintContextSyncTimer() {
    if (paintContextSyncTimer !== null) {
      window.clearTimeout(paintContextSyncTimer)
      paintContextSyncTimer = null
    }
  }

  function markPaintContextIntent() {
    paintContextIntentAtMs.value = Date.now()
  }

  function hasRecentPaintContextIntent() {
    return Date.now() - paintContextIntentAtMs.value <= PAINT_CONTEXT_INTENT_TTL_MS
  }

  const brushRadius = ref(3)
  const brushStrength = ref(1.5)
  const brushShape = ref<'circle' | 'square' | 'star'>('circle')
  const brushOperation = ref<GroundSculptOperation | null>(null)
  const groundPanelTab = ref<GroundPanelTab>('terrain')

  // Terrain paint (ground material painting) state.
  const paintSelectedAsset = ref<ProjectAsset | null>(null)
  const paintBrushSettings = ref<TerrainPaintBrushSettings>(createDefaultTerrainPaintBrushSettings())

  const scatterCategory = ref<TerrainScatterCategory>('flora')
  const scatterSelectedAsset = ref<ProjectAsset | null>(null)
  const scatterProviderAssetId = ref<string | null>(null)
  // Scatter placement brush radius (visual only). Kept independent from terrain sculpt brush and erase radius.
  const scatterBrushRadius = ref(0.5)
  const scatterBrushShape = ref<TerrainScatterBrushShape>('circle')
  const scatterSpacing = ref(1)
  const scatterEraseRadius = ref(1)
  // Scatter density (0-100). Used to scale instance count linearly.
  // Default 60 roughly matches the previous packing factor behavior.
  const scatterDensityPercent = ref(60)
  const isDigging = computed(() => brushOperation.value === 'depress')
  const scatterPreset = computed(() => terrainScatterPresets[scatterCategory.value])
  const scatterModeActive = computed(() =>
    groundPanelTab.value !== 'terrain' && groundPanelTab.value !== 'paint' && !!scatterSelectedAsset.value,
  )
  const paintModeActive = computed(() => groundPanelTab.value === 'paint')

  function setGroundPanelTab(tab: GroundPanelTab) {
    groundPanelTab.value = tab
    if (tab === 'paint') {
      markPaintContextIntent()
    }
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
    if (asset) {
      markPaintContextIntent()
    }
  }

  function setPaintBrushSettings(value: Partial<TerrainPaintBrushSettings> | TerrainPaintBrushSettings) {
    paintBrushSettings.value = clampTerrainPaintBrushSettings({
      ...paintBrushSettings.value,
      ...value,
    })
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

  watch([paintSelectedAsset, groundPanelTab], ([, tab]: [ProjectAsset | null, GroundPanelTab]) => {
    clearPaintContextSyncTimer()
    paintContextSyncTimer = window.setTimeout(() => {
      const ui = useUiStore()
      const shouldActivatePaintContext = tab === 'paint'
        && (hasRecentPaintContextIntent() || ui.activeSelectionContext === 'terrain-paint')

      if (shouldActivatePaintContext) {
        ui.setActiveSelectionContext('terrain-paint')
        return
      }

      if (ui.activeSelectionContext === 'terrain-paint' && tab !== 'paint') {
        ui.setActiveSelectionContext(null)
      }
    }, PAINT_CONTEXT_SYNC_DEBOUNCE_MS)
  })

  onScopeDispose(() => {
    clearPaintContextSyncTimer()
  })

  function setScatterBrushRadius(value: number) {
    scatterBrushRadius.value = Math.min(SCATTER_BRUSH_RADIUS_MAX, Math.max(0.1, value))
  }

  function setScatterBrushShape(value: TerrainScatterBrushShape) {
    scatterBrushShape.value = value === 'rectangle' || value === 'line' ? value : 'circle'
  }

  function setScatterSpacing(value: number) {
    const num = Number(value)
    scatterSpacing.value = Number.isFinite(num) ? Math.min(SCATTER_SPACING_MAX, Math.max(0.1, num)) : 1
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
    paintBrushSettings,
    paintModeActive,

    scatterCategory,
    scatterSelectedAsset,
    scatterProviderAssetId,
    scatterPreset,
    scatterModeActive,
    scatterBrushRadius,
    scatterBrushShape,
    scatterSpacing,
    scatterEraseRadius,
    scatterDensityPercent,
    setBrushOperation,
    setGroundPanelTab,
    setScatterCategory,
    setScatterSelection,
    setPaintSelection,
    setPaintBrushSettings,
    setScatterBrushRadius,
    setScatterBrushShape,
    setScatterSpacing,
    setScatterEraseRadius,
    setScatterDensityPercent,
  }
})
