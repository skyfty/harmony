import type {
  MiniPlatform,
  MiniPlatformAdapter,
  UnifiedChooseFileOptions,
  UnifiedLoginPayload,
  UnifiedLoginResult,
  UnifiedPhonePayload,
  UnifiedPhoneResult,
  UnifiedSystemInfo,
} from '../../mini-platform-core/src/index';
import { detectMiniPlatform } from '../../mini-platform-core/src/index';

type MiniPlatformRuntimeState = {
  apiBaseUrl?: string;
  runtimeConfig?: {
    publicRuntimeConfig?: {
      payment?: {
        enabled?: boolean;
        provider?: string;
      };
    };
  };
};

type MiniApiEnvelope<T> = {
  code: number;
  data: T;
  message: string;
};

function isMiniApiEnvelope<T>(value: unknown): value is MiniApiEnvelope<T> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === 'number' && 'data' in candidate && typeof candidate.message === 'string';
}

async function requestMiniApi<T>(path: string, options: {
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
}): Promise<T> {
  const runtime = getRuntimeState();
  const baseUrl = String(runtime.apiBaseUrl ?? '').replace(/\/$/, '');
  const apiBaseUrl = baseUrl.endsWith('/api/mini') ? baseUrl : `${baseUrl}/api/mini`;
  return await new Promise<T>((resolve, reject) => {
    uni.request({
      url: `${apiBaseUrl}${path}`,
      method: options.method ?? 'POST',
      header: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
      data: options.body ?? {},
      success: (response: { statusCode?: number; data?: unknown }) => {
        const statusCode = Number(response.statusCode ?? 0);
        const data = response.data as unknown;
        if (statusCode < 200 || statusCode >= 300) {
          const message = typeof (data as { message?: unknown } | undefined)?.message === 'string'
            ? String((data as { message: string }).message)
            : `HTTP ${statusCode}`;
          reject(new Error(message));
          return;
        }

        if (isMiniApiEnvelope<T>(data)) {
          if (data.code !== 0) {
            reject(new Error(data.message || 'API request failed'));
            return;
          }
          resolve(data.data);
          return;
        }

        resolve(data as T);
      },
      fail: (error: unknown) => reject(error),
    });
  });
}

function getRuntimeState(): MiniPlatformRuntimeState {
  return (globalThis as typeof globalThis & { __miniPlatformRuntime?: MiniPlatformRuntimeState }).__miniPlatformRuntime ?? {};
}

function getToken(): string {
  try {
    return String(uni.getStorageSync('mini-access-token') ?? '');
  } catch {
    return '';
  }
}

async function genericLogin(payload: UnifiedLoginPayload, platform: MiniPlatform): Promise<UnifiedLoginResult> {
  return await requestMiniApi<UnifiedLoginResult>('/auth/login', {
    body: {
      ...payload,
      platform,
    },
    headers: {
      'X-Mini-App-Key': payload.appKey,
      'X-Mini-Platform': platform,
    },
  });
}

async function genericBindPhone(payload: UnifiedPhonePayload, platform: MiniPlatform): Promise<UnifiedPhoneResult> {
  return await requestMiniApi<UnifiedPhoneResult>('/auth/bind-phone', {
    body: {
      ...payload,
      platform,
    },
    headers: {
      Authorization: getToken() ? `Bearer ${getToken()}` : '',
      'X-Mini-App-Key': payload.appKey,
      'X-Mini-Platform': platform,
    },
  });
}

async function getSystemInfo(): Promise<UnifiedSystemInfo> {
  return await new Promise((resolve) => {
    uni.getSystemInfo({
      success: (result: { platform?: string; model?: string; system?: string }) => {
        resolve({
          platform: String(result.platform ?? ''),
          model: String(result.model ?? ''),
          system: String(result.system ?? ''),
        });
      },
      fail: () => resolve({ platform: '' }),
    });
  });
}

