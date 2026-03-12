<script setup lang="ts">
import { computed } from 'vue'
import type { TerrainPaintLayerDefinition, TerrainPaintBlendMode } from '@schema'
import type { ProjectAsset } from '@/types/project-asset'
import type { TerrainPaintBrushSettings } from '@/stores/terrainStore'
import AssetPickerList from '@/components/common/AssetPickerList.vue'

const BRUSH_RADIUS_MIN = 0.1
const BRUSH_RADIUS_MAX = 50
const BRUSH_RADIUS_STEP = 0.1
const BRUSH_RADIUS_PRECISION = 1

const SMOOTHNESS_MIN = 0
const SMOOTHNESS_MAX = 1
const SMOOTHNESS_STEP = 0.01
const SMOOTHNESS_PRECISION = 2

const TILE_SCALE_MIN = 0.001
const TILE_SCALE_MAX = 64
const TILE_SCALE_STEP = 0.01
const TILE_SCALE_PRECISION = 2

const OFFSET_MIN = -64
const OFFSET_MAX = 64
const OFFSET_STEP = 0.01
const OFFSET_PRECISION = 2

const ROTATION_MIN = -360
const ROTATION_MAX = 360
const ROTATION_STEP = 1
const ROTATION_PRECISION = 0

const OPACITY_MIN = 0
const OPACITY_MAX = 1
const OPACITY_STEP = 0.01
const OPACITY_PRECISION = 2

const blendModeOptions: Array<{ value: TerrainPaintBlendMode; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
]

const props = defineProps<{
  hasGround: boolean
  brushRadius: number
  smoothness: number
  layers: TerrainPaintLayerDefinition[]
  selectedLayerId: string | null
  selectedLayerSlotIndex: number | null
  selectedLayerAsset: ProjectAsset | null
  canAddLayer: boolean
}>()

const emit = defineEmits<{
  (event: 'update:brushRadius', value: number): void
  (event: 'update:smoothness', value: number): void
  (event: 'add-layer'): void
  (event: 'select-base'): void
  (event: 'select-layer', layerId: string): void
  (event: 'toggle-layer-enabled', layerId: string, enabled: boolean): void
  (event: 'remove-layer', layerId: string): void
  (event: 'update:selected-layer-asset', value: ProjectAsset | null): void
  (event: 'update:selected-layer-style', patch: Partial<TerrainPaintLayerDefinition>): void
}>()

const brushRadiusModel = computed({
  get: () => props.brushRadius,
  set: (value: number) => emit('update:brushRadius', value),
})

const smoothnessModel = computed({
  get: () => props.smoothness,
  set: (value: number) => emit('update:smoothness', value),
})

const sortedLayers = computed(() => props.layers.slice().sort((left, right) => left.slotIndex - right.slotIndex))

const selectedLayer = computed(() => {
  if (!props.selectedLayerId) {
    return null
  }
  return sortedLayers.value.find((layer) => layer.id === props.selectedLayerId) ?? null
})

const selectedAssetId = computed(() => props.selectedLayerAsset?.id ?? selectedLayer.value?.textureAssetId ?? '')

const baseSelected = computed(() => props.selectedLayerSlotIndex === 0 && !props.selectedLayerId)

const selectedLayerTileScale = computed(() => selectedLayer.value?.tileScale ?? { x: 1, y: 1 })

const selectedLayerOffset = computed(() => selectedLayer.value?.offset ?? { x: 0, y: 0 })

const blendModeOptions: Array<{ title: string; value: TerrainPaintBlendMode }> = [
  { title: 'Normal', value: 'normal' },
  { title: 'Multiply', value: 'multiply' },
  { title: 'Screen', value: 'screen' },
  { title: 'Overlay', value: 'overlay' },
]

watch(
  () => props.brushRadius,
  (value) => {
    brushRadiusInput.value = formatNumericValue(value, BRUSH_RADIUS_PRECISION)
  },
)

watch(
  () => props.smoothness,
  (value) => {
    smoothnessInput.value = formatNumericValue(value, SMOOTHNESS_PRECISION)
  },
)

watch(
  () => props.settings.tileScale.x,
  (value) => {
    tileScaleXInput.value = formatNumericValue(value, TILE_SCALE_PRECISION)
  },
)

