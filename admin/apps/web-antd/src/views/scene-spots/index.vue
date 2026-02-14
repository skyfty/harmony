<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import type {
  SceneItem,
  SceneSpotCreatePayload,
  SceneSpotItem,
  SceneSpotUpdatePayload,
} from '#/api';

import { computed, onMounted, reactive, ref } from 'vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createSceneSpotApi,
  deleteSceneSpotApi,
  getSceneSpotApi,
  listSceneSpotsApi,
  listScenesApi,
  updateSceneSpotApi,
} from '#/api';
import { $t } from '#/locales';

import { Button, Form, Input, InputNumber, message, Modal, Select, Space } from 'ant-design-vue';

interface SceneSpotFormModel {
  sceneId: string;
  title: string;
  coverImage: string;
  slides: string;
  description: string;
  address: string;
  order: number;
}

const { TextArea } = Input;
const t = (key: string, args?: Record<string, unknown>) => $t(key as never, args as never);

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<null | string>(null);
const sceneSpotFormRef = ref<FormInstance>();

const sceneOptions = ref<Array<{ label: string; value: string }>>([]);

const sceneSpotFormModel = reactive<SceneSpotFormModel>({
  sceneId: '',
  title: '',
  coverImage: '',
  slides: '',
  description: '',
  address: '',
  order: 0,
});

const modalTitle = computed(() =>
  editingId.value ? t('page.sceneSpots.index.modal.edit') : t('page.sceneSpots.index.modal.create'),
);

function resetForm() {
  sceneSpotFormModel.sceneId = '';
  sceneSpotFormModel.title = '';
  sceneSpotFormModel.coverImage = '';
  sceneSpotFormModel.slides = '';
  sceneSpotFormModel.description = '';
  sceneSpotFormModel.address = '';
  sceneSpotFormModel.order = 0;
}

async function loadSceneOptions() {
  const response = await listScenesApi({
    page: 1,
    pageSize: 200,
  });
  sceneOptions.value = (response.items || []).map((item: SceneItem) => ({
    label: item.name,
    value: item.id,
  }));
}

function openCreateModal() {
  editingId.value = null;
  resetForm();
  modalOpen.value = true;
}

async function openEditModal(row: SceneSpotItem) {
  editingId.value = row.id;
  const data = await getSceneSpotApi(row.id);
  sceneSpotFormModel.sceneId = data.sceneId || '';
  sceneSpotFormModel.title = data.title || '';
  sceneSpotFormModel.coverImage = data.coverImage ?? '';
  sceneSpotFormModel.slides = Array.isArray(data.slides) ? data.slides.join('\n') : '';
  sceneSpotFormModel.description = data.description ?? '';
  sceneSpotFormModel.address = data.address ?? '';
  sceneSpotFormModel.order = data.order ?? 0;
  modalOpen.value = true;
}

async function submitSceneSpot() {
  const form = sceneSpotFormRef.value;
  if (!form) {
    return;
  }
  await form.validate();

  const slides = sceneSpotFormModel.slides
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

  const payload: SceneSpotCreatePayload | SceneSpotUpdatePayload = {
    sceneId: sceneSpotFormModel.sceneId,
    title: sceneSpotFormModel.title.trim(),
    coverImage: sceneSpotFormModel.coverImage.trim() || null,
    slides,
    description: sceneSpotFormModel.description.trim() || null,
    address: sceneSpotFormModel.address.trim() || null,
    order: Number(sceneSpotFormModel.order) || 0,
  };

  submitting.value = true;
  try {
    if (editingId.value) {
      await updateSceneSpotApi(editingId.value, payload);
      message.success(t('page.sceneSpots.index.message.updateSuccess'));
    } else {
      await createSceneSpotApi(payload as SceneSpotCreatePayload);
      message.success(t('page.sceneSpots.index.message.createSuccess'));
    }
    modalOpen.value = false;
    sceneSpotGridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: SceneSpotItem) {
  Modal.confirm({
    title: t('page.sceneSpots.index.confirm.delete.title', { name: row.title }),
    content: t('page.sceneSpots.index.confirm.delete.content'),
    okType: 'danger',
    onOk: async () => {
      await deleteSceneSpotApi(row.id);
      message.success(t('page.sceneSpots.index.message.deleteSuccess'));
      sceneSpotGridApi.reload();
    },
  });
}

const [SceneSpotGrid, sceneSpotGridApi] = useVbenVxeGrid<SceneSpotItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: t('page.sceneSpots.index.form.keyword.label'),
        componentProps: {
          allowClear: true,
          placeholder: t('page.sceneSpots.index.form.keyword.placeholder'),
        },
      },
      {
        component: 'Select',
        fieldName: 'sceneId',
        label: t('page.sceneSpots.index.form.sceneId.label'),
        componentProps: {
          allowClear: true,
          placeholder: t('page.sceneSpots.index.form.sceneId.placeholder'),
          options: sceneOptions,
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'title', minWidth: 180, title: t('page.sceneSpots.index.table.titleCol') },
      { field: 'sceneId', minWidth: 220, title: t('page.sceneSpots.index.table.sceneId') },
      { field: 'address', minWidth: 220, title: t('page.sceneSpots.index.table.address') },
      { field: 'order', minWidth: 100, title: t('page.sceneSpots.index.table.order') },
      { field: 'updatedAt', minWidth: 180, formatter: 'formatDateTime', title: t('page.sceneSpots.index.table.updatedAt') },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 160,
        slots: { default: 'actions' },
        title: t('page.sceneSpots.index.table.actions'),
      },
    ],
    pagerConfig: {
      pageSize: 20,
    },
    proxyConfig: {
      ajax: {
        query: async (
          { page }: { page: { currentPage: number; pageSize: number } },
          formValues: Record<string, any>,
        ) => {
          return await listSceneSpotsApi({
            keyword: formValues.keyword || undefined,
            sceneId: formValues.sceneId || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
          });
        },
      },
    },
    sortConfig: {
      defaultSort: { field: 'order', order: 'asc' },
      remote: false,
    },
    toolbarConfig: {
      custom: true,
      refresh: true,
      search: true,
      zoom: true,
    },
  },
  tableTitle: t('page.sceneSpots.index.table.tableTitle'),
});

