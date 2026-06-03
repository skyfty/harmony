<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema/core'
import AssetPickerDialog from '@/components/common/AssetPickerDialog.vue'
import { useSceneStore } from '@/stores/sceneStore'
import type { ProjectAsset } from '@/types/project-asset'
import { generateUuid } from '@/utils/uuid'
import {
  PARTICLE_SYSTEM_COMPONENT_TYPE,
  clampParticleSystemComponentProps,
  cloneParticleSystemComponentProps,
  createParticlePresetProps,
  estimateParticleSystemCost,
  listParticlePresets,
  type ParticleSystemComponentProps,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const componentState = computed(
  () => selectedNode.value?.components?.[PARTICLE_SYSTEM_COMPONENT_TYPE] as
    | SceneNodeComponentState<ParticleSystemComponentProps>
    | undefined,
)

const componentEnabled = computed(() => componentState.value?.enabled !== false)
const normalizedProps = computed(() => clampParticleSystemComponentProps(componentState.value?.props))
const budgetEstimate = computed(() => estimateParticleSystemCost(normalizedProps.value))
const presetItems = computed(() => listParticlePresets().map((entry) => ({ label: entry.label, value: entry.id })))
const textureAssetId = computed(() => normalizedProps.value.render.textureAssetId?.trim() ?? '')
const selectedTextureAsset = computed<ProjectAsset | null>(() => {
  const assetId = textureAssetId.value
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})
const textureAssetDialogVisible = ref(false)
const textureAssetDialogAnchor = ref<{ x: number; y: number } | null>(null)
const textureAssetDialogSelectedId = computed(() => textureAssetId.value)
const textureAssetDialogTypes = 'image,texture,hdri'
const textureAssetDialogExtensions = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'ktx2', 'hdr', 'exr']

const textureAssetLabel = computed(() => {
  if (!textureAssetId.value) {
    return 'No texture assigned'
  }
  return selectedTextureAsset.value?.name?.trim() || selectedTextureAsset.value?.id || textureAssetId.value
})

const textureAssetMeta = computed(() => {
  if (!textureAssetId.value) {
    return 'Default'
  }
  const asset = selectedTextureAsset.value
  if (!asset) {
    return `Selected asset ID: ${textureAssetId.value}`
  }
  const parts = [asset.type.toUpperCase()]
  if (asset.extension) {
    parts.push(asset.extension.toUpperCase())
  }
  if (asset.sizeCategory) {
    parts.push(asset.sizeCategory)
  }
  return parts.join(' · ')
})
const textureAssetWarning = computed(() => {
  const asset = selectedTextureAsset.value
  if (!asset) {
    return ''
  }
  const width = typeof asset.imageWidth === 'number' ? asset.imageWidth : 0
  const height = typeof asset.imageHeight === 'number' ? asset.imageHeight : 0
  if (width > 128 || height > 128) {
    return `Texture is ${width || '?'} x ${height || '?'}; mobile runtime prefers 128 x 128 or smaller.`
  }
  if (asset.type !== 'image' && asset.type !== 'texture' && asset.type !== 'hdri') {
    return `Selected asset type "${asset.type}" may not be ideal for particle textures.`
  }
  return ''
})
type ParticleEmitterConfig = ParticleSystemComponentProps['emitters'][number]
const emitterShapeOptions = [
  { label: 'Point', value: 'point' },
  { label: 'Box', value: 'box' },
  { label: 'Sphere', value: 'sphere' },
] as const
const velocityModeOptions = [
  { label: 'Radial', value: 'radial' },
  { label: 'Vector', value: 'vector' },
] as const

function applyPatch(patch: Partial<ParticleSystemComponentProps>) {
  const component = componentState.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  const current = normalizedProps.value
  const next = clampParticleSystemComponentProps({
    ...cloneParticleSystemComponentProps(current),
    ...patch,
    playback: {
      ...current.playback,
      ...(patch.playback ?? {}),
    },
    budget: {
      ...current.budget,
      ...(patch.budget ?? {}),
    },
    transform: {
      ...current.transform,
      ...(patch.transform ?? {}),
    },
    render: {
      ...current.render,
      ...(patch.render ?? {}),
    },
    exposedParams: {
      ...current.exposedParams,
      ...(patch.exposedParams ?? {}),
    },
    emitters: patch.emitters ?? current.emitters,
  })
  sceneStore.updateNodeComponentProps(nodeId, component.id, next as unknown as Partial<Record<string, unknown>>)
}

