import type { RouteRecordRaw } from 'vue-router';

import { $t } from '#/locales';

const routes: RouteRecordRaw[] = [
  {
    name: 'Scenics',
    path: '/scenics',
    component: () => import('#/views/scenics/index.vue'),
    meta: {
      icon: 'lucide:image',
      title: '场景管理',
    },
  },
  {
    name: 'LoginLogs',
    path: '/login-logs',
    component: () => import('#/views/login-logs/index.vue'),
    meta: {
      icon: 'lucide:log-in',
      title: '登录日志',
    },
  },
  {
    meta: {
      icon: 'lucide:folder-kanban',
      order: 11,
      title: '项目',
    },
    name: 'UserProject',
    path: '/user-project',
    children: [
      {
        name: 'UserProjectIndex',
        path: '',
        component: () => import('#/views/user-projects/index.vue'),
        meta: {
          icon: 'lucide:folder-kanban',
          title: '项目管理',
        },
      },
        {
          name: 'UserProjectDetail',
          path: 'detail/:userId/:projectId',
          component: () => import('#/views/user-projects/detail.vue'),
          meta: {
              title: '项目详情',
              hideInMenu: true,
          },
        },
      {
        name: 'UserProjectCategories',
        path: 'categories',
        component: () => import('#/views/user-projects/categories.vue'),
        meta: {
          icon: 'lucide:folder-tree',
          title: '项目分类',
        },
      },
    ],
  },
  {
    name: 'Products',
    path: '/products',
    meta: {
      icon: 'lucide:shopping-cart',
      title: '商品管理',
    },
    children: [
      {
        name: 'ProductsIndex',
        path: '',
        component: () => import('#/views/products/index.vue'),
        meta: {
          icon: 'lucide:shopping-cart',
          title: '商品管理',
        },
      },
      {
        name: 'ProductsCategories',
        path: 'categories',
        component: () => import('#/views/products/categories.vue'),
        meta: {
          icon: 'lucide:tag',
          title: '商品分类',
        },
      },
    ],
  },
  {
    name: 'Orders',
    path: '/orders',
    meta: {
      icon: 'lucide:package',
      title: '订单管理',
    },
    children: [
      {
        name: 'OrdersIndex',
        path: '',
        component: () => import('#/views/orders/index.vue'),
        meta: {
          icon: 'lucide:package',
          title: '订单管理',
        },
      },
    ],
  },
  {
    name: 'Resources',
    path: '/resources',
    meta: {
      icon: 'lucide:database',
      title: '资源管理',
    },
    children: [
      {
        name: 'ResourcesIndex',
        path: '',
        component: () => import('#/views/resources/index.vue'),
        meta: {
          icon: 'lucide:database',
          title: '资源管理',
        },
      },
      {
        name: 'ResourcesTags',
        path: 'tags',
        component: () => import('#/views/resources/tags.vue'),
        meta: {
          icon: 'lucide:tag',
          title: '资源标签',
        },
      },
      {
        name: 'ResourcesSeries',
        path: 'series',
        component: () => import('#/views/resources/series.vue'),
        meta: {
          icon: 'lucide:archive',
          title: '资源系列',
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
      // login-logs moved to top-level route
      // moved: scenics and user-project routes relocated to root-level entries
      // resource routes moved to root level
    ],
  },
];

export default routes;
