<template>
  <div class="viewport-toolbar">
    <v-card class="toolbar-card" elevation="6">
      <v-btn
        :icon="showGrid ? 'mdi-grid' : 'mdi-grid-off'"
        :color="showGrid ? 'primary' : undefined"
        :variant="showGrid ? 'flat' : 'text'"
        density="compact"
        size="small"
        class="toolbar-button"
        title="切换网格"
        @click="$emit('toggle-grid')"
      />
      <v-btn
        :icon="showAxes ? 'mdi-axis-arrow-info' : 'mdi-axis-arrow'"
        :color="showAxes ? 'primary' : undefined"
        :variant="showAxes ? 'flat' : 'text'"
        density="compact"
        size="small"
        class="toolbar-button"
        title="切换坐标轴"
        @click="$emit('toggle-axes')"
      />
      <v-btn
        icon="mdi-camera-restore"
        density="compact"
        size="small"
        class="toolbar-button"
        title="回到默认视角"
        @click="$emit('reset-camera')"
      />
      <v-btn
        :icon="cameraMode === 'perspective' ? 'mdi-vector-perspective' : 'mdi-vector-square'"
        :color="cameraMode === 'perspective' ? 'primary' : 'secondary'"
        variant="flat"
        density="compact"
        size="small"
        class="toolbar-button"
        title="切换透视/正交"
        @click="$emit('toggle-camera-mode')"
      />
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { toRefs } from 'vue'

const props = defineProps<{
  showGrid: boolean
  showAxes: boolean
  cameraMode: 'perspective' | 'orthographic'
}>()

const { showGrid, showAxes, cameraMode } = toRefs(props)

defineEmits<{
  (event: 'toggle-grid'): void
  (event: 'toggle-axes'): void
  (event: 'reset-camera'): void
  (event: 'toggle-camera-mode'): void
}>()
</script>

<style scoped>
.viewport-toolbar {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 5;
}

.toolbar-card {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  background-color: rgba(18, 21, 26, 0.88);
  border-radius: 14px;
  padding: 6px 10px;
  backdrop-filter: blur(6px);
  border: 1px solid rgba(77, 208, 225, 0.25);
}

.toolbar-button {
  border-radius: 10px;
  min-width: 32px;
  height: 32px;
}
</style>
