<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import type { CouponTypeItem } from '#/api';

import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createCouponTypeApi,
  deleteCouponTypeApi,
  listCouponTypesApi,
  updateCouponTypeApi,
} from '#/api';

import {
  Button,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Space,
  Switch,
  Tooltip,
} from 'ant-design-vue';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons-vue';

interface CouponTypeFormModel {
  name: string;
  code: string;
  iconUrl: string;
  sort: number;
  enabled: boolean;
}

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<null | string>(null);
const formRef = ref<FormInstance>();

const formModel = reactive<CouponTypeFormModel>({
  name: '',
  code: '',
  iconUrl: '',
  sort: 0,
  enabled: true,
});

const { t } = useI18n();
const modalTitle = computed(() => (editingId.value ? t('page.coupons.types.modal.edit') : t('page.coupons.types.modal.create')));

function resetForm() {
  formModel.name = '';
  formModel.code = '';
  formModel.iconUrl = '';
  formModel.sort = 0;
  formModel.enabled = true;
}

function openCreate() {
  editingId.value = null;
  resetForm();
  modalOpen.value = true;
}

function openEdit(row: CouponTypeItem) {
  editingId.value = row.id;
  formModel.name = row.name;
  formModel.code = row.code;
  formModel.iconUrl = row.iconUrl || '';
  formModel.sort = row.sort || 0;
  formModel.enabled = row.enabled !== false;
  modalOpen.value = true;
}

async function submit() {
  const form = formRef.value;
  if (!form) {
    return;
  }
  await form.validate();
  submitting.value = true;
  try {
    if (editingId.value) {
      await updateCouponTypeApi(editingId.value, {
        name: formModel.name.trim(),
        code: formModel.code.trim().toLowerCase(),
        iconUrl: formModel.iconUrl.trim(),
        sort: formModel.sort,
        enabled: formModel.enabled,
      });
      message.success(t('page.coupons.types.message.updateSuccess'));
    } else {
      await createCouponTypeApi({
        name: formModel.name.trim(),
        code: formModel.code.trim().toLowerCase(),
        iconUrl: formModel.iconUrl.trim(),
        sort: formModel.sort,
        enabled: formModel.enabled,
      });
      message.success(t('page.coupons.types.message.createSuccess'));
    }
    modalOpen.value = false;
    gridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: CouponTypeItem) {
  Modal.confirm({
    title: t('page.coupons.types.confirm.delete.title', { name: row.name }),
    content: t('page.coupons.types.confirm.delete.content'),
    okType: 'danger',
    onOk: async () => {
      await deleteCouponTypeApi(row.id);
      message.success(t('page.coupons.types.message.deleteSuccess'));
      gridApi.reload();
    },
  });
}

const [Grid, gridApi] = useVbenVxeGrid<CouponTypeItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: t('page.coupons.types.form.keyword.label'),
        componentProps: { allowClear: true, placeholder: t('page.coupons.types.form.keyword.placeholder') },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 180, title: t('page.coupons.types.table.name') },
      { field: 'code', minWidth: 140, title: t('page.coupons.types.table.code') },
      { field: 'iconUrl', minWidth: 280, title: t('page.coupons.types.table.iconUrl') },
      { field: 'sort', minWidth: 100, title: t('page.coupons.types.table.sort') },
      {
        field: 'enabled',
        minWidth: 100,
        title: t('page.coupons.types.table.enabled'),
        slots: { default: 'enabled' },
      },
      {
        field: 'updatedAt',
        minWidth: 180,
        formatter: 'formatDateTime',
        title: t('page.coupons.types.table.updatedAt'),
      },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 180,
        slots: { default: 'actions' },
        title: t('page.coupons.types.table.actions'),
      },
    ],
    proxyConfig: {
      ajax: {
        query: async ({}, formValues: Record<string, any>) => {
          const list = await listCouponTypesApi({ keyword: formValues.keyword });
          return {
            items: list || [],
            total: (list || []).length,
          };
        },
      },
    },
    toolbarConfig: {
      refresh: true,
      search: true,
    },
    pagerConfig: {
      pageSize: 50,
    },
  },
});
</script>

<template>
  <div class="p-5">
    <Grid>
      <template #toolbar-actions>
        <Button v-access:code="'coupon:write'" type="primary" @click="openCreate">{{ t('page.coupons.types.toolbar.create') }}</Button>
      </template>

      <template #enabled="{ row }">
        <Switch :checked="row.enabled" disabled />
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip :title="t('page.coupons.types.actions.edit')">
            <Button v-access:code="'coupon:write'" size="small" type="text" @click="openEdit(row)">
              <EditOutlined />
            </Button>
          </Tooltip>
          <Tooltip :title="t('page.coupons.types.actions.delete')">
            <Button v-access:code="'coupon:write'" danger size="small" type="text" @click="handleDelete(row)">
              <DeleteOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
    </Grid>

    <Modal
      :open="modalOpen"
      :title="modalTitle"
      :confirm-loading="submitting"
      :ok-text="t('page.coupons.types.modal.ok')"
      :cancel-text="t('page.coupons.types.modal.cancel')"
      destroy-on-close
      @cancel="() => (modalOpen = false)"
      @ok="submit"
    >
      <Form ref="formRef" :model="formModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 17 }">
        <Form.Item :label="t('page.coupons.types.formFields.name.label')" name="name" :rules="[{ required: true, message: t('page.coupons.types.formFields.name.required') }]">
          <Input v-model:value="formModel.name" allow-clear />
        </Form.Item>
        <Form.Item :label="t('page.coupons.types.formFields.code.label')" name="code" :rules="[{ required: true, message: t('page.coupons.types.formFields.code.required') }]">
          <Input v-model:value="formModel.code" allow-clear :placeholder="t('page.coupons.types.formFields.code.placeholder')" />
        </Form.Item>
        <Form.Item :label="t('page.coupons.types.formFields.iconUrl.label')" name="iconUrl">
          <Input v-model:value="formModel.iconUrl" allow-clear :placeholder="t('page.coupons.types.formFields.iconUrl.placeholder')" />
        </Form.Item>
        <Form.Item :label="t('page.coupons.types.formFields.sort.label')" name="sort">
          <InputNumber v-model:value="formModel.sort" style="width: 100%" />
        </Form.Item>
        <Form.Item :label="t('page.coupons.types.formFields.enabled.label')" name="enabled">
          <Switch v-model:checked="formModel.enabled" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
