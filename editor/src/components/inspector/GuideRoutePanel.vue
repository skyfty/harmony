<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import type { SceneNodeComponentState } from '@schema/core'
import {
  BEHAVIOR_COMPONENT_TYPE,
  GUIDE_ROUTE_COMPONENT_TYPE,
  PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
  clampGuideRouteComponentProps,
  createGuidePathRouteLeg,
  createGuideRoadRouteLeg,
  type GuidePathRouteLeg,
  type GuideRoadRouteLeg,
  type GuideRouteBehaviorRef,
  type GuideRouteComponentProps,
  type GuideRouteLeg,
  type GuideRouteStop,
  type GuideRouteTransition,
} from '@schema/components'
import {
  getProceduralLandscapeGuideRouteSurfaceState,
} from '@schema/proceduralLandscape/runtime'
import { collectPerformSequenceOptions } from '@schema/behaviors/sequenceOptions'
import type { ProjectAsset } from '@/types/project-asset'
import AssetPickerDialog from '@/components/common/AssetPickerDialog.vue'

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const { selectedNode } = storeToRefs(sceneStore)
const assetDialogVisible = ref(false)
const assetDialogSelectedId = ref('')
const assetDialogAnchor = ref<{ x: number; y: number } | null>(null)
const assetDialogStopId = ref<string | null>(null)

const guideRouteComponent = computed(() => {
  const component = selectedNode.value?.components?.[GUIDE_ROUTE_COMPONENT_TYPE]
  return component as SceneNodeComponentState<GuideRouteComponentProps> | undefined
})

const guideRouteProps = computed(() => (
  guideRouteComponent.value?.props?.version === 3
    ? clampGuideRouteComponentProps(guideRouteComponent.value.props)
    : null
))

const componentEnabled = computed(() => guideRouteComponent.value?.enabled !== false)

const landscapeNodeOptions = computed(() => sceneStore.nodes
  .filter((node) => node.components?.[PROCEDURAL_LANDSCAPE_COMPONENT_TYPE])
  .map((node) => ({ title: node.name?.trim() || node.id, value: node.id })))

const behaviorNodeOptions = computed(() => sceneStore.nodes
  .filter((node) => (
    node.components?.[BEHAVIOR_COMPONENT_TYPE]
    && collectPerformSequenceOptions(sceneStore.nodes, node.id).length > 0
  ))
  .map((node) => ({ title: node.name?.trim() || node.id, value: node.id })))

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function updateProps(patch: Partial<GuideRouteComponentProps>): void {
  const component = guideRouteComponent.value
  if (!component?.id || !componentEnabled.value) {
    return
  }
  const current = guideRouteProps.value ?? clampGuideRouteComponentProps(null)
  const nextProps = clampGuideRouteComponentProps({
    ...current,
    ...patch,
  })
  sceneStore.updateNodeComponentProps(
    selectedNode.value!.id,
    component.id,
    nextProps as unknown as Partial<Record<string, unknown>>,
  )
  if (!nextProps.legs.some((leg) => leg.kind === 'path')) {
    sceneStore.setGuideRouteDisplayVertices(selectedNode.value!.id, [])
  }
}

function updateLeg(legId: string, patch: Partial<GuideRouteLeg>): void {
  const props = guideRouteProps.value
  if (!props) {
    return
  }
  updateProps({
    legs: props.legs.map((leg) => (
      leg.id === legId ? { ...leg, ...patch } as GuideRouteLeg : leg
    )),
  })
}

function moveLeg(index: number, delta: -1 | 1): void {
  const props = guideRouteProps.value
  if (!props) {
    return
  }
  const target = index + delta
  if (target < 0 || target >= props.legs.length) {
    return
  }
  const legs = props.legs.map((leg) => ({ ...leg })) as GuideRouteLeg[]
  ;[legs[index], legs[target]] = [legs[target]!, legs[index]!]
  updateProps({ legs })
}

function removeLeg(legId: string): void {
  const props = guideRouteProps.value
  if (!props || props.legs.length <= 1) {
    return
  }
  updateProps({
    legs: props.legs.filter((leg) => leg.id !== legId),
    stops: props.stops.filter((stop) => stop.legId !== legId),
    transitions: props.transitions.filter((transition) => transition.afterLegId !== legId),
  })
}

