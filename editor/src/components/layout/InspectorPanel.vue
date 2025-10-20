<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import InspectorMaterialPanel from '@/components/inspector/MaterialPanel.vue'
import InspectorLightPanel from '@/components/inspector/LightPanel.vue'
import InspectorTransformPanel from '@/components/inspector/TransformPanel.vue'
import { useSceneStore } from '@/stores/sceneStore'
import { getNodeIcon } from '@/types/node-icons'

const props = defineProps<{ floating?: boolean }>()

const emit = defineEmits<{
  (event: 'collapse'): void
  (event: 'toggle-placement'): void
}>()

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const nodeName = ref('')
const expandedPanels = ref<string[]>(['transform', 'material'])
const floating = computed(() => props.floating ?? false)
const placementIcon = computed(() => (floating.value ? 'mdi-dock-right' : 'mdi-arrow-expand'))
const placementTitle = computed(() => (floating.value ? '停靠到右侧' : '浮动显示'))

const isLightNode = computed(() => selectedNode.value?.nodeType === 'light')
const showMaterialPanel = computed(() => !isLightNode.value && !!selectedNode.value?.material)
const inspectorIcon = computed(() =>
  getNodeIcon({
    nodeType: selectedNode.value?.nodeType ?? null,
    lightType: selectedNode.value?.light?.type ?? null,
    hasChildren: Boolean(selectedNode.value?.children?.length),
  }),
)

watch(
  selectedNode,
  (node) => {
    if (!node) return
    nodeName.value = node.name
    expandedPanels.value = isLightNode.value ? ['transform', 'light'] : ['transform', 'material']
  },
  { immediate: true }
)


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
  <v-card
    :class="['panel-card', { 'is-floating': floating } ]"
    :elevation="floating ? 12 : 4"
  >
    <v-toolbar density="compact" title="Inspector" class="panel-toolbar" height="40px">
      <v-spacer />
      <v-btn
        class="placement-toggle"
        variant="text"
        size="small"
        :icon="placementIcon"
        :title="placementTitle"
        @click="emit('toggle-placement')"
      />
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
      </div>

      <v-expansion-panels
        v-model="expandedPanels"
        multiple
        variant="accordion"
        class="inspector-panels"
      >
        <InspectorTransformPanel  />

        <InspectorLightPanel v-if="isLightNode"/>
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
  background-color: rgba(18, 22, 28, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(14px);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
}

.panel-card.is-floating {
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.35);
}

.panel-toolbar {
  background-color: transparent;
  color: #e9ecf1;
  min-height: 20px;
  padding: 0 8px;
}

.placement-toggle {
  color: rgba(233, 236, 241, 0.72);
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
