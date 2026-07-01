<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import NodePicker from '@/components/common/NodePicker.vue'
import {
  ANIMATION_COMPONENT_TYPE,
  CHARACTER_ANIMATION_ADVANCED_SLOTS,
  CHARACTER_ANIMATION_COMMON_SLOTS,
  CHARACTER_ANIMATION_EDITOR_SLOTS,
  CHARACTER_FORWARD_AXIS_OPTIONS,
  CHARACTER_CONTROLLER_COMPONENT_TYPE,
  clampCharacterControllerComponentProps,
  type CharacterForwardAxis,
  type AnimationComponentProps,
  type CharacterControllerComponentProps,
} from '@schema/components'
import type { SceneNodeComponentState } from '@schema/core'
import { getRuntimeObject, useSceneStore } from '@/stores/sceneStore'
import { collectAnimationClipCatalog } from '@schema/runtimeAnimationCatalog'
import { findSceneNodeById } from '@/utils/animationClipCatalog'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId, nodes } = storeToRefs(sceneStore)

const component = computed(() =>
  selectedNode.value?.components?.[CHARACTER_CONTROLLER_COMPONENT_TYPE] as
    | SceneNodeComponentState<CharacterControllerComponentProps>
    | undefined,
)

const componentEnabled = computed(() => component.value?.enabled !== false)
const normalizedProps = computed(() => clampCharacterControllerComponentProps(component.value?.props ?? null))
const animationSourceNodeId = computed(() => {
  return normalizedProps.value.targetNodeId ?? selectedNode.value?.id ?? null
})
const animationSourceNode = computed(() => {
  const sourceId = animationSourceNodeId.value
  return sourceId ? (findSceneNodeById(nodes.value, sourceId) ?? null) : selectedNode.value ?? null
})
const animationComponent = computed(() =>
  animationSourceNode.value?.components?.[ANIMATION_COMPONENT_TYPE] as
    | SceneNodeComponentState<AnimationComponentProps>
    | undefined,
)
const clipOptions = ref<Array<{ label: string; value: string }>>([])
const isLoadingClips = ref(false)
const clipLoadError = ref<string | null>(null)
const advancedMovementExpanded = ref(false)
const advancedCameraExpanded = ref(false)
const advancedBindingsExpanded = ref(false)
let clipLoadRequestId = 0
const forwardAxisItems: Array<{ label: string; value: CharacterForwardAxis }> = CHARACTER_FORWARD_AXIS_OPTIONS.map((value) => ({
  value,
  label:
    value === '+x'
      ? 'Local +X'
      : value === '-x'
        ? 'Local -X'
        : value === '+z'
          ? 'Local +Z'
          : 'Local -Z',
}))

function updateComponent(patch: Partial<CharacterControllerComponentProps>) {
  const nodeId = selectedNodeId.value
  const currentComponent = component.value
  if (!nodeId || !currentComponent) {
    return
  }
  const nextProps = clampCharacterControllerComponentProps({
    ...normalizedProps.value,
    ...patch,
  })
  sceneStore.updateNodeComponentProps(
    nodeId,
    currentComponent.id,
    nextProps as unknown as Partial<Record<string, unknown>>,
  )
}

function updateField<K extends keyof CharacterControllerComponentProps>(key: K, value: CharacterControllerComponentProps[K]) {
  updateComponent({ [key]: value } as Partial<CharacterControllerComponentProps>)
}

function updateAnimationBinding(slot: CharacterControllerComponentProps['animationBindings'][number]['slot'], clipName: string | null) {
  const bindingMap = new Map(
    normalizedProps.value.animationBindings.map((binding) => [binding.slot, { slot: binding.slot, clipName: binding.clipName }] as const),
  )
  bindingMap.set(slot, { slot, clipName })
  updateComponent({
    animationBindings: CHARACTER_ANIMATION_EDITOR_SLOTS.map(({ value }) => bindingMap.get(value) ?? { slot: value, clipName: null }),
  })
}

function updateCameraFollowDistance(value: number) {
  updateField('cameraFollowDistance', value)
}

function updateCameraFollowHeight(value: number) {
  updateField('cameraFollowHeight', value)
}

