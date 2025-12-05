<script setup lang="ts">
import { Box3, Vector3 } from 'three'
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNode, SceneNodeComponentState } from '@harmony/schema'
import { getRuntimeObject, useSceneStore } from '@/stores/sceneStore'
import NodePicker from '@/components/common/NodePicker.vue'
import { generateUuid } from '@/utils/uuid'
import { setBoundingBoxFromObject } from '@/components/editor/sceneUtils'
import {
  DEFAULT_RADIUS,
  DEFAULT_DIRECTION,
  DEFAULT_AXLE,
  DEFAULT_SUSPENSION_REST_LENGTH,
  DEFAULT_SUSPENSION_STIFFNESS,
  DEFAULT_DAMPING_RELAXATION,
  DEFAULT_DAMPING_COMPRESSION,
  DEFAULT_FRICTION_SLIP,
  DEFAULT_ROLL_INFLUENCE,
  DEFAULT_MAX_SUSPENSION_TRAVEL,
  DEFAULT_MAX_SUSPENSION_FORCE,
  DEFAULT_USE_CUSTOM_SLIDING_ROTATIONAL_SPEED,
  DEFAULT_CUSTOM_SLIDING_ROTATIONAL_SPEED,
  DEFAULT_IS_FRONT_WHEEL,
  VEHICLE_COMPONENT_TYPE,
  clampVehicleComponentProps,
  type VehicleComponentProps,
  type VehicleVector3Tuple,
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
const { selectedNode, selectedNodeId, nodes } = storeToRefs(sceneStore)

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
    radius: DEFAULT_RADIUS,
    suspensionRestLength: DEFAULT_SUSPENSION_REST_LENGTH,
    suspensionStiffness: DEFAULT_SUSPENSION_STIFFNESS,
    dampingRelaxation: DEFAULT_DAMPING_RELAXATION,
    dampingCompression: DEFAULT_DAMPING_COMPRESSION,
    frictionSlip: DEFAULT_FRICTION_SLIP,
    maxSuspensionTravel: DEFAULT_MAX_SUSPENSION_TRAVEL,
    maxSuspensionForce: DEFAULT_MAX_SUSPENSION_FORCE,
    useCustomSlidingRotationalSpeed: DEFAULT_USE_CUSTOM_SLIDING_ROTATIONAL_SPEED,
    customSlidingRotationalSpeed: DEFAULT_CUSTOM_SLIDING_ROTATIONAL_SPEED,
    isFrontWheel: DEFAULT_IS_FRONT_WHEEL,
    rollInfluence: DEFAULT_ROLL_INFLUENCE,
    directionLocal: DEFAULT_DIRECTION,
    axleLocal: DEFAULT_AXLE,
  }

const tempBoundingBox = new Box3()
const tempBoundingSize = new Vector3()

const isComponentEnabled = computed(() => Boolean(vehicleComponent.value?.enabled))

type NodeSearchResult = { node: SceneNode; parent: SceneNode | null }

function findNodeWithParent(tree: SceneNode[] | undefined, targetId: string, parent: SceneNode | null = null): NodeSearchResult | null {
  if (!tree) {
    return null
  }
  for (const node of tree) {
    if (node.id === targetId) {
      return { node, parent }
    }
    const childResult = findNodeWithParent(node.children, targetId, node)
    if (childResult) {
      return childResult
    }
  }
  return null
}

function ensureFiniteTuple(tuple: VehicleVector3Tuple | number[]): VehicleVector3Tuple {
  return tuple.map((value) => (Number.isFinite(value) ? value : 0)) as VehicleVector3Tuple
}


