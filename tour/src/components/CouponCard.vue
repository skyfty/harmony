<template>
  <view class="card">
    <view class="icon-box">
      <image
        class="icon"
        mode="aspectFit"
        :src="typeIconSrc"
      />
    </view>
    <view class="main">
      <text class="title">
        {{ title }}
      </text>
    </view>
    <view class="action-wrap">
      <button
        class="action"
        :class="{ disabled: status !== 'unused' }"
        :disabled="status !== 'unused'"
        @tap.stop="emit('use')"
      >
        {{ statusText }}
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CouponStatus } from '@/types/coupon';

const props = defineProps<{
  typeCode?: string;
  typeName?: string;
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

const iconMap: Record<string, string> = {
  ticket: '/static/icons/coupons/ticket.svg',
  souvenir: '/static/icons/coupons/souvenir.svg',
  photo: '/static/icons/coupons/photo.svg',
  discount: '/static/icons/coupons/discount.svg',
};

const typeIconSrc = computed(() => {
  const code = (props.typeCode || '').toLowerCase();
  return iconMap[code] ?? '/static/icons/coupons/default.svg';
});
</script>

<style scoped lang="scss">
.card {
  background: #d4e7f6;
  border-radius: 16px;
  display: flex;
  align-items: stretch;
  overflow: hidden;
  border: 1px solid #9ec5ea;
  box-shadow: 0 4px 10px rgba(31, 122, 236, 0.12);
  min-height: 58px;
}

.icon-box {
  width: 58px;
  background: #c2c8f0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.icon {
  width: 24px;
  height: 24px;
  display: block;
}

.main {
  flex: 1;
  display: flex;
  align-items: center;
  padding: 0 14px;
  min-width: 0;
}

.title {
  display: block;
  font-size: 19px;
  font-weight: 600;
  color: #2c3a4f;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.action-wrap {
  width: 74px;
  background: #dbeaf7;
  border-left: 1px solid #c3dbef;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.action {
  background: #ff7a00;
  color: #ffffff;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  padding: 0;
  width: 52px;
  height: 28px;
  line-height: 28px;
}

.action.disabled {
  background: #b7bec9;
  color: #ffffff;
}
</style>
