<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { storeToRefs } from 'pinia'
import { generateUuid } from '@/utils/uuid'
import { useSceneStore } from '@/stores/sceneStore'
import { useUiStore } from '@/stores/uiStore'
import GroundAssetPainter from '@/components/inspector/GroundAssetPainter.vue'
import { terrainScatterPresets } from '@/resources/projectProviders/asset'
import type { TerrainScatterCategory } from '@harmony/schema/terrain-scatter'
import type { ProjectAsset } from '@/types/project-asset'
import { convertPlanningTo3DScene, findPlanningConversionRootIds } from '@/utils/planningToScene'

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
type LayerKind = 'terrain' | 'building' | 'road' | 'green' | 'wall'

interface PlanningLayer {
  id: string
  name: string
  kind: LayerKind
  visible: boolean
  color: string
  locked: boolean
}

interface PlanningPoint {
  x: number
  y: number
}

interface PlanningScatterAssignment {
  providerAssetId: string
  assetId: string
  category: TerrainScatterCategory
  name: string
  thumbnail: string | null
  /** 0-100, default 50. Used to scale generated scatter count. */
  densityPercent: number
}

interface PlanningPolygon {
  id: string
  name: string
  layerId: string
  points: PlanningPoint[]
  scatter?: PlanningScatterAssignment
}

interface PlanningPolyline {
  id: string
  name: string
  layerId: string
  points: PlanningPoint[]
  scatter?: PlanningScatterAssignment
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
  scaleRatio?: number
  // 对齐标记（存储在图片自身坐标系：原始像素坐标）
  alignMarker?: { x: number; y: number }
}

type SelectedFeature =
  | { type: 'polygon'; id: string }
  | { type: 'polyline'; id: string }
  | { type: 'segment'; lineId: string; segmentIndex: number }
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
  }
  | { type: 'move-align-marker'; pointerId: number; imageId: string }

interface LineDraft {
  layerId: string
  points: PlanningPoint[]
  continuation?: {
    lineId: string
    anchorIndex: number
    direction: 'prepend' | 'append'
  }
}

const layerPresets: PlanningLayer[] = [
  { id: 'terrain-layer', name: 'Terrain Layer', kind: 'terrain', visible: true, color: '#2E7D32', locked: false },
  { id: 'building-layer', name: 'Building Layer', kind: 'building', visible: true, color: '#C62828', locked: false },
  { id: 'road-layer', name: 'Road Layer', kind: 'road', visible: true, color: '#F9A825', locked: false },
  { id: 'green-layer', name: 'Greenery Layer', kind: 'green', visible: true, color: '#00897B', locked: false },
  { id: 'wall-layer', name: 'Wall Layer', kind: 'wall', visible: true, color: '#5E35B1', locked: false },
]

const imageAccentPalette = layerPresets.map((layer) => layer.color)

const layers = ref<PlanningLayer[]>(layerPresets.map((layer) => ({ ...layer })))
const activeLayerId = ref(layers.value[0]?.id ?? 'terrain-layer')
const polygons = ref<PlanningPolygon[]>([])
const polylines = ref<PlanningPolyline[]>([])
const polygonCounter = ref(1)
const lineCounter = ref(1)
const selectedFeature = ref<SelectedFeature>(null)
const selectedName = ref('')
const polygonDraftPoints = ref<PlanningPoint[]>([])
const polygonDraftHoverPoint = ref<PlanningPoint | null>(null)
const lineDraft = ref<LineDraft | null>(null)
const lineDraftHoverPoint = ref<PlanningPoint | null>(null)
const dragState = ref<DragState>({ type: 'idle' })
const viewTransform = reactive({ scale: 1, offset: { x: 0, y: 0 } })
const planningImages = ref<PlanningImage[]>([])
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
const spacePanning = ref(false)
const altPanning = ref(false)
const middlePanning = ref(false)
const temporaryPanActive = computed(() => spacePanning.value || altPanning.value || middlePanning.value)
const activeToolbarTool = computed<PlanningTool>(() => (temporaryPanActive.value ? 'pan' : currentTool.value))

const convertingTo3DScene = ref(false)

const canConvertTo3DScene = computed(() => {
  if (convertingTo3DScene.value) return false
  return polygons.value.length > 0 || polylines.value.length > 0
})

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
const visiblePolygons = computed(() => polygons.value.filter((poly) => visibleLayerIds.value.has(poly.layerId)))
const visiblePolylines = computed(() => polylines.value.filter((line) => visibleLayerIds.value.has(line.layerId)))

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

