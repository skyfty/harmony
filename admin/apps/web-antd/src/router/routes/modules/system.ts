import type { RouteRecordRaw } from 'vue-router';

import { $t } from '#/locales';

const routes: RouteRecordRaw[] = [
  {
    name: 'Scenics',
    path: '/scenics',
    component: () => import('#/views/scenics/index.vue'),
    meta: {
      icon: 'lucide:image',
      title: $t('page.scenics.title'),
    },
  },
  {
    meta: {
      icon: 'lucide:folder-kanban',
      order: 11,
      title: $t('page.project.title'),
    },
    name: 'Project',
    path: '/projects',
    children: [
      {
        name: 'ProjectIndex',
        path: '',
        component: () => import('#/views/user-projects/index.vue'),
        meta: {
          icon: 'lucide:folder-kanban',
          title: $t('page.project.index.title'),
        },
      },
      {
        name: 'ProjectDetail',
        path: 'detail/:userId/:projectId',
        component: () => import('#/views/user-projects/detail.vue'),
        meta: {
          title: $t('page.project.detail.title'),
          hideInMenu: true,
        },
      },
      {
        name: 'ProjectCategories',
        path: 'categories',
        component: () => import('#/views/user-projects/categories.vue'),
        meta: {
          icon: 'lucide:folder-tree',
          title: $t('page.project.categories.title'),
        },
      },
    ],
  },
  {
    name: 'Products',
    path: '/products',
    meta: {
      icon: 'lucide:shopping-cart',
      title: $t('page.products.title'),
    },
    children: [
      {
        name: 'ProductsIndex',
        path: '',
        component: () => import('#/views/products/index.vue'),
        meta: {
          icon: 'lucide:shopping-cart',
          title: $t('page.products.index.title'),
        },
      },
      {
        name: 'ProductsCategories',
        path: 'categories',
        component: () => import('#/views/products/categories.vue'),
        meta: {
          icon: 'lucide:tag',
          title: $t('page.products.categories.title'),
        },
      },
    ],
  },
  {
    name: 'Orders',
    path: '/orders',
    meta: {
      icon: 'lucide:package',
      title: $t('page.orders.title'),
    },
    children: [
      {
        name: 'OrdersIndex',
        path: '',
        component: () => import('#/views/orders/index.vue'),
        meta: {
          icon: 'lucide:package',
          title: $t('page.orders.index.title'),
        },
      },
    ],
  },
  {
    name: 'Resources',
    path: '/resources',
    meta: {
      icon: 'lucide:database',
      title: $t('page.resources.title'),
    },
    children: [
      {
        name: 'ResourcesIndex',
        path: '',
        component: () => import('#/views/resources/index.vue'),
        meta: {
          icon: 'lucide:database',
          title: $t('page.resources.index.title'),
        },
      },
      {
        name: 'ResourcesTags',
        path: 'tags',
        component: () => import('#/views/resources/tags.vue'),
        meta: {
          icon: 'lucide:tag',
          title: $t('page.resources.tags.title'),
        },
      },
      {
        name: 'ResourcesSeries',
        path: 'series',
        component: () => import('#/views/resources/series.vue'),
        meta: {
          icon: 'lucide:archive',
          title: $t('page.resources.series.title'),
        },
      },
    ],
  },
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
        name: 'LoginLogs',
        path: '/login-logs',
        component: () => import('#/views/login-logs/index.vue'),
        meta: {
          icon: 'lucide:log-in',
          title: $t('page.loginLogs.title'),
        },
      },
      // login-logs moved to top-level route
      // moved: scenics and user-project routes relocated to root-level entries
      // resource routes moved to root level
    ],
  },
];

export default routes;
