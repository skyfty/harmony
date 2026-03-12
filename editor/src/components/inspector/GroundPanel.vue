<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import { useTerrainStore,SCATTER_BRUSH_RADIUS_MAX } from '@/stores/terrainStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import type { GroundDynamicMesh, GroundGenerationMode, GroundGenerationSettings, GroundSculptOperation } from '@schema'
import {
  clampTerrainPaintLayerDefinition,
  clampTerrainPaintSettings,
  getTerrainPaintChunkPageLogicalId,
  TERRAIN_PAINT_MAX_LAYER_COUNT,
  TERRAIN_PAINT_PAGE_COUNT,
  type TerrainPaintLayerDefinition,
  type TerrainPaintSettings,
} from '@schema'
import { decodeWeightmapToData, encodeWeightmapToBinary } from '@schema/terrainPaintPreview.ts'
import TerrainSculptPanel from './TerrainSculptPanel.vue'
import TerrainPaintPanel from './TerrainPaintPanel.vue'
import GroundAssetPainter from './GroundAssetPainter.vue'
import type { TerrainScatterCategory } from '@schema/terrain-scatter'
import { terrainScatterPresets } from '@/resources/projectProviders/asset'
import type { GroundPanelTab } from '@/stores/terrainStore'
import type { ProjectAsset } from '@/types/project-asset'
import { assetProvider } from '@/resources/projectProviders/asset'
import { computeBlobHash } from '@/utils/blob'

const sceneStore = useSceneStore()
const terrainStore = useTerrainStore()
const assetCacheStore = useAssetCacheStore()
const { selectedNode } = storeToRefs(sceneStore)
const {
  brushRadius,
  brushStrength,
  brushShape,
  brushOperation,
  groundPanelTab,
  paintSelectedLayerId,
  paintSelectedLayerSlotIndex,
  paintSelectedAsset,
  paintSmoothness,
  scatterBrushRadius,
  scatterDensityPercent,
} =
  storeToRefs(terrainStore)

const selectedGroundNode = computed(() => {
  if (selectedNode.value?.dynamicMesh?.type === 'Ground') {
    return selectedNode.value
  }
  return null
})

const groundDefinition = computed(() => selectedGroundNode.value?.dynamicMesh as GroundDynamicMesh | undefined)

const localWidth = computed(() => groundDefinition.value?.width ?? 0)
const localDepth = computed(() => groundDefinition.value?.depth ?? 0)
const enableAirWall = computed({
  get: () => sceneStore.groundSettings.enableAirWall === true,
  set: (value: boolean) => {
    sceneStore.setGroundAirWallEnabled(value)
  },
})

const groundCastShadow = computed({
  get: () => groundDefinition.value?.castShadow === true,
  set: (value: boolean) => {
    const node = selectedGroundNode.value
    if (!node || node.dynamicMesh?.type !== 'Ground') {
      return
    }
    sceneStore.updateGroundNodeDynamicMesh(node.id, { castShadow: value })
  },
})

const noiseStrength = ref(1)
const selectedNoiseMode = ref<GroundGenerationMode>('perlin')
let syncingGeneration = false

const scatterTabs = computed(() =>
  (Object.keys(terrainScatterPresets) as TerrainScatterCategory[]).map((key) => ({
    key,
    label: terrainScatterPresets[key].label,
    icon: terrainScatterPresets[key].icon,
  })),
)

const groundPanelTabModel = computed<GroundPanelTab>({
  get: () => groundPanelTab.value,
  set: (value) => terrainStore.setGroundPanelTab(value),
})

const isScatterTabActive = computed(() => groundPanelTabModel.value !== 'terrain' && groundPanelTabModel.value !== 'paint')

const paintSmoothnessModel = computed({
  get: () => paintSmoothness.value,
  set: (value: number) => terrainStore.setPaintSmoothness(value),
})

const scatterBrushRadiusModel = computed({
  get: () => scatterBrushRadius.value,
  set: (value: number) => terrainStore.setScatterBrushRadius(Number(value)),
})
const scatterBrushRadiusDisplay = computed(() => scatterBrushRadius.value.toFixed(2))

const scatterDensityPercentModel = computed({
  get: () => scatterDensityPercent.value,
  set: (value: number) => terrainStore.setScatterDensityPercent(Number(value)),
})
const scatterDensityPercentDisplay = computed(() => `${Math.round(scatterDensityPercent.value)}%`)

