<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@harmony/schema'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import AssetDialog from '@/components/common/AssetDialog.vue'
import {
  WATER_COMPONENT_TYPE,
  type WaterComponentProps,
  clampWaterComponentProps,
  WATER_DEFAULT_ALPHA,
  WATER_DEFAULT_COLOR,
  WATER_DEFAULT_DISTORTION_SCALE,
  WATER_DEFAULT_FLOW_SPEED,
  WATER_DEFAULT_SIZE,
  WATER_DEFAULT_TEXTURE_HEIGHT,
  WATER_DEFAULT_TEXTURE_WIDTH,
  WATER_MIN_ALPHA,
  WATER_MAX_ALPHA,
  WATER_MIN_DISTORTION_SCALE,
  WATER_MIN_FLOW_SPEED,
  WATER_MIN_SIZE,
  WATER_MIN_TEXTURE_SIZE,
} from '@schema/components'

const ASSET_DRAG_MIME = 'application/x-harmony-asset'
const DEFAULT_FLOW_DIRECTION = { x: 0.7071, y: 0.7071 }
const DEFAULT_DROP_HINT = 'Drop texture asset to assign normals.'
const ASSET_DIALOG_TYPES = 'texture,image'

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const { selectedNode, selectedNodeId, draggingAssetId } = storeToRefs(sceneStore)

const waterComponent = computed(
  () => selectedNode.value?.components?.[WATER_COMPONENT_TYPE] as
    | SceneNodeComponentState<WaterComponentProps>
    | undefined,
)

const componentEnabled = computed(() => waterComponent.value?.enabled !== false)

const localState = reactive({
  textureWidth: WATER_DEFAULT_TEXTURE_WIDTH,
  textureHeight: WATER_DEFAULT_TEXTURE_HEIGHT,
  alpha: WATER_DEFAULT_ALPHA,
  color: formatColorNumber(WATER_DEFAULT_COLOR),
  distortionScale: WATER_DEFAULT_DISTORTION_SCALE,
  size: WATER_DEFAULT_SIZE,
  flowDirectionX: DEFAULT_FLOW_DIRECTION.x,
  flowDirectionY: DEFAULT_FLOW_DIRECTION.y,
  flowSpeed: WATER_DEFAULT_FLOW_SPEED,
  waterNormals: '',
})

const syncing = ref(false)
const dropActive = ref(false)
const dropFeedback = ref<string | null>(null)

const assignedNormalsAssetId = computed(() => localState.waterNormals)
const assignedNormalsAsset = computed(() => {
  const id = assignedNormalsAssetId.value
  if (!id) {
    return null
  }
  return sceneStore.getAsset(id)
})
const waterNormalsLabel = computed(() => {
  if (assignedNormalsAsset.value) {
    return assignedNormalsAsset.value.name?.trim() || assignedNormalsAssetId.value
  }
  return assignedNormalsAssetId.value || 'None assigned'
})
const canClearNormals = computed(() => assignedNormalsAssetId.value.length > 0)
const dropHintText = computed(() => dropFeedback.value ?? DEFAULT_DROP_HINT)

const assetDialogVisible = ref(false)
const assetDialogAnchor = ref<{ x: number; y: number } | null>(null)
const assetDialogSelectedId = ref('')
const waterNormalsThumbnail = computed(() => {
  const asset = assignedNormalsAsset.value
  if (!asset) {
    return null
  }
  return assetCacheStore.resolveAssetThumbnail({ asset, assetId: asset.id })
})

const texturePreviewStyle = computed(() => {
  const url = waterNormalsThumbnail.value
  if (!url) {
    return undefined
  }
  return { backgroundImage: `url(${url})` }
})

watch(
  () => waterComponent.value?.props,
  (props) => {
    const normalized = clampWaterComponentProps(props ?? null)
    syncing.value = true
    localState.textureWidth = normalized.textureWidth
    localState.textureHeight = normalized.textureHeight
    localState.alpha = normalized.alpha
    localState.color = formatColorNumber(normalized.color)
    localState.distortionScale = normalized.distortionScale
    localState.size = normalized.size
    localState.flowDirectionX = normalized.flowDirection.x
    localState.flowDirectionY = normalized.flowDirection.y
    localState.flowSpeed = normalized.flowSpeed
    localState.waterNormals = normalized.waterNormals ?? ''
    dropFeedback.value = null
    nextTick(() => {
      syncing.value = false
    })
  },
  { immediate: true, deep: true },
)

