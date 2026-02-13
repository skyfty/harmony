<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';

import type {
  CreateUserPayload,
  RoleItem,
  UpdateUserPayload,
  UserItem,
} from '#/api';

import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createUserApi,
  deleteUserApi,
  listRolesApi,
  listUsersApi,
  updateUserApi,
  updateUserStatusApi,
} from '#/api';

import {
  Button,
  Form,
  Input,
  message,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
} from 'ant-design-vue';

interface UserFormModel {
  displayName: string;
  email: string;
  password: string;
  roleIds: string[];
  status: 'active' | 'disabled';
  username: string;
}

const roleOptions = ref<Array<{ label: string; value: string }>>([]);
const modalOpen = ref(false);
const submitting = ref(false);
const editingUserId = ref<null | string>(null);
const changingStatusId = ref<null | string>(null);
const userFormRef = ref<FormInstance>();

const userFormModel = reactive<UserFormModel>({
  displayName: '',
  email: '',
  password: '',
  roleIds: [],
  status: 'active',
  username: '',
});

const { t } = useI18n();
const modalTitle = computed(() => (editingUserId.value ? t('page.systemUsers.index.modal.edit') : t('page.systemUsers.index.modal.create')));

const userRules = computed(() => ({
  username: [
    {
      message: t('page.systemUsers.index.form.username.required'),
      required: true,
      type: 'string',
      trigger: 'blur',
    },
  ],
  password: editingUserId.value
    ? []
    : [
        {
          message: t('page.systemUsers.index.form.password.required'),
          required: true,
          type: 'string',
          trigger: 'blur',
        },
      ],
})) as unknown as Record<string, any>;

function resetUserForm() {
  userFormModel.username = '';
  userFormModel.password = '';
  userFormModel.displayName = '';
  userFormModel.email = '';
  userFormModel.status = 'active';
  userFormModel.roleIds = [];
}

function openCreateModal() {
  editingUserId.value = null;
  resetUserForm();
  modalOpen.value = true;
}

function openEditModal(record: UserItem) {
  editingUserId.value = record.id;
  userFormModel.username = record.username;
  userFormModel.password = '';
  userFormModel.displayName = record.displayName || '';
  userFormModel.email = record.email || '';
  userFormModel.status = record.status;
  userFormModel.roleIds = record.roles?.map((role) => role.id) || [];
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
}

async function loadRoleOptions() {
  try {
    const response = await listRolesApi({ page: 1, pageSize: 200 });
    roleOptions.value = (response.items || []).map((role: RoleItem) => ({
      label: `${role.name} (${role.code})`,
      value: role.id,
    }));
  } catch {
    roleOptions.value = [];
  }
}

async function submitUser() {
  const form = userFormRef.value;
  if (!form) {
    return;
  }
  await form.validate();
  submitting.value = true;
  try {
    if (editingUserId.value) {
      const payload: UpdateUserPayload = {
        displayName: userFormModel.displayName || undefined,
        email: userFormModel.email || undefined,
        roleIds: userFormModel.roleIds,
        status: userFormModel.status,
      };
      if (userFormModel.password?.trim()) {
        payload.password = userFormModel.password.trim();
      }
      await updateUserApi(editingUserId.value, payload);
      message.success(t('page.systemUsers.index.message.updateSuccess'));
    } else {
      const payload: CreateUserPayload = {
        username: userFormModel.username.trim(),
        password: userFormModel.password,
        displayName: userFormModel.displayName || undefined,
        email: userFormModel.email || undefined,
        roleIds: userFormModel.roleIds,
        status: userFormModel.status,
      };
      await createUserApi(payload);
      message.success(t('page.systemUsers.index.message.createSuccess'));
    }
    modalOpen.value = false;
    userGridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(record: UserItem) {
  Modal.confirm({
    title: t('page.systemUsers.index.confirm.delete.title', { username: record.username }),
    content: t('page.systemUsers.index.confirm.delete.content'),
    okType: 'danger',
    onOk: async () => {
      await deleteUserApi(record.id);
      message.success(t('page.systemUsers.index.message.deleteSuccess'));
      userGridApi.reload();
    },
  });
}

async function handleStatusChange(record: UserItem, checked: boolean) {
  changingStatusId.value = record.id;
  try {
    await updateUserStatusApi(record.id, checked ? 'active' : 'disabled');
    message.success(t('page.systemUsers.index.message.statusUpdate'));
    userGridApi.reload();
  } finally {
    changingStatusId.value = null;
  }
}

const [UserGrid, userGridApi] = useVbenVxeGrid<UserItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: t('page.systemUsers.index.table.keyword'),
        componentProps: {
          allowClear: true,
          placeholder: t('page.systemUsers.index.table.keyword'),
        },
      },
      {
        component: 'Select',
        fieldName: 'status',
        label: t('page.systemUsers.index.table.status'),
        componentProps: {
          allowClear: true,
          options: [
            { label: t('page.systemUsers.index.form.status.options.active'), value: 'active' },
            { label: t('page.systemUsers.index.form.status.options.disabled'), value: 'disabled' },
          ],
          placeholder: t('page.systemUsers.index.form.status.placeholder'),
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'username', minWidth: 150, sortable: true, title: t('page.systemUsers.index.table.username') },
      { field: 'displayName', minWidth: 140, title: t('page.systemUsers.index.table.displayName') },
      { field: 'email', minWidth: 180, title: t('page.systemUsers.index.table.email') },
      {
        field: 'roles',
        minWidth: 220,
        title: t('page.systemUsers.index.table.roles'),
        slots: { default: 'roles' },
      },
      {
        field: 'status',
        minWidth: 160,
        title: t('page.systemUsers.index.table.status'),
        slots: { default: 'status' },
      },
      {
        field: 'createdAt',
        minWidth: 180,
        sortable: true,
        formatter: 'formatDateTime',
        title: t('page.systemUsers.index.table.createdAt'),
      },
      {
        field: 'updatedAt',
        minWidth: 180,
        sortable: true,
        formatter: 'formatDateTime',
        title: t('page.systemUsers.index.table.updatedAt'),
      },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 220,
        slots: { default: 'actions' },
        title: t('page.systemUsers.index.table.actions'),
      },
    ],
    keepSource: true,
    pagerConfig: {
      pageSize: 20,
    },
    proxyConfig: {
      ajax: {
        query: async ({ page }: { page: { currentPage: number; pageSize: number } }, formValues: Record<string, any>) => {
          const params = {
            keyword: formValues.keyword,
            page: page.currentPage,
            pageSize: page.pageSize,
            status: formValues.status || undefined,
          };
          return await listUsersApi(params);
        },
      },
    },
    sortConfig: {
      defaultSort: { field: 'createdAt', order: 'desc' },
      multiple: false,
      remote: false,
    },
    toolbarConfig: {
      custom: true,
      refresh: true,
      search: true,
      zoom: true,
    },
  },
  tableTitle: t('page.systemUsers.index.table.title'),
});

