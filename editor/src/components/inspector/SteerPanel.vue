<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema'
import NodePicker from '@/components/common/NodePicker.vue'
import { useSceneStore } from '@/stores/sceneStore'
import {
  DEFAULT_STEER_TARGET_TYPE,
  STEER_COMPONENT_TYPE,
  STEER_TARGET_TYPES,
  clampSteerComponentProps,
  type SteerComponentProps,
  type SteerControllableTargetType,
} from '@schema/components'

const TARGET_TYPE_OPTIONS = STEER_TARGET_TYPES.map((value) => ({
  title: value,
  value,
}))

const sceneStore = useSceneStore()
const { selectedNode } = storeToRefs(sceneStore)

const steerComponent = computed(() => {
  const component = selectedNode.value?.components?.[STEER_COMPONENT_TYPE]
  if (!component) {
    return null
  }
  return component as SceneNodeComponentState<SteerComponentProps>
})

const normalizedProps = computed(() => clampSteerComponentProps(steerComponent.value?.props ?? null))
const isComponentEnabled = computed(() => steerComponent.value?.enabled !== false)

function updateProps(patch: Partial<SteerComponentProps>) {
  const nodeId = selectedNode.value?.id ?? null
  const componentId = steerComponent.value?.id ?? null
  if (!nodeId || !componentId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, componentId, patch as Partial<Record<string, unknown>>)
}

function handleTargetTypeChange(value: unknown) {
  const nextType = typeof value === 'string'
    ? value as SteerControllableTargetType
    : DEFAULT_STEER_TARGET_TYPE
  updateProps({ targetType: nextType })
}

function handleTargetNodeIdChange(value: string | null) {
  updateProps({ targetNodeId: value })
}

function handleDefaultIdentifierChange(value: string) {
  const trimmed = String(value ?? '').trim()
  updateProps({ defaultIdentifier: trimmed.length ? trimmed : null })
}

function handleAutoEnterChange(value: boolean | null) {
  updateProps({ autoEnterOnSceneLoad: value !== false })
}
</script>

<template>
  <v-expansion-panel value="steer">
    <v-expansion-panel-title>
      <div class="steer-panel-header">
        <span class="steer-panel-title">Steer</span>
        <v-spacer />
        <span class="steer-panel-subtitle">{{ normalizedProps.targetType }}</span>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="steer-panel-fields">
        <v-select
          label="Target Type"
          density="compact"
          variant="underlined"
          hide-details
          :items="TARGET_TYPE_OPTIONS"
          :disabled="!isComponentEnabled"
          :model-value="normalizedProps.targetType"
          @update:modelValue="handleTargetTypeChange"
        />
        <div class="steer-panel-field">
          <div class="steer-panel-field-label">Default Control Node</div>
          <NodePicker
            owner="steer-target"
            pick-hint="Select steer target node"
            selection-hint="Only controllable target nodes should be assigned here"
            placeholder="No control node selected"
            :model-value="normalizedProps.targetNodeId"
            :disabled="!isComponentEnabled"
            @update:modelValue="handleTargetNodeIdChange"
          />
        </div>
        <v-text-field
          label="Default Identifier"
          density="compact"
          variant="underlined"
          hide-details
          placeholder="vehicleIdentifier / steer key"
          :disabled="!isComponentEnabled"
          :model-value="normalizedProps.defaultIdentifier ?? ''"
          @update:modelValue="(value) => handleDefaultIdentifierChange(String(value ?? ''))"
        />
        <v-switch
          label="Auto Enter On Scene Load"
          color="primary"
          density="compact"
          hide-details
          :disabled="!isComponentEnabled"
          :model-value="normalizedProps.autoEnterOnSceneLoad"
          @update:modelValue="(value) => handleAutoEnterChange(value as boolean | null)"
        />
      </div>
      <div class="steer-panel-hint">
        First phase stores a single default controllable node. Runtime steering activation and target filtering will build on this schema.
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.steer-panel-header {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0.4rem;
}

.steer-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.steer-panel-subtitle {
  font-size: 0.78rem;
  opacity: 0.78;
  text-transform: capitalize;
}

.steer-panel-fields {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.steer-panel-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.steer-panel-field-label {
  font-size: 0.82rem;
  font-weight: 500;
}

.steer-panel-hint {
  margin-top: 0.85rem;
  font-size: 0.78rem;
  line-height: 1.4;
  opacity: 0.72;
}
</style>