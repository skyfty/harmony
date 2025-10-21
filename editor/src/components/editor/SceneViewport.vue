<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import Stats from 'three/examples/jsm/libs/stats.module.js'
import type { SceneNode, Vector3Like } from '@/types/scene'
import type { SceneMaterialTextureSlot, SceneMaterialTextureRef } from '@/types/material'
import { useSceneStore, getRuntimeObject } from '@/stores/sceneStore'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import type { SceneCameraState } from '@/types/scene-camera-state'
import type { EditorTool } from '@/types/editor-tool'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { loadObjectFromFile } from '@/plugins/assetImport'
import { createGeometry } from '@/plugins/geometry'
import type { CameraProjectionMode, CameraControlMode, SceneSkyboxSettings } from '@/types/scene-viewport-settings'
import type { TransformUpdatePayload } from '@/types/transform-update-payload'
import type { SkyboxParameterKey } from '@/types/skybox'
import { SKYBOX_PRESETS, CUSTOM_SKYBOX_PRESET_ID, cloneSkyboxSettings } from '@/stores/skyboxPresets'
import type { PanelPlacementState } from '@/types/panel-placement-state'
import { type SceneExportOptions } from '@/plugins/exporter'
import { prepareSceneExport, triggerDownload, type SceneExportResult } from '../../plugins/sceneExport'
import ViewportToolbar from './ViewportToolbar.vue'
import TransformToolbar from './TransformToolbar.vue'
import GroundToolbar from './GroundToolbar.vue'
import { TRANSFORM_TOOLS } from '@/types/scene-transform-tools'
import { ALIGN_MODE_AXIS, type AlignMode } from '@/types/scene-viewport-align-mode'
import { Sky } from 'three/addons/objects/Sky.js'
import type { NodeHitResult } from '@/types/scene-viewport-node-hit-result'
import type { SelectionDragCompanion, SelectionDragState } from '@/types/scene-viewport-selection-drag'
import type { PointerTrackingState } from '@/types/scene-viewport-pointer-tracking-state'
import type { TransformGroupEntry, TransformGroupState } from '@/types/scene-viewport-transform-group'
import type { PlaceholderOverlayState } from '@/types/scene-viewport-placeholder-overlay-state'
import type { GroundDynamicMesh, WallDynamicMesh } from '@/types/dynamic-mesh'
import type { BuildTool } from '@/types/build-tool'
import { createGroundMesh, updateGroundMesh, releaseGroundMeshCache } from '@/plugins/groundMesh'
import { createWallGroup, updateWallGroup } from '@/plugins/wallMesh'


const props = withDefaults(defineProps<{
  sceneNodes: SceneNode[]
  activeTool: EditorTool
  selectedNodeId: string | null
  cameraState: SceneCameraState
  focusNodeId: string | null
  focusRequestId: number
  previewActive?: boolean
  showStats?: boolean
}>(), {
  previewActive: false,
  showStats: true,
})

const emit = defineEmits<{
  (event: 'changeTool', tool: EditorTool): void
  (event: 'selectNode', payload: { primaryId: string | null; selectedIds: string[] }): void
  (event: 'updateNodeTransform', payload: TransformUpdatePayload | TransformUpdatePayload[]): void
  (event: 'updateCamera', payload: SceneCameraState): void
}>()

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const isSceneReady = computed(() => sceneStore.isSceneReady)
const canDropSelection = computed(() => sceneStore.selectedNodeIds.some((id) => !sceneStore.isNodeSelectionLocked(id)))

const viewportEl = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const surfaceRef = ref<HTMLDivElement | null>(null)
const statsHostRef = ref<HTMLDivElement | null>(null)

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let perspectiveCamera: THREE.PerspectiveCamera | null = null
let orthographicCamera: THREE.OrthographicCamera | null = null
let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null = null
let orbitControls: OrbitControls | MapControls | null = null
let transformControls: TransformControls | null = null
let resizeObserver: ResizeObserver | null = null
let selectionBoxHelper: THREE.Box3Helper | null = null
let selectionTrackedObject: THREE.Object3D | null = null
let gridHighlight: THREE.Group | null = null
const selectionHighlights = new Map<string, THREE.Group>()
let sky: Sky | null = null
let pmremGenerator: THREE.PMREMGenerator | null = null
let skyEnvironmentTarget: THREE.WebGLRenderTarget | null = null
let fallbackDirectionalLight: THREE.DirectionalLight | null = null
const skySunPosition = new THREE.Vector3()
let stats: Stats | null = null
let statsPanelIndex = 0
let statsPointerHandler: ((event: MouseEvent) => void) | null = null

const textureLoader = new THREE.TextureLoader()
const textureCache = new Map<string, THREE.Texture>()
const pendingTextureRequests = new Map<string, Promise<THREE.Texture | null>>()
const TEXTURE_SLOT_STATE_KEY = '__harmonyTextureSlots'
type MeshStandardTextureKey = 'map' | 'normalMap' | 'metalnessMap' | 'roughnessMap' | 'aoMap' | 'emissiveMap'
const MATERIAL_TEXTURE_ASSIGNMENTS: Record<SceneMaterialTextureSlot, { key: MeshStandardTextureKey; colorSpace?: THREE.ColorSpace }> = {
  albedo: { key: 'map', colorSpace: THREE.SRGBColorSpace },
  normal: { key: 'normalMap' },
  metalness: { key: 'metalnessMap' },
  roughness: { key: 'roughnessMap' },
  ao: { key: 'aoMap' },
  emissive: { key: 'emissiveMap', colorSpace: THREE.SRGBColorSpace },
}

function applyRendererShadowSetting() {
  if (!renderer) {
    return
  }
  renderer.shadowMap.enabled = Boolean(shadowsEnabled.value)
}
const DEFAULT_BACKGROUND_COLOR = 0x516175
const GROUND_NODE_ID = 'harmony:ground'
const SKY_ENVIRONMENT_INTENSITY = 0.35
const FALLBACK_AMBIENT_INTENSITY = 0.2
const FALLBACK_DIRECTIONAL_INTENSITY = 0.65
const FALLBACK_DIRECTIONAL_SHADOW_MAP_SIZE = 2048
const SKY_SCALE = 2500
const SKY_FALLBACK_LIGHT_DISTANCE = 75

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const CLICK_DRAG_THRESHOLD_PX = 5
const rootGroup = new THREE.Group()
const objectMap = new Map<string, THREE.Object3D>()
type LightHelperObject = THREE.Object3D & { dispose?: () => void; update?: () => void }
const lightHelpers: LightHelperObject[] = []
const lightHelpersNeedingUpdate = new Set<LightHelperObject>()
let isApplyingCameraState = false
const THUMBNAIL_CAPTURE_DELAY_MS = 1500
let thumbnailCaptureTimeout: ReturnType<typeof setTimeout> | null = null
const ASSET_DRAG_MIME = 'application/x-harmony-asset'
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const MIN_CAMERA_HEIGHT = 0.25
const MIN_TARGET_HEIGHT = 0
const GRID_MAJOR_SPACING = 1
const GRID_MINOR_SPACING = 0.5
const GRID_SNAP_SPACING = GRID_MINOR_SPACING
const GRID_MINOR_DASH_SIZE = GRID_MINOR_SPACING * 0.12
const GRID_MINOR_GAP_SIZE = GRID_MINOR_SPACING * 0.2
const GRID_BASE_HEIGHT = 0.03
const GRID_HIGHLIGHT_HEIGHT = 0.03
const GRID_HIGHLIGHT_PADDING = 0.1
const GRID_HIGHLIGHT_MIN_SIZE = GRID_MAJOR_SPACING * 1.3
const DEFAULT_GRID_HIGHLIGHT_SIZE = GRID_MAJOR_SPACING * 1.5
const DEFAULT_GRID_HIGHLIGHT_DIMENSIONS = { width: DEFAULT_GRID_HIGHLIGHT_SIZE, depth: DEFAULT_GRID_HIGHLIGHT_SIZE } as const
const POINT_LIGHT_HELPER_SIZE = 0.5
const DIRECTIONAL_LIGHT_HELPER_SIZE = 5
const DEFAULT_CAMERA_POSITION = { x: 5, y: 5, z: 5 } as const
const DEFAULT_CAMERA_TARGET = { x: 0, y: 0, z: 0 } as const
const DEFAULT_PERSPECTIVE_FOV = 60
const MIN_CAMERA_DISTANCE = 2
const MAX_CAMERA_DISTANCE = 30
const MIN_ORTHOGRAPHIC_ZOOM = 0.25
const MAX_ORTHOGRAPHIC_ZOOM = 8
const CAMERA_DISTANCE_EPSILON = 1e-3
const ORTHO_FRUSTUM_SIZE = 20
const DROP_TO_GROUND_EPSILON = 1e-4
const ALIGN_DELTA_EPSILON = 1e-6
const CAMERA_RECENTER_DURATION_MS = 320
const RIGHT_CLICK_ROTATION_STEP = THREE.MathUtils.degToRad(15)
const GROUND_HEIGHT_STEP = 0.5

const cameraControlMode = computed<CameraControlMode>({
  get: () => sceneStore.viewportSettings.cameraControlMode,
  set: (mode) => {
    if (mode !== sceneStore.viewportSettings.cameraControlMode) {
      sceneStore.setCameraControlMode(mode)
    }
  },
})

const isDragHovering = ref(false)
const gridVisible = computed(() => sceneStore.viewportSettings.showGrid)
const axesVisible = computed(() => sceneStore.viewportSettings.showAxes)
const shadowsEnabled = computed(() => sceneStore.viewportSettings.shadowsEnabled)
const cameraProjectionMode = computed(() => sceneStore.viewportSettings.cameraProjection)
const skyboxSettings = computed(() => sceneStore.viewportSettings.skybox)
const canAlignSelection = computed(() => {
  const primaryId = sceneStore.selectedNodeId
  if (!primaryId) {
    return false
  }
  return sceneStore.selectedNodeIds.some((id) => id !== primaryId && !sceneStore.isNodeSelectionLocked(id))
})
const skyboxPresetList = SKYBOX_PRESETS
const transformToolKeyMap = new Map<string, EditorTool>(TRANSFORM_TOOLS.map((tool) => [tool.key, tool.value]))
let activeCameraMode: CameraProjectionMode = cameraProjectionMode.value

const activeBuildTool = ref<BuildTool | null>(null)

type PanelPlacementHolder = { panelPlacement?: PanelPlacementState | null }

const { panelVisibility } = storeToRefs(sceneStore)
function normalizePanelPlacementState(input?: PanelPlacementState | null): PanelPlacementState {
  return {
    hierarchy: input?.hierarchy === 'floating' ? 'floating' : 'docked',
    inspector: input?.inspector === 'floating' ? 'floating' : 'docked',
    project: input?.project === 'floating' ? 'floating' : 'docked',
  }
}

const panelPlacement = computed<PanelPlacementState>(() => {
  const source = (sceneStore.$state as unknown as PanelPlacementHolder).panelPlacement ??
    (sceneStore as unknown as PanelPlacementHolder).panelPlacement ??
    null
  return normalizePanelPlacementState(source)
})

const TOOLBAR_OFFSET = 12
const TOOLBAR_MIN_MARGIN = 16

const transformToolbarStyle = reactive<{ top: string; left: string }>({
  top: `${TOOLBAR_MIN_MARGIN}px`,
  left: `${TOOLBAR_MIN_MARGIN}px`,
})

const viewportToolbarStyle = reactive<{ top: string; left: string }>({
  top: `${TOOLBAR_MIN_MARGIN}px`,
  left: `${TOOLBAR_MIN_MARGIN}px`,
})

let hierarchyPanelObserver: ResizeObserver | null = null
let inspectorPanelObserver: ResizeObserver | null = null
let observedHierarchyElement: Element | null = null
let observedInspectorElement: Element | null = null
let viewportResizeObserver: ResizeObserver | null = null
let transformToolbarResizeObserver: ResizeObserver | null = null
let viewportToolbarResizeObserver: ResizeObserver | null = null
const transformToolbarHostRef = ref<HTMLDivElement | null>(null)
const viewportToolbarHostRef = ref<HTMLDivElement | null>(null)

let pointerTrackingState: PointerTrackingState | null = null

type GroundSelectionPhase = 'pending' | 'sizing' | 'finalizing'

type GroundSelectionDragState = {
  pointerId: number
  startRow: number
  startColumn: number
  currentRow: number
  currentColumn: number
  phase: GroundSelectionPhase
}

type GroundCellSelection = {
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
  worldCenter: THREE.Vector3
}

let groundSelectionDragState: GroundSelectionDragState | null = null
const groundSelection = ref<GroundCellSelection | null>(null)
const isGroundToolbarVisible = ref(false)
const groundSelectionToolbarStyle = reactive<{ left: string; top: string; opacity: number }>({
  left: '0px',
  top: '0px',
  opacity: 0,
})
const groundTextureInputRef = ref<HTMLInputElement | null>(null)

type WallSessionSegment = {
  start: THREE.Vector3
  end: THREE.Vector3
}

type WallBuildSession = {
  pointerId: number | null
  dragStart: THREE.Vector3 | null
  dragEnd: THREE.Vector3 | null
  segments: WallSessionSegment[]
  previewGroup: THREE.Group | null
  nodeId: string | null
  dimensions: { height: number; width: number; thickness: number }
  finalizePointer: { pointerId: number; startX: number; startY: number; moved: boolean } | null
}

const WALL_DEFAULT_HEIGHT = 3
const WALL_DEFAULT_WIDTH = 0.2
const WALL_DEFAULT_THICKNESS = 0.2
const WALL_MIN_HEIGHT = 0.5
const WALL_MIN_WIDTH = 0.1
const WALL_MIN_THICKNESS = 0.05

let wallBuildSession: WallBuildSession | null = null
let wallPreviewNeedsSync = false
let wallPreviewSignature: string | null = null

function normalizeWallDimensionsForViewport(values: { height?: number; width?: number; thickness?: number }): {
  height: number
  width: number
  thickness: number
} {
  const height = Number.isFinite(values.height) ? Math.max(WALL_MIN_HEIGHT, values.height!) : WALL_DEFAULT_HEIGHT
  const width = Number.isFinite(values.width) ? Math.max(WALL_MIN_WIDTH, values.width!) : WALL_DEFAULT_WIDTH
  const thickness = Number.isFinite(values.thickness) ? Math.max(WALL_MIN_THICKNESS, values.thickness!) : WALL_DEFAULT_THICKNESS
  return { height, width, thickness }
}

type WallTransformState = {
  nodeId: string
  initialScale: THREE.Vector3
  initialSegments: WallSessionSegment[]
  dimensions: { height: number; width: number; thickness: number }
}

let wallTransformState: WallTransformState | null = null

type CameraTransitionState = {
  startPosition: THREE.Vector3
  startTarget: THREE.Vector3
  endPosition: THREE.Vector3
  endTarget: THREE.Vector3
  startTime: number
  duration: number
}

let cameraTransitionState: CameraTransitionState | null = null

let transformGroupState: TransformGroupState | null = null
let pendingSkyboxSettings: SceneSkyboxSettings | null = null
let pendingSceneGraphSync = false

function clampToRange(value: number, min: number, max: number) {
  if (Number.isNaN(value)) {
    return min
  }
  if (max <= min) {
    return min
  }
  return Math.min(Math.max(value, min), max)
}

function getHierarchyPanelElement(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }
  if (!panelVisibility.value.hierarchy) {
    return null
  }
  const placement = panelPlacement.value.hierarchy
  if (placement === 'floating') {
    return document.querySelector('.floating-panel.hierarchy-floating .panel-card') as HTMLElement | null
  }
  return document.querySelector('.panel.hierarchy-panel .panel-card') as HTMLElement | null
}

function getInspectorPanelElement(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }
  if (!panelVisibility.value.inspector) {
    return null
  }
  const placement = panelPlacement.value.inspector
  if (placement === 'floating') {
    return document.querySelector('.floating-panel.inspector-floating .panel-card') as HTMLElement | null
  }
  return document.querySelector('.panel.inspector-panel .panel-card') as HTMLElement | null
}

function findGroundNodeInTree(nodes: SceneNode[]): SceneNode | null {
  for (const node of nodes) {
    if (node.id === GROUND_NODE_ID || node.dynamicMesh?.type === 'ground') {
      return node
    }
    if (node.children?.length) {
      const nested = findGroundNodeInTree(node.children)
      if (nested) {
        return nested
      }
    }
  }
  return null
}

function getGroundNodeFromScene(): SceneNode | null {
  return findGroundNodeInTree(sceneStore.nodes)
}

function getGroundNodeFromProps(): SceneNode | null {
  return findGroundNodeInTree(props.sceneNodes)
}

function getGroundDynamicMeshDefinition(): GroundDynamicMesh | null {
  const node = getGroundNodeFromScene() ?? getGroundNodeFromProps()
  if (node?.dynamicMesh?.type === 'ground') {
    return node.dynamicMesh
  }
  return null
}

function getGroundMeshObject(): THREE.Mesh | null {
  const container = objectMap.get(GROUND_NODE_ID)
  if (!container) {
    return null
  }
  let mesh: THREE.Mesh | null = null
  container.traverse((child) => {
    if (mesh) {
      return
    }
    const candidate = child as THREE.Mesh
    if (candidate?.isMesh && candidate !== container) {
      mesh = candidate
    }
  })
  return mesh
}

function updateTransformToolbarPosition() {
  const viewport = viewportEl.value
  if (!viewport) {
    return
  }
  const viewportRect = viewport.getBoundingClientRect()
  if (viewportRect.width <= 0 || viewportRect.height <= 0) {
    return
  }

  const panelEl = getHierarchyPanelElement()
  const toolbarEl = transformToolbarHostRef.value
  const toolbarWidth = toolbarEl?.offsetWidth ?? 0
  const toolbarHeight = toolbarEl?.offsetHeight ?? 0

  if (!panelEl) {
    const maxLeftFallback = Math.max(TOOLBAR_MIN_MARGIN, viewportRect.width - toolbarWidth - TOOLBAR_MIN_MARGIN)
    const fallbackLeft = clampToRange(TOOLBAR_MIN_MARGIN, TOOLBAR_MIN_MARGIN, maxLeftFallback)
    transformToolbarStyle.left = `${fallbackLeft}px`
    const maxTopFallback = Math.max(TOOLBAR_MIN_MARGIN, viewportRect.height - toolbarHeight - TOOLBAR_MIN_MARGIN)
    const fallbackTop = clampToRange(TOOLBAR_MIN_MARGIN, TOOLBAR_MIN_MARGIN, maxTopFallback)
    transformToolbarStyle.top = `${fallbackTop}px`
    return
  }

  const panelRect = panelEl.getBoundingClientRect()
  const maxLeft = Math.max(TOOLBAR_MIN_MARGIN, viewportRect.width - toolbarWidth - TOOLBAR_MIN_MARGIN)
  const maxTop = Math.max(TOOLBAR_MIN_MARGIN, viewportRect.height - toolbarHeight - TOOLBAR_MIN_MARGIN)
  const candidateLeft = panelRect.right - viewportRect.left + TOOLBAR_OFFSET
  const candidateTop = panelRect.top - viewportRect.top + TOOLBAR_OFFSET
  const computedLeft = clampToRange(candidateLeft, TOOLBAR_MIN_MARGIN, maxLeft)
  const computedTop = clampToRange(candidateTop, TOOLBAR_MIN_MARGIN, maxTop)
  transformToolbarStyle.left = `${computedLeft}px`
  transformToolbarStyle.top = `${computedTop}px`
}

function updateViewportToolbarPosition() {
  const viewport = viewportEl.value
  if (!viewport) {
    return
  }
  const viewportRect = viewport.getBoundingClientRect()
  if (viewportRect.width <= 0 || viewportRect.height <= 0) {
    return
  }

  const panelEl = getInspectorPanelElement()
  const toolbarEl = viewportToolbarHostRef.value
  const toolbarWidth = toolbarEl?.offsetWidth ?? 0
  const toolbarHeight = toolbarEl?.offsetHeight ?? 0

  if (!panelEl) {
    const defaultLeft = Math.max(TOOLBAR_MIN_MARGIN, viewportRect.width - toolbarWidth - TOOLBAR_MIN_MARGIN)
    viewportToolbarStyle.left = `${defaultLeft}px`
    const maxTopFallback = Math.max(TOOLBAR_MIN_MARGIN, viewportRect.height - toolbarHeight - TOOLBAR_MIN_MARGIN)
    const fallbackTop = clampToRange(TOOLBAR_MIN_MARGIN, TOOLBAR_MIN_MARGIN, maxTopFallback)
    viewportToolbarStyle.top = `${fallbackTop}px`
    return
  }

  const panelRect = panelEl.getBoundingClientRect()
  const maxLeft = Math.max(TOOLBAR_MIN_MARGIN, viewportRect.width - toolbarWidth - TOOLBAR_MIN_MARGIN)
  const maxTop = Math.max(TOOLBAR_MIN_MARGIN, viewportRect.height - toolbarHeight - TOOLBAR_MIN_MARGIN)
  const candidateLeft = panelRect.left - viewportRect.left - toolbarWidth - TOOLBAR_OFFSET
  const candidateTop = panelRect.top - viewportRect.top + TOOLBAR_OFFSET
  const computedLeft = clampToRange(candidateLeft, TOOLBAR_MIN_MARGIN, maxLeft)
  const computedTop = clampToRange(candidateTop, TOOLBAR_MIN_MARGIN, maxTop)
  viewportToolbarStyle.left = `${computedLeft}px`
  viewportToolbarStyle.top = `${computedTop}px`
}

