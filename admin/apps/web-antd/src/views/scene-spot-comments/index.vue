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
  { label: '待审核', value: 'pending' },
  { label: '已通过', value: 'approved' },
  { label: '已驳回', value: 'rejected' },
];

const statusColorMap: Record<SceneSpotCommentStatus, string> = {
  pending: 'gold',
  approved: 'green',
  rejected: 'red',
};

const statusLabelMap: Record<SceneSpotCommentStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
};

const pageTitle = computed(() => {
  if (fixedSceneSpotId.value) {
    return fixedSceneSpotTitle.value ? `景点留言 - ${fixedSceneSpotTitle.value}` : '景点留言';
  }
  return '留言管理';
});

const modalTitle = computed(() => (editingId.value ? '编辑留言' : '新增留言'));

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
      message.success('留言更新成功');
    } else {
      const payload: CreateSceneSpotCommentPayload = {
        sceneSpotId: (fixedSceneSpotId.value || commentFormModel.sceneSpotId).trim(),
        userId: commentFormModel.userId.trim(),
        content: commentFormModel.content.trim(),
        status: commentFormModel.status,
      };
      await createSceneSpotCommentApi(payload);
      message.success('留言创建成功');
    }
    modalOpen.value = false;
    gridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: SceneSpotCommentItem) {
  Modal.confirm({
    title: '确认删除该留言？',
    okType: 'danger',
    onOk: async () => {
      await deleteSceneSpotCommentApi(row.id);
      message.success('删除成功');
      gridApi.reload();
    },
  });
}

async function handleReview(row: SceneSpotCommentItem, status: SceneSpotCommentStatus) {
  if (row.status === status) {
    return;
  }
  await updateSceneSpotCommentStatusApi(row.id, { status });
  message.success('审核状态已更新');
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
  return statusLabelMap[status] || status;
}

const [Grid, gridApi] = useVbenVxeGrid<SceneSpotCommentItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键字',
        componentProps: {
          allowClear: true,
          placeholder: '留言内容关键字',
        },
      },
      {
        component: 'Select',
        fieldName: 'status',
        label: '状态',
        componentProps: {
          allowClear: true,
          options: statusOptions,
          placeholder: '请选择状态',
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
        title: '景点',
        slots: { default: 'sceneSpotTitle' },
      },
      {
        field: 'userDisplayName',
        minWidth: 140,
        title: '用户',
      },
      {
        field: 'content',
        minWidth: 260,
        title: '留言内容',
      },
      {
        field: 'status',
        minWidth: 120,
        title: '状态',
        slots: { default: 'status' },
      },
      {
        field: 'createdAt',
        minWidth: 180,
        title: '创建时间',
        formatter: 'formatDateTime',
      },
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
        <Button v-access:code="'comment:write'" type="primary" @click="openCreateModal">新增留言</Button>
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
          <Button v-access:code="'comment:write'" size="small" type="link" @click="openEditModal(row)">编辑</Button>
          <Button
            v-access:code="'comment:write'"
            size="small"
            type="link"
            @click="handleReview(row, 'approved')"
          >通过</Button>
          <Button
            v-access:code="'comment:write'"
            size="small"
            type="link"
            @click="handleReview(row, 'rejected')"
          >驳回</Button>
          <Button
            v-access:code="'comment:write'"
            danger
            size="small"
            type="link"
            @click="handleDelete(row)"
          >删除</Button>
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
          label="景点"
          name="sceneSpotId"
          :rules="[{ required: true, message: '请选择景点' }]"
        >
          <Select
            v-model:value="commentFormModel.sceneSpotId"
            allow-clear
            show-search
            :filter-option="false"
            :options="sceneSpotOptions"
            :loading="sceneSpotSearching"
            placeholder="请输入景点名称搜索"
            @search="loadSceneSpotOptions"
          />
        </Form.Item>
        <Form.Item label="用户" name="userId" :rules="[{ required: true, message: '请选择用户' }]">
          <Select
            v-model:value="commentFormModel.userId"
            allow-clear
            show-search
            :filter-option="false"
            :options="userOptions"
            :loading="userSearching"
            placeholder="请输入用户名/昵称搜索"
            :disabled="!!editingId"
            @search="loadUserOptions"
          />
        </Form.Item>
        <Form.Item label="状态" name="status" :rules="[{ required: true, message: '请选择状态' }]">
          <Select v-model:value="commentFormModel.status" :options="statusOptions" />
        </Form.Item>
        <Form.Item label="留言内容" name="content" :rules="[{ required: true, message: '请输入留言内容' }]">
          <TextArea v-model:value="commentFormModel.content" :maxlength="500" :rows="4" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
