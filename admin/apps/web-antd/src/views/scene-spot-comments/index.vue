<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import type {
  CreateSceneSpotCommentPayload,
  SceneSpotCommentItem,
  SceneSpotCommentStatus,
  UpdateSceneSpotCommentPayload,
} from '#/api';

import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createSceneSpotCommentApi,
  deleteSceneSpotCommentApi,
  getSceneSpotApi,
  listSceneSpotsApi,
  listSceneSpotCommentsApi,
  listSceneSpotCommentsBySceneSpotApi,
  listUsersApi,
  updateSceneSpotCommentApi,
  updateSceneSpotCommentStatusApi,
} from '#/api';

import { Button, Form, Input, message, Modal, Select, Space, Tag } from 'ant-design-vue';
import { $t } from '#/locales';

const t = (key: string, args?: Record<string, unknown>) => $t(key as never, args as never);

interface CommentFormModel {
  sceneSpotId: string;
  userId: string;
  content: string;
  status: SceneSpotCommentStatus;
}

const route = useRoute();
const router = useRouter();
const { TextArea } = Input;

const fixedSceneSpotId = computed(() => {
  const raw = route.params.sceneSpotId;
  return typeof raw === 'string' ? raw : '';
});

const fixedSceneSpotTitle = ref('');

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<null | string>(null);
const commentFormRef = ref<FormInstance>();
const sceneSpotOptions = ref<Array<{ label: string; value: string }>>([]);
const userOptions = ref<Array<{ label: string; value: string }>>([]);
const sceneSpotSearching = ref(false);
const userSearching = ref(false);

const commentFormModel = reactive<CommentFormModel>({
  sceneSpotId: '',
  userId: '',
  content: '',
  status: 'approved',
});

const statusOptions: Array<{ label: string; value: SceneSpotCommentStatus }> = [
  { label: t('page.sceneSpotComments.index.status.pending'), value: 'pending' },
  { label: t('page.sceneSpotComments.index.status.approved'), value: 'approved' },
  { label: t('page.sceneSpotComments.index.status.rejected'), value: 'rejected' },
];

const statusColorMap: Record<SceneSpotCommentStatus, string> = {
  pending: 'gold',
  approved: 'green',
  rejected: 'red',
};

const statusLabelMap: Record<SceneSpotCommentStatus, string> = {
  pending: 'page.sceneSpotComments.index.status.pending',
  approved: 'page.sceneSpotComments.index.status.approved',
  rejected: 'page.sceneSpotComments.index.status.rejected',
};

const pageTitle = computed(() => {
  if (fixedSceneSpotId.value) {
    return fixedSceneSpotTitle.value
      ? `${t('page.sceneSpotComments.index.title.sceneSpot')} - ${fixedSceneSpotTitle.value}`
      : t('page.sceneSpotComments.index.title.sceneSpot');
  }
  return t('page.sceneSpotComments.index.title.index');
});

const modalTitle = computed(() => (editingId.value ? t('page.sceneSpotComments.index.modal.edit') : t('page.sceneSpotComments.index.modal.create')));

function resetForm() {
  commentFormModel.sceneSpotId = fixedSceneSpotId.value || '';
  commentFormModel.userId = '';
  commentFormModel.content = '';
  commentFormModel.status = 'approved';
}

function ensureOption(
  options: Array<{ label: string; value: string }>,
  value: string,
  label: string,
) {
  if (!value) {
    return;
  }
  if (!options.some((option) => option.value === value)) {
    options.unshift({ label, value });
  }
}

async function loadSceneSpotOptions(keyword = '') {
  sceneSpotSearching.value = true;
  try {
    const response = await listSceneSpotsApi({
      keyword: keyword || undefined,
      page: 1,
      pageSize: 20,
    });
    sceneSpotOptions.value = response.items.map((item) => ({
      label: item.title || item.id,
      value: item.id,
    }));
  } finally {
    sceneSpotSearching.value = false;
  }
}

async function loadUserOptions(keyword = '') {
  userSearching.value = true;
  try {
    const response = await listUsersApi({
      keyword: keyword || undefined,
      page: 1,
      pageSize: 20,
    });
    userOptions.value = response.items.map((item) => ({
      label: item.displayName || item.username || item.id,
      value: item.id,
    }));
  } finally {
    userSearching.value = false;
  }
}

