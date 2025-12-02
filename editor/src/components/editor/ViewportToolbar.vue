
<template>
  <div class="viewport-toolbar">
    <v-card class="toolbar-card" elevation="6">

      <v-btn
        v-for="tool in buildToolButtons"
        :key="tool.id"
        :icon="tool.icon"
        density="compact"
        size="small"
        class="toolbar-button"
        :color="activeBuildTool === tool.id ? 'primary' : undefined"
        :variant="activeBuildTool === tool.id ? 'flat' : 'text'"
        :title="tool.label"
        @click="handleBuildToolToggle(tool.id)"
      />
      <v-divider vertical />
      <v-btn
        icon="mdi-camera-outline"
        density="compact"
        size="small"
        color="undefined"
        variant="text"
        class="toolbar-button"
        title="Capture Screenshot"
        @click="emit('capture-screenshot')"
      />
      <v-btn
        icon="mdi-group"
        density="compact"
        size="small"
        color="undefined"
        variant="text"
        class="toolbar-button"
        title="分组选中"
        :disabled="selectionCount < 2"
        @click="handleGroupSelection"
      />
      <v-btn
        icon="mdi-checkbox-marked-circle-outline"
        density="compact"
        size="small"
        color="undefined"
        variant="text"
        class="toolbar-button"
        title="应用变换到节点"
        :disabled="!canApplyTransformsToGroup"
        @click="handleApplyTransformsToGroup"
      />
      <v-btn
        icon="mdi-content-save-cog-outline"
        density="compact"
        size="small"
        color="undefined"
        variant="text"
        class="toolbar-button"
        title="Save as Prefab"
        :disabled="!canSavePrefab || isSavingPrefab"
        @click="handleSavePrefab"
      />
      <v-divider vertical />
      <v-btn
        icon="mdi-arrow-collapse-down"
        density="compact"
        size="small"
        color="undefined"
        variant="text"
        class="toolbar-button"
        title="Drop to Ground"
        :disabled="!canDropSelection"
        @click="emit('drop-to-ground')"
      />
      <v-btn
        v-for="button in alignButtons"
        :key="button.mode"
        :icon="button.icon"
        density="compact"
        size="small"
        class="toolbar-button"
        color="undefined"
        variant="text"
        :disabled="!canAlignSelection"
        :title="button.title"
        @click="emitAlign(button.mode)"
      />
  <v-menu v-model="rotationMenuOpen" location="bottom" :offset="8">
        <template #activator="{ props: menuProps }">
          <v-btn
            v-bind="menuProps"
            icon="mdi-rotate-3d-variant"
            density="compact"
            size="small"
            class="toolbar-button"
            title="旋转"
            :disabled="!canRotateSelection"
            :color="rotationMenuOpen ? 'primary' : undefined"
            :variant="rotationMenuOpen ? 'flat' : 'text'"
          />
        </template>
        <v-list density="compact" class="rotation-menu">
          <template v-for="(section, index) in rotationSections" :key="section.id">
            <v-list-item
              v-for="action in section.actions"
              :key="action.id"
              :title="action.label"
              @click="handleRotationAction(action)"
            >
            </v-list-item>
            <v-divider v-if="index < rotationSections.length - 1" class="rotation-menu__divider" />
          </template>
        </v-list>
      </v-menu>
      <v-divider vertical />
      <v-btn
        :icon="showGrid ? 'mdi-grid' : 'mdi-grid-off'"
        :color="showGrid ? 'primary' : undefined"
        :variant="showGrid ? 'flat' : 'text'"
        density="compact"
        size="small"
        class="toolbar-button"
        title="Toggle Grid"
        @click="toggleGridVisibility"
      />
      <v-btn
        :icon="showAxes ? 'mdi-axis-arrow-info' : 'mdi-axis-arrow'"
        :color="showAxes ? 'primary' : undefined"
        :variant="showAxes ? 'flat' : 'text'"
        density="compact"
        size="small"
        class="toolbar-button"
        title="Toggle Axes"
        @click="toggleAxesVisibility"
      />

      <v-btn
        :icon="cameraControlModeIcon"
 
        color="undefined"
        variant="text"
        density="compact"
        size="small"
        class="toolbar-button"
        :title="cameraModeTitle"
        @click="emit('toggle-camera-control')"
      />
      <v-divider vertical />
      <v-btn
        icon="mdi-camera"
        density="compact"
        size="small"
        color="undefined"
        variant="text"
        class="toolbar-button"
        title="Reset to Default View"
        @click="emit('reset-camera')"
      />
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue'
import { GROUND_NODE_ID } from '@harmony/schema'
import type { CameraControlMode } from '@harmony/schema'
import type { AlignMode } from '@/types/scene-viewport-align-mode'
import { useSceneStore } from '@/stores/sceneStore'
import type { BuildTool } from '@/types/build-tool'

const props = defineProps<{
  showGrid: boolean
  showAxes: boolean
  canDropSelection: boolean
  canAlignSelection: boolean
  canRotateSelection: boolean
  cameraControlMode: CameraControlMode
  activeBuildTool: BuildTool | null
}>()

const emit = defineEmits<{
  (event: 'reset-camera'): void
  (event: 'drop-to-ground'): void
  (event: 'align-selection', mode: AlignMode): void
  (event: 'rotate-selection', payload: { axis: RotationAxis; degrees: number }): void
  (event: 'capture-screenshot'): void
  (event: 'toggle-camera-control'): void
  (event: 'change-build-tool', tool: BuildTool | null): void
}>()

