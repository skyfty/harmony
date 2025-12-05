<script setup lang="ts">
import { computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState, Vector3Like } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import InspectorVectorControls from '@/components/common/VectorControls.vue'
import {
  VEHICLE_COMPONENT_TYPE,
  clampVehicleComponentProps,
  type VehicleComponentProps,
  type VehicleWheelProps,
} from '@schema/components'

const props = defineProps<{
  wheelId: string | null
  visible: boolean
  anchor: { top: number; left: number } | null
}>()

const emit = defineEmits<{
  (event: 'close'): void
}>()

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const vehicleComponent = computed(() =>
  selectedNode.value?.components?.[VEHICLE_COMPONENT_TYPE] as
    | SceneNodeComponentState<VehicleComponentProps>
    | undefined,
)

const normalizedProps = computed(() => clampVehicleComponentProps(vehicleComponent.value?.props ?? null))
const activeWheel = computed<VehicleWheelProps | null>(() => {
  if (!props.wheelId) {
    return null
  }
  return normalizedProps.value.wheels.find((wheel) => wheel.id === props.wheelId) ?? null
})
const isDisabled = computed(() => !vehicleComponent.value?.enabled)
const panelStyle = computed(() => {
  if (!props.anchor) {
    return {}
  }
  const OFFSET_Y = 70
  return {
    top: `${props.anchor.top + OFFSET_Y}px`,
    left: `${props.anchor.left}px`,
  }
})

const ZERO_VECTOR: Vector3Like = { x: 0, y: 0, z: 0 }

