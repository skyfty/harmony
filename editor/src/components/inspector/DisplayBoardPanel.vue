<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@harmony/schema'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'
import {
  DISPLAY_BOARD_COMPONENT_TYPE,
  DISPLAY_BOARD_DEFAULT_BACKGROUND_COLOR,
  DISPLAY_BOARD_DEFAULT_MAX_HEIGHT,
  DISPLAY_BOARD_DEFAULT_MAX_WIDTH,
  type DisplayBoardComponentProps,
} from '@schema/components'

const ASSET_DRAG_MIME = 'application/x-harmony-asset'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const displayBoardComponent = computed(
  () => selectedNode.value?.components?.[DISPLAY_BOARD_COMPONENT_TYPE] as
    | SceneNodeComponentState<DisplayBoardComponentProps>
    | undefined,
)

const componentEnabled = computed(() => displayBoardComponent.value?.enabled !== false)

const localProps = reactive({
  maxWidth: DISPLAY_BOARD_DEFAULT_MAX_WIDTH,
  maxHeight: DISPLAY_BOARD_DEFAULT_MAX_HEIGHT,
  backgroundColor: DISPLAY_BOARD_DEFAULT_BACKGROUND_COLOR,
  url: '',
})

const isDragActive = ref(false)

watch(
  () => displayBoardComponent.value?.props,
  (props) => {
    const next = props as Partial<DisplayBoardComponentProps> | undefined
    localProps.maxWidth = Number.isFinite(next?.maxWidth) ? (next!.maxWidth as number) : DISPLAY_BOARD_DEFAULT_MAX_WIDTH
    localProps.maxHeight = Number.isFinite(next?.maxHeight) ? (next!.maxHeight as number) : DISPLAY_BOARD_DEFAULT_MAX_HEIGHT
    localProps.backgroundColor = typeof next?.backgroundColor === 'string' && next.backgroundColor.trim().length
      ? next.backgroundColor.trim()
      : DISPLAY_BOARD_DEFAULT_BACKGROUND_COLOR
    localProps.url = typeof next?.url === 'string' ? next.url : ''
  },
  { immediate: true, deep: true },
)

function updateComponentProps(partial: Partial<DisplayBoardComponentProps>) {
  const component = displayBoardComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, partial)
}

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

function handleNumericChange(key: 'maxWidth' | 'maxHeight', value: string | number) {
  if (!componentEnabled.value) {
    return
  }
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    return
  }
  const clamped = Math.max(0.01, Math.min(100, parsed))
  localProps[key] = clamped
  updateComponentProps({ [key]: clamped })
}

function handleBackgroundColorChange(value: string) {
  if (!componentEnabled.value) {
    return
  }
  const trimmed = value.trim()
  localProps.backgroundColor = trimmed
  updateComponentProps({ backgroundColor: trimmed })
}

function handleUrlInput(value: string) {
  if (!componentEnabled.value) {
    return
  }
  localProps.url = value
}

function handleUrlCommit() {
  if (!componentEnabled.value) {
    return
  }
  updateComponentProps({ url: localProps.url.trim() })
}

function handleClearUrl() {
  if (!componentEnabled.value) {
    return
  }
  localProps.url = ''
  updateComponentProps({ url: '' })
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
  const match = source?.match(/\.([a-z0-9]+)(?:$|[?#])/i)
  return match ? match[1]?.toLowerCase() ?? null : null
}

function isVideoExtension(extension: string | null): boolean {
  if (!extension) {
    return false
  }
  return ['mp4', 'webm', 'ogv', 'ogg', 'mov', 'm4v'].includes(extension.toLowerCase())
}

function buildAssetSource(asset: ProjectAsset): string {
  return `asset://${asset.id}`
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

function handleDrop(event: DragEvent) {
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
  const source = buildAssetSource(asset)
  localProps.url = source
  updateComponentProps({ url: source })
}

const mediaSourceLabel = computed(() => {
  const value = localProps.url.trim()
  if (!value.length) {
    return '未设置'
  }
  if (value.startsWith('asset://')) {
    return `资源 ${value.slice('asset://'.length)}`
  }
  return value
})
</script>

<template>
  <v-expansion-panel value="displayBoard">
    <v-expansion-panel-title>
      <div class="display-board-panel__header">
        <span class="display-board-panel__title">Display Board Component</span>
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
          <v-text-field
            :model-value="localProps.maxWidth"
            label="Max Width (m)"
            type="number"
            variant="solo"
            density="comfortable"
            hide-details
            step="0.05"
            min="0.01"
            :disabled="!componentEnabled"
            @update:modelValue="(value) => handleNumericChange('maxWidth', value)"
          />
          <v-text-field
            :model-value="localProps.maxHeight"
            label="Max Height (m)"
            type="number"
            variant="solo"
            density="comfortable"
            hide-details
            step="0.05"
            min="0.01"
            :disabled="!componentEnabled"
            @update:modelValue="(value) => handleNumericChange('maxHeight', value)"
          />
        </div>
        <div class="display-board-settings__row">
          <v-text-field
            :model-value="localProps.backgroundColor"
            label="Background Color"
            variant="solo"
            density="comfortable"
            hide-details
            :disabled="!componentEnabled"
            @update:modelValue="handleBackgroundColorChange"
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
          <div class="display-board-drop__info">
            <div class="display-board-drop__label">Media Source</div>
            <div class="display-board-drop__value">{{ mediaSourceLabel }}</div>
          </div>
          <v-btn
            variant="text"
            size="small"
            class="display-board-drop__clear"
            :disabled="!componentEnabled || !localProps.url"
            @click.stop="handleClearUrl"
          >
            Clear
          </v-btn>
        </div>

        <v-text-field
          :model-value="localProps.url"
          label="Media URL"
          variant="solo"
          density="comfortable"
          hide-details
          :disabled="!componentEnabled"
          @update:modelValue="handleUrlInput"
          @blur="handleUrlCommit"
          @keyup.enter="handleUrlCommit"
        />
        <p class="display-board-hint">
          Drop an image or video asset here, or provide a direct URL. Asset references are stored as <code>asset://ID</code>.
        </p>
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

.display-board-settings__row :deep(.v-text-field) {
  flex: 1;
}

.display-board-drop {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
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