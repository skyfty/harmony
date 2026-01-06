<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import * as THREE from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { useViewportPostprocessing } from './useViewportPostprocessing'
import { useDragPreview } from './useDragPreview'
import { useProtagonistPreview } from './useProtagonistPreview'
import { createNormalizedPointerGuard } from './normalizedPointerGuard'
import { createPointerCaptureGuard } from './pointerCaptureGuard'
import { usePointerInteractionStateMachine } from './usePointerInteractionStateMachine'

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
  RoadDynamicMesh,
  FloorDynamicMesh,
  GuideRouteDynamicMesh,
} from '@harmony/schema'
import {
  applyMaterialOverrides,
  applyMaterialConfigToMaterial,
  disposeMaterialOverrides,
  resetMaterialOverrides,
  type MaterialTextureAssignmentOptions,
} from '@/types/material'
import {
  useSceneStore,
  getRuntimeObject,
  registerRuntimeObject,
  ENVIRONMENT_NODE_ID,
} from '@/stores/sceneStore'
import { useNodePickerStore } from '@/stores/nodePickerStore'
import type { ProjectAsset } from '@/types/project-asset'
import type { SceneCameraState } from '@/types/scene-camera-state'

import type { EditorTool } from '@/types/editor-tool'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import {
  getCachedModelObject,
  getOrLoadModelObject,
  allocateModelInstance,
  releaseModelInstance,
  ensureInstancedMeshesRegistered,
  subscribeInstancedMeshes,
  getModelInstanceBindingById,
  findBindingIdForInstance,
  findNodeIdForInstance,
} from '@schema/modelObjectCache'
import {
  buildContinuousInstancedModelUserDataPatch,
  buildContinuousInstancedModelUserDataPatchV2,
  buildLinearLocalPositions,
  clearContinuousInstancedModelPreview,
  computeDefaultInstancedSpacing,
  getContinuousInstancedModelUserData,
  syncContinuousInstancedModelCommitted,
  syncContinuousInstancedModelPreviewRange,
} from '@schema/continuousInstancedModel'
import { loadObjectFromFile } from '@schema/assetImport'
import { createInstancedBvhFrustumCuller } from '@schema/instancedBvhFrustumCuller'
import {createPrimitiveMesh}  from '@harmony/schema'


import type { TransformUpdatePayload } from '@/types/transform-update-payload'
import { cloneSkyboxSettings } from '@/stores/skyboxPresets'
import { createRoadNodeMaterials } from '@/utils/roadNodeMaterials'
import type { PanelPlacementState } from '@/types/panel-placement-state'
import ViewportToolbar from './ViewportToolbar.vue'
import TransformToolbar from './TransformToolbar.vue'
import PlaceholderOverlayList from './PlaceholderOverlayList.vue'
import { createGroundEditor } from './GroundEditor'
import { TRANSFORM_TOOLS } from '@/types/scene-transform-tools'
import { type AlignMode } from '@/types/scene-viewport-align-mode'
import { Sky } from 'three/addons/objects/Sky.js'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import type { NodeHitResult } from '@/types/scene-viewport-node-hit-result'
import type { PointerTrackingState } from '@/types/scene-viewport-pointer-tracking-state'
import type { TransformGroupEntry, TransformGroupState } from '@/types/scene-viewport-transform-group'
import type { BuildTool } from '@/types/build-tool'
import {
  createGroundMesh,
  updateGroundChunks,
  updateGroundMesh,
  releaseGroundMeshCache,
  sampleGroundHeight,
} from '@schema/groundMesh'
import { createRoadGroup, updateRoadGroup } from '@schema/roadMesh'
import { createFloorGroup, updateFloorGroup } from '@schema/floorMesh'
import { createGuideRouteGroup, updateGuideRouteGroup } from '@schema/guideRouteMesh'
import { useTerrainStore } from '@/stores/terrainStore'
import { hashString, stableSerialize } from '@schema/stableSerialize'
import { ViewportGizmo } from '@/utils/gizmo/ViewportGizmo'
import { TerrainGridHelper } from './TerrainGridHelper'
import { useTerrainGridController } from './useTerrainGridController'
import { createWallBuildTool } from './WallBuildTool'
import { createRoadBuildTool } from './RoadBuildTool'
import { createFloorBuildTool } from './FloorBuildTool'
import {
  createRoadVertexRenderer,
  ROAD_VERTEX_HANDLE_GROUP_NAME,
  ROAD_VERTEX_HANDLE_Y,
  type RoadVertexHandlePickResult,
} from './RoadVertexRenderer'
import {
  VIEW_POINT_COMPONENT_TYPE,
  DISPLAY_BOARD_COMPONENT_TYPE,
  WARP_GATE_COMPONENT_TYPE,
  GUIDEBOARD_COMPONENT_TYPE,
  WALL_COMPONENT_TYPE,
  WALL_DEFAULT_HEIGHT,
  WALL_DEFAULT_WIDTH,
  WALL_DEFAULT_THICKNESS,
  WALL_MIN_HEIGHT,
  WALL_MIN_WIDTH,
  WALL_MIN_THICKNESS,
  ROAD_DEFAULT_WIDTH,
  ROAD_DEFAULT_JUNCTION_SMOOTHING,
  ROAD_COMPONENT_TYPE,
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
  LOD_COMPONENT_TYPE,
  clampLodComponentProps,
  clampWallProps,
  GUIDE_ROUTE_COMPONENT_TYPE,
  clampGuideRouteComponentProps,
} from '@schema/components'
import type {
  ViewPointComponentProps,
  DisplayBoardComponentProps,
  GuideboardComponentProps,
  WarpGateComponentProps,
  WallComponentProps,
  RoadComponentProps,
  WarpGateEffectInstance,
  GuideboardEffectInstance,
  LodComponentProps,
  GuideRouteComponentProps,
} from '@schema/components'
import type { EnvironmentSettings } from '@/types/environment'
import { createEffectPlaybackManager } from './effectPlaybackManager'
import { usePlaceholderOverlayController } from './placeholderOverlayController'
import { useToolbarPositioning } from './useToolbarPositioning'
import { useScenePicking } from './useScenePicking'
import { createPickProxyManager } from './PickProxyManager'
import { createInstancedOutlineManager } from './InstancedOutlineManager'
import { createWallRenderer,applyAirWallVisualToWallGroup } from './WallRenderer'
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
  GRID_SNAP_SPACING,
  WALL_DIAGONAL_SNAP_THRESHOLD,
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

const { panelVisibility, isSceneReady, sceneGraphStructureVersion, sceneNodePropertyVersion } = storeToRefs(sceneStore)
const { brushRadius, brushStrength, brushShape, brushOperation, groundPanelTab, scatterCategory, scatterSelectedAsset, scatterBrushRadius, scatterEraseRadius } =
  storeToRefs(terrainStore)

const groundTerrainScatterUpdatedAt = computed(() => {
  const ground = findSceneNode(sceneStore.nodes, GROUND_NODE_ID)
  if (!ground || ground.dynamicMesh?.type !== 'Ground') {
    return null
  }
  const snapshot = (ground.dynamicMesh as any).terrainScatter as { metadata?: { updatedAt?: unknown } } | null | undefined
  const updatedAt = snapshot?.metadata?.updatedAt
  const value = typeof updatedAt === 'number' ? updatedAt : Number(updatedAt)
  return Number.isFinite(value) ? value : null
})

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

const instancedOutlineManager = createInstancedOutlineManager({ outlineGroup: instancedOutlineGroup })
const createInstancedOutlineProxy = instancedOutlineManager.createInstancedProxy
const updateInstancedOutlineEntry = instancedOutlineManager.updateInstancedOutlineEntry
const syncInstancedOutlineEntryTransform = (nodeId: string) => {
  const object = objectMap.get(nodeId) ?? null
  const { needsRebuild } = instancedOutlineManager.syncInstancedOutlineEntryTransform(nodeId, object)
  if (needsRebuild) {
    updateOutlineSelectionTargets()
  }
}
const releaseInstancedOutlineEntry = (nodeId: string, shouldUpdateOutline = true) => {
  instancedOutlineManager.releaseInstancedOutlineEntry(nodeId)
  if (shouldUpdateOutline) {
    updateOutlineSelectionTargets()
  }
}
const clearInstancedOutlineEntries = () => {
  instancedOutlineManager.clearInstancedOutlineEntries()
}

const instancedHoverMaterial = new THREE.MeshBasicMaterial({
  color: 0x4dd0e1,
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
  depthTest: false,
})
instancedHoverMaterial.toneMapped = false

const { ensureInstancedPickProxy, removeInstancedPickProxy } = createPickProxyManager()

let scene: THREE.Scene | null = null
let renderer: THREE.WebGLRenderer | null = null
let camera: THREE.PerspectiveCamera | null = null
let perspectiveCamera: THREE.PerspectiveCamera | null = null
let mapControls: MapControls | null = null
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
let latestFogSettings: EnvironmentSettings | null = null
let shouldRenderSkyBackground = true
let sky: Sky | null = null
let resizeObserver: ResizeObserver | null = null

const normalizedPointerGuard = createNormalizedPointerGuard({
  getCanvas: () => canvasRef.value,
  getCamera: () => camera,
  raycaster,
  pointer,
})

const pointerCaptureGuard = createPointerCaptureGuard(() => canvasRef.value)

const pointerInteraction = usePointerInteractionStateMachine({
  pointerCaptureGuard,
  clickDragThresholdPx: CLICK_DRAG_THRESHOLD_PX,
})

const postprocessing = useViewportPostprocessing({
  getRenderer: () => renderer,
  getScene: () => scene,
  getCamera: () => camera,
})
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

// Building label font/meshes (planning-conversion buildings)
const buildingLabelMeshes = new Map<string, THREE.Mesh>()

// Guide route waypoint label meshes (key: `${nodeId}:${index}`)
const guideRouteWaypointLabelMeshes = new Map<string, THREE.Mesh>()
// fontPromise will be defined below with a relaxed type to satisfy typings
function clampInclusive(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

let fontPromise: Promise<any> | null = null
function loadLabelFont(): Promise<any> {
  if (fontPromise) return fontPromise
  fontPromise = new Promise<any>((resolve, reject) => {
    const loader = new FontLoader()
    // load from CDN at runtime (falls back if blocked)
    const url = 'https://unpkg.com/three@0.154.0/examples/fonts/helvetiker_regular.typeface.json'
    loader.load(url, (font) => resolve(font), undefined, (err) => reject(err))
  })
  return fontPromise
}

async function createOrUpdateLabel(node: SceneNode, container: THREE.Object3D) {
  try {
    if (!node || !container) return

    const nodeId = node.id
    const existing = buildingLabelMeshes.get(nodeId)
    const labelText = (node.name && String(node.name).trim()) || 'Building'

    const font = await loadLabelFont()

    // If existing label and text unchanged, just update position later
    if (existing && existing.userData?.labelText === labelText) {
      return
    }

    // Remove old
    if (existing) {
      existing.geometry.dispose()
      ;(existing.material as THREE.Material).dispose?.()
      existing.removeFromParent()
      buildingLabelMeshes.delete(nodeId)
    }

    const size = 1.0
    const height = 0.08
    const geom = new TextGeometry(labelText, { font, size, height, curveSegments: 6, bevelEnabled: false })
    geom.computeBoundingBox()
    const bbox = geom.boundingBox
    if (bbox) {
      const center = new THREE.Vector3()
      bbox.getCenter(center)
      geom.translate(-center.x, -center.y, -center.z)
    }

    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    mat.depthTest = false
    mat.toneMapped = false
    const mesh = new THREE.Mesh(geom, mat)
    mesh.name = `${node.name ?? 'Building'} (label)`
    mesh.userData = { nodeId, editorOnly: true, labelText }
    mesh.renderOrder = 9999

    // compute center of container in local space
    const box = new THREE.Box3().setFromObject(container)
    const worldCenter = new THREE.Vector3()
    box.getCenter(worldCenter)
    // convert to container local
    const localCenter = worldCenter.clone()
    container.worldToLocal(localCenter)
    mesh.position.copy(localCenter)
    // float a bit above
    mesh.position.y = (box.max.y - box.min.y) * 0.5 + 0.2

    // attach to the same container so it moves with the node
    container.add(mesh)
    buildingLabelMeshes.set(nodeId, mesh)
  } catch (err) {
    // ignore font/load errors silently
    console.warn('Failed to create building label', err)
  }
}

async function createOrUpdateGuideRouteWaypointLabels(node: SceneNode, container: THREE.Object3D) {
  try {
    if (!node || !container) return

    const componentState = node.components?.[GUIDE_ROUTE_COMPONENT_TYPE] as
      | SceneNodeComponentState<GuideRouteComponentProps>
      | undefined
    if (!componentState || componentState.enabled === false) {
      // Remove any existing labels for this node
      const prefix = `${node.id}:`
      for (const [key, mesh] of guideRouteWaypointLabelMeshes.entries()) {
        if (!key.startsWith(prefix)) continue
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose?.()
        mesh.removeFromParent()
        guideRouteWaypointLabelMeshes.delete(key)
      }
      return
    }

    const props = clampGuideRouteComponentProps(componentState.props as Partial<GuideRouteComponentProps> | null | undefined)
    const waypoints = Array.isArray(props.waypoints) ? props.waypoints : []

    const desiredKeys = new Set<string>()
    for (let index = 0; index < waypoints.length; index += 1) {
      desiredKeys.add(`${node.id}:${index}`)
    }

    const prefix = `${node.id}:`
    for (const [key, mesh] of guideRouteWaypointLabelMeshes.entries()) {
      if (!key.startsWith(prefix)) continue
      if (desiredKeys.has(key)) continue
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose?.()
      mesh.removeFromParent()
      guideRouteWaypointLabelMeshes.delete(key)
    }

    if (!waypoints.length) {
      return
    }

    const font = await loadLabelFont()
    const size = 0.6
    const height = 0.06
    const yOffset = 0.22

    for (let index = 0; index < waypoints.length; index += 1) {
      const key = `${node.id}:${index}`
      const waypoint = waypoints[index]
      const rawName = typeof waypoint?.name === 'string' ? waypoint.name : ''
      const labelText = rawName.trim() || `P${index + 1}`

      const existing = guideRouteWaypointLabelMeshes.get(key)
      if (existing && existing.userData?.labelText === labelText) {
        // Update position in case waypoint moved
        const pos = waypoint?.position
        if (pos) {
          existing.position.set(Number(pos.x) || 0, (Number(pos.y) || 0) + yOffset, Number(pos.z) || 0)
        }
        continue
      }

      if (existing) {
        existing.geometry.dispose()
        ;(existing.material as THREE.Material).dispose?.()
        existing.removeFromParent()
        guideRouteWaypointLabelMeshes.delete(key)
      }

      const geom = new TextGeometry(labelText, { font, size, height, curveSegments: 6, bevelEnabled: false })
      geom.computeBoundingBox()
      const bbox = geom.boundingBox
      if (bbox) {
        const center = new THREE.Vector3()
        bbox.getCenter(center)
        geom.translate(-center.x, -center.y, -center.z)
      }

      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff })
      mat.depthTest = false
      mat.toneMapped = false

      const mesh = new THREE.Mesh(geom, mat)
      mesh.name = `${node.name ?? 'GuideRoute'} waypoint ${index + 1} (label)`
      mesh.userData = { nodeId: node.id, editorOnly: true, labelText, waypointIndex: index }
      mesh.renderOrder = 9999

      const pos = waypoint?.position
      mesh.position.set(Number(pos?.x) || 0, (Number(pos?.y) || 0) + yOffset, Number(pos?.z) || 0)
      container.add(mesh)
      guideRouteWaypointLabelMeshes.set(key, mesh)
    }
  } catch (err) {
    console.warn('Failed to create guide route waypoint labels', err)
  }
}

const faceSnapManager = createFaceSnapManager({
  getScene: () => scene,
  objectMap,
  getActiveTool: () => props.activeTool,
  isEditableKeyboardTarget,
})

const protagonistPreview = useProtagonistPreview({
  getScene: () => scene,
  getRenderer: () => renderer,
  getTransformControls: () => transformControls,
  objectMap,
  protagonistPreviewNodeId,
  showProtagonistPreview,
  widthPx: 240,
  heightPx: 140,
  marginPx: 16,
})

const textureLoader = new THREE.TextureLoader()
const cubeTextureLoader = new THREE.CubeTextureLoader()
const rgbeLoader = new RGBELoader().setDataType(THREE.FloatType)
const exrLoader = new EXRLoader().setDataType(THREE.FloatType)
const textureCache = new Map<string, THREE.Texture>()
const pendingTextureRequests = new Map<string, Promise<THREE.Texture | null>>()

// Node types that may require swapping in a store-managed runtime Object3D.
// NOTE: This must use SceneNode.nodeType values (e.g. 'WarpGate'), not component type strings (e.g. 'warpGate').
const usesRuntimeObjectTypes = new Set<string>([
  'Mesh',
  'Group',
  'Sky',
  'Environment',
  'WarpGate',
  'Guideboard',
  'Plane',
  'Sphere',
])

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
  const castShadows = Boolean(shadowsActiveInViewport.value)
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