const polygonScatterDensityDots = computed<Record<string, PlanningPoint[]>>(() => {
  const result: Record<string, PlanningPoint[]> = {}
  for (const poly of visiblePolygons.value) {
    if (!poly.scatter) {
      continue
    }
    const layerKind = getLayerKind(poly.layerId)
    if (layerKind !== 'green') {
      continue
    }
    const densityPercent = clampDensityPercent(poly.scatter.densityPercent)
    if (densityPercent <= 0) {
      continue
    }
    const bounds = getPointsBounds(poly.points)
    if (!bounds) {
      continue
    }
    const boundsArea = bounds.width * bounds.height
    if (!Number.isFinite(boundsArea) || boundsArea < 60) {
      continue
    }
    // Keep preview cheap: dots scale with polygon size + user density.
    const maxDotsBySize = clampNumber(Math.floor(boundsArea / 800), 6, 60)
    const targetDots = Math.round((maxDotsBySize * densityPercent) / 100)
    if (targetDots <= 0) {
      continue
    }
    const random = buildRandom(hashSeedFromString(`${poly.id}:${densityPercent}`))
    const dots: PlanningPoint[] = []
    const maxAttempts = Math.min(4000, targetDots * 60)
    for (let attempt = 0; attempt < maxAttempts && dots.length < targetDots; attempt += 1) {
      const candidate = {
        x: bounds.minX + bounds.width * random(),
        y: bounds.minY + bounds.height * random(),
      }
      if (isPointInPolygon(candidate, poly.points)) {
        dots.push(candidate)
      }
    }
    if (dots.length) {
      result[poly.id] = dots
    }
  }
  return result
})

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
const BASE_PIXELS_PER_METER = 10
const POLYLINE_HIT_RADIUS_SQ = 1.5 * 1.5

const canvasSize = computed(() => ({
  width: sceneGroundSize.value.width,
  height: sceneGroundSize.value.height,
}))

// 性能优化：拖拽过程中如果动态改变舞台宽高，浏览器会频繁触发布局计算，拖到一定距离时容易出现明显卡顿。
// 因此拖拽期间冻结舞台尺寸，仅通过 transform 更新位置。
const frozenCanvasSize = ref<{ width: number; height: number } | null>(null)
const effectiveCanvasSize = computed(() => frozenCanvasSize.value ?? canvasSize.value)

const renderScale = computed(() => viewTransform.scale * BASE_PIXELS_PER_METER)

let planningDirty = false
function markPlanningDirty() {
  planningDirty = true
}

