<script setup lang="ts">
import type { SceneItem, ScenePackageMultiuserSceneSummary } from '#/api';

import { useRouter } from 'vue-router';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { listScenesApi } from '#/api';
import { Button, Space, Tag, Tooltip } from 'ant-design-vue';
import { InfoCircleOutlined } from '@ant-design/icons-vue';

const router = useRouter();

type MultiuserRow = SceneItem & {
  multiuserSummary: ReturnType<typeof resolveMultiuserSummary>;
};

function resolveMultiuserSummary(row: SceneItem) {
  const multiuser = row.metadata?.multiuser ?? null;
  const scenes = Array.isArray(multiuser?.scenes) ? multiuser.scenes : [];
  const primaryScene = scenes[0] ?? null;
  return {
    enabled: Boolean(multiuser?.enabled),
    sceneCount: Number(multiuser?.sceneCount ?? scenes.length) || 0,
    nodeCount: Number(multiuser?.nodeCount ?? 0) || 0,
    enabledNodeCount: Number(multiuser?.enabledNodeCount ?? 0) || 0,
    scenes,
    primaryScene,
    server: primaryScene?.server ?? null,
    port: primaryScene?.port ?? null,
    syncInterval: primaryScene?.syncInterval ?? null,
    maxUsers: primaryScene?.maxUsers ?? null,
  };
}

function openSceneDetail(row: SceneItem) {
  router.push({ name: 'SceneDetail', params: { id: row.id } });
}

function formatEndpoint(scene: ScenePackageMultiuserSceneSummary | null): string {
  if (!scene) {
    return '-';
  }
  const server = scene.server?.trim() || '-';
  const port = Number.isFinite(scene.port ?? Number.NaN) ? scene.port : '-';
  return `${server}:${port}`;
}

const [MultiuserGrid] = useVbenVxeGrid<MultiuserRow>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键词',
        componentProps: {
          allowClear: true,
          placeholder: '按名称或场景 ID 搜索',
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 180, title: '场景名称' },
      { field: 'id', minWidth: 190, title: '场景 ID' },
      { field: 'multiuserSummary.enabled', minWidth: 120, title: '状态', slots: { default: 'enabled' } },
      { field: 'multiuserSummary.sceneCount', minWidth: 110, title: '场景数' },
      { field: 'multiuserSummary.nodeCount', minWidth: 110, title: '节点数' },
      { field: 'multiuserSummary.enabledNodeCount', minWidth: 130, title: '启用节点' },
      { field: 'multiuserSummary.server', minWidth: 190, title: '服务器', slots: { default: 'server' } },
      { field: 'multiuserSummary.syncInterval', minWidth: 120, title: '同步间隔(ms)' },
      { field: 'multiuserSummary.maxUsers', minWidth: 100, title: '上限' },
      { field: 'updatedAt', minWidth: 180, sortable: true, formatter: 'formatDateTime', title: '更新时间' },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 120,
        slots: { default: 'actions' },
        title: '操作',
      },
    ],
    pagerConfig: {
      pageSize: 20,
    },
    proxyConfig: {
      ajax: {
        query: async (
          { page }: { page: { currentPage: number; pageSize: number } },
          formValues: Record<string, any>,
        ) => {
          const response = await listScenesApi({
            keyword: formValues.keyword || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
          });
          return {
            items: (response.items || []).map((item) => ({
              ...item,
              multiuserSummary: resolveMultiuserSummary(item),
            })),
            total: response.total || 0,
          };
        },
      },
    },
    sortConfig: {
      defaultSort: { field: 'updatedAt', order: 'desc' },
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
</script>

<template>
  <div class="p-5">
    <MultiuserGrid>
      <template #enabled="{ row }">
        <Tag :color="row.multiuserSummary.enabled ? 'green' : 'default'">
          {{ row.multiuserSummary.enabled ? '已启用' : '未启用' }}
        </Tag>
      </template>

      <template #server="{ row }">
        <Tooltip v-if="row.multiuserSummary.primaryScene" :title="JSON.stringify(row.multiuserSummary.primaryScene, null, 2)">
          <span>{{ formatEndpoint(row.multiuserSummary.primaryScene) }}</span>
        </Tooltip>
        <span v-else>-</span>
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip title="查看场景详情">
            <Button size="small" type="text" @click="openSceneDetail(row)">
              <InfoCircleOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
    </MultiuserGrid>
  </div>
</template>
