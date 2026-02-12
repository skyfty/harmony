import type { UserInfo } from '@vben/types';

import { requestClient } from '#/api/request';

/**
 * 获取用户信息
 */
export async function getUserInfoApi() {
  const response = await requestClient.get<{
    permissions: string[];
    user: {
      avatarUrl?: string;
      displayName?: string;
      id: string;
      roles?: Array<{ code: string; name: string }>;
      username: string;
    };
  }>('/auth/profile');
  const user = response.user;
  return {
    avatar: user.avatarUrl ?? '',
    desc: '',
    homePath: '/dashboard/analytics',
    realName: user.displayName || user.username,
    roles: (user.roles ?? []).map((item) => item.code),
    userId: user.id,
    username: user.username,
  } as UserInfo;
}
