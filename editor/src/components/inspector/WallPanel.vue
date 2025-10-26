<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { SceneNodeComponentState } from '@/types/node-component'
import {
  WALL_COMPONENT_TYPE,
  WALL_DEFAULT_HEIGHT,
  WALL_DEFAULT_THICKNESS,
  WALL_DEFAULT_WIDTH,
  WALL_MIN_HEIGHT,
  WALL_MIN_THICKNESS,
  WALL_MIN_WIDTH,
  type WallComponentProps,
} from '@/runtime/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const localHeight = ref<number>(WALL_DEFAULT_HEIGHT)
const localWidth = ref<number>(WALL_DEFAULT_WIDTH)
const localThickness = ref<number>(WALL_DEFAULT_THICKNESS)

const wallComponent = computed(() => {
  const node = selectedNode.value
  if (!node?.components?.length) {
    return undefined
  }
  return node.components.find((entry) => entry.type === WALL_COMPONENT_TYPE) as SceneNodeComponentState<WallComponentProps> | undefined
})

const hasWallComponent = computed(() => Boolean(selectedNodeId.value && wallComponent.value))

watch(
  () => wallComponent.value?.props,
  (props) => {
    if (!props) {
      return
    }
    localHeight.value = props.height
    localWidth.value = props.width
    localThickness.value = props.thickness
  },
  { immediate: true, deep: true },
)

function clampDimension(value: number, fallback: number, min: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback
  }
  return Math.max(min, value)
}

function applyDimensions() {
  const component = wallComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }

  const props = component.props as WallComponentProps
  const nextHeight = clampDimension(Number(localHeight.value), props.height ?? WALL_DEFAULT_HEIGHT, WALL_MIN_HEIGHT)
  const nextWidth = clampDimension(Number(localWidth.value), props.width ?? WALL_DEFAULT_WIDTH, WALL_MIN_WIDTH)
  const nextThickness = clampDimension(Number(localThickness.value), props.thickness ?? WALL_DEFAULT_THICKNESS, WALL_MIN_THICKNESS)

  localHeight.value = nextHeight
  localWidth.value = nextWidth
  localThickness.value = nextThickness

  sceneStore.updateNodeComponentProps(nodeId, component.id, {
    height: nextHeight,
    width: nextWidth,
    thickness: nextThickness,
  })
}
</script>

<template>
  <v-expansion-panel value="wall">
    <v-expansion-panel-title>
      Wall Properties
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div v-if="hasWallComponent" class="wall-field-grid">
        <v-text-field
          v-model.number="localHeight"
          label="Height (m)"
          type="number"
          density="compact"
          variant="underlined"
          class="slider-input"
          step="0.1"
          min="0.5"
          @blur="applyDimensions"
                inputmode="decimal"
          @keydown.enter.prevent="applyDimensions"
        />
        <v-text-field
          v-model.number="localWidth"
          label="Width (m)"
          type="number"
          density="compact"
          variant="underlined"
          step="0.05"
          min="0.1"
          class="slider-input"
          @blur="applyDimensions"
                inputmode="decimal"
          @keydown.enter.prevent="applyDimensions"
        />
        <v-text-field
          v-model.number="localThickness"
          label="Thickness (m)"
          type="number"
          class="slider-input"
          density="compact"
                inputmode="decimal"
          variant="underlined"
          step="0.05"
          min="0.05"
          @blur="applyDimensions"
          @keydown.enter.prevent="applyDimensions"
        />
      </div>
      <div v-else class="wall-panel-placeholder">
        Wall component is not attached to this node.
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.wall-field-grid {
  display: grid;
  gap: 0.2rem;
  margin: 0px 5px;
}

.hint-text {
  display: block;
  margin-top: 0.25rem;
  color: rgba(220, 225, 232, 0.65);
}

.v-field-label {
  font-size: 0.82rem;
}
.slider-input :deep(.v-field-label) {
  font-size: 0.82rem;
  font-weight: 600;
}

.wall-panel-placeholder {
  color: rgba(233, 236, 241, 0.65);
  font-size: 0.85rem;
}
</style>