const terrainOperations: Array<{ value: GroundSculptOperation; label: string; icon: string }> = [
  { value: 'depress', label: 'Depress', icon: 'mdi-tray-arrow-down' },
  { value: 'smooth', label: 'Smooth', icon: 'mdi-water-percent' },
  { value: 'flatten', label: 'Flatten', icon: 'mdi-ruler' },
  { value: 'flatten-zero', label: 'Flatten to Zero', icon: 'mdi-border-bottom-variant' },
  { value: 'raise', label: 'Raise', icon: 'mdi-tray-arrow-up' },
]

const noiseModeOptions: Array<{ value: GroundGenerationMode; label: string; icon: string }> = [
  { value: 'simple', label: 'Simple Noise', icon: 'mdi-wave-sine' },
  { value: 'perlin', label: 'Perlin Noise', icon: 'mdi-grain' },
  { value: 'ridge', label: 'Ridge Noise', icon: 'mdi-mountain' },
  { value: 'voronoi', label: 'Voronoi Noise', icon: 'mdi-shape-polygon-plus' },
  { value: 'flat', label: 'Flat', icon: 'mdi-border-horizontal' },
]

function clampNoiseStrength(value: number): number {
  if (!Number.isFinite(value)) {
    return 1
  }
  return Math.min(5, Math.max(0, Number(value)))
}

function buildGenerationPayload(definition?: GroundDynamicMesh): GroundGenerationSettings {
  const fallback: GroundGenerationSettings = {
    mode: 'perlin',
    noiseScale: Math.max(10, definition?.width ?? 80),
    noiseAmplitude: 6,
    noiseStrength: 1,
  }
  if (!definition?.generation) {
    return fallback
  }
  return {
    ...fallback,
    ...definition.generation,
  }
}

function applyGenerationPatch(patch: Partial<GroundGenerationSettings>) {
  const node = selectedGroundNode.value
  if (!node || node.dynamicMesh?.type !== 'Ground') {
    return
  }
  const definition = node.dynamicMesh as GroundDynamicMesh
  const nextGeneration: GroundGenerationSettings = {
    ...buildGenerationPayload(definition),
    ...patch,
  }
  nextGeneration.worldWidth = definition.width
  nextGeneration.worldDepth = definition.depth
  sceneStore.updateNodeDynamicMesh(node.id, { generation: nextGeneration })
}

watch(
  groundDefinition,
  (definition) => {
    syncingGeneration = true
    const generation = definition?.generation
    noiseStrength.value = clampNoiseStrength(generation?.noiseStrength ?? 1)
    selectedNoiseMode.value = generation?.mode ?? 'perlin'
    nextTick(() => {
      syncingGeneration = false
    })
  },
})

function handleScatterAssetSelect(
  category: TerrainScatterCategory,
  payload: { asset: ProjectAsset; providerAssetId: string },
): void {
  if (!hasGround.value) {
    return
  }
  terrainStore.setScatterCategory(category)
  terrainStore.setScatterSelection(payload)
}

function chooseAvailablePaintSlot(settings: TerrainPaintSettings): number | null {
  const used = new Set(settings.layers.map((layer) => Math.max(0, Math.min(TERRAIN_PAINT_MAX_LAYER_COUNT - 1, Math.trunc(layer.slotIndex ?? 0)))))
  for (let slotIndex = 1; slotIndex < TERRAIN_PAINT_MAX_LAYER_COUNT; slotIndex += 1) {
    if (!used.has(slotIndex)) {
      return slotIndex
    }
  }
  return null
}

function createBlankWeightmapPage(resolution: number, pageIndex: number): Uint8ClampedArray {
  const res = Math.max(1, Math.round(resolution))
  const data = new Uint8ClampedArray(res * res * 4)
  if (pageIndex === 0) {
    for (let i = 0; i < res * res; i += 1) {
      const offset = i * 4
      data[offset] = 255
    }
  }
  return data
}

