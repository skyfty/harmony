<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { generateUuid } from '@/utils/uuid'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>()
const dialogOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

type PlanningTool = 'select' | 'pan' | 'rectangle' | 'lasso' | 'line'
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
  name: string
  url: string
  sizeLabel: string
  width: number
  height: number
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
    type: 'drag-vertex'
    pointerId: number
    feature: 'polygon' | 'polyline'
    targetId: string
    vertexIndex: number
  }

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

const layers = ref<PlanningLayer[]>(layerPresets.map((layer) => ({ ...layer })))
const activeLayerId = ref(layers.value[0].id)
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
const planningImage = ref<PlanningImage | null>(null)
const uploadZoneActive = ref(false)
const uploadError = ref<string | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const editorRef = ref<HTMLDivElement | null>(null)
const editorRect = ref<DOMRect | null>(null)
const currentTool = ref<PlanningTool>('select')
const lineVertexClickState = ref<{ lineId: string; vertexIndex: number; pointerId: number; moved: boolean } | null>(null)

const activeLayer = computed(() => layers.value.find((layer) => layer.id === activeLayerId.value) ?? layers.value[0])
const canvasSize = computed(() => ({
  width: planningImage.value?.width ?? 2048,
  height: planningImage.value?.height ?? 2048,
}))
const canUseLineTool = computed(() => {
  const kind = activeLayer.value?.kind
  return kind === 'road' || kind === 'wall'
})

const selectionLayerId = computed<string | null>(() => {
  const feature = selectedFeature.value
  if (!feature) {
    return null
  }
  if (feature.type === 'polygon') {
    return polygons.value.find((item) => item.id === feature.id)?.layerId ?? null
  }
  if (feature.type === 'polyline') {
    return polylines.value.find((item) => item.id === feature.id)?.layerId ?? null
  }
  return polylines.value.find((item) => item.id === feature.lineId)?.layerId ?? null
})

const layerFeatureTotals = computed(() =>
  layers.value.map((layer) => {
    const polygonCount = polygons.value.filter((item) => item.layerId === layer.id).length
    const lineCount = polylines.value.filter((item) => item.layerId === layer.id).length
    return { id: layer.id, polygons: polygonCount, lines: lineCount }
  }),
)

const selectionSummary = computed(() => {
  const feature = selectedFeature.value
  if (!feature) {
    return null
  }
  if (feature.type === 'polygon') {
    const polygon = polygons.value.find((item) => item.id === feature.id)
    if (!polygon) {
      return null
    }
    return {
      layerName: getLayerName(polygon.layerId),
      vertices: polygon.points.length,
      type: '区域',
    }
  }
  if (feature.type === 'polyline') {
    const line = polylines.value.find((item) => item.id === feature.id)
    if (!line) {
      return null
    }
    return {
      layerName: getLayerName(line.layerId),
      vertices: line.points.length,
      type: '线段组',
    }
  }
  const line = polylines.value.find((item) => item.id === feature.lineId)
  if (!line) {
    return null
  }
  return {
    layerName: getLayerName(line.layerId),
    vertices: 2,
    type: '单线段',
  }
})

