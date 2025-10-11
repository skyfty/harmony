<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import HierarchyPanel from '@/components/layout/HierarchyPanel.vue'
import InspectorPanel from '@/components/layout/InspectorPanel.vue'
import ProjectPanel from '@/components/layout/ProjectPanel.vue'
import SceneViewport from '@/components/editor/SceneViewport.vue'
import MenuBar from './MenuBar.vue'
import { useSceneStore, type EditorTool, type EditorPanel, type SceneCameraState } from '@/stores/sceneStore'
import type { Vector3Like } from '@/types/scene'
import Loader from '@/plugins/loader'
import { useFileDialog } from '@vueuse/core'

const sceneStore = useSceneStore()
const { nodes: sceneNodes, selectedNodeId, activeTool, camera, panelVisibility } = storeToRefs(sceneStore)

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


function handleMenuImport() {
  const loaderFile = new Loader()
  loaderFile.$on('loaded', (obj: any | null) => {
    if (obj) {
      console.log('Loaded object:', obj)
      // You can add the loaded object to your scene here
    } else {
      console.error('Failed to load object.')
    }
  })
  loaderFile.$on('progress', (payload: { loaded: number; total: number; filename: string }) => {
    console.log(`Loading ${payload.filename}: ${((payload.loaded / payload.total) * 100).toFixed(2)}%`)
  })

  const {
    open: openFileDialog, // 打开对话框的方法，重命名为 openFileDialog
    onChange: onFileChange
  } = useFileDialog()
  onFileChange((files:any) => {
    loaderFile.loadFiles(files)
  })
  openFileDialog() // 打开文件选择对话框
}

// Add this function to handle menu actions
function handleMenuAction(action: string) {
  switch (action) {
    case 'Open':
      // Handle open action
      break
    case 'Save':
      // Handle save action
      break
    case 'Import':
      handleMenuImport()
      break
    case 'Export':
      // Implement your export logic here
      console.log('Export action triggered')
      break
    case 'Preview':
      // Handle preview action
      break
    default:
      console.warn(`Unknown menu action: ${action}`)
  }
  // Implement your menu action logic here
  // Example: console.log('Menu action:', action)
}

</script>

<template>
  <div class="editor-view">
    <div class="editor-layout" :class="layoutClasses">
      <MenuBar 
        @menu-action="handleMenuAction"
      />
      <transition name="slide-left">
        <section v-if="hierarchyOpen" class="panel hierarchy-panel">
          <HierarchyPanel @collapse="hierarchyOpen = false" />
        </section>
      </transition>

      <section class="scene-panel">
        <SceneViewport
          :active-tool="activeTool"
          :scene-nodes="sceneNodes"
          :selected-node-id="selectedNodeId"
          :camera-state="camera"
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
