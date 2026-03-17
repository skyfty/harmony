<script setup lang="ts">
import type { FormInstance, UploadChangeParam, UploadFile, UploadProps } from 'ant-design-vue';
import type { TableProps } from 'ant-design-vue';

import { computed, onMounted, reactive, ref } from 'vue';

import {
  buildResourceDownloadUrl,
  bulkMoveResourceAssetsDirectoryApi,
  createResourceAssetApi,
  createResourceDirectoryApi,
  deleteResourceAssetApi,
  deleteResourceDirectoryApi,
  getResourceAssetApi,
  listResourceCategoriesApi,
  listResourceDirectoriesApi,
  listResourceDirectoryEntriesApi,
  listResourceSeriesApi,
  listResourceTagsApi,
  moveResourceDirectoryApi,
  updateResourceAssetApi,
  updateResourceDirectoryApi,
  type ResourceAssetItem,
  type ResourceCategoryItem,
  type ResourceDirectoryEntry,
  type ResourceDirectoryEntryDirectory,
  type ResourceDirectoryItem,
  type ResourceSeriesItem,
  type ResourceTagItem,
} from '#/api';

import { Button, Form, Image, Input, InputNumber, message, Modal, Select, Space, Table, Upload, Tooltip, Tag } from 'ant-design-vue';
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  PlusOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons-vue';

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
const directoryItems = ref<ResourceDirectoryItem[]>([]);
const currentDirectoryId = ref('');
const currentDirectoryPath = ref<Array<{ id: string; name: string }>>([]);
const mixedItems = ref<ResourceDirectoryEntry[]>([]);
const loadingEntries = ref(false);
const keyword = ref('');
const selectedAssetIds = ref<string[]>([]);
const movingAssets = ref(false);
const movingAssetIds = ref<string[]>([]);
const movingDirectoryId = ref<null | string>(null);
const moveModalOpen = ref(false);
const moveTargetDirectoryId = ref('');
const moveMode = ref<'asset' | 'directory'>('asset');
const directoryModalOpen = ref(false);
const directoryModalMode = ref<'create' | 'edit'>('create');
const directoryName = ref('');
const dragPayload = ref<null | { id: string; kind: 'asset' | 'directory' }>(null);

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
const directoryModalTitle = computed(() => (directoryModalMode.value === 'create' ? '新建目录' : '编辑目录'));

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

function isDirectoryEntry(item: ResourceDirectoryEntry): item is ResourceDirectoryEntryDirectory {
  return (item as ResourceDirectoryEntryDirectory).kind === 'directory';
}

const directoryOptions = computed(() => {
  const output: Array<{ label: string; value: string }> = [];
  function walk(nodes: ResourceDirectoryItem[], prefix = '') {
    nodes.forEach((node) => {
      const label = prefix ? `${prefix} / ${node.name}` : node.name;
      output.push({ label, value: node.id });
      if (Array.isArray(node.children) && node.children.length) {
        walk(node.children, label);
      }
    });
  }
  walk(directoryItems.value);
  return output;
});

const filteredItems = computed(() => {
  const search = keyword.value.trim().toLowerCase();
  const raw = mixedItems.value;
  const sorted = [...raw].sort((a, b) => {
    const aDir = isDirectoryEntry(a);
    const bDir = isDirectoryEntry(b);
    if (aDir && !bDir) return -1;
    if (!aDir && bDir) return 1;
    return a.name.localeCompare(b.name);
  });
  if (!search) {
    return sorted;
  }
  return sorted.filter((item) => item.name.toLowerCase().includes(search));
});

const selectedAssetsCount = computed(() => selectedAssetIds.value.length);

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
  const [categoryList, tagList, seriesList, dirTree] = await Promise.all([
    listResourceCategoriesApi(),
    listResourceTagsApi(),
    listResourceSeriesApi(),
    listResourceDirectoriesApi(),
  ]);
  categories.value = categoryList || [];
  tags.value = tagList || [];
  series.value = seriesList || [];
  directoryItems.value = dirTree || [];
}

