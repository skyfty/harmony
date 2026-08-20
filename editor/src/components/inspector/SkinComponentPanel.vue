<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema/core'
import AssetPickerDialog from '@/components/common/AssetPickerDialog.vue'
import type { ProjectAsset } from '@/types/project-asset'
import {
  SKIN_COMPONENT_TYPE,
  clampSkinComponentProps,
  type SkinComponentProps,
} from '@schema/components'
import {
  resolveSlotAnchorBoneNames,
  type SkinSlotKey,
} from '@schema/skinRuntime'
import { useSceneStore, getRuntimeObject } from '@/stores/sceneStore'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const component = computed(() =>
  selectedNode.value?.components?.[SKIN_COMPONENT_TYPE] as
    | SceneNodeComponentState<SkinComponentProps>
    | undefined,
)

const componentEnabled = computed(() => component.value?.enabled !== false)
const normalizedProps = computed(() => clampSkinComponentProps(component.value?.props ?? null))
const resolvedAnchors = ref<Record<SkinSlotKey, string | null>>({
  hatAssetId: null,
  glassesAssetId: null,
  hairAssetId: null,
  topAssetId: null,
  pantsAssetId: null,
  shoesAssetId: null,
})

const slotUi: Array<{
  key: SkinSlotKey
  label: string
  icon: string
  defaultAnchorLabel: string
}> = [
  { key: 'hatAssetId', label: '帽子 Hat', icon: 'mdi-hat-fedora', defaultAnchorLabel: 'Head' },
  { key: 'glassesAssetId', label: '眼镜 Glasses', icon: 'mdi-glasses', defaultAnchorLabel: 'Head' },
  { key: 'hairAssetId', label: '头发 Hair', icon: 'mdi-head', defaultAnchorLabel: 'Head' },
  { key: 'topAssetId', label: '上衣 Top', icon: 'mdi-tshirt-crew', defaultAnchorLabel: 'Chest' },
  { key: 'pantsAssetId', label: '裤子 Pants', icon: 'mdi-human-male', defaultAnchorLabel: 'Hips' },
  { key: 'shoesAssetId', label: '鞋子 Shoes', icon: 'mdi-shoe-sneaker', defaultAnchorLabel: 'Feet' },
]

const pickerVisible = ref(false)
const pickerSlotKey = ref<SkinSlotKey | null>(null)
const pickerSelectedId = ref('')
const pickerAnchor = ref<{ x: number; y: number } | null>(null)

function slotAssetName(key: SkinSlotKey): string | null {
  const assetId = normalizedProps.value[key]
  if (!assetId) {
    return null
  }
  return sceneStore.collectCatalogAssetMap().get(assetId)?.name ?? assetId
}

function openAssetPicker(key: SkinSlotKey, event?: MouseEvent): void {
  pickerSlotKey.value = key
  pickerSelectedId.value = normalizedProps.value[key] ?? ''
  pickerAnchor.value = event ? { x: event.clientX, y: event.clientY } : null
  pickerVisible.value = true
}

function handleAssetUpdate(asset: ProjectAsset | null): void {
  const key = pickerSlotKey.value
  if (key) {
    updateComponent({ [key]: asset?.id ?? null } as Partial<SkinComponentProps>)
  }
  pickerVisible.value = false
}

function handleAssetCancel(): void {
  pickerVisible.value = false
}

function clearSlot(key: SkinSlotKey): void {
  updateComponent({ [key]: null } as Partial<SkinComponentProps>)
}

function updateComponent(patch: Partial<SkinComponentProps>) {
  const nodeId = selectedNodeId.value
  const currentComponent = component.value
  if (!nodeId || !currentComponent) {
    return
  }
  const nextProps = clampSkinComponentProps({
    ...normalizedProps.value,
    ...patch,
  })
  sceneStore.updateNodeComponentProps(
    nodeId,
    currentComponent.id,
    nextProps as unknown as Partial<Record<string, unknown>>,
  )
}

function handleToggleComponent() {
  const currentComponent = component.value
  const nodeId = selectedNodeId.value
  if (!currentComponent || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, currentComponent.id)
}

function handleRemoveComponent() {
  const currentComponent = component.value
  const nodeId = selectedNodeId.value
  if (!currentComponent || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, currentComponent.id)
}

