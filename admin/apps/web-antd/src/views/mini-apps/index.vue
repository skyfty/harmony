<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import type { MiniAppItem, MiniAppPlatformConfig, MiniPlatformKind } from '#/api';

import { computed, reactive, ref } from 'vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { createMiniAppApi, deleteMiniAppApi, listMiniAppsApi, updateMiniAppApi } from '#/api';

import { Button, Form, Input, message, Modal, Select, Space, Switch, Tabs, Tooltip } from 'ant-design-vue';
import { DeleteOutlined, EditOutlined } from '@ant-design/icons-vue';

type PlatformFormModel = {
  enabled: boolean;
  appId: string;
  appSecret: string;
  loginEnabled: boolean;
  loginScopes: string;
  paymentEnabled: boolean;
  paymentChannel: string;
  mchId: string;
  serialNo: string;
  privateKey: string;
  apiV3Key: string;
  notifyUrl: string;
  refundNotifyUrl: string;
  baseUrl: string;
  platformPublicKey: string;
  callbackSkipVerifyInDev: boolean;
  mockPlatformPrivateKey: string;
  shareEnabled: boolean;
  shareDefaultPath: string;
  shareDefaultTitle: string;
  posterEnabled: boolean;
  qrCodeRuleLink: string;
  privacyEnabled: boolean;
  requireConsentBeforeUse: boolean;
  updateEnabled: boolean;
  updatePromptMode: 'force' | 'none' | 'soft';
  navigateEnabled: boolean;
  landingPage: string;
  phoneEnabled: boolean;
  sceneryEnabled: boolean;
  locationPickerEnabled: boolean;
  albumSaveEnabled: boolean;
  avatarSelectionEnabled: boolean;
  extConfigText: string;
};

type MiniAppFormModel = {
  appKey: string;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  runtimeFeaturesText: string;
  runtimeValuesText: string;
  userServiceAgreementContent: string;
  privacyPolicyContent: string;
  platforms: Record<MiniPlatformKind, PlatformFormModel>;
};

const PLATFORM_OPTIONS: Array<{ key: MiniPlatformKind; label: string }> = [
  { key: 'wechat', label: '微信' },
  { key: 'douyin', label: '抖音' },
  { key: 'xiaohongshu', label: '小红书' },
];

const UPDATE_PROMPT_OPTIONS = [
  { label: '关闭', value: 'none' },
  { label: '软提示', value: 'soft' },
  { label: '强制', value: 'force' },
];

const PLATFORM_HEALTH_LABELS: Record<string, string> = {
  configured: '已配置',
  disabled: '已禁用',
  incomplete: '配置不完整',
};

function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function safeJsonParse(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function parseFeatureFlags(value: string): Record<string, boolean> {
  const parsed = safeJsonParse(value);
  return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, Boolean(item)]));
}

function parseRuntimeValues(value: string): Record<string, boolean | null | number | string> {
  return safeJsonParse(value) as Record<string, boolean | null | number | string>;
}

function createDefaultPlatformForm(): PlatformFormModel {
  return {
    enabled: false,
    appId: '',
    appSecret: '',
    loginEnabled: true,
    loginScopes: '',
    paymentEnabled: false,
    paymentChannel: 'wechat',
    mchId: '',
    serialNo: '',
    privateKey: '',
    apiV3Key: '',
    notifyUrl: '',
    refundNotifyUrl: '',
    baseUrl: 'https://api.mch.weixin.qq.com',
    platformPublicKey: '',
    callbackSkipVerifyInDev: false,
    mockPlatformPrivateKey: '',
    shareEnabled: true,
    shareDefaultPath: '',
    shareDefaultTitle: '',
    posterEnabled: false,
    qrCodeRuleLink: '',
    privacyEnabled: true,
    requireConsentBeforeUse: true,
    updateEnabled: true,
    updatePromptMode: 'soft',
    navigateEnabled: true,
    landingPage: '',
    phoneEnabled: true,
    sceneryEnabled: false,
    locationPickerEnabled: true,
    albumSaveEnabled: true,
    avatarSelectionEnabled: true,
    extConfigText: '{}',
  };
}

