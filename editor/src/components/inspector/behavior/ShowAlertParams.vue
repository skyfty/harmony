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
  content: props.modelValue?.content ?? '',
  showConfirm: props.modelValue?.showConfirm ?? true,
  confirmText: props.modelValue?.confirmText ?? 'Confirm',
  showCancel: props.modelValue?.showCancel ?? false,
  cancelText: props.modelValue?.cancelText ?? 'Cancel',
}))

function updateField<Key extends keyof ShowAlertBehaviorParams>(key: Key, value: ShowAlertBehaviorParams[Key]) {
  emit('update:modelValue', {
    ...params.value,
    [key]: value,
  })
}
</script>

<template>
  <div class="show-alert-params">
    <v-textarea
      :model-value="params.content"
      label="Alert Message"
      rows="3"
      density="compact"
      variant="underlined"
      auto-grow
  @update:model-value="updateField('content', $event ?? '')"
    />
    <div class="show-alert-params__toggles">
      <v-checkbox
        :model-value="params.showConfirm"
        label="Show Confirm Button"
        density="compact"
        hide-details
  @update:model-value="updateField('showConfirm', Boolean($event))"
      />
      <v-text-field
        v-if="params.showConfirm"
        :model-value="params.confirmText"
        label="Confirm Button Text"
        density="compact"
        variant="underlined"
        hide-details
  @update:model-value="updateField('confirmText', $event ?? '')"
      />
      <v-checkbox
        :model-value="params.showCancel"
        label="Show Cancel Button"
        density="compact"
        hide-details
  @update:model-value="updateField('showCancel', Boolean($event))"
      />
      <v-text-field
        v-if="params.showCancel"
        :model-value="params.cancelText"
        label="Cancel Button Text"
        density="compact"
        variant="underlined"
        hide-details
  @update:model-value="updateField('cancelText', $event ?? '')"
      />
    </div>
  </div>
</template>

<style scoped>
.show-alert-params {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.show-alert-params__toggles {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.show-alert-params :deep(.v-input--density-compact) {
  --v-input-padding-top: 0;
  --v-input-padding-bottom: 0;
}
</style>
