<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema/core'
import { getRuntimeObject, useSceneStore } from '@/stores/sceneStore'
import {
  RIGIDBODY_COMPONENT_TYPE,
  type RigidbodyComponentProps,
  type RigidbodyColliderType,
  type RigidbodyBodyType,
  type RigidbodyConvexDecompositionLevel,
  type RigidbodyConvexDecompositionCustomConfig,
  clampRigidbodyComponentProps,
  clampRigidbodyConvexDecompositionConfig,
  DEFAULT_RIGIDBODY_CONVEX_DECOMPOSITION_CONFIG,
  DEFAULT_RIGIDBODY_COLLIDER_TYPE,
  DEFAULT_RIGIDBODY_CONVEX_DECOMPOSITION_LEVEL,
  DEFAULT_RIGIDBODY_MASS,
  MIN_RIGIDBODY_MASS,
  MAX_RIGIDBODY_MASS,
  DEFAULT_LINEAR_DAMPING,
  DEFAULT_ANGULAR_DAMPING,
  DEFAULT_RIGIDBODY_RESTITUTION,
  DEFAULT_RIGIDBODY_FRICTION,
} from '@schema/components'
import NodePicker from '@/components/common/NodePicker.vue'

const emit = defineEmits<{
  (event: 'open-scene-collider-editor'): void
}>()

const BODY_TYPE_OPTIONS: Array<{ label: string; value: RigidbodyBodyType }> = [
  { label: 'Dynamic', value: 'DYNAMIC' },
  { label: 'Kinematic', value: 'KINEMATIC' },
  { label: 'Static', value: 'STATIC' },
]

const COLLIDER_TYPE_OPTIONS: Array<{ label: string; value: RigidbodyColliderType }> = [
  { label: 'Convex (Mesh)', value: 'convex' },
  { label: 'Box', value: 'box' },
  { label: 'Sphere', value: 'sphere' },
  { label: 'Capsule', value: 'capsule' },
]

const DECOMPOSITION_LEVEL_OPTIONS: Array<{ label: string; value: RigidbodyConvexDecompositionLevel }> = [
  { label: 'Default', value: 'default' },
  { label: 'Fine', value: 'fine' },
  { label: 'Coarse', value: 'coarse' },
  { label: 'Ultra', value: 'ultra' },
  { label: 'Custom', value: 'custom' },
]

const FILL_MODE_OPTIONS = [
  { label: 'Flood', value: 'flood' },
  { label: 'Surface', value: 'surface' },
  { label: 'Raycast', value: 'raycast' },
]

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const rigidbodyComponent = computed(() =>
  selectedNode.value?.components?.[RIGIDBODY_COMPONENT_TYPE] as
    | SceneNodeComponentState<RigidbodyComponentProps>
    | undefined,
)

const normalizedProps = computed(() => {
  const props = rigidbodyComponent.value?.props as Partial<RigidbodyComponentProps> | undefined
  return clampRigidbodyComponentProps(props ?? null)
})

const localMass = ref(DEFAULT_RIGIDBODY_MASS)
const localBodyType = ref<RigidbodyBodyType>('DYNAMIC')
const localColliderType = ref<RigidbodyColliderType>(DEFAULT_RIGIDBODY_COLLIDER_TYPE)
const localConvexDecompositionLevel = ref<RigidbodyConvexDecompositionLevel>(
  DEFAULT_RIGIDBODY_CONVEX_DECOMPOSITION_LEVEL,
)
const localConvexDecompositionConfig = ref<RigidbodyConvexDecompositionCustomConfig>(
  clampRigidbodyConvexDecompositionConfig(DEFAULT_RIGIDBODY_CONVEX_DECOMPOSITION_CONFIG),
)
const localLinearDamping = ref(DEFAULT_LINEAR_DAMPING)
const localAngularDamping = ref(DEFAULT_ANGULAR_DAMPING)
const localRestitution = ref(DEFAULT_RIGIDBODY_RESTITUTION)
const localFriction = ref(DEFAULT_RIGIDBODY_FRICTION)
const MASS_LOCK_EPSILON = 1e-4
const LOCKED_BODY_TYPES = new Set<RigidbodyBodyType>(['STATIC', 'KINEMATIC'])
const LOCKED_BODY_TYPE_MASS = 0
const isMassLocked = computed(() => LOCKED_BODY_TYPES.has(localBodyType.value))

