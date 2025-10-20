import { createRouter, createWebHistory } from 'vue-router'
import AdminLayout from '@/layouts/AdminLayout.vue'
import DashboardView from '@/views/DashboardView.vue'
import LoginView from '@/views/LoginView.vue'
import AccountSettingsView from '@/views/AccountSettingsView.vue'
import UserManagementView from '@/views/UserManagementView.vue'
import RoleManagementView from '@/views/RoleManagementView.vue'
import PermissionManagementView from '@/views/PermissionManagementView.vue'
import ResourceManagementView from '@/views/ResourceManagementView.vue'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: {
        public: true,
        title: '登录',
      },
    },
    {
      path: '/',
      component: AdminLayout,
      children: [
        {
          path: '',
          name: 'dashboard',
          component: DashboardView,
          meta: {
            title: '仪表盘',
          },
        },
        {
          path: 'users',
          name: 'users',
          component: UserManagementView,
          meta: {
            title: '用户管理',
          },
        },
        {
          path: 'roles',
          name: 'roles',
          component: RoleManagementView,
          meta: {
            title: '角色管理',
          },
        },
        {
          path: 'permissions',
          name: 'permissions',
          component: PermissionManagementView,
          meta: {
            title: '权限管理',
          },
        },
        {
          path: 'resources',
          name: 'resources',
          component: ResourceManagementView,
          meta: {
            title: '资源管理',
          },
        },
        {
          path: 'account/settings',
          name: 'account-settings',
          component: AccountSettingsView,
          meta: {
            title: '账户设置',
          },
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

router.beforeEach((to) => {
  const authStore = useAuthStore()
  const pageTitle = typeof to.meta.title === 'string' ? `Harmony Admin | ${to.meta.title}` : 'Harmony Admin'
  document.title = pageTitle

  if (to.meta.public) {
    if (to.name === 'login' && authStore.isAuthenticated) {
      return { name: 'dashboard' }
    }
    return true
  }

  if (!authStore.isAuthenticated) {
    return {
      name: 'login',
      query: to.fullPath !== '/' ? { redirect: to.fullPath } : undefined,
    }
  }

  if (to.name && !authStore.canAccessRoute(String(to.name))) {
    return { name: 'dashboard' }
  }

  return true
})

export default router
