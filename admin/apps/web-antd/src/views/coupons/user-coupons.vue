<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import type { CouponItem, CouponStatus } from '#/api';
import type { Dayjs } from 'dayjs';

import { computed, onMounted, reactive, ref } from 'vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  distributeCouponApi,
  distributeCouponBatchApi,
  getCouponStatsApi,
  listCouponsApi,
  listUserCouponsApi,
  useUserCouponByAdminApi,
} from '#/api';

import { Button, DatePicker, Form, Input, message, Modal, Select, Space, Tag } from 'ant-design-vue';

interface DistributeFormModel {
  couponId: string;
  userId: string;
  userIdsText: string;
  expiresAt?: Dayjs;
}

const stats = ref({ total: 0, unused: 0, used: 0, expired: 0 });
const couponOptions = ref<Array<{ label: string; value: string }>>([]);

const distributeModalOpen = ref(false);
const distributeSubmitting = ref(false);
const distributeMode = ref<'single' | 'batch'>('single');
const distributeFormRef = ref<FormInstance>();

const distributeFormModel = reactive<DistributeFormModel>({
  couponId: '',
  userId: '',
  userIdsText: '',
  expiresAt: undefined,
});

const distributeTitle = computed(() => (distributeMode.value === 'single' ? '单个分发卡券' : '批量分发卡券'));

function normalizeStatusText(status: CouponStatus) {
  if (status === 'used') return '已使用';
  if (status === 'expired') return '已过期';
  return '未使用';
}

function normalizeStatusColor(status: CouponStatus) {
  if (status === 'used') return 'processing';
  if (status === 'expired') return 'default';
  return 'success';
}

async function reloadStats(keyword?: string, couponId?: string) {
  const data = await getCouponStatsApi({ keyword, couponId });
  stats.value = data.overview || { total: 0, unused: 0, used: 0, expired: 0 };
}

async function loadCouponOptions() {
  const res = await listCouponsApi({ page: 1, pageSize: 200 });
  couponOptions.value = (res.items || []).map((item: CouponItem) => ({
    label: item.title || item.name,
    value: item.id,
  }));
}

function openDistributeModal(mode: 'single' | 'batch') {
  distributeMode.value = mode;
  distributeFormModel.couponId = '';
  distributeFormModel.userId = '';
  distributeFormModel.userIdsText = '';
  distributeFormModel.expiresAt = undefined;
  distributeModalOpen.value = true;
}

async function submitDistribute() {
  const form = distributeFormRef.value;
  if (!form) return;
  await form.validate();

  distributeSubmitting.value = true;
  try {
    const expiresAt = distributeFormModel.expiresAt?.toISOString();
    if (distributeMode.value === 'single') {
      await distributeCouponApi(distributeFormModel.couponId, {
        userId: distributeFormModel.userId.trim(),
        expiresAt,
      });
      message.success('分发成功');
    } else {
      const userIds = distributeFormModel.userIdsText
        .split(/[\n,，\s]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      await distributeCouponBatchApi(distributeFormModel.couponId, {
        userIds,
        expiresAt,
      });
      message.success('批量分发已提交');
    }
    distributeModalOpen.value = false;
    userCouponGridApi.reload();
  } finally {
    distributeSubmitting.value = false;
  }
}

async function handleUse(row: any) {
  if (row.status !== 'unused') {
    return;
  }
  await useUserCouponByAdminApi(row.id);
  message.success('卡券已核销');
  userCouponGridApi.reload();
}

const [UserCouponGrid, userCouponGridApi] = useVbenVxeGrid({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键字',
        componentProps: { allowClear: true, placeholder: '用户/卡券关键词' },
      },
      {
        component: 'Select',
        fieldName: 'status',
        label: '状态',
        componentProps: {
          allowClear: true,
          placeholder: '全部状态',
          options: [
            { label: '未使用', value: 'unused' },
            { label: '已使用', value: 'used' },
            { label: '已过期', value: 'expired' },
          ],
        },
      },
      {
        component: 'Select',
        fieldName: 'couponId',
        label: '卡券模板',
        componentProps: {
          allowClear: true,
          placeholder: '全部卡券',
          options: couponOptions,
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'coupon.title', minWidth: 180, title: '卡券名称' },
      { field: 'user.displayName', minWidth: 160, title: '用户昵称' },
      { field: 'user.username', minWidth: 160, title: '用户名' },
      { field: 'status', minWidth: 120, title: '状态', slots: { default: 'status' } },
      { field: 'claimedAt', minWidth: 170, formatter: 'formatDateTime', title: '领取时间' },
      { field: 'expiresAt', minWidth: 170, formatter: 'formatDateTime', title: '过期时间' },
      { field: 'usedAt', minWidth: 170, formatter: 'formatDateTime', title: '使用时间' },
      { align: 'left', fixed: 'right', minWidth: 150, field: 'actions', slots: { default: 'actions' }, title: '操作' },
    ],
    keepSource: true,
    pagerConfig: { pageSize: 20 },
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, formValues: Record<string, any>) => {
          const params = {
            keyword: formValues.keyword,
            status: formValues.status || undefined,
            couponId: formValues.couponId || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
          };
          const data = await listUserCouponsApi(params);
          await reloadStats(formValues.keyword, formValues.couponId || undefined);
          return data;
        },
      },
    },
    toolbarConfig: { custom: true, refresh: true, search: true, zoom: true },
  },
  tableTitle: '用户卡券管理',
});

