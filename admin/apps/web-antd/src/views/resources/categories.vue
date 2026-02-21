<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';

import { computed, onMounted, reactive, ref } from 'vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createResourceCategoryApi,
  deleteResourceCategoryApi,
  listResourceCategoriesApi,
  mergeResourceCategoriesApi,
  moveResourceCategoryApi,
  updateResourceCategoryApi,
  type ResourceCategoryItem,
} from '#/api';

import { Button, Form, Input, message, Modal, Select, Space, Switch } from 'ant-design-vue';

interface CategoryFlatItem {
  createdAt: string;
  depth: number;
  description: null | string;
  hasChildren: boolean;
  id: string;
  name: string;
  parentId: null | string;
  pathLabel: string;
  updatedAt: string;
}

interface CategoryFormModel {
  description: string;
  name: string;
  parentId?: string;
}

interface MergeFormModel {
  moveChildren: boolean;
  targetCategoryId?: string;
}

const categoryTree = ref<ResourceCategoryItem[]>([]);

const categoryModalOpen = ref(false);
const movingModalOpen = ref(false);
const mergingModalOpen = ref(false);
const submitting = ref(false);

const editingId = ref<null | string>(null);
const movingId = ref<null | string>(null);
const mergingSourceId = ref<null | string>(null);

const categoryFormRef = ref<FormInstance>();
const moveFormRef = ref<FormInstance>();
const mergeFormRef = ref<FormInstance>();

const categoryFormModel = reactive<CategoryFormModel>({
  description: '',
  name: '',
  parentId: 'root',
});

const moveFormModel = reactive<{ targetParentId?: string }>({
  targetParentId: 'root',
});

const mergeFormModel = reactive<MergeFormModel>({
  moveChildren: true,
  targetCategoryId: undefined,
});

const categoryModalTitle = computed(() => (editingId.value ? '编辑分类' : '新增分类'));

function flattenCategories(nodes: ResourceCategoryItem[], prefix = ''): CategoryFlatItem[] {
  const rows: CategoryFlatItem[] = [];
  nodes.forEach((node) => {
    const pathLabel = prefix ? `${prefix} / ${node.name}` : node.name;
    rows.push({
      createdAt: node.createdAt,
      depth: node.depth,
      description: node.description,
      hasChildren: node.hasChildren,
      id: node.id,
      name: node.name,
      parentId: node.parentId,
      pathLabel,
      updatedAt: node.updatedAt,
    });
    if (Array.isArray(node.children) && node.children.length) {
      rows.push(...flattenCategories(node.children, pathLabel));
    }
  });
  return rows;
}

const categoryRows = computed(() => flattenCategories(categoryTree.value));

const categorySelectOptions = computed(() => [
  { label: '根分类', value: 'root' },
  ...categoryRows.value.map((item) => ({ label: item.pathLabel, value: item.id })),
]);

const moveTargetOptions = computed(() => {
  const currentId = movingId.value;
  return categorySelectOptions.value.filter((item) => item.value !== currentId);
});

const mergeTargetOptions = computed(() => {
  const currentId = mergingSourceId.value;
  return categoryRows.value
    .filter((item) => item.id !== currentId)
    .map((item) => ({ label: item.pathLabel, value: item.id }));
});

function resetCategoryForm() {
  categoryFormModel.name = '';
  categoryFormModel.description = '';
  categoryFormModel.parentId = 'root';
}

async function loadCategories() {
  categoryTree.value = await listResourceCategoriesApi();
}

function openCreateModal() {
  editingId.value = null;
  resetCategoryForm();
  categoryModalOpen.value = true;
}

function openEditModal(row: CategoryFlatItem) {
  editingId.value = row.id;
  categoryFormModel.name = row.name;
  categoryFormModel.description = row.description || '';
  categoryFormModel.parentId = row.parentId || 'root';
  categoryModalOpen.value = true;
}

function openMoveModal(row: CategoryFlatItem) {
  movingId.value = row.id;
  moveFormModel.targetParentId = row.parentId || 'root';
  movingModalOpen.value = true;
}

function openMergeModal(row: CategoryFlatItem) {
  mergingSourceId.value = row.id;
  mergeFormModel.targetCategoryId = undefined;
  mergeFormModel.moveChildren = true;
  mergingModalOpen.value = true;
}

async function submitCategory() {
  const form = categoryFormRef.value;
  if (!form) {
    return;
  }
  await form.validate();

  submitting.value = true;
  try {
    const payload = {
      description: categoryFormModel.description.trim() || undefined,
      name: categoryFormModel.name.trim(),
      parentId:
        categoryFormModel.parentId && categoryFormModel.parentId !== 'root'
          ? categoryFormModel.parentId
          : null,
    };

    if (editingId.value) {
      await updateResourceCategoryApi(editingId.value, {
        description: payload.description || null,
        name: payload.name,
      });
      message.success('分类更新成功');
    } else {
      await createResourceCategoryApi(payload);
      message.success('分类创建成功');
    }

    categoryModalOpen.value = false;
    await loadCategories();
    categoryGridApi.reload();
  } finally {
    submitting.value = false;
  }
}

async function submitMove() {
  const form = moveFormRef.value;
  if (!form) {
    return;
  }
  await form.validate();
  if (!movingId.value) {
    return;
  }

  submitting.value = true;
  try {
    const targetParentId =
      moveFormModel.targetParentId && moveFormModel.targetParentId !== 'root'
        ? moveFormModel.targetParentId
        : null;
    await moveResourceCategoryApi(movingId.value, targetParentId);
    message.success('分类移动成功');
    movingModalOpen.value = false;
    await loadCategories();
    categoryGridApi.reload();
  } finally {
    submitting.value = false;
  }
}

