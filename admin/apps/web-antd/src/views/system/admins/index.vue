<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';

import type {
  AdminItem,
  CreateAdminPayload,
  RoleItem,
  UpdateAdminPayload,
} from '#/api';

import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createAdminApi,
  deleteAdminApi,
  listAdminsApi,
  listRolesApi,
  updateAdminApi,
  updateAdminStatusApi,
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

interface AdminFormModel {
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
const editingAdminId = ref<null | string>(null);
const changingStatusId = ref<null | string>(null);
const adminFormRef = ref<FormInstance>();

const adminFormModel = reactive<AdminFormModel>({
  displayName: '',
  email: '',
  password: '',
  roleIds: [],
  status: 'active',
  username: '',
});

const { t } = useI18n();
const modalTitle = computed(() =>
  editingAdminId.value
    ? t('page.systemUsers.index.modal.edit')
    : t('page.systemUsers.index.modal.create'),
);

const adminRules = computed(() => ({
  username: [
    {
      message: t('page.systemUsers.index.form.username.required'),
      required: true,
      type: 'string',
      trigger: 'blur',
    },
  ],
  password: editingAdminId.value
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

function resetAdminForm() {
  adminFormModel.username = '';
  adminFormModel.password = '';
  adminFormModel.displayName = '';
  adminFormModel.email = '';
  adminFormModel.status = 'active';
  adminFormModel.roleIds = [];
}

function openCreateModal() {
  editingAdminId.value = null;
  resetAdminForm();
  modalOpen.value = true;
}

function openEditModal(record: AdminItem) {
  editingAdminId.value = record.id;
  adminFormModel.username = record.username;
  adminFormModel.password = '';
  adminFormModel.displayName = record.displayName || '';
  adminFormModel.email = record.email || '';
  adminFormModel.status = record.status;
  adminFormModel.roleIds = record.roles?.map((role) => role.id) || [];
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

async function submitAdmin() {
  const form = adminFormRef.value;
  if (!form) {
    return;
  }
  await form.validate();
  submitting.value = true;
  try {
    if (editingAdminId.value) {
      const payload: UpdateAdminPayload = {
        displayName: adminFormModel.displayName || undefined,
        email: adminFormModel.email || undefined,
        roleIds: adminFormModel.roleIds,
        status: adminFormModel.status,
      };
      if (adminFormModel.password?.trim()) {
        payload.password = adminFormModel.password.trim();
      }
      await updateAdminApi(editingAdminId.value, payload);
      message.success(t('page.systemUsers.index.message.updateSuccess'));
    } else {
      const payload: CreateAdminPayload = {
        username: adminFormModel.username.trim(),
        password: adminFormModel.password,
        displayName: adminFormModel.displayName || undefined,
        email: adminFormModel.email || undefined,
        roleIds: adminFormModel.roleIds,
        status: adminFormModel.status,
      };
      await createAdminApi(payload);
      message.success(t('page.systemUsers.index.message.createSuccess'));
    }
    modalOpen.value = false;
    adminGridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(record: AdminItem) {
  Modal.confirm({
    title: t('page.systemUsers.index.confirm.delete.title', {
      username: record.username,
    }),
    content: t('page.systemUsers.index.confirm.delete.content'),
    okType: 'danger',
    onOk: async () => {
      await deleteAdminApi(record.id);
      message.success(t('page.systemUsers.index.message.deleteSuccess'));
      adminGridApi.reload();
    },
  });
}

async function handleStatusChange(record: AdminItem, checked: boolean) {
  changingStatusId.value = record.id;
  try {
    await updateAdminStatusApi(record.id, checked ? 'active' : 'disabled');
    message.success(t('page.systemUsers.index.message.statusUpdate'));
    adminGridApi.reload();
  } finally {
    changingStatusId.value = null;
  }
}

const [AdminGrid, adminGridApi] = useVbenVxeGrid<AdminItem>({
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
            {
              label: t('page.systemUsers.index.form.status.options.active'),
              value: 'active',
            },
            {
              label: t('page.systemUsers.index.form.status.options.disabled'),
              value: 'disabled',
            },
          ],
          placeholder: t('page.systemUsers.index.form.status.placeholder'),
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      {
        field: 'username',
        minWidth: 150,
        sortable: true,
        title: t('page.systemUsers.index.table.username'),
      },
      {
        field: 'displayName',
        minWidth: 140,
        title: t('page.systemUsers.index.table.displayName'),
      },
      {
        field: 'email',
        minWidth: 180,
        title: t('page.systemUsers.index.table.email'),
      },
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
        query: async (
          { page }: { page: { currentPage: number; pageSize: number } },
          formValues: Record<string, any>,
        ) => {
          const params = {
            keyword: formValues.keyword,
            page: page.currentPage,
            pageSize: page.pageSize,
            status: formValues.status || undefined,
          };
          return await listAdminsApi(params);
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
  tableTitle: '管理员管理',
});

onMounted(async () => {
  await loadRoleOptions();
});
</script>

<template>
  <div class="p-5">
    <AdminGrid>
      <template #toolbar-actions>
        <Button v-access:code="'admin:super'" type="primary" @click="openCreateModal">
          新增管理员
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
            v-access:code="'admin:super'"
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
            v-access:code="'admin:super'"
            size="small"
            type="link"
            @click="openEditModal(row)"
          >
            编辑
          </Button>
          <Button
            v-access:code="'admin:super'"
            danger
            size="small"
            type="link"
            @click="handleDelete(row)"
          >
            删除
          </Button>
        </Space>
      </template>
    </AdminGrid>

    <Modal
      :confirm-loading="submitting"
      :open="modalOpen"
      :title="modalTitle"
      destroy-on-close
      ok-text="保存"
      cancel-text="取消"
      @cancel="closeModal"
      @ok="submitAdmin"
    >
      <Form
        ref="adminFormRef"
        :label-col="{ span: 6 }"
        :model="adminFormModel"
        :rules="adminRules"
        :wrapper-col="{ span: 17 }"
      >
        <Form.Item label="用户名" name="username">
          <Input
            v-model:value="adminFormModel.username"
            :disabled="!!editingAdminId"
            allow-clear
            placeholder="请输入用户名"
          />
        </Form.Item>
        <Form.Item :label="editingAdminId ? '重置密码' : '密码'" name="password">
          <Input.Password
            v-model:value="adminFormModel.password"
            allow-clear
            :placeholder="editingAdminId ? '不填写则保持原密码' : '请输入密码'"
          />
        </Form.Item>
        <Form.Item label="昵称" name="displayName">
          <Input
            v-model:value="adminFormModel.displayName"
            allow-clear
            placeholder="请输入昵称"
          />
        </Form.Item>
        <Form.Item label="邮箱" name="email">
          <Input
            v-model:value="adminFormModel.email"
            allow-clear
            placeholder="请输入邮箱"
          />
        </Form.Item>
        <Form.Item label="状态" name="status">
          <Select
            v-model:value="adminFormModel.status"
            :options="[
              { label: '启用', value: 'active' },
              { label: '禁用', value: 'disabled' },
            ]"
          />
        </Form.Item>
        <Form.Item label="角色" name="roleIds">
          <Select
            v-model:value="adminFormModel.roleIds"
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
