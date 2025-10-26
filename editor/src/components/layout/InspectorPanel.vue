<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import InspectorMaterialPanel from '@/components/inspector/MaterialPanel.vue'
import InspectorLightPanel from '@/components/inspector/LightPanel.vue'
import InspectorTransformPanel from '@/components/inspector/TransformPanel.vue'
import InspectorWallPanel from '@/components/inspector/WallPanel.vue'
import GroundPanel from '@/components/inspector/GroundPanel.vue'
import ComponentPanel from '@/components/inspector/ComponentPanel.vue'
import { useSceneStore } from '@/stores/sceneStore'
import { getNodeIcon } from '@/types/node-icons'

const props = defineProps<{ floating?: boolean }>()

const emit = defineEmits<{
  (event: 'collapse'): void
  (event: 'toggle-placement'): void
  (event: 'open-material-details', payload: { id: string }): void
  (event: 'close-material-details'): void
}>()

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const nodeName = ref('')
const expandedPanels = ref<string[]>(['transform', 'components', 'material'])
const materialDetailsTargetId = ref<string | null>(null)
const panelCardRef = ref<HTMLElement | { $el: HTMLElement } | null>(null)
const floating = computed(() => props.floating ?? false)
const placementIcon = computed(() => (floating.value ? 'mdi-dock-right' : 'mdi-arrow-expand'))
const placementTitle = computed(() => (floating.value ? '停靠到右侧' : '浮动显示'))

const isLightNode = computed(() => selectedNode.value?.nodeType === 'Light')
const isWallNode = computed(() => selectedNode.value?.dynamicMesh?.type === 'Wall')
const isGroundNode = computed(() => selectedNode.value?.dynamicMesh?.type === 'Ground')
const showMaterialPanel = computed(
  () => !isLightNode.value && (selectedNode.value?.materials?.length ?? 0) > 0,
)
const hasComponents = computed(() => (selectedNode.value?.components?.length ?? 0) > 0)
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
    if (isGroundNode.value) {
      expandedPanels.value = ['transform', 'ground']
    } else if (isLightNode.value) {
      expandedPanels.value = ['transform', 'light']
    } else if (isWallNode.value) {
      expandedPanels.value = ['transform', 'components', 'wall', 'material']
    } else if (hasComponents.value) {
      expandedPanels.value = ['transform', 'components', 'material']
    } else {
      expandedPanels.value = ['transform', 'material']
    }
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

function handleOpenMaterialDetails(id: string) {
  materialDetailsTargetId.value = id
  emit('open-material-details', { id })
}

function closeMaterialDetails(options: { silent?: boolean } = {}) {
  if (!materialDetailsTargetId.value) {
    return
  }
  materialDetailsTargetId.value = null
  if (!options.silent) {
    emit('close-material-details')
  }
}

function getPanelRect(): DOMRect | null {
  const target = panelCardRef.value
  if (!target) {
    return null
  }
  const element = '$el' in target ? (target.$el as HTMLElement | null) : (target as HTMLElement | null)
  return element?.getBoundingClientRect() ?? null
}

watch(showMaterialPanel, (visible) => {
  if (!visible) {
    closeMaterialDetails()
  }
})

watch(selectedNodeId, () => {
  closeMaterialDetails()
})

defineExpose({
  getPanelRect,
  closeMaterialDetails,
})

</script>

<template>
  <v-card
    ref="panelCardRef"
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
    <InspectorTransformPanel />
    <GroundPanel v-if="isGroundNode" />
  <ComponentPanel v-if="!isLightNode" />
  <InspectorWallPanel v-if="isWallNode" />
        <InspectorLightPanel v-if="isLightNode"/>
        <InspectorMaterialPanel
          v-else-if="showMaterialPanel"
          v-model:active-node-material-id="materialDetailsTargetId"
          @open-details="handleOpenMaterialDetails"
        />
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
  position: relative;
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
