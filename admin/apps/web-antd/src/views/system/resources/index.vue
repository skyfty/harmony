<script setup lang="ts">
import type { FormInstance, UploadFile, UploadProps } from 'ant-design-vue';
import type {
  ResourceAssetItem,
  ResourceCategoryItem,
  ResourceSeriesItem,
  ResourceTagItem,
} from '#/api';

import { computed, onMounted, reactive, ref } from 'vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  buildResourceDownloadUrl,
  bulkMoveResourceAssetsApi,
  createResourceAssetApi,
  createResourceCategoryApi,
  deleteResourceAssetApi,
  deleteResourceCategoryApi,
  listResourceAssetsApi,
  listResourceCategoriesApi,
  listResourceSeriesApi,
  listResourceTagsApi,
  mergeResourceCategoriesApi,
  moveResourceCategoryApi,
  updateResourceAssetApi,
  updateResourceCategoryApi,
} from '#/api';

import {
  Button,
  Card,
  Form,
  Input,
  message,
  Modal,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Tree,
  Upload,
} from 'ant-design-vue';

interface AssetFormModel {
  categoryId: string;
  description: string;
  name: string;
  seriesId?: string;
  tagIds: string[];
  type: string;
}

interface CategoryFormModel {
  description: string;
  name: string;
  parentId?: string;
}

interface MoveCategoryFormModel {
  targetParentId?: string;
}

interface MergeCategoryFormModel {
  moveChildren: boolean;
  targetCategoryId?: string;
}

interface BulkMoveCategoryAssetsFormModel {
  includeDescendants: boolean;
  targetCategoryId?: string;
}

const activeTab = ref('assets');
const categories = ref<ResourceCategoryItem[]>([]);
const tags = ref<ResourceTagItem[]>([]);
const seriesList = ref<ResourceSeriesItem[]>([]);
const selectedCategoryId = ref<null | string>(null);

const assetModalOpen = ref(false);
const assetSubmitting = ref(false);
const editingAssetId = ref<null | string>(null);
const assetFormRef = ref<FormInstance>();
const assetFileList = ref<UploadFile[]>([]);
const thumbnailFileList = ref<UploadFile[]>([]);

const categoryModalOpen = ref(false);
const categorySubmitting = ref(false);
const editingCategoryId = ref<null | string>(null);
const categoryFormRef = ref<FormInstance>();

const moveCategoryModalOpen = ref(false);
const movingCategory = ref(false);
const moveCategoryFormRef = ref<FormInstance>();

const mergeCategoryModalOpen = ref(false);
const mergingCategory = ref(false);
const mergeCategoryFormRef = ref<FormInstance>();

const bulkMoveModalOpen = ref(false);
const bulkMoving = ref(false);
const bulkMoveFormRef = ref<FormInstance>();

const assetFormModel = reactive<AssetFormModel>({
  categoryId: '',
  description: '',
  name: '',
  seriesId: undefined,
  tagIds: [],
  type: 'file',
});

const categoryFormModel = reactive<CategoryFormModel>({
  description: '',
  name: '',
  parentId: undefined,
});

const moveCategoryFormModel = reactive<MoveCategoryFormModel>({
  targetParentId: undefined,
});

const mergeCategoryFormModel = reactive<MergeCategoryFormModel>({
  moveChildren: true,
  targetCategoryId: undefined,
});

const bulkMoveFormModel = reactive<BulkMoveCategoryAssetsFormModel>({
  includeDescendants: true,
  targetCategoryId: undefined,
});

const categoryOptions = computed(() => {
  const options: Array<{ label: string; value: string }> = [];

  const walk = (nodes: ResourceCategoryItem[], prefix: string[] = []) => {
    nodes.forEach((node) => {
      const currentPath = [...prefix, node.name];
      options.push({
        label: currentPath.join(' / '),
        value: node.id,
      });
      if (node.children?.length) {
        walk(node.children, currentPath);
      }
    });
  };

  walk(categories.value);
  return options;
});

const categoryTreeData = computed(() => {
  const toNode = (node: ResourceCategoryItem): any => ({
    title: node.name,
    key: node.id,
    children: node.children?.map(toNode),
  });

  return categories.value.map(toNode);
});

const tagOptions = computed(() =>
  tags.value.map((item) => ({
    label: item.name,
    value: item.id,
  })),
);

