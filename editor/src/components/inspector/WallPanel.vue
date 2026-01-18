<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { SceneNodeComponentState } from '@harmony/schema'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'
import AssetDialog from '@/components/common/AssetDialog.vue'
import type { ProjectAsset } from '@/types/project-asset'

import {
  WALL_COMPONENT_TYPE,
  WALL_DEFAULT_HEIGHT,
  WALL_DEFAULT_THICKNESS,
  WALL_DEFAULT_WIDTH,
  WALL_DEFAULT_SMOOTHING,
  WALL_MIN_HEIGHT,
  WALL_MIN_THICKNESS,
  WALL_MIN_WIDTH,
  type WallComponentProps,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId, draggingAssetId } = storeToRefs(sceneStore)

const localHeight = ref<number>(WALL_DEFAULT_HEIGHT)
const localWidth = ref<number>(WALL_DEFAULT_WIDTH)
const localThickness = ref<number>(WALL_DEFAULT_THICKNESS)
const localSmoothing = ref<number>(WALL_DEFAULT_SMOOTHING)
const localIsAirWall = ref<boolean>(false)

const isSyncingFromScene = ref(false)
const isApplyingDimensions = ref(false)

const assetDialogVisible = ref(false)
const assetDialogSelectedId = ref('')
const assetDialogAnchor = ref<{ x: number; y: number } | null>(null)
const assetDialogTarget = ref<'body' | 'joint' | 'cap' | null>(null)
const assetDialogTitle = computed(() => {
  if (assetDialogTarget.value === 'joint') {
    return 'Select Wall Joint Asset'
  }
  if (assetDialogTarget.value === 'cap') {
    return 'Select Wall End Cap Asset'
  }
  return 'Select Wall Body Asset'
})

const wallComponent = computed(
  () => selectedNode.value?.components?.[WALL_COMPONENT_TYPE] as SceneNodeComponentState<WallComponentProps> | undefined,
)


const bodyDropAreaRef = ref<HTMLElement | null>(null)
const jointDropAreaRef = ref<HTMLElement | null>(null)
const capDropAreaRef = ref<HTMLElement | null>(null)
const bodyDropActive = ref(false)
const jointDropActive = ref(false)
const capDropActive = ref(false)
const bodyDropProcessing = ref(false)
const jointDropProcessing = ref(false)
const capDropProcessing = ref(false)
const bodyFeedbackMessage = ref<string | null>(null)
const jointFeedbackMessage = ref<string | null>(null)
const capFeedbackMessage = ref<string | null>(null)

