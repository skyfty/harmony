<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import type {
  StopParticleEffectBehaviorParams,
  SceneNode,
  SceneNodeComponentState,
} from '@schema/core'
import { useSceneStore } from '@/stores/sceneStore'
import { PARTICLE_SYSTEM_COMPONENT_TYPE } from '@schema/components'

const props = defineProps<{
  modelValue: StopParticleEffectBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: StopParticleEffectBehaviorParams): void
}>()

const sceneStore = useSceneStore()
const { nodes } = storeToRefs(sceneStore)

function flattenNodes(tree: SceneNode[] | undefined, output: Array<{ label: string; value: string }>, prefix = ''): void {
  if (!tree?.length) return
  tree.forEach((node) => {
    const label = prefix ? `${prefix} / ${node.name || node.id}` : (node.name || node.id)
    output.push({ label, value: node.id })
    flattenNodes(node.children, output, label)
  })
}

function findNodeById(tree: SceneNode[] | undefined, id: string | null): SceneNode | null {
  if (!tree || !id) return null
  for (const node of tree) {
    if (node.id === id) return node
    const child = findNodeById(node.children, id)
    if (child) return child
  }
  return null
}

const params = computed<StopParticleEffectBehaviorParams>(() => ({
  targetNodeId: props.modelValue?.targetNodeId ?? null,
  componentId: props.modelValue?.componentId ?? null,
  softStop: props.modelValue?.softStop !== false,
}))

const nodeItems = computed(() => {
  const output: Array<{ label: string; value: string }> = []
  flattenNodes(nodes.value, output)
  return output
})

const componentItems = computed(() => {
  const targetNode = findNodeById(nodes.value, params.value.targetNodeId)
  if (!targetNode?.components) return []
  return Object.values(targetNode.components)
    .filter((entry): entry is SceneNodeComponentState => Boolean(entry && entry.type === PARTICLE_SYSTEM_COMPONENT_TYPE))
    .map((entry) => ({
      label: `Particle System (${entry.id.slice(0, 8)})`,
      value: entry.id,
    }))
})

function update(next: Partial<StopParticleEffectBehaviorParams>) {
  emit('update:modelValue', {
    targetNodeId: params.value.targetNodeId,
    componentId: params.value.componentId,
    softStop: params.value.softStop,
    ...next,
  })
}
</script>

<template>
  <div class="particle-effect-params">
    <v-select
      :model-value="params.targetNodeId"
      :items="nodeItems"
      label="Target Node"
      item-title="label"
      item-value="value"
      density="compact"
      variant="underlined"
      hide-details
      clearable
      @update:model-value="update({ targetNodeId: $event ?? null, componentId: null })"
    />
    <v-select
      :model-value="params.componentId"
      :items="componentItems"
      label="Particle Component"
      item-title="label"
      item-value="value"
      density="compact"
      variant="underlined"
      hide-details
      clearable
      @update:model-value="update({ componentId: $event ?? null })"
    />
    <v-switch
      :model-value="params.softStop"
      label="Soft Stop"
      density="compact"
      hide-details
      color="primary"
      @update:model-value="update({ softStop: Boolean($event) })"
    />
  </div>
</template>
