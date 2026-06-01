<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { PlayAnimationBehaviorParams } from '@schema/core'
import {
  ANIMATION_COMPONENT_TYPE,
  type AnimationComponentProps,
} from '@schema/components'
import NodePicker from '@/components/common/NodePicker.vue'
import { useSceneStore, getRuntimeObject } from '@/stores/sceneStore'
import { collectAnimationClipCatalog } from '@schema/runtimeAnimationCatalog'
import { findSceneNodeById } from '@/utils/animationClipCatalog'

const props = defineProps<{
  modelValue: PlayAnimationBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: PlayAnimationBehaviorParams): void
  (event: 'pick-state-change', value: boolean): void
}>()

const sceneStore = useSceneStore()
const { nodes } = storeToRefs(sceneStore)

const params = computed<PlayAnimationBehaviorParams>(() => ({
  targetNodeId: props.modelValue?.targetNodeId ?? null,
  clipName: props.modelValue?.clipName ?? null,
  loop: props.modelValue?.loop ?? false,
  waitForCompletion: props.modelValue?.waitForCompletion ?? false,
}))

const pickerRef = ref<{ cancelPicking: () => void } | null>(null)
const clipOptions = ref<Array<{ label: string; value: string }>>([])
const isLoadingClips = ref(false)
const clipLoadError = ref<string | null>(null)
let clipLoadRequestId = 0

function updateParams(next: PlayAnimationBehaviorParams) {
  emit('update:modelValue', next)
}

function updateTarget(nodeId: string | null) {
  updateParams({
    targetNodeId: nodeId,
    clipName: null,
    loop: params.value.loop,
    waitForCompletion: nodeId ? params.value.waitForCompletion : false,
  })
}

function updateClip(clipName: string | null) {
  updateParams({
    targetNodeId: params.value.targetNodeId,
    clipName,
    loop: params.value.loop,
    waitForCompletion: params.value.waitForCompletion,
  })
}

function updateLoop(loop: boolean) {
  updateParams({
    targetNodeId: params.value.targetNodeId,
    clipName: params.value.clipName,
    loop,
    waitForCompletion: loop ? false : params.value.waitForCompletion,
  })
}

function updateWait(wait: boolean) {
  updateParams({
    targetNodeId: params.value.targetNodeId,
    clipName: params.value.clipName,
    loop: params.value.loop,
    waitForCompletion: wait,
  })
}

const targetNode = computed(() => findSceneNodeById(nodes.value, params.value.targetNodeId))
const sourceNodeId = computed(() => targetNode.value?.id ?? null)
const sourceNodeName = computed(() => {
  if (!sourceNodeId.value) {
    return null
  }
  const node = findSceneNodeById(nodes.value, sourceNodeId.value)
  return node?.name?.trim() || node?.id || sourceNodeId.value
})

async function loadClipsForTarget(nodeId: string | null) {
  const requestId = ++clipLoadRequestId
  clipOptions.value = []
  clipLoadError.value = null
  if (!nodeId) {
    return
  }
  const ownerNode = findSceneNodeById(nodes.value, nodeId)
  if (!ownerNode) {
    clipLoadError.value = 'Animation target node was not found.'
    return
  }
  const animationComponent = ownerNode.components?.[ANIMATION_COMPONENT_TYPE]?.props as AnimationComponentProps | undefined
  if (!animationComponent) {
    clipLoadError.value = 'Selected node must contain an Animation component.'
    return
  }
  isLoadingClips.value = true
  try {
    let runtimeObject = getRuntimeObject(ownerNode.id)
    if (!runtimeObject) {
      await sceneStore.ensureSceneAssetsReady({ nodes: [ownerNode], showOverlay: false, refreshViewport: false })
      runtimeObject = getRuntimeObject(ownerNode.id)
    }
    if (requestId === clipLoadRequestId) {
      clipOptions.value = collectAnimationClipCatalog(runtimeObject)
    }
  } catch (error) {
    console.warn('[PlayAnimationParams] Failed to load animation clips', error)
    if (requestId === clipLoadRequestId) {
      clipLoadError.value = 'Unable to load animation clips.'
    }
  } finally {
    if (requestId === clipLoadRequestId) {
      isLoadingClips.value = false
    }
  }
}

watch(
  () => params.value.targetNodeId,
  (nodeId) => {
    void loadClipsForTarget(nodeId)
  },
  { immediate: true },
)

watch(
  clipOptions,
  (options) => {
    if (!options.length) {
      if (params.value.clipName) {
        updateClip(null)
      }
      return
    }
    const hasSelection = options.some((option) => option.value === (params.value.clipName ?? '').trim())
    if (!hasSelection) {
      updateClip(null)
    }
  },
  { deep: true },
)

function handlePickStateChange(active: boolean) {
  emit('pick-state-change', active)
}

function cancelPicking() {
  pickerRef.value?.cancelPicking()
}

defineExpose({ cancelPicking })

onBeforeUnmount(() => {
  cancelPicking()
})
</script>

<template>
  <div class="play-animation-params">
    <NodePicker
      ref="pickerRef"
      :model-value="params.targetNodeId"
      pick-hint="Select the node that owns the Animation component"
      placeholder="No node selected"
      selection-hint="The selected node must contain an Animation component."
      @update:modelValue="updateTarget"
      @pick-state-change="handlePickStateChange"
    />
    <div v-if="sourceNodeId" class="play-animation-params__hint">
      Source node: {{ sourceNodeName }}
    </div>
    <v-select
      :model-value="params.clipName"
      :items="clipOptions"
      item-title="label"
      item-value="value"
      label="Animation Clip"
      density="compact"
      variant="underlined"
      hide-details
      clearable
      :loading="isLoadingClips"
      :disabled="!params.targetNodeId || isLoadingClips"
      @update:model-value="(value) => updateClip(value ? String(value) : null)"
    />
    <div v-if="clipLoadError" class="play-animation-params__message play-animation-params__message--error">
      {{ clipLoadError }}
    </div>
    <div v-else-if="!isLoadingClips && params.targetNodeId && !clipOptions.length" class="play-animation-params__message">
      No playable animation clips were found on this animation source.
    </div>
    <div class="play-animation-params__switches">
      <v-switch
        :model-value="params.loop"
        label="Loop"
        density="compact"
        hide-details
        inset
        @update:model-value="updateLoop(Boolean($event))"
      />
      <v-switch
        :model-value="params.waitForCompletion"
        label="Wait for completion"
        density="compact"
        hide-details
        inset
        :disabled="params.loop"
        @update:model-value="updateWait(Boolean($event))"
      />
    </div>
  </div>
</template>

<style scoped>
.play-animation-params {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.play-animation-params__hint,
.play-animation-params__message {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.65);
}

.play-animation-params__message--error {
  color: #ff8a80;
}

.play-animation-params__switches {
  display: flex;
  gap: 0.5rem;
}
</style>
