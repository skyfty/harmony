<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { SceneNode, Vector3Like } from '@/types/scene'
import { useSceneStore, getRuntimeObject } from '@/stores/sceneStore'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import type { SceneCameraState } from '@/types/scene-camera-state'
import type { EditorTool } from '@/types/editor-tool'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { loadObjectFromFile } from '@/plugins/assetImport'


const props = defineProps<{
  sceneNodes: SceneNode[]
  activeTool: EditorTool
  selectedNodeId: string | null
  cameraState: SceneCameraState
  focusNodeId: string | null
  focusRequestId: number
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
const assetCacheStore = useAssetCacheStore()

const tools: Array<{ label: string; icon: string; value: EditorTool, key: string }> = [
  { label: 'Select', icon: 'mdi-cursor-default', value: 'select', key: 'KeyQ' },
  { label: 'Move', icon: 'mdi-axis-arrow', value: 'translate', key: 'KeyW' },
  { label: 'Rotate', icon: 'mdi-rotate-3d-variant', value: 'rotate', key: 'KeyE' },
  { label: 'Scale', icon: 'mdi-cube-scan', value: 'scale', key: 'KeyR' },
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

interface PlaceholderOverlayState {
  id: string
  name: string
  progress: number
  error: string | null
  visible: boolean
  x: number
  y: number
}

const overlayContainerRef = ref<HTMLDivElement | null>(null)
const placeholderOverlays = reactive<Record<string, PlaceholderOverlayState>>({})
const placeholderOverlayList = computed(() => Object.values(placeholderOverlays))
const overlayPositionHelper = new THREE.Vector3()

const draggingChangedHandler = (event: unknown) => {
  const value = (event as { value?: boolean })?.value ?? false
  if (orbitControls) {
    orbitControls.enabled = !value
  }

  if (!value) {
    sceneStore.endTransformInteraction()
    updateGridHighlight(null)
  } else {
    const nodeId = (transformControls?.object as THREE.Object3D | null)?.userData?.nodeId as string | undefined
    sceneStore.beginTransformInteraction(nodeId ?? null)
    if (transformControls?.getMode() === 'translate' && transformControls.object) {
      updateGridHighlight((transformControls.object as THREE.Object3D).position)
    }
  }
}

const gridHelper = new THREE.GridHelper(1000, 1000, 0x4dd0e1, 0x263238)
const gridMaterial = gridHelper.material as THREE.Material
gridMaterial.depthWrite = false
gridMaterial.opacity = 0.25
gridMaterial.transparent = true

const axesHelper = new THREE.AxesHelper(4)

const dragPreviewGroup = new THREE.Group()
dragPreviewGroup.visible = false
dragPreviewGroup.name = 'DragPreview'

let dragPreviewObject: THREE.Object3D | null = null
let dragPreviewAssetId: string | null = null
let pendingPreviewAssetId: string | null = null
let dragPreviewLoadToken = 0
let lastDragPoint: THREE.Vector3 | null = null
let fallbackLightGroup: THREE.Group | null = null

function findAssetMetadata(assetId: string): ProjectAsset | null {
  const search = (directories: ProjectDirectory[] | undefined): ProjectAsset | null => {
    if (!directories) {
      return null
    }
    for (const directory of directories) {
      if (directory.assets) {
        const match = directory.assets.find((asset) => asset.id === assetId)
        if (match) {
          return match
        }
      }
      if (directory.children && directory.children.length > 0) {
        const nested = search(directory.children)
        if (nested) {
          return nested
        }
      }
    }
    return null
  }

  return search(sceneStore.projectTree)
}

function disposeObjectResources(object: THREE.Object3D) {
  object.traverse((child) => {
    const meshChild = child as THREE.Mesh
    if (meshChild?.isMesh) {
      if (meshChild.geometry) {
        meshChild.geometry.dispose()
      }
      const materials = Array.isArray(meshChild.material) ? meshChild.material : [meshChild.material]
      for (const material of materials) {
        material?.dispose()
      }
    }
  })
}

function clearDragPreviewObject(disposeResources = true) {
  if (dragPreviewObject && disposeResources) {
    disposeObjectResources(dragPreviewObject)
  }
  dragPreviewGroup.clear()
  dragPreviewObject = null
  dragPreviewAssetId = null
  dragPreviewGroup.visible = false
}

function disposeDragPreview(cancelLoad = true) {
  if (cancelLoad) {
    dragPreviewLoadToken += 1
    pendingPreviewAssetId = null
  }
  lastDragPoint = null
  clearDragPreviewObject()
}

function refreshPlaceholderOverlays() {
  const activeIds = new Set<string>()

  const visit = (nodes: SceneNode[]) => {
    nodes.forEach((node) => {
      if (node.isPlaceholder) {
        activeIds.add(node.id)
        const progress = Math.min(100, Math.max(0, node.downloadProgress ?? 0))
        const error = node.downloadError ?? null
        const existing = placeholderOverlays[node.id]
        if (existing) {
          existing.name = node.name
          existing.progress = progress
          existing.error = error
        } else {
          placeholderOverlays[node.id] = {
            id: node.id,
            name: node.name,
            progress,
            error,
            visible: true,
            x: 0,
            y: 0,
          }
        }
      }

      if (node.children?.length) {
        visit(node.children)
      }
    })
  }

  visit(props.sceneNodes)

  Object.keys(placeholderOverlays).forEach((id) => {
    if (!activeIds.has(id)) {
      delete placeholderOverlays[id]
    }
  })
}

function clearPlaceholderOverlays() {
  Object.keys(placeholderOverlays).forEach((id) => {
    delete placeholderOverlays[id]
  })
}

function updatePlaceholderOverlayPositions() {
  const activeCamera = camera
  if (!activeCamera || !overlayContainerRef.value) {
    return
  }

  const bounds = overlayContainerRef.value.getBoundingClientRect()
  const width = bounds.width
  const height = bounds.height

  if (width === 0 || height === 0) {
    placeholderOverlayList.value.forEach((overlay) => {
      overlay.visible = false
    })
    return
  }

  placeholderOverlayList.value.forEach((overlay) => {
    const object = objectMap.get(overlay.id)
    if (!object) {
      overlay.visible = false
      return
    }

    overlayPositionHelper.setFromMatrixPosition(object.matrixWorld)
    overlayPositionHelper.project(activeCamera)

    if (overlayPositionHelper.z < -1 || overlayPositionHelper.z > 1) {
      overlay.visible = false
      return
    }

    overlay.visible = true
    overlay.x = (overlayPositionHelper.x * 0.5 + 0.5) * width
    overlay.y = (-overlayPositionHelper.y * 0.5 + 0.5) * height
  })
}

function applyPreviewVisualTweaks(object: THREE.Object3D) {
  object.traverse((child) => {
    const meshChild = child as THREE.Mesh
    if (meshChild?.isMesh) {
      const materials = Array.isArray(meshChild.material) ? meshChild.material : [meshChild.material]
      for (const material of materials) {
        if (!material) {
          continue
        }
        material.transparent = true
        material.opacity = Math.min(0.75, material.opacity ?? 1)
        material.depthWrite = false
      }
    }
  })
}

function setDragPreviewPosition(point: THREE.Vector3 | null) {
  lastDragPoint = point ? point.clone() : null
  if (!dragPreviewObject || !point) {
    dragPreviewGroup.visible = false
    return
  }
  dragPreviewGroup.position.copy(point)
  dragPreviewGroup.visible = true
}

async function loadDragPreviewForAsset(asset: ProjectAsset): Promise<boolean> {
  if (pendingPreviewAssetId === asset.id) {
    return false
  }

  pendingPreviewAssetId = asset.id
  clearDragPreviewObject()
  const token = ++dragPreviewLoadToken
  const file = assetCacheStore.createFileFromCache(asset.id)
  if (!file) {
    pendingPreviewAssetId = null
    return false
  }

  console.log('Loading drag preview for asset', asset.id, asset.name)

  try {
    const object = await loadObjectFromFile(file)
    if (token !== dragPreviewLoadToken) {
      disposeObjectResources(object)
      return false
    }
    applyPreviewVisualTweaks(object)
    dragPreviewObject = object
    dragPreviewAssetId = asset.id
    dragPreviewGroup.add(object)
    if (lastDragPoint) {
      dragPreviewGroup.position.copy(lastDragPoint)
      dragPreviewGroup.visible = true
    } else {
      dragPreviewGroup.visible = false
    }
    pendingPreviewAssetId = null
    return true
  } catch (error) {
    if (token === dragPreviewLoadToken) {
      clearDragPreviewObject()
    }
    pendingPreviewAssetId = null
    console.warn('Failed to load drag preview object', error)
    return false
  }
}

function prepareDragPreview(assetId: string) {
  const asset = findAssetMetadata(assetId)
  if (!asset || asset.type !== 'model') {
    disposeDragPreview()
    return
  }

  if (dragPreviewAssetId === asset.id && dragPreviewObject) {
    if (lastDragPoint) {
      dragPreviewGroup.position.copy(lastDragPoint)
      dragPreviewGroup.visible = true
    }
    return
  }

  if (pendingPreviewAssetId === asset.id) {
    return
  }

  void loadDragPreviewForAsset(asset)
}

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

import { exportGLTF, exportGLB,exportOBJ, exportPLY, exportSTL,type SceneExportOptions } from '@/plugins/exporter'
export type SceneViewportHandle = {
  exportScene(options: SceneExportOptions): Promise<void>
}

function sanitizeFileName(input: string): string {
    return input.replace(/[^a-zA-Z0-9-_\.]+/g, '_') || 'scene'
}

function triggerDownload(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.style.display = 'none'
    anchor.href = url
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    requestAnimationFrame(() => URL.revokeObjectURL(url))
}


async function exportScene(options: SceneExportOptions): Promise<void> {
  if (!scene) {
    throw new Error('Scene not initialized')
  }
  const { format, onProgress } = options
  let fileName = sanitizeFileName(options.fileName ?? 'scene-export')

  onProgress?.(10, 'Preparing scene…')
  let blob: Blob | null  = null
  try {
      switch (format) {
          case 'GLTF':
              fileName += '.gltf'
              blob = await exportGLTF(scene)
              break
          case 'GLB':
              fileName += '.glb'
              blob = await exportGLB(scene)
              break
          case 'OBJ': {
            fileName += '.obj'
              if (selectionTrackedObject) {
                blob = exportOBJ(selectionTrackedObject)
              }
              break
          }
          case 'PLY':
              fileName += '.ply'
              blob = exportPLY(scene)
              break
          case 'STL':
              fileName += '.stl'
              blob = exportSTL(scene)
              break
          default:
              throw new Error(`Unsupported export format: ${format}`)
      }
      onProgress?.(95, 'Export complete, preparing download…')

  } finally {
      onProgress?.(100, 'Export complete')
  }
  if (blob) {
      triggerDownload(blob, `${fileName}`)
  }

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

function findSceneNode(nodes: SceneNode[], nodeId: string): SceneNode | null {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return node
    }
    if (node.children) {
      const result = findSceneNode(node.children, nodeId)
      if (result) {
        return result
      }
    }
  }
  return null
}

function focusCameraOnNode(nodeId: string): boolean {
  if (!camera || !orbitControls) {
    return false
  }

  const target = new THREE.Vector3()
  let sizeEstimate = 1

  const object = objectMap.get(nodeId)
  if (object) {
    object.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(object)
    if (!box.isEmpty()) {
      box.getCenter(target)
      const boxSize = new THREE.Vector3()
      box.getSize(boxSize)
      sizeEstimate = Math.max(boxSize.x, boxSize.y, boxSize.z)
    } else {
      object.getWorldPosition(target)
    }
  } else {
    const node = findSceneNode(props.sceneNodes, nodeId)
    if (!node) {
      return false
    }
    target.set(node.position.x, node.position.y, node.position.z)
    sizeEstimate = Math.max(node.scale?.x ?? 1, node.scale?.y ?? 1, node.scale?.z ?? 1, 1)
  }

  sizeEstimate = Math.max(sizeEstimate, 0.5)

  const distance = Math.max(sizeEstimate * 2.75, 6)
  const height = Math.max(sizeEstimate * 1.6, 4)
  const offset = new THREE.Vector3(distance, height, distance)
  const newPosition = target.clone().add(offset)

  isApplyingCameraState = true
  camera.position.copy(newPosition)
  if (camera.position.y < MIN_CAMERA_HEIGHT) {
    camera.position.y = MIN_CAMERA_HEIGHT
  }

  const clampedTargetY = Math.max(target.y, MIN_TARGET_HEIGHT)
  orbitControls.target.set(target.x, clampedTargetY, target.z)
  orbitControls.update()
  isApplyingCameraState = false

  clampCameraAboveGround(false)

  const snapshot = buildCameraState()
  if (snapshot) {
    emit('updateCamera', snapshot)
  }

  return true
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
  scene.add(dragPreviewGroup)
  gridHighlight = createGridHighlight()
  scene.add(gridHighlight)
  ensureFallbackLighting()
  if (selectionTrackedObject) {
    updateSelectionBox(selectionTrackedObject)
  }

  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 500)
  camera.position.set(30, 20, 30)
  camera.lookAt(new THREE.Vector3(0, 5, 0))

  orbitControls = new OrbitControls(camera, canvasRef.value)
  orbitControls.enableDamping = false
  orbitControls.dampingFactor = 0.05
  orbitControls.target.set(0, 5, 0)
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
  updatePlaceholderOverlayPositions()
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

  if (scene && fallbackLightGroup) {
    scene.remove(fallbackLightGroup)
    fallbackLightGroup.clear()
  }
  fallbackLightGroup = null

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
  disposeDragPreview()
  dragPreviewGroup.removeFromParent()

  scene = null
  camera = null

  clearPlaceholderOverlays()
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

  const hit = intersects.find((intersection) => {
    return intersection.object.userData?.nodeId
  })

  if (hit) {
    const nodeId = hit.object.userData.nodeId as string
    emit('selectNode', nodeId)
  } else {
    emit('selectNode', null)
  }
}

