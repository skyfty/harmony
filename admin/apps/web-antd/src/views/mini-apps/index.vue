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
import { Tooltip } from 'ant-design-vue';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons-vue';

interface MiniAppFormModel {
  miniAppId: string;
  name: string;
  appSecret: string;
  enabled: boolean;
  isDefault: boolean;
  userServiceAgreementContent: string;
  privacyPolicyContent: string;
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

const DEFAULT_USER_SERVICE_AGREEMENT = [
  '欢迎使用本小程序。为保障你的合法权益，请在使用前仔细阅读并理解本协议全部内容。',
  '',
  '1. 服务内容',
  '本小程序向你提供景区浏览、订单管理、手机号绑定、反馈提交、收藏与互动等功能，具体功能可能会随版本更新而调整。',
  '',
  '2. 账号与使用',
  '你可以通过微信授权或账号密码方式使用本服务。你应保证提交信息真实、准确、完整，并妥善保管登录凭证。',
  '',
  '3. 个人信息处理',
  '为实现登录、资料展示、手机号绑定、订单处理、客服与风控等必要功能，我们可能处理你的微信昵称、头像、手机号、订单信息及操作记录。',
  '',
  '4. 用户责任',
  '你应合法合规使用本服务，不得利用本小程序从事违法违规、侵害他人权益或破坏系统安全的行为。',
  '',
  '5. 协议变更',
  '我们可能根据法律法规、业务调整或平台要求更新本协议。更新后将通过页面提示或重新授权方式告知你。',
  '',
  '6. 联系与反馈',
  '如你对本协议有疑问，可通过小程序内反馈入口或平台公布的联系方式与我们取得联系。',
].join('\n');

const DEFAULT_PRIVACY_POLICY = [
  '本隐私政策说明我们如何收集、使用、存储和保护你的个人信息。请在使用本小程序前仔细阅读。',
  '',
  '1. 我们收集的信息',
  '我们可能收集你主动提供的信息，例如昵称、头像、手机号、反馈内容、订单信息、收货地址等。',
  '为完成登录和微信能力调用，我们可能获取微信授权标识、手机号验证码结果等信息。',
  '你使用服务过程中产生的信息，例如浏览记录、订单记录、反馈记录、操作日志等，也可能被记录。',
  '',
  '2. 信息使用目的',
  '我们收集上述信息的目的包括账号登录与识别、资料展示、手机号绑定、订单履约、客服沟通、服务安全、异常排查以及法律法规要求的合规管理。',
  '',
  '3. 信息使用方式',
  '我们仅在实现对应功能所必要的范围内使用你的个人信息，不会超出合理关联目的进行处理。对于敏感信息，我们会在获得授权后再处理。',
  '',
  '4. 信息共享与公开',
  '除法律法规要求、实现服务所必需或获得你明确同意外，我们不会向无关第三方共享你的个人信息。涉及微信支付、手机号能力等场景时，仅会在完成对应业务所需的最小范围内使用相关信息。',
  '',
  '5. 信息存储与保护',
  '我们会采取合理的安全措施保护你的信息，并仅在达成处理目的所需的期限内保存。达到保存期限后，我们将按照法律法规要求处理。',
  '',
  '6. 你的权利',
  '你可以依法查询、更正、删除相关个人信息，或撤回此前授予的授权。撤回后可能导致部分功能无法继续使用。',
  '',
  '7. 联系我们',
  '如你对本隐私政策有任何疑问或投诉建议，可通过小程序内反馈入口联系我们。',
].join('\n');

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
  userServiceAgreementContent: DEFAULT_USER_SERVICE_AGREEMENT,
  privacyPolicyContent: DEFAULT_PRIVACY_POLICY,
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
  formModel.userServiceAgreementContent = DEFAULT_USER_SERVICE_AGREEMENT;
  formModel.privacyPolicyContent = DEFAULT_PRIVACY_POLICY;
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
  formModel.userServiceAgreementContent = row.userServiceAgreement?.content || DEFAULT_USER_SERVICE_AGREEMENT;
  formModel.privacyPolicyContent = row.privacyPolicy?.content || DEFAULT_PRIVACY_POLICY;
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
      userServiceAgreement: {
        title: '用户服务协议',
        content: formModel.userServiceAgreementContent.trim(),
      },
      privacyPolicy: {
        title: '隐私政策',
        content: formModel.privacyPolicyContent.trim(),
      },
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
          <Tooltip title="编辑">
            <Button v-access:code="'admin:super'" size="small" type="text" @click="openEdit(row)">
              <EditOutlined />
            </Button>
          </Tooltip>
          <Tooltip title="删除">
            <Button v-access:code="'admin:super'" :disabled="row.isDefault" danger size="small" type="text" @click="handleDelete(row)">
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

        <Form.Item label="用户服务协议" name="userServiceAgreementContent" :rules="[{ required: true, message: '请输入用户服务协议内容' }]">
          <Input.TextArea
            v-model:value="formModel.userServiceAgreementContent"
            :auto-size="{ minRows: 8, maxRows: 12 }"
            placeholder="请输入用户服务协议正文，建议使用分段文本，空行分隔段落"
          />
        </Form.Item>
        <Form.Item label="隐私政策" name="privacyPolicyContent" :rules="[{ required: true, message: '请输入隐私政策内容' }]">
          <Input.TextArea
            v-model:value="formModel.privacyPolicyContent"
            :auto-size="{ minRows: 10, maxRows: 14 }"
            placeholder="请输入隐私政策正文，建议明确说明收集、使用、存储和共享目的"
          />
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