function updateSprintSpeed(value: number) {
  const sprintSpeed = Number.isFinite(value) ? Math.max(0, value) : 0
  updateComponent({
    walkSpeed: Number((sprintSpeed * 0.375).toFixed(2)),
    runSpeed: Number((sprintSpeed * 0.75).toFixed(2)),
    sprintSpeed,
  })
}

function toggleAdvancedMovement() {
  advancedMovementExpanded.value = !advancedMovementExpanded.value
}

function toggleAdvancedCamera() {
  advancedCameraExpanded.value = !advancedCameraExpanded.value
}

function handleTargetNodeIdChange(value: string | null) {
  updateField('targetNodeId', value)
}

function handleToggleComponent() {
  const currentComponent = component.value
  const nodeId = selectedNodeId.value
  if (!currentComponent || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, currentComponent.id)
}

function handleRemoveComponent() {
  const currentComponent = component.value
  const nodeId = selectedNodeId.value
  if (!currentComponent || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, currentComponent.id)
}

async function loadClipsForNode(nodeId: string) {
  const requestId = ++clipLoadRequestId
  clipOptions.value = []
  clipLoadError.value = null
  const sourceId = animationSourceNodeId.value ?? nodeId
  const sourceNode = animationSourceNode.value
  if (!animationComponent.value) {
    clipLoadError.value = sourceId && sourceId !== selectedNode.value?.id
      ? 'Add an Animation component to the Target Node before configuring character animation bindings.'
      : 'Add an Animation component before configuring character animation bindings.'
    return
  }
  isLoadingClips.value = true
  try {
    let runtimeObject = getRuntimeObject(sourceId)
    if (!runtimeObject) {
      const node = sourceNode ?? selectedNode.value
      if (node) {
        await sceneStore.ensureSceneAssetsReady({ nodes: [node], showOverlay: false, refreshViewport: false })
        runtimeObject = getRuntimeObject(sourceId)
      }
    }
    if (!runtimeObject) {
      return
    }

    const clipEntries = collectAnimationClipCatalog(runtimeObject)
    if (requestId === clipLoadRequestId) {
      clipOptions.value = clipEntries
    }
  } catch (error) {
    console.warn('[CharacterControllerPanel] Failed to load animation clips', error)
    if (requestId === clipLoadRequestId) {
      clipLoadError.value = 'Unable to load animation clips.'
    }
  } finally {
    if (requestId === clipLoadRequestId) {
      isLoadingClips.value = false
    }
  }
}

watch(
  () => [selectedNodeId.value, component.value?.id ?? null, animationComponent.value?.id ?? null, animationSourceNodeId.value] as const,
  ([nodeId, componentId]) => {
    if (!componentId || !nodeId) {
      clipOptions.value = []
      clipLoadError.value = null
      isLoadingClips.value = false
      return
    }

    void loadClipsForNode(nodeId)
  },
  { immediate: false },
)

onMounted(() => {
  const nodeId = selectedNodeId.value
  const currentComponentId = component.value?.id ?? null
  if (!nodeId || !currentComponentId) {
    return
  }

  void loadClipsForNode(nodeId)
})

const clipItems = computed(() => clipOptions.value)
const commonAnimationSlots = CHARACTER_ANIMATION_COMMON_SLOTS
const advancedAnimationSlots = CHARACTER_ANIMATION_ADVANCED_SLOTS
</script>

