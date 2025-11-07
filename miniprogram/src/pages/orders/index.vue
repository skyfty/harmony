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

    <view class="orders-list">
      <view class="order-card" v-for="order in filteredOrders" :key="order.id">
        <view class="order-header">
          <text class="order-code">订单号 {{ order.id }}</text>
          <text class="order-status" :class="order.status">{{ statusLabels[order.status] }}</text>
        </view>
        <view class="order-body">
          <view class="thumb" :style="{ background: order.gradient }"></view>
          <view class="info">
            <text class="order-title">{{ order.title }}</text>
            <text class="order-desc">{{ order.desc }}</text>
            <view class="meta">
              <text>下单 {{ order.date }}</text>
              <text>金额 ¥{{ order.amount }}</text>
            </view>
          </view>
        </view>
        <view class="actions">
          <button class="detail-btn" @tap="goDetail(order.id)">查看详情</button>
        </view>
      </view>
    </view>

    <view v-if="!filteredOrders.length" class="empty">
      <view class="empty-icon"></view>
      <text class="empty-title">暂无相关订单</text>
      <text class="empty-desc">尝试切换筛选状态或返回商城查看更多素材</text>
    </view>
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';

type OrderStatus = 'pending' | 'processing' | 'completed';

const statusTabs = [
  { label: '全部', value: 'all' },
  { label: '待支付', value: 'pending' },
  { label: '制作中', value: 'processing' },
  { label: '已完成', value: 'completed' },
] as const;

const statusLabels: Record<OrderStatus, string> = {
  pending: '待支付',
  processing: '制作中',
  completed: '已完成',
};

const currentStatus = ref<typeof statusTabs[number]['value']>('all');

const orders = ref([
  {
    id: 'A20240318',
    status: 'processing' as OrderStatus,
    title: '沉浸式展厅模型定制',
    desc: '包含空间布局与灯光预设，预计 5 个工作日交付',
    date: '03-15',
    amount: 1280,
    gradient: 'linear-gradient(135deg, #cfe5ff, #a7c8ff)',
  },
  {
    id: 'A20240309',
    status: 'completed' as OrderStatus,
    title: '高分辨率雕塑组素材包',
    desc: '提供 3 款雕塑模型、高清贴图与展示场景',
    date: '03-08',
    amount: 560,
    gradient: 'linear-gradient(135deg, #ffe0f2, #ffcadf)',
  },
  {
    id: 'A20240302',
    status: 'pending' as OrderStatus,
    title: '互动导览多媒体包',
    desc: '含导览动画、语音讲解及互动控件素材',
    date: '03-01',
    amount: 920,
    gradient: 'linear-gradient(135deg, #fce4d9, #f9c7b3)',
  },
]);

const filteredOrders = computed(() => {
  if (currentStatus.value === 'all') {
    return orders.value;
  }
  return orders.value.filter((order) => order.status === currentStatus.value);
});

function switchStatus(value: typeof statusTabs[number]['value']) {
  currentStatus.value = value;
}

function goDetail(orderId: string) {
  const target = orders.value.find((order) => order.id === orderId);
  const status = target?.status ?? 'processing';
  uni.navigateTo({ url: `/pages/orders/detail/index?id=${orderId}&status=${status}` });
}
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

.order-status.processing {
  background: linear-gradient(135deg, #4f9eff, #1f7aec);
}

.order-status.completed {
  background: linear-gradient(135deg, #45c48a, #32a666);
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