function extractAssetPayload(event: DragEvent): { assetId: string } | null {
  if (event.dataTransfer) {
    const raw = event.dataTransfer.getData(ASSET_DRAG_MIME)
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed?.assetId && typeof parsed.assetId === 'string') {
          return { assetId: parsed.assetId }
        }
      } catch (error) {
        console.warn('Failed to parse drag payload', error)
      }
    }
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
  setDragPreviewPosition(point)
  const payload = extractAssetPayload(event)
  if (payload) {
    prepareDragPreview(payload.assetId)
  } else {
    disposeDragPreview()
  }
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
  disposeDragPreview()
}

async function handleViewportDrop(event: DragEvent) {
  if (!isAssetDrag(event)) return
  const payload = extractAssetPayload(event)
  const point = computeDropPoint(event)
  event.preventDefault()
  event.stopPropagation()
  isDragHovering.value = false
  disposeDragPreview()
  if (!payload) {
    sceneStore.setDraggingAssetObject(null)
    return
  }

  const spawnPoint = point ? point.clone() : new THREE.Vector3(0, 0, 0)
  snapVectorToGrid(spawnPoint)
  try {
    await sceneStore.spawnAssetAtPosition(payload.assetId, toVector3Like(spawnPoint))
    scheduleThumbnailCapture()
  } catch (error) {
    console.warn('Failed to spawn asset for drag payload', payload.assetId, error)
  } finally {
    sceneStore.setDraggingAssetObject(null)
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
  refreshPlaceholderOverlays()
  ensureFallbackLighting()
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

function createLightObject(node: SceneNode): THREE.Object3D {
  const container = new THREE.Group()
  container.name = `${node.name}-Light`
  container.userData.nodeId = node.id

  const config = node.light
  if (!config) {
    return container
  }

  let light: THREE.Light

  switch (config.type) {
    case 'directional': {
      const directional = new THREE.DirectionalLight(config.color, config.intensity)
      directional.castShadow = config.castShadow ?? false
      light = directional
      const target = directional.target
      if (config.target) {
        target.position.set(
          config.target.x - node.position.x,
          config.target.y - node.position.y,
          config.target.z - node.position.z,
        )
      }
      container.add(target)
      break
    }
    case 'point': {
      const point = new THREE.PointLight(config.color, config.intensity, config.distance ?? 0, config.decay ?? 1)
      point.castShadow = config.castShadow ?? false
      light = point
      break
    }
    case 'spot': {
      const spot = new THREE.SpotLight(
        config.color,
        config.intensity,
        config.distance ?? 0,
        config.angle ?? Math.PI / 6,
        config.penumbra ?? 0.3,
        config.decay ?? 1,
      )
      spot.castShadow = config.castShadow ?? false
      if (config.target) {
        spot.target.position.set(
          config.target.x - node.position.x,
          config.target.y - node.position.y,
          config.target.z - node.position.z,
        )
        container.add(spot.target)
      }
      light = spot
      break
    }
    case 'ambient':
    default: {
      light = new THREE.AmbientLight(config.color, config.intensity)
      break
    }
  }

  light.userData.nodeId = node.id
  container.add(light)
  return container
}

function ensureFallbackLighting() {
  if (!scene) {
    return
  }

  if (!fallbackLightGroup) {
    fallbackLightGroup = new THREE.Group()
    fallbackLightGroup.name = 'FallbackLights'
    scene.add(fallbackLightGroup)
  }

  fallbackLightGroup.clear()

  let hasLight = false
  rootGroup.traverse((child) => {
    const candidate = child as THREE.Light & { isLight?: boolean }
    if (candidate?.isLight) {
      hasLight = true
    }
  })

  if (!hasLight) {
    const ambient = new THREE.AmbientLight(0xffffff, 0.35)
    const directional = new THREE.DirectionalLight(0xffffff, 0.8)
    directional.position.set(15, 30, 20)
    directional.castShadow = true
    fallbackLightGroup.add(ambient)
    fallbackLightGroup.add(directional)
  }
}

function createObjectFromNode(node: SceneNode): THREE.Object3D {
  let object: THREE.Object3D

  const nodeType = node.nodeType ?? (node.light ? 'light' : 'mesh')

  if (nodeType === 'light') {
    object = createLightObject(node)
  } else {
    const container = new THREE.Group()
    container.userData.nodeId = node.id

    const runtimeObject = getRuntimeObject(node.id)
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
      const fallbackMaterial = node.isPlaceholder
        ? new THREE.MeshBasicMaterial({ color: 0x4dd0e1, wireframe: true, opacity: 0.65, transparent: true })
        : new THREE.MeshBasicMaterial({ color: 0xff5252, wireframe: true })
      const fallback = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), fallbackMaterial)
      fallback.userData.nodeId = node.id
      container.add(fallback)
    }

    object = container
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

  const isVisible = node.visible ?? true
  object.visible = isVisible

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

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return element.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function shouldHandleViewportShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return false
  if (isEditableKeyboardTarget(event.target)) return false
  return true
}

