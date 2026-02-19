<template>
  <div ref="container" class="model-preview"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import Loader from '@schema/loader'

const props = defineProps<{
  file: File | null
  background?: string
}>()

const emit = defineEmits<{
  (e: 'dimensions', payload: { length: number; width: number; height: number }): void
}>()

const container = ref<HTMLDivElement | null>(null)
const loader = new Loader()
let renderer: THREE.WebGLRenderer | null = null
let camera: THREE.PerspectiveCamera | null = null
let scene: THREE.Scene | null = null
let controls: OrbitControls | null = null
let animationHandle = 0
let currentObject: THREE.Object3D | null = null

function disposeObject(object: THREE.Object3D | null): void {
  if (!object) {
    return
  }
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh) {
      mesh.geometry?.dispose()
      const { material } = mesh
      if (Array.isArray(material)) {
        material.forEach((mat) => mat.dispose?.())
      } else {
        material?.dispose?.()
      }
    }
  })
}

function fitCamera(object: THREE.Object3D): void {
  if (!camera || !controls) {
    return
  }
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  const fov = THREE.MathUtils.degToRad(camera.fov)
  const distance = maxDim === 0 ? 5 : maxDim / (2 * Math.tan(fov / 2))
  const offset = distance * 1.4
  camera.position.set(center.x + offset, center.y + offset, center.z + offset)
  camera.near = Math.max(0.1, distance / 100)
  camera.far = distance * 100
  camera.updateProjectionMatrix()
  controls.target.copy(center)
  controls.update()
}

function clearScene(): void {
  if (!scene) {
    return
  }
  const removable: THREE.Object3D[] = []
  scene.children.forEach((child) => {
    if (!(child instanceof THREE.Light)) {
      removable.push(child)
    }
  })
  removable.forEach((child) => {
    scene?.remove(child)
    disposeObject(child)
  })
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
  if (props.background && props.background.trim().length) {
    scene.background = new THREE.Color(props.background)
  } else {
    scene.background = null
  }

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
  fillLight.position.set(-5, 0, -5)

  scene.add(ambient)
  scene.add(directional)
  scene.add(fillLight)

  window.addEventListener('resize', handleResize)
  handleResize()
  renderLoop()
}

async function loadModel(): Promise<void> {
  if (!scene || !camera || !controls || !props.file) {
    clearScene()
    return
  }
  const file = props.file
  clearScene()
  disposeObject(currentObject)
  currentObject = null

  await new Promise<void>((resolve, reject) => {
    const handleLoaded = (object: THREE.Object3D | null) => {
      if (!object) {
        reject(new Error('模型加载失败'))
        return
      }
      currentObject = object
      scene?.add(object)
      fitCamera(object)
      try {
        const box = new THREE.Box3().setFromObject(object)
        const size = box.getSize(new THREE.Vector3())
        const length = Number.isFinite(size.x) ? size.x : 0
        const width = Number.isFinite(size.z) ? size.z : 0
        const height = Number.isFinite(size.y) ? size.y : 0
        emit('dimensions', { length, width, height })
      } catch (_error) {
        // ignore dimension errors
      }
      loader.removeEventListener('loaded', handleLoaded)
      resolve()
    }
    loader.addEventListener('loaded', handleLoaded)
    try {
      loader.loadFiles([file])
    } catch (error) {
      loader.removeEventListener('loaded', handleLoaded)
      reject(error)
    }
  })
}

watch(
  () => props.file,
  () => {
    void loadModel().catch((error) => console.warn('[editor] 模型预览加载失败', error))
  },
  { immediate: true },
)

onMounted(() => {
  setupScene()
  if (props.file) {
    void loadModel().catch((error) => console.warn('[editor] 模型预览初始化失败', error))
  }
})

onBeforeUnmount(() => {
  cancelAnimationFrame(animationHandle)
  window.removeEventListener('resize', handleResize)
  disposeObject(currentObject)
  currentObject = null
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
.model-preview {
  width: 100%;
  height: 100%;
  min-height: 260px;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(15, 18, 24, 0.92);
}

.model-preview canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
}
</style>
