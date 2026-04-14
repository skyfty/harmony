<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { SceneNodeComponentState } from '@schema'
import { GUIDE_ROUTE_COMPONENT_TYPE } from '@schema/components'
import type { GuideRouteComponentProps } from '@schema/components'

type WaypointDraft = {
  name: string
  dock: boolean
}

const sceneStore = useSceneStore()
const { selectedGuideRouteWaypoint, selectedNode } = storeToRefs(sceneStore)

const guideRouteComponent = computed(() => {
  const component = selectedNode.value?.components?.[GUIDE_ROUTE_COMPONENT_TYPE]
  if (!component) {
    return null
  }
  return component as SceneNodeComponentState<GuideRouteComponentProps>
})

const localWaypoints = ref<WaypointDraft[]>([])
const isSyncingFromScene = ref(false)
const selectedWaypointIndex = computed(() => {
  const selectedNodeId = selectedNode.value?.id ?? null
  if (!selectedNodeId || selectedGuideRouteWaypoint.value?.nodeId !== selectedNodeId) {
    return null
  }
  return selectedGuideRouteWaypoint.value.waypointIndex
})
const canDeleteWaypoint = computed(() => localWaypoints.value.length > 2)
const isComponentEnabled = computed(() => guideRouteComponent.value?.enabled !== false)

function commitWaypoints(nextWaypoints: Array<WaypointDraft & { position: GuideRouteComponentProps['waypoints'][number]['position'] }>, selectedIndex?: number | null) {
  const nodeId = selectedNode.value?.id ?? null
  if (!nodeId) {
    return false
  }
  return sceneStore.updateGuideRouteWaypoints(nodeId, {
    vertices: nextWaypoints.map((entry) => entry.position),
    waypoints: nextWaypoints,
    selectedWaypointIndex: selectedIndex ?? selectedWaypointIndex.value,
  })
}

function handleSelectWaypoint(index: number) {
  const nodeId = selectedNode.value?.id ?? null
  if (!nodeId) {
    return
  }
  sceneStore.setSelectedGuideRouteWaypoint(nodeId, index)
}

function handleWaypointNameChange(index: number, value: string) {
  const component = guideRouteComponent.value
  if (!component || isSyncingFromScene.value) {
    return
  }
  const current = Array.isArray(component.props.waypoints) ? component.props.waypoints : []
  const nextWaypoints = current.map((entry, entryIndex) => ({
    name: entryIndex === index ? String(value ?? '') : (typeof entry?.name === 'string' ? entry.name : ''),
    dock: entry?.dock === true,
    position: entry.position,
  }))
  commitWaypoints(nextWaypoints, index)
}

function handleWaypointDockChange(index: number, value: boolean | null) {
  const component = guideRouteComponent.value
  if (!component || isSyncingFromScene.value) {
    return
  }
  const current = Array.isArray(component.props.waypoints) ? component.props.waypoints : []
  const nextWaypoints = current.map((entry, entryIndex) => ({
    name: typeof entry?.name === 'string' ? entry.name : '',
    dock: entryIndex === index ? value === true : entry?.dock === true,
    position: entry.position,
  }))
  commitWaypoints(nextWaypoints, index)
}

function handleDeleteWaypoint(index: number) {
  const component = guideRouteComponent.value
  if (!component || !canDeleteWaypoint.value) {
    return
  }
  const current = Array.isArray(component.props.waypoints) ? component.props.waypoints : []
  const nextWaypoints = current
    .filter((_, entryIndex) => entryIndex !== index)
    .map((entry) => ({
      name: typeof entry?.name === 'string' ? entry.name : '',
      dock: entry?.dock === true,
      position: entry.position,
    }))
  const nextSelectedIndex = nextWaypoints.length
    ? Math.min(index, nextWaypoints.length - 1)
    : null
  commitWaypoints(nextWaypoints, nextSelectedIndex)
}

