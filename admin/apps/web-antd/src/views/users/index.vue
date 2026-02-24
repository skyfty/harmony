<script setup lang="ts">
import type { FormInstance, UploadFile, UploadProps } from 'ant-design-vue';

import type {
  CreateUserPayload,
  UpdateUserPayload,
  UserItem,
} from '#/api';

import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createUserApi,
  deleteUserApi,
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
  Upload,
} from 'ant-design-vue';
import { createResourceAssetApi } from '#/api/core/resources';

interface UserFormModel {
  bio: string;
  displayName: string;
  email: string;
  password: string;
  phone: string;
  status: 'active' | 'disabled';
  avatarUrl?: string;
  username: string;
}

const modalOpen = ref(false);
const submitting = ref(false);
const editingUserId = ref<null | string>(null);
const changingStatusId = ref<null | string>(null);
const userFormRef = ref<FormInstance>();

const userFormModel = reactive<UserFormModel>({
  bio: '',
  displayName: '',
  email: '',
  password: '',
  phone: '',
  status: 'active',
  avatarUrl: '',
  username: '',
});

const avatarFileList = ref<UploadFile[]>([]);
const avatarPreview = ref('');

const avatarUploadProps: UploadProps = {
  beforeUpload: () => false,
  maxCount: 1,
  accept: 'image/*',
};

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
  userFormModel.phone = '';
  userFormModel.bio = '';
  userFormModel.status = 'active';
  userFormModel.avatarUrl = '';
  avatarFileList.value = [];
  avatarPreview.value = '';
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
  userFormModel.phone = record.phone || '';
  userFormModel.bio = record.bio || '';
  userFormModel.status = record.status;
  userFormModel.avatarUrl = record.avatarUrl || '';
  avatarFileList.value = [];
  avatarPreview.value = record.avatarUrl || '';
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
}

async function submitUser() {
  const form = userFormRef.value;
  if (!form) {
    return;
  }
  await form.validate();
  submitting.value = true;
  try {
    // If a new avatar file is selected, upload it first and get URL
    let uploadedAvatarUrl: string | undefined = userFormModel.avatarUrl || undefined;
    if (avatarFileList.value && avatarFileList.value.length > 0) {
      const origin = (avatarFileList.value[0] as any).originFileObj as File;
      if (origin) {
        const fd = new FormData();
        fd.append('file', origin);
        try {
          const res = await createResourceAssetApi(fd);
          uploadedAvatarUrl = res?.asset?.previewUrl || res?.asset?.thumbnailUrl || res?.asset?.url || uploadedAvatarUrl;
        } catch (err) {
          // upload failed — show error and abort
          message.error(t('page.systemUsers.index.message.avatarUploadFailed') || 'Avatar upload failed');
          throw err;
        }
      }
    }

    if (editingUserId.value) {
      const payload: UpdateUserPayload = {
        bio: userFormModel.bio || undefined,
        displayName: userFormModel.displayName || undefined,
        email: userFormModel.email || undefined,
        phone: userFormModel.phone || undefined,
        status: userFormModel.status,
        avatarUrl: uploadedAvatarUrl,
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
        bio: userFormModel.bio || undefined,
        displayName: userFormModel.displayName || undefined,
        email: userFormModel.email || undefined,
        phone: userFormModel.phone || undefined,
        status: userFormModel.status,
        avatarUrl: uploadedAvatarUrl,
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
      { field: 'avatarUrl', minWidth: 100, title: '头像', slots: { default: 'avatar' } },
      { field: 'id', minWidth: 220, title: t('page.systemUsers.index.table.id') },
      { field: 'username', minWidth: 150, sortable: true, title: t('page.systemUsers.index.table.username') },
      { field: 'displayName', minWidth: 140, title: t('page.systemUsers.index.table.displayName') },
      { field: 'wxOpenId', minWidth: 180, title: '微信 OpenId' },
      { field: 'phone', minWidth: 140, title: '手机号' },
      { field: 'email', minWidth: 180, title: t('page.systemUsers.index.table.email') },
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
});

function handleAvatarBeforeUpload(file: UploadFile) {
  const origin = (file as any).originFileObj as File;
  avatarFileList.value = [file];
  const reader = new FileReader();
  reader.onload = (e) => {
    avatarPreview.value = (e.target?.result as string) || '';
  };
  reader.readAsDataURL(origin);
  return false;
}

</script>

<template>
  <div class="p-5">
    <UserGrid>
      <template #toolbar-actions>
        <Button v-access:code="'user:write'" type="primary" @click="openCreateModal">
          新增用户
        </Button>
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

      <template #avatar="{ row }">
        <div>
          <img v-if="row.avatarUrl" :src="row.avatarUrl" style="width:36px;height:36px;border-radius:50%" />
          <span v-else class="text-text-secondary">-</span>
        </div>
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
        <Form.Item label="头像" name="avatar">
          <Upload v-model:file-list="avatarFileList" v-bind="avatarUploadProps" :beforeUpload="handleAvatarBeforeUpload">
            <div style="display:flex;align-items:center;gap:12px">
              <div style="width:40px;height:40px;border-radius:50%;overflow:hidden;border:1px solid #eee">
                <img v-if="avatarPreview" :src="avatarPreview" style="width:100%;height:100%;object-fit:cover" />
              </div>
              <div>{{ t('ui.upload') }}</div>
            </div>
          </Upload>
        </Form.Item>
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
        <Form.Item label="手机号" name="phone">
          <Input
            v-model:value="userFormModel.phone"
            allow-clear
            placeholder="请输入手机号"
          />
        </Form.Item>
        <Form.Item label="简介" name="bio">
          <Input
            v-model:value="userFormModel.bio"
            allow-clear
            placeholder="请输入简介"
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
      </Form>
    </Modal>
  </div>
</template>