<template>
  <v-expansion-panel value="character-controller">
    <v-expansion-panel-title>
      <div class="character-controller-panel__header">
        <span class="character-controller-panel__title">Character Controller</span>
        <v-spacer />
        <v-menu
          v-if="component"
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
      <div class="character-controller-panel">
        <v-text-field
          :model-value="normalizedProps.label"
          label="Label"
          density="compact"
          variant="underlined"
          hide-details
          :disabled="!componentEnabled"
          @update:model-value="(value) => updateField('label', String(value ?? ''))"
        />

        <div class="character-controller-panel__field">
          <div class="character-controller-panel__field-label">Target Node</div>
          <NodePicker
            placeholder="Use this node"
            pick-hint="Select the node used as the character render/animation target"
            selection-hint="Choose the scene node whose runtime object should be treated as this character"
            :model-value="normalizedProps.targetNodeId"
            :disabled="!componentEnabled"
            @update:modelValue="handleTargetNodeIdChange"
          />
        </div>

        <v-select
          :items="forwardAxisItems"
          item-title="label"
          item-value="value"
          :model-value="normalizedProps.forwardAxis"
          label="Forward axis"
          density="compact"
          variant="underlined"
          hide-details
          :disabled="!componentEnabled"
          @update:model-value="(value) => updateField('forwardAxis', (value as CharacterForwardAxis | null) ?? '+x')"
        />

        <div class="character-controller-panel__grid">
          <v-text-field
            :model-value="normalizedProps.sprintSpeed"
            type="number"
            label="Max speed / Sprint speed"
            density="compact"
            hide-details
            variant="underlined"
            :disabled="!componentEnabled"
            @update:model-value="(value) => updateSprintSpeed(Number(value))"
          />
        </div>

        <div class="character-controller-panel__section">
          <div class="character-controller-panel__section-header">
            <div>
              <div class="character-controller-panel__section-title">Advanced movement</div>
            </div>
            <v-btn
              variant="text"
              size="x-small"
              class="character-controller-panel__binding-toggle"
              @click="toggleAdvancedMovement"
            >
              {{ advancedMovementExpanded ? 'Hide' : 'Show' }}
            </v-btn>
          </div>
          <v-expand-transition>
            <div v-show="advancedMovementExpanded" class="character-controller-panel__grid">
              <v-text-field
                :model-value="normalizedProps.turnRateDegreesPerSecond"
                type="number"
                variant="underlined"
                label="Turn rate (deg/s)"
                density="compact"
                hide-details
                :disabled="!componentEnabled"
                @update:model-value="(value) => updateField('turnRateDegreesPerSecond', Number(value))"
              />
              <v-text-field
                :model-value="normalizedProps.jumpImpulse"
                type="number"
                variant="underlined"
                label="Jump impulse"
                density="compact"
                hide-details
                :disabled="!componentEnabled"
                @update:model-value="(value) => updateField('jumpImpulse', Number(value))"
              />
              <v-text-field
                :model-value="normalizedProps.airControl"
                type="number"
                step="0.05"
                variant="underlined"
                label="Air control"
                density="compact"
                hide-details
                :disabled="!componentEnabled"
                @update:model-value="(value) => updateField('airControl', Number(value))"
              />
              <v-text-field
                :model-value="normalizedProps.stepHeight"
                type="number"
                variant="underlined"
                step="0.05"
                label="Step height"
                density="compact"
                hide-details
                :disabled="!componentEnabled"
                @update:model-value="(value) => updateField('stepHeight', Number(value))"
              />
              <v-text-field
                :model-value="normalizedProps.slopeLimitDegrees"
                type="number"
                variant="underlined"
                label="Slope limit"
                density="compact"
                hide-details
                :disabled="!componentEnabled"
                @update:model-value="(value) => updateField('slopeLimitDegrees', Number(value))"
              />
              <v-text-field
                :model-value="normalizedProps.colliderRadius"
                type="number"
                variant="underlined"
                step="0.05"
                label="Collider radius"
                density="compact"
                hide-details
                :disabled="!componentEnabled"
                @update:model-value="(value) => updateField('colliderRadius', Number(value))"
              />
              <v-text-field
                :model-value="normalizedProps.colliderHeight"
                type="number"
                step="0.05"
                variant="underlined"
                label="Collider height"
                density="compact"
                hide-details
                :disabled="!componentEnabled"
                @update:model-value="(value) => updateField('colliderHeight', Number(value))"
              />
            </div>
          </v-expand-transition>
        </div>

        <div class="character-controller-panel__section">
          <div class="character-controller-panel__section-header">
            <div>
              <div class="character-controller-panel__section-title">Camera follow</div>
            </div>
            <v-btn
              variant="text"
              size="x-small"
              class="character-controller-panel__binding-toggle"
              @click="toggleAdvancedCamera"
            >
              {{ advancedCameraExpanded ? 'Hide' : 'Show' }}
            </v-btn>
          </div>
          <v-expand-transition>
            <div v-show="advancedCameraExpanded" class="character-controller-panel__grid">
              <v-text-field
                :model-value="normalizedProps.cameraFollowDistance"
                type="number"
                step="0.1"
                variant="underlined"
                label="Follow distance"
                density="compact"
                hide-details
                :disabled="!componentEnabled"
                @update:model-value="(value) => updateCameraFollowDistance(Number(value))"
              />
              <v-text-field
                :model-value="normalizedProps.cameraFollowHeight"
                type="number"
                step="0.1"
                variant="underlined"
                label="Follow height"
                density="compact"
                hide-details
                :disabled="!componentEnabled"
                @update:model-value="(value) => updateCameraFollowHeight(Number(value))"
              />
            </div>
          </v-expand-transition>
        </div>

        <div class="character-controller-panel__animations">
          <div class="character-controller-panel__section-title">Animation bindings</div>
          <p v-if="clipLoadError" class="character-controller-panel__note">{{ clipLoadError }}</p>
          <p v-else-if="isLoadingClips" class="character-controller-panel__note">Loading animation clips…</p>
     
          <div class="character-controller-panel__binding-group">
            <div class="character-controller-panel__binding-group-title">Common</div>
            <div v-for="slot in commonAnimationSlots" :key="slot.value" class="character-controller-panel__binding-row">
              <div class="character-controller-panel__binding-label">{{ slot.label }}</div>
              <v-select
                :items="clipItems"
                item-title="label"
                item-value="value"
                :model-value="normalizedProps.animationBindings.find((binding) => binding.slot === slot.value)?.clipName ?? null"
                clearable
                density="compact"
                hide-details
                variant="underlined"
                placeholder="Select a clip"
                :disabled="!componentEnabled"
                @update:model-value="(value) => updateAnimationBinding(slot.value, value ? String(value) : null)"
              />
            </div>
          </div>

          <div class="character-controller-panel__binding-group">
            <div class="character-controller-panel__binding-group-header">
              <div class="character-controller-panel__binding-group-title">Advanced</div>
              <v-btn
                variant="text"
                size="x-small"
                class="character-controller-panel__binding-toggle"
                @click="advancedBindingsExpanded = !advancedBindingsExpanded"
              >
                {{ advancedBindingsExpanded ? 'Hide' : 'Show' }}
              </v-btn>
            </div>
            <v-expand-transition>
              <div v-show="advancedBindingsExpanded" class="character-controller-panel__binding-group-body">
                <div v-for="slot in advancedAnimationSlots" :key="slot.value" class="character-controller-panel__binding-row">
                  <div class="character-controller-panel__binding-label">{{ slot.label }}</div>
                  <v-select
                    :items="clipItems"
                    item-title="label"
                    item-value="value"
                    :model-value="normalizedProps.animationBindings.find((binding) => binding.slot === slot.value)?.clipName ?? null"
                    clearable
                    density="compact"
                    hide-details
                    variant="underlined"
                    placeholder="Select a clip"
                    :disabled="!componentEnabled"
                    @update:model-value="(value) => updateAnimationBinding(slot.value, value ? String(value) : null)"
                  />
                </div>
              </div>
            </v-expand-transition>
          </div>
        </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.character-controller-panel__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.character-controller-panel__title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.character-controller-panel {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.character-controller-panel__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.character-controller-panel__section {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.character-controller-panel__section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.character-controller-panel__field-label {
  font-size: 0.82rem;
  font-weight: 500;
}

.character-controller-panel__derived-note {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  font-size: 0.76rem;
  color: rgba(233, 236, 241, 0.68);
}

.character-controller-panel__grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}

.character-controller-panel__animations {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.character-controller-panel__binding-group {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.35rem 0;
}

.character-controller-panel__binding-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.character-controller-panel__section-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.8);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.character-controller-panel__binding-group-title {
  font-size: 0.74rem;
  font-weight: 700;
  color: rgba(233, 236, 241, 0.7);
  text-transform: uppercase;
  letter-spacing: 0.09em;
}

.character-controller-panel__binding-toggle {
  min-width: 0;
  padding-inline: 0.35rem;
}

.character-controller-panel__binding-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 0.75rem;
  align-items: center;
}

.character-controller-panel__binding-group-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.character-controller-panel__binding-label {
  font-size: 0.82rem;
  color: rgba(233, 236, 241, 0.8);
}

.character-controller-panel__note {
  margin: 0;
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.62);
}
</style>
