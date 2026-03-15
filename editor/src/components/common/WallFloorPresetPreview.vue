<template>
  <div class="preset-preview">
    <div v-if="error" class="preset-preview__error">
      <v-icon size="40" color="error">mdi-alert-circle-outline</v-icon>
      <div class="preset-preview__error-text">{{ error }}</div>
    </div>
    <div v-else ref="container" class="preset-preview__canvas"></div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import Loader from '@schema/loader'
import type { FloorDynamicMesh, SceneMaterial, SceneMaterialProps, SceneMaterialTextureRef, SceneMaterialType, SceneNodeMaterial, WallDynamicMesh } from '@schema'
import { applyMaterialOverrides, DEFAULT_SCENE_MATERIAL_TYPE, type MaterialTextureAssignmentOptions } from '@schema/material'
import { createFloorGroup } from '@schema/floorMesh'
import { createWallRenderGroup } from '@schema/wallMesh'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { useSceneStore } from '@/stores/sceneStore'
import { parseFloorPresetData } from '@/stores/floorPresetActions'
import { parseWallPresetData } from '@/stores/wallPresetActions'
import { buildWallDynamicMeshFromWorldSegments } from '@/stores/wallUtils'
import { applyAirWallVisualToWallGroup } from '@/components/editor/WallRenderer'
import type { FloorPresetData, FloorPresetMaterialPatch } from '@/utils/floorPreset'
import type { WallPresetData, WallPresetMaterialPatch } from '@/utils/wallPreset'

const props = defineProps<{
  file: File | null
  kind: 'wall' | 'floor'
}>()

const emit = defineEmits<{
  (e: 'dimensions', payload: { length: number; width: number; height: number }): void
}>()

type ParsedPreset =
  | { kind: 'wall'; data: WallPresetData }
  | { kind: 'floor'; data: FloorPresetData }

const DEFAULT_RECT_HALF_SIZE = 2
const DEFAULT_WALL_HALF_LENGTH = 2

const container = ref<HTMLDivElement | null>(null)
const error = ref<string | null>(null)

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()

let renderer: THREE.WebGLRenderer | null = null
let camera: THREE.PerspectiveCamera | null = null
let scene: THREE.Scene | null = null
let controls: OrbitControls | null = null
let animationHandle = 0
let currentRoot: THREE.Object3D | null = null
let loadToken = 0

const assetObjectCache = new Map<string, THREE.Object3D | null>()
const pendingAssetObjectLoads = new Map<string, Promise<THREE.Object3D | null>>()

const materialOverrideOptions: MaterialTextureAssignmentOptions = {
  resolveTexture: resolveMaterialTexture,
  warn: (message) => {
    if (message) {
      console.warn('[preset-preview]', message)
    }
  },
}

function cloneTextureRef(ref: SceneMaterialTextureRef | null | undefined): SceneMaterialTextureRef | null {
  if (!ref) {
    return null
  }
  return {
    assetId: ref.assetId,
    name: ref.name,
    settings: ref.settings
      ? {
          wrapS: ref.settings.wrapS,
          wrapT: ref.settings.wrapT,
          wrapR: ref.settings.wrapR,
          offset: { x: ref.settings.offset.x, y: ref.settings.offset.y },
          repeat: { x: ref.settings.repeat.x, y: ref.settings.repeat.y },
          tileSizeMeters: { x: ref.settings.tileSizeMeters.x, y: ref.settings.tileSizeMeters.y },
          rotation: ref.settings.rotation,
          center: { x: ref.settings.center.x, y: ref.settings.center.y },
          matrixAutoUpdate: ref.settings.matrixAutoUpdate,
          generateMipmaps: ref.settings.generateMipmaps,
          premultiplyAlpha: ref.settings.premultiplyAlpha,
          flipY: ref.settings.flipY,
        }
      : undefined,
  }
}

function createDefaultMaterialProps(): SceneMaterialProps {
  return {
    color: '#ffffff',
    transparent: false,
    opacity: 1,
    side: 'front',
    wireframe: false,
    metalness: 0.1,
    roughness: 1,
    emissive: '#000000',
    emissiveIntensity: 0,
    aoStrength: 1,
    envMapIntensity: 1,
    textures: {
      albedo: null,
      normal: null,
      metalness: null,
      roughness: null,
      ao: null,
      emissive: null,
      displacement: null,
    },
  }
}

function mergeMaterialProps(base: SceneMaterialProps, overrides?: Partial<SceneMaterialProps> | null): SceneMaterialProps {
  if (!overrides) {
    return {
      ...base,
      textures: {
        ...base.textures,
      },
    }
  }

  const next: SceneMaterialProps = {
    ...base,
    ...overrides,
    textures: {
      ...base.textures,
    },
  }

  if (overrides.textures) {
    const sourceTextures = overrides.textures as Record<string, SceneMaterialTextureRef | null | undefined>
    Object.keys(sourceTextures).forEach((key) => {
      next.textures[key as keyof SceneMaterialProps['textures']] = cloneTextureRef(sourceTextures[key] ?? null)
    })
  }

  return next
}

