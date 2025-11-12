import { createRouter, createWebHistory } from 'vue-router'
import type { NavigationGuardNext, RouteLocationNormalized } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import LoginView from '@/views/LoginView.vue'
import UploadDashboard from '@/views/UploadDashboard.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { public: true },
    },
    {
      path: '/',
      name: 'uploader',
      component: UploadDashboard,
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

router.beforeEach(async (to: RouteLocationNormalized, _from: RouteLocationNormalized, next: NavigationGuardNext) => {
  const auth = useAuthStore()
  if (to.meta.public) {
    if (to.name === 'login' && auth.isAuthenticated) {
      next({ name: 'uploader' })
      return
    }
    next()
    return
  }
  if (auth.isAuthenticated) {
    next()
    return
  }
  try {
    await auth.bootstrapFromStorage()
  } catch (error) {
    console.warn('[uploader] failed to bootstrap session in guard', error)
  }
  if (auth.isAuthenticated) {
    next()
    return
  }
  next({ name: 'login', query: { redirect: to.fullPath } })
})

export default router
