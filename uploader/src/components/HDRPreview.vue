<template>
  <div ref="container" class="hdr-preview"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import pica from 'pica'
import { useUploadStore } from '@/stores/upload'

interface Props {
  file: File
  taskId: string
  src?: string | null
}

const props = defineProps<Props>()
const uploadStore = useUploadStore()
const container = ref<HTMLDivElement | null>(null)

const loader = new RGBELoader()
loader.setDataType(THREE.FloatType)
const picaInstance = pica()

const THUMBNAIL_SIZE = 512
const ROTATION_SPEED = 0.0035

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let animationHandle = 0
let demoGroup: THREE.Group | null = null
let currentTexture: THREE.Texture | null = null
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

  const hemi = new THREE.HemisphereLight(0xffffff, 0x202020, 0.3)
  scene.add(hemi)

  demoGroup = new THREE.Group()

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 64, 64),
    new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.15 })
  )
  sphere.position.set(-0.9, 0.8, 0)
  demoGroup.add(sphere)

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.1, 1.1),
    new THREE.MeshStandardMaterial({ metalness: 0.2, roughness: 0.3 })
  )
  box.position.set(1, 0.55, 0)
  demoGroup.add(box)

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(4.5, 64),
    new THREE.MeshStandardMaterial({ color: 0x808080, metalness: 0, roughness: 1 })
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = 0
  demoGroup.add(ground)

  scene.add(demoGroup)

  window.addEventListener('resize', handleResize)
  handleResize()
  renderLoop()
}

function applyEnvironment(texture: THREE.Texture): void {
  if (!scene) {
    return
  }
  scene.environment = texture
  scene.background = texture
  if (demoGroup) {
    demoGroup.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh) {
        const material = mesh.material
        if (Array.isArray(material)) {
          material.forEach((mat) => {
            if ('envMapIntensity' in mat) {
              ;(mat as THREE.MeshStandardMaterial).envMapIntensity = 1.0
              mat.needsUpdate = true
            }
          })
        } else if (material && 'envMapIntensity' in material) {
          ;(material as THREE.MeshStandardMaterial).envMapIntensity = 1.0
          material.needsUpdate = true
        }
      }
    })
  }
  if (renderer && camera) {
    renderer.render(scene, camera)
  }
}

async function loadEnvironment(): Promise<void> {
  if (!scene || !renderer || !props.file) {
    return
  }

  const shouldCaptureThumbnail = !hasCapturedThumbnail && Boolean(props.taskId)
  if (shouldCaptureThumbnail) {
    uploadStore.markThumbnailPending(props.taskId)
  }

  const jobToken = shouldCaptureThumbnail ? ++thumbnailJobToken : thumbnailJobToken

  let createdUrl: string | null = null
  const sourceUrl = props.src && props.src.length ? props.src : null
  const url = sourceUrl ?? (() => {
    createdUrl = URL.createObjectURL(props.file)
    return createdUrl
  })()

  try {
    const texture = await loader.loadAsync(url)
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.colorSpace = THREE.LinearSRGBColorSpace
    disposeTexture(currentTexture)
    currentTexture = texture
    applyEnvironment(texture)
    if (shouldCaptureThumbnail) {
      await generateThumbnail(jobToken)
    }
  } catch (error) {
    if (shouldCaptureThumbnail) {
      uploadStore.applyThumbnailResult(props.taskId, {
        file: null,
        error: error instanceof Error ? error.message : 'HDRI 预览失败',
      })
    }
    throw error
  } finally {
    if (createdUrl) {
      URL.revokeObjectURL(createdUrl)
    }
  }
}

async function generateThumbnail(jobToken: number): Promise<void> {
  if (!scene || !camera || jobToken !== thumbnailJobToken) {
    return
  }
  let thumbnailRenderer: THREE.WebGLRenderer | null = null
  try {
    thumbnailRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    thumbnailRenderer.outputColorSpace = THREE.SRGBColorSpace
    thumbnailRenderer.toneMapping = renderer?.toneMapping ?? THREE.ACESFilmicToneMapping
    thumbnailRenderer.toneMappingExposure = renderer?.toneMappingExposure ?? 1.0
    thumbnailRenderer.setSize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, false)
    thumbnailRenderer.render(scene, camera)

    const canvas = thumbnailRenderer.domElement
    const { canvas: outputCanvas, blob } = await buildThumbnail(canvas)

    if (jobToken !== thumbnailJobToken) {
      return
    }

    const baseName = props.file.name.replace(/\.[^.]+$/, '') || props.file.name
    const file = new File([blob], `${baseName}-thumbnail.png`, {
      type: 'image/png',
      lastModified: Date.now(),
    })

    uploadStore.applyThumbnailResult(props.taskId, {
      file,
      width: outputCanvas.width,
      height: outputCanvas.height,
    })
    hasCapturedThumbnail = true
  } catch (error) {
    if (jobToken === thumbnailJobToken) {
      uploadStore.applyThumbnailResult(props.taskId, {
        file: null,
        error: error instanceof Error ? error.message : '缩略图生成失败',
      })
    }
    throw error
  } finally {
    thumbnailRenderer?.dispose()
  }
}

function buildReadableCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  if (!source.width || !source.height) {
    return source
  }
  const ctx = source.getContext('2d')
  if (ctx) {
    return source
  }
  const clone = document.createElement('canvas')
  clone.width = source.width
  clone.height = source.height
  const cloneCtx = clone.getContext('2d')
  if (!cloneCtx) {
    return source
  }
  cloneCtx.drawImage(source, 0, 0)
  return clone
}

async function buildThumbnail(source: HTMLCanvasElement): Promise<{ canvas: HTMLCanvasElement; blob: Blob }> {
  const readable = buildReadableCanvas(source)
  const trimmed = cropTransparentBounds(readable)
  try {
    return await scaleCanvasWithPica(trimmed, THUMBNAIL_SIZE)
  } catch (error) {
    console.warn('[uploader] HDR 缩略图缩放失败，将使用原始尺寸', error)
    return {
      canvas: trimmed,
      blob: await canvasToBlob(trimmed),
    }
  }
}

function cropTransparentBounds(source: HTMLCanvasElement): HTMLCanvasElement {
  const width = source.width
  const height = source.height
  if (!width || !height) {
    return source
  }
  const ctx = source.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return source
  }
  const data = ctx.getImageData(0, 0, width, height).data as Uint8ClampedArray
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const alpha = data[offset + 3] ?? 0
      if (alpha > 10) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    return source
  }
  const cropWidth = maxX - minX + 1
  const cropHeight = maxY - minY + 1
  if (cropWidth === width && cropHeight === height) {
    return source
  }
  const target = document.createElement('canvas')
  target.width = cropWidth
  target.height = cropHeight
  const targetCtx = target.getContext('2d')
  if (!targetCtx) {
    return source
  }
  targetCtx.drawImage(source, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
  return target
}

async function scaleCanvasWithPica(
  source: HTMLCanvasElement,
  maxSize: number,
): Promise<{ canvas: HTMLCanvasElement; blob: Blob }> {
  const maxDim = Math.max(source.width, source.height)
  if (!maxDim) {
    return {
      canvas: source,
      blob: await canvasToBlob(source),
    }
  }
  if (maxDim <= maxSize) {
    return {
      canvas: source,
      blob: await canvasToBlob(source),
    }
  }
  const scale = maxSize / maxDim
  const targetWidth = Math.max(1, Math.round(source.width * scale))
  const targetHeight = Math.max(1, Math.round(source.height * scale))
  const target = document.createElement('canvas')
  target.width = targetWidth
  target.height = targetHeight
  try {
    await picaInstance.resize(source, target, { quality: 3 })
  } catch (error) {
    console.warn('[uploader] HDR 缩略图 pica resize 失败，改用 Canvas 缩放', error)
    const ctx = target.getContext('2d')
    ctx?.drawImage(source, 0, 0, source.width, source.height, 0, 0, targetWidth, targetHeight)
  }
  try {
    const blob = await picaInstance.toBlob(target, 'image/png', 0.95)
    return { canvas: target, blob }
  } catch (error) {
    console.warn('[uploader] HDR 缩略图 pica toBlob 失败，改用 Canvas toBlob', error)
    return {
      canvas: target,
      blob: await canvasToBlob(target),
    }
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result: Blob | null) => {
        if (result) {
          resolve(result)
        } else {
          reject(new Error('无法生成图像数据'))
        }
      },
      'image/png',
    )
  })
}

onMounted(() => {
  setupScene()
  loadEnvironment().catch((error) => console.warn('[uploader] HDRI 预览加载失败', error))
})

watch(
  [() => props.file, () => props.src],
  () => {
    hasCapturedThumbnail = false
    thumbnailJobToken += 1
    loadEnvironment().catch((error) => console.warn('[uploader] HDRI 预览加载失败', error))
  },
)

onBeforeUnmount(() => {
  stopAnimation()
  window.removeEventListener('resize', handleResize)
  controls?.dispose()
  if (renderer) {
    renderer.dispose()
    if (renderer.domElement && renderer.domElement.parentElement) {
      renderer.domElement.parentElement.removeChild(renderer.domElement)
    }
  }
  disposeObject(demoGroup)
  demoGroup = null
  disposeTexture(currentTexture)
  currentTexture = null
  scene = null
  camera = null
  renderer = null
})
</script>

<style scoped>
.hdr-preview {
  width: 100%;
  height: 100%;
  min-height: 320px;
  background: #0f0f0f;
}

.hdr-preview :deep(canvas) {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
