<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import type { ProductCategoryItem } from '#/api';

import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createProductCategoryApi,
  deleteProductCategoryApi,
  listProductCategoriesApi,
  updateProductCategoryApi,
} from '#/api';

import {
  Button,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Space,
  Switch,
  Tooltip,
} from 'ant-design-vue';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons-vue';

interface CategoryFormModel {
  description: string;
  enabled: boolean;
  name: string;
  sortOrder: number;
}

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<null | string>(null);
const formRef = ref<FormInstance>();

const formModel = reactive<CategoryFormModel>({
  name: '',
  description: '',
  sortOrder: 0,
  enabled: true,
});

const { t } = useI18n();
const modalTitle = computed(() => (editingId.value ? t('page.products.categories.modal.edit') : t('page.products.categories.modal.create')));

function resetForm() {
  formModel.name = '';
  formModel.description = '';
  formModel.sortOrder = 0;
  formModel.enabled = true;
}

function openCreate() {
  editingId.value = null;
  resetForm();
  modalOpen.value = true;
}

function openEdit(row: ProductCategoryItem) {
  editingId.value = row.id;
  formModel.name = row.name;
  formModel.description = row.description || '';
  formModel.sortOrder = row.sortOrder || 0;
  formModel.enabled = row.enabled !== false;
  modalOpen.value = true;
}

async function submit() {
  const form = formRef.value;
  if (!form) {
    return;
  }
  await form.validate();
  submitting.value = true;
  try {
    if (editingId.value) {
      await updateProductCategoryApi(editingId.value, {
        name: formModel.name.trim(),
        description: formModel.description || null,
        sortOrder: formModel.sortOrder,
        enabled: formModel.enabled,
      });
      message.success(t('page.products.categories.message.updateSuccess'));
    } else {
      await createProductCategoryApi({
        name: formModel.name.trim(),
        description: formModel.description || undefined,
        sortOrder: formModel.sortOrder,
        enabled: formModel.enabled,
      });
      message.success(t('page.products.categories.message.createSuccess'));
    }
    modalOpen.value = false;
    gridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: ProductCategoryItem) {
  if (row.isBuiltin) {
    message.warning(t('page.products.categories.message.builtinCannotDelete'));
    return;
  }
  Modal.confirm({
    title: t('page.products.categories.confirm.delete.title', { name: row.name }),
    content: t('page.products.categories.confirm.delete.content'),
    okType: 'danger',
    onOk: async () => {
      await deleteProductCategoryApi(row.id);
      message.success(t('page.products.categories.message.deleteSuccess'));
      gridApi.reload();
    },
  });
}

const [Grid, gridApi] = useVbenVxeGrid<ProductCategoryItem>({
  formOptions: {
    schema: [],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 220, title: t('page.products.categories.table.name') },
      { field: 'description', minWidth: 260, title: t('page.products.categories.table.description') },
      { field: 'sortOrder', minWidth: 100, title: t('page.products.categories.table.sortOrder') },
      {
        field: 'enabled',
        minWidth: 100,
        title: t('page.products.categories.table.enabled'),
        slots: { default: 'enabled' },
      },
      {
        field: 'isBuiltin',
        minWidth: 100,
        title: t('page.products.categories.table.isBuiltin'),
        slots: { default: 'builtin' },
      },
      {
        field: 'updatedAt',
        minWidth: 180,
        formatter: 'formatDateTime',
        title: t('page.products.categories.table.updatedAt'),
      },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 180,
        slots: { default: 'actions' },
        title: t('page.products.categories.table.actions'),
      },
    ],
    proxyConfig: {
      ajax: {
        query: async () => {
          const list = await listProductCategoriesApi();
          return {
            items: list || [],
            total: (list || []).length,
          };
        },
      },
    },
    toolbarConfig: {
      refresh: true,
      search: false,
    },
    pagerConfig: {
      pageSize: 50,
    },
  },
});
</script>

<template>
  <div class="p-5">
    <Grid>
      <template #toolbar-actions>
        <Button v-access:code="'product:write'" type="primary" @click="openCreate">{{ t('page.products.categories.toolbar.create') }}</Button>
      </template>

      <template #enabled="{ row }">
        <Switch :checked="row.enabled" disabled />
      </template>

      <template #builtin="{ row }">
        <span>{{ row.isBuiltin ? t('page.products.categories.values.yes') : t('page.products.categories.values.no') }}</span>
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip :title="t('page.products.categories.actions.edit')">
            <Button v-access:code="'product:write'" size="small" type="text" @click="openEdit(row)">
              <EditOutlined />
            </Button>
          </Tooltip>

          <Tooltip :title="t('page.products.categories.actions.delete')">
            <Button
              v-access:code="'product:write'"
              :disabled="row.isBuiltin"
              danger
              size="small"
              type="text"
              @click="handleDelete(row)"
            >
              <DeleteOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
    </Grid>

    <Modal
      :open="modalOpen"
      :title="modalTitle"
      :confirm-loading="submitting"
      :ok-text="t('page.products.categories.modal.ok')"
      :cancel-text="t('page.products.categories.modal.cancel')"
      destroy-on-close
      @cancel="() => (modalOpen = false)"
      @ok="submit"
    >
      <Form ref="formRef" :model="formModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 17 }">
        <Form.Item :label="t('page.products.categories.form.name.label')" name="name" :rules="[{ required: true, message: t('page.products.categories.form.name.required') }]">
          <Input v-model:value="formModel.name" allow-clear />
        </Form.Item>
        <Form.Item :label="t('page.products.categories.form.description.label')" name="description">
          <Input.TextArea v-model:value="formModel.description" allow-clear rows="4" />
        </Form.Item>
        <Form.Item :label="t('page.products.categories.form.sortOrder.label')" name="sortOrder">
          <InputNumber v-model:value="formModel.sortOrder" :min="0" style="width: 100%" />
        </Form.Item>
        <Form.Item :label="t('page.products.categories.form.enabled.label')" name="enabled">
          <Switch v-model:checked="formModel.enabled" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