const editorBackgroundStyle = computed(() => {
  const image = planningImage.value?.url
  if (image) {
    return {
      backgroundImage: `url(${image})`,
      backgroundSize: 'contain',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center',
    }
  }
  return {
    backgroundImage:
      'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.04) 75%), linear-gradient(180deg, rgba(255,255,255,0.04) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.04) 75%)',
    backgroundSize: '48px 48px',
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

function startRectangleDrag(worldPoint: PlanningPoint, event: PointerEvent) {
  dragState.value = {
    type: 'rectangle',
    pointerId: event.pointerId,
    start: worldPoint,
    current: worldPoint,
    layerId: activeLayer.value?.id ?? layers.value[0].id,
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
  const targetLayerId = layerId ?? activeLayer.value?.id ?? layers.value[0].id
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
      layerId: activeLayer.value?.id ?? layers.value[0].id,
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

function assignSelectionToLayer(layerId?: string | null) {
  if (!layerId || !selectedFeature.value) {
    return
  }
  if (selectedFeature.value.type === 'polygon') {
    const polygon = polygons.value.find((item) => item.id === selectedFeature.value?.id)
    if (polygon) {
      polygon.layerId = layerId
    }
    return
  }
  if (selectedFeature.value.type === 'polyline') {
    const line = polylines.value.find((item) => item.id === selectedFeature.value?.id)
    if (line) {
      line.layerId = layerId
    }
    return
  }
  const line = polylines.value.find((item) => item.id === selectedFeature.value?.lineId)
  if (line) {
    line.layerId = layerId
  }
}

function applySelectedName() {
  const feature = selectedFeature.value
  if (!feature) {
    return
  }
  const trimmed = selectedName.value.trim()
  if (!trimmed.length) {
    return
  }
  if (feature.type === 'polygon') {
    const polygon = polygons.value.find((item) => item.id === feature.id)
    if (polygon) {
      polygon.name = trimmed
    }
    return
  }
  if (feature.type === 'polyline') {
    const line = polylines.value.find((item) => item.id === feature.id)
    if (line) {
      line.name = trimmed
    }
  }
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
  const world = screenToWorld(event)
  if (currentTool.value === 'rectangle') {
    startRectangleDrag(world, event)
    return
  }
  if (currentTool.value === 'lasso') {
    addPolygonDraftPoint(world)
    return
  }
  if (currentTool.value === 'line') {
    startLineDraft(world)
    return
  }
  if (currentTool.value === 'pan') {
    dragState.value = {
      type: 'pan',
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      offset: { ...viewTransform.offset },
    }
    event.currentTarget instanceof Element && event.currentTarget.setPointerCapture(event.pointerId)
    return
  }
  selectFeature(null)
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
    viewTransform.offset.x = state.offset.x + dx
    viewTransform.offset.y = state.offset.y + dy
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
  }
}

function handlePointerUp(event: PointerEvent) {
  const state = dragState.value
  if (state.type !== 'idle' && state.pointerId === event.pointerId) {
    if (state.type === 'rectangle') {
      finalizeRectangleDrag()
    }
    dragState.value = { type: 'idle' }
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
  const delta = event.deltaY > 0 ? -0.1 : 0.1
  const newScale = Math.min(8, Math.max(0.1, viewTransform.scale + delta * viewTransform.scale))
  const worldBefore = screenToWorld(event)
  const previousScale = viewTransform.scale
  viewTransform.scale = newScale
  const worldAfter = screenToWorld(event)
  viewTransform.offset.x += worldBefore.x - worldAfter.x
  viewTransform.offset.y += worldBefore.y - worldAfter.y
  if (previousScale !== newScale) {
    updateEditorRect()
  }
}

function cancelActiveDrafts() {
  polygonDraftPoints.value = []
  lineDraft.value = null
  dragState.value = { type: 'idle' }
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
    if (currentTool.value === 'line' && lineDraft.value?.points.length && lineDraft.value.points.length >= 2) {
      event.preventDefault()
      finalizeLineDraft()
    }
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
  currentTool.value = 'line'
  activeLayerId.value = line.layerId
  lineDraft.value = {
    layerId: line.layerId,
    points: [clonePoint(line.points[vertexIndex])],
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
  loadPlanningImage(input.files[0])
  input.value = ''
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  uploadZoneActive.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) {
    loadPlanningImage(file)
  }
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
  uploadZoneActive.value = true
}

function handleDragLeave(event: DragEvent) {
  event.preventDefault()
  uploadZoneActive.value = false
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
    planningImage.value = {
      name: file.name,
      url,
      sizeLabel: `${image.naturalWidth} x ${image.naturalHeight}`,
      width: image.naturalWidth,
      height: image.naturalHeight,
    }
    const containerWidth = editorRef.value?.clientWidth ?? 1
    const autoScale = containerWidth ? containerWidth / image.naturalWidth : 1
    viewTransform.scale = Math.min(1.4, Math.max(0.3, autoScale))
    viewTransform.offset = { x: 0, y: 0 }
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
    segments.push({ start: line.points[i], end: line.points[i + 1] })
  }
  return segments
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
]

onMounted(() => {
  window.addEventListener('pointermove', handlePointerMove, { passive: false })
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerUp)
  window.addEventListener('resize', updateEditorRect)
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
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
        <aside class="left-panel" @dragover.prevent="handleDragOver" @dragleave="handleDragLeave" @drop="handleDrop">
          <div
            class="upload-area"
            :class="{ active: uploadZoneActive }"
            role="button"
            tabindex="0"
            @click="handleUploadClick"
          >
            <v-icon size="36">mdi-cloud-upload-outline</v-icon>
            <p class="upload-title">上传规划底图</p>
            <p class="upload-hint">支持 PNG / JPG，可直接拖拽到此区域</p>
            <div v-if="planningImage" class="upload-meta">
              <v-chip size="small" color="primary" variant="tonal">
                {{ planningImage.name }} · {{ planningImage.sizeLabel }}
              </v-chip>
            </div>
            <div v-if="uploadError" class="upload-error">{{ uploadError }}</div>
            <input
              ref="fileInputRef"
              type="file"
              accept=".png,.jpg,.jpeg"
              class="sr-only"
              @change="handleFileChange"
            >
          </div>

          <section class="layer-panel">
            <header>
              <h3>图层管理</h3>
              <span>预置常用层，可控制可见性与编辑目标</span>
            </header>
            <v-list density="compact" class="layer-list">
              <v-list-item
                v-for="layer in layers"
                :key="layer.id"
                :class="['layer-item', { active: activeLayerId === layer.id }]"
                @click="handleLayerSelection(layer.id)"
              >
                <template #prepend>
                  <span class="layer-color" :style="{ backgroundColor: layer.color }" />
                </template>
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
            </div>
            <div class="tool-info">
              <span v-if="currentTool === 'lasso'">双击结束绘制，多边形将自动闭合。</span>
              <span v-else-if="currentTool === 'line' && !lineDraft">点击道路/墙体层的端点可继续延伸线段。</span>
              <span v-else-if="currentTool === 'rectangle'">按住并拖拽以创建矩形区域。</span>
              <span v-else-if="currentTool === 'pan'">拖拽以平移画布，滚轮可缩放。</span>
              <span v-else>点击空白区域取消选中；拖动已选中元素以微调。</span>
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
            <svg
              class="planning-svg"
              :viewBox="`0 0 ${canvasSize.width} ${canvasSize.height}`"
              preserveAspectRatio="xMidYMid meet"
            >
              <g :transform="`translate(${viewTransform.offset.x}, ${viewTransform.offset.y}) scale(${viewTransform.scale})`">
                <template v-for="polygon in polygons" :key="polygon.id">
                  <path
                    v-if="layers.find((layer) => layer.id === polygon.layerId)?.visible"
                    :d="getPolygonPath(polygon.points)"
                    class="planning-polygon"
                    :style="{
                      fill: getLayerColor(
                        polygon.layerId,
                        selectedFeature && selectedFeature.type === 'polygon' && selectedFeature.id === polygon.id ? 0.45 : 0.28,
                      ),
                      stroke: getLayerColor(polygon.layerId, 0.9),
                    }"
                    :class="{ selected: selectedFeature && selectedFeature.type === 'polygon' && selectedFeature.id === polygon.id }"
                    @pointerdown="handlePolygonPointerDown(polygon.id, $event)"
                  />
                  <circle
                    v-for="(point, index) in polygon.points"
                    v-if="selectedFeature && selectedFeature.type === 'polygon' && selectedFeature.id === polygon.id"
                    :key="`${polygon.id}-${index}`"
                    class="vertex-handle"
                    :cx="point.x"
                    :cy="point.y"
                    r="6"
                    :style="{ fill: getLayerColor(polygon.layerId, 0.95) }"
                    @pointerdown="handlePolygonVertexPointerDown(polygon.id, index, $event)"
                  />
                </template>

                <template v-for="line in polylines" :key="line.id">
                  <g v-if="layers.find((layer) => layer.id === line.layerId)?.visible">
                    <polyline
                      class="planning-line"
                      fill="none"
                      :points="line.points.map((point) => `${point.x},${point.y}`).join(' ')"
                      stroke-width="2"
                      :style="{ stroke: getLayerColor(line.layerId, 1) }"
                      :class="{
                        selected:
                          (selectedFeature && selectedFeature.type === 'polyline' && selectedFeature.id === line.id) ||
                          (selectedFeature && selectedFeature.type === 'segment' && selectedFeature.lineId === line.id),
                      }"
                    />
                    <polyline
                      class="line-hit-area"
                      fill="none"
                      :points="line.points.map((point) => `${point.x},${point.y}`).join(' ')"
                      stroke-width="18"
                      stroke="transparent"
                      @pointerdown="handlePolylinePointerDown(line.id, $event)"
                    />
                    <g v-for="(segment, segmentIndex) in getLineSegments(line)" :key="`${line.id}-${segmentIndex}`">
                      <line
                        class="segment-hit"
                        stroke-width="22"
                        stroke="transparent"
                        :x1="segment.start.x"
                        :y1="segment.start.y"
                        :x2="segment.end.x"
                        :y2="segment.end.y"
                        @pointerdown="handleLineSegmentPointerDown(line.id, segmentIndex, $event)"
                      />
                    </g>
                    <circle
                      v-for="(point, index) in line.points"
                      :key="`${line.id}-vertex-${index}`"
                      class="vertex-handle line"
                      :cx="point.x"
                      :cy="point.y"
                      r="6"
                      :style="{ fill: getLayerColor(line.layerId, 0.95) }"
                      @pointerdown="handleLineVertexPointerDown(line.id, index, $event)"
                    />
                  </g>
                </template>

                <path
                  v-if="polygonDraftPoints.length > 1"
                  class="planning-polygon draft"
                  :d="getPolygonPath(polygonDraftPoints)"
                />

                <polyline
                  v-if="lineDraft && lineDraft.points.length"
                  class="planning-line draft"
                  fill="none"
                  stroke-width="2"
                  :style="{ stroke: getLayerColor(lineDraft.layerId, 0.85) }"
                  :points="lineDraft.points.map((point) => `${point.x},${point.y}`).join(' ')"
                />

                <path
                  v-if="dragState.type === 'rectangle'"
                  class="planning-polygon draft"
                  :d="getPolygonPath(createRectanglePoints(dragState.start, dragState.current))"
                />
              </g>
            </svg>
          </div>
        </main>

        <aside class="right-panel">
          <section class="inspector">
            <header>
              <h3>元素属性</h3>
              <span>选中区域或线段后即可编辑属性</span>
            </header>
            <div v-if="!selectedFeature" class="inspector-empty">
              <v-icon size="42">mdi-select-search</v-icon>
              <p>暂无选中元素</p>
              <small>选择区域或线段以查看详细信息</small>
            </div>
            <div v-else class="inspector-body">
              <v-text-field
                v-model="selectedName"
                label="名称"
                variant="outlined"
                density="comfortable"
                hide-details
                @blur="applySelectedName"
                @keydown.enter.prevent="applySelectedName"
              />
              <v-select
                :model-value="selectionLayerId ?? undefined"
                :items="layers.map((layer) => ({ title: layer.name, value: layer.id }))"
                label="所属图层"
                density="comfortable"
                variant="outlined"
                hide-details
                @update:model-value="assignSelectionToLayer"
              />
              <div class="inspector-summary" v-if="selectionSummary">
                <div>类型：{{ selectionSummary.type }}</div>
                <div>图层：{{ selectionSummary.layerName }}</div>
                <div>节点数：{{ selectionSummary.vertices }}</div>
              </div>
              <div class="inspector-actions">
                <v-btn
                  color="primary"
                  variant="tonal"
                  prepend-icon="mdi-vector-arrange-below"
                  @click="assignSelectionToLayer(activeLayerId)"
                >
                  关联到当前图层
                </v-btn>
                <v-btn
                  color="error"
                  variant="text"
                  prepend-icon="mdi-delete-outline"
                  @click="deleteSelectedFeature"
                >
                  删除
                </v-btn>
              </div>
              <v-alert
                v-if="selectedFeature && selectedFeature.type === 'segment'"
                type="info"
                variant="tonal"
                density="comfortable"
              >
                点击线段中部可直接分割，删除后将自动连接相邻段落。
              </v-alert>
            </div>
          </section>

        </aside>
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
  background: rgba(10, 12, 18, 0.94);
  color: #f4f6fb;
}

.planning-dialog__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 24px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.planning-dialog__header .title {
  font-size: 1.25rem;
  font-weight: 600;
}

.planning-dialog__header .subtitle {
  font-size: 0.9rem;
  opacity: 0.75;
}

.header-actions {
  display: flex;
  gap: 4px;
}

.planning-dialog__content {
  flex: 1;
  display: grid;
  grid-template-columns: 320px 1fr 360px;
  gap: 12px;
  padding: 20px 28px 28px;
  overflow: hidden;
}

.left-panel,
.right-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
}

.upload-area {
  border: 1px dashed rgba(255, 255, 255, 0.2);
  border-radius: 14px;
  padding: 20px;
  text-align: center;
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.upload-area.active {
  border-color: rgba(98, 179, 255, 0.8);
  background: rgba(33, 150, 243, 0.08);
}

.upload-title {
  margin: 12px 0 4px;
  font-weight: 600;
}

.upload-hint {
  font-size: 0.85rem;
  opacity: 0.6;
}

.upload-meta {
  margin-top: 12px;
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
  transition: background-color 0.2s ease;
}

.layer-item.active {
  background: rgba(100, 181, 246, 0.18);
}

.layer-color {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  display: inline-block;
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

.editor-panel {
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  background: rgba(8, 10, 16, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.05);
  min-height: 0;
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
  border-radius: 0 0 16px 16px;
  overflow: hidden;
  position: relative;
  background-color: rgba(16, 19, 28, 0.85);
  border-top: 1px solid rgba(255, 255, 255, 0.03);
}

.planning-svg {
  width: 100%;
  height: 100%;
  cursor: crosshair;
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

.right-panel section {
  border-radius: 14px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.inspector header h3,
.guide header h3 {
  margin: 0;
  font-size: 1rem;
}

.inspector header span {
  font-size: 0.8rem;
  opacity: 0.65;
}

.inspector-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 0;
  opacity: 0.7;
}

.inspector-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
}

.inspector-summary {
  font-size: 0.85rem;
  opacity: 0.85;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.inspector-actions {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.guide ul {
  list-style: disc;
  margin: 12px 0 0 18px;
  padding: 0;
  font-size: 0.85rem;
  opacity: 0.78;
  display: flex;
  flex-direction: column;
  gap: 8px;
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
