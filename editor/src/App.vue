<script setup lang="ts">
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import LoadingOverlay from '@/components/layout/LoadingOverlay.vue'
import { useAuthStore } from '@/stores/authStore'
import { useUiStore } from '@/stores/uiStore'

const uiStore = useUiStore()
const authStore = useAuthStore()
const { loadingOverlay } = storeToRefs(uiStore)
const { sessionNotice, sessionNoticeVisible } = storeToRefs(authStore)

const sessionNoticeSnackbarVisible = ref(false)

function handleSessionNoticeUpdate(visible: boolean) {
  sessionNoticeSnackbarVisible.value = visible
  if (!visible) {
    authStore.clearSessionNotice()
  }
}

watch(
  sessionNoticeVisible,
  (visible) => {
    sessionNoticeSnackbarVisible.value = visible
  },
  { immediate: true },
)

function handleOverlayClose() {
  uiStore.requestClose()
}
</script>

<template>
  <v-app>
    <RouterView />
    <v-snackbar
      :model-value="sessionNoticeSnackbarVisible"
      timeout="4500"
      location="top"
      color="secondary"
      variant="elevated"
      @update:model-value="handleSessionNoticeUpdate"
    >
      {{ sessionNotice ?? '账号已在另一台设备登录，当前会话已下线。' }}
    </v-snackbar>
    <LoadingOverlay
      :visible="loadingOverlay.visible"
      :mode="loadingOverlay.mode"
      :progress="loadingOverlay.progress"
      :title="loadingOverlay.title"
      :message="loadingOverlay.message"
      :closable="loadingOverlay.closable"
      :cancelable="loadingOverlay.cancelable"
      :cancel-text="loadingOverlay.cancelText"
      :details-title="loadingOverlay.detailsTitle"
      :details="loadingOverlay.details"
      :details-expanded="loadingOverlay.detailsExpanded"
      @close="handleOverlayClose"
      @cancel="uiStore.requestCancelLoadingOverlay()"
    />
  </v-app>
</template>
