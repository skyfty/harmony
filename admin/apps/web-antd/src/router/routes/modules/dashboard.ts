import type { RouteRecordRaw } from 'vue-router';

import { $t } from '#/locales';

const routes: RouteRecordRaw[] = [
  {
    name: 'Analytics',
    path: '/analytics',
    component: () => import('#/views/dashboard/analytics/index.vue'),
    meta: {
      affixTab: true,
      icon: 'lucide:area-chart',
      order: -1,
      title: $t('page.dashboard.analytics'),
    },
  },
  {
    name: 'AnalyticsSpot',
    path: '/analytics/spot/:spotId',
    component: () => import('#/views/dashboard/analytics/index.vue'),
    meta: {
      activePath: '/analytics',
      hideInMenu: true,
      icon: 'lucide:area-chart',
      title: '景点分析',
    },
  },
  {
    name: 'AnalyticsPunch',
    path: '/analytics/punch',
    component: () => import('#/views/dashboard/analytics/punch.vue'),
    meta: {
      activePath: '/analytics',
      hideInMenu: true,
      icon: 'lucide:map-pin',
      title: '打卡记录统计',
    },
  },
  {
    name: 'AnalyticsOrders',
    path: '/analytics/orders',
    component: () => import('#/views/dashboard/analytics/orders.vue'),
    meta: {
      activePath: '/analytics',
      hideInMenu: true,
      icon: 'lucide:package',
      title: '订单相关统计',
    },
  },
  {
    name: 'AnalyticsVehicles',
    path: '/analytics/vehicles',
    component: () => import('#/views/dashboard/analytics/vehicles.vue'),
    meta: {
      activePath: '/analytics',
      hideInMenu: true,
      icon: 'lucide:car-front',
      title: '车辆使用相关统计',
    },
  },
  {
    name: 'AnalyticsTravel',
    path: '/analytics/travel',
    component: () => import('#/views/dashboard/analytics/travel.vue'),
    meta: {
      activePath: '/analytics',
      hideInMenu: true,
      icon: 'lucide:route',
      title: '游历记录相关统计',
    },
  },
  {
    name: 'AnalyticsUsers',
    path: '/analytics/users',
    component: () => import('#/views/dashboard/analytics/users.vue'),
    meta: {
      activePath: '/analytics',
      hideInMenu: true,
      icon: 'lucide:users',
      title: '用户信息相关统计',
    },
  },
];

export default routes;
