<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema/core'
import { useSceneStore } from '@/stores/sceneStore'
import {
  CITY_GENERATOR_COMPONENT_TYPE,
  CITY_GENERATOR_MAX_INSTANCES,
  CITY_GENERATOR_VERTEX_BUDGET,
  clampCityGeneratorComponentProps,
  cloneProceduralCityHostSnapshot,
  resolveCityGeneratorGridPlan,
  resolvePolygonSurfaceHeight,
  resolveProceduralCityFootprint,
  type CityGeneratorBuildingPreset,
  type CityGeneratorComponentProps,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const cityComponent = computed(
  () => selectedNode.value?.components?.[CITY_GENERATOR_COMPONENT_TYPE] as
    | SceneNodeComponentState<CityGeneratorComponentProps>
    | undefined,
)

const props = computed(() => clampCityGeneratorComponentProps(cityComponent.value?.props))
const blockWidth = computed(() => props.value.lot * props.value.lotsX)
const blockDepth = computed(() => props.value.lot * props.value.lotsZ)
const hostOutline = computed(() => {
  const type = selectedNode.value?.dynamicMesh?.type
  return type === 'Region' || type === 'Floor' || type === 'Landform'
})
const detailedBuildings = computed(() => props.value.buildingPreset === 'skyscraper')

// the same derivation the component builds from, run in its dry-run mode so the panel
// can show what a region is going to cost before it is paid for
const plan = computed(() => {
  const snapshot = cloneProceduralCityHostSnapshot(selectedNode.value?.dynamicMesh)
  const surfaceY = snapshot ? resolvePolygonSurfaceHeight(snapshot) : 0
  return resolveCityGeneratorGridPlan(props.value, resolveProceduralCityFootprint(snapshot), surfaceY)
})
const blocksOnAuto = computed(() => props.value.blocksX === 0 || props.value.blocksZ === 0)

const vertexLabel = computed(() => {
  const value = plan.value.estimatedVertices
  return value >= 100000 ? `${(value / 1e6).toFixed(2)} M` : Math.round(value).toLocaleString('en-US')
})

const budgetLabel = computed(() => `${(CITY_GENERATOR_VERTEX_BUDGET / 1e6).toFixed(0)} M`)
const instanceCapLabel = computed(() => CITY_GENERATOR_MAX_INSTANCES.toLocaleString('en-US'))

const buildingPresetOptions: Array<{ title: string; value: CityGeneratorBuildingPreset }> = [
  { title: 'Skyscraper (detailed)', value: 'skyscraper' },
  { title: 'Solid (instanced)', value: 'solid' },
  { title: 'Office (instanced)', value: 'office' },
  { title: 'Bright (instanced)', value: 'bright' },
  { title: 'Classic (instanced)', value: 'classic' },
  { title: 'Warm (instanced)', value: 'warm' },
  { title: 'Cool (instanced)', value: 'cool' },
]

// the budget only applies to the detailed preset: one r180 tower bakes ~51k vertices
const heavyGrid = computed(() => plan.value.overBudget)

function updateNumber(key: keyof CityGeneratorComponentProps, value: number | string | null): void {
  const component = cityComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { [key]: numeric }, { autoSaveMode: 'interactive' })
}

function updateToggle(key: keyof CityGeneratorComponentProps, value: boolean | null): void {
  const component = cityComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { [key]: value === true }, { autoSaveMode: 'interactive' })
}

function updateBuildingPreset(value: string | null): void {
  const component = cityComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId || !value) {
    return
  }
  sceneStore.updateNodeComponentProps(
    nodeId,
    component.id,
    { buildingPreset: value as CityGeneratorBuildingPreset },
    { autoSaveMode: 'interactive' },
  )
}

