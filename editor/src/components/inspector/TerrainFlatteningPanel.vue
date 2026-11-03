<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema/core'
import {
  TERRAIN_FLATTENING_COMPONENT_TYPE,
  type TerrainFlatteningComponentProps,
} from '@schema/components'
import {
  TERRAIN_FLATTENING_MAX_CORRIDOR_WIDTH,
  TERRAIN_FLATTENING_MAX_EDGE_BLEND_WIDTH,
  TERRAIN_FLATTENING_MIN_CORRIDOR_WIDTH,
  TERRAIN_FLATTENING_MIN_EDGE_BLEND_WIDTH,
  buildLandscapeTerrainFlatteningOwnerSnapshot,
  clampTerrainFlatteningComponentProps,
  collectTerrainFlatteningRoadProbes,
  collectTerrainFlatteningSamplePoints,
  resolveTerrainFlatteningOwnerReferenceWorldY,
} from '@schema/proceduralLandscape/terrainFlattening'
import { collectActiveProceduralLandscapeNodeIds } from '@schema/proceduralLandscape/preload'
import {
  resolveProceduralLandscapeNearestRoadConnection,
  sampleProceduralLandscapeTerrainHeight,
} from '@schema/proceduralLandscape/runtime'
import { getRuntimeObject, useSceneStore } from '@/stores/sceneStore'

const sceneStore = useSceneStore()
const { nodes, selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const component = computed(
  () =>
    selectedNode.value?.components?.[TERRAIN_FLATTENING_COMPONENT_TYPE] as
      | SceneNodeComponentState<TerrainFlatteningComponentProps>
      | undefined,
)
const componentEnabled = computed(() => component.value?.enabled !== false)
const propsValue = computed(() => (
  clampTerrainFlatteningComponentProps(component.value?.props ?? null)
))
const ownerType = computed(() => selectedNode.value?.dynamicMesh?.type ?? null)
const isWall = computed(() => ownerType.value === 'Wall')
const runtimeObject = computed(() => (
  selectedNodeId.value ? getRuntimeObject(selectedNodeId.value) : null
))
const ownerHeight = computed(() => (
  resolveTerrainFlatteningOwnerReferenceWorldY(selectedNode.value, runtimeObject.value)
))
const snapshotResult = computed(() => {
  const node = selectedNode.value
  const object = runtimeObject.value
  if (!node || !object || !component.value) {
    return null
  }
  return buildLandscapeTerrainFlatteningOwnerSnapshot({
    id: `${node.id}:${component.value.id}`,
    node,
    object,
    props: propsValue.value,
    componentId: component.value.id,
  })
})
const effectiveHeight = computed(() => (
  propsValue.value.heightMode === 'manual'
    ? propsValue.value.manualHeight
    : ownerHeight.value
))
const localManualHeight = ref(effectiveHeight.value ?? 0)
const feedbackMessage = ref<string | null>(null)
const warningMessage = computed(() => {
  const code = snapshotResult.value?.warningCode
  if (!code) {
    return null
  }
  switch (code) {
    case 'owner-not-visible':
      return 'The owner node is hidden.'
    case 'invalid-height':
      return 'A valid owner elevation could not be resolved.'
    case 'invalid-footprint':
      return 'The owner node has no valid terrain footprint.'
    default:
      return code
  }
})
const collisionAuthority = computed(() => snapshotResult.value?.snapshot?.collisionAuthority ?? null)
const collisionAuthorityLabel = computed(() => {
  if (collisionAuthority.value === 'rigidbody') {
    return 'Rigidbody'
  }
  if (collisionAuthority.value === 'generated-terrain') {
    return 'Terrain'
  }
  return 'Unavailable'
})

watch(
  [() => propsValue.value.manualHeight, effectiveHeight],
  () => {
    localManualHeight.value = effectiveHeight.value ?? propsValue.value.manualHeight
  },
  { immediate: true },
)

watch(selectedNode, () => {
  feedbackMessage.value = null
})

function updateProps(patch: Partial<TerrainFlatteningComponentProps>): void {
  const nodeId = selectedNodeId.value
  const current = component.value
  if (!nodeId || !current) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, current.id, patch)
}

function setHeightMode(heightMode: 'owner' | 'manual'): void {
  if (heightMode === 'manual') {
    const nextHeight = ownerHeight.value ?? propsValue.value.manualHeight
    localManualHeight.value = nextHeight
    updateProps({
      heightMode,
      manualHeight: nextHeight,
    })
    return
  }
  updateProps({ heightMode })
}

function applyManualHeight(): void {
  const numeric = Number(localManualHeight.value)
  if (!Number.isFinite(numeric)) {
    localManualHeight.value = propsValue.value.manualHeight
    return
  }
  updateProps({
    heightMode: 'manual',
    manualHeight: numeric,
  })
}

