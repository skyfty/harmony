<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'
import { generateUuid } from '@/utils/uuid'
import AssetPickerDialog from '@/components/common/AssetPickerDialog.vue'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'
import {
  LANDFORMS_COMPONENT_TYPE,
  LANDFORMS_MAX_LAYER_COUNT,
  createDefaultLandformsLayer,
  clampLandformsComponentProps,
  cloneLandformsComponentProps,
  cloneLandformsLayer,
  type LandformsBlendMode,
  type LandformsComponentProps,
  type LandformsLayer,
  type LandformsMaskShape,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const landformsComponent = computed(
  () => selectedNode.value?.components?.[LANDFORMS_COMPONENT_TYPE] as
    | SceneNodeComponentState<LandformsComponentProps>
    | undefined,
)

const componentEnabled = computed(() => landformsComponent.value?.enabled !== false)
const localState = reactive<{ layers: LandformsLayer[] }>({ layers: [] })
const syncing = ref(false)
const draggingLayerId = ref<string | null>(null)
const dragOverLayerId = ref<string | null>(null)
const assetDialogVisible = ref(false)
const assetDialogAnchor = ref<{ x: number; y: number } | null>(null)
const assetDialogTargetLayerId = ref<string | null>(null)
const assetDialogSelectedId = ref('')

const blendModeOptions: Array<{ label: string; value: LandformsBlendMode }> = [
  { label: 'Normal', value: 'normal' },
  { label: 'Multiply', value: 'multiply' },
  { label: 'Screen', value: 'screen' },
  { label: 'Overlay', value: 'overlay' },
]

const maskShapeOptions: Array<{ label: string; value: LandformsMaskShape }> = [
  { label: 'None', value: 'none' },
  { label: 'Circle', value: 'circle' },
  { label: 'Rectangle', value: 'rectangle' },
]

watch(
  () => landformsComponent.value?.props,
  (props) => {
    syncing.value = true
    const normalized = clampLandformsComponentProps(props ?? null)
    localState.layers = normalized.layers.map((layer) => cloneLandformsLayer(layer))
    nextTick(() => {
      syncing.value = false
    })
  },
  { immediate: true, deep: true },
)

const canAddLayer = computed(() => localState.layers.length < LANDFORMS_MAX_LAYER_COUNT)

function normalizeAssetId(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed.length) {
    return ''
  }
  return trimmed.startsWith('asset://') ? trimmed.slice('asset://'.length) : trimmed
}

function getActiveAsset(layer: LandformsLayer): ProjectAsset | null {
  const assetId = normalizeAssetId(layer.assetId)
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
}

function commitLayers(): void {
  if (syncing.value) {
    return
  }
  const component = landformsComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  const nextProps = clampLandformsComponentProps({
    layers: localState.layers.map((layer) => cloneLandformsLayer(layer)),
  })
  localState.layers = nextProps.layers.map((layer) => cloneLandformsLayer(layer))
  sceneStore.updateNodeComponentProps(nodeId, component.id, {
    layers: cloneLandformsComponentProps(nextProps).layers,
  })
}

function patchLayer(layerId: string, patch: Partial<LandformsLayer>): void {
  const index = localState.layers.findIndex((layer) => layer.id === layerId)
  if (index < 0) {
    return
  }
  const currentLayer = localState.layers[index]
  if (!currentLayer) {
    return
  }
  const nextLayer: LandformsLayer = {
    ...currentLayer,
    ...patch,
    tileScale: patch.tileScale ? { ...patch.tileScale } : { ...currentLayer.tileScale },
    offset: patch.offset ? { ...patch.offset } : { ...currentLayer.offset },
    mask: patch.mask
      ? {
          ...currentLayer.mask,
          ...patch.mask,
          center: patch.mask.center ? { ...patch.mask.center } : { ...currentLayer.mask.center },
          size: patch.mask.size ? { ...patch.mask.size } : { ...currentLayer.mask.size },
        }
      : { ...currentLayer.mask },
  }
  localState.layers[index] = nextLayer
  commitLayers()
}

