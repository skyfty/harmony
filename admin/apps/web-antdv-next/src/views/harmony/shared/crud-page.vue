<script lang="ts" setup>
import { computed, onMounted, reactive, ref } from 'vue';

import { message, Modal } from 'antdv-next';

type FieldOption = {
  label: string;
  value: string;
};

type Field = {
  key: string;
  label: string;
  required?: boolean;
  type?: string;
  options?: FieldOption[];
};

type Column = {
  dataIndex: string;
  key: string;
  title: string;
};

type PageResponse = {
  data: Record<string, any>[];
  page: number;
  pageSize: number;
  total: number;
};

const props = defineProps<{
  columns: Column[];
  createApi: (payload: Record<string, unknown>) => Promise<unknown>;
  deleteApi: (id: string) => Promise<unknown>;
  fields: Field[];
  keywordPlaceholder?: string;
  listApi: (params: { keyword?: string; page: number; pageSize: number }) => Promise<PageResponse>;
  title: string;
  updateApi: (id: string, payload: Record<string, unknown>) => Promise<unknown>;
}>();

const loading = ref(false);
const modalVisible = ref(false);
const modalLoading = ref(false);
const editingId = ref<string | null>(null);
const keyword = ref('');
const rows = ref<Record<string, any>[]>([]);
const pager = reactive({
  page: 1,
  pageSize: 10,
  total: 0,
});
const formState = reactive<Record<string, any>>({});

const tableColumns = computed(() => {
  return [
    ...props.columns,
    {
      key: 'actions',
      title: '操作',
    },
  ];
});

function resetForm() {
  props.fields.forEach((field) => {
    formState[field.key] = undefined;
  });
}

function openCreate() {
  editingId.value = null;
  resetForm();
  modalVisible.value = true;
}

function openEdit(record: Record<string, any>) {
  editingId.value = record.id;
  props.fields.forEach((field) => {
    formState[field.key] = record[field.key];
  });
  modalVisible.value = true;
}

async function loadData() {
  loading.value = true;
  try {
    const result = await props.listApi({
      keyword: keyword.value || undefined,
      page: pager.page,
      pageSize: pager.pageSize,
    });
    rows.value = result.data || [];
    pager.total = result.total || 0;
  } catch (error: any) {
    message.error(error?.message || `加载${props.title}失败`);
  } finally {
    loading.value = false;
  }
}

async function submit() {
  for (const field of props.fields) {
    if (field.required) {
      const value = formState[field.key];
      if (value === undefined || value === null || value === '') {
        message.warning(`${field.label}不能为空`);
        return;
      }
    }
  }
  modalLoading.value = true;
  try {
    const payload: Record<string, unknown> = {};
    props.fields.forEach((field) => {
      payload[field.key] = formState[field.key];
    });
    if (editingId.value) {
      await props.updateApi(editingId.value, payload);
      message.success('更新成功');
    } else {
      await props.createApi(payload);
      message.success('创建成功');
    }
    modalVisible.value = false;
    await loadData();
  } catch (error: any) {
    message.error(error?.message || '保存失败');
  } finally {
    modalLoading.value = false;
  }
}

function remove(record: Record<string, any>) {
  Modal.confirm({
    title: '确认删除',
    content: `确认删除 ${record.name || record.title || record.id} 吗？`,
    async onOk() {
      await props.deleteApi(record.id);
      message.success('删除成功');
      await loadData();
    },
  });
}

onMounted(() => {
  resetForm();
  loadData();
});
</script>

<template>
  <a-card :title="title">
    <div class="mb-4 flex items-center gap-2">
      <a-input-search
        v-model:value="keyword"
        :placeholder="keywordPlaceholder || `搜索${title}`"
        style="max-width: 280px"
        @search="() => { pager.page = 1; loadData(); }"
      />
      <a-button type="primary" @click="openCreate">新增</a-button>
    </div>

    <a-table
      :columns="tableColumns"
      :data-source="rows"
      :loading="loading"
      row-key="id"
      :pagination="{
        current: pager.page,
        pageSize: pager.pageSize,
        total: pager.total,
        showSizeChanger: true,
        onChange: (page: number, pageSize: number) => {
          pager.page = page;
          pager.pageSize = pageSize;
          loadData();
        },
      }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'actions'">
          <a-space>
            <a-button type="link" @click="openEdit(record)">编辑</a-button>
            <a-button type="link" danger @click="remove(record)">删除</a-button>
          </a-space>
        </template>
      </template>
    </a-table>

    <a-modal
      v-model:open="modalVisible"
      :title="editingId ? `编辑${title}` : `新增${title}`"
      :confirm-loading="modalLoading"
      @ok="submit"
    >
      <a-form layout="vertical">
        <a-form-item
          v-for="field in fields"
          :key="field.key"
          :label="field.label"
          :required="field.required"
        >
          <a-input
            v-if="!field.type || field.type === 'text' || field.type === 'password'"
            v-model:value="formState[field.key]"
            :type="field.type === 'password' ? 'password' : 'text'"
          />
          <a-textarea v-else-if="field.type === 'textarea'" v-model:value="formState[field.key]" :rows="3" />
          <a-input-number v-else-if="field.type === 'number'" v-model:value="formState[field.key]" style="width: 100%" />
          <a-date-picker v-else-if="field.type === 'date'" v-model:value="formState[field.key]" style="width: 100%" value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]" />
          <a-select v-else-if="field.type === 'select'" v-model:value="formState[field.key]" :options="field.options || []" />
        </a-form-item>
      </a-form>
    </a-modal>
  </a-card>
</template>