const colliderTypeLabel = computed(() => {
  const opt = COLLIDER_TYPE_OPTIONS.find((o) => o.value === localColliderType.value)
  return opt ? opt.label : String(localColliderType.value ?? '')
})

const canOpenSceneColliderEditor = computed(() => {
  void sceneStore.sceneGraphStructureVersion
  void sceneStore.sceneNodePropertyVersion
  const component = rigidbodyComponent.value
  if (!component?.enabled) {
    return false
  }
  const targetId = component.props.targetNodeId?.trim() || selectedNodeId.value
  if (!targetId) {
    return false
  }
  const targetNode = sceneStore.getNodeById(targetId)
  if (!targetNode) {
    return false
  }
  return targetNode.nodeType === 'Group' || Boolean(getRuntimeObject(targetId))
})

watch(
  () => normalizedProps.value,
  (props) => {
    localBodyType.value = props.bodyType
    if (LOCKED_BODY_TYPES.has(props.bodyType)) {
      applyLockedMass(props.mass)
    } else {
      localMass.value = props.mass
    }
    localColliderType.value = props.colliderType
    localConvexDecompositionLevel.value = props.convexDecompositionLevel
    localConvexDecompositionConfig.value = clampRigidbodyConvexDecompositionConfig(
      props.convexDecompositionConfig,
    )
    localLinearDamping.value = props.linearDamping
    localAngularDamping.value = props.angularDamping
    localRestitution.value = props.restitution
    localFriction.value = props.friction
  },
  { immediate: true, deep: true },
)

function updateComponent(patch: Partial<RigidbodyComponentProps>): void {
  const component = rigidbodyComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, patch)
}

function applyLockedMass(targetMass: number) {
  if (localMass.value !== LOCKED_BODY_TYPE_MASS) {
    localMass.value = LOCKED_BODY_TYPE_MASS
  }
  if (Math.abs(targetMass - LOCKED_BODY_TYPE_MASS) > MASS_LOCK_EPSILON) {
    updateComponent({ mass: LOCKED_BODY_TYPE_MASS })
  }
}

function handleMassInput(value: string | number) {
  if (isMassLocked.value) {
    return
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clamped = clampRigidbodyComponentProps({
    mass: numeric,
    bodyType: localBodyType.value,
  }).mass
  localMass.value = clamped
  if (Math.abs(clamped - normalizedProps.value.mass) <= 1e-4) {
    return
  }
  updateComponent({ mass: clamped })
}

function handleLinearDampingInput(value: string | number) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clamped = clampRigidbodyComponentProps({
    linearDamping: numeric,
  }).linearDamping
  localLinearDamping.value = clamped
  if (Math.abs(clamped - normalizedProps.value.linearDamping) <= 1e-4) {
    return
  }
  updateComponent({ linearDamping: clamped })
}

function handleAngularDampingInput(value: string | number) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clamped = clampRigidbodyComponentProps({
    angularDamping: numeric,
  }).angularDamping
  localAngularDamping.value = clamped
  if (Math.abs(clamped - normalizedProps.value.angularDamping) <= 1e-4) {
    return
  }
  updateComponent({ angularDamping: clamped })
}

function handleRestitutionInput(value: string | number) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clamped = clampRigidbodyComponentProps({
    restitution: numeric,
  }).restitution
  localRestitution.value = clamped
  if (Math.abs(clamped - normalizedProps.value.restitution) <= 1e-4) {
    return
  }
  updateComponent({ restitution: clamped })
}

