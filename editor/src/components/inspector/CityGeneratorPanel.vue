<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema/core'
import { useSceneStore } from '@/stores/sceneStore'
import {
  CITY_GENERATOR_COMPONENT_TYPE,
  clampCityGeneratorComponentProps,
  countCityGeneratorTowers,
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
const towerCount = computed(() => countCityGeneratorTowers(props.value))
const blockWidth = computed(() => props.value.lot * props.value.lotsX)
const blockDepth = computed(() => props.value.lot * props.value.lotsZ)

// one r180 tower bakes ~50k vertices, so the grid is the thing worth warning about
const heavyGrid = computed(() => towerCount.value > 40)

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
          max="3"
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
          max="3"
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
          min="1"
          max="3"
          step="1"
          :model-value="props.blocksX"
          :disabled="!cityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('blocksX', value)"
        />
        <v-text-field
          label="Blocks Z"
          density="compact"
          variant="underlined"
          type="number"
          min="1"
          max="3"
          step="1"
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
          min="6"
          step="2"
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
          min="6"
          step="2"
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
        <div>Block {{ blockWidth.toFixed(0) }} × {{ blockDepth.toFixed(0) }} m · City {{ (blockWidth * props.blocksX + props.streetWidth * (props.blocksX - 1)).toFixed(0) }} × {{ (blockDepth * props.blocksZ + props.streetWidth * (props.blocksZ - 1)).toFixed(0) }} m</div>
        <div>{{ towerCount }} towers{{ heavyGrid ? ' · heavy grid, expect a slow rebuild' : '' }}</div>
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
