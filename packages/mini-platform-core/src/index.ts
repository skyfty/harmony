export type MiniPlatform = 'wechat' | 'douyin' | 'xiaohongshu';

export type MiniProfileGender = 'male' | 'female' | 'other';

export type MiniCapability =
  | 'auth'
  | 'payment'
  | 'privacy'
  | 'share'
  | 'update'
  | 'phone'
  | 'scenery'
  | 'locationPicker'
  | 'albumSave'
  | 'avatarSelection';

export type MiniCapabilities = Record<MiniCapability, boolean>;

export interface MiniRuntimeConfig {
  appKey: string;
  appType: 'tour' | 'viewer';
  platform: MiniPlatform;
  capabilities: MiniCapabilities;
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

export interface MiniUserProfile {
  displayName?: string;
  avatarUrl?: string;
  gender?: MiniProfileGender;
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

export type MiniPaymentAction =
  | { kind: 'wechat'; provider: 'wxpay'; params: Record<string, unknown> }
  | { kind: 'douyin-guarantee'; orderInfo: { order_id: string; order_token: string }; service: 5 }
  | { kind: 'xiaohongshu-order'; orderInfo: Record<string, unknown> };

export interface UnifiedPhonePayload {
  code: string;
  appKey: string;
  encryptedData?: string;
  iv?: string;
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
  requestUserProfile?(): Promise<MiniUserProfile | null>;
  requestPhoneNumber?(payload: UnifiedPhonePayload): Promise<UnifiedPhoneResult>;
  requestPayment(payload: MiniPaymentAction | Record<string, unknown>): Promise<void>;
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
