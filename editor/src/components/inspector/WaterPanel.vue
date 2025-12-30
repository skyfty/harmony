<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import {
  WATER_COMPONENT_TYPE,
  WATER_PRESETS,
  type WaterPresetId,
  type WaterComponentProps,
  clampWaterComponentProps,
  WATER_DEFAULT_DISTORTION_SCALE,
  WATER_DEFAULT_FLOW_SPEED,
  WATER_DEFAULT_SIZE,
  WATER_DEFAULT_TEXTURE_HEIGHT,
  WATER_DEFAULT_TEXTURE_WIDTH,
  WATER_MIN_DISTORTION_SCALE,
  WATER_MIN_FLOW_SPEED,
  WATER_MIN_SIZE,
  WATER_MIN_TEXTURE_SIZE,
} from '@schema/components'

const DEFAULT_FLOW_DIRECTION = { x: 0.7071, y: 0.7071 }

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const waterComponent = computed(
  () => selectedNode.value?.components?.[WATER_COMPONENT_TYPE] as
    | SceneNodeComponentState<WaterComponentProps>
    | undefined,
)

const componentEnabled = computed(() => waterComponent.value?.enabled !== false)

const FLOW_DIRECTION_DECIMALS = 2

const OPACITY_EPSILON = 1e-3

const waterPresetOptions = computed(() =>
  WATER_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
)

const selectedPreset = ref<WaterPresetId | null>(null)

const localState = reactive({
  textureWidth: WATER_DEFAULT_TEXTURE_WIDTH,
  textureHeight: WATER_DEFAULT_TEXTURE_HEIGHT,
  distortionScale: WATER_DEFAULT_DISTORTION_SCALE,
  size: WATER_DEFAULT_SIZE,
  flowDirectionX: DEFAULT_FLOW_DIRECTION.x,
  flowDirectionY: DEFAULT_FLOW_DIRECTION.y,
  flowSpeed: WATER_DEFAULT_FLOW_SPEED,
})

const syncing = ref(false)

watch(
  () => waterComponent.value?.props,
  (props) => {
    const normalized = clampWaterComponentProps(props ?? null)
    syncing.value = true
    localState.textureWidth = normalized.textureWidth
    localState.textureHeight = normalized.textureHeight
    localState.distortionScale = normalized.distortionScale
    localState.size = normalized.size
    localState.flowDirectionX = toFixedNumber(normalized.flowDirection.x, FLOW_DIRECTION_DECIMALS)
    localState.flowDirectionY = toFixedNumber(normalized.flowDirection.y, FLOW_DIRECTION_DECIMALS)
    localState.flowSpeed = normalized.flowSpeed
    nextTick(() => {
      syncing.value = false
    })
  },
  { immediate: true, deep: true },
)

function applyWaterPatch(patch: Partial<WaterComponentProps>) {
  if (!componentEnabled.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = waterComponent.value
  if (!nodeId || !component) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, patch)
}

function toCssHex(color: number): string {
  const normalized = Number.isFinite(color) ? Math.max(0, Math.min(0xffffff, Math.floor(color))) : 0
  return `#${normalized.toString(16).padStart(6, '0')}`
}

function ensureEditablePrimaryMaterialId(nodeId: string): string | null {
  const node = selectedNode.value
  if (!node || node.id !== nodeId) {
    return null
  }
  let primary = node.materials?.[0] ?? null
  if (!primary) {
    primary = sceneStore.addNodeMaterial(nodeId)
  }
  if (!primary) {
    return null
  }
  if (primary.materialId) {
    sceneStore.assignNodeMaterial(nodeId, primary.id, null)
  }
  return primary.id
}

function handlePresetChange(value: WaterPresetId | null) {
  if (!componentEnabled.value) {
    return
  }
  selectedPreset.value = value
  if (!value) {
    return
  }
  const preset = WATER_PRESETS.find((entry) => entry.id === value)
  if (!preset) {
    return
  }

  applyWaterPatch({
    distortionScale: preset.distortionScale,
    size: preset.size,
    flowSpeed: preset.flowSpeed,
    waveStrength: preset.waveStrength,
  })

  const nodeId = selectedNodeId.value
  if (!nodeId) {
    return
  }
  const materialId = ensureEditablePrimaryMaterialId(nodeId)
  if (!materialId) {
    return
  }
  sceneStore.updateNodeMaterialProps(nodeId, materialId, {
    color: toCssHex(preset.waterColor),
    opacity: preset.alpha,
    transparent: preset.alpha < 1 - OPACITY_EPSILON,
  })
  // persist preset into node userData so it is saved with the scene
  persistPresetToNode(value)
}

// Persist selected preset to node userData so it survives reloads
watch(
  () => selectedNode.value?.userData,
  (ud) => {
    const id = ud && (ud as any).waterPresetId ? (ud as any).waterPresetId as WaterPresetId : null
    selectedPreset.value = id
  },
  { immediate: true },
)

// When user selects a preset, also save it into node.userData
function persistPresetToNode(value: WaterPresetId | null) {
  const node = selectedNode.value
  const nodeId = selectedNodeId.value
  if (!node || !nodeId) return
  const prev = node.userData && typeof node.userData === 'object' ? { ...(node.userData as Record<string, unknown>) } : {}
  if (value === null) {
    delete prev.waterPresetId
    delete prev.waterPresetParams
  } else {
    const preset = WATER_PRESETS.find((p) => p.id === value)
    if (preset) {
      prev.waterPresetId = value
      prev.waterPresetParams = {
        distortionScale: preset.distortionScale,
        size: preset.size,
        flowSpeed: preset.flowSpeed,
        waveStrength: preset.waveStrength,
        waterColor: preset.waterColor,
        alpha: preset.alpha,
      }
    }
  }
  sceneStore.updateNodeUserData(nodeId, prev as Record<string, unknown>)
}