const seriesOptions = computed(() =>
  seriesList.value.map((item) => ({
    label: item.name,
    value: item.id,
  })),
);

const selectedCategory = computed(() => {
  if (!selectedCategoryId.value) {
    return null;
  }

  const stack = [...categories.value];
  while (stack.length) {
    const current = stack.shift();
    if (!current) {
      continue;
    }
    if (current.id === selectedCategoryId.value) {
      return current;
    }
    if (current.children?.length) {
      stack.push(...current.children);
    }
  }
  return null;
});

const assetModalTitle = computed(() =>
  editingAssetId.value ? '编辑资源' : '上传资源',
);

const categoryModalTitle = computed(() =>
  editingCategoryId.value ? '编辑分类' : '新建分类',
);

const ASSET_TYPE_OPTIONS = [
  { label: '模型', value: 'model' },
  { label: '图片', value: 'image' },
  { label: '纹理', value: 'texture' },
  { label: '材质', value: 'material' },
  { label: '预制体', value: 'prefab' },
  { label: '视频', value: 'video' },
  { label: '网格', value: 'mesh' },
  { label: '文件', value: 'file' },
];

async function loadReferenceData() {
  const [categoryResponse, tagResponse, seriesResponse] = await Promise.all([
    listResourceCategoriesApi(),
    listResourceTagsApi(),
    listResourceSeriesApi(),
  ]);
  categories.value = categoryResponse || [];
  tags.value = tagResponse || [];
  seriesList.value = seriesResponse || [];
}

function resetAssetForm() {
  assetFormModel.name = '';
  assetFormModel.type = 'file';
  assetFormModel.categoryId = selectedCategoryId.value || categoryOptions.value[0]?.value || '';
  assetFormModel.description = '';
  assetFormModel.tagIds = [];
  assetFormModel.seriesId = undefined;
  assetFileList.value = [];
  thumbnailFileList.value = [];
}

function resetCategoryForm() {
  categoryFormModel.name = '';
  categoryFormModel.description = '';
  categoryFormModel.parentId = selectedCategoryId.value || undefined;
}

function openCreateAssetModal() {
  editingAssetId.value = null;
  resetAssetForm();
  assetModalOpen.value = true;
}

function openEditAssetModal(record: ResourceAssetItem) {
  editingAssetId.value = record.id;
  assetFormModel.name = record.name;
  assetFormModel.type = record.type;
  assetFormModel.categoryId = record.categoryId;
  assetFormModel.description = record.description || '';
  assetFormModel.tagIds = record.tagIds || [];
  assetFormModel.seriesId = record.seriesId || undefined;
  assetFileList.value = [];
  thumbnailFileList.value = [];
  assetModalOpen.value = true;
}

function openCreateCategoryModal() {
  editingCategoryId.value = null;
  resetCategoryForm();
  categoryModalOpen.value = true;
}

function openEditCategoryModal() {
  if (!selectedCategory.value) {
    message.warning('请先选择分类');
    return;
  }
  editingCategoryId.value = selectedCategory.value.id;
  categoryFormModel.name = selectedCategory.value.name;
  categoryFormModel.description = selectedCategory.value.description || '';
  categoryFormModel.parentId = selectedCategory.value.parentId || undefined;
  categoryModalOpen.value = true;
}

function openMoveCategoryModal() {
  if (!selectedCategory.value) {
    message.warning('请先选择分类');
    return;
  }
  moveCategoryFormModel.targetParentId = undefined;
  moveCategoryModalOpen.value = true;
}

function openMergeCategoryModal() {
  if (!selectedCategory.value) {
    message.warning('请先选择源分类');
    return;
  }
  mergeCategoryFormModel.targetCategoryId = undefined;
  mergeCategoryFormModel.moveChildren = true;
  mergeCategoryModalOpen.value = true;
}

function openBulkMoveModal() {
  if (!selectedCategory.value) {
    message.warning('请先选择源分类');
    return;
  }
  bulkMoveFormModel.includeDescendants = true;
  bulkMoveFormModel.targetCategoryId = undefined;
  bulkMoveModalOpen.value = true;
}

const beforeAssetUpload: UploadProps['beforeUpload'] = (file) => {
  assetFileList.value = [
    {
      uid: file.uid,
      name: file.name,
      status: 'done',
      originFileObj: file,
    },
  ];
  return false;
};

