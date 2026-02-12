<template>
  <view class="page">
    <view class="header">
      <text class="title">订单中心</text>
    </view>

    <view class="content">
      <view v-if="orders.length === 0" class="empty">暂无订单</view>

      <view v-for="order in orders" :key="order.id" class="card" @tap="openDetail(order.id)">
        <view class="row">
          <text class="no">{{ order.orderNumber }}</text>
          <text class="status">{{ statusText(order.status) }}</text>
        </view>
        <view class="meta">
          <text class="meta-text">下单时间 {{ formatDate(order.createdAt) }}</text>
          <text class="meta-text">共 {{ order.itemCount }} 件</text>
        </view>
        <view class="footer">
          <text class="amount">¥ {{ order.totalAmount }}</text>
          <text class="link">查看详情 ›</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { listOrders } from '@/mocks/orders';
import type { OrderStatus } from '@/types/order';

const orders = listOrders();

function openDetail(id: string) {
  uni.navigateTo({ url: `/pages/orders/detail/index?id=${encodeURIComponent(id)}` });
}

function statusText(status: OrderStatus) {
  if (status === 'pending') return '待支付';
  if (status === 'paid') return '已支付';
  if (status === 'completed') return '已完成';
  return '已取消';
}

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f8f8f8;
}

.header {
  padding: 16px;
}

.title {
  font-size: 16px;
  font-weight: 700;
  color: #1a1f2e;
}

.content {
  padding: 0 16px 18px;
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
