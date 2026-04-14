<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type {
  PlaySoundBehaviorParams,
  SoundBehaviorCommand,
  SoundDistanceResponseMode,
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

const distanceResponseModeOptions: Array<{ title: string; value: SoundDistanceResponseMode }> = [
  { title: 'Off', value: 'off' },
  { title: 'Near Louder', value: 'near-loud' },
  { title: 'Near Quieter', value: 'near-quiet' },
]

type DistanceResponsePreset = {
  id: string
  title: string
  description: string
  values: Pick<
    PlaySoundBehaviorParams,
    | 'refDistanceMeters'
    | 'maxDistanceMeters'
    | 'rolloffFactor'
    | 'distanceResponseMode'
    | 'distanceResponseStartMeters'
    | 'distanceResponseEndMeters'
    | 'distanceResponseSuppressedGain'
    | 'distanceResponseCurvePower'
  >
}

const distanceResponsePresets: DistanceResponsePreset[] = [
  {
    id: 'natural-source',
    title: 'Natural Source',
    description: 'Neutral falloff for ordinary point sources and close-up props.',
    values: {
      refDistanceMeters: 1.5,
      maxDistanceMeters: 20,
      rolloffFactor: 1,
      distanceResponseMode: 'off',
      distanceResponseStartMeters: 0,
      distanceResponseEndMeters: 8,
      distanceResponseSuppressedGain: 0.15,
      distanceResponseCurvePower: 1,
    },
  },
  {
    id: 'speaker-pa',
    title: 'Speaker / PA',
    description: 'Gets steadily stronger as the listener approaches the source.',
    values: {
      refDistanceMeters: 2.5,
      maxDistanceMeters: 36,
      rolloffFactor: 1.1,
      distanceResponseMode: 'near-loud',
      distanceResponseStartMeters: 2,
      distanceResponseEndMeters: 20,
      distanceResponseSuppressedGain: 0.2,
      distanceResponseCurvePower: 1.2,
    },
  },
  {
    id: 'crowd-hub',
    title: 'Crowd / Plaza',
    description: 'Broad ambience that is still audible far away and fills in smoothly nearby.',
    values: {
      refDistanceMeters: 4,
      maxDistanceMeters: 50,
      rolloffFactor: 0.85,
      distanceResponseMode: 'near-loud',
      distanceResponseStartMeters: 4,
      distanceResponseEndMeters: 28,
      distanceResponseSuppressedGain: 0.4,
      distanceResponseCurvePower: 0.9,
    },
  },
  {
    id: 'bird-canopy',
    title: 'Bird / Canopy',
    description: 'Quieter when directly underneath, clearer at a short distance.',
    values: {
      refDistanceMeters: 2,
      maxDistanceMeters: 26,
      rolloffFactor: 1,
      distanceResponseMode: 'near-quiet',
      distanceResponseStartMeters: 0,
      distanceResponseEndMeters: 10,
      distanceResponseSuppressedGain: 0.2,
      distanceResponseCurvePower: 1.5,
    },
  },
  {
    id: 'crickets-field',
    title: 'Crickets / Insects',
    description: 'Best heard a few meters away; near field is intentionally subdued.',
    values: {
      refDistanceMeters: 3,
      maxDistanceMeters: 22,
      rolloffFactor: 0.95,
      distanceResponseMode: 'near-quiet',
      distanceResponseStartMeters: 0,
      distanceResponseEndMeters: 7,
      distanceResponseSuppressedGain: 0.08,
      distanceResponseCurvePower: 1.8,
    },
  },
  {
    id: 'waterfall-stream',
    title: 'Water / Fountain',
    description: 'Carries across medium distance, then rises faster when approaching the water.',
    values: {
      refDistanceMeters: 3.5,
      maxDistanceMeters: 32,
      rolloffFactor: 0.8,
      distanceResponseMode: 'near-loud',
      distanceResponseStartMeters: 1,
      distanceResponseEndMeters: 18,
      distanceResponseSuppressedGain: 0.35,
      distanceResponseCurvePower: 1.05,
    },
  },
  {
    id: 'market-stall',
    title: 'Market Stall',
    description: 'Layered vendor ambience that stays present in a lane and swells near the booth.',
    values: {
      refDistanceMeters: 3,
      maxDistanceMeters: 34,
      rolloffFactor: 0.9,
      distanceResponseMode: 'near-loud',
      distanceResponseStartMeters: 2,
      distanceResponseEndMeters: 18,
      distanceResponseSuppressedGain: 0.32,
      distanceResponseCurvePower: 1.1,
    },
  },
  {
    id: 'temple-ambience',
    title: 'Temple Ambience',
    description: 'Diffuse ritual or bell ambience with a broad tail and gentle near-field lift.',
    values: {
      refDistanceMeters: 5,
      maxDistanceMeters: 60,
      rolloffFactor: 0.72,
      distanceResponseMode: 'near-loud',
      distanceResponseStartMeters: 4,
      distanceResponseEndMeters: 30,
      distanceResponseSuppressedGain: 0.48,
      distanceResponseCurvePower: 0.85,
    },
  },
  {
    id: 'forest-edge',
    title: 'Forest Edge',
    description: 'Mixed woodland ambience with birds and insects reading better a short distance away.',
    values: {
      refDistanceMeters: 4,
      maxDistanceMeters: 28,
      rolloffFactor: 0.92,
      distanceResponseMode: 'near-quiet',
      distanceResponseStartMeters: 0,
      distanceResponseEndMeters: 9,
      distanceResponseSuppressedGain: 0.18,
      distanceResponseCurvePower: 1.45,
    },
  },
  {
    id: 'machine-room',
    title: 'Machine Room',
    description: 'Mechanical hum that builds decisively when entering the equipment zone.',
    values: {
      refDistanceMeters: 2.2,
      maxDistanceMeters: 24,
      rolloffFactor: 1.15,
      distanceResponseMode: 'near-loud',
      distanceResponseStartMeters: 1,
      distanceResponseEndMeters: 12,
      distanceResponseSuppressedGain: 0.16,
      distanceResponseCurvePower: 1.35,
    },
  },
]

const distanceResponsePresetItems = [
  { title: 'Custom', value: 'custom' },
  ...distanceResponsePresets.map((preset) => ({
    title: preset.title,
    value: preset.id,
  })),
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
  distanceResponseMode: props.modelValue?.distanceResponseMode ?? 'off',
  distanceResponseStartMeters: Math.max(0, props.modelValue?.distanceResponseStartMeters ?? 0),
  distanceResponseEndMeters: Math.max(
    props.modelValue?.distanceResponseStartMeters ?? 0,
    props.modelValue?.distanceResponseEndMeters ?? 8,
  ),
  distanceResponseSuppressedGain: Math.min(1, Math.max(0, props.modelValue?.distanceResponseSuppressedGain ?? 0.15)),
  distanceResponseCurvePower: Math.max(0.01, props.modelValue?.distanceResponseCurvePower ?? 1),
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
const showsDistanceResponseControls = computed(() => showsSpatialControls.value && params.value.distanceResponseMode !== 'off')

const selectedDistanceResponsePresetId = computed(() => {
  const matchedPreset = distanceResponsePresets.find((preset) => (
    preset.values.refDistanceMeters === params.value.refDistanceMeters
    && preset.values.maxDistanceMeters === params.value.maxDistanceMeters
    && preset.values.rolloffFactor === params.value.rolloffFactor
    && preset.values.distanceResponseMode === params.value.distanceResponseMode
    && preset.values.distanceResponseStartMeters === params.value.distanceResponseStartMeters
    && preset.values.distanceResponseEndMeters === params.value.distanceResponseEndMeters
    && preset.values.distanceResponseSuppressedGain === params.value.distanceResponseSuppressedGain
    && preset.values.distanceResponseCurvePower === params.value.distanceResponseCurvePower
  ))
  return matchedPreset?.id ?? 'custom'
})

const selectedDistanceResponsePreset = computed(() => {
  if (selectedDistanceResponsePresetId.value === 'custom') {
    return null
  }
  return distanceResponsePresets.find((preset) => preset.id === selectedDistanceResponsePresetId.value) ?? null
})

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
      case 'distanceResponseSuppressedGain':
        return Math.min(1, Math.max(0, numeric))
      case 'playbackRate':
        return Math.min(4, Math.max(0.25, numeric))
      case 'distanceResponseCurvePower':
        return Math.max(0.01, numeric)
      case 'detuneCents':
        return Math.min(2400, Math.max(-2400, numeric))
      case 'maxIntervalSeconds':
        return Math.max(params.value.minIntervalSeconds, numeric)
      case 'distanceResponseEndMeters':
        return Math.max(params.value.distanceResponseStartMeters, numeric)
      case 'minIntervalSeconds':
      case 'distanceResponseStartMeters':
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

function applyDistancePreset(preset: DistanceResponsePreset) {
  updateParams({
    ...params.value,
    spatial: true,
    ...preset.values,
  })
}

function updateDistanceResponsePreset(presetId: string) {
  if (presetId === 'custom') {
    return
  }
  const preset = distanceResponsePresets.find((entry) => entry.id === presetId)
  if (!preset) {
    return
  }
  applyDistancePreset(preset)
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
    <div class="play-sound-params__section play-sound-params__section--asset">
      <button class="play-sound-params__asset-name" type="button" @click="openAssetDialog">
        <v-icon icon="mdi-music-note-outline" size="18" />
        <span>{{ selectedAsset?.name ?? params.assetId ?? 'No audio asset selected' }}</span>
      </button>
    </div>

    <section class="play-sound-params__section">
      <div class="play-sound-params__section-header">
        <div class="play-sound-params__section-title">Playback Setup</div>
        <div class="play-sound-params__section-hint">Choose how this sound is triggered and whether it follows a scene node.</div>
      </div>
      <div class="play-sound-params__grid play-sound-params__grid--two-up">
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
    </section>

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

    <section v-if="showsPlaybackControls" class="play-sound-params__section">
      <div class="play-sound-params__section-header">
        <div class="play-sound-params__section-title">Playback Envelope</div>
        <div class="play-sound-params__section-hint">Use these to shape loudness and timing independent of distance behavior.</div>
      </div>
      <div class="play-sound-params__grid play-sound-params__grid--two-up">
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
    </section>

    <section v-if="showsIntervalControls" class="play-sound-params__section">
      <div class="play-sound-params__section-header">
        <div class="play-sound-params__section-title">Interval Timing</div>
        <div class="play-sound-params__section-hint">Only shown for Random Interval playback.</div>
      </div>
      <div class="play-sound-params__grid play-sound-params__grid--two-up">
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
    </section>

    <section v-if="showsSpatialControls" class="play-sound-params__section">
      <div class="play-sound-params__section-header">
        <div class="play-sound-params__section-title">Spatial Response</div>
        <div class="play-sound-params__section-hint">Tune how the sound behaves as the listener moves.</div>
      </div>
      <div class="play-sound-params__preset-select-row">
        <v-select
          :model-value="selectedDistanceResponsePresetId"
          :items="distanceResponsePresetItems"
          label="Quick Preset"
          density="compact"
          variant="underlined"
          hide-details
          item-title="title"
          item-value="value"
          @update:model-value="updateDistanceResponsePreset(($event ?? 'custom') as string)"
        />
        <div v-if="selectedDistanceResponsePreset" class="play-sound-params__hint play-sound-params__preset-hint">
          {{ selectedDistanceResponsePreset.description }}
        </div>
      </div>
      <div class="play-sound-params__grid play-sound-params__grid--two-up">
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
        <v-select
          :model-value="params.distanceResponseMode"
          :items="distanceResponseModeOptions"
          label="Distance Response"
          density="compact"
          variant="underlined"
          hide-details
          item-title="title"
          item-value="value"
          @update:model-value="updateField('distanceResponseMode', ($event ?? 'off') as SoundDistanceResponseMode)"
        />
      </div>
      <div v-if="showsDistanceResponseControls" class="play-sound-params__grid play-sound-params__grid--two-up">
        <v-text-field
          :model-value="params.distanceResponseStartMeters"
          type="number"
          label="Response Start (m)"
          density="compact"
          variant="underlined"
          hide-details
          min="0"
          step="0.1"
          @update:model-value="updateNumberField('distanceResponseStartMeters', $event)"
        />
        <v-text-field
          :model-value="params.distanceResponseEndMeters"
          type="number"
          label="Response End (m)"
          density="compact"
          variant="underlined"
          hide-details
          min="0"
          step="0.1"
          @update:model-value="updateNumberField('distanceResponseEndMeters', $event)"
        />
        <v-text-field
          :model-value="params.distanceResponseSuppressedGain"
          type="number"
          :label="params.distanceResponseMode === 'near-quiet' ? 'Near Gain' : 'Far Gain'"
          density="compact"
          variant="underlined"
          hide-details
          min="0"
          max="1"
          step="0.05"
          @update:model-value="updateNumberField('distanceResponseSuppressedGain', $event)"
        />
        <v-text-field
          :model-value="params.distanceResponseCurvePower"
          type="number"
          label="Response Curve"
          density="compact"
          variant="underlined"
          hide-details
          min="0.01"
          step="0.1"
          @update:model-value="updateNumberField('distanceResponseCurvePower', $event)"
        />
      </div>
      <div class="play-sound-params__hint">
        Base spatial falloff uses ref/max distance and rolloff. Distance response layers an extra proximity curve on top.
      </div>
    </section>

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

.play-sound-params__section {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.75rem;
  background: rgba(255, 255, 255, 0.025);
  transition: border-color 0.18s ease, background-color 0.18s ease;
}

.play-sound-params__section--asset {
  gap: 0.45rem;
  border-style: dashed;
}

.play-sound-params__section-header {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.play-sound-params__section-title {
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.play-sound-params__section-hint {
  font-size: 0.72rem;
  opacity: 0.65;
  line-height: 1.35;
}

.play-sound-params__section.is-active-drop {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}

.play-sound-params__section.has-asset {
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
  line-height: 1.35;
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

.play-sound-params__grid--two-up {
  align-items: start;
}

.play-sound-params__preset-select-row {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.play-sound-params__preset-hint {
  margin-top: -0.1rem;
}
</style>