function applyWaterPatch(patch: Partial<WaterComponentProps>) {
  if (!componentEnabled.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = waterComponent.value
  if (!nodeId || !component) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, patch)
}

watch(
  () => localState.textureWidth,
  (value) => {
    if (syncing.value || !componentEnabled.value || !Number.isFinite(value)) {
      return
    }
    applyWaterPatch({ textureWidth: Math.round(value) })
  },
  { immediate: false },
)

watch(
  () => localState.textureHeight,
  (value) => {
    if (syncing.value || !componentEnabled.value || !Number.isFinite(value)) {
      return
    }
    applyWaterPatch({ textureHeight: Math.round(value) })
  },
  { immediate: false },
)

watch(
  () => localState.alpha,
  (value) => {
    if (syncing.value || !componentEnabled.value || !Number.isFinite(value)) {
      return
    }
    applyWaterPatch({ alpha: value })
  },
  { immediate: false },
)

watch(
  () => localState.distortionScale,
  (value) => {
    if (syncing.value || !componentEnabled.value || !Number.isFinite(value)) {
      return
    }
    applyWaterPatch({ distortionScale: value })
  },
  { immediate: false },
)

watch(
  () => localState.size,
  (value) => {
    if (syncing.value || !componentEnabled.value || !Number.isFinite(value)) {
      return
    }
    applyWaterPatch({ size: value })
  },
  { immediate: false },
)

function applyFlowDirection() {
  if (syncing.value || !componentEnabled.value) {
    return
  }
  const x = localState.flowDirectionX
  const y = localState.flowDirectionY
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return
  }
  applyWaterPatch({ flowDirection: { x, y } })
}

watch(
  () => localState.flowDirectionX,
  () => {
    applyFlowDirection()
  },
  { immediate: false },
)

watch(
  () => localState.flowDirectionY,
  () => {
    applyFlowDirection()
  },
  { immediate: false },
)

watch(
  () => localState.flowSpeed,
  (value) => {
    if (syncing.value || !componentEnabled.value || !Number.isFinite(value)) {
      return
    }
    applyWaterPatch({ flowSpeed: value })
  },
  { immediate: false },
)

watch(selectedNodeId, () => {
  dropActive.value = false
  dropFeedback.value = null
})

watch(componentEnabled, (enabled) => {
  if (!enabled) {
    dropActive.value = false
  }
})

watch(assignedNormalsAssetId, (value) => {
  assetDialogSelectedId.value = value
})

watch(assetDialogVisible, (open) => {
  if (!open) {
    assetDialogAnchor.value = null
  }
})

function handleToggleComponent() {
  const component = waterComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleOpenAssetDialog(event?: MouseEvent) {
  if (!componentEnabled.value) {
    return
  }
  assetDialogAnchor.value = event ? { x: event.clientX, y: event.clientY } : null
  assetDialogSelectedId.value = assignedNormalsAssetId.value
  assetDialogVisible.value = true
}

function handleAssetDialogUpdate(asset: ProjectAsset | null) {
  if (!asset || !isTextureAsset(asset)) {
    return
  }
  assignWaterNormalsAsset(asset.id)
  assetDialogVisible.value = false
}

function handleAssetDialogCancel() {
  assetDialogVisible.value = false
}

function handleRemoveComponent() {
  const component = waterComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}

function handleColorInput(value: string | null) {
  if (!componentEnabled.value || typeof value !== 'string') {
    return
  }
  const normalized = normalizeColorString(value, localState.color)
  if (normalized === localState.color) {
    return
  }
  localState.color = normalized
  const numeric = colorStringToNumber(normalized)
  if (numeric === null) {
    return
  }
  applyWaterPatch({ color: numeric })
}

function normalizeColorString(value: string, fallback: string): string {
  const trimmed = value.trim()
  if (!trimmed.length) {
    return fallback
  }
  const prefixed = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(prefixed)
  if (!match) {
    return fallback
  }
  const hex = match[1]
  if (hex.length === 3) {
    const [r, g, b] = hex.toLowerCase().split('')
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return `#${hex.toLowerCase()}`
}

function colorStringToNumber(value: string): number | null {
  const trimmed = value.trim().replace('#', '')
  if (/^[0-9a-f]{6}$/i.test(trimmed)) {
    return Number.parseInt(trimmed, 16)
  }
  return null
}

function formatColorNumber(value: number): string {
  const normalized = Math.max(0, Math.floor(value) & 0xffffff)
  return `#${normalized.toString(16).padStart(6, '0')}`
}

function normalizeAssetId(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return ''
  }
  const trimmed = value.trim()
  if (!trimmed.length) {
    return ''
  }
  return trimmed.startsWith('asset://') ? trimmed.slice('asset://'.length) : trimmed
}

function parseAssetDragPayload(raw: string | null): string | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as { assetId?: string }
    if (parsed?.assetId) {
      return parsed.assetId
    }
  } catch (error) {
    console.warn('Unable to parse asset drag payload', error)
  }
  return null
}

