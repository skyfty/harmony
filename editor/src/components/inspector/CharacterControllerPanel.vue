<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import * as THREE from 'three'
import {
  CHARACTER_CONTROLLER_COMPONENT_TYPE,
  clampCharacterControllerComponentProps,
  type CharacterAnimationSlot,
  type CharacterControllerComponentProps,
} from '@schema/components'
import type { SceneNodeComponentState } from '@schema'
import { getRuntimeObject, useSceneStore } from '@/stores/sceneStore'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const component = computed(() =>
  selectedNode.value?.components?.[CHARACTER_CONTROLLER_COMPONENT_TYPE] as
    | SceneNodeComponentState<CharacterControllerComponentProps>
    | undefined,
)

const normalizedProps = computed(() => clampCharacterControllerComponentProps(component.value?.props ?? null))
const clipOptions = ref<Array<{ label: string; value: string }>>([])
const isLoadingClips = ref(false)
const clipLoadError = ref<string | null>(null)
let clipLoadRequestId = 0

const animationSlots: Array<{ label: string; value: CharacterAnimationSlot }> = [
  { label: 'Idle', value: 'idle' },
  { label: 'Walk', value: 'walk' },
  { label: 'Run', value: 'run' },
  { label: 'Sprint', value: 'sprint' },
  { label: 'Turn Left', value: 'turnLeft' },
  { label: 'Turn Right', value: 'turnRight' },
  { label: 'Jump Start', value: 'jumpStart' },
  { label: 'Jump Loop', value: 'jumpLoop' },
  { label: 'Jump Land', value: 'jumpLand' },
  { label: 'Fall', value: 'fall' },
  { label: 'Strafe Left', value: 'strafeLeft' },
  { label: 'Strafe Right', value: 'strafeRight' },
  { label: 'Crouch Idle', value: 'crouchIdle' },
  { label: 'Crouch Walk', value: 'crouchWalk' },
  { label: 'Interact', value: 'interact' },
  { label: 'Death', value: 'death' },
]

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

function updateAnimationBinding(slot: CharacterAnimationSlot, clipName: string | null) {
  const nextBindings = normalizedProps.value.animationBindings.map((binding) =>
    binding.slot === slot ? { slot, clipName } : binding,
  )
  updateComponent({ animationBindings: nextBindings })
}

