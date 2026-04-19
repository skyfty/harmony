<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema'
import { useSceneStore } from '@/stores/sceneStore'
import { useBuildToolsStore } from '@/stores/buildToolsStore'
import {
  BOUNDARY_WALL_COMPONENT_TYPE,
  BOUNDARY_WALL_DEFAULT_HEIGHT,
  BOUNDARY_WALL_DEFAULT_MODE,
  BOUNDARY_WALL_DEFAULT_OFFSET,
  BOUNDARY_WALL_DEFAULT_THICKNESS,
  BOUNDARY_WALL_MIN_HEIGHT,
  BOUNDARY_WALL_MIN_OFFSET,
  BOUNDARY_WALL_MAX_OFFSET,
  BOUNDARY_WALL_MIN_THICKNESS,
  clampBoundaryWallComponentProps,
  type BoundaryWallMode,
  type BoundaryWallComponentProps,
} from '@schema/components'

const sceneStore = useSceneStore()
const buildToolsStore = useBuildToolsStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)
const { activeBuildTool } = storeToRefs(buildToolsStore)

const MODE_OPTIONS: Array<{ title: string; value: BoundaryWallMode }> = [
  { title: 'Auto', value: 'auto' },
  { title: 'Custom', value: 'custom' },
]

const boundaryWallComponent = computed(
  () => selectedNode.value?.components?.[BOUNDARY_WALL_COMPONENT_TYPE] as
    | SceneNodeComponentState<BoundaryWallComponentProps>
    | undefined,
)

const localHeight = ref(BOUNDARY_WALL_DEFAULT_HEIGHT)
const localThickness = ref(BOUNDARY_WALL_DEFAULT_THICKNESS)
const localOffset = ref(BOUNDARY_WALL_DEFAULT_OFFSET)
const localMode = ref<BoundaryWallMode>(BOUNDARY_WALL_DEFAULT_MODE as BoundaryWallMode)

const normalizedProps = computed(() =>
  clampBoundaryWallComponentProps(boundaryWallComponent.value?.props as Partial<BoundaryWallComponentProps> | undefined),
)

const customLoopCount = computed(() => normalizedProps.value.customLoops.length)
const customPointCount = computed(() => normalizedProps.value.customLoops.reduce((sum, loop) => sum + loop.points.length, 0))
const isBoundaryWallDrawActive = computed(() => activeBuildTool.value === 'boundaryWall')

watch(
  () => boundaryWallComponent.value?.props,
  (props) => {
    const normalized = clampBoundaryWallComponentProps(props)
    localHeight.value = normalized.height
    localThickness.value = normalized.thickness
    localOffset.value = normalized.offset
    localMode.value = normalized.mode
  },
  { immediate: true, deep: true },
)

function handleToggleComponent() {
  const component = boundaryWallComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = boundaryWallComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}

function updateBoundaryWallProps(patch: Partial<BoundaryWallComponentProps>) {
  const component = boundaryWallComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, patch as Partial<Record<string, unknown>>)
}

function applyHeight() {
  const normalized = clampBoundaryWallComponentProps({ height: localHeight.value }).height
  if (Math.abs(normalized - localHeight.value) > 1e-6) {
    localHeight.value = normalized
  }
  updateBoundaryWallProps({ height: normalized })
}

function applyThickness() {
  const normalized = clampBoundaryWallComponentProps({ thickness: localThickness.value }).thickness
  if (Math.abs(normalized - localThickness.value) > 1e-6) {
    localThickness.value = normalized
  }
  updateBoundaryWallProps({ thickness: normalized })
}

function applyOffset() {
  const normalized = clampBoundaryWallComponentProps({ offset: localOffset.value }).offset
  if (Math.abs(normalized - localOffset.value) > 1e-6) {
    localOffset.value = normalized
  }
  updateBoundaryWallProps({ offset: normalized })
}

function applyMode(value: BoundaryWallMode | null) {
  const normalized = value === 'custom' ? 'custom' : 'auto'
  localMode.value = normalized
  updateBoundaryWallProps({ mode: normalized })
  if (normalized !== 'custom' && activeBuildTool.value === 'boundaryWall') {
    buildToolsStore.setActiveBuildTool(null)
  }
}