function createNodeMaterialFromPatch(
  slotId: string,
  patch: FloorPresetMaterialPatch | WallPresetMaterialPatch,
): SceneNodeMaterial {
  const sharedMaterialId = patch.materialId === null ? null : typeof patch.materialId === 'string' ? patch.materialId.trim() : null
  const sharedMaterial = sharedMaterialId
    ? (sceneStore.materials.find((entry) => entry.id === sharedMaterialId) ?? null) as SceneMaterial | null
    : null

  const baseProps = sharedMaterial ? mergeMaterialProps(createDefaultMaterialProps(), sharedMaterial) : createDefaultMaterialProps()
  const mergedProps = sharedMaterial && patch.props && Object.keys(patch.props).length
    ? baseProps
    : mergeMaterialProps(baseProps, (patch.props ?? null) as Partial<SceneMaterialProps> | null)

  return {
    id: slotId,
    materialId: sharedMaterial?.id ?? null,
    name: typeof patch.name === 'string' && patch.name.trim().length ? patch.name.trim() : sharedMaterial?.name,
    type: (typeof patch.type === 'string' && patch.type.trim().length ? patch.type.trim() : sharedMaterial?.type ?? DEFAULT_SCENE_MATERIAL_TYPE) as SceneMaterialType,
    ...mergedProps,
  }
}

function buildWallNodeMaterials(preset: WallPresetData): SceneNodeMaterial[] {
  return (preset.materialOrder ?? [])
    .map((slotId) => {
      const normalizedId = typeof slotId === 'string' ? slotId.trim() : ''
      if (!normalizedId) {
        return null
      }
      const patch = preset.materialPatches?.[normalizedId]
      if (!patch) {
        return null
      }
      return createNodeMaterialFromPatch(normalizedId, patch)
    })
    .filter((entry): entry is SceneNodeMaterial => Boolean(entry))
}

function buildFloorNodeMaterials(preset: FloorPresetData): SceneNodeMaterial[] {
  return (preset.materialOrder ?? [])
    .map((slotId) => {
      const normalizedId = typeof slotId === 'string' ? slotId.trim() : ''
      if (!normalizedId) {
        return null
      }
      const patch = preset.materialPatches?.[normalizedId]
      if (!patch) {
        return null
      }
      return createNodeMaterialFromPatch(normalizedId, patch)
    })
    .filter((entry): entry is SceneNodeMaterial => Boolean(entry))
}

function fitCamera(object: THREE.Object3D): void {
  if (!camera || !controls) {
    return
  }
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) {
    camera.position.set(4, 3, 4)
    controls.target.set(0, 0, 0)
    controls.update()
    return
  }
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  const fov = THREE.MathUtils.degToRad(camera.fov)
  const distance = maxDim === 0 ? 5 : maxDim / (2 * Math.tan(fov / 2))
  const offset = distance * 1.5
  camera.position.set(center.x + offset, center.y + offset * 0.85, center.z + offset)
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
  emit('dimensions', {
    length: Number.isFinite(size.x) ? size.x : 0,
    width: Number.isFinite(size.z) ? size.z : 0,
    height: Number.isFinite(size.y) ? size.y : 0,
  })
}

function disposeObject(object: THREE.Object3D | null): void {
  if (!object) {
    return
  }
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    mesh.geometry?.dispose?.()
    const material = mesh.material
    if (Array.isArray(material)) {
      material.forEach((entry) => entry?.dispose?.())
    } else {
      material?.dispose?.()
    }
  })
}

function clearScene(): void {
  error.value = null
  if (scene && currentRoot) {
    scene.remove(currentRoot)
  }
  disposeObject(currentRoot)
  currentRoot = null
}

async function ensureAssetFile(assetId: string): Promise<File | null> {
  let file = assetCacheStore.createFileFromCache(assetId)
  if (file) {
    return file
  }

  await assetCacheStore.loadFromIndexedDb(assetId)
  file = assetCacheStore.createFileFromCache(assetId)
  if (file) {
    return file
  }

  const asset = sceneStore.getAsset(assetId)
  if (!asset) {
    return null
  }
  await assetCacheStore.downloaProjectAsset(asset)
  return assetCacheStore.createFileFromCache(assetId)
}

