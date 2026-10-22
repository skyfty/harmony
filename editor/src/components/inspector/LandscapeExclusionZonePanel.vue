<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema/core'
import { useSceneStore } from '@/stores/sceneStore'
import {
  LANDSCAPE_EXCLUSION_ZONE_COMPONENT_TYPE,
  LANDSCAPE_EXCLUSION_ZONE_MAX_RADIUS,
  LANDSCAPE_EXCLUSION_ZONE_MIN_RADIUS,
  clampLandscapeExclusionZoneProps,
  type LandscapeExclusionZoneProps,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const component = computed(
  () =>
    selectedNode.value?.components?.[LANDSCAPE_EXCLUSION_ZONE_COMPONENT_TYPE] as
      | SceneNodeComponentState<LandscapeExclusionZoneProps>
      | undefined,
)
const componentEnabled = computed(() => component.value?.enabled !== false)
const normalizedProps = computed(() => (
  clampLandscapeExclusionZoneProps(component.value?.props ?? null)
))
const localRadius = ref(normalizedProps.value.radius)

watch(
  () => component.value?.props,
  () => {
    localRadius.value = normalizedProps.value.radius
  },
  { immediate: true, deep: true },
)

function applyRadius(): void {
  const current = component.value
  const nodeId = selectedNodeId.value
  if (!current || !nodeId) {
    return
  }
  const radius = clampLandscapeExclusionZoneProps({ radius: localRadius.value }).radius
  localRadius.value = radius
  sceneStore.updateNodeComponentProps(nodeId, current.id, { radius })
}

function handleToggleComponent(): void {
  const current = component.value
  const nodeId = selectedNodeId.value
  if (!current || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, current.id)
}

function handleRemoveComponent(): void {
  const current = component.value
  const nodeId = selectedNodeId.value
  if (!current || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, current.id)
}
</script>

<template>
  <v-expansion-panel :value="LANDSCAPE_EXCLUSION_ZONE_COMPONENT_TYPE">
    <v-expansion-panel-title>
      <div class="landscape-exclusion-panel__header">
        <span class="landscape-exclusion-panel__title">Landscape Exclusion Zone</span>
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
      <div class="landscape-exclusion-panel__content">
        <v-text-field
          v-model.number="localRadius"
          label="Radius (m)"
          type="number"
          density="compact"
          variant="underlined"
          :min="LANDSCAPE_EXCLUSION_ZONE_MIN_RADIUS"
          :max="LANDSCAPE_EXCLUSION_ZONE_MAX_RADIUS"
          step="0.5"
          suffix="m"
          hide-details
          :disabled="!componentEnabled"
          @blur="applyRadius"
          @keydown.enter.prevent="applyRadius"
        />
        <div class="landscape-exclusion-panel__hint">
          圆心使用节点世界坐标原点，半径按世界米计算。修改后请在 Procedural Landscape
          面板点击“重新生成”应用。
        </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.landscape-exclusion-panel__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.landscape-exclusion-panel__title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.landscape-exclusion-panel__content {
  display: grid;
  gap: 0.6rem;
}

.landscape-exclusion-panel__hint {
  font-size: 0.78rem;
  line-height: 1.45;
  color: rgba(233, 236, 241, 0.66);
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}
</style>
