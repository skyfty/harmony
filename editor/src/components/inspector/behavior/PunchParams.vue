<script setup lang="ts">
import { computed } from 'vue'
import type { PunchBehaviorParams, PunchCelebrationEffectId } from '@schema/core'
import {
  DEFAULT_PUNCH_CELEBRATION_EFFECT_ID,
  listPunchCelebrationOptions,
  normalizePunchCelebrationEffectId,
} from '@schema/particles/punchCelebration'

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
  </div>
</template>

<style scoped>
.punch-params {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
</style>