function handleToggleComponent(): void {
  const component = landformsComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent(): void {
  const component = landformsComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}

function handleAddLayer(): void {
  if (!canAddLayer.value) {
    return
  }
  const nextLayer = createDefaultLandformsLayer(localState.layers.length)
  nextLayer.id = generateUuid()
  localState.layers = [...localState.layers, nextLayer]
  commitLayers()
}

function handleRemoveLayer(layerId: string): void {
  localState.layers = localState.layers.filter((layer) => layer.id !== layerId)
  commitLayers()
}

function moveLayer(layerId: string, delta: number): void {
  const currentIndex = localState.layers.findIndex((layer) => layer.id === layerId)
  if (currentIndex < 0) {
    return
  }
  const nextIndex = Math.max(0, Math.min(localState.layers.length - 1, currentIndex + delta))
  if (nextIndex === currentIndex) {
    return
  }
  const next = localState.layers.map((layer) => cloneLandformsLayer(layer))
  const [entry] = next.splice(currentIndex, 1)
  if (!entry) {
    return
  }
  next.splice(nextIndex, 0, entry)
  localState.layers = next
  commitLayers()
}

function handleLayerDragStart(layerId: string, event: DragEvent): void {
  draggingLayerId.value = layerId
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', layerId)
  }
}

function handleLayerDragOver(layerId: string, event: DragEvent): void {
  if (!draggingLayerId.value || draggingLayerId.value === layerId) {
    return
  }
  event.preventDefault()
  dragOverLayerId.value = layerId
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function handleLayerDrop(layerId: string, event: DragEvent): void {
  const sourceLayerId = draggingLayerId.value
  draggingLayerId.value = null
  dragOverLayerId.value = null
  if (!sourceLayerId || sourceLayerId === layerId) {
    return
  }
  event.preventDefault()
  const next = localState.layers.map((layer) => cloneLandformsLayer(layer))
  const sourceIndex = next.findIndex((layer) => layer.id === sourceLayerId)
  const targetIndex = next.findIndex((layer) => layer.id === layerId)
  if (sourceIndex < 0 || targetIndex < 0) {
    return
  }
  const [entry] = next.splice(sourceIndex, 1)
  if (!entry) {
    return
  }
  next.splice(targetIndex, 0, entry)
  localState.layers = next
  commitLayers()
}

function handleLayerDragEnd(): void {
  draggingLayerId.value = null
  dragOverLayerId.value = null
}

function parseAssetDragPayload(event: DragEvent): { assetId: string } | null {
  if (event.dataTransfer) {
    const raw = event.dataTransfer.getData(ASSET_DRAG_MIME)
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed?.assetId && typeof parsed.assetId === 'string') {
          return { assetId: parsed.assetId }
        }
      } catch (error) {
        console.warn('Failed to parse landforms asset drag payload', error)
      }
    }
  }
  return sceneStore.draggingAssetId ? { assetId: sceneStore.draggingAssetId } : null
}

function resolveDraggedTextureAsset(event: DragEvent): ProjectAsset | null {
  const payload = parseAssetDragPayload(event)
  if (!payload) {
    return null
  }
  const asset = sceneStore.getAsset(payload.assetId)
  if (!asset || (asset.type !== 'image' && asset.type !== 'texture')) {
    return null
  }
  return asset
}

function handleAssetDragOver(event: DragEvent): void {
  if (!resolveDraggedTextureAsset(event)) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
}

function handleAssetDrop(layerId: string, event: DragEvent): void {
  if (!componentEnabled.value) {
    return
  }
  const asset = resolveDraggedTextureAsset(event)
  if (!asset) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  patchLayer(layerId, { assetId: normalizeAssetId(asset.id) || null })
}

function openAssetDialog(layerId: string, event: MouseEvent): void {
  if (!componentEnabled.value) {
    return
  }
  assetDialogTargetLayerId.value = layerId
  assetDialogSelectedId.value = normalizeAssetId(localState.layers.find((layer) => layer.id === layerId)?.assetId ?? '')
  assetDialogAnchor.value = { x: event.clientX, y: event.clientY }
  assetDialogVisible.value = true
}

function handleAssetDialogCancel(): void {
  assetDialogVisible.value = false
  assetDialogAnchor.value = null
  assetDialogTargetLayerId.value = null
}

