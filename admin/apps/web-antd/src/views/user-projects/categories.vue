<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import type { UserProjectCategoryItem } from '#/api';

import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createProjectCategoryApi,
  deleteProjectCategoryApi,
  listProjectCategoriesApi,
  updateProjectCategoryApi,
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
} from 'ant-design-vue';

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

const modalTitle = computed(() =>
  editingId.value ? t('page.userProjects.categories.modal.edit') : t('page.userProjects.categories.modal.create'),
);

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

function openEdit(row: UserProjectCategoryItem) {
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
      await updateProjectCategoryApi(editingId.value, {
        name: formModel.name.trim(),
        description: formModel.description || null,
        sortOrder: formModel.sortOrder,
        enabled: formModel.enabled,
      });
      message.success(t('page.userProjects.categories.message.updateSuccess'));
    } else {
      await createProjectCategoryApi({
        name: formModel.name.trim(),
        description: formModel.description || undefined,
        sortOrder: formModel.sortOrder,
        enabled: formModel.enabled,
      });
      message.success(t('page.userProjects.categories.message.createSuccess'));
    }
    modalOpen.value = false;
    gridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: UserProjectCategoryItem) {
  Modal.confirm({
    title: t('page.userProjects.categories.confirm.delete.title', { name: row.name }),
    content: t('page.userProjects.categories.confirm.delete.content'),
    okType: 'danger',
    onOk: async () => {
      await deleteProjectCategoryApi(row.id);
      message.success(t('page.userProjects.categories.message.deleteSuccess'));
      gridApi.reload();
    },
  });
}

const [Grid, gridApi] = useVbenVxeGrid<UserProjectCategoryItem>({
  formOptions: {
    schema: [],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 220, title: t('page.userProjects.categories.table.name') },
      { field: 'description', minWidth: 260, title: t('page.userProjects.categories.table.description') },
      { field: 'sortOrder', minWidth: 100, title: t('page.userProjects.categories.table.sortOrder') },
      {
        field: 'enabled',
        minWidth: 100,
        title: t('page.userProjects.categories.table.status'),
        slots: { default: 'enabled' },
      },
      {
        field: 'updatedAt',
        minWidth: 180,
        formatter: 'formatDateTime',
        title: t('page.userProjects.categories.table.updatedAt'),
      },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 180,
        slots: { default: 'actions' },
        title: t('page.userProjects.categories.table.actions'),
      },
    ],
    proxyConfig: {
      ajax: {
        query: async () => {
          const list = await listProjectCategoriesApi();
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
    tableTitle: t('page.userProjects.categories.table.title'),
});
</script>

<template>
  <div class="p-5">
    <Grid>
      <template #toolbar-actions>
        <Button v-access:code="'projectCategory:write'" type="primary" @click="openCreate">
          {{ t('page.userProjects.categories.toolbar.create') }}
        </Button>
      </template>

      <template #enabled="{ row }">
        <Switch :checked="row.enabled" disabled />
      </template>

      <template #actions="{ row }">
        <Space>
          <Button v-access:code="'projectCategory:write'" size="small" type="link" @click="openEdit(row)">
            {{ t('page.userProjects.categories.actions.edit') }}
          </Button>
          <Button
            v-access:code="'projectCategory:write'"
            danger
            size="small"
            type="link"
            @click="handleDelete(row)"
          >
            {{ t('page.userProjects.categories.actions.delete') }}
          </Button>
        </Space>
      </template>
    </Grid>

    <Modal
      :open="modalOpen"
      :title="modalTitle"
      :confirm-loading="submitting"
      :ok-text="t('page.userProjects.categories.modal.ok')"
      :cancel-text="t('page.userProjects.categories.modal.cancel')"
      destroy-on-close
      @cancel="() => (modalOpen = false)"
      @ok="submit"
    >
      <Form ref="formRef" :model="formModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 17 }">
        <!-- Categories are global; no per-user association -->
        <Form.Item :label="t('page.userProjects.categories.form.name.label')" name="name" :rules="[{ required: true, message: t('page.userProjects.categories.form.name.required') }]">
          <Input v-model:value="formModel.name" allow-clear />
        </Form.Item>
        <Form.Item :label="t('page.userProjects.categories.form.description.label')" name="description">
          <Input v-model:value="formModel.description" allow-clear />
        </Form.Item>
        <Form.Item :label="t('page.userProjects.categories.form.sortOrder.label')" name="sortOrder">
          <InputNumber v-model:value="formModel.sortOrder" :min="0" style="width: 100%" />
        </Form.Item>
        <Form.Item :label="t('page.userProjects.categories.form.enabled.label')" name="enabled">
          <Switch v-model:checked="formModel.enabled" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
