import { computed, onScopeDispose, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useUiStore } from './uiStore'
import type { GroundSculptOperation } from '@schema/core'
import type { TerrainScatterBrushShape, TerrainScatterCategory } from '@schema/terrain-scatter'
import type { ProjectAsset } from '@/types/project-asset'
import { terrainScatterPresets } from '@/resources/projectProviders/asset'

export type GroundPanelTab = 'terrain' | 'paint' | TerrainScatterCategory
export const SCATTER_BRUSH_RADIUS_MAX = 20 as const
export const SCATTER_SPACING_MAX = 20 as const
export const SCATTER_REGULAR_POLYGON_SIDES_MAX = 256 as const

export type TerrainPaintBlendMode = 'normal' | 'multiply' | 'screen' | 'overlay'

export interface TerrainPaintLayerStyle {
  opacity: number
  tileScale: { x: number; y: number }
  offset: { x: number; y: number }
  rotationDeg: number
  blendMode: TerrainPaintBlendMode
  worldSpace: boolean
}

export type TerrainPaintBrushSettings = TerrainPaintLayerStyle & {
  feather: number
}

const TERRAIN_PAINT_DEFAULT_FEATHER = 0.6
const TERRAIN_PAINT_DEFAULT_STYLE: TerrainPaintLayerStyle = {
  opacity: 1,
  tileScale: { x: 1, y: 1 },
  offset: { x: 0, y: 0 },
  rotationDeg: 0,
  blendMode: 'normal',
  worldSpace: true,
}

function clampTerrainPaintFinite(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function clampTerrainPaintBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function clampTerrainPaintVector2(
  value: { x?: unknown; y?: unknown } | null | undefined,
  fallback: { x: number; y: number },
  min?: number,
): { x: number; y: number } {
  const x = clampTerrainPaintFinite(value?.x, fallback.x)
  const y = clampTerrainPaintFinite(value?.y, fallback.y)
  return {
    x: min === undefined ? x : Math.max(min, x),
    y: min === undefined ? y : Math.max(min, y),
  }
}

export function clampTerrainPaintBlendMode(value: unknown): TerrainPaintBlendMode {
  if (value === 'multiply' || value === 'screen' || value === 'overlay') {
    return value
  }
  return 'normal'
}

export function clampTerrainPaintLayerStyle(
  style: Partial<TerrainPaintLayerStyle> | null | undefined,
): TerrainPaintLayerStyle {
  return {
    opacity: Math.min(1, Math.max(0, clampTerrainPaintFinite(style?.opacity, TERRAIN_PAINT_DEFAULT_STYLE.opacity))),
    tileScale: clampTerrainPaintVector2(style?.tileScale, TERRAIN_PAINT_DEFAULT_STYLE.tileScale, 0.001),
    offset: clampTerrainPaintVector2(style?.offset, TERRAIN_PAINT_DEFAULT_STYLE.offset),
    rotationDeg: Math.min(360, Math.max(-360, clampTerrainPaintFinite(style?.rotationDeg, TERRAIN_PAINT_DEFAULT_STYLE.rotationDeg))),
    blendMode: clampTerrainPaintBlendMode(style?.blendMode),
    worldSpace: clampTerrainPaintBoolean(style?.worldSpace, TERRAIN_PAINT_DEFAULT_STYLE.worldSpace),
  }
}

export function clampTerrainPaintBrushSettings(value: Partial<TerrainPaintBrushSettings> | null | undefined): TerrainPaintBrushSettings {
  const style = clampTerrainPaintLayerStyle(value)
  const featherValue = typeof value?.feather === 'number' ? value.feather : Number(value?.feather)
  return {
    ...style,
    feather: Number.isFinite(featherValue) ? Math.min(1, Math.max(0, featherValue)) : TERRAIN_PAINT_DEFAULT_FEATHER,
  }
}

export const useTerrainStore = defineStore('terrain', () => {
  const brushRadius = ref(3)
  const brushStrength = ref(1.5)
  const brushDepth = ref(2)
  const brushSlope = ref(0.5)
  const brushShape = ref<'circle' | 'polygon'>('circle')
  const brushOperation = ref<GroundSculptOperation | null>(null)
  const groundPanelTab = ref<GroundPanelTab>('terrain')

  const scatterCategory = ref<TerrainScatterCategory>('flora')
  const scatterSelectedAsset = ref<ProjectAsset | null>(null)
  const scatterProviderAssetId = ref<string | null>(null)
  const scatterBrushRadius = ref(0.5)
  const scatterBrushShape = ref<TerrainScatterBrushShape>('circle')
  const scatterRegularPolygonSides = ref(5)
  const scatterSpacing = ref(1)
  const scatterEraseRadius = ref(1)
  const scatterDensityPercent = ref(60)

  const isDigging = computed(() => brushOperation.value === 'depress')
  const scatterPreset = computed(() => terrainScatterPresets[scatterCategory.value])
  const scatterModeActive = computed(() =>
    groundPanelTab.value !== 'terrain' && !!scatterSelectedAsset.value,
  )

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

  function setScatterBrushRadius(value: number) {
    scatterBrushRadius.value = Math.min(SCATTER_BRUSH_RADIUS_MAX, Math.max(0.1, value))
  }

  function setScatterBrushShape(value: TerrainScatterBrushShape) {
    scatterBrushShape.value = value === 'rectangle' || value === 'line' || value === 'polygon' ? value : 'circle'
  }

  function setScatterRegularPolygonSides(value: number) {
    const num = Number(value)
    const rounded = Number.isFinite(num) ? Math.round(num) : 0
    const clamped = Math.min(SCATTER_REGULAR_POLYGON_SIDES_MAX, Math.max(0, rounded))
    scatterRegularPolygonSides.value = clamped >= 3 ? clamped : 0
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

  onScopeDispose(() => {
    // No timers remain after removing terrain paint context syncing.
  })

  return {
    brushRadius,
    brushStrength,
    brushDepth,
    brushSlope,
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
    scatterBrushShape,
    scatterRegularPolygonSides,
    scatterSpacing,
    scatterEraseRadius,
    scatterDensityPercent,
    setBrushOperation,
    setGroundPanelTab,
    setScatterCategory,
    setScatterSelection,
    setScatterBrushRadius,
    setScatterBrushShape,
    setScatterRegularPolygonSides,
    setScatterSpacing,
    setScatterEraseRadius,
    setScatterDensityPercent,
  }
})