function createDefaultFormModel(): MiniAppFormModel {
  return {
    appKey: '',
    name: '',
    enabled: true,
    isDefault: false,
    runtimeFeaturesText: '{}',
    runtimeValuesText: '{}',
    userServiceAgreementContent: '',
    privacyPolicyContent: '',
    platforms: {
      wechat: createDefaultPlatformForm(),
      douyin: createDefaultPlatformForm(),
      xiaohongshu: createDefaultPlatformForm(),
    },
  };
}

function applyPlatformConfig(target: PlatformFormModel, source?: MiniAppPlatformConfig) {
  target.enabled = source?.enabled === true;
  target.appId = source?.appId ?? '';
  target.appSecret = source?.appSecret ?? '';
  target.loginEnabled = source?.loginConfig?.enabled !== false;
  target.loginScopes = (source?.loginConfig?.scopes ?? []).join('\n');
  target.paymentEnabled = source?.paymentConfig?.enabled === true;
  target.paymentChannel = source?.paymentConfig?.channel ?? 'wechat';
  target.mchId = source?.paymentConfig?.mchId ?? '';
  target.serialNo = source?.paymentConfig?.serialNo ?? '';
  target.privateKey = source?.paymentConfig?.privateKey ?? '';
  target.apiV3Key = source?.paymentConfig?.apiV3Key ?? '';
  target.notifyUrl = source?.paymentConfig?.notifyUrl ?? '';
  target.refundNotifyUrl = source?.paymentConfig?.refundNotifyUrl ?? '';
  target.baseUrl = source?.paymentConfig?.baseUrl ?? 'https://api.mch.weixin.qq.com';
  target.platformPublicKey = source?.paymentConfig?.platformPublicKey ?? '';
  target.callbackSkipVerifyInDev = source?.paymentConfig?.callbackSkipVerifyInDev === true;
  target.mockPlatformPrivateKey = source?.paymentConfig?.mockPlatformPrivateKey ?? '';
  target.shareEnabled = source?.shareConfig?.enabled !== false;
  target.shareDefaultPath = source?.shareConfig?.defaultPath ?? '';
  target.shareDefaultTitle = source?.shareConfig?.defaultTitle ?? '';
  target.posterEnabled = source?.shareConfig?.posterEnabled === true;
  target.qrCodeRuleLink = source?.shareConfig?.qrCodeRuleLink ?? '';
  target.privacyEnabled = source?.privacyConfig?.enabled !== false;
  target.requireConsentBeforeUse = source?.privacyConfig?.requireConsentBeforeUse !== false;
  target.updateEnabled = source?.updateConfig?.enabled !== false;
  target.updatePromptMode = source?.updateConfig?.promptMode ?? 'soft';
  target.navigateEnabled = source?.navigateConfig?.enabled !== false;
  target.landingPage = source?.navigateConfig?.landingPage ?? '';
  const capabilities = source?.extConfig?.capabilities as Record<string, unknown> | undefined;
  target.phoneEnabled = typeof capabilities?.phone === 'boolean' ? capabilities.phone : source?.loginConfig?.enabled !== false;
  target.sceneryEnabled = typeof capabilities?.scenery === 'boolean' ? capabilities.scenery : source?.platform === 'wechat';
  target.locationPickerEnabled = typeof capabilities?.locationPicker === 'boolean' ? capabilities.locationPicker : true;
  target.albumSaveEnabled = typeof capabilities?.albumSave === 'boolean' ? capabilities.albumSave : true;
  target.avatarSelectionEnabled = typeof capabilities?.avatarSelection === 'boolean' ? capabilities.avatarSelection : true;
  target.extConfigText = safeJsonStringify(source?.extConfig ?? {});
}

