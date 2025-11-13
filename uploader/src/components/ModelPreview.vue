<template>
  <div ref="container" class="model-preview"></div>
  
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import Loader from '@schema/loader'
import { useUploadStore } from '@/stores/upload'

interface Props {
  file: File
  taskId: string
  background?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'dimensions', payload: { length: number; width: number; height: number }): void
}>()

const uploadStore = useUploadStore()
const THUMBNAIL_SIZE = 512

const container = ref<HTMLDivElement | null>(null)
let renderer: THREE.WebGLRenderer | null = null
let camera: THREE.PerspectiveCamera | null = null
let scene: THREE.Scene | null = null
let controls: OrbitControls | null = null
let animationHandle = 0
const loader = new Loader()
let currentObject: THREE.Object3D | null = null
let hasCapturedThumbnail = false
let thumbnailJobToken = 0

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
  scene.background = null
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
  camera.position.set(3, 3, 3)

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.setSize(container.value.clientWidth, container.value.clientHeight)
  renderer.setClearColor(0x000000, 0)
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

  const shouldCaptureThumbnail = !hasCapturedThumbnail && Boolean(props.taskId)
  if (shouldCaptureThumbnail) {
    uploadStore.markModelThumbnailPending(props.taskId)
  }

  const jobToken = shouldCaptureThumbnail ? ++thumbnailJobToken : thumbnailJobToken

  try {
    await new Promise<void>((resolve, reject) => {
      const handleLoaded = (object: THREE.Object3D | null) => {
        if (!object) {
          reject(new Error('模型加载失败'))
          return
        }
        currentObject = object
        scene?.add(object)
        fitCamera(object)
        // Calculate and emit bounding box dimensions in meters (assuming unit = meters)
        try {
          const box = new THREE.Box3().setFromObject(object)
          const size = box.getSize(new THREE.Vector3())
          const length = Number.isFinite(size.x) ? size.x : 0
          const width = Number.isFinite(size.z) ? size.z : 0
          const height = Number.isFinite(size.y) ? size.y : 0
          emit('dimensions', { length, width, height })
        } catch (err) {
          // noop
        }
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

    if (shouldCaptureThumbnail) {
      await generateThumbnail(jobToken).catch((error) => {
        console.warn('[uploader] 模型缩略图生成失败', error)
      })
    }
  } catch (error) {
    if (shouldCaptureThumbnail) {
      uploadStore.applyModelThumbnailResult(props.taskId, {
        file: null,
        error: error instanceof Error ? error.message : '模型加载失败',
      })
    }
    throw error
  }
}

async function generateThumbnail(jobToken: number): Promise<void> {
  if (!scene || !camera || jobToken !== thumbnailJobToken) {
    return
  }
  let thumbnailRenderer: THREE.WebGLRenderer | null = null
  try {
    thumbnailRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    thumbnailRenderer.outputColorSpace = THREE.SRGBColorSpace
    thumbnailRenderer.shadowMap.enabled = renderer?.shadowMap.enabled ?? true
    thumbnailRenderer.setClearColor(0x000000, 0)
    thumbnailRenderer.setSize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, false)
    thumbnailRenderer.render(scene, camera)

    const canvas = thumbnailRenderer.domElement
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) {
          resolve(result)
        } else {
          reject(new Error('缩略图生成失败'))
        }
      }, 'image/png')
    })

    if (jobToken !== thumbnailJobToken) {
      return
    }

    const baseName = props.file.name.replace(/\.[^.]+$/, '') || props.file.name
    const file = new File([blob], `${baseName}-thumbnail.png`, { type: 'image/png', lastModified: Date.now() })
    uploadStore.applyModelThumbnailResult(props.taskId, {
      file,
      width: THUMBNAIL_SIZE,
      height: THUMBNAIL_SIZE,
    })
    hasCapturedThumbnail = true
  } catch (error) {
    if (jobToken === thumbnailJobToken) {
      uploadStore.applyModelThumbnailResult(props.taskId, {
        file: null,
        error: error instanceof Error ? error.message : '缩略图生成失败',
      })
    }
    throw error
  } finally {
    thumbnailRenderer?.dispose()
  }
}

onMounted(() => {
  setupScene()
  loadModel().catch((error) => console.warn('[uploader] 模型预览加载失败', error))
})

watch(
  () => props.file,
  () => {
    hasCapturedThumbnail = false
    thumbnailJobToken += 1
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
  height: 100%;
  min-height: 320px;
  border-radius: 12px;
  overflow: hidden;
  background: #1e1e1e;
}
</style>
