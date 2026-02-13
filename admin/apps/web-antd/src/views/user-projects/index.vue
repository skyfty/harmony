<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import type { UserProjectCategoryItem, UserProjectDocument, UserProjectListItem } from '#/api';

import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createProjectApi,
  deleteProjectApi,
  getProjectApi,
  listProjectCategoriesApi,
  listProjectsApi,
  updateProjectApi,
} from '#/api';
import { getUserApi } from '#/api/core/rbac';

import { Button, Form, Input, message, Modal, Select, Space, Tag } from 'ant-design-vue';

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

const projectFormModel = reactive<ProjectFormModel>({
  userId: '',
  id: '',
  name: '',
  categoryId: undefined,
});

const categoryOptions = computed(() =>
  categories.value.map((item) => ({
    label: item.name,
    value: item.id,
  })),
);

const categoryNameMap = computed<Record<string, string>>(() =>
  Object.fromEntries(categories.value.map((item) => [item.id, item.name])),
);

const { t } = useI18n();
const projectModalTitle = computed(() => (editingProjectKey.value ? t('page.userProjects.index.modal.edit') : t('page.userProjects.index.modal.create')));

function resetProjectForm() {
  projectFormModel.userId = '';
  projectFormModel.id = '';
  projectFormModel.name = '';
  projectFormModel.categoryId = undefined;
}

async function loadCategories() {
  categories.value = await listProjectCategoriesApi();
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
    const detail = await getProjectApi(row.userId, row.id);
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
      const detail = await getProjectApi(userId, projectId);
      await updateProjectApi(userId, projectId, {
        project: {
          ...detail.project,
          name: payload.name,
          categoryId: payload.categoryId || null,
        },
      });
      message.success(t('page.userProjects.index.message.updateSuccess'));
    } else {
      await createProjectApi({
        userId: projectFormModel.userId.trim() || undefined,
        project: payload,
      });
      message.success(t('page.userProjects.index.message.createSuccess'));
    }

    projectModalOpen.value = false;
    await Promise.all([loadCategories(), projectGridApi.reload()]);
  } finally {
    projectSubmitting.value = false;
  }
}

function handleDeleteProject(row: UserProjectListItem) {
    Modal.confirm({
    title: t('page.userProjects.index.confirm.delete.title', { name: row.name }),
    content: t('page.userProjects.index.confirm.delete.content'),
    okType: 'danger',
    onOk: async () => {
      await deleteProjectApi(row.userId, row.id);
      message.success(t('page.userProjects.index.message.deleteSuccess'));
      projectGridApi.reload();
    },
  });
}

const router = useRouter();
function openProjectDetail(row: UserProjectListItem) {
  router.push({ name: 'ProjectDetail', params: { userId: row.userId, projectId: row.id } });
}

const [ProjectGrid, projectGridApi] = useVbenVxeGrid<UserProjectListItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: t('page.userProjects.index.form.keyword.label'),
        componentProps: {
          allowClear: true,
          placeholder: t('page.userProjects.index.form.keyword.placeholder'),
        },
      },
      {
        component: 'Input',
        fieldName: 'userId',
        label: t('page.userProjects.index.form.userId.label'),
        componentProps: {
          allowClear: true,
          placeholder: t('page.userProjects.index.form.userId.placeholder'),
        },
      },
      {
        component: 'Select',
        fieldName: 'categoryId',
        label: t('page.userProjects.index.form.categoryId.label'),
        componentProps: {
          allowClear: true,
          options: categoryOptions,
          placeholder: t('page.userProjects.index.form.categoryId.placeholder'),
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 180, title: t('page.userProjects.index.table.name') },
      { field: 'id', minWidth: 220, title: t('page.userProjects.index.table.id') },
      { field: 'userId', minWidth: 200, title: t('page.userProjects.index.table.user'), slots: { default: 'user' } },
      {
        field: 'categoryId',
        minWidth: 200,
        title: t('page.userProjects.index.table.category'),
        slots: { default: 'category' },
      },
      { field: 'sceneCount', minWidth: 100, title: t('page.userProjects.index.table.sceneCount') },
      {
        field: 'updatedAt',
        minWidth: 180,
        sortable: true,
        formatter: 'formatDateTime',
        title: t('page.userProjects.index.table.updatedAt'),
      },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 280,
        slots: { default: 'actions' },
        title: t('page.userProjects.index.table.actions'),
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
          const result = await listProjectsApi({
            keyword: formValues.keyword || undefined,
            userId: formValues.userId || undefined,
            categoryId: formValues.categoryId || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
          });
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
          result.items = (result.items || []).map((it) => ({
            ...(it as any),
            username: userMap[(it as any).userId] || (it as any).userId,
          }));
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
  tableTitle: t('page.userProjects.index.table.title'),
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
          <Button v-access:code="'project:write'" type="primary" @click="openCreateProjectModal">
            {{ t('page.userProjects.index.toolbar.create') }}
          </Button>
          <Button @click="loadCategories">{{ t('page.userProjects.index.toolbar.refreshCategories') }}</Button>
        </Space>
      </template>

      <template #category="{ row }">
        <Tag v-if="row.categoryId" color="blue">{{ categoryNameMap[row.categoryId] ?? row.categoryId }}</Tag>
        <span v-else class="text-text-secondary">-</span>
      </template>

      <template #user="{ row }">
        <div>
          <div>{{ (row as any).username || row.userId }}</div>
        </div>
      </template>

      <template #actions="{ row }">
        <Space>
          <Button size="small" type="link" @click="openProjectDetail(row)">{{ t('page.userProjects.index.actions.detail') }}</Button>
          <Button v-access:code="'project:write'" size="small" type="link" @click="openEditProjectModal(row)">
            {{ t('page.userProjects.index.actions.edit') }}
          </Button>
          <Button v-access:code="'project:write'" danger size="small" type="link" @click="handleDeleteProject(row)">
            {{ t('page.userProjects.index.actions.delete') }}
          </Button>
        </Space>
      </template>
    </ProjectGrid>

    <Modal
      :open="projectModalOpen"
      :title="projectModalTitle"
      :confirm-loading="projectSubmitting"
      :ok-text="t('page.userProjects.index.modal.ok')"
      :cancel-text="t('page.userProjects.index.modal.cancel')"
      destroy-on-close
      @cancel="() => (projectModalOpen = false)"
      @ok="submitProject"
    >
      <Form ref="projectFormRef" :model="projectFormModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 17 }">
        <Form.Item :label="t('page.userProjects.index.formFields.userId.label')" name="userId" :rules="[{ required: !editingProjectKey, message: t('page.userProjects.index.formFields.userId.required') }]">
          <Input v-model:value="projectFormModel.userId" :disabled="!!editingProjectKey" allow-clear />
        </Form.Item>
        <Form.Item :label="t('page.userProjects.index.formFields.id.label')" name="id" :rules="[{ required: true, message: t('page.userProjects.index.formFields.id.required') }]">
          <Input v-model:value="projectFormModel.id" :disabled="!!editingProjectKey" allow-clear />
        </Form.Item>
        <Form.Item :label="t('page.userProjects.index.formFields.name.label')" name="name" :rules="[{ required: true, message: t('page.userProjects.index.formFields.name.required') }]">
          <Input v-model:value="projectFormModel.name" allow-clear />
        </Form.Item>
        <Form.Item :label="t('page.userProjects.index.formFields.categoryId.label')" name="categoryId">
          <Select v-model:value="projectFormModel.categoryId" allow-clear :options="categoryOptions" :placeholder="t('page.userProjects.index.formFields.categoryId.placeholder')" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