function clampVectorComponent(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function cloneVector(vector: Vector3Like | null | undefined): Vector3Like {
  return {
    x: clampVectorComponent(vector?.x, ZERO_VECTOR.x),
    y: clampVectorComponent(vector?.y, ZERO_VECTOR.y),
    z: clampVectorComponent(vector?.z, ZERO_VECTOR.z),
  }
}

function handleClose(): void {
  emit('close')
}

function patchActiveWheel(mutator: (wheel: VehicleWheelProps) => VehicleWheelProps): void {
  if (!props.wheelId || !vehicleComponent.value || !selectedNodeId.value) {
    return
  }
  const current = clampVehicleComponentProps(vehicleComponent.value.props as VehicleComponentProps)
  const nextWheels = current.wheels.map((wheel) =>
    wheel.id === props.wheelId ? mutator(wheel) : wheel,
  )
  sceneStore.updateNodeComponentProps(selectedNodeId.value, vehicleComponent.value.id, {
    wheels: nextWheels,
  })
}

type WheelNumericKey = keyof Pick<VehicleWheelProps,
  'radius' |
  'suspensionRestLength' |
  'suspensionStiffness' |
  'dampingRelaxation' |
  'dampingCompression' |
  'frictionSlip' |
  'maxSuspensionTravel' |
  'maxSuspensionForce' |
  'rollInfluence' |
  'customSlidingRotationalSpeed'
>

const DECIMAL_PRECISION: Partial<Record<WheelNumericKey, number>> = {
  radius: 2,
  suspensionRestLength: 2,
  dampingRelaxation: 2,
  dampingCompression: 2,
  frictionSlip: 2,
  maxSuspensionTravel: 2,
  rollInfluence: 2,
  customSlidingRotationalSpeed: 2,
}

function normalizeNumericValue(key: WheelNumericKey, numeric: number): number {
  const decimals = DECIMAL_PRECISION[key]
  if (typeof decimals !== 'number') {
    return numeric
  }
  return Number(numeric.toFixed(decimals))
}

function formatWheelValue(key: WheelNumericKey, numeric: number): number {
  return normalizeNumericValue(key, numeric)
}

function handleWheelInput(
  key: WheelNumericKey,
  value: string | number,
): void {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const normalizedValue = normalizeNumericValue(key, numeric)
  patchActiveWheel((wheel) => (wheel[key] === normalizedValue ? wheel : { ...wheel, [key]: normalizedValue }))
}

function handleWheelBooleanInput(key: 'isFrontWheel' | 'useCustomSlidingRotationalSpeed', value: boolean): void {
  if (typeof value !== 'boolean') {
    return
  }
  patchActiveWheel((wheel) => (wheel[key] === value ? wheel : { ...wheel, [key]: value }))
}

function handleVectorInput(
  key: 'directionLocal' | 'axleLocal' | 'chassisConnectionPointLocal',
  axis: 'x' | 'y' | 'z',
  value: string | number,
): void {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  patchActiveWheel((wheel) => {
    const nextVector = cloneVector(wheel[key])
    if (nextVector[axis] === numeric) {
      return wheel
    }
    nextVector[axis] = numeric
    return { ...wheel, [key]: nextVector }
  })
}

watch(activeWheel, (wheel) => {
  if (!wheel && props.visible) {
    emit('close')
  }
})

watch(
  () => vehicleComponent.value?.enabled,
  (enabled) => {
    if (!enabled && props.visible) {
      emit('close')
    }
  },
)
</script>

<template>
  <Teleport to="body">
    <transition name="fade-transition">
      <div
        v-if="visible && wheelId && anchor && activeWheel"
        class="vehicle-wheel-details"
        :style="panelStyle"
      >
        <v-toolbar density="compact" class="panel-toolbar" height="40px">
          <div class="toolbar-text">
            <div class="material-title">
              Edit Wheel
            </div>
          </div>
          <v-spacer />
          <v-btn
            class="toolbar-close"
            icon="mdi-close"
            size="small"
            variant="text"
            @click="handleClose"
          />
        </v-toolbar>

        <v-divider />

        <div class="panel-content">
          <div class="panel-content-inner">
            <div class="material-properties">
              <v-text-field
                label="Radius (m)"
                class="slider-input"
                density="compact"
                variant="underlined"
                type="number"
                hide-details
                inputmode="decimal"
                :min="0"
                :step="0.05"
                :model-value="formatWheelValue('radius', activeWheel.radius)"
                :disabled="isDisabled"
                @update:modelValue="(value) => handleWheelInput('radius', value)"
              />
              <v-text-field
                label="Suspension Rest Length (m)"
                class="slider-input"
                density="compact"
                variant="underlined"
                type="number"
                inputmode="decimal"
                hide-details
                :min="0"
                :step="0.01"
                :model-value="formatWheelValue('suspensionRestLength', activeWheel.suspensionRestLength)"
                :disabled="isDisabled"
                @update:modelValue="(value) => handleWheelInput('suspensionRestLength', value)"
              />
              <v-text-field
                label="Suspension Stiffness"
                class="slider-input"
                density="compact"
                variant="underlined"
                inputmode="decimal"
                type="number"
                hide-details
                :min="0"
                :step="1"
                :model-value="formatWheelValue('suspensionStiffness', activeWheel.suspensionStiffness)"
                :disabled="isDisabled"
                @update:modelValue="(value) => handleWheelInput('suspensionStiffness', value)"
              />
              <v-text-field
                label="Damping Relaxation"
                class="slider-input"
                density="compact"
                variant="underlined"
                inputmode="decimal"
                type="number"
                hide-details
                :min="0"
                :step="0.1"
                :model-value="formatWheelValue('dampingRelaxation', activeWheel.dampingRelaxation)"
                :disabled="isDisabled"
                @update:modelValue="(value) => handleWheelInput('dampingRelaxation', value)"
              />
              <v-text-field
                label="Damping Compression"
                class="slider-input"
                density="compact"
                variant="underlined"
                inputmode="decimal"
                type="number"
                hide-details
                :min="0"
                :step="0.1"
                :model-value="formatWheelValue('dampingCompression', activeWheel.dampingCompression)"
                :disabled="isDisabled"
                @update:modelValue="(value) => handleWheelInput('dampingCompression', value)"
              />
              <v-text-field
                label="Friction Coefficient"
                class="slider-input"
                density="compact"
                variant="underlined"
                inputmode="decimal"
                type="number"
                hide-details
                :min="0"
                :step="0.1"
                :model-value="formatWheelValue('frictionSlip', activeWheel.frictionSlip)"
                :disabled="isDisabled"
                @update:modelValue="(value) => handleWheelInput('frictionSlip', value)"
              />
              <v-text-field
                label="Max Suspension Travel (m)"
                class="slider-input"
                density="compact"
                variant="underlined"
                inputmode="decimal"
                type="number"
                hide-details
                :min="0"
                :step="0.01"
                :model-value="formatWheelValue('maxSuspensionTravel', activeWheel.maxSuspensionTravel)"
                :disabled="isDisabled"
                @update:modelValue="(value) => handleWheelInput('maxSuspensionTravel', value)"
              />
              <v-text-field
                label="Max Suspension Force"
                class="slider-input"
                density="compact"
                variant="underlined"
                type="number"
                inputmode="decimal"
                hide-details
                :min="0"
                :step="100"
                :model-value="formatWheelValue('maxSuspensionForce', activeWheel.maxSuspensionForce)"
                :disabled="isDisabled"
                @update:modelValue="(value) => handleWheelInput('maxSuspensionForce', value)"
              />
              <v-text-field
                label="Anti-Roll"
                class="slider-input"
                density="compact"
                variant="underlined"
                inputmode="decimal"
                type="number"
                hide-details
                :min="0"
                :step="0.001"
                :model-value="formatWheelValue('rollInfluence', activeWheel.rollInfluence)"
                :disabled="isDisabled"
                @update:modelValue="(value) => handleWheelInput('rollInfluence', value)"
              />
              <v-text-field
                label="Custom Sliding Rot. Speed"
                class="slider-input"
                density="compact"
                variant="underlined"
                inputmode="decimal"
                type="number"
                hide-details
                :step="0.01"
                :model-value="formatWheelValue('customSlidingRotationalSpeed', activeWheel.customSlidingRotationalSpeed)"
                :disabled="isDisabled || !activeWheel.useCustomSlidingRotationalSpeed"
                @update:modelValue="(value) => handleWheelInput('customSlidingRotationalSpeed', value)"
              />
              <v-switch
                label="Front Wheel"
                color="primary"
                hide-details
                :model-value="activeWheel.isFrontWheel"
                :disabled="isDisabled"
                @update:modelValue="(value) => handleWheelBooleanInput('isFrontWheel', Boolean(value))"
              />
              <v-switch
                label="Use Custom Sliding Speed"
                color="primary"
                hide-details
                :model-value="activeWheel.useCustomSlidingRotationalSpeed"
                :disabled="isDisabled"
                @update:modelValue="(value) => handleWheelBooleanInput('useCustomSlidingRotationalSpeed', Boolean(value))"
              />
            </div>

            <div class="vehicle-wheel-details__subsection">
              <InspectorVectorControls
                label="Direction (Local)"
                :model-value="activeWheel.directionLocal"
                :disabled="isDisabled"
                @update:axis="(axis, value) => handleVectorInput('directionLocal', axis, value)"
              />
            </div>

            <div class="vehicle-wheel-details__subsection">
              <InspectorVectorControls
                label="Axle (Local)"
                :model-value="activeWheel.axleLocal"
                :disabled="isDisabled"
                @update:axis="(axis, value) => handleVectorInput('axleLocal', axis, value)"
              />
            </div>

            <div class="vehicle-wheel-details__subsection">
              <InspectorVectorControls
                label="Connection Point (Local)"
                :model-value="activeWheel.chassisConnectionPointLocal"
                :disabled="isDisabled"
                @update:axis="(axis, value) => handleVectorInput('chassisConnectionPointLocal', axis, value)"
              />
            </div>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>


.vehicle-wheel-details-enter-active,
.vehicle-wheel-details-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.vehicle-wheel-details-enter-from,
.vehicle-wheel-details-leave-to {
  opacity: 0;
  transform: translate(-105%, 10px);
}

.vehicle-wheel-details {
  position: fixed;
  top: 0;
  left: 0;
  transform: translateX(-100%);
  
  min-width: 320px;
  max-height: calc(100% - 400px);
  display: flex;
  flex-direction: column;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background-color: rgba(18, 22, 28, 0.72);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.4);
  z-index: 24;
}

.panel-toolbar {
  background-color: transparent;
  color: #e9ecf1;
  min-height: 20px;
  padding: 0 8px;
}

.toolbar-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.panel-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  
}



.panel-content-inner {
  display: flex;
    padding: 16px;
border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.04);
    background-color: rgb(var(--v-theme-surface));
  margin: 4px;
  flex-direction: column;
  gap: 12px;
}

.vehicle-wheel-details__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.8rem;
}

.vehicle-wheel-details__title {
  font-size: 1rem;
  font-weight: 600;
}

.vehicle-wheel-details__subtitle {
  font-size: 0.78rem;
  color: rgba(233, 236, 241, 0.65);
}

.vehicle-wheel-details__vectors {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  margin-bottom: 0.9rem;
}

.vehicle-wheel-details__subsection {
  margin-top: 0.85rem;
}

.slider-input :deep(.v-field-label) {
  font-size: 0.82rem;
  font-weight: 600;
}
.material-properties {
  display: grid;
  gap: 22px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

.toolbar-close {
  color: rgba(233, 236, 241, 0.72);
}
.vehicle-wheel-details__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.65rem;
}
</style>
