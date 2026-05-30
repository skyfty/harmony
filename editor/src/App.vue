<script setup lang="ts">
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import LoadingOverlay from '@/components/layout/LoadingOverlay.vue'
import { useAuthStore } from '@/stores/authStore'
import { useUiStore } from '@/stores/uiStore'

const uiStore = useUiStore()
const authStore = useAuthStore()
const { loadingOverlay } = storeToRefs(uiStore)
const {
  sessionNotice,
  sessionNoticeVisible,
  pendingEditorLoginRequest,
  editorLoginRequestVisible,
  editorLoginRequestResponding,
} = storeToRefs(authStore)

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

function rejectEditorLoginRequest() {
  void authStore.respondToEditorLoginRequest(false)
}

function approveEditorLoginRequest() {
  void authStore.respondToEditorLoginRequest(true)
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
    <v-dialog :model-value="editorLoginRequestVisible" max-width="460" persistent>
      <v-card>
        <v-card-title class="text-h6">账号登录确认</v-card-title>
        <v-card-text>
          <p class="mb-2">
            账号 {{ pendingEditorLoginRequest?.username ?? '' }} 正在另一台设备登录。
          </p>
          <p class="text-medium-emphasis mb-0">
            允许后，当前 editor 会退出登录，并让另一台设备完成登录。
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="editorLoginRequestResponding"
            @click="rejectEditorLoginRequest"
          >
            拒绝
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="editorLoginRequestResponding"
            :disabled="editorLoginRequestResponding"
            @click="approveEditorLoginRequest"
          >
            允许登录
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
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
