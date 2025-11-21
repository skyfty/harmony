<template>
  <div ref="container" class="preset-preview"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { AssetCache, AssetLoader } from '@schema/assetCache'
import ResourceCache from '@schema/ResourceCache'
import { buildSceneGraph, type SceneGraphBuildOptions } from '@schema/sceneGraph'
import type { SceneJsonExportDocument, SceneSkyboxSettings } from '@harmony/schema'
import { normalizeSkyboxSettings } from '@/stores/skyboxPresets'

const props = defineProps<{
  file: File | null
  background?: string
}>()

const emit = defineEmits<{
  (e: 'dimensions', payload: { length: number; width: number; height: number }): void
}>()

const container = ref<HTMLDivElement | null>(null)

let renderer: THREE.WebGLRenderer | null = null
let camera: THREE.PerspectiveCamera | null = null
let scene: THREE.Scene | null = null
let controls: OrbitControls | null = null
let animationHandle = 0
let currentRoot: THREE.Object3D | null = null
let loadToken = 0

const assetCache = new AssetCache({ maxEntries: 48 })
const assetLoader = new AssetLoader(assetCache)

function disposeObject(object: THREE.Object3D | null): void {
  if (!object) {
    return
  }
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh) {
      mesh.geometry?.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach((mat) => {
        if (!mat) {
          return
        }
        disposeMaterialTextures(mat)
        mat.dispose?.()
      })
    }
  })
}

function disposeMaterialTextures(material: THREE.Material | null | undefined): void {
  if (!material) {
    return
  }
  const typed = material as THREE.Material & {
    map?: THREE.Texture | null
    envMap?: THREE.Texture | null
    normalMap?: THREE.Texture | null
    metalnessMap?: THREE.Texture | null
    roughnessMap?: THREE.Texture | null
    aoMap?: THREE.Texture | null
    emissiveMap?: THREE.Texture | null
  }
  const textureKeys: Array<keyof typeof typed> = [
    'map',
    'envMap',
    'normalMap',
    'metalnessMap',
    'roughnessMap',
    'aoMap',
    'emissiveMap',
  ]
  textureKeys.forEach((key) => {
    const texture = typed[key]
    if (texture && texture instanceof THREE.Texture) {
      texture.dispose()
      typed[key] = null as any
    }
  })
}

function clearScene(): void {
  if (!scene) {
    return
  }
  if (currentRoot) {
    scene.remove(currentRoot)
    disposeObject(currentRoot)
    currentRoot = null
  }
}

function fitCamera(object: THREE.Object3D): void {
  if (!camera || !controls) {
    return
  }
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) {
    camera.position.set(3, 3, 3)
    controls.target.set(0, 0, 0)
    controls.update()
    return
  }
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  const fov = THREE.MathUtils.degToRad(camera.fov)
  const distance = maxDim === 0 ? 5 : maxDim / (2 * Math.tan(fov / 2))
  const offset = distance * 1.4
  camera.position.set(center.x + offset, center.y + offset, center.z + offset)
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
  const length = Number.isFinite(size.x) ? size.x : 0
  const width = Number.isFinite(size.z) ? size.z : 0
  const height = Number.isFinite(size.y) ? size.y : 0
  emit('dimensions', { length, width, height })
}

function generatePreviewId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `preset-preview-${crypto.randomUUID()}`
  }
  return `preset-preview-${Date.now()}`
}

