<script setup lang="ts">
import type { UserItem, UserMedalStatusItem } from '#/api';

import { ref } from 'vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { listUserMedalsApi, listUsersApi } from '#/api';

import { Progress, Tag } from 'ant-design-vue';

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

function toPercent(ratio?: number) {
  const parsed = Number(ratio ?? 0);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(parsed * 100)));
}

const [UserMedalGrid] = useVbenVxeGrid<UserMedalStatusItem>({
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
        component: 'Input',
        fieldName: 'keyword',
        label: '关键字',
        componentProps: {
          allowClear: true,
          placeholder: '勋章名称 / 描述',
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 180, title: '勋章名称' },
      { field: 'lockedIconUrl', minWidth: 120, title: '图标', slots: { default: 'icon' } },
      { field: 'enabled', minWidth: 100, title: '启用状态', slots: { default: 'enabled' } },
      { field: 'awarded', minWidth: 100, title: '获得状态', slots: { default: 'awarded' } },
      { field: 'completionRatio', minWidth: 180, title: '完成度', slots: { default: 'completionRatio' } },
      { field: 'awardedAt', minWidth: 180, formatter: 'formatDateTime', title: '获得时间' },
      { field: 'ruleCount', minWidth: 90, title: '规则数' },
      { field: 'description', minWidth: 240, title: '描述' },
    ],
    pagerConfig: { pageSize: 20 },
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, formValues: Record<string, any>) => {
          const userId = formValues.userId || '';
          if (!userId) {
            return { items: [], total: 0 };
          }
          return await listUserMedalsApi(userId, {
            q: formValues.keyword?.trim() || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
          });
        },
      },
    },
    toolbarConfig: { custom: true, refresh: true, search: true, zoom: true },
  },
});
</script>

<template>
  <div class="p-5">
    <UserMedalGrid>
      <template #icon="{ row }">
        <img
          v-if="row.lockedIconUrl || row.unlockedIconUrl"
          :src="row.unlockedIconUrl || row.lockedIconUrl || ''"
          alt="medal"
          style="width: 56px; height: 56px; object-fit: cover; border-radius: 12px"
        />
        <span v-else>-</span>
      </template>

      <template #enabled="{ row }">
        <Tag :color="row.enabled ? 'green' : 'default'">
          {{ row.enabled ? '启用' : '停用' }}
        </Tag>
      </template>

      <template #awarded="{ row }">
        <Tag :color="row.awarded ? 'gold' : 'default'">
          {{ row.awarded ? '已获得' : '未获得' }}
        </Tag>
      </template>

      <template #completionRatio="{ row }">
        <div style="min-width: 140px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;gap:8px;">
            <span>{{ toPercent(row.completionRatio) }}%</span>
            <Tag :color="row.awarded ? 'gold' : 'blue'">
              {{ row.awarded ? '已达成' : '进行中' }}
            </Tag>
          </div>
          <Progress
            :percent="toPercent(row.completionRatio)"
            :show-info="false"
            size="small"
            :stroke-color="row.awarded ? '#d48806' : '#1677ff'"
          />
        </div>
      </template>
    </UserMedalGrid>
  </div>
</template>
