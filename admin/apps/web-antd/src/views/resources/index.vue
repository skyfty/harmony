<script setup lang="ts">
import type { FormInstance, UploadChangeParam, UploadFile, UploadProps } from 'ant-design-vue';
import type { TableProps } from 'ant-design-vue';

import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import {
  buildResourceDownloadUrl,
  bulkMoveResourceAssetsCategoryApi,
  bulkUpdateResourceAssetsApi,
  createResourceAssetApi,
  createResourceCategoryTreeItemApi,
  deleteResourceAssetApi,
  deleteResourceCategoryTreeItemApi,
  getResourceAssetApi,
  listResourceCategoriesApi,
  listResourceCategoriesTreeApi,
  listResourceCategoryEntriesApi,
  listResourceSeriesApi,
  listResourceTagsApi,
  moveResourceCategoryTreeItemApi,
  refreshAssetManifestApi,
  restoreResourceAssetApi,
  updateResourceAssetApi,
  updateResourceCategoryTreeItemApi,
  type ResourceAssetItem,
  type ResourceCategoryItem,
  type ResourceCategoryEntry,
  type ResourceCategoryEntryDirectory,
  type ResourceCategoryTreeItem,
  type ResourceSeriesItem,
  type ResourceTagItem,
} from '#/api';
import { formatAssetRole, formatFileSize } from '#/utils/format';

import { Button, Form, Image, Input, InputNumber, message, Modal, Select, Space, Table, Upload, Tooltip, Tag } from 'ant-design-vue';
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  PlusOutlined,
  ArrowRightOutlined,
  DownOutlined,
  ReloadOutlined,
  RightOutlined,
} from '@ant-design/icons-vue';
import { Checkbox } from 'ant-design-vue';

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

interface DirectoryTreeListItem {
  ancestorIds: string[];
  depth: number;
  hasChildren: boolean;
  id: string;
  name: string;
  parentId: null | string;
  pathLabel: string;
}

const { TextArea } = Input;
const router = useRouter();

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
const directoryItems = ref<ResourceCategoryTreeItem[]>([]);
const currentDirectoryId = ref('');
const currentDirectoryPath = ref<Array<{ id: string; name: string }>>([]);
const mixedItems = ref<ResourceCategoryEntry[]>([]);
const loadingEntries = ref(false);
const keyword = ref('');
const assetTypeFilter = ref('');
const assetSeriesFilter = ref('');
const assetTagFilter = ref('');
const selectedAssetIds = ref<string[]>([]);
const movingAssets = ref(false);
const movingAssetIds = ref<string[]>([]);
const movingDirectoryId = ref<null | string>(null);
const batchEditModalOpen = ref(false);
const batchEditSubmitting = ref(false);
const moveModalOpen = ref(false);
const moveTargetDirectoryId = ref('');
const moveMode = ref<'asset' | 'directory'>('asset');
const directoryModalOpen = ref(false);
const directoryModalMode = ref<'create' | 'edit'>('create');
const directoryName = ref('');
const dragPayload = ref<null | { id: string; kind: 'asset' | 'directory' }>(null);
const directoryKeyword = ref('');
const collapsedDirectoryIds = reactive(new Set<string>());
const directoryCollapseInitialized = ref(false);
const showDeletedOnly = ref(false);
const refreshingManifest = ref(false);
const batchDeleteSubmitting = ref(false);
const assetSortField = ref<'categoryPathString' | 'name' | 'size' | 'type' | 'updatedAt'>('name');
const assetSortOrder = ref<'ascend' | 'descend'>('ascend');

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

const modalTitle = computed(() => (editingId.value ? '编辑资产' : '新增资产'));
const directoryModalTitle = computed(() => (directoryModalMode.value === 'create' ? '新建分类' : '编辑分类'));

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

interface BatchEditFormModel {
  applyCategory: boolean;
  applySeries: boolean;
  applyTags: boolean;
  categoryId: string;
  seriesId: null | string;
  tagIds: string[];
}

