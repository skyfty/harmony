<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@harmony/schema'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'
import {
  DISPLAY_BOARD_COMPONENT_TYPE,
  type DisplayBoardComponentProps,
} from '@schema/components'
import { getLastExtensionFromFilenameOrUrl, isVideoLikeExtension } from '@harmony/schema'
import AssetDialog from '@/components/common/AssetDialog.vue'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'


const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const displayBoardComponent = computed(
  () => selectedNode.value?.components?.[DISPLAY_BOARD_COMPONENT_TYPE] as
    | SceneNodeComponentState<DisplayBoardComponentProps>
    | undefined,
)

const componentEnabled = computed(() => displayBoardComponent.value?.enabled !== false)

const localProps = reactive({
  assetId: '',
  adaptation: 'fit' as DisplayBoardComponentProps['adaptation'],
})

const adaptationOptions: Array<{ label: string; value: DisplayBoardComponentProps['adaptation'] }> = [
  { label: 'Fit', value: 'fit' },
  { label: 'Fill', value: 'fill' },
]

const isDragActive = ref(false)
const assetDialogVisible = ref(false)
const assetDialogSelectedId = ref('')
const assetDialogAnchor = ref<{ x: number; y: number } | null>(null)
const ASSET_DIALOG_TYPES = 'image,texture'

function normalizeAssetId(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed.length) {
    return ''
  }
  return trimmed.startsWith('asset://') ? trimmed.slice('asset://'.length) : trimmed
}

watch(
  () => displayBoardComponent.value?.props,
  (props) => {
    const next = props as Partial<DisplayBoardComponentProps> | undefined
    const explicitAssetId = normalizeAssetId(next?.assetId as string | undefined)
    if (explicitAssetId.length) {
      localProps.assetId = explicitAssetId
    } else {
      const legacyUrl = typeof (next as { url?: unknown })?.url === 'string'
        ? normalizeAssetId((next as { url?: string }).url)
        : ''
      localProps.assetId = legacyUrl
    }
    localProps.adaptation = next?.adaptation === 'fill' ? 'fill' : 'fit'
  },
  { immediate: true, deep: true },
)

watch(
  () => localProps.assetId,
  (next) => {
    assetDialogSelectedId.value = normalizeAssetId(next)
  },
  { immediate: true },
)

function handleToggleComponent() {
  const component = displayBoardComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = displayBoardComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}

async function handleClearAsset() {
  if (!componentEnabled.value) {
    return
  }
  localProps.assetId = ''
  const component = displayBoardComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  await sceneStore.applyDisplayBoardAsset(nodeId, component.id, '', { updateMaterial: true })
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
        console.warn('Failed to parse asset drag payload', error)
      }
    }
  }
  const draggingId = sceneStore.draggingAssetId
  if (draggingId) {
    return { assetId: draggingId }
  }
  return null
}

function resolveDraggedAsset(event: DragEvent): ProjectAsset | null {
  const payload = parseAssetDragPayload(event)
  if (!payload) {
    return null
  }
  return sceneStore.getAsset(payload.assetId)
}

function isSupportedAsset(asset: ProjectAsset | null): asset is ProjectAsset {
  if (!asset) {
    return false
  }
  if (asset.type === 'image' || asset.type === 'texture') {
    return true
  }
  if (asset.type === 'file') {
    const extension = inferAssetExtension(asset)
    return extension ? isVideoExtension(extension) : false
  }
  return false
}

function inferAssetExtension(asset: ProjectAsset): string | null {
  const source = asset.name || asset.downloadUrl || asset.id
  return getLastExtensionFromFilenameOrUrl(source)
}

function isVideoExtension(extension: string | null): boolean {
  return isVideoLikeExtension(extension)
}

function handleDragEnter(event: DragEvent) {
  if (!componentEnabled.value) {
    return
  }
  const asset = resolveDraggedAsset(event)
  if (!isSupportedAsset(asset)) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  isDragActive.value = true
}

