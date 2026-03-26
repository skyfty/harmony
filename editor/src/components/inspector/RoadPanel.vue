<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { RoadDynamicMesh } from '@schema'
import type { SceneNodeComponentState } from '@schema'
import { ROAD_COMPONENT_TYPE, ROAD_DEFAULT_JUNCTION_SMOOTHING } from '@schema/components'
import type { RoadComponentProps } from '@schema/components'
import type { ProjectAsset } from '@/types/project-asset'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'
import { buildRoadPresetFilename, isRoadPresetFilename } from '@/utils/roadPreset'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId, draggingAssetId } = storeToRefs(sceneStore)

const roadDynamicMesh = computed(() => {
  const mesh = selectedNode.value?.dynamicMesh
  if (!mesh || mesh.type !== 'Road') {
    return null
  }
  return mesh as RoadDynamicMesh
})

const roadComponent = computed(() => {
  const component = selectedNode.value?.components?.[ROAD_COMPONENT_TYPE]
  if (!component) {
    return null
  }
  return component as SceneNodeComponentState<RoadComponentProps>
})

const localWidth = ref<number>(2)
const localJunctionSmoothing = ref<number>(ROAD_DEFAULT_JUNCTION_SMOOTHING)
const localLaneLines = ref<boolean>(false)
const localShoulders = ref<boolean>(false)
const localSnapToTerrain = ref<boolean>(false)
const localSamplingDensityFactor = ref<number>(1.0)
const localSmoothingStrengthFactor = ref<number>(1.0)
const localMinClearance = ref<number>(0.01)
const localLaneLineWidth = ref<number | undefined>(undefined)
const localShoulderWidth = ref<number | undefined>(undefined)
const isSyncingFromScene = ref(false)

const panelDropAreaRef = ref<HTMLElement | null>(null)
const roadPresetDropActive = ref(false)
const roadPresetFeedbackMessage = ref<string | null>(null)

const savePresetDialogVisible = ref(false)
const savePresetName = ref('')
const overwriteConfirmDialogVisible = ref(false)
const overwriteTargetAssetId = ref<string | null>(null)
const overwriteTargetFilename = ref<string | null>(null)

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

function isRoadPresetAsset(asset: ProjectAsset | null): boolean {
  if (!asset) {
    return false
  }
  return isRoadPresetFilename(asset.description ?? asset.name ?? null)
}

function resolveRoadPresetAssetId(event: DragEvent): string | null {
  const assetId = resolveDragAssetId(event)
  if (!assetId) {
    return null
  }
  const asset = sceneStore.getAsset(assetId)
  if (!isRoadPresetAsset(asset)) {
    return null
  }
  return assetId
}

function handleRoadPresetDragEnterCapture(event: DragEvent): void {
  const presetId = resolveRoadPresetAssetId(event)
  if (!presetId) {
    return
  }
  roadPresetDropActive.value = true
  roadPresetFeedbackMessage.value = null
  event.preventDefault()
  event.stopPropagation()
}

function handleRoadPresetDragOverCapture(event: DragEvent): void {
  const presetId = resolveRoadPresetAssetId(event)
  if (!presetId) {
    return
  }
  roadPresetDropActive.value = true
  roadPresetFeedbackMessage.value = null
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  event.preventDefault()
  event.stopPropagation()
}

function handleRoadPresetDragLeaveCapture(event: DragEvent): void {
  if (shouldDeactivateDropArea(panelDropAreaRef.value, event)) {
    roadPresetDropActive.value = false
  }
}

async function handleRoadPresetDropCapture(event: DragEvent): Promise<void> {
  const presetId = resolveRoadPresetAssetId(event)
  if (!presetId) {
    return
  }

  roadPresetDropActive.value = false
  roadPresetFeedbackMessage.value = null
  event.preventDefault()
  event.stopPropagation()

  try {
    await sceneStore.applyRoadPresetToSelectedRoad(presetId)
  } catch (error) {
    console.error('Failed to apply road preset', error)
    roadPresetFeedbackMessage.value = (error as Error).message ?? 'Failed to apply road preset.'
  }
}

function openSaveRoadPresetDialog(): void {
  if (!roadComponent.value || !roadDynamicMesh.value) {
    return
  }
  roadPresetFeedbackMessage.value = null
  overwriteConfirmDialogVisible.value = false
  overwriteTargetAssetId.value = null
  overwriteTargetFilename.value = null
  savePresetName.value = (selectedNode.value?.name?.trim() ? selectedNode.value!.name!.trim() : 'Road Preset')
  savePresetDialogVisible.value = true
}

