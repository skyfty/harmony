<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import type { CouponTypeItem } from '#/api';

import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import dayjs, { type Dayjs } from 'dayjs';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createCouponApi,
  deleteCouponApi,
  getCouponApi,
  listCouponTypesApi,
  listCouponsApi,
  updateCouponApi,
} from '#/api';

import { Button, DatePicker, Form, Input, message, Modal, Select, Space, Tooltip } from 'ant-design-vue';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons-vue';

interface CouponFormModel {
  typeId: string;
  title: string;
  description: string;
  validUntil?: Dayjs;
}

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<string | null>(null);
const couponFormRef = ref<FormInstance>();
const couponTypes = ref<CouponTypeItem[]>([]);
const loadingCouponTypes = ref(false);

const couponFormModel = reactive<CouponFormModel>({
  typeId: '',
  title: '',
  description: '',
  validUntil: undefined,
});

const { t } = useI18n();
const modalTitle = computed(() => (editingId.value ? t('page.coupons.index.modal.edit') : t('page.coupons.index.modal.create')));

function resetForm() {
  couponFormModel.typeId = '';
  couponFormModel.title = '';
  couponFormModel.description = '';
  couponFormModel.validUntil = undefined;
}

const typeOptions = computed(() =>
  couponTypes.value
    .filter((item) => item.enabled !== false)
    .map((item) => ({
      label: `${item.name} (${item.code})`,
      value: item.id,
    })),
);

async function loadCouponTypes() {
  loadingCouponTypes.value = true;
  try {
    couponTypes.value = await listCouponTypesApi();
  } finally {
    loadingCouponTypes.value = false;
  }
}

function openCreateModal() {
  editingId.value = null;
  resetForm();
  void loadCouponTypes()
    .then(() => {
      modalOpen.value = true;
    })
    .catch(() => {
      message.error(t('page.coupons.index.message.loadTypesFailed'));
    });
}

async function openEditModal(row: any) {
  editingId.value = row.id;
  try {
    const [data] = await Promise.all([getCouponApi(row.id), loadCouponTypes()]);
    couponFormModel.typeId = data.typeId || data.type?.id || '';
    couponFormModel.title = data.title || data.name || '';
    couponFormModel.description = data.description || '';
    couponFormModel.validUntil = data.validUntil ? dayjs(data.validUntil) : undefined;
    modalOpen.value = true;
  } catch {
    message.error(t('page.coupons.index.message.readFailed'));
  }
}

async function submitCoupon() {
  const form = couponFormRef.value;
  if (!form) return;
  await form.validate();
  submitting.value = true;
  try {
    const payload = {
      typeId: couponFormModel.typeId,
      name: couponFormModel.title.trim(),
      title: couponFormModel.title.trim(),
      description: couponFormModel.description.trim(),
      validUntil: couponFormModel.validUntil!.toISOString(),
    };

    if (editingId.value) {
      await updateCouponApi(editingId.value, payload);
      message.success(t('page.coupons.index.message.updateSuccess'));
    } else {
      await createCouponApi(payload);
      message.success(t('page.coupons.index.message.createSuccess'));
    }
    modalOpen.value = false;
    couponGridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: any) {
  Modal.confirm({
    title: t('page.coupons.index.confirm.delete.title', { name: row.title || row.name }),
    content: t('page.coupons.index.confirm.delete.content'),
    okType: 'danger',
    onOk: async () => {
      await deleteCouponApi(row.id);
      message.success(t('page.coupons.index.message.deleteSuccess'));
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
        label: t('page.coupons.index.form.keyword.label'),
        componentProps: { allowClear: true, placeholder: t('page.coupons.index.form.keyword.placeholder') },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'typeName', minWidth: 160, title: t('page.coupons.index.table.typeName') },
      { field: 'title', minWidth: 180, title: t('page.coupons.index.table.title') },
      { field: 'description', minWidth: 260, title: t('page.coupons.index.table.description') },
      { field: 'validUntil', minWidth: 180, formatter: 'formatDateTime', title: t('page.coupons.index.table.validUntil') },
      { field: 'createdAt', minWidth: 180, formatter: 'formatDateTime', title: t('page.coupons.index.table.createdAt') },
      { field: 'updatedAt', minWidth: 180, formatter: 'formatDateTime', title: t('page.coupons.index.table.updatedAt') },
      { align: 'left', fixed: 'right', minWidth: 160, field: 'actions', slots: { default: 'actions' }, title: t('page.coupons.index.table.actions') },
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
        <Button v-access:code="'coupon:write'" type="primary" @click="openCreateModal">{{ t('page.coupons.index.toolbar.create') }}</Button>
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip :title="t('page.coupons.index.actions.edit')">
            <Button v-access:code="'coupon:write'" size="small" type="text" @click="openEditModal(row)">
              <EditOutlined />
            </Button>
          </Tooltip>
          <Tooltip :title="t('page.coupons.index.actions.delete')">
            <Button v-access:code="'coupon:write'" danger size="small" type="text" @click="handleDelete(row)">
              <DeleteOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
    </CouponGrid>

    <Modal
      :open="modalOpen"
      :confirm-loading="submitting"
      :title="modalTitle"
      :ok-text="t('page.coupons.index.modal.ok')"
      :cancel-text="t('page.coupons.index.modal.cancel')"
      destroy-on-close
      @cancel="() => (modalOpen = false)"
      @ok="submitCoupon"
    >
      <Form ref="couponFormRef" :label-col="{ span: 6 }" :model="couponFormModel" :wrapper-col="{ span: 17 }">
        <Form.Item :label="t('page.coupons.index.formFields.typeId.label')" name="typeId" :rules="[{ required: true, message: t('page.coupons.index.formFields.typeId.required') }]">
          <Select
            v-model:value="couponFormModel.typeId"
            :options="typeOptions"
            :loading="loadingCouponTypes"
            :placeholder="t('page.coupons.index.formFields.typeId.placeholder')"
            show-search
            option-filter-prop="label"
          />
        </Form.Item>
        <Form.Item :label="t('page.coupons.index.formFields.title.label')" name="title" :rules="[{ required: true, message: t('page.coupons.index.formFields.title.required') }]">
          <Input v-model:value="couponFormModel.title" :placeholder="t('page.coupons.index.formFields.title.placeholder')" />
        </Form.Item>
        <Form.Item :label="t('page.coupons.index.formFields.description.label')" name="description" :rules="[{ required: true, message: t('page.coupons.index.formFields.description.required') }]">
          <Input.TextArea v-model:value="couponFormModel.description" :placeholder="t('page.coupons.index.formFields.description.placeholder')" rows="4" />
        </Form.Item>
        <Form.Item :label="t('page.coupons.index.formFields.validUntil.label')" name="validUntil" :rules="[{ required: true, message: t('page.coupons.index.formFields.validUntil.required') }]">
          <DatePicker v-model:value="couponFormModel.validUntil" style="width: 100%" show-time />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