watch(
  () => props.settings.tileScale.y,
  (value) => {
    tileScaleYInput.value = formatNumericValue(value, TILE_SCALE_PRECISION)
  },
)

watch(
  () => props.settings.offset.x,
  (value) => {
    offsetXInput.value = formatNumericValue(value, OFFSET_PRECISION)
  },
)

watch(
  () => props.settings.offset.y,
  (value) => {
    offsetYInput.value = formatNumericValue(value, OFFSET_PRECISION)
  },
)

watch(
  () => props.settings.rotationDeg,
  (value) => {
    rotationInput.value = formatNumericValue(value, ROTATION_PRECISION)
  },
)

watch(
  () => props.settings.opacity,
  (value) => {
    opacityInput.value = formatNumericValue(value, OPACITY_PRECISION)
  },
)

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function snapToStep(value: number, min: number, step: number): number {
  const steps = Math.round((value - min) / step)
  return min + steps * step
}

function formatNumericValue(value: number, precision: number): string {
  return Number.isFinite(value) ? value.toFixed(precision) : (0).toFixed(precision)
}

function parseAndNormalize(
  raw: string,
  fallback: number,
  min: number,
  max: number,
  step: number,
  precision: number,
): number {
  const parsed = Number.parseFloat(raw)
  const base = Number.isFinite(parsed) ? parsed : fallback
  const clamped = clampValue(base, min, max)
  const stepped = snapToStep(clamped, min, step)
  const normalized = Number(stepped.toFixed(precision))
  return clampValue(normalized, min, max)
}

function commitBrushRadiusInput() {
  const normalized = parseAndNormalize(
    brushRadiusInput.value,
    props.brushRadius,
    BRUSH_RADIUS_MIN,
    BRUSH_RADIUS_MAX,
    BRUSH_RADIUS_STEP,
    BRUSH_RADIUS_PRECISION,
  )
  brushRadiusModel.value = normalized
  brushRadiusInput.value = formatNumericValue(normalized, BRUSH_RADIUS_PRECISION)
}

function commitSmoothnessInput() {
  const normalized = parseAndNormalize(
    smoothnessInput.value,
    props.smoothness,
    SMOOTHNESS_MIN,
    SMOOTHNESS_MAX,
    SMOOTHNESS_STEP,
    SMOOTHNESS_PRECISION,
  )
  smoothnessModel.value = normalized
  smoothnessInput.value = formatNumericValue(normalized, SMOOTHNESS_PRECISION)
}

function commitTileScaleAxis(axis: 'x' | 'y') {
  const source = axis === 'x' ? tileScaleXInput : tileScaleYInput
  const fallback = props.settings.tileScale[axis]
  const normalized = parseAndNormalize(
    source.value,
    fallback,
    TILE_SCALE_MIN,
    TILE_SCALE_MAX,
    TILE_SCALE_STEP,
    TILE_SCALE_PRECISION,
  )
  emitSettingsPatch({
    tileScale: {
      ...props.settings.tileScale,
      [axis]: normalized,
    },
  })
  source.value = formatNumericValue(normalized, TILE_SCALE_PRECISION)
}

function commitOffsetAxis(axis: 'x' | 'y') {
  const source = axis === 'x' ? offsetXInput : offsetYInput
  const fallback = props.settings.offset[axis]
  const normalized = parseAndNormalize(
    source.value,
    fallback,
    OFFSET_MIN,
    OFFSET_MAX,
    OFFSET_STEP,
    OFFSET_PRECISION,
  )
  emitSettingsPatch({
    offset: {
      ...props.settings.offset,
      [axis]: normalized,
    },
  })
  source.value = formatNumericValue(normalized, OFFSET_PRECISION)
}

function commitRotationInput() {
  const normalized = parseAndNormalize(
    rotationInput.value,
    props.settings.rotationDeg,
    ROTATION_MIN,
    ROTATION_MAX,
    ROTATION_STEP,
    ROTATION_PRECISION,
  )
  emitSettingsPatch({ rotationDeg: normalized })
  rotationInput.value = formatNumericValue(normalized, ROTATION_PRECISION)
}

function commitOpacityInput() {
  const normalized = parseAndNormalize(
    opacityInput.value,
    props.settings.opacity,
    OPACITY_MIN,
    OPACITY_MAX,
    OPACITY_STEP,
    OPACITY_PRECISION,
  )
  emitSettingsPatch({ opacity: normalized })
  opacityInput.value = formatNumericValue(normalized, OPACITY_PRECISION)
}