function refreshPanelObservers() {
  if (typeof ResizeObserver === 'undefined') {
    return
  }
  const hierarchyEl = getHierarchyPanelElement()
  if (observedHierarchyElement !== hierarchyEl) {
    if (hierarchyPanelObserver && observedHierarchyElement) {
      hierarchyPanelObserver.unobserve(observedHierarchyElement)
    }
    observedHierarchyElement = hierarchyEl
    if (hierarchyEl) {
      if (!hierarchyPanelObserver) {
        hierarchyPanelObserver = new ResizeObserver(() => scheduleToolbarUpdate())
      }
      hierarchyPanelObserver.observe(hierarchyEl)
    }
  }

  const inspectorEl = getInspectorPanelElement()
  if (observedInspectorElement !== inspectorEl) {
    if (inspectorPanelObserver && observedInspectorElement) {
      inspectorPanelObserver.unobserve(observedInspectorElement)
    }
    observedInspectorElement = inspectorEl
    if (inspectorEl) {
      if (!inspectorPanelObserver) {
        inspectorPanelObserver = new ResizeObserver(() => scheduleToolbarUpdate())
      }
      inspectorPanelObserver.observe(inspectorEl)
    }
  }
}

function scheduleToolbarUpdate() {
  nextTick(() => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        updateTransformToolbarPosition()
        updateViewportToolbarPosition()
        refreshPanelObservers()
        updateGroundSelectionToolbarPosition()
      })
    } else {
      updateTransformToolbarPosition()
      updateViewportToolbarPosition()
      refreshPanelObservers()
      updateGroundSelectionToolbarPosition()
    }
  })
}

function handleViewportOverlayResize() {
  scheduleToolbarUpdate()
  updateGroundSelectionToolbarPosition()
}

function resolveNodeIdFromObject(object: THREE.Object3D | null): string | null {
  let current: THREE.Object3D | null = object
  while (current) {
    const nodeId = current.userData?.nodeId as string | undefined
    if (nodeId) {
      return nodeId
    }
    current = current.parent ?? null
  }
  return null
}

function pickNodeAtPointer(event: PointerEvent): NodeHitResult | null {
  if (!canvasRef.value || !camera) {
    return null
  }

  const rect = canvasRef.value.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) {
    return null
  }

  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const intersections = raycaster.intersectObjects(rootGroup.children, true)

  for (const intersection of intersections) {
    const nodeId = resolveNodeIdFromObject(intersection.object)
    if (!nodeId) {
      continue
    }
    if (sceneStore.isNodeSelectionLocked(nodeId)) {
      continue
    }
    const baseObject = objectMap.get(nodeId)
    if (!baseObject) {
      continue
    }
    return {
      nodeId,
      object: baseObject,
      point: intersection.point.clone(),
    }
  }

  return null
}

function pickActiveSelectionBoundingBoxHit(event: PointerEvent): NodeHitResult | null {
  if (!canvasRef.value || !camera) {
    return null
  }

  const primaryId = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
  if (!primaryId) {
    return null
  }

  if (sceneStore.isNodeSelectionLocked(primaryId)) {
    return null
  }

  const targetObject = objectMap.get(primaryId)
  if (!targetObject) {
    return null
  }

  targetObject.updateMatrixWorld(true)
  selectionDragBoundingBox.setFromObject(targetObject)
  if (selectionDragBoundingBox.isEmpty()) {
    return null
  }

  const rect = canvasRef.value.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) {
    return null
  }

  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)

  const intersection = raycaster.ray.intersectBox(selectionDragBoundingBox, selectionDragIntersectionHelper)
  if (!intersection) {
    return null
  }

  return {
    nodeId: primaryId,
    object: targetObject,
    point: intersection.clone(),
  }
}

function createSelectionDragState(nodeId: string, object: THREE.Object3D, hitPoint: THREE.Vector3, event: PointerEvent): SelectionDragState {
  const worldPosition = new THREE.Vector3()
  object.getWorldPosition(worldPosition)
  // Lock the drag plane to the grab point height so pointer distance does not change drag speed.
  const planeAnchor = worldPosition.clone()
  planeAnchor.y = hitPoint.y
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), planeAnchor)
  const pointerPlanePoint = projectPointerToPlane(event, plane)
  // Capture the pointer offset on the drag plane itself so the object stays put when dragging begins.
  const pointerOffset = (pointerPlanePoint ?? hitPoint.clone().setY(planeAnchor.y))
    .sub(worldPosition)
    .projectOnPlane(plane.normal)
  const companions: SelectionDragCompanion[] = []
  const selectedIds = sceneStore.selectedNodeIds.filter((id) => id !== nodeId && !sceneStore.isNodeSelectionLocked(id))
  selectedIds.forEach((id) => {
    const companionObject = objectMap.get(id)
    if (!companionObject) {
      return
    }
    companionObject.updateMatrixWorld(true)
    const companionWorldPosition = new THREE.Vector3()
    companionObject.getWorldPosition(companionWorldPosition)
    companions.push({
      nodeId: id,
      object: companionObject,
      parent: companionObject.parent ?? null,
      initialLocalPosition: companionObject.position.clone(),
      initialWorldPosition: companionWorldPosition,
    })
  })
  return {
    nodeId,
    object,
    plane,
    pointerOffset,
    initialLocalPosition: object.position.clone(),
    initialWorldPosition: worldPosition.clone(),
    initialRotation: object.rotation.clone(),
    parent: object.parent ?? null,
    companions,
    hasDragged: false,
  }
}

function projectPointerToPlane(event: PointerEvent, plane: THREE.Plane): THREE.Vector3 | null {
  if (!camera || !canvasRef.value) {
    return null
  }

  const rect = canvasRef.value.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) {
    return null
  }

  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const intersectionPoint = new THREE.Vector3()
  if (raycaster.ray.intersectPlane(plane, intersectionPoint)) {
    return intersectionPoint
  }
  return null
}

function dropSelectionToGround() {
  const unlockedSelection = sceneStore.selectedNodeIds.filter((id) => !sceneStore.isNodeSelectionLocked(id))
  if (!unlockedSelection.length) {
    return
  }

  const parentMap = buildParentIndex(props.sceneNodes, null, new Map<string, string | null>())
  const topLevelIds = filterTopLevelSelection(unlockedSelection, parentMap)
  if (!topLevelIds.length) {
    return
  }

  const updates: TransformUpdatePayload[] = []

  for (const nodeId of topLevelIds) {
    const object = objectMap.get(nodeId)
    if (!object) {
      continue
    }

    object.updateMatrixWorld(true)
    dropBoundingBoxHelper.setFromObject(object)
    if (dropBoundingBoxHelper.isEmpty()) {
      continue
    }

    const deltaY = -dropBoundingBoxHelper.min.y
    if (Math.abs(deltaY) <= DROP_TO_GROUND_EPSILON) {
      continue
    }

    object.getWorldPosition(dropWorldPositionHelper)
    dropWorldPositionHelper.y += deltaY

    dropLocalPositionHelper.copy(dropWorldPositionHelper)
    if (object.parent) {
      object.parent.worldToLocal(dropLocalPositionHelper)
    }

    object.position.set(dropLocalPositionHelper.x, dropLocalPositionHelper.y, dropLocalPositionHelper.z)
    object.updateMatrixWorld(true)

    updates.push({
      id: nodeId,
      position: {
        x: dropLocalPositionHelper.x,
        y: dropLocalPositionHelper.y,
        z: dropLocalPositionHelper.z,
      },
    })
  }

  if (!updates.length) {
    return
  }

  if (typeof sceneStore.updateNodePropertiesBatch === 'function') {
    sceneStore.updateNodePropertiesBatch(updates)
  } else {
    updates.forEach((update) => sceneStore.updateNodeProperties(update))
  }

  const primaryId = sceneStore.selectedNodeId
  const primaryObject = primaryId ? objectMap.get(primaryId) ?? null : null
  updateSelectionBox(primaryObject)
  updateGridHighlightFromObject(primaryObject)
  updatePlaceholderOverlayPositions()
  updateSelectionHighlights()
  scheduleThumbnailCapture()
}

function snapValueToGrid(value: number): number {
  // Round to the nearest snap interval so aligned nodes land on grid intersections.
  return Math.round(value / GRID_SNAP_SPACING) * GRID_SNAP_SPACING
}

function alignSelection(mode: AlignMode) {
  const axis = ALIGN_MODE_AXIS[mode]

  const primaryId = sceneStore.selectedNodeId
  if (!primaryId) {
    return
  }

  const referenceObject = objectMap.get(primaryId)
  if (!referenceObject) {
    return
  }

  const unlockedSelection = sceneStore.selectedNodeIds.filter((id) => id !== primaryId && !sceneStore.isNodeSelectionLocked(id))
  if (!unlockedSelection.length) {
    return
  }

  const parentMap = buildParentIndex(props.sceneNodes, null, new Map<string, string | null>())
  const topLevelIds = filterTopLevelSelection(unlockedSelection, parentMap)
  if (!topLevelIds.length) {
    return
  }

  referenceObject.updateMatrixWorld(true)
  referenceObject.getWorldPosition(alignReferenceWorldPositionHelper)
  const targetAxisValue = snapValueToGrid(alignReferenceWorldPositionHelper[axis])

  const updates: TransformUpdatePayload[] = []

  for (const nodeId of topLevelIds) {
    const targetObject = objectMap.get(nodeId)
    if (!targetObject) {
      continue
    }

    targetObject.updateMatrixWorld(true)
    targetObject.getWorldPosition(alignWorldPositionHelper)

    const deltaValue = targetAxisValue - alignWorldPositionHelper[axis]
    if (Math.abs(deltaValue) <= ALIGN_DELTA_EPSILON) {
      continue
    }

    alignDeltaHelper.set(0, 0, 0)
    alignDeltaHelper[axis] = deltaValue
    alignWorldPositionHelper.add(alignDeltaHelper)
    alignLocalPositionHelper.copy(alignWorldPositionHelper)
    if (targetObject.parent) {
      targetObject.parent.worldToLocal(alignLocalPositionHelper)
    }

    targetObject.position.copy(alignLocalPositionHelper)
    targetObject.updateMatrixWorld(true)

    updates.push({
      id: nodeId,
      position: {
        x: alignLocalPositionHelper.x,
        y: alignLocalPositionHelper.y,
        z: alignLocalPositionHelper.z,
      },
    })
  }

  if (!updates.length) {
    return
  }

  if (typeof sceneStore.updateNodePropertiesBatch === 'function') {
    sceneStore.updateNodePropertiesBatch(updates)
  } else {
    updates.forEach((update) => sceneStore.updateNodeProperties(update))
  }

  const primaryObject = objectMap.get(primaryId) ?? null
  updateSelectionBox(primaryObject)
  updateGridHighlightFromObject(primaryObject)
  updatePlaceholderOverlayPositions()
  updateSelectionHighlights()
  scheduleThumbnailCapture()
}

function updateSelectDragPosition(drag: SelectionDragState, event: PointerEvent): boolean {
  const planePoint = projectPointerToPlane(event, drag.plane)
  if (!planePoint) {
    return false
  }

  const worldPosition = planePoint.sub(drag.pointerOffset)
  snapVectorToGrid(worldPosition)

  const newLocalPosition = worldPosition.clone()
  if (drag.parent) {
    drag.parent.worldToLocal(newLocalPosition)
  }
  newLocalPosition.y = drag.initialLocalPosition.y

  drag.object.position.copy(newLocalPosition)
  drag.object.updateMatrixWorld(true)
  drag.object.getWorldPosition(selectDragWorldPosition)
  drag.object.getWorldQuaternion(selectDragWorldQuaternion)
  selectDragDelta.copy(selectDragWorldPosition).sub(drag.initialWorldPosition)

  const updates: TransformUpdatePayload[] = [
    {
      id: drag.nodeId,
      position: toVector3Like(drag.object.position),
      rotation: toEulerLike(drag.object.rotation),
      scale: toVector3Like(drag.object.scale),
    },
  ]

  drag.companions.forEach((companion) => {
    const companionWorldPosition = companion.initialWorldPosition.clone().add(selectDragDelta)
    const localPosition = companionWorldPosition.clone()
    if (companion.parent) {
      companion.parent.worldToLocal(localPosition)
    }
    localPosition.y = companion.initialLocalPosition.y
    companion.object.position.copy(localPosition)
    companion.object.updateMatrixWorld(true)
    updates.push({
      id: companion.nodeId,
      position: toVector3Like(companion.object.position),
    })
  })

  updateSelectionBox(drag.object)
  updateGridHighlightFromObject(drag.object)
  updateSelectionHighlights()

  emit('updateNodeTransform', updates)

  return true
}

function rotateActiveSelection(nodeId: string) {
  if (sceneStore.isNodeSelectionLocked(nodeId)) {
    return
  }

  const primaryObject = objectMap.get(nodeId)
  if (!primaryObject) {
    return
  }

  const selectionIds = sceneStore.selectedNodeIds.filter((id) => !sceneStore.isNodeSelectionLocked(id))
  if (!selectionIds.includes(nodeId)) {
    selectionIds.push(nodeId)
  }

  const updates: TransformUpdatePayload[] = []

  selectionIds.forEach((id) => {
    const object = objectMap.get(id)
    if (!object) {
      return
    }

    const nextRotation = object.rotation.clone()
    nextRotation.y += RIGHT_CLICK_ROTATION_STEP
    object.rotation.copy(nextRotation)
    object.updateMatrixWorld(true)

    updates.push({
      id,
      position: toVector3Like(object.position),
      rotation: toEulerLike(object.rotation),
      scale: toVector3Like(object.scale),
    })
  })

  if (!updates.length) {
    return
  }

  updateSelectionBox(primaryObject)
  updateGridHighlightFromObject(primaryObject)
  updatePlaceholderOverlayPositions()
  updateSelectionHighlights()

  const transformPayload = updates.length === 1 ? updates[0]! : updates
  emit('updateNodeTransform', transformPayload)

  scheduleThumbnailCapture()
}

function requestOrbitControlDisable() {
  if (!orbitControls) {
    return
  }
  orbitDisableCount += 1
  if (orbitDisableCount === 1) {
    orbitControls.enabled = false
  }
}

function releaseOrbitControlDisable() {
  if (!orbitControls || orbitDisableCount === 0) {
    return
  }
  orbitDisableCount = Math.max(0, orbitDisableCount - 1)
  if (orbitDisableCount === 0) {
    orbitControls.enabled = true
  }
}

function disableOrbitForSelectDrag() {
  if (!isSelectDragOrbitDisabled) {
    isSelectDragOrbitDisabled = true
    requestOrbitControlDisable()
  }
}

function restoreOrbitAfterSelectDrag() {
  if (isSelectDragOrbitDisabled) {
    isSelectDragOrbitDisabled = false
    releaseOrbitControlDisable()
  }
}

function disableOrbitForGroundSelection() {
  if (!isGroundSelectionOrbitDisabled) {
    isGroundSelectionOrbitDisabled = true
    requestOrbitControlDisable()
  }
}

function restoreOrbitAfterGroundSelection() {
  if (isGroundSelectionOrbitDisabled) {
    isGroundSelectionOrbitDisabled = false
    releaseOrbitControlDisable()
  }
}

function disableOrbitForWallBuild() {
  if (!isWallBuildOrbitDisabled) {
    isWallBuildOrbitDisabled = true
    requestOrbitControlDisable()
  }
}

function restoreOrbitAfterWallBuild() {
  if (isWallBuildOrbitDisabled) {
    isWallBuildOrbitDisabled = false
    releaseOrbitControlDisable()
  }
}

function handleViewportContextMenu(event: MouseEvent) {
  event.preventDefault()
}

function easeInOutCubic(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function startCameraTransition(targetPosition: THREE.Vector3, targetLookAt: THREE.Vector3, duration = CAMERA_RECENTER_DURATION_MS) {
  if (!camera || !orbitControls) {
    return
  }

  const startPosition = camera.position.clone()
  const startTarget = orbitControls.target.clone()
  const endPosition = targetPosition.clone()
  const endTarget = targetLookAt.clone()
  const positionDeltaSq = startPosition.distanceToSquared(endPosition)
  const targetDeltaSq = startTarget.distanceToSquared(endTarget)
  const effectiveDuration = duration <= 0 ? 0 : Math.max(duration, 0)

  if (positionDeltaSq < 1e-6 && targetDeltaSq < 1e-6) {
    cameraTransitionState = null
    const previousApplying = isApplyingCameraState
    if (!previousApplying) {
      isApplyingCameraState = true
    }
    camera.position.copy(endPosition)
    orbitControls.target.copy(endTarget)
    orbitControls.update()
    if (!previousApplying) {
      isApplyingCameraState = false
    }

    if (perspectiveCamera && camera !== perspectiveCamera) {
      perspectiveCamera.position.copy(camera.position)
      perspectiveCamera.quaternion.copy(camera.quaternion)
    }

    clampCameraZoom()
    clampCameraAboveGround()

    const snapshot = buildCameraState()
    if (snapshot) {
      emit('updateCamera', snapshot)
    }

    scheduleThumbnailCapture()
    return
  }

  const transitionDuration = effectiveDuration === 0 ? CAMERA_RECENTER_DURATION_MS : effectiveDuration

  cameraTransitionState = {
    startPosition,
    startTarget,
    endPosition,
    endTarget,
    startTime: performance.now(),
    duration: transitionDuration,
  }

  scheduleThumbnailCapture()
}

function recenterCameraOnPointer(event: MouseEvent) {
  if (!camera || !orbitControls || !canvasRef.value) {
    return
  }

  if (transformControls?.dragging) {
    return
  }

  const rect = canvasRef.value.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) {
    return
  }

  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)

  const clipBasedDistance = THREE.MathUtils.clamp((camera.near + camera.far) * 0.05, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE)

  const intersections = raycaster.intersectObjects(rootGroup.children, true)
  let targetResolved = false
  if (intersections.length > 0) {
    const intersection = intersections[0]
    if (intersection?.point) {
      cameraFocusTargetHelper.copy(intersection.point)
      targetResolved = true
    }
  }

  if (!targetResolved) {
    if (raycaster.ray.intersectPlane(groundPlane, cameraFocusTargetHelper)) {
      targetResolved = true
    } else {
      cameraFocusTargetHelper.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, clipBasedDistance * 2)
      targetResolved = true
    }
  }

  cameraFocusDirectionHelper.copy(raycaster.ray.direction).normalize()
  cameraFocusPositionHelper.copy(cameraFocusTargetHelper).addScaledVector(cameraFocusDirectionHelper, -clipBasedDistance)

  if (cameraFocusPositionHelper.y < MIN_CAMERA_HEIGHT) {
    cameraFocusPositionHelper.y = MIN_CAMERA_HEIGHT
  }

  cameraFocusTargetHelper.y = Math.max(cameraFocusTargetHelper.y, MIN_TARGET_HEIGHT)

  startCameraTransition(cameraFocusPositionHelper, cameraFocusTargetHelper)
}

const overlayContainerRef = ref<HTMLDivElement | null>(null)
const placeholderOverlays = reactive<Record<string, PlaceholderOverlayState>>({})
const placeholderOverlayList = computed(() => Object.values(placeholderOverlays))
const overlayPositionHelper = new THREE.Vector3()
const cameraOffsetHelper = new THREE.Vector3()
const selectDragWorldPosition = new THREE.Vector3()
const selectDragWorldQuaternion = new THREE.Quaternion()
const selectDragDelta = new THREE.Vector3()
const transformDeltaPosition = new THREE.Vector3()
const transformWorldPositionBuffer = new THREE.Vector3()
const transformLocalPositionHelper = new THREE.Vector3()
const transformScaleFactor = new THREE.Vector3(1, 1, 1)
const transformQuaternionDelta = new THREE.Quaternion()
const transformQuaternionHelper = new THREE.Quaternion()
const transformQuaternionInverseHelper = new THREE.Quaternion()
const groundSelectionCenterHelper = new THREE.Vector3()
const groundSelectionScreenHelper = new THREE.Vector3()
const groundPointerHelper = new THREE.Vector3()
const transformCurrentWorldPosition = new THREE.Vector3()
const gridHighlightPositionHelper = new THREE.Vector3()
const gridHighlightBoundingBox = new THREE.Box3()
const gridHighlightSizeHelper = new THREE.Vector3()
const dropBoundingBoxHelper = new THREE.Box3()
const dropWorldPositionHelper = new THREE.Vector3()
const dropLocalPositionHelper = new THREE.Vector3()
const selectionHighlightPositionHelper = new THREE.Vector3()
const selectionHighlightBoundingBox = new THREE.Box3()
const selectionHighlightSizeHelper = new THREE.Vector3()
const selectionDragBoundingBox = new THREE.Box3()
const selectionDragIntersectionHelper = new THREE.Vector3()
const alignReferenceWorldPositionHelper = new THREE.Vector3()
const alignDeltaHelper = new THREE.Vector3()
const alignWorldPositionHelper = new THREE.Vector3()
const alignLocalPositionHelper = new THREE.Vector3()
const cameraFocusTargetHelper = new THREE.Vector3()
const cameraFocusDirectionHelper = new THREE.Vector3()
const cameraFocusPositionHelper = new THREE.Vector3()
const cameraTransitionCurrentPosition = new THREE.Vector3()
const cameraTransitionCurrentTarget = new THREE.Vector3()