function handleFrictionInput(value: string | number) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clamped = clampRigidbodyComponentProps({
    friction: numeric,
  }).friction
  localFriction.value = clamped
  if (Math.abs(clamped - normalizedProps.value.friction) <= 1e-4) {
    return
  }
  updateComponent({ friction: clamped })
}

function handleBodyTypeChange(value: RigidbodyBodyType | null) {
  if (!value) {
    return
  }
  localBodyType.value = value
  if (LOCKED_BODY_TYPES.has(value)) {
    applyLockedMass(normalizedProps.value.mass)
  } else if (Math.abs(localMass.value - LOCKED_BODY_TYPE_MASS) <= MASS_LOCK_EPSILON) {
    localMass.value = DEFAULT_RIGIDBODY_MASS
    updateComponent({ bodyType: value, mass: DEFAULT_RIGIDBODY_MASS })
    return
  }
  if (value === normalizedProps.value.bodyType) {
    return
  }
  updateComponent({ bodyType: value })
}

function handleConvexDecompositionLevelChange(value: RigidbodyConvexDecompositionLevel | null) {
  if (!value || value === normalizedProps.value.convexDecompositionLevel) {
    return
  }
  localConvexDecompositionLevel.value = value
  updateComponent({ convexDecompositionLevel: value })
}

function updateConvexDecompositionConfig(
  patch: Partial<RigidbodyConvexDecompositionCustomConfig>,
): void {
  const next = clampRigidbodyConvexDecompositionConfig({
    ...localConvexDecompositionConfig.value,
    ...patch,
  })
  localConvexDecompositionConfig.value = next
  updateComponent({ convexDecompositionConfig: next })
}

function handleConvexDecompositionNumberInput(
  key: 'maxHulls' | 'voxelResolution' | 'maxVerticesPerHull' | 'minVolumePercentError' | 'maxRecursionDepth',
  value: string | number,
): void {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  updateConvexDecompositionConfig({ [key]: numeric })
}

function handleConvexDecompositionBooleanChange(
  key: 'shrinkWrap' | 'findBestPlane',
  value: boolean | null,
): void {
  if (value !== null) {
    updateConvexDecompositionConfig({ [key]: value })
  }
}

function handleConvexDecompositionFillModeChange(value: 'flood' | 'surface' | 'raycast' | null): void {
  if (value) {
    updateConvexDecompositionConfig({ fillMode: value })
  }
}

function resetConvexDecompositionConfig(): void {
  updateConvexDecompositionConfig(DEFAULT_RIGIDBODY_CONVEX_DECOMPOSITION_CONFIG)
}

function handleOpenSceneColliderEditor() {
  if (!canOpenSceneColliderEditor.value) {
    return
  }
  emit('open-scene-collider-editor')
}

function handleToggleComponent() {
  const component = rigidbodyComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = rigidbodyComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}

function handleTargetNodeChange(nodeId: string | null) {
  const normalized = typeof nodeId === 'string' ? nodeId.trim() : null
  const current = rigidbodyComponent.value?.props.targetNodeId ?? null
  const next = normalized && normalized.length ? normalized : null
  if (next === current) {
    return
  }
  updateComponent({ targetNodeId: next })
}

</script>