async function loadModelObjectFromFile(file: File): Promise<THREE.Object3D | null> {
  const loader = new Loader()
  return await new Promise<THREE.Object3D | null>((resolve, reject) => {
    const handleLoaded = (object: THREE.Object3D | null) => {
      loader.removeEventListener('loaded', handleLoaded)
      if (!object) {
        reject(new Error('模型加载失败'))
        return
      }
      resolve(object)
    }
    loader.addEventListener('loaded', handleLoaded)
    try {
      loader.loadFiles([file])
    } catch (loadError) {
      loader.removeEventListener('loaded', handleLoaded)
      reject(loadError)
    }
  })
}

async function loadAssetObject(assetId: string | null | undefined): Promise<THREE.Object3D | null> {
  const normalizedId = typeof assetId === 'string' ? assetId.trim() : ''
  if (!normalizedId) {
    return null
  }
  if (assetObjectCache.has(normalizedId)) {
    return assetObjectCache.get(normalizedId) ?? null
  }
  if (pendingAssetObjectLoads.has(normalizedId)) {
    return pendingAssetObjectLoads.get(normalizedId) ?? null
  }

  const pending = (async () => {
    const file = await ensureAssetFile(normalizedId)
    if (!file) {
      return null
    }
    const object = await loadModelObjectFromFile(file)
    assetObjectCache.set(normalizedId, object)
    return object
  })()

  pendingAssetObjectLoads.set(normalizedId, pending)
  try {
    return await pending
  } finally {
    pendingAssetObjectLoads.delete(normalizedId)
  }
}

