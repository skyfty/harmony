<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { SceneNode, Vector3Like } from '@/types/scene'
import { useSceneStore, getRuntimeObject } from '@/stores/sceneStore'
import type { SceneCameraState } from '@/stores/sceneStore'

type EditorTool = 'select' | 'translate' | 'rotate' | 'scale'

const props = defineProps<{
  activeTool: EditorTool
  sceneNodes: SceneNode[]
  selectedNodeId: string | null
  cameraState: SceneCameraState
}>()

const emit = defineEmits<{
  (event: 'changeTool', tool: EditorTool): void
  (event: 'selectNode', nodeId: string | null): void
  (event: 'updateNodeTransform', payload: {
    id: string
    position: Vector3Like
    rotation: Vector3Like
    scale: Vector3Like
  }): void
  (event: 'updateCamera', payload: SceneCameraState): void
}>()

const sceneStore = useSceneStore()

const tools: Array<{ label: string; icon: string; value: EditorTool }> = [
  { label: 'Select', icon: 'mdi-cursor-default', value: 'select' },
  { label: 'Move', icon: 'mdi-axis-arrow', value: 'translate' },
  { label: 'Rotate', icon: 'mdi-rotate-3d-variant', value: 'rotate' },
  { label: 'Scale', icon: 'mdi-cube-scan', value: 'scale' },
]

const viewportEl = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const surfaceRef = ref<HTMLDivElement | null>(null)

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let orbitControls: OrbitControls | null = null
let transformControls: TransformControls | null = null
let resizeObserver: ResizeObserver | null = null
let selectionBoxHelper: THREE.Box3Helper | null = null
let selectionTrackedObject: THREE.Object3D | null = null
let gridHighlight: THREE.Mesh | null = null

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const rootGroup = new THREE.Group()
const objectMap = new Map<string, THREE.Object3D>()
let isApplyingCameraState = false
const THUMBNAIL_CAPTURE_DELAY_MS = 1500
let thumbnailCaptureTimeout: ReturnType<typeof setTimeout> | null = null
const ASSET_DRAG_MIME = 'application/x-harmony-asset'
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const MIN_CAMERA_HEIGHT = 0.25
const MIN_TARGET_HEIGHT = 0
const GRID_CELL_SIZE = 1
const GRID_HIGHLIGHT_HEIGHT = 0.02

const isDragHovering = ref(false)

const draggingChangedHandler = (event: unknown) => {
  const value = (event as { value?: boolean })?.value ?? false
  if (orbitControls) {
    orbitControls.enabled = !value
  }

  if (!value) {
    updateGridHighlight(null)
  } else if (transformControls?.getMode() === 'translate' && transformControls?.object) {
    updateGridHighlight((transformControls.object as THREE.Object3D).position)
  }
}

const gridHelper = new THREE.GridHelper(1000, 1000, 0x4dd0e1, 0x263238)
const gridMaterial = gridHelper.material as THREE.Material
gridMaterial.depthWrite = false
gridMaterial.opacity = 0.25
gridMaterial.transparent = true

const axesHelper = new THREE.AxesHelper(4)

function clampCameraAboveGround(forceUpdate = true) {
  if (!camera || !orbitControls) return false

  let adjusted = false

  if (camera.position.y < MIN_CAMERA_HEIGHT) {
    camera.position.y = MIN_CAMERA_HEIGHT
    adjusted = true
  }

  if (orbitControls.target.y < MIN_TARGET_HEIGHT) {
    orbitControls.target.y = MIN_TARGET_HEIGHT
    adjusted = true
  }

  if (adjusted && forceUpdate) {
    const prevApplying = isApplyingCameraState
    if (!prevApplying) {
      isApplyingCameraState = true
    }
    orbitControls.update()
    if (!prevApplying) {
      isApplyingCameraState = false
    }
  }

  return adjusted
}

function snapVectorToGrid(vec: THREE.Vector3) {
  vec.x = Math.floor(vec.x / GRID_CELL_SIZE) * GRID_CELL_SIZE + GRID_CELL_SIZE / 2
  vec.z = Math.floor(vec.z / GRID_CELL_SIZE) * GRID_CELL_SIZE + GRID_CELL_SIZE / 2
  return vec
}

