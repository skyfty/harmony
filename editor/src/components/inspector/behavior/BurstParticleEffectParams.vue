<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import type {
  BurstParticleEffectBehaviorParams,
  SceneNode,
  SceneNodeComponentState,
} from '@schema/core'
import { useSceneStore } from '@/stores/sceneStore'
import { PARTICLE_SYSTEM_COMPONENT_TYPE, type ParticleSystemComponentProps } from '@schema/components'

const props = defineProps<{
  modelValue: BurstParticleEffectBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: BurstParticleEffectBehaviorParams): void
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

const params = computed<BurstParticleEffectBehaviorParams>(() => ({
  targetNodeId: props.modelValue?.targetNodeId ?? null,
  componentId: props.modelValue?.componentId ?? null,
  emitterId: props.modelValue?.emitterId ?? null,
  count: props.modelValue?.count ?? 24,
}))

const nodeItems = computed(() => {
  const output: Array<{ label: string; value: string }> = []
  flattenNodes(nodes.value, output)
  return output
})

const particleComponents = computed(() => {
  const targetNode = findNodeById(nodes.value, params.value.targetNodeId)
  if (!targetNode?.components) return [] as Array<SceneNodeComponentState<ParticleSystemComponentProps>>
  return Object.values(targetNode.components)
    .filter((entry): entry is SceneNodeComponentState<ParticleSystemComponentProps> => Boolean(entry && entry.type === PARTICLE_SYSTEM_COMPONENT_TYPE))
})

const componentItems = computed(() =>
  particleComponents.value.map((entry) => ({
    label: `Particle System (${entry.id.slice(0, 8)})`,
    value: entry.id,
  })),
)

const emitterItems = computed(() => {
  const targetComponent = particleComponents.value.find((entry) => entry.id === params.value.componentId) ?? particleComponents.value[0]
  const emitters = Array.isArray(targetComponent?.props?.emitters) ? targetComponent.props.emitters : []
  return emitters.map((entry) => ({
    label: entry.id,
    value: entry.id,
  }))
})

function update(next: Partial<BurstParticleEffectBehaviorParams>) {
  emit('update:modelValue', {
    targetNodeId: params.value.targetNodeId,
    componentId: params.value.componentId,
    emitterId: params.value.emitterId,
    count: params.value.count,
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
      @update:model-value="update({ targetNodeId: $event ?? null, componentId: null, emitterId: null })"
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
      @update:model-value="update({ componentId: $event ?? null, emitterId: null })"
    />
    <v-select
      :model-value="params.emitterId"
      :items="emitterItems"
      label="Emitter"
      item-title="label"
      item-value="value"
      density="compact"
      variant="underlined"
      hide-details
      clearable
      @update:model-value="update({ emitterId: $event ?? null })"
    />
    <v-text-field
      :model-value="params.count"
      label="Burst Count"
      type="number"
      density="compact"
      variant="underlined"
      hide-details
      @update:model-value="update({ count: Math.max(0, Math.round(Number($event) || 0)) })"
    />
  </div>
</template>