function buildPlatformPayload(platform: PlatformFormModel): Partial<MiniAppPlatformConfig> {
  const extConfig = safeJsonParse(platform.extConfigText);
  const existingCapabilities = extConfig.capabilities && typeof extConfig.capabilities === 'object'
    ? extConfig.capabilities as Record<string, unknown>
    : {};
  extConfig.capabilities = {
    ...existingCapabilities,
    phone: platform.phoneEnabled,
    scenery: platform.sceneryEnabled,
    locationPicker: platform.locationPickerEnabled,
    albumSave: platform.albumSaveEnabled,
    avatarSelection: platform.avatarSelectionEnabled,
  };
  return {
    enabled: platform.enabled,
    appId: platform.appId.trim(),
    appSecret: platform.appSecret,
    loginConfig: {
      enabled: platform.loginEnabled,
      scopes: platform.loginScopes.split('\n').map((item) => item.trim()).filter(Boolean),
    },
    paymentConfig: {
      enabled: platform.paymentEnabled,
      channel: platform.paymentChannel.trim() || 'wechat',
      mchId: platform.mchId.trim(),
      serialNo: platform.serialNo.trim(),
      privateKey: platform.privateKey,
      apiV3Key: platform.apiV3Key.trim(),
      notifyUrl: platform.notifyUrl.trim(),
      refundNotifyUrl: platform.refundNotifyUrl.trim(),
      baseUrl: platform.baseUrl.trim(),
      platformPublicKey: platform.platformPublicKey,
      callbackSkipVerifyInDev: platform.callbackSkipVerifyInDev,
      mockPlatformPrivateKey: platform.mockPlatformPrivateKey,
    },
    shareConfig: {
      enabled: platform.shareEnabled,
      defaultPath: platform.shareDefaultPath.trim(),
      defaultTitle: platform.shareDefaultTitle.trim(),
      posterEnabled: platform.posterEnabled,
      qrCodeRuleLink: platform.qrCodeRuleLink.trim(),
    },
    privacyConfig: {
      enabled: platform.privacyEnabled,
      requireConsentBeforeUse: platform.requireConsentBeforeUse,
    },
    updateConfig: {
      enabled: platform.updateEnabled,
      promptMode: platform.updatePromptMode,
    },
    navigateConfig: {
      enabled: platform.navigateEnabled,
      landingPage: platform.landingPage.trim(),
    },
    extConfig,
  };
}

function renderPlatformSummary(row: MiniAppItem) {
  return row.configuredPlatforms.length ? row.configuredPlatforms.join('、') : '未配置';
}

function renderPlatformHealth(row: MiniAppItem) {
  return PLATFORM_OPTIONS.map(({ key, label }) => {
    const status = row.platformHealth?.[key] ?? 'disabled';
    return `${label}:${PLATFORM_HEALTH_LABELS[status] ?? status}`;
  }).join(' ｜ ');
}

function toRow(slotProps: { row: MiniAppItem }): MiniAppItem {
  return slotProps.row;
}

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<null | string>(null);
const formRef = ref<FormInstance>();
const activeTab = ref<'app-basics' | 'runtime' | 'policy' | MiniPlatformKind>('app-basics');
const formModel = reactive(createDefaultFormModel());
const modalTitle = computed(() => (editingId.value ? '编辑小程序应用' : '新增小程序应用'));

function resetForm() {
  Object.assign(formModel, createDefaultFormModel());
  activeTab.value = 'app-basics';
}

function openCreate() {
  editingId.value = null;
  resetForm();
  modalOpen.value = true;
}

function openEdit(row: MiniAppItem) {
  editingId.value = row.id;
  resetForm();
  formModel.appKey = row.appKey;
  formModel.name = row.name;
  formModel.enabled = row.enabled;
  formModel.isDefault = row.isDefault;
  formModel.runtimeFeaturesText = safeJsonStringify(row.runtimeConfig.features);
  formModel.runtimeValuesText = safeJsonStringify(row.runtimeConfig.values);
  formModel.userServiceAgreementContent = row.userServiceAgreement.content;
  formModel.privacyPolicyContent = row.privacyPolicy.content;

  PLATFORM_OPTIONS.forEach(({ key }) => {
    applyPlatformConfig(formModel.platforms[key], row.platformConfigs.find((item) => item.platform === key));
  });

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
      appKey: formModel.appKey.trim(),
      name: formModel.name.trim(),
      enabled: formModel.enabled,
      isDefault: formModel.isDefault,
      runtimeConfig: {
        features: parseFeatureFlags(formModel.runtimeFeaturesText),
        values: parseRuntimeValues(formModel.runtimeValuesText),
      },
      userServiceAgreement: {
        title: '用户服务协议',
        content: formModel.userServiceAgreementContent.trim(),
      },
      privacyPolicy: {
        title: '隐私政策',
        content: formModel.privacyPolicyContent.trim(),
      },
      platformConfigs: {
        wechat: buildPlatformPayload(formModel.platforms.wechat),
        douyin: buildPlatformPayload(formModel.platforms.douyin),
        xiaohongshu: buildPlatformPayload(formModel.platforms.xiaohongshu),
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
    message.warning('默认应用不可删除');
    return;
  }

  Modal.confirm({
    title: `确认删除应用 ${row.name}？`,
    okType: 'danger',
    onOk: async () => {
      await deleteMiniAppApi(row.id);
      message.success('删除成功');
      await gridApi.query();
    },
  });
}

