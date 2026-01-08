<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import {
  PURE_PURSUIT_COMPONENT_TYPE,
  type PurePursuitComponentProps,
  clampPurePursuitComponentProps,
  DEFAULT_PURE_PURSUIT_LOOKAHEAD_BASE_METERS,
  MIN_PURE_PURSUIT_LOOKAHEAD_BASE_METERS,
  MAX_PURE_PURSUIT_LOOKAHEAD_BASE_METERS,
  DEFAULT_PURE_PURSUIT_LOOKAHEAD_SPEED_GAIN,
  MIN_PURE_PURSUIT_LOOKAHEAD_SPEED_GAIN,
  MAX_PURE_PURSUIT_LOOKAHEAD_SPEED_GAIN,
  DEFAULT_PURE_PURSUIT_LOOKAHEAD_MIN_METERS,
  MIN_PURE_PURSUIT_LOOKAHEAD_MIN_METERS,
  MAX_PURE_PURSUIT_LOOKAHEAD_MIN_METERS,
  DEFAULT_PURE_PURSUIT_LOOKAHEAD_MAX_METERS,
  MIN_PURE_PURSUIT_LOOKAHEAD_MAX_METERS,
  MAX_PURE_PURSUIT_LOOKAHEAD_MAX_METERS,
  DEFAULT_PURE_PURSUIT_WHEELBASE_METERS,
  MIN_PURE_PURSUIT_WHEELBASE_METERS,
  MAX_PURE_PURSUIT_WHEELBASE_METERS,
  DEFAULT_PURE_PURSUIT_MAX_STEER_DEGREES,
  MIN_PURE_PURSUIT_MAX_STEER_DEGREES,
  MAX_PURE_PURSUIT_MAX_STEER_DEGREES,
  DEFAULT_PURE_PURSUIT_MAX_STEER_RATE_DEG_PER_SEC,
  MIN_PURE_PURSUIT_MAX_STEER_RATE_DEG_PER_SEC,
  MAX_PURE_PURSUIT_MAX_STEER_RATE_DEG_PER_SEC,
  DEFAULT_PURE_PURSUIT_ENGINE_FORCE_MAX,
  MIN_PURE_PURSUIT_ENGINE_FORCE_MAX,
  MAX_PURE_PURSUIT_ENGINE_FORCE_MAX,
  DEFAULT_PURE_PURSUIT_BRAKE_FORCE_MAX,
  MIN_PURE_PURSUIT_BRAKE_FORCE_MAX,
  MAX_PURE_PURSUIT_BRAKE_FORCE_MAX,
  DEFAULT_PURE_PURSUIT_SPEED_KP,
  MIN_PURE_PURSUIT_SPEED_KP,
  MAX_PURE_PURSUIT_SPEED_KP,
  DEFAULT_PURE_PURSUIT_SPEED_KI,
  MIN_PURE_PURSUIT_SPEED_KI,
  MAX_PURE_PURSUIT_SPEED_KI,
  DEFAULT_PURE_PURSUIT_SPEED_INTEGRAL_MAX,
  MIN_PURE_PURSUIT_SPEED_INTEGRAL_MAX,
  MAX_PURE_PURSUIT_SPEED_INTEGRAL_MAX,
  DEFAULT_PURE_PURSUIT_MIN_SPEED_MPS,
  MIN_PURE_PURSUIT_MIN_SPEED_MPS,
  MAX_PURE_PURSUIT_MIN_SPEED_MPS,
  DEFAULT_PURE_PURSUIT_CURVATURE_SPEED_FACTOR,
  MIN_PURE_PURSUIT_CURVATURE_SPEED_FACTOR,
  MAX_PURE_PURSUIT_CURVATURE_SPEED_FACTOR,
  DEFAULT_PURE_PURSUIT_ARRIVAL_DISTANCE_MIN_METERS,
  MIN_PURE_PURSUIT_ARRIVAL_DISTANCE_MIN_METERS,
  MAX_PURE_PURSUIT_ARRIVAL_DISTANCE_MIN_METERS,
  DEFAULT_PURE_PURSUIT_ARRIVAL_DISTANCE_MAX_METERS,
  MIN_PURE_PURSUIT_ARRIVAL_DISTANCE_MAX_METERS,
  MAX_PURE_PURSUIT_ARRIVAL_DISTANCE_MAX_METERS,
  DEFAULT_PURE_PURSUIT_ARRIVAL_DISTANCE_SPEED_FACTOR,
  MIN_PURE_PURSUIT_ARRIVAL_DISTANCE_SPEED_FACTOR,
  MAX_PURE_PURSUIT_ARRIVAL_DISTANCE_SPEED_FACTOR,
  DEFAULT_PURE_PURSUIT_BRAKE_DISTANCE_MIN_METERS,
  MIN_PURE_PURSUIT_BRAKE_DISTANCE_MIN_METERS,
  MAX_PURE_PURSUIT_BRAKE_DISTANCE_MIN_METERS,
  DEFAULT_PURE_PURSUIT_BRAKE_DISTANCE_SPEED_FACTOR,
  MIN_PURE_PURSUIT_BRAKE_DISTANCE_SPEED_FACTOR,
  MAX_PURE_PURSUIT_BRAKE_DISTANCE_SPEED_FACTOR,
  DEFAULT_PURE_PURSUIT_DOCKING_ENABLED,
  DEFAULT_PURE_PURSUIT_DOCK_START_DISTANCE_METERS,
  MIN_PURE_PURSUIT_DOCK_START_DISTANCE_METERS,
  MAX_PURE_PURSUIT_DOCK_START_DISTANCE_METERS,
  DEFAULT_PURE_PURSUIT_DOCK_MAX_SPEED_MPS,
  MIN_PURE_PURSUIT_DOCK_MAX_SPEED_MPS,
  MAX_PURE_PURSUIT_DOCK_MAX_SPEED_MPS,
  DEFAULT_PURE_PURSUIT_DOCK_VELOCITY_KP,
  MIN_PURE_PURSUIT_DOCK_VELOCITY_KP,
  MAX_PURE_PURSUIT_DOCK_VELOCITY_KP,
  DEFAULT_PURE_PURSUIT_DOCK_YAW_ENABLED,
  DEFAULT_PURE_PURSUIT_DOCK_YAW_SLERP_RATE,
  MIN_PURE_PURSUIT_DOCK_YAW_SLERP_RATE,
  MAX_PURE_PURSUIT_DOCK_YAW_SLERP_RATE,
  DEFAULT_PURE_PURSUIT_DOCK_STOP_EPSILON_METERS,
  MIN_PURE_PURSUIT_DOCK_STOP_EPSILON_METERS,
  MAX_PURE_PURSUIT_DOCK_STOP_EPSILON_METERS,
  DEFAULT_PURE_PURSUIT_DOCK_STOP_SPEED_EPSILON_MPS,
  MIN_PURE_PURSUIT_DOCK_STOP_SPEED_EPSILON_MPS,
  MAX_PURE_PURSUIT_DOCK_STOP_SPEED_EPSILON_MPS,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const purePursuitComponent = computed(() =>
  selectedNode.value?.components?.[PURE_PURSUIT_COMPONENT_TYPE] as
    | SceneNodeComponentState<PurePursuitComponentProps>
    | undefined,
)

const componentEnabled = computed(() => purePursuitComponent.value?.enabled !== false)

const normalizedProps = computed(() => {
  const props = purePursuitComponent.value?.props as Partial<PurePursuitComponentProps> | undefined
  return clampPurePursuitComponentProps(props ?? null)
})

const localLookaheadBaseMeters = ref(DEFAULT_PURE_PURSUIT_LOOKAHEAD_BASE_METERS)
const localLookaheadSpeedGain = ref(DEFAULT_PURE_PURSUIT_LOOKAHEAD_SPEED_GAIN)
const localLookaheadMinMeters = ref(DEFAULT_PURE_PURSUIT_LOOKAHEAD_MIN_METERS)
const localLookaheadMaxMeters = ref(DEFAULT_PURE_PURSUIT_LOOKAHEAD_MAX_METERS)
const localWheelbaseMeters = ref(DEFAULT_PURE_PURSUIT_WHEELBASE_METERS)
const localMaxSteerDegrees = ref(DEFAULT_PURE_PURSUIT_MAX_STEER_DEGREES)
const localMaxSteerRateDegPerSec = ref(DEFAULT_PURE_PURSUIT_MAX_STEER_RATE_DEG_PER_SEC)

const localEngineForceMax = ref(DEFAULT_PURE_PURSUIT_ENGINE_FORCE_MAX)
const localBrakeForceMax = ref(DEFAULT_PURE_PURSUIT_BRAKE_FORCE_MAX)
const localSpeedKp = ref(DEFAULT_PURE_PURSUIT_SPEED_KP)
const localSpeedKi = ref(DEFAULT_PURE_PURSUIT_SPEED_KI)
const localSpeedIntegralMax = ref(DEFAULT_PURE_PURSUIT_SPEED_INTEGRAL_MAX)
const localMinSpeedMps = ref(DEFAULT_PURE_PURSUIT_MIN_SPEED_MPS)
const localCurvatureSpeedFactor = ref(DEFAULT_PURE_PURSUIT_CURVATURE_SPEED_FACTOR)

const localArrivalDistanceMinMeters = ref(DEFAULT_PURE_PURSUIT_ARRIVAL_DISTANCE_MIN_METERS)
const localArrivalDistanceMaxMeters = ref(DEFAULT_PURE_PURSUIT_ARRIVAL_DISTANCE_MAX_METERS)
const localArrivalDistanceSpeedFactor = ref(DEFAULT_PURE_PURSUIT_ARRIVAL_DISTANCE_SPEED_FACTOR)
const localBrakeDistanceMinMeters = ref(DEFAULT_PURE_PURSUIT_BRAKE_DISTANCE_MIN_METERS)
const localBrakeDistanceSpeedFactor = ref(DEFAULT_PURE_PURSUIT_BRAKE_DISTANCE_SPEED_FACTOR)

const localDockingEnabled = ref(DEFAULT_PURE_PURSUIT_DOCKING_ENABLED)
const localDockStartDistanceMeters = ref(DEFAULT_PURE_PURSUIT_DOCK_START_DISTANCE_METERS)
const localDockMaxSpeedMps = ref(DEFAULT_PURE_PURSUIT_DOCK_MAX_SPEED_MPS)
const localDockVelocityKp = ref(DEFAULT_PURE_PURSUIT_DOCK_VELOCITY_KP)
const localDockYawEnabled = ref(DEFAULT_PURE_PURSUIT_DOCK_YAW_ENABLED)
const localDockYawSlerpRate = ref(DEFAULT_PURE_PURSUIT_DOCK_YAW_SLERP_RATE)
const localDockStopEpsilonMeters = ref(DEFAULT_PURE_PURSUIT_DOCK_STOP_EPSILON_METERS)
const localDockStopSpeedEpsilonMps = ref(DEFAULT_PURE_PURSUIT_DOCK_STOP_SPEED_EPSILON_MPS)

watch(
  () => normalizedProps.value,
  (props) => {
    localLookaheadBaseMeters.value = props.lookaheadBaseMeters
    localLookaheadSpeedGain.value = props.lookaheadSpeedGain
    localLookaheadMinMeters.value = props.lookaheadMinMeters
    localLookaheadMaxMeters.value = props.lookaheadMaxMeters
    localWheelbaseMeters.value = props.wheelbaseMeters
    localMaxSteerDegrees.value = props.maxSteerDegrees
    localMaxSteerRateDegPerSec.value = props.maxSteerRateDegPerSec

    localEngineForceMax.value = props.engineForceMax
    localBrakeForceMax.value = props.brakeForceMax
    localSpeedKp.value = props.speedKp
    localSpeedKi.value = props.speedKi
    localSpeedIntegralMax.value = props.speedIntegralMax
    localMinSpeedMps.value = props.minSpeedMps
    localCurvatureSpeedFactor.value = props.curvatureSpeedFactor

    localArrivalDistanceMinMeters.value = props.arrivalDistanceMinMeters
    localArrivalDistanceMaxMeters.value = props.arrivalDistanceMaxMeters
    localArrivalDistanceSpeedFactor.value = props.arrivalDistanceSpeedFactor
    localBrakeDistanceMinMeters.value = props.brakeDistanceMinMeters
    localBrakeDistanceSpeedFactor.value = props.brakeDistanceSpeedFactor

    localDockingEnabled.value = props.dockingEnabled
    localDockStartDistanceMeters.value = props.dockStartDistanceMeters
    localDockMaxSpeedMps.value = props.dockMaxSpeedMps
    localDockVelocityKp.value = props.dockVelocityKp
    localDockYawEnabled.value = props.dockYawEnabled
    localDockYawSlerpRate.value = props.dockYawSlerpRate
    localDockStopEpsilonMeters.value = props.dockStopEpsilonMeters
    localDockStopSpeedEpsilonMps.value = props.dockStopSpeedEpsilonMps
  },
  { immediate: true, deep: true },
)

function updateComponent(patch: Partial<PurePursuitComponentProps>): void {
  const component = purePursuitComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, patch)
}

