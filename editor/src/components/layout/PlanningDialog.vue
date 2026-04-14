<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { storeToRefs } from 'pinia'
import { generateUuid } from '@/utils/uuid'
import { useSceneStore } from '@/stores/sceneStore'
import { useUiStore } from '@/stores/uiStore'
import PlanningRulers from '@/components/layout/PlanningRulers.vue'
import { WATER_PRESETS, type WaterPresetId } from '@schema/components'
import { clearPlanningGeneratedContent, convertPlanningTo3DScene } from '@/utils/planningToScene'
import { snapCandidatePointToAnglesRelative } from '@/utils/angleSnap'
import {
  getPointsBounds
} from '@/utils/scatterSampling'
import type {
  PlanningGuideData,
  PlanningPolygonData,
  PlanningPolylineData,
  PlanningSceneData,
  PlanningTerrainData,
  PlanningTerrainBudget,
  PlanningTerrainControlPoint,
  PlanningTerrainFalloff,
  PlanningTerrainNoiseMode,
  PlanningTerrainRidgeValleyLine,
} from '@/types/planning-scene-data'
import {
  createPlanningImageUrlFromHash,
  deletePlanningImageFromIndexedDB as deletePlanningImageFromStorage,
  loadPlanningImagesFromIndexedDB as loadPlanningImagesFromStorage,
  persistPlanningImageLayersToIndexedDB,
  savePlanningImageToIndexedDB as savePlanningImageToStorage,
} from '@/utils/planningImageStorage'


const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>()
const dialogOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const sceneStore = useSceneStore()
const { currentSceneId } = storeToRefs(sceneStore)
const uiStore = useUiStore()

type PlanningTool = 'select' | 'pan' | 'rectangle' | 'lasso' | 'line' | 'align-marker'
type LayerKind = 'terrain' | 'guide-route'

const layerKindLabels: Record<LayerKind, string> = {
  terrain: 'Terrain',
  'guide-route': 'Guide Route',
}

const addableLayerKinds: LayerKind[] = ['terrain']

interface PlanningLayer {
  id: string
  name: string
  kind: LayerKind
  visible: boolean
  color: string
  locked: boolean
  conversionEnabled: boolean
}

interface PlanningPoint {
  id?: string
  x: number
  y: number
}

type RectCornerKey = 'minXminY' | 'maxXminY' | 'maxXmaxY' | 'minXmaxY'

type RectResizeConstraint = {
  fixed: { x: number; y: number }
  signX: 1 | -1
  signY: 1 | -1
  cornerKeyByIndex: Record<number, RectCornerKey>
}

interface PlanningPolygon {
  id: string
  name: string
  layerId: string
  points: PlanningPoint[]
  /** Height delta in meters (only meaningful when layer kind is 'terrain'). */
  terrainHeightMeters?: number
  /** Edge blend radius in meters (only meaningful when layer kind is 'terrain'). */
  terrainBlendMeters?: number
  /** Optional pond water preset (only meaningful when layer kind is 'terrain'). */
  terrainWaterPresetId?: WaterPresetId | null
  /** When true, conversion will create/mark an air wall for this feature (layer-dependent). */
  airWallEnabled?: boolean
}

const terrainWaterPresetIds = new Set<WaterPresetId>(WATER_PRESETS.map((preset) => preset.id))

function normalizeTerrainWaterPresetId(value: unknown): WaterPresetId | null {
  return typeof value === 'string' && terrainWaterPresetIds.has(value as WaterPresetId)
    ? value as WaterPresetId
    : null
}

interface PlanningPolyline {
  id: string
  name: string
  layerId: string
  points: PlanningPoint[]
  /** Guide-route waypoint metadata aligned with points (only meaningful when layer kind is 'guide-route'). */
  waypoints?: Array<{ name?: string; dock?: boolean }>
  /** When true, conversion will create/mark an air wall for this feature (layer-dependent). */
  airWallEnabled?: boolean
}

type ScatterTarget =
  | { type: 'polygon'; shape: PlanningPolygon; layer: PlanningLayer | undefined }
  | { type: 'polyline'; shape: PlanningPolyline; layer: PlanningLayer | undefined }

interface PlanningImage {
  id: string
  name: string
  url: string
  /** Content hash (SHA-256 hex) used to reference blob in IndexedDB */
  imageHash?: string
  filename?: string | null
  mimeType?: string | null
  sizeLabel: string
  width: number
  height: number
  visible: boolean
  locked: boolean
  opacity: number
  position: { x: number; y: number }
  scale: number
  // Align marker (stored in the image's own coordinate system: original pixel coordinates)
  alignMarker?: { x: number; y: number }
}

type PlanningGuideAxis = 'x' | 'y'

interface PlanningGuide {
  id: string
  axis: PlanningGuideAxis
  /** World coordinate in meters. Can be negative. */
  value: number
}

type PlanningTerrainGridInput = Partial<{ cellSize: unknown }>
type PlanningTerrainNoiseInput = Partial<Record<'enabled' | 'seed' | 'mode' | 'noiseScale' | 'noiseAmplitude' | 'noiseStrength' | 'detailScale' | 'detailAmplitude' | 'edgeFalloff', unknown>>
type PlanningTerrainControlPointInput = Partial<Record<'id' | 'name' | 'x' | 'y' | 'radius' | 'height' | 'falloff', unknown>>
type PlanningTerrainRidgeValleyLineInput = Partial<Record<'id' | 'name' | 'kind' | 'width' | 'strength' | 'points' | 'profile', unknown>>
type PlanningTerrainOverridesInput = Partial<{ version: unknown; cells: unknown }>

function roundTerrainHeight(value: unknown): number | undefined {
  const num = Number(value)
  if (!Number.isFinite(num)) return undefined
  return Math.round(num * 100) / 100
}

function roundTerrainBlend(value: unknown): number | undefined {
  const num = Number(value)
  if (!Number.isFinite(num)) return undefined
  return Math.round(Math.min(20, Math.max(0, num)) * 100) / 100
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'AbortError'
  }
  return typeof error === 'object' && error !== null && 'name' in error && (error as { name?: unknown }).name === 'AbortError'
}

type SelectedFeature =
  | { type: 'polygon'; id: string }
  | { type: 'polyline'; id: string }
  | { type: 'segment'; lineId: string; segmentIndex: number }
  | null

type SelectedVertex =
  | { feature: 'polygon' | 'polyline'; targetId: string; vertexIndex: number }
  | null

type DragState =
  | { type: 'idle' }
  | { type: 'rectangle'; pointerId: number; start: PlanningPoint; current: PlanningPoint; layerId: string }
  | { type: 'pan'; pointerId: number; origin: { x: number; y: number }; offset: { x: number; y: number } }
  | { type: 'move-polygon'; pointerId: number; polygonId: string; anchor: PlanningPoint; startPoints: PlanningPoint[] }
  | { type: 'move-polyline'; pointerId: number; lineId: string; anchor: PlanningPoint; startPoints: PlanningPoint[] }
  | {
    type: 'move-image-layer'
    pointerId: number
    imageId: string
    startPos: { x: number; y: number }
    anchor: { x: number; y: number }
    // In align mode, record the starting drag positions of layers participating in alignment; layers without align markers are not included.
    groupStartPos?: Record<string, { x: number; y: number }>
  }
  | {
    type: 'resize-image-layer'
    pointerId: number
    imageId: string
    direction: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
    startRect: { x: number; y: number; w: number; h: number }
  }
  | {
    type: 'drag-vertex'
    pointerId: number
    feature: 'polygon' | 'polyline'
    targetId: string
    vertexIndex: number
    rectConstraint?: RectResizeConstraint
  }
  | { type: 'move-align-marker'; pointerId: number; imageId: string }

interface LineContinuation {
  lineId: string
  anchorIndex: number
  direction: 'prepend' | 'append'
}

interface LineDraft {
  lineId: string
  layerId: string
  continuation?: LineContinuation
  /** Snapshot of points before starting a continuation edit (used to rollback on cancel). */
  startPoints?: PlanningPoint[]
  /** Snapshot of waypoint metadata before starting a guide-route continuation edit (used to rollback on cancel). */
  startWaypoints?: Array<{ name?: string; dock?: boolean }>
}

const layerPresets: PlanningLayer[] = [
  { id: 'terrain-layer', name: 'Terrain', kind: 'terrain', visible: true, color: '#6D4C41', locked: false, conversionEnabled: true },
]

const imageAccentPalette = layerPresets.map((layer) => layer.color)

const layers = ref<PlanningLayer[]>(layerPresets.map((layer) => ({ ...layer })))
// Single shared active list item for both layers and images.
// Represented as { type: 'layer'|'image', id: string } or null.
const activeListItem = ref<{ type: 'layer' | 'image'; id: string } | null>({ type: 'layer', id: layers.value[0]?.id ?? 'terrain-layer' })
const activeLayerId = computed<string | null>({
  get: () => (activeListItem.value?.type === 'layer' ? activeListItem.value.id : null),
  set: (v: string | null) => {
    if (v == null) {
      if (activeListItem.value?.type === 'layer') activeListItem.value = null
    } else {
      activeListItem.value = { type: 'layer', id: v }
    }
  },
})
const polygons = ref<PlanningPolygon[]>([])
const polylines = ref<PlanningPolyline[]>([])
const polygonCounter = ref(1)
const lineCounter = ref(1)
const selectedFeature = ref<SelectedFeature>(null)
const selectedVertex = ref<SelectedVertex>(null)
const selectedName = ref('')
const polygonDraftPoints = ref<PlanningPoint[]>([])
const polygonDraftHoverPoint = ref<PlanningPoint | null>(null)
const lineDraft = ref<LineDraft | null>(null)
const lineDraftHoverPoint = ref<PlanningPoint | null>(null)
const dragState = ref<DragState>({ type: 'idle' })
const viewTransform = reactive({ scale: 1, offset: { x: 0, y: 0 } })
const planningImages = ref<PlanningImage[]>([])
const planningGuides = ref<PlanningGuide[]>([])
const guideDraft = ref<PlanningGuide | null>(null)

const TERRAIN_VERTEX_COUNT_LIMIT = 512 * 512

// Planning terrain reactive state and helpers (minimal implementations)
// Initialize with a default non-null terrain to avoid repeated null checks in templates.
const planningTerrain = ref<PlanningTerrainData>(createDefaultPlanningTerrain())

function createDefaultPlanningTerrain(): PlanningTerrainData {
  return {
    version: 1,
    mode: 'normal',
    grid: { cellSize: 1 },
    noise: { enabled: false, seed: 1337, mode: 'perlin', noiseScale: 40, noiseAmplitude: 1, noiseStrength: 1, detailScale: 1, detailAmplitude: 0, edgeFalloff: 0 },
    controlPoints: [],
    ridgeValleyLines: [],
    overrides: { version: 1, cells: {} },
    budget: { vertexCount: 0, expectedKeys: 0, limited: false },
  }
}

function buildTerrainSnapshot(): PlanningTerrainData | null {
  return planningTerrain.value ? { ...planningTerrain.value } : null
}

function isTerrainEmptyForSnapshot(snapshot: PlanningTerrainData | null | undefined): boolean {
  if (!snapshot) return true
  if ((snapshot.controlPoints && snapshot.controlPoints.length > 0) || (snapshot.ridgeValleyLines && snapshot.ridgeValleyLines.length > 0)) return false
  if (snapshot.overrides && snapshot.overrides.cells && Object.keys(snapshot.overrides.cells).length > 0) return false
  if (snapshot.noise && snapshot.noise.enabled) return false
  return true
}

function computeTerrainBudget(data: PlanningTerrainData | null | undefined): PlanningTerrainBudget {
  try {
    const cellSize = Number(data?.grid?.cellSize ?? 1)
    const w = Math.max(1, sceneGroundSize.value.width)
    const h = Math.max(1, sceneGroundSize.value.height)
    const cols = Math.max(1, Math.ceil(w / Math.max(1e-6, cellSize)))
    const rows = Math.max(1, Math.ceil(h / Math.max(1e-6, cellSize)))
    const vertexCount = cols * rows
    const limited = vertexCount > TERRAIN_VERTEX_COUNT_LIMIT
    return { vertexCount, expectedKeys: Object.keys(data?.overrides?.cells ?? {}).length, limited }
  } catch {
    return { vertexCount: 0, expectedKeys: 0, limited: false }
  }
}

// Terrain brush removed: Terrain layer uses polygon/rectangle tools only.

// Temporary guides that follow the mouse (not added to the persistent guides list)
const hoverGuideX = ref<PlanningGuide | null>(null)
const hoverGuideY = ref<PlanningGuide | null>(null)
// Keep list display order consistent with canvas stacking: upper layers appear earlier in the list.
// The canvas uses DOM stacking order (later array elements are on top), so the list needs to be shown in reverse.
const planningImagesForList = computed(() => [...planningImages.value].reverse())
const activeImageId = computed<string | null>({
  get: () => (activeListItem.value?.type === 'image' ? activeListItem.value.id : null),
  set: (v: string | null) => {
    if (v == null) {
      if (activeListItem.value?.type === 'image') activeListItem.value = null
    } else {
      activeListItem.value = { type: 'image', id: v }
    }
  },
})
const draggingImageId = ref<string | null>(null)
const dragOverImageId = ref<string | null>(null)
const alignModeActive = ref(false)
const uploadError = ref<string | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const editorRef = ref<HTMLDivElement | null>(null)
const editorRect = ref<DOMRect | null>(null)
const currentTool = ref<PlanningTool>('select')
// Dynamic cursor style for editor canvas
const editorCursorStyle = computed(() => {
  if (['rectangle', 'lasso', 'line'].includes(currentTool.value)) {
    return { cursor: 'crosshair' }
  }
  
  if (currentTool.value === 'select') {
    return { cursor: 'pointer' }
  }
  // Default: auto
  return { cursor: 'auto' }
})
const lineVertexClickState = ref<{ lineId: string; vertexIndex: number; pointerId: number; moved: boolean } | null>(null)
const activeToolbarTool = computed<PlanningTool>(() => currentTool.value)

// Used to avoid treating a right-drag pan as a contextmenu/cancel gesture.
const suppressContextMenuOnce = ref(false)

const convertingTo3DScene = ref(false)

const addLayerMenuOpen = ref(false)
const draggingLayerId = ref<string | null>(null)
const dragOverLayerId = ref<string | null>(null)
const renamingLayerId = ref<string | null>(null)
const renamingLayerDraft = ref('')
const renameFieldElByLayerId = new Map<string, HTMLElement>()

const activeLayer = computed(() => layers.value.find((layer) => layer.id === activeLayerId.value) ?? layers.value[0])

const sceneGroundSize = computed(() => {
  const width = Number(sceneStore.groundSettings?.width ?? 100)
  const height = Number(sceneStore.groundSettings?.depth ?? 100)
  return {
    width: Number.isFinite(width) ? width : 100,
    height: Number.isFinite(height) ? height : 100,
  }
})
const visibleLayerIds = computed(() => new Set(layers.value.filter((layer) => layer.visible).map((layer) => layer.id)))

// Top of the layer list (earlier in list) = higher layer; SVG elements drawn later appear on top.
// Drawing order is not used when only the active layer is shown.

const visiblePolygons = computed(() => {
  const activeId = activeLayerId.value
  if (!activeId) return []
  return polygons.value.filter((poly) => poly.layerId === activeId)
})

const visiblePolylines = computed(() => {
  const activeId = activeLayerId.value
  if (!activeId) return []
  return polylines.value.filter((line) => line.layerId === activeId)
})

function polygonArea(points: PlanningPoint[]) {
  if (points.length < 3) return 0
  let areaTimes2 = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    areaTimes2 += a.x * b.y - b.x * a.y
  }
  return Math.abs(areaTimes2) * 0.5
}

function rectCornerKeyForPoint(p: PlanningPoint, bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
  const eps = 1e-6
  const near = (a: number, b: number) => Math.abs(a - b) <= eps
  const isMinX = near(p.x, bounds.minX)
  const isMaxX = near(p.x, bounds.maxX)
  const isMinY = near(p.y, bounds.minY)
  const isMaxY = near(p.y, bounds.maxY)
  if (isMinX && isMinY) return 'minXminY' as const
  if (isMaxX && isMinY) return 'maxXminY' as const
  if (isMaxX && isMaxY) return 'maxXmaxY' as const
  if (isMinX && isMaxY) return 'minXmaxY' as const
  return null
}

function buildRectCornerKeyByIndex(points: PlanningPoint[]): Record<number, RectCornerKey> | null {
  if (!Array.isArray(points) || points.length !== 4) return null
  const bounds = getPointsBounds(points)
  if (!bounds) return null
  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 1e-9 || bounds.height <= 1e-9) return null

  const used = new Set<RectCornerKey>()
  const map: Partial<Record<number, RectCornerKey>> = {}
  for (let i = 0; i < 4; i += 1) {
    const p = points[i]
    if (!p) return null
    const key = rectCornerKeyForPoint(p, bounds)
    if (!key) return null
    if (used.has(key)) return null
    used.add(key)
    map[i] = key
  }
  if (used.size !== 4) return null
  return map as Record<number, RectCornerKey>
}

function oppositeRectCornerKey(key: RectCornerKey): RectCornerKey {
  switch (key) {
    case 'minXminY':
      return 'maxXmaxY'
    case 'maxXmaxY':
      return 'minXminY'
    case 'maxXminY':
      return 'minXmaxY'
    case 'minXmaxY':
      return 'maxXminY'
    default:
      return 'maxXmaxY'
  }
}

function computeRectResizeFromConstraint(constraint: RectResizeConstraint, desired: PlanningPoint) {
  const fx = constraint.fixed.x
  const fy = constraint.fixed.y

  let widthAbs = Math.abs(desired.x - fx)
  let heightAbs = Math.abs(desired.y - fy)
  const eps = 1e-9
  if (widthAbs < eps && heightAbs < eps) {
    widthAbs = eps
    heightAbs = eps
  }

  // Keep a minimum size so the rectangle doesn't collapse.
  const minSide = 0.2
  widthAbs = Math.max(widthAbs, minSide)
  heightAbs = Math.max(heightAbs, minSide)

  const nx = fx + constraint.signX * widthAbs
  const ny = fy + constraint.signY * heightAbs

  const minX = Math.min(fx, nx)
  const maxX = Math.max(fx, nx)
  const minY = Math.min(fy, ny)
  const maxY = Math.max(fy, ny)

  const pointForKey = (key: RectCornerKey): PlanningPoint => {
    switch (key) {
      case 'minXminY':
        return { x: minX, y: minY }
      case 'maxXminY':
        return { x: maxX, y: minY }
      case 'maxXmaxY':
        return { x: maxX, y: maxY }
      case 'minXmaxY':
        return { x: minX, y: maxY }
      default:
        return { x: minX, y: minY }
    }
  }

  return {
    nextByIndex: (index: number) => pointForKey(constraint.cornerKeyByIndex[index]!),
  }
}


function polylineLength(points: PlanningPoint[]) {
  if (points.length < 2) return 0
  let total = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!
    const b = points[i + 1]!
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return total
}


const selectedPolygon = computed(() => {
  const feature = selectedFeature.value
  if (!feature || feature.type !== 'polygon') {
    return null
  }
  return polygons.value.find((item) => item.id === feature.id) ?? null
})

const selectedPolyline = computed(() => {
  const feature = selectedFeature.value
  if (!feature) {
    return null
  }
  if (feature.type === 'polyline') {
    return polylines.value.find((item) => item.id === feature.id) ?? null
  }
  if (feature.type === 'segment') {
    return polylines.value.find((item) => item.id === feature.lineId) ?? null
  }
  return null
})

const selectedPolygonAreaM2 = computed(() => {
  const poly = selectedPolygon.value
  if (!poly) return null
  const area = polygonArea(poly.points)
  return Number.isFinite(area) ? area : null
})

const selectedPolylineLengthM = computed(() => {
  const line = selectedPolyline.value
  if (!line) return null
  const length = polylineLength(line.points)
  return Number.isFinite(length) ? length : null
})

const selectedMeasurementTitle = computed(() => {
  if (selectedPolygonAreaM2.value !== null) return 'Area'
  if (selectedPolylineLengthM.value !== null) return 'Length'
  return ''
})

const selectedMeasurementSuffix = computed(() => {
  if (selectedPolygonAreaM2.value !== null) return 'm²'
  if (selectedPolylineLengthM.value !== null) return 'm'
  return ''
})

const selectedMeasurementValueText = computed(() => {
  if (selectedPolygonAreaM2.value !== null) return selectedPolygonAreaM2.value.toFixed(2)
  if (selectedPolylineLengthM.value !== null) return selectedPolylineLengthM.value.toFixed(2)
  return ''
})
const BASE_PIXELS_PER_METER = 10
const PLANNING_RULER_THICKNESS_PX = 34
const LINE_VERTEX_SNAP_RADIUS_PX = 6
// When creating endpoints, merge very-close endpoints to avoid duplicates.
const ENDPOINT_MERGE_RADIUS_PX = 5
const VERTEX_HANDLE_DIAMETER_PX = 10
const VERTEX_HANDLE_RADIUS_PX = VERTEX_HANDLE_DIAMETER_PX / 2
const VERTEX_HIT_RADIUS_PX = 14
const VERTEX_HANDLE_STROKE_PX = 1
const VERTEX_HIGHLIGHT_EXTRA_RADIUS_PX = 6
const VERTEX_HIGHLIGHT_STROKE_PX = 2

// Canvas "world" coordinates are in meters (to match the 3D scene ground settings).
// For screen rendering we map meters -> CSS pixels using BASE_PIXELS_PER_METER.
const canvasSize = computed(() => ({
  width: sceneGroundSize.value.width,
  height: sceneGroundSize.value.height,
}))

// Performance optimization: dynamically changing stage width/height during drag frequently triggers layout, which can cause noticeable jank over long drags.
// Therefore freeze stage size during drag and update position only via transform.
const frozenCanvasSize = ref<{ width: number; height: number } | null>(null)
const effectiveCanvasSize = computed(() => frozenCanvasSize.value ?? canvasSize.value)

// Actual CSS pixel size of the stage (used by DOM/SVG layout).
// Example: 100m -> 1000px when BASE_PIXELS_PER_METER = 10.
const effectiveCanvasPixelSize = computed(() => {
  const meters = effectiveCanvasSize.value
  return {
    width: Math.max(1, Math.round(meters.width * BASE_PIXELS_PER_METER)),
    height: Math.max(1, Math.round(meters.height * BASE_PIXELS_PER_METER)),
  }
})

// Screen pixels per meter after considering zoom.
const renderScale = computed(() => viewTransform.scale * BASE_PIXELS_PER_METER)

function pxToWorld(px: number): number {
  return Number(px) / Math.max(1e-6, renderScale.value)
}

function normalizeRoadLayerIfNeeded(layerId: string | null | undefined) {
  void layerId
}

const vertexHandleRadiusWorld = computed(() => pxToWorld(VERTEX_HANDLE_RADIUS_PX))
const vertexHandleHitRadiusWorld = computed(() => pxToWorld(VERTEX_HIT_RADIUS_PX))
const vertexHandleStrokeWidthWorld = computed(() => pxToWorld(VERTEX_HANDLE_STROKE_PX))
const vertexHighlightRadiusWorld = computed(() => pxToWorld(VERTEX_HANDLE_RADIUS_PX + VERTEX_HIGHLIGHT_EXTRA_RADIUS_PX))
const vertexHighlightStrokeWidthWorld = computed(() => pxToWorld(VERTEX_HIGHLIGHT_STROKE_PX))

type ScaleBarSpec = { meters: number; pixels: number; label: string }

const SCALE_BAR_TARGET_PX = 120
const SCALE_BAR_MIN_PX = 72
const SCALE_BAR_MAX_PX = 170

function formatScaleDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) {
    return ''
  }
  if (meters >= 1000) {
    const km = meters / 1000
    const rounded = km >= 10 ? Math.round(km) : Math.round(km * 10) / 10
    return `${rounded} km`
  }
  if (meters >= 10) {
    return `${Math.round(meters)} m`
  }
  if (meters >= 1) {
    const rounded = Math.round(meters * 10) / 10
    return `${rounded} m`
  }
  const rounded = Math.round(meters * 100) / 100
  return `${rounded} m`
}

function computeScaleBar(ppm: number): ScaleBarSpec {
  if (!Number.isFinite(ppm) || ppm <= 1e-6) {
    return { meters: 0, pixels: 0, label: '' }
  }

  const targetMeters = SCALE_BAR_TARGET_PX / ppm
  const targetExp = Math.floor(Math.log10(Math.max(1e-12, targetMeters)))
  const candidates: number[] = []
  for (let exp = targetExp - 2; exp <= targetExp + 2; exp += 1) {
    const base = 10 ** exp
    candidates.push(1 * base, 2 * base, 5 * base)
  }

  const scored = candidates
    .map((meters) => ({ meters, pixels: meters * ppm }))
    .filter((c) => Number.isFinite(c.pixels) && c.pixels > 0)

  const within = scored.filter((c) => c.pixels >= SCALE_BAR_MIN_PX && c.pixels <= SCALE_BAR_MAX_PX)
  const pool = within.length ? within : scored
  const best = pool.reduce(
    (acc, cur) => {
      const accDelta = Math.abs(acc.pixels - SCALE_BAR_TARGET_PX)
      const curDelta = Math.abs(cur.pixels - SCALE_BAR_TARGET_PX)
      return curDelta < accDelta ? cur : acc
    },
    pool[0] ?? { meters: 1, pixels: ppm },
  )

  const pixels = Math.round(best.pixels)
  const meters = best.meters
  return { meters, pixels, label: formatScaleDistance(meters) }
}

