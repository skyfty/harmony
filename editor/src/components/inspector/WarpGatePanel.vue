<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema/core'
import { useSceneStore } from '@/stores/sceneStore'
import { WARP_GATE_COMPONENT_TYPE, clampWarpGateComponentProps, type WarpGateComponentProps } from '@schema/components'

const store = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(store)
const component = computed(() => selectedNode.value?.components?.[WARP_GATE_COMPONENT_TYPE] as SceneNodeComponentState<WarpGateComponentProps> | undefined)
const state = reactive(clampWarpGateComponentProps(null))
watch(() => component.value?.props, (props) => Object.assign(state, clampWarpGateComponentProps(props)), { immediate: true, deep: true })
function patch(values: Partial<WarpGateComponentProps>) {
  if (component.value && selectedNodeId.value) store.updateNodeComponentProps(selectedNodeId.value, component.value.id, values as Partial<Record<string, unknown>>)
}
</script>

<template>
  <v-expansion-panel :value="WARP_GATE_COMPONENT_TYPE">
    <v-expansion-panel-title>Warp Gate</v-expansion-panel-title>
    <v-expansion-panel-text>
      <v-text-field v-model="state.color" label="Color" type="color" hide-details @change="patch({ color: state.color })" />
      <v-slider v-model="state.intensity" label="Intensity" :min="0" :max="5" :step="0.01" hide-details @update:model-value="patch({ intensity: state.intensity })" />
      <v-slider v-model="state.particleSize" label="Particle Size" :min="0.02" :max="0.4" :step="0.01" hide-details @update:model-value="patch({ particleSize: state.particleSize })" />
      <v-slider v-model="state.particleCount" label="Particle Count" :min="0" :max="600" :step="1" hide-details @update:model-value="patch({ particleCount: state.particleCount })" />
      <v-switch v-model="state.showParticles" label="Particles" hide-details @update:model-value="patch({ showParticles: state.showParticles })" />
      <v-switch v-model="state.showBeams" label="Beams" hide-details @update:model-value="patch({ showBeams: state.showBeams })" />
      <v-switch v-model="state.showRings" label="Rings" hide-details @update:model-value="patch({ showRings: state.showRings })" />
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>