function computeRoadDynamicMeshSignature(
  definition: RoadDynamicMesh,
  junctionSmoothing: number | null,
  materialConfigId: string | null,
  laneLines: boolean,
  shoulders: boolean,
  samplingDensityFactor: number | null,
  smoothingStrengthFactor: number | null,
  minClearance: number | null,
  laneLineWidth: number | null,
  shoulderWidth: number | null,
  groundSignature: string | null,
  heightSamplerSignature: unknown,
): string {
  const serialized = stableSerialize([
    Array.isArray(definition.vertices) ? definition.vertices : [],
    Array.isArray(definition.segments) ? definition.segments : [],
    Number.isFinite(definition.width) ? definition.width : null,
    Number.isFinite(junctionSmoothing) ? junctionSmoothing : null,
    typeof materialConfigId === 'string' ? materialConfigId : null,
    Boolean(laneLines),
    Boolean(shoulders),
    Number.isFinite(samplingDensityFactor) ? samplingDensityFactor : null,
    Number.isFinite(smoothingStrengthFactor) ? smoothingStrengthFactor : null,
    Number.isFinite(minClearance) ? minClearance : null,
    Number.isFinite(laneLineWidth) ? laneLineWidth : null,
    Number.isFinite(shoulderWidth) ? shoulderWidth : null,
    typeof groundSignature === 'string' ? groundSignature : null,
    heightSamplerSignature ?? null,
  ])
  return hashString(serialized)
}

function resolveRoadJunctionSmoothing(node: SceneNode): number {
  const component = node.components?.[ROAD_COMPONENT_TYPE] as SceneNodeComponentState<RoadComponentProps> | undefined
  const raw = component?.props?.junctionSmoothing
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value)) {
    return ROAD_DEFAULT_JUNCTION_SMOOTHING
  }
  return Math.min(1, Math.max(0, value))
}

function resolveRoadLaneLinesEnabled(node: SceneNode): boolean {
  const component = node.components?.[ROAD_COMPONENT_TYPE] as SceneNodeComponentState<RoadComponentProps> | undefined
  return Boolean(component?.props?.laneLines)
}

function resolveRoadShouldersEnabled(node: SceneNode): boolean {
  const component = node.components?.[ROAD_COMPONENT_TYPE] as SceneNodeComponentState<RoadComponentProps> | undefined
  return Boolean(component?.props?.shoulders)
}

function resolveRoadMaterialConfigId(node: SceneNode): string | null {
  const first = node.materials?.[0]
  const id = typeof first?.id === 'string' ? first.id.trim() : ''
  return id ? id : null
}

function resolveRoadRenderOptionsForNodeId(nodeId: string): {
  junctionSmoothing: number
  laneLines: boolean
  shoulders: boolean
  materialConfigId: string | null
  heightSampler: ((x: number, z: number) => number) | null
  samplingDensityFactor?: number
  smoothingStrengthFactor?: number
  minClearance?: number
  laneLineWidth?: number
  shoulderWidth?: number
} | null {
  const node = findSceneNode(sceneStore.nodes, nodeId)
  if (!node || node.dynamicMesh?.type !== 'Road') {
    return null
  }
  const component = node.components?.[ROAD_COMPONENT_TYPE] as SceneNodeComponentState<RoadComponentProps> | undefined
  const junctionSmoothing = resolveRoadJunctionSmoothing(node)
  const laneLines = resolveRoadLaneLinesEnabled(node)
  const shoulders = resolveRoadShouldersEnabled(node)
  const materialConfigId = resolveRoadMaterialConfigId(node)
  const groundNode = findGroundNodeInTree(sceneStore.nodes)
  const groundDefinition = groundNode?.dynamicMesh?.type === 'Ground'
    ? groundNode.dynamicMesh
    : null

  const originX = Number(node.position?.x ?? 0)
  const originY = Number(node.position?.y ?? 0)
  const originZ = Number(node.position?.z ?? 0)
  const yaw = Number(node.rotation?.y ?? 0)
  const cosYaw = Math.cos(yaw)
  const sinYaw = Math.sin(yaw)

  const groundOriginX = Number(groundNode?.position?.x ?? 0)
  const groundOriginY = Number(groundNode?.position?.y ?? 0)
  const groundOriginZ = Number(groundNode?.position?.z ?? 0)

  const samplingDensityFactorRaw = component?.props?.samplingDensityFactor
  const samplingDensityFactorValue = typeof samplingDensityFactorRaw === 'number'
    ? samplingDensityFactorRaw
    : Number(samplingDensityFactorRaw)
  const samplingDensityFactor = Number.isFinite(samplingDensityFactorValue) ? samplingDensityFactorValue : undefined

  const smoothingStrengthFactorRaw = component?.props?.smoothingStrengthFactor
  const smoothingStrengthFactorValue = typeof smoothingStrengthFactorRaw === 'number'
    ? smoothingStrengthFactorRaw
    : Number(smoothingStrengthFactorRaw)
  const smoothingStrengthFactor = Number.isFinite(smoothingStrengthFactorValue) ? smoothingStrengthFactorValue : undefined

  const minClearanceRaw = component?.props?.minClearance
  const minClearanceValue = typeof minClearanceRaw === 'number' ? minClearanceRaw : Number(minClearanceRaw)
  const minClearance = Number.isFinite(minClearanceValue) ? minClearanceValue : undefined

  const laneLineWidthRaw = component?.props?.laneLineWidth
  const laneLineWidthValue = typeof laneLineWidthRaw === 'number' ? laneLineWidthRaw : Number(laneLineWidthRaw)
  const laneLineWidth = Number.isFinite(laneLineWidthValue) ? laneLineWidthValue : undefined

  const shoulderWidthRaw = component?.props?.shoulderWidth
  const shoulderWidthValue = typeof shoulderWidthRaw === 'number' ? shoulderWidthRaw : Number(shoulderWidthRaw)
  const shoulderWidth = Number.isFinite(shoulderWidthValue) ? shoulderWidthValue : undefined

  return {
    junctionSmoothing,
    laneLines,
    shoulders,
    materialConfigId,
    samplingDensityFactor,
    smoothingStrengthFactor,
    minClearance,
    laneLineWidth,
    shoulderWidth,
    // Road vertices are stored in the node's local XZ plane.
    // When sampling terrain height we must convert local -> world (include yaw), then sample ground in its local XZ,
    // then convert sampled world height -> road local Y.
    heightSampler: groundDefinition
      ? ((x: number, z: number) => {
          const rotatedX = x * cosYaw - z * sinYaw
          const rotatedZ = x * sinYaw + z * cosYaw
          const worldX = originX + rotatedX
          const worldZ = originZ + rotatedZ
          const groundLocalX = worldX - groundOriginX
          const groundLocalZ = worldZ - groundOriginZ
          const groundWorldY = groundOriginY + sampleGroundHeight(groundDefinition, groundLocalX, groundLocalZ)
          return groundWorldY - originY
        })
      : null,
  }
}

function applyRoadOverlayMaterials(node: SceneNode, roadGroup: THREE.Group) {
  if (!Array.isArray(node.materials) || node.materials.length < 3) {
    return
  }

  const shoulderConfig = node.materials[1]
  const laneConfig = node.materials[2]
  const applyConfigToMesh = (mesh: THREE.Mesh, config: SceneNodeMaterial) => {
    if (!mesh.material) {
      return
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (!material) {
        continue
      }
      applyMaterialConfigToMaterial(material, config, materialOverrideOptions)
    }
  }

  if (shoulderConfig) {
    const shoulder = roadGroup.getObjectByName('RoadShoulders') as THREE.Mesh | null
    if (shoulder?.isMesh) {
      applyConfigToMesh(shoulder, shoulderConfig)
    }
  }

  if (laneConfig) {
    const lane = roadGroup.getObjectByName('RoadLaneLines') as THREE.Mesh | null
    if (lane?.isMesh) {
      applyConfigToMesh(lane, laneConfig)
    }
  }
}

function computeFloorDynamicMeshSignature(definition: FloorDynamicMesh): string {
  const serialized = stableSerialize([
    Array.isArray(definition.vertices) ? definition.vertices : [],
    typeof definition.materialId === 'string' ? definition.materialId : null,
    Number.isFinite(definition.smooth) ? definition.smooth : null,
  ])
  return hashString(serialized)
}

function computeGuideRouteDynamicMeshSignature(definition: GuideRouteDynamicMesh): string {
  const serialized = stableSerialize([Array.isArray(definition.vertices) ? definition.vertices : []])
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

const isDragHovering = ref(false)
const gridVisible = computed(() => sceneStore.viewportSettings.showGrid)
const axesVisible = computed(() => sceneStore.viewportSettings.showAxes)
const shadowsEnabled = computed(() => sceneStore.shadowsEnabled)
const skyboxSettings = computed(() => sceneStore.skybox)
const environmentSettings = computed(() => sceneStore.environmentSettings)
const cloudPreviewEnabled = computed(() => sceneStore.cloudPreviewEnabled)
const isEnvironmentNodeSelected = computed(() => sceneStore.selectedNodeId === ENVIRONMENT_NODE_ID)
const shadowsActiveInViewport = computed(() => shadowsEnabled.value && isEnvironmentNodeSelected.value)
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
const buildToolCursorClass = computed(() => {
  if (activeBuildTool.value === 'wall') {
    return 'cursor-wall'
  }
  if (activeBuildTool.value === 'road') {
    return 'cursor-road'
  }
  if (activeBuildTool.value === 'floor') {
    return 'cursor-floor'
  }
  return null
})
const scatterEraseModeActive = ref(false)
const scatterEraseMenuOpen = ref(false)
const selectedNodeIsGround = computed(() => sceneStore.selectedNode?.dynamicMesh?.type === 'Ground')

const isGroundSculptConfigMode = computed(() => selectedNodeIsGround.value && brushOperation.value != null)
const buildToolsDisabled = computed(() => isGroundSculptConfigMode.value)

const instancedMeshRevision = ref(0)
const hasInstancedMeshes = computed(() => {
  void instancedMeshRevision.value
  return instancedMeshes.some((mesh) => mesh.visible && mesh.count > 0)
})

const canUseScatterEraseTool = computed(() => selectedNodeIsGround.value || hasInstancedMeshes.value)

const wallRenderer = createWallRenderer({
  assetCacheStore,
  getNodeById: (nodeId) => findSceneNode(sceneStore.nodes, nodeId),
  getObjectById: (nodeId) => objectMap.get(nodeId) ?? null,
  ensureInstancedPickProxy,
  removeInstancedPickProxy,
})

// (gesture state moved into `pointerInteraction`)

type InstancedEraseDragState = {
  pointerId: number
  lastKey: string | null
  lastAtMs: number
}

let instancedEraseDragState: InstancedEraseDragState | null = null

const repairHoverGroup = new THREE.Group()
repairHoverGroup.name = 'RepairHover'
repairHoverGroup.visible = false
const repairHoverProxies = new Map<string, THREE.Mesh>()

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
  scatterBrushRadius,
  scatterEraseRadius,
  activeBuildTool,
  scatterEraseModeActive,
  disableOrbitForGroundSelection,
  restoreOrbitAfterGroundSelection,
  isAltOverrideActive: () => isAltOverrideActive,
  onScatterEraseStart: () => {
    scatterEraseMenuOpen.value = false
  },
})

const {
  brushMesh,
  groundSelectionGroup,
  groundSelection,
  groundTextureInputRef,
  restoreGroupdScatter,
  updateScatterLod,
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
  clearScatterInstances,
} = groundEditor

function exitScatterEraseMode() {
  if (!scatterEraseModeActive.value) {
    return
  }
  scatterEraseModeActive.value = false
  pointerInteraction.clearIfKind('repairClick')
  instancedEraseDragState = null
  clearRepairHoverHighlight(true)
  cancelGroundEditorScatterErase()
  cancelGroundEditorScatterPlacement()
  scatterEraseMenuOpen.value = false
}

function toggleScatterEraseMode() {
  if (!canUseScatterEraseTool.value) {
    exitScatterEraseMode()
    return
  }
  if (scatterEraseModeActive.value) {
    exitScatterEraseMode()
    return
  }
  // Scatter erase and scatter painting are mutually exclusive; clear any scatter asset selection when enabling erase mode.
  terrainStore.setScatterSelection({ asset: null, providerAssetId: null })
  terrainStore.setBrushOperation(null)
  handleBuildToolChange(null)
  cancelGroundEditorScatterPlacement()
  scatterEraseModeActive.value = true
  if (props.activeTool !== 'select') {
    emit('changeTool', 'select')
  }
  updateOutlineSelectionTargets()
}

watch(scatterSelectedAsset, (asset) => {
  if (asset && scatterEraseModeActive.value) {
    exitScatterEraseMode()
  }
})

watch(brushOperation, (operation) => {
  if (operation && scatterEraseModeActive.value) {
    exitScatterEraseMode()
  }
})

function handleScatterEraseMenuOpen(value: boolean) {
  scatterEraseMenuOpen.value = value
}

function handleClearAllScatterInstances() {
  if (!selectedNodeIsGround.value) {
    return
  }
  cancelGroundEditorScatterPlacement()
  cancelGroundEditorScatterErase()
  clearScatterInstances()
  scatterEraseMenuOpen.value = false
}

function clearRepairHoverHighlight(updateOutline = true) {
  const wasVisible = repairHoverGroup.visible
  repairHoverGroup.visible = false
  repairHoverProxies.forEach((proxy) => {
    proxy.visible = false
  })
  if (updateOutline && wasVisible) {
    updateOutlineSelectionTargets()
  }
}

function updateRepairHoverHighlight(event: PointerEvent): boolean {
  if (!scatterEraseModeActive.value || !hasInstancedMeshes.value) {
    if (repairHoverGroup.visible) {
      clearRepairHoverHighlight(true)
    }
    return false
  }

  if (!canvasRef.value || !camera) {
    clearRepairHoverHighlight(false)
    return false
  }

  const rect = canvasRef.value.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) {
    clearRepairHoverHighlight(false)
    return false
  }

  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)

  const pickTargets = collectInstancedPickTargets()
  const intersections = raycaster.intersectObjects(pickTargets, false)
  intersections.sort((a, b) => a.distance - b.distance)

  for (const intersection of intersections) {
    if (typeof intersection.instanceId !== 'number' || intersection.instanceId < 0) {
      continue
    }
    const mesh = intersection.object as THREE.InstancedMesh
    const bindingId = findBindingIdForInstance(mesh, intersection.instanceId)
    if (!bindingId || bindingId.startsWith('inst-preview:')) {
      continue
    }
    const nodeId = findNodeIdForInstance(mesh, intersection.instanceId)
    if (!nodeId) {
      continue
    }
    const node = findSceneNode(sceneStore.nodes, nodeId)
    if (!node) {
      continue
    }

    const binding = getModelInstanceBindingById(bindingId)
    if (!binding) {
      continue
    }

    const activeHandles = new Set<string>()
    binding.slots.forEach((slot) => {
      const proxyKey = slot.handleId
      activeHandles.add(proxyKey)
      let proxy = repairHoverProxies.get(proxyKey)
      if (!proxy) {
        const created = createInstancedOutlineProxy(slot.mesh)
        created.material = instancedHoverMaterial
        created.renderOrder = 1000
        repairHoverProxies.set(proxyKey, created)
        repairHoverGroup.add(created)
        proxy = created
      } else {
        if (proxy.geometry !== slot.mesh.geometry) {
          proxy.geometry = slot.mesh.geometry
        }
        if (proxy.material !== instancedHoverMaterial) {
          proxy.material = instancedHoverMaterial
        }
        proxy.renderOrder = 1000
        if (proxy.parent !== repairHoverGroup) {
          repairHoverGroup.add(proxy)
        }
      }

      slot.mesh.updateWorldMatrix(true, false)
      instancedOutlineManager.syncProxyMatrixFromSlot(proxy, slot.mesh, slot.index)
      proxy.visible = true
    })

    repairHoverProxies.forEach((proxy, key) => {
      if (!activeHandles.has(key)) {
        proxy.visible = false
      }
    })

    repairHoverGroup.visible = true

    // Hover visuals are rendered directly; no need to feed outline selection targets.

    return true
  }

  if (repairHoverGroup.visible) {
    clearRepairHoverHighlight(true)
  }
  return false
}

