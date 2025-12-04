<script setup lang="ts">
import { computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import {
  VEHICLE_COMPONENT_TYPE,
  clampVehicleComponentProps,
  type VehicleComponentProps,
  type VehicleVector3Tuple,
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
const activeWheelIndex = computed(() => {
  if (!props.wheelId) {
    return -1
  }
  return normalizedProps.value.wheels.findIndex((wheel) => wheel.id === props.wheelId)
})

const wheelLabel = computed(() => {
  if (activeWheelIndex.value < 0) {
    return '车轮'
  }
  return `车轮 #${activeWheelIndex.value + 1}`
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

function handleClose(): void {
  emit('close')
}

function handleWheelInput(
  key: keyof Pick<VehicleWheelProps,
    'radius' |
    'suspensionRestLength' |
    'suspensionStiffness' |
    'suspensionDamping' |
    'suspensionCompression' |
    'frictionSlip' |
    'rollInfluence'>,
  value: string | number,
): void {
  if (!props.wheelId || !vehicleComponent.value || !selectedNodeId.value) {
    return
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const current = clampVehicleComponentProps(vehicleComponent.value.props as VehicleComponentProps)
  const nextWheels = current.wheels.map((wheel) =>
    wheel.id === props.wheelId ? { ...wheel, [key]: numeric } : wheel,
  )
  sceneStore.updateNodeComponentProps(selectedNodeId.value, vehicleComponent.value.id, {
    wheels: nextWheels,
  })
}

function handleVectorInput(
  key: 'directionLocal' | 'axleLocal',
  axisIndex: 0 | 1 | 2,
  value: string | number,
): void {
  if (!vehicleComponent.value || !selectedNodeId.value) {
    return
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const current = clampVehicleComponentProps(vehicleComponent.value.props as VehicleComponentProps)
  const nextTuple = [...current[key]] as VehicleVector3Tuple
  if (nextTuple[axisIndex] === numeric) {
    return
  }
  nextTuple[axisIndex] = numeric
  sceneStore.updateNodeComponentProps(selectedNodeId.value, vehicleComponent.value.id, {
    [key]: nextTuple,
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
  <transition name="fade-transition">
    <div
      v-if="visible && wheelId && anchor && activeWheel"
      class="vehicle-wheel-details"
      :style="panelStyle"
    >
      <div class="vehicle-wheel-details__header">
        <div>
          <div class="vehicle-wheel-details__title">{{ wheelLabel }}</div>
          <div class="vehicle-wheel-details__subtitle">
            {{ activeWheel.nodeId ? `绑定节点：${activeWheel.nodeId}` : '尚未绑定节点' }}
          </div>
        </div>
        <v-btn icon size="small" variant="text" @click="handleClose">
          <v-icon size="18">mdi-close</v-icon>
        </v-btn>
      </div>
      <div class="vehicle-wheel-details__vectors">
        <div class="vehicle-wheel-details__subsection">
          <div class="vehicle-wheel-details__subsection-title">Direction (Local)</div>
          <div class="vehicle-wheel-details__vector-grid">
            <v-text-field
              label="X"
              density="compact"
              variant="solo"
              type="number"
              hide-details
              :step="0.05"
              :model-value="normalizedProps.directionLocal[0]"
              :disabled="isDisabled"
              @update:modelValue="(value) => handleVectorInput('directionLocal', 0, value)"
            />
            <v-text-field
              label="Y"
              density="compact"
              variant="solo"
              type="number"
              hide-details
              :step="0.05"
              :model-value="normalizedProps.directionLocal[1]"
              :disabled="isDisabled"
              @update:modelValue="(value) => handleVectorInput('directionLocal', 1, value)"
            />
            <v-text-field
              label="Z"
              density="compact"
              variant="solo"
              type="number"
              hide-details
              :step="0.05"
              :model-value="normalizedProps.directionLocal[2]"
              :disabled="isDisabled"
              @update:modelValue="(value) => handleVectorInput('directionLocal', 2, value)"
            />
          </div>
        </div>
        <div class="vehicle-wheel-details__subsection">
          <div class="vehicle-wheel-details__subsection-title">Axle (Local)</div>
          <div class="vehicle-wheel-details__vector-grid">
            <v-text-field
              label="X"
              density="compact"
              variant="solo"
              type="number"
              hide-details
              :step="0.05"
              :model-value="normalizedProps.axleLocal[0]"
              :disabled="isDisabled"
              @update:modelValue="(value) => handleVectorInput('axleLocal', 0, value)"
            />
            <v-text-field
              label="Y"
              density="compact"
              variant="solo"
              type="number"
              hide-details
              :step="0.05"
              :model-value="normalizedProps.axleLocal[1]"
              :disabled="isDisabled"
              @update:modelValue="(value) => handleVectorInput('axleLocal', 1, value)"
            />
            <v-text-field
              label="Z"
              density="compact"
              variant="solo"
              type="number"
              hide-details
              :step="0.05"
              :model-value="normalizedProps.axleLocal[2]"
              :disabled="isDisabled"
              @update:modelValue="(value) => handleVectorInput('axleLocal', 2, value)"
            />
          </div>
        </div>
      </div>
      <div class="vehicle-wheel-details__grid">
        <v-text-field
          label="半径 (m)"
          density="compact"
          variant="solo"
          type="number"
          hide-details
          :min="0"
          :step="0.05"
          :model-value="activeWheel.radius"
          :disabled="isDisabled"
          @update:modelValue="(value) => handleWheelInput('radius', value)"
        />
        <v-text-field
          label="悬挂静止长度 (m)"
          density="compact"
          variant="solo"
          type="number"
          hide-details
          :min="0"
          :step="0.01"
          :model-value="activeWheel.suspensionRestLength"
          :disabled="isDisabled"
          @update:modelValue="(value) => handleWheelInput('suspensionRestLength', value)"
        />
        <v-text-field
          label="悬挂刚度"
          density="compact"
          variant="solo"
          type="number"
          hide-details
          :min="0"
          :step="1"
          :model-value="activeWheel.suspensionStiffness"
          :disabled="isDisabled"
          @update:modelValue="(value) => handleWheelInput('suspensionStiffness', value)"
        />
        <v-text-field
          label="悬挂阻尼"
          density="compact"
          variant="solo"
          type="number"
          hide-details
          :min="0"
          :step="0.1"
          :model-value="activeWheel.suspensionDamping"
          :disabled="isDisabled"
          @update:modelValue="(value) => handleWheelInput('suspensionDamping', value)"
        />
        <v-text-field
          label="压缩系数"
          density="compact"
          variant="solo"
          type="number"
          hide-details
          :min="0"
          :step="0.1"
          :model-value="activeWheel.suspensionCompression"
          :disabled="isDisabled"
          @update:modelValue="(value) => handleWheelInput('suspensionCompression', value)"
        />
        <v-text-field
          label="摩擦系数"
          density="compact"
          variant="solo"
          type="number"
          hide-details
          :min="0"
          :step="0.1"
          :model-value="activeWheel.frictionSlip"
          :disabled="isDisabled"
          @update:modelValue="(value) => handleWheelInput('frictionSlip', value)"
        />
        <v-text-field
          label="抗侧倾"
          density="compact"
          variant="solo"
          type="number"
          hide-details
          :min="0"
          :step="0.001"
          :model-value="activeWheel.rollInfluence"
          :disabled="isDisabled"
          @update:modelValue="(value) => handleWheelInput('rollInfluence', value)"
        />
      </div>
    </div>
  </transition>
</template>

<style scoped>
.vehicle-wheel-details {
  position: fixed;
  z-index: 60;
  min-width: 320px;
  padding: 1rem;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(15, 19, 26, 0.92);
  backdrop-filter: blur(18px);
  box-shadow: 0 22px 48px rgba(0, 0, 0, 0.45);
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

.vehicle-wheel-details__subsection-title {
  font-size: 0.78rem;
  font-weight: 600;
  margin-bottom: 0.35rem;
  color: rgba(233, 236, 241, 0.82);
}

.vehicle-wheel-details__vector-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(80px, 1fr));
  gap: 0.45rem;
}

.vehicle-wheel-details__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.65rem;
}
</style>
