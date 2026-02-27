<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import type { MiniAppItem } from '#/api';

import { computed, reactive, ref } from 'vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createMiniAppApi,
  deleteMiniAppApi,
  listMiniAppsApi,
  updateMiniAppApi,
} from '#/api';

import {
  Button,
  Form,
  Input,
  message,
  Modal,
  Space,
  Switch,
} from 'ant-design-vue';

interface MiniAppFormModel {
  miniAppId: string;
  name: string;
  appSecret: string;
  enabled: boolean;
  isDefault: boolean;
  paymentEnabled: boolean;
  mchId: string;
  serialNo: string;
  apiV3Key: string;
  notifyUrl: string;
  baseUrl: string;
  privateKey: string;
  platformPublicKey: string;
  callbackSkipVerifyInDev: boolean;
  mockPlatformPrivateKey: string;
}

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<null | string>(null);
const formRef = ref<FormInstance>();

const formModel = reactive<MiniAppFormModel>({
  miniAppId: '',
  name: '',
  appSecret: '',
  enabled: true,
  isDefault: false,
  paymentEnabled: false,
  mchId: '',
  serialNo: '',
  apiV3Key: '',
  notifyUrl: '',
  baseUrl: 'https://api.mch.weixin.qq.com',
  privateKey: '',
  platformPublicKey: '',
  callbackSkipVerifyInDev: false,
  mockPlatformPrivateKey: '',
});

const modalTitle = computed(() => (editingId.value ? '编辑小程序配置' : '新增小程序配置'));

function resetForm() {
  formModel.miniAppId = '';
  formModel.name = '';
  formModel.appSecret = '';
  formModel.enabled = true;
  formModel.isDefault = false;
  formModel.paymentEnabled = false;
  formModel.mchId = '';
  formModel.serialNo = '';
  formModel.apiV3Key = '';
  formModel.notifyUrl = '';
  formModel.baseUrl = 'https://api.mch.weixin.qq.com';
  formModel.privateKey = '';
  formModel.platformPublicKey = '';
  formModel.callbackSkipVerifyInDev = false;
  formModel.mockPlatformPrivateKey = '';
}

function openCreate() {
  editingId.value = null;
  resetForm();
  modalOpen.value = true;
}

function openEdit(row: MiniAppItem) {
  editingId.value = row.id;
  formModel.miniAppId = row.miniAppId;
  formModel.name = row.name;
  formModel.appSecret = row.appSecret || '';
  formModel.enabled = row.enabled !== false;
  formModel.isDefault = row.isDefault === true;
  formModel.paymentEnabled = row.wechatPay?.enabled === true;
  formModel.mchId = row.wechatPay?.mchId || '';
  formModel.serialNo = row.wechatPay?.serialNo || '';
  formModel.apiV3Key = row.wechatPay?.apiV3Key || '';
  formModel.notifyUrl = row.wechatPay?.notifyUrl || '';
  formModel.baseUrl = row.wechatPay?.baseUrl || 'https://api.mch.weixin.qq.com';
  formModel.privateKey = row.wechatPay?.privateKey || '';
  formModel.platformPublicKey = row.wechatPay?.platformPublicKey || '';
  formModel.callbackSkipVerifyInDev = row.wechatPay?.callbackSkipVerifyInDev === true;
  formModel.mockPlatformPrivateKey = row.wechatPay?.mockPlatformPrivateKey || '';
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
      miniAppId: formModel.miniAppId.trim(),
      name: formModel.name.trim(),
      appSecret: formModel.appSecret.trim(),
      enabled: formModel.enabled,
      isDefault: formModel.isDefault,
      wechatPay: {
        enabled: formModel.paymentEnabled,
        mchId: formModel.mchId.trim(),
        serialNo: formModel.serialNo.trim(),
        apiV3Key: formModel.apiV3Key.trim(),
        notifyUrl: formModel.notifyUrl.trim(),
        baseUrl: formModel.baseUrl.trim(),
        privateKey: formModel.privateKey,
        platformPublicKey: formModel.platformPublicKey,
        callbackSkipVerifyInDev: formModel.callbackSkipVerifyInDev,
        mockPlatformPrivateKey: formModel.mockPlatformPrivateKey,
      },
    };

    if (editingId.value) {
      await updateMiniAppApi(editingId.value, payload);
      message.success('更新成功');
    } else {
      await createMiniAppApi(payload);
      message.success('创建成功');
    }
    modalOpen.value = false;
    gridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: MiniAppItem) {
  if (row.isDefault) {
    message.warning('默认小程序不可删除');
    return;
  }
  Modal.confirm({
    title: `确认删除小程序 ${row.name}？`,
    okType: 'danger',
    onOk: async () => {
      await deleteMiniAppApi(row.id);
      message.success('删除成功');
      gridApi.reload();
    },
  });
}

