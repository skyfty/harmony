<script setup lang="ts">
import type { FormInstance, UploadChangeParam, UploadFile, UploadProps } from 'ant-design-vue';
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

import { Button, Form, Input, InputNumber, message, Modal, Select, Space, Switch, Upload } from 'ant-design-vue';

interface SceneSpotFormModel {
  sceneId: string;
  title: string;
  description: string;
  address: string;
  order: number;
  isFeatured: boolean;
}

const { TextArea } = Input;
const t = (key: string, args?: Record<string, unknown>) => $t(key as never, args as never);

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<null | string>(null);
const sceneSpotFormRef = ref<FormInstance>();

const coverImageFileList = ref<UploadFile[]>([]);
const slidesFileList = ref<UploadFile[]>([]);
const previewVisible = ref(false);
const previewImage = ref('');
const previewTitle = ref('');

const sceneOptions = ref<Array<{ label: string; value: string }>>([]);
const sceneNameMap = ref<Record<string, string>>({});
const sceneOptionsLoading = ref(false);
const sceneSearchKeyword = ref('');
const sceneOptionsPage = ref(1);
const sceneOptionsPageSize = 20;
const sceneOptionsHasMore = ref(true);
let sceneSearchTimer: null | ReturnType<typeof setTimeout> = null;

const sceneSpotFormModel = reactive<SceneSpotFormModel>({
  sceneId: '',
  title: '',
  description: '',
  address: '',
  order: 0,
  isFeatured: false,
});

const featuredLoading = reactive<Record<string, boolean>>({});
const featuredError = reactive<Record<string, boolean>>({});

const modalTitle = computed(() =>
  editingId.value ? t('page.sceneSpots.index.modal.edit') : t('page.sceneSpots.index.modal.create'),
);

const uploadProps: UploadProps = {
  accept: 'image/*',
  beforeUpload: () => false,
};

function resetForm() {
  sceneSpotFormModel.sceneId = '';
  sceneSpotFormModel.title = '';
  sceneSpotFormModel.description = '';
  sceneSpotFormModel.address = '';
  sceneSpotFormModel.order = 0;
  sceneSpotFormModel.isFeatured = false;
  coverImageFileList.value = [];
  slidesFileList.value = [];
}

function generateUid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getFileUrl(file?: UploadFile): string {
  if (!file) {
    return '';
  }
  return ((file.response as any)?.url || file.url || '') as string;
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('read file failed'));
  });
}

async function normalizeFileList(fileList: UploadFile[]) {
  const normalized = await Promise.all(
    fileList.map(async (file) => {
      if (getFileUrl(file)) {
        return file;
      }
      if (file.originFileObj) {
        const url = await fileToDataUrl(file.originFileObj as File);
        return {
          ...file,
          status: 'done' as const,
          url,
        };
      }
      return file;
    }),
  );

  return normalized.filter((file) => !!getFileUrl(file));
}

async function handleCoverImageChange(info: UploadChangeParam<UploadFile<any>>) {
  coverImageFileList.value = (await normalizeFileList(info.fileList)).slice(-1);
}

async function handleSlidesChange(info: UploadChangeParam<UploadFile<any>>) {
  slidesFileList.value = await normalizeFileList(info.fileList);
}

async function handlePreview(file: UploadFile) {
  if (!file.url && !file.preview && file.originFileObj) {
    file.preview = await fileToDataUrl(file.originFileObj as File);
  }
  previewImage.value = getFileUrl(file) || String(file.preview || '');
  previewVisible.value = true;
  previewTitle.value = file.name || t('page.sceneSpots.index.formFields.coverImage.label');
}

function mergeSceneOptions(items: SceneItem[], reset: boolean) {
  const mapped = items.map((item) => ({ label: item.name, value: item.id }));
  if (reset) {
    sceneOptions.value = mapped;
  } else {
    const existing = new Set(sceneOptions.value.map((option) => option.value));
    sceneOptions.value = [...sceneOptions.value, ...mapped.filter((option) => !existing.has(option.value))];
  }

  items.forEach((item) => {
    sceneNameMap.value[item.id] = item.name;
  });
}

