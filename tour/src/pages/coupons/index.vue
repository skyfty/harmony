<template>
  <view class="page">
    <PageHeader title="卡券中心"  :showBack="false" />
    <view class="content">
      <view
        v-for="coupon in filteredCoupons"
        :key="coupon.id"
        @tap="openDetail(coupon.id)"
      >
        <CouponCard
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
          暂无符合条件的卡券
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

const statusBarHeight = ref(0);
try {
  const sysInfo = uni.getSystemInfoSync();
  statusBarHeight.value = sysInfo?.statusBarHeight ?? 0;
} catch { /* fallback */ }
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

const statusOptions: Array<{ label: string; value: 'all' | CouponStatus }> = [
  { label: '全部', value: 'all' },
  { label: '未使用', value: 'unused' },
  { label: '已使用', value: 'used' },
  { label: '已过期', value: 'expired' },
];

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

.search-box {
  margin-top: 12px;
  background: #ffffff;
  border-radius: 14px;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
}

.search-input {
  flex: 1;
  font-size: 13px;
  color: #1a1f2e;
}

.clear-icon {
  font-size: 14px;
  color: #a8b0c1;
}

.status-tabs {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.status-tab {
  background: #ffffff;
  border-radius: 999px;
  text-align: center;
  padding: 6px 0;
  font-size: 12px;
  color: #5f6b83;
}

.status-tab.active {
  background: #1f7aec;
  color: #ffffff;
}

.content {
  padding: 0 16px 18px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.empty {
  padding: 40px 0;
  text-align: center;
  color: #8a94a6;
}
</style>