const smoothnessPercent = computed(() => `${Math.round((smoothnessModel.value ?? 0) * 100)}%`)

function resolveLayerTitle(layer: TerrainPaintLayerDefinition): string {
  if (props.selectedLayerAsset?.id === layer.textureAssetId && props.selectedLayerAsset.name) {
    return props.selectedLayerAsset.name
  }
  if (layer.textureAssetId) {
    return layer.textureAssetId
  }
  return 'Unassigned Texture'
}

function emitStylePatch(patch: Partial<TerrainPaintLayerDefinition>): void {
  emit('update:selected-layer-style', patch)
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}
</script>

<template>
  <div class="terrain-paint-panel">
    <div class="control-row">
      <div class="control-group control-group--compact">
        <div class="text-caption">Brush Radius: {{ brushRadiusInput }} m</div>
        <v-text-field
          v-model="brushRadiusInput"
          type="number"
          suffix="m"
          :min="BRUSH_RADIUS_MIN"
          :max="BRUSH_RADIUS_MAX"
          :step="BRUSH_RADIUS_STEP"
          variant="underlined"
          density="compact"
          hide-details
          inputmode="decimal"
          :disabled="!props.hasGround"
          class="numeric-input"
          @blur="commitBrushRadiusInput"
          @keydown.enter.prevent="commitBrushRadiusInput"
        />
      </div>

      <div class="control-group control-group--compact">
        <div class="text-caption">Edge Smoothing: {{ smoothnessPercent }}</div>
        <v-text-field
          v-model="smoothnessInput"
          type="number"
          suffix="x"
          :min="SMOOTHNESS_MIN"
          :max="SMOOTHNESS_MAX"
          :step="SMOOTHNESS_STEP"
          variant="underlined"
          density="compact"
          hide-details
          inputmode="decimal"
          :disabled="!props.hasGround"
          class="numeric-input"
          @blur="commitSmoothnessInput"
          @keydown.enter.prevent="commitSmoothnessInput"
        />
      </div>
    </div>

    <div class="layer-toolbar">
      <div class="text-caption">Paint Layers</div>
      <v-btn
        size="small"
        variant="tonal"
        color="primary"
        prepend-icon="mdi-plus"
        :disabled="!props.hasGround || !props.canAddLayer"
        @click="emit('add-layer')"
      >
        Add Layer
      </v-btn>
    </div>

    <div class="layer-list">
      <button
        type="button"
        class="layer-item"
        :class="{ 'layer-item--selected': baseSelected }"
        :disabled="!props.hasGround"
        @click="emit('select-base')"
      >
        <div class="layer-item__main">
          <span class="layer-slot">Base</span>
          <div class="layer-copy">
            <div class="layer-title">Erase To Ground</div>
            <div class="layer-subtitle">Paint back into slot 0</div>
          </div>
        </div>
      </button>

      <button
        v-for="layer in sortedLayers"
        :key="layer.id"
        type="button"
        class="layer-item"
        :class="{ 'layer-item--selected': layer.id === props.selectedLayerId }"
        :disabled="!props.hasGround"
        @click="emit('select-layer', layer.id)"
      >
        <div class="layer-item__main">
          <span class="layer-slot">L{{ layer.slotIndex }}</span>
          <div class="layer-copy">
            <div class="layer-title">{{ resolveLayerTitle(layer) }}</div>
            <div class="layer-subtitle">{{ layer.enabled ? 'Enabled' : 'Disabled' }}</div>
          </div>
        </div>
        <div class="layer-item__actions" @click.stop>
          <v-switch
            :model-value="layer.enabled"
            color="primary"
            density="compact"
            hide-details
            inset
            @update:model-value="(value) => emit('toggle-layer-enabled', layer.id, !!value)"
          />
          <v-btn
            icon="mdi-delete-outline"
            size="x-small"
            variant="text"
            color="error"
            @click="emit('remove-layer', layer.id)"
          />
        </div>
      </button>
    </div>

    <div v-if="selectedLayer" class="selected-layer-editor">
      <div class="text-caption">Selected Layer: L{{ selectedLayer.slotIndex }}</div>

      <div class="control-group">
        <div class="text-caption mb-1">Texture</div>
        <AssetPickerList
          :active="true"
          :asset-id="selectedAssetId"
          asset-type="image,texture"
          :show-search="true"
          :thumbnail-size="52"
          @update:asset="(next) => emit('update:selected-layer-asset', next)"
        />
      </div>

      <div class="control-grid">
        <div class="control-group">
          <div class="text-caption">Opacity: {{ Math.round((selectedLayer.opacity ?? 1) * 100) }}%</div>
          <v-slider
            :model-value="selectedLayer.opacity ?? 1"
            :min="0"
            :max="1"
            :step="0.01"
            density="compact"
            hide-details
            color="primary"
            @update:model-value="(value) => emitStylePatch({ opacity: toFiniteNumber(value, 1) })"
          />
        </div>

        <div class="control-group">
          <div class="text-caption">Blend Mode</div>
          <v-select
            :items="blendModeOptions"
            item-title="title"
            item-value="value"
            :model-value="selectedLayer.blendMode"
            density="compact"
            hide-details
            variant="outlined"
            @update:model-value="(value) => emitStylePatch({ blendMode: value as TerrainPaintBlendMode })"
          />
        </div>

        <div class="control-group">
          <div class="text-caption">Tile X</div>
          <v-text-field
            :model-value="selectedLayer.tileScale.x"
            density="compact"
            hide-details
            variant="outlined"
            type="number"
            @update:model-value="(value) => emitStylePatch({ tileScale: { ...selectedLayerTileScale, x: Math.max(0.001, toFiniteNumber(value, 1)) } })"
          />
        </div>

        <div class="control-group">
          <div class="text-caption">Tile Y</div>
          <v-text-field
            :model-value="selectedLayer.tileScale.y"
            density="compact"
            hide-details
            variant="outlined"
            type="number"
            @update:model-value="(value) => emitStylePatch({ tileScale: { ...selectedLayerTileScale, y: Math.max(0.001, toFiniteNumber(value, 1)) } })"
          />
        </div>

        <div class="control-group">
          <div class="text-caption">Offset X</div>
          <v-text-field
            :model-value="selectedLayer.offset.x"
            density="compact"
            hide-details
            variant="outlined"
            type="number"
            @update:model-value="(value) => emitStylePatch({ offset: { ...selectedLayerOffset, x: toFiniteNumber(value, 0) } })"
          />
        </div>

        <div class="control-group">
          <div class="text-caption">Offset Y</div>
          <v-text-field
            :model-value="selectedLayer.offset.y"
            density="compact"
            hide-details
            variant="outlined"
            type="number"
            @update:model-value="(value) => emitStylePatch({ offset: { ...selectedLayerOffset, y: toFiniteNumber(value, 0) } })"
          />
        </div>

        <div class="control-group">
          <div class="text-caption">Rotation</div>
          <v-text-field
            :model-value="selectedLayer.rotationDeg"
            density="compact"
            hide-details
            variant="outlined"
            type="number"
            suffix="deg"
            @update:model-value="(value) => emitStylePatch({ rotationDeg: toFiniteNumber(value, 0) })"
          />
        </div>

        <div class="control-group control-group--switch">
          <div class="text-caption">World Space UV</div>
          <v-switch
            :model-value="selectedLayer.worldSpace"
            color="primary"
            density="compact"
            hide-details
            inset
            @update:model-value="(value) => emitStylePatch({ worldSpace: !!value })"
          />
        </div>
      </div>
    </div>

    <div v-else-if="baseSelected" class="hint-text">
      当前选择为 Base。落笔会把当前区域恢复到地面底层，不会写入额外 paint layer。
    </div>

    <div v-else class="hint-text">
      先创建或选择一个 paint layer，再为它指定纹理和样式参数。
    </div>
  </div>
</template>

<style scoped>
.terrain-paint-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.control-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.control-group--switch {
  align-self: end;
}

.layer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.layer-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.layer-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  color: inherit;
  text-align: left;
}

.layer-item--selected {
  border-color: rgba(var(--v-theme-primary), 0.75);
  background: rgba(var(--v-theme-primary), 0.14);
}

.layer-item__main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.layer-item__actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.layer-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 12px;
  font-weight: 600;
}

.layer-copy {
  min-width: 0;
}

.layer-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.layer-subtitle {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.62);
}

.selected-layer-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 4px;
}

.hint-text {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
}
</style>
