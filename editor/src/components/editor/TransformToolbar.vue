<script setup lang="ts">
import type { EditorTool } from '@/types/editor-tool'
import { TRANSFORM_TOOLS, type TransformToolDefinition } from '../../types/scene-transform-tools'
import { useSceneStore } from '@/stores/sceneStore'
import { useUiStore } from '@/stores/uiStore'
import { computed } from 'vue'

const props = defineProps<{
  activeTool: EditorTool
}>()

const sceneStore = useSceneStore()
const uiStore = useUiStore()
const transformDisabled = computed(() => Boolean(uiStore.activeSelectionContext))
const landformTransformLocked = computed(() => {
  const selectedIds = Array.isArray(sceneStore.selectedNodeIds) ? sceneStore.selectedNodeIds : []
  return selectedIds.some((id) => sceneStore.getNodeById(id)?.dynamicMesh?.type === 'Landform')
})

const emit = defineEmits<{
  (event: 'change-tool', tool: EditorTool): void
}>()

function isToolDisabled(tool: TransformToolDefinition) {
  if (transformDisabled.value) {
    return true
  }
  if (landformTransformLocked.value && (tool.value === 'rotate' || tool.value === 'scale')) {
    return true
  }
  return false
}

function handleToolSelect(tool: TransformToolDefinition) {
  if (isToolDisabled(tool)) return
  emit('change-tool', tool.value)
}

function toolTitle(tool: TransformToolDefinition): string {
  const base = `${tool.label} (${tool.key.replace('Key', '')})`
  if (tool.value === 'translate') {
    return `${base} — hold Shift to snap, hold V to temporarily select for placement snap`
  }
  if (landformTransformLocked.value && (tool.value === 'rotate' || tool.value === 'scale')) {
    return `${base} — disabled for Landform selection`
  }
  return base
}
</script>

<template>
  <div class="tool-strip">
    <v-card class="tool-card" elevation="6">
      <v-btn
        v-for="tool in TRANSFORM_TOOLS"
        :key="tool.value"
        :icon="tool.icon"
        :title="toolTitle(tool)"
        :color="(!isToolDisabled(tool) && props.activeTool === tool.value) ? 'primary' : undefined"
        :variant="(!isToolDisabled(tool) && props.activeTool === tool.value) ? 'flat' : 'text'"
        density="comfortable"
        class="tool-button"
        @click="handleToolSelect(tool)"
        :disabled="isToolDisabled(tool)"
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
