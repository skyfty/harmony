<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';

import type { SkinCategoryItem, SkinItem, UserItem, UserSkinItem } from '#/api';

import { onMounted, reactive, ref } from 'vue';

import { DeleteOutlined, PlusOutlined } from '@ant-design/icons-vue';
import {
  Button,
  Form,
  message,
  Modal,
  Select,
  Space,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createUserSkinApi,
  deleteUserSkinApi,
  listSkinCategoriesApi,
  listSkinsApi,
  listUsersApi,
  listUserSkinsApi,
} from '#/api';

interface UserSkinFormModel {
  userId: string;
  skinId: string;
}

const modalOpen = ref(false);
const submitting = ref(false);
const userSkinFormRef = ref<FormInstance>();

const userSkinFormModel = reactive<UserSkinFormModel>({
  userId: '',
  skinId: '',
});

const userSearchLoading = ref(false);
const userSearchOptions = ref<Array<{ label: string; value: string }>>([]);
const userSearchToken = ref(0);

const skinSearchLoading = ref(false);
const skinSearchOptions = ref<Array<{ label: string; value: string }>>([]);
const skinSearchToken = ref(0);

const categoryOptions = ref<Array<{ label: string; value: string }>>([]);

function resetForm() {
  userSkinFormModel.userId = '';
  userSkinFormModel.skinId = '';
  userSearchOptions.value = [];
  skinSearchOptions.value = [];
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

async function handleSkinSearch(keyword = '') {
  const token = ++skinSearchToken.value;
  skinSearchLoading.value = true;
  try {
    const res = await listSkinsApi({
      keyword: keyword.trim() || undefined,
      isActive: true,
      page: 1,
      pageSize: 100,
    });
    if (token !== skinSearchToken.value) {
      return;
    }
    skinSearchOptions.value = (res.items || []).map((item: SkinItem) => ({
      label: `${item.name} (${item.identifier})${item.categoryName ? ` · ${item.categoryName}` : ''}`,
      value: item.id,
    }));
  } finally {
    if (token === skinSearchToken.value) {
      skinSearchLoading.value = false;
    }
  }
}

function openCreateModal() {
  resetForm();
  modalOpen.value = true;
}

async function submitUserSkin() {
  const form = userSkinFormRef.value;
  if (!form) return;
  await form.validate();

  submitting.value = true;
  try {
    await createUserSkinApi({
      userId: userSkinFormModel.userId,
      skinId: userSkinFormModel.skinId,
    });
    message.success('皮肤分配成功');
    modalOpen.value = false;
    userSkinGridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: UserSkinItem) {
  const skinName = row.skin?.name || row.skin?.identifier || '-';
  const userName = row.user?.displayName || row.user?.username || row.userId;
  Modal.confirm({
    title: '确认删除该用户的皮肤吗？',
    content: `将移除用户「${userName}」的皮肤「${skinName}」，并清除其当前选中。`,
    okType: 'danger',
    onOk: async () => {
      await deleteUserSkinApi(row.id);
      message.success('已删除');
      await userSkinGridApi.query();
    },
  });
}

function formatSource(source: UserSkinItem['source']) {
  return source === 'admin-assign' ? '后台发放' : '订单购买';
}

const [UserSkinGrid, userSkinGridApi] = useVbenVxeGrid<UserSkinItem>({
  formOptions: {
    schema: [
      {
        component: 'Select',
        fieldName: 'userId',
        label: '用户',
        componentProps: {
          allowClear: true,
          filterOption: false,
          loading: userSearchLoading,
          options: userSearchOptions,
          placeholder: '输入昵称/用户名搜索并选择用户',
          showSearch: true,
          onFocus: () => handleUserSearch(),
          onSearch: handleUserSearch,
        },
      },
      {
        component: 'Select',
        fieldName: 'categoryId',
        label: '皮肤分类',
        componentProps: {
          allowClear: true,
          options: categoryOptions,
          placeholder: '全部皮肤分类',
        },
      },
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键字',
        componentProps: {
          allowClear: true,
          placeholder: '用户/皮肤名称、标识、描述',
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'skin.identifier', minWidth: 150, title: '皮肤标识' },
      { field: 'skin.name', minWidth: 160, title: '皮肤名称' },
      { field: 'skin.categoryName', minWidth: 130, title: '皮肤分类' },
      { field: 'user.displayName', minWidth: 150, title: '用户昵称' },
      { field: 'user.username', minWidth: 160, title: '用户名' },
      {
        field: 'source',
        minWidth: 110,
        title: '获取方式',
        slots: { default: 'source' },
      },
      {
        field: 'acquiredAt',
        minWidth: 170,
        formatter: 'formatDateTime',
        title: '拥有时间',
      },
      {
        align: 'left',
        fixed: 'right',
        minWidth: 110,
        field: 'actions',
        slots: { default: 'actions' },
        title: '操作',
      },
    ],
    keepSource: true,
    pagerConfig: { pageSize: 20 },
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, formValues: Record<string, any>) => {
          return await listUserSkinsApi({
            keyword: formValues.keyword || undefined,
            userId: formValues.userId || undefined,
            categoryId: formValues.categoryId || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
          });
        },
      },
    },
    toolbarConfig: { custom: true, refresh: true, search: true, zoom: true },
  },
});

onMounted(async () => {
  try {
    const categories = await listSkinCategoriesApi();
    categoryOptions.value = (categories || [])
      .filter((item: SkinCategoryItem) => item.enabled !== false)
      .map((item: SkinCategoryItem) => ({ label: item.name, value: item.id }));
  } catch {
    categoryOptions.value = [];
  }
});
</script>

<template>
  <div class="p-5">
    <UserSkinGrid>
      <template #toolbar-actions>
        <Button
          v-access:code="'skin:write'"
          type="primary"
          @click="openCreateModal"
        >
          <PlusOutlined />
          新增用户皮肤
        </Button>
      </template>

      <template #source="{ row }">
        <Tag :color="row.source === 'admin-assign' ? 'blue' : 'default'">
          {{ formatSource(row.source) }}
        </Tag>
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip title="删除">
            <Button
              v-access:code="'skin:write'"
              danger
              size="small"
              type="text"
              @click="handleDelete(row)"
            >
              <DeleteOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
    </UserSkinGrid>

    <Modal
      :open="modalOpen"
      title="分配皮肤"
      :confirm-loading="submitting"
      ok-text="分配"
      cancel-text="取消"
      destroy-on-close
      @cancel="() => (modalOpen = false)"
      @ok="submitUserSkin"
    >
      <Form
        ref="userSkinFormRef"
        :label-col="{ span: 6 }"
        :model="userSkinFormModel"
        :wrapper-col="{ span: 17 }"
      >
        <Form.Item
          label="用户"
          name="userId"
          :rules="[{ required: true, message: '请选择用户' }]"
        >
          <Select
            v-model:value="userSkinFormModel.userId"
            :filter-option="false"
            :loading="userSearchLoading"
            :options="userSearchOptions"
            show-search
            placeholder="输入昵称/用户名搜索用户"
            @focus="() => handleUserSearch()"
            @search="handleUserSearch"
          />
        </Form.Item>
        <Form.Item
          label="皮肤"
          name="skinId"
          :rules="[{ required: true, message: '请选择皮肤' }]"
        >
          <Select
            v-model:value="userSkinFormModel.skinId"
            :filter-option="false"
            :loading="skinSearchLoading"
            :options="skinSearchOptions"
            show-search
            placeholder="输入皮肤名称/标识搜索"
            @focus="() => handleSkinSearch()"
            @search="handleSkinSearch"
          />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