function handleViewportShortcut(event: KeyboardEvent) {
  if (!shouldHandleViewportShortcut(event)) return
  let handled = false

  if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    switch (event.code) {
      case 'Escape':
        if (props.selectedNodeId) {
          emit('selectNode', null)
          handled = true
        }
        break;
      default:
        const tool = tools.find((t) => t.key === event.code);
        if (tool) {
          emit('changeTool', tool.value)
          handled = true
        }
        break
    }
  }

  if (handled) {
    event.preventDefault()
    event.stopPropagation()
  }
}

onMounted(() => {
  initScene()
  syncSceneGraph()
  updateToolMode(props.activeTool)
  attachSelection(props.selectedNodeId)
  window.addEventListener('keyup', handleViewportShortcut, { capture: true })
})

onBeforeUnmount(() => {
  disposeSceneNodes()
  disposeScene()
  window.removeEventListener('keyup', handleViewportShortcut, { capture: true })
})

watch(
  () => props.sceneNodes,
  () => {
    syncSceneGraph()
    refreshPlaceholderOverlays()
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

watch(
  () => props.focusRequestId,
  (token, previous) => {
    if (!props.focusNodeId) {
      return
    }
    if (!token || token === previous) {
      return
    }
    if (focusCameraOnNode(props.focusNodeId)) {
      sceneStore.clearCameraFocusRequest(props.focusNodeId)
    }
  }
)

defineExpose<SceneViewportHandle>({
  exportScene,
})
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
      <div ref="overlayContainerRef" class="placeholder-overlay-layer">
        <div
          v-for="overlay in placeholderOverlayList"
          :key="overlay.id"
          class="placeholder-overlay-card"
          :class="{
            'is-hidden': !overlay.visible,
            'has-error': !!overlay.error,
          }"
          :style="{ left: `${overlay.x}px`, top: `${overlay.y}px` }"
        >
          <div class="placeholder-overlay-name">{{ overlay.name }}</div>
          <div v-if="overlay.error" class="placeholder-overlay-error">{{ overlay.error }}</div>
          <div v-else class="placeholder-overlay-progress">
            <div class="placeholder-overlay-progress-bar">
              <div
                class="placeholder-overlay-progress-value"
                :style="{ width: `${Math.min(100, Math.max(0, overlay.progress))}%` }"
              ></div>
            </div>
            <div class="placeholder-overlay-percent">{{ Math.round(overlay.progress) }}%</div>
          </div>
        </div>
      </div>
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

.placeholder-overlay-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 6;
  font-size: 12px;
}

.placeholder-overlay-card {
  position: absolute;
  transform: translate(-50%, -110%);
  background-color: rgba(13, 17, 23, 0.92);
  border: 1px solid rgba(77, 208, 225, 0.4);
  border-radius: 8px;
  padding: 8px 12px;
  min-width: 140px;
  color: #e9ecf1;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
  transition: opacity 120ms ease;
  opacity: 1;
}

.placeholder-overlay-card.is-hidden {
  opacity: 0;
}

.placeholder-overlay-card.has-error {
  border-color: rgba(244, 67, 54, 0.8);
}

.placeholder-overlay-name {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
}

.placeholder-overlay-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.placeholder-overlay-progress-bar {
  position: relative;
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.15);
}

.placeholder-overlay-progress-value {
  position: absolute;
  inset: 0;
  width: 0;
  background: linear-gradient(90deg, rgba(0, 188, 212, 0.9), rgba(0, 131, 143, 0.9));
}

.placeholder-overlay-percent {
  text-align: right;
  font-size: 11px;
  color: #4dd0e1;
  font-weight: 500;
}

.placeholder-overlay-error {
  font-size: 11px;
  color: #ff8a80;
  max-width: 180px;
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