function handleStartDraw() {
  if (!boundaryWallComponent.value?.enabled) {
    return
  }
  if (localMode.value !== 'custom') {
    applyMode('custom')
  }
  buildToolsStore.setActiveBuildTool('boundaryWall')
}

function handleStopDraw() {
  if (activeBuildTool.value === 'boundaryWall') {
    buildToolsStore.setActiveBuildTool(null)
  }
}

function handleClearCustomLoops() {
  updateBoundaryWallProps({ customLoops: [] })
  if (activeBuildTool.value === 'boundaryWall') {
    buildToolsStore.setActiveBuildTool(null)
  }
}
</script>

<template>
  <v-expansion-panel value="boundaryWall">
    <v-expansion-panel-title>
      <div class="boundary-wall-panel-header">
        <span class="boundary-wall-panel-title">Boundary Wall</span>
        <v-spacer />
        <v-menu
          v-if="boundaryWallComponent"
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
            <v-list-item @click.stop="handleToggleComponent()">
              <v-list-item-title>{{ boundaryWallComponent.enabled ? 'Disable' : 'Enable' }}</v-list-item-title>
            </v-list-item>
            <v-divider class="component-menu-divider" inset />
            <v-list-item @click.stop="handleRemoveComponent()">
              <v-list-item-title>Remove</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="boundary-wall-settings">
        <v-select
          :model-value="localMode"
          label="Mode"
          density="comfortable"
          variant="underlined"
          :items="MODE_OPTIONS"
          item-title="title"
          item-value="value"
          :disabled="!boundaryWallComponent?.enabled"
          @update:model-value="applyMode"
        />
        <v-text-field
          v-model.number="localHeight"
          label="Height (m)"
          type="number"
          density="comfortable"
          variant="underlined"
          :min="BOUNDARY_WALL_MIN_HEIGHT"
          step="0.1"
          :disabled="!boundaryWallComponent?.enabled"
          @blur="applyHeight"
          @keydown.enter.prevent="applyHeight"
        />
        <v-text-field
          v-model.number="localThickness"
          label="Thickness (m)"
          type="number"
          density="comfortable"
          variant="underlined"
          :min="BOUNDARY_WALL_MIN_THICKNESS"
          step="0.05"
          :disabled="!boundaryWallComponent?.enabled"
          @blur="applyThickness"
          @keydown.enter.prevent="applyThickness"
        />
        <v-text-field
          v-model.number="localOffset"
          label="Offset (m)"
          type="number"
          density="comfortable"
          variant="underlined"
          :min="BOUNDARY_WALL_MIN_OFFSET"
          :max="BOUNDARY_WALL_MAX_OFFSET"
          step="0.05"
          :disabled="!boundaryWallComponent?.enabled"
          @blur="applyOffset"
          @keydown.enter.prevent="applyOffset"
        />
        <template v-if="localMode === 'custom'">
          <div class="boundary-wall-custom-actions">
            <v-btn
              color="primary"
              variant="tonal"
              size="small"
              :disabled="!boundaryWallComponent?.enabled"
              @click="isBoundaryWallDrawActive ? handleStopDraw() : handleStartDraw()"
            >
              {{ isBoundaryWallDrawActive ? 'Stop Drawing' : 'Draw Boundary' }}
            </v-btn>
            <v-btn
              variant="text"
              size="small"
              :disabled="!boundaryWallComponent?.enabled || customLoopCount === 0"
              @click="handleClearCustomLoops"
            >
              Clear
            </v-btn>
          </div>
          <div class="boundary-wall-custom-summary">
            <span>{{ customLoopCount }} loop{{ customLoopCount === 1 ? '' : 's' }}</span>
            <span>{{ customPointCount }} pts</span>
          </div>
          <div class="boundary-wall-custom-hint">
            Left click to place points, double click to finish, right click to cancel current draft.
          </div>
        </template>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.boundary-wall-panel-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.boundary-wall-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.boundary-wall-settings {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding-inline: 0.4rem;
}

.boundary-wall-custom-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.boundary-wall-custom-summary {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.82rem;
  color: rgba(233, 236, 241, 0.72);
}

.boundary-wall-custom-hint {
  font-size: 0.78rem;
  line-height: 1.45;
  color: rgba(233, 236, 241, 0.62);
}
</style>