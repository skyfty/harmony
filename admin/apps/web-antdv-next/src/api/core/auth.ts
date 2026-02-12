import { baseRequestClient, requestClient } from '#/api/request';

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

/**
 * 登录
 */
export async function loginApi(data: AuthApi.LoginParams) {
  const response = await requestClient.post<{
    permissions: string[];
    token: string;
    user: Record<string, unknown>;
  }>('/auth/login', data);
  return {
    accessToken: response.token,
  };
}

/**
 * 刷新accessToken
 */
export async function refreshTokenApi() {
  return {
    data: '',
    status: 200,
  } satisfies AuthApi.RefreshTokenResult;
}

/**
 * 退出登录
 */
export async function logoutApi() {
  return baseRequestClient.post('/auth/logout', {}, {
    withCredentials: true,
  });
}

/**
 * 获取用户权限码
 */
export async function getAccessCodesApi() {
  const response = await requestClient.get<{
    permissions: string[];
    user: Record<string, unknown>;
  }>('/auth/profile');
  return response.permissions ?? [];
}
