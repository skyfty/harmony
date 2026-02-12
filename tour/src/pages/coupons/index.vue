<template>
  <view class="page">
    <view class="header">
      <text class="title">卡券中心</text>
    </view>
    <view class="content">
      <CouponCard
        v-for="coupon in coupons"
        :key="coupon.id"
        :title="coupon.title"
        :description="coupon.description"
        :valid-until="coupon.validUntil"
        :status="coupon.status"
        @use="handleUse(coupon.id)"
      />
    </view>
    <BottomNav active="coupon" @navigate="handleNavigate" />
  </view>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import BottomNav from '@/components/BottomNav.vue';
import CouponCard from '@/components/CouponCard.vue';
import { listMyCoupons } from '@/api/mini/coupons';
import { redirectToNav, type NavKey } from '@/utils/navKey';
import type { Coupon } from '@/types/coupon';

const coupons = ref<Coupon[]>([]);

async function reload() {
  coupons.value = await listMyCoupons();
}

onMounted(() => {
  void reload().catch(() => {
    uni.showToast({ title: '加载失败', icon: 'none' });
  });
});

function handleUse(_id: string) {
  uni.showToast({ title: '已使用', icon: 'none' });
}

function handleNavigate(key: NavKey) {
  redirectToNav(key);
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f8f8f8;
  padding-bottom: 85px;
  padding-bottom: calc(85px + constant(safe-area-inset-bottom));
  padding-bottom: calc(85px + env(safe-area-inset-bottom));
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
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
</style>
