import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useUiStore } from './uiStore'
import {
  TERRAIN_PAINT_MAX_LAYER_COUNT,
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

export type TerrainPaintBrushSettings = TerrainPaintLayerStyle & {
  feather: number
}

export type TerrainPaintLayerDraft = {
  id: string
  /** Legacy bridge for V2 paint runtime. */
  slotIndex: number
  zIndex: number
  enabled: boolean
  assetId: string | null
  asset: ProjectAsset | null
  settings: TerrainPaintBrushSettings
}

function clampTerrainPaintBrushSettings(value: Partial<TerrainPaintBrushSettings> | null | undefined): TerrainPaintBrushSettings {
  const style = clampTerrainPaintLayerStyle(value)
  const featherValue = typeof value?.feather === 'number' ? value.feather : Number(value?.feather)
  return {
    ...style,
    feather: Number.isFinite(featherValue) ? Math.min(1, Math.max(0, featherValue)) : 0,
  }
}

function createDefaultTerrainPaintBrushSettings(): TerrainPaintBrushSettings {
  return clampTerrainPaintBrushSettings(null)
}

function createTerrainPaintLayerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `terrain-paint-layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function createTerrainPaintLayerDraft(slotIndex: number, overrides: Partial<TerrainPaintLayerDraft> = {}): TerrainPaintLayerDraft {
  const normalizedZIndex = Number.isFinite(overrides.zIndex)
    ? Math.max(0, Math.trunc(overrides.zIndex))
    : Math.max(0, Math.trunc(slotIndex))
  return {
    id: typeof overrides.id === 'string' && overrides.id.trim().length ? overrides.id.trim() : createTerrainPaintLayerId(),
    slotIndex: Number.isFinite(overrides.slotIndex)
      ? Math.max(0, Math.trunc(overrides.slotIndex))
      : normalizedZIndex,
    zIndex: normalizedZIndex,
    enabled: typeof overrides.enabled === 'boolean' ? overrides.enabled : true,
    assetId: typeof overrides.assetId === 'string' && overrides.assetId.trim().length ? overrides.assetId.trim() : (overrides.asset?.id ?? null),
    asset: overrides.asset ?? null,
    settings: clampTerrainPaintBrushSettings(overrides.settings ?? null),
  }
}

function normalizeTerrainPaintLayers(layers: TerrainPaintLayerDraft[]): TerrainPaintLayerDraft[] {
  return layers
    .map((layer, index) => createTerrainPaintLayerDraft(Number.isFinite(layer.zIndex) ? layer.zIndex : (Number.isFinite(layer.slotIndex) ? layer.slotIndex : index), layer))
    .sort((left, right) => left.zIndex - right.zIndex)
    .slice(0, TERRAIN_PAINT_MAX_LAYER_COUNT)
}

export const useTerrainStore = defineStore('terrain', () => {
  const brushRadius = ref(3)
  const brushStrength = ref(1.5)
  const brushShape = ref<'circle' | 'square' | 'star'>('circle')
  const brushOperation = ref<GroundSculptOperation | null>(null)
  const groundPanelTab = ref<GroundPanelTab>('terrain')

  // Terrain paint (ground material painting) state.
  // 0..1 - maps to neighbor-average smoothing strength/iterations.
  const paintSmoothness = ref(0.25)
  const defaultPaintBrushSettings = ref<TerrainPaintBrushSettings>(createDefaultTerrainPaintBrushSettings())
  const paintLayers = ref<TerrainPaintLayerDraft[]>([])
  const paintSelectedLayerId = ref<string | null>(null)
  const selectedPaintLayer = computed(() => {
    const selectedId = paintSelectedLayerId.value
    if (selectedId) {
      const match = paintLayers.value.find((layer) => layer.id === selectedId) ?? null
      if (match) {
        return match
      }
    }
    return paintLayers.value[0] ?? null
  })
  const paintSelectedAsset = computed<ProjectAsset | null>(() => selectedPaintLayer.value?.asset ?? null)
  const paintBrushSettings = computed<TerrainPaintBrushSettings>(() => selectedPaintLayer.value?.settings ?? defaultPaintBrushSettings.value)

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
  const paintModeActive = computed(() => groundPanelTab.value === 'paint' && !!paintSelectedLayerId.value && !!paintSelectedAsset.value)
  const lastPaintIntentAtMs = ref(0)
  let paintContextSyncTimer: ReturnType<typeof setTimeout> | null = null

  function markPaintContextIntent() {
    lastPaintIntentAtMs.value = Date.now()
  }

  function hasRecentPaintContextIntent(): boolean {
    return Date.now() - lastPaintIntentAtMs.value <= PAINT_CONTEXT_INTENT_TTL_MS
  }

  function clearPaintContextSyncTimer() {
    if (paintContextSyncTimer !== null) {
      window.clearTimeout(paintContextSyncTimer)
      paintContextSyncTimer = null
    }
  }

  onScopeDispose(() => {
    clearPaintContextSyncTimer()
  })

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

  function setPaintSelectedLayerId(layerId: string | null) {
    const normalized = typeof layerId === 'string' ? layerId.trim() : ''
    paintSelectedLayerId.value = normalized || (paintLayers.value[0]?.id ?? null)
    if (paintSelectedLayerId.value) {
      markPaintContextIntent()
    }
  }

  function replacePaintLayers(layers: TerrainPaintLayerDraft[]) {
    const normalized = normalizeTerrainPaintLayers(layers)
    paintLayers.value = normalized
    const stillSelected = normalized.some((layer) => layer.id === paintSelectedLayerId.value)
    paintSelectedLayerId.value = stillSelected ? paintSelectedLayerId.value : (normalized[0]?.id ?? null)
  }

  function addPaintLayer(overrides: Partial<TerrainPaintLayerDraft> = {}): TerrainPaintLayerDraft | null {
    if (paintLayers.value.length >= TERRAIN_PAINT_MAX_LAYER_COUNT) {
      return null
    }
    const nextZIndex = paintLayers.value.reduce((maxZIndex, layer) => Math.max(maxZIndex, layer.zIndex), -1) + 1
    if (nextZIndex >= TERRAIN_PAINT_MAX_LAYER_COUNT) {
      return null
    }
    const layer = createTerrainPaintLayerDraft(nextZIndex, {
      settings: defaultPaintBrushSettings.value,
      ...overrides,
    })
    replacePaintLayers([...paintLayers.value, layer])
    paintSelectedLayerId.value = layer.id
    return layer
  }

  function updatePaintLayer(layerId: string, patch: Partial<Omit<TerrainPaintLayerDraft, 'slotIndex'>>) {
    const normalizedId = typeof layerId === 'string' ? layerId.trim() : ''
    if (!normalizedId) {
      return
    }
    replacePaintLayers(
      paintLayers.value.map((layer) => {
        if (layer.id !== normalizedId) {
          return layer
        }
        return createTerrainPaintLayerDraft(layer.slotIndex, {
          ...layer,
          ...patch,
          assetId: patch.assetId === undefined ? layer.assetId : patch.assetId,
          settings: patch.settings ? clampTerrainPaintBrushSettings(patch.settings) : layer.settings,
        })
      }),
    )
  }

  function setPaintSelection(asset: ProjectAsset | null) {
    const activeLayer = selectedPaintLayer.value ?? addPaintLayer()
    if (!activeLayer) {
      return
    }
    if (asset) {
      markPaintContextIntent()
    }
    updatePaintLayer(activeLayer.id, { asset, assetId: asset?.id ?? null })
    paintSelectedLayerId.value = activeLayer.id
  }

  function setPaintSmoothness(value: number) {
    const num = Number(value)
    paintSmoothness.value = Number.isFinite(num) ? Math.min(1, Math.max(0, num)) : 0.25
  }

  function setPaintBrushSettings(value: Partial<TerrainPaintBrushSettings> | TerrainPaintBrushSettings) {
    const nextSettings = clampTerrainPaintBrushSettings({
      ...(selectedPaintLayer.value?.settings ?? defaultPaintBrushSettings.value),
      ...value,
    })
    if (selectedPaintLayer.value) {
      updatePaintLayer(selectedPaintLayer.value.id, { settings: nextSettings })
      return
    }
    defaultPaintBrushSettings.value = nextSettings
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

  watch([paintSelectedAsset, groundPanelTab], ([nextAsset, tab]: [ProjectAsset | null, GroundPanelTab]) => {
    clearPaintContextSyncTimer()
    paintContextSyncTimer = window.setTimeout(() => {
      const ui = useUiStore()
      const shouldActivatePaintContext = tab === 'paint'
        && !!nextAsset
        && (hasRecentPaintContextIntent() || ui.activeSelectionContext === 'terrain-paint')

      if (shouldActivatePaintContext) {
        ui.setActiveSelectionContext('terrain-paint')
        return
      }

      if (ui.activeSelectionContext === 'terrain-paint' && (tab !== 'paint' || !nextAsset)) {
        ui.setActiveSelectionContext(null)
      }
    }, PAINT_CONTEXT_SYNC_DEBOUNCE_MS)
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

    paintLayers,
    paintSelectedLayerId,
    paintSelectedAsset,
    paintSmoothness,
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
    setPaintSelectedLayerId,
    replacePaintLayers,
    addPaintLayer,
    updatePaintLayer,
    setPaintSelection,
    setPaintSmoothness,
    setPaintBrushSettings,
    setScatterBrushRadius,
    setScatterBrushShape,
    setScatterSpacing,
    setScatterEraseRadius,
    setScatterDensityPercent,
  }
})