const beforeThumbnailUpload: UploadProps['beforeUpload'] = (file) => {
  thumbnailFileList.value = [
    {
      uid: file.uid,
      name: file.name,
      status: 'done',
      originFileObj: file,
    },
  ];
  return false;
};

async function submitAsset() {
  const form = assetFormRef.value;
  if (!form) {
    return;
  }
  await form.validate();

  if (!editingAssetId.value && assetFileList.value.length === 0) {
    message.warning('请上传资源文件');
    return;
  }

  const formData = new FormData();
  formData.append('name', assetFormModel.name.trim());
  formData.append('type', assetFormModel.type);
  formData.append('categoryId', assetFormModel.categoryId);
  formData.append('description', assetFormModel.description || '');
  formData.append('tagIds', JSON.stringify(assetFormModel.tagIds || []));
  formData.append('seriesId', assetFormModel.seriesId || '');

  const assetFile = assetFileList.value[0]?.originFileObj as File | undefined;
  if (assetFile) {
    formData.append('file', assetFile);
  }

  const thumbFile = thumbnailFileList.value[0]?.originFileObj as File | undefined;
  if (thumbFile) {
    formData.append('thumbnail', thumbFile);
  }

  assetSubmitting.value = true;
  try {
    if (editingAssetId.value) {
      await updateResourceAssetApi(editingAssetId.value, formData);
      message.success('资源更新成功');
    } else {
      await createResourceAssetApi(formData);
      message.success('资源上传成功');
    }
    assetModalOpen.value = false;
    assetGridApi.reload();
  } finally {
    assetSubmitting.value = false;
  }
}

function confirmDeleteAsset(record: ResourceAssetItem) {
  Modal.confirm({
    title: `确认删除资源“${record.name}”吗？`,
    content: '删除后不可恢复。',
    okType: 'danger',
    onOk: async () => {
      await deleteResourceAssetApi(record.id);
      message.success('资源删除成功');
      assetGridApi.reload();
    },
  });
}

function handleDownloadAsset(record: ResourceAssetItem) {
  window.open(buildResourceDownloadUrl(record.id), '_blank');
}

async function submitCategory() {
  const form = categoryFormRef.value;
  if (!form) {
    return;
  }
  await form.validate();
  categorySubmitting.value = true;
  try {
    if (editingCategoryId.value) {
      await updateResourceCategoryApi(editingCategoryId.value, {
        description: categoryFormModel.description || null,
        name: categoryFormModel.name.trim(),
      });
      message.success('分类更新成功');
    } else {
      await createResourceCategoryApi({
        name: categoryFormModel.name.trim(),
        description: categoryFormModel.description || undefined,
        parentId: categoryFormModel.parentId,
      });
      message.success('分类创建成功');
    }
    categoryModalOpen.value = false;
    await loadReferenceData();
    assetGridApi.reload();
  } finally {
    categorySubmitting.value = false;
  }
}

function confirmDeleteCategory() {
  if (!selectedCategory.value) {
    message.warning('请先选择分类');
    return;
  }
  Modal.confirm({
    title: `确认删除分类“${selectedCategory.value.name}”吗？`,
    content: '当分类存在子分类或资源时将无法删除。',
    okType: 'danger',
    onOk: async () => {
      await deleteResourceCategoryApi(selectedCategory.value!.id);
      message.success('分类删除成功');
      selectedCategoryId.value = null;
      await loadReferenceData();
      assetGridApi.reload();
    },
  });
}

async function submitMoveCategory() {
  const source = selectedCategory.value;
  const form = moveCategoryFormRef.value;
  if (!source || !form) {
    return;
  }
  await form.validate();
  movingCategory.value = true;
  try {
    await moveResourceCategoryApi(source.id, moveCategoryFormModel.targetParentId ?? null);
    message.success('分类移动成功');
    moveCategoryModalOpen.value = false;
    await loadReferenceData();
    selectedCategoryId.value = source.id;
    assetGridApi.reload();
  } finally {
    movingCategory.value = false;
  }
}

