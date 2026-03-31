import type { RouteRecordRaw } from 'vue-router';

import { $t } from '#/locales';

const routes: RouteRecordRaw[] = [
  {
    name: 'Scenes',
    path: '/scenes',
    component: () => import('#/views/scenes/index.vue'),
    meta: {
      icon: 'lucide:image',
      title: $t('page.scenes.title'),
    },
  },
  {
    meta: {
      icon: 'lucide:map-pinned',
      title: '景点管理',
    },
    name: 'SceneManagement',
    path: '/scene-management',
    children: [
      {
        name: 'SceneSpots',
        path: 'scene-spots',
        component: () => import('#/views/scene-spots/index.vue'),
        meta: {
          icon: 'lucide:map-pinned',
          title: $t('page.sceneSpots.title'),
        },
      },
      {
        name: 'HotSpots',
        path: 'hot-spots',
        component: () => import('#/views/scene-spots/hot-spots.vue'),
        meta: {
          icon: 'lucide:star',
          title: '热门景点',
        },
      },
      {
        name: 'FeaturedSpots',
        path: 'featured-spots',
        component: () => import('#/views/scene-spots/featured-spots.vue'),
        meta: {
          icon: 'lucide:award',
          title: '精选景点',
        },
      },
      {
        name: 'SceneSpotCategories',
        path: 'categories',
        component: () => import('#/views/scene-spot-categories/index.vue'),
        meta: {
          icon: 'lucide:tag',
          title: $t('page.sceneSpotCategories.title'),
        },
      },
    ],
  },
  {
    name: 'SceneSpotComments',
    path: '/scene-spot-comments',
    component: () => import('#/views/scene-spot-comments/index.vue'),
    meta: {
      icon: 'lucide:message-square',
      title: '留言管理',
    },
  },
  {
    name: 'SceneSpotCommentsBySceneSpot',
    path: '/scene-spots/:sceneSpotId/comments',
    component: () => import('#/views/scene-spot-comments/index.vue'),
    meta: {
      title: '景点留言',
      hideInMenu: true,
    },
  },
  {
    name: 'SceneSpotDetail',
    path: '/scene-spots/:id',
    component: () => import('../../../views/scene-spots/detail.vue'),
    meta: {
      title: $t('page.sceneSpots.detail.title'),
      hideInMenu: true,
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
    name: 'Vehicles',
    path: '/vehicles',
    meta: {
      icon: 'lucide:car',
      title: '车辆管理',
    },
    children: [
      {
        name: 'VehiclesIndex',
        path: '',
        component: () => import('#/views/vehicles/index.vue'),
        meta: {
          icon: 'lucide:car',
          title: '车辆管理',
        },
      },
      {
        name: 'UserVehicles',
        path: 'user-vehicles',
        component: () => import('#/views/vehicles/user-vehicles.vue'),
        meta: {
          icon: 'lucide:car-front',
          title: '用户车辆',
        },
      },
    ],
  },
  {
    name: 'Coupons',
    path: '/coupons',
    meta: {
      icon: 'lucide:ticket',
      title: $t('page.coupons.title'),
    },
    children: [
      {
        name: 'CouponsIndex',
        path: '',
        component: () => import('#/views/coupons/index.vue'),
        meta: {
          icon: 'lucide:ticket',
          title: $t('page.coupons.index.title'),
        },
      },
      {
        name: 'UserCoupons',
        path: 'user-coupons',
        component: () => import('#/views/coupons/user-coupons.vue'),
        meta: {
          icon: 'lucide:ticket-check',
          title: $t('page.coupons.userCoupons.title'),
        },
      },
      {
        name: 'CouponTypes',
        path: 'types',
        component: () => import('#/views/coupons/types.vue'),
        meta: {
          icon: 'lucide:tags',
          title: $t('page.coupons.types.title'),
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
          title: $t('page.orders.title'),
        },
      },
      {
        name: 'OrderDetail',
        path: ':id',
        component: () => import('#/views/orders/detail.vue'),
        meta: {
          title: '订单详情',
          hideInMenu: true,
        },
      },
    ],
  },
  {
    name: 'Users',
    path: '/users',
    component: () => import('#/views/users/index.vue'),
    meta: {
      icon: 'lucide:users',
      title: $t('page.system.users'),
    },
  },
  {
    name: 'PunchRecords',
    path: '/punch-records',
    component: () => import('#/views/punch-records/index.vue'),
    meta: {
      icon: 'lucide:map-pin',
      title: $t('page.punchRecords.title'),
    },
  },
  {
    name: 'TravelRecords',
    path: '/travel-records',
    component: () => import('#/views/travel-records/index.vue'),
    meta: {
      icon: 'lucide:route',
      title: $t('page.travelRecords.title'),
    },
  },
  {
    name: 'PunchRecordDetail',
    path: '/punch-records/:id',
    component: () => import('#/views/punch-records/detail.vue'),
    meta: {
      title: '打卡记录详情',
      hideInMenu: true,
    },
  },
  {
    name: 'TravelRecordDetail',
    path: '/travel-records/:id',
    component: () => import('#/views/travel-records/detail.vue'),
    meta: {
      title: '游历记录详情',
      hideInMenu: true,
    },
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
      {
        name: 'ResourcesCategories',
        path: 'categories',
        component: () => import('#/views/resources/categories.vue'),
        meta: {
          icon: 'lucide:folder-tree',
          title: '资源分类',
        },
      },
    ],
  },
  {
    name: 'SystemMiniApps',
    path: 'mini-apps',
    component: () => import('#/views/mini-apps/index.vue'),
    meta: {
      icon: 'lucide:smartphone',
      title: '小程序配置',
    },
  },
  {
    meta: {
      icon: 'carbon:user-role',
      order: 9999,
      title: $t('page.system.title'),
    },
    name: 'System',
    path: '/system',
    children: [
      {
        name: 'SystemAdmins',
        path: '/system/admins',
        component: () => import('#/views/system/admins/index.vue'),
        meta: {
          icon: 'lucide:user-cog',
          title: $t('page.system.admins'),
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
      // moved: scene and user-project routes relocated to root-level entries
      // resource routes moved to root level
    ],
  },
];

export default routes;
