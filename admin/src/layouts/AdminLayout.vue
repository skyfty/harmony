<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useTheme } from 'vuetify'
import { useRoute, useRouter } from 'vue-router'
import NavigationList from '@/components/NavigationList.vue'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'

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
const theme = useTheme()
const isDarkTheme = computed(() => theme.global.current.value.dark)

const userDisplayName = computed(() => authStore.user?.displayName || authStore.user?.username || '账户')

const userInitials = computed(() => {
  const source = userDisplayName.value
  const parts = source.split(' ')
  if (parts.length > 1) {
    return parts
      .slice(0, 2)
      .map((segment) => segment.charAt(0).toUpperCase())
      .join('')
  }
  return source
    .split('')
    .filter((char) => /[a-z0-9]/i.test(char))
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'A'
})

const fallbackNavigation: NavItem[] = [
  {
    id: 'nav-dashboard',
    title: '仪表盘',
    icon: 'mdi-view-dashboard-outline',
    routeName: 'dashboard',
    permission: 'dashboard:view',
  },
  {
    id: 'nav-resources',
    title: '资源管理',
    icon: 'mdi-folder-multiple-image',
    routeName: 'resources',
    permission: 'resources:manage',
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
    id: 'nav-account-settings',
    title: '账户设置',
    icon: 'mdi-account-cog-outline',
    routeName: 'account-settings',
  },
]

const navigationItems = computed<NavItem[]>(() => {
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

function toggleTheme(): void {
  const current = theme.global.name.value
  theme.global.name.value = current === 'light' ? 'dark' : 'light'
}
</script>

<template>
  <v-layout class="admin-layout">
    <v-navigation-drawer
      v-model="drawerModel"
      location="start"
      permanent
      class="admin-navigation"
    >
      <div class="admin-navigation__brand">
        <div class="admin-navigation__logo">HA</div>
        <div>
          <div class="admin-navigation__title">Harmony Admin</div>
          <div class="admin-navigation__subtitle">控制中心</div>
        </div>
      </div>
      <v-divider class="mb-3" />
      <NavigationList
        :items="navigationItems"
        :active-route-name="route.name ? String(route.name) : null"
        @navigate="navigate"
      />
    </v-navigation-drawer>

    <v-app-bar
      elevation="0"
      density="comfortable"
      class="admin-app-bar"
    >
      <v-app-bar-nav-icon class="d-lg-none" @click="uiStore.toggleDrawer()" />
      <div class="admin-app-bar__title">
        <div class="admin-app-bar__heading">{{ activeTitle }}</div>
        <div class="admin-app-bar__subtitle">实时掌握系统与资源的运行状态</div>
      </div>
      <v-spacer />
      <v-btn icon variant="text" class="admin-app-bar__button" @click="toggleTheme">
        <v-icon :icon="isDarkTheme ? 'mdi-weather-sunny' : 'mdi-weather-night'" />
      </v-btn>
      <v-btn icon variant="text" class="admin-app-bar__button" :loading="refreshing" @click="refreshProfile">
        <v-icon icon="mdi-refresh" />
      </v-btn>

      <v-menu open-on-hover transition="scale-transition">
        <template #activator="{ props: activatorProps }">
          <v-btn
            v-bind="activatorProps"
            variant="text"
            class="admin-app-bar__profile"
          >
            <v-avatar size="36" color="primary" variant="tonal">
              <span class="text-button">{{ userInitials }}</span>
            </v-avatar>
            <span class="ms-3 text-body-2">{{ userDisplayName }}</span>
            <v-icon icon="mdi-chevron-down" size="18" />
          </v-btn>
        </template>
        <v-list density="compact" class="py-2">
          <v-list-item title="账户设置" @click="navigate('account-settings')">
            <template #prepend>
              <v-icon icon="mdi-account-cog-outline" />
            </template>
          </v-list-item>
          <v-list-item title="刷新权限" :disabled="refreshing" @click="refreshProfile">
            <template #prepend>
              <v-icon icon="mdi-sync" />
            </template>
          </v-list-item>
          <v-divider class="my-2" />
          <v-list-item title="退出登录" @click="handleLogout">
            <template #prepend>
              <v-icon icon="mdi-logout" />
            </template>
          </v-list-item>
        </v-list>
      </v-menu>
    </v-app-bar>

    <v-main class="admin-main">
      <div class="admin-main__surface">
        <v-container fluid class="py-6">
          <RouterView />
        </v-container>
      </div>
    </v-main>
  </v-layout>
</template>

<style scoped lang="scss">
.admin-layout {
  min-height: 100vh;
  background-color: rgb(var(--v-theme-surface));
}

.admin-navigation {
  border-inline-end: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding-inline: 1.25rem;
  padding-block: 1.5rem;
  background: linear-gradient(180deg, rgba(var(--v-theme-primary), 0.12) 0%, rgba(var(--v-theme-surface), 0.92) 100%);

  &__brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding-inline: 0.25rem;
    margin-block-end: 0.75rem;
  }

  &__logo {
    inline-size: 40px;
    block-size: 40px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    font-weight: 600;
    background: rgb(var(--v-theme-primary));
    color: rgb(var(--v-theme-on-primary));
    letter-spacing: 0.08em;
  }

  &__title {
    font-size: 1.1rem;
    font-weight: 600;
  }

  &__subtitle {
    font-size: 0.75rem;
    color: rgba(var(--v-theme-on-surface), 0.6);
  }
}

.admin-app-bar {
  backdrop-filter: blur(8px);
  background-color: rgba(var(--v-theme-surface), 0.82) !important;
  border-block-end: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding-inline: 1.25rem;

  &__title {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  &__heading {
    font-weight: 600;
    font-size: 1.1rem;
  }

  &__subtitle {
    font-size: 0.78rem;
    color: rgba(var(--v-theme-on-surface), 0.54);
  }

  &__button {
    color: rgba(var(--v-theme-on-surface), 0.7);
  }

  &__profile {
    min-inline-size: 0;
    padding-inline: 0.5rem;
    text-transform: none;
    color: rgba(var(--v-theme-on-surface), 0.8);
  }
}

.admin-main {
  background: linear-gradient(180deg, rgba(var(--v-theme-primary), 0.08) 0%, transparent 120%);
  padding-inline: clamp(1rem, 4vw, 2rem);

  &__surface {
    max-inline-size: 1240px;
    margin: 0 auto;
  }
}

@media (max-width: 960px) {
  .admin-navigation {
    padding-inline: 1rem;
  }

  .admin-app-bar__subtitle {
    display: none;
  }
}
</style>
