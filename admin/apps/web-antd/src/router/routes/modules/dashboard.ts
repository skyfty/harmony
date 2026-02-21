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
];

export default routes;
