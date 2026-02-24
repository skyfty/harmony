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
    </view>
  </view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import { getOrderDetail } from '@/api/mini';
import PageHeader from '@/components/PageHeader.vue';
import type { OrderDetail, OrderItem, OrderStatus } from '@/types/order';

defineOptions({
  name: 'OrderDetailPage',
});

const order = ref<OrderDetail | null>(null);

const vehicleItems = computed<OrderItem[]>(() => {
  if (!order.value) return [];
  return order.value.items.filter((item) => item.vehicle);
});

onLoad((query) => {
  const id = typeof query?.id === 'string' ? query.id : '';
  if (!id) {
    order.value = null;
    return;
  }
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

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const mm = `${date.getMonth() + 1}`.padStart(2, '0');
  const dd = `${date.getDate()}`.padStart(2, '0');
  const hh = `${date.getHours()}`.padStart(2, '0');
  const mi = `${date.getMinutes()}`.padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd} ${hh}:${mi}`;
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