const [Grid, gridApi] = useVbenVxeGrid<MiniAppItem>({
  formOptions: {
    schema: [],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'miniAppId', minWidth: 180, title: 'MiniApp ID' },
      { field: 'name', minWidth: 180, title: '名称' },
      { field: 'enabled', minWidth: 90, title: '启用', slots: { default: 'enabled' } },
      { field: 'isDefault', minWidth: 90, title: '默认', slots: { default: 'isDefault' } },
      { field: 'wechatPay.enabled', minWidth: 100, title: '支付启用', slots: { default: 'payEnabled' } },
      { field: 'updatedAt', minWidth: 180, formatter: 'formatDateTime', title: '更新时间' },
      { field: 'actions', fixed: 'right', minWidth: 180, title: '操作', slots: { default: 'actions' } },
    ],
    proxyConfig: {
      ajax: {
        query: async () => {
          const list = await listMiniAppsApi();
          return {
            items: list || [],
            total: (list || []).length,
          };
        },
      },
    },
    toolbarConfig: {
      refresh: true,
      search: false,
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
        <Button v-access:code="'admin:super'" type="primary" @click="openCreate">新增小程序</Button>
      </template>

      <template #enabled="{ row }">
        <Switch :checked="row.enabled" disabled />
      </template>

      <template #isDefault="{ row }">
        <Switch :checked="row.isDefault" disabled />
      </template>

      <template #payEnabled="{ row }">
        <Switch :checked="row.wechatPay?.enabled" disabled />
      </template>

      <template #actions="{ row }">
        <Space>
          <Button v-access:code="'admin:super'" size="small" type="link" @click="openEdit(row)">编辑</Button>
          <Button v-access:code="'admin:super'" :disabled="row.isDefault" danger size="small" type="link" @click="handleDelete(row)">删除</Button>
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
      width="860px"
      @cancel="() => (modalOpen = false)"
      @ok="submit"
    >
      <Form ref="formRef" :model="formModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 17 }">
        <Form.Item label="MiniApp ID" name="miniAppId" :rules="[{ required: true, message: '请输入 MiniApp ID' }]">
          <Input v-model:value="formModel.miniAppId" :disabled="Boolean(editingId)" allow-clear />
        </Form.Item>
        <Form.Item label="名称" name="name" :rules="[{ required: true, message: '请输入名称' }]">
          <Input v-model:value="formModel.name" allow-clear />
        </Form.Item>
        <Form.Item label="AppSecret" name="appSecret" :rules="[{ required: true, message: '请输入 AppSecret' }]">
          <Input.Password v-model:value="formModel.appSecret" allow-clear />
        </Form.Item>
        <Form.Item label="启用" name="enabled">
          <Switch v-model:checked="formModel.enabled" />
        </Form.Item>
        <Form.Item label="默认小程序" name="isDefault">
          <Switch v-model:checked="formModel.isDefault" />
        </Form.Item>

        <Form.Item label="开启微信支付" name="paymentEnabled">
          <Switch v-model:checked="formModel.paymentEnabled" />
        </Form.Item>
        <Form.Item label="商户号" name="mchId">
          <Input v-model:value="formModel.mchId" allow-clear />
        </Form.Item>
        <Form.Item label="证书序列号" name="serialNo">
          <Input v-model:value="formModel.serialNo" allow-clear />
        </Form.Item>
        <Form.Item label="APIv3 Key" name="apiV3Key">
          <Input v-model:value="formModel.apiV3Key" allow-clear />
        </Form.Item>
        <Form.Item label="支付回调地址" name="notifyUrl">
          <Input v-model:value="formModel.notifyUrl" allow-clear />
        </Form.Item>
        <Form.Item label="支付网关" name="baseUrl">
          <Input v-model:value="formModel.baseUrl" allow-clear />
        </Form.Item>
        <Form.Item label="商户私钥" name="privateKey">
          <Input.TextArea v-model:value="formModel.privateKey" :auto-size="{ minRows: 3, maxRows: 6 }" />
        </Form.Item>
        <Form.Item label="平台公钥" name="platformPublicKey">
          <Input.TextArea v-model:value="formModel.platformPublicKey" :auto-size="{ minRows: 3, maxRows: 6 }" />
        </Form.Item>
        <Form.Item label="开发跳过验签" name="callbackSkipVerifyInDev">
          <Switch v-model:checked="formModel.callbackSkipVerifyInDev" />
        </Form.Item>
        <Form.Item label="Mock 平台私钥" name="mockPlatformPrivateKey">
          <Input.TextArea v-model:value="formModel.mockPlatformPrivateKey" :auto-size="{ minRows: 2, maxRows: 4 }" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