onMounted(async () => {
  try {
    await loadSceneOptions();
  } catch {
    message.error(t('page.sceneSpots.index.message.loadScenesFailed'));
  }
});
</script>

<template>
  <div class="p-5">
    <SceneSpotGrid>
      <template #toolbar-actions>
        <Button v-access:code="'sceneSpot:write'" type="primary" @click="openCreateModal">
          {{ t('page.sceneSpots.index.toolbar.create') }}
        </Button>
      </template>

      <template #actions="{ row }">
        <Space>
          <Button v-access:code="'sceneSpot:write'" size="small" type="link" @click="openEditModal(row)">
            {{ t('page.sceneSpots.index.actions.edit') }}
          </Button>
          <Button v-access:code="'sceneSpot:write'" danger size="small" type="link" @click="handleDelete(row)">
            {{ t('page.sceneSpots.index.actions.delete') }}
          </Button>
        </Space>
      </template>
    </SceneSpotGrid>

    <Modal
      :open="modalOpen"
      :confirm-loading="submitting"
      :title="modalTitle"
      :ok-text="t('page.sceneSpots.index.modal.ok')"
      :cancel-text="t('page.sceneSpots.index.modal.cancel')"
      destroy-on-close
      @cancel="() => (modalOpen = false)"
      @ok="submitSceneSpot"
    >
      <Form ref="sceneSpotFormRef" :label-col="{ span: 6 }" :model="sceneSpotFormModel" :wrapper-col="{ span: 17 }">
        <Form.Item :label="t('page.sceneSpots.index.formFields.sceneId.label')" name="sceneId" :rules="[{ required: true, message: t('page.sceneSpots.index.formFields.sceneId.required') }]">
          <Select
            v-model:value="sceneSpotFormModel.sceneId"
            :options="sceneOptions"
            show-search
            option-filter-prop="label"
            :placeholder="t('page.sceneSpots.index.formFields.sceneId.placeholder')"
          />
        </Form.Item>
        <Form.Item :label="t('page.sceneSpots.index.formFields.title.label')" name="title" :rules="[{ required: true, message: t('page.sceneSpots.index.formFields.title.required') }]">
          <Input v-model:value="sceneSpotFormModel.title" allow-clear />
        </Form.Item>
        <Form.Item :label="t('page.sceneSpots.index.formFields.coverImage.label')" name="coverImage">
          <Input v-model:value="sceneSpotFormModel.coverImage" allow-clear />
        </Form.Item>
        <Form.Item :label="t('page.sceneSpots.index.formFields.slides.label')" name="slides">
          <TextArea v-model:value="sceneSpotFormModel.slides" :rows="3" :placeholder="t('page.sceneSpots.index.formFields.slides.placeholder')" />
        </Form.Item>
        <Form.Item :label="t('page.sceneSpots.index.formFields.description.label')" name="description">
          <TextArea v-model:value="sceneSpotFormModel.description" :rows="3" />
        </Form.Item>
        <Form.Item :label="t('page.sceneSpots.index.formFields.address.label')" name="address">
          <Input v-model:value="sceneSpotFormModel.address" allow-clear />
        </Form.Item>
        <Form.Item :label="t('page.sceneSpots.index.formFields.order.label')" name="order">
          <InputNumber v-model:value="sceneSpotFormModel.order" :min="0" style="width: 100%" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
