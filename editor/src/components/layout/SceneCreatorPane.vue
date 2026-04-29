<script setup lang="ts">
import { computed, ref } from 'vue'
const props = defineProps<{
  sceneName: string
  confirmError?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:sceneName', value: string): void
}>()

const name = computed({
  get: () => props.sceneName,
  set: (v: string) => emit('update:sceneName', v),
})

</script>

<template>
  <v-divider class="my-4" />

  <v-text-field
    id="new-scene-name"
    v-model="name"
    label="Scene Name"
    variant="underlined"
    density="comfortable"
    autofocus
  />


  <v-alert
    v-if="props.confirmError"
    type="error"
    density="comfortable"
    border="start"
    border-color="error"
    class="mt-4"
  >
    {{ props.confirmError }}
  </v-alert>
</template>

<style scoped>
/* keep minimal styling — parent dialogs provide layout */

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.scene-creator-dem-import {
  margin-top: 12px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
}

.scene-creator-dem-import__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.scene-creator-dem-import__title {
  font-size: 0.9rem;
  font-weight: 600;
}

.scene-creator-dem-import__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.scene-creator-dem-import__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.scene-creator-dem-import__meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.scene-creator-dem-import__row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.72);
}

.scene-creator-dem-import__row strong {
  color: rgba(255, 255, 255, 0.95);
  text-align: right;
  overflow-wrap: anywhere;
}

.scene-creator-dem-import__preview,
.scene-creator-dem-import__empty {
  min-height: 72px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
}

.scene-creator-dem-import__preview {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
}

.scene-creator-dem-import__preview-placeholder,
.scene-creator-dem-import__empty {
  color: rgba(255, 255, 255, 0.62);
  font-size: 0.82rem;
  text-align: center;
}
</style>
