
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
        :disabled="buildToolsDisabled"
        @click="handleBuildToolToggle(tool.id)"
        @contextmenu.prevent.stop="handleBuildToolContextMenu(tool.id, $event)"
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
        :disabled="selectionCount < 1"
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
        icon="mdi-crosshairs-gps"
        density="compact"
        size="small"
        color="undefined"
        variant="text"
        class="toolbar-button"
        title="重算组原点"
        :disabled="!canRecenterGroupOrigin"
        @click="handleRecenterGroupOrigin"
      />
      <v-btn
        icon="mdi-content-save-cog-outline"
        density="compact"
        size="small"
        color="undefined"
        variant="text"
        class="toolbar-button"
        title="Save as Prefab"
        v-if="canSavePrefab"
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
      <v-menu
        :model-value="scatterEraseMenuOpen"
        location="bottom"
        :offset="6"
        :open-on-click="false"
        @update:modelValue="(value) => emit('update:scatter-erase-menu-open', value)"
      >
        <template #activator="{ props: menuProps }">
          <v-btn
            v-bind="menuProps"
            icon="mdi-broom"
            density="compact"
            size="small"
            class="toolbar-button"
            :color="scatterEraseModeActive ? 'primary' : undefined"
            :variant="scatterEraseModeActive ? 'flat' : 'text'"
            :disabled="!canEraseScatter"
            title="Scatter 擦除"
            @click="handleScatterEraseButtonClick"
            @contextmenu.prevent.stop="handleScatterEraseContextMenu"
          />
        </template>
        <v-list density="compact" class="scatter-erase-menu">
          <div class="scatter-erase-menu__card">
            <div class="scatter-erase-menu__slider">
              <div class="scatter-erase-menu__slider-labels">
                <span>擦除半径</span>
                <span>{{ scatterEraseRadiusLabel }}</span>
              </div>
              <v-slider
                v-model="scatterEraseRadiusModel"
                :min="0.1"
                :max="SCATTER_BRUSH_RADIUS_MAX"
                :step="0.1"
                density="compact"
                track-color="rgba(255,255,255,0.25)"
                color="primary"
              />
            </div>
            <v-divider class="scatter-erase-menu__divider" />
            <v-list-item class="scatter-erase-menu__action">
              <v-btn
                density="compact"
                variant="text"
                color="primary"
                class="scatter-erase-menu__clear"
                :disabled="!canClearAllScatterInstances"
                @click="handleClearScatterMenuAction"
              >
                清除所有Scatter实例
              </v-btn>
            </v-list-item>
          </div>
        </v-list>
      </v-menu>
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
import type { AlignMode } from '@/types/scene-viewport-align-mode'
import { useSceneStore } from '@/stores/sceneStore'
import type { BuildTool } from '@/types/build-tool'
import { SCATTER_BRUSH_RADIUS_MAX } from '@/constants/terrainScatter'

const props = withDefaults(
  defineProps<{
  showGrid: boolean
  showAxes: boolean
  canDropSelection: boolean
  canAlignSelection: boolean
  canRotateSelection: boolean
  canEraseScatter: boolean
  canClearAllScatterInstances: boolean
  activeBuildTool: BuildTool | null
  buildToolsDisabled?: boolean
  scatterEraseModeActive: boolean
  scatterEraseRadius: number
  scatterEraseMenuOpen: boolean
  }>(),
  {
    buildToolsDisabled: false,
  },
)

const emit = defineEmits<{
  (event: 'reset-camera'): void
  (event: 'drop-to-ground'): void
  (event: 'align-selection', mode: AlignMode): void
  (event: 'rotate-selection', payload: { axis: RotationAxis; degrees: number }): void
  (event: 'capture-screenshot'): void
  (event: 'change-build-tool', tool: BuildTool | null): void
  (event: 'open-wall-preset-picker', anchor: { x: number; y: number }): void
  (event: 'toggle-scatter-erase'): void
  (event: 'update-scatter-erase-radius', value: number): void
  (event: 'clear-all-scatter-instances'): void
  (event: 'update:scatter-erase-menu-open', value: boolean): void
}>()

const {
  showGrid,
  showAxes,
  canDropSelection,
  canAlignSelection,
  canRotateSelection,
  canEraseScatter,
  canClearAllScatterInstances,
  scatterEraseModeActive,
  activeBuildTool,
  buildToolsDisabled,
  scatterEraseRadius,
  scatterEraseMenuOpen,
} = toRefs(props)
const sceneStore = useSceneStore()

