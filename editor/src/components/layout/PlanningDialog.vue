<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch, watchEffect } from 'vue'
import type { CSSProperties } from 'vue'
import { storeToRefs } from 'pinia'
import { generateUuid } from '@/utils/uuid'
import { useSceneStore } from '@/stores/sceneStore'
import { useUiStore } from '@/stores/uiStore'
import GroundAssetPainter from '@/components/inspector/GroundAssetPainter.vue'
import AssetPickerList from '@/components/common/AssetPickerList.vue'
import PlanningRulers from '@/components/layout/PlanningRulers.vue'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'
import { terrainScatterPresets } from '@/resources/projectProviders/asset'
import type { TerrainScatterCategory } from '@harmony/schema/terrain-scatter'
import type { ProjectAsset } from '@/types/project-asset'
import { clearPlanningGeneratedContent, convertPlanningTo3DScene } from '@/utils/planningToScene'
import { generateFpsScatterPointsInPolygon, buildRandom, hashSeedFromString, getPointsBounds, polygonCentroid } from '@/utils/scatterSampling'
import { normalizeLayerPolylines } from '@/utils/normalizeLayerPolylines'
import { WALL_DEFAULT_SMOOTHING, WATER_PRESETS, type WaterPresetId } from '@schema/components'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { isWallPresetFilename } from '@/utils/wallPreset'
import { isFloorPresetFilename } from '@/utils/floorPreset'
import { getCachedModelObject, getOrLoadModelObject } from '@schema/modelObjectCache'
import { loadObjectFromFile } from '@schema/assetImport'
import { computeOccupancyMinDistance, computeOccupancyTargetCount } from '@/utils/scatterOccupancy'
import { snapCandidatePointToAnglesRelative } from '@/utils/angleSnap'

import type {
  PlanningTerrainData,
  PlanningTerrainBudget,
  PlanningTerrainControlPoint,
  PlanningTerrainFalloff,
  PlanningTerrainNoiseMode,
  PlanningTerrainRidgeValleyLine,
} from '@/types/planning-scene-data'


const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>()
const dialogOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const sceneStore = useSceneStore()
const { currentSceneId } = storeToRefs(sceneStore)
const uiStore = useUiStore()
const assetCacheStore = useAssetCacheStore()

function computeFootprintFromCachedModelBounds(assetId: string): { footprintAreaM2: number; footprintMaxSizeM: number } | null {
  const group = getCachedModelObject(assetId)
  const box = group?.boundingBox
  if (!group || !box || box.isEmpty()) {
    return null
  }
  const sizeX = Math.abs(box.max.x - box.min.x)
  const sizeZ = Math.abs(box.max.z - box.min.z)
  if (!Number.isFinite(sizeX) || !Number.isFinite(sizeZ) || sizeX <= 1e-4 || sizeZ <= 1e-4) {
    return null
  }
  const footprintAreaM2 = Math.max(0.0001, sizeX * sizeZ)
  const footprintMaxSizeM = Math.max(0.01, Math.max(sizeX, sizeZ))
  return { footprintAreaM2, footprintMaxSizeM }
}

async function ensureModelBoundsCachedForAsset(asset: ProjectAsset): Promise<void> {
  if (!asset?.id) {
    return
  }
  if (getCachedModelObject(asset.id)) {
    return
  }
  try {
    await assetCacheStore.downloaProjectAsset(asset)
  } catch (_error) {
    return
  }
  const file = assetCacheStore.createFileFromCache(asset.id)
  if (!file) {
    return
  }
  try {
    await getOrLoadModelObject(asset.id, async () => loadObjectFromFile(file, asset.extension ?? undefined))
  } catch (_error) {
    // noop
  } finally {
    assetCacheStore.releaseInMemoryBlob(asset.id)
  }
}

type PlanningTool = 'select' | 'pan' | 'rectangle' | 'lasso' | 'line' | 'align-marker'
type LayerKind = 'terrain' | 'building' | 'road' | 'guide-route' | 'green' | 'wall' | 'floor' | 'water'

const layerKindLabels: Record<LayerKind, string> = {
  terrain: 'Terrain',
  building: 'Building',
  road: 'Road',
  'guide-route': 'Guide Route',
  floor: 'Floor',
  green: 'Green',
  wall: 'Wall',
  water: 'Water',
}

const addableLayerKinds: LayerKind[] = ['terrain', 'road', 'guide-route', 'floor', 'water', 'green', 'wall', 'building']

interface PlanningLayer {
  id: string
  name: string
  kind: LayerKind
  visible: boolean
  color: string
  locked: boolean
  /** Road layer width in meters (only used when kind === 'road'). */
  roadWidthMeters?: number
  /** Whether to show lane lines for road layer (only used when kind === 'road'). */
  roadLaneLines?: boolean
  /** Road layer smoothing (0-1) controlling the roundedness of junctions. */
  roadSmoothing?: number
  /** Water layer smoothing (0-1) controlling the edge rounding. */
  waterSmoothing?: number
  /** Floor layer smoothness (0-1) controlling the corner rounding. */
  floorSmooth?: number
  /** Wall layer height in meters (only used when kind === 'wall'). */
  wallHeightMeters?: number
  /** Wall layer thickness in meters (only used when kind === 'wall'). */
  wallThicknessMeters?: number
  /** Wall preset prefab asset id (.wall). Only used when kind === 'wall'. */
  wallPresetAssetId?: string | null
  /** Floor preset prefab asset id (.floor). Only used when kind === 'floor'. */
  floorPresetAssetId?: string | null
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

interface PlanningScatterAssignment {
  providerAssetId: string
  assetId: string
  category: TerrainScatterCategory
  name: string
  thumbnail: string | null
  /** 0-100. Default is 19 for green polygons, otherwise 50. Used to scale generated scatter count. */
  densityPercent: number
  /** Model bounding-box footprint area (m^2), used for capacity estimation. */
  footprintAreaM2: number
  /** Model bounding-box max side length (m), used to avoid overlap in dot preview. */
  footprintMaxSizeM: number
}

interface PlacedModel {
  id?: string
  assetId: string
  position: PlanningPoint
  rotation?: number
  scale?: number
}

interface PlanningPolygon {
  id: string
  name: string
  layerId: string
  points: PlanningPoint[]
  /** Height delta in meters (only meaningful when layer kind is 'terrain'). */
  terrainHeightMeters?: number
  scatter?: PlanningScatterAssignment
  /** When true, conversion will create/mark an air wall for this feature (layer-dependent). */
  airWallEnabled?: boolean
  /** Wall preset prefab asset id (.wall). When set, overrides the layer default. */
  wallPresetAssetId?: string | null
  /** Floor preset prefab asset id (.floor). When set, overrides the layer default. */
  floorPresetAssetId?: string | null
  /** Placed building models (only meaningful for building layer) */
  placedModels?: PlacedModel[]
}

interface PlanningPolyline {
  id: string
  name: string
  layerId: string
  points: PlanningPoint[]
  /** Guide-route waypoint metadata aligned with points (only meaningful when layer kind is 'guide-route'). */
  waypoints?: Array<{ name?: string; dock?: boolean }>
  scatter?: PlanningScatterAssignment
  /** 0-1. Only meaningful when layer kind is 'wall'. */
  cornerSmoothness?: number
  /** When true, conversion will create/mark an air wall for this feature (layer-dependent). */
  airWallEnabled?: boolean
  /** Wall preset prefab asset id (.wall). When set, overrides the layer default. */
  wallPresetAssetId?: string | null
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
  { id: 'terrain-layer', name: 'Terrain', kind: 'terrain', visible: true, color: '#6D4C41', locked: false },
  { id: 'green-layer', name: 'Greenery', kind: 'green', visible: true, color: '#00897B', locked: false },
  { id: 'road-layer', name: 'Road', kind: 'road', visible: true, color: '#F9A825', locked: false, roadWidthMeters: 2, roadLaneLines: false, roadSmoothing: 0.09 },
  { id: 'guide-route-layer', name: 'Guide Route', kind: 'guide-route', visible: true, color: '#039BE5', locked: false },
  { id: 'floor-layer', name: 'Floor', kind: 'floor', visible: true, color: '#1E88E5', locked: false, floorSmooth: 0.1 },
  { id: 'building-layer', name: 'Building', kind: 'building', visible: true, color: '#8D6E63', locked: false },
  { id: 'water-layer', name: 'Water', kind: 'water', visible: true, color: '#039BE5', locked: false, waterSmoothing: 0.1 },
  { id: 'wall-layer', name: 'Wall', kind: 'wall', visible: true, color: '#5E35B1', locked: false, wallHeightMeters: 8, wallThicknessMeters: 0.15, wallPresetAssetId: null },
]

const imageAccentPalette = layerPresets.map((layer) => layer.color)

const layers = ref<PlanningLayer[]>(layerPresets.map((layer) => ({ ...layer })))
// Single shared active list item for both layers and images.
// Represented as { type: 'layer'|'image', id: string } or null.
const activeListItem = ref<{ type: 'layer' | 'image'; id: string } | null>({ type: 'layer', id: layers.value[0]?.id ?? 'green-layer' })
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

type ScatterThumbPlacement = { x: number; y: number; size: number }

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function clampDensityPercent(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return 50
  return Math.round(clampNumber(num, 0, 100))
}

function clampWallCornerSmoothness(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return WALL_DEFAULT_SMOOTHING
  return Math.min(1, Math.max(0, num))
}

function defaultFootprintAreaM2(assetId: string | null, category: TerrainScatterCategory): number {
  void category
  if (assetId) {
    const derived = computeFootprintFromCachedModelBounds(assetId)
    if (derived) {
      return derived.footprintAreaM2
    }
  }
  return 1
}

function clampFootprintAreaM2(assetId: string | null, category: TerrainScatterCategory, value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num <= 0) {
    return defaultFootprintAreaM2(assetId, category)
  }
  return Math.min(1e6, Math.max(0.0001, num))
}

function defaultFootprintMaxSizeM(assetId: string | null, category: TerrainScatterCategory): number {
  void category
  if (assetId) {
    const derived = computeFootprintFromCachedModelBounds(assetId)
    if (derived) {
      return derived.footprintMaxSizeM
    }
  }
  return 1
}

function clampFootprintMaxSizeM(
  assetId: string | null,
  category: TerrainScatterCategory,
  value: unknown,
  fallbackAreaM2?: number,
): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num <= 0) {
    if (Number.isFinite(fallbackAreaM2) && (fallbackAreaM2 as number) > 0) {
      return Math.max(0.05, Math.sqrt(fallbackAreaM2 as number))
    }
    return defaultFootprintMaxSizeM(assetId, category)
  }
  return Math.min(1000, Math.max(0.01, num))
}



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
  const map: Record<number, RectCornerKey> = {} as any
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
  return map
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

function polylinePointAtDistance(points: PlanningPoint[], distance: number): PlanningPoint | null {
  if (points.length < 2) return null
  const total = polylineLength(points)
  if (total <= 1e-9) return null
  const target = clampNumber(distance, 0, total)
  let traveled = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!
    const b = points[i + 1]!
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    if (traveled + seg >= target) {
      const t = seg > 1e-9 ? (target - traveled) / seg : 0
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    traveled += seg
  }
  return points[points.length - 1] ?? null
}

