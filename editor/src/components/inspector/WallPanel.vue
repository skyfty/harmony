<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { SceneNodeComponentState } from '@schema'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'
import AssetPickerDialog from '@/components/common/AssetPickerDialog.vue'
import type { ProjectAsset } from '@/types/project-asset'
import { buildWallPresetFilename, isWallPresetFilename } from '@/utils/wallPreset'

import {
  WALL_COMPONENT_TYPE,
  WALL_DEFAULT_HEIGHT,
  WALL_DEFAULT_THICKNESS,
  WALL_DEFAULT_WIDTH,
  WALL_DEFAULT_SMOOTHING,
  WALL_MIN_HEIGHT,
  WALL_MIN_THICKNESS,
  WALL_MIN_WIDTH,
  type WallForwardAxis,
  type WallModelOrientation,
  type WallUvAxis,
  type WallRenderMode,
  type WallComponentProps,
} from '@schema/components'
import { getCachedModelObject } from '@schema/modelObjectCache'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId, draggingAssetId } = storeToRefs(sceneStore)

const localHeight = ref<number>(WALL_DEFAULT_HEIGHT)
const localWidth = ref<number>(WALL_DEFAULT_WIDTH)
const localThickness = ref<number>(WALL_DEFAULT_THICKNESS)
const localSmoothing = ref<number>(WALL_DEFAULT_SMOOTHING)
const localIsAirWall = ref<boolean>(false)

const jointTrimFeedbackMessage = ref<string | null>(null)

const isSyncingFromScene = ref(false)
const isApplyingDimensions = ref(false)

const assetDialogVisible = ref(false)
const assetDialogSelectedId = ref('')
const assetDialogAnchor = ref<{ x: number; y: number } | null>(null)
type WallAssetDialogTarget = 'body' | 'head' | 'foot' | 'bodyCap' | 'headCap' | 'footCap' | 'cornerBody' | 'cornerHead' | 'cornerFoot'
const assetDialogTarget = ref<WallAssetDialogTarget | null>(null)
const assetDialogCornerIndex = ref<number | null>(null)
const assetDialogTitle = computed(() => {
  if (assetDialogTarget.value === 'body') return 'Select Wall Body Asset'
  if (assetDialogTarget.value === 'head') return 'Select Wall Head Asset'
  if (assetDialogTarget.value === 'foot') return 'Select Wall Foot Asset'
  if (assetDialogTarget.value === 'bodyCap') return 'Select Wall End Cap (Body) Asset'
  if (assetDialogTarget.value === 'headCap') return 'Select Wall End Cap (Head) Asset'
  if (assetDialogTarget.value === 'footCap') return 'Select Wall End Cap (Foot) Asset'
  if (assetDialogTarget.value === 'cornerBody') return 'Select Wall Corner Model (Body)'
  if (assetDialogTarget.value === 'cornerHead') return 'Select Wall Corner Model (Head)'
  if (assetDialogTarget.value === 'cornerFoot') return 'Select Wall Corner Model (Foot)'
  return 'Select Wall Asset'
})

const wallComponent = computed(
  () => selectedNode.value?.components?.[WALL_COMPONENT_TYPE] as SceneNodeComponentState<WallComponentProps> | undefined,
)

const panelDropAreaRef = ref<HTMLElement | null>(null)
const wallPresetDropActive = ref(false)
const wallPresetFeedbackMessage = ref<string | null>(null)

const savePresetDialogVisible = ref(false)
const savePresetName = ref('')
const overwriteConfirmDialogVisible = ref(false)
const overwriteTargetAssetId = ref<string | null>(null)
const overwriteTargetFilename = ref<string | null>(null)


const bodyDropAreaRef = ref<HTMLElement | null>(null)
const capDropAreaRef = ref<HTMLElement | null>(null)
const headDropAreaRef = ref<HTMLElement | null>(null)
const footDropAreaRef = ref<HTMLElement | null>(null)
const headCapDropAreaRef = ref<HTMLElement | null>(null)
const footCapDropAreaRef = ref<HTMLElement | null>(null)
const bodyDropActive = ref(false)
const capDropActive = ref(false)
const headDropActive = ref(false)
const footDropActive = ref(false)
const headCapDropActive = ref(false)
const footCapDropActive = ref(false)
const bodyDropProcessing = ref(false)
const capDropProcessing = ref(false)
const headDropProcessing = ref(false)
const footDropProcessing = ref(false)
const headCapDropProcessing = ref(false)
const footCapDropProcessing = ref(false)
const bodyFeedbackMessage = ref<string | null>(null)
const capFeedbackMessage = ref<string | null>(null)
const headFeedbackMessage = ref<string | null>(null)
const footFeedbackMessage = ref<string | null>(null)
const headCapFeedbackMessage = ref<string | null>(null)
const footCapFeedbackMessage = ref<string | null>(null)

