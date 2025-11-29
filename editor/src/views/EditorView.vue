<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import HierarchyPanel from '@/components/layout/HierarchyPanel.vue'
import InspectorPanel from '@/components/layout/InspectorPanel.vue'
import MaterialDetailsPanel from '@/components/inspector/MaterialDetailsPanel.vue'
import BehaviorDetailsPanel from '@/components/inspector/BehaviorDetailsPanel.vue'
import ProjectPanel from '@/components/layout/ProjectPanel.vue'
import SceneViewport, { type SceneViewportHandle } from '@/components/editor/SceneViewport.vue'
import MenuBar from './MenuBar.vue'
import SceneManagerDialog from '@/components/layout/SceneManagerDialog.vue'
import NewSceneDialog from '@/components/layout/NewSceneDialog.vue'
import SceneExportDialog from '@/components/layout/SceneExportDialog.vue'
import { publishScene } from '@/api/scenes'
import type { SceneExportOptions } from '@/types/scene-export'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import type { PresetSceneDocument } from '@/types/preset-scene'

import { prepareJsonSceneExport } from '@/utils/sceneExport'
import { broadcastScenePreviewUpdate } from '@/utils/previewChannel'
import { generateUuid } from '@/utils/uuid'
import {
  useSceneStore,
  buildPackageAssetMapForExport,
  calculateSceneResourceSummary,
  type EditorPanel,
  type SceneBundleImportPayload,
  type SceneBundleImportScene,
  SCENE_BUNDLE_FORMAT_VERSION,
} from '@/stores/sceneStore'
import { useScenesStore } from '@/stores/scenesStore'
import type { EditorTool } from '@/types/editor-tool'
import type { SceneCameraState } from '@/types/scene-camera-state'
import { useUiStore } from '@/stores/uiStore'
import type { TransformUpdatePayload } from '@/types/transform-update-payload'
import type { PanelPlacementState } from '@/types/panel-placement-state'
import Loader, { type LoaderProgressPayload } from '@schema/loader'
import type { Object3D } from 'three'
import {
  behaviorMapToList,
  cloneBehavior,
  cloneBehaviorList,
  ensureBehaviorParams,
  findBehaviorAction,
  createBehaviorSequenceId,
  listBehaviorScripts,
  type BehaviorActionDefinition,
} from '@schema/behaviors/definitions'
import { BEHAVIOR_COMPONENT_TYPE } from '@schema/components'
import type {
  BehaviorComponentProps,
  BehaviorEventType,
  SceneBehavior,
  SceneNodeComponentState,
  SceneResourceSummary,
} from '@harmony/schema'

const sceneStore = useSceneStore()
const scenesStore = useScenesStore()
const uiStore = useUiStore()
const {
  nodes: sceneNodes,
  selectedNode,
  selectedNodeId,
  activeTool,
  camera,
  panelVisibility,
  currentSceneId,
  cameraFocusNodeId,
  cameraFocusRequestId,
  nodeHighlightTargetId,
  nodeHighlightRequestId,
  groundSettings,
} = storeToRefs(sceneStore)

const { sortedMetadata: sceneSummaries } = storeToRefs(scenesStore)

type PanelPlacementHolder = { panelPlacement?: PanelPlacementState | null }

function normalizePanelPlacementState(input?: PanelPlacementState | null): PanelPlacementState {
  return {
    hierarchy: input?.hierarchy === 'floating' ? 'floating' : 'docked',
    inspector: input?.inspector === 'floating' ? 'floating' : 'docked',
    project: input?.project === 'floating' ? 'floating' : 'docked',
  }
}

const panelPlacement = computed<PanelPlacementState>(() => {
  const source = (sceneStore.$state as unknown as PanelPlacementHolder).panelPlacement ??
    (sceneStore as unknown as PanelPlacementHolder).panelPlacement ??
    null
  return normalizePanelPlacementState(source)
})

const isSceneManagerOpen = ref(false)
const isExportDialogOpen = ref(false)
const isExporting = ref(false)
const exportProgress = ref(0)
const exportProgressMessage = ref('')
const exportErrorMessage = ref<string | null>(null)
const exportDialogFileName = ref('scene')
const exportPreferences = ref<SceneExportOptions>({
  fileName: 'scene',
  includeTextures: true,
  includeAnimations: true,
  includeSkybox: true,
  includeLights: true,
  includeHiddenNodes: true,
  includeSkeletons: true,
  includeExtras: true,
  rotateCoordinateSystem: true,
  lazyLoadMeshes: true,
  format: 'json',
})
const exportSummaryLoading = ref(false)
const exportResourceSummary = ref<SceneResourceSummary | null>(null)
let pendingExportSummary: Promise<SceneResourceSummary | null> | null = null
const viewportRef = ref<SceneViewportHandle | null>(null)
const isNewSceneDialogOpen = ref(false)
const showStatsPanel = ref(true)
const sceneImportInputRef = ref<HTMLInputElement | null>(null)
const isImportingScenes = ref(false)
const isSceneBundleExporting = ref(false)
const externalSceneInputRef = ref<HTMLInputElement | null>(null)
const isImportingExternalScene = ref(false)

type InspectorPanelPublicInstance = InstanceType<typeof InspectorPanel> & {
  getPanelRect: () => DOMRect | null
  closeMaterialDetails: (options?: { silent?: boolean }) => void
  closeBehaviorDetails: (options?: { silent?: boolean }) => void
}

type InspectorPanelSource = 'docked' | 'floating'

type MaterialDetailsSource = InspectorPanelSource
type BehaviorDetailsSource = InspectorPanelSource

type MaterialDetailsAnchor = {
  top: number
  left: number
}

const dockedInspectorRef = ref<InspectorPanelPublicInstance | null>(null)
const floatingInspectorRef = ref<InspectorPanelPublicInstance | null>(null)

const materialDetailsState = reactive({
  visible: false,
  targetId: null as string | null,
  anchor: null as MaterialDetailsAnchor | null,
  source: null as MaterialDetailsSource | null,
})

type BehaviorDetailsAnchor = {
  top: number
  left: number
}

type BehaviorDetailsContext = {
  mode: 'create' | 'edit'
  action: BehaviorEventType
  sequence: SceneBehavior[]
  actions: BehaviorActionDefinition[]
  sequenceId: string
  nodeId: string | null
}

