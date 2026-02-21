<script setup lang="ts">
import type { FormInstance, UploadChangeParam, UploadFile, UploadProps } from 'ant-design-vue';

import { computed, onMounted, reactive, ref } from 'vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  buildResourceDownloadUrl,
  createResourceAssetApi,
  deleteResourceAssetApi,
  getResourceAssetApi,
  listResourceAssetsApi,
  listResourceCategoriesApi,
  listResourceSeriesApi,
  listResourceTagsApi,
  updateResourceAssetApi,
  type ResourceAssetItem,
  type ResourceCategoryItem,
  type ResourceSeriesItem,
  type ResourceTagItem,
} from '#/api';

import { Button, Form, Image, Input, InputNumber, message, Modal, Select, Space, Upload } from 'ant-design-vue';

interface AssetFormModel {
  categoryId: string;
  color: string;
  description: string;
  dimensionHeight?: number;
  dimensionLength?: number;
  dimensionWidth?: number;
  imageHeight?: number;
  imageWidth?: number;
  metadata: string;
  name: string;
  seriesId?: string;
  tagIds: string[];
  terrainScatterPreset: string;
  type: string;
}

const { TextArea } = Input;

const typeOptions = [
  { label: '模型', value: 'model' },
  { label: '网格', value: 'mesh' },
  { label: '图片', value: 'image' },
  { label: '纹理', value: 'texture' },
  { label: '材质', value: 'material' },
  { label: '预制体', value: 'prefab' },
  { label: '视频', value: 'video' },
  { label: '文件', value: 'file' },
];

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<null | string>(null);
const assetFormRef = ref<FormInstance>();
const assetFileList = ref<UploadFile[]>([]);
const thumbnailFileList = ref<UploadFile[]>([]);
const categories = ref<ResourceCategoryItem[]>([]);
const tags = ref<ResourceTagItem[]>([]);
const series = ref<ResourceSeriesItem[]>([]);
const brokenThumbnailUrls = ref<Set<string>>(new Set());
const previewVisible = ref(false);
const previewImage = ref('');
const previewTitle = ref('');

const categoryOptions = computed(() => {
  const output: Array<{ label: string; value: string }> = [];
  function walk(nodes: ResourceCategoryItem[], prefix = '') {
    nodes.forEach((node) => {
      const label = prefix ? `${prefix} / ${node.name}` : node.name;
      output.push({ label, value: node.id });
      if (Array.isArray(node.children) && node.children.length) {
        walk(node.children, label);
      }
    });
  }
  walk(categories.value);
  return output;
});

const tagOptions = computed(() => tags.value.map((item) => ({ label: item.name, value: item.id })));
const seriesOptions = computed(() => series.value.map((item) => ({ label: item.name, value: item.id })));

const filterCategoryOptions = computed(() => [{ label: '全部', value: '' }, ...categoryOptions.value]);
const filterSeriesOptions = computed(() => [{ label: '全部', value: '' }, ...seriesOptions.value]);
const filterTagOptions = computed(() => [{ label: '全部', value: '' }, ...tagOptions.value]);

const modalTitle = computed(() => (editingId.value ? '编辑资产' : '新增资产'));

const assetUploadProps: UploadProps = {
  beforeUpload: () => false,
  maxCount: 1,
};

const thumbUploadProps: UploadProps = {
  beforeUpload: () => false,
  maxCount: 1,
  accept: 'image/*',
};

const assetFormModel = reactive<AssetFormModel>({
  categoryId: '',
  color: '',
  description: '',
  dimensionHeight: undefined,
  dimensionLength: undefined,
  dimensionWidth: undefined,
  imageHeight: undefined,
  imageWidth: undefined,
  metadata: '',
  name: '',
  seriesId: undefined,
  tagIds: [],
  terrainScatterPreset: '',
  type: 'file',
});

function resetForm() {
  assetFormModel.name = '';
  assetFormModel.type = 'file';
  assetFormModel.categoryId = '';
  assetFormModel.tagIds = [];
  assetFormModel.seriesId = undefined;
  assetFormModel.description = '';
  assetFormModel.color = '';
  assetFormModel.dimensionLength = undefined;
  assetFormModel.dimensionWidth = undefined;
  assetFormModel.dimensionHeight = undefined;
  assetFormModel.imageWidth = undefined;
  assetFormModel.imageHeight = undefined;
  assetFormModel.terrainScatterPreset = '';
  assetFormModel.metadata = '';
  assetFileList.value = [];
  thumbnailFileList.value = [];
}