const bodyAsset = computed(() => {
  const assetId = wallComponent.value?.props?.bodyAssetId
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

const headAsset = computed(() => {
  const assetId = wallComponent.value?.props?.headAssetId
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

const footAsset = computed(() => {
  const assetId = wallComponent.value?.props?.footAssetId
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

const bodyCapAsset = computed(() => {
  const assetId = wallComponent.value?.props?.bodyEndCapAssetId
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

const headCapAsset = computed(() => {
  const assetId = wallComponent.value?.props?.headEndCapAssetId
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

const footCapAsset = computed(() => {
  const assetId = wallComponent.value?.props?.footEndCapAssetId
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

type WallCornerModelRow = NonNullable<WallComponentProps['cornerModels']>[number]

const FORWARD_AXIS_ITEMS: Array<{ title: string; value: WallForwardAxis }> = [
  { title: '+Z', value: '+z' },
  { title: '-Z', value: '-z' },
  { title: '+X', value: '+x' },
  { title: '-X', value: '-x' },
]

const UV_AXIS_ITEMS: Array<{ title: string; value: WallUvAxis }> = [
  { title: 'Auto', value: 'auto' },
  { title: 'U', value: 'u' },
  { title: 'V', value: 'v' },
]

const WALL_RENDER_MODE_ITEMS: Array<{ title: string; value: WallRenderMode }> = [
  { title: 'Stretch', value: 'stretch' },
  { title: 'Repeat Instances', value: 'repeatInstances' },
]

const cornerModels = computed<WallCornerModelRow[]>(() => {
  const raw = wallComponent.value?.props?.cornerModels
  return Array.isArray(raw) ? (raw as WallCornerModelRow[]) : []
})

function clampAngleDegrees(value: unknown, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) {
    return fallback
  }
  return Math.max(0, Math.min(180, num))
}

function clampTolerance(value: unknown, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) {
    return fallback
  }
  return Math.max(0, Math.min(90, num))
}

function normalizeForwardAxis(value: unknown, fallback: WallForwardAxis): WallForwardAxis {
  if (value === '+z' || value === '-z' || value === '+x' || value === '-x') {
    return value
  }
  return fallback
}

function clampYawDeg(value: unknown, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) {
    return fallback
  }
  return Math.max(-180, Math.min(180, num))
}

function normalizeOrientation(value: unknown, fallback: WallModelOrientation): WallModelOrientation {
  if (!value || typeof value !== 'object') {
    return fallback
  }
  const record = value as Record<string, unknown>
  return {
    forwardAxis: normalizeForwardAxis(record.forwardAxis, fallback.forwardAxis),
    yawDeg: clampYawDeg(record.yawDeg, fallback.yawDeg),
  }
}

function updateWallOrientation(
  key: 'bodyOrientation' | 'headOrientation' | 'footOrientation' | 'bodyEndCapOrientation' | 'headEndCapOrientation' | 'footEndCapOrientation',
  patch: Partial<WallModelOrientation>,
): void {
  const nodeId = selectedNodeId.value
  const component = wallComponent.value
  if (!nodeId || !component) {
    return
  }
  const current = (component.props as any)?.[key] as WallModelOrientation | undefined
  const next = normalizeOrientation({ ...(current ?? {}), ...patch }, { forwardAxis: '+z', yawDeg: 0 })
  sceneStore.updateNodeComponentProps(nodeId, component.id, { [key]: next } as any)
}

function updateWallUvAxis(
  key: 'bodyUvAxis' | 'headUvAxis' | 'footUvAxis',
  value: unknown,
): void {
  const nodeId = selectedNodeId.value
  const component = wallComponent.value
  if (!nodeId || !component) {
    return
  }
  const next: WallUvAxis = value === 'u' || value === 'v' ? value : 'auto'
  sceneStore.updateNodeComponentProps(nodeId, component.id, { [key]: next } as any)
}

function normalizeCornerModelRow(row: Partial<WallCornerModelRow> | null | undefined): WallCornerModelRow {
  const bodyAssetId = typeof (row as any)?.bodyAssetId === 'string' && (row as any).bodyAssetId.trim().length
    ? (row as any).bodyAssetId
    : null
  const headAssetId = typeof (row as any)?.headAssetId === 'string' && (row as any).headAssetId.trim().length
    ? (row as any).headAssetId
    : null
  const footAssetId = typeof (row as any)?.footAssetId === 'string' && (row as any).footAssetId.trim().length
    ? (row as any).footAssetId
    : null
  const angle = clampAngleDegrees((row as any)?.angle, 90)
  const tolerance = clampTolerance((row as any)?.tolerance, 5)

  const bodyForwardAxis = normalizeForwardAxis((row as any)?.bodyForwardAxis, '+z')
  const bodyYawDeg = clampYawDeg((row as any)?.bodyYawDeg, 0)
  const headForwardAxis = normalizeForwardAxis((row as any)?.headForwardAxis, '+z')
  const headYawDeg = clampYawDeg((row as any)?.headYawDeg, 0)
  const footForwardAxis = normalizeForwardAxis((row as any)?.footForwardAxis, '+z')
  const footYawDeg = clampYawDeg((row as any)?.footYawDeg, 0)

  const normalizeOffsetLocal = (value: unknown): { x: number; y: number; z: number } => {
    const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
    const read = (key: 'x' | 'y' | 'z'): number => {
      const raw = record ? record[key] : 0
      const num = typeof raw === 'number' ? raw : Number(raw)
      return Number.isFinite(num) ? num : 0
    }
    return { x: read('x'), y: read('y'), z: read('z') }
  }

  const bodyOffsetLocal = normalizeOffsetLocal((row as any)?.bodyOffsetLocal)
  const headOffsetLocal = normalizeOffsetLocal((row as any)?.headOffsetLocal)
  const footOffsetLocal = normalizeOffsetLocal((row as any)?.footOffsetLocal)
  const rawJointTrim = (row as any)?.jointTrim
  const trimStart = Number(rawJointTrim?.start)
  const trimEnd = Number(rawJointTrim?.end)
  const jointTrim = {
    start: Number.isFinite(trimStart) ? Math.max(0, trimStart) : 0,
    end: Number.isFinite(trimEnd) ? Math.max(0, trimEnd) : 0,
  }

  return {
    bodyAssetId,
    headAssetId,
    footAssetId,
    bodyOffsetLocal,
    headOffsetLocal,
    footOffsetLocal,
    bodyForwardAxis,
    bodyYawDeg,
    headForwardAxis,
    headYawDeg,
    footForwardAxis,
    footYawDeg,
    angle,
    tolerance,
    jointTrim,
  } as WallCornerModelRow
}

function commitCornerModels(next: WallCornerModelRow[]): void {
  const nodeId = selectedNodeId.value
  const component = wallComponent.value
  if (!nodeId || !component) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { cornerModels: next } as any)
}

function addCornerModel(): void {
  // Corner model rules use interior angle semantics (straight = 180°).
  const next = [...cornerModels.value, normalizeCornerModelRow({
    bodyAssetId: null,
    headAssetId: null,
    footAssetId: null,
    bodyOffsetLocal: { x: 0, y: 0, z: 0 },
    headOffsetLocal: { x: 0, y: 0, z: 0 },
    footOffsetLocal: { x: 0, y: 0, z: 0 },
    bodyForwardAxis: '+z',
    bodyYawDeg: 0,
    headForwardAxis: '+z',
    headYawDeg: 0,
    footForwardAxis: '+z',
    footYawDeg: 0,
    angle: 90,
    tolerance: 5,
    jointTrim: { start: 0, end: 0 },
  } as any)]
  commitCornerModels(next)
}

function removeCornerModel(index: number): void {
  const next = cornerModels.value.filter((_entry, i) => i !== index)
  commitCornerModels(next)
}

function updateCornerModel(index: number, patch: Partial<WallCornerModelRow>): void {
  const current = cornerModels.value[index]
  const next = cornerModels.value.map((entry, i) => {
    if (i !== index) {
      return entry
    }
    return normalizeCornerModelRow({ ...current, ...patch })
  })
  commitCornerModels(next)
}

function resolveCornerModelAsset(assetId: string | null | undefined): ProjectAsset | null {
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
}

watch(
  () => wallComponent.value?.props,
  (props) => {
    if (!props) {
      return
    }
    isSyncingFromScene.value = true
      localHeight.value = Number(((props.height ?? WALL_DEFAULT_HEIGHT)).toFixed(1))
    localWidth.value = props.width ?? WALL_DEFAULT_WIDTH
    localThickness.value = props.thickness ?? WALL_DEFAULT_THICKNESS
    localIsAirWall.value = Boolean((props as any).isAirWall)
    localSmoothing.value = Number.isFinite(props.smoothing)
      ? Math.min(1, Math.max(0, props.smoothing))
      : WALL_DEFAULT_SMOOTHING
    nextTick(() => {
      isSyncingFromScene.value = false
    })
  },
  { immediate: true, deep: true },
)

function computeCachedAssetHorizontalRadius(assetId: string): number | null {
  const cached = getCachedModelObject(assetId)
  if (!cached) {
    return null
  }
  const bbox = (cached as any).boundingBox
  const min = bbox?.min
  const max = bbox?.max
  if (!min || !max) {
    return null
  }
  const maxAbsX = Math.max(Math.abs(Number(min.x)), Math.abs(Number(max.x)))
  const maxAbsZ = Math.max(Math.abs(Number(min.z)), Math.abs(Number(max.z)))
  if (!Number.isFinite(maxAbsX) || !Number.isFinite(maxAbsZ)) {
    return null
  }
  const radius = Math.sqrt(maxAbsX * maxAbsX + maxAbsZ * maxAbsZ)
  if (!Number.isFinite(radius) || radius <= 0) {
    return null
  }
  return radius
}

function recommendJointTrimForCorner(index: number): void {
  const component = wallComponent.value
  if (!component) {
    return
  }
  jointTrimFeedbackMessage.value = null

  const target = cornerModels.value[index]
  if (!target) {
    return
  }

  const cornerAssetIds = new Set<string>()
  const bodyId = (target as any)?.bodyAssetId
  const headId = (target as any)?.headAssetId
  const footId = (target as any)?.footAssetId
  if (typeof bodyId === 'string' && bodyId.trim().length) {
    cornerAssetIds.add(bodyId.trim())
  }
  if (typeof headId === 'string' && headId.trim().length) {
    cornerAssetIds.add(headId.trim())
  }
  if (typeof footId === 'string' && footId.trim().length) {
    cornerAssetIds.add(footId.trim())
  }

  if (cornerAssetIds.size === 0) {
    jointTrimFeedbackMessage.value = `Corner #${index + 1}: no model asset configured; nothing to recommend.`
    return
  }

  let maxRadius = 0
  let cachedCount = 0
  for (const assetId of cornerAssetIds) {
    const radius = computeCachedAssetHorizontalRadius(assetId)
    if (radius != null) {
      cachedCount += 1
      maxRadius = Math.max(maxRadius, radius)
    }
  }

  const thickness = Number((component.props as any)?.thickness)
  const width = Number((component.props as any)?.width)
  const fallback = Math.max(
    0,
    Math.min(2, Math.max(
      Number.isFinite(thickness) ? thickness : WALL_DEFAULT_THICKNESS,
      Number.isFinite(width) ? width : WALL_DEFAULT_WIDTH,
    ) * 0.5),
  )

  let recommended = maxRadius > 0 ? maxRadius : fallback
  recommended = Math.max(0, Math.min(5, recommended))
  recommended = Math.round(recommended * 100) / 100

  updateCornerModel(index, { jointTrim: { start: recommended, end: recommended } } as any)

  jointTrimFeedbackMessage.value = cachedCount > 0
    ? `Corner #${index + 1}: recommended from ${cachedCount} cached model(s).`
    : `Corner #${index + 1}: models not loaded; used a conservative fallback.`
}

watch(selectedNode, () => {
  bodyDropActive.value = false
  capDropActive.value = false
  headDropActive.value = false
  footDropActive.value = false
  headCapDropActive.value = false
  footCapDropActive.value = false
  wallPresetDropActive.value = false
  bodyDropProcessing.value = false
  capDropProcessing.value = false
  headDropProcessing.value = false
  footDropProcessing.value = false
  headCapDropProcessing.value = false
  footCapDropProcessing.value = false
  wallPresetFeedbackMessage.value = null
  jointTrimFeedbackMessage.value = null
  bodyFeedbackMessage.value = null
  capFeedbackMessage.value = null
  headFeedbackMessage.value = null
  footFeedbackMessage.value = null
  headCapFeedbackMessage.value = null
  footCapFeedbackMessage.value = null
})

watch(assetDialogVisible, (open) => {
  if (open) {
    return
  }
  assetDialogAnchor.value = null
  assetDialogSelectedId.value = ''
  assetDialogTarget.value = null
  assetDialogCornerIndex.value = null
})

const smoothingDisplay = computed(() => `${Math.round(localSmoothing.value * 100)}%`)

function serializeAssetDragPayload(raw: string | null): string | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as { assetId?: string }
    if (parsed?.assetId) {
      return parsed.assetId
    }
  } catch (error) {
    console.warn('Unable to parse asset drag payload', error)
  }
  return null
}

function resolveDragAssetId(event: DragEvent): string | null {
  if (event.dataTransfer) {
    const payload = serializeAssetDragPayload(event.dataTransfer.getData(ASSET_DRAG_MIME))
    if (payload) {
      return payload
    }
  }
  return draggingAssetId.value ?? null
}

function shouldDeactivateDropArea(target: HTMLElement | null, event: DragEvent): boolean {
  const related = event.relatedTarget as Node | null
  if (!target || (related && target.contains(related))) {
    return false
  }
  return true
}

function validateWallAssetId(assetId: string): string | null {
  const asset = sceneStore.getAsset(assetId)
  if (!asset || (asset.type !== 'model' && asset.type !== 'mesh')) {
    return 'Only model assets can be assigned here.'
  }
  return null
}

function isWallPresetAsset(asset: ProjectAsset | null): boolean {
  if (!asset) {
    return false
  }
  return isWallPresetFilename(asset.description ?? asset.name ?? null)
}

function resolveWallPresetAssetId(event: DragEvent): string | null {
  const assetId = resolveDragAssetId(event)
  if (!assetId) {
    return null
  }
  const asset = sceneStore.getAsset(assetId)
  if (!isWallPresetAsset(asset)) {
    return null
  }
  return assetId
}

function handleWallPresetDragEnterCapture(event: DragEvent): void {
  const presetId = resolveWallPresetAssetId(event)
  if (!presetId) {
    return
  }
  wallPresetDropActive.value = true
  wallPresetFeedbackMessage.value = null
  event.preventDefault()
  event.stopPropagation()
}

function handleWallPresetDragOverCapture(event: DragEvent): void {
  const presetId = resolveWallPresetAssetId(event)
  if (!presetId) {
    return
  }
  wallPresetDropActive.value = true
  wallPresetFeedbackMessage.value = null
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  event.preventDefault()
  event.stopPropagation()
}

function handleWallPresetDragLeaveCapture(event: DragEvent): void {
  if (shouldDeactivateDropArea(panelDropAreaRef.value, event)) {
    wallPresetDropActive.value = false
  }
}

async function handleWallPresetDropCapture(event: DragEvent): Promise<void> {
  const presetId = resolveWallPresetAssetId(event)
  if (!presetId) {
    return
  }

  wallPresetDropActive.value = false
  wallPresetFeedbackMessage.value = null
  event.preventDefault()
  event.stopPropagation()

  try {
    await sceneStore.applyWallPresetToSelectedWall(presetId)
  } catch (error) {
    console.error('Failed to apply wall preset', error)
    wallPresetFeedbackMessage.value = (error as Error).message ?? 'Failed to apply wall preset.'
  }
}

function openSaveWallPresetDialog(): void {
  if (!wallComponent.value) {
    return
  }
  wallPresetFeedbackMessage.value = null
  overwriteConfirmDialogVisible.value = false
  overwriteTargetAssetId.value = null
  overwriteTargetFilename.value = null
  savePresetName.value = (selectedNode.value?.name?.trim() ? selectedNode.value!.name!.trim() : 'Wall Preset')
  savePresetDialogVisible.value = true
}

async function confirmSaveWallPreset(): Promise<void> {
  const name = savePresetName.value?.trim() ?? ''
  const filename = buildWallPresetFilename(name)
  const existing = sceneStore.findWallPresetAssetByFilename(filename)
  if (existing) {
    overwriteTargetAssetId.value = existing.id
    overwriteTargetFilename.value = filename
    overwriteConfirmDialogVisible.value = true
    return
  }
  await performSaveWallPreset(null)
}

async function performSaveWallPreset(overwriteAssetId: string | null): Promise<void> {
  const name = savePresetName.value?.trim() ?? ''
  try {
    await sceneStore.saveWallPreset({
      name,
      nodeId: selectedNodeId.value ?? null,
      assetId: overwriteAssetId,
      select: true,
    })
    savePresetDialogVisible.value = false
    overwriteConfirmDialogVisible.value = false
    overwriteTargetAssetId.value = null
    overwriteTargetFilename.value = null
  } catch (error) {
    console.error('Failed to save wall preset', error)
    wallPresetFeedbackMessage.value = (error as Error).message ?? 'Failed to save wall preset.'
  }
}

function cancelOverwriteWallPreset(): void {
  overwriteConfirmDialogVisible.value = false
  overwriteTargetAssetId.value = null
  overwriteTargetFilename.value = null
}

function openWallAssetDialog(target: WallAssetDialogTarget, event?: MouseEvent): void {
  assetDialogTarget.value = target
  assetDialogSelectedId.value = (() => {
    if (target === 'body') return wallComponent.value?.props?.bodyAssetId ?? ''
    if (target === 'head') return wallComponent.value?.props?.headAssetId ?? ''
    if (target === 'foot') return wallComponent.value?.props?.footAssetId ?? ''
    if (target === 'bodyCap') return wallComponent.value?.props?.bodyEndCapAssetId ?? ''
    if (target === 'headCap') return wallComponent.value?.props?.headEndCapAssetId ?? ''
    if (target === 'footCap') return wallComponent.value?.props?.footEndCapAssetId ?? ''
    return ''
  })()
  assetDialogAnchor.value = event ? { x: event.clientX, y: event.clientY } : null
  assetDialogVisible.value = true
}

function openWallCornerModelDialog(index: number, mode: 'body' | 'head' | 'foot', event?: MouseEvent): void {
  assetDialogTarget.value = mode === 'body' ? 'cornerBody' : mode === 'head' ? 'cornerHead' : 'cornerFoot'
  assetDialogCornerIndex.value = index
  assetDialogSelectedId.value = mode === 'body'
    ? (cornerModels.value[index] as any)?.bodyAssetId ?? ''
    : mode === 'head'
      ? (cornerModels.value[index] as any)?.headAssetId ?? ''
      : (cornerModels.value[index] as any)?.footAssetId ?? ''
  assetDialogAnchor.value = event ? { x: event.clientX, y: event.clientY } : null
  assetDialogVisible.value = true
}

function handleWallAssetDialogUpdate(asset: ProjectAsset | null): void {
  const nodeId = selectedNodeId.value
  const component = wallComponent.value
  const target = assetDialogTarget.value
  if (!nodeId || !component || !target) {
    assetDialogVisible.value = false
    return
  }
  if (!asset) {
    if (target === 'body') {
      bodyFeedbackMessage.value = null
      sceneStore.updateNodeComponentProps(nodeId, component.id, { bodyAssetId: null })
    } else if (target === 'head') {
      headFeedbackMessage.value = null
      sceneStore.updateNodeComponentProps(nodeId, component.id, { headAssetId: null } as any)
    } else if (target === 'foot') {
      footFeedbackMessage.value = null
      sceneStore.updateNodeComponentProps(nodeId, component.id, { footAssetId: null } as any)
    } else if (target === 'bodyCap') {
      capFeedbackMessage.value = null
      sceneStore.updateNodeComponentProps(nodeId, component.id, { bodyEndCapAssetId: null } as any)
    } else if (target === 'headCap') {
      headCapFeedbackMessage.value = null
      sceneStore.updateNodeComponentProps(nodeId, component.id, { headEndCapAssetId: null } as any)
    } else if (target === 'footCap') {
      footCapFeedbackMessage.value = null
      sceneStore.updateNodeComponentProps(nodeId, component.id, { footEndCapAssetId: null } as any)
    } else {
      const index = assetDialogCornerIndex.value
      if (typeof index === 'number' && index >= 0) {
        if (target === 'cornerBody') {
          updateCornerModel(index, { bodyAssetId: null } as any)
        } else if (target === 'cornerHead') {
          updateCornerModel(index, { headAssetId: null } as any)
        } else {
          updateCornerModel(index, { footAssetId: null } as any)
        }
      }
    }
    assetDialogVisible.value = false
    return
  }
  if (asset.type !== 'model' && asset.type !== 'mesh') {
    console.warn('Selected asset is not a model/mesh')
    return
  }

  if (target === 'body') {
    bodyFeedbackMessage.value = null
    sceneStore.updateNodeComponentProps(nodeId, component.id, { bodyAssetId: asset.id })
  } else if (target === 'head') {
    headFeedbackMessage.value = null
    sceneStore.updateNodeComponentProps(nodeId, component.id, { headAssetId: asset.id } as any)
  } else if (target === 'foot') {
    footFeedbackMessage.value = null
    sceneStore.updateNodeComponentProps(nodeId, component.id, { footAssetId: asset.id } as any)
  } else if (target === 'bodyCap') {
    capFeedbackMessage.value = null
    sceneStore.updateNodeComponentProps(nodeId, component.id, { bodyEndCapAssetId: asset.id } as any)
  } else if (target === 'headCap') {
    headCapFeedbackMessage.value = null
    sceneStore.updateNodeComponentProps(nodeId, component.id, { headEndCapAssetId: asset.id } as any)
  } else if (target === 'footCap') {
    footCapFeedbackMessage.value = null
    sceneStore.updateNodeComponentProps(nodeId, component.id, { footEndCapAssetId: asset.id } as any)
  } else {
    const index = assetDialogCornerIndex.value
    if (typeof index === 'number' && index >= 0) {
      if (target === 'cornerBody') {
        updateCornerModel(index, { bodyAssetId: asset.id } as any)
      } else if (target === 'cornerHead') {
        updateCornerModel(index, { headAssetId: asset.id } as any)
      } else {
        updateCornerModel(index, { footAssetId: asset.id } as any)
      }
    }
  }
  assetDialogVisible.value = false
}

function handleWallAssetDialogCancel(): void {
  assetDialogVisible.value = false
}

async function assignWallAsset(event: DragEvent, target: 'body' | 'head' | 'foot' | 'bodyCap' | 'headCap' | 'footCap') {
  event.preventDefault()

  if (target === 'body') {
    bodyDropActive.value = false
    bodyFeedbackMessage.value = null
  } else if (target === 'head') {
    headDropActive.value = false
    headFeedbackMessage.value = null
  } else if (target === 'foot') {
    footDropActive.value = false
    footFeedbackMessage.value = null
  } else if (target === 'bodyCap') {
    capDropActive.value = false
    capFeedbackMessage.value = null
  } else if (target === 'headCap') {
    headCapDropActive.value = false
    headCapFeedbackMessage.value = null
  } else {
    footCapDropActive.value = false
    footCapFeedbackMessage.value = null
  }

  const nodeId = selectedNodeId.value
  const component = wallComponent.value
  if (!nodeId || !component) {
    return
  }

  if (target === 'head' && !component.props?.bodyAssetId) {
    headFeedbackMessage.value = 'Assign a wall body model first.'
    return
  }
  if (target === 'foot' && !component.props?.bodyAssetId) {
    footFeedbackMessage.value = 'Assign a wall body model first.'
    return
  }
  if (target === 'headCap' && !component.props?.bodyEndCapAssetId) {
    headCapFeedbackMessage.value = 'Assign a body end cap first.'
    return
  }
  if (target === 'footCap' && !component.props?.bodyEndCapAssetId) {
    footCapFeedbackMessage.value = 'Assign a body end cap first.'
    return
  }

  const processing = target === 'body'
    ? bodyDropProcessing
    : target === 'head'
      ? headDropProcessing
      : target === 'foot'
        ? footDropProcessing
      : target === 'bodyCap'
        ? capDropProcessing
        : target === 'headCap'
          ? headCapDropProcessing
          : footCapDropProcessing
  if (processing.value) {
    return
  }

  const assetId = resolveDragAssetId(event)
  if (!assetId) {
    const message = 'Drag a model asset from the Asset Panel.'
    if (target === 'body') bodyFeedbackMessage.value = message
    else if (target === 'head') headFeedbackMessage.value = message
    else if (target === 'foot') footFeedbackMessage.value = message
    else if (target === 'bodyCap') capFeedbackMessage.value = message
    else if (target === 'headCap') headCapFeedbackMessage.value = message
    else footCapFeedbackMessage.value = message
    return
  }

  const invalid = validateWallAssetId(assetId)
  if (invalid) {
    if (target === 'body') bodyFeedbackMessage.value = invalid
    else if (target === 'head') headFeedbackMessage.value = invalid
    else if (target === 'foot') footFeedbackMessage.value = invalid
    else if (target === 'bodyCap') capFeedbackMessage.value = invalid
    else if (target === 'headCap') headCapFeedbackMessage.value = invalid
    else footCapFeedbackMessage.value = invalid
    return
  }

  const currentId = target === 'body'
    ? component.props?.bodyAssetId
    : target === 'head'
      ? (component.props as any)?.headAssetId
      : target === 'foot'
        ? (component.props as any)?.footAssetId
      : target === 'bodyCap'
        ? (component.props as any)?.bodyEndCapAssetId
        : target === 'headCap'
          ? (component.props as any)?.headEndCapAssetId
          : (component.props as any)?.footEndCapAssetId
  if (assetId === currentId) {
    const message = 'This model is already assigned.'
    if (target === 'body') bodyFeedbackMessage.value = message
    else if (target === 'head') headFeedbackMessage.value = message
    else if (target === 'foot') footFeedbackMessage.value = message
    else if (target === 'bodyCap') capFeedbackMessage.value = message
    else if (target === 'headCap') headCapFeedbackMessage.value = message
    else footCapFeedbackMessage.value = message
    return
  }

  processing.value = true
  try {
    if (target === 'body') {
      sceneStore.updateNodeComponentProps(nodeId, component.id, { bodyAssetId: assetId })
    } else if (target === 'head') {
      sceneStore.updateNodeComponentProps(nodeId, component.id, { headAssetId: assetId } as any)
    } else if (target === 'foot') {
      sceneStore.updateNodeComponentProps(nodeId, component.id, { footAssetId: assetId } as any)
    } else if (target === 'bodyCap') {
      sceneStore.updateNodeComponentProps(nodeId, component.id, { bodyEndCapAssetId: assetId } as any)
    } else if (target === 'headCap') {
      sceneStore.updateNodeComponentProps(nodeId, component.id, { headEndCapAssetId: assetId } as any)
    } else {
      sceneStore.updateNodeComponentProps(nodeId, component.id, { footEndCapAssetId: assetId } as any)
    }
  } catch (error) {
    console.error('Failed to assign wall asset model', error)
    const message = (error as Error).message ?? 'Failed to assign the model asset.'
    if (target === 'body') bodyFeedbackMessage.value = message
    else if (target === 'head') headFeedbackMessage.value = message
    else if (target === 'foot') footFeedbackMessage.value = message
    else if (target === 'bodyCap') capFeedbackMessage.value = message
    else if (target === 'headCap') headCapFeedbackMessage.value = message
    else footCapFeedbackMessage.value = message
  } finally {
    processing.value = false
  }
}

watch([
  localHeight,
  localWidth,
  localThickness,
], ([height, width, thickness], [prevHeight, prevWidth, prevThickness]) => {
  if (isSyncingFromScene.value || isApplyingDimensions.value) {
    return
  }

  if (!Number.isFinite(height) || !Number.isFinite(width) || !Number.isFinite(thickness)) {
    return
  }

  if (height === prevHeight && width === prevWidth && thickness === prevThickness) {
    return
  }

  applyDimensions()
})

function handleToggleComponent() {
  const component = wallComponent.value
  const nodeId = selectedNodeId.value

  if (!component || !nodeId) {
    return
  }

  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = wallComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}

function clampDimension(value: number, fallback: number, min: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback
  }
  return Math.max(min, value)
}

function applyDimensions() {
  if (isApplyingDimensions.value) {
    return
  }

  const component = wallComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }

  isApplyingDimensions.value = true
  const props = (component.props ?? {}) as Partial<WallComponentProps>

  try {
    const nextHeight = clampDimension(Number(localHeight.value), props.height ?? WALL_DEFAULT_HEIGHT, WALL_MIN_HEIGHT)
    const nextWidth = clampDimension(Number(localWidth.value), props.width ?? WALL_DEFAULT_WIDTH, WALL_MIN_WIDTH)
    const nextThickness = clampDimension(Number(localThickness.value), props.thickness ?? WALL_DEFAULT_THICKNESS, WALL_MIN_THICKNESS)

    const hasChanges =
      props.height !== nextHeight ||
      props.width !== nextWidth ||
      props.thickness !== nextThickness

    if (localHeight.value !== nextHeight) {
      localHeight.value = nextHeight
    }
    if (localWidth.value !== nextWidth) {
      localWidth.value = nextWidth
    }
    if (localThickness.value !== nextThickness) {
      localThickness.value = nextThickness
    }

    if (hasChanges) {
      sceneStore.updateNodeComponentProps(nodeId, component.id, {
        height: nextHeight,
        width: nextWidth,
        thickness: nextThickness,
      })
    }
  } finally {
    nextTick(() => {
      isApplyingDimensions.value = false
    })
  }
}

function applySmoothingUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = wallComponent.value
  if (!nodeId || !component) {
    return
  }
  const value = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  if (!Number.isFinite(value)) {
    return
  }
  const clamped = Math.min(1, Math.max(0, value))
  const current = typeof component.props?.smoothing === 'number'
    ? component.props.smoothing
    : WALL_DEFAULT_SMOOTHING
  if (Math.abs(current - clamped) <= 1e-6) {
    return
  }
  if (localSmoothing.value !== clamped) {
    localSmoothing.value = clamped
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { smoothing: clamped })
}

function applyAirWallUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = wallComponent.value
  if (!nodeId || !component) {
    return
  }
  const nextValue = Boolean(rawValue)
  const current = Boolean((component.props as any)?.isAirWall)
  if (nextValue === current) {
    return
  }
  if (localIsAirWall.value !== nextValue) {
    localIsAirWall.value = nextValue
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { isAirWall: nextValue } as any)
}

function applyRenderModeUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = wallComponent.value
  if (!nodeId || !component) {
    return
  }
  const nextValue: WallRenderMode = rawValue === 'repeatInstances' ? 'repeatInstances' : 'stretch'
  const current = (component.props as any)?.wallRenderMode === 'repeatInstances' ? 'repeatInstances' : 'stretch'
  if (nextValue === current) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { wallRenderMode: nextValue } as any)
}
</script>

