<template>
  <view class="page">
    <PageHeader title="订单详情" />

    <view
      v-if="!order"
      class="empty"
    >
      <text class="empty-text">
        订单不存在
      </text>
    </view>

    <view
      v-else
      class="content"
    >
      <view class="card">
        <text class="section-title">
          订单信息
        </text>

        <view class="row">
          <text class="label">
            订单编号
          </text>
          <text class="value">
            {{ order.orderNumber }}
          </text>
        </view>
        <view class="row">
          <text class="label">
            客户姓名
          </text>
          <text class="value">
            {{ order.customerName || '-' }}
          </text>
        </view>
        <view class="row">
          <text class="label">
            订单金额
          </text>
          <text class="value amount">
            ¥ {{ order.totalAmount }}
          </text>
        </view>
        <view class="row">
          <text class="label">
            订单状态
          </text>
          <text class="value">
            {{ statusText(order.status) }}
          </text>
        </view>
        <view class="row">
          <text class="label">
            支付状态
          </text>
          <text class="value">
            {{ paymentStatusText(order.paymentStatus) }}
          </text>
        </view>
        <view class="row" v-if="order.transactionId">
          <text class="label">
            支付流水号
          </text>
          <text class="value">
            {{ order.transactionId }}
          </text>
        </view>
        <view class="row" v-if="order.paidAt">
          <text class="label">
            支付时间
          </text>
          <text class="value">
            {{ formatDateTime(order.paidAt) }}
          </text>
        </view>
        <view class="row">
          <text class="label">
            下单时间
          </text>
          <text class="value">
            {{ formatDateTime(order.createdAt) }}
          </text>
        </view>
      </view>

      <view class="card">
        <text class="section-title">
          商品信息
        </text>

        <view
          v-if="!order.items.length"
          class="sub-empty"
        >
          <text class="sub-empty-text">
            暂无商品
          </text>
        </view>

        <view
          v-for="(item, index) in order.items"
          :key="`${item.productId}-${index}`"
          class="item-row"
        >
          <view class="item-main">
            <text class="item-name">
              {{ item.name }}
            </text>
            <text class="item-qty">
              x {{ item.quantity }}
            </text>
          </view>
          <text class="item-price">
            ¥ {{ item.price }}
          </text>
        </view>
      </view>

      <view
        v-if="vehicleItems.length"
        class="card"
      >
        <text class="section-title">
          交通工具信息
        </text>

        <view
          v-for="(item, index) in vehicleItems"
          :key="`${item.productId}-vehicle-${index}`"
          class="vehicle-block"
        >
          <view class="row">
            <text class="label">
              关联商品
            </text>
            <text class="value">
              {{ item.name }}
            </text>
          </view>
          <view class="row">
            <text class="label">
              交通工具名称
            </text>
            <text class="value">
              {{ item.vehicle?.name || '-' }}
            </text>
          </view>
          <view class="row">
            <text class="label">
              标识
            </text>
            <text class="value">
              {{ item.vehicle?.identifier || '-' }}
            </text>
          </view>
          <view class="row">
            <text class="label">
              描述
            </text>
            <text class="value">
              {{ item.vehicle?.description || '-' }}
            </text>
          </view>
          <image
            v-if="item.vehicle?.coverUrl"
            class="vehicle-cover"
            :src="item.vehicle.coverUrl"
            mode="aspectFill"
          />
        </view>
      </view>

      <view
        v-if="showPayAction"
        class="pay-bar"
      >
        <view class="pay-summary">
          <text class="pay-summary-label">
            待支付金额
          </text>
          <text class="pay-summary-value">
            ¥ {{ order?.totalAmount ?? 0 }}
          </text>
        </view>
        <button
          class="pay-button"
          :disabled="paying"
          @tap="submitPayment"
        >
          {{ paying ? '支付中...' : '立即支付' }}
        </button>
      </view>
    </view>
    <PhoneBindSheet v-model="showPhoneBindSheet" @bound="handlePhoneBound" />
  </view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import { getOrderDetail, payOrder } from '@/api/mini';
