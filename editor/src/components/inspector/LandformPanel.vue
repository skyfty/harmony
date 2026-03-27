<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { SceneNodeComponentState } from '@schema'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'
import type { ProjectAsset } from '@/types/project-asset'
import { buildLandformPresetFilename, isLandformPresetFilename } from '@/utils/landformPreset'
import {
  LANDFORM_COMPONENT_TYPE,
  LANDFORM_DEFAULT_FEATHER,
  LANDFORM_MAX_FEATHER,
  LANDFORM_MIN_FEATHER,
  type LandformComponentProps,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId, draggingAssetId } = storeToRefs(sceneStore)

const landformComponent = computed(() => {
  const component = selectedNode.value?.components?.[LANDFORM_COMPONENT_TYPE]
  if (!component) {
    return null
  }
  return component as SceneNodeComponentState<LandformComponentProps>
})

const localFeather = ref(LANDFORM_DEFAULT_FEATHER)
const localUvScaleX = ref(1)
const localUvScaleY = ref(1)
const isSyncingFromScene = ref(false)

const panelDropAreaRef = ref<HTMLElement | null>(null)
const landformPresetDropActive = ref(false)
const landformPresetFeedbackMessage = ref<string | null>(null)

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

function isLandformPresetAsset(asset: ProjectAsset | null): boolean {
  if (!asset) {
    return false
  }
  return isLandformPresetFilename(asset.description ?? asset.name ?? null)
}

function resolveLandformPresetAssetId(event: DragEvent): string | null {
  const assetId = resolveDragAssetId(event)
  if (!assetId) {
    return null
  }
  const asset = sceneStore.getAsset(assetId)
  if (!isLandformPresetAsset(asset)) {
    return null
  }
  return assetId
}

function handleLandformPresetDragEnterCapture(event: DragEvent): void {
  const presetId = resolveLandformPresetAssetId(event)
  if (!presetId) {
    return
  }
  landformPresetDropActive.value = true
  landformPresetFeedbackMessage.value = null
  event.preventDefault()
  event.stopPropagation()
}

function handleLandformPresetDragOverCapture(event: DragEvent): void {
  const presetId = resolveLandformPresetAssetId(event)
  if (!presetId) {
    return
  }
  landformPresetDropActive.value = true
  landformPresetFeedbackMessage.value = null
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  event.preventDefault()
  event.stopPropagation()
}

function handleLandformPresetDragLeaveCapture(event: DragEvent): void {
  if (shouldDeactivateDropArea(panelDropAreaRef.value, event)) {
    landformPresetDropActive.value = false
  }
}

async function handleLandformPresetDropCapture(event: DragEvent): Promise<void> {
  const presetId = resolveLandformPresetAssetId(event)
  if (!presetId) {
    return
  }

  landformPresetDropActive.value = false
  landformPresetFeedbackMessage.value = null
  event.preventDefault()
  event.stopPropagation()

  try {
    await sceneStore.applyLandformPresetToSelectedLandform(presetId)
  } catch (error) {
    console.error('Failed to apply landform preset', error)
    landformPresetFeedbackMessage.value = (error as Error).message ?? 'Failed to apply landform preset.'
  }
}

function openSaveLandformPresetDialog(): void {
  if (!landformComponent.value) {
    return
  }
  landformPresetFeedbackMessage.value = null
  overwriteConfirmDialogVisible.value = false
  overwriteTargetAssetId.value = null
  overwriteTargetFilename.value = null
  savePresetName.value = selectedNode.value?.name?.trim() ? selectedNode.value.name.trim() : 'Landform Preset'
  savePresetDialogVisible.value = true
}

async function confirmSaveLandformPreset(): Promise<void> {
  const name = savePresetName.value?.trim() ?? ''
  const filename = buildLandformPresetFilename(name)
  const existing = sceneStore.findLandformPresetAssetByFilename(filename)
  if (existing) {
    overwriteTargetAssetId.value = existing.id
    overwriteTargetFilename.value = filename
    overwriteConfirmDialogVisible.value = true
    return
  }
  await performSaveLandformPreset(null)
}

