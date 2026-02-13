<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';

import type {
  CreatePermissionPayload,
  CreateRolePayload,
  PermissionItem,
  PermissionOption,
  RoleItem,
  UpdatePermissionPayload,
  UpdateRolePayload,
} from '#/api';

import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createPermissionApi,
  createRoleApi,
  deletePermissionApi,
  deleteRoleApi,
  getRoleApi,
  listPermissionOptionsApi,
  listPermissionsApi,
  listRolesApi,
  updatePermissionApi,
  updateRoleApi,
} from '#/api';

import {
  Button,
  Form,
  Input,
  message,
  Modal,
  Select,
  Space,
  Tabs,
  Tag,
} from 'ant-design-vue';

interface RoleFormModel {
  code: string;
  description: string;
  name: string;
  permissionIds: string[];
}

interface PermissionFormModel {
  code: string;
  description: string;
  group: string;
  name: string;
}

const activeTab = ref<'permissions' | 'roles'>('roles');

const permissionOptions = ref<PermissionOption[]>([]);
const permissionGroupOptions = computed(() => {
  const groups = new Set(
    permissionOptions.value.map((item) => item.group).filter(Boolean),
  );
  return Array.from(groups).map((group) => ({
    label: group as string,
    value: group as string,
  }));
});
const permissionCodeNameMap = computed(() => {
  return new Map(permissionOptions.value.map((item) => [item.code, item.name]));
});

const { t } = useI18n();

const roleModalOpen = ref(false);
const roleSubmitting = ref(false);
const editingRoleId = ref<null | string>(null);
const roleFormRef = ref<FormInstance>();
const roleFormModel = reactive<RoleFormModel>({
  code: '',
  description: '',
  name: '',
  permissionIds: [],
});

const permissionModalOpen = ref(false);
const permissionSubmitting = ref(false);
const editingPermissionId = ref<null | string>(null);
const permissionFormRef = ref<FormInstance>();
const permissionFormModel = reactive<PermissionFormModel>({
  code: '',
  description: '',
  group: '',
  name: '',
});

const roleRules = {
  code: [{ message: t('page.rolesPermissions.index.role.form.code.required'), required: true, type: 'string', trigger: 'blur' }],
  name: [{ message: t('page.rolesPermissions.index.role.form.name.required'), required: true, type: 'string', trigger: 'blur' }],
} as Record<string, any>;

const permissionRules = {
  code: [{ message: t('page.rolesPermissions.index.permission.form.code.required'), required: true, type: 'string', trigger: 'blur' }],
  name: [{ message: t('page.rolesPermissions.index.permission.form.name.required'), required: true, type: 'string', trigger: 'blur' }],
} as Record<string, any>;

const roleModalTitle = computed(() => (editingRoleId.value ? t('page.rolesPermissions.index.role.modal.edit') : t('page.rolesPermissions.index.role.modal.create')));
const permissionModalTitle = computed(() => (editingPermissionId.value ? t('page.rolesPermissions.index.permission.modal.edit') : t('page.rolesPermissions.index.permission.modal.create')));

function resetRoleForm() {
  roleFormModel.name = '';
  roleFormModel.code = '';
  roleFormModel.description = '';
  roleFormModel.permissionIds = [];
}

function resetPermissionForm() {
  permissionFormModel.name = '';
  permissionFormModel.code = '';
  permissionFormModel.group = '';
  permissionFormModel.description = '';
}

async function loadPermissionOptions() {
  permissionOptions.value = await listPermissionOptionsApi();
}

function openCreateRole() {
  editingRoleId.value = null;
  resetRoleForm();
  roleModalOpen.value = true;
}

async function openEditRole(record: RoleItem) {
  editingRoleId.value = record.id;
  const detail = await getRoleApi(record.id);
  roleFormModel.name = detail.name;
  roleFormModel.code = detail.code;
  roleFormModel.description = detail.description || '';
  const codeIdMap = new Map(permissionOptions.value.map((item) => [item.code, item.id]));
  roleFormModel.permissionIds = (detail.permissions || [])
    .map((code) => codeIdMap.get(code))
    .filter(Boolean) as string[];
  roleModalOpen.value = true;
}