const scaleBarSpec = computed(() => computeScaleBar(renderScale.value))

function computeFitViewScale(rect: Pick<DOMRect, 'width' | 'height'>, options?: { paddingPx?: number }): number {
  const paddingPx = options?.paddingPx ?? 24
  const availableW = Math.max(1, rect.width - paddingPx * 2)
  const availableH = Math.max(1, rect.height - paddingPx * 2)

  const canvasW = Math.max(1e-6, effectiveCanvasSize.value.width)
  const canvasH = Math.max(1e-6, effectiveCanvasSize.value.height)

  // Stage pixel size is (canvasSize * renderScale). renderScale = viewScale * BASE_PIXELS_PER_METER.
  const fitRenderScale = Math.min(availableW / canvasW, availableH / canvasH)
  const fitViewScale = fitRenderScale / BASE_PIXELS_PER_METER
  if (!Number.isFinite(fitViewScale) || fitViewScale <= 0) {
    return 1
  }
  return fitViewScale
}

function fitViewToCanvas(options?: { markDirty?: boolean }) {
  const rect = editorRef.value?.getBoundingClientRect() ?? editorRect.value
  if (!rect) {
    return
  }
  const nextScale = computeFitViewScale(rect, { paddingPx: 24 })
  viewTransform.scale = nextScale
  viewTransform.offset.x = 0
  viewTransform.offset.y = 0
  if (options?.markDirty) {
    markPlanningDirty()
  }
}

function getFitScaleForViewport(rect: Pick<DOMRect, 'width' | 'height'>) {
  const fitScale = computeFitViewScale(rect, { paddingPx: 24 })
  return Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1
}

function applyZoomToView(options: { nextViewScale: number; rect: DOMRect; anchorClientX: number; anchorClientY: number }) {
  const { nextViewScale, rect, anchorClientX, anchorClientY } = options
  const previousViewScale = viewTransform.scale
  if (!Number.isFinite(nextViewScale) || nextViewScale <= 0 || nextViewScale === previousViewScale) {
    return
  }

  // Keep the world point under the anchor (mouse/canvas center) stable.
  const previousRenderScale = previousViewScale * BASE_PIXELS_PER_METER
  const centerBefore = computeStageCenterOffset(rect, previousRenderScale)
  const sx = anchorClientX - rect.left
  const sy = anchorClientY - rect.top
  const worldX = (sx - centerBefore.x) / previousRenderScale - viewTransform.offset.x
  const worldY = (sy - centerBefore.y) / previousRenderScale - viewTransform.offset.y

  const nextRenderScale = nextViewScale * BASE_PIXELS_PER_METER
  const nextCenter = computeStageCenterOffset(rect, nextRenderScale)
  viewTransform.scale = nextViewScale
  viewTransform.offset.x = (sx - nextCenter.x) / nextRenderScale - worldX
  viewTransform.offset.y = (sy - nextCenter.y) / nextRenderScale - worldY
}

const zoomPercentModel = computed({
  get: () => {
    const rect = editorRect.value
    const fitScale = rect ? getFitScaleForViewport(rect) : 1
    const percent = (viewTransform.scale / Math.max(1e-6, fitScale)) * 100
    if (!Number.isFinite(percent)) {
      return 100
    }
    return Math.round(Math.min(400, Math.max(10, percent)))
  },
  set: (value: number) => {
    if (!dialogOpen.value) {
      return
    }
    const rect = editorRef.value?.getBoundingClientRect() ?? editorRect.value
    if (!rect) {
      return
    }
    const fitScale = getFitScaleForViewport(rect)
    const nextPercent = Math.min(400, Math.max(10, Number(value)))
    const nextViewScale = fitScale * (nextPercent / 100)

    // Anchor zoom to viewport center when using the slider.
    applyZoomToView({
      nextViewScale,
      rect,
      anchorClientX: rect.left + rect.width / 2,
      anchorClientY: rect.top + rect.height / 2,
    })
    markPlanningDirty()
  },
})

let planningDirty = false
function markPlanningDirty() {
  planningDirty = true
}

function setLayerConversionEnabled(layerId: string | null | undefined, enabled: boolean, options?: { markDirty?: boolean }) {
  if (!layerId) {
    return false
  }
  const layer = layers.value.find((item) => item.id === layerId)
  if (!layer || layer.conversionEnabled === enabled) {
    return false
  }
  layer.conversionEnabled = enabled
  if (options?.markDirty !== false) {
    markPlanningDirty()
  }
  return true
}

function enableLayerConversion(layerId: string | null | undefined) {
  return setLayerConversionEnabled(layerId, true)
}

function setLayersConversionEnabled(layerIds: Iterable<string>, enabled: boolean) {
  let changed = false
  for (const layerId of layerIds) {
    changed = setLayerConversionEnabled(layerId, enabled, { markDirty: false }) || changed
  }
  if (changed) {
    markPlanningDirty()
  }
  return changed
}

type RulerGuideDragPhase = 'start' | 'move' | 'end' | 'cancel'
type RulerGuideDragEvent = {
  phase: RulerGuideDragPhase
  axis: PlanningGuideAxis
  clientX: number
  clientY: number
}

function handleRulerGuideDrag(event: RulerGuideDragEvent) {
  if (!dialogOpen.value) {
    return
  }
  if (event.phase === 'cancel') {
    guideDraft.value = null
    return
  }

  const world = clientToWorld(event.clientX, event.clientY)
  const value = event.axis === 'x' ? world.x : world.y
  if (!Number.isFinite(value)) {
    return
  }

  if (event.phase === 'start' || event.phase === 'move') {
    guideDraft.value = { id: 'draft', axis: event.axis, value }
    return
  }

  if (event.phase === 'end') {
    planningGuides.value.push({ id: createId('guide'), axis: event.axis, value })
    guideDraft.value = null
    markPlanningDirty()
  }
}



function buildPlanningSnapshot(): PlanningSceneData {
  return {
    version: 1 as const,
    activeLayerId: activeLayerId.value ?? undefined,
    layers: layers.value.map((layer) => ({
      id: layer.id,
      name: layer.name,
      kind: layer.kind,
      color: layer.color,
      visible: layer.visible,
      locked: layer.locked,
      conversionEnabled: layer.conversionEnabled !== false,
    })),
    viewTransform: {
      scale: viewTransform.scale,
      offset: { x: viewTransform.offset.x, y: viewTransform.offset.y },
    },
    guides: planningGuides.value.map((g) => ({ id: g.id, axis: g.axis, value: g.value })),
    terrain: buildTerrainSnapshot() ?? undefined,
    polygons: polygons.value.map((poly) => ({
      id: poly.id,
      name: poly.name,
      layerId: poly.layerId,
      points: poly.points.map((p) => ({ x: p.x, y: p.y })),
      terrainHeightMeters: getLayerKind(poly.layerId) === 'terrain'
        ? roundTerrainHeight(poly.terrainHeightMeters)
        : undefined,
      terrainBlendMeters: getLayerKind(poly.layerId) === 'terrain'
        ? roundTerrainBlend(poly.terrainBlendMeters)
        : undefined,
      terrainWaterPresetId: getLayerKind(poly.layerId) === 'terrain'
        ? normalizeTerrainWaterPresetId(poly.terrainWaterPresetId)
        : undefined,
      airWallEnabled: poly.airWallEnabled ? true : undefined,
    })),
    polylines: polylines.value.map((line) => ({
      id: line.id,
      name: line.name,
      layerId: line.layerId,
      points: line.points.map((p) => ({ id: p.id, x: p.x, y: p.y })),
      waypoints: undefined,
      airWallEnabled: line.airWallEnabled ? true : undefined,
      scatter: undefined,
    })),
    images: planningImages.value.map((img) => ({
      id: img.id,
      name: img.name,
      url: img.imageHash ? '' : img.url,
      imageHash: img.imageHash,
      filename: img.filename ?? null,
      mimeType: img.mimeType ?? null,
      sizeLabel: img.sizeLabel,
      width: img.width,
      height: img.height,
      visible: img.visible,
      locked: img.locked,
      opacity: img.opacity,
      position: { x: img.position.x, y: img.position.y },
      scale: img.scale,
      alignMarker: img.alignMarker ? { x: img.alignMarker.x, y: img.alignMarker.y } : undefined,
    })),
  }
}

function isPlanningSnapshotEmpty(snapshot: ReturnType<typeof buildPlanningSnapshot>) {
  return (
    snapshot.images.length === 0
    && snapshot.polygons.length === 0
    && snapshot.polylines.length === 0
    && (!snapshot.guides || snapshot.guides.length === 0)
    && (!snapshot.terrain || isTerrainEmptyForSnapshot(snapshot.terrain))
  )
}

function safeJsonStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function persistPlanningToSceneIfDirty(options?: { force?: boolean }) {
  const force = options?.force ?? false
  if (!planningDirty && !force) {
    return
  }

  // Ensure the final frame merged by RAF is also applied to state before creating a snapshot.
  if (pendingPan) {
    viewTransform.offset.x = pendingPan.x
    viewTransform.offset.y = pendingPan.y
    pendingPan = null
  }
  if (pendingImageMoves?.length) {
    pendingImageMoves.forEach((move) => {
      const image = planningImages.value.find((img) => img.id === move.imageId)
      if (image) {
        image.position.x = move.x
        image.position.y = move.y
      }
    })
    pendingImageMoves = null
  }
  if (pendingMarkerMove) {
    const image = planningImages.value.find((img) => img.id === pendingMarkerMove?.imageId)
    if (image) {
      image.alignMarker = { x: pendingMarkerMove.localX, y: pendingMarkerMove.localY }
    }
    pendingMarkerMove = null
  }
  // persist layer metadata to IndexedDB asynchronously (fire-and-forget)
  void persistLayersToIndexedDB()

  const snapshot = buildPlanningSnapshot()
  const nextData = isPlanningSnapshotEmpty(snapshot) ? null : snapshot
  const currentData = sceneStore.planningData ?? null

  // Empty scenes are not persisted by default, and 'view-only' operations shouldn't trigger unsaved prompts.
  if (nextData === null && currentData === null) {
    planningDirty = false
    return
  }

  // Avoid dirtying the scene when nothing actually changed.
  const nextJson = safeJsonStringify(nextData)
  const currentJson = safeJsonStringify(currentData)
  const unchanged = nextJson !== null && currentJson !== null ? nextJson === currentJson : nextData === currentData
  if (unchanged) {
    planningDirty = false
    return
  }

  sceneStore.planningData = nextData
  sceneStore.hasUnsavedChanges = true
  planningDirty = false
}

async function handleConvertTo3DScene() {
  if (convertingTo3DScene.value) return

  // Ensure latest edits are persisted before conversion.
  persistPlanningToSceneIfDirty({ force: true })

  const planningData = sceneStore.planningData
  const convertedLayerIds = planningData?.layers
    .filter((layer) => layer.conversionEnabled !== false)
    .map((layer) => layer.id) ?? []
  convertingTo3DScene.value = true

  const abortController = new AbortController()

  try {
    uiStore.showLoadingOverlay({
      mode: 'determinate',
      progress: 0,
      title: '转换到 3D 场景',
      message: '准备中…',
      closable: false,
      cancelable: true,
      cancelText: '取消',
      autoClose: false,
    })
    uiStore.setLoadingOverlayCancelHandler(() => abortController.abort())

    // Close dialog first, then start conversion.
    dialogOpen.value = false
    await nextTick()

    if (!planningData) {
      uiStore.updateLoadingOverlay({
        mode: 'determinate',
        progress: 50,
        message: '正在同步删除内容…',
        closable: false,
        autoClose: false,
      })
      await clearPlanningGeneratedContent(sceneStore)
    } else {
      await convertPlanningTo3DScene({
        sceneStore,
        planningData,
        overwriteExisting: false,
        signal: abortController.signal,
        onProgress: ({ step, progress }) => {
          if (abortController.signal.aborted) return
          uiStore.updateLoadingOverlay({
            mode: 'determinate',
            progress,
            message: step,
            closable: false,
            autoClose: false,
          })
        },
      })

      if (convertedLayerIds.length) {
        setLayersConversionEnabled(convertedLayerIds, false)
        persistPlanningToSceneIfDirty({ force: true })
      }
    }

    uiStore.updateLoadingOverlay({
      mode: 'determinate',
      progress: 100,
      message: 'Conversion complete.',
      closable: true,
      cancelable: false,
      autoClose: true,
      autoCloseDelay: 1200,
    })
  } catch (error) {
    const isAbort = isAbortError(error)
    if (isAbort) {
      uiStore.updateLoadingOverlay({
        mode: 'determinate',
        progress: 100,
        message: '已取消，现有生成内容已保留。',
        closable: true,
        cancelable: false,
        autoClose: true,
        autoCloseDelay: 600,
      })
      return
    }

    console.error('Failed to convert planning to 3D scene', error)
    const message = error instanceof Error ? error.message : 'Conversion failed.'
    uiStore.updateLoadingOverlay({
      mode: 'determinate',
      progress: 100,
      message,
      closable: true,
      cancelable: false,
      autoClose: false,
    })
  } finally {
    uiStore.setLoadingOverlayCancelHandler(null)
    convertingTo3DScene.value = false
  }
}

function resetPlanningState() {
  planningImages.value = []
  planningGuides.value = []
  guideDraft.value = null
  planningTerrain.value = createDefaultPlanningTerrain()
  polygons.value = []
  polylines.value = []
  polygonDraftPoints.value = []
  clearLineDraft()
  selectedFeature.value = null
  activeImageId.value = null
  layers.value = layerPresets.map((layer) => ({ ...layer }))
  activeLayerId.value = layers.value[0]?.id ?? 'terrain-layer'
  viewTransform.scale = 1
  viewTransform.offset.x = 0
  viewTransform.offset.y = 0
}

function normalizeGuide(raw: unknown): PlanningGuide | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const payload = raw as Record<string, unknown>
  const axis = payload.axis === 'x' || payload.axis === 'y' ? (payload.axis as PlanningGuideAxis) : null
  const value = Number(payload.value)
  if (!axis || !Number.isFinite(value)) {
    return null
  }
  const id = typeof payload.id === 'string' ? payload.id : createId('guide')
  return { id, axis, value }
}

function normalizeTerrainFalloff(raw: unknown): PlanningTerrainFalloff {
  return raw === 'linear' || raw === 'smoothstep' || raw === 'cosine' ? (raw as PlanningTerrainFalloff) : 'cosine'
}

function normalizeTerrainNoiseMode(raw: unknown): PlanningTerrainNoiseMode {
  return raw === 'simple' || raw === 'perlin' || raw === 'ridge' || raw === 'voronoi' || raw === 'flat'
    ? (raw as PlanningTerrainNoiseMode)
    : 'perlin'
}

function normalizePlanningTerrain(raw: unknown): PlanningTerrainData {
  const next = createDefaultPlanningTerrain()
  if (!raw || typeof raw !== 'object') {
    return next
  }
  const payload = raw as Record<string, unknown>

  const grid = payload.grid && typeof payload.grid === 'object' ? payload.grid as PlanningTerrainGridInput : null
  const cellSize = Number(grid?.cellSize)
  if (Number.isFinite(cellSize) && cellSize >= 0.1 && cellSize <= 20) {
    next.grid = { cellSize }
  }

  const noise = payload.noise && typeof payload.noise === 'object' ? payload.noise as PlanningTerrainNoiseInput : null
  if (noise) {
    next.noise = {
      enabled: Boolean(noise.enabled),
      seed: Number.isFinite(Number(noise.seed)) ? Math.floor(Number(noise.seed)) : next.noise?.seed,
      mode: normalizeTerrainNoiseMode(noise.mode),
      noiseScale: Number.isFinite(Number(noise.noiseScale)) ? Math.max(0.1, Number(noise.noiseScale)) : next.noise?.noiseScale,
      noiseAmplitude: Number.isFinite(Number(noise.noiseAmplitude)) ? Number(noise.noiseAmplitude) : next.noise?.noiseAmplitude,
      noiseStrength: Number.isFinite(Number(noise.noiseStrength)) ? Number(noise.noiseStrength) : next.noise?.noiseStrength,
      detailScale: Number.isFinite(Number(noise.detailScale)) ? Math.max(0.1, Number(noise.detailScale)) : next.noise?.detailScale,
      detailAmplitude: Number.isFinite(Number(noise.detailAmplitude)) ? Math.max(0, Number(noise.detailAmplitude)) : next.noise?.detailAmplitude,
      edgeFalloff: Number.isFinite(Number(noise.edgeFalloff)) ? Math.max(0, Number(noise.edgeFalloff)) : next.noise?.edgeFalloff,
    }
  }

  if (Array.isArray(payload.controlPoints)) {
    next.controlPoints = payload.controlPoints
      .map((cp) => {
        const controlPoint = (cp && typeof cp === 'object' ? cp : null) as PlanningTerrainControlPointInput | null
        const x = Number(controlPoint?.x)
        const y = Number(controlPoint?.y)
        const radius = Number(controlPoint?.radius)
        const height = Number(controlPoint?.height)
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius <= 0 || !Number.isFinite(height)) {
          return null
        }
        const id = typeof controlPoint?.id === 'string' ? controlPoint.id : createId('terrain-cp')
        const nextCp: PlanningTerrainControlPoint = {
          id,
          x,
          y,
          radius,
          height,
          falloff: normalizeTerrainFalloff(controlPoint?.falloff),
        }
        if (typeof controlPoint?.name === 'string') {
          nextCp.name = controlPoint.name
        }
        return nextCp
      })
      .filter((cp): cp is PlanningTerrainControlPoint => !!cp)
  }

  if (Array.isArray(payload.ridgeValleyLines)) {
    next.ridgeValleyLines = payload.ridgeValleyLines
      .map((line) => {
        const ridgeValleyLine = (line && typeof line === 'object' ? line : null) as PlanningTerrainRidgeValleyLineInput | null
        const kind = ridgeValleyLine?.kind === 'ridge' || ridgeValleyLine?.kind === 'valley' ? ridgeValleyLine.kind : null
        const width = Number(ridgeValleyLine?.width)
        const strength = Number(ridgeValleyLine?.strength)
        const points = Array.isArray(ridgeValleyLine?.points) ? ridgeValleyLine.points : null
        if (!kind || !Number.isFinite(width) || width <= 0 || !Number.isFinite(strength) || !points || points.length < 2) {
          return null
        }
        const normPoints = points
          .map((p) => {
            const point = p && typeof p === 'object' ? p as Partial<PlanningPoint> : null
            const x = Number(point?.x)
            const y = Number(point?.y)
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null
            return { x, y }
          })
          .filter((p): p is PlanningPoint => !!p)
        if (normPoints.length < 2) return null
        const id = typeof ridgeValleyLine?.id === 'string' ? ridgeValleyLine.id : createId('terrain-line')
        const nextLine: PlanningTerrainRidgeValleyLine = {
          id,
          kind,
          width,
          strength,
          points: normPoints,
          profile: normalizeTerrainFalloff(ridgeValleyLine?.profile),
        }
        if (typeof ridgeValleyLine?.name === 'string') {
          nextLine.name = ridgeValleyLine.name
        }
        return nextLine
      })
      .filter((line): line is PlanningTerrainRidgeValleyLine => !!line)
  }

  // Overrides are reserved for future A brush. Keep, but do not attempt deep normalization.
  const overrides = payload.overrides && typeof payload.overrides === 'object' ? payload.overrides as PlanningTerrainOverridesInput : null
  if (overrides && overrides.version === 1 && overrides.cells && typeof overrides.cells === 'object') {
    next.overrides = { version: 1, cells: overrides.cells as Record<string, number> }
  }

  return next
}

// Mark used to avoid "declared but never read" during incremental refactor.
void normalizePlanningTerrain

function loadPlanningFromScene() {
  const data = sceneStore.planningData as PlanningSceneData | null | undefined
  resetPlanningState()
  if (!data) {
    // When there's no saved planning data (or no saved transform), default to fitting the whole canvas.
    void nextTick(() => fitViewToCanvas({ markDirty: false }))
    planningDirty = false
    return
  }

  const usedFeatureIds = new Set<string>()

  if (Array.isArray(data.guides)) {
    planningGuides.value = data.guides.map((guide: PlanningGuideData) => normalizeGuide(guide)).filter((g): g is PlanningGuide => !!g)
  }

  planningTerrain.value = normalizePlanningTerrain(data.terrain)

  if (data.activeLayerId) {
    activeLayerId.value = data.activeLayerId
  }
  layers.value = data.layers
    .filter((layer) => layer.kind === 'terrain')
    .map((layer) => ({
      id: layer.id,
      name: layer.name,
      kind: 'terrain',
      visible: layer.visible,
      color: layer.color,
      locked: layer.locked,
      conversionEnabled: layer.conversionEnabled !== false,
    }))

  if (!layers.value.length) {
    layers.value = layerPresets.map((layer) => ({ ...layer }))
  }

  if (!layers.value.find((l) => l.id === activeLayerId.value)) {
    activeLayerId.value = layers.value[0]?.id ?? activeLayerId.value
  }
  if (data.viewTransform) {
    const s = Number(data.viewTransform.scale)
    const ox = Number(data.viewTransform.offset?.x)
    const oy = Number(data.viewTransform.offset?.y)
    if (Number.isFinite(s) && s > 0) {
      viewTransform.scale = s
    }
    if (Number.isFinite(ox)) {
      viewTransform.offset.x = ox
    }
    if (Number.isFinite(oy)) {
      viewTransform.offset.y = oy
    }
  } else {
    // No saved viewport yet; ensure the full canvas is visible.
    void nextTick(() => fitViewToCanvas({ markDirty: false }))
  }

  polygons.value = Array.isArray(data.polygons)
    ? data.polygons.map((poly: PlanningPolygonData) => ({
      id: normalizePlanningFeatureId(poly.id, usedFeatureIds),
      name: poly.name,
      layerId: poly.layerId,
      points: Array.isArray(poly.points) ? poly.points.map((p) => ({ x: p.x, y: p.y })) : [],
      terrainHeightMeters: (() => {
        const raw = Number(poly.terrainHeightMeters)
        if (!Number.isFinite(raw)) return 0
        return Math.min(1000, Math.max(-1000, Math.round(raw * 100) / 100))
      })(),
      terrainBlendMeters: (() => {
        const raw = Number(poly.terrainBlendMeters)
        if (!Number.isFinite(raw)) return 2
        return Math.min(20, Math.max(0, Math.round(raw * 100) / 100))
      })(),
      terrainWaterPresetId: normalizeTerrainWaterPresetId(poly.terrainWaterPresetId),
      airWallEnabled: Boolean(poly.airWallEnabled),
    }))
    : []

  const polylinePointPool = new Map<string, PlanningPoint>()

  polylines.value = Array.isArray(data.polylines)
    ? data.polylines.map((line: PlanningPolylineData) => {
      const points = Array.isArray(line.points)
        ? line.points.map((raw) => {
          const x = Number(raw.x)
          const y = Number(raw.y)
          const id = typeof raw.id === 'string' ? String(raw.id) : createId('v')
          const pooled = polylinePointPool.get(id)
          if (pooled) {
            if (Number.isFinite(x)) pooled.x = x
            if (Number.isFinite(y)) pooled.y = y
            return pooled
          }
          const p: PlanningPoint = {
            id,
            x: Number.isFinite(x) ? x : 0,
            y: Number.isFinite(y) ? y : 0,
          }
          polylinePointPool.set(id, p)
          return p
        })
        : []

      return {
        id: normalizePlanningFeatureId(line.id, usedFeatureIds),
        name: line.name,
        layerId: line.layerId,
        points,
        waypoints: undefined,
        airWallEnabled: Boolean(line.airWallEnabled),
        scatter: undefined,
      }
    }).filter((line) => layers.value.some((layer) => layer.id === line.layerId))
    : []

  planningImages.value = Array.isArray(data.images)
    ? data.images.map((img) => ({
      id: img.id,
      name: img.name,
      url: img.url,
      imageHash: img.imageHash,
      filename: img.filename ?? null,
      mimeType: img.mimeType ?? null,
      sizeLabel: img.sizeLabel,
      width: img.width,
      height: img.height,
      visible: img.visible,
      locked: img.locked,
      opacity: img.opacity,
      position: { x: img.position.x, y: img.position.y },
      scale: img.scale,
      alignMarker: img.alignMarker ? { x: img.alignMarker.x, y: img.alignMarker.y } : undefined,
    }))
    : []

  activeImageId.value = planningImages.value[0]?.id ?? null
  planningDirty = false
}

function getEffectiveTool(): PlanningTool {
  return currentTool.value
}

// Performance optimization: coalesce high-frequency pointermove updates to avoid triggering reactive chains and style recomputation on every event.
let rafScheduled = false
let pendingPan: { x: number; y: number } | null = null
let pendingImageMoves: Array<{ imageId: string; x: number; y: number }> | null = null
let pendingMarkerMove: { imageId: string; localX: number; localY: number } | null = null
let pendingLassoHoverClient: { x: number; y: number } | null = null
let pendingLineHoverClient: { x: number; y: number } | null = null

