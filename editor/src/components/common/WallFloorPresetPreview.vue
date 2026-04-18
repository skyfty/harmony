<template>
  <div class="preset-preview">
    <div v-if="error" class="preset-preview__error">
      <v-icon size="40" color="error">mdi-alert-circle-outline</v-icon>
      <div class="preset-preview__error-text">{{ error }}</div>
    </div>
    <div v-else ref="container" class="preset-preview__canvas"></div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type {
  FloorDynamicMesh,
  SceneNode,
  SceneNodeMaterial,
} from '@schema'
import { FLOOR_COMPONENT_TYPE } from '@schema/components/definitions/floorComponent'
import { createLandformGroup } from '@schema/landformMesh'
import { applyMaterialOverrides } from '@schema/material'
import { createRoadGroup } from '@schema/roadMesh'
import { WALL_COMPONENT_TYPE } from '@schema/components/definitions/wallComponent'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { parseLandformPresetData } from '@/stores/landformPresetActions'
import { parseRoadPresetData } from '@/stores/roadPresetActions'
import { useSceneStore } from '@/stores/sceneStore'
import { parseFloorPresetData } from '@/stores/floorPresetActions'
import { parseWallPresetData } from '@/stores/wallPresetActions'
import { buildLandformNodeMaterialsFromPreset } from '@/utils/landformPresetNodeMaterials'
import type { LandformPresetData } from '@/utils/landformPreset'
import { buildLandformPresetPreviewDefinition } from '@/utils/landformPresetThumbnail'
import { buildRoadNodeMaterialsFromPreset } from '@/utils/roadPresetNodeMaterials'
import type { RoadPresetData } from '@/utils/roadPreset'
import { buildRoadPresetPreviewDefinition } from '@/utils/roadPresetThumbnail'
import {
  buildWallPresetPreviewDynamicMesh,
  WALL_PRESET_PREVIEW_SHARED_ASSET_USERDATA_KEY,
} from '@/utils/wallPresetSceneGraphPreview'
import { buildFloorNodeMaterialsFromPreset } from '@/utils/floorPresetNodeMaterials'
import {
  buildFloorPreviewObjectFromNode,
  buildWallPreviewObjectFromNode,
  createPreviewMaterialOverrideOptions,
} from '@/utils/wallFloorPreviewBuilder'
import { buildWallNodeMaterialsFromPreset } from '@/utils/wallPresetNodeMaterials'
import type { FloorPresetData } from '@/utils/floorPreset'
import type { WallPresetData } from '@/utils/wallPreset'

const props = defineProps<{
  file: File | null
  kind: 'wall' | 'floor' | 'road' | 'landform'
}>()

const emit = defineEmits<{
  (e: 'dimensions', payload: { length: number; width: number; height: number }): void
}>()

type ParsedPreset =
  | { kind: 'wall'; data: WallPresetData }
  | { kind: 'floor'; data: FloorPresetData }
  | { kind: 'road'; data: RoadPresetData }
  | { kind: 'landform'; data: LandformPresetData }

const DEFAULT_RECT_HALF_SIZE = 2

const container = ref<HTMLDivElement | null>(null)
const error = ref<string | null>(null)

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()

let renderer: THREE.WebGLRenderer | null = null
let camera: THREE.PerspectiveCamera | null = null
let scene: THREE.Scene | null = null
let controls: OrbitControls | null = null
let animationHandle = 0
let currentRoot: THREE.Object3D | null = null
let loadToken = 0
const previewInstanceId = THREE.MathUtils.generateUUID()
const WALL_PRESET_COMPONENT_LOG_PREFIX = '[WallFloorPresetPreview]'

function logWallPresetComponent(message: string, payload?: Record<string, unknown>): void {
  if (payload) {
    console.info(WALL_PRESET_COMPONENT_LOG_PREFIX, message, payload)
    return
  }
  console.info(WALL_PRESET_COMPONENT_LOG_PREFIX, message)
}

