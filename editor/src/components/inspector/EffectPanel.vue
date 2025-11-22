<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import {
  EFFECT_COMPONENT_TYPE,
  type EffectComponentProps,
  type EffectTypeId,
  type GroundLightEffectProps,
  clampEffectComponentProps,
  DEFAULT_EFFECT_TYPE,
  DEFAULT_GROUND_LIGHT_COLOR,
  DEFAULT_GROUND_LIGHT_INTENSITY,
  DEFAULT_GROUND_LIGHT_SCALE,
  GROUND_LIGHT_INTENSITY_MIN,
  GROUND_LIGHT_INTENSITY_MAX,
  GROUND_LIGHT_SCALE_MIN,
  GROUND_LIGHT_SCALE_MAX,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const effectComponent = computed(
  () => selectedNode.value?.components?.[EFFECT_COMPONENT_TYPE] as
    | SceneNodeComponentState<EffectComponentProps>
    | undefined,
)

const componentEnabled = computed(() => effectComponent.value?.enabled !== false)

const localState = reactive({
  effectType: DEFAULT_EFFECT_TYPE as EffectTypeId,
  groundLightColor: DEFAULT_GROUND_LIGHT_COLOR,
  groundLightIntensity: DEFAULT_GROUND_LIGHT_INTENSITY,
  groundLightScale: DEFAULT_GROUND_LIGHT_SCALE,
})

const syncing = ref(false)
const colorMenuOpen = ref(false)

const effectTypeOptions: Array<{ label: string; value: EffectTypeId }> = [
  { label: 'Ground Light', value: 'groundLight' },
]

watch(
  () => effectComponent.value?.props,
  (props) => {
    const normalized = clampEffectComponentProps(props as Partial<EffectComponentProps> | undefined)
    syncing.value = true
    localState.effectType = normalized.effectType
    localState.groundLightColor = normalized.groundLight.color
    localState.groundLightIntensity = normalized.groundLight.intensity
    localState.groundLightScale = normalized.groundLight.scale
    nextTick(() => {
      syncing.value = false
    })
  },
  { immediate: true, deep: true },
)

watch(
  () => localState.effectType,
  (value, previous) => {
    if (syncing.value || value === previous) {
      return
    }
    applyEffectType(value)
  },
)

watch(
  () => localState.groundLightColor,
  (value, previous) => {
    if (syncing.value || value === previous) {
      return
    }
    applyGroundLight({ color: value })
  },
)

watch(
  () => localState.groundLightIntensity,
  (value, previous) => {
    if (syncing.value || Math.abs(value - (previous ?? value)) <= 1e-4) {
      return
    }
    applyGroundLight({ intensity: value })
  },
)

watch(
  () => localState.groundLightScale,
  (value, previous) => {
    if (syncing.value) {
      return
    }
    const numeric = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(numeric)) {
      return
    }
    const prevNumeric = typeof previous === 'number' ? previous : Number(previous)
    if (Number.isFinite(prevNumeric) && Math.abs(numeric - prevNumeric) <= 1e-4) {
      return
    }
    applyGroundLight({ scale: numeric })
  },
)

function applyEffectType(type: EffectTypeId) {
  const component = effectComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { effectType: type })
}