<template>
  <v-expansion-panel value="wall">
    <v-expansion-panel-title>
      <div class="wall-panel-header">
        <span class="wall-panel-title">Wall</span>
        <v-spacer />
        <v-btn
          v-if="wallComponent"
          icon
          variant="text"
          size="small"
          class="component-menu-btn"
          @click.stop="openSaveWallPresetDialog"
        >
          <v-icon size="18">mdi-content-save</v-icon>
        </v-btn>
        <v-menu
          v-if="wallComponent"
          location="bottom end"
          origin="auto"
          transition="fade-transition"
        >
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon
              variant="text"
              size="small"
              class="component-menu-btn"
              @click.stop
            >
              <v-icon size="18">mdi-dots-vertical</v-icon>
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item
              @click.stop="handleToggleComponent()"
            >
              <v-list-item-title>
                {{ wallComponent.enabled ? 'Disable' : 'Enable' }}
              </v-list-item-title>
            </v-list-item>
            <v-divider class="component-menu-divider" inset />
            <v-list-item
              @click.stop="handleRemoveComponent()"
            >
              <v-list-item-title>Remove</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div
        class="wall-panel-drop-surface"
        ref="panelDropAreaRef"
        :class="{ 'is-wall-preset-active': wallPresetDropActive }"
        @dragenter.capture="handleWallPresetDragEnterCapture"
        @dragover.capture="handleWallPresetDragOverCapture"
        @dragleave.capture="handleWallPresetDragLeaveCapture"
        @drop.capture="handleWallPresetDropCapture"
      >
        <p v-if="wallPresetFeedbackMessage" class="asset-feedback wall-preset-feedback">{{ wallPresetFeedbackMessage }}</p>

        <div class="wall-field-grid">
          <div class="wall-field-labels">
            <span>Corner Smoothness</span>
            <span>{{ smoothingDisplay }}</span>
          </div>
          <v-slider
            :model-value="localSmoothing"
            :min="0"
            :max="1"
            :step="0.01"
            density="compact"
            track-color="rgba(77, 208, 225, 0.4)"
            color="primary"
            @update:modelValue="(value) => { localSmoothing = Number(value); applySmoothingUpdate(value) }"
          />
          <div class="wall-dimension-row">
            <v-text-field
              v-model.number="localHeight"
              label="Height (m)"
              type="number"
              density="compact"
              variant="underlined"
              class="slider-input"
              step="0.1"
              min="0.5"
              @blur="applyDimensions"
              inputmode="decimal"
              @keydown.enter.prevent="applyDimensions"
            />
            <v-text-field
              v-model.number="localWidth"
              label="Width (m)"
              type="number"
              density="compact"
              variant="underlined"
              class="slider-input"
              step="0.05"
              min="0.1"
              @blur="applyDimensions"
              inputmode="decimal"
              @keydown.enter.prevent="applyDimensions"
            />
            <v-text-field
              v-model.number="localThickness"
              label="Thickness (m)"
              type="number"
              class="slider-input"
              density="compact"
              inputmode="decimal"
              variant="underlined"
              step="0.05"
              min="0.05"
              @blur="applyDimensions"
              @keydown.enter.prevent="applyDimensions"
            />
          </div>
          <v-switch
            :model-value="localIsAirWall"
            label="Air Wall"
            density="compact"
            hide-details
            @update:modelValue="(value) => { localIsAirWall = Boolean(value); applyAirWallUpdate(value) }"
          />

          <v-select
            density="compact"
            variant="underlined"
            label="Render Mode"
            :items="WALL_RENDER_MODE_ITEMS"
            item-title="title"
            item-value="value"
            hide-details
            :model-value="(wallComponent?.props as any)?.wallRenderMode ?? 'stretch'"
            @update:modelValue="applyRenderModeUpdate"
          />

        </div>

        <div class="wall-asset-section">
          <div class="asset-model-panel asset-model-panel--no-border">
            <div class="asset-pair-panel">
              <div class="asset-pair-grid asset-pair-grid--stacked">
                <div
                  class="asset-pair-item"
                  ref="bodyDropAreaRef"
                  :class="{ 'is-active': bodyDropActive, 'is-processing': bodyDropProcessing }"
                  @dragenter.prevent="bodyDropActive = true"
                  @dragover.prevent="bodyDropActive = true"
                  @dragleave="(e) => { if (shouldDeactivateDropArea(bodyDropAreaRef, e)) bodyDropActive = false }"
                  @drop="(e) => assignWallAsset(e, 'body')"
                >
                  <div class="asset-pair-label">Body</div>
                  <div class="wall-asset-model-row">
                    <div class="wall-asset-model-picker">
                      <div
                        class="asset-thumbnail"
                        :class="{ placeholder: !bodyAsset }"
                        :style="bodyAsset
                          ? (bodyAsset.thumbnail?.trim() ? { backgroundImage: `url(${bodyAsset.thumbnail})` } : (bodyAsset.previewColor ? { backgroundColor: bodyAsset.previewColor } : undefined))
                          : undefined"
                        @click.stop="(e) => openWallAssetDialog('body', e)"
                      />
                    </div>

                    <div v-if="wallComponent" class="wall-asset-orientation-grid">
                      <v-select
                        density="compact"
                        variant="underlined"
                        label="Forward"
                        :items="FORWARD_AXIS_ITEMS"
                        item-title="title"
                        item-value="value"
                        hide-details
                        :model-value="(wallComponent.props as any).bodyOrientation.forwardAxis"
                        @update:modelValue="(value) => updateWallOrientation('bodyOrientation', { forwardAxis: value as any })"
                      />
                      <v-text-field
                        density="compact"
                        variant="underlined"
                        type="number"
                        label="Yaw (deg)"
                        hide-details
                        step="1"
                        min="-180"
                        max="180"
                        :model-value="(wallComponent.props as any).bodyOrientation.yawDeg"
                        @update:modelValue="(value) => updateWallOrientation('bodyOrientation', { yawDeg: Number(value) })"
                      />
                      <v-select
                        density="compact"
                        variant="underlined"
                        label="UV Axis"
                        :items="UV_AXIS_ITEMS"
                        item-title="title"
                        item-value="value"
                        hide-details
                        :model-value="(wallComponent.props as any).bodyUvAxis ?? 'auto'"
                        @update:modelValue="(value) => updateWallUvAxis('bodyUvAxis', value)"
                      />
                    </div>
                  </div>

                  <p v-if="bodyFeedbackMessage" class="asset-feedback">{{ bodyFeedbackMessage }}</p>
                </div>

                <div
                  class="asset-pair-item"
                  ref="headDropAreaRef"
                  :class="{ 'is-active': headDropActive, 'is-processing': headDropProcessing, 'is-disabled': !wallComponent?.props?.bodyAssetId }"
                  @dragenter.prevent="() => { if (!wallComponent?.props?.bodyAssetId) return; headDropActive = true }"
                  @dragover.prevent="() => { if (!wallComponent?.props?.bodyAssetId) return; headDropActive = true }"
                  @dragleave="(e) => { if (shouldDeactivateDropArea(headDropAreaRef, e)) headDropActive = false }"
                  @drop="(e) => { if (!wallComponent?.props?.bodyAssetId) return; assignWallAsset(e, 'head') }"
                >
                  <div class="asset-pair-label">Head</div>
                  <div class="wall-asset-model-row">
                    <div class="wall-asset-model-picker">
                      <div
                        class="asset-thumbnail"
                        :class="{ placeholder: !headAsset }"
                        :style="headAsset
                          ? (headAsset.thumbnail?.trim() ? { backgroundImage: `url(${headAsset.thumbnail})` } : (headAsset.previewColor ? { backgroundColor: headAsset.previewColor } : undefined))
                          : undefined"
                        @click.stop="(e) => { if (!wallComponent?.props?.bodyAssetId) return; openWallAssetDialog('head', e) }"
                      />
                    </div>

                    <div v-if="wallComponent" class="wall-asset-orientation-grid">
                      <v-select
                        density="compact"
                        variant="underlined"
                        label="Forward"
                        :items="FORWARD_AXIS_ITEMS"
                        item-title="title"
                        item-value="value"
                        hide-details
                        :model-value="(wallComponent.props as any).headOrientation.forwardAxis"
                        @update:modelValue="(value) => updateWallOrientation('headOrientation', { forwardAxis: value as any })"
                      />
                      <v-text-field
                        density="compact"
                        variant="underlined"
                        type="number"
                        label="Yaw (deg)"
                        hide-details
                        step="1"
                        min="-180"
                        max="180"
                        :model-value="(wallComponent.props as any).headOrientation.yawDeg"
                        @update:modelValue="(value) => updateWallOrientation('headOrientation', { yawDeg: Number(value) })"
                      />
                      <v-select
                        density="compact"
                        variant="underlined"
                        label="UV Axis"
                        :items="UV_AXIS_ITEMS"
                        item-title="title"
                        item-value="value"
                        hide-details
                        :model-value="(wallComponent.props as any).headUvAxis ?? 'auto'"
                        @update:modelValue="(value) => updateWallUvAxis('headUvAxis', value)"
                      />
                    </div>
                  </div>

                  <p v-if="headFeedbackMessage" class="asset-feedback">{{ headFeedbackMessage }}</p>
                </div>

                <div
                  class="asset-pair-item"
                  ref="footDropAreaRef"
                  :class="{ 'is-active': footDropActive, 'is-processing': footDropProcessing, 'is-disabled': !wallComponent?.props?.bodyAssetId }"
                  @dragenter.prevent="() => { if (!wallComponent?.props?.bodyAssetId) return; footDropActive = true }"
                  @dragover.prevent="() => { if (!wallComponent?.props?.bodyAssetId) return; footDropActive = true }"
                  @dragleave="(e) => { if (shouldDeactivateDropArea(footDropAreaRef, e)) footDropActive = false }"
                  @drop="(e) => { if (!wallComponent?.props?.bodyAssetId) return; assignWallAsset(e, 'foot') }"
                >
                  <div class="asset-pair-label">Foot</div>
                  <div class="wall-asset-model-row">
                    <div class="wall-asset-model-picker">
                      <div
                        class="asset-thumbnail"
                        :class="{ placeholder: !footAsset }"
                        :style="footAsset
                          ? (footAsset.thumbnail?.trim() ? { backgroundImage: `url(${footAsset.thumbnail})` } : (footAsset.previewColor ? { backgroundColor: footAsset.previewColor } : undefined))
                          : undefined"
                        @click.stop="(e) => { if (!wallComponent?.props?.bodyAssetId) return; openWallAssetDialog('foot', e) }"
                      />
                    </div>

                    <div v-if="wallComponent" class="wall-asset-orientation-grid">
                      <v-select
                        density="compact"
                        variant="underlined"
                        label="Forward"
                        :items="FORWARD_AXIS_ITEMS"
                        item-title="title"
                        item-value="value"
                        hide-details
                        :model-value="(wallComponent.props as any).footOrientation.forwardAxis"
                        @update:modelValue="(value) => updateWallOrientation('footOrientation', { forwardAxis: value as any })"
                      />
                      <v-text-field
                        density="compact"
                        variant="underlined"
                        type="number"
                        label="Yaw (deg)"
                        hide-details
                        step="1"
                        min="-180"
                        max="180"
                        :model-value="(wallComponent.props as any).footOrientation.yawDeg"
                        @update:modelValue="(value) => updateWallOrientation('footOrientation', { yawDeg: Number(value) })"
                      />
                      <v-select
                        density="compact"
                        variant="underlined"
                        label="UV Axis"
                        :items="UV_AXIS_ITEMS"
                        item-title="title"
                        item-value="value"
                        hide-details
                        :model-value="(wallComponent.props as any).footUvAxis ?? 'auto'"
                        @update:modelValue="(value) => updateWallUvAxis('footUvAxis', value)"
                      />
                    </div>
                  </div>

                  <p v-if="footFeedbackMessage" class="asset-feedback">{{ footFeedbackMessage }}</p>
                </div>

                <div
                  class="asset-pair-item"
                  ref="capDropAreaRef"
                  :class="{ 'is-active': capDropActive, 'is-processing': capDropProcessing }"
                  @dragenter.prevent="capDropActive = true"
                  @dragover.prevent="capDropActive = true"
                  @dragleave="(e) => { if (shouldDeactivateDropArea(capDropAreaRef, e)) capDropActive = false }"
                  @drop="(e) => assignWallAsset(e, 'bodyCap')"
                >
                  <div class="asset-pair-label">End Cap (Body)</div>
                  <div class="wall-asset-model-row">
                    <div class="wall-asset-model-picker">
                      <div
                        class="asset-thumbnail"
                        :class="{ placeholder: !bodyCapAsset }"
                        :style="bodyCapAsset
                          ? (bodyCapAsset.thumbnail?.trim() ? { backgroundImage: `url(${bodyCapAsset.thumbnail})` } : (bodyCapAsset.previewColor ? { backgroundColor: bodyCapAsset.previewColor } : undefined))
                          : undefined"
                        @click.stop="(e) => openWallAssetDialog('bodyCap', e)"
                      />
                    </div>

                    <div v-if="wallComponent" class="wall-asset-orientation-grid">
                      <v-select
                        density="compact"
                        variant="underlined"
                        label="Forward"
                        :items="FORWARD_AXIS_ITEMS"
                        item-title="title"
                        item-value="value"
                        hide-details
                        :model-value="(wallComponent.props as any).bodyEndCapOrientation.forwardAxis"
                        @update:modelValue="(value) => updateWallOrientation('bodyEndCapOrientation', { forwardAxis: value as any })"
                      />
                      <v-text-field
                        density="compact"
                        variant="underlined"
                        type="number"
                        label="Yaw (deg)"
                        hide-details
                        step="1"
                        min="-180"
                        max="180"
                        :model-value="(wallComponent.props as any).bodyEndCapOrientation.yawDeg"
                        @update:modelValue="(value) => updateWallOrientation('bodyEndCapOrientation', { yawDeg: Number(value) })"
                      />
                    </div>
                  </div>

                  <p v-if="capFeedbackMessage" class="asset-feedback">{{ capFeedbackMessage }}</p>
                </div>

                <div
                  class="asset-pair-item"
                  ref="headCapDropAreaRef"
                  :class="{ 'is-active': headCapDropActive, 'is-processing': headCapDropProcessing, 'is-disabled': !wallComponent?.props?.bodyEndCapAssetId }"
                  @dragenter.prevent="() => { if (!wallComponent?.props?.bodyEndCapAssetId) return; headCapDropActive = true }"
                  @dragover.prevent="() => { if (!wallComponent?.props?.bodyEndCapAssetId) return; headCapDropActive = true }"
                  @dragleave="(e) => { if (shouldDeactivateDropArea(headCapDropAreaRef, e)) headCapDropActive = false }"
                  @drop="(e) => { if (!wallComponent?.props?.bodyEndCapAssetId) return; assignWallAsset(e, 'headCap') }"
                >
                  <div class="asset-pair-label">End Cap (Head)</div>
                  <div class="wall-asset-model-row">
                    <div class="wall-asset-model-picker">
                      <div
                        class="asset-thumbnail"
                        :class="{ placeholder: !headCapAsset }"
                        :style="headCapAsset
                          ? (headCapAsset.thumbnail?.trim() ? { backgroundImage: `url(${headCapAsset.thumbnail})` } : (headCapAsset.previewColor ? { backgroundColor: headCapAsset.previewColor } : undefined))
                          : undefined"
                        @click.stop="(e) => { if (!wallComponent?.props?.bodyEndCapAssetId) return; openWallAssetDialog('headCap', e) }"
                      />
                    </div>

                    <div v-if="wallComponent" class="wall-asset-orientation-grid">
                      <v-select
                        density="compact"
                        variant="underlined"
                        label="Forward"
                        :items="FORWARD_AXIS_ITEMS"
                        item-title="title"
                        item-value="value"
                        hide-details
                        :model-value="(wallComponent.props as any).headEndCapOrientation.forwardAxis"
                        @update:modelValue="(value) => updateWallOrientation('headEndCapOrientation', { forwardAxis: value as any })"
                      />
                      <v-text-field
                        density="compact"
                        variant="underlined"
                        type="number"
                        label="Yaw (deg)"
                        hide-details
                        step="1"
                        min="-180"
                        max="180"
                        :model-value="(wallComponent.props as any).headEndCapOrientation.yawDeg"
                        @update:modelValue="(value) => updateWallOrientation('headEndCapOrientation', { yawDeg: Number(value) })"
                      />
                    </div>
                  </div>

                  <p v-if="headCapFeedbackMessage" class="asset-feedback">{{ headCapFeedbackMessage }}</p>
                </div>

                <div
                  class="asset-pair-item"
                  ref="footCapDropAreaRef"
                  :class="{ 'is-active': footCapDropActive, 'is-processing': footCapDropProcessing, 'is-disabled': !wallComponent?.props?.bodyEndCapAssetId }"
                  @dragenter.prevent="() => { if (!wallComponent?.props?.bodyEndCapAssetId) return; footCapDropActive = true }"
                  @dragover.prevent="() => { if (!wallComponent?.props?.bodyEndCapAssetId) return; footCapDropActive = true }"
                  @dragleave="(e) => { if (shouldDeactivateDropArea(footCapDropAreaRef, e)) footCapDropActive = false }"
                  @drop="(e) => { if (!wallComponent?.props?.bodyEndCapAssetId) return; assignWallAsset(e, 'footCap') }"
                >
                  <div class="asset-pair-label">End Cap (Foot)</div>
                  <div class="wall-asset-model-row">
                    <div class="wall-asset-model-picker">
                      <div
                        class="asset-thumbnail"
                        :class="{ placeholder: !footCapAsset }"
                        :style="footCapAsset
                          ? (footCapAsset.thumbnail?.trim() ? { backgroundImage: `url(${footCapAsset.thumbnail})` } : (footCapAsset.previewColor ? { backgroundColor: footCapAsset.previewColor } : undefined))
                          : undefined"
                        @click.stop="(e) => { if (!wallComponent?.props?.bodyEndCapAssetId) return; openWallAssetDialog('footCap', e) }"
                      />
                    </div>

                    <div v-if="wallComponent" class="wall-asset-orientation-grid">
                      <v-select
                        density="compact"
                        variant="underlined"
                        label="Forward"
                        :items="FORWARD_AXIS_ITEMS"
                        item-title="title"
                        item-value="value"
                        hide-details
                        :model-value="(wallComponent.props as any).footEndCapOrientation.forwardAxis"
                        @update:modelValue="(value) => updateWallOrientation('footEndCapOrientation', { forwardAxis: value as any })"
                      />
                      <v-text-field
                        density="compact"
                        variant="underlined"
                        type="number"
                        label="Yaw (deg)"
                        hide-details
                        step="1"
                        min="-180"
                        max="180"
                        :model-value="(wallComponent.props as any).footEndCapOrientation.yawDeg"
                        @update:modelValue="(value) => updateWallOrientation('footEndCapOrientation', { yawDeg: Number(value) })"
                      />
                    </div>
                  </div>

                  <p v-if="footCapFeedbackMessage" class="asset-feedback">{{ footCapFeedbackMessage }}</p>
                </div>
              </div>
            </div>
          </div>

        <div class="corner-models-panel">
        <div class="wall-corner-models">
          <div class="wall-corner-header">
            <div class="wall-corner-title">Corner Models</div>
            <v-btn
              size="small"
              density="compact"
              variant="text"
              color="primary"
              @click.stop="addCornerModel"
              :disabled="!wallComponent"
            >
              Add
            </v-btn>
          </div>

          <div v-if="!cornerModels.length" class="wall-corner-empty">
            <span class="hint-text">No corner models configured. No corner instances will be generated.</span>
          </div>

          <div
            v-for="(entry, index) in cornerModels"
            :key="`corner-${index}`"
            class="wall-corner-row"
          >
            <div class="wall-corner-fields">
              <div class="wall-corner-angle-fields">
                <div class="wall-corner-angle-label">
                </div>
                <div class="wall-corner-angle-inputs">
                  <v-text-field
                    density="compact"
                    variant="underlined"
                    type="number"
                    label="Interior Angle (°)"
                    :model-value="(entry as any).angle ?? 90"
                    min="0"
                    max="180"
                    step="1"
                    inputmode="decimal"
                    hide-details
                    @update:modelValue="(value) => updateCornerModel(index, { angle: Number(value) } as any)"
                    @blur="() => updateCornerModel(index, {})"
                  />
                  <v-text-field
                    density="compact"
                    variant="underlined"
                    type="number"
                    label="Tolerance (°)"
                    :model-value="(entry as any).tolerance ?? 5"
                    min="0"
                    max="90"
                    step="1"
                    inputmode="decimal"
                    hide-details
                    @update:modelValue="(value) => updateCornerModel(index, { tolerance: Number(value) } as any)"
                    @blur="() => updateCornerModel(index, {})"
                  />
                </div>
                <div class="wall-joint-trim-row">
                  <v-text-field
                    class="slider-input"
                    density="compact"
                    variant="underlined"
                    type="number"
                    label="Trim Start (m)"
                    :model-value="(entry as any).jointTrim?.start ?? 0"
                    min="0"
                    step="0.01"
                    inputmode="decimal"
                    hide-details
                    @update:modelValue="(value) => updateCornerModel(index, { jointTrim: { ...((entry as any).jointTrim ?? { start: 0, end: 0 }), start: Math.max(0, Number(value) || 0) } } as any)"
                    @blur="() => updateCornerModel(index, {})"
                  />
                  <v-text-field
                    class="slider-input"
                    density="compact"
                    variant="underlined"
                    type="number"
                    label="Trim End (m)"
                    :model-value="(entry as any).jointTrim?.end ?? 0"
                    min="0"
                    step="0.01"
                    inputmode="decimal"
                    hide-details
                    @update:modelValue="(value) => updateCornerModel(index, { jointTrim: { ...((entry as any).jointTrim ?? { start: 0, end: 0 }), end: Math.max(0, Number(value) || 0) } } as any)"
                    @blur="() => updateCornerModel(index, {})"
                  />
                  <div class="wall-joint-trim-actions">
                    <v-btn
                      icon
                      density="compact"
                      variant="text"
                      size="small"
                      title="Recommend Trim"
                      @click="recommendJointTrimForCorner(index)"
                    >
                      <v-icon size="18">mdi-lightning-bolt</v-icon>
                    </v-btn>
                  </div>
                </div>
                <p v-if="jointTrimFeedbackMessage" class="asset-feedback">{{ jointTrimFeedbackMessage }}</p>
              </div>
            </div>
            <div class="wall-corner-model-row wall-corner-model-row--body">
              <div
                class="wall-corner-model-picker"
                @click.stop="(e) => openWallCornerModelDialog(index, 'body', e)"
              >
                <template v-if="resolveCornerModelAsset((entry as any).bodyAssetId)">
                  <div
                    class="asset-thumbnail"
                    :style="(() => {
                      const asset = resolveCornerModelAsset((entry as any).bodyAssetId)
                      if (!asset) return undefined
                      return asset.thumbnail?.trim()
                        ? { backgroundImage: `url(${asset.thumbnail})` }
                        : (asset.previewColor ? { backgroundColor: asset.previewColor } : undefined)
                    })()"
                  />
                </template>
                <template v-else>
                  <div class="asset-thumbnail placeholder" />
                </template>
              </div>

              <div class="wall-corner-orientation-stack">
                <v-select
                  density="compact"
                  variant="underlined"
                  label="Body Forward"
                  :items="FORWARD_AXIS_ITEMS"
                  item-title="title"
                  item-value="value"
                  hide-details
                  :model-value="(entry as any).bodyForwardAxis"
                  @update:modelValue="(value) => updateCornerModel(index, { bodyForwardAxis: value as any } as any)"
                  @blur="() => updateCornerModel(index, {})"
                />
                <v-text-field
                  density="compact"
                  variant="underlined"
                  type="number"
                  label="Body Yaw"
                  hide-details
                  step="1"
                  min="-180"
                  max="180"
                  :model-value="(entry as any).bodyYawDeg"
                  @update:modelValue="(value) => updateCornerModel(index, { bodyYawDeg: Number(value) } as any)"
                  @blur="() => updateCornerModel(index, {})"
                />
              </div>

              <div class="wall-corner-offset-grid">
                <v-text-field
                  density="compact"
                  variant="underlined"
                  type="number"
                  label="Offset X"
                  hide-details
                  step="0.01"
                  inputmode="decimal"
                  :model-value="(entry as any).bodyOffsetLocal?.x ?? 0"
                  @update:modelValue="(value) => updateCornerModel(index, { bodyOffsetLocal: { ...((entry as any).bodyOffsetLocal ?? { x: 0, y: 0, z: 0 }), x: Number(value) } } as any)"
                  @blur="() => updateCornerModel(index, {})"
                />
                <v-text-field
                  density="compact"
                  variant="underlined"
                  type="number"
                  label="Offset Y"
                  hide-details
                  step="0.01"
                  inputmode="decimal"
                  :model-value="(entry as any).bodyOffsetLocal?.y ?? 0"
                  @update:modelValue="(value) => updateCornerModel(index, { bodyOffsetLocal: { ...((entry as any).bodyOffsetLocal ?? { x: 0, y: 0, z: 0 }), y: Number(value) } } as any)"
                  @blur="() => updateCornerModel(index, {})"
                />
                <v-text-field
                  density="compact"
                  variant="underlined"
                  type="number"
                  label="Offset Z"
                  hide-details
                  step="0.01"
                  inputmode="decimal"
                  :model-value="(entry as any).bodyOffsetLocal?.z ?? 0"
                  @update:modelValue="(value) => updateCornerModel(index, { bodyOffsetLocal: { ...((entry as any).bodyOffsetLocal ?? { x: 0, y: 0, z: 0 }), z: Number(value) } } as any)"
                  @blur="() => updateCornerModel(index, {})"
                />
              </div>
            </div>

            <v-divider class="wall-corner-divider" />

            <div
              class="wall-corner-model-row wall-corner-model-row--head"
              :class="{ 'is-disabled': !wallComponent?.props?.bodyAssetId }"
            >
              <div
                class="wall-corner-model-picker"
                @click.stop="(e) => { if (!wallComponent?.props?.bodyAssetId) return; openWallCornerModelDialog(index, 'head', e) }"
              >
                <template v-if="resolveCornerModelAsset((entry as any).headAssetId)">
                  <div
                    class="asset-thumbnail"
                    :style="(() => {
                      const asset = resolveCornerModelAsset((entry as any).headAssetId)
                      if (!asset) return undefined
                      return asset.thumbnail?.trim()
                        ? { backgroundImage: `url(${asset.thumbnail})` }
                        : (asset.previewColor ? { backgroundColor: asset.previewColor } : undefined)
                    })()"
                  />
                </template>
                <template v-else>
                  <div class="asset-thumbnail placeholder" />
                </template>
              </div>

              <div class="wall-corner-orientation-stack">
                <v-select
                  density="compact"
                  variant="underlined"
                  label="Head Forward"
                  :items="FORWARD_AXIS_ITEMS"
                  item-title="title"
                  item-value="value"
                  hide-details
                  :model-value="(entry as any).headForwardAxis"
                  @update:modelValue="(value) => updateCornerModel(index, { headForwardAxis: value as any } as any)"
                  @blur="() => updateCornerModel(index, {})"
                />
                <v-text-field
                  density="compact"
                  variant="underlined"
                  type="number"
                  label="Head Yaw"
                  hide-details
                  step="1"
                  min="-180"
                  max="180"
                  :model-value="(entry as any).headYawDeg"
                  @update:modelValue="(value) => updateCornerModel(index, { headYawDeg: Number(value) } as any)"
                  @blur="() => updateCornerModel(index, {})"
                />
              </div>

              <div class="wall-corner-offset-grid">
                <v-text-field
                  density="compact"
                  variant="underlined"
                  type="number"
                  label="Offset X"
                  hide-details
                  step="0.01"
                  inputmode="decimal"
                  :model-value="(entry as any).headOffsetLocal?.x ?? 0"
                  @update:modelValue="(value) => updateCornerModel(index, { headOffsetLocal: { ...((entry as any).headOffsetLocal ?? { x: 0, y: 0, z: 0 }), x: Number(value) } } as any)"
                  @blur="() => updateCornerModel(index, {})"
                />
                <v-text-field
                  density="compact"
                  variant="underlined"
                  type="number"
                  label="Offset Y"
                  hide-details
                  step="0.01"
                  inputmode="decimal"
                  :model-value="(entry as any).headOffsetLocal?.y ?? 0"
                  @update:modelValue="(value) => updateCornerModel(index, { headOffsetLocal: { ...((entry as any).headOffsetLocal ?? { x: 0, y: 0, z: 0 }), y: Number(value) } } as any)"
                  @blur="() => updateCornerModel(index, {})"
                />
                <v-text-field
                  density="compact"
                  variant="underlined"
                  type="number"
                  label="Offset Z"
                  hide-details
                  step="0.01"
                  inputmode="decimal"
                  :model-value="(entry as any).headOffsetLocal?.z ?? 0"
                  @update:modelValue="(value) => updateCornerModel(index, { headOffsetLocal: { ...((entry as any).headOffsetLocal ?? { x: 0, y: 0, z: 0 }), z: Number(value) } } as any)"
                  @blur="() => updateCornerModel(index, {})"
                />
              </div>
            </div>

            <v-divider class="wall-corner-divider" />

            <div
              class="wall-corner-model-row"
              :class="{ 'is-disabled': !wallComponent?.props?.bodyAssetId }"
            >
              <div
                class="wall-corner-model-picker"
                @click.stop="(e) => { if (!wallComponent?.props?.bodyAssetId) return; openWallCornerModelDialog(index, 'foot', e) }"
              >
                <template v-if="resolveCornerModelAsset((entry as any).footAssetId)">
                  <div
                    class="asset-thumbnail"
                    :style="(() => {
                      const asset = resolveCornerModelAsset((entry as any).footAssetId)
                      if (!asset) return undefined
                      return asset.thumbnail?.trim()
                        ? { backgroundImage: `url(${asset.thumbnail})` }
                        : (asset.previewColor ? { backgroundColor: asset.previewColor } : undefined)
                    })()"
                  />
                </template>
                <template v-else>
                  <div class="asset-thumbnail placeholder" />
                </template>
              </div>

              <div class="wall-corner-orientation-stack">
                <v-select
                  density="compact"
                  variant="underlined"
                  label="Foot Forward"
                  :items="FORWARD_AXIS_ITEMS"
                  item-title="title"
                  item-value="value"
                  hide-details
                  :model-value="(entry as any).footForwardAxis"
                  @update:modelValue="(value) => updateCornerModel(index, { footForwardAxis: value as any } as any)"
                  @blur="() => updateCornerModel(index, {})"
                />
                <v-text-field
                  density="compact"
                  variant="underlined"
                  type="number"
                  label="Foot Yaw"
                  hide-details
                  step="1"
                  min="-180"
                  max="180"
                  :model-value="(entry as any).footYawDeg"
                  @update:modelValue="(value) => updateCornerModel(index, { footYawDeg: Number(value) } as any)"
                  @blur="() => updateCornerModel(index, {})"
                />
              </div>

              <div class="wall-corner-offset-grid">
                <v-text-field
                  density="compact"
                  variant="underlined"
                  type="number"
                  label="Offset X"
                  hide-details
                  step="0.01"
                  inputmode="decimal"
                  :model-value="(entry as any).footOffsetLocal?.x ?? 0"
                  @update:modelValue="(value) => updateCornerModel(index, { footOffsetLocal: { ...((entry as any).footOffsetLocal ?? { x: 0, y: 0, z: 0 }), x: Number(value) } } as any)"
                  @blur="() => updateCornerModel(index, {})"
                />
                <v-text-field
                  density="compact"
                  variant="underlined"
                  type="number"
                  label="Offset Y"
                  hide-details
                  step="0.01"
                  inputmode="decimal"
                  :model-value="(entry as any).footOffsetLocal?.y ?? 0"
                  @update:modelValue="(value) => updateCornerModel(index, { footOffsetLocal: { ...((entry as any).footOffsetLocal ?? { x: 0, y: 0, z: 0 }), y: Number(value) } } as any)"
                  @blur="() => updateCornerModel(index, {})"
                />
                <v-text-field
                  density="compact"
                  variant="underlined"
                  type="number"
                  label="Offset Z"
                  hide-details
                  step="0.01"
                  inputmode="decimal"
                  :model-value="(entry as any).footOffsetLocal?.z ?? 0"
                  @update:modelValue="(value) => updateCornerModel(index, { footOffsetLocal: { ...((entry as any).footOffsetLocal ?? { x: 0, y: 0, z: 0 }), z: Number(value) } } as any)"
                  @blur="() => updateCornerModel(index, {})"
                />
              </div>
            </div>

            

            <div class="wall-corner-actions">
              <v-btn
                icon="mdi-delete"
                size="x-small"
                density="compact"
                variant="text"
                @click.stop="removeCornerModel(index)"
                :disabled="!wallComponent"
              />
            </div>
          </div>
        </div>
        </div>
      </div>

      <AssetPickerDialog
        v-model="assetDialogVisible"
        :asset-id="assetDialogSelectedId"
        assetType="model,mesh"
        :title="assetDialogTitle"
        :anchor="assetDialogAnchor"
        @update:asset="handleWallAssetDialogUpdate"
        @cancel="handleWallAssetDialogCancel"
      />

      <v-dialog v-model="savePresetDialogVisible" max-width="420">
        <v-card>
          <v-card-title>Save Wall Preset</v-card-title>
          <v-card-text>
            <v-text-field
              v-model="savePresetName"
              label="Preset Name"
              density="compact"
              variant="underlined"
              autofocus
              @keydown.enter.prevent="confirmSaveWallPreset"
            />
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="savePresetDialogVisible = false">Cancel</v-btn>
            <v-btn color="primary" @click="confirmSaveWallPreset">Save</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>

      <v-dialog v-model="overwriteConfirmDialogVisible" max-width="420">
        <v-card>
          <v-card-title>Overwrite preset?</v-card-title>
          <v-card-text>
            This preset already exists: <strong>{{ overwriteTargetFilename }}</strong>. Overwrite it?
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="cancelOverwriteWallPreset">Cancel</v-btn>
            <v-btn
              color="primary"
              @click="performSaveWallPreset(overwriteTargetAssetId)"
            >
              Overwrite
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.wall-asset-orientation-grid {
  display: flex;
  gap: 8px;
  align-items: center;
}
.wall-asset-orientation-grid .v-select,
.wall-asset-orientation-grid .v-text-field {

}
.wall-field-grid {
  display: grid;
  gap: 0.2rem;
  margin: 0px 5px;
}