function addRoadLeg(): void {
  const providerNodeId = landscapeNodeOptions.value[0]?.value
  if (!providerNodeId) {
    return
  }
  const props = guideRouteProps.value
  if (!props) {
    return
  }
  updateProps({
    legs: [
      ...props.legs,
      createGuideRoadRouteLeg({
        id: createId('road'),
        providerNodeId,
        travelMode: 'vehicle',
      }),
    ],
  })
}

function addPathLeg(): void {
  const props = guideRouteProps.value
  if (!props) {
    return
  }
  const nodePosition = selectedNode.value?.position ?? { x: 0, y: 0, z: 0 }
  const providerNodeId = landscapeNodeOptions.value[0]?.value ?? null
  const pathLeg = createGuidePathRouteLeg({
    id: createId('path'),
    travelMode: 'character',
    surfaceProviderNodeId: providerNodeId,
    preserveAuthoredY: !providerNodeId,
    anchors: [
      { x: nodePosition.x, y: nodePosition.y, z: nodePosition.z },
      { x: nodePosition.x + 10, y: nodePosition.y, z: nodePosition.z },
    ],
  })
  updateProps({
    legs: [
      ...props.legs,
      pathLeg,
    ],
  })
  updatePathAnchors(pathLeg, pathLeg.anchors)
}

function updatePathAnchor(leg: GuidePathRouteLeg, index: number, axis: 'x' | 'y' | 'z', value: unknown): void {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const anchors = leg.anchors.map((anchor, anchorIndex) => (
    anchorIndex === index ? { ...anchor, [axis]: numeric } : { ...anchor }
  ))
  updatePathAnchors(leg, anchors)
}

function addPathAnchor(leg: GuidePathRouteLeg): void {
  const previous = leg.anchors[leg.anchors.length - 1] ?? { x: 0, y: 0, z: 0 }
  updatePathAnchors(leg, [
      ...leg.anchors.map((anchor) => ({ ...anchor })),
      { x: previous.x + 5, y: previous.y, z: previous.z },
  ])
}

function removePathAnchor(leg: GuidePathRouteLeg, index: number): void {
  if (leg.anchors.length <= 2) {
    return
  }
  updatePathAnchors(
    leg,
    leg.anchors.filter((_, anchorIndex) => anchorIndex !== index),
  )
}

function updatePathAnchors(
  leg: GuidePathRouteLeg,
  anchors: GuidePathRouteLeg['anchors'],
): void {
  const node = selectedNode.value
  if (!node?.id || !componentEnabled.value) {
    return
  }
  const origin = node.position ?? { x: 0, y: 0, z: 0 }
  sceneStore.updateGuideRouteWaypoints(node.id, {
    legId: leg.id,
    anchors,
    vertices: anchors.map((anchor) => ({
      x: anchor.x - origin.x,
      y: anchor.y - origin.y,
      z: anchor.z - origin.z,
    })),
  })
}

function addStop(leg: GuideRouteLeg): void {
  const props = guideRouteProps.value
  if (!props) {
    return
  }
  const fallback = leg.kind === 'path'
    ? leg.anchors[0]
    : selectedNode.value?.position
  const anchor = fallback ?? { x: 0, y: 0, z: 0 }
  updateProps({
    stops: [
      ...props.stops,
      {
        id: createId('stop'),
        name: `Stop ${props.stops.length + 1}`,
        thumbnailAssetId: null,
        anchor: { x: anchor.x, y: anchor.y, z: anchor.z },
        legId: leg.id,
        behavior: null,
      },
    ],
  })
}

function updateStop(stopId: string, patch: Partial<GuideRouteStop>): void {
  const props = guideRouteProps.value
  if (!props) {
    return
  }
  updateProps({
    stops: props.stops.map((stop) => (
      stop.id === stopId ? { ...stop, ...patch } : stop
    )),
  })
}

function updateStopAnchor(stop: GuideRouteStop, axis: 'x' | 'y' | 'z', value: unknown): void {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  updateStop(stop.id, {
    anchor: { ...stop.anchor, [axis]: numeric },
  })
}

function removeStop(stopId: string): void {
  const props = guideRouteProps.value
  if (!props) {
    return
  }
  updateProps({ stops: props.stops.filter((stop) => stop.id !== stopId) })
}

function setStopBehavior(stop: GuideRouteStop, nodeId: string): void {
  const options = collectPerformSequenceOptions(sceneStore.nodes, nodeId || null)
  updateStop(stop.id, {
    behavior: nodeId && options[0]
      ? { nodeId, sequenceId: options[0].sequenceId }
      : null,
  })
}

