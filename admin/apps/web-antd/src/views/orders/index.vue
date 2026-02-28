<script setup lang="ts">
import { ref } from 'vue';
import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { Button, Modal, Space, message, Tooltip } from 'ant-design-vue';
import { EyeOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons-vue';
import { useRouter } from 'vue-router';
import { listOrdersApi, getOrderApi, createOrderApi, updateOrderApi, deleteOrderApi } from '#/api';
import OrderForm from './OrderForm.vue';
import { $t } from '#/locales';

const modalOpen = ref(false);
const editingId = ref<string | null>(null);
const editingModel = ref<any>(null);
const submitting = ref(false);
const t = (key: string, args?: Record<string, unknown>) => $t(key as never, args as never);
const router = useRouter();

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
    message.error(t('page.orders.index.message.loadError'));
  }
}

async function submitForm(payload: any) {
  submitting.value = true;
  try {
    if (editingId.value) {
      await updateOrderApi(editingId.value, payload);
      message.success(t('page.orders.index.message.updateSuccess'));
    } else {
      await createOrderApi(payload);
      message.success(t('page.orders.index.message.createSuccess'));
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
    title: t('page.orders.index.confirm.delete.title', { orderNumber: row.orderNumber }),
    content: t('page.orders.index.confirm.delete.content'),
    okType: 'danger',
    onOk: async () => {
      await deleteOrderApi(row.id);
      message.success(t('page.orders.index.message.deleteSuccess'));
      orderGridApi.reload();
    },
  });
}

function openDetail(row: any) {
  router.push({ name: 'OrderDetail', params: { id: row.id } });
}

const [OrderGrid, orderGridApi] = useVbenVxeGrid({
  formOptions: {
    schema: [
      { component: 'Input', fieldName: 'keyword', label: t('page.orders.index.table.orderNumber'), componentProps: { allowClear: true, placeholder: t('page.orders.form.placeholders.searchProduct') } },
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
        label: t('page.orders.index.table.status'),
        componentProps: {
          allowClear: true,
          options: [
            { label: t('page.orders.index.statusOptions.pending'), value: 'pending' },
            { label: t('page.orders.index.statusOptions.paid'), value: 'paid' },
            { label: t('page.orders.index.statusOptions.completed'), value: 'completed' },
            { label: t('page.orders.index.statusOptions.cancelled'), value: 'cancelled' },
          ],
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'orderNumber', minWidth: 200, title: t('page.orders.index.table.orderNumber') },
      { field: 'status', minWidth: 120, title: t('page.orders.index.table.status') },
      { field: 'paymentStatus', minWidth: 120, title: '支付状态' },
      { field: 'userInfo.displayName', minWidth: 160, title: t('page.orders.index.table.user') },
      { field: 'totalAmount', minWidth: 120, title: t('page.orders.index.table.totalAmount') },
      { field: 'items', minWidth: 120, formatter: (val: any) => (val || []).length, title: t('page.orders.index.table.items') },
      { field: 'createdAt', minWidth: 180, formatter: 'formatDateTime', title: t('page.orders.index.table.createdAt') },
      { align: 'left', fixed: 'right', minWidth: 180, field: 'actions', slots: { default: 'actions' }, title: t('page.orders.index.table.actions') },
    ],
    keepSource: true,
    pagerConfig: { pageSize: 20 },
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, formValues: Record<string, any>) => {
          const params = {
            keyword: formValues.keyword,
            status: formValues.status || undefined,
            paymentStatus: formValues.paymentStatus || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
          };
          return await listOrdersApi(params);
        },
      },
    },
    toolbarConfig: { custom: true, refresh: true, search: true },
  },
});
</script>

<template>
  <div class="p-5">
    <OrderGrid>
      <template #toolbar-actions>
        <Button type="primary" @click="openCreate">{{ t('page.orders.index.toolbar.create') }}</Button>
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip title="详情">
            <Button size="small" type="text" @click="openDetail(row)">
              <EyeOutlined />
            </Button>
          </Tooltip>
          <Tooltip :title="t('page.orders.index.actions.edit') || 'Edit'">
            <Button size="small" type="text" @click="openEditModal(row)">
              <EditOutlined />
            </Button>
          </Tooltip>
          <Tooltip :title="t('page.orders.index.actions.delete') || 'Delete'">
            <Button danger size="small" type="text" @click="handleDelete(row)">
              <DeleteOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
    </OrderGrid>

    <Modal :open="modalOpen" :confirm-loading="submitting" :title="t('page.orders.index.modal.title')" :ok-text="t('page.orders.form.actions.save')" :cancel-text="t('page.orders.form.actions.cancel')" @cancel="() => (modalOpen = false)" :width="1100" :footer="null">
      <OrderForm :model="editingModel" mode="create" @submit="submitForm" @cancel="() => (modalOpen = false)" />
    </Modal>
  </div>
</template>
