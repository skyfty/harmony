<script setup lang="ts">
import type { BusinessConfigItem, BusinessOrderItem, BusinessOrderTopStage } from '#/api';

import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { getBusinessConfigApi, listBusinessOrdersApi, updateBusinessConfigApi } from '#/api';

import { Button, Card, Input, Space, Tag, Tooltip, message } from 'ant-design-vue';
import { EyeOutlined } from '@ant-design/icons-vue';

const router = useRouter();
const configLoading = ref(false);
const configSubmitting = ref(false);
const businessContactPhone = ref('');
const businessConfigUpdatedAt = ref<BusinessConfigItem['updatedAt']>(null);

async function loadBusinessConfig() {
  configLoading.value = true;
  try {
    const response = await getBusinessConfigApi();
    businessContactPhone.value = response.contactPhone || '';
    businessConfigUpdatedAt.value = response.updatedAt || null;
  } finally {
    configLoading.value = false;
  }
}

async function saveBusinessConfig() {
  const contactPhone = businessContactPhone.value.trim();
  if (!contactPhone) {
    message.warning('请输入商务联系电话');
    return;
  }
  configSubmitting.value = true;
  try {
    const response = await updateBusinessConfigApi({ contactPhone });
    businessContactPhone.value = response.contactPhone;
    businessConfigUpdatedAt.value = response.updatedAt || null;
    message.success('商务联系电话已更新');
  } finally {
    configSubmitting.value = false;
  }
}

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

onMounted(() => {
  void loadBusinessConfig();
});
</script>

<template>
  <div class="p-5">
    <Card class="mb-4" title="全局商务联系电话" :loading="configLoading">
      <div class="flex flex-col gap-3 md:flex-row md:items-center">
        <Input
          v-model:value="businessContactPhone"
          class="md:max-w-md"
          placeholder="请输入小程序“联系商务”默认拨打号码"
        />
        <Button v-access:code="'order:write'" type="primary" :loading="configSubmitting" @click="saveBusinessConfig">
          保存号码
        </Button>
        <div v-if="businessConfigUpdatedAt" class="text-text-secondary text-sm">
          最近更新：{{ businessConfigUpdatedAt }}
        </div>
      </div>
    </Card>

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