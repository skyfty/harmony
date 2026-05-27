<template>
  <view class="page">
    <MiniAuthRecovery />
    <PageHeader
      title="卡券中心"
      :show-back="false"
    />

    <view class="content">
      <view
        v-for="coupon in coupons"
        :key="coupon.id"
        class="card-item"
        @tap="handleCardTap(coupon)"
      >
        <CouponCard
          :type-code="coupon.type?.code"
          :type-name="coupon.type?.name"
          :title="coupon.title"
          :description="coupon.description"
          :valid-until="coupon.validUntil"
          :status="coupon.status"
        />
        <view
          v-if="coupon.status === 'unused'"
          class="card-actions"
        >
          <button
            class="use-button"
            @tap.stop="handleUseCoupon(coupon)"
          >
            使用
          </button>
        </view>
      </view>

      <view
        v-if="!coupons.length"
        class="empty"
      >
        <text>暂无已获得奖励</text>
      </view>
    </view>

    <BottomNav
      active="coupon"
      @navigate="handleNavigate"
    />
  </view>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import BottomNav from '@/components/BottomNav.vue';
import CouponCard from '@/components/CouponCard.vue';
import MiniAuthRecovery from '@/components/MiniAuthRecovery.vue';
import PageHeader from '@/components/PageHeader.vue';
import { listMyCoupons } from '@/api/mini/coupons';
import { redirectToNav, type NavKey } from '@/utils/navKey';
import type { Coupon } from '@/types/coupon';

defineOptions({
  name: 'CouponsIndexPage',
});

const coupons = ref<Coupon[]>([]);

async function reload() {
  coupons.value = await listMyCoupons();
}

function handleCardTap(coupon: Coupon) {
  if (coupon.id) {
    openUserCoupon(coupon.id);
  }
}

function handleUseCoupon(coupon: Coupon) {
  if (coupon.status !== 'unused') {
    return;
  }
  void uni.showToast({
    title: '使用接口待接入',
    icon: 'none',
  });
}

function openUserCoupon(userCouponId: string) {
  if (!userCouponId) {
    return;
  }
  void uni.navigateTo({ url: `/pages/coupons/detail?id=${encodeURIComponent(userCouponId)}` });
}

onMounted(() => {
  void reload().catch(() => {
    void uni.showToast({ title: '加载失败', icon: 'none' });
  });
});

onShow(() => {
  void reload();
});

function handleNavigate(key: NavKey) {
  redirectToNav(key);
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: linear-gradient(180deg, #eef4ff 0%, #f8fafc 42%, #f3f6fb 100%);
  padding-bottom: 85px;
  padding-bottom: calc(85px + constant(safe-area-inset-bottom));
  padding-bottom: calc(85px + env(safe-area-inset-bottom));
}

.content {
  padding: 14px 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.card-item {
  overflow: visible;
}

.card-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.use-button {
  min-width: 88px;
  height: 34px;
  border-radius: 999px;
  background: linear-gradient(135deg, #1f7aec, #4aa3ff);
  color: #fff;
  font-size: 12px;
  line-height: 34px;
  border: none;
}

.use-button::after {
  border: none;
}

.empty {
  font-size: 14px;
  color: #8a94a6;
  text-align: center;
  padding: 48px 0 32px;
  line-height: 2;
}
</style>