async function confirmSaveRoadPreset(): Promise<void> {
  const name = savePresetName.value?.trim() ?? ''
  const filename = buildRoadPresetFilename(name)
  const existing = sceneStore.findRoadPresetAssetByFilename(filename)
  if (existing) {
    overwriteTargetAssetId.value = existing.id
    overwriteTargetFilename.value = filename
    overwriteConfirmDialogVisible.value = true
    return
  }
  await performSaveRoadPreset(null)
}

async function performSaveRoadPreset(overwriteAssetId: string | null): Promise<void> {
  const name = savePresetName.value?.trim() ?? ''
  try {
    await sceneStore.saveRoadPreset({
      name,
      nodeId: selectedNodeId.value ?? null,
      assetId: overwriteAssetId,
      select: true,
    })
    savePresetDialogVisible.value = false
    overwriteConfirmDialogVisible.value = false
    overwriteTargetAssetId.value = null
    overwriteTargetFilename.value = null
  } catch (error) {
    console.error('Failed to save road preset', error)
    roadPresetFeedbackMessage.value = (error as Error).message ?? 'Failed to save road preset.'
  }
}

function cancelOverwriteRoadPreset(): void {
  overwriteConfirmDialogVisible.value = false
  overwriteTargetAssetId.value = null
  overwriteTargetFilename.value = null
}

watch(
  () => roadDynamicMesh.value,
  (mesh) => {
    isSyncingFromScene.value = true
    if (!mesh) {
      localWidth.value = 2
      nextTick(() => {
        isSyncingFromScene.value = false
      })
      return
    }

    const width = Number((mesh as RoadDynamicMesh).width)
    localWidth.value = Number.isFinite(width) ? Math.max(0.2, width) : 2
    nextTick(() => {
      isSyncingFromScene.value = false
    })
  },
  { immediate: true, deep: false },
)

watch(
  roadComponent,
  (component) => {
    isSyncingFromScene.value = true
    if (!component) {
      localJunctionSmoothing.value = ROAD_DEFAULT_JUNCTION_SMOOTHING
      localLaneLines.value = false
      localShoulders.value = false
      localSnapToTerrain.value = false
      localSamplingDensityFactor.value = 1.0
      localSmoothingStrengthFactor.value = 1.0
      localMinClearance.value = 0.01
      localLaneLineWidth.value = undefined
      localShoulderWidth.value = undefined
      nextTick(() => {
        isSyncingFromScene.value = false
      })
      return
    }

    const raw = component.props?.junctionSmoothing
    const value = typeof raw === 'number' ? raw : Number(raw)
    localJunctionSmoothing.value = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : ROAD_DEFAULT_JUNCTION_SMOOTHING
    localLaneLines.value = Boolean(component.props?.laneLines)
    localShoulders.value = Boolean(component.props?.shoulders)
    localSnapToTerrain.value = Boolean(component.props?.snapToTerrain)

    const samplingDensityRaw = component.props?.samplingDensityFactor
    const samplingDensity = typeof samplingDensityRaw === 'number' ? samplingDensityRaw : Number(samplingDensityRaw)
    localSamplingDensityFactor.value = Number.isFinite(samplingDensity) ? Math.max(0.1, Math.min(5, samplingDensity)) : 1.0

    const smoothingStrengthRaw = component.props?.smoothingStrengthFactor
    const smoothingStrength = typeof smoothingStrengthRaw === 'number' ? smoothingStrengthRaw : Number(smoothingStrengthRaw)
    localSmoothingStrengthFactor.value = Number.isFinite(smoothingStrength) ? Math.max(0.1, Math.min(5, smoothingStrength)) : 1.0

    const minClearanceRaw = component.props?.minClearance
    const minClearance = typeof minClearanceRaw === 'number' ? minClearanceRaw : Number(minClearanceRaw)
    localMinClearance.value = Number.isFinite(minClearance) ? Math.max(0, Math.min(2, minClearance)) : 0.01

    const laneLineWidthRaw = component.props?.laneLineWidth
    const laneLineWidth = typeof laneLineWidthRaw === 'number' ? laneLineWidthRaw : Number(laneLineWidthRaw)
    localLaneLineWidth.value = Number.isFinite(laneLineWidth) && laneLineWidth > 0.01 ? laneLineWidth : undefined

    const shoulderWidthRaw = component.props?.shoulderWidth
    const shoulderWidth = typeof shoulderWidthRaw === 'number' ? shoulderWidthRaw : Number(shoulderWidthRaw)
    localShoulderWidth.value = Number.isFinite(shoulderWidth) && shoulderWidth > 0.01 ? shoulderWidth : undefined

    nextTick(() => {
      isSyncingFromScene.value = false
    })
  },
  { immediate: true },
)