async function submitRole() {
  const form = roleFormRef.value;
  if (!form) {
    return;
  }
  await form.validate();
  roleSubmitting.value = true;
  try {
    if (editingRoleId.value) {
      const payload: UpdateRolePayload = {
        name: roleFormModel.name,
        code: roleFormModel.code,
        description: roleFormModel.description || undefined,
        permissionIds: roleFormModel.permissionIds,
      };
      await updateRoleApi(editingRoleId.value, payload);
      message.success(t('page.rolesPermissions.index.role.message.updateSuccess'));
    } else {
      const payload: CreateRolePayload = {
        name: roleFormModel.name,
        code: roleFormModel.code,
        description: roleFormModel.description || undefined,
        permissionIds: roleFormModel.permissionIds,
      };
      await createRoleApi(payload);
      message.success(t('page.rolesPermissions.index.role.message.createSuccess'));
    }
    roleModalOpen.value = false;
    await loadPermissionOptions();
    roleGridApi.reload();
    permissionGridApi.reload();
  } finally {
    roleSubmitting.value = false;
  }
}

function handleDeleteRole(record: RoleItem) {
  Modal.confirm({
    title: t('page.rolesPermissions.index.role.confirm.delete.title', { name: record.name }),
    content: t('page.rolesPermissions.index.role.confirm.delete.content'),
    okType: 'danger',
    onOk: async () => {
      await deleteRoleApi(record.id);
      message.success(t('page.rolesPermissions.index.role.message.deleteSuccess'));
      roleGridApi.reload();
    },
  });
}

function openCreatePermission() {
  editingPermissionId.value = null;
  resetPermissionForm();
  permissionModalOpen.value = true;
}

function openEditPermission(record: PermissionItem) {
  editingPermissionId.value = record.id;
  permissionFormModel.name = record.name;
  permissionFormModel.code = record.code;
  permissionFormModel.group = record.group || '';
  permissionFormModel.description = record.description || '';
  permissionModalOpen.value = true;
}

async function submitPermission() {
  const form = permissionFormRef.value;
  if (!form) {
    return;
  }
  await form.validate();
  permissionSubmitting.value = true;
  try {
    if (editingPermissionId.value) {
      const payload: UpdatePermissionPayload = {
        name: permissionFormModel.name,
        code: permissionFormModel.code,
        group: permissionFormModel.group || undefined,
        description: permissionFormModel.description || undefined,
      };
      await updatePermissionApi(editingPermissionId.value, payload);
      message.success(t('page.rolesPermissions.index.permission.message.updateSuccess'));
    } else {
      const payload: CreatePermissionPayload = {
        name: permissionFormModel.name,
        code: permissionFormModel.code,
        group: permissionFormModel.group || undefined,
        description: permissionFormModel.description || undefined,
      };
      await createPermissionApi(payload);
      message.success(t('page.rolesPermissions.index.permission.message.createSuccess'));
    }
    permissionModalOpen.value = false;
    await loadPermissionOptions();
    permissionGridApi.reload();
    roleGridApi.reload();
  } finally {
    permissionSubmitting.value = false;
  }
}

function handleDeletePermission(record: PermissionItem) {
  Modal.confirm({
    title: t('page.rolesPermissions.index.permission.confirm.delete.title', { name: record.name }),
    content: t('page.rolesPermissions.index.permission.confirm.delete.content'),
    okType: 'danger',
    onOk: async () => {
      await deletePermissionApi(record.id);
      message.success(t('page.rolesPermissions.index.permission.message.deleteSuccess'));
      await loadPermissionOptions();
      permissionGridApi.reload();
      roleGridApi.reload();
    },
  });
}

