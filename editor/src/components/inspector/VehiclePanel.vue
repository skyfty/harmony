<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import {
  VEHICLE_COMPONENT_TYPE,
  clampVehicleComponentProps,
  type VehicleComponentProps,
  type VehicleVector3Tuple,
} from '@schema/components'

const AXIS_OPTIONS: Array<{ label: string; value: 0 | 1 | 2 }> = [
  { label: 'X (0)', value: 0 },
  { label: 'Y (1)', value: 1 },
  { label: 'Z (2)', value: 2 },
]

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const vehicleComponent = computed(() =>
  selectedNode.value?.components?.[VEHICLE_COMPONENT_TYPE] as
    | SceneNodeComponentState<VehicleComponentProps>
    | undefined,
)

const normalizedProps = computed(() => {
  const props = vehicleComponent.value?.props as Partial<VehicleComponentProps> | undefined
  return clampVehicleComponentProps(props ?? null)
})

function updateComponent(patch: Partial<VehicleComponentProps>): void {
  const component = vehicleComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, patch)
}

function commitClampedPatch(patch: Partial<VehicleComponentProps>): void {
  const clamped = clampVehicleComponentProps({
    ...normalizedProps.value,
    ...patch,
  })
  const diff: Partial<VehicleComponentProps> = {}
  ;(Object.keys(patch) as (keyof VehicleComponentProps)[]).forEach((key) => {
    const nextValue = clamped[key]
    const previousValue = normalizedProps.value[key]
    const changed = Array.isArray(nextValue)
      ? !nextValue.every((entry, index) => entry === (previousValue as VehicleVector3Tuple)[index])
      : nextValue !== previousValue
    if (changed) {
      diff[key] = nextValue as VehicleComponentProps[typeof key]
    }
  })
  if (Object.keys(diff).length) {
    updateComponent(diff)
  }
}

function handleAxisChange(
  key: 'indexRightAxis' | 'indexUpAxis' | 'indexForwardAxis',
  value: number | null,
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return
  }
  commitClampedPatch({ [key]: value } as Partial<VehicleComponentProps>)
}

function handleNumberInput(
  key: Exclude<keyof VehicleComponentProps, 'directionLocal' | 'axleLocal' | 'indexRightAxis' | 'indexUpAxis' | 'indexForwardAxis'>,
  value: string | number,
): void {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  commitClampedPatch({ [key]: numeric } as Partial<VehicleComponentProps>)
}

function handleVectorInput(
  key: 'directionLocal' | 'axleLocal',
  axisIndex: 0 | 1 | 2,
  value: string | number,
): void {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const nextTuple = [...normalizedProps.value[key]] as VehicleVector3Tuple
  nextTuple[axisIndex] = numeric
  commitClampedPatch({ [key]: nextTuple } as Partial<VehicleComponentProps>)
}