function mapDoneFile(url: null | string, name: string): UploadFile[] {
  if (!url) {
    return [];
  }
  return [
    {
      uid: `${name}-${Date.now()}`,
      name,
      status: 'done',
      url,
    },
  ];
}

async function loadLookups() {
  const [categoryList, tagList, seriesList] = await Promise.all([
    listResourceCategoriesApi(),
    listResourceTagsApi(),
    listResourceSeriesApi(),
  ]);
  categories.value = categoryList || [];
  tags.value = tagList || [];
  series.value = seriesList || [];
}

function openCreateModal() {
  editingId.value = null;
  resetForm();
  modalOpen.value = true;
}

async function openEditModal(row: ResourceAssetItem) {
  const detail = await getResourceAssetApi(row.id);
  editingId.value = detail.id;
  assetFormModel.name = detail.name || '';
  assetFormModel.type = detail.type || 'file';
  assetFormModel.categoryId = detail.categoryId || '';
  assetFormModel.tagIds = detail.tagIds || [];
  assetFormModel.seriesId = detail.seriesId || undefined;
  assetFormModel.description = detail.description || '';
  assetFormModel.color = detail.color || '';
  assetFormModel.dimensionLength = detail.dimensionLength ?? undefined;
  assetFormModel.dimensionWidth = detail.dimensionWidth ?? undefined;
  assetFormModel.dimensionHeight = detail.dimensionHeight ?? undefined;
  assetFormModel.imageWidth = detail.imageWidth ?? undefined;
  assetFormModel.imageHeight = detail.imageHeight ?? undefined;
  assetFormModel.terrainScatterPreset = detail.terrainScatterPreset || '';
  assetFormModel.metadata = '';

  assetFileList.value = mapDoneFile(detail.url || null, detail.originalFilename || detail.name || 'asset-file');
  thumbnailFileList.value = mapDoneFile(detail.thumbnailUrl || detail.previewUrl || null, 'thumbnail');
  modalOpen.value = true;
}

function handleAssetFileChange(info: UploadChangeParam<UploadFile<any>>) {
  assetFileList.value = info.fileList.slice(-1);
}

function handleThumbFileChange(info: UploadChangeParam<UploadFile<any>>) {
  thumbnailFileList.value = info.fileList.slice(-1);
}

function getUploadFileUrl(file?: UploadFile) {
  if (!file) {
    return '';
  }
  return ((file.response as any)?.url || file.url || '') as string;
}

async function handleThumbPreview(file: UploadFile) {
  if (!file.url && !file.preview && file.originFileObj) {
    file.preview = URL.createObjectURL(file.originFileObj as File);
  }
  previewImage.value = getUploadFileUrl(file) || String(file.preview || '');
  previewVisible.value = true;
  previewTitle.value = file.name || 'thumbnail';
}

function appendOptionalString(payload: FormData, key: string, value: string) {
  payload.append(key, value.trim());
}

async function submitAsset() {
  const form = assetFormRef.value;
  if (!form) {
    return;
  }
  await form.validate();

  if (!editingId.value) {
    const file = assetFileList.value[0]?.originFileObj;
    if (!file) {
      message.error('请上传资产文件');
      return;
    }
  }

  if (assetFormModel.metadata.trim().length) {
    try {
      const parsed = JSON.parse(assetFormModel.metadata);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        message.error('metadata 必须是 JSON 对象');
        return;
      }
    } catch {
      message.error('metadata 不是合法 JSON');
      return;
    }
  }

  const payload = new FormData();
  payload.append('name', assetFormModel.name.trim());
  payload.append('type', assetFormModel.type);
  payload.append('categoryId', assetFormModel.categoryId);
  payload.append('description', assetFormModel.description.trim());

  payload.append('tagIds', JSON.stringify(assetFormModel.tagIds || []));
  payload.append('seriesId', assetFormModel.seriesId || 'none');
  appendOptionalString(payload, 'color', assetFormModel.color);
  payload.append('dimensionLength', String(assetFormModel.dimensionLength ?? ''));
  payload.append('dimensionWidth', String(assetFormModel.dimensionWidth ?? ''));
  payload.append('dimensionHeight', String(assetFormModel.dimensionHeight ?? ''));
  payload.append('imageWidth', String(assetFormModel.imageWidth ?? ''));
  payload.append('imageHeight', String(assetFormModel.imageHeight ?? ''));
  appendOptionalString(payload, 'terrainScatterPreset', assetFormModel.terrainScatterPreset);
  appendOptionalString(payload, 'metadata', assetFormModel.metadata);

  const uploadFile = assetFileList.value[0]?.originFileObj;
  if (uploadFile) {
    payload.append('file', uploadFile as File);
  }
  const thumbFile = thumbnailFileList.value[0]?.originFileObj;
  if (thumbFile) {
    payload.append('thumbnail', thumbFile as File);
  }

  submitting.value = true;
  try {
    if (editingId.value) {
      await updateResourceAssetApi(editingId.value, payload);
      message.success('资产更新成功');
    } else {
      await createResourceAssetApi(payload);
      message.success('资产创建成功');
    }
    modalOpen.value = false;
    await loadLookups();
    assetGridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: ResourceAssetItem) {
  Modal.confirm({
    title: `确认删除资产 “${row.name}” 吗？`,
    content: '删除后不可恢复。',
    okType: 'danger',
    onOk: async () => {
      await deleteResourceAssetApi(row.id);
      message.success('资产已删除');
      assetGridApi.reload();
    },
  });
}