function extractNodeBoundingSize(node: SceneNode): VehicleVector3Tuple | null {
  if (!node) {
    return null
  }

  const runtime = getRuntimeObject(node.id)
  if (runtime) {
    runtime.updateMatrixWorld(true)
    const bounds = setBoundingBoxFromObject(runtime, tempBoundingBox.makeEmpty())
    if (!bounds.isEmpty()) {
      const size = bounds.getSize(tempBoundingSize)
      return ensureFiniteTuple([size.x, size.y, size.z])
    }
  }

  const instancedBounds = (node.userData as Record<string, unknown> | undefined)?.instancedBounds as
    | { min?: number[]; max?: number[] }
    | undefined
  if (
    instancedBounds &&
    Array.isArray(instancedBounds.min) &&
    instancedBounds.min.length === 3 &&
    Array.isArray(instancedBounds.max) &&
    instancedBounds.max.length === 3
  ) {
    const [minX = 0, minY = 0, minZ = 0] = instancedBounds.min
    const [maxX = 0, maxY = 0, maxZ = 0] = instancedBounds.max
    const size: VehicleVector3Tuple = [
      Math.abs(maxX - minX),
      Math.abs(maxY - minY),
      Math.abs(maxZ - minZ),
    ]
    return ensureFiniteTuple(size)
  }

  return null
}

function extractNodeRadius(boundsSize: VehicleVector3Tuple | null): number | null {
  if (!boundsSize) {
    return null
  }
  const [x = 0, y = 0, z = 0] = boundsSize
  const maxAxis = Math.max(Math.abs(x), Math.abs(y), Math.abs(z))
  if (!Number.isFinite(maxAxis) || maxAxis <= 0) {
    return null
  }
  return maxAxis * 0.5
}

function autoPopulateWheelParametersFromNode(wheelId: string, node: SceneNode): void {
  const boundsSize = extractNodeBoundingSize(node)
  const height = boundsSize ? Math.abs(boundsSize[1]) : null
  const safeHeight = typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : null
  const radiusFromNode = extractNodeRadius(boundsSize)
  const patch: Partial<VehicleWheelProps> = {
  }
  if (radiusFromNode !== null) {
    patch.radius = radiusFromNode
  } else if (safeHeight !== null) {
    patch.radius = safeHeight * 0.5
  }
  updateWheelEntry(wheelId, patch)
}

function resetWheelParameters(wheelId: string): void {
  const defaults: Partial<VehicleWheelProps> = {
    nodeId: null,
    radius: BASE_WHEEL_TEMPLATE.radius,
    suspensionRestLength: BASE_WHEEL_TEMPLATE.suspensionRestLength,
    suspensionStiffness: BASE_WHEEL_TEMPLATE.suspensionStiffness,
    dampingRelaxation: BASE_WHEEL_TEMPLATE.dampingRelaxation,
    dampingCompression: BASE_WHEEL_TEMPLATE.dampingCompression,
    frictionSlip: BASE_WHEEL_TEMPLATE.frictionSlip,
    maxSuspensionTravel: BASE_WHEEL_TEMPLATE.maxSuspensionTravel,
    maxSuspensionForce: BASE_WHEEL_TEMPLATE.maxSuspensionForce,
    useCustomSlidingRotationalSpeed: BASE_WHEEL_TEMPLATE.useCustomSlidingRotationalSpeed,
    customSlidingRotationalSpeed: BASE_WHEEL_TEMPLATE.customSlidingRotationalSpeed,
    rollInfluence: BASE_WHEEL_TEMPLATE.rollInfluence,
    directionLocal: [...BASE_WHEEL_TEMPLATE.directionLocal] as VehicleVector3Tuple,
    axleLocal: [...BASE_WHEEL_TEMPLATE.axleLocal] as VehicleVector3Tuple,
  }
  updateWheelEntry(wheelId, defaults)
}

function isWheelNodeAlreadyUsed(wheelId: string, candidateNodeId: string): boolean {
  return wheelEntries.value.some((wheel) => wheel.id !== wheelId && wheel.nodeId === candidateNodeId)
}

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
  const normalizedValue = typeof value === 'string' && value.trim().length ? value.trim() : null
  if (normalizedValue) {
    if (isWheelNodeAlreadyUsed(wheelId, normalizedValue)) {
      return
    }
    const nodeMatch = findNodeWithParent(nodes.value, normalizedValue)
    updateWheelEntry(wheelId, { nodeId: normalizedValue })
    if (nodeMatch) {
      autoPopulateWheelParametersFromNode(wheelId, nodeMatch.node)
    }
    return
  }
  resetWheelParameters(wheelId)
}

