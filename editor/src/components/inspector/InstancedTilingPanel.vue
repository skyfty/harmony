<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { SceneNodeComponentState, Vector3Like } from '@harmony/schema'
import InspectorVectorControls from '@/components/common/VectorControls.vue'
import {
  INSTANCED_TILING_COMPONENT_TYPE,
  INSTANCED_TILING_DEFAULT_COUNT,
  INSTANCED_TILING_DEFAULT_FORWARD,
  INSTANCED_TILING_DEFAULT_MODE,
  INSTANCED_TILING_DEFAULT_ROLL_DEGREES,
  INSTANCED_TILING_DEFAULT_SPACING,
  INSTANCED_TILING_DEFAULT_UP,
  type InstancedTilingComponentProps,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const componentState = computed(() => {
  const component = selectedNode.value?.components?.[INSTANCED_TILING_COMPONENT_TYPE]
  if (!component) {
    return null
  }
  return component as SceneNodeComponentState<InstancedTilingComponentProps>
})

const templateAssetId = computed(() => {
  const raw = selectedNode.value?.sourceAssetId
  return typeof raw === 'string' ? raw.trim() : ''
})

const hasTemplateAsset = computed(() => Boolean(templateAssetId.value))

const templateAsset = computed(() => {
  if (!templateAssetId.value) {
    return null
  }
  return sceneStore.getAsset(templateAssetId.value) ?? null
})

const localMode = ref<'axis' | 'vector'>(INSTANCED_TILING_DEFAULT_MODE)
const localCountX = ref(INSTANCED_TILING_DEFAULT_COUNT)
const localCountY = ref(INSTANCED_TILING_DEFAULT_COUNT)
const localCountZ = ref(INSTANCED_TILING_DEFAULT_COUNT)
const localSpacingX = ref(INSTANCED_TILING_DEFAULT_SPACING)
const localSpacingY = ref(INSTANCED_TILING_DEFAULT_SPACING)
const localSpacingZ = ref(INSTANCED_TILING_DEFAULT_SPACING)
const localForward = ref<Vector3Like>({ ...INSTANCED_TILING_DEFAULT_FORWARD })
const localUp = ref<Vector3Like>({ ...INSTANCED_TILING_DEFAULT_UP })
const localRollDegrees = ref(INSTANCED_TILING_DEFAULT_ROLL_DEGREES)

const isSyncingFromScene = ref(false)

watch(
  componentState,
  (component) => {
    isSyncingFromScene.value = true
    if (!component) {
      localMode.value = INSTANCED_TILING_DEFAULT_MODE
      localCountX.value = INSTANCED_TILING_DEFAULT_COUNT
      localCountY.value = INSTANCED_TILING_DEFAULT_COUNT
      localCountZ.value = INSTANCED_TILING_DEFAULT_COUNT
      localSpacingX.value = INSTANCED_TILING_DEFAULT_SPACING
      localSpacingY.value = INSTANCED_TILING_DEFAULT_SPACING
      localSpacingZ.value = INSTANCED_TILING_DEFAULT_SPACING
      localForward.value = { ...INSTANCED_TILING_DEFAULT_FORWARD }
      localUp.value = { ...INSTANCED_TILING_DEFAULT_UP }
      localRollDegrees.value = INSTANCED_TILING_DEFAULT_ROLL_DEGREES
      nextTick(() => {
        isSyncingFromScene.value = false
      })
      return
    }

    localMode.value = component.props.mode ?? INSTANCED_TILING_DEFAULT_MODE
    localCountX.value = Number.isFinite(component.props.countX) ? component.props.countX : INSTANCED_TILING_DEFAULT_COUNT
    localCountY.value = Number.isFinite(component.props.countY) ? component.props.countY : INSTANCED_TILING_DEFAULT_COUNT
    localCountZ.value = Number.isFinite(component.props.countZ) ? component.props.countZ : INSTANCED_TILING_DEFAULT_COUNT
    localSpacingX.value = Number.isFinite(component.props.spacingX) ? component.props.spacingX : INSTANCED_TILING_DEFAULT_SPACING
    localSpacingY.value = Number.isFinite(component.props.spacingY) ? component.props.spacingY : INSTANCED_TILING_DEFAULT_SPACING
    localSpacingZ.value = Number.isFinite(component.props.spacingZ) ? component.props.spacingZ : INSTANCED_TILING_DEFAULT_SPACING
    localForward.value = component.props.forwardLocal ?? { ...INSTANCED_TILING_DEFAULT_FORWARD }
    localUp.value = component.props.upLocal ?? { ...INSTANCED_TILING_DEFAULT_UP }
    localRollDegrees.value = Number.isFinite(component.props.rollDegrees)
      ? component.props.rollDegrees
      : INSTANCED_TILING_DEFAULT_ROLL_DEGREES

    nextTick(() => {
      isSyncingFromScene.value = false
    })
  },
  { immediate: true },
)

const feedbackMessage = ref<string | null>(null)

function applyPatch(patch: Partial<InstancedTilingComponentProps>): void {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = componentState.value
  if (!nodeId || !component) {
    return
  }
  const changed = sceneStore.updateNodeComponentProps(nodeId, component.id, patch as Partial<Record<string, unknown>>)
  if (changed) {
    // Ensure viewport observes the update immediately
    sceneStore.bumpSceneNodePropertyVersion()
  }
}

function clampCount(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return INSTANCED_TILING_DEFAULT_COUNT
  }
  return Math.max(1, Math.floor(numeric))
}