<template>
  <v-expansion-panel value="rigidbody">
    <v-expansion-panel-title>
      <div class="rigidbody-panel__header">
        <span class="rigidbody-panel__title">Rigidbody</span>
        <v-spacer />
        <v-menu
          v-if="rigidbodyComponent"
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
              <v-list-item-title>{{ rigidbodyComponent.enabled ? 'Disable' : 'Enable' }}</v-list-item-title>
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
      <div class="rigidbody-panel__body">

        <div class="rigidbody-panel__picker">
          <NodePicker
            :model-value="rigidbodyComponent?.props.targetNodeId ?? null"
            owner="rigidbody-target"
            pick-hint="Select a node whose mesh should define this rigidbody"
            selection-hint="Click any scene node to reuse its geometry when baking the collider."
            placeholder="Collision Node"
            :disabled="!rigidbodyComponent?.enabled"
            @update:model-value="handleTargetNodeChange"
          />
        </div>
        <v-select
          label="Body Type"
          density="compact"
            variant="underlined"
          :items="BODY_TYPE_OPTIONS"
          item-title="label"
          item-value="value"
          :model-value="localBodyType"
          :disabled="!rigidbodyComponent?.enabled"
          @update:modelValue="handleBodyTypeChange"
        />
        <div class="rigidbody-panel__collider-row">
          <div
            class="rigidbody-panel__collider-select rigidbody-panel__collider-text"
            :class="{ disabled: !rigidbodyComponent?.enabled }"
          >
            <div class="rigidbody-panel__picker-label">Collider Type</div>
            <div class="rigidbody-panel__collider-value">{{ colliderTypeLabel }}</div>
          </div>
          <v-tooltip text="Edit collider in scene" location="top">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon
                size="small"
                variant="tonal"
                class="rigidbody-panel__collider-btn"
                :disabled="!canOpenSceneColliderEditor"
                @click="handleOpenSceneColliderEditor"
              >
                <v-icon size="18">mdi-cube-scan</v-icon>
              </v-btn>
            </template>
          </v-tooltip>
        </div>
        <v-select
          v-if="localColliderType === 'convex'"
          label="Convex Detail"
          density="compact"
          variant="underlined"
          :items="DECOMPOSITION_LEVEL_OPTIONS"
          item-title="label"
          item-value="value"
          :model-value="localConvexDecompositionLevel"
          :disabled="!rigidbodyComponent?.enabled"
          persistent-hint
          @update:modelValue="handleConvexDecompositionLevelChange"
        />
        <v-expansion-panels
          v-if="localColliderType === 'convex' && localConvexDecompositionLevel === 'custom'"
          density="compact"
          variant="accordion"
          class="rigidbody-panel__convex-custom"
        >
          <v-expansion-panel>
            <v-expansion-panel-title>Custom Convex Settings</v-expansion-panel-title>
            <v-expansion-panel-text>
              <v-text-field
                label="Max Hulls"
                type="number"
                density="compact"
                variant="underlined"
                min="1"
                max="128"
                step="1"
                :model-value="localConvexDecompositionConfig.maxHulls"
                @update:modelValue="(value) => handleConvexDecompositionNumberInput('maxHulls', value)"
              />
              <v-text-field
                label="Voxel Resolution"
                type="number"
                density="compact"
                variant="underlined"
                min="10000"
                max="800000"
                step="10000"
                :model-value="localConvexDecompositionConfig.voxelResolution"
                @update:modelValue="(value) => handleConvexDecompositionNumberInput('voxelResolution', value)"
              />
              <v-text-field
                label="Max Vertices per Hull"
                type="number"
                density="compact"
                variant="underlined"
                min="4"
                max="64"
                step="1"
                :model-value="localConvexDecompositionConfig.maxVerticesPerHull"
                @update:modelValue="(value) => handleConvexDecompositionNumberInput('maxVerticesPerHull', value)"
              />
              <v-text-field
                label="Min Volume Error (%)"
                type="number"
                density="compact"
                variant="underlined"
                min="0.01"
                max="100"
                step="0.1"
                :model-value="localConvexDecompositionConfig.minVolumePercentError"
                @update:modelValue="(value) => handleConvexDecompositionNumberInput('minVolumePercentError', value)"
              />
              <v-text-field
                label="Max Recursion Depth"
                type="number"
                density="compact"
                variant="underlined"
                min="0"
                max="8"
                step="1"
                :model-value="localConvexDecompositionConfig.maxRecursionDepth"
                @update:modelValue="(value) => handleConvexDecompositionNumberInput('maxRecursionDepth', value)"
              />
              <v-select
                label="Fill Mode"
                density="compact"
                variant="underlined"
                :items="FILL_MODE_OPTIONS"
                item-title="label"
                item-value="value"
                :model-value="localConvexDecompositionConfig.fillMode"
                @update:modelValue="handleConvexDecompositionFillModeChange"
              />
              <v-switch
                label="Shrink Wrap"
                density="compact"
                color="primary"
                :model-value="localConvexDecompositionConfig.shrinkWrap"
                @update:modelValue="(value) => handleConvexDecompositionBooleanChange('shrinkWrap', value)"
              />
              <v-switch
                label="Find Best Plane"
                density="compact"
                color="primary"
                :model-value="localConvexDecompositionConfig.findBestPlane"
                @update:modelValue="(value) => handleConvexDecompositionBooleanChange('findBestPlane', value)"
              />
              <v-btn
                size="small"
                variant="text"
                @click="resetConvexDecompositionConfig"
              >
                Reset to Default
              </v-btn>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
        <v-text-field
          label="Mass"
          type="number"
          density="compact"
          variant="underlined"
          :min="MIN_RIGIDBODY_MASS"
          :max="MAX_RIGIDBODY_MASS"
          :step="0.1"
          :disabled="!rigidbodyComponent?.enabled || isMassLocked"
          :model-value="localMass"
          @update:modelValue="handleMassInput"
        />
        <v-text-field
          label="Linear Damping"
          type="number"
          density="compact"
          variant="underlined"
          :min="0"
          :max="1"
          :step="0.01"
          :disabled="!rigidbodyComponent?.enabled"
          :model-value="localLinearDamping"
          @update:modelValue="handleLinearDampingInput"
        />
        <v-text-field
          label="Angular Damping"
          type="number"
          density="compact"
          variant="underlined"
          :min="0"
          :max="1"
          :step="0.01"
          :disabled="!rigidbodyComponent?.enabled"
          :model-value="localAngularDamping"
          @update:modelValue="handleAngularDampingInput"
        />
        <v-text-field
          label="Restitution"
          type="number"
          density="compact"
          variant="underlined"
          :min="0"
          :max="1"
          :step="0.01"
          :disabled="!rigidbodyComponent?.enabled"
          :model-value="localRestitution"
          @update:modelValue="handleRestitutionInput"
        />
        <v-text-field
          label="Friction"
          type="number"
          density="compact"
          variant="underlined"
          :min="0"
          :max="1"
          :step="0.01"
          :disabled="!rigidbodyComponent?.enabled"
          :model-value="localFriction"
          @update:modelValue="handleFrictionInput"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.rigidbody-panel__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.rigidbody-panel__title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.rigidbody-panel__body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-inline: 0.4rem;
}

.rigidbody-panel__picker {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 0.6rem;
}

.rigidbody-panel__collider-row {
  display: flex;
  align-items: flex-end;
  gap: 0.4rem;
}

.rigidbody-panel__collider-select {
  flex: 1;
}

.rigidbody-panel__collider-btn {
  align-self: flex-end;
  margin-bottom: 0.15rem;
}

.rigidbody-panel__picker-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.82);
}

.rigidbody-panel__picker-hint {
  margin: 0;
  font-size: 0.75rem;
  color: rgba(233, 236, 241, 0.55);
}

.rigidbody-panel__collider-text {
  display: flex;
  flex-direction: column;
}

.rigidbody-panel__collider-value {
  font-size: 0.95rem;
  color: rgba(233, 236, 241, 0.9);
  padding: 0.25rem 0 0.1rem 0;
}

.rigidbody-panel__collider-text.disabled .rigidbody-panel__collider-value {
  color: rgba(233, 236, 241, 0.45);
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}
</style>
