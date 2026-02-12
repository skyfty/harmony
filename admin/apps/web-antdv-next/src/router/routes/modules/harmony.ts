import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    name: 'HarmonyAdmin',
    path: '/harmony',
    meta: {
      icon: 'lucide:building-2',
      order: 20,
      title: 'Harmony管理',
    },
    children: [
      {
        name: 'HarmonyScenics',
        path: '/harmony/scenics',
        component: () => import('#/views/harmony/scenics/index.vue'),
        meta: {
          title: '景区管理',
        },
      },
      {
        name: 'HarmonyProducts',
        path: '/harmony/products',
        component: () => import('#/views/harmony/products/index.vue'),
        meta: {
          title: '道具管理',
        },
      },
      {
        name: 'HarmonyCoupons',
        path: '/harmony/coupons',
        component: () => import('#/views/harmony/coupons/index.vue'),
        meta: {
          title: '卡券管理',
        },
      },
      {
        name: 'HarmonyUsers',
        path: '/harmony/users',
        component: () => import('#/views/harmony/users/index.vue'),
        meta: {
          title: '用户管理',
        },
      },
      {
        name: 'HarmonyOrders',
        path: '/harmony/orders',
        component: () => import('#/views/harmony/orders/index.vue'),
        meta: {
          title: '订单管理',
        },
      },
      {
        name: 'HarmonyAssets',
        path: '/harmony/assets',
        component: () => import('#/views/harmony/assets/index.vue'),
        meta: {
          title: '资产管理',
        },
      },
      {
        name: 'HarmonyCategories',
        path: '/harmony/categories',
        component: () => import('#/views/harmony/categories/index.vue'),
        meta: {
          title: '分类管理',
        },
      },
    ],
  },
];

export default routes;
