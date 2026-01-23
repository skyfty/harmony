<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { SceneNodeComponentState, Vector3Like } from '@harmony/schema'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'
import AssetPickerDialog from '@/components/common/AssetPickerDialog.vue'
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
const { selectedNode, selectedNodeId, draggingAssetId } = storeToRefs(sceneStore)

const componentState = computed(() => {
  const component = selectedNode.value?.components?.[INSTANCED_TILING_COMPONENT_TYPE]
  if (!component) {
    return null
  }
  return component as SceneNodeComponentState<InstancedTilingComponentProps>
})

const hasMeshSelected = computed(() => Boolean(componentState.value?.props?.meshId?.trim()))

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

const currentMeshAsset = computed(() => {
  const assetId = componentState.value?.props?.meshId
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

const meshPreviewStyle = computed(() => {
  const asset = currentMeshAsset.value
  if (!asset) {
    return undefined
  }
  if (asset.thumbnail?.trim()) {
    return { backgroundImage: `url(${asset.thumbnail})` }
  }
  if (asset.previewColor) {
    return { backgroundColor: asset.previewColor }
  }
  return undefined
})

const assetDialogVisible = ref(false)
const assetDialogSelectedId = ref('')
const assetDialogAnchor = ref<{ x: number; y: number } | null>(null)

function openAssetDialog(event: MouseEvent): void {
  assetDialogSelectedId.value = componentState.value?.props?.meshId ?? ''
  assetDialogAnchor.value = { x: event.clientX, y: event.clientY }
  assetDialogVisible.value = true
}

function applyPatch(patch: Partial<InstancedTilingComponentProps>): void {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = componentState.value
  if (!nodeId || !component) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, patch as Partial<Record<string, unknown>>)
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

function serializeAssetDragPayload(raw: string | null): string | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as { assetId?: string }
    if (parsed?.assetId) {
      return parsed.assetId
    }
  } catch (error) {
    console.warn('Unable to parse asset drag payload', error)
  }
  return null
}

function resolveDragAssetId(event: DragEvent): string | null {
  if (event.dataTransfer) {
    const payload = serializeAssetDragPayload(event.dataTransfer.getData(ASSET_DRAG_MIME))
    if (payload) {
      return payload
    }
  }
  return draggingAssetId.value ?? null
}

function validateMeshAssetId(assetId: string): string | null {
  const asset = sceneStore.getAsset(assetId)
  if (!asset || (asset.type !== 'model' && asset.type !== 'mesh')) {
    return 'Only model/mesh assets can be assigned here.'
  }
  return null
}

const dropAreaRef = ref<HTMLElement | null>(null)
const dropActive = ref(false)
const feedbackMessage = ref<string | null>(null)

function handleDragEnter(event: DragEvent) {
  const assetId = resolveDragAssetId(event)
  if (!assetId) {
    return
  }
  const invalid = validateMeshAssetId(assetId)
  if (invalid) {
    return
  }
  dropActive.value = true
  event.preventDefault()
}

function handleDragOver(event: DragEvent) {
  const assetId = resolveDragAssetId(event)
  if (!assetId) {
    return
  }
  const invalid = validateMeshAssetId(assetId)
  if (invalid) {
    return
  }
  dropActive.value = true
  event.preventDefault()
}

function handleDragLeave(event: DragEvent) {
  const related = event.relatedTarget as Node | null
  if (!dropAreaRef.value || (related && dropAreaRef.value.contains(related))) {
    return
  }
  dropActive.value = false
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  dropActive.value = false
  feedbackMessage.value = null

  const component = componentState.value
  if (!component) {
    return
  }

  const assetId = resolveDragAssetId(event)
  if (!assetId) {
    feedbackMessage.value = 'Drag a model/mesh asset from the Asset Panel.'
    return
  }
  const invalid = validateMeshAssetId(assetId)
  if (invalid) {
    feedbackMessage.value = invalid
    return
  }

  if (assetId === component.props.meshId) {
    return
  }

  applyPatch({ meshId: assetId })
}

function handleAssetDialogUpdate(asset: { id: string } | null) {
  if (!asset) {
    return
  }
  applyPatch({ meshId: asset.id })
}

function handleAssetDialogCancel() {
  assetDialogVisible.value = false
}

function clearMeshSelection() {
  applyPatch({ meshId: '' })
}
</script>

