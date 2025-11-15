<template>
  <div ref="container" class="hdr-preview"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'

const props = defineProps<{
  file: File | null
  src?: string | null
}>()

const container = ref<HTMLDivElement | null>(null)
const loader = new RGBELoader().setDataType(THREE.FloatType)

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let animationHandle = 0
let demoGroup: THREE.Group | null = null
let currentTexture: THREE.Texture | null = null
let activeObjectUrl: string | null = null

const ROTATION_SPEED = 0.0035

function disposeTexture(texture: THREE.Texture | null): void {
  texture?.dispose()
}

function stopAnimation(): void {
  if (animationHandle) {
    cancelAnimationFrame(animationHandle)
    animationHandle = 0
  }
}

function renderLoop(): void {
  if (!renderer || !scene || !camera) {
    return
  }
  if (demoGroup) {
    demoGroup.rotation.y += ROTATION_SPEED
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
  scene.background = new THREE.Color(0x202020)

  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 50)
  camera.position.set(0, 1.2, 3.5)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.setSize(container.value.clientWidth, container.value.clientHeight)
  container.value.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.minDistance = 0.5
  controls.maxDistance = 10

  const hemi = new THREE.HemisphereLight(0xffffff, 0x202020, 0.4)
  scene.add(hemi)

  demoGroup = new THREE.Group()
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 64, 64),
    new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.15 }),
  )
  sphere.position.set(-0.9, 0.8, 0)
  demoGroup.add(sphere)

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.1, 1.1),
    new THREE.MeshStandardMaterial({ metalness: 0.25, roughness: 0.35 }),
  )
  box.position.set(1, 0.55, 0)
  demoGroup.add(box)

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(4.5, 64),
    new THREE.MeshStandardMaterial({ color: 0x808080, metalness: 0, roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = 0
  demoGroup.add(ground)

  scene.add(demoGroup)

  window.addEventListener('resize', handleResize)
  handleResize()
  renderLoop()
}

async function loadTexture(): Promise<void> {
  if (!scene || !renderer) {
    return
  }
  const file = props.file
  const src = props.src?.trim().length ? props.src : null
  if (!file && !src) {
    disposeTexture(currentTexture)
    currentTexture = null
    if (scene) {
      scene.environment = null
      scene.background = new THREE.Color(0x202020)
    }
    return
  }

  let url = src ?? null
  if (!url && file) {
    url = URL.createObjectURL(file)
    activeObjectUrl = url
  }

  if (!url) {
    return
  }

  try {
    const texture = await loader.loadAsync(url)
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.colorSpace = THREE.LinearSRGBColorSpace
    disposeTexture(currentTexture)
    currentTexture = texture
    scene!.environment = texture
    scene!.background = texture
  } catch (error) {
    console.warn('[editor] HDR 预览加载失败', error)
  } finally {
    if (activeObjectUrl && activeObjectUrl !== props.src) {
      URL.revokeObjectURL(activeObjectUrl)
      activeObjectUrl = null
    }
  }
}

watch(
  () => [props.file, props.src],
  () => {
    void loadTexture()
  },
  { immediate: true },
)

onMounted(() => {
  setupScene()
  void loadTexture()
})

onBeforeUnmount(() => {
  stopAnimation()
  window.removeEventListener('resize', handleResize)
  controls?.dispose()
  controls = null
  disposeTexture(currentTexture)
  currentTexture = null
  if (activeObjectUrl && activeObjectUrl !== props.src) {
    URL.revokeObjectURL(activeObjectUrl)
    activeObjectUrl = null
  }
  renderer?.dispose()
  renderer = null
  scene = null
  camera = null
})
</script>

<style scoped>
.hdr-preview {
  width: 100%;
  height: 100%;
  min-height: 260px;
  border-radius: 12px;
  overflow: hidden;
  background: #111827;
}

.hdr-preview canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
}
</style>
