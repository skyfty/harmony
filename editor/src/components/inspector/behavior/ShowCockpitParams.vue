<script setup lang="ts">
import { watchEffect } from 'vue'
import type { ShowCockpitBehaviorParams } from '@harmony/schema'

const props = defineProps<{
  modelValue: ShowCockpitBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: ShowCockpitBehaviorParams): void
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
    显示驾驶台脚本会强制展示车辆驾驶控制面板，方便在驾驶脚本触发前提前提示玩家。此脚本无需额外配置。
  </v-alert>
</template>