function buildTransformGroupState(primaryId: string | null): TransformGroupState | null {
  const selectedIds = sceneStore.selectedNodeIds.filter((id) => !sceneStore.isNodeSelectionLocked(id))
  const relevantIds = new Set(selectedIds)
  if (primaryId) {
    relevantIds.add(primaryId)
  }
  if (relevantIds.size === 0) {
    return null
  }

  const entries = new Map<string, TransformGroupEntry>()
  relevantIds.forEach((id) => {
    const object = objectMap.get(id)
    if (!object) {
      return
    }
    object.updateMatrixWorld(true)
    const worldPosition = new THREE.Vector3()
    object.getWorldPosition(worldPosition)
    const worldQuaternion = new THREE.Quaternion()
    object.getWorldQuaternion(worldQuaternion)
    entries.set(id, {
      nodeId: id,
      object,
      parent: object.parent ?? null,
      initialPosition: object.position.clone(),
      initialQuaternion: object.quaternion.clone(),
      initialScale: object.scale.clone(),
      initialWorldPosition: worldPosition,
      initialWorldQuaternion: worldQuaternion,
    })
  })

  if (!entries.size) {
    return null
  }

  return {
    primaryId,
    entries,
  }
}

const draggingChangedHandler = (event: unknown) => {
  const value = (event as { value?: boolean })?.value ?? false
  if (orbitControls) {
    orbitControls.enabled = !value
  }

  const targetObject = transformControls?.object as THREE.Object3D | null

  if (!isSceneReady.value) {
    if (!value) {
      updateGridHighlightFromObject(targetObject)
    }
    return
  }

  if (!value) {
    sceneStore.endTransformInteraction()
    transformGroupState = null
    updateGridHighlightFromObject(targetObject)
    updateSelectionHighlights()
    if (pendingSceneGraphSync) {
      pendingSceneGraphSync = false
      syncSceneGraph()
      refreshPlaceholderOverlays()
    }
  } else {
    const nodeId = (transformControls?.object as THREE.Object3D | null)?.userData?.nodeId as string | undefined
    sceneStore.beginTransformInteraction(nodeId ?? null)
    transformGroupState = buildTransformGroupState(nodeId ?? null)
    if (targetObject) {
      updateGridHighlightFromObject(targetObject)
    }
    updateSelectionHighlights()
  }
}

function shouldDeferSceneGraphSync(): boolean {
  if (!sceneStore.isSceneReady) {
    return false
  }
  if (transformControls?.dragging) {
    return true
  }
  if (sceneStore.activeTransformNodeId) {
    return true
  }
  return false
}

const GRID_EXTENT = 500
const GRID_MAJOR_COLOR = 0x1f6f8a
const GRID_MINOR_COLOR = 0x9dddf0

const gridGroup = new THREE.Group()
gridGroup.name = 'GridHelper'

function applyGridMaterialSettings(materials: THREE.Material | THREE.Material[], opacity: number, polygonOffsetUnits = -2) {
  const list = Array.isArray(materials) ? materials : [materials]
  list.forEach((material) => {
    const lineMaterial = material as THREE.LineBasicMaterial
    lineMaterial.depthWrite = false
    lineMaterial.transparent = true
    lineMaterial.opacity = opacity
    lineMaterial.toneMapped = false
    lineMaterial.polygonOffset = true
    lineMaterial.polygonOffsetFactor = -2
    lineMaterial.polygonOffsetUnits = polygonOffsetUnits
  })
}

const majorGrid = new THREE.GridHelper(
  GRID_EXTENT,
  GRID_EXTENT / GRID_MAJOR_SPACING,
  GRID_MAJOR_COLOR,
  GRID_MAJOR_COLOR,
)
majorGrid.position.y = GRID_BASE_HEIGHT
applyGridMaterialSettings(majorGrid.material, 0.25)
const majorMaterials = Array.isArray(majorGrid.material) ? majorGrid.material : [majorGrid.material]
majorMaterials.forEach((material) => {
  const lineMaterial = material as THREE.LineBasicMaterial
  lineMaterial.linewidth = 1.5
})
gridGroup.add(majorGrid)

const createDashedGridMaterial = () =>
  new THREE.LineDashedMaterial({
    color: GRID_MINOR_COLOR,
    transparent: true,
    opacity: 0.08,
    dashSize: GRID_MINOR_DASH_SIZE,
    gapSize: GRID_MINOR_GAP_SIZE,
    toneMapped: false,
  })

function createMinorGrid(): THREE.LineSegments {
  const halfSize = GRID_EXTENT / 2
  const positions: number[] = []

  for (let offset = -halfSize; offset <= halfSize; offset += GRID_MINOR_SPACING) {
    const nearestMultiple = Math.round(offset / GRID_MAJOR_SPACING) * GRID_MAJOR_SPACING
    if (Math.abs(offset - nearestMultiple) <= 1e-6) {
      continue
    }

    positions.push(-halfSize, GRID_BASE_HEIGHT, offset, halfSize, GRID_BASE_HEIGHT, offset)
    positions.push(offset, GRID_BASE_HEIGHT, -halfSize, offset, GRID_BASE_HEIGHT, halfSize)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeBoundingSphere()

  const material = createDashedGridMaterial()
  applyGridMaterialSettings(material, material.opacity, -1)

  const lines = new THREE.LineSegments(geometry, material)
  lines.computeLineDistances()
  return lines
}

const minorGrid = createMinorGrid()
gridGroup.add(minorGrid)

const axesHelper = new THREE.AxesHelper(4)
axesHelper.visible = false

const dragPreviewGroup = new THREE.Group()
dragPreviewGroup.visible = false
dragPreviewGroup.name = 'DragPreview'

const groundSelectionGroup = new THREE.Group()
groundSelectionGroup.visible = false
groundSelectionGroup.name = 'GroundSelection'

const groundSelectionOutlineMaterial = new THREE.LineBasicMaterial({
  color: 0x4dd0e1,
  linewidth: 2,
  transparent: true,
  opacity: 0.9,
  depthTest: true,
  depthWrite: false,
})

const groundSelectionOutlineGeometry = new THREE.BufferGeometry()
groundSelectionOutlineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(15), 3))
const groundSelectionOutline = new THREE.LineLoop(groundSelectionOutlineGeometry, groundSelectionOutlineMaterial)

const groundSelectionFillMaterial = new THREE.MeshBasicMaterial({
  color: 0x4dd0e1,
  transparent: true,
  opacity: 0.2,
  depthWrite: false,
  side: THREE.DoubleSide,
})

const groundSelectionFill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundSelectionFillMaterial)
groundSelectionFill.rotation.x = -Math.PI / 2

groundSelectionGroup.add(groundSelectionFill)
groundSelectionGroup.add(groundSelectionOutline)

let dragPreviewObject: THREE.Object3D | null = null
let dragPreviewAssetId: string | null = null
let pendingPreviewAssetId: string | null = null
let dragPreviewLoadToken = 0
let lastDragPoint: THREE.Vector3 | null = null
let fallbackLightGroup: THREE.Group | null = null
let isSelectDragOrbitDisabled = false
let isGroundSelectionOrbitDisabled = false
let isWallBuildOrbitDisabled = false
let orbitDisableCount = 0

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
      if (meshChild.userData?.dynamicMeshType === 'ground') {
        return
      }
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

function clampCameraDistance(target: THREE.Vector3, cam: THREE.PerspectiveCamera | THREE.OrthographicCamera): boolean {
  cameraOffsetHelper.copy(cam.position).sub(target)
  const distance = cameraOffsetHelper.length()
  if (distance >= MIN_CAMERA_DISTANCE && distance <= MAX_CAMERA_DISTANCE) {
    return false
  }

  if (distance < CAMERA_DISTANCE_EPSILON) {
    cameraOffsetHelper.set(0, 1, 0)
  } else {
    cameraOffsetHelper.normalize()
  }

  const desiredDistance = THREE.MathUtils.clamp(distance, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE)
  cameraOffsetHelper.multiplyScalar(desiredDistance).add(target)
  cam.position.copy(cameraOffsetHelper)
  return true
}

function clampCameraZoom(forceUpdate = true) {
  if (!camera || !orbitControls) return false

  let adjusted = false
  const target = orbitControls.target

  if (clampCameraDistance(target, camera)) {
    adjusted = true
  }

  if (camera instanceof THREE.OrthographicCamera) {
    const clampedZoom = THREE.MathUtils.clamp(camera.zoom, MIN_ORTHOGRAPHIC_ZOOM, MAX_ORTHOGRAPHIC_ZOOM)
    if (clampedZoom !== camera.zoom) {
      camera.zoom = clampedZoom
      camera.updateProjectionMatrix()
      adjusted = true
    }
  }

  if (perspectiveCamera && camera !== perspectiveCamera) {
    if (clampCameraDistance(target, perspectiveCamera)) {
      adjusted = true
    }
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

function updateOrthographicFrustum(camera: THREE.OrthographicCamera, width: number, height: number) {
  const aspect = height === 0 ? 1 : width / height
  const halfHeight = ORTHO_FRUSTUM_SIZE / 2
  const halfWidth = halfHeight * aspect
  camera.left = -halfWidth
  camera.right = halfWidth
  camera.top = halfHeight
  camera.bottom = -halfHeight
  camera.updateProjectionMatrix()
}

function ensureOrthographicCamera(width: number, height: number): THREE.OrthographicCamera {
  if (!orthographicCamera) {
    orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500)
  }
  updateOrthographicFrustum(orthographicCamera, width, height)
  return orthographicCamera
}

function bindControlsToCamera(newCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera) {
  if (orbitControls) {
    orbitControls.object = newCamera
    orbitControls.update()
  }
  if (transformControls) {
    transformControls.camera = newCamera
  }
}

function activateCamera(newCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera, mode: CameraProjectionMode) {
  camera = newCamera
  activeCameraMode = mode
  bindControlsToCamera(newCamera)
}

function getViewportSize() {
  if (viewportEl.value) {
    const width = viewportEl.value.clientWidth || 1
    const height = viewportEl.value.clientHeight || 1
    return { width, height }
  }
  const width = renderer?.domElement?.clientWidth ?? 1
  const height = renderer?.domElement?.clientHeight ?? 1
  return { width, height }
}

function applyProjectionMode(mode: CameraProjectionMode) {
  const { width, height } = getViewportSize()
  const previousCamera = camera

  if (mode === 'orthographic') {
    const newCamera = ensureOrthographicCamera(width, height)
    if (previousCamera) {
      newCamera.position.copy(previousCamera.position)
      newCamera.quaternion.copy(previousCamera.quaternion)
    }
    activateCamera(newCamera, 'orthographic')
  } else {
    if (!perspectiveCamera) {
      perspectiveCamera = new THREE.PerspectiveCamera(DEFAULT_PERSPECTIVE_FOV, width / height || 1, 0.1, 500)
    }
    perspectiveCamera.aspect = height === 0 ? 1 : width / height
    perspectiveCamera.updateProjectionMatrix()
    if (previousCamera) {
      perspectiveCamera.position.copy(previousCamera.position)
      perspectiveCamera.quaternion.copy(previousCamera.quaternion)
    }
    activateCamera(perspectiveCamera, 'perspective')
  }

  clampCameraZoom()
  clampCameraAboveGround()
  updatePlaceholderOverlayPositions()
}

function applyGridVisibility(visible: boolean) {
  gridGroup.visible = visible
  if (!visible) {
    updateGridHighlight(null)
    return
  }

  if (isDragHovering.value && lastDragPoint) {
    updateGridHighlight(lastDragPoint, DEFAULT_GRID_HIGHLIGHT_DIMENSIONS)
    return
  }

  restoreGridHighlightForSelection()
}

function applyAxesVisibility(visible: boolean) {
  axesHelper.visible = visible
}

function handleSkyboxPresetSelect(presetId: string) {
  if (!presetId || presetId === CUSTOM_SKYBOX_PRESET_ID) {
    return
  }
  sceneStore.applySkyboxPreset(presetId)
}

function handleSkyboxParameterChange(payload: { key: SkyboxParameterKey; value: number }) {
  if (Number.isNaN(payload.value)) {
    return
  }
  sceneStore.setSkyboxSettings(
    {
      [payload.key]: payload.value,
    } as Partial<SceneSkyboxSettings>,
    { markCustom: true },
  )
}

function handleShadowsEnabledChange(enabled: boolean) {
  sceneStore.setViewportShadowsEnabled(Boolean(enabled))
}

function handleAlignSelection(mode: AlignMode) {
  alignSelection(mode)
}

function createScreenshotFileName(): string {
  const sceneName = sceneStore.currentScene?.name ?? 'scene'
  const normalized = sceneName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const pad = (value: number) => value.toString().padStart(2, '0')
  const now = new Date()
  const dateStamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const base = normalized || 'scene'
  return `${base}-${dateStamp}.png`
}

function handleCaptureScreenshot() {
  if (!renderer || !scene || !camera) {
    return
  }

  try {
    renderer.render(scene, camera)
    const dataUrl = renderer.domElement.toDataURL('image/png')
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = createScreenshotFileName()
    link.rel = 'noopener'
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  } catch (error) {
    console.warn('Failed to capture viewport screenshot', error)
  }
}

function handleToggleCameraControlMode() {
  cameraControlMode.value = cameraControlMode.value === 'orbit' ? 'map' : 'orbit'
}

function handleOrbitLeft() {
  orbitCameraHorizontally(-1)
}

function handleOrbitRight() {
  orbitCameraHorizontally(1)
}

function calculateOptimalRotationDistance(): number {
  if (!camera) {
    return 10 // 默认距离
  }
  
  // 基于远近裁剪面计算距离
  const near = camera.near
  const far = camera.far
  
  // 使用对数比例，因为透视投影中的深度感知是对数的
  const logNear = Math.log(near)
  const logFar = Math.log(far)
  const logDistance = (logNear + logFar) / 2
  
  // 返回指数值
  return Math.exp(logDistance)
}
function orbitCameraHorizontally(direction: number) {
 if (!camera || !orbitControls) {
    return
  }

  const ORBIT_ANGLE = THREE.MathUtils.degToRad(2)
  
  // 获取相机方向
  const cameraDirection = new THREE.Vector3()
  camera.getWorldDirection(cameraDirection)
  
  // 计算合适的旋转中心距离
  let targetDistance = calculateOptimalRotationDistance()
  
  // 计算旋转中心点
  const rotationCenter = new THREE.Vector3()
  rotationCenter.copy(camera.position)
  rotationCenter.add(cameraDirection.multiplyScalar(targetDistance))
  rotationCenter.y = 0 // 强制Y坐标为0
  
  // 计算相机到旋转中心的向量
  const cameraToCenter = new THREE.Vector3().subVectors(camera.position, rotationCenter)
  
  // 转换为球坐标
  const spherical = new THREE.Spherical()
  spherical.setFromVector3(cameraToCenter)
  
  // 调整方位角（水平旋转）
  spherical.theta += direction * ORBIT_ANGLE
  
  // 将球坐标转换回直角坐标
  const newCameraToCenter = new THREE.Vector3()
  newCameraToCenter.setFromSpherical(spherical)
  
  // 计算新的相机位置
  const newCameraPosition = new THREE.Vector3().addVectors(rotationCenter, newCameraToCenter)
  
  // 更新相机位置
  camera.position.copy(newCameraPosition)
  
  // 确保相机看向旋转中心
  camera.lookAt(rotationCenter)
  
  // 更新orbitControls的目标点为旋转中心
  orbitControls.target.copy(rotationCenter)
  orbitControls.update()
  
  // 更新相机状态
  const snapshot = buildCameraState()
  if (snapshot) {
    emit('updateCamera', snapshot)
  }
  
  scheduleThumbnailCapture()

}

watch(gridVisible, (visible, previous) => {
  applyGridVisibility(visible)
  if (previous !== undefined && visible !== previous && sceneStore.isSceneReady) {
    scheduleThumbnailCapture()
  }
}, { immediate: true })

watch(axesVisible, (visible, previous) => {
  applyAxesVisibility(visible)
  if (previous !== undefined && visible !== previous && sceneStore.isSceneReady) {
    scheduleThumbnailCapture()
  }
}, { immediate: true })

watch(cameraProjectionMode, (mode, previous) => {
  if (!scene || !renderer) {
    activeCameraMode = mode
    return
  }
  if (previous !== undefined && mode === previous && mode === activeCameraMode) {
    return
  }
  applyProjectionMode(mode)
  if (sceneStore.isSceneReady) {
    scheduleThumbnailCapture()
  }
}, { immediate: true })

watch(skyboxSettings, (settings) => {
  applySkyboxSettingsToScene(settings)
}, { deep: true, immediate: true })

function resetCameraView() {
  if (!camera || !orbitControls) return

  const targetY = Math.max(DEFAULT_CAMERA_TARGET.y, MIN_TARGET_HEIGHT)
  const position = new THREE.Vector3(DEFAULT_CAMERA_POSITION.x, DEFAULT_CAMERA_POSITION.y, DEFAULT_CAMERA_POSITION.z)
  const target = new THREE.Vector3(DEFAULT_CAMERA_TARGET.x, targetY, DEFAULT_CAMERA_TARGET.z)

  isApplyingCameraState = true
  camera.position.copy(position)
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.fov = DEFAULT_PERSPECTIVE_FOV
    camera.updateProjectionMatrix()
  } else if (orthographicCamera) {
    orthographicCamera.zoom = 1
    orthographicCamera.updateProjectionMatrix()
  }

  if (perspectiveCamera && camera !== perspectiveCamera) {
    perspectiveCamera.position.copy(position)
    perspectiveCamera.fov = DEFAULT_PERSPECTIVE_FOV
    perspectiveCamera.updateProjectionMatrix()
  }

  orbitControls.target.copy(target)
  orbitControls.update()
  isApplyingCameraState = false

  clampCameraZoom()
  clampCameraAboveGround()

  const snapshot = buildCameraState()
  if (snapshot) {
    emit('updateCamera', snapshot)
  }

  scheduleThumbnailCapture()
}

function snapVectorToGrid(vec: THREE.Vector3) {
  vec.x = Math.round(vec.x / GRID_SNAP_SPACING) * GRID_SNAP_SPACING
  vec.z = Math.round(vec.z / GRID_SNAP_SPACING) * GRID_SNAP_SPACING
  return vec
}

export type SceneViewportHandle = {
  exportScene(options: SceneExportOptions): Promise<void>
  generateSceneBlob(options: SceneExportOptions): Promise<SceneExportResult>
}

async function exportScene(options: SceneExportOptions): Promise<void> {
  if (!scene) {
    throw new Error('Scene not initialized')
  }
  const { blob, fileName } = await prepareSceneExport(scene, options)
  triggerDownload(blob, fileName)
}

async function generateSceneBlob(options: SceneExportOptions): Promise<SceneExportResult> {
  if (!scene) {
    throw new Error('Scene not initialized')
  }
  return prepareSceneExport(scene, options)
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
  const fov = camera instanceof THREE.PerspectiveCamera
    ? camera.fov
    : perspectiveCamera?.fov ?? DEFAULT_PERSPECTIVE_FOV
  const forward = new THREE.Vector3()
  camera.getWorldDirection(forward)
  forward.normalize()
  return {
    position: toVector3Like(camera.position),
    target: toVector3Like(orbitControls.target),
    fov,
    forward: toVector3Like(forward),
  }
}

