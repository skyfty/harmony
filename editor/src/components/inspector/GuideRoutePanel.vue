<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
import { ASSET_DRAG_MIME } from '@/components/editor/constants'

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const {
  selectedNode,
  selectedGuideRouteStop,
  guideRouteStopSelectionRequestId,
} = storeToRefs(sceneStore)
const assetDialogVisible = ref(false)
const assetDialogSelectedId = ref('')
const assetDialogAnchor = ref<{ x: number; y: number } | null>(null)
const assetDialogStopId = ref<string | null>(null)
const stopCardElements = new Map<string, HTMLElement>()
const stopDropTargetId = ref<string | null>(null)
const deleteStopDialogVisible = ref(false)
const pendingDeleteStopId = ref<string | null>(null)
const snackbarVisible = ref(false)
const snackbarText = ref('')

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
const selectedStop = computed(() => {
  const selection = selectedGuideRouteStop.value
  if (!selection || selection.nodeId !== selectedNode.value?.id) {
    return null
  }
  return guideRouteProps.value?.stops.find((stop) => stop.id === selection.stopId) ?? null
})
const pendingDeleteStop = computed(() => (
  pendingDeleteStopId.value
    ? guideRouteProps.value?.stops.find((stop) => stop.id === pendingDeleteStopId.value) ?? null
    : null
))

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

function updateStop(stopId: string, patch: Partial<GuideRouteStop>): void {
  const props = guideRouteProps.value
  if (!props) {
    return
  }
  const nextPatch = patch.legId
    ? { ...patch, controlAnchorId: null }
    : patch
  updateProps({
    stops: props.stops.map((stop) => (
      stop.id === stopId ? { ...stop, ...nextPatch } : stop
    )),
  })
}

function selectStop(stopId: string): void {
  const nodeId = selectedNode.value?.id
  if (!nodeId) {
    return
  }
  sceneStore.setSelectedGuideRouteStop(nodeId, stopId)
}

function setStopCardElement(stopId: string, element: Element | null): void {
  if (element instanceof HTMLElement) {
    stopCardElements.set(stopId, element)
  } else {
    stopCardElements.delete(stopId)
  }
}

function updateStopAnchor(stop: GuideRouteStop, axis: 'x' | 'y' | 'z', value: unknown): void {
  const numeric = Number(value)
  const nodeId = selectedNode.value?.id
  if (!Number.isFinite(numeric) || !nodeId) {
    return
  }
  sceneStore.moveGuideRouteStopAtPosition(nodeId, stop.id, {
    ...stop.anchor,
    [axis]: numeric,
  })
}

function requestDeleteStop(stopId: string): void {
  if (!guideRouteProps.value?.stops.some((stop) => stop.id === stopId)) {
    return
  }
  pendingDeleteStopId.value = stopId
  deleteStopDialogVisible.value = true
}

function confirmDeleteStop(): void {
  const nodeId = selectedNode.value?.id
  const stopId = pendingDeleteStopId.value
  deleteStopDialogVisible.value = false
  pendingDeleteStopId.value = null
  if (!nodeId || !stopId) {
    return
  }
  if (sceneStore.removeGuideRouteStopWithLinks(nodeId, stopId)) {
    snackbarText.value = '停靠点已删除，图片资产仍保留在资源库。'
    snackbarVisible.value = true
  }
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
  selectStop(stop.id)
  assetDialogStopId.value = stop.id
  assetDialogSelectedId.value = stop.thumbnailAssetId ?? ''
  assetDialogAnchor.value = { x: event.clientX, y: event.clientY }
  assetDialogVisible.value = true
}

function parseDraggedAssetId(dataTransfer: DataTransfer | null | undefined): string | null {
  const payload = dataTransfer?.getData(ASSET_DRAG_MIME)?.trim() ?? ''
  if (!payload) {
    return null
  }
  try {
    const parsed = JSON.parse(payload) as { assetId?: unknown }
    return typeof parsed.assetId === 'string' && parsed.assetId.trim()
      ? parsed.assetId.trim()
      : null
  } catch {
    return null
  }
}

function handleStopDragOver(event: DragEvent, stop: GuideRouteStop): void {
  if (!event.dataTransfer || !Array.from(event.dataTransfer.types ?? []).includes(ASSET_DRAG_MIME)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  event.dataTransfer.dropEffect = 'copy'
  stopDropTargetId.value = stop.id
}

function handleStopDragLeave(event: DragEvent, stop: GuideRouteStop): void {
  const related = event.relatedTarget
  if (related instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(related)) {
    return
  }
  if (stopDropTargetId.value === stop.id) {
    stopDropTargetId.value = null
  }
}

function handleStopDrop(event: DragEvent, stop: GuideRouteStop): void {
  event.preventDefault()
  event.stopPropagation()
  stopDropTargetId.value = null
  const assetId = parseDraggedAssetId(event.dataTransfer)
  const asset = assetId ? sceneStore.getAsset(assetId) : null
  if (!asset || (asset.type !== 'image' && asset.type !== 'texture')) {
    snackbarText.value = '只能将图片或纹理资产拖到停靠点。'
    snackbarVisible.value = true
    return
  }
  updateStop(stop.id, { thumbnailAssetId: asset.id })
  selectStop(stop.id)
}

function handleStopKeyboardDelete(event: KeyboardEvent): void {
  if (event.key !== 'Delete' && event.key !== 'Backspace') {
    return
  }
  const target = event.target as HTMLElement | null
  if (
    target
    && (
      target.isContentEditable
      || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
    )
  ) {
    return
  }
  const stop = selectedStop.value
  if (!stop) {
    return
  }
  event.preventDefault()
  requestDeleteStop(stop.id)
}

watch(
  () => [guideRouteStopSelectionRequestId.value, selectedGuideRouteStop.value?.stopId ?? null] as const,
  async ([, stopId]) => {
    if (!stopId) {
      return
    }
    await nextTick()
    stopCardElements.get(stopId)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    })
  },
)

