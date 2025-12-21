<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { SceneNodeComponentState } from '@harmony/schema'
import { FLOOR_COMPONENT_TYPE, FLOOR_DEFAULT_SMOOTH } from '@schema/components'
import type { FloorComponentProps } from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const floorComponent = computed(() => {
  const component = selectedNode.value?.components?.[FLOOR_COMPONENT_TYPE]
  if (!component) {
    return null
  }
  return component as SceneNodeComponentState<FloorComponentProps>
})

const localSmooth = ref(FLOOR_DEFAULT_SMOOTH)
const isSyncingFromScene = ref(false)

watch(
  floorComponent,
  (component) => {
    isSyncingFromScene.value = true
    if (!component) {
      localSmooth.value = FLOOR_DEFAULT_SMOOTH
      nextTick(() => {
        isSyncingFromScene.value = false
      })
      return
    }

    const smooth = Number.isFinite(component.props.smooth) ? component.props.smooth : FLOOR_DEFAULT_SMOOTH
    localSmooth.value = smooth
    nextTick(() => {
      isSyncingFromScene.value = false
    })
  },
  { immediate: true }
)

const smoothDisplay = computed(() => `${Math.round(localSmooth.value * 100)}%`)

function applySmoothUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = floorComponent.value
  if (!nodeId || !component) {
    return
  }
  const value = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  if (!Number.isFinite(value)) {
    return
  }
  const clamped = Math.min(1, Math.max(0, value))
  const currentSmooth = Number.isFinite(component.props.smooth)
    ? component.props.smooth
    : FLOOR_DEFAULT_SMOOTH
  if (Math.abs(currentSmooth - clamped) <= 1e-6) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { smooth: clamped })
}
</script>

<template>
  <v-expansion-panel value="floor">
    <v-expansion-panel-title>
      <div class="floor-panel-header">
        <span class="floor-panel-title">Floor</span>
        <v-spacer />
        <span class="floor-panel-subtitle">{{ smoothDisplay }}</span>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="floor-field-grid">
        <div class="floor-field-labels">
          <span>Corner Smoothness</span>
          <span>{{ smoothDisplay }}</span>
        </div>
        <v-slider
          :model-value="localSmooth"
          :min="0"
          :max="1"
          :step="0.01"
          density="compact"
          track-color="rgba(77, 208, 225, 0.4)"
          color="primary"
          @update:modelValue="(value) => { localSmooth = Number(value); applySmoothUpdate(value) }"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.floor-panel-header {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0.4rem;
}

.floor-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.floor-panel-subtitle {
  font-size: 0.78rem;
  opacity: 0.78;
}

.floor-field-grid {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.floor-field-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.78rem;
  opacity: 0.75;
}
</style>