watch(
  guideRouteComponent,
  (component) => {
    isSyncingFromScene.value = true
    if (!component) {
      localWaypoints.value = []
      nextTick(() => {
        isSyncingFromScene.value = false
      })
      return
    }

    const waypoints = Array.isArray(component.props.waypoints) ? component.props.waypoints : []
    localWaypoints.value = waypoints.map((entry, index) => {
      const raw = typeof entry?.name === 'string' ? entry.name : ''
      const name = raw.trim().length ? raw.trim() : `P${index + 1}`
      return {
        name,
        dock: entry?.dock === true,
      }
    })

    nextTick(() => {
      isSyncingFromScene.value = false
    })
  },
  { immediate: true },
)

// waypoint helpers removed (not referenced)
</script>

<template>
  <v-expansion-panel value="guide-route">
    <v-expansion-panel-title>
      <div class="guide-route-panel-header">
        <span class="guide-route-panel-title">Guide Route</span>
        <v-spacer />
        <span class="guide-route-panel-subtitle">{{ localWaypoints.length }} pts</span>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="guide-route-waypoint-list" v-if="localWaypoints.length">
        <div
          v-for="(waypoint, index) in localWaypoints"
          :key="`${selectedNode?.id ?? 'guide-route'}:${index}`"
          class="guide-route-waypoint-card"
          :class="{ 'guide-route-waypoint-card--selected': selectedWaypointIndex === index }"
          @click="handleSelectWaypoint(index)"
        >
          <div class="guide-route-waypoint-fields">
            <div class="guide-route-waypoint-meta">
              <span class="guide-route-waypoint-index">P{{ index + 1 }}</span>
            </div>
            <v-text-field
              label="Name"
              density="compact"
              variant="underlined"
              hide-details
              :model-value="waypoint.name"
              :disabled="!isComponentEnabled"
              @click.stop
              @update:modelValue="(value) => handleWaypointNameChange(index, String(value ?? ''))"
            />
            <v-switch
              label="Dockable"
              color="primary"
              density="compact"
              hide-details
              :model-value="waypoint.dock"
              :disabled="!isComponentEnabled"
              @click.stop
              @update:modelValue="(value) => handleWaypointDockChange(index, value as boolean | null)"
            />
          </div>
          <div class="guide-route-waypoint-actions">
            <v-btn
              icon
              variant="text"
              density="compact"
              :disabled="!isComponentEnabled || !canDeleteWaypoint"
              @click.stop="handleDeleteWaypoint(index)"
            >
              <v-icon size="18">mdi-delete</v-icon>
            </v-btn>
          </div>
        </div>
      </div>
      <div v-else class="guide-route-empty">
        GuideRoute needs at least two points. Use edit mode in the scene to create or insert waypoints.
      </div>
      <div class="guide-route-hint">
        In scene edit mode, click a route segment to insert a new waypoint.
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.guide-route-panel-header {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0.4rem;
}

.guide-route-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.guide-route-panel-subtitle {
  font-size: 0.78rem;
  opacity: 0.78;
}

.guide-route-waypoint-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.guide-route-waypoint-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: start;
  padding: 0.7rem 0.8rem;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: border-color 0.16s ease, background-color 0.16s ease, box-shadow 0.16s ease;
}

.guide-route-waypoint-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.45);
}

.guide-route-waypoint-card--selected {
  border-color: rgba(var(--v-theme-primary), 0.72);
  background: rgba(var(--v-theme-primary), 0.1);
  box-shadow: 0 0 0 1px rgba(var(--v-theme-primary), 0.18) inset;
}

.guide-route-waypoint-fields {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.guide-route-waypoint-actions {
  display: flex;
  align-items: center;
}

.guide-route-waypoint-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.78rem;
  opacity: 0.75;
}

.guide-route-waypoint-index {
  font-weight: 600;
  letter-spacing: 0.04em;
}

.guide-route-waypoint-badge {
  padding: 0.12rem 0.45rem;
  border-radius: 999px;
  font-size: 0.68rem;
  line-height: 1.4;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.14);
}

.guide-route-waypoint-badge--muted {
  color: rgba(255, 255, 255, 0.78);
  background: rgba(255, 255, 255, 0.08);
}

.guide-route-empty {
  font-size: 0.85rem;
  opacity: 0.7;
}

.guide-route-hint {
  margin-top: 0.75rem;
  font-size: 0.78rem;
  opacity: 0.78;
}
</style>
