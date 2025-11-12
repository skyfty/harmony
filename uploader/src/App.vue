<script setup lang="ts">
import { computed } from 'vue'
import UploadWorkspace from '@/views/UploadWorkspace.vue'
import LoginOverlay from '@/components/LoginOverlay.vue'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const isAuthenticated = computed(() => authStore.isAuthenticated)
const isBootstrapping = computed(() => authStore.loading)
</script>

<template>
  <div class="app-shell">
    <div v-if="isBootstrapping" class="app-shell__loading">
      <div class="app-shell__spinner" aria-hidden="true" />
      <p>加载中...</p>
    </div>
    <template v-else>
      <UploadWorkspace v-if="isAuthenticated" />
      <LoginOverlay v-else />
    </template>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  background: linear-gradient(180deg, #f9fbfc 0%, #eef2f7 100%);
  display: flex;
  flex-direction: column;
}

.app-shell__loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: #4a5568;
}

.app-shell__spinner {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 4px solid rgba(66, 153, 225, 0.25);
  border-top-color: #3182ce;
  animation: spinner 1s linear infinite;
}

@keyframes spinner {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
