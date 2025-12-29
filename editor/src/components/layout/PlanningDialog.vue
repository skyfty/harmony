<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch, watchEffect } from 'vue'
import type { CSSProperties } from 'vue'
import { storeToRefs } from 'pinia'
import { generateUuid } from '@/utils/uuid'
import { useSceneStore } from '@/stores/sceneStore'
import { useUiStore } from '@/stores/uiStore'
import GroundAssetPainter from '@/components/inspector/GroundAssetPainter.vue'
import PlanningRulers from '@/components/layout/PlanningRulers.vue'
import { terrainScatterPresets } from '@/resources/projectProviders/asset'
import type { TerrainScatterCategory } from '@harmony/schema/terrain-scatter'
import type { ProjectAsset } from '@/types/project-asset'
import { clearPlanningGeneratedContent, convertPlanningTo3DScene } from '@/utils/planningToScene'
import { generateFpsScatterPointsInPolygon } from '@/utils/scatterSampling'
import { WALL_DEFAULT_SMOOTHING } from '@schema/components'

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
type LayerKind = 'terrain' | 'building' | 'road' | 'green' | 'wall' | 'floor' | 'water'

const layerKindLabels: Record<LayerKind, string> = {
  terrain: 'Terrain',
  building: 'Building',
  road: 'Road',
  floor: 'Floor',
  green: 'Green',
  wall: 'Wall',
  water: 'Water',
}

const addableLayerKinds: LayerKind[] = ['road', 'floor', 'water', 'green', 'wall']

interface PlanningLayer {
  id: string
  name: string
  kind: LayerKind
  visible: boolean
  color: string
  locked: boolean
  /** Road layer width in meters (only used when kind === 'road'). */
  roadWidthMeters?: number
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

interface PlanningPolygon {
  id: string
  name: string
  layerId: string
  points: PlanningPoint[]
  scatter?: PlanningScatterAssignment
  /** When true, conversion will create/mark an air wall for this feature (layer-dependent). */
  airWallEnabled?: boolean
}

interface PlanningPolyline {
  id: string
  name: string
  layerId: string
  points: PlanningPoint[]
  scatter?: PlanningScatterAssignment
  /** 0-1. Only meaningful when layer kind is 'wall'. */
  cornerSmoothness?: number
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
  sizeLabel: string
  width: number
  height: number
  visible: boolean
  locked: boolean
  opacity: number
  position: { x: number; y: number }
  scale: number
  // 对齐标记（存储在图片自身坐标系：原始像素坐标）
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
    // 对齐模式下，记录参与对齐的图层拖拽起始位置；无对齐标记的图层不在此列表中。
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
}

const layerPresets: PlanningLayer[] = [
  { id: 'green-layer', name: 'Greenery', kind: 'green', visible: true, color: '#00897B', locked: false },
  { id: 'road-layer', name: 'Road', kind: 'road', visible: true, color: '#F9A825', locked: false, roadWidthMeters: 2, roadSmoothing: 0.5 },
  { id: 'floor-layer', name: 'Floor', kind: 'floor', visible: true, color: '#1E88E5', locked: false, floorSmooth: 0.1 },
  { id: 'water-layer', name: 'Water', kind: 'water', visible: true, color: '#039BE5', locked: false, waterSmoothing: 0.1 },
  { id: 'wall-layer', name: 'Wall', kind: 'wall', visible: true, color: '#5E35B1', locked: false, wallHeightMeters: 3, wallThicknessMeters: 0.15 },
]

const imageAccentPalette = layerPresets.map((layer) => layer.color)

const layers = ref<PlanningLayer[]>(layerPresets.map((layer) => ({ ...layer })))
const activeLayerId = ref(layers.value[0]?.id ?? 'green-layer')
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
// 列表显示顺序与画布遮挡顺序保持一致：上层在列表更靠前。
// 画布采用 DOM 顺序叠放（数组越靠后越上层），因此列表需要反向展示。
const planningImagesForList = computed(() => [...planningImages.value].reverse())
const activeImageId = ref<string | null>(null)
const draggingImageId = ref<string | null>(null)
const dragOverImageId = ref<string | null>(null)
const alignModeActive = ref(false)
const uploadError = ref<string | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const editorRef = ref<HTMLDivElement | null>(null)
const editorRect = ref<DOMRect | null>(null)
const currentTool = ref<PlanningTool>('select')
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

// 图层列表置顶（更靠前）= 更上层；SVG 后绘制的元素在更上层。
// 因此绘制顺序应当反向遍历 layers。
const layerRenderOrderIds = computed(() => [...layers.value].reverse().map((layer) => layer.id))

const visiblePolygons = computed(() => {
  const visible = visibleLayerIds.value
  const order = layerRenderOrderIds.value
  const buckets = new Map<string, PlanningPolygon[]>()
  order.forEach((id) => buckets.set(id, []))
  const orphan: PlanningPolygon[] = []
  polygons.value.forEach((poly) => {
    if (!visible.has(poly.layerId)) return
    const bucket = buckets.get(poly.layerId)
    if (bucket) bucket.push(poly)
    else orphan.push(poly)
  })
  return [...order.flatMap((id) => buckets.get(id) ?? []), ...orphan]
})

const visiblePolylines = computed(() => {
  const visible = visibleLayerIds.value
  const order = layerRenderOrderIds.value
  const buckets = new Map<string, PlanningPolyline[]>()
  order.forEach((id) => buckets.set(id, []))
  const orphan: PlanningPolyline[] = []
  polylines.value.forEach((line) => {
    if (!visible.has(line.layerId)) return
    const bucket = buckets.get(line.layerId)
    if (bucket) bucket.push(line)
    else orphan.push(line)
  })
  return [...order.flatMap((id) => buckets.get(id) ?? []), ...orphan]
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

function defaultFootprintAreaM2(category: TerrainScatterCategory): number {
  const preset = terrainScatterPresets[category]
  const spacing = Number.isFinite(preset?.spacing) ? Number(preset.spacing) : 1
  return Math.max(0.01, spacing * spacing)
}

function clampFootprintAreaM2(category: TerrainScatterCategory, value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num <= 0) {
    return defaultFootprintAreaM2(category)
  }
  return Math.min(1e6, Math.max(0.0001, num))
}

function defaultFootprintMaxSizeM(category: TerrainScatterCategory): number {
  const preset = terrainScatterPresets[category]
  const spacing = Number.isFinite(preset?.spacing) ? Number(preset.spacing) : 1
  return Math.max(0.05, spacing)
}

function clampFootprintMaxSizeM(category: TerrainScatterCategory, value: unknown, fallbackAreaM2?: number): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num <= 0) {
    if (Number.isFinite(fallbackAreaM2) && (fallbackAreaM2 as number) > 0) {
      return Math.max(0.05, Math.sqrt(fallbackAreaM2 as number))
    }
    return defaultFootprintMaxSizeM(category)
  }
  return Math.min(1000, Math.max(0.01, num))
}