const materialOverrideOptions = createPreviewMaterialOverrideOptions(ensureAssetFile, (message) => {
  if (message) {
    console.warn('[preset-preview]', message)
  }
})

function fitCamera(object: THREE.Object3D): void {
  if (!camera || !controls) {
    return
  }
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) {
    camera.position.set(4, 3, 4)
    controls.target.set(0, 0, 0)
    controls.update()
    return
  }
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  const fov = THREE.MathUtils.degToRad(camera.fov)
  const distance = maxDim === 0 ? 5 : maxDim / (2 * Math.tan(fov / 2))
  const offset = distance * 1.5
  camera.position.set(center.x + offset, center.y + offset * 0.85, center.z + offset)
  camera.near = Math.max(0.1, distance / 100)
  camera.far = Math.max(distance * 100, 100)
  camera.updateProjectionMatrix()
  controls.target.copy(center)
  controls.update()
}

function emitDimensions(object: THREE.Object3D | null): void {
  if (!object) {
    return
  }
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) {
    return
  }
  const size = box.getSize(new THREE.Vector3())
  emit('dimensions', {
    length: Number.isFinite(size.x) ? size.x : 0,
    width: Number.isFinite(size.z) ? size.z : 0,
    height: Number.isFinite(size.y) ? size.y : 0,
  })
}

function disposeObject(object: THREE.Object3D | null): void {
  if (!object) {
    return
  }
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    const isSharedPreviewAsset = Boolean((mesh.userData as Record<string, unknown> | undefined)?.[WALL_PRESET_PREVIEW_SHARED_ASSET_USERDATA_KEY])
    if (!isSharedPreviewAsset) {
      mesh.geometry?.dispose?.()
    }
    const material = mesh.material
    if (Array.isArray(material)) {
      material.forEach((entry) => entry?.dispose?.())
    } else {
      material?.dispose?.()
    }
  })
}

function clearScene(): void {
  error.value = null
  if (scene && currentRoot) {
    scene.remove(currentRoot)
  }
  disposeObject(currentRoot)
  currentRoot = null
}

async function ensureAssetFile(assetId: string): Promise<File | null> {
  const asset = sceneStore.getAsset(assetId)
  let file = await assetCacheStore.ensureAssetFile(assetId, { asset })
  if (file) {
    logWallPresetComponent('asset file resolved from memory cache', { assetId, fileName: file.name })
    return file
  }
  if (!asset) {
    logWallPresetComponent('asset metadata missing', { assetId })
    return null
  }
  logWallPresetComponent('asset file unavailable after ensure', { assetId })
  return null
}

async function parsePreset(file: File): Promise<ParsedPreset> {
  const text = await file.text()
  if (props.kind === 'wall') {
    return { kind: 'wall', data: parseWallPresetData(text) }
  }
  if (props.kind === 'road') {
    return { kind: 'road', data: parseRoadPresetData(text) }
  }
  if (props.kind === 'landform') {
    return { kind: 'landform', data: parseLandformPresetData(text) }
  }
  return { kind: 'floor', data: parseFloorPresetData(text) }
}

function buildDefaultFloorDefinition(preset: FloorPresetData): FloorDynamicMesh {
  return {
    type: 'Floor',
    vertices: [
      [-DEFAULT_RECT_HALF_SIZE, -DEFAULT_RECT_HALF_SIZE],
      [-DEFAULT_RECT_HALF_SIZE, DEFAULT_RECT_HALF_SIZE],
      [DEFAULT_RECT_HALF_SIZE, DEFAULT_RECT_HALF_SIZE],
      [DEFAULT_RECT_HALF_SIZE, -DEFAULT_RECT_HALF_SIZE],
    ],
    topBottomMaterialConfigId: preset.materialConfig.topBottomMaterialConfigId,
    sideMaterialConfigId: preset.materialConfig.sideMaterialConfigId,
    smooth: preset.floorProps.smooth,
    thickness: preset.floorProps.thickness,
    sideUvScale: {
      x: preset.floorProps.sideUvScale.x,
      y: preset.floorProps.sideUvScale.y,
    },
  }
}

