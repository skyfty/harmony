<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import type { CouponItem, CouponStatus, UserItem } from '#/api';
import type { Dayjs } from 'dayjs';

import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  distributeCouponApi,
  distributeCouponBatchApi,
  getCouponStatsApi,
  listCouponsApi,
  listUsersApi,
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
const userSearchLoading = ref(false);
const userSearchOptions = ref<Array<{ label: string; value: string }>>([]);
const selectedSingleUserId = ref<string>();
const selectedBatchUserIds = ref<string[]>([]);
const userSearchToken = ref(0);

const distributeFormModel = reactive<DistributeFormModel>({
  couponId: '',
  userId: '',
  userIdsText: '',
  expiresAt: undefined,
});

const { t } = useI18n();
const distributeTitle = computed(() => (distributeMode.value === 'single' ? t('page.coupons.userCoupons.modal.singleTitle') : t('page.coupons.userCoupons.modal.batchTitle')));

function normalizeStatusText(status: CouponStatus) {
  if (status === 'used') return t('page.coupons.userCoupons.status.used');
  if (status === 'expired') return t('page.coupons.userCoupons.status.expired');
  return t('page.coupons.userCoupons.status.unused');
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
  selectedSingleUserId.value = undefined;
  selectedBatchUserIds.value = [];
  userSearchOptions.value = [];
  distributeModalOpen.value = true;
}

function parseManualUserIds(text: string) {
  return text
    .split(/[\n,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatUserOptionLabel(user: UserItem) {
  const name = user.displayName || user.username || user.id;
  const usernameText = user.username ? ` @${user.username}` : '';
  return `${name}${usernameText} (${user.id})`;
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
      label: formatUserOptionLabel(item),
      value: item.id,
    }));
  } finally {
    if (token === userSearchToken.value) {
      userSearchLoading.value = false;
    }
  }
}

