import { requestClient } from '#/api/request';

export interface MiniAppWechatPayConfig {
  enabled: boolean;
  mchId: string;
  serialNo: string;
  privateKey: string;
  apiV3Key: string;
  notifyUrl: string;
  baseUrl: string;
  platformPublicKey: string;
  callbackSkipVerifyInDev: boolean;
  mockPlatformPrivateKey: string;
}

export interface MiniAppItem {
  id: string;
  miniAppId: string;
  name: string;
  appSecret: string;
  enabled: boolean;
  isDefault: boolean;
  wechatPay: MiniAppWechatPayConfig;
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
  miniAppId: string;
  name: string;
  appSecret: string;
  enabled?: boolean;
  isDefault?: boolean;
  wechatPay?: Partial<MiniAppWechatPayConfig>;
}) {
  return requestClient.post<MiniAppItem>('/admin/mini-apps', payload);
}

export async function updateMiniAppApi(
  id: string,
  payload: {
    name?: string;
    appSecret?: string;
    enabled?: boolean;
    isDefault?: boolean;
    wechatPay?: Partial<MiniAppWechatPayConfig>;
  },
) {
  return requestClient.put<MiniAppItem>(`/admin/mini-apps/${encodeURIComponent(id)}`, payload);
}

export async function deleteMiniAppApi(id: string) {
  return requestClient.delete(`/admin/mini-apps/${encodeURIComponent(id)}`);
}