function applyPreset(presetId: string | null) {
  if (!presetId) {
    return
  }
  const preset = createParticlePresetProps(presetId)
  applyPatch(preset)
}

function handleOpenTextureAssetDialog(event: MouseEvent) {
  textureAssetDialogAnchor.value = { x: event.clientX, y: event.clientY }
  textureAssetDialogVisible.value = true
}

function handleClearTextureAsset() {
  applyPatch({ render: { textureAssetId: null } })
}

function handleTextureAssetDialogUpdate(asset: ProjectAsset | null) {
  if (!asset) {
    return
  }
  applyPatch({ render: { textureAssetId: asset.id } })
  textureAssetDialogVisible.value = false
}

function handleTextureAssetDialogCancel() {
  textureAssetDialogVisible.value = false
}

function updateEmitter(index: number, patch: Partial<ParticleEmitterConfig>) {
  const nextEmitters = normalizedProps.value.emitters.map((emitter, emitterIndex) => {
    if (emitterIndex !== index) {
      return emitter
    }
    return {
      ...emitter,
      ...patch,
      position: {
        ...emitter.position,
        ...(patch.position ?? {}),
      },
      size: {
        ...emitter.size,
        ...(patch.size ?? {}),
      },
      direction: {
        ...emitter.direction,
        ...(patch.direction ?? {}),
      },
    }
  })
  applyPatch({ emitters: nextEmitters })
}

function cloneEmitterConfig(emitter: ParticleEmitterConfig, overrides: Partial<ParticleEmitterConfig> = {}): ParticleEmitterConfig {
  return {
    ...emitter,
    ...overrides,
    position: { ...emitter.position, ...(overrides.position ?? {}) },
    size: { ...emitter.size, ...(overrides.size ?? {}) },
    direction: { ...emitter.direction, ...(overrides.direction ?? {}) },
  }
}

function resolvePresetEmitterDefaults(index: number): ParticleEmitterConfig {
  const preset = createParticlePresetProps(normalizedProps.value.presetId)
  const fallback = preset.emitters[0] ?? normalizedProps.value.emitters[index]
  const emitter = preset.emitters[index] ?? fallback
  return cloneEmitterConfig(emitter ?? normalizedProps.value.emitters[index], {
    id: normalizedProps.value.emitters[index]?.id ?? emitter?.id ?? `emitter_${index + 1}`,
  })
}

function addEmitter() {
  const nextEmitters: ParticleEmitterConfig[] = [
    ...normalizedProps.value.emitters,
    {
      id: `emitter_${generateUuid().slice(0, 8)}`,
      shape: 'point',
      position: { x: 0, y: 0, z: 0 },
      size: { x: 1, y: 1, z: 1 },
      radius: 0.75,
      emissionRate: 10,
      emissionBursts: 12,
      maxParticles: Math.min(32, normalizedProps.value.budget.maxParticles),
      particleSize: 0.18,
      lifetime: 1.5,
      speed: 1.4,
      velocityMode: 'radial',
      direction: { x: 0, y: 1, z: 0 },
      spread: 0.6,
      color: normalizedProps.value.exposedParams.color,
      color2: normalizedProps.value.exposedParams.color,
      alphaStart: normalizedProps.value.exposedParams.opacity,
      alphaEnd: 0,
      scaleStart: 1,
      scaleEnd: 0.2,
    },
  ]
  applyPatch({ emitters: nextEmitters })
}

function removeEmitter(index: number) {
  const nextEmitters = normalizedProps.value.emitters.filter((_emitter, emitterIndex) => emitterIndex !== index)
  applyPatch({
    emitters: nextEmitters.length
      ? nextEmitters
      : createParticlePresetProps(normalizedProps.value.presetId).emitters,
  })
}