function applyGroundLight(patch: Partial<GroundLightEffectProps>) {
  const component = effectComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  const current = clampEffectComponentProps(component.props)
  const next: EffectComponentProps = {
    effectType: current.effectType,
    groundLight: {
      ...current.groundLight,
      ...patch,
    },
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, next)
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  if (!trimmed.length) {
    return fallback
  }
  const prefixed = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(prefixed)
  if (!match) {
    return fallback
  }
  const hex = match[1] ?? ''
  if (hex.length === 3) {
    const [r, g, b] = hex.toLowerCase().split('')
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return `#${hex.toLowerCase()}`
}

function handleGroundLightColorInput(value: string | null) {
  if (!componentEnabled.value) {
    return
  }
  if (typeof value !== 'string') {
    return
  }
  const current = localState.groundLightColor
  const normalized = normalizeHexColor(value, current)
  if (normalized === current) {
    return
  }
  localState.groundLightColor = normalized
}

function handleGroundLightColorPickerInput(value: string | null) {
  handleGroundLightColorInput(value)
}

function handleGroundLightScaleInput(value: string | number | null) {
  if (!componentEnabled.value) {
    return
  }
  if (value === '' || value === null || value === undefined) {
    return
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  if (Math.abs(numeric - localState.groundLightScale) <= 1e-4) {
    return
  }
  localState.groundLightScale = numeric
}

function handleToggleComponent() {
  const component = effectComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = effectComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}
</script>

<template>
  <v-expansion-panel :value="EFFECT_COMPONENT_TYPE">
    <v-expansion-panel-title>
      <div class="effect-panel-header">
        <span class="effect-panel-title">Effect</span>
        <v-spacer />
        <v-menu
          v-if="effectComponent"
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
      <div class="effect-settings">
        <v-select
          v-model="localState.effectType"
          :items="effectTypeOptions"
          label="Effect Type"
          hide-details
          density="compact"
          variant="underlined"
          class="field-select"
          item-title="label"
          item-value="value"
          :disabled="!componentEnabled"
        />
        <div v-if="localState.effectType === 'groundLight'" class="ground-light-settings">
          <div class="color-input">
            <v-text-field
              label="Color"
              class="slider-input"
              density="compact"
              variant="underlined"
              hide-details
              :model-value="localState.groundLightColor"
              :disabled="!componentEnabled"
              @update:model-value="handleGroundLightColorInput"
            />
            <v-menu
              v-model="colorMenuOpen"
              :close-on-content-click="false"
              transition="scale-transition"
              location="bottom start"
            >
              <template #activator="{ props: menuProps }">
                <button
                  class="color-swatch"
                  type="button"
                  v-bind="menuProps"
                  :style="{ backgroundColor: localState.groundLightColor }"
                  :disabled="!componentEnabled"
                  title="Select effect color"
                >
                  <span class="sr-only">Select effect color</span>
                </button>
              </template>
              <div class="color-picker">
                <v-color-picker
                  :model-value="localState.groundLightColor"
                  mode="hex"
                  :modes="['hex']"
                  hide-inputs
                  @update:model-value="handleGroundLightColorPickerInput"
                />
              </div>
            </v-menu>
          </div>
          <v-text-field
            :model-value="localState.groundLightScale"
            :min="GROUND_LIGHT_SCALE_MIN"
            :max="GROUND_LIGHT_SCALE_MAX"
            :step="0.05"
            label="Scale"
            type="number"
            density="compact"
            variant="underlined"
            color="primary"
            inputmode="decimal"
            hide-details
            class="slider-input"
            :disabled="!componentEnabled"
            @update:model-value="handleGroundLightScaleInput"
          />
          <v-text-field
            v-model="localState.groundLightIntensity"
            :min="GROUND_LIGHT_INTENSITY_MIN"
            :max="GROUND_LIGHT_INTENSITY_MAX"
            :step="0.05"
            label="Intensity"
            type="number"
            density="compact"
            variant="underlined"
            color="primary"
            inputmode="decimal"
            hide-details
            class="slider-input"
            :disabled="!componentEnabled"
          />
        </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.effect-panel-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.effect-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.effect-settings {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-inline: 0.4rem;
}

.ground-light-settings {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.color-input {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.color-swatch {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  cursor: pointer;
  padding: 0;
  background: transparent;
}

.color-swatch:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.color-swatch:focus-visible {
  outline: 2px solid rgba(107, 152, 255, 0.9);
  outline-offset: 2px;
}

.color-picker {
  padding: 12px;
}

.slider-input :deep(.v-field-label) {
  font-size: 0.82rem;
  font-weight: 600;
}

.slider-input :deep(input) {
  font-variant-numeric: tabular-nums;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}
</style>
