<script setup lang="ts">
import { computed } from 'vue'
import type { PunchBehaviorParams, PunchCelebrationEffectId } from '@schema/core'
import {
  DEFAULT_PUNCH_CELEBRATION_EFFECT_ID,
  listPunchCelebrationOptions,
  normalizePunchCelebrationEffectId,
} from '@schema/particles/punchCelebration'
import {
  DEFAULT_PUNCH_SUCCESS_PROMPT_DURATION_SECONDS,
  normalizePunchSuccessPromptDuration,
} from '@schema/behaviors/punchSuccessPrompt'

const props = defineProps<{
  modelValue: PunchBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: PunchBehaviorParams): void
}>()

const params = computed<PunchBehaviorParams>(() => ({
  celebrationEffectId: normalizePunchCelebrationEffectId(
    props.modelValue?.celebrationEffectId ?? DEFAULT_PUNCH_CELEBRATION_EFFECT_ID,
  ),
  celebrationOnlyFirst: props.modelValue?.celebrationOnlyFirst !== false,
  showSuccessPrompt: props.modelValue?.showSuccessPrompt !== false,
  successPromptDurationSeconds: normalizePunchSuccessPromptDuration(
    props.modelValue?.successPromptDurationSeconds ?? DEFAULT_PUNCH_SUCCESS_PROMPT_DURATION_SECONDS,
  ),
}))

const effectItems = listPunchCelebrationOptions()

function update(next: Partial<PunchBehaviorParams>): void {
  emit('update:modelValue', {
    ...params.value,
    ...next,
  })
}

function updateEffect(value: PunchCelebrationEffectId | null | undefined): void {
  const effectId = normalizePunchCelebrationEffectId(value)
  update({ celebrationEffectId: effectId })
}

function updateSuccessPromptDuration(value: string | number | null | undefined): void {
  update({
    successPromptDurationSeconds: normalizePunchSuccessPromptDuration(value),
  })
}
</script>

<template>
  <div class="punch-params">
    <v-select
      :model-value="params.celebrationEffectId"
      :items="effectItems"
      item-title="title"
      item-value="value"
      label="打卡动画"
      density="compact"
      variant="underlined"
      hide-details
      @update:model-value="updateEffect"
    />
    <v-switch
      v-if="params.celebrationEffectId !== 'none'"
      :model-value="params.celebrationOnlyFirst"
      label="仅首次打卡播放"
      density="compact"
      hide-details
      color="primary"
      @update:model-value="update({ celebrationOnlyFirst: Boolean($event) })"
    />
    <v-divider class="punch-params__divider" />
    <v-switch
      :model-value="params.showSuccessPrompt"
      label="显示打卡成功提示"
      density="compact"
      hide-details
      color="primary"
      @update:model-value="update({ showSuccessPrompt: Boolean($event) })"
    />
    <v-text-field
      v-if="params.showSuccessPrompt"
      :model-value="params.successPromptDurationSeconds"
      type="number"
      label="提示停留时长（秒）"
      density="compact"
      variant="underlined"
      hide-details
      min="0"
      step="0.1"
      @update:model-value="updateSuccessPromptDuration"
    />
  </div>
</template>

<style scoped>
.punch-params {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.punch-params__divider {
  margin: 0.25rem 0;
}
</style>