function createPreviewBaseNode(name: string): SceneNode {
  return {
    id: `${props.kind}-preset-preview-${previewInstanceId}`,
    name,
    nodeType: 'Mesh',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    children: [],
  }
}

function buildWallPreviewNode(preset: WallPresetData): SceneNode {
  return {
    ...createPreviewBaseNode(preset.name || 'Wall Preset Preview'),
    dynamicMesh: buildWallPresetPreviewDynamicMesh(preset, { rectSizeMeters: 10 }),
    materials: buildWallNodeMaterialsFromPreset(preset),
    components: {
      [WALL_COMPONENT_TYPE]: {
        id: `${WALL_COMPONENT_TYPE}-preset-preview-${previewInstanceId}`,
        type: WALL_COMPONENT_TYPE,
        enabled: true,
        props: preset.wallProps,
      },
    },
  }
}

function buildFloorPreviewNode(preset: FloorPresetData): SceneNode {
  return {
    ...createPreviewBaseNode(preset.name || 'Floor Preset Preview'),
    dynamicMesh: buildDefaultFloorDefinition(preset),
    materials: buildFloorNodeMaterialsFromPreset(preset),
    components: {
      [FLOOR_COMPONENT_TYPE]: {
        id: `${FLOOR_COMPONENT_TYPE}-preset-preview-${previewInstanceId}`,
        type: FLOOR_COMPONENT_TYPE,
        enabled: true,
        props: preset.floorProps,
      },
    },
  }
}

async function buildWallPreviewObject(preset: WallPresetData): Promise<THREE.Object3D> {
  const object = await buildWallPreviewObjectFromNode({
    node: buildWallPreviewNode(preset),
    resolveAssetFile: ensureAssetFile,
    materialOverrideOptions,
  })
  if (!object) {
    throw new Error('无法构建墙体预览对象')
  }
  return object
}

async function buildFloorPreviewObject(preset: FloorPresetData): Promise<THREE.Object3D> {
  logWallPresetComponent('building floor preset preview', {
    presetName: preset.name,
    materialConfig: preset.materialConfig,
    materialOrder: preset.materialOrder,
    assetRegistryKeys: Object.keys((preset.assetRegistry ?? {}) as Record<string, unknown>),
  })

  const object = await buildFloorPreviewObjectFromNode({
    node: buildFloorPreviewNode(preset),
    materialOverrideOptions,
  })
  if (!object) {
    throw new Error('无法构建地面预览对象')
  }
  return object
}

async function buildRoadPreviewObject(preset: RoadPresetData): Promise<THREE.Object3D> {
  const object = createRoadGroup(buildRoadPresetPreviewDefinition(preset), {
    junctionSmoothing: preset.roadProps.junctionSmoothing,
    laneLines: preset.roadProps.laneLines,
    shoulders: preset.roadProps.shoulders,
    materialConfigId: preset.materialOrder?.[0] ?? null,
    samplingDensityFactor: preset.roadProps.samplingDensityFactor,
    smoothingStrengthFactor: preset.roadProps.smoothingStrengthFactor,
    minClearance: preset.roadProps.minClearance,
    laneLineWidth: preset.roadProps.laneLineWidth,
    shoulderWidth: preset.roadProps.shoulderWidth,
  })
  object.name = preset.name || 'Road Preset Preview'

  const nodeMaterials = buildRoadNodeMaterialsFromPreset(preset)
  if (nodeMaterials.length > 0) {
    applyMaterialOverrides(object, nodeMaterials, materialOverrideOptions)
  }

  return object
}

async function buildLandformPreviewObject(preset: LandformPresetData): Promise<THREE.Object3D> {
  const object = createLandformGroup(buildLandformPresetPreviewDefinition(preset))
  object.name = preset.name || 'Landform Preset Preview'
  object.rotation.x = -0.08

  const nodeMaterials = buildLandformNodeMaterialsFromPreset(preset).filter(
    (entry): entry is SceneNodeMaterial => Boolean(entry),
  )
  if (nodeMaterials.length > 0) {
    applyMaterialOverrides(object, nodeMaterials, materialOverrideOptions)
  }

  return object
}

