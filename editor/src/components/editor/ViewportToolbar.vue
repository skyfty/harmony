
<template>
  <div class="viewport-toolbar">
    <v-card class="toolbar-card" elevation="6">

      <template v-for="tool in buildToolButtons" :key="tool.id">
        <v-menu
          v-if="tool.id === 'floor'"
          :model-value="floorShapeMenuOpen"
          location="bottom"
          :offset="6"
          :open-on-click="false"
          :close-on-content-click="false"
          @update:modelValue="handleFloorShapeMenuModelUpdate"
        >
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              :icon="tool.icon"
              density="compact"
              size="small"
              class="toolbar-button"
              :color="activeBuildTool === tool.id ? 'primary' : undefined"
              :variant="activeBuildTool === tool.id ? 'flat' : 'text'"
              :title="tool.label"
              :disabled="buildToolsDisabled"
              @click="handleBuildToolToggle(tool.id)"
              @contextmenu.prevent.stop="handleFloorShapeContextMenu"
            />
          </template>
          <v-list density="compact" class="floor-shape-menu">
            <div class="floor-shape-menu__card">
              <div class="floor-shape-grid">
                <v-list-item
                  v-for="shape in floorShapeOptions"
                  :key="shape.id"
                  class="floor-shape-item"
                  @click="() => handleFloorShapeSelect(shape.id)"
                >
                  <v-btn
                    density="compact"
                    size="small"
                    variant="text"
                    :title="shape.label"
                    :class="['floor-shape-btn', shape.id === floorBuildShape ? 'floor-shape-selected' : '']"
                  >
                    <span v-html="shape.svg" />
                  </v-btn>
                </v-list-item>
              </div>

              <v-divider class="floor-shape-menu__divider" />

              <div class="floor-preset-menu__list">
                <AssetPickerList
                  :active="true"
                  assetType="prefab"
                  :extensions="['floor']"
                  :asset-id="floorPresetAssetId"
                  :thumbnailSize="30"
                  :showSearch="true"
                  @update:asset="handleFloorPresetSelect"
                />
              </div>
            </div>
          </v-list>
        </v-menu>
        <v-menu
          v-else-if="tool.id === 'wall'"
          :model-value="wallPresetMenuOpen"
          location="bottom"
          :offset="6"
          :open-on-click="false"
          :close-on-content-click="false"
          @update:modelValue="handleWallPresetMenuModelUpdate"
        >
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              :icon="tool.icon"
              density="compact"
              size="small"
              class="toolbar-button"
              :color="activeBuildTool === tool.id ? 'primary' : undefined"
              :variant="activeBuildTool === tool.id ? 'flat' : 'text'"
              :title="tool.label"
              :disabled="buildToolsDisabled"
              @click="handleBuildToolToggle(tool.id)"
              @contextmenu.prevent.stop="handleWallPresetContextMenu"
            />
          </template>
          <v-list density="compact" class="wall-shape-menu">
            <div class="wall-shape-menu__card">
              <AssetPickerList
                :active="true"
                assetType="prefab"
                :extensions="['wall']"
                :asset-id="wallPresetAssetId"
                :thumbnailSize="30"
                :showSearch="true"
                @update:asset="handleWallPresetSelect"
              />
            </div>
          </v-list>
        </v-menu>

        <v-btn
          v-else
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
      </template>
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
        title="Group Selection"
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
        title="Apply Transform to Nodes"
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
        title="Recalculate Group Origin"
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
      <v-menu
        v-model="alignMenuOpen"
        location="bottom"
        :offset="6"
        :close-on-content-click="false"
      >
        <template #activator="{ props: menuProps }">
          <v-btn
            v-bind="menuProps"
            icon="mdi-format-align-left"
            density="compact"
            size="small"
            class="toolbar-button"
            title="Align/Arrange/Distribute"
            :disabled="!canAlignSelection"
            :color="alignMenuOpen ? 'primary' : undefined"
            :variant="alignMenuOpen ? 'flat' : 'text'"
          />
        </template>
        <v-list density="compact" class="align-menu">
          <v-list-item
            title="X Axis Alignment (World X)"
            prepend-icon="mdi-axis-arrow"
            :disabled="!canAlignSelection"
            @click="handleAlignCommand('axis-x')"
          />
          <v-list-item
            title="Y Axis Alignment (World Y)"
            prepend-icon="mdi-axis-arrow"
            :disabled="!canAlignSelection"
            @click="handleAlignCommand('axis-y')"
          />
          <v-list-item
            title="Z Axis Alignment (World Z)"
            prepend-icon="mdi-axis-arrow"
            :disabled="!canAlignSelection"
            @click="handleAlignCommand('axis-z')"
          />

          <v-divider v-if="selectionCount >= 2" class="align-menu__divider" />
          <v-list-item
            v-if="selectionCount >= 2"
            title="Fix Primary Selection as Anchor"
            :prepend-icon="fixedPrimaryAsAnchor ? 'mdi-check' : 'mdi-checkbox-blank-outline'"
            @click="toggleFixedPrimaryAsAnchor"
          />

          <template v-if="selectionCount >= 2">
            <v-divider class="align-menu__divider" />
            <v-list-item
              title="Horizontal Arrange (Right / World X+)"
              prepend-icon="mdi-format-horizontal-align-left"
              :disabled="!canAlignSelection"
              @click="handleAlignCommand({ type: 'arrange', direction: 'horizontal', options: { fixedPrimaryAsAnchor } })"
            />
            <v-list-item
              title="Vertical Arrange (Up / World Y+)"
              prepend-icon="mdi-format-vertical-align-top"
              :disabled="!canAlignSelection"
              @click="handleAlignCommand({ type: 'arrange', direction: 'vertical', options: { fixedPrimaryAsAnchor } })"
            />
            <v-divider class="align-menu__divider" />
            <v-list-item
              title="Horizontal Distribute"
              prepend-icon="mdi-format-horizontal-distribute"
              :disabled="!canAlignSelection || selectionCount < 3"
              @click="handleAlignCommand({ type: 'distribute', direction: 'horizontal', options: { fixedPrimaryAsAnchor } })"
            />
            <v-list-item
              title="Vertical Distribute (World Y)"
              prepend-icon="mdi-format-vertical-distribute"
              :disabled="!canAlignSelection || selectionCount < 3"
              @click="handleAlignCommand({ type: 'distribute', direction: 'vertical', options: { fixedPrimaryAsAnchor } })"
            />
          </template>
        </v-list>
      </v-menu>
      <v-menu
        :model-value="scatterEraseMenuOpen"
        location="bottom"
        :offset="6"
        :open-on-click="false"
        :close-on-content-click="false"
        @update:modelValue="(value) => emit('update:scatter-erase-menu-open', value)"
      >
        <template #activator="{ props: menuProps }">
          <v-btn
            v-bind="menuProps"
            :icon="scatterEraseButtonIcon"
            density="compact"
            size="small"
            class="toolbar-button"
            :color="scatterEraseModeActive ? 'primary' : undefined"
            :variant="scatterEraseModeActive ? 'flat' : 'text'"
            :disabled="!canEraseScatterEffective"
            :title="scatterEraseButtonTitle"
            @click="handleScatterEraseButtonClick"
            @contextmenu.prevent.stop="handleScatterEraseContextMenu"
          />
        </template>
        <v-list density="compact" class="scatter-erase-menu">
          <div class="scatter-erase-menu__card">
            <div class="scatter-erase-menu__slider">
              <div class="scatter-erase-menu__slider-labels">
                <span>Erase Radius</span>
                <span>{{ scatterEraseRadiusLabel }}</span>
              </div>
              <v-slider
                v-model="scatterEraseRadiusModel"
                :min="0.5"
                :max="SCATTER_BRUSH_RADIUS_MAX"
                :step="0.5"
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
                Clear All Scatter Instances
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
            title="Rotate"
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
      <v-btn
        :icon="vertexSnapEnabled ? 'mdi-magnet-on' : 'mdi-magnet'"
        :color="vertexSnapEnabled ? 'primary' : undefined"
        :variant="vertexSnapEnabled ? 'flat' : 'text'"
        density="compact"
        size="small"
        class="toolbar-button"
        title="Toggle Vertex Snap"
        @click="toggleVertexSnap"
      />

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
        :icon="cameraControlMode === 'map' ? 'mdi-map' : 'mdi-rotate-3d-variant'"
        density="compact"
        size="small"
        class="toolbar-button"
        color="undefined"
        variant="text"
        :title="
          cameraControlMode === 'map'
            ? 'Camera Controls: Map (click to switch to Orbit)'
            : 'Camera Controls: Orbit (click to switch to Map)'
        "
        @click="toggleCameraControlMode"
      />

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
import AssetPickerList from '@/components/common/AssetPickerList.vue'
import type { CameraControlMode } from '@harmony/schema'
import type { AlignCommand } from '@/types/scene-viewport-align-command'
import type { AlignMode } from '@/types/scene-viewport-align-mode'
import { useSceneStore } from '@/stores/sceneStore'
import type { BuildTool } from '@/types/build-tool'
import type { FloorBuildShape } from '@/types/floor-build-shape'
import { FLOOR_BUILD_SHAPE_LABELS } from '@/types/floor-build-shape'
import { SCATTER_BRUSH_RADIUS_MAX } from '@/stores/terrainStore'