function handleToggleComponent(): void {
  const component = vehicleComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent(): void {
  const component = vehicleComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}
</script>

<template>
  <v-expansion-panel value="vehicle">
    <v-expansion-panel-title>
      <div class="vehicle-panel__header">
        <span class="vehicle-panel__title">Vehicle Component</span>
        <v-spacer />
        <v-menu
          v-if="vehicleComponent"
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
              <v-list-item-title>{{ vehicleComponent?.enabled ? 'Disable' : 'Enable' }}</v-list-item-title>
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
      <div class="vehicle-panel__body">
        <div class="vehicle-panel__section">
          <div class="vehicle-panel__section-title">Raycast Axes</div>
          <div class="vehicle-panel__field-grid">
            <v-select
              label="Right Axis"
              density="compact"
              variant="underlined"
              :items="AXIS_OPTIONS"
              item-title="label"
              item-value="value"
              :model-value="normalizedProps.indexRightAxis"
              :disabled="!vehicleComponent?.enabled"
              @update:modelValue="(value) => handleAxisChange('indexRightAxis', value as number | null)"
            />
            <v-select
              label="Up Axis"
              density="compact"
              variant="underlined"
              :items="AXIS_OPTIONS"
              item-title="label"
              item-value="value"
              :model-value="normalizedProps.indexUpAxis"
              :disabled="!vehicleComponent?.enabled"
              @update:modelValue="(value) => handleAxisChange('indexUpAxis', value as number | null)"
            />
            <v-select
              label="Forward Axis"
              density="compact"
              variant="underlined"
              :items="AXIS_OPTIONS"
              item-title="label"
              item-value="value"
              :model-value="normalizedProps.indexForwardAxis"
              :disabled="!vehicleComponent?.enabled"
              @update:modelValue="(value) => handleAxisChange('indexForwardAxis', value as number | null)"
            />
          </div>
        </div>

        <div class="vehicle-panel__section">
          <div class="vehicle-panel__section-title">Wheel & Suspension</div>
          <div class="vehicle-panel__field-grid vehicle-panel__field-grid--two">
            <v-text-field
              label="Radius (m)"
              type="number"
              density="compact"
              variant="underlined"
              :step="0.05"
              :min="0"
              :model-value="normalizedProps.radius"
              :disabled="!vehicleComponent?.enabled"
              @update:modelValue="(value) => handleNumberInput('radius', value)"
            />
            <v-text-field
              label="Suspension Rest (m)"
              type="number"
              density="compact"
              variant="underlined"
              :step="0.01"
              :min="0"
              :model-value="normalizedProps.suspensionRestLength"
              :disabled="!vehicleComponent?.enabled"
              @update:modelValue="(value) => handleNumberInput('suspensionRestLength', value)"
            />
            <v-text-field
              label="Suspension Stiffness"
              type="number"
              density="compact"
              variant="underlined"
              :step="1"
              :min="0"
              :model-value="normalizedProps.suspensionStiffness"
              :disabled="!vehicleComponent?.enabled"
              @update:modelValue="(value) => handleNumberInput('suspensionStiffness', value)"
            />
            <v-text-field
              label="Suspension Damping"
              type="number"
              density="compact"
              variant="underlined"
              :step="0.1"
              :min="0"
              :model-value="normalizedProps.suspensionDamping"
              :disabled="!vehicleComponent?.enabled"
              @update:modelValue="(value) => handleNumberInput('suspensionDamping', value)"
            />
            <v-text-field
              label="Suspension Compression"
              type="number"
              density="compact"
              variant="underlined"
              :step="0.1"
              :min="0"
              :model-value="normalizedProps.suspensionCompression"
              :disabled="!vehicleComponent?.enabled"
              @update:modelValue="(value) => handleNumberInput('suspensionCompression', value)"
            />
            <v-text-field
              label="Friction Slip"
              type="number"
              density="compact"
              variant="underlined"
              :step="0.1"
              :min="0"
              :model-value="normalizedProps.frictionSlip"
              :disabled="!vehicleComponent?.enabled"
              @update:modelValue="(value) => handleNumberInput('frictionSlip', value)"
            />
            <v-text-field
              label="Roll Influence"
              type="number"
              density="compact"
              variant="underlined"
              :step="0.001"
              :min="0"
              :model-value="normalizedProps.rollInfluence"
              :disabled="!vehicleComponent?.enabled"
              @update:modelValue="(value) => handleNumberInput('rollInfluence', value)"
            />
          </div>
        </div>

        <div class="vehicle-panel__section">
          <div class="vehicle-panel__section-title">Direction (Local)</div>
          <div class="vehicle-panel__vector-grid">
            <v-text-field
              label="X"
              type="number"
              density="compact"
              variant="underlined"
              :step="0.1"
              :model-value="normalizedProps.directionLocal[0]"
              :disabled="!vehicleComponent?.enabled"
              @update:modelValue="(value) => handleVectorInput('directionLocal', 0, value)"
            />
            <v-text-field
              label="Y"
              type="number"
              density="compact"
              variant="underlined"
              :step="0.1"
              :model-value="normalizedProps.directionLocal[1]"
              :disabled="!vehicleComponent?.enabled"
              @update:modelValue="(value) => handleVectorInput('directionLocal', 1, value)"
            />
            <v-text-field
              label="Z"
              type="number"
              density="compact"
              variant="underlined"
              :step="0.1"
              :model-value="normalizedProps.directionLocal[2]"
              :disabled="!vehicleComponent?.enabled"
              @update:modelValue="(value) => handleVectorInput('directionLocal', 2, value)"
            />
          </div>
        </div>

        <div class="vehicle-panel__section">
          <div class="vehicle-panel__section-title">Axle (Local)</div>
          <div class="vehicle-panel__vector-grid">
            <v-text-field
              label="X"
              type="number"
              density="compact"
              variant="underlined"
              :step="0.1"
              :model-value="normalizedProps.axleLocal[0]"
              :disabled="!vehicleComponent?.enabled"
              @update:modelValue="(value) => handleVectorInput('axleLocal', 0, value)"
            />
            <v-text-field
              label="Y"
              type="number"
              density="compact"
              variant="underlined"
              :step="0.1"
              :model-value="normalizedProps.axleLocal[1]"
              :disabled="!vehicleComponent?.enabled"
              @update:modelValue="(value) => handleVectorInput('axleLocal', 1, value)"
            />
            <v-text-field
              label="Z"
              type="number"
              density="compact"
              variant="underlined"
              :step="0.1"
              :model-value="normalizedProps.axleLocal[2]"
              :disabled="!vehicleComponent?.enabled"
              @update:modelValue="(value) => handleVectorInput('axleLocal', 2, value)"
            />
          </div>
        </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.vehicle-panel__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.vehicle-panel__title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.vehicle-panel__body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-inline: 0.4rem;
}

.vehicle-panel__section-title {
  font-size: 0.82rem;
  font-weight: 600;
  margin-bottom: 0.35rem;
  color: rgba(235, 238, 245, 0.92);
}

.vehicle-panel__field-grid {
  display: grid;
  gap: 0.65rem;
}

.vehicle-panel__field-grid--two {
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.vehicle-panel__vector-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(90px, 1fr));
  gap: 0.5rem;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}
</style>
