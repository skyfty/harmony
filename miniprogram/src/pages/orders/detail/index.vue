<template>
  <view class="page order-detail">
    <view v-if="loading" class="loading">
      <text class="loading-text">正在加载订单...</text>
    </view>

    <template v-else-if="order">
      <view class="header">
        <text class="title">订单详情</text>
        <text class="subtitle">{{ headerHint }}</text>
      </view>

      <view class="card summary">
        <view class="row">
          <text class="label">订单编号</text>
          <text class="value">{{ orderNumber }}</text>
        </view>
        <view class="row">
          <text class="label">当前状态</text>
          <text class="status" :class="status">{{ statusLabel }}</text>
        </view>
        <view class="row">
          <text class="label">下单时间</text>
          <text class="value">{{ createdAtDisplay }}</text>
        </view>
        <view class="row">
          <text class="label">商品合计</text>
          <text class="value highlight">¥{{ totalAmount.toFixed(2) }}</text>
        </view>
      </view>

      <view class="card items" v-if="items.length">
        <text class="card-title">购买商品</text>
        <view class="item" v-for="(item, index) in items" :key="`${item.productId}-${index}`">
          <view class="thumb" :style="{ background: thumbGradients[index % thumbGradients.length] }"></view>
          <view class="item-info">
            <text class="item-name">{{ item.name }}</text>
            <text class="item-category">{{ item.product?.category || '未分类' }}</text>
          </view>
          <text class="item-price">¥{{ Number(item.price).toFixed(2) }}</text>
        </view>
        <view class="total-row">
          <text class="label">总计</text>
          <text class="total">¥{{ totalAmount.toFixed(2) }}</text>
        </view>
      </view>

      <view class="card payment">
        <text class="card-title">支付与配送</text>
        <view class="row">
          <text class="label">支付方式</text>
          <text class="value">{{ paymentMethod }}</text>
        </view>
        <view class="row address">
          <text class="label">收货地址</text>
          <text class="value">{{ address }}</text>
        </view>
      </view>

      <view class="card notes">
        <text class="card-title">订单进度</text>
        <view class="timeline">
          <view class="dot done"></view>
          <view class="timeline-info">
            <text class="timeline-title">订单已生成</text>
            <text class="timeline-desc">我们会尽快为您准备素材下载与交付通知</text>
          </view>
        </view>
        <view class="timeline" v-if="showPaymentStep">
          <view class="dot paid" :class="{ done: showCompletedStep }"></view>
          <view class="timeline-info">
            <text class="timeline-title">支付成功</text>
            <text class="timeline-desc">如需发票或改价，请联系在线客服协助处理</text>
          </view>
        </view>
        <view class="timeline" v-if="showCompletedStep">
          <view class="dot done"></view>
          <view class="timeline-info">
            <text class="timeline-title">素材已交付</text>
            <text class="timeline-desc">您可前往素材库或站内信查看交付详情</text>
          </view>
        </view>
        <view class="timeline cancelled" v-if="showCancelledStep">
          <view class="dot cancelled"></view>
          <view class="timeline-info">
            <text class="timeline-title">订单已取消</text>
            <text class="timeline-desc">若需继续采购，可返回商城重新下单</text>
          </view>
        </view>
      </view>

      <view class="footer">
        <button class="outline" @tap="goOrders">返回订单列表</button>
        <button class="primary" @tap="contactService">联系客服</button>
      </view>
    </template>

    <view v-else class="empty">
      <text class="empty-title">未找到订单</text>
      <text class="empty-desc">{{ errorMessage || '请返回订单列表重试' }}</text>
      <button class="outline" @tap="goOrders">返回订单列表</button>
    </view>
    <BottomNav active="optimize" @navigate="handleNavigate" />
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app';
import { apiGetOrder, type OrderSummary } from '@/api/miniprogram';
import BottomNav from '@/components/BottomNav.vue';
import { redirectToNav, type NavKey } from '@/utils/navKey';

type OrderStatus = OrderSummary['status'];

const statusLabelMap: Record<OrderStatus, string> = {
  pending: '待支付',
  paid: '已支付',
  completed: '已完成',
  cancelled: '已取消',
};

const orderId = ref('');
const order = ref<OrderSummary | null>(null);
const loading = ref(true);
const errorMessage = ref('');

const thumbGradients = [
  'linear-gradient(135deg, #74b9ff, #a29bfe)',
  'linear-gradient(135deg, #55efc4, #00cec9)',
  'linear-gradient(135deg, #ffeaa7, #fab1a0)',
  'linear-gradient(135deg, #dfe6e9, #b2bec3)',
];