function applyCameraState(state: SceneCameraState | null | undefined) {
  if (!state || !orbitControls) return

  cameraTransitionState = null

  if (perspectiveCamera) {
    perspectiveCamera.position.set(state.position.x, state.position.y, state.position.z)
    if (perspectiveCamera.position.y < MIN_CAMERA_HEIGHT) {
      perspectiveCamera.position.y = MIN_CAMERA_HEIGHT
    }
    perspectiveCamera.fov = state.fov
    perspectiveCamera.updateProjectionMatrix()
  }

  if (!camera) return

  isApplyingCameraState = true
  camera.position.set(state.position.x, state.position.y, state.position.z)
  if (camera.position.y < MIN_CAMERA_HEIGHT) {
    camera.position.y = MIN_CAMERA_HEIGHT
  }

  if (camera instanceof THREE.PerspectiveCamera) {
    camera.fov = state.fov
    camera.updateProjectionMatrix()
  }

  const clampedTargetY = Math.max(state.target.y, MIN_TARGET_HEIGHT)
  orbitControls.target.set(state.target.x, clampedTargetY, state.target.z)
  orbitControls.update()
  clampCameraZoom()
  clampCameraAboveGround()
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

function buildParentIndex(nodes: SceneNode[], parentId: string | null, map: Map<string, string | null>) {
  nodes.forEach((node) => {
    map.set(node.id, parentId)
    if (node.children?.length) {
      buildParentIndex(node.children, node.id, map)
    }
  })
  return map
}

function filterTopLevelSelection(ids: string[], parentMap: Map<string, string | null>): string[] {
  const idSet = new Set(ids)
  return ids.filter((id) => {
    let parentId = parentMap.get(id) ?? null
    while (parentId) {
      if (idSet.has(parentId)) {
        return false
      }
      parentId = parentMap.get(parentId) ?? null
    }
    return true
  })
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

  clampCameraZoom()
  clampCameraAboveGround()

  if (perspectiveCamera && camera !== perspectiveCamera) {
    perspectiveCamera.position.copy(camera.position)
    perspectiveCamera.quaternion.copy(camera.quaternion)
  }

  const snapshot = buildCameraState()
  if (snapshot) {
    emit('updateCamera', snapshot)
  }

  return true
}

function handleControlsChange() {
  if (!isSceneReady.value || isApplyingCameraState) return
  clampCameraZoom()
  clampCameraAboveGround()
  const snapshot = buildCameraState()
  if (snapshot) {
    emit('updateCamera', snapshot)
  }
}

function applyCameraControlMode(mode: CameraControlMode) {
  if (!camera || !canvasRef.value) {
    return
  }

  const previousControls = orbitControls
  const previousTarget = previousControls ? previousControls.target.clone() : null
  const previousEnabled = previousControls?.enabled ?? true

  if (previousControls) {
    previousControls.removeEventListener('change', handleControlsChange)
    previousControls.dispose()
  }

  const domElement = canvasRef.value
  orbitControls = mode === 'map' ? new MapControls(camera, domElement) : new OrbitControls(camera, domElement)
  orbitControls.enableDamping = false
  orbitControls.dampingFactor = 0.05
  orbitControls.minDistance = MIN_CAMERA_DISTANCE
  orbitControls.maxDistance = MAX_CAMERA_DISTANCE
  orbitControls.minZoom = MIN_ORTHOGRAPHIC_ZOOM
  orbitControls.maxZoom = MAX_ORTHOGRAPHIC_ZOOM
  orbitControls.screenSpacePanning = false
  if (mode === 'map') {
    orbitControls.minPolarAngle = orbitControls.maxPolarAngle = THREE.MathUtils.degToRad(50)
  } else {
    orbitControls.maxPolarAngle = Math.PI
    orbitControls.minPolarAngle = 0
  }
  if (previousTarget) {
    orbitControls.target.copy(previousTarget)
  } else {
    orbitControls.target.set(DEFAULT_CAMERA_TARGET.x, DEFAULT_CAMERA_TARGET.y, DEFAULT_CAMERA_TARGET.z)
  }
  orbitControls.enabled = previousEnabled
  orbitControls.addEventListener('change', handleControlsChange)
  bindControlsToCamera(camera)
  orbitControls.update()

  clampCameraAboveGround()

  const snapshot = buildCameraState()
  if (snapshot) {
    emit('updateCamera', snapshot)
  }
}

function ensureStatsPanel() {
  if (!props.showStats) {
    disposeStats()
    return
  }

  const host = statsHostRef.value
  if (!host) {
    return
  }

  if (!stats) {
    stats = new Stats()
    statsPanelIndex = 0
    stats.showPanel(statsPanelIndex)
    stats.dom.classList.add('stats-panel')
    stats.dom.style.position = 'relative'
    stats.dom.style.top = '0'
    stats.dom.style.left = '0'
  }

  if (stats.dom.parentElement !== host) {
    host.appendChild(stats.dom)
  }

  if (!statsPointerHandler) {
    statsPointerHandler = () => {
      if (!stats) {
        return
      }
      const panelCount = stats.dom.children.length || 1
      statsPanelIndex = panelCount > 0 ? (statsPanelIndex + 1) % panelCount : 0
      stats.showPanel(statsPanelIndex)
    }
  }

  stats.dom.removeEventListener('click', statsPointerHandler)
  stats.dom.addEventListener('click', statsPointerHandler)

  stats.showPanel(statsPanelIndex)
}

function disposeStats() {
  if (stats && statsPointerHandler) {
    stats.dom.removeEventListener('click', statsPointerHandler)
  }
  if (stats) {
    stats.dom.remove()
  }
  stats = null
  statsPointerHandler = null
  statsPanelIndex = 0
}

function updateStatsVisibility() {
  if (!props.showStats) {
    disposeStats()
    return
  }
  ensureStatsPanel()
}

function initScene() {
  if (!canvasRef.value || !viewportEl.value) {
    return
  }

  const width = viewportEl.value.clientWidth
  const height = viewportEl.value.clientHeight

  updateStatsVisibility()

  renderer = new THREE.WebGLRenderer({
    canvas: canvasRef.value,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(width, height)
  renderer.shadowMap.enabled = Boolean(shadowsEnabled.value)
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = skyboxSettings.value.exposure
  renderer.outputColorSpace = THREE.SRGBColorSpace

  pmremGenerator?.dispose()
  pmremGenerator = new THREE.PMREMGenerator(renderer)

  scene = new THREE.Scene()
  const backgroundColor = new THREE.Color(DEFAULT_BACKGROUND_COLOR)
  scene.background = backgroundColor
  scene.fog = new THREE.Fog(backgroundColor.getHex(), 1, 5000)
  scene.fog.color.copy(backgroundColor)
  ensureSkyExists()
  scene.add(rootGroup)
  scene.add(gridGroup)
  scene.add(axesHelper)
  scene.add(groundSelectionGroup)
  scene.add(dragPreviewGroup)
  gridHighlight = createGridHighlight()
  if (gridHighlight) {
    scene.add(gridHighlight)
  }
  applyGridVisibility(gridVisible.value)
  applyAxesVisibility(axesVisible.value)
  ensureFallbackLighting()
  if (selectionTrackedObject) {
    updateSelectionBox(selectionTrackedObject)
  }

  applySkyboxSettingsToScene(skyboxSettings.value)
  if (pendingSkyboxSettings) {
    applySkyboxSettingsToScene(pendingSkyboxSettings)
  }

  perspectiveCamera = new THREE.PerspectiveCamera(DEFAULT_PERSPECTIVE_FOV, width / height || 1, 0.1, 500)
  perspectiveCamera.position.set(DEFAULT_CAMERA_POSITION.x, DEFAULT_CAMERA_POSITION.y, DEFAULT_CAMERA_POSITION.z)
  perspectiveCamera.lookAt(new THREE.Vector3(DEFAULT_CAMERA_TARGET.x, DEFAULT_CAMERA_TARGET.y, DEFAULT_CAMERA_TARGET.z))
  camera = perspectiveCamera
  activeCameraMode = 'perspective'

  orthographicCamera = ensureOrthographicCamera(width, height)
  orthographicCamera.position.copy(perspectiveCamera.position)
  orthographicCamera.lookAt(new THREE.Vector3(DEFAULT_CAMERA_TARGET.x, DEFAULT_CAMERA_TARGET.y, DEFAULT_CAMERA_TARGET.z))

  applyCameraControlMode(cameraControlMode.value)

  transformControls = new TransformControls(camera, canvasRef.value)
  transformControls.addEventListener('dragging-changed', draggingChangedHandler as any)
  transformControls.addEventListener('objectChange', handleTransformChange)
  transformControls.addEventListener('mouseDown', handleTransformMouseDown as any)
  transformControls.addEventListener('mouseUp', handleTransformMouseUp as any)
  scene.add(transformControls.getHelper())
  

  bindControlsToCamera(camera)
  if (cameraProjectionMode.value !== activeCameraMode && (cameraProjectionMode.value === 'orthographic' || cameraProjectionMode.value === 'perspective')) {
    applyProjectionMode(cameraProjectionMode.value)
  }

  canvasRef.value.addEventListener('pointerdown', handlePointerDown, { capture: true })
  canvasRef.value.addEventListener('contextmenu', handleViewportContextMenu)
  if (typeof window !== 'undefined') {
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
  }

  resizeObserver = new ResizeObserver(() => {
    if (!renderer || !viewportEl.value) return
    const w = viewportEl.value.clientWidth
    const h = viewportEl.value.clientHeight
    renderer.setSize(w, h)
    if (perspectiveCamera) {
      perspectiveCamera.aspect = h === 0 ? 1 : w / h
      perspectiveCamera.updateProjectionMatrix()
    }
    if (orthographicCamera) {
      updateOrthographicFrustum(orthographicCamera, w, h)
    }
  })
  resizeObserver.observe(viewportEl.value)

  animate()
  
  applyCameraState(props.cameraState)
}

function ensureSkyExists() {
  if (!scene || sky) {
    return
  }

  sky = new Sky()
  sky.name = 'HarmonySky'
  sky.scale.setScalar(SKY_SCALE)
  sky.frustumCulled = false
  scene.add(sky)
}

function applySkyboxSettingsToScene(settings: SceneSkyboxSettings | null) {
  if (!settings) {
    return
  }

  if (!scene || !renderer) {
    pendingSkyboxSettings = cloneSkyboxSettings(settings)
    return
  }

  ensureSkyExists()
  if (!sky) {
    pendingSkyboxSettings = cloneSkyboxSettings(settings)
    return
  }

  const skyMaterial = sky.material as THREE.ShaderMaterial
  const uniforms = skyMaterial.uniforms

  const assignUniform = (key: string, value: number) => {
    const uniform = uniforms[key]
    if (!uniform) {
      return
    }
    if (typeof uniform.value === 'number') {
      uniform.value = value
    } else if (uniform.value && typeof uniform.value === 'object' && 'setScalar' in uniform.value) {
      uniform.value.setScalar?.(value)
    } else {
      uniform.value = value
    }
  }

  assignUniform('turbidity', settings.turbidity)
  assignUniform('rayleigh', settings.rayleigh)
  assignUniform('mieCoefficient', settings.mieCoefficient)
  assignUniform('mieDirectionalG', settings.mieDirectionalG)

  updateSkyLighting(settings)

  renderer.toneMappingExposure = settings.exposure
  pendingSkyboxSettings = pmremGenerator ? null : cloneSkyboxSettings(settings)
  if (sceneStore.isSceneReady) {
    scheduleThumbnailCapture()
  }
}

function updateSkyLighting(settings: SceneSkyboxSettings) {
  if (!sky) {
    return
  }

  const skyMaterial = sky.material as THREE.ShaderMaterial
  const uniforms = skyMaterial.uniforms

  const phi = THREE.MathUtils.degToRad(90 - settings.elevation)
  const theta = THREE.MathUtils.degToRad(settings.azimuth)
  skySunPosition.setFromSphericalCoords(1, phi, theta)

  const sunUniform = uniforms['sunPosition']
  if (sunUniform?.value instanceof THREE.Vector3) {
    sunUniform.value.copy(skySunPosition)
  } else if (sunUniform) {
    sunUniform.value = skySunPosition.clone()
  }

  applySunDirectionToFallbackLight()

  if (!pmremGenerator) {
    return
  }

  if (skyEnvironmentTarget) {
    skyEnvironmentTarget.dispose()
    skyEnvironmentTarget = null
  }

  skyEnvironmentTarget = pmremGenerator.fromScene(sky as unknown as THREE.Scene)
  if (scene) {
    scene.environment = skyEnvironmentTarget.texture
    scene.environmentIntensity = SKY_ENVIRONMENT_INTENSITY
  }
}

function applySunDirectionToFallbackLight() {
  if (!fallbackDirectionalLight) {
    return
  }

  fallbackDirectionalLight.position.copy(skySunPosition).multiplyScalar(SKY_FALLBACK_LIGHT_DISTANCE)
  if (fallbackDirectionalLight.position.y < 10) {
    fallbackDirectionalLight.position.y = 10
  }
  fallbackDirectionalLight.target.position.set(0, 0, 0)
  fallbackDirectionalLight.target.updateMatrixWorld()
}

function disposeSkyResources() {
  if (skyEnvironmentTarget) {
    skyEnvironmentTarget.dispose()
    skyEnvironmentTarget = null
  }

  if (sky) {
    sky.removeFromParent()
    sky.geometry.dispose()
    const material = sky.material
    if (Array.isArray(material)) {
      material.forEach((entry) => entry?.dispose?.())
    } else {
      material?.dispose?.()
    }
    sky = null
  }

  if (scene) {
    scene.environment = null
    scene.environmentIntensity = 1
  }

  pmremGenerator?.dispose()
  pmremGenerator = null
}

function animate() {
  if (!renderer || !scene || !camera) {
    return
  }

  requestAnimationFrame(animate)
  stats?.begin()

  let controlsUpdated = false

  if (cameraTransitionState && orbitControls) {
    const { startTime, duration, startPosition, startTarget, endPosition, endTarget } = cameraTransitionState
    const elapsed = Math.max(performance.now() - startTime, 0)
    const progress = duration === 0 ? 1 : Math.min(elapsed / duration, 1)
    const eased = easeInOutCubic(progress)

    cameraTransitionCurrentPosition.copy(startPosition).lerp(endPosition, eased)
    cameraTransitionCurrentTarget.copy(startTarget).lerp(endTarget, eased)

    const previousApplying = isApplyingCameraState
    if (!previousApplying) {
      isApplyingCameraState = true
    }

    camera.position.copy(cameraTransitionCurrentPosition)
    orbitControls.target.copy(cameraTransitionCurrentTarget)
    orbitControls.update()

    if (!previousApplying) {
      isApplyingCameraState = false
    }

    controlsUpdated = true

    if (perspectiveCamera && camera !== perspectiveCamera) {
      perspectiveCamera.position.copy(cameraTransitionCurrentPosition)
      perspectiveCamera.quaternion.copy(camera.quaternion)
    }

    if (progress >= 1) {
      cameraTransitionState = null
  clampCameraZoom()
  clampCameraAboveGround()
      if (perspectiveCamera && camera !== perspectiveCamera) {
        perspectiveCamera.position.copy(camera.position)
        perspectiveCamera.quaternion.copy(camera.quaternion)
      }
      const finalSnapshot = buildCameraState()
      if (finalSnapshot) {
        emit('updateCamera', finalSnapshot)
      }
    }
  }

  if (orbitControls && !controlsUpdated) {
    orbitControls.update()
  }

  if (lightHelpersNeedingUpdate.size > 0 && scene) {
    scene.updateMatrixWorld(true)
    lightHelpersNeedingUpdate.forEach((helper) => {
      helper.update?.()
    })
  }

  if (selectionBoxHelper && selectionTrackedObject) {
    selectionBoxHelper.box.setFromObject(selectionTrackedObject)
  }
  if (wallPreviewNeedsSync) {
    wallPreviewNeedsSync = false
    syncWallPreview()
  }
  updatePlaceholderOverlayPositions()
  if (sky) {
    sky.position.copy(camera.position)
  }
  renderer.render(scene, camera)
  stats?.end()
}

function disposeScene() {
  disposeStats()

  resizeObserver?.disconnect()
  resizeObserver = null

  if (canvasRef.value) {
    canvasRef.value.removeEventListener('pointerdown', handlePointerDown, { capture: true })
    canvasRef.value.removeEventListener('contextmenu', handleViewportContextMenu)
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
    window.removeEventListener('pointercancel', handlePointerCancel)
  }
  pointerTrackingState = null

  transformControls?.removeEventListener('dragging-changed', draggingChangedHandler as any)
  transformControls?.removeEventListener('objectChange', handleTransformChange)
  transformControls?.dispose()
  transformControls = null
  transformGroupState = null

  clearLightHelpers()
  disposeSkyResources()

  if (scene && fallbackLightGroup) {
    scene.remove(fallbackLightGroup)
    fallbackLightGroup.clear()
  }
  fallbackLightGroup = null
  fallbackDirectionalLight = null

  groundSelectionGroup.removeFromParent()

  if (orbitControls) {
    orbitControls.removeEventListener('change', handleControlsChange)
    orbitControls.dispose()
  }
  orbitControls = null
  orbitDisableCount = 0
  isSelectDragOrbitDisabled = false
  isGroundSelectionOrbitDisabled = false

  if (thumbnailCaptureTimeout) {
    clearTimeout(thumbnailCaptureTimeout)
    thumbnailCaptureTimeout = null
  }

  renderer?.dispose()
  renderer = null

  if (gridHighlight) {
    gridHighlight.removeFromParent()
    gridHighlight.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh?.isMesh) {
        mesh.geometry?.dispose()
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        materials.forEach((material) => material?.dispose?.())
      }
      const line = child as THREE.Line
      if (line?.isLine) {
        line.geometry?.dispose()
        const materials = Array.isArray(line.material) ? line.material : [line.material]
        materials.forEach((material) => material?.dispose?.())
      }
    })
    gridHighlight = null
  }

  clearSelectionBox()
  disposeDragPreview()
  dragPreviewGroup.removeFromParent()

  clearSelectionHighlights()
  releaseGroundMeshCache()
  scene = null
  camera = null
  perspectiveCamera = null
  orthographicCamera = null

  clearPlaceholderOverlays()
  objectMap.clear()
  wallPreviewNeedsSync = false
  wallPreviewSignature = null
  pendingSceneGraphSync = false
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
  const group = new THREE.Group()
  group.name = 'GridHighlight'
  group.visible = false
  group.renderOrder = 1

  const planeGeometry = new THREE.PlaneGeometry(1, 1, 1, 1)
  const planeMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffecb3,
    emissive: 0xffc107,
    emissiveIntensity: 0.45,
    metalness: 0.6,
    roughness: 0.3,
    clearcoat: 0.4,
    clearcoatRoughness: 0.25,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  })
  planeMaterial.polygonOffset = true
  planeMaterial.polygonOffsetFactor = 1
  planeMaterial.polygonOffsetUnits = 1
  const plane = new THREE.Mesh(planeGeometry, planeMaterial)
  plane.name = 'GridHighlightPlane'
  plane.rotation.x = -Math.PI / 2
  plane.receiveShadow = false
  plane.castShadow = false
  plane.renderOrder = 1
  group.add(plane)

  const outlineGeometry = new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1))
  const outlineMaterial = new THREE.LineBasicMaterial({
    color: 0xfff176,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    toneMapped: false,
  })
  outlineMaterial.polygonOffset = true
  outlineMaterial.polygonOffsetFactor = 1
  outlineMaterial.polygonOffsetUnits = 1
  const outline = new THREE.LineSegments(outlineGeometry, outlineMaterial)
  outline.name = 'GridHighlightOutline'
  outline.rotation.x = -Math.PI / 2
  outline.renderOrder = 2
  group.add(outline)

  group.userData.plane = plane
  group.userData.outline = outline
  group.userData.lastDimensions = { width: 0, depth: 0 }

  return group
}

function createSelectionIndicator(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'SelectionIndicator'
  group.visible = false
  group.renderOrder = 2

  const planeGeometry = new THREE.PlaneGeometry(1, 1, 1, 1)
  const planeMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x82b1ff,
    emissive: 0x1565c0,
    emissiveIntensity: 0.3,
    metalness: 0.25,
    roughness: 0.55,
    clearcoat: 0.2,
    clearcoatRoughness: 0.4,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  })
  planeMaterial.polygonOffset = true
  planeMaterial.polygonOffsetFactor = 0.5
  planeMaterial.polygonOffsetUnits = 0.5
  const plane = new THREE.Mesh(planeGeometry, planeMaterial)
  plane.name = 'SelectionIndicatorPlane'
  plane.rotation.x = -Math.PI / 2
  plane.receiveShadow = false
  plane.castShadow = false
  plane.renderOrder = 2
  group.add(plane)

  const outlineGeometry = new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1))
  const outlineMaterial = new THREE.LineBasicMaterial({
    color: 0xbbdefb,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    toneMapped: false,
  })
  outlineMaterial.polygonOffset = true
  outlineMaterial.polygonOffsetFactor = 0.5
  outlineMaterial.polygonOffsetUnits = 0.5
  const outline = new THREE.LineSegments(outlineGeometry, outlineMaterial)
  outline.name = 'SelectionIndicatorOutline'
  outline.rotation.x = -Math.PI / 2
  outline.renderOrder = 3
  group.add(outline)

  group.userData.plane = plane
  group.userData.outline = outline
  group.userData.lastDimensions = { width: 0, depth: 0 }

  return group
}

function disposeSelectionIndicator(group: THREE.Group) {
  group.removeFromParent()
  const plane = group.userData.plane as THREE.Mesh | undefined
  if (plane) {
    plane.geometry.dispose()
    const materials = Array.isArray(plane.material) ? plane.material : [plane.material]
    materials.forEach((material) => material?.dispose?.())
  }
  const outline = group.userData.outline as THREE.LineSegments | undefined
  if (outline) {
    outline.geometry.dispose()
    const materials = Array.isArray(outline.material) ? outline.material : [outline.material]
    materials.forEach((material) => material?.dispose?.())
  }
}

function ensureSelectionIndicator(nodeId: string): THREE.Group | null {
  if (!scene) {
    return null
  }
  let group = selectionHighlights.get(nodeId) ?? null
  if (!group) {
    group = createSelectionIndicator()
    selectionHighlights.set(nodeId, group)
  }
  if (group.parent !== scene) {
    scene.add(group)
  }
  return group
}

function updateSelectionIndicatorFromObject(group: THREE.Group, object: THREE.Object3D) {
  object.updateMatrixWorld(true)
  object.getWorldPosition(selectionHighlightPositionHelper)
  selectionHighlightBoundingBox.setFromObject(object)
  if (selectionHighlightBoundingBox.isEmpty()) {
    selectionHighlightSizeHelper.setScalar(0)
  } else {
    selectionHighlightBoundingBox.getSize(selectionHighlightSizeHelper)
  }

  const width = Math.max(selectionHighlightSizeHelper.x + GRID_HIGHLIGHT_PADDING * 2, GRID_HIGHLIGHT_MIN_SIZE)
  const depth = Math.max(selectionHighlightSizeHelper.z + GRID_HIGHLIGHT_PADDING * 2, GRID_HIGHLIGHT_MIN_SIZE)

  group.position.set(selectionHighlightPositionHelper.x, GRID_HIGHLIGHT_HEIGHT, selectionHighlightPositionHelper.z)

  const plane = group.userData.plane as THREE.Mesh | undefined
  const outline = group.userData.outline as THREE.LineSegments | undefined
  const lastDimensions = group.userData.lastDimensions as GridHighlightDimensions | undefined
  if (!lastDimensions || Math.abs(lastDimensions.width - width) > 1e-3 || Math.abs(lastDimensions.depth - depth) > 1e-3) {
    if (plane) {
      plane.scale.set(width, depth, 1)
    }
    if (outline) {
      outline.scale.set(width, depth, 1)
    }
    group.userData.lastDimensions = { width, depth }
  }

  group.visible = true
}

function updateSelectionHighlights() {
  const selectedIds = sceneStore.selectedNodeIds.filter((id) => !!id && id !== props.selectedNodeId)
  const selectedIdSet = new Set(selectedIds)

  selectionHighlights.forEach((group, id) => {
    if (!selectedIdSet.has(id)) {
      group.visible = false
    }
  })

  if (!scene) {
    return
  }

  selectedIds.forEach((id) => {
    const object = objectMap.get(id)
    const group = ensureSelectionIndicator(id)
    if (!group) {
      return
    }
    if (!object) {
      group.visible = false
      return
    }
    updateSelectionIndicatorFromObject(group, object)
  })
}