async function refreshResolvedAnchors(nodeId: string | null) {
  resolvedAnchors.value = {
    hatAssetId: null,
    glassesAssetId: null,
    hairAssetId: null,
    topAssetId: null,
    pantsAssetId: null,
    shoesAssetId: null,
  }
  if (!nodeId) {
    return
  }
  let runtimeObject = getRuntimeObject(nodeId)
  if (!runtimeObject) {
    const node = selectedNode.value
    if (node) {
      await sceneStore.ensureSceneAssetsReady({ nodes: [node], showOverlay: false, refreshViewport: false })
    }
    runtimeObject = getRuntimeObject(nodeId)
  }
  resolvedAnchors.value = resolveSlotAnchorBoneNames(runtimeObject)
}

watch(
  () => selectedNode.value?.id ?? null,
  (nodeId) => {
    void refreshResolvedAnchors(nodeId)
  },
  { immediate: true },
)
</script>

<template>
  <v-expansion-panel value="skinComponent">
    <v-expansion-panel-title>
      <div class="skin-component-panel__header">
        <span class="skin-component-panel__title">Skin</span>
        <v-spacer />
        <v-menu
          v-if="component"
          location="bottom end"
          origin="auto"
          transition="fade-transition"
        >
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon
              variant="text"
              size="small"
              class="component-menu-btn"
              @click.stop
            >
              <v-icon size="18">mdi-dots-vertical</v-icon>
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item @click.stop="handleToggleComponent()">
              <v-list-item-title>{{ componentEnabled ? 'Disable' : 'Enable' }}</v-list-item-title>
            </v-list-item>
            <v-divider class="component-menu-divider" inset />
            <v-list-item @click.stop="handleRemoveComponent()">
              <v-list-item-title>Remove</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="skin-component-panel">
        <div
          v-for="slot in slotUi"
          :key="slot.key"
          class="skin-component-panel__slot"
        >
          <div class="skin-component-panel__slot-icon">
            <v-icon size="20">{{ slot.icon }}</v-icon>
          </div>
          <div class="skin-component-panel__slot-body">
            <div class="skin-component-panel__slot-heading">
              <span class="skin-component-panel__slot-label">{{ slot.label }}</span>
              <span class="skin-component-panel__slot-anchor">
                Anchor: {{ resolvedAnchors[slot.key] ?? slot.defaultAnchorLabel }}
              </span>
            </div>
            <div class="skin-component-panel__asset-row">
              <v-btn
                variant="tonal"
                density="compact"
                prepend-icon="mdi-paperclip"
                class="skin-component-panel__asset-button"
                :disabled="!componentEnabled"
                @click="openAssetPicker(slot.key, $event)"
              >
                {{ slotAssetName(slot.key) ?? 'Select model asset' }}
              </v-btn>
              <v-btn
                v-if="normalizedProps[slot.key]"
                icon
                size="x-small"
                variant="text"
                density="compact"
                :disabled="!componentEnabled"
                @click="clearSlot(slot.key)"
              >
                <v-icon size="16">mdi-close</v-icon>
              </v-btn>
            </div>
          </div>
        </div>
      </div>

      <AssetPickerDialog
        v-model="pickerVisible"
        :asset-id="pickerSelectedId"
        assetType="model,mesh"
        title="Select Skin Model Asset"
        :anchor="pickerAnchor"
        @update:asset="handleAssetUpdate"
        @cancel="handleAssetCancel"
      />
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.skin-component-panel__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.skin-component-panel__title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.skin-component-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.skin-component-panel__message {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.65);
}

.skin-component-panel__slot {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
}

.skin-component-panel__slot-icon {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(233, 236, 241, 0.8);
  margin-top: 0.15rem;
}

.skin-component-panel__slot-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.skin-component-panel__slot-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.4rem;
}

.skin-component-panel__slot-label {
  font-size: 0.84rem;
  font-weight: 500;
}

.skin-component-panel__slot-anchor {
  font-size: 0.74rem;
  color: rgba(233, 236, 241, 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skin-component-panel__asset-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.skin-component-panel__asset-button {
  flex: 1 1 auto;
  min-width: 0;
  justify-content: flex-start;
  overflow: hidden;
  text-overflow: ellipsis;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}
</style>
