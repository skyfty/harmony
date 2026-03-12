<script setup lang="ts">
import { computed } from 'vue'
import type { TerrainPaintLayerDefinition, TerrainPaintBlendMode } from '@schema'
import type { ProjectAsset } from '@/types/project-asset'
import AssetPickerList from '@/components/common/AssetPickerList.vue'

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

function formatSliderValue(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '0.0'
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
    <div class="control-group">
      <div class="text-caption">Brush Radius: {{ formatSliderValue(brushRadiusModel) }} m</div>
      <v-slider
        v-model="brushRadiusModel"
        :min="0.1"
        :max="50"
        :step="0.1"
        color="primary"
        density="compact"
        hide-details
        :disabled="!props.hasGround"
      />
    </div>

    <div class="control-group">
      <div class="text-caption">Edge Smoothing: {{ smoothnessPercent }}</div>
      <v-slider
        v-model="smoothnessModel"
        :min="0"
        :max="1"
        :step="0.01"
        color="primary"
        density="compact"
        hide-details
        :disabled="!props.hasGround"
      />
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