function computePolygonScatterThumbPlacement(poly: PlanningPolygon): ScatterThumbPlacement | null {
  const thumb = poly.scatter?.thumbnail
  if (!thumb) return null
  const bounds = getPointsBounds(poly.points)
  if (!bounds) return null
  const minSide = Math.min(bounds.width, bounds.height)

  // Too small -> hide to avoid visual clutter.
  if (minSide < 8) return null

  const centroid = polygonCentroid(poly.points)
  if (!centroid) return null

  const size = clampNumber(minSide * 0.38, 7, 26)
  const padding = Math.max(0.5, size * 0.12)

  if (bounds.width < size + padding * 2 || bounds.height < size + padding * 2) {
    return null
  }

  const x = clampNumber(centroid.x - size * 0.5, bounds.minX + padding, bounds.maxX - size - padding)
  const y = clampNumber(centroid.y - size * 0.5, bounds.minY + padding, bounds.maxY - size - padding)
  return { x, y, size }
}

function computePolylineScatterThumbPlacement(line: PlanningPolyline): ScatterThumbPlacement | null {
  const thumb = line.scatter?.thumbnail
  if (!thumb) return null
  if (line.points.length < 2) return null

  const total = polylineLength(line.points)
  // Too short -> hide.
  if (total < 12) return null

  const mid = polylinePointAtDistance(line.points, total * 0.5)
  if (!mid) return null

  const bounds = getPointsBounds(line.points)
  const fallbackSize = clampNumber(total * 0.06, 7, 20)
  const size = bounds ? clampNumber(Math.min(fallbackSize, Math.max(bounds.width, bounds.height) * 0.35), 7, 20) : fallbackSize

  // Keep inside the canvas (lines are 1D so we clamp to stage bounds rather than the polyline bounds).
  const canvas = effectiveCanvasSize.value
  const padding = Math.max(0.5, size * 0.12)
  if (canvas.width < size + padding * 2 || canvas.height < size + padding * 2) {
    return null
  }
  const x = clampNumber(mid.x - size * 0.5, padding, canvas.width - size - padding)
  const y = clampNumber(mid.y - size * 0.5, padding, canvas.height - size - padding)
  return { x, y, size }
}

const polygonScatterThumbPlacements = computed<Record<string, ScatterThumbPlacement>>(() => {
  const result: Record<string, ScatterThumbPlacement> = {}
  for (const poly of visiblePolygons.value) {
    if (!poly.scatter?.thumbnail) continue
    const placement = computePolygonScatterThumbPlacement(poly)
    if (placement) {
      result[poly.id] = placement
    }
  }
  return result
})

const polylineScatterThumbPlacements = computed<Record<string, ScatterThumbPlacement>>(() => {
  const result: Record<string, ScatterThumbPlacement> = {}
  for (const line of visiblePolylines.value) {
    if (!line.scatter?.thumbnail) continue
    const placement = computePolylineScatterThumbPlacement(line)
    if (placement) {
      result[line.id] = placement
    }
  }
  return result
})

// Performance: green-layer scatter density dots are expensive (Poisson sampling).
// When users resize a green polygon, we suspend re-computation during the drag and
// only compute once after the drag finishes.
const suspendPolygonScatterDensityDots = ref(false)
const suspendedPolygonScatterDensityDotsKey = ref<{ pointerId: number; polygonId: string } | null>(null)

const polygonScatterDensityDotsCache = new Map<string, { key: string; dots: PlanningPoint[] }>()