function clearSelectionBox() {
  if (!selectionBoxHelper) return

  if (selectionBoxHelper.parent) {
    selectionBoxHelper.parent.remove(selectionBoxHelper)
  }

  selectionBoxHelper.geometry.dispose()
  if (Array.isArray(selectionBoxHelper.material)) {
    selectionBoxHelper.material.forEach((material) => material.dispose())
  } else {
    selectionBoxHelper.material.dispose()
  }

  selectionBoxHelper = null
  selectionTrackedObject = null
}

function updateSelectionBox(object: THREE.Object3D | null) {
  if (!scene) {
    selectionTrackedObject = object
    return
  }

  if (!object) {
    clearSelectionBox()
    return
  }

  if (!selectionBoxHelper) {
    const box = new THREE.Box3().setFromObject(object)
    selectionBoxHelper = new THREE.Box3Helper(box, 0x82b1ff)
    selectionBoxHelper.frustumCulled = false
    scene.add(selectionBoxHelper)
  } else {
    selectionBoxHelper.box.setFromObject(object)
    if (!selectionBoxHelper.parent) {
      scene.add(selectionBoxHelper)
    }
  }

  selectionTrackedObject = object
}

function buildCameraState(): SceneCameraState | null {
  if (!camera || !orbitControls) return null
  return {
    position: toVector3Like(camera.position),
    target: toVector3Like(orbitControls.target),
    fov: camera.fov,
  }
}

function applyCameraState(state: SceneCameraState | null | undefined) {
  if (!state || !camera || !orbitControls) return
  isApplyingCameraState = true
  camera.position.set(state.position.x, state.position.y, state.position.z)
  if (camera.position.y < MIN_CAMERA_HEIGHT) {
    camera.position.y = MIN_CAMERA_HEIGHT
  }
  camera.fov = state.fov
  camera.updateProjectionMatrix()
  const clampedTargetY = Math.max(state.target.y, MIN_TARGET_HEIGHT)
  orbitControls.target.set(state.target.x, clampedTargetY, state.target.z)
  orbitControls.update()
  isApplyingCameraState = false
}

function handleControlsChange() {
  if (isApplyingCameraState) return
  clampCameraAboveGround()
  const snapshot = buildCameraState()
  if (snapshot) {
    emit('updateCamera', snapshot)
  }
}