watch(selectedNode, () => {
  roadPresetDropActive.value = false
  roadPresetFeedbackMessage.value = null
  overwriteConfirmDialogVisible.value = false
  overwriteTargetAssetId.value = null
  overwriteTargetFilename.value = null
})

function applyLaneLinesUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = roadComponent.value
  if (!nodeId || !component) {
    return
  }
  const nextState = Boolean(rawValue)
  if (component.props.laneLines === nextState) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { laneLines: nextState })
}

function applyShouldersUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = roadComponent.value
  if (!nodeId || !component) {
    return
  }
  const nextState = Boolean(rawValue)
  if (component.props.shoulders === nextState) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { shoulders: nextState })
}

function applySnapToTerrainUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = roadComponent.value
  if (!nodeId || !component) {
    return
  }
  const nextState = Boolean(rawValue)
  if (component.props.snapToTerrain === nextState) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { snapToTerrain: nextState })
}

const junctionSmoothingDisplay = computed(() => `${Math.round(localJunctionSmoothing.value * 100)}%`)
const samplingDensityDisplay = computed(() => localSamplingDensityFactor.value.toFixed(2))
const smoothingStrengthDisplay = computed(() => localSmoothingStrengthFactor.value.toFixed(2))
const minClearanceDisplay = computed(() => `${(localMinClearance.value * 100).toFixed(1)} cm`)

function onJunctionSmoothingModelUpdate(value: unknown) {
  localJunctionSmoothing.value = Number(value)
  applyJunctionSmoothingUpdate(value)
}

function onWidthModelUpdate(v: unknown) {
  localWidth.value = Number(v)
  applyWidthUpdate(v)
}

function onLaneLinesModelUpdate(value: unknown) {
  const next = Boolean(value)
  localLaneLines.value = next
  applyLaneLinesUpdate(next)
}

function onShouldersModelUpdate(value: unknown) {
  const next = Boolean(value)
  localShoulders.value = next
  applyShouldersUpdate(next)
}

function onSnapToTerrainModelUpdate(value: unknown) {
  const next = Boolean(value)
  localSnapToTerrain.value = next
  applySnapToTerrainUpdate(next)
}

function onSamplingDensityModelUpdate(value: unknown) {
  localSamplingDensityFactor.value = Number(value)
  applySamplingDensityUpdate(value)
}

function onSmoothingStrengthModelUpdate(value: unknown) {
  localSmoothingStrengthFactor.value = Number(value)
  applySmoothingStrengthUpdate(value)
}

function onMinClearanceModelUpdate(value: unknown) {
  localMinClearance.value = Number(value)
  applyMinClearanceUpdate(value)
}

function onLaneLineWidthModelUpdate(v: unknown) {
  localLaneLineWidth.value = v ? Number(v) : undefined
  applyLaneLineWidthUpdate(v)
}

function onShoulderWidthModelUpdate(v: unknown) {
  localShoulderWidth.value = v ? Number(v) : undefined
  applyShoulderWidthUpdate(v)
}

function applyJunctionSmoothingUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = roadComponent.value
  if (!nodeId || !component) {
    return
  }
  const value = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  if (!Number.isFinite(value)) {
    return
  }
  const clamped = Math.min(1, Math.max(0, value))
  const current = typeof component.props?.junctionSmoothing === 'number'
    ? component.props.junctionSmoothing
    : ROAD_DEFAULT_JUNCTION_SMOOTHING
  if (Math.abs(current - clamped) <= 1e-6) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { junctionSmoothing: clamped })
}

function applyWidthUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const mesh = roadDynamicMesh.value
  if (!nodeId || !mesh) {
    return
  }

  const nextWidth = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  if (!Number.isFinite(nextWidth)) {
    return
  }

  const clamped = Math.max(0.2, nextWidth)
  const currentWidth = Number(mesh.width)
  if (Number.isFinite(currentWidth) && Math.abs(currentWidth - clamped) < 1e-6) {
    return
  }

  sceneStore.updateNodeDynamicMesh(nodeId, { width: clamped })
}

function applySamplingDensityUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = roadComponent.value
  if (!nodeId || !component) {
    return
  }
  const value = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  if (!Number.isFinite(value)) {
    return
  }
  const clamped = Math.max(0.1, Math.min(5, value))
  const current = component.props?.samplingDensityFactor ?? 1.0
  if (Math.abs(current - clamped) <= 1e-6) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { samplingDensityFactor: clamped })
}

function applySmoothingStrengthUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = roadComponent.value
  if (!nodeId || !component) {
    return
  }
  const value = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  if (!Number.isFinite(value)) {
    return
  }
  const clamped = Math.max(0.1, Math.min(5, value))
  const current = component.props?.smoothingStrengthFactor ?? 1.0
  if (Math.abs(current - clamped) <= 1e-6) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { smoothingStrengthFactor: clamped })
}

function applyMinClearanceUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = roadComponent.value
  if (!nodeId || !component) {
    return
  }
  const value = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  if (!Number.isFinite(value)) {
    return
  }
  const clamped = Math.max(0, Math.min(2, value))
  const current = component.props?.minClearance ?? 0.01
  if (Math.abs(current - clamped) <= 1e-6) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { minClearance: clamped })
}

function applyLaneLineWidthUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = roadComponent.value
  if (!nodeId || !component) {
    return
  }
  const value = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  const nextValue = Number.isFinite(value) && value > 0.01 ? Math.max(0.01, Math.min(1, value)) : undefined
  const currentRaw = component.props?.laneLineWidth
  const current = typeof currentRaw === 'number' ? currentRaw : Number(currentRaw)
  if (
    (nextValue === undefined && !Number.isFinite(current))
    || (nextValue !== undefined && Number.isFinite(current) && Math.abs(current - nextValue) <= 1e-6)
  ) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { laneLineWidth: nextValue })
}

function applyShoulderWidthUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = roadComponent.value
  if (!nodeId || !component) {
    return
  }
  const value = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  const nextValue = Number.isFinite(value) && value > 0.01 ? Math.max(0.01, Math.min(2, value)) : undefined
  const currentRaw = component.props?.shoulderWidth
  const current = typeof currentRaw === 'number' ? currentRaw : Number(currentRaw)
  if (
    (nextValue === undefined && !Number.isFinite(current))
    || (nextValue !== undefined && Number.isFinite(current) && Math.abs(current - nextValue) <= 1e-6)
  ) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { shoulderWidth: nextValue })
}

</script>

