<template>
  <view class="page">
    <view class="header">
      <text class="title">订单详情</text>
    </view>

    <view v-if="!order" class="empty">
      <text class="empty-text">订单不存在</text>
      <button class="btn" @tap="back">返回</button>
    </view>

    <view v-else class="content">
      <view class="card">
        <view class="row"><text class="label">订单编号</text><text class="value">{{ order.orderNumber }}</text></view>
        <view class="row"><text class="label">订单状态</text><text class="value">{{ statusText(order.status) }}</text></view>
        <view class="row"><text class="label">下单时间</text><text class="value">{{ formatDateTime(order.createdAt) }}</text></view>
      </view>

      <view class="card">
        <text class="section">商品明细</text>
        <view v-for="item in order.items" :key="item.id" class="item">
          <text class="item-name">{{ item.name }}</text>
          <text class="item-meta">¥ {{ item.price }} × {{ item.quantity }}</text>
        </view>
        <view class="total">
          <text class="total-label">合计</text>
          <text class="total-value">¥ {{ order.totalAmount }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';
import { ref } from 'vue';
import { getOrderDetail } from '@/mocks/orders';
import type { OrderDetail, OrderStatus } from '@/types/order';

const order = ref<OrderDetail | null>(null);

onLoad((query) => {
  const id = typeof query?.id === 'string' ? query.id : '';
  order.value = id ? getOrderDetail(id) ?? null : null;
});

function back() {
  uni.navigateBack();
}

function statusText(status: OrderStatus) {
  if (status === 'pending') return '待支付';
  if (status === 'paid') return '已支付';
  if (status === 'completed') return '已完成';
  return '已取消';
}

function formatDateTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mi = `${d.getMinutes()}`.padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd} ${hh}:${mi}`;
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
  gap: 10px;
  margin-top: 10px;
}

.row:first-child {
  margin-top: 0;
}

.label {
  font-size: 12px;
  color: #8a94a6;
}

.value {
  font-size: 12px;
  color: #1a1f2e;
}

.section {
  display: block;
  font-size: 14px;
  font-weight: 700;
  color: #1a1f2e;
}

.item {
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
}

.item-name {
  font-size: 12px;
  color: #1a1f2e;
}

.item-meta {
  font-size: 12px;
  color: #5f6b83;
}

.total {
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f2f4f7;
}

.total-label {
  font-size: 12px;
  color: #8a94a6;
}

.total-value {
  font-size: 15px;
  font-weight: 700;
  color: #1a1f2e;
}

.empty {
  padding: 40px 16px;
  text-align: center;
}

.empty-text {
  display: block;
  font-size: 13px;
  color: #1a1f2e;
}

.btn {
  margin-top: 14px;
  width: 160px;
  background: #1f7aec;
  color: #ffffff;
  border-radius: 999px;
  height: 36px;
  line-height: 36px;
  font-size: 13px;
}
</style>
