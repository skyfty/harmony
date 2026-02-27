<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Card, Descriptions, Spin, Table, Tag } from 'ant-design-vue';
import { getOrderApi, type OrderItem } from '#/api';

const route = useRoute();
const loading = ref(false);
const order = ref<OrderItem | null>(null);

const itemColumns = [
  { title: '商品ID', dataIndex: 'productId', key: 'productId' },
  { title: '类型', dataIndex: 'itemType', key: 'itemType' },
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: '单价', dataIndex: 'price', key: 'price' },
  { title: '数量', dataIndex: 'quantity', key: 'quantity' },
];

const paymentResultPretty = computed(() => {
  if (!order.value?.paymentResult) return '-';
  try {
    return JSON.stringify(order.value.paymentResult, null, 2);
  } catch {
    return String(order.value.paymentResult);
  }
});

async function loadOrder() {
  const id = String(route.params.id || '');
  if (!id) return;
  loading.value = true;
  try {
    order.value = await getOrderApi(id);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadOrder();
});
</script>

<template>
  <div class="p-5">
    <Spin :spinning="loading">
      <Card title="订单详情" v-if="order">
        <Descriptions bordered :column="2">
          <Descriptions.Item label="订单号">{{ order.orderNumber }}</Descriptions.Item>
          <Descriptions.Item label="订单状态">{{ order.orderStatus || order.status }}</Descriptions.Item>
          <Descriptions.Item label="支付状态">
            <Tag color="processing">{{ order.paymentStatus || '-' }}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="支付方式">{{ order.paymentMethod || '-' }}</Descriptions.Item>
          <Descriptions.Item label="支付通道">{{ order.paymentProvider || '-' }}</Descriptions.Item>
          <Descriptions.Item label="交易单号">{{ order.transactionId || '-' }}</Descriptions.Item>
          <Descriptions.Item label="支付时间">{{ order.paidAt || '-' }}</Descriptions.Item>
          <Descriptions.Item label="客户">{{ order.userInfo?.displayName || order.userInfo?.username || '-' }}</Descriptions.Item>
          <Descriptions.Item label="订单金额">{{ order.totalAmount }}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{{ order.createdAt }}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{{ order.updatedAt }}</Descriptions.Item>
          <Descriptions.Item label="收货地址" :span="2">{{ order.shippingAddress || '-' }}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card class="mt-4" title="订单商品" v-if="order">
        <Table :columns="itemColumns" :data-source="order.items" :pagination="false" row-key="productId" />
      </Card>

      <Card class="mt-4" title="支付结果" v-if="order">
        <pre class="whitespace-pre-wrap text-xs">{{ paymentResultPretty }}</pre>
      </Card>
    </Spin>
  </div>
</template>