function updateStopBehavior(stop: GuideRouteStop, patch: Partial<GuideRouteBehaviorRef>): void {
  if (!stop.behavior) {
    return
  }
  updateStop(stop.id, { behavior: { ...stop.behavior, ...patch } })
}

function addTransition(afterLegId: string): void {
  const props = guideRouteProps.value
  if (!props) {
    return
  }
  const behaviorNodeId = behaviorNodeOptions.value[0]?.value
  const behaviorOptions = collectPerformSequenceOptions(sceneStore.nodes, behaviorNodeId ?? null)
  if (!behaviorNodeId || !behaviorOptions[0]) {
    return
  }
  updateProps({
    transitions: [
      ...props.transitions,
      {
        id: createId('transition'),
        afterLegId,
        behavior: {
          nodeId: behaviorNodeId,
          sequenceId: behaviorOptions[0].sequenceId,
        },
      },
    ],
  })
}

function updateTransition(transitionId: string, patch: Partial<GuideRouteTransition>): void {
  const props = guideRouteProps.value
  if (!props) {
    return
  }
  updateProps({
    transitions: props.transitions.map((transition) => (
      transition.id === transitionId ? { ...transition, ...patch } : transition
    )),
  })
}

function setTransitionBehaviorNode(transition: GuideRouteTransition, nodeId: string): void {
  const options = collectPerformSequenceOptions(sceneStore.nodes, nodeId || null)
  if (!nodeId || !options[0]) {
    return
  }
  updateTransition(transition.id, {
    behavior: { nodeId, sequenceId: options[0].sequenceId },
  })
}

function removeTransition(transitionId: string): void {
  const props = guideRouteProps.value
  if (!props) {
    return
  }
  updateProps({
    transitions: props.transitions.filter((transition) => transition.id !== transitionId),
  })
}

function resolveWaypointAsset(assetId: string | null | undefined): ProjectAsset | null {
  const normalized = assetId?.trim()
  return normalized ? sceneStore.getAsset(normalized) ?? null : null
}

function resolveWaypointThumbnail(assetId: string | null | undefined): string | null {
  const asset = resolveWaypointAsset(assetId)
  return asset
    ? assetCacheStore.resolveAssetThumbnail({ asset, assetId: asset.id })
    : null
}

function openThumbnailPicker(event: MouseEvent, stop: GuideRouteStop): void {
  assetDialogStopId.value = stop.id
  assetDialogSelectedId.value = stop.thumbnailAssetId ?? ''
  assetDialogAnchor.value = { x: event.clientX, y: event.clientY }
  assetDialogVisible.value = true
}

function updateThumbnail(asset: ProjectAsset | null): void {
  const stopId = assetDialogStopId.value
  if (stopId) {
    updateStop(stopId, {
      thumbnailAssetId: asset && (asset.type === 'image' || asset.type === 'texture')
        ? asset.id
        : null,
    })
  }
  assetDialogVisible.value = false
}

function stopBehaviorOptions(stop: GuideRouteStop) {
  return collectPerformSequenceOptions(sceneStore.nodes, stop.behavior?.nodeId ?? null)
}

function transitionBehaviorOptions(transition: GuideRouteTransition) {
  return collectPerformSequenceOptions(sceneStore.nodes, transition.behavior.nodeId)
}

function surfaceStatus(providerNodeId: string | null) {
  return providerNodeId
    ? getProceduralLandscapeGuideRouteSurfaceState(providerNodeId)
    : null
}

</script>

