<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  visible: boolean
  left: string
  top: string
  opacity: number
}>()

const emit = defineEmits<{
  (event: 'raise'): void
  (event: 'lower'): void
  (event: 'reset'): void
  (event: 'texture'): void
  (event: 'cancel'): void
}>()

const isActive = computed(() => props.visible && props.opacity > 0)

const containerStyle = computed(() => ({
  left: props.left,
  top: props.top,
  opacity: isActive.value ? props.opacity : 0,
}))


function handleTexture() {
  emit('texture')
}

function handleCancel() {
  emit('cancel')
}
</script>

<template>
  <div
    class="ground-toolbar"
    :class="{ 'is-visible': isActive }"
    :style="containerStyle"
  >
    <v-card class="ground-toolbar-card" elevation="10">
      <v-btn
        icon="mdi-close"
        density="comfortable"
        title="取消选择"
        @click="handleCancel"
      />
      <v-btn
        icon="mdi-texture-box"
        density="comfortable"
        title="设置纹理"
        @click="handleTexture"
      />
    </v-card>
  </div>
</template>

<style scoped>
.ground-toolbar {
  position: absolute;
  transform: translate(-50%, -120%);
  pointer-events: none;
  transition: opacity 150ms ease;
  opacity: 0;
  z-index: 8;
}

.ground-toolbar.is-visible {
  pointer-events: auto;
}

.ground-toolbar-card {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 12px;
  background-color: rgba(18, 21, 26, 0.88);
  border: 1px solid rgba(77, 208, 225, 0.42);
  backdrop-filter: blur(12px);
}
</style>