async function loadClipsForNode(nodeId: string | null) {
  const requestId = ++clipLoadRequestId
  clipOptions.value = []
  clipLoadError.value = null
  if (!nodeId) {
    return
  }
  isLoadingClips.value = true
  try {
    const runtimeObject = getRuntimeObject(nodeId)
    if (!runtimeObject) {
      const node = selectedNode.value
      if (node) {
        await sceneStore.ensureSceneAssetsReady({ nodes: [node], showOverlay: false, refreshViewport: false })
      }
    }
    const refreshedRuntimeObject = getRuntimeObject(nodeId)
    const clipEntries: Array<{ label: string; value: string }> =
      []
    const animations = (refreshedRuntimeObject as unknown as { animations?: THREE.AnimationClip[] })?.animations
    if (Array.isArray(animations) && animations.length) {
      animations.forEach((clip, index) => {
        if (!clip) {
          return
        }
        const trimmed = typeof clip.name === 'string' ? clip.name.trim() : ''
        clipEntries.push({
          label: trimmed.length ? trimmed : `Clip ${index + 1}`,
          value: trimmed,
        })
      })
    }
    const userDataNames = Array.isArray((refreshedRuntimeObject as any)?.userData?.__animations)
      ? ((refreshedRuntimeObject as any).userData.__animations as string[])
      : []
    userDataNames.forEach((name: string) => {
      const trimmed = typeof name === 'string' ? name.trim() : ''
      if (!trimmed.length || clipEntries.some((entry) => entry.value === trimmed)) {
        return
      }
      clipEntries.push({ label: trimmed, value: trimmed })
    })
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
  () => selectedNodeId.value,
  (nodeId) => {
    void loadClipsForNode(nodeId)
  },
  { immediate: true },
)

const clipItems = computed(() => clipOptions.value)
</script>

<template>
  <v-expansion-panel value="character-controller">
    <v-expansion-panel-title>Character Controller</v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="character-controller-panel">
        <v-switch
          :model-value="normalizedProps.enabledByDefault"
          label="Enabled by default"
          density="compact"
          hide-details
          @update:model-value="(value) => updateField('enabledByDefault', Boolean(value))"
        />
        <v-text-field
          :model-value="normalizedProps.label"
          label="Label"
          density="compact"
          hide-details
          @update:model-value="(value) => updateField('label', String(value ?? ''))"
        />

        <div class="character-controller-panel__grid">
          <v-text-field
            :model-value="normalizedProps.walkSpeed"
            type="number"
            label="Walk speed"
            density="compact"
            hide-details
            @update:model-value="(value) => updateField('walkSpeed', Number(value))"
          />
          <v-text-field
            :model-value="normalizedProps.runSpeed"
            type="number"
            label="Run speed"
            density="compact"
            hide-details
            @update:model-value="(value) => updateField('runSpeed', Number(value))"
          />
          <v-text-field
            :model-value="normalizedProps.sprintSpeed"
            type="number"
            label="Sprint speed"
            density="compact"
            hide-details
            @update:model-value="(value) => updateField('sprintSpeed', Number(value))"
          />
          <v-text-field
            :model-value="normalizedProps.turnRateDegreesPerSecond"
            type="number"
            label="Turn rate (deg/s)"
            density="compact"
            hide-details
            @update:model-value="(value) => updateField('turnRateDegreesPerSecond', Number(value))"
          />
          <v-text-field
            :model-value="normalizedProps.jumpImpulse"
            type="number"
            label="Jump impulse"
            density="compact"
            hide-details
            @update:model-value="(value) => updateField('jumpImpulse', Number(value))"
          />
          <v-text-field
            :model-value="normalizedProps.airControl"
            type="number"
            step="0.05"
            label="Air control"
            density="compact"
            hide-details
            @update:model-value="(value) => updateField('airControl', Number(value))"
          />
          <v-text-field
            :model-value="normalizedProps.stepHeight"
            type="number"
            step="0.05"
            label="Step height"
            density="compact"
            hide-details
            @update:model-value="(value) => updateField('stepHeight', Number(value))"
          />
          <v-text-field
            :model-value="normalizedProps.slopeLimitDegrees"
            type="number"
            label="Slope limit"
            density="compact"
            hide-details
            @update:model-value="(value) => updateField('slopeLimitDegrees', Number(value))"
          />
          <v-text-field
            :model-value="normalizedProps.colliderRadius"
            type="number"
            step="0.05"
            label="Collider radius"
            density="compact"
            hide-details
            @update:model-value="(value) => updateField('colliderRadius', Number(value))"
          />
          <v-text-field
            :model-value="normalizedProps.colliderHeight"
            type="number"
            step="0.05"
            label="Collider height"
            density="compact"
            hide-details
            @update:model-value="(value) => updateField('colliderHeight', Number(value))"
          />
        </div>

        <div class="character-controller-panel__animations">
          <div class="character-controller-panel__section-title">Animation bindings</div>
          <p v-if="clipLoadError" class="character-controller-panel__note">{{ clipLoadError }}</p>
          <p v-else-if="isLoadingClips" class="character-controller-panel__note">Loading animation clips…</p>
          <p v-else-if="!clipItems.length" class="character-controller-panel__note">
            No animation clips were found on this model.
          </p>
          <div v-for="slot in animationSlots" :key="slot.value" class="character-controller-panel__binding-row">
            <div class="character-controller-panel__binding-label">{{ slot.label }}</div>
            <v-select
              :items="clipItems"
              :model-value="normalizedProps.animationBindings.find((binding) => binding.slot === slot.value)?.clipName ?? null"
              clearable
              density="compact"
              hide-details
              placeholder="Select a clip"
              @update:model-value="(value) => updateAnimationBinding(slot.value, value ? String(value) : null)"
            />
          </div>
        </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.character-controller-panel {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
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

.character-controller-panel__section-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.8);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.character-controller-panel__binding-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 0.75rem;
  align-items: center;
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
