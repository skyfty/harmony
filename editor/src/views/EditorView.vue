<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import HierarchyPanel from '@/components/layout/HierarchyPanel.vue'
import InspectorPanel from '@/components/layout/InspectorPanel.vue'
import MaterialDetailsPanel from '@/components/inspector/MaterialDetailsPanel.vue'
import ProjectPanel from '@/components/layout/ProjectPanel.vue'
import SceneViewport, { type SceneViewportHandle } from '@/components/editor/SceneViewport.vue'
import PreviewOverlay from '@/components/layout/PreviewOverlay.vue'
import MenuBar from './MenuBar.vue'
import SceneManagerDialog from '@/components/layout/SceneManagerDialog.vue'
import NewSceneDialog from '@/components/layout/NewSceneDialog.vue'
import SceneExportDialog, {
  type SceneExportDialogOptions,
  type SceneExportDialogPayload,
} from '@/components/layout/SceneExportDialog.vue'
import {
  useSceneStore,
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
import Loader, { type LoaderProgressPayload } from '@/plugins/loader'
import type { Object3D } from 'three'

const sceneStore = useSceneStore()
const scenesStore = useScenesStore()
const uiStore = useUiStore()
const {
  nodes: sceneNodes,
  selectedNodeId,
  activeTool,
  camera,
  panelVisibility,
  currentSceneId,
  cameraFocusNodeId,
  cameraFocusRequestId,
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
const exportPreferences = ref<SceneExportDialogOptions>({
  includeTextures: true,
  includeAnimations: true,
  includeSkybox: true,
  includeLights: true,
  includeHiddenNodes: false,
  includeSkeletons: true,
  includeCameras: true,
  includeExtras: true,
})
const viewportRef = ref<SceneViewportHandle | null>(null)
const isNewSceneDialogOpen = ref(false)
const isPreviewing = ref(false)
const showStatsPanel = ref(true)
type PreviewCameraSeed = Pick<SceneCameraState, 'position' | 'target'>
type PreviewSessionState = {
  url: string
  sceneName: string
  cameraSeed: PreviewCameraSeed | null
}
const previewSession = ref<PreviewSessionState | null>(null)
const sceneImportInputRef = ref<HTMLInputElement | null>(null)
const isImportingScenes = ref(false)
const isSceneBundleExporting = ref(false)
const externalSceneInputRef = ref<HTMLInputElement | null>(null)
const isImportingExternalScene = ref(false)

type InspectorPanelPublicInstance = InstanceType<typeof InspectorPanel> & {
  getPanelRect: () => DOMRect | null
  closeMaterialDetails: (options?: { silent?: boolean }) => void
}

type MaterialDetailsSource = 'docked' | 'floating'

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
  await scenesStore.initialize()
  await sceneStore.ensureCurrentSceneLoaded()
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

function getInspectorRef(source: MaterialDetailsSource) {
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

const handleMaterialDetailsRelayout = () => {
  updateMaterialDetailsAnchor()
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
function openExportDialog() {
  const rawName = sceneStore.currentSceneMeta?.name ?? 'scene'
  const trimmed = rawName.trim()
  exportDialogFileName.value = trimmed || 'scene'
  exportProgress.value = 0
  exportProgressMessage.value = ''
  exportErrorMessage.value = null
  isExportDialogOpen.value = true
}

function sanitizeExportFileName(input: string): string {
  const trimmed = input.trim()
  return trimmed || 'scene'
}

async function handleExportDialogConfirm(payload: SceneExportDialogPayload) {
  if (isExporting.value) {
    return
  }

  const viewport = viewportRef.value
  if (!viewport) {
    console.warn('Scene viewport unavailable for export')
    exportErrorMessage.value = 'Unable to access the scene viewport; export was cancelled.'
    return
  }

  isExporting.value = true
  exportErrorMessage.value = null
  exportProgress.value = 5
  exportProgressMessage.value = 'Preparing export...'

  const { fileName, ...preferenceSnapshot } = payload
  exportPreferences.value = { ...preferenceSnapshot }

  let exportSucceeded = false

  try {
    await viewport.exportScene({
      format: 'GLB',
      fileName: sanitizeExportFileName(fileName),
      includeTextures: payload.includeTextures,
      includeAnimations: payload.includeAnimations,
      includeSkybox: payload.includeSkybox,
      includeLights: payload.includeLights,
      includeHiddenNodes: payload.includeHiddenNodes,
      includeSkeletons: payload.includeSkeletons,
      includeCameras: payload.includeCameras,
      includeExtras: payload.includeExtras,
      onProgress: (progress, message) => {
        exportProgress.value = progress
        exportProgressMessage.value = message ?? `Export progress ${Math.round(progress)}%`
      },
    })

    exportSucceeded = true
    exportProgress.value = 100
    exportProgressMessage.value = 'Export complete'
  } catch (error) {
    const message = (error as Error)?.message ?? 'Export failed'
    exportErrorMessage.value = message
    exportProgressMessage.value = message
    console.error('Scene export failed', error)
  } finally {
    isExporting.value = false
    if (exportSucceeded) {
      setTimeout(() => {
        isExportDialogOpen.value = false
        exportProgress.value = 0
        exportProgressMessage.value = ''
      }, 600)
    }
  }
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

function updatePreviewProgress(progress: number, message?: string) {
  const displayMessage = message ?? `Preparing preview ${Math.round(progress)}%`
  uiStore.updateLoadingOverlay({
    title: 'Preview Scene',
    message: displayMessage,
  })
  uiStore.updateLoadingProgress(progress, { autoClose: false })
}

function releasePreviewSession() {
  if (previewSession.value) {
    URL.revokeObjectURL(previewSession.value.url)
    previewSession.value = null
  }
}

function handlePreviewReady() {
  uiStore.updateLoadingOverlay({
    title: 'Preview Scene',
    message: 'Preview ready',
    mode: 'determinate',
    progress: 100,
    closable: true,
    autoClose: true,
    autoCloseDelay: 600,
  })
  uiStore.updateLoadingProgress(100, { autoClose: true, autoCloseDelay: 600 })
}

function handlePreviewError(message: string) {
  uiStore.updateLoadingOverlay({
    title: 'Preview Scene',
    message,
    mode: 'determinate',
    progress: 100,
    closable: true,
    autoClose: false,
  })
  uiStore.updateLoadingProgress(100, { autoClose: false })
}

function handlePreviewClose() {
  releasePreviewSession()
  uiStore.hideLoadingOverlay(true)
}

function toggleStatsPanelVisibility() {
  showStatsPanel.value = !showStatsPanel.value
}

async function handlePreview() {
  if (isPreviewing.value || previewSession.value) {
    return
  }

  const viewport = viewportRef.value
  if (!viewport) {
    console.warn('Scene viewport unavailable for preview')
    return
  }

  isPreviewing.value = true
  const sceneName = sceneStore.currentSceneMeta?.name ?? 'scene'
  uiStore.showLoadingOverlay({
    title: 'Preview Scene',
    message: 'Preparing preview…',
    mode: 'determinate',
    progress: 0,
    closable: false,
    autoClose: false,
  })

  let previewBlobUrl: string | null = null

  try {
    const { blob } = await viewport.generateSceneBlob({
      format: 'GLB',
      fileName: `${sceneName}-preview`,
      onProgress: updatePreviewProgress,
    })

    previewBlobUrl = URL.createObjectURL(blob)

    const cameraSeed: PreviewCameraSeed | null = sceneStore.camera
      ? {
          position: { ...sceneStore.camera.position },
          target: { ...sceneStore.camera.target },
        }
      : null

    previewSession.value = {
      url: previewBlobUrl,
      sceneName,
      cameraSeed,
    }
    previewBlobUrl = null

    uiStore.updateLoadingOverlay({
      title: 'Preview Scene',
      message: 'Loading preview scene…',
      mode: 'indeterminate',
      closable: false,
      autoClose: false,
    })
  } catch (error) {
    const message = (error as Error)?.message ?? 'Unknown error'
    if (previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl)
      previewBlobUrl = null
    }
    uiStore.updateLoadingOverlay({
      title: 'Preview Scene',
      message,
      closable: true,
      autoClose: false,
    })
    uiStore.updateLoadingProgress(100, { autoClose: false })
  } finally {
    isPreviewing.value = false
    if (previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl)
    }
  }
}

async function exportCurrentScene() {
  const currentSceneId = sceneStore.currentSceneId
  if (!currentSceneId) {
    console.warn('No current scene to save')
    return
  }

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
    case 'Save': {
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
      sceneStore.pasteClipboard(sceneStore.selectedNodeId)
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
async function handleCreateScene(payload: { name: string; groundWidth: number; groundDepth: number }) {
  await sceneStore.createScene(payload.name, {
    groundSettings: {
      width: payload.groundWidth,
      depth: payload.groundDepth,
    },
  })
  isNewSceneDialogOpen.value = false
}

function handleSceneManagerCreateRequest() {
  openNewSceneDialog('scene-manager')
}

async function handleSelectScene(sceneId: string) {
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
      loader.$off('progress', handleProgress)
      loader.$off('loaded', handleLoaded)
    }

    loader.$on('progress', handleProgress)
    loader.$on('loaded', handleLoaded)

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
  if (previewSession.value) return false
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
          handled = (sceneStore.clipboard?.entries.length ?? 0) > 0
            ? sceneStore.pasteClipboard(sceneStore.selectedNodeId)
            : false
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
  releasePreviewSession()
  window.removeEventListener('keyup', handleEditorViewShortcut, { capture: true })
  window.removeEventListener('resize', handleMaterialDetailsRelayout)
  window.removeEventListener('scroll', handleMaterialDetailsRelayout, true)
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
          :preview-active="!!previewSession"
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
            @collapse="inspectorOpen = false"
            @toggle-placement="togglePanelPlacement('inspector')"
            @open-material-details="(payload) => handleInspectorMaterialDetailsOpen('docked', payload)"
            @close-material-details="() => handleInspectorMaterialDetailsClose('docked')"
          />
        </section>
      </transition>

      <transition name="slide-up">
        <section v-if="showProjectDocked" class="panel project-panel">
          <ProjectPanel
            :floating="false"
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
              @collapse="inspectorOpen = false"
              @toggle-placement="togglePanelPlacement('inspector')"
              @open-material-details="(payload) => handleInspectorMaterialDetailsOpen('floating', payload)"
              @close-material-details="() => handleInspectorMaterialDetailsClose('floating')"
            />
          </div>
        </transition>
        <transition name="fade-up">
          <div v-if="showProjectFloating" class="floating-panel project-floating">
            <ProjectPanel
              :floating="true"
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
      @confirm="handleExportDialogConfirm"
      @cancel="handleExportDialogCancel"
    />
    <div v-if="previewSession" class="preview-overlay-container">
      <PreviewOverlay
        :src="previewSession.url"
        :scene-name="previewSession.sceneName"
        :camera-seed="previewSession.cameraSeed ?? undefined"
        @ready="handlePreviewReady"
        @error="handlePreviewError"
        @close="handlePreviewClose"
      />
    </div>
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
  top: calc(var(--floating-menu-offset) + var(--floating-edge-gap));
  left: var(--floating-edge-gap);
  bottom: calc(var(--project-floating-height) + (var(--floating-edge-gap) * 2));
  width: min(260px, 40vw);
  max-height: var(--hierarchy-floating-height);
  min-height: 240px;
}

.inspector-floating {
  top: calc(var(--floating-menu-offset) + var(--floating-edge-gap));
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
    top: calc(var(--floating-menu-offset) + var(--floating-edge-gap));
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