async function submitMergeCategory() {
  const source = selectedCategory.value;
  const form = mergeCategoryFormRef.value;
  if (!source || !form) {
    return;
  }
  await form.validate();
  if (!mergeCategoryFormModel.targetCategoryId) {
    message.warning('请选择目标分类');
    return;
  }
  mergingCategory.value = true;
  try {
    const result = await mergeResourceCategoriesApi({
      sourceCategoryId: source.id,
      targetCategoryId: mergeCategoryFormModel.targetCategoryId,
      moveChildren: mergeCategoryFormModel.moveChildren,
    });
    message.success(
      `分类合并完成：迁移资源 ${result.movedAssetCount} 个，迁移子分类 ${result.movedChildCount} 个`,
    );
    mergeCategoryModalOpen.value = false;
    selectedCategoryId.value = mergeCategoryFormModel.targetCategoryId;
    await loadReferenceData();
    assetGridApi.reload();
  } finally {
    mergingCategory.value = false;
  }
}

async function submitBulkMove() {
  const source = selectedCategory.value;
  const form = bulkMoveFormRef.value;
  if (!source || !form) {
    return;
  }
  await form.validate();
  if (!bulkMoveFormModel.targetCategoryId) {
    message.warning('请选择目标分类');
    return;
  }
  bulkMoving.value = true;
  try {
    const result = await bulkMoveResourceAssetsApi({
      fromCategoryId: source.id,
      includeDescendants: bulkMoveFormModel.includeDescendants,
      targetCategoryId: bulkMoveFormModel.targetCategoryId,
    });
    message.success(`迁移完成：影响 ${result.modifiedCount} 个资源`);
    bulkMoveModalOpen.value = false;
    assetGridApi.reload();
  } finally {
    bulkMoving.value = false;
  }
}

