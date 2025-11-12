<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { cloneTextureSettings, createTextureSettings, type SceneNodeMaterial } from '@/types/material'
import type { ProjectAsset } from '@/types/project-asset'

type MaterialAsset = ProjectAsset & { type: 'material' }
type TextureAsset = ProjectAsset & { type: 'image' | 'texture' }

const props = defineProps<{
  disabled?: boolean
  activeNodeMaterialId?: string | null
}>()

const emit = defineEmits<{
  (event: 'update:active-node-material-id', id: string | null): void
  (event: 'open-details', id: string): void
  (event: 'close-details'): void
}>()

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const { selectedNode, selectedNodeId, materials } = storeToRefs(sceneStore)

const nodeMaterials = computed(() => selectedNode.value?.materials ?? [])
const internalActiveId = ref<string | null>(props.activeNodeMaterialId ?? null)
const deleteDialogVisible = ref(false)
const dragOverSlotId = ref<string | null>(null)
const isListDragActive = ref(false)
const activeColorPickerId = ref<string | null>(null)

const ASSET_DRAG_MIME = 'application/x-harmony-asset'
const DEFAULT_MATERIAL_COLOR = '#ffffff'

watch(
  () => props.activeNodeMaterialId,
  (value) => {
    internalActiveId.value = value ?? null
  },
)

watch(
  nodeMaterials,
  (list) => {
    if (!list.length) {
      if (internalActiveId.value !== null) {
        internalActiveId.value = null
        emit('update:active-node-material-id', null)
        emit('close-details')
      }
      return
    }
    if (internalActiveId.value && !list.some((entry) => entry.id === internalActiveId.value)) {
      internalActiveId.value = null
      emit('update:active-node-material-id', null)
      emit('close-details')
    }
  },
  { immediate: true },
)

const canAddMaterialSlot = computed(() => !!selectedNodeId.value && !props.disabled)
const canDeleteMaterialSlot = computed(
  () => !!selectedNodeId.value && !!internalActiveId.value && !props.disabled,
)

const deleteDialogMessage = computed(() => {
  if (!internalActiveId.value) {
    return '确认删除当前选中的材质项？此操作无法撤销。'
  }
  const entry = nodeMaterials.value.find((item) => item.id === internalActiveId.value) ?? null
  if (!entry) {
    return '确认删除当前选中的材质项？此操作无法撤销。'
  }
  if (entry.materialId) {
    return '该材质槽引用共享材质，删除后场景中使用此共享材质的对象将改为默认材质。确认继续删除？'
  }
  return '删除后该材质槽及其独立材质将被移除，操作不可撤销。确认继续删除？'
})

const materialListEntries = computed(() =>
  nodeMaterials.value.map((entry, index) => {
    const shared = entry.materialId ? materials.value.find((item) => item.id === entry.materialId) ?? null : null
    const color = normalizeHexColor(shared ? shared.color : entry.color, DEFAULT_MATERIAL_COLOR)
    return {
      id: entry.id,
      title: shared?.name ?? entry.name ?? `材质 ${index + 1}`,
      subtitle: shared ? '共享材质' : '本地材质',
      shared: Boolean(shared),
      color,
      index,
    }
  }),
)

watch(nodeMaterials, (list) => {
  if (activeColorPickerId.value && !list.some((entry) => entry.id === activeColorPickerId.value)) {
    activeColorPickerId.value = null
  }
})

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) {
      activeColorPickerId.value = null
    }
  },
)

function handleSelect(id: string) {
  internalActiveId.value = id
  emit('update:active-node-material-id', id)
  emit('open-details', id)
}

function handleAddMaterialSlot() {
  if (!canAddMaterialSlot.value || !selectedNodeId.value) {
    return
  }
  const created = sceneStore.addNodeMaterial(selectedNodeId.value) as SceneNodeMaterial | null
  if (!created) {
    return
  }
  internalActiveId.value = created.id
  emit('update:active-node-material-id', created.id)
  emit('open-details', created.id)
}