function toFixedNumber(value: number, decimals: number) {
  if (!Number.isFinite(value) || decimals < 0) {
    return value
  }
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

watch(
  () => localState.textureWidth,
  (value) => {
    if (syncing.value || !componentEnabled.value || !Number.isFinite(value)) {
      return
    }
    applyWaterPatch({ textureWidth: Math.max(WATER_MIN_TEXTURE_SIZE, Math.round(value)) })
  },
)

watch(
  () => localState.textureHeight,
  (value) => {
    if (syncing.value || !componentEnabled.value || !Number.isFinite(value)) {
      return
    }
    applyWaterPatch({ textureHeight: Math.max(WATER_MIN_TEXTURE_SIZE, Math.round(value)) })
  },
)

watch(
  () => localState.distortionScale,
  (value) => {
    if (syncing.value || !componentEnabled.value || !Number.isFinite(value)) {
      return
    }
    applyWaterPatch({ distortionScale: Math.max(WATER_MIN_DISTORTION_SCALE, value) })
  },
)

watch(
  () => localState.size,
  (value) => {
    if (syncing.value || !componentEnabled.value || !Number.isFinite(value)) {
      return
    }
    applyWaterPatch({ size: Math.max(WATER_MIN_SIZE, value) })
  },
)

watch(
  () => localState.flowSpeed,
  (value) => {
    if (syncing.value || !componentEnabled.value || !Number.isFinite(value)) {
      return
    }
    applyWaterPatch({ flowSpeed: Math.max(WATER_MIN_FLOW_SPEED, value) })
  },
)

function applyFlowDirection() {
  if (syncing.value || !componentEnabled.value) {
    return
  }
  const x = localState.flowDirectionX
  const y = localState.flowDirectionY
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return
  }
  applyWaterPatch({ flowDirection: { x, y } })
}

function handleFlowDirectionInput(axis: 'x' | 'y', value: number) {
  if (!Number.isFinite(value)) {
    return
  }
  const rounded = toFixedNumber(value, FLOW_DIRECTION_DECIMALS)
  if (Math.abs(value - rounded) > 1e-6) {
    if (axis === 'x') {
      localState.flowDirectionX = rounded
    } else {
      localState.flowDirectionY = rounded
    }
    return
  }
  applyFlowDirection()
}

watch(
  () => localState.flowDirectionX,
  (value) => {
    handleFlowDirectionInput('x', value)
  },
)

watch(
  () => localState.flowDirectionY,
  (value) => {
    handleFlowDirectionInput('y', value)
  },
)

function handleToggleComponent() {
  const component = waterComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = waterComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}
</script>

<template>
  <v-expansion-panel value="water">
    <v-expansion-panel-title>
      <div class="water-panel-header">
        <span class="water-panel-title">Water</span>
        <v-spacer />
        <v-menu v-if="waterComponent" location="bottom end" origin="auto" transition="fade-transition">
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
              <v-list-item-title>
                {{ componentEnabled ? 'Disable' : 'Enable' }}
              </v-list-item-title>
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
      <div class="water-field-grid">
        <v-select
          class="water-preset-select"
          label="Preset"
          density="compact"
          variant="underlined"
          hide-details
          :items="waterPresetOptions"
          item-title="label"
          item-value="value"
          :model-value="selectedPreset"
          :disabled="!componentEnabled"
          @update:modelValue="handlePresetChange"
        />
        <v-text-field
          v-model.number="localState.textureWidth"
          :min="WATER_MIN_TEXTURE_SIZE"
          label="Texture Width"
          type="number"
          density="compact"
          variant="underlined"
          hide-details
          :disabled="!componentEnabled"
        />
        <v-text-field
          v-model.number="localState.textureHeight"
          :min="WATER_MIN_TEXTURE_SIZE"
          label="Texture Height"
          type="number"
          density="compact"
          variant="underlined"
          hide-details
          :disabled="!componentEnabled"
        />
        <v-text-field
          v-model.number="localState.distortionScale"
          :min="WATER_MIN_DISTORTION_SCALE"
          label="Distortion Scale"
          type="number"
          density="compact"
          variant="underlined"
          hide-details
          :disabled="!componentEnabled"
        />
        <v-text-field
          v-model.number="localState.size"
          :min="WATER_MIN_SIZE"
          label="Size"
          type="number"
          density="compact"
          variant="underlined"
          hide-details
          :disabled="!componentEnabled"
        />
        <v-text-field
          v-model.number="localState.flowSpeed"
          :min="WATER_MIN_FLOW_SPEED"
          label="Flow Speed"
          step="0.01"
          inputmode="decimal"
          type="number"
          density="compact"
          variant="underlined"
          hide-details
          :disabled="!componentEnabled"
        />
        <div class="water-flow-row">
          <div class="water-flow-label">Flow Direction</div>
          <div class="water-flow-inputs">
            <v-text-field
              v-model.number="localState.flowDirectionX"
              suffix="X"
              step="0.01"
              inputmode="decimal"
              type="number"
              density="compact"
              variant="underlined"
              hide-details
              :disabled="!componentEnabled"
            />
            <v-text-field
              v-model.number="localState.flowDirectionY"
              suffix="Y"
              step="0.01"
              inputmode="decimal"
              type="number"
              density="compact"
              variant="underlined"
              hide-details
              :disabled="!componentEnabled"
            />
          </div>
        </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.water-panel-header {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  width: 100%;
}

.water-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.water-field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.5rem;
}

.water-preset-select {
  grid-column: 1 / -1;
}

.water-flow-row {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.water-flow-label {
  font-size: 0.75rem;
  color: rgba(233, 236, 241, 0.6);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.water-flow-inputs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4rem;
}
</style>
