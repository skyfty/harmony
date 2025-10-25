<script setup lang="ts">
import { computed, ref } from 'vue'
import { OrbitControls, Stats } from '@tresjs/cientos'
import type { Color, Vector3 } from 'three'
import type { TresLightNode, TresPrimitiveNode, TresSceneNode } from '@/stores/tresSceneStore'

const props = withDefaults(defineProps<{
  nodes: TresSceneNode[]
  selectedNodeId: string | null
  showGrid?: boolean
  showHelpers?: boolean
  backgroundColor?: string
  environmentIntensity?: number
}>(), {
  showGrid: true,
  showHelpers: true,
  backgroundColor: '#1a1d24',
  environmentIntensity: 0.75,
})

const emit = defineEmits<{
  (event: 'select', nodeId: string | null): void
}>()

const hoveredNodeId = ref<string | null>(null)

const primitiveNodes = computed(() => props.nodes.filter((node): node is TresPrimitiveNode => node.kind === 'primitive'))
const lightNodes = computed(() => props.nodes.filter((node): node is TresLightNode => node.kind === 'light'))

const hasAmbientLight = computed(() => lightNodes.value.some((light) => light.light === 'ambient'))

const cameraPosition: [number, number, number] = [6, 5, 7]
const cameraTarget: [number, number, number] = [0, 1, 0]
const fallbackDirectionalPosition: [number, number, number] = [5, 8, 5]
const fogColor = '#1a1d24'
const hemisphereSkyColor = '#f7f6f4'
const hemisphereGroundColor = '#101318'
const fallbackDirectionalColor = '#ffffff'

function asVector(tuple: [number, number, number]): Vector3 {
  return tuple as unknown as Vector3
}

function asColor(value: string): Color {
  return value as unknown as Color
}

function geometryComponent(node: TresPrimitiveNode) {
  switch (node.primitive) {
    case 'sphere':
      return 'TresSphereGeometry'
    case 'plane':
      return 'TresPlaneGeometry'
    case 'cylinder':
      return 'TresCylinderGeometry'
    case 'box':
    default:
      return 'TresBoxGeometry'
  }
}

function geometryProps(node: TresPrimitiveNode) {
  switch (node.primitive) {
    case 'sphere':
      return { args: [0.5, 32, 32] }
    case 'plane':
      return { args: [1, 1, 1, 1] }
    case 'cylinder':
      return { args: [0.5, 0.5, 1, 32] }
    case 'box':
    default:
      return { args: [1, 1, 1] }
  }
}

function lightComponent(node: TresLightNode) {
  switch (node.light) {
    case 'directional':
      return 'TresDirectionalLight'
    case 'hemisphere':
      return 'TresHemisphereLight'
    case 'ambient':
    default:
      return 'TresAmbientLight'
  }
}

function lightProps(node: TresLightNode) {
  const base: Record<string, unknown> = {
    intensity: node.intensity,
    color: asColor(node.color),
  }
  if (node.light !== 'ambient') {
    base.position = asVector(node.position)
  }
  if (node.light === 'directional') {
    base.castShadow = node.castShadow
  }
  if (node.light === 'hemisphere') {
    base.groundColor = asColor(hemisphereGroundColor)
  }
  return base
}

function handleSelect(nodeId: string | null) {
  emit('select', nodeId)
}

function handlePointerMissed() {
  emit('select', null)
}

function meshColor(node: TresPrimitiveNode) {
  if (props.selectedNodeId === node.id) {
    return '#ffb960'
  }
  if (hoveredNodeId.value === node.id) {
    return '#c7d5ff'
  }
  return node.color
}

</script>

<template>
  <div class="tres-viewport">
    <TresCanvas
      class="tres-viewport__canvas"
      :clear-color="backgroundColor"
      shadows
      :antialias="true"
      @pointer-missed="handlePointerMissed"
    >
      <TresPerspectiveCamera :position="asVector(cameraPosition)" :look-at="asVector(cameraTarget)" :fov="45" />
      <OrbitControls make-default :max-distance="32" :min-distance="2" />
      <Stats class="tres-viewport__stats" />

      <TresHemisphereLight :intensity="0.35 * environmentIntensity" :color="asColor(hemisphereSkyColor)" :ground-color="asColor(hemisphereGroundColor)" />
      <TresAmbientLight v-if="!hasAmbientLight" :intensity="0.25 * environmentIntensity" :color="asColor('#ffffff')" />
      <TresDirectionalLight
        v-if="!lightNodes.length"
        :position="asVector(fallbackDirectionalPosition)"
        :intensity="1.1 * environmentIntensity"
        :color="asColor(fallbackDirectionalColor)"
        :cast-shadow="true"
      />

      <template v-for="light in lightNodes" :key="light.id">
        <component
          :is="lightComponent(light)"
          v-bind="lightProps(light)"
          v-if="light.visible"
        />
      </template>

      <template v-for="node in primitiveNodes" :key="node.id">
        <TresMesh
          :position="asVector(node.position)"
          :rotation="node.rotation"
          :scale="asVector(node.scale)"
          :visible="node.visible"
          :cast-shadow="node.castShadow"
          :receive-shadow="node.receiveShadow"
          @pointerdown.stop="handleSelect(node.id)"
          @pointerenter="hoveredNodeId = node.id"
          @pointerleave="hoveredNodeId = hoveredNodeId === node.id ? null : hoveredNodeId"
        >
          <component :is="geometryComponent(node)" v-bind="geometryProps(node)" />
          <TresMeshStandardMaterial
            :color="asColor(meshColor(node))"
            :metalness="node.metalness"
            :roughness="node.roughness"
          />
        </TresMesh>
      </template>

      <TresGridHelper v-if="showGrid" :args="[30, 30, '#444b5c', '#5d6a82']" />
      <TresAxesHelper v-if="showHelpers" :args="[1.5]" />
      <TresFogExp2 attach="fog" :density="0.008" :color="asColor(fogColor)" />
    </TresCanvas>
  </div>
</template>

<style scoped>
.tres-viewport {
  position: relative;
  inset: 0;
  width: 100%;
  height: 100%;
  background: #10131a;
  border-radius: 14px;
  overflow: hidden;
}

.tres-viewport__canvas {
  width: 100%;
  height: 100%;
}

.tres-viewport__stats {
  position: absolute;
  top: 12px;
  left: 12px;
}
</style>
