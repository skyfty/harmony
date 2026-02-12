import type { UserInfo } from '@vben/types';

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
  user: ServerSessionUser;
}

/**
 * 获取用户信息
 */
export async function getUserInfoApi() {
  const accessStore = useAccessStore();
  const response = await requestClient.get<ServerProfileResult>(
    '/auth/profile',
    {
      headers: accessStore.accessToken
        ? {
            Authorization: `Bearer ${accessStore.accessToken}`,
          }
        : undefined,
    },
  );
  const { user } = response;
  return {
    avatar: user.avatarUrl || '',
    desc: '',
    homePath: '',
    realName: user.displayName || user.username,
    roles: (user.roles || []).map((role: ServerSessionUserRole) => role.code),
    token: accessStore.accessToken || '',
    userId: user.id,
    username: user.username,
  } satisfies UserInfo;
}
