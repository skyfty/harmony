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

import { Button, Form, Input, message, Modal, Select, Space, Switch, Tooltip } from 'ant-design-vue';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons-vue';

interface CategoryFlatItem {
  ancestorIds: string[];
  children: CategoryFlatItem[];
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
const draggingCategoryId = ref<null | string>(null);
const draggingCategoryName = ref('');
const dragOverCategoryId = ref<null | string>(null);
const rootDropActive = ref(false);

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

function mapCategoryTree(
  nodes: ResourceCategoryItem[],
  prefix = '',
  ancestorIds: string[] = [],
): CategoryFlatItem[] {
  return nodes.map((node) => {
    const pathLabel = prefix ? `${prefix} / ${node.name}` : node.name;
    const nextAncestorIds = [...ancestorIds, node.id];
    const children = Array.isArray(node.children)
      ? mapCategoryTree(node.children, pathLabel, nextAncestorIds)
      : [];
    return {
      ancestorIds,
      children,
      createdAt: node.createdAt,
      depth: node.depth,
      description: node.description,
      hasChildren: node.hasChildren,
      id: node.id,
      name: node.name,
      parentId: node.parentId,
      pathLabel,
      updatedAt: node.updatedAt,
    };
  });
}

function flattenCategories(nodes: CategoryFlatItem[]): CategoryFlatItem[] {
  const rows: CategoryFlatItem[] = [];
  nodes.forEach((node) => {
    rows.push(node);
    if (Array.isArray(node.children) && node.children.length) {
      rows.push(...flattenCategories(node.children));
    }
  });
  return rows;
}

function normalizeTree(nodes: ResourceCategoryItem[]): ResourceCategoryItem[] {
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

const categoryTreeRows = computed(() => mapCategoryTree(categoryTree.value));
const categoryRows = computed(() => flattenCategories(categoryTreeRows.value));
const categoryRowMap = computed(() => {
  const map = new Map<string, CategoryFlatItem>();
  categoryRows.value.forEach((item) => map.set(item.id, item));
  return map;
});

function filterTreeWithAncestors(nodes: CategoryFlatItem[], keyword: string): CategoryFlatItem[] {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    return nodes;
  }
  return nodes
    .map((node) => {
      const children = filterTreeWithAncestors(node.children || [], normalizedKeyword);
      const name = node.name.toLowerCase();
      const path = node.pathLabel.toLowerCase();
      const desc = (node.description || '').toLowerCase();
      const matched =
        name.includes(normalizedKeyword) ||
        path.includes(normalizedKeyword) ||
        desc.includes(normalizedKeyword);
      if (!matched && children.length === 0) {
        return null;
      }
      return {
        ...node,
        children,
      };
    })
    .filter((item): item is CategoryFlatItem => Boolean(item));
}

const categorySelectOptions = computed(() => [
  { label: '根分类', value: 'root' },
  ...categoryRows.value.map((item) => ({ label: item.pathLabel, value: item.id })),
]);

const moveTargetOptions = computed(() => {
  const currentId = movingId.value;
  return categorySelectOptions.value.filter((item) => {
    if (item.value === 'root') {
      return true;
    }
    if (item.value === currentId) {
      return false;
    }
    const row = categoryRowMap.value.get(item.value);
    return row ? !row.ancestorIds.includes(currentId || '') : true;
  });
});

const mergeTargetOptions = computed(() => {
  const currentId = mergingSourceId.value;
  return categoryRows.value
    .filter((item) => item.id !== currentId && !item.ancestorIds.includes(currentId || ''))
    .map((item) => ({ label: item.pathLabel, value: item.id }));
});

const dragHintText = computed(() => {
  if (!draggingCategoryId.value) {
    return '拖拽“拖拽”按钮到任意行可设为其子分类，也可拖到此处移到根级';
  }
  if (dragOverCategoryId.value) {
    const target = categoryRowMap.value.get(dragOverCategoryId.value);
    if (target) {
      return `正在拖拽：${draggingCategoryName.value} → 将移动到“${target.name}”下`;
    }
  }
  return `正在拖拽：${draggingCategoryName.value}（拖到此处可移到根级）`;
});

function resetCategoryForm() {
  categoryFormModel.name = '';
  categoryFormModel.description = '';
  categoryFormModel.parentId = 'root';
}

async function loadCategories() {
  const list = await listResourceCategoriesApi();
  categoryTree.value = normalizeTree(list || []);
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

function clearDraggingState() {
  draggingCategoryId.value = null;
  draggingCategoryName.value = '';
  dragOverCategoryId.value = null;
  rootDropActive.value = false;
}

async function moveCategoryByDrag(sourceId: string, targetParentId: null | string) {
  if (submitting.value) {
    return;
  }
  submitting.value = true;
  try {
    await moveResourceCategoryApi(sourceId, targetParentId);
    message.success('分类移动成功');
    await loadCategories();
    categoryGridApi.reload();
  } finally {
    submitting.value = false;
    clearDraggingState();
  }
}

function handleDragStart(event: DragEvent, row: CategoryFlatItem) {
  draggingCategoryId.value = row.id;
  draggingCategoryName.value = row.name;
  event.dataTransfer?.setData('text/plain', row.id);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
}

function resolveDragSourceId(event: DragEvent): null | string {
  const sourceId = event.dataTransfer?.getData('text/plain') || draggingCategoryId.value;
  return sourceId || null;
}

function resolveDropTargetRow(target: EventTarget | null): CategoryFlatItem | null {
  if (!target || !(target instanceof HTMLElement)) {
    return null;
  }
  const rowElement = target.closest('tr[rowid], tr[data-rowid]');
  if (!rowElement) {
    return null;
  }
  const rowId = rowElement.getAttribute('rowid') || rowElement.getAttribute('data-rowid');
  if (!rowId) {
    return null;
  }
  return categoryRowMap.value.get(rowId) || null;
}

function handleGridDragOver(event: DragEvent) {
  if (!draggingCategoryId.value) {
    return;
  }
  event.preventDefault();
  const targetRow = resolveDropTargetRow(event.target);
  dragOverCategoryId.value = targetRow?.id || null;
}

function handleGridDragLeave(event: DragEvent) {
  if (!draggingCategoryId.value) {
    return;
  }
  const nextElement = event.relatedTarget;
  if (nextElement instanceof HTMLElement) {
    const stillInGrid = nextElement.closest('.resource-category-grid-shell');
    if (stillInGrid) {
      return;
    }
  }
  dragOverCategoryId.value = null;
}

async function handleGridDrop(event: DragEvent) {
  event.preventDefault();
  const targetRow = resolveDropTargetRow(event.target);
  if (!targetRow) {
    clearDraggingState();
    return;
  }
  await handleDropToCategory(event, targetRow);
}

async function handleDropToCategory(event: DragEvent, targetRow: CategoryFlatItem) {
  event.preventDefault();
  dragOverCategoryId.value = targetRow.id;
  const sourceId = resolveDragSourceId(event);
  if (!sourceId) {
    clearDraggingState();
    return;
  }
  if (sourceId === targetRow.id) {
    message.warning('不能移动到自身');
    clearDraggingState();
    return;
  }
  if (targetRow.ancestorIds.includes(sourceId)) {
    message.warning('不能移动到后代分类下');
    clearDraggingState();
    return;
  }
  const sourceRow = categoryRowMap.value.get(sourceId);
  if (!sourceRow) {
    clearDraggingState();
    return;
  }
  if (sourceRow.parentId === targetRow.id) {
    clearDraggingState();
    return;
  }
  await moveCategoryByDrag(sourceId, targetRow.id);
}

async function handleDropToRoot(event: DragEvent) {
  event.preventDefault();
  const sourceId = resolveDragSourceId(event);
  rootDropActive.value = false;
  if (!sourceId) {
    clearDraggingState();
    return;
  }
  const sourceRow = categoryRowMap.value.get(sourceId);
  if (!sourceRow) {
    clearDraggingState();
    return;
  }
  if (!sourceRow.parentId) {
    clearDraggingState();
    return;
  }
  await moveCategoryByDrag(sourceId, null);
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
      { field: 'name', minWidth: 220, title: '名称', treeNode: true },
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
    rowClassName: ({ row }: any) => {
      if (row?.id && row.id === dragOverCategoryId.value) {
        return 'resource-category-drag-target';
      }
      if (row?.id && row.id === draggingCategoryId.value) {
        return 'resource-category-drag-source';
      }
      return '';
    },
    rowConfig: {
      keyField: 'id',
    },
    proxyConfig: {
      ajax: {
        query: async (_params: any, formValues: Record<string, any>) => {
          const keyword = (formValues.keyword || '').trim();
          const all = categoryTreeRows.value;
          const filtered = filterTreeWithAncestors(all, keyword);
          return {
            items: filtered,
            total: flattenCategories(filtered).length,
          };
        },
      },
    },
    treeConfig: {
      children: 'children',
      expandAll: false,
      line: true,
    },
    toolbarConfig: {
      custom: true,
      refresh: true,
      search: true,
      zoom: true,
    },
  },
});

