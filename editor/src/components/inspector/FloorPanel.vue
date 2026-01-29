<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { SceneNodeComponentState } from '@harmony/schema'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'
import type { ProjectAsset } from '@/types/project-asset'
import { buildFloorPresetFilename, isFloorPresetFilename } from '@/utils/floorPreset'
import {
  FLOOR_COMPONENT_TYPE,
  FLOOR_DEFAULT_SMOOTH,
  FLOOR_DEFAULT_THICKNESS,
  FLOOR_MAX_THICKNESS,
  FLOOR_MIN_THICKNESS,
  FLOOR_DEFAULT_SIDE_UV_SCALE,
} from '@schema/components'
import type { FloorComponentProps } from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId, draggingAssetId } = storeToRefs(sceneStore)

const floorComponent = computed(() => {
  const component = selectedNode.value?.components?.[FLOOR_COMPONENT_TYPE]
  if (!component) {
    return null
  }
  return component as SceneNodeComponentState<FloorComponentProps>
})

const localSmooth = ref(FLOOR_DEFAULT_SMOOTH)
const localThickness = ref(FLOOR_DEFAULT_THICKNESS)
const localSideUvU = ref(FLOOR_DEFAULT_SIDE_UV_SCALE.x)
const localSideUvV = ref(FLOOR_DEFAULT_SIDE_UV_SCALE.y)
const isSyncingFromScene = ref(false)

const panelDropAreaRef = ref<HTMLElement | null>(null)
const floorPresetDropActive = ref(false)
const floorPresetFeedbackMessage = ref<string | null>(null)

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

function isFloorPresetAsset(asset: ProjectAsset | null): boolean {
  if (!asset) {
    return false
  }
  return isFloorPresetFilename(asset.description ?? asset.name ?? null)
}

function resolveFloorPresetAssetId(event: DragEvent): string | null {
  const assetId = resolveDragAssetId(event)
  if (!assetId) {
    return null
  }
  const asset = sceneStore.getAsset(assetId)
  if (!isFloorPresetAsset(asset)) {
    return null
  }
  return assetId
}

function handleFloorPresetDragEnterCapture(event: DragEvent): void {
  const presetId = resolveFloorPresetAssetId(event)
  if (!presetId) {
    return
  }
  floorPresetDropActive.value = true
  floorPresetFeedbackMessage.value = null
  event.preventDefault()
  event.stopPropagation()
}

function handleFloorPresetDragOverCapture(event: DragEvent): void {
  const presetId = resolveFloorPresetAssetId(event)
  if (!presetId) {
    return
  }
  floorPresetDropActive.value = true
  floorPresetFeedbackMessage.value = null
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  event.preventDefault()
  event.stopPropagation()
}

function handleFloorPresetDragLeaveCapture(event: DragEvent): void {
  if (shouldDeactivateDropArea(panelDropAreaRef.value, event)) {
    floorPresetDropActive.value = false
  }
}

async function handleFloorPresetDropCapture(event: DragEvent): Promise<void> {
  const presetId = resolveFloorPresetAssetId(event)
  if (!presetId) {
    return
  }

  floorPresetDropActive.value = false
  floorPresetFeedbackMessage.value = null
  event.preventDefault()
  event.stopPropagation()

  try {
    await sceneStore.applyFloorPresetToSelectedFloor(presetId)
  } catch (error) {
    console.error('Failed to apply floor preset', error)
    floorPresetFeedbackMessage.value = (error as Error).message ?? 'Failed to apply floor preset.'
  }
}

function openSaveFloorPresetDialog(): void {
  if (!floorComponent.value) {
    return
  }
  floorPresetFeedbackMessage.value = null
  overwriteConfirmDialogVisible.value = false
  overwriteTargetAssetId.value = null
  overwriteTargetFilename.value = null
  savePresetName.value = (selectedNode.value?.name?.trim() ? selectedNode.value!.name!.trim() : 'Floor Preset')
  savePresetDialogVisible.value = true
}

async function confirmSaveFloorPreset(): Promise<void> {
  const name = savePresetName.value?.trim() ?? ''
  const filename = buildFloorPresetFilename(name)
  const existing = sceneStore.findFloorPresetAssetByFilename(filename)
  if (existing) {
    overwriteTargetAssetId.value = existing.id
    overwriteTargetFilename.value = filename
    overwriteConfirmDialogVisible.value = true
    return
  }
  await performSaveFloorPreset(null)
}