function openCreateModal() {
  editingId.value = null;
  resetForm();
  loadUserOptions();
  if (!fixedSceneSpotId.value) {
    loadSceneSpotOptions();
  }
  modalOpen.value = true;
}

function openEditModal(row: SceneSpotCommentItem) {
  editingId.value = row.id;
  commentFormModel.sceneSpotId = row.sceneSpotId;
  commentFormModel.userId = row.userId;
  commentFormModel.content = row.content;
  commentFormModel.status = row.status;
  ensureOption(
    sceneSpotOptions.value,
    row.sceneSpotId,
    row.sceneSpotTitle || row.sceneSpotId,
  );
  ensureOption(
    userOptions.value,
    row.userId,
    row.userDisplayName || row.userId,
  );
  loadUserOptions();
  if (!fixedSceneSpotId.value) {
    loadSceneSpotOptions();
  }
  modalOpen.value = true;
}

async function submitComment() {
  const form = commentFormRef.value;
  if (!form) {
    return;
  }
  await form.validate();

  submitting.value = true;
  try {
    if (editingId.value) {
      const payload: UpdateSceneSpotCommentPayload = {
        content: commentFormModel.content.trim(),
      };
      await updateSceneSpotCommentApi(editingId.value, payload);
      await updateSceneSpotCommentStatusApi(editingId.value, { status: commentFormModel.status });
      message.success(t('page.sceneSpotComments.index.message.updateSuccess'));
    } else {
      const payload: CreateSceneSpotCommentPayload = {
        sceneSpotId: (fixedSceneSpotId.value || commentFormModel.sceneSpotId).trim(),
        userId: commentFormModel.userId.trim(),
        content: commentFormModel.content.trim(),
        status: commentFormModel.status,
      };
      await createSceneSpotCommentApi(payload);
      message.success(t('page.sceneSpotComments.index.message.createSuccess'));
    }
    modalOpen.value = false;
    gridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: SceneSpotCommentItem) {
  Modal.confirm({
    title: t('page.sceneSpotComments.index.confirm.delete.title'),
    okType: 'danger',
    onOk: async () => {
      await deleteSceneSpotCommentApi(row.id);
      message.success(t('page.sceneSpotComments.index.message.deleteSuccess'));
      gridApi.reload();
    },
  });
}

async function handleReview(row: SceneSpotCommentItem, status: SceneSpotCommentStatus) {
  if (row.status === status) {
    return;
  }
  await updateSceneSpotCommentStatusApi(row.id, { status });
  message.success(t('page.sceneSpotComments.index.message.reviewUpdated'));
  gridApi.reload();
}

function goSceneSpotDetail(row: SceneSpotCommentItem) {
  if (!row.sceneSpotId) {
    return;
  }
  router.push({
    name: 'SceneSpotDetail',
    params: { id: row.sceneSpotId },
  });
}

function resolveStatusLabel(status: SceneSpotCommentStatus) {
  const key = statusLabelMap[status];
  return key ? t(key) : status;
}

const [Grid, gridApi] = useVbenVxeGrid<SceneSpotCommentItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: t('page.sceneSpotComments.index.form.keyword.label'),
        componentProps: {
          allowClear: true,
          placeholder: t('page.sceneSpotComments.index.form.keyword.placeholder'),
        },
      },
      {
        component: 'Select',
        fieldName: 'status',
        label: t('page.sceneSpotComments.index.form.status.label'),
        componentProps: {
          allowClear: true,
          options: statusOptions,
          placeholder: t('page.sceneSpotComments.index.form.status.placeholder'),
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      {
        field: 'sceneSpotTitle',
        minWidth: 200,
        title: t('page.sceneSpotComments.index.table.sceneSpot'),
        slots: { default: 'sceneSpotTitle' },
      },
      {
        field: 'userDisplayName',
        minWidth: 140,
        title: t('page.sceneSpotComments.index.table.user'),
      },
      {
        field: 'content',
        minWidth: 260,
        title: t('page.sceneSpotComments.index.table.content'),
      },
      {
        field: 'status',
        minWidth: 120,
        title: t('page.sceneSpotComments.index.table.status'),
        slots: { default: 'status' },
      },
      {
        field: 'createdAt',
        minWidth: 180,
        title: t('page.sceneSpotComments.index.table.createdAt'),
        formatter: 'formatDateTime',
      },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 260,
        slots: { default: 'actions' },
        title: t('page.sceneSpotComments.index.table.actions'),
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
          const params = {
            keyword: formValues.keyword || undefined,
            status: formValues.status || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
          };
          if (fixedSceneSpotId.value) {
            return await listSceneSpotCommentsBySceneSpotApi(fixedSceneSpotId.value, params);
          }
          return await listSceneSpotCommentsApi({ ...params, sceneSpotId: undefined });
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
});