async function resolveMaterialTexture(ref: SceneMaterialTextureRef): Promise<THREE.Texture | null> {
  const assetId = typeof ref?.assetId === 'string' ? ref.assetId.trim() : ''
  if (!assetId) {
    return null
  }
  const file = await ensureAssetFile(assetId)
  if (!file) {
    return null
  }
  const blobUrl = URL.createObjectURL(file)
  try {
    const loader = new THREE.TextureLoader()
    const texture = await loader.loadAsync(blobUrl)
    texture.name = ref.name ?? file.name ?? assetId
    texture.needsUpdate = true
    return texture
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

async function parsePreset(file: File): Promise<ParsedPreset> {
  const text = await file.text()
  if (props.kind === 'wall') {
    return { kind: 'wall', data: parseWallPresetData(text) }
  }
  return { kind: 'floor', data: parseFloorPresetData(text) }
}

function buildDefaultWallDefinition(preset: WallPresetData): WallDynamicMesh {
  const bodyMaterialConfigId = preset.wallProps.bodyMaterialConfigId ?? preset.materialOrder?.[0] ?? null
  const built = buildWallDynamicMeshFromWorldSegments(
    [{ start: { x: -DEFAULT_WALL_HALF_LENGTH, y: 0, z: 0 }, end: { x: DEFAULT_WALL_HALF_LENGTH, y: 0, z: 0 } }],
    {
      height: preset.wallProps.height,
      width: preset.wallProps.width,
      thickness: preset.wallProps.thickness,
    },
  )
  if (!built) {
    throw new Error('无法构建墙体预览几何')
  }
  return {
    ...built.definition,
    bodyMaterialConfigId,
  }
}

function buildDefaultFloorDefinition(preset: FloorPresetData): FloorDynamicMesh {
  return {
    type: 'Floor',
    vertices: [
      [-DEFAULT_RECT_HALF_SIZE, -DEFAULT_RECT_HALF_SIZE],
      [-DEFAULT_RECT_HALF_SIZE, DEFAULT_RECT_HALF_SIZE],
      [DEFAULT_RECT_HALF_SIZE, DEFAULT_RECT_HALF_SIZE],
      [DEFAULT_RECT_HALF_SIZE, -DEFAULT_RECT_HALF_SIZE],
    ],
    topBottomMaterialConfigId: preset.materialConfig.topBottomMaterialConfigId,
    sideMaterialConfigId: preset.materialConfig.sideMaterialConfigId,
    smooth: preset.floorProps.smooth,
    thickness: preset.floorProps.thickness,
    sideUvScale: {
      x: preset.floorProps.sideUvScale.x,
      y: preset.floorProps.sideUvScale.y,
    },
  }
}

async function buildWallPreviewObject(preset: WallPresetData): Promise<THREE.Object3D> {
  const definition = buildDefaultWallDefinition(preset)
  const wallProps = preset.wallProps

  const [bodyObject, headObject, footObject, bodyEndCapObject, headEndCapObject, footEndCapObject] = await Promise.all([
    loadAssetObject(wallProps.bodyAssetId),
    loadAssetObject(wallProps.headAssetId),
    loadAssetObject(wallProps.footAssetId),
    loadAssetObject(wallProps.bodyEndCapAssetId),
    loadAssetObject(wallProps.headEndCapAssetId),
    loadAssetObject(wallProps.footEndCapAssetId),
  ])

  const bodyCornerIds = Array.from(
    new Set((wallProps.cornerModels ?? []).map((entry) => entry?.bodyAssetId).filter((value): value is string => typeof value === 'string' && value.trim().length > 0)),
  )
  const headCornerIds = Array.from(
    new Set((wallProps.cornerModels ?? []).map((entry) => entry?.headAssetId).filter((value): value is string => typeof value === 'string' && value.trim().length > 0)),
  )
  const footCornerIds = Array.from(
    new Set((wallProps.cornerModels ?? []).map((entry) => entry?.footAssetId).filter((value): value is string => typeof value === 'string' && value.trim().length > 0)),
  )

  const [bodyCornerObjects, headCornerObjects, footCornerObjects] = await Promise.all([
    Promise.all(bodyCornerIds.map(async (assetId) => [assetId, await loadAssetObject(assetId)] as const)),
    Promise.all(headCornerIds.map(async (assetId) => [assetId, await loadAssetObject(assetId)] as const)),
    Promise.all(footCornerIds.map(async (assetId) => [assetId, await loadAssetObject(assetId)] as const)),
  ])

  const group = createWallRenderGroup(
    definition,
    {
      bodyObject,
      headObject,
      footObject,
      bodyEndCapObject,
      headEndCapObject,
      footEndCapObject,
      bodyCornerObjectsByAssetId: Object.fromEntries(bodyCornerObjects),
      headCornerObjectsByAssetId: Object.fromEntries(headCornerObjects),
      footCornerObjectsByAssetId: Object.fromEntries(footCornerObjects),
    },
    {
      smoothing: wallProps.smoothing,
      bodyMaterialConfigId: wallProps.bodyMaterialConfigId ?? preset.materialOrder?.[0] ?? null,
      cornerModels: wallProps.cornerModels,
      bodyUvAxis: wallProps.bodyUvAxis,
      headUvAxis: wallProps.headUvAxis,
      footUvAxis: wallProps.footUvAxis,
      bodyOrientation: wallProps.bodyOrientation,
      headOrientation: wallProps.headOrientation,
      footOrientation: wallProps.footOrientation,
      bodyEndCapOrientation: wallProps.bodyEndCapOrientation,
      headEndCapOrientation: wallProps.headEndCapOrientation,
      footEndCapOrientation: wallProps.footEndCapOrientation,
    },
  )

  applyMaterialOverrides(group, buildWallNodeMaterials(preset), materialOverrideOptions)
  applyAirWallVisualToWallGroup(group, Boolean(wallProps.isAirWall))
  return group
}

async function buildFloorPreviewObject(preset: FloorPresetData): Promise<THREE.Object3D> {
  const group = createFloorGroup(buildDefaultFloorDefinition(preset))
  applyMaterialOverrides(group, buildFloorNodeMaterials(preset), materialOverrideOptions)
  return group
}

async function loadPresetScene(): Promise<void> {
  const token = ++loadToken
  clearScene()

  if (!scene || !camera || !controls || !props.file) {
    return
  }

  try {
    const parsed = await parsePreset(props.file)
    if (token !== loadToken) {
      return
    }

    const object = parsed.kind === 'wall'
      ? await buildWallPreviewObject(parsed.data)
      : await buildFloorPreviewObject(parsed.data)

    if (token !== loadToken) {
      disposeObject(object)
      return
    }

    currentRoot = object
    scene.add(object)
    fitCamera(object)
    emitDimensions(object)
  } catch (loadError) {
    if (token === loadToken) {
      error.value = (loadError as Error).message ?? '预览生成失败'
    }
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

function setupScene(): void {
  if (!container.value) {
    return
  }
  scene = new THREE.Scene()
  scene.background = null

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
  camera.position.set(5, 4, 5)

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
  const directional = new THREE.DirectionalLight(0xffffff, 2)
  directional.position.set(5, 10, 7.5)
  const fillLight = new THREE.DirectionalLight(0xffffff, 1)
  fillLight.position.set(-5, 2, -6)
  scene.add(ambient)
  scene.add(directional)
  scene.add(fillLight)

  window.addEventListener('resize', handleResize)
  handleResize()
  renderLoop()
}

watch(
  () => [props.file, props.kind],
  () => {
    void loadPresetScene()
  },
  { immediate: true },
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
  clearScene()
  assetObjectCache.forEach((object) => disposeObject(object))
  assetObjectCache.clear()
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
  if (!source.width || !source.height || error.value) {
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

.preset-preview__canvas,
.preset-preview__canvas canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
}

.preset-preview__error {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.92);
  text-align: center;
  padding: 20px;
}

.preset-preview__error-text {
  font-size: 0.95rem;
}
</style>
