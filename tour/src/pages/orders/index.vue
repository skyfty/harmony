<template>
  <view class="page">
    <MiniAuthRecovery />
    <PageHeader title="订单中心" />

    <view class="content">
      <view v-if="orders.length === 0" class="empty">暂无订单</view>

      <view v-for="order in orders" :key="order.id" class="card" @tap="openDetail(order.id)">
        <view class="row">
          <text class="no">{{ order.orderNumber }}</text>
          <text class="status">{{ statusText(order.status) }} / {{ paymentStatusText(order.paymentStatus) }}</text>
        </view>
        <view class="meta">
          <text class="meta-text">下单时间 {{ formatDate(order.createdAt) }}</text>
          <text class="meta-text">共 {{ itemCount(order) }} 件</text>
        </view>
        <view class="footer">
          <text class="amount">¥ {{ order.totalAmount }}</text>
          <view class="footer-action">
            <button
              v-if="showPayAction(order)"
              class="pay-btn"
              :disabled="payingOrderId === order.id"
              @tap.stop="submitPayment(order.id)"
            >{{ payingOrderId === order.id ? '支付中...' : '立即支付' }}</button>
            <button class="detail-btn" @tap.stop="openDetail(order.id)">详情</button>
            <text class="link">查看详情 ›</text>
          </view>
        </view>
      </view>
    </view>
    <PhoneBindSheet v-model="showPhoneBindSheet" @bound="handlePhoneBound" />
  </view>
</template>

<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { ref } from 'vue';
import { listOrders, payOrder } from '@/api/mini';
import MiniAuthRecovery from '@/components/MiniAuthRecovery.vue';
import PageHeader from '@/components/PageHeader.vue';
import PhoneBindSheet from '@/components/PhoneBindSheet.vue';
import type { OrderListItem, OrderStatus } from '@/types/order';
import type { PaymentStatus } from '@/types/order';
import {
  isProfileCompletionRequiredError,
  isPhoneBindingRequiredError,
  promptCompleteProfileBeforeCheckout,
  requestMiniProgramPayment,
  toCheckoutErrorMessage,
} from '@/utils/checkout';

const orders = ref<OrderListItem[]>([]);
const payingOrderId = ref('');
const showPhoneBindSheet = ref(false);
const pendingOrderId = ref('');

onShow(() => {
  void reload();
});

async function reload() {
  try {
    orders.value = await listOrders();
  } catch {
    uni.showToast({ title: '加载失败', icon: 'none' });
  }
}

function itemCount(order: OrderListItem) {
  return order.items.reduce((total, item) => total + (item.quantity || 0), 0);
}

function openDetail(id: string) {
  uni.navigateTo({ url: `/pages/orders/detail/index?id=${encodeURIComponent(id)}` });
}

function showPayAction(order: OrderListItem) {
  const status = order.orderStatus || order.status;
  return status === 'pending' && ['unpaid', 'failed', 'closed'].includes(order.paymentStatus);
}

function statusText(status: OrderStatus) {
  if (status === 'pending') return '待支付';
  if (status === 'paid') return '已支付';
  if (status === 'completed') return '已完成';
  return '已取消';
}

function paymentStatusText(status: PaymentStatus) {
  if (status === 'unpaid') return '未支付';
  if (status === 'processing') return '支付中';
  if (status === 'succeeded') return '支付成功';
  if (status === 'failed') return '支付失败';
  if (status === 'refunded') return '已退款';
  return '已关闭';
}

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

async function submitPayment(orderId: string) {
  if (!orderId || payingOrderId.value) {
    return;
  }

  payingOrderId.value = orderId;
  void uni.showLoading({ title: '发起支付...' });
  try {
    const result = await payOrder(orderId);
    if (result.payParams) {
      await requestMiniProgramPayment(result.payParams);
      void uni.showToast({ title: '支付成功', icon: 'none' });
    } else {
      void uni.showToast({ title: '支付请求已提交', icon: 'none' });
    }
  } catch (error) {
    if (isPhoneBindingRequiredError(error)) {
      pendingOrderId.value = orderId;
      showPhoneBindSheet.value = true;
      return;
    }
    if (isProfileCompletionRequiredError(error)) {
      await promptCompleteProfileBeforeCheckout();
      return;
    }
    void uni.showToast({ title: toCheckoutErrorMessage(error, '支付失败'), icon: 'none' });
  } finally {
    payingOrderId.value = '';
    void uni.hideLoading();
    await reload();
  }
}

async function handlePhoneBound() {
  const orderId = pendingOrderId.value;
  pendingOrderId.value = '';
  if (!orderId || payingOrderId.value) {
    return;
  }
  await submitPayment(orderId);
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f8f8f8;
}

.content {
  padding: 12px 16px 24px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.card {
  background: #ffffff;
  border-radius: 16px;
  padding: 14px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.no {
  font-size: 13px;
  color: #1a1f2e;
  font-weight: 600;
}

.status {
  font-size: 12px;
  color: #1f7aec;
}

.meta {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
}

.meta-text {
  font-size: 11px;
  color: #8a94a6;
}

.footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
}

.footer-action {
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail-btn {
  margin: 0;
  background: rgba(31, 122, 236, 0.1);
  color: #1f7aec;
  border-radius: 999px;
  height: 28px;
  line-height: 28px;
  font-size: 12px;
  padding: 0 12px;
}

.pay-btn {
  margin: 0;
  background: linear-gradient(135deg, #1f7aec, #43a2ff);
  color: #ffffff;
  border-radius: 999px;
  height: 28px;
  line-height: 28px;
  font-size: 12px;
  padding: 0 12px;
}

.amount {
  font-size: 15px;
  font-weight: 700;
  color: #1a1f2e;
}

.link {
  font-size: 12px;
  color: #a8b0c1;
}

.empty {
  text-align: center;
  color: #a8b0c1;
  font-size: 12px;
  padding: 40px 0;
}
</style>
