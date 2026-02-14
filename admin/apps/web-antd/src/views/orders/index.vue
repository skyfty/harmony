<script setup lang="ts">
import { ref } from 'vue';
import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { Button, Modal, Space, message } from 'ant-design-vue';
import { listOrdersApi, getOrderApi, createOrderApi, updateOrderApi, deleteOrderApi } from '#/api';
import OrderForm from './OrderForm.vue';

const modalOpen = ref(false);
const editingId = ref<string | null>(null);
const editingModel = ref<any>(null);
const submitting = ref(false);
const t = (key: string, _params?: Record<string, unknown>) => key;

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

const [OrderGrid, orderGridApi] = useVbenVxeGrid({
  formOptions: {
    schema: [
      { component: 'Input', fieldName: 'keyword', label: t('page.orders.index.table.orderNumber'), componentProps: { allowClear: true, placeholder: t('page.orders.form.placeholders.searchProduct') } },
      {
        component: 'Select',
        fieldName: 'status',
        label: t('page.orders.index.table.status'),
        componentProps: { allowClear: true, options: [{ label: 'pending', value: 'pending' }, { label: 'paid', value: 'paid' }, { label: 'completed', value: 'completed' }, { label: 'cancelled', value: 'cancelled' }] },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'orderNumber', minWidth: 200, title: t('page.orders.index.table.orderNumber') },
      { field: 'status', minWidth: 120, title: t('page.orders.index.table.status') },
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
            page: page.currentPage,
            pageSize: page.pageSize,
          };
          return await listOrdersApi(params);
        },
      },
    },
    toolbarConfig: { custom: true, refresh: true, search: true },
  },
  tableTitle: t('page.orders.index.table.title'),
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
          <Button size="small" type="link" @click="openEditModal(row)">{{ t('page.orders.index.actions.edit') || 'Edit' }}</Button>
          <Button danger size="small" type="link" @click="handleDelete(row)">{{ t('page.orders.index.actions.delete') || 'Delete' }}</Button>
        </Space>
      </template>
    </OrderGrid>

    <Modal :open="modalOpen" :confirm-loading="submitting" :title="t('page.orders.index.modal.title')" :ok-text="t('page.orders.form.actions.save')" :cancel-text="t('page.orders.form.actions.cancel')" @cancel="() => (modalOpen = false)" :footer="null">
      <OrderForm :model="editingModel" mode="create" @submit="submitForm" @cancel="() => (modalOpen = false)" />
    </Modal>
  </div>
</template>