function collectInstancedPickTargets(): THREE.InstancedMesh[] {
  // Ensure the instanced meshes' world matrices are up-to-date for raycasting.
  instancedMeshGroup.updateWorldMatrix(true, true)

  const pickTargets: THREE.InstancedMesh[] = []
  const seen = new Set<THREE.InstancedMesh>()

  const add = (candidate: THREE.Object3D | null | undefined) => {
    if (!candidate) {
      return
    }
    const mesh = candidate as THREE.InstancedMesh
    if (!(mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) {
      return
    }
    if (seen.has(mesh)) {
      return
    }
    if (!mesh.visible || mesh.count === 0) {
      return
    }
    mesh.updateWorldMatrix(true, false)
    pickTargets.push(mesh)
    seen.add(mesh)
  }

  // Some instanced meshes are attached to `instancedMeshGroup`, but keep the list as well.
  instancedMeshGroup.children.forEach((child) => add(child))
  instancedMeshes.forEach((mesh) => add(mesh))
  return pickTargets
}

function continuousIndexFromBindingId(nodeId: string, bindingId: string): number | null {
  if (bindingId === nodeId) {
    return 0
  }
  const prefix = `inst:${nodeId}:`
  if (!bindingId.startsWith(prefix)) {
    return null
  }
  const raw = bindingId.slice(prefix.length)
  const index = Number.parseInt(raw, 10)
  if (!Number.isFinite(index) || index < 1) {
    return null
  }
  return index
}

function eraseContinuousInstance(nodeId: string, bindingId: string): boolean {
  const node = findSceneNode(sceneStore.nodes, nodeId)
  const object = objectMap.get(nodeId) ?? null
  if (!node || !object) {
    return false
  }
  const assetId = object.userData?.instancedAssetId as string | undefined
  if (!assetId) {
    return false
  }

  const definition = getContinuousInstancedModelUserData(node)
  if (!definition) {
    return false
  }

  const index = continuousIndexFromBindingId(nodeId, bindingId)
  if (index === null) {
    return false
  }

  const spacing = definition.spacing
  const basePositions = 'positions' in definition
    ? definition.positions.map((p) => ({ x: p.x, y: p.y, z: p.z }))
    : buildLinearLocalPositions(definition.count, spacing)

  if (index < 0 || index >= basePositions.length) {
    return false
  }

  basePositions.splice(index, 1)

  if (basePositions.length === 0) {
    sceneStore.removeSceneNodes([nodeId])
    clearRepairHoverHighlight(true)
    if (scatterEraseModeActive.value) {
      exitScatterEraseMode()
    }
    return true
  }

  const nextUserData = buildContinuousInstancedModelUserDataPatchV2({
    previousUserData: node.userData,
    spacing,
    positions: basePositions,
  })

  sceneStore.updateNodeUserData(nodeId, nextUserData as Record<string, unknown>)

  // Keep runtime instance allocation in sync immediately.
  syncContinuousInstancedModelCommitted({
    node: { ...node, userData: nextUserData } as SceneNode,
    object,
    assetId,
  })

  ensureInstancedPickProxy(object, { ...node, userData: nextUserData } as SceneNode)
  syncInstancedOutlineEntryTransform(nodeId)
  updateOutlineSelectionTargets()
  updateSelectionHighlights()
  updatePlaceholderOverlayPositions()
  return true
}

function eraseInstancedBinding(nodeId: string, bindingId: string): boolean {
  const node = findSceneNode(sceneStore.nodes, nodeId)
  if (!node) {
    return false
  }

  const continuous = Boolean(getContinuousInstancedModelUserData(node))
  if (continuous) {
    return eraseContinuousInstance(nodeId, bindingId)
  }
  // Non-continuous instanced scene nodes represent a single instanced binding.
  // Removing the node is the correct erase operation.
  sceneStore.removeSceneNodes([nodeId])
  clearRepairHoverHighlight(true)
  updateOutlineSelectionTargets()
  updateSelectionHighlights()
  updatePlaceholderOverlayPositions()

  const selectedId = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
  if (selectedId === nodeId && scatterEraseModeActive.value) {
    exitScatterEraseMode()
  }

  return true
}

function pickSceneInstancedTargetAtPointer(event: PointerEvent): { nodeId: string; bindingId: string } | null {
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

  const pickTargets = collectInstancedPickTargets()
  const intersections = raycaster.intersectObjects(pickTargets, false)
  intersections.sort((a, b) => a.distance - b.distance)

  for (const intersection of intersections) {
    if (typeof intersection.instanceId !== 'number' || intersection.instanceId < 0) {
      continue
    }
    const mesh = intersection.object as THREE.InstancedMesh
    const bindingId = findBindingIdForInstance(mesh, intersection.instanceId)
    if (!bindingId || bindingId.startsWith('inst-preview:')) {
      continue
    }
    const nodeId = findNodeIdForInstance(mesh, intersection.instanceId)
    if (!nodeId) {
      continue
    }
    // Ignore instanced bindings that don't correspond to a SceneNode (e.g. ground scatter bindings).
    if (!findSceneNode(sceneStore.nodes, nodeId)) {
      continue
    }
    return { nodeId, bindingId }
  }

  return null
}

function tryEraseRepairTargetAtPointer(event: PointerEvent, options?: { skipKey?: string | null }): { handled: boolean; erasedKey: string | null } {
  if (!normalizedPointerGuard.setRayFromEvent(event)) {
    return { handled: false, erasedKey: null }
  }

  const pickTargets = collectInstancedPickTargets()
  const intersections = raycaster.intersectObjects(pickTargets, false)
  intersections.sort((a, b) => a.distance - b.distance)

  for (const intersection of intersections) {
    if (typeof intersection.instanceId !== 'number' || intersection.instanceId < 0) {
      continue
    }
    const mesh = intersection.object as THREE.InstancedMesh
    const bindingId = findBindingIdForInstance(mesh, intersection.instanceId)
    if (!bindingId || bindingId.startsWith('inst-preview:')) {
      continue
    }
    const nodeId = findNodeIdForInstance(mesh, intersection.instanceId)
    if (!nodeId) {
      continue
    }
    // Ignore instanced bindings that don't correspond to a SceneNode (e.g. ground scatter bindings).
    if (!findSceneNode(sceneStore.nodes, nodeId)) {
      continue
    }
    const key = `${nodeId}:${bindingId}`
    if (options?.skipKey && key === options.skipKey) {
      return { handled: false, erasedKey: null }
    }
    const handled = eraseInstancedBinding(nodeId, bindingId)
    clearRepairHoverHighlight(true)
    return { handled, erasedKey: key }
  }

  return { handled: false, erasedKey: null }
}

// (legacy) removed: tryEraseRepairTargetAtPointer(event): boolean
const {
  overlayContainerRef,
  placeholderOverlayList,
  refreshPlaceholderOverlays,
  clearPlaceholderOverlays,
  updatePlaceholderOverlayPositions,
} = usePlaceholderOverlayController({
  getSceneNodes: () => sceneStore.nodes,
  getCamera: () => camera,
  objectMap,
  getThumbnailUrl: (node) => {
    const assetId = typeof node.sourceAssetId === 'string' ? node.sourceAssetId : null
    if (!assetId) {
      return null
    }
    const asset = sceneStore.getAsset(assetId)
    return asset?.thumbnail ?? null
  },
})

function handlePlaceholderRetry(nodeId: string) {
  void sceneStore.retryPlaceholderNodeDownload(nodeId)
}

function handlePlaceholderCancelDelete(nodeId: string) {
  sceneStore.cancelAndDeletePlaceholderNode(nodeId)
}

// Some TS configs don't count template refs as usage.
void overlayContainerRef

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

type ContinuousInstancedCreateState = {
  pointerId: number
  nodeId: string
  assetId: string
  object: THREE.Object3D
  startWorldPoint: THREE.Vector3
  spacing: number
  existingCount: number
  anchorIndex: number
  previewEndIndexExclusive: number
  initialRotation: THREE.Euler
}

let continuousInstancedCreateState: ContinuousInstancedCreateState | null = null

const continuousPointerWorldHelper = new THREE.Vector3()
const continuousDragDirHelper = new THREE.Vector3()
const continuousYAxisHelper = new THREE.Vector3(0, 1, 0)
const continuousParentWorldQuaternion = new THREE.Quaternion()
const continuousDesiredWorldQuaternion = new THREE.Quaternion()
const continuousLocalQuaternion = new THREE.Quaternion()
const continuousAnchorWorldHelper = new THREE.Vector3()
const continuousAnchorMatrixHelper = new THREE.Matrix4()
const continuousAnchorWorldMatrixHelper = new THREE.Matrix4()

function beginContinuousInstancedCreate(event: PointerEvent, node: SceneNode, object: THREE.Object3D): boolean {
  if (!canvasRef.value || !camera || !scene) {
    return false
  }
  if (event.button !== 1) {
    return false
  }
  if (props.activeTool !== 'select') {
    return false
  }
  if (!object.userData?.instancedAssetId) {
    return false
  }

  const assetId = object.userData.instancedAssetId as string
  const definition = getContinuousInstancedModelUserData(node)
  const existingCount = definition
    ? ('positions' in definition ? definition.positions.length : definition.count)
    : 1
  const spacing = definition?.spacing ?? computeDefaultInstancedSpacing(object.userData?.instancedBounds)

  let anchorIndex = 0
  let hasAnchorPoint = false

  // If the pointer is on one of this node's committed instanced instances, use that instance as the anchor.
  {
    const rect = canvasRef.value.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)

      const pickTargets: THREE.Object3D[] = []
      const seen = new Set<THREE.Object3D>()
      const addPickTarget = (candidate: THREE.Object3D | undefined | null) => {
        if (!candidate || seen.has(candidate)) {
          return
        }
        const mesh = candidate as THREE.InstancedMesh
        if (!(mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) {
          return
        }
        if (!mesh.visible || mesh.count === 0) {
          return
        }
        pickTargets.push(mesh)
        seen.add(mesh)
      }

      instancedMeshGroup.children.forEach((child) => addPickTarget(child))
      instancedMeshes.forEach((mesh) => addPickTarget(mesh))

      const intersections = raycaster.intersectObjects(pickTargets, false)
      intersections.sort((a, b) => a.distance - b.distance)
      for (const intersection of intersections) {
        if (typeof intersection.instanceId !== 'number' || intersection.instanceId < 0) {
          continue
        }
        const mesh = intersection.object as THREE.InstancedMesh
        const bindingId = findBindingIdForInstance(mesh, intersection.instanceId)
        if (!bindingId || bindingId.startsWith('inst-preview:')) {
          continue
        }
        const hitNodeId = findNodeIdForInstance(mesh, intersection.instanceId)
        if (hitNodeId !== node.id) {
          continue
        }
        const resolvedIndex = continuousIndexFromBindingId(node.id, bindingId)
        if (resolvedIndex === null) {
          continue
        }

        mesh.updateMatrixWorld(true)
        mesh.getMatrixAt(intersection.instanceId, continuousAnchorMatrixHelper)
        continuousAnchorWorldMatrixHelper.multiplyMatrices(mesh.matrixWorld, continuousAnchorMatrixHelper)
        continuousAnchorWorldHelper.setFromMatrixPosition(continuousAnchorWorldMatrixHelper)

        anchorIndex = resolvedIndex
        hasAnchorPoint = true
        break
      }
    }
  }

  if (!hasAnchorPoint) {
    if (!raycastGroundPoint(event, continuousPointerWorldHelper)) {
      return false
    }
    continuousAnchorWorldHelper.copy(continuousPointerWorldHelper)
    anchorIndex = 0
  }

  continuousInstancedCreateState = {
    pointerId: event.pointerId,
    nodeId: node.id,
    assetId,
    object,
    startWorldPoint: continuousAnchorWorldHelper.clone(),
    spacing: Math.max(1e-4, spacing),
    existingCount: Math.max(1, existingCount),
    anchorIndex: Math.max(0, Math.min(Math.max(1, existingCount) - 1, anchorIndex)),
    previewEndIndexExclusive: Math.max(1, existingCount),
    initialRotation: object.rotation.clone(),
  }

  disableOrbitForSelectDrag()
  pointerInteraction.capture(event.pointerId)

  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  return true
}

function updateContinuousInstancedCreate(event: PointerEvent): boolean {
  const state = continuousInstancedCreateState
  if (!state || event.pointerId !== state.pointerId) {
    return false
  }
  if (!raycastGroundPoint(event, continuousPointerWorldHelper)) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return true
  }

  continuousDragDirHelper.copy(continuousPointerWorldHelper).sub(state.startWorldPoint)
  continuousDragDirHelper.y = 0
  const distance = continuousDragDirHelper.length()

  // Update node facing direction from drag.
  if (distance > 1e-4) {
    const yaw = Math.atan2(continuousDragDirHelper.x, continuousDragDirHelper.z)
    continuousDesiredWorldQuaternion.setFromAxisAngle(continuousYAxisHelper, yaw)
    if (state.object.parent) {
      state.object.parent.getWorldQuaternion(continuousParentWorldQuaternion)
    } else {
      continuousParentWorldQuaternion.identity()
    }
    continuousLocalQuaternion.copy(continuousParentWorldQuaternion).invert().multiply(continuousDesiredWorldQuaternion)
    state.object.quaternion.copy(continuousLocalQuaternion)
    state.object.rotation.setFromQuaternion(continuousLocalQuaternion)
  }

  // Sync committed instances (including rotation changes)
  syncInstancedTransform(state.object, false)

  const spacing = state.spacing
  const desiredFromAnchor = Math.floor(distance / spacing) + 1
  const remainingFromAnchor = Math.max(1, state.existingCount - state.anchorIndex)
  const neededBeyondEnd = Math.max(0, desiredFromAnchor - remainingFromAnchor)
  const desiredTotal = state.existingCount + neededBeyondEnd
  const previousEnd = state.previewEndIndexExclusive
  const nextEnd = Math.max(state.existingCount, desiredTotal)

  syncContinuousInstancedModelPreviewRange({
    nodeId: state.nodeId,
    assetId: state.assetId,
    object: state.object,
    spacing,
    startIndex: state.existingCount,
    endIndexExclusive: nextEnd,
    previousEndIndexExclusive: previousEnd,
  })

  state.previewEndIndexExclusive = nextEnd

  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  return true
}

function finalizeContinuousInstancedCreate(event: PointerEvent, cancel = false): boolean {
  const state = continuousInstancedCreateState
  if (!state || event.pointerId !== state.pointerId) {
    return false
  }
  continuousInstancedCreateState = null

  pointerInteraction.releaseIfCaptured(event.pointerId)

  restoreOrbitAfterSelectDrag()

  clearContinuousInstancedModelPreview(state.nodeId, state.existingCount, state.previewEndIndexExclusive)

  if (cancel) {
    state.object.rotation.copy(state.initialRotation)
    state.object.updateMatrixWorld(true)
    syncInstancedTransform(state.object, false)
    updateSelectionHighlights()
    return true
  }

  const nextCount = Math.max(state.existingCount, state.previewEndIndexExclusive)
  if (nextCount > state.existingCount) {
    const node = findSceneNode(sceneStore.nodes, state.nodeId)
    if (node) {
      const nextUserData = buildContinuousInstancedModelUserDataPatch({
        previousUserData: node.userData,
        spacing: state.spacing,
        count: nextCount,
      })
      sceneStore.updateNodeUserData(state.nodeId, nextUserData as Record<string, unknown>)

      // Ensure new committed instances are allocated + mapped immediately so they are pickable.
      syncContinuousInstancedModelCommitted({
        node: { ...node, userData: nextUserData } as SceneNode,
        object: state.object,
        assetId: state.assetId,
      })
    }
  }

  // Commit facing direction (rotation)
  emitTransformUpdates([
    {
      id: state.nodeId,
      rotation: toEulerLike(state.object.rotation),
    },
  ])

  updateSelectionHighlights()
  return true
}

// wall build session moved into `wallBuildTool`

type RoadSnapVertex = { position: THREE.Vector3; nodeId: string; vertexIndex: number }

// road build session moved into `roadBuildTool`

type RoadVertexDragState = {
  pointerId: number
  nodeId: string
  vertexIndex: number
  startX: number
  startY: number
  moved: boolean
  startVertex: [number, number]
  containerObject: THREE.Object3D
  roadGroup: THREE.Object3D
  baseDefinition: RoadDynamicMesh
  workingDefinition: RoadDynamicMesh
}

let roadVertexDragState: RoadVertexDragState | null = null

type FloorEdgeDragState = {
  pointerId: number
  nodeId: string
  edgeIndex: number
  startX: number
  startY: number
  moved: boolean
  runtimeObject: THREE.Object3D
  workingDefinition: FloorDynamicMesh
  startVertices: Array<[number, number]>
  perp: THREE.Vector2
  referencePoint: THREE.Vector2
  initialProjection: number
}

let floorEdgeDragState: FloorEdgeDragState | null = null

const roadVertexRenderer = createRoadVertexRenderer()

function ensureRoadVertexHandlesForSelectedNode(options?: { force?: boolean }) {
  const selectedId = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
  const active = activeBuildTool.value === 'road'
  const common = {
    active,
    selectedNodeId: selectedId,
    isSelectionLocked: (nodeId: string) => sceneStore.isNodeSelectionLocked(nodeId),
    resolveRoadDefinition: (nodeId: string) => {
      const node = findSceneNode(sceneStore.nodes, nodeId)
      return node?.dynamicMesh?.type === 'Road' ? (node.dynamicMesh as RoadDynamicMesh) : null
    },
    resolveRuntimeObject: (nodeId: string) => objectMap.get(nodeId) ?? null,
  }
  if (options?.force) {
    roadVertexRenderer.forceRebuild(common)
  } else {
    roadVertexRenderer.ensure(common)
  }
}

function pickRoadVertexHandleAtPointer(event: PointerEvent): RoadVertexHandlePickResult | null {
  return roadVertexRenderer.pick({
    camera,
    canvas: canvasRef.value,
    event,
    pointer,
    raycaster,
  })
}

const FLOOR_EDGE_PICK_DISTANCE = 0.3

type FloorEdgeHit = {
  edgeIndex: number
  perp: THREE.Vector2
  referencePoint: THREE.Vector2
  initialProjection: number
}

