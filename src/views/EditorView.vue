<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import HierarchyPanel from '@/components/layout/HierarchyPanel.vue'
import InspectorPanel from '@/components/layout/InspectorPanel.vue'
import ProjectPanel from '@/components/layout/ProjectPanel.vue'
import SceneViewport from '@/components/editor/SceneViewport.vue'
import { useSceneStore, type EditorTool } from '@/stores/sceneStore'
import type { Vector3Like } from '@/types/scene'

const sceneStore = useSceneStore()
const { nodes: sceneNodes, selectedNodeId, activeTool } = storeToRefs(sceneStore)

const hierarchyOpen = ref(true)
const inspectorOpen = ref(true)
const projectOpen = ref(true)

const layoutClasses = computed(() => ({
  'is-hierarchy-closed': !hierarchyOpen.value,
  'is-inspector-closed': !inspectorOpen.value,
  'is-project-closed': !projectOpen.value,
}))

const reopenButtons = computed(() => ({
  showHierarchy: !hierarchyOpen.value,
  showInspector: !inspectorOpen.value,
  showProject: !projectOpen.value,
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
</script>

<template>
  <div class="editor-view">
    <div class="editor-layout" :class="layoutClasses">
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
          @change-tool="setTool"
          @select-node="selectNode"
          @update-node-transform="updateNodeTransform"
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
        @click="hierarchyOpen = true"
      />

      <v-btn
        v-if="reopenButtons.showInspector"
        class="edge-button right"
        color="primary"
        variant="flat"
        rounded
        icon="mdi-chevron-left"
        density="comfortable"
        @click="inspectorOpen = true"
      />

      <v-btn
        v-if="reopenButtons.showProject"
        class="edge-button bottom"
        color="primary"
        variant="tonal"
        density="comfortable"
        @click="projectOpen = true"
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
  grid-template-rows: minmax(0, 1fr) minmax(0, 260px);
  grid-template-areas:
    'hierarchy scene inspector'
    'project project project';
  gap: 12px;
  padding: 16px;
  box-sizing: border-box;
}

.editor-layout.is-hierarchy-closed {
  grid-template-columns: 0 minmax(0, 1fr) minmax(0, 320px);
}

.editor-layout.is-inspector-closed {
  grid-template-columns: minmax(0, 280px) minmax(0, 1fr) 0;
}

.editor-layout.is-project-closed {
  grid-template-rows: minmax(0, 1fr) 0;
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