async function loadSceneOptions(reset = true) {
  if (sceneOptionsLoading.value) {
    return;
  }
  if (!reset && !sceneOptionsHasMore.value) {
    return;
  }

  sceneOptionsLoading.value = true;
  try {
    const nextPage = reset ? 1 : sceneOptionsPage.value + 1;
    const response = await listScenesApi({
      keyword: sceneSearchKeyword.value || undefined,
      page: nextPage,
      pageSize: sceneOptionsPageSize,
    });

    const items = response.items || [];
    mergeSceneOptions(items, reset);
    sceneOptionsPage.value = nextPage;
    sceneOptionsHasMore.value = sceneOptions.value.length < response.total;
  } finally {
    sceneOptionsLoading.value = false;
  }
}

function handleSceneSearch(keyword: string) {
  if (sceneSearchTimer) {
    clearTimeout(sceneSearchTimer);
  }

  sceneSearchTimer = setTimeout(() => {
    sceneSearchKeyword.value = keyword.trim();
    loadSceneOptions(true);
  }, 250);
}

function handleScenePopupScroll(event: Event) {
  const target = event.target as HTMLElement;
  if (!target) {
    return;
  }

  const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 12;
  if (nearBottom) {
    loadSceneOptions(false);
  }
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
  sceneSpotFormModel.description = data.description ?? '';
  sceneSpotFormModel.address = data.address ?? '';
  sceneSpotFormModel.order = data.order ?? 0;
  sceneSpotFormModel.isFeatured = data.isFeatured === true;

  coverImageFileList.value = data.coverImage
    ? [
        {
          uid: generateUid('cover'),
          name: 'cover-image',
          status: 'done',
          url: data.coverImage,
        },
      ]
    : [];

  slidesFileList.value = (data.slides || []).map((slideUrl, index) => ({
    uid: generateUid(`slide-${index}`),
    name: `slide-${index + 1}`,
    status: 'done',
    url: slideUrl,
  }));

  modalOpen.value = true;
}

