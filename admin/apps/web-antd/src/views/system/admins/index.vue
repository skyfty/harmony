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
    ? t('page.systemAdmins.index.modal.edit')
    : t('page.systemAdmins.index.modal.create'),
);

const adminRules = computed(() => ({
  username: [
    {
      message: t('page.systemAdmins.index.form.username.required'),
      required: true,
      type: 'string',
      trigger: 'blur',
    },
  ],
  password: editingAdminId.value
    ? []
    : [
        {
          message: t('page.systemAdmins.index.form.password.required'),
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
      message.success(t('page.systemAdmins.index.message.updateSuccess'));
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
      message.success(t('page.systemAdmins.index.message.createSuccess'));
    }
    modalOpen.value = false;
    adminGridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(record: AdminItem) {
  Modal.confirm({
    title: t('page.systemAdmins.index.confirm.delete.title', {
      username: record.username,
    }),
    content: t('page.systemAdmins.index.confirm.delete.content'),
    okType: 'danger',
    onOk: async () => {
      await deleteAdminApi(record.id);
      message.success(t('page.systemAdmins.index.message.deleteSuccess'));
      adminGridApi.reload();
    },
  });
}

async function handleStatusChange(record: AdminItem, checked: boolean) {
  changingStatusId.value = record.id;
  try {
    await updateAdminStatusApi(record.id, checked ? 'active' : 'disabled');
    message.success(t('page.systemAdmins.index.message.statusUpdate'));
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
        label: t('page.systemAdmins.index.table.keyword'),
        componentProps: {
          allowClear: true,
          placeholder: t('page.systemAdmins.index.table.keyword'),
        },
      },
      {
        component: 'Select',
        fieldName: 'status',
        label: t('page.systemAdmins.index.table.status'),
        componentProps: {
          allowClear: true,
          options: [
            {
              label: t('page.systemAdmins.index.form.status.options.active'),
              value: 'active',
            },
            {
              label: t('page.systemAdmins.index.form.status.options.disabled'),
              value: 'disabled',
            },
          ],
          placeholder: t('page.systemAdmins.index.form.status.placeholder'),
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
        title: t('page.systemAdmins.index.table.username'),
      },
      {
        field: 'displayName',
        minWidth: 140,
        title: t('page.systemAdmins.index.table.displayName'),
      },
      {
        field: 'email',
        minWidth: 180,
        title: t('page.systemAdmins.index.table.email'),
      },
      {
        field: 'roles',
        minWidth: 220,
        title: t('page.systemAdmins.index.table.roles'),
        slots: { default: 'roles' },
      },
      {
        field: 'status',
        minWidth: 160,
        title: t('page.systemAdmins.index.table.status'),
        slots: { default: 'status' },
      },
      {
        field: 'createdAt',
        minWidth: 180,
        sortable: true,
        formatter: 'formatDateTime',
        title: t('page.systemAdmins.index.table.createdAt'),
      },
      {
        field: 'updatedAt',
        minWidth: 180,
        sortable: true,
        formatter: 'formatDateTime',
        title: t('page.systemAdmins.index.table.updatedAt'),
      },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 220,
        slots: { default: 'actions' },
        title: t('page.systemAdmins.index.table.actions'),
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
  tableTitle: t('page.systemAdmins.index.table.title'),
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
          {{ t('page.systemAdmins.index.toolbar.create') }}
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
            {{ row.status === 'active' ? t('page.systemAdmins.index.form.status.options.active') : t('page.systemAdmins.index.form.status.options.disabled') }}
          </Tag>
          <Switch
            v-access:code="'admin:super'"
            :checked="row.status === 'active'"
            :loading="changingStatusId === row.id"
            :checked-children="t('page.systemAdmins.index.form.status.checkedChildren')"
            :un-checked-children="t('page.systemAdmins.index.form.status.unCheckedChildren')"
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
            {{ t('page.systemAdmins.index.actions.edit') }}
          </Button>
          <Button
            v-access:code="'admin:super'"
            danger
            size="small"
            type="link"
            @click="handleDelete(row)"
          >
            {{ t('page.systemAdmins.index.actions.delete') }}
          </Button>
        </Space>
      </template>
    </AdminGrid>

    <Modal
      :confirm-loading="submitting"
      :open="modalOpen"
      :title="modalTitle"
      destroy-on-close
      :ok-text="t('page.systemAdmins.index.modal.ok')"
      :cancel-text="t('page.systemAdmins.index.modal.cancel')"
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
        <Form.Item :label="t('page.systemAdmins.index.form.username.label')" name="username">
          <Input
            v-model:value="adminFormModel.username"
            :disabled="!!editingAdminId"
            allow-clear
            :placeholder="t('page.systemAdmins.index.form.username.placeholder')"
          />
        </Form.Item>
        <Form.Item :label="editingAdminId ? t('page.systemAdmins.index.form.password.reset') : t('page.systemAdmins.index.form.password.label')" name="password">
          <Input.Password
            v-model:value="adminFormModel.password"
            allow-clear
            :placeholder="editingAdminId ? t('page.systemAdmins.index.form.password.keep') : t('page.systemAdmins.index.form.password.placeholder')"
          />
        </Form.Item>
        <Form.Item :label="t('page.systemAdmins.index.form.displayName.label')" name="displayName">
          <Input
            v-model:value="adminFormModel.displayName"
            allow-clear
            :placeholder="t('page.systemAdmins.index.form.displayName.placeholder')"
          />
        </Form.Item>
        <Form.Item :label="t('page.systemAdmins.index.form.email.label')" name="email">
          <Input
            v-model:value="adminFormModel.email"
            allow-clear
            :placeholder="t('page.systemAdmins.index.form.email.placeholder')"
          />
        </Form.Item>
        <Form.Item :label="t('page.systemAdmins.index.form.status.label')" name="status">
          <Select
            v-model:value="adminFormModel.status"
            :options="[
              { label: t('page.systemAdmins.index.form.status.options.active'), value: 'active' },
              { label: t('page.systemAdmins.index.form.status.options.disabled'), value: 'disabled' },
            ]"
          />
        </Form.Item>
        <Form.Item :label="t('page.systemAdmins.index.form.roles.label')" name="roleIds">
          <Select
            v-model:value="adminFormModel.roleIds"
            :options="roleOptions"
            allow-clear
            mode="multiple"
            :placeholder="t('page.systemAdmins.index.form.roles.placeholder')"
          />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
