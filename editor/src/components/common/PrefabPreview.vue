<template>
  <div ref="container" class="prefab-preview"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { AssetCache, AssetLoader } from '@schema/assetCache'
import ResourceCache from '@schema/ResourceCache'
import { buildSceneGraph, type SceneGraphBuildOptions } from '@schema/sceneGraph'
import { disposeMaterialTextures } from '@schema/material'
import type { AssetIndexEntry, SceneJsonExportDocument, SceneNode } from '@harmony/schema'
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
    return `prefab-preview-${crypto.randomUUID()}`
  }
  return `prefab-preview-${Date.now()}`
}

const NODE_PREFAB_FORMAT_VERSION = 1

type PrefabFilePayload = {
  formatVersion?: unknown
  name?: unknown
  root?: unknown
  assetIndex?: unknown
  packageAssetMap?: unknown
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isVector3Like(value: unknown): value is { x: number; y: number; z: number } {
  if (!isPlainObject(value)) {
    return false
  }
  const { x, y, z } = value as Record<string, unknown>
  return [x, y, z].every((component) => typeof component === 'number' && Number.isFinite(component))
}

function isSceneNodeLike(value: unknown): value is SceneNode {
  if (!isPlainObject(value)) {
    return false
  }
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || !candidate.id.trim().length) {
    return false
  }
  if (typeof candidate.name !== 'string') {
    return false
  }
  if (typeof candidate.nodeType !== 'string' || !candidate.nodeType.trim().length) {
    return false
  }
  if (!isVector3Like(candidate.position) || !isVector3Like(candidate.rotation) || !isVector3Like(candidate.scale)) {
    return false
  }
  return true
}

function cloneDeep<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

function sanitizeAssetIndex(value: unknown): Record<string, AssetIndexEntry> | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }
  const result: Record<string, AssetIndexEntry> = {}
  Object.entries(value).forEach(([assetId, entry]) => {
    if (!isPlainObject(entry)) {
      return
    }
    const clonedEntry = cloneDeep(entry) as Partial<AssetIndexEntry> & Record<string, unknown>
    const categoryId = typeof clonedEntry.categoryId === 'string' ? clonedEntry.categoryId.trim() : ''
    if (!categoryId) {
      return
    }
    const normalized: AssetIndexEntry = { categoryId }
    if (clonedEntry.source && typeof clonedEntry.source === 'object') {
      normalized.source = clonedEntry.source as AssetIndexEntry['source']
    }
    result[assetId] = normalized
  })
  return Object.keys(result).length ? result : undefined
}

function sanitizePackageAssetMap(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }
  const result: Record<string, string> = {}
  Object.entries(value).forEach(([assetId, mapped]) => {
    if (typeof mapped === 'string' && mapped.trim().length) {
      result[assetId] = mapped.trim()
    }
  })
  return Object.keys(result).length ? result : undefined
}

function normalizeSceneDocument(raw: unknown): SceneJsonExportDocument {
  if (!isPlainObject(raw)) {
    throw new Error('Prefab 资源文件格式不正确')
  }
  const payload = raw as PrefabFilePayload
  if ('formatVersion' in payload && payload.formatVersion !== undefined) {
    const version = Number(payload.formatVersion)
    if (!Number.isFinite(version)) {
      throw new Error('Prefab 版本号无效')
    }
    if (version !== NODE_PREFAB_FORMAT_VERSION) {
      throw new Error(`暂不支持的 Prefab 版本: ${version}`)
    }
  }
  const rootCandidate = payload.root
  if (!isPlainObject(rootCandidate)) {
    throw new Error('Prefab 数据缺少有效的根节点')
  }

  const now = new Date().toISOString()
  const id = generatePreviewId()
  const name = typeof payload.name === 'string' && payload.name.trim().length
    ? payload.name.trim()
    : 'Prefab Preview'

  const skybox = normalizeSkyboxSettings()
  const clonedRoot = cloneDeep(rootCandidate)
  if (!isSceneNodeLike(clonedRoot)) {
    throw new Error('Prefab 根节点数据无效')
  }
  const nodes: SceneNode[] = [clonedRoot]
  const assetIndex = sanitizeAssetIndex(payload.assetIndex)
  const packageAssetMap = sanitizePackageAssetMap(payload.packageAssetMap)

  return {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    skybox,
    nodes,
    materials: [],
    assetIndex,
    packageAssetMap,
  }
}

async function parsePrefabFile(file: File): Promise<SceneJsonExportDocument> {
  const text = await file.text()
  const parsed = JSON.parse(text) as unknown
  return normalizeSceneDocument(parsed)
}

async function loadPrefabScene(): Promise<void> {
  const token = ++loadToken
  clearScene()
  if (!scene || !camera || !controls || !props.file) {
    return
  }
  try {
    const document = await parsePrefabFile(props.file)
    const buildOptions: SceneGraphBuildOptions = {
      enableGround: true,
      lazyLoadMeshes: false,
    }
    const resourceCache = new ResourceCache(document, buildOptions, assetLoader, {
      warn: (message) => console.warn('[PrefabPreview] resource warning:', message),
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
