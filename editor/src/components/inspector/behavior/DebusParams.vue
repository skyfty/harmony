<script setup lang="ts">
import { watchEffect } from 'vue'
import type { DebusBehaviorParams } from '@harmony/schema'

const props = defineProps<{
  modelValue: DebusBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: DebusBehaviorParams): void
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
    Debus 脚本会退出驾驶模式，移除车辆控制面板，解除相机与车辆的绑定，并恢复默认的轨道控制与物理状态。此脚本无需额外配置。
  </v-alert>
</template>