const [Grid, gridApi] = useVbenVxeGrid<MiniAppItem>({
  formOptions: { schema: [] },
  gridOptions: {
    border: true,
    columns: [
      { field: 'appKey', minWidth: 180, title: '应用 Key' },
      { field: 'name', minWidth: 180, title: '应用名称' },
      {
        field: 'configuredPlatforms',
        minWidth: 180,
        title: '已配置平台',
        formatter: ({ row }: { row: MiniAppItem }) => renderPlatformSummary(row),
      },
      {
        field: 'platformHealth',
        minWidth: 260,
        title: '平台状态',
        formatter: ({ row }: { row: MiniAppItem }) => renderPlatformHealth(row),
      },
      { field: 'enabled', minWidth: 90, title: '启用', slots: { default: 'enabled' } },
      { field: 'isDefault', minWidth: 90, title: '默认', slots: { default: 'isDefault' } },
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
  <div class="mini-app-page">
    <div class="page-header">
      <div>
        <div class="page-title">小程序应用</div>
      </div>
      <Button v-access:code="'admin:super'" type="primary" @click="openCreate">新增应用</Button>
    </div>

    <Grid>
      <template #toolbar-actions>
        <Button v-access:code="'admin:super'" type="primary" @click="openCreate">新增应用</Button>
      </template>

      <template #enabled="slotProps">
        <Switch :checked="toRow(slotProps).enabled" disabled />
      </template>

      <template #isDefault="slotProps">
        <Switch :checked="toRow(slotProps).isDefault" disabled />
      </template>

      <template #actions="slotProps">
        <Space>
          <Tooltip title="编辑">
            <Button v-access:code="'admin:super'" size="small" type="text" @click="openEdit(toRow(slotProps))">
              <EditOutlined />
            </Button>
          </Tooltip>
          <Tooltip title="删除">
            <Button
              v-access:code="'admin:super'"
              :disabled="toRow(slotProps).isDefault"
              danger
              size="small"
              type="text"
              @click="handleDelete(toRow(slotProps))"
            >
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
      width="1120px"
      @cancel="() => (modalOpen = false)"
      @ok="submit"
    >

      <Tabs v-model:activeKey="activeTab" class="mini-app-tabs">
        <Tabs.TabPane key="app-basics" tab="应用基础信息">
          <Form ref="formRef" :model="formModel" :label-col="{ span: 5 }" :wrapper-col="{ span: 18 }">
            <div class="tab-panel">
              <Form.Item label="应用 Key" name="appKey" :rules="[{ required: true, message: '请输入应用 Key' }]">
                <Input v-model:value="formModel.appKey" :disabled="Boolean(editingId)" allow-clear />
              </Form.Item>
              <Form.Item label="应用名称" name="name" :rules="[{ required: true, message: '请输入应用名称' }]">
                <Input v-model:value="formModel.name" allow-clear />
              </Form.Item>
              <Form.Item label="启用" name="enabled">
                <Switch v-model:checked="formModel.enabled" />
              </Form.Item>
              <Form.Item label="默认应用" name="isDefault">
                <Switch v-model:checked="formModel.isDefault" />
              </Form.Item>
            </div>
          </Form>
        </Tabs.TabPane>

        <Tabs.TabPane key="runtime" tab="运行配置">
          <Form :model="formModel" :label-col="{ span: 5 }" :wrapper-col="{ span: 18 }">
            <div class="tab-panel">
              <Form.Item label="运行特性 JSON" name="runtimeFeaturesText">
                <Input.TextArea v-model:value="formModel.runtimeFeaturesText" :auto-size="{ minRows: 8, maxRows: 14 }" />
              </Form.Item>
              <Form.Item label="运行参数 JSON" name="runtimeValuesText">
                <Input.TextArea v-model:value="formModel.runtimeValuesText" :auto-size="{ minRows: 8, maxRows: 14 }" />
              </Form.Item>
            </div>
          </Form>
        </Tabs.TabPane>

        <Tabs.TabPane key="policy" tab="协议内容">
          <Form :model="formModel" :label-col="{ span: 5 }" :wrapper-col="{ span: 18 }">
            <div class="tab-panel">
              <Form.Item label="用户服务协议" name="userServiceAgreementContent">
                <Input.TextArea v-model:value="formModel.userServiceAgreementContent" :auto-size="{ minRows: 10, maxRows: 14 }" />
              </Form.Item>
              <Form.Item label="隐私政策" name="privacyPolicyContent">
                <Input.TextArea v-model:value="formModel.privacyPolicyContent" :auto-size="{ minRows: 10, maxRows: 14 }" />
              </Form.Item>
            </div>
          </Form>
        </Tabs.TabPane>

        <Tabs.TabPane v-for="platform in PLATFORM_OPTIONS" :key="platform.key" :tab="platform.label">
          <div class="platform-pane">
            <Form :model="formModel.platforms[platform.key]" :label-col="{ span: 5 }" :wrapper-col="{ span: 18 }">
              <Form.Item label="平台启用">
                <Switch v-model:checked="formModel.platforms[platform.key].enabled" />
              </Form.Item>
              <Form.Item label="应用 ID">
                <Input v-model:value="formModel.platforms[platform.key].appId" allow-clear />
              </Form.Item>
              <Form.Item label="应用密钥">
                <Input.Password v-model:value="formModel.platforms[platform.key].appSecret" allow-clear />
              </Form.Item>
              <Form.Item label="登录启用">
                <Switch v-model:checked="formModel.platforms[platform.key].loginEnabled" />
              </Form.Item>
              <Form.Item label="登录 Scope">
                <Input.TextArea
                  v-model:value="formModel.platforms[platform.key].loginScopes"
                  :auto-size="{ minRows: 2, maxRows: 4 }"
                  placeholder="每行一个 scope"
                />
              </Form.Item>
              <Form.Item label="支付启用">
                <Switch v-model:checked="formModel.platforms[platform.key].paymentEnabled" />
              </Form.Item>
              <Form.Item label="支付渠道">
                <Input v-model:value="formModel.platforms[platform.key].paymentChannel" allow-clear />
              </Form.Item>
              <Form.Item label="商户号">
                <Input v-model:value="formModel.platforms[platform.key].mchId" allow-clear />
              </Form.Item>
              <Form.Item label="证书序列号">
                <Input v-model:value="formModel.platforms[platform.key].serialNo" allow-clear />
              </Form.Item>
              <Form.Item label="支付私钥">
                <Input.TextArea v-model:value="formModel.platforms[platform.key].privateKey" :auto-size="{ minRows: 3, maxRows: 6 }" />
              </Form.Item>
              <Form.Item label="API V3 密钥">
                <Input v-model:value="formModel.platforms[platform.key].apiV3Key" allow-clear />
              </Form.Item>
              <Form.Item label="支付回调">
                <Input v-model:value="formModel.platforms[platform.key].notifyUrl" allow-clear />
              </Form.Item>
              <Form.Item label="退款回调">
                <Input v-model:value="formModel.platforms[platform.key].refundNotifyUrl" allow-clear />
              </Form.Item>
              <Form.Item label="支付网关">
                <Input v-model:value="formModel.platforms[platform.key].baseUrl" allow-clear />
              </Form.Item>
              <Form.Item label="平台公钥">
                <Input.TextArea v-model:value="formModel.platforms[platform.key].platformPublicKey" :auto-size="{ minRows: 3, maxRows: 6 }" />
              </Form.Item>
              <Form.Item label="开发环境跳过验签">
                <Switch v-model:checked="formModel.platforms[platform.key].callbackSkipVerifyInDev" />
              </Form.Item>
              <Form.Item label="Mock 平台私钥">
                <Input.TextArea
                  v-model:value="formModel.platforms[platform.key].mockPlatformPrivateKey"
                  :auto-size="{ minRows: 2, maxRows: 4 }"
                />
              </Form.Item>
              <Form.Item label="分享启用">
                <Switch v-model:checked="formModel.platforms[platform.key].shareEnabled" />
              </Form.Item>
              <Form.Item label="默认分享路径">
                <Input v-model:value="formModel.platforms[platform.key].shareDefaultPath" allow-clear />
              </Form.Item>
              <Form.Item label="默认分享标题">
                <Input v-model:value="formModel.platforms[platform.key].shareDefaultTitle" allow-clear />
              </Form.Item>
              <Form.Item label="海报启用">
                <Switch v-model:checked="formModel.platforms[platform.key].posterEnabled" />
              </Form.Item>
              <Form.Item label="二维码规则链接">
                <Input v-model:value="formModel.platforms[platform.key].qrCodeRuleLink" allow-clear />
              </Form.Item>
              <Form.Item label="隐私启用">
                <Switch v-model:checked="formModel.platforms[platform.key].privacyEnabled" />
              </Form.Item>
              <Form.Item label="使用前同意">
                <Switch v-model:checked="formModel.platforms[platform.key].requireConsentBeforeUse" />
              </Form.Item>
              <Form.Item label="更新启用">
                <Switch v-model:checked="formModel.platforms[platform.key].updateEnabled" />
              </Form.Item>
              <Form.Item label="更新提示模式">
                <Select v-model:value="formModel.platforms[platform.key].updatePromptMode" :options="UPDATE_PROMPT_OPTIONS" />
              </Form.Item>
              <Form.Item label="导航启用">
                <Switch v-model:checked="formModel.platforms[platform.key].navigateEnabled" />
              </Form.Item>
              <Form.Item label="落地页">
                <Input v-model:value="formModel.platforms[platform.key].landingPage" allow-clear />
              </Form.Item>
              <Form.Item label="手机号授权">
                <Switch v-model:checked="formModel.platforms[platform.key].phoneEnabled" />
              </Form.Item>
              <Form.Item label="3D 景区">
                <Switch v-model:checked="formModel.platforms[platform.key].sceneryEnabled" />
              </Form.Item>
              <Form.Item label="地图选点">
                <Switch v-model:checked="formModel.platforms[platform.key].locationPickerEnabled" />
              </Form.Item>
              <Form.Item label="保存到相册">
                <Switch v-model:checked="formModel.platforms[platform.key].albumSaveEnabled" />
              </Form.Item>
              <Form.Item label="头像选择">
                <Switch v-model:checked="formModel.platforms[platform.key].avatarSelectionEnabled" />
              </Form.Item>
              <Form.Item label="扩展配置 JSON">
                <Input.TextArea v-model:value="formModel.platforms[platform.key].extConfigText" :auto-size="{ minRows: 4, maxRows: 8 }" />
              </Form.Item>
            </Form>
          </div>
        </Tabs.TabPane>
      </Tabs>
    </Modal>
  </div>
</template>

<style scoped>
.mini-app-page {
  padding: 20px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  color: #1f2937;
}

.page-subtitle {
  margin-top: 4px;
  color: #6b7280;
}

.modal-tip {
  margin-bottom: 16px;
  padding: 12px 14px;
  border-radius: 10px;
  background: #f8fafc;
  color: #475569;
}

.mini-app-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 16px;
}

.mini-app-tabs :deep(.ant-tabs-nav-list) {
  flex-wrap: nowrap;
}

.mini-app-tabs :deep(.ant-tabs-tab) {
  white-space: nowrap;
}

.tab-panel {
  padding-top: 4px;
}

.platform-pane {
  max-height: 58vh;
  overflow: auto;
  padding-right: 12px;
}

.platform-hint {
  margin-bottom: 12px;
  color: #6b7280;
}
</style>
