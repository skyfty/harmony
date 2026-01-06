<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import MaterialPanel from '@/components/inspector/MaterialPanel.vue'
import LightPanel from '@/components/inspector/LightPanel.vue'
import TransformPanel from '@/components/inspector/TransformPanel.vue'
import AssetModelPanel from '@/components/inspector/AssetModelPanel.vue'
import WallPanel from '@/components/inspector/WallPanel.vue'
import RoadPanel from '@/components/inspector/RoadPanel.vue'
import FloorPanel from '@/components/inspector/FloorPanel.vue'
import GuideboardPanel from '@/components/inspector/GuideboardPanel.vue'
import ViewPointPanel from '@/components/inspector/ViewPointPanel.vue'
import ProtagonistPanel from '@/components/inspector/ProtagonistPanel.vue'
import WarpGatePanel from '@/components/inspector/WarpGatePanel.vue'
import EffectPanel from '@/components/inspector/EffectPanel.vue'
import GroundPanel from '@/components/inspector/GroundPanel.vue'
import SkyPanel from '@/components/inspector/SkyPanel.vue'
import WaterPanel from '@/components/inspector/WaterPanel.vue'
import CloudPanel from '@/components/inspector/CloudPanel.vue'
import EnvironmentPanel from '@/components/inspector/EnvironmentPanel.vue'
import BehaviorPanel from '@/components/inspector/BehaviorPanel.vue'
import DisplayBoardPanel from '@/components/inspector/DisplayBoardPanel.vue'
import OnlinePanel from '@/components/inspector/OnlinePanel.vue'
import RigidbodyPanel from '@/components/inspector/RigidbodyPanel.vue'
import VehiclePanel from '@/components/inspector/VehiclePanel.vue'
import LodPanel from '@/components/inspector/LodPanel.vue'
import GuideRoutePanel from '@/components/inspector/GuideRoutePanel.vue'
import { useSceneStore, SKY_NODE_ID, GROUND_NODE_ID, ENVIRONMENT_NODE_ID,MULTIUSER_NODE_ID,PROTAGONIST_NODE_ID } from '@/stores/sceneStore'
import { getNodeIcon } from '@/types/node-icons'
import { isGeometryType, type BehaviorEventType, type SceneBehavior, type SceneNodeComponentState } from '@harmony/schema'
import type { BehaviorActionDefinition } from '@schema/behaviors/definitions'

import {
  BEHAVIOR_COMPONENT_TYPE,
  DISPLAY_BOARD_COMPONENT_TYPE,
  GUIDEBOARD_COMPONENT_TYPE,
  GUIDE_ROUTE_COMPONENT_TYPE,
  PROTAGONIST_COMPONENT_TYPE,
  ONLINE_COMPONENT_TYPE,
  RIGIDBODY_COMPONENT_TYPE,
  VEHICLE_COMPONENT_TYPE,
  VIEW_POINT_COMPONENT_TYPE,
  WARP_GATE_COMPONENT_TYPE,
  WALL_COMPONENT_TYPE,
  WATER_COMPONENT_TYPE,
  EFFECT_COMPONENT_TYPE,
  componentManager,
  type RigidbodyColliderType,
  FLOOR_COMPONENT_TYPE,
  LOD_COMPONENT_TYPE,
} from '@schema/components'

type BehaviorDetailsPayload = {
  mode: 'create' | 'edit'
  action: BehaviorEventType
  sequence: SceneBehavior[]
  actions: BehaviorActionDefinition[]
  sequenceId: string
  nodeId: string | null
}
const props = defineProps<{
  floating?: boolean
  captureViewportScreenshot?: () => Promise<Blob | null>
}>()


const emit = defineEmits<{
  (event: 'collapse'): void
  (event: 'toggle-placement'): void
  (event: 'open-material-details', payload: { id: string }): void
  (event: 'close-material-details'): void
  (event: 'open-vehicle-wheel-details', payload: { id: string }): void
  (event: 'close-vehicle-wheel-details'): void
  (event: 'open-suspension-editor'): void
  (event: 'close-suspension-editor'): void
  (event: 'open-rigidbody-collider-editor'): void
  (event: 'close-rigidbody-collider-editor'): void
  (event: 'open-behavior-details', payload: BehaviorDetailsPayload): void
  (event: 'close-behavior-details'): void
}>()

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId, activeTool } = storeToRefs(sceneStore)

