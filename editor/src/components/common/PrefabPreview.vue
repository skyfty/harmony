<template>
  <div ref="container" class="prefab-preview"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { acquirePrefabPreviewRoot, type PrefabPreviewHandle } from '@/utils/prefabPreviewBuilder'

const props = defineProps<{
  file: File | null
  assetId?: string | null
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
let activeHandle: PrefabPreviewHandle | null = null

const assetCacheStore = useAssetCacheStore()

function clearScene(): void {
  if (!scene) {
    return
  }
  activeHandle?.release()
  activeHandle = null
  if (currentRoot) {
    scene.remove(currentRoot)
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

async function loadPrefabScene(): Promise<void> {
  const token = ++loadToken
  clearScene()
  if (!scene || !camera || !controls || !props.file) {
    return
  }
  try {
    const handle = await acquirePrefabPreviewRoot({
      assetId: props.assetId ?? 'prefab-preview',
      file: props.file,
      assetCacheStore,
      cacheOnly: false,
    })
    if (token !== loadToken) {
      handle.release()
      return
    }
    activeHandle = handle
    currentRoot = handle.root
    scene.add(handle.root)
    fitCamera(handle.root)
    emitDimensions(handle.root)
  } catch (error) {
    console.warn('[PrefabPreview] failed to load prefab scene', error)
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
  controls.enableDamping = false
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
    void loadPrefabScene()
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
    void loadPrefabScene()
  }
})

onBeforeUnmount(() => {
  loadToken += 1
  cancelAnimationFrame(animationHandle)
  window.removeEventListener('resize', handleResize)
  activeHandle?.release()
  activeHandle = null
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
.prefab-preview {
  width: 100%;
  height: 100%;
  min-height: 260px;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(15, 18, 24, 0.92);
}

.prefab-preview canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
}
</style>
