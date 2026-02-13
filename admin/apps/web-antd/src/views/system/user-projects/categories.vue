<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import type { UserProjectCategoryItem } from '#/api';

import { computed, reactive, ref } from 'vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createUserProjectCategoryApi,
  deleteUserProjectCategoryApi,
  listUserProjectCategoriesApi,
  updateUserProjectCategoryApi,
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
  userId: string;
}

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<null | string>(null);
const formRef = ref<FormInstance>();

const formModel = reactive<CategoryFormModel>({
  userId: '',
  name: '',
  description: '',
  sortOrder: 0,
  enabled: true,
});

const modalTitle = computed(() =>
  editingId.value ? '编辑分类' : '新增分类',
);

function resetForm() {
  formModel.userId = '';
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
  formModel.userId = row.userId || '';
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
      await updateUserProjectCategoryApi(editingId.value, {
        userId: formModel.userId.trim() || undefined,
        name: formModel.name.trim(),
        description: formModel.description || null,
        sortOrder: formModel.sortOrder,
        enabled: formModel.enabled,
      });
      message.success('分类更新成功');
    } else {
      await createUserProjectCategoryApi({
        userId: formModel.userId.trim() || undefined,
        name: formModel.name.trim(),
        description: formModel.description || undefined,
        sortOrder: formModel.sortOrder,
        enabled: formModel.enabled,
      });
      message.success('分类创建成功');
    }
    modalOpen.value = false;
    gridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: UserProjectCategoryItem) {
  Modal.confirm({
    title: `确认删除分类“${row.name}”吗？`,
    content: '删除后已关联项目会清空分类。',
    okType: 'danger',
    onOk: async () => {
      await deleteUserProjectCategoryApi(row.id, row.userId);
      message.success('分类删除成功');
      gridApi.reload();
    },
  });
}

const [Grid, gridApi] = useVbenVxeGrid<UserProjectCategoryItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'userId',
        label: '用户ID',
        componentProps: {
          allowClear: true,
          placeholder: '可选（管理员按用户筛选）',
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 220, title: '名称' },
      { field: 'userId', minWidth: 220, title: '用户ID' },
      { field: 'description', minWidth: 260, title: '描述' },
      { field: 'sortOrder', minWidth: 100, title: '排序' },
      {
        field: 'enabled',
        minWidth: 100,
        title: '状态',
        slots: { default: 'enabled' },
      },
      {
        field: 'updatedAt',
        minWidth: 180,
        formatter: 'formatDateTime',
        title: '更新时间',
      },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 180,
        slots: { default: 'actions' },
        title: '操作',
      },
    ],
    proxyConfig: {
      ajax: {
        query: async (_context: unknown, formValues: Record<string, any>) => {
          const list = await listUserProjectCategoriesApi({
            userId: formValues.userId || undefined,
          });
          return {
            items: list || [],
            total: (list || []).length,
          };
        },
      },
    },
    toolbarConfig: {
      refresh: true,
      search: true,
    },
    pagerConfig: {
      pageSize: 50,
    },
  },
  tableTitle: '项目分类管理',
});
</script>

<template>
  <div class="p-5">
    <Grid>
      <template #toolbar-actions>
        <Button v-access:code="'userProjectCategory:write'" type="primary" @click="openCreate">
          新增分类
        </Button>
      </template>

      <template #enabled="{ row }">
        <Switch :checked="row.enabled" disabled />
      </template>

      <template #actions="{ row }">
        <Space>
          <Button v-access:code="'userProjectCategory:write'" size="small" type="link" @click="openEdit(row)">
            编辑
          </Button>
          <Button
            v-access:code="'userProjectCategory:write'"
            danger
            size="small"
            type="link"
            @click="handleDelete(row)"
          >
            删除
          </Button>
        </Space>
      </template>
    </Grid>

    <Modal
      :open="modalOpen"
      :title="modalTitle"
      :confirm-loading="submitting"
      ok-text="保存"
      cancel-text="取消"
      destroy-on-close
      @cancel="() => (modalOpen = false)"
      @ok="submit"
    >
      <Form ref="formRef" :model="formModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 17 }">
        <Form.Item label="用户ID" name="userId">
          <Input v-model:value="formModel.userId" allow-clear placeholder="为空时默认当前用户" />
        </Form.Item>
        <Form.Item label="名称" name="name" :rules="[{ required: true, message: '请输入分类名称' }]">
          <Input v-model:value="formModel.name" allow-clear />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input v-model:value="formModel.description" allow-clear />
        </Form.Item>
        <Form.Item label="排序" name="sortOrder">
          <InputNumber v-model:value="formModel.sortOrder" :min="0" style="width: 100%" />
        </Form.Item>
        <Form.Item label="启用" name="enabled">
          <Switch v-model:checked="formModel.enabled" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