async function loadCurrentDirectoryEntries() {
  loadingEntries.value = true;
  try {
    const result = await listResourceDirectoryEntriesApi(currentDirectoryId.value || undefined);
    currentDirectoryId.value = result.currentDirectory.id;
    currentDirectoryPath.value = result.currentDirectory.path || [];
    mixedItems.value = result.items || [];
    selectedAssetIds.value = [];
  } finally {
    loadingEntries.value = false;
  }
}

async function refreshDirectoryContext() {
  await loadLookups();
  await loadCurrentDirectoryEntries();
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

function openDirectory(item: ResourceDirectoryEntryDirectory) {
  currentDirectoryId.value = item.id;
  loadCurrentDirectoryEntries();
}

function openDirectoryCreateModal() {
  directoryModalMode.value = 'create';
  directoryName.value = '';
  directoryModalOpen.value = true;
}

function openDirectoryEditModal(directoryId?: string) {
  const id = directoryId || currentDirectoryId.value;
  const target = directoryOptions.value.find((item) => item.value === id);
  if (!target || currentDirectoryPath.value.length <= 1) {
    message.warning('根目录不支持编辑');
    return;
  }
  directoryModalMode.value = 'edit';
  directoryName.value = target.label.split('/').pop()?.trim() || '';
  movingDirectoryId.value = id;
  directoryModalOpen.value = true;
}

function handleDirectoryDelete(directoryId?: string) {
  const id = directoryId || currentDirectoryId.value;
  const isRoot = currentDirectoryPath.value.length <= 1 && id === currentDirectoryId.value;
  if (isRoot) {
    message.warning('根目录不支持删除');
    return;
  }
  Modal.confirm({
    title: '确认删除目录吗？',
    content: '仅支持删除空目录。',
    okType: 'danger',
    onOk: async () => {
      await deleteResourceDirectoryApi(id);
      message.success('目录已删除');
      if (id === currentDirectoryId.value && currentDirectoryPath.value.length > 1) {
        currentDirectoryId.value = currentDirectoryPath.value[currentDirectoryPath.value.length - 2]!.id;
      }
      await refreshDirectoryContext();
    },
  });
}

function openMoveAssetModal(assetId?: string) {
  moveMode.value = 'asset';
  movingAssetIds.value = assetId ? [assetId] : [...selectedAssetIds.value];
  if (!movingAssetIds.value.length) {
    message.warning('请先选择要移动的资产');
    return;
  }
  moveTargetDirectoryId.value = currentDirectoryId.value;
  moveModalOpen.value = true;
}

function openMoveDirectoryModal(directoryId: string) {
  moveMode.value = 'directory';
  movingDirectoryId.value = directoryId;
  moveTargetDirectoryId.value = currentDirectoryId.value;
  moveModalOpen.value = true;
}

async function submitMove() {
  if (!moveTargetDirectoryId.value) {
    message.warning('请选择目标目录');
    return;
  }
  movingAssets.value = true;
  try {
    if (moveMode.value === 'asset') {
      await bulkMoveResourceAssetsDirectoryApi({
        assetIds: movingAssetIds.value,
        targetDirectoryId: moveTargetDirectoryId.value,
      });
      message.success('资产移动成功');
    } else if (movingDirectoryId.value) {
      await moveResourceDirectoryApi(movingDirectoryId.value, moveTargetDirectoryId.value);
      message.success('目录移动成功');
    }
    moveModalOpen.value = false;
    await refreshDirectoryContext();
  } finally {
    movingAssets.value = false;
  }
}

async function submitDirectoryModal() {
  const name = directoryName.value.trim();
  if (!name) {
    message.warning('请输入目录名');
    return;
  }
  if (directoryModalMode.value === 'create') {
    await createResourceDirectoryApi({
      name,
      parentId: currentDirectoryId.value || undefined,
    });
    message.success('目录创建成功');
  } else if (movingDirectoryId.value) {
    await updateResourceDirectoryApi(movingDirectoryId.value, { name });
    message.success('目录更新成功');
  }
  directoryModalOpen.value = false;
  await refreshDirectoryContext();
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
  payload.append('directoryId', currentDirectoryId.value);
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
    await refreshDirectoryContext();
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
      loadCurrentDirectoryEntries();
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

const columns = [
  { dataIndex: 'thumbnail', key: 'thumbnail', title: '缩略图', width: 90 },
  { dataIndex: 'name', key: 'name', title: '名称' },
  { dataIndex: 'type', key: 'type', title: '类型', width: 120 },
  { dataIndex: 'categoryPathString', key: 'categoryPathString', title: '分类路径', width: 260 },
  { dataIndex: 'size', key: 'size', title: '大小(B)', width: 120 },
  { dataIndex: 'updatedAt', key: 'updatedAt', title: '更新时间', width: 180 },
  { dataIndex: 'actions', key: 'actions', title: '操作', width: 280 },
];

const rowSelection = computed<TableProps['rowSelection']>(() => ({
  selectedRowKeys: selectedAssetIds.value,
  onChange: (keys, rows) => {
    selectedAssetIds.value = rows
      .filter((item) => !isDirectoryEntry(item as ResourceDirectoryEntry))
      .map((item) => (item as ResourceAssetItem).id);
  },
  getCheckboxProps: (record) => ({
    disabled: isDirectoryEntry(record as ResourceDirectoryEntry),
  }),
}));

function formatDateTime(value?: string) {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString();
}

function customRow(record: ResourceDirectoryEntry) {
  const item = record;
  return {
    draggable: true,
    onDragstart: () => {
      dragPayload.value = {
        id: item.id,
        kind: isDirectoryEntry(item) ? 'directory' : 'asset',
      };
    },
    onDragover: (event: DragEvent) => {
      if (isDirectoryEntry(item) && dragPayload.value) {
        event.preventDefault();
      }
    },
    onDrop: async (event: DragEvent) => {
      if (!isDirectoryEntry(item) || !dragPayload.value) {
        return;
      }
      event.preventDefault();
      if (dragPayload.value.kind === 'asset') {
        await bulkMoveResourceAssetsDirectoryApi({
          assetIds: [dragPayload.value.id],
          targetDirectoryId: item.id,
        });
        message.success('资产移动成功');
      } else if (dragPayload.value.id !== item.id) {
        await moveResourceDirectoryApi(dragPayload.value.id, item.id);
        message.success('目录移动成功');
      }
      dragPayload.value = null;
      await refreshDirectoryContext();
    },
    onDragend: () => {
      dragPayload.value = null;
    },
  };
}

onMounted(async () => {
  await refreshDirectoryContext();
});
</script>

<template>
  <div class="p-5">
    <Space style="width: 100%; justify-content: space-between; margin-bottom: 12px" align="center">
      <Space>
        <Button v-access:code="'resource:write'" type="primary" @click="openCreateModal">
          <PlusOutlined />
          新增资产
        </Button>
        <Button v-access:code="'resource:write'" @click="openDirectoryCreateModal">新建目录</Button>
        <Button v-access:code="'resource:write'" @click="() => openDirectoryEditModal()">编辑目录</Button>
        <Button v-access:code="'resource:write'" danger @click="() => handleDirectoryDelete()">删除目录</Button>
        <Button v-access:code="'resource:write'" @click="() => openMoveAssetModal()" :disabled="selectedAssetsCount === 0">
          移动选中资产
        </Button>
      </Space>
      <Input v-model:value="keyword" allow-clear style="width: 260px" placeholder="搜索当前目录文件/目录" />
    </Space>

    <Space style="margin-bottom: 12px" wrap>
      <Tag color="blue">当前目录</Tag>
      <template v-for="(crumb, index) in currentDirectoryPath" :key="crumb.id">
        <Button type="link" size="small" @click="() => { currentDirectoryId = crumb.id; loadCurrentDirectoryEntries(); }">{{ crumb.name }}</Button>
        <ArrowRightOutlined v-if="index < currentDirectoryPath.length - 1" />
      </template>
    </Space>

    <Table
      :columns="columns"
      :data-source="filteredItems"
      :loading="loadingEntries"
      :pagination="false"
      :row-selection="rowSelection"
      :custom-row="customRow"
      :row-key="(row: any) => row.id"
      size="middle"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'thumbnail'">
          <template v-if="isDirectoryEntry(record)">
            <FolderOutlined style="font-size: 20px; color: #1677ff" />
          </template>
          <template v-else>
            <Image
              v-if="isThumbnailAvailable(record)"
              :src="getThumbnailUrl(record)"
              :width="42"
              :height="42"
              style="object-fit: cover; border-radius: 4px"
              @error="() => handleThumbnailError(record)"
            />
            <span v-else>-</span>
          </template>
        </template>

        <template v-else-if="column.key === 'name'">
          <template v-if="isDirectoryEntry(record)">
            <Button type="link" @click="openDirectory(record)">
              <FolderOpenOutlined /> {{ record.name }}
            </Button>
          </template>
          <template v-else>
            {{ record.name }}
          </template>
        </template>

        <template v-else-if="column.key === 'type'">
          <template v-if="isDirectoryEntry(record)">目录</template>
          <template v-else>{{ record.type }}</template>
        </template>

        <template v-else-if="column.key === 'categoryPathString'">
          <template v-if="isDirectoryEntry(record)">-</template>
          <template v-else>{{ record.categoryPathString || '-' }}</template>
        </template>

        <template v-else-if="column.key === 'size'">
          <template v-if="isDirectoryEntry(record)">-</template>
          <template v-else>{{ record.size }}</template>
        </template>

        <template v-else-if="column.key === 'updatedAt'">
          {{ formatDateTime(record.updatedAt) }}
        </template>

        <template v-else-if="column.key === 'actions'">
          <Space>
            <template v-if="isDirectoryEntry(record)">
              <Button v-access:code="'resource:write'" type="text" size="small" @click="openDirectory(record)">打开</Button>
              <Button v-access:code="'resource:write'" type="text" size="small" @click="() => openDirectoryEditModal(record.id)">编辑</Button>
              <Button v-access:code="'resource:write'" type="text" size="small" @click="() => openMoveDirectoryModal(record.id)">移动</Button>
              <Button v-access:code="'resource:write'" danger type="text" size="small" @click="() => handleDirectoryDelete(record.id)">删除</Button>
            </template>
            <template v-else>
              <Tooltip title="下载">
                <Button type="text" size="small" @click="handleDownload(record.id)">
                  <DownloadOutlined />
                </Button>
              </Tooltip>
              <Tooltip title="编辑">
                <Button v-access:code="'resource:write'" type="text" size="small" @click="openEditModal(record)">
                  <EditOutlined />
                </Button>
              </Tooltip>
              <Button v-access:code="'resource:write'" type="text" size="small" @click="() => openMoveAssetModal(record.id)">移动</Button>
              <Tooltip title="删除">
                <Button v-access:code="'resource:write'" danger type="text" size="small" @click="handleDelete(record)">
                  <DeleteOutlined />
                </Button>
              </Tooltip>
            </template>
          </Space>
        </template>
      </template>
    </Table>

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
        <Form.Item label="当前目录">
          <Input :value="currentDirectoryPath.map((item) => item.name).join(' / ')" disabled />
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

    <Modal
      :open="directoryModalOpen"
      :title="directoryModalTitle"
      ok-text="保存"
      cancel-text="取消"
      @ok="submitDirectoryModal"
      @cancel="directoryModalOpen = false"
    >
      <Form :label-col="{ span: 5 }" :wrapper-col="{ span: 18 }">
        <Form.Item label="目录名" required>
          <Input v-model:value="directoryName" placeholder="请输入目录名" />
        </Form.Item>
      </Form>
    </Modal>

    <Modal
      :open="moveModalOpen"
      :confirm-loading="movingAssets"
      title="移动到目录"
      ok-text="移动"
      cancel-text="取消"
      @ok="submitMove"
      @cancel="moveModalOpen = false"
    >
      <Form :label-col="{ span: 6 }" :wrapper-col="{ span: 16 }">
        <Form.Item label="目标目录" required>
          <Select
            v-model:value="moveTargetDirectoryId"
            show-search
            option-filter-prop="label"
            :options="directoryOptions"
            placeholder="选择目标目录"
          />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