function createWheelFromTemplate(source?: VehicleWheelProps): VehicleWheelProps {
  const base = source ?? BASE_WHEEL_TEMPLATE
  return {
    id: generateUuid(),
    nodeId: null,
    radius: base.radius,
    suspensionRestLength: base.suspensionRestLength,
    suspensionStiffness: base.suspensionStiffness,
    dampingRelaxation: base.dampingRelaxation,
    dampingCompression: base.dampingCompression,
    frictionSlip: base.frictionSlip,
    maxSuspensionTravel: base.maxSuspensionTravel,
    maxSuspensionForce: base.maxSuspensionForce,
    useCustomSlidingRotationalSpeed: base.useCustomSlidingRotationalSpeed,
    customSlidingRotationalSpeed: base.customSlidingRotationalSpeed,
    isFrontWheel: base.isFrontWheel,
    rollInfluence: base.rollInfluence,
    directionLocal: [...base.directionLocal] as VehicleVector3Tuple,
    axleLocal: [...base.axleLocal] as VehicleVector3Tuple,
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
  if (!isComponentEnabled.value) {
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
            </div>
            <v-btn
              size="small"
              variant="tonal"
              prepend-icon="mdi-plus"
              :disabled="!isComponentEnabled"
              @click="handleAddWheel"
            >
              Add Wheel
            </v-btn>
          </div>
          <div class="vehicle-wheel-list">
            <div
              v-for="wheel in wheelEntries"
              :key="wheel.id"
              class="vehicle-wheel-item"
              :class="{
                'vehicle-wheel-item--active': wheelDetailsActiveId === wheel.id,
                'vehicle-wheel-item--front': wheel.isFrontWheel,
                'vehicle-wheel-item--rear': !wheel.isFrontWheel,
              }"
            >
              <div class="vehicle-wheel-item__content">
                <div class="vehicle-wheel-item__details">
        
                  <NodePicker
                    class="vehicle-wheel-item__picker"
                    pick-hint="Click a wheel model in the scene"
                    selection-hint="Select the node in the scene to use as the wheel"
                    placeholder="Wheel Node"
                    :model-value="wheel.nodeId ?? null"
                    :disabled="!isComponentEnabled"
                    @update:modelValue="(value) => handleWheelNodeChange(wheel.id, value as string | null)"
                  />
                </div>
                <div class="vehicle-wheel-item__actions">
                  <v-btn
                    icon
                    variant="text"
                  density="compact"
                    class="vehicle-wheel-item__action"
                    :disabled="!isComponentEnabled"
                    @click="openWheelDetails(wheel.id)"
                  >
                    <v-icon size="18">mdi-tune</v-icon>
                  </v-btn>
                  <v-btn
                    icon
                    variant="text"
                  density="compact"
                    class="vehicle-wheel-item__action"
                    :disabled="!isComponentEnabled"
                    @click="handleRemoveWheel(wheel.id)"
                  >
                    <v-icon size="18">mdi-delete</v-icon>
                  </v-btn>
                </div>
              </div>
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
  display: inline-flex;
  align-items: center;
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
  margin-bottom: 0.5rem;
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
  --wheel-accent-color: rgba(233, 236, 241, 0.28);
  border-radius: 10px;
  border: 1px solid var(--wheel-accent-color);
  background: rgb(0 0 0);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.vehicle-wheel-item--front {
  --wheel-accent-color: rgba(93, 154, 255, 0.75);
}

.vehicle-wheel-item--rear {
  --wheel-accent-color: rgba(78, 201, 142, 0.75);
}

.vehicle-wheel-item--active {
  border-color: var(--wheel-accent-color);
  box-shadow: 0 0 0 1px var(--wheel-accent-color);
}

.vehicle-wheel-item__content {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  flex-wrap: wrap;
}

.vehicle-wheel-item__details {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
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
  flex-direction: row;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}

.vehicle-wheel-item__picker {
  flex: 1;
  min-width: 200px;
}
</style>
