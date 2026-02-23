<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import type { UserItem, UserVehicleItem, VehicleItem } from '#/api';

import { onMounted, reactive, ref } from 'vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createUserVehicleApi,
  deleteUserVehicleApi,
  getUserVehicleApi,
  listUserVehiclesApi,
  listUsersApi,
  listVehiclesApi,
  updateUserVehicleApi,
} from '#/api';

import { Button, Form, message, Modal, Select, Space } from 'ant-design-vue';

interface UserVehicleFormModel {
  userId: string;
  vehicleId: string;
}

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<null | string>(null);
const userVehicleFormRef = ref<FormInstance>();

const userVehicleFormModel = reactive<UserVehicleFormModel>({
  userId: '',
  vehicleId: '',
});

const vehicleOptions = ref<Array<{ label: string; value: string }>>([]);
const userSearchLoading = ref(false);
const userSearchOptions = ref<Array<{ label: string; value: string }>>([]);
const userSearchToken = ref(0);

function resetForm() {
  userVehicleFormModel.userId = '';
  userVehicleFormModel.vehicleId = '';
  userSearchOptions.value = [];
}

function formatUserLabel(user: UserItem) {
  const name = user.displayName || user.username || user.id;
  const username = user.username ? ` @${user.username}` : '';
  return `${name}${username} (${user.id})`;
}

async function handleUserSearch(keyword = '') {
  const token = ++userSearchToken.value;
  userSearchLoading.value = true;
  try {
    const res = await listUsersApi({
      keyword: keyword.trim() || undefined,
      page: 1,
      pageSize: 20,
    });
    if (token !== userSearchToken.value) {
      return;
    }
    userSearchOptions.value = (res.items || []).map((item: UserItem) => ({
      label: formatUserLabel(item),
      value: item.id,
    }));
  } finally {
    if (token === userSearchToken.value) {
      userSearchLoading.value = false;
    }
  }
}

async function loadVehicleOptions() {
  const response = await listVehiclesApi({ page: 1, pageSize: 500 });
  vehicleOptions.value = (response.items || []).map((item: VehicleItem) => ({
    label: item.name,
    value: item.id,
  }));
}

function openCreateModal() {
  editingId.value = null;
  resetForm();
  modalOpen.value = true;
}

async function openEditModal(row: UserVehicleItem) {
  editingId.value = row.id;
  try {
    const data = await getUserVehicleApi(row.id);
    userVehicleFormModel.userId = data.userId || '';
    userVehicleFormModel.vehicleId = data.vehicleId || '';
    if (data.user) {
      userSearchOptions.value = [
        {
          label: formatUserLabel({
            id: data.user.id,
            username: data.user.username || '',
            displayName: data.user.displayName || '',
            status: 'active',
            createdAt: '',
            updatedAt: '',
            email: null,
          }),
          value: data.user.id,
        },
      ];
    }
    modalOpen.value = true;
  } catch {
    message.error('读取用户车辆失败');
  }
}

async function submitUserVehicle() {
  const form = userVehicleFormRef.value;
  if (!form) return;
  await form.validate();

  submitting.value = true;
  try {
    const payload = {
      userId: userVehicleFormModel.userId,
      vehicleId: userVehicleFormModel.vehicleId,
    };

    if (editingId.value) {
      await updateUserVehicleApi(editingId.value, payload);
      message.success('用户车辆更新成功');
    } else {
      await createUserVehicleApi(payload);
      message.success('用户车辆创建成功');
    }
    modalOpen.value = false;
    userVehicleGridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: UserVehicleItem) {
  Modal.confirm({
    title: '确认删除该用户车辆关系吗？',
    okType: 'danger',
    onOk: async () => {
      await deleteUserVehicleApi(row.id);
      message.success('已删除');
      userVehicleGridApi.reload();
    },
  });
}

const [UserVehicleGrid, userVehicleGridApi] = useVbenVxeGrid<UserVehicleItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键字',
        componentProps: { allowClear: true, placeholder: '用户/车辆关键词' },
      },
      {
        component: 'Select',
        fieldName: 'vehicleId',
        label: '车辆',
        componentProps: {
          allowClear: true,
          placeholder: '全部车辆',
          options: vehicleOptions,
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'vehicle.name', minWidth: 160, title: '车辆名称' },
      { field: 'user.displayName', minWidth: 160, title: '用户昵称' },
      { field: 'user.username', minWidth: 180, title: '用户名' },
      { field: 'ownedAt', minWidth: 180, formatter: 'formatDateTime', title: '拥有时间' },
      { field: 'createdAt', minWidth: 180, formatter: 'formatDateTime', title: '创建时间' },
      { align: 'left', fixed: 'right', minWidth: 160, field: 'actions', slots: { default: 'actions' }, title: '操作' },
    ],
    keepSource: true,
    pagerConfig: { pageSize: 20 },
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, formValues: Record<string, any>) => {
          return await listUserVehiclesApi({
            keyword: formValues.keyword || undefined,
            vehicleId: formValues.vehicleId || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
          });
        },
      },
    },
    toolbarConfig: { custom: true, refresh: true, search: true, zoom: true },
  },
  tableTitle: '用户车辆管理',
});

onMounted(async () => {
  await loadVehicleOptions();
});
</script>

<template>
  <div class="p-5">
    <UserVehicleGrid>
      <template #toolbar-actions>
        <Button v-access:code="'vehicle:write'" type="primary" @click="openCreateModal">新增用户车辆</Button>
      </template>

      <template #actions="{ row }">
        <Space>
          <Button v-access:code="'vehicle:write'" size="small" type="link" @click="openEditModal(row)">编辑</Button>
          <Button v-access:code="'vehicle:write'" danger size="small" type="link" @click="handleDelete(row)">删除</Button>
        </Space>
      </template>
    </UserVehicleGrid>

    <Modal
      :open="modalOpen"
      :title="editingId ? '编辑用户车辆' : '新增用户车辆'"
      :confirm-loading="submitting"
      ok-text="保存"
      cancel-text="取消"
      destroy-on-close
      @cancel="() => (modalOpen = false)"
      @ok="submitUserVehicle"
    >
      <Form ref="userVehicleFormRef" :label-col="{ span: 6 }" :model="userVehicleFormModel" :wrapper-col="{ span: 17 }">
        <Form.Item label="用户" name="userId" :rules="[{ required: true, message: '请选择用户' }]">
          <Select
            v-model:value="userVehicleFormModel.userId"
            :filter-option="false"
            :loading="userSearchLoading"
            :options="userSearchOptions"
            show-search
            placeholder="输入昵称/用户名搜索用户"
            @focus="() => handleUserSearch()"
            @search="handleUserSearch"
          />
        </Form.Item>
        <Form.Item label="车辆" name="vehicleId" :rules="[{ required: true, message: '请选择车辆' }]">
          <Select
            v-model:value="userVehicleFormModel.vehicleId"
            :options="vehicleOptions"
            show-search
            option-filter-prop="label"
            placeholder="请选择车辆"
          />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