const [RoleGrid, roleGridApi] = useVbenVxeGrid<RoleItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: t('page.rolesPermissions.index.role.table.keyword'),
        componentProps: {
          allowClear: true,
          placeholder: t('page.rolesPermissions.index.role.table.keywordPlaceholder'),
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 160, sortable: true, title: t('page.rolesPermissions.index.role.table.name') },
      { field: 'code', minWidth: 180, sortable: true, title: t('page.rolesPermissions.index.role.table.code') },
      { field: 'description', minWidth: 220, title: t('page.rolesPermissions.index.role.table.description') },
      {
        field: 'permissions',
        minWidth: 320,
        slots: { default: 'role-permissions' },
        title: t('page.rolesPermissions.index.role.table.permissions'),
      },
      {
        field: 'createdAt',
        minWidth: 180,
        sortable: true,
        formatter: 'formatDateTime',
        title: t('page.rolesPermissions.index.role.table.createdAt'),
      },
      {
        field: 'updatedAt',
        minWidth: 180,
        sortable: true,
        formatter: 'formatDateTime',
        title: t('page.rolesPermissions.index.role.table.updatedAt'),
      },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 180,
        slots: { default: 'role-actions' },
        title: t('page.rolesPermissions.index.role.table.actions'),
      },
    ],
    pagerConfig: {
      pageSize: 20,
    },
    proxyConfig: {
      ajax: {
        query: async ({ page }: { page: { currentPage: number; pageSize: number } }, formValues: Record<string, any>) => {
          return await listRolesApi({
            keyword: formValues.keyword,
            page: page.currentPage,
            pageSize: page.pageSize,
          });
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
  tableTitle: t('page.rolesPermissions.index.role.table.title'),
});

const [PermissionGrid, permissionGridApi] = useVbenVxeGrid<PermissionItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: t('page.rolesPermissions.index.permission.table.keyword'),
        componentProps: {
          allowClear: true,
          placeholder: t('page.rolesPermissions.index.permission.table.keywordPlaceholder'),
        },
      },
      {
        component: 'Select',
        fieldName: 'group',
        label: t('page.rolesPermissions.index.permission.table.group'),
        componentProps: {
          allowClear: true,
          options: permissionGroupOptions,
          placeholder: t('page.rolesPermissions.index.permission.table.groupPlaceholder'),
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 170, sortable: true, title: t('page.rolesPermissions.index.permission.table.name') },
      { field: 'code', minWidth: 200, sortable: true, title: t('page.rolesPermissions.index.permission.table.code') },
      { field: 'group', minWidth: 160, sortable: true, title: t('page.rolesPermissions.index.permission.table.group') },
      { field: 'description', minWidth: 240, title: t('page.rolesPermissions.index.permission.table.description') },
      {
        field: 'createdAt',
        minWidth: 180,
        sortable: true,
        formatter: 'formatDateTime',
        title: t('page.rolesPermissions.index.permission.table.createdAt'),
      },
      {
        field: 'updatedAt',
        minWidth: 180,
        sortable: true,
        formatter: 'formatDateTime',
        title: t('page.rolesPermissions.index.permission.table.updatedAt'),
      },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 180,
        slots: { default: 'permission-actions' },
        title: t('page.rolesPermissions.index.permission.table.actions'),
      },
    ],
    pagerConfig: {
      pageSize: 20,
    },
    proxyConfig: {
      ajax: {
        query: async ({ page }: { page: { currentPage: number; pageSize: number } }, formValues: Record<string, any>) => {
          const result = await listPermissionsApi({
            keyword: formValues.keyword,
            page: page.currentPage,
            pageSize: page.pageSize,
          });
          if (!formValues.group) {
            return result;
          }
          const filteredItems = result.items.filter(
            (item) => item.group === formValues.group,
          );
          return {
            items: filteredItems,
            total: filteredItems.length,
          };
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
  tableTitle: t('page.rolesPermissions.index.permission.table.title'),
});

onMounted(async () => {
  await loadPermissionOptions();
});
</script>

<template>
  <div class="p-5">
    <Tabs v-model:active-key="activeTab">
      <Tabs.TabPane key="roles" :tab="t('page.rolesPermissions.index.tabs.roles')">
        <RoleGrid>
          <template #toolbar-actions>
            <Button
              v-access:code="'role:write'"
              type="primary"
              @click="openCreateRole"
            >
              {{ t('page.rolesPermissions.index.role.toolbar.create') }}
            </Button>
          </template>

          <template #role-permissions="{ row }">
            <Space wrap>
              <Tag v-for="permissionCode in row.permissions" :key="permissionCode" color="purple">
                {{ permissionCodeNameMap.get(permissionCode) || permissionCode }}
              </Tag>
              <span v-if="!row.permissions?.length" class="text-text-secondary">-</span>
            </Space>
          </template>

          <template #role-actions="{ row }">
            <Space>
              <Button
                v-access:code="'role:write'"
                size="small"
                type="link"
                @click="openEditRole(row)"
              >
                {{ t('page.rolesPermissions.index.role.actions.edit') }}
              </Button>
              <Button
                v-access:code="'role:write'"
                danger
                size="small"
                type="link"
                @click="handleDeleteRole(row)"
              >
                {{ t('page.rolesPermissions.index.role.actions.delete') }}
              </Button>
            </Space>
          </template>
        </RoleGrid>
      </Tabs.TabPane>

      <Tabs.TabPane key="permissions" :tab="t('page.rolesPermissions.index.tabs.permissions')">
        <PermissionGrid>
          <template #toolbar-actions>
            <Button
              v-access:code="'permission:write'"
              type="primary"
              @click="openCreatePermission"
            >
              {{ t('page.rolesPermissions.index.permission.toolbar.create') }}
            </Button>
          </template>

          <template #permission-actions="{ row }">
            <Space>
              <Button
                v-access:code="'permission:write'"
                size="small"
                type="link"
                @click="openEditPermission(row)"
              >
                {{ t('page.rolesPermissions.index.permission.actions.edit') }}
              </Button>
              <Button
                v-access:code="'permission:write'"
                danger
                size="small"
                type="link"
                @click="handleDeletePermission(row)"
              >
                {{ t('page.rolesPermissions.index.permission.actions.delete') }}
              </Button>
            </Space>
          </template>
        </PermissionGrid>
      </Tabs.TabPane>
    </Tabs>

    <Modal
      :confirm-loading="roleSubmitting"
      :open="roleModalOpen"
      :title="roleModalTitle"
      destroy-on-close
      :ok-text="t('page.rolesPermissions.index.role.modal.ok')"
      :cancel-text="t('page.rolesPermissions.index.role.modal.cancel')"
      @cancel="roleModalOpen = false"
      @ok="submitRole"
    >
      <Form
        ref="roleFormRef"
        :label-col="{ span: 6 }"
        :model="roleFormModel"
        :rules="roleRules"
        :wrapper-col="{ span: 17 }"
      >
        <Form.Item :label="t('page.rolesPermissions.index.role.form.name.label')" name="name">
          <Input
            v-model:value="roleFormModel.name"
            allow-clear
            :placeholder="t('page.rolesPermissions.index.role.form.name.placeholder')"
          />
        </Form.Item>
        <Form.Item :label="t('page.rolesPermissions.index.role.form.code.label')" name="code">
          <Input
            v-model:value="roleFormModel.code"
            allow-clear
            :placeholder="t('page.rolesPermissions.index.role.form.code.placeholder')"
          />
        </Form.Item>
        <Form.Item :label="t('page.rolesPermissions.index.role.form.description.label')" name="description">
          <Input.TextArea
            v-model:value="roleFormModel.description"
            :rows="3"
            allow-clear
            :placeholder="t('page.rolesPermissions.index.role.form.description.placeholder')"
          />
        </Form.Item>
        <Form.Item :label="t('page.rolesPermissions.index.role.form.permissions.label')" name="permissionIds">
          <Select
            v-model:value="roleFormModel.permissionIds"
            :options="permissionOptions.map((item) => ({ label: `${item.name} (${item.code})`, value: item.id }))"
            allow-clear
            mode="multiple"
            option-filter-prop="label"
            :placeholder="t('page.rolesPermissions.index.role.form.permissions.placeholder')"
            show-search
          />
        </Form.Item>
      </Form>
    </Modal>

    <Modal
      :confirm-loading="permissionSubmitting"
      :open="permissionModalOpen"
      :title="permissionModalTitle"
      destroy-on-close
      :ok-text="t('page.rolesPermissions.index.permission.modal.ok')"
      :cancel-text="t('page.rolesPermissions.index.permission.modal.cancel')"
      @cancel="permissionModalOpen = false"
      @ok="submitPermission"
    >
      <Form
        ref="permissionFormRef"
        :label-col="{ span: 6 }"
        :model="permissionFormModel"
        :rules="permissionRules"
        :wrapper-col="{ span: 17 }"
      >
        <Form.Item :label="t('page.rolesPermissions.index.permission.form.name.label')" name="name">
          <Input
            v-model:value="permissionFormModel.name"
            allow-clear
            :placeholder="t('page.rolesPermissions.index.permission.form.name.placeholder')"
          />
        </Form.Item>
        <Form.Item :label="t('page.rolesPermissions.index.permission.form.code.label')" name="code">
          <Input
            v-model:value="permissionFormModel.code"
            allow-clear
            :placeholder="t('page.rolesPermissions.index.permission.form.code.placeholder')"
          />
        </Form.Item>
        <Form.Item :label="t('page.rolesPermissions.index.permission.form.group.label')" name="group">
          <Input
            v-model:value="permissionFormModel.group"
            allow-clear
            :placeholder="t('page.rolesPermissions.index.permission.form.group.placeholder')"
          />
        </Form.Item>
        <Form.Item :label="t('page.rolesPermissions.index.permission.form.description.label')" name="description">
          <Input.TextArea
            v-model:value="permissionFormModel.description"
            :rows="3"
            allow-clear
            :placeholder="t('page.rolesPermissions.index.permission.form.description.placeholder')"
          />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
