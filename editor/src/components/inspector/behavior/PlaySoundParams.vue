<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type {
  PlaySoundBehaviorParams,
  SoundBehaviorCommand,
  SoundPlaybackMode,
} from '@schema'
import AssetPickerDialog from '@/components/common/AssetPickerDialog.vue'
import NodePicker from '@/components/common/NodePicker.vue'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'

const props = defineProps<{
  modelValue: PlaySoundBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: PlaySoundBehaviorParams): void
  (event: 'pick-state-change', value: boolean): void
}>()

const sceneStore = useSceneStore()
const pickerRef = ref<{ cancelPicking: () => void } | null>(null)
const assetDialogVisible = ref(false)
const assetPickerAnchor = ref<{ x: number; y: number } | null>(null)

const commandOptions: Array<{ title: string; value: SoundBehaviorCommand }> = [
  { title: 'Play', value: 'play' },
  { title: 'Stop', value: 'stop' },
]

const playbackModeOptions: Array<{ title: string; value: SoundPlaybackMode }> = [
  { title: 'Once', value: 'once' },
  { title: 'Loop', value: 'loop' },
  { title: 'Random Interval', value: 'interval' },
]

const params = computed<PlaySoundBehaviorParams>(() => ({
  assetId: props.modelValue?.assetId ?? null,
  command: props.modelValue?.command ?? 'play',
  instanceKey: props.modelValue?.instanceKey ?? null,
  targetNodeId: props.modelValue?.targetNodeId ?? null,
  spatial: props.modelValue?.spatial ?? false,
  playbackMode: props.modelValue?.playbackMode ?? 'once',
  volume: Math.min(1, Math.max(0, props.modelValue?.volume ?? 1)),
  playbackRate: Math.max(0.25, props.modelValue?.playbackRate ?? 1),
  detuneCents: Number.isFinite(props.modelValue?.detuneCents) ? props.modelValue?.detuneCents ?? 0 : 0,
  startDelaySeconds: Math.max(0, props.modelValue?.startDelaySeconds ?? 0),
  durationSeconds: Math.max(0, props.modelValue?.durationSeconds ?? 0),
  fadeInSeconds: Math.max(0, props.modelValue?.fadeInSeconds ?? 0),
  fadeOutSeconds: Math.max(0, props.modelValue?.fadeOutSeconds ?? 0),
  minIntervalSeconds: Math.max(0, props.modelValue?.minIntervalSeconds ?? 4),
  maxIntervalSeconds: Math.max(props.modelValue?.minIntervalSeconds ?? 4, props.modelValue?.maxIntervalSeconds ?? 12),
  maxDistanceMeters: Math.max(0, props.modelValue?.maxDistanceMeters ?? 20),
  refDistanceMeters: Math.max(0, props.modelValue?.refDistanceMeters ?? 1.5),
  rolloffFactor: Math.max(0, props.modelValue?.rolloffFactor ?? 1),
  waitForCompletion: props.modelValue?.command === 'play' && props.modelValue?.playbackMode === 'once'
    ? props.modelValue?.waitForCompletion ?? false
    : false,
}))

