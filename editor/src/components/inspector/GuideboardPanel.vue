<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import {
  GUIDEBOARD_COMPONENT_TYPE,
  type GuideboardComponentProps,
  clampGuideboardComponentProps,
  GUIDEBOARD_DEFAULT_GLOW_COLOR,
  GUIDEBOARD_DEFAULT_GLOW_INTENSITY,
  GUIDEBOARD_DEFAULT_GLOW_RADIUS,
  GUIDEBOARD_DEFAULT_PULSE_SPEED,
  GUIDEBOARD_DEFAULT_PULSE_STRENGTH,
  GUIDEBOARD_DEFAULT_INITIAL_VISIBILITY,
  GUIDEBOARD_GLOW_INTENSITY_MIN,
  GUIDEBOARD_GLOW_INTENSITY_MAX,
  GUIDEBOARD_GLOW_RADIUS_MIN,
  GUIDEBOARD_GLOW_RADIUS_MAX,
  GUIDEBOARD_PULSE_SPEED_MIN,
  GUIDEBOARD_PULSE_SPEED_MAX,
  GUIDEBOARD_PULSE_STRENGTH_MIN,
  GUIDEBOARD_PULSE_STRENGTH_MAX,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const guideboardComponent = computed(
  () => selectedNode.value?.components?.[GUIDEBOARD_COMPONENT_TYPE] as
    | SceneNodeComponentState<GuideboardComponentProps>
    | undefined,
)

const componentEnabled = computed(() => guideboardComponent.value?.enabled !== false)

const localState = reactive({
  initiallyVisible: GUIDEBOARD_DEFAULT_INITIAL_VISIBILITY,
  glowColor: GUIDEBOARD_DEFAULT_GLOW_COLOR,
  glowIntensity: GUIDEBOARD_DEFAULT_GLOW_INTENSITY,
  glowRadius: GUIDEBOARD_DEFAULT_GLOW_RADIUS,
  pulseSpeed: GUIDEBOARD_DEFAULT_PULSE_SPEED,
  pulseStrength: GUIDEBOARD_DEFAULT_PULSE_STRENGTH,
})

const syncing = ref(false)
const colorMenuOpen = ref(false)

watch(componentEnabled, (enabled) => {
  if (!enabled && colorMenuOpen.value) {
    colorMenuOpen.value = false
  }
})

watch(
  () => guideboardComponent.value?.props,
  (props) => {
    const normalized = clampGuideboardComponentProps(props as Partial<GuideboardComponentProps> | undefined)
    syncing.value = true
    localState.initiallyVisible = normalized.initiallyVisible
    localState.glowColor = normalized.glowColor
    localState.glowIntensity = normalized.glowIntensity
    localState.glowRadius = normalized.glowRadius
    localState.pulseSpeed = normalized.pulseSpeed
    localState.pulseStrength = normalized.pulseStrength
    nextTick(() => {
      syncing.value = false
    })
  },
  { immediate: true, deep: true },
)

watch(
  () => localState.glowColor,
  (value, previous) => {
    if (syncing.value || value === previous || !componentEnabled.value) {
      return
    }
    applyGuideboard({ glowColor: value })
  },
)

watch(
  () => localState.glowIntensity,
  (value, previous) => {
    if (syncing.value || !componentEnabled.value) {
      return
    }
    if (!Number.isFinite(value)) {
      return
    }
    const prev = typeof previous === 'number' ? previous : Number(previous)
    if (Number.isFinite(prev) && Math.abs(value - prev) <= 1e-4) {
      return
    }
    applyGuideboard({ glowIntensity: value })
  },
)

watch(
  () => localState.glowRadius,
  (value, previous) => {
    if (syncing.value || !componentEnabled.value) {
      return
    }
    if (!Number.isFinite(value)) {
      return
    }
    const prev = typeof previous === 'number' ? previous : Number(previous)
    if (Number.isFinite(prev) && Math.abs(value - prev) <= 1e-4) {
      return
    }
    applyGuideboard({ glowRadius: value })
  },
)

watch(
  () => localState.pulseSpeed,
  (value, previous) => {
    if (syncing.value || !componentEnabled.value) {
      return
    }
    if (!Number.isFinite(value)) {
      return
    }
    const prev = typeof previous === 'number' ? previous : Number(previous)
    if (Number.isFinite(prev) && Math.abs(value - prev) <= 1e-4) {
      return
    }
    applyGuideboard({ pulseSpeed: value })
  },
)

watch(
  () => localState.pulseStrength,
  (value, previous) => {
    if (syncing.value || !componentEnabled.value) {
      return
    }
    if (!Number.isFinite(value)) {
      return
    }
    const prev = typeof previous === 'number' ? previous : Number(previous)
    if (Number.isFinite(prev) && Math.abs(value - prev) <= 1e-4) {
      return
    }
    applyGuideboard({ pulseStrength: value })
  },
)

function applyGuideboard(patch: Partial<GuideboardComponentProps>) {
  const component = guideboardComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, patch as Partial<Record<string, unknown>>)
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

function handleColorInput(value: string | null) {
  if (!componentEnabled.value || typeof value !== 'string') {
    return
  }
  const normalized = normalizeHexColor(value, localState.glowColor)
  if (normalized === localState.glowColor) {
    return
  }
  localState.glowColor = normalized
}

function handleColorPickerInput(value: string | null) {
  handleColorInput(value)
}

function handleGlowIntensityInput(value: string | number | null) {
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
  const clamped = Math.min(Math.max(numeric, GUIDEBOARD_GLOW_INTENSITY_MIN), GUIDEBOARD_GLOW_INTENSITY_MAX)
  localState.glowIntensity = clamped
}

function handleGlowRadiusInput(value: string | number | null) {
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
  const clamped = Math.min(Math.max(numeric, GUIDEBOARD_GLOW_RADIUS_MIN), GUIDEBOARD_GLOW_RADIUS_MAX)
  localState.glowRadius = clamped
}

function handlePulseSpeedInput(value: string | number | null) {
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
  const clamped = Math.min(Math.max(numeric, GUIDEBOARD_PULSE_SPEED_MIN), GUIDEBOARD_PULSE_SPEED_MAX)
  localState.pulseSpeed = clamped
}

function handlePulseStrengthInput(value: string | number | null) {
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
  const clamped = Math.min(Math.max(numeric, GUIDEBOARD_PULSE_STRENGTH_MIN), GUIDEBOARD_PULSE_STRENGTH_MAX)
  localState.pulseStrength = clamped
}

function handleToggleComponent() {
  const component = guideboardComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = guideboardComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}

function handleVisibilityChange(value: boolean | null) {
  const component = guideboardComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  const nextValue = value === true
  localState.initiallyVisible = nextValue
  sceneStore.updateNodeComponentProps(nodeId, component.id, { initiallyVisible: nextValue })
}
</script>

<template>
  <v-expansion-panel value="guideboard">
    <v-expansion-panel-title>
      <div class="guideboard-panel-header">
        <span class="guideboard-panel-title">Guideboard Highlight</span>
        <v-spacer />
        <v-menu
          v-if="guideboardComponent"
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
      <div class="guideboard-settings">
        <p class="guideboard-hint">
          Configure the glow that highlights this guideboard so users can find their next action quickly.
        </p>
        <v-switch
          :model-value="localState.initiallyVisible"
          label="Initially Visible"
          color="primary"
          density="comfortable"
          :disabled="!componentEnabled"
          @update:modelValue="handleVisibilityChange"
        />
        <div class="color-input">
          <v-text-field
            label="Glow Color"
            class="slider-input"
            density="compact"
            variant="underlined"
            hide-details
            :model-value="localState.glowColor"
            :disabled="!componentEnabled"
            @update:model-value="handleColorInput"
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
                :style="{ backgroundColor: localState.glowColor }"
                :disabled="!componentEnabled"
                title="Select glow color"
              >
                <span class="sr-only">Select glow color</span>
              </button>
            </template>
            <div class="color-picker">
              <v-color-picker
                :model-value="localState.glowColor"
                mode="hex"
                :modes="['hex']"
                hide-inputs
                @update:model-value="handleColorPickerInput"
              />
            </div>
          </v-menu>
        </div>
        <v-text-field
          :model-value="localState.glowIntensity"
          :min="GUIDEBOARD_GLOW_INTENSITY_MIN"
          :max="GUIDEBOARD_GLOW_INTENSITY_MAX"
          :step="0.1"
          label="Glow Intensity"
          type="number"
          density="compact"
          variant="underlined"
          color="primary"
          inputmode="decimal"
          hide-details
          class="slider-input"
          :disabled="!componentEnabled"
          @update:model-value="handleGlowIntensityInput"
        />
        <v-text-field
          :model-value="localState.glowRadius"
          :min="GUIDEBOARD_GLOW_RADIUS_MIN"
          :max="GUIDEBOARD_GLOW_RADIUS_MAX"
          :step="0.05"
          label="Glow Radius"
          type="number"
          density="compact"
          variant="underlined"
          color="primary"
          inputmode="decimal"
          hide-details
          class="slider-input"
          :disabled="!componentEnabled"
          @update:model-value="handleGlowRadiusInput"
        />
        <v-text-field
          :model-value="localState.pulseSpeed"
          :min="GUIDEBOARD_PULSE_SPEED_MIN"
          :max="GUIDEBOARD_PULSE_SPEED_MAX"
          :step="0.1"
          label="Pulse Speed"
          type="number"
          density="compact"
          variant="underlined"
          color="primary"
          inputmode="decimal"
          hide-details
          class="slider-input"
          :disabled="!componentEnabled"
          @update:model-value="handlePulseSpeedInput"
        />
        <v-text-field
          :model-value="localState.pulseStrength"
          :min="GUIDEBOARD_PULSE_STRENGTH_MIN"
          :max="GUIDEBOARD_PULSE_STRENGTH_MAX"
          :step="0.05"
          label="Pulse Strength"
          type="number"
          density="compact"
          variant="underlined"
          color="primary"
          inputmode="decimal"
          hide-details
          class="slider-input"
          :disabled="!componentEnabled"
          @update:model-value="handlePulseStrengthInput"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.guideboard-panel-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.guideboard-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.guideboard-settings {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding-inline: 0.4rem;
}

.guideboard-hint {
  font-size: 0.78rem;
  color: rgba(220, 225, 232, 0.65);
  margin: 0;
}

.color-input {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.color-swatch {
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.25);
  cursor: pointer;
  padding: 0;
  background: transparent;
}

.color-swatch:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.color-picker {
  padding: 0.4rem;
}

.slider-input {
  max-width: 210px;
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