function resolveDragAssetId(event: DragEvent): string | null {
  if (event.dataTransfer) {
    const payload = parseAssetDragPayload(event.dataTransfer.getData(ASSET_DRAG_MIME))
    if (payload) {
      return payload
    }
  }
  return draggingAssetId.value ?? null
}

function resolveDraggedAsset(event: DragEvent): ProjectAsset | null {
  const assetId = resolveDragAssetId(event)
  if (!assetId) {
    return null
  }
  const normalized = normalizeAssetId(assetId)
  if (!normalized.length) {
    return null
  }
  return sceneStore.getAsset(normalized)
}

function isTextureAsset(asset: ProjectAsset | null): asset is ProjectAsset {
  if (!asset) {
    return false
  }
  return asset.type === 'texture' || asset.type === 'image'
}

function handleDragEnter(event: DragEvent) {
  if (!componentEnabled.value) {
    return
  }
  const asset = resolveDraggedAsset(event)
  if (!isTextureAsset(asset)) {
    dropFeedback.value = 'Only texture assets can be assigned here.'
    return
  }
  event.preventDefault()
  dropActive.value = true
}

function handleDragOver(event: DragEvent) {
  if (!componentEnabled.value) {
    return
  }
  const asset = resolveDraggedAsset(event)
  if (!isTextureAsset(asset)) {
    dropActive.value = false
    return
  }
  event.preventDefault()
  dropActive.value = true
}

function handleDragLeave(event: DragEvent) {
  if (!dropActive.value) {
    return
  }
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (target && related && target.contains(related)) {
    return
  }
  dropActive.value = false
  dropFeedback.value = null
}

function handleDrop(event: DragEvent) {
  if (!componentEnabled.value) {
    return
  }
  const assetId = resolveDragAssetId(event)
  dropActive.value = false
  if (!assetId) {
    dropFeedback.value = 'Drop a texture asset to assign normals.'
    return
  }
  event.preventDefault()
  event.stopPropagation()
  const normalized = normalizeAssetId(assetId)
  const asset = sceneStore.getAsset(normalized)
  if (!isTextureAsset(asset)) {
    dropFeedback.value = 'Only texture assets can be assigned here.'
    return
  }
  dropFeedback.value = null
  assignWaterNormalsAsset(normalized)
}

function assignWaterNormalsAsset(assetId: string | null) {
  const normalized = assetId ? normalizeAssetId(assetId) : ''
  localState.waterNormals = normalized
  applyWaterPatch({ waterNormals: normalized || null })
}

function clearWaterNormals() {
  assignWaterNormalsAsset(null)
}
</script>