function scheduleRafFlush() {
  if (rafScheduled) {
    return
  }
  rafScheduled = true
  requestAnimationFrame(() => {
    rafScheduled = false
    if (pendingPan) {
      viewTransform.offset.x = pendingPan.x
      viewTransform.offset.y = pendingPan.y
      pendingPan = null
    }
    if (pendingImageMoves?.length) {
      pendingImageMoves.forEach((move) => {
        const image = planningImages.value.find((img) => img.id === move.imageId)
        if (image) {
          image.position.x = move.x
          image.position.y = move.y
        }
      })
      pendingImageMoves = null
    }
    if (pendingMarkerMove) {
      const image = planningImages.value.find((img) => img.id === pendingMarkerMove?.imageId)
      if (image) {
        image.alignMarker = { x: pendingMarkerMove.localX, y: pendingMarkerMove.localY }
      }
      pendingMarkerMove = null
    }

    if (pendingLassoHoverClient) {
      if (
        dialogOpen.value
        && dragState.value.type === 'idle'
        && currentTool.value === 'lasso'
        && polygonDraftPoints.value.length
      ) {
        const nextHover = screenToWorld({
          clientX: pendingLassoHoverClient.x,
          clientY: pendingLassoHoverClient.y,
        } as MouseEvent)
        const previousHover = polygonDraftHoverPoint.value
        if (
          !previousHover
          || Math.abs(previousHover.x - nextHover.x) > 0.0001
          || Math.abs(previousHover.y - nextHover.y) > 0.0001
        ) {
          polygonDraftHoverPoint.value = nextHover
        }
      }
      pendingLassoHoverClient = null
    }

    if (pendingLineHoverClient) {
      const line = getDraftLine()
      const anchor = getDraftAnchorPoint(line, lineDraft.value)
      if (
        dialogOpen.value
        && dragState.value.type === 'idle'
        && currentTool.value === 'line'
        && anchor
      ) {
        const nextHover = screenToWorld({
          clientX: pendingLineHoverClient.x,
          clientY: pendingLineHoverClient.y,
        } as MouseEvent)
        const previousHover = lineDraftHoverPoint.value

        // Compute previous vertex (the point before the anchor) for relative-angle snapping
        let candidateHover = nextHover
        try {
          let prevPoint: PlanningPoint | null = null
          if (line && Array.isArray(line.points) && line.points.length >= 2) {
            if (lineDraft.value?.continuation?.direction === 'prepend') {
              prevPoint = line.points.length >= 2 ? line.points[1] ?? null : null
            } else {
              prevPoint = line.points.length >= 2 ? line.points[line.points.length - 2] ?? null : null
            }
          }
          if (prevPoint) {
            candidateHover = snapCandidatePointToAnglesRelative(
              anchor,
              nextHover,
              prevPoint,
              [10, 30, 45, 60, 90, 135, 180],
              5,
            )
          }
        } catch (e) {
          // Fall back to raw hover on unexpected errors
          candidateHover = nextHover
        }

        if (
          !previousHover
          || Math.abs(previousHover.x - candidateHover.x) > 0.0001
          || Math.abs(previousHover.y - candidateHover.y) > 0.0001
        ) {
          lineDraftHoverPoint.value = candidateHover
        }
      }
      pendingLineHoverClient = null
    }

      // Terrain brush support removed; no pending brush hover/paint handling.
  })
}

function beginPanDrag(event: PointerEvent) {
  frozenCanvasSize.value = { ...canvasSize.value }
  dragState.value = {
    type: 'pan',
    pointerId: event.pointerId,
    origin: { x: event.clientX, y: event.clientY },
    offset: { ...viewTransform.offset },
  }
  event.currentTarget instanceof Element && event.currentTarget.setPointerCapture(event.pointerId)
}

function tryBeginRightPan(event: PointerEvent) {
  if (event.button !== 2) {
    return false
  }
  if (dragState.value.type !== 'idle') {
    return false
  }
  event.preventDefault()
  event.stopPropagation()
  suppressContextMenuOnce.value = true
  beginPanDrag(event)
  return true
}
const canUseLineTool = computed(() => {
  const kind = activeLayer.value?.kind
  return kind === 'guide-route'
})

const canUseAreaTools = computed(() => {
  const kind = activeLayer.value?.kind
  return kind === 'terrain'
})

const canDeleteSelection = computed(() => !!selectedFeature.value)

const selectedScatterTarget = computed<ScatterTarget | null>(() => {
  const polygon = selectedPolygon.value
  if (polygon) {
    const layer = layers.value.find((item) => item.id === polygon.layerId)
    return { type: 'polygon', shape: polygon, layer }
  }
  const polyline = selectedPolyline.value
  if (polyline) {
    const layer = layers.value.find((item) => item.id === polyline.layerId)
    return { type: 'polyline', shape: polyline, layer }
  }
  return null
})

function isGuideRoutePolyline(line: PlanningPolyline | null | undefined): boolean {
  if (!line) return false
  return getLayerKind(line.layerId) === 'guide-route'
}

function ensureGuideRouteWaypoints(line: PlanningPolyline) {
  if (!isGuideRoutePolyline(line)) {
    return
  }
  const count = line.points.length
  const current = Array.isArray(line.waypoints) ? [...line.waypoints] : []
  while (current.length < count) {
    current.push({ name: `Point ${current.length + 1}`, dock: false })
  }
  if (current.length > count) {
    current.length = count
  }
  line.waypoints = current
}

  const selectedGuideRouteVertex = computed<{
  line: PlanningPolyline
  vertexIndex: number
  typeLabel: 'Start' | 'End' | 'Waypoint'
} | null>(() => {
  const sel = selectedVertex.value
  if (!sel || sel.feature !== 'polyline') {
    return null
  }
  const line = polylines.value.find((item) => item.id === sel.targetId) ?? null
  if (!line || !isGuideRoutePolyline(line)) {
    return null
  }
  const count = line.points.length
  if (sel.vertexIndex < 0 || sel.vertexIndex >= count) {
    return null
  }
  const typeLabel = sel.vertexIndex === 0
    ? 'Start'
    : (sel.vertexIndex === count - 1 ? 'End' : 'Waypoint')
  return { line, vertexIndex: sel.vertexIndex, typeLabel }
})

const guideRouteWaypointNameModel = computed<string>({
  get: () => {
    const info = selectedGuideRouteVertex.value
    if (!info) return ''
    const waypoint = info.line.waypoints?.[info.vertexIndex]
    return typeof waypoint?.name === 'string' ? waypoint.name : ''
  },
  set: (value: string) => {
    const info = selectedGuideRouteVertex.value
    if (!info) return
    ensureGuideRouteWaypoints(info.line)
    info.line.waypoints![info.vertexIndex]!.name = value
    enableLayerConversion(info.line.layerId)
    markPlanningDirty()
  },
})

const guideRouteWaypointDockModel = computed<boolean>({
  get: () => {
    const info = selectedGuideRouteVertex.value
    if (!info) return false
    const waypoint = info.line.waypoints?.[info.vertexIndex]
    return waypoint?.dock === true
  },
  set: (value: boolean) => {
    const info = selectedGuideRouteVertex.value
    if (!info) return
    ensureGuideRouteWaypoints(info.line)
    info.line.waypoints![info.vertexIndex]!.dock = value === true
    enableLayerConversion(info.line.layerId)
    markPlanningDirty()
  },
})

const selectedImage = computed<PlanningImage | null>(() => {
  return planningImages.value.find((img) => img.id === activeImageId.value) ?? null
})

const propertyPanelDisabledReason = computed(() => {
  const target = selectedScatterTarget.value
  // Allow editing shape properties from the property panel even when the layer is locked.
  if (target) {
    return null
  }
  const img = selectedImage.value
  if (img) {
    if (img.locked) return 'Image is locked'
    return null
  }
  return 'No shape selected'
})

const propertyPanelDisabled = computed(() => propertyPanelDisabledReason.value !== null)

const selectedTerrainContourPolygon = computed<PlanningPolygon | null>(() => {
  const poly = selectedPolygon.value
  if (!poly) return null
  return getLayerKind(poly.layerId) === 'terrain' ? poly : null
})

const terrainContourHeightModel = computed<number>({
  get: () => {
    const poly = selectedTerrainContourPolygon.value
    if (!poly) return 0
    const raw = Number(poly.terrainHeightMeters)
    return Number.isFinite(raw) ? raw : 0
  },
  set: (value: number) => {
    if (propertyPanelDisabled.value) return
    const poly = selectedTerrainContourPolygon.value
    if (!poly) return
    poly.terrainHeightMeters = Math.round(clampNumberInput(value, 0, -1000, 1000) * 100) / 100
    enableLayerConversion(poly.layerId)
    markPlanningDirty()
  },
})

const terrainContourBlendModel = computed<number>({
  get: () => {
    const poly = selectedTerrainContourPolygon.value
    if (!poly) return 2
    const raw = Number(poly.terrainBlendMeters)
    return Number.isFinite(raw) ? Math.min(20, Math.max(0, Math.round(raw * 100) / 100)) : 2
  },
  set: (value: number) => {
    if (propertyPanelDisabled.value) return
    const poly = selectedTerrainContourPolygon.value
    if (!poly) return
    poly.terrainBlendMeters = Math.round(clampNumberInput(value, 2, 0, 20) * 100) / 100
    enableLayerConversion(poly.layerId)
    markPlanningDirty()
  },
})

const terrainWaterPresetOptions = computed<Array<{ value: WaterPresetId | null; label: string }>>(() => [
  { value: null, label: 'Unset' },
  ...WATER_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
])

const terrainContourWaterPresetEnabled = computed(() => {
  const poly = selectedTerrainContourPolygon.value
  if (!poly) return false
  const raw = Number(poly.terrainHeightMeters)
  return Number.isFinite(raw) && raw < 0
})

const terrainContourWaterPresetModel = computed<WaterPresetId | null>({
  get: () => normalizeTerrainWaterPresetId(selectedTerrainContourPolygon.value?.terrainWaterPresetId),
  set: (value: WaterPresetId | null) => {
    if (propertyPanelDisabled.value) return
    const poly = selectedTerrainContourPolygon.value
    if (!poly) return
    poly.terrainWaterPresetId = normalizeTerrainWaterPresetId(value)
    enableLayerConversion(poly.layerId)
    markPlanningDirty()
  },
})

const terrainBudget = computed(() => computeTerrainBudget(planningTerrain.value))
const terrainLimited = computed(() => terrainBudget.value.limited)

const terrainCellSizeModel = computed<number>({
  get: () => {
    const raw = Number(planningTerrain.value?.grid?.cellSize ?? 1)
    return Number.isFinite(raw) && raw >= 0.1 ? raw : 1
  },
  set: (value: number) => {
    const next = Number(value)
    if (!Number.isFinite(next)) return
    const clamped = Math.min(20, Math.max(0.1, next))
    planningTerrain.value = {
      ...planningTerrain.value,
      grid: { cellSize: clamped },
    }
    markPlanningDirty()
  },
})

const terrainNoiseEnabledModel = computed<boolean>({
  get: () => Boolean(planningTerrain.value?.noise?.enabled),
  set: (value: boolean) => {
    planningTerrain.value = {
      ...planningTerrain.value,
      noise: { ...(planningTerrain.value.noise ?? createDefaultPlanningTerrain().noise!), enabled: Boolean(value) },
    }
    markPlanningDirty()
  },
})

const terrainNoiseModeOptions: Array<{ value: PlanningTerrainNoiseMode; label: string }> = [
  { value: 'perlin', label: 'Perlin' },
  { value: 'ridge', label: 'Ridge' },
  { value: 'voronoi', label: 'Voronoi' },
  { value: 'simple', label: 'Simple' },
  { value: 'flat', label: 'Flat' },
]

const terrainNoiseModeModel = computed<PlanningTerrainNoiseMode>({
  get: () => {
    const raw = planningTerrain.value?.noise?.mode
    return normalizeTerrainNoiseMode(raw)
  },
  set: (value: PlanningTerrainNoiseMode) => {
    planningTerrain.value = {
      ...planningTerrain.value,
      noise: { ...(planningTerrain.value.noise ?? createDefaultPlanningTerrain().noise!), mode: value },
    }
    markPlanningDirty()
  },
})

function clampNumberInput(raw: unknown, fallback: number, min: number, max: number): number {
  const num = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, num))
}

const terrainNoiseSeedModel = computed<number>({
  get: () => clampNumberInput(planningTerrain.value?.noise?.seed, 1337, -2147483648, 2147483647),
  set: (value: number) => {
    const seed = Math.trunc(clampNumberInput(value, 1337, -2147483648, 2147483647))
    planningTerrain.value = {
      ...planningTerrain.value,
      noise: { ...(planningTerrain.value.noise ?? createDefaultPlanningTerrain().noise!), seed },
    }
    markPlanningDirty()
  },
})

const terrainNoiseScaleModel = computed<number>({
  get: () => clampNumberInput(planningTerrain.value?.noise?.noiseScale, 40, 1, 10000),
  set: (value: number) => {
    planningTerrain.value = {
      ...planningTerrain.value,
      noise: { ...(planningTerrain.value.noise ?? createDefaultPlanningTerrain().noise!), noiseScale: clampNumberInput(value, 40, 1, 10000) },
    }
    markPlanningDirty()
  },
})

const terrainNoiseAmplitudeModel = computed<number>({
  get: () => clampNumberInput(planningTerrain.value?.noise?.noiseAmplitude, 4, 0, 500),
  set: (value: number) => {
    planningTerrain.value = {
      ...planningTerrain.value,
      noise: { ...(planningTerrain.value.noise ?? createDefaultPlanningTerrain().noise!), noiseAmplitude: clampNumberInput(value, 4, 0, 500) },
    }
    markPlanningDirty()
  },
})

const terrainNoiseStrengthModel = computed<number>({
  get: () => clampNumberInput(planningTerrain.value?.noise?.noiseStrength, 1, 0, 10),
  set: (value: number) => {
    planningTerrain.value = {
      ...planningTerrain.value,
      noise: { ...(planningTerrain.value.noise ?? createDefaultPlanningTerrain().noise!), noiseStrength: clampNumberInput(value, 1, 0, 10) },
    }
    markPlanningDirty()
  },
})

const terrainNoiseEdgeFalloffModel = computed<number>({
  get: () => clampNumberInput(planningTerrain.value?.noise?.edgeFalloff, 0, 0, 20),
  set: (value: number) => {
    planningTerrain.value = {
      ...planningTerrain.value,
      noise: { ...(planningTerrain.value.noise ?? createDefaultPlanningTerrain().noise!), edgeFalloff: clampNumberInput(value, 0, 0, 20) },
    }
    markPlanningDirty()
  },
})

const terrainControlPoints = computed(() => (Array.isArray(planningTerrain.value.controlPoints) ? planningTerrain.value.controlPoints : []))
const terrainRidgeValleyLines = computed(() => (Array.isArray(planningTerrain.value.ridgeValleyLines) ? planningTerrain.value.ridgeValleyLines : []))

const terrainFalloffOptions: Array<{ value: PlanningTerrainFalloff; label: string }> = [
  { value: 'cosine', label: 'Cosine' },
  { value: 'smoothstep', label: 'Smoothstep' },
  { value: 'linear', label: 'Linear' },
]

function updateTerrainControlPoint(id: string, patch: Partial<PlanningTerrainControlPoint>) {
  const list = terrainControlPoints.value
  const index = list.findIndex((cp) => cp.id === id)
  if (index < 0) return
  const next = list.slice()
  next[index] = { ...next[index]!, ...patch }
  planningTerrain.value = { ...planningTerrain.value, controlPoints: next }
  markPlanningDirty()
}

function addTerrainControlPoint() {
  const width = sceneGroundSize.value.width
  const height = sceneGroundSize.value.height
  const point: PlanningTerrainControlPoint = {
    id: createId('terrain-cp'),
    name: `Control Point ${terrainControlPoints.value.length + 1}`,
    x: width * 0.5,
    y: height * 0.5,
    radius: 10,
    height: 5,
    falloff: 'cosine',
  }
  planningTerrain.value = { ...planningTerrain.value, controlPoints: [...terrainControlPoints.value, point] }
  markPlanningDirty()
}

function removeTerrainControlPoint(id: string) {
  planningTerrain.value = { ...planningTerrain.value, controlPoints: terrainControlPoints.value.filter((cp) => cp.id !== id) }
  markPlanningDirty()
}

function updateTerrainLine(id: string, patch: Partial<PlanningTerrainRidgeValleyLine>) {
  const list = terrainRidgeValleyLines.value
  const index = list.findIndex((line) => line.id === id)
  if (index < 0) return
  const next = list.slice()
  next[index] = { ...next[index]!, ...patch }
  planningTerrain.value = { ...planningTerrain.value, ridgeValleyLines: next }
  markPlanningDirty()
}

function removeTerrainLine(id: string) {
  planningTerrain.value = { ...planningTerrain.value, ridgeValleyLines: terrainRidgeValleyLines.value.filter((l) => l.id !== id) }
  markPlanningDirty()
}

function addTerrainLineFromSelected(kind: 'ridge' | 'valley') {
  const line = selectedPolyline.value
  if (!line || !Array.isArray(line.points) || line.points.length < 2) {
    return
  }
  const points = line.points.map((p) => ({ x: p.x, y: p.y }))
  const entry: PlanningTerrainRidgeValleyLine = {
    id: createId('terrain-line'),
    name: `${kind === 'ridge' ? 'Ridge' : 'Valley'} ${terrainRidgeValleyLines.value.length + 1}`,
    kind,
    points,
    width: 8,
    strength: kind === 'ridge' ? 2 : 2,
    profile: 'cosine',
  }
  planningTerrain.value = { ...planningTerrain.value, ridgeValleyLines: [...terrainRidgeValleyLines.value, entry] }
  markPlanningDirty()
}

const airWallEnabledModel = computed<boolean>({
  get: () => {
    const target = selectedScatterTarget.value
    const kind = target?.layer?.kind
    if (!target || kind !== 'terrain') {
      return false
    }
    return Boolean(target.shape.airWallEnabled)
  },
  set: (value: boolean) => {
    if (propertyPanelDisabled.value) return
    const target = selectedScatterTarget.value
    const kind = target?.layer?.kind
    if (!target || kind !== 'terrain') {
      return
    }
    target.shape.airWallEnabled = Boolean(value)
    enableLayerConversion(target.shape.layerId)
    markPlanningDirty()
  },
})

const editorBackgroundStyle = computed(() => {
  return {
    backgroundImage:
      'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.04) 75%), linear-gradient(180deg, rgba(255,255,255,0.04) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.04) 75%)',
    backgroundSize: '48px 48px',
    '--planning-ruler-thickness': `${PLANNING_RULER_THICKNESS_PX}px`,
  }
})

function computeStageCenterOffset(rect: Pick<DOMRect, 'width' | 'height'>, renderScaleValue: number) {
  const width = effectiveCanvasSize.value.width * renderScaleValue
  const height = effectiveCanvasSize.value.height * renderScaleValue
  return {
    x: Math.max((rect.width - width) / 2, 0),
    y: Math.max((rect.height - height) / 2, 0),
  }
}

const stageCenterOffset = computed(() => {
  const rect = editorRect.value ?? editorRef.value?.getBoundingClientRect()
  if (!rect) {
    return { x: 0, y: 0 }
  }
  return computeStageCenterOffset(rect, renderScale.value)
})

const stageStyle = computed<CSSProperties>(() => {
  const scale = renderScale.value
  const center = stageCenterOffset.value
  const base = effectiveCanvasPixelSize.value
  return {
    width: `${base.width}px`,
    height: `${base.height}px`,
    // The stage size already includes BASE_PIXELS_PER_METER; only zoom (viewTransform.scale) is applied here.
    transform: `translate(${center.x + viewTransform.offset.x * scale}px, ${center.y + viewTransform.offset.y * scale}px) scale(${viewTransform.scale})`,
    transformOrigin: 'top left',
    willChange: 'transform',
  }
})

const canvasBoundaryStyle = computed<CSSProperties>(() => {
  const scale = renderScale.value
  const center = stageCenterOffset.value
  const left = center.x + viewTransform.offset.x * scale
  const top = center.y + viewTransform.offset.y * scale
  return {
    width: `${effectiveCanvasSize.value.width * scale}px`,
    height: `${effectiveCanvasSize.value.height * scale}px`,
    transform: `translate(${left}px, ${top}px)`,
    transformOrigin: 'top left',
    pointerEvents: 'none',
  }
})

watch(dialogOpen, (open) => {
  if (open) {
    nextTick(() => {
      updateEditorRect()
      requestAnimationFrame(() => updateEditorRect())
    })
  } else {
    cancelActiveDrafts()
    selectedFeature.value = null
    // Persist on close even if some edits forgot to mark dirty.
    persistPlanningToSceneIfDirty({ force: true })
  }
})

watch(selectedFeature, (feature) => {
  if (!feature) {
    selectedName.value = ''
    return
  }
  if (feature.type === 'polygon') {
    selectedName.value = polygons.value.find((item) => item.id === feature.id)?.name ?? ''
    return
  }
  if (feature.type === 'polyline') {
    selectedName.value = polylines.value.find((item) => item.id === feature.id)?.name ?? ''
    return
  }
  selectedName.value = `Segment ${feature.segmentIndex + 1}`
})

function commitSelectedName(value: string) {
  if (!selectedScatterTarget.value) return
  const shape = selectedScatterTarget.value.shape
  shape.name = value
  selectedName.value = value
  enableLayerConversion(shape.layerId)
  markPlanningDirty()
}

watch(activeLayerId, () => {
  ensureSelectionWithinActiveLayer()
})

watch(
  currentTool,
  (tool, previous) => {
    if (tool === 'line' && !canUseLineTool.value) {
      currentTool.value = 'select'
      return
    }
    if ((tool === 'rectangle' || tool === 'lasso') && !canUseAreaTools.value) {
      currentTool.value = 'select'
      return
    }
    if (previous === 'lasso' && tool !== 'lasso' && polygonDraftPoints.value.length) {
      polygonDraftPoints.value = []
      polygonDraftHoverPoint.value = null
      pendingLassoHoverClient = null
    }
    if (previous === 'line' && tool !== 'line') {
      finalizeLineDraft()
    }
  },
)

watch(
  [dialogOpen, currentSceneId],
  ([open, sceneId], [prevOpen, prevSceneId]) => {
    if (!open) {
      return
    }
    // When switching scenes while the dialog is open: first write back the planning data of the old scene, then load the new scene.
    if (prevOpen && prevSceneId && sceneId && prevSceneId !== sceneId) {
      persistPlanningToSceneIfDirty({ force: true })
    }
    loadPlanningFromScene()
    void hydratePlanningImageUrls()
  },
  { immediate: true },
)

function updateEditorRect() {
  if (editorRef.value) {
    editorRect.value = editorRef.value.getBoundingClientRect()
  }
}

function getLayerName(layerId: string) {
  return layers.value.find((layer) => layer.id === layerId)?.name ?? 'Unassigned'
}

function getLayerColor(layerId: string, alpha = 1) {
  const layer = layers.value.find((item) => item.id === layerId)
  if (!layer) {
    return `rgba(255, 255, 255, ${alpha})`
  }
  // Reduce opacity for active layer to better distinguish it from others.
  // Active layers are considered interactive (see `isActiveLayer`).
  const ACTIVE_LAYER_ALPHA_FACTOR = 0.5
  const effectiveAlpha = isActiveLayer(layerId) ? alpha * ACTIVE_LAYER_ALPHA_FACTOR : alpha
  return hexToRgba(layer.color, effectiveAlpha)
}

function getLayerKind(layerId: string): LayerKind | null {
  return layers.value.find((layer) => layer.id === layerId)?.kind ?? null
}

function getPolylineStrokeDasharray(layerId: string) {
  void layerId
  return undefined
}

function getPolylineStroke(layerId: string) {
  return getLayerColor(layerId, 1)
}

function getPolylineStrokeWidth(layerId: string, isSelected = false) {
  const selectedScale = 1.52
  const MIN_STROKE_WORLD = 0.1 // minimum stroke width in world units (meters)
  const base = 1.05
  const vectorEffect = getPolylineVectorEffect(layerId)
  const desired = isSelected ? base * selectedScale : base
  if (vectorEffect === 'non-scaling-stroke') {
    const minPx = MIN_STROKE_WORLD * Math.max(1e-6, renderScale.value)
    return Math.max(desired, minPx)
  }
  return Math.max(desired, MIN_STROKE_WORLD)
}

function getPolylineHitRadiusWorld(line: PlanningPolyline, isSelected = false): number {
  const strokeWidthWorld = getPolylineVisibleStrokeWidthWorld(line.layerId, isSelected)
  const extraPx = 5
  const extraWorld = pxToWorld(extraPx)
  return Math.max(0.0001, strokeWidthWorld / 2 + extraWorld)
}

function getPolylineStrokeLinejoin(line: PlanningPolyline): 'round' | 'inherit' | 'miter' | 'bevel' | undefined {
  void line
  return undefined
}

function getPolylineVisibleStrokeWidthWorld(layerId: string, isSelected = false) {
  const width = getPolylineStrokeWidth(layerId, isSelected)
  const vectorEffect = getPolylineVectorEffect(layerId)
  if (vectorEffect === 'non-scaling-stroke') {
    // When non-scaling-stroke is used, the stroke thickness stays constant in screen space.
    // Convert that thickness to world units for hit-testing.
    return width / Math.max(1e-6, renderScale.value)
  }
  return width
}

function isClickOnVisiblePolylineSegment(
  line: PlanningPolyline,
  segmentIndex: number,
  world: PlanningPoint,
  isSelected = false,
) {
  const segments = getLineSegments(line)
  const segment = segments[segmentIndex]
  if (!segment) {
    return false
  }
  const strokeWidthWorld = getPolylineVisibleStrokeWidthWorld(line.layerId, isSelected)
  const half = Math.max(0.0001, strokeWidthWorld / 2)
  const distSq = distancePointToSegmentSquared(world, segment.start, segment.end)
  return distSq <= half * half
}

function getPolylineVectorEffect(layerId: string) {
  void layerId
  return 'non-scaling-stroke'
}

function canEditPolylineGeometry(layerId: string): boolean {
  const kind = getLayerKind(layerId as string)
  return kind !== 'guide-route' || currentTool.value === 'line'
}

