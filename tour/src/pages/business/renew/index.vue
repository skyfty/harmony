<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <view class="page">
    <MiniAuthRecovery />
    <PageHeader title="续费订单" />

    <view class="content">
      <view v-if="loading" class="card">
        <text class="card-title">加载中...</text>
      </view>

      <template v-else-if="order && preview">
        <view class="hero-card">
          <text class="hero-title">{{ order.scenicName }}</text>
          <text class="hero-desc">当前服务期 {{ formatDate(order.service.startAt) || '待生效' }} - {{ formatDate(order.service.endAt) || '待设置' }}</text>
        </view>

        <view class="card">
          <text class="card-title">续费预览</text>
          <view class="preview-grid">
            <view class="preview-item">
              <text class="preview-label">当前到期时间</text>
              <text class="preview-value">{{ formatDate(preview.currentServiceEndAt) || '立即生效' }}</text>
            </view>
            <view class="preview-item">
              <text class="preview-label">续费后开始时间</text>
              <text class="preview-value">{{ formatDate(preview.nextServiceStartAt) }}</text>
            </view>
            <view class="preview-item">
              <text class="preview-label">续费后结束时间</text>
              <text class="preview-value">{{ formatDate(preview.nextServiceEndAt) }}</text>
            </view>
            <view class="preview-item">
              <text class="preview-label">续费时长</text>
              <text class="preview-value">{{ preview.durationDays }} 天</text>
            </view>
          </view>
        </view>

        <view class="card">
          <text class="card-title">费用信息</text>
          <view class="money-panel">
            <text class="money-caption">续费金额</text>
            <text class="money-value">¥ {{ preview.amount }}</text>
            <text class="money-hint">提交后会生成一笔续费订单，并在后台确认后顺延服务时间。</text>
          </view>
        </view>

        <button v-if="paymentEnabled" class="primary-btn" :disabled="submitting" @tap="submitRenewal">{{ submitting ? '提交中...' : '确认续费' }}</button>
        <view v-else class="card">当前平台暂未开放续费支付。</view>
      </template>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import MiniAuthRecovery from '@/components/MiniAuthRecovery.vue';
import PageHeader from '@/components/PageHeader.vue';
import { getBusinessOrderDetail, getBusinessOrderRenewalPreview, payBusinessOrderRenewal } from '@/api/mini';
import type { BusinessOrder, BusinessOrderRenewalPreview } from '@/types/business';
import { requestMiniProgramPayment, toCheckoutErrorMessage } from '@/utils/checkout';
import { ensureMiniCapability } from '@/platform/runtime';

const loading = ref(true);
const submitting = ref(false);
const orderId = ref('');
const order = ref<BusinessOrder | null>(null);
const preview = ref<BusinessOrderRenewalPreview | null>(null);
const paymentEnabled = ref(false);

onLoad((options) => {
  void ensureMiniCapability('payment').then((enabled) => { paymentEnabled.value = enabled; }).catch(() => { paymentEnabled.value = false; });
  orderId.value = typeof options?.id === 'string' ? options.id : '';
});

onShow(() => {
  void loadData();
});

async function loadData() {
  if (!orderId.value) {
    return;
  }
  loading.value = true;
  try {
    const [orderDetail, renewalPreview] = await Promise.all([
      getBusinessOrderDetail(orderId.value),
      getBusinessOrderRenewalPreview(orderId.value),
    ]);
    order.value = orderDetail;
    preview.value = renewalPreview;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '续费信息加载失败';
    void uni.showToast({ title: message, icon: 'none' });
  } finally {
    loading.value = false;
  }
}

async function submitRenewal() {
  if (submitting.value || !orderId.value) {
    return;
  }
  submitting.value = true;
  void uni.showLoading({ title: '发起支付...' });
  try {
    const result = await payBusinessOrderRenewal(orderId.value);
    if (result.payParams) {
      await requestMiniProgramPayment(result.payParams);
      void uni.showToast({ title: '续费支付成功', icon: 'success' });
    } else {
      void uni.showToast({ title: '续费请求已提交', icon: 'none' });
    }
    setTimeout(() => {
      void uni.redirectTo({ url: `/pages/business/detail/index?id=${encodeURIComponent(orderId.value)}` });
    }, 500);
  } catch (error: unknown) {
    void uni.showToast({ title: toCheckoutErrorMessage(error, '续费提交失败'), icon: 'none' });
  } finally {
    submitting.value = false;
    void uni.hideLoading();
  }
}

function formatDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}.${month}.${day}`;
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background:
    radial-gradient(circle at top right, rgba(255, 159, 67, 0.18), transparent 28%),
    linear-gradient(180deg, #13243b 0%, #13243b 14%, #f4f6f8 14%, #f7f8fa 100%);
}

.content {
  padding: 16px;
}

.hero-card,
.card {
  border-radius: 24px;
  background: #fff;
  box-shadow: 0 18px 40px rgba(16, 35, 57, 0.08);
}

.hero-card {
  padding: 22px 20px;
  background: linear-gradient(135deg, #10284a, #2c4f80);
}

.hero-title {
  color: #fff;
  font-size: 22px;
  font-weight: 700;
}

.hero-desc {
  margin-top: 8px;
  display: block;
  color: rgba(255, 255, 255, 0.76);
  font-size: 13px;
}

.card {
  margin-top: 16px;
  padding: 18px;
}

.card-title {
  color: #13243b;
  font-size: 16px;
  font-weight: 700;
}

.preview-grid {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.preview-item {
  padding: 14px;
  border-radius: 18px;
  background: #f5f7fb;
}

.preview-label {
  color: #8390a4;
  font-size: 11px;
}

.preview-value {
  margin-top: 6px;
  display: block;
  color: #13243b;
  font-size: 14px;
  font-weight: 600;
}

.money-panel {
  margin-top: 14px;
  padding: 16px;
  border-radius: 20px;
  background: linear-gradient(135deg, rgba(255, 159, 67, 0.14), rgba(255, 107, 0, 0.08));
}

.money-caption {
  color: #8d5a13;
  font-size: 12px;
}

.money-value {
  margin-top: 10px;
  display: block;
  color: #13243b;
  font-size: 28px;
  font-weight: 700;
}

.money-hint {
  margin-top: 8px;
  display: block;
  color: #6d7c91;
  font-size: 12px;
  line-height: 1.6;
}

.primary-btn {
  margin-top: 18px;
  background: linear-gradient(135deg, #ff9f43, #ff6b00);
  color: #fff;
  border-radius: 999px;
  font-size: 14px;
}
</style>
