<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import {
  WARP_GATE_COMPONENT_TYPE,
  type WarpGateComponentProps,
  clampWarpGateComponentProps,
  DEFAULT_GROUND_LIGHT_COLOR,
  DEFAULT_GROUND_LIGHT_INTENSITY,
  DEFAULT_GROUND_LIGHT_SCALE,
  DEFAULT_GROUND_LIGHT_PARTICLE_SIZE,
  DEFAULT_GROUND_LIGHT_PARTICLE_COUNT,
  DEFAULT_GROUND_LIGHT_SHOW_PARTICLES,
  DEFAULT_GROUND_LIGHT_SHOW_BEAMS,
  DEFAULT_GROUND_LIGHT_SHOW_RINGS,
  GROUND_LIGHT_INTENSITY_MIN,
  GROUND_LIGHT_INTENSITY_MAX,
  GROUND_LIGHT_SCALE_MIN,
  GROUND_LIGHT_SCALE_MAX,
  GROUND_LIGHT_PARTICLE_SIZE_MIN,
  GROUND_LIGHT_PARTICLE_SIZE_MAX,
  GROUND_LIGHT_PARTICLE_COUNT_MIN,
  GROUND_LIGHT_PARTICLE_COUNT_MAX,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const warpGateComponent = computed(
  () => selectedNode.value?.components?.[WARP_GATE_COMPONENT_TYPE] as
    | SceneNodeComponentState<WarpGateComponentProps>
    | undefined,
)

const componentEnabled = computed(() => warpGateComponent.value?.enabled !== false)

const localState = reactive({
  color: DEFAULT_GROUND_LIGHT_COLOR,
  intensity: DEFAULT_GROUND_LIGHT_INTENSITY,
  scale: DEFAULT_GROUND_LIGHT_SCALE,
  particleSize: DEFAULT_GROUND_LIGHT_PARTICLE_SIZE,
  particleCount: DEFAULT_GROUND_LIGHT_PARTICLE_COUNT,
  showParticles: DEFAULT_GROUND_LIGHT_SHOW_PARTICLES,
  showBeams: DEFAULT_GROUND_LIGHT_SHOW_BEAMS,
  showRings: DEFAULT_GROUND_LIGHT_SHOW_RINGS,
})

const syncing = ref(false)
const colorMenuOpen = ref(false)

watch(
  () => warpGateComponent.value?.props,
  (props) => {
    const normalized = clampWarpGateComponentProps(props as Partial<WarpGateComponentProps> | undefined)
    syncing.value = true
    localState.color = normalized.color
    localState.intensity = normalized.intensity
    localState.scale = normalized.scale
    localState.particleSize = normalized.particleSize
    localState.particleCount = normalized.particleCount
    localState.showParticles = normalized.showParticles
    localState.showBeams = normalized.showBeams
    localState.showRings = normalized.showRings
    nextTick(() => {
      syncing.value = false
    })
  },
  { immediate: true, deep: true },
)

watch(
  () => localState.color,
  (value, previous) => {
    if (syncing.value || value === previous || !componentEnabled.value) {
      return
    }
    applyWarpGate({ color: value })
  },
)

watch(
  () => localState.intensity,
  (value, previous) => {
    if (syncing.value || !componentEnabled.value) {
      return
    }
    const prevValue = typeof previous === 'number' ? previous : Number(previous)
    if (Number.isFinite(prevValue) && Math.abs(value - prevValue) <= 1e-4) {
      return
    }
    applyWarpGate({ intensity: value })
  },
)

watch(
  () => localState.scale,
  (value, previous) => {
    if (syncing.value || !componentEnabled.value) {
      return
    }
    const prevValue = typeof previous === 'number' ? previous : Number(previous)
    if (Number.isFinite(prevValue) && Math.abs(value - prevValue) <= 1e-4) {
      return
    }
    applyWarpGate({ scale: value })
  },
)

watch(
  () => localState.particleSize,
  (value, previous) => {
    if (syncing.value || !componentEnabled.value) {
      return
    }
    const prevValue = typeof previous === 'number' ? previous : Number(previous)
    if (Number.isFinite(prevValue) && Math.abs(value - prevValue) <= 1e-4) {
      return
    }
    applyWarpGate({ particleSize: value })
  },
)

watch(
  () => localState.particleCount,
  (value, previous) => {
    if (syncing.value || !componentEnabled.value) {
      return
    }
    const prevValue = typeof previous === 'number' ? previous : Number(previous)
    if (Number.isFinite(prevValue) && Math.round(value) === Math.round(prevValue)) {
      return
    }
    applyWarpGate({ particleCount: Math.round(value) })
  },
)

watch(
  () => localState.showParticles,
  (value, previous) => {
    if (syncing.value || value === previous || !componentEnabled.value) {
      return
    }
    applyWarpGate({ showParticles: Boolean(value) })
  },
)

watch(
  () => localState.showBeams,
  (value, previous) => {
    if (syncing.value || value === previous || !componentEnabled.value) {
      return
    }
    applyWarpGate({ showBeams: Boolean(value) })
  },
)

watch(
  () => localState.showRings,
  (value, previous) => {
    if (syncing.value || value === previous || !componentEnabled.value) {
      return
    }
    applyWarpGate({ showRings: Boolean(value) })
  },
)

function applyWarpGate(patch: Partial<WarpGateComponentProps>) {
  const component = warpGateComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, patch as unknown as Partial<Record<string, unknown>>)
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
  const normalized = normalizeHexColor(value, localState.color)
  if (normalized === localState.color) {
    return
  }
  localState.color = normalized
}

