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
      {
        name: 'SystemResources',
        path: '/system/resources',
        component: () => import('#/views/system/resources/index.vue'),
        meta: {
          icon: 'lucide:database',
          title: '资源管理',
        },
      },
      {
        name: 'SystemResourceTags',
        path: '/system/resources/tags',
        component: () => import('#/views/system/resources/tags.vue'),
        meta: {
          icon: 'lucide:tag',
          title: '资源标签',
        },
      },
      {
        name: 'SystemResourceSeries',
        path: '/system/resources/series',
        component: () => import('#/views/system/resources/series.vue'),
        meta: {
          icon: 'lucide:archive',
          title: '资源系列',
        },
      },
    ],
  },
];

export default routes;