function clampNumber(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return numeric
}

function toFiniteNumberOrNull(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeVector(value: Vector3Like, fallback: Vector3Like): Vector3Like {
  const x = Number.isFinite(value?.x) ? Number(value.x) : fallback.x
  const y = Number.isFinite(value?.y) ? Number(value.y) : fallback.y
  const z = Number.isFinite(value?.z) ? Number(value.z) : fallback.z
  return { x, y, z }
}

function applyModeUpdate(rawValue: unknown) {
  const mode = rawValue === 'vector' ? 'vector' : 'axis'
  if (localMode.value !== mode) {
    localMode.value = mode
  }
  applyPatch({ mode })
}

function applyCountUpdate(axis: 'x' | 'y' | 'z') {
  const current = axis === 'x' ? localCountX.value : axis === 'y' ? localCountY.value : localCountZ.value
  const clamped = clampCount(current)
  if (axis === 'x') localCountX.value = clamped
  if (axis === 'y') localCountY.value = clamped
  if (axis === 'z') localCountZ.value = clamped

  if (axis === 'x') applyPatch({ countX: clamped })
  if (axis === 'y') applyPatch({ countY: clamped })
  if (axis === 'z') applyPatch({ countZ: clamped })
}

function applyCountLive(axis: 'x' | 'y' | 'z', rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const numeric = toFiniteNumberOrNull(rawValue)
  if (numeric === null) {
    return
  }
  const clamped = Math.max(1, Math.floor(numeric))
  if (axis === 'x') applyPatch({ countX: clamped })
  if (axis === 'y') applyPatch({ countY: clamped })
  if (axis === 'z') applyPatch({ countZ: clamped })
}

function applySpacingUpdate(axis: 'x' | 'y' | 'z') {
  const current = axis === 'x' ? localSpacingX.value : axis === 'y' ? localSpacingY.value : localSpacingZ.value
  const normalized = clampNumber(current, 0)
  if (axis === 'x') localSpacingX.value = normalized
  if (axis === 'y') localSpacingY.value = normalized
  if (axis === 'z') localSpacingZ.value = normalized

  if (axis === 'x') applyPatch({ spacingX: normalized })
  if (axis === 'y') applyPatch({ spacingY: normalized })
  if (axis === 'z') applyPatch({ spacingZ: normalized })
}

function applySpacingLive(axis: 'x' | 'y' | 'z', rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const numeric = toFiniteNumberOrNull(rawValue)
  if (numeric === null) {
    return
  }
  if (axis === 'x') applyPatch({ spacingX: numeric })
  if (axis === 'y') applyPatch({ spacingY: numeric })
  if (axis === 'z') applyPatch({ spacingZ: numeric })
}

function applyVectorAxisUpdate(kind: 'forward' | 'up', axis: 'x' | 'y' | 'z', value: string) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  if (kind === 'forward') {
    const next = normalizeVector({ ...localForward.value, [axis]: numeric } as Vector3Like, INSTANCED_TILING_DEFAULT_FORWARD)
    localForward.value = next
    applyPatch({ forwardLocal: next })
    return
  }
  const next = normalizeVector({ ...localUp.value, [axis]: numeric } as Vector3Like, INSTANCED_TILING_DEFAULT_UP)
  localUp.value = next
  applyPatch({ upLocal: next })
}

function applyRollDegreesUpdate() {
  const normalized = clampNumber(localRollDegrees.value, 0)
  if (localRollDegrees.value !== normalized) {
    localRollDegrees.value = normalized
  }
  applyPatch({ rollDegrees: normalized })
}

function applyRollDegreesLive(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const numeric = toFiniteNumberOrNull(rawValue)
  if (numeric === null) {
    return
  }
  applyPatch({ rollDegrees: numeric })
}
</script>