function requestPaymentByProvider(provider: string, payload: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const paymentOptions = {
      provider: provider as 'wxpay' | 'alipay' | 'baidu' | 'appleiap',
      ...(payload as Record<string, unknown>),
      success: () => resolve(),
      fail: (error: unknown) => reject(error),
    }
    uni.requestPayment(paymentOptions as never)
  });
}

async function resolvePaymentProvider(platform: MiniPlatform): Promise<string> {
  const configuredProvider = String(getRuntimeState().runtimeConfig?.publicRuntimeConfig?.payment?.provider ?? '').trim();
  if (configuredProvider) {
    return configuredProvider;
  }

  try {
    const providers = await new Promise<string[]>((resolve, reject) => {
      if (typeof uni.getProvider !== 'function') {
        resolve([]);
        return;
      }
      uni.getProvider({
        service: 'payment',
        success: (result: { provider?: string[] }) => resolve(Array.isArray(result.provider) ? result.provider : []),
        fail: (error: unknown) => reject(error),
      });
    });
    const firstProvider = providers.find(Boolean);
    if (firstProvider) {
      return firstProvider;
    }
  } catch {
    // fall through to platform defaults below
  }

  if (platform === 'wechat') {
    return 'wxpay';
  }

  throw new Error(`Payment provider is not available for ${platform}`);
}

function chooseFileByUni(options: UnifiedChooseFileOptions): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    if (typeof uni.chooseFile !== 'function') {
      reject(new Error('chooseFile is not available'));
      return;
    }
    uni.chooseFile({
      count: options.count ?? 1,
      extension: options.extension ?? [],
      success: (result: { tempFiles?: unknown[] | unknown }) => {
        const files = Array.isArray(result.tempFiles) ? result.tempFiles : [result.tempFiles];
        resolve(files.filter(Boolean));
      },
      fail: (error: unknown) => reject(error),
    });
  });
}

function chooseFileByWechat(options: UnifiedChooseFileOptions): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    // #ifdef MP-WEIXIN
    if (typeof wx === 'undefined' || typeof wx.chooseMessageFile !== 'function') {
      reject(new Error('chooseMessageFile is not available'));
      return;
    }
    wx.chooseMessageFile({
      count: options.count ?? 1,
      type: 'file',
      extension: options.extension ?? [],
      success: (result: { tempFiles?: unknown[] | unknown }) => {
        const files = Array.isArray(result.tempFiles) ? result.tempFiles : [result.tempFiles];
        resolve(files.filter(Boolean));
      },
      fail: (error: unknown) => reject(error),
    });
    return;
    // #endif
    reject(new Error('chooseMessageFile is not implemented for current platform'));
  });
}

function readFileAsArrayBufferByFs(fs: {
  readFile(options: {
    filePath: string;
    success: (result: { data: ArrayBuffer | string }) => void;
    fail: (error: unknown) => void;
  }): void;
}, filePath: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    fs.readFile({
      filePath,
      success: (result) => {
        if (result.data instanceof ArrayBuffer) {
          resolve(result.data);
          return;
        }
        reject(new Error('Binary file read returned a string payload'));
      },
      fail: (error) => reject(error),
    });
  });
}

