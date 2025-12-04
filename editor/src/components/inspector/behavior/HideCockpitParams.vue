<script setup lang="ts">
import { watchEffect } from 'vue'
import type { HideCockpitBehaviorParams } from '@harmony/schema'

const props = defineProps<{
  modelValue: HideCockpitBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: HideCockpitBehaviorParams): void
}>()

watchEffect(() => {
  if (props.modelValue) {
    return
  }
  emit('update:modelValue', {})
})
</script>

<template>
  <v-alert
    type="info"
    density="comfortable"
    variant="tonal"
  >
    隐藏驾驶台脚本会立即收起车辆驾驶控制面板，无需退出驾驶模式。此脚本无需额外配置。
  </v-alert>
</template>
