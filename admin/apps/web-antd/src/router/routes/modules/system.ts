import type { RouteRecordRaw } from 'vue-router';

import { $t } from '#/locales';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'carbon:user-role',
      order: 10,
      title: $t('page.system.title'),
    },
    name: 'System',
    path: '/system',
    children: [
      {
        name: 'SystemUsers',
        path: '/system/users',
        component: () => import('#/views/system/users/index.vue'),
        meta: {
          icon: 'lucide:users',
          title: $t('page.system.users'),
        },
      },
      {
        name: 'SystemRbac',
        path: '/system/rbac',
        component: () => import('#/views/system/roles-permissions/index.vue'),
        meta: {
          icon: 'lucide:shield-check',
          title: $t('page.system.rbac'),
        },
      },
    ],
  },
];

export default routes;