type PurePursuitNumericKey = {
  [K in keyof PurePursuitComponentProps]-?: PurePursuitComponentProps[K] extends number ? K : never
}[keyof PurePursuitComponentProps]

const numberLocals: Partial<Record<PurePursuitNumericKey, typeof localWheelbaseMeters>> = {
  lookaheadBaseMeters: localLookaheadBaseMeters,
  lookaheadSpeedGain: localLookaheadSpeedGain,
  lookaheadMinMeters: localLookaheadMinMeters,
  lookaheadMaxMeters: localLookaheadMaxMeters,
  wheelbaseMeters: localWheelbaseMeters,
  maxSteerDegrees: localMaxSteerDegrees,
  maxSteerRateDegPerSec: localMaxSteerRateDegPerSec,

  engineForceMax: localEngineForceMax,
  brakeForceMax: localBrakeForceMax,
  speedKp: localSpeedKp,
  speedKi: localSpeedKi,
  speedIntegralMax: localSpeedIntegralMax,
  minSpeedMps: localMinSpeedMps,
  curvatureSpeedFactor: localCurvatureSpeedFactor,

  arrivalDistanceMinMeters: localArrivalDistanceMinMeters,
  arrivalDistanceMaxMeters: localArrivalDistanceMaxMeters,
  arrivalDistanceSpeedFactor: localArrivalDistanceSpeedFactor,
  brakeDistanceMinMeters: localBrakeDistanceMinMeters,
  brakeDistanceSpeedFactor: localBrakeDistanceSpeedFactor,

  dockStartDistanceMeters: localDockStartDistanceMeters,
  dockMaxSpeedMps: localDockMaxSpeedMps,
  dockVelocityKp: localDockVelocityKp,
  dockYawSlerpRate: localDockYawSlerpRate,
  dockStopEpsilonMeters: localDockStopEpsilonMeters,
  dockStopSpeedEpsilonMps: localDockStopSpeedEpsilonMps,
}

