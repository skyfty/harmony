<script setup lang="ts">
import { ref, watch } from 'vue'
import AssetPickerDialog from '@/components/common/AssetPickerDialog.vue'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'
import { useSceneStore } from '@/stores/sceneStore'
import type { ProjectAsset } from '@/types/project-asset'

export interface MaterialAssetListItem {
  id: string
  title: string
  subtitle?: string
  color: string
  thumbnail?: string | null
}

const props = withDefaults(defineProps<{
  modelValue?: string | null
  items: MaterialAssetListItem[]
  disabled?: boolean
  allowListDrop?: boolean
}>(), {
  modelValue: null,
  disabled: false,
  allowListDrop: false,
})

const emit = defineEmits<{
  (event: 'update:modelValue', id: string | null): void
  (event: 'open-details', id: string): void
  (event: 'apply-asset', payload: { id: string; asset: ProjectAsset | null }): void
  (event: 'apply-list-asset', asset: ProjectAsset): void
}>()

type MaterialAsset = ProjectAsset & { type: 'material' }
type TextureAsset = ProjectAsset & { type: 'image' | 'texture' }

const sceneStore = useSceneStore()
const dragOverItemId = ref<string | null>(null)
const isListDragActive = ref(false)
const pickerVisible = ref(false)
const pickerItemId = ref<string | null>(null)
const pickerAssetId = ref('')
const pickerAnchor = ref<{ x: number; y: number } | null>(null)

function setActive(id: string | null) {
  emit('update:modelValue', id)
}

function openAssetPicker(id: string, event: MouseEvent) {
  if (props.disabled) {
    return
  }
  setActive(id)
  pickerItemId.value = id
  pickerAssetId.value = ''
  pickerAnchor.value = { x: event.clientX, y: event.clientY }
  pickerVisible.value = true
}

function cancelAssetPicker() {
  pickerVisible.value = false
  pickerAnchor.value = null
  pickerItemId.value = null
  pickerAssetId.value = ''
}

function handlePickedAsset(asset: ProjectAsset | null) {
  const id = pickerItemId.value
  pickerAssetId.value = asset?.id ?? ''
  pickerVisible.value = false
  pickerAnchor.value = null
  pickerItemId.value = null
  if (!id) {
    return
  }
  setActive(id)
  emit('apply-asset', { id, asset })
}

function handleOpenDetails(id: string) {
  if (props.disabled) {
    return
  }
  setActive(id)
  emit('open-details', id)
}

function parseAssetDragPayload(event: DragEvent): { assetId: string } | null {
  const raw = event.dataTransfer?.getData(ASSET_DRAG_MIME) ?? ''
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { assetId?: unknown }
      if (typeof parsed.assetId === 'string' && parsed.assetId.trim()) {
        return { assetId: parsed.assetId.trim() }
      }
    } catch (error) {
      console.warn('Failed to parse asset drag payload', error)
    }
  }
  const draggingId = sceneStore.draggingAssetId
  return draggingId ? { assetId: draggingId } : null
}

function resolveProjectAssetFromEvent(event: DragEvent): ProjectAsset | null {
  const payload = parseAssetDragPayload(event)
  return payload ? sceneStore.getAsset(payload.assetId) : null
}

function isMaterialAsset(asset: ProjectAsset): asset is MaterialAsset {
  return asset.type === 'material'
}

function isTextureAsset(asset: ProjectAsset): asset is TextureAsset {
  return asset.type === 'image' || asset.type === 'texture'
}

function resolveSlotAssetFromEvent(event: DragEvent): MaterialAsset | TextureAsset | null {
  const asset = resolveProjectAssetFromEvent(event)
  if (!asset) {
    return null
  }
  if (isMaterialAsset(asset) || isTextureAsset(asset)) {
    return asset
  }
  return null
}

function handleItemDragOver(id: string, event: DragEvent) {
  if (props.disabled || !resolveSlotAssetFromEvent(event)) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  dragOverItemId.value = id
  isListDragActive.value = false
}

function handleItemDragLeave(id: string, event: DragEvent) {
  if (dragOverItemId.value !== id) {
    return
  }
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (target && related && target.contains(related)) {
    return
  }
  dragOverItemId.value = null
}

function handleItemDrop(id: string, event: DragEvent) {
  const asset = resolveSlotAssetFromEvent(event)
  if (props.disabled || !asset) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  dragOverItemId.value = null
  isListDragActive.value = false
  setActive(id)
  emit('apply-asset', { id, asset })
}

function handleListDragOver(event: DragEvent) {
  const asset = resolveSlotAssetFromEvent(event)
  if (props.disabled || !props.allowListDrop || !asset) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  dragOverItemId.value = null
  isListDragActive.value = true
}

function handleListDragLeave(event: DragEvent) {
  if (!isListDragActive.value) {
    return
  }
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (target && related && target.contains(related)) {
    return
  }
  isListDragActive.value = false
}