function handleAssetDialogUpdate(asset: ProjectAsset | null): void {
  const layerId = assetDialogTargetLayerId.value
  if (!layerId) {
    handleAssetDialogCancel()
    return
  }
  if (!asset) {
    patchLayer(layerId, { assetId: null })
    handleAssetDialogCancel()
    return
  }
  if (asset.type !== 'image' && asset.type !== 'texture') {
    return
  }
  patchLayer(layerId, { assetId: normalizeAssetId(asset.id) || null })
  handleAssetDialogCancel()
}

watch(componentEnabled, (enabled) => {
  if (!enabled) {
    handleAssetDialogCancel()
  }
})
</script>

<template>
  <v-expansion-panel :value="LANDFORMS_COMPONENT_TYPE">
    <v-expansion-panel-title>
      <div class="landforms-panel__header">
        <span class="landforms-panel__title">Landforms</span>
        <v-spacer />
        <v-btn
          icon="mdi-plus"
          size="small"
          variant="text"
          :disabled="!componentEnabled || !canAddLayer"
          @click.stop="handleAddLayer"
        />
        <v-menu
          v-if="landformsComponent"
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
      <div class="landforms-panel">
        <div v-if="localState.layers.length" class="landforms-layer-list">
          <div
            v-for="(layer, index) in localState.layers"
            :key="layer.id"
            class="landforms-layer-card"
            :class="{ 'is-drop-target': dragOverLayerId === layer.id }"
            draggable="true"
            @dragstart="handleLayerDragStart(layer.id, $event)"
            @dragover="handleLayerDragOver(layer.id, $event)"
            @drop="handleLayerDrop(layer.id, $event)"
            @dragend="handleLayerDragEnd"
          >
            <div class="landforms-layer-card__header">
              <div class="landforms-layer-card__title-wrap">
                <v-icon size="16" class="drag-handle">mdi-drag</v-icon>
                <v-text-field
                  :model-value="layer.name"
                  density="compact"
                  variant="underlined"
                  hide-details
                  label="Layer Name"
                  :disabled="!componentEnabled"
                  @update:model-value="(value) => patchLayer(layer.id, { name: String(value ?? '') })"
                />
              </div>
              <div class="landforms-layer-card__actions">
                <v-switch
                  :model-value="layer.enabled"
                  density="compact"
                  hide-details
                  color="primary"
                  :disabled="!componentEnabled"
                  @update:model-value="(value) => patchLayer(layer.id, { enabled: Boolean(value) })"
                />
                <v-btn icon size="x-small" variant="text" :disabled="!componentEnabled || index === 0" @click="moveLayer(layer.id, -1)">
                  <v-icon size="16">mdi-arrow-up</v-icon>
                </v-btn>
                <v-btn icon size="x-small" variant="text" :disabled="!componentEnabled || index === localState.layers.length - 1" @click="moveLayer(layer.id, 1)">
                  <v-icon size="16">mdi-arrow-down</v-icon>
                </v-btn>
                <v-btn icon size="x-small" variant="text" color="error" :disabled="!componentEnabled" @click="handleRemoveLayer(layer.id)">
                  <v-icon size="16">mdi-delete-outline</v-icon>
                </v-btn>
              </div>
            </div>

            <div
              class="landforms-asset-drop"
              :class="{ 'is-empty': !layer.assetId }"
              @dragover="handleAssetDragOver"
              @drop="handleAssetDrop(layer.id, $event)"
            >
              <button type="button" class="landforms-asset-drop__preview" :disabled="!componentEnabled" @click="openAssetDialog(layer.id, $event)">
                <div
                  v-if="getActiveAsset(layer)?.thumbnail"
                  class="landforms-asset-drop__thumbnail"
                  :style="{ backgroundImage: `url(${getActiveAsset(layer)?.thumbnail})` }"
                />
                <div v-else class="landforms-asset-drop__placeholder">
                  <v-icon size="22">mdi-image-outline</v-icon>
                </div>
              </button>
              <div class="landforms-asset-drop__meta">
                <div class="landforms-asset-drop__name">{{ getActiveAsset(layer)?.name || 'Select Terrain Texture' }}</div>
                <div class="landforms-asset-drop__hint">{{ getActiveAsset(layer)?.id || 'Click or drag an image/texture asset here' }}</div>
              </div>
              <v-btn
                size="small"
                variant="text"
                :disabled="!componentEnabled || !layer.assetId"
                @click="patchLayer(layer.id, { assetId: null })"
              >
                Clear
              </v-btn>
            </div>

            <div class="landforms-grid">
              <v-select
                class="landforms-grid__full-row"
                label="Blend"
                density="compact"
                variant="underlined"
                hide-details
                :items="blendModeOptions"
                item-title="label"
                item-value="value"
                :model-value="layer.blendMode"
                :disabled="!componentEnabled"
                @update:model-value="(value) => patchLayer(layer.id, { blendMode: value as LandformsBlendMode })"
              />
              <v-text-field
                class="landforms-grid__half-row"
                :model-value="layer.opacity"
                label="Opacity"
                density="compact"
                variant="underlined"
                type="number"
                hide-details
                :disabled="!componentEnabled"
                min="0"
                max="1"
                step="0.05"
                @update:model-value="(value) => patchLayer(layer.id, { opacity: Number(value) })"
              />
              <v-text-field
                class="landforms-grid__half-row"
                :model-value="layer.rotationDeg"
                label="Rotation"
                density="compact"
                variant="underlined"
                type="number"
                hide-details
                :disabled="!componentEnabled"
                min="-360"
                max="360"
                step="1"
                suffix="deg"
                @update:model-value="(value) => patchLayer(layer.id, { rotationDeg: Number(value) })"
              />
              <v-switch
                class="landforms-grid__full-row"
                :model-value="layer.worldSpace"
                density="compact"
                hide-details
                color="primary"
                label="World Space"
                :disabled="!componentEnabled"
                @update:model-value="(value) => patchLayer(layer.id, { worldSpace: Boolean(value) })"
              />
            </div>

            <div class="landforms-grid landforms-grid--two-col">
              <v-text-field
                :model-value="layer.tileScale.x"
                label="Tile X"
                density="compact"
                variant="underlined"
                type="number"
                hide-details
                :disabled="!componentEnabled"
                min="0.001"
                step="0.1"
                @update:model-value="(value) => patchLayer(layer.id, { tileScale: { ...layer.tileScale, x: Number(value) } })"
              />
              <v-text-field
                :model-value="layer.tileScale.y"
                label="Tile Y"
                density="compact"
                variant="underlined"
                type="number"
                hide-details
                :disabled="!componentEnabled"
                min="0.001"
                step="0.1"
                @update:model-value="(value) => patchLayer(layer.id, { tileScale: { ...layer.tileScale, y: Number(value) } })"
              />
              <v-text-field
                :model-value="layer.offset.x"
                label="Offset X"
                density="compact"
                variant="underlined"
                type="number"
                hide-details
                :disabled="!componentEnabled"
                step="0.1"
                @update:model-value="(value) => patchLayer(layer.id, { offset: { ...layer.offset, x: Number(value) } })"
              />
              <v-text-field
                :model-value="layer.offset.y"
                label="Offset Y"
                density="compact"
                variant="underlined"
                type="number"
                hide-details
                :disabled="!componentEnabled"
                step="0.1"
                @update:model-value="(value) => patchLayer(layer.id, { offset: { ...layer.offset, y: Number(value) } })"
              />
            </div>

            <div class="landforms-grid landforms-grid--mask">
              <v-select
                label="Mask"
                density="compact"
                variant="underlined"
                hide-details
                :items="maskShapeOptions"
                item-title="label"
                item-value="value"
                :model-value="layer.mask.shape"
                :disabled="!componentEnabled"
                @update:model-value="(value) => patchLayer(layer.id, { mask: { ...layer.mask, shape: value as LandformsMaskShape } })"
              />
              <v-text-field
                :model-value="layer.mask.feather"
                label="Feather"
                density="compact"
                variant="underlined"
                type="number"
                hide-details
                :disabled="!componentEnabled"
                min="0"
                max="1"
                step="0.05"
                @update:model-value="(value) => patchLayer(layer.id, { mask: { ...layer.mask, feather: Number(value) } })"
              />
              <v-text-field
                :model-value="layer.mask.center.x"
                label="Center X"
                density="compact"
                variant="underlined"
                type="number"
                hide-details
                :disabled="!componentEnabled"
                step="0.1"
                @update:model-value="(value) => patchLayer(layer.id, { mask: { ...layer.mask, center: { ...layer.mask.center, x: Number(value) } } })"
              />
              <v-text-field
                :model-value="layer.mask.center.y"
                label="Center Y"
                density="compact"
                variant="underlined"
                type="number"
                hide-details
                :disabled="!componentEnabled"
                step="0.1"
                @update:model-value="(value) => patchLayer(layer.id, { mask: { ...layer.mask, center: { ...layer.mask.center, y: Number(value) } } })"
              />
              <v-text-field
                :model-value="layer.mask.size.x"
                label="Size X"
                density="compact"
                variant="underlined"
                type="number"
                hide-details
                :disabled="!componentEnabled"
                min="0"
                step="0.1"
                @update:model-value="(value) => patchLayer(layer.id, { mask: { ...layer.mask, size: { ...layer.mask.size, x: Number(value) } } })"
              />
              <v-text-field
                :model-value="layer.mask.size.y"
                label="Size Y"
                density="compact"
                variant="underlined"
                type="number"
                hide-details
                :disabled="!componentEnabled"
                min="0"
                step="0.1"
                @update:model-value="(value) => patchLayer(layer.id, { mask: { ...layer.mask, size: { ...layer.mask.size, y: Number(value) } } })"
              />
            </div>
          </div>
        </div>

        <div v-else class="landforms-empty">No landform layers yet.</div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>

  <AssetPickerDialog
    v-model="assetDialogVisible"
    :asset-id="assetDialogSelectedId"
    asset-type="image,texture"
    title="Select Landform Texture"
    :anchor="assetDialogAnchor"
    @update:asset="handleAssetDialogUpdate"
    @cancel="handleAssetDialogCancel"
  />