function handleColorPickerInput(value: string | null) {
  handleColorInput(value)
}

function handleScaleInput(value: string | number | null) {
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
  localState.scale = numeric
}

function handleParticleSizeInput(value: string | number | null) {
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
  const clamped = Math.min(Math.max(numeric, GROUND_LIGHT_PARTICLE_SIZE_MIN), GROUND_LIGHT_PARTICLE_SIZE_MAX)
  localState.particleSize = clamped
}

function handleParticleCountInput(value: string | number | null) {
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
  const integer = Math.min(
    GROUND_LIGHT_PARTICLE_COUNT_MAX,
    Math.max(GROUND_LIGHT_PARTICLE_COUNT_MIN, Math.round(numeric)),
  )
  localState.particleCount = integer
}

function handleToggleComponent() {
  const component = warpGateComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = warpGateComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}
</script>

<template>
  <v-expansion-panel value="warp-gate">
    <v-expansion-panel-title>
      <div class="warp-gate-panel-header">
        <span class="warp-gate-panel-title">Warp Gate Effect</span>
        <v-spacer />
        <v-menu
          v-if="warpGateComponent"
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
      <div class="warp-gate-effect-settings">
        <div class="color-input">
          <v-text-field
            label="Color"
            class="slider-input"
            density="compact"
            variant="underlined"
            hide-details
            :model-value="localState.color"
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
                :style="{ backgroundColor: localState.color }"
                :disabled="!componentEnabled"
                title="Select warp gate color"
              >
                <span class="sr-only">Select warp gate color</span>
              </button>
            </template>
            <div class="color-picker">
              <v-color-picker
                :model-value="localState.color"
                mode="hex"
                :modes="['hex']"
                hide-inputs
                @update:model-value="handleColorPickerInput"
              />
            </div>
          </v-menu>
        </div>
        <v-text-field
          :model-value="localState.scale"
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
          @update:model-value="handleScaleInput"
        />
        <v-text-field
          v-model="localState.intensity"
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
        <v-text-field
          :model-value="localState.particleSize"
          :min="GROUND_LIGHT_PARTICLE_SIZE_MIN"
          :max="GROUND_LIGHT_PARTICLE_SIZE_MAX"
          :step="0.01"
          label="Particle Size"
          type="number"
          density="compact"
          variant="underlined"
          color="primary"
          inputmode="decimal"
          hide-details
          class="slider-input"
          :disabled="!componentEnabled"
          @update:model-value="handleParticleSizeInput"
        />
        <v-text-field
          :model-value="localState.particleCount"
          :min="GROUND_LIGHT_PARTICLE_COUNT_MIN"
          :max="GROUND_LIGHT_PARTICLE_COUNT_MAX"
          :step="1"
          label="Particle Count"
          type="number"
          density="compact"
          variant="underlined"
          color="primary"
          inputmode="numeric"
          hide-details
          class="slider-input"
          :disabled="!componentEnabled"
          @update:model-value="handleParticleCountInput"
        />
        <v-switch
          v-model="localState.showParticles"
          label="Show Particles"
          hide-details
          inset
          density="compact"
          class="switch-control"
          color="primary"
          :disabled="!componentEnabled"
        />
        <v-switch
          v-model="localState.showBeams"
          label="Show Light Beams"
          hide-details
          inset
          density="compact"
          class="switch-control"
          color="primary"
          :disabled="!componentEnabled"
        />
        <v-switch
          v-model="localState.showRings"
          label="Show Halo"
          hide-details
          inset
          density="compact"
          class="switch-control"
          color="primary"
          :disabled="!componentEnabled"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.warp-gate-panel-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.warp-gate-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.warp-gate-effect-settings {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-inline: 0.4rem;
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

.switch-control {
  align-self: flex-start;
  width: fit-content;
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
</style><script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import { WARP_GATE_COMPONENT_TYPE, type WarpGateComponentProps } from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const warpGateComponent = computed(
  () => selectedNode.value?.components?.[WARP_GATE_COMPONENT_TYPE] as
    | SceneNodeComponentState<WarpGateComponentProps>
    | undefined,
)

function handleToggleComponent() {
  const component = warpGateComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = warpGateComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}
</script>

<template>
  <v-expansion-panel value="warp-gate">
    <v-expansion-panel-title>
      <div class="warp-gate-panel-header">
        <span class="warp-gate-panel-title">Warp Gate Component</span>
        <v-spacer />
        <v-menu
          v-if="warpGateComponent"
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
              <v-list-item-title>{{ warpGateComponent.enabled ? 'Disable' : 'Enable' }}</v-list-item-title>
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
      <div class="warp-gate-settings">
        <p class="warp-gate-hint">Warp gates have no adjustable parameters yet. Use behaviors to define their actions.</p>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.warp-gate-panel-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.warp-gate-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.warp-gate-settings {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding-inline: 0.4rem;
}

.warp-gate-hint {
  font-size: 0.78rem;
  color: rgba(220, 225, 232, 0.65);
  margin: 0;
}
</style>
