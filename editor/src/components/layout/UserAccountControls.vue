<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/authStore'
import LoginDialog from './LoginDialog.vue'

const authStore = useAuthStore()
const { isAuthenticated, displayName, username, avatarUrl, loginDialogVisible } = storeToRefs(authStore)
const menuOpen = ref(false)

const userInitials = computed(() => {
  const source = displayName.value || username.value
  if (!source) {
    return 'U'
  }
  const segments = source.trim().split(/\s+/)
  if (!segments.length) {
    return 'U'
  }
  if (segments.length === 1) {
    const single = segments[0] ?? ''
    return single.charAt(0).toUpperCase()
  }
  const first = segments[0] ?? ''
  const last = segments[segments.length - 1] ?? first
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
})

function openLoginDialog() {
  authStore.showLoginDialog()
}

function handleMenu(open: boolean) {
  menuOpen.value = open
}

function handleLogout() {
  menuOpen.value = false
  void authStore.logout()
}

function handleLoginDialogVisibility(value: boolean) {
  authStore.setLoginDialogVisible(value)
}
</script>

<template>
  <div class="user-account-controls">
    <v-menu
      v-if="isAuthenticated"
      v-model="menuOpen"
      location="bottom end"
      offset="8"
      :close-on-content-click="false"
      @update:model-value="handleMenu"
    >
      <template #activator="{ props }">
        <v-btn
          v-bind="props"
          class="avatar-button"
          variant="text"
          density="comfortable"
          rounded
        >
          <v-avatar size="32">
            <v-img v-if="avatarUrl" :src="avatarUrl" alt="用户头像" />
            <span v-else class="avatar-initials">{{ userInitials }}</span>
          </v-avatar>
        </v-btn>
      </template>
      <v-card class="user-menu" min-width="220">
        <v-card-item>
          <div class="user-summary">
            <v-avatar size="42">
              <v-img v-if="avatarUrl" :src="avatarUrl" alt="用户头像" />
              <span v-else class="avatar-initials">{{ userInitials }}</span>
            </v-avatar>
            <div class="user-details">
              <div class="user-name">{{ displayName || username }}</div>
              <div class="user-username">{{ username }}</div>
            </div>
          </div>
        </v-card-item>
        <v-divider />
        <v-card-actions>
          <v-btn
            block
            color="error"
            variant="tonal"
            @click="handleLogout"
          >
            <v-icon start>mdi-logout</v-icon>
            登出
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-menu>
    <v-btn
      v-else
      class="avatar-button"
      variant="text"
      density="comfortable"
      rounded
      @click="openLoginDialog"
    >
      <v-avatar size="32">
        <v-icon size="28">mdi-account-circle-outline</v-icon>
      </v-avatar>
    </v-btn>

    <LoginDialog
      :model-value="loginDialogVisible"
      @update:model-value="handleLoginDialogVisibility"
    />
  </div>
</template>

<style scoped>
.user-account-controls {
  display: flex;
  align-items: center;
}

.avatar-button {
  padding: 0;
  min-width: 40px;
}

.avatar-initials {
  font-weight: 600;
  color: #f4f6fb;
}

.user-menu {
  background: rgba(18, 21, 26, 0.95);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
}

.user-summary {
  display: flex;
  align-items: center;
  gap: 12px;
}

.user-details {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.user-name {
  font-weight: 600;
  color: #f4f6fb;
}

.user-username {
  font-size: 0.85rem;
  color: rgba(244, 247, 255, 0.62);
}
</style>