function clearSelectionHighlights() {
  selectionHighlights.forEach((group) => {
    disposeSelectionIndicator(group)
  })
  selectionHighlights.clear()
}

type GridHighlightDimensions = { width: number; depth: number }

function updateGridHighlight(position: THREE.Vector3 | null, dimensions?: GridHighlightDimensions) {
  if (!gridHighlight) {
    return
  }
  if (!position || !gridVisible.value) {
    gridHighlight.visible = false
    return
  }

  gridHighlight.visible = true
  gridHighlight.position.set(position.x, GRID_HIGHLIGHT_HEIGHT, position.z)

  const width = Math.max(dimensions?.width ?? DEFAULT_GRID_HIGHLIGHT_SIZE, GRID_HIGHLIGHT_MIN_SIZE)
  const depth = Math.max(dimensions?.depth ?? DEFAULT_GRID_HIGHLIGHT_SIZE, GRID_HIGHLIGHT_MIN_SIZE)

  const plane = gridHighlight.userData.plane as THREE.Mesh | undefined
  const outline = gridHighlight.userData.outline as THREE.LineSegments | undefined

  const lastDimensions = gridHighlight.userData.lastDimensions as GridHighlightDimensions | undefined
  if (!lastDimensions || Math.abs(lastDimensions.width - width) > 1e-3 || Math.abs(lastDimensions.depth - depth) > 1e-3) {
    if (plane) {
      plane.scale.set(width, depth, 1)
    }
    if (outline) {
      outline.scale.set(width, depth, 1)
    }
    gridHighlight.userData.lastDimensions = { width, depth }
  }
}

function updateGridHighlightFromObject(object: THREE.Object3D | null) {
  if (!object) {
    updateGridHighlight(null)
    return
  }

  let current: THREE.Object3D | null = object
  while (current) {
    if (current.userData?.suppressGridHighlight) {
      updateGridHighlight(null)
      return
    }
    current = current.parent ?? null
  }

  object.updateMatrixWorld(true)
  object.getWorldPosition(gridHighlightPositionHelper)
  gridHighlightBoundingBox.setFromObject(object)
  if (gridHighlightBoundingBox.isEmpty()) {
    gridHighlightSizeHelper.setScalar(0)
  } else {
    gridHighlightBoundingBox.getSize(gridHighlightSizeHelper)
  }

  const width = Math.max(gridHighlightSizeHelper.x + GRID_HIGHLIGHT_PADDING * 2, GRID_HIGHLIGHT_MIN_SIZE)
  const depth = Math.max(gridHighlightSizeHelper.z + GRID_HIGHLIGHT_PADDING * 2, GRID_HIGHLIGHT_MIN_SIZE)
  updateGridHighlight(gridHighlightPositionHelper, { width, depth })
}

function restoreGridHighlightForSelection() {
  if (!gridVisible.value) {
    updateGridHighlight(null)
    return
  }

  const nodeId = props.selectedNodeId
  const target = nodeId && !sceneStore.isNodeSelectionLocked(nodeId)
    ? objectMap.get(nodeId) ?? null
    : null

  updateGridHighlightFromObject(target)
}

function dedupeSelection(ids: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  ids.forEach((id) => {
    if (!id || seen.has(id)) {
      return
    }
    seen.add(id)
    result.push(id)
  })
  return result
}

function selectionsAreEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

function emitSelectionChange(nextSelection: string[]) {
  const deduped = dedupeSelection(nextSelection)
  const current = sceneStore.selectedNodeIds
  if (selectionsAreEqual(deduped, current)) {
    return
  }
  const desiredPrimary = props.selectedNodeId && deduped.includes(props.selectedNodeId)
    ? props.selectedNodeId
    : deduped[0] ?? null
  emit('selectNode', {
    primaryId: desiredPrimary,
    selectedIds: deduped,
  })
}

function handleClickSelection(event: PointerEvent, trackingState: PointerTrackingState, options?: { allowDeselectOnReselect?: boolean }) {
  if (!scene) {
    return
  }

  const hit = pickNodeAtPointer(event) ?? trackingState.hitResult
  const isToggle = event.ctrlKey || event.metaKey || trackingState.ctrlKey || trackingState.metaKey
  const isRange = event.shiftKey || trackingState.shiftKey
  const currentSelection = sceneStore.selectedNodeIds
  const allowDeselectOnReselect = options?.allowDeselectOnReselect ?? true

  if (!hit) {
    if (!isToggle && !isRange) {
      emitSelectionChange([])
    }
    return
  }

  const nodeId = hit.nodeId
  const alreadySelected = currentSelection.includes(nodeId)

  if (isToggle || isRange) {
    if (alreadySelected) {
      emitSelectionChange(currentSelection.filter((id) => id !== nodeId))
    } else {
      emitSelectionChange([...currentSelection, nodeId])
    }
    return
  }

  if (allowDeselectOnReselect && currentSelection.length === 1 && alreadySelected) {
    emitSelectionChange([])
    return
  }

  emitSelectionChange([nodeId])
}

function raycastGroundPoint(event: PointerEvent, result: THREE.Vector3): boolean {
  if (!camera || !canvasRef.value) {
    return false
  }
  const rect = canvasRef.value.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) {
    return false
  }
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  return !!raycaster.ray.intersectPlane(groundPlane, result)
}

function clampPointToGround(definition: GroundDynamicMesh, point: THREE.Vector3): THREE.Vector3 {
  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  point.x = THREE.MathUtils.clamp(point.x, -halfWidth, halfWidth)
  point.z = THREE.MathUtils.clamp(point.z, -halfDepth, halfDepth)
  return point
}

function getGroundCellFromPoint(definition: GroundDynamicMesh, point: THREE.Vector3): { row: number; column: number } {
  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const normalizedColumn = (point.x + halfWidth) / definition.cellSize
  const normalizedRow = (point.z + halfDepth) / definition.cellSize
  const column = THREE.MathUtils.clamp(Math.floor(normalizedColumn), 0, Math.max(0, definition.columns - 1))
  const row = THREE.MathUtils.clamp(Math.floor(normalizedRow), 0, Math.max(0, definition.rows - 1))
  return { row, column }
}

function getGroundVertexHeight(definition: GroundDynamicMesh, row: number, column: number): number {
  const key = `${row}:${column}`
  return definition.heightMap[key] ?? 0
}

function createGroundSelectionFromCells(
  definition: GroundDynamicMesh,
  start: { row: number; column: number },
  end: { row: number; column: number },
): GroundCellSelection {
  const minRow = Math.min(start.row, end.row)
  const maxRow = Math.max(start.row, end.row)
  const minColumn = Math.min(start.column, end.column)
  const maxColumn = Math.max(start.column, end.column)

  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const cellSize = definition.cellSize

  const minX = -halfWidth + minColumn * cellSize
  const maxX = -halfWidth + (maxColumn + 1) * cellSize
  const minZ = -halfDepth + minRow * cellSize
  const maxZ = -halfDepth + (maxRow + 1) * cellSize

  const vertexMinRow = minRow
  const vertexMaxRow = Math.min(definition.rows, maxRow + 1)
  const vertexMinColumn = minColumn
  const vertexMaxColumn = Math.min(definition.columns, maxColumn + 1)

  const heights = [
    getGroundVertexHeight(definition, vertexMinRow, vertexMinColumn),
    getGroundVertexHeight(definition, vertexMinRow, vertexMaxColumn),
    getGroundVertexHeight(definition, vertexMaxRow, vertexMinColumn),
    getGroundVertexHeight(definition, vertexMaxRow, vertexMaxColumn),
  ]
  const averageHeight = heights.reduce((sum, value) => sum + value, 0) / heights.length

  const worldCenter = new THREE.Vector3(
    (minX + maxX) * 0.5,
    averageHeight,
    (minZ + maxZ) * 0.5,
  )

  return {
    minRow,
    maxRow,
    minColumn,
    maxColumn,
    worldCenter,
  }
}

function cellSelectionToVertexBounds(selection: GroundCellSelection, definition: GroundDynamicMesh) {
  return {
    minRow: selection.minRow,
    maxRow: Math.min(definition.rows, selection.maxRow + 1),
    minColumn: selection.minColumn,
    maxColumn: Math.min(definition.columns, selection.maxColumn + 1),
  }
}

function applyGroundSelectionVisuals(selection: GroundCellSelection | null, definition: GroundDynamicMesh | null) {
  if (!selection || !definition) {
    groundSelectionGroup.visible = false
    groundSelectionToolbarStyle.opacity = 0
    groundSelection.value = null
    return
  }

  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const cellSize = definition.cellSize

  const minX = -halfWidth + selection.minColumn * cellSize
  const maxX = -halfWidth + (selection.maxColumn + 1) * cellSize
  const minZ = -halfDepth + selection.minRow * cellSize
  const maxZ = -halfDepth + (selection.maxRow + 1) * cellSize

  const midX = (minX + maxX) * 0.5
  const midZ = (minZ + maxZ) * 0.5
  const averageHeight = selection.worldCenter.y

  groundSelectionFill.position.set(midX, averageHeight + 0.002, midZ)
  groundSelectionFill.scale.set(maxX - minX, maxZ - minZ, 1)

  const outlinePositions = groundSelectionOutlineGeometry.getAttribute('position') as THREE.BufferAttribute
  outlinePositions.setXYZ(0, minX, averageHeight + 0.004, minZ)
  outlinePositions.setXYZ(1, maxX, averageHeight + 0.004, minZ)
  outlinePositions.setXYZ(2, maxX, averageHeight + 0.004, maxZ)
  outlinePositions.setXYZ(3, minX, averageHeight + 0.004, maxZ)
  outlinePositions.setXYZ(4, minX, averageHeight + 0.004, minZ)
  outlinePositions.needsUpdate = true

  groundSelectionGroup.visible = true
  groundSelection.value = selection
  groundSelectionCenterHelper.copy(selection.worldCenter)
  updateGroundSelectionToolbarPosition()
}

function updateGroundSelectionToolbarPosition() {
  const selectionState = groundSelection.value
  if (!selectionState || !camera || !surfaceRef.value) {
    groundSelectionToolbarStyle.opacity = 0
    return
  }

  groundSelectionScreenHelper.copy(selectionState.worldCenter)
  groundSelectionScreenHelper.project(camera)
  if (groundSelectionScreenHelper.z < -1 || groundSelectionScreenHelper.z > 1) {
    groundSelectionToolbarStyle.opacity = 0
    return
  }

  const bounds = surfaceRef.value.getBoundingClientRect()
  const width = bounds.width
  const height = bounds.height

  groundSelectionToolbarStyle.left = `${(groundSelectionScreenHelper.x * 0.5 + 0.5) * width}px`
  groundSelectionToolbarStyle.top = `${(-groundSelectionScreenHelper.y * 0.5 + 0.5) * height}px`
  groundSelectionToolbarStyle.opacity = 1
}

function clearGroundSelection() {
  if (groundSelectionDragState) {
    if (canvasRef.value && canvasRef.value.hasPointerCapture(groundSelectionDragState.pointerId)) {
      canvasRef.value.releasePointerCapture(groundSelectionDragState.pointerId)
    }
    groundSelectionDragState = null
    restoreOrbitAfterGroundSelection()
  }
  groundSelectionGroup.visible = false
  groundSelection.value = null
  groundSelectionToolbarStyle.opacity = 0
  isGroundToolbarVisible.value = false
}

function cancelGroundSelection(): boolean {
  if (!groundSelection.value && !groundSelectionDragState) {
    return false
  }
  clearGroundSelection()
  return true
}

function updateGroundSelectionFromPointer(
  event: PointerEvent,
  definition: GroundDynamicMesh,
  options: { forceApply?: boolean } = {},
): boolean {
  if (!groundSelectionDragState) {
    return false
  }
  if (!raycastGroundPoint(event, groundPointerHelper)) {
    if (options.forceApply) {
      const selection = createGroundSelectionFromCells(
        definition,
        { row: groundSelectionDragState.startRow, column: groundSelectionDragState.startColumn },
        { row: groundSelectionDragState.currentRow, column: groundSelectionDragState.currentColumn },
      )
      applyGroundSelectionVisuals(selection, definition)
      return true
    }
    return false
  }
  clampPointToGround(definition, groundPointerHelper)
  const cell = getGroundCellFromPoint(definition, groundPointerHelper)
  const changed = cell.row !== groundSelectionDragState.currentRow || cell.column !== groundSelectionDragState.currentColumn
  if (changed) {
    groundSelectionDragState.currentRow = cell.row
    groundSelectionDragState.currentColumn = cell.column
  }
  if (changed || options.forceApply) {
    const selection = createGroundSelectionFromCells(
      definition,
      { row: groundSelectionDragState.startRow, column: groundSelectionDragState.startColumn },
      { row: groundSelectionDragState.currentRow, column: groundSelectionDragState.currentColumn },
    )
    applyGroundSelectionVisuals(selection, definition)
  }
  return true
}

function cancelWallSelection(): boolean {
  if (!wallBuildSession) {
    return false
  }
  if (wallBuildSession.pointerId !== null && canvasRef.value && canvasRef.value.hasPointerCapture(wallBuildSession.pointerId)) {
    canvasRef.value.releasePointerCapture(wallBuildSession.pointerId)
  }
  cancelWallDrag()
  clearWallBuildSession()
  restoreOrbitAfterWallBuild()
  return true
}

function refreshGroundMesh(definition: GroundDynamicMesh | null) {
  if (!definition) {
    return
  }
  const mesh = getGroundMeshObject()
  if (mesh) {
    updateGroundMesh(mesh, definition)
  }
}

async function handlePointerDown(event: PointerEvent) {
  if (!canvasRef.value || !camera || !scene) {
    pointerTrackingState = null
    return
  }

  if (!event.isPrimary) {
    pointerTrackingState = null
    return
  }

  const button = event.button
  const isSelectionButton = button === 0 || button === 2

  if (activeBuildTool.value === 'ground' && button === 0) {
    pointerTrackingState = null
    const definition = getGroundDynamicMeshDefinition()
    if (!definition || !raycastGroundPoint(event, groundPointerHelper)) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
    clampPointToGround(definition, groundPointerHelper)
    const cell = getGroundCellFromPoint(definition, groundPointerHelper)

    if (!groundSelectionDragState) {
      groundSelectionDragState = {
        pointerId: event.pointerId,
        startRow: cell.row,
        startColumn: cell.column,
        currentRow: cell.row,
        currentColumn: cell.column,
        phase: 'pending',
      }
      disableOrbitForGroundSelection()
      isGroundToolbarVisible.value = false
      const selection = createGroundSelectionFromCells(definition, cell, cell)
      applyGroundSelectionVisuals(selection, definition)
    } else if (groundSelectionDragState.phase === 'sizing') {
      groundSelectionDragState.pointerId = event.pointerId
      groundSelectionDragState.currentRow = cell.row
      groundSelectionDragState.currentColumn = cell.column
      groundSelectionDragState.phase = 'finalizing'
      updateGroundSelectionFromPointer(event, definition, { forceApply: true })
      disableOrbitForGroundSelection()
    } else {
      groundSelectionDragState.pointerId = event.pointerId
      groundSelectionDragState.currentRow = cell.row
      groundSelectionDragState.currentColumn = cell.column
    }

    try {
      canvasRef.value?.setPointerCapture(event.pointerId)
    } catch (error) {
      /* noop */
    }
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (activeBuildTool.value === 'wall') {
    if (button === 0) {
      pointerTrackingState = null
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
    if (button === 2) {
      pointerTrackingState = null
      if (wallBuildSession) {
        wallBuildSession.finalizePointer = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
        }
      }
      return
    }
  }

  if (!isSelectionButton) {
    pointerTrackingState = null
    return
  }

  if (transformControls?.dragging) {
    pointerTrackingState = null
    return
  }

  if (button === 2) {
    event.preventDefault()
  }

  const primaryBeforeDuplicate = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
  const shouldPickForRightClick = button === 2 && props.activeTool === 'select'
  let hit = button === 0 || shouldPickForRightClick ? pickNodeAtPointer(event) : null
  const initialHitPoint = hit ? hit.point.clone() : null

  if (
    button === 0 &&
    props.activeTool === 'select' &&
    hit &&
    (event.ctrlKey || event.metaKey) &&
    primaryBeforeDuplicate &&
    hit.nodeId === primaryBeforeDuplicate &&
    !sceneStore.isNodeSelectionLocked(hit.nodeId)
  ) {
    const unlockedSelection = sceneStore.selectedNodeIds.filter((id) => !sceneStore.isNodeSelectionLocked(id))
    const idsToDuplicate = unlockedSelection.length ? unlockedSelection : [hit.nodeId]
    const duplicateIds = sceneStore.duplicateNodes(idsToDuplicate, { select: true })
    if (duplicateIds.length) {
      await nextTick()
      await nextTick()
      const updatedHit = pickNodeAtPointer(event)
      if (updatedHit && duplicateIds.includes(updatedHit.nodeId)) {
        hit = updatedHit
      } else {
        const primaryId = sceneStore.selectedNodeId ?? null
        if (primaryId) {
          const object = objectMap.get(primaryId) ?? null
          if (object) {
            object.updateMatrixWorld(true)
            const fallbackPoint = initialHitPoint
              ? initialHitPoint.clone()
              : (() => {
                  const world = new THREE.Vector3()
                  object.getWorldPosition(world)
                  return world
                })()
            hit = {
              nodeId: primaryId,
              object,
              point: fallbackPoint,
            }
          }
        }
      }
    }
  }

  if (!hit && shouldPickForRightClick) {
    const boundingHit = pickActiveSelectionBoundingBoxHit(event)
    if (boundingHit) {
      hit = boundingHit
    }
  }

  let dragHit = hit
  if (!dragHit && button === 0 && props.activeTool === 'select') {
    dragHit = pickActiveSelectionBoundingBoxHit(event)
  }

  const activeTransformAxis = button === 0 && props.activeTool !== 'select' ? (transformControls?.axis ?? null) : null

  try {
    canvasRef.value.setPointerCapture(event.pointerId)
  } catch (error) {
    /* noop */
  }

  const currentPrimaryId = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
  const selectionDrag = button === 0 && props.activeTool === 'select' && dragHit && currentPrimaryId && dragHit.nodeId === currentPrimaryId
    ? createSelectionDragState(dragHit.nodeId, dragHit.object, dragHit.point, event)
    : null

  if (selectionDrag) {
    disableOrbitForSelectDrag()
  }

  pointerTrackingState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    button,
    hitResult: hit,
    selectionDrag,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    transformAxis: activeTransformAxis,
  }
}