.wall-orientation-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
  margin-top: 0.25rem;
}

.wall-asset-model-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.6rem;
  align-items: center;
  width: 100%;
}

.wall-asset-model-picker {
  display: flex;
  align-items: center;
}

.wall-asset-orientation-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.4rem;
  align-items: center;
}

.wall-corner-orientation-inputs {
  grid-area: orientation;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.4rem;
}

.wall-field-labels {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
  opacity: 0.9;
}

.hint-text {
  display: block;
  margin-top: 0.25rem;
  color: rgba(220, 225, 232, 0.65);
}

.v-field-label {
  font-size: 0.82rem;
}
.slider-input :deep(.v-field-label) {
  font-size: 0.82rem;
  font-weight: 600;
}

.wall-panel-placeholder {
  color: rgba(233, 236, 241, 0.65);
  font-size: 0.85rem;
}

.asset-pair-panel, .corner-models-panel {
  border: 1px solid rgba(255,255,255,0.04);
  border-radius: 6px;
}
.asset-pair-panel summary, .corner-models-panel summary {
  list-style: none;
  cursor: pointer;
  font-weight: 600;
}
.asset-pair-grid {
  display: flex;
  gap: 8px;
}
.asset-pair-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 120px;
  position: relative;
}
.wall-corner-assets {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}