const nodeName = ref('')
const materialDetailsTargetId = ref<string | null>(null)
const vehicleWheelDetailsTargetId = ref<string | null>(null)
const colliderEditorActive = ref(false)
const suspensionEditorActive = ref(false)
const behaviorDetailsActive = ref(false)
const panelCardRef = ref<HTMLElement | { $el: HTMLElement } | null>(null)
const floating = computed(() => props.floating ?? false)
const placementIcon = computed(() => (floating.value ? 'mdi-dock-right' : 'mdi-arrow-expand'))
const placementTitle = computed(() => (floating.value ? '停靠到右侧' : '浮动显示'))

const isLightNode = computed(() => selectedNode.value?.nodeType === 'Light')
const isGroundNode = computed(() => selectedNode.value?.id === GROUND_NODE_ID)
const isSkyNode = computed(() => selectedNode.value?.id === SKY_NODE_ID)
const isEnvironmentNode = computed(() => selectedNode.value?.id === ENVIRONMENT_NODE_ID)
const isMultiuserNode = computed(() => selectedNode.value?.id === MULTIUSER_NODE_ID)
const isProtagonistNode = computed(() =>
  Boolean(selectedNode.value?.components?.[PROTAGONIST_COMPONENT_TYPE]),
)
const showMaterialPanel = computed(
  () => !isLightNode.value && !isProtagonistNode.value && !isMultiuserNode.value && (selectedNode.value?.materials?.length ?? 0) > 0,
)
const showTransformPanel = computed(() => {
  return selectedNode.value?.id !== SKY_NODE_ID && 
  selectedNode.value?.id !== GROUND_NODE_ID && 
  selectedNode.value?.id !== MULTIUSER_NODE_ID &&
  selectedNode.value?.id !== ENVIRONMENT_NODE_ID;
})

const showAssetModelPanel = computed(() => {
  const assetId = selectedNode.value?.sourceAssetId
  if (!assetId) {
    return false
  }
  const asset = sceneStore.getAsset(assetId)
  return Boolean(asset && (asset.type === 'model' || asset.type === 'mesh'))
})

const showAddComponentButton = computed(() => {
  return selectedNode.value?.id !== SKY_NODE_ID && 
  selectedNode.value?.id !== ENVIRONMENT_NODE_ID && 
  selectedNode.value?.id !== MULTIUSER_NODE_ID && 
  selectedNode.value?.id !== PROTAGONIST_NODE_ID;

})

const showRoadPanel = computed(() => selectedNode.value?.dynamicMesh?.type === 'Road')

const nodeComponents = computed<SceneNodeComponentState[]>(() =>
  Object.values(selectedNode.value?.components ?? {}).filter(
    (entry): entry is SceneNodeComponentState => Boolean(entry),
  ),
)
const hasBehaviorComponent = computed(() =>
  nodeComponents.value.some((component) => component.type === BEHAVIOR_COMPONENT_TYPE),
)
const availableComponents = computed(() => {
  const node = selectedNode.value
  if (!node) {
    return []
  }
  const existingTypes = new Set(Object.keys(node.components ?? {}))
  return componentManager
    .listDefinitions()
    .filter((definition) => definition.canAttach(node) && !existingTypes.has(definition.type))
})
function computeDefaultExpandedPanels() {
  const node = selectedNode.value
  const panels: string[] = []

  if (node?.id === ENVIRONMENT_NODE_ID) {
    panels.push('environment')
  } else if (node?.id === SKY_NODE_ID) {
    panels.push('sky')
  } else if (node?.id === GROUND_NODE_ID) {
    panels.push('ground')
  } else if (node?.nodeType === 'Light') {
    panels.push('light')
  }

  const hasComponents = Object.keys(node?.components ?? {}).length > 0
  if (hasComponents || !node) {
    panels.push('components')
  }

  const shouldShowMaterial =
    (!node?.nodeType || (node?.nodeType !== 'Light' && (node?.materials?.length ?? 0) > 0)) &&
    !Boolean(node?.components?.[PROTAGONIST_COMPONENT_TYPE])
  if (shouldShowMaterial && node?.id !== GROUND_NODE_ID) {
    panels.push('material')
  }

  if (node?.dynamicMesh?.type === 'Road') {
    panels.push('road')
  }

  Object.values(node?.components ?? {}).forEach((component) => {
    if (component?.type) {
      if (component.type === RIGIDBODY_COMPONENT_TYPE && node?.id === GROUND_NODE_ID) {
        return
      }
      panels.push(component.type)
    }
  })

  return Array.from(new Set(panels))
}

