<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import type {
  UserProjectCategoryItem,
  UserProjectDocument,
  UserProjectListItem,
} from '#/api';

import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createUserProjectApi,
  deleteUserProjectApi,
  getUserProjectApi,
  listUserProjectCategoriesApi,
  listUserProjectsApi,
  updateUserProjectApi,
} from '#/api';
import { getUserApi } from '#/api/core/rbac';

import { Button, Form, Input, message, Modal, Select, Space, Table, Tag } from 'ant-design-vue';

interface ProjectFormModel {
  categoryId?: string;
  id: string;
  name: string;
  userId: string;
}


const categories = ref<UserProjectCategoryItem[]>([]);

const projectModalOpen = ref(false);
const projectSubmitting = ref(false);
const editingProjectKey = ref<null | string>(null);
const projectFormRef = ref<FormInstance>();

// file management removed: use project details page instead
const fileManageProjectDoc = ref<UserProjectDocument | null>(null);

const projectFormModel = reactive<ProjectFormModel>({
  userId: '',
  id: '',
  name: '',
  categoryId: undefined,
});

// scene upload removed from this view

const categoryOptions = computed(() =>
  categories.value.map((item) => ({
    label: item.userId ? `${item.name} (${item.userId})` : item.name,
    value: item.id,
  })),
);

const projectModalTitle = computed(() =>
  editingProjectKey.value ? '编辑工程' : '新建工程',
);

// file management removed; details page added separately

function resetProjectForm() {
  projectFormModel.userId = '';
  projectFormModel.id = '';
  projectFormModel.name = '';
  projectFormModel.categoryId = undefined;
}

// scene upload removed; no file form to reset

async function loadCategories() {
  categories.value = await listUserProjectCategoriesApi();
}

function openCreateProjectModal() {
  editingProjectKey.value = null;
  resetProjectForm();
  projectModalOpen.value = true;
}

async function openEditProjectModal(row: UserProjectListItem) {
  editingProjectKey.value = `${row.userId}::${row.id}`;
  projectFormModel.userId = row.userId;
  projectFormModel.id = row.id;
  projectFormModel.name = row.name;
  projectFormModel.categoryId = row.categoryId || undefined;

  try {
    const detail = await getUserProjectApi(row.userId, row.id);
    projectFormModel.name = detail.project.name;
    projectFormModel.categoryId = detail.project.categoryId || undefined;
  } catch {
    // ignore and keep row values
  }

  projectModalOpen.value = true;
}

async function submitProject() {
  const form = projectFormRef.value;
  if (!form) {
    return;
  }
  await form.validate();
  projectSubmitting.value = true;
  try {
    const payload: UserProjectDocument = {
      id: projectFormModel.id.trim(),
      name: projectFormModel.name.trim(),
      categoryId: projectFormModel.categoryId || null,
      scenes: [],
      lastEditedSceneId: null,
    };

    if (editingProjectKey.value) {
      const [userId, projectId] = editingProjectKey.value.split('::');
      if (!userId || !projectId) {
        throw new Error('Invalid project key');
      }
      const detail = await getUserProjectApi(userId, projectId);
      await updateUserProjectApi(userId, projectId, {
        project: {
          ...detail.project,
          name: payload.name,
          categoryId: payload.categoryId || null,
        },
      });
      message.success('工程更新成功');
    } else {
      await createUserProjectApi({
        userId: projectFormModel.userId.trim() || undefined,
        project: payload,
      });
      message.success('工程创建成功');
    }

    projectModalOpen.value = false;
    await Promise.all([loadCategories(), projectGridApi.reload()]);
  } finally {
    projectSubmitting.value = false;
  }
}

function handleDeleteProject(row: UserProjectListItem) {
  Modal.confirm({
    title: `确认删除工程“${row.name}”吗？`,
    content: '删除后不可恢复。',
    okType: 'danger',
    onOk: async () => {
      await deleteUserProjectApi(row.userId, row.id);
      message.success('工程删除成功');
      projectGridApi.reload();
    },
  });
}

async function openFileManager(row: UserProjectListItem) {
  // kept only for compatibility; use details page instead
  const detail = await getUserProjectApi(row.userId, row.id);
  fileManageProjectDoc.value = detail.project;
}

const router = useRouter();
function openProjectDetail(row: UserProjectListItem) {
  router.push({ name: 'UserProjectDetail', params: { userId: row.userId, projectId: row.id } });
}

// scene upload / deletion removed from this UI. Use project detail page if needed.

