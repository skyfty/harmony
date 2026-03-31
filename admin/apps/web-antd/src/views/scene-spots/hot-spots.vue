<script setup lang="ts">
import type { HotFeaturedItem } from '#/api/core/hotFeatured';
import type { SceneItem } from '#/api';
import { ref, onMounted } from 'vue';
import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { listSceneSpotsApi } from '#/api';
import { listHotSpotsApi, createHotSpotApi, updateHotSpotApi, deleteHotSpotApi } from '#/api/core/hotFeatured';
import { Button, Modal, message, InputNumber, Select, Form } from 'ant-design-vue';
import type { FormInstance } from 'ant-design-vue';
import { $t } from '#/locales';

const t = (k: string) => $t(k as never) as string;

const sceneOptions = ref<Array<{ label: string; value: string }>>([]);
const sceneOptionsLoading = ref(false);
const sceneOptionsPage = ref(1);
const sceneOptionsPageSize = 20;
const sceneOptionsHasMore = ref(true);
let sceneSearchTimer: any = null;
const sceneSearchKeyword = ref('');

async function loadSceneOptions(reset = true) {
  if (sceneOptionsLoading.value) return;
  if (!reset && !sceneOptionsHasMore.value) return;
  sceneOptionsLoading.value = true;
  try {
    const next = reset ? 1 : sceneOptionsPage.value + 1;
    const res = await listSceneSpotsApi({ page: next, pageSize: sceneOptionsPageSize });
    const items = res.items || [];
    const mapped = items.map((it: SceneItem | any) => ({ label: it.title || it.name || it.id, value: it.id }));
    if (reset) sceneOptions.value = mapped;
    else sceneOptions.value = [...sceneOptions.value, ...mapped];
    sceneOptionsPage.value = next;
    sceneOptionsHasMore.value = sceneOptions.value.length < (res.total || 0);
  } finally {
    sceneOptionsLoading.value = false;
  }
}

function handleSceneSearch(keyword: string) {
  if (sceneSearchTimer) clearTimeout(sceneSearchTimer);
  sceneSearchTimer = setTimeout(() => {
    sceneSearchKeyword.value = keyword.trim();
    loadSceneOptions(true);
  }, 250);
}

const [Grid, gridApi] = useVbenVxeGrid<HotFeaturedItem>({
  formOptions: {
    schema: [
      {
        component: 'Select',
        fieldName: 'sceneSpotId',
        label: '景点',
        componentProps: {
          options: sceneOptions,
          loading: sceneOptionsLoading,
          showSearch: true,
          filterOption: false,
          onSearch: (v: string) => handleSceneSearch(v),
        },
      },
      {
        component: 'InputNumber',
        fieldName: 'order',
        label: '排序',
        componentProps: { style: { width: '120px' } },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'sceneSpotTitle', title: '景点', minWidth: 220 },
      { field: 'order', title: '排序', minWidth: 100 },
      { field: 'updatedAt', title: '更新时间', formatter: 'formatDateTime', minWidth: 180 },
      { field: 'actions', title: '操作', slots: { default: 'actions' }, fixed: 'right', minWidth: 140 },
    ],
    pagerConfig: { pageSize: 20 },
    proxyConfig: {
      ajax: {
        query: async () => {
          const res = await listHotSpotsApi();
          return { items: res.items, total: res.total } as any;
        },
      },
    },
    sortConfig: { defaultSort: { field: 'order', order: 'asc' }, remote: false },
    toolbarConfig: { custom: true, refresh: true, search: true },
  },
});

async function handleAdd(values: any) {
  try {
    await createHotSpotApi({ sceneSpotId: values.sceneSpotId, order: values.order || 0 });
    message.success('添加成功');
    gridApi.reload();
  } catch (err) {
    message.error('添加失败');
  }
}

async function handleUpdateOrder(row: any) {
  try {
    await updateHotSpotApi(row.id, { order: row.order });
    message.success('更新成功');
    gridApi.reload();
  } catch (err) {
    message.error('更新失败');
  }
}

async function handleDelete(row: any) {
  Modal.confirm({
    title: `删除热门景点` ,
    content: `确定删除 ${row.sceneSpotTitle || ''} 吗？`,
    onOk: async () => {
      await deleteHotSpotApi(row.id);
      message.success('删除成功');
      gridApi.reload();
    },
  });
}

onMounted(async () => {
  await loadSceneOptions(true);
});

// modal form state
const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<null | string>(null);
const formRef = ref<FormInstance>();
const formModel = ref({ sceneSpotId: '', order: 0 });

function openCreateModal() {
  editingId.value = null;
  formModel.value = { sceneSpotId: '', order: 0 };
  modalOpen.value = true;
}

function openEditModal(row: any) {
  editingId.value = String(row.id || '')
  formModel.value = { sceneSpotId: row.sceneSpotId || '', order: typeof row.order === 'number' ? row.order : 0 }
  modalOpen.value = true
}

async function submitForm() {
  const form = formRef.value;
  if (!form) return;
  await form.validate();
  submitting.value = true;
  try {
    if (editingId.value) {
      // only order can be updated for existing
      await updateHotSpotApi(editingId.value, { order: formModel.value.order });
      message.success('更新成功');
    } else {
      await createHotSpotApi({ sceneSpotId: formModel.value.sceneSpotId, order: formModel.value.order });
      message.success('添加成功');
    }
    modalOpen.value = false;
    gridApi.reload();
  } catch (err) {
    // show server-provided message when available
    const serverMsg = (err as any)?.response?.data?.message || (err as any)?.message
    message.error(serverMsg || '提交失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="p-5">
    <Grid>
      <template #toolbar-actions>
        <Button type="primary" @click="openCreateModal">添加热门景点</Button>
      </template>

      <template #actions="{ row }">
          <Button size="small" type="text" @click="() => openEditModal(row)">编辑</Button>
          <Button size="small" type="text" @click="() => handleUpdateOrder(row)">保存排序</Button>
        <Button size="small" type="text" danger @click="() => handleDelete(row)">删除</Button>
      </template>
    </Grid>

    <Modal
      :open="modalOpen"
      :title="editingId ? '编辑热门景点' : '添加热门景点'"
      :confirm-loading="submitting"
      ok-text="保存"
      cancel-text="取消"
      @cancel="() => (modalOpen = false)"
      @ok="submitForm"
      destroy-on-close
    >
      <Form ref="formRef" :model="formModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 16 }">
        <Form.Item label="景点" name="sceneSpotId" :rules="[{ required: true, message: '请选择景点' }]">
          <Select v-model:value="formModel.sceneSpotId" :options="sceneOptions" :loading="sceneOptionsLoading" show-search :filter-option="false" @search="handleSceneSearch" :disabled="!!editingId" />
        </Form.Item>
        <Form.Item label="排序" name="order">
          <InputNumber v-model:value="formModel.order" :min="0" style="width:100%" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>

<style scoped>
.p-5 { padding: 20px; }
</style>