function formatByteSize(value: number | null | undefined): string {
  if (!value || value <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  const digits = index === 0 ? 0 : size >= 100 ? 0 : size >= 10 ? 1 : 2
  return `${size.toFixed(digits)} ${units[index]}`
}

async function refreshExportSummary(force = false): Promise<SceneResourceSummary | null> {
  if (!force && exportResourceSummary.value && !pendingExportSummary) {
    return exportResourceSummary.value
  }

  if (pendingExportSummary) {
    return pendingExportSummary
  }

  if (force) {
    exportResourceSummary.value = null
  }
  exportSummaryLoading.value = true

  pendingExportSummary = (async () => {
    try {
      const snapshot = sceneStore.createSceneDocumentSnapshot() as StoredSceneDocument
      const {packageAssetMap, assetIndex} = await buildPackageAssetMapForExport(snapshot, { embedResources: true })
      snapshot.packageAssetMap = packageAssetMap
      snapshot.assetIndex = assetIndex
      const summary = await calculateSceneResourceSummary(snapshot, { embedResources: true })
      snapshot.resourceSummary = summary
      exportResourceSummary.value = summary
      return summary
    } catch (error) {
      console.warn('Failed to calculate resource summary', error)
      exportResourceSummary.value = null
      return null
    } finally {
      exportSummaryLoading.value = false
    }
  })()

  try {
    return await pendingExportSummary
  } finally {
    pendingExportSummary = null
  }
}

const behaviorDetailsState = reactive({
  visible: false,
  anchor: null as BehaviorDetailsAnchor | null,
  source: null as BehaviorDetailsSource | null,
  context: null as BehaviorDetailsContext | null,
})

const behaviorScriptOptions = listBehaviorScripts()


const hierarchyOpen = computed({
  get: () => panelVisibility.value.hierarchy,
  set: (visible: boolean) => sceneStore.setPanelVisibility('hierarchy', visible),
})

const inspectorOpen = computed({
  get: () => panelVisibility.value.inspector,
  set: (visible: boolean) => sceneStore.setPanelVisibility('inspector', visible),
})

const projectOpen = computed({
  get: () => panelVisibility.value.project,
  set: (visible: boolean) => sceneStore.setPanelVisibility('project', visible),
})

const hierarchyPlacement = computed(() => panelPlacement.value.hierarchy)
const inspectorPlacement = computed(() => panelPlacement.value.inspector)
const projectPlacement = computed(() => panelPlacement.value.project)

const showHierarchyDocked = computed(() => hierarchyOpen.value && hierarchyPlacement.value === 'docked')
const showInspectorDocked = computed(() => inspectorOpen.value && inspectorPlacement.value === 'docked')
const showProjectDocked = computed(() => projectOpen.value && projectPlacement.value === 'docked')

const showHierarchyFloating = computed(() => hierarchyOpen.value && hierarchyPlacement.value === 'floating')
const showInspectorFloating = computed(() => inspectorOpen.value && inspectorPlacement.value === 'floating')
const showProjectFloating = computed(() => projectOpen.value && projectPlacement.value === 'floating')

const layoutClasses = computed(() => ({
  'is-hierarchy-docked': showHierarchyDocked.value,
  'is-inspector-docked': showInspectorDocked.value,
  'is-project-docked': showProjectDocked.value,
}))

const layoutStyles = computed(() => ({
  gridTemplateColumns: [
    showHierarchyDocked.value ? 'minmax(0, 280px)' : '0',
    'minmax(0, 1fr)',
    showInspectorDocked.value ? 'minmax(0, 320px)' : '0',
  ].join(' '),
  gridTemplateRows: [
    'auto',
    'minmax(0, 1fr)',
    showProjectDocked.value ? 'minmax(0, 260px)' : '0',
  ].join(' '),
}))

const reopenButtons = computed(() => ({
  showHierarchy: !panelVisibility.value.hierarchy,
  showInspector: !panelVisibility.value.inspector,
  showProject: !panelVisibility.value.project,
}))

onMounted(async () => {
})

function setTool(tool: EditorTool) {
  sceneStore.setActiveTool(tool)
}

type ViewportSelectionPayload = { primaryId: string | null; selectedIds: string[] }

function handleViewportSelection(payload: ViewportSelectionPayload) {
  if (!payload || !Array.isArray(payload.selectedIds)) {
    return
  }
  sceneStore.setSelection(payload.selectedIds, { primaryId: payload.primaryId ?? null })
}

type ViewportTransformPayload = TransformUpdatePayload | TransformUpdatePayload[]

function handleViewportTransform(payload: ViewportTransformPayload) {
  if (Array.isArray(payload)) {
    sceneStore.updateNodePropertiesBatch(payload)
    return
  }

  if (payload.position && payload.rotation && payload.scale) {
    sceneStore.updateNodeTransform({
      id: payload.id,
      position: payload.position,
      rotation: payload.rotation,
      scale: payload.scale,
    })
    return
  }

  sceneStore.updateNodeProperties(payload)
}

function updateCamera(state: SceneCameraState) {
  sceneStore.setCameraState(state)
}

function reopenPanel(panel: EditorPanel) {
  sceneStore.setPanelVisibility(panel, true)
}

function togglePanelPlacement(panel: EditorPanel) {
  const current = panelPlacement.value[panel]
  const next: 'docked' | 'floating' = current === 'floating' ? 'docked' : 'floating'
  sceneStore.$patch((draft) => {
    const typedState = draft as unknown as PanelPlacementHolder
    const current = normalizePanelPlacementState(typedState.panelPlacement ?? panelPlacement.value)
    typedState.panelPlacement = {
      ...current,
      [panel]: next,
    }
  })
}

function getInspectorRef(source: InspectorPanelSource) {
  return source === 'docked' ? dockedInspectorRef.value : floatingInspectorRef.value
}

function updateMaterialDetailsAnchor() {
  if (!materialDetailsState.visible || !materialDetailsState.source) {
    materialDetailsState.anchor = null
    return
  }
  const inspector = getInspectorRef(materialDetailsState.source)
  const rect = inspector?.getPanelRect?.() ?? null
  if (!rect) {
    materialDetailsState.anchor = null
    return
  }
  materialDetailsState.anchor = { top: rect.top, left: rect.left }
}

function handleInspectorMaterialDetailsOpen(source: MaterialDetailsSource, payload: { id: string }) {
  if (behaviorDetailsState.visible) {
    handleBehaviorDetailsOverlayClose()
  }
  materialDetailsState.source = source
  materialDetailsState.targetId = payload.id
  materialDetailsState.visible = true
  nextTick(() => {
    updateMaterialDetailsAnchor()
  })
}

function handleInspectorMaterialDetailsClose(source: MaterialDetailsSource) {
  if (materialDetailsState.source !== source) {
    return
  }
  materialDetailsState.visible = false
  materialDetailsState.targetId = null
  materialDetailsState.anchor = null
  materialDetailsState.source = null
}

function handleMaterialDetailsOverlayClose() {
  const source = materialDetailsState.source
  materialDetailsState.visible = false
  materialDetailsState.targetId = null
  materialDetailsState.anchor = null
  materialDetailsState.source = null
  if (source) {
    const inspector = getInspectorRef(source)
    inspector?.closeMaterialDetails?.({ silent: true })
  }
}

function getBehaviorComponent(): SceneNodeComponentState<BehaviorComponentProps> | null {
  const node = selectedNode.value
  if (!node) {
    return null
  }
  const component = node.components?.[BEHAVIOR_COMPONENT_TYPE]
  return (component as SceneNodeComponentState<BehaviorComponentProps> | undefined) ?? null
}

function updateBehaviorDetailsAnchor() {
  if (!behaviorDetailsState.visible || !behaviorDetailsState.source) {
    behaviorDetailsState.anchor = null
    return
  }
  const inspector = getInspectorRef(behaviorDetailsState.source)
  const rect = inspector?.getPanelRect?.() ?? null
  behaviorDetailsState.anchor = rect ? { top: rect.top, left: rect.left } : null
}

function handleInspectorBehaviorDetailsOpen(source: BehaviorDetailsSource, payload: BehaviorDetailsContext) {
  if (materialDetailsState.visible) {
    handleMaterialDetailsOverlayClose()
  }
  behaviorDetailsState.source = source
  behaviorDetailsState.context = {
    ...payload,
    actions: payload.actions.slice(),
    sequence: cloneBehaviorList(payload.sequence),
    nodeId: payload.nodeId,
  }
  behaviorDetailsState.visible = true
  nextTick(() => {
    updateBehaviorDetailsAnchor()
  })
}

function handleInspectorBehaviorDetailsClose(source: BehaviorDetailsSource) {
  if (behaviorDetailsState.source !== source) {
    return
  }
  behaviorDetailsState.visible = false
  behaviorDetailsState.anchor = null
  behaviorDetailsState.source = null
  behaviorDetailsState.context = null
}

function handleBehaviorDetailsOverlayClose() {
  const source = behaviorDetailsState.source
  behaviorDetailsState.visible = false
  behaviorDetailsState.anchor = null
  behaviorDetailsState.source = null
  behaviorDetailsState.context = null
  if (source) {
    const inspector = getInspectorRef(source)
    inspector?.closeBehaviorDetails?.({ silent: true })
  }
}

function handleBehaviorDetailsSave(payload: { action: BehaviorEventType; sequence: SceneBehavior[] }) {
  const component = getBehaviorComponent()
  const nodeId = selectedNodeId.value
  const context = behaviorDetailsState.context
  if (!component || !nodeId || !context) {
    return
  }
  const props = component.props as BehaviorComponentProps | undefined
  const source = props?.behaviors
  const currentList = cloneBehaviorList(Array.isArray(source) ? source : behaviorMapToList(source))
  const existingSequenceId = context.sequenceId
  const requestedSequenceId = payload.sequence[0]?.sequenceId
  const sequenceId = requestedSequenceId && requestedSequenceId.trim().length
    ? requestedSequenceId
    : existingSequenceId || createBehaviorSequenceId()

  const others = existingSequenceId
    ? currentList.filter((step) => step.sequenceId !== existingSequenceId)
    : currentList.slice()

  if (payload.action !== 'perform') {
    const conflict = others.some((step) => step.action === payload.action && step.sequenceId !== sequenceId)
    if (conflict) {
      const definition = findBehaviorAction(payload.action)
      const label = definition?.label ?? payload.action
      console.warn(`Behavior action "${label}" already exists on this node.`)
      return
    }
  }

  const insertionIndex = existingSequenceId
    ? currentList.findIndex((step) => step.sequenceId === existingSequenceId)
    : others.length
  const safeIndex = insertionIndex === -1 ? others.length : insertionIndex

  const normalized = payload.sequence.map((step) => ({
    ...cloneBehavior(step),
    id: step.id && step.id.trim().length ? step.id : generateUuid(),
    action: payload.action,
    sequenceId,
    script: ensureBehaviorParams(step.script),
  }))

  const nextList = others.slice()
  nextList.splice(safeIndex, 0, ...normalized)

  sceneStore.updateNodeComponentProps(nodeId, component.id, {
    behaviors: cloneBehaviorList(nextList),
  })

  if (context) {
    context.mode = 'edit'
    context.action = payload.action
    context.sequenceId = sequenceId
    context.sequence = cloneBehaviorList(normalized)
  }
}

const handleMaterialDetailsRelayout = () => {
  updateMaterialDetailsAnchor()
}

const handleBehaviorDetailsRelayout = () => {
  updateBehaviorDetailsAnchor()
}

watch(
  () => materialDetailsState.visible,
  (visible) => {
    if (visible) {
      updateMaterialDetailsAnchor()
      window.addEventListener('resize', handleMaterialDetailsRelayout)
      window.addEventListener('scroll', handleMaterialDetailsRelayout, true)
    } else {
      window.removeEventListener('resize', handleMaterialDetailsRelayout)
      window.removeEventListener('scroll', handleMaterialDetailsRelayout, true)
    }
  },
  { immediate: false },
)

watch(
  () => behaviorDetailsState.visible,
  (visible) => {
    if (visible) {
      updateBehaviorDetailsAnchor()
      window.addEventListener('resize', handleBehaviorDetailsRelayout)
      window.addEventListener('scroll', handleBehaviorDetailsRelayout, true)
    } else {
      window.removeEventListener('resize', handleBehaviorDetailsRelayout)
      window.removeEventListener('scroll', handleBehaviorDetailsRelayout, true)
    }
  },
)

watch(showInspectorDocked, (visible) => {
  if (materialDetailsState.source !== 'docked') {
    return
  }
  if (!visible) {
    handleInspectorMaterialDetailsClose('docked')
    return
  }
  nextTick(() => {
    updateMaterialDetailsAnchor()
  })
})

watch(showInspectorFloating, (visible) => {
  if (materialDetailsState.source !== 'floating') {
    return
  }
  if (!visible) {
    handleInspectorMaterialDetailsClose('floating')
    return
  }
  nextTick(() => {
    updateMaterialDetailsAnchor()
  })
})

watch(showInspectorDocked, (visible) => {
  if (behaviorDetailsState.source !== 'docked') {
    return
  }
  if (!visible) {
    handleInspectorBehaviorDetailsClose('docked')
    return
  }
  nextTick(() => {
    updateBehaviorDetailsAnchor()
  })
})

watch(showInspectorFloating, (visible) => {
  if (behaviorDetailsState.source !== 'floating') {
    return
  }
  if (!visible) {
    handleInspectorBehaviorDetailsClose('floating')
    return
  }
  nextTick(() => {
    updateBehaviorDetailsAnchor()
  })
})

function openNewSceneDialog(source: 'menu' | 'scene-manager') {
  if (source === 'scene-manager') {
    isSceneManagerOpen.value = false
  }
  isNewSceneDialogOpen.value = true
}

function handleNewAction() {
  openNewSceneDialog('menu')
}

function handleOpenAction() {
  isSceneManagerOpen.value = true
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.style.display = 'none'
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  requestAnimationFrame(() => URL.revokeObjectURL(url))
}


async function captureViewportScreenshot(): Promise<Blob | null> {
  const viewport = viewportRef.value
  if (!viewport) {
    console.warn('Scene viewport unavailable for screenshot capture')
    return null
  }
  try {
    return await viewport.captureScreenshot()
  } catch (error) {
    console.warn('Failed to capture scene screenshot', error)
    return null
  }
}


function openExportDialog() {
  const rawName = sceneStore.currentSceneMeta?.name ?? 'scene'
  const trimmed = rawName.trim()
  exportDialogFileName.value = sanitizeExportFileName(trimmed || 'scene')
  exportProgress.value = 0
  exportProgressMessage.value = ''
  exportErrorMessage.value = null
  exportResourceSummary.value = null
  void refreshExportSummary(true)
  isExportDialogOpen.value = true
}

function sanitizeExportFileName(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    return 'scene'
  }
  const withoutExtension = trimmed.replace(/\.(glb|json)$/i, '')
  return withoutExtension || 'scene'
}

