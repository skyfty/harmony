<template>
  <div ref="container" class="hdr-preview"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { disposeSkyCubeTexture, extractSkycubeZipFaces, loadSkyCubeTexture } from '@schema/skyCubeTexture'

const props = defineProps<{
  file: File | null
  src?: string | null
  mode?: 'hdri' | 'skycube'
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
let currentSkyCubeTexture: THREE.CubeTexture | null = null
let activeObjectUrl: string | null = null
let skyCubeFaceUrlCleanup: (() => void) | null = null

const ROTATION_SPEED = 0.0035

function disposeTexture(texture: THREE.Texture | null): void {
  texture?.dispose()
}

function disposeSkyCubeFaceUrls(): void {
  skyCubeFaceUrlCleanup?.()
  skyCubeFaceUrlCleanup = null
}

function buildObjectUrlsFromSkycubeZipFaces(
  facesInOrder: ReadonlyArray<ReturnType<typeof extractSkycubeZipFaces>['facesInOrder'][number]>,
): { urls: Array<string | null>; dispose: () => void } {
  const urls: Array<string | null> = []
  const created: string[] = []
  for (const face of facesInOrder) {
    if (!face) {
      urls.push(null)
      continue
    }
    const mimeType = face.mimeType ?? 'application/octet-stream'
    const bytes = face.bytes as unknown as Uint8Array<ArrayBuffer>
    const blob = new Blob([bytes], { type: mimeType })
    const url = URL.createObjectURL(blob)
    created.push(url)
    urls.push(url)
  }
  return {
    urls,
    dispose: () => {
      for (const url of created) {
        try {
          URL.revokeObjectURL(url)
        } catch (_error) {
          // ignore
        }
      }
    },
  }
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

async function captureSnapshot(): Promise<HTMLCanvasElement | null> {
  if (!renderer) {
    return null
  }
  const source = renderer.domElement
  if (!source || source.width <= 0 || source.height <= 0) {
    return null
  }
  if (typeof document === 'undefined') {
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
  const mode = props.mode ?? 'hdri'
  const file = props.file
  const src = props.src?.trim().length ? props.src : null
  if (!file && !src) {
    disposeTexture(currentTexture)
    currentTexture = null
    disposeSkyCubeTexture(currentSkyCubeTexture)
    currentSkyCubeTexture = null
    disposeSkyCubeFaceUrls()
    if (scene) {
      scene.environment = null
      scene.background = new THREE.Color(0x202020)
    }
    return
  }

  let url = src ?? null
  if (mode !== 'skycube' && !url && file) {
    url = URL.createObjectURL(file)
    activeObjectUrl = url
  }

  if (!url && mode !== 'skycube') {
    return
  }

  try {
    disposeTexture(currentTexture)
    currentTexture = null
    disposeSkyCubeTexture(currentSkyCubeTexture)
    currentSkyCubeTexture = null
    disposeSkyCubeFaceUrls()

    if (mode === 'skycube') {
      const skycubeFile = file
      if (!skycubeFile) {
        throw new Error('Skycube preview requires a local file')
      }
      const buffer = await skycubeFile.arrayBuffer()
      const extracted = extractSkycubeZipFaces(buffer)
      const faceUrlsResult = buildObjectUrlsFromSkycubeZipFaces(extracted.facesInOrder)
      skyCubeFaceUrlCleanup = faceUrlsResult.dispose
      const loaded = await loadSkyCubeTexture(faceUrlsResult.urls)
      if (!loaded.texture) {
        throw new Error(loaded.error || 'Failed to load skycube texture')
      }
      currentSkyCubeTexture = loaded.texture
      scene!.environment = loaded.texture
      scene!.background = loaded.texture
      return
    }

    const hdrUrl = url
    if (!hdrUrl) {
      return
    }
    const texture = await loader.loadAsync(hdrUrl)
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.colorSpace = THREE.LinearSRGBColorSpace
    currentTexture = texture
    scene!.environment = texture
    scene!.background = texture
  } catch (error) {
    console.warn('[editor] 环境预览加载失败', error)
  } finally {
    if (activeObjectUrl && activeObjectUrl !== props.src) {
      URL.revokeObjectURL(activeObjectUrl)
      activeObjectUrl = null
    }
  }
}

watch(
  () => [props.file, props.src, props.mode],
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
  disposeSkyCubeTexture(currentSkyCubeTexture)
  currentSkyCubeTexture = null
  disposeSkyCubeFaceUrls()
  if (activeObjectUrl && activeObjectUrl !== props.src) {
    URL.revokeObjectURL(activeObjectUrl)
    activeObjectUrl = null
  }
  renderer?.dispose()
  renderer = null
  scene = null
  camera = null
})

defineExpose({
  captureSnapshot,
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