import PageHeader from '@/components/PageHeader.vue';
import PhoneBindSheet from '@/components/PhoneBindSheet.vue';
import type { OrderDetail, OrderItem, OrderStatus, PaymentStatus } from '@/types/order';
import {
  isPhoneBindingRequiredError,
  requestMiniProgramPayment,
  toCheckoutErrorMessage,
} from '@/utils/checkout';

defineOptions({
  name: 'OrderDetailPage',
});

const order = ref<OrderDetail | null>(null);
const currentOrderId = ref('');
const paying = ref(false);
const showPhoneBindSheet = ref(false);
const pendingOrderId = ref('');

const vehicleItems = computed<OrderItem[]>(() => {
  if (!order.value) return [];
  return order.value.items.filter((item) => item.vehicle);
});

const showPayAction = computed(() => {
  if (!order.value) return false;
  const status = order.value.orderStatus || order.value.status;
  return status === 'pending' && ['unpaid', 'failed', 'closed'].includes(order.value.paymentStatus);
});

onLoad((query) => {
  const id = typeof query?.id === 'string' ? query.id : '';
  if (!id) {
    order.value = null;
    return;
  }
  currentOrderId.value = id;
  void loadOrder(id);
});

async function loadOrder(id: string) {
  try {
    order.value = await getOrderDetail(id);
  } catch {
    order.value = null;
    void uni.showToast({ title: '加载失败', icon: 'none' });
  }
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

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const mm = `${date.getMonth() + 1}`.padStart(2, '0');
  const dd = `${date.getDate()}`.padStart(2, '0');
  const hh = `${date.getHours()}`.padStart(2, '0');
  const mi = `${date.getMinutes()}`.padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd} ${hh}:${mi}`;
}

async function submitPayment() {
  if (!currentOrderId.value || paying.value) {
    return;
  }

  const orderId = currentOrderId.value;

  paying.value = true;
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
    void uni.showToast({ title: toCheckoutErrorMessage(error, '支付失败'), icon: 'none' });
  } finally {
    paying.value = false;
    void uni.hideLoading();
    if (currentOrderId.value) {
      await loadOrder(currentOrderId.value);
    }
  }
}

async function handlePhoneBound() {
  const orderId = pendingOrderId.value;
  pendingOrderId.value = '';
  if (!orderId || paying.value) {
    return;
  }
  currentOrderId.value = orderId;
  await submitPayment();
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
  gap: 12px;
}

.pay-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: rgba(255, 255, 255, 0.96);
  border-radius: 18px;
  padding: 14px;
  box-shadow: 0 12px 30px rgba(17, 31, 56, 0.12);
  backdrop-filter: blur(10px);
}

.pay-summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pay-summary-label {
  font-size: 11px;
  color: #8a94a6;
}

.pay-summary-value {
  font-size: 18px;
  font-weight: 700;
  color: #1f7aec;
}

.pay-button {
  margin: 0;
  min-width: 120px;
  height: 42px;
  line-height: 42px;
  border-radius: 999px;
  background: linear-gradient(135deg, #1f7aec, #43a2ff);
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
  padding: 0 18px;
}

.card {
  background: #ffffff;
  border-radius: 16px;
  padding: 14px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
}

.section-title {
  display: block;
  font-size: 14px;
  font-weight: 700;
  color: #1a1f2e;
  margin-bottom: 8px;
}

.row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
}

.label {
  font-size: 12px;
  color: #8a94a6;
}

.value {
  flex: 1;
  text-align: right;
  font-size: 12px;
  color: #1a1f2e;
  word-break: break-all;
}

.amount {
  color: #1f7aec;
  font-weight: 700;
}

.item-row {
  margin-top: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.item-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.item-name {
  font-size: 13px;
  color: #1a1f2e;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-qty {
  font-size: 12px;
  color: #8a94a6;
}

.item-price {
  font-size: 13px;
  color: #1a1f2e;
  font-weight: 600;
}

.vehicle-block {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #f2f4f7;
}

.vehicle-block:first-of-type {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.vehicle-cover {
  width: 100%;
  height: 120px;
  border-radius: 12px;
  margin-top: 10px;
}

.empty {
  padding: 40px 16px;
  text-align: center;
}

.empty-text,
.sub-empty-text {
  color: #a8b0c1;
  font-size: 12px;
}

.sub-empty {
  padding: 8px 0;
}
</style>
