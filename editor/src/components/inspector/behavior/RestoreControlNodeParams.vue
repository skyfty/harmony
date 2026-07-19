<script setup lang="ts">
import { computed } from 'vue'
import { CONTROL_NODE_TRANSITION_PRESETS, type RestoreControlNodeBehaviorParams } from '@schema/core'

const props = defineProps<{
  modelValue: RestoreControlNodeBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: RestoreControlNodeBehaviorParams): void
}>()

const params = computed<RestoreControlNodeBehaviorParams>(() => ({
  transitionPreset: props.modelValue?.transitionPreset ?? 'quantum',
}))
</script>

<template>
  <div class="restore-control-node-params">
    <v-select
      label="切换动画"
      density="compact"
      variant="underlined"
      hide-details
      :items="CONTROL_NODE_TRANSITION_PRESETS"
      item-title="title"
      item-value="value"
      :model-value="params.transitionPreset"
      @update:model-value="emit('update:modelValue', { transitionPreset: $event })"
    >
      <template #item="{ props: itemProps, item }">
        <v-list-item v-bind="itemProps" :subtitle="item.raw.description" />
      </template>
    </v-select>
    <div class="restore-control-node-params__hint">恢复最近一次切换前的控制节点。</div>
  </div>
</template>

<style scoped>
.restore-control-node-params {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  min-height: 3.5rem;
  padding: 0.75rem 0.9rem;
  border-radius: 0.75rem;
  border: 1px dashed rgba(233, 236, 241, 0.16);
  background: rgba(255, 255, 255, 0.02);
}

.restore-control-node-params__hint {
  font-size: 0.86rem;
  color: rgba(233, 236, 241, 0.66);
}
</style>
