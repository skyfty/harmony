<template>
  <div ref="container" class="material-preview"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { disposeMaterialTextures } from '@schema/material'
import { applyMaterialConfigToMaterial } from '@/types/material'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { createMaterialAssetTextureResolver, parseMaterialAssetDocument } from '@/utils/materialAsset'

const props = defineProps<{
  file: File | null
  background?: string
}>()

const container = ref<HTMLDivElement | null>(null)
const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()

let renderer: THREE.WebGLRenderer | null = null
let camera: THREE.PerspectiveCamera | null = null
let scene: THREE.Scene | null = null
let controls: OrbitControls | null = null
let animationHandle = 0
let previewRoot: THREE.Group | null = null

function disposePreviewRoot(root: THREE.Group | null): void {
  if (!root) {
    return
  }
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) {
      return
    }
    mesh.geometry?.dispose?.()
    const material = mesh.material
    if (Array.isArray(material)) {
      material.forEach((entry) => {
        disposeMaterialTextures(entry)
        entry.dispose?.()
      })
      return
    }
    disposeMaterialTextures(material)
    material?.dispose?.()
  })
}

function clearPreview(): void {
  if (scene && previewRoot) {
    scene.remove(previewRoot)
  }
  disposePreviewRoot(previewRoot)
  previewRoot = null
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
  scene.background = props.background && props.background.trim().length
    ? new THREE.Color(props.background)
    : null

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
  camera.position.set(2.4, 1.6, 2.8)
  camera.lookAt(0, 0, 0)

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.setSize(container.value.clientWidth, container.value.clientHeight)
  renderer.setClearColor(0x000000, 0)
  container.value.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.enablePan = false
  controls.autoRotate = true
  controls.autoRotateSpeed = 1.2
  controls.target.set(0, 0, 0)
  controls.update()

  const ambient = new THREE.AmbientLight(0xffffff, 1.45)
  const key = new THREE.DirectionalLight(0xffffff, 2)
  key.position.set(4, 8, 6)
  const fill = new THREE.DirectionalLight(0xffffff, 0.9)
  fill.position.set(-5, 2, -4)
  const rim = new THREE.DirectionalLight(0xffffff, 0.5)
  rim.position.set(-2, 5, 5)

  scene.add(ambient)
  scene.add(key)
  scene.add(fill)
  scene.add(rim)

  window.addEventListener('resize', handleResize)
  handleResize()
  renderLoop()
}

async function loadMaterialPreview(): Promise<void> {
  clearPreview()
  if (!scene || !props.file) {
    return
  }

  const text = await props.file.text()
  const parsed = parseMaterialAssetDocument(JSON.parse(text))
  if (!parsed) {
    throw new Error('Invalid material file')
  }

  const sphereMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.1,
    roughness: 0.85,
  })
  applyMaterialConfigToMaterial(sphereMaterial, {
    name: parsed.name ?? 'Material',
    description: parsed.description,
    type: parsed.type ?? 'MeshStandardMaterial',
    id: 'material-preview',
    createdAt: '',
    updatedAt: '',
    ...parsed.props,
  }, {
    resolveTexture: createMaterialAssetTextureResolver({
      assetCacheStore,
      getAsset: (assetId: string) => sceneStore.getAsset(assetId),
    }),
  })

  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.78, 64, 64), sphereMaterial)
  sphere.rotation.y = Math.PI / 5
  sphere.rotation.x = -Math.PI / 12

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.12, 48),
    new THREE.ShadowMaterial({ opacity: 0.14 }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = -0.98

  previewRoot = new THREE.Group()
  previewRoot.add(sphere)
  previewRoot.add(shadow)
  scene.add(previewRoot)
}

watch(
  () => props.file,
  () => {
    void loadMaterialPreview().catch((error) => console.warn('[editor] 材质预览加载失败', error))
  },
  { immediate: true },
)

onMounted(() => {
  setupScene()
  if (props.file) {
    void loadMaterialPreview().catch((error) => console.warn('[editor] 材质预览初始化失败', error))
  }
})

onBeforeUnmount(() => {
  cancelAnimationFrame(animationHandle)
  window.removeEventListener('resize', handleResize)
  clearPreview()
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
.material-preview {
  width: 100%;
  height: 100%;
  min-height: 260px;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(15, 18, 24, 0.92);
}

.material-preview canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
}
</style>