const activeVertexHighlight = computed(() => {
  const state = dragState.value
  if (state.type === 'drag-vertex') {
    if (state.feature === 'polygon') {
      const polygon = polygons.value.find((item) => item.id === state.targetId)
      const point = polygon?.points[state.vertexIndex]
      if (polygon && point) {
        return { x: point.x, y: point.y, layerId: polygon.layerId, r: vertexHighlightRadiusWorld.value }
      }
      return null
    }
    const line = polylines.value.find((item) => item.id === state.targetId)
    const point = line?.points[state.vertexIndex]
    if (line && point) {
      return { x: point.x, y: point.y, layerId: line.layerId, r: vertexHighlightRadiusWorld.value }
    }
    return null
  }

  if (state.type === 'rectangle') {
    return { x: state.current.x, y: state.current.y, layerId: state.layerId, r: vertexHighlightRadiusWorld.value }
  }

  if (currentTool.value === 'lasso' && polygonDraftPoints.value.length) {
    const point = polygonDraftPoints.value[polygonDraftPoints.value.length - 1]
    if (!point) return null
    return { x: point.x, y: point.y, layerId: activeLayerId.value, r: vertexHighlightRadiusWorld.value }
  }

  if (currentTool.value === 'line') {
    const line = getDraftLine()
    const anchor = getDraftAnchorPoint(line, lineDraft.value)
    if (anchor) {
      return {
        x: anchor.x,
        y: anchor.y,
        layerId: lineDraft.value?.layerId ?? activeLayerId.value,
        r: vertexHighlightRadiusWorld.value,
      }
    }
  }

  return null
})

const selectedVertexHighlight = computed(() => {
  // While drawing, the "selected" vertex should follow the last draft point.
  if (currentTool.value === 'line') {
    const line = getDraftLine()
    const anchor = getDraftAnchorPoint(line, lineDraft.value)
    if (anchor) {
      return {
        x: anchor.x,
        y: anchor.y,
        layerId: lineDraft.value?.layerId ?? activeLayerId.value,
        r: vertexHighlightRadiusWorld.value,
      }
    }
  }

  const selection = selectedVertex.value
  if (!selection) {
    return null
  }
  if (selection.feature === 'polygon') {
    const polygon = polygons.value.find((item) => item.id === selection.targetId)
    const point = polygon?.points[selection.vertexIndex]
    if (polygon && point) {
      return { x: point.x, y: point.y, layerId: polygon.layerId, r: vertexHighlightRadiusWorld.value }
    }
    return null
  }
  const line = polylines.value.find((item) => item.id === selection.targetId)
  const point = line?.points[selection.vertexIndex]
  if (line && point) {
    return { x: point.x, y: point.y, layerId: line.layerId, r: vertexHighlightRadiusWorld.value }
  }
  return null
})

function isActiveLayer(layerId: string | null | undefined) {
  if (!layerId || layerId !== activeLayerId.value) return false
  const layer = layers.value.find((l) => l.id === layerId)
  if (!layer) return false
  // Treat locked layers as inactive for canvas interactions so shapes cannot be
  // selected/moved/scaled on the canvas, while still allowing property-panel edits.
  return !layer.locked
}

function getFeatureLayerId(feature: SelectedFeature | null): string | null {
  if (!feature) {
    return null
  }
  if (feature.type === 'polygon') {
    return polygons.value.find((item) => item.id === feature.id)?.layerId ?? null
  }
  if (feature.type === 'polyline') {
    return polylines.value.find((item) => item.id === feature.id)?.layerId ?? null
  }
  if (feature.type === 'segment') {
    return polylines.value.find((item) => item.id === feature.lineId)?.layerId ?? null
  }
  return null
}

function ensureSelectionWithinActiveLayer() {
  const feature = selectedFeature.value
  if (!feature) {
    selectedVertex.value = null
    return
  }
  const layerId = getFeatureLayerId(feature)
  if (!layerId || !isActiveLayer(layerId)) {
    selectedFeature.value = null
    selectedVertex.value = null
  }
}

function isSelectedVertexHandle(feature: 'polygon' | 'polyline', targetId: string, vertexIndex: number) {
  const selection = selectedVertex.value
  return !!selection && selection.feature === feature && selection.targetId === targetId && selection.vertexIndex === vertexIndex
}

function getEndpointFillColor(layerId: string) {
  // Endpoint is considered "selectable" when it's in the active, editable layer.
  const selectable = isActiveLayer(layerId) && canEditPolylineGeometry(layerId)
  if (selectable) {
    // Light-blue fill for selectable endpoints
    return 'rgba(126,200,255,0.95)'
  }
  // Muted fill for non-selectable endpoints
  return hexToRgba(getLayerColor(layerId), 0.55)
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace('#', '')
  const bigint = Number.parseInt(normalized, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function createId(prefix: string) {
  return `${prefix}-${generateUuid().slice(0, 8)}`
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value)
}

// Planning features (polygons/polylines) are converted to scene nodes.
// Their ids must follow the same UUID rule as scene node ids so that conversion
// can re-use nodes by id without collisions.
function createPlanningFeatureId(): string {
  return generateUuid()
}

function normalizePlanningFeatureId(raw: unknown, used: Set<string>): string {
  const candidate = typeof raw === 'string' ? raw.trim() : ''
  if (isUuidV4(candidate) && !used.has(candidate)) {
    used.add(candidate)
    return candidate
  }
  let next = generateUuid()
  while (used.has(next)) {
    next = generateUuid()
  }
  used.add(next)
  return next
}

function getDefaultLayerColor(kind: LayerKind): string {
  return layerPresets.find((l) => l.kind === kind)?.color ?? '#ffffff'
}

function nextLayerNumber(kind: LayerKind): number {
  const base = layerKindLabels[kind]
  let max = 0
  layers.value.forEach((layer) => {
    if (layer.kind !== kind) return
    const match = new RegExp(`^${base}\\s*(\\d+)$`, 'i').exec(layer.name.trim())
    const num = match ? Number(match[1]) : NaN
    if (Number.isFinite(num)) {
      max = Math.max(max, num)
    }
  })
  return max + 1
}

function addPlanningLayer(kind: LayerKind) {
  const label = layerKindLabels[kind]
  const number = nextLayerNumber(kind)
  const id = createId(`${kind}-layer`)
  const layer: PlanningLayer = {
    id,
    name: `${label} ${number}`,
    kind,
    visible: true,
    color: getDefaultLayerColor(kind),
    locked: false,
    conversionEnabled: true,
  }

  // Newly created layers are placed on top (earlier in list)
  layers.value = [layer, ...layers.value]
  activeLayerId.value = id
  addLayerMenuOpen.value = false
  markPlanningDirty()
}

function handleLayerDelete(layerId: string) {
  if (layers.value.length <= 1) return

  polygons.value = polygons.value.filter((poly) => poly.layerId !== layerId)
  polylines.value = polylines.value.filter((line) => line.layerId !== layerId)

  const removedActive = activeLayerId.value === layerId
  layers.value = layers.value.filter((l) => l.id !== layerId)

  if (selectedFeature.value && getFeatureLayerId(selectedFeature.value) === layerId) {
    selectedFeature.value = null
  }

  if (removedActive) {
    activeLayerId.value = layers.value[0]?.id ?? ''
  }
  markPlanningDirty()
  // Persist layer removal so scene updates (e.g. terrain cleared) immediately
  persistPlanningToSceneIfDirty({ force: true })
}

function setRenameFieldRef(layerId: string, el: unknown) {
  if (!el) {
    renameFieldElByLayerId.delete(layerId)
    return
  }
  if (el instanceof HTMLElement) {
    renameFieldElByLayerId.set(layerId, el)
    return
  }
  if (typeof el === 'object' && el !== null && '$el' in el) {
    const componentRoot = (el as { $el?: unknown }).$el
    if (componentRoot instanceof HTMLElement) {
      renameFieldElByLayerId.set(layerId, componentRoot)
    }
  }
}

async function beginLayerRename(layerId: string) {
  const layer = layers.value.find((l) => l.id === layerId)
  if (!layer) return
  renamingLayerId.value = layerId
  renamingLayerDraft.value = layer.name
  await nextTick()
  const root = renameFieldElByLayerId.get(layerId)
  const input = root?.querySelector('input') as HTMLInputElement | null
  if (input) {
    input.focus()
    input.select()
  }
}

function cancelLayerRename() {
  renamingLayerId.value = null
  renamingLayerDraft.value = ''
}

function commitLayerRename(layerId: string) {
  const layer = layers.value.find((l) => l.id === layerId)
  if (!layer) {
    cancelLayerRename()
    return
  }
  const nextName = renamingLayerDraft.value.trim()
  if (nextName) {
    layer.name = nextName
    enableLayerConversion(layerId)
    markPlanningDirty()
  }
  cancelLayerRename()
}

function reorderPlanningLayersByListOrder(fromId: string, toId: string) {
  const fromIndex = layers.value.findIndex((l) => l.id === fromId)
  const toIndex = layers.value.findIndex((l) => l.id === toId)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return
  }
  const nextList = [...layers.value]
  const [item] = nextList.splice(fromIndex, 1)
  if (!item) return
  nextList.splice(toIndex, 0, item)
  layers.value = nextList
  markPlanningDirty()
}

function handleLayerItemDragStart(layerId: string, event: DragEvent) {
  event.stopPropagation()
  if (!event.dataTransfer) return
  draggingLayerId.value = layerId
  dragOverLayerId.value = null
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/x-harmony-planning-layer-id', layerId)
}

function handleLayerItemDragOver(overLayerId: string, event: DragEvent) {
  event.preventDefault()
  const draggedId = event.dataTransfer?.getData('text/x-harmony-planning-layer-id')
  if (!draggedId || draggedId === overLayerId) {
    dragOverLayerId.value = null
    return
  }
  dragOverLayerId.value = overLayerId
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function handleLayerItemDrop(targetLayerId: string, event: DragEvent) {
  event.preventDefault()
  const draggedId = event.dataTransfer?.getData('text/x-harmony-planning-layer-id')
  if (!draggedId) return
  event.stopPropagation()
  reorderPlanningLayersByListOrder(draggedId, targetLayerId)
  draggingLayerId.value = null
  dragOverLayerId.value = null
}

function handleLayerItemDragEnd() {
  draggingLayerId.value = null
  dragOverLayerId.value = null
}

function clonePoint(point: PlanningPoint): PlanningPoint {
  return { x: Number(point.x.toFixed(2)), y: Number(point.y.toFixed(2)) }
}

function createVertexPoint(point: PlanningPoint): PlanningPoint {
  return {
    id: createId('v'),
    x: Number(point.x.toFixed(2)),
    y: Number(point.y.toFixed(2)),
  }
}

function getImageRect(image: PlanningImage) {
  return {
    x: image.position.x,
    y: image.position.y,
    w: image.width * image.scale,
    h: image.height * image.scale,
  }
}

function getAlignMarkerWorld(image: PlanningImage) {
  if (!image.alignMarker) {
    return null
  }
  return {
    x: image.position.x + image.alignMarker.x * image.scale,
    y: image.position.y + image.alignMarker.y * image.scale,
  }
}

function setAlignMarkerAtWorld(image: PlanningImage, world: PlanningPoint) {
  image.alignMarker = {
    x: (world.x - image.position.x) / image.scale,
    y: (world.y - image.position.y) / image.scale,
  }
  markPlanningDirty()
}

function getImageAccentColor(imageId: string): string {
  // Color must remain stable after layer creation and not change with list reordering/top placement.
  // Therefore use a stable hash of imageId to pick a palette color.
  let hash = 0
  for (let i = 0; i < imageId.length; i += 1) {
    hash = (hash * 31 + imageId.charCodeAt(i)) | 0
  }
  const paletteIndex = Math.abs(hash) % imageAccentPalette.length
  return (imageAccentPalette[paletteIndex] ?? imageAccentPalette[0])!
}

function getAlignMarkerStyle(image: PlanningImage): CSSProperties {
  if (!image.visible) {
    return { display: 'none' }
  }
  const world = getAlignMarkerWorld(image)
  if (!world) {
    return { display: 'none' }
  }
  const accent = getImageAccentColor(image.id)
  return {
    left: `${world.x * BASE_PIXELS_PER_METER}px`,
    top: `${world.y * BASE_PIXELS_PER_METER}px`,
    zIndex: 10000,
    background: accent,
    boxShadow: `0 0 0 3px ${hexToRgba(accent, 0.22)}`,
    ...( { '--marker-accent': accent } as unknown as Record<string, string> ),
  }
}

function getGuidesOverlayStyle(): CSSProperties {
  const base = effectiveCanvasPixelSize.value
  return {
    width: `${base.width}px`,
    height: `${base.height}px`,
  }
}

function getGuideLineStyle(guide: PlanningGuide): CSSProperties {
  const base = effectiveCanvasPixelSize.value
  if (guide.axis === 'x') {
    return {
      left: `${guide.value * BASE_PIXELS_PER_METER}px`,
      top: '0px',
      height: `${base.height}px`,
    }
  }
  return {
    left: '0px',
    top: `${guide.value * BASE_PIXELS_PER_METER}px`,
    width: `${base.width}px`,
  }
}

function getImageLayerStyle(image: PlanningImage, zIndex: number): CSSProperties {
  const accent = getImageAccentColor(image.id)
  return {
    transform: `translate(${image.position.x * BASE_PIXELS_PER_METER}px, ${image.position.y * BASE_PIXELS_PER_METER}px) scale(${image.scale * BASE_PIXELS_PER_METER})`,
    transformOrigin: 'top left',
    width: `${image.width}px`,
    height: `${image.height}px`,
    opacity: image.visible ? image.opacity : 0,
    zIndex: zIndex + 1,
    pointerEvents: image.visible ? 'auto' : 'none',
    willChange: 'transform',
    backgroundColor: hexToRgba(accent, 0.06),
    cursor:
      image.visible && !image.locked && currentTool.value === 'pan'
        ? 'grab'
        : 'default',
  }
}

function getImageLayerListItemStyle(imageId: string): CSSProperties {
  const accent = getImageAccentColor(imageId)
  const isActive = activeImageId.value === imageId
  const bgAlpha = isActive ? 0.32 : 0.06
  const borderAlpha = isActive ? 1 : 0.9
  const accentWidth = isActive ? 8 : 4
  return {
    backgroundColor: hexToRgba(accent, bgAlpha),
    borderLeft: `${accentWidth}px solid ${hexToRgba(accent, borderAlpha)}`,
    borderColor: hexToRgba(accent, isActive ? 0.85 : 0.12),
    boxShadow: isActive
      ? `0 0 0 2px ${hexToRgba(accent, 0.35)}, 0 0 18px ${hexToRgba(accent, 0.22)}`
      : 'none',
  }
}

function getLayerListItemStyle(layer: PlanningLayer): CSSProperties {
  const isActive = activeLayerId.value === layer.id
  const bgAlpha = isActive ? 0.32 : 0.06
  const borderAlpha = isActive ? 1 : 0.9
  const accentWidth = isActive ? 8 : 4
  return {
    backgroundColor: hexToRgba(layer.color, bgAlpha),
    borderLeft: `${accentWidth}px solid ${hexToRgba(layer.color, borderAlpha)}`,
    borderColor: hexToRgba(layer.color, isActive ? 0.85 : 0.12),
    boxShadow: isActive
      ? `0 0 0 2px ${hexToRgba(layer.color, 0.35)}, 0 0 18px ${hexToRgba(layer.color, 0.22)}`
      : 'none',
  }
}

function clonePoints(points: PlanningPoint[]) {
  return points.map((point) => clonePoint(point))
}

function createRectanglePoints(start: PlanningPoint, end: PlanningPoint) {
  const minX = Math.min(start.x, end.x)
  const maxX = Math.max(start.x, end.x)
  const minY = Math.min(start.y, end.y)
  const maxY = Math.max(start.y, end.y)
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ]
}

function getPolylinePath(points: PlanningPoint[]) {
  if (!points.length) {
    return ''
  }
  const segments = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
  return segments.join(' ')
}

function isPointInPolygon(point: PlanningPoint, polygonPoints: PlanningPoint[]) {
  // Use nonzero winding rule to match SVG's default fill-rule.
  // This avoids preview dots showing up in visually "unfilled" regions for self-intersecting/mixed-winding polygons.
  let windingNumber = 0
  const n = polygonPoints.length
  if (n < 3) {
    return false
  }

  for (let i = 0; i < n; i += 1) {
    const a = polygonPoints[i]
    const b = polygonPoints[(i + 1) % n]
    if (!a || !b) {
      continue
    }

    const isLeft = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y)
    if (a.y <= point.y) {
      if (b.y > point.y && isLeft > 0) {
        windingNumber += 1
      }
    } else {
      if (b.y <= point.y && isLeft < 0) {
        windingNumber -= 1
      }
    }
  }

  return windingNumber !== 0
}

function distancePointToSegmentSquared(point: PlanningPoint, start: PlanningPoint, end: PlanningPoint) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (dx === 0 && dy === 0) {
    const distX = point.x - start.x
    const distY = point.y - start.y
    return distX * distX + distY * distY
  }
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)
  const clampedT = Math.max(0, Math.min(1, t))
  const projX = start.x + clampedT * dx
  const projY = start.y + clampedT * dy
  const distX = point.x - projX
  const distY = point.y - projY
  return distX * distX + distY * distY
}

function distancePointToPointSquared(a: PlanningPoint, b: PlanningPoint) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

// findNearbyPolylineVertexInLayer removed (unused)

function findNearbyPolylineEndpointInLayer(world: PlanningPoint, layerId: string, radiusPx = LINE_VERTEX_SNAP_RADIUS_PX) {
  const radiusWorld = pxToWorld(radiusPx)
  const radiusSq = radiusWorld * radiusWorld
  for (let i = polylines.value.length - 1; i >= 0; i -= 1) {
    const line = polylines.value[i]
    if (!line) {
      continue
    }
    if (line.layerId !== layerId) {
      continue
    }
    if (!visibleLayerIds.value.has(line.layerId)) {
      continue
    }
    const first = line.points[0]
    if (first && distancePointToPointSquared(world, first) <= radiusSq) {
      return { line, point: first, vertexIndex: 0 }
    }
    const lastIndex = line.points.length - 1
    const last = lastIndex >= 0 ? line.points[lastIndex] : undefined
    if (last && distancePointToPointSquared(world, last) <= radiusSq) {
      return { line, point: last, vertexIndex: lastIndex }
    }
  }
  return null
}

function hitTestPolygon(point: PlanningPoint): PlanningPolygon | null {
  for (let i = polygons.value.length - 1; i >= 0; i -= 1) {
    const polygon = polygons.value[i]
    if (!polygon) {
      continue
    }
    if (!visibleLayerIds.value.has(polygon.layerId)) {
      continue
    }
    if (isPointInPolygon(point, polygon.points)) {
      return polygon
    }
  }
  return null
}

function hitTestPolyline(point: PlanningPoint): PlanningPolyline | null {
  for (let i = polylines.value.length - 1; i >= 0; i -= 1) {
    const line = polylines.value[i]
    if (!line) {
      continue
    }
    if (!visibleLayerIds.value.has(line.layerId)) {
      continue
    }
    const radius = getPolylineHitRadiusWorld(line, selectedFeature.value?.type === 'polyline' && selectedFeature.value.id === line.id)
    const radiusSq = radius * radius
    const segments = getLineSegments(line)
    for (const segment of segments) {
      const distSq = distancePointToSegmentSquared(point, segment.start, segment.end)
      if (distSq <= radiusSq) {
        return line
      }
    }
  }
  return null
}

function pickTopmostActivePolygon(point: PlanningPoint): PlanningPolygon | null {
  for (let i = polygons.value.length - 1; i >= 0; i -= 1) {
    const polygon = polygons.value[i]
    if (!polygon) {
      continue
    }
    if (!visibleLayerIds.value.has(polygon.layerId)) {
      continue
    }
    if (!isActiveLayer(polygon.layerId)) {
      continue
    }
    if (isPointInPolygon(point, polygon.points)) {
      return polygon
    }
  }
  return null
}

function pickTopmostActivePolyline(point: PlanningPoint): { line: PlanningPolyline; segmentIndex: number } | null {
  for (let i = polylines.value.length - 1; i >= 0; i -= 1) {
    const line = polylines.value[i]
    if (!line) {
      continue
    }
    if (!visibleLayerIds.value.has(line.layerId)) {
      continue
    }
    if (!isActiveLayer(line.layerId)) {
      continue
    }
    const radius = getPolylineHitRadiusWorld(line, selectedFeature.value?.type === 'polyline' && selectedFeature.value.id === line.id)
    const radiusSq = radius * radius
    const segments = getLineSegments(line)
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]
      if (!segment) {
        continue
      }
      const distSq = distancePointToSegmentSquared(point, segment.start, segment.end)
      if (distSq <= radiusSq) {
        return { line, segmentIndex: index }
      }
    }
  }
  return null
}

function screenToWorld(event: MouseEvent | PointerEvent): PlanningPoint {
  return clientToWorld(event.clientX, event.clientY)
}

function clientToWorld(clientX: number, clientY: number): PlanningPoint {
  // Use the real-time DOMRect to avoid drawing/selection coordinate mismatch due to stale cached rect.
  const rect = editorRef.value?.getBoundingClientRect()
  if (!rect) {
    return { x: 0, y: 0 }
  }
  const scale = renderScale.value
  const center = computeStageCenterOffset(rect, scale)
  const x = (clientX - rect.left - center.x) / scale - viewTransform.offset.x
  const y = (clientY - rect.top - center.y) / scale - viewTransform.offset.y
  return { x, y }
}

function hitTestImage(point: PlanningPoint) {
  for (let i = planningImages.value.length - 1; i >= 0; i -= 1) {
    const image = planningImages.value[i]
    if (!image) {
      continue
    }
    if (!image.visible) {
      continue
    }
    const rect = getImageRect(image)
    const insideX = point.x >= rect.x && point.x <= rect.x + rect.w
    const insideY = point.y >= rect.y && point.y <= rect.y + rect.h
    if (insideX && insideY) {
      return image
    }
  }
  return null
}

function isPointInsideCanvas(point: PlanningPoint) {
  const size = effectiveCanvasSize.value
  return point.x >= 0 && point.x <= size.width && point.y >= 0 && point.y <= size.height
}

function alignImageLayersByMarkers() {
  const markedVisible = planningImages.value.filter((img) => img.visible && img.alignMarker)
  if (!markedVisible.length) {
    return
  }
  const active = activeImageId.value
    ? markedVisible.find((img) => img.id === activeImageId.value)
    : null
  const reference = active ?? markedVisible[0]
  if (!reference) {
    return
  }
  const refWorld = getAlignMarkerWorld(reference)
  if (!refWorld) {
    return
  }
  markedVisible.forEach((img) => {
    if (img.id === reference.id) {
      return
    }
    if (img.locked) {
      return
    }
    const world = getAlignMarkerWorld(img)
    if (!world) {
      return
    }
    img.position.x += refWorld.x - world.x
    img.position.y += refWorld.y - world.y
  })
}

function toggleAlignMode() {
  alignModeActive.value = !alignModeActive.value
  if (alignModeActive.value) {
    alignImageLayersByMarkers()
  }
}

function handleAlignMarkerPointerDown(imageId: string, event: PointerEvent) {
  if (tryBeginRightPan(event)) {
    return
  }
  if (event.button !== 0) {
    return
  }
  event.stopPropagation()
  event.preventDefault()
  const image = planningImages.value.find((img) => img.id === imageId)
  if (!image || !image.visible) {
    return
  }
  activeImageId.value = imageId
  frozenCanvasSize.value = { ...canvasSize.value }
  dragState.value = {
    type: 'move-align-marker',
    pointerId: event.pointerId,
    imageId,
  }
  event.currentTarget instanceof Element && event.currentTarget.setPointerCapture(event.pointerId)
}

function startRectangleDrag(worldPoint: PlanningPoint, event: PointerEvent) {
  dragState.value = {
    type: 'rectangle',
    pointerId: event.pointerId,
    start: worldPoint,
    current: worldPoint,
    layerId: activeLayer.value?.id ?? layers.value[0]?.id ?? 'terrain-layer',
  }
  event.currentTarget instanceof Element && event.currentTarget.setPointerCapture(event.pointerId)
}
function finalizeRectangleDrag() {
  if (dragState.value.type !== 'rectangle') {
    return
  }
  const { start, current, layerId } = dragState.value
  dragState.value = { type: 'idle' }
  const width = Math.abs(current.x - start.x)
  const height = Math.abs(current.y - start.y)
  if (width < 3 || height < 3) {
    return
  }
  const points = createRectanglePoints(start, current)
  addPolygon(points, layerId, 'Rectangular Area')
  markPlanningDirty()
}

function addPolygon(points: PlanningPoint[], layerId?: string, labelPrefix?: string) {
  if (points.length < 3) {
    return
  }
  const targetLayerId = layerId ?? activeLayer.value?.id ?? layers.value[0]?.id ?? 'terrain-layer'
  const targetKind = getLayerKind(targetLayerId)
  const newId = createPlanningFeatureId()
  const newName = `${labelPrefix ?? getLayerName(targetLayerId)} ${polygonCounter.value++}`
  polygons.value.push({
    id: newId,
    name: newName,
    layerId: targetLayerId,
    points: clonePoints(points),
    terrainHeightMeters: targetKind === 'terrain' ? 0 : undefined,
    terrainBlendMeters: targetKind === 'terrain' ? 2 : undefined,
    terrainWaterPresetId: targetKind === 'terrain' ? null : undefined,
  })

  enableLayerConversion(targetLayerId)

  // Select the newly created polygon so its properties appear immediately
  selectFeature({ type: 'polygon', id: newId })
}