</template>

<style scoped>
.landforms-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.landforms-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.landforms-panel__title {
  font-weight: 600;
}

.landforms-panel__hint {
  font-size: 12px;
  color: rgba(220, 225, 232, 0.68);
}

.landforms-layer-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.landforms-layer-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
}

.landforms-layer-card.is-drop-target {
  border-color: rgba(77, 208, 225, 0.65);
  box-shadow: 0 0 0 1px rgba(77, 208, 225, 0.25) inset;
}

.landforms-layer-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.landforms-layer-card__title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.landforms-layer-card__index {
  width: 18px;
  text-align: center;
  font-size: 12px;
  color: rgba(220, 225, 232, 0.68);
}

.drag-handle {
  cursor: grab;
  color: rgba(220, 225, 232, 0.58);
}

.landforms-layer-card__actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.landforms-asset-drop {
  display: grid;
  grid-template-columns: 52px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 8px;
  border-radius: 10px;
  border: 1px dashed rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.14);
}

.landforms-asset-drop.is-empty {
  border-color: rgba(255, 255, 255, 0.18);
}

.landforms-asset-drop__preview {
  width: 52px;
  height: 52px;
  border: none;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  overflow: hidden;
  padding: 0;
  cursor: pointer;
}

.landforms-asset-drop__thumbnail,
.landforms-asset-drop__placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-size: cover;
  background-position: center;
}

.landforms-asset-drop__placeholder {
  color: rgba(220, 225, 232, 0.58);
}

.landforms-asset-drop__meta {
  min-width: 0;
}

.landforms-asset-drop__name,
.landforms-asset-drop__hint {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.landforms-asset-drop__name {
  font-size: 13px;
}

.landforms-asset-drop__hint {
  font-size: 11px;
  color: rgba(220, 225, 232, 0.62);
}

.landforms-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.landforms-grid__full-row {
  grid-column: 1 / -1;
}

.landforms-grid__half-row {
  grid-column: span 2;
}

.landforms-grid--two-col,
.landforms-grid--mask {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.landforms-empty {
  padding: 14px;
  border-radius: 10px;
  text-align: center;
  color: rgba(220, 225, 232, 0.62);
  background: rgba(255, 255, 255, 0.03);
}
</style>