function readPixelWeightsFromPages(pages: Uint8ClampedArray[], pixelIndex: number): number[] {
  const weights = new Array(TERRAIN_PAINT_PAGE_COUNT * 4).fill(0)
  for (let pageIndex = 0; pageIndex < TERRAIN_PAINT_PAGE_COUNT; pageIndex += 1) {
    const page = pages[pageIndex]
    if (!page) {
      continue
    }
    const offset = pixelIndex * 4
    for (let channelIndex = 0; channelIndex < 4; channelIndex += 1) {
      weights[pageIndex * 4 + channelIndex] = page[offset + channelIndex] ?? 0
    }
  }
  return weights
}

function writePixelWeightsToPages(pages: Uint8ClampedArray[], pixelIndex: number, weights: number[]): void {
  for (let pageIndex = 0; pageIndex < TERRAIN_PAINT_PAGE_COUNT; pageIndex += 1) {
    const page = pages[pageIndex]
    if (!page) {
      continue
    }
    const offset = pixelIndex * 4
    for (let channelIndex = 0; channelIndex < 4; channelIndex += 1) {
      page[offset + channelIndex] = weights[pageIndex * 4 + channelIndex] ?? 0
    }
  }
}

function isWeightmapPageEmpty(page: Uint8ClampedArray, pageIndex: number): boolean {
  for (let offset = 0; offset < page.length; offset += 4) {
    const r = page[offset] ?? 0
    const g = page[offset + 1] ?? 0
    const b = page[offset + 2] ?? 0
    const a = page[offset + 3] ?? 0
    if (pageIndex === 0) {
      if (r !== 255 || g !== 0 || b !== 0 || a !== 0) {
        return false
      }
    } else if (r !== 0 || g !== 0 || b !== 0 || a !== 0) {
      return false
    }
  }
  return true
}

