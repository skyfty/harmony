<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import type { SceneSpotCategoryItem } from '#/api';

import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createSceneSpotCategoryApi,
  deleteSceneSpotCategoryApi,
  listSceneSpotCategoriesApi,
  updateSceneSpotCategoryApi,
} from '#/api';

import { Button, Form, Input, InputNumber, message, Modal, Space, Switch, TreeSelect, Tooltip } from 'ant-design-vue';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons-vue';

interface CategoryTreeRow extends SceneSpotCategoryItem {
  ancestorIds: string[];
  children?: CategoryTreeRow[];
  depth: number;
  pathLabel: string;
}

interface CategoryTreeSelectNode {
  children?: CategoryTreeSelectNode[];
  key: string;
  title: string;
  value: string;
}

interface CategoryFormModel {
  description: string;
  enabled: boolean;
  name: string;
  parentId: string;
  sortOrder: number;
  slug: string;
}

const { t } = useI18n();

const categoryList = ref<SceneSpotCategoryItem[]>([]);
const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<null | string>(null);
const formRef = ref<FormInstance>();

const formModel = reactive<CategoryFormModel>({
  name: '',
  description: '',
  sortOrder: 0,
  enabled: true,
  slug: '',
  parentId: 'root',
});

const modalTitle = computed(() =>
  editingId.value ? t('page.sceneSpotCategories.modal.edit') : t('page.sceneSpotCategories.modal.create'),
);

function normalizeCategories(items: SceneSpotCategoryItem[]): Array<SceneSpotCategoryItem & { parentId: null | string }> {
  const idSet = new Set(items.map((item) => item.id));
  return items.map((item) => ({
    ...item,
    parentId: item.parentId && item.parentId !== item.id && idSet.has(item.parentId) ? item.parentId : null,
  }));
}

function sortCategories(items: SceneSpotCategoryItem[]) {
  return items.slice().sort((left, right) => {
    const sortDelta = Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0);
    if (sortDelta !== 0) return sortDelta;
    return String(left.name).localeCompare(String(right.name), 'zh-Hans-CN');
  });
}

function buildCategoryTree(items: SceneSpotCategoryItem[]): CategoryTreeRow[] {
  const normalizedItems = normalizeCategories(items);
  const byParent = new Map<null | string, Array<SceneSpotCategoryItem & { parentId: null | string }>>();

  normalizedItems.forEach((item) => {
    const bucket = byParent.get(item.parentId) ?? [];
    bucket.push(item);
    byParent.set(item.parentId, bucket);
  });

  const build = (parentId: null | string, ancestors: string[] = [], prefix = ''): CategoryTreeRow[] =>
    sortCategories(byParent.get(parentId) ?? [])
      .map((item): CategoryTreeRow | null => {
        if (ancestors.includes(item.id)) {
          return null;
        }

        const pathLabel = prefix ? `${prefix} / ${item.name}` : item.name;
        const nextAncestors = [...ancestors, item.id];
        const children = build(item.id, nextAncestors, pathLabel);

        return {
          ...item,
          ancestorIds: ancestors,
          children,
          depth: ancestors.length,
          pathLabel,
        };
      })
      .filter((item): item is CategoryTreeRow => item !== null);

  return build(null);
}

function flattenCategoryTree(nodes: CategoryTreeRow[]): CategoryTreeRow[] {
  const rows: CategoryTreeRow[] = [];
  nodes.forEach((node) => {
    rows.push(node);
    if (Array.isArray(node.children) && node.children.length) {
      rows.push(...flattenCategoryTree(node.children));
    }
  });
  return rows;
}

function filterCategoryTree(nodes: CategoryTreeRow[], keyword: string): CategoryTreeRow[] {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    return nodes;
  }

  return nodes
    .map((node): CategoryTreeRow | null => {
      const children = filterCategoryTree(node.children || [], normalizedKeyword);
      const matched =
        node.name.toLowerCase().includes(normalizedKeyword) ||
        node.pathLabel.toLowerCase().includes(normalizedKeyword) ||
        String(node.slug || '').toLowerCase().includes(normalizedKeyword) ||
        String(node.description || '').toLowerCase().includes(normalizedKeyword);

      if (!matched && children.length === 0) {
        return null;
      }

      return {
        ...node,
        children,
      };
    })
    .filter((item): item is CategoryTreeRow => item !== null);
}