function handlePointerMove(event: PointerEvent) {
  if (groundSelectionDragState && event.pointerId === groundSelectionDragState.pointerId) {
    const definition = getGroundDynamicMeshDefinition()
    if (!definition) {
      groundSelectionDragState = null
      clearGroundSelection()
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
    updateGroundSelectionFromPointer(event, definition)
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (activeBuildTool.value === 'wall' && wallBuildSession) {
    if (wallBuildSession.finalizePointer && wallBuildSession.finalizePointer.pointerId === event.pointerId) {
      const dx = event.clientX - wallBuildSession.finalizePointer.startX
      const dy = event.clientY - wallBuildSession.finalizePointer.startY
      if (!wallBuildSession.finalizePointer.moved && Math.hypot(dx, dy) >= CLICK_DRAG_THRESHOLD_PX) {
        wallBuildSession.finalizePointer.moved = true
      }
    }
    if (wallBuildSession.dragStart) {
      const isRightButtonActive =
        !!wallBuildSession.finalizePointer &&
        wallBuildSession.finalizePointer.pointerId === event.pointerId &&
        (event.buttons & 2) !== 0
      if (!isRightButtonActive) {
        updateWallSegmentDrag(event)
        return
      }
    }
  }

  if (!pointerTrackingState || event.pointerId !== pointerTrackingState.pointerId) {
    return
  }

  if (transformControls?.dragging) {
    pointerTrackingState.moved = true
    return
  }

  const dx = event.clientX - pointerTrackingState.startX
  const dy = event.clientY - pointerTrackingState.startY
  const distance = Math.hypot(dx, dy)

  if (pointerTrackingState.button === 2) {
    if (!pointerTrackingState.moved && distance >= CLICK_DRAG_THRESHOLD_PX) {
      pointerTrackingState.moved = true
    }
    return
  }

  if (pointerTrackingState.button !== 0) {
    return
  }

  const drag = pointerTrackingState.selectionDrag

  if (drag) {
    if (!drag.hasDragged) {
      if (distance < CLICK_DRAG_THRESHOLD_PX) {
        return
      }
      drag.hasDragged = true
      pointerTrackingState.moved = true
      sceneStore.beginTransformInteraction(drag.nodeId)
    }

    if (updateSelectDragPosition(drag, event)) {
      return
    }

    return
  }

  if (!pointerTrackingState.moved && distance >= CLICK_DRAG_THRESHOLD_PX) {
    pointerTrackingState.moved = true
  }
}

function handlePointerUp(event: PointerEvent) {
  if (groundSelectionDragState && event.pointerId === groundSelectionDragState.pointerId) {
    if (canvasRef.value && canvasRef.value.hasPointerCapture(event.pointerId)) {
      canvasRef.value.releasePointerCapture(event.pointerId)
    }
    const definition = getGroundDynamicMeshDefinition()
    if (!definition) {
      clearGroundSelection()
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }

    if (groundSelectionDragState.phase === 'pending') {
      updateGroundSelectionFromPointer(event, definition, { forceApply: true })
      groundSelectionDragState.phase = 'sizing'
      restoreOrbitAfterGroundSelection()
      isGroundToolbarVisible.value = false
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }

    if (groundSelectionDragState.phase === 'finalizing') {
      updateGroundSelectionFromPointer(event, definition, { forceApply: true })
      groundSelectionDragState = null
      restoreOrbitAfterGroundSelection()
      if (groundSelection.value) {
        isGroundToolbarVisible.value = true
        updateGroundSelectionToolbarPosition()
      } else {
        isGroundToolbarVisible.value = false
      }
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }

    updateGroundSelectionFromPointer(event, definition, { forceApply: true })
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (wallBuildSession && wallBuildSession.pointerId === event.pointerId) {
    if (canvasRef.value && canvasRef.value.hasPointerCapture(event.pointerId)) {
      canvasRef.value.releasePointerCapture(event.pointerId)
    }
    commitWallSegmentDrag()
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (activeBuildTool.value === 'wall') {
    if (event.button === 2) {
      if (wallBuildSession) {
        if (wallBuildSession.finalizePointer && wallBuildSession.finalizePointer.pointerId === event.pointerId) {
          const shouldFinalize = !wallBuildSession.finalizePointer.moved
          wallBuildSession.finalizePointer = null
          if (shouldFinalize) {
            finalizeWallBuildSession()
          }
        } else {
          wallBuildSession.finalizePointer = null
        }
      }
      return
    }
    if (event.button === 0) {
      const handled = handleWallPlacementClick(event)
      if (handled) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
      }
      return
    }
  }

  if (!pointerTrackingState || event.pointerId !== pointerTrackingState.pointerId) {
    return
  }

  const trackingState = pointerTrackingState
  pointerTrackingState = null

  if (canvasRef.value && canvasRef.value.hasPointerCapture(event.pointerId)) {
    canvasRef.value.releasePointerCapture(event.pointerId)
  }

  if (transformControls?.dragging) {
    return
  }

  const drag = trackingState.selectionDrag
  if (drag) {
    restoreOrbitAfterSelectDrag()
    updateGridHighlightFromObject(drag.object)
    if (drag.hasDragged) {
      sceneStore.endTransformInteraction()
      updateSelectionHighlights()
      scheduleThumbnailCapture()
      return
    }
  }

  if (trackingState.button === 2) {
    if (!trackingState.moved) {
      if (props.activeTool === 'select') {
        const primaryId = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
        if (primaryId && !sceneStore.isNodeSelectionLocked(primaryId)) {
          let hit = pickNodeAtPointer(event) ?? trackingState.hitResult
          if (!hit) {
            hit = pickActiveSelectionBoundingBoxHit(event)
          }
          if (hit && hit.nodeId === primaryId) {
            event.preventDefault()
            event.stopPropagation()
            rotateActiveSelection(primaryId)
            return
          }
        }
      }

      event.preventDefault()
      event.stopPropagation()
      recenterCameraOnPointer(event)
    }
    return
  }

  if (trackingState.button !== 0) {
    return
  }

  if (trackingState.moved) {
    return
  }

  if (props.activeTool !== 'select' && trackingState.transformAxis) {
    return
  }

  handleClickSelection(event, trackingState, {
    allowDeselectOnReselect: props.activeTool === 'select',
  })
}

function handlePointerCancel(event: PointerEvent) {
  if (groundSelectionDragState && event.pointerId === groundSelectionDragState.pointerId) {
    if (canvasRef.value && canvasRef.value.hasPointerCapture(event.pointerId)) {
      canvasRef.value.releasePointerCapture(event.pointerId)
    }
    groundSelectionDragState = null
    clearGroundSelection()
    restoreOrbitAfterGroundSelection()
    isGroundToolbarVisible.value = false
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (activeBuildTool.value === 'wall' && wallBuildSession) {
    cancelWallDrag()
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (!pointerTrackingState || event.pointerId !== pointerTrackingState.pointerId) {
    return
  }

  if (canvasRef.value && canvasRef.value.hasPointerCapture(event.pointerId)) {
    canvasRef.value.releasePointerCapture(event.pointerId)
  }

  if (pointerTrackingState.selectionDrag) {
    restoreOrbitAfterSelectDrag()
    updateGridHighlightFromObject(pointerTrackingState.selectionDrag.object)
  }

  if (pointerTrackingState.selectionDrag && pointerTrackingState.selectionDrag.hasDragged) {
    sceneStore.endTransformInteraction()
    scheduleThumbnailCapture()
  }

  updateSelectionHighlights()
  pointerTrackingState = null
}

function commitGroundModification(
  modifier: (bounds: { minRow: number; maxRow: number; minColumn: number; maxColumn: number }) => boolean,
) {
  const selection = groundSelection.value
  const definition = getGroundDynamicMeshDefinition()
  if (!selection || !definition) {
    return
  }
  const bounds = cellSelectionToVertexBounds(selection, definition)
  const changed = modifier(bounds)
  if (!changed) {
    return
  }
  refreshGroundMesh(getGroundDynamicMeshDefinition())
  scheduleThumbnailCapture()
  updateGroundSelectionToolbarPosition()
}

function handleGroundRaise() {
  commitGroundModification((bounds) => sceneStore.raiseGroundRegion(bounds, GROUND_HEIGHT_STEP))
}

function handleGroundLower() {
  commitGroundModification((bounds) => sceneStore.lowerGroundRegion(bounds, GROUND_HEIGHT_STEP))
}

function handleGroundReset() {
  commitGroundModification((bounds) => sceneStore.resetGroundRegion(bounds))
}

function handleGroundTextureSelectRequest() {
  if (!groundTextureInputRef.value) {
    return
  }
  groundTextureInputRef.value.value = ''
  groundTextureInputRef.value.click()
}

function handleGroundTextureFileChange(event: Event) {
  const input = event.target as HTMLInputElement | null
  if (!input?.files || input.files.length === 0) {
    return
  }
  const file = input.files[0]
  if (!file) {
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : null
    if (!result) {
      return
    }
    const changed = sceneStore.setGroundTexture({ dataUrl: result, name: file.name ?? null })
    if (!changed) {
      return
    }
    refreshGroundMesh(getGroundDynamicMeshDefinition())
    scheduleThumbnailCapture()
  }
  reader.readAsDataURL(file)
}

function handleGroundCancel() {
  cancelGroundSelection()
}

function disposeWallPreviewGroup(group: THREE.Group) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      const geometry = mesh.geometry
      if (geometry) {
        geometry.dispose()
      }
      const material = mesh.material
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose())
      } else if (material) {
        material.dispose()
      }
    }
  })
}

function applyWallPreviewStyling(group: THREE.Group) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    const material = mesh.material as THREE.Material & { opacity?: number; transparent?: boolean }
    if ('opacity' in material) {
      material.opacity = 0.45
      material.transparent = true
    }
    mesh.layers.enableAll()
    mesh.renderOrder = 999
  })
}

const WALL_PREVIEW_SIGNATURE_PRECISION = 1000

function encodeWallPreviewNumber(value: number): string {
  return `${Math.round(value * WALL_PREVIEW_SIGNATURE_PRECISION)}`
}

function computeWallPreviewSignature(
  segments: WallSessionSegment[],
  dimensions: { height: number; width: number; thickness: number },
): string {
  if (!segments.length) {
    return 'empty'
  }

  const dimensionSignature = [
    encodeWallPreviewNumber(dimensions.height),
    encodeWallPreviewNumber(dimensions.width),
    encodeWallPreviewNumber(dimensions.thickness),
  ].join('|')

  const segmentSignature = segments
    .map(({ start, end }) => [
      encodeWallPreviewNumber(start.x),
      encodeWallPreviewNumber(start.y),
      encodeWallPreviewNumber(start.z),
      encodeWallPreviewNumber(end.x),
      encodeWallPreviewNumber(end.y),
      encodeWallPreviewNumber(end.z),
    ].join(','))
    .join(';')

  return `${dimensionSignature}|${segmentSignature}`
}

function buildWallPreviewDefinition(segments: WallSessionSegment[], dimensions: { height: number; width: number; thickness: number }): { center: THREE.Vector3; definition: WallDynamicMesh } | null {
  if (!segments.length) {
    return null
  }

  const min = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
  const max = new THREE.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)

  segments.forEach(({ start, end }) => {
    min.min(start)
    min.min(end)
    max.max(start)
    max.max(end)
  })

  if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) {
    return null
  }

  const center = new THREE.Vector3(
    (min.x + max.x) * 0.5,
    (min.y + max.y) * 0.5,
    (min.z + max.z) * 0.5,
  )

  const normalized = normalizeWallDimensionsForViewport(dimensions)

  const definition: WallDynamicMesh = {
    type: 'wall',
    segments: segments.map(({ start, end }) => ({
      start: { x: start.x - center.x, y: start.y - center.y, z: start.z - center.z },
      end: { x: end.x - center.x, y: end.y - center.y, z: end.z - center.z },
      height: normalized.height,
      width: normalized.width,
      thickness: normalized.thickness,
    })),
  }

  return { center, definition }
}

function getWallNodeDimensions(node: SceneNode): { height: number; width: number; thickness: number } {
  if (node.dynamicMesh?.type !== 'wall' || node.dynamicMesh.segments.length === 0) {
    return normalizeWallDimensionsForViewport({
      height: WALL_DEFAULT_HEIGHT,
      width: WALL_DEFAULT_WIDTH,
      thickness: WALL_DEFAULT_THICKNESS,
    })
  }
  const sample = node.dynamicMesh.segments[0]!
  return normalizeWallDimensionsForViewport({
    height: sample.height ?? WALL_DEFAULT_HEIGHT,
    width: sample.width ?? WALL_DEFAULT_WIDTH,
    thickness: sample.thickness ?? WALL_DEFAULT_THICKNESS,
  })
}

function expandWallSegmentsToWorld(node: SceneNode): WallSessionSegment[] {
  if (node.dynamicMesh?.type !== 'wall') {
    return []
  }
  const origin = new THREE.Vector3(node.position.x, node.position.y, node.position.z)
  return node.dynamicMesh.segments.map((segment) => ({
    start: new THREE.Vector3(segment.start.x + origin.x, segment.start.y + origin.y, segment.start.z + origin.z),
    end: new THREE.Vector3(segment.end.x + origin.x, segment.end.y + origin.y, segment.end.z + origin.z),
  }))
}

function clearWallPreview() {
  if (wallBuildSession?.previewGroup) {
    const preview = wallBuildSession.previewGroup
    preview.removeFromParent()
    disposeWallPreviewGroup(preview)
    wallBuildSession.previewGroup = null
  }
  wallPreviewSignature = null
}

function updateWallPreview(options?: { immediate?: boolean }) {
  if (options?.immediate) {
    wallPreviewNeedsSync = false
    syncWallPreview()
    return
  }
  wallPreviewNeedsSync = true
}

function syncWallPreview() {
  if (!scene || !wallBuildSession) {
    if (wallPreviewSignature !== null) {
      clearWallPreview()
      wallPreviewSignature = null
    }
    return
  }

  const segments: WallSessionSegment[] = [...wallBuildSession.segments]
  if (wallBuildSession.dragStart && wallBuildSession.dragEnd) {
    segments.push({ start: wallBuildSession.dragStart.clone(), end: wallBuildSession.dragEnd.clone() })
  }

  const hasCommittedNode = !!wallBuildSession.nodeId
  const hasActiveDrag = !!wallBuildSession.dragStart && !!wallBuildSession.dragEnd
  if (hasCommittedNode && !hasActiveDrag) {
    if (wallBuildSession.previewGroup) {
      clearWallPreview()
    }
    wallPreviewSignature = null
    return
  }

  if (!segments.length) {
    if (wallBuildSession.previewGroup) {
      clearWallPreview()
    }
    wallPreviewSignature = null
    return
  }

  const build = buildWallPreviewDefinition(segments, wallBuildSession.dimensions)
  if (!build) {
    if (wallBuildSession.previewGroup) {
      clearWallPreview()
    }
    wallPreviewSignature = null
    return
  }

  const signature = computeWallPreviewSignature(segments, wallBuildSession.dimensions)
  if (signature === wallPreviewSignature) {
    return
  }
  wallPreviewSignature = signature

  if (!wallBuildSession.previewGroup) {
    const preview = createWallGroup(build.definition)
    applyWallPreviewStyling(preview)
    preview.userData.isWallPreview = true
    wallBuildSession.previewGroup = preview
    rootGroup.add(preview)
  } else {
    updateWallGroup(wallBuildSession.previewGroup, build.definition)
    applyWallPreviewStyling(wallBuildSession.previewGroup)
    if (!rootGroup.children.includes(wallBuildSession.previewGroup)) {
      rootGroup.add(wallBuildSession.previewGroup)
    }
  }

  wallBuildSession.previewGroup!.position.copy(build.center)
}

function clearWallBuildSession(options: { disposePreview?: boolean } = {}) {
  if (options.disposePreview ?? true) {
    clearWallPreview()
  } else if (wallBuildSession?.previewGroup) {
    wallBuildSession.previewGroup.removeFromParent()
  }
  wallBuildSession = null
  wallPreviewSignature = null
}

function ensureWallBuildSession(): WallBuildSession {
  if (wallBuildSession) {
    return wallBuildSession
  }
  wallBuildSession = {
    pointerId: null,
    dragStart: null,
    dragEnd: null,
    segments: [],
    previewGroup: null,
    nodeId: null,
    dimensions: normalizeWallDimensionsForViewport({
      height: WALL_DEFAULT_HEIGHT,
      width: WALL_DEFAULT_WIDTH,
      thickness: WALL_DEFAULT_THICKNESS,
    }),
    finalizePointer: null,
  }
  return wallBuildSession
}

function constrainWallEndPoint(start: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
  const delta = target.clone().sub(start)
  const stepX = Math.round(delta.x / GRID_SNAP_SPACING)
  const stepZ = Math.round(delta.z / GRID_SNAP_SPACING)

  if (stepX === 0 && stepZ === 0) {
    return start.clone()
  }

  let finalStepX = stepX
  let finalStepZ = stepZ

  if (finalStepX !== 0 && finalStepZ !== 0) {
    if (Math.abs(finalStepX) === Math.abs(finalStepZ)) {
      // already diagonal
    } else if (Math.abs(finalStepX) > Math.abs(finalStepZ)) {
      finalStepZ = 0
    } else {
      finalStepX = 0
    }
  }

  return new THREE.Vector3(
    start.x + finalStepX * GRID_SNAP_SPACING,
    start.y,
    start.z + finalStepZ * GRID_SNAP_SPACING,
  )
}

function hydrateWallBuildSessionFromSelection(session: WallBuildSession) {
  if (!session.nodeId) {
    const selectedId = sceneStore.selectedNodeId
    if (selectedId) {
      const selectedNode = findSceneNode(sceneStore.nodes, selectedId)
      if (selectedNode?.dynamicMesh?.type === 'wall') {
        session.nodeId = selectedNode.id
        session.dimensions = getWallNodeDimensions(selectedNode)
        session.segments = expandWallSegmentsToWorld(selectedNode)
      }
    }
  } else {
    const node = findSceneNode(sceneStore.nodes, session.nodeId)
    if (node?.dynamicMesh?.type === 'wall') {
      session.dimensions = getWallNodeDimensions(node)
      session.segments = expandWallSegmentsToWorld(node)
    }
  }
  session.dimensions = normalizeWallDimensionsForViewport(session.dimensions)
}

function beginWallSegmentDrag(startPoint: THREE.Vector3) {
  disableOrbitForWallBuild()
  const session = ensureWallBuildSession()
  hydrateWallBuildSessionFromSelection(session)
  session.pointerId = null
  session.dragStart = startPoint.clone()
  session.dragEnd = startPoint.clone()
  session.finalizePointer = null
  updateWallPreview()
}

function updateWallSegmentDrag(event: PointerEvent) {
  if (!wallBuildSession || !wallBuildSession.dragStart) {
    return
  }

  if (!raycastGroundPoint(event, groundPointerHelper)) {
    return
  }

  const pointer = snapVectorToGrid(groundPointerHelper.clone())
  const constrained = constrainWallEndPoint(wallBuildSession.dragStart, pointer)
  const previous = wallBuildSession.dragEnd
  if (previous && previous.equals(constrained)) {
    return
  }
  wallBuildSession.dragEnd = constrained
  updateWallPreview()
}

function resetWallDragState() {
  if (!wallBuildSession) {
    return
  }
  wallBuildSession.pointerId = null
  restoreOrbitAfterWallBuild()
}

function cancelWallDrag() {
  if (!wallBuildSession) {
    return
  }
  wallBuildSession.dragStart = null
  wallBuildSession.dragEnd = null
  wallBuildSession.finalizePointer = null
  resetWallDragState()
  updateWallPreview()
}

function commitWallSegmentDrag(): boolean {
  if (!wallBuildSession || !wallBuildSession.dragStart || !wallBuildSession.dragEnd) {
    return false
  }

  const start = wallBuildSession.dragStart.clone()
  const end = wallBuildSession.dragEnd.clone()
  if (start.distanceToSquared(end) < 1e-6) {
    cancelWallDrag()
    return false
  }

  const segment: WallSessionSegment = { start, end }
  const pendingSegments = [...wallBuildSession.segments, segment]

  const segmentPayload = pendingSegments.map((entry) => ({
    start: { x: entry.start.x, y: entry.start.y, z: entry.start.z },
    end: { x: entry.end.x, y: entry.end.y, z: entry.end.z },
  }))

  let nodeId = wallBuildSession.nodeId
  if (!nodeId) {
    const created = sceneStore.createWallNode({
      segments: segmentPayload,
      dimensions: wallBuildSession.dimensions,
    })
    if (!created) {
      cancelWallDrag()
      return false
    }
    nodeId = created.id
    wallBuildSession.nodeId = nodeId
    wallBuildSession.segments = pendingSegments
    wallBuildSession.dimensions = getWallNodeDimensions(created)
  } else {
    const updated = sceneStore.updateWallNodeGeometry(nodeId, {
      segments: segmentPayload,
      dimensions: wallBuildSession.dimensions,
    })
    if (!updated) {
      cancelWallDrag()
      return false
    }
    wallBuildSession.segments = pendingSegments
    const refreshed = findSceneNode(sceneStore.nodes, nodeId)
    if (refreshed?.dynamicMesh?.type === 'wall') {
      wallBuildSession.dimensions = getWallNodeDimensions(refreshed)
    }
  }

  wallBuildSession.dragStart = end.clone()
  wallBuildSession.dragEnd = end.clone()
  wallBuildSession.pointerId = null
  wallBuildSession.finalizePointer = null
  wallBuildSession.dimensions = normalizeWallDimensionsForViewport(wallBuildSession.dimensions)
  updateWallPreview()
  scheduleThumbnailCapture()
  return true
}

function handleWallPlacementClick(event: PointerEvent): boolean {
  if (!activeBuildTool.value || activeBuildTool.value !== 'wall') {
    return false
  }
  if (!raycastGroundPoint(event, groundPointerHelper)) {
    return false
  }
  const snappedPoint = snapVectorToGrid(groundPointerHelper.clone())
  const session = ensureWallBuildSession()

  if (!session.dragStart) {
    beginWallSegmentDrag(snappedPoint)
    return true
  }

  const constrained = constrainWallEndPoint(session.dragStart, snappedPoint)
  const previous = session.dragEnd
  if (!previous || !previous.equals(constrained)) {
    session.dragEnd = constrained
    updateWallPreview()
  }

  if (!commitWallSegmentDrag()) {
    session.dragStart = constrained.clone()
    session.dragEnd = constrained.clone()
    updateWallPreview()
  }
  return true
}

function finalizeWallBuildSession() {
  if (!wallBuildSession) {
    return
  }
  cancelWallDrag()
  clearWallBuildSession()
  restoreOrbitAfterWallBuild()
}

function cancelActiveBuildOperation(): boolean {
  const tool = activeBuildTool.value
  if (!tool) {
    return false
  }
  let handled = false
  switch (tool) {
    case 'ground':
      cancelGroundSelection()
      activeBuildTool.value = null
      handled = true
      break
    case 'wall':
      cancelWallSelection()
      activeBuildTool.value = null
      handled = true
      break
    case 'platform':
      activeBuildTool.value = null
      handled = true
      break
    default:
      return false
  }

  if (handled && props.activeTool !== 'select') {
    emit('changeTool', 'select')
  }

  return handled
}

