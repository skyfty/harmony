<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import HierarchyPanel from '@/components/layout/HierarchyPanel.vue'
import InspectorPanel from '@/components/layout/InspectorPanel.vue'
import ProjectPanel from '@/components/layout/ProjectPanel.vue'
import SceneViewport from '@/components/editor/SceneViewport.vue'
import { useSceneStore, type EditorTool, type EditorPanel, type SceneCameraState } from '@/stores/sceneStore'
import type { Vector3Like } from '@/types/scene'

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

type MenuEntry = {
  label: string
  items?: MenuEntry[]
}

const menuItems: MenuEntry[] = [
  {
    label: 'File',
    items: [
      { label: 'Open' },
      { label: 'Save' },
      { label: 'Import' },
      {
        label: 'Export',
        items: [
          { label: 'PLY' },
          { label: 'STL' },
        ],
      },
    ],
  },
  { label: 'Edit' },
  { label: 'View' },
  { label: 'Create' },
  { label: 'Help' },
]

const quickActions = [
  { icon: 'mdi-content-save-outline', label: 'Save' },
  { icon: 'mdi-export-variant', label: 'Export' },
  { icon: 'mdi-play-circle-outline', label: 'Preview' },
]

function setTool(tool: EditorTool) {
  sceneStore.setActiveTool(tool)
}

function selectNode(nodeId: string | null) {
  sceneStore.selectNode(nodeId)
}

function updateNodeTransform(payload: { id: string; position: Vector3Like; rotation: Vector3Like; scale: Vector3Like }) {
  sceneStore.updateNodeTransform(payload)
}

function handleMenuAction(action: string) {
  console.debug(`[menu] ${action}`)
}

function updateCamera(state: SceneCameraState) {
  sceneStore.setCameraState(state)
}

function reopenPanel(panel: EditorPanel) {
  sceneStore.setPanelVisibility(panel, true)
}
</script>

<template>
  <div class="editor-view">
    <div class="editor-layout" :class="layoutClasses">
      <section class="menu-bar">
        <div class="menu-left">
          <div class="brand">Harmony</div>
          <div class="menu-items">
            <div
              v-for="item in menuItems"
              :key="item.label"
              class="menu-item"
            >
              <v-menu
                v-if="item.items"
                location="bottom"
                offset-y
                open-on-hover
              >
                <template #activator="{ props: menuActivatorProps }">
                  <v-btn
                    v-bind="menuActivatorProps"
                    class="menu-button"
                    variant="text"
                    color="rgba(255, 255, 255, 0.72)"
                    density="comfortable"
                    rounded="xl"
                  >
                    {{ item.label }}
                    <v-icon end size="16">mdi-menu-down</v-icon>
                  </v-btn>
                </template>
                <v-list class="menu-dropdown" density="compact">
                  <template v-for="entry in item.items" :key="entry.label">
                    <v-menu
                      v-if="entry.items"
                      :key="`submenu-${entry.label}`"
                      location="end"
                      offset-x
                      open-on-hover
                    >
                      <template #activator="{ props: submenuActivator }">
                        <v-list-item
                          v-bind="submenuActivator"
                          class="menu-list-item has-children"
                          :title="entry.label"
                        >
                          <template #append>
                            <v-icon size="16">mdi-menu-right</v-icon>
                          </template>
                        </v-list-item>
                      </template>
                      <v-list class="menu-dropdown" density="compact">
                        <v-list-item
                          v-for="child in entry.items"
                          :key="child.label"
                          class="menu-list-item"
                          :title="child.label"
                          @click="handleMenuAction(`${item.label} > ${entry.label} > ${child.label}`)"
                        />
                      </v-list>
                    </v-menu>
                    <v-list-item
                      v-else
                      :key="`item-${entry.label}`"
                      class="menu-list-item"
                      :title="entry.label"
                      @click="handleMenuAction(`${item.label} > ${entry.label}`)"
                    />
                  </template>
                </v-list>
              </v-menu>
              <v-btn
                v-else
                class="menu-button"
                variant="text"
                color="rgba(255, 255, 255, 0.72)"
                density="comfortable"
                rounded="xl"
                @click="handleMenuAction(item.label)"
              >
                {{ item.label }}
              </v-btn>
            </div>
          </div>
        </div>
        <div class="menu-right">
          <v-btn
            v-for="action in quickActions"
            :key="action.icon"
            class="action-button"
            variant="tonal"
            color="primary"
            density="comfortable"
            size="small"
            rounded
          >
            <v-icon start>{{ action.icon }}</v-icon>
            {{ action.label }}
          </v-btn>
        </div>
      </section>

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

.menu-bar {
  grid-area: menu;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  background: rgba(16, 19, 24, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(12px);
}

.menu-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.brand {
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #f4f6fb;
}

.menu-items {
  display: flex;
  gap: 4px;
}

.menu-item {
  position: relative;
}

.menu-button {
  color: rgba(244, 247, 255, 0.76);
  font-weight: 500;
  text-transform: none;
}

.menu-dropdown {
  background: rgba(18, 21, 26, 0.95);
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(12px);
}

.menu-list-item {
  color: rgba(244, 247, 255, 0.9);
  font-size: 0.9rem;
}

.menu-list-item.has-children :deep(.v-list-item__append) {
  margin-inline-start: auto;
}

.menu-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-button {
  font-weight: 500;
  text-transform: none;
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