function formatDateTime(iso?: string): string {
  if (!iso) {
    return '刚刚';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

const status = computed<OrderStatus>(() => order.value?.status ?? 'pending');
const statusLabel = computed(() => statusLabelMap[status.value]);
const createdAtDisplay = computed(() => formatDateTime(order.value?.createdAt));
const headerHint = computed(() => (order.value ? `下单时间 · ${createdAtDisplay.value}` : '正在等待订单信息'));
const orderNumber = computed(() => order.value?.orderNumber ?? '—');
const totalAmount = computed(() => order.value?.totalAmount ?? 0);
const paymentMethod = computed(() => order.value?.paymentMethod ?? '微信支付');
const address = computed(() => order.value?.shippingAddress ?? '数字交付');
const items = computed<OrderSummary['items']>(() => order.value?.items ?? []);

const showPaymentStep = computed(() => ['paid', 'completed'].includes(status.value));
const showCompletedStep = computed(() => status.value === 'completed');
const showCancelledStep = computed(() => status.value === 'cancelled');

async function loadOrder(id: string): Promise<void> {
  if (!id) {
    loading.value = false;
    order.value = null;
    errorMessage.value = '缺少订单编号';
    uni.stopPullDownRefresh();
    return;
  }
  loading.value = true;
  errorMessage.value = '';
  try {
    order.value = await apiGetOrder(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : '获取订单失败';
    errorMessage.value = message;
    order.value = null;
    uni.showToast({ title: message, icon: 'none' });
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

function contactService() {
  uni.showToast({ title: '已为您连接客服，请稍候', icon: 'none' });
}

function goOrders() {
  uni.navigateTo({ url: '/pages/orders/index' });
}

onLoad((query) => {
  const rawId = typeof query?.id === 'string' ? query.id : '';
  orderId.value = rawId;
  if (rawId) {
    loadOrder(rawId);
  } else {
    loading.value = false;
    order.value = null;
    errorMessage.value = '缺少订单编号';
  }
});

onPullDownRefresh(() => {
  loadOrder(orderId.value);
});

function handleNavigate(target: NavKey): void {
  // 订单来源于优化商城，底部导航对应 optimize
  redirectToNav(target, { current: 'optimize' });
}
</script>
<style scoped lang="scss">
.page {
  padding: 20px 20px 96px;
  padding-top: 84px;
  background: #f6f8fc;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 18px;
  box-sizing: border-box;
}

.loading {
  margin-top: 100px;
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

.card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 28px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: #6b778d;
}

.highlight {
  font-weight: 600;
  color: #1f7aec;
}

.status {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  color: #ffffff;
}

.status.pending {
  background: linear-gradient(135deg, #ff9e80, #ff6f61);
}

.status.paid {
  background: linear-gradient(135deg, #4f9eff, #1f7aec);
}

.status.completed {
  background: linear-gradient(135deg, #45c48a, #32a666);
}

.status.cancelled {
  background: linear-gradient(135deg, #9aa4b5, #7f8899);
}

.items .item {
  display: flex;
  align-items: center;
  gap: 14px;
}

.thumb {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.15);
}

.item-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.item-name {
  font-size: 14px;
  font-weight: 600;
  color: #1f1f1f;
}

.item-category {
  font-size: 12px;
  color: #8a94a6;
}

.item-price {
  font-size: 14px;
  font-weight: 600;
  color: #1f7aec;
}

.total-row {
  display: flex;
  justify-content: space-between;
  padding-top: 10px;
  margin-top: 4px;
  border-top: 1px dashed rgba(31, 122, 236, 0.18);
}

.total {
  font-size: 18px;
  font-weight: 700;
  color: #1f7aec;
}

.address .value {
  flex: 1;
  text-align: right;
  line-height: 20px;
}

.notes .timeline {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: rgba(79, 158, 255, 0.24);
  margin-top: 4px;
}

.dot.done,
.dot.paid {
  background: linear-gradient(135deg, #4f9eff, #1f7aec);
  box-shadow: 0 0 0 3px rgba(79, 158, 255, 0.18);
}

.dot.cancelled {
  background: linear-gradient(135deg, #ff9e80, #ff6f61);
  box-shadow: 0 0 0 3px rgba(255, 158, 128, 0.16);
}

.notes .timeline.cancelled .timeline-title {
  color: #ff6f61;
}

.timeline-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.timeline-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f1f1f;
}

.timeline-desc {
  font-size: 12px;
  color: #6b778d;
  line-height: 18px;
}

.footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16px 20px 32px;
  background: linear-gradient(180deg, rgba(246, 248, 252, 0), rgba(246, 248, 252, 0.95));
  display: flex;
  gap: 12px;
}

.outline,
.primary {
  flex: 1;
  padding: 14px 0;
  border-radius: 16px;
  border: none;
  font-size: 15px;
  font-weight: 600;
}

.outline {
  border: 1px solid rgba(79, 158, 255, 0.4);
  background: transparent;
  color: #1f7aec;
}

.primary {
  background: linear-gradient(135deg, #4f9eff, #1f7aec);
  color: #ffffff;
  box-shadow: 0 12px 24px rgba(31, 122, 236, 0.2);
}

.empty {
  margin-top: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #8a94a6;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: #4f9eff;
}

.empty-desc {
  font-size: 13px;
  line-height: 20px;
  text-align: center;
}
</style>