function addPolygonDraftPoint(point: PlanningPoint) {
  const next = clonePoint(point)
  const last = polygonDraftPoints.value.length
    ? polygonDraftPoints.value[polygonDraftPoints.value.length - 1]
    : undefined
  if (last && last.x === next.x && last.y === next.y) {
    return
  }
  polygonDraftPoints.value = [...polygonDraftPoints.value, next]
  polygonDraftHoverPoint.value = next
}

function finalizePolygonDraft() {
  if (polygonDraftPoints.value.length < 3) {
    polygonDraftPoints.value = []
    polygonDraftHoverPoint.value = null
    return
  }
  addPolygon(polygonDraftPoints.value, undefined, 'Planned Area')
  polygonDraftPoints.value = []
  polygonDraftHoverPoint.value = null
  markPlanningDirty()
}

const polygonDraftPreview = computed(() => {
  const pts = polygonDraftPoints.value
  if (pts.length < 1) {
    return { d: '', fill: 'transparent' }
  }
  const hover = polygonDraftHoverPoint.value
  if (!hover) {
    return { d: '', fill: 'transparent' }
  }

  // Show preview immediately after first click: use [first point, mouse point] to form a visible closing segment.
  const previewPoints = pts.length === 1 ? [pts[0]!, hover] : [...pts, hover]
  const fill = previewPoints.length >= 3 ? 'rgba(98, 179, 255, 0.08)' : 'transparent'
  const smoothing = getLayerSmoothingValue(activeLayerId.value)
  return { d: getPolygonPath(previewPoints, smoothing), fill }
})

function startLineDraft(point: PlanningPoint) {
  if (!canUseLineTool.value) {
    return
  }

  const pendingSelectedVertex = selectedVertex.value
  if (!lineDraft.value && pendingSelectedVertex?.feature === 'polyline') {
    const sourceLine = polylines.value.find((item) => item.id === pendingSelectedVertex.targetId)
    const sourcePoint = sourceLine?.points[pendingSelectedVertex.vertexIndex]
    if (sourceLine && sourcePoint) {
      const sourceKind = getLayerKind(sourceLine.layerId)
      if (sourceKind === 'guide-route') {
        const isEndpoint = pendingSelectedVertex.vertexIndex === 0 || pendingSelectedVertex.vertexIndex === sourceLine.points.length - 1
        if (!isEndpoint) {
          // Guide-route disallows branching: only allow extending an existing polyline from its endpoints.
          return
        }
        // Treat "selected endpoint -> click somewhere" as a continuation (extend the same polyline),
        // instead of creating a new polyline segment anchored on the selected vertex.
        startLineContinuation(sourceLine.id, pendingSelectedVertex.vertexIndex)
      } else {
        const reuse = findNearbyPolylineEndpointInLayer(point, sourceLine.layerId, ENDPOINT_MERGE_RADIUS_PX)
        const reusePoint = reuse?.point

        const newPoint = reusePoint ?? createVertexPoint(point)
        if (newPoint === sourcePoint) {
          return
        }
        const newLine: PlanningPolyline = {
          id: createPlanningFeatureId(),
          name: `${getLayerName(sourceLine.layerId)} Segment ${lineCounter.value++}`,
          layerId: sourceLine.layerId,
          points: [sourcePoint, newPoint],
        }
        polylines.value = [...polylines.value, newLine]
        activeLayerId.value = sourceLine.layerId
        selectFeature({ type: 'polyline', id: newLine.id })
        selectedVertex.value = { feature: 'polyline', targetId: newLine.id, vertexIndex: 1 }
        lineDraft.value = { lineId: newLine.id, layerId: sourceLine.layerId }
        lineDraftHoverPoint.value = null
        pendingLineHoverClient = null
        enableLayerConversion(sourceLine.layerId)
        markPlanningDirty()
        return
      }
    }
  }

  const targetLayerId = lineDraft.value?.layerId ?? activeLayer.value?.id ?? layers.value[0]?.id ?? 'terrain-layer'
  const targetKind = getLayerKind(targetLayerId)
  // Guide-route disallows shared endpoints (no branching). Do not reuse endpoints across polylines.
  const reuse = targetKind === 'guide-route'
    ? null
    : findNearbyPolylineEndpointInLayer(point, targetLayerId, ENDPOINT_MERGE_RADIUS_PX)
  const reusePoint = reuse?.point

  const nextPoint = reusePoint ?? createVertexPoint(point)
  const draftLine = getDraftLine()
  if (!draftLine) {
    const newLine: PlanningPolyline = {
      id: createPlanningFeatureId(),
      name: `${getLayerName(targetLayerId)} Segment ${lineCounter.value++}`,
      layerId: targetLayerId,
      points: [nextPoint],
      waypoints: targetKind === 'guide-route' ? [{ name: 'Point 1', dock: false }] : undefined,
    }
    polylines.value = [...polylines.value, newLine]
    lineDraft.value = { lineId: newLine.id, layerId: targetLayerId }
    lineDraftHoverPoint.value = null
    pendingLineHoverClient = null
    enableLayerConversion(targetLayerId)
    markPlanningDirty()
    return
  }

  const anchor = getDraftAnchorPoint(draftLine, lineDraft.value)
  if (anchor) {
    const samePoint = anchor.id && nextPoint.id && anchor.id === nextPoint.id
    const samePosition = anchor.x === nextPoint.x && anchor.y === nextPoint.y
    if (samePoint || samePosition) {
      return
    }
  }

  const isGuideRoute = getLayerKind(draftLine.layerId) === 'guide-route'
  if (isGuideRoute) {
    ensureGuideRouteWaypoints(draftLine)
  }

  if (lineDraft.value?.continuation?.direction === 'prepend') {
    draftLine.points.unshift(nextPoint)
    if (isGuideRoute) {
      draftLine.waypoints!.unshift({ name: 'Point 1', dock: false })
    }
  } else {
    draftLine.points.push(nextPoint)
    if (isGuideRoute) {
      draftLine.waypoints!.push({ name: `Point ${draftLine.waypoints!.length + 1}`, dock: false })
    }
  }
  lineDraftHoverPoint.value = null
  pendingLineHoverClient = null
  enableLayerConversion(draftLine.layerId)
  markPlanningDirty()
}

function beginLineDraftFromPoint(point: PlanningPoint, layerId: string) {
  if (!canUseLineTool.value) {
    return
  }
  if (lineDraft.value) {
    return
  }

  activeLayerId.value = layerId
  const targetKind = getLayerKind(layerId)
  const newLine: PlanningPolyline = {
    id: createPlanningFeatureId(),
    name: `${getLayerName(layerId)} Segment ${lineCounter.value++}`,
    layerId,
    points: [point],
    waypoints: targetKind === 'guide-route' ? [{ name: 'Point 1', dock: false }] : undefined,
  }
  polylines.value = [...polylines.value, newLine]
  lineDraft.value = { lineId: newLine.id, layerId }
  lineDraftHoverPoint.value = null
  pendingLineHoverClient = null
  selectFeature({ type: 'polyline', id: newLine.id })
  selectedVertex.value = { feature: 'polyline', targetId: newLine.id, vertexIndex: 0 }
  enableLayerConversion(layerId)
  markPlanningDirty()
}

function finalizeLineDraft() {
  const draft = lineDraft.value
  if (!draft) {
    return
  }
  const line = getDraftLine()
  if (!line) {
    clearLineDraft({ keepLine: false })
    return
  }
  if (line.points.length < 2) {
    polylines.value = polylines.value.filter((item) => item.id !== line.id)
    clearLineDraft({ keepLine: true })
    return
  }
  if (getLayerKind(line.layerId) === 'guide-route') {
    ensureGuideRouteWaypoints(line)
  }
  selectFeature({ type: 'polyline', id: line.id })
  clearLineDraft({ keepLine: true })

  // After finishing a road edit, normalize intersections + merge into component polylines.
  normalizeRoadLayerIfNeeded(line.layerId)

  markPlanningDirty()
}

const lineDraftPreviewPath = computed(() => {
  const draft = lineDraft.value
  const line = getDraftLine()
  const hover = lineDraftHoverPoint.value
  if (!draft || !line || !hover) {
    return ''
  }
  const anchor = getDraftAnchorPoint(line, draft)
  if (!anchor) {
    return ''
  }
  return `M ${anchor.x} ${anchor.y} L ${hover.x} ${hover.y}`
})

const lineDraftPreviewStroke = computed(() => {
  // Use a high-contrast, fully opaque preview color for drawing (no transparency)
  // Bright yellow chosen for contrast against dark/light backgrounds.
  return 'rgba(255, 196, 0, 1)'
})

const lineDraftPreviewDasharray = computed(() => {
  const layerId = lineDraft.value?.layerId ?? activeLayerId.value
  return getPolylineStrokeDasharray(layerId as string)
})

const lineDraftPreviewStrokeWidth = computed(() => {
  const layerId = lineDraft.value?.layerId ?? activeLayerId.value
  return getPolylineStrokeWidth(layerId as string)
})

const lineDraftPreviewVectorEffect = computed(() => {
  const layerId = lineDraft.value?.layerId ?? activeLayerId.value
  return getPolylineVectorEffect(layerId as string)
})

const lineDraftPoints = computed(() => getDraftLine()?.points ?? [])

function selectFeature(feature: SelectedFeature) {
  if (!feature) {
    selectedFeature.value = null
    selectedVertex.value = null
    return
  }
  const layerId = getFeatureLayerId(feature)
  if (!layerId || !isActiveLayer(layerId)) {
    selectedFeature.value = null
    selectedVertex.value = null
    return
  }
  selectedFeature.value = feature

  if (!selectedVertex.value) {
    return
  }
  const keepSelectedVertex =
    (feature.type === 'polygon'
      && selectedVertex.value.feature === 'polygon'
      && selectedVertex.value.targetId === feature.id)
    || (feature.type === 'polyline'
      && selectedVertex.value.feature === 'polyline'
      && selectedVertex.value.targetId === feature.id)
    || (feature.type === 'segment'
      && selectedVertex.value.feature === 'polyline'
      && selectedVertex.value.targetId === feature.lineId)

  if (!keepSelectedVertex) {
    selectedVertex.value = null
  }
}

function deleteSelectedFeature() {
  const feature = selectedFeature.value
  if (!feature) {
    return
  }
  const layerIdBefore = getFeatureLayerId(feature)
  if (feature.type === 'polygon') {
    polygons.value = polygons.value.filter((item) => item.id !== feature.id)
    selectedFeature.value = null
    selectedVertex.value = null
    enableLayerConversion(layerIdBefore)
    markPlanningDirty()
    // Persist immediately so scene updates (e.g. clearing planning terrain) take effect
    persistPlanningToSceneIfDirty({ force: true })
    return
  }

  if (feature.type === 'polyline') {
    polylines.value = polylines.value.filter((item) => item.id !== feature.id)
    selectedFeature.value = null
    selectedVertex.value = null
    enableLayerConversion(layerIdBefore)
    markPlanningDirty()
    persistPlanningToSceneIfDirty({ force: true })
    return
  }
  const line = polylines.value.find((item) => item.id === feature.lineId)
  if (!line) {
    selectedFeature.value = null
    return
  }
  if (line.points.length <= 2) {
    polylines.value = polylines.value.filter((item) => item.id !== feature.lineId)
    selectedFeature.value = null
    selectedVertex.value = null
    enableLayerConversion(layerIdBefore)
    markPlanningDirty()
    persistPlanningToSceneIfDirty({ force: true })
    return
  }
  const removeIndex = Math.min(feature.segmentIndex + 1, line.points.length - 1)
  line.points.splice(removeIndex, 1)
  if (getLayerKind(line.layerId) === 'guide-route' && Array.isArray(line.waypoints)) {
    line.waypoints.splice(removeIndex, 1)
  }
  selectedFeature.value = null
  selectedVertex.value = null

  // Deleting a road segment can split a component; re-normalize.
  normalizeRoadLayerIfNeeded(layerIdBefore)

  enableLayerConversion(layerIdBefore)
  markPlanningDirty()
  // Persist so the scene reflects the edit immediately
  persistPlanningToSceneIfDirty({ force: true })
}

function handleDeleteButtonClick() {
  if (!selectedFeature.value) {
    return
  }
  deleteSelectedFeature()
}

function handleToolSelect(tool: PlanningTool) {
  if (tool === 'line' && !canUseLineTool.value) {
    return
  }
  if ((tool === 'rectangle' || tool === 'lasso') && !canUseAreaTools.value) {
    return
  }
  currentTool.value = tool
}

function handleLayerConversionToggle(layerId: string, enabled: boolean) {
  setLayerConversionEnabled(layerId, enabled)
}

function handleLayerLockToggle(layerId: string) {
  const layer = layers.value.find((item) => item.id === layerId)
  if (!layer) {
    return
  }
  layer.locked = !layer.locked
  markPlanningDirty()
}

function handleLayerSelection(layerId: string) {
  activeLayerId.value = layerId
  if (currentTool.value === 'line' && !canUseLineTool.value) {
    currentTool.value = 'select'
  }
  if ((currentTool.value === 'rectangle' || currentTool.value === 'lasso') && !canUseAreaTools.value) {
    currentTool.value = 'select'
  }
  ensureSelectionWithinActiveLayer()
}

// Image property models for the property panel when an image is selected
const imageNameModel = computed({
  get: () => selectedImage.value ? selectedImage.value.name : '',
  set: (v: string) => {
    const img = selectedImage.value
    if (!img || propertyPanelDisabled.value) return
    img.name = String(v)
    markPlanningDirty()
  },
})

const imageOpacityModel = computed<number>({
  get: () => (selectedImage.value ? selectedImage.value.opacity : 1),
  set: (v: number) => {
    const img = selectedImage.value
    if (!img || propertyPanelDisabled.value) return
    img.opacity = Math.min(1, Math.max(0, Number(v)))
    markPlanningDirty()
  },
})


// clearSelectedScatterAssignment removed (unused)

function handleEditorPointerDown(event: PointerEvent) {
  if (!dialogOpen.value) {
    return
  }

  // Middle-click while drawing cancels the current draft and removes any unfinished geometry.
  if (event.button === 1) {
    const rectangleActive = dragState.value.type === 'rectangle'
    const polygonDraftActive = polygonDraftPoints.value.length > 0
    const draftLine = getDraftLine()
    const lineDraftActive = !!(draftLine && draftLine.points.length > 0)
    if (rectangleActive || polygonDraftActive || lineDraftActive) {
      event.preventDefault()
      event.stopPropagation()

      // If a pointer is captured for a drag, release it so the UI doesn't get stuck.
      const state = dragState.value
      if (state.type !== 'idle' && event.currentTarget instanceof Element) {
        try {
          event.currentTarget.releasePointerCapture(state.pointerId)
        } catch {
          // Ignore if not captured by this element.
        }
      }

      cancelActiveDrafts()
      frozenCanvasSize.value = null
      return
    }
  }

  if (tryBeginRightPan(event)) {
    return
  }

  if (event.button !== 0) {
    return
  }

  event.preventDefault()
  frozenCanvasSize.value = { ...canvasSize.value }
  const tool = getEffectiveTool()
  const world = screenToWorld(event)
  const insideCanvas = isPointInsideCanvas(world)

  // When clicking on empty canvas, clear current selection (applies to all tools).
  selectedFeature.value = null

  if (tool === 'align-marker') {
    const targetImage = activeImageId.value ? planningImages.value.find((img) => img.id === activeImageId.value) : null
    if (!targetImage || !targetImage.visible || targetImage.locked) {
      return
    }
    setAlignMarkerAtWorld(targetImage, world)
    return
  }

  if (tool === 'rectangle') {
    if (!insideCanvas) {
      frozenCanvasSize.value = null
      return
    }
    startRectangleDrag(world, event)
    return
  }

  if (tool === 'lasso') {
    if (!insideCanvas) {
      frozenCanvasSize.value = null
      return
    }
    addPolygonDraftPoint(world)
    return
  }

  if (tool === 'line') {
    if (!insideCanvas) {
      frozenCanvasSize.value = null
      return
    }
    startLineDraft(world)
    return
  }
  

  // Pan view: when using pan tool, or when dragging on empty space with select tool
  if (tool === 'pan' || tool === 'select') {
    beginPanDrag(event)
    return
  }
}

function handleEditorDoubleClick(event: MouseEvent) {
  if (!dialogOpen.value) {
    return
  }
  if (currentTool.value === 'lasso') {
    event.preventDefault()
    finalizePolygonDraft()
    return
  }
  if (currentTool.value === 'line') {
    event.preventDefault()
    finalizeLineDraft()
    return
  }

  const world = screenToWorld(event)
  const hitPolygon = hitTestPolygon(world)
  if (hitPolygon) {
    event.preventDefault()
    activeLayerId.value = hitPolygon.layerId
    selectFeature({ type: 'polygon', id: hitPolygon.id })
    return
  }
  const hitPolyline = hitTestPolyline(world)
  if (hitPolyline) {
    event.preventDefault()
    activeLayerId.value = hitPolyline.layerId
    selectFeature({ type: 'polyline', id: hitPolyline.id })
    return
  }
  const hitImage = hitTestImage(world)
  if (hitImage) {
    event.preventDefault()
    activeImageId.value = hitImage.id
    movePlanningImageToEnd(hitImage.id)
    return
  }
}

function handleEditorContextMenu(event: MouseEvent) {
  if (!dialogOpen.value) {
    return
  }

  // Right-drag panning should not be interpreted as "cancel draft".
  if (suppressContextMenuOnce.value) {
    event.preventDefault()
    suppressContextMenuOnce.value = false
    return
  }
  const rectangleActive = dragState.value.type === 'rectangle'
  const polygonDraftActive = polygonDraftPoints.value.length > 0
  const draftLine = getDraftLine()
  const lineDraftActive = !!(draftLine && draftLine.points.length > 0)
  if (!rectangleActive && !polygonDraftActive && !lineDraftActive) {
    return
  }
  event.preventDefault()
  cancelActiveDrafts()
  frozenCanvasSize.value = null
}

function handlePointerMove(event: PointerEvent) {
  // Terrain brush removed; no hover scheduling for brush.

  // Free-draw preview: when not dragging, update preview line following the mouse
  if (
    dialogOpen.value
    && dragState.value.type === 'idle'
    && currentTool.value === 'lasso'
    && polygonDraftPoints.value.length
  ) {
    pendingLassoHoverClient = { x: event.clientX, y: event.clientY }
    scheduleRafFlush()
  }

  // Segment draw preview: when not dragging, show preview line from last point to mouse
  if (
    dialogOpen.value
    && dragState.value.type === 'idle'
    && currentTool.value === 'line'
  ) {
    const line = getDraftLine()
    const anchor = getDraftAnchorPoint(line, lineDraft.value)
    if (anchor) {
      pendingLineHoverClient = { x: event.clientX, y: event.clientY }
      scheduleRafFlush()
    }
  }

  // Mouse-follow guides: show when cursor is over canvas and no other drag is active (temporary, not added to persistent guides list)
  // Disable mouse-follow guides (no longer show temporary guide on mouse move)
  hoverGuideX.value = null
  hoverGuideY.value = null

  const state = dragState.value
  if (state.type === 'idle' || state.pointerId !== event.pointerId) {
    return
  }
  
  if (state.type === 'rectangle') {
    dragState.value = { ...state, current: screenToWorld(event) }
    return
  }
  if (state.type === 'pan') {
    const scale = renderScale.value
    const dx = (event.clientX - state.origin.x) / scale
    const dy = (event.clientY - state.origin.y) / scale
    pendingPan = { x: state.offset.x + dx, y: state.offset.y + dy }
    scheduleRafFlush()
    return
  }
  if (state.type === 'move-polygon') {
    const world = screenToWorld(event)
    const dx = world.x - state.anchor.x
    const dy = world.y - state.anchor.y
    const polygon = polygons.value.find((item) => item.id === state.polygonId)
    if (polygon) {
      polygon.points = state.startPoints.map((point) => ({
        x: point.x + dx,
        y: point.y + dy,
      }))
    }
    return
  }
  if (state.type === 'move-polyline') {
    const world = screenToWorld(event)
    const dx = world.x - state.anchor.x
    const dy = world.y - state.anchor.y
    const line = polylines.value.find((item) => item.id === state.lineId)
    if (line) {
      for (let i = 0; i < line.points.length; i += 1) {
        const start = state.startPoints[i]
        const target = line.points[i]
        if (!start || !target) continue
        target.x = start.x + dx
        target.y = start.y + dy
      }
    }
    return
  }
  if (state.type === 'drag-vertex') {
    const world = screenToWorld(event)
    if (state.feature === 'polygon') {
      const polygon = polygons.value.find((item) => item.id === state.targetId)
      if (polygon && state.rectConstraint && polygon.points.length === 4) {
        const computed = computeRectResizeFromConstraint(state.rectConstraint, world)
        for (let i = 0; i < 4; i += 1) {
          const p = polygon.points[i]
          if (!p) continue
          const next = computed.nextByIndex(i)
          p.x = next.x
          p.y = next.y
        }
      } else {
        const target = polygon?.points[state.vertexIndex]
        if (target) {
          target.x = world.x
          target.y = world.y
        }
      }
    } else {
      const line = polylines.value.find((item) => item.id === state.targetId)
      if (
        lineVertexClickState.value &&
        lineVertexClickState.value.pointerId === event.pointerId &&
        !lineVertexClickState.value.moved
      ) {
        lineVertexClickState.value = { ...lineVertexClickState.value, moved: true }
      }

      const target = line?.points[state.vertexIndex]
      if (target) {
        target.x = world.x
        target.y = world.y
      }
    }
    return
  }
  if (state.type === 'move-image-layer') {
    const world = screenToWorld(event)
    const dx = world.x - state.anchor.x
    const dy = world.y - state.anchor.y
    if (state.groupStartPos && alignModeActive.value) {
      pendingImageMoves = Object.entries(state.groupStartPos).map(([imageId, startPos]) => ({
        imageId,
        x: startPos.x + dx,
        y: startPos.y + dy,
      }))
    } else {
      pendingImageMoves = [
        {
          imageId: state.imageId,
          x: state.startPos.x + dx,
          y: state.startPos.y + dy,
        },
      ]
    }
    scheduleRafFlush()
    return
  }
  if (state.type === 'move-align-marker') {
    const image = planningImages.value.find((img) => img.id === state.imageId)
    if (!image) {
      return
    }
    const world = screenToWorld(event)
    pendingMarkerMove = {
      imageId: image.id,
      localX: (world.x - image.position.x) / image.scale,
      localY: (world.y - image.position.y) / image.scale,
    }
    scheduleRafFlush()
    return
  }
  if (state.type === 'resize-image-layer') {
    const image = planningImages.value.find((img) => img.id === state.imageId)
    if (!image) {
      return
    }
    const world = screenToWorld(event)
    const minSize = 32
    let { x, y, w, h } = state.startRect
    if (state.direction.includes('e')) {
      w = Math.max(minSize, world.x - x)
    }
    if (state.direction.includes('s')) {
      h = Math.max(minSize, world.y - y)
    }
    if (state.direction.includes('w')) {
      const newX = Math.min(world.x, x + state.startRect.w - minSize)
      w = Math.max(minSize, x + state.startRect.w - newX)
      x = newX
    }
    if (state.direction.includes('n')) {
      const newY = Math.min(world.y, y + state.startRect.h - minSize)
      h = Math.max(minSize, y + state.startRect.h - newY)
      y = newY
    }
    const scale = Math.max(w / image.width, h / image.height, 0.05)
    image.position.x = x
    image.position.y = y
    image.scale = scale
  }
}

async function handlePointerUp(event: PointerEvent) {
  const state = dragState.value
  if (state.type !== 'idle' && state.pointerId === event.pointerId) {
    const didMovePolylineVertex =
      state.type === 'drag-vertex'
      && state.feature === 'polyline'
      && !!lineVertexClickState.value
      && lineVertexClickState.value.pointerId === event.pointerId
      && lineVertexClickState.value.moved

    const shouldDirty =
      state.type === 'pan'
      || state.type === 'move-polygon'
      || state.type === 'move-polyline'
      || (state.type === 'drag-vertex' && (state.feature !== 'polyline' || didMovePolylineVertex))
      || state.type === 'move-image-layer'
      || state.type === 'move-align-marker'
      || state.type === 'resize-image-layer'

    if (state.type === 'rectangle') {
      finalizeRectangleDrag()
    }
    dragState.value = { type: 'idle' }
    // Release frozen stage size so the canvas updates uniformly after the operation ends.
    frozenCanvasSize.value = null

    if (shouldDirty) {
      // Ensure any pending RAF-applied moves are flushed before persisting metadata.
      try {
        scheduleRafFlush()
        await new Promise((res) => requestAnimationFrame(res))
        // Persist updated layer metadata (positions, scales, etc.) to IndexedDB so
        // a browser refresh won't lose recent image edits even if the scene data
        // hasn't been saved to the server yet.
        await persistLayersToIndexedDB()
      } catch (e) {
        // non-fatal
        // eslint-disable-next-line no-console
        console.warn('Failed to persist planning layers after pointer up', e)
      }
      if (state.type === 'move-polygon') {
        const polygon = polygons.value.find((item) => item.id === state.polygonId)
        enableLayerConversion(polygon?.layerId)
      } else if (state.type === 'move-polyline') {
        const line = polylines.value.find((item) => item.id === state.lineId)
        enableLayerConversion(line?.layerId)
      } else if (state.type === 'drag-vertex') {
        if (state.feature === 'polygon') {
          const polygon = polygons.value.find((item) => item.id === state.targetId)
          enableLayerConversion(polygon?.layerId)
        } else if (didMovePolylineVertex) {
          const line = polylines.value.find((item) => item.id === state.targetId)
          enableLayerConversion(line?.layerId)
        }
      }

      markPlanningDirty()

      // Road drags can create/remove connections; normalize when an edit ends.
      if (state.type === 'move-polyline' || state.type === 'drag-vertex') {
        if (state.type === 'move-polyline') {
          const line = polylines.value.find((l) => l.id === state.lineId)
          normalizeRoadLayerIfNeeded(line?.layerId)
        } else if (state.type === 'drag-vertex' && state.feature === 'polyline' && didMovePolylineVertex) {
          const line = polylines.value.find((l) => l.id === state.targetId)
          normalizeRoadLayerIfNeeded(line?.layerId)
        }
      }
    }
  }

  if (
    lineVertexClickState.value &&
    lineVertexClickState.value.pointerId === event.pointerId &&
    !lineVertexClickState.value.moved
  ) {
    if (currentTool.value === 'line') {
      startLineContinuation(lineVertexClickState.value.lineId, lineVertexClickState.value.vertexIndex)
    }
  }
  lineVertexClickState.value = null
}

