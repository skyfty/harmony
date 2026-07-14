<script setup lang="ts">
import type { OrderItem, UserItem } from '#/api';

import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { deleteOrderApi, listOrdersApi, listUsersApi } from '#/api';

import { Button, Modal, Space, Tag, Tooltip, message } from 'ant-design-vue';
import { DeleteOutlined, EyeOutlined } from '@ant-design/icons-vue';

const router = useRouter();
const userSearchLoading = ref(false);
const userSearchOptions = ref<Array<{ label: string; value: string }>>([]);
const userSearchToken = ref(0);

function formatUserLabel(user: UserItem) {
  const name = user.displayName || user.username || user.id;
  const username = user.username ? ` @${user.username}` : '';
  return `${name}${username} (${user.id})`;
}

async function handleUserSearch(keyword = '') {
  const token = ++userSearchToken.value;
  userSearchLoading.value = true;
  try {
    const res = await listUsersApi({
      keyword: keyword.trim() || undefined,
      page: 1,
      pageSize: 20,
    });
    if (token !== userSearchToken.value) {
      return;
    }
    userSearchOptions.value = (res.items || []).map((item: UserItem) => ({
      label: formatUserLabel(item),
      value: item.id,
    }));
  } finally {
    if (token === userSearchToken.value) {
      userSearchLoading.value = false;
    }
  }
}

function openDetail(row: OrderItem) {
  router.push({ name: 'OrderDetail', params: { id: row.id } });
}

function getPaymentStatusColor(status?: string) {
  switch (status) {
    case 'processing':
      return 'processing';
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'error';
    case 'refunded':
      return 'purple';
    case 'closed':
      return 'default';
    default:
      return 'default';
  }
}

function getRefundStatusColor(status?: string) {
  switch (status) {
    case 'applied':
      return 'warning';
    case 'approved':
      return 'processing';
    case 'rejected':
    case 'failed':
      return 'error';
    case 'processing':
      return 'blue';
    case 'succeeded':
      return 'success';
    default:
      return 'default';
  }
}

function handleDelete(row: OrderItem) {
  Modal.confirm({
    title: `确认删除订单 ${row.orderNumber} 吗？`,
    content: '删除后将无法恢复。',
    okType: 'danger',
    onOk: async () => {
      await deleteOrderApi(row.id);
      message.success('订单已删除');
      await orderGridApi.query();
    },
  });
}

const [UserOrderGrid, orderGridApi] = useVbenVxeGrid<OrderItem>({
  formOptions: {
    schema: [
      {
        component: 'Select',
        fieldName: 'userId',
        label: '用户',
        componentProps: {
          allowClear: true,
          filterOption: false,
          loading: userSearchLoading,
          options: userSearchOptions,
          placeholder: '输入昵称/用户名搜索用户',
          showSearch: true,
          onFocus: () => handleUserSearch(),
          onSearch: handleUserSearch,
        },
      },
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键字',
        componentProps: {
          allowClear: true,
          placeholder: '订单号 / 用户名 / 收货地址',
        },
      },
      {
        component: 'Select',
        fieldName: 'paymentStatus',
        label: '支付状态',
        componentProps: {
          allowClear: true,
          options: [
            { label: '未支付', value: 'unpaid' },
            { label: '支付中', value: 'processing' },
            { label: '支付成功', value: 'succeeded' },
            { label: '支付失败', value: 'failed' },
            { label: '已退款', value: 'refunded' },
            { label: '已关闭', value: 'closed' },
          ],
        },
      },
      {
        component: 'Select',
        fieldName: 'status',
        label: '订单状态',
        componentProps: {
          allowClear: true,
          options: [
            { label: '待处理', value: 'pending' },
            { label: '已支付', value: 'paid' },
            { label: '已完成', value: 'completed' },
            { label: '已取消', value: 'cancelled' },
          ],
        },
      },
      {
        component: 'Select',
        fieldName: 'refundStatus',
        label: '退款状态',
        componentProps: {
          allowClear: true,
          options: [
            { label: '未申请', value: 'none' },
            { label: '待审核', value: 'applied' },
            { label: '已审核', value: 'approved' },
            { label: '已驳回', value: 'rejected' },
            { label: '处理中', value: 'processing' },
            { label: '成功', value: 'succeeded' },
            { label: '失败', value: 'failed' },
          ],
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'orderNumber', minWidth: 190, title: '订单号' },
      { field: 'userInfo.displayName', minWidth: 160, title: '用户昵称' },
      { field: 'userInfo.username', minWidth: 160, title: '用户名' },
      { field: 'status', minWidth: 110, title: '订单状态', slots: { default: 'status' } },
      { field: 'paymentStatus', minWidth: 110, title: '支付状态', slots: { default: 'paymentStatus' } },
      { field: 'refundStatus', minWidth: 110, title: '退款状态', slots: { default: 'refundStatus' } },
      { field: 'totalAmount', minWidth: 120, title: '订单金额' },
      { field: 'createdAt', minWidth: 180, formatter: 'formatDateTime', title: '创建时间' },
      { align: 'left', fixed: 'right', minWidth: 150, field: 'actions', slots: { default: 'actions' }, title: '操作' },
    ],
    keepSource: true,
    pagerConfig: { pageSize: 20 },
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, formValues: Record<string, any>) => {
          return await listOrdersApi({
            keyword: formValues.keyword?.trim() || undefined,
            paymentStatus: formValues.paymentStatus || undefined,
            refundStatus: formValues.refundStatus || undefined,
            status: formValues.status || undefined,
            userId: formValues.userId || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
          });
        },
      },
    },
    toolbarConfig: { custom: true, refresh: true, search: true, zoom: true },
  },
});
</script>

<template>
  <div class="p-5">
    <UserOrderGrid>
      <template #status="{ row }">
        <Tag :color="row.status === 'completed' ? 'success' : row.status === 'paid' ? 'processing' : row.status === 'cancelled' ? 'default' : 'warning'">
          {{ row.status === 'completed' ? '已完成' : row.status === 'paid' ? '已支付' : row.status === 'cancelled' ? '已取消' : '待处理' }}
        </Tag>
      </template>

      <template #paymentStatus="{ row }">
        <Tag :color="getPaymentStatusColor(row.paymentStatus)">
          {{ row.paymentStatus || '-' }}
        </Tag>
      </template>

      <template #refundStatus="{ row }">
        <Tag :color="getRefundStatusColor(row.refundStatus)">
          {{ row.refundStatus || '-' }}
        </Tag>
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip title="详情">
            <Button size="small" type="text" @click="openDetail(row)">
              <EyeOutlined />
            </Button>
          </Tooltip>
          <Tooltip title="删除">
            <Button danger size="small" type="text" @click="handleDelete(row)">
              <DeleteOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
    </UserOrderGrid>
  </div>
</template>