function initScene() {
  if (!canvasRef.value || !viewportEl.value) {
    return
  }

  const width = viewportEl.value.clientWidth
  const height = viewportEl.value.clientHeight

  renderer = new THREE.WebGLRenderer({
    canvas: canvasRef.value,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(width, height)
  renderer.shadowMap.enabled = true

  scene = new THREE.Scene()

  scene.background = new THREE.Color(0x696969)
  scene.fog = new THREE.Fog( scene.background, 1, 5000 );
  scene.add(rootGroup)
  scene.add(gridHelper)
  scene.add(axesHelper)
  gridHighlight = createGridHighlight()
  scene.add(gridHighlight)
  if (selectionTrackedObject) {
    updateSelectionBox(selectionTrackedObject)
  }

  const hemiLight = new THREE.HemisphereLight(0xb3e5fc, 0x1c313a, 0.5)
  scene.add(hemiLight)

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
  dirLight.position.set(10, 20, 10)
  dirLight.castShadow = true
  scene.add(dirLight)

  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 500)
  camera.position.set(12, 9, 12)
  camera.lookAt(new THREE.Vector3(0, 1, 0))

  orbitControls = new OrbitControls(camera, canvasRef.value)
  orbitControls.enableDamping = false
  orbitControls.dampingFactor = 0.05
  orbitControls.target.set(0, 1, 0)
  orbitControls.addEventListener('change', handleControlsChange)

  transformControls = new TransformControls(camera, canvasRef.value)
  transformControls.addEventListener('dragging-changed', draggingChangedHandler as any)
  transformControls.addEventListener('objectChange', handleTransformChange)
  scene.add(transformControls.getHelper())

  canvasRef.value.addEventListener('pointerdown', handlePointerDown)

  resizeObserver = new ResizeObserver(() => {
    if (!renderer || !camera || !viewportEl.value) return
    const w = viewportEl.value.clientWidth
    const h = viewportEl.value.clientHeight
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  })
  resizeObserver.observe(viewportEl.value)

  animate()
  
  applyCameraState(props.cameraState)
}

function animate() {
  if (!renderer || !scene || !camera) {
    return
  }

  requestAnimationFrame(animate)

  if (orbitControls) {
    orbitControls.update()
  }

  if (selectionBoxHelper && selectionTrackedObject) {
    selectionBoxHelper.box.setFromObject(selectionTrackedObject)
  }
  renderer.render(scene, camera)
}

function disposeScene() {
  resizeObserver?.disconnect()
  resizeObserver = null

  if (canvasRef.value) {
    canvasRef.value.removeEventListener('pointerdown', handlePointerDown)
  }

  transformControls?.removeEventListener('dragging-changed', draggingChangedHandler as any)
  transformControls?.removeEventListener('objectChange', handleTransformChange)
  transformControls?.dispose()
  transformControls = null

  if (orbitControls) {
    orbitControls.removeEventListener('change', handleControlsChange)
    orbitControls.dispose()
  }
  orbitControls = null

  if (thumbnailCaptureTimeout) {
    clearTimeout(thumbnailCaptureTimeout)
    thumbnailCaptureTimeout = null
  }

  renderer?.dispose()
  renderer = null

  if (gridHighlight) {
    gridHighlight.removeFromParent()
    gridHighlight.geometry.dispose()
    const highlightMaterial = gridHighlight.material as THREE.Material
    highlightMaterial.dispose()
    gridHighlight = null
  }

  clearSelectionBox()

  scene = null
  camera = null

  objectMap.clear()
}

function scheduleThumbnailCapture() {
  if (!renderer) {
    return
  }
  if (thumbnailCaptureTimeout) {
    clearTimeout(thumbnailCaptureTimeout)
  }
  thumbnailCaptureTimeout = setTimeout(() => {
    thumbnailCaptureTimeout = null
    captureThumbnail()
  }, THUMBNAIL_CAPTURE_DELAY_MS)
}

function captureThumbnail() {
  if (!renderer || !sceneStore.currentSceneId) {
    return
  }

  try {
    const thumbnail = renderer.domElement.toDataURL('image/png')
    sceneStore.updateSceneThumbnail(sceneStore.currentSceneId, thumbnail)
  } catch (error) {
    console.warn('Failed to capture scene thumbnail', error)
  }
}

function createGridHighlight() {
  const geometry = new THREE.PlaneGeometry(GRID_CELL_SIZE, GRID_CELL_SIZE)
  const material = new THREE.MeshBasicMaterial({
    color: 0x4dd0e1,
    opacity: 0.3,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const highlight = new THREE.Mesh(geometry, material)
  highlight.rotation.x = -Math.PI / 2
  highlight.position.y = GRID_HIGHLIGHT_HEIGHT
  highlight.visible = false
  highlight.renderOrder = 1
  return highlight
}

function updateGridHighlight(position: THREE.Vector3 | null) {
  if (!gridHighlight) {
    return
  }
  if (!position) {
    gridHighlight.visible = false
    return
  }
  gridHighlight.visible = true
  gridHighlight.position.set(position.x, GRID_HIGHLIGHT_HEIGHT, position.z)
}

function handlePointerDown(event: PointerEvent) {
  if (!canvasRef.value || !camera || !scene) {
    return
  }

  if (transformControls?.dragging) {
    return
  }

  const rect = canvasRef.value.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(pointer, camera)
  const intersects = raycaster.intersectObjects(rootGroup.children, true)

  const hit = intersects.find((intersection) => intersection.object.userData?.nodeId)

  if (hit) {
    const nodeId = hit.object.userData.nodeId as string
    emit('selectNode', nodeId)
  } else {
    emit('selectNode', null)
  }
}

function extractAssetPayload(event: DragEvent): { assetId: string } | null {
  if (!event.dataTransfer) return null
  const raw = event.dataTransfer.getData(ASSET_DRAG_MIME)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.assetId && typeof parsed.assetId === 'string') {
      return { assetId: parsed.assetId }
    }
  } catch (error) {
    console.warn('Failed to parse drag payload', error)
  }
  return null
}

function isAssetDrag(event: DragEvent): boolean {
  if (!event.dataTransfer) return false
  return Array.from(event.dataTransfer.types ?? []).includes(ASSET_DRAG_MIME)
}

function computeDropPoint(event: DragEvent): THREE.Vector3 | null {
  if (!camera || !canvasRef.value) return null
  const rect = canvasRef.value.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1
  const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1
  pointer.set(ndcX, ndcY)
  raycaster.setFromCamera(pointer, camera)
  const planeHit = new THREE.Vector3()
  if (raycaster.ray.intersectPlane(groundPlane, planeHit)) {
    return snapVectorToGrid(planeHit.clone())
  }
  const intersections = raycaster.intersectObjects(rootGroup.children, true)
  if (intersections.length > 0) {
    const first = intersections[0]
    const point = first?.point.clone() ?? null
    return point ? snapVectorToGrid(point) : null
  }
  return null
}

function handleViewportDragEnter(event: DragEvent) {
  if (!isAssetDrag(event)) return
  event.preventDefault()
  isDragHovering.value = true
}

function handleViewportDragOver(event: DragEvent) {
  if (!isAssetDrag(event)) return
  const point = computeDropPoint(event)
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  isDragHovering.value = true
  updateGridHighlight(point)
}

function handleViewportDragLeave(event: DragEvent) {
  if (!isAssetDrag(event)) return
  const surface = surfaceRef.value
  const related = event.relatedTarget as Node | null
  if (surface && related && surface.contains(related)) {
    return
  }
  isDragHovering.value = false
  updateGridHighlight(null)
}

async function handleViewportDrop(event: DragEvent) {
  if (!isAssetDrag(event)) return
  const payload = extractAssetPayload(event)
  const point = computeDropPoint(event)
  event.preventDefault()
  event.stopPropagation()
  isDragHovering.value = false
  if (!payload) return

  const spawnPoint = point ? point.clone() : new THREE.Vector3(0, 0, 0)
  snapVectorToGrid(spawnPoint)
  try {
    await sceneStore.spawnAssetAtPosition(payload.assetId, toVector3Like(spawnPoint))
    scheduleThumbnailCapture()
  } catch (error) {
    console.warn('Failed to spawn asset for drag payload', payload.assetId, error)
  }
  updateGridHighlight(null)
}

function handleTransformChange() {
  if (!transformControls) return
  const target = transformControls.object as THREE.Object3D | null
  if (!target || !target.userData?.nodeId) {
    return
  }

  if (transformControls.getMode() === 'translate') {
    snapVectorToGrid(target.position)
  }

  updateSelectionBox(target)

  emit('updateNodeTransform', {
    id: target.userData.nodeId as string,
    position: toVector3Like(target.position),
    rotation: toEulerLike(target.rotation),
    scale: toVector3Like(target.scale),
  })

  scheduleThumbnailCapture()
  if (transformControls?.getMode() === 'translate') {
    updateGridHighlight(target.position)
  }
}

function syncSceneGraph() {
  if (!scene) return

  disposeSceneNodes()
  rootGroup.clear()
  objectMap.clear()

  for (const node of props.sceneNodes) {
    const object = createObjectFromNode(node)
    rootGroup.add(object)
  }

  // 重新附加选择并确保工具模式正确
  attachSelection(props.selectedNodeId, props.activeTool)

  scheduleThumbnailCapture()
}

function disposeSceneNodes() {
  clearSelectionBox()
  rootGroup.traverse((child) => {
    const nodeId = child.userData?.nodeId as string | undefined
    if (nodeId && sceneStore.hasRuntimeObject(nodeId)) {
      return
    }

    const meshLike = child as THREE.Mesh
    if (meshLike.geometry) {
      meshLike.geometry.dispose()
    }
    if (meshLike.material) {
      const material = meshLike.material
      if (Array.isArray(material)) {
        material.forEach((mat) => mat.dispose())
      } else {
        material.dispose()
      }
    }
  })
}

function createObjectFromNode(node: SceneNode): THREE.Object3D {
  let object: THREE.Object3D

  if (node.geometry === 'external') {
    const container = new THREE.Group()
    container.userData.nodeId = node.id

    const runtimeObject = getRuntimeObject(node.resourceId ?? node.id)
    if (runtimeObject) {
      runtimeObject.removeFromParent()
      runtimeObject.userData.nodeId = node.id
      runtimeObject.traverse((child) => {
        const meshChild = child as THREE.Mesh
        if (meshChild?.isMesh) {
          meshChild.castShadow = true
          meshChild.receiveShadow = true
        }
      })
      container.add(runtimeObject)
    } else {
      const fallbackMaterial = new THREE.MeshBasicMaterial({ color: 0xff5252, wireframe: true })
      const fallback = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), fallbackMaterial)
      fallback.userData.nodeId = node.id
      container.add(fallback)
    }

    object = container
  } else {
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(node.material.color),
      wireframe: node.material.wireframe ?? false,
      opacity: node.material.opacity ?? 1,
      transparent: (node.material.opacity ?? 1) < 1,
      metalness: 0.1,
      roughness: 0.6,
    })

    switch (node.geometry) {
      case 'sphere':
        object = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 32), material)
        break
      case 'plane': {
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
        plane.rotateX(-Math.PI / 2)
        object = plane
        break
      }
      case 'box':
      default:
        object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
        break
    }

    const mesh = object as THREE.Mesh
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.nodeId = node.id
  }

  object.position.set(node.position.x, node.position.y, node.position.z)
  object.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z)
  object.scale.set(node.scale.x, node.scale.y, node.scale.z)

  objectMap.set(node.id, object)

  if (node.children) {
    for (const child of node.children) {
      object.add(createObjectFromNode(child))
    }
  }

  return object
}

