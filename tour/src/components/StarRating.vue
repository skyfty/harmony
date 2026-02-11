<template>
  <view class="star-rating" :class="{ 'is-readonly': readonly }">
    <text
      v-for="n in max"
      :key="n"
      class="star"
      :class="{ active: n <= filled }"
    >★</text>
    <text v-if="showValue" class="value">{{ displayValue }}</text>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    value: number;
    max?: number;
    readonly?: boolean;
    showValue?: boolean;
  }>(),
  {
    max: 5,
    readonly: true,
    showValue: false,
  },
);

const filled = computed(() => {
  const raw = Number.isFinite(props.value) ? props.value : 0;
  return Math.max(0, Math.min(props.max, Math.round(raw)));
});

const displayValue = computed(() => {
  const raw = Number.isFinite(props.value) ? props.value : 0;
  return raw.toFixed(1);
});
</script>

<style scoped>
.star-rating {
  display: flex;
  align-items: center;
  gap: 4px;
}

.star {
  font-size: 14px;
  color: #d0d5dd;
}

.star.active {
  color: #ffb340;
}

.value {
  font-size: 12px;
  color: #5f6b83;
  margin-left: 4px;
}
</style>