function handleDragOver(event: DragEvent) {
  if (!componentEnabled.value) {
    return
  }
  const asset = resolveDraggedAsset(event)
  if (!isSupportedAsset(asset)) {
    if (isDragActive.value) {
      isDragActive.value = false
    }
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  isDragActive.value = true
}

function handleDragLeave(event: DragEvent) {
  if (!isDragActive.value) {
    return
  }
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (target && related && target.contains(related)) {
    return
  }
  isDragActive.value = false
}

async function handleDrop(event: DragEvent) {
  if (!componentEnabled.value) {
    return
  }
  const asset = resolveDraggedAsset(event)
  isDragActive.value = false
  if (!isSupportedAsset(asset)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  const normalizedId = normalizeAssetId(asset.id)
  localProps.assetId = normalizedId
  const component = displayBoardComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  await sceneStore.applyDisplayBoardAsset(nodeId, component.id, normalizedId, { updateMaterial: true })
}

function handleAdaptationChange(value: string | null) {
  const component = displayBoardComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  if (value !== 'fit' && value !== 'fill') {
    return
  }
  if (localProps.adaptation === value) {
    return
  }
  localProps.adaptation = value
  sceneStore.updateNodeComponentProps(nodeId, component.id, { adaptation: value })
}

const activeAsset = computed(() => {
  const id = normalizeAssetId(localProps.assetId)
  if (!id.length) {
    return null
  }
  return sceneStore.getAsset(id) ?? null
})

const mediaSourceLabel = computed(() => {
  const asset = activeAsset.value
  if (!asset) {
    return ''
  }
  return asset.name?.trim().length ? asset.name : asset.id
})

const mediaSourceSecondary = computed(() => {
  const asset = activeAsset.value
  if (!asset) {
    return '拖拽图片或视频资源到此处'
  }
  return asset.id
})

const mediaPreviewStyle = computed(() => {
  const asset = activeAsset.value
  if (!asset) {
    return null
  }
  if (asset.thumbnail && asset.thumbnail.trim().length) {
    return { backgroundImage: `url(${asset.thumbnail})` }
  }
  if (asset.previewColor && asset.previewColor.trim().length) {
    return { backgroundColor: asset.previewColor }
  }
  return null
})

watch(componentEnabled, (enabled) => {
  if (!enabled && assetDialogVisible.value) {
    assetDialogVisible.value = false
  }
})

watch(assetDialogVisible, (open) => {
  if (!open) {
    assetDialogAnchor.value = null
  }
})

function handleOpenAssetDialog(event: MouseEvent) {
  if (!componentEnabled.value) {
    return
  }
  assetDialogAnchor.value = { x: event.clientX, y: event.clientY }
  assetDialogSelectedId.value = normalizeAssetId(localProps.assetId)
  assetDialogVisible.value = true
}

async function handleAssetDialogUpdate(asset: ProjectAsset | null) {
  if (!componentEnabled.value) {
    return
  }
  if (!asset) {
    await handleClearAsset()
    assetDialogVisible.value = false
    return
  }
  if (!isSupportedAsset(asset)) {
    return
  }
  const normalizedId = normalizeAssetId(asset.id)
  if (!normalizedId.length) {
    return
  }
  localProps.assetId = normalizedId
  const component = displayBoardComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  await sceneStore.applyDisplayBoardAsset(nodeId, component.id, normalizedId, { updateMaterial: true })
  assetDialogVisible.value = false
}

function handleAssetDialogCancel() {
  assetDialogVisible.value = false
}
</script>

<template>
  <v-expansion-panel value="displayBoard">
    <v-expansion-panel-title>
      <div class="display-board-panel__header">
        <span class="display-board-panel__title">Display Board</span>
        <v-spacer />
        <v-menu
          v-if="displayBoardComponent"
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
      <div class="display-board-settings">

        <div class="display-board-settings__row">
          <v-select
            label="Adaptation"
            density="compact"
            variant="underlined"
            hide-details
            :items="adaptationOptions"
            item-title="label"
            item-value="value"
            :model-value="localProps.adaptation"
            :disabled="!componentEnabled"
            @update:model-value="handleAdaptationChange"
          />
        </div>

        <div
          class="display-board-drop"
          :class="{ 'is-active': isDragActive, 'is-disabled': !componentEnabled }"
          @dragenter="handleDragEnter"
          @dragover="handleDragOver"
          @dragleave="handleDragLeave"
          @drop="handleDrop"
        >
          <div
            class="display-board-drop__preview"
            @click.stop="handleOpenAssetDialog"
          >
            <div
              v-if="mediaPreviewStyle"
              class="display-board-drop__thumbnail"
              :style="mediaPreviewStyle"
            />
            <div v-else class="display-board-drop__placeholder">
              <v-icon size="28">mdi-image-multiple-outline</v-icon>
            </div>
          </div>
          <div class="display-board-drop__info">
            <div class="display-board-drop__value">{{ mediaSourceLabel }}</div>
            <div class="display-board-drop__hint">{{ mediaSourceSecondary }}</div>
          </div>
          <v-btn
            variant="text"
            size="small"
            class="display-board-drop__clear"
            :disabled="!componentEnabled || !localProps.assetId"
            @click.stop="handleClearAsset"
          >
            Clear
          </v-btn>
        </div>
        <AssetDialog
          v-model="assetDialogVisible"
          v-model:assetId="assetDialogSelectedId"
          :asset-type="ASSET_DIALOG_TYPES"
          title="选择图片资源"
          confirm-text="选择"
          cancel-text="取消"
          :anchor="assetDialogAnchor"
          @update:asset="handleAssetDialogUpdate"
          @cancel="handleAssetDialogCancel"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.display-board-panel__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.display-board-panel__title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.display-board-settings {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.display-board-settings__row {
  display: flex;
  gap: 0.6rem;
}
.display-board-settings__hint {
  margin-bottom: 1rem;
}

.display-board-settings__row :deep(.v-text-field) {
  flex: 1;
}

.display-board-drop {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.75rem;
  padding: 0.6rem 0.8rem;
  border: 1px dashed rgba(233, 236, 241, 0.35);
  border-radius: 6px;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.display-board-drop.is-active {
  border-color: rgba(90, 148, 255, 0.75);
  background-color: rgba(90, 148, 255, 0.12);
}

.display-board-drop.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}

.display-board-drop__preview {
  width: 70px;
  height: 70px;
  border-radius: 6px;
  border: 1px solid rgba(233, 236, 241, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
  background-color: rgba(20, 24, 32, 0.55);
  cursor: pointer;
}

.display-board-drop__thumbnail {
  width: 100%;
  height: 100%;
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
}

.display-board-drop__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: rgba(233, 236, 241, 0.55);
  background: linear-gradient(140deg, rgba(80, 90, 110, 0.25) 0%, rgba(55, 65, 82, 0.4) 100%);
}

.display-board-drop__info {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  flex: 1;
  min-width: 0;
}

.display-board-drop__label {
  font-size: 0.75rem;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: rgba(233, 236, 241, 0.55);
}

.display-board-drop__value {
  font-weight: 600;
  color: rgba(241, 244, 248, 0.96);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.display-board-drop__hint {
  font-size: 0.75rem;
  color: rgba(233, 236, 241, 0.6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.display-board-drop__clear {
  margin-left: 0.75rem;
  align-self: flex-start;
  color: rgba(233, 236, 241, 0.75);
}

.display-board-drop__info {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.display-board-drop__label {
  font-size: 0.78rem;
  color: rgba(233, 236, 241, 0.68);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.display-board-drop__value {
  font-size: 0.88rem;
  color: #e9ecf1;
  word-break: break-all;
}

.display-board-drop__clear {
  color: rgba(233, 236, 241, 0.78);
}

.display-board-hint {
  margin: 0;
  font-size: 0.78rem;
  color: rgba(220, 225, 232, 0.65);
}

.display-board-hint code {
  font-family: 'Fira Code', 'Consolas', monospace;
  color: rgba(220, 225, 232, 0.85);
}
</style>