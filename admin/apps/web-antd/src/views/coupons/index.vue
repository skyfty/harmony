<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';

import { computed, reactive, ref } from 'vue';
import dayjs, { type Dayjs } from 'dayjs';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createCouponApi,
  deleteCouponApi,
  getCouponApi,
  listCouponsApi,
  updateCouponApi,
} from '#/api';

import { Button, DatePicker, Form, Input, message, Modal, Space } from 'ant-design-vue';

interface CouponFormModel {
  title: string;
  description: string;
  validUntil?: Dayjs;
}

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<string | null>(null);
const couponFormRef = ref<FormInstance>();

const couponFormModel = reactive<CouponFormModel>({
  title: '',
  description: '',
  validUntil: undefined,
});

const modalTitle = computed(() => (editingId.value ? '编辑卡券' : '新建卡券'));

function resetForm() {
  couponFormModel.title = '';
  couponFormModel.description = '';
  couponFormModel.validUntil = undefined;
}

function openCreateModal() {
  editingId.value = null;
  resetForm();
  modalOpen.value = true;
}

async function openEditModal(row: any) {
  editingId.value = row.id;
  try {
    const data = await getCouponApi(row.id);
    couponFormModel.title = data.title || data.name || '';
    couponFormModel.description = data.description || '';
    couponFormModel.validUntil = data.validUntil ? dayjs(data.validUntil) : undefined;
    modalOpen.value = true;
  } catch {
    message.error('读取卡券信息失败');
  }
}

async function submitCoupon() {
  const form = couponFormRef.value;
  if (!form) return;
  await form.validate();
  submitting.value = true;
  try {
    const payload = {
      name: couponFormModel.title.trim(),
      title: couponFormModel.title.trim(),
      description: couponFormModel.description.trim(),
      validUntil: couponFormModel.validUntil!.toISOString(),
    };

    if (editingId.value) {
      await updateCouponApi(editingId.value, payload);
      message.success('卡券更新成功');
    } else {
      await createCouponApi(payload);
      message.success('卡券创建成功');
    }
    modalOpen.value = false;
    couponGridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: any) {
  Modal.confirm({
    title: `确认删除卡券“${row.title || row.name}”吗？`,
    content: '删除后不可恢复。',
    okType: 'danger',
    onOk: async () => {
      await deleteCouponApi(row.id);
      message.success('卡券已删除');
      couponGridApi.reload();
    },
  });
}

const [CouponGrid, couponGridApi] = useVbenVxeGrid({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键字',
        componentProps: { allowClear: true, placeholder: '名称 / 描述' },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'title', minWidth: 180, title: '名称' },
      { field: 'description', minWidth: 260, title: '描述' },
      { field: 'validUntil', minWidth: 180, formatter: 'formatDateTime', title: '有效期至' },
      { field: 'createdAt', minWidth: 180, formatter: 'formatDateTime', title: '创建时间' },
      { field: 'updatedAt', minWidth: 180, formatter: 'formatDateTime', title: '更新时间' },
      { align: 'left', fixed: 'right', minWidth: 160, field: 'actions', slots: { default: 'actions' }, title: '操作' },
    ],
    keepSource: true,
    pagerConfig: { pageSize: 20 },
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, formValues: Record<string, any>) => {
          const params = {
            keyword: formValues.keyword,
            page: page.currentPage,
            pageSize: page.pageSize,
          };
          return await listCouponsApi(params);
        },
      },
    },
    toolbarConfig: { custom: true, refresh: true, search: true, zoom: true },
  },
});
</script>

<template>
  <div class="p-5">
    <CouponGrid>
      <template #toolbar-actions>
        <Button v-access:code="'coupon:write'" type="primary" @click="openCreateModal">新建卡券</Button>
      </template>

      <template #actions="{ row }">
        <Space>
          <Button v-access:code="'coupon:write'" size="small" type="link" @click="openEditModal(row)">编辑</Button>
          <Button v-access:code="'coupon:write'" danger size="small" type="link" @click="handleDelete(row)">删除</Button>
        </Space>
      </template>
    </CouponGrid>

    <Modal
      :open="modalOpen"
      :confirm-loading="submitting"
      :title="modalTitle"
      ok-text="保存"
      cancel-text="取消"
      destroy-on-close
      @cancel="() => (modalOpen = false)"
      @ok="submitCoupon"
    >
      <Form ref="couponFormRef" :label-col="{ span: 6 }" :model="couponFormModel" :wrapper-col="{ span: 17 }">
        <Form.Item label="名称" name="title" :rules="[{ required: true, message: '请输入名称' }]">
          <Input v-model:value="couponFormModel.title" placeholder="卡券名称" />
        </Form.Item>
        <Form.Item label="描述" name="description" :rules="[{ required: true, message: '请输入描述' }]">
          <Input v-model:value="couponFormModel.description" placeholder="卡券描述" />
        </Form.Item>
        <Form.Item label="有效期" name="validUntil" :rules="[{ required: true, message: '请选择有效期' }]">
          <DatePicker v-model:value="couponFormModel.validUntil" style="width: 100%" show-time />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