function buildPlanningSnapshot() {
  return {
    version: 1 as const,
    activeLayerId: activeLayerId.value,
    layers: layers.value.map((layer) => ({ id: layer.id, visible: layer.visible, locked: layer.locked })),
    viewTransform: {
      scale: viewTransform.scale,
      offset: { x: viewTransform.offset.x, y: viewTransform.offset.y },
    },
    polygons: polygons.value.map((poly) => ({
      id: poly.id,
      name: poly.name,
      layerId: poly.layerId,
      points: poly.points.map((p) => ({ x: p.x, y: p.y })),
      scatter: poly.scatter
        ? {
          providerAssetId: poly.scatter.providerAssetId,
          assetId: poly.scatter.assetId,
          category: poly.scatter.category,
          name: poly.scatter.name,
          thumbnail: poly.scatter.thumbnail,
          densityPercent: clampDensityPercent(poly.scatter.densityPercent),
        }
        : undefined,
    })),
    polylines: polylines.value.map((line) => ({
      id: line.id,
      name: line.name,
      layerId: line.layerId,
      points: line.points.map((p) => ({ x: p.x, y: p.y })),
      scatter: line.scatter
        ? {
          providerAssetId: line.scatter.providerAssetId,
          assetId: line.scatter.assetId,
          category: line.scatter.category,
          name: line.scatter.name,
          thumbnail: line.scatter.thumbnail,
          densityPercent: clampDensityPercent(line.scatter.densityPercent),
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
      scaleRatio: img.scaleRatio,
      alignMarker: img.alignMarker ? { x: img.alignMarker.x, y: img.alignMarker.y } : undefined,
    })),
  }
}

function isPlanningSnapshotEmpty(snapshot: ReturnType<typeof buildPlanningSnapshot>) {
  return snapshot.images.length === 0 && snapshot.polygons.length === 0 && snapshot.polylines.length === 0
}

function persistPlanningToSceneIfDirty() {
  if (!planningDirty) {
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
  // 空场景默认不落盘，且不要因为“仅视图操作”造成未保存提示。
  if (nextData === null && sceneStore.planningData === null) {
    planningDirty = false
    return
  }
  sceneStore.planningData = nextData
  sceneStore.hasUnsavedChanges = true
  planningDirty = false
}

async function handleConvertTo3DScene() {
  if (!canConvertTo3DScene.value) {
    return
  }

  // Ensure latest edits are persisted before conversion.
  persistPlanningToSceneIfDirty()

  const planningData = sceneStore.planningData
  if (!planningData) {
    return
  }

  const existingRoots = findPlanningConversionRootIds(sceneStore.nodes)
  let overwriteExisting = false
  if (existingRoots.length) {
    overwriteExisting = typeof window !== 'undefined'
      ? window.confirm('场景中已存在由规划转换的 3D 内容，是否覆盖？')
      : true
    if (!overwriteExisting) {
      return
    }
  }

  // Close dialog first, then start conversion.
  dialogOpen.value = false
  await nextTick()

  convertingTo3DScene.value = true
  uiStore.showLoadingOverlay({
    title: 'Convert to 3D Scene',
    message: 'Preparing…',
    mode: 'determinate',
    progress: 0,
    closable: false,
    autoClose: false,
  })

  try {
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
  polygons.value = []
  polylines.value = []
  polygonDraftPoints.value = []
  lineDraft.value = null
  selectedFeature.value = null
  activeImageId.value = null
  layers.value = layerPresets.map((layer) => ({ ...layer }))
  activeLayerId.value = layers.value[0]?.id ?? 'terrain-layer'
  viewTransform.scale = 1
  viewTransform.offset.x = 0
  viewTransform.offset.y = 0
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
  return {
    providerAssetId,
    assetId,
    category,
    name,
    thumbnail: thumb,
    densityPercent,
  }
}

function loadPlanningFromScene() {
  const data = sceneStore.planningData
  resetPlanningState()
  if (!data) {
    planningDirty = false
    return
  }

  if (data.activeLayerId) {
    activeLayerId.value = data.activeLayerId
  }
  if (Array.isArray(data.layers)) {
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
  }

  polygons.value = Array.isArray(data.polygons)
    ? data.polygons.map((poly) => ({
      id: poly.id,
      name: poly.name,
      layerId: poly.layerId,
      points: poly.points.map((p) => ({ x: p.x, y: p.y })),
      scatter: normalizeScatterAssignment((poly as Record<string, unknown>).scatter),
    }))
    : []

  polylines.value = Array.isArray(data.polylines)
    ? data.polylines.map((line) => ({
      id: line.id,
      name: line.name,
      layerId: line.layerId,
      points: line.points.map((p) => ({ x: p.x, y: p.y })),
      scatter: normalizeScatterAssignment((line as Record<string, unknown>).scatter),
    }))
    : []

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
      scaleRatio: img.scaleRatio,
      alignMarker: img.alignMarker ? { x: img.alignMarker.x, y: img.alignMarker.y } : undefined,
    }))
    : []

  activeImageId.value = planningImages.value[0]?.id ?? null
  planningDirty = false
}