async function submitDistribute() {
  const form = distributeFormRef.value;
  if (!form) return;
  await form.validate();

  distributeSubmitting.value = true;
  try {
    const expiresAt = distributeFormModel.expiresAt?.toISOString();
    if (distributeMode.value === 'single') {
      const selectedUserId = selectedSingleUserId.value?.trim() || '';
      const manualUserId = distributeFormModel.userId.trim();
      const userId = manualUserId || selectedUserId;
      if (!userId) {
        message.error(t('page.coupons.userCoupons.message.singleUserRequired'));
        return;
      }
      await distributeCouponApi(distributeFormModel.couponId, {
        userId,
        expiresAt,
      });
      message.success(t('page.coupons.userCoupons.message.distributeSuccess'));
    } else {
      const manualUserIds = parseManualUserIds(distributeFormModel.userIdsText);
      const userIds = [...new Set([...selectedBatchUserIds.value, ...manualUserIds])];
      if (userIds.length === 0) {
        message.error(t('page.coupons.userCoupons.message.batchUsersRequired'));
        return;
      }
      await distributeCouponBatchApi(distributeFormModel.couponId, {
        userIds,
        expiresAt,
      });
      message.success(t('page.coupons.userCoupons.message.batchDistributeSubmitted'));
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
  message.success(t('page.coupons.userCoupons.message.usedSuccess'));
  userCouponGridApi.reload();
}

const [UserCouponGrid, userCouponGridApi] = useVbenVxeGrid({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: t('page.coupons.userCoupons.form.keyword.label'),
        componentProps: { allowClear: true, placeholder: t('page.coupons.userCoupons.form.keyword.placeholder') },
      },
      {
        component: 'Select',
        fieldName: 'status',
        label: t('page.coupons.userCoupons.form.status.label'),
        componentProps: {
          allowClear: true,
          placeholder: t('page.coupons.userCoupons.form.status.placeholder'),
          options: [
            { label: t('page.coupons.userCoupons.status.unused'), value: 'unused' },
            { label: t('page.coupons.userCoupons.status.used'), value: 'used' },
            { label: t('page.coupons.userCoupons.status.expired'), value: 'expired' },
          ],
        },
      },
      {
        component: 'Select',
        fieldName: 'couponId',
        label: t('page.coupons.userCoupons.form.couponId.label'),
        componentProps: {
          allowClear: true,
          placeholder: t('page.coupons.userCoupons.form.couponId.placeholder'),
          options: couponOptions,
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'coupon.title', minWidth: 180, title: t('page.coupons.userCoupons.table.couponTitle') },
      { field: 'user.displayName', minWidth: 160, title: t('page.coupons.userCoupons.table.userDisplayName') },
      { field: 'user.username', minWidth: 160, title: t('page.coupons.userCoupons.table.username') },
      { field: 'status', minWidth: 120, title: t('page.coupons.userCoupons.table.status'), slots: { default: 'status' } },
      { field: 'claimedAt', minWidth: 170, formatter: 'formatDateTime', title: t('page.coupons.userCoupons.table.claimedAt') },
      { field: 'expiresAt', minWidth: 170, formatter: 'formatDateTime', title: t('page.coupons.userCoupons.table.expiresAt') },
      { field: 'usedAt', minWidth: 170, formatter: 'formatDateTime', title: t('page.coupons.userCoupons.table.usedAt') },
      { align: 'left', fixed: 'right', minWidth: 150, field: 'actions', slots: { default: 'actions' }, title: t('page.coupons.userCoupons.table.actions') },
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
        <div class="text-text-secondary">{{ t('page.coupons.userCoupons.stats.total') }}</div>
        <div class="mt-2 text-2xl font-semibold">{{ stats.total }}</div>
      </div>
      <div class="rounded bg-white p-4">
        <div class="text-text-secondary">{{ t('page.coupons.userCoupons.stats.unused') }}</div>
        <div class="mt-2 text-2xl font-semibold text-green-600">{{ stats.unused }}</div>
      </div>
      <div class="rounded bg-white p-4">
        <div class="text-text-secondary">{{ t('page.coupons.userCoupons.stats.used') }}</div>
        <div class="mt-2 text-2xl font-semibold text-blue-600">{{ stats.used }}</div>
      </div>
      <div class="rounded bg-white p-4">
        <div class="text-text-secondary">{{ t('page.coupons.userCoupons.stats.expired') }}</div>
        <div class="mt-2 text-2xl font-semibold text-gray-500">{{ stats.expired }}</div>
      </div>
    </div>

    <UserCouponGrid>
      <template #toolbar-actions>
        <Space>
          <Button v-access:code="'coupon:write'" type="primary" @click="openDistributeModal('single')">{{ t('page.coupons.userCoupons.toolbar.single') }}</Button>
          <Button v-access:code="'coupon:write'" @click="openDistributeModal('batch')">{{ t('page.coupons.userCoupons.toolbar.batch') }}</Button>
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
          {{ t('page.coupons.userCoupons.actions.use') }}
        </Button>
      </template>
    </UserCouponGrid>

    <Modal
      :open="distributeModalOpen"
      :title="distributeTitle"
      :confirm-loading="distributeSubmitting"
      :ok-text="t('page.coupons.userCoupons.modal.ok')"
      :cancel-text="t('page.coupons.userCoupons.modal.cancel')"
      @cancel="() => (distributeModalOpen = false)"
      @ok="submitDistribute"
    >
      <Form ref="distributeFormRef" :label-col="{ span: 6 }" :model="distributeFormModel" :wrapper-col="{ span: 17 }">
        <Form.Item :label="t('page.coupons.userCoupons.formFields.couponId.label')" name="couponId" :rules="[{ required: true, message: t('page.coupons.userCoupons.formFields.couponId.required') }]">
          <Select
            v-model:value="distributeFormModel.couponId"
            :options="couponOptions"
            show-search
            option-filter-prop="label"
            :placeholder="t('page.coupons.userCoupons.formFields.couponId.placeholder')"
          />
        </Form.Item>

        <Form.Item :label="t('page.coupons.userCoupons.formFields.searchUser.label')">
          <Select
            v-if="distributeMode === 'single'"
            v-model:value="selectedSingleUserId"
            :filter-option="false"
            :loading="userSearchLoading"
            :options="userSearchOptions"
            allow-clear
            show-search
            :placeholder="t('page.coupons.userCoupons.formFields.searchUser.singlePlaceholder')"
            @focus="() => handleUserSearch()"
            @search="handleUserSearch"
          />

          <Select
            v-else
            v-model:value="selectedBatchUserIds"
            mode="multiple"
            :filter-option="false"
            :loading="userSearchLoading"
            :options="userSearchOptions"
            allow-clear
            show-search
            :placeholder="t('page.coupons.userCoupons.formFields.searchUser.batchPlaceholder')"
            @focus="() => handleUserSearch()"
            @search="handleUserSearch"
          />
        </Form.Item>

        <Form.Item
          v-if="distributeMode === 'single'"
          :label="t('page.coupons.userCoupons.formFields.manualUserId.label')"
          name="userId"
        >
          <Input v-model:value="distributeFormModel.userId" :placeholder="t('page.coupons.userCoupons.formFields.manualUserId.placeholder')" />
        </Form.Item>

        <Form.Item
          v-else
          :label="t('page.coupons.userCoupons.formFields.manualUserIds.label')"
          name="userIdsText"
        >
          <Input.TextArea
            v-model:value="distributeFormModel.userIdsText"
            :rows="5"
            :placeholder="t('page.coupons.userCoupons.formFields.manualUserIds.placeholder')"
          />
        </Form.Item>

        <Form.Item :label="t('page.coupons.userCoupons.formFields.expiresAt.label')" name="expiresAt">
          <DatePicker v-model:value="distributeFormModel.expiresAt" style="width: 100%" show-time />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