onMounted(() => {
  window.addEventListener('keydown', handleStopKeyboardDelete)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleStopKeyboardDelete)
})

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

function isRoadBoundStop(stop: GuideRouteStop): boolean {
  return guideRouteProps.value?.legs.some((leg) => leg.id === stop.legId && leg.kind === 'road') === true
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
        <div class="gr-tool-hint">
          使用 Guide Route Tool：点击空白新建；点击线路创建或选择停靠点；手工路径可拖动；选中停靠点或端点后点击线路外继续建造。公路段和公路停靠点位置锁定。
        </div>
        <div v-if="guideRouteProps.origin" class="gr-source-note">
          自动公路路线 · {{ guideRouteProps.origin.providerNodeId }} · rev {{ guideRouteProps.origin.sourceRevision }}
        </div>
        <div v-if="guideRouteProps.branchOrigin" class="gr-source-note">
          分支来源 · {{ guideRouteProps.branchOrigin.routeNodeId }} / {{ guideRouteProps.branchOrigin.stopId }}
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
        <div
          v-for="stop in guideRouteProps.stops"
          :key="stop.id"
          :ref="(element) => setStopCardElement(stop.id, element as Element | null)"
          class="gr-card gr-stop-card"
          :class="{
            'is-selected': selectedStop?.id === stop.id,
            'is-drop-target': stopDropTargetId === stop.id,
          }"
          :data-stop-id="stop.id"
          role="button"
          tabindex="0"
          @click="selectStop(stop.id)"
          @keydown.enter.prevent="selectStop(stop.id)"
          @dragover="handleStopDragOver($event, stop)"
          @dragleave="handleStopDragLeave($event, stop)"
          @drop="handleStopDrop($event, stop)"
        >
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
            <v-btn
              icon
              size="x-small"
              variant="text"
              title="从场景删除该停靠点"
              @click.stop="requestDeleteStop(stop.id)"
            >
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
              :disabled="!componentEnabled || isRoadBoundStop(stop)"
              :title="isRoadBoundStop(stop) ? '公路停靠点位置由公路决定，不可拖动或数值修改' : undefined"
              @update:model-value="(value) => updateStopAnchor(stop, axis, value)"
            />
            <button
              type="button"
              class="gr-thumb"
              :class="{ 'is-drop-target': stopDropTargetId === stop.id }"
              title="点击选择图片，或从 AssetsPanel 拖入"
              :aria-label="`选择 ${stop.name || '停靠点'} 的景点缩略图`"
              @click.stop="openThumbnailPicker($event, stop)"
              @dragover="handleStopDragOver($event, stop)"
              @dragleave="handleStopDragLeave($event, stop)"
              @drop="handleStopDrop($event, stop)"
            >
              <img v-if="resolveWaypointThumbnail(stop.thumbnailAssetId)" :src="resolveWaypointThumbnail(stop.thumbnailAssetId) ?? undefined" alt="">
              <v-icon v-else size="18">mdi-image-plus-outline</v-icon>
            </button>
          </div>
          <div class="gr-stop-actions">
            <v-btn
              v-if="stop.thumbnailAssetId"
              size="x-small"
              variant="text"
              @click.stop="updateStop(stop.id, { thumbnailAssetId: null })"
            >
              清除缩略图引用
            </v-btn>
            <span class="gr-stop-anchor">
              {{ isRoadBoundStop(stop) ? '公路停靠点 · 位置锁定' : '路径控制点 · 可拖动' }}
            </span>
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
      <v-dialog v-model="deleteStopDialogVisible" max-width="440">
        <v-card title="删除停靠点">
          <v-card-text>
            确定删除“{{ pendingDeleteStop?.name || pendingDeleteStopId }}”及其缩略图引用、行为配置和路径控制点吗？图片资产不会从 AssetsPanel 删除，分支路线会保留并解除来源关联。
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="deleteStopDialogVisible = false">取消</v-btn>
            <v-btn color="error" variant="flat" @click="confirmDeleteStop">删除停靠点</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
      <v-snackbar v-model="snackbarVisible" :timeout="2600" location="bottom">
        {{ snackbarText }}
      </v-snackbar>
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
  flex-wrap: wrap;
}

.gr-inline-actions,
.gr-stop-actions {
  flex-wrap: wrap;
}

.gr-source-note {
  margin: 0.35rem 0 0.55rem;
  color: rgba(121, 224, 255, 0.86);
  font-size: 0.74rem;
}

.gr-tool-hint {
  margin-bottom: 0.7rem;
  color: rgba(255, 255, 255, 0.66);
  font-size: 0.72rem;
  line-height: 1.45;
}

.gr-stop-card {
  cursor: pointer;
  transition: border-color 0.16s ease, background-color 0.16s ease, box-shadow 0.16s ease;
}

.gr-stop-card.is-selected {
  border-color: rgba(86, 223, 255, 0.82);
  background: rgba(32, 112, 136, 0.2);
  box-shadow: 0 0 0 1px rgba(86, 223, 255, 0.25) inset;
}

.gr-stop-card.is-drop-target,
.gr-thumb.is-drop-target {
  border-color: rgba(255, 215, 92, 0.95);
  box-shadow: 0 0 0 2px rgba(255, 215, 92, 0.28);
}

.gr-stop-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.gr-stop-anchor {
  margin-left: auto;
  color: rgba(255, 255, 255, 0.56);
  font-size: 0.7rem;
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
  background: transparent;
  padding: 0;
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
