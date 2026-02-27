<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';

import { computed, reactive, ref } from 'vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createResourceTagApi,
  deleteResourceTagApi,
  listResourceTagsApi,
  updateResourceTagApi,
  type ResourceTagItem,
} from '#/api';

import { Button, Form, Input, message, Modal, Space } from 'ant-design-vue';

interface TagFormModel {
  description: string;
  name: string;
}

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<null | string>(null);
const tagFormRef = ref<FormInstance>();

const tagFormModel = reactive<TagFormModel>({
  description: '',
  name: '',
});

const modalTitle = computed(() => (editingId.value ? '编辑标签' : '新增标签'));

function resetForm() {
  tagFormModel.name = '';
  tagFormModel.description = '';
}

function openCreateModal() {
  editingId.value = null;
  resetForm();
  modalOpen.value = true;
}

function openEditModal(row: ResourceTagItem) {
  editingId.value = row.id;
  tagFormModel.name = row.name || '';
  tagFormModel.description = row.description || '';
  modalOpen.value = true;
}

async function submitTag() {
  const form = tagFormRef.value;
  if (!form) {
    return;
  }
  await form.validate();

  submitting.value = true;
  try {
    const payload = {
      description: tagFormModel.description.trim() || undefined,
      name: tagFormModel.name.trim(),
    };
    if (editingId.value) {
      await updateResourceTagApi(editingId.value, payload);
      message.success('标签更新成功');
    } else {
      await createResourceTagApi(payload);
      message.success('标签创建成功');
    }
    modalOpen.value = false;
    tagGridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: ResourceTagItem) {
  Modal.confirm({
    title: `确认删除标签 “${row.name}” 吗？`,
    content: '删除后不可恢复。若标签已被资产使用，后端会拒绝删除。',
    okType: 'danger',
    onOk: async () => {
      await deleteResourceTagApi(row.id);
      message.success('标签已删除');
      tagGridApi.reload();
    },
  });
}

const [TagGrid, tagGridApi] = useVbenVxeGrid<ResourceTagItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键字',
        componentProps: {
          allowClear: true,
          placeholder: '标签名称',
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 180, title: '名称' },
      { field: 'description', minWidth: 260, title: '描述' },
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
          const all = await listResourceTagsApi();
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
});
</script>

<template>
  <div class="p-5">
    <TagGrid>
      <template #toolbar-actions>
        <Button v-access:code="'resource:write'" type="primary" @click="openCreateModal">新增标签</Button>
      </template>

      <template #actions="{ row }">
        <Space>
          <Button v-access:code="'resource:write'" type="link" size="small" @click="openEditModal(row)">编辑</Button>
          <Button v-access:code="'resource:write'" danger type="link" size="small" @click="handleDelete(row)">删除</Button>
        </Space>
      </template>
    </TagGrid>

    <Modal
      :open="modalOpen"
      :title="modalTitle"
      :confirm-loading="submitting"
      ok-text="保存"
      cancel-text="取消"
      destroy-on-close
      @cancel="() => (modalOpen = false)"
      @ok="submitTag"
    >
      <Form ref="tagFormRef" :model="tagFormModel" :label-col="{ span: 5 }" :wrapper-col="{ span: 18 }">
        <Form.Item label="名称" name="name" :rules="[{ required: true, message: '请输入标签名称' }]">
          <Input v-model:value="tagFormModel.name" allow-clear placeholder="标签名称" />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input.TextArea v-model:value="tagFormModel.description" allow-clear placeholder="描述（可选）" rows="4" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