function handleBuildToolChange(tool: BuildTool | null) {
  activeBuildTool.value = tool
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
    if (sceneStore.draggingAssetId) {
      return { assetId: sceneStore.draggingAssetId }
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
  updateGridHighlight(point, DEFAULT_GRID_HIGHLIGHT_DIMENSIONS)
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
  restoreGridHighlightForSelection()
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
  restoreGridHighlightForSelection()
}

function handleTransformChange() {
  if (!transformControls || !isSceneReady.value) return
  const target = transformControls.object as THREE.Object3D | null
  if (!target || !target.userData?.nodeId) {
    return
  }

  const mode = transformControls.getMode()
  if (mode === 'scale') {
    const node = findSceneNode(props.sceneNodes, target.userData.nodeId)
    if (node?.dynamicMesh?.type === 'wall') {
      if (applyWallScaleTransform(target, node)) {
        return
      }
    }
  }

  if (mode === 'translate') {
    snapVectorToGrid(target.position)
  }

  target.updateMatrixWorld(true)

  const nodeId = target.userData.nodeId as string
  const updates: TransformUpdatePayload[] = []
  const groupState = transformGroupState
  const primaryEntry = groupState?.entries.get(nodeId)

  if (groupState && primaryEntry) {
    switch (mode) {
      case 'translate': {
        target.getWorldPosition(transformCurrentWorldPosition)
        transformDeltaPosition.copy(transformCurrentWorldPosition).sub(primaryEntry.initialWorldPosition)
        groupState.entries.forEach((entry, entryId) => {
          if (entryId === nodeId) {
            return
          }
          transformWorldPositionBuffer.copy(entry.initialWorldPosition).add(transformDeltaPosition)
          transformLocalPositionHelper.copy(transformWorldPositionBuffer)
          if (entry.parent) {
            entry.parent.worldToLocal(transformLocalPositionHelper)
          }
          entry.object.position.copy(transformLocalPositionHelper)
          entry.object.updateMatrixWorld(true)
        })
        break
      }
      case 'rotate': {
        transformQuaternionInverseHelper.copy(primaryEntry.initialQuaternion).invert()
        transformQuaternionDelta.copy(target.quaternion).multiply(transformQuaternionInverseHelper)
        groupState.entries.forEach((entry, entryId) => {
          if (entryId === nodeId) {
            return
          }
          transformQuaternionHelper.copy(entry.initialQuaternion)
          transformQuaternionHelper.premultiply(transformQuaternionDelta)
          entry.object.quaternion.copy(transformQuaternionHelper)
          entry.object.rotation.setFromQuaternion(transformQuaternionHelper)
          entry.object.updateMatrixWorld(true)
        })
        break
      }
      case 'scale': {
        transformScaleFactor.set(1, 1, 1)
        transformScaleFactor.x = primaryEntry.initialScale.x === 0
          ? 1
          : target.scale.x / primaryEntry.initialScale.x
        transformScaleFactor.y = primaryEntry.initialScale.y === 0
          ? 1
          : target.scale.y / primaryEntry.initialScale.y
        transformScaleFactor.z = primaryEntry.initialScale.z === 0
          ? 1
          : target.scale.z / primaryEntry.initialScale.z
        groupState.entries.forEach((entry, entryId) => {
          if (entryId === nodeId) {
            return
          }
          entry.object.scale.set(
            entry.initialScale.x * transformScaleFactor.x,
            entry.initialScale.y * transformScaleFactor.y,
            entry.initialScale.z * transformScaleFactor.z,
          )
          entry.object.updateMatrixWorld(true)
        })
        break
      }
      default:
        break
    }

    groupState.entries.forEach((entry) => {
      updates.push({
        id: entry.nodeId,
        position: toVector3Like(entry.object.position),
        rotation: toEulerLike(entry.object.rotation),
        scale: toVector3Like(entry.object.scale),
      })
    })
  } else {
    updates.push({
      id: nodeId,
      position: toVector3Like(target.position),
      rotation: toEulerLike(target.rotation),
      scale: toVector3Like(target.scale),
    })
  }

  updateSelectionBox(target)
  updateGridHighlightFromObject(target)
  updateSelectionHighlights()

  if (!updates.length) {
    return
  }

  const payload = updates.length === 1 ? updates[0]! : updates
  emit('updateNodeTransform', payload)

  scheduleThumbnailCapture()
}

function handleTransformMouseDown() {
  if (!transformControls) {
    wallTransformState = null
    return
  }
  const mode = transformControls.getMode()
  const object = transformControls.object as THREE.Object3D | null
  if (!object || mode !== 'scale') {
    wallTransformState = null
    return
  }
  const nodeId = object.userData?.nodeId as string | undefined
  if (!nodeId) {
    wallTransformState = null
    return
  }
  const node = findSceneNode(props.sceneNodes, nodeId)
  if (!node || node.dynamicMesh?.type !== 'wall') {
    wallTransformState = null
    return
  }
  wallTransformState = {
    nodeId,
    initialScale: object.scale.clone(),
    initialSegments: expandWallSegmentsToWorld(node),
    dimensions: getWallNodeDimensions(node),
  }
}

function handleTransformMouseUp() {
  wallTransformState = null
}

function applyWallScaleTransform(target: THREE.Object3D, node: SceneNode): boolean {
  const scale = target.scale
  const EPS = 1e-3
  const scaleChanged = Math.abs(scale.x - 1) > EPS || Math.abs(scale.y - 1) > EPS || Math.abs(scale.z - 1) > EPS
  if (!scaleChanged) {
    return false
  }

  const state = wallTransformState && wallTransformState.nodeId === node.id
    ? wallTransformState
    : {
        nodeId: node.id,
        initialScale: new THREE.Vector3(1, 1, 1),
        initialSegments: expandWallSegmentsToWorld(node),
        dimensions: getWallNodeDimensions(node),
      }

  if (!state.initialSegments.length) {
    return false
  }

  const referenceSegment = state.initialSegments[0]
  const directionBasis = referenceSegment
    ? referenceSegment.end.clone().sub(referenceSegment.start)
    : new THREE.Vector3(1, 0, 0)
  directionBasis.y = 0
  if (directionBasis.lengthSq() < 1e-6) {
    directionBasis.set(1, 0, 0)
  }
  directionBasis.normalize()
  const perpendicularBasis = new THREE.Vector3(-directionBasis.z, 0, directionBasis.x)
  if (perpendicularBasis.lengthSq() < 1e-6) {
    perpendicularBasis.set(0, 0, 1)
  } else {
    perpendicularBasis.normalize()
  }
  const scaleMatrix = new THREE.Matrix3().set(
    Math.abs(scale.x), 0, 0,
    0, Math.abs(scale.y), 0,
    0, 0, Math.abs(scale.z),
  )
  const scaledPerpendicular = perpendicularBasis.clone().applyMatrix3(scaleMatrix)
  const heightScaleFactor = Math.max(EPS, Math.abs(scale.y))
  const widthScaleFactor = Math.max(EPS, scaledPerpendicular.length())

  const center = new THREE.Vector3(node.position.x, node.position.y, node.position.z)
  const scaleX = Math.abs(scale.x) <= EPS ? (scale.x >= 0 ? EPS : -EPS) : scale.x
  const scaleZ = Math.abs(scale.z) <= EPS ? (scale.z >= 0 ? EPS : -EPS) : scale.z
  const scaledSegments: WallSessionSegment[] = state.initialSegments.map(({ start, end }) => ({
    start: new THREE.Vector3(
      center.x + (start.x - center.x) * scaleX,
      start.y,
      center.z + (start.z - center.z) * scaleZ,
    ),
    end: new THREE.Vector3(
      center.x + (end.x - center.x) * scaleX,
      end.y,
      center.z + (end.z - center.z) * scaleZ,
    ),
  }))

  const candidateDimensions = normalizeWallDimensionsForViewport({
    height: state.dimensions.height * (heightScaleFactor || 1),
    width: state.dimensions.width * (widthScaleFactor || 1),
    thickness: state.dimensions.thickness,
  })

  const definition = buildWallPreviewDefinition(scaledSegments, candidateDimensions)

  if (!definition) {
    return false
  }

  const segmentPayload = scaledSegments.map((segment) => ({
    start: { x: segment.start.x, y: segment.start.y, z: segment.start.z },
    end: { x: segment.end.x, y: segment.end.y, z: segment.end.z },
  }))

  const updated = sceneStore.updateWallNodeGeometry(node.id, {
    segments: segmentPayload,
    dimensions: candidateDimensions,
  })

  if (!updated) {
    return false
  }

  const containerGroup = target as THREE.Group
  const wallGroup = containerGroup.userData?.wallGroup as THREE.Group | undefined
  if (wallGroup) {
    updateWallGroup(wallGroup, definition.definition)
    wallGroup.position.set(0, 0, 0)
  }

  containerGroup.position.copy(definition.center)
  target.scale.set(1, 1, 1)

  wallTransformState = {
    nodeId: node.id,
    initialScale: new THREE.Vector3(1, 1, 1),
    initialSegments: scaledSegments,
    dimensions: candidateDimensions,
  }

  updateSelectionBox(target)
  updateGridHighlightFromObject(target)
  updateSelectionHighlights()

  emit('updateNodeTransform', {
    id: node.id,
    position: toVector3Like(containerGroup.position),
    rotation: toEulerLike(containerGroup.rotation as THREE.Euler),
    scale: { x: 1, y: 1, z: 1 },
  })

  scheduleThumbnailCapture()
  return true
}

function updateLightObjectProperties(container: THREE.Object3D, node: SceneNode) {
  const config = node.light
  if (!config) {
    container.userData.lightType = null
    return
  }

  const light = container.children.find((child) => (child as THREE.Light).isLight) as THREE.Light | undefined
  if (!light) {
    container.userData.lightType = config.type
    return
  }

  light.color.set(config.color)
  light.intensity = config.intensity
  light.castShadow = config.castShadow ?? light.castShadow

  if (light instanceof THREE.PointLight) {
    light.distance = config.distance ?? light.distance
    light.decay = config.decay ?? light.decay
  } else if (light instanceof THREE.SpotLight) {
    light.distance = config.distance ?? light.distance
    light.angle = config.angle ?? light.angle
    light.penumbra = config.penumbra ?? light.penumbra
    light.decay = config.decay ?? light.decay
    if (config.target) {
      light.target.position.set(
        config.target.x - node.position.x,
        config.target.y - node.position.y,
        config.target.z - node.position.z,
      )
      if (!light.target.parent) {
        container.add(light.target)
      }
    }
  } else if (light instanceof THREE.DirectionalLight) {
    if (config.target) {
      light.target.position.set(
        config.target.x - node.position.x,
        config.target.y - node.position.y,
        config.target.z - node.position.z,
      )
      if (!light.target.parent) {
        container.add(light.target)
      }
    }
    light.castShadow = config.castShadow ?? light.castShadow
  }

  container.userData.lightType = config.type
  light.userData = { ...(light.userData ?? {}), nodeId: node.id }

  const helper = container.children.find((child) => (child as LightHelperObject).update && child.userData?.nodeId === node.id) as LightHelperObject | undefined
  helper?.update?.()
}

function updateNodeObject(object: THREE.Object3D, node: SceneNode) {
  const nodeType = node.nodeType ?? (node.light ? 'light' : 'mesh')
  const userData = object.userData ?? (object.userData = {})

  userData.nodeId = node.id
  userData.nodeType = nodeType
  userData.dynamicMeshType = node.dynamicMesh?.type ?? null
  userData.lightType = node.light?.type ?? null
  userData.sourceAssetId = node.sourceAssetId ?? null
  userData.usesRuntimeObject = nodeType === 'mesh' ? sceneStore.hasRuntimeObject(node.id) : false

  object.name = node.name
  object.position.set(node.position.x, node.position.y, node.position.z)
  object.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z)
  object.scale.set(node.scale.x, node.scale.y, node.scale.z)
  object.visible = node.visible ?? true

  if (node.dynamicMesh?.type === 'ground') {
    const groundMesh = userData.groundMesh as THREE.Mesh | undefined
    if (groundMesh) {
      updateGroundMesh(groundMesh, node.dynamicMesh)
    }
  } else if (node.dynamicMesh?.type === 'wall') {
    const wallGroup = userData.wallGroup as THREE.Group | undefined
    if (wallGroup) {
      updateWallGroup(wallGroup, node.dynamicMesh)
    }
  }

  if (node.material) {
    applyMaterialOverrides(object, node.material)
  } else {
    resetMaterialOverrides(object)
  }

  if (nodeType === 'light') {
    updateLightObjectProperties(object, node)
  }
}

function shouldRecreateNode(object: THREE.Object3D, node: SceneNode): boolean {
  const nodeType = node.nodeType ?? (node.light ? 'light' : 'mesh')
  const userData = object.userData ?? {}
  if (userData.nodeType !== nodeType) {
    return true
  }
  const nextDynamicMeshType = node.dynamicMesh?.type ?? null
  if ((userData.dynamicMeshType ?? null) !== nextDynamicMeshType) {
    return true
  }
  const nextLightType = node.light?.type ?? null
  if ((userData.lightType ?? null) !== nextLightType) {
    return true
  }
  const nextSourceAssetId = node.sourceAssetId ?? null
  if ((userData.sourceAssetId ?? null) !== nextSourceAssetId) {
    return true
  }
  const expectsRuntime = nodeType === 'mesh' ? sceneStore.hasRuntimeObject(node.id) : false
  if (Boolean(userData.usesRuntimeObject) !== expectsRuntime) {
    return true
  }
  return false
}

function disposeNodeObjectRecursive(object: THREE.Object3D) {
  const children = [...object.children]
  for (const child of children) {
    const childNodeId = child.userData?.nodeId as string | undefined
    if (childNodeId) {
      disposeNodeObjectRecursive(child)
    } else {
      child.removeFromParent()
      if (child.userData?.dynamicMeshType === 'ground') {
        continue
      }
      if (object.userData?.usesRuntimeObject) {
        continue
      }
      disposeObjectResources(child)
    }
  }

  const nodeId = object.userData?.nodeId as string | undefined
  if (nodeId) {
    objectMap.delete(nodeId)
    unregisterLightHelpersForNode(nodeId)
  }

  object.removeFromParent()

  const isGroundMesh = object.userData?.dynamicMeshType === 'ground'
  const shouldDispose = !isGroundMesh && (!nodeId || !sceneStore.hasRuntimeObject(nodeId))
  if (shouldDispose) {
    disposeObjectResources(object)
  }
}

function disposeNodeSubtree(nodeId: string) {
  const target = objectMap.get(nodeId)
  if (!target) {
    return
  }
  disposeNodeObjectRecursive(target)
}

function reconcileNodeList(nodes: SceneNode[], parent: THREE.Object3D, encountered: Set<string>) {
  const existingChildren = new Map<string, THREE.Object3D>()
  parent.children.forEach((child) => {
    const childId = child.userData?.nodeId as string | undefined
    if (childId) {
      existingChildren.set(childId, child)
    }
  })

  nodes.forEach((node) => {
    reconcileNode(node, parent, encountered)
    existingChildren.delete(node.id)
  })
}

function reconcileNode(node: SceneNode, parent: THREE.Object3D, encountered: Set<string>): THREE.Object3D {
  encountered.add(node.id)
  let object = objectMap.get(node.id) ?? null

  if (object && shouldRecreateNode(object, node)) {
    disposeNodeSubtree(node.id)
    object = null
  }

  if (!object) {
    object = createObjectFromNode(node)
    if (object.parent !== parent) {
      parent.add(object)
    }
  } else if (object.parent !== parent) {
    parent.add(object)
  }

  updateNodeObject(object, node)
  reconcileNodeList(node.children ?? [], object, encountered)
  return object
}

function syncSceneGraph() {
  if (!scene) return

  const encountered = new Set<string>()
  reconcileNodeList(props.sceneNodes, rootGroup, encountered)

  const removable: string[] = []
  objectMap.forEach((_object, id) => {
    if (!encountered.has(id)) {
      removable.push(id)
    }
  })

  removable.forEach((id) => {
    if (objectMap.has(id)) {
      disposeNodeSubtree(id)
    }
  })

  // 重新附加选择并确保工具模式正确
  attachSelection(props.selectedNodeId, props.activeTool)

  scheduleThumbnailCapture()
  refreshPlaceholderOverlays()
  ensureFallbackLighting()
  updateSelectionHighlights()
}

function disposeSceneNodes() {
  clearSelectionBox()
  clearLightHelpers()
  const nodeIds = Array.from(objectMap.keys())
  nodeIds.forEach((id) => {
    if (objectMap.has(id)) {
      disposeNodeSubtree(id)
    }
  })
}

function registerLightHelper(nodeId: string, helper: LightHelperObject, requiresContinuousUpdate = false) {
  helper.userData.nodeId = nodeId
  helper.frustumCulled = false
  lightHelpers.push(helper)
  if (requiresContinuousUpdate) {
    lightHelpersNeedingUpdate.add(helper)
  }
}

function clearLightHelpers() {
  lightHelpers.forEach((helper) => {
    helper.dispose?.()
    helper.removeFromParent()
  })
  lightHelpers.length = 0
  lightHelpersNeedingUpdate.clear()
}

function unregisterLightHelpersForNode(nodeId: string) {
  for (let index = lightHelpers.length - 1; index >= 0; index -= 1) {
    const helper = lightHelpers[index]
    if (!helper) {
      continue
    }
    if (helper.userData?.nodeId === nodeId) {
      helper.dispose?.()
      helper.removeFromParent()
      lightHelpers.splice(index, 1)
      lightHelpersNeedingUpdate.delete(helper)
    }
  }
}

function createLightObject(node: SceneNode): THREE.Object3D {
  const container = new THREE.Group()
  container.name = `${node.name}-Light`
  container.userData.nodeId = node.id
  container.userData.suppressGridHighlight = true

  const config = node.light
  if (!config) {
    return container
  }

  let light: THREE.Light
  let helper: LightHelperObject | null = null
  let requiresHelperUpdate = false

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
      helper = new THREE.DirectionalLightHelper(directional, DIRECTIONAL_LIGHT_HELPER_SIZE, config.color)
      requiresHelperUpdate = true
      break
    }
    case 'point': {
      const point = new THREE.PointLight(config.color, config.intensity, config.distance ?? 0, config.decay ?? 1)
      point.castShadow = config.castShadow ?? false
      light = point
      helper = new THREE.PointLightHelper(point, POINT_LIGHT_HELPER_SIZE, config.color)
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
      helper = new THREE.SpotLightHelper(spot, config.color)
      requiresHelperUpdate = true
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

  if (helper) {
    helper.name = `${node.name}-LightHelper`
    registerLightHelper(node.id, helper, requiresHelperUpdate)
    container.add(helper)
    helper.update?.()
  }

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
  fallbackDirectionalLight = null

  let hasLight = false
  rootGroup.traverse((child) => {
    const candidate = child as THREE.Light & { isLight?: boolean }
    if (candidate?.isLight) {
      hasLight = true
    }
  })

  if (!hasLight) {
    const ambient = new THREE.AmbientLight(0xffffff, FALLBACK_AMBIENT_INTENSITY)
    const directional = new THREE.DirectionalLight(0xffffff, FALLBACK_DIRECTIONAL_INTENSITY)
    directional.castShadow = true
    directional.shadow.mapSize.set(FALLBACK_DIRECTIONAL_SHADOW_MAP_SIZE, FALLBACK_DIRECTIONAL_SHADOW_MAP_SIZE)
    directional.shadow.normalBias = 0.02
    directional.shadow.bias = -0.0001
    directional.target.position.set(0, 0, 0)
    fallbackLightGroup.add(ambient)
    fallbackLightGroup.add(directional)
    fallbackLightGroup.add(directional.target)
    fallbackDirectionalLight = directional
    applySunDirectionToFallbackLight()
  }
}

const MATERIAL_CLONED_KEY = '__harmonyMaterialCloned'
const MATERIAL_ORIGINAL_KEY = '__harmonyMaterialOriginal'

type HarmonyMaterialState = {
  color?: THREE.Color
  opacity: number
  transparent: boolean
  depthWrite: boolean
  wireframe?: boolean
  metalness?: number
  roughness?: number
  emissive?: THREE.Color
  emissiveIntensity?: number
  side?: THREE.Side
  aoMapIntensity?: number
  envMapIntensity?: number
  map?: THREE.Texture | null
  normalMap?: THREE.Texture | null
  metalnessMap?: THREE.Texture | null
  roughnessMap?: THREE.Texture | null
  aoMap?: THREE.Texture | null
  emissiveMap?: THREE.Texture | null
}

function ensureMeshMaterialsUnique(mesh: THREE.Mesh) {
  const userData = mesh.userData ?? (mesh.userData = {})
  if (userData[MATERIAL_CLONED_KEY]) {
    return
  }

  if (!mesh.material) {
    userData[MATERIAL_CLONED_KEY] = true
    return
  }

  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map((material) => material.clone())
  } else if (mesh.material) {
    mesh.material = mesh.material.clone()
  }

  userData[MATERIAL_CLONED_KEY] = true
}

function getMaterialBaseline(material: THREE.Material): HarmonyMaterialState {
  const userData = material.userData ?? (material.userData = {})
  let state = userData[MATERIAL_ORIGINAL_KEY] as HarmonyMaterialState | undefined
  if (state) {
    return state
  }

  const typed = material as THREE.Material & { color?: THREE.Color; wireframe?: boolean }
  const standard = material as THREE.MeshStandardMaterial & { emissive?: THREE.Color }
  state = {
    color: typed.color ? typed.color.clone() : undefined,
    opacity: material.opacity,
    transparent: material.transparent,
    depthWrite: material.depthWrite,
    wireframe: typeof typed.wireframe === 'boolean' ? typed.wireframe : undefined,
    metalness: 'metalness' in standard ? standard.metalness : undefined,
    roughness: 'roughness' in standard ? standard.roughness : undefined,
    emissive: standard.emissive ? standard.emissive.clone() : undefined,
    emissiveIntensity: 'emissiveIntensity' in standard ? standard.emissiveIntensity : undefined,
    side: material.side,
    aoMapIntensity: 'aoMapIntensity' in standard ? standard.aoMapIntensity : undefined,
    envMapIntensity: 'envMapIntensity' in standard ? standard.envMapIntensity : undefined,
    map: 'map' in standard ? standard.map ?? null : undefined,
    normalMap: 'normalMap' in standard ? standard.normalMap ?? null : undefined,
    metalnessMap: 'metalnessMap' in standard ? standard.metalnessMap ?? null : undefined,
    roughnessMap: 'roughnessMap' in standard ? standard.roughnessMap ?? null : undefined,
    aoMap: 'aoMap' in standard ? standard.aoMap ?? null : undefined,
    emissiveMap: 'emissiveMap' in standard ? standard.emissiveMap ?? null : undefined,
  }
  userData[MATERIAL_ORIGINAL_KEY] = state
  return state
}

