<template>
  <view class="page">
    <PageHeader
      title="卡券中心"
      :show-back="false"
    />
    <view class="content">
      <view
        v-for="coupon in filteredCoupons"
        :key="coupon.id"
        class="card-item"
        @tap="openDetail(coupon.id)"
      >
        <CouponCard
          :type-code="coupon.type?.code"
          :type-name="coupon.type?.name"
          :title="coupon.title"
          :description="coupon.description"
          :valid-until="coupon.validUntil"
          :status="coupon.status"
          @use="openDetail(coupon.id)"
        />
      </view>
      <view
        v-if="!filteredCoupons.length"
        class="empty"
      >
        <text>
          🎫
        </text>
        <text>
          暂无卡券
        </text>
      </view>
    </view>
    <BottomNav
      active="coupon"
      @navigate="handleNavigate"
    />
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { getStatusBarHeight } from '@/utils/systemInfo';

const statusBarHeight = ref(getStatusBarHeight());
import { onMounted } from 'vue';
import BottomNav from '@/components/BottomNav.vue';
import PageHeader from '@/components/PageHeader.vue';
import CouponCard from '@/components/CouponCard.vue';
import { listMyCoupons } from '@/api/mini/coupons';
import { redirectToNav, type NavKey } from '@/utils/navKey';
import type { Coupon, CouponStatus } from '@/types/coupon';

defineOptions({
  name: 'CouponsIndexPage',
});

const coupons = ref<Coupon[]>([]);
const keyword = ref('');
const selectedStatus = ref<'all' | CouponStatus>('all');

async function reload() {
  coupons.value = await listMyCoupons();
}

const filteredCoupons = computed(() => {
  let items = coupons.value;
  if (selectedStatus.value !== 'all') {
    items = items.filter((item) => item.status === selectedStatus.value);
  }
  const text = keyword.value.trim();
  if (!text) {
    return items;
  }
  return items.filter((item) => item.title.includes(text) || item.description.includes(text));
});

onMounted(() => {
  void reload().catch(() => {
    void uni.showToast({ title: '加载失败', icon: 'none' });
  });
});

onShow(() => {
  void reload();
});

function openDetail(id: string) {
  void uni.navigateTo({ url: `/pages/coupons/detail?id=${encodeURIComponent(id)}` });
}

function handleNavigate(key: NavKey) {
  redirectToNav(key);
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f3f6fb;
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

.empty {
  font-size: 14px;
  color: #8a94a6;
  text-align: center;
  padding: 48px 0 32px;
  line-height: 2;
}
</style>