onMounted(async () => {
  await loadCategories();
});
</script>

<template>
  <div class="p-5">
    <div
      class="resource-category-grid-shell"
      @dragover="handleGridDragOver"
      @dragleave="handleGridDragLeave"
      @drop="handleGridDrop"
    >
      <CategoryGrid>
      <template #toolbar-actions>
        <Space>
          <Button v-access:code="'category:write'" type="primary" @click="openCreateModal">新增分类</Button>
          <div
            v-access:code="'category:write'"
            class="min-w-[340px] rounded border border-dashed px-3 py-1 text-xs"
            :class="rootDropActive ? 'border-primary text-primary' : 'border-gray-300 text-gray-500'"
            @dragover.prevent="rootDropActive = true"
            @dragleave="rootDropActive = false"
            @drop="handleDropToRoot"
          >
            {{ dragHintText }}
          </div>
        </Space>
      </template>

      <template #actions="{ row }">
        <Space>
          <Button
            v-access:code="'category:write'"
            type="link"
            size="small"
            draggable="true"
            @dragstart="(event: DragEvent) => handleDragStart(event, row)"
            @dragend="clearDraggingState"
          >
            拖拽
          </Button>
          <Tooltip title="编辑">
            <Button v-access:code="'category:write'" type="text" size="small" @click="openEditModal(row)">
              <EditOutlined />
            </Button>
          </Tooltip>
          <Button v-access:code="'category:write'" type="link" size="small" @click="openMoveModal(row)">移动</Button>
          <Button v-access:code="'category:write'" type="link" size="small" @click="openMergeModal(row)">合并</Button>
          <Tooltip title="删除">
            <Button v-access:code="'category:write'" danger type="text" size="small" @click="handleDelete(row)">
              <DeleteOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
      </CategoryGrid>
    </div>

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
          <Input.TextArea v-model:value="categoryFormModel.description" allow-clear placeholder="描述（可选）" rows="4" />
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

<style scoped>
:deep(.resource-category-drag-target > td) {
  background-color: var(--ant-color-primary-bg);
}

:deep(.resource-category-drag-source > td) {
  opacity: 0.6;
}
</style>
