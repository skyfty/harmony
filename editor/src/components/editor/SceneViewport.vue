<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js'
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

// @ts-ignore - local plugin has no .d.ts declaration file
import { TransformControls } from '@/utils/transformControls.js'
import Stats from 'three/examples/jsm/libs/stats.module.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'

import type {
  SceneNode,
  SceneNodeComponentState,
  SceneMaterialTextureSlot,
  SceneMaterialTextureRef,
  SceneNodeMaterial,
  SceneSkyboxSettings,
  GroundDynamicMesh,
  WallDynamicMesh,
  SurfaceDynamicMesh,
} from '@harmony/schema'
import {
  applyMaterialOverrides,
  disposeMaterialOverrides,
  resetMaterialOverrides,
  type MaterialTextureAssignmentOptions,
} from '@/types/material'
import { useSceneStore, getRuntimeObject,registerRuntimeObject} from '@/stores/sceneStore'
import { useNodePickerStore } from '@/stores/nodePickerStore'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import type { SceneCameraState } from '@/types/scene-camera-state'

import type { EditorTool } from '@/types/editor-tool'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import {
  getCachedModelObject,
  getOrLoadModelObject,
  subscribeInstancedMeshes,
  getModelInstanceBinding,
} from '@schema/modelObjectCache'
import { loadObjectFromFile } from '@schema/assetImport'
import { createPrimitiveMesh } from '@schema/geometry'
import type { CameraControlMode } from '@harmony/schema'

import type { TransformUpdatePayload } from '@/types/transform-update-payload'
import { cloneSkyboxSettings } from '@/stores/skyboxPresets'
import type { PanelPlacementState } from '@/types/panel-placement-state'
import ViewportToolbar from './ViewportToolbar.vue'
import TransformToolbar from './TransformToolbar.vue'
import PlaceholderOverlayList from './PlaceholderOverlayList.vue'
import { createGroundEditor } from './GroundEditor'
import { TRANSFORM_TOOLS } from '@/types/scene-transform-tools'
import { type AlignMode } from '@/types/scene-viewport-align-mode'
import { Sky } from 'three/addons/objects/Sky.js'
import type { NodeHitResult } from '@/types/scene-viewport-node-hit-result'
import type { PointerTrackingState } from '@/types/scene-viewport-pointer-tracking-state'
import type { TransformGroupEntry, TransformGroupState } from '@/types/scene-viewport-transform-group'
import type { BuildTool } from '@/types/build-tool'
import { createGroundMesh, updateGroundMesh, releaseGroundMeshCache } from '@schema/groundMesh'
import { useTerrainStore } from '@/stores/terrainStore'
import { createWallGroup, updateWallGroup } from '@schema/wallMesh'
import { createSurfaceMesh, updateSurfaceMesh } from '@schema/surfaceMesh'
import { hashString, stableSerialize } from '@schema/stableSerialize'
import { ViewportGizmo } from '@/utils/gizmo/ViewportGizmo'
import {
  VIEW_POINT_COMPONENT_TYPE,
  DISPLAY_BOARD_COMPONENT_TYPE,
  WARP_GATE_COMPONENT_TYPE,
  GUIDEBOARD_COMPONENT_TYPE,
  WALL_DEFAULT_HEIGHT,
  WALL_DEFAULT_WIDTH,
  WALL_DEFAULT_THICKNESS,
  WALL_MIN_HEIGHT,
  WALL_MIN_WIDTH,
  WALL_MIN_THICKNESS,
  clampWarpGateComponentProps,
  clampGuideboardComponentProps,
  computeWarpGateEffectActive,
  computeGuideboardEffectActive,
  WARP_GATE_EFFECT_METADATA_KEY,
  GUIDEBOARD_EFFECT_METADATA_KEY,
  WARP_GATE_EFFECT_ACTIVE_FLAG,
  GUIDEBOARD_EFFECT_ACTIVE_FLAG,
  cloneWarpGateComponentProps,
  cloneGuideboardComponentProps,
  createWarpGateEffectInstance,
  createGuideboardEffectInstance,
  PROTAGONIST_COMPONENT_TYPE,
} from '@schema/components'
import type {
  ViewPointComponentProps,
  DisplayBoardComponentProps,
  GuideboardComponentProps,
  WarpGateComponentProps,
  WarpGateEffectInstance,
  GuideboardEffectInstance,
} from '@schema/components'
import type { EnvironmentSettings } from '@/types/environment'
import { createEffectPlaybackManager } from './effectPlaybackManager'
import { usePlaceholderOverlayController } from './placeholderOverlayController'
import { useToolbarPositioning } from './useToolbarPositioning'
import { useScenePicking } from './useScenePicking'
import {
  type VectorCoordinates,
  cloneVectorCoordinates,
  setBoundingBoxFromObject,
  toEulerLike,
  findSceneNode
} from './sceneUtils'
import type { SelectionRotationOptions } from './constants'
import { useSelectionDrag } from './useSelectionDrag'
import { useInstancedMeshes } from './useInstancedMeshes'
import {
  DEFAULT_BACKGROUND_COLOR,
  GROUND_NODE_ID,
  SKY_ENVIRONMENT_INTENSITY,
  FALLBACK_AMBIENT_INTENSITY,
  FALLBACK_DIRECTIONAL_INTENSITY,
  FALLBACK_DIRECTIONAL_SHADOW_MAP_SIZE,
  SKY_SCALE,
  SKY_FALLBACK_LIGHT_DISTANCE,
  SKY_SUN_LIGHT_DISTANCE,
  SKY_SUN_LIGHT_MIN_HEIGHT,
  CLICK_DRAG_THRESHOLD_PX,
  ASSET_DRAG_MIME,
  MIN_CAMERA_HEIGHT,
  MIN_TARGET_HEIGHT,
  GRID_MAJOR_SPACING,
  GRID_MINOR_SPACING,
  GRID_SNAP_SPACING,
  WALL_DIAGONAL_SNAP_THRESHOLD,
  GRID_MINOR_DASH_SIZE,
  GRID_MINOR_GAP_SIZE,
  GRID_BASE_HEIGHT,
  GRID_HIGHLIGHT_HEIGHT,
  GRID_HIGHLIGHT_PADDING,
  GRID_HIGHLIGHT_MIN_SIZE,
  DEFAULT_GRID_HIGHLIGHT_SIZE,
  DEFAULT_GRID_HIGHLIGHT_DIMENSIONS,
  POINT_LIGHT_HELPER_SIZE,
  DIRECTIONAL_LIGHT_HELPER_SIZE,
  DEFAULT_CAMERA_POSITION,
  DEFAULT_CAMERA_TARGET,
  DEFAULT_PERSPECTIVE_FOV,
  RIGHT_CLICK_ROTATION_STEP,
} from './constants'
import { createFaceSnapManager } from './useFaceSnapping'
import { SceneCloudRenderer } from '@schema/cloudRenderer'

type SceneViewportProps = {
  sceneNodes: SceneNode[]
  selectedNodeId: string | null
  activeTool: EditorTool
  cameraState: SceneCameraState | null
  focusNodeId?: string | null
  focusRequestId?: number | null
  highlightNodeId?: string | null
  highlightRequestId?: number | null
  showStats?: boolean
  previewActive?: boolean
}

const props = withDefaults(defineProps<SceneViewportProps>(), {
  sceneNodes: () => [],
  selectedNodeId: null,
  activeTool: 'select',
  cameraState: null,
  focusNodeId: null,
  focusRequestId: null,
  highlightNodeId: null,
  highlightRequestId: null,
  showStats: false,
  previewActive: false,
})

const emit = defineEmits<{
  (e: 'changeTool', tool: EditorTool): void
  (e: 'selectNode', payload: { primaryId: string | null; selectedIds: string[] }): void
  (e: 'updateNodeTransform', payload: TransformUpdatePayload | TransformUpdatePayload[]): void
}>()

const sceneStore = useSceneStore()
const protagonistPreviewNodeId = computed(() => {
  const selectedId = sceneStore.selectedNodeId
  if (!selectedId) {
    return null
  }
  const node = findSceneNode(sceneStore.nodes, selectedId)
  if (!node) {
    return null
  }
  if (!node.components?.[PROTAGONIST_COMPONENT_TYPE]) {
    return null
  }
  return selectedId
})
const showProtagonistPreview = computed(() => Boolean(protagonistPreviewNodeId.value))
const nodePickerStore = useNodePickerStore()
const assetCacheStore = useAssetCacheStore()
const terrainStore = useTerrainStore()

const { panelVisibility, isSceneReady } = storeToRefs(sceneStore)
const { brushRadius, brushStrength, brushShape, brushOperation, groundPanelTab, scatterCategory, scatterSelectedAsset } =
  storeToRefs(terrainStore)

const viewportEl = ref<HTMLDivElement | null>(null)
const surfaceRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const gizmoContainerRef = ref<HTMLDivElement | null>(null)
const statsHostRef = ref<HTMLDivElement | null>(null)

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const objectMap = new Map<string, THREE.Object3D>()
const instancedMeshes: THREE.InstancedMesh[] = []
const rootGroup = new THREE.Group()
rootGroup.name = 'SceneRoot'
const instancedMeshGroup = new THREE.Group()
instancedMeshGroup.name = 'InstancedMeshGroup'
const instancedOutlineGroup = new THREE.Group()
instancedOutlineGroup.name = 'InstancedOutlineGroup'

type InstancedOutlineEntry = {
  group: THREE.Group
  proxies: Map<string, THREE.Mesh>
}

const instancedOutlineEntries = new Map<string, InstancedOutlineEntry>()
const instancedOutlineMatrixHelper = new THREE.Matrix4()
const instancedOutlineWorldMatrixHelper = new THREE.Matrix4()
const instancedOutlineBaseMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0,
  depthWrite: false,
  depthTest: false,
})
instancedOutlineBaseMaterial.toneMapped = false

const instancedPickProxyGeometry = new THREE.BoxGeometry(1, 1, 1)
const instancedPickProxyMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0,
  depthWrite: false,
  depthTest: false,
})
instancedPickProxyMaterial.colorWrite = false
instancedPickProxyMaterial.toneMapped = false
const instancedPickBoundsMinHelper = new THREE.Vector3()
const instancedPickBoundsMaxHelper = new THREE.Vector3()
const instancedPickBoundsSizeHelper = new THREE.Vector3()
const instancedPickBoundsCenterHelper = new THREE.Vector3()

let scene: THREE.Scene | null = null
let renderer: THREE.WebGLRenderer | null = null
let camera: THREE.PerspectiveCamera | null = null
let perspectiveCamera: THREE.PerspectiveCamera | null = null
let orbitControls: OrbitControls | MapControls | null = null
let transformControls: TransformControls | null = null
let transformControlsDirty = false
let gizmoControls: ViewportGizmo | null = null
let pmremGenerator: THREE.PMREMGenerator | null = null
let skyEnvironmentTarget: THREE.WebGLRenderTarget | null = null
let environmentAmbientLight: THREE.AmbientLight | null = null
let sunDirectionalLight: THREE.DirectionalLight | null = null
let fallbackDirectionalLight: THREE.DirectionalLight | null = null
let stats: Stats | null = null
let statsPointerHandler: (() => void) | null = null
let statsPanelIndex = 0
let stopInstancedMeshSubscription: (() => void) | null = null
let gridHighlight: THREE.Group | null = null
let isSunLightSuppressed = false
let pendingEnvironmentSettings: EnvironmentSettings | null = null
let shouldRenderSkyBackground = true
let sky: Sky | null = null
let resizeObserver: ResizeObserver | null = null
let composer: EffectComposer | null = null
let renderPass: RenderPass | null = null
let outlinePass: OutlinePass | null = null
let fxaaPass: ShaderPass | null = null
let outputPass: OutputPass | null = null
const skySunPosition = new THREE.Vector3()
const DEFAULT_SUN_DIRECTION = new THREE.Vector3(0.35, 1, -0.25).normalize()
const tempSunDirection = new THREE.Vector3()
let backgroundTexture: THREE.Texture | null = null
let backgroundAssetId: string | null = null
let customEnvironmentTarget: THREE.WebGLRenderTarget | null = null
let environmentMapAssetId: string | null = null
let backgroundLoadToken = 0
let environmentMapLoadToken = 0
let cloudRenderer: SceneCloudRenderer | null = null

const PROTAGONIST_PREVIEW_WIDTH = 240
const PROTAGONIST_PREVIEW_HEIGHT = 140
const PROTAGONIST_PREVIEW_MARGIN = 16

const faceSnapManager = createFaceSnapManager({
  getScene: () => scene,
  objectMap,
  getActiveTool: () => props.activeTool,
  isEditableKeyboardTarget,
})
const protagonistPreviewCameraOffset = new THREE.Vector3(0, 0.35, 0)
const protagonistPreviewDirection = new THREE.Vector3(0, 0, -1)
const protagonistPreviewWorldPosition = new THREE.Vector3()
const protagonistPreviewTarget = new THREE.Vector3()
const protagonistPreviewOffsetTarget = new THREE.Vector3()
const previewViewportState = new THREE.Vector4()
const previewScissorState = new THREE.Vector4()
const previewRenderSize = new THREE.Vector2()
let protagonistPreviewCamera: THREE.PerspectiveCamera | null = null

const textureLoader = new THREE.TextureLoader()
const cubeTextureLoader = new THREE.CubeTextureLoader()
const rgbeLoader = new RGBELoader().setDataType(THREE.FloatType)
const exrLoader = new EXRLoader().setDataType(THREE.FloatType)
const textureCache = new Map<string, THREE.Texture>()
const pendingTextureRequests = new Map<string, Promise<THREE.Texture | null>>()

const usesRuntimeObjectTypes = new Set<string>(['Mesh', WARP_GATE_COMPONENT_TYPE, GUIDEBOARD_COMPONENT_TYPE, 'Group'])

function disposeCachedTextures() {
  textureCache.forEach((texture) => texture.dispose())
  textureCache.clear()
  pendingTextureRequests.clear()
}