const props = withDefaults(
  defineProps<{
  showGrid: boolean
  showAxes: boolean
  vertexSnapEnabled?: boolean
  canDropSelection: boolean
  canAlignSelection: boolean
  canRotateSelection: boolean
  canEraseScatter: boolean
  canClearAllScatterInstances: boolean
  activeBuildTool: BuildTool | null
  buildToolsDisabled?: boolean
  scatterEraseModeActive: boolean
  scatterEraseRepairActive?: boolean
  scatterEraseRadius: number
  scatterEraseMenuOpen: boolean
  floorShapeMenuOpen: boolean
  floorBuildShape: FloorBuildShape
  floorPresetAssetId?: string
  wallPresetAssetId?: string
  }>(),
  {
    buildToolsDisabled: false,
    vertexSnapEnabled: false,
    scatterEraseRepairActive: false,
  },
)

const emit = defineEmits<{
  (event: 'reset-camera'): void
  (event: 'drop-to-ground'): void
  (event: 'align-selection', command: AlignCommand | AlignMode): void
  (event: 'rotate-selection', payload: { axis: RotationAxis; degrees: number }): void
  (event: 'capture-screenshot'): void
  (event: 'change-build-tool', tool: BuildTool | null): void
  (event: 'open-wall-preset-picker', anchor: { x: number; y: number }): void
  (event: 'select-wall-preset', asset: any): void
  (event: 'select-floor-preset', asset: any): void
  (event: 'toggle-scatter-erase'): void
  (event: 'update-scatter-erase-radius', value: number): void
  (event: 'clear-all-scatter-instances'): void
  (event: 'update:scatter-erase-menu-open', value: boolean): void
  (event: 'update:floor-shape-menu-open', value: boolean): void
  (event: 'select-floor-build-shape', shape: FloorBuildShape): void
  (event: 'update:wall-preset-menu-open', value: boolean): void
}>()

