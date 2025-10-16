<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import InspectorMaterialPanel from '@/components/inspector/MaterialPanel.vue'
import InspectorTransformPanel from '@/components/inspector/TransformPanel.vue'
import InspectorLightPanel from '@/components/inspector/LightPanel.vue'
import { useSceneStore } from '@/stores/sceneStore'

const emit = defineEmits<{
  (event: 'collapse'): void
}>()

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const nodeName = ref('')
const expandedPanels = ref<string[]>(['transform', 'material'])

const isLightNode = computed(() => selectedNode.value?.nodeType === 'light')
const showMaterialPanel = computed(() => !isLightNode.value && !!selectedNode.value?.material)
const inspectorIcon = computed(() => (isLightNode.value ? 'mdi-lightbulb-on-outline' : 'mdi-cube-outline'))

watch(
  selectedNode,
  (node) => {
    if (!node) return
    nodeName.value = node.name
    expandedPanels.value = isLightNode.value ? ['transform', 'light'] : ['transform', 'material']
  },
  { immediate: true }
)

function updateVisibility(value: boolean | null) {
  if (!selectedNodeId.value) return
  sceneStore.setNodeVisibility(selectedNodeId.value, Boolean(value))
}

function handleNameUpdate(value: string) {
  if (!selectedNodeId.value) return
  nodeName.value = value
  const trimmed = value.trim()
  if (!trimmed) {
    nodeName.value = selectedNode.value?.name ?? ''
    return
  }
  if (trimmed === selectedNode.value?.name) {
    return
  }
  sceneStore.renameNode(selectedNodeId.value, trimmed)
}

</script>

<template>
  <v-card class="panel-card" elevation="4">
    <v-toolbar density="compact" title="Inspector" class="panel-toolbar" height="40px">
      <v-spacer />
      <v-btn icon="mdi-window-minimize"  size="small" variant="text" @click="emit('collapse')" />
    </v-toolbar>
    <v-divider />
    <div class="panel-body" v-if="selectedNode">
      <div style="display: flex; align-items: center; gap: 0.2rem; padding: 0.2rem 0.7rem;">
        <v-icon color="primary" size="40">{{ inspectorIcon }}</v-icon>
        <v-text-field
          :model-value="nodeName"
          variant="solo"
          density="compact"
          hide-details
          @update:modelValue="handleNameUpdate"
        />
        <v-checkbox
          :model-value="selectedNode.visible ?? true"
          density="compact"
          hide-details
          @update:modelValue="updateVisibility"
        />
      </div>

      <v-expansion-panels
        v-model="expandedPanels"
        multiple
        variant="accordion"
        class="inspector-panels"
      >
        <InspectorTransformPanel />

        <InspectorLightPanel v-if="isLightNode" />
        <InspectorMaterialPanel v-else-if="showMaterialPanel" />
      </v-expansion-panels>
    </div>
    <div v-else class="placeholder-text">
      Select an object to inspect its properties.
    </div>
  </v-card>
</template>

<style scoped>
.panel-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: rgba(36, 38, 41, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.panel-toolbar {
  background-color: transparent;
  color: #e9ecf1;
  min-height: 20px;
  padding: 0 8px;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 0.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.panel-toolbar :deep(.v-toolbar-title) {
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  margin-inline-start: 0px;
}

.panel-toolbar :deep(.v-btn) {
  width: 32px;
  height: 32px;
}

.inspector-panels {
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.04);
  background-color: rgba(14, 16, 18, 0.35);
}

.inspector-panels :deep(.v-expansion-panel-title) {
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  min-height: 34px;
  padding-block: 2px;
  padding: 0 10px;
}

.v-expansion-panel--active > .v-expansion-panel-title:not(.v-expansion-panel-title--static) {
  min-height: 34px;
}
.inspector-panels :deep(.v-expansion-panel-text__wrapper) {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 8px 10px 16px;
}


</style>
