<script setup lang="ts">
import type { BuildTool } from '@/types/build-tool'

const props = defineProps<{
  activeTool: BuildTool | null
}>()

const emit = defineEmits<{
  (event: 'change', tool: BuildTool | null): void
}>()

const tools: Array<{ id: BuildTool; icon: string; label: string }> = [
  { id: 'ground', icon: 'mdi-terrain', label: '地面工具' },
  { id: 'wall', icon: 'mdi-wall', label: '墙壁工具' },
  { id: 'platform', icon: 'mdi-layers-triple', label: '平台工具' },
]

function handleSelect(tool: BuildTool) {
  if (props.activeTool === tool) {
    emit('change', null)
    return
  }
  emit('change', tool)
}
</script>

<template>
  <div class="build-toolbar">
    <v-card class="toolbar-card" elevation="8">
      <v-btn
        v-for="tool in tools"
        :key="tool.id"
        class="toolbar-button"
        :icon="tool.icon"
        density="comfortable"
        :title="tool.label"
        :color="props.activeTool === tool.id ? 'primary' : undefined"
        :variant="props.activeTool === tool.id ? 'flat' : 'text'"
        @click="handleSelect(tool.id)"
      />
    </v-card>
  </div>
</template>

<style scoped>
.build-toolbar {
  position: relative;
}

.toolbar-card {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 12px;
  background-color: rgba(18, 21, 26, 0.78);
  border: 1px solid rgba(77, 208, 225, 0.28);
  backdrop-filter: blur(12px);
}

.toolbar-button {
  border-radius: 10px;
}
</style>