<template>
  <v-expansion-panel value="road">
    <v-expansion-panel-title>
      <div class="road-panel-header">
        <span class="road-panel-title">Road</span>
        <v-spacer />
        <v-btn
          v-if="roadComponent"
          icon
          variant="text"
          size="small"
          class="component-menu-btn"
          @click.stop="openSaveRoadPresetDialog"
        >
          <v-icon size="18">mdi-content-save</v-icon>
        </v-btn>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div
        class="road-panel-drop-surface"
        ref="panelDropAreaRef"
        :class="{ 'is-road-preset-active': roadPresetDropActive }"
        @dragenter.capture="handleRoadPresetDragEnterCapture"
        @dragover.capture="handleRoadPresetDragOverCapture"
        @dragleave.capture="handleRoadPresetDragLeaveCapture"
        @drop.capture="handleRoadPresetDropCapture"
      >
        <p v-if="roadPresetFeedbackMessage" class="asset-feedback road-preset-feedback">{{ roadPresetFeedbackMessage }}</p>

        <div class="road-field-grid">
          <div class="road-field-labels">
            <span>Junction Smoothness</span>
            <span>{{ junctionSmoothingDisplay }}</span>
          </div>
          <v-slider
            :model-value="localJunctionSmoothing"
            :min="0"
            :max="1"
            :step="0.01"
            density="compact"
            track-color="rgba(77, 208, 225, 0.4)"
            color="primary"
            @update:modelValue="onJunctionSmoothingModelUpdate"
          />

          <v-text-field
            :model-value="localWidth"
            type="number"
            label="Width (m)"
            density="compact"
            variant="underlined"
            min="0.2"
            step="0.1"
            @update:modelValue="onWidthModelUpdate"
          />

          <v-switch
            :model-value="localLaneLines"
            density="compact"
            label="Show Lane Lines"
            @update:modelValue="onLaneLinesModelUpdate"
          />

          <v-switch
            :model-value="localShoulders"
            density="compact"
            label="Show Shoulders"
            @update:modelValue="onShouldersModelUpdate"
          />

          <v-divider class="my-2" />

          <div class="road-section-header">Terrain Adaptation</div>

          <v-switch
            :model-value="localSnapToTerrain"
            density="compact"
            label="Adapt To Ground Terrain"
            @update:modelValue="onSnapToTerrainModelUpdate"
          />

          <div class="road-field-labels">
            <span>Sampling Density</span>
            <span>{{ samplingDensityDisplay }}</span>
          </div>
          <v-slider
            :model-value="localSamplingDensityFactor"
            :min="0.1"
            :max="5"
            :step="0.1"
            density="compact"
            track-color="rgba(77, 208, 225, 0.4)"
            color="primary"
            @update:modelValue="onSamplingDensityModelUpdate"
          />

          <div class="road-field-labels">
            <span>Smoothing Strength</span>
            <span>{{ smoothingStrengthDisplay }}</span>
          </div>
          <v-slider
            :model-value="localSmoothingStrengthFactor"
            :min="0.1"
            :max="5"
            :step="0.1"
            density="compact"
            track-color="rgba(77, 208, 225, 0.4)"
            color="primary"
            @update:modelValue="onSmoothingStrengthModelUpdate"
          />

          <div class="road-field-labels">
            <span>Min Clearance</span>
            <span>{{ minClearanceDisplay }}</span>
          </div>
          <v-slider
            :model-value="localMinClearance"
            :min="0"
            :max="2"
            :step="0.01"
            density="compact"
            track-color="rgba(77, 208, 225, 0.4)"
            color="primary"
            @update:modelValue="onMinClearanceModelUpdate"
          />

          <v-divider class="my-2" />

          <div class="road-section-header">Overlay Dimensions</div>

          <v-text-field
            :model-value="localLaneLineWidth"
            type="number"
            label="Lane Line Width (m)"
            density="compact"
            variant="underlined"
            min="0.01"
            max="1"
            step="0.01"
            placeholder="Auto"
            clearable
            @update:modelValue="onLaneLineWidthModelUpdate"
          />

          <v-text-field
            :model-value="localShoulderWidth"
            type="number"
            label="Shoulder Width (m)"
            density="compact"
            variant="underlined"
            min="0.01"
            max="2"
            step="0.01"
            placeholder="Auto"
            clearable
            @update:modelValue="onShoulderWidthModelUpdate"
          />
        </div>

        <v-dialog v-model="savePresetDialogVisible" max-width="420">
          <v-card>
            <v-card-title>Save Road Preset</v-card-title>
            <v-card-text>
              <v-text-field
                v-model="savePresetName"
                label="Preset Name"
                density="compact"
                variant="underlined"
                autofocus
                @keydown.enter.prevent="confirmSaveRoadPreset"
              />
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn variant="text" @click="savePresetDialogVisible = false">Cancel</v-btn>
              <v-btn color="primary" @click="confirmSaveRoadPreset">Save</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <v-dialog v-model="overwriteConfirmDialogVisible" max-width="420">
          <v-card>
            <v-card-title>Overwrite preset?</v-card-title>
            <v-card-text>
              This preset already exists: <strong>{{ overwriteTargetFilename }}</strong>. Overwrite it?
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn variant="text" @click="cancelOverwriteRoadPreset">Cancel</v-btn>
              <v-btn color="primary" @click="performSaveRoadPreset(overwriteTargetAssetId)">Overwrite</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.road-panel-header {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0.4rem;
}

.road-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.road-panel-subtitle {
  font-size: 0.78rem;
  opacity: 0.78;
}

.road-panel-empty {
  opacity: 0.8;
  font-size: 0.85rem;
}

.road-field-grid {
  display: grid;
  gap: 0.4rem;
}

.asset-feedback {
  font-size: 0.75rem;
  color: #f97316;
}

.road-panel-drop-surface.is-road-preset-active {
  outline: 2px dashed rgba(110, 231, 183, 0.75);
  outline-offset: 6px;
}

.road-preset-feedback {
  margin: 0 0 0.5rem;
}

.road-field-labels {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
  opacity: 0.9;
}

.road-section-header {
  font-size: 0.9rem;
  font-weight: 600;
  opacity: 0.85;
  margin-top: 0.4rem;
  margin-bottom: 0.2rem;
}
</style>
