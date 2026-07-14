<script setup lang="ts">
import type { PunchRecordItem, UserItem } from '#/api';

import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { deletePunchRecordApi, listPunchRecordsApi, listUsersApi } from '#/api';

import { Button, Modal, Space, Tooltip, message } from 'ant-design-vue';
import { DeleteOutlined, EyeOutlined } from '@ant-design/icons-vue';

const router = useRouter();
const userSearchLoading = ref(false);
const userSearchOptions = ref<Array<{ label: string; value: string }>>([]);
const userSearchToken = ref(0);

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

function openDetail(row: PunchRecordItem) {
  router.push({
    name: 'PunchRecordDetail',
    params: { id: row.id },
  });
}

function openScenicDetail(row: PunchRecordItem) {
  if (!row.scenicId) {
    return;
  }
  router.push({
    name: 'SceneSpotDetail',
    params: { id: row.scenicId },
  });
}

function handleDelete(row: PunchRecordItem) {
  Modal.confirm({
    title: '确认删除该打卡记录吗？',
    okType: 'danger',
    onOk: async () => {
      await deletePunchRecordApi(row.id);
      message.success('打卡记录已删除');
      await punchGridApi.query();
    },
  });
}

const [UserPunchGrid, punchGridApi] = useVbenVxeGrid<PunchRecordItem>({
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
          placeholder: '输入昵称/用户名搜索用户',
          showSearch: true,
          onFocus: () => handleUserSearch(),
          onSearch: handleUserSearch,
        },
      },
      { component: 'Input', fieldName: 'sceneId', label: '场景 ID', componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'scenicId', label: '景点 ID', componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'sceneName', label: '场景名称', componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'nodeId', label: '打卡点 ID', componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'nodeName', label: '打卡点名称', componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'username', label: '用户名', componentProps: { allowClear: true } },
      { component: 'RangePicker', fieldName: 'createdAt', label: '创建时间' },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'createdAt', minWidth: 180, title: '创建时间', sortable: true, formatter: 'formatDateTime' },
      { field: 'userId', minWidth: 180, title: '用户 ID' },
      { field: 'username', minWidth: 140, title: '用户名' },
      { field: 'scenicTitle', minWidth: 220, title: '景点', slots: { default: 'scenicTitle' } },
      { field: 'sceneName', minWidth: 160, title: '场景名称' },
      { field: 'vehicleName', minWidth: 180, title: '车辆', slots: { default: 'vehicleName' } },
      { field: 'nodeName', minWidth: 160, title: '打卡点名称' },
      { field: 'source', minWidth: 120, title: '来源' },
      { align: 'left', field: 'actions', minWidth: 160, fixed: 'right', title: '操作', slots: { default: 'actions' } },
    ],
    pagerConfig: { pageSize: 20 },
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, formValues: Record<string, any>) => {
          const params: Record<string, any> = {
            page: page.currentPage,
            pageSize: page.pageSize,
            sceneId: formValues.sceneId || undefined,
            scenicId: formValues.scenicId || undefined,
            sceneName: formValues.sceneName || undefined,
            nodeId: formValues.nodeId || undefined,
            nodeName: formValues.nodeName || undefined,
            userId: formValues.userId || undefined,
            username: formValues.username || undefined,
          };
          if (formValues.createdAt?.length) {
            params.start = formValues.createdAt[0];
            params.end = formValues.createdAt[1];
          }
          return await listPunchRecordsApi(params);
        },
      },
    },
    toolbarConfig: { custom: true, refresh: true, search: true, zoom: true },
  },
});
</script>

<template>
  <div class="p-5">
    <UserPunchGrid>
      <template #scenicTitle="{ row }">
        <Button type="link" size="small" @click="() => openScenicDetail(row)">
          {{ row.scenicTitle || row.scenicId || '-' }}
        </Button>
      </template>

      <template #vehicleName="{ row }">
        {{ row.vehicleName || row.vehicleIdentifier || '-' }}
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip title="详情">
            <Button size="small" type="text" @click="openDetail(row)">
              <EyeOutlined />
            </Button>
          </Tooltip>
          <Tooltip title="删除">
            <Button v-access:code="'punch:delete'" danger size="small" type="text" @click="handleDelete(row)">
              <DeleteOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
    </UserPunchGrid>
  </div>
</template>
