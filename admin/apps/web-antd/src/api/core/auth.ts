import { useAccessStore } from '@vben/stores';

import { baseRequestClient } from '#/api/request';

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

  export interface RefreshTokenResult {
    data: string;
    status: number;
  }
}

async function getServerProfile(token?: string) {
  const accessStore = useAccessStore();
  const accessToken = token || accessStore.accessToken || undefined;
  const response = await baseRequestClient.get<ServerProfileResult>(
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
  const response = await baseRequestClient.post<ServerProfileResult>(
    '/auth/login',
    data,
  );
  return {
    accessToken: response.token || '',
  } satisfies AuthApi.LoginResult;
}

/**
 * 刷新accessToken
 */
export async function refreshTokenApi() {
  return baseRequestClient.post<AuthApi.RefreshTokenResult>(
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
  return baseRequestClient.post(
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