<template>
  <v-expansion-panel value="water">
    <v-expansion-panel-title>
      <div class="water-panel-header">
        <span class="water-panel-title">Water</span>
        <v-spacer />
        <v-menu
          v-if="waterComponent"
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
              <v-list-item-title>
                {{ componentEnabled ? 'Disable' : 'Enable' }}
              </v-list-item-title>
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
      <div class="water-field-grid">
        <v-text-field
          v-model.number="localState.textureWidth"
          :min="WATER_MIN_TEXTURE_SIZE"
          label="Texture Width"
          type="number"
          density="compact"
          variant="underlined"
          hide-details
          :disabled="!componentEnabled"
          @blur="localState.textureWidth = Math.max(WATER_MIN_TEXTURE_SIZE, Math.round(localState.textureWidth))"
        />
        <v-text-field
          v-model.number="localState.textureHeight"
          :min="WATER_MIN_TEXTURE_SIZE"
          label="Texture Height"
          type="number"
          density="compact"
          variant="underlined"
          hide-details
          :disabled="!componentEnabled"
          @blur="localState.textureHeight = Math.max(WATER_MIN_TEXTURE_SIZE, Math.round(localState.textureHeight))"
        />
        <v-text-field
          v-model.number="localState.alpha"
          :min="WATER_MIN_ALPHA"
          :max="WATER_MAX_ALPHA"
          step="0.01"
          label="Alpha"
          type="number"
          density="compact"
          variant="underlined"
          hide-details
          :disabled="!componentEnabled"
        />
        <v-text-field
          v-model.number="localState.distortionScale"
          :min="WATER_MIN_DISTORTION_SCALE"
          label="Distortion Scale"
          type="number"
          density="compact"
          variant="underlined"
          hide-details
          :disabled="!componentEnabled"
        />
        <v-text-field
          v-model.number="localState.size"
          :min="WATER_MIN_SIZE"
          label="Size"
          type="number"
          density="compact"
          variant="underlined"
          hide-details
          :disabled="!componentEnabled"
        />
        <v-text-field
          v-model.number="localState.flowSpeed"
          :min="WATER_MIN_FLOW_SPEED"
          label="Flow Speed"
          type="number"
          density="compact"
          variant="underlined"
          hide-details
          :disabled="!componentEnabled"
        />
        <div class="water-flow-row">
          <div class="water-flow-label">Flow Direction</div>
          <div class="water-flow-inputs">
            <v-text-field
              v-model.number="localState.flowDirectionX"
              suffix="X"
              type="number"
              density="compact"
              variant="underlined"
              hide-details
              :disabled="!componentEnabled"
            />
            <v-text-field
              v-model.number="localState.flowDirectionY"
              suffix="Y"
              type="number"
              density="compact"
              variant="underlined"
              hide-details
              :disabled="!componentEnabled"
            />
          </div>
        </div>
        <v-text-field
          :model-value="localState.color"
          label="Water Color"
          density="compact"
          variant="underlined"
          hide-details
          :disabled="!componentEnabled"
          @update:modelValue="handleColorInput"
        />
      </div>
      <div class="water-normals-section">
        <div class="texture-item">
          <div
            class="texture-tile"
            :class="{ 'is-active-drop': dropActive, 'is-disabled': !componentEnabled }"
            @dragenter.prevent="handleDragEnter"
            @dragover.prevent="handleDragOver"
            @dragleave="handleDragLeave"
            @drop.prevent.stop="handleDrop"
          >
            <div class="texture-thumb" :style="texturePreviewStyle">
              <v-icon size="18">mdi-water</v-icon>
            </div>
            <div class="texture-body">
              <div class="texture-title">Normals Texture</div>
              <div class="texture-label">{{ waterNormalsLabel }}</div>
              <div class="texture-helper">{{ dropHintText }}</div>
            </div>
            <div class="texture-actions">
              <v-btn
                variant="text"
                density="compact"
                size="small"
                :disabled="!componentEnabled"
                @click.stop="handleOpenAssetDialog($event)">
                Choose Texture
              </v-btn>
              <v-btn
                v-if="canClearNormals"
                icon
                size="small"
                variant="text"
                :disabled="!componentEnabled"
                @click.stop="clearWaterNormals()"
              >
                <v-icon size="16">mdi-close</v-icon>
              </v-btn>
            </div>
          </div>
        </div>
      </div>
      <AssetDialog
        v-model="assetDialogVisible"
        :asset-id="assetDialogSelectedId"
        :asset-type="ASSET_DIALOG_TYPES"
        :anchor="assetDialogAnchor"
        title="Select Normals Texture"
        confirm-text="Select"
        cancel-text="Cancel"
        @update:asset="handleAssetDialogUpdate"
        @cancel="handleAssetDialogCancel"
      />
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.water-panel-header {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  width: 100%;
}

.water-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.water-field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.5rem;
}

.water-flow-row {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.water-flow-label {
  font-size: 0.75rem;
  color: rgba(233, 236, 241, 0.6);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.water-flow-inputs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4rem;
}


.water-normals-section {
  margin-top: 0.7rem;
}

.texture-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.texture-tile {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 6px;
  border-radius: 5px;
  border: 1px dashed rgba(255, 255, 255, 0.2);
  background: rgba(12, 16, 22, 0.55);
  transition: border-color 160ms ease, background-color 160ms ease;
  min-height: 44px;
}

.texture-tile.is-active-drop {
  border-color: rgba(77, 208, 225, 0.8);
  background: rgba(77, 208, 225, 0.08);
}

.texture-tile.is-disabled {
  opacity: 0.6;
  pointer-events: none;
}

.texture-thumb {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background-color: rgba(233, 236, 241, 0.08);
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
}

.texture-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.texture-title {
  font-size: 0.8rem;
  font-weight: 600;
}

.texture-label {
  font-size: 0.75rem;
  color: rgba(233, 236, 241, 0.7);
}

.texture-helper {
  font-size: 0.7rem;
  color: rgba(233, 236, 241, 0.55);
}

.texture-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
