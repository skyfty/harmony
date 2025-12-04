<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import NodePicker from '@/components/common/NodePicker.vue'
import { generateUuid } from '@/utils/uuid'
import {
  VEHICLE_COMPONENT_TYPE,
  clampVehicleComponentProps,
  type VehicleComponentProps,
  type VehicleWheelProps,
} from '@schema/components'

const emit = defineEmits<{
  (event: 'open-wheel-details', payload: { id: string }): void
  (event: 'close-wheel-details'): void
}>()

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

const wheelEntries = computed(() => normalizedProps.value.wheels ?? [])
const wheelDetailsActiveId = ref<string | null>(null)
const DEFAULT_VEHICLE_PROPS = clampVehicleComponentProps(null)
const BASE_WHEEL_TEMPLATE: VehicleWheelProps =
  DEFAULT_VEHICLE_PROPS.wheels[0] ?? {
    id: 'wheel-template',
    nodeId: null,
    radius: 0.5,
    suspensionRestLength: 0.3,
    suspensionStiffness: 20,
    suspensionDamping: 2,
    suspensionCompression: 4,
    frictionSlip: 5,
    rollInfluence: 0.01,
  }

const isComponentEnabled = computed(() => Boolean(vehicleComponent.value?.enabled))

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
    const changed = Array.isArray(nextValue) && Array.isArray(previousValue)
      ? !arraysEqual(nextValue as unknown[], previousValue as unknown[])
      : nextValue !== previousValue
    if (changed) {
      ;(diff as Record<string, VehicleComponentProps[keyof VehicleComponentProps]>)[key as string] =
        nextValue as VehicleComponentProps[keyof VehicleComponentProps]
    }
  })
  if (Object.keys(diff).length) {
    updateComponent(diff)
  }
}

function arraysEqual(nextValue: unknown[], previousValue: unknown[]): boolean {
  if (nextValue.length !== previousValue.length) {
    return false
  }
  const numericVector =
    nextValue.every((entry) => typeof entry === 'number') && previousValue.every((entry) => typeof entry === 'number')
  if (numericVector) {
    return nextValue.every((entry, index) => entry === previousValue[index])
  }
  return JSON.stringify(nextValue) === JSON.stringify(previousValue)
}

function updateWheelEntry(wheelId: string, patch: Partial<VehicleWheelProps>): void {
  const nextList = wheelEntries.value.map((wheel) => (wheel.id === wheelId ? { ...wheel, ...patch } : wheel))
  commitClampedPatch({ wheels: nextList })
}

function handleWheelNodeChange(wheelId: string, value: string | null): void {
  if (!isComponentEnabled.value) {
    return
  }
  const normalizedValue = typeof value === 'string' && value.trim().length ? value : null
  updateWheelEntry(wheelId, { nodeId: normalizedValue })
}

function createWheelFromTemplate(source?: VehicleWheelProps): VehicleWheelProps {
  const base = source ?? BASE_WHEEL_TEMPLATE
  return {
    id: generateUuid(),
    nodeId: null,
    radius: base.radius,
    suspensionRestLength: base.suspensionRestLength,
    suspensionStiffness: base.suspensionStiffness,
    suspensionDamping: base.suspensionDamping,
    suspensionCompression: base.suspensionCompression,
    frictionSlip: base.frictionSlip,
    rollInfluence: base.rollInfluence,
  }
}

function handleAddWheel(): void {
  if (!isComponentEnabled.value) {
    return
  }
  const template = wheelEntries.value[wheelEntries.value.length - 1]
  const nextWheel = createWheelFromTemplate(template)
  commitClampedPatch({ wheels: [...wheelEntries.value, nextWheel] })
}

function handleRemoveWheel(wheelId: string): void {
  if (!isComponentEnabled.value || wheelEntries.value.length <= 1) {
    return
  }
  const nextList = wheelEntries.value.filter((wheel) => wheel.id !== wheelId)
  commitClampedPatch({ wheels: nextList })
  if (wheelDetailsActiveId.value === wheelId) {
    requestCloseWheelDetails()
  }
}

function openWheelDetails(wheelId: string): void {
  if (!isComponentEnabled.value) {
    return
  }
  wheelDetailsActiveId.value = wheelId
  emit('open-wheel-details', { id: wheelId })
}