onMounted(async () => {
  await loadRoleOptions();
});
</script>

<template>
  <div class="p-5">
    <UserGrid>
      <template #toolbar-actions>
        <Button v-access:code="'user:write'" type="primary" @click="openCreateModal">
          新增用户
        </Button>
      </template>

      <template #roles="{ row }">
        <Space wrap>
          <Tag v-for="role in row.roles" :key="role.id" color="blue">
            {{ role.name }}
          </Tag>
          <span v-if="!row.roles?.length" class="text-text-secondary">-</span>
        </Space>
      </template>

      <template #status="{ row }">
        <Space>
          <Tag :color="row.status === 'active' ? 'success' : 'default'">
            {{ row.status === 'active' ? '启用' : '禁用' }}
          </Tag>
          <Switch
            v-access:code="'user:write'"
            :checked="row.status === 'active'"
            :loading="changingStatusId === row.id"
            checked-children="启"
            un-checked-children="停"
            @change="(checked) => handleStatusChange(row, !!checked)"
          />
        </Space>
      </template>

      <template #actions="{ row }">
        <Space>
          <Button
            v-access:code="'user:write'"
            size="small"
            type="link"
            @click="openEditModal(row)"
          >
            编辑
          </Button>
          <Button
            v-access:code="'user:write'"
            danger
            size="small"
            type="link"
            @click="handleDelete(row)"
          >
            删除
          </Button>
        </Space>
      </template>
    </UserGrid>

    <Modal
      :confirm-loading="submitting"
      :open="modalOpen"
      :title="modalTitle"
      destroy-on-close
      ok-text="保存"
      cancel-text="取消"
      @cancel="closeModal"
      @ok="submitUser"
    >
      <Form
        ref="userFormRef"
        :label-col="{ span: 6 }"
        :model="userFormModel"
        :rules="userRules"
        :wrapper-col="{ span: 17 }"
      >
        <Form.Item label="用户名" name="username">
          <Input
            v-model:value="userFormModel.username"
            :disabled="!!editingUserId"
            allow-clear
            placeholder="请输入用户名"
          />
        </Form.Item>
        <Form.Item :label="editingUserId ? '重置密码' : '密码'" name="password">
          <Input.Password
            v-model:value="userFormModel.password"
            allow-clear
            :placeholder="editingUserId ? '不填写则保持原密码' : '请输入密码'"
          />
        </Form.Item>
        <Form.Item label="昵称" name="displayName">
          <Input
            v-model:value="userFormModel.displayName"
            allow-clear
            placeholder="请输入昵称"
          />
        </Form.Item>
        <Form.Item label="邮箱" name="email">
          <Input
            v-model:value="userFormModel.email"
            allow-clear
            placeholder="请输入邮箱"
          />
        </Form.Item>
        <Form.Item label="状态" name="status">
          <Select
            v-model:value="userFormModel.status"
            :options="[
              { label: '启用', value: 'active' },
              { label: '禁用', value: 'disabled' },
            ]"
          />
        </Form.Item>
        <Form.Item label="角色" name="roleIds">
          <Select
            v-model:value="userFormModel.roleIds"
            :options="roleOptions"
            allow-clear
            mode="multiple"
            placeholder="请选择角色"
          />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
