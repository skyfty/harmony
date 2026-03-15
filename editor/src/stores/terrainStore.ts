import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
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
  const normalizedZIndex = typeof overrides.zIndex === 'number' && Number.isFinite(overrides.zIndex)
    ? Math.max(0, Math.trunc(overrides.zIndex))
    : Math.max(0, Math.trunc(slotIndex))
  return {
    id: typeof overrides.id === 'string' && overrides.id.trim().length ? overrides.id.trim() : createTerrainPaintLayerId(),
    slotIndex: typeof overrides.slotIndex === 'number' && Number.isFinite(overrides.slotIndex)
      ? Math.max(0, Math.trunc(overrides.slotIndex))
      : normalizedZIndex,
    zIndex: normalizedZIndex,
    enabled: true,
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

function normalizeLayerKeyNumber(value: number): string {
  return Number(value.toFixed(4)).toString()
}

function buildTerrainPaintLayerKey(assetId: string | null | undefined, settings: TerrainPaintBrushSettings): string {
  const normalizedAssetId = typeof assetId === 'string' ? assetId.trim() : ''
  const normalizedSettings = clampTerrainPaintBrushSettings(settings)
  return [
    normalizedAssetId,
    normalizedSettings.blendMode,
    normalizedSettings.worldSpace ? '1' : '0',
    normalizeLayerKeyNumber(normalizedSettings.opacity),
    normalizeLayerKeyNumber(normalizedSettings.feather),
    normalizeLayerKeyNumber(normalizedSettings.rotationDeg),
    normalizeLayerKeyNumber(normalizedSettings.tileScale.x),
    normalizeLayerKeyNumber(normalizedSettings.tileScale.y),
    normalizeLayerKeyNumber(normalizedSettings.offset.x),
    normalizeLayerKeyNumber(normalizedSettings.offset.y),
  ].join('|')
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

  function replacePaintLayers(layers: TerrainPaintLayerDraft[]) {
    const normalized = normalizeTerrainPaintLayers(layers)
    paintLayers.value = normalized
    const stillSelected = normalized.some((layer) => layer.id === paintSelectedLayerId.value)
    paintSelectedLayerId.value = stillSelected ? paintSelectedLayerId.value : (normalized[0]?.id ?? null)
  }

  function appendPaintLayer(overrides: Partial<TerrainPaintLayerDraft> = {}): TerrainPaintLayerDraft | null {
    if (paintLayers.value.length >= TERRAIN_PAINT_MAX_LAYER_COUNT) {
      return null
    }
    const nextZIndex = paintLayers.value.reduce((maxZIndex, layer) => Math.max(maxZIndex, layer.zIndex), -1) + 1
    if (nextZIndex >= TERRAIN_PAINT_MAX_LAYER_COUNT) {
      return null
    }
    const layer = createTerrainPaintLayerDraft(nextZIndex, {
      settings: defaultPaintBrushSettings.value,
      enabled: true,
      ...overrides,
    })
    replacePaintLayers([...paintLayers.value, layer])
    paintSelectedLayerId.value = layer.id
    return layer
  }

  function findPaintLayerByKey(assetId: string | null | undefined, settings: TerrainPaintBrushSettings): TerrainPaintLayerDraft | null {
    const key = buildTerrainPaintLayerKey(assetId, settings)
    return paintLayers.value.find((layer) => {
      return buildTerrainPaintLayerKey(layer.assetId ?? layer.asset?.id ?? null, layer.settings) === key
    }) ?? null
  }

  function resolveOrCreatePaintLayer(asset: ProjectAsset, settings: TerrainPaintBrushSettings): TerrainPaintLayerDraft | null {
    const normalizedSettings = clampTerrainPaintBrushSettings(settings)
    const existing = findPaintLayerByKey(asset.id, normalizedSettings)
    if (existing) {
      paintSelectedLayerId.value = existing.id
      return existing
    }
    return appendPaintLayer({
      asset,
      assetId: asset.id,
      settings: normalizedSettings,
      enabled: true,
    })
  }

  function setPaintSelection(asset: ProjectAsset | null) {
    if (!asset) {
      paintSelectedLayerId.value = null
      return
    }
    const activeSettings = selectedPaintLayer.value?.settings ?? defaultPaintBrushSettings.value
    resolveOrCreatePaintLayer(asset, activeSettings)
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
    defaultPaintBrushSettings.value = nextSettings
    const activeAsset = paintSelectedAsset.value
    if (!activeAsset) {
      return
    }
    resolveOrCreatePaintLayer(activeAsset, nextSettings)
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
    replacePaintLayers,
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