function createTerrainPaintLayerId(slotIndex: number): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `terrain-paint-layer-${slotIndex}-${crypto.randomUUID()}`
  }
  return `terrain-paint-layer-${slotIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function resolvePaintLayerAsset(assetId: string | null | undefined): ProjectAsset | null {
  const normalizedId = typeof assetId === 'string' ? assetId.trim() : ''
  if (!normalizedId) {
    return null
  }
  return sceneStore.getAsset(normalizedId) ?? (paintSelectedAsset.value?.id === normalizedId ? paintSelectedAsset.value : null)
}

function buildTerrainPaintSettings(): TerrainPaintSettings {
  return clampTerrainPaintSettings(groundDefinition.value?.terrainPaint as Partial<TerrainPaintSettings> | null | undefined)
}

const terrainPaintSettings = computed(() => buildTerrainPaintSettings())

const paintLayers = computed(() =>
  terrainPaintSettings.value.layers.slice().sort((left, right) => left.slotIndex - right.slotIndex),
)

const canAddPaintLayer = computed(() => paintLayers.value.length < TERRAIN_PAINT_MAX_LAYER_COUNT - 1)

const selectedPaintLayer = computed(() => {
  const selectedId = paintSelectedLayerId.value
  if (!selectedId) {
    return null
  }
  return paintLayers.value.find((layer) => layer.id === selectedId) ?? null
})

const selectedPaintLayerAsset = computed(() => resolvePaintLayerAsset(selectedPaintLayer.value?.textureAssetId))

function applyTerrainPaintSettings(settings: TerrainPaintSettings): void {
  const node = selectedGroundNode.value
  if (!node || node.dynamicMesh?.type !== 'Ground') {
    return
  }
  sceneStore.updateNodeDynamicMesh(node.id, { terrainPaint: settings })
}

async function ensurePaintAssetRegistered(asset: ProjectAsset | null): Promise<void> {
  if (!asset?.id) {
    return
  }
  const existing = sceneStore.findAssetInCatalog(asset.id)
  if (existing) {
    return
  }
  sceneStore.registerAssets([asset], {
    source: { type: 'package', providerId: assetProvider.id, originalAssetId: asset.id },
    commitOptions: { updateNodes: false },
  })
}

async function loadWeightmapPageData(
  ref: TerrainPaintSettings['chunks'][string] | undefined,
  pageIndex: number,
  resolution: number,
): Promise<Uint8ClampedArray> {
  const logicalId = getTerrainPaintChunkPageLogicalId(ref, pageIndex)
  if (!logicalId) {
    return createBlankWeightmapPage(resolution, pageIndex)
  }

  let entry = await assetCacheStore.loadFromIndexedDb(logicalId)
  if (!entry?.blob) {
    const asset = sceneStore.getAsset(logicalId)
    if (asset) {
      entry = await assetCacheStore.downloaProjectAsset(asset)
    }
  }

  if (!entry?.blob) {
    return createBlankWeightmapPage(resolution, pageIndex)
  }

  try {
    return await decodeWeightmapToData(entry.blob, resolution)
  } catch (error) {
    console.warn('Failed to decode terrain paint page while removing layer', error)
    return createBlankWeightmapPage(resolution, pageIndex)
  }
}

async function clearTerrainPaintLayerWeights(settings: TerrainPaintSettings, layer: TerrainPaintLayerDefinition): Promise<void> {
  const slotIndex = Math.max(1, Math.min(TERRAIN_PAINT_MAX_LAYER_COUNT - 1, Math.trunc(layer.slotIndex ?? 0)))
  const resolution = Math.max(8, Math.round(settings.weightmapResolution || 256))
  const pixelCount = resolution * resolution

  for (const [chunkKey, ref] of Object.entries(settings.chunks ?? {})) {
    const pages = await Promise.all(
      Array.from({ length: TERRAIN_PAINT_PAGE_COUNT }, (_, pageIndex) => loadWeightmapPageData(ref, pageIndex, resolution)),
    )

    let changed = false
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      const weights = readPixelWeightsFromPages(pages, pixelIndex)
      const removedWeight = weights[slotIndex] ?? 0
      if (removedWeight <= 0) {
        continue
      }
      weights[slotIndex] = 0
      weights[0] = (weights[0] ?? 0) + removedWeight
      writePixelWeightsToPages(pages, pixelIndex, weights)
      changed = true
    }

    if (!changed) {
      continue
    }

    const nextPages = Array.from({ length: TERRAIN_PAINT_PAGE_COUNT }, () => null as { logicalId: string } | null)
    for (let pageIndex = 0; pageIndex < TERRAIN_PAINT_PAGE_COUNT; pageIndex += 1) {
      const page = pages[pageIndex] ?? createBlankWeightmapPage(resolution, pageIndex)
      if (isWeightmapPageEmpty(page, pageIndex)) {
        nextPages[pageIndex] = null
        continue
      }

      const blob = encodeWeightmapToBinary(page, resolution)
      const logicalId = await computeBlobHash(blob)
      const filename = `terrain-weightmap_${selectedGroundNode.value?.id ?? 'ground'}_${chunkKey}_p${pageIndex}.bin`
      await assetCacheStore.storeAssetBlob(logicalId, {
        blob,
        mimeType: 'application/octet-stream',
        filename,
      })
      sceneStore.registerAsset(
        {
          id: logicalId,
          name: filename,
          type: 'file',
          downloadUrl: logicalId,
          previewColor: '#ffffff',
          thumbnail: null,
          description: `Terrain weightmap (${selectedGroundNode.value?.id ?? 'ground'}:${chunkKey}:page${pageIndex})`,
          gleaned: true,
        },
        {
          source: { type: 'local' },
          internal: true,
          commitOptions: { updateNodes: false },
        },
      )
      nextPages[pageIndex] = { logicalId }
    }

    if (nextPages.some((page) => page?.logicalId)) {
      settings.chunks[chunkKey] = {
        logicalId: nextPages[0]?.logicalId ?? null,
        pages: nextPages,
      }
    } else {
      delete settings.chunks[chunkKey]
    }
  }
}

function setPaintBaseSelection(): void {
  terrainStore.setPaintLayerSelection({ layerId: null, slotIndex: 0, asset: null })
}

function setPaintLayerSelection(layer: TerrainPaintLayerDefinition | null): void {
  if (!layer) {
    setPaintBaseSelection()
    return
  }
  terrainStore.setPaintLayerSelection({
    layerId: layer.id,
    slotIndex: layer.slotIndex,
    asset: resolvePaintLayerAsset(layer.textureAssetId),
  })
}

function syncSelectedPaintLayer(): void {
  if (!hasGround.value) {
    terrainStore.clearPaintSelection()
    return
  }
  if (paintSelectedLayerSlotIndex.value === 0 && !paintSelectedLayerId.value) {
    setPaintBaseSelection()
    return
  }
  const current = selectedPaintLayer.value
  if (current) {
    setPaintLayerSelection(current)
    return
  }
  const firstLayer = paintLayers.value[0] ?? null
  if (firstLayer) {
    setPaintLayerSelection(firstLayer)
    return
  }
  setPaintBaseSelection()
}

watch([groundDefinition, paintLayers], () => {
  syncSelectedPaintLayer()
}, { immediate: true })

function handleCreatePaintLayer(): void {
  if (!hasGround.value) {
    return
  }
  const settings = buildTerrainPaintSettings()
  const slotIndex = chooseAvailablePaintSlot(settings)
  if (slotIndex === null) {
    return
  }
  const layer = clampTerrainPaintLayerDefinition({
    id: createTerrainPaintLayerId(slotIndex),
    slotIndex,
    textureAssetId: '',
    enabled: true,
  })
  settings.layers.push(layer)
  applyTerrainPaintSettings(settings)
  setPaintLayerSelection(layer)
}

function handlePaintLayerSelect(layerId: string): void {
  const layer = paintLayers.value.find((entry) => entry.id === layerId) ?? null
  setPaintLayerSelection(layer)
}

function handlePaintLayerEnabled(layerId: string, enabled: boolean): void {
  const settings = buildTerrainPaintSettings()
  const index = settings.layers.findIndex((layer) => layer.id === layerId)
  if (index < 0) {
    return
  }
  settings.layers[index] = clampTerrainPaintLayerDefinition({
    ...settings.layers[index],
    enabled,
  })
  applyTerrainPaintSettings(settings)
  if (settings.layers[index]) {
    setPaintLayerSelection(settings.layers[index])
  }
}

async function handlePaintLayerRemove(layerId: string): Promise<void> {
  const settings = buildTerrainPaintSettings()
  const layer = settings.layers.find((entry) => entry.id === layerId) ?? null
  if (!layer) {
    return
  }
  await clearTerrainPaintLayerWeights(settings, layer)
  settings.layers = settings.layers.filter((entry) => entry.id !== layerId)
  applyTerrainPaintSettings(settings)
  if (paintSelectedLayerId.value === layerId) {
    const nextLayer = settings.layers.slice().sort((left, right) => left.slotIndex - right.slotIndex)[0] ?? null
    if (nextLayer) {
      setPaintLayerSelection(nextLayer)
    } else {
      setPaintBaseSelection()
    }
  }
}

async function handleSelectedPaintLayerAssetUpdate(asset: ProjectAsset | null): Promise<void> {
  const currentLayer = selectedPaintLayer.value
  if (!currentLayer) {
    return
  }
  await ensurePaintAssetRegistered(asset)
  const settings = buildTerrainPaintSettings()
  const index = settings.layers.findIndex((layer) => layer.id === currentLayer.id)
  if (index < 0) {
    return
  }
  settings.layers[index] = clampTerrainPaintLayerDefinition({
    ...settings.layers[index],
    textureAssetId: asset?.id ?? '',
  })
  applyTerrainPaintSettings(settings)
  terrainStore.setPaintLayerSelection({
    layerId: settings.layers[index].id,
    slotIndex: settings.layers[index].slotIndex,
    asset,
  })
}

function handleSelectedPaintLayerStylePatch(patch: Partial<TerrainPaintLayerDefinition>): void {
  const currentLayer = selectedPaintLayer.value
  if (!currentLayer) {
    return
  }
  const settings = buildTerrainPaintSettings()
  const index = settings.layers.findIndex((layer) => layer.id === currentLayer.id)
  if (index < 0) {
    return
  }
  settings.layers[index] = clampTerrainPaintLayerDefinition({
    ...settings.layers[index],
    ...patch,
  })
  applyTerrainPaintSettings(settings)
  setPaintLayerSelection(settings.layers[index])
}

</script>

<template>
  <v-expansion-panel value="ground">
    <v-expansion-panel-title>
       Ground Tools
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="ground-dimensions">
        <v-text-field
          :model-value="localWidth"
          label="Width (m)"
          type="number"
          density="compact"
          variant="underlined"
          disabled
          suffix="m"
        />
        <v-text-field
          :model-value="localDepth"
          label="Depth (m)"
          type="number"
          density="compact"
          variant="underlined"
          disabled
          suffix="m"
        />
      </div>

      <v-switch
        v-model="enableAirWall"
        density="compact"
        hide-details
        color="primary"
        label="Enable Air Wall"
      />

      <v-switch
        v-model="groundCastShadow"
        density="compact"
        hide-details
        color="primary"
        label="Cast Ground Shadows"
      />

      <div class="ground-tool-tabs">
        <div class="ground-tabs-layout">
          <v-tabs
            v-model="groundPanelTabModel"
            density="compact"
            :transition="false"
            class="ground-tabs"
          >
            <v-tab value="terrain" :title="'Terrain Tools'">
              <v-icon icon="mdi-image-edit-outline" size="16" />
            </v-tab>
            <v-tab value="paint" :title="'Terrain Paint'">
              <v-icon icon="mdi-brush-variant" size="16" />
            </v-tab>
            <v-tab
              v-for="tab in scatterTabs"
              :key="tab.key"
              :value="tab.key"
              :title="tab.label"
            >
              <v-icon :icon="tab.icon" size="16" />
            </v-tab>
          </v-tabs>
          <div
            v-if="isScatterTabActive"
            class="scatter-spacing-panel"
          >
            <div class="scatter-spacing-item">
              <div class="scatter-spacing-labels">
                <span>Brush Radius</span>
                <span>{{ scatterBrushRadiusDisplay }} m</span>
              </div>
              <v-slider
                v-model="scatterBrushRadiusModel"
                :min="0.1"
                :max="SCATTER_BRUSH_RADIUS_MAX"
                :step="0.1"
                density="compact"
                track-color="rgba(77, 208, 225, 0.4)"
                color="primary"
              />
            </div>

            <div class="scatter-spacing-item">
              <div class="scatter-spacing-labels">
                <span>Density</span>
                <span>{{ scatterDensityPercentDisplay }}</span>
              </div>
              <v-slider
                v-model="scatterDensityPercentModel"
                :min="0"
                :max="100"
                :step="1"
                density="compact"
                track-color="rgba(77, 208, 225, 0.4)"
                color="primary"
              />
            </div>
          </div>
          <v-window
            v-model="groundPanelTabModel"
            class="ground-tab-window"
            touch
            :transition="false"
          >
            <v-window-item value="terrain">
              <TerrainSculptPanel
                v-model:brush-radius="brushRadius"
                v-model:brush-strength="brushStrength"
                v-model:brush-shape="brushShape"
                v-model:brush-operation="brushOperation"
                v-model:noise-strength="noiseStrength"
                v-model:noise-mode="selectedNoiseMode"
                :has-ground="hasGround"
                :terrain-operations="terrainOperations"
                :noise-mode-options="noiseModeOptions"
              />
            </v-window-item>

            <v-window-item value="paint">
              <TerrainPaintPanel
                v-model:brush-radius="brushRadius"
                v-model:smoothness="paintSmoothnessModel"
                :has-ground="hasGround"
                :layers="paintLayers"
                :selected-layer-id="paintSelectedLayerId"
                :selected-layer-slot-index="paintSelectedLayerSlotIndex"
                :selected-layer-asset="selectedPaintLayerAsset"
                :can-add-layer="canAddPaintLayer"
                @add-layer="handleCreatePaintLayer"
                @select-base="setPaintBaseSelection"
                @select-layer="handlePaintLayerSelect"
                @toggle-layer-enabled="handlePaintLayerEnabled"
                @remove-layer="handlePaintLayerRemove"
                @update:selected-layer-asset="handleSelectedPaintLayerAssetUpdate"
                @update:selected-layer-style="handleSelectedPaintLayerStylePatch"
              />
            </v-window-item>

            <v-window-item
              v-for="tab in scatterTabs"
              :key="`panel-${tab.key}`"
              :value="tab.key"
            >
              <GroundAssetPainter
                v-if="groundPanelTabModel === tab.key"
                :key="tab.key"
                :category="tab.key"
                @asset-select="(payload) => handleScatterAssetSelect(tab.key, payload)"
              />
            </v-window-item>
          </v-window>
        </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.ground-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.5rem;
}

.v-field-label {
  font-size: 0.82rem;
}
.slider-input :deep(.v-field-label) {
  font-size: 0.82rem;
  font-weight: 600;
}
.hint-text {
  display: block;
  margin-top: 0.25rem;
  color: rgba(220, 225, 232, 0.65);
}

.ground-dimensions {
  display: flex;
  gap: 12px;
}

.ground-dimensions :deep(.v-text-field) {
  flex: 1;
}

</style>