function handleNumberField(key: PurePursuitNumericKey, value: string | number): void {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }

  const clamped = clampPurePursuitComponentProps({ [key]: numeric } as Partial<PurePursuitComponentProps>)[key]
  const localRef = numberLocals[key]
  if (localRef) {
    localRef.value = clamped
  }
  if (Math.abs(clamped - normalizedProps.value[key]) <= 1e-4) {
    return
  }
  updateComponent({ [key]: clamped } as Partial<PurePursuitComponentProps>)
}

function handleDockingEnabledChange(value: boolean | null) {
  if (value === null) {
    return
  }
  localDockingEnabled.value = value
  if (value === normalizedProps.value.dockingEnabled) {
    return
  }
  updateComponent({ dockingEnabled: value })
}

function handleDockYawEnabledChange(value: boolean | null) {
  if (value === null) {
    return
  }
  localDockYawEnabled.value = value
  if (value === normalizedProps.value.dockYawEnabled) {
    return
  }
  updateComponent({ dockYawEnabled: value })
}

function handleToggleComponent() {
  const component = purePursuitComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = purePursuitComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}
</script>

<template>
  <v-expansion-panel value="purePursuit">
    <v-expansion-panel-title>
      <div class="pure-pursuit-panel-header">
        <span class="pure-pursuit-panel-title">Pure Pursuit</span>
        <v-spacer />
        <v-menu
          v-if="purePursuitComponent"
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
              <v-list-item-title>{{ componentEnabled ? 'Disable' : 'Enable' }}</v-list-item-title>
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
      <div class="pure-pursuit-panel-body" :class="{ 'is-disabled': !componentEnabled }">
        <v-text-field
          label="Lookahead Base (m)"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_LOOKAHEAD_BASE_METERS"
          :max="MAX_PURE_PURSUIT_LOOKAHEAD_BASE_METERS"
          :model-value="localLookaheadBaseMeters"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('lookaheadBaseMeters', v)"
        />

        <v-text-field
          label="Lookahead Speed Gain"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_LOOKAHEAD_SPEED_GAIN"
          :max="MAX_PURE_PURSUIT_LOOKAHEAD_SPEED_GAIN"
          :model-value="localLookaheadSpeedGain"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('lookaheadSpeedGain', v)"
        />

        <v-text-field
          label="Lookahead Min (m)"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_LOOKAHEAD_MIN_METERS"
          :max="MAX_PURE_PURSUIT_LOOKAHEAD_MIN_METERS"
          :model-value="localLookaheadMinMeters"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('lookaheadMinMeters', v)"
        />

        <v-text-field
          label="Lookahead Max (m)"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_LOOKAHEAD_MAX_METERS"
          :max="MAX_PURE_PURSUIT_LOOKAHEAD_MAX_METERS"
          :model-value="localLookaheadMaxMeters"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('lookaheadMaxMeters', v)"
        />

        <v-text-field
          label="Wheelbase (m)"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_WHEELBASE_METERS"
          :max="MAX_PURE_PURSUIT_WHEELBASE_METERS"
          :model-value="localWheelbaseMeters"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('wheelbaseMeters', v)"
        />

        <v-text-field
          label="Max Steer (deg)"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_MAX_STEER_DEGREES"
          :max="MAX_PURE_PURSUIT_MAX_STEER_DEGREES"
          :model-value="localMaxSteerDegrees"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('maxSteerDegrees', v)"
        />

        <v-text-field
          label="Max Steer Rate (deg/s)"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_MAX_STEER_RATE_DEG_PER_SEC"
          :max="MAX_PURE_PURSUIT_MAX_STEER_RATE_DEG_PER_SEC"
          :model-value="localMaxSteerRateDegPerSec"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('maxSteerRateDegPerSec', v)"
        />

        <v-divider />

        <v-text-field
          label="Engine Force Max"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_ENGINE_FORCE_MAX"
          :max="MAX_PURE_PURSUIT_ENGINE_FORCE_MAX"
          :model-value="localEngineForceMax"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('engineForceMax', v)"
        />

        <v-text-field
          label="Brake Force Max"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_BRAKE_FORCE_MAX"
          :max="MAX_PURE_PURSUIT_BRAKE_FORCE_MAX"
          :model-value="localBrakeForceMax"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('brakeForceMax', v)"
        />

        <v-text-field
          label="Speed Kp"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_SPEED_KP"
          :max="MAX_PURE_PURSUIT_SPEED_KP"
          :model-value="localSpeedKp"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('speedKp', v)"
        />

        <v-text-field
          label="Speed Ki"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_SPEED_KI"
          :max="MAX_PURE_PURSUIT_SPEED_KI"
          :model-value="localSpeedKi"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('speedKi', v)"
        />

        <v-text-field
          label="Speed Integral Max"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_SPEED_INTEGRAL_MAX"
          :max="MAX_PURE_PURSUIT_SPEED_INTEGRAL_MAX"
          :model-value="localSpeedIntegralMax"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('speedIntegralMax', v)"
        />

        <v-text-field
          label="Min Speed (m/s)"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_MIN_SPEED_MPS"
          :max="MAX_PURE_PURSUIT_MIN_SPEED_MPS"
          :model-value="localMinSpeedMps"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('minSpeedMps', v)"
        />

        <v-text-field
          label="Curvature Speed Factor"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_CURVATURE_SPEED_FACTOR"
          :max="MAX_PURE_PURSUIT_CURVATURE_SPEED_FACTOR"
          :model-value="localCurvatureSpeedFactor"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('curvatureSpeedFactor', v)"
        />

        <v-divider />

        <v-text-field
          label="Arrival Distance Min (m)"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_ARRIVAL_DISTANCE_MIN_METERS"
          :max="MAX_PURE_PURSUIT_ARRIVAL_DISTANCE_MIN_METERS"
          :model-value="localArrivalDistanceMinMeters"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('arrivalDistanceMinMeters', v)"
        />

        <v-text-field
          label="Arrival Distance Max (m)"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_ARRIVAL_DISTANCE_MAX_METERS"
          :max="MAX_PURE_PURSUIT_ARRIVAL_DISTANCE_MAX_METERS"
          :model-value="localArrivalDistanceMaxMeters"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('arrivalDistanceMaxMeters', v)"
        />

        <v-text-field
          label="Arrival Distance Speed Factor"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_ARRIVAL_DISTANCE_SPEED_FACTOR"
          :max="MAX_PURE_PURSUIT_ARRIVAL_DISTANCE_SPEED_FACTOR"
          :model-value="localArrivalDistanceSpeedFactor"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('arrivalDistanceSpeedFactor', v)"
        />

        <v-text-field
          label="Brake Distance Min (m)"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_BRAKE_DISTANCE_MIN_METERS"
          :max="MAX_PURE_PURSUIT_BRAKE_DISTANCE_MIN_METERS"
          :model-value="localBrakeDistanceMinMeters"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('brakeDistanceMinMeters', v)"
        />

        <v-text-field
          label="Brake Distance Speed Factor"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_BRAKE_DISTANCE_SPEED_FACTOR"
          :max="MAX_PURE_PURSUIT_BRAKE_DISTANCE_SPEED_FACTOR"
          :model-value="localBrakeDistanceSpeedFactor"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('brakeDistanceSpeedFactor', v)"
        />

        <v-divider />

        <v-switch
          label="Docking Enabled"
          density="compact"
          hide-details
          :model-value="localDockingEnabled"
          :disabled="!componentEnabled"
          @update:model-value="handleDockingEnabledChange"
        />

        <v-text-field
          label="Dock Start Distance (m)"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_DOCK_START_DISTANCE_METERS"
          :max="MAX_PURE_PURSUIT_DOCK_START_DISTANCE_METERS"
          :model-value="localDockStartDistanceMeters"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('dockStartDistanceMeters', v)"
        />

        <v-text-field
          label="Dock Max Speed (m/s)"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_DOCK_MAX_SPEED_MPS"
          :max="MAX_PURE_PURSUIT_DOCK_MAX_SPEED_MPS"
          :model-value="localDockMaxSpeedMps"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('dockMaxSpeedMps', v)"
        />

        <v-text-field
          label="Dock Velocity Kp"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_DOCK_VELOCITY_KP"
          :max="MAX_PURE_PURSUIT_DOCK_VELOCITY_KP"
          :model-value="localDockVelocityKp"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('dockVelocityKp', v)"
        />

        <v-switch
          label="Dock Yaw Enabled"
          density="compact"
          hide-details
          :model-value="localDockYawEnabled"
          :disabled="!componentEnabled"
          @update:model-value="handleDockYawEnabledChange"
        />

        <v-text-field
          label="Dock Yaw Slerp Rate"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_DOCK_YAW_SLERP_RATE"
          :max="MAX_PURE_PURSUIT_DOCK_YAW_SLERP_RATE"
          :model-value="localDockYawSlerpRate"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('dockYawSlerpRate', v)"
        />

        <v-text-field
          label="Dock Stop Epsilon (m)"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_DOCK_STOP_EPSILON_METERS"
          :max="MAX_PURE_PURSUIT_DOCK_STOP_EPSILON_METERS"
          :model-value="localDockStopEpsilonMeters"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('dockStopEpsilonMeters', v)"
        />

        <v-text-field
          label="Dock Stop Speed Epsilon (m/s)"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_PURE_PURSUIT_DOCK_STOP_SPEED_EPSILON_MPS"
          :max="MAX_PURE_PURSUIT_DOCK_STOP_SPEED_EPSILON_MPS"
          :model-value="localDockStopSpeedEpsilonMps"
          :disabled="!componentEnabled"
          @update:modelValue="(v) => handleNumberField('dockStopSpeedEpsilonMps', v)"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.pure-pursuit-panel-header {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0.4rem;
}

.pure-pursuit-panel-title {
  font-weight: 600;
}

.pure-pursuit-panel-body {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.pure-pursuit-panel-body.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}
</style>
