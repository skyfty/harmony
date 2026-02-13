<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';

import type {
  CreateUserPayload,
  RoleItem,
  UpdateUserPayload,
  UserItem,
} from '#/api';

import { computed, onMounted, reactive, ref } from 'vue';

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

const modalTitle = computed(() =>
  editingUserId.value ? '编辑用户' : '新增用户',
);

const userRules = computed(() => ({
  username: [
    {
      message: '请输入用户名',
      required: true,
      type: 'string',
      trigger: 'blur',
    },
  ],
  password: editingUserId.value
    ? []
    : [
        {
          message: '请输入密码',
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
      message.success('用户更新成功');
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
      message.success('用户创建成功');
    }
    modalOpen.value = false;
    userGridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(record: UserItem) {
  Modal.confirm({
    title: `确认删除用户“${record.username}”吗？`,
    content: '删除后不可恢复。',
    okType: 'danger',
    onOk: async () => {
      await deleteUserApi(record.id);
      message.success('用户删除成功');
      userGridApi.reload();
    },
  });
}

async function handleStatusChange(record: UserItem, checked: boolean) {
  changingStatusId.value = record.id;
  try {
    await updateUserStatusApi(record.id, checked ? 'active' : 'disabled');
    message.success('状态更新成功');
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
        label: '关键字',
        componentProps: {
          allowClear: true,
          placeholder: '用户名 / 邮箱 / 昵称',
        },
      },
      {
        component: 'Select',
        fieldName: 'status',
        label: '状态',
        componentProps: {
          allowClear: true,
          options: [
            { label: '启用', value: 'active' },
            { label: '禁用', value: 'disabled' },
          ],
          placeholder: '全部状态',
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'username', minWidth: 150, sortable: true, title: '用户名' },
      { field: 'displayName', minWidth: 140, title: '昵称' },
      { field: 'email', minWidth: 180, title: '邮箱' },
      {
        field: 'roles',
        minWidth: 220,
        title: '角色',
        slots: { default: 'roles' },
      },
      {
        field: 'status',
        minWidth: 160,
        title: '状态',
        slots: { default: 'status' },
      },
      {
        field: 'createdAt',
        minWidth: 180,
        sortable: true,
        formatter: 'formatDateTime',
        title: '创建时间',
      },
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
        minWidth: 220,
        slots: { default: 'actions' },
        title: '操作',
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
  tableTitle: '用户管理',
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
