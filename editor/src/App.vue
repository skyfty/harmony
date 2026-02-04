<script setup lang="ts">
import { storeToRefs } from 'pinia'
import LoadingOverlay from '@/components/layout/LoadingOverlay.vue'
import { useUiStore } from '@/stores/uiStore'

const uiStore = useUiStore()
const { loadingOverlay } = storeToRefs(uiStore)

function handleOverlayClose() {
  uiStore.requestClose()
}
</script>

<template>
  <v-app>
    <RouterView />
    <LoadingOverlay
      :visible="loadingOverlay.visible"
      :mode="loadingOverlay.mode"
      :progress="loadingOverlay.progress"
      :title="loadingOverlay.title"
      :message="loadingOverlay.message"
      :closable="loadingOverlay.closable"
      :cancelable="loadingOverlay.cancelable"
      :cancel-text="loadingOverlay.cancelText"
      @close="handleOverlayClose"
      @cancel="uiStore.requestCancelLoadingOverlay()"
    />
  </v-app>
</template>
