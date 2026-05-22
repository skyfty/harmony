<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import type { CouponItem, CouponTypeItem } from '#/api';
import type { Dayjs } from 'dayjs';

import dayjs from 'dayjs';
import { computed, onMounted, reactive, ref } from 'vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createCouponApi,
  deleteCouponApi,
  listCouponsApi,
  listCouponTypesApi,
  updateCouponApi,
} from '#/api';

import { Button, DatePicker, Form, Input, InputNumber, message, Modal, Select, Space, Switch, Tag, Tooltip } from 'ant-design-vue';
import { DeleteOutlined, EditOutlined } from '@ant-design/icons-vue';

interface CouponFormModel {
  typeId: string;
  title: string;
  description: string;
  validUntil?: Dayjs;
  price: number;
  isVisible: boolean;
}

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<string | null>(null);
const formRef = ref<FormInstance>();
const couponTypes = ref<CouponTypeItem[]>([]);

const formModel = reactive<CouponFormModel>({
  typeId: '',
  title: '',
  description: '',
  validUntil: undefined,
  price: 0,
  isVisible: true,
});

const modalTitle = computed(() => (editingId.value ? 'Edit Coupon' : 'Create Coupon'));

function resetForm() {
  formModel.typeId = couponTypes.value[0]?.id ?? '';
  formModel.title = '';
  formModel.description = '';
  formModel.validUntil = undefined;
  formModel.price = 0;
  formModel.isVisible = true;
}

function closeModal() {
  modalOpen.value = false;
}

function formatVisible(value: boolean) {
  return value ? 'Visible' : 'Hidden';
}

function formatPrice(value?: number | null) {
  return Number(value ?? 0).toFixed(2);
}

async function loadCouponTypes() {
  couponTypes.value = await listCouponTypesApi();
  if (!formModel.typeId && couponTypes.value.length) {
    formModel.typeId = couponTypes.value[0].id;
  }
}

function openCreate() {
  editingId.value = null;
  resetForm();
  modalOpen.value = true;
}

function openEdit(row: CouponItem) {
  editingId.value = row.id;
  formModel.typeId = row.typeId;
  formModel.title = row.title;
  formModel.description = row.description;
  formModel.validUntil = row.validUntil ? dayjs(row.validUntil) : undefined;
  formModel.price = Number(row.product?.price ?? 0);
  formModel.isVisible = row.isVisible !== false;
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
    const payload = {
      typeId: formModel.typeId,
      title: formModel.title.trim(),
      description: formModel.description.trim(),
      validUntil: formModel.validUntil?.toISOString() ?? '',
      price: formModel.price,
      isVisible: formModel.isVisible,
    };

    if (editingId.value) {
      await updateCouponApi(editingId.value, payload);
      message.success('Coupon updated successfully');
    } else {
      await createCouponApi(payload);
      message.success('Coupon created successfully');
    }
    modalOpen.value = false;
    couponGridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: CouponItem) {
  Modal.confirm({
    title: `Delete coupon "${row.title}"?`,
    content: 'This will remove the coupon, linked product, and all owned user coupons.',
    okType: 'danger',
    onOk: async () => {
      await deleteCouponApi(row.id);
      message.success('Coupon deleted successfully');
      couponGridApi.reload();
    },
  });
}

const [CouponGrid, couponGridApi] = useVbenVxeGrid<CouponItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: 'Keyword',
        componentProps: { allowClear: true, placeholder: 'Search by title or description' },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'typeName', minWidth: 140, title: 'Type' },
      { field: 'title', minWidth: 200, title: 'Title' },
      { field: 'description', minWidth: 280, title: 'Description' },
      {
        field: 'isVisible',
        minWidth: 110,
        title: 'Visible',
        slots: { default: 'visible' },
      },
      {
        field: 'product',
        minWidth: 120,
        title: 'Price',
        slots: { default: 'price' },
      },
      {
        field: 'validUntil',
        minWidth: 180,
        formatter: 'formatDateTime',
        title: 'Valid Until',
      },
      {
        field: 'createdAt',
        minWidth: 180,
        formatter: 'formatDateTime',
        title: 'Created At',
      },
      {
        field: 'updatedAt',
        minWidth: 180,
        formatter: 'formatDateTime',
        title: 'Updated At',
      },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 160,
        slots: { default: 'actions' },
        title: 'Actions',
      },
    ],
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, formValues: Record<string, any>) => {
          return listCouponsApi({
            keyword: formValues.keyword,
            page: page.currentPage,
            pageSize: page.pageSize,
          });
        },
      },
    },
    toolbarConfig: {
      refresh: true,
      search: true,
    },
    pagerConfig: {
      pageSize: 20,
    },
  },
});

onMounted(async () => {
  await loadCouponTypes();
});
</script>

<template>
  <div class="p-5">
    <CouponGrid>
      <template #toolbar-actions>
        <Button v-access:code="'coupon:write'" type="primary" @click="openCreate">
          Create Coupon
        </Button>
      </template>

      <template #visible="{ row }">
        <Tag :color="row.isVisible ? 'green' : 'default'">
          {{ formatVisible(row.isVisible) }}
        </Tag>
      </template>

      <template #price="{ row }">
        <span>{{ formatPrice(row.product?.price) }}</span>
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip title="Edit">
            <Button v-access:code="'coupon:write'" size="small" type="text" @click="openEdit(row)">
              <EditOutlined />
            </Button>
          </Tooltip>
          <Tooltip title="Delete">
            <Button v-access:code="'coupon:write'" danger size="small" type="text" @click="handleDelete(row)">
              <DeleteOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
    </CouponGrid>

    <Modal
      :open="modalOpen"
      :title="modalTitle"
      :confirm-loading="submitting"
      ok-text="OK"
      cancel-text="Cancel"
      destroy-on-close
      @cancel="closeModal"
      @ok="submit"
    >
      <Form ref="formRef" :model="formModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 17 }">
        <Form.Item
          label="Coupon Type"
          name="typeId"
          :rules="[{ required: true, message: 'Please select a coupon type' }]"
        >
          <Select
            v-model:value="formModel.typeId"
            :options="couponTypes.map((item) => ({ label: item.name, value: item.id }))"
            placeholder="Select a type"
          />
        </Form.Item>

        <Form.Item
          label="Title"
          name="title"
          :rules="[{ required: true, message: 'Please enter a title' }]"
        >
          <Input v-model:value="formModel.title" allow-clear />
        </Form.Item>

        <Form.Item
          label="Description"
          name="description"
          :rules="[{ required: true, message: 'Please enter a description' }]"
        >
          <Input.TextArea v-model:value="formModel.description" :rows="4" allow-clear />
        </Form.Item>

        <Form.Item
          label="Product Price"
          name="price"
          :rules="[{ required: true, message: 'Please enter a product price' }]"
        >
          <InputNumber v-model:value="formModel.price" :min="0" :precision="2" style="width: 100%" />
        </Form.Item>

        <Form.Item label="Visible" name="isVisible">
          <Switch v-model:checked="formModel.isVisible" />
        </Form.Item>

        <Form.Item
          label="Valid Until"
          name="validUntil"
          :rules="[{ required: true, message: 'Please select a valid until date' }]"
        >
          <DatePicker
            v-model:value="formModel.validUntil"
            placeholder="Select date and time"
            show-time
            style="width: 100%"
          />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