<template>
  <v-expansion-panel :value="INSTANCED_TILING_COMPONENT_TYPE">
    <v-expansion-panel-title>
      <div style="display:flex;align-items:center;width:100%;gap:0.4rem;">
        <span style="font-weight:600;">Instanced Tiling</span>
        <v-spacer />
        <span style="font-size:0.78rem;opacity:0.78;">{{ hasMeshSelected ? 'Active' : '未选择 mesh' }}</span>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div
        class="tiling-asset-drop"
        ref="dropAreaRef"
        :class="{ 'is-active': dropActive }"
        @dragenter="handleDragEnter"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
        @drop="handleDrop"
      >
        <div v-if="currentMeshAsset" class="asset-summary">
          <div class="asset-thumbnail" :style="meshPreviewStyle" @click.stop="openAssetDialog($event as any)" />
          <div class="asset-text">
            <div class="asset-name">{{ currentMeshAsset.name }}</div>
            <div class="asset-subtitle">Model/mesh · {{ currentMeshAsset.id.slice(0, 8) }}</div>
          </div>
          <v-spacer />
          <v-btn size="x-small" variant="text" @click.stop="clearMeshSelection">Clear</v-btn>
        </div>
        <div v-else class="asset-summary empty">
          <div class="asset-thumbnail placeholder" @click.stop="openAssetDialog($event as any)" />
          <div class="asset-text">
            <div class="asset-name">未选择 mesh</div>
            <div class="asset-subtitle">拖拽一个 model/mesh 资源或点击选择</div>
          </div>
        </div>
        <p v-if="feedbackMessage" class="asset-feedback">{{ feedbackMessage }}</p>
      </div>

      <div v-if="!hasMeshSelected" class="tiling-warning">
        未选择 mesh：请选择一个 model/mesh 资源后再调整平铺参数。
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
        :disabled="!hasMeshSelected"
        @update:modelValue="applyModeUpdate"
      />

      <div class="tiling-grid-3">
        <v-text-field
          v-model.number="localCountX"
          label="Count X"
          type="number"
          density="compact"
          variant="underlined"
          :disabled="!hasMeshSelected"
          min="1"
          step="1"
          @blur="() => applyCountUpdate('x')"
          @keydown.enter.prevent="() => applyCountUpdate('x')"
        />
        <v-text-field
          v-model.number="localCountY"
          label="Count Y"
          type="number"
          density="compact"
          variant="underlined"
          :disabled="!hasMeshSelected"
          min="1"
          step="1"
          @blur="() => applyCountUpdate('y')"
          @keydown.enter.prevent="() => applyCountUpdate('y')"
        />
        <v-text-field
          v-model.number="localCountZ"
          label="Count Z"
          type="number"
          density="compact"
          variant="underlined"
          :disabled="!hasMeshSelected"
          min="1"
          step="1"
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
          :disabled="!hasMeshSelected"
          step="0.1"
          @blur="() => applySpacingUpdate('x')"
          @keydown.enter.prevent="() => applySpacingUpdate('x')"
        />
        <v-text-field
          v-model.number="localSpacingY"
          label="Spacing Y"
          type="number"
          density="compact"
          variant="underlined"
          :disabled="!hasMeshSelected"
          step="0.1"
          @blur="() => applySpacingUpdate('y')"
          @keydown.enter.prevent="() => applySpacingUpdate('y')"
        />
        <v-text-field
          v-model.number="localSpacingZ"
          label="Spacing Z"
          type="number"
          density="compact"
          variant="underlined"
          :disabled="!hasMeshSelected"
          step="0.1"
          @blur="() => applySpacingUpdate('z')"
          @keydown.enter.prevent="() => applySpacingUpdate('z')"
        />
      </div>

      <div v-if="localMode === 'vector'" class="tiling-vector-section">
        <InspectorVectorControls
          label="Forward (local)"
          :model-value="localForward"
          :disabled="!hasMeshSelected"
          @update:axis="(axis, value) => applyVectorAxisUpdate('forward', axis, value)"
        />
        <InspectorVectorControls
          label="Up (local)"
          :model-value="localUp"
          :disabled="!hasMeshSelected"
          @update:axis="(axis, value) => applyVectorAxisUpdate('up', axis, value)"
        />
        <v-text-field
          v-model.number="localRollDegrees"
          label="Roll (degrees)"
          type="number"
          density="compact"
          variant="underlined"
          :disabled="!hasMeshSelected"
          step="1"
          @blur="applyRollDegreesUpdate"
          @keydown.enter.prevent="applyRollDegreesUpdate"
        />
      </div>

      <AssetPickerDialog
        v-model="assetDialogVisible"
        :asset-id="assetDialogSelectedId"
        assetType="model,mesh"
        title="Select Mesh Asset"
        :anchor="assetDialogAnchor"
        @update:asset="handleAssetDialogUpdate"
        @cancel="handleAssetDialogCancel"
      />
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.tiling-asset-drop {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 0.75rem;
  transition: border-color 0.2s, background-color 0.2s;
}

.tiling-asset-drop.is-active {
  border-color: rgba(110, 231, 183, 0.8);
  background-color: rgba(110, 231, 183, 0.08);
}

.asset-summary {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.asset-thumbnail {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  background-size: cover;
  background-position: center;
  cursor: pointer;
}

.asset-thumbnail.placeholder {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02));
}

.asset-text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.asset-name {
  font-weight: 600;
  font-size: 0.9rem;
}

.asset-subtitle {
  font-size: 0.75rem;
  color: rgba(233, 236, 241, 0.7);
}

.asset-feedback {
  font-size: 0.75rem;
  color: #f97316;
}

.tiling-warning {
  margin-top: 0.6rem;
  margin-bottom: 0.4rem;
  font-size: 0.8rem;
  color: rgba(245, 158, 11, 0.95);
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
