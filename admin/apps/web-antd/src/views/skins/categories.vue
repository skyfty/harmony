<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import { computed, reactive, ref } from 'vue';
import { Button, Form, Input, InputNumber, message, Modal, Select, Space, Switch, Tooltip } from 'ant-design-vue';
import { DeleteOutlined, EditOutlined } from '@ant-design/icons-vue';
import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createSkinCategoryApi,
  deleteSkinCategoryApi,
  listSkinCategoriesApi,
  type SkinCategoryItem,
  type SkinSlotKey,
  updateSkinCategoryApi,
} from '#/api';

const slotOptions: Array<{ label: string; value: SkinSlotKey }> = [
  { label: '帽子 Hat', value: 'hatAssetId' },
  { label: '眼镜 Glasses', value: 'glassesAssetId' },
  { label: '头发 Hair', value: 'hairAssetId' },
  { label: '上衣 Top', value: 'topAssetId' },
  { label: '裤子 Pants', value: 'pantsAssetId' },
  { label: '鞋子 Shoes', value: 'shoesAssetId' },
];

const slotLabel = (value: SkinSlotKey) => slotOptions.find((item) => item.value === value)?.label || value;

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<string | null>(null);
const formRef = ref<FormInstance>();

const formModel = reactive({
  name: '',
  slotKey: 'hatAssetId' as SkinSlotKey,
  sortOrder: 0,
  description: '',
  enabled: true,
});

const modalTitle = computed(() => (editingId.value ? '编辑皮肤分类' : '新增皮肤分类'));

function resetForm() {
  Object.assign(formModel, {
    name: '',
    slotKey: 'hatAssetId',
    sortOrder: 0,
    description: '',
    enabled: true,
  });
}

function openCreate() {
  editingId.value = null;
  resetForm();
  modalOpen.value = true;
}

function openEdit(row: SkinCategoryItem) {
  editingId.value = row.id;
  Object.assign(formModel, {
    name: row.name,
    slotKey: row.slotKey,
    sortOrder: row.sortOrder || 0,
    description: row.description || '',
    enabled: row.enabled !== false,
  });
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
      await updateSkinCategoryApi(editingId.value, {
        name: formModel.name.trim(),
        description: formModel.description || null,
        sortOrder: formModel.sortOrder,
        enabled: formModel.enabled,
      });
      message.success('皮肤分类已更新');
    } else {
      await createSkinCategoryApi({
        name: formModel.name.trim(),
        slotKey: formModel.slotKey,
        description: formModel.description || undefined,
        sortOrder: formModel.sortOrder,
        enabled: formModel.enabled,
      });
      message.success('皮肤分类已创建');
    }
    modalOpen.value = false;
    gridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: SkinCategoryItem) {
  Modal.confirm({
    title: `确认删除“${row.name}”？`,
    content: '删除后该槽位分类将不可用；分类下存在皮肤时无法删除。',
    okType: 'danger',
    onOk: async () => {
      await deleteSkinCategoryApi(row.id);
      message.success('删除成功');
      await gridApi.query();
    },
  });
}

const [Grid, gridApi] = useVbenVxeGrid<SkinCategoryItem>({
  formOptions: {
    schema: [],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', title: '名称', minWidth: 180 },
      {
        field: 'slotKey',
        title: '皮肤槽位',
        minWidth: 160,
        formatter: ({ cellValue }: { cellValue: SkinSlotKey }) => slotLabel(cellValue),
      },
      { field: 'sortOrder', title: '排序', minWidth: 100 },
      { field: 'enabled', title: '启用', minWidth: 90, slots: { default: 'enabled' } },
      { field: 'isBuiltin', title: '内置', minWidth: 90, slots: { default: 'builtin' } },
      { field: 'updatedAt', title: '更新时间', minWidth: 180, formatter: 'formatDateTime' },
      { field: 'actions', title: '操作', fixed: 'right', minWidth: 150, slots: { default: 'actions' } },
    ],
    proxyConfig: {
      ajax: {
        query: async () => {
          const list = await listSkinCategoriesApi();
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
        <Button v-access:code="'skinCategory:write'" type="primary" @click="openCreate">新增皮肤分类</Button>
      </template>

      <template #enabled="{ row }">
        <Switch :checked="row.enabled" disabled />
      </template>

      <template #builtin="{ row }">
        <span>{{ row.isBuiltin ? '是' : '否' }}</span>
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip title="编辑">
            <Button v-access:code="'skinCategory:write'" size="small" type="text" @click="openEdit(row)">
              <EditOutlined />
            </Button>
          </Tooltip>

          <Tooltip title="删除">
            <Button v-access:code="'skinCategory:write'" danger size="small" type="text" @click="handleDelete(row)">
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
      ok-text="保存"
      cancel-text="取消"
      destroy-on-close
      @cancel="() => (modalOpen = false)"
      @ok="submit"
    >
      <Form ref="formRef" :model="formModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 17 }">
        <Form.Item label="名称" name="name" :rules="[{ required: true, message: '请输入分类名称' }]">
          <Input v-model:value="formModel.name" allow-clear />
        </Form.Item>
        <Form.Item label="皮肤槽位" name="slotKey" :rules="[{ required: true, message: '请选择皮肤槽位' }]">
          <Select
            v-model:value="formModel.slotKey"
            :options="slotOptions"
            :disabled="Boolean(editingId)"
            placeholder="绑定 SkinComponent 槽位"
          />
        </Form.Item>
        <Form.Item label="排序">
          <InputNumber v-model:value="formModel.sortOrder" :min="0" style="width: 100%" />
        </Form.Item>
        <Form.Item label="描述">
          <Input.TextArea v-model:value="formModel.description" :rows="4" allow-clear />
        </Form.Item>
        <Form.Item label="启用">
          <Switch v-model:checked="formModel.enabled" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