<template>
  <v-expansion-panel value="guide-route">
    <v-expansion-panel-title>
      <div class="gr-header">
        <span>Guide Route V3</span>
        <v-spacer />
        <span class="gr-meta">{{ guideRouteProps?.legs.length ?? 0 }} legs</span>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <v-alert
        v-if="!guideRouteProps"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-3"
      >
        旧版 GuideRoute 不再支持，请删除后重建。
      </v-alert>
      <template v-else>
        <div class="gr-toolbar">
          <v-switch
            label="Loop"
            density="compact"
            hide-details
            :model-value="guideRouteProps.loop"
            :disabled="!componentEnabled"
            @update:model-value="(value) => updateProps({ loop: value === true })"
          />
          <v-menu>
            <template #activator="{ props: menuProps }">
              <v-btn v-bind="menuProps" size="small" variant="tonal" :disabled="!componentEnabled">
                Add leg
              </v-btn>
            </template>
            <v-list density="compact">
              <v-list-item @click="addRoadLeg">生成公路段</v-list-item>
              <v-list-item @click="addPathLeg">绘线路径段</v-list-item>
            </v-list>
          </v-menu>
        </div>

        <v-alert
          v-if="!landscapeNodeOptions.length"
          type="info"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          场景中没有 Procedural Landscape，暂时只能创建三维绘线路径段。
        </v-alert>

        <div class="gr-section-title">Route legs</div>
        <div v-for="(leg, legIndex) in guideRouteProps.legs" :key="leg.id" class="gr-card">
          <div class="gr-card-head">
            <v-chip size="small" :color="leg.kind === 'road' ? 'primary' : 'secondary'" variant="tonal">
              {{ leg.kind === 'road' ? '公路' : '路径' }}
            </v-chip>
            <span class="gr-leg-id">{{ leg.id }}</span>
            <v-spacer />
            <v-btn size="x-small" icon variant="text" :disabled="legIndex === 0" @click="moveLeg(legIndex, -1)">
              <v-icon>mdi-chevron-up</v-icon>
            </v-btn>
            <v-btn size="x-small" icon variant="text" :disabled="legIndex === guideRouteProps.legs.length - 1" @click="moveLeg(legIndex, 1)">
              <v-icon>mdi-chevron-down</v-icon>
            </v-btn>
            <v-btn size="x-small" icon variant="text" :disabled="guideRouteProps.legs.length <= 1" @click="removeLeg(leg.id)">
              <v-icon>mdi-delete</v-icon>
            </v-btn>
          </div>
          <div class="gr-grid">
            <v-select
              label="Travel mode"
              density="compact"
              variant="underlined"
              hide-details
              :model-value="leg.travelMode"
              :items="[{ title: 'Vehicle', value: 'vehicle' }, { title: 'Character', value: 'character' }]"
              :disabled="!componentEnabled"
              @update:model-value="(value) => updateLeg(leg.id, { travelMode: value as 'vehicle' | 'character' })"
            />
            <v-text-field
              label="Cruise m/s"
              type="number"
              density="compact"
              variant="underlined"
              hide-details
              :model-value="leg.speedProfile.cruiseSpeedMps"
              :disabled="!componentEnabled"
              @update:model-value="(value) => updateLeg(leg.id, { speedProfile: { ...leg.speedProfile, cruiseSpeedMps: Number(value) } })"
            />
            <v-text-field
              label="Lateral accel"
              type="number"
              density="compact"
              variant="underlined"
              hide-details
              :model-value="leg.speedProfile.lateralAccelLimitMps2"
              :disabled="!componentEnabled"
              @update:model-value="(value) => updateLeg(leg.id, { speedProfile: { ...leg.speedProfile, lateralAccelLimitMps2: Number(value) } })"
            />
          </div>

          <template v-if="leg.kind === 'road'">
            <v-select
              label="Road provider"
              density="compact"
              variant="underlined"
              hide-details
              :model-value="leg.providerNodeId"
              :items="landscapeNodeOptions"
              :disabled="!componentEnabled"
              @update:model-value="(value) => updateLeg(leg.id, { providerNodeId: String(value) } as Partial<GuideRoadRouteLeg>)"
            />
            <div class="gr-surface-row">
              <span>revision {{ surfaceStatus(leg.providerNodeId)?.revision ?? '-' }}</span>
              <v-chip size="x-small" variant="tonal">
                {{ surfaceStatus(leg.providerNodeId)?.status ?? 'missing' }}
              </v-chip>
            </div>
            <div class="gr-grid gr-grid--four">
              <v-text-field
                label="Start T"
                type="number"
                step="0.01"
                density="compact"
                variant="underlined"
                hide-details
                :model-value="leg.startT"
                :disabled="!componentEnabled"
                @update:model-value="(value) => updateLeg(leg.id, { startT: Number(value) } as Partial<GuideRoadRouteLeg>)"
              />
              <v-text-field
                label="End T"
                type="number"
                step="0.01"
                density="compact"
                variant="underlined"
                hide-details
                :model-value="leg.endT"
                :disabled="!componentEnabled"
                @update:model-value="(value) => updateLeg(leg.id, { endT: Number(value) } as Partial<GuideRoadRouteLeg>)"
              />
              <v-text-field
                label="Lane m"
                type="number"
                step="0.1"
                density="compact"
                variant="underlined"
                hide-details
                :model-value="leg.laneOffsetM"
                :disabled="!componentEnabled"
                @update:model-value="(value) => updateLeg(leg.id, { laneOffsetM: Number(value) } as Partial<GuideRoadRouteLeg>)"
              />
              <v-text-field
                label="Sample m"
                type="number"
                step="0.5"
                density="compact"
                variant="underlined"
                hide-details
                :model-value="leg.sampleSpacingM"
                :disabled="!componentEnabled"
                @update:model-value="(value) => updateLeg(leg.id, { sampleSpacingM: Number(value) } as Partial<GuideRoadRouteLeg>)"
              />
            </div>
            <div class="gr-inline-actions">
              <v-btn
                size="small"
                variant="text"
                :disabled="!componentEnabled"
                @click="updateLeg(leg.id, { startT: leg.endT, endT: leg.startT } as Partial<GuideRoadRouteLeg>)"
              >
                反转行驶方向
              </v-btn>
            </div>
          </template>

          <template v-else>
            <v-select
              label="Surface provider"
              density="compact"
              variant="underlined"
              hide-details
              clearable
              :model-value="leg.surfaceProviderNodeId"
              :items="landscapeNodeOptions"
              :disabled="!componentEnabled"
              @update:model-value="(value) => updateLeg(leg.id, { surfaceProviderNodeId: value ? String(value) : null } as Partial<GuidePathRouteLeg>)"
            />
            <v-switch
              label="Preserve authored Y"
              density="compact"
              hide-details
              :model-value="leg.preserveAuthoredY"
              :disabled="!componentEnabled"
              @update:model-value="(value) => updateLeg(leg.id, { preserveAuthoredY: value === true } as Partial<GuidePathRouteLeg>)"
            />
            <div class="gr-anchor-list">
              <div v-for="(anchor, anchorIndex) in leg.anchors" :key="anchorIndex" class="gr-anchor-row">
                <span>A{{ anchorIndex + 1 }}</span>
                <v-text-field
                  v-for="axis in (['x', 'y', 'z'] as const)"
                  :key="axis"
                  :label="axis.toUpperCase()"
                  type="number"
                  density="compact"
                  variant="underlined"
                  hide-details
                  :model-value="anchor[axis]"
                  :disabled="!componentEnabled"
                  @update:model-value="(value) => updatePathAnchor(leg, anchorIndex, axis, value)"
                />
                <v-btn icon size="x-small" variant="text" :disabled="leg.anchors.length <= 2" @click="removePathAnchor(leg, anchorIndex)">
                  <v-icon>mdi-close</v-icon>
                </v-btn>
              </div>
            </div>
            <v-btn size="small" variant="text" :disabled="!componentEnabled" @click="addPathAnchor(leg)">
              Add anchor
            </v-btn>
          </template>

          <div class="gr-inline-actions">
            <v-btn size="small" variant="tonal" :disabled="!componentEnabled" @click="addStop(leg)">
              Add stop
            </v-btn>
            <v-btn
              size="small"
              variant="text"
              :disabled="!componentEnabled || !behaviorNodeOptions.length"
              @click="addTransition(leg.id)"
            >
              Add transition
            </v-btn>
          </div>
        </div>

        <div class="gr-section-title">Stops</div>
        <div v-if="!guideRouteProps.stops.length" class="gr-empty">Stop is a route event; it does not stop or reroute movement.</div>
        <div v-for="stop in guideRouteProps.stops" :key="stop.id" class="gr-card">
          <div class="gr-card-head">
            <v-text-field
              label="Name"
              density="compact"
              variant="underlined"
              hide-details
              :model-value="stop.name"
              :disabled="!componentEnabled"
              @update:model-value="(value) => updateStop(stop.id, { name: String(value ?? '') })"
            />
            <v-btn icon size="x-small" variant="text" @click="removeStop(stop.id)">
              <v-icon>mdi-delete</v-icon>
            </v-btn>
          </div>
          <v-select
            label="Attached leg"
            density="compact"
            variant="underlined"
            hide-details
            :model-value="stop.legId"
            :items="guideRouteProps.legs.map((leg) => ({ title: leg.id, value: leg.id }))"
            :disabled="!componentEnabled"
            @update:model-value="(value) => updateStop(stop.id, { legId: String(value) })"
          />
          <div class="gr-grid gr-grid--four">
            <v-text-field
              v-for="axis in (['x', 'y', 'z'] as const)"
              :key="axis"
              :label="axis.toUpperCase()"
              type="number"
              density="compact"
              variant="underlined"
              hide-details
              :model-value="stop.anchor[axis]"
              :disabled="!componentEnabled"
              @update:model-value="(value) => updateStopAnchor(stop, axis, value)"
            />
            <div class="gr-thumb" @click="openThumbnailPicker($event, stop)">
              <img v-if="resolveWaypointThumbnail(stop.thumbnailAssetId)" :src="resolveWaypointThumbnail(stop.thumbnailAssetId) ?? undefined" alt="">
              <v-icon v-else size="18">mdi-image-plus-outline</v-icon>
            </div>
          </div>
          <v-select
            label="Behavior node"
            density="compact"
            variant="underlined"
            hide-details
            clearable
            :model-value="stop.behavior?.nodeId ?? null"
            :items="behaviorNodeOptions"
            :disabled="!componentEnabled"
            @update:model-value="(value) => setStopBehavior(stop, value ? String(value) : '')"
          />
          <v-select
            v-if="stop.behavior"
            label="Perform sequence"
            density="compact"
            variant="underlined"
            hide-details
            :model-value="stop.behavior.sequenceId"
            :items="stopBehaviorOptions(stop).map((option) => ({ title: option.label, value: option.sequenceId }))"
            :disabled="!componentEnabled"
            @update:model-value="(value) => updateStopBehavior(stop, { sequenceId: String(value) })"
          />
        </div>

        <div class="gr-section-title">Transitions</div>
        <div v-if="!guideRouteProps.transitions.length" class="gr-empty">Transitions are required when a behavior switches the active vehicle or character.</div>
        <div v-for="transition in guideRouteProps.transitions" :key="transition.id" class="gr-card">
          <div class="gr-card-head">
            <span>After {{ transition.afterLegId }}</span>
            <v-spacer />
            <v-btn icon size="x-small" variant="text" @click="removeTransition(transition.id)">
              <v-icon>mdi-delete</v-icon>
            </v-btn>
          </div>
          <v-select
            label="Behavior node"
            density="compact"
            variant="underlined"
            hide-details
            :model-value="transition.behavior.nodeId"
            :items="behaviorNodeOptions"
            :disabled="!componentEnabled"
            @update:model-value="(value) => setTransitionBehaviorNode(transition, String(value))"
          />
          <v-select
            label="Perform sequence"
            density="compact"
            variant="underlined"
            hide-details
            :model-value="transition.behavior.sequenceId"
            :items="transitionBehaviorOptions(transition).map((option) => ({ title: option.label, value: option.sequenceId }))"
            :disabled="!componentEnabled"
            @update:model-value="(value) => updateTransition(transition.id, { behavior: { ...transition.behavior, sequenceId: String(value) } })"
          />
        </div>
      </template>

      <AssetPickerDialog
        v-model="assetDialogVisible"
        :asset-id="assetDialogSelectedId"
        asset-type="image,texture"
        title="选择停靠点缩略图"
        :anchor="assetDialogAnchor"
        @update:asset="updateThumbnail"
        @cancel="assetDialogVisible = false"
      />
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.gr-header,
.gr-card-head,
.gr-toolbar,
.gr-inline-actions,
.gr-surface-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.gr-header {
  width: 100%;
}

.gr-meta,
.gr-leg-id,
.gr-surface-row,
.gr-empty {
  font-size: 0.76rem;
  opacity: 0.72;
}

.gr-toolbar {
  justify-content: space-between;
  margin-bottom: 0.8rem;
}

.gr-section-title {
  margin: 0.8rem 0 0.45rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.78;
}

.gr-card {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin-bottom: 0.65rem;
  padding: 0.7rem;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.025);
}

.gr-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
}

.gr-grid--four {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.gr-anchor-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.gr-anchor-row {
  display: grid;
  grid-template-columns: 2rem repeat(3, minmax(0, 1fr)) 2rem;
  gap: 0.4rem;
  align-items: center;
}

.gr-inline-actions {
  flex-wrap: wrap;
}

.gr-thumb {
  display: grid;
  place-items: center;
  min-height: 36px;
  border: 1px dashed rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  cursor: pointer;
  overflow: hidden;
}

.gr-thumb img {
  width: 100%;
  height: 44px;
  object-fit: cover;
}

@media (max-width: 720px) {
  .gr-grid,
  .gr-grid--four {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