function handleDownload(id: string) {
  window.open(buildResourceDownloadUrl(id), '_blank');
}

function getThumbnailUrl(row: ResourceAssetItem) {
  return row.thumbnailUrl || row.previewUrl || row.url || '';
}

function isThumbnailAvailable(row: ResourceAssetItem) {
  const url = getThumbnailUrl(row);
  return !!url && !brokenThumbnailUrls.value.has(url);
}

function handleThumbnailError(row: ResourceAssetItem) {
  const url = getThumbnailUrl(row);
  if (!url || brokenThumbnailUrls.value.has(url)) {
    return;
  }
  const next = new Set(brokenThumbnailUrls.value);
  next.add(url);
  brokenThumbnailUrls.value = next;
}

const [AssetGrid, assetGridApi] = useVbenVxeGrid<ResourceAssetItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键字',
        componentProps: { allowClear: true, placeholder: '资产名称' },
      },
      {
        component: 'Select',
        fieldName: 'type',
        label: '类型',
        componentProps: {
          allowClear: true,
          options: typeOptions,
          placeholder: '全部类型',
        },
      },
      {
        component: 'Select',
        fieldName: 'categoryId',
        label: '分类',
        componentProps: {
          allowClear: true,
          options: filterCategoryOptions,
          placeholder: '全部分类',
        },
      },
      {
        component: 'Select',
        fieldName: 'seriesId',
        label: '系列',
        componentProps: {
          allowClear: true,
          options: filterSeriesOptions,
          placeholder: '全部系列',
        },
      },
      {
        component: 'Select',
        fieldName: 'tagId',
        label: '标签',
        componentProps: {
          allowClear: true,
          options: filterTagOptions,
          placeholder: '全部标签',
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      {
        field: 'thumbnailUrl',
        minWidth: 96,
        slots: { default: 'thumbnail' },
        title: '缩略图',
      },
      { field: 'name', minWidth: 180, title: '名称' },
      { field: 'type', minWidth: 100, title: '类型' },
      { field: 'categoryPathString', minWidth: 220, title: '分类路径' },
      { field: 'seriesName', minWidth: 140, title: '系列' },
      { field: 'size', minWidth: 120, title: '大小(B)' },
      { field: 'createdAt', minWidth: 170, formatter: 'formatDateTime', title: '创建时间' },
      { field: 'updatedAt', minWidth: 170, formatter: 'formatDateTime', title: '更新时间' },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 240,
        slots: { default: 'actions' },
        title: '操作',
      },
    ],
    pagerConfig: {
      pageSize: 20,
    },
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, formValues: Record<string, any>) => {
          return await listResourceAssetsApi({
            categoryId: formValues.categoryId || undefined,
            includeDescendants: true,
            keyword: formValues.keyword || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
            seriesId: formValues.seriesId || undefined,
            tagIds: formValues.tagId ? [formValues.tagId] : undefined,
            types: formValues.type ? [formValues.type] : undefined,
          });
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
  tableTitle: '资产管理',
});

onMounted(async () => {
  await loadLookups();
});
</script>

