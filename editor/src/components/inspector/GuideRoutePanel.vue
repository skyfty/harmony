<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { SceneNodeComponentState } from '@harmony/schema'
import { GUIDE_ROUTE_COMPONENT_TYPE } from '@schema/components'
import type { GuideRouteComponentProps } from '@schema/components'

type WaypointDraft = { name: string }

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const guideRouteComponent = computed(() => {
  const component = selectedNode.value?.components?.[GUIDE_ROUTE_COMPONENT_TYPE]
  if (!component) {
    return null
  }
  return component as SceneNodeComponentState<GuideRouteComponentProps>
})

const localWaypoints = ref<WaypointDraft[]>([])
const isSyncingFromScene = ref(false)

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
      return { name }
    })

    nextTick(() => {
      isSyncingFromScene.value = false
    })
  },
  { immediate: true },
)

function waypointTypeLabel(index: number, lastIndex: number): string {
  if (index === 0) return 'Start'
  if (index === lastIndex) return 'End'
  return 'Waypoint'
}

function applyWaypointNameUpdate(index: number, rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }

  const nodeId = selectedNodeId.value
  const component = guideRouteComponent.value
  if (!nodeId || !component) {
    return
  }

  const nextName = typeof rawValue === 'string' ? rawValue : String(rawValue ?? '')
  const trimmed = nextName.trim()

  const currentWaypoints = Array.isArray(component.props.waypoints) ? component.props.waypoints : []
  if (index < 0 || index >= currentWaypoints.length) {
    return
  }

  const currentEntry = currentWaypoints[index]
  const currentName = typeof currentEntry?.name === 'string' ? currentEntry.name : ''
  if (currentName === trimmed) {
    return
  }

  const nextWaypoints = currentWaypoints.map((entry, i) => {
    if (i !== index) return entry
    return {
      ...entry,
      name: trimmed,
    }
  })

  sceneStore.updateNodeComponentProps(nodeId, component.id, { waypoints: nextWaypoints })
}
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
      <div v-if="localWaypoints.length" class="guide-route-waypoint-list">
        <div v-for="(wp, index) in localWaypoints" :key="index" class="guide-route-waypoint-row">
          <div class="guide-route-waypoint-meta">
            <span class="guide-route-waypoint-type">{{ waypointTypeLabel(index, localWaypoints.length - 1) }}</span>
            <span class="guide-route-waypoint-index">#{{ index + 1 }}</span>
          </div>
          <v-text-field
            :model-value="wp.name"
            density="compact"
            variant="solo"
            hide-details
            @update:modelValue="(value) => { wp.name = String(value ?? ''); applyWaypointNameUpdate(index, value) }"
          />
        </div>
      </div>
      <div v-else class="guide-route-empty">No waypoints</div>
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

.guide-route-waypoint-row {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.guide-route-waypoint-meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.78rem;
  opacity: 0.75;
}

.guide-route-empty {
  font-size: 0.85rem;
  opacity: 0.7;
}
</style>
