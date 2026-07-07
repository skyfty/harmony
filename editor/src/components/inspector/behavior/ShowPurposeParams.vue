<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { ShowPurposeBehaviorButton, ShowPurposeBehaviorParams } from '@schema/core'
import { collectPerformSequenceOptions, resolvePerformSequenceLabel } from '@schema/behaviors/sequenceOptions'
import NodePicker from '@/components/common/NodePicker.vue'
import { useSceneStore } from '@/stores/sceneStore'

type NodePickerHandle = { cancelPicking: () => void }

const props = defineProps<{
  modelValue: ShowPurposeBehaviorParams | undefined
  nodeId: string | null
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: ShowPurposeBehaviorParams): void
  (event: 'pick-state-change', value: boolean): void
}>()

const sceneStore = useSceneStore()
const { nodes } = storeToRefs(sceneStore)

let buttonCounter = 0
let defaultButtonsInitialized = false
const pickerRefs = new Map<string, NodePickerHandle>()
const activePickerKeys = new Set<string>()

function createButtonId(): string {
  buttonCounter += 1
  return `show_purpose_button_ui_${Date.now()}_${buttonCounter.toString(16)}`
}

function normalizeButton(button: Partial<ShowPurposeBehaviorButton> | undefined): ShowPurposeBehaviorButton {
  const hasTargetNodeId = button ? Object.prototype.hasOwnProperty.call(button, 'targetNodeId') : false
  return {
    id: typeof button?.id === 'string' && button.id.trim().length ? button.id.trim() : createButtonId(),
    targetNodeId: typeof button?.targetNodeId === 'string' && button.targetNodeId.trim().length
      ? button.targetNodeId.trim()
      : hasTargetNodeId
        ? null
        : props.nodeId,
    targetSequenceId: typeof button?.targetSequenceId === 'string' && button.targetSequenceId.trim().length
      ? button.targetSequenceId.trim()
      : null,
    label: typeof button?.label === 'string' ? button.label.trim() : '',
  }
}

function normalizeButtons(buttons: ShowPurposeBehaviorButton[] | null | undefined): ShowPurposeBehaviorButton[] {
  if (!Array.isArray(buttons) || !buttons.length) {
    return []
  }
  return buttons.map((button) => normalizeButton(button))
}

const buttons = computed(() => normalizeButtons(props.modelValue?.buttons))

function emitButtons(next: ShowPurposeBehaviorButton[]) {
  emit('update:modelValue', {
    buttons: normalizeButtons(next),
  })
}

function resolveSequenceOptions(nodeId: string | null) {
  return collectPerformSequenceOptions(nodes.value, nodeId)
}

function updateButton(index: number, patch: Partial<ShowPurposeBehaviorButton>) {
  const next = buttons.value.slice()
  const current = next[index]
  if (!current) {
    return
  }
  const merged = normalizeButton({ ...current, ...patch })
  const options = resolveSequenceOptions(merged.targetNodeId)
  if (
    options.length > 0
    && merged.targetSequenceId
    && !options.some((option) => option.sequenceId === merged.targetSequenceId)
  ) {
    merged.targetSequenceId = null
  }
  next[index] = merged
  emitButtons(next)
}

function addButton() {
  emitButtons([...buttons.value, normalizeButton(undefined)])
}

function removeButton(index: number) {
  const next = buttons.value.slice()
  const entry = next[index]
  if (!entry) {
    return
  }
  pickerRefs.get(entry.id)?.cancelPicking()
  pickerRefs.delete(entry.id)
  activePickerKeys.delete(entry.id)
  next.splice(index, 1)
  emitButtons(next)
  emit('pick-state-change', activePickerKeys.size > 0)
}

function registerPicker(key: string) {
  return (instance: unknown) => {
    if (instance && typeof (instance as NodePickerHandle).cancelPicking === 'function') {
      pickerRefs.set(key, instance as NodePickerHandle)
      return
    }
    pickerRefs.delete(key)
    if (activePickerKeys.delete(key)) {
      emit('pick-state-change', activePickerKeys.size > 0)
    }
  }
}

function handlePickStateChange(key: string, active: boolean) {
  if (active) {
    activePickerKeys.add(key)
  } else {
    activePickerKeys.delete(key)
  }
  emit('pick-state-change', activePickerKeys.size > 0)
}

function resolveButtonLabel(button: ShowPurposeBehaviorButton): string {
  const explicit = button.label.trim()
  if (explicit.length) {
    return explicit
  }
  const sequenceLabel = resolvePerformSequenceLabel(nodes.value, button.targetNodeId, button.targetSequenceId)
  if (sequenceLabel) {
    return sequenceLabel
  }
  return button.targetSequenceId ?? '未命名按钮'
}

