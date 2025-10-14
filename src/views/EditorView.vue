<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import HierarchyPanel from '@/components/layout/HierarchyPanel.vue'
import InspectorPanel from '@/components/layout/InspectorPanel.vue'
import ProjectPanel from '@/components/layout/ProjectPanel.vue'
import SceneViewport, { type SceneViewportHandle } from '@/components/editor/SceneViewport.vue'
import MenuBar from './MenuBar.vue'
import SceneManagerDialog from '@/components/layout/SceneManagerDialog.vue'
import { useSceneStore, type EditorTool, type EditorPanel, type SceneCameraState } from '@/stores/sceneStore'
import { useUiStore } from '@/stores/uiStore'
import type { Vector3Like } from '@/types/scene'
import { type ExportFormat } from '@/plugins/exporter'

const sceneStore = useSceneStore()
const uiStore = useUiStore()
const {
  nodes: sceneNodes,
  selectedNodeId,
  activeTool,
  camera,
  panelVisibility,
  sceneSummaries,
  currentSceneId,
  cameraFocusNodeId,
  cameraFocusRequestId,
} = storeToRefs(sceneStore)

const isSceneManagerOpen = ref(false)
const isExporting = ref(false)
const viewportRef = ref<SceneViewportHandle | null>(null)


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

const layoutClasses = computed(() => ({
  'is-hierarchy-closed': !panelVisibility.value.hierarchy,
  'is-inspector-closed': !panelVisibility.value.inspector,
  'is-project-closed': !panelVisibility.value.project,
}))

const reopenButtons = computed(() => ({
  showHierarchy: !panelVisibility.value.hierarchy,
  showInspector: !panelVisibility.value.inspector,
  showProject: !panelVisibility.value.project,
}))

onMounted(async () => {
  await sceneStore.ensureCurrentSceneLoaded()
})

function setTool(tool: EditorTool) {
  sceneStore.setActiveTool(tool)
}

function selectNode(nodeId: string | null) {
  sceneStore.selectNode(nodeId)
}

function updateNodeTransform(payload: { id: string; position: Vector3Like; rotation: Vector3Like; scale: Vector3Like }) {
  sceneStore.updateNodeTransform(payload)
}

function updateCamera(state: SceneCameraState) {
  sceneStore.setCameraState(state)
}

function reopenPanel(panel: EditorPanel) {
  sceneStore.setPanelVisibility(panel, true)
}

function handleNewAction() {
  sceneStore.createScene('Untitled Scene')
}

function handleOpenAction() {
  isSceneManagerOpen.value = true
}
function updateExportProgress(progress: number, message?: string) {
  const displayMessage = message ?? `Exporting ${Math.round(progress)}%`
  uiStore.updateLoadingOverlay({
    title: 'Export Scene',
    message: displayMessage,
  })
  uiStore.updateLoadingProgress(progress, { autoClose: false })
}

async function handleExport(format: ExportFormat) {
  if (isExporting.value) {
    return
  }

  const viewport = viewportRef.value
  if (!viewport) {
    console.warn('Scene viewport unavailable for export')
    return
  }

  isExporting.value = true
  const sceneName = sceneStore.currentScene?.name ?? 'scene'
  uiStore.showLoadingOverlay({
    title: 'Export Scene',
    message: `Preparing export ${format}…`,
    mode: 'determinate',
    progress: 0,
    closable: false,
    autoClose: false,
  })

  try {
    await viewport.exportScene({
      format,
      fileName: `${sceneName}-${format.toLowerCase()}`,
      onProgress: updateExportProgress,
    })

    uiStore.updateLoadingOverlay({
      title: 'Export Scene',
      message: 'Export Complete',
      closable: true,
      autoClose: true,
      autoCloseDelay: 800,
    })
    uiStore.updateLoadingProgress(100, { autoClose: true, autoCloseDelay: 800 })
  } catch (error) {
    const message = (error as Error)?.message ?? 'Unknown error'
    console.error('Scene export failed', error)
    uiStore.updateLoadingOverlay({
      title: 'Export Scene',
      message: `${message}`,
      closable: true,
      autoClose: false,
    })
    uiStore.updateLoadingProgress(100, { autoClose: false })
  } finally {
    isExporting.value = false
  }
}

async function handleAction(action: string) {
  switch (action) {
    case 'New':
      handleNewAction()
      break
    case 'Open':
      handleOpenAction()
      break
    case 'Save':
      break
    case 'Export':
      console.log('Export action triggered')
      break
    case 'Preview':
      break
    case 'Copy': {
      sceneStore.copyNodes(sceneStore.selectedNodeIds)
      break
    }
    case 'Cut': {
      const id = sceneStore.selectedNodeId
      if (id) {
        sceneStore.cutNodes(sceneStore.selectedNodeIds)
      }
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
    case 'Export:GLTF': {
      await handleExport('GLTF')
      break
    }
    case 'Export:OBJ': {
      await handleExport('OBJ')
      break
    }
    case 'Export:PLY': {
      await handleExport('PLY')
      break
    }
    case 'Export:STL': {
      await handleExport('STL')
      break
    }
    case 'Export:GLB': {
      await handleExport('GLB')
      break
    }
    default:
      console.warn(`Unknown menu action: ${action}`)
  }
}
function handleCreateScene(name: string) {
  sceneStore.createScene(name)
  isSceneManagerOpen.value = false
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

function handleRenameScene(payload: { id: string; name: string }) {
  sceneStore.renameScene(payload.id, payload.name)
}


</script>

<template>
  <div class="editor-view">
    <div class="editor-layout" :class="layoutClasses">
      <MenuBar 
        @menu-action="handleAction"
      />
      <transition name="slide-left">
        <section v-if="hierarchyOpen" class="panel hierarchy-panel">
          <HierarchyPanel @collapse="hierarchyOpen = false" />
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
          @change-tool="setTool"
          @select-node="selectNode"
          @update-node-transform="updateNodeTransform"
          @update-camera="updateCamera"
        />
      </section>

      <transition name="slide-right">
        <section v-if="inspectorOpen" class="panel inspector-panel">
          <InspectorPanel @collapse="inspectorOpen = false" />
        </section>
      </transition>

      <transition name="slide-up">
        <section v-if="projectOpen" class="panel project-panel">
          <ProjectPanel @collapse="projectOpen = false" />
        </section>
      </transition>

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
    </div>
    <SceneManagerDialog
      v-model="isSceneManagerOpen"
      :scenes="sceneSummaries"
      :current-scene-id="currentSceneId"
      @create="handleCreateScene"
      @select="handleSelectScene"
      @delete="handleDeleteScene"
      @rename="handleRenameScene"
    />
  </div>
</template>

<style scoped>
.editor-view {
  height: 100vh;
  width: 100%;
  background: radial-gradient(circle at top left, #21262d, #11141a 60%);
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
  gap: 5px;
  padding: 5px;
  box-sizing: border-box;
}

.editor-layout.is-hierarchy-closed {
  grid-template-columns: 0 minmax(0, 1fr) minmax(0, 320px);
}

.editor-layout.is-inspector-closed {
  grid-template-columns: minmax(0, 280px) minmax(0, 1fr) 0;
}

.editor-layout.is-project-closed {
  grid-template-rows: auto minmax(0, 1fr) 0;
}

.panel {
  min-height: 0;
  min-width: 0;
}

.hierarchy-panel {
  grid-area: hierarchy;
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
</style>