function requestCloseWheelDetails(): void {
  if (!wheelDetailsActiveId.value) {
    return
  }
  wheelDetailsActiveId.value = null
  emit('close-wheel-details')
}

watch(wheelEntries, (list) => {
  if (!wheelDetailsActiveId.value) {
    return
  }
  const exists = list.some((wheel) => wheel.id === wheelDetailsActiveId.value)
  if (!exists) {
    requestCloseWheelDetails()
  }
})

watch(
  () => vehicleComponent.value?.enabled,
  (enabled) => {
    if (!enabled) {
      requestCloseWheelDetails()
    }
  },
  { immediate: true },
)

watch(vehicleComponent, (component) => {
  if (!component) {
    requestCloseWheelDetails()
  }
})

function handleAxisChange(
  key: 'indexRightAxis' | 'indexUpAxis' | 'indexForwardAxis',
  value: number | null,
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return
  }
  commitClampedPatch({ [key]: value } as Partial<VehicleComponentProps>)
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
        <span class="vehicle-panel__title">Vehicle</span>
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
          <div class="vehicle-panel__section-header">
            <div>
              <div class="vehicle-panel__section-title">Wheels</div>
              <div class="vehicle-panel__section-hint">管理每个车轮的模型与参数</div>
            </div>
            <v-btn
              size="small"
              variant="tonal"
              prepend-icon="mdi-plus"
              :disabled="!isComponentEnabled"
              @click="handleAddWheel"
            >
              添加车轮
            </v-btn>
          </div>
          <div class="vehicle-wheel-list">
            <div
              v-for="(wheel, index) in wheelEntries"
              :key="wheel.id"
              class="vehicle-wheel-item"
              :class="{ 'vehicle-wheel-item--active': wheelDetailsActiveId === wheel.id }"
            >
              <div class="vehicle-wheel-item__header">
                <div>
                  <div class="vehicle-wheel-item__label">车轮 {{ index + 1 }}</div>
                  <div class="vehicle-wheel-item__hint">
                    {{ wheel.nodeId ? '已绑定节点' : '未绑定节点' }}
                  </div>
                </div>
                <div class="vehicle-wheel-item__actions">
                  <v-btn
                    icon
                    variant="text"
                    size="small"
                    class="vehicle-wheel-item__action"
                    :disabled="!isComponentEnabled"
                    @click="openWheelDetails(wheel.id)"
                  >
                    <v-icon size="18">mdi-tune</v-icon>
                  </v-btn>
                  <v-btn
                    icon
                    variant="text"
                    size="small"
                    class="vehicle-wheel-item__action"
                    :disabled="!isComponentEnabled || wheelEntries.length <= 1"
                    @click="handleRemoveWheel(wheel.id)"
                  >
                    <v-icon size="18">mdi-delete</v-icon>
                  </v-btn>
                </div>
              </div>
              <NodePicker
                class="vehicle-wheel-item__picker"
                pick-hint="点击场景中的车轮模型"
                selection-hint="在场景中选择作为车轮的节点"
                placeholder="未绑定节点"
                :model-value="wheel.nodeId ?? null"
                :disabled="!isComponentEnabled"
                @update:modelValue="(value) => handleWheelNodeChange(wheel.id, value as string | null)"
              />
            </div>
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

.vehicle-panel__section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.8rem;
}

.vehicle-panel__section-hint {
  font-size: 0.74rem;
  color: rgba(233, 236, 241, 0.52);
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

.vehicle-wheel-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.vehicle-wheel-item {
  padding: 0.6rem;
  border-radius: 10px;
  border: 1px solid rgba(233, 236, 241, 0.08);
  background: rgba(20, 24, 31, 0.65);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.vehicle-wheel-item--active {
  border-color: rgba(93, 154, 255, 0.7);
  box-shadow: 0 0 0 1px rgba(93, 154, 255, 0.3);
}

.vehicle-wheel-item__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.6rem;
}

.vehicle-wheel-item__label {
  font-weight: 600;
  letter-spacing: 0.01em;
}

.vehicle-wheel-item__hint {
  font-size: 0.72rem;
  color: rgba(233, 236, 241, 0.55);
}

.vehicle-wheel-item__actions {
  display: flex;
  align-items: center;
  gap: 0.15rem;
}

.vehicle-wheel-item__picker {
  width: 100%;
}
</style>
