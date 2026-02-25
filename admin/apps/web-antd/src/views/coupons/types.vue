<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import type { CouponTypeItem } from '#/api';

import { computed, reactive, ref } from 'vue';

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
} from 'ant-design-vue';

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

const modalTitle = computed(() => (editingId.value ? '编辑卡券类型' : '新增卡券类型'));

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
      message.success('卡券类型更新成功');
    } else {
      await createCouponTypeApi({
        name: formModel.name.trim(),
        code: formModel.code.trim().toLowerCase(),
        iconUrl: formModel.iconUrl.trim(),
        sort: formModel.sort,
        enabled: formModel.enabled,
      });
      message.success('卡券类型创建成功');
    }
    modalOpen.value = false;
    gridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: CouponTypeItem) {
  Modal.confirm({
    title: `确认删除卡券类型“${row.name}”吗？`,
    content: '删除后不可恢复，且被卡券引用的类型无法删除。',
    okType: 'danger',
    onOk: async () => {
      await deleteCouponTypeApi(row.id);
      message.success('卡券类型已删除');
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
        label: '关键字',
        componentProps: { allowClear: true, placeholder: '名称 / 编码' },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 180, title: '名称' },
      { field: 'code', minWidth: 140, title: '编码' },
      { field: 'iconUrl', minWidth: 280, title: '图标地址' },
      { field: 'sort', minWidth: 100, title: '排序' },
      {
        field: 'enabled',
        minWidth: 100,
        title: '启用',
        slots: { default: 'enabled' },
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
        minWidth: 180,
        slots: { default: 'actions' },
        title: '操作',
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
        <Button v-access:code="'coupon:write'" type="primary" @click="openCreate">新增类型</Button>
      </template>

      <template #enabled="{ row }">
        <Switch :checked="row.enabled" disabled />
      </template>

      <template #actions="{ row }">
        <Space>
          <Button v-access:code="'coupon:write'" size="small" type="link" @click="openEdit(row)">编辑</Button>
          <Button v-access:code="'coupon:write'" danger size="small" type="link" @click="handleDelete(row)">删除</Button>
        </Space>
      </template>
    </Grid>

    <Modal
      :open="modalOpen"
      :title="modalTitle"
      :confirm-loading="submitting"
      ok-text="保存"
      cancel-text="取消"
      destroy-on-close
      @cancel="() => (modalOpen = false)"
      @ok="submit"
    >
      <Form ref="formRef" :model="formModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 17 }">
        <Form.Item label="名称" name="name" :rules="[{ required: true, message: '请输入类型名称' }]">
          <Input v-model:value="formModel.name" allow-clear />
        </Form.Item>
        <Form.Item label="编码" name="code" :rules="[{ required: true, message: '请输入类型编码' }]">
          <Input v-model:value="formModel.code" allow-clear placeholder="例如：ticket" />
        </Form.Item>
        <Form.Item label="图标地址" name="iconUrl">
          <Input v-model:value="formModel.iconUrl" allow-clear placeholder="可选" />
        </Form.Item>
        <Form.Item label="排序" name="sort">
          <InputNumber v-model:value="formModel.sort" style="width: 100%" />
        </Form.Item>
        <Form.Item label="启用" name="enabled">
          <Switch v-model:checked="formModel.enabled" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