const [AssetGrid, assetGridApi] = useVbenVxeGrid<ResourceAssetItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键字',
        componentProps: {
          allowClear: true,
          placeholder: '名称 / 描述',
        },
      },
      {
        component: 'Select',
        fieldName: 'types',
        label: '类型',
        componentProps: {
          allowClear: true,
          mode: 'multiple',
          options: ASSET_TYPE_OPTIONS,
          placeholder: '全部类型',
        },
      },
      {
        component: 'Select',
        fieldName: 'categoryId',
        label: '分类',
        componentProps: {
          allowClear: true,
          options: categoryOptions,
          placeholder: '全部分类',
          showSearch: true,
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 200, title: '资源名称' },
      { field: 'type', minWidth: 120, title: '类型', slots: { default: 'type' } },
      { field: 'categoryPathString', minWidth: 240, title: '分类路径' },
      { field: 'size', minWidth: 120, title: '文件大小(Byte)' },
      { field: 'updatedAt', minWidth: 180, formatter: 'formatDateTime', title: '更新时间' },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 260,
        slots: { default: 'actions' },
        title: '操作',
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
          return listResourceAssetsApi({
            categoryId: formValues.categoryId || undefined,
            keyword: formValues.keyword || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
            types: formValues.types?.length ? formValues.types : undefined,
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
  tableTitle: '资源管理',
});

function handleSelectCategory(keys: (number | string)[]) {
  const key = keys[0];
  selectedCategoryId.value = typeof key === 'string' ? key : null;
}

onMounted(async () => {
  await loadReferenceData();
});
</script>

<template>
  <div class="p-5">
    <Tabs v-model:active-key="activeTab">
      <Tabs.TabPane key="assets" tab="资源管理">
        <AssetGrid>
          <template #toolbar-actions>
            <Button v-access:code="'resource:write'" type="primary" @click="openCreateAssetModal">
              上传资源
            </Button>
          </template>

          <template #type="{ row }">
            <Tag color="blue">
              {{ row.type }}
            </Tag>
          </template>

          <template #actions="{ row }">
            <Space>
              <Button v-access:code="'resource:write'" size="small" type="link" @click="openEditAssetModal(row)">
                编辑/替换
              </Button>
              <Button size="small" type="link" @click="handleDownloadAsset(row)">
                下载
              </Button>
              <Button v-access:code="'resource:write'" danger size="small" type="link" @click="confirmDeleteAsset(row)">
                删除
              </Button>
            </Space>
          </template>
        </AssetGrid>
      </Tabs.TabPane>

      <Tabs.TabPane key="categories" tab="分类管理">
        <div class="grid grid-cols-12 gap-4">
          <Card class="col-span-5" title="分类树">
            <template #extra>
              <Space>
                <Button v-access:code="'category:write'" size="small" type="primary" @click="openCreateCategoryModal">
                  新建
                </Button>
                <Button v-access:code="'category:write'" size="small" @click="openEditCategoryModal">
                  编辑
                </Button>
                <Button v-access:code="'category:write'" size="small" @click="openMoveCategoryModal">
                  移动
                </Button>
                <Button v-access:code="'category:write'" size="small" @click="openMergeCategoryModal">
                  合并
                </Button>
                <Button v-access:code="'category:write'" danger size="small" @click="confirmDeleteCategory">
                  删除
                </Button>
              </Space>
            </template>

            <Tree
              :selected-keys="selectedCategoryId ? [selectedCategoryId] : []"
              :tree-data="categoryTreeData"
              show-line
              @select="handleSelectCategory"
            />
          </Card>

          <Card class="col-span-7" title="分类详情与批量操作">
            <template v-if="selectedCategory">
              <div class="mb-2 text-base font-medium">{{ selectedCategory.name }}</div>
              <div class="mb-2 text-text-secondary">
                路径：{{ selectedCategory.path?.map((item) => item.name).join(' / ') }}
              </div>
              <div class="mb-4 text-text-secondary">
                描述：{{ selectedCategory.description || '-' }}
              </div>
              <Space>
                <Button v-access:code="'resource:write'" type="primary" @click="openBulkMoveModal">
                  批量迁移该分类资源
                </Button>
              </Space>
            </template>
            <template v-else>
              <div class="text-text-secondary">请选择左侧分类节点</div>
            </template>
          </Card>
        </div>
      </Tabs.TabPane>
    </Tabs>

    <Modal
      :confirm-loading="assetSubmitting"
      :open="assetModalOpen"
      :title="assetModalTitle"
      destroy-on-close
      ok-text="保存"
      cancel-text="取消"
      @cancel="assetModalOpen = false"
      @ok="submitAsset"
    >
      <Form
        ref="assetFormRef"
        :label-col="{ span: 6 }"
        :model="assetFormModel"
        :rules="{
          name: [{ required: true, message: '请输入资源名称', trigger: 'blur' }],
          type: [{ required: true, message: '请选择资源类型', trigger: 'change' }],
          categoryId: [{ required: true, message: '请选择分类', trigger: 'change' }],
        }"
        :wrapper-col="{ span: 17 }"
      >
        <Form.Item label="资源名称" name="name">
          <Input v-model:value="assetFormModel.name" allow-clear placeholder="请输入资源名称" />
        </Form.Item>
        <Form.Item label="资源类型" name="type">
          <Select v-model:value="assetFormModel.type" :options="ASSET_TYPE_OPTIONS" />
        </Form.Item>
        <Form.Item label="资源分类" name="categoryId">
          <Select
            v-model:value="assetFormModel.categoryId"
            :options="categoryOptions"
            allow-clear
            show-search
            placeholder="请选择分类"
          />
        </Form.Item>
        <Form.Item label="标签" name="tagIds">
          <Select
            v-model:value="assetFormModel.tagIds"
            :options="tagOptions"
            allow-clear
            mode="multiple"
            placeholder="可选"
          />
        </Form.Item>
        <Form.Item label="系列" name="seriesId">
          <Select
            v-model:value="assetFormModel.seriesId"
            :options="seriesOptions"
            allow-clear
            placeholder="可选"
          />
        </Form.Item>
        <Form.Item label="资源文件">
          <Upload
            :before-upload="beforeAssetUpload"
            :file-list="assetFileList"
            :max-count="1"
            @remove="() => { assetFileList = []; }"
          >
            <Button>
              {{ editingAssetId ? '选择替换文件(可选)' : '选择文件' }}
            </Button>
          </Upload>
        </Form.Item>
        <Form.Item label="缩略图">
          <Upload
            :before-upload="beforeThumbnailUpload"
            :file-list="thumbnailFileList"
            :max-count="1"
            @remove="() => { thumbnailFileList = []; }"
          >
            <Button>选择缩略图(可选)</Button>
          </Upload>
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input.TextArea
            v-model:value="assetFormModel.description"
            :rows="3"
            allow-clear
            placeholder="请输入描述"
          />
        </Form.Item>
      </Form>
    </Modal>

    <Modal
      :confirm-loading="categorySubmitting"
      :open="categoryModalOpen"
      :title="categoryModalTitle"
      destroy-on-close
      ok-text="保存"
      cancel-text="取消"
      @cancel="categoryModalOpen = false"
      @ok="submitCategory"
    >
      <Form
        ref="categoryFormRef"
        :label-col="{ span: 6 }"
        :model="categoryFormModel"
        :rules="{
          name: [{ required: true, message: '请输入分类名称', trigger: 'blur' }],
        }"
        :wrapper-col="{ span: 17 }"
      >
        <Form.Item label="分类名称" name="name">
          <Input v-model:value="categoryFormModel.name" allow-clear placeholder="请输入分类名称" />
        </Form.Item>
        <Form.Item v-if="!editingCategoryId" label="父级分类" name="parentId">
          <Select
            v-model:value="categoryFormModel.parentId"
            :options="categoryOptions"
            allow-clear
            show-search
            placeholder="留空为根节点"
          />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input.TextArea
            v-model:value="categoryFormModel.description"
            :rows="3"
            allow-clear
            placeholder="请输入描述"
          />
        </Form.Item>
      </Form>
    </Modal>

    <Modal
      :confirm-loading="movingCategory"
      :open="moveCategoryModalOpen"
      title="移动分类"
      ok-text="确认移动"
      cancel-text="取消"
      @cancel="moveCategoryModalOpen = false"
      @ok="submitMoveCategory"
    >
      <Form
        ref="moveCategoryFormRef"
        :label-col="{ span: 7 }"
        :model="moveCategoryFormModel"
        :rules="{
          targetParentId: [{ required: true, message: '请选择目标父分类', trigger: 'change' }],
        }"
        :wrapper-col="{ span: 16 }"
      >
        <Form.Item label="目标父分类" name="targetParentId">
          <Select
            v-model:value="moveCategoryFormModel.targetParentId"
            :options="categoryOptions.filter((item) => item.value !== selectedCategoryId)"
            show-search
            placeholder="请选择目标父分类"
          />
        </Form.Item>
      </Form>
    </Modal>

    <Modal
      :confirm-loading="mergingCategory"
      :open="mergeCategoryModalOpen"
      title="合并分类"
      ok-text="确认合并"
      cancel-text="取消"
      @cancel="mergeCategoryModalOpen = false"
      @ok="submitMergeCategory"
    >
      <Form
        ref="mergeCategoryFormRef"
        :label-col="{ span: 7 }"
        :model="mergeCategoryFormModel"
        :rules="{
          targetCategoryId: [{ required: true, message: '请选择目标分类', trigger: 'change' }],
        }"
        :wrapper-col="{ span: 16 }"
      >
        <Form.Item label="目标分类" name="targetCategoryId">
          <Select
            v-model:value="mergeCategoryFormModel.targetCategoryId"
            :options="categoryOptions.filter((item) => item.value !== selectedCategoryId)"
            show-search
            placeholder="请选择目标分类"
          />
        </Form.Item>
        <Form.Item label="迁移子分类" name="moveChildren">
          <Switch v-model:checked="mergeCategoryFormModel.moveChildren" />
        </Form.Item>
      </Form>
    </Modal>

    <Modal
      :confirm-loading="bulkMoving"
      :open="bulkMoveModalOpen"
      title="批量迁移分类资源"
      ok-text="确认迁移"
      cancel-text="取消"
      @cancel="bulkMoveModalOpen = false"
      @ok="submitBulkMove"
    >
      <Form
        ref="bulkMoveFormRef"
        :label-col="{ span: 7 }"
        :model="bulkMoveFormModel"
        :rules="{
          targetCategoryId: [{ required: true, message: '请选择目标分类', trigger: 'change' }],
        }"
        :wrapper-col="{ span: 16 }"
      >
        <Form.Item label="目标分类" name="targetCategoryId">
          <Select
            v-model:value="bulkMoveFormModel.targetCategoryId"
            :options="categoryOptions.filter((item) => item.value !== selectedCategoryId)"
            show-search
            placeholder="请选择目标分类"
          />
        </Form.Item>
        <Form.Item label="包含子分类" name="includeDescendants">
          <Switch v-model:checked="bulkMoveFormModel.includeDescendants" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