function handleWheel(event: WheelEvent) {
  if (!dialogOpen.value) {
    return
  }
  event.preventDefault()
  // Use the real-time DOMRect to avoid zoom-center drift caused by stale editorRect cache.
  const rect = editorRef.value?.getBoundingClientRect()
  if (!rect) {
    return
  }
  const delta = event.deltaY > 0 ? -0.1 : 0.1
  const previousViewScale = viewTransform.scale

  const fitScale = getFitScaleForViewport(rect)
  const minViewScale = fitScale * 0.1
  const maxViewScale = fitScale * 4

  const nextViewScale = Math.min(maxViewScale, Math.max(minViewScale, previousViewScale + delta * previousViewScale))
  if (nextViewScale === previousViewScale) {
    return
  }

  applyZoomToView({ nextViewScale, rect, anchorClientX: event.clientX, anchorClientY: event.clientY })
  markPlanningDirty()
}

function cancelActiveDrafts() {
  polygonDraftPoints.value = []
  polygonDraftHoverPoint.value = null

  const draft = lineDraft.value
  const draftLine = getDraftLine()
  if (draft && draftLine) {
    if (draft.continuation) {
      // Continuation edits an existing polyline in-place; rollback to the original points.
      if (Array.isArray(draft.startPoints) && draft.startPoints.length) {
        draftLine.points = clonePoints(draft.startPoints)
      }

      if (isGuideRoutePolyline(draftLine)) {
        if (Array.isArray(draft.startWaypoints)) {
          draftLine.waypoints = draft.startWaypoints.map((w) => ({ name: w?.name, dock: w?.dock === true }))
        }
        ensureGuideRouteWaypoints(draftLine)
      }
      clearLineDraft({ keepLine: true })
    } else {
      // New line draft (or newly created segment): remove it entirely.
      polylines.value = polylines.value.filter((item) => item.id !== draftLine.id)
      if (
        (selectedFeature.value?.type === 'polyline' && selectedFeature.value.id === draftLine.id)
        || (selectedFeature.value?.type === 'segment' && selectedFeature.value.lineId === draftLine.id)
      ) {
        selectFeature(null)
      }
      if (selectedVertex.value?.feature === 'polyline' && selectedVertex.value.targetId === draftLine.id) {
        selectedVertex.value = null
      }
      clearLineDraft({ keepLine: true })
      markPlanningDirty()
    }
  } else {
    clearLineDraft()
  }

  dragState.value = { type: 'idle' }
}

function zoomImageLayer(image: PlanningImage, event: WheelEvent) {
  const factor = event.deltaY > 0 ? 0.9 : 1.1
  const nextScale = Math.min(20, Math.max(0.05, image.scale * factor))
  const worldPoint = screenToWorld(event)
  const localX = (worldPoint.x - image.position.x) / image.scale
  const localY = (worldPoint.y - image.position.y) / image.scale
  image.scale = nextScale
  image.position.x = worldPoint.x - localX * nextScale
  image.position.y = worldPoint.y - localY * nextScale
}

function handleKeydown(event: KeyboardEvent) {
  if (!dialogOpen.value) {
    return
  }
  if (event.key === 'Escape') {
    cancelActiveDrafts()
    return
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedFeature.value) {
    // If focus is in an input or textarea, do not delete shape/layer
    const active = document.activeElement
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) {
      // Let default text editing behavior happen
      return
    }
    event.preventDefault()
    deleteSelectedFeature()
    return
  }
  if (event.key === 'Enter') {
    if (currentTool.value === 'lasso' && polygonDraftPoints.value.length >= 3) {
      event.preventDefault()
      finalizePolygonDraft()
      return
    }
      const draftLine = getDraftLine()
      if (currentTool.value === 'line' && draftLine && draftLine.points.length >= 2) {
        event.preventDefault()
        finalizeLineDraft()
      }
  }
}

function handlePolygonPointerDown(polygonId: string, event: PointerEvent) {
  if (tryBeginRightPan(event)) {
    return
  }
  if (event.button !== 0) {
    return
  }
  const world = screenToWorld(event)
  const candidate = pickTopmostActivePolygon(world) ?? polygons.value.find((item) => item.id === polygonId)
  if (!candidate || !isActiveLayer(candidate.layerId)) {
    return
  }
  // If user intends to draw (rectangle/lasso/line), start drawing instead of selecting the existing shape.
  if (currentTool.value === 'rectangle') {
    event.stopPropagation()
    event.preventDefault()
    startRectangleDrag(world, event)
    return
  }
  if (currentTool.value === 'lasso') {
    event.stopPropagation()
    event.preventDefault()
    addPolygonDraftPoint(world)
    return
  }
  if (currentTool.value === 'line') {
    event.stopPropagation()
    event.preventDefault()
    startLineDraft(world)
    return
  }

  // Only select/move when select tool is active.
  event.stopPropagation()
  event.preventDefault()
  selectFeature({ type: 'polygon', id: candidate.id })
  if (currentTool.value !== 'select') {
    return
  }

  dragState.value = {
    type: 'move-polygon',
    pointerId: event.pointerId,
    polygonId: candidate.id,
    anchor: world,
    startPoints: clonePoints(candidate.points),
  }
  event.currentTarget instanceof Element && event.currentTarget.setPointerCapture(event.pointerId)
}

function handlePolygonVertexPointerDown(polygonId: string, vertexIndex: number, event: PointerEvent) {
  if (tryBeginRightPan(event)) {
    return
  }
  if (event.button !== 0) {
    return
  }
  const polygon = polygons.value.find((item) => item.id === polygonId)
  if (!polygon || !isActiveLayer(polygon.layerId)) {
    return
  }

  const effectiveTool = currentTool.value === 'rectangle' || currentTool.value === 'lasso' || currentTool.value === 'line' ? 'select' : currentTool.value
  event.stopPropagation()
  event.preventDefault()
  selectFeature({ type: 'polygon', id: polygonId })
  selectedVertex.value = { feature: 'polygon', targetId: polygonId, vertexIndex }
  if (effectiveTool !== 'select') {
    return
  }

  let rectConstraint: RectResizeConstraint | undefined
  const cornerKeyByIndex = buildRectCornerKeyByIndex(polygon.points)
  if (cornerKeyByIndex) {
    const draggedKey = cornerKeyByIndex[vertexIndex]
    if (draggedKey) {
      const fixedKey = oppositeRectCornerKey(draggedKey)
      const fixedIndex = Number(Object.keys(cornerKeyByIndex).find((k) => cornerKeyByIndex[Number(k)] === fixedKey))
      const fixedPoint = Number.isFinite(fixedIndex) ? polygon.points[fixedIndex] : null
      const draggedPoint = polygon.points[vertexIndex]
      if (fixedPoint && draggedPoint) {
        const signX = (draggedPoint.x - fixedPoint.x) >= 0 ? 1 : -1
        const signY = (draggedPoint.y - fixedPoint.y) >= 0 ? 1 : -1
        rectConstraint = {
          fixed: { x: fixedPoint.x, y: fixedPoint.y },
          signX,
          signY,
          cornerKeyByIndex,
        }
      }
    }
  }

  dragState.value = {
    type: 'drag-vertex',
    pointerId: event.pointerId,
    feature: 'polygon',
    targetId: polygonId,
    vertexIndex,
    rectConstraint,
  }
  event.currentTarget instanceof Element && event.currentTarget.setPointerCapture(event.pointerId)
}

function handlePolylinePointerDown(lineId: string, event: PointerEvent) {
  if (tryBeginRightPan(event)) {
    return
  }
  if (event.button !== 0) {
    return
  }
  const world = screenToWorld(event)
  const picked = pickTopmostActivePolyline(world)
  const line = picked?.line ?? polylines.value.find((item) => item.id === lineId)
  if (!line || !isActiveLayer(line.layerId)) {
    return
  }
  const effectiveTool = currentTool.value === 'rectangle' || currentTool.value === 'lasso' || currentTool.value === 'line' ? 'select' : currentTool.value
  event.stopPropagation()
  event.preventDefault()
  selectFeature({ type: 'polyline', id: line.id })
  if (!canEditPolylineGeometry(line.layerId)) {
    return
  }
  if (effectiveTool !== 'select') {
    return
  }
  dragState.value = {
    type: 'move-polyline',
    pointerId: event.pointerId,
    lineId: line.id,
    anchor: world,
    startPoints: clonePoints(line.points),
  }
  event.currentTarget instanceof Element && event.currentTarget.setPointerCapture(event.pointerId)
}

function handleLineVertexPointerDown(lineId: string, vertexIndex: number, event: PointerEvent) {
  if (tryBeginRightPan(event)) {
    return
  }
  if (event.button !== 0) {
    return
  }
  const line = polylines.value.find((item) => item.id === lineId)
  if (!line || !isActiveLayer(line.layerId)) {
    return
  }

  // While drawing a line, clicking an existing endpoint should connect the draft to it,
  // not switch selection to that endpoint.
  if (currentTool.value === 'line' && canUseLineTool.value && lineDraft.value && lineDraft.value.layerId === line.layerId) {
    if (getLayerKind(line.layerId) === 'guide-route' && lineDraft.value.lineId !== lineId) {
      // Guide-route disallows branching: do not connect a draft polyline to another polyline's vertex.
      event.stopPropagation()
      event.preventDefault()
      return
    }
    const point = line.points[vertexIndex]
    if (!point) {
      return
    }
    event.stopPropagation()
    event.preventDefault()
    startLineDraft(point)
    return
  }

  const effectiveTool = currentTool.value === 'rectangle' || currentTool.value === 'lasso' || currentTool.value === 'line' ? 'select' : currentTool.value
  event.stopPropagation()
  event.preventDefault()
  selectFeature({ type: 'polyline', id: lineId })
  selectedVertex.value = { feature: 'polyline', targetId: lineId, vertexIndex }
  if (!canEditPolylineGeometry(line.layerId)) {
    return
  }
  if (effectiveTool !== 'select') {
    return
  }

  dragState.value = {
    type: 'drag-vertex',
    pointerId: event.pointerId,
    feature: 'polyline',
    targetId: lineId,
    vertexIndex,
  }
  lineVertexClickState.value = {
    lineId,
    vertexIndex,
    pointerId: event.pointerId,
    moved: false,
  }
  event.currentTarget instanceof Element && event.currentTarget.setPointerCapture(event.pointerId)
}

function handleLineSegmentPointerDown(lineId: string, segmentIndex: number, event: PointerEvent) {
  if (tryBeginRightPan(event)) {
    return
  }
  if (event.button !== 0) {
    return
  }
  const world = screenToWorld(event)
  const line = polylines.value.find((item) => item.id === lineId)
  if (!line || !isActiveLayer(line.layerId)) {
    return
  }

  const isCurrentlySelected =
    (selectedFeature.value?.type === 'polyline' && selectedFeature.value.id === line.id)
    || (selectedFeature.value?.type === 'segment' && selectedFeature.value.lineId === line.id)

  // Only allow splitting when the click is actually on the visible stroke.
  // This prevents adding vertices when clicking near (but not on) a segment.
  if (!isClickOnVisiblePolylineSegment(line, segmentIndex, world, isCurrentlySelected)) {
    return
  }

  // In line tool, first click selects the polyline; only when already selected do we insert a vertex and start drawing from it.
  const layerKind = getLayerKind(line.layerId)
  if (currentTool.value === 'line' && layerKind === 'guide-route') {
    event.stopPropagation()
    event.preventDefault()
    selectFeature({ type: 'polyline', id: line.id })

    if (!isCurrentlySelected) {
      return
    }
    if (!canEditPolylineGeometry(line.layerId)) {
      return
    }

    const segments = getLineSegments(line)
    const segment = segments[segmentIndex]
    if (!segment) {
      return
    }

    // Compute the projection of the click point onto the segment.
    const ax = segment.start.x
    const ay = segment.start.y
    const bx = segment.end.x
    const by = segment.end.y
    const dx = bx - ax
    const dy = by - ay
    const denom = dx * dx + dy * dy
    const tRaw = denom <= 1e-12 ? 0 : ((world.x - ax) * dx + (world.y - ay) * dy) / denom
    const t = Math.max(0, Math.min(1, tRaw))
    const proj = { x: Number((ax + t * dx).toFixed(2)), y: Number((ay + t * dy).toFixed(2)) }

    // Avoid creating duplicate endpoints: only reuse existing endpoints (snap radius scales with zoom).
    const nearEndpoint = findNearbyPolylineEndpointInLayer(proj, line.layerId, ENDPOINT_MERGE_RADIUS_PX)
    const insertPoint = nearEndpoint?.point ?? createVertexPoint(proj)

    // Insert the new vertex into the clicked polyline at segmentIndex+1 if not already present.
    const insertIndex = Math.min(segmentIndex + 1, Math.max(1, line.points.length - 1))
    const before = line.points[insertIndex - 1]
    const after = line.points[insertIndex]
    const sameAsBefore = before && ((before.id && insertPoint.id && before.id === insertPoint.id) || (before.x === insertPoint.x && before.y === insertPoint.y))
    const sameAsAfter = after && ((after.id && insertPoint.id && after.id === insertPoint.id) || (after.x === insertPoint.x && after.y === insertPoint.y))
    if (!sameAsBefore && !sameAsAfter) {
      line.points.splice(insertIndex, 0, insertPoint)
    }

    // Select the (existing or newly created) endpoint and start a new draft from it.
    beginLineDraftFromPoint(insertPoint, line.layerId)
    return
  }

  const effectiveTool = currentTool.value === 'rectangle' || currentTool.value === 'lasso' || currentTool.value === 'line' ? 'select' : currentTool.value
  event.stopPropagation()
  event.preventDefault()

  // Always allow selecting the road polyline in select tool, but prevent geometry edits.
  selectFeature({ type: 'polyline', id: line.id })
  if (!canEditPolylineGeometry(line.layerId)) {
    return
  }

  if (effectiveTool !== 'select') {
    return
  }

  // Right-click is reserved for panning now; keep segment clicks as selection-only.
  selectFeature({ type: 'segment', lineId: line.id, segmentIndex })
}

function startLineContinuation(lineId: string, vertexIndex: number) {
  if (currentTool.value !== 'line') {
    return
  }
  const line = polylines.value.find((item) => item.id === lineId)
  if (!line) {
    return
  }
  if (vertexIndex !== 0 && vertexIndex !== line.points.length - 1) {
    return
  }
  const point = line.points[vertexIndex]
  if (!point) {
    return
  }

  const isGuideRoute = getLayerKind(line.layerId) === 'guide-route'
  if (isGuideRoute) {
    ensureGuideRouteWaypoints(line)
  }

  activeLayerId.value = line.layerId
  lineDraft.value = {
    lineId,
    layerId: line.layerId,
    startPoints: clonePoints(line.points),
    startWaypoints: isGuideRoute
      ? (line.waypoints ?? []).map((w) => ({ name: w?.name, dock: w?.dock === true }))
      : undefined,
    continuation: {
      lineId,
      anchorIndex: vertexIndex,
      direction: vertexIndex === 0 ? 'prepend' : 'append',
    },
  }
  lineDraftHoverPoint.value = null
  pendingLineHoverClient = null
}

function handleUploadClick() {
  fileInputRef.value?.click()
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement | null
  if (!input?.files?.length) {
    return
  }
  Array.from(input.files).forEach(file => loadPlanningImage(file))
  input.value = ''
}

function handleUploadIconDragStart(event: DragEvent) {
  if (!event.dataTransfer) {
    return
  }
  event.dataTransfer.setData('text/x-harmony-planning-upload', '1')
  event.dataTransfer.effectAllowed = 'copy'
}

function handleImageLayerPanelDragOver(event: DragEvent) {
  event.preventDefault()
}

function handleImageLayerPanelDragLeave(event: DragEvent) {
  event.preventDefault()
}

function handleImageLayerPanelDrop(event: DragEvent) {
  event.preventDefault()
  event.stopPropagation()

  const reorderId = event.dataTransfer?.getData('text/x-harmony-planning-image-id')
  if (reorderId) {
    movePlanningImageToListEnd(reorderId)
    draggingImageId.value = null
    dragOverImageId.value = null
    return
  }

  const files = event.dataTransfer?.files
  if (files?.length) {
    Array.from(files).forEach((file) => loadPlanningImage(file))
    return
  }

  const token = event.dataTransfer?.getData('text/x-harmony-planning-upload')
  if (token === '1') {
    handleUploadClick()
  }
}

function loadPlanningImage(file: File) {
  uploadError.value = null
  if (!file.type.includes('png') && !file.type.includes('jpeg') && !file.type.includes('jpg')) {
    uploadError.value = 'Only PNG or JPG formats are supported for planning images.'
    return
  }
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.onload = () => {
    const stage = canvasSize.value
    const centerX = stage.width / 2
    const centerY = stage.height / 2
    const newImage: PlanningImage = {
      id: createId('img'),
      name: file.name,
      url,
      filename: file.name,
      mimeType: file.type || null,
      sizeLabel: `${image.naturalWidth} x ${image.naturalHeight}`,
      width: image.naturalWidth,
      height: image.naturalHeight,
      visible: true,
      locked: false,
      opacity: 1,
      position: {
        x: centerX - image.naturalWidth / 2,
        y: centerY - image.naturalHeight / 2,
      },
      scale: 1,
    }
    planningImages.value.push(newImage)
    activeImageId.value = newImage.id

    // persist the uploaded image to IndexedDB so it survives page reloads
    void savePlanningImageToIndexedDB(newImage, file).catch((err) => {
      console.warn('Failed to persist planning image to IndexedDB', err)
    })

    markPlanningDirty()
  }
  image.onerror = () => {
    uploadError.value = 'Unable to read the image; please retry or choose a different file.'
    URL.revokeObjectURL(url)
  }
  image.src = url
}

async function savePlanningImageToIndexedDB(image: PlanningImage, file: File) {
  await savePlanningImageToStorage(image, file, currentSceneId.value ?? null)
  image.filename = file.name || image.filename || null
  image.mimeType = file.type || image.mimeType || null
}

async function persistLayersToIndexedDB() {
  await persistPlanningImageLayersToIndexedDB(currentSceneId.value ?? null, planningImages.value)
}

function handleResetView() {
  fitViewToCanvas({ markDirty: true })
}

function handleImageLayerToggle(imageId: string) {
  const image = planningImages.value.find((img) => img.id === imageId)
  if (image) {
    image.visible = !image.visible
    markPlanningDirty()
  }
}

function handleImageLayerLockToggle(imageId: string) {
  const image = planningImages.value.find((img) => img.id === imageId)
  if (image) {
    image.locked = !image.locked
    markPlanningDirty()
  }
}

function handleImageLayerSelect(imageId: string) {
  activeImageId.value = imageId
}

// handleImageLayerOpacityChange removed (unused)

async function handleImageLayerDelete(imageId: string) {
  const idx = planningImages.value.findIndex((img) => img.id === imageId)
  if (idx >= 0) {
    const img = planningImages.value[idx]
      try {
      if (img?.url) URL.revokeObjectURL(img.url)
    } catch {}
    planningImages.value.splice(idx, 1)
  }
  if (activeImageId.value === imageId) {
    activeImageId.value = planningImages.value[0]?.id ?? null
  }
  try {
    await deletePlanningImageFromStorage(imageId)
  } catch (e) {
    // non-fatal
    // eslint-disable-next-line no-console
    console.warn('Failed to delete planning image from IndexedDB', e)
  }
  markPlanningDirty()
}

function reorderPlanningImages(fromId: string, toId: string) {
  const fromIndex = planningImages.value.findIndex((img) => img.id === fromId)
  const toIndex = planningImages.value.findIndex((img) => img.id === toId)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return
  }
  const list = [...planningImages.value]
  const [item] = list.splice(fromIndex, 1)
  if (!item) {
    return
  }
  list.splice(toIndex, 0, item)
  planningImages.value = list
}

function reorderPlanningImagesByListOrder(fromId: string, toId: string) {
  const listOrder = planningImagesForList.value
  const fromIndex = listOrder.findIndex((img) => img.id === fromId)
  const toIndex = listOrder.findIndex((img) => img.id === toId)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return
  }
  const nextList = [...listOrder]
  const [item] = nextList.splice(fromIndex, 1)
  if (!item) {
    return
  }
  nextList.splice(toIndex, 0, item)
  planningImages.value = nextList.reverse()
  markPlanningDirty()
}

function movePlanningImageToEnd(imageId: string) {
  const fromIndex = planningImages.value.findIndex((img) => img.id === imageId)
  if (fromIndex < 0 || fromIndex === planningImages.value.length - 1) {
    return
  }
  const list = [...planningImages.value]
  const [item] = list.splice(fromIndex, 1)
  if (!item) {
    return
  }
  list.push(item)
  planningImages.value = list
  markPlanningDirty()
}

function movePlanningImageToListEnd(imageId: string) {
  // List end = bottom of canvas
  const listOrder = planningImagesForList.value
  const fromIndex = listOrder.findIndex((img) => img.id === imageId)
  if (fromIndex < 0 || fromIndex === listOrder.length - 1) {
    return
  }
  const nextList = [...listOrder]
  const [item] = nextList.splice(fromIndex, 1)
  if (!item) {
    return
  }
  nextList.push(item)
  planningImages.value = nextList.reverse()
  markPlanningDirty()
}

function handleImageLayerItemDragStart(imageId: string, event: DragEvent) {
  event.stopPropagation()
  if (!event.dataTransfer) {
    return
  }
  draggingImageId.value = imageId
  dragOverImageId.value = null
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/x-harmony-planning-image-id', imageId)
}