function estimateFootprintDiagonalM(footprintAreaM2: number, footprintMaxSizeM: number): number {
  const area = Number.isFinite(footprintAreaM2) ? footprintAreaM2 : 0
  const maxSide = Number.isFinite(footprintMaxSizeM) ? footprintMaxSizeM : 0
  if (area <= 0 || maxSide <= 0) {
    return 0
  }
  // Given area = a*b and maxSide = max(a,b), infer the other side and compute diagonal.
  const otherSide = area / maxSide
  if (!Number.isFinite(otherSide) || otherSide <= 0) {
    return 0
  }
  return Math.sqrt(maxSide * maxSide + otherSide * otherSide)
}

function hashSeedFromString(value: string): number {
  // FNV-1a 32bit
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function buildRandom(seed: number) {
  // LCG
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function getPointsBounds(points: PlanningPoint[]) {
  if (!points.length) {
    return null
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of points) {
    if (!p) continue
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

function polygonCentroid(points: PlanningPoint[]) {
  if (points.length < 3) {
    const bounds = getPointsBounds(points)
    if (!bounds) return null
    return { x: bounds.minX + bounds.width * 0.5, y: bounds.minY + bounds.height * 0.5 }
  }
  // Area-weighted centroid (shoelace)
  let areaTimes2 = 0
  let cxTimes6 = 0
  let cyTimes6 = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    const cross = a.x * b.y - b.x * a.y
    areaTimes2 += cross
    cxTimes6 += (a.x + b.x) * cross
    cyTimes6 += (a.y + b.y) * cross
  }
  if (Math.abs(areaTimes2) < 1e-9) {
    const bounds = getPointsBounds(points)
    if (!bounds) return null
    return { x: bounds.minX + bounds.width * 0.5, y: bounds.minY + bounds.height * 0.5 }
  }
  const factor = 1 / (3 * areaTimes2)
  return { x: cxTimes6 * factor, y: cyTimes6 * factor }
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

    if (!poly.scatter) {
      polygonScatterDensityDotsCache.delete(poly.id)
      continue
    }
    const layerKind = getLayerKind(poly.layerId)
    if (layerKind !== 'green') {
      polygonScatterDensityDotsCache.delete(poly.id)
      continue
    }
    const densityPercent = clampDensityPercent(poly.scatter.densityPercent)
    if (densityPercent <= 0) {
      polygonScatterDensityDotsCache.delete(poly.id)
      continue
    }
    const footprintAreaM2 = clampFootprintAreaM2(poly.scatter.category, poly.scatter.footprintAreaM2)
    const footprintMaxSizeM = clampFootprintMaxSizeM(poly.scatter.category, poly.scatter.footprintMaxSizeM, footprintAreaM2)
    const preset = terrainScatterPresets[poly.scatter.category]
    const maxScale = preset && Number.isFinite(preset.maxScale) ? preset.maxScale : 1
    const baseDiagonal = estimateFootprintDiagonalM(footprintAreaM2, footprintMaxSizeM)
    const effectiveDiagonalM = Math.max(0.01, baseDiagonal * maxScale)
    const effectiveFootprintAreaM2 = footprintAreaM2 * maxScale * maxScale
    // Treat the (scaled) max side length as an approximate "diameter" to keep instances from overlapping.
    const effectiveModelDiameterM = Math.max(0.01, footprintMaxSizeM * maxScale)
    const bounds = getPointsBounds(poly.points)
    if (!bounds) {
      polygonScatterDensityDotsCache.delete(poly.id)
      continue
    }
    const area = polygonArea(poly.points)
    if (!Number.isFinite(area) || area < 60) {
      polygonScatterDensityDotsCache.delete(poly.id)
      continue
    }

    // Capacity model (same idea as conversion):
    // max = floor(polygonArea / modelFootprintArea)
    // target = round(max * densityPercent/100)
    const perInstanceArea = Math.max(effectiveFootprintAreaM2, effectiveDiagonalM * effectiveDiagonalM)
    const maxByArea = perInstanceArea > 1e-6 ? Math.floor(area / perInstanceArea) : 0
    const targetDots = Math.round((maxByArea * densityPercent) / 100)
    if (targetDots <= 0) {
      polygonScatterDensityDotsCache.delete(poly.id)
      continue
    }

    // Derive a spacing from (area, targetDots), but never smaller than the model bounding box.
    const spacingFromCount = Math.sqrt(area / Math.max(1, targetDots))
    // Density-to-spacing rule (user expectation): baseSpacing = 100/densityPercent meters.
    // Then add model diameter so instances don't overlap.
    const spacingFromDensity = 100 / Math.max(0.0001, densityPercent)
    const minDistance = Math.max(spacingFromCount, effectiveDiagonalM, spacingFromDensity + effectiveModelDiameterM)

    const pointsHash = hashPlanningPoints(poly.points)
    const cacheKey = `${pointsHash}|${poly.points.length}|${Math.round(area)}|${densityPercent}|${targetDots}|${Math.round(footprintAreaM2 * 1000)}|${Math.round(footprintMaxSizeM * 1000)}`
    const cached = polygonScatterDensityDotsCache.get(poly.id)
    if (cached?.key === cacheKey) {
      if (cached.dots.length) {
        result[poly.id] = cached.dots
      }
      continue
    }

    // Preview should stay responsive.
    const cappedTarget = Math.min(800, targetDots)
    const random = buildRandom(hashSeedFromString(`${poly.id}:${densityPercent}:${targetDots}:${Math.round(footprintAreaM2 * 1000)}:${Math.round(footprintMaxSizeM * 1000)}`))

    const minDistanceForDots = Math.max(minDistance, 0.05)
    const selected = generateFpsScatterPointsInPolygon({
      polygon: poly.points,
      targetCount: cappedTarget,
      minDistance: minDistanceForDots,
      random,
      maxCandidates: Math.min(4000, Math.max(800, Math.ceil(cappedTarget * 6))),
    })
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
  if (selectedPolygonAreaM2.value !== null) return '占用面积'
  if (selectedPolylineLengthM.value !== null) return '长度'
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
const VERTEX_HANDLE_DIAMETER_PX = 10
const VERTEX_HANDLE_RADIUS_PX = VERTEX_HANDLE_DIAMETER_PX / 2
const VERTEX_HANDLE_STROKE_PX = 1
const VERTEX_HIGHLIGHT_EXTRA_RADIUS_PX = 2
const VERTEX_HIGHLIGHT_STROKE_PX = 1

// Scatter density dots should stay readable at any zoom level.
const SCATTER_DENSITY_DOT_RADIUS_PX = 3.5
const SCATTER_DENSITY_DOT_STROKE_PX = 1

// Canvas "world" coordinates are in meters (to match the 3D scene ground settings).
// For screen rendering we map meters -> CSS pixels using BASE_PIXELS_PER_METER.
const canvasSize = computed(() => ({
  width: sceneGroundSize.value.width,
  height: sceneGroundSize.value.height,
}))

// 性能优化：拖拽过程中如果动态改变舞台宽高，浏览器会频繁触发布局计算，拖到一定距离时容易出现明显卡顿。
// 因此拖拽期间冻结舞台尺寸，仅通过 transform 更新位置。
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

const vertexHandleRadiusWorld = computed(() => pxToWorld(VERTEX_HANDLE_RADIUS_PX))
const vertexHandleHitRadiusWorld = computed(() => pxToWorld(VERTEX_HANDLE_RADIUS_PX))
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
      roadSmoothing: layer.roadSmoothing,
      waterSmoothing: layer.waterSmoothing,
      floorSmooth: layer.floorSmooth,
      wallHeightMeters: layer.wallHeightMeters,
      wallThicknessMeters: layer.wallThicknessMeters,
    })),
    viewTransform: {
      scale: viewTransform.scale,
      offset: { x: viewTransform.offset.x, y: viewTransform.offset.y },
    },
    guides: planningGuides.value.map((g) => ({ id: g.id, axis: g.axis, value: g.value })),
    polygons: polygons.value.map((poly) => ({
      id: poly.id,
      name: poly.name,
      layerId: poly.layerId,
      points: poly.points.map((p) => ({ x: p.x, y: p.y })),
      airWallEnabled: poly.airWallEnabled ? true : undefined,
      scatter: poly.scatter
        ? {
          providerAssetId: poly.scatter.providerAssetId,
          assetId: poly.scatter.assetId,
          category: poly.scatter.category,
          name: poly.scatter.name,
          thumbnail: poly.scatter.thumbnail,
          densityPercent: clampDensityPercent(poly.scatter.densityPercent),
          footprintAreaM2: clampFootprintAreaM2(poly.scatter.category, poly.scatter.footprintAreaM2),
          footprintMaxSizeM: clampFootprintMaxSizeM(poly.scatter.category, poly.scatter.footprintMaxSizeM, poly.scatter.footprintAreaM2),
        }
        : undefined,
    })),
    polylines: polylines.value.map((line) => ({
      id: line.id,
      name: line.name,
      layerId: line.layerId,
      points: line.points.map((p) => ({ id: p.id, x: p.x, y: p.y })),
      cornerSmoothness: getLayerKind(line.layerId) === 'wall'
        ? clampWallCornerSmoothness(line.cornerSmoothness)
        : undefined,
      airWallEnabled: line.airWallEnabled ? true : undefined,
      scatter: line.scatter
        ? {
          providerAssetId: line.scatter.providerAssetId,
          assetId: line.scatter.assetId,
          category: line.scatter.category,
          name: line.scatter.name,
          thumbnail: line.scatter.thumbnail,
          densityPercent: clampDensityPercent(line.scatter.densityPercent),
          footprintAreaM2: clampFootprintAreaM2(line.scatter.category, line.scatter.footprintAreaM2),
          footprintMaxSizeM: clampFootprintMaxSizeM(line.scatter.category, line.scatter.footprintMaxSizeM, line.scatter.footprintAreaM2),
        }
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

  // 确保把 RAF 合并的最后一帧更新也落到状态里，再生成快照。
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

  const snapshot = buildPlanningSnapshot()
  const nextData = isPlanningSnapshotEmpty(snapshot) ? null : snapshot
  const currentData = sceneStore.planningData ?? null

  // 空场景默认不落盘，且不要因为“仅视图操作”造成未保存提示。
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
  convertingTo3DScene.value = true

  try {
    // Always clear previously generated conversion output so users can clean the scene
    // even when the current planning snapshot is empty.
    await clearPlanningGeneratedContent(sceneStore)
    if (!planningData) {
      return
    }

    const overwriteExisting = true

    // Close dialog first, then start conversion.
    dialogOpen.value = false
    await nextTick()

    await convertPlanningTo3DScene({
      sceneStore,
      planningData,
      overwriteExisting,
      onProgress: ({ step, progress }) => {
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
      autoClose: true,
      autoCloseDelay: 1200,
    })
  } catch (error) {
    console.error('Failed to convert planning to 3D scene', error)
    const message = error instanceof Error ? error.message : 'Conversion failed.'
    uiStore.updateLoadingOverlay({
      mode: 'determinate',
      progress: 100,
      message,
      closable: true,
      autoClose: false,
    })
  } finally {
    convertingTo3DScene.value = false
  }
}

function resetPlanningState() {
  planningImages.value = []
  planningGuides.value = []
  guideDraft.value = null
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
  const name = typeof payload.name === 'string' ? payload.name : 'Scatter 预设'
  const thumb = typeof payload.thumbnail === 'string' ? payload.thumbnail : null
  const densityPercent = clampDensityPercent(payload.densityPercent)
  const footprintAreaM2 = clampFootprintAreaM2(category, payload.footprintAreaM2)
  const footprintMaxSizeM = clampFootprintMaxSizeM(category, payload.footprintMaxSizeM, footprintAreaM2)
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

function loadPlanningFromScene() {
  const data = sceneStore.planningData
  resetPlanningState()
  if (!data) {
    // When there's no saved planning data (or no saved transform), default to fitting the whole canvas.
    void nextTick(() => fitViewToCanvas({ markDirty: false }))
    planningDirty = false
    return
  }

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
            roadSmoothing:
              typeof (raw as any).roadSmoothing === 'number'
                ? Number((raw as any).roadSmoothing)
                : ((kind ?? preset?.kind) === 'road' ? 0.5 : undefined),
            waterSmoothing:
              typeof (raw as any).waterSmoothing === 'number'
                ? Number((raw as any).waterSmoothing)
                : ((kind ?? preset?.kind) === 'water' ? 0.1 : undefined),
            wallHeightMeters:
              typeof (raw as any).wallHeightMeters === 'number'
                ? Number((raw as any).wallHeightMeters)
                : ((kind ?? preset?.kind) === 'wall' ? 3 : undefined),
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
      id: poly.id,
      name: poly.name,
      layerId: poly.layerId,
      points: poly.points.map((p) => ({ x: p.x, y: p.y })),
      airWallEnabled: Boolean((poly as any).airWallEnabled),
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

      return {
        id: line.id,
        name: line.name,
        layerId: line.layerId,
        points,
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

// 性能优化：合并高频 pointermove 更新，避免每次事件都触发响应式链路与样式计算。
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
        if (
          !previousHover
          || Math.abs(previousHover.x - nextHover.x) > 0.0001
          || Math.abs(previousHover.y - nextHover.y) > 0.0001
        ) {
          lineDraftHoverPoint.value = nextHover
        }
      }
      pendingLineHoverClient = null
    }
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
  return kind === 'road' || kind === 'wall'
})

const canUseAreaTools = computed(() => {
  const kind = activeLayer.value?.kind
  return kind !== 'road' && kind !== 'wall'
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

const selectedScatterAssignment = computed(() => selectedScatterTarget.value?.shape.scatter ?? null)

const selectedScatterPreview = computed(() => {
  const assignment = selectedScatterAssignment.value
  if (!assignment) {
    return null
  }
  const preset = terrainScatterPresets[assignment.category]
  return {
    name: assignment.name ?? preset?.label ?? 'Scatter 预设',
    thumbnail: assignment.thumbnail ?? null,
    categoryLabel: preset?.label ?? assignment.category,
    categoryIcon: preset?.icon ?? 'mdi-sprout',
  }
})

const propertyPanelDisabledReason = computed(() => {
  const target = selectedScatterTarget.value
  if (!target) {
    return 'No shape selected'
  }
  if (target.layer?.locked) {
    return 'Layer is locked'
  }
  return null
})

const propertyPanelDisabled = computed(() => propertyPanelDisabledReason.value !== null)

const propertyPanelLayerKind = computed<LayerKind | null>(() => {
  return selectedScatterTarget.value?.layer?.kind ?? null
})

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

const roadSmoothingModel = computed({
  get: () => {
    const layer = selectedScatterTarget.value?.layer
    if (!layer || layer.kind !== 'road') return 0.5
    const raw = Number(layer.roadSmoothing ?? 0.5)
    if (!Number.isFinite(raw)) return 0.5
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

const wallHeightMetersModel = computed({
  get: () => {
    const layer = selectedScatterTarget.value?.layer
    if (!layer || layer.kind !== 'wall') return 3
    const raw = Number(layer.wallHeightMeters ?? 3)
    return Number.isFinite(raw) && raw > 0 ? raw : 3
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
    // 在对话框打开期间切换场景：先把旧场景的规划数据写回，再加载新场景。
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
  return layers.value.find((layer) => layer.id === layerId)?.name ?? '未分层'
}

function getLayerColor(layerId: string, alpha = 1) {
  const layer = layers.value.find((item) => item.id === layerId)
  if (!layer) {
    return `rgba(255, 255, 255, ${alpha})`
  }
  return hexToRgba(layer.color, alpha)
}

function getLayerKind(layerId: string) {
  return layers.value.find((layer) => layer.id === layerId)?.kind ?? null
}

function getPolylineStrokeDasharray(layerId: string) {
  const kind = getLayerKind(layerId)
  // 道路：虚线（更易与墙体区分），墙体：实线。
  if (kind === 'road') {
    return '10 7'
  }
  return undefined
}

function getPolylineStroke(layerId: string) {
  const kind = getLayerKind(layerId)
  const alpha = kind === 'road' ? 0.85 : 0.95
  return getLayerColor(layerId, alpha)
}

function getPolylineStrokeWidth(layerId: string, isSelected = false) {
  const kind = getLayerKind(layerId)
  const selectedScale = 1.52
  if (kind === 'road') {
    const layer = layers.value.find((item) => item.id === layerId)
    const width = Number(layer?.roadWidthMeters ?? 2)
    if (!Number.isFinite(width) || width <= 0) {
      return isSelected ? 2 * selectedScale : 2
    }
    const clamped = Math.min(10, Math.max(0.1, width))
    return isSelected ? clamped * selectedScale : clamped
  }
  if (kind === 'wall') {
    const base = 3.2
    return isSelected ? base * selectedScale : base
  }
  const base = 1.05
  return isSelected ? base * selectedScale : base
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
  const kind = getLayerKind(layerId)
  return kind === 'road' ? undefined : 'non-scaling-stroke'
}

function canEditPolylineGeometry(layerId: string): boolean {
  const kind = getLayerKind(layerId)
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
  return !!layerId && layerId === activeLayerId.value
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
      roadSmoothing: kind === 'road' ? 0.5 : undefined,
      waterSmoothing: kind === 'water' ? 0.5 : undefined,
    wallHeightMeters: kind === 'wall' ? 3 : undefined,
    wallThicknessMeters: kind === 'wall' ? 0.15 : undefined,
    floorSmooth: kind === 'floor' ? 0.5 : undefined,
  }

  // 新建图层置顶（列表靠前）
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
  // 颜色需在图层创建后保持稳定，不随列表排序/置顶而改变。
  // 因此这里使用 imageId 的稳定哈希来选取调色板颜色。
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
  return {
    backgroundColor: hexToRgba(accent, 0.06),
    borderLeft: `4px solid ${hexToRgba(accent, 0.9)}`,
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

function findNearbyPolylineVertexInLayer(world: PlanningPoint, layerId: string) {
  const radiusWorld = LINE_VERTEX_SNAP_RADIUS_PX / Math.max(1e-6, renderScale.value)
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
    for (let index = 0; index < line.points.length; index += 1) {
      const point = line.points[index]
      if (!point) {
        continue
      }
      if (distancePointToPointSquared(world, point) <= radiusSq) {
        return { line, point, vertexIndex: index }
      }
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
  // 使用实时的 DOMRect，避免 rect 缓存滞后导致绘制/选择坐标错位。
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
  polygons.value.push({
    id: createId('poly'),
    name: `${labelPrefix ?? getLayerName(targetLayerId)} ${polygonCounter.value++}`,
    layerId: targetLayerId,
    points: clonePoints(points),
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

  // 第一次点击后即显示预览：使用 [首点, 鼠标点] 形成可见闭合线段。
  const previewPoints = pts.length === 1 ? [pts[0]!, hover] : [...pts, hover]
  const fill = previewPoints.length >= 3 ? 'rgba(98, 179, 255, 0.08)' : 'transparent'
  const smoothing = getLayerSmoothingValue(activeLayerId.value)
  return { d: getPolygonPath(previewPoints, smoothing), fill }
})

function startLineDraft(point: PlanningPoint) {
  if (!canUseLineTool.value) {
    return
  }

  const targetLayerId = lineDraft.value?.layerId ?? activeLayer.value?.id ?? layers.value[0]?.id ?? 'green-layer'
  const reuse = findNearbyPolylineVertexInLayer(point, targetLayerId)
  const reusePoint = reuse?.point

  if (!lineDraft.value && selectedVertex.value?.feature === 'polyline') {
    const sourceLine = polylines.value.find((item) => item.id === selectedVertex.value?.targetId)
    const sourcePoint = sourceLine?.points[selectedVertex.value.vertexIndex]
    if (sourceLine && sourcePoint) {
      const newPoint = reusePoint ?? createVertexPoint(point)
      if (newPoint === sourcePoint) {
        return
      }
      const sourceKind = getLayerKind(sourceLine.layerId)
      const newLine: PlanningPolyline = {
        id: createId('line'),
        name: `${getLayerName(sourceLine.layerId)} 线段 ${lineCounter.value++}`,
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

  const nextPoint = reusePoint ?? createVertexPoint(point)
  const draftLine = getDraftLine()
  if (!draftLine) {
    const targetKind = getLayerKind(targetLayerId)
    const newLine: PlanningPolyline = {
      id: createId('line'),
      name: `${getLayerName(targetLayerId)} 线段 ${lineCounter.value++}`,
      layerId: targetLayerId,
      points: [nextPoint],
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

  if (lineDraft.value?.continuation?.direction === 'prepend') {
    draftLine.points.unshift(nextPoint)
  } else {
    draftLine.points.push(nextPoint)
  }
  lineDraftHoverPoint.value = null
  pendingLineHoverClient = null
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
  selectFeature({ type: 'polyline', id: line.id })
  clearLineDraft({ keepLine: true })
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
  const layerId = lineDraft.value?.layerId ?? activeLayerId.value
  const kind = getLayerKind(layerId)
  const alpha = kind === 'road' ? 0.45 : 0.55
  return getLayerColor(layerId, alpha)
})

const lineDraftPreviewDasharray = computed(() => {
  const layerId = lineDraft.value?.layerId ?? activeLayerId.value
  return getPolylineStrokeDasharray(layerId)
})

const lineDraftPreviewStrokeWidth = computed(() => {
  const layerId = lineDraft.value?.layerId ?? activeLayerId.value
  return getPolylineStrokeWidth(layerId)
})

const lineDraftPreviewVectorEffect = computed(() => {
  const layerId = lineDraft.value?.layerId ?? activeLayerId.value
  return getPolylineVectorEffect(layerId)
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
  if (feature.type === 'polygon') {
    polygons.value = polygons.value.filter((item) => item.id !== feature.id)
    selectedFeature.value = null
    selectedVertex.value = null
    markPlanningDirty()
    return
  }

  if (feature.type === 'polyline') {
    const layerId = polylines.value.find((item) => item.id === feature.id)?.layerId
    if (layerId && !canEditPolylineGeometry(layerId)) {
      return
    }
  }

  if (feature.type === 'segment') {
    const layerId = polylines.value.find((item) => item.id === feature.lineId)?.layerId
    if (layerId && !canEditPolylineGeometry(layerId)) {
      return
    }
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
  selectedFeature.value = null
  selectedVertex.value = null
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

function handleScatterAssetSelect(payload: { asset: ProjectAsset; providerAssetId: string }) {
  if (propertyPanelDisabled.value) {
    return
  }
  const target = selectedScatterTarget.value
  if (!target) {
    return
  }
  const category = propertyScatterTab.value
  if (!(category in terrainScatterPresets)) {
    return
  }
  const thumbnail = payload.asset.thumbnail ?? null
  const existingDensity = target.shape.scatter?.densityPercent
  const defaultDensity = (target.type === 'polygon' && target.layer?.kind === 'green') ? 19 : 50

  const length = payload.asset.dimensionLength ?? null
  const width = payload.asset.dimensionWidth ?? null
  const rawArea = (typeof length === 'number' && typeof width === 'number' && Number.isFinite(length) && Number.isFinite(width) && length > 0 && width > 0)
    ? length * width
    : undefined
  const footprintAreaM2 = clampFootprintAreaM2(category, rawArea)
  const rawMaxSize = (typeof length === 'number' && typeof width === 'number' && Number.isFinite(length) && Number.isFinite(width) && length > 0 && width > 0)
    ? Math.max(length, width)
    : undefined
  const footprintMaxSizeM = clampFootprintMaxSizeM(category, rawMaxSize, footprintAreaM2)

  target.shape.scatter = {
    providerAssetId: payload.providerAssetId,
    assetId: payload.asset.id,
    category,
    name: payload.asset.name,
    thumbnail,
    densityPercent: clampDensityPercent(typeof existingDensity === 'number' ? existingDensity : defaultDensity),
    footprintAreaM2,
    footprintMaxSizeM,
  }
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

function clearSelectedScatterAssignment() {
  if (propertyPanelDisabled.value) {
    return
  }
  const target = selectedScatterTarget.value
  if (!target || !target.shape.scatter) {
    return
  }
  target.shape.scatter = undefined
  markPlanningDirty()
}

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

  // 点击画布空白处时，直接清空当前选择（所有工具通用）。
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

  // 平移视图：平移工具，或选择工具在空白处拖拽时
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
  // 自由绘制预览：拖拽状态为空时，跟随鼠标更新预览线条
  if (
    dialogOpen.value
    && dragState.value.type === 'idle'
    && currentTool.value === 'lasso'
    && polygonDraftPoints.value.length
  ) {
    pendingLassoHoverClient = { x: event.clientX, y: event.clientY }
    scheduleRafFlush()
  }

  // 线段绘制预览：拖拽状态为空时，跟随鼠标显示“最后一点 -> 鼠标”的预览线条
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
      const target = line?.points[state.vertexIndex]
      if (target) {
        target.x = world.x
        target.y = world.y
      }
      if (
        lineVertexClickState.value &&
        lineVertexClickState.value.pointerId === event.pointerId &&
        !lineVertexClickState.value.moved
      ) {
        lineVertexClickState.value = { ...lineVertexClickState.value, moved: true }
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

function handlePointerUp(event: PointerEvent) {
  const state = dragState.value
  if (state.type !== 'idle' && state.pointerId === event.pointerId) {
    const shouldDirty =
      state.type === 'pan'
      || state.type === 'move-polygon'
      || state.type === 'move-polyline'
      || state.type === 'drag-vertex'
      || state.type === 'move-image-layer'
      || state.type === 'move-align-marker'
      || state.type === 'resize-image-layer'

    if (state.type === 'rectangle') {
      finalizeRectangleDrag()
    }
    dragState.value = { type: 'idle' }
    // 释放冻结的舞台尺寸，让画布在操作结束后再统一更新。
    frozenCanvasSize.value = null

    if (shouldDirty) {
      markPlanningDirty()
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
  // 使用实时的 DOMRect，避免 editorRect 缓存滞后导致缩放中心漂移。
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
  const effectiveTool = currentTool.value === 'rectangle' || currentTool.value === 'lasso' || currentTool.value === 'line' ? 'select' : currentTool.value
  event.stopPropagation()
  event.preventDefault()
  selectFeature({ type: 'polygon', id: candidate.id })
  if (effectiveTool !== 'select') {
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
  activeLayerId.value = line.layerId
  lineDraft.value = {
    lineId,
    layerId: line.layerId,
    startPoints: clonePoints(line.points),
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

    markPlanningDirty()
  }
  image.onerror = () => {
    uploadError.value = '无法读取该图片，请重试或更换文件。'
    URL.revokeObjectURL(url)
  }
  image.src = url
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

function handleImageLayerOpacityChange(imageId: string, opacity: number) {
  const image = planningImages.value.find((img) => img.id === imageId)
  if (image) {
    image.opacity = opacity
    markPlanningDirty()
  }
}

function handleImageLayerDelete(imageId: string) {
  planningImages.value = planningImages.value.filter((img) => img.id !== imageId)
  if (activeImageId.value === imageId) {
    activeImageId.value = planningImages.value[0]?.id ?? null
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
  // 列表末尾 = 画布最底层
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
  // 非排序拖拽（文件/上传图标）交给列表级 drop 逻辑处理。
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
  // 规划图层作为“底图”，应允许在其上方进行区域选择/标注。
  // 因此仅在需要直接操作底图的工具下拦截事件。
  const tool = getEffectiveTool()
  if (tool !== 'select' && tool !== 'pan' && tool !== 'align-marker') {
    return
  }

  event.stopPropagation()
  event.preventDefault()
  frozenCanvasSize.value = { ...canvasSize.value }
  activeImageId.value = imageId
  const image = planningImages.value.find((img) => img.id === imageId)
  if (!image) {
    return
  }
  if (!image.visible) {
    return
  }
  if (tool === 'select') {
    return
  }
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

  // 为防误操作：只有在选择“平移”工具时才允许拖动规划图层。
  if (tool !== 'pan') {
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

// 这些符号用于规划图转换的后续能力扩展（区域/线段绘制、几何编辑等）。
// 当前画布实现以图片参考层为主，部分函数暂未在模板中引用；为避免 noUnusedLocals 报错，这里显式引用一次。
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

onMounted(() => {
  window.addEventListener('pointermove', handlePointerMove, { passive: false })
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerUp)
  window.addEventListener('resize', updateEditorRect)
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  // Make sure edits are not lost if the component is destroyed.
  persistPlanningToSceneIfDirty({ force: true })
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
                  title="上传规划图"
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
              class="image-layer-list"
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
                  'image-layer-item',
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
                <div class="image-layer-content">
                  <div class="image-layer-header">
                    <div class="image-layer-name">{{ image.name }}</div>
                    <div class="image-layer-actions">
                      <v-btn
                        icon
                        size="x-small"
                        variant="text"
                        :color="image.locked ? 'primary' : 'grey'"
                        @click.stop="handleImageLayerLockToggle(image.id)"
                      >
                        <v-icon size="18">{{ image.locked ? 'mdi-lock-outline' : 'mdi-lock-open-outline' }}</v-icon>
                      </v-btn>
                      <v-btn
                        icon
                        size="x-small"
                        variant="text"
                        :color="image.visible ? 'primary' : 'grey'"
                        @click.stop="handleImageLayerToggle(image.id)"
                      >
                        <v-icon size="18">{{ image.visible ? 'mdi-eye-outline' : 'mdi-eye-off-outline' }}</v-icon>
                      </v-btn>
                      <v-btn
                        icon
                        size="x-small"
                        variant="text"
                        color="error"
                        @click.stop="handleImageLayerDelete(image.id)"
                      >
                        <v-icon size="18">mdi-delete-outline</v-icon>
                      </v-btn>
                    </div>
                  </div>
                  <div class="image-layer-controls">
                    <div class="control-row">
                      <span class="control-label">Opacity</span>
                      <v-slider
                        :model-value="image.opacity"
                        min="0"
                        max="1"
                        step="0.1"
                        density="compact"
                        hide-details
                        @update:model-value="(v) => handleImageLayerOpacityChange(image.id, v)"
                      />
                      <span class="control-value">{{ Math.round(image.opacity * 100) }}%</span>
                    </div>
                  </div>
                </div>
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

              <v-tooltip text="重置视图" location="bottom">
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
            :style="editorBackgroundStyle"
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

                  <!-- 已绘制多边形区域 -->
                  <g v-for="poly in visiblePolygons" :key="poly.id">
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

                    <!-- 绿化散布密度预览（淡色点状） -->
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
                  </g>

                  
                  <!-- 已绘制线段（以 polyline 表示） -->
                  <g v-for="line in visiblePolylines" :key="line.id">
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

                    <!-- 端点命中区：允许直接点击端点继续绘制/拖动端点 -->
                    <circle
                      v-if="line.points.length"
                      class="line-endpoint-hit"
                      :cx="line.points[0]!.x"
                      :cy="line.points[0]!.y"
                      :r="vertexHandleHitRadiusWorld"
                      fill="transparent"
                      @pointerdown="handleLineVertexPointerDown(line.id, 0, $event as PointerEvent)"
                    />
                    <circle
                      v-if="line.points.length >= 2"
                      class="line-endpoint-hit"
                      :cx="line.points[line.points.length - 1]!.x"
                      :cy="line.points[line.points.length - 1]!.y"
                      :r="vertexHandleHitRadiusWorld"
                      fill="transparent"
                      @pointerdown="handleLineVertexPointerDown(line.id, line.points.length - 1, $event as PointerEvent)"
                    />
                  </g>

                  <!-- 矩形选择拖拽预览 -->
                  <path
                    v-if="dragState.type === 'rectangle'"
                    class="planning-rectangle-preview"
                    :d="getPolygonPath(createRectanglePoints(dragState.start, dragState.current), getLayerSmoothingValue(dragState.layerId))"
                    fill="rgba(98, 179, 255, 0.12)"
                    stroke="rgba(98, 179, 255, 0.45)"
                    stroke-width="0.1"
                  />

                  <!-- 自由选择绘制预览（点击加点，双击结束） -->
                  <path
                    v-if="polygonDraftPoints.length >= 1"
                    class="planning-polygon-draft"
                    :d="polygonDraftPreview.d"
                    :fill="polygonDraftPreview.fill"
                    stroke="rgba(98, 179, 255, 0.45)"
                    stroke-width="0.1"
                  />

                  <!-- 线段绘制预览 -->
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

                  <!-- 线段绘制中：显示顶点位置 -->
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

                  <!-- 顶点/当前操作点荧光高亮 -->
                  <circle
                    v-if="activeVertexHighlight"
                    class="vertex-highlight"
                    :cx="activeVertexHighlight.x"
                    :cy="activeVertexHighlight.y"
                    :r="activeVertexHighlight.r"
                    fill="none"
                    :stroke="getLayerColor(activeVertexHighlight.layerId, 0.95)"
                    :stroke-width="vertexHighlightStrokeWidthWorld"
                    filter="url(#vertex-glow)"
                    pointer-events="none"
                  />

                  <!-- 选中顶点荧光高亮 -->
                  <circle
                    v-if="selectedVertexHighlight"
                    class="vertex-highlight vertex-highlight--selected"
                    :cx="selectedVertexHighlight.x"
                    :cy="selectedVertexHighlight.y"
                    :r="selectedVertexHighlight.r"
                    fill="none"
                    :stroke="getLayerColor(selectedVertexHighlight.layerId, 0.85)"
                    :stroke-width="vertexHighlightStrokeWidthWorld"
                    filter="url(#vertex-glow)"
                    pointer-events="none"
                  />

                  <!-- 选中多边形顶点 -->
                  <g v-if="selectedPolygon">
                    <circle
                      v-for="(p, idx) in selectedPolygon.points"
                      :key="`${selectedPolygon.id}-v-${idx}`"
                      class="vertex-handle"
                      :cx="p.x"
                      :cy="p.y"
                      :r="vertexHandleRadiusWorld"
                      :fill="getLayerColor(selectedPolygon.layerId, 0.95)"
                      stroke="rgba(255,255,255,0.9)"
                      :stroke-width="vertexHandleStrokeWidthWorld"
                      pointer-events="visibleFill"
                      @pointerdown="handlePolygonVertexPointerDown(selectedPolygon.id, idx, $event as PointerEvent)"
                    />
                  </g>

                  <!-- 选中线段顶点 -->
                  <g v-if="selectedPolyline">
                    <circle
                      v-for="(p, idx) in selectedPolyline.points"
                      :key="`${selectedPolyline.id}-v-${idx}`"
                      class="vertex-handle"
                      :cx="p.x"
                      :cy="p.y"
                      :r="vertexHandleRadiusWorld"
                      :fill="getLayerColor(selectedPolyline.layerId, 0.95)"
                      stroke="rgba(255,255,255,0.9)"
                      :stroke-width="vertexHandleStrokeWidthWorld"
                      pointer-events="visibleFill"
                      @pointerdown="handleLineVertexPointerDown(selectedPolyline.id, idx, $event as PointerEvent)"
                    />
                  </g>
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
                </div>
                <div
                  v-for="(image, index) in planningImages"
                  :key="image.id"
                  :class="['planning-image', { active: activeImageId === image.id }]"
                  :style="getImageLayerStyle(image, index)"
                  @pointerdown="handleImageLayerPointerDown(image.id, $event as PointerEvent)"
                >
                  <img
                    class="planning-image-img"
                    :src="image.url"
                    :alt="image.name"
                    draggable="false"
                  >
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
              <h3>Shape Properties</h3>
              <span v-if="selectedScatterTarget" class="property-panel__subtitle">
                {{ selectedScatterTarget.shape.name }} ·
                {{ getLayerName(selectedScatterTarget.layer ? selectedScatterTarget.layer.id : '') }}
              </span>
            </div>
            <v-btn
              v-if="!propertyPanelDisabled && selectedScatterTarget && propertyPanelLayerKind === 'green' && selectedScatterTarget.shape.scatter"
              icon
              size="small"
              variant="text"
              color="grey"
              @click="clearSelectedScatterAssignment"
            >
              <v-icon size="18">mdi-close-circle-outline</v-icon>
            </v-btn>
          </header>

          <div v-if="propertyPanelDisabled" class="property-panel__placeholder">
            <v-icon icon="mdi-shape-outline" size="28" />
            <span>{{ propertyPanelDisabledReason }}</span>
          </div>
          <template v-else>
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

            <template v-if="propertyPanelLayerKind === 'green'">
              <div class="property-panel__density">
                <div class="property-panel__density-row">
                  <v-switch
                    v-model="airWallEnabledModel"
                    density="compact"
                    hide-details
                    inset
                    label="Air Wall"
                  />
                </div>
              </div>

              <div class="property-panel__scatter-preview">
                <div class="scatter-preview__thumbnail">
                  <img
                    v-if="selectedScatterPreview && selectedScatterPreview.thumbnail"
                    :src="selectedScatterPreview.thumbnail"
                    :alt="selectedScatterPreview.name"
                    loading="lazy"
                    draggable="false"
                  >
                  <div v-else class="scatter-preview__placeholder">
                    <v-icon icon="mdi-image-outline" size="20" />
                  </div>
                </div>
                <div class="scatter-preview__meta">
                  <div class="scatter-preview__name">
                    {{ selectedScatterPreview ? selectedScatterPreview.name : '未设置 Scatter 预设' }}
                  </div>
                  <div class="scatter-preview__category" :class="{ 'scatter-preview__category--empty': !selectedScatterPreview }">
                    <template v-if="selectedScatterPreview">
                      <v-icon :icon="selectedScatterPreview.categoryIcon" size="16" />
                      <span>{{ selectedScatterPreview.categoryLabel }}</span>
                    </template>
                    <template v-else>
                      <span>Select a preset below to apply to the current shape</span>
                    </template>
                  </div>
                </div>
              </div>

              <div class="property-panel__density">
                <div class="property-panel__density-title">密集度</div>
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
                <div class="property-panel__density-title">道路宽度</div>
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
                <div class="property-panel__spacing-title">连接平滑度</div>
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
            </template>

            <template v-else-if="propertyPanelLayerKind === 'water'">
              <div class="property-panel__density">
                <div class="property-panel__density-row">
                  <v-switch
                    v-model="airWallEnabledModel"
                    density="compact"
                    hide-details
                    inset
                    label="Air Wall"
                  />
                </div>

                <div class="property-panel__density-title">水面平滑度</div>
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
                <div class="property-panel__density-title">地面平滑度</div>
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
            </template>

            <template v-else-if="propertyPanelLayerKind === 'wall'">
              <div class="property-panel__density">
                <div class="property-panel__density-row">
                  <v-switch
                    v-model="airWallEnabledModel"
                    density="compact"
                    hide-details
                    inset
                    label="Air Wall"
                  />
                </div>

                <div class="property-panel__density-title">墙高</div>
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

                <div class="property-panel__spacing-title">墙厚</div>
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
              </div>
            </template>

            <template v-else>
              <!-- terrain/building/wall: empty for now -->
            </template>
          </template>
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

.property-panel__title {
  display: flex;
  flex-direction: column;
  gap: 4px;
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

.image-layer-panel {
  padding: 16px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.image-layer-panel header h3 {
  margin: 0;
  font-size: 1rem;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.image-layer-panel header span {
  font-size: 0.8rem;
  opacity: 0.6;
}

.image-layer-list {
  margin-top: 12px;
  background: transparent;
}

.image-layer-item {
  border-radius: 10px;
  margin-bottom: 8px;
  transition: background-color 0.2s ease;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.image-layer-item.active {
  background: rgba(100, 181, 246, 0.18);
  border-color: rgba(100, 181, 246, 0.3);
}

.image-layer-item.dragging {
  opacity: 0.65;
}

.image-layer-item.drag-over {
  outline: 1px dashed rgba(255, 255, 255, 0.35);
  outline-offset: 2px;
}

.image-layer-empty {
  border-radius: 10px;
  margin-bottom: 8px;
  padding: 12px 8px;
  border: 1px dashed rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
}

.image-layer-empty__text {
  font-size: 0.85rem;
  opacity: 0.65;
}

.image-layer-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.image-layer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.image-layer-name {
  font-weight: 600;
  font-size: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.image-layer-actions {
  display: flex;
  gap: 4px;
}

.image-layer-meta {
  font-size: 0.75rem;
  opacity: 0.7;
}

.image-layer-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
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
</style>
