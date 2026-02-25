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
  background: #f3f6fb;
  padding-bottom: 85px;
  padding-bottom: calc(85px + constant(safe-area-inset-bottom));
  padding-bottom: calc(85px + env(safe-area-inset-bottom));
}

.header {
  padding: 8px 16px 12px;
}

.title {
  font-size: 22px;
  font-weight: 700;
  color: #171f37;
  text-align: center;
  margin-bottom: 14px;
}

.search-box {
  background: #e6ebf3;
  border-radius: 999px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-icon {
  font-size: 14px;
  color: #94a0b6;
}

.search-input {
  flex: 1;
  font-size: 13px;
  color: #1b2438;
}

.clear-icon {
  font-size: 14px;
  color: #8f99ac;
}

.content {
  padding: 12px 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.empty {
  font-size: 13px;
  color: #8b96aa;
  text-align: center;
  padding: 28px 0;
}
</style>
