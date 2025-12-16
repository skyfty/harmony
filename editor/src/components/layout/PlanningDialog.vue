<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { generateUuid } from '@/utils/uuid'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>()
const dialogOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

type PlanningTool = 'select' | 'pan' | 'rectangle' | 'lasso' | 'line' | 'align-marker'
type LayerKind = 'terrain' | 'building' | 'road' | 'green' | 'wall'

interface PlanningLayer {
  id: string
  name: string
  kind: LayerKind
  visible: boolean
  color: string
}

interface PlanningPoint {
  x: number
  y: number
}

interface PlanningPolygon {
  id: string
  name: string
  layerId: string
  points: PlanningPoint[]
}

interface PlanningPolyline {
  id: string
  name: string
  layerId: string
  points: PlanningPoint[]
}

interface PlanningImage {
  id: string
  name: string
  url: string
  sizeLabel: string
  width: number
  height: number
  visible: boolean
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
  { id: 'terrain-layer', name: '地形层', kind: 'terrain', visible: true, color: '#4caf50' },
  { id: 'building-layer', name: '建筑物层', kind: 'building', visible: true, color: '#ff7043' },
  { id: 'road-layer', name: '道路层', kind: 'road', visible: true, color: '#ffa726' },
  { id: 'green-layer', name: '绿化层', kind: 'green', visible: true, color: '#66bb6a' },
  { id: 'wall-layer', name: '墙体层', kind: 'wall', visible: true, color: '#29b6f6' },
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
const lineDraft = ref<LineDraft | null>(null)
const dragState = ref<DragState>({ type: 'idle' })
const viewTransform = reactive({ scale: 1, offset: { x: 0, y: 0 } })
const planningImages = ref<PlanningImage[]>([])
const activeImageId = ref<string | null>(null)
const draggingImageId = ref<string | null>(null)
const dragOverImageId = ref<string | null>(null)
const alignModeActive = ref(false)
const hasAlignMarkerCandidates = computed(() => planningImages.value.some((img) => img.visible && !!img.alignMarker))
const uploadError = ref<string | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const editorRef = ref<HTMLDivElement | null>(null)
const editorRect = ref<DOMRect | null>(null)
const currentTool = ref<PlanningTool>('select')
const lineVertexClickState = ref<{ lineId: string; vertexIndex: number; pointerId: number; moved: boolean } | null>(null)
const spacePanning = ref(false)

const activeLayer = computed(() => layers.value.find((layer) => layer.id === activeLayerId.value) ?? layers.value[0])
const canvasSize = computed(() => {
  if (!planningImages.value.length) {
    return { width: 2048, height: 2048 }
  }
  let maxWidth = 0
  let maxHeight = 0
  planningImages.value.forEach(img => {
    const w = img.position.x + img.width * img.scale
    const h = img.position.y + img.height * img.scale
    if (w > maxWidth) maxWidth = w
    if (h > maxHeight) maxHeight = h
  })
  return { width: Math.max(maxWidth, 2048), height: Math.max(maxHeight, 2048) }
})

// 性能优化：拖拽过程中如果动态改变舞台宽高，浏览器会频繁触发布局计算，拖到一定距离时容易出现明显卡顿。
// 因此拖拽期间冻结舞台尺寸，仅通过 transform 更新位置。
const frozenCanvasSize = ref<{ width: number; height: number } | null>(null)
const effectiveCanvasSize = computed(() => frozenCanvasSize.value ?? canvasSize.value)

// 性能优化：合并高频 pointermove 更新，避免每次事件都触发响应式链路与样式计算。
let rafScheduled = false
let pendingPan: { x: number; y: number } | null = null
let pendingImageMoves: Array<{ imageId: string; x: number; y: number }> | null = null
let pendingMarkerMove: { imageId: string; localX: number; localY: number } | null = null

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
  })
}
const canUseLineTool = computed(() => {
  const kind = activeLayer.value?.kind
  return kind === 'road' || kind === 'wall'
})