function handleListDrop(event: DragEvent) {
  const asset = resolveSlotAssetFromEvent(event)
  if (props.disabled || !props.allowListDrop || !asset) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  dragOverItemId.value = null
  isListDragActive.value = false
  emit('apply-list-asset', asset)
}

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) {
      cancelAssetPicker()
      dragOverItemId.value = null
      isListDragActive.value = false
    }
  },
)

watch(
  () => props.items,
  (items) => {
    if (pickerItemId.value && !items.some((item) => item.id === pickerItemId.value)) {
      cancelAssetPicker()
    }
    if (dragOverItemId.value && !items.some((item) => item.id === dragOverItemId.value)) {
      dragOverItemId.value = null
    }
  },
)
</script>

<template>
  <div class="material-panel">
    <div
      class="material-panel__list"
      :class="{ 'is-drag-over': isListDragActive && !dragOverItemId }"
      @dragenter="handleListDragOver"
      @dragover="handleListDragOver"
      @dragleave="handleListDragLeave"
      @drop="handleListDrop"
    >
      <v-list density="compact" nav class="material-list">
        <v-list-item
          v-for="entry in items"
          :key="entry.id"
          :value="entry.id"
          :active="entry.id === modelValue"
          :class="{
            'is-active': entry.id === modelValue,
            'is-drag-target': dragOverItemId === entry.id,
          }"
          @click="handleOpenDetails(entry.id)"
          @dragenter="handleItemDragOver(entry.id, $event)"
          @dragover="handleItemDragOver(entry.id, $event)"
          @dragleave="handleItemDragLeave(entry.id, $event)"
          @drop="handleItemDrop(entry.id, $event)"
        >
          <template #prepend>
            <div
              class="material-color-control"
              :class="{ 'is-disabled': disabled }"
              @click.stop="openAssetPicker(entry.id, $event)"
            >
              <div
                class="material-sphere"
                :class="{ 'material-sphere--thumbnail': !!entry.thumbnail }"
                :style="entry.thumbnail
                  ? { backgroundImage: `url(${entry.thumbnail})`, backgroundColor: entry.color }
                  : { backgroundColor: entry.color }"
              />
            </div>
          </template>
          <v-list-item-title>
            {{ entry.title }}
          </v-list-item-title>
          <v-list-item-subtitle v-if="entry.subtitle">
            {{ entry.subtitle }}
          </v-list-item-subtitle>
        </v-list-item>
      </v-list>
    </div>

    <AssetPickerDialog
      v-model="pickerVisible"
      :asset-id="pickerAssetId"
      asset-type="material"
      :extensions="['material']"
      title="选择材质预置"
      :anchor="pickerAnchor"
      confirm-text="选择"
      cancel-text="取消"
      @update:asset="handlePickedAsset"
      @cancel="cancelAssetPicker"
    />
  </div>
</template>

<style scoped>
.material-panel {
  display: flex;
  gap: 12px;
}

.material-panel__list {
  width: 100%;
  min-height: 36px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.material-panel__list.is-drag-over .material-list {
  border-color: rgba(90, 148, 255, 0.55);
  box-shadow: 0 0 0 2px rgba(90, 148, 255, 0.18);
}

.material-list {
  background: rgba(16, 20, 26, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  overflow: hidden;
}

.material-list :deep(.v-list-item.is-active) {
  background: rgba(90, 148, 255, 0.14);
}

.material-list :deep(.v-list-item.is-drag-target) {
  border: 1px dashed rgba(90, 148, 255, 0.6);
  background: rgba(252, 10, 131, 0.18);
}

.material-list :deep(.v-list-item) {
  cursor: pointer;
}

.material-list :deep(.v-list-item-title) {
  min-width: 0;
}

.material-list :deep(.v-list-item-subtitle) {
  font-size: 0.68rem;
  opacity: 0.68;
  white-space: nowrap;
}

.v-list-item--density-compact.v-list-item--one-line {
  min-height: 0;
}

.v-list-item {
  padding: 4px;
}

.material-sphere {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  margin-right: 8px;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  box-shadow:
    inset -3px -3px 6px rgba(0, 0, 0, 0.3),
    inset 3px 3px 6px rgba(255, 255, 255, 0.3);
  position: relative;
  cursor: pointer;
}

.material-sphere--thumbnail {
  box-shadow:
    inset -2px -2px 5px rgba(0, 0, 0, 0.24),
    inset 2px 2px 5px rgba(255, 255, 255, 0.08);
}

.material-sphere--thumbnail::before {
  display: none;
}

.material-sphere::before {
  content: '';
  position: absolute;
  top: 15%;
  left: 25%;
  width: 35%;
  height: 35%;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.5), transparent);
}

.material-color-control {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
}

.material-color-control.is-disabled {
  pointer-events: none;
  opacity: 0.6;
}
</style>