onMounted(async () => {
  resetForm();
  if (fixedSceneSpotId.value) {
    try {
      const detail = await getSceneSpotApi(fixedSceneSpotId.value);
      fixedSceneSpotTitle.value = detail.title || '';
    } catch {
      fixedSceneSpotTitle.value = '';
    }
  }
});
</script>

<template>
  <div class="p-5">
    <div class="mb-3 text-[16px] font-semibold">{{ pageTitle }}</div>
    <Grid>
      <template #toolbar-actions>
        <Button v-access:code="'comment:write'" type="primary" @click="openCreateModal">{{ t('page.sceneSpotComments.index.toolbar.create') }}</Button>
      </template>

      <template #sceneSpotTitle="{ row }">
        <Button size="small" type="link" @click="goSceneSpotDetail(row)">
          {{ row.sceneSpotTitle || row.sceneSpotId }}
        </Button>
      </template>

      <template #status="{ row }">
        <Tag :color="statusColorMap[row.status]">{{ resolveStatusLabel(row.status) }}</Tag>
      </template>

      <template #actions="{ row }">
        <Space>
          <Button v-access:code="'comment:write'" size="small" type="link" @click="openEditModal(row)">{{ t('page.sceneSpotComments.index.actions.edit') }}</Button>
          <Button v-access:code="'comment:write'" size="small" type="link" @click="handleReview(row, 'approved')">{{ t('page.sceneSpotComments.index.actions.approve') }}</Button>
          <Button v-access:code="'comment:write'" size="small" type="link" @click="handleReview(row, 'rejected')">{{ t('page.sceneSpotComments.index.actions.reject') }}</Button>
          <Button v-access:code="'comment:write'" danger size="small" type="link" @click="handleDelete(row)">{{ t('page.sceneSpotComments.index.actions.delete') }}</Button>
        </Space>
      </template>
    </Grid>

    <Modal
      :open="modalOpen"
      :confirm-loading="submitting"
      :title="modalTitle"
      destroy-on-close
      @cancel="modalOpen = false"
      @ok="submitComment"
    >
      <Form ref="commentFormRef" :label-col="{ span: 5 }" :model="commentFormModel" :wrapper-col="{ span: 18 }">
        <Form.Item
          v-if="!fixedSceneSpotId"
          :label="t('page.sceneSpotComments.index.formFields.scene.label')"
          name="sceneSpotId"
          :rules="[{ required: true, message: t('page.sceneSpotComments.index.formFields.scene.required') }]"
        >
          <Select
            v-model:value="commentFormModel.sceneSpotId"
            allow-clear
            show-search
            :filter-option="false"
            :options="sceneSpotOptions"
            :loading="sceneSpotSearching"
            :placeholder="t('page.sceneSpotComments.index.formFields.scene.placeholder')"
            @search="loadSceneSpotOptions"
          />
        </Form.Item>
        <Form.Item :label="t('page.sceneSpotComments.index.formFields.user.label')" name="userId" :rules="[{ required: true, message: t('page.sceneSpotComments.index.formFields.user.required') }]">
          <Select
            v-model:value="commentFormModel.userId"
            allow-clear
            show-search
            :filter-option="false"
            :options="userOptions"
            :loading="userSearching"
            :placeholder="t('page.sceneSpotComments.index.formFields.user.placeholder')"
            :disabled="!!editingId"
            @search="loadUserOptions"
          />
        </Form.Item>
        <Form.Item :label="t('page.sceneSpotComments.index.formFields.status.label')" name="status" :rules="[{ required: true, message: t('page.sceneSpotComments.index.formFields.status.required') }]">
          <Select v-model:value="commentFormModel.status" :options="statusOptions" />
        </Form.Item>
        <Form.Item :label="t('page.sceneSpotComments.index.formFields.content.label')" name="content" :rules="[{ required: true, message: t('page.sceneSpotComments.index.formFields.content.required') }]">
          <TextArea v-model:value="commentFormModel.content" :maxlength="500" :rows="4" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