function attachSelection(nodeId: string | null, tool: EditorTool = props.activeTool) {
  const target = nodeId ? objectMap.get(nodeId) ?? null : null
  updateSelectionBox(target)

  if (!transformControls) return

  if (!nodeId) {
    transformControls.detach()
    updateGridHighlight(null)
    return
  }

  if (!target) {
    transformControls.detach()
    updateGridHighlight(null)
    return
  }

  if (tool === 'select') {
    transformControls.detach()
    updateGridHighlight(null)
    return
  }

  // 确保在附加前设置正确的模式
  transformControls.setMode(tool)
  transformControls.attach(target)
}

function updateToolMode(tool: EditorTool) {
  if (!transformControls) return

  transformControls.enabled = tool !== 'select'

  if (tool === 'select') {
    transformControls.detach()
    updateGridHighlight(null)
    return
  }

  transformControls.setMode(tool)
  if (tool !== 'translate') {
    updateGridHighlight(null)
  }
  if (props.selectedNodeId) {
    attachSelection(props.selectedNodeId, tool)
  }
}

function toVector3Like(vec: THREE.Vector3): Vector3Like {
  return { x: vec.x, y: vec.y, z: vec.z }
}

function toEulerLike(euler: THREE.Euler): Vector3Like {
  return { x: euler.x, y: euler.y, z: euler.z }
}

