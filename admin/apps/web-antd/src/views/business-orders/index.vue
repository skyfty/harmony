<script setup lang="ts">
import type { BusinessOrderItem, BusinessOrderTopStage } from '#/api';

import { useRouter } from 'vue-router';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { listBusinessOrdersApi } from '#/api';

import { Button, Space, Tag, Tooltip } from 'ant-design-vue';
import { EyeOutlined } from '@ant-design/icons-vue';

const router = useRouter();

function openDetail(row: BusinessOrderItem) {
  router.push({ name: 'BusinessOrderDetail', params: { id: row.id } });
}

function stageText(stage: BusinessOrderTopStage) {
  switch (stage) {
    case 'quote':
      return '报价';
    case 'signing':
      return '签约';
    case 'production':
      return '制作';
    case 'publish':
      return '发布';
    case 'operation':
      return '运营';
    default:
      return stage;
  }
}

function stageColor(stage: BusinessOrderTopStage) {
  switch (stage) {
    case 'quote':
      return 'default';
    case 'signing':
      return 'gold';
    case 'production':
      return 'processing';
    case 'publish':
      return 'purple';
    case 'operation':
      return 'success';
    default:
      return 'default';
  }
}

const [BusinessOrderGrid] = useVbenVxeGrid<BusinessOrderItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键字',
        componentProps: {
          allowClear: true,
          placeholder: '订单号 / 景点名称 / 电话',
        },
      },
      {
        component: 'Select',
        fieldName: 'topStage',
        label: '阶段',
        componentProps: {
          allowClear: true,
          options: [
            { label: '报价', value: 'quote' },
            { label: '签约', value: 'signing' },
            { label: '制作', value: 'production' },
            { label: '发布', value: 'publish' },
            { label: '运营', value: 'operation' },
          ],
        },
      },
      {
        component: 'Select',
        fieldName: 'contractStatus',
        label: '签约状态',
        componentProps: {
          allowClear: true,
          options: [
            { label: '未签约', value: 'unsigned' },
            { label: '已签约', value: 'signed' },
          ],
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'orderNumber', minWidth: 180, title: '订单编号' },
      { field: 'scenicName', minWidth: 180, title: '景点名称' },
      { field: 'sceneSpotCategoryName', minWidth: 140, title: '景点类型' },
      { field: 'userInfo.displayName', minWidth: 140, title: '用户昵称' },
      { field: 'contactPhone', minWidth: 140, title: '联系电话' },
      { field: 'topStage', minWidth: 120, title: '当前阶段', slots: { default: 'stage' } },
      { field: 'userInfo.contractStatus', minWidth: 120, title: '签约状态', slots: { default: 'contractStatus' } },
      { field: 'createdAt', minWidth: 180, formatter: 'formatDateTime', title: '创建时间' },
      { field: 'updatedAt', minWidth: 180, formatter: 'formatDateTime', title: '更新时间' },
      { field: 'actions', minWidth: 100, fixed: 'right', title: '操作', slots: { default: 'actions' } },
    ],
    pagerConfig: { pageSize: 20 },
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, formValues: Record<string, any>) => {
          return await listBusinessOrdersApi({
            keyword: formValues.keyword || undefined,
            topStage: formValues.topStage || undefined,
            contractStatus: formValues.contractStatus || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
          });
        },
      },
    },
    toolbarConfig: { custom: true, refresh: true, search: true },
  },
});
</script>

<template>
  <div class="p-5">
    <BusinessOrderGrid>
      <template #stage="{ row }">
        <Tag :color="stageColor(row.topStage)">{{ stageText(row.topStage) }}</Tag>
      </template>

      <template #contractStatus="{ row }">
        <Tag :color="row.userInfo?.contractStatus === 'signed' ? 'success' : 'default'">
          {{ row.userInfo?.contractStatus === 'signed' ? '已签约' : '未签约' }}
        </Tag>
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip title="详情">
            <Button size="small" type="text" @click="openDetail(row)">
              <EyeOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
    </BusinessOrderGrid>
  </div>
</template>