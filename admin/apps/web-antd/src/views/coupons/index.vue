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

import { Button, DatePicker, Form, Input, message, Modal, Select, Space, Switch, Tag, Tooltip } from 'ant-design-vue';
import { CopyOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons-vue';

interface CouponFormModel {
  typeId: string;
  title: string;
  description: string;
  validUntil?: Dayjs;
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
  isVisible: true,
});

const modalTitle = computed(() => (editingId.value ? '编辑卡券' : '新建卡券'));

function resetForm() {
  formModel.typeId = couponTypes.value[0]?.id ?? '';
  formModel.title = '';
  formModel.description = '';
  formModel.validUntil = undefined;
  formModel.isVisible = true;
}

function closeModal() {
  modalOpen.value = false;
}

function formatVisible(value: boolean) {
  return value ? '可见' : '隐藏';
}

async function loadCouponTypes() {
  couponTypes.value = await listCouponTypesApi();
  if (!formModel.typeId && couponTypes.value.length) {
    formModel.typeId = couponTypes.value[0]?.id ?? '';
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
  formModel.isVisible = row.isVisible !== false;
  modalOpen.value = true;
}

async function copyCouponToken(row: CouponItem) {
  const payload = {
    id: row.id,
    validUntil: row.validUntil,
    type: row.type?.code ?? row.typeId,
    name: row.title,
    description: row.description,
  };
  const text = JSON.stringify(payload, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    message.success('已复制卡券标识');
  } catch {
    message.error('复制失败，请手动复制');
  }
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
      isVisible: formModel.isVisible,
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

function handleDelete(row: CouponItem) {
  Modal.confirm({
    title: `确认删除卡券「${row.title}」吗？`,
    content: '删除后将同时移除用户持有记录，操作不可恢复。',
    okType: 'danger',
    onOk: async () => {
      await deleteCouponApi(row.id);
      message.success('卡券删除成功');
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
        label: '关键词',
        componentProps: { allowClear: true, placeholder: '按标题或描述搜索' },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'typeName', minWidth: 140, title: '分类' },
      { field: 'title', minWidth: 200, title: '标题' },
      { field: 'description', minWidth: 280, title: '描述' },
      {
        field: 'isVisible',
        minWidth: 110,
        title: '可见性',
        slots: { default: 'visible' },
      },
      {
        field: 'validUntil',
        minWidth: 180,
        formatter: 'formatDateTime',
        title: '有效期',
      },
      {
        field: 'createdAt',
        minWidth: 180,
        formatter: 'formatDateTime',
        title: '创建时间',
      },
      {
        field: 'updatedAt',
        minWidth: 180,
        formatter: 'formatDateTime',
        title: '更新时间',
      },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 220,
        slots: { default: 'actions' },
        title: '操作',
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
          新建卡券
        </Button>
      </template>

      <template #visible="{ row }">
        <Tag :color="row.isVisible ? 'green' : 'default'">
          {{ formatVisible(row.isVisible) }}
        </Tag>
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip title="复制标识">
            <Button v-access:code="'coupon:write'" size="small" type="text" @click="copyCouponToken(row)">
              <CopyOutlined />
            </Button>
          </Tooltip>
          <Tooltip title="编辑">
            <Button v-access:code="'coupon:write'" size="small" type="text" @click="openEdit(row)">
              <EditOutlined />
            </Button>
          </Tooltip>
          <Tooltip title="删除">
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
      ok-text="确定"
      cancel-text="取消"
      destroy-on-close
      @cancel="closeModal"
      @ok="submit"
    >
      <Form ref="formRef" :model="formModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 17 }">
        <Form.Item
          label="卡券分类"
          name="typeId"
          :rules="[{ required: true, message: '请选择卡券分类' }]"
        >
          <Select
            v-model:value="formModel.typeId"
            :options="couponTypes.map((item) => ({ label: item.name, value: item.id }))"
            placeholder="请选择分类"
          />
        </Form.Item>

        <Form.Item
          label="标题"
          name="title"
          :rules="[{ required: true, message: '请输入标题' }]"
        >
          <Input v-model:value="formModel.title" allow-clear />
        </Form.Item>

        <Form.Item
          label="描述"
          name="description"
          :rules="[{ required: true, message: '请输入描述' }]"
        >
          <Input.TextArea v-model:value="formModel.description" :rows="4" allow-clear />
        </Form.Item>

        <Form.Item label="是否可见" name="isVisible">
          <Switch v-model:checked="formModel.isVisible" />
        </Form.Item>

        <Form.Item
          label="有效期"
          name="validUntil"
          :rules="[{ required: true, message: '请选择有效期' }]"
        >
          <DatePicker
            v-model:value="formModel.validUntil"
            placeholder="请选择日期和时间"
            show-time
            style="width: 100%"
          />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
