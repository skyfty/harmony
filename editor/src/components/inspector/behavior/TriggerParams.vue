<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type {
  BehaviorComponentProps,
  SceneBehavior,
  SceneNode,
  SceneNodeComponentState,
  TriggerBehaviorParams,
} from '@harmony/schema'
import { BEHAVIOR_COMPONENT_TYPE } from '@schema/components'
import { behaviorMapToList } from '@schema/behaviors/definitions'
import { useSceneStore } from '@/stores/sceneStore'
import { useNodePickerStore } from '@/stores/nodePickerStore'

const props = defineProps<{
  modelValue: TriggerBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: TriggerBehaviorParams): void
  (event: 'pick-state-change', value: boolean): void
}>()

const sceneStore = useSceneStore()
const nodePickerStore = useNodePickerStore()
const { nodes } = storeToRefs(sceneStore)

const params = computed<TriggerBehaviorParams>(() => ({
  targetNodeId: props.modelValue?.targetNodeId ?? null,
  sequenceId: props.modelValue?.sequenceId ?? null,
}))

const isPicking = ref(false)
let activeRequestId: number | null = null

function findNodeName(tree: SceneNode[] | undefined, id: string | null): string | null {
  if (!tree || !id) {
    return null
  }
  for (const node of tree) {
    if (node.id === id) {
      return node.name?.trim().length ? node.name : node.id
    }
    const child = findNodeName(node.children, id)
    if (child) {
      return child
    }
  }
  return null
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

const targetNodeName = computed(() => findNodeName(nodes.value, params.value.targetNodeId))

const performBehaviors = computed(() => {
  const targetNode = findNodeById(nodes.value, params.value.targetNodeId)
  if (!targetNode) {
    return [] as Array<{ label: string; sequenceId: string }>
  }
  const component = targetNode.components?.[BEHAVIOR_COMPONENT_TYPE] as
    | SceneNodeComponentState<BehaviorComponentProps>
    | undefined
  if (!component) {
    return [] as Array<{ label: string; sequenceId: string }>
  }
  const source = component.props?.behaviors
  const list: SceneBehavior[] = Array.isArray(source)
    ? source
    : behaviorMapToList(source)
  const seen = new Map<string, string>()
  let unnamedIndex = 1
  list.forEach((entry) => {
    if (!entry || entry.action !== 'perform') {
      return
    }
    const key = entry.sequenceId?.trim()
    if (!key) {
      return
    }
    if (seen.has(key)) {
      return
    }
    const label = entry.name?.trim() || `Perform Sequence ${unnamedIndex}`
    if (!entry.name?.trim()) {
      unnamedIndex += 1
    }
    seen.set(key, label)
  })
  return Array.from(seen.entries()).map(([sequenceId, label]) => ({ label, sequenceId }))
})

function updateParams(next: TriggerBehaviorParams) {
  emit('update:modelValue', next)
}

function updateTarget(nodeId: string | null) {
  updateParams({
    targetNodeId: nodeId,
    sequenceId: null,
  })
}

function updateSequence(sequenceId: string | null) {
  updateParams({
    targetNodeId: params.value.targetNodeId,
    sequenceId,
  })
}

watch(performBehaviors, (options) => {
  if (!options.length) {
    if (params.value.sequenceId) {
      updateSequence(null)
    }
    return
  }
  const hasSelection = options.some((option) => option.sequenceId === params.value.sequenceId)
  if (!hasSelection) {
    updateSequence(null)
  }
})

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelPicking()
  }
}

function handlePointerDown(event: PointerEvent) {
  if (event.button === 2) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    cancelPicking()
  }
}

function startPicking() {
  if (isPicking.value) {
    return
  }
  isPicking.value = true
  emit('pick-state-change', true)
  activeRequestId = nodePickerStore.beginPick({
    owner: 'behavior-target',
    hint: 'Select a node to trigger',
    handlers: {
      onPick(nodeId: string) {
        activeRequestId = null
        stopPicking()
        updateTarget(nodeId)
      },
      onCancel() {
        activeRequestId = null
        stopPicking()
      },
    },
  })
  window.addEventListener('keydown', handleKeydown, true)
  window.addEventListener('pointerdown', handlePointerDown, true)
}

function cancelPicking() {
  if (!isPicking.value) {
    return
  }
  if (activeRequestId && nodePickerStore.activeRequestId === activeRequestId) {
    nodePickerStore.cancelActivePick('user')
  } else {
    stopPicking()
  }
}

function stopPicking() {
  if (!isPicking.value) {
    return
  }
  isPicking.value = false
  emit('pick-state-change', false)
  window.removeEventListener('keydown', handleKeydown, true)
  window.removeEventListener('pointerdown', handlePointerDown, true)
}

function clearTarget() {
  updateTarget(null)
}

const sequenceItems = computed(() =>
  performBehaviors.value.map((option) => ({ label: option.label, value: option.sequenceId })),
)

const sequenceSelection = computed({
  get() {
    return params.value.sequenceId
  },
  set(value: string | null | undefined) {
    updateSequence(value ?? null)
  },
})

defineExpose({ cancelPicking })

onBeforeUnmount(() => {
  if (isPicking.value) {
    cancelPicking()
  }
  window.removeEventListener('keydown', handleKeydown, true)
  window.removeEventListener('pointerdown', handlePointerDown, true)
})
</script>

<template>
  <div class="trigger-params">
    <div class="trigger-params__row">
      <div class="trigger-params__target">
        <v-btn
          class="trigger-params__icon-button"
          size="small"
          variant="text"
          icon="mdi-crosshairs-gps"
          :loading="isPicking"
          @click="startPicking"
        />
        <span v-if="params.targetNodeId" class="trigger-params__value">
          {{ targetNodeName ?? params.targetNodeId }}
        </span>
        <span v-else class="trigger-params__placeholder">未选择节点</span>
        <v-btn
          class="trigger-params__icon-button trigger-params__icon-button--clear"
          size="small"
          variant="text"
          icon="mdi-close"
          :disabled="!params.targetNodeId"
          @click="clearTarget"
        />
      </div>
    </div>
    <div v-if="isPicking" class="trigger-params__hint">
      点击场景中的节点进行选择，显示在左侧，右侧显示清除按钮。
    </div>
    <v-select
      v-model="sequenceSelection"
      class="trigger-params__select"
      :items="sequenceItems"
      label="Target Behavior"
      density="compact"
      variant="underlined"
      hide-details
      :disabled="!params.targetNodeId || !sequenceItems.length"
      :placeholder="params.targetNodeId ? '选择要触发的行为' : '请先选择一个目标节点'"
      item-title="label"
      item-value="value"
      clearable
      clear-icon="mdi-close"
    />
  </div>
</template>

<style scoped>
.trigger-params {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.trigger-params__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.trigger-params__target {
  flex: 1;
  min-height: 32px;
  display: flex;
  align-items: center;
  padding: 0 0.4rem;
  border-radius: 6px;
  background: rgba(233, 236, 241, 0.06);
}

.trigger-params__value {
  font-size: 0.95rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.92);
}

.trigger-params__placeholder {
  font-size: 0.9rem;
  color: rgba(233, 236, 241, 0.5);
}

.trigger-params__icon-button {
  color: rgba(233, 236, 241, 0.82);
}

.trigger-params__icon-button--clear {
  margin-left: auto;
}

.trigger-params__hint {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.65);
}

.trigger-params__select :deep(.v-input__control) {
  min-height: 36px;
}
</style>