function copyEmitter(index: number) {
  const source = normalizedProps.value.emitters[index]
  if (!source) {
    return
  }
  const duplicated = cloneEmitterConfig(source, {
    id: `emitter_${generateUuid().slice(0, 8)}`,
  })
  const nextEmitters = [...normalizedProps.value.emitters]
  nextEmitters.splice(index + 1, 0, duplicated)
  applyPatch({ emitters: nextEmitters })
}

function moveEmitter(index: number, direction: -1 | 1) {
  const emitters = [...normalizedProps.value.emitters]
  const targetIndex = index + direction
  if (index < 0 || index >= emitters.length || targetIndex < 0 || targetIndex >= emitters.length) {
    return
  }
  const [moved] = emitters.splice(index, 1)
  emitters.splice(targetIndex, 0, moved)
  applyPatch({ emitters })
}

function moveEmitterUp(index: number) {
  moveEmitter(index, -1)
}

function moveEmitterDown(index: number) {
  moveEmitter(index, 1)
}

function resetEmitter(index: number) {
  const current = normalizedProps.value.emitters[index]
  if (!current) {
    return
  }
  const defaults = resolvePresetEmitterDefaults(index)
  const nextEmitters = normalizedProps.value.emitters.map((emitter, emitterIndex) => {
    if (emitterIndex !== index) {
      return emitter
    }
    return cloneEmitterConfig(defaults, { id: current.id })
  })
  applyPatch({ emitters: nextEmitters })
}

function handleToggleComponent() {
  const component = componentState.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = componentState.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}
</script>