function sampleTerrainMedian(): void {
  const node = selectedNode.value
  const object = runtimeObject.value
  const current = component.value
  if (!node || !object || !current) {
    feedbackMessage.value = 'The owner footprint is not available.'
    return
  }
  const preview = buildLandscapeTerrainFlatteningOwnerSnapshot({
    id: `${node.id}:${current.id}`,
    node,
    object,
    props: {
      ...propsValue.value,
      heightMode: 'manual',
    },
    componentId: current.id,
  })
  const footprint = preview.snapshot?.footprint
  if (!footprint) {
    feedbackMessage.value = 'The owner footprint is not valid.'
    return
  }
  const landscapeIds = collectActiveProceduralLandscapeNodeIds(nodes.value)
  if (!landscapeIds.length) {
    feedbackMessage.value = 'No Procedural Landscape provider is available.'
    return
  }
  const samples = collectTerrainFlatteningSamplePoints(footprint)
  const heights: number[] = []
  samples.forEach(([x, z]) => {
    landscapeIds.forEach((nodeId) => {
      const height = sampleProceduralLandscapeTerrainHeight(nodeId, x, z)
      if (height != null && Number.isFinite(height)) {
        heights.push(height)
      }
    })
  })
  if (!heights.length) {
    feedbackMessage.value = 'No DEM height samples were available inside the footprint.'
    return
  }
  heights.sort((a, b) => a - b)
  const median = heights[Math.floor(heights.length / 2)]!
  localManualHeight.value = median
  updateProps({
    heightMode: 'manual',
    manualHeight: median,
  })
  feedbackMessage.value = `Applied terrain median ${median.toFixed(2)}m from ${heights.length} samples.`
}

function matchNearestRoad(): void {
  const node = selectedNode.value
  const object = runtimeObject.value
  const current = component.value
  if (!node || !object || !current) {
    feedbackMessage.value = 'The owner footprint is not available.'
    return
  }
  const preview = buildLandscapeTerrainFlatteningOwnerSnapshot({
    id: `${node.id}:${current.id}`,
    node,
    object,
    props: {
      ...propsValue.value,
      heightMode: 'manual',
    },
    componentId: current.id,
  })
  const footprint = preview.snapshot?.footprint
  if (!footprint) {
    feedbackMessage.value = 'The owner footprint is not valid.'
    return
  }
  const landscapeIds = collectActiveProceduralLandscapeNodeIds(nodes.value)
  if (!landscapeIds.length) {
    feedbackMessage.value = 'No Procedural Landscape provider is available.'
    return
  }
  let best: {
    connection: NonNullable<ReturnType<typeof resolveProceduralLandscapeNearestRoadConnection>>
  } | null = null
  const probes = collectTerrainFlatteningRoadProbes(footprint)
  for (const nodeId of landscapeIds) {
    for (const [x, z] of probes) {
      const connection = resolveProceduralLandscapeNearestRoadConnection(nodeId, x, z)
      if (connection && (!best || connection.distance < best.connection.distance)) {
        best = { connection }
      }
    }
  }
  if (!best) {
    feedbackMessage.value = 'No generated road is available for elevation matching.'
    return
  }
  const allowedDistance = Math.max(5, propsValue.value.edgeBlendWidth + 2)
  if (best.connection.distance > allowedDistance) {
    feedbackMessage.value = `Nearest road is ${best.connection.distance.toFixed(1)}m away; connect the road to this footprint first.`
    return
  }
  const manualHeight = best.connection.y - 0.02
  localManualHeight.value = manualHeight
  updateProps({
    heightMode: 'manual',
    manualHeight,
  })
  feedbackMessage.value = `Matched road surface at ${best.connection.y.toFixed(2)}m (${best.connection.distance.toFixed(1)}m offset).`
}

function toggleComponent(): void {
  const nodeId = selectedNodeId.value
  const current = component.value
  if (nodeId && current) {
    sceneStore.toggleNodeComponentEnabled(nodeId, current.id)
  }
}

function removeComponent(): void {
  const nodeId = selectedNodeId.value
  const current = component.value
  if (nodeId && current) {
    sceneStore.removeNodeComponent(nodeId, current.id)
  }
}
</script>

