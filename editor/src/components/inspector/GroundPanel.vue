<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import { useTerrainStore } from '@/stores/terrainStore'
import type { GroundDynamicMesh, GroundGenerationMode, GroundGenerationSettings, GroundSculptOperation } from '@harmony/schema'
import { applyGroundGeneration } from '@schema/groundMesh'
import TerrainSculptPanel from './TerrainSculptPanel.vue'
import GroundAssetPainter from './GroundAssetPainter.vue'
import type { TerrainScatterCategory } from '@harmony/schema/terrain-scatter'
import { terrainScatterPresets } from '@/resources/projectProviders/asset'
import type { GroundPanelTab } from '@/stores/terrainStore'
import type { ProjectAsset } from '@/types/project-asset'
import { SCATTER_BRUSH_RADIUS_MAX } from '@/constants/terrainScatter'

const sceneStore = useSceneStore()
const terrainStore = useTerrainStore()
const { selectedNode } = storeToRefs(sceneStore)
const { brushRadius, brushStrength, brushShape, brushOperation, groundPanelTab, scatterBrushRadius, scatterDensityPercent } =
  storeToRefs(terrainStore)

const selectedGroundNode = computed(() => {
  if (selectedNode.value?.dynamicMesh?.type === 'Ground') {
    return selectedNode.value
  }
  return null
})

const groundDefinition = computed(() => selectedGroundNode.value?.dynamicMesh as GroundDynamicMesh | undefined)
const hasGround = computed(() => Boolean(groundDefinition.value))

const localWidth = computed(() => groundDefinition.value?.width ?? 0)
const localDepth = computed(() => groundDefinition.value?.depth ?? 0)
const enableAirWall = computed({
  get: () => sceneStore.groundSettings.enableAirWall === true,
  set: (value: boolean) => {
    sceneStore.setGroundAirWallEnabled(value)
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

function detectManualEdits(definition: GroundDynamicMesh): boolean {
  if (!definition) {
    return false
  }
  if (typeof definition.hasManualEdits === 'boolean') {
    return definition.hasManualEdits
  }
  if (!definition.generation) {
    const hasVariation = Object.values(definition.heightMap).some((value) => Math.abs(value) > 1e-4)
    definition.hasManualEdits = hasVariation
    return hasVariation
  }

  // Avoid deep-cloning large Ground definitions. We only need a scratch mesh with
  // matching dimensions + generation settings and a fresh heightMap to generate into.
  const scratch: GroundDynamicMesh = {
    type: 'Ground',
    width: definition.width,
    depth: definition.depth,
    rows: definition.rows,
    columns: definition.columns,
    cellSize: definition.cellSize,
    heightMap: {},
    generation: definition.generation ? { ...definition.generation } : null,
  }
  if (!scratch.generation) {
    definition.hasManualEdits = false
    return false
  }
  applyGroundGeneration(scratch, scratch.generation)
  const epsilon = 1e-4
  const actualMap = definition.heightMap
  const generatedMap = scratch.heightMap
  const keys = new Set([...Object.keys(actualMap), ...Object.keys(generatedMap)])
  for (const key of keys) {
    const delta = Math.abs((actualMap[key] ?? 0) - (generatedMap[key] ?? 0))
    if (delta > epsilon) {
      definition.hasManualEdits = true
      return true
    }
  }
  definition.hasManualEdits = false
  return false
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
  const canRegenerate = !detectManualEdits(definition)
  if (canRegenerate) {
    // Regenerate into a fresh heightMap (do not clone existing heightMap).
    const scratch: GroundDynamicMesh = {
      ...definition,
      heightMap: {},
      generation: nextGeneration,
    }
    applyGroundGeneration(scratch, nextGeneration)
    sceneStore.updateNodeDynamicMesh(node.id, {
      generation: nextGeneration,
      heightMap: scratch.heightMap,
      hasManualEdits: false,
    })
  } else {
    sceneStore.updateNodeDynamicMesh(node.id, { generation: nextGeneration })
  }
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
  { immediate: true },
)

watch(noiseStrength, (value) => {
  if (syncingGeneration || !hasGround.value) {
    return
  }
  applyGenerationPatch({ noiseStrength: clampNoiseStrength(value) })
})

watch(selectedNoiseMode, (mode) => {
  if (syncingGeneration || !hasGround.value) {
    return
  }
  applyGenerationPatch({ mode })
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

      <div class="ground-tool-tabs">
        <div class="ground-tabs-layout">
          <v-tabs
            v-model="groundPanelTabModel"
            density="compact"
            :transition="false"
            class="ground-tabs"
          >
            <v-tab value="terrain" :title="'地形工具'">
              <v-icon icon="mdi-image-edit-outline" size="16" />
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
            v-if="groundPanelTabModel !== 'terrain'"
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

.ground-tool-tabs {
  margin-top: 12px;
}

.ground-tabs-layout {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ground-tabs :deep(.v-tab) {
  min-height: 26px;
  min-width: 26px;
  padding: 0;
  justify-content: center;
}

.ground-tab-window {
  flex: 1;
}

.v-tab.v-tab.v-btn {
    width: 40px;
    height: 30px;
    min-width: 40px;
}


.scatter-spacing-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.scatter-spacing-labels {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}

</style>
