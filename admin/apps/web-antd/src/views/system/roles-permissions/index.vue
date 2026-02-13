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
  code: [{ message: '请输入角色编码', required: true, type: 'string', trigger: 'blur' }],
  name: [{ message: '请输入角色名称', required: true, type: 'string', trigger: 'blur' }],
} as Record<string, any>;

const permissionRules = {
  code: [{ message: '请输入权限编码', required: true, type: 'string', trigger: 'blur' }],
  name: [{ message: '请输入权限名称', required: true, type: 'string', trigger: 'blur' }],
} as Record<string, any>;

const roleModalTitle = computed(() =>
  editingRoleId.value ? '编辑角色' : '新增角色',
);
const permissionModalTitle = computed(() =>
  editingPermissionId.value ? '编辑权限' : '新增权限',
);

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
      message.success('角色更新成功');
    } else {
      const payload: CreateRolePayload = {
        name: roleFormModel.name,
        code: roleFormModel.code,
        description: roleFormModel.description || undefined,
        permissionIds: roleFormModel.permissionIds,
      };
      await createRoleApi(payload);
      message.success('角色创建成功');
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
    title: `确认删除角色“${record.name}”吗？`,
    content: '删除后不可恢复。',
    okType: 'danger',
    onOk: async () => {
      await deleteRoleApi(record.id);
      message.success('角色删除成功');
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
      message.success('权限更新成功');
    } else {
      const payload: CreatePermissionPayload = {
        name: permissionFormModel.name,
        code: permissionFormModel.code,
        group: permissionFormModel.group || undefined,
        description: permissionFormModel.description || undefined,
      };
      await createPermissionApi(payload);
      message.success('权限创建成功');
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
    title: `确认删除权限“${record.name}”吗？`,
    content: '删除后不可恢复。',
    okType: 'danger',
    onOk: async () => {
      await deletePermissionApi(record.id);
      message.success('权限删除成功');
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
        label: '关键字',
        componentProps: {
          allowClear: true,
          placeholder: '角色名 / 编码',
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 160, sortable: true, title: '角色名称' },
      { field: 'code', minWidth: 180, sortable: true, title: '角色编码' },
      { field: 'description', minWidth: 220, title: '描述' },
      {
        field: 'permissions',
        minWidth: 320,
        slots: { default: 'role-permissions' },
        title: '权限集',
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
        minWidth: 180,
        slots: { default: 'role-actions' },
        title: '操作',
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
  tableTitle: '角色管理',
});

const [PermissionGrid, permissionGridApi] = useVbenVxeGrid<PermissionItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键字',
        componentProps: {
          allowClear: true,
          placeholder: '权限名 / 编码',
        },
      },
      {
        component: 'Select',
        fieldName: 'group',
        label: '分组',
        componentProps: {
          allowClear: true,
          options: permissionGroupOptions,
          placeholder: '全部分组',
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 170, sortable: true, title: '权限名称' },
      { field: 'code', minWidth: 200, sortable: true, title: '权限编码' },
      { field: 'group', minWidth: 160, sortable: true, title: '分组' },
      { field: 'description', minWidth: 240, title: '描述' },
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
        minWidth: 180,
        slots: { default: 'permission-actions' },
        title: '操作',
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
  tableTitle: '权限管理',
});

onMounted(async () => {
  await loadPermissionOptions();
});
</script>

<template>
  <div class="p-5">
    <Tabs v-model:active-key="activeTab">
      <Tabs.TabPane key="roles" tab="角色管理">
        <RoleGrid>
          <template #toolbar-actions>
            <Button
              v-access:code="'role:write'"
              type="primary"
              @click="openCreateRole"
            >
              新增角色
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
                编辑
              </Button>
              <Button
                v-access:code="'role:write'"
                danger
                size="small"
                type="link"
                @click="handleDeleteRole(row)"
              >
                删除
              </Button>
            </Space>
          </template>
        </RoleGrid>
      </Tabs.TabPane>

      <Tabs.TabPane key="permissions" tab="权限管理">
        <PermissionGrid>
          <template #toolbar-actions>
            <Button
              v-access:code="'permission:write'"
              type="primary"
              @click="openCreatePermission"
            >
              新增权限
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
                编辑
              </Button>
              <Button
                v-access:code="'permission:write'"
                danger
                size="small"
                type="link"
                @click="handleDeletePermission(row)"
              >
                删除
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
      ok-text="保存"
      cancel-text="取消"
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
        <Form.Item label="角色名称" name="name">
          <Input
            v-model:value="roleFormModel.name"
            allow-clear
            placeholder="请输入角色名称"
          />
        </Form.Item>
        <Form.Item label="角色编码" name="code">
          <Input
            v-model:value="roleFormModel.code"
            allow-clear
            placeholder="请输入角色编码"
          />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input.TextArea
            v-model:value="roleFormModel.description"
            :rows="3"
            allow-clear
            placeholder="请输入描述"
          />
        </Form.Item>
        <Form.Item label="权限集" name="permissionIds">
          <Select
            v-model:value="roleFormModel.permissionIds"
            :options="permissionOptions.map((item) => ({ label: `${item.name} (${item.code})`, value: item.id }))"
            allow-clear
            mode="multiple"
            option-filter-prop="label"
            placeholder="请选择权限"
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
      ok-text="保存"
      cancel-text="取消"
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
        <Form.Item label="权限名称" name="name">
          <Input
            v-model:value="permissionFormModel.name"
            allow-clear
            placeholder="请输入权限名称"
          />
        </Form.Item>
        <Form.Item label="权限编码" name="code">
          <Input
            v-model:value="permissionFormModel.code"
            allow-clear
            placeholder="请输入权限编码"
          />
        </Form.Item>
        <Form.Item label="分组" name="group">
          <Input
            v-model:value="permissionFormModel.group"
            allow-clear
            placeholder="请输入分组（可选）"
          />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input.TextArea
            v-model:value="permissionFormModel.description"
            :rows="3"
            allow-clear
            placeholder="请输入描述"
          />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