async function resolveMaterialTexture(ref: SceneMaterialTextureRef): Promise<THREE.Texture | null> {
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
    const asset = sceneStore.getAsset(cacheKey)
    let entry = assetCacheStore.getEntry(cacheKey)
    if (entry.status !== 'cached') {
      await assetCacheStore.loadFromIndexedDb(cacheKey)
      entry = assetCacheStore.getEntry(cacheKey)
    }

    if (entry.status !== 'cached') {
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
      const extension = resolveAssetExtension(asset ?? null, file.name ?? null)
      let texture: THREE.Texture
      if (extension === 'hdr' || extension === 'hdri' || extension === 'rgbe') {
        texture = await rgbeLoader.loadAsync(blobUrl)
      } else {
        texture = await textureLoader.loadAsync(blobUrl)
      }
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

const materialOverrideOptions: MaterialTextureAssignmentOptions = {
  resolveTexture: resolveMaterialTexture,
  warn: (message) => {
    if (message) {
      console.warn(message)
    }
  },
}

function applyRendererShadowSetting() {
  if (!renderer) {
    return
  }
  const castShadows = Boolean(shadowsEnabled.value)
  renderer.shadowMap.enabled = castShadows
  if (sunDirectionalLight) {
    sunDirectionalLight.castShadow = castShadows
  }
}

function resetEffectRuntimeTickers(): void {
  effectPlaybackManager.reset(objectMap)
  effectRuntimeTickers = effectPlaybackManager.getTickers()
}

function refreshEffectRuntimeTickers(): void {
  const selectedIds = Array.isArray(sceneStore.selectedNodeIds) ? sceneStore.selectedNodeIds : []
  effectPlaybackManager.refresh(selectedIds, objectMap)
  effectRuntimeTickers = effectPlaybackManager.getTickers()
}

const DYNAMIC_MESH_SIGNATURE_KEY = '__harmonyDynamicMeshSignature'

function computeGroundDynamicMeshSignature(definition: GroundDynamicMesh): string {
  const serialized = stableSerialize({
    heightMap: definition.heightMap ?? {}
  })
  return hashString(serialized)
}

function computeWallDynamicMeshSignature(definition: WallDynamicMesh): string {
  const serialized = stableSerialize(definition.segments ?? [])
  return hashString(serialized)
}

function computeSurfaceDynamicMeshSignature(definition: SurfaceDynamicMesh): string {
  const serialized = stableSerialize({
    points: definition.points ?? [],
    normal: definition.normal ?? null,
  })
  return hashString(serialized)
}

const {
  resolveNodeIdFromIntersection,
  collectSceneIntersections,
  projectPointerToPlane,
  pickNodeAtPointer,
  isObjectWorldVisible
} = useScenePicking(
  canvasRef,
  { get value() { return camera } } as Ref<THREE.Camera | null>,
  raycaster,
  pointer,
  rootGroup,
  instancedMeshGroup,
  instancedMeshes,
  objectMap
)
const renderClock = new THREE.Clock()
let effectRuntimeTickers: Array<(delta: number) => void> = []
const WARP_GATE_PLACEHOLDER_KEY = '__harmonyWarpGatePlaceholder'
type WarpGatePlaceholderHandle = {
  controller: WarpGateEffectInstance | null
}

const GUIDEBOARD_PLACEHOLDER_KEY = '__harmonyGuideboardPlaceholder'
type GuideboardPlaceholderHandle = {
  controller: GuideboardEffectInstance | null
}

const effectPlaybackManager = createEffectPlaybackManager()
type LightHelperObject = THREE.Object3D & { dispose?: () => void; update?: () => void }
const lightHelpers: LightHelperObject[] = []
const lightHelpersNeedingUpdate = new Set<LightHelperObject>()
let isApplyingCameraState = false
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

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
const shadowsEnabled = computed(() => sceneStore.shadowsEnabled)
const skyboxSettings = computed(() => sceneStore.skybox)
const environmentSettings = computed(() => sceneStore.environmentSettings)
const cloudPreviewEnabled = computed(() => sceneStore.cloudPreviewEnabled)
const canAlignSelection = computed(() => {
  const primaryId = sceneStore.selectedNodeId
  if (!primaryId) {
    return false
  }
  return sceneStore.selectedNodeIds.some((id) => id !== primaryId && !sceneStore.isNodeSelectionLocked(id))
})
const canRotateSelection = computed(() =>
  sceneStore.selectedNodeIds.some((id) => id !== GROUND_NODE_ID && !sceneStore.isNodeSelectionLocked(id))
)
const canDropSelection = computed(() =>
  sceneStore.selectedNodeIds.some((id) => !!id && !sceneStore.isNodeSelectionLocked(id))
)
const transformToolKeyMap = new Map<string, EditorTool>(TRANSFORM_TOOLS.map((tool) => [tool.key, tool.value]))

const activeBuildTool = ref<BuildTool | null>(null)
const scatterEraseModeActive = ref(false)
const selectedNodeIsGround = computed(() => sceneStore.selectedNode?.dynamicMesh?.type === 'Ground')

const groundEditor = createGroundEditor({
  sceneStore,
  getSceneNodes: () => props.sceneNodes,
  canvasRef,
  surfaceRef,
  raycaster,
  pointer,
  groundPlane,
  objectMap,
  getCamera: () => camera,
  getScene: () => scene,
  brushRadius,
  brushStrength,
  brushShape,
  brushOperation,
  groundPanelTab,
  scatterCategory,
  scatterAsset: scatterSelectedAsset,
  activeBuildTool,
  scatterEraseModeActive,
  disableOrbitForGroundSelection,
  restoreOrbitAfterGroundSelection,
  isAltOverrideActive: () => isAltOverrideActive,
})

const {
  brushMesh,
  groundSelectionGroup,
  groundSelection,
  groundTextureInputRef,
  restoreGroupdScatter,
  updateGroundSelectionToolbarPosition,
  cancelGroundSelection,
  handlePointerDown: handleGroundEditorPointerDown,
  handlePointerMove: handleGroundEditorPointerMove,
  handlePointerUp: handleGroundEditorPointerUp,
  handlePointerCancel: handleGroundEditorPointerCancel,
  handleGroundTextureFileChange,
  hasActiveSelection: groundEditorHasActiveSelection,
  handleActiveBuildToolChange: handleGroundEditorBuildToolChange,
  cancelScatterErase: cancelGroundEditorScatterErase,
  cancelScatterPlacement: cancelGroundEditorScatterPlacement,
  dispose: disposeGroundEditor,
} = groundEditor

function exitScatterEraseMode() {
  if (!scatterEraseModeActive.value) {
    return
  }
  scatterEraseModeActive.value = false
  cancelGroundEditorScatterErase()
  cancelGroundEditorScatterPlacement()
}

function toggleScatterEraseMode() {
  if (!selectedNodeIsGround.value) {
    exitScatterEraseMode()
    return
  }
  if (scatterEraseModeActive.value) {
    exitScatterEraseMode()
    return
  }
  handleBuildToolChange(null)
  cancelGroundEditorScatterPlacement()
  scatterEraseModeActive.value = true
}
const {
  overlayContainerRef,
  placeholderOverlayList,
  refreshPlaceholderOverlays,
  clearPlaceholderOverlays,
  updatePlaceholderOverlayPositions,
} = usePlaceholderOverlayController({
  getSceneNodes: () => props.sceneNodes,
  getCamera: () => camera,
  objectMap,
})

type PanelPlacementHolder = { panelPlacement?: PanelPlacementState | null }

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

const {
  transformToolbarStyle,
  viewportToolbarStyle,
  transformToolbarHostRef,
  viewportToolbarHostRef,
  scheduleToolbarUpdate
} = useToolbarPositioning(
  viewportEl,
  panelVisibility,
  panelPlacement,
  () => {
    updateGroundSelectionToolbarPosition()
    gizmoControls?.update()
  }
)

let viewportResizeObserver: ResizeObserver | null = null
let transformToolbarResizeObserver: ResizeObserver | null = null
let viewportToolbarResizeObserver: ResizeObserver | null = null

let pointerTrackingState: PointerTrackingState | null = null

type WallSessionSegment = {
  start: THREE.Vector3
  end: THREE.Vector3
}

type WallBuildSession = {
  dragStart: THREE.Vector3 | null
  dragEnd: THREE.Vector3 | null
  segments: WallSessionSegment[]
  previewGroup: THREE.Group | null
  nodeId: string | null
  dimensions: { height: number; width: number; thickness: number }
}

type SurfaceBuildSession = {
  points: THREE.Vector3[]
  previewGroup: THREE.Group | null
}

let wallBuildSession: WallBuildSession | null = null
let wallPreviewNeedsSync = false
let wallPreviewSignature: string | null = null
let wallPlacementSuppressedPointerId: number | null = null

const surfacePreviewLineMaterial = new THREE.LineBasicMaterial({
  color: 0x45aaf2,
  transparent: true,
  opacity: 0.9,
  depthTest: false,
  depthWrite: false,
})

const surfacePreviewFillMaterial = new THREE.MeshBasicMaterial({
  color: 0x45aaf2,
  transparent: true,
  opacity: 0.2,
  depthTest: false,
  depthWrite: false,
  side: THREE.DoubleSide,
})

let surfaceBuildSession: SurfaceBuildSession | null = null

function pointerHitsSelectableObject(event: PointerEvent): boolean {
  const nodeHit = pickNodeAtPointer(event)
  if (nodeHit) {
    return true
  }
  const selectionHit = pickActiveSelectionBoundingBoxHit(event)
  return !!selectionHit
}


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


function handleViewportOverlayResize() {
  scheduleToolbarUpdate()
  updateGroundSelectionToolbarPosition()
  gizmoControls?.update()
}



const {
  syncInstancedTransform,
  attachInstancedMesh,
  clearInstancedMeshes
} = useInstancedMeshes(
  instancedMeshGroup,
  instancedMeshes,
  {
    syncInstancedOutlineEntryTransform
  }
)


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
  if (!sceneStore.isNodeVisible(primaryId)) {
    return null
  }
  if (!isObjectWorldVisible(targetObject)) {
    return null
  }

  targetObject.updateMatrixWorld(true)
  setBoundingBoxFromObject(targetObject, selectionDragBoundingBox)
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

const {
  createSelectionDragState,
  updateSelectDragPosition,
  commitSelectionDragTransforms,
  dropSelectionToGround,
  alignSelection,
  rotateSelection
} = useSelectionDrag(
  props.sceneNodes,
  objectMap,
  projectPointerToPlane,
  emit,
  {
    syncInstancedTransform,
    updateGridHighlightFromObject,
    updateSelectionHighlights,
    updatePlaceholderOverlayPositions,
    gizmoControlsUpdate: () => gizmoControls?.update()
  }
)



function emitTransformUpdates(updates: TransformUpdatePayload[]) {
  if (!updates.length) {
    return
  }

  const normalized = updates.map((update) => {
    const entry: TransformUpdatePayload = { id: update.id }
    if (update.position) {
      entry.position = cloneVectorCoordinates(update.position as VectorCoordinates)
    }
    if (update.rotation) {
      entry.rotation = cloneVectorCoordinates(update.rotation as VectorCoordinates)
    }
    if (update.scale) {
      entry.scale = cloneVectorCoordinates(update.scale as VectorCoordinates)
    }
    return entry
  })

  emit('updateNodeTransform', normalized.length === 1 ? normalized[0]! : normalized)
}


function buildTransformControlUpdates(): TransformUpdatePayload[] {
  const updates: TransformUpdatePayload[] = []
  const target = transformControls?.object as THREE.Object3D | null
  const nodeId = target?.userData?.nodeId as string | undefined
  if (!target) {
    return updates
  }
  if (!nodeId) {
    return updates
  }

  const groupStateSnapshot = transformGroupState
  if (groupStateSnapshot && groupStateSnapshot.entries.size > 0) {
    groupStateSnapshot.entries.forEach((entry) => {
      updates.push({
        id: entry.nodeId,
        position: entry.object.position.clone(),
        rotation: toEulerLike(entry.object.rotation),
        scale: entry.object.scale.clone(),
      })
    })
    return updates
  }

  updates.push({
    id: nodeId,
    position: target.position.clone(),
    rotation: toEulerLike(target.rotation),
    scale: target.scale.clone(),
  })

  return updates
}

function commitTransformControlUpdates() {
  const updates = buildTransformControlUpdates()
  transformControlsDirty = false
  if (!updates.length) {
    return
  }
  emitTransformUpdates(updates)
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
      position: object.position,
      rotation: toEulerLike(object.rotation),
      scale: object.scale,
    })
  })

  if (!updates.length) {
    return
  }

  updateGridHighlightFromObject(primaryObject)
  updatePlaceholderOverlayPositions()
  updateSelectionHighlights()

  const transformPayload = updates.length === 1 ? updates[0]! : updates
  emit('updateNodeTransform', transformPayload)
}

function updateOrbitControlsEnabled() {
  if (!orbitControls) {
    return
  }
  const shouldEnable = orbitDisableCount === 0 || isOrbitControlOverrideActive
  orbitControls.enabled = shouldEnable
}

function requestOrbitControlDisable() {
  orbitDisableCount += 1
  updateOrbitControlsEnabled()
}

function releaseOrbitControlDisable() {
  if (orbitDisableCount === 0) {
    return
  }
  orbitDisableCount = Math.max(0, orbitDisableCount - 1)
  updateOrbitControlsEnabled()
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

function setOrbitControlOverride(active: boolean) {
  if (isOrbitControlOverrideActive === active) {
    return
  }
  isOrbitControlOverrideActive = active
  updateOrbitControlsEnabled()
}

function activateAltOverride() {
  if (isAltOverrideActive) {
    return
  }
  isAltOverrideActive = true
  toolOverrideSnapshot = {
    transformTool: props.activeTool ?? null,
    wallBuildActive: Boolean(wallBuildSession),
    groundSelectionActive: groundEditorHasActiveSelection(),
  }
  if (props.activeTool !== 'select') {
    emit('changeTool', 'select')
  }
  setOrbitControlOverride(true)
}

function deactivateAltOverride() {
  if (!isAltOverrideActive) {
    return
  }
  isAltOverrideActive = false
  const snapshot = toolOverrideSnapshot
  toolOverrideSnapshot = null
  setOrbitControlOverride(false)
  if (snapshot?.transformTool && props.activeTool !== snapshot.transformTool) {
    emit('changeTool', snapshot.transformTool)
  }
  if (snapshot?.wallBuildActive && wallBuildSession) {
    updateWallPreview({ immediate: true })
  }
  if (snapshot?.groundSelectionActive && groundSelection.value) {
    updateGroundSelectionToolbarPosition()
  }
}

function handleAltOverrideKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented) {
    return
  }
  if (event.repeat) {
    return
  }
  if (event.key !== 'Alt') {
    return
  }
  if (isEditableKeyboardTarget(event.target)) {
    return
  }
  activateAltOverride()
}

function handleAltOverrideKeyUp(event: KeyboardEvent) {
  if (event.key !== 'Alt') {
    return
  }
  deactivateAltOverride()
}

function handleAltOverrideBlur() {
  deactivateAltOverride()
}

function handleViewportContextMenu(event: MouseEvent) {
  event.preventDefault()
}