const {
  showGrid,
  showAxes,
  vertexSnapEnabled,
  canDropSelection,
  canAlignSelection,
  canRotateSelection,
  canEraseScatter,
  canClearAllScatterInstances,
  scatterEraseModeActive,
  scatterEraseRepairActive,
  activeBuildTool,
  buildToolsDisabled,
  scatterEraseRadius,
  scatterEraseMenuOpen,
  floorShapeMenuOpen,
  floorBuildShape,
  floorPresetAssetId,
  wallPresetAssetId,
} = toRefs(props)
const sceneStore = useSceneStore()

const cameraControlMode = computed(() => sceneStore.viewportSettings.cameraControlMode)

function toggleCameraControlMode() {
  const next: CameraControlMode = cameraControlMode.value === 'map' ? 'orbit' : 'map'
  sceneStore.setCameraControlMode(next)
}

const selectionCount = computed(() => (sceneStore.selectedNodeIds ? sceneStore.selectedNodeIds.length : 0))
const activeNode = computed(() => sceneStore.selectedNode)
const isSavingPrefab = ref(false)
const rotationMenuOpen = ref(false)
const wallPresetMenuOpen = ref(false)
const alignMenuOpen = ref(false)
const fixedPrimaryAsAnchor = ref(true)

const scatterEraseRadiusModel = computed({
  get: () => scatterEraseRadius.value,
  set: (value: number) => emit('update-scatter-erase-radius', Number(value)),
})

const scatterEraseRadiusLabel = computed(() => `${scatterEraseRadius.value.toFixed(2)} m`)