const [ProjectGrid, projectGridApi] = useVbenVxeGrid<UserProjectListItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键字',
        componentProps: {
          allowClear: true,
          placeholder: '工程名称',
        },
      },
      {
        component: 'Input',
        fieldName: 'userId',
        label: '用户ID',
        componentProps: {
          allowClear: true,
          placeholder: '可选（管理员可按用户筛选）',
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
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 180, title: '工程名称' },
      { field: 'id', minWidth: 220, title: '工程ID' },
      { field: 'userId', minWidth: 200, title: '用户' , slots: { default: 'user' }},
      {
        field: 'categoryId',
        minWidth: 200,
        title: '分类',
        slots: { default: 'category' },
      },
      { field: 'sceneCount', minWidth: 100, title: '场景数' },
      {
        field: 'updatedAt',
        minWidth: 180,
        sortable: true,
        formatter: 'formatDateTime',
        title: '更新时间',
      },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 280,
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
          const result = await listUserProjectsApi({
            keyword: formValues.keyword || undefined,
            userId: formValues.userId || undefined,
            categoryId: formValues.categoryId || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
          });
          // fetch usernames for displayed page
          const uniqueUserIds = Array.from(new Set((result.items || []).map((i) => i.userId).filter(Boolean)));
          const userMap: Record<string, string> = {};
          await Promise.all(
            uniqueUserIds.map(async (id) => {
              try {
                const user = await getUserApi(id);
                userMap[id] = user.username || id;
              } catch {
                userMap[id] = id;
              }
            }),
          );
          result.items = (result.items || []).map((it) => ({ ...(it as any), username: userMap[(it as any).userId] || (it as any).userId }));
          return result;
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
  tableTitle: '项目管理',
});

onMounted(async () => {
  await loadCategories();
});
</script>

<template>
  <div class="p-5">
    <ProjectGrid>
      <template #toolbar-actions>
        <Space>
          <Button v-access:code="'userProject:write'" type="primary" @click="openCreateProjectModal">
            新建工程
          </Button>
          <Button @click="loadCategories">刷新分类</Button>
        </Space>
      </template>

      <template #category="{ row }">
        <Tag v-if="row.categoryId" color="blue">{{ row.categoryId }}</Tag>
        <span v-else class="text-text-secondary">-</span>
      </template>

      <template #user="{ row }">
        <div>
          <div>{{ (row as any).username || row.userId }}</div>
          <div class="text-text-secondary" style="font-size:12px">{{ row.userId }}</div>
        </div>
      </template>

      <template #actions="{ row }">
        <Space>
          <Button size="small" type="link" @click="openProjectDetail(row)">详情</Button>
          <Button
            v-access:code="'userProject:write'"
            size="small"
            type="link"
            @click="openEditProjectModal(row)"
          >
            编辑
          </Button>
          <Button
            v-access:code="'userProject:write'"
            danger
            size="small"
            type="link"
            @click="handleDeleteProject(row)"
          >
            删除
          </Button>
        </Space>
      </template>
    </ProjectGrid>

    <Modal
      :open="projectModalOpen"
      :title="projectModalTitle"
      :confirm-loading="projectSubmitting"
      ok-text="保存"
      cancel-text="取消"
      destroy-on-close
      @cancel="() => (projectModalOpen = false)"
      @ok="submitProject"
    >
      <Form ref="projectFormRef" :model="projectFormModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 17 }">
        <Form.Item label="用户ID" name="userId" :rules="[{ required: !editingProjectKey, message: '请输入用户ID' }]">
          <Input v-model:value="projectFormModel.userId" :disabled="!!editingProjectKey" allow-clear />
        </Form.Item>
        <Form.Item label="工程ID" name="id" :rules="[{ required: true, message: '请输入工程ID' }]">
          <Input v-model:value="projectFormModel.id" :disabled="!!editingProjectKey" allow-clear />
        </Form.Item>
        <Form.Item label="工程名称" name="name" :rules="[{ required: true, message: '请输入工程名称' }]">
          <Input v-model:value="projectFormModel.name" allow-clear />
        </Form.Item>
        <Form.Item label="分类" name="categoryId">
          <Select
            v-model:value="projectFormModel.categoryId"
            allow-clear
            :options="categoryOptions"
            placeholder="可选"
          />
        </Form.Item>
      </Form>
    </Modal>

    <!-- File management moved to project details page; removed from project list view -->
  </div>
</template>