<template>
  <v-expansion-panel :value="TERRAIN_FLATTENING_COMPONENT_TYPE">
    <v-expansion-panel-title>
      <div class="terrain-flattening-panel__header">
        <span class="terrain-flattening-panel__title">Terrain Flattening</span>
        <v-spacer />
        <v-menu v-if="component" location="bottom end" origin="auto" transition="fade-transition">
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
            <v-list-item @click.stop="toggleComponent">
              <v-list-item-title>{{ componentEnabled ? 'Disable' : 'Enable' }}</v-list-item-title>
            </v-list-item>
            <v-divider class="component-menu-divider" inset />
            <v-list-item @click.stop="removeComponent">
              <v-list-item-title>Remove</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="terrain-flattening-panel__content" :class="{ 'is-disabled': !componentEnabled }">
        <div class="terrain-flattening-panel__status">
          <span>{{ ownerType }}</span>
          <span v-if="ownerHeight !== null">Owner {{ ownerHeight.toFixed(2) }}m</span>
          <span>Collision source: {{ collisionAuthorityLabel }}</span>
        </div>

        <div class="terrain-flattening-panel__label">Target elevation</div>
        <v-btn-toggle
          :model-value="propsValue.heightMode"
          mandatory
          divided
          density="compact"
          color="primary"
          @update:model-value="(value) => setHeightMode(value === 'manual' ? 'manual' : 'owner')"
        >
          <v-btn value="owner" size="small">Follow owner</v-btn>
          <v-btn value="manual" size="small">Manual</v-btn>
        </v-btn-toggle>

        <v-text-field
          v-model.number="localManualHeight"
          label="Target height (world m)"
          type="number"
          density="compact"
          variant="underlined"
          inputmode="decimal"
          step="0.1"
          :disabled="!componentEnabled || propsValue.heightMode === 'owner'"
          @blur="applyManualHeight"
          @keydown.enter.prevent="applyManualHeight"
        />

        <div class="terrain-flattening-panel__actions">
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-image-filter-hdr"
            :disabled="!componentEnabled"
            @click="sampleTerrainMedian"
          >
            Terrain median
          </v-btn>
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-road-variant"
            :disabled="!componentEnabled"
            @click="matchNearestRoad"
          >
            Match road
          </v-btn>
        </div>

        <div class="terrain-flattening-panel__label">Edge</div>
        <v-btn-toggle
          :model-value="propsValue.edgeMode"
          mandatory
          divided
          density="compact"
          color="primary"
          :disabled="!componentEnabled"
          @update:model-value="(value) => updateProps({ edgeMode: value === 'wall' ? 'wall' : 'slope' })"
        >
          <v-btn value="slope" size="small">Natural slope</v-btn>
          <v-btn value="wall" size="small">Vertical cut</v-btn>
        </v-btn-toggle>

        <v-text-field
          :model-value="propsValue.edgeBlendWidth"
          label="Slope transition (m)"
          type="number"
          density="compact"
          variant="underlined"
          inputmode="decimal"
          :disabled="!componentEnabled || propsValue.edgeMode === 'wall'"
          :min="TERRAIN_FLATTENING_MIN_EDGE_BLEND_WIDTH"
          :max="TERRAIN_FLATTENING_MAX_EDGE_BLEND_WIDTH"
          step="0.5"
          @update:model-value="(value) => updateProps({ edgeBlendWidth: Number(value) })"
        />

        <v-text-field
          v-if="isWall"
          :model-value="propsValue.corridorWidth"
          label="Wall corridor width (m)"
          type="number"
          density="compact"
          variant="underlined"
          inputmode="decimal"
          :disabled="!componentEnabled"
          :min="TERRAIN_FLATTENING_MIN_CORRIDOR_WIDTH"
          :max="TERRAIN_FLATTENING_MAX_CORRIDOR_WIDTH"
          step="0.5"
          @update:model-value="(value) => updateProps({ corridorWidth: Number(value) })"
        />

        <v-checkbox
          :model-value="propsValue.autoClearVegetation"
          label="Clear trees, grass and bushes"
          density="compact"
          hide-details
          :disabled="!componentEnabled"
          @update:model-value="(value) => updateProps({ autoClearVegetation: value === true })"
        />

        <p v-if="warningMessage" class="terrain-flattening-panel__warning">{{ warningMessage }}</p>
        <p v-if="feedbackMessage" class="terrain-flattening-panel__feedback">{{ feedbackMessage }}</p>
        <p class="terrain-flattening-panel__hint">
          Floor and Region flatten their full polygon. Wall flattens a corridor around every wall chain.
          Owner nodes are never moved or rotated by this component. A static Rigidbody owns collision
          inside the footprint; generated DEM collision stays below it and outside the footprint.
          Do not add a Ground Collision Source for the same Rigidbody surface.
        </p>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.terrain-flattening-panel__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.terrain-flattening-panel__title {
  font-weight: 600;
}

.terrain-flattening-panel__content {
  display: grid;
  gap: 0.65rem;
}

.terrain-flattening-panel__content.is-disabled {
  opacity: 0.55;
}

.terrain-flattening-panel__status {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.25rem 0.75rem;
  font-size: 0.76rem;
  color: rgba(233, 236, 241, 0.72);
  font-variant-numeric: tabular-nums;
}

.terrain-flattening-panel__label {
  font-size: 0.76rem;
  opacity: 0.82;
}

.terrain-flattening-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.terrain-flattening-panel__hint,
.terrain-flattening-panel__feedback,
.terrain-flattening-panel__warning {
  margin: 0;
  font-size: 0.74rem;
  line-height: 1.45;
}

.terrain-flattening-panel__hint {
  color: rgba(233, 236, 241, 0.66);
}

.terrain-flattening-panel__feedback {
  color: #67e8f9;
}

.terrain-flattening-panel__warning {
  color: #fbbf24;
}
</style>
