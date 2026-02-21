<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';

import { computed, reactive, ref } from 'vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createResourceSeriesApi,
  deleteResourceSeriesApi,
  listResourceSeriesApi,
  updateResourceSeriesApi,
  type ResourceSeriesItem,
} from '#/api';

import { Button, Form, Input, message, Modal, Space } from 'ant-design-vue';

interface SeriesFormModel {
  description: string;
  name: string;
}

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<null | string>(null);
const seriesFormRef = ref<FormInstance>();

const seriesFormModel = reactive<SeriesFormModel>({
  description: '',
  name: '',
});

const modalTitle = computed(() => (editingId.value ? '编辑系列' : '新增系列'));

function resetForm() {
  seriesFormModel.name = '';
  seriesFormModel.description = '';
}

function openCreateModal() {
  editingId.value = null;
  resetForm();
  modalOpen.value = true;
}

function openEditModal(row: ResourceSeriesItem) {
  editingId.value = row.id;
  seriesFormModel.name = row.name || '';
  seriesFormModel.description = row.description || '';
  modalOpen.value = true;
}

async function submitSeries() {
  const form = seriesFormRef.value;
  if (!form) {
    return;
  }
  await form.validate();

  submitting.value = true;
  try {
    const payload = {
      description: seriesFormModel.description.trim() || null,
      name: seriesFormModel.name.trim(),
    };
    if (editingId.value) {
      await updateResourceSeriesApi(editingId.value, payload);
      message.success('系列更新成功');
    } else {
      await createResourceSeriesApi(payload);
      message.success('系列创建成功');
    }
    modalOpen.value = false;
    seriesGridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: ResourceSeriesItem) {
  Modal.confirm({
    title: `确认删除系列 “${row.name}” 吗？`,
    content: '删除后会将该系列下资产的系列置空。',
    okType: 'danger',
    onOk: async () => {
      await deleteResourceSeriesApi(row.id);
      message.success('系列已删除');
      seriesGridApi.reload();
    },
  });
}

const [SeriesGrid, seriesGridApi] = useVbenVxeGrid<ResourceSeriesItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键字',
        componentProps: {
          allowClear: true,
          placeholder: '系列名称',
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 180, title: '名称' },
      { field: 'description', minWidth: 260, title: '描述' },
      { field: 'assetCount', minWidth: 120, title: '资产数量' },
      { field: 'createdAt', minWidth: 170, formatter: 'formatDateTime', title: '创建时间' },
      { field: 'updatedAt', minWidth: 170, formatter: 'formatDateTime', title: '更新时间' },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 160,
        slots: { default: 'actions' },
        title: '操作',
      },
    ],
    pagerConfig: {
      enabled: false,
    },
    proxyConfig: {
      ajax: {
        query: async (_params: any, formValues: Record<string, any>) => {
          const keyword = (formValues.keyword || '').trim().toLowerCase();
          const all = await listResourceSeriesApi();
          const filtered = !keyword
            ? all
            : all.filter((item) => {
                const name = item.name?.toLowerCase() || '';
                const desc = item.description?.toLowerCase() || '';
                return name.includes(keyword) || desc.includes(keyword);
              });
          return {
            items: filtered,
            total: filtered.length,
          };
        },
      },
    },
    toolbarConfig: {
      custom: true,
      refresh: true,
      search: true,
      zoom: true,
    },
  },
  tableTitle: '资源系列管理',
});
</script>

<template>
  <div class="p-5">
    <SeriesGrid>
      <template #toolbar-actions>
        <Button v-access:code="'resource:write'" type="primary" @click="openCreateModal">新增系列</Button>
      </template>

      <template #actions="{ row }">
        <Space>
          <Button v-access:code="'resource:write'" type="link" size="small" @click="openEditModal(row)">编辑</Button>
          <Button v-access:code="'resource:write'" danger type="link" size="small" @click="handleDelete(row)">删除</Button>
        </Space>
      </template>
    </SeriesGrid>

    <Modal
      :open="modalOpen"
      :title="modalTitle"
      :confirm-loading="submitting"
      ok-text="保存"
      cancel-text="取消"
      destroy-on-close
      @cancel="() => (modalOpen = false)"
      @ok="submitSeries"
    >
      <Form ref="seriesFormRef" :model="seriesFormModel" :label-col="{ span: 5 }" :wrapper-col="{ span: 18 }">
        <Form.Item label="名称" name="name" :rules="[{ required: true, message: '请输入系列名称' }]">
          <Input v-model:value="seriesFormModel.name" allow-clear placeholder="系列名称" />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input v-model:value="seriesFormModel.description" allow-clear placeholder="描述（可选）" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