type SceneExportWorkflowConfig = {
  action: 'export' | 'publish'
  startMessage: string
  successMessage: string
  failureMessage: string
  afterExport: (context: {
    blob: Blob
    fileName: string
    updateProgress: (value: number, message?: string) => void
  }) => Promise<void>
}

type SceneMetaShape = {
  name?: string | null
  description?: string | null
  metadata?: unknown
} | null

function getCurrentSceneMeta(): SceneMetaShape {
  const source = sceneStore as unknown as { currentSceneMeta?: SceneMetaShape }
  return source.currentSceneMeta ?? null
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function extractPublishableMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function resolvePublishName(fallbackFileName: string): string {
  const metaName = normalizeOptionalString(getCurrentSceneMeta()?.name)
  if (metaName) {
    return metaName
  }
  const sanitized = sanitizeExportFileName(fallbackFileName)
  return sanitized || 'scene'
}

async function runSceneExportWorkflow(options: SceneExportOptions, config: SceneExportWorkflowConfig): Promise<boolean> {
  if (isExporting.value) {
    return false
  }

  const viewport = viewportRef.value
  if (!viewport) {
    console.warn('Scene viewport unavailable for export')
    exportErrorMessage.value = 'Unable to access the scene viewport; export was cancelled.'
    return false
  }

  if (options.format === 'json') {
    const summary = await refreshExportSummary(true)
    const sizeLabel = summary ? formatByteSize(summary.totalBytes) : null
    const confirmMessage = summary
      ? `导出该场景需要打包约 ${sizeLabel} 的资源，是否继续？`
      : '暂时无法计算资源总大小，仍要继续导出吗？'
    const proceed = typeof window !== 'undefined' ? window.confirm(confirmMessage) : true
    if (!proceed) {
      exportProgress.value = 0
      exportProgressMessage.value = ''
      exportErrorMessage.value = null
      return false
    }
  }

  isExporting.value = true
  exportErrorMessage.value = null
  exportProgress.value = 5
  exportProgressMessage.value = config.startMessage

  const { fileName, ...preferenceSnapshot } = options
  exportPreferences.value = { fileName, ...preferenceSnapshot }

  let workflowSucceeded = false
  const updateProgress = (value: number, message?: string) => {
    if (Number.isFinite(value)) {
      exportProgress.value = Math.min(Math.max(value, 0), 100)
    }
    if (message) {
      exportProgressMessage.value = message
    }
  }

  try {
    const blob = await viewport.exportScene(options, (progress, message) => {
      const label = message ?? `${config.action === 'publish' ? 'Publish' : 'Export'} progress ${Math.round(progress)}%`
      updateProgress(progress, label)
    })
    await config.afterExport({ blob, fileName, updateProgress })
    updateProgress(100, config.successMessage)
    workflowSucceeded = true
    return true
  } catch (error) {
    const message = (error as Error)?.message ?? config.failureMessage
    exportErrorMessage.value = message
    exportProgressMessage.value = message
    console.error(`Scene ${config.action} failed`, error)
    return false
  } finally {
    isExporting.value = false
    if (workflowSucceeded) {
      setTimeout(() => {
        isExportDialogOpen.value = false
        exportProgress.value = 0
        exportProgressMessage.value = ''
      }, 600)
    }
  }
}

async function handleExportDialogConfirm(options: SceneExportOptions) {
  await runSceneExportWorkflow(options, {
    action: 'export',
    startMessage: 'Preparing export...',
    successMessage: 'Export complete',
    failureMessage: 'Export failed',
    afterExport: async ({ blob, fileName }) => {
      triggerDownload(blob, fileName)
    },
  })
}

async function handleExportDialogPublish(options: SceneExportOptions) {
  await runSceneExportWorkflow(options, {
    action: 'publish',
    startMessage: 'Preparing publish...',
    successMessage: 'Publish complete',
    failureMessage: 'Publish failed',
    afterExport: async ({ blob, fileName, updateProgress }) => {
      updateProgress(85, 'Uploading scene…')
      const meta = getCurrentSceneMeta()
      const description = normalizeOptionalString(meta?.description)
      const metadata = extractPublishableMetadata(meta?.metadata)
      await publishScene({
        name: resolvePublishName(fileName),
        description: description ?? undefined,
        metadata: metadata ?? undefined,
        file: blob,
        fileName,
        mimeType: options.format === 'glb' ? 'model/gltf-binary' : 'application/json',
      })
      updateProgress(95, 'Finalizing publish…')
    },
  })
}

function handleExportDialogCancel() {
  exportProgress.value = 0
  exportProgressMessage.value = ''
  exportErrorMessage.value = null
}

watch(isExportDialogOpen, (open) => {
  if (!open && !isExporting.value) {
    exportProgress.value = 0
    exportProgressMessage.value = ''
    exportErrorMessage.value = null
  }
})

function toggleStatsPanelVisibility() {
  showStatsPanel.value = !showStatsPanel.value
}

async function handlePreview() {
  const saved = await saveCurrentScene()
  if (!saved) {
    return
  }

  if (typeof window === 'undefined') {
    return
  }

  const currentUrl = new URL(window.location.href)
  currentUrl.hash = '#/preview'
  window.open(currentUrl.toString(), '_blank', 'noopener')
}

let pendingSceneSave: Promise<boolean> | null = null

const SCENE_PREVIEW_EXPORT_OPTIONS: SceneExportOptions = {
  format: 'json',
  fileName: 'preview',
  includeTextures: true,
  includeAnimations: true,
  includeSkybox: true,
  includeLights: true,
  includeHiddenNodes: true,
  includeSkeletons: true,
  includeExtras: true,
  rotateCoordinateSystem: false,
  lazyLoadMeshes: true,
}

let lastPreviewBroadcastRevision = 0

async function broadcastScenePreview(document:StoredSceneDocument) {
  try {
    
    const exportDocument = await prepareJsonSceneExport(document, SCENE_PREVIEW_EXPORT_OPTIONS)

    let revision = Date.now()
    if (revision <= lastPreviewBroadcastRevision) {
      revision = lastPreviewBroadcastRevision + 1
    }
    lastPreviewBroadcastRevision = revision
    broadcastScenePreviewUpdate({
      revision,
      document: exportDocument,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.warn('[SceneStore] Failed to broadcast preview update', error)
  }
}

async function saveCurrentScene(): Promise<boolean> {
  if (pendingSceneSave) {
    return pendingSceneSave
  }

  const sceneId = sceneStore.currentSceneId
  if (!sceneId) {
    console.warn('No active scene to save')
    return true
  }

  pendingSceneSave = (async () => {
    try {
      viewportRef.value?.captureThumbnail()
      const document = await sceneStore.saveActiveScene({force: true})
      if (document) {
        const {packageAssetMap, assetIndex} = await buildPackageAssetMapForExport(document,{embedResources:true})
        document.packageAssetMap = packageAssetMap
        document.assetIndex = assetIndex
        document.resourceSummary = await calculateSceneResourceSummary(document, { embedResources: true })
        broadcastScenePreview(document)
      }
      return true
    } catch (error) {
      console.error('Failed to save current scene', error)
      return false
    } finally {
      pendingSceneSave = null
    }
  })()

  return pendingSceneSave
}

async function exportCurrentScene() {
  const currentSceneId = sceneStore.currentSceneId
  if (!currentSceneId) {
    console.warn('No current scene to save')
    return
  }

  await saveCurrentScene()
  const bundle = await sceneStore.exportSceneBundle([currentSceneId])
  if (!bundle || !bundle.scenes.length) {
    console.warn('Failed to export current scene')
    return
  }

  const json = JSON.stringify(bundle.scenes[0], null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const sceneName = sceneStore.currentSceneMeta?.name ?? 'scene'
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const link = document.createElement('a')
  link.href = url
  link.download = `${sceneName}-${timestamp}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

async function handleAction(action: string) {
  switch (action) {
    case 'New':
      handleNewAction()
      break
    case 'Open':
      handleOpenAction()
      break
    case 'Import':
      requestExternalSceneImport()
      break
    case 'Save':
      await saveCurrentScene()
      break
    case 'SaveAs': {
      await exportCurrentScene()
      break
    }
    case 'Preview':
      await handlePreview()
      break
    case 'Undo': {
      if (sceneStore.canUndo) {
        await sceneStore.undo()
      }
      break
    }
    case 'Redo': {
      if (sceneStore.canRedo) {
        await sceneStore.redo()
      }
      break
    }
    case 'Copy': {
      sceneStore.copyNodes(sceneStore.selectedNodeIds)
      break
    }
    case 'Cut': {
      sceneStore.cutNodes(sceneStore.selectedNodeIds)
      break
    }
    case 'Paste': {
      await sceneStore.pasteClipboard(sceneStore.selectedNodeId)
      break
    }
    case 'Delete': {
      sceneStore.removeSceneNodes(sceneStore.selectedNodeIds)
      break
    }
    case 'Select All': {
      sceneStore.selectAllNodes()
      break
    }
    case 'Deselect All': {
      sceneStore.clearSelection()
      break
    }
    case 'Export':
    case 'Export:GLB': {
      openExportDialog()
      break
    }
    default:
      console.warn(`Unknown menu action: ${action}`)
  }
}
async function handleCreateScene(payload: {
  name: string
  groundWidth: number
  groundDepth: number
  presetSceneId?: string | null
  presetSceneDocument?: PresetSceneDocument | null
}) {
  const saved = await saveCurrentScene()
  if (!saved) {
    return
  }

  try {
    if (payload.presetSceneDocument) {
      await sceneStore.createSceneFromTemplate(payload.name, payload.presetSceneDocument, {
        groundWidth: payload.groundWidth,
        groundDepth: payload.groundDepth,
      })
    } else {
      await sceneStore.createScene(payload.name, {
        groundSettings: {
          width: payload.groundWidth,
          depth: payload.groundDepth,
        },
      })
    }
  } catch (error) {
    console.error('[EditorView] failed to create scene', error)
    return
  }

  isNewSceneDialogOpen.value = false
}

function handleSceneManagerCreateRequest() {
  openNewSceneDialog('scene-manager')
}

async function handleSelectScene(sceneId: string) {
  if (sceneId !== sceneStore.currentSceneId) {
    const saved = await saveCurrentScene()
    if (!saved) {
      return
    }
  }
  const changed = await sceneStore.selectScene(sceneId)
  if (changed) {
    isSceneManagerOpen.value = false
  }
}

async function handleDeleteScene(sceneId: string) {
  await sceneStore.deleteScene(sceneId)
}

async function handleRenameScene(payload: { id: string; name: string }) {
  await sceneStore.renameScene(payload.id, payload.name)
}

function handleSceneManagerImportRequest() {
  if (isImportingScenes.value) {
    return
  }
  const input = sceneImportInputRef.value
  if (!input) {
    console.warn('Import input element not available')
    return
  }
  input.value = ''
  input.click()
}

async function handleSceneImportFileChange(event: Event) {
  const input = (event.target as HTMLInputElement | null) ?? sceneImportInputRef.value
  const file = input?.files?.[0] ?? null
  if (!input || !file || isImportingScenes.value) {
    if (input) {
      input.value = ''
    }
    return
  }
  isImportingScenes.value = true
  uiStore.showLoadingOverlay({
    title: '导入场景',
    message: '读取文件…',
    mode: 'determinate',
    progress: 5,
    closable: false,
    autoClose: false,
  })

  try {
    const text = await readSceneFileAsText(file, (percent) => {
      const progress = 5 + Math.round((percent / 100) * 35)
      uiStore.updateLoadingProgress(Math.min(progress, 45))
    })

    uiStore.updateLoadingOverlay({ message: '解析数据…' })
    uiStore.updateLoadingProgress(55)

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new Error('文件格式错误: 无法解析 JSON')
    }

    uiStore.updateLoadingOverlay({ message: '验证场景数据…' })
    uiStore.updateLoadingProgress(65)

    const bundle = normalizeSceneBundle(parsed)

    uiStore.updateLoadingOverlay({ message: '导入场景…' })
    uiStore.updateLoadingProgress(80)

  const result = await sceneStore.importSceneBundle(bundle)
    const importedCount = result.importedSceneIds.length
    const renameCount = result.renamedScenes.length
    let message = `成功导入 ${importedCount} 个场景`
    if (renameCount) {
      message += `，已自动重命名 ${renameCount} 个重名场景`
    }

    uiStore.updateLoadingOverlay({
      title: '导入场景',
      message,
      closable: true,
      autoClose: true,
      autoCloseDelay: 1200,
    })
    uiStore.updateLoadingProgress(100, { autoClose: true, autoCloseDelay: 1200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '导入失败'
    uiStore.updateLoadingOverlay({
      title: '导入场景',
      message,
      closable: true,
      autoClose: false,
    })
    uiStore.updateLoadingProgress(100, { autoClose: false })
  } finally {
    input.value = ''
    isImportingScenes.value = false
  }
}

async function handleSceneManagerExport(sceneIds: string[]) {
  if (!sceneIds.length || isSceneBundleExporting.value) {
    return
  }
  isSceneBundleExporting.value = true
  uiStore.showLoadingOverlay({
    title: '导出场景',
    message: '准备导出…',
    mode: 'determinate',
    progress: 5,
    closable: false,
    autoClose: false,
  })

  try {
    const bundle = await sceneStore.exportSceneBundle(sceneIds)
    if (!bundle || !bundle.scenes.length) {
      throw new Error('没有可导出的场景')
    }

    uiStore.updateLoadingOverlay({ message: '整理场景数据…' })
    uiStore.updateLoadingProgress(40)

    const json = JSON.stringify(bundle, null, 2)

    uiStore.updateLoadingOverlay({ message: '生成导出文件…' })
    uiStore.updateLoadingProgress(70)

    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const link = document.createElement('a')
    link.href = url
    link.download = `scenes-${timestamp}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    uiStore.updateLoadingOverlay({
      title: '导出场景',
      message: '导出完成',
      closable: true,
      autoClose: true,
      autoCloseDelay: 800,
    })
    uiStore.updateLoadingProgress(100, { autoClose: true, autoCloseDelay: 800 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '导出失败'
    uiStore.updateLoadingOverlay({
      title: '导出场景',
      message,
      closable: true,
      autoClose: false,
    })
    uiStore.updateLoadingProgress(100, { autoClose: false })
  } finally {
    isSceneBundleExporting.value = false
  }
}

function requestExternalSceneImport() {
  if (isImportingExternalScene.value) {
    return
  }
  const input = externalSceneInputRef.value
  if (!input) {
    console.warn('External scene import input element not available')
    return
  }
  input.value = ''
  input.click()
}

function computeImportDisplayName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed.length) {
    return 'Imported Scene'
  }
  const withoutExtension = trimmed.replace(/\.[^./\\]+$/, '')
  return withoutExtension.length ? withoutExtension : trimmed
}

async function loadExternalSceneFile(
  file: File,
  onProgress: (payload: LoaderProgressPayload) => void,
): Promise<Object3D> {
  return new Promise<Object3D>((resolve, reject) => {
    const loader = new Loader()

    const handleProgress = (payload: LoaderProgressPayload) => {
      onProgress(payload)
    }

    const handleLoaded = (payload: unknown) => {
      cleanup()
      const object = payload as Object3D | null
      if (object && (object as { isObject3D?: boolean }).isObject3D) {
        resolve(object)
        return
      }
      reject(new Error('导入失败：未识别的场景数据'))
    }

    const cleanup = () => {
      loader.removeEventListener('progress', handleProgress)
      loader.removeEventListener('loaded', handleLoaded)
    }

    loader.addEventListener('progress', handleProgress)
    loader.addEventListener('loaded', handleLoaded)

    try {
      loader.loadFile(file)
    } catch (error) {
      cleanup()
      reject(error instanceof Error ? error : new Error('导入失败：无法读取文件'))
    }
  })
}

async function handleExternalSceneFileChange(event: Event) {
  const input = (event.target as HTMLInputElement | null) ?? externalSceneInputRef.value
  const file = input?.files?.[0] ?? null
  if (!input || !file || isImportingExternalScene.value) {
    if (input) {
      input.value = ''
    }
    return
  }

  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!['glb', 'gltf', 'fbx'].includes(extension)) {
    console.warn('Unsupported import format:', extension)
    input.value = ''
    return
  }

  isImportingExternalScene.value = true
  uiStore.showLoadingOverlay({
    title: '导入外部场景',
    message: '读取文件…',
    mode: 'determinate',
    progress: 5,
    closable: false,
    autoClose: false,
  })
  uiStore.updateLoadingProgress(5)

  try {
    const object = await loadExternalSceneFile(file, (payload) => {
      if (!payload) {
        return
      }
      const rawPercent = payload.total > 0 ? (payload.loaded / payload.total) * 65 : 15
      const bounded = Math.max(8, Math.min(70, Math.round(rawPercent)))
      uiStore.updateLoadingOverlay({
        message: `加载 ${payload.filename} (${bounded}%)`,
      })
      uiStore.updateLoadingProgress(bounded)
    })

    uiStore.updateLoadingOverlay({ message: '解析场景节点…' })
    uiStore.updateLoadingProgress(85)

    const importedIds = await sceneStore.importExternalSceneObject(object, {
      sourceName: computeImportDisplayName(file.name),
      sourceFile: file,
    })

    const summary = importedIds.length
      ? `已导入 ${importedIds.length} 个节点`
      : '文件未包含可导入的节点'

    uiStore.updateLoadingOverlay({
      message: summary,
      autoClose: true,
      autoCloseDelay: 800,
    })
    uiStore.updateLoadingProgress(100, { autoClose: true, autoCloseDelay: 800 })
  } catch (error) {
    const message = (error as Error)?.message ?? '导入失败'
    uiStore.updateLoadingOverlay({
      message: `导入失败：${message}`,
      closable: true,
      autoClose: false,
    })
    uiStore.updateLoadingProgress(100, { autoClose: false })
  } finally {
    isImportingExternalScene.value = false
    if (input) {
      input.value = ''
    }
  }
}

function readSceneFileAsText(file: File, onProgress?: (percent: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.onprogress = (event) => {
      if (onProgress && event.lengthComputable && event.total > 0) {
        const percent = (event.loaded / event.total) * 100
        onProgress(Math.min(Math.max(percent, 0), 100))
      }
    }
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '')
    }
    reader.readAsText(file)
  })
}