function handleImageLayerItemDragOver(overImageId: string, event: DragEvent) {
  event.preventDefault()
  const draggedId = event.dataTransfer?.getData('text/x-harmony-planning-image-id')
  if (!draggedId || draggedId === overImageId) {
    dragOverImageId.value = null
    return
  }
  dragOverImageId.value = overImageId
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function handleImageLayerItemDrop(targetImageId: string, event: DragEvent) {
  event.preventDefault()
  const draggedId = event.dataTransfer?.getData('text/x-harmony-planning-image-id')
  if (draggedId) {
    event.stopPropagation()
    reorderPlanningImagesByListOrder(draggedId, targetImageId)
    draggingImageId.value = null
    dragOverImageId.value = null
    return
  }
  // Non-reordering drags (file/upload icons) are handled by list-level drop logic.
  handleImageLayerPanelDrop(event)
}

function handleImageLayerItemDragEnd() {
  draggingImageId.value = null
  dragOverImageId.value = null
}

function handleImageLayerPointerDown(imageId: string, event: PointerEvent) {
  if (tryBeginRightPan(event)) {
    return
  }
  if (event.button !== 0) {
    return
  }
  // Planning layers act as 'base map' and should allow selection/annotation above them.
  // Therefore intercept events only for tools that need direct base map interaction.
  const tool = getEffectiveTool()
  if (tool !== 'select' && tool !== 'pan' && tool !== 'align-marker') {
    return
  }

  const image = planningImages.value.find((img) => img.id === imageId)
  if (!image) {
    return
  }
  // Only intercept image-area pointer events when the image is already selected in the panel.
  // Otherwise allow the event to bubble so the editor can handle pan/selection normally.
  if (activeImageId.value !== imageId) {
    return
  }
  event.stopPropagation()
  event.preventDefault()
  frozenCanvasSize.value = { ...canvasSize.value }
  if (!image.visible) {
    return
  }
  // allow starting a move when tool is 'pan' or 'select' (dragging the image moves it)
  const world = screenToWorld(event)
  if (tool === 'align-marker') {
    setAlignMarkerAtWorld(image, world)
    dragState.value = {
      type: 'move-align-marker',
      pointerId: event.pointerId,
      imageId,
    }
    event.currentTarget instanceof Element && event.currentTarget.setPointerCapture(event.pointerId)
    return
  }

  // Allow dragging planning layers when tool is 'select' or 'pan'.
  if (tool !== 'select' && tool !== 'pan') {
    return
  }

  if (image.locked) {
    return
  }

  const groupStartPos =
    alignModeActive.value && image.alignMarker
    && !image.locked
      ? Object.fromEntries(
        planningImages.value
          .filter((img) => img.visible && img.alignMarker && !img.locked)
          .map((img) => [img.id, { x: img.position.x, y: img.position.y }]),
      )
      : undefined

  dragState.value = {
    type: 'move-image-layer',
    pointerId: event.pointerId,
    imageId,
    startPos: { ...image.position },
    anchor: world,
    groupStartPos,
  }
  event.currentTarget instanceof Element && event.currentTarget.setPointerCapture(event.pointerId)
}

function handleImageResizePointerDown(
  imageId: string,
  direction: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw',
  event: PointerEvent,
) {
  if (tryBeginRightPan(event)) {
    return
  }
  if (event.button !== 0) {
    return
  }
  const tool = getEffectiveTool()
  if (tool !== 'select' && tool !== 'pan') {
    return
  }
  event.stopPropagation()
  event.preventDefault()
  const image = planningImages.value.find((img) => img.id === imageId)
  if (!image) {
    return
  }
  if (!image.visible || image.locked) {
    return
  }
  const rect = getImageRect(image)
  dragState.value = {
    type: 'resize-image-layer',
    pointerId: event.pointerId,
    imageId,
    direction,
    startRect: rect,
  }
  event.currentTarget instanceof Element && event.currentTarget.setPointerCapture(event.pointerId)
}

function getPolygonPath(points: PlanningPoint[], smoothing = 0) {
  if (!points.length) {
    return ''
  }
  if (smoothing <= 0) {
    return buildSimplePolygonPath(points)
  }
  const rounded = buildRoundedPolygonPath(points, smoothing)
  return rounded ?? buildSimplePolygonPath(points)
}

function buildSimplePolygonPath(points: PlanningPoint[]) {
  const segments = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
  return `${segments.join(' ')} Z`
}

function buildRoundedPolygonPath(points: PlanningPoint[], smoothing: number) {
  if (points.length < 3) {
    return null
  }

  const edgeCount = points.length
  const edges: Array<{ start: PlanningPoint; end: PlanningPoint; length: number }> = []
  let totalLength = 0
  for (let i = 0; i < edgeCount; i += 1) {
    const start = points[i]!
    const end = points[(i + 1) % edgeCount]!
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy)
    if (!Number.isFinite(length) || length <= 1e-8) {
      return null
    }
    edges.push({ start, end, length })
    totalLength += length
  }
  if (totalLength <= 1e-8) {
    return null
  }

  const averageEdgeLength = totalLength / edges.length
  const baseRadius = smoothing * averageEdgeLength
  if (baseRadius <= 1e-8) {
    return null
  }

  const segments: Array<{ start: PlanningPoint; corner: PlanningPoint; end: PlanningPoint }> = []
  for (let i = 0; i < edgeCount; i += 1) {
    const prevEdge = edges[(i - 1 + edgeCount) % edgeCount]!
    const nextEdge = edges[i]!
    const prevRadius = Math.min(baseRadius, prevEdge.length * 0.5)
    const nextRadius = Math.min(baseRadius, nextEdge.length * 0.5)
    const startPoint = pointAlongEdge(prevEdge, 1 - prevRadius / prevEdge.length)
    const endPoint = pointAlongEdge(nextEdge, nextRadius / nextEdge.length)
    segments.push({ start: startPoint, corner: points[i]!, end: endPoint })
  }

  const builder: string[] = []
  segments.forEach((segment, index) => {
    if (index === 0) {
      builder.push(`M ${segment.start.x} ${segment.start.y}`)
    } else {
      builder.push(`L ${segment.start.x} ${segment.start.y}`)
    }
    builder.push(`Q ${segment.corner.x} ${segment.corner.y} ${segment.end.x} ${segment.end.y}`)
  })
  builder.push('Z')
  return builder.join(' ')
}

function pointAlongEdge(edge: { start: PlanningPoint; end: PlanningPoint; length: number }, t: number) {
  return {
    x: edge.start.x + (edge.end.x - edge.start.x) * t,
    y: edge.start.y + (edge.end.y - edge.start.y) * t,
  }
}

function getLayerSmoothingValue(layerId?: string | null) {
  void layerId
  return 0
}

function getLineSegments(line: PlanningPolyline) {
  const segments: Array<{ start: PlanningPoint; end: PlanningPoint }> = []
  for (let i = 0; i < line.points.length - 1; i += 1) {
    const start = line.points[i]
    const end = line.points[i + 1]
    if (start && end) {
      segments.push({ start, end })
    }
  }
  return segments
}

function getDraftLine() {
  const draft = lineDraft.value
  if (!draft) {
    return null
  }
  return polylines.value.find((line) => line.id === draft.lineId) ?? null
}

function getDraftAnchorPoint(line: PlanningPolyline | null, draft: LineDraft | null) {
  if (!line || !line.points.length || !draft) {
    return null
  }
  if (draft.continuation?.direction === 'prepend') {
    return line.points[0]
  }
  return line.points[line.points.length - 1]
}

function clearLineDraft(options?: { keepLine?: boolean }) {
  const draft = lineDraft.value
  const keepLine = options?.keepLine ?? false
  if (!draft) {
    lineDraftHoverPoint.value = null
    pendingLineHoverClient = null
    return
  }
  const line = getDraftLine()
  if (!keepLine && line && line.points.length < 2) {
    polylines.value = polylines.value.filter((item) => item.id !== line.id)
  }
  lineDraft.value = null
  lineDraftHoverPoint.value = null
  pendingLineHoverClient = null
}

function resizeCursor(direction: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw') {
  switch (direction) {
    case 'n':
    case 's':
      return 'ns-resize'
    case 'e':
    case 'w':
      return 'ew-resize'
    case 'ne':
    case 'sw':
      return 'nesw-resize'
    case 'nw':
    case 'se':
      return 'nwse-resize'
    default:
      return 'pointer'
  }
}

function closeDialog() {
  dialogOpen.value = false
}

const toolbarButtons: Array<{ tool: PlanningTool; icon: string; tooltip: string }> = [
  { tool: 'select', icon: 'mdi-cursor-default-outline', tooltip: 'Select' },
  { tool: 'rectangle', icon: 'mdi-rectangle-outline', tooltip: 'Draw rectangular area' },
  { tool: 'lasso', icon: 'mdi-shape-polygon-plus', tooltip: 'Draw freehand area' },
  { tool: 'line', icon: 'mdi-vector-line', tooltip: 'Draw line' },
  { tool: 'align-marker', icon: 'mdi-crosshairs-gps', tooltip: 'Align marker' },
]

const visibleToolbarButtons = computed(() => {
  return toolbarButtons.filter((button) => {
    if (button.tool === 'line') {
      return canUseLineTool.value
    }
    if (button.tool === 'rectangle' || button.tool === 'lasso') {
      return canUseAreaTools.value
    }
    return true
  })
})

const deleteButtonTooltip = ' Delete selected objects (Del)'

const resizeDirections = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const

// These symbols are for future planning-to-scene conversion extensions (area/segment drawing, geometry editing, etc.).
// The current canvas implementation focuses on image reference layers; some functions are not yet referenced in the template. To avoid noUnusedLocals errors, reference them explicitly here.
void getLayerColor
void startRectangleDrag
void addPolygonDraftPoint
void startLineDraft
void handlePolygonPointerDown
void handlePolygonVertexPointerDown
void handlePolylinePointerDown
void handleLineVertexPointerDown
void handleLineSegmentPointerDown
void handleImageResizePointerDown
void getPolygonPath
void getLineSegments
void resizeCursor
void resizeDirections
void zoomImageLayer
void handleResetView
void closeDialog
void toggleAlignMode
void handleDeleteButtonClick
void reorderPlanningImages
// Keep terrain-related symbols to avoid unused-local errors (terrain panel removed)
void terrainContourHeightModel
void terrainContourBlendModel
void terrainLimited
void terrainCellSizeModel
void terrainNoiseEnabledModel
void terrainNoiseModeOptions
void terrainNoiseModeModel
void terrainNoiseSeedModel
void terrainNoiseScaleModel
void terrainNoiseAmplitudeModel
void terrainNoiseStrengthModel
void terrainNoiseEdgeFalloffModel
void terrainFalloffOptions
void updateTerrainControlPoint
void addTerrainControlPoint
void removeTerrainControlPoint
void updateTerrainLine
void removeTerrainLine
void addTerrainLineFromSelected

const imageHydrationToken = ref(0)

onMounted(() => {
  // Do NOT load persisted images here; defer until the dialog is opened to avoid slowing scene load.
  window.addEventListener('pointermove', handlePointerMove, { passive: false })
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerUp)
  window.addEventListener('resize', updateEditorRect)
  window.addEventListener('keydown', handleKeydown)
})

async function hydratePlanningImageUrls() {
  const token = imageHydrationToken.value + 1
  imageHydrationToken.value = token
  const snapshot = [...planningImages.value]

  if (!snapshot.length) {
    try {
      const persisted = await loadPlanningImagesFromStorage(currentSceneId.value ?? null)
      if (imageHydrationToken.value !== token || !persisted.length) {
        return
      }
      planningImages.value = persisted as PlanningImage[]
      activeImageId.value = planningImages.value[0]?.id ?? null
    } catch (error) {
      console.warn('Failed to load planning images from IndexedDB', error)
    }
    return
  }

  await Promise.all(snapshot.map(async (image) => {
    const hash = typeof image.imageHash === 'string' ? image.imageHash.trim() : ''
    if (!hash) {
      return
    }
    try {
      const nextUrl = await createPlanningImageUrlFromHash(hash)
      if (!nextUrl || imageHydrationToken.value !== token) {
        return
      }
      if (image.url && image.url !== nextUrl) {
        try { URL.revokeObjectURL(image.url) } catch {}
      }
      image.url = nextUrl
    } catch (error) {
      console.warn('Failed to hydrate planning image from IndexedDB', hash, error)
    }
  }))
}

watch(
  () => dialogOpen.value,
  async (open) => {
    if (!open) {
      return
    }
    await hydratePlanningImageUrls()
  },
)

onBeforeUnmount(() => {
  // Make sure edits are not lost if the component is destroyed.
  persistPlanningToSceneIfDirty({ force: true })
  // Revoke any object URLs created for persisted images to free memory
  try {
    for (const img of planningImages.value) {
      if (img.url) {
        try { URL.revokeObjectURL(img.url) } catch {}
      }
    }
  } catch {}
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', handlePointerUp)
  window.removeEventListener('pointercancel', handlePointerUp)
  window.removeEventListener('resize', updateEditorRect)
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <v-dialog
    v-model="dialogOpen"
    fullscreen
    transition="dialog-bottom-transition"
    scrim="rgba(6, 8, 12, 0.8)"
    persistent
  >
    <v-card class="planning-dialog" elevation="12">
      <header class="planning-dialog__header">
        <div class="title">Planning Diagram Conversion</div>
        <div class="header-actions">
          <v-btn icon variant="text" density="comfortable" @click="closeDialog">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </div>
      </header>

      <section class="planning-dialog__content">
        <aside class="left-panel">
          <section class="image-layer-panel">
            <header>
              <div class="panel-header">
                <h3>Planning Layers</h3>
                <v-btn
                  icon
                  size="small"
                  variant="text"
                  color="primary"
                  draggable="true"
                  title="Upload planning map"
                  @click.stop="handleUploadClick"
                  @dragstart="handleUploadIconDragStart"
                >
                  <v-icon>mdi-cloud-upload-outline</v-icon>
                </v-btn>
              </div>
              <div v-if="uploadError" class="upload-error">{{ uploadError }}</div>
              <input
                ref="fileInputRef"
                type="file"
                accept=".png,.jpg,.jpeg"
                multiple
                class="sr-only"
                @change="handleFileChange"
              >
            </header>
            <v-list
              density="compact"
              class="layer-list"
              @dragover="handleImageLayerPanelDragOver"
              @dragleave="handleImageLayerPanelDragLeave"
              @drop="handleImageLayerPanelDrop"
            >
              <v-list-item v-if="!planningImages.length" class="image-layer-empty">
                <div class="image-layer-empty__text">Drag planning image files here, or click upload on the right</div>
              </v-list-item>
              <v-list-item
                v-for="image in planningImagesForList"
                :key="image.id"
                :class="[
                  'layer-item',
                  {
                    active: activeImageId === image.id,
                    dragging: draggingImageId === image.id,
                    'drag-over': dragOverImageId === image.id,
                  },
                ]"
                :style="getImageLayerListItemStyle(image.id)"
                draggable="true"
                @dragstart="handleImageLayerItemDragStart(image.id, $event as DragEvent)"
                @dragover="handleImageLayerItemDragOver(image.id, $event as DragEvent)"
                @drop="handleImageLayerItemDrop(image.id, $event as DragEvent)"
                @dragend="handleImageLayerItemDragEnd"
                @click="handleImageLayerSelect(image.id)"
              >
                <div class="layer-content">
                  <v-tooltip :text="image.name" location="bottom">
                    <template #activator="{ props }">
                      <div v-bind="props" class="layer-name layer-name--truncated">{{ image.name }}</div>
                    </template>
                  </v-tooltip>
                </div>
                <template #append>
                  <v-btn
                    icon
                    size="small"
                    variant="text"
                    color="error"
                    @click.stop="handleImageLayerDelete(image.id)"
                  >
                    <v-icon>mdi-delete-outline</v-icon>
                  </v-btn>
                  <v-btn
                    icon
                    size="small"
                    variant="text"
                    :color="image.locked ? 'primary' : 'grey'"
                    @click.stop="handleImageLayerLockToggle(image.id)"
                  >
                    <v-icon>{{ image.locked ? 'mdi-lock-outline' : 'mdi-lock-open-outline' }}</v-icon>
                  </v-btn>
                  <v-btn
                    icon
                    size="small"
                    variant="text"
                    :color="image.visible ? 'primary' : 'grey'"
                    @click.stop="handleImageLayerToggle(image.id)"
                  >
                    <v-icon>{{ image.visible ? 'mdi-eye-outline' : 'mdi-eye-off-outline' }}</v-icon>
                  </v-btn>
                </template>
              </v-list-item>
            </v-list>
          </section>
          <section class="layer-panel">
            <header>
              <div class="panel-header">
                <h3>Layer Management</h3>
                <v-menu
                  v-model="addLayerMenuOpen"
                  location="bottom end"
                >
                  <template #activator="{ props: menuProps }">
                    <v-btn
                      v-bind="menuProps"
                      icon
                      size="small"
                      variant="text"
                      color="primary"
                      title="Add layer"
                    >
                      <v-icon>mdi-plus</v-icon>
                    </v-btn>
                  </template>
                  <v-list density="compact">
                    <v-list-item
                      v-for="kind in addableLayerKinds"
                      :key="kind"
                      @click="addPlanningLayer(kind)"
                    >
                      <v-list-item-title>{{ layerKindLabels[kind] }}</v-list-item-title>
                    </v-list-item>
                  </v-list>
                </v-menu>
              </div>
            </header>
            <v-list density="compact" class="layer-list">
              <v-list-item
                v-for="layer in layers"
                :key="layer.id"
                :class="[
                  'layer-item',
                  {
                    active: activeLayerId === layer.id,
                    dragging: draggingLayerId === layer.id,
                    'drag-over': dragOverLayerId === layer.id,
                  },
                ]"
                :style="getLayerListItemStyle(layer)"
                draggable="true"
                @dragstart="handleLayerItemDragStart(layer.id, $event as DragEvent)"
                @dragover="handleLayerItemDragOver(layer.id, $event as DragEvent)"
                @drop="handleLayerItemDrop(layer.id, $event as DragEvent)"
                @dragend="handleLayerItemDragEnd"
                @click="handleLayerSelection(layer.id)"
              >
                <div class="layer-content">
                  <div class="layer-name" @dblclick.stop="beginLayerRename(layer.id)">
                    <v-text-field
                      v-if="renamingLayerId === layer.id"
                      :ref="(el) => setRenameFieldRef(layer.id, el)"
                      v-model="renamingLayerDraft"
                      density="compact"
                      variant="underlined"
                      hide-details
                      class="layer-rename-input"
                      @click.stop
                      @keydown.enter.prevent="commitLayerRename(layer.id)"
                      @keydown.esc.prevent="cancelLayerRename"
                      @blur="commitLayerRename(layer.id)"
                    />
                    <template v-else>
                      {{ layer.name }}
                      <span v-if="layer.conversionEnabled === false" class="layer-conversion-chip">Cached</span>
                    </template>
                  </div>
                </div>
                <template #append>
                  <v-btn
                    icon
                    size="small"
                    variant="text"
                    :color="layer.conversionEnabled ? 'primary' : 'grey'"
                    class="layer-conversion-toggle"
                    :title="layer.conversionEnabled ? 'Disable layer conversion' : 'Enable layer conversion'"
                    @click.stop="handleLayerConversionToggle(layer.id, !layer.conversionEnabled)"
                  >
                    <v-icon>{{ layer.conversionEnabled ? 'mdi-refresh-auto' : 'mdi-check-circle-outline' }}</v-icon>
                  </v-btn>
                  <v-btn
                    icon
                    size="small"
                    variant="text"
                    color="error"
                    :disabled="layers.length <= 1"
                    @click.stop="handleLayerDelete(layer.id)"
                  >
                    <v-icon>mdi-delete-outline</v-icon>
                  </v-btn>
                  <v-btn
                    icon
                    size="small"
                    variant="text"
                    :color="layer.locked ? 'primary' : 'grey'"
                    @click.stop="handleLayerLockToggle(layer.id)"
                  >
                    <v-icon>{{ layer.locked ? 'mdi-lock-outline' : 'mdi-lock-open-variant-outline' }}</v-icon>
                  </v-btn>
                </template>
              </v-list-item>
            </v-list>
          </section>

          
        </aside>

        <main class="editor-panel">
          <div class="toolbar">
            <div class="tool-buttons">
              <v-tooltip
                v-for="button in visibleToolbarButtons"
                :key="button.tool"
                :text="button.tooltip"
                location="bottom"
              >
                <template #activator="{ props }">
                  <v-btn
                    v-bind="props"
                    :color="activeToolbarTool === button.tool ? 'primary' : undefined"
                    variant="tonal"
                    density="comfortable"
                    class="tool-button"
                    @click="handleToolSelect(button.tool)"
                  >
                    <v-icon>{{ button.icon }}</v-icon>
                  </v-btn>
                </template>
              </v-tooltip>

              <v-tooltip :text="deleteButtonTooltip" location="bottom">
                <template #activator="{ props }">
                  <v-btn
                    v-bind="props"
                    :color="canDeleteSelection ? 'error' : undefined"
                    variant="tonal"
                    density="comfortable"
                    class="tool-button"
                    :disabled="!canDeleteSelection"
                    @click="handleDeleteButtonClick"
                  >
                    <v-icon>mdi-delete-outline</v-icon>
                  </v-btn>
                </template>
              </v-tooltip>

              <v-tooltip text="Convert to 3D Scene" location="bottom">
                <template #activator="{ props }">
                  <v-btn
                    v-bind="props"
                    variant="tonal"
                    density="comfortable"
                    class="tool-button"
                    :disabled="convertingTo3DScene"
                    @click="handleConvertTo3DScene"
                  >
                    <v-icon>mdi-cube-outline</v-icon>
                  </v-btn>
                </template>
              </v-tooltip>

            </div>

            <div class="toolbar-right">
              <div class="zoom-control">
                <v-slider
                  v-model="zoomPercentModel"
                  min="10"
                  max="400"
                  step="1"
                  density="compact"
                  hide-details
                  class="zoom-slider"
                />
                <div class="zoom-value">{{ zoomPercentModel }}%</div>
              </div>

              <v-tooltip text="Reset View" location="bottom">
                <template #activator="{ props }">
                  <v-btn
                    v-bind="props"
                    variant="tonal"
                    density="comfortable"
                    class="tool-button"
                    @click="handleResetView"
                  >
                    <v-icon>mdi-fit-to-screen-outline</v-icon>
                  </v-btn>
                </template>
              </v-tooltip>
            </div>
          </div>

          <div
            ref="editorRef"
            class="editor-canvas"
            :style="{ ...editorBackgroundStyle, ...editorCursorStyle }"
            @pointerdown="handleEditorPointerDown"
            @dblclick="handleEditorDoubleClick"
            @wheel.prevent="handleWheel"
            @contextmenu.prevent="handleEditorContextMenu"
          >
            <PlanningRulers
              :viewport-width="editorRect?.width ?? 0"
              :viewport-height="editorRect?.height ?? 0"
              :render-scale="renderScale"
              :center-offset="stageCenterOffset"
              :offset="viewTransform.offset"
              :canvas-size="effectiveCanvasSize"
              :thickness="PLANNING_RULER_THICKNESS_PX"
              @guide-drag="handleRulerGuideDrag"
            />
            <div class="canvas-viewport">
              <div class="canvas-stage" :style="stageStyle">

                <svg
                  class="vector-overlay"
                  :width="effectiveCanvasPixelSize.width"
                  :height="effectiveCanvasPixelSize.height"
                  :viewBox="`0 0 ${effectiveCanvasSize.width} ${effectiveCanvasSize.height}`"
                >
                  <defs>
                    <filter id="vertex-glow" x="-60%" y="-60%" width="220%" height="220%">
                      <feGaussianBlur in="SourceGraphic" stdDeviation="1.25" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>

                  <!-- Drawn polygon areas -->
                  <g v-for="poly in visiblePolygons" :key="poly.id">
                    <!-- white outline for active layer to improve contrast -->
                    <path
                      v-if="isActiveLayer(poly.layerId)"
                      :d="getPolygonPath(poly.points, getLayerSmoothingValue(poly.layerId))"
                      fill="none"
                      stroke="rgba(255,255,255,0.95)"
                      stroke-linejoin="round"
                      stroke-width="0.9"
                      pointer-events="none"
                    />

                    <path
                      class="planning-polygon"
                      :class="{
                        selected: selectedFeature?.type === 'polygon' && selectedFeature.id === poly.id,
                        'inactive-layer-feature': !isActiveLayer(poly.layerId),
                      }"
                      :d="getPolygonPath(poly.points, getLayerSmoothingValue(poly.layerId))"
                      :fill="getLayerColor(poly.layerId, 0.22)"
                      :stroke="getLayerColor(poly.layerId, 0.95)"
                      stroke-width="0.1"
                      @pointerdown="handlePolygonPointerDown(poly.id, $event as PointerEvent)"
                    />

                  </g>

                  
                  <!-- Drawn segments (represented as polyline) -->
                  <g v-for="line in visiblePolylines" :key="line.id">
                    <!-- white outline for active layer polylines -->
                    <path
                      v-if="isActiveLayer(line.layerId)"
                      :d="getPolylinePath(line.points)"
                      fill="none"
                      stroke="rgba(255,255,255,0.95)"
                      :vector-effect="getPolylineVectorEffect(line.layerId)"
                      :stroke-linejoin="getPolylineStrokeLinejoin(line)"
                      stroke-linecap="round"
                      :stroke-width="getPolylineStrokeWidth(
                        line.layerId,
                        (selectedFeature?.type === 'polyline' && selectedFeature.id === line.id)
                          || (selectedFeature?.type === 'segment' && selectedFeature.lineId === line.id),
                      ) + 1.6"
                      pointer-events="none"
                    />

                    <path
                      class="planning-line"
                      :class="{
                        selected:
                          (selectedFeature?.type === 'polyline' && selectedFeature.id === line.id)
                          || (selectedFeature?.type === 'segment' && selectedFeature.lineId === line.id),
                        'inactive-layer-feature': !isActiveLayer(line.layerId),
                      }"
                      :d="getPolylinePath(line.points)"
                      :stroke="getPolylineStroke(line.layerId)"
                      :stroke-dasharray="getPolylineStrokeDasharray(line.layerId)"
                      :vector-effect="getPolylineVectorEffect(line.layerId)"
                      :stroke-linejoin="getPolylineStrokeLinejoin(line)"
                      stroke-linecap="round"
                      :stroke-width="getPolylineStrokeWidth(
                        line.layerId,
                        (selectedFeature?.type === 'polyline' && selectedFeature.id === line.id)
                          || (selectedFeature?.type === 'segment' && selectedFeature.lineId === line.id),
                      )"
                      fill="none"
                      @pointerdown="handlePolylinePointerDown(line.id, $event as PointerEvent)"
                    />

                    <line
                      v-for="(seg, segIndex) in getLineSegments(line)"
                      :key="`${line.id}-seg-${segIndex}`"
                      class="planning-line-segment"
                      :x1="seg.start.x"
                      :y1="seg.start.y"
                      :x2="seg.end.x"
                      :y2="seg.end.y"
                      stroke="transparent"
                      :vector-effect="getPolylineVectorEffect(line.layerId)"
                      :stroke-width="getPolylineStrokeWidth(
                        line.layerId,
                        (selectedFeature?.type === 'polyline' && selectedFeature.id === line.id)
                          || (selectedFeature?.type === 'segment' && selectedFeature.lineId === line.id),
                      )"
                      stroke-linecap="round"
                      @pointerdown="handleLineSegmentPointerDown(line.id, segIndex, $event as PointerEvent)"
                    />

                    <!-- Endpoint hit area: allows clicking endpoints to continue drawing/drag endpoints -->
                    <circle
                      v-if="line.points.length"
                      class="line-endpoint-hit"
                      :cx="line.points[0]!.x"
                      :cy="line.points[0]!.y"
                      :r="vertexHandleHitRadiusWorld"
                      fill="transparent"
                      pointer-events="all"
                      @pointerdown="handleLineVertexPointerDown(line.id, 0, $event as PointerEvent)"
                    />
                    <!-- Visible small endpoint marker (distinct color when selectable) -->
                    <circle
                      v-if="line.points.length"
                      :cx="line.points[0]!.x"
                      :cy="line.points[0]!.y"
                      :r="vertexHandleRadiusWorld"
                      :fill="getEndpointFillColor(line.layerId)"
                      stroke="rgba(255,255,255,0.9)"
                      :stroke-width="vertexHandleStrokeWidthWorld"
                      pointer-events="none"
                    />
                    <circle
                      v-if="line.points.length >= 2"
                      class="line-endpoint-hit"
                      :cx="line.points[line.points.length - 1]!.x"
                      :cy="line.points[line.points.length - 1]!.y"
                      :r="vertexHandleHitRadiusWorld"
                      fill="transparent"
                      pointer-events="all"
                      @pointerdown="handleLineVertexPointerDown(line.id, line.points.length - 1, $event as PointerEvent)"
                    />
                    <circle
                      v-if="line.points.length >= 2"
                      :cx="line.points[line.points.length - 1]!.x"
                      :cy="line.points[line.points.length - 1]!.y"
                      :r="vertexHandleRadiusWorld"
                      :fill="getEndpointFillColor(line.layerId)"
                      stroke="rgba(255,255,255,0.9)"
                      :stroke-width="vertexHandleStrokeWidthWorld"
                      pointer-events="none"
                    />
                  </g>

                  <!-- Rectangle selection drag preview -->
                  <path
                    v-if="dragState.type === 'rectangle'"
                    class="planning-rectangle-preview"
                    :d="getPolygonPath(createRectanglePoints(dragState.start, dragState.current), getLayerSmoothingValue(dragState.layerId))"
                    fill="rgba(98, 179, 255, 0.12)"
                    stroke="rgba(98, 179, 255, 0.45)"
                    stroke-width="0.1"
                  />

                  <!-- Freeform selection preview (click to add points, double-click to finish) -->
                  <path
                    v-if="polygonDraftPoints.length >= 1"
                    class="planning-polygon-draft"
                    :d="polygonDraftPreview.d"
                    :fill="polygonDraftPreview.fill"
                    stroke="rgba(98, 179, 255, 0.45)"
                    stroke-width="0.1"
                  />

                  <!-- Segment draw preview -->
                  <path
                    v-if="lineDraftPreviewPath"
                    class="planning-line-draft"
                    :d="lineDraftPreviewPath"
                    :stroke="lineDraftPreviewStroke"
                    :stroke-width="lineDraftPreviewStrokeWidth"
                    :stroke-dasharray="lineDraftPreviewDasharray"
                    :vector-effect="lineDraftPreviewVectorEffect"
                    fill="none"
                  />

                  <!-- During segment drawing: show vertex positions -->
                  <g v-if="lineDraftPoints.length">
                    <circle
                      v-for="(p, idx) in lineDraftPoints"
                      :key="`line-draft-v-${idx}-${p.id ?? ''}`"
                      class="vertex-handle"
                      :cx="p.x"
                      :cy="p.y"
                      :r="vertexHandleRadiusWorld"
                      :fill="getLayerColor(lineDraft!.layerId, 0.95)"
                      stroke="rgba(255,255,255,0.9)"
                      :stroke-width="vertexHandleStrokeWidthWorld"
                      pointer-events="none"
                    />
                  </g>

                  <!-- Vertex/current operation point highlight -->
                  <circle
                    v-if="activeVertexHighlight"
                    class="vertex-highlight"
                    :cx="activeVertexHighlight.x"
                    :cy="activeVertexHighlight.y"
                    :r="activeVertexHighlight.r"
                    fill="none"
                    :stroke="getLayerColor(activeVertexHighlight.layerId as string, 0.95)"
                    :stroke-width="vertexHighlightStrokeWidthWorld"
                    filter="url(#vertex-glow)"
                    pointer-events="none"
                  />

                  <!-- Selected vertex highlight -->
                  <circle
                    v-if="selectedVertexHighlight"
                    class="vertex-highlight vertex-highlight--selected"
                    :cx="selectedVertexHighlight.x"
                    :cy="selectedVertexHighlight.y"
                    :r="selectedVertexHighlight.r"
                    fill="none"
                    :stroke="getLayerColor(selectedVertexHighlight.layerId as string, 0.85)"
                    :stroke-width="vertexHighlightStrokeWidthWorld"
                    filter="url(#vertex-glow)"
                    pointer-events="none"
                  />

                  <!-- Selected polygon vertex -->
                  <g v-if="selectedPolygon">
                    <circle
                      v-for="(p, idx) in selectedPolygon.points"
                      :key="`${selectedPolygon.id}-v-${idx}`"
                      class="vertex-handle"
                      :cx="p.x"
                      :cy="p.y"
                      :r="isSelectedVertexHandle('polygon', selectedPolygon.id, idx) ? vertexHandleRadiusWorld * 1.35 : vertexHandleRadiusWorld"
                      :fill="getLayerColor(selectedPolygon.layerId, 0.95)"
                      stroke="rgba(255,255,255,0.9)"
                      :stroke-width="isSelectedVertexHandle('polygon', selectedPolygon.id, idx) ? vertexHandleStrokeWidthWorld * 2 : vertexHandleStrokeWidthWorld"
                      pointer-events="visibleFill"
                      @pointerdown="handlePolygonVertexPointerDown(selectedPolygon.id, idx, $event as PointerEvent)"
                    />
                  </g>

                  <!-- Selected polyline vertex -->
                  <g v-if="selectedPolyline">
                    <circle
                      v-for="(p, idx) in selectedPolyline.points"
                      :key="`${selectedPolyline.id}-v-${idx}`"
                      class="vertex-handle"
                      :cx="p.x"
                      :cy="p.y"
                      :r="isSelectedVertexHandle('polyline', selectedPolyline.id, idx) ? vertexHandleRadiusWorld * 1.35 : vertexHandleRadiusWorld"
                      :fill="getLayerColor(selectedPolyline.layerId, 0.95)"
                      stroke="rgba(255,255,255,0.9)"
                      :stroke-width="isSelectedVertexHandle('polyline', selectedPolyline.id, idx) ? vertexHandleStrokeWidthWorld * 2 : vertexHandleStrokeWidthWorld"
                      pointer-events="visibleFill"
                      @pointerdown="handleLineVertexPointerDown(selectedPolyline.id, idx, $event as PointerEvent)"
                    />
                  </g>

                  <!-- Terrain brush removed -->
                </svg>

                <div class="planning-guides-overlay" :style="getGuidesOverlayStyle()" aria-hidden="true">
                  <div
                    v-for="guide in planningGuides"
                    :key="guide.id"
                    class="planning-guide-line"
                    :class="`planning-guide-line--${guide.axis}`"
                    :style="getGuideLineStyle(guide)"
                  />
                  <div
                    v-if="guideDraft"
                    class="planning-guide-line planning-guide-line--draft"
                    :class="`planning-guide-line--${guideDraft.axis}`"
                    :style="getGuideLineStyle(guideDraft)"
                  />
                  <!-- hover guides removed -->
                </div>
                <div
                  v-for="(image, index) in planningImages"
                  :key="image.id"
                  :class="[
                    'planning-image',
                    {
                      active: activeImageId === image.id,
                      moving: dragState.type === 'move-image-layer' && dragState.imageId === image.id,
                    },
                  ]"
                  :style="getImageLayerStyle(image, index)"
                  @pointerdown="handleImageLayerPointerDown(image.id, $event as PointerEvent)"
                >
                  <img
                    class="planning-image-img"
                    :src="image.url"
                    :alt="image.name"
                    draggable="false"
                  >
                  <div
                    v-if="activeImageId === image.id"
                    class="planning-image__frame"
                    aria-hidden="false"
                  >
                    <div class="planning-image__border" />
                    <div
                      class="image-resize-handle image-resize-handle--nw"
                      @pointerdown.stop="handleImageResizePointerDown(image.id, 'nw', $event as PointerEvent)"
                    />
                    <div
                      class="image-resize-handle image-resize-handle--n"
                      @pointerdown.stop="handleImageResizePointerDown(image.id, 'n', $event as PointerEvent)"
                    />
                    <div
                      class="image-resize-handle image-resize-handle--ne"
                      @pointerdown.stop="handleImageResizePointerDown(image.id, 'ne', $event as PointerEvent)"
                    />
                    <div
                      class="image-resize-handle image-resize-handle--e"
                      @pointerdown.stop="handleImageResizePointerDown(image.id, 'e', $event as PointerEvent)"
                    />
                    <div
                      class="image-resize-handle image-resize-handle--se"
                      @pointerdown.stop="handleImageResizePointerDown(image.id, 'se', $event as PointerEvent)"
                    />
                    <div
                      class="image-resize-handle image-resize-handle--s"
                      @pointerdown.stop="handleImageResizePointerDown(image.id, 's', $event as PointerEvent)"
                    />
                    <div
                      class="image-resize-handle image-resize-handle--sw"
                      @pointerdown.stop="handleImageResizePointerDown(image.id, 'sw', $event as PointerEvent)"
                    />
                    <div
                      class="image-resize-handle image-resize-handle--w"
                      @pointerdown.stop="handleImageResizePointerDown(image.id, 'w', $event as PointerEvent)"
                    />
                  </div>
                </div>

                <div
                  v-for="image in planningImages"
                  :key="`${image.id}-align-marker`"
                  class="align-marker"
                  :class="{ active: activeImageId === image.id }"
                  :style="getAlignMarkerStyle(image)"
                  @pointerdown="handleAlignMarkerPointerDown(image.id, $event as PointerEvent)"
                />
              </div>

              <div class="canvas-boundary-overlay" :style="canvasBoundaryStyle" />
            </div>

            <div v-if="scaleBarSpec.label" class="scale-bar-overlay" aria-hidden="true">
              <div class="scale-bar">
                <div class="scale-bar__label">{{ scaleBarSpec.label }}</div>
                <div class="scale-bar__ruler" :style="{ width: `${scaleBarSpec.pixels}px` }">
                  <div class="scale-bar__tick scale-bar__tick--left" />
                  <div class="scale-bar__tick scale-bar__tick--right" />
                </div>
              </div>
            </div>
          </div>
        </main>

        <aside
          class="property-panel"
          :class="{
            'property-panel--disabled': propertyPanelDisabled,
          }"
        >
            <header class="property-panel__header">
            <div class="property-panel__title">
              <div v-if="selectedScatterTarget" class="property-panel__subtitle">
                <v-text-field
                  v-model="selectedName"
                  density="compact"
                  hide-details
                  :disabled="propertyPanelDisabled"
                  placeholder="Set shape name"
                  @update:modelValue="commitSelectedName"
                />
              </div>
            </div>
          </header>

          <div class="property-panel__body">
          <div v-if="propertyPanelDisabled" class="property-panel__placeholder">
            <v-icon icon="mdi-shape-outline" size="28" />
            <span>{{ propertyPanelDisabledReason }}</span>
          </div>
          <template v-else>
            <div v-if="selectedImage">
              <div class="property-panel__block">
                <div style="display:flex;gap:8px;align-items:center;">
                  <v-text-field
                    v-model="imageNameModel"
                    density="compact"
                    hide-details
                    :disabled="propertyPanelDisabled"
                    style="flex:1"
                  />
                </div>
              </div>

              <div class="property-panel__density">
                <div class="property-panel__density-title">Opacity</div>
                <div class="property-panel__density-row">
                  <v-slider v-model="imageOpacityModel" min="0" max="1" step="0.01" density="compact" hide-details />
                  <div class="property-panel__density-value">{{ Math.round(imageOpacityModel * 100) }}%</div>
                </div>
              </div>
            </div>

            <div v-if="selectedMeasurementTitle" class="property-panel__density">
              <div class="property-panel__density-title">{{ selectedMeasurementTitle }}</div>
              <div class="property-panel__density-row">
                <v-text-field
                  :model-value="selectedMeasurementValueText"
                  density="compact"
                  variant="underlined"
                  hide-details
                  readonly
                  :suffix="selectedMeasurementSuffix"
                />
              </div>
            </div>

            <!-- Per-shape terrain contour height -->
            <div v-if="selectedTerrainContourPolygon" class="property-panel__block">
              <v-text-field
                v-model.number="terrainContourHeightModel"
                type="number"
                step="0.1"
                density="compact"
                variant="underlined"
                hide-details
                suffix="m"
                label="Height"
              />
              <v-text-field
                v-model.number="terrainContourBlendModel"
                type="number"
                step="0.1"
                density="compact"
                variant="underlined"
                hide-details
                suffix="m"
                label="Smoothing"
              />
              <v-select
                v-model="terrainContourWaterPresetModel"
                :items="terrainWaterPresetOptions"
                item-title="label"
                item-value="value"
                density="compact"
                variant="underlined"
                hide-details
                label="Water Type"
                :disabled="propertyPanelDisabled || !terrainContourWaterPresetEnabled"
              />
            </div>

            <!-- Air Wall control block (separate) -->
            <div v-if="selectedTerrainContourPolygon" class="property-panel__block">
              <v-switch
                v-model="airWallEnabledModel"
                density="compact"
                hide-details
                label="Air Wall"
              />
            </div>
            <!-- terrain / guide-route: no extra property controls -->
          </template>
          </div>
        </aside>

      </section>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.planning-dialog {
  width: 100vw;
  height: 100vh;
  max-width: 100%;
  max-height: 100vh;
  margin: 0;
  border-radius: 0;
  display: flex;
  flex-direction: column;
  background: #0c111a;
  color: #f4f6fb;
  border: 1px solid rgba(98, 179, 255, 0.5);
  box-shadow:
    0 0 0 2px rgba(98, 179, 255, 0.3),
    0 0 32px rgba(98, 179, 255, 0.35),
    0 18px 60px rgba(0, 0, 0, 0.55);
}

