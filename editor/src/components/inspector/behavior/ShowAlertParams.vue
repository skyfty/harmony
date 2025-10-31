<script setup lang="ts">
import { computed } from 'vue'
import type { ShowAlertBehaviorParams } from '@harmony/schema'

const props = defineProps<{
  modelValue: ShowAlertBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: ShowAlertBehaviorParams): void
}>()

const params = computed<ShowAlertBehaviorParams>(() => ({
  title: props.modelValue?.title ?? '',
  message: props.modelValue?.message ?? '',
}))

function updateField<Key extends keyof ShowAlertBehaviorParams>(key: Key, value: ShowAlertBehaviorParams[Key]) {
  emit('update:modelValue', {
    ...params.value,
    [key]: value ?? '',
  })
}
</script>

<template>
  <div class="show-alert-params">
    <v-text-field
      :model-value="params.title"
      label="Alert Title"
      density="compact"
      variant="underlined"
      hide-details
      @update:model-value="updateField('title', $event)"
    />
    <v-textarea
      :model-value="params.message"
      label="Alert Message"
      rows="3"
      density="compact"
      variant="underlined"
      auto-grow
      @update:model-value="updateField('message', $event)"
    />
  </div>
</template>

<style scoped>
.show-alert-params {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
</style>