const expandedPanels = ref<string[]>(computeDefaultExpandedPanels())
const inspectorIcon = computed(() =>
  getNodeIcon({
    nodeType: selectedNode.value?.nodeType ?? null,
    lightType: selectedNode.value?.light?.type ?? null,
    hasChildren: Boolean(selectedNode.value?.children?.length),
    dynamicMeshType: selectedNode.value?.dynamicMesh?.type ?? null,
  }),
)

watch(
  selectedNode,
  (node) => {
    if (!node) {
      nodeName.value = ''
      return
    }
    if (nodeName.value !== node.name) {
      nodeName.value = node.name
    }
  },
  { immediate: true },
)

watch(
  () => ({ panels: expandedPanels.value.slice(), isSky: isSkyNode.value }),
  ({ panels, isSky }) => {
    sceneStore.setCloudPreviewEnabled(isSky && panels.includes('clouds'))
  },
  { immediate: true, deep: true },
)

onBeforeUnmount(() => {
  sceneStore.setCloudPreviewEnabled(false)
})

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

function closeMaterialDetails(options: { silent?: boolean; force?: boolean } = {}) {
  const hadTarget = materialDetailsTargetId.value !== null
  materialDetailsTargetId.value = null
  if ((hadTarget || options.force) && !options.silent) {
    emit('close-material-details')
  }
}

function handleMaterialPanelRequestCloseDetails() {
  closeMaterialDetails({ force: true })
}

function handleOpenVehicleWheelDetails(payload: { id: string }) {
  vehicleWheelDetailsTargetId.value = payload.id
  emit('open-vehicle-wheel-details', payload)
}

function closeVehicleWheelDetails(options: { silent?: boolean; force?: boolean } = {}) {
  const hadTarget = vehicleWheelDetailsTargetId.value !== null
  vehicleWheelDetailsTargetId.value = null
  if ((hadTarget || options.force) && !options.silent) {
    emit('close-vehicle-wheel-details')
  }
}

function handleOpenVehicleSuspensionEditor() {
  suspensionEditorActive.value = true
  emit('open-suspension-editor')
}

function closeVehicleSuspensionEditor(options: { silent?: boolean; force?: boolean } = {}) {
  const wasActive = suspensionEditorActive.value
  suspensionEditorActive.value = false
  if ((wasActive || options.force) && !options.silent) {
    emit('close-suspension-editor')
  }
}

function handleVehiclePanelRequestCloseWheelDetails() {
  closeVehicleWheelDetails({ force: true })
}


function handleOpenRigidbodyColliderEditor() {
  colliderEditorActive.value = true
  emit('open-rigidbody-collider-editor')
}

function closeRigidbodyColliderEditor(options: { silent?: boolean; force?: boolean } = {}) {
  const wasActive = colliderEditorActive.value
  colliderEditorActive.value = false
  if ((wasActive || options.force) && !options.silent) {
    emit('close-rigidbody-collider-editor')
  }
}

function handleOpenBehaviorDetails(payload: BehaviorDetailsPayload) {
  behaviorDetailsActive.value = true
  emit('open-behavior-details', payload)
}

