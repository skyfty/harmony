import { useAccessStore } from '@vben/stores';

import { requestClient } from '#/api/request';

interface ServerSessionUserRole {
  code: string;
}

interface ServerSessionUser {
  avatarUrl?: string;
  displayName?: string;
  id: string;
  roles: ServerSessionUserRole[];
  username: string;
}

interface ServerProfileResult {
  permissions: string[];
  token?: string;
  user: ServerSessionUser;
}

export namespace AuthApi {
  /** 登录接口参数 */
  export interface LoginParams {
    password?: string;
    username?: string;
  }

  /** 登录接口返回值 */
  export interface LoginResult {
    accessToken: string;
  }

  export type RefreshTokenResult = string;
}

async function getServerProfile(token?: string) {
  const accessStore = useAccessStore();
  const accessToken = token || accessStore.accessToken || undefined;
  const response = await requestClient.get<ServerProfileResult>(
    '/auth/profile',
    {
      headers: accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : undefined,
    },
  );
  return response;
}

/**
 * 登录
 */
export async function loginApi(data: AuthApi.LoginParams) {
  const response = await requestClient.post<ServerProfileResult>(
    '/auth/login',
    data,
  );
  console.log('Login API Response:', response); // 调试输出登录接口响应
  return {
    accessToken: response.token || '',
  } satisfies AuthApi.LoginResult;
}

/**
 * 刷新accessToken
 */
export async function refreshTokenApi() {
  return requestClient.post<AuthApi.RefreshTokenResult>(
    '/auth/refresh',
    undefined,
    {
      withCredentials: true,
    },
  );
}

/**
 * 退出登录
 */
export async function logoutApi(token?: string | null) {
  return requestClient.post(
    '/auth/logout',
    undefined,
    token
      ? {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      : undefined,
  );
}

/**
 * 获取用户权限码
 */
export async function getAccessCodesApi() {
  const profile = await getServerProfile();
  return profile.permissions || [];
}