<template>
  <v-expansion-panel :value="INSTANCED_TILING_COMPONENT_TYPE">
    <v-expansion-panel-title>
      <div style="display:flex;align-items:center;width:100%;gap:0.4rem;">
        <span style="font-weight:600;">Instanced Tiling</span>
        <v-spacer />
        <span style="font-size:0.78rem;opacity:0.78;">{{ hasTemplateAsset ? 'Active' : '未绑定模型' }}</span>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="tiling-template">
        <div class="template-row">
          <span class="template-label">Template</span>
          <span class="template-value" v-if="hasTemplateAsset">
            <span v-if="templateAsset">{{ templateAsset.name }} · {{ templateAssetId.slice(0, 8) }}</span>
            <span v-else>{{ templateAssetId.slice(0, 8) }}</span>
          </span>
          <span class="template-value" v-else>未绑定模型：请先在「Asset Model」面板给该节点绑定一个 model/mesh 资源</span>
        </div>
        <p v-if="feedbackMessage" class="asset-feedback">{{ feedbackMessage }}</p>
      </div>

      <v-select
        v-model="localMode"
        label="Mode"
        density="compact"
        variant="underlined"
        :items="[
          { title: 'Axis (XYZ)', value: 'axis' },
          { title: 'Vector (Tilted)', value: 'vector' },
        ]"
        @update:modelValue="applyModeUpdate"
      />

      <div class="tiling-grid-3">
        <v-text-field
          v-model.number="localCountX"
          label="Count X"
          type="number"
          density="compact"
          variant="underlined"
          min="1"
          step="1"
          @update:modelValue="(v) => applyCountLive('x', v)"
          @blur="() => applyCountUpdate('x')"
          @keydown.enter.prevent="() => applyCountUpdate('x')"
        />
        <v-text-field
          v-model.number="localCountY"
          label="Count Y"
          type="number"
          density="compact"
          variant="underlined"
          min="1"
          step="1"
          @update:modelValue="(v) => applyCountLive('y', v)"
          @blur="() => applyCountUpdate('y')"
          @keydown.enter.prevent="() => applyCountUpdate('y')"
        />
        <v-text-field
          v-model.number="localCountZ"
          label="Count Z"
          type="number"
          density="compact"
          variant="underlined"
          min="1"
          step="1"
          @update:modelValue="(v) => applyCountLive('z', v)"
          @blur="() => applyCountUpdate('z')"
          @keydown.enter.prevent="() => applyCountUpdate('z')"
        />
      </div>

      <div class="tiling-grid-3">
        <v-text-field
          v-model.number="localSpacingX"
          label="Spacing X"
          type="number"
          density="compact"
          variant="underlined"
          step="0.1"
          @update:modelValue="(v) => applySpacingLive('x', v)"
          @blur="() => applySpacingUpdate('x')"
          @keydown.enter.prevent="() => applySpacingUpdate('x')"
        />
        <v-text-field
          v-model.number="localSpacingY"
          label="Spacing Y"
          type="number"
          density="compact"
          variant="underlined"
          step="0.1"
          @update:modelValue="(v) => applySpacingLive('y', v)"
          @blur="() => applySpacingUpdate('y')"
          @keydown.enter.prevent="() => applySpacingUpdate('y')"
        />
        <v-text-field
          v-model.number="localSpacingZ"
          label="Spacing Z"
          type="number"
          density="compact"
          variant="underlined"
          step="0.1"
          @update:modelValue="(v) => applySpacingLive('z', v)"
          @blur="() => applySpacingUpdate('z')"
          @keydown.enter.prevent="() => applySpacingUpdate('z')"
        />
      </div>

      <div v-if="localMode === 'vector'" class="tiling-vector-section">
        <InspectorVectorControls
          label="Forward (local)"
          :model-value="localForward"
          @update:axis="(axis, value) => applyVectorAxisUpdate('forward', axis, value)"
        />
        <InspectorVectorControls
          label="Up (local)"
          :model-value="localUp"
          @update:axis="(axis, value) => applyVectorAxisUpdate('up', axis, value)"
        />
        <v-text-field
          v-model.number="localRollDegrees"
          label="Roll (degrees)"
          type="number"
          density="compact"
          variant="underlined"
          step="1"
          @update:modelValue="applyRollDegreesLive"
          @blur="applyRollDegreesUpdate"
          @keydown.enter.prevent="applyRollDegreesUpdate"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>

.tiling-template {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 0.75rem;
}

.template-row {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
}

.template-label {
  font-size: 0.8rem;
  opacity: 0.75;
  min-width: 4.5rem;
}

.template-value {
  font-size: 0.85rem;
}

.asset-feedback {
  font-size: 0.75rem;
  color: #f97316;
}

.tiling-grid-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.6rem;
  margin-top: 0.4rem;
}

.tiling-vector-section {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-top: 0.6rem;
}
</style>
