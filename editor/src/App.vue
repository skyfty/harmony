<script setup lang="ts">
import { storeToRefs } from 'pinia'
import LoadingOverlay from '@/components/layout/LoadingOverlay.vue'
import { useUiStore } from '@/stores/uiStore'
import WasmDebug from '@/components/WasmDebug.vue'

const uiStore = useUiStore()
const { loadingOverlay } = storeToRefs(uiStore)

function handleOverlayClose() {
  uiStore.requestClose()
}
</script>

<template>
  <v-app>
    <RouterView />
    <WasmDebug />
    <LoadingOverlay
      :visible="loadingOverlay.visible"
      :mode="loadingOverlay.mode"
      :progress="loadingOverlay.progress"
      :title="loadingOverlay.title"
      :message="loadingOverlay.message"
      :closable="loadingOverlay.closable"
      @close="handleOverlayClose"
    />
  </v-app>
</template>
