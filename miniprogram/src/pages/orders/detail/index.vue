<template>
  <view class="page order-detail">
    <view class="header">
      <text class="title">订单详情</text>
      <text class="subtitle">{{ headerHint }}</text>
    </view>

    <view class="card summary">
      <view class="row">
        <text class="label">订单编号</text>
        <text class="value">{{ orderId }}</text>
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
      <view class="item" v-for="(item, index) in items" :key="item.name + index">
        <view class="thumb" :style="{ background: thumbGradients[index % thumbGradients.length] }"></view>
        <view class="item-info">
          <text class="item-name">{{ item.name }}</text>
          <text class="item-category">{{ item.category || '未分类' }}</text>
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
      <view class="timeline" v-if="status !== 'pending'">
        <view class="dot" :class="{ done: status === 'completed' }"></view>
        <view class="timeline-info">
          <text class="timeline-title">支付成功</text>
          <text class="timeline-desc">如需发票或改价，请联系在线客服协助处理</text>
        </view>
      </view>
      <view class="timeline" v-if="status === 'completed'">
        <view class="dot done"></view>
        <view class="timeline-info">
          <text class="timeline-title">素材已交付</text>
          <text class="timeline-desc">您可前往素材库或站内信查看交付详情</text>
        </view>
      </view>
    </view>

    <view class="footer">
      <button class="outline" @tap="goOrders">返回订单列表</button>
      <button class="primary" @tap="contactService">联系客服</button>
    </view>
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';

type OrderStatus = 'pending' | 'processing' | 'completed';

type OrderItem = {
  name: string;
  price: number | string;
  category?: string;
};

const statusLabelMap: Record<OrderStatus, string> = {
  pending: '待支付',
  processing: '处理中',
  completed: '已完成',
};

const orderId = ref('—');
const status = ref<OrderStatus>('processing');
const createdAtRaw = ref('');
const paymentMethod = ref('微信支付');
const address = ref('上海市黄浦区外滩18号 数字艺廊中心');
const items = ref<OrderItem[]>([]);
const totalOverride = ref<number | null>(null);

const thumbGradients = [
  'linear-gradient(135deg, #74b9ff, #a29bfe)',
  'linear-gradient(135deg, #55efc4, #00cec9)',
  'linear-gradient(135deg, #ffeaa7, #fab1a0)',
  'linear-gradient(135deg, #dfe6e9, #b2bec3)',
];

onLoad((query) => {
  if (query?.id) {
    orderId.value = String(query.id);
  }

  if (query?.status && ['pending', 'processing', 'completed'].includes(String(query.status))) {
    status.value = query.status as OrderStatus;
  }

  if (query?.items) {
    try {
      const decoded = decodeURIComponent(String(query.items));
      const parsed = JSON.parse(decoded);
      if (Array.isArray(parsed)) {
        items.value = parsed as OrderItem[];
      }
    } catch (error) {
      console.warn('订单商品解析失败', error);
    }
  }

  if (query?.total) {
    const total = Number(query.total);
    if (!Number.isNaN(total)) {
      totalOverride.value = total;
    }
  }

  if (query?.payment) {
    paymentMethod.value = decodeURIComponent(String(query.payment));
  }

  if (query?.address) {
    address.value = decodeURIComponent(String(query.address));
  }

  if (query?.createdAt) {
    createdAtRaw.value = decodeURIComponent(String(query.createdAt));
  } else {
    createdAtRaw.value = new Date().toISOString();
  }
});

const statusLabel = computed(() => statusLabelMap[status.value]);

const createdAtDisplay = computed(() => {
  if (!createdAtRaw.value) {
    return '刚刚';
  }
  const date = new Date(createdAtRaw.value);
  if (Number.isNaN(date.getTime())) {
    return createdAtRaw.value;
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
});

const headerHint = computed(() => `下单时间 · ${createdAtDisplay.value}`);

const totalAmount = computed(() => {
  if (typeof totalOverride.value === 'number') {
    return totalOverride.value;
  }
  return items.value.reduce((sum, item) => {
    const price = Number(item.price);
    return sum + (Number.isNaN(price) ? 0 : price);
  }, 0);
});

function contactService() {
  uni.showToast({ title: '已为您连接客服，请稍候', icon: 'none' });
}

function goOrders() {
  uni.navigateTo({ url: '/pages/orders/index' });
}
</script>
<style scoped lang="scss">
.page {
  padding: 20px 20px 96px;
  background: #f6f8fc;
  min-height: 100vh;
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

.status.processing {
  background: linear-gradient(135deg, #4f9eff, #1f7aec);
}

.status.completed {
  background: linear-gradient(135deg, #45c48a, #32a666);
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

.dot.done {
  background: linear-gradient(135deg, #4f9eff, #1f7aec);
  box-shadow: 0 0 0 3px rgba(79, 158, 255, 0.18);
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
</style>
