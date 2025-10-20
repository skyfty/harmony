<script setup lang="ts">
import type { EditorTool } from '@/types/editor-tool'
import { TRANSFORM_TOOLS, type TransformToolDefinition } from '../../types/scene-transform-tools'

const props = defineProps<{
  activeTool: EditorTool
}>()

const emit = defineEmits<{
  (event: 'change-tool', tool: EditorTool): void
}>()

function handleToolSelect(tool: TransformToolDefinition) {
  emit('change-tool', tool.value)
}
</script>

<template>
  <div class="tool-strip">
    <v-card class="tool-card" elevation="6">
      <v-btn
        v-for="tool in TRANSFORM_TOOLS"
        :key="tool.value"
        :icon="tool.icon"
        :title="`${tool.label} (${tool.key.replace('Key', '')})`"
        :color="props.activeTool === tool.value ? 'primary' : undefined"
        :variant="props.activeTool === tool.value ? 'flat' : 'text'"
        density="comfortable"
        class="tool-button"
        @click="handleToolSelect(tool)"
      />
    </v-card>
  </div>
</template>

<style scoped>
.tool-strip {
  position: relative;
}

.tool-card {
  display: flex;
  flex-direction: column;
  background-color: rgba(18, 21, 26, 0.72);
  border-radius: 12px;
  padding: 8px;
  gap: 4px;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(77, 208, 225, 0.24);
}

.tool-button {
  border-radius: 10px;
}
</style>
