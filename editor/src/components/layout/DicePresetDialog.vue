<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { useDicePresetEditorStore } from '@/stores/dicePresetEditorStore'
import { getAssetTypePresentation } from '@/utils/assetTypePresentation'
import { usesTransparentThumbnailBackground } from '@/utils/assetThumbnailTransparency'
import AssetPickerDialog from '@/components/common/AssetPickerDialog.vue'

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const dicePresetEditorStore = useDicePresetEditorStore()
const { isOpen, mode, assetId } = storeToRefs(dicePresetEditorStore)

const draftName = ref('Dice Preset')
const draftAssetIds = ref<string[]>([])
const draftSelectionIds = ref<string[]>([])
const pickerOpen = ref(false)
const pickerSelectedAssetIds = ref<string[]>([])
const pickerAnchor = ref<{ x: number; y: number } | null>(null)
const dialogError = ref<string | null>(null)
const dragSourceAssetId = ref<string | null>(null)
const dragTargetAssetId = ref<string | null>(null)
const addButtonAnchorRef = ref<HTMLElement | null>(null)

const selectedAssets = computed(() =>
  draftAssetIds.value
    .map((id) => sceneStore.getAsset(id))
    .filter((asset): asset is ProjectAsset => !!asset),
)

const canSave = computed(() => draftAssetIds.value.length > 0 && draftName.value.trim().length > 0)

function normalizeAssetIds(assetIds: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  assetIds.forEach((value) => {
    const id = typeof value === 'string' ? value.trim() : ''
    if (!id || seen.has(id)) {
      return
    }
    seen.add(id)
    normalized.push(id)
  })
  return normalized
}

function closeDialog(): void {
  dicePresetEditorStore.close()
}

function resetDraftState(): void {
  draftName.value = 'Dice Preset'
  draftAssetIds.value = []
  draftSelectionIds.value = []
  pickerSelectedAssetIds.value = []
  pickerAnchor.value = null
  dialogError.value = null
  dragSourceAssetId.value = null
  dragTargetAssetId.value = null
}

async function hydrateDraft(): Promise<void> {
  resetDraftState()
  if (!isOpen.value) {
    return
  }

  try {
    if (mode.value === 'edit' && assetId.value) {
      const preset = await sceneStore.loadDicePreset(assetId.value)
      draftName.value = preset.name?.trim().length ? preset.name.trim() : 'Dice Preset'
      draftAssetIds.value = normalizeAssetIds(
        (preset.assetRefs ?? [])
          .map((ref) => ref.assetId)
          .filter((id) => typeof id === 'string' && id.trim().length > 0),
      )
      draftSelectionIds.value = draftAssetIds.value.slice(0, 1)
      return
    }

    draftName.value = 'Dice Preset'
  } catch (error) {
    dialogError.value = error instanceof Error ? error.message : 'Failed to load Dice preset'
  }
}

async function preparePickedAsset(asset: ProjectAsset): Promise<ProjectAsset | null> {
  if (asset.type !== 'model' && asset.type !== 'mesh' && asset.type !== 'lod') {
    return null
  }

  if (asset.type === 'lod') {
    await sceneStore.prepareLodAsset(asset)
    return asset
  }

  if (!assetCacheStore.hasCache(asset.id) && !assetCacheStore.isDownloading(asset.id)) {
    await assetCacheStore.downloadProjectAsset(asset)
  }

  return asset
}

watch(
  () => [isOpen.value, mode.value, assetId.value] as const,
  async ([open]) => {
    if (!open) {
      resetDraftState()
      pickerOpen.value = false
      return
    }
    await hydrateDraft()
  },
  { immediate: true },
)

function openAssetPicker(): void {
  if (!isOpen.value) {
    return
  }
  pickerSelectedAssetIds.value = draftAssetIds.value.slice()
  const anchorElement = addButtonAnchorRef.value
  if (anchorElement) {
    const rect = anchorElement.getBoundingClientRect()
    pickerAnchor.value = {
      x: rect.right,
      y: rect.top,
    }
  }
  pickerOpen.value = true
}

function removeSelectedAssets(): void {
  if (!draftSelectionIds.value.length) {
    return
  }
  const selection = new Set(draftSelectionIds.value)
  draftAssetIds.value = draftAssetIds.value.filter((id) => !selection.has(id))
  draftSelectionIds.value = []
}

function moveAssetId(assetIdToMove: string, targetAssetId: string): void {
  const fromIndex = draftAssetIds.value.indexOf(assetIdToMove)
  const toIndex = draftAssetIds.value.indexOf(targetAssetId)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return
  }
  const next = draftAssetIds.value.slice()
  const [removed] = next.splice(fromIndex, 1)
  if (!removed) {
    return
  }
  const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex
  next.splice(adjustedToIndex, 0, removed)
  draftAssetIds.value = next
}

function handleRowDragStart(assetIdValue: string, event: DragEvent): void {
  dragSourceAssetId.value = assetIdValue
  dragTargetAssetId.value = assetIdValue
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', assetIdValue)
  }
}