function pickFloorEdgeAtPointer(event: PointerEvent, node: SceneNode, runtimeObject: THREE.Object3D): FloorEdgeHit | null {
  if (!node.dynamicMesh || node.dynamicMesh.type !== 'Floor') {
    return null
  }
  if (!raycastGroundPoint(event, groundPointerHelper)) {
    return null
  }

  const pointerVec = new THREE.Vector2(groundPointerHelper.x, groundPointerHelper.z)
  const center = floorEdgeCenterHelper
  runtimeObject.getWorldPosition(center)

  const definition = node.dynamicMesh as FloorDynamicMesh
  const vertices = (Array.isArray(definition.vertices) ? definition.vertices : []).map((entry) => {
    const x = Number(Array.isArray(entry) ? entry[0] : entry)
    const z = Number(Array.isArray(entry) ? entry[1] : 0)
    return [Number.isFinite(x) ? x : 0, Number.isFinite(z) ? z : 0] as [number, number]
  })
  if (vertices.length < 2) {
    return null
  }

  const worldVertices = vertices.map(([x, z]) => ({
    x: center.x + x,
    z: center.z - z,
  }))

  let bestDistanceSq = Infinity
  let bestIndex = -1
  const closestPoint = new THREE.Vector2()

  for (let i = 0; i < worldVertices.length; i += 1) {
    const current = worldVertices[i]!
    const next = worldVertices[(i + 1) % worldVertices.length]!
    const dx = next.x - current.x
    const dz = next.z - current.z
    const segmentLenSq = dx * dx + dz * dz
    if (!(segmentLenSq > 0)) {
      continue
    }
    const t = Math.max(0, Math.min(1, ((pointerVec.x - current.x) * dx + (pointerVec.y - current.z) * dz) / segmentLenSq))
    const projection = new THREE.Vector2(current.x + dx * t, current.z + dz * t)
    const distSq = (pointerVec.x - projection.x) ** 2 + (pointerVec.y - projection.y) ** 2
    if (distSq < bestDistanceSq) {
      bestDistanceSq = distSq
      bestIndex = i
      closestPoint.copy(projection)
    }
  }

  if (bestIndex < 0 || bestDistanceSq > FLOOR_EDGE_PICK_DISTANCE * FLOOR_EDGE_PICK_DISTANCE) {
    return null
  }

  const start = worldVertices[bestIndex]!
  const end = worldVertices[(bestIndex + 1) % worldVertices.length]!
  const direction = new THREE.Vector2(end.x - start.x, end.z - start.z)
  if (direction.lengthSq() <= 0) {
    return null
  }
  const normalizedDirection = direction.normalize()
  const perp = new THREE.Vector2(-normalizedDirection.y, normalizedDirection.x)
  const projection = perp.dot(pointerVec.clone().sub(closestPoint))

  return {
    edgeIndex: bestIndex,
    perp,
    referencePoint: closestPoint.clone(),
    initialProjection: projection,
  }
}

function cloneFloorVertices(definition: FloorDynamicMesh): Array<[number, number]> {
  return (Array.isArray(definition.vertices) ? definition.vertices : []).map((entry) => {
    const x = Number(Array.isArray(entry) ? entry[0] : entry)
    const z = Number(Array.isArray(entry) ? entry[1] : 0)
    return [Number.isFinite(x) ? x : 0, Number.isFinite(z) ? z : 0] as [number, number]
  })
}

function tryBeginFloorEdgeDrag(event: PointerEvent): boolean {
  if (floorEdgeDragState) {
    return false
  }
  const selectedId = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
  if (!selectedId || sceneStore.isNodeSelectionLocked(selectedId)) {
    return false
  }
  const node = findSceneNode(sceneStore.nodes, selectedId)
  const runtime = objectMap.get(selectedId) ?? null
  if (!node || !runtime) {
    return false
  }
  const hit = pickFloorEdgeAtPointer(event, node, runtime)
  if (!hit) {
    return false
  }
  const base = node.dynamicMesh && typeof node.dynamicMesh === 'object' ? (node.dynamicMesh as FloorDynamicMesh) : null
  const startVertices = base ? cloneFloorVertices(base) : ([] as Array<[number, number]>)
  const workingDefinition: FloorDynamicMesh = {
    type: 'Floor',
    vertices: startVertices.map(([x, z]) => [x, z] as [number, number]),
    ...(base ? { materialId: base.materialId ?? null, smooth: base.smooth } : {}),
  }
  floorEdgeDragState = {
    pointerId: event.pointerId,
    nodeId: selectedId,
    edgeIndex: hit.edgeIndex,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    runtimeObject: runtime,
    workingDefinition,
    startVertices,
    perp: hit.perp.clone(),
    referencePoint: hit.referencePoint.clone(),
    initialProjection: hit.initialProjection,
  }
  pointerInteraction.capture(event.pointerId)
  pointerTrackingState = null
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  return true
}

const RIGHT_DOUBLE_CLICK_MS = 320

type BuildToolRightClickCandidate = {
  atMs: number
  x: number
  y: number
}

let buildToolRightClickCandidate: BuildToolRightClickCandidate | null = null

type GroundSculptBlockedBuildTool = 'wall' | 'road' | 'floor'

function isBuildToolBlockedDuringGroundSculptConfig(
  tool: BuildTool | null,
): tool is GroundSculptBlockedBuildTool {
  return tool === 'wall' || tool === 'road' || tool === 'floor'
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

function maybeCancelBuildToolOnRightDoubleClick(event: PointerEvent): boolean {
  if (event.button !== 2) {
    return false
  }

  if (isAltOverrideActive) {
    buildToolRightClickCandidate = null
    return false
  }

  const tool = activeBuildTool.value
  if (!isBuildToolBlockedDuringGroundSculptConfig(tool)) {
    buildToolRightClickCandidate = null
    return false
  }

  const dragState = pointerInteraction.get()
  const isTrackedRightClick = dragState?.kind === 'buildToolRightClick' && dragState.pointerId === event.pointerId
  const clickWasDrag = isTrackedRightClick ? (dragState.moved || pointerInteraction.ensureMoved(event)) : false

  // Don't treat drags as clicks; let camera controls + existing finalize logic proceed.
  if (clickWasDrag) {
    buildToolRightClickCandidate = null
    return false
  }

  const now = nowMs()
  const previous = buildToolRightClickCandidate
  if (previous && now - previous.atMs <= RIGHT_DOUBLE_CLICK_MS) {
    const dx = event.clientX - previous.x
    const dy = event.clientY - previous.y
    if (Math.hypot(dx, dy) < CLICK_DRAG_THRESHOLD_PX) {
      buildToolRightClickCandidate = null
      pointerInteraction.clearIfKind('buildToolRightClick')
      const handled = cancelActiveBuildOperation()
      if (handled) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
      }
      return handled
    }
  }

  buildToolRightClickCandidate = {
    atMs: now,
    x: event.clientX,
    y: event.clientY,
  }
  return false
}

const ROAD_VERTEX_SNAP_DISTANCE = GRID_MAJOR_SPACING * 0.5

const wallBuildTool = createWallBuildTool({
  activeBuildTool,
  sceneStore,
  rootGroup,
  raycastGroundPoint,
  snapPoint: (point) => snapVectorToMajorGrid(point),
  isAltOverrideActive: () => isAltOverrideActive,
  disableOrbitForWallBuild,
  restoreOrbitAfterWallBuild,
  normalizeWallDimensionsForViewport,
})

const roadBuildTool = createRoadBuildTool({
  activeBuildTool,
  pointerInteraction,
  rootGroup,
  heightSampler: (x: number, z: number) => {
    const ground = resolveGroundDynamicMeshDefinition()
    return ground ? sampleGroundHeight(ground, x, z) : 0
  },
  getScene: () => scene,
  defaultWidth: ROAD_DEFAULT_WIDTH,
  isAltOverrideActive: () => isAltOverrideActive,
  raycastGroundPoint,
  collectRoadSnapVertices,
  snapRoadPointToVertices,
  vertexSnapDistance: ROAD_VERTEX_SNAP_DISTANCE,
  pickNodeAtPointer,
  findSceneNode,
  getRuntimeObject: (nodeId) => objectMap.get(nodeId) ?? null,
  sceneNodes: () => sceneStore.nodes,
  updateNodeDynamicMesh: (nodeId, mesh) => sceneStore.updateNodeDynamicMesh(nodeId, mesh),
  createRoadNode: (payload) => sceneStore.createRoadNode(payload),
  setNodeMaterials: (nodeId, materials) => sceneStore.setNodeMaterials(nodeId, materials),
  selectNode: (nodeId) => sceneStore.selectNode(nodeId),
  createRoadNodeMaterials,
  ensureRoadVertexHandlesForSelectedNode,
 })

const floorBuildTool = createFloorBuildTool({
  activeBuildTool,
  sceneStore,
  rootGroup,
  raycastGroundPoint,
  snapPoint: (point) => snapVectorToMajorGrid(point.clone()),
  isAltOverrideActive: () => isAltOverrideActive,
  clickDragThresholdPx: CLICK_DRAG_THRESHOLD_PX,
})


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
    syncInstancedOutlineEntryTransform,
    resolveSceneNodeById: (nodeId: string) => findSceneNode(sceneStore.nodes, nodeId)
  }
)

const instancedCullingFrustum = new THREE.Frustum()
const instancedCullingProjView = new THREE.Matrix4()
const instancedCullingBox = new THREE.Box3()
const instancedCullingSphere = new THREE.Sphere()
const instancedCullingWorldPosition = new THREE.Vector3()
const instancedPositionHelper = new THREE.Vector3()
const instancedQuaternionHelper = new THREE.Quaternion()
const instancedScaleHelper = new THREE.Vector3()
const instancedLodFrustumCuller = createInstancedBvhFrustumCuller()

const pendingLodModelLoads = new Map<string, Promise<void>>()

type InstancedBoundsPayload = { min: [number, number, number]; max: [number, number, number] }

function serializeBoundingBox(box: THREE.Box3): InstancedBoundsPayload {
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  }
}

async function ensureModelObjectCached(assetId: string): Promise<void> {
  if (!assetId) {
    return
  }
  if (getCachedModelObject(assetId)) {
    return
  }
  if (pendingLodModelLoads.has(assetId)) {
    await pendingLodModelLoads.get(assetId)
    return
  }

  const task = (async () => {
    const asset = sceneStore.getAsset(assetId)
    if (!asset || (asset.type !== 'model' && asset.type !== 'mesh')) {
      return
    }
    let file = assetCacheStore.createFileFromCache(asset.id)
    if (!file) {
      await assetCacheStore.loadFromIndexedDb(asset.id)
      file = assetCacheStore.createFileFromCache(asset.id)
    }
    if (!file) {
      return
    }
    await getOrLoadModelObject(asset.id, () => loadObjectFromFile(file))
    assetCacheStore.releaseInMemoryBlob(asset.id)
    ensureInstancedMeshesRegistered(asset.id)
  })()
    .catch((error) => {
      console.warn('[SceneViewport] Failed to preload LOD model asset', assetId, error)
    })
    .finally(() => {
      pendingLodModelLoads.delete(assetId)
    })

  pendingLodModelLoads.set(assetId, task)
  await task
}

function resolveDesiredLodAssetId(node: SceneNode, object: THREE.Object3D): string | null {
  const component = node.components?.[LOD_COMPONENT_TYPE] as SceneNodeComponentState<LodComponentProps> | undefined
  if (!component) {
    return (typeof object.userData?.instancedAssetId === 'string' ? object.userData.instancedAssetId : null)
  }

  const props = clampLodComponentProps(component.props)
  const levels = props.levels
  if (!levels.length) {
    return node.sourceAssetId ?? null
  }
  object.getWorldPosition(instancedCullingWorldPosition)
  const distance = instancedCullingWorldPosition.distanceTo(camera?.position ?? instancedCullingWorldPosition)

  let chosen: (typeof levels)[number] | undefined
  for (let i = levels.length - 1; i >= 0; i -= 1) {
    const candidate = levels[i]
    if (candidate && distance >= candidate.distance) {
      chosen = candidate
      break
    }
  }

  return chosen?.modelAssetId ?? node.sourceAssetId ?? null
}

function applyInstancedLodSwitch(nodeId: string, object: THREE.Object3D, assetId: string): void {
  const cached = getCachedModelObject(assetId)
  if (!cached) {
    void ensureModelObjectCached(assetId)
    return
  }

  releaseModelInstance(nodeId)
  const binding = allocateModelInstance(assetId, nodeId)
  if (!binding) {
    return
  }

  object.userData = {
    ...(object.userData ?? {}),
    instancedAssetId: assetId,
    instancedBounds: serializeBoundingBox(cached.boundingBox),
  }
  object.userData.__harmonyInstancedRadius = cached.radius
  object.userData.__harmonyCulled = false
  syncInstancedTransform(object)
}

function resolveInstancedProxyRadius(object: THREE.Object3D): number {
  const cached = object.userData?.__harmonyInstancedRadius as number | undefined
  if (Number.isFinite(cached) && (cached as number) > 0) {
    return cached as number
  }
  const bounds = object.userData?.instancedBounds as { min?: [number, number, number]; max?: [number, number, number] } | undefined
  if (bounds?.min && bounds?.max) {
    instancedCullingBox.min.set(bounds.min[0] ?? 0, bounds.min[1] ?? 0, bounds.min[2] ?? 0)
    instancedCullingBox.max.set(bounds.max[0] ?? 0, bounds.max[1] ?? 0, bounds.max[2] ?? 0)
    if (!instancedCullingBox.isEmpty()) {
      instancedCullingBox.getBoundingSphere(instancedCullingSphere)
      const radius = instancedCullingSphere.radius
      if (Number.isFinite(radius) && radius > 0) {
        object.userData.__harmonyInstancedRadius = radius
        return radius
      }
    }
  }
  setBoundingBoxFromObject(object, instancedCullingBox)
  instancedCullingBox.getBoundingSphere(instancedCullingSphere)
  const radius = instancedCullingSphere.radius
  object.userData.__harmonyInstancedRadius = radius
  return radius
}

function updateInstancedCullingAndLod(): void {
  if (!camera) {
    return
  }

  camera.updateMatrixWorld(true)
  instancedCullingProjView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  instancedCullingFrustum.setFromProjectionMatrix(instancedCullingProjView)


  const candidateIds: string[] = []
  const candidateObjects = new Map<string, THREE.Object3D>()

  objectMap.forEach((object, nodeId) => {
    if (!object?.userData?.instancedAssetId) {
      return
    }
    const node = resolveSceneNodeById(nodeId)
    if (!node) {
      return
    }
    const component = node.components?.[LOD_COMPONENT_TYPE] as SceneNodeComponentState<LodComponentProps> | undefined
    if (!component || !component.enabled) {
      return
    }
    const props = clampLodComponentProps(component.props)
    if (props.enableCulling === false) {
      return
    }
    candidateIds.push(nodeId)
    candidateObjects.set(nodeId, object)
  })

  candidateIds.sort()
  instancedLodFrustumCuller.setIds(candidateIds)
  const visibleIds = instancedLodFrustumCuller.updateAndQueryVisible(instancedCullingFrustum, (id: string, centerTarget: THREE.Vector3) => {
    const object = candidateObjects.get(id)
    if (!object) {
      return null
    }
    object.updateMatrixWorld(true)
    object.getWorldPosition(centerTarget)
    object.matrixWorld.decompose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper)
    const scale = Math.max(instancedScaleHelper.x, instancedScaleHelper.y, instancedScaleHelper.z)
    const baseRadius = resolveInstancedProxyRadius(object)
    const radius = Number.isFinite(scale) && scale > 0 ? baseRadius * scale : baseRadius
    return { radius }
  })

  candidateIds.forEach((nodeId) => {
    const object = candidateObjects.get(nodeId)
    if (!object) {
      return
    }
    const node = resolveSceneNodeById(nodeId)
    if (!node) {
      return
    }
    const isVisible = visibleIds.has(nodeId)
    if (!isVisible) {
      object.userData.__harmonyCulled = true
      releaseModelInstance(nodeId)
      return
    }

    object.userData.__harmonyCulled = false
    const desiredAssetId = resolveDesiredLodAssetId(node, object)
    if (!desiredAssetId) {
      return
    }
    const currentAssetId = object.userData.instancedAssetId as string | undefined
    if (currentAssetId !== desiredAssetId) {
      applyInstancedLodSwitch(nodeId, object, desiredAssetId)
      return
    }
    const binding = allocateModelInstance(desiredAssetId, nodeId)
    if (!binding) {
      void ensureModelObjectCached(desiredAssetId)
      return
    }
    syncInstancedTransform(object)
  })
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

  if (!normalizedPointerGuard.setRayFromEvent(event)) {
    return null
  }

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

function updateMapControlsEnabled() {
  if (!mapControls) {
    return
  }
  const shouldEnable = orbitDisableCount === 0 || isOrbitControlOverrideActive
  mapControls.enabled = shouldEnable
}

function requestMapControlDisable() {
  orbitDisableCount += 1
  updateMapControlsEnabled()
}

function releaseOrbitControlDisable() {
  if (orbitDisableCount === 0) {
    return
  }
  orbitDisableCount = Math.max(0, orbitDisableCount - 1)
  updateMapControlsEnabled()
}