function buildParentTree(nodes: CategoryTreeRow[], excludeId: null | string): CategoryTreeSelectNode[] {
  return nodes.flatMap((node) => {
    if (excludeId && node.id === excludeId) {
      return [];
    }

    const children = buildParentTree(node.children || [], excludeId);
    return [
      {
        children,
        key: node.id,
        title: node.pathLabel,
        value: node.id,
      },
    ];
  });
}

const categoryTreeRows = computed(() => buildCategoryTree(categoryList.value));
const categoryParentTreeData = computed<CategoryTreeSelectNode[]>(() => [
  {
    children: buildParentTree(categoryTreeRows.value, editingId.value),
    key: 'root',
    title: '根分类',
    value: 'root',
  },
]);

function resetForm() {
  formModel.name = '';
  formModel.description = '';
  formModel.sortOrder = 0;
  formModel.enabled = true;
  formModel.slug = '';
  formModel.parentId = 'root';
}

function openCreate() {
  editingId.value = null;
  resetForm();
  modalOpen.value = true;
}

function openEdit(row: CategoryTreeRow) {
  editingId.value = row.id;
  formModel.name = row.name;
  formModel.description = row.description || '';
  formModel.sortOrder = row.sortOrder || 0;
  formModel.enabled = row.enabled !== false;
  formModel.slug = row.slug || '';
  formModel.parentId = row.parentId || 'root';
  modalOpen.value = true;
}

async function loadCategories() {
  const list = await listSceneSpotCategoriesApi();
  categoryList.value = list || [];
}

async function submit() {
  const form = formRef.value;
  if (!form) return;

  await form.validate();
  submitting.value = true;
  try {
    const payload = {
      description: formModel.description.trim() || null,
      enabled: formModel.enabled,
      name: formModel.name.trim(),
      parentId: formModel.parentId && formModel.parentId !== 'root' ? formModel.parentId : null,
      sortOrder: formModel.sortOrder,
      slug: formModel.slug.trim() || null,
    };

    if (editingId.value) {
      await updateSceneSpotCategoryApi(editingId.value, payload);
      message.success(t('page.sceneSpotCategories.message.updateSuccess'));
    } else {
      await createSceneSpotCategoryApi(payload);
      message.success(t('page.sceneSpotCategories.message.createSuccess'));
    }

    modalOpen.value = false;
    await loadCategories();
    gridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: CategoryTreeRow) {
  if (row.isBuiltin) {
    message.warning(t('page.sceneSpotCategories.message.builtinCannotDelete'));
    return;
  }

  Modal.confirm({
    title: t('page.sceneSpotCategories.confirm.delete.title', { name: row.name }),
    content: t('page.sceneSpotCategories.confirm.delete.content'),
    okType: 'danger',
    onOk: async () => {
      await deleteSceneSpotCategoryApi(row.id);
      message.success(t('page.sceneSpotCategories.message.deleteSuccess'));
      await loadCategories();
      await gridApi.query();
    },
  });
}

const [Grid, gridApi] = useVbenVxeGrid<CategoryTreeRow>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键字',
        componentProps: {
          allowClear: true,
          placeholder: '分类名称 / 路径 / 标识',
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 220, title: t('page.sceneSpotCategories.table.name'), treeNode: true },
      { field: 'pathLabel', minWidth: 280, title: '路径' },
      { field: 'slug', minWidth: 200, title: t('page.sceneSpotCategories.table.slug') },
      { field: 'sortOrder', minWidth: 100, title: t('page.sceneSpotCategories.table.sortOrder') },
      { field: 'enabled', minWidth: 100, title: t('page.sceneSpotCategories.table.enabled'), slots: { default: 'enabled' } },
      { field: 'isBuiltin', minWidth: 100, title: t('page.sceneSpotCategories.table.isBuiltin'), slots: { default: 'builtin' } },
      { field: 'updatedAt', minWidth: 180, formatter: 'formatDateTime', title: t('page.sceneSpotCategories.table.updatedAt') },
      { align: 'left', field: 'actions', fixed: 'right', minWidth: 180, slots: { default: 'actions' }, title: t('page.sceneSpotCategories.table.actions') },
    ],
    pagerConfig: {
      enabled: false,
    },
    proxyConfig: {
      ajax: {
        query: async (_params: unknown, formValues: Record<string, any>) => {
          const keyword = String(formValues.keyword || '').trim();
          const filtered = filterCategoryTree(categoryTreeRows.value, keyword);
          return {
            items: filtered,
            total: flattenCategoryTree(filtered).length,
          };
        },
      },
    },
    rowConfig: {
      keyField: 'id',
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
  gridApi.reload();
});
</script>

