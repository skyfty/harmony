<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type {
  BubbleBehaviorAnchorMode,
  BubbleBehaviorAnimationPreset,
  BubbleBehaviorParams,
  BubbleBehaviorVariant,
} from '@schema'
import NodePicker from '@/components/common/NodePicker.vue'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'

const props = defineProps<{
  modelValue: BubbleBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: BubbleBehaviorParams): void
  (event: 'pick-state-change', value: boolean): void
}>()

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()

const isContentDragActive = ref(false)
const pickerRef = ref<{ cancelPicking: () => void } | null>(null)

const variantOptions: Array<{ title: string; value: BubbleBehaviorVariant }> = [
  { title: 'Info', value: 'info' },
  { title: 'Success', value: 'success' },
  { title: 'Warning', value: 'warning' },
  { title: 'Danger', value: 'danger' },
]

const animationOptions: Array<{ title: string; value: BubbleBehaviorAnimationPreset }> = [
  { title: 'Fade', value: 'fade' },
  { title: 'Float Up', value: 'float' },
  { title: 'Scale Pop', value: 'scale' },
  { title: 'Shake', value: 'shake' },
]

const anchorModeOptions: Array<{ title: string; value: BubbleBehaviorAnchorMode }> = [
  { title: 'Screen Fixed', value: 'screenFixed' },
  { title: 'Node Anchored', value: 'nodeAnchored' },
]

const params = computed<BubbleBehaviorParams>(() => ({
  content: props.modelValue?.content ?? 'Prompt message',
  contentAssetId: props.modelValue?.contentAssetId ?? null,
  durationSeconds: Math.max(0, props.modelValue?.durationSeconds ?? 2.5),
  delaySeconds: Math.max(0, props.modelValue?.delaySeconds ?? 0),
  anchorMode: props.modelValue?.anchorMode ?? 'screenFixed',
  targetNodeId: props.modelValue?.targetNodeId ?? null,
  repeat: props.modelValue?.repeat ?? true,
  maxDistanceMeters: Math.max(0, props.modelValue?.maxDistanceMeters ?? 0),
  styleVariant: props.modelValue?.styleVariant ?? 'info',
  animationPreset: props.modelValue?.animationPreset ?? 'float',
  screenOffsetX: Number.isFinite(props.modelValue?.screenOffsetX) ? props.modelValue?.screenOffsetX ?? 0 : 0,
  screenOffsetY: Number.isFinite(props.modelValue?.screenOffsetY) ? props.modelValue?.screenOffsetY ?? -12 : -12,
  worldOffsetY: Number.isFinite(props.modelValue?.worldOffsetY) ? props.modelValue?.worldOffsetY ?? 1.6 : 1.6,
  requireVisibleInView: props.modelValue?.requireVisibleInView ?? true,
}))

