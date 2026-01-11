<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { SceneNodeComponentState } from '@harmony/schema'
import { GUIDE_ROUTE_COMPONENT_TYPE } from '@schema/components'
import type { GuideRouteComponentProps } from '@schema/components'

type WaypointDraft = { name: string }

const sceneStore = useSceneStore()
const { selectedNode } = storeToRefs(sceneStore)

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
