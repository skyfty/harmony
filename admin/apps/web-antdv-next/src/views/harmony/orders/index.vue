<script lang="ts" setup>
import CrudPage from '../shared/crud-page.vue';

import { createOrder, deleteOrder, fetchOrders, updateOrder } from '#/api';

const columns = [
  { title: '订单号', dataIndex: 'orderNumber', key: 'orderNumber' },
  { title: '状态', dataIndex: 'status', key: 'status' },
  { title: '金额', dataIndex: 'totalAmount', key: 'totalAmount' },
  { title: '用户', dataIndex: 'userInfo.username', key: 'userInfo.username' },
];

const fields = [
  { key: 'userId', label: '用户ID', required: true },
  {
    key: 'status',
    label: '状态',
    required: true,
    type: 'select',
    options: [
      { label: 'pending', value: 'pending' },
      { label: 'paid', value: 'paid' },
      { label: 'completed', value: 'completed' },
      { label: 'cancelled', value: 'cancelled' },
    ],
  },
  { key: 'paymentMethod', label: '支付方式' },
  { key: 'shippingAddress', label: '收货地址' },
  { key: 'scenicId', label: '景区ID' },
  { key: 'couponId', label: '卡券ID' },
];

function listApi(params: { keyword?: string; page: number; pageSize: number }) {
  return fetchOrders(params).then((result) => ({
    ...result,
    data: (result.data || []).map((item: any) => ({
      ...item,
      'userInfo.username': item?.userInfo?.username || '',
    })),
  }));
}

function createApi(payload: Record<string, unknown>) {
  return createOrder({
    ...payload,
    items: [
      {
        productId: '',
        name: 'manual-order-item',
        price: 0,
        quantity: 1,
      },
    ],
  });
}
</script>

<template>
  <CrudPage
    title="订单管理"
    :columns="columns"
    :fields="fields"
    :list-api="listApi"
    :create-api="createApi"
    :update-api="updateOrder"
    :delete-api="deleteOrder"
  />
</template>