const sequenceItemsByButton = computed(() => {
  const result = new Map<string, Array<{ label: string; value: string }>>()
  buttons.value.forEach((button) => {
    result.set(
      button.id,
      resolveSequenceOptions(button.targetNodeId).map((option) => ({ label: option.label, value: option.sequenceId })),
    )
  })
  return result
})

function getSequenceItems(buttonId: string): Array<{ label: string; value: string }> {
  return sequenceItemsByButton.value.get(buttonId) ?? []
}

watch([buttons, nodes], () => {
  if (!defaultButtonsInitialized && !buttons.value.length && props.nodeId) {
    emitButtons([normalizeButton({ targetNodeId: props.nodeId })])
    defaultButtonsInitialized = true
    return
  }
  if (buttons.value.length) {
    defaultButtonsInitialized = true
  }
  const next = buttons.value.map((button) => {
    if (!button.targetNodeId || !button.targetSequenceId) {
      return button
    }
    const options = resolveSequenceOptions(button.targetNodeId)
    if (!options.length || options.some((option) => option.sequenceId === button.targetSequenceId)) {
      return button
    }
    return {
      ...button,
      targetSequenceId: null,
    }
  })
  const changed = next.some((button, index) => button.targetSequenceId !== buttons.value[index]?.targetSequenceId)
  if (changed) {
    emitButtons(next)
  }
}, { immediate: true })

function updateTarget(index: number, nodeId: string | null) {
  updateButton(index, {
    targetNodeId: nodeId,
  })
}

function updateSequence(index: number, sequenceId: string | null | undefined) {
  updateButton(index, {
    targetSequenceId: sequenceId ?? null,
  })
}

function updateLabel(index: number, label: string | null | undefined) {
  updateButton(index, {
    label: typeof label === 'string' ? label : '',
  })
}

function cancelPicking() {
  pickerRefs.forEach((picker) => {
    picker.cancelPicking()
  })
  activePickerKeys.clear()
  emit('pick-state-change', false)
}

defineExpose({ cancelPicking })

onBeforeUnmount(() => {
  cancelPicking()
})
</script>

<template>
  <div class="show-purpose-params">
    <div class="show-purpose-params__header">
      <div class="show-purpose-params__title">Purpose Buttons</div>
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-plus"
        @click="addButton"
      >
        Add Button
      </v-btn>
    </div>

    <div v-if="buttons.length" class="show-purpose-params__list">
      <div
        v-for="(button, index) in buttons"
        :key="button.id"
        class="show-purpose-params__item"
      >
        <div class="show-purpose-params__item-header">
          <div class="show-purpose-params__item-title">
            {{ resolveButtonLabel(button) }}
          </div>
          <v-btn
            size="small"
            variant="text"
            icon="mdi-close"
            title="Remove button"
            @click="removeButton(index)"
          />
        </div>

        <NodePicker
          :ref="registerPicker(button.id)"
          :model-value="button.targetNodeId"
          pick-hint="Select the target node"
          placeholder="未选择目标节点"
          selection-hint="Click a node in the scene to select the target for this purpose button."
          @update:modelValue="(nodeId) => updateTarget(index, nodeId)"
          @pick-state-change="(active) => handlePickStateChange(button.id, active)"
        />

        <v-select
          :model-value="button.targetSequenceId"
          :items="getSequenceItems(button.id)"
          item-title="label"
          item-value="value"
          label="Perform Sequence"
          density="compact"
          variant="underlined"
          hide-details
          :disabled="!button.targetNodeId"
          :placeholder="button.targetNodeId ? 'Select a perform sequence' : 'Pick a target node first'"
          @update:modelValue="(sequenceId) => updateSequence(index, sequenceId)"
        />

        <v-text-field
          :model-value="button.label"
          label="Button Label"
          density="compact"
          variant="underlined"
          hide-details
          clearable
          placeholder="Optional display label"
          @update:modelValue="(value) => updateLabel(index, value)"
        />
      </div>
    </div>

    <div v-else class="show-purpose-params__empty">
      No buttons configured yet. Add one to build the purpose panel.
    </div>
  </div>
</template>

<style scoped>
.show-purpose-params {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.show-purpose-params__header,
.show-purpose-params__item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.show-purpose-params__title {
  font-size: 0.9rem;
  font-weight: 600;
}

.show-purpose-params__list {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.show-purpose-params__item {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 0.8rem;
  border-radius: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
}

.show-purpose-params__item-title {
  font-size: 0.86rem;
  font-weight: 600;
}

.show-purpose-params__empty {
  font-size: 0.85rem;
  color: rgba(233, 236, 241, 0.65);
}
</style>