const {
  showGrid,
  showAxes,
  canDropSelection,
  canAlignSelection,
  canRotateSelection,
  cameraControlMode,
  activeBuildTool,
} = toRefs(props)
const sceneStore = useSceneStore()

const selectionCount = computed(() => (sceneStore.selectedNodeIds ? sceneStore.selectedNodeIds.length : 0))
const activeNode = computed(() => sceneStore.selectedNode)
const isSavingPrefab = ref(false)
const rotationMenuOpen = ref(false)

type RotationAxis = 'x' | 'y'

type RotationAction = {
  id: string
  label: string
  axis: RotationAxis
  degrees: number
}

const rotationSections = [
  {
    id: 'vertical',
    label: '垂直旋转',
    actions: [
      { id: 'vertical-45', label: '垂直旋转45°', axis: 'x', degrees: 45 },
      { id: 'vertical-90', label: '垂直旋转90°', axis: 'x', degrees: 90 },
      { id: 'vertical-180', label: '垂直旋转180°', axis: 'x', degrees: 180 },
    ],
  },
  {
    id: 'horizontal',
    label: '水平旋转',
    actions: [
      { id: 'horizontal-45', label: '水平旋转45°', axis: 'y', degrees: 45 },
      { id: 'horizontal-90', label: '水平旋转90°', axis: 'y', degrees: 90 },
      { id: 'horizontal-180', label: '水平旋转180°', axis: 'y', degrees: 180 },
    ],
  },
] satisfies Array<{ id: string; label: string; actions: RotationAction[] }>

watch(canRotateSelection, (enabled) => {
  if (!enabled && rotationMenuOpen.value) {
    rotationMenuOpen.value = false
  }
})

function handleRotationAction(action: RotationAction) {
  if (!canRotateSelection.value) {
    rotationMenuOpen.value = false
    return
  }
  emit('rotate-selection', { axis: action.axis, degrees: action.degrees })
  rotationMenuOpen.value = false
}

const canSavePrefab = computed(() => {
  const node = activeNode.value
  if (!node) {
    return false
  }
  if (node.id === GROUND_NODE_ID || node.dynamicMesh?.type === 'Ground') {
    return false
  }
  return true
})

const canApplyTransformsToGroup = computed(() => {
  const node = activeNode.value
  if (!node || node.nodeType !== 'Group') {
    return false
  }
  return Array.isArray(node.children) && node.children.length > 0
})

function handleGroupSelection() {
  if ((selectionCount.value ?? 0) < 2) return
  // call the store action to group selected nodes
  const result = sceneStore.groupSelection()
  if (!result) {
    // grouping failed or invalid selection
    return
  }
}

async function handleSavePrefab() {
  if (isSavingPrefab.value) {
    return
  }
  const nodeId = sceneStore.selectedNodeId
  if (!nodeId || nodeId === GROUND_NODE_ID) {
    return
  }
  isSavingPrefab.value = true
  try {
    await sceneStore.saveNodePrefab(nodeId)
  } catch (error) {
    console.warn('Failed to save prefab asset', error)
  } finally {
    isSavingPrefab.value = false
  }
}

function handleApplyTransformsToGroup() {
  const node = activeNode.value
  if (!node || node.nodeType !== 'Group') {
    return
  }
  sceneStore.applyTransformsToGroup(node.id)
}

const alignButtons = [
  { mode: 'axis-x', icon: 'mdi-axis-x-arrow', title: 'Align X Axis' },
  { mode: 'axis-y', icon: 'mdi-axis-y-arrow', title: 'Align Y Axis' },
  { mode: 'axis-z', icon: 'mdi-axis-z-arrow', title: 'Align Z Axis' },
] satisfies Array<{ mode: AlignMode; icon: string; title: string }>
const buildToolButtons = [
  { id: 'wall', icon: 'mdi-wall', label: 'Wall Tool' },
  { id: 'platform', icon: 'mdi-layers-triple', label: 'Platform Tool' },
  { id: 'surface', icon: 'mdi-vector-polygon', label: 'Surface Tool' },
] satisfies Array<{ id: BuildTool; icon: string; label: string }>

const cameraModeTitle = computed(() =>
  cameraControlMode.value === 'orbit'
    ? 'Switch to Map Camera Controls'
    : 'Switch to Orbit Camera Controls',
)

const cameraControlModeIcon = computed(() =>
  cameraControlMode.value === 'orbit' ? 'mdi-orbit' : 'mdi-map',
)

function emitAlign(mode: AlignMode) {
  emit('align-selection', mode)
}

function handleBuildToolToggle(tool: BuildTool) {
  const next = activeBuildTool.value === tool ? null : tool
  emit('change-build-tool', next)
}

function toggleGridVisibility() {
  sceneStore.toggleViewportGridVisible()
}

function toggleAxesVisibility() {
  sceneStore.toggleViewportAxesVisible()
}
</script>

<style scoped>
.viewport-toolbar {
  position: relative;
}

.toolbar-card {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  background-color: rgba(18, 21, 26, 0.64);
  border-radius: 12px;
  padding: 6px 8px;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(77, 208, 225, 0.25);
}

.toolbar-button {
  border-radius: 3px;
  min-width: 22px;
  height: 22px;
}

</style>