function normalizeSceneBundle(raw: unknown): SceneBundleImportPayload {
  if (Array.isArray(raw)) {
    return {
      formatVersion: SCENE_BUNDLE_FORMAT_VERSION,
      scenes: raw.map((entry, index) => normalizeSceneEntry(entry, index)),
    }
  }

  if (isPlainObject(raw)) {
    if (Array.isArray(raw.scenes)) {
      const versionRaw = raw.formatVersion
      const version = typeof versionRaw === 'number' ? versionRaw : Number(versionRaw)
      const formatVersion = Number.isFinite(version) ? version : SCENE_BUNDLE_FORMAT_VERSION
      return {
        formatVersion,
        scenes: raw.scenes.map((entry, index) => normalizeSceneEntry(entry, index)),
      }
    }

    if (Array.isArray(raw.nodes)) {
      return {
        formatVersion: SCENE_BUNDLE_FORMAT_VERSION,
        scenes: [normalizeSceneEntry(raw, 0)],
      }
    }
  }

  throw new Error('文件格式错误: 未找到场景数据')
}

function normalizeSceneEntry(entry: unknown, index: number): SceneBundleImportScene {
  if (!isPlainObject(entry)) {
    throw new Error(`文件格式错误: 第 ${index + 1} 个场景数据无效`)
  }
  if (!Array.isArray(entry.nodes)) {
    throw new Error(`文件格式错误: 第 ${index + 1} 个场景缺少 nodes 信息`)
  }
  return entry as SceneBundleImportScene
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return element.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function shouldHandleViewportShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return false
  if (isEditableKeyboardTarget(event.target)) return false
  return true
}