function handleRowDragOver(assetIdValue: string, event: DragEvent): void {
  if (!dragSourceAssetId.value || dragSourceAssetId.value === assetIdValue) {
    return
  }
  event.preventDefault()
  dragTargetAssetId.value = assetIdValue
}

function handleRowDrop(assetIdValue: string, event: DragEvent): void {
  event.preventDefault()
  const sourceAssetId = dragSourceAssetId.value || event.dataTransfer?.getData('text/plain')?.trim() || ''
  if (!sourceAssetId || sourceAssetId === assetIdValue) {
    dragSourceAssetId.value = null
    dragTargetAssetId.value = null
    return
  }
  moveAssetId(sourceAssetId, assetIdValue)
  dragSourceAssetId.value = null
  dragTargetAssetId.value = null
}

function handleRowDragEnd(): void {
  dragSourceAssetId.value = null
  dragTargetAssetId.value = null
}

function handlePickerConfirm(assets: ProjectAsset[]): void {
  void (async () => {
    const preparedAssets: ProjectAsset[] = []
    for (const asset of assets) {
      if (asset.type !== 'model' && asset.type !== 'mesh' && asset.type !== 'lod') {
        continue
      }
      const prepared = await preparePickedAsset(asset)
      if (prepared) {
        preparedAssets.push(prepared)
      }
    }

    const nextIds = preparedAssets.map((asset) => asset.id)
    draftAssetIds.value = normalizeAssetIds([...draftAssetIds.value, ...nextIds])
    draftSelectionIds.value = []
    pickerSelectedAssetIds.value = []
    pickerOpen.value = false
  })().catch((error) => {
    dialogError.value = error instanceof Error ? error.message : 'Failed to prepare selected assets'
  })
}

function handlePickerCancel(): void {
  pickerSelectedAssetIds.value = []
  pickerOpen.value = false
}

async function saveDicePreset(): Promise<void> {
  const name = draftName.value.trim()
  if (!name.length || !draftAssetIds.value.length) {
    return
  }

  try {
    dialogError.value = null
    await sceneStore.saveDicePreset({
      name,
      assetIds: draftAssetIds.value,
      select: true,
      assetId: mode.value === 'edit' ? assetId.value : null,
    })
    closeDialog()
  } catch (error) {
    dialogError.value = error instanceof Error ? error.message : 'Failed to save Dice preset'
  }
}

function isSelected(assetIdValue: string): boolean {
  return draftSelectionIds.value.includes(assetIdValue)
}

function toggleSelected(assetIdValue: string): void {
  const next = new Set(draftSelectionIds.value)
  if (next.has(assetIdValue)) {
    next.delete(assetIdValue)
  } else {
    next.add(assetIdValue)
  }
  draftSelectionIds.value = Array.from(next)
}

function getAssetLabel(asset: ProjectAsset | null): string {
  return asset?.name?.trim().length ? asset.name.trim() : 'Unnamed Asset'
}

function getAssetThumbnailUrl(asset: ProjectAsset | null): string | null {
  if (!asset) {
    return null
  }
  return assetCacheStore.resolveAssetThumbnail({ asset })
}

function getAssetThumbnailStyle(asset: ProjectAsset | null): Record<string, string> | undefined {
  if (!asset) {
    return undefined
  }
  if (usesTransparentThumbnailBackground(asset)) {
    return undefined
  }
  return {
    backgroundColor: asset.previewColor ?? getAssetTypePresentation(asset).color,
  }
}

function getAssetInitials(asset: ProjectAsset | null): string {
  const label = getAssetLabel(asset)
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()
}
</script>

