<template>
  <view class="page orders">
    <view class="header">
      <text class="title">我的订单</text>
      <text class="subtitle">了解素材订购与服务进度</text>
    </view>

    <view class="status-tags">
      <view
        v-for="tab in statusTabs"
        :key="tab.value"
        class="status-tag"
        :class="{ active: tab.value === currentStatus }"
        @tap="switchStatus(tab.value)"
      >
        {{ tab.label }}
      </view>
    </view>

    <view v-if="loading" class="loading-state">
      <text class="loading-text">正在加载订单...</text>
    </view>

    <view v-else-if="filteredOrders.length" class="orders-list">
      <view class="order-card" v-for="order in filteredOrders" :key="order.id">
        <view class="order-header">
          <text class="order-code">订单号 {{ order.orderNumber }}</text>
          <text class="order-status" :class="order.status">{{ statusLabels[order.status] }}</text>
        </view>
        <view class="order-body">
          <view class="thumb" :style="{ background: order.gradient }"></view>
          <view class="info">
            <text class="order-title">{{ order.title }}</text>
            <text class="order-desc">{{ order.desc }}</text>
            <view class="meta">
              <text>下单 {{ order.date }}</text>
              <text>金额 ¥{{ order.amount.toFixed(2) }}</text>
            </view>
          </view>
        </view>
        <view class="actions">
          <button class="detail-btn" @tap="goDetail(order.id)">查看详情</button>
        </view>
      </view>
    </view>

    <view v-else class="empty">
      <view class="empty-icon"></view>
      <text class="empty-title">暂无相关订单</text>
      <text class="empty-desc">{{ errorMessage || '尝试切换筛选状态或返回商城查看更多素材' }}</text>
    </view>
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { apiGetOrders, type OrderSummary } from '@/api/miniprogram';

type OrderStatus = OrderSummary['status'];

const statusTabs = [
  { label: '全部', value: 'all' },
  { label: '待支付', value: 'pending' },
  { label: '已支付', value: 'paid' },
  { label: '已完成', value: 'completed' },
  { label: '已取消', value: 'cancelled' },
] as const;

type FilterValue = (typeof statusTabs)[number]['value'];

const statusLabels: Record<OrderStatus, string> = {
  pending: '待支付',
  paid: '已支付',
  completed: '已完成',
  cancelled: '已取消',
};

const fallbackGradients = [
  'linear-gradient(135deg, #cfe5ff, #a7c8ff)',
  'linear-gradient(135deg, #ffe0f2, #ffcadf)',
  'linear-gradient(135deg, #fce4d9, #f9c7b3)',
  'linear-gradient(135deg, #dfe6e9, #b2bec3)',
  'linear-gradient(135deg, #e8f5e9, #c8e6c9)',
];

interface UiOrder {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  title: string;
  desc: string;
  date: string;
  amount: number;
  gradient: string;
}