function disableOrbitForSelectDrag() {
  if (!isSelectDragOrbitDisabled) {
    isSelectDragOrbitDisabled = true
    requestMapControlDisable()
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
    requestMapControlDisable()
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
    requestMapControlDisable()
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
  updateMapControlsEnabled()
}

function activateAltOverride() {
  if (isAltOverrideActive) {
    return
  }
  isAltOverrideActive = true
  toolOverrideSnapshot = {
    transformTool: props.activeTool ?? null,
    wallBuildActive: Boolean(wallBuildTool.getSession()),
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
  if (snapshot?.wallBuildActive && wallBuildTool.getSession()) {
    wallBuildTool.flushPreview(scene)
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
const instancedPivotCenterLocalHelper = new THREE.Vector3()
const instancedPivotWorldHelper = new THREE.Vector3()
const groundPointerHelper = new THREE.Vector3()
const floorEdgeCenterHelper = new THREE.Vector3()
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

    const proxy = object.userData?.instancedPickProxy as THREE.Mesh | undefined
    if (proxy?.geometry) {
      if (!proxy.geometry.boundingBox) {
        proxy.geometry.computeBoundingBox()
      }
    }

    const pivotWorld = new THREE.Vector3()
    if (proxy?.geometry?.boundingBox) {
      instancedPivotCenterLocalHelper.copy(proxy.geometry.boundingBox.getCenter(instancedPivotCenterLocalHelper))
      proxy.updateMatrixWorld(true)
      pivotWorld.copy(instancedPivotCenterLocalHelper)
      proxy.localToWorld(pivotWorld)
    } else {
      object.getWorldPosition(pivotWorld)
    }

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
      initialPivotWorldPosition: pivotWorld,
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
  if (mapControls) {
    mapControls.enabled = !value
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
      sceneStore.drainScenePatches()
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

let patchAppliedInCurrentFlush = false
let patchAppliedResetScheduled = false

function markPatchAppliedInCurrentFlush(): void {
  patchAppliedInCurrentFlush = true
  if (patchAppliedResetScheduled) {
    return
  }
  patchAppliedResetScheduled = true
  const reset = () => {
    patchAppliedInCurrentFlush = false
    patchAppliedResetScheduled = false
  }
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(reset)
  } else {
    Promise.resolve().then(reset)
  }
}

function removeNodeObjects(removedIds: Set<string>): void {
  removedIds.forEach((id) => disposeNodeSubtree(id))

  // Keep selection/effects/lighting consistent with the full-sync path.
  attachSelection(props.selectedNodeId, props.activeTool)
  updateOutlineSelectionTargets()
  updateSelectionHighlights()
  ensureFallbackLighting()
  refreshEffectRuntimeTickers()
}

function buildParentIdMap(nodes: SceneNode[]): Map<string, string | null> {
  const map = new Map<string, string | null>()
  const walk = (list: SceneNode[], parentId: string | null) => {
    list.forEach((node) => {
      map.set(node.id, parentId)
      if (node.children?.length) {
        walk(node.children, node.id)
      }
    })
  }
  walk(nodes, null)
  return map
}

function ensureNodeSubtreeExists(nodeId: string, node: SceneNode, parentIdMap: Map<string, string | null>): boolean {
  const parentId = parentIdMap.get(nodeId) ?? null
  const parentObject = parentId ? (objectMap.get(parentId) ?? null) : rootGroup
  if (parentId && !parentObject) {
    return false
  }
  reconcileNode(node, parentObject ?? rootGroup, new Set<string>())
  return true
}

function recreateNodeSubtree(nodeId: string, node: SceneNode, parentIdMap: Map<string, string | null>): boolean {
  const existing = objectMap.get(nodeId) ?? null
  const parentObject = existing?.parent
    ?? (() => {
      const parentId = parentIdMap.get(nodeId) ?? null
      return parentId ? (objectMap.get(parentId) ?? null) : rootGroup
    })()
  if (!parentObject) {
    return false
  }
  disposeNodeSubtree(nodeId)
  reconcileNode(node, parentObject, new Set<string>())
  return true
}

type PendingNodePatch = {
  type: 'node'
  id: string
  fields: string[]
}

function shouldRefreshPlaceholderOverlaysFromPatches(patches: Array<{ type: string }>): boolean {
  return patches.some((patch) => {
    if (patch.type === 'structure' || patch.type === 'remove') {
      return true
    }
    if (patch.type === 'node') {
      const nodePatch = patch as { type: 'node'; fields?: string[] }
      return Array.isArray(nodePatch.fields) && nodePatch.fields.includes('download')
    }
    return false
  })
}

function collectRemovedIdsFromPatches(patches: Array<{ type: string }>): Set<string> {
  const removedIds = new Set<string>()
  for (const patch of patches) {
    if (patch.type !== 'remove') {
      continue
    }
    const removePatch = patch as { type: 'remove'; ids?: unknown[] }
    removePatch.ids?.forEach((id) => {
      if (typeof id === 'string' && id.trim().length) {
        removedIds.add(id)
      }
    })
  }
  return removedIds
}

function collectNodePatches(patches: Array<{ type: string }>): PendingNodePatch[] {
  return patches.filter((patch) => patch.type === 'node') as PendingNodePatch[]
}

function applyNodePatchesFast(nodePatches: PendingNodePatch[], removedIds: Set<string>): void {
  for (const patch of nodePatches) {
    const nodeId = patch.id
    if (removedIds.has(nodeId)) {
      continue
    }
    const node = findSceneNode(sceneStore.nodes, nodeId)
    const object = objectMap.get(nodeId) ?? null
    if (!node || !object) {
      continue
    }
    updateNodeObject(object, node)
  }
}

function applyNodePatchesWithTopology(
  nodePatches: PendingNodePatch[],
  removedIds: Set<string>,
  parentIdMap: Map<string, string | null>,
): boolean {
  const depthCache = new Map<string, number>()
  const resolveDepth = (id: string): number => {
    if (depthCache.has(id)) {
      return depthCache.get(id) as number
    }
    let depth = 0
    let current: string | null = id
    const visited = new Set<string>()
    while (current) {
      if (visited.has(current)) {
        depth = 9999
        break
      }
      visited.add(current)
      const nextParentId: string | null = parentIdMap.get(current) ?? null
      if (!nextParentId) {
        break
      }
      depth += 1
      current = nextParentId
    }
    depthCache.set(id, depth)
    return depth
  }

  nodePatches.sort((a, b) => resolveDepth(a.id) - resolveDepth(b.id))

  for (const patch of nodePatches) {
    const nodeId = patch.id
    if (removedIds.has(nodeId)) {
      continue
    }
    const node = findSceneNode(sceneStore.nodes, nodeId)
    if (!node) {
      continue
    }
    const object = objectMap.get(nodeId) ?? null
    if (!object) {
      if (!ensureNodeSubtreeExists(nodeId, node, parentIdMap)) {
        syncSceneGraph()
        return true
      }
      continue
    }
    if (shouldRecreateNode(object, node)) {
      if (!recreateNodeSubtree(nodeId, node, parentIdMap)) {
        syncSceneGraph()
        return true
      }
      continue
    }
    updateNodeObject(object, node)
  }
  return false
}

function applyNodePatchesIncrementally(nodePatches: PendingNodePatch[], removedIds: Set<string>): boolean {
  // Fast path: if all targets exist and don't require recreation, avoid building parent maps.
  let needsTopology = false
  for (const patch of nodePatches) {
    const nodeId = patch.id
    if (removedIds.has(nodeId)) {
      continue
    }
    const node = findSceneNode(sceneStore.nodes, nodeId)
    if (!node) {
      continue
    }
    const object = objectMap.get(nodeId) ?? null
    if (!object || shouldRecreateNode(object, node)) {
      needsTopology = true
      break
    }
  }

  if (!needsTopology) {
    applyNodePatchesFast(nodePatches, removedIds)
    return false
  }

  const parentIdMap = buildParentIdMap(sceneStore.nodes)
  return applyNodePatchesWithTopology(nodePatches, removedIds, parentIdMap)
}

function applyPendingScenePatches(): boolean {
  if (!sceneStore.isSceneReady) {
    return false
  }

  const patches = sceneStore.drainScenePatches()
  if (!patches.length) {
    return false
  }

  markPatchAppliedInCurrentFlush()

  const needsPlaceholderOverlayRefresh = shouldRefreshPlaceholderOverlaysFromPatches(patches as Array<{ type: string }>)
  if (patches.some((patch) => patch.type === 'structure')) {
    syncSceneGraph()

    if (needsPlaceholderOverlayRefresh) {
      refreshPlaceholderOverlays()
    }
    updatePlaceholderOverlayPositions()
    return true
  }

  // Incremental removals: dispose subtrees directly instead of full reconcile.
  const removedIds = collectRemovedIdsFromPatches(patches as Array<{ type: string }>)
  if (removedIds.size) {
    removeNodeObjects(removedIds)
  }

  const nodePatches = collectNodePatches(patches as Array<{ type: string }>)
  if (nodePatches.length) {
    const didFallbackToFullSync = applyNodePatchesIncrementally(nodePatches, removedIds)
    if (didFallbackToFullSync) {
      return true
    }
  }

  if (needsPlaceholderOverlayRefresh) {
    refreshPlaceholderOverlays()
  }

  updatePlaceholderOverlayPositions()
  return true
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

const terrainGridHelper = new TerrainGridHelper()
terrainGridHelper.name = 'TerrainGridHelper'

const axesHelper = new THREE.AxesHelper(4)
axesHelper.visible = false

function findGroundNodeInTree(nodes: SceneNode[]): SceneNode | null {
  for (const node of nodes) {
    if (node.id === GROUND_NODE_ID || node.dynamicMesh?.type === 'Ground') {
      return node
    }
    if (node.children && node.children.length > 0) {
      const nested = findGroundNodeInTree(node.children)
      if (nested) {
        return nested
      }
    }
  }
  return null
}

function resolveGroundDynamicMeshDefinition(): GroundDynamicMesh | null {
  const node = findGroundNodeInTree(sceneStore.nodes)
  if (node?.dynamicMesh?.type === 'Ground') {
    return node.dynamicMesh
  }
  return null
}

const terrainGridController = useTerrainGridController({
  terrainGridHelper,
  getCamera: () => camera,
  resolveDefinition: resolveGroundDynamicMeshDefinition,
  computeSignature: computeGroundDynamicMeshSignature,
  nowMs,
})
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

const dragPreview = useDragPreview({
  getProjectTree: () => sceneStore.projectTree,
  assetCacheStore,
  disposeObjectResources,
})
const dragPreviewGroup = dragPreview.group


function bindControlsToCamera(newCamera: THREE.PerspectiveCamera) {
  if (mapControls) {
    mapControls.object = newCamera
    mapControls.update()
  }
  if (transformControls) {
    transformControls.camera = newCamera
  }
}

function renderViewportFrame() {
  if (!renderer || !scene || !camera) {
    return
  }
  postprocessing.render()
  protagonistPreview.render()
}

function applyGridVisibility(visible: boolean) {
  terrainGridHelper.visible = visible
  if (!visible) {
    updateGridHighlight(null)
    return
  }

  const dragPoint = isDragHovering.value ? dragPreview.getLastPoint() : null
  if (dragPoint) {
    updateGridHighlight(dragPoint, DEFAULT_GRID_HIGHLIGHT_DIMENSIONS)
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

let initialGridVisibilityApplied = false

watch(isSceneReady, (ready) => {
  if (!ready) {
    return
  }

  // Default: do NOT show the ground grid when entering the viewport.
  // Users can still enable it later via the toolbar toggle.
  if (!initialGridVisibilityApplied) {
    initialGridVisibilityApplied = true
    sceneStore.setViewportGridVisible(false)
  }

  syncSceneGraph()
  restoreGroupdScatter()
})

// Rebind scatter instances when terrainScatter snapshot changes (e.g. planning->3D conversion).
watch(
  [isSceneReady, groundTerrainScatterUpdatedAt],
  ([ready, updatedAt], [prevReady, prevUpdatedAt]) => {
    if (!ready) {
      return
    }
    if (updatedAt == null) {
      return
    }
    if (prevReady && prevUpdatedAt === updatedAt) {
      return
    }
    void restoreGroupdScatter()
  },
)

watch(gridVisible, (visible) => {
  applyGridVisibility(visible)
}, { immediate: true })

watch(axesVisible, (visible) => {
  applyAxesVisibility(visible)
}, { immediate: true })

const skyboxSignature = computed(() => {
  const settings = skyboxSettings.value
  if (!settings) {
    return 'null'
  }
  return JSON.stringify({
    turbidity: settings.turbidity,
    rayleigh: settings.rayleigh,
    mieCoefficient: settings.mieCoefficient,
    mieDirectionalG: settings.mieDirectionalG,
    elevation: settings.elevation,
    azimuth: settings.azimuth,
    exposure: settings.exposure,
  })
})

const environmentSignature = computed(() => {
  const settings = environmentSettings.value
  return JSON.stringify({
    background: {
      mode: settings.background.mode,
      solidColor: settings.background.solidColor,
      hdriAssetId: settings.background.hdriAssetId ?? null,
    },
    environmentMap: {
      mode: settings.environmentMap.mode,
      hdriAssetId: settings.environmentMap.hdriAssetId ?? null,
    },
    ambientLightColor: settings.ambientLightColor,
    ambientLightIntensity: settings.ambientLightIntensity,
    fogMode: settings.fogMode,
    fogColor: settings.fogColor,
    fogNear: settings.fogNear,
    fogFar: settings.fogFar,
    fogDensity: settings.fogDensity,
  })
})

watch(skyboxSignature, () => {
  applySkyboxSettingsToScene(skyboxSettings.value)
  syncCloudRendererSettings()
}, { immediate: true })

watch(cloudPreviewEnabled, () => {
  syncCloudRendererSettings()
}, { immediate: true })

watch(environmentSignature, () => {
  void applyEnvironmentSettingsToScene(environmentSettings.value)
  updateFogForSelection()
}, { immediate: true })

watch(isEnvironmentNodeSelected, () => {
  updateFogForSelection()
  applyRendererShadowSetting()
}, { immediate: true })

watch(
  [
    () => activeBuildTool.value,
    () => sceneStore.selectedNodeId,
    () => props.selectedNodeId,
    // Road edits mutate nodes; keep handles rebuilt.
    () => sceneStore.nodes,
  ],
  () => {
    ensureRoadVertexHandlesForSelectedNode()
  },
  { deep: false, immediate: true },
)

function resetCameraView() {
  if (!camera || !mapControls) return

  const targetY = Math.max(DEFAULT_CAMERA_TARGET.y, MIN_TARGET_HEIGHT)
  const position = new THREE.Vector3(DEFAULT_CAMERA_POSITION.x, DEFAULT_CAMERA_POSITION.y, DEFAULT_CAMERA_POSITION.z)
  const target = new THREE.Vector3(DEFAULT_CAMERA_TARGET.x, targetY, DEFAULT_CAMERA_TARGET.z)

  isApplyingCameraState = true
  camera.position.copy(position)
  camera.fov = DEFAULT_PERSPECTIVE_FOV
  camera.updateProjectionMatrix()

  mapControls.target.copy(target)
  mapControls.update()
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
  if (!state || !mapControls) return

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
  mapControls.target.set(state.target.x, clampedTargetY, state.target.z)
  mapControls.update()
  gizmoControls?.cameraUpdate()
  isApplyingCameraState = false
}


function focusCameraOnNode(nodeId: string): boolean {
  if (!camera || !mapControls) {
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
  mapControls.target.set(target.x, clampedTargetY, target.z)
  mapControls.update()
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
  terrainGridController.markCameraDirty()
}

function applyCameraControlMode() {
  if (!camera || !canvasRef.value) {
    return
  }

  const previousControls = mapControls
  const previousTarget = previousControls ? previousControls.target.clone() : null
  const previousEnabled = previousControls?.enabled ?? true

  if (previousControls) {
    previousControls.removeEventListener('change', handleControlsChange)
    previousControls.dispose()
  }

  const domElement = canvasRef.value
  mapControls = new MapControls(camera, domElement) 
  if (previousTarget) {
    mapControls.target.copy(previousTarget)
  } else {
    mapControls.target.set(DEFAULT_CAMERA_TARGET.x, DEFAULT_CAMERA_TARGET.y, DEFAULT_CAMERA_TARGET.z)
  }
  mapControls.enabled = previousEnabled
  mapControls.maxPolarAngle = Math.PI / 2; // 最大角度：垂直向下
  mapControls.minPolarAngle = 9 * (Math.PI / 180); // 最小角度：1度，防止完全水平视角
  mapControls.minDistance = 2;
  mapControls.maxDistance = 200;
  mapControls.addEventListener('change', handleControlsChange)
  bindControlsToCamera(camera)
  if (gizmoControls && mapControls) {
    gizmoControls.attachControls(mapControls)
    gizmoControls.update()
  }
  updateMapControlsEnabled()
  mapControls.update()
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
  renderer.shadowMap.enabled = Boolean(shadowsActiveInViewport.value)
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
  if (repairHoverGroup.parent !== instancedOutlineGroup) {
    instancedOutlineGroup.add(repairHoverGroup)
  }
  scene.add(terrainGridHelper)
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
  instancedMeshRevision.value += 1
  stopInstancedMeshSubscription = subscribeInstancedMeshes((mesh) => {
    attachInstancedMesh(mesh)
    instancedMeshRevision.value += 1
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

  applyCameraControlMode()

  transformControls = new TransformControls(camera, canvasRef.value)
  transformControls.addEventListener('dragging-changed', draggingChangedHandler as any)
  transformControls.addEventListener('objectChange', handleTransformChange)
  scene.add(transformControls.getHelper())

  postprocessing.init(width, height)
  updateOutlineSelectionTargets()

  bindControlsToCamera(camera)

  const gizmoContainer = gizmoContainerRef.value ?? viewportEl.value ?? undefined
  gizmoControls = new ViewportGizmo(camera, renderer, {
    container: gizmoContainer,
    offset: { top: 0, right: 0, bottom: 0, left: 0 },
    size: 70,
  })
  if (mapControls) {
    gizmoControls.attachControls(mapControls as any)
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
    postprocessing.setSize(w, h)
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
    light.castShadow = Boolean(shadowsActiveInViewport.value)
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

  sunDirectionalLight.castShadow = Boolean(shadowsActiveInViewport.value)
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

  if (settings.fogMode === 'linear') {
    const near = Math.max(0, settings.fogNear)
    const far = Math.max(near + 0.001, settings.fogFar)
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(fogColor)
      scene.fog.near = near
      scene.fog.far = far
    } else {
      scene.fog = new THREE.Fog(fogColor, near, far)
    }
    return
  }

  const density = Math.max(0, settings.fogDensity)
  if (scene.fog instanceof THREE.FogExp2) {
    scene.fog.color.copy(fogColor)
    scene.fog.density = density
  } else {
    scene.fog = new THREE.FogExp2(fogColor, density)
  }
}

function disableFog() {
  if (!scene) {
    return
  }
  scene.fog = null
}

function updateFogForSelection() {
  if (!scene) {
    return
  }
  if (isEnvironmentNodeSelected.value) {
    const settings = latestFogSettings ?? environmentSettings.value
    applyFogSettings(settings)
    return
  }
  disableFog()
}

async function applyEnvironmentSettingsToScene(settings: EnvironmentSettings) {
  const snapshot = cloneEnvironmentSettingsLocal(settings)
  latestFogSettings = snapshot

  if (!scene) {
    pendingEnvironmentSettings = snapshot
    return
  }

  applyAmbientLightSettings(snapshot)

  const backgroundApplied = await applyBackgroundSettings(snapshot.background)
  const environmentApplied = await applyEnvironmentMapSettings(snapshot.environmentMap)

  if (backgroundApplied && environmentApplied) {
    pendingEnvironmentSettings = null
  } else {
    pendingEnvironmentSettings = snapshot
  }
  updateFogForSelection()
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

  // frameStart removed (was used only for temporary profiling)
  const delta = renderClock.running ? renderClock.getDelta() : 0
  const effectiveDelta = delta > 0 ? Math.min(delta, 0.1) : 0
  const prof: Record<string, number> = {}

  let controlsUpdated = false

  if (cameraTransitionState && mapControls) {
    const t_cam0 = performance.now()
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
    mapControls.target.copy(cameraTransitionCurrentTarget)
    mapControls.update()

    if (!previousApplying) {
      isApplyingCameraState = false
    }

    controlsUpdated = true
    terrainGridController.markCameraDirty()

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
    prof.cameraTransition = performance.now() - t_cam0
  }

  if (mapControls && !controlsUpdated) {
    const t0 = performance.now()
    mapControls.update()
    prof.controls = performance.now() - t0
  }

  {
    const t0 = performance.now()
    const now = performance.now()
    terrainGridController.tick(now)
    prof.terrainGrid = performance.now() - t0
  }

  if (lightHelpersNeedingUpdate.size > 0 && scene) {
    const t0 = performance.now()
    scene.updateMatrixWorld(true)
    lightHelpersNeedingUpdate.forEach((helper) => {
      helper.update?.()
    })
    prof.lightHelpers = performance.now() - t0
  }

  const t_renderPrep = performance.now()
  wallBuildTool.flushPreviewIfNeeded(scene)
  roadBuildTool.flushPreviewIfNeeded(scene)
  floorBuildTool.flushPreviewIfNeeded(scene)
  roadVertexRenderer.updateScreenSize({ camera, canvas: canvasRef.value, diameterPx: 10 })
  updatePlaceholderOverlayPositions()
  if (sky) {
    sky.position.copy(camera.position)
  }
  const t_mid = performance.now()
  prof.renderPrep = t_mid - t_renderPrep
  gizmoControls?.cameraUpdate()
  if (props.activeTool === 'translate') {
    const t0 = performance.now()
    faceSnapManager.updateEffectIntensity(effectiveDelta)
    prof.faceSnap = performance.now() - t0
  }
  if (effectiveDelta > 0 && effectRuntimeTickers.length) {
    const t0 = performance.now()
    effectRuntimeTickers.forEach((tick) => {
      try {
        tick(effectiveDelta)
      } catch (error) {
        console.warn('[SceneViewport] Failed to advance effect runtime', error)
      }
    })
    prof.effectTickers = performance.now() - t0
  }
  if (effectiveDelta > 0 && cloudRenderer) {
    const t0 = performance.now()
    cloudRenderer.update(effectiveDelta)
    prof.cloudRenderer = performance.now() - t0
  }
  if (typeof updateGroundChunkStreaming === 'function') {
    const t_gc0 = performance.now()
    updateGroundChunkStreaming()
    prof.groundStreaming = performance.now() - t_gc0
  }

  const t0_scatter = performance.now()
  updateScatterLod()
  updateInstancedCullingAndLod()
  prof.scatterAndCulling = performance.now() - t0_scatter
  // make building labels face the camera and follow their parent container
  if (buildingLabelMeshes.size > 0 && camera) {
    const t0_labels = performance.now()
    const tmpBox = new THREE.Box3()
    const tmpVec = new THREE.Vector3()
    for (const [nodeId, mesh] of buildingLabelMeshes.entries()) {
      const parent = objectMap.get(nodeId)
      if (!parent) continue
      tmpBox.setFromObject(parent)
      tmpBox.getCenter(tmpVec)
      const localCenter = tmpVec.clone()
      parent.worldToLocal(localCenter)
      mesh.position.copy(localCenter)
      mesh.position.y = (tmpBox.max.y - tmpBox.min.y) * 0.5 + 0.2
      mesh.quaternion.copy(camera.quaternion)
    }
    prof.buildingLabels = performance.now() - t0_labels
  }
  if (guideRouteWaypointLabelMeshes.size > 0 && camera) {
    const t0_labels = performance.now()
    const tmpParentQuat = new THREE.Quaternion()
    const tmpInvParentQuat = new THREE.Quaternion()
    for (const mesh of guideRouteWaypointLabelMeshes.values()) {
      const nodeId = mesh.userData?.nodeId as string | undefined
      if (!nodeId) continue
      const parent = objectMap.get(nodeId)
      if (!parent) continue
      parent.getWorldQuaternion(tmpParentQuat)
      tmpInvParentQuat.copy(tmpParentQuat).invert()
      mesh.quaternion.multiplyQuaternions(tmpInvParentQuat, camera.quaternion)
    }
    prof.buildingLabels = (prof.buildingLabels ?? 0) + (performance.now() - t0_labels)
  }
  const t0_render = performance.now()
  renderViewportFrame()
  prof.render = performance.now() - t0_render
  const t0_gizmoRender = performance.now()
  gizmoControls?.render()
  prof.gizmoRender = performance.now() - t0_gizmoRender
  stats?.end()

  // frame timing previously used for debug logging; removed per request
}

function disposeScene() {
  disposeStats()
  disposeCloudRenderer()
  if (stopInstancedMeshSubscription) {
    stopInstancedMeshSubscription()
    stopInstancedMeshSubscription = null
  }
  clearInstancedMeshes()
  instancedMeshRevision.value += 1
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

  if (mapControls) {
    mapControls.removeEventListener('change', handleControlsChange)
    mapControls.dispose()
  }
  mapControls = null
  orbitDisableCount = 0
  isSelectDragOrbitDisabled = false
  // dispose building label meshes
  if (buildingLabelMeshes.size) {
    for (const mesh of buildingLabelMeshes.values()) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose?.()
      mesh.removeFromParent()
    }
    buildingLabelMeshes.clear()
  }
  if (guideRouteWaypointLabelMeshes.size) {
    for (const mesh of guideRouteWaypointLabelMeshes.values()) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose?.()
      mesh.removeFromParent()
    }
    guideRouteWaypointLabelMeshes.clear()
  }
  isGroundSelectionOrbitDisabled = false

  postprocessing.dispose()
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

  terrainGridController.dispose()
  terrainGridHelper.removeFromParent()

  clearOutlineSelectionTargets()
  protagonistPreview.dispose()
  dragPreview.dispose()
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
  wallBuildTool.dispose()
  roadBuildTool.dispose()
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
  const shouldShowSelectedHighlight = (nodeId: string | null | undefined): boolean => {
    if (!nodeId) {
      return false
    }
    const node = resolveSceneNodeById(nodeId)
    return node?.selectedHighlight ?? true
  }

  const selectedIds = sceneStore.selectedNodeIds.filter((id) => !!id && id !== props.selectedNodeId && shouldShowSelectedHighlight(id))
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
    const node = resolveSceneNodeById(id)
    const shouldHighlight = typeof node?.selectedHighlight === 'boolean'
      ? node.selectedHighlight
      : !(id === GROUND_NODE_ID || node?.dynamicMesh?.type === 'Ground')
    if (!shouldHighlight) {
      return
    }
    const target = resolveOutlineTargetForNode(id)
    if (!target) {
      return
    }
    collectVisibleMeshesForOutline(target, meshSet, activeInstancedNodeIds)
  })

  const releaseCandidates: string[] = []
  instancedOutlineManager.getEntryNodeIds().forEach((nodeId) => {
    if (!activeInstancedNodeIds.has(nodeId)) {
      releaseCandidates.push(nodeId)
    }
  })
  releaseCandidates.forEach((nodeId) => releaseInstancedOutlineEntry(nodeId, false))

  outlineSelectionTargets.length = 0
  outlineSelectionTargets.push(...meshSet)

  postprocessing.setOutlineTargets(outlineSelectionTargets)
}

function clearOutlineSelectionTargets() {
  outlineSelectionTargets.length = 0
  clearInstancedOutlineEntries()
  postprocessing.setOutlineTargets([])
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

  // Road segment sub-selection: only in select tool mode, left click, no modifiers.
  if (
    props.activeTool === 'select' &&
    hit &&
    typeof hit.roadSegmentIndex === 'number' &&
    Number.isFinite(hit.roadSegmentIndex) &&
    hit.roadSegmentIndex >= 0 &&
    !isToggle &&
    !isRange
  ) {
    sceneStore.setSelectedRoadSegment(hit.nodeId, hit.roadSegmentIndex)
    emitSelectionChange([hit.nodeId])
    return
  }

  if (!hit) {
    sceneStore.clearSelectedRoadSegment()
    if (!isToggle && !isRange) {
      emitSelectionChange([])
    }
    return
  }

  const nodeId = hit.nodeId
  const alreadySelected = currentSelection.includes(nodeId)

  // Clicking anything else clears road segment selection.
  sceneStore.clearSelectedRoadSegment()

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
  if (!normalizedPointerGuard.setRayFromEvent(event)) {
    return false
  }
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

  // Scatter erase mode: middle click (and drag) erases continuous instanced instances.
  // - If Ground is selected and we're not hovering an instanced target, allow ground-scatter erase to handle middle click.
  if (scatterEraseModeActive.value && hasInstancedMeshes.value && event.button === 1) {
    const hit = pickSceneInstancedTargetAtPointer(event)
    if (hit || !selectedNodeIsGround.value) {
      pointerTrackingState = null
      instancedEraseDragState = {
        pointerId: event.pointerId,
        lastKey: null,
        lastAtMs: 0,
      }
      const result = tryEraseRepairTargetAtPointer(event)
      if (result.handled && result.erasedKey) {
        instancedEraseDragState.lastKey = result.erasedKey
        instancedEraseDragState.lastAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now()
      }
      pointerInteraction.capture(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
    // If Ground is selected and no instanced target is under the cursor, fall through
    // so the ground-scatter erase can handle middle click.
  }

  // Middle mouse triggers continuous instanced creation (allows left/right for camera pan/rotate).
  if (
    !scatterEraseModeActive.value &&
    event.button === 1 &&
    props.activeTool === 'select' &&
    activeBuildTool.value !== 'wall' &&
    activeBuildTool.value !== 'road' &&
    activeBuildTool.value !== 'floor'
  ) {
    const nodeId = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
    if (nodeId && !sceneStore.isNodeSelectionLocked(nodeId)) {
      const node = findSceneNode(sceneStore.nodes, nodeId)
      const object = objectMap.get(nodeId) ?? null
      if (node && object) {
        const handled = beginContinuousInstancedCreate(event, node, object)
        if (handled) {
          pointerTrackingState = null
          return
        }
      }
    }
  }

  // Scatter erase mode: if continuous instanced models exist, allow camera controls.
  // We only treat a left-click with minimal movement as an erase action, handled on pointerup.
  if (scatterEraseModeActive.value && hasInstancedMeshes.value && event.button === 0) {
    pointerTrackingState = null
    pointerInteraction.beginRepairClick(event)
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


  if (activeBuildTool.value === 'wall') {
    if (wallBuildTool.handlePointerDown(event)) {
      pointerTrackingState = null
      return
    }
    // Wall build uses middle click for placement; keep left/right available for camera controls.
    if (button === 0) {
      pointerTrackingState = null
      return
    }
    if (button === 2) {
      pointerInteraction.beginBuildToolRightClick(event, { roadCancelEligible: false })
      pointerTrackingState = null
      return
    }
  }

  if (activeBuildTool.value === 'floor') {
    if (button === 1 && !isAltOverrideActive) {
      if (tryBeginFloorEdgeDrag(event)) {
        return
      }
    }
    floorBuildTool.handlePointerDown(event)
    if (button === 1 && !isAltOverrideActive) {
      pointerTrackingState = null
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
    // Floor build uses middle click for placement; keep left/right available for camera controls.
    if (button === 0) {
      pointerTrackingState = null
      return
    }
    if (button === 2) {
      pointerInteraction.beginBuildToolRightClick(event, { roadCancelEligible: false })
      pointerTrackingState = null
      return
    }
  }

  if (activeBuildTool.value === 'road') {
    if (button === 1 && !isAltOverrideActive) {
      // If a road vertex handle is under the cursor, begin vertex interaction (click to branch / drag to move).
      ensureRoadVertexHandlesForSelectedNode()
      const handleHit = pickRoadVertexHandleAtPointer(event)
      if (handleHit) {
        const node = findSceneNode(sceneStore.nodes, handleHit.nodeId)
        const runtime = objectMap.get(handleHit.nodeId) ?? null
        if (node?.dynamicMesh?.type === 'Road' && runtime) {
          const roadGroupCandidate = (runtime.userData?.roadGroup as THREE.Object3D | undefined) ?? runtime.getObjectByName('RoadGroup') ?? null
          if (!roadGroupCandidate) {
            pointerTrackingState = null
            event.preventDefault()
            event.stopPropagation()
            event.stopImmediatePropagation()
            return
          }
          const baseVertices = Array.isArray(node.dynamicMesh.vertices) ? node.dynamicMesh.vertices : []
          const baseVertex = baseVertices[handleHit.vertexIndex]
          const startVertex: [number, number] = Array.isArray(baseVertex) && baseVertex.length >= 2
            ? [Number(baseVertex[0]) || 0, Number(baseVertex[1]) || 0]
            : [0, 0]
          roadVertexDragState = {
            pointerId: event.pointerId,
            nodeId: handleHit.nodeId,
            vertexIndex: handleHit.vertexIndex,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
            startVertex,
            containerObject: runtime,
            roadGroup: roadGroupCandidate,
            baseDefinition: node.dynamicMesh,
            workingDefinition: {
              ...node.dynamicMesh,
              vertices: (Array.isArray(node.dynamicMesh.vertices) ? node.dynamicMesh.vertices : []).map(
                ([x, z]) => [Number(x) || 0, Number(z) || 0] as [number, number],
              ),
              segments: (Array.isArray(node.dynamicMesh.segments) ? node.dynamicMesh.segments : []).map((seg) => ({
                a: Number((seg as any).a) || 0,
                b: Number((seg as any).b) || 0,
              })),
            },
          }
          pointerInteraction.capture(event.pointerId)
          pointerTrackingState = null
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
          return
        }
      }

      pointerTrackingState = null
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
    // Road build uses middle click for placement; keep left/right available for camera controls.
    const roadCancelEligible = button === 2 && Boolean(roadBuildTool.getSession())
    if (button === 0) {
      pointerTrackingState = null
      return
    }
    if (button === 2) {
      pointerInteraction.beginBuildToolRightClick(event, { roadCancelEligible })
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

  const allowBoundingBoxDragFallback = (() => {
    if (!currentPrimaryId) {
      return true
    }
    const node = findSceneNode(sceneStore.nodes, currentPrimaryId)
    // Roads can be highly concave (e.g. arcs). Using an AABB allows drag-starts from empty space
    // inside the road's bounding box, which feels like dragging "through" the road.
    if (node?.dynamicMesh?.type === 'Road' || node?.dynamicMesh?.type === 'Wall') {
      return false
    }
    return true
  })()

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
      if (allowBoundingBoxDragFallback) {
        dragHit = pickActiveSelectionBoundingBoxHit(event)
      }
    }
  }

  const activeTransformAxis = button === 0 && props.activeTool !== 'select' ? (transformControls?.axis ?? null) : null

  pointerInteraction.capture(event.pointerId)

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
  if (roadVertexDragState && event.pointerId === roadVertexDragState.pointerId) {
    const state = roadVertexDragState
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved && Math.hypot(dx, dy) >= CLICK_DRAG_THRESHOLD_PX) {
      state.moved = true
    }

    const isMiddleDown = (event.buttons & 4) !== 0
    if (!isMiddleDown) {
      return
    }
    if (!raycastGroundPoint(event, groundPointerHelper)) {
      return
    }
    const snapped = groundPointerHelper.clone()
    snapped.y = 0

    const local = state.containerObject.worldToLocal(new THREE.Vector3(snapped.x, 0, snapped.z))
    const working = state.workingDefinition
    const vertices = Array.isArray(working.vertices) ? working.vertices : []
    if (!vertices[state.vertexIndex]) {
      return
    }
    vertices[state.vertexIndex] = [local.x, local.z]
    working.vertices = vertices

    // Treat any actual geometry change as a drag (prevents tiny mouse movement from being interpreted as a click -> branch).
    const [startVX, startVZ] = state.startVertex
    if (!state.moved) {
      const ddx = local.x - startVX
      const ddz = local.z - startVZ
      if (ddx * ddx + ddz * ddz > 1e-8) {
        state.moved = true
      }
    }

    const roadOptions = resolveRoadRenderOptionsForNodeId(state.nodeId) ?? undefined
    updateRoadGroup(state.roadGroup, state.workingDefinition, roadOptions)

    // Update all handle mesh positions if present (smoothing adjusts the whole path).
    const handles = state.containerObject.getObjectByName(ROAD_VERTEX_HANDLE_GROUP_NAME) as THREE.Group | null
    if (handles?.isGroup) {
      const nextVertices = Array.isArray(state.workingDefinition.vertices) ? state.workingDefinition.vertices : []
      for (const child of handles.children) {
        const index = Math.trunc(Number(child?.userData?.roadVertexIndex))
        const v = nextVertices[index]
        if (!Array.isArray(v) || v.length < 2) {
          continue
        }
        const x = Number(v[0])
        const z = Number(v[1])
        if (!Number.isFinite(x) || !Number.isFinite(z)) {
          continue
        }
        child.position.set(x, ROAD_VERTEX_HANDLE_Y, z)
      }
    }
    return
  }

  if (updateContinuousInstancedCreate(event)) {
    return
  }

  if (scatterEraseModeActive.value && hasInstancedMeshes.value) {
    updateRepairHoverHighlight(event)

    if (instancedEraseDragState && instancedEraseDragState.pointerId === event.pointerId) {
      const isMiddleDown = (event.buttons & 4) !== 0
      if (isMiddleDown) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
        // Throttle erase attempts slightly to avoid excessive updates.
        if (now - instancedEraseDragState.lastAtMs >= 24) {
          const result = tryEraseRepairTargetAtPointer(event, { skipKey: instancedEraseDragState.lastKey })
          instancedEraseDragState.lastAtMs = now
          if (result.handled && result.erasedKey) {
            instancedEraseDragState.lastKey = result.erasedKey
          }
        }
      }
    }

    pointerInteraction.updateMoved(event)
  } else {
    updateRepairHoverHighlight(event)
  }

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

  if (floorEdgeDragState && event.pointerId === floorEdgeDragState.pointerId) {
    const state = floorEdgeDragState
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved && Math.hypot(dx, dy) >= CLICK_DRAG_THRESHOLD_PX) {
      state.moved = true
    }

    const isMiddleDown = (event.buttons & 4) !== 0
    if (!isMiddleDown) {
      return
    }
    if (!raycastGroundPoint(event, groundPointerHelper)) {
      return
    }

    const pointerVec = new THREE.Vector2(groundPointerHelper.x, groundPointerHelper.z)
    const projection = state.perp.dot(pointerVec.clone().sub(state.referencePoint))
    const delta = projection - state.initialProjection
    const vertexCount = state.startVertices.length
    if (vertexCount < 2) {
      return
    }
    const localPerp = new THREE.Vector2(state.perp.x, -state.perp.y)
    const offset = localPerp.multiplyScalar(delta)
    const nextIndex = (state.edgeIndex + 1) % vertexCount
    const updatedVertices = state.startVertices.map((vertex, index) => {
      const [startX, startZ] = vertex
      if (index === state.edgeIndex || index === nextIndex) {
        return [startX + offset.x, startZ + offset.y] as [number, number]
      }
      return [startX, startZ] as [number, number]
    })

    const working = state.workingDefinition
    working.vertices = updatedVertices
    updateFloorGroup(state.runtimeObject, working)
    return
  }

  if (floorBuildTool.handlePointerMove(event)) {
    return
  }

  if (wallBuildTool.handlePointerMove(event)) {
    return
  }

  if (roadBuildTool.handlePointerMove(event)) {
    return
  }

  pointerInteraction.updateMoved(event)

  if (isAltOverrideActive) {
    return
  }

  // wall/road build move handling handled by build-tool modules

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
  try {
  if (roadVertexDragState && event.pointerId === roadVertexDragState.pointerId && event.button === 1) {
    const state = roadVertexDragState
    roadVertexDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)

    if (state.moved) {
      sceneStore.updateNodeDynamicMesh(state.nodeId, state.workingDefinition)
      // Runtime road group sync happens via reactive scene graph reconciliation; rebuild handles after that.
      ensureRoadVertexHandlesForSelectedNode()
      void nextTick(() => {
        ensureRoadVertexHandlesForSelectedNode()
      })
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }

    // No drag: ensure any preview mutations are reverted before treating this as a click.
    try {
      const roadOptions = resolveRoadRenderOptionsForNodeId(state.nodeId) ?? undefined
      updateRoadGroup(state.roadGroup, state.baseDefinition, roadOptions)
      const handles = state.containerObject.getObjectByName(ROAD_VERTEX_HANDLE_GROUP_NAME) as THREE.Group | null
      if (handles?.isGroup) {
        const mesh = handles.children.find((child) => child?.userData?.roadVertexIndex === state.vertexIndex) as THREE.Object3D | undefined
        if (mesh) {
          const [vx, vz] = state.startVertex
          mesh.position.set(vx, ROAD_VERTEX_HANDLE_Y, vz)
        }
      }
    } catch {
      /* noop */
    }

    // Click (no drag): start a branch build session from this vertex.
    const node = findSceneNode(sceneStore.nodes, state.nodeId)
    if (node?.dynamicMesh?.type === 'Road') {
      const v = Array.isArray(node.dynamicMesh.vertices) ? node.dynamicMesh.vertices[state.vertexIndex] : null
      if (v && Array.isArray(v) && v.length >= 2) {
        const runtime = objectMap.get(state.nodeId) ?? null
        if (runtime) {
          const world = runtime.localToWorld(new THREE.Vector3(Number(v[0]) || 0, 0, Number(v[1]) || 0))
          roadBuildTool.beginBranchFromVertex({
            nodeId: state.nodeId,
            vertexIndex: state.vertexIndex,
            worldPoint: world,
            width: Number.isFinite(node.dynamicMesh.width) ? node.dynamicMesh.width : ROAD_DEFAULT_WIDTH,
          })
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
          return
        }
      }
    }
    return
  }

  if (floorEdgeDragState && event.pointerId === floorEdgeDragState.pointerId && event.button === 1) {
    const state = floorEdgeDragState
    floorEdgeDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)

    if (state.moved) {
      sceneStore.updateNodeDynamicMesh(state.nodeId, state.workingDefinition)
    } else {
      const resetVertices = state.startVertices.map(
        ([x, z]) => [x, z] as [number, number],
      )
      state.workingDefinition.vertices = resetVertices
      updateFloorGroup(state.runtimeObject, state.workingDefinition)
    }

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (finalizeContinuousInstancedCreate(event, false)) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (instancedEraseDragState && event.pointerId === instancedEraseDragState.pointerId && event.button === 1) {
    instancedEraseDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  const interaction = pointerInteraction.get()
  if (scatterEraseModeActive.value && interaction?.kind === 'repairClick' && interaction.pointerId === event.pointerId && event.button === 0) {
    const moved = interaction.moved || pointerInteraction.ensureMoved(event)
    pointerInteraction.clearIfPointer(event.pointerId)
    if (!moved) {
      const result = tryEraseRepairTargetAtPointer(event)
      if (result.handled) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
      }
    }
    return
  }

  const overrideActive = isAltOverrideActive

  if (event.button === 2 && maybeCancelBuildToolOnRightDoubleClick(event)) {
    return
  }

  if (handleGroundEditorPointerUp(event)) {
    return
  }

  if (wallBuildTool.handlePointerUp(event)) {
    return
  }

  if (roadBuildTool.handlePointerUp(event)) {
    return
  }

  if (activeBuildTool.value === 'floor') {
    const handled = floorBuildTool.handlePointerUp(event)
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    return
  }

  // road build pointer-up handled by roadBuildTool

  if (!pointerTrackingState || event.pointerId !== pointerTrackingState.pointerId) {
    return
  }

  const trackingState = pointerTrackingState
  pointerTrackingState = null

  pointerInteraction.releaseIfCaptured(event.pointerId)

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
  } finally {
    // Ensure lightweight gesture state doesn't leak across interactions.
    pointerInteraction.clearIfPointer(event.pointerId)
  }
}

function handlePointerCancel(event: PointerEvent) {
  pointerInteraction.clearIfPointer(event.pointerId)
  if (roadVertexDragState && event.pointerId === roadVertexDragState.pointerId) {
    const state = roadVertexDragState
    roadVertexDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)
    try {
      const roadOptions = resolveRoadRenderOptionsForNodeId(state.nodeId) ?? undefined
      updateRoadGroup(state.roadGroup, state.baseDefinition, roadOptions)
      const handles = state.containerObject.getObjectByName(ROAD_VERTEX_HANDLE_GROUP_NAME) as THREE.Group | null
      if (handles?.isGroup) {
        const mesh = handles.children.find((child) => child?.userData?.roadVertexIndex === state.vertexIndex) as THREE.Object3D | undefined
        if (mesh) {
          const [vx, vz] = state.startVertex
          mesh.position.set(vx, ROAD_VERTEX_HANDLE_Y, vz)
        }
      }
    } catch {
      /* noop */
    }
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (finalizeContinuousInstancedCreate(event, true)) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (nodePickerStore.isActive) {
    hideNodePickerHighlight()
  }

  if (handleGroundEditorPointerCancel(event)) {
    return
  }

  if (activeBuildTool.value === 'floor') {
    if (floorBuildTool.handlePointerCancel(event)) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
  }

  if (floorEdgeDragState && event.pointerId === floorEdgeDragState.pointerId) {
    const state = floorEdgeDragState
    floorEdgeDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)
    const resetVertices = state.startVertices.map(([x, z]) => [x, z] as [number, number])
    state.workingDefinition.vertices = resetVertices
    updateFloorGroup(state.runtimeObject, state.workingDefinition)
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (wallBuildTool.handlePointerCancel(event)) {
    return
  }

  if (roadBuildTool.handlePointerCancel(event)) {
    return
  }


  if (!pointerTrackingState || event.pointerId !== pointerTrackingState.pointerId) {
    return
  }

  pointerInteraction.releaseIfCaptured(event.pointerId)

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

  if (instancedEraseDragState && event.pointerId === instancedEraseDragState.pointerId) {
    instancedEraseDragState = null
  }
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

// wall build logic moved to WallBuildTool

function collectRoadSnapVertices(): RoadSnapVertex[] {
  const vertices: RoadSnapVertex[] = []
  const visit = (nodes: SceneNode[]) => {
    nodes.forEach((node) => {
      if (node.dynamicMesh?.type === 'Road') {
        const originX = node.position?.x ?? 0
        const originZ = node.position?.z ?? 0
        const runtime = objectMap.get(node.id) ?? null
        const points = Array.isArray(node.dynamicMesh.vertices) ? node.dynamicMesh.vertices : []
        points.forEach((p, vertexIndex) => {
          if (!Array.isArray(p) || p.length < 2) {
            return
          }
          const x = Number(p[0])
          const z = Number(p[1])
          if (!Number.isFinite(x) || !Number.isFinite(z)) {
            return
          }
          const pos = runtime
            ? runtime.localToWorld(new THREE.Vector3(x, 0, z))
            : new THREE.Vector3(originX + x, 0, originZ + z)
          pos.y = 0
          vertices.push({
            position: pos,
            nodeId: node.id,
            vertexIndex,
          })
        })
      }
      if (node.children?.length) {
        visit(node.children)
      }
    })
  }
  visit(sceneStore.nodes)
  return vertices
}

function snapRoadPointToVertices(
  point: THREE.Vector3,
  vertices: RoadSnapVertex[],
  vertexSnapDistance = ROAD_VERTEX_SNAP_DISTANCE,
): { position: THREE.Vector3; nodeId: string | null; vertexIndex: number | null } {
  let best: RoadSnapVertex | null = null
  let bestDist2 = Number.POSITIVE_INFINITY
  for (let i = 0; i < vertices.length; i += 1) {
    const candidate = vertices[i]!
    const dx = candidate.position.x - point.x
    const dz = candidate.position.z - point.z
    const dist2 = dx * dx + dz * dz
    if (dist2 < bestDist2) {
      bestDist2 = dist2
      best = candidate
    }
  }
  if (best && bestDist2 <= vertexSnapDistance * vertexSnapDistance) {
    return { position: best.position.clone(), nodeId: best.nodeId, vertexIndex: best.vertexIndex }
  }
  return { position: point, nodeId: null, vertexIndex: null }
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
      if (wallBuildTool.getSession()) {
        wallBuildTool.cancel()
      } else {
        activeBuildTool.value = null
      }
      handled = true
      break
    case 'floor':
      if (floorBuildTool.cancel()) {
        // keep tool active? match road behavior: exit tool after cancel
      }
      activeBuildTool.value = null
      handled = true
      break
    case 'road':
      roadBuildTool.cancel()
      activeBuildTool.value = null
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
  if (tool && isBuildToolBlockedDuringGroundSculptConfig(tool) && isGroundSculptConfigMode.value) {
    return
  }
  if (activeBuildTool.value === 'floor' && tool !== 'floor') {
    floorBuildTool.cancel()
  }
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
    dragPreview.dispose()
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
    dragPreview.dispose()
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
      dragPreview.dispose()
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
    dragPreview.dispose()
    return
  }

  const point = computeDropPoint(event)
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  isDragHovering.value = true
  updateGridHighlight(point, DEFAULT_GRID_HIGHLIGHT_DIMENSIONS)
  dragPreview.setPosition(point)
  if (info) {
    dragPreview.prepare(info.assetId)
  } else {
    dragPreview.dispose()
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
  dragPreview.dispose()
  restoreGridHighlightForSelection()
}

async function handleViewportDrop(event: DragEvent) {
  if (!isAssetDrag(event)) return
  const info = resolveDragAsset(event)
  event.preventDefault()
  event.stopPropagation()
  isDragHovering.value = false
  dragPreview.dispose()
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

        // For instanced nodes, rotate around the pick-proxy center (not the node origin).
        const proxy = target.userData?.instancedPickProxy as THREE.Mesh | undefined
        if (proxy?.geometry) {
          if (!proxy.geometry.boundingBox) {
            proxy.geometry.computeBoundingBox()
          }
          if (proxy.geometry.boundingBox) {
            instancedPivotCenterLocalHelper.copy(proxy.geometry.boundingBox.getCenter(instancedPivotCenterLocalHelper))
            proxy.updateMatrixWorld(true)
            instancedPivotWorldHelper.copy(instancedPivotCenterLocalHelper)
            proxy.localToWorld(instancedPivotWorldHelper)

            transformDeltaPosition.copy(primaryEntry.initialPivotWorldPosition).sub(instancedPivotWorldHelper)
            if (transformDeltaPosition.lengthSq() > 1e-12) {
              target.getWorldPosition(transformWorldPositionBuffer)
              transformWorldPositionBuffer.add(transformDeltaPosition)
              if (target.parent) {
                target.parent.worldToLocal(transformWorldPositionBuffer)
              }
              target.position.copy(transformWorldPositionBuffer)
              target.updateMatrixWorld(true)
              syncInstancedTransform(target, true)
            }
          }
        }

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

        // For instanced nodes, keep the pick-proxy center fixed while scaling.
        const proxy = target.userData?.instancedPickProxy as THREE.Mesh | undefined
        if (proxy?.geometry) {
          if (!proxy.geometry.boundingBox) {
            proxy.geometry.computeBoundingBox()
          }
          if (proxy.geometry.boundingBox) {
            instancedPivotCenterLocalHelper.copy(proxy.geometry.boundingBox.getCenter(instancedPivotCenterLocalHelper))
            proxy.updateMatrixWorld(true)
            instancedPivotWorldHelper.copy(instancedPivotCenterLocalHelper)
            proxy.localToWorld(instancedPivotWorldHelper)

            transformDeltaPosition.copy(primaryEntry.initialPivotWorldPosition).sub(instancedPivotWorldHelper)
            if (transformDeltaPosition.lengthSq() > 1e-12) {
              target.getWorldPosition(transformWorldPositionBuffer)
              transformWorldPositionBuffer.add(transformDeltaPosition)
              if (target.parent) {
                target.parent.worldToLocal(transformWorldPositionBuffer)
              }
              target.position.copy(transformWorldPositionBuffer)
              target.updateMatrixWorld(true)
              syncInstancedTransform(target, true)
            }
          }
        }

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
    const groundObject = userData.groundMesh as THREE.Object3D | undefined
    if (groundObject) {
      const groundData = groundObject.userData ?? (groundObject.userData = {})
      const nextSignature = computeGroundDynamicMeshSignature(node.dynamicMesh)
      if (groundData[DYNAMIC_MESH_SIGNATURE_KEY] !== nextSignature) {
        updateGroundMesh(groundObject, node.dynamicMesh)
        groundData[DYNAMIC_MESH_SIGNATURE_KEY] = nextSignature
      }
    }
  } else if (node.dynamicMesh?.type === 'Wall') {
    const wallComponent = node.components?.[WALL_COMPONENT_TYPE] as
      | SceneNodeComponentState<WallComponentProps>
      | undefined
    const wallProps = clampWallProps(wallComponent?.props as Partial<WallComponentProps> | null | undefined)
    const bodyAssetId = wallProps.bodyAssetId ?? null
    const jointAssetId = wallProps.jointAssetId ?? null
    if (bodyAssetId && !getCachedModelObject(bodyAssetId)) {
      void ensureModelObjectCached(bodyAssetId)
    }
    if (jointAssetId && !getCachedModelObject(jointAssetId)) {
      void ensureModelObjectCached(jointAssetId)
    }
    wallRenderer.syncWallContainer(object, node, DYNAMIC_MESH_SIGNATURE_KEY)
    // --- 修复: 主动分配instanced mesh实例并写入userData，保证instanced mesh attach ---
    if (bodyAssetId && getCachedModelObject(bodyAssetId)) {
      // 分配实例绑定
      const binding = allocateModelInstance(bodyAssetId, node.id)
      if (binding) {
        object.userData = {
          ...(object.userData ?? {}),
          instancedAssetId: bodyAssetId,
          instancedBounds: getCachedModelObject(bodyAssetId)?.boundingBox,
        }
        syncInstancedTransform(object)
      }
    }
  } else if (node.dynamicMesh?.type === 'Floor') {
    const floorDefinition = node.dynamicMesh as FloorDynamicMesh
    let floorGroup = userData.floorGroup as THREE.Group | undefined
    if (!floorGroup) {
      floorGroup = createFloorGroup(floorDefinition)
      floorGroup.userData.nodeId = node.id
      floorGroup.userData[DYNAMIC_MESH_SIGNATURE_KEY] = computeFloorDynamicMeshSignature(floorDefinition)
      object.add(floorGroup)
      userData.floorGroup = floorGroup
    } else {
      const groupData = floorGroup.userData ?? (floorGroup.userData = {})
      const nextSignature = computeFloorDynamicMeshSignature(floorDefinition)
      if (groupData[DYNAMIC_MESH_SIGNATURE_KEY] !== nextSignature) {
        updateFloorGroup(floorGroup, floorDefinition)
        groupData[DYNAMIC_MESH_SIGNATURE_KEY] = nextSignature
      }
    }

  } else if (node.dynamicMesh?.type === 'GuideRoute') {
    const guideDefinition = node.dynamicMesh as GuideRouteDynamicMesh
    let guideGroup = userData.guideRouteGroup as THREE.Group | undefined
    if (!guideGroup) {
      guideGroup = createGuideRouteGroup(guideDefinition)
      guideGroup.userData.nodeId = node.id
      guideGroup.userData[DYNAMIC_MESH_SIGNATURE_KEY] = computeGuideRouteDynamicMeshSignature(guideDefinition)
      object.add(guideGroup)
      userData.guideRouteGroup = guideGroup
    } else {
      const groupData = guideGroup.userData ?? (guideGroup.userData = {})
      const nextSignature = computeGuideRouteDynamicMeshSignature(guideDefinition)
      if (groupData[DYNAMIC_MESH_SIGNATURE_KEY] !== nextSignature) {
        updateGuideRouteGroup(guideGroup, guideDefinition)
        groupData[DYNAMIC_MESH_SIGNATURE_KEY] = nextSignature
      }
    }

    void createOrUpdateGuideRouteWaypointLabels(node, object)
  } else if (node.dynamicMesh?.type === 'Road') {
    const roadDefinition = node.dynamicMesh as RoadDynamicMesh
    const junctionSmoothing = resolveRoadJunctionSmoothing(node)
    const laneLines = resolveRoadLaneLinesEnabled(node)
    const shoulders = resolveRoadShouldersEnabled(node)
    const materialConfigId = resolveRoadMaterialConfigId(node)
    const groundDefinition = resolveGroundDynamicMeshDefinition()
    const groundSignature = groundDefinition ? computeGroundDynamicMeshSignature(groundDefinition) : null
    const roadOptions = resolveRoadRenderOptionsForNodeId(node.id) ?? {
      junctionSmoothing,
      laneLines,
      shoulders,
      materialConfigId,
      heightSampler: null,
    }

    const groundNode = findGroundNodeInTree(sceneStore.nodes)
    const heightSamplerSignature = {
      roadPosition: node.position ?? null,
      roadRotation: node.rotation ?? null,
      groundPosition: groundNode?.position ?? null,
    }
    let roadGroup = userData.roadGroup as THREE.Group | undefined
    if (!roadGroup) {
      roadGroup = createRoadGroup(roadDefinition, roadOptions)
      roadGroup.userData.nodeId = node.id
      roadGroup.userData[DYNAMIC_MESH_SIGNATURE_KEY] = computeRoadDynamicMeshSignature(
        roadDefinition,
        junctionSmoothing,
        materialConfigId,
        laneLines,
        shoulders,
        typeof roadOptions.samplingDensityFactor === 'number' ? roadOptions.samplingDensityFactor : Number(roadOptions.samplingDensityFactor),
        typeof roadOptions.smoothingStrengthFactor === 'number' ? roadOptions.smoothingStrengthFactor : Number(roadOptions.smoothingStrengthFactor),
        typeof roadOptions.minClearance === 'number' ? roadOptions.minClearance : Number(roadOptions.minClearance),
        typeof roadOptions.laneLineWidth === 'number' ? roadOptions.laneLineWidth : Number(roadOptions.laneLineWidth),
        typeof roadOptions.shoulderWidth === 'number' ? roadOptions.shoulderWidth : Number(roadOptions.shoulderWidth),
        groundSignature,
        heightSamplerSignature,
      )
      object.add(roadGroup)
      userData.roadGroup = roadGroup
    } else {
      const groupData = roadGroup.userData ?? (roadGroup.userData = {})
      const nextSignature = computeRoadDynamicMeshSignature(
        roadDefinition,
        junctionSmoothing,
        materialConfigId,
        laneLines,
        shoulders,
        typeof roadOptions.samplingDensityFactor === 'number' ? roadOptions.samplingDensityFactor : Number(roadOptions.samplingDensityFactor),
        typeof roadOptions.smoothingStrengthFactor === 'number' ? roadOptions.smoothingStrengthFactor : Number(roadOptions.smoothingStrengthFactor),
        typeof roadOptions.minClearance === 'number' ? roadOptions.minClearance : Number(roadOptions.minClearance),
        typeof roadOptions.laneLineWidth === 'number' ? roadOptions.laneLineWidth : Number(roadOptions.laneLineWidth),
        typeof roadOptions.shoulderWidth === 'number' ? roadOptions.shoulderWidth : Number(roadOptions.shoulderWidth),
        groundSignature,
        heightSamplerSignature,
      )
      if (groupData[DYNAMIC_MESH_SIGNATURE_KEY] !== nextSignature) {
        updateRoadGroup(roadGroup, roadDefinition, roadOptions)
        groupData[DYNAMIC_MESH_SIGNATURE_KEY] = nextSignature
      }
    }

    // Keep road vertex handles stable through dynamic mesh updates.
    if (activeBuildTool.value === 'road') {
      const selectedId = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
      if (selectedId === node.id) {
        ensureRoadVertexHandlesForSelectedNode()
      }
    }
    if (roadGroup) {
      applyRoadOverlayMaterials(node, roadGroup)
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

  if (node.dynamicMesh?.type === 'Wall') {
    updateWallObjectProperties(object, node);
  }
}

function updateWallObjectProperties(object: THREE.Object3D, node: SceneNode) {
    const wallComponent = node.components?.[WALL_COMPONENT_TYPE] as
      | SceneNodeComponentState<WallComponentProps>
      | undefined

    const isAirWall = Boolean((wallComponent?.props as any)?.isAirWall)
    // 仅当object为THREE.Group时才调用
    if ((object as any).isGroup) {
      applyAirWallVisualToWallGroup(object as THREE.Group, isAirWall)
    }
}

function updateGroundChunkStreaming() {
  if (!camera) {
    return
  }

  const node = findGroundNodeInTree(sceneStore.nodes)
  if (!node || node.dynamicMesh?.type !== 'Ground') {
    return
  }

  const container = objectMap.get(node.id)
  const groundObject = (container?.userData?.groundMesh as THREE.Object3D | undefined) ?? undefined
  if (!groundObject) {
    return
  }

  updateGroundChunks(groundObject, node.dynamicMesh, camera)
}

function disposeGroundObjectGeometries(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      try {
        mesh.geometry?.dispose?.()
      } catch (_error) {
        /* noop */
      }
    }
  })
  object.clear()
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
        disposeGroundObjectGeometries(child)
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
  reconcileNodeList(sceneStore.nodes, rootGroup, encountered)

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
  terrainGridController.refresh()
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
      containerData.dynamicMeshType = 'Wall'

      const wallComponent = node.components?.[WALL_COMPONENT_TYPE] as
        | SceneNodeComponentState<WallComponentProps>
        | undefined
      const wallProps = clampWallProps(wallComponent?.props as Partial<WallComponentProps> | null | undefined)
      const bodyAssetId = wallProps.bodyAssetId ?? null
      const jointAssetId = wallProps.jointAssetId ?? null
      if (bodyAssetId && !getCachedModelObject(bodyAssetId)) {
        void ensureModelObjectCached(bodyAssetId)
      }
      if (jointAssetId && !getCachedModelObject(jointAssetId)) {
        void ensureModelObjectCached(jointAssetId)
      }
      wallRenderer.syncWallContainer(container, node, DYNAMIC_MESH_SIGNATURE_KEY)
    } else if (node.dynamicMesh?.type === 'Road') {
      containerData.dynamicMeshType = 'Road'
      const roadDefinition = node.dynamicMesh as RoadDynamicMesh
      const junctionSmoothing = resolveRoadJunctionSmoothing(node)
      const laneLines = resolveRoadLaneLinesEnabled(node)
      const shoulders = resolveRoadShouldersEnabled(node)
      const materialConfigId = resolveRoadMaterialConfigId(node)
      const groundDefinition = resolveGroundDynamicMeshDefinition()
      const groundSignature = groundDefinition ? computeGroundDynamicMeshSignature(groundDefinition) : null
      const roadOptions = resolveRoadRenderOptionsForNodeId(node.id) ?? {
        junctionSmoothing,
        laneLines,
        shoulders,
        materialConfigId,
        heightSampler: null,
      }

      const groundNode = findGroundNodeInTree(sceneStore.nodes)
      const heightSamplerSignature = {
        roadPosition: node.position ?? null,
        roadRotation: node.rotation ?? null,
        groundPosition: groundNode?.position ?? null,
      }
      const roadGroup = createRoadGroup(roadDefinition, roadOptions)
      roadGroup.removeFromParent()
      roadGroup.userData.nodeId = node.id
      roadGroup.userData[DYNAMIC_MESH_SIGNATURE_KEY] = computeRoadDynamicMeshSignature(
        roadDefinition,
        junctionSmoothing,
        materialConfigId,
        laneLines,
        shoulders,
        typeof roadOptions.samplingDensityFactor === 'number' ? roadOptions.samplingDensityFactor : Number(roadOptions.samplingDensityFactor),
        typeof roadOptions.smoothingStrengthFactor === 'number' ? roadOptions.smoothingStrengthFactor : Number(roadOptions.smoothingStrengthFactor),
        typeof roadOptions.minClearance === 'number' ? roadOptions.minClearance : Number(roadOptions.minClearance),
        typeof roadOptions.laneLineWidth === 'number' ? roadOptions.laneLineWidth : Number(roadOptions.laneLineWidth),
        typeof roadOptions.shoulderWidth === 'number' ? roadOptions.shoulderWidth : Number(roadOptions.shoulderWidth),
        groundSignature,
        heightSamplerSignature,
      )
      container.add(roadGroup)
      containerData.roadGroup = roadGroup
    } else if (node.dynamicMesh?.type === 'Floor') {
      containerData.dynamicMeshType = 'Floor'
      const floorDefinition = node.dynamicMesh as FloorDynamicMesh
      const floorGroup = createFloorGroup(floorDefinition)
      floorGroup.removeFromParent()
      floorGroup.userData.nodeId = node.id
      floorGroup.userData[DYNAMIC_MESH_SIGNATURE_KEY] = computeFloorDynamicMeshSignature(floorDefinition)

      const nd = (node as any).userData
      if (nd && nd.kind === 'building') {
        void createOrUpdateLabel(node, floorGroup)
      }
      container.add(floorGroup)
      containerData.floorGroup = floorGroup
    } else if (node.dynamicMesh?.type === 'GuideRoute') {
      containerData.dynamicMeshType = 'GuideRoute'
      const guideDefinition = node.dynamicMesh as GuideRouteDynamicMesh
      const guideGroup = createGuideRouteGroup(guideDefinition)
      guideGroup.removeFromParent()
      guideGroup.userData.nodeId = node.id
      guideGroup.userData[DYNAMIC_MESH_SIGNATURE_KEY] = computeGuideRouteDynamicMeshSignature(guideDefinition)
      container.add(guideGroup)
      ;(containerData as any).guideRouteGroup = guideGroup
      void createOrUpdateGuideRouteWaypointLabels(node, container)
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
  sceneStore.ensureCurrentSceneLoaded();
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
})

watch([sceneGraphStructureVersion, sceneNodePropertyVersion], () => {
  if (shouldDeferSceneGraphSync()) {
    pendingSceneGraphSync = true
    return
  }

  applyPendingScenePatches()
})

const cameraStateSignature = computed(() => {
  const state = props.cameraState
  if (!state) {
    return 'null'
  }
  return JSON.stringify({
    position: [state.position.x, state.position.y, state.position.z],
    target: [state.target.x, state.target.y, state.target.z],
    fov: state.fov,
  })
})

watch(cameraStateSignature, () => {
  applyCameraState(props.cameraState)
})

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
  if (!isBuildToolBlockedDuringGroundSculptConfig(tool)) {
    buildToolRightClickCandidate = null
    pointerInteraction.clearIfKind('buildToolRightClick')
  }
  if (tool !== 'wall') {
    wallBuildTool.cancel()
  }
  if (tool !== 'road') {
    roadBuildTool.cancel()
  }
})

watch(
  isGroundSculptConfigMode,
  (enabled, previous) => {
    if (!enabled || previous) {
      return
    }
    const tool = activeBuildTool.value
    if (isBuildToolBlockedDuringGroundSculptConfig(tool)) {
      cancelActiveBuildOperation()
    }
  },
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
        :can-drop-selection="canDropSelection"
        :can-align-selection="canAlignSelection"
        :can-rotate-selection="canRotateSelection"
        :can-erase-scatter="canUseScatterEraseTool"
        :canClearAllScatterInstances="selectedNodeIsGround"
        :scatter-erase-mode-active="scatterEraseModeActive"
          :scatter-erase-radius="scatterEraseRadius"
          :scatter-erase-menu-open="scatterEraseMenuOpen"
        :build-tools-disabled="buildToolsDisabled"
        :active-build-tool="activeBuildTool"
        @reset-camera="resetCameraView"
        @drop-to-ground="dropSelectionToGround"
        @align-selection="handleAlignSelection"
        @rotate-selection="handleRotateSelection"
        @capture-screenshot="handleCaptureScreenshot"
        @change-build-tool="handleBuildToolChange"
        @toggle-scatter-erase="toggleScatterEraseMode"
          @clear-all-scatter-instances="handleClearAllScatterInstances"
          @update-scatter-erase-radius="terrainStore.setScatterEraseRadius"
          @update:scatter-erase-menu-open="handleScatterEraseMenuOpen"
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
        <PlaceholderOverlayList
          :overlays="placeholderOverlayList"
          @retry="handlePlaceholderRetry"
          @cancel-delete="handlePlaceholderCancelDelete"
        />
      </div>
        <div v-show="showProtagonistPreview" class="protagonist-preview">
          <span class="protagonist-preview__label">主角视野</span>
        </div>
      <canvas ref="canvasRef" :class="['viewport-canvas', buildToolCursorClass]" />
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

.viewport-canvas.cursor-wall,
.viewport-canvas.cursor-wall:active {
  cursor: url('/cursors/wall.cur'), url('/cursors/wall.png') 16 16, crosshair !important;
}

.viewport-canvas.cursor-road,
.viewport-canvas.cursor-road:active {
  cursor: url('/cursors/road.cur'), url('/cursors/road.png') 16 16, cell !important;
}

.viewport-canvas.cursor-floor,
.viewport-canvas.cursor-floor:active {
  cursor: url('/cursors/floor.cur'), url('/cursors/floor.png') 16 16, copy !important;
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
