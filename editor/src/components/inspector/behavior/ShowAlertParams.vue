<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ShowAlertBehaviorParams } from '@harmony/schema'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'

const props = defineProps<{
  modelValue: ShowAlertBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: ShowAlertBehaviorParams): void
}>()

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()

const isContentDragActive = ref(false)

const params = computed<ShowAlertBehaviorParams>(() => ({
  content: props.modelValue?.content ?? '',
  contentAssetId: props.modelValue?.contentAssetId ?? null,
  showConfirm: props.modelValue?.showConfirm ?? true,
  confirmText: props.modelValue?.confirmText ?? 'Confirm',
  showCancel: props.modelValue?.showCancel ?? false,
  cancelText: props.modelValue?.cancelText ?? 'Cancel',
}))

const contentAsset = computed<ProjectAsset | null>(() => {
  const assetId = params.value.contentAssetId?.trim()
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

function updateField<Key extends keyof ShowAlertBehaviorParams>(key: Key, value: ShowAlertBehaviorParams[Key]) {
  emit('update:modelValue', {
    ...params.value,
    [key]: value,
  })
}

function updateContentAsset(assetId: string | null) {
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

function isTextAssetDrag(event: DragEvent): boolean {
  const payload = parseDragPayload(event)
  if (!payload) {
    return false
  }
  return !!ensureTextAsset(payload.assetId)
}

function handleContentDragEnter(event: DragEvent) {
  if (!isTextAssetDrag(event)) {
    return
  }
  event.preventDefault()
  isContentDragActive.value = true
}

function handleContentDragOver(event: DragEvent) {
  if (!isTextAssetDrag(event)) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  isContentDragActive.value = true
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
  isContentDragActive.value = false
}

function clearContentAsset() {
  updateContentAsset(null)
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
  isContentDragActive.value = false
  updateContentAsset(asset.id)
  void assetCacheStore.downloaProjectAsset(asset).catch((error: unknown) => {
    console.warn('Failed to cache alert text asset', error)
  })
}
</script>

<template>
  <div class="show-alert-params">
    <div
      class="show-alert-params__content"
      :class="{
        'is-active-drop': isContentDragActive,
        'has-asset': !!params.contentAssetId,
      }"
      @dragenter="handleContentDragEnter"
      @dragover="handleContentDragOver"
      @dragleave="handleContentDragLeave"
      @drop="handleContentDrop"
    >
      <v-textarea
        class="alert-message"
        :model-value="params.content"
        label="Alert Message"
        rows="3"
        density="compact"
        variant="underlined"
        auto-grow
        :readonly="!!params.contentAssetId"
        :placeholder="
          params.contentAssetId
            ? 'Alert message is linked to a text asset'
            : 'Type alert message or drop a text asset'
        "
  @update:model-value="updateField('content', $event ?? '')"
      />
      <div
        v-if="params.contentAssetId"
        class="show-alert-params__asset"
      >
        <div class="show-alert-params__asset-info">
          <v-icon icon="mdi-file-document-outline" size="18" />
          <span class="show-alert-params__asset-name">{{ contentAsset?.name ?? params.contentAssetId }}</span>
        </div>
        <v-btn
          class="show-alert-params__asset-clear"
          icon="mdi-close"
          size="x-small"
          variant="text"
          @click.stop="clearContentAsset"
        />
      </div>
    </div>
    <div class="show-alert-params__toggles">
      <div class="show-alert-params__row">
        <v-checkbox
          :model-value="params.showConfirm"
          label="Show Confirm Button"
          density="compact"
          hide-details
    @update:model-value="updateField('showConfirm', Boolean($event))"
        />
        <v-text-field
          v-if="params.showConfirm"
          :model-value="params.confirmText"
          label="Confirm Button Text"
          density="compact"
          variant="underlined"
          hide-details
    @update:model-value="updateField('confirmText', $event ?? '')"
        />
      </div>
      <div class="show-alert-params__row">
        <v-checkbox
          :model-value="params.showCancel"
          label="Show Cancel Button"
          density="compact"
          hide-details
    @update:model-value="updateField('showCancel', Boolean($event))"
        />
        <v-text-field
          v-if="params.showCancel"
          :model-value="params.cancelText"
          label="Cancel Button Text"
          density="compact"
          variant="underlined"
          hide-details
    @update:model-value="updateField('cancelText', $event ?? '')"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.show-alert-params {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  /* Fixed width for the checkbox/label column to keep rows aligned */
  --label-col-width: 220px;
}

.show-alert-params__content {
  margin-top: 20px;
  padding: 4px;
  border-radius: 12px;
  border: 1px solid transparent;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.show-alert-params__content.has-asset {
  border-color: rgba(233, 236, 241, 0.16);
  background: rgba(233, 236, 241, 0.04);
}

.show-alert-params__content.is-active-drop {
  border-color: rgba(123, 168, 255, 0.65);
  background: rgba(123, 168, 255, 0.12);
}

.alert-message {
  margin-top: 0;
  --v-textarea-padding-top: 0;
  --v-textarea-padding-bottom: 0;
}

.show-alert-params__toggles {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.show-alert-params__row {
  display: grid;
  grid-template-columns: var(--label-col-width) 1fr;
  align-items: center;
  gap: 0.5rem;
}

.show-alert-params__asset {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(233, 236, 241, 0.08);
}

.show-alert-params__asset-info {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: rgba(233, 236, 241, 0.82);
  font-size: 0.9rem;
}

.show-alert-params__asset-name {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.show-alert-params__asset-clear {
  color: rgba(233, 236, 241, 0.7);
}

.show-alert-params :deep(.v-input--density-compact) {
  --v-input-padding-top: 0;
  --v-input-padding-bottom: 0;
}

/* Prevent long checkbox labels from shifting layout; truncate with ellipsis */
.show-alert-params__row :deep(.v-selection-control__label) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
}
</style>
