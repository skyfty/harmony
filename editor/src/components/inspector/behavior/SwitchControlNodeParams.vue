<script setup lang="ts">
import { computed } from 'vue'
import type { SwitchControlNodeBehaviorParams } from '@schema/core'
import { STEER_TARGET_TYPES } from '@schema/components'

const props = defineProps<{
  modelValue: SwitchControlNodeBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: SwitchControlNodeBehaviorParams): void
}>()

const params = computed<SwitchControlNodeBehaviorParams>(() => ({
  targetType: props.modelValue?.targetType ?? 'vehicle',
}))

function updateTargetType(value: unknown): void {
  const targetType = STEER_TARGET_TYPES.includes(value as typeof STEER_TARGET_TYPES[number])
    ? value as typeof STEER_TARGET_TYPES[number]
    : 'vehicle'
  emit('update:modelValue', { targetType })
}
</script>

<template>
  <v-select
    label="Target Type"
    density="compact"
    variant="underlined"
    hide-details
    :items="STEER_TARGET_TYPES.map((value) => ({ title: value, value }))"
    :model-value="params.targetType"
    @update:model-value="updateTargetType"
  />
</template>