function handleToggleComponent(): void {
  const component = cityComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent(): void {
  const component = cityComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}
</script>

<template>
  <v-expansion-panel :value="CITY_GENERATOR_COMPONENT_TYPE">
    <v-expansion-panel-title>
      <div class="city-generator-panel__header">
        <span class="city-generator-panel__title">City Generator</span>
        <v-spacer />
        <v-menu v-if="cityComponent" location="bottom end">
          <template #activator="{ props: menuProps }">
            <v-btn v-bind="menuProps" icon="mdi-dots-vertical" variant="text" size="small" density="comfortable" @click.stop />
          </template>
          <v-list density="compact">
            <v-list-item @click.stop="handleToggleComponent()">
              <v-list-item-title>{{ cityComponent.enabled ? 'Disable' : 'Enable' }}</v-list-item-title>
            </v-list-item>
            <v-divider class="component-menu-divider" inset />
            <v-list-item @click.stop="handleRemoveComponent()">
              <v-list-item-title>Remove</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="city-generator-panel__grid">
        <v-text-field
          label="Seed"
          density="compact"
          variant="underlined"
          type="number"
          min="0"
          step="1"
          :model-value="props.seed"
          :disabled="!cityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('seed', value)"
        />
        <v-select
          label="Building"
          density="compact"
          variant="underlined"
          :items="buildingPresetOptions"
          item-title="title"
          item-value="value"
          :model-value="props.buildingPreset"
          :disabled="!cityComponent?.enabled"
          @update:modelValue="(value) => updateBuildingPreset(value)"
        />
        <v-text-field
          label="Lot Size"
          density="compact"
          variant="underlined"
          type="number"
          min="8"
          step="1"
          suffix="m"
          :model-value="props.lot"
          :disabled="!cityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('lot', value)"
        />
        <v-text-field
          label="Street Width"
          density="compact"
          variant="underlined"
          type="number"
          min="6"
          step="0.5"
          suffix="m"
          :model-value="props.streetWidth"
          :disabled="!cityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('streetWidth', value)"
        />
        <v-text-field
          label="Lots X"
          density="compact"
          variant="underlined"
          type="number"
          min="1"
          max="4"
          step="1"
          :model-value="props.lotsX"
          :disabled="!cityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('lotsX', value)"
        />
        <v-text-field
          label="Lots Z"
          density="compact"
          variant="underlined"
          type="number"
          min="1"
          max="4"
          step="1"
          :model-value="props.lotsZ"
          :disabled="!cityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('lotsZ', value)"
        />
        <v-text-field
          label="Blocks X"
          density="compact"
          variant="underlined"
          type="number"
          min="0"
          max="24"
          step="1"
          hint="0 = auto"
          persistent-hint
          :model-value="props.blocksX"
          :disabled="!cityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('blocksX', value)"
        />
        <v-text-field
          label="Blocks Z"
          density="compact"
          variant="underlined"
          type="number"
          min="0"
          max="24"
          step="1"
          hint="0 = auto"
          persistent-hint
          :model-value="props.blocksZ"
          :disabled="!cityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('blocksZ', value)"
        />
        <v-text-field
          label="Sidewalk Width"
          density="compact"
          variant="underlined"
          type="number"
          min="1"
          step="0.5"
          suffix="m"
          :model-value="props.sidewalkWidth"
          :disabled="!cityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('sidewalkWidth', value)"
        />
        <v-text-field
          label="Curb Height"
          density="compact"
          variant="underlined"
          type="number"
          min="0"
          step="0.05"
          suffix="m"
          :model-value="props.curbHeight"
          :disabled="!cityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('curbHeight', value)"
        />
        <v-text-field
          label="Curb Radius"
          density="compact"
          variant="underlined"
          type="number"
          min="0"
          step="0.5"
          suffix="m"
          :model-value="props.curbRadius"
          :disabled="!cityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('curbRadius', value)"
        />
        <v-text-field
          label="Min Tower Height"
          density="compact"
          variant="underlined"
          type="number"
          min="1"
          step="1"
          suffix="m"
          :model-value="props.minTowerHeight"
          :disabled="!cityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('minTowerHeight', value)"
        />
        <v-text-field
          label="Max Tower Height"
          density="compact"
          variant="underlined"
          type="number"
          min="1"
          step="1"
          suffix="m"
          :model-value="props.maxTowerHeight"
          :disabled="!cityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('maxTowerHeight', value)"
        />
        <v-switch
          label="Road"
          density="compact"
          hide-details
          color="primary"
          :model-value="props.includeRoad"
          :disabled="!cityComponent?.enabled"
          @update:modelValue="(value) => updateToggle('includeRoad', value)"
        />
        <v-switch
          label="Sidewalks"
          density="compact"
          hide-details
          color="primary"
          :model-value="props.includeSidewalks"
          :disabled="!cityComponent?.enabled"
          @update:modelValue="(value) => updateToggle('includeSidewalks', value)"
        />
        <v-switch
          label="Streetlights"
          density="compact"
          hide-details
          color="primary"
          :model-value="props.includeStreetlights"
          :disabled="!cityComponent?.enabled"
          @update:modelValue="(value) => updateToggle('includeStreetlights', value)"
        />
        <v-switch
          label="Cars"
          density="compact"
          hide-details
          color="primary"
          :model-value="props.includeCars"
          :disabled="!cityComponent?.enabled"
          @update:modelValue="(value) => updateToggle('includeCars', value)"
        />
      </div>
      <div class="city-generator-panel__summary" :class="{ 'city-generator-panel__summary--warn': heavyGrid }">
        <div>
          Block {{ blockWidth.toFixed(0) }} × {{ blockDepth.toFixed(0) }} m ·
          {{ plan.blocksX }} × {{ plan.blocksZ }} blocks
          <span v-if="blocksOnAuto">(auto)</span><span v-else-if="plan.cappedByProps">(capped)</span>
        </div>
        <div>{{ plan.towers }} towers · {{ plan.cars }} cars · {{ plan.streetlights }} streetlights</div>
        <div>est. {{ vertexLabel }} geometry vertices</div>
        <div v-if="heavyGrid">
          Over the ~{{ budgetLabel }} vertex budget — switch to an instanced preset or raise Lot Size.
          The build still runs, but a grid this large can take a long time and exhaust video memory.
        </div>
        <div v-if="plan.cappedByProps">
          Blocks are capped at {{ props.blocksX }} × {{ props.blocksZ }} but the region needs
          {{ plan.requiredBlocksX }} × {{ plan.requiredBlocksZ }} — set either to 0 to fill the region.
        </div>
        <div v-if="plan.limitedByInstances">Stopped at the {{ instanceCapLabel }} instance cap.</div>
        <div v-if="hostOutline">Clipped to the host outline — blocks outside it are dropped.</div>
        <div v-else>No host outline — building the full grid from the block counts.</div>
        <div v-if="!detailedBuildings">Instanced {{ props.buildingPreset }} buildings — shared archetypes, no building shadows.</div>
        <div v-else-if="props.maxTowerHeight < 20">Skyscraper facades round up to at least three floors (~18 m); pick an instanced preset for genuinely low buildings.</div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.city-generator-panel__header {
  display: flex;
  align-items: center;
  width: 100%;
}

.city-generator-panel__title {
  font-weight: 500;
}

.city-generator-panel__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 12px;
}

.city-generator-panel__summary {
  margin-top: 8px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 12px;
  line-height: 1.5;
}

.city-generator-panel__summary--warn {
  color: rgb(var(--v-theme-warning));
}
</style>