const layerFeatureTotals = computed(() =>
  layers.value.map((layer) => {
    const polygonCount = polygons.value.filter((item) => item.layerId === layer.id).length
    const lineCount = polylines.value.filter((item) => item.layerId === layer.id).length
    return { id: layer.id, polygons: polygonCount, lines: lineCount }
  }),
)

const editorBackgroundStyle = computed(() => {
  return {
    backgroundImage:
      'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.04) 75%), linear-gradient(180deg, rgba(255,255,255,0.04) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.04) 75%)',
    backgroundSize: '48px 48px',
  }
})

const stageStyle = computed<CSSProperties>(() => {
  const scale = viewTransform.scale
  return {
    width: `${effectiveCanvasSize.value.width}px`,
    height: `${effectiveCanvasSize.value.height}px`,
    transform: `translate(${viewTransform.offset.x * scale}px, ${viewTransform.offset.y * scale}px) scale(${scale})`,
    transformOrigin: 'top left',
    willChange: 'transform',
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

watch(
  currentTool,
  (tool, previous) => {
    if (tool === 'line' && !canUseLineTool.value) {
      currentTool.value = 'select'
      return
    }
    if (previous === 'lasso' && tool !== 'lasso' && polygonDraftPoints.value.length) {
      polygonDraftPoints.value = []
    }
    if (previous === 'line' && tool !== 'line' && lineDraft.value) {
      lineDraft.value = null
    }
  },
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
}

function getImageAccentColor(imageId: string): string {
  const index = planningImages.value.findIndex((img) => img.id === imageId)
  const paletteIndex = (index >= 0 ? index : 0) % imageAccentPalette.length
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
    pointerEvents: 'auto',
    willChange: 'transform',
    backgroundColor: hexToRgba(accent, 0.06),
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
  const bgAlpha = isActive ? 0.14 : 0.06
  const borderAlpha = isActive ? 0.95 : 0.9
  return {
    backgroundColor: hexToRgba(layer.color, bgAlpha),
    borderLeft: `4px solid ${hexToRgba(layer.color, borderAlpha)}`,
    borderColor: hexToRgba(layer.color, isActive ? 0.35 : 0.12),
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

function screenToWorld(event: MouseEvent | PointerEvent): PlanningPoint {
  const rect = editorRect.value ?? editorRef.value?.getBoundingClientRect()
  if (!rect) {
    return { x: 0, y: 0 }
  }
  const x = (event.clientX - rect.left) / viewTransform.scale - viewTransform.offset.x
  const y = (event.clientY - rect.top) / viewTransform.scale - viewTransform.offset.y
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

function alignImageLayersByMarkers() {
  const candidates = planningImages.value.filter((img) => img.visible && img.alignMarker)
  if (!candidates.length) {
    return
  }
  const active = activeImageId.value
    ? candidates.find((img) => img.id === activeImageId.value)
    : null
  const reference = active ?? candidates[0]
  if (!reference) {
    return
  }
  const refWorld = getAlignMarkerWorld(reference)
  if (!refWorld) {
    return
  }
  candidates.forEach((img) => {
    if (img.id === reference.id) {
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
  event.stopPropagation()
  event.preventDefault()
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
  addPolygon(points, layerId, '矩形区域')
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
  polygonDraftPoints.value = [...polygonDraftPoints.value, point]
}

function finalizePolygonDraft() {
  if (polygonDraftPoints.value.length < 3) {
    polygonDraftPoints.value = []
    return
  }
  addPolygon(polygonDraftPoints.value, undefined, '规划区域')
  polygonDraftPoints.value = []
}

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
        selectedFeature.value = { type: 'polyline', id: line.id }
      }
    }
    lineDraft.value = null
    return
  }
  const newLine: PlanningPolyline = {
    id: createId('line'),
    name: `${getLayerName(draft.layerId)} 线段 ${lineCounter.value++}`,
    layerId: draft.layerId,
    points: clonePoints(draft.points),
  }
  polylines.value = [...polylines.value, newLine]
  selectedFeature.value = { type: 'polyline', id: newLine.id }
  lineDraft.value = null
}

function selectFeature(feature: SelectedFeature) {
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
    return
  }
  if (feature.type === 'polyline') {
    polylines.value = polylines.value.filter((item) => item.id !== feature.id)
    selectedFeature.value = null
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
    return
  }
  const removeIndex = Math.min(feature.segmentIndex + 1, line.points.length - 1)
  line.points.splice(removeIndex, 1)
  selectedFeature.value = null
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
  }
}

function handleLayerSelection(layerId: string) {
  activeLayerId.value = layerId
  if (currentTool.value === 'line' && !canUseLineTool.value) {
    currentTool.value = 'select'
  }
}

function handleEditorPointerDown(event: PointerEvent) {
  if (!dialogOpen.value || event.button !== 0) {
    return
  }
  event.preventDefault()
  frozenCanvasSize.value = { ...canvasSize.value }
  const world = screenToWorld(event)
  const hitImage = hitTestImage(world)

  if (currentTool.value === 'align-marker') {
    const targetImage = hitImage
      ?? (activeImageId.value ? planningImages.value.find((img) => img.id === activeImageId.value) : null)
    if (!targetImage) {
      return
    }
    activeImageId.value = targetImage.id
    setAlignMarkerAtWorld(targetImage, world)
    return
  }

  if (hitImage) {
    activeImageId.value = hitImage.id

    const groupStartPos =
      alignModeActive.value && hitImage.alignMarker
        ? Object.fromEntries(
          planningImages.value
            .filter((img) => img.alignMarker)
            .map((img) => [img.id, { x: img.position.x, y: img.position.y }]),
        )
        : undefined

    dragState.value = {
      type: 'move-image-layer',
      pointerId: event.pointerId,
      imageId: hitImage.id,
      startPos: { ...hitImage.position },
      anchor: world,
      groupStartPos,
    }
    event.currentTarget instanceof Element && event.currentTarget.setPointerCapture(event.pointerId)
    return
  }
  dragState.value = {
    type: 'pan',
    pointerId: event.pointerId,
    origin: { x: event.clientX, y: event.clientY },
    offset: { ...viewTransform.offset },
  }
  event.currentTarget instanceof Element && event.currentTarget.setPointerCapture(event.pointerId)
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
  }
}

function handlePointerMove(event: PointerEvent) {
  const state = dragState.value
  if (state.type === 'idle' || state.pointerId !== event.pointerId) {
    return
  }
  if (state.type === 'rectangle') {
    dragState.value = { ...state, current: screenToWorld(event) }
    return
  }
  if (state.type === 'pan') {
    const dx = (event.clientX - state.origin.x) / viewTransform.scale
    const dy = (event.clientY - state.origin.y) / viewTransform.scale
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
    if (state.type === 'rectangle') {
      finalizeRectangleDrag()
    }
    dragState.value = { type: 'idle' }
    // 释放冻结的舞台尺寸，让画布在操作结束后再统一更新。
    frozenCanvasSize.value = null
  }
  if (
    lineVertexClickState.value &&
    lineVertexClickState.value.pointerId === event.pointerId &&
    !lineVertexClickState.value.moved
  ) {
    startLineContinuation(lineVertexClickState.value.lineId, lineVertexClickState.value.vertexIndex)
  }
  lineVertexClickState.value = null
}

function handleWheel(event: WheelEvent) {
  if (!dialogOpen.value) {
    return
  }
  event.preventDefault()
  const rect = editorRect.value ?? editorRef.value?.getBoundingClientRect()
  if (!rect) {
    return
  }
  const delta = event.deltaY > 0 ? -0.1 : 0.1
  const previousScale = viewTransform.scale
  const nextScale = Math.min(8, Math.max(0.1, previousScale + delta * previousScale))
  if (nextScale === previousScale) {
    return
  }

  // 以鼠标指针为中心缩放：保持“指针下的世界坐标点”在缩放前后不变。
  const sx = event.clientX - rect.left
  const sy = event.clientY - rect.top
  const worldX = sx / previousScale - viewTransform.offset.x
  const worldY = sy / previousScale - viewTransform.offset.y

  viewTransform.scale = nextScale
  viewTransform.offset.x = sx / nextScale - worldX
  viewTransform.offset.y = sy / nextScale - worldY
}

function cancelActiveDrafts() {
  polygonDraftPoints.value = []
  lineDraft.value = null
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
}

function handlePolygonPointerDown(polygonId: string, event: PointerEvent) {
  event.stopPropagation()
  event.preventDefault()
  selectFeature({ type: 'polygon', id: polygonId })
  if (currentTool.value !== 'select') {
    return
  }
  dragState.value = {
    type: 'move-polygon',
    pointerId: event.pointerId,
    polygonId,
    anchor: screenToWorld(event),
    startPoints: clonePoints(polygons.value.find((item) => item.id === polygonId)?.points ?? []),
  }
  event.currentTarget instanceof Element && event.currentTarget.setPointerCapture(event.pointerId)
}

function handlePolygonVertexPointerDown(polygonId: string, vertexIndex: number, event: PointerEvent) {
  event.stopPropagation()
  event.preventDefault()
  selectFeature({ type: 'polygon', id: polygonId })
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
  event.stopPropagation()
  event.preventDefault()
  selectFeature({ type: 'polyline', id: lineId })
  if (currentTool.value !== 'select') {
    return
  }
  dragState.value = {
    type: 'move-polyline',
    pointerId: event.pointerId,
    lineId,
    anchor: screenToWorld(event),
    startPoints: clonePoints(polylines.value.find((item) => item.id === lineId)?.points ?? []),
  }
  event.currentTarget instanceof Element && event.currentTarget.setPointerCapture(event.pointerId)
}

function handleLineVertexPointerDown(lineId: string, vertexIndex: number, event: PointerEvent) {
  event.stopPropagation()
  event.preventDefault()
  selectFeature({ type: 'polyline', id: lineId })
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
  event.stopPropagation()
  event.preventDefault()
  const skipSplit = event.ctrlKey || event.metaKey
  const world = screenToWorld(event)
  splitSegmentAt(lineId, segmentIndex, world, skipSplit)
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
    movePlanningImageToEnd(reorderId)
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
    uploadError.value = '仅支持 PNG 或 JPG 格式的平面规划图。'
    return
  }
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.onload = () => {
    const newImage: PlanningImage = {
      id: createId('img'),
      name: file.name,
      url,
      sizeLabel: `${image.naturalWidth} x ${image.naturalHeight}`,
      width: image.naturalWidth,
      height: image.naturalHeight,
      visible: true,
      opacity: 1,
      position: { x: 0, y: 0 },
      scale: 1,
      scaleRatio: undefined,
    }
    planningImages.value.push(newImage)
    activeImageId.value = newImage.id

    nextTick(() => {
      fitViewToImage(newImage)
    })
  }
  image.onerror = () => {
    uploadError.value = '无法读取该图片，请重试或更换文件。'
    URL.revokeObjectURL(url)
  }
  image.src = url
}

function fitViewToImage(image: PlanningImage) {
  const container = editorRef.value
  if (!container) {
    return
  }
  const worldWidth = image.width * image.scale
  const worldHeight = image.height * image.scale
  const containerWidth = Math.max(container.clientWidth, 1)
  const containerHeight = Math.max(container.clientHeight, 1)
  const scale = Math.min(
    Math.max(Math.min(containerWidth / worldWidth, containerHeight / worldHeight), 0.2),
    1.4,
  )
  viewTransform.scale = scale
  viewTransform.offset.x = (containerWidth / scale - worldWidth) / 2 - image.position.x
  viewTransform.offset.y = (containerHeight / scale - worldHeight) / 2 - image.position.y
  updateEditorRect()
}

function handleResetView() {
  viewTransform.scale = 1
  viewTransform.offset = { x: 0, y: 0 }
}

function handleImageLayerToggle(imageId: string) {
  const image = planningImages.value.find((img) => img.id === imageId)
  if (image) {
    image.visible = !image.visible
  }
}

function handleImageLayerSelect(imageId: string) {
  activeImageId.value = imageId
}

function handleImageLayerOpacityChange(imageId: string, opacity: number) {
  const image = planningImages.value.find((img) => img.id === imageId)
  if (image) {
    image.opacity = opacity
  }
}

function handleImageLayerScaleRatioChange(imageId: string, scaleRatio: number | undefined) {
  const image = planningImages.value.find((img) => img.id === imageId)
  if (image) {
    image.scaleRatio = scaleRatio
  }
}

function handleImageLayerDelete(imageId: string) {
  planningImages.value = planningImages.value.filter((img) => img.id !== imageId)
  if (activeImageId.value === imageId) {
    activeImageId.value = planningImages.value[0]?.id ?? null
  }
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
    reorderPlanningImages(draggedId, targetImageId)
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
  event.stopPropagation()
  event.preventDefault()
  frozenCanvasSize.value = { ...canvasSize.value }
  activeImageId.value = imageId
  const image = planningImages.value.find((img) => img.id === imageId)
  if (!image) {
    return
  }
  const world = screenToWorld(event)
  if (currentTool.value === 'align-marker') {
    setAlignMarkerAtWorld(image, world)
    dragState.value = {
      type: 'move-align-marker',
      pointerId: event.pointerId,
      imageId,
    }
    event.currentTarget instanceof Element && event.currentTarget.setPointerCapture(event.pointerId)
    return
  }

  const groupStartPos =
    alignModeActive.value && image.alignMarker
      ? Object.fromEntries(
        planningImages.value
          .filter((img) => img.visible && img.alignMarker)
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

function handleImageLayerMove(imageId: string, direction: 'up' | 'down') {
  const index = planningImages.value.findIndex((img) => img.id === imageId)
  if (index === -1) {
    return
  }
  const targetIndex = direction === 'up' ? index + 1 : index - 1
  if (targetIndex < 0 || targetIndex >= planningImages.value.length) {
    return
  }
  const list = [...planningImages.value]
  const [item] = list.splice(index, 1)
  if (!item) {
    return
  }
  list.splice(targetIndex, 0, item)
  planningImages.value = list
}

function handleImageResizePointerDown(
  imageId: string,
  direction: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw',
  event: PointerEvent,
) {
  if (currentTool.value !== 'select' && currentTool.value !== 'pan') {
    return
  }
  event.stopPropagation()
  event.preventDefault()
  const image = planningImages.value.find((img) => img.id === imageId)
  if (!image) {
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

const toolbarButtons: Array<{ tool: PlanningTool; icon: string; label: string }> = [
  { tool: 'select', icon: 'mdi-cursor-default-outline', label: '选择' },
  { tool: 'pan', icon: 'mdi-hand-back-left', label: '平移' },
  { tool: 'rectangle', icon: 'mdi-rectangle-outline', label: '矩形选择' },
  { tool: 'lasso', icon: 'mdi-shape-polygon-plus', label: '自由选择' },
  { tool: 'line', icon: 'mdi-vector-line', label: '直线段' },
  { tool: 'align-marker', icon: 'mdi-crosshairs-gps', label: '对齐标记' },
]

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
void handleImageLayerMove

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
    transition="dialog-bottom-transition"
    scrim="rgba(6, 8, 12, 0.8)"
    width="98vw"
    max-width="1920"
    persistent
  >
    <v-card class="planning-dialog" elevation="12">
      <header class="planning-dialog__header">
        <div>
          <div class="title">规划图转换</div>
          <div class="subtitle">
            上传2D平面规划图，勾勒图层并生成可用于3D场景重建的数据结构。
          </div>
        </div>
        <div class="header-actions">
          <v-btn icon variant="text" density="comfortable" @click="handleResetView">
            <v-icon>mdi-crosshairs-gps</v-icon>
          </v-btn>
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
                <h3>规划图层</h3>
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
                <div class="image-layer-empty__text">拖拽规划图文件到此，或点击右侧上传</div>
              </v-list-item>
              <v-list-item
                v-for="image in planningImages"
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
                @dragstart="handleImageLayerItemDragStart(image.id, $event)"
                @dragover="handleImageLayerItemDragOver(image.id, $event)"
                @drop="handleImageLayerItemDrop(image.id, $event)"
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
                      <span class="control-label">透明度</span>
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
                      <span class="control-label">比例尺</span>
                      <v-text-field
                        :model-value="image.scaleRatio ?? ''"
                        type="number"
                        placeholder="1:1000"
                        density="compact"
                        variant="underlined"
                        hide-details
                        @update:model-value="(v) => handleImageLayerScaleRatioChange(image.id, v ? Number(v) : undefined)"
                      />
                    </div>
                  </div>
                </div>
              </v-list-item>
            </v-list>
          </section>
          <section class="layer-panel">
            <header>
              <h3>图层管理</h3>
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
                    <span>区域 {{ layerFeatureTotals.find((item) => item.id === layer.id)?.polygons ?? 0 }}</span>
                    <span>线段 {{ layerFeatureTotals.find((item) => item.id === layer.id)?.lines ?? 0 }}</span>
                  </div>
                </div>
                <template #append>
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
              <v-btn
                v-for="button in toolbarButtons"
                :key="button.tool"
                :color="currentTool === button.tool ? 'primary' : undefined"
                variant="tonal"
                density="comfortable"
                class="tool-button"
                :disabled="button.tool === 'line' && !canUseLineTool"
                @click="handleToolSelect(button.tool)"
              >
                <v-icon start>{{ button.icon }}</v-icon>
                {{ button.label }}
              </v-btn>

              <v-btn
                :color="alignModeActive ? 'primary' : undefined"
                variant="tonal"
                density="comfortable"
                class="tool-button"
                :disabled="!alignModeActive && !hasAlignMarkerCandidates"
                @click="toggleAlignMode"
              >
                <v-icon start>mdi-align-horizontal-center</v-icon>
                对齐规划图层
              </v-btn>
            </div>
          </div>

          <div
            ref="editorRef"
            class="editor-canvas"
            :style="editorBackgroundStyle"
            @pointerdown="handleEditorPointerDown"
            @dblclick="handleEditorDoubleClick"
            @wheel.prevent="handleWheel"
          >
            <div class="canvas-viewport">
              <div class="canvas-stage" :style="stageStyle">
                <div
                  v-for="(image, index) in planningImages"
                  :key="image.id"
                  :class="['planning-image', { active: activeImageId === image.id }]"
                  :style="getImageLayerStyle(image, index)"
                  @pointerdown.stop="handleImageLayerPointerDown(image.id, $event)"
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
                  @pointerdown="handleAlignMarkerPointerDown(image.id, $event)"
                />
              </div>
              <div v-if="!planningImages.length" class="canvas-empty">
                <v-icon size="32">mdi-image-off-outline</v-icon>
                <p>上传规划图后在此预览</p>
              </div>
            </div>
          </div>
        </main>

      </section>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.planning-dialog {
  width: 100%;
  min-height: 88vh;
  max-height: 96vh;
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
  display: none;
}

.planning-dialog__content {
  flex: 1;
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
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

.layer-panel {
  padding: 16px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.layer-panel header h3 {
  margin: 0;
  font-size: 1rem;
}

.layer-panel header span {
  font-size: 0.8rem;
  opacity: 0.6;
}

.layer-list {
  margin-top: 12px;
  background: transparent;
}

.layer-item {
  border-radius: 10px;
  margin-bottom: 8px;
  transition: background-color 0.2s ease;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.layer-item.active {
  border-color: rgba(255, 255, 255, 0.18);
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
  text-transform: none;
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
  filter: brightness(1.1);
}

.planning-image-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
  pointer-events: none;
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
  stroke-width: 2;
  fill-opacity: 0.32;
  cursor: pointer;
}

.planning-polygon.selected {
  stroke-width: 3;
}

.planning-line {
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
}

.planning-line.selected {
  stroke-width: 4;
}

.line-hit-area,
.segment-hit {
  cursor: pointer;
  pointer-events: stroke;
}

.planning-line.draft {
  stroke: rgba(255, 255, 255, 0.75);
  stroke-dasharray: 6 4;
}

.planning-polygon.draft {
  fill: rgba(255, 255, 255, 0.12);
  stroke: rgba(255, 255, 255, 0.8);
  stroke-dasharray: 6 4;
}

.vertex-handle {
  cursor: pointer;
  stroke: #04070d;
  stroke-width: 2;
}

.vertex-handle.line {
  r: 5;
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
