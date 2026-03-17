<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Button, Card, Descriptions, Input, Modal, Spin, Table, Tag, message } from 'ant-design-vue';
import { approveOrderRefundApi, getOrderApi, rejectOrderRefundApi, type OrderItem } from '#/api';

const route = useRoute();
const loading = ref(false);
const order = ref<OrderItem | null>(null);
const refundRejectReason = ref('');
const refundSubmitting = ref(false);

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

const canApproveRefund = computed(() => order.value?.refundStatus === 'applied');

async function approveRefund() {
  const id = String(route.params.id || '');
  if (!id || refundSubmitting.value) return;
  refundSubmitting.value = true;
  try {
    await approveOrderRefundApi(id);
    message.success('退款已发起');
    await loadOrder();
  } catch {
    // request client handles errors
  } finally {
    refundSubmitting.value = false;
  }
}

function rejectRefund() {
  if (!canApproveRefund.value) return;
  Modal.confirm({
    title: '驳回退款申请',
    content: '确认驳回该退款申请吗？',
    okType: 'danger',
    onOk: async () => {
      const id = String(route.params.id || '');
      const reason = refundRejectReason.value.trim();
      if (!reason) {
        message.warning('请先填写驳回原因');
        return;
      }
      refundSubmitting.value = true;
      try {
        await rejectOrderRefundApi(id, reason);
        message.success('已驳回退款申请');
        refundRejectReason.value = '';
        await loadOrder();
      } catch {
        // request client handles errors
      } finally {
        refundSubmitting.value = false;
      }
    },
  });
}

onMounted(() => {
  void loadOrder();
});
</script>

<template>
  <div class="p-5">
    <Spin :spinning="loading">
      <Card title="订单详情" v-if="order">
        <div class="mb-4" v-if="canApproveRefund">
          <Input
            v-model:value="refundRejectReason"
            placeholder="填写驳回原因（驳回时必填）"
            :maxlength="200"
          />
          <div class="mt-2">
            <Button type="primary" :loading="refundSubmitting" @click="approveRefund">审核通过并发起退款</Button>
            <Button class="ml-2" danger :loading="refundSubmitting" @click="rejectRefund">驳回申请</Button>
          </div>
        </div>
        <Descriptions bordered :column="2">
          <Descriptions.Item label="订单号">{{ order.orderNumber }}</Descriptions.Item>
          <Descriptions.Item label="订单状态">{{ order.orderStatus || order.status }}</Descriptions.Item>
          <Descriptions.Item label="支付状态">
            <Tag color="processing">{{ order.paymentStatus || '-' }}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="退款状态">
            <Tag color="purple">{{ order.refundStatus || '-' }}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="退款原因">{{ order.refundReason || '-' }}</Descriptions.Item>
          <Descriptions.Item label="驳回原因">{{ order.refundRejectReason || '-' }}</Descriptions.Item>
          <Descriptions.Item label="退款金额">{{ order.refundAmount ?? '-' }}</Descriptions.Item>
          <Descriptions.Item label="退款申请号">{{ order.refundRequestNo || '-' }}</Descriptions.Item>
          <Descriptions.Item label="微信退款单号">{{ order.refundId || '-' }}</Descriptions.Item>
          <Descriptions.Item label="退款申请时间">{{ order.refundRequestedAt || '-' }}</Descriptions.Item>
          <Descriptions.Item label="退款审核时间">{{ order.refundReviewedAt || '-' }}</Descriptions.Item>
          <Descriptions.Item label="退款完成时间">{{ order.refundedAt || '-' }}</Descriptions.Item>
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