async function performSaveLandformPreset(overwriteAssetId: string | null): Promise<void> {
  const name = savePresetName.value?.trim() ?? ''
  try {
    await sceneStore.saveLandformPreset({
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
    console.error('Failed to save landform preset', error)
    landformPresetFeedbackMessage.value = (error as Error).message ?? 'Failed to save landform preset.'
  }
}

function cancelOverwriteLandformPreset(): void {
  overwriteConfirmDialogVisible.value = false
  overwriteTargetAssetId.value = null
  overwriteTargetFilename.value = null
}

watch(
  landformComponent,
  (component) => {
    isSyncingFromScene.value = true
    if (!component) {
      localFeather.value = LANDFORM_DEFAULT_FEATHER
      localUvScaleX.value = 1
      localUvScaleY.value = 1
      nextTick(() => {
        isSyncingFromScene.value = false
      })
      return
    }

    localFeather.value = Number.isFinite(component.props.feather) ? component.props.feather : LANDFORM_DEFAULT_FEATHER
    localUvScaleX.value = Number.isFinite(component.props.uvScale?.x) ? component.props.uvScale.x : 1
    localUvScaleY.value = Number.isFinite(component.props.uvScale?.y) ? component.props.uvScale.y : 1
    nextTick(() => {
      isSyncingFromScene.value = false
    })
  },
  { immediate: true },
)

watch(selectedNode, () => {
  landformPresetDropActive.value = false
  landformPresetFeedbackMessage.value = null
  overwriteConfirmDialogVisible.value = false
  overwriteTargetAssetId.value = null
  overwriteTargetFilename.value = null
})

function applyLandformPropsUpdate() {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = landformComponent.value
  if (!nodeId || !component) {
    return
  }
  const feather = Number(localFeather.value)
  const uvX = Number(localUvScaleX.value)
  const uvY = Number(localUvScaleY.value)
  if (!Number.isFinite(feather) || !Number.isFinite(uvX) || !Number.isFinite(uvY)) {
    return
  }
  const clampedFeather = Math.min(LANDFORM_MAX_FEATHER, Math.max(LANDFORM_MIN_FEATHER, feather))
  const clampedUvX = Math.max(1e-3, uvX)
  const clampedUvY = Math.max(1e-3, uvY)
  localFeather.value = clampedFeather
  localUvScaleX.value = clampedUvX
  localUvScaleY.value = clampedUvY
  sceneStore.updateNodeComponentProps(nodeId, component.id, {
    feather: clampedFeather,
    uvScale: { x: clampedUvX, y: clampedUvY },
  })
}
</script>

<template>
  <v-expansion-panel value="landform">
    <v-expansion-panel-title>
      <div class="landform-panel-header">
        <span class="landform-panel-title">Landform</span>
        <v-spacer />
        <v-btn
          v-if="landformComponent"
          icon
          variant="text"
          size="small"
          class="component-menu-btn"
          @click.stop="openSaveLandformPresetDialog"
        >
          <v-icon size="18">mdi-content-save</v-icon>
        </v-btn>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div
        ref="panelDropAreaRef"
        class="landform-panel-drop-surface"
        :class="{ 'is-landform-preset-active': landformPresetDropActive }"
        @dragenter.capture="handleLandformPresetDragEnterCapture"
        @dragover.capture="handleLandformPresetDragOverCapture"
        @dragleave.capture="handleLandformPresetDragLeaveCapture"
        @drop.capture="handleLandformPresetDropCapture"
      >
        <p v-if="landformPresetFeedbackMessage" class="asset-feedback landform-preset-feedback">{{ landformPresetFeedbackMessage }}</p>

        <div class="landform-field-grid">
          <v-text-field
            v-model.number="localFeather"
            label="Feather (m)"
            type="number"
            density="compact"
            variant="underlined"
            inputmode="decimal"
            :min="LANDFORM_MIN_FEATHER"
            :max="LANDFORM_MAX_FEATHER"
            step="0.1"
            @update:modelValue="(value) => { localFeather = Number(value); applyLandformPropsUpdate() }"
            @blur="applyLandformPropsUpdate"
            @keydown.enter.prevent="applyLandformPropsUpdate"
          />

          <div class="landform-uv-grid">
            <v-text-field
              v-model.number="localUvScaleX"
              label="UV Scale X"
              type="number"
              density="compact"
              variant="underlined"
              inputmode="decimal"
              min="0.001"
              step="0.1"
              @update:modelValue="(value) => { localUvScaleX = Number(value); applyLandformPropsUpdate() }"
              @blur="applyLandformPropsUpdate"
              @keydown.enter.prevent="applyLandformPropsUpdate"
            />
            <v-text-field
              v-model.number="localUvScaleY"
              label="UV Scale Y"
              type="number"
              density="compact"
              variant="underlined"
              inputmode="decimal"
              min="0.001"
              step="0.1"
              @update:modelValue="(value) => { localUvScaleY = Number(value); applyLandformPropsUpdate() }"
              @blur="applyLandformPropsUpdate"
              @keydown.enter.prevent="applyLandformPropsUpdate"
            />
          </div>
        </div>

        <v-dialog v-model="savePresetDialogVisible" max-width="420">
          <v-card>
            <v-card-title>Save Landform Preset</v-card-title>
            <v-card-text>
              <v-text-field
                v-model="savePresetName"
                label="Preset Name"
                density="compact"
                variant="underlined"
                autofocus
                @keydown.enter.prevent="confirmSaveLandformPreset"
              />
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn variant="text" @click="savePresetDialogVisible = false">Cancel</v-btn>
              <v-btn color="primary" @click="confirmSaveLandformPreset">Save</v-btn>
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
              <v-btn variant="text" @click="cancelOverwriteLandformPreset">Cancel</v-btn>
              <v-btn color="primary" @click="performSaveLandformPreset(overwriteTargetAssetId)">Overwrite</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.landform-panel-header {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0.4rem;
}

.landform-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.landform-field-grid {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.asset-feedback {
  font-size: 0.75rem;
  color: #f97316;
}

.landform-panel-drop-surface.is-landform-preset-active {
  outline: 2px dashed rgba(110, 231, 183, 0.75);
  outline-offset: 6px;
}

.landform-preset-feedback {
  margin: 0 0 0.5rem;
}

.landform-uv-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}
</style>