<template>
  <v-expansion-panel :value="PARTICLE_SYSTEM_COMPONENT_TYPE">
    <v-expansion-panel-title>
      <div class="particle-system-panel__header">
        <span>Particle System</span>
        <v-spacer />
        <v-menu v-if="componentState" location="bottom end" origin="auto" transition="fade-transition">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon variant="text" size="small" class="component-menu-btn" @click.stop>
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
      <div class="particle-system-panel">
        <div class="particle-system-panel__section">
          <div class="particle-system-panel__section-title">Preset</div>
          <v-select
            :model-value="normalizedProps.presetId"
            :items="presetItems"
            label="Preset"
            item-title="label"
            item-value="value"
            density="compact"
            variant="underlined"
            hide-details
            :disabled="!componentEnabled"
            @update:model-value="applyPreset($event)"
          />
        </div>

        <div class="particle-system-panel__section">
          <div class="particle-system-panel__section-title">Playback</div>
          <v-switch
            :model-value="normalizedProps.playback.autoPlay"
            label="Auto Play"
            density="compact"
            hide-details
            :disabled="!componentEnabled"
            @update:model-value="applyPatch({ playback: { autoPlay: Boolean($event) } })"
          />
          <v-switch
            :model-value="normalizedProps.playback.loop"
            label="Loop"
            density="compact"
            hide-details
            :disabled="!componentEnabled"
            @update:model-value="applyPatch({ playback: { loop: Boolean($event) } })"
          />
        </div>

        <div class="particle-system-panel__section">
          <div class="particle-system-panel__section-title">Mobile Budget</div>
          <div class="particle-system-panel__budget-row">
            <span>Estimated Particles</span>
            <strong>{{ budgetEstimate.estimatedParticles }}</strong>
          </div>
          <div class="particle-system-panel__budget-row">
            <span>Quality Tier</span>
            <strong>{{ normalizedProps.budget.qualityTier }}</strong>
          </div>
          <div class="particle-system-panel__budget-row">
            <span>Status</span>
            <strong :class="{ 'is-danger': budgetEstimate.exceedsMiniBudget }">
              {{ budgetEstimate.exceedsMiniBudget ? 'Over Mini Budget' : 'Safe' }}
            </strong>
          </div>
          <v-select
            :model-value="normalizedProps.budget.qualityTier"
            :items="['mini-safe', 'balanced', 'desktop-rich']"
            label="Quality Tier"
            density="compact"
            variant="underlined"
            hide-details
            :disabled="!componentEnabled"
            @update:model-value="applyPatch({ budget: { qualityTier: $event } })"
          />
          <v-text-field
            :model-value="normalizedProps.budget.maxParticles"
            label="Max Particles"
            type="number"
            density="compact"
            variant="underlined"
            hide-details
            :disabled="!componentEnabled"
            @update:model-value="applyPatch({ budget: { maxParticles: Number($event) || 0 } })"
          />
          <v-text-field
            :model-value="normalizedProps.budget.cullDistance"
            label="Cull Distance"
            type="number"
            density="compact"
            variant="underlined"
            hide-details
            :disabled="!componentEnabled"
            @update:model-value="applyPatch({ budget: { cullDistance: Number($event) || 0 } })"
          />
        </div>

        <div class="particle-system-panel__section">
          <div class="particle-system-panel__section-title">Visual</div>
          <div class="particle-system-panel__texture-slot">
            <div class="particle-system-panel__texture-slot__preview">
              <div
                v-if="selectedTextureAsset?.thumbnail"
                class="particle-system-panel__texture-thumb"
                :style="{ backgroundImage: `url(${selectedTextureAsset.thumbnail})` }"
              />
              <div v-else class="particle-system-panel__texture-thumb particle-system-panel__texture-thumb--empty">
                <v-icon size="20">mdi-image-outline</v-icon>
              </div>
            </div>
            <div class="particle-system-panel__texture-slot__body">
              <div class="particle-system-panel__texture-slot__title">{{ textureAssetLabel }}</div>
              <div class="particle-system-panel__texture-slot__meta">{{ textureAssetMeta }}</div>
              <div v-if="textureAssetWarning" class="particle-system-panel__texture-slot__warning">
                {{ textureAssetWarning }}
              </div>
            </div>
            <div class="particle-system-panel__texture-slot__actions">
              <v-btn
                size="small"
                variant="tonal"
                :disabled="!componentEnabled"
                @click.stop="handleOpenTextureAssetDialog"
              >
                Browse
              </v-btn>
              <v-btn
                size="small"
                variant="text"
                :disabled="!componentEnabled || !textureAssetId"
                @click.stop="handleClearTextureAsset"
              >
                Clear
              </v-btn>
            </div>
          </div>
          <v-text-field
            :model-value="normalizedProps.render.textureAssetId ?? ''"
            label="Texture Asset ID"
            density="compact"
            variant="underlined"
            hide-details
            placeholder="Use default soft circle texture"
            :disabled="!componentEnabled"
            @update:model-value="applyPatch({ render: { textureAssetId: String($event ?? '').trim() || null } })"
          >
            <template #append-inner>
              <v-btn
                icon
                variant="text"
                size="x-small"
                :disabled="!componentEnabled"
                @click.stop="handleOpenTextureAssetDialog"
              >
                <v-icon size="16">mdi-folder-multiple-image</v-icon>
              </v-btn>
            </template>
          </v-text-field>
          <v-text-field
            :model-value="normalizedProps.exposedParams.color"
            label="Color"
            density="compact"
            variant="underlined"
            hide-details
            :disabled="!componentEnabled"
            @update:model-value="applyPatch({ exposedParams: { color: String($event ?? '') } })"
          />
          <v-text-field
            :model-value="normalizedProps.exposedParams.particleSize"
            label="Particle Size"
            type="number"
            density="compact"
            variant="underlined"
            hide-details
            :disabled="!componentEnabled"
            @update:model-value="applyPatch({ exposedParams: { particleSize: Number($event) || 0 } })"
          />
          <v-text-field
            :model-value="normalizedProps.exposedParams.lifetime"
            label="Lifetime"
            type="number"
            density="compact"
            variant="underlined"
            hide-details
            :disabled="!componentEnabled"
            @update:model-value="applyPatch({ exposedParams: { lifetime: Number($event) || 0 } })"
          />
          <v-text-field
            :model-value="normalizedProps.exposedParams.emissionRate"
            label="Emission Rate"
            type="number"
            density="compact"
            variant="underlined"
            hide-details
            :disabled="!componentEnabled"
            @update:model-value="applyPatch({ exposedParams: { emissionRate: Number($event) || 0 } })"
          />
        </div>

        <div class="particle-system-panel__section">
          <div class="particle-system-panel__section-title">Shape</div>
          <v-text-field
            :model-value="normalizedProps.exposedParams.radius"
            label="Radius"
            type="number"
            density="compact"
            variant="underlined"
            hide-details
            :disabled="!componentEnabled"
            @update:model-value="applyPatch({ exposedParams: { radius: Number($event) || 0 } })"
          />
          <v-text-field
            :model-value="normalizedProps.exposedParams.speed"
            label="Speed"
            type="number"
            density="compact"
            variant="underlined"
            hide-details
            :disabled="!componentEnabled"
            @update:model-value="applyPatch({ exposedParams: { speed: Number($event) || 0 } })"
          />
          <v-text-field
            :model-value="normalizedProps.exposedParams.burstCount"
            label="Burst Count"
            type="number"
            density="compact"
            variant="underlined"
            hide-details
            :disabled="!componentEnabled"
            @update:model-value="applyPatch({ exposedParams: { burstCount: Number($event) || 0 } })"
          />
        </div>

        <div class="particle-system-panel__section">
          <div class="particle-system-panel__section-title">Advanced Emitters</div>
          <div class="particle-system-panel__advanced-copy">
            Emitters: {{ normalizedProps.emitters.length }} / Max Particles: {{ normalizedProps.budget.maxParticles }}
          </div>
          <div class="particle-system-panel__emitter-actions">
            <v-btn size="small" variant="tonal" :disabled="!componentEnabled" @click="addEmitter">
              Add Emitter
            </v-btn>
          </div>
          <v-expansion-panels variant="accordion" class="particle-system-panel__emitters">
            <v-expansion-panel
              v-for="(emitter, index) in normalizedProps.emitters"
              :key="emitter.id"
              :value="emitter.id"
            >
              <v-expansion-panel-title>
                <span>{{ emitter.id }}</span>
                <v-spacer />
                <v-btn
                  icon="mdi-chevron-up"
                  size="x-small"
                  variant="text"
                  :disabled="!componentEnabled || index === 0"
                  @click.stop="moveEmitterUp(index)"
                />
                <v-btn
                  icon="mdi-chevron-down"
                  size="x-small"
                  variant="text"
                  :disabled="!componentEnabled || index === normalizedProps.emitters.length - 1"
                  @click.stop="moveEmitterDown(index)"
                />
                <v-btn
                  icon="mdi-content-copy"
                  size="x-small"
                  variant="text"
                  :disabled="!componentEnabled"
                  @click.stop="copyEmitter(index)"
                />
                <v-btn
                  icon="mdi-backup-restore"
                  size="x-small"
                  variant="text"
                  :disabled="!componentEnabled"
                  @click.stop="resetEmitter(index)"
                />
                <v-btn
                  icon="mdi-delete"
                  size="x-small"
                  variant="text"
                  :disabled="!componentEnabled"
                  @click.stop="removeEmitter(index)"
                />
              </v-expansion-panel-title>
              <v-expansion-panel-text>
                <div class="particle-system-panel__emitter-grid">
                  <v-text-field
                    :model-value="emitter.id"
                    label="Emitter ID"
                    density="compact"
                    variant="underlined"
                    hide-details
                    :disabled="!componentEnabled"
                    @update:model-value="updateEmitter(index, { id: String($event ?? '').trim() || emitter.id })"
                  />
                  <v-select
                    :model-value="emitter.shape"
                    :items="emitterShapeOptions"
                    item-title="label"
                    item-value="value"
                    label="Shape"
                    density="compact"
                    variant="underlined"
                    hide-details
                    :disabled="!componentEnabled"
                    @update:model-value="updateEmitter(index, { shape: $event as ParticleEmitterConfig['shape'] })"
                  />
                  <v-select
                    :model-value="emitter.velocityMode"
                    :items="velocityModeOptions"
                    item-title="label"
                    item-value="value"
                    label="Velocity"
                    density="compact"
                    variant="underlined"
                    hide-details
                    :disabled="!componentEnabled"
                    @update:model-value="updateEmitter(index, { velocityMode: $event as ParticleEmitterConfig['velocityMode'] })"
                  />
                  <v-text-field
                    :model-value="emitter.maxParticles"
                    label="Max Particles"
                    type="number"
                    density="compact"
                    variant="underlined"
                    hide-details
                    :disabled="!componentEnabled"
                    @update:model-value="updateEmitter(index, { maxParticles: Number($event) || 0 })"
                  />
                  <v-text-field
                    :model-value="emitter.emissionRate"
                    label="Emission Rate"
                    type="number"
                    density="compact"
                    variant="underlined"
                    hide-details
                    :disabled="!componentEnabled"
                    @update:model-value="updateEmitter(index, { emissionRate: Number($event) || 0 })"
                  />
                  <v-text-field
                    :model-value="emitter.emissionBursts"
                    label="Burst Count"
                    type="number"
                    density="compact"
                    variant="underlined"
                    hide-details
                    :disabled="!componentEnabled"
                    @update:model-value="updateEmitter(index, { emissionBursts: Number($event) || 0 })"
                  />
                  <v-text-field
                    :model-value="emitter.particleSize"
                    label="Particle Size"
                    type="number"
                    density="compact"
                    variant="underlined"
                    hide-details
                    :disabled="!componentEnabled"
                    @update:model-value="updateEmitter(index, { particleSize: Number($event) || 0 })"
                  />
                  <v-text-field
                    :model-value="emitter.lifetime"
                    label="Lifetime"
                    type="number"
                    density="compact"
                    variant="underlined"
                    hide-details
                    :disabled="!componentEnabled"
                    @update:model-value="updateEmitter(index, { lifetime: Number($event) || 0 })"
                  />
                  <v-text-field
                    :model-value="emitter.speed"
                    label="Speed"
                    type="number"
                    density="compact"
                    variant="underlined"
                    hide-details
                    :disabled="!componentEnabled"
                    @update:model-value="updateEmitter(index, { speed: Number($event) || 0 })"
                  />
                  <v-text-field
                    :model-value="emitter.radius"
                    label="Radius"
                    type="number"
                    density="compact"
                    variant="underlined"
                    hide-details
                    :disabled="!componentEnabled"
                    @update:model-value="updateEmitter(index, { radius: Number($event) || 0 })"
                  />
                  <v-text-field
                    :model-value="emitter.spread"
                    label="Spread"
                    type="number"
                    density="compact"
                    variant="underlined"
                    hide-details
                    :disabled="!componentEnabled"
                    @update:model-value="updateEmitter(index, { spread: Number($event) || 0 })"
                  />
                  <v-text-field
                    :model-value="emitter.color"
                    label="Color A"
                    density="compact"
                    variant="underlined"
                    hide-details
                    :disabled="!componentEnabled"
                    @update:model-value="updateEmitter(index, { color: String($event ?? '') })"
                  />
                  <v-text-field
                    :model-value="emitter.color2"
                    label="Color B"
                    density="compact"
                    variant="underlined"
                    hide-details
                    :disabled="!componentEnabled"
                    @update:model-value="updateEmitter(index, { color2: String($event ?? '') })"
                  />
                  <v-text-field
                    :model-value="emitter.alphaStart"
                    label="Alpha Start"
                    type="number"
                    density="compact"
                    variant="underlined"
                    hide-details
                    :disabled="!componentEnabled"
                    @update:model-value="updateEmitter(index, { alphaStart: Number($event) || 0 })"
                  />
                  <v-text-field
                    :model-value="emitter.alphaEnd"
                    label="Alpha End"
                    type="number"
                    density="compact"
                    variant="underlined"
                    hide-details
                    :disabled="!componentEnabled"
                    @update:model-value="updateEmitter(index, { alphaEnd: Number($event) || 0 })"
                  />
                  <v-text-field
                    :model-value="emitter.scaleStart"
                    label="Scale Start"
                    type="number"
                    density="compact"
                    variant="underlined"
                    hide-details
                    :disabled="!componentEnabled"
                    @update:model-value="updateEmitter(index, { scaleStart: Number($event) || 0 })"
                  />
                  <v-text-field
                    :model-value="emitter.scaleEnd"
                    label="Scale End"
                    type="number"
                    density="compact"
                    variant="underlined"
                    hide-details
                    :disabled="!componentEnabled"
                    @update:model-value="updateEmitter(index, { scaleEnd: Number($event) || 0 })"
                  />
                  <v-text-field
                    :model-value="emitter.position.x"
                    label="Pos X"
                    type="number"
                    density="compact"
                    variant="underlined"
                    hide-details
                    :disabled="!componentEnabled"
                    @update:model-value="updateEmitter(index, { position: { x: Number($event) || 0 } as any })"
                  />
                  <v-text-field
                    :model-value="emitter.position.y"
                    label="Pos Y"
                    type="number"
                    density="compact"
                    variant="underlined"
                    hide-details
                    :disabled="!componentEnabled"
                    @update:model-value="updateEmitter(index, { position: { y: Number($event) || 0 } as any })"
                  />
                  <v-text-field
                    :model-value="emitter.position.z"
                    label="Pos Z"
                    type="number"
                    density="compact"
                    variant="underlined"
                    hide-details
                    :disabled="!componentEnabled"
                    @update:model-value="updateEmitter(index, { position: { z: Number($event) || 0 } as any })"
                  />
                </div>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </div>
        <AssetPickerDialog
          v-model="textureAssetDialogVisible"
          :asset-id="textureAssetDialogSelectedId"
          :asset-type="textureAssetDialogTypes"
          :extensions="textureAssetDialogExtensions"
          title="选择粒子贴图"
          confirm-text="选择"
          cancel-text="取消"
          :anchor="textureAssetDialogAnchor"
          @update:asset="handleTextureAssetDialogUpdate"
          @cancel="handleTextureAssetDialogCancel"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.particle-system-panel {
  display: grid;
  gap: 0.9rem;
}