<template>
  <v-dialog v-model="dicePresetEditorStore.isOpen" max-width="860" persistent>
    <v-card class="dice-preset-dialog">
      <v-toolbar density="compact" class="dice-preset-dialog__toolbar">
        <v-toolbar-title>{{ mode === 'edit' ? 'Edit Dice' : 'Add Dice' }}</v-toolbar-title>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="closeDialog" />
      </v-toolbar>

      <v-card-text class="dice-preset-dialog__body">
        <div class="dice-preset-dialog__controls">
          <v-text-field
            v-model="draftName"
            label="Dice name"
            variant="outlined"
            density="comfortable"
            hide-details
            autofocus
          />
          <div class="dice-preset-dialog__toolbar-actions">
            <span ref="addButtonAnchorRef" class="dice-preset-dialog__add-anchor">
              <v-btn variant="tonal" color="primary" prepend-icon="mdi-plus" @click="openAssetPicker">Add</v-btn>
            </span>
            <v-btn
              variant="tonal"
              color="error"
              prepend-icon="mdi-delete-outline"
              :disabled="!draftSelectionIds.length"
              @click="removeSelectedAssets"
            >
              Delete
            </v-btn>
            <v-spacer />
            <v-btn variant="text" @click="closeDialog">Cancel</v-btn>
            <v-btn color="primary" variant="flat" :disabled="!canSave" @click="saveDicePreset">Save</v-btn>
          </div>
          <p v-if="dialogError" class="dice-preset-dialog__error">{{ dialogError }}</p>
        </div>

        <div class="dice-preset-dialog__list">
          <div v-if="selectedAssets.length" class="dice-preset-dialog__rows">
            <button
              v-for="asset in selectedAssets"
              :key="asset.id"
              type="button"
              class="dice-preset-dialog__row"
              :class="{
                'is-selected': isSelected(asset.id),
                'is-drag-source': dragSourceAssetId === asset.id,
                'is-drag-target': dragTargetAssetId === asset.id && dragSourceAssetId !== asset.id,
              }"
              draggable="true"
              @dragstart="handleRowDragStart(asset.id, $event)"
              @dragover="handleRowDragOver(asset.id, $event)"
              @drop="handleRowDrop(asset.id, $event)"
              @dragend="handleRowDragEnd"
              @click="toggleSelected(asset.id)"
            >
              <div class="dice-preset-dialog__row-thumb">
                <v-img
                  v-if="getAssetThumbnailUrl(asset)"
                  class="dice-preset-dialog__row-thumb-image"
                  :src="getAssetThumbnailUrl(asset) || undefined"
                  :alt="asset.name"
                  cover
                />
                <div
                  v-else
                  class="dice-preset-dialog__row-thumb-placeholder"
                  :style="getAssetThumbnailStyle(asset)"
                >
                  {{ getAssetInitials(asset) }}
                </div>
              </div>

              <div class="dice-preset-dialog__row-main">
                <div class="dice-preset-dialog__row-title">{{ getAssetLabel(asset) }}</div>
           
              </div>

              <v-icon class="dice-preset-dialog__drag-handle" size="18">mdi-drag-horizontal-variant</v-icon>
            </button>
          </div>
          <div v-else class="dice-preset-dialog__empty">
            Add model, mesh, or LOD assets to build this Dice preset.
          </div>
        </div>
      </v-card-text>
    </v-card>

    <AssetPickerDialog
      v-model="pickerOpen"
      multiple
      :anchor="pickerAnchor"
      title="Select Dice Assets"
      confirm-text="Add Selected"
      asset-type="model,mesh,lod"
      v-model:selected-asset-ids="pickerSelectedAssetIds"
      :show-clear-selection="false"
      @confirm="handlePickerConfirm"
      @cancel="handlePickerCancel"
    />
  </v-dialog>
</template>

<style scoped>
.dice-preset-dialog {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dice-preset-dialog__toolbar {
  background: rgba(18, 22, 28, 0.96);
}

.dice-preset-dialog__body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 18px;
}

.dice-preset-dialog__controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dice-preset-dialog__toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.dice-preset-dialog__add-anchor {
  display: inline-flex;
}

.dice-preset-dialog__list {
  min-height: 260px;
  max-height: min(60vh, 520px);
  overflow: auto;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: rgba(10, 13, 18, 0.65);
}

.dice-preset-dialog__rows {
  display: grid;
  grid-template-columns: repeat(auto-fill, 190px);
  justify-content: start;
  gap: 10px;
  padding: 12px;
}

.dice-preset-dialog__row {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  width: 190px;
  height: 190px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: inherit;
  text-align: left;
  cursor: grab;
  overflow: hidden;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

.dice-preset-dialog__row:hover {
  border-color: rgba(77, 208, 225, 0.85);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
}

.dice-preset-dialog__row.is-selected {
  border-color: rgba(77, 208, 225, 0.75);
  background: rgba(77, 208, 225, 0.1);
  box-shadow: 0 6px 18px rgba(0, 188, 212, 0.2);
}

.dice-preset-dialog__row.is-drag-source {
  opacity: 0.72;
}

.dice-preset-dialog__row.is-drag-target {
  border-color: rgba(255, 193, 7, 0.95);
  background: rgba(255, 193, 7, 0.12);
}

.dice-preset-dialog__drag-handle {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  opacity: 0.75;
  background: rgba(7, 12, 18, 0.72);
  border-radius: 999px;
  padding: 4px;
}

.dice-preset-dialog__row-thumb {
  position: relative;
  flex: 1;
  min-height: 0;
  border-radius: 10px;
  overflow: hidden;
  background: transparent;
}

.dice-preset-dialog__row-thumb-image {
  width: 100%;
  height: 100%;
}

.dice-preset-dialog__row-thumb-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 1.25rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.84);
}

.dice-preset-dialog__row-thumb-badge {
  position: absolute;
  right: 6px;
  bottom: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: rgba(8, 12, 18, 0.72);
  color: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(8px);
}

.dice-preset-dialog__row-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.dice-preset-dialog__row-title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dice-preset-dialog__row-subtitle {
  font-size: 0.8rem;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dice-preset-dialog__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 260px;
  padding: 24px;
  text-align: center;
  opacity: 0.72;
}
</style>
