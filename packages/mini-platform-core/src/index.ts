export type MiniPlatform = 'wechat' | 'douyin' | 'xiaohongshu';

export interface MiniRuntimeConfig {
  appKey: string;
  appType: 'tour' | 'viewer';
  platform: MiniPlatform;
  capabilities: {
    auth: boolean;
    payment: boolean;
    privacy: boolean;
    share: boolean;
    update: boolean;
    phone: boolean;
  };
  publicRuntimeConfig: {
    branding: {
      appName: string;
      logoUrl: string;
      themeColor: string;
    };
    base: {
      appId: string;
      landingPage: string;
    };
    payment: {
      enabled: boolean;
      provider: string;
    };
    features: Record<string, boolean>;
    values: Record<string, boolean | null | number | string>;
    share: {
      defaultPath: string;
      defaultTitle: string;
      posterEnabled: boolean;
      qrCodeRuleLink: string;
    };
    privacy: {
      requireConsentBeforeUse: boolean;
    };
    update: {
      promptMode: 'none' | 'soft' | 'force';
    };
    extConfig: Record<string, unknown>;
  };
}

export interface UnifiedLoginPayload {
  code: string;
  appKey: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface UnifiedLoginResult {
  token?: string;
  appKey?: string;
  platform: MiniPlatform;
  user?: Record<string, unknown>;
  shouldPromptProfileCompletion?: boolean;
}

export interface UnifiedPaymentPayload {
  appKey: string;
  orderNumber: string;
  description: string;
  amount: number;
  attach?: string;
}

export interface UnifiedPhonePayload {
  code: string;
  appKey: string;
}

export interface UnifiedPhoneResult {
  token?: string;
  user?: Record<string, unknown>;
}

export interface UnifiedSystemInfo {
  platform: string;
  model?: string;
  system?: string;
}

export interface UnifiedChooseFileOptions {
  count?: number;
  extension?: string[];
}

export interface MiniPlatformAdapter {
  platform: MiniPlatform;
  getLoginCode(): Promise<string>;
  login(payload: UnifiedLoginPayload): Promise<UnifiedLoginResult>;
  requestPhoneNumber?(payload: UnifiedPhonePayload): Promise<UnifiedPhoneResult>;
  requestPayment(payload: Record<string, unknown>): Promise<void>;
  ensurePrivacyConsent(): Promise<boolean>;
  chooseFile?(options: UnifiedChooseFileOptions): Promise<unknown[]>;
  readFileAsArrayBuffer?(file: unknown): Promise<ArrayBuffer>;
  registerPrivacyAuthorizationListener?(listener: (resolve: (granted?: boolean) => void) => void): void;
  installShareHooks?(app: unknown): void;
  installUpdateManager?(): void;
  getSystemInfo(): Promise<UnifiedSystemInfo>;
}

export function detectMiniPlatform(): MiniPlatform {
  // #ifdef MP-WEIXIN
  return 'wechat';
  // #endif
  // #ifdef MP-TOUTIAO
  return 'douyin';
  // #endif
  // #ifdef MP-XHS
  return 'xiaohongshu';
  // #endif
  return 'wechat';
}