.particle-system-panel__header {
  display: flex;
  width: 100%;
  align-items: center;
}

.particle-system-panel__section {
  display: grid;
  gap: 0.45rem;
}

.particle-system-panel__section-title {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.7;
}

.particle-system-panel__budget-row {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.82rem;
}

.particle-system-panel__advanced-copy {
  font-size: 0.82rem;
  opacity: 0.75;
}

.particle-system-panel__emitter-actions {
  display: flex;
  justify-content: flex-end;
}

.particle-system-panel__emitters {
  display: grid;
  gap: 0.5rem;
}

.particle-system-panel__emitter-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem 0.75rem;
}

.particle-system-panel__texture-slot {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid rgba(140, 155, 175, 0.18);
  border-radius: 0.8rem;
  background: linear-gradient(180deg, rgba(19, 25, 35, 0.82), rgba(11, 15, 22, 0.92));
}

.particle-system-panel__texture-slot__preview {
  width: 48px;
  height: 48px;
}

.particle-system-panel__texture-thumb {
  width: 48px;
  height: 48px;
  border-radius: 0.6rem;
  background-size: cover;
  background-position: center;
  background-color: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: grid;
  place-items: center;
  color: rgba(233, 236, 241, 0.72);
}

.particle-system-panel__texture-thumb--empty {
  background-image: linear-gradient(135deg, rgba(90, 148, 255, 0.14), rgba(255, 255, 255, 0.03));
}

.particle-system-panel__texture-slot__body {
  display: grid;
  gap: 0.16rem;
  min-width: 0;
}

.particle-system-panel__texture-slot__title {
  font-size: 0.88rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.95);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.particle-system-panel__texture-slot__meta {
  font-size: 0.74rem;
  line-height: 1.35;
  color: rgba(233, 236, 241, 0.68);
}

.particle-system-panel__texture-slot__warning {
  font-size: 0.72rem;
  line-height: 1.35;
  color: #ffb86b;
}

.particle-system-panel__texture-slot__actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.is-danger {
  color: #ff8d8d;
}
</style>