async function performSaveFloorPreset(overwriteAssetId: string | null): Promise<void> {
  const name = savePresetName.value?.trim() ?? ''
  try {
    await sceneStore.saveFloorPreset({
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
    console.error('Failed to save floor preset', error)
    floorPresetFeedbackMessage.value = (error as Error).message ?? 'Failed to save floor preset.'
  }
}

function cancelOverwriteFloorPreset(): void {
  overwriteConfirmDialogVisible.value = false
  overwriteTargetAssetId.value = null
  overwriteTargetFilename.value = null
}

watch(
  floorComponent,
  (component) => {
    isSyncingFromScene.value = true
    if (!component) {
      localSmooth.value = FLOOR_DEFAULT_SMOOTH
      localThickness.value = FLOOR_DEFAULT_THICKNESS
      localSideUvU.value = FLOOR_DEFAULT_SIDE_UV_SCALE.x
      localSideUvV.value = FLOOR_DEFAULT_SIDE_UV_SCALE.y
      nextTick(() => {
        isSyncingFromScene.value = false
      })
      return
    }

    const smooth = Number.isFinite(component.props.smooth) ? component.props.smooth : FLOOR_DEFAULT_SMOOTH
    localSmooth.value = smooth

    const thickness = Number.isFinite(component.props.thickness) ? component.props.thickness : FLOOR_DEFAULT_THICKNESS
    localThickness.value = thickness

    const sideU = Number.isFinite(component.props.sideUvScale?.x)
      ? Number(component.props.sideUvScale.x)
      : FLOOR_DEFAULT_SIDE_UV_SCALE.x
    const sideV = Number.isFinite(component.props.sideUvScale?.y)
      ? Number(component.props.sideUvScale.y)
      : FLOOR_DEFAULT_SIDE_UV_SCALE.y
    localSideUvU.value = sideU
    localSideUvV.value = sideV
    nextTick(() => {
      isSyncingFromScene.value = false
    })
  },
  { immediate: true }
)

watch(selectedNode, () => {
  floorPresetDropActive.value = false
  floorPresetFeedbackMessage.value = null
  overwriteConfirmDialogVisible.value = false
  overwriteTargetAssetId.value = null
  overwriteTargetFilename.value = null
})

const smoothDisplay = computed(() => `${Math.round(localSmooth.value * 100)}%`)

function applySmoothUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = floorComponent.value
  if (!nodeId || !component) {
    return
  }
  const value = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  if (!Number.isFinite(value)) {
    return
  }
  const clamped = Math.min(1, Math.max(0, value))
  const currentSmooth = Number.isFinite(component.props.smooth)
    ? component.props.smooth
    : FLOOR_DEFAULT_SMOOTH
  if (Math.abs(currentSmooth - clamped) <= 1e-6) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { smooth: clamped })
}

function applyThicknessUpdate() {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = floorComponent.value
  if (!nodeId || !component) {
    return
  }
  const value = Number(localThickness.value)
  if (!Number.isFinite(value)) {
    return
  }
  const clamped = Math.min(FLOOR_MAX_THICKNESS, Math.max(FLOOR_MIN_THICKNESS, value))
  if (localThickness.value !== clamped) {
    localThickness.value = clamped
  }
  const current = Number.isFinite(component.props.thickness) ? component.props.thickness : FLOOR_DEFAULT_THICKNESS
  if (Math.abs(current - clamped) <= 1e-6) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { thickness: clamped })
}

function applySideUvUpdate() {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = floorComponent.value
  if (!nodeId || !component) {
    return
  }
  const u = Number(localSideUvU.value)
  const v = Number(localSideUvV.value)
  if (!Number.isFinite(u) || !Number.isFinite(v)) {
    return
  }
  const nextU = Math.max(0, u)
  const nextV = Math.max(0, v)
  if (localSideUvU.value !== nextU) {
    localSideUvU.value = nextU
  }
  if (localSideUvV.value !== nextV) {
    localSideUvV.value = nextV
  }

  const currentU = Number.isFinite(component.props.sideUvScale?.x)
    ? Number(component.props.sideUvScale.x)
    : FLOOR_DEFAULT_SIDE_UV_SCALE.x
  const currentV = Number.isFinite(component.props.sideUvScale?.y)
    ? Number(component.props.sideUvScale.y)
    : FLOOR_DEFAULT_SIDE_UV_SCALE.y

  if (Math.abs(currentU - nextU) <= 1e-6 && Math.abs(currentV - nextV) <= 1e-6) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { sideUvScale: { x: nextU, y: nextV } })
}
</script>

