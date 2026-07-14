<script setup lang="ts">
import type { TravelRecordItem, UserItem } from '#/api';

import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { deleteTravelRecordApi, listTravelRecordsApi, listUsersApi } from '#/api';

import { Button, Modal, Space, Tag, Tooltip, message } from 'ant-design-vue';
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

function openDetail(row: TravelRecordItem) {
  router.push({
    name: 'TravelRecordDetail',
    params: { id: row.id },
  });
}

function openScenicDetail(row: TravelRecordItem) {
  if (!row.scenicId) {
    return;
  }
  router.push({
    name: 'SceneSpotDetail',
    params: { id: row.scenicId },
  });
}

function handleDelete(row: TravelRecordItem) {
  Modal.confirm({
    title: '确认删除该游历记录吗？',
    okType: 'danger',
    onOk: async () => {
      await deleteTravelRecordApi(row.id);
      message.success('游历记录已删除');
      await travelGridApi.query();
    },
  });
}

const [UserTravelGrid, travelGridApi] = useVbenVxeGrid<TravelRecordItem>({
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
      { component: 'Input', fieldName: 'username', label: '用户名', componentProps: { allowClear: true } },
      {
        component: 'Select',
        fieldName: 'status',
        label: '状态',
        componentProps: {
          allowClear: true,
          options: [
            { label: '进行中', value: 'active' },
            { label: '已完成', value: 'completed' },
          ],
        },
      },
      { component: 'RangePicker', fieldName: 'enterTimeRange', label: '进入时间' },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'enterTime', minWidth: 180, title: '进入时间', sortable: true, formatter: 'formatDateTime' },
      { field: 'leaveTime', minWidth: 180, title: '离开时间', sortable: true, formatter: 'formatDateTime' },
      { field: 'durationSeconds', minWidth: 120, title: '停留时长(秒)' },
      { field: 'userId', minWidth: 180, title: '用户 ID' },
      { field: 'username', minWidth: 140, title: '用户名' },
      { field: 'scenicTitle', minWidth: 220, title: '景点', slots: { default: 'scenicTitle' } },
      { field: 'sceneName', minWidth: 160, title: '场景名称' },
      { field: 'vehicleName', minWidth: 180, title: '车辆', slots: { default: 'vehicleName' } },
      { field: 'sceneCheckpointTotal', minWidth: 140, title: '打卡点数量' },
      { field: 'status', minWidth: 120, title: '状态', slots: { default: 'status' } },
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
            userId: formValues.userId || undefined,
            username: formValues.username || undefined,
            status: formValues.status || undefined,
          };
          if (formValues.enterTimeRange?.length) {
            params.start = formValues.enterTimeRange[0];
            params.end = formValues.enterTimeRange[1];
          }
          return await listTravelRecordsApi(params);
        },
      },
    },
    toolbarConfig: { custom: true, refresh: true, search: true, zoom: true },
  },
});
</script>

<template>
  <div class="p-5">
    <UserTravelGrid>
      <template #scenicTitle="{ row }">
        <Button type="link" size="small" @click="() => openScenicDetail(row)">
          {{ row.scenicTitle || row.scenicId || '-' }}
        </Button>
      </template>

      <template #vehicleName="{ row }">
        {{ row.vehicleName || row.vehicleIdentifier || '-' }}
      </template>

      <template #status="{ row }">
        <Tag :color="row.status === 'completed' ? 'success' : 'processing'">
          {{ row.status === 'completed' ? '已完成' : '进行中' }}
        </Tag>
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip title="详情">
            <Button size="small" type="text" @click="openDetail(row)">
              <EyeOutlined />
            </Button>
          </Tooltip>
          <Tooltip title="删除">
            <Button v-access:code="'travel:delete'" danger size="small" type="text" @click="handleDelete(row)">
              <DeleteOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
    </UserTravelGrid>
  </div>
</template>