function closeBehaviorDetails(options: { silent?: boolean } = {}) {
  if (!behaviorDetailsActive.value) {
    return
  }
  behaviorDetailsActive.value = false
  if (!options.silent) {
    emit('close-behavior-details')
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

watch(hasBehaviorComponent, (present) => {
  if (!present) {
    closeBehaviorDetails()
  }
})

watch(selectedNodeId, () => {
  closeMaterialDetails()
  closeVehicleWheelDetails()
  closeVehicleSuspensionEditor({ force: true })
  closeRigidbodyColliderEditor({ force: true })
  closeBehaviorDetails()
})

defineExpose({
  getPanelRect,
  closeMaterialDetails,
  closeVehicleWheelDetails,
  closeVehicleSuspensionEditor,
  closeRigidbodyColliderEditor,
  closeBehaviorDetails,
})

watch(selectedNodeId, () => {
  expandedPanels.value = computeDefaultExpandedPanels()
}, { immediate: true })

watch(
  nodeComponents,
  (components, previous) => {
    const currentSet = new Set(expandedPanels.value)
    let changed = false
    const componentTypes = components.map((component) => component.type)
    const previousTypes = (previous ?? []).map((component) => component.type)

    componentTypes.forEach((type) => {
      if (type && !currentSet.has(type)) {
        currentSet.add(type)
        changed = true
      }
    })

    previousTypes.forEach((type) => {
      if (!type) {
        return
      }
      if (!componentTypes.includes(type) && currentSet.has(type)) {
        currentSet.delete(type)
        changed = true
      }
    })

    const defaults = new Set(['transform'])
    if ((components.length > 0) || !selectedNode.value) {
      defaults.add('components')
    }
    if (selectedNode.value?.id === SKY_NODE_ID) {
      defaults.add('sky')
    } else if (selectedNode.value?.id === GROUND_NODE_ID) {
      defaults.add('ground')
      defaults.add('ground-terrain')
    } else if (selectedNode.value?.nodeType === 'Light') {
      defaults.add('light')
    }
    const materialVisible =
      !isLightNode.value && !isProtagonistNode.value && (selectedNode.value?.materials?.length ?? 0) > 0
    if (materialVisible) {
      defaults.add('material')
    }

    if (selectedNode.value?.dynamicMesh?.type === 'Road') {
      defaults.add('road')
    }

    defaults.forEach((key) => currentSet.add(key))

    if (changed) {
      expandedPanels.value = Array.from(currentSet)
    }
  },
  { deep: true }
)

watch(showMaterialPanel, (visible) => {
  const next = new Set(expandedPanels.value)
  let changed = false
  if (visible) {
    if (!next.has('material')) {
      next.add('material')
      changed = true
    }
  } else if (next.has('material')) {
    next.delete('material')
    changed = true
  }
  if (changed) {
    expandedPanels.value = Array.from(next)
  }
})


function handleAddComponent(type: string) {
  if (!selectedNode.value) {
    return
  }
  const created = sceneStore.addNodeComponent(selectedNode.value.id, type)
  if (!created) {
    return
  }
  if (type !== RIGIDBODY_COMPONENT_TYPE) {
    return
  }
  const preferredColliderType = resolvePreferredRigidbodyColliderType(selectedNode.value.nodeType)
  if (!preferredColliderType || (created.props as { colliderType?: RigidbodyColliderType })?.colliderType === preferredColliderType) {
    return
  }
  sceneStore.updateNodeComponentProps(selectedNode.value.id, created.id, { colliderType: preferredColliderType })
}

function resolvePreferredRigidbodyColliderType(nodeType: string | null | undefined): RigidbodyColliderType | null {
  if (!nodeType) {
    return null
  }
  if (nodeType === 'Sphere') {
    return 'sphere'
  }
  if (isGeometryType(nodeType)) {
    return 'convex'
  }
  return null
}

function ensureTransformPanelExpanded() {
  if (expandedPanels.value.includes('transform')) {
    return
  }
  expandedPanels.value = [...expandedPanels.value, 'transform']
}

watch(
  activeTool,
  (tool) => {
    if (tool !== 'select') {
      ensureTransformPanelExpanded()
    }
  },
  { immediate: true }
)

watch(
  expandedPanels,
  () => {
    if (activeTool.value !== 'select') {
      ensureTransformPanelExpanded()
    }
  },
  { deep: true }
)

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
    <div class="panel-content">
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
          <AssetModelPanel v-if="showAssetModelPanel" />
          <TransformPanel v-if="showTransformPanel"/>
          <LightPanel v-if="isLightNode"/>
          <MaterialPanel
            v-else-if="showMaterialPanel"
            v-model:active-node-material-id="materialDetailsTargetId"
            @open-details="handleOpenMaterialDetails"
            @close-details="handleMaterialPanelRequestCloseDetails"
          />
          <RoadPanel v-if="showRoadPanel" />
          <SkyPanel v-if="isSkyNode" />
          <CloudPanel v-if="isSkyNode" />
          <GroundPanel v-if="isGroundNode" />
          <EnvironmentPanel v-if="isEnvironmentNode" />

          <div v-if="nodeComponents.length" class="component-list">
            <div v-for="component in nodeComponents" :key="component.id" class="component-entry" >
              <DisplayBoardPanel v-if="component.type === DISPLAY_BOARD_COMPONENT_TYPE" />
              <GuideboardPanel v-else-if="component.type === GUIDEBOARD_COMPONENT_TYPE" />
              <ViewPointPanel v-else-if="component.type === VIEW_POINT_COMPONENT_TYPE" />
              <OnlinePanel v-else-if="component.type === ONLINE_COMPONENT_TYPE" />
              <ProtagonistPanel v-else-if="component.type === PROTAGONIST_COMPONENT_TYPE" />
              <WarpGatePanel v-else-if="component.type === WARP_GATE_COMPONENT_TYPE" />
              <EffectPanel v-else-if="component.type === EFFECT_COMPONENT_TYPE" />
              <RigidbodyPanel
                v-else-if="component.type === RIGIDBODY_COMPONENT_TYPE"
                @open-collider-editor="handleOpenRigidbodyColliderEditor"
                @close-collider-editor="closeRigidbodyColliderEditor"
              />
              <VehiclePanel
                v-else-if="component.type === VEHICLE_COMPONENT_TYPE"
                @open-wheel-details="handleOpenVehicleWheelDetails"
                @close-wheel-details="handleVehiclePanelRequestCloseWheelDetails"
                @open-suspension-editor="handleOpenVehicleSuspensionEditor"
              />
              <FloorPanel v-else-if="component.type === FLOOR_COMPONENT_TYPE" />
              <LodPanel v-else-if="component.type === LOD_COMPONENT_TYPE" />
              <GuideRoutePanel v-else-if="component.type === GUIDE_ROUTE_COMPONENT_TYPE" />
              <WallPanel v-else-if="component.type === WALL_COMPONENT_TYPE" />
              <WaterPanel v-else-if="component.type === WATER_COMPONENT_TYPE" />
              <BehaviorPanel
                v-else-if="component.type === BEHAVIOR_COMPONENT_TYPE"
                @open-details="handleOpenBehaviorDetails"
              />
            </div>
          </div>

          <div class="component-actions" v-if="showAddComponentButton">
            <v-menu location="top" origin="auto" transition="null" v-if="availableComponents.length">
              <template #activator="{ props }">
                <v-btn v-bind="props"
                      size="small" prepend-icon="mdi-plus">
                  Add Component
                </v-btn>
              </template>
              <v-list density="compact"  class="menu-list">
                <v-list-item
                  v-for="definition in availableComponents"
                  :key="definition.type"
                  :value="definition.type"
                  @click="handleAddComponent(definition.type)"
                >
                  <v-list-item-title>{{ definition.label }}</v-list-item-title>
                </v-list-item>
              </v-list>
            </v-menu>
            <v-btn
              v-else
              size="small"
              prepend-icon="mdi-check"
              disabled
            >
              All Components Added
            </v-btn>
          </div>
          </v-expansion-panels>
        </div>
        <div v-else class="placeholder-text">
          Select an object to inspect its properties.
        </div>
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

.panel-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
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

.component-list {
  
  width: 100%;
}

.component-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.component-icon {
  color: #8ab4f8;
}

.component-name {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.component-fields {
  display: grid;
  gap: 0.4rem;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
}

.component-actions {
  margin-top: 1rem;
  margin-bottom: 1rem;
  display: flex;
  justify-content: flex-start;
}

.component-empty {
  color: rgba(233, 236, 241, 0.7);
  font-size: 0.85rem;
  padding: 0.4rem 0;
}

.component-placeholder {
  color: rgba(233, 236, 241, 0.6);
  font-style: italic;
  font-size: 0.85rem;
}


.menu-list {
  padding: 6px 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.menu-list :deep(.v-list-item) {
  min-height: 26px;
  border-radius: 8px;
  padding-inline: 12px;
  transition: background-color 160ms ease;
}

.menu-list :deep(.v-list-item:hover) {
  background-color: rgba(255, 255, 255, 0.08);
}
</style>
