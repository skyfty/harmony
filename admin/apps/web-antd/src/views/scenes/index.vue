<script setup lang="ts">
import type { FormInstance, UploadFile, UploadProps } from 'ant-design-vue';
import type { Rule } from 'ant-design-vue/es/form';
import type { SceneCreatePayload, SceneItem, SceneUpdatePayload } from '#/api';

import { computed, reactive, ref } from 'vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { createSceneApi, deleteSceneApi, listScenesApi, updateSceneApi } from '#/api';
import { $t } from '#/locales';

import { Button, Form, Input, message, Modal, Space, Upload } from 'ant-design-vue';

interface SceneFormModel {
  fileList: UploadFile[];
  name: string;
}

const t = (key: string, args?: Record<string, unknown>) => $t(key as never, args as never);

const sceneFormRef = ref<FormInstance>();
const sceneModalOpen = ref(false);
const sceneSubmitting = ref(false);
const editingSceneId = ref<null | string>(null);

const sceneFormModel = reactive<SceneFormModel>({
  fileList: [],
  name: '',
});

const sceneModalTitle = computed(() =>
  editingSceneId.value ? t('page.scenes.index.modal.edit') : t('page.scenes.index.modal.create'),
);

const sceneRules = computed(
  () =>
    ({
      name: [
        {
          message: t('page.scenes.index.formFields.name.required'),
          required: true,
          trigger: 'blur',
        },
      ] as Rule[],
    }) as Record<string, Rule[]>,
);

const sceneUploadProps: UploadProps = {
  beforeUpload: () => false,
  maxCount: 1,
};

function resetSceneForm() {
  sceneFormModel.name = '';
  sceneFormModel.fileList = [];
}

function openCreateSceneModal() {
  editingSceneId.value = null;
  resetSceneForm();
  sceneModalOpen.value = true;
}

function openEditSceneModal(record: SceneItem) {
  editingSceneId.value = record.id;
  sceneFormModel.name = record.name || '';
  sceneFormModel.fileList = [];
  sceneModalOpen.value = true;
}

function closeSceneModal() {
  sceneModalOpen.value = false;
}

function currentUploadFile(): Blob | File | null {
  const first = sceneFormModel.fileList[0];
  if (!first) {
    return null;
  }
  const origin = first.originFileObj;
  return origin || null;
}

async function submitScene() {
  const form = sceneFormRef.value;
  if (!form) {
    return;
  }
  await form.validate();

  const uploadFile = currentUploadFile();
  if (!editingSceneId.value && !uploadFile) {
    message.error(t('page.scenes.index.formFields.file.required'));
    return;
  }

  sceneSubmitting.value = true;
  try {
    const basePayload = {
      name: sceneFormModel.name.trim(),
    };

    if (editingSceneId.value) {
      const payload: SceneUpdatePayload = {
        ...basePayload,
        file: uploadFile,
      };
      await updateSceneApi(editingSceneId.value, payload);
      message.success(t('page.scenes.index.message.updateSuccess'));
    } else {
      const payload: SceneCreatePayload = {
        ...basePayload,
        file: uploadFile,
      };
      await createSceneApi(payload);
      message.success(t('page.scenes.index.message.createSuccess'));
    }

    sceneModalOpen.value = false;
    sceneGridApi.reload();
  } finally {
    sceneSubmitting.value = false;
  }
}

function handleDeleteScene(row: SceneItem) {
  Modal.confirm({
    title: t('page.scenes.index.confirm.delete.title', { name: row.name }),
    content: t('page.scenes.index.confirm.delete.content'),
    okType: 'danger',
    onOk: async () => {
      await deleteSceneApi(row.id);
      message.success(t('page.scenes.index.message.deleteSuccess'));
      sceneGridApi.reload();
    },
  });
}

const [SceneGrid, sceneGridApi] = useVbenVxeGrid<SceneItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: t('page.scenes.index.form.keyword.label'),
        componentProps: {
          allowClear: true,
          placeholder: t('page.scenes.index.form.keyword.placeholder'),
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 180, title: t('page.scenes.index.table.name') },
      { field: 'fileUrl', minWidth: 280, title: t('page.scenes.index.table.fileUrl'), slots: { default: 'fileUrl' } },
      { field: 'fileSize', minWidth: 120, title: t('page.scenes.index.table.fileSize') },
      {
        field: 'updatedAt',
        minWidth: 180,
        sortable: true,
        formatter: 'formatDateTime',
        title: t('page.scenes.index.table.updatedAt'),
      },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 180,
        slots: { default: 'actions' },
        title: t('page.scenes.index.table.actions'),
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
          return await listScenesApi({
            keyword: formValues.keyword || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
          });
        },
      },
    },
    sortConfig: {
      defaultSort: { field: 'updatedAt', order: 'desc' },
      remote: false,
    },
    toolbarConfig: {
      custom: true,
      refresh: true,
      search: true,
      zoom: true,
    },
  },
  tableTitle: t('page.scenes.index.table.title'),
});
</script>

<template>
  <div class="p-5">
    <SceneGrid>
      <template #toolbar-actions>
        <Button v-access:code="'scene:write'" type="primary" @click="openCreateSceneModal">
          {{ t('page.scenes.index.toolbar.create') }}
        </Button>
      </template>

      <template #fileUrl="{ row }">
        <a v-if="row.fileUrl" :href="row.fileUrl" target="_blank" rel="noopener noreferrer">{{ row.fileUrl }}</a>
        <span v-else class="text-text-secondary">-</span>
      </template>

      <template #actions="{ row }">
        <Space>
          <Button v-access:code="'scene:write'" size="small" type="link" @click="openEditSceneModal(row)">
            {{ t('page.scenes.index.actions.edit') }}
          </Button>
          <Button v-access:code="'scene:write'" danger size="small" type="link" @click="handleDeleteScene(row)">
            {{ t('page.scenes.index.actions.delete') }}
          </Button>
        </Space>
      </template>
    </SceneGrid>

    <Modal
      :open="sceneModalOpen"
      :title="sceneModalTitle"
      :confirm-loading="sceneSubmitting"
      :ok-text="t('page.scenes.index.modal.ok')"
      :cancel-text="t('page.scenes.index.modal.cancel')"
      destroy-on-close
      @cancel="closeSceneModal"
      @ok="submitScene"
    >
      <Form ref="sceneFormRef" :model="sceneFormModel" :rules="sceneRules" :label-col="{ span: 6 }" :wrapper-col="{ span: 17 }">
        <Form.Item :label="t('page.scenes.index.formFields.name.label')" name="name">
          <Input v-model:value="sceneFormModel.name" allow-clear />
        </Form.Item>
        <Form.Item :label="t('page.scenes.index.formFields.file.label')" name="file">
          <Upload v-model:file-list="sceneFormModel.fileList" v-bind="sceneUploadProps">
            <Button>{{ t('page.scenes.index.formFields.file.button') }}</Button>
          </Upload>
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