async function submitSceneSpot() {
  const form = sceneSpotFormRef.value;
  if (!form) {
    return;
  }
  await form.validate();

  const coverImage = getFileUrl(coverImageFileList.value[0]) || null;
  const slides = slidesFileList.value.map((file) => getFileUrl(file)).filter(Boolean);

  const payload: SceneSpotCreatePayload | SceneSpotUpdatePayload = {
    sceneId: sceneSpotFormModel.sceneId,
    title: sceneSpotFormModel.title.trim(),
    coverImage,
    slides,
    description: sceneSpotFormModel.description.trim() || null,
    address: sceneSpotFormModel.address.trim() || null,
    order: Number(sceneSpotFormModel.order) || 0,
    isFeatured: sceneSpotFormModel.isFeatured,
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

async function toggleFeatured(row: SceneSpotItem, checked: unknown) {
  const flag = Boolean(checked === true || checked === 'true' || checked === 1 || checked === '1');
  const prev = row.isFeatured;
  // prevent duplicate
  if (featuredLoading[row.id]) return;
  featuredLoading[row.id] = true;
  // optimistic update
  row.isFeatured = flag;
  try {
    await updateSceneSpotApi(row.id, { isFeatured: flag });
    message.success(t('page.sceneSpots.index.message.updateSuccess'));
    sceneSpotGridApi.reload();
  } catch (err) {
    row.isFeatured = prev;
    featuredError[row.id] = true;
    // clear error highlight after short delay
    setTimeout(() => {
      featuredError[row.id] = false;
    }, 1400);
    message.error(t('page.sceneSpots.index.message.updateFailed') || '更新失败');
  } finally {
    featuredLoading[row.id] = false;
  }
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
          filterOption: false,
          loading: sceneOptionsLoading,
          onPopupScroll: handleScenePopupScroll,
          onSearch: handleSceneSearch,
          options: sceneOptions,
          placeholder: t('page.sceneSpots.index.form.sceneId.placeholder'),
          showSearch: true,
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'title', minWidth: 180, title: t('page.sceneSpots.index.table.titleCol') },
      { field: 'sceneId', minWidth: 220, title: t('page.sceneSpots.index.table.sceneId'), slots: { default: 'sceneName' } },
      { field: 'isFeatured', minWidth: 120, title: t('page.sceneSpots.index.table.isFeatured'), slots: { default: 'isFeatured' } },
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
    await loadSceneOptions(true);
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

      <template #sceneName="{ row }">
        {{ sceneNameMap[row.sceneId] || row.sceneId }}
      </template>

      <template #isFeatured="{ row }">
        <div :class="['featured-cell', { 'featured-error': featuredError[row.id] }]">
          <Switch :checked="row.isFeatured" :loading="featuredLoading[row.id]" @change="(checked) => toggleFeatured(row, checked)" />
        </div>
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
      :width="900"
      :confirm-loading="submitting"
      :title="modalTitle"
      :ok-text="t('page.sceneSpots.index.modal.ok')"
      :cancel-text="t('page.sceneSpots.index.modal.cancel')"
      destroy-on-close
      @cancel="() => { modalOpen = false; resetForm(); }"
      @ok="submitSceneSpot"
    >
      <Form ref="sceneSpotFormRef" :label-col="{ span: 6 }" :model="sceneSpotFormModel" :wrapper-col="{ span: 17 }">
        <Form.Item :label="t('page.sceneSpots.index.formFields.sceneId.label')" name="sceneId" :rules="[{ required: true, message: t('page.sceneSpots.index.formFields.sceneId.required') }]">
          <Select
            v-model:value="sceneSpotFormModel.sceneId"
            :filter-option="false"
            :loading="sceneOptionsLoading"
            :options="sceneOptions"
            @popupScroll="handleScenePopupScroll"
            @search="handleSceneSearch"
            show-search
            :placeholder="t('page.sceneSpots.index.formFields.sceneId.placeholder')"
          />
        </Form.Item>
        <Form.Item :label="t('page.sceneSpots.index.formFields.title.label')" name="title" :rules="[{ required: true, message: t('page.sceneSpots.index.formFields.title.required') }]">
          <Input v-model:value="sceneSpotFormModel.title" allow-clear />
        </Form.Item>
        <Form.Item :label="t('page.sceneSpots.index.formFields.coverImage.label')" name="coverImage">
          <Upload
            v-bind="uploadProps"
            :file-list="coverImageFileList"
            list-type="picture-card"
            @change="handleCoverImageChange"
            @preview="handlePreview"
          >
            <div v-if="coverImageFileList.length < 1">+ Upload</div>
          </Upload>
        </Form.Item>
        <Form.Item :label="t('page.sceneSpots.index.formFields.slides.label')" name="slides">
          <Upload
            v-bind="uploadProps"
            :file-list="slidesFileList"
            multiple
            list-type="picture-card"
            @change="handleSlidesChange"
            @preview="handlePreview"
          >
            <div>+ Upload</div>
          </Upload>
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
        <Form.Item :label="t('page.sceneSpots.index.formFields.isFeatured.label')" name="isFeatured">
          <Switch v-model:checked="sceneSpotFormModel.isFeatured" />
        </Form.Item>
      </Form>
    </Modal>

    <Modal :open="previewVisible" :title="previewTitle" :footer="null" @cancel="previewVisible = false">
      <img alt="preview" style="width: 100%" :src="previewImage" />
    </Modal>
  </div>
</template>

<style scoped>
.featured-cell {
  display: inline-block;
}
.featured-error {
  background-color: rgba(255, 77, 79, 0.06);
  border-left: 3px solid #ff4d4f;
  padding-left: 6px;
  border-radius: 4px;
  animation: featuredHighlight 1.2s ease;
}
@keyframes featuredHighlight {
  0% { box-shadow: 0 0 0 rgba(255,77,79,0.0); }
  40% { box-shadow: 0 0 10px rgba(255,77,79,0.28); }
  100% { box-shadow: none; }
}
</style>
