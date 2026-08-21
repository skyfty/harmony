<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { Button, Form, Input, InputNumber, message, Modal, Select, Space, Switch, Tooltip } from 'ant-design-vue';
import { DeleteOutlined, EditOutlined } from '@ant-design/icons-vue';
import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createSkinApi,
  deleteSkinApi,
  getSkinApi,
  listSkinCategoriesApi,
  listSkinsApi,
  type SkinCategoryItem,
  type SkinItem,
  type SkinPayload,
  updateSkinApi,
} from '#/api';

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<string | null>(null);
const formRef = ref<FormInstance>();
const categoryOptions = ref<Array<{ label: string; value: string }>>([]);

type SkinFormModel = Omit<SkinPayload, 'categoryId'> & { categoryId: string };

const formModel = reactive<SkinFormModel>({
  identifier: '',
  name: '',
  categoryId: '',
  sortOrder: 0,
  description: '',
  prefabUrl: '',
  isActive: true,
});

const modalTitle = computed(() => (editingId.value ? '编辑皮肤' : '新增皮肤'));

function resetForm() {
  Object.assign(formModel, {
    identifier: '',
    name: '',
    categoryId: '',
    sortOrder: 0,
    description: '',
    prefabUrl: '',
    isActive: true,
  });
}

function openCreate() {
  editingId.value = null;
  resetForm();
  modalOpen.value = true;
}

async function openEdit(row: SkinItem) {
  const item = await getSkinApi(row.id);
  editingId.value = row.id;
  Object.assign(formModel, {
    identifier: item.identifier,
    name: item.name,
    categoryId: item.categoryId ?? '',
    sortOrder: item.sortOrder,
    description: item.description,
    prefabUrl: item.prefabUrl ?? '',
    isActive: item.isActive !== false,
  });
  modalOpen.value = true;
}

async function submit() {
  if (!formRef.value) {
    return;
  }
  await formRef.value.validate();
  submitting.value = true;
  try {
    const payload: SkinPayload = {
      identifier: formModel.identifier.trim(),
      name: formModel.name.trim(),
      categoryId: formModel.categoryId,
      sortOrder: Number(formModel.sortOrder) || 0,
      description: formModel.description?.trim() || '',
      prefabUrl: formModel.prefabUrl?.trim() || '',
      isActive: formModel.isActive !== false,
    };
    if (editingId.value) {
      await updateSkinApi(editingId.value, payload);
      message.success('皮肤已更新');
    } else {
      await createSkinApi(payload);
      message.success('皮肤已创建');
    }
    modalOpen.value = false;
    await gridApi.query();
  } finally {
    submitting.value = false;
  }
}

function remove(row: SkinItem) {
  Modal.confirm({
    title: `确认删除“${row.name}”？`,
    content: '删除后会同时下线关联商品，请谨慎操作。',
    okType: 'danger',
    onOk: async () => {
      await deleteSkinApi(row.id);
      message.success('删除成功');
      await gridApi.query();
    },
  });
}

const [SkinGrid, gridApi] = useVbenVxeGrid<SkinItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键词',
        componentProps: {
          allowClear: true,
          placeholder: '标识/名称/描述',
        },
      },
      {
        component: 'Select',
        fieldName: 'categoryId',
        label: '分类',
        componentProps: {
          allowClear: true,
          options: categoryOptions,
          placeholder: '全部分类',
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'identifier', title: '标识', minWidth: 140 },
      { field: 'name', title: '名称', minWidth: 160 },
      { field: 'categoryName', title: '皮肤分类', minWidth: 140 },
      { field: 'prefabUrl', title: 'Prefab URL', minWidth: 260, showOverflow: true },
      { field: 'product.name', title: '关联商品', minWidth: 160 },
      { field: 'product.price', title: '价格', minWidth: 100 },
      { field: 'isActive', title: '启用', minWidth: 90, slots: { default: 'isActive' } },
      { field: 'actions', title: '操作', fixed: 'right', minWidth: 150, slots: { default: 'actions' } },
    ],
    pagerConfig: { pageSize: 20 },
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, values: Record<string, any>) => {
          return await listSkinsApi({
            keyword: values.keyword || undefined,
            categoryId: values.categoryId || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
          });
        },
      },
    },
    toolbarConfig: { custom: true, refresh: true, search: true, zoom: true },
  },
});

onMounted(async () => {
  try {
    const categories = await listSkinCategoriesApi();
    categoryOptions.value = (categories || [])
      .filter((item: SkinCategoryItem) => item.enabled !== false)
      .map((item: SkinCategoryItem) => ({ label: item.name, value: item.id }));
  } catch {
    categoryOptions.value = [];
  }
});
</script>

<template>
  <div class="p-5">
    <SkinGrid>
      <template #toolbar-actions>
        <Button v-access:code="'skin:write'" type="primary" @click="openCreate">新增皮肤</Button>
      </template>

      <template #isActive="{ row }">
        <span :style="{ color: row.isActive ? '#16a34a' : '#9ca3af' }">
          {{ row.isActive ? '启用' : '停用' }}
        </span>
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip title="编辑">
            <Button v-access:code="'skin:write'" size="small" type="text" @click="openEdit(row)">
              <EditOutlined />
            </Button>
          </Tooltip>

          <Tooltip title="删除">
            <Button v-access:code="'skin:write'" danger size="small" type="text" @click="remove(row)">
              <DeleteOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
    </SkinGrid>

    <Modal
      :open="modalOpen"
      :title="modalTitle"
      :confirm-loading="submitting"
      ok-text="保存"
      cancel-text="取消"
      destroy-on-close
      :width="860"
      @cancel="() => (modalOpen = false)"
      @ok="submit"
    >
      <Form ref="formRef" :model="formModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 17 }">
        <Form.Item label="皮肤分类" name="categoryId" :rules="[{ required: true, message: '请选择皮肤分类' }]">
          <Select v-model:value="formModel.categoryId" :options="categoryOptions" placeholder="选择皮肤分类" />
        </Form.Item>
        <Form.Item label="标识" name="identifier" :rules="[{ required: true, message: '请输入标识' }]">
          <Input v-model:value="formModel.identifier" />
        </Form.Item>
        <Form.Item label="名称" name="name" :rules="[{ required: true, message: '请输入名称' }]">
          <Input v-model:value="formModel.name" />
        </Form.Item>
        <Form.Item label="排序">
          <InputNumber v-model:value="formModel.sortOrder" :min="0" style="width: 100%" />
        </Form.Item>
        <Form.Item label="Prefab URL" name="prefabUrl">
          <Input v-model:value="formModel.prefabUrl" placeholder="从资产管理-资源下载弹窗复制下载链接后粘贴" />
        </Form.Item>
        <Form.Item label="描述">
          <Input.TextArea v-model:value="formModel.description" :rows="4" />
        </Form.Item>
        <Form.Item label="启用">
          <Switch v-model:checked="formModel.isActive" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