.asset-pair-panel {
  border-top: 1px solid rgba(255,255,255,0.06);
  padding-top: 12px;
}

.asset-pair-label {
  position: absolute;
  top: -10px;
  left: 8px;
  font-size: 0.78rem;
  font-weight: 600;
  background: transparent;
  padding: 0 6px;
  color: rgba(233,236,241,0.9);
}

.wall-panel-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.wall-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.wall-asset-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 0;
}

.wall-corner-models {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
}

.wall-corner-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.wall-corner-title {
  font-weight: 600;
  font-size: 0.9rem;
}

.wall-corner-empty {
  padding: 0.25rem 0;
}

.wall-corner-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-areas:
    'fields fields fields'
    'body body actions'
    'divider divider actions'
    'head head actions';
  column-gap: 0.75rem;
  row-gap: 0.4rem;
  align-items: center;
  padding: 0.6rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
}

.wall-corner-divider {
  grid-area: divider;
  opacity: 0.8;
}

.wall-corner-model-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.6rem;
  align-items: center;
}

.wall-corner-model-row--body {
  grid-area: body;
}

.wall-corner-model-row--head {
  grid-area: head;
}

.wall-corner-model-row.is-disabled {
  opacity: 0.45;
  pointer-events: none;
}

.wall-corner-model-picker {
  display: flex;
  align-items: center;
}

