<script setup lang="ts">
import { computed } from 'vue'
import SceneDeviceAdaptationPanel from '@/components/inspector/SceneDeviceAdaptationPanel.vue'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>()
const dialogModel = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})
</script>

<template>
  <v-dialog v-model="dialogModel" max-width="980" scrollable>
    <v-card>
      <v-card-title class="dialog-title">
        <span>设备适配规则</span>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" aria-label="关闭" @click="dialogModel = false" />
      </v-card-title>
      <v-divider />
      <v-card-text class="dialog-content">
        <SceneDeviceAdaptationPanel />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.dialog-title {
  display: flex;
  align-items: center;
  min-height: 56px;
}

.dialog-content {
  max-height: min(78vh, 900px);
  overflow-y: auto;
}
</style>
