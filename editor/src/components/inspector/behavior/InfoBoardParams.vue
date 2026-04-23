<script setup lang="ts">
import { computed, ref } from 'vue'
import type { InfoBoardBehaviorParams } from '@schema'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import AssetPickerDialog from '@/components/common/AssetPickerDialog.vue'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'

const props = defineProps<{
  modelValue: InfoBoardBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: InfoBoardBehaviorParams): void
}>()

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()

const contentDragActive = ref(false)
const audioDragActive = ref(false)
const assetDialogVisible = ref(false)
const assetPickerAnchor = ref<{ x: number; y: number } | null>(null)
const assetPickerTarget = ref<'content' | 'audio'>('content')

const textAssetExtensions = ['txt']
const audioAssetExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'webm']

const params = computed<InfoBoardBehaviorParams>(() => ({
  content: props.modelValue?.content ?? 'Information board content.',
  contentAssetId: props.modelValue?.contentAssetId ?? null,
  audioAssetId: props.modelValue?.audioAssetId ?? null,
}))

const contentAsset = computed<ProjectAsset | null>(() => {
  const assetId = params.value.contentAssetId?.trim()
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

const audioAsset = computed<ProjectAsset | null>(() => {
  const assetId = params.value.audioAssetId?.trim()
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

const dialogAssetId = computed(() => {
  if (assetPickerTarget.value === 'audio') {
    return params.value.audioAssetId ?? ''
  }
  return params.value.contentAssetId ?? ''
})

const dialogAssetType = computed(() => (assetPickerTarget.value === 'audio' ? 'audio' : 'file'))
const dialogExtensions = computed(() => (assetPickerTarget.value === 'audio' ? audioAssetExtensions : textAssetExtensions))
const dialogTitle = computed(() => (assetPickerTarget.value === 'audio' ? 'Select Narration Audio' : 'Select Text Asset'))
const dialogConfirmText = computed(() => (assetPickerTarget.value === 'audio' ? '选择' : '选择'))

function updateField<Key extends keyof InfoBoardBehaviorParams>(key: Key, value: InfoBoardBehaviorParams[Key]) {
  emit('update:modelValue', {
    ...params.value,
    [key]: value,
  })
}

function setContent(value: string) {
  updateField('content', value)
  if (params.value.contentAssetId) {
    updateField('contentAssetId', null)
  }
}

function setAudioAsset(assetId: string | null) {
  updateField('audioAssetId', assetId)
}

function setContentAsset(assetId: string | null) {
  updateField('contentAssetId', assetId)
}

function parseDragPayload(event: DragEvent): { assetId: string } | null {
  if (event.dataTransfer) {
    const raw = event.dataTransfer.getData(ASSET_DRAG_MIME)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { assetId?: unknown }
        if (typeof parsed?.assetId === 'string') {
          return { assetId: parsed.assetId }
        }
      } catch (error) {
        console.warn('Failed to parse drag payload', error)
      }
    }
  }
  if (sceneStore.draggingAssetId) {
    return { assetId: sceneStore.draggingAssetId }
  }
  return null
}

function ensureTextAsset(assetId: string): ProjectAsset | null {
  const asset = sceneStore.getAsset(assetId)
  if (!asset || asset.type !== 'file') {
    return null
  }
  return asset
}

function ensureAudioAsset(assetId: string): ProjectAsset | null {
  const asset = sceneStore.getAsset(assetId)
  if (!asset || asset.type !== 'audio') {
    return null
  }
  return asset
}

function isTextAssetDrag(event: DragEvent): boolean {
  const payload = parseDragPayload(event)
  if (!payload) {
    return false
  }
  return !!ensureTextAsset(payload.assetId)
}

function isAudioAssetDrag(event: DragEvent): boolean {
  const payload = parseDragPayload(event)
  if (!payload) {
    return false
  }
  return !!ensureAudioAsset(payload.assetId)
}

function handleContentDragEnter(event: DragEvent) {
  if (!isTextAssetDrag(event)) {
    return
  }
  event.preventDefault()
  contentDragActive.value = true
}

function handleContentDragOver(event: DragEvent) {
  if (!isTextAssetDrag(event)) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  contentDragActive.value = true
}

function handleContentDragLeave(event: DragEvent) {
  if (!isTextAssetDrag(event)) {
    return
  }
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (target && related && target.contains(related)) {
    return
  }
  contentDragActive.value = false
}

function handleContentDrop(event: DragEvent) {
  if (!isTextAssetDrag(event)) {
    return
  }
  const payload = parseDragPayload(event)
  if (!payload) {
    return
  }
  const asset = ensureTextAsset(payload.assetId)
  if (!asset) {
    console.warn('Dragged asset is not a compatible text resource')
    return
  }
  event.preventDefault()
  event.stopPropagation()
  contentDragActive.value = false
  setContentAsset(asset.id)
  void assetCacheStore.downloadProjectAsset(asset).catch((error: unknown) => {
    console.warn('Failed to cache info board text asset', error)
  })
}

function handleAudioDragEnter(event: DragEvent) {
  if (!isAudioAssetDrag(event)) {
    return
  }
  event.preventDefault()
  audioDragActive.value = true
}

function handleAudioDragOver(event: DragEvent) {
  if (!isAudioAssetDrag(event)) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  audioDragActive.value = true
}

function handleAudioDragLeave(event: DragEvent) {
  if (!isAudioAssetDrag(event)) {
    return
  }
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (target && related && target.contains(related)) {
    return
  }
  audioDragActive.value = false
}

function handleAudioDrop(event: DragEvent) {
  if (!isAudioAssetDrag(event)) {
    return
  }
  const payload = parseDragPayload(event)
  if (!payload) {
    return
  }
  const asset = ensureAudioAsset(payload.assetId)
  if (!asset) {
    console.warn('Dragged asset is not a compatible audio resource')
    return
  }
  event.preventDefault()
  event.stopPropagation()
  audioDragActive.value = false
  setAudioAsset(asset.id)
  void assetCacheStore.downloadProjectAsset(asset).catch((error: unknown) => {
    console.warn('Failed to cache info board audio asset', error)
  })
}

function clearContentAsset() {
  setContentAsset(null)
}

function clearAudioAsset() {
  setAudioAsset(null)
}

function openAssetDialog(kind: 'content' | 'audio', event?: MouseEvent) {
  assetPickerTarget.value = kind
  if (event) {
    const target = event.currentTarget as HTMLElement | null
    const rect = target?.getBoundingClientRect()
    if (rect) {
      assetPickerAnchor.value = {
        x: rect.left + rect.width / 2,
        y: rect.bottom + 8,
      }
    }
  }
  assetDialogVisible.value = true
}

function handleAssetDialogUpdate(asset: ProjectAsset | null) {
  if (assetPickerTarget.value === 'audio') {
    setAudioAsset(asset?.id ?? null)
  } else {
    setContentAsset(asset?.id ?? null)
  }
  assetDialogVisible.value = false
}

function handleAssetDialogCancel() {
  assetDialogVisible.value = false
}
</script>

<template>
  <div class="info-board-params">
    <section
      class="info-board-params__section"
      :class="{
        'is-active-drop': contentDragActive,
        'has-asset': !!params.contentAssetId,
      }"
      @dragenter="handleContentDragEnter"
      @dragover="handleContentDragOver"
      @dragleave="handleContentDragLeave"
      @drop="handleContentDrop"
    >
      <div class="info-board-params__section-header">
        <div>
          <div class="info-board-params__section-title">Display Content</div>
          <div class="info-board-params__section-hint">Type text directly, drop a .txt asset, or pick one from the library.</div>
        </div>
        <v-btn variant="text" size="small" prepend-icon="mdi-folder-text" @click="openAssetDialog('content', $event)">
          Choose TXT
        </v-btn>
      </div>
      <v-textarea
        :model-value="params.content"
        class="info-board-params__textarea"
        label="Board Content"
        rows="4"
        auto-grow
        density="compact"
        variant="underlined"
        :placeholder="params.contentAssetId ? 'Text asset is linked, but you can still edit manually' : 'Type or drop board text here'"
        @update:model-value="setContent($event ?? '')"
      />
      <div v-if="params.contentAssetId" class="info-board-params__asset-row">
        <div class="info-board-params__asset-info">
          <v-icon icon="mdi-file-document-outline" size="18" />
          <span class="info-board-params__asset-name">{{ contentAsset?.name ?? params.contentAssetId }}</span>
        </div>
        <v-btn icon="mdi-close" size="x-small" variant="text" @click.stop="clearContentAsset" />
      </div>
    </section>

    <section
      class="info-board-params__section"
      :class="{
        'is-active-drop': audioDragActive,
        'has-asset': !!params.audioAssetId,
      }"
      @dragenter="handleAudioDragEnter"
      @dragover="handleAudioDragOver"
      @dragleave="handleAudioDragLeave"
      @drop="handleAudioDrop"
    >
      <div class="info-board-params__section-header">
        <div>
          <div class="info-board-params__section-title">Narration Audio</div>
          <div class="info-board-params__section-hint">Optional audio that starts with the board and stops when it hides.</div>
        </div>
        <v-btn variant="text" size="small" prepend-icon="mdi-music-note-plus" @click="openAssetDialog('audio', $event)">
          Choose Audio
        </v-btn>
      </div>
      <div v-if="params.audioAssetId" class="info-board-params__asset-row">
        <div class="info-board-params__asset-info">
          <v-icon icon="mdi-volume-high" size="18" />
          <span class="info-board-params__asset-name">{{ audioAsset?.name ?? params.audioAssetId }}</span>
        </div>
        <v-btn icon="mdi-close" size="x-small" variant="text" @click.stop="clearAudioAsset" />
      </div>
      <div v-else class="info-board-params__empty-hint">Drop an audio file here or choose one from the asset library.</div>
    </section>

    <AssetPickerDialog
      v-model="assetDialogVisible"
      :asset-id="dialogAssetId"
      :asset-type="dialogAssetType"
      :extensions="dialogExtensions"
      :title="dialogTitle"
      :confirm-text="dialogConfirmText"
      cancel-text="取消"
      :anchor="assetPickerAnchor"
      @update:asset="handleAssetDialogUpdate"
      @cancel="handleAssetDialogCancel"
    />
  </div>
</template>

<style scoped>
.info-board-params {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.info-board-params__section {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 0.85rem;
  border-radius: 0.9rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.025);
  transition: border-color 0.18s ease, background-color 0.18s ease;
}

.info-board-params__section.is-active-drop {
  border-color: rgba(123, 168, 255, 0.65);
  background: rgba(123, 168, 255, 0.12);
}

.info-board-params__section.has-asset {
  border-color: rgba(233, 236, 241, 0.16);
}

.info-board-params__section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.info-board-params__section-title {
  font-size: 0.95rem;
  font-weight: 600;
}

.info-board-params__section-hint {
  margin-top: 0.2rem;
  font-size: 0.82rem;
  color: rgba(233, 236, 241, 0.68);
}

.info-board-params__textarea {
  margin-top: 0.1rem;
}

.info-board-params__asset-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.55rem 0.7rem;
  border-radius: 0.7rem;
  background: rgba(255, 255, 255, 0.03);
}

.info-board-params__asset-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.info-board-params__asset-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info-board-params__empty-hint {
  font-size: 0.84rem;
  color: rgba(233, 236, 241, 0.6);
}
</style>