async function loadPresetScene(): Promise<void> {
  const token = ++loadToken
  clearScene()

  if (!scene || !camera || !controls || !props.file) {
    return
  }

  try {
    const parsed = await parsePreset(props.file)
    if (token !== loadToken) {
      return
    }

    let object: THREE.Object3D
    switch (parsed.kind) {
      case 'wall':
        object = await buildWallPreviewObject(parsed.data)
        break
      case 'road':
        object = await buildRoadPreviewObject(parsed.data)
        break
      case 'landform':
        object = await buildLandformPreviewObject(parsed.data)
        break
      case 'floor':
      default:
        object = await buildFloorPreviewObject(parsed.data)
        break
    }

    if (token !== loadToken) {
      disposeObject(object)
      return
    }

    currentRoot = object
    scene.add(object)
    fitCamera(object)
    emitDimensions(object)
  } catch (loadError) {
    if (token === loadToken) {
      console.warn(WALL_PRESET_COMPONENT_LOG_PREFIX, 'loadPresetScene failed', loadError)
      error.value = (loadError as Error).message ?? '预览生成失败'
    }
  }
}

function renderLoop(): void {
  if (!renderer || !scene || !camera) {
    return
  }
  controls?.update()
  renderer.render(scene, camera)
  animationHandle = requestAnimationFrame(renderLoop)
}

function handleResize(): void {
  if (!renderer || !camera || !container.value) {
    return
  }
  const { clientWidth, clientHeight } = container.value
  renderer.setSize(clientWidth, clientHeight, false)
  renderer.setPixelRatio(window.devicePixelRatio)
  camera.aspect = clientWidth / Math.max(clientHeight, 1)
  camera.updateProjectionMatrix()
}

function setupScene(): void {
  if (!container.value) {
    return
  }
  scene = new THREE.Scene()
  scene.background = null

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
  camera.position.set(5, 4, 5)

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.setSize(container.value.clientWidth, container.value.clientHeight)
  renderer.setClearColor(0x000000, 0)
  container.value.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = false
  controls.dampingFactor = 0.05

  const ambient = new THREE.AmbientLight(0xffffff, 1.5)
  const directional = new THREE.DirectionalLight(0xffffff, 2)
  directional.position.set(5, 10, 7.5)
  const fillLight = new THREE.DirectionalLight(0xffffff, 1)
  fillLight.position.set(-5, 2, -6)
  scene.add(ambient)
  scene.add(directional)
  scene.add(fillLight)

  window.addEventListener('resize', handleResize)
  handleResize()
  renderLoop()
}

watch(
  () => [props.file, props.kind],
  () => {
    void loadPresetScene()
  },
  { immediate: true },
)

onMounted(() => {
  setupScene()
  if (props.file) {
    void loadPresetScene()
  }
})

onBeforeUnmount(() => {
  loadToken += 1
  cancelAnimationFrame(animationHandle)
  window.removeEventListener('resize', handleResize)
  clearScene()
  controls?.dispose()
  controls = null
  renderer?.dispose()
  renderer = null
  scene = null
  camera = null
})

async function captureSnapshot(): Promise<HTMLCanvasElement | null> {
  if (!renderer) {
    return null
  }
  const source = renderer.domElement
  if (!source.width || !source.height || error.value) {
    return null
  }
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }
  context.drawImage(source, 0, 0)
  return canvas
}

defineExpose({
  captureSnapshot,
})
</script>

<style scoped>
.preset-preview {
  width: 100%;
  height: 100%;
  min-height: 260px;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(15, 18, 24, 0.92);
}

.preset-preview__canvas,
.preset-preview__canvas canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
}

.preset-preview__error {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.92);
  text-align: center;
  padding: 20px;
}

.preset-preview__error-text {
  font-size: 0.95rem;
}
</style>
