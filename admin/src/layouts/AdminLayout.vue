<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import NavigationList from '@/components/NavigationList.vue'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import type { MenuItem } from '@/types'

interface NavItem {
  id: string
  title: string
  icon?: string
  routeName?: string
  permission?: string
  children?: NavItem[]
}

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const uiStore = useUiStore()
const refreshing = ref(false)

const fallbackNavigation: NavItem[] = [
  {
    id: 'nav-dashboard',
    title: '仪表盘',
    icon: 'mdi-view-dashboard-outline',
    routeName: 'dashboard',
    permission: 'dashboard:view',
  },
  {
    id: 'nav-users',
    title: '用户管理',
    icon: 'mdi-account-multiple-outline',
    routeName: 'users',
    permission: 'users:manage',
  },
  {
    id: 'nav-roles',
    title: '角色管理',
    icon: 'mdi-account-key-outline',
    routeName: 'roles',
    permission: 'roles:manage',
  },
  {
    id: 'nav-permissions',
    title: '权限管理',
    icon: 'mdi-lock-check-outline',
    routeName: 'permissions',
    permission: 'permissions:manage',
  },
  {
    id: 'nav-menus',
    title: '菜单管理',
    icon: 'mdi-menu',
    routeName: 'menus',
    permission: 'menus:manage',
  },
  {
    id: 'nav-contents',
    title: '内容管理',
    icon: 'mdi-file-document-edit-outline',
    routeName: 'contents',
    permission: 'contents:manage',
  },
  {
    id: 'nav-resources',
    title: '资源管理',
    icon: 'mdi-folder-multiple-image',
    routeName: 'resources',
    permission: 'resources:manage',
  },
]

function transformMenus(menus: MenuItem[]): NavItem[] {
  return menus
    .filter((menu) => authStore.hasPermission(menu.permission))
    .map<NavItem>((menu) => ({
      id: menu.id,
      title: menu.name,
      icon: menu.icon,
      routeName: menu.routeName,
      permission: menu.permission,
      children: menu.children ? transformMenus(menu.children) : undefined,
    }))
}

const navigationItems = computed<NavItem[]>(() => {
  if (authStore.menus.length) {
    const mapped = transformMenus(authStore.menus)
    return mapped.length ? mapped : fallbackNavigation.filter((item) => authStore.hasPermission(item.permission))
  }
  return fallbackNavigation.filter((item) => authStore.hasPermission(item.permission))
})

const activeTitle = computed(() => {
  const name = route.name ? String(route.name) : ''
  const stack: NavItem[] = [...navigationItems.value]
  while (stack.length) {
    const item = stack.pop()
    if (!item) {
      continue
    }
    if (item.routeName === name) {
      return item.title
    }
    if (item.children?.length) {
      stack.push(...item.children)
    }
  }
  return 'Harmony 管理后台'
})

const drawerModel = computed({
  get: () => uiStore.drawerOpen,
  set: (value: boolean) => {
    uiStore.drawerOpen = value
  },
})

watch(
  () => route.fullPath,
  () => {
    if (!authStore.canAccessRoute(String(route.name ?? ''))) {
      router.replace({ name: 'dashboard' }).catch(() => {})
    }
  },
)

async function navigate(routeName: string): Promise<void> {
  if (!routeName || routeName === route.name) {
    return
  }
  await router.push({ name: routeName })
}

async function handleLogout(): Promise<void> {
  await authStore.logout()
  await router.push({ name: 'login' })
}

async function refreshProfile(): Promise<void> {
  try {
    refreshing.value = true
    await authStore.bootstrapFromStorage()
  } finally {
    refreshing.value = false
  }
}
</script>

<template>
  <v-layout class="admin-layout">
    <v-navigation-drawer v-model="drawerModel" location="start" permanent>
      <div class="px-4 py-4 text-subtitle-1 font-weight-medium">Harmony Admin</div>
      <NavigationList
        :items="navigationItems"
        :active-route-name="route.name ? String(route.name) : null"
        @navigate="navigate"
      />
    </v-navigation-drawer>

    <v-app-bar elevation="0" density="comfortable">
      <v-app-bar-nav-icon class="d-md-none" @click="uiStore.toggleDrawer()" />
      <v-toolbar-title class="font-weight-medium">{{ activeTitle }}</v-toolbar-title>
      <v-spacer />
      <v-btn icon variant="text" :loading="refreshing" @click="refreshProfile">
        <v-icon icon="mdi-refresh" />
      </v-btn>
      <v-menu>
        <template #activator="{ props: activatorProps }">
          <v-btn
            v-bind="activatorProps"
            variant="text"
            prepend-icon="mdi-account-circle"
            class="text-capitalize"
          >
            {{ authStore.user?.displayName || authStore.user?.username || '账户' }}
          </v-btn>
        </template>
        <v-list density="compact">
          <v-list-item title="退出登录" @click="handleLogout">
            <template #prepend>
              <v-icon icon="mdi-logout" />
            </template>
          </v-list-item>
        </v-list>
      </v-menu>
    </v-app-bar>

    <v-main>
      <v-container fluid class="py-6">
        <RouterView />
      </v-container>
    </v-main>
  </v-layout>
</template>

<style scoped>
.admin-layout {
  min-height: 100vh;
}
</style>