const bodyAsset = computed(() => {
  const assetId = wallComponent.value?.props?.bodyAssetId
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

const jointAsset = computed(() => {
  const assetId = wallComponent.value?.props?.jointAssetId
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

const capAsset = computed(() => {
  const assetId = (wallComponent.value?.props as any)?.endCapAssetId as string | null | undefined
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

watch(
  () => wallComponent.value?.props,
  (props) => {
    if (!props) {
      return
    }
    isSyncingFromScene.value = true
    localHeight.value = props.height ?? WALL_DEFAULT_HEIGHT
    localWidth.value = props.width ?? WALL_DEFAULT_WIDTH
    localThickness.value = props.thickness ?? WALL_DEFAULT_THICKNESS
    localIsAirWall.value = Boolean((props as any).isAirWall)
    localSmoothing.value = Number.isFinite(props.smoothing)
      ? Math.min(1, Math.max(0, props.smoothing))
      : WALL_DEFAULT_SMOOTHING
    nextTick(() => {
      isSyncingFromScene.value = false
    })
  },
  { immediate: true, deep: true },
)

watch(selectedNode, () => {
  bodyDropActive.value = false
  jointDropActive.value = false
  capDropActive.value = false
  bodyDropProcessing.value = false
  jointDropProcessing.value = false
  capDropProcessing.value = false
  bodyFeedbackMessage.value = null
  jointFeedbackMessage.value = null
  capFeedbackMessage.value = null
})

watch(assetDialogVisible, (open) => {
  if (open) {
    return
  }
  assetDialogAnchor.value = null
  assetDialogSelectedId.value = ''
  assetDialogTarget.value = null
})

const smoothingDisplay = computed(() => `${Math.round(localSmoothing.value * 100)}%`)

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

function shouldDeactivateDropArea(target: HTMLElement | null, event: DragEvent): boolean {
  const related = event.relatedTarget as Node | null
  if (!target || (related && target.contains(related))) {
    return false
  }
  return true
}

function validateWallAssetId(assetId: string): string | null {
  const asset = sceneStore.getAsset(assetId)
  if (!asset || (asset.type !== 'model' && asset.type !== 'mesh')) {
    return 'Only model assets can be assigned here.'
  }
  return null
}

function openWallAssetDialog(target: 'body' | 'joint' | 'cap', event?: MouseEvent): void {
  assetDialogTarget.value = target
  assetDialogSelectedId.value =
    target === 'body'
      ? wallComponent.value?.props?.bodyAssetId ?? ''
      : target === 'joint'
        ? wallComponent.value?.props?.jointAssetId ?? ''
        : ((wallComponent.value?.props as any)?.endCapAssetId ?? '')
  assetDialogAnchor.value = event ? { x: event.clientX, y: event.clientY } : null
  assetDialogVisible.value = true
}

function handleWallAssetDialogUpdate(asset: ProjectAsset | null): void {
  const nodeId = selectedNodeId.value
  const component = wallComponent.value
  const target = assetDialogTarget.value
  if (!nodeId || !component || !target) {
    assetDialogVisible.value = false
    return
  }
  if (!asset) {
    if (target === 'body') {
      bodyFeedbackMessage.value = null
      sceneStore.updateNodeComponentProps(nodeId, component.id, { bodyAssetId: null })
    } else if (target === 'joint') {
      jointFeedbackMessage.value = null
      sceneStore.updateNodeComponentProps(nodeId, component.id, { jointAssetId: null })
    } else {
      capFeedbackMessage.value = null
      sceneStore.updateNodeComponentProps(nodeId, component.id, { endCapAssetId: null } as any)
    }
    assetDialogVisible.value = false
    return
  }
  if (asset.type !== 'model' && asset.type !== 'mesh') {
    console.warn('Selected asset is not a model/mesh')
    return
  }

  if (target === 'body') {
    bodyFeedbackMessage.value = null
    sceneStore.updateNodeComponentProps(nodeId, component.id, { bodyAssetId: asset.id })
  } else if (target === 'joint') {
    jointFeedbackMessage.value = null
    sceneStore.updateNodeComponentProps(nodeId, component.id, { jointAssetId: asset.id })
  } else {
    capFeedbackMessage.value = null
    sceneStore.updateNodeComponentProps(nodeId, component.id, { endCapAssetId: asset.id } as any)
  }
  assetDialogVisible.value = false
}

function handleWallAssetDialogCancel(): void {
  assetDialogVisible.value = false
}

async function assignWallBodyAsset(event: DragEvent) {
  event.preventDefault()
  bodyDropActive.value = false
  bodyFeedbackMessage.value = null

  const nodeId = selectedNodeId.value
  const component = wallComponent.value
  if (!nodeId || !component) {
    return
  }
  if (bodyDropProcessing.value) {
    return
  }

  const assetId = resolveDragAssetId(event)
  if (!assetId) {
    bodyFeedbackMessage.value = 'Drag a model asset from the Asset Panel.'
    return
  }

  const invalid = validateWallAssetId(assetId)
  if (invalid) {
    bodyFeedbackMessage.value = invalid
    return
  }

  if (assetId === wallComponent.value?.props?.bodyAssetId) {
    bodyFeedbackMessage.value = 'This model is already assigned.'
    return
  }

  bodyDropProcessing.value = true
  try {
    sceneStore.updateNodeComponentProps(nodeId, component.id, { bodyAssetId: assetId })
  } catch (error) {
    console.error('Failed to assign wall body asset model', error)
    bodyFeedbackMessage.value = (error as Error).message ?? 'Failed to assign the model asset.'
  } finally {
    bodyDropProcessing.value = false
  }
}

async function assignWallJointAsset(event: DragEvent) {
  event.preventDefault()
  jointDropActive.value = false
  jointFeedbackMessage.value = null

  const nodeId = selectedNodeId.value
  const component = wallComponent.value
  if (!nodeId || !component) {
    return
  }
  if (jointDropProcessing.value) {
    return
  }

  const assetId = resolveDragAssetId(event)
  if (!assetId) {
    jointFeedbackMessage.value = 'Drag a model asset from the Asset Panel.'
    return
  }

  const invalid = validateWallAssetId(assetId)
  if (invalid) {
    jointFeedbackMessage.value = invalid
    return
  }

  if (assetId === wallComponent.value?.props?.jointAssetId) {
    jointFeedbackMessage.value = 'This model is already assigned.'
    return
  }

  jointDropProcessing.value = true
  try {
    sceneStore.updateNodeComponentProps(nodeId, component.id, { jointAssetId: assetId })
  } catch (error) {
    console.error('Failed to assign wall joint asset model', error)
    jointFeedbackMessage.value = (error as Error).message ?? 'Failed to assign the model asset.'
  } finally {
    jointDropProcessing.value = false
  }
}

async function assignWallCapAsset(event: DragEvent) {
  event.preventDefault()
  capDropActive.value = false
  capFeedbackMessage.value = null

  const nodeId = selectedNodeId.value
  const component = wallComponent.value
  if (!nodeId || !component) {
    return
  }
  if (capDropProcessing.value) {
    return
  }

  const assetId = resolveDragAssetId(event)
  if (!assetId) {
    capFeedbackMessage.value = 'Drag a model asset from the Asset Panel.'
    return
  }

  const invalid = validateWallAssetId(assetId)
  if (invalid) {
    capFeedbackMessage.value = invalid
    return
  }

  if (assetId === (wallComponent.value?.props as any)?.endCapAssetId) {
    capFeedbackMessage.value = 'This model is already assigned.'
    return
  }

  capDropProcessing.value = true
  try {
    sceneStore.updateNodeComponentProps(nodeId, component.id, { endCapAssetId: assetId } as any)
  } catch (error) {
    console.error('Failed to assign wall end cap asset model', error)
    capFeedbackMessage.value = (error as Error).message ?? 'Failed to assign the model asset.'
  } finally {
    capDropProcessing.value = false
  }
}

watch([
  localHeight,
  localWidth,
  localThickness,
], ([height, width, thickness], [prevHeight, prevWidth, prevThickness]) => {
  if (isSyncingFromScene.value || isApplyingDimensions.value) {
    return
  }

  if (!Number.isFinite(height) || !Number.isFinite(width) || !Number.isFinite(thickness)) {
    return
  }

  if (height === prevHeight && width === prevWidth && thickness === prevThickness) {
    return
  }

  applyDimensions()
})

function handleToggleComponent() {
  const component = wallComponent.value
  const nodeId = selectedNodeId.value

  if (!component || !nodeId) {
    return
  }

  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = wallComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}

function clampDimension(value: number, fallback: number, min: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback
  }
  return Math.max(min, value)
}

function applyDimensions() {
  if (isApplyingDimensions.value) {
    return
  }

  const component = wallComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }

  isApplyingDimensions.value = true
  const props = (component.props ?? {}) as Partial<WallComponentProps>

  try {
    const nextHeight = clampDimension(Number(localHeight.value), props.height ?? WALL_DEFAULT_HEIGHT, WALL_MIN_HEIGHT)
    const nextWidth = clampDimension(Number(localWidth.value), props.width ?? WALL_DEFAULT_WIDTH, WALL_MIN_WIDTH)
    const nextThickness = clampDimension(Number(localThickness.value), props.thickness ?? WALL_DEFAULT_THICKNESS, WALL_MIN_THICKNESS)

    const hasChanges =
      props.height !== nextHeight ||
      props.width !== nextWidth ||
      props.thickness !== nextThickness

    if (localHeight.value !== nextHeight) {
      localHeight.value = nextHeight
    }
    if (localWidth.value !== nextWidth) {
      localWidth.value = nextWidth
    }
    if (localThickness.value !== nextThickness) {
      localThickness.value = nextThickness
    }

    if (hasChanges) {
      sceneStore.updateNodeComponentProps(nodeId, component.id, {
        height: nextHeight,
        width: nextWidth,
        thickness: nextThickness,
      })
    }
  } finally {
    nextTick(() => {
      isApplyingDimensions.value = false
    })
  }
}

function applySmoothingUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = wallComponent.value
  if (!nodeId || !component) {
    return
  }
  const value = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  if (!Number.isFinite(value)) {
    return
  }
  const clamped = Math.min(1, Math.max(0, value))
  const current = typeof component.props?.smoothing === 'number'
    ? component.props.smoothing
    : WALL_DEFAULT_SMOOTHING
  if (Math.abs(current - clamped) <= 1e-6) {
    return
  }
  if (localSmoothing.value !== clamped) {
    localSmoothing.value = clamped
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { smoothing: clamped })
}

function applyAirWallUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = wallComponent.value
  if (!nodeId || !component) {
    return
  }
  const nextValue = Boolean(rawValue)
  const current = Boolean((component.props as any)?.isAirWall)
  if (nextValue === current) {
    return
  }
  if (localIsAirWall.value !== nextValue) {
    localIsAirWall.value = nextValue
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { isAirWall: nextValue } as any)
}
</script>

<template>
  <v-expansion-panel value="wall">
    <v-expansion-panel-title>
      <div class="wall-panel-header">
        <span class="wall-panel-title">Wall</span>
        <v-spacer />
        <v-menu
          v-if="wallComponent"
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
            <v-list-item
              @click.stop="handleToggleComponent()"
            >
              <v-list-item-title>
                {{ wallComponent.enabled ? 'Disable' : 'Enable' }}
              </v-list-item-title>
            </v-list-item>
            <v-divider class="component-menu-divider" inset />
            <v-list-item
              @click.stop="handleRemoveComponent()"
            >
              <v-list-item-title>Remove</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="wall-field-grid">
        <div class="wall-field-labels">
          <span>Corner Smoothness</span>
          <span>{{ smoothingDisplay }}</span>
        </div>
        <v-slider
          :model-value="localSmoothing"
          :min="0"
          :max="1"
          :step="0.01"
          density="compact"
          track-color="rgba(77, 208, 225, 0.4)"
          color="primary"
          @update:modelValue="(value) => { localSmoothing = Number(value); applySmoothingUpdate(value) }"
        />
        <v-text-field
          v-model.number="localHeight"
          label="Height (m)"
          type="number"
          density="compact"
          variant="underlined"
          class="slider-input"
          step="0.1"
          min="0.5"
          @blur="applyDimensions"
          inputmode="decimal"
          @keydown.enter.prevent="applyDimensions"
        />
        <v-text-field
          v-model.number="localWidth"
          label="Width (m)"
          type="number"
          density="compact"
          variant="underlined"
          class="slider-input"
          step="0.05"
          min="0.1"
          @blur="applyDimensions"
          inputmode="decimal"
          @keydown.enter.prevent="applyDimensions"
        />
        <v-text-field
          v-model.number="localThickness"
          label="Thickness (m)"
          type="number"
          class="slider-input"
          density="compact"
                inputmode="decimal"
          variant="underlined"
          step="0.05"
          min="0.05"
          @blur="applyDimensions"
          @keydown.enter.prevent="applyDimensions"
        />
        <v-switch
          :model-value="localIsAirWall"
          label="Air Wall"
          density="compact"
          hide-details
          @update:modelValue="(value) => { localIsAirWall = Boolean(value); applyAirWallUpdate(value) }"
        />
      </div>

      <div class="wall-asset-section">
        <div
          class="asset-model-panel"
          ref="bodyDropAreaRef"
          :class="{ 'is-active': bodyDropActive, 'is-processing': bodyDropProcessing }"
          @dragenter.prevent="bodyDropActive = true"
          @dragover.prevent="bodyDropActive = true"
          @dragleave="(e) => { if (shouldDeactivateDropArea(bodyDropAreaRef, e)) bodyDropActive = false }"
          @drop="assignWallBodyAsset"
        >
          <div v-if="bodyAsset" class="asset-summary">
            <div
              class="asset-thumbnail"
              :style="bodyAsset.thumbnail?.trim() ? { backgroundImage: `url(${bodyAsset.thumbnail})` } : (bodyAsset.previewColor ? { backgroundColor: bodyAsset.previewColor } : undefined)"
              @click.stop="openWallAssetDialog('body', $event)"
            />
            <div class="asset-text">
              <div class="asset-name">{{ bodyAsset.name }}</div>
              <div class="asset-subtitle">Wall body model · {{ bodyAsset.id.slice(0, 8) }}</div>
            </div>
          </div>
          <div v-else class="asset-summary empty">
            <div
              class="asset-thumbnail placeholder"
              @click.stop="openWallAssetDialog('body', $event)"
            />
            <div class="asset-text">
              <div class="asset-name">No wall body model assigned</div>
            </div>
          </div>
          <p v-if="bodyFeedbackMessage" class="asset-feedback">{{ bodyFeedbackMessage }}</p>
        </div>

        <div
          class="asset-model-panel"
          ref="capDropAreaRef"
          :class="{ 'is-active': capDropActive, 'is-processing': capDropProcessing }"
          @dragenter.prevent="capDropActive = true"
          @dragover.prevent="capDropActive = true"
          @dragleave="(e) => { if (shouldDeactivateDropArea(capDropAreaRef, e)) capDropActive = false }"
          @drop="assignWallCapAsset"
        >
          <div v-if="capAsset" class="asset-summary">
            <div
              class="asset-thumbnail"
              :style="capAsset.thumbnail?.trim() ? { backgroundImage: `url(${capAsset.thumbnail})` } : (capAsset.previewColor ? { backgroundColor: capAsset.previewColor } : undefined)"
              @click.stop="openWallAssetDialog('cap', $event)"
            />
            <div class="asset-text">
              <div class="asset-name">{{ capAsset.name }}</div>
              <div class="asset-subtitle">Wall end cap model · {{ capAsset.id.slice(0, 8) }}</div>
            </div>
          </div>
          <div v-else class="asset-summary empty">
            <div
              class="asset-thumbnail placeholder"
              @click.stop="openWallAssetDialog('cap', $event)"
            />
            <div class="asset-text">
              <div class="asset-name">Select End Cap Asset</div>
              <div class="asset-subtitle">Drag model/mesh here</div>
            </div>
          </div>
          <p v-if="capFeedbackMessage" class="asset-feedback">{{ capFeedbackMessage }}</p>
        </div>

        <div
          class="asset-model-panel"
          ref="jointDropAreaRef"
          :class="{ 'is-active': jointDropActive, 'is-processing': jointDropProcessing }"
          @dragenter.prevent="jointDropActive = true"
          @dragover.prevent="jointDropActive = true"
          @dragleave="(e) => { if (shouldDeactivateDropArea(jointDropAreaRef, e)) jointDropActive = false }"
          @drop="assignWallJointAsset"
        >
          <div v-if="jointAsset" class="asset-summary">
            <div
              class="asset-thumbnail"
              :style="jointAsset.thumbnail?.trim() ? { backgroundImage: `url(${jointAsset.thumbnail})` } : (jointAsset.previewColor ? { backgroundColor: jointAsset.previewColor } : undefined)"
              @click.stop="openWallAssetDialog('joint', $event)"
            />
            <div class="asset-text">
              <div class="asset-name">{{ jointAsset.name }}</div>
              <div class="asset-subtitle">Wall joint model · {{ jointAsset.id.slice(0, 8) }}</div>
            </div>
          </div>
          <div v-else class="asset-summary empty">
            <div
              class="asset-thumbnail placeholder"
              @click.stop="openWallAssetDialog('joint', $event)"
            />
            <div class="asset-text">
              <div class="asset-name">No wall joint model assigned</div>
            </div>
          </div>
          <p v-if="jointFeedbackMessage" class="asset-feedback">{{ jointFeedbackMessage }}</p>
        </div>
      </div>

      <AssetDialog
        v-model="assetDialogVisible"
        v-model:assetId="assetDialogSelectedId"
        assetType="model,mesh"
        :title="assetDialogTitle"
        :anchor="assetDialogAnchor"
        @update:asset="handleWallAssetDialogUpdate"
        @cancel="handleWallAssetDialogCancel"
      />
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.wall-field-grid {
  display: grid;
  gap: 0.2rem;
  margin: 0px 5px;
}

.wall-field-labels {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
  opacity: 0.9;
}

.hint-text {
  display: block;
  margin-top: 0.25rem;
  color: rgba(220, 225, 232, 0.65);
}

.v-field-label {
  font-size: 0.82rem;
}
.slider-input :deep(.v-field-label) {
  font-size: 0.82rem;
  font-weight: 600;
}

.wall-panel-placeholder {
  color: rgba(233, 236, 241, 0.65);
  font-size: 0.85rem;
}

.wall-panel-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.wall-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.wall-asset-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 0.75rem 5px 0;
}

.asset-model-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 0.75rem;
  transition: border-color 0.2s, background-color 0.2s;
}

.asset-model-panel.is-active {
  border-color: rgba(110, 231, 183, 0.8);
  background-color: rgba(110, 231, 183, 0.08);
}

.asset-model-panel.is-processing {
  border-color: rgba(59, 130, 246, 0.9);
  background-color: rgba(59, 130, 246, 0.08);
}

.asset-summary {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.asset-summary.empty .asset-text .asset-name {
  font-size: 0.85rem;
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
</style>
