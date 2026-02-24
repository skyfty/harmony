<template>
  <view class="page">
    <PageHeader title="订单详情" />

    <view v-if="!order" class="empty">
      <text class="empty-text">订单不存在</text>
    </view>

    <view v-else class="content">
      <view class="card">
        <view class="row"><text class="label">订单编号</text><text class="value">{{ order.orderNumber }}</text></view>
        <view class="row"><text class="label">订单状态</text><text class="value">{{ statusText(order.status) }}</text></view>
        <view class="row"><text class="label">下单时间</text><text class="value">{{ formatDateTime(order.createdAt) }}</text></view>
      </view>

      <view class="card">
        <text class="section">商品明细</text>
        <view v-for="item in order.items" :key="item.productId" class="item">
          <view class="item-main">
            <text class="item-name">{{ item.name }}</text>
            <text v-if="item.vehicle" class="vehicle-tag">车辆商品</text>
            <text v-if="item.vehicle?.name" class="vehicle-meta">车辆名称：{{ item.vehicle?.name }}</text>
            <text v-if="item.vehicle?.identifier" class="vehicle-meta">车辆编号：{{ item.vehicle?.identifier }}</text>
          </view>
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
import { getOrderDetail } from '@/api/mini';
import PageHeader from '@/components/PageHeader.vue';
import type { OrderDetail, OrderStatus } from '@/types/order';

const order = ref<OrderDetail | null>(null);

onLoad((query) => {
  void loadOrder(query);
});

async function loadOrder(query: Record<string, any> | undefined) {
  const id = typeof query?.id === 'string' ? query.id : '';
  if (!id) {
    order.value = null;
    return;
  }

  try {
    order.value = await getOrderDetail(id);
  } catch {
    order.value = null;
    uni.showToast({ title: '加载失败', icon: 'none' });
  }
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
  align-items: flex-start;
  gap: 10px;
  margin-top: 10px;
}

.item-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.item-name {
  font-size: 12px;
  color: #1a1f2e;
}

.vehicle-tag {
  display: inline-flex;
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(31, 122, 236, 0.1);
  color: #1f7aec;
  font-size: 11px;
}

.vehicle-meta {
  font-size: 11px;
  color: #5f6b83;
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