async function handleEditorViewShortcut(event: KeyboardEvent) {
  if (!shouldHandleViewportShortcut(event)) return
  let handled = false

  if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    switch (event.code) {
      case 'Delete':
        handleAction(event.code)
        handled = true
        break;
      default:
        break
    }
  }

  if (!handled && (event.ctrlKey || event.metaKey) && !event.altKey) {
    switch (event.code) {
      case 'KeyZ': {
        handled = event.shiftKey ? await sceneStore.redo() : await sceneStore.undo()
        break
      }
      case 'KeyY': {
        if (!event.shiftKey) {
          handled = await sceneStore.redo()
        }
        break
      }
      case 'KeyS': {
        if (!event.shiftKey) {
          await saveCurrentScene()
          handled = true
        }
        break
      }
      case 'KeyC': {
        if (!event.shiftKey) {
          handled = sceneStore.selectedNodeIds.length ? sceneStore.copyNodes(sceneStore.selectedNodeIds) : false
        }
        break
      }
      case 'KeyX': {
        if (!event.shiftKey) {
          handled = sceneStore.selectedNodeIds.length ? sceneStore.cutNodes(sceneStore.selectedNodeIds) : false
        }
        break
      }
      case 'KeyV': {
        if (!event.shiftKey) {
          handled = await sceneStore.pasteClipboard(sceneStore.selectedNodeId)
        }
        break
      }
      case 'KeyL': {
        if (event.shiftKey) {
          handled = sceneStore.toggleSelectionLock()
        }
        break
      }
      case 'KeyH': {
        if (event.shiftKey) {
          handled = sceneStore.toggleSelectionVisibility()
        }
        break
      }
      case 'KeyT': {
        if (event.shiftKey) {
          handled = sceneStore.toggleSelectionTransparency()
        }
        break
      }
      default:
        break
    }
  }

  if (handled) {
    event.preventDefault()
    event.stopPropagation()
  }
}

