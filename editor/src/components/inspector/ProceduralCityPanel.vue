<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema/core'
import { useSceneStore } from '@/stores/sceneStore'
import {
  PROCEDURAL_CITY_COMPONENT_TYPE,
  clampProceduralCityComponentProps,
  type ProceduralCityStyle,
  type ProceduralCityComponentProps,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const proceduralCityComponent = computed(
  () => selectedNode.value?.components?.[PROCEDURAL_CITY_COMPONENT_TYPE] as
    | SceneNodeComponentState<ProceduralCityComponentProps>
    | undefined,
)

const cityProps = computed(() => clampProceduralCityComponentProps(proceduralCityComponent.value?.props))

const styleOptions: Array<{ title: string; value: ProceduralCityStyle }> = [
  { title: 'Office', value: 'office' },
  { title: 'Bright', value: 'bright' },
  { title: 'Classic', value: 'classic' },
  { title: 'Warm', value: 'warm' },
  { title: 'Cool', value: 'cool' },
]

function updateNumber(key: keyof ProceduralCityComponentProps, value: number | string | null): void {
  const component = proceduralCityComponent.value
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

function updateStyle(value: string | null): void {
  const component = proceduralCityComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId || !value) {
    return
  }
  sceneStore.updateNodeComponentProps(
    nodeId,
    component.id,
    { style: value as ProceduralCityStyle },
    { autoSaveMode: 'interactive' },
  )
}

function handleToggleComponent(): void {
  const component = proceduralCityComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent(): void {
  const component = proceduralCityComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}
</script>

<template>
  <v-expansion-panel :value="PROCEDURAL_CITY_COMPONENT_TYPE">
    <v-expansion-panel-title>
      <div class="procedural-city-panel__header">
        <span class="procedural-city-panel__title">Procedural City</span>
        <v-spacer />
        <v-menu
          v-if="proceduralCityComponent"
          location="bottom end"
          origin="auto"
          transition="fade-transition"
        >
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon
              variant="text"
              size="small"
              class="component-menu-btn"
              @click.stop
            >
              <v-icon size="18">mdi-dots-vertical</v-icon>
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item @click.stop="handleToggleComponent()">
              <v-list-item-title>{{ proceduralCityComponent.enabled ? 'Disable' : 'Enable' }}</v-list-item-title>
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
      <div class="procedural-city-panel__grid">
        <v-text-field
          label="Seed"
          density="compact"
          variant="underlined"
          type="number"
          :model-value="cityProps.seed"
          :disabled="!proceduralCityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('seed', value)"
        />
        <v-select
          label="Style"
          density="compact"
          variant="underlined"
          :items="styleOptions"
          item-title="title"
          item-value="value"
          :model-value="cityProps.style"
          :disabled="!proceduralCityComponent?.enabled"
          @update:modelValue="(value) => updateStyle(value)"
        />
        <v-text-field
          label="Density"
          density="compact"
          variant="underlined"
          type="number"
          min="0"
          max="1"
          step="0.05"
          :model-value="cityProps.density"
          :disabled="!proceduralCityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('density', value)"
        />
        <v-text-field
          label="Spacing"
          density="compact"
          variant="underlined"
          type="number"
          min="0.25"
          step="0.25"
          suffix="m"
          :model-value="cityProps.spacing"
          :disabled="!proceduralCityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('spacing', value)"
        />
        <v-text-field
          label="Inset"
          density="compact"
          variant="underlined"
          type="number"
          min="0"
          step="0.25"
          suffix="m"
          :model-value="cityProps.inset"
          :disabled="!proceduralCityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('inset', value)"
        />
        <v-text-field
          label="Min Width"
          density="compact"
          variant="underlined"
          type="number"
          min="0.5"
          step="0.5"
          suffix="m"
          :model-value="cityProps.minWidth"
          :disabled="!proceduralCityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('minWidth', value)"
        />
        <v-text-field
          label="Max Width"
          density="compact"
          variant="underlined"
          type="number"
          min="0.5"
          step="0.5"
          suffix="m"
          :model-value="cityProps.maxWidth"
          :disabled="!proceduralCityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('maxWidth', value)"
        />
        <v-text-field
          label="Min Depth"
          density="compact"
          variant="underlined"
          type="number"
          min="0.5"
          step="0.5"
          suffix="m"
          :model-value="cityProps.minDepth"
          :disabled="!proceduralCityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('minDepth', value)"
        />
        <v-text-field
          label="Max Depth"
          density="compact"
          variant="underlined"
          type="number"
          min="0.5"
          step="0.5"
          suffix="m"
          :model-value="cityProps.maxDepth"
          :disabled="!proceduralCityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('maxDepth', value)"
        />
        <v-text-field
          label="Min Height"
          density="compact"
          variant="underlined"
          type="number"
          min="0.2"
          step="1"
          suffix="m"
          :model-value="cityProps.minHeight"
          :disabled="!proceduralCityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('minHeight', value)"
        />
        <v-text-field
          label="Max Height"
          density="compact"
          variant="underlined"
          type="number"
          min="0.2"
          step="1"
          suffix="m"
          :model-value="cityProps.maxHeight"
          :disabled="!proceduralCityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('maxHeight', value)"
        />
        <v-text-field
          label="Road Setback"
          density="compact"
          variant="underlined"
          type="number"
          min="0"
          step="0.5"
          suffix="m"
          :model-value="cityProps.roadSetback"
          :disabled="!proceduralCityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('roadSetback', value)"
        />
        <v-text-field
          label="Junction Setback"
          density="compact"
          variant="underlined"
          type="number"
          min="0"
          step="0.5"
          suffix="m"
          :model-value="cityProps.junctionSetback"
          :disabled="!proceduralCityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('junctionSetback', value)"
        />
        <v-text-field
          label="Max Buildings"
          density="compact"
          variant="underlined"
          type="number"
          min="0"
          step="100"
          :model-value="cityProps.maxBuildings"
          :disabled="!proceduralCityComponent?.enabled"
          @update:modelValue="(value) => updateNumber('maxBuildings', value)"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.procedural-city-panel__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
}

.procedural-city-panel__title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.procedural-city-panel__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem 0.75rem;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}
</style>
