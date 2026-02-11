<template>
  <view class="card">
    <view class="left">
      <text class="title">{{ title }}</text>
      <text class="desc">{{ description }}</text>
      <text class="meta">有效期至 {{ validUntil }}</text>
    </view>
    <button class="action" :class="{ disabled: status !== 'unused' }" :disabled="status !== 'unused'" @tap="emit('use')">
      {{ statusText }}
    </button>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CouponStatus } from '@/types/coupon';

const props = defineProps<{
  title: string;
  description: string;
  validUntil: string;
  status: CouponStatus;
}>();

const emit = defineEmits<{ (event: 'use'): void }>();

const statusText = computed(() => {
  if (props.status === 'unused') return '使用';
  if (props.status === 'used') return '已使用';
  return '已过期';
});
</script>

<style scoped lang="scss">
.card {
  background: #ffffff;
  border-radius: 16px;
  padding: 14px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
}

.left {
  flex: 1;
}

.title {
  display: block;
  font-size: 15px;
  font-weight: 600;
  color: #1a1f2e;
}

.desc {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: #5f6b83;
}

.meta {
  display: block;
  margin-top: 8px;
  font-size: 11px;
  color: #a8b0c1;
}

.action {
  align-self: center;
  background: #1f7aec;
  color: #ffffff;
  border-radius: 999px;
  font-size: 12px;
  padding: 0 14px;
  height: 32px;
  line-height: 32px;
}

.action.disabled {
  background: #d0d5dd;
  color: #ffffff;
}
</style>