const orders = ref<OrderSummary[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const currentStatus = ref<FilterValue>('all');

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${month}-${day}`;
}

function resolveGradient(seed?: string, index = 0): string {
  if (!seed) {
    return fallbackGradients[index % fallbackGradients.length];
  }
  const value = Array.from(seed).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return fallbackGradients[value % fallbackGradients.length];
}

const filteredOrders = computed<UiOrder[]>(() => {
  const list =
    currentStatus.value === 'all'
      ? orders.value
      : orders.value.filter((order) => order.status === currentStatus.value);
  return list.map<UiOrder>((order, index) => {
    const primaryItem = order.items[0];
    const descFromProduct = primaryItem?.product?.description?.trim();
    const description =
      descFromProduct && descFromProduct.length > 0
        ? descFromProduct
        : order.items.length > 1
        ? `共 ${order.items.length} 件商品`
        : '优化商城商品';
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      title: primaryItem?.name ?? '优化商城订单',
      desc: description,
      date: formatDate(order.createdAt),
      amount: order.totalAmount,
      gradient: resolveGradient(primaryItem?.productId ?? order.id, index),
    };
  });
});

async function loadOrders(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const { orders: list } = await apiGetOrders();
    orders.value = list;
  } catch (error) {
    const message = error instanceof Error ? error.message : '订单加载失败';
    errorMessage.value = message;
    uni.showToast({ title: message, icon: 'none' });
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

function switchStatus(value: FilterValue) {
  currentStatus.value = value;
}

function goDetail(orderId: string) {
  uni.navigateTo({ url: `/pages/orders/detail/index?id=${orderId}` });
}

onShow(() => {
  loadOrders();
});

onPullDownRefresh(() => {
  loadOrders();
});
</script>
<style scoped lang="scss">
.page {
  padding: 20px 20px 32px;
  min-height: 100vh;
  background: #f6f8fc;
  display: flex;
  flex-direction: column;
  gap: 18px;
  box-sizing: border-box;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.title {
  font-size: 22px;
  font-weight: 600;
  color: #1f1f1f;
}

.subtitle {
  font-size: 13px;
  color: #8a94a6;
}

.status-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 12px;
  padding: 6px 0 2px;
}

.status-tag {
  padding: 6px 14px;
  border-radius: 14px;
  font-size: 12px;
  background: rgba(79, 158, 255, 0.12);
  color: #4f9eff;
  flex-shrink: 0;
}

.status-tag.active {
  background: linear-gradient(135deg, #4f9eff, #1f7aec);
  color: #ffffff;
  box-shadow: 0 6px 18px rgba(31, 122, 236, 0.2);
}

.loading-state {
  margin-top: 80px;
  display: flex;
  justify-content: center;
}

.loading-text {
  padding: 12px 22px;
  border-radius: 22px;
  background: rgba(79, 158, 255, 0.12);
  font-size: 13px;
  color: #6b778d;
}

.orders-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.order-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 18px;
  box-shadow: 0 12px 28px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.order-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #6b778d;
}

.order-status {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  color: #ffffff;
}

.order-status.pending {
  background: linear-gradient(135deg, #ff9e80, #ff6f61);
}

.order-status.paid {
  background: linear-gradient(135deg, #4f9eff, #1f7aec);
}

.order-status.completed {
  background: linear-gradient(135deg, #45c48a, #32a666);
}

.order-status.cancelled {
  background: linear-gradient(135deg, #9aa4b5, #7f8899);
}

.order-body {
  display: flex;
  gap: 16px;
}

.thumb {
  width: 70px;
  height: 70px;
  border-radius: 18px;
  flex-shrink: 0;
  box-shadow: 0 12px 28px rgba(31, 122, 236, 0.1);
}

.info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.order-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f1f1f;
}

.order-desc {
  font-size: 13px;
  color: #6b778d;
  line-height: 20px;
}

.meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #8a94a6;
}

.actions {
  display: flex;
  justify-content: stretch;
}

.detail-btn {
  flex: 1;
  padding: 10px 0;
  border-radius: 14px;
  border: none;
  background: linear-gradient(135deg, #4f9eff, #1f7aec);
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 10px 22px rgba(31, 122, 236, 0.18);
}

.empty {
  margin-top: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #8a94a6;
}

.empty-icon {
  width: 80px;
  height: 80px;
  border-radius: 28px;
  background: linear-gradient(135deg, rgba(79, 158, 255, 0.16), rgba(79, 207, 255, 0.12));
  position: relative;
}

.empty-icon::before {
  content: '';
  position: absolute;
  width: 32px;
  height: 32px;
  border: 3px solid rgba(63, 151, 255, 0.6);
  border-radius: 50%;
  left: 50%;
  top: 18px;
  transform: translateX(-50%);
}

.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: #4f9eff;
}

.empty-desc {
  font-size: 13px;
  text-align: center;
  line-height: 20px;
}
</style>