async function submitMerge() {
  const form = mergeFormRef.value;
  if (!form) {
    return;
  }
  await form.validate();
  if (!mergingSourceId.value || !mergeFormModel.targetCategoryId) {
    return;
  }

  submitting.value = true;
  try {
    await mergeResourceCategoriesApi({
      moveChildren: mergeFormModel.moveChildren,
      sourceCategoryId: mergingSourceId.value,
      targetCategoryId: mergeFormModel.targetCategoryId,
    });
    message.success('分类合并成功');
    mergingModalOpen.value = false;
    await loadCategories();
    categoryGridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: CategoryFlatItem) {
  Modal.confirm({
    title: `确认删除分类 “${row.name}” 吗？`,
    content: '删除前请确保该分类下没有子分类和资产。',
    okType: 'danger',
    onOk: async () => {
      await deleteResourceCategoryApi(row.id);
      message.success('分类已删除');
      await loadCategories();
      categoryGridApi.reload();
    },
  });
}

const [CategoryGrid, categoryGridApi] = useVbenVxeGrid<CategoryFlatItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键字',
        componentProps: {
          allowClear: true,
          placeholder: '分类名称/路径',
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 160, title: '名称' },
      { field: 'pathLabel', minWidth: 280, title: '路径' },
      { field: 'depth', minWidth: 90, title: '层级' },
      { field: 'description', minWidth: 180, title: '描述' },
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
      enabled: false,
    },
    proxyConfig: {
      ajax: {
        query: async (_params: any, formValues: Record<string, any>) => {
          const keyword = (formValues.keyword || '').trim().toLowerCase();
          const all = categoryRows.value;
          const filtered = !keyword
            ? all
            : all.filter((item) => {
                const name = item.name.toLowerCase();
                const path = item.pathLabel.toLowerCase();
                const desc = (item.description || '').toLowerCase();
                return name.includes(keyword) || path.includes(keyword) || desc.includes(keyword);
              });
          return {
            items: filtered,
            total: filtered.length,
          };
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
  tableTitle: '资源分类管理',
});

onMounted(async () => {
  await loadCategories();
});
</script>

<template>
  <div class="p-5">
    <CategoryGrid>
      <template #toolbar-actions>
        <Button v-access:code="'category:write'" type="primary" @click="openCreateModal">新增分类</Button>
      </template>

      <template #actions="{ row }">
        <Space>
          <Button v-access:code="'category:write'" type="link" size="small" @click="openEditModal(row)">编辑</Button>
          <Button v-access:code="'category:write'" type="link" size="small" @click="openMoveModal(row)">移动</Button>
          <Button v-access:code="'category:write'" type="link" size="small" @click="openMergeModal(row)">合并</Button>
          <Button v-access:code="'category:write'" danger type="link" size="small" @click="handleDelete(row)">删除</Button>
        </Space>
      </template>
    </CategoryGrid>

    <Modal
      :open="categoryModalOpen"
      :title="categoryModalTitle"
      :confirm-loading="submitting"
      ok-text="保存"
      cancel-text="取消"
      destroy-on-close
      @cancel="() => (categoryModalOpen = false)"
      @ok="submitCategory"
    >
      <Form ref="categoryFormRef" :model="categoryFormModel" :label-col="{ span: 5 }" :wrapper-col="{ span: 18 }">
        <Form.Item label="名称" name="name" :rules="[{ required: true, message: '请输入分类名称' }]">
          <Input v-model:value="categoryFormModel.name" allow-clear placeholder="分类名称" />
        </Form.Item>
        <Form.Item v-if="!editingId" label="父分类" name="parentId">
          <Select
            v-model:value="categoryFormModel.parentId"
            allow-clear
            show-search
            option-filter-prop="label"
            :options="categorySelectOptions"
            placeholder="默认根分类"
          />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input v-model:value="categoryFormModel.description" allow-clear placeholder="描述（可选）" />
        </Form.Item>
      </Form>
    </Modal>

    <Modal
      :open="movingModalOpen"
      title="移动分类"
      :confirm-loading="submitting"
      ok-text="移动"
      cancel-text="取消"
      destroy-on-close
      @cancel="() => (movingModalOpen = false)"
      @ok="submitMove"
    >
      <Form ref="moveFormRef" :model="moveFormModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 16 }">
        <Form.Item label="目标父分类" name="targetParentId" :rules="[{ required: true, message: '请选择目标父分类' }]">
          <Select
            v-model:value="moveFormModel.targetParentId"
            show-search
            option-filter-prop="label"
            :options="moveTargetOptions"
            placeholder="选择目标父分类"
          />
        </Form.Item>
      </Form>
    </Modal>

    <Modal
      :open="mergingModalOpen"
      title="合并分类"
      :confirm-loading="submitting"
      ok-text="合并"
      cancel-text="取消"
      destroy-on-close
      @cancel="() => (mergingModalOpen = false)"
      @ok="submitMerge"
    >
      <Form ref="mergeFormRef" :model="mergeFormModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 16 }">
        <Form.Item label="目标分类" name="targetCategoryId" :rules="[{ required: true, message: '请选择目标分类' }]">
          <Select
            v-model:value="mergeFormModel.targetCategoryId"
            show-search
            option-filter-prop="label"
            :options="mergeTargetOptions"
            placeholder="选择目标分类"
          />
        </Form.Item>
        <Form.Item label="迁移子分类" name="moveChildren">
          <Switch v-model:checked="mergeFormModel.moveChildren" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
