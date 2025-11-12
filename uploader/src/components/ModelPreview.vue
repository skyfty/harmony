<template>
  <div ref="container" class="model-preview"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import Loader from '@schema/loader'

interface Props {
  file: File
  background?: string
}

const props = defineProps<Props>()

const container = ref<HTMLDivElement | null>(null)
let renderer: THREE.WebGLRenderer | null = null
let camera: THREE.PerspectiveCamera | null = null
let scene: THREE.Scene | null = null
let controls: OrbitControls | null = null
let animationHandle = 0
const loader = new Loader()
let currentObject: THREE.Object3D | null = null

function disposeObject(object: THREE.Object3D | null): void {
  if (!object) {
    return
  }
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh) {
      mesh.geometry?.dispose()
      const material = mesh.material
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
  const distance = maxDim === 0 ? 10 : maxDim / (2 * Math.tan(fov / 2))
  const offset = distance * 1.2
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
  scene.background = new THREE.Color(props.background ?? '#1e1e1e')
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
  camera.position.set(3, 3, 3)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.setSize(container.value.clientWidth, container.value.clientHeight)
  container.value.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05

  const ambient = new THREE.AmbientLight(0xffffff, 0.6)
  const directional = new THREE.DirectionalLight(0xffffff, 0.8)
  directional.position.set(5, 10, 7.5)
  scene.add(ambient)
  scene.add(directional)

  window.addEventListener('resize', handleResize)
  handleResize()
  renderLoop()
}

async function loadModel(): Promise<void> {
  if (!scene || !camera || !controls || !props.file) {
    return
  }
  clearScene()
  currentObject && disposeObject(currentObject)
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
      loader.removeEventListener('loaded', handleLoaded)
      resolve()
    }
    loader.addEventListener('loaded', handleLoaded)
    try {
      loader.loadFiles([props.file])
    } catch (error) {
      loader.removeEventListener('loaded', handleLoaded)
      reject(error)
    }
  })
}

onMounted(() => {
  setupScene()
  loadModel().catch((error) => console.warn('[uploader] 模型预览加载失败', error))
})

watch(
  () => props.file,
  () => {
    loadModel().catch((error) => console.warn('[uploader] 模型预览加载失败', error))
  },
)

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  cancelAnimationFrame(animationHandle)
  if (renderer) {
    renderer.dispose()
  }
  disposeObject(currentObject)
  controls?.dispose()
  if (container.value?.firstChild) {
    container.value.removeChild(container.value.firstChild)
  }
})
</script>

<style scoped>
.model-preview {
  width: 100%;
  min-height: 320px;
  border-radius: 12px;
  overflow: hidden;
  background: #1e1e1e;
}
</style>
