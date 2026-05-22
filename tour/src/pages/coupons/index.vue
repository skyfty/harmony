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
        <view class="actions">
          <button
            v-if="coupon.status === 'available'"
            class="action-btn action-btn--primary"
            :disabled="purchasingId === coupon.id"
            @tap.stop="handlePurchase(coupon)"
          >
            {{ purchasingId === coupon.id ? '购买中...' : '购买' }}
          </button>
          <button
            v-else-if="coupon.status === 'unused' && coupon.userCouponId"
            class="action-btn action-btn--primary"
            @tap.stop="openUserCoupon(coupon.userCouponId)"
          >
            使用
          </button>
          <view
            v-else
            class="action-state"
          >
            {{ coupon.status === 'expired' ? '已过期' : coupon.status === 'used' ? '已使用' : '不可用' }}
          </view>
        </view>
      </view>

      <view
        v-if="!coupons.length"
        class="empty"
      >
        <text>暂无可见卡券</text>
      </view>
    </view>

    <BottomNav
      active="coupon"
      @navigate="handleNavigate"
    />
    <PhoneBindSheet
      v-model="showPhoneBindSheet"
      @bound="handlePhoneBound"
    />
  </view>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import BottomNav from '@/components/BottomNav.vue';
import CouponCard from '@/components/CouponCard.vue';
import PhoneBindSheet from '@/components/PhoneBindSheet.vue';
import MiniAuthRecovery from '@/components/MiniAuthRecovery.vue';
import PageHeader from '@/components/PageHeader.vue';
import { listCouponCatalog, purchaseCouponByProduct } from '@/api/mini/coupons';
import { redirectToNav, type NavKey } from '@/utils/navKey';
import {
  requestMiniProgramPayment,
  toCheckoutErrorMessage,
  isPhoneBindingRequiredError,
  isProfileCompletionRequiredError,
  promptCompleteProfileBeforeCheckout,
} from '@/utils/checkout';
import type { CouponCatalogItem } from '@/types/coupon';

defineOptions({
  name: 'CouponsIndexPage',
});

const coupons = ref<CouponCatalogItem[]>([]);
const purchasingId = ref('');
const showPhoneBindSheet = ref(false);
const pendingPurchaseProductId = ref('');
const purchaseCoupon = purchaseCouponByProduct as unknown as (productId: string) => Promise<{
  order?: { id: string };
  payParams?: {
    appId: string;
    timeStamp: string;
    nonceStr: string;
    package: string;
    signType: 'RSA';
    paySign: string;
  };
}>;

async function reload() {
  coupons.value = await listCouponCatalog();
}

async function waitForOwnershipSync(couponId: string): Promise<boolean> {
  const maxAttempts = 8;
  const intervalMs = 700;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await reload();
    const current = coupons.value.find((item) => item.id === couponId);
    if (current && current.status !== 'available') {
      return true;
    }
    if (attempt < maxAttempts - 1) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, intervalMs);
      });
    }
  }
  return false;
}

function handleCardTap(coupon: CouponCatalogItem) {
  if (coupon.status === 'unused' && coupon.userCouponId) {
    openUserCoupon(coupon.userCouponId);
  }
}

async function handlePhoneBound() {
  const productId = pendingPurchaseProductId.value;
  pendingPurchaseProductId.value = '';
  if (!productId) {
    return;
  }
  await handlePurchaseByProductId(productId, true);
}

function openUserCoupon(userCouponId: string) {
  if (!userCouponId) {
    return;
  }
  void uni.navigateTo({ url: `/pages/coupons/detail?id=${encodeURIComponent(userCouponId)}` });
}

async function handlePurchaseByProductId(productId: string, fromRetry = false) {
  if (!productId || purchasingId.value) {
    return;
  }

  const coupon = coupons.value.find((item) => item.productId === productId && item.status === 'available') ?? null;
  if (!coupon) {
    return;
  }

  purchasingId.value = coupon.id;
  void uni.showLoading({ title: fromRetry ? '重新购买中...' : '购买中...' });
  try {
    const result = await purchaseCoupon(productId);
    if (result.payParams) {
      await requestMiniProgramPayment(result.payParams);
    }
    const synced = await waitForOwnershipSync(coupon.id);
    void uni.showToast({ title: synced ? '购买成功' : '支付完成，状态同步中...', icon: 'none' });
  } catch (error: unknown) {
    if (isPhoneBindingRequiredError(error)) {
      pendingPurchaseProductId.value = productId;
      showPhoneBindSheet.value = true;
      return;
    }
    if (isProfileCompletionRequiredError(error)) {
      await promptCompleteProfileBeforeCheckout();
      return;
    }
    void uni.showToast({ title: toCheckoutErrorMessage(error, '购买失败'), icon: 'none' });
  } finally {
    purchasingId.value = '';
    void uni.hideLoading();
  }
}

async function handlePurchase(coupon: CouponCatalogItem) {
  if (!coupon.productId || purchasingId.value || coupon.status !== 'available') {
    return;
  }
  await handlePurchaseByProductId(coupon.productId);
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

.actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

.action-btn {
  min-width: 118px;
  height: 36px;
  line-height: 36px;
  border-radius: 999px;
  font-size: 13px;
  padding: 0 16px;
}

.action-btn--primary {
  background: linear-gradient(135deg, #1f7aec, #4aa3ff);
  color: #ffffff;
}

.action-state {
  min-width: 118px;
  height: 36px;
  line-height: 36px;
  text-align: center;
  border-radius: 999px;
  background: rgba(138, 148, 166, 0.12);
  color: #8a94a6;
  font-size: 13px;
  padding: 0 16px;
}

.empty {
  font-size: 14px;
  color: #8a94a6;
  text-align: center;
  padding: 48px 0 32px;
  line-height: 2;
}
</style>