onMounted(() => {
  initScene()
  syncSceneGraph()
  updateToolMode(props.activeTool)
  attachSelection(props.selectedNodeId)
})

onBeforeUnmount(() => {
  disposeSceneNodes()
  disposeScene()
})

watch(
  () => props.sceneNodes,
  () => {
    syncSceneGraph()
  }
)

watch(
  () => props.cameraState,
  (state) => {
    applyCameraState(state)
  },
  { deep: true }
)

watch(
  () => props.selectedNodeId,
  (id) => {
    attachSelection(id)
  }
)

watch(
  () => props.activeTool,
  (tool) => {
    updateToolMode(tool)
  }
)
</script>

<template>
  <div ref="viewportEl" class="scene-viewport">
    <div class="tool-strip">
      <v-card class="tool-card" elevation="6">
        <v-btn
          v-for="tool in tools"
          :key="tool.value"
          :icon="tool.icon"
          :color="props.activeTool === tool.value ? 'primary' : undefined"
          :variant="props.activeTool === tool.value ? 'flat' : 'text'"
          density="comfortable"
          class="tool-button"
          @click="emit('changeTool', tool.value)"
        />
      </v-card>
    </div>
    <div
      ref="surfaceRef"
      class="viewport-surface"
      :class="{ 'is-drag-hover': isDragHovering }"
      @dragenter="handleViewportDragEnter"
      @dragover="handleViewportDragOver"
      @dragleave="handleViewportDragLeave"
      @drop="handleViewportDrop"
    >
      <canvas ref="canvasRef" class="viewport-canvas" />
    </div>
  </div>
</template>

<style scoped>
.scene-viewport {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: radial-gradient(circle at 20% 20%, rgba(81, 199, 247, 0.08), rgba(12, 15, 21, 0.95));
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  overflow: hidden;
}

.tool-strip {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 5;
}

.tool-card {
  display: flex;
  flex-direction: column;
  background-color: rgba(18, 21, 26, 0.92);
  border-radius: 12px;
  padding: 8px;
  gap: 4px;
}

.tool-button {
  border-radius: 10px;
}

.viewport-surface {
  flex: 1;
  position: relative;
}

.viewport-surface.is-drag-hover::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: 8px;
  z-index: 3;
}

.drop-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: rgba(233, 236, 241, 0.9);
  font-size: 0.95rem;
  pointer-events: none;
  z-index: 4;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
}

.viewport-canvas {
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
}

.viewport-canvas:active {
  cursor: grabbing;
}
</style>