function handleRequestDeleteSlot() {
  if (!canDeleteMaterialSlot.value) {
    return
  }
  deleteDialogVisible.value = true
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

function resolveProjectAssetFromEvent(event: DragEvent): ProjectAsset | null {
  const payload = parseAssetDragPayload(event)
  if (!payload) {
    return null
  }
  const asset = sceneStore.getAsset(payload.assetId)
  if (!asset) {
    return null
  }
  return asset
}

function isMaterialAsset(asset: ProjectAsset): asset is MaterialAsset {
  return asset.type === 'material'
}

function isTextureAsset(asset: ProjectAsset): asset is TextureAsset {
  return asset.type === 'image' || asset.type === 'texture'
}

function resolveMaterialAssetFromEvent(event: DragEvent): MaterialAsset | null {
  const asset = resolveProjectAssetFromEvent(event)
  return asset && isMaterialAsset(asset) ? asset : null
}

function resolveSlotAssetFromEvent(event: DragEvent): MaterialAsset | TextureAsset | null {
  const asset = resolveProjectAssetFromEvent(event)
  if (!asset) {
    return null
  }
  if (isMaterialAsset(asset)) {
    return asset
  }
  if (isTextureAsset(asset)) {
    return asset
  }
  return null
}

function ensureEditableNodeMaterial(slotId: string): SceneNodeMaterial | null {
  if (!selectedNodeId.value) {
    return null
  }
  let entry = nodeMaterials.value.find((item) => item.id === slotId) ?? null
  if (!entry) {
    return null
  }
  if (!entry.materialId) {
    return entry
  }
  const detached = sceneStore.assignNodeMaterial(selectedNodeId.value, slotId, null)
  if (!detached) {
    return null
  }
  entry = nodeMaterials.value.find((item) => item.id === slotId) ?? null
  return entry ?? null
}

function applyAlbedoTexture(slotId: string, asset: TextureAsset): boolean {
  const editable = ensureEditableNodeMaterial(slotId)
  if (!editable || !selectedNodeId.value) {
    return false
  }
  const settings = editable.textures?.albedo?.settings
    ? cloneTextureSettings(editable.textures.albedo.settings)
    : createTextureSettings()
  sceneStore.updateNodeMaterialProps(selectedNodeId.value, slotId, {
    textures: {
      albedo: {
        assetId: asset.id,
        name: asset.name,
        settings,
      },
    },
  })
  void assetCacheStore.downloaProjectAsset(asset).catch((error: unknown) => {
    console.warn('Failed to cache texture asset', error)
  })
  return true
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  const prefixed = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(prefixed)
  if (!match) {
    return fallback
  }
  const hexValue = match[1] ?? ''
  if (hexValue.length === 3) {
    const [r, g, b] = hexValue.split('')
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return `#${hexValue.toLowerCase()}`
}

function handleColorPickerVisibility(slotId: string, visible: boolean) {
  if (visible) {
    if (!props.disabled) {
      activeColorPickerId.value = slotId
    }
    return
  }
  if (activeColorPickerId.value === slotId) {
    activeColorPickerId.value = null
  }
}

function toggleColorPicker(slotId: string) {
  if (props.disabled) {
    return
  }
  activeColorPickerId.value = activeColorPickerId.value === slotId ? null : slotId
}

function handleColorPickerInput(slotId: string, value: string | null) {
  if (typeof value !== 'string' || !selectedNodeId.value) {
    return
  }
  const editable = ensureEditableNodeMaterial(slotId)
  if (!editable) {
    return
  }
  const fallbackColor = normalizeHexColor(editable.color ?? null, DEFAULT_MATERIAL_COLOR)
  const normalized = normalizeHexColor(value, fallbackColor)
  sceneStore.updateNodeMaterialProps(selectedNodeId.value, slotId, {
    color: normalized,
  })
}

function handleSlotDragOver(slotId: string, event: DragEvent) {
  if (props.disabled || !selectedNodeId.value) {
    return
  }
  const asset = resolveSlotAssetFromEvent(event)
  if (!asset) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  dragOverSlotId.value = slotId
  isListDragActive.value = false
}

function handleSlotDragLeave(slotId: string, event: DragEvent) {
  if (dragOverSlotId.value !== slotId) {
    return
  }
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (target && related && target.contains(related)) {
    return
  }
  dragOverSlotId.value = null
}

function handleSlotDrop(slotId: string, event: DragEvent) {
  if (props.disabled || !selectedNodeId.value) {
    return
  }
  const asset = resolveProjectAssetFromEvent(event)
  if (!asset) {
    return
  }
  const materialAsset = isMaterialAsset(asset) ? asset : null
  const textureAsset = isTextureAsset(asset) ? (asset as TextureAsset) : null
  if (!materialAsset && !textureAsset) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  dragOverSlotId.value = null
  isListDragActive.value = false
  if (materialAsset) {
    const assigned = sceneStore.assignNodeMaterial(selectedNodeId.value, slotId, materialAsset.id)
    if (assigned) {
      internalActiveId.value = slotId
      emit('update:active-node-material-id', slotId)
      emit('open-details', slotId)
    }
    return
  }
  if (textureAsset) {
    const applied = applyAlbedoTexture(slotId, textureAsset)
    if (applied) {
      internalActiveId.value = slotId
      emit('update:active-node-material-id', slotId)
      emit('open-details', slotId)
    }
  }
}

function handleListDragOver(event: DragEvent) {
  if (props.disabled || !selectedNodeId.value) {
    return
  }
  const asset = resolveMaterialAssetFromEvent(event)
  if (!asset) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  dragOverSlotId.value = null
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
  if (props.disabled || !selectedNodeId.value) {
    return
  }
  const asset = resolveMaterialAssetFromEvent(event)
  if (!asset) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  dragOverSlotId.value = null
  isListDragActive.value = false
  const newSlot = sceneStore.addNodeMaterial(selectedNodeId.value) as SceneNodeMaterial | null
  if (!newSlot) {
    return
  }
  const assigned = sceneStore.assignNodeMaterial(selectedNodeId.value, newSlot.id, asset.id)
  if (assigned) {
    internalActiveId.value = newSlot.id
    emit('update:active-node-material-id', newSlot.id)
    emit('open-details', newSlot.id)
  }
}

function handleCancelDeleteSlot() {
  deleteDialogVisible.value = false
}

function handleConfirmDeleteSlot() {
  if (!selectedNodeId.value || !internalActiveId.value) {
    deleteDialogVisible.value = false
    return
  }
  const targetId = internalActiveId.value
  const targetEntry = nodeMaterials.value.find((item) => item.id === targetId) ?? null
  const sharedMaterialId = targetEntry?.materialId ?? null
  if (sharedMaterialId) {
    sceneStore.resetSharedMaterialAssignments(sharedMaterialId)
  }
  const removed = sceneStore.removeNodeMaterial(selectedNodeId.value, targetId)
  deleteDialogVisible.value = false
  if (!removed) {
    return
  }
  internalActiveId.value = null
  emit('update:active-node-material-id', null)
  emit('close-details')
}
</script>

<template>
  <v-expansion-panel value="material">
    <v-expansion-panel-title>
      <span class="material-panel-title__label">Material</span>
      <v-spacer />

        <v-btn
          icon="mdi-plus"
          size="small"
          variant="text"
          :disabled="!canAddMaterialSlot"
          @click.stop="handleAddMaterialSlot"
        />
        <v-btn
          icon="mdi-minus"
          size="small"
          variant="text"
          :disabled="!canDeleteMaterialSlot"
          @click.stop="handleRequestDeleteSlot"
        />
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="material-panel">
        <div
          class="material-panel__list"
          :class="{ 'is-drag-over': isListDragActive && !dragOverSlotId }"
          @dragenter="handleListDragOver"
          @dragover="handleListDragOver"
          @dragleave="handleListDragLeave"
          @drop="handleListDrop"
        >
          <v-list density="compact" nav class="material-list">
            <v-list-item
              v-for="entry in materialListEntries"
              :key="entry.id"
              :value="entry.id"
              :active="entry.id === internalActiveId"
              :class="{
                'is-active': entry.id === internalActiveId,
                'is-drag-target': dragOverSlotId === entry.id,
              }"
              @dragenter="handleSlotDragOver(entry.id, $event)"
              @dragover="handleSlotDragOver(entry.id, $event)"
              @dragleave="handleSlotDragLeave(entry.id, $event)"
              @drop="handleSlotDrop(entry.id, $event)"
            >
              <template #prepend>
                <div
                  class="material-color-control"
                  :class="{
                    'is-open': activeColorPickerId === entry.id,
                    'is-disabled': props.disabled,
                  }"
                  @click.stop="toggleColorPicker(entry.id)"
                >
                  <div class="material-sphere" :style="{ backgroundColor: entry.color }"></div>
                  <v-menu
                    activator="parent"
                    :model-value="activeColorPickerId === entry.id"
                    :close-on-content-click="false"
                    :open-on-click="false"
                    location="end"
                    :offset="[0, 8]"
                    @update:model-value="(value) => handleColorPickerVisibility(entry.id, Boolean(value))"
                  >
                    <div class="material-color-menu">
                      <v-color-picker
                        :model-value="entry.color"
                        mode="hex"
                        :modes="['hex']"
                        hide-inputs
                        elevation="0"
                        width="200"
                        @update:model-value="(value) => handleColorPickerInput(entry.id, value as string | null)"
                      />
                    </div>
                  </v-menu>
                </div>
              </template>
              <v-list-item-title  @click="handleSelect(entry.id)">{{ entry.title }}</v-list-item-title>
            </v-list-item>
          </v-list>
        </div>

      </div>
      <v-dialog v-model="deleteDialogVisible" max-width="360">
        <v-card>
          <v-card-title class="text-h6">删除材质槽</v-card-title>
          <v-card-text>{{ deleteDialogMessage }}</v-card-text>
          <v-card-actions class="dialog-actions">
            <v-btn variant="text" @click="handleCancelDeleteSlot">取消</v-btn>
            <v-btn color="error" variant="tonal" @click="handleConfirmDeleteSlot">删除</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.material-panel {
  display: flex;
  gap: 12px;
}

.material-panel__list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.material-panel__list.is-drag-over .material-list {
  border-color: rgba(90, 148, 255, 0.55);
  box-shadow: 0 0 0 2px rgba(90, 148, 255, 0.18);
}

.material-panel-title {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 8px;
}

.material-panel-title__label {
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: rgba(233, 236, 241, 0.82);
}

.material-panel-title__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
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

.placeholder-title {
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: rgba(233, 236, 241, 0.88);
}

.placeholder-text {
  margin: 0;
}

.placeholder-hint {
  margin: 0;
  font-size: 0.74rem;
  color: rgba(233, 236, 241, 0.55);
}

.v-list-item--density-compact.v-list-item--one-line {
  min-height: 0px;
}

.v-list-item {
    padding: 4px 4px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
}

.material-sphere {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  margin-right: 8px;
  box-shadow: 
    inset -3px -3px 6px rgba(0, 0, 0, 0.3),
    inset 3px 3px 6px rgba(255, 255, 255, 0.3);
  position: relative;
  cursor: pointer;
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

.material-color-menu {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(22, 29, 38, 0.9);
}

</style>