<template>
  <v-expansion-panel value="floor">
    <v-expansion-panel-title>
      <div class="floor-panel-header">
        <span class="floor-panel-title">Floor</span>
        <v-spacer />
        <v-btn
          v-if="floorComponent"
          icon
          variant="text"
          size="small"
          class="component-menu-btn"
          @click.stop="openSaveFloorPresetDialog"
        >
          <v-icon size="18">mdi-content-save</v-icon>
        </v-btn>
        <span class="floor-panel-subtitle">{{ smoothDisplay }}</span>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div
        class="floor-panel-drop-surface"
        ref="panelDropAreaRef"
        :class="{ 'is-floor-preset-active': floorPresetDropActive }"
        @dragenter.capture="handleFloorPresetDragEnterCapture"
        @dragover.capture="handleFloorPresetDragOverCapture"
        @dragleave.capture="handleFloorPresetDragLeaveCapture"
        @drop.capture="handleFloorPresetDropCapture"
      >
        <p v-if="floorPresetFeedbackMessage" class="asset-feedback floor-preset-feedback">{{ floorPresetFeedbackMessage }}</p>

        <div class="floor-field-grid">
          <div class="floor-field-labels">
            <span>Corner Smoothness</span>
            <span>{{ smoothDisplay }}</span>
          </div>
          <v-slider
            :model-value="localSmooth"
            :min="0"
            :max="1"
            :step="0.01"
            density="compact"
            track-color="rgba(77, 208, 225, 0.4)"
            color="primary"
            @update:modelValue="(value) => { localSmooth = Number(value); applySmoothUpdate(value) }"
          />

          <v-text-field
            v-model.number="localThickness"
            label="Thickness (m)"
            type="number"
            density="compact"
            variant="underlined"
            class="slider-input"
            inputmode="decimal"
            :min="FLOOR_MIN_THICKNESS"
            :max="FLOOR_MAX_THICKNESS"
            step="0.05"
            @update:modelValue="(value) => { localThickness = Number(value); applyThicknessUpdate() }"
            @blur="applyThicknessUpdate"
            @keydown.enter.prevent="applyThicknessUpdate"
          />

          <div class="floor-uv-grid">
            <v-text-field
              v-model.number="localSideUvU"
              label="Side UV Repeat U (/m)"
              type="number"
              density="compact"
              variant="underlined"
              class="slider-input"
              inputmode="decimal"
              min="0"
              step="0.1"
              @blur="applySideUvUpdate"
              @keydown.enter.prevent="applySideUvUpdate"
            />
            <v-text-field
              v-model.number="localSideUvV"
              label="Side UV Repeat V (/m)"
              type="number"
              density="compact"
              variant="underlined"
              class="slider-input"
              inputmode="decimal"
              min="0"
              step="0.1"
              @blur="applySideUvUpdate"
              @keydown.enter.prevent="applySideUvUpdate"
            />
          </div>
        </div>

        <v-dialog v-model="savePresetDialogVisible" max-width="420">
          <v-card>
            <v-card-title>Save Floor Preset</v-card-title>
            <v-card-text>
              <v-text-field
                v-model="savePresetName"
                label="Preset Name"
                density="compact"
                variant="underlined"
                autofocus
                @keydown.enter.prevent="confirmSaveFloorPreset"
              />
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn variant="text" @click="savePresetDialogVisible = false">Cancel</v-btn>
              <v-btn color="primary" @click="confirmSaveFloorPreset">Save</v-btn>
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
              <v-btn variant="text" @click="cancelOverwriteFloorPreset">Cancel</v-btn>
              <v-btn color="primary" @click="performSaveFloorPreset(overwriteTargetAssetId)">Overwrite</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.floor-panel-header {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0.4rem;
}

.floor-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.floor-panel-subtitle {
  font-size: 0.78rem;
  opacity: 0.78;
}

.floor-field-grid {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.asset-feedback {
  font-size: 0.75rem;
  color: #f97316;
}

.floor-panel-drop-surface.is-floor-preset-active {
  outline: 2px dashed rgba(110, 231, 183, 0.75);
  outline-offset: 6px;
}

.floor-preset-feedback {
  margin: 0 0 0.5rem;
}

.floor-uv-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}

.floor-field-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.78rem;
  opacity: 0.75;
}
</style>