.planning-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.planning-dialog__header .title {
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.planning-dialog__header .header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.planning-dialog__content {
  flex: 1;
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr) 320px;
  grid-template-rows: 1fr;
  align-items: stretch;
  gap: 12px;
  padding: 20px 28px 28px;
  overflow: hidden;
  min-height: 0;
}

.left-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
}

.layer-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.layer-panel header {
  flex: 0 0 auto;
}

.layer-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.upload-error {
  margin-top: 8px;
  color: #ff8a65;
  font-size: 0.85rem;
}

.layer-item.active {
  border-color: rgba(255, 255, 255, 0.26);
  filter: saturate(1.2) brightness(1.08);
}

.layer-item.active .layer-name {
  font-weight: 700;
}

.layer-item.dragging {
  opacity: 0.65;
}

.layer-item.drag-over {
  outline: 1px dashed rgba(255, 255, 255, 0.35);
  outline-offset: 2px;
}

.layer-rename-input {
  width: 100%;
}

.layer-conversion-toggle {
  margin-inline-end: 4px;
}

.layer-conversion-chip {
  display: inline-flex;
  align-items: center;
  margin-inline-start: 8px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.72);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.property-panel__density {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
}

.property-panel__block {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.property-panel__density-title {
  font-size: 0.9rem;
  font-weight: 600;
  margin-bottom: 6px;
}

.property-panel__spacing-title {
  font-size: 0.9rem;
  font-weight: 600;
  margin-top: 10px;
  margin-bottom: 6px;
}

.property-panel__density-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 10px;
}

.property-panel__density-value {
  min-width: 52px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: rgba(244, 246, 251, 0.92);
}

.property-panel__density-hint {
  margin-top: 4px;
  font-size: 0.78rem;
  color: rgba(244, 246, 251, 0.75);
}

.layer-item.active .layer-meta {
  opacity: 0.9;
}

.layer-content {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.layer-name {
  font-weight: 600;
}

.layer-meta {
  font-size: 0.75rem;
  opacity: 0.7;
  display: flex;
  gap: 12px;
}

.property-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  min-height: 0;
  position: relative;
  overflow: hidden;
}

.property-panel--disabled {
  opacity: 0.45;
  pointer-events: none;
}

.property-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.property-panel__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 6px;
}

.property-panel__title {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

.property-panel__title h3 {
  margin: 0;
  font-size: 1rem;
}

.property-panel__subtitle {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.6);
}

.property-panel__placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.52);
  text-align: center;
}

.property-panel__tabs :deep(.v-tab) {
  min-height: 26px;
  min-width: 26px;
  padding: 0;
  justify-content: center;
}

.property-panel__tabs {
  margin-bottom: 8px;
}

.property-panel__tabs :deep(.v-tab.v-tab.v-btn) {
  width: 40px;
  height: 30px;
  min-width: 40px;
}

.property-panel__window {
  flex: 1;
  min-height: 0;
  display: flex;
}

.property-panel__window :deep(.v-window-item) {
  flex: 1;
  display: flex;
}

.property-panel__window :deep(.v-window-item > *) {
  flex: 1;
  display: flex;
}

.property-panel__window :deep(.asset-painter) {
  flex: 1;
  overflow: hidden;
}

.property-panel__window :deep(.thumbnail-grid) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 2px;
  padding-right: 2px;
}

.property-panel__scatter-preview {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
}

.scatter-preview__thumbnail {
  width: 68px;
  height: 68px;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
}

.scatter-preview__thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.scatter-preview__placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.45);
}

.scatter-preview__meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.scatter-preview__name {
  font-size: 0.95rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.scatter-preview__category {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.65);
}

.scatter-preview__category--empty {
  color: rgba(255, 255, 255, 0.45);
}

/* Align panel header: title left, buttons right */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.panel-header h3 {
  margin: 0;
  font-size: 1rem;
}



.control-row {
  display: grid;
  grid-template-columns: 60px 1fr 45px;
  align-items: center;
  gap: 8px;
}

.control-label {
  font-size: 0.75rem;
  opacity: 0.8;
}

.control-value {
  font-size: 0.75rem;
  opacity: 0.7;
  text-align: right;
}

.editor-panel {
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  background: rgba(8, 10, 16, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.05);
  min-height: 0;
  height: 100%;
  width: 100%;
}

.toolbar {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.tool-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1 1 auto;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}

.zoom-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.zoom-slider {
  width: 140px;
}

.zoom-value {
  font-size: 0.85rem;
  opacity: 0.75;
  min-width: 44px;
  text-align: right;
}

.tool-button {
  min-width: 44px;
  width: 44px;
  height: 44px;
  padding: 0;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.tool-info {
  font-size: 0.85rem;
  opacity: 0.7;
}

.editor-canvas {
  flex: 1;
  min-height: 0;
  border-radius: 16px;
  overflow: hidden;
  position: relative;
  background-color: rgba(56, 66, 92, 0.82);
  border-top: 1px solid rgba(255, 255, 255, 0.03);
  touch-action: none;
}

.canvas-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.canvas-stage {
  position: relative;
  transform-origin: top left;
  will-change: transform;
}

.canvas-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: rgba(255, 255, 255, 0.6);
  pointer-events: none;
}

.planning-svg {
  width: 100%;
  height: 100%;
  cursor: crosshair;
}

.planning-image {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: auto;
}

.planning-image.active {
  filter: none;
}

.planning-image-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
  pointer-events: none;
}

/* Active image frame + resize handles */
.planning-image__frame {
  position: absolute;
  inset: 0;
  pointer-events: none; /* allow clicks through except on inner border/handles */
  z-index: 30;
}
.planning-image__border {
  position: absolute;
  inset: 0;
  border: 2px dashed rgba(98, 179, 255, 0.9);
  box-shadow: 0 4px 12px rgba(0,0,0,0.35);
  border-radius: 2px;
  pointer-events: auto; /* capture hover/clicks for move */
  cursor: grab;
}
.planning-image__border:active {
  cursor: grabbing;
}
.planning-image.moving .planning-image__border {
  cursor: grabbing;
}
.image-resize-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.25);
  box-shadow: 0 1px 2px rgba(0,0,0,0.12);
  border-radius: 2px;
  transform: translate(-50%, -50%);
  pointer-events: auto; /* handles receive pointer events */
}
.image-resize-handle--nw { left: 0%; top: 0%; cursor: nwse-resize; }
.image-resize-handle--n  { left: 50%; top: 0%; cursor: ns-resize; }
.image-resize-handle--ne { left: 100%; top: 0%; cursor: nesw-resize; }
.image-resize-handle--e  { left: 100%; top: 50%; cursor: ew-resize; }
.image-resize-handle--se { left: 100%; top: 100%; cursor: nwse-resize; }
.image-resize-handle--s  { left: 50%; top: 100%; cursor: ns-resize; }
.image-resize-handle--sw { left: 0%; top: 100%; cursor: nesw-resize; }
.image-resize-handle--w  { left: 0%; top: 50%; cursor: ew-resize; }

.scatter-thumb {
  pointer-events: none;
  opacity: 0.95;
}

.scatter-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(18, 22, 30, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.18);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  backdrop-filter: blur(2px);
}

.scatter-overlay__thumbnail {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.scatter-overlay__placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.65);
  pointer-events: none;
}

.vector-overlay {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 5000;
  pointer-events: none;
}

.planning-guides-overlay {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 9000;
  pointer-events: none;
}

.planning-guide-line {
  position: absolute;
  background: rgba(244, 246, 251, 0.5);
}

.planning-guide-line--x {
  width: 1px;
}

.planning-guide-line--y {
  height: 1px;
}

.planning-guide-line--draft {
  background: rgba(244, 246, 251, 0.75);
}

.planning-guide-line--hover {
  background: rgba(244, 246, 251, 0.38);
}

.canvas-boundary-overlay {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 6000;
  border: 2px solid rgba(0, 229, 255, 0.75);
  box-shadow:
    0 0 6px rgba(0, 229, 255, 0.6),
    0 0 14px rgba(0, 229, 255, 0.45),
    0 0 24px rgba(0, 229, 255, 0.35);
  pointer-events: none;
}

.scale-bar-overlay {
  position: absolute;
  left: calc(12px + var(--planning-ruler-thickness, 0px));
  bottom: 12px;
  z-index: 6500;
  pointer-events: none;
}

.scale-bar {
  padding: 8px 10px;
  border-radius: 12px;
  background: rgba(18, 22, 30, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(2px);
  color: rgba(244, 246, 251, 0.92);
  font-variant-numeric: tabular-nums;
}

.scale-bar__label {
  font-size: 0.78rem;
  line-height: 1.1;
  margin-bottom: 6px;
  opacity: 0.92;
}

.scale-bar__ruler {
  position: relative;
  height: 10px;
  border-bottom: 2px solid rgba(244, 246, 251, 0.92);
}

.scale-bar__tick {
  position: absolute;
  bottom: -1px;
  width: 2px;
  height: 8px;
  background: rgba(244, 246, 251, 0.92);
}

.scale-bar__tick--left {
  left: 0;
}

.scale-bar__tick--right {
  right: 0;
}

.planning-polygon,
.planning-line,
.planning-line-segment,
.vertex-handle,
.line-endpoint-hit {
  pointer-events: auto;
}

.planning-line {
  stroke-linecap: round;
  stroke-linejoin: round;
  cursor: pointer;
}

.planning-line-segment {
  cursor: cell;
}

.planning-rectangle-preview,
.planning-polygon-draft,
.planning-line-draft {
  pointer-events: none;
}

.vertex-highlight {
  pointer-events: none;
}

.vertex-handle {
  cursor: grab;
  pointer-events: visibleFill;
}

.align-marker {
  position: absolute;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  border: 2px solid rgba(255, 255, 255, 0.9);
  cursor: grab;
  pointer-events: auto;
  will-change: transform;
}

.align-marker::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  transform: translate(-50%, -50%) scale(1);
  background: var(--marker-accent, rgba(255, 255, 255, 0.85));
  opacity: 0.42;
  filter: blur(0.2px);
  box-shadow: 0 0 0 0 var(--marker-accent, rgba(255, 255, 255, 0.6));
  animation: align-marker-pulse 1.6s ease-out infinite;
  pointer-events: none;
}

.align-marker.active::after {
  animation-duration: 1.2s;
  opacity: 0.55;
}

@keyframes align-marker-pulse {
  0% {
    transform: translate(-50%, -50%) scale(1);
    opacity: 0.5;
  }
  65% {
    transform: translate(-50%, -50%) scale(2.4);
    opacity: 0;
  }
  100% {
    transform: translate(-50%, -50%) scale(2.4);
    opacity: 0;
  }
}

.align-marker:active {
  cursor: grabbing;
}

.align-marker.active {
  border-color: rgba(255, 255, 255, 1);
}

.resize-handle {
  fill: transparent;
  stroke: none;
  pointer-events: all;
}

.planning-polygon {
  fill-opacity: 0.32;
  cursor: pointer;
}

.planning-polygon.selected {
  stroke-width: 0.5;
}

.planning-line {
  stroke-linecap: round;
  stroke-linejoin: round;
}

.planning-line.draft {
  stroke: rgba(255, 255, 255, 0.75);
  stroke-dasharray: 6 4;
}

.inactive-layer-feature {
  opacity: 0.22;
}

.planning-polygon.draft {
  fill: rgba(255, 255, 255, 0.12);
  stroke: rgba(255, 255, 255, 0.8);
  stroke-dasharray: 6 4;
}

.vertex-handle {
  cursor: pointer;
  stroke: #ffffff;
  stroke-width: 0.2;
}

.vertex-handle.line {
  r: 1.5;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  border: 0;
  padding: 0;
  clip: rect(0, 0, 0, 0);
  overflow: hidden;
}

/* Truncate long layer/image names and show full name in tooltip activator */
.layer-name--truncated {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.property-panel__wall-preset {
  width: 100%;
}

.property-panel__floor-preset {
  width: 100%;
}

.property-panel__preset-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}

.property-panel__wall-preset :deep(.asset-picker-list__body) {
  min-height: 170px;
  max-height: 260px;
  padding: 8px 10px;
}

.property-panel__wall-preset :deep(.asset-picker-list__grid) {
  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
}

.property-panel__floor-preset :deep(.asset-picker-list__body) {
  min-height: 170px;
  max-height: 260px;
  padding: 8px 10px;
}

.property-panel__floor-preset :deep(.asset-picker-list__grid) {
  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
}
</style>