function disposeCachedTextures() {
  textureCache.forEach((texture) => texture.dispose())
  textureCache.clear()
  pendingTextureRequests.clear()
}

async function ensureMaterialTexture(ref: SceneMaterialTextureRef): Promise<THREE.Texture | null> {
  const cacheKey = ref.assetId
  if (!cacheKey) {
    return null
  }
  if (textureCache.has(cacheKey)) {
    return textureCache.get(cacheKey) ?? null
  }
  if (pendingTextureRequests.has(cacheKey)) {
    return pendingTextureRequests.get(cacheKey) ?? null
  }

  const loader = async (): Promise<THREE.Texture | null> => {
    let entry = assetCacheStore.getEntry(cacheKey)
    if (entry.status !== 'cached') {
      await assetCacheStore.loadFromIndexedDb(cacheKey)
      entry = assetCacheStore.getEntry(cacheKey)
    }

    if (entry.status !== 'cached') {
      const asset = sceneStore.getAsset(cacheKey)
      const url = entry.downloadUrl ?? asset?.downloadUrl ?? asset?.description ?? null
      if (!url) {
        console.warn('Texture asset missing download URL', cacheKey)
        return null
      }
      try {
        await assetCacheStore.downloadAsset(cacheKey, url, asset?.name ?? cacheKey)
      } catch (error) {
        console.warn('Failed to download texture asset', cacheKey, error)
        return null
      }
      entry = assetCacheStore.getEntry(cacheKey)
      if (entry.status !== 'cached') {
        return null
      }
    }

    const file = assetCacheStore.createFileFromCache(cacheKey)
    if (!file) {
      return null
    }

    const blobUrl = URL.createObjectURL(file)
    try {
      const texture = await textureLoader.loadAsync(blobUrl)
      texture.name = ref.name ?? file.name ?? cacheKey
      texture.needsUpdate = true
      textureCache.set(cacheKey, texture)
      return texture
    } catch (error) {
      console.warn('Failed to load texture data', cacheKey, error)
      return null
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  }

  const pending = loader()
  pendingTextureRequests.set(cacheKey, pending)
  try {
    const texture = await pending
    if (!texture) {
      textureCache.delete(cacheKey)
      return null
    }
    return texture
  } finally {
    pendingTextureRequests.delete(cacheKey)
  }
}

function assignTextureToMaterial(
  material: THREE.Material,
  slot: SceneMaterialTextureSlot,
  ref: SceneMaterialTextureRef | null | undefined,
) {
  const assignment = MATERIAL_TEXTURE_ASSIGNMENTS[slot]
  if (!assignment) {
    return
  }
  const typed = material as THREE.MeshStandardMaterial & Record<MeshStandardTextureKey, THREE.Texture | null>
  const userData = material.userData ?? (material.userData = {})
  const slotState = (userData[TEXTURE_SLOT_STATE_KEY] ??= {} as Record<SceneMaterialTextureSlot, string | null>)

  if (!ref) {
    slotState[slot] = null
    if (assignment.key in typed && typed[assignment.key] !== null) {
      typed[assignment.key] = null
      material.needsUpdate = true
    }
    return
  }

  slotState[slot] = ref.assetId
  void ensureMaterialTexture(ref).then((texture) => {
    if (!texture) {
      return
    }
    if (slotState[slot] !== ref.assetId) {
      return
    }
    if (!(assignment.key in typed)) {
      return
    }
    if (assignment.colorSpace) {
      texture.colorSpace = assignment.colorSpace
      texture.needsUpdate = true
    }
    typed[assignment.key] = texture
    material.needsUpdate = true
  })
}

function applyMaterialOverrides(target: THREE.Object3D, materialConfig?: NonNullable<SceneNode['material']>) {
  if (!materialConfig) {
    return
  }

  const color = materialConfig.color ? new THREE.Color(materialConfig.color) : null
  const opacity = typeof materialConfig.opacity === 'number' ? THREE.MathUtils.clamp(materialConfig.opacity, 0, 1) : undefined
  const wireframe = materialConfig.wireframe
  const transparent = typeof materialConfig.transparent === 'boolean' ? materialConfig.transparent : undefined
  const emissiveColor = materialConfig.emissive ? new THREE.Color(materialConfig.emissive) : null
  const side = materialConfig.side

  target.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }

    ensureMeshMaterialsUnique(mesh)
    const currentMaterial = mesh.material
    if (!currentMaterial) {
      return
    }

    const materials = Array.isArray(currentMaterial) ? currentMaterial : [currentMaterial]

    materials.forEach((material) => {
      const typed = material as THREE.Material & { color?: THREE.Color; wireframe?: boolean }
      const baseline = getMaterialBaseline(material)
      let needsUpdate = false

      if (color && typed.color) {
        typed.color.copy(color)
        needsUpdate = true
      }

      if (typeof wireframe === 'boolean' && typeof typed.wireframe === 'boolean') {
        typed.wireframe = wireframe
        needsUpdate = true
      }

      const standard = material as THREE.MeshStandardMaterial & { [key: string]: unknown }

      let desiredTransparent = baseline.transparent
      let desiredDepthWrite = baseline.depthWrite

      if (transparent !== undefined) {
        desiredTransparent = transparent
        desiredDepthWrite = transparent ? false : baseline.depthWrite
      }

      if (opacity !== undefined) {
        typed.opacity = opacity
        if (opacity < 0.999) {
          desiredTransparent = true
          desiredDepthWrite = false
        }
        needsUpdate = true
      }

      if (typed.transparent !== desiredTransparent) {
        typed.transparent = desiredTransparent
        needsUpdate = true
      }
      if (typed.depthWrite !== desiredDepthWrite) {
        typed.depthWrite = desiredDepthWrite
        needsUpdate = true
      }

      if (typeof side === 'string') {
        let sideValue = baseline.side ?? material.side
        if (side === 'front') {
          sideValue = THREE.FrontSide
        } else if (side === 'back') {
          sideValue = THREE.BackSide
        } else if (side === 'double') {
          sideValue = THREE.DoubleSide
        }
        if (material.side !== sideValue) {
          material.side = sideValue
          needsUpdate = true
        }
      }

      if ('metalness' in standard && typeof materialConfig.metalness === 'number' && standard.metalness !== materialConfig.metalness) {
        standard.metalness = materialConfig.metalness
        needsUpdate = true
      }

      if ('roughness' in standard && typeof materialConfig.roughness === 'number' && standard.roughness !== materialConfig.roughness) {
        standard.roughness = materialConfig.roughness
        needsUpdate = true
      }

      if (standard.emissive && emissiveColor) {
        standard.emissive.copy(emissiveColor)
        needsUpdate = true
      }

      if ('emissiveIntensity' in standard && typeof materialConfig.emissiveIntensity === 'number' && standard.emissiveIntensity !== materialConfig.emissiveIntensity) {
        standard.emissiveIntensity = materialConfig.emissiveIntensity
        needsUpdate = true
      }

      if ('aoMapIntensity' in standard && typeof materialConfig.aoStrength === 'number' && standard.aoMapIntensity !== materialConfig.aoStrength) {
        standard.aoMapIntensity = materialConfig.aoStrength
        needsUpdate = true
      }

      if ('envMapIntensity' in standard && typeof materialConfig.envMapIntensity === 'number' && standard.envMapIntensity !== materialConfig.envMapIntensity) {
        standard.envMapIntensity = materialConfig.envMapIntensity
        needsUpdate = true
      }

      ;(Object.keys(MATERIAL_TEXTURE_ASSIGNMENTS) as SceneMaterialTextureSlot[]).forEach((slot) => {
        const ref = materialConfig.textures?.[slot] ?? null
        assignTextureToMaterial(material, slot, ref)
      })

      if (needsUpdate) {
        typed.needsUpdate = true
      }
    })
  })
}

function resetMaterialOverrides(target: THREE.Object3D) {
  target.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }

    const currentMaterial = mesh.material
    if (!currentMaterial) {
      return
    }

    const materials = Array.isArray(currentMaterial) ? currentMaterial : [currentMaterial]
    materials.forEach((material) => {
      const typed = material as THREE.Material & { color?: THREE.Color; wireframe?: boolean }
      const baseline = (typed.userData?.[MATERIAL_ORIGINAL_KEY] ?? null) as HarmonyMaterialState | null
      if (!baseline) {
        return
      }

      if (baseline.color && typed.color) {
        typed.color.copy(baseline.color)
      }
      typed.opacity = baseline.opacity
      typed.transparent = baseline.transparent
      typed.depthWrite = baseline.depthWrite
      if (typeof baseline.wireframe === 'boolean' && typeof typed.wireframe === 'boolean') {
        typed.wireframe = baseline.wireframe
      }
      material.side = baseline.side ?? material.side

      const standard = material as THREE.MeshStandardMaterial & { [key: string]: unknown }
      if (baseline.metalness !== undefined && 'metalness' in standard) {
        standard.metalness = baseline.metalness
      }
      if (baseline.roughness !== undefined && 'roughness' in standard) {
        standard.roughness = baseline.roughness
      }
      if (baseline.emissive && 'emissive' in standard && standard.emissive) {
        standard.emissive.copy(baseline.emissive)
      }
      if (baseline.emissiveIntensity !== undefined && 'emissiveIntensity' in standard) {
        standard.emissiveIntensity = baseline.emissiveIntensity
      }
      if (baseline.aoMapIntensity !== undefined && 'aoMapIntensity' in standard) {
        standard.aoMapIntensity = baseline.aoMapIntensity
      }
      if (baseline.envMapIntensity !== undefined && 'envMapIntensity' in standard) {
        standard.envMapIntensity = baseline.envMapIntensity
      }
      if (baseline.map !== undefined && 'map' in standard) {
        standard.map = baseline.map ?? null
      }
      if (baseline.normalMap !== undefined && 'normalMap' in standard) {
        standard.normalMap = baseline.normalMap ?? null
      }
      if (baseline.metalnessMap !== undefined && 'metalnessMap' in standard) {
        standard.metalnessMap = baseline.metalnessMap ?? null
      }
      if (baseline.roughnessMap !== undefined && 'roughnessMap' in standard) {
        standard.roughnessMap = baseline.roughnessMap ?? null
      }
      if (baseline.aoMap !== undefined && 'aoMap' in standard) {
        standard.aoMap = baseline.aoMap ?? null
      }
      if (baseline.emissiveMap !== undefined && 'emissiveMap' in standard) {
        standard.emissiveMap = baseline.emissiveMap ?? null
      }

      const slotState = typed.userData?.[TEXTURE_SLOT_STATE_KEY] as Record<SceneMaterialTextureSlot, string | null> | undefined
      if (slotState) {
        (Object.keys(MATERIAL_TEXTURE_ASSIGNMENTS) as SceneMaterialTextureSlot[]).forEach((slot) => {
          slotState[slot] = null
        })
      }
      typed.needsUpdate = true
    })
  })
}

function createObjectFromNode(node: SceneNode): THREE.Object3D {
  let object: THREE.Object3D

  const nodeType = node.nodeType ?? (node.light ? 'light' : 'mesh')

  if (nodeType === 'light') {
    object = createLightObject(node)
    object.name = node.name
  } else if (nodeType === 'mesh') {
    const container = new THREE.Group()
    container.name = node.name
    const containerData = container.userData ?? (container.userData = {})
    containerData.nodeId = node.id

    if (node.dynamicMesh?.type === 'ground') {
      const groundMesh = createGroundMesh(node.dynamicMesh)
      groundMesh.removeFromParent()
      groundMesh.userData.nodeId = node.id
      container.add(groundMesh)
      containerData.groundMesh = groundMesh
      containerData.dynamicMeshType = 'ground'
    } else if (node.dynamicMesh?.type === 'wall') {
      const wallGroup = createWallGroup(node.dynamicMesh as WallDynamicMesh)
      wallGroup.userData.nodeId = node.id
      container.add(wallGroup)
      containerData.wallGroup = wallGroup
      containerData.dynamicMeshType = 'wall'
    } else {
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
        containerData.usesRuntimeObject = true
      } else {
        const fallbackMaterial = node.isPlaceholder
          ? new THREE.MeshBasicMaterial({ color: 0x4dd0e1, wireframe: true, opacity: 0.65, transparent: true })
          : new THREE.MeshBasicMaterial({ color: 0xff5252, wireframe: true })
        const fallback = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), fallbackMaterial)
        fallback.userData.nodeId = node.id
        container.add(fallback)
        containerData.usesRuntimeObject = false
      }
    }

    containerData.sourceAssetId = node.sourceAssetId ?? null
    if (typeof containerData.dynamicMeshType === 'undefined') {
      containerData.dynamicMeshType = node.dynamicMesh?.type ?? null
    }
    object = container
  } else if (nodeType === 'group') {
    object = new THREE.Group()
    object.name = node.name
    object.userData.nodeId = node.id
  } else {
    object = createGeometry(nodeType)
    object.name = node.name
    object.userData.nodeId = node.id
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

  const userData = object.userData ?? (object.userData = {})
  userData.nodeId = node.id
  userData.nodeType = nodeType
  userData.dynamicMeshType = node.dynamicMesh?.type ?? userData.dynamicMeshType ?? null
  userData.lightType = node.light?.type ?? null
  userData.sourceAssetId = node.sourceAssetId ?? null
  if (nodeType !== 'mesh') {
    userData.usesRuntimeObject = false
  } else if (typeof userData.usesRuntimeObject !== 'boolean') {
    userData.usesRuntimeObject = sceneStore.hasRuntimeObject(node.id)
  }

  const isVisible = node.visible ?? true
  object.visible = isVisible

  if (node.material) {
    applyMaterialOverrides(object, node.material)
  }

  return object
}

function attachSelection(nodeId: string | null, tool: EditorTool = props.activeTool) {
  const locked = nodeId ? sceneStore.isNodeSelectionLocked(nodeId) : false
  const target = !locked && nodeId ? objectMap.get(nodeId) ?? null : null
  updateSelectionBox(target)

  if (!nodeId || locked || !target) {
    updateGridHighlight(null)
  } else {
    updateGridHighlightFromObject(target)
  }

  if (!transformControls) return

  if (!nodeId || locked) {
    transformControls.detach()
    return
  }

  if (!target) {
    transformControls.detach()
    return
  }
  if (tool === 'select') {
    transformControls.detach()
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
  } else {
    transformControls.setMode(tool)
  }

  if (props.selectedNodeId) {
    attachSelection(props.selectedNodeId, tool)
  } else {
    updateGridHighlight(null)
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
  if (props.previewActive) return false
  return true
}

function handleViewportShortcut(event: KeyboardEvent) {
  if (!shouldHandleViewportShortcut(event)) return
  let handled = false

  if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    switch (event.code) {
      case 'Escape':
        if (cancelActiveBuildOperation()) {
          handled = true
          break
        }
        if (props.selectedNodeId) {
          emitSelectionChange([])
          handled = true
        }
        break
      default: {
        const tool = transformToolKeyMap.get(event.code)
        if (tool) {
          emit('changeTool', tool)
          handled = true
        }
        break
      }
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
  updateSelectionHighlights()
  window.addEventListener('keyup', handleViewportShortcut, { capture: true })
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', handleViewportOverlayResize, { passive: true })
  }
  scheduleToolbarUpdate()
  if (viewportEl.value && typeof ResizeObserver !== 'undefined') {
    viewportResizeObserver = new ResizeObserver(() => scheduleToolbarUpdate())
    viewportResizeObserver.observe(viewportEl.value)
  }
})

onBeforeUnmount(() => {
  disposeSceneNodes()
  disposeScene()
  disposeCachedTextures()
  window.removeEventListener('keyup', handleViewportShortcut, { capture: true })
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', handleViewportOverlayResize)
  }
  if (hierarchyPanelObserver) {
    hierarchyPanelObserver.disconnect()
    hierarchyPanelObserver = null
    observedHierarchyElement = null
  }
  if (inspectorPanelObserver) {
    inspectorPanelObserver.disconnect()
    inspectorPanelObserver = null
    observedInspectorElement = null
  }
  if (viewportResizeObserver) {
    viewportResizeObserver.disconnect()
    viewportResizeObserver = null
  }
  if (transformToolbarResizeObserver) {
    transformToolbarResizeObserver.disconnect()
    transformToolbarResizeObserver = null
  }
  if (viewportToolbarResizeObserver) {
    viewportToolbarResizeObserver.disconnect()
    viewportToolbarResizeObserver = null
  }
})

watch(cameraControlMode, (mode) => {
  applyCameraControlMode(mode)
})

watch(
  () => props.sceneNodes,
  () => {
    if (shouldDeferSceneGraphSync()) {
      pendingSceneGraphSync = true
      return
    }
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
  () => [panelVisibility.value.hierarchy, panelPlacement.value.hierarchy],
  () => {
    scheduleToolbarUpdate()
  }
)

watch(
  () => [panelVisibility.value.inspector, panelPlacement.value.inspector],
  () => {
    scheduleToolbarUpdate()
  }
)

watch(transformToolbarHostRef, (host) => {
  if (transformToolbarResizeObserver) {
    transformToolbarResizeObserver.disconnect()
    transformToolbarResizeObserver = null
  }
  if (host && typeof ResizeObserver !== 'undefined') {
    transformToolbarResizeObserver = new ResizeObserver(() => scheduleToolbarUpdate())
    transformToolbarResizeObserver.observe(host)
  }
  scheduleToolbarUpdate()
})

watch(viewportToolbarHostRef, (host) => {
  if (viewportToolbarResizeObserver) {
    viewportToolbarResizeObserver.disconnect()
    viewportToolbarResizeObserver = null
  }
  if (host && typeof ResizeObserver !== 'undefined') {
    viewportToolbarResizeObserver = new ResizeObserver(() => scheduleToolbarUpdate())
    viewportToolbarResizeObserver.observe(host)
  }
  scheduleToolbarUpdate()
})

watch(statsHostRef, () => {
  updateStatsVisibility()
})

watch(
  () => props.showStats,
  () => {
    updateStatsVisibility()
  },
)

watch(shadowsEnabled, () => {
  applyRendererShadowSetting()
})

watch(
  () => props.selectedNodeId,
  (id) => {
    attachSelection(id)
    updateSelectionHighlights()
  }
)

watch(
  () => sceneStore.selectedNodeIds.slice(),
  () => {
    updateSelectionHighlights()
  }
)

watch(
  () => props.activeTool,
  (tool) => {
    updateToolMode(tool)
  }
)

watch(activeBuildTool, (tool) => {
  if (tool !== 'ground') {
    groundSelectionDragState = null
    clearGroundSelection()
    restoreOrbitAfterGroundSelection()
  }
  if (tool !== 'wall') {
    cancelWallDrag()
    clearWallBuildSession()
    restoreOrbitAfterWallBuild()
  }
})

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
  generateSceneBlob,
})
</script>

<template>
  <div ref="viewportEl" class="scene-viewport">
    <div ref="transformToolbarHostRef" class="transform-toolbar-host" :style="transformToolbarStyle">
      <TransformToolbar
        :active-tool="props.activeTool"
        @change-tool="emit('changeTool', $event)"
      />
    </div>
    <div ref="viewportToolbarHostRef" class="viewport-toolbar-host" :style="viewportToolbarStyle">
      <ViewportToolbar
        :show-grid="gridVisible"
        :show-axes="axesVisible"
        :camera-mode="cameraProjectionMode"
        :camera-control-mode="cameraControlMode"
        :can-drop-selection="canDropSelection"
        :can-align-selection="canAlignSelection"
        :skybox-settings="skyboxSettings"
        :skybox-presets="skyboxPresetList"
        :active-build-tool="activeBuildTool"
        :shadows-enabled="shadowsEnabled"
        @reset-camera="resetCameraView"
        @drop-to-ground="dropSelectionToGround"
        @select-skybox-preset="handleSkyboxPresetSelect"
        @change-skybox-parameter="handleSkyboxParameterChange"
        @align-selection="handleAlignSelection"
        @capture-screenshot="handleCaptureScreenshot"
        @orbit-left="handleOrbitLeft"
        @orbit-right="handleOrbitRight"
        @toggle-camera-control="handleToggleCameraControlMode"
        @change-build-tool="handleBuildToolChange"
        @change-shadows-enabled="handleShadowsEnabledChange"
      />
    </div>
  <div ref="statsHostRef" class="stats-host" v-show="props.showStats"></div>
    <div
      ref="surfaceRef"
      class="viewport-surface"
      data-scene-viewport="true"
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
      <GroundToolbar
        v-if="groundSelection"
        :visible="isGroundToolbarVisible"
        :left="groundSelectionToolbarStyle.left"
        :top="groundSelectionToolbarStyle.top"
        :opacity="groundSelectionToolbarStyle.opacity"
        @cancel="handleGroundCancel"
        @raise="handleGroundRaise"
        @lower="handleGroundLower"
        @reset="handleGroundReset"
        @texture="handleGroundTextureSelectRequest"
      />
      <canvas ref="canvasRef" class="viewport-canvas" />
    </div>
    <input
      ref="groundTextureInputRef"
      class="ground-texture-input"
      type="file"
      accept="image/*"
      @change="handleGroundTextureFileChange"
    >
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

.transform-toolbar-host,
.viewport-toolbar-host {
  position: absolute;
  z-index: 5;
  pointer-events: none;
}

.stats-host {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 8;
  pointer-events: auto;
}

.stats-host :deep(.stats-panel) {
  pointer-events: auto;
  cursor: pointer;
}

.transform-toolbar-host > :deep(*) {
  pointer-events: auto;
}

.viewport-toolbar-host > :deep(*) {
  pointer-events: auto;
}

.transform-toolbar-host,
.viewport-toolbar-host {
  transition: top 180ms ease, left 180ms ease;
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

.ground-texture-input {
  display: none;
}
</style>
