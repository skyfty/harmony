<template>
  <div class="viewport-toolbar">
    <v-card class="toolbar-card" elevation="6">
      <v-btn
        icon="mdi-arrow-collapse-down"
        density="compact"
        size="small"
        class="toolbar-button"
        title="落到地面"
        :disabled="!canDropSelection"
        @click="$emit('drop-to-ground')"
      />
      <v-divider vertical />
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
      <v-divider vertical />
      <v-btn
        icon="mdi-camera"
        density="compact"
        size="small"
        class="toolbar-button"
        title="回到默认视角"
        @click="$emit('reset-camera')"
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
  canDropSelection: boolean
}>()

const { showGrid, showAxes, canDropSelection } = toRefs(props)

defineEmits<{
  (event: 'toggle-grid'): void
  (event: 'toggle-axes'): void
  (event: 'reset-camera'): void
  (event: 'toggle-camera-mode'): void
  (event: 'drop-to-ground'): void
}>()
</script>

<style scoped>
.viewport-toolbar {
  position: absolute;
  top: 3px;
  right: 3px;
  z-index: 5;
}

.toolbar-card {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  background-color: rgba(18, 21, 26, 0.48);
  border-radius: 12px;
  padding: 6px 10px;
  backdrop-filter: blur(6px);
  border: 1px solid rgba(77, 208, 225, 0.25);
}

.toolbar-button {
  border-radius: 3px;
  min-width: 22px;
  height: 22px;
}
</style>