onMounted(async () => {
  await loadCouponOptions();
  await reloadStats();
});
</script>

<template>
  <div class="p-5">
    <div class="mb-4 grid grid-cols-4 gap-3">
      <div class="rounded bg-white p-4">
        <div class="text-text-secondary">总卡券</div>
        <div class="mt-2 text-2xl font-semibold">{{ stats.total }}</div>
      </div>
      <div class="rounded bg-white p-4">
        <div class="text-text-secondary">未使用</div>
        <div class="mt-2 text-2xl font-semibold text-green-600">{{ stats.unused }}</div>
      </div>
      <div class="rounded bg-white p-4">
        <div class="text-text-secondary">已使用</div>
        <div class="mt-2 text-2xl font-semibold text-blue-600">{{ stats.used }}</div>
      </div>
      <div class="rounded bg-white p-4">
        <div class="text-text-secondary">已过期</div>
        <div class="mt-2 text-2xl font-semibold text-gray-500">{{ stats.expired }}</div>
      </div>
    </div>

    <UserCouponGrid>
      <template #toolbar-actions>
        <Space>
          <Button v-access:code="'coupon:write'" type="primary" @click="openDistributeModal('single')">单个分发</Button>
          <Button v-access:code="'coupon:write'" @click="openDistributeModal('batch')">批量分发</Button>
        </Space>
      </template>

      <template #status="{ row }">
        <Tag :color="normalizeStatusColor(row.status)">
          {{ normalizeStatusText(row.status) }}
        </Tag>
      </template>

      <template #actions="{ row }">
        <Button
          v-access:code="'coupon:write'"
          type="link"
          size="small"
          :disabled="row.status !== 'unused'"
          @click="handleUse(row)"
        >
          核销
        </Button>
      </template>
    </UserCouponGrid>

    <Modal
      :open="distributeModalOpen"
      :title="distributeTitle"
      :confirm-loading="distributeSubmitting"
      ok-text="确认"
      cancel-text="取消"
      @cancel="() => (distributeModalOpen = false)"
      @ok="submitDistribute"
    >
      <Form ref="distributeFormRef" :label-col="{ span: 6 }" :model="distributeFormModel" :wrapper-col="{ span: 17 }">
        <Form.Item label="卡券" name="couponId" :rules="[{ required: true, message: '请选择卡券' }]">
          <Select
            v-model:value="distributeFormModel.couponId"
            :options="couponOptions"
            show-search
            option-filter-prop="label"
            placeholder="请选择卡券"
          />
        </Form.Item>

        <Form.Item
          v-if="distributeMode === 'single'"
          label="用户ID"
          name="userId"
          :rules="[{ required: true, message: '请输入用户ID' }]"
        >
          <Input v-model:value="distributeFormModel.userId" placeholder="请输入用户ID" />
        </Form.Item>

        <Form.Item
          v-else
          label="用户ID列表"
          name="userIdsText"
          :rules="[{ required: true, message: '请输入用户ID列表' }]"
        >
          <Input.TextArea
            v-model:value="distributeFormModel.userIdsText"
            :rows="5"
            placeholder="每行一个用户ID，或使用逗号/空格分隔"
          />
        </Form.Item>

        <Form.Item label="过期时间" name="expiresAt">
          <DatePicker v-model:value="distributeFormModel.expiresAt" style="width: 100%" show-time />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
