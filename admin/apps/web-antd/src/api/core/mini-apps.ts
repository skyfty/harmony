import { requestClient } from '#/api/request';

export type MiniPlatformKind = 'wechat' | 'douyin' | 'xiaohongshu';
export type MiniAppType = 'tour' | 'viewer';

export interface MiniAppPolicyContent {
  title: string;
  content: string;
  fileKey: string;
  fileUrl: string;
  generatedAt: string | null;
  version: number;
}

export interface MiniAppBrandingConfig {
  appName: string;
  logoUrl: string;
  themeColor: string;
}

export interface MiniAppRuntimeConfig {
  features: Record<string, boolean>;
  values: Record<string, boolean | null | number | string>;
}

export interface MiniAppPlatformFeatureConfig {
  enabled: boolean;
  extConfig?: Record<string, unknown>;
}

export interface MiniAppPlatformConfig {
  id: string;
  appKey: string;
  platform: MiniPlatformKind;
  enabled: boolean;
  appId: string;
  appSecret: string;
  loginConfig: MiniAppPlatformFeatureConfig & {
    scopes: string[];
  };
  paymentConfig: MiniAppPlatformFeatureConfig & {
    channel: string;
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
  };
  shareConfig: MiniAppPlatformFeatureConfig & {
    defaultPath: string;
    defaultTitle: string;
    posterEnabled: boolean;
    qrCodeRuleLink: string;
  };
  privacyConfig: MiniAppPlatformFeatureConfig & {
    requireConsentBeforeUse: boolean;
  };
  updateConfig: MiniAppPlatformFeatureConfig & {
    promptMode: 'none' | 'soft' | 'force';
  };
  navigateConfig: MiniAppPlatformFeatureConfig & {
    landingPage: string;
  };
  extConfig: Record<string, unknown>;
}

export interface MiniAppItem {
  id: string;
  appKey: string;
  appType: MiniAppType;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  branding: MiniAppBrandingConfig;
  runtimeConfig: MiniAppRuntimeConfig;
  userServiceAgreement: MiniAppPolicyContent;
  privacyPolicy: MiniAppPolicyContent;
  platformConfigs: MiniAppPlatformConfig[];
  configuredPlatforms: MiniPlatformKind[];
  platformHealth: Partial<Record<MiniPlatformKind, 'configured' | 'disabled' | 'incomplete'>>;
  createdAt: string;
  updatedAt: string;
}

export async function listMiniAppsApi(params?: { enabled?: boolean; keyword?: string }) {
  return requestClient.get<MiniAppItem[]>('/admin/mini-apps', { params });
}

export async function getMiniAppApi(id: string) {
  return requestClient.get<MiniAppItem>(`/admin/mini-apps/${encodeURIComponent(id)}`);
}

export async function createMiniAppApi(payload: {
  appKey: string;
  name: string;
  enabled?: boolean;
  isDefault?: boolean;
  runtimeConfig?: Partial<MiniAppRuntimeConfig>;
  userServiceAgreement?: Partial<MiniAppPolicyContent>;
  privacyPolicy?: Partial<MiniAppPolicyContent>;
  platformConfigs?: Partial<Record<MiniPlatformKind, Partial<MiniAppPlatformConfig>>>;
}) {
  return requestClient.post<MiniAppItem>('/admin/mini-apps', payload);
}

export async function updateMiniAppApi(
  id: string,
  payload: {
    name?: string;
    enabled?: boolean;
    isDefault?: boolean;
    runtimeConfig?: Partial<MiniAppRuntimeConfig>;
    userServiceAgreement?: Partial<MiniAppPolicyContent>;
    privacyPolicy?: Partial<MiniAppPolicyContent>;
    platformConfigs?: Partial<Record<MiniPlatformKind, Partial<MiniAppPlatformConfig>>>;
  },
) {
  return requestClient.put<MiniAppItem>(`/admin/mini-apps/${encodeURIComponent(id)}`, payload);
}

export async function listMiniAppPlatformsApi(id: string) {
  return requestClient.get<MiniAppPlatformConfig[]>(`/admin/mini-apps/${encodeURIComponent(id)}/platforms`);
}

export async function updateMiniAppPlatformApi(id: string, platform: MiniPlatformKind, payload: Partial<MiniAppPlatformConfig>) {
  return requestClient.put<MiniAppPlatformConfig>(`/admin/mini-apps/${encodeURIComponent(id)}/platforms/${platform}`, payload);
}

export async function deleteMiniAppApi(id: string) {
  return requestClient.delete(`/admin/mini-apps/${encodeURIComponent(id)}`);
}