const selectedAsset = computed<ProjectAsset | null>(() => {
  const assetId = params.value.assetId?.trim()
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

const audioAssetExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'webm']

const isStopCommand = computed(() => params.value.command === 'stop')
const showsPlaybackControls = computed(() => !isStopCommand.value)
const showsIntervalControls = computed(() => showsPlaybackControls.value && params.value.playbackMode === 'interval')
const showsWaitToggle = computed(() => showsPlaybackControls.value && params.value.playbackMode === 'once')
const showsSpatialControls = computed(() => showsPlaybackControls.value && params.value.spatial)

function updateParams(next: PlaySoundBehaviorParams) {
  emit('update:modelValue', next)
}

function updateField<Key extends keyof PlaySoundBehaviorParams>(key: Key, value: PlaySoundBehaviorParams[Key]) {
  updateParams({
    ...params.value,
    [key]: value,
  })
}

function updateNumberField<Key extends keyof PlaySoundBehaviorParams>(key: Key, value: string | number) {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const normalized = (() => {
    switch (key) {
      case 'volume':
        return Math.min(1, Math.max(0, numeric))
      case 'playbackRate':
        return Math.min(4, Math.max(0.25, numeric))
      case 'detuneCents':
        return Math.min(2400, Math.max(-2400, numeric))
      case 'maxIntervalSeconds':
        return Math.max(params.value.minIntervalSeconds, numeric)
      case 'minIntervalSeconds':
        return Math.max(0, numeric)
      default:
        return Math.max(0, numeric)
    }
  })()
  updateField(key, normalized as PlaySoundBehaviorParams[Key])
}

function updateCommand(command: SoundBehaviorCommand) {
  updateParams({
    ...params.value,
    command,
    waitForCompletion: command === 'play' && params.value.playbackMode === 'once'
      ? params.value.waitForCompletion
      : false,
  })
}

function updatePlaybackMode(playbackMode: SoundPlaybackMode) {
  updateParams({
    ...params.value,
    playbackMode,
    waitForCompletion: params.value.command === 'play' && playbackMode === 'once'
      ? params.value.waitForCompletion
      : false,
  })
}

function updateSpatial(spatial: boolean) {
  updateParams({
    ...params.value,
    spatial,
    targetNodeId: spatial ? params.value.targetNodeId : null,
  })
}

function openAssetDialog(event?: MouseEvent) {
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
  updateField('assetId', asset?.id ?? null)
  assetDialogVisible.value = false
}

function handleAssetDialogCancel() {
  assetDialogVisible.value = false
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
</script>

<template>
  <div class="play-sound-params">
    <div class="play-sound-params__asset">
  
      <button class="play-sound-params__asset-name" type="button" @click="openAssetDialog">
        <v-icon icon="mdi-music-note-outline" size="18" />
        <span>{{ selectedAsset?.name ?? params.assetId ?? 'No audio asset selected' }}</span>
      </button>
    </div>

    <div class="play-sound-params__grid">
      <v-select
        :model-value="params.command"
        :items="commandOptions"
        label="Command"
        density="compact"
        variant="underlined"
        hide-details
        item-title="title"
        item-value="value"
        @update:model-value="updateCommand(($event ?? 'play') as SoundBehaviorCommand)"
      />
      <v-text-field
        :model-value="params.instanceKey ?? ''"
        label="Instance Key"
        density="compact"
        variant="underlined"
        hide-details
        placeholder="water-ambient"
        @update:model-value="updateField('instanceKey', (($event ?? '').trim() || null) as string | null)"
      />
      <v-select
        v-if="showsPlaybackControls"
        :model-value="params.playbackMode"
        :items="playbackModeOptions"
        label="Playback Mode"
        density="compact"
        variant="underlined"
        hide-details
        item-title="title"
        item-value="value"
        @update:model-value="updatePlaybackMode(($event ?? 'once') as SoundPlaybackMode)"
      />
      <v-checkbox
        v-if="showsPlaybackControls"
        :model-value="params.spatial"
        label="Spatial Audio"
        density="compact"
        hide-details
        @update:model-value="updateSpatial(Boolean($event))"
      />
    </div>

    <NodePicker
      v-if="showsSpatialControls"
      ref="pickerRef"
      :model-value="params.targetNodeId"
      pick-hint="Select the node used as the audio source"
      placeholder="未选择节点"
      selection-hint="空间音频会跟随这个节点的位置。"
      @update:modelValue="handleTargetChange"
      @pick-state-change="handlePickStateChange"
    />

    <div v-if="showsPlaybackControls" class="play-sound-params__grid">
      <v-text-field
        :model-value="params.volume"
        type="number"
        label="Volume"
        density="compact"
        variant="underlined"
        hide-details
        min="0"
        max="1"
        step="0.05"
        @update:model-value="updateNumberField('volume', $event)"
      />
      <v-text-field
        :model-value="params.playbackRate"
        type="number"
        label="Playback Rate"
        density="compact"
        variant="underlined"
        hide-details
        min="0.25"
        max="4"
        step="0.05"
        @update:model-value="updateNumberField('playbackRate', $event)"
      />
      <v-text-field
        :model-value="params.detuneCents"
        type="number"
        label="Detune (cents)"
        density="compact"
        variant="underlined"
        hide-details
        min="-2400"
        max="2400"
        step="50"
        @update:model-value="updateNumberField('detuneCents', $event)"
      />
      <v-text-field
        :model-value="params.startDelaySeconds"
        type="number"
        label="Start Delay (s)"
        density="compact"
        variant="underlined"
        hide-details
        min="0"
        step="0.1"
        @update:model-value="updateNumberField('startDelaySeconds', $event)"
      />
      <v-text-field
        :model-value="params.durationSeconds"
        type="number"
        label="Duration Limit (s)"
        density="compact"
        variant="underlined"
        hide-details
        min="0"
        step="0.1"
        @update:model-value="updateNumberField('durationSeconds', $event)"
      />
      <v-text-field
        :model-value="params.fadeInSeconds"
        type="number"
        label="Fade In (s)"
        density="compact"
        variant="underlined"
        hide-details
        min="0"
        step="0.1"
        @update:model-value="updateNumberField('fadeInSeconds', $event)"
      />
      <v-text-field
        :model-value="params.fadeOutSeconds"
        type="number"
        label="Fade Out (s)"
        density="compact"
        variant="underlined"
        hide-details
        min="0"
        step="0.1"
        @update:model-value="updateNumberField('fadeOutSeconds', $event)"
      />
      <v-checkbox
        v-if="showsWaitToggle"
        :model-value="params.waitForCompletion"
        label="Wait For Completion"
        density="compact"
        hide-details
        @update:model-value="updateField('waitForCompletion', Boolean($event))"
      />
    </div>

    <div v-if="showsIntervalControls" class="play-sound-params__grid">
      <v-text-field
        :model-value="params.minIntervalSeconds"
        type="number"
        label="Min Interval (s)"
        density="compact"
        variant="underlined"
        hide-details
        min="0"
        step="0.1"
        @update:model-value="updateNumberField('minIntervalSeconds', $event)"
      />
      <v-text-field
        :model-value="params.maxIntervalSeconds"
        type="number"
        label="Max Interval (s)"
        density="compact"
        variant="underlined"
        hide-details
        min="0"
        step="0.1"
        @update:model-value="updateNumberField('maxIntervalSeconds', $event)"
      />
    </div>

    <div v-if="showsSpatialControls" class="play-sound-params__grid">
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
      <v-text-field
        :model-value="params.refDistanceMeters"
        type="number"
        label="Reference Distance (m)"
        density="compact"
        variant="underlined"
        hide-details
        min="0"
        step="0.1"
        @update:model-value="updateNumberField('refDistanceMeters', $event)"
      />
      <v-text-field
        :model-value="params.rolloffFactor"
        type="number"
        label="Rolloff Factor"
        density="compact"
        variant="underlined"
        hide-details
        min="0"
        step="0.1"
        @update:model-value="updateNumberField('rolloffFactor', $event)"
      />
    </div>

    <AssetPickerDialog
      v-model="assetDialogVisible"
      :asset-id="params.assetId ?? ''"
      asset-type="audio"
      :extensions="audioAssetExtensions"
      title="Select Sound Asset"
      confirm-text="选择"
      cancel-text="取消"
      :anchor="assetPickerAnchor"
      @update:asset="handleAssetDialogUpdate"
      @cancel="handleAssetDialogCancel"
    />
  </div>
</template>

<style scoped>
.play-sound-params {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.play-sound-params__asset {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.75rem;
  border: 1px dashed rgba(255, 255, 255, 0.18);
  border-radius: 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  transition: border-color 0.18s ease, background-color 0.18s ease;
}

.play-sound-params__asset.is-active-drop {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}

.play-sound-params__asset.has-asset {
  border-style: solid;
}

.play-sound-params__asset-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.play-sound-params__asset-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.1rem;
}

.play-sound-params__label {
  font-size: 0.82rem;
  font-weight: 600;
}

.play-sound-params__hint {
  font-size: 0.72rem;
  opacity: 0.65;
}

.play-sound-params__asset-name {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 1.3rem;
  font-size: 0.84rem;
  word-break: break-all;
  text-align: left;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.play-sound-params__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem 0.9rem;
}
</style>