function normalizeSceneDocument(raw: unknown): SceneJsonExportDocument {
  const candidate = raw && typeof raw === 'object' && raw !== null && 'document' in raw
    ? (raw as { document: unknown }).document
    : raw
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('预置场景文件格式不正确')
  }
  const base = candidate as Record<string, unknown>
  const now = new Date().toISOString()
  const id = typeof base.id === 'string' && base.id.trim().length ? base.id.trim() : generatePreviewId()
  const name = typeof base.name === 'string' && base.name.trim().length ? base.name.trim() : 'Preset Preview'
  const skybox = normalizeSkyboxSettings(base.skybox as Partial<SceneSkyboxSettings> | undefined)
  const createdAt = typeof base.createdAt === 'string' ? base.createdAt : now
  const updatedAt = typeof base.updatedAt === 'string' ? base.updatedAt : createdAt

  const nodes = Array.isArray(base.nodes) ? (base.nodes as SceneJsonExportDocument['nodes']) : []
  const materials = Array.isArray(base.materials) ? (base.materials as SceneJsonExportDocument['materials']) : []
  const groundSettings = typeof base.groundSettings === 'object' && base.groundSettings
    ? (base.groundSettings as SceneJsonExportDocument['groundSettings'])
    : undefined
  const outlineMeshMap = typeof base.outlineMeshMap === 'object' && base.outlineMeshMap
    ? (base.outlineMeshMap as SceneJsonExportDocument['outlineMeshMap'])
    : undefined
  const assetIndex = typeof base.assetIndex === 'object' && base.assetIndex
    ? (base.assetIndex as Record<string, unknown>)
    : {}
  const packageAssetMap = typeof base.packageAssetMap === 'object' && base.packageAssetMap
    ? (base.packageAssetMap as Record<string, string>)
    : {}
  const resourceSummary = typeof base.resourceSummary === 'object' && base.resourceSummary
    ? (base.resourceSummary as SceneJsonExportDocument['resourceSummary'])
    : undefined
  const environment = typeof base.environment === 'object' && base.environment
    ? (base.environment as SceneJsonExportDocument['environment'])
    : undefined

  return {
    id,
    name,
    createdAt,
    updatedAt,
    skybox,
    environment,
    nodes,
    materials,
    groundSettings,
    outlineMeshMap,
    assetIndex: assetIndex as Record<string, any>,
    packageAssetMap,
    resourceSummary,
  }
}

async function parsePresetFile(file: File): Promise<SceneJsonExportDocument> {
  const text = await file.text()
  const parsed = JSON.parse(text) as unknown
  return normalizeSceneDocument(parsed)
}

async function loadPresetScene(): Promise<void> {
  const token = ++loadToken
  clearScene()
  if (!scene || !camera || !controls || !props.file) {
    return
  }
  try {
    const document = await parsePresetFile(props.file)
    const buildOptions: SceneGraphBuildOptions = {
      enableGround: true,
      lazyLoadMeshes: false,
    }
    const resourceCache = new ResourceCache(document, buildOptions, assetLoader, {
      warn: (message) => console.warn('[PresetPreview] resource warning:', message),
      reportDownloadProgress: undefined,
    })
    const { root } = await buildSceneGraph(document, resourceCache, buildOptions)
    if (token !== loadToken) {
      disposeObject(root)
      return
    }
    currentRoot = root
    scene.add(root)
    fitCamera(root)
    emitDimensions(root)
  } catch (error) {
    console.warn('[PresetPreview] failed to load preset scene', error)
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

function applyBackground(): void {
  if (!scene) {
    return
  }
  if (props.background && props.background.trim().length) {
    scene.background = new THREE.Color(props.background)
  } else {
    scene.background = null
  }
}

function setupScene(): void {
  if (!container.value) {
    return
  }
  scene = new THREE.Scene()
  applyBackground()

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
  camera.position.set(3, 3, 3)

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.setSize(container.value.clientWidth, container.value.clientHeight)
  renderer.setClearColor(0x000000, 0)
  container.value.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05

  const ambient = new THREE.AmbientLight(0xffffff, 1.5)
  const directional = new THREE.DirectionalLight(0xffffff, 2.0)
  directional.position.set(5, 10, 7.5)
  const fillLight = new THREE.DirectionalLight(0xffffff, 1.0)
  fillLight.position.set(-5, 2, -6)

  scene.add(ambient)
  scene.add(directional)
  scene.add(fillLight)

  window.addEventListener('resize', handleResize)
  handleResize()
  renderLoop()
}

watch(
  () => props.file,
  () => {
    void loadPresetScene()
  },
  { immediate: true },
)

watch(
  () => props.background,
  () => {
    applyBackground()
  },
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
  disposeObject(currentRoot)
  currentRoot = null
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
  if (!source.width || !source.height) {
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

.preset-preview canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
}
</style>