function easeInOutCubic(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

const transformDeltaPosition = new THREE.Vector3()
const transformMovementDelta = new THREE.Vector3()
const transformWorldPositionBuffer = new THREE.Vector3()
const transformLocalPositionHelper = new THREE.Vector3()
const transformScaleFactor = new THREE.Vector3(1, 1, 1)
const transformQuaternionDelta = new THREE.Quaternion()
const transformQuaternionHelper = new THREE.Quaternion()
const transformQuaternionInverseHelper = new THREE.Quaternion()
const groundPointerHelper = new THREE.Vector3()
const transformCurrentWorldPosition = new THREE.Vector3()
const transformLastWorldPosition = new THREE.Vector3()
let hasTransformLastWorldPosition = false
const gridHighlightPositionHelper = new THREE.Vector3()
const gridHighlightBoundingBox = new THREE.Box3()
const gridHighlightSizeHelper = new THREE.Vector3()
const selectionHighlightPositionHelper = new THREE.Vector3()
const selectionHighlightBoundingBox = new THREE.Box3()
const selectionHighlightSizeHelper = new THREE.Vector3()
const selectionHighlights = new Map<string, THREE.Group>()
const outlineSelectionTargets: THREE.Object3D[] = []
let nodePickerHighlight: THREE.Group | null = null
let nodeFlashHighlight: THREE.Group | null = null
let nodeFlashIntervalHandle: number | null = null
let nodeFlashTimeoutHandle: number | null = null
let nodeFlashActiveToken: number | null = null
const selectionDragBoundingBox = new THREE.Box3()
const selectionDragIntersectionHelper = new THREE.Vector3()
const viewPointScaleHelper = new THREE.Vector3()
const viewPointParentScaleHelper = new THREE.Vector3()
const viewPointNodeScaleHelper = new THREE.Vector3()
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
    // Dragging ends
    faceSnapManager.hideEffect()
    hasTransformLastWorldPosition = false
    if (transformControlsDirty) {
      commitTransformControlUpdates()
    }
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
    // Dragging begins
    faceSnapManager.hideEffect()
    hasTransformLastWorldPosition = false
    transformControlsDirty = false
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
let isOrbitControlOverrideActive = false
let isAltOverrideActive = false
type AltOverrideSnapshot = {
  transformTool: EditorTool | null
  wallBuildActive: boolean
  groundSelectionActive: boolean
}
let toolOverrideSnapshot: AltOverrideSnapshot | null = null

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
  const placeholderHandle = object.userData?.[WARP_GATE_PLACEHOLDER_KEY] as WarpGatePlaceholderHandle | undefined
  if (placeholderHandle?.controller) {
    placeholderHandle.controller.group.removeFromParent()
    placeholderHandle.controller.dispose()
    placeholderHandle.controller = null
    if (object.userData) {
      delete object.userData[WARP_GATE_PLACEHOLDER_KEY]
    }
  }

  object.traverse((child) => {
    const meshChild = child as THREE.Mesh
    if (meshChild?.isMesh) {
      if (meshChild.userData?.dynamicMeshType === 'Ground') {
        return
      }
      if (meshChild.geometry) {
        meshChild.geometry.dispose()
      }
      const materials = Array.isArray(meshChild.material) ? meshChild.material : [meshChild.material]
      for (const material of materials) {
        if (!material) {
          continue
        }
        disposeMaterialOverrides(material)
        material.dispose()
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
  try {
    let baseGroup = getCachedModelObject(asset.id)

    if (!baseGroup) {
      let file = assetCacheStore.createFileFromCache(asset.id)
      if (!file) {
        await assetCacheStore.loadFromIndexedDb(asset.id)
        file = assetCacheStore.createFileFromCache(asset.id)
      }
      if (!file) {
        pendingPreviewAssetId = null
        return false
      }
      baseGroup = await getOrLoadModelObject(asset.id, () => loadObjectFromFile(file))
      assetCacheStore.releaseInMemoryBlob(asset.id)
    }

    if (token !== dragPreviewLoadToken) {
      disposeObjectResources(baseGroup.object)
      return false
    }
    applyPreviewVisualTweaks(baseGroup.object)
    dragPreviewObject = baseGroup.object
    dragPreviewAssetId = asset.id
    dragPreviewGroup.add(baseGroup.object)
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


function bindControlsToCamera(newCamera: THREE.PerspectiveCamera) {
  if (orbitControls) {
    orbitControls.object = newCamera
    orbitControls.update()
  }
  if (transformControls) {
    transformControls.camera = newCamera
  }
}

function configureOutlinePassAppearance(pass: OutlinePass) {
  pass.edgeStrength = 5.5
  pass.edgeGlow = 0.8
  pass.edgeThickness = 2.75
  pass.pulsePeriod = 0
  pass.visibleEdgeColor.setHex(0xffffff)
  pass.hiddenEdgeColor.setHex(0x66d9ff)
  pass.usePatternTexture = false
}

function updateFxaaResolution(width: number, height: number) {
  if (!fxaaPass) {
    return
  }

  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const pixelRatio = renderer?.getPixelRatio?.() ?? 1
  const uniform = fxaaPass.uniforms?.['resolution']
  if (!uniform?.value) {
    return
  }
  const inverseWidth = 1 / (safeWidth * pixelRatio)
  const inverseHeight = 1 / (safeHeight * pixelRatio)

  const value = uniform.value as THREE.Vector2 & { x: number; y: number }
  if (typeof value.set === 'function') {
    value.set(inverseWidth, inverseHeight)
  } else {
    value.x = inverseWidth
    value.y = inverseHeight
  }
}

function createPostProcessingPipeline(width: number, height: number) {
  if (!renderer || !scene || !camera) {
    return
  }

  disposePostProcessing()

  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)

  composer = new EffectComposer(renderer)
  composer.setPixelRatio(renderer.getPixelRatio())
  composer.setSize(safeWidth, safeHeight)

  renderPass = new RenderPass(scene, camera)
  composer.addPass(renderPass)

  outlinePass = new OutlinePass(new THREE.Vector2(safeWidth, safeHeight), scene, camera)
  configureOutlinePassAppearance(outlinePass)
  composer.addPass(outlinePass)

  fxaaPass = new ShaderPass(FXAAShader)
  if (fxaaPass.material) {
    fxaaPass.material.toneMapped = true
  }
  composer.addPass(fxaaPass)

  outputPass = new OutputPass()
  composer.addPass(outputPass)

  updateFxaaResolution(safeWidth, safeHeight)

  updateOutlineSelectionTargets()
}

function disposePostProcessing() {
  if (composer) {
    composer.renderTarget1.dispose()
    composer.renderTarget2.dispose()
    composer = null
  }
  outlinePass?.dispose?.()
  outlinePass = null
  renderPass = null
  fxaaPass = null
  outputPass = null
}

function renderViewportFrame() {
  if (!renderer || !scene || !camera) {
    return
  }
  if (composer) {
    composer.render()
  } else {
    renderer.render(scene, camera)
  }
  renderProtagonistPreview()
}

function ensureProtagonistPreviewCamera() {
  if (protagonistPreviewCamera) {
    return
  }
  protagonistPreviewCamera = new THREE.PerspectiveCamera(
    55,
    PROTAGONIST_PREVIEW_WIDTH / PROTAGONIST_PREVIEW_HEIGHT,
    0.1,
    2000,
  )
  protagonistPreviewCamera.name = 'ProtagonistPreviewCamera'
}

function syncProtagonistPreviewCamera(): boolean {
  if (!scene || !renderer) {
    return false
  }
  const nodeId = protagonistPreviewNodeId.value
  if (!nodeId) {
    return false
  }
  const nodeObject = objectMap.get(nodeId)
  if (!nodeObject) {
    return false
  }
  ensureProtagonistPreviewCamera()
  if (!protagonistPreviewCamera) {
    return false
  }
  nodeObject.updateWorldMatrix(true, false)
  nodeObject.getWorldPosition(protagonistPreviewWorldPosition)
  const cameraQuaternion = protagonistPreviewCamera.quaternion
  nodeObject.getWorldQuaternion(cameraQuaternion)
  protagonistPreviewOffsetTarget.copy(protagonistPreviewCameraOffset).applyQuaternion(cameraQuaternion)
  protagonistPreviewCamera.position.copy(protagonistPreviewWorldPosition).add(protagonistPreviewOffsetTarget)
  protagonistPreviewTarget.copy(protagonistPreviewWorldPosition)
  protagonistPreviewDirection.set(1, 0, 0).applyQuaternion(cameraQuaternion)
  protagonistPreviewTarget.add(protagonistPreviewDirection)
  protagonistPreviewCamera.lookAt(protagonistPreviewTarget)
  protagonistPreviewCamera.near = 0.1
  protagonistPreviewCamera.far = 2000
  protagonistPreviewCamera.updateMatrixWorld()
  return true
}

function renderProtagonistPreview() {
  if (!scene || !renderer || !showProtagonistPreview.value || !syncProtagonistPreviewCamera() || !protagonistPreviewCamera) {
    return
  }
  const previousTransformVisible = transformControls?.visible ?? false
  if (transformControls) {
    transformControls.visible = false
  }
  renderer.getSize(previewRenderSize)
  const previewWidth = Math.round(Math.min(PROTAGONIST_PREVIEW_WIDTH, previewRenderSize.x))
  const previewHeight = Math.round(Math.min(PROTAGONIST_PREVIEW_HEIGHT, previewRenderSize.y))
  const previewX = Math.round(Math.max(0, previewRenderSize.x - previewWidth - PROTAGONIST_PREVIEW_MARGIN))
  const previewY = Math.round(PROTAGONIST_PREVIEW_MARGIN)
  renderer.getViewport(previewViewportState)
  renderer.getScissor(previewScissorState)
  const previousScissorTest = renderer.getScissorTest()
  const previousAutoClear = renderer.autoClear
  renderer.clearDepth()
  renderer.setViewport(previewX, previewY, previewWidth, previewHeight)
  renderer.setScissor(previewX, previewY, previewWidth, previewHeight)
  renderer.setScissorTest(true)
  renderer.autoClear = false
  protagonistPreviewCamera.aspect = previewWidth / previewHeight
  protagonistPreviewCamera.updateProjectionMatrix()
  renderer.render(scene, protagonistPreviewCamera)
  renderer.setViewport(previewViewportState)
  renderer.setScissor(previewScissorState)
  renderer.setScissorTest(previousScissorTest)
  renderer.autoClear = previousAutoClear
  if (transformControls) {
    transformControls.visible = previousTransformVisible
  }
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

function handleAlignSelection(mode: AlignMode) {
  alignSelection(mode)
}

function handleRotateSelection(options: SelectionRotationOptions) {
  rotateSelection(options)
}

function createScreenshotFileName(): string {
  const sceneName = sceneStore.currentSceneMeta?.name ?? 'scene'
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
    renderViewportFrame()
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

async function captureScreenshot(mimeType: string = 'image/png'): Promise<Blob | null> {
  if (!renderer || !scene || !camera) {
    return null
  }

  try {
    renderViewportFrame()
    const canvas = renderer.domElement
    if (typeof canvas.toBlob === 'function') {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((value) => resolve(value), mimeType)
      })
      if (blob) {
        return blob
      }
    }

    const dataUrl = canvas.toDataURL(mimeType)
    const response = await fetch(dataUrl)
    return await response.blob()
  } catch (error) {
    console.warn('Failed to capture viewport screenshot blob', error)
    return null
  }
}

function handleToggleCameraControlMode() {
  cameraControlMode.value = cameraControlMode.value === 'orbit' ? 'map' : 'orbit'
}

watch(isSceneReady,(ready) => {
  if (ready) {
    syncSceneGraph()
    restoreGroupdScatter()
  }
})

watch(gridVisible, (visible) => {
  applyGridVisibility(visible)
}, { immediate: true })

watch(axesVisible, (visible) => {
  applyAxesVisibility(visible)
}, { immediate: true })

watch(skyboxSettings, (settings) => {
  applySkyboxSettingsToScene(settings)
  syncCloudRendererSettings()
}, { deep: true, immediate: true })

watch(cloudPreviewEnabled, () => {
  syncCloudRendererSettings()
}, { immediate: true })

watch(environmentSettings, (settings) => {
  void applyEnvironmentSettingsToScene(settings)
}, { deep: true, immediate: true })

function resetCameraView() {
  if (!camera || !orbitControls) return

  const targetY = Math.max(DEFAULT_CAMERA_TARGET.y, MIN_TARGET_HEIGHT)
  const position = new THREE.Vector3(DEFAULT_CAMERA_POSITION.x, DEFAULT_CAMERA_POSITION.y, DEFAULT_CAMERA_POSITION.z)
  const target = new THREE.Vector3(DEFAULT_CAMERA_TARGET.x, targetY, DEFAULT_CAMERA_TARGET.z)

  isApplyingCameraState = true
  camera.position.copy(position)
  camera.fov = DEFAULT_PERSPECTIVE_FOV
  camera.updateProjectionMatrix()

  orbitControls.target.copy(target)
  orbitControls.update()
  isApplyingCameraState = false

}

function snapVectorToGrid(vec: THREE.Vector3) {
  vec.x = Math.round(vec.x / GRID_SNAP_SPACING) * GRID_SNAP_SPACING
  vec.z = Math.round(vec.z / GRID_SNAP_SPACING) * GRID_SNAP_SPACING
  return vec
}

function snapVectorToMajorGrid(vec: THREE.Vector3) {
  vec.x = Math.round(vec.x / GRID_MAJOR_SPACING) * GRID_MAJOR_SPACING
  vec.z = Math.round(vec.z / GRID_MAJOR_SPACING) * GRID_MAJOR_SPACING
  return vec
}

function resolveSceneNodeById(nodeId: string | null | undefined): SceneNode | null {
  if (!nodeId) {
    return null
  }
  return findSceneNode(sceneStore.nodes, nodeId) ?? findSceneNode(props.sceneNodes, nodeId)
}

function snapVectorToGridForNode(vec: THREE.Vector3, nodeId: string | null | undefined) {
  const node = resolveSceneNodeById(nodeId)
  if (node?.editorFlags?.ignoreGridSnapping) {
    return vec
  }
  if (node?.dynamicMesh?.type === 'Wall') {
    return snapVectorToMajorGrid(vec)
  }
  return snapVectorToGrid(vec)
}

export type SceneViewportHandle = {
  captureScreenshot(mimeType?: string): Promise<Blob | null>
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
  gizmoControls?.cameraUpdate()
  isApplyingCameraState = false
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
    const box = setBoundingBoxFromObject(object, new THREE.Box3())
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

  if (perspectiveCamera && camera !== perspectiveCamera) {
    perspectiveCamera.position.copy(camera.position)
    perspectiveCamera.quaternion.copy(camera.quaternion)
  }
  return true
}

function handleControlsChange() {
  if (!isSceneReady.value || isApplyingCameraState) return

  gizmoControls?.cameraUpdate()
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
  const useMapControls = mode === 'map' || mode === 'orbit'
  orbitControls = useMapControls ? new MapControls(camera, domElement) : new OrbitControls(camera, domElement)
  orbitControls.enableDamping = false
  orbitControls.dampingFactor = mode === 'orbit' ? 0.08 : 0.05
  orbitControls.screenSpacePanning = false
  if (previousTarget) {
    orbitControls.target.copy(previousTarget)
  } else {
    orbitControls.target.set(DEFAULT_CAMERA_TARGET.x, DEFAULT_CAMERA_TARGET.y, DEFAULT_CAMERA_TARGET.z)
  }
  orbitControls.enabled = previousEnabled
  orbitControls.addEventListener('change', handleControlsChange)
  bindControlsToCamera(camera)
  if (gizmoControls && orbitControls) {
    gizmoControls.attachControls(orbitControls as OrbitControls)
    gizmoControls.update()
  }
  updateOrbitControlsEnabled()
  orbitControls.update()
  gizmoControls?.cameraUpdate()

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
    antialias: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  })
  const pixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(width, height)
  renderer.shadowMap.enabled = Boolean(shadowsEnabled.value)
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = skyboxSettings.value.exposure
  renderer.outputColorSpace = THREE.SRGBColorSpace

  pmremGenerator?.dispose()
  pmremGenerator = new THREE.PMREMGenerator(renderer)

  scene = new THREE.Scene()
  scene.background = new THREE.Color(DEFAULT_BACKGROUND_COLOR)
  scene.fog = null

  const initialEnvironment = environmentSettings.value
  environmentAmbientLight = new THREE.AmbientLight(
    initialEnvironment.ambientLightColor,
    initialEnvironment.ambientLightIntensity,
  )
  scene.add(environmentAmbientLight)

  applySunDirectionToSunLight()

  ensureSkyExists()
  scene.add(rootGroup)
  scene.add(instancedMeshGroup)
  scene.add(instancedOutlineGroup)
  scene.add(gridGroup)
  scene.add(axesHelper)
  scene.add(brushMesh)
  scene.add(groundSelectionGroup)
  scene.add(dragPreviewGroup)
  gridHighlight = createGridHighlight()
  if (gridHighlight) {
    scene.add(gridHighlight)
  }
  faceSnapManager.ensureEffectPool()
  applyGridVisibility(gridVisible.value)
  applyAxesVisibility(axesVisible.value)
  ensureFallbackLighting()
  clearInstancedMeshes()
  stopInstancedMeshSubscription = subscribeInstancedMeshes((mesh) => {
    attachInstancedMesh(mesh)
  })

  applySkyboxSettingsToScene(skyboxSettings.value)
  if (pendingSkyboxSettings) {
    applySkyboxSettingsToScene(pendingSkyboxSettings)
  }

  if (pendingEnvironmentSettings) {
    void applyEnvironmentSettingsToScene(pendingEnvironmentSettings)
  } else {
    void applyEnvironmentSettingsToScene(initialEnvironment)
  }

  perspectiveCamera = new THREE.PerspectiveCamera(DEFAULT_PERSPECTIVE_FOV, width / height || 1, 0.1, 500)
  perspectiveCamera.position.set(DEFAULT_CAMERA_POSITION.x, DEFAULT_CAMERA_POSITION.y, DEFAULT_CAMERA_POSITION.z)
  perspectiveCamera.lookAt(new THREE.Vector3(DEFAULT_CAMERA_TARGET.x, DEFAULT_CAMERA_TARGET.y, DEFAULT_CAMERA_TARGET.z))
  camera = perspectiveCamera

  applyCameraControlMode(cameraControlMode.value)

  transformControls = new TransformControls(camera, canvasRef.value)
  transformControls.addEventListener('dragging-changed', draggingChangedHandler as any)
  transformControls.addEventListener('objectChange', handleTransformChange)
  scene.add(transformControls.getHelper())

  createPostProcessingPipeline(width, height)

  bindControlsToCamera(camera)

  const gizmoContainer = gizmoContainerRef.value ?? viewportEl.value ?? undefined
  gizmoControls = new ViewportGizmo(camera, renderer, {
    container: gizmoContainer,
    offset: { top: 0, right: 0, bottom: 0, left: 0 },
    size: 70,
  })
  if (orbitControls) {
    gizmoControls.attachControls(orbitControls as OrbitControls)
  }
  gizmoControls.update()

  canvasRef.value.addEventListener('pointerdown', handlePointerDown, { capture: true })
  canvasRef.value.addEventListener('dblclick', handleCanvasDoubleClick, { capture: true })
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
    if (w <= 0 || h <= 0) {
      return
    }
    renderer.setSize(w, h)
    composer?.setSize(w, h)
    outlinePass?.setSize(w, h)
    updateFxaaResolution(w, h)
    if (perspectiveCamera) {
      perspectiveCamera.aspect = h === 0 ? 1 : w / h
      perspectiveCamera.updateProjectionMatrix()
    }
    gizmoControls?.update()
  })
  resizeObserver.observe(viewportEl.value)

  renderClock.start()
  animate()
  
  applyCameraState(props.cameraState)
  syncCloudRendererSettings()
}

function syncSkyVisibility() {
  if (!sky) {
    return
  }
  sky.visible = shouldRenderSkyBackground
}

function setSkyBackgroundEnabled(enabled: boolean) {
  shouldRenderSkyBackground = enabled
  syncSkyVisibility()
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
  syncSkyVisibility()
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

  const previousVisibility = sky.visible
  sky.visible = true
  skyEnvironmentTarget = pmremGenerator.fromScene(sky as unknown as THREE.Scene)
  sky.visible = previousVisibility
  syncSkyVisibility()
  if (scene) {
    scene.environment = skyEnvironmentTarget.texture
    scene.environmentIntensity = SKY_ENVIRONMENT_INTENSITY
  }
}

function ensureSunLight(): THREE.DirectionalLight | null {
  if (!scene) {
    return null
  }

  if (!sunDirectionalLight) {
    const light = new THREE.DirectionalLight(0xffffff, 1.05)
    light.name = 'SkySunLight'
    light.castShadow = Boolean(shadowsEnabled.value)
    light.shadow.mapSize.set(512, 512)
    light.shadow.bias = -0.0001
    light.shadow.normalBias = 0.02
    light.shadow.camera.near = 1
    light.shadow.camera.far = 400
    light.shadow.camera.left = -200
    light.shadow.camera.right = 200
    light.shadow.camera.top = 200
    light.shadow.camera.bottom = -200
    sunDirectionalLight = light
    scene.add(light)
    scene.add(light.target)
  } else {
    if (sunDirectionalLight.parent !== scene) {
      scene.add(sunDirectionalLight)
    }
    if (sunDirectionalLight.target.parent !== scene) {
      scene.add(sunDirectionalLight.target)
    }
  }

  sunDirectionalLight.castShadow = Boolean(shadowsEnabled.value)
  return sunDirectionalLight
}

function updateSunLightVisibility() {
  if (sunDirectionalLight) {
    sunDirectionalLight.visible = !isSunLightSuppressed
  }
}

function setSunLightSuppressed(suppressed: boolean) {
  if (isSunLightSuppressed === suppressed) {
    return
  }
  isSunLightSuppressed = suppressed
  if (!suppressed) {
    applySunDirectionToSunLight()
  } else {
    updateSunLightVisibility()
  }
}

function applySunDirectionToSunLight() {
  if (isSunLightSuppressed) {
    updateSunLightVisibility()
    return
  }

  const light = ensureSunLight()
  if (!light) {
    return
  }

  if (skySunPosition.lengthSq() > 1e-6) {
    tempSunDirection.copy(skySunPosition)
  } else {
    tempSunDirection.copy(DEFAULT_SUN_DIRECTION)
  }

  light.position.copy(tempSunDirection).multiplyScalar(SKY_SUN_LIGHT_DISTANCE)
  if (light.position.y < SKY_SUN_LIGHT_MIN_HEIGHT) {
    light.position.y = SKY_SUN_LIGHT_MIN_HEIGHT
  }

  light.target.position.set(0, 0, 0)
  light.target.updateMatrixWorld()
  updateSunLightVisibility()
}

function applySunDirectionToFallbackLight() {
  applySunDirectionToSunLight()
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

function cloneEnvironmentSettingsLocal(settings: EnvironmentSettings): EnvironmentSettings {
  try {
    return structuredClone(settings)
  } catch (_error) {
    return JSON.parse(JSON.stringify(settings)) as EnvironmentSettings
  }
}

function normalizeCloudAssetReference(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed.length) {
    return ''
  }
  return trimmed.startsWith('asset://') ? trimmed.slice('asset://'.length) : trimmed
}

async function resolveCloudAssetUrl(source: string): Promise<{ url: string; dispose?: () => void } | null> {
  const normalized = normalizeCloudAssetReference(source)
  if (!normalized) {
    return null
  }
  const asset = sceneStore.getAsset(normalized)
  if (!asset) {
    return { url: normalized }
  }
  try {
    const entry = await assetCacheStore.downloaProjectAsset(asset)
    const url = entry.blobUrl ?? asset.downloadUrl ?? asset.description ?? null
    if (!url) {
      return null
    }
    assetCacheStore.touch(asset.id)
    return { url }
  } catch (error) {
    console.warn('[SceneViewport] Failed to resolve cloud asset', normalized, error)
    return null
  }
}

function resolveAssetExtension(asset: ProjectAsset | null, override?: string | null): string | null {
  const source = override ?? asset?.name ?? asset?.downloadUrl ?? asset?.description ?? asset?.id ?? ''
  const match = source.match(/\.([a-z0-9]+)(?:$|[?#])/i)
  return match ? match[1]?.toLowerCase() ?? null : null
}

async function resolveEnvironmentAssetUrl(assetId: string): Promise<{ url: string; extension: string | null; asset: ProjectAsset } | null> {
  const asset = sceneStore.getAsset(assetId)
  if (!asset) {
    console.warn('Environment asset not found', assetId)
    return null
  }

  let entry: Awaited<ReturnType<typeof assetCacheStore.downloaProjectAsset>> | null = null
  try {
    entry = await assetCacheStore.downloaProjectAsset(asset)
  } catch (error) {
    console.warn('Failed to cache environment asset', assetId, error)
  }

  const url = entry?.blobUrl ?? asset.downloadUrl ?? asset.description ?? null
  if (!url) {
    console.warn('Environment asset has no accessible URL', assetId)
    return null
  }

  assetCacheStore.touch(assetId)
  const extension = resolveAssetExtension(asset, entry?.filename ?? url)
  return { url, extension, asset }
}

async function loadEnvironmentTextureFromAsset(assetId: string): Promise<THREE.Texture | null> {
  const resolved = await resolveEnvironmentAssetUrl(assetId)
  if (!resolved) {
    return null
  }

  const { url, extension } = resolved

  try {
    if (extension === 'hdr' || extension === 'hdri') {
      const texture = await rgbeLoader.loadAsync(url)
      texture.mapping = THREE.EquirectangularReflectionMapping
      texture.needsUpdate = true
      return texture
    }
    if (extension === 'exr') {
      const texture = await exrLoader.loadAsync(url)
      texture.mapping = THREE.EquirectangularReflectionMapping
      texture.flipY = false
      texture.needsUpdate = true
      return texture
    }
    const texture = await textureLoader.loadAsync(url)
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.colorSpace = THREE.SRGBColorSpace
    texture.flipY = false
    texture.needsUpdate = true
    return texture
  } catch (error) {
    console.warn('Failed to load environment texture', assetId, error)
    return null
  }
}

function disposeBackgroundResources() {
  if (scene && scene.background === backgroundTexture) {
    scene.background = null
  }
  if (backgroundTexture) {
    backgroundTexture.dispose()
    backgroundTexture = null
  }
  backgroundAssetId = null
}

function disposeCustomEnvironmentTarget() {
  if (customEnvironmentTarget) {
    if (scene && scene.environment === customEnvironmentTarget.texture) {
      scene.environment = null
      scene.environmentIntensity = 1
    }
    customEnvironmentTarget.dispose()
    customEnvironmentTarget = null
  }
  environmentMapAssetId = null
}

function applySkyEnvironment() {
  if (!scene) {
    return
  }
  if (environmentSettings.value.environmentMap.mode !== 'skybox') {
    return
  }
  if (skyEnvironmentTarget) {
    scene.environment = skyEnvironmentTarget.texture
    scene.environmentIntensity = SKY_ENVIRONMENT_INTENSITY
  } else {
    scene.environment = null
    scene.environmentIntensity = 1
  }
}

async function applyBackgroundSettings(background: EnvironmentSettings['background']): Promise<boolean> {
  backgroundLoadToken += 1
  const token = backgroundLoadToken

  if (!scene) {
    return false
  }

  if (background.mode === 'skybox') {
    disposeBackgroundResources()
    setSkyBackgroundEnabled(true)
    scene.background = null
    return true
  }

  setSkyBackgroundEnabled(false)

  if (background.mode === 'solidColor') {
    disposeBackgroundResources()
    scene.background = new THREE.Color(background.solidColor)
    return true
  }

  if (!background.hdriAssetId) {
    disposeBackgroundResources()
    scene.background = new THREE.Color(background.solidColor)
    return true
  }

  if (backgroundTexture && backgroundAssetId === background.hdriAssetId) {
    scene.background = backgroundTexture
    return true
  }

  const texture = await loadEnvironmentTextureFromAsset(background.hdriAssetId)
  if (!texture || token !== backgroundLoadToken) {
    texture?.dispose()
    return false
  }

  disposeBackgroundResources()
  backgroundTexture = texture
  backgroundAssetId = background.hdriAssetId
  scene.background = texture
  return true
}

async function applyEnvironmentMapSettings(mapSettings: EnvironmentSettings['environmentMap']): Promise<boolean> {
  environmentMapLoadToken += 1
  const token = environmentMapLoadToken

  if (!scene) {
    return false
  }

  const shouldSuppressSunLight = mapSettings.mode !== 'skybox' && Boolean(mapSettings.hdriAssetId)
  setSunLightSuppressed(shouldSuppressSunLight)

  if (mapSettings.mode === 'skybox') {
    disposeCustomEnvironmentTarget()
    applySkyEnvironment()
    return true
  }

  if (!mapSettings.hdriAssetId) {
    disposeCustomEnvironmentTarget()
    scene.environment = null
    scene.environmentIntensity = 1
    return true
  }

  if (!pmremGenerator || !renderer) {
    return false
  }

  if (customEnvironmentTarget && environmentMapAssetId === mapSettings.hdriAssetId) {
    scene.environment = customEnvironmentTarget.texture
    scene.environmentIntensity = 1
    return true
  }

  const texture = await loadEnvironmentTextureFromAsset(mapSettings.hdriAssetId)
  if (!texture || token !== environmentMapLoadToken) {
    texture?.dispose()
    return false
  }

  const target = pmremGenerator.fromEquirectangular(texture)
  texture.dispose()
  if (!target || token !== environmentMapLoadToken) {
    target?.dispose()
    return false
  }

  disposeCustomEnvironmentTarget()
  customEnvironmentTarget = target
  environmentMapAssetId = mapSettings.hdriAssetId
  scene.environment = target.texture
  scene.environmentIntensity = 1
  return true
}

function applyAmbientLightSettings(settings: EnvironmentSettings) {
  if (!environmentAmbientLight) {
    return
  }
  environmentAmbientLight.color.set(settings.ambientLightColor)
  environmentAmbientLight.intensity = settings.ambientLightIntensity
}

function applyFogSettings(settings: EnvironmentSettings) {
  if (!scene) {
    return
  }
  if (settings.fogMode === 'none') {
    scene.fog = null
    return
  }
  const fogColor = new THREE.Color(settings.fogColor)
  const density = Math.max(0, settings.fogDensity)
  if (scene.fog instanceof THREE.FogExp2) {
    scene.fog.color.copy(fogColor)
    scene.fog.density = density
  } else {
    scene.fog = new THREE.FogExp2(fogColor, density)
  }
}

async function applyEnvironmentSettingsToScene(settings: EnvironmentSettings) {
  const snapshot = cloneEnvironmentSettingsLocal(settings)

  if (!scene) {
    pendingEnvironmentSettings = snapshot
    return
  }

  applyAmbientLightSettings(snapshot)
  applyFogSettings(snapshot)

  const backgroundApplied = await applyBackgroundSettings(snapshot.background)
  const environmentApplied = await applyEnvironmentMapSettings(snapshot.environmentMap)

  if (backgroundApplied && environmentApplied) {
    pendingEnvironmentSettings = null
  } else {
    pendingEnvironmentSettings = snapshot
  }
}

function ensureCloudRenderer(): SceneCloudRenderer | null {
  if (!scene) {
    return null
  }
  if (cloudRenderer) {
    return cloudRenderer
  }
  cloudRenderer = new SceneCloudRenderer({
    scene,
    assetResolver: resolveCloudAssetUrl,
    textureLoader,
    cubeTextureLoader,
  })
  return cloudRenderer
}

function disposeCloudRenderer() {
  if (!cloudRenderer) {
    return
  }
  cloudRenderer.dispose()
  cloudRenderer = null
}

function syncCloudRendererSettings() {
  if (!cloudPreviewEnabled.value) {
    disposeCloudRenderer()
    return
  }
  if (!scene) {
    return
  }
  const rendererInstance = ensureCloudRenderer()
  rendererInstance?.setSkyboxSettings(skyboxSettings.value)
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

  const delta = renderClock.running ? renderClock.getDelta() : 0
  const effectiveDelta = delta > 0 ? Math.min(delta, 0.1) : 0

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
      if (perspectiveCamera && camera !== perspectiveCamera) {
        perspectiveCamera.position.copy(camera.position)
        perspectiveCamera.quaternion.copy(camera.quaternion)
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

  if (wallPreviewNeedsSync) {
    wallPreviewNeedsSync = false
    syncWallPreview()
  }
  updatePlaceholderOverlayPositions()
  if (sky) {
    sky.position.copy(camera.position)
  }
  gizmoControls?.cameraUpdate()
  if (props.activeTool === 'translate') {
      faceSnapManager.updateEffectIntensity(effectiveDelta)
  }
  if (effectiveDelta > 0 && effectRuntimeTickers.length) {
    effectRuntimeTickers.forEach((tick) => {
      try {
        tick(effectiveDelta)
      } catch (error) {
        console.warn('[SceneViewport] Failed to advance effect runtime', error)
      }
    })
  }
  if (effectiveDelta > 0 && cloudRenderer) {
    cloudRenderer.update(effectiveDelta)
  }
  renderViewportFrame()
  gizmoControls?.render()
  stats?.end()
}

function disposeScene() {
  disposeStats()
  disposeCloudRenderer()
  if (stopInstancedMeshSubscription) {
    stopInstancedMeshSubscription()
    stopInstancedMeshSubscription = null
  }
  clearInstancedMeshes()
  instancedMeshGroup.removeFromParent()
  clearInstancedOutlineEntries()
  instancedOutlineGroup.removeFromParent()

  resizeObserver?.disconnect()
  resizeObserver = null

  faceSnapManager.dispose()
  hasTransformLastWorldPosition = false

  if (canvasRef.value) {
    canvasRef.value.removeEventListener('pointerdown', handlePointerDown, { capture: true })
    canvasRef.value.removeEventListener('dblclick', handleCanvasDoubleClick, { capture: true })
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

  if (sunDirectionalLight) {
    sunDirectionalLight.parent?.remove(sunDirectionalLight)
    sunDirectionalLight.target.parent?.remove(sunDirectionalLight.target)
    sunDirectionalLight.dispose()
    sunDirectionalLight = null
  }

  if (scene && fallbackLightGroup) {
    scene.remove(fallbackLightGroup)
    fallbackLightGroup.clear()
  }
  fallbackLightGroup = null
  fallbackDirectionalLight = null

  if (gizmoControls) {
    gizmoControls.dispose()
    gizmoControls = null
  }

  groundSelectionGroup.removeFromParent()
  cancelSurfaceBuildSession()

  if (orbitControls) {
    orbitControls.removeEventListener('change', handleControlsChange)
    orbitControls.dispose()
  }
  orbitControls = null
  orbitDisableCount = 0
  isSelectDragOrbitDisabled = false
  isGroundSelectionOrbitDisabled = false

  disposePostProcessing()
  renderer?.dispose()
  renderer = null
  renderClock.stop()

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

  clearOutlineSelectionTargets()
  disposeDragPreview()
  dragPreviewGroup.removeFromParent()

  clearSelectionHighlights()
  disposeNodePickerHighlight()
  disposeNodeFlashIndicator()
  if (sceneStore.nodeHighlightTargetId) {
    sceneStore.clearNodeHighlightRequest(sceneStore.nodeHighlightTargetId)
  }
  releaseGroundMeshCache()
  scene = null
  camera = null
  perspectiveCamera = null

  clearPlaceholderOverlays()
  objectMap.clear()
  resetEffectRuntimeTickers()
  wallPreviewNeedsSync = false
  wallPreviewSignature = null
  pendingSceneGraphSync = false
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
  setBoundingBoxFromObject(object, selectionHighlightBoundingBox)
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

function resolveOutlineTargetForNode(nodeId: string | null | undefined): THREE.Object3D | null {
  if (!nodeId) {
    return null
  }

  const cached = objectMap.get(nodeId)
  if (cached) {
    return cached
  }

  if (!scene) {
    return null
  }

  let fallback: THREE.Object3D | null = null
  scene.traverse((candidate) => {
    if (fallback) {
      return
    }
    if ((candidate.userData?.nodeId as string | undefined) === nodeId) {
      fallback = candidate
    }
  })
  return fallback
}

function collectVisibleMeshesForOutline(
  object: THREE.Object3D,
  collector: Set<THREE.Object3D>,
  activeInstancedNodeIds: Set<string>,
) {
  if (!object.visible) {
    return
  }

  const nodeId = object.userData?.nodeId as string | undefined
  const isInstancedNode = Boolean(object.userData?.instancedAssetId) && Boolean(nodeId)

  let shouldSkipMeshCandidate = false

  if (isInstancedNode && nodeId) {
    const proxies = updateInstancedOutlineEntry(nodeId, object)
    if (proxies.length) {
      proxies.forEach((proxy) => collector.add(proxy))
      activeInstancedNodeIds.add(nodeId)
      shouldSkipMeshCandidate = true
    }
  }

  const meshCandidate = object as THREE.Mesh
  if (meshCandidate?.userData?.instancedPickProxy) {
    return
  }

  if (!shouldSkipMeshCandidate && (meshCandidate?.isMesh || (meshCandidate as { isSkinnedMesh?: boolean }).isSkinnedMesh)) {
    collector.add(meshCandidate)
  }

  const childCount = object.children.length
  if (childCount > 0) {
    for (let index = 0; index < childCount; index += 1) {
      const child = object.children[index]
      if (!child) {
        continue
      }
      collectVisibleMeshesForOutline(child, collector, activeInstancedNodeIds)
    }
  }
}

type InstancedBoundsPayload = { min: [number, number, number]; max: [number, number, number] }

function isInstancedBoundsPayload(value: unknown): value is InstancedBoundsPayload {
  if (!value || typeof value !== 'object') {
    return false
  }
  const payload = value as Partial<InstancedBoundsPayload>
  return Array.isArray(payload.min) && payload.min.length === 3 && Array.isArray(payload.max) && payload.max.length === 3
}

function extractInstancedBounds(node: SceneNode, object: THREE.Object3D): InstancedBoundsPayload | null {
  const nodeUserData = node.userData as Record<string, unknown> | undefined
  const nodeBoundsCandidate = nodeUserData?.instancedBounds
  if (isInstancedBoundsPayload(nodeBoundsCandidate)) {
    return nodeBoundsCandidate
  }
  const objectBoundsCandidate = object.userData?.instancedBounds
  if (isInstancedBoundsPayload(objectBoundsCandidate)) {
    return objectBoundsCandidate
  }
  return null
}

function ensureInstancedPickProxy(object: THREE.Object3D, node: SceneNode) {
  const bounds = extractInstancedBounds(node, object)
  if (!bounds) {
    removeInstancedPickProxy(object)
    return
  }

  let proxy = object.userData?.instancedPickProxy as THREE.Mesh | undefined
  if (!proxy) {
    proxy = new THREE.Mesh(instancedPickProxyGeometry, instancedPickProxyMaterial)
    proxy.name = `${object.name ?? node.name ?? 'Instanced'}:PickProxy`
    proxy.userData = {
      ...(proxy.userData ?? {}),
      nodeId: node.id,
      instancedPickProxy: true,
      excludeFromOutline: true,
    }
    proxy.renderOrder = -9999
    proxy.frustumCulled = false
    object.add(proxy)
    const userData = object.userData ?? (object.userData = {})
    userData.instancedPickProxy = proxy
  } else {
    proxy.userData.nodeId = node.id
  }

  instancedPickBoundsMinHelper.fromArray(bounds.min)
  instancedPickBoundsMaxHelper.fromArray(bounds.max)
  instancedPickBoundsSizeHelper.subVectors(instancedPickBoundsMaxHelper, instancedPickBoundsMinHelper)
  instancedPickBoundsCenterHelper
    .addVectors(instancedPickBoundsMinHelper, instancedPickBoundsMaxHelper)
    .multiplyScalar(0.5)

  const eps = 1e-4
  proxy.position.copy(instancedPickBoundsCenterHelper)
  proxy.scale.set(
    Math.max(instancedPickBoundsSizeHelper.x, eps),
    Math.max(instancedPickBoundsSizeHelper.y, eps),
    Math.max(instancedPickBoundsSizeHelper.z, eps),
  )
  proxy.visible = true
  proxy.updateMatrixWorld(true)
}

function removeInstancedPickProxy(object: THREE.Object3D) {
  const proxy = object.userData?.instancedPickProxy as THREE.Mesh | undefined
  if (!proxy) {
    return
  }
  proxy.removeFromParent()
  delete object.userData.instancedPickProxy
}

// Maintains transparent proxy meshes per instanced node so OutlinePass can highlight individual instances.
function getOutlineProxyMaterial(source: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] {
  if (Array.isArray(source)) {
    return source.map(() => instancedOutlineBaseMaterial)
  }
  return instancedOutlineBaseMaterial
}

function createInstancedOutlineProxy(template: THREE.InstancedMesh): THREE.Mesh {
  const proxyMaterial = getOutlineProxyMaterial(template.material as THREE.Material | THREE.Material[])
  const proxy = new THREE.Mesh(template.geometry, proxyMaterial)
  proxy.matrixAutoUpdate = false
  proxy.visible = false
  proxy.frustumCulled = false
  proxy.renderOrder = 9999
  return proxy
}

function ensureInstancedOutlineEntry(nodeId: string): InstancedOutlineEntry {
  let entry = instancedOutlineEntries.get(nodeId)
  if (!entry) {
    const group = new THREE.Group()
    group.name = `InstancedOutline:${nodeId}`
    instancedOutlineGroup.add(group)
    entry = {
      group,
      proxies: new Map<string, THREE.Mesh>(),
    }
    instancedOutlineEntries.set(nodeId, entry)
  } else if (entry.group.parent !== instancedOutlineGroup) {
    instancedOutlineGroup.add(entry.group)
  }
  entry.group.visible = true
  return entry
}

function updateInstancedOutlineEntry(nodeId: string, object: THREE.Object3D | null): THREE.Mesh[] {
  const binding = getModelInstanceBinding(nodeId)
  if (!binding || !binding.slots.length) {
    releaseInstancedOutlineEntry(nodeId, false)
    return []
  }

  const entry = ensureInstancedOutlineEntry(nodeId)
  const activeHandles = new Set<string>()
  const proxies: THREE.Mesh[] = []
  const isVisible = object?.visible !== false

  binding.slots.forEach((slot) => {
    const { handleId, mesh, index } = slot
    let proxy = entry.proxies.get(handleId)
    if (!proxy) {
      proxy = createInstancedOutlineProxy(mesh)
      entry.proxies.set(handleId, proxy)
      entry.group.add(proxy)
    } else {
      if (proxy.geometry !== mesh.geometry) {
        proxy.geometry = mesh.geometry
      }
      if (Array.isArray(mesh.material)) {
        const current = Array.isArray(proxy.material) ? proxy.material : null
        if (!current || current.length !== mesh.material.length) {
          proxy.material = getOutlineProxyMaterial(mesh.material)
        }
      } else if (Array.isArray(proxy.material)) {
        proxy.material = instancedOutlineBaseMaterial
      }
      if (proxy.parent !== entry.group) {
        entry.group.add(proxy)
      }
    }

    mesh.updateWorldMatrix(true, false)
    mesh.getMatrixAt(index, instancedOutlineMatrixHelper)
    instancedOutlineWorldMatrixHelper.multiplyMatrices(mesh.matrixWorld, instancedOutlineMatrixHelper)
    proxy.matrix.copy(instancedOutlineWorldMatrixHelper)
    proxy.visible = isVisible && mesh.visible !== false
    proxies.push(proxy)
    activeHandles.add(handleId)
  })

  const unusedHandles: string[] = []
  entry.proxies.forEach((_proxy, handleId) => {
    if (!activeHandles.has(handleId)) {
      unusedHandles.push(handleId)
    }
  })

  unusedHandles.forEach((handleId) => {
    const proxy = entry.proxies.get(handleId)
    if (!proxy) {
      return
    }
    proxy.visible = false
    proxy.parent?.remove(proxy)
    entry.proxies.delete(handleId)
  })

  entry.group.visible = proxies.some((proxy) => proxy.visible)
  return proxies.filter((proxy) => proxy.visible)
}

function syncInstancedOutlineEntryTransform(nodeId: string) {
  const entry = instancedOutlineEntries.get(nodeId)
  if (!entry) {
    return
  }

  const binding = getModelInstanceBinding(nodeId)
  const object = objectMap.get(nodeId) ?? null
  if (!binding || !binding.slots.length || !object) {
    releaseInstancedOutlineEntry(nodeId, false)
    updateOutlineSelectionTargets()
    return
  }

  let needsRebuild = false
  const isVisible = object.visible !== false

  binding.slots.forEach((slot) => {
    const proxy = entry.proxies.get(slot.handleId)
    if (!proxy) {
      needsRebuild = true
      return
    }
    const { mesh, index } = slot
    mesh.updateWorldMatrix(true, false)
    mesh.getMatrixAt(index, instancedOutlineMatrixHelper)
    instancedOutlineWorldMatrixHelper.multiplyMatrices(mesh.matrixWorld, instancedOutlineMatrixHelper)
    proxy.matrix.copy(instancedOutlineWorldMatrixHelper)
    proxy.visible = isVisible && mesh.visible !== false
  })

  if (needsRebuild) {
    updateOutlineSelectionTargets()
    return
  }

  entry.group.visible = Array.from(entry.proxies.values()).some((proxy) => proxy.visible)
}

function releaseInstancedOutlineEntry(nodeId: string, shouldUpdateOutline = true) {
  const entry = instancedOutlineEntries.get(nodeId)
  if (!entry) {
    return
  }
  entry.proxies.forEach((proxy) => {
    proxy.visible = false
    proxy.parent?.remove(proxy)
  })
  entry.proxies.clear()
  entry.group.clear()
  entry.group.visible = false
  entry.group.removeFromParent()
  instancedOutlineEntries.delete(nodeId)
  if (shouldUpdateOutline) {
    updateOutlineSelectionTargets()
  }
}

function clearInstancedOutlineEntries() {
  const nodeIds = Array.from(instancedOutlineEntries.keys())
  nodeIds.forEach((nodeId) => releaseInstancedOutlineEntry(nodeId, false))
}

function updateOutlineSelectionTargets() {
  const meshSet = new Set<THREE.Object3D>()
  const activeInstancedNodeIds = new Set<string>()
  const idSources: Array<string | null | undefined> = [
    ...sceneStore.selectedNodeIds,
    props.selectedNodeId,
    sceneStore.selectedNodeId,
  ]

  idSources.forEach((id) => {
    if (!id) {
      return
    }
    const target = resolveOutlineTargetForNode(id)
    if (!target) {
      return
    }
    collectVisibleMeshesForOutline(target, meshSet, activeInstancedNodeIds)
  })

  const releaseCandidates: string[] = []
  instancedOutlineEntries.forEach((_entry, nodeId) => {
    if (!activeInstancedNodeIds.has(nodeId)) {
      releaseCandidates.push(nodeId)
    }
  })
  releaseCandidates.forEach((nodeId) => releaseInstancedOutlineEntry(nodeId, false))

  outlineSelectionTargets.length = 0
  outlineSelectionTargets.push(...meshSet)

  if (outlinePass) {
    outlinePass.selectedObjects = outlineSelectionTargets.slice()
  }
}

function clearOutlineSelectionTargets() {
  outlineSelectionTargets.length = 0
  clearInstancedOutlineEntries()
  if (outlinePass) {
    outlinePass.selectedObjects = []
  }
}

function ensureNodePickerIndicator(): THREE.Group | null {
  if (!scene) {
    return null
  }
  if (!nodePickerHighlight) {
    nodePickerHighlight = createSelectionIndicator()
  }
  if (nodePickerHighlight.parent !== scene) {
    scene.add(nodePickerHighlight)
  }
  return nodePickerHighlight
}

function hideNodePickerHighlight() {
  if (nodePickerHighlight) {
    nodePickerHighlight.visible = false
  }
}

function disposeNodePickerHighlight() {
  if (nodePickerHighlight) {
    disposeSelectionIndicator(nodePickerHighlight)
    nodePickerHighlight = null
  }
}

function updateNodePickerHighlight(hit: NodeHitResult | null) {
  if (!hit) {
    hideNodePickerHighlight()
    return
  }
  const indicator = ensureNodePickerIndicator()
  if (!indicator) {
    return
  }
  updateSelectionIndicatorFromObject(indicator, hit.object)
  indicator.visible = true
}

function clearNodeFlashTimers() {
  if (nodeFlashIntervalHandle !== null) {
    window.clearInterval(nodeFlashIntervalHandle)
    nodeFlashIntervalHandle = null
  }
  if (nodeFlashTimeoutHandle !== null) {
    window.clearTimeout(nodeFlashTimeoutHandle)
    nodeFlashTimeoutHandle = null
  }
}

function ensureNodeFlashIndicator(): THREE.Group | null {
  if (!scene) {
    return null
  }
  if (!nodeFlashHighlight) {
    nodeFlashHighlight = createSelectionIndicator()
  }
  if (nodeFlashHighlight.parent !== scene) {
    scene.add(nodeFlashHighlight)
  }
  return nodeFlashHighlight
}

function hideNodeFlashIndicator() {
  if (nodeFlashHighlight) {
    nodeFlashHighlight.visible = false
  }
}

function disposeNodeFlashIndicator() {
  clearNodeFlashTimers()
  if (nodeFlashHighlight) {
    disposeSelectionIndicator(nodeFlashHighlight)
    nodeFlashHighlight = null
  }
  nodeFlashActiveToken = null
}

function triggerNodeFlash(nodeId: string, token: number) {
  clearNodeFlashTimers()
  nodeFlashActiveToken = token
  const object = objectMap.get(nodeId) ?? null
  if (!object) {
    hideNodeFlashIndicator()
    sceneStore.clearNodeHighlightRequest(nodeId, token)
    return
  }
  const indicator = ensureNodeFlashIndicator()
  if (!indicator) {
    sceneStore.clearNodeHighlightRequest(nodeId, token)
    return
  }
  updateSelectionIndicatorFromObject(indicator, object)
  indicator.visible = true
  let visible = true
  nodeFlashIntervalHandle = window.setInterval(() => {
    if (!nodeFlashHighlight || nodeFlashActiveToken !== token) {
      return
    }
    visible = !visible
    nodeFlashHighlight.visible = visible
  }, NODE_FLASH_INTERVAL_MS)

  nodeFlashTimeoutHandle = window.setTimeout(() => {
    if (nodeFlashActiveToken !== token) {
      return
    }
    clearNodeFlashTimers()
    hideNodeFlashIndicator()
    sceneStore.clearNodeHighlightRequest(nodeId, token)
  }, NODE_FLASH_DURATION_MS)
}

type GridHighlightDimensions = { width: number; depth: number }

const NODE_FLASH_DURATION_MS = 1600
const NODE_FLASH_INTERVAL_MS = 180

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
  setBoundingBoxFromObject(object, gridHighlightBoundingBox)
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

async function handlePointerDown(event: PointerEvent) {
  if (!canvasRef.value || !camera || !scene) {
    pointerTrackingState = null
    return
  }

  if (!event.isPrimary) {
    pointerTrackingState = null
    return
  }

  if (isAltOverrideActive) {
    pointerTrackingState = null
    return
  }

  if (handleGroundEditorPointerDown(event)) {
    pointerTrackingState = null
    return
  }

  const button = event.button
  const isSelectionButton = button === 0 || button === 2

  if (nodePickerStore.isActive) {
    pointerTrackingState = null
    if (button === 0) {
      const hit = pickNodeAtPointer(event)
      if (hit) {
        nodePickerStore.completePick(hit.nodeId)
      }
    }
    hideNodePickerHighlight()
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (activeBuildTool.value === 'surface') {
    if (button === 0) {
      pointerTrackingState = null
      handleSurfacePlacementClick(event)
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
    if (button === 2) {
      pointerTrackingState = null
      cancelSurfaceBuildSession()
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
  }

  if (activeBuildTool.value === 'wall') {
    if (button === 0) {
      const hitsSelectable = pointerHitsSelectableObject(event)
      if (hitsSelectable) {
        wallPlacementSuppressedPointerId = event.pointerId
      } else {
        wallPlacementSuppressedPointerId = null
        pointerTrackingState = null
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }
    }
    if (button === 2) {
      pointerTrackingState = null
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
      const duplicateNodes = duplicateIds
        .map((id) => findSceneNode(sceneStore.nodes, id))
        .filter((node): node is SceneNode => Boolean(node))
      if (duplicateNodes.length) {
        await sceneStore.ensureSceneAssetsReady({ nodes: duplicateNodes, showOverlay: false, refreshViewport: false })
      }
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

  const currentPrimaryId = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null

  let dragHit = hit
  if (button === 0 && props.activeTool === 'select') {
    if (dragHit && currentPrimaryId && dragHit.nodeId !== currentPrimaryId) {
      if (sceneStore.isDescendant(currentPrimaryId, dragHit.nodeId)) {
        const primaryObject = objectMap.get(currentPrimaryId)
        if (primaryObject) {
          const worldPoint = dragHit.point.clone()
          dragHit = {
            nodeId: currentPrimaryId,
            object: primaryObject,
            point: worldPoint,
          }
        }
      }
    }
    if (!dragHit) {
      dragHit = pickActiveSelectionBoundingBoxHit(event)
    }
  }

  const activeTransformAxis = button === 0 && props.activeTool !== 'select' ? (transformControls?.axis ?? null) : null

  try {
    canvasRef.value.setPointerCapture(event.pointerId)
  } catch (error) {
    /* noop */
  }

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
  if (nodePickerStore.isActive) {
    const hit = pickNodeAtPointer(event)
    updateNodePickerHighlight(hit)
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (handleGroundEditorPointerMove(event)) {
    return
  }

  if (isAltOverrideActive) {
    return
  }

  if (activeBuildTool.value === 'wall' && wallBuildSession) {
    if (wallBuildSession.dragStart) {
      const isRightButtonActive = (event.buttons & 2) !== 0
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
  const overrideActive = isAltOverrideActive

  if (handleGroundEditorPointerUp(event)) {
    return
  }

  if (activeBuildTool.value === 'wall') {
    if (event.button === 0) {
      const suppressed = wallPlacementSuppressedPointerId === event.pointerId
      if (!suppressed && !overrideActive) {
        const handled = handleWallPlacementClick(event)
        wallPlacementSuppressedPointerId = null
        if (handled) {
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
        }
        return
      }
      wallPlacementSuppressedPointerId = null
    } else if (event.button === 2) {
      wallPlacementSuppressedPointerId = null
      if (overrideActive) {
        return
      }
      const hadWallSession = Boolean(wallBuildSession)
      if (hadWallSession) {
        finalizeWallBuildSession()
      } else {
        handleBuildToolChange(null)
      }
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    } else {
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
      commitSelectionDragTransforms(drag)
      sceneStore.endTransformInteraction()
      updateSelectionHighlights()
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

          const primaryNode = findSceneNode(props.sceneNodes, primaryId)
          const hitMatchesPrimary = Boolean(
            hit &&
            (hit.nodeId === primaryId ||
              (primaryNode?.nodeType === 'Group' && sceneStore.isDescendant(primaryId, hit.nodeId)))
          )

          if (hitMatchesPrimary) {
            event.preventDefault()
            event.stopPropagation()
            rotateActiveSelection(primaryId)
            return
          }
        }
      }

      event.preventDefault()
      event.stopPropagation()
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
  if (nodePickerStore.isActive) {
    hideNodePickerHighlight()
  }

  if (handleGroundEditorPointerCancel(event)) {
    return
  }

  if (activeBuildTool.value === 'wall') {
    if (wallPlacementSuppressedPointerId === event.pointerId) {
      wallPlacementSuppressedPointerId = null
    }
    if (wallBuildSession) {
      cancelWallDrag()
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
  }

  if (!pointerTrackingState || event.pointerId !== pointerTrackingState.pointerId) {
    return
  }

  if (canvasRef.value && canvasRef.value.hasPointerCapture(event.pointerId)) {
    canvasRef.value.releasePointerCapture(event.pointerId)
  }

  if (pointerTrackingState.selectionDrag) {
    const dragState = pointerTrackingState.selectionDrag
    restoreOrbitAfterSelectDrag()
    updateGridHighlightFromObject(dragState.object)
    if (dragState.hasDragged) {
      commitSelectionDragTransforms(dragState)
      sceneStore.endTransformInteraction()
    }
  }

  updateSelectionHighlights()
  pointerTrackingState = null
}

function handleCanvasDoubleClick(event: MouseEvent) {
  if (!scene || !camera || !canvasRef.value) {
    return
  }
  if (nodePickerStore.isActive || isAltOverrideActive) {
    return
  }
  if (transformControls?.dragging) {
    return
  }
  if (activeBuildTool.value === 'surface') {
    if (surfaceBuildSession && surfaceBuildSession.points.length >= 3) {
      const finalized = finalizeSurfaceBuildSession()
      if (finalized) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }
    if (surfaceBuildSession) {
      cancelSurfaceBuildSession()
      event.preventDefault()
      event.stopPropagation()
      return
    }
  }
  const hit = pickNodeAtPointer(event)
  if (!hit) {
    return
  }
  const nextSelection = sceneStore.handleNodeDoubleClick(hit.nodeId)
  const appliedSelection = Array.isArray(nextSelection) && nextSelection.length ? nextSelection : [hit.nodeId]
  emitSelectionChange(appliedSelection)
  event.preventDefault()
  event.stopPropagation()
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
    type: 'Wall',
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
  if (node.dynamicMesh?.type !== 'Wall' || node.dynamicMesh.segments.length === 0) {
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
  if (node.dynamicMesh?.type !== 'Wall') {
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
  wallPlacementSuppressedPointerId = null
}

const SURFACE_POINT_MIN_DISTANCE = 1e-3

function ensureSurfaceBuildSession(): SurfaceBuildSession {
  if (surfaceBuildSession) {
    return surfaceBuildSession
  }
  surfaceBuildSession = {
    points: [],
    previewGroup: null,
  }
  return surfaceBuildSession
}

function disposeSurfacePreviewGroup(group: THREE.Group) {
  const children = [...group.children]
  children.forEach((child) => {
    group.remove(child)
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      mesh.geometry?.dispose?.()
      return
    }
    const line = child as THREE.Line
    if (line?.isLine) {
      line.geometry?.dispose?.()
    }
  })
}

function clearSurfacePreview() {
  if (!surfaceBuildSession?.previewGroup) {
    return
  }
  const preview = surfaceBuildSession.previewGroup
  preview.removeFromParent()
  disposeSurfacePreviewGroup(preview)
  surfaceBuildSession.previewGroup = null
}

function updateSurfacePreview() {
  if (!scene || !surfaceBuildSession) {
    return
  }
  const { points } = surfaceBuildSession
  if (!points.length) {
    clearSurfacePreview()
    return
  }

  const preview = surfaceBuildSession.previewGroup ?? (() => {
    const group = new THREE.Group()
    group.name = 'SurfacePreview'
    surfaceBuildSession!.previewGroup = group
    rootGroup.add(group)
    return group
  })()

  disposeSurfacePreviewGroup(preview)

  const center = new THREE.Vector3()
  points.forEach((point) => {
    center.add(point)
  })
  center.multiplyScalar(1 / points.length)
  preview.position.copy(center)

  if (points.length >= 2) {
    const outlineGeometry = new THREE.BufferGeometry()
    const outlinePositions = new Float32Array(points.length * 3)
    points.forEach((point, index) => {
      const local = point.clone().sub(center)
      outlinePositions[index * 3 + 0] = local.x
      outlinePositions[index * 3 + 1] = local.y
      outlinePositions[index * 3 + 2] = local.z
    })
    outlineGeometry.setAttribute('position', new THREE.BufferAttribute(outlinePositions, 3))
    const outline = new THREE.LineLoop(outlineGeometry, surfacePreviewLineMaterial)
    preview.add(outline)
  }

  if (points.length >= 3) {
    const shape = new THREE.Shape()
    const firstLocal = points[0]!.clone().sub(center)
    shape.moveTo(firstLocal.x, firstLocal.z)
    for (let index = 1; index < points.length; index += 1) {
      const local = points[index]!.clone().sub(center)
      shape.lineTo(local.x, local.z)
    }
    const shapeGeometry = new THREE.ShapeGeometry(shape)
    shapeGeometry.rotateX(-Math.PI / 2)
    shapeGeometry.computeVertexNormals()
    const mesh = new THREE.Mesh(shapeGeometry, surfacePreviewFillMaterial)
    const averageLocalY = points.reduce((sum, point) => sum + (point.y - center.y), 0) / points.length
    mesh.position.set(0, averageLocalY, 0)
    preview.add(mesh)
  }

  if (!rootGroup.children.includes(preview)) {
    rootGroup.add(preview)
  }
}

function clearSurfaceBuildSession() {
  if (!surfaceBuildSession) {
    return
  }
  clearSurfacePreview()
  surfaceBuildSession = null
}

function cancelSurfaceBuildSession() {
  clearSurfaceBuildSession()
}

function handleSurfacePlacementClick(event: PointerEvent): boolean {
  if (!activeBuildTool.value || activeBuildTool.value !== 'surface') {
    return false
  }
  if (!raycastGroundPoint(event, groundPointerHelper)) {
    return false
  }
  const snapped = snapVectorToMajorGrid(groundPointerHelper.clone())
  const session = ensureSurfaceBuildSession()
  const lastPoint = session.points[session.points.length - 1] ?? null
  if (lastPoint && lastPoint.distanceToSquared(snapped) <= SURFACE_POINT_MIN_DISTANCE * SURFACE_POINT_MIN_DISTANCE) {
    return false
  }
  session.points.push(snapped)
  updateSurfacePreview()
  return true
}

function finalizeSurfaceBuildSession(): boolean {
  if (!surfaceBuildSession) {
    return false
  }
  const { points } = surfaceBuildSession
  if (points.length < 3) {
    cancelSurfaceBuildSession()
    return false
  }
  const payload = points.map((point) => ({ x: point.x, y: point.y, z: point.z }))
  const created = sceneStore.createSurfaceNode({ points: payload })
  if (!created) {
    return false
  }
  sceneStore.setSelection([created.id], { primaryId: created.id })
  clearSurfaceBuildSession()
  return true
}

function ensureWallBuildSession(): WallBuildSession {
  if (wallBuildSession) {
    return wallBuildSession
  }
  wallBuildSession = {
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
  }
  return wallBuildSession
}

function constrainWallEndPoint(start: THREE.Vector3, target: THREE.Vector3, rawTarget?: THREE.Vector3): THREE.Vector3 {
  const delta = target.clone().sub(start)
  let stepX = Math.round(delta.x / GRID_MAJOR_SPACING)
  let stepZ = Math.round(delta.z / GRID_MAJOR_SPACING)

  if (stepX === 0 && stepZ === 0) {
    return start.clone()
  }

  const rawDelta = rawTarget ? rawTarget.clone().sub(start) : delta.clone()
  const absRawX = Math.abs(rawDelta.x)
  const absRawZ = Math.abs(rawDelta.z)

  if (absRawX > 1e-4 || absRawZ > 1e-4) {
    const angle = Math.atan2(absRawZ, absRawX)
    const diagonalAngle = Math.PI * 0.25
    if (!Number.isNaN(angle) && Math.abs(angle - diagonalAngle) <= WALL_DIAGONAL_SNAP_THRESHOLD) {
      const diagSteps = Math.max(Math.abs(stepX), Math.abs(stepZ), 1)
      const signX = rawDelta.x >= 0 ? 1 : -1
      const signZ = rawDelta.z >= 0 ? 1 : -1
      stepX = diagSteps * signX
      stepZ = diagSteps * signZ
    }
  }

  if (stepX !== 0 && stepZ !== 0 && Math.abs(stepX) !== Math.abs(stepZ)) {
    if (Math.abs(stepX) > Math.abs(stepZ)) {
      stepZ = 0
    } else {
      stepX = 0
    }
  }

  return new THREE.Vector3(
    start.x + stepX * GRID_MAJOR_SPACING,
    start.y,
    start.z + stepZ * GRID_MAJOR_SPACING,
  )
}

function hydrateWallBuildSessionFromSelection(session: WallBuildSession) {
  const isFreshSession = !session.nodeId && session.segments.length === 0
  if (isFreshSession) {
    const selectedId = sceneStore.selectedNodeId
    if (selectedId) {
      const selectedNode = findSceneNode(sceneStore.nodes, selectedId)
  if (selectedNode?.dynamicMesh?.type === 'Wall') {
        session.dimensions = getWallNodeDimensions(selectedNode)
      }
    }
    session.dimensions = normalizeWallDimensionsForViewport(session.dimensions)
    return
  }
  if (!session.nodeId) {
    const selectedId = sceneStore.selectedNodeId
    if (selectedId) {
      const selectedNode = findSceneNode(sceneStore.nodes, selectedId)
  if (selectedNode?.dynamicMesh?.type === 'Wall') {
        session.nodeId = selectedNode.id
        session.dimensions = getWallNodeDimensions(selectedNode)
        session.segments = expandWallSegmentsToWorld(selectedNode)
      }
    }
  } else {
    const node = findSceneNode(sceneStore.nodes, session.nodeId)
  if (node?.dynamicMesh?.type === 'Wall') {
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
  session.dragStart = startPoint.clone()
  session.dragEnd = startPoint.clone()
  updateWallPreview()
}

function updateWallSegmentDrag(event: PointerEvent) {
  if (isAltOverrideActive) {
    return
  }
  if (!wallBuildSession || !wallBuildSession.dragStart) {
    return
  }

  if (!raycastGroundPoint(event, groundPointerHelper)) {
    return
  }

  const rawPointer = groundPointerHelper.clone()
  const pointer = snapVectorToMajorGrid(rawPointer.clone())
  const constrained = constrainWallEndPoint(wallBuildSession.dragStart, pointer, rawPointer)
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
  restoreOrbitAfterWallBuild()
}

function cancelWallDrag() {
  if (!wallBuildSession) {
    return
  }
  wallBuildSession.dragStart = null
  wallBuildSession.dragEnd = null
  resetWallDragState()
  updateWallPreview()
  wallPlacementSuppressedPointerId = null
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
    start: entry.start.clone(),
    end: entry.end.clone(),
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
  if (refreshed?.dynamicMesh?.type === 'Wall') {
      wallBuildSession.dimensions = getWallNodeDimensions(refreshed)
    }
  }

  wallBuildSession.dragStart = end.clone()
  wallBuildSession.dragEnd = end.clone()
  wallBuildSession.dimensions = normalizeWallDimensionsForViewport(wallBuildSession.dimensions)
  updateWallPreview()
  return true
}

function handleWallPlacementClick(event: PointerEvent): boolean {
  if (!activeBuildTool.value || activeBuildTool.value !== 'wall') {
    return false
  }
  if (isAltOverrideActive) {
    return false
  }
  if (!raycastGroundPoint(event, groundPointerHelper)) {
    return false
  }
  const rawPointer = groundPointerHelper.clone()
  const snappedPoint = snapVectorToMajorGrid(rawPointer.clone())
  const session = ensureWallBuildSession()

  if (!session.dragStart) {
    beginWallSegmentDrag(snappedPoint)
    return true
  }

  const constrained = constrainWallEndPoint(session.dragStart, snappedPoint, rawPointer)
  const previous = session.dragEnd
  if (!previous || !previous.equals(constrained)) {
    session.dragEnd = constrained
    updateWallPreview()
  }

  const committed = commitWallSegmentDrag()
  if (!committed) {
    session.dragStart = constrained.clone()
    session.dragEnd = constrained.clone()
    updateWallPreview()
  }
  return true
}

function cancelWallSelection(): boolean {
  if (!wallBuildSession) {
    return false
  }
  cancelWallDrag()
  clearWallBuildSession()
  restoreOrbitAfterWallBuild()
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
  exitScatterEraseMode()
  const tool = activeBuildTool.value
  if (!tool) {
    return false
  }
  let handled = false
  switch (tool) {
    case 'ground':
      if (groundEditorHasActiveSelection()) {
        cancelGroundSelection()
      } else {
        activeBuildTool.value = null
      }
      handled = true
      break
    case 'wall':
      if (wallBuildSession) {
        finalizeWallBuildSession()
      } else {
        cancelWallSelection()
        activeBuildTool.value = null
      }
      handled = true
      break
    case 'platform':
      activeBuildTool.value = null
      handled = true
      break
    case 'surface':
      if (surfaceBuildSession) {
        cancelSurfaceBuildSession()
      } else {
        activeBuildTool.value = null
      }
      handled = true
      break
    default:
      return false
  }

  if (handled && activeBuildTool.value === null && props.activeTool !== 'select') {
    emit('changeTool', 'select')
  }

  return handled
}

function handleBuildToolChange(tool: BuildTool | null) {
  if (tool === 'ground') {
    exitScatterEraseMode()
    cancelGroundEditorScatterPlacement()
    terrainStore.setGroundPanelTab('terrain')
  }
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
  const intersections = collectSceneIntersections()
  if (intersections.length > 0) {
    const first = intersections[0]
    const point = first?.point.clone() ?? null
    return point ? snapVectorToGrid(point) : null
  }
  return null
}

function nodeSupportsMaterials(node: SceneNode | null): boolean {
  if (!node) {
    return false
  }
  if (node.components?.[PROTAGONIST_COMPONENT_TYPE]) {
    return false
  }
  const type = node.nodeType ?? (node.light ? 'Light' : 'Mesh')
  return type !== 'Light' && type !== 'Group'
}

function resolveMaterialDropTarget(event: DragEvent): { nodeId: string; object: THREE.Object3D } | null {
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
  const intersections = collectSceneIntersections()
  for (const intersection of intersections) {
    const nodeId = resolveNodeIdFromIntersection(intersection)
    if (!nodeId) {
      continue
    }
    if (sceneStore.isNodeSelectionLocked(nodeId)) {
      continue
    }
    const sceneNode = findSceneNode(sceneStore.nodes, nodeId)
    if (!nodeSupportsMaterials(sceneNode)) {
      continue
    }
    const targetObject = objectMap.get(nodeId)
    if (!targetObject) {
      continue
    }
    return { nodeId, object: targetObject }
  }
  return null
}

function resolveBehaviorDropTarget(event: DragEvent): { nodeId: string; object: THREE.Object3D } | null {
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
  const intersections = collectSceneIntersections()
  for (const intersection of intersections) {
    const nodeId = resolveNodeIdFromIntersection(intersection)
    if (!nodeId) {
      continue
    }
    if (sceneStore.isNodeSelectionLocked(nodeId)) {
      continue
    }
    const targetObject = objectMap.get(nodeId)
    if (!targetObject) {
      continue
    }
    return { nodeId, object: targetObject }
  }
  return null
}

const DISPLAY_BOARD_VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'ogv', 'ogg', 'mov', 'm4v'])

function inferAssetExtension(asset: ProjectAsset | null): string | null {
  if (!asset) {
    return null
  }
  const source = asset.name || asset.downloadUrl || asset.id
  if (!source) {
    return null
  }
  const match = source.match(/\.([a-z0-9]+)(?:$|[?#])/i)
  return match ? match[1]?.toLowerCase() ?? null : null
}

function isDisplayBoardCompatibleAsset(asset: ProjectAsset | null): asset is ProjectAsset {
  if (!asset) {
    return false
  }
  if (asset.type === 'image' || asset.type === 'texture') {
    return true
  }
  if (asset.type === 'file') {
    const extension = inferAssetExtension(asset)
    return extension ? DISPLAY_BOARD_VIDEO_EXTENSIONS.has(extension) : false
  }
  return false
}

function resolveDisplayBoardDropTarget(event: DragEvent): {
  nodeId: string
  component: SceneNodeComponentState<DisplayBoardComponentProps>
  object: THREE.Object3D
} | null {
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
  const intersections = collectSceneIntersections()
  for (const intersection of intersections) {
    const nodeId = resolveNodeIdFromIntersection(intersection)
    if (!nodeId) {
      continue
    }
    if (sceneStore.isNodeSelectionLocked(nodeId)) {
      continue
    }
    const node = findSceneNode(sceneStore.nodes, nodeId)
    const component = node?.components?.[DISPLAY_BOARD_COMPONENT_TYPE] as
      | SceneNodeComponentState<DisplayBoardComponentProps>
      | undefined
    if (!component) {
      continue
    }
    const targetObject = objectMap.get(nodeId)
    if (!targetObject) {
      continue
    }
    return { nodeId, component, object: targetObject }
  }
  return null
}

function ensureEditablePrimaryMaterial(nodeId: string, material: SceneNodeMaterial | null): string | null {
  if (!material) {
    return null
  }
  if (!material.materialId) {
    return material.id
  }
  const detached = sceneStore.assignNodeMaterial(nodeId, material.id, null)
  if (!detached) {
    return null
  }
  return material.id
}

function applyMaterialAssetToNode(nodeId: string, materialAssetId: string): boolean {
  const sceneNode = findSceneNode(sceneStore.nodes, nodeId)
  if (!nodeSupportsMaterials(sceneNode)) {
    return false
  }
  const materials = Array.isArray(sceneNode?.materials) ? sceneNode.materials : []
  if (materials.length > 0) {
  const primary = materials[0] ?? null
    const editableId = ensureEditablePrimaryMaterial(nodeId, primary)
    if (!editableId) {
      return false
    }
    return sceneStore.assignNodeMaterial(nodeId, editableId, materialAssetId)
  }
  return Boolean(sceneStore.addNodeMaterial(nodeId, { materialId: materialAssetId }))
}

function ensurePrimaryMaterialId(nodeId: string): string | null {
  const sceneNode = findSceneNode(sceneStore.nodes, nodeId)
  if (!nodeSupportsMaterials(sceneNode)) {
    return null
  }
  const materials = Array.isArray(sceneNode?.materials) ? sceneNode.materials : []
  let primary = materials.length > 0 ? materials[0] : null
  if (!primary) {
    const created = sceneStore.addNodeMaterial(nodeId)
    if (!created) {
      return null
    }
    primary = created
  }
  if (!primary) {
    return null
  }
  return ensureEditablePrimaryMaterial(nodeId, primary)
}

function applyTextureAssetToNode(
  nodeId: string,
  assetId: string,
  assetName?: string | null,
  slot: SceneMaterialTextureSlot = 'albedo',
): boolean {
  const materialId = ensurePrimaryMaterialId(nodeId)
  if (!materialId) {
    return false
  }

  const ref: SceneMaterialTextureRef = assetName?.length
    ? { assetId, name: assetName }
    : { assetId }

  const texturesUpdate: Partial<Record<SceneMaterialTextureSlot, SceneMaterialTextureRef | null>> = {
    [slot]: ref,
  }

  sceneStore.updateNodeMaterialProps(nodeId, materialId, { textures: texturesUpdate })

  const updatedNode = findSceneNode(sceneStore.nodes, nodeId)
  const targetMaterial = updatedNode?.materials?.find((entry) => entry.id === materialId) ?? null
  if (!targetMaterial) {
    return false
  }
  if (targetMaterial.textures?.[slot]?.assetId !== assetId) {
    return false
  }

  const targetObject = objectMap.get(nodeId)
  if (targetObject && updatedNode?.materials) {
    applyMaterialOverrides(targetObject, updatedNode.materials, materialOverrideOptions)
  }
  return true
}

type DragAssetInfo = { assetId: string; asset: ProjectAsset | null }

function resolveDragAsset(event: DragEvent): DragAssetInfo | null {
  const payload = extractAssetPayload(event)
  if (!payload) {
    return null
  }
  const assetId = payload.assetId.startsWith('asset://') ? payload.assetId.slice('asset://'.length) : payload.assetId
  return {
    assetId,
    asset: sceneStore.getAsset(assetId),
  }
}

function isTextureAsset(asset: ProjectAsset | null | undefined): boolean {
  if (!asset) {
    return false
  }
  return asset.type === 'texture' || asset.type === 'image'
}

function handleViewportDragEnter(event: DragEvent) {
  if (!isAssetDrag(event)) return
  event.preventDefault()
  isDragHovering.value = true
}

function handleViewportDragOver(event: DragEvent) {
  if (!isAssetDrag(event)) return
  const info = resolveDragAsset(event)
  const asset = info?.asset ?? null
  if (asset?.type === 'material') {
    event.preventDefault()
    isDragHovering.value = true
    const target = resolveMaterialDropTarget(event)
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = target ? 'copy' : 'none'
    }
    if (target) {
      updateGridHighlightFromObject(target.object)
    } else {
      updateGridHighlight(null)
    }
    disposeDragPreview()
    return
  }

  if (asset && asset.type === 'behavior') {
    const target = resolveBehaviorDropTarget(event)
    if (target) {
      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy'
      }
      isDragHovering.value = true
      updateGridHighlightFromObject(target.object)
    } else {
      updateGridHighlight(null)
    }
    disposeDragPreview()
    return
  }

  if (asset && isDisplayBoardCompatibleAsset(asset)) {
    const target = resolveDisplayBoardDropTarget(event)
    if (target) {
      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy'
      }
      isDragHovering.value = true
      updateGridHighlightFromObject(target.object)
      disposeDragPreview()
      return
    }
  }

  if (asset && isTextureAsset(asset)) {
    event.preventDefault()
    isDragHovering.value = true
    const target = resolveMaterialDropTarget(event)
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = target ? 'copy' : 'none'
    }
    if (target) {
      updateGridHighlightFromObject(target.object)
    } else {
      updateGridHighlight(null)
    }
    disposeDragPreview()
    return
  }

  const point = computeDropPoint(event)
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  isDragHovering.value = true
  updateGridHighlight(point, DEFAULT_GRID_HIGHLIGHT_DIMENSIONS)
  setDragPreviewPosition(point)
  if (info) {
    prepareDragPreview(info.assetId)
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
  const info = resolveDragAsset(event)
  event.preventDefault()
  event.stopPropagation()
  isDragHovering.value = false
  disposeDragPreview()
  if (!info) {
    sceneStore.setDraggingAssetObject(null)
    updateGridHighlight(null)
    restoreGridHighlightForSelection()
    return
  }

  const assetId = info.assetId
  const asset = info.asset ?? sceneStore.getAsset(assetId) ?? null
  const assetType = asset?.type ?? null
  const isTexture = assetType === 'texture' || assetType === 'image'

  if (asset && isDisplayBoardCompatibleAsset(asset)) {
    const target = resolveDisplayBoardDropTarget(event)
    if (target) {
      await sceneStore.applyDisplayBoardAsset(target.nodeId, target.component.id, assetId, { updateMaterial: true })
      sceneStore.setDraggingAssetObject(null)
      updateGridHighlight(null)
      restoreGridHighlightForSelection()
      return
    }
  }

  if (assetType === 'material') {
    const target = resolveMaterialDropTarget(event)
    if (!target) {
      console.warn('No compatible mesh found for material drop', assetId)
      sceneStore.setDraggingAssetObject(null)
      updateGridHighlight(null)
      restoreGridHighlightForSelection()
      return
    }
    const applied = applyMaterialAssetToNode(target.nodeId, assetId)
    if (!applied) {
      console.warn('Failed to apply material asset to node', assetId, target.nodeId)
    }
    sceneStore.setDraggingAssetObject(null)
    updateGridHighlight(null)
    restoreGridHighlightForSelection()
    return
  }

  if (assetType === 'behavior') {
    const target = resolveBehaviorDropTarget(event)
    if (!target) {
      console.warn('No scene node found for behavior prefab drop', assetId)
    } else {
      try {
        await sceneStore.applyBehaviorPrefabToNode(target.nodeId, assetId)
      } catch (error) {
        console.warn('Failed to apply behavior prefab to node', assetId, error)
      }
    }
    sceneStore.setDraggingAssetObject(null)
    updateGridHighlight(null)
    restoreGridHighlightForSelection()
    return
  }

  if (isTexture) {
    const target = resolveMaterialDropTarget(event)
    if (!target) {
      console.warn('No compatible mesh found for texture drop', assetId)
      sceneStore.setDraggingAssetObject(null)
      updateGridHighlight(null)
      restoreGridHighlightForSelection()
      return
    }
    const applied = applyTextureAssetToNode(target.nodeId, assetId, asset?.name)
    if (!applied) {
      console.warn('Failed to apply texture asset to node', assetId, target.nodeId)
    } 
    sceneStore.setDraggingAssetObject(null)
    updateGridHighlight(null)
    restoreGridHighlightForSelection()
    return
  }

  const point = computeDropPoint(event)
  const spawnPoint = point ? point.clone() : new THREE.Vector3(0, 0, 0)
  snapVectorToGrid(spawnPoint)
  const parentGroupId = resolveSelectedGroupDropParent()
  try {
    await sceneStore.spawnAssetAtPosition(assetId, spawnPoint, {
      parentId: parentGroupId,
      preserveWorldPosition: Boolean(parentGroupId),
    })
  } catch (error) {
    console.warn('Failed to spawn asset for drag payload', assetId, error)
  } finally {
    sceneStore.setDraggingAssetObject(null)
  }
  updateGridHighlight(null)
  restoreGridHighlightForSelection()
}

function resolveSelectedGroupDropParent(): string | null {
  const selectedId = props.selectedNodeId
  if (!selectedId) {
    return null
  }

  if (sceneStore.isNodeSelectionLocked(selectedId)) {
    return null
  }

  const { nodeMap, parentMap } = buildHierarchyMaps()
  const selectedNode = nodeMap.get(selectedId)
  if (!selectedNode) {
    return null
  }

  const candidateOrder: string[] = []
  if (selectedNode.nodeType === 'Group') {
    candidateOrder.push(selectedId)
  }

  let currentParentId = parentMap.get(selectedId) ?? null
  while (currentParentId) {
    candidateOrder.push(currentParentId)
    currentParentId = parentMap.get(currentParentId) ?? null
  }

  for (const candidateId of candidateOrder) {
    const candidateNode = nodeMap.get(candidateId)
    if (!candidateNode || candidateNode.nodeType !== 'Group') {
      continue
    }
    if (sceneStore.isNodeSelectionLocked(candidateId)) {
      continue
    }
    if (!sceneStore.nodeAllowsChildCreation(candidateId)) {
      continue
    }
    return candidateId
  }

  return null
}

function buildHierarchyMaps(): { nodeMap: Map<string, SceneNode>; parentMap: Map<string, string | null> } {
  const nodeMap = new Map<string, SceneNode>()
  const parentMap = new Map<string, string | null>()

  const traverse = (nodes: SceneNode[] | undefined, parentId: string | null) => {
    if (!nodes?.length) {
      return
    }
    nodes.forEach((node) => {
      nodeMap.set(node.id, node)
      parentMap.set(node.id, parentId)
      if (node.children?.length) {
        traverse(node.children, node.id)
      }
    })
  }

  traverse(sceneStore.nodes, null)

  return { nodeMap, parentMap }
}

function handleTransformChange() {
  if (!transformControls || !isSceneReady.value) return
  const target = transformControls.object as THREE.Object3D | null
  if (!target || !target.userData?.nodeId) {
    return
  }

  const mode = transformControls.getMode()
  const nodeId = target.userData.nodeId as string
  const isTranslateMode = mode === 'translate'
  const isActiveTranslateTool = props.activeTool === 'translate'
  const shouldSnapTranslate = isTranslateMode && !isActiveTranslateTool

  if (isTranslateMode && shouldSnapTranslate) {
    faceSnapManager.hideEffect()
    snapVectorToGridForNode(target.position, nodeId)
  } else if (!isTranslateMode || !isActiveTranslateTool) {
    faceSnapManager.hideEffect()
  }

  target.updateMatrixWorld(true)
  target.getWorldPosition(transformCurrentWorldPosition)

  const groupState = transformGroupState

  if (isTranslateMode && isActiveTranslateTool) {
    transformMovementDelta.set(0, 0, 0)
    if (hasTransformLastWorldPosition) {
      transformMovementDelta.copy(transformCurrentWorldPosition).sub(transformLastWorldPosition)
    }

    const faceSnapExcludedIds = new Set<string>([nodeId])
    if (groupState && groupState.entries.size > 0) {
      groupState.entries.forEach((entry) => faceSnapExcludedIds.add(entry.nodeId))
    }

    faceSnapManager.applyAlignmentSnap(target, transformMovementDelta, faceSnapExcludedIds)
    target.updateMatrixWorld(true)
    target.getWorldPosition(transformCurrentWorldPosition)
  } else {
    hasTransformLastWorldPosition = false
  }

  syncInstancedTransform(target, true)

  const updates: TransformUpdatePayload[] = []
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
          if (shouldSnapTranslate) {
            snapVectorToGridForNode(transformWorldPositionBuffer, entry.nodeId)
          }
          transformLocalPositionHelper.copy(transformWorldPositionBuffer)
          if (entry.parent) {
            entry.parent.worldToLocal(transformLocalPositionHelper)
          }
          entry.object.position.copy(transformLocalPositionHelper)
          entry.object.updateMatrixWorld(true)
          syncInstancedTransform(entry.object, true)
        })
        if (isActiveTranslateTool) {
          transformLastWorldPosition.copy(transformCurrentWorldPosition)
          hasTransformLastWorldPosition = true
        }
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
          syncInstancedTransform(entry.object, true)
        })
        hasTransformLastWorldPosition = false
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
          syncInstancedTransform(entry.object, true)
        })
        hasTransformLastWorldPosition = false
        break
      }
      default:
        break
    }

    groupState.entries.forEach((entry) => {
      updates.push({
        id: entry.nodeId,
        position: entry.object.position,
        rotation: toEulerLike(entry.object.rotation),
        scale: entry.object.scale,
      })
    })
  } else {
    if (isTranslateMode && isActiveTranslateTool) {
      transformLastWorldPosition.copy(transformCurrentWorldPosition)
      hasTransformLastWorldPosition = true
    }
    updates.push({
      id: nodeId,
      position: target.position,
      rotation: toEulerLike(target.rotation),
      scale: target.scale,
    })
  }

  updateGridHighlightFromObject(target)
  updateSelectionHighlights()

  if (!updates.length) {
    return
  }

  if (transformControls?.dragging) {
    transformControlsDirty = true
    return
  }

  if (transformControlsDirty) {
    return
  }

  emitTransformUpdates(updates)

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
  const nodeType = node.nodeType ?? (node.light ? 'Light' : 'Mesh')
  const userData = object.userData ?? (object.userData = {})

  userData.nodeId = node.id
  userData.nodeType = nodeType
  userData.dynamicMeshType = node.dynamicMesh?.type ?? null
  userData.lightType = node.light?.type ?? null
  userData.sourceAssetId = node.sourceAssetId ?? null
  const runtimeBackedType = usesRuntimeObjectTypes.has(nodeType)
  const hasRuntimeObject = runtimeBackedType ? sceneStore.hasRuntimeObject(node.id) : false
  userData.usesRuntimeObject = hasRuntimeObject

  object.name = node.name
  object.position.set(node.position.x, node.position.y, node.position.z)
  object.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z)
  object.scale.set(node.scale.x, node.scale.y, node.scale.z)
  object.visible = node.visible ?? true
  if (object.userData?.instancedAssetId) {
    ensureInstancedPickProxy(object, node)
  } else {
    removeInstancedPickProxy(object)
  }
  applyViewPointScaleConstraint(object, node)

  const hasChildNodes = Array.isArray(node.children) && node.children.length > 0
  syncInstancedTransform(object, hasChildNodes)

  if (node.dynamicMesh?.type === 'Ground') {
    const groundMesh = userData.groundMesh as THREE.Mesh | undefined
    if (groundMesh) {
      const meshData = groundMesh.userData ?? (groundMesh.userData = {})
      const nextSignature = computeGroundDynamicMeshSignature(node.dynamicMesh)
      if (meshData[DYNAMIC_MESH_SIGNATURE_KEY] !== nextSignature) {
        updateGroundMesh(groundMesh, node.dynamicMesh)
        meshData[DYNAMIC_MESH_SIGNATURE_KEY] = nextSignature
      }
    }
  } else if (node.dynamicMesh?.type === 'Wall') {
    const wallGroup = userData.wallGroup as THREE.Group | undefined
    if (wallGroup) {
      const groupData = wallGroup.userData ?? (wallGroup.userData = {})
      const nextSignature = computeWallDynamicMeshSignature(node.dynamicMesh as WallDynamicMesh)
      if (groupData[DYNAMIC_MESH_SIGNATURE_KEY] !== nextSignature) {
        updateWallGroup(wallGroup, node.dynamicMesh as WallDynamicMesh)
        groupData[DYNAMIC_MESH_SIGNATURE_KEY] = nextSignature
      }
    }
  } else if (node.dynamicMesh?.type === 'Surface') {
    const surfaceMesh = userData.surfaceMesh as THREE.Mesh | undefined
    if (surfaceMesh) {
      const meshData = surfaceMesh.userData ?? (surfaceMesh.userData = {})
      const nextSignature = computeSurfaceDynamicMeshSignature(node.dynamicMesh as SurfaceDynamicMesh)
      if (meshData[DYNAMIC_MESH_SIGNATURE_KEY] !== nextSignature) {
        updateSurfaceMesh(surfaceMesh, node.dynamicMesh as SurfaceDynamicMesh)
        meshData[DYNAMIC_MESH_SIGNATURE_KEY] = nextSignature
      }
    }
  }

  if (node.materials && node.materials.length) {
    applyMaterialOverrides(object, node.materials, materialOverrideOptions)
  } else {
    resetMaterialOverrides(object)
  }

  if (nodeType === 'WarpGate' && !hasRuntimeObject) {
    applyWarpGatePlaceholderState(object, node)
  }

  if (nodeType === 'Guideboard' && !hasRuntimeObject) {
    applyGuideboardPlaceholderState(object, node)
  }

  if (nodeType === 'Light') {
    updateLightObjectProperties(object, node)
  }
}

// Ensures editor-only view point markers keep a consistent world-space scale.
function applyViewPointScaleConstraint(object: THREE.Object3D, node: SceneNode) {
  const flags = node.editorFlags ?? null
  const viewPointComponent = node.components?.[VIEW_POINT_COMPONENT_TYPE] as
    | SceneNodeComponentState<ViewPointComponentProps>
    | undefined
  const hasEnabledComponent = viewPointComponent?.enabled === true
  const isViewPointCandidate =
    hasEnabledComponent ||
    Boolean(object.userData?.viewPoint) ||
    (flags?.editorOnly && flags?.ignoreGridSnapping && node.nodeType === 'Sphere')

  if (!isViewPointCandidate) {
    return
  }

  const maybeTargets: THREE.Object3D[] = []
  if (hasEnabledComponent && !maybeTargets.includes(object)) {
    maybeTargets.push(object)
  }
  if (object.userData?.viewPoint && !maybeTargets.includes(object)) {
    maybeTargets.push(object)
  }
  object.traverse((child) => {
    if (child.userData?.viewPoint && !maybeTargets.includes(child)) {
      maybeTargets.push(child)
    }
  })

  if (!maybeTargets.length) {
    maybeTargets.push(object)
  }

  const nodeScale = node.scale ?? { x: 1, y: 1, z: 1 }
  viewPointNodeScaleHelper.set(nodeScale.x ?? 1, nodeScale.y ?? 1, nodeScale.z ?? 1)

  maybeTargets.forEach((target) => {
    const baseScaleData = target.userData?.viewPointBaseScale as { x?: number; y?: number; z?: number } | undefined
    const baseX = typeof baseScaleData?.x === 'number' && Number.isFinite(baseScaleData.x) ? baseScaleData.x : 1
    const baseY = typeof baseScaleData?.y === 'number' && Number.isFinite(baseScaleData.y) ? baseScaleData.y : 1
    const baseZ = typeof baseScaleData?.z === 'number' && Number.isFinite(baseScaleData.z) ? baseScaleData.z : 1

    viewPointScaleHelper.set(baseX, baseY, baseZ)

    viewPointScaleHelper.multiply(viewPointNodeScaleHelper)

    const parent = target.parent
    if (parent) {
      parent.updateMatrixWorld(true)
      parent.getWorldScale(viewPointParentScaleHelper)
    } else {
      viewPointParentScaleHelper.set(1, 1, 1)
    }

    const clampAxis = (value: number) => {
      const magnitude = Math.max(Math.abs(value), 1e-6)
      return magnitude * Math.sign(value || 1)
    }

    const parentScaleX = clampAxis(viewPointParentScaleHelper.x)
    const parentScaleY = clampAxis(viewPointParentScaleHelper.y)
    const parentScaleZ = clampAxis(viewPointParentScaleHelper.z)

    viewPointScaleHelper.set(
      viewPointScaleHelper.x / parentScaleX,
      viewPointScaleHelper.y / parentScaleY,
      viewPointScaleHelper.z / parentScaleZ,
    )

    target.scale.copy(viewPointScaleHelper)
  })
}

function shouldRecreateNode(object: THREE.Object3D, node: SceneNode): boolean {
  const nodeType = node.nodeType ?? (node.light ? 'Light' : 'Mesh')
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
  const expectsRuntime = usesRuntimeObjectTypes.has(nodeType) ? sceneStore.hasRuntimeObject(node.id)  : false
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
      if (child.userData?.dynamicMeshType === 'Ground') {
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
    releaseInstancedOutlineEntry(nodeId)
    unregisterLightHelpersForNode(nodeId)
  }

  object.removeFromParent()

  const isGroundMesh = object.userData?.dynamicMeshType === 'Ground'
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
  } else{
    if (object.parent !== parent) {
      parent.add(object)
    }
    updateNodeObject(object, node)
  }
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
  updateOutlineSelectionTargets()

  refreshPlaceholderOverlays()
  ensureFallbackLighting()
  refreshEffectRuntimeTickers()
  updateSelectionHighlights()
}

function disposeSceneNodes() {
  clearOutlineSelectionTargets()
  clearLightHelpers()
  const nodeIds = Array.from(objectMap.keys())
  nodeIds.forEach((id) => {
    if (objectMap.has(id)) {
      disposeNodeSubtree(id)
    }
  })
  resetEffectRuntimeTickers()
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
    case 'Directional': {
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
  case 'Point': {
      const point = new THREE.PointLight(config.color, config.intensity, config.distance ?? 0, config.decay ?? 1)
      point.castShadow = config.castShadow ?? false
      light = point
      helper = new THREE.PointLightHelper(point, POINT_LIGHT_HELPER_SIZE, config.color)
      break
    }
  case 'Spot': {
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
  case 'Ambient':
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
    fallbackLightGroup.add(ambient)
    if (!sunDirectionalLight && !isSunLightSuppressed) {
      const directional = new THREE.DirectionalLight(0xffffff, FALLBACK_DIRECTIONAL_INTENSITY)
      directional.castShadow = true
      directional.shadow.mapSize.set(FALLBACK_DIRECTIONAL_SHADOW_MAP_SIZE, FALLBACK_DIRECTIONAL_SHADOW_MAP_SIZE)
      directional.shadow.normalBias = 0.02
      directional.shadow.bias = -0.0001
      directional.target.position.set(0, 0, 0)
      fallbackLightGroup.add(directional)
      fallbackLightGroup.add(directional.target)
      fallbackDirectionalLight = directional
    }
    applySunDirectionToFallbackLight()
  }
}


function resolveWarpGateProps(node: SceneNode): WarpGateComponentProps {
  const entry = node.components?.[WARP_GATE_COMPONENT_TYPE] as
    | SceneNodeComponentState<WarpGateComponentProps>
    | undefined
  if (!entry) {
    return clampWarpGateComponentProps(null)
  }
  if (entry.enabled === false) {
    const defaults = clampWarpGateComponentProps(null)
    return {
      ...defaults,
      showBeams: false,
      showParticles: false,
      showRings: false,
      intensity: 0,
    }
  }
  return clampWarpGateComponentProps(entry.props)
}

function createWarpGatePlaceholderObject(node: SceneNode): THREE.Object3D {
  // Lightweight preview used when no runtime warp gate object exists yet.
  const root = new THREE.Group()
  root.name = node.name ?? 'Warp Gate'
  root.castShadow = false
  root.receiveShadow = false

  const props = resolveWarpGateProps(node)
  const controller = createWarpGateEffectInstance(props)
  controller.group.removeFromParent()
  root.add(controller.group)

  const userData = root.userData ?? (root.userData = {})
  userData.warpGate = true
  userData.warpGatePlaceholder = true
  const handle: WarpGatePlaceholderHandle = { controller }
  userData[WARP_GATE_PLACEHOLDER_KEY] = handle

  applyWarpGatePlaceholderState(root, node, props)

  return root
}

function applyWarpGatePlaceholderState(
  object: THREE.Object3D,
  node: SceneNode,
  providedProps?: WarpGateComponentProps,
): void {
  const handle = object.userData?.[WARP_GATE_PLACEHOLDER_KEY] as WarpGatePlaceholderHandle | undefined
  if (!handle?.controller) {
    return
  }

  const props = providedProps ?? resolveWarpGateProps(node)
  handle.controller.update(props)

  const userData = object.userData ?? (object.userData = {})
  userData.warpGatePlaceholder = true

  const componentEntry = node.components?.[WARP_GATE_COMPONENT_TYPE] as
    | SceneNodeComponentState<WarpGateComponentProps>
    | undefined
  const enabled = componentEntry?.enabled !== false

  if (!enabled) {
    delete userData.warpGate
    delete userData[WARP_GATE_EFFECT_METADATA_KEY]
    if (WARP_GATE_EFFECT_ACTIVE_FLAG in userData) {
      delete userData[WARP_GATE_EFFECT_ACTIVE_FLAG]
    }
    userData.warpGateVisible = false
    return
  }

  const active = computeWarpGateEffectActive(props)
  userData.warpGate = true
  userData.warpGateVisible = active
  userData[WARP_GATE_EFFECT_ACTIVE_FLAG] = active
  userData[WARP_GATE_EFFECT_METADATA_KEY] = cloneWarpGateComponentProps(props)
}

function resolveGuideboardProps(node: SceneNode): GuideboardComponentProps {
  const entry = node.components?.[GUIDEBOARD_COMPONENT_TYPE] as
    | SceneNodeComponentState<GuideboardComponentProps>
    | undefined
  if (!entry) {
    return clampGuideboardComponentProps(null)
  }
  if (entry.enabled === false) {
    const defaults = clampGuideboardComponentProps(null)
    return {
      ...defaults,
      initiallyVisible: false,
      glowIntensity: 0,
      pulseSpeed: 0,
      pulseStrength: 0,
    }
  }
  return clampGuideboardComponentProps(entry.props)
}

function createGuideboardPlaceholderObject(node: SceneNode): THREE.Object3D {
  const root = new THREE.Group()
  root.name = node.name ?? 'Guideboard'
  root.castShadow = false
  root.receiveShadow = false

  const userData = root.userData ?? (root.userData = {})
  userData.guideboardPlaceholder = true

  const props = resolveGuideboardProps(node)
  const controller = createGuideboardEffectInstance(props)
  controller.group.removeFromParent()
  root.add(controller.group)

  const handle: GuideboardPlaceholderHandle = { controller }
  userData[GUIDEBOARD_PLACEHOLDER_KEY] = handle

  applyGuideboardPlaceholderState(root, node, props)

  return root
}

function applyGuideboardPlaceholderState(
  object: THREE.Object3D,
  node: SceneNode,
  providedProps?: GuideboardComponentProps,
): void {
  const handle = object.userData?.[GUIDEBOARD_PLACEHOLDER_KEY] as GuideboardPlaceholderHandle | undefined
  const controller = handle?.controller ?? null
  if (!controller) {
    return
  }

  const props = providedProps ?? resolveGuideboardProps(node)
  const componentEntry = node.components?.[GUIDEBOARD_COMPONENT_TYPE] as
    | SceneNodeComponentState<GuideboardComponentProps>
    | undefined
  const enabled = componentEntry?.enabled !== false

  const userData = object.userData ?? (object.userData = {})
  userData.guideboardPlaceholder = true

  if (!enabled) {
    object.visible = false
    delete userData.guideboard
    delete userData[GUIDEBOARD_EFFECT_METADATA_KEY]
    if (GUIDEBOARD_EFFECT_ACTIVE_FLAG in userData) {
      delete userData[GUIDEBOARD_EFFECT_ACTIVE_FLAG]
    }
    controller.group.visible = false
    return
  }

  const nodeVisibility = node.visible ?? true
  const active = computeGuideboardEffectActive(props)
  // Keep guideboards visible while editing so artists can position them even if they start hidden in preview
  object.visible = nodeVisibility

  controller.update(props)
  controller.group.visible = active

  userData.guideboard = true
  userData[GUIDEBOARD_EFFECT_METADATA_KEY] = cloneGuideboardComponentProps(props)
  userData[GUIDEBOARD_EFFECT_ACTIVE_FLAG] = active
}

function createObjectFromNode(node: SceneNode): THREE.Object3D {
  let object: THREE.Object3D

  const nodeType = node.nodeType ?? (node.light ? 'Light' : 'Mesh')

  if (nodeType === 'Light') {
    object = createLightObject(node)
    object.name = node.name
  } else if (nodeType === 'Mesh') {
    const container = new THREE.Group()
    container.name = node.name
    const containerData = container.userData ?? (container.userData = {})
    containerData.nodeId = node.id

    if (node.dynamicMesh?.type === 'Ground') {
      const groundMesh = createGroundMesh(node.dynamicMesh)
      groundMesh.removeFromParent()
      groundMesh.userData.nodeId = node.id
      groundMesh.userData[DYNAMIC_MESH_SIGNATURE_KEY] = computeGroundDynamicMeshSignature(node.dynamicMesh)
      container.add(groundMesh)
      containerData.groundMesh = groundMesh
      containerData.dynamicMeshType = 'Ground'
    } else if (node.dynamicMesh?.type === 'Wall') {
      const wallDefinition = node.dynamicMesh as WallDynamicMesh
      const wallGroup = createWallGroup(wallDefinition)
      wallGroup.userData.nodeId = node.id
      wallGroup.userData[DYNAMIC_MESH_SIGNATURE_KEY] = computeWallDynamicMeshSignature(wallDefinition)
      container.add(wallGroup)
      containerData.wallGroup = wallGroup
      containerData.dynamicMeshType = 'Wall'
    } else if (node.dynamicMesh?.type === 'Surface') {
      const surfaceDefinition = node.dynamicMesh as SurfaceDynamicMesh
      const surfaceMesh = createSurfaceMesh(surfaceDefinition)
      surfaceMesh.userData.nodeId = node.id
      surfaceMesh.userData[DYNAMIC_MESH_SIGNATURE_KEY] = computeSurfaceDynamicMeshSignature(surfaceDefinition)
      container.add(surfaceMesh)
      containerData.surfaceMesh = surfaceMesh
      containerData.dynamicMeshType = 'Surface'
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
    registerRuntimeObject(node.id, container)
  } else if (nodeType === 'Camera') {
    const perspective = node.camera
    const perspectiveCamera = new THREE.PerspectiveCamera(
      perspective?.fov ?? 50,
      perspective?.aspect ?? 1,
      perspective?.near ?? 0.1,
      perspective?.far ?? 2000,
    )
    perspectiveCamera.name = node.name
    perspectiveCamera.userData.nodeId = node.id
    object = perspectiveCamera
  } else if (nodeType === 'Sky' || nodeType === 'Environment') {
    let container = getRuntimeObject(node.id)
    if (container !== null) {
      container.userData.usesRuntimeObject = true
    } else {
      container = new THREE.Group()
      container.name = node.name
    }
    container.userData.nodeId = node.id
    object = container
    registerRuntimeObject(node.id, container)
  } else if (nodeType === 'Group') {
    let container = getRuntimeObject(node.id)
    if (container !== null) {
      container.userData.usesRuntimeObject = true
    } else {
      container = new THREE.Group()
      container.name = node.name
    }
    container.userData.nodeId = node.id
    object = container
    registerRuntimeObject(node.id, container)
  } else if (nodeType === 'WarpGate') {
    const runtimeObject = getRuntimeObject(node.id)
    if (runtimeObject) {
      runtimeObject.userData.usesRuntimeObject = true
      object = runtimeObject
    } else {
      object = createWarpGatePlaceholderObject(node)
      registerRuntimeObject(node.id, object)
    }
  } else if (nodeType === 'Guideboard') {
    const runtimeObject = getRuntimeObject(node.id)
    if (runtimeObject) {
      runtimeObject.userData.usesRuntimeObject = true
      object = runtimeObject
    } else {
      object = createGuideboardPlaceholderObject(node)
      registerRuntimeObject(node.id, object)
    }
  } else {
    let container = getRuntimeObject(node.id)
    if (container !== null) {
      container.userData.usesRuntimeObject = true
    } else {
      container = createPrimitiveMesh(nodeType)
      container.name = node.name
      registerRuntimeObject(node.id, container)
    }
    container.userData.nodeId = node.id
    object = container

  }

  object.position.set(node.position.x, node.position.y, node.position.z)
  object.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z)
  object.scale.set(node.scale.x, node.scale.y, node.scale.z)
  objectMap.set(node.id, object)

  applyViewPointScaleConstraint(object, node)

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
  userData.usesRuntimeObject = sceneStore.hasRuntimeObject(node.id)

  const isVisible = node.visible ?? true
  object.visible = isVisible

  if (object.userData?.instancedAssetId) {
    ensureInstancedPickProxy(object, node)
  } else {
    removeInstancedPickProxy(object)
  }

  if (node.materials && node.materials.length) {
    applyMaterialOverrides(object, node.materials, materialOverrideOptions)
  } else {
    resetMaterialOverrides(object)
  }

  if (nodeType === 'WarpGate' && !sceneStore.hasRuntimeObject(node.id)) {
    applyWarpGatePlaceholderState(object, node)
  } else if (nodeType === 'Guideboard' && !sceneStore.hasRuntimeObject(node.id)) {
    applyGuideboardPlaceholderState(object, node)
  }

  syncInstancedTransform(object)

  return object
}

function applyTransformSpace(tool: EditorTool) {
  if (!transformControls) {
    return
  }
  const nextSpace = tool === 'rotate' ? 'world' : 'local'
  transformControls.setSpace(nextSpace)
}

function attachSelection(nodeId: string | null, tool: EditorTool = props.activeTool) {
  const locked = nodeId ? sceneStore.isNodeSelectionLocked(nodeId) : false
  const target = !locked && nodeId ? objectMap.get(nodeId) ?? null : null
  updateOutlineSelectionTargets()

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
  // 根据当前工具选择合适的变换坐标系
  applyTransformSpace(tool)
  transformControls.setMode(tool)
  transformControls.attach(target)
}


function updateToolMode(tool: EditorTool) {
  if (!transformControls) return

  transformControls.enabled = tool !== 'select'

  if (tool === 'select') {
    transformControls.detach()
  } else {
    applyTransformSpace(tool)
    transformControls.setMode(tool)
  }

  if (props.selectedNodeId) {
    attachSelection(props.selectedNodeId, tool)
  } else {
    updateGridHighlight(null)
  }
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
        if (scatterEraseModeActive.value) {
          exitScatterEraseMode()
          handled = true
          break
        }
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
  updateToolMode(props.activeTool)
  attachSelection(props.selectedNodeId)
  updateOutlineSelectionTargets()
  updateSelectionHighlights()
  window.addEventListener('keyup', handleViewportShortcut, { capture: true })
  window.addEventListener('keydown', handleAltOverrideKeyDown, { capture: true })
  window.addEventListener('keyup', handleAltOverrideKeyUp, { capture: true })
  window.addEventListener('blur', handleAltOverrideBlur, { capture: true })
  window.addEventListener('keydown', faceSnapManager.handleKeyDown, { capture: true })
  window.addEventListener('keyup', faceSnapManager.handleKeyUp, { capture: true })
  window.addEventListener('blur', faceSnapManager.handleBlur, { capture: true })
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', handleViewportOverlayResize, { passive: true })
  }
  scheduleToolbarUpdate()
  if (viewportEl.value && typeof ResizeObserver !== 'undefined') {
    viewportResizeObserver = new ResizeObserver(() => scheduleToolbarUpdate())
    viewportResizeObserver.observe(viewportEl.value)
  }
  sceneStore.ensureCurrentSceneLoaded({ skipComponentSync: true });
})

onBeforeUnmount(() => {
  if (nodePickerStore.isActive) {
    nodePickerStore.cancelActivePick('user')
  }
  disposeGroundEditor()
  groundTextureInputRef.value = null
  disposeSceneNodes()
  disposeScene()
  disposeCachedTextures()
  window.removeEventListener('keyup', handleViewportShortcut, { capture: true })
  window.removeEventListener('keydown', handleAltOverrideKeyDown, { capture: true })
  window.removeEventListener('keyup', handleAltOverrideKeyUp, { capture: true })
  window.removeEventListener('blur', handleAltOverrideBlur, { capture: true })
  window.removeEventListener('keydown', faceSnapManager.handleKeyDown, { capture: true })
  window.removeEventListener('keyup', faceSnapManager.handleKeyUp, { capture: true })
  window.removeEventListener('blur', faceSnapManager.handleBlur, { capture: true })
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', handleViewportOverlayResize)
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
  cancelSurfaceBuildSession()
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

    if (sceneStore.isSceneReady) {
      syncSceneGraph()
    }
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

// watch(
//   () => sceneStore.currentSceneId,
//   () => {
//     sceneStore.ensureCurrentSceneLoaded().then(() => {
//       syncSceneGraph()
//     })
//   }
// )
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

watch(
  () => nodePickerStore.isActive,
  (active) => {
    if (!active) {
      hideNodePickerHighlight()
    }
  },
)

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
    updateOutlineSelectionTargets()
    updateSelectionHighlights()
    refreshEffectRuntimeTickers()
  }
)

watch(
  () => sceneStore.selectedNodeIds.slice(),
  () => {
    updateOutlineSelectionTargets()
    updateSelectionHighlights()
    refreshEffectRuntimeTickers()
  }
)

watch(selectedNodeIsGround, (isGround) => {
  if (!isGround) {
    exitScatterEraseMode()
  }
})

watch(
  () => groundPanelTab.value,
  (tab) => {
    if (tab !== 'terrain') {
      exitScatterEraseMode()
      cancelGroundEditorScatterPlacement()
      handleBuildToolChange(null)
      return
    }
    cancelGroundEditorScatterPlacement()
  },
)

watch(
  () => props.activeTool,
  (tool) => {
    updateToolMode(tool)
    if (tool !== 'translate') {
      faceSnapManager.setCommitActive(false)
      faceSnapManager.hideEffect()
    }
  }
)

watch(activeBuildTool, (tool) => {
  handleGroundEditorBuildToolChange(tool)
  if (tool !== 'wall') {
    cancelWallDrag()
    clearWallBuildSession()
    restoreOrbitAfterWallBuild()
  }
  if (tool !== 'surface') {
    cancelSurfaceBuildSession()
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

watch(
  () => props.highlightRequestId,
  (token, previous) => {
    if (!props.highlightNodeId) {
      return
    }
    if (typeof token !== 'number' || token === 0) {
      return
    }
    if (token === previous) {
      return
    }
    triggerNodeFlash(props.highlightNodeId, token)
  }
)

watch(
  () => props.highlightNodeId,
  (nodeId) => {
    if (!nodeId) {
      clearNodeFlashTimers()
      hideNodeFlashIndicator()
      nodeFlashActiveToken = null
    }
  }
)

defineExpose<SceneViewportHandle>({
  captureScreenshot
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
        :camera-control-mode="cameraControlMode"
        :can-drop-selection="canDropSelection"
        :can-align-selection="canAlignSelection"
        :can-rotate-selection="canRotateSelection"
        :can-erase-scatter="selectedNodeIsGround"
        :scatter-erase-mode-active="scatterEraseModeActive"
        :active-build-tool="activeBuildTool"
        @reset-camera="resetCameraView"
        @drop-to-ground="dropSelectionToGround"
        @align-selection="handleAlignSelection"
        @rotate-selection="handleRotateSelection"
        @capture-screenshot="handleCaptureScreenshot"
        @toggle-camera-control="handleToggleCameraControlMode"
        @change-build-tool="handleBuildToolChange"
        @toggle-scatter-erase="toggleScatterEraseMode"
      />
    </div>
    <div ref="gizmoContainerRef" class="viewport-gizmo-container"></div>
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
        <PlaceholderOverlayList :overlays="placeholderOverlayList" />
      </div>
        <div v-show="showProtagonistPreview" class="protagonist-preview">
          <span class="protagonist-preview__label">主角视野</span>
        </div>
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

.viewport-gizmo-container {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 70px;
  height: 70px;
  z-index: 7;
}

.stats-host {
  position: absolute;
  top: 12px;
  right: 12px;
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

.protagonist-preview {
  position: absolute;
  bottom: 16px;
  right: 16px;
  width: 240px;
  height: 140px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.45);
  pointer-events: none;
  overflow: hidden;
  z-index: 9;
}

.protagonist-preview__label {
  position: absolute;
  top: 8px;
  left: 12px;
  padding: 2px 8px;
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(0, 0, 0, 0.5);
  border-radius: 4px;
  text-transform: uppercase;
  pointer-events: none;
}

.ground-texture-input {
  display: none;
}
</style>
