<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema/core'
import { useSceneStore } from '@/stores/sceneStore'
import {
  VIEW_POINT_COMPONENT_TYPE,
  type ViewPointComponentProps,
  clampViewPointComponentProps,
  VIEW_POINT_DEFAULT_INITIAL_VISIBILITY,
  VIEW_POINT_DEFAULT_CAMERA_FOV,
  VIEW_POINT_DEFAULT_CAMERA_NEAR,
  VIEW_POINT_DEFAULT_CAMERA_FAR,
  VIEW_POINT_DEFAULT_CAMERA_ZOOM,
  VIEW_POINT_CAMERA_FOV_MIN,
  VIEW_POINT_CAMERA_FOV_MAX,
  VIEW_POINT_CAMERA_NEAR_MIN,
  VIEW_POINT_CAMERA_FAR_MIN,
  VIEW_POINT_CAMERA_ZOOM_MIN,
  VIEW_POINT_CAMERA_ZOOM_MAX,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const viewPointComponent = computed(
  () => selectedNode.value?.components?.[VIEW_POINT_COMPONENT_TYPE] as
    | SceneNodeComponentState<ViewPointComponentProps>
    | undefined,
)

const componentEnabled = computed(() => viewPointComponent.value?.enabled !== false)

const localState = reactive<ViewPointComponentProps>({
  initiallyVisible: VIEW_POINT_DEFAULT_INITIAL_VISIBILITY,
  cameraLocalPositionX: 0,
  cameraLocalPositionY: 0,
  cameraLocalPositionZ: 0,
  cameraLocalRotationX: 0,
  cameraLocalRotationY: 0,
  cameraLocalRotationZ: 0,
  cameraFov: VIEW_POINT_DEFAULT_CAMERA_FOV,
  cameraNear: VIEW_POINT_DEFAULT_CAMERA_NEAR,
  cameraFar: VIEW_POINT_DEFAULT_CAMERA_FAR,
  cameraZoom: VIEW_POINT_DEFAULT_CAMERA_ZOOM,
})

const syncing = ref(false)

watch(
  () => viewPointComponent.value?.props,
  (props) => {
    const normalized = clampViewPointComponentProps(props as Partial<ViewPointComponentProps> | undefined)
    syncing.value = true
    Object.assign(localState, normalized)
    nextTick(() => {
      syncing.value = false
    })
  },
  { immediate: true, deep: true },
)

function applyViewPoint(patch: Partial<ViewPointComponentProps>) {
  const component = viewPointComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, patch as Partial<Record<string, unknown>>, { autoSaveMode: 'interactive' })
}

function updateNumericField(
  key: Exclude<keyof ViewPointComponentProps, 'initiallyVisible'>,
  value: string | number | null,
  options: { min?: number; max?: number } = {},
) {
  if (!componentEnabled.value || value === '' || value === null || value === undefined) {
    return
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  let next = numeric
  if (typeof options.min === 'number') {
    next = Math.max(options.min, next)
  }
  if (typeof options.max === 'number') {
    next = Math.min(options.max, next)
  }
  if (localState[key] === next) {
    return
  }
  ;(localState as unknown as Record<string, number>)[key] = next
  if (!syncing.value) {
    applyViewPoint({ [key]: next } as Partial<ViewPointComponentProps>)
  }
}

function handleToggleComponent() {
  const component = viewPointComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = viewPointComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}

function handleVisibilityChange(value: boolean | null) {
  if (!componentEnabled.value) {
    return
  }
  const nextValue = value !== false
  localState.initiallyVisible = nextValue
  if (!syncing.value) {
    applyViewPoint({ initiallyVisible: nextValue })
  }
}

</script>

<template>
  <v-expansion-panel value="view-point">
    <v-expansion-panel-title>
      <div class="view-point-panel-header">
        <span class="view-point-panel-title">View Point Component</span>
        <v-spacer />
        <v-menu
          v-if="viewPointComponent"
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
              <v-list-item-title>{{ viewPointComponent.enabled ? 'Disable' : 'Enable' }}</v-list-item-title>
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
      <div class="view-point-settings">
        <v-checkbox
          :model-value="localState.initiallyVisible"
          label="Initially Visible"
          color="primary"
          density="comfortable"
          :disabled="!componentEnabled"
          inset
          @update:modelValue="handleVisibilityChange"
        />
        <div class="view-point-settings__group">
          <div class="view-point-settings__group-title">Projection</div>
          <v-text-field
            :model-value="localState.cameraFov"
            label="FOV"
            type="number"
            density="compact"
            variant="outlined"
            hide-details
            step="1"
            :min="VIEW_POINT_CAMERA_FOV_MIN"
            :max="VIEW_POINT_CAMERA_FOV_MAX"
            :disabled="!componentEnabled"
            @update:modelValue="updateNumericField('cameraFov', $event, { min: VIEW_POINT_CAMERA_FOV_MIN, max: VIEW_POINT_CAMERA_FOV_MAX })"
          />
          <v-text-field
            :model-value="localState.cameraNear"
            label="Near"
            type="number"
            density="compact"
            variant="outlined"
            hide-details
            step="0.01"
            :min="VIEW_POINT_CAMERA_NEAR_MIN"
            :disabled="!componentEnabled"
            @update:modelValue="updateNumericField('cameraNear', $event, { min: VIEW_POINT_CAMERA_NEAR_MIN })"
          />
          <v-text-field
            :model-value="localState.cameraFar"
            label="Far"
            type="number"
            density="compact"
            variant="outlined"
            hide-details
            step="1"
            :min="VIEW_POINT_CAMERA_FAR_MIN"
            :disabled="!componentEnabled"
            @update:modelValue="updateNumericField('cameraFar', $event, { min: VIEW_POINT_CAMERA_FAR_MIN })"
          />
          <v-text-field
            :model-value="localState.cameraZoom"
            label="Zoom"
            type="number"
            density="compact"
            variant="outlined"
            hide-details
            step="0.1"
            :min="VIEW_POINT_CAMERA_ZOOM_MIN"
            :max="VIEW_POINT_CAMERA_ZOOM_MAX"
            :disabled="!componentEnabled"
            @update:modelValue="updateNumericField('cameraZoom', $event, { min: VIEW_POINT_CAMERA_ZOOM_MIN, max: VIEW_POINT_CAMERA_ZOOM_MAX })"
          />
        </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.view-point-panel-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.view-point-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.view-point-settings {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-inline: 0.4rem;
}

.view-point-settings__group {
  display: grid;
  gap: 0.5rem;
}

.view-point-settings__group-title {
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: rgba(233, 236, 241, 0.72);
  text-transform: uppercase;
}
</style>