function hashPlanningPoints(points: PlanningPoint[]): number {
  // Fast-ish stable hash for point arrays. Quantize to centimeters to avoid churn
  // from tiny floating differences.
  let hash = 2166136261
  for (const p of points) {
    const x = Math.round(p.x * 100)
    const y = Math.round(p.y * 100)
    hash ^= x
    hash = Math.imul(hash, 16777619)
    hash ^= y
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const SCATTER_CONTROLS_SUSPEND_KEY = '__scatter-controls__'
let scatterControlsPointerId: number | null = null
let scatterControlsListenersAttached = false

const scatterControlsTargetPolygonId = ref<string | null>(null)
const scatterDensityPercentDraft = ref<number | null>(null)

const scatterControlsInteracting = computed(() =>
  suspendedPolygonScatterDensityDotsKey.value?.polygonId === SCATTER_CONTROLS_SUSPEND_KEY,
)

function commitScatterControlsDraft() {
  if (propertyPanelDisabled.value) {
    scatterDensityPercentDraft.value = null
    scatterControlsTargetPolygonId.value = null
    return
  }

  const polygonId = scatterControlsTargetPolygonId.value
  if (!polygonId) {
    scatterDensityPercentDraft.value = null
    return
  }

  const polygon = polygons.value.find((item) => item.id === polygonId)
  if (!polygon?.scatter) {
    scatterDensityPercentDraft.value = null
    scatterControlsTargetPolygonId.value = null
    return
  }

  // Only meaningful for green polygons (planning -> terrain scatter).
  const layer = layers.value.find((item) => item.id === polygon.layerId)
  if (layer?.kind !== 'green') {
    scatterDensityPercentDraft.value = null
    scatterControlsTargetPolygonId.value = null
    return
  }

  let changed = false
  if (typeof scatterDensityPercentDraft.value === 'number') {
    const nextDensity = clampDensityPercent(scatterDensityPercentDraft.value)
    if (polygon.scatter.densityPercent !== nextDensity) {
      polygon.scatter.densityPercent = nextDensity
      changed = true
    }
  }

  scatterDensityPercentDraft.value = null
  scatterControlsTargetPolygonId.value = null

  if (changed) {
    markPlanningDirty()
  }
}

function handleScatterControlsBlur() {
  endScatterControlsInteraction()
}

function handleScatterControlsPointerEnd(event: PointerEvent) {
  if (scatterControlsPointerId != null && event.pointerId !== scatterControlsPointerId) {
    return
  }
  endScatterControlsInteraction()
}

function detachScatterControlsPointerListeners() {
  if (!scatterControlsListenersAttached) {
    return
  }
  scatterControlsListenersAttached = false
  window.removeEventListener('pointerup', handleScatterControlsPointerEnd, true)
  window.removeEventListener('pointercancel', handleScatterControlsPointerEnd, true)
  window.removeEventListener('blur', handleScatterControlsBlur, true)
}

function beginScatterControlsInteraction(event: PointerEvent) {
  if (!scatterDensityEnabled.value) {
    return
  }

  // Don't clobber a polygon drag suspension; that path manages its own resume.
  if (
    suspendPolygonScatterDensityDots.value &&
    suspendedPolygonScatterDensityDotsKey.value?.polygonId !== SCATTER_CONTROLS_SUSPEND_KEY
  ) {
    return
  }

  // Snapshot which polygon we're editing so we can commit on pointer-up.
  scatterControlsTargetPolygonId.value = selectedPolygon.value?.id ?? null
  scatterDensityPercentDraft.value = null

  suspendPolygonScatterDensityDots.value = true
  suspendedPolygonScatterDensityDotsKey.value = { pointerId: event.pointerId, polygonId: SCATTER_CONTROLS_SUSPEND_KEY }
  scatterControlsPointerId = event.pointerId

  if (!scatterControlsListenersAttached) {
    scatterControlsListenersAttached = true
    window.addEventListener('pointerup', handleScatterControlsPointerEnd, true)
    window.addEventListener('pointercancel', handleScatterControlsPointerEnd, true)
    window.addEventListener('blur', handleScatterControlsBlur, true)
  }
}

function endScatterControlsInteraction() {
  if (suspendedPolygonScatterDensityDotsKey.value?.polygonId !== SCATTER_CONTROLS_SUSPEND_KEY) {
    detachScatterControlsPointerListeners()
    scatterControlsPointerId = null
    return
  }

  // Commit while still suspended to avoid triggering expensive recompute per tick.
  commitScatterControlsDraft()

  suspendPolygonScatterDensityDots.value = false
  suspendedPolygonScatterDensityDotsKey.value = null
  scatterControlsPointerId = null
  detachScatterControlsPointerListeners()
}

onBeforeUnmount(() => {
  detachScatterControlsPointerListeners()
})

function computePolygonScatterDensityDots(): Record<string, PlanningPoint[]> {
  const result: Record<string, PlanningPoint[]> = {}
  const selected = selectedFeature.value
  let targetPolygonId: string | null = selected && selected.type === 'polygon' ? selected.id : null
  if (!targetPolygonId) {
    const state = dragState.value
    if (state.type === 'move-polygon') {
      targetPolygonId = state.polygonId
    } else if (state.type === 'drag-vertex' && state.feature === 'polygon') {
      targetPolygonId = state.targetId
    }
  }

  const visibleIds = new Set<string>()
  for (const poly of visiblePolygons.value) {
    visibleIds.add(poly.id)

    // Performance: only compute dots for the currently selected / edited polygon.
    if (targetPolygonId && poly.id !== targetPolygonId) {
      continue
    }

    // If there's no scatter configuration, ensure no cache entry exists and skip
    if (!poly.scatter) {
      polygonScatterDensityDotsCache.delete(poly.id)
      continue
    }

    // Only show density preview for green layers (planning -> terrain scatter)
    const layerKind = getLayerKind(poly.layerId)
    if (layerKind !== 'green') {
      polygonScatterDensityDotsCache.delete(poly.id)
      continue
    }

    // Normalize density percent (0-100). 0 or negative means generate no points
    const densityPercent = clampDensityPercent(poly.scatter.densityPercent)
    if (densityPercent <= 0) {
      polygonScatterDensityDotsCache.delete(poly.id)
      continue
    }

    // Compute model footprint values: prefer cached bounding-box inference, fallback to asset metadata
    const footprintAreaM2 = clampFootprintAreaM2(poly.scatter.assetId, poly.scatter.category, poly.scatter.footprintAreaM2)
    const footprintMaxSizeM = clampFootprintMaxSizeM(
      poly.scatter.assetId,
      poly.scatter.category,
      poly.scatter.footprintMaxSizeM,
      footprintAreaM2,
    )

    // Read selected scatter preset (for scale range and capacity estimation)
    const preset = terrainScatterPresets[poly.scatter.category]
    const minScale = preset && Number.isFinite(preset.minScale) ? preset.minScale : 1
    const maxScale = preset && Number.isFinite(preset.maxScale) ? preset.maxScale : 1

    // Polygon geometry filtering: skip if no bounds
    const bounds = getPointsBounds(poly.points)
    if (!bounds) {
      polygonScatterDensityDotsCache.delete(poly.id)
      continue
    }
    const area = polygonArea(poly.points)
    if (!Number.isFinite(area) || area <= 0) {
      polygonScatterDensityDotsCache.delete(poly.id)
      continue
    }

    const { targetCount: targetDots } = computeOccupancyTargetCount({
      areaM2: area,
      footprintAreaM2,
      densityPercent,
      minScale,
      maxScale,
    })
    if (targetDots <= 0) {
      polygonScatterDensityDotsCache.delete(poly.id)
      continue
    }

    const { minDistance, expectedScaleSq } = computeOccupancyMinDistance({
      footprintMaxSizeM,
      minScale,
      maxScale,
      minFloor: 0.05,
    })

    // Build cache key from polygon points and parameters to avoid repeated expensive computation
    const pointsHash = hashPlanningPoints(poly.points)
    const cacheKey = `${pointsHash}|${poly.points.length}|${Math.round(area)}|${densityPercent}|${targetDots}|${Math.round(footprintAreaM2 * 1000)}|${Math.round(footprintMaxSizeM * 1000)}|${Math.round(expectedScaleSq * 1000)}`
    const cached = polygonScatterDensityDotsCache.get(poly.id)
    if (cached?.key === cacheKey) {
      if (cached.dots.length) {
        result[poly.id] = cached.dots
      }
      continue
    }

    // Cap preview point count to maintain interactivity
    const cappedTarget = Math.min(800, targetDots)
    // Use stable RNG seed so previews are reproducible for identical inputs
    const random = buildRandom(hashSeedFromString(`${poly.id}:${densityPercent}:${targetDots}:${Math.round(footprintAreaM2 * 1000)}:${Math.round(footprintMaxSizeM * 1000)}:${Math.round(expectedScaleSq * 1000)}`))

    // Apply a lower bound to minimum distance to avoid sampling issues with very small values
    const minDistanceForDots = Math.max(minDistance, 0.05)
    const selected = generateFpsScatterPointsInPolygon({
      polygon: poly.points,
      targetCount: cappedTarget,
      minDistance: minDistanceForDots,
      random,
      // maxCandidates controls the number of attempts in the FPS algorithm; adjusted by target count to trade off performance and quality
      maxCandidates: Math.min(4000, Math.max(800, Math.ceil(cappedTarget * 6))),
    })

    // Cache results to hit on repeated short-term requests
    polygonScatterDensityDotsCache.set(poly.id, { key: cacheKey, dots: selected })
    if (selected.length) {
      result[poly.id] = selected
    }
  }

  // Prune cache entries for polygons that are no longer visible.
  if (polygonScatterDensityDotsCache.size) {
    for (const key of polygonScatterDensityDotsCache.keys()) {
      if (!visibleIds.has(key)) {
        polygonScatterDensityDotsCache.delete(key)
      }
    }
  }
  return result
}

const polygonScatterDensityDots = shallowRef<Record<string, PlanningPoint[]>>({})
watchEffect(() => {
  if (suspendPolygonScatterDensityDots.value) {
    return
  }
  polygonScatterDensityDots.value = computePolygonScatterDensityDots()
})

function hidePolygonScatterDensityDots(polygonId: string) {
  const current = polygonScatterDensityDots.value
  if (!(polygonId in current)) {
    return
  }
  const next = { ...current }
  delete next[polygonId]
  polygonScatterDensityDots.value = next
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
const ROAD_ENDPOINT_WELD_PX = 6
const ROAD_INTERSECTION_MERGE_PX = 8
const ROAD_SHORT_SEGMENT_CLEAN_PX = 10
const VERTEX_HANDLE_DIAMETER_PX = 10
const VERTEX_HANDLE_RADIUS_PX = VERTEX_HANDLE_DIAMETER_PX / 2
const VERTEX_HIT_RADIUS_PX = 14
const VERTEX_HANDLE_STROKE_PX = 1
const VERTEX_HIGHLIGHT_EXTRA_RADIUS_PX = 6
const VERTEX_HIGHLIGHT_STROKE_PX = 2

// Scatter density dots should stay readable at any zoom level.
const SCATTER_DENSITY_DOT_RADIUS_PX = 3.5
const SCATTER_DENSITY_DOT_STROKE_PX = 1

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

function getRoadNormalizeEpsWorld() {
  return {
    endpoints: pxToWorld(ROAD_ENDPOINT_WELD_PX),
    intersection: pxToWorld(ROAD_INTERSECTION_MERGE_PX),
    shortSegment: pxToWorld(ROAD_SHORT_SEGMENT_CLEAN_PX),
  }
}

function normalizeRoadLayerIfNeeded(layerId: string | null | undefined) {
  if (!layerId) return
  if (getLayerKind(layerId) !== 'road') return

  const eps = getRoadNormalizeEpsWorld()
  const result = normalizeLayerPolylines({
    layerId,
    layerName: getLayerName(layerId),
    polylines: polylines.value as any,
    eps,
    createVertexId: () => createId('v'),
    quantize: (n: number) => Number(Number(n).toFixed(2)),
  })

  if (!result.changed) {
    return
  }

  polylines.value = result.nextPolylines as any

  // Remap selection when line ids are merged.
  if (selectedFeature.value?.type === 'polyline') {
    const mapped = result.lineIdMap[selectedFeature.value.id]
    if (mapped) {
      selectedFeature.value = { type: 'polyline', id: mapped }
    } else {
      const selectedId = selectedFeature.value.id
      if (!polylines.value.find((l) => l.id === selectedId)) {
      selectedFeature.value = null
      selectedVertex.value = null
      }
    }
  } else if (selectedFeature.value?.type === 'segment') {
    const mapped = result.lineIdMap[selectedFeature.value.lineId]
    if (mapped) {
      selectedFeature.value = { type: 'polyline', id: mapped }
    } else {
      selectedFeature.value = null
      selectedVertex.value = null
    }
  }

  if (selectedVertex.value?.feature === 'polyline') {
    const mapped = result.lineIdMap[selectedVertex.value.targetId]
    if (mapped) {
      selectedVertex.value = null
    }
  }
}

const vertexHandleRadiusWorld = computed(() => pxToWorld(VERTEX_HANDLE_RADIUS_PX))
const vertexHandleHitRadiusWorld = computed(() => pxToWorld(VERTEX_HIT_RADIUS_PX))
const vertexHandleStrokeWidthWorld = computed(() => pxToWorld(VERTEX_HANDLE_STROKE_PX))
const vertexHighlightRadiusWorld = computed(() => pxToWorld(VERTEX_HANDLE_RADIUS_PX + VERTEX_HIGHLIGHT_EXTRA_RADIUS_PX))
const vertexHighlightStrokeWidthWorld = computed(() => pxToWorld(VERTEX_HIGHLIGHT_STROKE_PX))

const scatterDensityDotRadiusWorld = computed(() => pxToWorld(SCATTER_DENSITY_DOT_RADIUS_PX))
const scatterDensityDotStrokeWidthWorld = computed(() => pxToWorld(SCATTER_DENSITY_DOT_STROKE_PX))

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



function buildPlanningSnapshot() {
  return {
    version: 1 as const,
    activeLayerId: activeLayerId.value,
    layers: layers.value.map((layer) => ({
      id: layer.id,
      name: layer.name,
      kind: layer.kind,
      color: layer.color,
      visible: layer.visible,
      locked: layer.locked,
        roadWidthMeters: layer.roadWidthMeters,
        roadLaneLines: layer.roadLaneLines,
        roadSmoothing: layer.roadSmoothing,
      waterSmoothing: layer.waterSmoothing,
      floorSmooth: layer.floorSmooth,
            wallHeightMeters: layer.wallHeightMeters,
      wallThicknessMeters: layer.wallThicknessMeters,
      // layer-level wall presets are no longer persisted
    })),
    viewTransform: {
      scale: viewTransform.scale,
      offset: { x: viewTransform.offset.x, y: viewTransform.offset.y },
    },
    guides: planningGuides.value.map((g) => ({ id: g.id, axis: g.axis, value: g.value })),
    terrain: buildTerrainSnapshot(),
    polygons: polygons.value.map((poly) => ({
      id: poly.id,
      name: poly.name,
      layerId: poly.layerId,
      points: poly.points.map((p) => ({ x: p.x, y: p.y })),
      terrainHeightMeters: getLayerKind(poly.layerId) === 'terrain'
        ? (Number.isFinite(Number((poly as any).terrainHeightMeters)) ? Math.round(Number((poly as any).terrainHeightMeters) * 100) / 100 : undefined)
        : undefined,
      airWallEnabled: poly.airWallEnabled ? true : undefined,
      wallPresetAssetId: poly.wallPresetAssetId ?? null,
      floorPresetAssetId: poly.floorPresetAssetId ?? null,
      scatter: poly.scatter
        ? (() => {
          const footprintAreaM2 = clampFootprintAreaM2(poly.scatter.assetId, poly.scatter.category, poly.scatter.footprintAreaM2)
          const footprintMaxSizeM = clampFootprintMaxSizeM(
            poly.scatter.assetId,
            poly.scatter.category,
            poly.scatter.footprintMaxSizeM,
            footprintAreaM2,
          )
          return {
            providerAssetId: poly.scatter.providerAssetId,
            assetId: poly.scatter.assetId,
            category: poly.scatter.category,
            name: poly.scatter.name,
            thumbnail: poly.scatter.thumbnail,
            densityPercent: clampDensityPercent(poly.scatter.densityPercent),
            footprintAreaM2,
            footprintMaxSizeM,
          }
        })()
        : undefined,
    })),
    polylines: polylines.value.map((line) => ({
      id: line.id,
      name: line.name,
      layerId: line.layerId,
      points: line.points.map((p) => ({ id: p.id, x: p.x, y: p.y })),
      wallPresetAssetId: line.wallPresetAssetId ?? null,
      waypoints: getLayerKind(line.layerId) === 'guide-route'
        ? (Array.isArray(line.waypoints)
          ? line.waypoints.map((w) => ({
            name: typeof w?.name === 'string' ? w.name : undefined,
            dock: w?.dock === true ? true : undefined,
          }))
          : undefined)
        : undefined,
      cornerSmoothness: getLayerKind(line.layerId) === 'wall'
        ? clampWallCornerSmoothness(line.cornerSmoothness)
        : undefined,
      airWallEnabled: line.airWallEnabled ? true : undefined,
      scatter: line.scatter
        ? (() => {
          const footprintAreaM2 = clampFootprintAreaM2(line.scatter.assetId, line.scatter.category, line.scatter.footprintAreaM2)
          const footprintMaxSizeM = clampFootprintMaxSizeM(
            line.scatter.assetId,
            line.scatter.category,
            line.scatter.footprintMaxSizeM,
            footprintAreaM2,
          )
          return {
            providerAssetId: line.scatter.providerAssetId,
            assetId: line.scatter.assetId,
            category: line.scatter.category,
            name: line.scatter.name,
            thumbnail: line.scatter.thumbnail,
            densityPercent: clampDensityPercent(line.scatter.densityPercent),
            footprintAreaM2,
            footprintMaxSizeM,
          }
        })()
        : undefined,
    })),
    images: planningImages.value.map((img) => ({
      id: img.id,
      name: img.name,
      url: img.url,
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

  sceneStore.planningData = nextData as any
  sceneStore.hasUnsavedChanges = true
  planningDirty = false
}

async function handleConvertTo3DScene() {
  if (convertingTo3DScene.value) return

  // Ensure latest edits are persisted before conversion.
  persistPlanningToSceneIfDirty({ force: true })

  const planningData = sceneStore.planningData
  convertingTo3DScene.value = true

  const abortController = new AbortController()

  try {
    if (!planningData) {
      dialogOpen.value = false
      return
    }

    // Conversion uses stable feature ids as node ids and will re-use/update existing nodes.
    // We still keep overwriteExisting=true so conversion can prune orphaned generated nodes.
    const overwriteExisting = true

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

    await convertPlanningTo3DScene({
      sceneStore: sceneStore as any,
      planningData,
      overwriteExisting,
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
    const isAbort = (error as any)?.name === 'AbortError'
    if (isAbort) {
      // Best-effort cleanup of partial conversion output.
      try {
        await clearPlanningGeneratedContent(sceneStore as any)
      } catch {
        // ignore
      }

      uiStore.updateLoadingOverlay({
        mode: 'determinate',
        progress: 100,
        message: '已取消',
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
  activeLayerId.value = layers.value[0]?.id ?? 'green-layer'
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

function normalizeScatterAssignment(raw: unknown): PlanningScatterAssignment | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const payload = raw as Record<string, unknown>
  const providerAssetId = typeof payload.providerAssetId === 'string' ? payload.providerAssetId : null
  const assetId = typeof payload.assetId === 'string' ? payload.assetId : null
  const category = typeof payload.category === 'string' ? (payload.category as TerrainScatterCategory) : null
  if (!providerAssetId || !assetId || !category || !(category in terrainScatterPresets)) {
    return undefined
  }
  const name = typeof payload.name === 'string' ? payload.name : 'Scatter Preset'
  const thumb = typeof payload.thumbnail === 'string' ? payload.thumbnail : null
  const densityPercent = clampDensityPercent(payload.densityPercent)
  const footprintAreaM2 = clampFootprintAreaM2(assetId, category, payload.footprintAreaM2)
  const footprintMaxSizeM = clampFootprintMaxSizeM(assetId, category, payload.footprintMaxSizeM, footprintAreaM2)
  return {
    providerAssetId,
    assetId,
    category,
    name,
    thumbnail: thumb,
    densityPercent,
    footprintAreaM2,
    footprintMaxSizeM,
  }
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

  const grid = payload.grid && typeof payload.grid === 'object' ? (payload.grid as any) : null
  const cellSize = Number(grid?.cellSize)
  if (Number.isFinite(cellSize) && cellSize >= 0.1 && cellSize <= 20) {
    next.grid = { cellSize }
  }

  const noise = payload.noise && typeof payload.noise === 'object' ? (payload.noise as any) : null
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
      .map((cp: any) => {
        const x = Number(cp?.x)
        const y = Number(cp?.y)
        const radius = Number(cp?.radius)
        const height = Number(cp?.height)
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius <= 0 || !Number.isFinite(height)) {
          return null
        }
        const id = typeof cp?.id === 'string' ? cp.id : createId('terrain-cp')
        const nextCp: PlanningTerrainControlPoint = {
          id,
          x,
          y,
          radius,
          height,
          falloff: normalizeTerrainFalloff(cp?.falloff),
        }
        if (typeof cp?.name === 'string') {
          nextCp.name = cp.name
        }
        return nextCp
      })
      .filter((cp): cp is PlanningTerrainControlPoint => !!cp)
  }

  if (Array.isArray(payload.ridgeValleyLines)) {
    next.ridgeValleyLines = payload.ridgeValleyLines
      .map((line: any) => {
        const kind = line?.kind === 'ridge' || line?.kind === 'valley' ? line.kind : null
        const width = Number(line?.width)
        const strength = Number(line?.strength)
        const points = Array.isArray(line?.points) ? line.points : null
        if (!kind || !Number.isFinite(width) || width <= 0 || !Number.isFinite(strength) || !points || points.length < 2) {
          return null
        }
        const normPoints = points
          .map((p: any) => {
            const x = Number(p?.x)
            const y = Number(p?.y)
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null
            return { x, y }
          })
          .filter((p: any) => !!p)
        if (normPoints.length < 2) return null
        const id = typeof line?.id === 'string' ? line.id : createId('terrain-line')
        const nextLine: PlanningTerrainRidgeValleyLine = {
          id,
          kind,
          width,
          strength,
          points: normPoints,
          profile: normalizeTerrainFalloff(line?.profile),
        }
        if (typeof line?.name === 'string') {
          nextLine.name = line.name
        }
        return nextLine
      })
      .filter((line): line is PlanningTerrainRidgeValleyLine => !!line)
  }

  // Overrides are reserved for future A brush. Keep, but do not attempt deep normalization.
  const overrides = payload.overrides && typeof payload.overrides === 'object' ? (payload.overrides as any) : null
  if (overrides && overrides.version === 1 && overrides.cells && typeof overrides.cells === 'object') {
    next.overrides = { version: 1, cells: overrides.cells as Record<string, number> }
  }

  return next
}

// Mark used to avoid "declared but never read" during incremental refactor.
void normalizePlanningTerrain

function loadPlanningFromScene() {
  const data = sceneStore.planningData
  resetPlanningState()
  if (!data) {
    // When there's no saved planning data (or no saved transform), default to fitting the whole canvas.
    void nextTick(() => fitViewToCanvas({ markDirty: false }))
    planningDirty = false
    return
  }

  const usedFeatureIds = new Set<string>()

  if (Array.isArray((data as any).guides)) {
    planningGuides.value = ((data as any).guides as unknown[]).map(normalizeGuide).filter((g): g is PlanningGuide => !!g)
  }

  if (data.activeLayerId) {
    activeLayerId.value = data.activeLayerId
  }
  if (Array.isArray(data.layers)) {
    const hasDefinitions = data.layers.some((item) => {
      const anyItem = item as Record<string, unknown>
      return typeof anyItem.name === 'string' || typeof anyItem.kind === 'string' || typeof anyItem.color === 'string'
    })

    if (hasDefinitions) {
      layers.value = data.layers
        .filter((item) => item && typeof (item as any).id === 'string')
        .map((raw) => {
          const id = String((raw as any).id)
          const kindRaw = (raw as any).kind
          const kind = (typeof kindRaw === 'string' ? kindRaw : null) as LayerKind | null
          const preset = kind ? layerPresets.find((l) => l.kind === kind) : undefined
          return {
            id,
            name: typeof (raw as any).name === 'string' ? String((raw as any).name) : preset?.name ?? 'Layer',
            kind: (kind ?? preset?.kind ?? 'green') as LayerKind,
            visible: typeof (raw as any).visible === 'boolean' ? Boolean((raw as any).visible) : true,
            color: typeof (raw as any).color === 'string' ? String((raw as any).color) : preset?.color ?? '#ffffff',
            locked: typeof (raw as any).locked === 'boolean' ? Boolean((raw as any).locked) : false,
            roadWidthMeters:
              typeof (raw as any).roadWidthMeters === 'number'
                ? Number((raw as any).roadWidthMeters)
                : ((kind ?? preset?.kind) === 'road' ? 2 : undefined),
            roadLaneLines:
              typeof (raw as any).roadLaneLines === 'boolean'
                ? Boolean((raw as any).roadLaneLines)
                : ((kind ?? preset?.kind) === 'road' ? false : undefined),
            roadSmoothing:
              typeof (raw as any).roadSmoothing === 'number'
                ? Number((raw as any).roadSmoothing)
                : ((kind ?? preset?.kind) === 'road' ? 0.09 : undefined),
            waterSmoothing:
              typeof (raw as any).waterSmoothing === 'number'
                ? Number((raw as any).waterSmoothing)
                : ((kind ?? preset?.kind) === 'water' ? 0.1 : undefined),
            wallHeightMeters:
              typeof (raw as any).wallHeightMeters === 'number'
                ? Number((raw as any).wallHeightMeters)
                : ((kind ?? preset?.kind) === 'wall' ? 8 : undefined),
            wallThicknessMeters:
              typeof (raw as any).wallThicknessMeters === 'number'
                ? Number((raw as any).wallThicknessMeters)
                : ((kind ?? preset?.kind) === 'wall' ? 0.15 : undefined),
            floorSmooth:
              typeof (raw as any).floorSmooth === 'number'
                ? Number((raw as any).floorSmooth)
                : ((kind ?? preset?.kind) === 'floor' ? 0.1 : undefined),
          } as PlanningLayer
        })
        .filter((layer): layer is PlanningLayer => !!layer)
    } else {
      const layerMap = new Map(data.layers.map((item) => [item.id, item]))
      layers.value.forEach((layer) => {
        const raw = layerMap.get(layer.id) as { visible?: boolean; locked?: boolean } | undefined
        if (raw) {
          if (typeof raw.visible === 'boolean') {
            layer.visible = raw.visible
          }
          if (typeof raw.locked === 'boolean') {
            layer.locked = raw.locked
          }
        }
      })
    }

    if (!layers.value.find((l) => l.id === activeLayerId.value)) {
      activeLayerId.value = layers.value[0]?.id ?? activeLayerId.value
    }
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
    // Legacy/empty snapshots might not have a transform; ensure the full canvas is visible.
    void nextTick(() => fitViewToCanvas({ markDirty: false }))
  }

  polygons.value = Array.isArray(data.polygons)
    ? data.polygons.map((poly) => ({
      id: normalizePlanningFeatureId((poly as any).id, usedFeatureIds),
      name: (poly as any).name,
      layerId: (poly as any).layerId,
      points: Array.isArray((poly as any).points) ? (poly as any).points.map((p: any) => ({ x: p.x, y: p.y })) : [],
      terrainHeightMeters: (() => {
        const raw = Number((poly as any).terrainHeightMeters)
        if (!Number.isFinite(raw)) return 0
        return Math.min(1000, Math.max(-1000, Math.round(raw * 100) / 100))
      })(),
      airWallEnabled: Boolean((poly as any).airWallEnabled),
      wallPresetAssetId:
        typeof (poly as any).wallPresetAssetId === 'string'
          ? (String((poly as any).wallPresetAssetId).trim() || null)
          : null,
      floorPresetAssetId:
        typeof (poly as any).floorPresetAssetId === 'string'
          ? (String((poly as any).floorPresetAssetId).trim() || null)
          : null,
      scatter: normalizeScatterAssignment((poly as Record<string, unknown>).scatter),
    }))
    : []

  // Drop polygons belonging to removed layers.
  const allowedLayerIds = new Set(layers.value.map((layer) => layer.id))
  polygons.value = polygons.value.filter((poly) => allowedLayerIds.has(poly.layerId))

  const polylinePointPool = new Map<string, PlanningPoint>()

  polylines.value = Array.isArray(data.polylines)
    ? data.polylines.map((line) => {
      const points = Array.isArray(line.points)
        ? line.points.map((raw) => {
          const x = Number((raw as any).x)
          const y = Number((raw as any).y)
          const id = typeof (raw as any).id === 'string' ? String((raw as any).id) : createId('v')
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

      const layerKind = getLayerKind(line.layerId)
      const rawWaypoints = Array.isArray((line as any).waypoints) ? ((line as any).waypoints as any[]) : null
      const waypoints = layerKind === 'guide-route'
        ? points.map((_point, index) => {
          const rawName = rawWaypoints?.[index]?.name
          const name = typeof rawName === 'string' ? rawName : `Point ${index + 1}`
          const dock = rawWaypoints?.[index]?.dock === true
          return { name, dock }
        })
        : undefined

      return {
        id: normalizePlanningFeatureId((line as any).id, usedFeatureIds),
        name: (line as any).name,
        layerId: (line as any).layerId,
        points,
        waypoints,
        wallPresetAssetId:
          typeof (line as any).wallPresetAssetId === 'string'
            ? (String((line as any).wallPresetAssetId).trim() || null)
            : null,
        cornerSmoothness: getLayerKind(line.layerId) === 'wall'
          ? clampWallCornerSmoothness((line as any).cornerSmoothness)
          : undefined,
        airWallEnabled: Boolean((line as any).airWallEnabled),
        scatter: normalizeScatterAssignment((line as Record<string, unknown>).scatter),
      }
    })
    : []

  // Drop polylines belonging to removed layers.
  polylines.value = polylines.value.filter((line) => allowedLayerIds.has(line.layerId))

  planningImages.value = Array.isArray(data.images)
    ? data.images.map((img) => ({
      id: img.id,
      name: img.name,
      url: img.url,
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
  return kind === 'road' || kind === 'wall' || kind === 'guide-route'
})

const canUseAreaTools = computed(() => {
  const kind = activeLayer.value?.kind
  return kind !== 'road' && kind !== 'wall' && kind !== 'guide-route'
})

const canDeleteSelection = computed(() => !!selectedFeature.value)

const scatterTabs = computed(() =>
  (Object.keys(terrainScatterPresets) as TerrainScatterCategory[]).map((key) => ({
    key,
    label: terrainScatterPresets[key].label,
    icon: terrainScatterPresets[key].icon,
  })),
)

const propertyScatterTab = ref<TerrainScatterCategory>('flora')

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
    markPlanningDirty()
  },
})

const selectedScatterAssignment = computed(() => selectedScatterTarget.value?.shape.scatter ?? null)

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

const propertyPanelLayerKind = computed<LayerKind | null>(() => {
  return selectedScatterTarget.value?.layer?.kind ?? null
})

const selectedTerrainContourPolygon = computed<PlanningPolygon | null>(() => {
  const poly = selectedPolygon.value
  if (!poly) return null
  return getLayerKind(poly.layerId) === 'terrain' ? poly : null
})

const terrainContourHeightModel = computed<number>({
  get: () => {
    const poly = selectedTerrainContourPolygon.value
    if (!poly) return 0
    const raw = Number((poly as any).terrainHeightMeters)
    return Number.isFinite(raw) ? raw : 0
  },
  set: (value: number) => {
    if (propertyPanelDisabled.value) return
    const poly = selectedTerrainContourPolygon.value
    if (!poly) return
    ;(poly as any).terrainHeightMeters = Math.round(clampNumberInput(value, 0, -1000, 1000) * 100) / 100
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
    if (!target || (kind !== 'wall' && kind !== 'water' && kind !== 'green')) {
      return false
    }
    return Boolean((target.shape as any).airWallEnabled)
  },
  set: (value: boolean) => {
    if (propertyPanelDisabled.value) return
    const target = selectedScatterTarget.value
    const kind = target?.layer?.kind
    if (!target || (kind !== 'wall' && kind !== 'water' && kind !== 'green')) {
      return
    }
    ;(target.shape as any).airWallEnabled = Boolean(value)
    markPlanningDirty()
  },
})

const roadWidthMetersModel = computed({
  get: () => {
    const layer = selectedScatterTarget.value?.layer
    if (!layer || layer.kind !== 'road') return 2
    const raw = Number(layer.roadWidthMeters ?? 2)
    return Number.isFinite(raw) && raw >= 0.1 ? raw : 2
  },
  set: (value: number) => {
    if (propertyPanelDisabled.value) return
    const layer = selectedScatterTarget.value?.layer
    if (!layer || layer.kind !== 'road') return
    const next = Number(value)
    if (!Number.isFinite(next)) return
    layer.roadWidthMeters = Math.min(10, Math.max(0.1, next))
    markPlanningDirty()
  },
})

const roadLaneLinesModel = computed({
  get: () => {
    const layer = selectedScatterTarget.value?.layer
    if (!layer || layer.kind !== 'road') return false
    return Boolean(layer.roadLaneLines)
  },
  set: (value: boolean) => {
    if (propertyPanelDisabled.value) return
    const layer = selectedScatterTarget.value?.layer
    if (!layer || layer.kind !== 'road') return
    layer.roadLaneLines = Boolean(value)
    markPlanningDirty()
  },
})

const roadSmoothingModel = computed({
  get: () => {
    const layer = selectedScatterTarget.value?.layer
    if (!layer || layer.kind !== 'road') return 0.09
    const raw = Number(layer.roadSmoothing ?? 0.09)
    if (!Number.isFinite(raw)) return 0.09
    return Math.min(1, Math.max(0, raw))
  },
  set: (value: number) => {
    if (propertyPanelDisabled.value) return
    const layer = selectedScatterTarget.value?.layer
    if (!layer || layer.kind !== 'road') return
    const next = Number(value)
    if (!Number.isFinite(next)) return
    layer.roadSmoothing = Math.min(1, Math.max(0, next))
    markPlanningDirty()
  },
})

const waterSmoothingModel = computed({
  get: () => {
    const layer = selectedScatterTarget.value?.layer
    if (!layer || layer.kind !== 'water') return 0.1
    const raw = Number(layer.waterSmoothing ?? 0.1)
    if (!Number.isFinite(raw)) return 0.1
    return Math.min(1, Math.max(0, raw))
  },
  set: (value: number) => {
    if (propertyPanelDisabled.value) return
    const layer = selectedScatterTarget.value?.layer
    if (!layer || layer.kind !== 'water') return
    const next = Number(value)
    if (!Number.isFinite(next)) return
    layer.waterSmoothing = Math.min(1, Math.max(0, next))
    markPlanningDirty()
  },
})

const waterPresetOptions = computed(() =>
  WATER_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
)

const selectedWaterPreset = ref<WaterPresetId | null>(null)

watch(
  () => selectedScatterTarget.value,
  (target) => {
    if (!target || target.layer?.kind !== 'water') {
      selectedWaterPreset.value = null
      return
    }
    const raw = (target.shape as any)?.waterPresetId
    selectedWaterPreset.value = raw ?? null
  },
  { immediate: true },
)

function handleWaterPresetChange(value: WaterPresetId | null) {
  if (propertyPanelDisabled.value) return
  if (!selectedScatterTarget.value) return
  selectedWaterPreset.value = value
  const shape = selectedScatterTarget.value.shape as any
  if (!value) {
    delete shape.waterPresetId
    markPlanningDirty()
    return
  }
  const preset = WATER_PRESETS.find((p) => p.id === value)
  if (!preset) return
  // Store selected preset id on the element so it can be read during conversion
  shape.waterPresetId = value

  markPlanningDirty()
}

const floorSmoothModel = computed({
  get: () => {
    const layer = selectedScatterTarget.value?.layer
    if (!layer || layer.kind !== 'floor') return 0.1
    const raw = Number(layer.floorSmooth ?? 0.1)
    if (!Number.isFinite(raw)) return 0.1
    return Math.min(1, Math.max(0, raw))
  },
  set: (value: number) => {
    if (propertyPanelDisabled.value) return
    const layer = selectedScatterTarget.value?.layer
    if (!layer || layer.kind !== 'floor') return
    const next = Number(value)
    if (!Number.isFinite(next)) return
    layer.floorSmooth = Math.min(1, Math.max(0, next))
    markPlanningDirty()
  },
})

// (removed layer-scoped floor preset model — layer-level floor presets are not used)

const floorFeaturePresetAssetIdEffective = computed<string>(() => {
  const target = selectedScatterTarget.value
  if (!target || target.layer?.kind !== 'floor') return ''
  const override = (target.shape as any)?.floorPresetAssetId
  if (typeof override === 'string' && override.trim().length) return override.trim()
  const layer = target.layer
  return typeof layer.floorPresetAssetId === 'string' ? layer.floorPresetAssetId.trim() : ''
})

function handleFloorFeaturePresetAssetChange(asset: ProjectAsset | null) {
  if (propertyPanelDisabled.value) return
  const target = selectedScatterTarget.value
  if (!target || target.layer?.kind !== 'floor') return

  const shape = target.shape as any
  if (!asset) {
    delete shape.floorPresetAssetId
    markPlanningDirty()
    return
  }

  const id = typeof asset.id === 'string' ? asset.id.trim() : ''
  if (!id) {
    delete shape.floorPresetAssetId
    markPlanningDirty()
    return
  }

  const filename = asset.description ?? asset.name ?? null
  if (!isFloorPresetFilename(filename)) {
    return
  }

  shape.floorPresetAssetId = id
  markPlanningDirty()
}

const wallHeightMetersModel = computed({
  get: () => {
    const layer = selectedScatterTarget.value?.layer
    if (!layer || layer.kind !== 'wall') return 8
    const raw = Number(layer.wallHeightMeters ?? 8)
    return Number.isFinite(raw) && raw > 0 ? raw : 8
  },
  set: (value: number) => {
    if (propertyPanelDisabled.value) return
    const layer = selectedScatterTarget.value?.layer
    if (!layer || layer.kind !== 'wall') return
    const next = Number(value)
    if (!Number.isFinite(next)) return
    layer.wallHeightMeters = Math.min(100, Math.max(0.1, next))
    markPlanningDirty()
  },
})

const wallThicknessMetersModel = computed({
  get: () => {
    const layer = selectedScatterTarget.value?.layer
    if (!layer || layer.kind !== 'wall') return 0.15
    const raw = Number(layer.wallThicknessMeters ?? 0.15)
    return Number.isFinite(raw) && raw > 0 ? raw : 0.15
  },
  set: (value: number) => {
    if (propertyPanelDisabled.value) return
    const layer = selectedScatterTarget.value?.layer
    if (!layer || layer.kind !== 'wall') return
    const next = Number(value)
    if (!Number.isFinite(next)) return
    layer.wallThicknessMeters = Math.min(10, Math.max(0.01, next))
    markPlanningDirty()
  },
})

// (layer-scoped wall preset removed)

// (removed layer-scoped wall preset model — layer-level wall presets are not used)

const wallFeaturePresetAssetIdEffective = computed<string>(() => {
  const target = selectedScatterTarget.value
  if (!target || target.layer?.kind !== 'wall') return ''
  const override = (target.shape as any)?.wallPresetAssetId
  if (typeof override === 'string' && override.trim().length) return override.trim()
  return ''
})

function handleWallFeaturePresetAssetChange(asset: ProjectAsset | null) {
  if (propertyPanelDisabled.value) return
  const target = selectedScatterTarget.value
  if (!target || target.layer?.kind !== 'wall') return

  const shape = target.shape as any
  if (!asset) {
    delete shape.wallPresetAssetId
    markPlanningDirty()
    return
  }

  const id = typeof asset.id === 'string' ? asset.id.trim() : ''
  if (!id) {
    delete shape.wallPresetAssetId
    markPlanningDirty()
    return
  }

  const filename = asset.description ?? asset.name ?? null
  if (!isWallPresetFilename(filename)) {
    return
  }

  shape.wallPresetAssetId = id
  markPlanningDirty()
}

// (removed layer-scoped wall preset handler — layer-level wall presets are not used)

const wallCornerSmoothnessModel = computed({
  get: () => {
    const target = selectedScatterTarget.value
    if (!target || target.type !== 'polyline' || target.layer?.kind !== 'wall') {
      return WALL_DEFAULT_SMOOTHING
    }
    return clampWallCornerSmoothness((target.shape as PlanningPolyline).cornerSmoothness)
  },
  set: (value: number) => {
    if (propertyPanelDisabled.value) return
    const target = selectedScatterTarget.value
    if (!target || target.type !== 'polyline' || target.layer?.kind !== 'wall') {
      return
    }
    ;(target.shape as PlanningPolyline).cornerSmoothness = clampWallCornerSmoothness(value)
    markPlanningDirty()
  },
})

const wallCornerSmoothnessDisplay = computed(() => `${Math.round(wallCornerSmoothnessModel.value * 100)}%`)

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

watch(
  selectedScatterAssignment,
  (assignment) => {
    if (assignment && assignment.category in terrainScatterPresets) {
      propertyScatterTab.value = assignment.category
    }
  },
  { immediate: true },
)

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
  const shape = selectedScatterTarget.value.shape as any
  shape.name = value
  selectedName.value = value
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
  const kind = getLayerKind(layerId as string)
  // Roads: dashed (easier to distinguish from walls); Walls: solid.
  if (kind === 'road') {
    return '10 7'
  }
  return undefined
}

function getPolylineStroke(layerId: string) {
  const kind = getLayerKind(layerId as string)
  // Increase opacity for better visibility
  const alpha = kind === 'road' ? 0.95 : 1
  return getLayerColor(layerId, alpha)
}

function getPolylineStrokeWidth(layerId: string, isSelected = false) {
  const kind = getLayerKind(layerId as string)
  const selectedScale = 1.52
  const MIN_STROKE_WORLD = 0.1 // minimum stroke width in world units (meters)
  if (kind === 'road') {
    const layer = layers.value.find((item) => item.id === layerId)
    const width = Number(layer?.roadWidthMeters ?? 2)
    if (!Number.isFinite(width) || width <= 0) {
      return isSelected ? 2 * selectedScale : 2
    }
    const clamped = Math.min(10, Math.max(0.1, width))
    // Roads scale with zoom (world units). Enforce minimum world stroke width.
    const result = isSelected ? clamped * selectedScale : clamped
    return Math.max(result, MIN_STROKE_WORLD)
  }
  if (kind === 'wall') {
    const base = 3.2
    // Walls use non-scaling stroke (screen px). Ensure that the stroke, when
    // converted to world units, is at least MIN_STROKE_WORLD. Calculate required
    // minimum in px based on current render scale.
    const vectorEffect = getPolylineVectorEffect(layerId)
    const desired = isSelected ? base * selectedScale : base
    if (vectorEffect === 'non-scaling-stroke') {
      const minPx = MIN_STROKE_WORLD * Math.max(1e-6, renderScale.value)
      return Math.max(desired, minPx)
    }
    return Math.max(desired, MIN_STROKE_WORLD)
  }
  const base = 1.05
  // Default kinds use non-scaling stroke; apply same minimum logic as for walls.
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
  const kind = getLayerKind(line.layerId)
  const extraPx = kind === 'wall' ? 8 : 5
  const extraWorld = pxToWorld(extraPx)
  return Math.max(0.0001, strokeWidthWorld / 2 + extraWorld)
}

function getPolylineStrokeLinejoin(line: PlanningPolyline): 'round' | 'inherit' | 'miter' | 'bevel' | undefined {
  const kind = getLayerKind(line.layerId)
  if (kind !== 'wall') {
    return undefined
  }
  const smoothing = clampWallCornerSmoothness(line.cornerSmoothness)
  return smoothing > 0 ? 'round' : 'miter'
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
  // Road width should represent world meters, so it should scale with zoom.
  // Walls/others keep constant screen width for readability.
  const kind = getLayerKind(layerId as string)
  return kind === 'road' ? undefined : 'non-scaling-stroke'
}

function canEditPolylineGeometry(layerId: string): boolean {
  const kind = getLayerKind(layerId as string)
  if (kind !== 'road' && kind !== 'wall') {
    return true
  }
  return currentTool.value === 'line'
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
    roadWidthMeters: kind === 'road' ? 2 : undefined,
    roadLaneLines: kind === 'road' ? false : undefined,
    roadSmoothing: kind === 'road' ? 0.09 : undefined,
    waterSmoothing: kind === 'water' ? 0.5 : undefined,
    wallHeightMeters: kind === 'wall' ? 3 : undefined,
    wallThicknessMeters: kind === 'wall' ? 0.15 : undefined,
    floorSmooth: kind === 'floor' ? 0.5 : undefined,
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
  const anyEl = el as any
  if (anyEl?.$el instanceof HTMLElement) {
    renameFieldElByLayerId.set(layerId, anyEl.$el)
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

function extractAssetPayloadFromDrag(event: DragEvent): { assetId: string } | null {
  if (!event.dataTransfer) return null
  const raw = event.dataTransfer.getData(ASSET_DRAG_MIME)
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed?.assetId && typeof parsed.assetId === 'string') {
        return { assetId: parsed.assetId }
      }
    } catch {
      // ignore
    }
  }
  // Fallback to scene store dragging id if present
  const dragging = (sceneStore as any).draggingAssetId
  if (dragging && typeof dragging === 'string') return { assetId: dragging }
  return null
}

function isAssetDrag(event: DragEvent): boolean {
  if (!event.dataTransfer) return false
  return Array.from(event.dataTransfer.types ?? []).includes(ASSET_DRAG_MIME)
}

function handleCanvasDragOver(event: DragEvent) {
  if (isAssetDrag(event)) {
    event.preventDefault()
  }
}

function handleCanvasDrop(event: DragEvent) {
  const payload = extractAssetPayloadFromDrag(event)
  if (!payload) return
  const world = clientToWorld(event.clientX, event.clientY)
  const polygon = hitTestPolygon(world)
  if (!polygon) return
  const kind = getLayerKind(polygon.layerId)
  if (kind !== 'building') return
  const model: PlacedModel = { id: createId('placed'), assetId: payload.assetId, position: world }
  polygon.placedModels = Array.isArray(polygon.placedModels) ? [...polygon.placedModels, model] : [model]
  markPlanningDirty()
}

function handlePlacedModelPointerDown(polygonId: string, modelId: string | undefined, event: PointerEvent) {
  // keep parameters referenced to avoid unused-variable TS errors
  void polygonId
  void modelId
  event.stopPropagation()
  event.preventDefault()
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
    layerId: activeLayer.value?.id ?? layers.value[0]?.id ?? 'green-layer',
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
  const targetLayerId = layerId ?? activeLayer.value?.id ?? layers.value[0]?.id ?? 'green-layer'
  const targetKind = getLayerKind(targetLayerId)
  polygons.value.push({
    id: createPlanningFeatureId(),
    name: `${labelPrefix ?? getLayerName(targetLayerId)} ${polygonCounter.value++}`,
    layerId: targetLayerId,
    points: clonePoints(points),
    terrainHeightMeters: targetKind === 'terrain' ? 0 : undefined,
  })
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
          cornerSmoothness: sourceKind === 'wall'
            ? clampWallCornerSmoothness((sourceLine as PlanningPolyline).cornerSmoothness)
            : undefined,
        }
        polylines.value = [...polylines.value, newLine]
        activeLayerId.value = sourceLine.layerId
        selectFeature({ type: 'polyline', id: newLine.id })
        selectedVertex.value = { feature: 'polyline', targetId: newLine.id, vertexIndex: 1 }
        lineDraft.value = { lineId: newLine.id, layerId: sourceLine.layerId }
        lineDraftHoverPoint.value = null
        pendingLineHoverClient = null
        markPlanningDirty()
        return
      }
    }
  }

  const targetLayerId = lineDraft.value?.layerId ?? activeLayer.value?.id ?? layers.value[0]?.id ?? 'green-layer'
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
      cornerSmoothness: targetKind === 'wall' ? WALL_DEFAULT_SMOOTHING : undefined,
    }
    polylines.value = [...polylines.value, newLine]
    lineDraft.value = { lineId: newLine.id, layerId: targetLayerId }
    lineDraftHoverPoint.value = null
    pendingLineHoverClient = null
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
    cornerSmoothness: targetKind === 'wall' ? WALL_DEFAULT_SMOOTHING : undefined,
  }
  polylines.value = [...polylines.value, newLine]
  lineDraft.value = { lineId: newLine.id, layerId }
  lineDraftHoverPoint.value = null
  pendingLineHoverClient = null
  selectFeature({ type: 'polyline', id: newLine.id })
  selectedVertex.value = { feature: 'polyline', targetId: newLine.id, vertexIndex: 0 }
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
    markPlanningDirty()
    return
  }

  if (feature.type === 'polyline') {
    polylines.value = polylines.value.filter((item) => item.id !== feature.id)
    selectedFeature.value = null
    selectedVertex.value = null
    markPlanningDirty()
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
    markPlanningDirty()
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

  markPlanningDirty()
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

function handleLayerToggle(layerId: string) {
  const layer = layers.value.find((item) => item.id === layerId)
  if (layer) {
    layer.visible = !layer.visible
    markPlanningDirty()
  }
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

async function handleScatterAssetSelect(payload: { asset: ProjectAsset; providerAssetId: string }) {
  // If the property panel is not editable, return early (e.g., no selection or layer is locked)
  if (propertyPanelDisabled.value) {
    return
  }

  // Target must be a polygon or polyline and must exist to proceed
  const target = selectedScatterTarget.value
  if (!target) {
    return
  }

  // The selected scatter category (e.g., flora/vegetation) must be a known preset
  const category = propertyScatterTab.value
  if (!(category in terrainScatterPresets)) {
    return
  }

  // Thumbnail may be used for UI preview (null if the asset doesn't have one)
  const thumbnail = payload.asset.thumbnail ?? null

  // If the target already has a density set, try to preserve it; otherwise use a default (green polygons default to lower density)
  const existingDensity = target.shape.scatter?.densityPercent
  const defaultDensity = (target.type === 'polygon' && target.layer?.kind === 'green') ? 100 : 50

  // Ensure model bounds are cached (may trigger async download/parse) so footprint can be inferred from the bounding box
  await ensureModelBoundsCachedForAsset(payload.asset)
  // Read cached footprint info inferred from the model bounding box (may be null)
  const cachedFootprint = computeFootprintFromCachedModelBounds(payload.asset.id)

  // If asset metadata provides length/width, use them as a fallback to compute raw area/max side
  const length = payload.asset.dimensionLength ?? null
  const width = payload.asset.dimensionWidth ?? null
  const rawArea = (
    typeof length === 'number'
    && typeof width === 'number'
    && Number.isFinite(length)
    && Number.isFinite(width)
    && length > 0
    && width > 0
  )
    ? length * width
    : undefined

  // Prefer footprint area inferred from cached bounding box; otherwise fall back to asset metadata and clamp to a reasonable range
  const footprintAreaM2 = clampFootprintAreaM2(
    payload.asset.id,
    category,
    cachedFootprint?.footprintAreaM2 ?? rawArea,
  )

  // Same for max side length: prefer cached inference, otherwise use max(length, width) from metadata
  const rawMaxSize = (
    typeof length === 'number'
    && typeof width === 'number'
    && Number.isFinite(length)
    && Number.isFinite(width)
    && length > 0
    && width > 0
  )
    ? Math.max(length, width)
    : undefined
  const footprintMaxSizeM = clampFootprintMaxSizeM(
    payload.asset.id,
    category,
    cachedFootprint?.footprintMaxSizeM ?? rawMaxSize,
    footprintAreaM2,
  )

  // Write scatter assignment object into the selected shape's (polygon or polyline) scatter field.
  // Field meanings: providerAssetId/assetId locate the model during conversion; category specifies the scatter preset type,
  // name/thumbnail used for UI display; densityPercent controls generation proportion; footprint* used for capacity estimation to avoid overlaps.
  target.shape.scatter = {
    providerAssetId: payload.providerAssetId,
    assetId: payload.asset.id,
    category,
    name: payload.asset.name,
    thumbnail,
    // Preserve existing density (if present); otherwise use default and clamp to 0-100
    densityPercent: clampDensityPercent(typeof existingDensity === 'number' ? existingDensity : defaultDensity),
    footprintAreaM2,
    footprintMaxSizeM,
  }

  // Mark the planning as changed so it will be persisted or converted later
  markPlanningDirty()
}

const scatterDensityPercentModel = computed<number>({
  get: () => clampDensityPercent(selectedScatterAssignment.value?.densityPercent),
  set: (value) => {
    if (propertyPanelDisabled.value) {
      return
    }
    const target = selectedScatterTarget.value
    if (!target?.shape.scatter) {
      return
    }
    // Only meaningful for green polygons (planning -> terrain scatter).
    if (target.type !== 'polygon' || target.layer?.kind !== 'green') {
      return
    }
    target.shape.scatter.densityPercent = clampDensityPercent(value)
    markPlanningDirty()
  },
})

const scatterDensityPercentSliderModel = computed<number>({
  get: () => (scatterControlsInteracting.value
    ? (scatterDensityPercentDraft.value ?? scatterDensityPercentModel.value)
    : scatterDensityPercentModel.value),
  set: (value) => {
    if (scatterControlsInteracting.value) {
      scatterDensityPercentDraft.value = clampDensityPercent(value)
      return
    }
    scatterDensityPercentModel.value = value
  },
})

const scatterDensityEnabled = computed(() => {
  const target = selectedScatterTarget.value
  return !propertyPanelDisabled.value
    && !!target
    && target.type === 'polygon'
    && target.layer?.kind === 'green'
    && !!target.shape.scatter
})

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

  if (suspendedPolygonScatterDensityDotsKey.value?.pointerId === event.pointerId) {
    suspendPolygonScatterDensityDots.value = false
    suspendedPolygonScatterDensityDotsKey.value = null
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

  // Ensure we never leave scatter preview suspended.
  suspendPolygonScatterDensityDots.value = false
  suspendedPolygonScatterDensityDotsKey.value = null

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

  // Moving green polygons triggers expensive scatter density dot sampling.
  // Suspend during the drag and compute once after pointerup.
  if (candidate.scatter && getLayerKind(candidate.layerId) === 'green') {
    suspendPolygonScatterDensityDots.value = true
    suspendedPolygonScatterDensityDotsKey.value = { pointerId: event.pointerId, polygonId: candidate.id }
    hidePolygonScatterDensityDots(candidate.id)
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

  // Resizing green polygons triggers expensive scatter density dot sampling.
  // Suspend during the drag and compute once after pointerup.
  if (polygon.scatter && getLayerKind(polygon.layerId) === 'green') {
    suspendPolygonScatterDensityDots.value = true
    suspendedPolygonScatterDensityDotsKey.value = { pointerId: event.pointerId, polygonId }
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
  if (currentTool.value === 'line' && (layerKind === 'road' || layerKind === 'wall')) {
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
    try {
      savePlanningImageToIndexedDB(newImage, file)
    } catch (err) {
      // non-fatal: keep running even if persistence fails
      // eslint-disable-next-line no-console
      console.warn('Failed to persist planning image to IndexedDB', err)
    }

    markPlanningDirty()
  }
  image.onerror = () => {
    uploadError.value = 'Unable to read the image; please retry or choose a different file.'
    URL.revokeObjectURL(url)
  }
  image.src = url
}

// IndexedDB helpers: images stored by content hash; layer metadata stored separately and reference image hash.
function hexFromBuffer(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function computeSha256Hex(buffer: ArrayBuffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return hexFromBuffer(hash)
}

function openPlanningImageDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open('harmony-planning-images', 2)
      req.onupgradeneeded = () => {
        const db = req.result
          if (!db.objectStoreNames.contains('images')) {
            db.createObjectStore('images', { keyPath: 'hash' })
          }
          if (!db.objectStoreNames.contains('layers')) {
            const layersStore = db.createObjectStore('layers', { keyPath: 'id' })
            layersStore.createIndex('by_scene', 'sceneId', { unique: false })
          }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    } catch (e) {
      reject(e)
    }
  })
}

function getImageByHash(db: IDBDatabase, hash: string) {
  return new Promise<any>((resolve, reject) => {
    const tx = db.transaction('images', 'readonly')
    const req = tx.objectStore('images').get(hash)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function putImageBlob(db: IDBDatabase, hash: string, blob: Blob) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite')
    const store = tx.objectStore('images')
    const keyPath = store.keyPath
    const value = keyPath ? (typeof keyPath === 'string' ? { [keyPath]: hash, blob } : { hash, blob }) : { hash, blob }
    try {
      if (keyPath) {
        store.put(value)
      } else {
        store.put(value, hash)
      }
    } catch (err) {
      tx.abort()
      reject(err)
      return
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function putLayerRecord(db: IDBDatabase, record: any) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('layers', 'readwrite')
    tx.objectStore('layers').put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function getAllLayerRecords(db: IDBDatabase, sceneId?: string | null) {
  return new Promise<any[]>((resolve, reject) => {
    const tx = db.transaction('layers', 'readonly')
    const store = tx.objectStore('layers')
    if (sceneId) {
      const idx = store.index('by_scene')
      const req = idx.getAll(sceneId)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    } else {
      const req = store.getAll()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }
  })
}

async function savePlanningImageToIndexedDB(image: PlanningImage, file: File) {
  const db = await openPlanningImageDB()
  const buffer = await file.arrayBuffer()
  const hash = await computeSha256Hex(buffer)
  // store blob only if not already present
  const existing = await getImageByHash(db, hash)
  if (!existing) {
    const blob = new Blob([buffer], { type: file.type })
    await putImageBlob(db, hash, blob)
  }
  // remember hash on in-memory object for later metadata updates
  try { (image as any).imageHash = hash } catch {}
  // store layer metadata referencing hash
  const layerRecord = {
    id: image.id,
    sceneId: currentSceneId.value ?? null,
    name: image.name,
    imageHash: hash,
    sizeLabel: image.sizeLabel,
    width: image.width,
    height: image.height,
    visible: image.visible,
    locked: image.locked,
    opacity: image.opacity,
    position: image.position,
    scale: image.scale,
    alignMarker: image.alignMarker ?? null,
  }
  await putLayerRecord(db, layerRecord)
  db.close()
}

async function persistLayersToIndexedDB() {
  try {
    const db = await openPlanningImageDB()
    const tx = db.transaction('layers', 'readwrite')
    const store = tx.objectStore('layers')
    for (const img of planningImages.value) {
      // only persist if we have an imageHash (uploaded or previously loaded)
      // otherwise skip (no blob stored)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const record: any = {
        id: img.id,
        sceneId: currentSceneId.value ?? null,
        name: img.name,
        imageHash: (img as any).imageHash ?? null,
        sizeLabel: img.sizeLabel,
        width: img.width,
        height: img.height,
        visible: img.visible,
        locked: img.locked,
        opacity: img.opacity,
        // Deep clone position to avoid Proxy/Ref issues
        position: img.position ? { x: img.position.x, y: img.position.y } : { x: 0, y: 0 },
        // Scale is a number, but ensure primitive
        scale: typeof img.scale === 'number' ? img.scale : 1,
        alignMarker: img.alignMarker ? { ...img.alignMarker } : null,
      }
      store.put(record)
    }
    tx.oncomplete = () => db.close()
    tx.onerror = () => db.close()
  } catch (e) {
    // non-fatal
    // eslint-disable-next-line no-console
    console.warn('Failed to persist layer metadata to IndexedDB', e)
  }
}

async function loadPlanningImagesFromIndexedDB(sceneId?: string | null) {
  const db = await openPlanningImageDB()
  const layers = await getAllLayerRecords(db, sceneId)
  const results: PlanningImage[] = []
  for (const rec of layers) {
    try {
      const imgRec = await getImageByHash(db, rec.imageHash)
      if (!imgRec || !imgRec.blob) continue
      const url = URL.createObjectURL(imgRec.blob)
      // ensure image decodes
      await new Promise<void>((res, rej) => {
        const img = new Image()
        img.onload = () => res()
        img.onerror = () => rej(new Error('Image decode error'))
        img.src = url
      })
      const item: PlanningImage = {
        id: rec.id,
        name: rec.name,
        url,
        imageHash: rec.imageHash ?? undefined,
        sizeLabel: rec.sizeLabel ?? `${rec.width} x ${rec.height}`,
        width: rec.width,
        height: rec.height,
        visible: rec.visible ?? true,
        locked: rec.locked ?? false,
        opacity: typeof rec.opacity === 'number' ? rec.opacity : 1,
        position: rec.position ?? { x: 0, y: 0 },
        scale: typeof rec.scale === 'number' ? rec.scale : 1,
        alignMarker: rec.alignMarker ?? undefined,
      }
      results.push(item)
    } catch (e) {
      // skip corrupted record
      // eslint-disable-next-line no-console
      console.warn('Skipping corrupted planning image record', rec?.id, e)
    }
  }
  db.close()
  return results
}

async function deletePlanningImageFromIndexedDB(id: string) {
  const db = await openPlanningImageDB()
  // find layer record to get hash
  const tx = db.transaction(['layers', 'images'], 'readwrite')
  const layersStore = tx.objectStore('layers')
  const imagesStore = tx.objectStore('images')
  const getReq = layersStore.get(id)
  await new Promise((res, rej) => { getReq.onsuccess = () => res(null); getReq.onerror = () => rej(getReq.error) })
  const rec = getReq.result
  if (rec) {
    const hash = rec.imageHash
    layersStore.delete(id)
    // check if any other layer references this hash
    const allLayersReq = layersStore.getAll()
    const otherLayers = await new Promise<any[]>((res, rej) => { allLayersReq.onsuccess = () => res(allLayersReq.result); allLayersReq.onerror = () => rej(allLayersReq.error) })
    const stillUsed = otherLayers.some((l) => l.imageHash === hash)
    if (!stillUsed) {
      imagesStore.delete(hash)
    }
  }
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
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
    await deletePlanningImageFromIndexedDB(imageId)
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

  // To avoid accidental operations: only allow dragging planning layers when the 'pan' tool is selected.
  if (tool !== 'select') {
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
  if (!layerId) {
    return 0
  }
  const layer = layers.value.find((item) => item.id === layerId)
  if (!layer) {
    return 0
  }
  if (layer.kind === 'floor') {
    return normalizeLayerSmoothingValue(layer.floorSmooth)
  }
  if (layer.kind === 'water') {
    return normalizeLayerSmoothingValue(layer.waterSmoothing)
  }
  return 0
}

function normalizeLayerSmoothingValue(value: number | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value))
  }
  return 0.1
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

const imagesLoaded = ref(false)

onMounted(() => {
  // Do NOT load persisted images here; defer until the dialog is opened to avoid slowing scene load.
  window.addEventListener('pointermove', handlePointerMove, { passive: false })
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerUp)
  window.addEventListener('resize', updateEditorRect)
  window.addEventListener('keydown', handleKeydown)
})

// Load persisted images the first time the Planning Dialog is opened.
watch(
  () => dialogOpen.value,
  async (open) => {
    if (!open || imagesLoaded.value) return
    imagesLoaded.value = true
    try {
      const sceneId = currentSceneId.value ?? null
      const persisted = await loadPlanningImagesFromIndexedDB(sceneId)
      if (persisted && persisted.length) {
        planningImages.value = persisted
        activeImageId.value = planningImages.value[0]?.id ?? null
      }
    } catch (e) {
      // ignore DB errors (non-fatal)
      // eslint-disable-next-line no-console
      console.warn('Failed to load planning images from IndexedDB', e)
    }
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
                    </template>
                  </div>
                </div>
                <template #append>
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
                  <v-btn
                    icon
                    size="small"
                    variant="text"
                    :color="layer.visible ? 'primary' : 'grey'"
                    @click.stop="handleLayerToggle(layer.id)"
                  >
                    <v-icon>{{ layer.visible ? 'mdi-eye-outline' : 'mdi-eye-off-outline' }}</v-icon>
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
            @dragover.prevent="handleCanvasDragOver"
            @drop.prevent="handleCanvasDrop"
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

                    <!-- Green scatter density preview (faint dots) -->
                    <g
                      v-if="polygonScatterDensityDots[poly.id]?.length"
                      class="scatter-density-dots"
                      :class="{ 'inactive-layer-feature': !isActiveLayer(poly.layerId) }"
                      pointer-events="none"
                    >
                      <circle
                        v-for="(p, idx) in polygonScatterDensityDots[poly.id]"
                        :key="`${poly.id}-density-dot-${idx}`"
                        :cx="p.x"
                        :cy="p.y"
                        :r="scatterDensityDotRadiusWorld"
                        :fill="getLayerColor(poly.layerId, 0.36)"
                        :stroke="getLayerColor(poly.layerId, 0.78)"
                        :stroke-width="scatterDensityDotStrokeWidthWorld"
                      />
                    </g>

                    <image
                      v-if="poly.scatter?.thumbnail && polygonScatterThumbPlacements[poly.id]"
                      class="scatter-thumb"
                      :class="{ 'inactive-layer-feature': !isActiveLayer(poly.layerId) }"
                      :href="poly.scatter.thumbnail"
                      :x="polygonScatterThumbPlacements[poly.id]!.x"
                      :y="polygonScatterThumbPlacements[poly.id]!.y"
                      :width="polygonScatterThumbPlacements[poly.id]!.size"
                      :height="polygonScatterThumbPlacements[poly.id]!.size"
                      preserveAspectRatio="xMidYMid meet"
                    />
                    <!-- Placed building models (simple placeholder markers) -->
                    <g v-if="poly.placedModels?.length" class="placed-models" :class="{ 'inactive-layer-feature': !isActiveLayer(poly.layerId) }">
                      <g v-for="(m, idx) in poly.placedModels" :key="m.id ?? `${poly.id}-placed-${idx}`">
                        <circle
                          :cx="m.position.x"
                          :cy="m.position.y"
                          :r="Math.max(0.25, vertexHandleRadiusWorld)"
                          fill="orange"
                          stroke="rgba(255,255,255,0.9)"
                          :stroke-width="vertexHandleStrokeWidthWorld"
                          pointer-events="visibleFill"
                          @pointerdown="(e) => handlePlacedModelPointerDown(poly.id, m.id, e as PointerEvent)"
                        />
                      </g>
                    </g>
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

                    <image
                      v-if="line.scatter?.thumbnail && polylineScatterThumbPlacements[line.id]"
                      class="scatter-thumb"
                      :class="{ 'inactive-layer-feature': !isActiveLayer(line.layerId) }"
                      :href="line.scatter.thumbnail"
                      :x="polylineScatterThumbPlacements[line.id]!.x"
                      :y="polylineScatterThumbPlacements[line.id]!.y"
                      :width="polylineScatterThumbPlacements[line.id]!.size"
                      :height="polylineScatterThumbPlacements[line.id]!.size"
                      preserveAspectRatio="xMidYMid meet"
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

            <div v-if="selectedGuideRouteVertex" class="property-panel__block">
              <div style="display:flex;gap:8px;align-items:center;">
                <v-text-field
                  v-model="guideRouteWaypointNameModel"
                  density="compact"
                  hide-details
                  label="Name"
                  :disabled="propertyPanelDisabled"
                  style="flex:1"
                />
              </div>
              <div style="margin-top:8px;">
                <v-text-field
                  :model-value="selectedGuideRouteVertex.typeLabel"
                  density="compact"
                  hide-details
                  label="Type"
                  readonly
                />
              </div>
              <div style="margin-top:8px;">
                <v-switch
                  v-model="guideRouteWaypointDockModel"
                  density="compact"
                  hide-details
                  label="Dock"
                  :disabled="propertyPanelDisabled"
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
            </div>

            <template v-else-if="propertyPanelLayerKind === 'green'">
              <div class="property-panel__density">
                <div class="property-panel__density-row">
                  <v-switch
                    v-model="airWallEnabledModel"
                    density="compact"
                    hide-details
                    label="Air Wall"
                  />
                </div>
              </div>


              <div class="property-panel__density">
                <div class="property-panel__density-title">Density</div>
                <div class="property-panel__density-row">
                  <div @pointerdown.capture="beginScatterControlsInteraction">
                    <v-slider
                      v-model="scatterDensityPercentSliderModel"
                      min="0"
                      max="100"
                      step="1"
                      density="compact"
                      hide-details
                      :disabled="!scatterDensityEnabled"
                    />
                  </div>
                  <div class="property-panel__density-value">{{ scatterDensityPercentSliderModel }}%</div>
                </div>
              </div>

              <v-tabs
                v-model="propertyScatterTab"
                density="compact"
                :transition="false"
                class="property-panel__tabs"
              >
                <v-tab
                  v-for="tab in scatterTabs"
                  :key="tab.key"
                  :value="tab.key"
                  :title="tab.label"
                >
                  <v-icon :icon="tab.icon" size="16" />
                </v-tab>
              </v-tabs>

              <v-window v-model="propertyScatterTab" :transition="false" class="property-panel__window">
                <v-window-item
                  v-for="tab in scatterTabs"
                  :key="`scatter-panel-${tab.key}`"
                  :value="tab.key"
                >
                  <GroundAssetPainter
                    v-if="propertyScatterTab === tab.key"
                    :category="tab.key"
                    :update-terrain-selection="false"
                    :selected-provider-asset-id="selectedScatterAssignment ? selectedScatterAssignment.providerAssetId : null"
                    :thumbnail-size="68"
                    @asset-select="handleScatterAssetSelect"
                  />
                </v-window-item>
              </v-window>
            </template>

            <template v-else-if="propertyPanelLayerKind === 'road'">
              <div class="property-panel__density">
                <div class="property-panel__density-title">Road width</div>
                <div class="property-panel__density-row">
                  <v-text-field
                    v-model.number="roadWidthMetersModel"
                    type="number"
                    min="0.1"
                    max="10"
                    step="0.1"
                    density="compact"
                    variant="underlined"
                    hide-details
                    suffix="m"
                  />
                </div>
                <div class="property-panel__spacing-title">Junction smoothing</div>
                <div class="property-panel__density-row">
                  <v-slider
                    v-model="roadSmoothingModel"
                    min="0"
                    max="1"
                    step="0.01"
                    density="compact"
                    hide-details
                  />
                  <div class="property-panel__density-value">
                    {{ Math.round(roadSmoothingModel * 100) }}%
                  </div>
                </div>
              </div>

              <div class="property-panel__block">
                <div class="property-panel__density-title">Lane Lines</div>
                <div class="property-panel__density-row">
                  <v-switch
                    v-model="roadLaneLinesModel"
                    density="compact"
                    hide-details
                    label="Show Lane Lines"
                  />
                </div>
              </div>
            
            </template>

            <template v-else-if="propertyPanelLayerKind === 'water'">

              <div class="property-panel__block">
                <div class="property-panel__density-row">
                  <v-switch
                    v-model="airWallEnabledModel"
                    density="compact"
                    hide-details
                    label="Air Wall"
                  />
                </div>
              </div>
              <div class="property-panel__block">
                <v-select
                  label="Water Preset"
                  density="compact"
                  variant="underlined"
                  hide-details
                  :items="waterPresetOptions"
                  item-title="label"
                  item-value="value"
                  :model-value="selectedWaterPreset"
                  :disabled="propertyPanelDisabled"
                  @update:model-value="handleWaterPresetChange"
                />
              </div>

              <div class="property-panel__block">
                <div class="property-panel__density-title">Water smoothing</div>
                <div class="property-panel__density-row">
                  <v-slider
                    v-model="waterSmoothingModel"
                    min="0"
                    max="1"
                    step="0.01"
                    density="compact"
                    hide-details
                  />
                  <div class="property-panel__density-value">
                    {{ Math.round(waterSmoothingModel * 100) }}%
                  </div>
                </div>
              </div>
            </template>

            <template v-else-if="propertyPanelLayerKind === 'floor'">

              <div class="property-panel__density">
                <div class="property-panel__density-title">Floor smoothing</div>
                <div class="property-panel__density-row">
                  <v-slider
                    v-model="floorSmoothModel"
                    min="0"
                    max="1"
                    step="0.01"
                    density="compact"
                    hide-details
                  />
                  <div class="property-panel__density-value">
                    {{ Math.round(floorSmoothModel * 100) }}%
                  </div>
                </div>
              </div>
              <div class="property-panel__block">
                <div class="property-panel__spacing-title">Floor preset</div>
                <div
                  class="property-panel__floor-preset"
                  :style="propertyPanelDisabled ? { pointerEvents: 'none', opacity: 0.6 } : undefined"
                >
                  <AssetPickerList
                    :active="dialogOpen && propertyPanelLayerKind === 'floor'"
                    :asset-id="floorFeaturePresetAssetIdEffective"
                    asset-type="prefab"
                    :extensions="['floor']"
                    @update:asset="handleFloorFeaturePresetAssetChange"
                  />
                </div>
              </div>

              <!-- layer-level floor preset removed: only per-feature presets are supported -->

            </template>

            <template v-else-if="propertyPanelLayerKind === 'wall'">
              <div class="property-panel__density">
                <div class="property-panel__density-row">
                  <v-switch
                    v-model="airWallEnabledModel"
                    density="compact"
                    hide-details
                    label="Air Wall"
                  />
                </div>

                <div class="property-panel__density-title">Wall height</div>
                <div class="property-panel__density-row">
                  <v-text-field
                    v-model.number="wallHeightMetersModel"
                    type="number"
                    min="0.1"
                    max="100"
                    step="0.1"
                    density="compact"
                    variant="underlined"
                    hide-details
                    suffix="m"
                  />
                </div>

                <div class="property-panel__spacing-title">Wall thickness</div>
                <div class="property-panel__density-row">
                  <v-text-field
                    v-model.number="wallThicknessMetersModel"
                    type="number"
                    min="0.01"
                    max="10"
                    step="0.01"
                    density="compact"
                    variant="underlined"
                    hide-details
                    suffix="m"
                  />
                </div>

                <template v-if="selectedScatterTarget && selectedScatterTarget.type === 'polyline'">
                  <div class="property-panel__spacing-title">Corner Smoothness</div>
                  <div class="property-panel__density-row">
                    <v-slider
                      v-model="wallCornerSmoothnessModel"
                      min="0"
                      max="1"
                      step="0.01"
                      density="compact"
                      hide-details
                    />
                    <div class="property-panel__density-value">{{ wallCornerSmoothnessDisplay }}</div>
                  </div>
                </template>

                <div class="property-panel__spacing-title">Wall preset</div>
                <div
                  class="property-panel__wall-preset"
                  :style="propertyPanelDisabled ? { pointerEvents: 'none', opacity: 0.6 } : undefined"
                >
                  <AssetPickerList
                    :active="dialogOpen && propertyPanelLayerKind === 'wall'"
                    :asset-id="wallFeaturePresetAssetIdEffective"
                    asset-type="prefab"
                    :extensions="['wall']"
                    @update:asset="handleWallFeaturePresetAssetChange"
                  />
                </div>
              </div>
            </template>

            <template v-else>
              <!-- terrain/building/wall: empty for now -->
            </template>
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