const batchEditFormModel = reactive<BatchEditFormModel>({
  applyCategory: false,
  applySeries: false,
  applyTags: false,
  categoryId: '',
  seriesId: null,
  tagIds: [],
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

function isDirectoryEntry(item: ResourceCategoryEntry): item is ResourceCategoryEntryDirectory {
  return (item as ResourceCategoryEntryDirectory).kind === 'directory';
}

function normalizeDirectoryTree(nodes: ResourceCategoryTreeItem[]): ResourceCategoryTreeItem[] {
  if (
    nodes.length === 1 &&
    !nodes[0]?.parentId &&
    Array.isArray(nodes[0]?.children) &&
    nodes[0].children.length > 0
  ) {
    return nodes[0].children;
  }
  return nodes;
}

function flattenDirectoryTree(
  nodes: ResourceCategoryTreeItem[],
  prefix = '',
  depth = 0,
  ancestorIds: string[] = [],
): DirectoryTreeListItem[] {
  const rows: DirectoryTreeListItem[] = [];
  nodes.forEach((node) => {
    const pathLabel = prefix ? `${prefix} / ${node.name}` : node.name;
    rows.push({
      ancestorIds,
      depth,
      hasChildren: Array.isArray(node.children) && node.children.length > 0,
      id: node.id,
      name: node.name,
      parentId: node.parentId,
      pathLabel,
    });
    if (Array.isArray(node.children) && node.children.length) {
      rows.push(...flattenDirectoryTree(node.children, pathLabel, depth + 1, [...ancestorIds, node.id]));
    }
  });
  return rows;
}

const directoryOptions = computed(() => {
  const output: Array<{ label: string; value: string }> = [];
  function walk(nodes: ResourceCategoryTreeItem[], prefix = '') {
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

const directoryRows = computed(() => flattenDirectoryTree(directoryItems.value));

const directoryRowMap = computed(() => {
  const map = new Map<string, DirectoryTreeListItem>();
  directoryRows.value.forEach((item) => map.set(item.id, item));
  return map;
});

const currentAssets = computed(() => mixedItems.value.filter((item): item is ResourceAssetItem => !isDirectoryEntry(item)));
const currentChildDirectories = computed(() =>
  mixedItems.value.filter((item): item is ResourceCategoryEntryDirectory => isDirectoryEntry(item)),
);

const filteredDirectoryRows = computed(() => {
  const search = directoryKeyword.value.trim().toLowerCase();
  if (!search) {
    return directoryRows.value.filter((item) => !item.ancestorIds.some((ancestorId) => collapsedDirectoryIds.has(ancestorId)));
  }
  return directoryRows.value.filter((item) => {
    return item.name.toLowerCase().includes(search) || item.pathLabel.toLowerCase().includes(search);
  });
});

function expandDirectoryAncestors(directoryId: string) {
  const row = directoryRowMap.value.get(directoryId);
  if (!row) {
    return;
  }
  row.ancestorIds.forEach((ancestorId) => collapsedDirectoryIds.delete(ancestorId));
}

function toggleDirectoryExpanded(directoryId: string) {
  if (collapsedDirectoryIds.has(directoryId)) {
    collapsedDirectoryIds.delete(directoryId);
    return;
  }
  collapsedDirectoryIds.add(directoryId);
}

function initializeDirectoryCollapsedState() {
  if (directoryCollapseInitialized.value) {
    return;
  }
  collapsedDirectoryIds.clear();
  directoryRows.value.forEach((item) => {
    if (item.hasChildren && item.depth >= 0) {
      collapsedDirectoryIds.add(item.id);
    }
  });
  directoryCollapseInitialized.value = true;
}

async function handleRefreshManifest() {
  if (refreshingManifest.value) {
    return;
  }
  refreshingManifest.value = true;
  try {
    await refreshAssetManifestApi();
    message.success('manifest 已重新生成');
  } finally {
    refreshingManifest.value = false;
  }
}

const filteredItems = computed(() => {
  const search = keyword.value.trim().toLowerCase();
  const filtered = currentAssets.value.filter((item) => {
    const matchesKeyword = !search || item.name.toLowerCase().includes(search);
    const matchesType = !assetTypeFilter.value || item.type === assetTypeFilter.value;
    const matchesSeries =
      !assetSeriesFilter.value ||
      (assetSeriesFilter.value === 'none' ? !item.seriesId : item.seriesId === assetSeriesFilter.value);
    const matchesTag =
      !assetTagFilter.value || Array.isArray(item.tagIds) && item.tagIds.includes(assetTagFilter.value);
    return matchesKeyword && matchesType && matchesSeries && matchesTag;
  });

  const compareText = (left: string, right: string) => {
    return left.localeCompare(right, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  };

  const direction = assetSortOrder.value === 'descend' ? -1 : 1;

  return [...filtered].sort((left, right) => {
    switch (assetSortField.value) {
      case 'size': {
        const leftSize = Number(left.size || 0);
        const rightSize = Number(right.size || 0);
        return (leftSize - rightSize) * direction;
      }
      case 'updatedAt': {
        const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
        const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
        return (leftTime - rightTime) * direction;
      }
      case 'categoryPathString': {
        const primary = compareText(left.categoryPathString || '', right.categoryPathString || '');
        return primary ? primary * direction : compareText(left.name || '', right.name || '') * direction;
      }
      case 'type': {
        const primary = compareText(left.type || '', right.type || '');
        return primary ? primary * direction : compareText(left.name || '', right.name || '') * direction;
      }
      case 'name':
      default:
        return compareText(left.name || '', right.name || '') * direction;
    }
  });
});

function handleAssetTableChange(_pagination: unknown, _filters: unknown, sorter: any) {
  const nextSorter = Array.isArray(sorter) ? sorter[0] : sorter;
  if (!nextSorter?.order || !nextSorter?.field) {
    assetSortField.value = 'name';
    assetSortOrder.value = 'ascend';
    return;
  }
  const field = nextSorter.field as 'categoryPathString' | 'name' | 'size' | 'type' | 'updatedAt';
  if (field === 'categoryPathString' || field === 'name' || field === 'size' || field === 'type' || field === 'updatedAt') {
    assetSortField.value = field;
    assetSortOrder.value = nextSorter.order;
  }
}

const assetTypeOptions = computed(() => [{ label: '全部类型', value: '' }, ...typeOptions]);
const assetSeriesFilterOptions = computed(() => [
  { label: '全部系列', value: '' },
  { label: '未分配系列', value: 'none' },
  ...seriesOptions.value,
]);
const assetTagFilterOptions = computed(() => [{ label: '全部标签', value: '' }, ...tagOptions.value]);

const currentDirectoryName = computed(() => currentDirectoryPath.value[currentDirectoryPath.value.length - 1]?.name || '全部资源');
const currentDirectoryIsRoot = computed(() => currentDirectoryPath.value.length <= 1);
const rootDirectoryId = computed(() => currentDirectoryPath.value[0]?.id || directoryItems.value[0]?.id || '');
const currentDirectoryStats = computed(() => ({
  assetCount: currentAssets.value.length,
  childDirectoryCount: currentChildDirectories.value.length,
}));

const resourceSummary = computed(() => ({
  assetCount: currentAssets.value.length,
  categoryCount: directoryRows.value.length,
  deletedCount: mixedItems.value.filter((item): item is ResourceAssetItem => !isDirectoryEntry(item) && Boolean(item.deletedAt)).length,
  seriesCount: series.value.length,
  tagCount: tags.value.length,
}));

const moveTargetOptions = computed(() => {
  if (moveMode.value !== 'directory' || !movingDirectoryId.value) {
    return directoryOptions.value;
  }
  return directoryOptions.value.filter((item) => {
    if (item.value === movingDirectoryId.value) {
      return false;
    }
    const targetRow = directoryRowMap.value.get(item.value);
    return !targetRow?.ancestorIds.includes(movingDirectoryId.value!);
  });
});

const selectedAssetsCount = computed(() => selectedAssetIds.value.length);

const selectedAssets = computed(() => {
  const selected = new Set(selectedAssetIds.value);
  return currentAssets.value.filter((item) => selected.has(item.id));
});

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
    listResourceCategoriesTreeApi(),
  ]);
  categories.value = categoryList || [];
  tags.value = tagList || [];
  series.value = seriesList || [];
  directoryItems.value = normalizeDirectoryTree(dirTree || []);
  initializeDirectoryCollapsedState();
}

async function loadCurrentDirectoryEntries() {
  loadingEntries.value = true;
  try {
    const result = await listResourceCategoryEntriesApi({
      categoryId: currentDirectoryId.value || undefined,
      deletedOnly: showDeletedOnly.value,
    });
    currentDirectoryId.value = result.currentDirectory.id;
    currentDirectoryPath.value = result.currentDirectory.path || [];
    expandDirectoryAncestors(currentDirectoryId.value);
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
  if (showDeletedOnly.value) {
    message.warning('回收站中不能新增资产，请先退出回收站');
    return;
  }
  editingId.value = null;
  resetForm();
  assetFormModel.categoryId = currentDirectoryId.value;
  modalOpen.value = true;
}

function clearAssetFilters() {
  keyword.value = '';
  assetTypeFilter.value = '';
  assetSeriesFilter.value = '';
  assetTagFilter.value = '';
}

function resetBatchEditForm() {
  batchEditFormModel.applyCategory = false;
  batchEditFormModel.applySeries = false;
  batchEditFormModel.applyTags = false;
  batchEditFormModel.categoryId = currentDirectoryId.value || rootDirectoryId.value;
  batchEditFormModel.seriesId = null;
  batchEditFormModel.tagIds = [];
}

function openBatchEditModal() {
  if (showDeletedOnly.value) {
    message.warning('回收站中不能批量编辑资产，请先退出回收站');
    return;
  }
  if (!selectedAssetsCount.value) {
    message.warning('请先选择要批量编辑的资产');
    return;
  }
  resetBatchEditForm();
  batchEditModalOpen.value = true;
}

function goToResourceSection(path: string) {
  void router.push(path);
}

async function openEditModal(row: ResourceAssetItem) {
  const detail = await getResourceAssetApi(row.id);
  if (detail.deletedAt) {
    message.warning('回收站中的资产请先恢复后再编辑');
    return;
  }
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

function selectDirectory(directoryId: string) {
  currentDirectoryId.value = directoryId;
  expandDirectoryAncestors(directoryId);
  loadCurrentDirectoryEntries();
}

function openDirectoryCreateModal() {
  directoryModalMode.value = 'create';
  directoryName.value = '';
  movingDirectoryId.value = null;
  directoryModalOpen.value = true;
}

function openDirectoryEditModal(directoryId?: string) {
  const id = directoryId || currentDirectoryId.value;
  const target = directoryRowMap.value.get(id);
  if (!target || (id === currentDirectoryId.value && currentDirectoryIsRoot.value)) {
    message.warning('根分类不支持编辑');
    return;
  }
  directoryModalMode.value = 'edit';
  directoryName.value = target.name;
  movingDirectoryId.value = id;
  directoryModalOpen.value = true;
}

function handleDirectoryDelete(directoryId?: string) {
  const id = directoryId || currentDirectoryId.value;
  const isRoot = id === currentDirectoryId.value && currentDirectoryIsRoot.value;
  if (isRoot) {
    message.warning('根分类不支持删除');
    return;
  }
  Modal.confirm({
    title: '确认删除分类吗？',
    content: '仅支持删除空分类。',
    okType: 'danger',
    onOk: async () => {
      await deleteResourceCategoryTreeItemApi(id);
      message.success('分类已删除');
      if (id === currentDirectoryId.value && currentDirectoryPath.value.length > 1) {
        currentDirectoryId.value = currentDirectoryPath.value[currentDirectoryPath.value.length - 2]!.id;
      }
      await refreshDirectoryContext();
    },
  });
}

function openMoveAssetModal(assetId?: string) {
  if (showDeletedOnly.value) {
    message.warning('回收站中不能移动资产，请先恢复后再操作');
    return;
  }
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
  if (!directoryId) {
    return;
  }
  moveMode.value = 'directory';
  movingDirectoryId.value = directoryId;
  moveTargetDirectoryId.value = directoryRowMap.value.get(directoryId)?.parentId || rootDirectoryId.value;
  moveModalOpen.value = true;
}

async function submitMove() {
  if (!moveTargetDirectoryId.value) {
    message.warning('请选择目标分类');
    return;
  }
  movingAssets.value = true;
  try {
    if (moveMode.value === 'asset') {
      await bulkMoveResourceAssetsCategoryApi({
        assetIds: movingAssetIds.value,
        targetDirectoryId: moveTargetDirectoryId.value,
      });
      message.success('资产移动成功');
    } else if (movingDirectoryId.value) {
      if (movingDirectoryId.value === moveTargetDirectoryId.value) {
        message.warning('分类不能移动到自身');
        return;
      }
      const targetRow = directoryRowMap.value.get(moveTargetDirectoryId.value);
      if (targetRow?.ancestorIds.includes(movingDirectoryId.value)) {
        message.warning('分类不能移动到自己的后代下');
        return;
      }
      await moveResourceCategoryTreeItemApi(movingDirectoryId.value, moveTargetDirectoryId.value);
      message.success('分类移动成功');
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
    message.warning('请输入分类名');
    return;
  }
  if (directoryModalMode.value === 'create') {
    await createResourceCategoryTreeItemApi({
      name,
      parentId: currentDirectoryId.value || undefined,
    });
    message.success('分类创建成功');
  } else if (movingDirectoryId.value) {
    await updateResourceCategoryTreeItemApi(movingDirectoryId.value, { name });
    message.success('分类更新成功');
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
    title: row.deletedAt ? `确认彻底删除资产 “${row.name}” 吗？` : `确认删除资产 “${row.name}” 吗？`,
    content: row.deletedAt ? '彻底删除后不可恢复。' : '该操作会把资产移入回收站。',
    okType: 'danger',
    onOk: async () => {
      await deleteResourceAssetApi(row.id);
      message.success(row.deletedAt ? '资产已彻底删除' : '资产已删除');
      loadCurrentDirectoryEntries();
    },
  });
}

async function handleRestore(row: ResourceAssetItem) {
  await restoreResourceAssetApi(row.id);
  message.success('资产已恢复');
  await refreshDirectoryContext();
}

async function handleBatchRestore() {
  if (!showDeletedOnly.value || !selectedAssets.value.length) {
    return;
  }
  movingAssets.value = true;
  try {
    await Promise.all(selectedAssets.value.map((item) => restoreResourceAssetApi(item.id)));
    message.success('已恢复选中的资产');
    await refreshDirectoryContext();
  } finally {
    movingAssets.value = false;
  }
}

async function handleBatchPermanentDelete() {
  if (!showDeletedOnly.value || !selectedAssets.value.length) {
    return;
  }
  Modal.confirm({
    title: `确认彻底删除选中的 ${selectedAssets.value.length} 个资产吗？`,
    content: '彻底删除后不可恢复。',
    okType: 'danger',
    onOk: async () => {
      movingAssets.value = true;
      try {
        await Promise.all(selectedAssets.value.map((item) => deleteResourceAssetApi(item.id)));
        message.success('已彻底删除选中的资产');
        await refreshDirectoryContext();
      } finally {
        movingAssets.value = false;
      }
    },
  });
}

async function handleBatchDelete() {
  if (showDeletedOnly.value || !selectedAssets.value.length) {
    return;
  }
  Modal.confirm({
    title: `确认删除选中的 ${selectedAssets.value.length} 个资产吗？`,
    content: '该操作会把资产移入回收站。',
    okType: 'danger',
    onOk: async () => {
      batchDeleteSubmitting.value = true;
      try {
        await Promise.all(selectedAssets.value.map((item) => deleteResourceAssetApi(item.id)));
        message.success('已删除选中的资产');
        await refreshDirectoryContext();
      } finally {
        batchDeleteSubmitting.value = false;
      }
    },
  });
}

async function submitBatchEdit() {
  if (!selectedAssetsCount.value) {
    message.warning('请先选择要批量编辑的资产');
    return;
  }

  const payload: {
    assetIds: string[];
    categoryId?: string;
    seriesId?: null | string;
    tagIds?: string[];
  } = {
    assetIds: [...selectedAssetIds.value],
  };

  let hasFieldToUpdate = false;
  if (batchEditFormModel.applyCategory) {
    if (!batchEditFormModel.categoryId) {
      message.warning('请选择目标分类');
      return;
    }
    payload.categoryId = batchEditFormModel.categoryId;
    hasFieldToUpdate = true;
  }

  if (batchEditFormModel.applySeries) {
    payload.seriesId = batchEditFormModel.seriesId;
    hasFieldToUpdate = true;
  }

  if (batchEditFormModel.applyTags) {
    payload.tagIds = [...batchEditFormModel.tagIds];
    hasFieldToUpdate = true;
  }

  if (!hasFieldToUpdate) {
    message.warning('请至少勾选一个要批量修改的字段');
    return;
  }

  batchEditSubmitting.value = true;
  try {
    const result = await bulkUpdateResourceAssetsApi(payload);
    message.success(`已更新 ${result.modifiedCount} 个资产`);
    batchEditModalOpen.value = false;
    await refreshDirectoryContext();
  } finally {
    batchEditSubmitting.value = false;
  }
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

const columns = computed(() => [
  { dataIndex: 'thumbnail', key: 'thumbnail', title: '缩略图', width: 90 },
  {
    dataIndex: 'name',
    key: 'name',
    sorter: true,
    sortOrder: assetSortField.value === 'name' ? assetSortOrder.value : undefined,
    title: '名称',
  },
  {
    dataIndex: 'type',
    key: 'type',
    sorter: true,
    sortOrder: assetSortField.value === 'type' ? assetSortOrder.value : undefined,
    title: '类型',
    width: 120,
  },
  {
    dataIndex: 'assetRole',
    key: 'assetRole',
    title: '角色类型',
    width: 120,
  },
  {
    dataIndex: 'categoryPathString',
    key: 'categoryPathString',
    sorter: true,
    sortOrder: assetSortField.value === 'categoryPathString' ? assetSortOrder.value : undefined,
    title: '分类路径',
    width: 260,
  },
  {
    dataIndex: 'size',
    key: 'size',
    sorter: true,
    sortOrder: assetSortField.value === 'size' ? assetSortOrder.value : undefined,
    title: '大小(B)',
    width: 120,
  },
  {
    dataIndex: 'updatedAt',
    key: 'updatedAt',
    sorter: true,
    sortOrder: assetSortField.value === 'updatedAt' ? assetSortOrder.value : undefined,
    title: '更新时间',
    width: 180,
  },
  { dataIndex: 'actions', key: 'actions', title: '操作', width: 280 },
]);

const rowSelection = computed<TableProps['rowSelection']>(() => ({
  selectedRowKeys: selectedAssetIds.value,
  onChange: (_keys, rows) => {
    selectedAssetIds.value = rows
      .filter((item) => !isDirectoryEntry(item as ResourceCategoryEntry))
      .map((item) => (item as ResourceAssetItem).id);
  },
  getCheckboxProps: (record) => ({
    disabled: isDirectoryEntry(record as ResourceCategoryEntry),
  }),
}));

function formatDateTime(value?: string) {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString();
}

function asAssetRecord(record: Record<string, any>): ResourceAssetItem {
  return record as ResourceAssetItem;
}

function customRow(record: ResourceCategoryEntry) {
  const item = record as ResourceAssetItem;
  return {
    draggable: true,
    onDragstart: () => {
      dragPayload.value = {
        id: item.id,
        kind: 'asset',
      };
    },
    onDragend: () => {
      dragPayload.value = null;
    },
  };
}

async function handleDirectoryTreeDrop(targetDirectoryId: string) {
  if (!dragPayload.value || !targetDirectoryId) {
    return;
  }
  const payload = dragPayload.value;
  if (payload.kind === 'asset') {
    await bulkMoveResourceAssetsCategoryApi({
      assetIds: [payload.id],
      targetDirectoryId,
    });
    message.success('资产移动成功');
  } else if (payload.id !== targetDirectoryId) {
    const targetRow = directoryRowMap.value.get(targetDirectoryId);
    if (targetRow?.ancestorIds.includes(payload.id)) {
      message.warning('分类不能移动到自己的后代下');
      dragPayload.value = null;
      return;
    }
    await moveResourceCategoryTreeItemApi(payload.id, targetDirectoryId);
    message.success('分类移动成功');
  }
  dragPayload.value = null;
  await refreshDirectoryContext();
}

function handleDirectoryTreeDragStart(directoryId: string) {
  dragPayload.value = {
    id: directoryId,
    kind: 'directory',
  };
}

function canDropOnDirectory(targetDirectoryId: string) {
  if (!dragPayload.value) {
    return false;
  }
  if (dragPayload.value.id === targetDirectoryId) {
    return false;
  }
  if (dragPayload.value.kind === 'directory') {
    const targetRow = directoryRowMap.value.get(targetDirectoryId);
    return !targetRow?.ancestorIds.includes(dragPayload.value.id);
  }
  return true;
}

onMounted(async () => {
  await refreshDirectoryContext();
});
</script>

<template>
  <div class="p-5">


    <div style="display: flex; gap: 16px; align-items: stretch">
      <div style="width: 320px; flex: 0 0 320px; border: 1px solid #f0f0f0; border-radius: 8px; background: #fff">
        <div style="padding: 12px 12px 8px; border-bottom: 1px solid #f0f0f0">
          <div style="font-size: 14px; font-weight: 600; margin-bottom: 8px">资产目录树</div>
          <Input v-model:value="directoryKeyword" allow-clear size="small" placeholder="搜索目录" style="margin-bottom: 8px" />
          <Space wrap>
            <Button v-access:code="'category:write'" size="small" @click="openDirectoryCreateModal">新建目录</Button>
            <Button v-access:code="'category:write'" size="small" @click="() => openDirectoryEditModal()" :disabled="currentDirectoryIsRoot">重命名</Button>
            <Button v-access:code="'category:write'" size="small" @click="() => openMoveDirectoryModal(currentDirectoryId)" :disabled="currentDirectoryIsRoot">移动</Button>
            <Button v-access:code="'category:write'" size="small" danger @click="() => handleDirectoryDelete()" :disabled="currentDirectoryIsRoot">删除</Button>
          </Space>
        </div>
        <div style="padding: 8px 0; max-height: calc(100vh - 240px); overflow-y: auto">
          <div
            style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer"
            :style="currentDirectoryIsRoot ? { background: '#e6f4ff' } : null"
            @click="() => rootDirectoryId && selectDirectory(rootDirectoryId)"
            @dragover.prevent="() => undefined"
            @drop="() => rootDirectoryId && handleDirectoryTreeDrop(rootDirectoryId)"
          >
            <FolderOpenOutlined style="color: #1677ff" />
            <span>全部资源</span>
          </div>
          <div v-if="!filteredDirectoryRows.length" style="padding: 12px; color: #999; text-align: center">没有匹配的目录</div>
          <div
            v-for="item in filteredDirectoryRows"
            :key="item.id"
            draggable="true"
            style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; user-select: none"
            :style="[
              { paddingLeft: `${12 + item.depth * 20}px` },
              currentDirectoryId === item.id ? { background: '#e6f4ff' } : null,
            ]"
            @click="() => selectDirectory(item.id)"
            @dragstart="() => handleDirectoryTreeDragStart(item.id)"
            @dragend="() => (dragPayload = null)"
            @dragover.prevent="() => undefined"
            @drop="() => canDropOnDirectory(item.id) && handleDirectoryTreeDrop(item.id)"
          >
            <Button
              v-if="item.hasChildren"
              type="text"
              size="small"
              style="width: 20px; min-width: 20px; height: 20px; padding: 0; flex: 0 0 20px"
              @click.stop="() => toggleDirectoryExpanded(item.id)"
            >
              <component :is="collapsedDirectoryIds.has(item.id) ? RightOutlined : DownOutlined" style="font-size: 12px; color: #999" />
            </Button>
            <span v-else style="width: 20px; min-width: 20px; flex: 0 0 20px"></span>
            <component :is="currentDirectoryId === item.id ? FolderOpenOutlined : FolderOutlined" style="color: #1677ff" />
            <span style="flex: 1">{{ item.name }}</span>
            <span v-if="item.hasChildren" style="font-size: 12px; color: #999">子级</span>
          </div>
        </div>
      </div>

      <div style="min-width: 0; flex: 1">
        <Space style="width: 100%; justify-content: space-between; margin-bottom: 12px" align="center">
          <Space>
            <Button v-access:code="'resource:write'" type="primary" @click="openCreateModal" :disabled="showDeletedOnly">
              <PlusOutlined />
              新增资产
            </Button>
            <Button v-access:code="'resource:write'" :loading="refreshingManifest" @click="handleRefreshManifest">
              <ReloadOutlined />
              刷新缓存
            </Button>
            <Button v-access:code="'resource:write'" @click="openBatchEditModal" :disabled="selectedAssetsCount === 0 || showDeletedOnly">
              批量编辑
            </Button>
            <Button
              v-access:code="'resource:write'"
              danger
              :loading="batchDeleteSubmitting"
              :disabled="selectedAssetsCount === 0 || showDeletedOnly"
              @click="handleBatchDelete"
            >
              批量删除
            </Button>
            <Button v-access:code="'resource:write'" @click="() => openMoveAssetModal()" :disabled="selectedAssetsCount === 0 || showDeletedOnly">
              移动选中资产
            </Button>
            <Button v-access:code="'resource:read'" @click="() => { showDeletedOnly = !showDeletedOnly; loadCurrentDirectoryEntries(); }">
              {{ showDeletedOnly ? '退出回收站' : '回收站' }}
            </Button>
            <Button v-access:code="'resource:write'" :disabled="!showDeletedOnly || selectedAssetsCount === 0" @click="handleBatchRestore">
              批量恢复
            </Button>
            <Button v-access:code="'resource:write'" danger :disabled="!showDeletedOnly || selectedAssetsCount === 0" @click="handleBatchPermanentDelete">
              批量彻底删除
            </Button>
          </Space>
        </Space>

        <Space style="margin-bottom: 12px; width: 100%" wrap>
          <Select v-model:value="assetTypeFilter" :options="assetTypeOptions" style="width: 140px" />
          <Select v-model:value="assetSeriesFilter" :options="assetSeriesFilterOptions" style="width: 180px" show-search option-filter-prop="label" />
          <Select v-model:value="assetTagFilter" :options="assetTagFilterOptions" style="width: 180px" show-search option-filter-prop="label" />
          <div style="margin-left: auto; min-width: 320px; flex: 1; display: flex; justify-content: flex-end">
            <Space>
              <Button v-access:code="'resource:write'" @click="clearAssetFilters">
                清除筛选
              </Button>
              <Input v-model:value="keyword" allow-clear style="width: 320px" placeholder="搜索当前目录资产" />
            </Space>
          </div>
        </Space>

        <Space style="margin-bottom: 12px" wrap>
          <Tag color="blue">当前目录</Tag>
          <template v-for="(crumb, index) in currentDirectoryPath" :key="crumb.id">
            <Button type="link" size="small" @click="() => selectDirectory(crumb.id)">{{ crumb.name }}</Button>
            <ArrowRightOutlined v-if="index < currentDirectoryPath.length - 1" />
          </template>
          <Tag>{{ currentDirectoryName }}</Tag>
          <Tag>{{ `子目录 ${currentDirectoryStats.childDirectoryCount}` }}</Tag>
          <Tag>{{ `资产 ${currentDirectoryStats.assetCount}` }}</Tag>
        </Space>

        <div style="max-height: calc(100vh - 240px); overflow-y: auto">
        <Table
          :columns="columns"
          :data-source="filteredItems"
          :loading="loadingEntries"
          :pagination="false"
          @change="handleAssetTableChange"
          :row-selection="rowSelection"
          :custom-row="customRow"
          :row-key="(row: any) => row.id"
          size="middle"
        >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'thumbnail'">
          <Image
            v-if="isThumbnailAvailable(asAssetRecord(record))"
            :src="getThumbnailUrl(asAssetRecord(record))"
            :width="42"
            :height="42"
            style="object-fit: cover; border-radius: 4px"
            @error="() => handleThumbnailError(asAssetRecord(record))"
          />
          <span v-else>-</span>
        </template>

        <template v-else-if="column.key === 'name'">
          {{ record.name }}
        </template>

        <template v-else-if="column.key === 'type'">
          {{ record.type }}
        </template>

        <template v-else-if="column.key === 'assetRole'">
          {{ formatAssetRole(asAssetRecord(record).assetRole) }}
        </template>

        <template v-else-if="column.key === 'categoryPathString'">
          {{ record.categoryPathString || '-' }}
        </template>

        <template v-else-if="column.key === 'size'">
          {{ formatFileSize(record.size) }}
        </template>

        <template v-else-if="column.key === 'updatedAt'">
          {{ formatDateTime(record.updatedAt) }}
        </template>

        <template v-else-if="column.key === 'actions'">
          <Space>
            <Tooltip title="下载">
              <Button type="text" size="small" @click="handleDownload(record.id)">
                <DownloadOutlined />
              </Button>
            </Tooltip>
            <template v-if="!asAssetRecord(record).deletedAt">
              <Tooltip title="编辑">
                <Button v-access:code="'resource:write'" type="text" size="small" @click="openEditModal(asAssetRecord(record))">
                  <EditOutlined />
                </Button>
              </Tooltip>
              <Button v-access:code="'resource:write'" type="text" size="small" @click="() => openMoveAssetModal(record.id)">移动</Button>
            </template>
            <template v-if="asAssetRecord(record).deletedAt">
              <Button v-access:code="'resource:write'" type="text" size="small" @click="() => handleRestore(asAssetRecord(record))">恢复</Button>
            </template>
            <Tooltip :title="asAssetRecord(record).deletedAt ? '彻底删除' : '删除'">
              <Button v-access:code="'resource:write'" danger type="text" size="small" @click="handleDelete(asAssetRecord(record))">
                <DeleteOutlined />
              </Button>
            </Tooltip>
          </Space>
        </template>
      </template>
        </Table>
        </div>
      </div>
    </div>

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
        <Form.Item label="当前分类">
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
        <Form.Item label="分类名" required>
          <Input v-model:value="directoryName" placeholder="请输入分类名" />
        </Form.Item>
      </Form>
    </Modal>

    <Modal
      :open="moveModalOpen"
      :confirm-loading="movingAssets"
      title="移动到分类"
      ok-text="移动"
      cancel-text="取消"
      @ok="submitMove"
      @cancel="moveModalOpen = false"
    >
      <Form :label-col="{ span: 6 }" :wrapper-col="{ span: 16 }">
        <Form.Item label="目标分类" required>
          <Select
            v-model:value="moveTargetDirectoryId"
            show-search
            option-filter-prop="label"
            :options="moveTargetOptions"
            placeholder="选择目标分类"
          />
        </Form.Item>
      </Form>
    </Modal>

    <Modal
      :open="batchEditModalOpen"
      :confirm-loading="batchEditSubmitting"
      title="批量编辑资产"
      ok-text="保存"
      cancel-text="取消"
      @ok="submitBatchEdit"
      @cancel="batchEditModalOpen = false"
    >
      <div style="margin-bottom: 12px; color: #666">未勾选的字段不会被修改；标签和系列支持清空。</div>
      <Form :label-col="{ span: 6 }" :wrapper-col="{ span: 16 }">
        <Form.Item label="分类">
          <Space align="start" style="width: 100%">
            <Checkbox v-model:checked="batchEditFormModel.applyCategory">修改</Checkbox>
            <Select
              v-model:value="batchEditFormModel.categoryId"
              :disabled="!batchEditFormModel.applyCategory"
              show-search
              option-filter-prop="label"
              :options="categoryOptions"
              placeholder="选择目标分类"
              style="flex: 1"
            />
          </Space>
        </Form.Item>
        <Form.Item label="系列">
          <Space align="start" style="width: 100%">
            <Checkbox v-model:checked="batchEditFormModel.applySeries">修改</Checkbox>
            <Select
              v-model:value="batchEditFormModel.seriesId"
              :disabled="!batchEditFormModel.applySeries"
              allow-clear
              show-search
              option-filter-prop="label"
              :options="seriesOptions"
              placeholder="选择系列，留空则清空"
              style="flex: 1"
            />
          </Space>
        </Form.Item>
        <Form.Item label="标签">
          <Space align="start" style="width: 100%">
            <Checkbox v-model:checked="batchEditFormModel.applyTags">修改</Checkbox>
            <Select
              v-model:value="batchEditFormModel.tagIds"
              :disabled="!batchEditFormModel.applyTags"
              mode="multiple"
              allow-clear
              show-search
              option-filter-prop="label"
              :options="tagOptions"
              placeholder="选择标签，留空则清空"
              style="flex: 1"
            />
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