.wall-corner-orientation-stack {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem;
  align-items: center;
}

.wall-corner-offset-grid {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.35rem;
}

.asset-pair-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.asset-pair-grid--stacked {
  grid-template-columns: 1fr;
}

.asset-pair-grid--stacked .asset-pair-item {
  width: 100%;
}

.asset-pair-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 0.6rem;
  transition: border-color 0.2s, background-color 0.2s;
}

.asset-pair-item.is-active {
  border-color: rgba(110, 231, 183, 0.8);
  background-color: rgba(110, 231, 183, 0.08);
}

.asset-pair-item.is-processing {
  opacity: 0.85;
}

.asset-pair-item.is-disabled {
  opacity: 0.45;
  pointer-events: none;
}

.asset-pair-label {
  font-size: 0.8rem;
  font-weight: 600;
  opacity: 0.85;
}

.wall-corner-fields {
  grid-area: fields;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.wall-corner-actions {
  grid-area: actions;
  display: flex;
  justify-content: flex-end;
  align-self: center;
}

.wall-corner-angle-fields {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.wall-corner-angle-label {
  font-size: 0.8rem;
  opacity: 0.8;
}

.wall-corner-angle-inputs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}

.asset-model-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 0.75rem;
  transition: border-color 0.2s, background-color 0.2s;
}