onMounted(() => {
  window.addEventListener('keyup', handleEditorViewShortcut, { capture: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('keyup', handleEditorViewShortcut, { capture: true })
  window.removeEventListener('resize', handleMaterialDetailsRelayout)
  window.removeEventListener('scroll', handleMaterialDetailsRelayout, true)
  window.removeEventListener('resize', handleBehaviorDetailsRelayout)
  window.removeEventListener('scroll', handleBehaviorDetailsRelayout, true)
})


</script>

<template>
  <div class="editor-view">
  <div class="editor-layout" :class="layoutClasses" :style="layoutStyles">
      <MenuBar 
        @menu-action="handleAction"
        :show-stats="showStatsPanel"
        @toggle-stats="toggleStatsPanelVisibility"
      />
      <transition name="slide-left">
        <section v-if="showHierarchyDocked" class="panel hierarchy-panel">
          <HierarchyPanel
            :floating="false"
            @collapse="hierarchyOpen = false"
            @toggle-placement="togglePanelPlacement('hierarchy')"
          />
        </section>
      </transition>

      <section class="scene-panel">
        <SceneViewport
          ref="viewportRef"
          :scene-nodes="sceneNodes"
          :active-tool="activeTool"
          :selected-node-id="selectedNodeId"
          :camera-state="camera"
          :focus-node-id="cameraFocusNodeId"
          :focus-request-id="cameraFocusRequestId"
          :highlight-node-id="nodeHighlightTargetId"
          :highlight-request-id="nodeHighlightRequestId"
          :show-stats="showStatsPanel"
          @change-tool="setTool"
          @select-node="handleViewportSelection"
          @update-node-transform="handleViewportTransform"
          @update-camera="updateCamera"
        />
      </section>

      <transition name="slide-right">
        <section v-if="showInspectorDocked" class="panel inspector-panel">
          <InspectorPanel
            ref="dockedInspectorRef"
            :floating="false"
            :capture-viewport-screenshot="captureViewportScreenshot"
            @collapse="inspectorOpen = false"
            @toggle-placement="togglePanelPlacement('inspector')"
            @open-material-details="(payload) => handleInspectorMaterialDetailsOpen('docked', payload)"
            @close-material-details="() => handleInspectorMaterialDetailsClose('docked')"
            @open-behavior-details="(payload) => handleInspectorBehaviorDetailsOpen('docked', payload)"
            @close-behavior-details="() => handleInspectorBehaviorDetailsClose('docked')"
          />
        </section>
      </transition>

      <transition name="slide-up">
        <section v-if="showProjectDocked" class="panel project-panel">
          <ProjectPanel
            :floating="false"
            :capture-viewport-screenshot="captureViewportScreenshot"
            @collapse="projectOpen = false"
            @toggle-placement="togglePanelPlacement('project')"
          />
        </section>
      </transition>

      <div class="floating-panels">
        <transition name="fade-down">
          <div v-if="showHierarchyFloating" class="floating-panel hierarchy-floating">
            <HierarchyPanel
              :floating="true"
              @collapse="hierarchyOpen = false"
              @toggle-placement="togglePanelPlacement('hierarchy')"
            />
          </div>
        </transition>
        <transition name="fade-down">
          <div v-if="showInspectorFloating" class="floating-panel inspector-floating">
            <InspectorPanel
              ref="floatingInspectorRef"
              :floating="true"
              :capture-viewport-screenshot="captureViewportScreenshot"
              @collapse="inspectorOpen = false"
              @toggle-placement="togglePanelPlacement('inspector')"
              @open-material-details="(payload) => handleInspectorMaterialDetailsOpen('floating', payload)"
              @close-material-details="() => handleInspectorMaterialDetailsClose('floating')"
              @open-behavior-details="(payload) => handleInspectorBehaviorDetailsOpen('floating', payload)"
              @close-behavior-details="() => handleInspectorBehaviorDetailsClose('floating')"
            />
          </div>
        </transition>
        <transition name="fade-up">
          <div v-if="showProjectFloating" class="floating-panel project-floating">
            <ProjectPanel
              :floating="true"
              :capture-viewport-screenshot="captureViewportScreenshot"
              @collapse="projectOpen = false"
              @toggle-placement="togglePanelPlacement('project')"
            />
          </div>
        </transition>
      </div>

      <v-btn
        v-if="reopenButtons.showHierarchy"
        class="edge-button left"
        color="primary"
        variant="flat"
        rounded
        icon="mdi-chevron-right"
        density="comfortable"
        @click="reopenPanel('hierarchy')"
      />

      <v-btn
        v-if="reopenButtons.showInspector"
        class="edge-button right"
        color="primary"
        variant="flat"
        rounded
        icon="mdi-chevron-left"
        density="comfortable"
        @click="reopenPanel('inspector')"
      />

      <v-btn
        v-if="reopenButtons.showProject"
        class="edge-button bottom"
        color="primary"
        variant="tonal"
        density="comfortable"
        @click="reopenPanel('project')"
      >
        <v-icon start>mdi-folder</v-icon>
        Project
      </v-btn>

      <BehaviorDetailsPanel
        v-if="behaviorDetailsState.visible && behaviorDetailsState.context && behaviorDetailsState.anchor"
        :visible="behaviorDetailsState.visible"
        :mode="behaviorDetailsState.context.mode"
        :action="behaviorDetailsState.context.action"
        :sequence="behaviorDetailsState.context.sequence"
        :actions="behaviorDetailsState.context.actions"
        :scripts="behaviorScriptOptions"
        :anchor="behaviorDetailsState.anchor"
        :node-id="behaviorDetailsState.context.nodeId"
        @close="handleBehaviorDetailsOverlayClose"
        @save="handleBehaviorDetailsSave"
      />

      <MaterialDetailsPanel
        v-if="materialDetailsState.visible && materialDetailsState.targetId && materialDetailsState.anchor"
        :node-material-id="materialDetailsState.targetId"
        :visible="materialDetailsState.visible"
        :anchor="materialDetailsState.anchor"
        @close="handleMaterialDetailsOverlayClose"
      />
    </div>
    <SceneManagerDialog
      v-model="isSceneManagerOpen"
      :scenes="sceneSummaries"
      :current-scene-id="currentSceneId"
      @select="handleSelectScene"
      @delete="handleDeleteScene"
      @rename="handleRenameScene"
      @request-new="handleSceneManagerCreateRequest"
      @import-scenes="handleSceneManagerImportRequest"
      @export-scenes="handleSceneManagerExport"
    />
    <input
      ref="sceneImportInputRef"
      type="file"
      accept="application/json"
      style="display: none"
      @change="handleSceneImportFileChange"
    />
    <input
      ref="externalSceneInputRef"
      type="file"
      accept=".glb,.gltf,.fbx"
      style="display: none"
      @change="handleExternalSceneFileChange"
    />
    <NewSceneDialog
      v-model="isNewSceneDialogOpen"
      :initial-ground-width="groundSettings.width"
      :initial-ground-depth="groundSettings.depth"
      @confirm="handleCreateScene"
    />
    <SceneExportDialog
      v-model="isExportDialogOpen"
      :default-file-name="exportDialogFileName"
      :initial-options="exportPreferences"
      :exporting="isExporting"
      :progress="exportProgress"
      :progress-message="exportProgressMessage"
      :error-message="exportErrorMessage"
      :resource-summary="exportResourceSummary"
      :resource-summary-loading="exportSummaryLoading"
      @confirm="handleExportDialogConfirm"
      @publish="handleExportDialogPublish"
      @cancel="handleExportDialogCancel"
    />
  </div>
</template>

<style scoped>
.editor-view {
  height: 100vh;
  width: 100%;
  background: radial-gradient(circle at top left, #21262d, #11141a 60%);
}

.preview-overlay-container {
  position: fixed;
  inset: 0;
  z-index: 30;
}

.editor-layout {
  position: relative;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 280px) minmax(0, 1fr) minmax(0, 320px);
  grid-template-rows: auto minmax(0, 1fr) minmax(0, 260px);
  grid-template-areas:
    'menu menu menu'
    'hierarchy scene inspector'
    'project project project';
  gap: 7px;
  padding: 12px;
  box-sizing: border-box;
  --floating-edge-gap: 18px;
  --floating-menu-offset: 68px;
  --viewport-gizmo-clearance: 50px;
  --hierarchy-floating-height: clamp(360px, 52vh, 580px);
  --inspector-floating-height: clamp(460px, 52vh, 680px);
  --project-floating-height: clamp(170px, 38vh, 220px);
}

.panel {
  min-height: 0;
  min-width: 0;
}

.hierarchy-panel {
  grid-area: hierarchy;
}

.floating-panels {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.floating-panel {
  position: absolute;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  max-height: calc(100% - (var(--floating-edge-gap) * 2));
}

.floating-panel :deep(.panel-card) {
  height: 100%;
}

.hierarchy-floating {
  top: calc(var(--floating-menu-offset) + var(--floating-edge-gap) + var(--viewport-gizmo-clearance));
  left: var(--floating-edge-gap);
  bottom: calc(var(--project-floating-height) + (var(--floating-edge-gap) * 2));
  width: min(260px, 40vw);
  max-height: var(--hierarchy-floating-height);
  min-height: 240px;
}

.inspector-floating {
  top: calc(var(--floating-menu-offset) + var(--floating-edge-gap) + var(--viewport-gizmo-clearance));
  right: var(--floating-edge-gap);
  bottom: calc(var(--project-floating-height) + (var(--floating-edge-gap) * 2));
  width: min(300px, 40vw);
  max-height: var(--inspector-floating-height);
  min-height: 240px;
}

.project-floating {
  left: var(--floating-edge-gap);
  right: var(--floating-edge-gap);
  bottom: var(--floating-edge-gap);
  height: var(--project-floating-height);
  max-height: var(--project-floating-height);
}

@media (max-width: 960px) {
  .editor-layout {
    gap: 10px;
    padding: 10px;
    --floating-menu-offset: 60px;
    --floating-edge-gap: 14px;
    --hierarchy-floating-height: clamp(240px, 48vh, 580px);
    --inspector-floating-height: clamp(340px, 48vh, 680px);
    --project-floating-height: clamp(220px, 42vh, 380px);
  }

  .hierarchy-floating,
  .inspector-floating {
    top: calc(var(--floating-menu-offset) + var(--floating-edge-gap) + var(--viewport-gizmo-clearance));
    width: min(220px, 88vw);
  }

  .project-floating {
    bottom: var(--floating-edge-gap);
    left: var(--floating-edge-gap);
    right: var(--floating-edge-gap);
  }
}

.scene-panel {
  grid-area: scene;
  min-height: 0;
  min-width: 0;
}

.inspector-panel {
  grid-area: inspector;
}

.project-panel {
  grid-area: project;
  grid-column: 1 / -1;
}

.edge-button {
  position: absolute;
  z-index: 10;
}

.edge-button.left {
  top: 50%;
  left: 8px;
  transform: translateY(-50%);
}

.edge-button.right {
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
}

.edge-button.bottom {
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
}

.slide-left-enter-active,
.slide-left-leave-active,
.slide-right-enter-active,
.slide-right-leave-active,
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 200ms ease;
}

.slide-left-enter-from,
.slide-left-leave-to {
  transform: translateX(-20px);
  opacity: 0;
}

.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(20px);
  opacity: 0;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(20px);
  opacity: 0;
}

.fade-down-enter-active,
.fade-down-leave-active,
.fade-up-enter-active,
.fade-up-leave-active {
  transition: all 180ms ease;
}

.fade-down-enter-from,
.fade-down-leave-to {
  transform: translateY(-12px);
  opacity: 0;
}

.fade-up-enter-from,
.fade-up-leave-to {
  transform: translateY(12px);
  opacity: 0;
}
</style>
