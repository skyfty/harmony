<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import { useTerrainStore } from '@/stores/terrainStore'
import type { GroundDynamicMesh, GroundGenerationMode, GroundGenerationSettings, GroundSculptOperation } from '@harmony/schema'
import { applyGroundGeneration } from '@schema/groundMesh'

const sceneStore = useSceneStore()
const terrainStore = useTerrainStore()
const { selectedNode } = storeToRefs(sceneStore)
const { brushRadius, brushStrength, brushShape, brushOperation } = storeToRefs(terrainStore)

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

const noiseStrength = ref(1)
const selectedNoiseMode = ref<GroundGenerationMode>('perlin')
let syncingGeneration = false

const terrainOperations: Array<{ value: GroundSculptOperation; label: string; icon: string }> = [
  { value: 'depress', label: '凹陷', icon: 'mdi-tray-arrow-down' },
  { value: 'smooth', label: '平滑', icon: 'mdi-water-percent' },
  { value: 'flatten', label: '平整', icon: 'mdi-ruler' },
  { value: 'raise', label: '隆起', icon: 'mdi-tray-arrow-up' },
]

const noiseModeOptions: Array<{ value: GroundGenerationMode; label: string; icon: string }> = [
  { value: 'simple', label: '简单噪声', icon: 'mdi-wave-sine' },
  { value: 'perlin', label: '柏林噪声', icon: 'mdi-grain' },
  { value: 'ridge', label: '山脊噪声', icon: 'mdi-mountain' },
  { value: 'voronoi', label: '沃罗诺伊噪声', icon: 'mdi-shape-polygon-plus' },
  { value: 'flat', label: '平坦', icon: 'mdi-border-horizontal' },
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
  const clonedDefinition = JSON.parse(JSON.stringify(node.dynamicMesh)) as GroundDynamicMesh
  const nextGeneration: GroundGenerationSettings = {
    ...buildGenerationPayload(node.dynamicMesh as GroundDynamicMesh),
    ...patch,
  }
  nextGeneration.worldWidth = clonedDefinition.width
  nextGeneration.worldDepth = clonedDefinition.depth
  applyGroundGeneration(clonedDefinition, nextGeneration)
  sceneStore.updateNodeDynamicMesh(node.id, clonedDefinition)
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

</script>

<template>
  <v-expansion-panel value="ground">
    <v-expansion-panel-title>
       Terrain Tools
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

      <v-divider class="ground-panel-divider" />

      <div class="control-group " style="    margin: 0px 0px 10px 0px;">
        <div class="text-caption mb-1">Brush Shape</div>
        <v-btn-toggle v-model="brushShape" density="compact" mandatory divided variant="outlined" color="primary">
          <v-btn value="circle" icon="mdi-circle-outline" title="Circle"></v-btn>
          <v-btn value="square" icon="mdi-square-outline" title="Square"></v-btn>
          <v-btn value="star" icon="mdi-star-outline" title="Star"></v-btn>
        </v-btn-toggle>
      </div>
      
      <div class="control-group">
        <div class="text-caption mb-1">Operation</div>
        <v-btn-toggle
          v-model="brushOperation"
          density="compact"
          mandatory
          divided
          variant="outlined"
          color="primary"
          :disabled="!hasGround"
          class="icon-toggle-group"
        >
          <v-btn
            v-for="operation in terrainOperations"
            :key="operation.value"
            :value="operation.value"
            :title="operation.label"
            icon
            :aria-label="operation.label"
          >
            <v-icon :icon="operation.icon" />
          </v-btn>
        </v-btn-toggle>
      </div>

      <div class="control-group">
        <div class="text-caption">Brush Radius</div>
        <v-text-field
          v-model="brushRadius"
          min="0.1"
          max="50"
          step="0.1"
          type="number"
          density="compact"
          variant="underlined"
          hide-details
          suffix="m"
        />
      </div>

      <div class="control-group ">
        <div class="text-caption ">Brush Strength</div>
        <v-text-field
          v-model="brushStrength"
          min="0.1"
          max="10"
          step="0.1"
          type="number"
          variant="underlined"
          density="compact"
          hide-details
          suffix="m"
        />
      </div>

        <v-divider class="ground-panel-divider" />

        <div class="control-group">
          <div class="text-caption mb-1">Noise Type</div>
          <v-btn-toggle
            v-model="selectedNoiseMode"
            density="compact"
            mandatory
            divided
            variant="outlined"
            color="primary"
            class="icon-toggle-group"
            :disabled="!hasGround"
          >
            <v-btn
              v-for="option in noiseModeOptions"
              :key="option.value"
              :value="option.value"
              icon
              :title="option.label"
              :aria-label="option.label"
            >
              <v-icon :icon="option.icon" />
            </v-btn>
          </v-btn-toggle>
        </div>

        <div class="control-group">
          <div class="text-caption">Noise Strength</div>
        <v-text-field
            v-model="noiseStrength"
            :min="0"
            :max="5"
            :step="0.1"
          type="number"
          variant="underlined"
          density="compact"
            thumb-label="always"
            color="primary"
            :disabled="!hasGround"
          />
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

.ground-panel-divider {
  opacity: 0.15;
  margin: 12px 0;
}

.icon-toggle-group :deep(.v-btn) {
  min-width: 38px;
}
</style>