<template>
  <div class="p-5">
    <Grid>
      <template #toolbar-actions>
        <Button v-access:code="'sceneSpotCategory:write'" type="primary" @click="openCreate">
          {{ t('page.sceneSpotCategories.toolbar.create') }}
        </Button>
      </template>

      <template #enabled="{ row }">
        <Switch :checked="row.enabled" disabled />
      </template>

      <template #builtin="{ row }">
        <span>{{ row.isBuiltin ? t('page.sceneSpotCategories.values.yes') : t('page.sceneSpotCategories.values.no') }}</span>
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip :title="t('page.sceneSpotCategories.actions.edit')">
            <Button v-access:code="'sceneSpotCategory:write'" size="small" type="text" @click="openEdit(row)">
              <EditOutlined />
            </Button>
          </Tooltip>

          <Tooltip :title="t('page.sceneSpotCategories.actions.delete')">
            <Button v-access:code="'sceneSpotCategory:write'" :disabled="row.isBuiltin" danger size="small" type="text" @click="handleDelete(row)">
              <DeleteOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
    </Grid>

    <Modal
      :open="modalOpen"
      :title="modalTitle"
      :confirm-loading="submitting"
      :ok-text="t('page.sceneSpotCategories.modal.ok')"
      :cancel-text="t('page.sceneSpotCategories.modal.cancel')"
      destroy-on-close
      @cancel="() => (modalOpen = false)"
      @ok="submit"
    >
      <Form ref="formRef" :model="formModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 17 }">
        <Form.Item :label="t('page.sceneSpotCategories.form.name.label')" name="name" :rules="[{ required: true, message: t('page.sceneSpotCategories.form.name.required') }]">
          <Input v-model:value="formModel.name" allow-clear />
        </Form.Item>

        <Form.Item label="父分类" name="parentId">
          <TreeSelect
            v-model:value="formModel.parentId"
            :field-names="{ label: 'title', value: 'value', children: 'children' }"
            :tree-data="categoryParentTreeData"
            allow-clear
            show-search
            tree-node-filter-prop="title"
            placeholder="默认根分类"
          />
        </Form.Item>

        <Form.Item :label="t('page.sceneSpotCategories.form.slug.label')" name="slug">
          <Input v-model:value="formModel.slug" allow-clear :placeholder="t('page.sceneSpotCategories.form.slug.placeholder')" />
        </Form.Item>

        <Form.Item :label="t('page.sceneSpotCategories.form.description.label')" name="description">
          <Input.TextArea v-model:value="formModel.description" allow-clear :rows="4" />
        </Form.Item>

        <Form.Item :label="t('page.sceneSpotCategories.form.sortOrder.label')" name="sortOrder">
          <InputNumber v-model:value="formModel.sortOrder" :min="0" style="width: 100%" />
        </Form.Item>

        <Form.Item :label="t('page.sceneSpotCategories.form.enabled.label')" name="enabled">
          <Switch v-model:checked="formModel.enabled" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
