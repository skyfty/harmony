<script lang="ts" setup>
import { ref } from 'vue';

import { message, Modal } from 'antdv-next';

import { createAsset, deleteAsset, fetchAssets } from '#/api';

const loading = ref(false);
const rows = ref<Record<string, any>[]>([]);
const pager = ref({ page: 1, pageSize: 10, total: 0 });

const modalVisible = ref(false);
const form = ref({
  name: '',
  type: 'model',
  categoryId: '',
  file: null as File | null,
  description: '',
});

const columns = [
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: '类型', dataIndex: 'type', key: 'type' },
  { title: '路径(URL)', dataIndex: 'url', key: 'url' },
  { title: '操作', dataIndex: 'actions', key: 'actions' },
];

async function loadData() {
  loading.value = true;
  try {
    const result = await fetchAssets({ page: pager.value.page, pageSize: pager.value.pageSize });
    rows.value = result.data || [];
    pager.value.total = result.total || 0;
  } finally {
    loading.value = false;
  }
}

async function submit() {
  if (!form.value.file) {
    message.warning('请上传资源文件');
    return;
  }
  await createAsset({
    name: form.value.name,
    type: form.value.type,
    categoryId: form.value.categoryId,
    description: form.value.description,
    file: form.value.file,
  });
  modalVisible.value = false;
  message.success('创建成功');
  await loadData();
}

function onFileChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0] ?? null;
  form.value.file = file;
}

function remove(record: Record<string, any>) {
  Modal.confirm({
    title: '确认删除资源',
    async onOk() {
      await deleteAsset(record.id);
      await loadData();
    },
  });
}

loadData();
</script>

<template>
  <a-card title="资产管理">
    <div class="mb-4">
      <a-button type="primary" @click="modalVisible = true">新增资源</a-button>
    </div>

    <a-table
      :columns="columns"
      :data-source="rows"
      :loading="loading"
      row-key="id"
      :pagination="{
        current: pager.page,
        pageSize: pager.pageSize,
        total: pager.total,
        onChange: (page: number, pageSize: number) => {
          pager.page = page;
          pager.pageSize = pageSize;
          loadData();
        },
      }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'actions'">
          <a-button type="link" danger @click="remove(record)">删除</a-button>
        </template>
      </template>
    </a-table>

    <a-modal v-model:open="modalVisible" title="新增资源" @ok="submit">
      <a-form layout="vertical">
        <a-form-item label="名称" required>
          <a-input v-model:value="form.name" />
        </a-form-item>
        <a-form-item label="类型" required>
          <a-input v-model:value="form.type" />
        </a-form-item>
        <a-form-item label="分类ID" required>
          <a-input v-model:value="form.categoryId" />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea v-model:value="form.description" />
        </a-form-item>
        <a-form-item label="资源文件" required>
          <input type="file" @change="onFileChange" />
        </a-form-item>
      </a-form>
    </a-modal>
  </a-card>
</template>
