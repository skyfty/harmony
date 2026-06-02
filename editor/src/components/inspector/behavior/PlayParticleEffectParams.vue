<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import type {
  PlayParticleEffectBehaviorParams,
  SceneNode,
  SceneNodeComponentState,
} from '@schema/core'
import { useSceneStore } from '@/stores/sceneStore'
import { PARTICLE_SYSTEM_COMPONENT_TYPE } from '@schema/components'

const props = defineProps<{
  modelValue: PlayParticleEffectBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: PlayParticleEffectBehaviorParams): void
}>()

const sceneStore = useSceneStore()
const { nodes } = storeToRefs(sceneStore)

function flattenNodes(tree: SceneNode[] | undefined, output: Array<{ label: string; value: string }>, prefix = ''): void {
  if (!tree?.length) {
    return
  }
  tree.forEach((node) => {
    output.push({
      label: prefix ? `${prefix} / ${node.name || node.id}` : (node.name || node.id),
      value: node.id,
    })
    flattenNodes(node.children, output, prefix ? `${prefix} / ${node.name || node.id}` : (node.name || node.id))
  })
}

function findNodeById(tree: SceneNode[] | undefined, id: string | null): SceneNode | null {
  if (!tree || !id) {
    return null
  }
  for (const node of tree) {
    if (node.id === id) {
      return node
    }
    const child = findNodeById(node.children, id)
    if (child) {
      return child
    }
  }
  return null
}

const params = computed<PlayParticleEffectBehaviorParams>(() => ({
  targetNodeId: props.modelValue?.targetNodeId ?? null,
  componentId: props.modelValue?.componentId ?? null,
  restart: props.modelValue?.restart === true,
}))

const nodeItems = computed(() => {
  const output: Array<{ label: string; value: string }> = []
  flattenNodes(nodes.value, output)
  return output
})

const componentItems = computed(() => {
  const targetNode = findNodeById(nodes.value, params.value.targetNodeId)
  if (!targetNode?.components) {
    return []
  }
  return Object.values(targetNode.components)
    .filter((entry): entry is SceneNodeComponentState => Boolean(entry && entry.type === PARTICLE_SYSTEM_COMPONENT_TYPE))
    .map((entry) => ({
      label: `Particle System (${entry.id.slice(0, 8)})`,
      value: entry.id,
    }))
})

function update(next: Partial<PlayParticleEffectBehaviorParams>) {
  emit('update:modelValue', {
    targetNodeId: params.value.targetNodeId,
    componentId: params.value.componentId,
    restart: params.value.restart,
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
      :model-value="params.restart"
      label="Restart If Active"
      density="compact"
      hide-details
      color="primary"
      @update:model-value="update({ restart: Boolean($event) })"
    />
  </div>
</template>
