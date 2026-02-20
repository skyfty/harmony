<template>
  <view class="page">
    <view class="header">
      <text class="title">
        卡券详情
      </text>
    </view>

    <view
      v-if="!coupon"
      class="empty"
    >
      <text class="empty-text">
        卡券不存在
      </text>
      <button
        class="btn ghost"
        @tap="back"
      >
        返回
      </button>
    </view>

    <view
      v-else
      class="content"
    >
      <view class="card">
        <text class="name">
          {{ coupon.title }}
        </text>
        <text class="desc">
          {{ coupon.description }}
        </text>

        <view class="row">
          <text class="label">
            状态
          </text>
          <text class="value">
            {{ statusText(coupon.status) }}
          </text>
        </view>
        <view class="row">
          <text class="label">
            有效期至
          </text>
          <text class="value">
            {{ coupon.validUntil }}
          </text>
        </view>
        <view
          v-if="coupon.claimedAt"
          class="row"
        >
          <text class="label">
            领取时间
          </text>
          <text class="value">
            {{ formatDateTime(coupon.claimedAt) }}
          </text>
        </view>
        <view
          v-if="coupon.usedAt"
          class="row"
        >
          <text class="label">
            使用时间
          </text>
          <text class="value">
            {{ formatDateTime(coupon.usedAt) }}
          </text>
        </view>
      </view>

      <button
        class="btn"
        :class="{ disabled: coupon.status !== 'unused' }"
        :disabled="coupon.status !== 'unused' || submitting"
        @tap="handleUse"
      >
        {{ coupon.status === 'unused' ? (submitting ? '使用中...' : '立即使用') : statusText(coupon.status) }}
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';
import { ref } from 'vue';
import { getMyCouponDetail, useMyCoupon } from '@/api/mini/coupons';
import type { Coupon, CouponStatus } from '@/types/coupon';

defineOptions({
  name: 'CouponDetailPage',
});

const coupon = ref<Coupon | null>(null);
const couponId = ref('');
const submitting = ref(false);
const fetchCouponDetail = getMyCouponDetail as (id: string) => Promise<Coupon>;
const submitCouponUse = useMyCoupon as (id: string) => Promise<Coupon>;

onLoad((query) => {
  couponId.value = typeof query?.id === 'string' ? query.id : '';
  if (!couponId.value) {
    return;
  }
  void reload();
});

async function reload() {
  try {
    coupon.value = await fetchCouponDetail(couponId.value);
  } catch {
    coupon.value = null;
    void uni.showToast({ title: '加载失败', icon: 'none' });
  }
}

async function handleUse() {
  if (!coupon.value || coupon.value.status !== 'unused') {
    return;
  }
  submitting.value = true;
  try {
    coupon.value = await submitCouponUse(couponId.value);
    void uni.showToast({ title: '使用成功', icon: 'none' });
  } finally {
    submitting.value = false;
  }
}

function back() {
  void uni.navigateBack();
}

function statusText(status: CouponStatus) {
  if (status === 'used') return '已使用';
  if (status === 'expired') return '已过期';
  return '未使用';
}

function formatDateTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mi = `${d.getMinutes()}`.padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd} ${hh}:${mi}`;
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f8f8f8;
}

.header {
  padding: 16px;
}

.title {
  font-size: 16px;
  font-weight: 700;
  color: #1a1f2e;
}

.content {
  padding: 0 16px 18px;
}

.card {
  background: #ffffff;
  border-radius: 16px;
  padding: 14px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
}

.name {
  display: block;
  font-size: 16px;
  font-weight: 700;
  color: #1a1f2e;
}

.desc {
  display: block;
  margin-top: 8px;
  font-size: 13px;
  color: #5f6b83;
}

.row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
}

.label {
  font-size: 12px;
  color: #8a94a6;
}

.value {
  font-size: 12px;
  color: #1a1f2e;
}

.btn {
  margin-top: 16px;
  width: 100%;
  background: #1f7aec;
  color: #ffffff;
  border-radius: 999px;
  height: 40px;
  line-height: 40px;
  font-size: 13px;
}

.btn.disabled {
  background: #d0d5dd;
}

.btn.ghost {
  width: 160px;
  margin-left: auto;
  margin-right: auto;
}

.empty {
  padding: 40px 16px;
  text-align: center;
}

.empty-text {
  display: block;
  font-size: 13px;
  color: #1a1f2e;
}
</style>