const scatterEraseButtonIcon = computed(() => (scatterEraseRepairActive.value ? 'mdi-hammer' : 'mdi-broom'))
const scatterEraseButtonTitle = computed(() => (scatterEraseRepairActive.value ? 'Repair / Restore (Hold Shift)' : 'Scatter Erase'))

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
    label: 'Vertical Rotation',
    actions: [
      { id: 'vertical-45', label: 'Vertical Rotation 45°', axis: 'x', degrees: 45 },
      { id: 'vertical-90', label: 'Vertical Rotation 90°', axis: 'x', degrees: 90 },
      { id: 'vertical-180', label: 'Vertical Rotation 180°', axis: 'x', degrees: 180 },
    ],
  },
  {
    id: 'horizontal',
    label: 'Horizontal Rotation',
    actions: [
      { id: 'horizontal-45', label: 'Horizontal Rotation 45°', axis: 'y', degrees: 45 },
      { id: 'horizontal-90', label: 'Horizontal Rotation 90°', axis: 'y', degrees: 90 },
      { id: 'horizontal-180', label: 'Horizontal Rotation 180°', axis: 'y', degrees: 180 },
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

const canEraseScatterEffective = computed(() => {
  // Enable scatter erase either when parent allows it, or when the active node is a Wall dynamic mesh.
  try {
    const node = activeNode.value as any
    const isWall = Boolean(node && node.dynamicMesh && (node.dynamicMesh as any).type === 'Wall')
    return Boolean(canEraseScatter.value) || isWall
  } catch (_e) {
    return Boolean(canEraseScatter.value)
  }
})

watch(canEraseScatterEffective, (enabled) => {
  if (!enabled) {
    emit('update:scatter-erase-menu-open', false)
  }
})

watch(buildToolsDisabled, (disabled) => {
  if (disabled && floorShapeMenuOpen.value) {
    emit('update:floor-shape-menu-open', false)
  }
  if (disabled && wallPresetMenuOpen.value) {
    wallPresetMenuOpen.value = false
  }
})

watch(floorShapeMenuOpen, (open) => {
  if (open && wallPresetMenuOpen.value) {
    wallPresetMenuOpen.value = false
  }
})

watch(wallPresetMenuOpen, (open) => {
  if (open && floorShapeMenuOpen.value) {
    emit('update:floor-shape-menu-open', false)
  }
})

watch(selectionCount, (count) => {
  if (count === 0) {
    alignMenuOpen.value = false
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

const buildToolButtons = [
  { id: 'wall', icon: 'mdi-wall', label: 'Wall Tool (Left Mouse)' },
  { id: 'floor', icon: 'mdi-floor-plan', label: 'Floor Tool (Left Mouse)' },
  { id: 'road', icon: 'mdi-road-variant', label: 'Road Tool (Left Mouse)' },
] satisfies Array<{ id: BuildTool; icon: string; label: string }>

const floorShapeOptions = (Object.keys(FLOOR_BUILD_SHAPE_LABELS) as FloorBuildShape[]).map((id) => ({
  id,
  label: FLOOR_BUILD_SHAPE_LABELS[id],
  svg:
    id === 'polygon'
      ? '<svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><polygon fill="currentColor" points="12,3 2,21 22,21"/></svg>'
      : id === 'rectangle'
      ? '<svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="6" width="16" height="12" fill="currentColor" rx="1" ry="1"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>',
}))

function toggleFixedPrimaryAsAnchor() {
  fixedPrimaryAsAnchor.value = !fixedPrimaryAsAnchor.value
}

function handleAlignCommand(command: AlignCommand | AlignMode) {
  emit('align-selection', command)
  alignMenuOpen.value = false
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
  void tool
  void event
  if (buildToolsDisabled.value) {
    return
  }
  // default: do nothing here; wall uses its own contextmenu handler to open the embedded menu
  return
}

function handleWallPresetContextMenu(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  if (buildToolsDisabled.value) {
    return
  }
  // Open the in-toolbar wall preset menu
  emit('update:floor-shape-menu-open', false)
  wallPresetMenuOpen.value = true
}

function handleWallPresetMenuModelUpdate(value: boolean) {
  const open = Boolean(value)
  wallPresetMenuOpen.value = open
  if (open) {
    emit('update:floor-shape-menu-open', false)
  }
}

function handleWallPresetSelect(asset: any) {
  // propagate selection to parent; parent will handle activating the wall tool
  emit('select-wall-preset', asset)
  wallPresetMenuOpen.value = false
}

function handleFloorPresetSelect(asset: any) {
  // propagate selection to parent; parent will handle storing brush + activating the floor tool
  emit('select-floor-preset', asset)
}

function handleFloorShapeContextMenu(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  if (buildToolsDisabled.value) {
    return
  }
  // Right-click on floor tool only opens the shape menu; it does not auto-switch tools.
  wallPresetMenuOpen.value = false
  emit('update:floor-shape-menu-open', true)
}

function handleFloorShapeMenuModelUpdate(value: boolean) {
  const open = Boolean(value)
  if (open) {
    wallPresetMenuOpen.value = false
  }
  emit('update:floor-shape-menu-open', open)
}

function handleFloorShapeSelect(shape: FloorBuildShape) {
  if (buildToolsDisabled.value) {
    emit('update:floor-shape-menu-open', false)
    return
  }
  emit('select-floor-build-shape', shape)
}

function handleScatterEraseButtonClick() {
  emit('toggle-scatter-erase')
  // Left click only toggles the tool; do not auto-open the settings menu.
  emit('update:scatter-erase-menu-open', false)
}

function handleScatterEraseContextMenu(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  if (!canEraseScatterEffective.value) {
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

function toggleVertexSnap() {
  sceneStore.toggleViewportVertexSnap()
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
  background-color: rgba(18, 21, 26, 0.72);
  border-radius: 12px;
  padding: 8px;
  gap: 4px;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(77, 208, 225, 0.24);
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

.align-menu {
  min-width: 280px;
  padding: 6px;
}

.rotation-menu {
  min-width: 260px;
  padding: 6px;
}

.floor-shape-menu {
  width: 352px;
  max-width: min(352px, 90vw);
  padding: 6px;
}

.floor-shape-menu__divider {
  margin: 10px 0;
}

.floor-preset-menu__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 4px 6px;
}

.floor-preset-menu__title {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
}

/* Floor preset picker: match wall preset picker layout. */
.floor-preset-menu__list :deep(.asset-picker-list__body) {
  height: 360px;
}

.floor-preset-menu__list :deep(.asset-picker-list__grid) {
  grid-template-columns: repeat(4, 72px) !important;
  grid-auto-rows: 72px;
}

.floor-preset-menu__list :deep(.asset-picker-list__tile) {
  width: 72px;
  height: 72px;
  aspect-ratio: auto;
}

.wall-shape-menu {
  width: 352px;
  max-width: min(352px, 90vw);
  padding: 3px;
}

.wall-shape-menu__card {
  border-radius: 1px;
  padding: 3px;
}

/* Wall preset picker: fixed 4-column grid (72x72 tiles) and fixed scroll height. */
.wall-shape-menu__card :deep(.asset-picker-list__body) {
  height: 360px;
}

.wall-shape-menu__card :deep(.asset-picker-list__grid) {
  grid-template-columns: repeat(4, 72px) !important;
  grid-auto-rows: 72px;
}

.wall-shape-menu__card :deep(.asset-picker-list__tile) {
  width: 72px;
  height: 72px;
  aspect-ratio: auto;
}

.floor-shape-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: 6px 6px 2px;
}
.floor-shape-item {
  padding: 0 !important;
  min-height: unset !important;
}

.floor-shape-item :deep(.v-list-item__content) {
  padding: 0 !important;
}

.floor-shape-item :deep(.v-list-item__spacer) {
  display: none;
}

.floor-shape-btn {
  width: 36px;
  height: 36px;
  min-width: 36px;
  padding: 0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.floor-shape-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.12);
}
.floor-shape-selected {
  color: #4dd0e1;
  background: rgba(77, 208, 225, 0.12);
  border-color: rgba(77, 208, 225, 0.28);
}
.floor-shape-item span svg {
  display: block;
}

.floor-shape-menu__card {
  border-radius: 12px;
  padding: 8px;
}

.scatter-erase-menu__card {
  border-radius: 14px;
  padding: 10px;
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
}

.align-menu__divider {
  margin: 6px 0;
}
</style>