const selectionCount = computed(() => (sceneStore.selectedNodeIds ? sceneStore.selectedNodeIds.length : 0))
const activeNode = computed(() => sceneStore.selectedNode)
const isSavingPrefab = ref(false)
const rotationMenuOpen = ref(false)

const scatterEraseRadiusModel = computed({
  get: () => scatterEraseRadius.value,
  set: (value: number) => emit('update-scatter-erase-radius', Number(value)),
})

const scatterEraseRadiusLabel = computed(() => `${scatterEraseRadius.value.toFixed(2)} m`)

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

watch(canEraseScatter, (enabled) => {
  if (!enabled) {
    emit('update:scatter-erase-menu-open', false)
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
  return node.canPrefab !== false
})

const canApplyTransformsToGroup = computed(() => {
  const node = activeNode.value
  if (!node || node.nodeType !== 'Group') {
    return false
  }
  return Array.isArray(node.children) && node.children.length > 0
})

const canRecenterGroupOrigin = computed(() => {
  const node = activeNode.value
  if (!node || node.nodeType !== 'Group') {
    return false
  }
  return Array.isArray(node.children) && node.children.length > 0
})

function handleGroupSelection() {
  if ((selectionCount.value ?? 0) < 1) return
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
  const node = activeNode.value
  const nodeId = node?.id ?? null
  if (!nodeId || node?.canPrefab === false) {
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

function handleRecenterGroupOrigin() {
  const node = activeNode.value
  if (!node || node.nodeType !== 'Group') {
    return
  }
  sceneStore.recenterGroupOrigin(node.id)
}

const alignButtons = [
  { mode: 'axis-x', icon: 'mdi-axis-x-arrow', title: 'Align X Axis' },
  { mode: 'axis-y', icon: 'mdi-axis-y-arrow', title: 'Align Y Axis' },
  { mode: 'axis-z', icon: 'mdi-axis-z-arrow', title: 'Align Z Axis' },
] satisfies Array<{ mode: AlignMode; icon: string; title: string }>
const buildToolButtons = [
  { id: 'wall', icon: 'mdi-wall', label: 'Wall Tool (Left Mouse)' },
  { id: 'floor', icon: 'mdi-floor-plan', label: 'Floor Tool (Left Mouse)' },
  { id: 'road', icon: 'mdi-road-variant', label: 'Road Tool (Left Mouse)' },
] satisfies Array<{ id: BuildTool; icon: string; label: string }>


function emitAlign(mode: AlignMode) {
  emit('align-selection', mode)
}

function handleBuildToolToggle(tool: BuildTool) {
  if (buildToolsDisabled.value) {
    return
  }
  const next = activeBuildTool.value === tool ? null : tool
  // If we're enabling a build tool, immediately clear selection
  // to avoid accidental operations on the previously selected node.
  if (next) {
    sceneStore.setSelection([])
  }
  emit('change-build-tool', next)
}

function handleBuildToolContextMenu(tool: BuildTool, event: MouseEvent) {
  if (buildToolsDisabled.value) {
    return
  }
  if (tool !== 'wall') {
    return
  }
  emit('open-wall-preset-picker', { x: event.clientX, y: event.clientY })
}

function handleScatterEraseButtonClick() {
  emit('toggle-scatter-erase')
  // Left click only toggles the tool; do not auto-open the settings menu.
  emit('update:scatter-erase-menu-open', false)
}

function handleScatterEraseContextMenu(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  if (!canEraseScatter.value) {
    return
  }
  emit('update:scatter-erase-menu-open', true)
}

function toggleGridVisibility() {
  sceneStore.toggleViewportGridVisible()
}

function toggleAxesVisibility() {
  sceneStore.toggleViewportAxesVisible()
}

function handleClearScatterMenuAction() {
  if (!canClearAllScatterInstances.value) {
    return
  }
  emit('clear-all-scatter-instances')
  emit('update:scatter-erase-menu-open', false)
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

.scatter-erase-menu {
  min-width: 220px;
  padding: 6px;
}

.scatter-erase-menu__card {
  border-radius: 14px;
  padding: 10px;
  background: rgba(20, 24, 32, 0.75);
  backdrop-filter: blur(18px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 16px 30px rgba(0, 0, 0, 0.25);
}

.scatter-erase-menu__slider {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.scatter-erase-menu__slider-labels {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
}

.scatter-erase-menu__action {
  padding: 0;
}

.scatter-erase-menu__clear {
  justify-content: flex-start;
  width: 100%;
  font-size: 13px;
  border-radius: 8px;
  padding-left: 8px;
}

.scatter-erase-menu__divider {
  margin: 12px 0;
  border-color: rgba(255, 255, 255, 0.1);
}

</style>