.asset-model-panel.is-active {
  border-color: rgba(110, 231, 183, 0.8);
  background-color: rgba(110, 231, 183, 0.08);
}

.asset-model-panel.is-processing {
  border-color: rgba(59, 130, 246, 0.9);
  background-color: rgba(59, 130, 246, 0.08);
}

.asset-model-panel--no-border {
  border: none;
  padding: 0;
  background: transparent;
}

.asset-summary {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.asset-summary.empty .asset-text .asset-name {
  font-size: 0.85rem;
}

.asset-thumbnail {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  background-size: cover;
  background-position: center;
  cursor: pointer;
}

.asset-thumbnail.placeholder {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02));
}

.asset-text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.asset-name {
  font-weight: 600;
  font-size: 0.9rem;
}

.asset-subtitle {
  font-size: 0.75rem;
  color: rgba(233, 236, 241, 0.7);
}

.asset-feedback {
  font-size: 0.75rem;
  color: #f97316;
}

.wall-joint-trim-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.wall-joint-trim-row {
  display: flex;
  gap: 0.5rem;
  align-items: end;
  flex-wrap: nowrap;
}

.wall-joint-trim-row .slider-input {
  flex: 1;
  min-width: 0;
}

.wall-dimension-row {
  display: flex;
  gap: 0.5rem;
}

.wall-dimension-row .slider-input {
  flex: 1;
}

.wall-panel-drop-surface.is-wall-preset-active {
  outline: 2px dashed rgba(110, 231, 183, 0.75);
  outline-offset: 6px;
}

.wall-preset-feedback {
  margin: 0 5px 0.5rem;
}
</style>