const contentAsset = computed<ProjectAsset | null>(() => {
  const assetId = params.value.contentAssetId?.trim()
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

function updateField<Key extends keyof BubbleBehaviorParams>(key: Key, value: BubbleBehaviorParams[Key]) {
  emit('update:modelValue', {
    ...params.value,
    [key]: value,
  })
}

function updateNumberField<Key extends 'durationSeconds' | 'delaySeconds' | 'maxDistanceMeters' | 'screenOffsetX' | 'screenOffsetY' | 'worldOffsetY'>(
  key: Key,
  value: string | number,
) {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(value)
  const normalized = Number.isFinite(numeric)
    ? (key === 'worldOffsetY' || key === 'screenOffsetX' || key === 'screenOffsetY' ? numeric : Math.max(0, numeric))
    : params.value[key]
  updateField(key, normalized as BubbleBehaviorParams[Key])
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
  updateField('contentAssetId', null)
}

function handleTargetChange(nodeId: string | null) {
  updateField('targetNodeId', nodeId)
}

function handlePickStateChange(active: boolean) {
  emit('pick-state-change', active)
}

function cancelPicking() {
  pickerRef.value?.cancelPicking()
}

defineExpose({ cancelPicking })

onBeforeUnmount(() => {
  cancelPicking()
})

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
  updateField('contentAssetId', asset.id)
  void assetCacheStore.downloadProjectAsset(asset).catch((error: unknown) => {
    console.warn('Failed to cache bubble text asset', error)
  })
}
</script>

<template>
  <div class="bubble-params">
    <div
      class="bubble-params__content"
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
        :model-value="params.content"
        label="Bubble Text"
        rows="3"
        density="compact"
        variant="underlined"
        auto-grow
        :readonly="!!params.contentAssetId"
        :placeholder="
          params.contentAssetId
            ? 'Bubble text is linked to a text asset'
            : 'Type bubble text or drop a text asset'
        "
        @update:model-value="updateField('content', $event ?? 'Prompt message')"
      />
      <div v-if="params.contentAssetId" class="bubble-params__asset">
        <div class="bubble-params__asset-info">
          <v-icon icon="mdi-file-document-outline" size="18" />
          <span class="bubble-params__asset-name">{{ contentAsset?.name ?? params.contentAssetId }}</span>
        </div>
        <v-btn
          class="bubble-params__asset-clear"
          icon="mdi-close"
          size="x-small"
          variant="text"
          @click.stop="clearContentAsset"
        />
      </div>
    </div>

    <div class="bubble-params__grid">
      <v-text-field
        :model-value="params.durationSeconds"
        type="number"
        label="Display Duration (s)"
        density="compact"
        variant="underlined"
        hide-details
        min="0"
        step="0.1"
        @update:model-value="updateNumberField('durationSeconds', $event)"
      />
      <v-text-field
        :model-value="params.delaySeconds"
        type="number"
        label="Delay Before Show (s)"
        density="compact"
        variant="underlined"
        hide-details
        min="0"
        step="0.1"
        @update:model-value="updateNumberField('delaySeconds', $event)"
      />
      <v-text-field
        :model-value="params.maxDistanceMeters"
        type="number"
        label="Max Distance (m)"
        density="compact"
        variant="underlined"
        hide-details
        min="0"
        step="0.5"
        @update:model-value="updateNumberField('maxDistanceMeters', $event)"
      />
      <v-select
        :model-value="params.anchorMode"
        :items="anchorModeOptions"
        label="Anchor Mode"
        density="compact"
        variant="underlined"
        hide-details
        item-title="title"
        item-value="value"
        @update:model-value="updateField('anchorMode', ($event ?? 'screenFixed') as BubbleBehaviorAnchorMode)"
      />
      <v-select
        :model-value="params.styleVariant"
        :items="variantOptions"
        label="Style Variant"
        density="compact"
        variant="underlined"
        hide-details
        item-title="title"
        item-value="value"
        @update:model-value="updateField('styleVariant', ($event ?? 'info') as BubbleBehaviorVariant)"
      />
      <v-select
        :model-value="params.animationPreset"
        :items="animationOptions"
        label="Animation Preset"
        density="compact"
        variant="underlined"
        hide-details
        item-title="title"
        item-value="value"
        @update:model-value="updateField('animationPreset', ($event ?? 'float') as BubbleBehaviorAnimationPreset)"
      />
      <div class="bubble-params__toggle-row">
        <v-checkbox
          :model-value="params.repeat"
          label="Repeat Prompt"
          density="compact"
          hide-details
          @update:model-value="updateField('repeat', Boolean($event))"
        />
        <v-checkbox
          :model-value="params.requireVisibleInView"
          label="Only Show In View"
          density="compact"
          hide-details
          @update:model-value="updateField('requireVisibleInView', Boolean($event))"
        />
      </div>
    </div>

    <NodePicker
      v-if="params.anchorMode === 'nodeAnchored'"
      ref="pickerRef"
      :model-value="params.targetNodeId"
      pick-hint="Select the node used as the bubble anchor"
      placeholder="Use the behavior owner node"
      selection-hint="Choose a node to project the bubble above it. Leave empty to anchor to the script owner node."
      @update:modelValue="handleTargetChange"
      @pick-state-change="handlePickStateChange"
    />

    <div class="bubble-params__offset-grid">
      <v-text-field
        :model-value="params.screenOffsetX"
        type="number"
        label="Screen Offset X (px)"
        density="compact"
        variant="underlined"
        hide-details
        step="1"
        @update:model-value="updateNumberField('screenOffsetX', $event)"
      />
      <v-text-field
        :model-value="params.screenOffsetY"
        type="number"
        label="Screen Offset Y (px)"
        density="compact"
        variant="underlined"
        hide-details
        step="1"
        @update:model-value="updateNumberField('screenOffsetY', $event)"
      />
      <v-text-field
        :model-value="params.worldOffsetY"
        type="number"
        label="World Offset Y"
        density="compact"
        variant="underlined"
        hide-details
        step="0.1"
        @update:model-value="updateNumberField('worldOffsetY', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.bubble-params {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.bubble-params__content {
  margin-top: 20px;
  padding: 4px;
  border-radius: 12px;
  border: 1px solid transparent;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.bubble-params__content.has-asset {
  border-color: rgba(233, 236, 241, 0.16);
  background: rgba(233, 236, 241, 0.04);
}

.bubble-params__content.is-active-drop {
  border-color: rgba(123, 168, 255, 0.65);
  background: rgba(123, 168, 255, 0.12);
}

.bubble-params__asset {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.2rem;
  padding: 0.35rem 0.4rem;
}

.bubble-params__asset-info {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}

.bubble-params__asset-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.86rem;
}

.bubble-params__grid,
.bubble-params__offset-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem 1rem;
}

.bubble-params__offset-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.bubble-params__toggle-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
}

@media (max-width: 720px) {
  .bubble-params__grid,
  .bubble-params__offset-grid {
    grid-template-columns: 1fr;
  }
}
</style>