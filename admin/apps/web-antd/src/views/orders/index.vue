<script setup lang="ts">
import { computed, ref } from 'vue';
import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { Button, Modal, Space, message } from 'ant-design-vue';
import { listOrdersApi, getOrderApi, createOrderApi, updateOrderApi, deleteOrderApi } from '#/api';
import OrderForm from './OrderForm.vue';

const modalOpen = ref(false);
const editingId = ref<string | null>(null);
const editingModel = ref<any>(null);
const submitting = ref(false);

async function openCreate() {
  editingId.value = null;
  editingModel.value = { items: [] };
  modalOpen.value = true;
}

async function openEditModal(row: any) {
  editingId.value = row.id;
  try {
    const data = await getOrderApi(row.id);
    editingModel.value = data;
    modalOpen.value = true;
  } catch (err) {
    message.error('读取订单失败');
  }
}

async function submitForm(payload: any) {
  submitting.value = true;
  try {
    if (editingId.value) {
      await updateOrderApi(editingId.value, payload);
      message.success('订单更新成功');
    } else {
      await createOrderApi(payload);
      message.success('订单创建成功');
    }
    modalOpen.value = false;
    orderGridApi.reload();
  } catch (err) {
    // request client shows errors
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: any) {
  Modal.confirm({
    title: `确认删除订单 ${row.orderNumber} 吗？`,
    content: '删除后不可恢复。',
    okType: 'danger',
    onOk: async () => {
      await deleteOrderApi(row.id);
      message.success('订单已删除');
      orderGridApi.reload();
    },
  });
}

const [OrderGrid, orderGridApi] = useVbenVxeGrid({
  formOptions: {
    schema: [
      { component: 'Input', fieldName: 'keyword', label: '关键字', componentProps: { allowClear: true, placeholder: '订单号' } },
      {
        component: 'Select',
        fieldName: 'status',
        label: '状态',
        componentProps: { allowClear: true, options: [{ label: 'pending', value: 'pending' }, { label: 'paid', value: 'paid' }, { label: 'completed', value: 'completed' }, { label: 'cancelled', value: 'cancelled' }] },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'orderNumber', minWidth: 200, title: '订单号' },
      { field: 'status', minWidth: 120, title: '状态' },
      { field: 'userInfo.displayName', minWidth: 160, title: '用户' },
      { field: 'totalAmount', minWidth: 120, title: '总额' },
      { field: 'items', minWidth: 120, formatter: (val: any) => (val || []).length, title: '商品数' },
      { field: 'createdAt', minWidth: 180, formatter: 'formatDateTime', title: '创建时间' },
      { align: 'left', fixed: 'right', minWidth: 180, field: 'actions', slots: { default: 'actions' }, title: '操作' },
    ],
    keepSource: true,
    pagerConfig: { pageSize: 20 },
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, formValues: Record<string, any>) => {
          const params = {
            keyword: formValues.keyword,
            status: formValues.status || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
          };
          return await listOrdersApi(params);
        },
      },
    },
    toolbarConfig: { custom: true, refresh: true, search: true },
  },
  tableTitle: '订单管理',
});
</script>

<template>
  <div class="p-5">
    <OrderGrid>
      <template #toolbar-actions>
        <Button type="primary" @click="openCreate">新增订单</Button>
      </template>

      <template #actions="{ row }">
        <Space>
          <Button size="small" type="link" @click="openEditModal(row)">编辑</Button>
          <Button danger size="small" type="link" @click="handleDelete(row)">删除</Button>
        </Space>
      </template>
    </OrderGrid>

    <Modal :open="modalOpen" :confirm-loading="submitting" title="订单" ok-text="保存" cancel-text="取消" @cancel="() => (modalOpen = false)" :footer="null">
      <OrderForm :model="editingModel" mode="create" @submit="submitForm" @cancel="() => (modalOpen = false)" />
    </Modal>
  </div>
</template>