async function readBinaryFile(file: unknown): Promise<ArrayBuffer> {
  const candidate = file as {
    file?: Blob;
    path?: string;
    tempFilePath?: string;
    url?: string;
  };
  const filePath = String(candidate.path ?? candidate.tempFilePath ?? candidate.url ?? '').trim();

  if (typeof uni.getFileSystemManager === 'function' && filePath) {
    try {
      const bytes = await readFileAsArrayBufferByFs(uni.getFileSystemManager() as {
        readFile(options: {
          filePath: string;
          success: (result: { data: ArrayBuffer | string }) => void;
          fail: (error: unknown) => void;
        }): void;
      }, filePath);
      if (typeof bytes.byteLength === 'number') {
        return bytes;
      }
    } catch {
      // fall through
    }
  }

  // #ifdef MP-WEIXIN
  if (typeof wx !== 'undefined' && typeof wx.getFileSystemManager === 'function' && filePath) {
    try {
      const bytes = await readFileAsArrayBufferByFs(wx.getFileSystemManager() as {
        readFile(options: {
          filePath: string;
          success: (result: { data: ArrayBuffer | string }) => void;
          fail: (error: unknown) => void;
        }): void;
      }, filePath);
      if (typeof bytes.byteLength === 'number') {
        return bytes;
      }
    } catch {
      // fall through
    }
  }
  // #endif

  if (candidate.file && typeof candidate.file.arrayBuffer === 'function') {
    return await candidate.file.arrayBuffer();
  }

  if (typeof Blob !== 'undefined' && file instanceof Blob && typeof file.arrayBuffer === 'function') {
    return await file.arrayBuffer();
  }

  if (filePath && (/^blob:/i.test(filePath) || /^data:/i.test(filePath) || /^https?:/i.test(filePath))) {
    const response = await fetch(filePath);
    return await response.arrayBuffer();
  }

  throw new Error('Binary file reading is not supported on the current platform');
}

function installUpdateManagerByUni(): void {
  if (typeof uni.getUpdateManager !== 'function') {
    return;
  }
  try {
    const updateManager = uni.getUpdateManager();
    updateManager.onUpdateReady(() => {
      uni.showModal({
        title: '发现新版本',
        content: '建议更新到最新版本后继续使用。',
        confirmText: '立即重启',
        cancelText: '稍后再说',
        success: (result: { confirm?: boolean }) => {
          if (result.confirm) {
            updateManager.applyUpdate();
          }
        },
      });
    });
  } catch {
    // ignore runtime errors
  }
}

function createAdapter(platform: MiniPlatform, provider: string | null): MiniPlatformAdapter {
  return {
    platform,
    async getLoginCode() {
      return await new Promise<string>((resolve, reject) => {
        uni.login({
          success: (result: { code?: string }) => {
            if (!result.code) {
              reject(new Error('Login code not found'));
              return;
            }
            resolve(result.code);
          },
          fail: (error: unknown) => reject(error),
        });
      });
    },
    async login(payload: UnifiedLoginPayload) {
      return await genericLogin(payload, platform);
    },
    async requestPhoneNumber(payload: UnifiedPhonePayload) {
      return await genericBindPhone(payload, platform);
    },
    async requestPayment(payload: Record<string, unknown>) {
      const resolvedProvider = provider ?? await resolvePaymentProvider(platform);
      await requestPaymentByProvider(resolvedProvider, payload);
    },
    async ensurePrivacyConsent() {
      return true;
    },
    async chooseFile(options: UnifiedChooseFileOptions) {
      try {
        return await chooseFileByUni(options);
      } catch {
        if (platform === 'wechat') {
          return await chooseFileByWechat(options);
        }
        throw new Error(`File selection is not implemented for ${platform}`);
      }
    },
    async readFileAsArrayBuffer(file: unknown) {
      return await readBinaryFile(file);
    },
    registerPrivacyAuthorizationListener(listener) {
      if (platform !== 'wechat') {
        return;
      }
      if (typeof wx !== 'undefined' && typeof wx.onNeedPrivacyAuthorization === 'function') {
        wx.onNeedPrivacyAuthorization(listener as never);
      }
    },
    installUpdateManager() {
      installUpdateManagerByUni();
    },
    async getSystemInfo() {
      return await getSystemInfo();
    },
  };
}

const adapterRegistry: Record<MiniPlatform, MiniPlatformAdapter> = {
  wechat: createAdapter('wechat', 'wxpay'),
  douyin: createAdapter('douyin', null),
  xiaohongshu: createAdapter('xiaohongshu', null),
};

export function resolveMiniPlatformAdapter(platform = detectMiniPlatform()): MiniPlatformAdapter {
  return adapterRegistry[platform];
}