<template>
  <div class="p-5">
    <AssetGrid>
      <template #toolbar-actions>
        <Button v-access:code="'resource:write'" type="primary" @click="openCreateModal">新增资产</Button>
      </template>

      <template #thumbnail="{ row }">
        <Image
          v-if="isThumbnailAvailable(row)"
          :src="getThumbnailUrl(row)"
          :width="52"
          :height="52"
          style="object-fit: cover; border-radius: 4px"
          @error="() => handleThumbnailError(row)"
        />
        <span v-else>-</span>
      </template>

      <template #actions="{ row }">
        <Space>
          <Button type="link" size="small" @click="handleDownload(row.id)">下载</Button>
          <Button v-access:code="'resource:write'" type="link" size="small" @click="openEditModal(row)">编辑</Button>
          <Button v-access:code="'resource:write'" danger type="link" size="small" @click="handleDelete(row)">删除</Button>
        </Space>
      </template>
    </AssetGrid>

    <Modal
      :open="modalOpen"
      :title="modalTitle"
      :confirm-loading="submitting"
      :width="920"
      ok-text="保存"
      cancel-text="取消"
      destroy-on-close
      @cancel="() => (modalOpen = false)"
      @ok="submitAsset"
    >
      <Form ref="assetFormRef" :model="assetFormModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 17 }">
        <Form.Item label="名称" name="name" :rules="[{ required: true, message: '请输入名称' }]">
          <Input v-model:value="assetFormModel.name" allow-clear placeholder="资产名称" />
        </Form.Item>
        <Form.Item label="类型" name="type" :rules="[{ required: true, message: '请选择类型' }]">
          <Select v-model:value="assetFormModel.type" :options="typeOptions" />
        </Form.Item>
        <Form.Item label="分类" name="categoryId" :rules="[{ required: true, message: '请选择分类' }]">
          <Select
            v-model:value="assetFormModel.categoryId"
            show-search
            option-filter-prop="label"
            :options="categoryOptions"
            placeholder="选择分类"
          />
        </Form.Item>
        <Form.Item label="标签" name="tagIds">
          <Select
            v-model:value="assetFormModel.tagIds"
            mode="multiple"
            allow-clear
            show-search
            option-filter-prop="label"
            :options="tagOptions"
            placeholder="选择标签"
          />
        </Form.Item>
        <Form.Item label="系列" name="seriesId">
          <Select
            v-model:value="assetFormModel.seriesId"
            allow-clear
            show-search
            option-filter-prop="label"
            :options="seriesOptions"
            placeholder="选择系列（可选）"
          />
        </Form.Item>
        <Form.Item label="资产文件" name="file" :rules="editingId ? [] : [{ required: true, message: '请上传资产文件' }]">
          <Upload v-model:file-list="assetFileList" v-bind="assetUploadProps" @change="handleAssetFileChange">
            <Button>选择文件</Button>
          </Upload>
        </Form.Item>
        <Form.Item label="缩略图" name="thumbnail">
          <Upload
            v-model:file-list="thumbnailFileList"
            v-bind="thumbUploadProps"
            list-type="picture-card"
            @change="handleThumbFileChange"
            @preview="handleThumbPreview"
          >
            <div v-if="thumbnailFileList.length < 1">+ Upload</div>
          </Upload>
        </Form.Item>
        <Form.Item label="颜色" name="color">
          <Input v-model:value="assetFormModel.color" allow-clear placeholder="#RRGGBB" />
        </Form.Item>
        <Form.Item label="尺寸(长/宽/高)">
          <Space.Compact style="width: 100%">
            <InputNumber v-model:value="assetFormModel.dimensionLength" :min="0" style="width: 33.33%" placeholder="长" />
            <InputNumber v-model:value="assetFormModel.dimensionWidth" :min="0" style="width: 33.33%" placeholder="宽" />
            <InputNumber v-model:value="assetFormModel.dimensionHeight" :min="0" style="width: 33.34%" placeholder="高" />
          </Space.Compact>
        </Form.Item>
        <Form.Item label="图片尺寸(宽/高)">
          <Space.Compact style="width: 100%">
            <InputNumber v-model:value="assetFormModel.imageWidth" :min="0" style="width: 50%" placeholder="像素宽" />
            <InputNumber v-model:value="assetFormModel.imageHeight" :min="0" style="width: 50%" placeholder="像素高" />
          </Space.Compact>
        </Form.Item>
        <Form.Item label="散布预设" name="terrainScatterPreset">
          <Input v-model:value="assetFormModel.terrainScatterPreset" allow-clear placeholder="terrainScatterPreset（可选）" />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <TextArea v-model:value="assetFormModel.description" :rows="3" />
        </Form.Item>
        <Form.Item label="Metadata(JSON对象)" name="metadata">
          <TextArea v-model:value="assetFormModel.metadata" :rows="4" placeholder='例如：{"key":"value"}' />
        </Form.Item>
      </Form>
    </Modal>

    <Modal :open="previewVisible" :title="previewTitle" :footer="null" @cancel="previewVisible = false">
      <img alt="preview" style="width: 100%" :src="previewImage" />
    </Modal>
  </div>
</template>