function getEffectiveTool(): PlanningTool {
  return temporaryPanActive.value ? 'pan' : currentTool.value
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
      if (
        dialogOpen.value
        && dragState.value.type === 'idle'
        && currentTool.value === 'line'
        && lineDraft.value?.points.length
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

function tryBeginMiddlePan(event: PointerEvent) {
  if (event.button !== 1) {
    return false
  }
  if (dragState.value.type !== 'idle') {
    return false
  }
  event.preventDefault()
  event.stopPropagation()
  middlePanning.value = true
  beginPanDrag(event)
  return true
}
const canUseLineTool = computed(() => {
  const kind = activeLayer.value?.kind
  return kind === 'road' || kind === 'wall'
})

const canDeleteSelection = computed(() => !!selectedFeature.value)

const layerFeatureTotals = computed(() =>
  layers.value.map((layer) => {
    const polygonCount = polygons.value.filter((item) => item.layerId === layer.id).length
    const lineCount = polylines.value.filter((item) => item.layerId === layer.id).length
    return { id: layer.id, polygons: polygonCount, lines: lineCount }
  }),
)

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

const editorBackgroundStyle = computed(() => {
  return {
    backgroundImage:
      'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.04) 75%), linear-gradient(180deg, rgba(255,255,255,0.04) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.04) 75%)',
    backgroundSize: '48px 48px',
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
  return {
    width: `${effectiveCanvasSize.value.width}px`,
    height: `${effectiveCanvasSize.value.height}px`,
    transform: `translate(${center.x + viewTransform.offset.x * scale}px, ${center.y + viewTransform.offset.y * scale}px) scale(${scale})`,
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
    spacePanning.value = false
    altPanning.value = false
    middlePanning.value = false
    persistPlanningToSceneIfDirty()
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
    if (previous === 'lasso' && tool !== 'lasso' && polygonDraftPoints.value.length) {
      polygonDraftPoints.value = []
      polygonDraftHoverPoint.value = null
      pendingLassoHoverClient = null
    }
    if (previous === 'line' && tool !== 'line' && lineDraft.value) {
      lineDraft.value = null
      lineDraftHoverPoint.value = null
      pendingLineHoverClient = null
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
      persistPlanningToSceneIfDirty()
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
    return
  }
  const layerId = getFeatureLayerId(feature)
  if (!layerId || !isActiveLayer(layerId)) {
    selectedFeature.value = null
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

function clonePoint(point: PlanningPoint): PlanningPoint {
  return { x: Number(point.x.toFixed(2)), y: Number(point.y.toFixed(2)) }
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
    left: `${world.x}px`,
    top: `${world.y}px`,
    zIndex: 10000,
    background: accent,
    boxShadow: `0 0 0 3px ${hexToRgba(accent, 0.22)}`,
    ...( { '--marker-accent': accent } as unknown as Record<string, string> ),
  }
}

function getImageLayerStyle(image: PlanningImage, zIndex: number): CSSProperties {
  const accent = getImageAccentColor(image.id)
  return {
    transform: `translate(${image.position.x}px, ${image.position.y}px) scale(${image.scale})`,
    transformOrigin: 'top left',
    width: `${image.width}px`,
    height: `${image.height}px`,
    opacity: image.visible ? image.opacity : 0,
    zIndex: zIndex + 1,
    pointerEvents: image.visible ? 'auto' : 'none',
    willChange: 'transform',
    backgroundColor: hexToRgba(accent, 0.06),
    cursor:
      image.visible && !image.locked && (currentTool.value === 'pan' || temporaryPanActive.value)
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
  let inside = false
  for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
    const pi = polygonPoints[i]
    const pj = polygonPoints[j]
    const intersects = pj && pi && ((pi.y > point.y) !== (pj.y > point.y))
      && point.x < ((pj.x - pi.x) * (point.y - pi.y)) / ((pj.y - pi.y) || 1e-9) + pi.x
    if (intersects) {
      inside = !inside
    }
  }
  return inside
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
    const segments = getLineSegments(line)
    for (const segment of segments) {
      const distSq = distancePointToSegmentSquared(point, segment.start, segment.end)
      if (distSq <= POLYLINE_HIT_RADIUS_SQ) {
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
    const segments = getLineSegments(line)
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]
      if (!segment) {
        continue
      }
      const distSq = distancePointToSegmentSquared(point, segment.start, segment.end)
      if (distSq <= POLYLINE_HIT_RADIUS_SQ) {
        return { line, segmentIndex: index }
      }
    }
  }
  return null
}

function screenToWorld(event: MouseEvent | PointerEvent): PlanningPoint {
  // 使用实时的 DOMRect，避免 rect 缓存滞后导致绘制/选择坐标错位。
  const rect = editorRef.value?.getBoundingClientRect()
  if (!rect) {
    return { x: 0, y: 0 }
  }
  const scale = renderScale.value
  const center = computeStageCenterOffset(rect, scale)
  const x = (event.clientX - rect.left - center.x) / scale - viewTransform.offset.x
  const y = (event.clientY - rect.top - center.y) / scale - viewTransform.offset.y
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
  if (tryBeginMiddlePan(event)) {
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
  return { d: getPolygonPath(previewPoints), fill }
})

function startLineDraft(point: PlanningPoint) {
  if (!canUseLineTool.value) {
    return
  }
  if (!lineDraft.value) {
    lineDraft.value = {
      layerId: activeLayer.value?.id ?? layers.value[0]?.id ?? 'terrain-layer',
      points: [point],
    }
    return
  }
  lineDraft.value = {
    ...lineDraft.value,
    points: [...lineDraft.value.points, point],
  }
}

function finalizeLineDraft() {
  const draft = lineDraft.value
  if (!draft || draft.points.length < 2) {
    lineDraft.value = null
    lineDraftHoverPoint.value = null
    return
  }
  if (draft.continuation) {
    const line = polylines.value.find((item) => item.id === draft.continuation?.lineId)
    if (line) {
      const newPoints = clonePoints(draft.points.slice(1))
      if (newPoints.length) {
        if (draft.continuation.direction === 'append') {
          line.points.push(...newPoints)
        } else {
          newPoints.reverse()
          line.points.unshift(...newPoints)
        }
        selectFeature({ type: 'polyline', id: line.id })
      }
    }
    lineDraft.value = null
    lineDraftHoverPoint.value = null
    markPlanningDirty()
    return
  }
  const newLine: PlanningPolyline = {
    id: createId('line'),
    name: `${getLayerName(draft.layerId)} 线段 ${lineCounter.value++}`,
    layerId: draft.layerId,
    points: clonePoints(draft.points),
  }
  polylines.value = [...polylines.value, newLine]
  selectFeature({ type: 'polyline', id: newLine.id })
  lineDraft.value = null
  lineDraftHoverPoint.value = null
  markPlanningDirty()
}

const lineDraftPreviewPath = computed(() => {
  const draft = lineDraft.value
  if (!draft || !draft.points.length) {
    return ''
  }
  const hover = lineDraftHoverPoint.value
  if (!hover) {
    return getPolylinePath(draft.points)
  }
  const previewPoints = draft.points.length === 1 ? [draft.points[0]!, hover] : [...draft.points, hover]
  return getPolylinePath(previewPoints)
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

function selectFeature(feature: SelectedFeature) {
  if (!feature) {
    selectedFeature.value = null
    return
  }
  const layerId = getFeatureLayerId(feature)
  if (!layerId || !isActiveLayer(layerId)) {
    selectedFeature.value = null
    return
  }
  selectedFeature.value = feature
}

function deleteSelectedFeature() {
  const feature = selectedFeature.value
  if (!feature) {
    return
  }
  if (feature.type === 'polygon') {
    polygons.value = polygons.value.filter((item) => item.id !== feature.id)
    selectedFeature.value = null
    markPlanningDirty()
    return
  }
  if (feature.type === 'polyline') {
    polylines.value = polylines.value.filter((item) => item.id !== feature.id)
    selectedFeature.value = null
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
    markPlanningDirty()
    return
  }
  const removeIndex = Math.min(feature.segmentIndex + 1, line.points.length - 1)
  line.points.splice(removeIndex, 1)
  selectedFeature.value = null
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
  target.shape.scatter = {
    providerAssetId: payload.providerAssetId,
    assetId: payload.asset.id,
    category,
    name: payload.asset.name,
    thumbnail,
    densityPercent: clampDensityPercent(existingDensity),
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

  if (tryBeginMiddlePan(event)) {
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

  // 平移视图：平移工具、按住 Space/Alt，或选择工具在空白处拖拽时
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
  const rectangleActive = dragState.value.type === 'rectangle'
  const polygonDraftActive = polygonDraftPoints.value.length > 0
  const lineDraftActive = !!(lineDraft.value && lineDraft.value.points.length > 0)
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
    && lineDraft.value?.points.length
  ) {
    pendingLineHoverClient = { x: event.clientX, y: event.clientY }
    scheduleRafFlush()
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
      line.points = state.startPoints.map((point) => ({
        x: point.x + dx,
        y: point.y + dy,
      }))
    }
    return
  }
  if (state.type === 'drag-vertex') {
    const world = screenToWorld(event)
    if (state.feature === 'polygon') {
      const polygon = polygons.value.find((item) => item.id === state.targetId)
      if (polygon?.points[state.vertexIndex]) {
        polygon.points[state.vertexIndex] = clonePoint(world)
      }
    } else {
      const line = polylines.value.find((item) => item.id === state.targetId)
      if (line?.points[state.vertexIndex]) {
        line.points[state.vertexIndex] = clonePoint(world)
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
  if (
    lineVertexClickState.value &&
    lineVertexClickState.value.pointerId === event.pointerId &&
    !lineVertexClickState.value.moved
  ) {
    startLineContinuation(lineVertexClickState.value.lineId, lineVertexClickState.value.vertexIndex)
  }
  lineVertexClickState.value = null

  if (event.button === 1 || event.type === 'pointercancel') {
    middlePanning.value = false
  }
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
  const nextViewScale = Math.min(8, Math.max(0.1, previousViewScale + delta * previousViewScale))
  if (nextViewScale === previousViewScale) {
    return
  }

  // 以鼠标指针为中心缩放：保持“指针下的世界坐标点”在缩放前后不变。
  const previousRenderScale = previousViewScale * BASE_PIXELS_PER_METER
  const centerBefore = computeStageCenterOffset(rect, previousRenderScale)
  const sx = event.clientX - rect.left
  const sy = event.clientY - rect.top
  const worldX = (sx - centerBefore.x) / previousRenderScale - viewTransform.offset.x
  const worldY = (sy - centerBefore.y) / previousRenderScale - viewTransform.offset.y

  // 预计算缩放后的居中偏移（使用 nextScale），保持指针所指世界坐标不变。
  const nextRenderScale = nextViewScale * BASE_PIXELS_PER_METER
  const nextCenter = computeStageCenterOffset(rect, nextRenderScale)

  viewTransform.scale = nextViewScale
  viewTransform.offset.x = (sx - nextCenter.x) / nextRenderScale - worldX
  viewTransform.offset.y = (sy - nextCenter.y) / nextRenderScale - worldY
  markPlanningDirty()
}

function cancelActiveDrafts() {
  polygonDraftPoints.value = []
  polygonDraftHoverPoint.value = null
  lineDraft.value = null
  lineDraftHoverPoint.value = null
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
  if (event.key === 'Alt' || event.code === 'AltLeft' || event.code === 'AltRight') {
    event.preventDefault()
    if (!altPanning.value) {
      altPanning.value = true
    }
    return
  }
  if (event.code === 'Space') {
    event.preventDefault()
    spacePanning.value = true
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
    if (currentTool.value === 'line' && lineDraft.value?.points.length && lineDraft.value.points.length >= 2) {
      event.preventDefault()
      finalizeLineDraft()
    }
  }
}

function handleKeyup(event: KeyboardEvent) {
  if (!dialogOpen.value) {
    return
  }
  if (event.code === 'Space') {
    event.preventDefault()
    spacePanning.value = false
  }
  if (event.key === 'Alt' || event.code === 'AltLeft' || event.code === 'AltRight') {
    event.preventDefault()
    altPanning.value = false
  }
}

function handlePolygonPointerDown(polygonId: string, event: PointerEvent) {
  if (tryBeginMiddlePan(event)) {
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
  if (tryBeginMiddlePan(event)) {
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
  if (effectiveTool !== 'select') {
    return
  }
  dragState.value = {
    type: 'drag-vertex',
    pointerId: event.pointerId,
    feature: 'polygon',
    targetId: polygonId,
    vertexIndex,
  }
  event.currentTarget instanceof Element && event.currentTarget.setPointerCapture(event.pointerId)
}

function handlePolylinePointerDown(lineId: string, event: PointerEvent) {
  if (tryBeginMiddlePan(event)) {
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
  if (tryBeginMiddlePan(event)) {
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
  if (tryBeginMiddlePan(event)) {
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
  if (effectiveTool !== 'select') {
    return
  }
  const skipSplit = event.ctrlKey || event.metaKey
  const targetSegmentIndex = picked?.segmentIndex ?? segmentIndex
  splitSegmentAt(line.id, targetSegmentIndex, world, skipSplit)
}

function splitSegmentAt(lineId: string, segmentIndex: number, point: PlanningPoint, skipSplit = false) {
  const line = polylines.value.find((item) => item.id === lineId)
  if (!line) {
    return
  }
  if (skipSplit) {
    selectFeature({ type: 'segment', lineId, segmentIndex })
    return
  }
  if (segmentIndex < 0 || segmentIndex >= line.points.length - 1) {
    return
  }
  line.points.splice(segmentIndex + 1, 0, clonePoint(point))
  selectFeature({ type: 'segment', lineId, segmentIndex })
  markPlanningDirty()
}

function startLineContinuation(lineId: string, vertexIndex: number) {
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
  currentTool.value = 'line'
  activeLayerId.value = line.layerId
  lineDraft.value = {
    layerId: line.layerId,
    points: [clonePoint(point)],
    continuation: {
      lineId,
      anchorIndex: vertexIndex,
      direction: vertexIndex === 0 ? 'prepend' : 'append',
    },
  }
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
      scaleRatio: undefined,
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
  viewTransform.scale = 1
  viewTransform.offset = { x: 0, y: 0 }
  markPlanningDirty()
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

function handleImageLayerScaleRatioChange(imageId: string, scaleRatio: number | undefined) {
  const image = planningImages.value.find((img) => img.id === imageId)
  if (!image) {
    return
  }
  // 比例尺：1像素 = N米（metersPerPixel）。改变时需实时更新图层显示大小。
  // 锁定或隐藏时，禁止缩放/比例尺调整。
  if (!image.visible || image.locked) {
    return
  }
  if (scaleRatio === undefined) {
    image.scaleRatio = undefined
    markPlanningDirty()
    return
  }
  const next = Number(scaleRatio)
  if (!Number.isFinite(next) || next <= 0) {
    return
  }
  image.scaleRatio = next
  image.scale = next
  markPlanningDirty()
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
  if (tryBeginMiddlePan(event)) {
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
  if (tryBeginMiddlePan(event)) {
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

function getPolygonPath(points: PlanningPoint[]) {
  if (!points.length) {
    return ''
  }
  const segments = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
  return `${segments.join(' ')} Z`
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
  window.addEventListener('keyup', handleKeyup)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', handlePointerUp)
  window.removeEventListener('pointercancel', handlePointerUp)
  window.removeEventListener('resize', updateEditorRect)
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('keyup', handleKeyup)
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
                    <div class="control-row">
                      <span class="control-label">m/px</span>
                      <v-text-field
                        :model-value="image.scaleRatio ?? ''"
                        type="number"
                        min="0"
                        step="any"
                        placeholder="例如 0.5"
                        suffix="m/px"
                        density="compact"
                        variant="underlined"
                        hide-details
                        :disabled="!image.visible || image.locked"
                        @update:model-value="(v) => handleImageLayerScaleRatioChange(image.id, v === '' || v === null || v === undefined ? undefined : Number(v))"
                      />
                    </div>
                  </div>
                </div>
              </v-list-item>
            </v-list>
          </section>
          <section class="layer-panel">
            <header>
              <h3>Layer Management</h3>
            </header>
            <v-list density="compact" class="layer-list">
              <v-list-item
                v-for="layer in layers"
                :key="layer.id"
                :class="['layer-item', { active: activeLayerId === layer.id }]"
                :style="getLayerListItemStyle(layer)"
                @click="handleLayerSelection(layer.id)"
              >
                <div class="layer-content">
                  <div class="layer-name">{{ layer.name }}</div>
                  <div class="layer-meta">
                    <span>Areas {{ layerFeatureTotals.find((item) => item.id === layer.id)?.polygons ?? 0 }}</span>
                    <span>Lines {{ layerFeatureTotals.find((item) => item.id === layer.id)?.lines ?? 0 }}</span>
                  </div>
                </div>
                <template #append>
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
                v-for="button in toolbarButtons"
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
                    :disabled="button.tool === 'line' && !canUseLineTool"
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
                    :disabled="!canConvertTo3DScene"
                    @click="handleConvertTo3DScene"
                  >
                    <v-icon>mdi-cube-outline</v-icon>
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
            @contextmenu="handleEditorContextMenu"
          >
            <div class="canvas-viewport">
              <div class="canvas-stage" :style="stageStyle">

                <svg
                  class="vector-overlay"
                  :width="effectiveCanvasSize.width"
                  :height="effectiveCanvasSize.height"
                  :viewBox="`0 0 ${effectiveCanvasSize.width} ${effectiveCanvasSize.height}`"
                >
                  <!-- 已绘制多边形区域 -->
                  <g v-for="poly in visiblePolygons" :key="poly.id">
                    <path
                      class="planning-polygon"
                      :class="{
                        selected: selectedFeature?.type === 'polygon' && selectedFeature.id === poly.id,
                        'inactive-layer-feature': !isActiveLayer(poly.layerId),
                      }"
                      :d="getPolygonPath(poly.points)"
                      :fill="getLayerColor(poly.layerId, 0.22)"
                      :stroke="getLayerColor(poly.layerId, 0.95)"
                      stroke-width="0.1"
                      @pointerdown="handlePolygonPointerDown(poly.id, $event as PointerEvent)"
                    />

                    <!-- 绿化散布密度预览（淡色点状） -->
                    <g
                      v-if="polygonScatterDensityDots[poly.id]?.length"
                      class="scatter-density-dots"
                      pointer-events="none"
                    >
                      <circle
                        v-for="(p, idx) in polygonScatterDensityDots[poly.id]"
                        :key="`${poly.id}-density-dot-${idx}`"
                        :cx="p.x"
                        :cy="p.y"
                        r="0.6"
                        :fill="getLayerColor(poly.layerId, 0.18)"
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
                      vector-effect="non-scaling-stroke"
                      stroke-width="1.05"
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
                      stroke-width="14"
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
                      r="10"
                      fill="transparent"
                      @pointerdown="handleLineVertexPointerDown(line.id, 0, $event as PointerEvent)"
                    />
                    <circle
                      v-if="line.points.length >= 2"
                      class="line-endpoint-hit"
                      :cx="line.points[line.points.length - 1]!.x"
                      :cy="line.points[line.points.length - 1]!.y"
                      r="10"
                      fill="transparent"
                      @pointerdown="handleLineVertexPointerDown(line.id, line.points.length - 1, $event as PointerEvent)"
                    />
                  </g>

                  <!-- 矩形选择拖拽预览 -->
                  <path
                    v-if="dragState.type === 'rectangle'"
                    class="planning-rectangle-preview"
                    :d="getPolygonPath(createRectanglePoints(dragState.start, dragState.current))"
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
                    v-if="lineDraft?.points?.length"
                    class="planning-line-draft"
                    :d="lineDraftPreviewPath"
                    :stroke="lineDraftPreviewStroke"
                    stroke-width="1.5"
                    :stroke-dasharray="lineDraftPreviewDasharray"
                    vector-effect="non-scaling-stroke"
                    fill="none"
                  />

                  <!-- 选中多边形顶点 -->
                  <g v-if="selectedPolygon">
                    <circle
                      v-for="(p, idx) in selectedPolygon.points"
                      :key="`${selectedPolygon.id}-v-${idx}`"
                      class="vertex-handle"
                      :cx="p.x"
                      :cy="p.y"
                      r="1"
                      :fill="getLayerColor(selectedPolygon.layerId, 0.95)"
                      stroke="rgba(255,255,255,0.9)"
                      stroke-width="1"
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
                      r="1"
                      :fill="getLayerColor(selectedPolyline.layerId, 0.95)"
                      stroke="rgba(255,255,255,0.9)"
                      stroke-width="1"
                      @pointerdown="handleLineVertexPointerDown(selectedPolyline.id, idx, $event as PointerEvent)"
                    />
                  </g>
                </svg>
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
              v-if="!propertyPanelDisabled && selectedScatterTarget && selectedScatterTarget.shape.scatter"
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
                <v-slider
                  v-model="scatterDensityPercentModel"
                  min="0"
                  max="100"
                  step="1"
                  density="compact"
                  hide-details
                  :disabled="!scatterDensityEnabled"
                />
                <div class="property-panel__density-value">{{ scatterDensityPercentModel }}%</div>
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
                  @asset-select="handleScatterAssetSelect"
                />
              </v-window-item>
            </v-window>
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
  grid-template-columns: 260px minmax(0, 1fr) 380px;
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
  flex-direction: column;
  gap: 8px;
}

.tool-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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
  background-color: rgba(16, 19, 28, 0.85);
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

.planning-polygon,
.planning-line,
.planning-line-segment,
.vertex-handle,
.line-endpoint-hit {
  pointer-events: auto;
}

.planning-line {
  stroke-width: 1.05;
  stroke-linecap: round;
  stroke-linejoin: round;
  cursor: pointer;
}

.planning-line.selected {
  stroke-width: 1.6;
}

.planning-line-segment {
  cursor: cell;
}

.planning-rectangle-preview,
.planning-polygon-draft,
.planning-line-draft {
  pointer-events: none;
}

.vertex-handle {
  cursor: grab;
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
  opacity: 0.28;
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
