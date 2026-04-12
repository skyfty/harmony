<script setup lang="ts">
import { cloneGeometryForMirroredInstance } from '@schema/mirror'
import { addWallOpeningToDefinition, removeWallOpeningFromDefinition, compileWallSegmentsFromDefinition } from '@schema/wallLayout'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, reactive, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import * as THREE from 'three'
import { offsetPolyline } from '../../utils/overlayPlacementUtils'
import { SceneViewportCameraControls } from '@/utils/SceneViewportCameraControls'
import {
  isNodeExcludedFromSelectionBoundingBoxFallback,
  mergeUserDataWithDynamicMeshBuildShape,
  readFloorBuildShapeFromNode,
  readWallBuildShapeFromNode,
} from '@/utils/dynamicMeshBuildShapeUserData'
import {
  isWaterSurfaceNode,
  mergeUserDataWithWaterBuildShape,
  readWaterBuildShapeFromNode,
} from '@/utils/waterBuildShapeUserData'
import { useViewportPostprocessing } from './useViewportPostprocessing'
import { useDragPreview } from './useDragPreview'
import { useProtagonistPreview } from './useProtagonistPreview'
import { createNormalizedPointerGuard } from './normalizedPointerGuard'
import { createPointerCaptureGuard } from './pointerCaptureGuard'
import { usePointerInteractionStateMachine } from './usePointerInteractionStateMachine'
import { handlePointerDownGuards } from './pointer/downGuards'
import { handlePointerDownScatter } from './pointer/downScatter'
import { handlePointerDownTools } from './pointer/downTools'
import { handlePointerDownSelection } from './pointer/downSelection'
import { handlePointerMoveDrag, handlePointerMoveFloorEdgeDrag } from './pointer/moveDrag'
import { handlePointerMoveScatter } from './pointer/moveScatter'
import { handlePointerMoveTools } from './pointer/moveTools'
import { handlePointerMoveBuildTools } from './pointer/moveBuild'
import { handlePointerMoveSelection } from './pointer/moveSelection'
import { handlePointerUpDrag } from './pointer/upDrag'
import { handlePointerUpScatter } from './pointer/upScatter'
import { handlePointerUpTools } from './pointer/upTools'
import { handlePointerUpSelection } from './pointer/upSelection'
import type {
  InstancedEraseDragState,
  PointerDownResult,
  PointerMoveResult,
  PointerUpResult,
  FloorCircleCenterDragState,
  FloorCircleRadiusDragState,
  FloorThicknessDragState,
  FloorVertexDragState,
  RoadVertexDragState,
  WallEndpointDragState,
  WallJointDragState,
  WallHeightDragState,
  WallCircleCenterDragState,
  WallCircleRadiusDragState,
} from './pointer/types'

// @ts-ignore - local plugin has no .d.ts declaration file
import { TransformControls } from '@/utils/transformControls.js'
import Stats from 'three/examples/jsm/libs/stats.module.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'

// RectAreaLight support removed; no import from lightsRuntime required.

import type {
  SceneNode,
  SceneNodeComponentState,
  SceneMaterialTextureSlot,
  SceneMaterialTextureRef,
  SceneNodeMaterial,
  GradientBackgroundDome,
  GroundDynamicMesh,
  GroundGenerationMode,
  GroundGenerationSettings,
  GroundSculptOperation,
  RoadDynamicMesh,
  FloorDynamicMesh,
  LandformDynamicMesh,
  GuideRouteDynamicMesh,
  RegionDynamicMesh,
  WallDynamicMesh,
} from '@schema/index'
import {
  buildRegionDynamicMeshFromLocalVertices,
  createGradientBackgroundDome,
  disposeGradientBackgroundDome,
  disposeSkyCubeTexture,
  extractSkycubeZipFaces,
  getLastExtensionFromFilenameOrUrl,
  isHdriLikeExtension,
  isVideoLikeExtension,
  loadSkyCubeTexture,
} from '@schema/index'
import {
  createSceneCsmShadowRuntime,
  DEFAULT_SCENE_CSM_CONFIG,
  DEFAULT_SCENE_CSM_SUN_AZIMUTH_DEG,
  DEFAULT_SCENE_CSM_SUN_ELEVATION_DEG,
  resolveSceneCsmSunPositionFromAngles,
  type SceneCsmConfig,
  type SceneCsmShadowRuntime,
} from '@schema/sceneCsm'
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
import { useGroundPaintStore } from '@/stores/groundPaintStore'
import { useGroundScatterStore } from '@/stores/groundScatterStore'
import { useGroundHeightmapStore, type GroundRuntimeDynamicMesh } from '@/stores/groundHeightmapStore'
import { useNodePickerStore } from '@/stores/nodePickerStore'
import type { ProjectAsset } from '@/types/project-asset'
import type { SceneCameraState } from '@/types/scene-camera-state'

import type { EditorTool } from '@/types/editor-tool'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { useUiStore } from '@/stores/uiStore'
import { useBuildToolsStore } from '@/stores/buildToolsStore'
import { createWarpGateNode } from '@/stores/warpGateNodeUtils'

import {
  getCachedModelObject,
  getOrLoadModelObject,
  allocateModelInstance,
  allocateModelInstanceBinding,
  releaseModelInstance,
  releaseModelInstanceBinding,
  ensureInstancedMeshesRegistered,
  subscribeInstancedMeshes,
  getModelInstanceBindingsForNode,
  getModelInstanceBindingById,
  updateModelInstanceMatrix,
  updateModelInstanceBindingMatrix,
  findBindingIdForInstance,
  findNodeIdForInstance,
} from '@schema/modelObjectCache'
import {
  allocateBillboardInstance,
  allocateBillboardInstanceBinding,
  getBillboardAspectRatio,
  releaseBillboardInstance,
  subscribeBillboardInstancedMeshes,
} from '@schema/instancedBillboardCache'
import { resolveLodRenderTarget } from '@schema/components'
// duplicate import removed
import {
  clampSceneNodeInstanceLayout,
  computeInstanceLayoutLocalBoundingBox,
  forEachInstanceWorldMatrix,
  getInstanceLayoutBindingId,
  getInstanceLayoutCount,
  resolveInstanceLayoutTemplateAssetId,
} from '@schema/instanceLayout'
import {
  buildContinuousInstancedModelUserDataPatchV2,
  buildLinearLocalPositions,
  getContinuousInstancedModelUserData,
  syncContinuousInstancedModelCommitted,
} from '@schema/continuousInstancedModel'
import { flush as flushInstancedBounds, hasPending as instancedBoundsHasPending } from '@schema/instancedBoundsTracker'
import { loadObjectFromFile } from '@schema/assetImport'
import { createInstancedBvhFrustumCuller } from '@schema/instancedBvhFrustumCuller'
import { createUvDebugMaterial } from '@schema/debugTextures'
import {
  syncWallInstancedBindingsForObject,
  WALL_INSTANCED_BINDINGS_USERDATA_KEY,
  type WallInstancedBindingSpec,
} from '@schema/wallInstancing'
import { applyMirroredScaleToObject, syncMirroredMeshMaterials } from '@schema/mirror'
import { createPrimitiveMesh, PROTAGONIST_NODE_ID } from '@schema/index'


import type { TransformUpdatePayload } from '@/types/transform-update-payload'
import { createRoadNodeMaterials } from '@/utils/roadNodeMaterials'
import { buildFloorNodeMaterialsFromPreset } from '@/utils/floorPresetNodeMaterials'
import { buildLandformNodeMaterialsFromPreset } from '@/utils/landformPresetNodeMaterials'
import { buildWallNodeMaterialsFromPreset } from '@/utils/wallPresetNodeMaterials'
import { isWallPresetFilename } from '@/utils/wallPreset'
import { collectFloorPresetDependencyAssetIds } from '@/stores/floorPresetActions'
import { collectLandformPresetDependencyAssetIds } from '@/stores/landformPresetActions'
import { collectRoadPresetDependencyAssetIds } from '@/stores/roadPresetActions'
import { collectWallPresetDependencyAssetIds } from '@/stores/wallPresetActions'
import { isSceneAssetRegistry } from '@/utils/assetDependencySubset'
import type { PanelPlacementState } from '@/types/panel-placement-state'
import ViewportToolbar from './ViewportToolbar.vue'
import TransformToolbar from './TransformToolbar.vue'
import PlaceholderOverlayList from './PlaceholderOverlayList.vue'
import AssetPickerDialog from '@/components/common/AssetPickerDialog.vue'
import CsmSunMenuContent from '@/components/editor/CsmSunMenuContent.vue'
import {
  buildViewportPlacementPreview,
  getViewportPlacementKey,
  type ViewportPlacementItem,
} from './viewportPlacementCatalog'
import { createGroundEditor } from './GroundEditor'
import { resolveGroundRuntimeObject, resolveGroundRuntimeObjectFromMap } from './groundRuntimeObject'
import { TRANSFORM_TOOLS } from '@/types/scene-transform-tools'
import { type AlignMode } from '@/types/scene-viewport-align-mode'
import type { AlignCommand, ArrangeDirection, WorldAlignMode } from '@/types/scene-viewport-align-command'
import type { NodeHitResult } from '@/types/scene-viewport-node-hit-result'
import type { PointerTrackingState } from '@/types/scene-viewport-pointer-tracking-state'
import type { TransformGroupEntry, TransformGroupState } from '@/types/scene-viewport-transform-group'
import type { BuildTool } from '@/types/build-tool'
import type { FloorBuildShape } from '@/types/floor-build-shape'
import type { LandformBuildShape } from '@/types/landform-build-shape'
import type { WaterBuildShape } from '@/types/water-build-shape'
import type { WallBuildShape } from '@/types/wall-build-shape'
import {
  analyzeGroundOptimizedMeshUsage,
  createGroundMesh,
  areAllGroundChunksLoaded,
  ensureAllGroundChunks,
  isGroundChunkStreamingEnabled,
  resolveGroundRuntimeChunkCells,
  setGroundRuntimeOptimizedChunksEnabled,
  updateGroundMesh,
  releaseGroundMeshCache,
  sampleGroundHeight,
} from '@schema/groundMesh'
import {
  createDefaultGroundSurfacePreviewLoaders,
  syncGroundSurfaceLiveChunkPreviews,
  syncGroundSurfacePreviewForGround,
  type GroundSurfaceLiveChunkPreview,
} from '@schema/groundSurfacePreview'
// resolveEnabledComponentState removed from here; import not used
import { createRoadGroup, updateRoadGroup } from '@schema/roadMesh'
import { createFloorGroup, updateFloorGroup } from '@schema/floorMesh'
import { createGuideRouteGroup, updateGuideRouteGroup } from '@schema/guideRouteMesh'
import { useTerrainStore, type GroundPanelTab, type TerrainPaintBrushSettings } from '@/stores/terrainStore'
import type { TerrainScatterBrushShape, TerrainScatterCategory } from '@schema/terrain-scatter'
import { hashString, stableSerialize } from '@schema/stableSerialize'
import { ViewportGizmo } from '@/utils/gizmo/ViewportGizmo'
import { TerrainGridHelper } from './TerrainGridHelper'
import { useTerrainGridController } from './useTerrainGridController'
import { createGuideRouteWaypointLabelsManager, getGuideRouteWaypointLabelMeshes } from './GuideRouteWaypointLabels'
import { createWallBuildTool } from './WallBuildTool'
import {
  computeWallOpeningForLocalHit,
  findContainingWallOpeningIndex,
} from './wallSegmentUtils'
import {
  createWallEraseController,
  extractWallRepeatInstanceMeta,
  mergeWallRepeatErasedSlots,
  resolveSelectedWallRenderMode,
} from './wallEraseController'
import { createWallEraseHoverPresenter } from './wallEraseHoverPresenter'
import {
  createWallDoorSelectionController,
  type WallDoorRectangleSelectionState,
  type WallDoorSelectionPayload,
} from './wallDoorSelectionController'
import { createRoadBuildTool } from './RoadBuildTool'
import { createFloorBuildTool } from './FloorBuildTool'
import { createLandformBuildTool } from './LandformBuildTool'
import { createRegionBuildTool } from './RegionBuildTool'
import { createWaterBuildTool } from './WaterBuildTool'
import { createDisplayBoardBuildTool } from './DisplayBoardBuildTool'
import { createBuildStartIndicatorRenderer } from './BuildStartIndicatorRenderer'
import {
  buildClosedWallSegmentsFromWorldPoints,
  buildOpenWallSegmentsFromWorldPoints,
  resolveAutoOverlayBuildPlan,
  type AutoOverlayBuildPlan,
} from './autoOverlayBuild'
import { createCameraResetDirectionController, type CameraResetDirection } from './cameraResetDirection'
import { computeWorldUnitsPerPixel } from './handleScreenScaleUtils'
import {
  createRoadVertexRenderer,
  ROAD_VERTEX_HANDLE_GROUP_NAME,
  ROAD_VERTEX_HANDLE_Y,
  type RoadVertexHandlePickResult,
} from './RoadVertexRenderer'
import {
  createWallEndpointRenderer,
  type WallEndpointHandlePickResult,
  WALL_ENDPOINT_HANDLE_GROUP_NAME,
  WALL_ENDPOINT_HANDLE_Y_OFFSET,
} from './WallEndpointRenderer'
import { createFloorVertexRenderer, FLOOR_VERTEX_HANDLE_GROUP_NAME, FLOOR_VERTEX_HANDLE_Y } from './FloorVertexRenderer'
import { createLandformVertexRenderer, type LandformVertexHandlePickResult } from './LandformVertexRenderer'
import { createRegionVertexRenderer, type RegionVertexHandlePickResult } from './RegionVertexRenderer'
import { createDisplayBoardCornerHandleRenderer, type DisplayBoardCornerHandlePickResult } from './DisplayBoardCornerHandleRenderer'
import { createWaterVertexRenderer, type WaterVertexHandlePickResult } from './WaterVertexRenderer'
import { createWaterCircleHandleRenderer, type WaterCircleHandlePickResult } from './WaterCircleHandleRenderer'
import {
  createFloorCircleHandleRenderer,
  type FloorCircleHandlePickResult,
} from './FloorCircleHandleRenderer'
import {
  computeRegionDynamicMeshSignature,
  createRegionEditorGroup,
  updateRegionEditorGroup,
} from './RegionEditorGroup'
import {
  buildWaterCircleLocalPoints,
  buildWaterSurfaceMetadataFromLocalPoints,
  computeWaterContourSignature,
  computeWaterCircleLocalFromPoints,
  getWaterSurfaceMeshMetadata,
  getWaterContourLocalPoints,
  updateWaterSurfaceRuntimeMesh,
} from './waterSurfaceEditUtils'
import { pickNearestPlanarEdge } from './planarEditMath'
import {
  VIEW_POINT_COMPONENT_TYPE,
  DISPLAY_BOARD_COMPONENT_TYPE,
  WARP_GATE_COMPONENT_TYPE,
  GUIDEBOARD_COMPONENT_TYPE,
  BEHAVIOR_COMPONENT_TYPE,
  VEHICLE_COMPONENT_TYPE,
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

} from '@schema/components'
import type { EnvironmentCsmSettings, EnvironmentSettings } from '@/types/environment'
import { createEffectPlaybackManager } from './effectPlaybackManager'
import { usePlaceholderOverlayController } from './placeholderOverlayController'
import { useToolbarPositioning } from './useToolbarPositioning'
import { useScenePicking } from './useScenePicking'
import { useSnapController, type VertexSnapResult, type PlacementSnapResult } from '@/components/editor/useSnapController'
import { createPickProxyManager } from './PickProxyManager'
import { createInstancedOutlineManager } from './InstancedOutlineManager'
import { createWallRenderer,applyAirWallVisualToWallGroup } from './WallRenderer'
import { createDirectionalLightTargetHandleManager } from './DirectionalLightTargetHandle'
import { lockDirectionalLightTargetWorldPosition, syncLightFromNodeDuringDrag } from './realtimeLightSync'
import {
  type VectorCoordinates,
  cloneVectorCoordinates,
  computeOrientedGroundRectFromObject,
  snapVectorToGrid,
  snapVectorToMajorGrid,
  filterTopLevelSelection,
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
  CLICK_DRAG_THRESHOLD_PX,
  ASSET_DRAG_MIME,
  MIN_CAMERA_HEIGHT,
  MIN_TARGET_HEIGHT,
  GRID_MAJOR_SPACING,
  GRID_HIGHLIGHT_HEIGHT,
  GRID_HIGHLIGHT_PADDING,
  GRID_HIGHLIGHT_MIN_SIZE,
  DEFAULT_GRID_HIGHLIGHT_SIZE,
  DEFAULT_GRID_HIGHLIGHT_DIMENSIONS,
  DIRECTIONAL_LIGHT_HELPER_SIZE,
  DEFAULT_CAMERA_POSITION,
  DEFAULT_CAMERA_TARGET,
  DEFAULT_PERSPECTIVE_FOV,
  RIGHT_CLICK_ROTATION_STEP,
} from './constants'
// face/surface snap controllers removed: no alignment hint UI
import {
  createProtagonistInitialVisibilityCapture,
  type ProtagonistInitialVisibilityCapture,
} from './protagonistInitialVisibilityCapture'

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

function canCompleteNodePick(nodeId: string): boolean {
  if (nodePickerStore.owner !== 'steer-target') {
    return true
  }
  const node = findSceneNode(sceneStore.nodes, nodeId)
  return Boolean(node?.components?.[VEHICLE_COMPONENT_TYPE]?.enabled)
}

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
const {
  brushRadius,
  brushStrength,
  brushDepth,
  brushSlope,
  brushShape,
  brushOperation,
  groundPanelTab,
  paintSelectedAsset,
  paintBrushSettings,
  scatterCategory,
  scatterSelectedAsset,
  scatterProviderAssetId,
  scatterBrushRadius,
  scatterBrushShape,
  scatterRegularPolygonSides,
  scatterSpacing,
  scatterEraseRadius,
  scatterDensityPercent,
} =
  storeToRefs(terrainStore)

const hasGroundNode = computed(() => {
  const ground = sceneStore.groundNode
  return Boolean(ground && ground.dynamicMesh?.type === 'Ground')
})

const groundDefinition = computed(() => {
  const ground = sceneStore.groundNode
  if (!ground || ground.dynamicMesh?.type !== 'Ground') {
    return null
  }
  return ground.dynamicMesh as GroundDynamicMesh
})

const groundNoiseStrength = ref(1)
const groundNoiseMode = ref<GroundGenerationMode>('perlin')
let syncingGroundGeneration = false

function clampGroundNoiseStrength(value: number): number {
  if (!Number.isFinite(value)) {
    return 1
  }
  return Math.min(5, Math.max(0, Number(value)))
}

function buildGroundGenerationPayload(definition?: GroundDynamicMesh | null): GroundGenerationSettings {
  const fallback: GroundGenerationSettings = {
    mode: 'perlin',
    noiseScale: Math.max(10, definition?.width ?? 80),
    noiseAmplitude: 6,
    noiseStrength: 1,
  }
  if (!definition?.generation) {
    return fallback
  }
  return {
    ...fallback,
    ...definition.generation,
  }
}

function applyGroundGenerationPatch(patch: Partial<GroundGenerationSettings>) {
  const ground = sceneStore.groundNode
  if (!ground || ground.dynamicMesh?.type !== 'Ground') {
    return
  }
  const definition = ground.dynamicMesh as GroundDynamicMesh
  const nextGeneration: GroundGenerationSettings = {
    ...buildGroundGenerationPayload(definition),
    ...patch,
  }
  nextGeneration.worldWidth = definition.width
  nextGeneration.worldDepth = definition.depth
  sceneStore.updateGroundNodeDynamicMesh(ground.id, { generation: nextGeneration })
}

watch(
  groundDefinition,
  (definition) => {
    syncingGroundGeneration = true
    const generation = definition?.generation
    groundNoiseStrength.value = clampGroundNoiseStrength(generation?.noiseStrength ?? 1)
    groundNoiseMode.value = generation?.mode ?? 'perlin'
    nextTick(() => {
      syncingGroundGeneration = false
    })
  },
  { immediate: true },
)

watch(groundNoiseStrength, (value) => {
  if (syncingGroundGeneration || !hasGroundNode.value) {
    return
  }
  applyGroundGenerationPatch({ noiseStrength: clampGroundNoiseStrength(value) })
})

watch(groundNoiseMode, (mode) => {
  if (syncingGroundGeneration || !hasGroundNode.value) {
    return
  }
  applyGroundGenerationPatch({ mode })
})

watch(hasGroundNode, (hasGround, prevHasGround) => {
  if (prevHasGround && !hasGround) {
    terrainStore.setBrushOperation(null)
    terrainStore.setGroundPanelTab('terrain')
    terrainStore.setPaintSelection(null)
    terrainStore.setScatterSelection({ asset: null, providerAssetId: null })
  }
}, { flush: 'sync' })

const groundScatterRuntimeVersion = computed(() => {
  const sceneId = typeof sceneStore.currentSceneId === 'string' ? sceneStore.currentSceneId.trim() : ''
  if (!sceneId) {
    return 0
  }
  return useGroundScatterStore().getSceneRuntimeVersion(sceneId)
})

const groundScatterRuntimeReason = computed(() => {
  const sceneId = typeof sceneStore.currentSceneId === 'string' ? sceneStore.currentSceneId.trim() : ''
  if (!sceneId) {
    return 'none'
  }
  return useGroundScatterStore().getSceneRuntimeReason(sceneId)
})

const groundPaintRuntimeVersion = computed(() => {
  const sceneId = typeof sceneStore.currentSceneId === 'string' ? sceneStore.currentSceneId.trim() : ''
  if (!sceneId) {
    return 0
  }
  return useGroundPaintStore().getSceneRuntimeVersion(sceneId)
})

const groundPaintRuntimeReason = computed(() => {
  const sceneId = typeof sceneStore.currentSceneId === 'string' ? sceneStore.currentSceneId.trim() : ''
  if (!sceneId) {
    return 'none'
  }
  return useGroundPaintStore().getSceneRuntimeReason(sceneId)
})

const viewportEl = ref<HTMLDivElement | null>(null)
const surfaceRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const gizmoContainerRef = ref<HTMLDivElement | null>(null)
const statsHostRef = ref<HTMLDivElement | null>(null)

const raycaster = new THREE.Raycaster()
const dropRaycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const objectMap = new Map<string, THREE.Object3D>()
const instancedMeshes: THREE.InstancedMesh[] = []
const rootGroup = new THREE.Group()
rootGroup.name = 'SceneRoot'

// TransformControls expects its attached object to be part of the scene graph.
// For multi-selection transforms we attach to this editor-only pivot object (centroid).
const selectionPivotObject = new THREE.Object3D()
selectionPivotObject.name = 'SelectionPivot'
selectionPivotObject.userData = { editorOnly: true, isSelectionPivot: true }
rootGroup.add(selectionPivotObject)

// DirectionalLight editing: keep the gizmo near the light target (usually near the scene)
// so users don't need to fly the camera to extremely high light positions.
const directionalLightTargetPivotObject = new THREE.Object3D()
directionalLightTargetPivotObject.name = 'DirectionalLightTargetPivot'
directionalLightTargetPivotObject.userData = {
  editorOnly: true,
  isDirectionalLightTargetPivot: true,
  suppressGridHighlight: true,
}
// This object is editor-only and should never be pickable.
;(directionalLightTargetPivotObject as any).raycast = () => {}
rootGroup.add(directionalLightTargetPivotObject)

const instancedMeshGroup = new THREE.Group()
instancedMeshGroup.name = 'InstancedMeshGroup'
const instancedOutlineGroup = new THREE.Group()
instancedOutlineGroup.name = 'InstancedOutlineGroup'

const PICK_MAX_DISTANCE_DEFAULT = 5000
function resolveCameraFarPickDistance(): number | null {
  const far = camera?.far
  return typeof far === 'number' && Number.isFinite(far) && far > 0 ? far : null
}

function getPickMaxDistance() {
  const raw = (window as any).__HARMONY_PICK_MAX_DISTANCE__
  const n = Number(raw)
  if (Number.isFinite(n) && n > 0) {
    return n
  }
  const cameraFar = resolveCameraFarPickDistance()
  return cameraFar ?? PICK_MAX_DISTANCE_DEFAULT
}
let protagonistInitialVisibilityCapture: ProtagonistInitialVisibilityCapture | null = null

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

const instancedHoverRestoreMaterial = new THREE.MeshBasicMaterial({
  color: 0x43a047,
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
  depthTest: false,
})
instancedHoverRestoreMaterial.toneMapped = false

const { ensureInstancedPickProxy, removeInstancedPickProxy } = createPickProxyManager()

// Debug bounds visualization removed

type InstanceLayoutMatrixCacheEntry = {
  bindingKey: string
  elements: Float32Array
}

const instanceLayoutMatrixCache = new Map<string, InstanceLayoutMatrixCacheEntry>()

function findNearestInstanceLayoutGridIndexAtWorldPoint(params: {
  object: THREE.Object3D
  layout: ReturnType<typeof clampSceneNodeInstanceLayout>
  hitWorld: THREE.Vector3
  maxDistanceWorld: number
}): number | null {
  const { object, layout, hitWorld } = params
  if (!layout || layout.mode !== 'grid') {
    return null
  }

  const desiredCount = getInstanceLayoutCount(layout)
  if (desiredCount <= 1) {
    return null
  }

  object.updateWorldMatrix(true, true)
  const userData = object.userData as any
  const locals = (userData?.__harmonyInstanceLayoutCache?.locals as THREE.Matrix4[] | undefined) ?? null
  if (!Array.isArray(locals) || !locals.length) {
    return null
  }

  const inv = new THREE.Matrix4().copy(object.matrixWorld).invert()
  const localHit = hitWorld.clone().applyMatrix4(inv)

  const tempPosLocal = new THREE.Vector3()
  const tempPosWorld = new THREE.Vector3()
  const maxDist = Math.max(0.01, Number.isFinite(params.maxDistanceWorld) ? params.maxDistanceWorld : 0)
  const maxDistSq = maxDist * maxDist

  let bestIndex: number | null = null
  let bestDistSq = Number.POSITIVE_INFINITY

  const limit = Math.min(desiredCount, locals.length)
  for (let index = 1; index < limit; index += 1) {
    const localMatrix = locals[index]
    if (!localMatrix) {
      continue
    }
    tempPosLocal.setFromMatrixPosition(localMatrix)
    const distSq = tempPosLocal.distanceToSquared(localHit)
    if (distSq < bestDistSq) {
      bestDistSq = distSq
      bestIndex = index
    }
  }

  if (bestIndex === null) {
    return null
  }

  // Guard against snapping to a far-away instance when the cursor is outside the grid.
  const bestLocal = locals[bestIndex]
  if (bestLocal) {
    tempPosWorld.setFromMatrixPosition(bestLocal).applyMatrix4(object.matrixWorld)
    if (tempPosWorld.distanceToSquared(hitWorld) > maxDistSq) {
      return null
    }
  }

  return bestIndex
}

function buildModelInstanceBindingKey(binding: { slots: Array<{ mesh: THREE.InstancedMesh; index: number }> }): string {
  return binding.slots.map((slot) => `${slot.mesh.uuid}:${slot.index}`).join('|')
}

function matrixElementsEqual(a: Float32Array, b: ArrayLike<number>, epsilon = 1e-7): boolean {
  for (let i = 0; i < 16; i += 1) {
    if (Math.abs(a[i]! - (b[i] ?? 0)) > epsilon) {
      return false
    }
  }
  return true
}

function copyMatrixElements(target: Float32Array, source: ArrayLike<number>): void {
  for (let i = 0; i < 16; i += 1) {
    target[i] = source[i] ?? 0
  }
}

function clearInstanceLayoutMatrixCacheForNode(nodeId: string): void {
  instanceLayoutMatrixCache.delete(nodeId)
  const prefix = `${nodeId}:instance:`
  for (const key of instanceLayoutMatrixCache.keys()) {
    if (key.startsWith(prefix)) {
      instanceLayoutMatrixCache.delete(key)
    }
  }
}

function updateInstanceLayoutMatrixIfChanged(bindingId: string, nodeId: string, matrix: THREE.Matrix4): void {
  const binding = getModelInstanceBindingById(bindingId)
  if (!binding) {
    instanceLayoutMatrixCache.delete(bindingId)
    return
  }

  const bindingKey = buildModelInstanceBindingKey(binding as any)
  const cached = instanceLayoutMatrixCache.get(bindingId)
  if (cached && cached.bindingKey === bindingKey && matrixElementsEqual(cached.elements, matrix.elements)) {
    return
  }

  const entry = cached ?? { bindingKey, elements: new Float32Array(16) }
  entry.bindingKey = bindingKey
  copyMatrixElements(entry.elements, matrix.elements)
  instanceLayoutMatrixCache.set(bindingId, entry)

  if (bindingId === nodeId) {
    updateModelInstanceMatrix(nodeId, matrix)
  } else {
    updateModelInstanceBindingMatrix(bindingId, matrix)
  }
}

const INSTANCE_LAYOUT_INTERNAL_NAME_PARTS = ['PickProxy', 'Outline', 'InstancedOutline']

function isInternalViewportObjectName(name: unknown): boolean {
  if (typeof name !== 'string' || !name) {
    return false
  }
  return INSTANCE_LAYOUT_INTERNAL_NAME_PARTS.some((part) => name.includes(part))
}

function findFirstRenderableMeshChild(root: THREE.Object3D): THREE.Mesh | null {
  const stack: THREE.Object3D[] = [...root.children]
  while (stack.length) {
    const current = stack.shift()
    if (!current) {
      continue
    }
    if (isInternalViewportObjectName(current.name)) {
      continue
    }
    const mesh = current as THREE.Mesh
    if (mesh?.isMesh) {
      return mesh
    }
    if (current.children?.length) {
      stack.unshift(...current.children)
    }
  }
  return null
}

function applyInstanceLayoutVisibilityAndAssetBinding(object: THREE.Object3D, node: SceneNode): {
  layout: ReturnType<typeof clampSceneNodeInstanceLayout>
  instanceCount: number
  templateAssetId: string | null
  active: boolean
} {
  const userData = object.userData ?? (object.userData = {})
  const layout = clampSceneNodeInstanceLayout(node.instanceLayout ?? null)
  const instanceCount = layout ? getInstanceLayoutCount(layout) : 1
  // Treat grid layouts as instanced-rendered even when instanceCount === 1.
  // This avoids a transient state where the template mesh is hidden and the instanced
  // binding is not updated, which can cause the model to disappear until a reload.
  const templateAssetId = layout && layout.mode === 'grid' ? resolveInstanceLayoutTemplateAssetId(layout, node.sourceAssetId) : null
  const active = Boolean(layout && layout.mode === 'grid' && templateAssetId)

  if (active && templateAssetId) {
    const wasInjected = Boolean(userData.__harmonyInstanceLayoutInjectedInstancedAssetId)
    if (!wasInjected) {
      userData.__harmonyInstanceLayoutPreviousInstancedAssetId = userData.instancedAssetId
      userData.__harmonyInstanceLayoutInjectedInstancedAssetId = true
      // Default to rendering the template asset until LOD (or other systems) switch it.
      userData.instancedAssetId = templateAssetId
    }
    userData.__harmonyInstanceLayoutTemplateAssetId = templateAssetId

    const currentAssetId = typeof userData.instancedAssetId === 'string' ? userData.instancedAssetId.trim() : ''
    if (!currentAssetId) {
      userData.instancedAssetId = templateAssetId
    }

    const activeAssetId = typeof userData.instancedAssetId === 'string' ? userData.instancedAssetId : templateAssetId

    const cached = getCachedModelObject(activeAssetId)
    if (!cached) {
      void ensureModelObjectCached(activeAssetId)
    } else {
      ensureInstancedMeshesRegistered(activeAssetId)
    }

    if (!userData.__harmonyInstanceLayoutHiddenMesh) {
      const templateMesh = findFirstRenderableMeshChild(object)
      if (templateMesh) {
        userData.__harmonyInstanceLayoutHiddenMesh = templateMesh
        userData.__harmonyInstanceLayoutHiddenMeshWasVisible = templateMesh.visible
        templateMesh.visible = false
      }
    }
  } else {
    if (userData.__harmonyInstanceLayoutHiddenMesh) {
      const mesh = userData.__harmonyInstanceLayoutHiddenMesh as THREE.Mesh
      const wasVisible = Boolean(userData.__harmonyInstanceLayoutHiddenMeshWasVisible)
      mesh.visible = wasVisible
      delete userData.__harmonyInstanceLayoutHiddenMesh
      delete userData.__harmonyInstanceLayoutHiddenMeshWasVisible
    }

    if (userData.__harmonyInstanceLayoutInjectedInstancedAssetId) {
      const previous = userData.__harmonyInstanceLayoutPreviousInstancedAssetId
      if (typeof previous === 'undefined') {
        delete userData.instancedAssetId
      } else {
        userData.instancedAssetId = previous
      }
      delete userData.__harmonyInstanceLayoutInjectedInstancedAssetId
      delete userData.__harmonyInstanceLayoutPreviousInstancedAssetId
      delete userData.__harmonyInstanceLayoutTemplateAssetId
      delete userData.__harmonyInstanceLayoutCache
      clearInstanceLayoutMatrixCacheForNode(node.id)
      // Release any layout-authored bindings.
      releaseModelInstance(node.id)
    } else if (layout && instanceCount <= 1) {
      // Layout disabled or single-instance: drop any stale extra bindings.
      const bindings = getModelInstanceBindingsForNode(node.id)
      bindings.forEach((binding) => {
        if (binding.bindingId !== node.id) {
          releaseModelInstanceBinding(binding.bindingId)
          instanceLayoutMatrixCache.delete(binding.bindingId)
        }
      })
    }
  }

  return { layout, instanceCount, templateAssetId, active }
}

function syncInstanceLayoutInstancedMatrices(params: {
  nodeId: string
  object: THREE.Object3D
  assetId: string
  layout: NonNullable<ReturnType<typeof clampSceneNodeInstanceLayout>>
  baseMatrixWorld: THREE.Matrix4
}): void {
  const { nodeId, object, assetId, layout, baseMatrixWorld } = params

  const cached = getCachedModelObject(assetId)
  if (!cached) {
    void ensureModelObjectCached(assetId)
    return
  }
  ensureInstancedMeshesRegistered(assetId)

  const desiredCount = getInstanceLayoutCount(layout)
  const erased = layout.mode === 'grid' && Array.isArray((layout as any).erasedIndices) && (layout as any).erasedIndices.length
    ? new Set<number>((layout as any).erasedIndices as number[])
    : null
  const desiredBindingIds = new Set<string>()
  for (let index = 0; index < desiredCount; index += 1) {
    if (erased?.has(index)) {
      continue
    }
    desiredBindingIds.add(getInstanceLayoutBindingId(nodeId, index))
  }

  const existingBindings = getModelInstanceBindingsForNode(nodeId)
  existingBindings.forEach((binding) => {
    if (!desiredBindingIds.has(binding.bindingId)) {
      releaseModelInstanceBinding(binding.bindingId)
      instanceLayoutMatrixCache.delete(binding.bindingId)
    }
  })

  for (const bindingId of desiredBindingIds) {
    const binding = allocateModelInstanceBinding(assetId, bindingId, nodeId)
    if (!binding) {
      return
    }
  }

  const bounds = computeInstanceLayoutLocalBoundingBox(layout, cached.boundingBox) ?? cached.boundingBox.clone()
  const userData = object.userData ?? (object.userData = {})
  userData.instancedBounds = serializeBoundingBox(bounds)
  bounds.getBoundingSphere(instancedCullingSphere)
  userData.__harmonyInstancedRadius = instancedCullingSphere.radius

  const cache = userData.__harmonyInstanceLayoutCache as { signature: string | null; locals: THREE.Matrix4[] } | undefined
  const next = forEachInstanceWorldMatrix({
    nodeId,
    baseMatrixWorld,
    layout,
    templateBoundingBox: cached.boundingBox,
    cache,
    onMatrix: (bindingId, worldMatrix) => {
      updateInstanceLayoutMatrixIfChanged(bindingId, nodeId, worldMatrix as unknown as THREE.Matrix4)
    },
  })

  userData.__harmonyInstanceLayoutCache = { signature: next.signature, locals: next.locals as unknown as THREE.Matrix4[] }
}

let scene: THREE.Scene | null = null
let renderer: THREE.WebGLRenderer | null = null
let camera: THREE.PerspectiveCamera | null = null
let perspectiveCamera: THREE.PerspectiveCamera | null = null
let mapControls: SceneViewportCameraControls | null = null
let transformControls: TransformControls | null = null
let transformControlsDirty = false
let gizmoControls: ViewportGizmo | null = null
let stats: Stats | null = null
let statsPointerHandler: (() => void) | null = null
let statsPanelIndex = 0
let stopInstancedMeshSubscription: (() => void) | null = null
let stopBillboardMeshSubscription: (() => void) | null = null
let gridHighlight: THREE.Group | null = null
let pendingEnvironmentSettings: EnvironmentSettings | null = null
let latestFogSettings: EnvironmentSettings | null = null
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
  getPerformanceMode: () => Boolean(environmentSettings.value.viewportPerformanceMode),
})
let backgroundTexture: THREE.Texture | null = null
let backgroundAssetId: string | null = null
let backgroundAssetKey: string | null = null
let skyCubeTexture: THREE.CubeTexture | null = null
let skyCubeSourceFormat: 'faces' | 'zip' = 'faces'
let skyCubeFaceAssetIds: Array<string | null> = [null, null, null, null, null, null]
let skyCubeFaceKeys: Array<string | null> = [null, null, null, null, null, null]
let gradientBackgroundDome: GradientBackgroundDome | null = null
let skyCubeZipAssetId: string | null = null
let skyCubeZipAssetKey: string | null = null
let skyCubeZipFaceUrlCleanup: (() => void) | null = null
let backgroundLoadToken = 0
let lastGroundSurfacePreviewRequestKey: string | null = null
let lastTerrainPaintSurfacePreviewRequestKey: string | null = null

// Ground preview request invalidation not required here; helper removed.

function bumpGroundSurfacePreviewTokenIfNeeded(requestKey: string): void {
  if (!requestKey) {
    return
  }
  if (lastGroundSurfacePreviewRequestKey === requestKey) {
    return
  }
  lastGroundSurfacePreviewRequestKey = requestKey
}

function disposeGradientBackgroundResources() {
  disposeGradientBackgroundDome(gradientBackgroundDome)
  gradientBackgroundDome = null
}

function buildObjectUrlsFromSkycubeZipFaces(
  facesInOrder: ReadonlyArray<ReturnType<typeof extractSkycubeZipFaces>['facesInOrder'][number]>,
): { urls: Array<string | null>; dispose: () => void } {
  const urls: Array<string | null> = []
  const created: string[] = []
  for (const face of facesInOrder) {
    if (!face) {
      urls.push(null)
      continue
    }
    const mimeType = face.mimeType ?? 'application/octet-stream'
    const bytes = face.bytes as unknown as Uint8Array<ArrayBuffer>
    const blob = new Blob([bytes], { type: mimeType })
    const url = URL.createObjectURL(blob)
    created.push(url)
    urls.push(url)
  }
  return {
    urls,
    dispose: () => {
      for (const url of created) {
        try {
          URL.revokeObjectURL(url)
        } catch (_error) {
          // ignore
        }
      }
    },
  }
}

function computeEnvironmentAssetReloadKey(assetId: string | null | undefined): string | null {
  const trimmed = typeof assetId === 'string' ? assetId.trim() : ''
  if (!trimmed) {
    return null
  }
  const entry = assetCacheStore.entries?.[trimmed]
  const asset = sceneStore.getAsset(trimmed)
  const serverUpdatedAt = entry?.serverUpdatedAt ?? null
  const blobUrl = entry?.blobUrl ?? null
  const downloadUrl = asset?.downloadUrl ?? null
  return `${trimmed}|${serverUpdatedAt ?? ''}|${blobUrl ?? ''}|${downloadUrl ?? ''}`
}

const VIEWPORT_SCENE_CSM_BASE_CONFIG: SceneCsmConfig = {
  ...DEFAULT_SCENE_CSM_CONFIG,
}
let sceneCsmShadowRuntime: SceneCsmShadowRuntime | null = null
let sceneCsmRuntimeConfigKey = ''

function resolveEnvironmentCsmSettings(settings: EnvironmentSettings): EnvironmentCsmSettings {
  const csm = settings.csm
  return {
    enabled: csm?.enabled ?? DEFAULT_SCENE_CSM_CONFIG.enabled,
    shadowEnabled: csm?.shadowEnabled ?? DEFAULT_SCENE_CSM_CONFIG.shadowEnabled,
    lightColor: csm?.lightColor ?? '#ffffff',
    lightIntensity: csm?.lightIntensity ?? DEFAULT_SCENE_CSM_CONFIG.lightIntensity,
    sunAzimuthDeg: csm?.sunAzimuthDeg ?? DEFAULT_SCENE_CSM_SUN_AZIMUTH_DEG,
    sunElevationDeg: csm?.sunElevationDeg ?? DEFAULT_SCENE_CSM_SUN_ELEVATION_DEG,
    cascades: csm?.cascades ?? DEFAULT_SCENE_CSM_CONFIG.cascades,
    maxFar: csm?.maxFar ?? DEFAULT_SCENE_CSM_CONFIG.maxFar,
    shadowMapSize: csm?.shadowMapSize ?? DEFAULT_SCENE_CSM_CONFIG.shadowMapSize,
    shadowBias: csm?.shadowBias ?? DEFAULT_SCENE_CSM_CONFIG.shadowBias,
  }
}

function resolveViewportSceneCsmConfig(settings: EnvironmentSettings): SceneCsmConfig {
  const csm = resolveEnvironmentCsmSettings(settings)
  return {
    ...VIEWPORT_SCENE_CSM_BASE_CONFIG,
    enabled: csm.enabled,
    shadowEnabled: csm.shadowEnabled,
    lightColor: csm.lightColor,
    lightIntensity: csm.lightIntensity,
    cascades: csm.cascades,
    maxFar: csm.maxFar,
    shadowMapSize: csm.shadowMapSize,
    shadowBias: csm.shadowBias,
  }
}

function buildSceneCsmConfigKey(config: SceneCsmConfig): string {
  return JSON.stringify({
    enabled: config.enabled ?? true,
    shadowEnabled: config.shadowEnabled ?? DEFAULT_SCENE_CSM_CONFIG.shadowEnabled,
    cascades: config.cascades ?? DEFAULT_SCENE_CSM_CONFIG.cascades,
    maxFar: config.maxFar ?? DEFAULT_SCENE_CSM_CONFIG.maxFar,
    shadowMapSize: config.shadowMapSize ?? DEFAULT_SCENE_CSM_CONFIG.shadowMapSize,
    shadowBias: config.shadowBias ?? DEFAULT_SCENE_CSM_CONFIG.shadowBias,
    lightMargin: config.lightMargin ?? DEFAULT_SCENE_CSM_CONFIG.lightMargin,
  })
}

function shouldUseSceneCsmShadows(): boolean {
  const config = resolveViewportSceneCsmConfig(environmentSettings.value)
  return Boolean(scene && camera && shadowsActiveInViewport.value && config.enabled)
}

function ensureSceneCsmShadowRuntime(): SceneCsmShadowRuntime | null {
  if (!scene || !camera || !shouldUseSceneCsmShadows()) {
    if (sceneCsmShadowRuntime) {
      disposeSceneCsmShadowRuntime()
    }
    return null
  }
  const config = resolveViewportSceneCsmConfig(environmentSettings.value)
  const configKey = buildSceneCsmConfigKey(config)
  if (sceneCsmShadowRuntime && sceneCsmRuntimeConfigKey !== configKey) {
    disposeSceneCsmShadowRuntime()
  }
  if (!sceneCsmShadowRuntime) {
    sceneCsmShadowRuntime = createSceneCsmShadowRuntime(scene, camera, config)
    sceneCsmRuntimeConfigKey = configKey
    sceneCsmShadowRuntime.registerObject(rootGroup)
    sceneCsmShadowRuntime.registerObject(instancedMeshGroup)
  }
  syncSceneCsmSunFromEnvironment(environmentSettings.value)
  return sceneCsmShadowRuntime
}

function disposeSceneCsmShadowRuntime(): void {
  sceneCsmShadowRuntime?.dispose()
  sceneCsmShadowRuntime = null
  sceneCsmRuntimeConfigKey = ''
}

function syncSceneCsmSunFromEnvironment(settings: EnvironmentSettings): void {
  if (!sceneCsmShadowRuntime) {
    return
  }
  const csm = resolveEnvironmentCsmSettings(settings)
  const sunPosition = resolveSceneCsmSunPositionFromAngles(csm.sunAzimuthDeg, csm.sunElevationDeg, 1000)
  sceneCsmShadowRuntime.syncSun(sunPosition, csm.lightIntensity, csm.lightColor)
}

function refreshSceneCsmFrustums(): void {
  sceneCsmShadowRuntime?.updateFrustums()
}

// Building label font/meshes (planning-conversion buildings)
const buildingLabelMeshes = new Map<string, THREE.Mesh>()

// Guide route waypoint labels are managed by a small helper module.
const createOrUpdateGuideRouteWaypointLabels = createGuideRouteWaypointLabelsManager(sceneStore, objectMap)
const guideRouteWaypointLabelMeshes = getGuideRouteWaypointLabelMeshes()

// Guide route waypoint labels are handled by the external manager: `createOrUpdateGuideRouteWaypointLabels`.

// snap controllers disabled in SceneViewport

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
const rgbeLoader = new RGBELoader().setDataType(THREE.FloatType)
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

function tagInternalRuntimeGroup(group: THREE.Object3D, ownerNodeId: string, dynamicMeshType: string): void {
  const userData = group.userData ?? (group.userData = {})
  delete userData.nodeId
  userData.ownerNodeId = ownerNodeId
  userData.dynamicMeshType = dynamicMeshType
}

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
      if (isHdriLikeExtension(extension) && extension !== 'exr') {
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

function resolveFloorMaterialTarget(targetObject: THREE.Object3D): THREE.Object3D {
  const floorGroup = targetObject.userData?.floorGroup as THREE.Object3D | undefined
  if (floorGroup?.isObject3D) {
    return floorGroup
  }
  return targetObject
}

function refreshFloorRuntimeMaterials(nodeId: string, targetObject: THREE.Object3D): void {
  const node = findSceneNode(sceneStore.nodes, nodeId)
  if (!node || node.dynamicMesh?.type !== 'Floor') {
    return
  }
  const materialTarget = resolveFloorMaterialTarget(targetObject)
  if (node.materials && node.materials.length) {
    applyMaterialOverrides(materialTarget, node.materials, materialOverrideOptions)
  } else {
    resetMaterialOverrides(materialTarget)
  }
}

function applyFloorPreviewMaterials(targetObject: THREE.Object3D, presetData: import('@/utils/floorPreset').FloorPresetData | null): void {
  const materials = buildFloorNodeMaterialsFromPreset(presetData, sceneStore.materials)
  if (materials.length) {
    applyMaterialOverrides(targetObject, materials, materialOverrideOptions)
  } else {
    resetMaterialOverrides(targetObject)
  }
}

function applyLandformPreviewMaterials(
  targetObject: THREE.Object3D,
  presetData: import('@/utils/landformPreset').LandformPresetData | null,
): void {
  const materials = buildLandformNodeMaterialsFromPreset(presetData, sceneStore.materials)
  if (materials.length) {
    applyMaterialOverrides(targetObject, materials, materialOverrideOptions)
  } else {
    resetMaterialOverrides(targetObject)
  }
}

function applyWallPreviewMaterials(targetObject: THREE.Object3D, presetData: import('@/utils/wallPreset').WallPresetData | null): void {
  const materials = buildWallNodeMaterialsFromPreset(presetData, sceneStore.materials)
  if (materials.length) {
    applyMaterialOverrides(targetObject, materials, materialOverrideOptions)
  } else {
    resetMaterialOverrides(targetObject)
  }
}

function applyRendererShadowSetting() {
  if (!renderer) {
    return
  }
  const castShadows = Boolean(shadowsActiveInViewport.value)
  renderer.shadowMap.enabled = castShadows
  if (castShadows) {
    const runtime = ensureSceneCsmShadowRuntime()
    runtime?.setActive(true)
    syncSceneCsmSunFromEnvironment(environmentSettings.value)
    return
  }
  sceneCsmShadowRuntime?.setActive(false)
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
const GROUND_SCULPT_SKIP_REFRESH_SIGNATURE_KEY = '__harmonyGroundSculptSkipRefreshSignature'

function resolveGroundSignatureTarget(object: THREE.Object3D): THREE.Object3D {
  return resolveGroundRuntimeObject(object) ?? object
}

function computeGroundDynamicMeshSignature(definition: GroundDynamicMesh): string {
  return hashString(stableSerialize({
    rows: Math.max(1, Math.trunc(definition.rows)),
    columns: Math.max(1, Math.trunc(definition.columns)),
    cellSize: Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1,
    width: Number.isFinite(definition.width) ? definition.width : 0,
    depth: Number.isFinite(definition.depth) ? definition.depth : 0,
    generation: definition.generation ?? null,
    heightComposition: definition.heightComposition ?? { mode: 'planning_plus_manual' },
    surfaceRevision: Number.isFinite(definition.surfaceRevision)
      ? Math.max(0, Math.trunc(definition.surfaceRevision as number))
      : 0,
  }))
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

function resolveRoadSnapToTerrainEnabled(node: SceneNode): boolean {
  const component = node.components?.[ROAD_COMPONENT_TYPE] as SceneNodeComponentState<RoadComponentProps> | undefined
  return Boolean(component?.props?.snapToTerrain)
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
  const snapToTerrain = resolveRoadSnapToTerrainEnabled(node)
  const materialConfigId = resolveRoadMaterialConfigId(node)
  const groundNode = getGroundNodeFromStore()
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
    heightSampler: snapToTerrain && groundDefinition
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
  const thickness = Number.isFinite(definition.thickness) ? definition.thickness : null
  const sideX = Number.isFinite((definition.sideUvScale as any)?.x) ? Number((definition.sideUvScale as any).x) : null
  const sideY = Number.isFinite((definition.sideUvScale as any)?.y) ? Number((definition.sideUvScale as any).y) : null
  const normalizeId = (value: unknown) => (typeof value === 'string' && value.trim().length ? value.trim() : null)
  const topBottomId = normalizeId((definition as any).topBottomMaterialConfigId)
  const sideId = normalizeId((definition as any).sideMaterialConfigId) ?? topBottomId
  const serialized = stableSerialize([
    Array.isArray(definition.vertices) ? definition.vertices : [],
    topBottomId,
    sideId,
    Number.isFinite(definition.smooth) ? definition.smooth : null,
    thickness,
    sideX,
    sideY,
  ])
  return hashString(serialized)
}

function computeGuideRouteDynamicMeshSignature(definition: GuideRouteDynamicMesh): string {
  const serialized = stableSerialize([Array.isArray(definition.vertices) ? definition.vertices : []])
  return hashString(serialized)
}

function computeRegionRuntimeSignature(definition: RegionDynamicMesh): string {
  return computeRegionDynamicMeshSignature(definition)
}



const {
  isEditorOnlyObject,
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
  objectMap,
  {
    getInstancedPickTargets: collectInstancedPickTargets,
  }
)

const snapController = useSnapController({
  canvasRef,
  camera: { get value() { return camera } } as Ref<THREE.Camera | null>,
  objectMap,
  getInstancedPickTargets: collectInstancedPickTargets,
  isNodeVisible: (nodeId) => sceneStore.isNodeVisible(nodeId),
  isNodeLocked: (nodeId) => sceneStore.isNodeSelectionLocked(nodeId),
  isObjectWorldVisible,
  pixelThreshold: 12,
  enablePlacementSideSnap: true,
})

protagonistInitialVisibilityCapture = createProtagonistInitialVisibilityCapture({
  getNodes: () => sceneStore.nodes,
  isSceneReady: () => sceneStore.isSceneReady,
  updateNodeComponentProps: (nodeId, componentId, propsPatch) =>
    sceneStore.updateNodeComponentProps(nodeId, componentId, propsPatch),
  objectMap,
  rootGroup,
  instancedMeshGroup,
  getRenderer: () => renderer,
  isObjectWorldVisible,
})
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

const directionalLightTargetHandleManager = createDirectionalLightTargetHandleManager()

const lightTargetWorldPositionHelper = new THREE.Vector3()
const directionalLightPivotWorldPositionHelper = new THREE.Vector3()
const directionalLightPivotWorldQuaternionHelper = new THREE.Quaternion()
const directionalLightInitialDirectionWorldHelper = new THREE.Vector3()
const directionalLightDeltaQuaternionHelper = new THREE.Quaternion()
const directionalLightInvQuaternionHelper = new THREE.Quaternion()
const directionalLightCandidateDirectionWorldHelper = new THREE.Vector3()

const DIRECTIONAL_LIGHT_FIXED_HEIGHT_EPS = 1e-4
const DIRECTIONAL_LIGHT_MAX_FIXED_HEIGHT_DISTANCE_ABS_CAP = 2_000_000

function resolveDirectionalLightMaxFixedHeightDistance(nodeId: string): number {
  const node = sceneStore.getNodeById(nodeId)
  const config = node?.light
  if (!node || !config || config.type !== 'Directional') {
    return 200000
  }

  const shadow = (config as any).shadow as Record<string, unknown> | undefined
  const cameraFar = shadow?.cameraFar
  if (typeof cameraFar === 'number' && Number.isFinite(cameraFar) && cameraFar > 0) {
    // Keep the computed light distance within the shadow depth range.
    return clampNumber(cameraFar * 0.95, 50, DIRECTIONAL_LIGHT_MAX_FIXED_HEIGHT_DISTANCE_ABS_CAP)
  }

  const orthoSize = shadow?.orthoSize
  if (typeof orthoSize === 'number' && Number.isFinite(orthoSize) && orthoSize > 0) {
    // Depth should be comfortably larger than the lateral coverage.
    return clampNumber(orthoSize * 20, 50, DIRECTIONAL_LIGHT_MAX_FIXED_HEIGHT_DISTANCE_ABS_CAP)
  }

  // Fallback: scale with current framing radius so it adapts to different project scales.
  const r = lastCameraFocusRadius
  if (typeof r === 'number' && Number.isFinite(r) && r > 0) {
    return clampNumber(r * 50, 200, DIRECTIONAL_LIGHT_MAX_FIXED_HEIGHT_DISTANCE_ABS_CAP)
  }

  return 200000
}

type DirectionalLightPivotEditState = {
  nodeId: string
  fixedLightWorldY: number
  initialPivotWorldQuaternion: THREE.Quaternion
  initialDirectionWorld: THREE.Vector3
  captureHistoryPending: boolean
}

let directionalLightPivotEditState: DirectionalLightPivotEditState | null = null
let isApplyingCameraState = false
let lastCameraFocusRadius: number | null = null
const VIEWPORT_COMPOSITION_EPSILON_PX = 0.5
const viewportCompositionOffsetPx = new THREE.Vector2(Number.NaN, Number.NaN)
const viewportCompositionOffsetTargetPx = new THREE.Vector2()
let viewportCompositionUpdateFrame: number | null = null
let viewportCompositionUpdateQueued = false
let viewportCompositionUpdateForce = false
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const defaultCameraStatusDistance = new THREE.Vector3(
  DEFAULT_CAMERA_POSITION.x,
  DEFAULT_CAMERA_POSITION.y,
  DEFAULT_CAMERA_POSITION.z,
).distanceTo(new THREE.Vector3(
  DEFAULT_CAMERA_TARGET.x,
  Math.max(DEFAULT_CAMERA_TARGET.y, MIN_TARGET_HEIGHT),
  DEFAULT_CAMERA_TARGET.z,
))
const cameraStatusDistance = ref(defaultCameraStatusDistance)

const isDragHovering = ref(false)
const gridVisible = computed(() => sceneStore.viewportSettings.showGrid)
const axesVisible = computed(() => sceneStore.viewportSettings.showAxes)
const vertexSnapThresholdPx = computed(() => sceneStore.viewportSettings.snapThresholdPx)
const shadowsEnabled = computed(() => sceneStore.shadowsEnabled)
const environmentSettings = computed(() => sceneStore.environmentSettings)
const isEnvironmentNodeSelected = computed(() => sceneStore.selectedNodeId === ENVIRONMENT_NODE_ID)
const shadowsActiveInViewport = computed(() => shadowsEnabled.value)
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
const cameraControlMode = computed(() => sceneStore.viewportSettings.cameraControlMode)
const viewportSelectionCount = computed(() => (sceneStore.selectedNodeIds ? sceneStore.selectedNodeIds.length : 0))
const cameraPointerHintText = computed(() => (
  cameraControlMode.value === 'map'
    ? '右键旋转 · 左键拖拽平移 · 滚轮缩放 · Shift+右拖 指定轨道中心 · Shift+左键 快速对焦'
    : '中键旋转 · 右键平移 · 滚轮缩放 · Shift+中拖 指定轨道中心 · Shift+左键 快速对焦'
))
const cameraStatusZoomRatioText = computed(() => {
  const base = defaultCameraStatusDistance > 1e-6 ? defaultCameraStatusDistance : 1
  const ratio = cameraStatusDistance.value / base
  return `${Math.max(0, ratio).toFixed(2)}x`
})
const transformToolKeyMap = new Map<string, EditorTool>(TRANSFORM_TOOLS.map((tool) => [tool.key, tool.value]))

const buildToolsStore = useBuildToolsStore()
const {
  activeBuildTool,
  floorBuildShape,
  floorRegularPolygonSides,
  landformBuildShape,
  landformRegularPolygonSides,
  waterBuildShape,
  wallBuildShape,
  wallRegularPolygonSides,
  wallDoorSelectModeActive,
  wallBrushPresetAssetId,
  floorBrushPresetAssetId,
  landformBrushPresetAssetId,
  roadBrushPresetAssetId,
} = storeToRefs(buildToolsStore)
const floorShapeMenuOpen = ref(false)
const landformShapeMenuOpen = ref(false)
const wallShapeMenuOpen = ref(false)
const roadShapeMenuOpen = ref(false)
const waterShapeMenuOpen = ref(false)
const autoOverlayDialogOpen = ref(false)
const autoOverlayPlan = ref<AutoOverlayBuildPlan | null>(null)
const autoOverlaySubmitting = ref(false)
const autoOverlayHorizMargin = ref(0)
const autoOverlayVertMargin = ref(0)
const autoOverlayHoverNodeId = ref<string | null>(null)
const autoOverlayHoverIndicator = reactive({
  visible: false,
  x: 0,
  y: 0,
  label: '自动铺设',
})
const groundTerrainMenuOpen = ref(false)
const groundPaintMenuOpen = ref(false)
const groundScatterMenuOpen = ref(false)
const csmMenuOpen = ref(false)
const viewportPlacementMenuOpen = ref(false)
const pendingViewportPlacement = ref<ViewportPlacementItem | null>(null)
const viewportPlacementActive = computed(() => Boolean(pendingViewportPlacement.value))
const cameraResetMenuOpen = ref(false)
let transformToolBeforeBuild: EditorTool | null = null
const autoOverlayDialogTitle = computed(() => {
  return '自动铺设？'
})
const autoOverlayConfirmDisabled = computed(() => {
  const plan = autoOverlayPlan.value
  return !plan?.supported || autoOverlaySubmitting.value
})
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
  if (activeBuildTool.value === 'landform') {
    return 'cursor-floor'
  }
  if (activeBuildTool.value === 'region') {
    return 'cursor-floor'
  }
  if (activeBuildTool.value === 'water') {
    return 'cursor-water'
  }
  if (activeBuildTool.value === 'displayBoard') {
    return 'cursor-display-board'
  }

  if (activeBuildTool.value === 'billboard') {
    return 'cursor-billboard'
  }
  if (activeBuildTool.value === 'warpGate') {
    return 'cursor-warp-gate'
  }
  return null
})
const scatterEraseModeActive = ref(false)
const scatterEraseRestoreModifierActive = ref(false)
const scatterEraseMenuOpen = ref(false)
const vertexSnapShiftModifierActive = ref(false)
const relativeAngleSnapCModifierActive = ref(false)
const navigationSpeedBoostModifierActive = ref(false)
const wallEditNodeId = ref<string | null>(null)
const roadEditNodeId = ref<string | null>(null)
const floorEditNodeId = ref<string | null>(null)
const landformEditNodeId = ref<string | null>(null)
const regionEditNodeId = ref<string | null>(null)
const waterEditNodeId = ref<string | null>(null)
const vertexSnapModeEnabled = computed(() => sceneStore.viewportSettings.snapMode === 'vertex')
const isVertexSnapActiveEffective = computed(() => vertexSnapModeEnabled.value || vertexSnapShiftModifierActive.value)
const selectedNodeIsGround = computed(() => sceneStore.selectedNode?.dynamicMesh?.type === 'Ground')
const selectedNodeIsWall = computed(() => sceneStore.selectedNode?.dynamicMesh?.type === 'Wall')
const selectedNodeIsFloor = computed(() => sceneStore.selectedNode?.dynamicMesh?.type === 'Floor')
const selectedNodeIsLandform = computed(() => sceneStore.selectedNode?.dynamicMesh?.type === 'Landform')
const selectedNodeIsRegion = computed(() => sceneStore.selectedNode?.dynamicMesh?.type === 'Region')
const selectedNodeIsWater = computed(() => isWaterSurfaceNode(sceneStore.selectedNode))
const selectionContainsLandform = computed(() => {
  const selectedIds = new Set<string>()
  const primaryId = getPrimarySelectedNodeId()
  if (primaryId) {
    selectedIds.add(primaryId)
  }
  ;(Array.isArray(sceneStore.selectedNodeIds) ? sceneStore.selectedNodeIds : []).forEach((id) => {
    if (typeof id === 'string' && id.length > 0) {
      selectedIds.add(id)
    }
  })
  return Array.from(selectedIds).some((id) => resolveSceneNodeById(id)?.dynamicMesh?.type === 'Landform')
})
// Shift modifier in scatter-erase mode means "repair/restore".
// - Walls: repair a segment (hammer)
// - InstanceLayout: restore erased instances
const scatterRepairModifierActive = computed(() => scatterEraseModeActive.value && scatterEraseRestoreModifierActive.value)
const wallRepairModeActive = computed(() => scatterRepairModifierActive.value && selectedNodeIsWall.value)

function isTransformToolBlockedByLandform(tool: EditorTool): boolean {
  return selectionContainsLandform.value && (tool === 'rotate' || tool === 'scale')
}

function getSafeTransformTool(tool: EditorTool): EditorTool {
  if (isTransformToolBlockedByLandform(tool)) {
    return 'translate'
  }
  return tool
}

function getPrimarySelectedNodeId(): string | null {
  return sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
}

function resolveEditableWallNode(nodeId: string | null | undefined): SceneNode | null {
  if (!nodeId) {
    return null
  }
  const node = findSceneNode(sceneStore.nodes, nodeId)
  if (!node || node.dynamicMesh?.type !== 'Wall') {
    return null
  }
  if (node.locked || sceneStore.isNodeSelectionLocked(nodeId)) {
    return null
  }
  return node
}

function resolveEditableRoadNode(nodeId: string | null | undefined): SceneNode | null {
  if (!nodeId) {
    return null
  }
  const node = findSceneNode(sceneStore.nodes, nodeId)
  if (!node || node.dynamicMesh?.type !== 'Road') {
    return null
  }
  if (node.locked || sceneStore.isNodeSelectionLocked(nodeId)) {
    return null
  }
  return node
}

function resolveEditableFloorNode(nodeId: string | null | undefined): SceneNode | null {
  if (!nodeId) {
    return null
  }
  const node = findSceneNode(sceneStore.nodes, nodeId)
  if (!node || node.dynamicMesh?.type !== 'Floor') {
    return null
  }
  if (node.locked || sceneStore.isNodeSelectionLocked(nodeId)) {
    return null
  }
  return node
}

function resolveEditableLandformNode(nodeId: string | null | undefined): SceneNode | null {
  if (!nodeId) {
    return null
  }
  const node = findSceneNode(sceneStore.nodes, nodeId)
  if (!node || node.dynamicMesh?.type !== 'Landform') {
    return null
  }
  if (node.locked || sceneStore.isNodeSelectionLocked(nodeId)) {
    return null
  }
  return node
}

function resolveEditableRegionNode(nodeId: string | null | undefined): SceneNode | null {
  if (!nodeId) {
    return null
  }
  const node = findSceneNode(sceneStore.nodes, nodeId)
  if (!node || node.dynamicMesh?.type !== 'Region') {
    return null
  }
  if (node.locked || sceneStore.isNodeSelectionLocked(nodeId)) {
    return null
  }
  return node
}

function resolveEditableWaterNode(nodeId: string | null | undefined): SceneNode | null {
  if (!nodeId) {
    return null
  }
  const node = findSceneNode(sceneStore.nodes, nodeId)
  if (!node) {
    return null
  }
  if (!isWaterSurfaceNode(node)) {
    return null
  }
  if (node.locked || sceneStore.isNodeSelectionLocked(nodeId)) {
    return null
  }
  return node
}

function refreshSelectionHighlightsForEditModeChange(): void {
  updateOutlineSelectionTargets()
  updateSelectionHighlights()
}

function setWallEditNodeId(nodeId: string | null): void {
  if (wallEditNodeId.value === nodeId) {
    return
  }
  wallEditNodeId.value = nodeId
  refreshSelectionHighlightsForEditModeChange()
}

function setRoadEditNodeId(nodeId: string | null): void {
  if (roadEditNodeId.value === nodeId) {
    return
  }
  roadEditNodeId.value = nodeId
  refreshSelectionHighlightsForEditModeChange()
}

function setFloorEditNodeId(nodeId: string | null): void {
  if (floorEditNodeId.value === nodeId) {
    return
  }
  floorEditNodeId.value = nodeId
  refreshSelectionHighlightsForEditModeChange()
}

function setLandformEditNodeId(nodeId: string | null): void {
  if (landformEditNodeId.value === nodeId) {
    return
  }
  landformEditNodeId.value = nodeId
  refreshSelectionHighlightsForEditModeChange()
}

function setRegionEditNodeId(nodeId: string | null): void {
  if (regionEditNodeId.value === nodeId) {
    return
  }
  regionEditNodeId.value = nodeId
  refreshSelectionHighlightsForEditModeChange()
}

function setWaterEditNodeId(nodeId: string | null): void {
  if (waterEditNodeId.value === nodeId) {
    return
  }
  waterEditNodeId.value = nodeId
  refreshSelectionHighlightsForEditModeChange()
}

function clearWallEditMode(): void {
  setWallEditNodeId(null)
}

function clearRoadEditMode(): void {
  setRoadEditNodeId(null)
}

function clearFloorEditMode(): void {
  setFloorEditNodeId(null)
}

function clearLandformEditMode(): void {
  setLandformEditNodeId(null)
}

function clearRegionEditMode(): void {
  setRegionEditNodeId(null)
}

function clearWaterEditMode(): void {
  setWaterEditNodeId(null)
}

function enterWallEditMode(nodeId: string | null | undefined): void {
  clearRoadEditMode()
  clearFloorEditMode()
  clearLandformEditMode()
  clearRegionEditMode()
  clearWaterEditMode()
  setWallEditNodeId(resolveEditableWallNode(nodeId)?.id ?? null)
}

function enterRoadEditMode(nodeId: string | null | undefined): void {
  clearWallEditMode()
  clearFloorEditMode()
  clearLandformEditMode()
  clearRegionEditMode()
  clearWaterEditMode()
  setRoadEditNodeId(resolveEditableRoadNode(nodeId)?.id ?? null)
}

function enterFloorEditMode(nodeId: string | null | undefined): void {
  clearWallEditMode()
  clearRoadEditMode()
  clearLandformEditMode()
  clearRegionEditMode()
  clearWaterEditMode()
  setFloorEditNodeId(resolveEditableFloorNode(nodeId)?.id ?? null)
}

function enterLandformEditMode(nodeId: string | null | undefined): void {
  clearWallEditMode()
  clearRoadEditMode()
  clearFloorEditMode()
  clearRegionEditMode()
  clearWaterEditMode()
  setLandformEditNodeId(resolveEditableLandformNode(nodeId)?.id ?? null)
}

function enterRegionEditMode(nodeId: string | null | undefined): void {
  clearWallEditMode()
  clearRoadEditMode()
  clearFloorEditMode()
  clearLandformEditMode()
  clearWaterEditMode()
  setRegionEditNodeId(resolveEditableRegionNode(nodeId)?.id ?? null)
}

function enterWaterEditMode(nodeId: string | null | undefined): void {
  clearWallEditMode()
  clearRoadEditMode()
  clearFloorEditMode()
  clearLandformEditMode()
  clearRegionEditMode()
  setWaterEditNodeId(resolveEditableWaterNode(nodeId)?.id ?? null)
}

function isSelectedWallEditMode(): boolean {
  const selectedId = getPrimarySelectedNodeId()
  if (!selectedId || wallEditNodeId.value !== selectedId) {
    return false
  }
  const selectedIds = Array.isArray(sceneStore.selectedNodeIds) ? sceneStore.selectedNodeIds : []
  if (selectedIds.length !== 1 || !selectedIds.includes(selectedId)) {
    return false
  }
  return Boolean(resolveEditableWallNode(selectedId))
}

function isSelectedRoadEditMode(): boolean {
  const selectedId = getPrimarySelectedNodeId()
  if (!selectedId || roadEditNodeId.value !== selectedId) {
    return false
  }
  const selectedIds = Array.isArray(sceneStore.selectedNodeIds) ? sceneStore.selectedNodeIds : []
  if (selectedIds.length !== 1 || !selectedIds.includes(selectedId)) {
    return false
  }
  return Boolean(resolveEditableRoadNode(selectedId))
}

function isSelectedFloorEditMode(): boolean {
  const selectedId = getPrimarySelectedNodeId()
  if (!selectedId || floorEditNodeId.value !== selectedId) {
    return false
  }
  const selectedIds = Array.isArray(sceneStore.selectedNodeIds) ? sceneStore.selectedNodeIds : []
  if (selectedIds.length !== 1 || !selectedIds.includes(selectedId)) {
    return false
  }
  return Boolean(resolveEditableFloorNode(selectedId))
}

function isSelectedLandformEditMode(): boolean {
  const selectedId = getPrimarySelectedNodeId()
  if (!selectedId || landformEditNodeId.value !== selectedId) {
    return false
  }
  const selectedIds = Array.isArray(sceneStore.selectedNodeIds) ? sceneStore.selectedNodeIds : []
  if (selectedIds.length !== 1 || !selectedIds.includes(selectedId)) {
    return false
  }
  return Boolean(resolveEditableLandformNode(selectedId))
}

function isSelectedRegionEditMode(): boolean {
  const selectedId = getPrimarySelectedNodeId()
  if (!selectedId || regionEditNodeId.value !== selectedId) {
    return false
  }
  const selectedIds = Array.isArray(sceneStore.selectedNodeIds) ? sceneStore.selectedNodeIds : []
  if (selectedIds.length !== 1 || !selectedIds.includes(selectedId)) {
    return false
  }
  return Boolean(resolveEditableRegionNode(selectedId))
}

function isSelectedWaterEditMode(): boolean {
  const selectedId = getPrimarySelectedNodeId()
  if (!selectedId || waterEditNodeId.value !== selectedId) {
    return false
  }
  const selectedIds = Array.isArray(sceneStore.selectedNodeIds) ? sceneStore.selectedNodeIds : []
  if (selectedIds.length !== 1 || !selectedIds.includes(selectedId)) {
    return false
  }
  return Boolean(resolveEditableWaterNode(selectedId))
}

let buildStartIndicatorRenderer: ReturnType<typeof createBuildStartIndicatorRenderer> | null = null
type PendingBuildStartIndicator = {
  tool: BuildTool
  nodeId: string
  point: THREE.Vector3
  height: number | null
}

const BUILD_START_INDICATOR_MIN_NODE_SCREEN_DIAMETER_PX = 12
const buildStartIndicatorBounds = new THREE.Box3()
const buildStartIndicatorSphere = new THREE.Sphere()
const buildStartIndicatorWorldCenter = new THREE.Vector3()
let pendingBuildStartIndicator: PendingBuildStartIndicator | null = null

function showBuildStartIndicator(point: THREE.Vector3, options?: { height?: number | null }) {
  buildStartIndicatorRenderer?.showAt(point, options)
}

function holdBuildStartIndicatorUntilNodeVisible(options: {
  nodeId: string
  point: THREE.Vector3
  height?: number | null
}) {
  const tool = activeBuildTool.value
  if (!tool) {
    return
  }
  pendingBuildStartIndicator = {
    tool,
    nodeId: options.nodeId,
    point: options.point.clone(),
    height: typeof options.height === 'number' && Number.isFinite(options.height)
      ? options.height
      : null,
  }
  buildStartIndicatorRenderer?.showAt(options.point, { height: options.height })
}

function hideBuildStartIndicator(options?: { preservePending?: boolean }) {
  if (!options?.preservePending) {
    pendingBuildStartIndicator = null
  }
  buildStartIndicatorRenderer?.hide()
}

function isPendingBuildStartIndicatorNodeVisible(): boolean {
  if (!pendingBuildStartIndicator || !camera || !canvasRef.value) {
    return false
  }
  if (activeBuildTool.value !== pendingBuildStartIndicator.tool) {
    return false
  }

  const runtimeObject = objectMap.get(pendingBuildStartIndicator.nodeId) ?? null
  if (!runtimeObject || !sceneStore.isNodeVisible(pendingBuildStartIndicator.nodeId) || !isObjectWorldVisible(runtimeObject)) {
    return false
  }

  const canvasRect = canvasRef.value.getBoundingClientRect()
  if (canvasRect.width <= 0 || canvasRect.height <= 0) {
    return false
  }

  buildStartIndicatorBounds.setFromObject(runtimeObject)
  if (buildStartIndicatorBounds.isEmpty()) {
    return false
  }

  buildStartIndicatorBounds.getBoundingSphere(buildStartIndicatorSphere)
  if (!Number.isFinite(buildStartIndicatorSphere.radius) || buildStartIndicatorSphere.radius <= 1e-6) {
    return false
  }

  buildStartIndicatorWorldCenter.copy(buildStartIndicatorSphere.center)
  buildStartIndicatorWorldCenter.project(camera)
  if (!Number.isFinite(buildStartIndicatorWorldCenter.x)
    || !Number.isFinite(buildStartIndicatorWorldCenter.y)
    || !Number.isFinite(buildStartIndicatorWorldCenter.z)) {
    return false
  }
  if (buildStartIndicatorWorldCenter.z < -1 || buildStartIndicatorWorldCenter.z > 1) {
    return false
  }
  if (Math.abs(buildStartIndicatorWorldCenter.x) > 1 || Math.abs(buildStartIndicatorWorldCenter.y) > 1) {
    return false
  }

  const distance = camera.position.distanceTo(buildStartIndicatorSphere.center)
  const unitsPerPixel = computeWorldUnitsPerPixel({
    camera,
    distance,
    viewportHeightPx: canvasRect.height,
  })
  const screenDiameterPx = (buildStartIndicatorSphere.radius * 2) / Math.max(unitsPerPixel, 1e-6)
  return screenDiameterPx >= BUILD_START_INDICATOR_MIN_NODE_SCREEN_DIAMETER_PX
}

function updatePendingBuildStartIndicator() {
  if (!pendingBuildStartIndicator) {
    return
  }
  if (activeBuildTool.value !== pendingBuildStartIndicator.tool) {
    hideBuildStartIndicator()
    return
  }
  if (isPendingBuildStartIndicatorNodeVisible()) {
    hideBuildStartIndicator()
    return
  }
  buildStartIndicatorRenderer?.showAt(pendingBuildStartIndicator.point, {
    height: pendingBuildStartIndicator.height,
  })
}

watch(
  () => [activeBuildTool.value, sceneStore.selectedNodeId] as const,
  () => {
    hideBuildStartIndicator({ preservePending: activeBuildTool.value === pendingBuildStartIndicator?.tool })
    const node = sceneStore.selectedNode ?? null
    if (!node) {
      return
    }

    if (node.locked || sceneStore.isNodeSelectionLocked(node.id)) {
      return
    }

    if (activeBuildTool.value === 'floor' && isSelectedFloorEditMode() && selectedNodeIsFloor.value) {
      const restored = readFloorBuildShapeFromNode(node)
      const floorMesh = node.dynamicMesh?.type === 'Floor' ? (node.dynamicMesh as FloorDynamicMesh) : null
      const canApplyRectangle = restored !== 'rectangle' || (floorMesh?.vertices?.length ?? 0) === 4
      if (restored && canApplyRectangle && restored !== floorBuildShape.value) {
        buildToolsStore.setFloorBuildShape(restored)
      }
      return
    }

    if (activeBuildTool.value === 'wall' && isSelectedWallEditMode() && selectedNodeIsWall.value) {
      const restored = readWallBuildShapeFromNode(node)
      if (restored && restored !== wallBuildShape.value) {
        buildToolsStore.setWallBuildShape(restored)
      }
      return
    }

    if (activeBuildTool.value === 'water' && isSelectedWaterEditMode() && selectedNodeIsWater.value) {
      const restored = readWaterBuildShapeFromNode(node)
      if (restored && restored !== waterBuildShape.value) {
        buildToolsStore.setWaterBuildShape(restored)
      }
    }
  },
  { immediate: true },
)

watch(
  () => activeBuildTool.value,
  (tool) => {
    if (tool !== 'wall' && tool !== 'floor' && tool !== 'water') {
      clearAutoOverlayDialog()
      clearAutoOverlayHoverIndicator()
    }
    hideBuildStartIndicator({ preservePending: tool === pendingBuildStartIndicator?.tool })
    if (tool !== 'wall' && wallDoorSelectModeActive.value) {
      buildToolsStore.setWallDoorSelectModeActive(false)
    }
    if (tool !== 'wall') {
      clearWallEditMode()
    }
    if (tool !== 'road') {
      clearRoadEditMode()
    }
    if (tool !== 'floor') {
      clearFloorEditMode()
    }
    if (tool !== 'water') {
      clearWaterEditMode()
    }
    if (tool !== 'wall') {
      clearWallDoorRectangleSelectionState()
      clearWallDoorSelectionPayload()
    }
  },
)

watch(wallDoorSelectModeActive, (active) => {
  if (!active) {
    clearWallDoorRectangleSelectionState()
    clearWallDoorSelectionPayload()
  }
})

watch(
  () => sceneStore.selectedNodeId,
  () => {
    if (!isSelectedWallEditMode()) {
      clearWallEditMode()
    }
    if (!isSelectedRoadEditMode()) {
      clearRoadEditMode()
    }
    if (!isSelectedFloorEditMode()) {
      clearFloorEditMode()
    }
    if (!isSelectedWaterEditMode()) {
      clearWaterEditMode()
    }
    if (wallDoorSelectModeActive.value && wallDoorSelectionPayload.value?.length) {
      return
    }
    clearWallDoorRectangleSelectionState()
    clearWallDoorSelectionPayload()
  },
)

watch(
  () => sceneStore.selectedNodeIds.slice(),
  (selectedIds) => {
    if (selectedIds.length !== 1 || selectedIds[0] !== wallEditNodeId.value) {
      clearWallEditMode()
    }
    if (selectedIds.length !== 1 || selectedIds[0] !== roadEditNodeId.value) {
      clearRoadEditMode()
    }
    if (selectedIds.length !== 1 || selectedIds[0] !== floorEditNodeId.value) {
      clearFloorEditMode()
    }
    if (selectedIds.length !== 1 || selectedIds[0] !== waterEditNodeId.value) {
      clearWaterEditMode()
    }
  },
)

const buildToolsDisabled = computed(() => false)

watch(
  buildToolsDisabled,
  (disabled) => {
    buildToolsStore.setBuildToolsDisabled(disabled)
  },
  { immediate: true },
)

// Watch UI selection context and cancel/clear active build tool when another
// module becomes active. This enforces mutual exclusion between build tools and
// other selection contexts.
const uiStore = useUiStore()
watch(
  () => uiStore.activeSelectionContext,
  (ctx) => {
    const keepBuildToolContext = Boolean(
      isManagedBuildToolContext(ctx)
      || (!ctx && isGroundBuildTool(activeBuildTool.value)),
    )
    if (!keepBuildToolContext) {
      if (activeBuildTool.value) {
        // Cancel any active build operation which will also clear activeBuildTool
        cancelActiveBuildOperation()
      }
    }

    // Enforce mutual exclusion: clear selections in other modules when context
    // indicates a different active area.
    if (ctx !== 'asset-panel' && sceneStore.selectedAssetId) {
      sceneStore.selectAsset(null)
    }
    if (!isGroundScatterContext(ctx) && activeBuildTool.value !== 'scatter' && (terrainStore.scatterSelectedAsset ?? null)) {
      terrainStore.setScatterSelection({ asset: null, providerAssetId: null })
    }
    if (!isGroundScatterContext(ctx) && activeBuildTool.value !== 'scatter' && scatterEraseModeActive.value) {
      exitScatterEraseMode()
    }
    if (!isGroundSculptContext(ctx) && activeBuildTool.value !== 'terrain' && (terrainStore.brushOperation ?? null)) {
      terrainStore.setBrushOperation(null)
    }
    if (!isGroundPaintContext(ctx) && activeBuildTool.value !== 'paint' && (terrainStore.paintSelectedAsset ?? null)) {
      terrainStore.setPaintSelection(null)
    }
    if (ctx !== 'viewport-add-node' && pendingViewportPlacement.value) {
      pendingViewportPlacement.value = null
      nodePlacementClickSessionState = null
      viewportPlacementMenuOpen.value = false
    }
  },
)

const instancedMeshRevision = ref(0)
const hasInstancedMeshes = computed(() => {
  void instancedMeshRevision.value
  return instancedMeshes.some((mesh) => mesh.visible && mesh.count > 0)
})

const canUseScatterEraseTool = computed(() => hasGroundNode.value || selectedNodeIsWall.value || hasInstancedMeshes.value)

const wallRenderer = createWallRenderer({
  assetCacheStore,
  getNodeById: (nodeId) => findSceneNode(sceneStore.nodes, nodeId),
  getObjectById: (nodeId) => objectMap.get(nodeId) ?? null,
  ensureInstancedPickProxy,
  removeInstancedPickProxy,
})

function syncWallPreviewGroupForEditor(options: {
  previewGroup: THREE.Group | null
  definition: WallDynamicMesh
  nodeId: string | null
  previewKey: string
  centerWorld: THREE.Vector3
  wallProps?: Partial<WallComponentProps> | WallComponentProps | null
}): THREE.Group {
  const nodeId = typeof options.nodeId === 'string' ? options.nodeId.trim() : ''
  const node = nodeId ? findSceneNode(sceneStore.nodes, nodeId) : null
  const wallComponent = node?.components?.[WALL_COMPONENT_TYPE] as
    | SceneNodeComponentState<WallComponentProps>
    | undefined
  const wallProps = options.wallProps ?? wallComponent?.props ?? null

  const group = options.previewGroup ?? new THREE.Group()
  group.position.copy(options.centerWorld)
  if (!options.previewGroup) {
    group.name = 'WallPreview'
    group.userData.isWallPreview = true
  }

  wallRenderer.syncWallPreviewContainer({
    container: group,
    definition: options.definition,
    wallProps,
    previewKey: options.previewKey,
  })

  if (node?.materials && node.materials.length) {
    applyMaterialOverrides(group, node.materials, materialOverrideOptions)
  } else {
    resetMaterialOverrides(group)
  }

  if (!rootGroup.children.includes(group)) {
    rootGroup.add(group)
  }

  return group
}

// (gesture state moved into `pointerInteraction`)
let instancedEraseDragState: InstancedEraseDragState | null = null

const repairHoverGroup = new THREE.Group()
repairHoverGroup.name = 'RepairHover'
repairHoverGroup.visible = false
const repairHoverProxies = new Map<string, THREE.Mesh>()

const vertexOverlayGroup = new THREE.Group()
vertexOverlayGroup.name = 'VertexOverlay'
vertexOverlayGroup.renderOrder = 20000
vertexOverlayGroup.frustumCulled = false

// Vertex debug overlay removed. No-op placeholder to keep callers safe.
function updateDebugVertexPoints(_nowMs: number) {
  // intentionally empty
}

// NOTE: WebGL line width is effectively 1px on many platforms.
// Use a mesh "beam" so the hint remains obvious.
const vertexOverlayHintBeamGeometry = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true)
const vertexOverlayHintBeamMaterial = new THREE.MeshBasicMaterial({
  color: 0x00e5ff,
  transparent: true,
  opacity: 0.75,
  depthTest: false,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
})
vertexOverlayHintBeamMaterial.toneMapped = false

// Add a slightly thicker "outline" beam behind the additive beam so it remains readable
// on bright backgrounds.
const vertexOverlayHintBeamOutlineMaterial = new THREE.MeshBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0.25,
  depthTest: false,
  depthWrite: false,
  blending: THREE.NormalBlending,
  side: THREE.DoubleSide,
})
vertexOverlayHintBeamOutlineMaterial.toneMapped = false

const vertexOverlayHintBeamOutline = new THREE.Mesh(vertexOverlayHintBeamGeometry, vertexOverlayHintBeamOutlineMaterial)
vertexOverlayHintBeamOutline.name = 'VertexOverlayHintBeamOutline'
vertexOverlayHintBeamOutline.renderOrder = 19998
vertexOverlayHintBeamOutline.visible = false
vertexOverlayHintBeamOutline.frustumCulled = false
;(vertexOverlayHintBeamOutline as any).raycast = () => {}

const vertexOverlayHintBeam = new THREE.Mesh(vertexOverlayHintBeamGeometry, vertexOverlayHintBeamMaterial)
vertexOverlayHintBeam.name = 'VertexOverlayHintBeam'
vertexOverlayHintBeam.renderOrder = 19999
vertexOverlayHintBeam.visible = false
vertexOverlayHintBeam.frustumCulled = false
;(vertexOverlayHintBeam as any).raycast = () => {}

// Endpoint markers help readability when the beam is short.
const vertexOverlayHintMarkerGeometry = new THREE.SphereGeometry(1, 18, 12)
const vertexOverlayHintSourceMarkerMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.35,
  depthTest: false,
  depthWrite: false,
  blending: THREE.NormalBlending,
})
vertexOverlayHintSourceMarkerMaterial.toneMapped = false

const vertexOverlayHintTargetMarkerMaterial = new THREE.MeshBasicMaterial({
  color: 0x00e5ff,
  transparent: true,
  opacity: 0.4,
  depthTest: false,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
})
vertexOverlayHintTargetMarkerMaterial.toneMapped = false

const vertexOverlayHintSourceMarker = new THREE.Mesh(vertexOverlayHintMarkerGeometry, vertexOverlayHintSourceMarkerMaterial)
vertexOverlayHintSourceMarker.name = 'VertexOverlayHintSourceMarker'
vertexOverlayHintSourceMarker.renderOrder = 19999
vertexOverlayHintSourceMarker.visible = false
vertexOverlayHintSourceMarker.frustumCulled = false
;(vertexOverlayHintSourceMarker as any).raycast = () => {}

const vertexOverlayHintTargetMarker = new THREE.Mesh(vertexOverlayHintMarkerGeometry, vertexOverlayHintTargetMarkerMaterial)
vertexOverlayHintTargetMarker.name = 'VertexOverlayHintTargetMarker'
vertexOverlayHintTargetMarker.renderOrder = 19999
vertexOverlayHintTargetMarker.visible = false
vertexOverlayHintTargetMarker.frustumCulled = false
;(vertexOverlayHintTargetMarker as any).raycast = () => {}

vertexOverlayGroup.add(vertexOverlayHintBeamOutline)
vertexOverlayGroup.add(vertexOverlayHintBeam)
vertexOverlayGroup.add(vertexOverlayHintSourceMarker)
vertexOverlayGroup.add(vertexOverlayHintTargetMarker)

// Placement side-snap hints (shown during asset placement preview).
const placementOverlayBestBeamMaterial = new THREE.MeshBasicMaterial({
  color: 0x00e5ff,
  transparent: true,
  opacity: 0.28,
  depthTest: false,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
})
placementOverlayBestBeamMaterial.toneMapped = false

const placementOverlayBestBeamOutlineMaterial = new THREE.MeshBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0.06,
  depthTest: false,
  depthWrite: false,
  blending: THREE.NormalBlending,
  side: THREE.DoubleSide,
})
placementOverlayBestBeamOutlineMaterial.toneMapped = false

const placementOverlayBestBeamOutline = new THREE.Mesh(vertexOverlayHintBeamGeometry, placementOverlayBestBeamOutlineMaterial)
placementOverlayBestBeamOutline.name = 'PlacementOverlayBestBeamOutline'
placementOverlayBestBeamOutline.renderOrder = 19997
placementOverlayBestBeamOutline.visible = false
placementOverlayBestBeamOutline.frustumCulled = false
;(placementOverlayBestBeamOutline as any).raycast = () => {}

const placementOverlayBestBeam = new THREE.Mesh(vertexOverlayHintBeamGeometry, placementOverlayBestBeamMaterial)
placementOverlayBestBeam.name = 'PlacementOverlayBestBeam'
placementOverlayBestBeam.renderOrder = 19998
placementOverlayBestBeam.visible = false
placementOverlayBestBeam.frustumCulled = false
;(placementOverlayBestBeam as any).raycast = () => {}

const placementOverlaySecondaryBeamMaterial = new THREE.MeshBasicMaterial({
  color: 0xffc107,
  transparent: true,
  opacity: 0.18,
  depthTest: false,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
})
placementOverlaySecondaryBeamMaterial.toneMapped = false

const placementOverlaySecondaryBeamOutlineMaterial = new THREE.MeshBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0.05,
  depthTest: false,
  depthWrite: false,
  blending: THREE.NormalBlending,
  side: THREE.DoubleSide,
})
placementOverlaySecondaryBeamOutlineMaterial.toneMapped = false

const placementOverlaySecondaryBeamOutline = new THREE.Mesh(vertexOverlayHintBeamGeometry, placementOverlaySecondaryBeamOutlineMaterial)
placementOverlaySecondaryBeamOutline.name = 'PlacementOverlaySecondaryBeamOutline'
placementOverlaySecondaryBeamOutline.renderOrder = 19996
placementOverlaySecondaryBeamOutline.visible = false
placementOverlaySecondaryBeamOutline.frustumCulled = false
;(placementOverlaySecondaryBeamOutline as any).raycast = () => {}

const placementOverlaySecondaryBeam = new THREE.Mesh(vertexOverlayHintBeamGeometry, placementOverlaySecondaryBeamMaterial)
placementOverlaySecondaryBeam.name = 'PlacementOverlaySecondaryBeam'
placementOverlaySecondaryBeam.renderOrder = 19997
placementOverlaySecondaryBeam.visible = false
placementOverlaySecondaryBeam.frustumCulled = false
;(placementOverlaySecondaryBeam as any).raycast = () => {}

// Placement markers (best + secondary).
const placementOverlayMarkerGeometry = vertexOverlayHintMarkerGeometry
const placementOverlayBestSourceMarker = new THREE.Mesh(placementOverlayMarkerGeometry, vertexOverlayHintSourceMarkerMaterial)
placementOverlayBestSourceMarker.name = 'PlacementOverlayBestSourceMarker'
placementOverlayBestSourceMarker.renderOrder = 19998
placementOverlayBestSourceMarker.visible = false
placementOverlayBestSourceMarker.frustumCulled = false
;(placementOverlayBestSourceMarker as any).raycast = () => {}

const placementOverlayBestTargetMarker = new THREE.Mesh(placementOverlayMarkerGeometry, vertexOverlayHintTargetMarkerMaterial)
placementOverlayBestTargetMarker.name = 'PlacementOverlayBestTargetMarker'
placementOverlayBestTargetMarker.renderOrder = 19998
placementOverlayBestTargetMarker.visible = false
placementOverlayBestTargetMarker.frustumCulled = false
;(placementOverlayBestTargetMarker as any).raycast = () => {}

const placementOverlaySecondarySourceMarker = new THREE.Mesh(placementOverlayMarkerGeometry, vertexOverlayHintSourceMarkerMaterial)
placementOverlaySecondarySourceMarker.name = 'PlacementOverlaySecondarySourceMarker'
placementOverlaySecondarySourceMarker.renderOrder = 19997
placementOverlaySecondarySourceMarker.visible = false
placementOverlaySecondarySourceMarker.frustumCulled = false
;(placementOverlaySecondarySourceMarker as any).raycast = () => {}

const placementOverlaySecondaryTargetMarker = new THREE.Mesh(placementOverlayMarkerGeometry, vertexOverlayHintTargetMarkerMaterial)
placementOverlaySecondaryTargetMarker.name = 'PlacementOverlaySecondaryTargetMarker'
placementOverlaySecondaryTargetMarker.renderOrder = 19997
placementOverlaySecondaryTargetMarker.visible = false
placementOverlaySecondaryTargetMarker.frustumCulled = false
;(placementOverlaySecondaryTargetMarker as any).raycast = () => {}

vertexOverlayGroup.add(placementOverlayBestBeamOutline)
vertexOverlayGroup.add(placementOverlayBestBeam)
vertexOverlayGroup.add(placementOverlaySecondaryBeamOutline)
vertexOverlayGroup.add(placementOverlaySecondaryBeam)
vertexOverlayGroup.add(placementOverlayBestSourceMarker)
vertexOverlayGroup.add(placementOverlayBestTargetMarker)
vertexOverlayGroup.add(placementOverlaySecondarySourceMarker)
vertexOverlayGroup.add(placementOverlaySecondaryTargetMarker)

const vertexOverlayHintDirHelper = new THREE.Vector3()
const vertexOverlayHintMidHelper = new THREE.Vector3()
const vertexOverlayHintQuatHelper = new THREE.Quaternion()
// Bigger + outlined so it stays readable across scenes.
const VERTEX_OVERLAY_HINT_BASE_RADIUS = 0.04
const VERTEX_OVERLAY_HINT_PULSE_RADIUS = 0.01
const VERTEX_OVERLAY_HINT_OUTLINE_RADIUS_MULTIPLIER = 1.6
const VERTEX_OVERLAY_HINT_MARKER_RADIUS_MULTIPLIER = 1.6
const VERTEX_OVERLAY_HINT_BASE_OPACITY = 0.22
const VERTEX_OVERLAY_HINT_PULSE_OPACITY = 0.06

const WALL_ERASE_UNIT_LENGTH_FALLBACK_M = 0.5

const wallEraseUnitLengthM = computed(() => {
  const value = Number(scatterEraseRadius.value)
  if (!Number.isFinite(value)) {
    return WALL_ERASE_UNIT_LENGTH_FALLBACK_M
  }
  // Avoid degenerate intervals.
  return Math.max(1e-3, Math.abs(value))
})

const wallEraseHoverPresenter = createWallEraseHoverPresenter({
  instancedHoverMaterial,
  instancedHoverRestoreMaterial,
  instancedOutlineSync: {
    syncProxyMatrixFromSlot: (proxy, mesh, index) => {
      if (!(proxy as { isMesh?: boolean }).isMesh) {
        return
      }
      instancedOutlineManager.syncProxyMatrixFromSlot(proxy as THREE.Mesh, mesh, index)
    },
  },
})
const {
  wallEraseHoverGroup,
  wallEraseRepeatHoverGroup,
  clearWallEraseHoverHighlight,
  updateWallEraseHoverHighlight,
  dispose: disposeWallEraseHoverPresenter,
} = wallEraseHoverPresenter
vertexOverlayGroup.add(wallEraseHoverGroup)
vertexOverlayGroup.add(wallEraseRepeatHoverGroup)


let pendingVertexSnapResult: VertexSnapResult | null = null

function clearVertexSnapMarkers() {
  vertexOverlayHintBeamOutline.visible = false
  vertexOverlayHintBeam.visible = false
  vertexOverlayHintSourceMarker.visible = false
  vertexOverlayHintTargetMarker.visible = false
}

function buildRepeatErasedSlotKeySet(
  slots: Array<{ chainIndex?: unknown; slotIndex?: unknown }> | undefined,
): Set<string> {
  const keySet = new Set<string>()
  ;(Array.isArray(slots) ? slots : []).forEach((slot) => {
    const chainIndex = Math.max(0, Math.trunc(Number(slot?.chainIndex ?? 0)))
    const slotIndex = Math.max(0, Math.trunc(Number(slot?.slotIndex ?? -1)))
    if (!Number.isFinite(chainIndex) || !Number.isFinite(slotIndex) || slotIndex < 0) {
      return
    }
    keySet.add(`${chainIndex}:${slotIndex}`)
  })
  return keySet
}

function getWallInstancedBindingSpecs(object: THREE.Object3D): WallInstancedBindingSpec[] {
  const raw = (object.userData as Record<string, unknown> | undefined)?.[WALL_INSTANCED_BINDINGS_USERDATA_KEY]
  return Array.isArray(raw) ? raw.filter((entry) => Boolean(entry && typeof entry === 'object')) as WallInstancedBindingSpec[] : []
}

function collectRepeatRenderableSlotKeySet(
  wallObject: THREE.Object3D | null,
): Set<string> {
  const keySet = new Set<string>()
  if (!wallObject) {
    return keySet
  }

  const specs = getWallInstancedBindingSpecs(wallObject)
  specs.forEach((spec) => {
    const metas = Array.isArray(spec.instanceMetas) ? spec.instanceMetas : []
    metas.forEach((meta) => {
      const chainIndex = Math.max(0, Math.trunc(Number(meta?.chainIndex ?? 0)))
      const slotIndex = Math.max(0, Math.trunc(Number(meta?.repeatSlotIndex ?? -1)))
      if (!Number.isFinite(chainIndex) || !Number.isFinite(slotIndex) || slotIndex < 0) {
        return
      }
      keySet.add(`${chainIndex}:${slotIndex}`)
    })
  })

  if (keySet.size > 0) {
    return keySet
  }

  wallObject.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    const meta = extractWallRepeatInstanceMeta(mesh)
    if (!meta) {
      return
    }
    keySet.add(`${meta.chainIndex}:${meta.slotIndex}`)
  })
  return keySet
}

function shouldRemoveWallNodeAfterErase(
  node: SceneNode,
  nextWallMesh: WallDynamicMesh,
  wallObject: THREE.Object3D | null,
): boolean {
  const renderMode = resolveSelectedWallRenderMode(node)
  if (renderMode === 'stretch') {
    return compileWallSegmentsFromDefinition(nextWallMesh).length === 0
  }

  const renderableSlotKeys = collectRepeatRenderableSlotKeySet(wallObject)
  if (renderableSlotKeys.size === 0) {
    return false
  }
  const erasedKeys = buildRepeatErasedSlotKeySet(
    (nextWallMesh as unknown as { repeatErasedSlots?: Array<{ chainIndex?: unknown; slotIndex?: unknown }> }).repeatErasedSlots,
  )
  for (const key of renderableSlotKeys) {
    if (!erasedKeys.has(key)) {
      return false
    }
  }
  return true
}

function applyWallMeshEraseResult(node: SceneNode, nodeId: string, nextWallMesh: WallDynamicMesh): void {
  const wallObject = objectMap.get(nodeId) ?? null
  if (shouldRemoveWallNodeAfterErase(node, nextWallMesh, wallObject)) {
    sceneStore.removeSceneNodes([nodeId])
    const selectedId = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
    if (selectedId === nodeId && scatterEraseModeActive.value) {
      exitScatterEraseMode()
    }
    return
  }
  sceneStore.updateNodeDynamicMesh(nodeId, nextWallMesh)
}

const wallEraseController = createWallEraseController({
  getSceneNodes: () => sceneStore.nodes,
  getSelectedWallId: () => sceneStore.selectedNodeId ?? props.selectedNodeId ?? null,
  objectMap,
  raycaster,
  groundPlane,
  wallRepairModeActive,
  wallEraseUnitLengthM,
  collectInstancedPickTargets,
  applyWallMeshEraseResult,
  onAfterApply: () => {
    clearRepairHoverHighlight(true)
    updateOutlineSelectionTargets()
    updateSelectionHighlights()
    updatePlaceholderOverlayPositions()
  },
})

const { resolveSelectedWallEraseTargetFromCurrentRay, applySelectedWallEraseTarget } = wallEraseController

const wallDoorSelectionController = createWallDoorSelectionController({
  objectMap,
  getSceneNodes: () => sceneStore.nodes,
  getCamera: () => camera,
  canvasRef,
  surfaceRef,
  isObjectWorldVisible,
  resolveSelectedWallRenderMode,
  extractWallRepeatInstanceMeta,
  mergeWallRepeatErasedSlots,
  setBoundingBoxFromObject,
  applyWallMeshEraseResult,
})

const { wallDoorSelectionHighlightGroup, dispose: disposeWallDoorSelectionController } = wallDoorSelectionController

const placementOverlayHintDirHelper = new THREE.Vector3()
const placementOverlayHintMidHelper = new THREE.Vector3()
const placementOverlayHintQuatHelper = new THREE.Quaternion()

function clearPlacementSideSnapMarkers() {
  placementOverlayBestBeamOutline.visible = false
  placementOverlayBestBeam.visible = false
  placementOverlaySecondaryBeamOutline.visible = false
  placementOverlaySecondaryBeam.visible = false
  placementOverlayBestSourceMarker.visible = false
  placementOverlayBestTargetMarker.visible = false
  placementOverlaySecondarySourceMarker.visible = false
  placementOverlaySecondaryTargetMarker.visible = false
}

function updatePlacementSideSnapMarkers(result: PlacementSnapResult | null) {
  if (!result || result.candidates.length === 0) {
    clearPlacementSideSnapMarkers()
    return
  }

  const [best, secondary] = result.candidates
  if (!best) {
    clearPlacementSideSnapMarkers()
    return
  }
  const applyBeam = (
    beam: THREE.Mesh,
    beamOutline: THREE.Mesh,
    sourceMarker: THREE.Mesh,
    targetMarker: THREE.Mesh,
    snap: VertexSnapResult,
  ) => {
    placementOverlayHintDirHelper.copy(snap.targetWorld).sub(snap.sourceWorld)
    const len = placementOverlayHintDirHelper.length()
    if (!Number.isFinite(len) || len <= 1e-6) {
      beam.visible = false
      beamOutline.visible = false
      sourceMarker.visible = false
      targetMarker.visible = false
      return
    }

    placementOverlayHintMidHelper.copy(snap.sourceWorld).add(snap.targetWorld).multiplyScalar(0.5)
    placementOverlayHintDirHelper.multiplyScalar(1 / len)
    placementOverlayHintQuatHelper.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, placementOverlayHintDirHelper)

    beam.position.copy(placementOverlayHintMidHelper)
    beam.quaternion.copy(placementOverlayHintQuatHelper)
    beam.scale.set(VERTEX_OVERLAY_HINT_BASE_RADIUS, len, VERTEX_OVERLAY_HINT_BASE_RADIUS)
    beam.visible = true

    beamOutline.position.copy(placementOverlayHintMidHelper)
    beamOutline.quaternion.copy(placementOverlayHintQuatHelper)
    beamOutline.scale.set(
      VERTEX_OVERLAY_HINT_BASE_RADIUS * VERTEX_OVERLAY_HINT_OUTLINE_RADIUS_MULTIPLIER,
      len,
      VERTEX_OVERLAY_HINT_BASE_RADIUS * VERTEX_OVERLAY_HINT_OUTLINE_RADIUS_MULTIPLIER,
    )
    beamOutline.visible = true

    const markerRadius = VERTEX_OVERLAY_HINT_BASE_RADIUS * VERTEX_OVERLAY_HINT_MARKER_RADIUS_MULTIPLIER
    sourceMarker.position.copy(snap.sourceWorld)
    sourceMarker.scale.setScalar(markerRadius)
    sourceMarker.visible = true
    targetMarker.position.copy(snap.targetWorld)
    targetMarker.scale.setScalar(markerRadius)
    targetMarker.visible = true
  }

  applyBeam(
    placementOverlayBestBeam,
    placementOverlayBestBeamOutline,
    placementOverlayBestSourceMarker,
    placementOverlayBestTargetMarker,
    best,
  )
  if (secondary) {
    applyBeam(
      placementOverlaySecondaryBeam,
      placementOverlaySecondaryBeamOutline,
      placementOverlaySecondarySourceMarker,
      placementOverlaySecondaryTargetMarker,
      secondary,
    )
  } else {
    placementOverlaySecondaryBeamOutline.visible = false
    placementOverlaySecondaryBeam.visible = false
    placementOverlaySecondarySourceMarker.visible = false
    placementOverlaySecondaryTargetMarker.visible = false
  }
}

function updateVertexSnapMarkers(result: VertexSnapResult | null) {
  if (!result) {
    clearVertexSnapMarkers()
    return
  }

  vertexOverlayHintDirHelper.copy(result.targetWorld).sub(result.sourceWorld)
  const len = vertexOverlayHintDirHelper.length()
  if (!Number.isFinite(len) || len <= 1e-6) {
    clearVertexSnapMarkers()
    return
  }

  vertexOverlayHintMidHelper.copy(result.sourceWorld).add(result.targetWorld).multiplyScalar(0.5)
  vertexOverlayHintDirHelper.multiplyScalar(1 / len)
  vertexOverlayHintQuatHelper.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, vertexOverlayHintDirHelper)

  vertexOverlayHintBeamOutline.position.copy(vertexOverlayHintMidHelper)
  vertexOverlayHintBeamOutline.quaternion.copy(vertexOverlayHintQuatHelper)
  vertexOverlayHintBeamOutline.scale.set(
    VERTEX_OVERLAY_HINT_BASE_RADIUS * VERTEX_OVERLAY_HINT_OUTLINE_RADIUS_MULTIPLIER,
    len,
    VERTEX_OVERLAY_HINT_BASE_RADIUS * VERTEX_OVERLAY_HINT_OUTLINE_RADIUS_MULTIPLIER,
  )
  vertexOverlayHintBeamOutline.visible = true

  vertexOverlayHintBeam.position.copy(vertexOverlayHintMidHelper)
  vertexOverlayHintBeam.quaternion.copy(vertexOverlayHintQuatHelper)
  // CylinderGeometry is unit height along +Y; scale Y to length.
  vertexOverlayHintBeam.scale.set(VERTEX_OVERLAY_HINT_BASE_RADIUS, len, VERTEX_OVERLAY_HINT_BASE_RADIUS)
  vertexOverlayHintBeam.visible = true

  const markerRadius = VERTEX_OVERLAY_HINT_BASE_RADIUS * VERTEX_OVERLAY_HINT_MARKER_RADIUS_MULTIPLIER
  vertexOverlayHintSourceMarker.position.copy(result.sourceWorld)
  vertexOverlayHintSourceMarker.scale.setScalar(markerRadius)
  vertexOverlayHintSourceMarker.visible = true
  vertexOverlayHintTargetMarker.position.copy(result.targetWorld)
  vertexOverlayHintTargetMarker.scale.setScalar(markerRadius)
  vertexOverlayHintTargetMarker.visible = true
}

const updateVertexSnapHintPulse = (nowMs: number) => {
  if (!vertexOverlayHintBeam.visible) {
    return
  }
  // Gentle ~2Hz pulse.
  const t = nowMs * 0.002
  const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2)
  const opacity = VERTEX_OVERLAY_HINT_BASE_OPACITY + VERTEX_OVERLAY_HINT_PULSE_OPACITY * pulse
  vertexOverlayHintBeamMaterial.opacity = opacity

  const radius = VERTEX_OVERLAY_HINT_BASE_RADIUS + VERTEX_OVERLAY_HINT_PULSE_RADIUS * pulse
  vertexOverlayHintBeam.scale.x = radius
  vertexOverlayHintBeam.scale.z = radius

  const outlineRadius = radius * VERTEX_OVERLAY_HINT_OUTLINE_RADIUS_MULTIPLIER
  vertexOverlayHintBeamOutline.scale.x = outlineRadius
  vertexOverlayHintBeamOutline.scale.z = outlineRadius

  const markerRadius = radius * VERTEX_OVERLAY_HINT_MARKER_RADIUS_MULTIPLIER
  vertexOverlayHintSourceMarker.scale.setScalar(markerRadius)
  vertexOverlayHintTargetMarker.scale.setScalar(markerRadius)
}

const updatePlacementSideSnapHintPulse = (nowMs: number) => {
  const t = nowMs * 0.002
  const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2)
  const radius = VERTEX_OVERLAY_HINT_BASE_RADIUS + VERTEX_OVERLAY_HINT_PULSE_RADIUS * pulse
  const outlineRadius = radius * VERTEX_OVERLAY_HINT_OUTLINE_RADIUS_MULTIPLIER
  const markerRadius = radius * VERTEX_OVERLAY_HINT_MARKER_RADIUS_MULTIPLIER

  if (placementOverlayBestBeam.visible) {
    placementOverlayBestBeamMaterial.opacity = 0.28 + 0.06 * pulse
    placementOverlayBestBeam.scale.x = radius
    placementOverlayBestBeam.scale.z = radius
    placementOverlayBestBeamOutline.scale.x = outlineRadius
    placementOverlayBestBeamOutline.scale.z = outlineRadius
    placementOverlayBestSourceMarker.scale.setScalar(markerRadius)
    placementOverlayBestTargetMarker.scale.setScalar(markerRadius)
  }

  if (placementOverlaySecondaryBeam.visible) {
    placementOverlaySecondaryBeamMaterial.opacity = 0.18 + 0.04 * pulse
    placementOverlaySecondaryBeam.scale.x = radius
    placementOverlaySecondaryBeam.scale.z = radius
    placementOverlaySecondaryBeamOutline.scale.x = outlineRadius
    placementOverlaySecondaryBeamOutline.scale.z = outlineRadius
    placementOverlaySecondarySourceMarker.scale.setScalar(markerRadius)
    placementOverlaySecondaryTargetMarker.scale.setScalar(markerRadius)
  }
}

const GROUND_STREAMING_RADIUS_MIN_METERS = 200
const GROUND_STREAMING_RADIUS_HEIGHT_MAX_METERS = 2600
const GROUND_STREAMING_RADIUS_ABSOLUTE_CAP_METERS = 5000
const GROUND_STREAMING_RADIUS_FAR_CLIP_FACTOR = 0.58
const GROUND_STREAMING_RADIUS_FOV_BASE_DEGREES = 60
const GROUND_STREAMING_HEIGHT_START_METERS = 80
const GROUND_STREAMING_HEIGHT_END_METERS = 1200
const dynamicGroundStreamingCameraWorldHelper = new THREE.Vector3()
const dynamicGroundStreamingGroundWorldHelper = new THREE.Vector3()

type GroundStreamingMetrics = {
  normalizedHeight: number
  radiusMeters: number
}

function resolveDynamicGroundStreamingMetrics(groundObject?: THREE.Object3D | null): GroundStreamingMetrics {
  const activeCamera = camera
  if (!activeCamera) {
    return {
      normalizedHeight: 0,
      radiusMeters: GROUND_STREAMING_RADIUS_MIN_METERS,
    }
  }

  activeCamera.getWorldPosition(dynamicGroundStreamingCameraWorldHelper)

  let relativeHeight = dynamicGroundStreamingCameraWorldHelper.y
  if (groundObject) {
    groundObject.getWorldPosition(dynamicGroundStreamingGroundWorldHelper)
    relativeHeight = dynamicGroundStreamingCameraWorldHelper.y - dynamicGroundStreamingGroundWorldHelper.y
  }

  const normalizedHeight = THREE.MathUtils.clamp(
    (Math.max(0, relativeHeight) - GROUND_STREAMING_HEIGHT_START_METERS) /
      Math.max(1e-6, GROUND_STREAMING_HEIGHT_END_METERS - GROUND_STREAMING_HEIGHT_START_METERS),
    0,
    1,
  )

  const cameraLike = activeCamera as THREE.PerspectiveCamera & { aspect?: number; fov?: number; far?: number }
  const aspect = Number.isFinite(cameraLike.aspect) ? Math.max(0.2, Number(cameraLike.aspect)) : 16 / 9
  const fovDeg = Number.isFinite(cameraLike.fov) ? Number(cameraLike.fov) : GROUND_STREAMING_RADIUS_FOV_BASE_DEGREES
  const halfFovRad = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(fovDeg, 25, 120) * 0.5)
  const halfViewHeight = Math.max(0, relativeHeight) * Math.tan(halfFovRad)
  const halfViewWidth = halfViewHeight * aspect
  const viewFootprintRadius = Math.sqrt(halfViewHeight * halfViewHeight + halfViewWidth * halfViewWidth)

  const fovBaseHalfRad = THREE.MathUtils.degToRad(GROUND_STREAMING_RADIUS_FOV_BASE_DEGREES * 0.5)
  const fovFactor = THREE.MathUtils.clamp(
    Math.tan(halfFovRad) / Math.max(1e-6, Math.tan(fovBaseHalfRad)),
    0.65,
    2.2,
  )

  const radiusByHeight = THREE.MathUtils.lerp(
    GROUND_STREAMING_RADIUS_MIN_METERS,
    GROUND_STREAMING_RADIUS_HEIGHT_MAX_METERS,
    normalizedHeight,
  ) * fovFactor

  const desiredRadius = Math.max(radiusByHeight, viewFootprintRadius + 120)
  const farDistance = Number.isFinite(cameraLike.far) ? Math.max(0, Number(cameraLike.far)) : GROUND_STREAMING_RADIUS_ABSOLUTE_CAP_METERS
  const farClipCap = farDistance > 0 ? farDistance * GROUND_STREAMING_RADIUS_FAR_CLIP_FACTOR : GROUND_STREAMING_RADIUS_ABSOLUTE_CAP_METERS
  const effectiveCap = Math.max(
    GROUND_STREAMING_RADIUS_MIN_METERS,
    Math.min(GROUND_STREAMING_RADIUS_ABSOLUTE_CAP_METERS, farClipCap),
  )

  return {
    normalizedHeight,
    radiusMeters: THREE.MathUtils.clamp(
      desiredRadius,
      GROUND_STREAMING_RADIUS_MIN_METERS,
      effectiveCap,
    ),
  }
}

function resolveDynamicGroundStreamingRadiusMeters(groundObject?: THREE.Object3D | null): number {
  return resolveDynamicGroundStreamingMetrics(groundObject).radiusMeters
}

function resolveDynamicGroundAndScatterStreamingRadiusMeters(): number {
  const node = getGroundNodeFromStore()
  if (!node || node.dynamicMesh?.type !== 'Ground') {
    return resolveDynamicGroundStreamingRadiusMeters(null)
  }
  const groundObject = resolveGroundRuntimeObjectFromMap(objectMap, node.id)
  return resolveDynamicGroundStreamingRadiusMeters(groundObject)
}

function resolveGroundScatterChunkStreamingEnabled(): boolean {
  const node = getGroundNodeFromStore()
  if (!node || node.dynamicMesh?.type !== 'Ground') {
    return false
  }
  if (sceneStore.groundSettings.editorScatterDynamicStreamingEnabled === false) {
    return false
  }
  return isGroundChunkStreamingEnabled(node.dynamicMesh)
}

function isEditorGroundScatterVisible(): boolean {
  return sceneStore.groundSettings.editorScatterVisible !== false
}

const DISABLE_EDITOR_VIEWPORT_SCATTER_LOD_RUNTIME = true
const DISABLE_EDITOR_VIEWPORT_INSTANCED_CULLING = true

const groundEditor = createGroundEditor({
  sceneStore,
  getSceneNodes: () => props.sceneNodes,
  canvasRef,
  surfaceRef,
  raycaster,
  pointer,
  groundPlane,
  objectMap,
  pickNodeAtPointer: pickNodeAtPointer,
  getCamera: () => camera,
  getScene: () => scene,
  brushRadius,
  brushStrength,
  brushDepth,
  brushSlope,
  brushShape,
  brushOperation,
  groundPanelTab,
  paintAsset: paintSelectedAsset,
  paintLayerStyle: paintBrushSettings,
  scatterCategory,
  scatterAsset: scatterSelectedAsset,
  scatterBrushRadius,
  scatterBrushShape,
  scatterRegularPolygonSides,
  scatterSpacing,
  scatterEraseRadius,
  scatterDensityPercent,
  activeBuildTool,
  resolveAutoOverlayPlan: resolveScatterAutoOverlayPlanForEvent,
  scatterEraseModeActive,
  resolveVertexSnapPoint: resolveBuildToolVertexSnapPoint,
  clearVertexSnap: clearBuildToolVertexSnap,
  lockScatterLodToBaseAsset: true,
  disableScatterLodRuntime: DISABLE_EDITOR_VIEWPORT_SCATTER_LOD_RUNTIME,
  isScatterVisible: isEditorGroundScatterVisible,
  scatterChunkStreaming: {
    enabled: resolveGroundScatterChunkStreamingEnabled,
    getDynamicRadiusMeters: resolveDynamicGroundAndScatterStreamingRadiusMeters,
  },
  onSculptStart: () => {
    handleGroundTerrainMenuOpen(false)
  },
  onTerrainPaintSurfacePreviewChanged: syncGroundSurfacePreviewFromLiveTerrainPaint,
  disableOrbitForGroundSelection,
  restoreOrbitAfterGroundSelection,
  isAltOverrideActive: () => isAltOverrideActive,
  prepareGroundRuntimeDefinition: applyViewportGroundRuntimeMode,
  onSculptCommitApplied: ({ groundObject, definition }: { groundObject: THREE.Object3D; definition: GroundRuntimeDynamicMesh }) => {
    const signature = computeGroundDynamicMeshSignature(definition)
    const signatureTarget = resolveGroundSignatureTarget(groundObject)
    const userData = signatureTarget.userData ?? (signatureTarget.userData = {})
    userData[GROUND_SCULPT_SKIP_REFRESH_SIGNATURE_KEY] = signature
    userData[DYNAMIC_MESH_SIGNATURE_KEY] = signature
    pendingViewportGroundOptimizedRebuild = true
  },
  onScatterEraseStart: () => {
    scatterEraseMenuOpen.value = false
  },
  onScatterPlacementStart: () => {
    groundScatterMenuOpen.value = false
  },
})

const {
  brushMesh,
  scatterAreaPreviewGroup,
  terrainSculptPreviewGroup,
  scatterPreviewGroup,
  groundSelectionGroup,
  groundSelection,
  groundTextureInputRef,
  restoreGroupdScatter,
  restoreGroundPaint,
  onGroundChunkSetChanged,
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
  flushTerrainPaintChanges,
} = groundEditor

function exitScatterEraseMode() {
  if (!scatterEraseModeActive.value) {
    return
  }
  scatterEraseModeActive.value = false
  if (uiStore.activeSelectionContext === 'scatter-erase') {
    uiStore.setActiveSelectionContext(null)
  }
  pointerInteraction.clearIfKind('repairClick')
  instancedEraseDragState = null
  clearRepairHoverHighlight(true)
  clearWallEraseHoverHighlight()
  cancelGroundEditorScatterErase()
  cancelGroundEditorScatterPlacement()
  scatterEraseMenuOpen.value = false
}

watch(
  () => [scatterEraseModeActive.value, selectedNodeIsWall.value] as const,
  ([active, isWall]) => {
    if (!active || !isWall) {
      clearWallEraseHoverHighlight()
    }
  },
)

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
  if (sceneStore.selectedAssetId) {
    sceneStore.selectAsset(null)
  }
  terrainStore.setBrushOperation(null)
  // Prefer terrain scatter erase whenever possible so ground erase works even
  // when the current selection is not the ground node.
  if (!selectedNodeIsWall.value) {
    if (activeBuildTool.value !== 'scatter') {
      handleBuildToolChange('scatter')
    }
  } else {
    handleBuildToolChange(null)
  }
  cancelGroundEditorScatterPlacement()
  scatterEraseModeActive.value = true
  uiStore.setActiveSelectionContext('scatter-erase')
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

// If a model/mesh/prefab asset is selected from the asset panel, cancel
// scatter-erase mode so painting/erasing cannot run while placing assets.
watch(
  () => sceneStore.selectedAssetId,
  (assetId) => {
    if (assetId && scatterEraseModeActive.value) {
      exitScatterEraseMode()
    }
  },
)

watch(brushOperation, (operation) => {
  if (operation && scatterEraseModeActive.value) {
    exitScatterEraseMode()
  }
})

function handleScatterEraseMenuOpen(value: boolean) {
  scatterEraseMenuOpen.value = value
}

function handleCameraResetMenuOpen(value: boolean) {
  cameraResetMenuOpen.value = Boolean(value)
}

function handleClearAllScatterInstances() {
  if (!hasGroundNode.value) {
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
  if (!scatterEraseModeActive.value) {
    if (repairHoverGroup.visible) {
      clearRepairHoverHighlight(true)
    }
    clearWallEraseHoverHighlight()
    return false
  }

  scatterEraseRestoreModifierActive.value = Boolean(event.ctrlKey || event.metaKey)

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

  // When a wall node is selected, show an erase/repair preview on that wall.
  // Procedural walls are not necessarily part of instanced pick targets.
  // 如果当前选择的节点是墙体，执行墙体擦除悬停突出显示逻辑
  if (selectedNodeIsWall.value) {
    // 清除之前的修复悬停高亮（如果存在）
    if (repairHoverGroup.visible) {
      clearRepairHoverHighlight(true)
    }

    // 获取当前选中的墙体节点ID
    const target = resolveSelectedWallEraseTargetFromCurrentRay()
    if (target) {
      updateWallEraseHoverHighlight(target)
      return true
    }

    // 若所有碰撞检测都失败，清除墙体擦除悬停高亮
    clearWallEraseHoverHighlight()
    return false
  }

  if (!hasInstancedMeshes.value) {
    if (repairHoverGroup.visible) {
      clearRepairHoverHighlight(true)
    }
    clearWallEraseHoverHighlight()
    return false
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
    const node = findSceneNode(sceneStore.nodes, nodeId)
    if (!node) {
      continue
    }

    const binding = getModelInstanceBindingById(bindingId)
    if (!binding) {
      continue
    }

    const hoverMaterial = scatterEraseRestoreModifierActive.value ? instancedHoverRestoreMaterial : instancedHoverMaterial

    const activeHandles = new Set<string>()
    binding.slots.forEach((slot) => {
      const proxyKey = slot.handleId
      activeHandles.add(proxyKey)
      let proxy = repairHoverProxies.get(proxyKey)
      if (!proxy) {
        const created = createInstancedOutlineProxy(slot.mesh)
        created.material = hoverMaterial
        created.renderOrder = 1000
        repairHoverProxies.set(proxyKey, created)
        repairHoverGroup.add(created)
        proxy = created
      } else {
        if (proxy.geometry !== slot.mesh.geometry) {
          proxy.geometry = slot.mesh.geometry
        }
        if (proxy.material !== hoverMaterial) {
          proxy.material = hoverMaterial
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

  // InstanceLayout grid restore: erased instances are not raycastable, so when Shift is held
  // we snap to the nearest grid index under the cursor (selected node only).
  if (scatterEraseRestoreModifierActive.value) {
    const selectedNodeId = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
    if (!selectedNodeId) {
      if (repairHoverGroup.visible) {
        clearRepairHoverHighlight(true)
      }
      return false
    }
    const selectedNode = selectedNodeId ? findSceneNode(sceneStore.nodes, selectedNodeId) : null
    if (selectedNode && (selectedNode as any).instanceLayout) {
      const layout = clampSceneNodeInstanceLayout((selectedNode as any).instanceLayout)
      const object = selectedNodeId ? (objectMap.get(selectedNodeId) ?? null) : null
      if (object && layout.mode === 'grid') {
        const planeHit = new THREE.Vector3()
        if (raycaster.ray.intersectPlane(groundPlane, planeHit)) {
          const index = findNearestInstanceLayoutGridIndexAtWorldPoint({
            object,
            layout,
            hitWorld: planeHit,
            maxDistanceWorld: Math.max(0.25, Number(scatterEraseRadius.value) || 0.25),
          })

          const userData = object.userData as any
          const locals = (userData?.__harmonyInstanceLayoutCache?.locals as THREE.Matrix4[] | undefined) ?? null
          const templateMesh = (userData?.__harmonyInstanceLayoutHiddenMesh as THREE.Mesh | undefined) ?? null

          if (typeof index === 'number' && index >= 1 && Array.isArray(locals) && locals[index] && templateMesh?.isMesh) {
            const key = `instance-layout-restore:${selectedNodeId}`
            const hoverMaterial = instancedHoverRestoreMaterial

            let proxy = repairHoverProxies.get(key)
            if (!proxy) {
              const created = new THREE.Mesh(templateMesh.geometry, hoverMaterial)
              created.renderOrder = 1000
              created.matrixAutoUpdate = false
              repairHoverProxies.set(key, created)
              repairHoverGroup.add(created)
              proxy = created
            } else {
              if (proxy.geometry !== templateMesh.geometry) {
                proxy.geometry = templateMesh.geometry
              }
              if (proxy.material !== hoverMaterial) {
                proxy.material = hoverMaterial
              }
              proxy.renderOrder = 1000
              proxy.matrixAutoUpdate = false
              if (proxy.parent !== repairHoverGroup) {
                repairHoverGroup.add(proxy)
              }
            }

            object.updateWorldMatrix(true, true)
            proxy.matrix.copy(object.matrixWorld).multiply(locals[index] as THREE.Matrix4)
            proxy.visible = true

            repairHoverProxies.forEach((other, otherKey) => {
              if (otherKey !== key) {
                other.visible = false
              }
            })

            repairHoverGroup.visible = true
            return true
          }
        }
      }
    }
  }

  if (repairHoverGroup.visible) {
    clearRepairHoverHighlight(true)
  }
  return false
}

function collectInstancedPickTargets(): THREE.InstancedMesh[] {
  if (instancedBoundsHasPending()) {
    flushInstancedBounds()
  }

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

function eraseInstancedBinding(nodeId: string, bindingId: string, hitPointWorld?: THREE.Vector3 | null): boolean {
  const node = findSceneNode(sceneStore.nodes, nodeId)
  if (!node) {
    return false
  }

  // InstanceLayout grid: erase/restore a single instance index instead of removing the whole node.
  if ((node as any).instanceLayout) {
    const layout = clampSceneNodeInstanceLayout((node as any).instanceLayout)
    if (layout.mode === 'grid') {
      const prefix = `${nodeId}:instance:`
      const index = bindingId === nodeId
        ? 0
        : bindingId.startsWith(prefix)
          ? Number.parseInt(bindingId.slice(prefix.length), 10)
          : NaN

      const maxCount = getInstanceLayoutCount(layout)
      // Reserve index 0 (node binding) and ignore invalid indices.
      if (Number.isFinite(index) && index >= 1 && index < maxCount) {
        const current = Array.isArray(layout.erasedIndices) ? layout.erasedIndices : []
        const set = new Set<number>(current)
        if (scatterEraseRestoreModifierActive.value) {
          set.delete(index)
        } else {
          set.add(index)
        }
        const nextLayout = { ...layout, erasedIndices: Array.from(set.values()).sort((a, b) => a - b) }
        sceneStore.updateNodeInstanceLayout(nodeId, nextLayout)
        clearRepairHoverHighlight(true)
        updateOutlineSelectionTargets()
        updateSelectionHighlights()
        updatePlaceholderOverlayPositions()
        return true
      }
    }
  }

  // Continuous instanced models: remove single instance from continuous sequences.
  const continuous = Boolean(getContinuousInstancedModelUserData(node))
  if (continuous) {
    return eraseContinuousInstance(nodeId, bindingId)
  }

  // Wall dynamic mesh: erase (add opening) or repair (remove opening).
  // - erase: add a WallOpening at the clicked position (default 0.5m radius)
  // - repair (Shift): remove an existing WallOpening that covers the clicked position
  if ((node as any).dynamicMesh?.type === 'Wall' && hitPointWorld) {
    const selectedWallId = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
    if (selectedWallId === nodeId) {
      const target = resolveSelectedWallEraseTargetFromCurrentRay()
      if (target) {
        return applySelectedWallEraseTarget(target)
      }
    }

    const object = objectMap.get(nodeId) ?? null
    const wallMesh = (node as any).dynamicMesh as WallDynamicMesh
    const hasChains = Array.isArray(wallMesh.chains) && wallMesh.chains.length > 0
    if (object && hasChains) {
      const inv = new THREE.Matrix4().copy(object.matrixWorld).invert()
      const localPoint = hitPointWorld.clone().applyMatrix4(inv)

      const unitLenM = wallEraseUnitLengthM.value
      const halfLenM = unitLenM * 0.5

      if (wallRepairModeActive.value) {
        // Repair = remove the opening that covers the clicked spot
        const openingIdx = findContainingWallOpeningIndex(wallMesh, localPoint)
        if (openingIdx < 0) {
          return false
        }
        const nextOpenings = removeWallOpeningFromDefinition(wallMesh, openingIdx)
        applyWallMeshEraseResult(node, nodeId, { ...wallMesh, openings: nextOpenings })
      } else {
        // Erase = add a new WallOpening (width equals current erase brush width in meters)
        const newOpening = computeWallOpeningForLocalHit(wallMesh, localPoint, halfLenM)
        if (!newOpening) {
          return false
        }
        const nextOpenings = addWallOpeningToDefinition(wallMesh, newOpening)
        applyWallMeshEraseResult(node, nodeId, { ...wallMesh, openings: nextOpenings })
      }

      clearRepairHoverHighlight(true)
      updateOutlineSelectionTargets()
      updateSelectionHighlights()
      updatePlaceholderOverlayPositions()
      return true
    }
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

function clearWallDoorRectangleSelectionState(): void {
  if (wallDoorRectangleSelectionState) {
    pointerInteraction.releaseIfCaptured(wallDoorRectangleSelectionState.pointerId)
  }
  wallDoorRectangleSelectionState = null
  wallDoorSelectionOverlayBox.value = null
}

function clearWallDoorSelectionPayload(): void {
  wallDoorSelectionPayload.value = null
  wallDoorSelectionController.clearWallDoorSelectionHighlight()
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

  scatterEraseRestoreModifierActive.value = Boolean(event.ctrlKey || event.metaKey)

  // Selected wall: erase by raycasting the wall object itself (supports procedural walls)
  // and generate a per-interval key so drag erase doesn't spam the same spot.
  if (selectedNodeIsWall.value) {
    const target = resolveSelectedWallEraseTargetFromCurrentRay()
    if (!target) {
      return { handled: false, erasedKey: null }
    }
    if (options?.skipKey && target.dragKey === options.skipKey) {
      return { handled: false, erasedKey: null }
    }
    const handled = applySelectedWallEraseTarget(target)
    return { handled, erasedKey: handled ? target.dragKey : null }
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
    const handled = eraseInstancedBinding(nodeId, bindingId, intersection.point ? (intersection.point as THREE.Vector3) : null)
    clearRepairHoverHighlight(true)
    return { handled, erasedKey: key }
  }

  // InstanceLayout grid restore: erased instances are not raycastable, so allow Shift-click
  // to restore the nearest grid index for the selected node.
  if (scatterEraseRestoreModifierActive.value) {
    const selectedNodeId = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
    if (!selectedNodeId) {
      return { handled: false, erasedKey: null }
    }
    const selectedNode = selectedNodeId ? findSceneNode(sceneStore.nodes, selectedNodeId) : null
    if (selectedNode && (selectedNode as any).instanceLayout) {
      const layout = clampSceneNodeInstanceLayout((selectedNode as any).instanceLayout)
      const object = selectedNodeId ? (objectMap.get(selectedNodeId) ?? null) : null
      if (object && layout.mode === 'grid') {
        const planeHit = new THREE.Vector3()
        if (raycaster.ray.intersectPlane(groundPlane, planeHit)) {
          const index = findNearestInstanceLayoutGridIndexAtWorldPoint({
            object,
            layout,
            hitWorld: planeHit,
            maxDistanceWorld: Math.max(0.25, Number(scatterEraseRadius.value) || 0.25),
          })
          if (typeof index === 'number' && index >= 1) {
            const bindingId = getInstanceLayoutBindingId(selectedNodeId, index)
            const key = `${selectedNodeId}:instance-layout:${index}`
            if (options?.skipKey && key === options.skipKey) {
              return { handled: false, erasedKey: null }
            }
            const handled = eraseInstancedBinding(selectedNodeId, bindingId, planeHit)
            clearRepairHoverHighlight(true)
            return { handled, erasedKey: handled ? key : null }
          }
        }
      }
    }
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

type WallLengthHudLabel = {
  visible: boolean
  x: number
  y: number
  text: string
}

type FloorSizeHudLabel = WallLengthHudLabel

const wallLengthHud = reactive<{ visible: boolean; left: WallLengthHudLabel; right: WallLengthHudLabel }>({
  visible: false,
  left: { visible: false, x: 0, y: 0, text: '' },
  right: { visible: false, x: 0, y: 0, text: '' },
})

const floorSizeHud = reactive<{ visible: boolean; left: FloorSizeHudLabel; right: FloorSizeHudLabel }>({
  visible: false,
  left: { visible: false, x: 0, y: 0, text: '' },
  right: { visible: false, x: 0, y: 0, text: '' },
})

const displayBoardSizeHud = reactive<{ visible: boolean; label: FloorSizeHudLabel }>({
  visible: false,
  label: { visible: false, x: 0, y: 0, text: '' },
})

const wallLengthHudProjectHelper = new THREE.Vector3()
const wallLengthHudMidpointHelper3 = new THREE.Vector3()
const wallLengthHudMidpointHelper4 = new THREE.Vector3()
const wallLengthHudMidpointHelper5 = new THREE.Vector3()
const wallLengthHudMidpointHelper6 = new THREE.Vector3()
const wallLengthHudMidpointHelper7 = new THREE.Vector3()
const wallLengthHudMidpointHelper8 = new THREE.Vector3()
const HUD_NEAR_HANDLE_SAMPLE_RATIO = 0.24
const HUD_NEAR_HANDLE_OFFSET_PX = 58
const HUD_WORLD_Y_OFFSET = 0.03

function clearWallLengthHud() {
  wallLengthHud.visible = false
  wallLengthHud.left.visible = false
  wallLengthHud.right.visible = false
  wallLengthHud.left.text = ''
  wallLengthHud.right.text = ''
}

function clearFloorSizeHud() {
  floorSizeHud.visible = false
  floorSizeHud.left.visible = false
  floorSizeHud.right.visible = false
  floorSizeHud.left.text = ''
  floorSizeHud.right.text = ''
}

function clearDisplayBoardSizeHud() {
  displayBoardSizeHud.visible = false
  displayBoardSizeHud.label.visible = false
  displayBoardSizeHud.label.text = ''
}

function distanceXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.hypot(dx, dz)
}

function formatWallLengthMeters(valueMeters: number): string {
  if (!Number.isFinite(valueMeters)) {
    return ''
  }
  const abs = Math.abs(valueMeters)
  let decimals = 2
  if (abs >= 100) {
    decimals = 0
  } else if (abs >= 10) {
    decimals = 1
  }
  const factor = 10 ** decimals
  const rounded = Math.round(valueMeters * factor) / factor
  const fixed = decimals > 0 ? rounded.toFixed(decimals) : String(Math.round(rounded))
  const trimmed = fixed.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')
  return `${trimmed} m`
}

function projectWorldToOverlay(world: THREE.Vector3): { visible: boolean; x: number; y: number } {
  if (!camera || !overlayContainerRef.value) {
    return { visible: false, x: 0, y: 0 }
  }
  const bounds = overlayContainerRef.value.getBoundingClientRect()
  if (bounds.width === 0 || bounds.height === 0) {
    return { visible: false, x: 0, y: 0 }
  }

  wallLengthHudProjectHelper.copy(world).project(camera)
  if (wallLengthHudProjectHelper.z < -1 || wallLengthHudProjectHelper.z > 1) {
    return { visible: false, x: 0, y: 0 }
  }

  const x = (wallLengthHudProjectHelper.x * 0.5 + 0.5) * bounds.width
  const y = (-wallLengthHudProjectHelper.y * 0.5 + 0.5) * bounds.height
  return { visible: true, x, y }
}

function setHudLabel(label: WallLengthHudLabel, projected: { visible: boolean; x: number; y: number }, text: string) {
  label.visible = projected.visible && text.length > 0
  label.x = projected.x
  label.y = projected.y
  label.text = label.visible ? text : ''
}

function projectLabelNearHandle(
  activeWorld: THREE.Vector3,
  targetWorld: THREE.Vector3,
): { visible: boolean; x: number; y: number } {
  const activeProjected = projectWorldToOverlay(
    wallLengthHudMidpointHelper3.copy(activeWorld).setY(activeWorld.y + HUD_WORLD_Y_OFFSET),
  )
  if (!activeProjected.visible) {
    return activeProjected
  }

  const sampleProjected = projectWorldToOverlay(
    wallLengthHudMidpointHelper4
      .copy(activeWorld)
      .lerp(targetWorld, HUD_NEAR_HANDLE_SAMPLE_RATIO)
      .setY(activeWorld.y + HUD_WORLD_Y_OFFSET),
  )

  let dx = 0
  let dy = -1
  if (sampleProjected.visible) {
    dx = sampleProjected.x - activeProjected.x
    dy = sampleProjected.y - activeProjected.y
  }
  const length = Math.hypot(dx, dy)
  if (length <= 1e-3) {
    dx = 0
    dy = -1
  } else {
    dx /= length
    dy /= length
  }

  return {
    visible: true,
    x: activeProjected.x + dx * HUD_NEAR_HANDLE_OFFSET_PX,
    y: activeProjected.y + dy * HUD_NEAR_HANDLE_OFFSET_PX,
  }
}

function showWallSingleLengthLabel(startWorld: THREE.Vector3, endWorld: THREE.Vector3, text: string, activeWorld: THREE.Vector3) {
  const targetWorld = activeWorld.distanceToSquared(startWorld) <= activeWorld.distanceToSquared(endWorld) ? endWorld : startWorld
  const projected = projectLabelNearHandle(activeWorld, targetWorld)
  setHudLabel(wallLengthHud.left, projected, text)
  setHudLabel(wallLengthHud.right, { visible: false, x: 0, y: 0 }, '')
  wallLengthHud.visible = wallLengthHud.left.visible
}

function showWallLabels(options: {
  activeWorld: THREE.Vector3
  leftTarget?: THREE.Vector3 | null
  leftText?: string
  rightTarget?: THREE.Vector3 | null
  rightText?: string
}) {
  const leftProjected = options.leftTarget && options.leftText
    ? projectLabelNearHandle(options.activeWorld, options.leftTarget)
    : { visible: false, x: 0, y: 0 }
  const rightProjected = options.rightTarget && options.rightText
    ? projectLabelNearHandle(options.activeWorld, options.rightTarget)
    : { visible: false, x: 0, y: 0 }
  setHudLabel(wallLengthHud.left, leftProjected, options.leftText ?? '')
  setHudLabel(wallLengthHud.right, rightProjected, options.rightText ?? '')
  wallLengthHud.visible = wallLengthHud.left.visible || wallLengthHud.right.visible
}

function showFloorLabels(options: {
  activeWorld: THREE.Vector3
  leftTarget?: THREE.Vector3 | null
  leftText?: string
  rightTarget?: THREE.Vector3 | null
  rightText?: string
}) {
  const leftProjected = options.leftTarget && options.leftText
    ? projectLabelNearHandle(options.activeWorld, options.leftTarget)
    : { visible: false, x: 0, y: 0 }
  const rightProjected = options.rightTarget && options.rightText
    ? projectLabelNearHandle(options.activeWorld, options.rightTarget)
    : { visible: false, x: 0, y: 0 }
  setHudLabel(floorSizeHud.left, leftProjected, options.leftText ?? '')
  setHudLabel(floorSizeHud.right, rightProjected, options.rightText ?? '')
  floorSizeHud.visible = floorSizeHud.left.visible || floorSizeHud.right.visible
}

function getFloorWorldVertices(runtime: THREE.Object3D, vertices: unknown[]): THREE.Vector3[] {
  const result: THREE.Vector3[] = []
  for (const entry of vertices) {
    if (!Array.isArray(entry) || entry.length < 2) {
      continue
    }
    const lx = Number(entry[0])
    const lz = Number(entry[1])
    if (!Number.isFinite(lx) || !Number.isFinite(lz)) {
      continue
    }
    result.push(runtime.localToWorld(new THREE.Vector3(lx, 0, lz)))
  }
  return result
}

function tryShowFloorVertexAdjacentLengths(runtime: THREE.Object3D, vertices: unknown[], vertexIndex: number): boolean {
  const worldVertices = getFloorWorldVertices(runtime, vertices)
  if (worldVertices.length < 2) {
    return false
  }

  const count = worldVertices.length
  const index = THREE.MathUtils.euclideanModulo(vertexIndex, count)
  const active = worldVertices[index]
  const prev = worldVertices[(index - 1 + count) % count]
  const next = worldVertices[(index + 1) % count]
  if (!active || (!prev && !next)) {
    return false
  }

  const prevLength = prev ? distanceXZ(active, prev) : NaN
  const nextLength = next ? distanceXZ(active, next) : NaN

  if (prev && next && Number.isFinite(prevLength) && Number.isFinite(nextLength)) {
    showFloorLabels({
      activeWorld: active,
      leftTarget: prev,
      leftText: `Left ${formatWallLengthMeters(prevLength)}`,
      rightTarget: next,
      rightText: `Right ${formatWallLengthMeters(nextLength)}`,
    })
    return floorSizeHud.visible
  }

  const target = prev ?? next
  const length = target ? distanceXZ(active, target) : NaN
  if (!target || !Number.isFinite(length)) {
    return false
  }

  showFloorLabels({
    activeWorld: active,
    leftTarget: target,
    leftText: `Length ${formatWallLengthMeters(length)}`,
  })
  return floorSizeHud.visible
}

function tryShowFloorCircleSizeLabel(centerWorld: THREE.Vector3, radiusWorld: THREE.Vector3, radius: number): boolean {
  if (!Number.isFinite(radius) || radius <= 1e-6) {
    return false
  }
  showFloorLabels({
    activeWorld: radiusWorld,
    leftTarget: centerWorld,
    leftText: `Radius ${formatWallLengthMeters(radius)}  Diameter ${formatWallLengthMeters(radius * 2)}`,
  })
  return floorSizeHud.visible
}

function updateWallLengthHudFromWallDrag() {
  // Default to hidden and only enable when a wall drag is active.
  clearWallLengthHud()

  if (!camera || !overlayContainerRef.value) {
    return
  }

  // Prefer joint drag over endpoint drag if both exist (shouldn't happen, but be defensive).
  if (wallJointDragState && wallJointDragState.moved) {
    const state = wallJointDragState
    const i = Math.trunc(state.jointIndex)
    const segL = state.workingSegmentsWorld[i]
    const segR = state.workingSegmentsWorld[i + 1]
    if (!segL || !segR) {
      return
    }

    const lenL = distanceXZ(segL.start, segL.end)
    const lenR = distanceXZ(segR.start, segR.end)

    const jointWorld = segL.end
    showWallLabels({
      activeWorld: jointWorld,
      leftTarget: segL.start,
      leftText: `Left ${formatWallLengthMeters(lenL)}`,
      rightTarget: segR.end,
      rightText: `Right ${formatWallLengthMeters(lenR)}`,
    })
    return
  }

  if (wallEndpointDragState && wallEndpointDragState.moved) {
    const state = wallEndpointDragState
    const segIndex = state.endpointKind === 'start' ? state.chainStartIndex : state.chainEndIndex
    const seg = state.workingSegmentsWorld[segIndex]
    if (!seg) {
      return
    }
    const len = distanceXZ(seg.start, seg.end)
    const activeWorld = state.endpointKind === 'start' ? seg.start : seg.end
    showWallSingleLengthLabel(seg.start, seg.end, `Length ${formatWallLengthMeters(len)}`, activeWorld)
  }
}

function updateWallLengthHudFromWallBuild() {
  // Default to hidden and only enable when a wall build drag is active.
  clearWallLengthHud()

  if (!camera || !overlayContainerRef.value) {
    return
  }

  // Only show while the wall build tool is active.
  if (activeBuildTool.value !== 'wall') {
    return
  }

  const session = wallBuildTool.getSession()
  if (!session) {
    return
  }

  if (session.shapeDraft?.kind === 'rectangle') {
    const start = session.shapeDraft.start
    const end = session.shapeDraft.end
    const minX = Math.min(start.x, end.x)
    const maxX = Math.max(start.x, end.x)
    const minZ = Math.min(start.z, end.z)
    const maxZ = Math.max(start.z, end.z)
    const current = wallLengthHudMidpointHelper7.set(end.x, start.y, end.z)
    const leftCorner = wallLengthHudMidpointHelper8.set(minX === end.x ? maxX : minX, start.y, end.z)
    const rightCorner = wallLengthHudMidpointHelper6.set(end.x, start.y, minZ === end.z ? maxZ : minZ)
    showWallLabels({
      activeWorld: current,
      leftTarget: leftCorner,
      leftText: `Left ${formatWallLengthMeters(distanceXZ(current, leftCorner))}`,
      rightTarget: rightCorner,
      rightText: `Right ${formatWallLengthMeters(distanceXZ(current, rightCorner))}`,
    })
    if (wallLengthHud.visible) {
      return
    }
  }

  if (session.dragStart && session.dragEnd) {
    const len = distanceXZ(session.dragStart, session.dragEnd)
    if (Number.isFinite(len)) {
      showWallSingleLengthLabel(session.dragStart, session.dragEnd, `Length ${formatWallLengthMeters(len)}`, session.dragEnd)
      if (wallLengthHud.visible) {
        return
      }
    }
  }

  const previewEnd = session.polygonPreviewEnd
  const lastPoint = session.polygonPoints[session.polygonPoints.length - 1]
  if (!previewEnd || !lastPoint) {
    return
  }
  const len = distanceXZ(lastPoint, previewEnd)
  if (!Number.isFinite(len) || len <= 1e-6) {
    return
  }
  showWallSingleLengthLabel(lastPoint, previewEnd, `Length ${formatWallLengthMeters(len)}`, previewEnd)
}

const floorSizeHudTmpWorld2 = new THREE.Vector3()
const floorSizeHudTmpWorld3 = new THREE.Vector3()

function updateFloorSizeHudFromFloorDrag() {
  clearFloorSizeHud()

  if (!camera || !overlayContainerRef.value) {
    return
  }

  // Only show while floor tool is active; keeps UX consistent with other gizmo overlays.
  if (activeBuildTool.value !== 'floor') {
    return
  }

  if (floorCircleRadiusDragState && floorCircleRadiusDragState.moved) {
    const state = floorCircleRadiusDragState
    const centerWorld = state.runtimeObject.localToWorld(
      wallLengthHudMidpointHelper5.set(state.centerLocal.x, 0, state.centerLocal.z).clone(),
    )
    let radius = 0
    for (const vertex of getFloorWorldVertices(state.runtimeObject, state.workingDefinition?.vertices ?? [])) {
      radius = Math.max(radius, distanceXZ(centerWorld, vertex))
    }
    const radiusWorld = state.runtimeObject.localToWorld(
      wallLengthHudMidpointHelper6.set(state.centerLocal.x + radius, 0, state.centerLocal.z).clone(),
    )
    tryShowFloorCircleSizeLabel(centerWorld, radiusWorld, radius)
    return
  }

  if (!floorVertexDragState || !floorVertexDragState.moved) {
    return
  }

  const state = floorVertexDragState
  const vertices = Array.isArray(state.workingDefinition?.vertices) ? state.workingDefinition.vertices : []
  if (!vertices.length) {
    return
  }

  const shape = state.floorBuildShape ?? floorBuildShape.value ?? 'polygon'
  if (shape === 'circle') {
    return
  }
  tryShowFloorVertexAdjacentLengths(state.runtimeObject, vertices, state.vertexIndex)
}

function updateFloorSizeHudFromFloorBuild() {
  clearFloorSizeHud()

  if (!camera || !overlayContainerRef.value) {
    return
  }

  if (activeBuildTool.value !== 'floor') {
    return
  }

  const session = floorBuildTool.getSession()
  if (!session || !session.previewEnd || !session.points?.length) {
    return
  }

  if (session.shape === 'rectangle') {
    const start = session.points[0]
    const end = session.previewEnd
    if (!start || !end) return
    const minX = Math.min(start.x, end.x)
    const maxX = Math.max(start.x, end.x)
    const minZ = Math.min(start.z, end.z)
    const maxZ = Math.max(start.z, end.z)
    const current = floorSizeHudTmpWorld3.set(end.x, start.y, end.z)
    const leftCorner = wallLengthHudMidpointHelper7.set(minX === end.x ? maxX : minX, start.y, end.z)
    const rightCorner = wallLengthHudMidpointHelper8.set(end.x, start.y, minZ === end.z ? maxZ : minZ)
    showFloorLabels({
      activeWorld: current,
      leftTarget: leftCorner,
      leftText: `Left ${formatWallLengthMeters(distanceXZ(current, leftCorner))}`,
      rightTarget: rightCorner,
      rightText: `Right ${formatWallLengthMeters(distanceXZ(current, rightCorner))}`,
    })
    return
  }

  if (session.shape === 'circle') {
    const center = session.points[0]
    const end = session.previewEnd
    if (!center || !end) return
    const radius = Math.hypot(end.x - center.x, end.z - center.z)
    if (!Number.isFinite(radius) || radius <= 1e-6) return
    tryShowFloorCircleSizeLabel(
      floorSizeHudTmpWorld2.set(center.x, center.y, center.z),
      floorSizeHudTmpWorld3.set(end.x, end.y, end.z),
      radius,
    )
    return
  }

  if (session.shape === 'polygon') {
    const lastPoint = session.points[session.points.length - 1]
    const previewEnd = session.previewEnd
    if (!lastPoint || !previewEnd) {
      return
    }
    const len = distanceXZ(lastPoint, previewEnd)
    if (!Number.isFinite(len) || len <= 1e-6) {
      return
    }
    showFloorLabels({
      activeWorld: previewEnd,
      leftTarget: lastPoint,
      leftText: `Length ${formatWallLengthMeters(len)}`,
    })
  }
}

function updateDisplayBoardSizeHudFromBuild() {
  clearDisplayBoardSizeHud()

  if (!camera || !overlayContainerRef.value) {
    return
  }

  if (activeBuildTool.value !== 'displayBoard') {
    return
  }

  const session = displayBoardBuildTool.getSession()
  if (!session) {
    return
  }

  const width = Math.max(0, session.width)
  const height = Math.max(0, session.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 1e-6 || height <= 1e-6) {
    return
  }

  const projected = projectWorldToOverlay(session.previewRoot.position)
  if (!projected.visible) {
    return
  }

  displayBoardSizeHud.visible = true
  displayBoardSizeHud.label.visible = true
  displayBoardSizeHud.label.x = projected.x
  displayBoardSizeHud.label.y = projected.y
  displayBoardSizeHud.label.text = `Width ${formatWallLengthMeters(width)}  Height ${formatWallLengthMeters(height)}`
}

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

function shouldApplyViewportCompositionOffset(): boolean {
  return (panelVisibility.value.hierarchy && panelPlacement.value.hierarchy === 'docked')
    || (panelVisibility.value.inspector && panelPlacement.value.inspector === 'docked')
}

function resolveViewportCompositionOffsetPx(out: THREE.Vector2 = viewportCompositionOffsetTargetPx): THREE.Vector2 {
  out.set(0, 0)
  if (typeof window === 'undefined' || !viewportEl.value || !shouldApplyViewportCompositionOffset()) {
    return out
  }

  const rect = viewportEl.value.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    return out
  }

  out.x = window.innerWidth * 0.5 - (rect.left + rect.width * 0.5)
  if (Math.abs(out.x) <= VIEWPORT_COMPOSITION_EPSILON_PX) {
    out.x = 0
  }
  return out
}

function applyViewportCompositionOffset(force = false): void {
  if (!mapControls) {
    viewportCompositionOffsetPx.set(Number.NaN, Number.NaN)
    return
  }

  const desiredOffsetPx = resolveViewportCompositionOffsetPx()
  if (
    !force
    && Number.isFinite(viewportCompositionOffsetPx.x)
    && Number.isFinite(viewportCompositionOffsetPx.y)
    && viewportCompositionOffsetPx.distanceToSquared(desiredOffsetPx) <= VIEWPORT_COMPOSITION_EPSILON_PX * VIEWPORT_COMPOSITION_EPSILON_PX
  ) {
    return
  }

  viewportCompositionOffsetPx.copy(desiredOffsetPx)
  if (Math.abs(desiredOffsetPx.x) <= VIEWPORT_COMPOSITION_EPSILON_PX && Math.abs(desiredOffsetPx.y) <= VIEWPORT_COMPOSITION_EPSILON_PX) {
    mapControls.resetFocalOffset(false)
    return
  }

  mapControls.setFocalOffsetByViewportPixels(desiredOffsetPx.x, desiredOffsetPx.y, false)
}

function scheduleViewportCompositionUpdate(force = false): void {
  viewportCompositionUpdateForce = viewportCompositionUpdateForce || force
  if (viewportCompositionUpdateQueued) {
    return
  }

  viewportCompositionUpdateQueued = true
  void nextTick(() => {
    if (typeof window === 'undefined') {
      viewportCompositionUpdateQueued = false
      const shouldForce = viewportCompositionUpdateForce
      viewportCompositionUpdateForce = false
      applyViewportCompositionOffset(shouldForce)
      return
    }

    if (viewportCompositionUpdateFrame !== null) {
      window.cancelAnimationFrame(viewportCompositionUpdateFrame)
    }
    viewportCompositionUpdateFrame = window.requestAnimationFrame(() => {
      viewportCompositionUpdateFrame = null
      viewportCompositionUpdateQueued = false
      const shouldForce = viewportCompositionUpdateForce
      viewportCompositionUpdateForce = false
      applyViewportCompositionOffset(shouldForce)
    })
  })
}

let pointerTrackingState: PointerTrackingState | null = null
// debugHoverHit removed

type MiddleClickSessionState = {
  pointerId: number
  startX: number
  startY: number
  moved: boolean
  planarPanActive: boolean
}

let middleClickSessionState: MiddleClickSessionState | null = null

type LeftEmptyClickSessionState = {
  pointerId: number
  startX: number
  startY: number
  moved: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  clickHitResult: NodeHitResult | null
  cameraGesture: 'none' | 'planar-pan' | 'orbit-rotate'
}

let leftEmptyClickSessionState: LeftEmptyClickSessionState | null = null

type AssetPlacementClickSessionState = {
  pointerId: number
  startX: number
  startY: number
  moved: boolean
  assetId: string
}

let assetPlacementClickSessionState: AssetPlacementClickSessionState | null = null

type NodePlacementClickSessionState = {
  pointerId: number
  startX: number
  startY: number
  moved: boolean
  itemId: string
}

let nodePlacementClickSessionState: NodePlacementClickSessionState | null = null

type WarpGatePlacementClickSessionState = {
  pointerId: number
  startX: number
  startY: number
  moved: boolean
}

let warpGatePlacementClickSessionState: WarpGatePlacementClickSessionState | null = null

type ShiftOrbitPivotSessionState = {
  pointerId: number
  pivot: THREE.Vector3
  orbitDistance: number
}

let shiftOrbitPivotSessionState: ShiftOrbitPivotSessionState | null = null
const shiftOrbitOffsetHelper = new THREE.Vector3()

let wallDoorRectangleSelectionState: WallDoorRectangleSelectionState | null = null
const wallDoorSelectionPayload = ref<WallDoorSelectionPayload | null>(null)
const wallDoorSelectionOverlayBox = ref<{ left: number; top: number; width: number; height: number } | null>(null)

watch(
  () => wallDoorSelectionPayload.value,
  () => {
    wallDoorSelectionController.rebuildWallDoorSelectionHighlight(wallDoorSelectionPayload.value)
  },
  { flush: 'post' },
)

// wall build session moved into `wallBuildTool`

type RoadSnapVertex = { position: THREE.Vector3; nodeId: string; vertexIndex: number }

// road build session moved into `roadBuildTool`
let roadVertexDragState: RoadVertexDragState | null = null
let floorVertexDragState: FloorVertexDragState | null = null
let floorThicknessDragState: FloorThicknessDragState | null = null
let floorCircleCenterDragState: FloorCircleCenterDragState | null = null
let floorCircleRadiusDragState: FloorCircleRadiusDragState | null = null
let wallEndpointDragState: WallEndpointDragState | null = null
let wallJointDragState: WallJointDragState | null = null
let wallHeightDragState: WallHeightDragState | null = null
let wallCircleCenterDragState: WallCircleCenterDragState | null = null
let wallCircleRadiusDragState: WallCircleRadiusDragState | null = null

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

type DisplayBoardCornerDragState = {
  pointerId: number
  nodeId: string
  cornerIndex: number
  startX: number
  startY: number
  moved: boolean
  runtimeObject: THREE.Object3D
  parentObject: THREE.Object3D
  startPosition: THREE.Vector3
  startScale: THREE.Vector3
  startRotation: THREE.Euler
  dragPlane: THREE.Plane
  draggedSide: { x: 'min' | 'max'; y: 'min' | 'max' }
  startCenterWorld: THREE.Vector3
  axisXWorld: THREE.Vector3
  axisYWorld: THREE.Vector3
  normalWorld: THREE.Vector3
  oppositeCornerWorld: THREE.Vector3
}

let displayBoardCornerDragState: DisplayBoardCornerDragState | null = null

type WaterContourVertexDragState = {
  pointerId: number
  nodeId: string
  vertexIndex: number
  startX: number
  startY: number
  moved: boolean
  dragMode: 'free' | 'axis'
  axisWorld: THREE.Vector3 | null
  dragPlane: THREE.Plane
  startPointWorld: THREE.Vector3
  startHitWorld: THREE.Vector3 | null
  runtimeObject: THREE.Object3D
  basePoints: Array<[number, number]>
  workingPoints: Array<[number, number]>
  rectangleConstraint: WaterRectangleVertexConstraint | null
}

type LandformContourVertexDragState = {
  pointerId: number
  nodeId: string
  vertexIndex: number
  startX: number
  startY: number
  moved: boolean
  dragMode: 'free' | 'axis'
  axisWorld: THREE.Vector3 | null
  dragPlane: THREE.Plane
  startPointWorld: THREE.Vector3
  startHitWorld: THREE.Vector3 | null
  runtimeObject: THREE.Object3D
  basePoints: Array<[number, number]>
  workingPoints: Array<[number, number]>
}

type RegionContourVertexDragState = {
  pointerId: number
  nodeId: string
  vertexIndex: number
  startX: number
  startY: number
  moved: boolean
  dragMode: 'free' | 'axis'
  axisWorld: THREE.Vector3 | null
  dragPlane: THREE.Plane
  startPointWorld: THREE.Vector3
  startHitWorld: THREE.Vector3 | null
  runtimeObject: THREE.Object3D
  basePoints: Array<[number, number]>
  workingPoints: Array<[number, number]>
}

type WaterCircleCenterDragState = {
  pointerId: number
  nodeId: string
  startX: number
  startY: number
  moved: boolean
  dragPlane: THREE.Plane
  startPointWorld: THREE.Vector3
  startHitWorld: THREE.Vector3 | null
  runtimeObject: THREE.Object3D
  basePoints: Array<[number, number]>
  workingPoints: Array<[number, number]>
  startCenterLocal: { x: number; y: number }
  segments: number
}

type WaterCircleRadiusDragState = {
  pointerId: number
  nodeId: string
  startX: number
  startY: number
  moved: boolean
  dragPlane: THREE.Plane
  startPointWorld: THREE.Vector3
  startHitWorld: THREE.Vector3 | null
  runtimeObject: THREE.Object3D
  basePoints: Array<[number, number]>
  workingPoints: Array<[number, number]>
  centerLocal: { x: number; y: number }
  segments: number
}

type WaterEdgeDragState = {
  pointerId: number
  nodeId: string
  edgeIndex: number
  startX: number
  startY: number
  moved: boolean
  runtimeObject: THREE.Object3D
  startPoints: Array<[number, number]>
  workingPoints: Array<[number, number]>
  perp: THREE.Vector2
  referencePoint: THREE.Vector2
  initialProjection: number
  rectangleConstraint: WaterRectangleEdgeConstraint | null
}

type WaterRectangleBounds = {
  uMin: number
  uMax: number
  vMin: number
  vMax: number
}

type WaterRectangleCornerSide = {
  u: 'min' | 'max'
  v: 'min' | 'max'
}

type WaterRectangleFrame = {
  originLocal: THREE.Vector2
  axisULocal: THREE.Vector2
  axisVLocal: THREE.Vector2
  boundsStart: WaterRectangleBounds
  cornerSides: [
    WaterRectangleCornerSide,
    WaterRectangleCornerSide,
    WaterRectangleCornerSide,
    WaterRectangleCornerSide,
  ]
}

type WaterRectangleVertexConstraint = WaterRectangleFrame & {
  draggedSide: WaterRectangleCornerSide
}

type WaterRectangleEdgeConstraint = WaterRectangleFrame & {
  draggedAxis: 'u' | 'v'
  draggedSide: 'min' | 'max'
}

let waterContourVertexDragState: WaterContourVertexDragState | null = null
let landformContourVertexDragState: LandformContourVertexDragState | null = null
let regionContourVertexDragState: RegionContourVertexDragState | null = null
let waterCircleCenterDragState: WaterCircleCenterDragState | null = null
let waterCircleRadiusDragState: WaterCircleRadiusDragState | null = null
let waterEdgeDragState: WaterEdgeDragState | null = null

const roadVertexRenderer = createRoadVertexRenderer()
const wallEndpointRenderer = createWallEndpointRenderer()
const floorVertexRenderer = createFloorVertexRenderer()
const landformVertexRenderer = createLandformVertexRenderer()
const regionVertexRenderer = createRegionVertexRenderer()
const floorCircleHandleRenderer = createFloorCircleHandleRenderer()
const displayBoardCornerHandleRenderer = createDisplayBoardCornerHandleRenderer()
const waterVertexRenderer = createWaterVertexRenderer()
const waterCircleHandleRenderer = createWaterCircleHandleRenderer()
const waterDragIntersectionHelper = new THREE.Vector3()
const waterDragWorldHelper = new THREE.Vector3()

function isSelectedFloorCircleEditMode(): boolean {
  if (!isSelectedFloorEditMode()) {
    return false
  }
  const selectedId = getPrimarySelectedNodeId()
  if (!selectedId) {
    return false
  }
  const node = findSceneNode(sceneStore.nodes, selectedId)
  if (!node || node.dynamicMesh?.type !== 'Floor') {
    return false
  }
  return readFloorBuildShapeFromNode(node) === 'circle'
}

function isSelectedWaterCircleEditMode(): boolean {
  if (!isSelectedWaterEditMode()) {
    return false
  }
  const selectedId = getPrimarySelectedNodeId()
  if (!selectedId) {
    return false
  }
  const node = findSceneNode(sceneStore.nodes, selectedId)
  return isWaterSurfaceNode(node) && readWaterBuildShapeFromNode(node) === 'circle'
}

function isSelectedWaterContourEditMode(): boolean {
  if (!isSelectedWaterEditMode()) {
    return false
  }
  const selectedId = getPrimarySelectedNodeId()
  if (!selectedId) {
    return false
  }
  const node = findSceneNode(sceneStore.nodes, selectedId)
  const buildShape = readWaterBuildShapeFromNode(node)
  return isWaterSurfaceNode(node) && (buildShape === 'polygon' || (buildShape === 'rectangle' && node?.nodeType === 'Mesh'))
}

function isDisplayBoardNode(node: SceneNode | null | undefined): boolean {
  if (!node || node.nodeType !== 'Plane') {
    return false
  }
  if (node.components?.[DISPLAY_BOARD_COMPONENT_TYPE]) {
    return true
  }
  return node.userData?.displayBoard === true || node.userData?.isDisplayBoard === true
}

function isSelectedDisplayBoardEditMode(): boolean {
  const selectedId = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
  if (!selectedId) {
    return false
  }
  return isDisplayBoardNode(findSceneNode(sceneStore.nodes, selectedId))
}

function ensureRoadVertexHandlesForSelectedNode(options?: { force?: boolean }) {
  const selectedId = isSelectedRoadEditMode() ? getPrimarySelectedNodeId() : null
  const active = activeBuildTool.value === 'road' && isSelectedRoadEditMode() && !roadBuildTool.getSession()
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

function setActiveRoadVertexHandle(active: { nodeId: string; vertexIndex: number; gizmoPart: any } | null) {
  roadVertexRenderer.setActiveHandle(active as any)
}

function ensureWallEndpointHandlesForSelectedNode(options?: { force?: boolean }) {
  const selectedId = isSelectedWallEditMode() ? getPrimarySelectedNodeId() : null
  const active = activeBuildTool.value === 'wall' && isSelectedWallEditMode() && !wallBuildTool.getSession()
  const common = {
    active,
    selectedNodeId: selectedId,
    isSelectionLocked: (nodeId: string) => sceneStore.isNodeSelectionLocked(nodeId),
    resolveWallDefinition: (nodeId: string) => {
      const node = findSceneNode(sceneStore.nodes, nodeId)
      return node?.dynamicMesh?.type === 'Wall' ? (node.dynamicMesh as WallDynamicMesh) : null
    },
    resolveWallBuildShape: (nodeId: string) => {
      const node = findSceneNode(sceneStore.nodes, nodeId)
      return readWallBuildShapeFromNode(node)
    },
    resolveRuntimeObject: (nodeId: string) => objectMap.get(nodeId) ?? null,
  }
  if (options?.force) {
    wallEndpointRenderer.forceRebuild(common)
  } else {
    wallEndpointRenderer.ensure(common)
  }
}

function pickWallEndpointHandleAtPointer(event: PointerEvent): WallEndpointHandlePickResult | null {
  return wallEndpointRenderer.pick({
    camera,
    canvas: canvasRef.value,
    event,
    pointer,
    raycaster,
  })
}

function setActiveWallEndpointHandle(active: any | null) {
  wallEndpointRenderer.setActiveHandle(active)
}

function ensureDisplayBoardCornerHandlesForSelectedNode(options?: { force?: boolean }) {
  const selectedId = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
  const active = activeBuildTool.value === 'displayBoard' && isSelectedDisplayBoardEditMode() && !displayBoardBuildTool.getSession()
  const common = {
    active,
    selectedNodeId: selectedId,
    isSelectionLocked: (nodeId: string) => sceneStore.isNodeSelectionLocked(nodeId),
    resolveDisplayBoardNode: (nodeId: string) => isDisplayBoardNode(findSceneNode(sceneStore.nodes, nodeId)),
    resolveRuntimeObject: (nodeId: string) => objectMap.get(nodeId) ?? null,
  }
  if (options?.force) {
    displayBoardCornerHandleRenderer.forceRebuild(common)
  } else {
    displayBoardCornerHandleRenderer.ensure(common)
  }
}

function pickDisplayBoardCornerHandleAtPointer(event: PointerEvent): DisplayBoardCornerHandlePickResult | null {
  return displayBoardCornerHandleRenderer.pick({
    camera,
    canvas: canvasRef.value,
    event,
    pointer,
    raycaster,
  })
}

function setActiveDisplayBoardCornerHandle(active: { nodeId: string; cornerIndex: number; gizmoPart: any } | null) {
  displayBoardCornerHandleRenderer.setActiveHandle(active as any)
}

function ensureWaterVertexHandlesForSelectedNode(options?: { force?: boolean; previewPoints?: Array<[number, number]> }) {
  if (isSelectedWaterCircleEditMode()) {
    waterVertexRenderer.clear()
    return
  }
  const selectedId = isSelectedWaterEditMode() ? getPrimarySelectedNodeId() : null
  const active = activeBuildTool.value === 'water' && isSelectedWaterEditMode() && !waterBuildTool.getSession()
  const common = {
    active,
    selectedNodeId: selectedId,
    isSelectionLocked: (nodeId: string) => sceneStore.isNodeSelectionLocked(nodeId),
    resolveWaterNode: (nodeId: string) => findSceneNode(sceneStore.nodes, nodeId),
    resolveRuntimeObject: (nodeId: string) => objectMap.get(nodeId) ?? null,
    previewPoints: options?.previewPoints,
  }
  if (options?.force) {
    waterVertexRenderer.forceRebuild(common)
  } else {
    waterVertexRenderer.ensure(common)
  }
}

function ensureWaterCircleHandlesForSelectedNode(options?: { force?: boolean }) {
  const selectedId = isSelectedWaterEditMode() ? getPrimarySelectedNodeId() : null
  const active = activeBuildTool.value === 'water' && isSelectedWaterEditMode() && !waterBuildTool.getSession()
  const circleSelectedId = isSelectedWaterCircleEditMode() ? selectedId : null
  const common = {
    active,
    selectedNodeId: circleSelectedId,
    isSelectionLocked: (nodeId: string) => sceneStore.isNodeSelectionLocked(nodeId),
    resolveWaterNode: (nodeId: string) => findSceneNode(sceneStore.nodes, nodeId),
    resolveRuntimeObject: (nodeId: string) => objectMap.get(nodeId) ?? null,
  }
  if (options?.force) {
    waterCircleHandleRenderer.forceRebuild(common)
  } else {
    waterCircleHandleRenderer.ensure(common)
  }
}

function pickWaterVertexHandleAtPointer(event: PointerEvent): WaterVertexHandlePickResult | null {
  return waterVertexRenderer.pick({
    camera,
    canvas: canvasRef.value,
    event,
    pointer,
    raycaster,
  })
}

function pickWaterCircleHandleAtPointer(event: PointerEvent): WaterCircleHandlePickResult | null {
  return waterCircleHandleRenderer.pick({
    camera,
    canvas: canvasRef.value,
    event,
    pointer,
    raycaster,
  })
}

function setActiveWaterVertexHandle(active: { nodeId: string; vertexIndex: number; gizmoPart: any } | null) {
  waterVertexRenderer.setActiveHandle(active as any)
}

function setActiveWaterCircleHandle(active: { nodeId: string; circleKind: 'center' | 'radius'; gizmoPart: any } | null) {
  waterCircleHandleRenderer.setActiveHandle(active as any)
}

const displayBoardDragAxisHelper = new THREE.Vector3()
const displayBoardDragAxisHelper2 = new THREE.Vector3()
const displayBoardDragCenterHelper = new THREE.Vector3()
const displayBoardDragPointerHelper = new THREE.Vector3()
const displayBoardDragLocalCenterHelper = new THREE.Vector3()
const displayBoardDragQuaternionHelper = new THREE.Quaternion()

function createDisplayBoardDragPlane(runtimeObject: THREE.Object3D): THREE.Plane {
  runtimeObject.updateMatrixWorld(true)
  const normal = displayBoardDragAxisHelper.set(0, 0, 1)
  normal.applyQuaternion(runtimeObject.getWorldQuaternion(displayBoardDragQuaternionHelper)).normalize()
  const origin = runtimeObject.getWorldPosition(displayBoardDragCenterHelper)
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin)
}

function applyDisplayBoardPreviewTransform(
  runtimeObject: THREE.Object3D,
  parentObject: THREE.Object3D,
  centerWorld: THREE.Vector3,
  width: number,
  height: number,
) {
  parentObject.updateMatrixWorld(true)
  runtimeObject.position.copy(parentObject.worldToLocal(displayBoardDragLocalCenterHelper.copy(centerWorld)))
  runtimeObject.scale.set(Math.max(1e-3, width), Math.max(1e-3, height), Math.max(1e-3, runtimeObject.scale.z || 1))
  runtimeObject.updateMatrixWorld(true)
}

function restoreDisplayBoardPreviewTransform(state: DisplayBoardCornerDragState) {
  state.runtimeObject.position.copy(state.startPosition)
  state.runtimeObject.rotation.copy(state.startRotation)
  state.runtimeObject.scale.copy(state.startScale)
  state.runtimeObject.updateMatrixWorld(true)
}

function tryBeginDisplayBoardCornerDrag(event: PointerEvent): boolean {
  if (displayBoardCornerDragState) {
    return false
  }
  const selectedId = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
  if (!selectedId || sceneStore.isNodeSelectionLocked(selectedId)) {
    return false
  }
  const node = findSceneNode(sceneStore.nodes, selectedId)
  const runtime = objectMap.get(selectedId) ?? null
  const parentObject = runtime?.parent ?? null
  if (!isDisplayBoardNode(node) || !runtime || !parentObject) {
    return false
  }
  const hit = pickDisplayBoardCornerHandleAtPointer(event)
  if (!hit || hit.nodeId !== selectedId) {
    return false
  }

  runtime.updateMatrixWorld(true)
  const centerWorld = runtime.getWorldPosition(new THREE.Vector3())
  const axisXWorld = runtime.localToWorld(displayBoardDragAxisHelper.set(1, 0, 0)).sub(centerWorld).normalize()
  const axisYWorld = runtime.localToWorld(displayBoardDragAxisHelper2.set(0, 1, 0)).sub(centerWorld).normalize()
  const normalWorld = runtime.localToWorld(new THREE.Vector3(0, 0, 1)).sub(centerWorld).normalize()
  const halfWidth = Math.abs(runtime.scale.x) * 0.5
  const halfHeight = Math.abs(runtime.scale.y) * 0.5
  const signX = hit.xSide === 'max' ? 1 : -1
  const signY = hit.ySide === 'max' ? 1 : -1
  const oppositeCornerWorld = centerWorld.clone()
    .addScaledVector(axisXWorld, -signX * halfWidth)
    .addScaledVector(axisYWorld, -signY * halfHeight)

  displayBoardCornerDragState = {
    pointerId: event.pointerId,
    nodeId: selectedId,
    cornerIndex: hit.cornerIndex,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    runtimeObject: runtime,
    parentObject,
    startPosition: runtime.position.clone(),
    startScale: runtime.scale.clone(),
    startRotation: runtime.rotation.clone(),
    dragPlane: createDisplayBoardDragPlane(runtime),
    draggedSide: { x: hit.xSide, y: hit.ySide },
    startCenterWorld: centerWorld.clone(),
    axisXWorld: axisXWorld.clone(),
    axisYWorld: axisYWorld.clone(),
    normalWorld: normalWorld.clone(),
    oppositeCornerWorld,
  }
  setActiveDisplayBoardCornerHandle({ nodeId: selectedId, cornerIndex: hit.cornerIndex, gizmoPart: hit.gizmoPart })
  pointerInteraction.capture(event.pointerId)
  return true
}

function cloneWaterContourPoints(node: SceneNode | null | undefined): Array<[number, number]> {
  return getWaterContourLocalPoints(node).map(([x, y]) => [x, y] as [number, number])
}

function sideOfWaterRectangle(value: number, min: number, max: number, eps = 1e-4): 'min' | 'max' {
  const dMin = Math.abs(value - min)
  const dMax = Math.abs(value - max)
  if (dMin <= eps && dMax <= eps) {
    return 'min'
  }
  if (dMin <= eps) {
    return 'min'
  }
  if (dMax <= eps) {
    return 'max'
  }
  return dMin <= dMax ? 'min' : 'max'
}

function createWaterRectangleFrame(points: Array<[number, number]>): WaterRectangleFrame | null {
  if (points.length !== 4) {
    return null
  }

  const corners = points.map(([x, y]) => new THREE.Vector2(x, y)) as [THREE.Vector2, THREE.Vector2, THREE.Vector2, THREE.Vector2]
  const originLocal = corners[0].clone()
  const edgeU = corners[1].clone().sub(originLocal)
  const edgeV = corners[3].clone().sub(originLocal)
  const lenU = edgeU.length()
  const lenV = edgeV.length()
  if (lenU <= 1e-4 || lenV <= 1e-4) {
    return null
  }

  const axisULocal = edgeU.clone().multiplyScalar(1 / lenU)
  const axisVLocal = edgeV.clone().multiplyScalar(1 / lenV)
  if (Math.abs(axisULocal.dot(axisVLocal)) > 1e-3) {
    return null
  }

  const expectedCorner2 = originLocal.clone()
    .add(axisULocal.clone().multiplyScalar(lenU))
    .add(axisVLocal.clone().multiplyScalar(lenV))
  if (expectedCorner2.distanceToSquared(corners[2]) > 1e-6) {
    return null
  }

  const boundsStart: WaterRectangleBounds = {
    uMin: 0,
    uMax: lenU,
    vMin: 0,
    vMax: lenV,
  }

  const cornerSides = corners.map((corner) => {
    const rel = corner.clone().sub(originLocal)
    const u = rel.dot(axisULocal)
    const v = rel.dot(axisVLocal)
    return {
      u: sideOfWaterRectangle(u, boundsStart.uMin, boundsStart.uMax),
      v: sideOfWaterRectangle(v, boundsStart.vMin, boundsStart.vMax),
    }
  }) as WaterRectangleFrame['cornerSides']

  return {
    originLocal,
    axisULocal,
    axisVLocal,
    boundsStart,
    cornerSides,
  }
}

function buildWaterRectanglePointsFromBounds(
  frame: Pick<WaterRectangleFrame, 'originLocal' | 'axisULocal' | 'axisVLocal' | 'cornerSides'>,
  bounds: WaterRectangleBounds,
): Array<[number, number]> {
  return frame.cornerSides.map((side) => {
    const point = frame.originLocal.clone()
      .add(frame.axisULocal.clone().multiplyScalar(side.u === 'min' ? bounds.uMin : bounds.uMax))
      .add(frame.axisVLocal.clone().multiplyScalar(side.v === 'min' ? bounds.vMin : bounds.vMax))
    return [point.x, point.y] as [number, number]
  })
}

function createWaterRectangleVertexConstraint(
  points: Array<[number, number]>,
  vertexIndex: number,
): WaterRectangleVertexConstraint | null {
  const frame = createWaterRectangleFrame(points)
  const draggedSide = frame?.cornerSides?.[vertexIndex]
  if (!frame || !draggedSide) {
    return null
  }

  return {
    ...frame,
    draggedSide: { ...draggedSide },
  }
}

function applyWaterRectangleVertexConstraint(
  constraint: WaterRectangleVertexConstraint,
  localPoint: THREE.Vector2,
): Array<[number, number]> {
  const rel = localPoint.clone().sub(constraint.originLocal)
  const projectedU = rel.dot(constraint.axisULocal)
  const projectedV = rel.dot(constraint.axisVLocal)
  const eps = 1e-4
  let uMin = constraint.boundsStart.uMin
  let uMax = constraint.boundsStart.uMax
  let vMin = constraint.boundsStart.vMin
  let vMax = constraint.boundsStart.vMax

  if (constraint.draggedSide.u === 'min') {
    uMin = Math.min(projectedU, uMax - eps)
  } else {
    uMax = Math.max(projectedU, uMin + eps)
  }

  if (constraint.draggedSide.v === 'min') {
    vMin = Math.min(projectedV, vMax - eps)
  } else {
    vMax = Math.max(projectedV, vMin + eps)
  }

  return buildWaterRectanglePointsFromBounds(constraint, { uMin, uMax, vMin, vMax })
}

function createWaterRectangleEdgeConstraint(
  points: Array<[number, number]>,
  edgeIndex: number,
): WaterRectangleEdgeConstraint | null {
  const frame = createWaterRectangleFrame(points)
  if (!frame) {
    return null
  }

  const startSide = frame.cornerSides[edgeIndex]
  const endSide = frame.cornerSides[(edgeIndex + 1) % frame.cornerSides.length]
  if (!startSide || !endSide) {
    return null
  }

  if (startSide.u === endSide.u && startSide.v !== endSide.v) {
    return {
      ...frame,
      draggedAxis: 'u',
      draggedSide: startSide.u,
    }
  }

  if (startSide.v === endSide.v && startSide.u !== endSide.u) {
    return {
      ...frame,
      draggedAxis: 'v',
      draggedSide: startSide.v,
    }
  }

  return null
}

function applyWaterRectangleEdgeConstraint(
  constraint: WaterRectangleEdgeConstraint,
  localPoint: THREE.Vector2,
): Array<[number, number]> {
  const rel = localPoint.clone().sub(constraint.originLocal)
  const projectedU = rel.dot(constraint.axisULocal)
  const projectedV = rel.dot(constraint.axisVLocal)
  const eps = 1e-4
  let uMin = constraint.boundsStart.uMin
  let uMax = constraint.boundsStart.uMax
  let vMin = constraint.boundsStart.vMin
  let vMax = constraint.boundsStart.vMax

  if (constraint.draggedAxis === 'u') {
    if (constraint.draggedSide === 'min') {
      uMin = Math.min(projectedU, uMax - eps)
    } else {
      uMax = Math.max(projectedU, uMin + eps)
    }
  } else if (constraint.draggedSide === 'min') {
    vMin = Math.min(projectedV, vMax - eps)
  } else {
    vMax = Math.max(projectedV, vMin + eps)
  }

  return buildWaterRectanglePointsFromBounds(constraint, { uMin, uMax, vMin, vMax })
}

function buildWaterPreviewFromLocalPoints(runtimeObject: THREE.Object3D, points: Array<[number, number]>): boolean {
  const metadata = buildWaterSurfaceMetadataFromLocalPoints(points)
  if (!metadata) {
    return false
  }
  return updateWaterSurfaceRuntimeMesh(runtimeObject, metadata)
}

function resolveWaterContourBuildShape(nodeId: string): WaterBuildShape {
  const node = findSceneNode(sceneStore.nodes, nodeId)
  const buildShape = readWaterBuildShapeFromNode(node)
  if (buildShape === 'circle') {
    return 'circle'
  }
  if (buildShape === 'rectangle') {
    return 'rectangle'
  }
  return 'polygon'
}

function commitWaterContourNode(nodeId: string, points: Array<[number, number]>, buildShape: WaterBuildShape): boolean {
  const updated = sceneStore.updateWaterSurfaceMeshNode({
    nodeId,
    localPoints: points,
    buildShape,
  })
  return Boolean(updated)
}

type WaterEdgeHit = {
  edgeIndex: number
  perp: THREE.Vector2
  referencePoint: THREE.Vector2
  initialProjection: number
}

const WATER_EDGE_PICK_DISTANCE = 0.3

function pickWaterContourEdgeAtPointer(event: PointerEvent, node: SceneNode, runtimeObject: THREE.Object3D): WaterEdgeHit | null {
  const points = cloneWaterContourPoints(node)
  if (points.length < 2 || !raycastGroundPoint(event, groundPointerHelper)) {
    return null
  }

  const worldVertices = points.map(([x, y]) => {
    const world = runtimeObject.localToWorld(new THREE.Vector3(x, y, 0))
    return { x: world.x, y: world.z }
  })
  return pickNearestPlanarEdge({
    pointer: new THREE.Vector2(groundPointerHelper.x, groundPointerHelper.z),
    vertices: worldVertices,
    maxDistance: WATER_EDGE_PICK_DISTANCE,
  })
}

function tryBeginWaterVertexDrag(event: PointerEvent): boolean {
  if (waterContourVertexDragState) {
    return false
  }
  if (!isSelectedWaterEditMode() || waterBuildTool.getSession()) {
    return false
  }
  const selectedId = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
  if (!selectedId || sceneStore.isNodeSelectionLocked(selectedId)) {
    return false
  }
  const node = findSceneNode(sceneStore.nodes, selectedId)
  const runtime = objectMap.get(selectedId) ?? null
  if (!node || !runtime || !isSelectedWaterContourEditMode()) {
    return false
  }

  ensureWaterVertexHandlesForSelectedNode()
  const hit = pickWaterVertexHandleAtPointer(event)
  if (!hit || hit.nodeId !== selectedId) {
    return false
  }

  const basePoints = cloneWaterContourPoints(node)
  const startPoint = basePoints[hit.vertexIndex]
  if (!startPoint) {
    return false
  }

  const startPointWorld = runtime.localToWorld(new THREE.Vector3(startPoint[0], startPoint[1], 0))
  const worldQuaternion = runtime.getWorldQuaternion(new THREE.Quaternion())
  const rawAxisWorld = hit.gizmoKind === 'axis' && hit.gizmoAxis
    ? hit.gizmoAxis.clone().applyQuaternion(worldQuaternion)
    : null
  const axisWorld = rawAxisWorld
    ? new THREE.Vector3(rawAxisWorld.x, 0, rawAxisWorld.z).normalize()
    : null
  const dragMode = axisWorld && axisWorld.lengthSq() > 1e-10 ? 'axis' : 'free'

  waterContourVertexDragState = {
    pointerId: event.pointerId,
    nodeId: selectedId,
    vertexIndex: hit.vertexIndex,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    dragMode,
    axisWorld: dragMode === 'axis' ? axisWorld : null,
    dragPlane: createEndpointDragPlane({
      mode: dragMode,
      axisWorld: dragMode === 'axis' ? axisWorld : null,
      startPointWorld,
      freePlaneNormal: new THREE.Vector3(0, 1, 0),
    }),
    startPointWorld: startPointWorld.clone(),
    startHitWorld: null,
    runtimeObject: runtime,
    basePoints,
    workingPoints: basePoints.map(([x, y]) => [x, y] as [number, number]),
    rectangleConstraint: resolveWaterContourBuildShape(selectedId) === 'rectangle'
      ? createWaterRectangleVertexConstraint(basePoints, hit.vertexIndex)
      : null,
  }
  setActiveWaterVertexHandle({ nodeId: selectedId, vertexIndex: hit.vertexIndex, gizmoPart: hit.gizmoPart })
  pointerInteraction.capture(event.pointerId)
  return true
}

function tryBeginWaterCircleDrag(event: PointerEvent): boolean {
  if (waterCircleCenterDragState || waterCircleRadiusDragState) {
    return false
  }
  if (!isSelectedWaterEditMode() || waterBuildTool.getSession()) {
    return false
  }
  const selectedId = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
  if (!selectedId || sceneStore.isNodeSelectionLocked(selectedId)) {
    return false
  }
  const node = findSceneNode(sceneStore.nodes, selectedId)
  const runtime = objectMap.get(selectedId) ?? null
  if (!node || !runtime || !isSelectedWaterCircleEditMode()) {
    return false
  }

  ensureWaterCircleHandlesForSelectedNode()
  const hit = pickWaterCircleHandleAtPointer(event)
  if (!hit || hit.nodeId !== selectedId) {
    return false
  }

  const basePoints = cloneWaterContourPoints(node)
  const circle = computeWaterCircleLocalFromPoints(basePoints)
  if (!circle) {
    return false
  }

  const startPointWorld = hit.circleKind === 'radius'
    ? runtime.localToWorld(new THREE.Vector3(circle.centerX + circle.radius, circle.centerY, 0))
    : runtime.localToWorld(new THREE.Vector3(circle.centerX, circle.centerY, 0))

  const dragPlane = createEndpointDragPlane({
    mode: 'free',
    axisWorld: null,
    startPointWorld,
    freePlaneNormal: new THREE.Vector3(0, 1, 0),
  })

  setActiveWaterCircleHandle({ nodeId: selectedId, circleKind: hit.circleKind, gizmoPart: hit.gizmoPart })

  if (hit.circleKind === 'center') {
    waterCircleCenterDragState = {
      pointerId: event.pointerId,
      nodeId: selectedId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      dragPlane,
      startPointWorld: startPointWorld.clone(),
      startHitWorld: null,
      runtimeObject: runtime,
      basePoints,
      workingPoints: basePoints.map(([x, y]) => [x, y] as [number, number]),
      startCenterLocal: { x: circle.centerX, y: circle.centerY },
      segments: Math.max(3, circle.segments),
    }
  } else {
    waterCircleRadiusDragState = {
      pointerId: event.pointerId,
      nodeId: selectedId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      dragPlane,
      startPointWorld: startPointWorld.clone(),
      startHitWorld: null,
      runtimeObject: runtime,
      basePoints,
      workingPoints: basePoints.map(([x, y]) => [x, y] as [number, number]),
      centerLocal: { x: circle.centerX, y: circle.centerY },
      segments: Math.max(3, circle.segments),
    }
  }

  pointerInteraction.capture(event.pointerId)
  return true
}

function tryBeginWaterEdgeDrag(event: PointerEvent): boolean {
  if (waterEdgeDragState) {
    return false
  }
  if (!isSelectedWaterEditMode() || waterBuildTool.getSession()) {
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

  if (isSelectedWaterContourEditMode()) {
    const hit = pickWaterContourEdgeAtPointer(event, node, runtime)
    if (!hit) {
      return false
    }
    const startPoints = cloneWaterContourPoints(node)
    waterEdgeDragState = {
      pointerId: event.pointerId,
      nodeId: selectedId,
      edgeIndex: hit.edgeIndex,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      runtimeObject: runtime,
      startPoints,
      workingPoints: startPoints.map(([x, y]) => [x, y] as [number, number]),
      perp: hit.perp.clone(),
      referencePoint: hit.referencePoint.clone(),
      initialProjection: hit.initialProjection,
      rectangleConstraint: resolveWaterContourBuildShape(selectedId) === 'rectangle'
        ? createWaterRectangleEdgeConstraint(startPoints, hit.edgeIndex)
        : null,
    }
    pointerInteraction.capture(event.pointerId)
    return true
  }

  return false
}

function ensureFloorVertexHandlesForSelectedNode(options?: { force?: boolean }) {
  if (isSelectedFloorCircleEditMode()) {
    floorVertexRenderer.clear()
    return
  }
  const selectedId = isSelectedFloorEditMode() ? getPrimarySelectedNodeId() : null
  const active = activeBuildTool.value === 'floor' && isSelectedFloorEditMode() && !floorBuildTool.getSession()
  const common = {
    active,
    selectedNodeId: selectedId,
    isSelectionLocked: (nodeId: string) => sceneStore.isNodeSelectionLocked(nodeId),
    resolveFloorDefinition: (nodeId: string) => {
      const node = findSceneNode(sceneStore.nodes, nodeId)
      return node?.dynamicMesh?.type === 'Floor' ? (node.dynamicMesh as FloorDynamicMesh) : null
    },
    resolveRuntimeObject: (nodeId: string) => objectMap.get(nodeId) ?? null,
  }
  if (options?.force) {
    floorVertexRenderer.forceRebuild(common)
  } else {
    floorVertexRenderer.ensure(common)
  }
}

function ensureFloorCircleHandlesForSelectedNode(options?: { force?: boolean }) {
  const selectedId = isSelectedFloorEditMode() ? getPrimarySelectedNodeId() : null
  const active = activeBuildTool.value === 'floor' && isSelectedFloorEditMode() && !floorBuildTool.getSession()
  const circleSelectedId = isSelectedFloorCircleEditMode() ? selectedId : null

  const common = {
    active,
    selectedNodeId: circleSelectedId,
    isSelectionLocked: (nodeId: string) => sceneStore.isNodeSelectionLocked(nodeId),
    resolveFloorDefinition: (nodeId: string) => {
      const node = findSceneNode(sceneStore.nodes, nodeId)
      return node?.dynamicMesh?.type === 'Floor' ? (node.dynamicMesh as FloorDynamicMesh) : null
    },
    resolveRuntimeObject: (nodeId: string) => objectMap.get(nodeId) ?? null,
  }

  if (options?.force) {
    floorCircleHandleRenderer.forceRebuild(common)
  } else {
    floorCircleHandleRenderer.ensure(common)
  }
}

function pickFloorVertexHandleAtPointer(event: PointerEvent) {
  return floorVertexRenderer.pick({
    camera,
    canvas: canvasRef.value,
    event,
    pointer,
    raycaster,
  })
}

function pickFloorCircleHandleAtPointer(event: PointerEvent): FloorCircleHandlePickResult | null {
  return floorCircleHandleRenderer.pick({
    camera,
    canvas: canvasRef.value,
    event,
    pointer,
    raycaster,
  })
}

function setActiveFloorVertexHandle(active: { nodeId: string; vertexIndex: number; gizmoPart: any } | null) {
  floorVertexRenderer.setActiveHandle(active as any)
}

function setActiveFloorCircleHandle(active: { nodeId: string; circleKind: 'center' | 'radius'; gizmoPart: any } | null) {
  floorCircleHandleRenderer.setActiveHandle(active as any)
}

function ensureLandformVertexHandlesForSelectedNode(options?: { force?: boolean; previewPoints?: Array<[number, number]> }) {
  const selectedId = isSelectedLandformEditMode() ? getPrimarySelectedNodeId() : null
  const active = activeBuildTool.value === 'landform' && isSelectedLandformEditMode() && !landformBuildTool.getSession()
  const common = {
    active,
    selectedNodeId: selectedId,
    isSelectionLocked: (nodeId: string) => sceneStore.isNodeSelectionLocked(nodeId),
    resolveLandformDefinition: (nodeId: string) => {
      const node = findSceneNode(sceneStore.nodes, nodeId)
      return node?.dynamicMesh?.type === 'Landform' ? (node.dynamicMesh as LandformDynamicMesh) : null
    },
    resolveRuntimeObject: (nodeId: string) => objectMap.get(nodeId) ?? null,
    previewPoints: options?.previewPoints,
  }
  if (options?.force) {
    landformVertexRenderer.forceRebuild(common)
  } else {
    landformVertexRenderer.ensure(common)
  }
}

function ensureRegionVertexHandlesForSelectedNode(options?: { force?: boolean; previewPoints?: Array<[number, number]> }) {
  const selectedId = isSelectedRegionEditMode() ? getPrimarySelectedNodeId() : null
  const active = activeBuildTool.value === 'region' && isSelectedRegionEditMode() && !regionBuildTool.getSession()
  const common = {
    active,
    selectedNodeId: selectedId,
    isSelectionLocked: (nodeId: string) => sceneStore.isNodeSelectionLocked(nodeId),
    resolveRegionDefinition: (nodeId: string) => {
      const node = findSceneNode(sceneStore.nodes, nodeId)
      return node?.dynamicMesh?.type === 'Region' ? (node.dynamicMesh as RegionDynamicMesh) : null
    },
    resolveRuntimeObject: (nodeId: string) => objectMap.get(nodeId) ?? null,
    previewPoints: options?.previewPoints,
  }
  if (options?.force) {
    regionVertexRenderer.forceRebuild(common)
  } else {
    regionVertexRenderer.ensure(common)
  }
}

function pickRegionVertexHandleAtPointer(event: PointerEvent): RegionVertexHandlePickResult | null {
  return regionVertexRenderer.pick({
    camera,
    canvas: canvasRef.value,
    event,
    pointer,
    raycaster,
  })
}

function setActiveRegionVertexHandle(active: { nodeId: string; vertexIndex: number; gizmoPart: any } | null) {
  regionVertexRenderer.setActiveHandle(active as any)
}

function pickLandformVertexHandleAtPointer(event: PointerEvent): LandformVertexHandlePickResult | null {
  return landformVertexRenderer.pick({
    camera,
    canvas: canvasRef.value,
    event,
    pointer,
    raycaster,
  })
}

function setActiveLandformVertexHandle(active: { nodeId: string; vertexIndex: number; gizmoPart: any } | null) {
  landformVertexRenderer.setActiveHandle(active as any)
}

function cloneLandformFootprintPoints(node: SceneNode | null | undefined): Array<[number, number]> {
  if (!node || node.dynamicMesh?.type !== 'Landform') {
    return []
  }
  const footprint = Array.isArray(node.dynamicMesh.footprint) ? node.dynamicMesh.footprint : []
  return footprint
    .map((entry) => [Number(entry?.[0]), Number(entry?.[1])] as [number, number])
    .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z))
}

function cloneRegionLocalPoints(node: SceneNode | null | undefined): Array<[number, number]> {
  if (!node || node.dynamicMesh?.type !== 'Region') {
    return []
  }
  const vertices = Array.isArray(node.dynamicMesh.vertices) ? node.dynamicMesh.vertices : []
  return vertices
    .map((entry) => [Number(entry?.[0]), Number(entry?.[1])] as [number, number])
    .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z))
}

function resolveRegionEditorRuntimeObject(nodeId: string): THREE.Group | null {
  const container = objectMap.get(nodeId) ?? null
  const regionGroup = container?.userData?.regionGroup as THREE.Group | undefined
  return regionGroup?.isGroup ? regionGroup : null
}

function buildRegionPreviewFromLocalPoints(nodeId: string, points: Array<[number, number]>): boolean {
  const regionGroup = resolveRegionEditorRuntimeObject(nodeId)
  const definition = buildRegionDynamicMeshFromLocalVertices(points)
  if (!regionGroup || !definition) {
    return false
  }
  updateRegionEditorGroup(regionGroup, definition)
  regionGroup.userData[DYNAMIC_MESH_SIGNATURE_KEY] = computeRegionDynamicMeshSignature(definition)
  return true
}

function commitRegionContourNode(nodeId: string, points: Array<[number, number]>): boolean {
  if (points.length < 3) {
    return false
  }
  const updated = sceneStore.updateRegionNode({
    nodeId,
    localPoints: points.map(([x, z]) => [x, z] as [number, number]),
  })
  return Boolean(updated)
}

function buildLandformPreviewFromLocalPoints(
  nodeId: string,
  points: Array<[number, number]>,
): boolean {
  if (points.length < 3) {
    return false
  }
  return sceneStore.previewLandformSurfaceMeshNode({
    nodeId,
    localPoints: points.map(([x, z]) => [x, z] as [number, number]),
  })
}

function previewLandformNodeDuringTranslate(nodeId: string): void {
  const node = sceneStore.getNodeById(nodeId)
  if (!node || node.dynamicMesh?.type !== 'Landform') {
    return
  }
  const points = cloneLandformFootprintPoints(node)
  if (points.length < 3) {
    return
  }
  buildLandformPreviewFromLocalPoints(nodeId, points)
}

function previewLandformNodesDuringTransform(updates: TransformUpdatePayload[], mode: string): void {
  if (mode !== 'translate' || !updates.length) {
    return
  }

  const previewIds = new Set<string>()
  updates.forEach((update) => {
    if (typeof update.id === 'string' && update.id.length > 0) {
      previewIds.add(update.id)
    }
  })

  previewIds.forEach((id) => {
    previewLandformNodeDuringTranslate(id)
  })
}

function commitLandformContourNode(nodeId: string, points: Array<[number, number]>): boolean {
  if (points.length < 3) {
    return false
  }
  const updated = sceneStore.updateLandformSurfaceMeshNode({
    nodeId,
    localPoints: points.map(([x, z]) => [x, z] as [number, number]),
  })
  return Boolean(updated)
}

function tryBeginLandformVertexDrag(event: PointerEvent): boolean {
  if (landformContourVertexDragState) {
    return false
  }
  if (!isSelectedLandformEditMode() || landformBuildTool.getSession()) {
    return false
  }
  const selectedId = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
  if (!selectedId || sceneStore.isNodeSelectionLocked(selectedId)) {
    return false
  }
  const node = findSceneNode(sceneStore.nodes, selectedId)
  const runtime = objectMap.get(selectedId) ?? null
  if (!node || !runtime || node.dynamicMesh?.type !== 'Landform') {
    return false
  }

  ensureLandformVertexHandlesForSelectedNode()
  const hit = pickLandformVertexHandleAtPointer(event)
  if (!hit || hit.nodeId !== selectedId) {
    return false
  }

  const basePoints = cloneLandformFootprintPoints(node)
  const startPoint = basePoints[hit.vertexIndex]
  if (!startPoint) {
    return false
  }

  const startPointWorld = runtime.localToWorld(new THREE.Vector3(startPoint[0], 0, startPoint[1]))
  const worldQuaternion = runtime.getWorldQuaternion(new THREE.Quaternion())
  const rawAxisWorld = hit.gizmoKind === 'axis' && hit.gizmoAxis
    ? hit.gizmoAxis.clone().applyQuaternion(worldQuaternion)
    : null
  const axisWorld = rawAxisWorld
    ? new THREE.Vector3(rawAxisWorld.x, 0, rawAxisWorld.z).normalize()
    : null
  const dragMode = axisWorld && axisWorld.lengthSq() > 1e-10 ? 'axis' : 'free'

  landformContourVertexDragState = {
    pointerId: event.pointerId,
    nodeId: selectedId,
    vertexIndex: hit.vertexIndex,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    dragMode,
    axisWorld: dragMode === 'axis' ? axisWorld : null,
    dragPlane: createEndpointDragPlane({
      mode: dragMode,
      axisWorld: dragMode === 'axis' ? axisWorld : null,
      startPointWorld,
      freePlaneNormal: new THREE.Vector3(0, 1, 0),
    }),
    startPointWorld: startPointWorld.clone(),
    startHitWorld: null,
    runtimeObject: runtime,
    basePoints,
    workingPoints: basePoints.map(([x, z]) => [x, z] as [number, number]),
  }

  setActiveLandformVertexHandle({ nodeId: selectedId, vertexIndex: hit.vertexIndex, gizmoPart: hit.gizmoPart })
  pointerInteraction.capture(event.pointerId)
  return true
}

function tryBeginRegionVertexDrag(event: PointerEvent): boolean {
  if (regionContourVertexDragState) {
    return false
  }
  if (!isSelectedRegionEditMode() || regionBuildTool.getSession()) {
    return false
  }
  const selectedId = sceneStore.selectedNodeId ?? props.selectedNodeId ?? null
  if (!selectedId || sceneStore.isNodeSelectionLocked(selectedId)) {
    return false
  }
  const node = findSceneNode(sceneStore.nodes, selectedId)
  const runtime = objectMap.get(selectedId) ?? null
  if (!node || !runtime || node.dynamicMesh?.type !== 'Region') {
    return false
  }

  ensureRegionVertexHandlesForSelectedNode()
  const hit = pickRegionVertexHandleAtPointer(event)
  if (!hit || hit.nodeId !== selectedId) {
    return false
  }

  const basePoints = cloneRegionLocalPoints(node)
  const startPoint = basePoints[hit.vertexIndex]
  if (!startPoint) {
    return false
  }

  const startPointWorld = runtime.localToWorld(new THREE.Vector3(startPoint[0], 0, startPoint[1]))
  const worldQuaternion = runtime.getWorldQuaternion(new THREE.Quaternion())
  const rawAxisWorld = hit.gizmoKind === 'axis' && hit.gizmoAxis
    ? hit.gizmoAxis.clone().applyQuaternion(worldQuaternion)
    : null
  const axisWorld = rawAxisWorld
    ? new THREE.Vector3(rawAxisWorld.x, 0, rawAxisWorld.z).normalize()
    : null
  const dragMode = axisWorld && axisWorld.lengthSq() > 1e-10 ? 'axis' : 'free'

  regionContourVertexDragState = {
    pointerId: event.pointerId,
    nodeId: selectedId,
    vertexIndex: hit.vertexIndex,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    dragMode,
    axisWorld: dragMode === 'axis' ? axisWorld : null,
    dragPlane: createEndpointDragPlane({
      mode: dragMode,
      axisWorld: dragMode === 'axis' ? axisWorld : null,
      startPointWorld,
      freePlaneNormal: new THREE.Vector3(0, 1, 0),
    }),
    startPointWorld: startPointWorld.clone(),
    startHitWorld: null,
    runtimeObject: runtime,
    basePoints,
    workingPoints: basePoints.map(([x, z]) => [x, z] as [number, number]),
  }

  setActiveRegionVertexHandle({ nodeId: selectedId, vertexIndex: hit.vertexIndex, gizmoPart: hit.gizmoPart })
  pointerInteraction.capture(event.pointerId)
  return true
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

  const hit = pickNearestPlanarEdge({
    pointer: pointerVec,
    vertices: worldVertices.map((entry) => ({ x: entry.x, y: entry.z })),
    maxDistance: FLOOR_EDGE_PICK_DISTANCE,
  })
  if (!hit) {
    return null
  }

  return {
    edgeIndex: hit.edgeIndex,
    perp: hit.perp,
    referencePoint: hit.referencePoint,
    initialProjection: hit.initialProjection,
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
  if (!isSelectedFloorEditMode() || floorBuildTool.getSession()) {
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
    ...(base
      ? {
          topBottomMaterialConfigId: base.topBottomMaterialConfigId ?? null,
          sideMaterialConfigId: base.sideMaterialConfigId ?? null,
          smooth: base.smooth,
          thickness: (base as any).thickness,
          sideUvScale: (base as any).sideUvScale,
        }
      : {}),
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

type GroundSculptBlockedBuildTool = 'wall' | 'road' | 'floor' | 'landform' | 'region' | 'water' | 'displayBoard' | 'warpGate'
type GroundBuildTool = 'terrain' | 'paint' | 'scatter'

function isBuildToolBlockedDuringGroundSculptConfig(
  tool: BuildTool | null,
): tool is GroundSculptBlockedBuildTool {
  return tool === 'wall' || tool === 'road' || tool === 'floor' || tool === 'landform' || tool === 'region' || tool === 'water' || tool === 'displayBoard' || tool === 'warpGate'
}

function isGroundBuildTool(tool: BuildTool | null): tool is GroundBuildTool {
  return tool === 'terrain' || tool === 'paint' || tool === 'scatter'
}

function isGroundSculptContext(context: string | null): boolean {
  return context === 'terrain-sculpt' || context === 'build-tool:terrain'
}

function isGroundPaintContext(context: string | null): boolean {
  return context === 'terrain-paint' || context === 'build-tool:paint'
}

function isGroundScatterContext(context: string | null): boolean {
  return context === 'scatter' || context === 'scatter-erase' || context === 'build-tool:scatter'
}

function isManagedBuildToolContext(context: string | null): boolean {
  return Boolean(
    context
    && (
      context.startsWith('build-tool')
      || isGroundSculptContext(context)
      || isGroundPaintContext(context)
      || isGroundScatterContext(context)
    ),
  )
}

function resolveSelectionContextForBuildTool(tool: BuildTool | null): string | null {
  if (tool === 'terrain') {
    return terrainStore.brushOperation ? 'terrain-sculpt' : 'build-tool:terrain'
  }
  if (tool === 'paint') {
    return terrainStore.groundPanelTab === 'paint' ? 'terrain-paint' : 'build-tool:paint'
  }
  if (tool === 'scatter') {
    if (scatterEraseModeActive.value) {
      return 'scatter-erase'
    }
    return terrainStore.scatterSelectedAsset ? 'scatter' : 'build-tool:scatter'
  }
  return tool ? `build-tool:${tool}` : null
}

function resolveGroundToolFromTab(tab: GroundPanelTab): GroundBuildTool {
  if (tab === 'terrain') {
    return 'terrain'
  }
  if (tab === 'paint') {
    return 'paint'
  }
  return 'scatter'
}

function resolveGroundTabFromTool(tool: GroundBuildTool): GroundPanelTab {
  if (tool === 'terrain') {
    return 'terrain'
  }
  if (tool === 'paint') {
    return 'paint'
  }
  return groundPanelTab.value !== 'terrain' && groundPanelTab.value !== 'paint'
    ? groundPanelTab.value
    : scatterCategory.value
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

const GROUND_BRUSH_RADIUS_WHEEL_STEP = 0.1

function clampGroundBrushRadius(value: number): number {
  const next = Number(value)
  if (!Number.isFinite(next)) {
    return terrainStore.brushRadius
  }
  return Math.min(50, Math.max(0.1, next))
}

function clampScatterBrushRadius(value: number): number {
  const next = Number(value)
  if (!Number.isFinite(next)) {
    return terrainStore.scatterBrushRadius
  }
  return Math.min(20, Math.max(0.1, next))
}

function clampScatterEraseBrushRadius(value: number): number {
  const next = Number(value)
  if (!Number.isFinite(next)) {
    return terrainStore.scatterEraseRadius
  }
  return Math.min(20, Math.max(0.1, next))
}

function syncBrushIndicatorScaleImmediately(radius: number): void {
  if (!brushMesh.visible) {
    return
  }
  if (!Number.isFinite(radius) || radius <= 0) {
    return
  }
  brushMesh.scale.set(radius, radius, 1)
  brushMesh.updateMatrixWorld(true)
}

// Camera controls debug (DEV only): set `window.__HARMONY_CAMERA_CONTROLS_DEBUG__ = true` in DevTools.
// Removed camera controls debug logging.

// Removed handleViewportWheelDebug

function resolveGroundWheelRadiusTarget(): 'terrain' | 'scatter' | 'scatter-erase' | null {
  if (scatterEraseModeActive.value) {
    return 'scatter-erase'
  }

  if (buildToolsDisabled.value) {
    return null
  }

  if (activeBuildTool.value === 'terrain' || activeBuildTool.value === 'paint') {
    return hasGroundNode.value ? 'terrain' : null
  }

  if (activeBuildTool.value === 'scatter') {
    if (terrainStore.scatterBrushShape !== 'circle') {
      return null
    }
    return hasGroundNode.value ? 'scatter' : null
  }

  return null
}

function applyGroundBrushRadiusWheelDelta(event: WheelEvent): boolean {
  if (event.defaultPrevented) {
    return false
  }
  if (props.previewActive) {
    return false
  }
  if (uiStore.isInteractionLocked('asset-import')) {
    return false
  }
  if (!(event.ctrlKey || event.metaKey)) {
    return false
  }
  if (isEventFromViewportOverlayUi(event)) {
    return false
  }

  const direction = event.deltaY < 0 ? 1 : -1
  const delta = direction * GROUND_BRUSH_RADIUS_WHEEL_STEP

  const target = resolveGroundWheelRadiusTarget()
  if (!target) {
    return false
  }

  if (target === 'terrain') {
    const nextRadius = clampGroundBrushRadius(terrainStore.brushRadius + delta)
    handleGroundBrushRadiusUpdate(nextRadius)
    syncBrushIndicatorScaleImmediately(nextRadius)
  } else if (target === 'scatter') {
    const nextRadius = clampScatterBrushRadius(terrainStore.scatterBrushRadius + delta)
    handleGroundScatterBrushRadiusUpdate(nextRadius)
    syncBrushIndicatorScaleImmediately(nextRadius)
  } else {
    const nextRadius = clampScatterEraseBrushRadius(terrainStore.scatterEraseRadius + delta)
    terrainStore.setScatterEraseRadius(nextRadius)
    syncBrushIndicatorScaleImmediately(nextRadius)
  }

  event.preventDefault()
  event.stopPropagation()
  return true
}

function handleViewportWheel(event: WheelEvent) {
  if (applyGroundBrushRadiusWheelDelta(event)) return
}

function maybeHandleBuildToolRightClick(event: PointerEvent): boolean {
  if (event.button !== 2) {
    return false
  }

  if (isTemporaryNavigationOverrideActive()) {
    return false
  }

  const dragState = pointerInteraction.get()
  const isTrackedRightClick = dragState?.kind === 'buildToolRightClick' && dragState.pointerId === event.pointerId
  const trackingState = pointerTrackingState
  const isTrackedPointerRightClick =
    trackingState &&
    trackingState.pointerId === event.pointerId &&
    trackingState.button === 2
  const pointerTrackingMoved = (() => {
    if (!isTrackedPointerRightClick || !trackingState) {
      return false
    }
    const dx = event.clientX - trackingState.startX
    const dy = event.clientY - trackingState.startY
    return trackingState.moved || Math.hypot(dx, dy) >= CLICK_DRAG_THRESHOLD_PX
  })()
  const clickWasDrag = isTrackedRightClick
    ? (dragState.moved || pointerInteraction.ensureMoved(event))
    : pointerTrackingMoved

  if (clickWasDrag) {
    return false
  }

  pointerInteraction.clearIfKind('buildToolRightClick')

  if (scatterEraseModeActive.value) {
    exitScatterEraseMode()
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return true
  }

  const tool = activeBuildTool.value
  if (!tool) {
    return false
  }

  let handled = false
  switch (tool) {
    case 'wall':
      handled = wallBuildTool.cancel()
      break
    case 'road':
      handled = roadBuildTool.cancel()
      break
    case 'floor':
      handled = floorBuildTool.cancel()
      break
    case 'landform':
      handled = landformBuildTool.cancel()
      break
    case 'region':
      handled = regionBuildTool.cancel()
      break
    case 'water':
      handled = waterBuildTool.cancel()
      break
    case 'displayBoard':
      handled = displayBoardBuildTool.cancel()
      if (handled) {
        clearDisplayBoardSizeHud()
      }
      break
    case 'billboard':
      handled = billboardBuildTool.cancel()
      break
    case 'warpGate':
      if (warpGatePlacementClickSessionState) {
        warpGatePlacementClickSessionState = null
        hideWarpGatePlacementPreview()
        handled = true
      }
      break
    case 'scatter':
      handled = cancelGroundEditorScatterPlacement()
      break
    case 'terrain':
    case 'paint':
      handled = false
      break
    default:
      handled = false
      break
  }

  if (!handled) {
    const previousTransformTool = transformToolBeforeBuild
    handled = cancelActiveBuildOperation({ restoreTransformTool: previousTransformTool })
    if (handled) {
      transformToolBeforeBuild = null
    }
  }

  if (handled) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }
  return handled
}

const ROAD_VERTEX_SNAP_DISTANCE = GRID_MAJOR_SPACING * 0.5

function clearBuildToolVertexSnap() {
  clearVertexSnapMarkers()
}

function resolveBuildToolVertexSnapPoint(
  event: PointerEvent,
  sourceWorld: THREE.Vector3,
  options?: {
    excludeNodeIds?: readonly string[]
    keepSourceY?: boolean
  },
): THREE.Vector3 | null {
  const active = isVertexSnapActiveEffective.value || event.shiftKey
  if (!active) {
    clearBuildToolVertexSnap()
    return null
  }

  const excludeNodeIds = new Set<string>([GROUND_NODE_ID])
  for (const nodeId of options?.excludeNodeIds ?? []) {
    if (typeof nodeId === 'string' && nodeId.length > 0) {
      excludeNodeIds.add(nodeId)
    }
  }

  const candidate = snapController.findHoverCandidate({
    event,
    excludeNodeIds,
    pixelThresholdPx: vertexSnapThresholdPx.value,
  })
  if (!candidate) {
    clearBuildToolVertexSnap()
    return null
  }

  const snapped = candidate.worldPosition.clone()
  if (options?.keepSourceY) {
    snapped.y = sourceWorld.y
  }

  updateVertexSnapMarkers({
    sourceWorld: sourceWorld.clone(),
    targetWorld: snapped.clone(),
    delta: snapped.clone().sub(sourceWorld),
    targetNodeId: candidate.nodeId,
    targetMesh: candidate.mesh,
    targetInstanceId: candidate.instanceId,
  })

  return snapped
}

buildStartIndicatorRenderer = createBuildStartIndicatorRenderer({
  rootGroup,
})

const wallBuildTool = createWallBuildTool({
  activeBuildTool,
  wallBuildShape,
  wallRegularPolygonSides,
  sceneStore,
  getWallEditNodeId: () => (isSelectedWallEditMode() ? wallEditNodeId.value : null),
  pointerInteraction,
  rootGroup,
  raycastGroundPoint,
  resolveBuildPlacementPoint,
  snapPoint: (point) => snapVectorToMajorGrid(point),
  resolveVertexSnapPoint: resolveBuildToolVertexSnapPoint,
  clearVertexSnap: clearBuildToolVertexSnap,
  isAltOverrideActive: () => isAltOverrideActive,
  isEditReferenceVisible: () => isSelectedWallEditMode(),
  showStartIndicator: showBuildStartIndicator,
  hideStartIndicator: hideBuildStartIndicator,
  holdStartIndicatorUntilNodeVisible: holdBuildStartIndicatorUntilNodeVisible,
  normalizeWallDimensionsForViewport,
  getWallBrush: () => ({
    presetAssetId: wallBrushPresetAssetId.value,
    presetData: wallBrushPresetData.value,
  }),
  applyWallPreviewMaterials: (group, presetData) => applyWallPreviewMaterials(group, presetData),
  resolveWallPreviewRenderData: (params) => wallRenderer.resolveWallPreviewRenderData(params),
  syncExactWallPreview: (params) => wallRenderer.syncWallPreviewContainer(params),
  disposeExactWallPreview: (container) => wallRenderer.disposeWallPreviewContainer(container),
})

type WallPresetData = import('@/utils/wallPreset').WallPresetData
type FloorPresetData = import('@/utils/floorPreset').FloorPresetData
type LandformPresetData = import('@/utils/landformPreset').LandformPresetData
type RoadPresetData = import('@/utils/roadPreset').RoadPresetData

const wallPresetDialogOpen = ref(false)
const wallPresetDialogAnchor = ref<{ x: number; y: number } | null>(null)
const wallBrushPresetData = ref<WallPresetData | null>(null)
let wallBrushPresetLoadToken = 0

const floorBrushPresetData = ref<FloorPresetData | null>(null)
let floorBrushPresetLoadToken = 0

const landformBrushPresetData = ref<LandformPresetData | null>(null)
let landformBrushPresetLoadToken = 0

const roadBrushPresetData = ref<RoadPresetData | null>(null)
let roadBrushPresetLoadToken = 0

function handleWallPresetDialogUpdate(asset: ProjectAsset | null): void {
  wallPresetDialogOpen.value = false
  wallPresetDialogAnchor.value = null
  // If a wall preset was selected, clear any current selection and
  // immediately activate the wall build tool so the user can begin building.
  const assetId = asset?.id ?? null
  if (assetId) {
    sceneStore.setSelection([])
    buildToolsStore.setWallBrushPresetAssetId(assetId, { activate: true })
  } else {
    buildToolsStore.setWallBrushPresetAssetId(null)
  }
}

function handleWallPresetDialogCancel(): void {
  wallPresetDialogOpen.value = false
  wallPresetDialogAnchor.value = null
}

function handleFloorPresetDialogUpdate(asset: ProjectAsset | null): void {
  // If a floor preset was selected, clear any current selection and
  // immediately activate the floor build tool so the user can begin building.
  const assetId = asset?.id ?? null
  if (assetId) {
    sceneStore.setSelection([])
    buildToolsStore.setFloorBrushPresetAssetId(assetId, { activate: true })
  } else {
    buildToolsStore.setFloorBrushPresetAssetId(null)
  }
}

function handleLandformPresetDialogUpdate(asset: ProjectAsset | null): void {
  const assetId = asset?.id ?? null
  if (assetId) {
    sceneStore.setSelection([])
    buildToolsStore.setLandformBrushPresetAssetId(assetId, { activate: true })
  } else {
    buildToolsStore.setLandformBrushPresetAssetId(null)
  }
}

function handleRoadPresetDialogUpdate(asset: ProjectAsset | null): void {
  const assetId = asset?.id ?? null
  if (assetId) {
    sceneStore.setSelection([])
    buildToolsStore.setRoadBrushPresetAssetId(assetId, { activate: true })
  } else {
    buildToolsStore.setRoadBrushPresetAssetId(null)
  }
}

watch(wallBrushPresetAssetId, (assetId) => {
  const id = typeof assetId === 'string' ? assetId.trim() : ''
  wallBrushPresetLoadToken += 1
  const token = wallBrushPresetLoadToken

  if (!id) {
    wallBrushPresetData.value = null
    wallBuildTool.syncBrushPreset()
    return
  }

  void sceneStore
    .loadWallPreset(id)
    .then(async (data) => {
      if (token !== wallBrushPresetLoadToken) {
        return
      }
      const presetData = data as WallPresetData
      const dependencyAssetIds = collectWallPresetDependencyAssetIds(presetData)

      if (dependencyAssetIds.length) {
        const presetAssetRegistry = isSceneAssetRegistry(presetData.assetRegistry)
          ? presetData.assetRegistry
          : null
        try {
          await sceneStore.ensurePrefabDependencies(dependencyAssetIds, {
            prefabAssetIdForDownloadProgress: id,
            prefabAssetRegistry: presetAssetRegistry,
          })
        } catch (dependencyError) {
          console.warn('Failed to hydrate wall preset dependencies for brush', id, dependencyError)
        }
      }

      if (token !== wallBrushPresetLoadToken) {
        return
      }
      wallBrushPresetData.value = presetData
      wallBuildTool.syncBrushPreset()
    })
    .catch((error) => {
      if (token !== wallBrushPresetLoadToken) {
        return
      }
      console.warn('Failed to load wall preset for brush', id, error)
      wallBrushPresetData.value = null
      wallBuildTool.syncBrushPreset()
    })
})

watch(activeBuildTool, (tool) => {
  if (tool !== 'road') {
    return
  }
  const desiredContext = resolveSelectionContextForBuildTool(tool)
  if (desiredContext) {
    uiStore.setActiveSelectionContext(desiredContext)
  }
})

watch(floorBrushPresetAssetId, (assetId) => {
  const id = typeof assetId === 'string' ? assetId.trim() : ''
  floorBrushPresetLoadToken += 1
  const token = floorBrushPresetLoadToken

  if (!id) {
    floorBrushPresetData.value = null
    return
  }

  void sceneStore
    .loadFloorPreset(id)
    .then(async (data) => {
      if (token !== floorBrushPresetLoadToken) {
        return
      }
      const presetData = data as FloorPresetData
      const dependencyAssetIds = collectFloorPresetDependencyAssetIds(presetData, sceneStore.materials)

      if (dependencyAssetIds.length) {
        const presetAssetRegistry = isSceneAssetRegistry(presetData.assetRegistry)
          ? presetData.assetRegistry
          : null
        try {
          await sceneStore.ensurePrefabDependencies(dependencyAssetIds, {
            prefabAssetIdForDownloadProgress: id,
            prefabAssetRegistry: presetAssetRegistry,
          })
        } catch (dependencyError) {
          // Keep floor brush usable even if dependency hydration partially fails.
          console.warn('Failed to hydrate floor preset dependencies for brush', id, dependencyError)
        }
      }

      if (token !== floorBrushPresetLoadToken) {
        return
      }
      floorBrushPresetData.value = presetData
    })
    .catch((error) => {
      if (token !== floorBrushPresetLoadToken) {
        return
      }
      console.warn('Failed to load floor preset for brush', id, error)
      floorBrushPresetData.value = null
    })
})

watch(landformBrushPresetAssetId, (assetId) => {
  const id = typeof assetId === 'string' ? assetId.trim() : ''
  landformBrushPresetLoadToken += 1
  const token = landformBrushPresetLoadToken

  if (!id) {
    landformBrushPresetData.value = null
    return
  }

  void sceneStore
    .loadLandformPreset(id)
    .then(async (data) => {
      if (token !== landformBrushPresetLoadToken) {
        return
      }
      const presetData = data as LandformPresetData
      const dependencyAssetIds = collectLandformPresetDependencyAssetIds(presetData, sceneStore.materials)

      if (dependencyAssetIds.length) {
        const presetAssetRegistry = isSceneAssetRegistry(presetData.assetRegistry)
          ? presetData.assetRegistry
          : null
        try {
          await sceneStore.ensurePrefabDependencies(dependencyAssetIds, {
            prefabAssetIdForDownloadProgress: id,
            prefabAssetRegistry: presetAssetRegistry,
          })
        } catch (dependencyError) {
          console.warn('Failed to hydrate landform preset dependencies for brush', id, dependencyError)
        }
      }

      if (token !== landformBrushPresetLoadToken) {
        return
      }
      landformBrushPresetData.value = presetData
    })
    .catch((error) => {
      if (token !== landformBrushPresetLoadToken) {
        return
      }
      console.warn('Failed to load landform preset for brush', id, error)
      landformBrushPresetData.value = null
    })
})

watch(roadBrushPresetAssetId, (assetId) => {
  const id = typeof assetId === 'string' ? assetId.trim() : ''
  roadBrushPresetLoadToken += 1
  const token = roadBrushPresetLoadToken

  if (!id) {
    roadBrushPresetData.value = null
    return
  }

  void sceneStore
    .loadRoadPreset(id)
    .then(async (data) => {
      if (token !== roadBrushPresetLoadToken) {
        return
      }
      const presetData = data as RoadPresetData
      const dependencyAssetIds = collectRoadPresetDependencyAssetIds(presetData, sceneStore.materials)

      if (dependencyAssetIds.length) {
        const presetAssetRegistry = isSceneAssetRegistry(presetData.assetRegistry)
          ? presetData.assetRegistry
          : null
        try {
          await sceneStore.ensurePrefabDependencies(dependencyAssetIds, {
            prefabAssetIdForDownloadProgress: id,
            prefabAssetRegistry: presetAssetRegistry,
          })
        } catch (dependencyError) {
          console.warn('Failed to hydrate road preset dependencies for brush', id, dependencyError)
        }
      }

      if (token !== roadBrushPresetLoadToken) {
        return
      }
      roadBrushPresetData.value = presetData
    })
    .catch((error) => {
      if (token !== roadBrushPresetLoadToken) {
        return
      }
      console.warn('Failed to load road preset for brush', id, error)
      roadBrushPresetData.value = null
    })
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
  isEditReferenceVisible: () => isSelectedRoadEditMode(),
  showStartIndicator: showBuildStartIndicator,
  hideStartIndicator: hideBuildStartIndicator,
  holdStartIndicatorUntilNodeVisible: holdBuildStartIndicatorUntilNodeVisible,
  raycastGroundPoint,
  resolveVertexSnapPoint: resolveBuildToolVertexSnapPoint,
  clearVertexSnap: clearBuildToolVertexSnap,
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
  getRoadBrush: () => ({
    presetAssetId: roadBrushPresetAssetId.value,
    presetData: roadBrushPresetData.value,
  }),
  createRoadNodeMaterials,
  ensureRoadVertexHandlesForSelectedNode,
 })

const floorBuildTool = createFloorBuildTool({
  activeBuildTool,
  floorBuildShape,
  floorRegularPolygonSides,
  getDefaultCircleRadius: () => GRID_MAJOR_SPACING,
  sceneStore,
  rootGroup,
  raycastGroundPoint,
  resolveBuildPlacementPoint,
  snapPoint: (point) => snapVectorToMajorGrid(point.clone()),
  resolveVertexSnapPoint: resolveBuildToolVertexSnapPoint,
  clearVertexSnap: clearBuildToolVertexSnap,
  isAltOverrideActive: () => isAltOverrideActive,
  isEditReferenceVisible: () => isSelectedFloorEditMode(),
  showStartIndicator: showBuildStartIndicator,
  hideStartIndicator: hideBuildStartIndicator,
  holdStartIndicatorUntilNodeVisible: holdBuildStartIndicatorUntilNodeVisible,
  getFloorBrush: () => ({
    presetAssetId: floorBrushPresetAssetId.value,
    presetData: floorBrushPresetData.value,
  }),
  applyFloorPreviewMaterials: (group, presetData) => applyFloorPreviewMaterials(group, presetData),
  syncCreatedFloorMaterials: (nodeId) => {
    const runtimeObject = objectMap.get(nodeId) ?? null
    if (runtimeObject) {
      refreshFloorRuntimeMaterials(nodeId, runtimeObject)
    }
  },
  clickDragThresholdPx: CLICK_DRAG_THRESHOLD_PX,
})

const landformBuildTool = createLandformBuildTool({
  activeBuildTool,
  landformBuildShape,
  landformRegularPolygonSides,
  getDefaultCircleRadius: () => GRID_MAJOR_SPACING,
  sceneStore,
  rootGroup,
  raycastGroundPoint,
  resolveBuildPlacementPoint,
  snapPoint: (point) => snapVectorToMajorGrid(point.clone()),
  resolveVertexSnapPoint: resolveBuildToolVertexSnapPoint,
  clearVertexSnap: clearBuildToolVertexSnap,
  isAltOverrideActive: () => isAltOverrideActive,
  showStartIndicator: showBuildStartIndicator,
  hideStartIndicator: hideBuildStartIndicator,
  holdStartIndicatorUntilNodeVisible: holdBuildStartIndicatorUntilNodeVisible,
  getLandformBrush: () => ({
    presetAssetId: landformBrushPresetAssetId.value,
    presetData: landformBrushPresetData.value,
  }),
  applyLandformPresetToNode: (nodeId, assetId, presetData) => sceneStore.applyLandformPresetToNode(nodeId, assetId, presetData),
  applyPreviewMaterials: (group, presetData) => applyLandformPreviewMaterials(group, presetData),
  clickDragThresholdPx: CLICK_DRAG_THRESHOLD_PX,
})

const regionBuildTool = createRegionBuildTool({
  activeBuildTool,
  sceneStore,
  rootGroup,
  raycastGroundPoint,
  resolveBuildPlacementPoint,
  snapPoint: (point) => snapVectorToMajorGrid(point.clone()),
  resolveVertexSnapPoint: resolveBuildToolVertexSnapPoint,
  clearVertexSnap: clearBuildToolVertexSnap,
  isAltOverrideActive: () => isAltOverrideActive,
  isRelativeAngleSnapActive: () => relativeAngleSnapCModifierActive.value,
  showStartIndicator: showBuildStartIndicator,
  hideStartIndicator: hideBuildStartIndicator,
  holdStartIndicatorUntilNodeVisible: holdBuildStartIndicatorUntilNodeVisible,
  clickDragThresholdPx: CLICK_DRAG_THRESHOLD_PX,
})

const waterBuildTool = createWaterBuildTool({
  activeBuildTool,
  waterBuildShape,
  getDefaultCircleRadius: () => GRID_MAJOR_SPACING,
  sceneStore,
  rootGroup,
  raycastGroundPoint,
  resolveBuildPlacementPoint,
  snapPoint: (point) => snapVectorToMajorGrid(point.clone()),
  resolveVertexSnapPoint: resolveBuildToolVertexSnapPoint,
  clearVertexSnap: clearBuildToolVertexSnap,
  isAltOverrideActive: () => isAltOverrideActive,
  isEditReferenceVisible: () => isSelectedWaterEditMode(),
  showStartIndicator: showBuildStartIndicator,
  hideStartIndicator: hideBuildStartIndicator,
  holdStartIndicatorUntilNodeVisible: holdBuildStartIndicatorUntilNodeVisible,
  clickDragThresholdPx: CLICK_DRAG_THRESHOLD_PX,
})

const displayBoardBuildTool = createDisplayBoardBuildTool({
  activeBuildTool,
  toolId: 'displayBoard',
  sceneStore,
  rootGroup,
  isAltOverrideActive: () => isAltOverrideActive,
  resolveSurfaceAtPointer: resolveBuildSurfaceAtPointer,
  projectPointerToPlane: (event, plane) => projectPointerToPlane(event, plane),
  getCameraDirection: () => {
    const direction = new THREE.Vector3(0, 0, -1)
    if (camera) {
      camera.getWorldDirection(direction)
    }
    return direction.normalize()
  },
  resolveVertexSnapAtPointer,
  updatePlacementSnap: (event, previewObject) => {
    const result = snapController.updatePlacementSideSnap({
      event,
      previewObject,
      active: true,
      pixelThresholdPx: vertexSnapThresholdPx.value,
      excludeNodeIds: new Set([GROUND_NODE_ID]),
    })
    updatePlacementSideSnapMarkers(result)
    return result?.best?.delta?.clone() ?? null
  },
  clearPlacementSnap: () => {
    snapController.resetPlacementSideSnap()
    clearPlacementSideSnapMarkers()
  },
  showVertexSnap: (snap) => {
    updateVertexSnapMarkers(
      snap
        ? {
            sourceWorld: snap.sourceWorld.clone(),
            targetWorld: snap.targetWorld.clone(),
            delta: snap.targetWorld.clone().sub(snap.sourceWorld),
            targetNodeId: '',
          }
        : null,
    )
  },
  createDisplayBoardNode: (payload) => {
    sceneStore.createDisplayBoardNode(payload)
  },
})

const billboardBuildTool = createDisplayBoardBuildTool({
  activeBuildTool,
  toolId: 'billboard',
  sceneStore,
  rootGroup,
  isAltOverrideActive: () => isAltOverrideActive,
  resolveSurfaceAtPointer: resolveBuildSurfaceAtPointer,
  projectPointerToPlane: (event, plane) => projectPointerToPlane(event, plane),
  getCameraDirection: () => {
    const direction = new THREE.Vector3(0, 0, -1)
    if (camera) {
      camera.getWorldDirection(direction)
    }
    return direction.normalize()
  },
  resolveVertexSnapAtPointer,
  updatePlacementSnap: (event, previewObject) => {
    const result = snapController.updatePlacementSideSnap({
      event,
      previewObject,
      active: true,
      pixelThresholdPx: vertexSnapThresholdPx.value,
      excludeNodeIds: new Set([GROUND_NODE_ID]),
    })
    updatePlacementSideSnapMarkers(result)
    return result?.best?.delta?.clone() ?? null
  },
  clearPlacementSnap: () => {
    snapController.resetPlacementSideSnap()
    clearPlacementSideSnapMarkers()
  },
  showVertexSnap: (snap) => {
    updateVertexSnapMarkers(
      snap
        ? {
            sourceWorld: snap.sourceWorld.clone(),
            targetWorld: snap.targetWorld.clone(),
            delta: snap.targetWorld.clone().sub(snap.sourceWorld),
            targetNodeId: '',
          }
        : null,
    )
  },
  createDisplayBoardNode: (payload) => {
    sceneStore.createBillboardNode(payload)
  },
})

function handleFloorShapeMenuOpen(value: boolean) {
  floorShapeMenuOpen.value = Boolean(value)
}

function handleLandformShapeMenuOpen(value: boolean) {
  landformShapeMenuOpen.value = Boolean(value)
}

function handleWallShapeMenuOpen(value: boolean) {
  wallShapeMenuOpen.value = Boolean(value)
}

function handleRoadShapeMenuOpen(value: boolean) {
  roadShapeMenuOpen.value = Boolean(value)
}

function toggleWallDoorSelectMode() {
  const next = !wallDoorSelectModeActive.value
  clearWallDoorRectangleSelectionState()
  clearWallDoorSelectionPayload()
  if (next && scatterEraseModeActive.value) {
    exitScatterEraseMode()
  }
  buildToolsStore.setWallDoorSelectModeActive(next)
  if (next && activeBuildTool.value !== 'wall') {
    buildToolsStore.setActiveBuildTool('wall')
  }
}

function handleWaterShapeMenuOpen(value: boolean) {
  waterShapeMenuOpen.value = Boolean(value)
}

function handleGroundTerrainMenuOpen(value: boolean) {
  groundTerrainMenuOpen.value = Boolean(value)
}

function handleGroundPaintMenuOpen(value: boolean) {
  groundPaintMenuOpen.value = Boolean(value)
}

function handleGroundScatterMenuOpen(value: boolean) {
  groundScatterMenuOpen.value = Boolean(value)
}

function patchEnvironmentCsmSettings(patch: Partial<EnvironmentCsmSettings>): void {
  const current = resolveEnvironmentCsmSettings(environmentSettings.value)
  sceneStore.patchEnvironmentSettings({
    csm: {
      ...current,
      ...patch,
    },
  })
}

function handleCsmEnabledUpdate(value: boolean): void {
  patchEnvironmentCsmSettings({ enabled: Boolean(value) })
}

function handleCsmShadowEnabledUpdate(value: boolean): void {
  patchEnvironmentCsmSettings({ shadowEnabled: Boolean(value) })
}

function handleCsmLightColorUpdate(value: string): void {
  patchEnvironmentCsmSettings({ lightColor: value })
}

function handleCsmLightIntensityUpdate(value: number): void {
  patchEnvironmentCsmSettings({ lightIntensity: value })
}

function handleCsmSunAzimuthDegUpdate(value: number): void {
  patchEnvironmentCsmSettings({ sunAzimuthDeg: value })
}

function handleCsmSunElevationDegUpdate(value: number): void {
  patchEnvironmentCsmSettings({ sunElevationDeg: value })
}

function handleCsmCascadesUpdate(value: number): void {
  patchEnvironmentCsmSettings({ cascades: value })
}

function handleCsmMaxFarUpdate(value: number): void {
  patchEnvironmentCsmSettings({ maxFar: value })
}

function handleCsmShadowMapSizeUpdate(value: number): void {
  patchEnvironmentCsmSettings({ shadowMapSize: value })
}

function handleCsmShadowBiasUpdate(value: number): void {
  patchEnvironmentCsmSettings({ shadowBias: value })
}

function handleViewportPlacementMenuOpen(value: boolean) {
  viewportPlacementMenuOpen.value = Boolean(value)
}

function collectSceneNodeNames(nodes: SceneNode[] | undefined, bucket: Set<string>): void {
  if (!nodes?.length) {
    return
  }
  nodes.forEach((node) => {
    if (node?.name) {
      bucket.add(node.name)
    }
    if (node?.children?.length) {
      collectSceneNodeNames(node.children, bucket)
    }
  })
}

function getNextViewportPlacementName(base: string): string {
  const names = new Set<string>()
  collectSceneNodeNames(sceneStore.nodes, names)
  if (!names.has(base)) {
    return base
  }
  let index = 1
  while (names.has(`${base} ${index}`)) {
    index += 1
  }
  return `${base} ${index}`
}

function ensureBehaviorComponentForNode(nodeId: string): void {
  const node = findSceneNode(sceneStore.nodes, nodeId)
  if (node?.components?.[BEHAVIOR_COMPONENT_TYPE]) {
    return
  }
  sceneStore.addNodeComponent(nodeId, BEHAVIOR_COMPONENT_TYPE)
}

function buildViewPointPlacementRoot(name: string): THREE.Object3D {
  const markerMesh = createPrimitiveMesh('Sphere', { color: 0xff8a65, doubleSided: true })
  markerMesh.name = `${name} Helper`
  markerMesh.castShadow = false
  markerMesh.receiveShadow = false
  markerMesh.renderOrder = 1000
  markerMesh.userData = {
    ...(markerMesh.userData ?? {}),
    editorOnly: true,
    ignoreGridSnapping: true,
    viewPoint: true,
  }

  const markerRoot = new THREE.Object3D()
  markerRoot.name = name
  markerRoot.add(markerMesh)
  markerRoot.userData = {
    ...(markerRoot.userData ?? {}),
    editorOnly: true,
    ignoreGridSnapping: true,
    viewPoint: true,
  }
  return markerRoot
}

function buildGuideboardPlacementRoot(name: string): THREE.Object3D {
  const guideboardMesh = new THREE.Object3D()
  guideboardMesh.name = `${name} Visual`
  guideboardMesh.castShadow = false
  guideboardMesh.receiveShadow = false
  guideboardMesh.userData = {
    ...(guideboardMesh.userData ?? {}),
    ignoreGridSnapping: true,
    guideboardHelper: true,
  }

  const guideboardRoot = new THREE.Object3D()
  guideboardRoot.name = name
  guideboardRoot.add(guideboardMesh)
  guideboardRoot.userData = {
    ...(guideboardRoot.userData ?? {}),
    ignoreGridSnapping: true,
    guideboard: true,
  }
  return guideboardRoot
}

function buildProtagonistPlacementRoot(name: string): THREE.Object3D {
  const capsuleMesh = createPrimitiveMesh('Capsule', { color: 0xffffff, doubleSided: true })
  capsuleMesh.name = `${name} Visual`
  capsuleMesh.castShadow = true
  capsuleMesh.receiveShadow = true
  capsuleMesh.userData = {
    ...(capsuleMesh.userData ?? {}),
    editorOnly: true,
    protagonist: true,
  }

  const root = new THREE.Object3D()
  root.name = name
  root.add(capsuleMesh)
  root.userData = {
    ...(root.userData ?? {}),
    editorOnly: true,
    protagonist: true,
  }
  return root
}

function handleStartViewportPlacement(item: ViewportPlacementItem): void {
  viewportPlacementMenuOpen.value = false
  if (activeBuildTool.value) {
    cancelActiveBuildOperation()
  }
  pendingViewportPlacement.value = item
  nodePlacementClickSessionState = null
  sceneStore.selectAsset(null)
  if (uiStore.activeSelectionContext !== 'viewport-add-node') {
    uiStore.setActiveSelectionContext('viewport-add-node')
  }
}

function handleCancelViewportPlacement(): void {
  pendingViewportPlacement.value = null
  nodePlacementClickSessionState = null
  viewportPlacementMenuOpen.value = false
  if (uiStore.activeSelectionContext === 'viewport-add-node') {
    uiStore.setActiveSelectionContext(null)
  }
}

function isSingleInstanceViewportPlacementItem(item: ViewportPlacementItem): boolean {
  return item.tab === 'other' && item.kind === 'protagonist'
}

function finishViewportPlacementAfterCommit(item: ViewportPlacementItem): void {
  if (!isSingleInstanceViewportPlacementItem(item)) {
    return
  }
  pendingViewportPlacement.value = null
  viewportPlacementMenuOpen.value = false
  if (uiStore.activeSelectionContext === 'viewport-add-node') {
    uiStore.setActiveSelectionContext(null)
  }
}

async function placeViewportItemAtPoint(item: ViewportPlacementItem, basePoint: THREE.Vector3, rotation: THREE.Vector3): Promise<boolean> {
  const parentId = resolveSelectedGroupDropParent()

  if (item.tab === 'geometry') {
    const mesh = createPrimitiveMesh(item.geometryType)
    await sceneStore.addModelNode({
      object: mesh,
      nodeType: item.geometryType,
      name: mesh.name,
      position: basePoint.clone(),
      rotation,
      parentId: parentId ?? undefined,
    })
    return true
  }

  if (item.tab === 'light') {
    sceneStore.addLightNode(item.lightType, {
      position: basePoint.clone(),
      name: item.label,
    })
    return true
  }

  if (item.kind === 'view-point') {
    const name = getNextViewportPlacementName('View Point')
    const created = await sceneStore.addModelNode({
      object: buildViewPointPlacementRoot(name),
      nodeType: 'Sphere',
      name,
      position: basePoint.clone(),
      rotation,
      parentId: parentId ?? undefined,
      snapToGrid: false,
      editorFlags: {
        editorOnly: true,
        ignoreGridSnapping: true,
      },
    })
    if (created) {
      const primaryMaterial = created.materials?.[0] ?? null
      if (primaryMaterial) {
        sceneStore.updateNodeMaterialProps(created.id, primaryMaterial.id, { side: 'double' })
      }
      if (!created.components?.[VIEW_POINT_COMPONENT_TYPE]) {
        sceneStore.addNodeComponent(created.id, VIEW_POINT_COMPONENT_TYPE)
      }
      ensureBehaviorComponentForNode(created.id)
    }
    return Boolean(created)
  }

  if (item.kind === 'guideboard') {
    const name = getNextViewportPlacementName('Guideboard')
    const created = await sceneStore.addModelNode({
      object: buildGuideboardPlacementRoot(name),
      nodeType: 'Guideboard',
      name,
      position: basePoint.clone(),
      rotation,
      parentId: parentId ?? undefined,
      snapToGrid: false,
      editorFlags: {
        ignoreGridSnapping: true,
      },
    })
    if (created) {
      const primaryMaterial = created.materials?.[0] ?? null
      if (primaryMaterial) {
        sceneStore.updateNodeMaterialProps(created.id, primaryMaterial.id, { side: 'double' })
      }
      const guideboardComponent = created.components?.[GUIDEBOARD_COMPONENT_TYPE] ?? sceneStore.addNodeComponent(created.id, GUIDEBOARD_COMPONENT_TYPE)?.component
      if (guideboardComponent && (guideboardComponent.props as { initiallyVisible?: boolean } | undefined)?.initiallyVisible !== false) {
        sceneStore.updateNodeComponentProps(created.id, guideboardComponent.id, { initiallyVisible: false })
      }
      ensureBehaviorComponentForNode(created.id)
    }
    return Boolean(created)
  }

  if (findSceneNode(sceneStore.nodes, PROTAGONIST_NODE_ID)) {
    finishViewportPlacementAfterCommit(item)
    return false
  }

  const name = 'Protagonist'
  const created = await sceneStore.addModelNode({
    nodeId: PROTAGONIST_NODE_ID,
    object: buildProtagonistPlacementRoot(name),
    nodeType: 'Capsule',
    name,
    position: basePoint.clone(),
    rotation,
    snapToGrid: false,
    editorFlags: {
      editorOnly: true,
      ignoreGridSnapping: true,
    },
  })
  if (created && !created.components?.[PROTAGONIST_COMPONENT_TYPE]) {
    sceneStore.addNodeComponent(created.id, PROTAGONIST_COMPONENT_TYPE)
  }
  if (created) {
    finishViewportPlacementAfterCommit(item)
  }
  return Boolean(created)
}

function handleActivateGroundTab(tab: GroundPanelTab) {
  terrainStore.setGroundPanelTab(tab)
}

function activateGroundBuildToolFromPanel(tool: GroundBuildTool) {
  if (buildToolsDisabled.value || !hasGroundNode.value) {
    return
  }
  if (activeBuildTool.value === tool) {
    return
  }
  handleBuildToolChange(tool)
}

function handleGroundBrushRadiusUpdate(value: number) {
  const next = Number(value)
  terrainStore.brushRadius = Number.isFinite(next) ? Math.min(50, Math.max(0.1, next)) : terrainStore.brushRadius
}

function handleGroundBrushStrengthUpdate(value: number) {
  const next = Number(value)
  terrainStore.brushStrength = Number.isFinite(next) ? Math.min(10, Math.max(0.1, next)) : terrainStore.brushStrength
}

function handleGroundBrushDepthUpdate(value: number) {
  const next = Number(value)
  terrainStore.brushDepth = Number.isFinite(next) ? Math.min(50, Math.max(0.1, next)) : terrainStore.brushDepth
}

function handleGroundBrushSlopeUpdate(value: number) {
  const next = Number(value)
  terrainStore.brushSlope = Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : terrainStore.brushSlope
}

function handleGroundBrushShapeUpdate(value: 'circle' | 'polygon') {
  terrainStore.brushShape = value
}

function handleGroundBrushOperationUpdate(value: GroundSculptOperation | null) {
  if (value) {
    activateGroundBuildToolFromPanel('terrain')
  }
  terrainStore.setBrushOperation(value)
}

function handleGroundNoiseStrengthUpdate(value: number) {
  groundNoiseStrength.value = clampGroundNoiseStrength(Number(value))
}

function handleGroundNoiseModeUpdate(value: GroundGenerationMode) {
  groundNoiseMode.value = value
}

function handleGroundPaintAssetUpdate(value: ProjectAsset | null) {
  if (value) {
    activateGroundBuildToolFromPanel('paint')
  }
  terrainStore.setPaintSelection(value)
}

function handleGroundPaintSettingsUpdate(value: TerrainPaintBrushSettings) {
  terrainStore.setPaintBrushSettings(value)
}

function handleGroundScatterCategoryUpdate(value: TerrainScatterCategory) {
  terrainStore.setScatterCategory(value)
}

function handleGroundScatterBrushRadiusUpdate(value: number) {
  terrainStore.setScatterBrushRadius(Number(value))
}

function handleGroundScatterBrushShapeUpdate(value: TerrainScatterBrushShape) {
  terrainStore.setScatterBrushShape(value)
}

function handleGroundScatterRegularPolygonSidesUpdate(value: number) {
  terrainStore.setScatterRegularPolygonSides(Number(value))
}

function handleGroundScatterSpacingUpdate(value: number) {
  terrainStore.setScatterSpacing(Number(value))
}

function handleGroundScatterDensityPercentUpdate(value: number) {
  terrainStore.setScatterDensityPercent(Number(value))
}

function handleGroundScatterAssetSelect(payload: { category: TerrainScatterCategory; asset: ProjectAsset; providerAssetId: string }) {
  activateGroundBuildToolFromPanel('scatter')
  terrainStore.setScatterCategory(payload.category)
  terrainStore.setScatterSelection({ asset: payload.asset, providerAssetId: payload.providerAssetId })
}

function handleSelectFloorBuildShape(shape: FloorBuildShape) {
  // Switching shapes should start from a clean slate.
  floorBuildTool.cancel()
  buildToolsStore.setFloorBuildShape(shape, { activate: true })

  // Selecting a shape explicitly activates the floor build tool.
  // Match toolbar behavior: entering a build tool clears selection.
  sceneStore.setSelection([])
}

function handleSelectLandformBuildShape(shape: LandformBuildShape) {
  landformBuildTool.cancel()
  buildToolsStore.setLandformBuildShape(shape, { activate: true })
  sceneStore.setSelection([])
}

function handleSelectWallBuildShape(shape: WallBuildShape) {
  // Switching shapes should start from a clean slate.
  wallBuildTool.cancel()
  buildToolsStore.setWallBuildShape(shape, { activate: true })

  // Match toolbar behavior: entering a build tool clears selection.
  sceneStore.setSelection([])
}

function handleWallRegularPolygonSidesUpdate(value: number) {
  buildToolsStore.setWallRegularPolygonSides(value)
}

function handleFloorRegularPolygonSidesUpdate(value: number) {
  buildToolsStore.setFloorRegularPolygonSides(value)
}

function handleLandformRegularPolygonSidesUpdate(value: number) {
  buildToolsStore.setLandformRegularPolygonSides(value)
}

function clearAutoOverlayDialog(): void {
  autoOverlayDialogOpen.value = false
  autoOverlayPlan.value = null
  autoOverlaySubmitting.value = false
}

function setAutoOverlayHoverNodeId(nodeId: string | null): void {
  if (autoOverlayHoverNodeId.value === nodeId) {
    return
  }
  autoOverlayHoverNodeId.value = nodeId
  updateOutlineSelectionTargets()
}

function clearAutoOverlayHoverIndicator(): void {
  autoOverlayHoverIndicator.visible = false
  setAutoOverlayHoverNodeId(null)
}

function isAutoOverlayBlockedBySelectionContext(targetTool: BuildTool | null): boolean {
  const context = uiStore.activeSelectionContext
  if (!context) {
    return false
  }
  if (context === 'build-tool:wall' && targetTool === 'wall') {
    return false
  }
  if (context === 'build-tool:floor' && targetTool === 'floor') {
    return false
  }
  if (context === 'build-tool:water' && targetTool === 'water') {
    return false
  }
  return true
}

function hasAutoOverlayHandleConflict(event: PointerEvent): boolean {
  if (activeBuildTool.value === 'wall' && isSelectedWallEditMode() && selectedNodeIsWall.value) {
    ensureWallEndpointHandlesForSelectedNode()
    if (pickWallEndpointHandleAtPointer(event)) {
      return true
    }
  }

  if (activeBuildTool.value === 'floor' && isSelectedFloorEditMode() && selectedNodeIsFloor.value) {
    ensureFloorVertexHandlesForSelectedNode()
    if (pickFloorVertexHandleAtPointer(event)) {
      return true
    }

    if (isSelectedFloorCircleEditMode()) {
      ensureFloorCircleHandlesForSelectedNode()
      if (pickFloorCircleHandleAtPointer(event)) {
        return true
      }
    }

    const selectedNode = sceneStore.selectedNode ?? null
    const runtimeObject = selectedNode ? objectMap.get(selectedNode.id) ?? null : null
    if (selectedNode?.dynamicMesh?.type === 'Floor' && runtimeObject && pickFloorEdgeAtPointer(event, selectedNode, runtimeObject)) {
      return true
    }
  }

  if (activeBuildTool.value === 'water' && isSelectedWaterEditMode() && selectedNodeIsWater.value) {
    ensureWaterCircleHandlesForSelectedNode()
    if (pickWaterCircleHandleAtPointer(event)) {
      return true
    }

    ensureWaterVertexHandlesForSelectedNode()
    if (pickWaterVertexHandleAtPointer(event)) {
      return true
    }

    const selectedNode = sceneStore.selectedNode ?? null
    const runtimeObject = selectedNode ? objectMap.get(selectedNode.id) ?? null : null
    if (
      selectedNode
      && runtimeObject
      && isWaterSurfaceNode(selectedNode)
      && pickWaterContourEdgeAtPointer(event, selectedNode, runtimeObject)
    ) {
      return true
    }
  }

  return false
}

function resolveAutoOverlayPlanForEvent(event: PointerEvent): AutoOverlayBuildPlan | null {
  const targetTool = activeBuildTool.value
  if (targetTool !== 'wall' && targetTool !== 'floor' && targetTool !== 'water') {
    return null
  }
  if (isTemporaryNavigationOverrideActive()) {
    return null
  }
  if (nodePickerStore.isActive || isAutoOverlayBlockedBySelectionContext(targetTool)) {
    return null
  }
  if (targetTool === 'wall' && wallDoorSelectModeActive.value) {
    return null
  }
  if (hasAutoOverlayHandleConflict(event)) {
    return null
  }

  const node = resolveAutoOverlayReferenceNodeForEvent(event)
  if (!node) {
    return null
  }

  return resolveAutoOverlayBuildPlanForReferenceNode(node, targetTool)
}

function resolveAutoOverlayReferenceNodeForEvent(event: PointerEvent): SceneNode | null {
  const hit = pickNodeAtPointer(event)
  if (!hit) {
    return null
  }

  const node = resolveSceneNodeById(hit.nodeId)
  if (!node || (node.dynamicMesh?.type !== 'Floor' && node.dynamicMesh?.type !== 'Landform' && node.dynamicMesh?.type !== 'Wall' && !isWaterSurfaceNode(node))) {
    return null
  }
  if (node.locked || sceneStore.isNodeSelectionLocked(node.id)) {
    return null
  }

  return node
}

function resolveAutoOverlayBuildPlanForReferenceNode(
  node: SceneNode,
  targetTool: 'floor' | 'wall' | 'water',
): AutoOverlayBuildPlan | null {
  return resolveAutoOverlayBuildPlan({
    referenceNode: node,
    runtimeObject: objectMap.get(node.id) ?? null,
    targetTool,
  })
}

function scatterAutoOverlayEnabled(): boolean {
  return activeBuildTool.value === 'scatter'
    && !scatterEraseModeActive.value
    && Boolean(terrainStore.scatterSelectedAsset)
}

function resolveScatterAutoOverlayPlanForEvent(event: PointerEvent): AutoOverlayBuildPlan | null {
  if (!scatterAutoOverlayEnabled()) {
    return null
  }
  if (isTemporaryNavigationOverrideActive() || nodePickerStore.isActive) {
    return null
  }

  const node = resolveAutoOverlayReferenceNodeForEvent(event)
  if (!node) {
    return null
  }

  const targetTool = node.dynamicMesh?.type === 'Floor' || node.dynamicMesh?.type === 'Landform'
    ? 'floor'
    : (node.dynamicMesh?.type === 'Wall' ? 'wall' : 'water')
  return resolveAutoOverlayBuildPlanForReferenceNode(node, targetTool)
}

function updateAutoOverlayHoverIndicator(event: PointerEvent): void {
  const hasActiveDrag = Boolean(
    roadVertexDragState
    || floorVertexDragState
    || regionContourVertexDragState
    || landformContourVertexDragState
    || displayBoardCornerDragState
    || waterContourVertexDragState
    || waterCircleCenterDragState
    || waterCircleRadiusDragState
    || waterEdgeDragState
    || floorThicknessDragState
    || floorCircleCenterDragState
    || floorCircleRadiusDragState
    || wallCircleCenterDragState
    || wallCircleRadiusDragState
    || wallEndpointDragState
    || wallJointDragState
    || wallHeightDragState,
  )

  if (
    event.pointerType !== 'mouse'
    || autoOverlayDialogOpen.value
    || hasActiveDrag
    || !(event.ctrlKey || event.metaKey)
    || !isStrictPointOnCanvas(event.clientX, event.clientY)
  ) {
    clearAutoOverlayHoverIndicator()
    return
  }

  const scatterPlan = resolveScatterAutoOverlayPlanForEvent(event)
  const plan = scatterPlan ?? resolveAutoOverlayPlanForEvent(event)
  if (!plan?.supported || !surfaceRef.value) {
    clearAutoOverlayHoverIndicator()
    return
  }

  const rect = surfaceRef.value.getBoundingClientRect()
  setAutoOverlayHoverNodeId(plan.referenceNodeId)
  autoOverlayHoverIndicator.visible = true
  autoOverlayHoverIndicator.x = event.clientX - rect.left + 14
  autoOverlayHoverIndicator.y = event.clientY - rect.top + 18
  autoOverlayHoverIndicator.label = scatterPlan
    ? `智能散布 ${plan.referenceType}`
    : `自动铺设 ${plan.targetTool}`
}

type AutoOverlayContourMetrics = {
  points: Array<{ x: number; z: number }>
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  centroidX: number
  centroidZ: number
  avgEdgeLength: number
}

function collectSceneNodesRecursive(nodes: SceneNode[] | undefined, out: SceneNode[]): void {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return
  }
  for (const node of nodes) {
    out.push(node)
    const children = (node as SceneNode & { children?: SceneNode[] }).children
    if (Array.isArray(children) && children.length) {
      collectSceneNodesRecursive(children, out)
    }
  }
}

function buildAutoOverlayContourMetrics(worldPoints: Array<{ x: number; z: number }>): AutoOverlayContourMetrics | null {
  if (!Array.isArray(worldPoints) || worldPoints.length < 3) {
    return null
  }
  const points = worldPoints
    .map((point) => ({ x: Number(point?.x), z: Number(point?.z) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.z))
  if (points.length < 3) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  let perimeter = 0
  let signedArea = 0
  let centroidNumeratorX = 0
  let centroidNumeratorZ = 0

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    minX = Math.min(minX, current.x)
    maxX = Math.max(maxX, current.x)
    minZ = Math.min(minZ, current.z)
    maxZ = Math.max(maxZ, current.z)

    const dx = next.x - current.x
    const dz = next.z - current.z
    perimeter += Math.sqrt((dx * dx) + (dz * dz))

    const cross = current.x * next.z - next.x * current.z
    signedArea += cross
    centroidNumeratorX += (current.x + next.x) * cross
    centroidNumeratorZ += (current.z + next.z) * cross
  }

  const area = signedArea * 0.5
  const absArea = Math.abs(area)
  let centroidX = (minX + maxX) * 0.5
  let centroidZ = (minZ + maxZ) * 0.5
  if (absArea > 1e-8) {
    centroidX = centroidNumeratorX / (6 * area)
    centroidZ = centroidNumeratorZ / (6 * area)
  }

  return {
    points,
    minX,
    maxX,
    minZ,
    maxZ,
    centroidX,
    centroidZ,
    avgEdgeLength: perimeter / points.length,
  }
}

function autoOverlayBoundsIntersect(a: AutoOverlayContourMetrics, b: AutoOverlayContourMetrics): boolean {
  return !(a.maxX < b.minX || b.maxX < a.minX || a.maxZ < b.minZ || b.maxZ < a.minZ)
}

function distancePointToSegmentSq2D(
  point: { x: number; z: number },
  start: { x: number; z: number },
  end: { x: number; z: number },
): number {
  const sx = start.x
  const sz = start.z
  const ex = end.x
  const ez = end.z
  const vx = ex - sx
  const vz = ez - sz
  const wx = point.x - sx
  const wz = point.z - sz
  const lenSq = (vx * vx) + (vz * vz)
  if (lenSq <= 1e-8) {
    const dx = point.x - sx
    const dz = point.z - sz
    return (dx * dx) + (dz * dz)
  }
  const t = Math.max(0, Math.min(1, ((wx * vx) + (wz * vz)) / lenSq))
  const cx = sx + (vx * t)
  const cz = sz + (vz * t)
  const dx = point.x - cx
  const dz = point.z - cz
  return (dx * dx) + (dz * dz)
}

function meanPointToContourDistance(points: Array<{ x: number; z: number }>, contour: Array<{ x: number; z: number }>): number {
  if (!points.length || contour.length < 2) {
    return Number.POSITIVE_INFINITY
  }
  let sum = 0
  for (const point of points) {
    let bestSq = Number.POSITIVE_INFINITY
    for (let index = 0; index < contour.length; index += 1) {
      const start = contour[index]!
      const end = contour[(index + 1) % contour.length]!
      const distSq = distancePointToSegmentSq2D(point, start, end)
      if (distSq < bestSq) {
        bestSq = distSq
      }
    }
    sum += Math.sqrt(bestSq)
  }
  return sum / points.length
}

function contoursLikelyOverlap(a: AutoOverlayContourMetrics, b: AutoOverlayContourMetrics): boolean {
  if (!autoOverlayBoundsIntersect(a, b)) {
    return false
  }

  const centroidDx = a.centroidX - b.centroidX
  const centroidDz = a.centroidZ - b.centroidZ
  const centroidDistance = Math.sqrt((centroidDx * centroidDx) + (centroidDz * centroidDz))
  const aDiag = Math.sqrt(((a.maxX - a.minX) ** 2) + ((a.maxZ - a.minZ) ** 2))
  const bDiag = Math.sqrt(((b.maxX - b.minX) ** 2) + ((b.maxZ - b.minZ) ** 2))
  const maxComparableCentroidDistance = Math.max(0.35, Math.min(aDiag, bDiag) * 0.5)
  if (centroidDistance > maxComparableCentroidDistance) {
    return false
  }

  const forward = meanPointToContourDistance(a.points, b.points)
  const backward = meanPointToContourDistance(b.points, a.points)
  const distanceThreshold = Math.max(0.12, Math.min(a.avgEdgeLength, b.avgEdgeLength) * 0.35)
  return forward <= distanceThreshold && backward <= distanceThreshold
}

function isNodeMatchingAutoOverlayTarget(node: SceneNode, targetTool: 'floor' | 'wall' | 'water'): boolean {
  if (targetTool === 'floor') {
    return node.dynamicMesh?.type === 'Floor'
  }
  if (targetTool === 'wall') {
    return node.dynamicMesh?.type === 'Wall'
  }
  return isWaterSurfaceNode(node)
}

function detectAutoOverlayOverlap(
  worldPoints: Array<{ x: number; y: number; z: number }>,
  existingContours: AutoOverlayContourMetrics[],
): boolean {
  const metrics = buildAutoOverlayContourMetrics(worldPoints)
  if (!metrics) {
    return false
  }
  return existingContours.some((existing) => contoursLikelyOverlap(metrics, existing))
}

function roundAutoOverlayMargin(value: number): number {
  return Math.round(value * 100) / 100
}

function resolveAutoOverlaySuggestedMargins(plan: AutoOverlayBuildPlan): { horiz: number; vert: number } {
  if (!plan.supported || !Array.isArray(plan.worldPoints) || plan.worldPoints.length < 3) {
    return { horiz: 0, vert: 0 }
  }

  const allNodes: SceneNode[] = []
  collectSceneNodesRecursive(sceneStore.nodes, allNodes)

  const existingContours: AutoOverlayContourMetrics[] = []
  for (const node of allNodes) {
    if (node.id === plan.referenceNodeId || !isNodeMatchingAutoOverlayTarget(node, plan.targetTool)) {
      continue
    }
    if (node.locked || sceneStore.isNodeSelectionLocked(node.id)) {
      continue
    }
    const existingPlan = resolveAutoOverlayBuildPlan({
      referenceNode: node,
      runtimeObject: objectMap.get(node.id) ?? null,
      targetTool: plan.targetTool,
    })
    if (!existingPlan?.supported || existingPlan.worldPoints.length < 3) {
      continue
    }
    const metrics = buildAutoOverlayContourMetrics(existingPlan.worldPoints)
    if (metrics) {
      existingContours.push(metrics)
    }
  }

  if (!existingContours.length) {
    return { horiz: 0, vert: 0 }
  }
  if (!detectAutoOverlayOverlap(plan.worldPoints, existingContours)) {
    return { horiz: 0, vert: 0 }
  }

  const step = 0.25
  const maxSteps = 24

  for (let stepIndex = 1; stepIndex <= maxSteps; stepIndex += 1) {
    const magnitude = roundAutoOverlayMargin(step * stepIndex)
    // Default auto-detection should prefer inward inset and avoid outward spread.
    const horiz = roundAutoOverlayMargin(-magnitude)
    const candidate = offsetPolyline(plan.worldPoints, horiz, 0, { closed: plan.closedPath })
    if (!detectAutoOverlayOverlap(candidate, existingContours)) {
      return { horiz, vert: 0 }
    }
  }

  for (let stepIndex = 1; stepIndex <= Math.min(12, maxSteps); stepIndex += 1) {
    const magnitude = roundAutoOverlayMargin(step * stepIndex)
    for (const sign of [1, -1]) {
      const vert = roundAutoOverlayMargin(sign * magnitude)
      const candidate = offsetPolyline(plan.worldPoints, 0, vert, { closed: plan.closedPath })
      if (!detectAutoOverlayOverlap(candidate, existingContours)) {
        return { horiz: 0, vert }
      }
    }
  }

  return { horiz: 0, vert: 0 }
}

function tryOpenAutoOverlayDialog(event: PointerEvent): boolean {
  if (event.button !== 0 || isTemporaryNavigationOverrideActive() || !(event.ctrlKey || event.metaKey)) {
    return false
  }
  const plan = resolveAutoOverlayPlanForEvent(event)
  if (!plan) {
    return false
  }

  clearAutoOverlayHoverIndicator()
  const suggestedMargins = resolveAutoOverlaySuggestedMargins(plan)
  autoOverlayHorizMargin.value = suggestedMargins.horiz
  autoOverlayVertMargin.value = suggestedMargins.vert
  autoOverlayPlan.value = plan
  autoOverlayDialogOpen.value = true
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  return true
}

function resolveAutoOverlayWallBrush() {
  const presetAssetId = typeof wallBrushPresetAssetId.value === 'string' && wallBrushPresetAssetId.value.trim().length
    ? wallBrushPresetAssetId.value.trim()
    : null
  const presetData = wallBrushPresetData.value
  const rawWallProps = (presetData?.wallProps ?? null) as Partial<WallComponentProps> | null
  const toFiniteOrUndefined = (value: unknown): number | undefined => {
    const numeric = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(numeric) ? numeric : undefined
  }
  return {
    presetAssetId,
    presetData,
    wallComponentProps: rawWallProps,
    dimensions: normalizeWallDimensionsForViewport({
      height: toFiniteOrUndefined(rawWallProps?.height),
      width: toFiniteOrUndefined(rawWallProps?.width),
      thickness: toFiniteOrUndefined(rawWallProps?.thickness),
    }),
    bodyAssetId: typeof rawWallProps?.bodyAssetId === 'string' && rawWallProps.bodyAssetId.trim().length
      ? rawWallProps.bodyAssetId.trim()
      : null,
  }
}

async function handleConfirmAutoOverlay(): Promise<void> {
  const plan = autoOverlayPlan.value
  if (!plan || !plan.supported || autoOverlaySubmitting.value) {
    return
  }
  // Compute world points with user-specified horizontal/vertical margins.

  autoOverlaySubmitting.value = true
  try {
    const horiz = Number(autoOverlayHorizMargin.value || 0)
    const vert = Number(autoOverlayVertMargin.value || 0)
    const adjustedPoints = offsetPolyline(plan.worldPoints, horiz, vert, { closed: plan.closedPath })

    if (plan.targetTool === 'wall') {
      const brush = resolveAutoOverlayWallBrush()
      const targetShape = plan.targetBuildShape as WallBuildShape
      buildToolsStore.setWallBuildShape(targetShape, { activate: true })
      const wallSegments = plan.closedPath
        ? buildClosedWallSegmentsFromWorldPoints(adjustedPoints)
        : buildOpenWallSegmentsFromWorldPoints(adjustedPoints)

      const created = sceneStore.createWallNode({
        segments: wallSegments,
        closed: plan.closedPath,
        dimensions: brush.dimensions,
        bodyAssetId: brush.bodyAssetId,
        wallComponentProps: brush.wallComponentProps,
        wallPresetData: brush.presetData,
      })

      if (created) {
        sceneStore.updateNodeUserData(
          created.id,
          mergeUserDataWithDynamicMeshBuildShape(created.userData, targetShape),
        )
        if (brush.presetAssetId) {
          try {
            await sceneStore.applyWallPresetToNode(created.id, brush.presetAssetId, brush.presetData)
          } catch (error) {
            console.warn('Failed to apply auto overlay wall preset', brush.presetAssetId, error)
          }
        }
        sceneStore.selectNode(created.id)
      }
    } else if (plan.targetTool === 'floor') {
      const targetShape = plan.targetBuildShape as FloorBuildShape
      buildToolsStore.setFloorBuildShape(targetShape, { activate: true })
      const created = sceneStore.createFloorNode({
        points: adjustedPoints,
        floorPresetData: floorBrushPresetData.value,
      })

      if (created) {
        sceneStore.updateNodeUserData(
          created.id,
          mergeUserDataWithDynamicMeshBuildShape(created.userData, targetShape),
        )
        const runtimeObject = objectMap.get(created.id) ?? null
        if (runtimeObject) {
          refreshFloorRuntimeMaterials(created.id, runtimeObject)
        }
        sceneStore.selectNode(created.id)
      }
    } else {
      const targetShape = plan.targetBuildShape as WaterBuildShape
      buildToolsStore.setWaterBuildShape(targetShape, { activate: true })
      const created = sceneStore.createWaterSurfaceMeshNode({
        points: adjustedPoints,
        buildShape: targetShape,
      })

      if (created) {
        sceneStore.updateNodeUserData(
          created.id,
          mergeUserDataWithWaterBuildShape(created.userData, targetShape),
        )
        sceneStore.selectNode(created.id)
      }
    }
  } finally {
    clearAutoOverlayDialog()
  }
}

function handleSelectWaterBuildShape(shape: WaterBuildShape) {
  waterBuildTool.cancel()
  buildToolsStore.setWaterBuildShape(shape, { activate: true })
  sceneStore.setSelection([])
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
  relativeOffset: THREE.Vector3 | null
  startTime: number
  duration: number
}

let cameraTransitionState: CameraTransitionState | null = null
const SHIFT_ORBIT_FOCUS_TRANSITION_MS = 260

let transformGroupState: TransformGroupState | null = null
let pendingSceneGraphSync = false


function handleViewportOverlayResize() {
  scheduleToolbarUpdate()
  updateGroundSelectionToolbarPosition()
  gizmoControls?.update()
}



const {
  syncInstancedTransform,
  primeInstancedTransform,
  attachInstancedMesh: attachInstancedMeshBase,
  clearInstancedMeshes
} = useInstancedMeshes(
  instancedMeshGroup,
  instancedMeshes,
  {
    syncInstancedOutlineEntryTransform,
    resolveSceneNodeById: (nodeId: string) => findSceneNode(sceneStore.nodes, nodeId),
    syncInstancedTransformOverride: ({ nodeId, object, baseMatrix, assetId }) => {
      if (wallRenderer.syncWallDragInstancedMatrices(nodeId, baseMatrix)) {
        return true
      }

      if (syncWallInstancedBindingsForObject(object)) {
        return true
      }

      const node = findSceneNode(sceneStore.nodes, nodeId)
      if (node && assetId) {
        const layout = clampSceneNodeInstanceLayout(node.instanceLayout ?? null)
        if (layout && layout.mode === 'grid') {
          const templateAssetId = resolveInstanceLayoutTemplateAssetId(layout, node.sourceAssetId)
          if (templateAssetId) {
            syncInstanceLayoutInstancedMatrices({
              nodeId,
              object,
              assetId: typeof assetId === 'string' ? assetId : templateAssetId,
              layout,
              baseMatrixWorld: baseMatrix,
            })
            return true
          }
        }
      }

      return false
    },
  }
)

function attachInstancedMesh(mesh: THREE.InstancedMesh): void {
  attachInstancedMeshBase(mesh)
  sceneCsmShadowRuntime?.registerObject(mesh)
}

const instancedCullingFrustum = new THREE.Frustum()
const instancedCullingProjView = new THREE.Matrix4()
const instancedCullingBox = new THREE.Box3()
const instancedCullingSphere = new THREE.Sphere()
const instancedPositionHelper = new THREE.Vector3()
const instancedQuaternionHelper = new THREE.Quaternion()
const instancedScaleHelper = new THREE.Vector3()
const instancedCullingFrustumCuller = createInstancedBvhFrustumCuller()

const pendingModelPreloads = new Map<string, Promise<void>>()

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
  if (pendingModelPreloads.has(assetId)) {
    await pendingModelPreloads.get(assetId)
    return
  }

  const task = (async () => {
    const resolved = await sceneStore.resolvePlaceableAsset(assetId).catch(() => null)
    const asset = resolved?.modelAsset ?? null
    if (!asset) {
      return
    }
    if (getCachedModelObject(asset.id)) {
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
    await getOrLoadModelObject(asset.id, () => loadObjectFromFile(file, asset.extension ?? undefined))
    assetCacheStore.releaseInMemoryBlob(asset.id)
    ensureInstancedMeshesRegistered(asset.id)
  })()
    .catch((error) => {
      console.warn('[SceneViewport] Failed to preload model asset', assetId, error)
    })
    .finally(() => {
      pendingModelPreloads.delete(assetId)
    })

  pendingModelPreloads.set(assetId, task)
  await task
}

type InstancedLodTarget = {
  kind: 'model' | 'billboard',
  assetId: string
}

function resolveDesiredLodTarget(node: SceneNode, object: THREE.Object3D): InstancedLodTarget | null {
  // 兼容 instanceLayout 模板 assetId
  const templateAssetIdRaw = object.userData?.__harmonyInstanceLayoutTemplateAssetId
  const templateAssetId = typeof templateAssetIdRaw === 'string' ? templateAssetIdRaw.trim() : ''
  if (templateAssetId) {
    return { kind: 'model', assetId: templateAssetId }
  }
  // LOD 组件
  const component = node.components?.[LOD_COMPONENT_TYPE] as SceneNodeComponentState<LodComponentProps> | undefined
  if (component && component.enabled) {
    const props = clampLodComponentProps(component.props)
    // FIX: resolveLodRenderTarget expects a single LodLevelDefinition, not an array
    const target = props.levels && props.levels.length > 0 ? resolveLodRenderTarget(props.levels[0]) : undefined
    if (target && target.kind && target.assetId) {
      return { kind: target.kind, assetId: target.assetId }
    }
  }
  // 兜底：sourceAssetId
  const sourceAssetId = typeof node.sourceAssetId === 'string' ? node.sourceAssetId.trim() : ''
  if (sourceAssetId) {
    return { kind: 'model', assetId: sourceAssetId }
  }
  // 兜底：当前 assetId
  const currentAssetIdRaw = object.userData?.instancedAssetId
  const currentAssetId = typeof currentAssetIdRaw === 'string' ? currentAssetIdRaw.trim() : ''
  if (currentAssetId) {
    return { kind: 'model', assetId: currentAssetId }
  }
  return null
}

function applyInstancedLodSwitch(nodeId: string, object: THREE.Object3D, target: InstancedLodTarget): void {
  if (target.kind === 'model') {
    const cached = getCachedModelObject(target.assetId)
    if (!cached) {
      void ensureModelObjectCached(target.assetId)
      return
    }
    const node = resolveSceneNodeById(nodeId)
    const rawLayout = (node as unknown as { instanceLayout?: unknown } | null)?.instanceLayout
    const layout = rawLayout ? clampSceneNodeInstanceLayout(rawLayout) : ({ mode: 'single', templateAssetId: null } as const)
    const desiredCount = getInstanceLayoutCount(layout)
    const erased = layout.mode === 'grid' && Array.isArray((layout as any).erasedIndices) && (layout as any).erasedIndices.length
      ? new Set<number>((layout as any).erasedIndices as number[])
      : null
    releaseModelInstance(nodeId)
    const binding = allocateModelInstance(target.assetId, nodeId)
    if (!binding) {
      return
    }
    for (let index = 1; index < desiredCount; index += 1) {
      if (erased?.has(index)) {
        continue
      }
      const bindingId = getInstanceLayoutBindingId(nodeId, index)
      const extra = allocateModelInstanceBinding(target.assetId, bindingId, nodeId)
      if (!extra) {
        releaseModelInstance(nodeId)
        return
      }
    }
    const layoutBounds = computeInstanceLayoutLocalBoundingBox(layout as any, cached.boundingBox) ?? cached.boundingBox
    layoutBounds.getBoundingSphere(instancedCullingSphere)
    object.userData = {
      ...(object.userData ?? {}),
      instancedAssetId: target.assetId,
      instancedBounds: serializeBoundingBox(layoutBounds),
      instancedRenderKind: 'model',
    }
    object.userData.__harmonyInstancedRadius = instancedCullingSphere.radius
    object.userData.__harmonyCulled = false
    syncInstancedTransform(object)
    return
  }
  // billboard
  // 需要 source model 高度
  const node = resolveSceneNodeById(nodeId)
  const rawLayout = (node as unknown as { instanceLayout?: unknown } | null)?.instanceLayout
  const layout = rawLayout ? clampSceneNodeInstanceLayout(rawLayout) : ({ mode: 'single', templateAssetId: null } as const)
  const desiredCount = getInstanceLayoutCount(layout)
  const erased = layout.mode === 'grid' && Array.isArray((layout as any).erasedIndices) && (layout as any).erasedIndices.length
    ? new Set<number>((layout as any).erasedIndices as number[])
    : null
  // 取当前 userData 里的 sourceModelHeight
  const sourceModelHeight = object.userData?.billboardSourceModelHeight as number | undefined
  releaseBillboardInstance(nodeId)
  const binding = allocateBillboardInstance(target.assetId, nodeId)
  if (!binding) {
    return
  }
  for (let index = 1; index < desiredCount; index += 1) {
    if (erased?.has(index)) {
      continue
    }
    const bindingId = getInstanceLayoutBindingId(nodeId, index)
    const extra = allocateBillboardInstanceBinding(target.assetId, bindingId, nodeId)
    if (!extra) {
      releaseBillboardInstance(nodeId)
      return
    }
  }
  // billboard bounding box
  const aspect = getBillboardAspectRatio(target.assetId) || 1
  const height = sourceModelHeight || 1
  const width = height * aspect
  const layoutBounds = new THREE.Box3(
    new THREE.Vector3(-width / 2, 0, -0.01),
    new THREE.Vector3(width / 2, height, 0.01)
  )
  layoutBounds.getBoundingSphere(instancedCullingSphere)
  object.userData = {
    ...(object.userData ?? {}),
    instancedAssetId: target.assetId,
    instancedRenderKind: 'billboard',
    billboardSourceModelHeight: height,
    instancedBounds: serializeBoundingBox(layoutBounds),
  }
  object.userData.__harmonyInstancedRadius = instancedCullingSphere.radius
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

function syncInstancedBindingWithoutCulling(nodeId: string, object: THREE.Object3D, node: SceneNode): void {
  object.userData.__harmonyCulled = false
  const desiredTarget = resolveDesiredLodTarget(node, object)
  if (!desiredTarget) {
    return
  }
  const currentKind = object.userData.instancedRenderKind as 'model' | 'billboard' | undefined
  const currentAssetId = object.userData.instancedAssetId as string | undefined
  const needsModelRebind = desiredTarget.kind === 'model' && getModelInstanceBindingsForNode(nodeId).length === 0
  if (currentKind !== desiredTarget.kind || currentAssetId !== desiredTarget.assetId || needsModelRebind) {
    applyInstancedLodSwitch(nodeId, object, desiredTarget)
    return
  }
  syncInstancedTransform(object)
}

function updateInstancedCullingAndBinding(): void {
  if (!camera) {
    return
  }


  const candidateIds: string[] = []
  const candidateObjects = new Map<string, THREE.Object3D>()
  const candidateNodes = new Map<string, SceneNode>()

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
    candidateNodes.set(nodeId, node)
  })

  if (DISABLE_EDITOR_VIEWPORT_INSTANCED_CULLING) {
    candidateIds.forEach((nodeId) => {
      const object = candidateObjects.get(nodeId)
      const node = candidateNodes.get(nodeId)
      if (!object || !node) {
        return
      }
      syncInstancedBindingWithoutCulling(nodeId, object, node)
    })
    return
  }

  camera.updateMatrixWorld(true)
  instancedCullingProjView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  instancedCullingFrustum.setFromProjectionMatrix(instancedCullingProjView)

  candidateIds.sort()
  instancedCullingFrustumCuller.setIds(candidateIds)
  const visibleIds = instancedCullingFrustumCuller.updateAndQueryVisible(instancedCullingFrustum, (id: string, centerTarget: THREE.Vector3) => {
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
    const node = candidateNodes.get(nodeId)
    if (!node) {
      return
    }

    // const layout = clampSceneNodeInstanceLayout(node.instanceLayout ?? null)
    // const isGridInstanceLayout = Boolean(layout && layout.mode === 'grid')
    const isVisible = visibleIds.has(nodeId)
    if (!isVisible) {
      object.userData.__harmonyCulled = true
      releaseModelInstance(nodeId)
      return
    }

    syncInstancedBindingWithoutCulling(nodeId, object, node)
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

  if (isNodeExcludedFromSelectionBoundingBoxFallback(resolveSceneNodeById(primaryId))) {
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

  // enforce max pick distance
  try {
    const camPos = camera.position
    const dist = camPos.distanceTo(intersection)
    const maxPickDistance = getPickMaxDistance()
    if (Number.isFinite(maxPickDistance) && dist > maxPickDistance) {
      return null
    }
  } catch (e) {
    // if camera not available fall through
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
  applyWorldDeltaToSelectionDrag,
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
    primeInstancedTransform,
    updateGridHighlightFromObject,
    updateSelectionHighlights,
    updatePlaceholderOverlayPositions,
    gizmoControlsUpdate: () => gizmoControls?.update(),
    computeTransformPivotWorld,
    beforeEmitTransformUpdates: (nodeIds: string[]) => {
      const captured: CapturedLightTargetUpdate[] = []
      nodeIds.forEach((id) => {
        const entry = captureLightTargetWorldPosition(id)
        if (entry) {
          captured.push(entry)
        }
      })
      if (captured.length) {
        queueMicrotask(() => applyCapturedLightTargetUpdates(captured))
      }
    },
    onSelectionDragUpdates: (updates) => {
      previewLandformNodesDuringTransform(updates, 'translate')
    },
    resolveDropSurfaceHeight: ({ bounds, excludedNodeIds }) => {
      const excludedObjects = new Set<THREE.Object3D>()
      excludedNodeIds.forEach((id) => {
        const excludedObject = objectMap.get(id)
        if (excludedObject) {
          excludedObjects.add(excludedObject)
        }
      })

      const isExcludedIntersection = (candidate: THREE.Object3D | null): boolean => {
        let current: THREE.Object3D | null = candidate
        while (current) {
          if (excludedObjects.has(current)) {
            return true
          }
          current = current.parent ?? null
        }
        return false
      }

      const sizeX = Math.max(0, bounds.max.x - bounds.min.x)
      const sizeY = Math.max(0, bounds.max.y - bounds.min.y)
      const sizeZ = Math.max(0, bounds.max.z - bounds.min.z)
      const insetX = sizeX > 1e-3 ? Math.min(sizeX * 0.1, 0.05) : 0
      const insetZ = sizeZ > 1e-3 ? Math.min(sizeZ * 0.1, 0.05) : 0
      const minX = bounds.min.x + insetX
      const maxX = bounds.max.x - insetX
      const minZ = bounds.min.z + insetZ
      const maxZ = bounds.max.z - insetZ
      const centerX = (bounds.min.x + bounds.max.x) * 0.5
      const centerZ = (bounds.min.z + bounds.max.z) * 0.5
      const samplePoints = [
        new THREE.Vector2(centerX, centerZ),
        new THREE.Vector2(minX, minZ),
        new THREE.Vector2(minX, maxZ),
        new THREE.Vector2(maxX, minZ),
        new THREE.Vector2(maxX, maxZ),
      ]

      const rayOriginY = bounds.max.y + Math.max(sizeY, 1) + 0.1
      let bestSurfaceY: number | null = null

      for (const samplePoint of samplePoints) {
        dropRaycaster.set(
          new THREE.Vector3(samplePoint.x, rayOriginY, samplePoint.y),
          new THREE.Vector3(0, -1, 0),
        )

        const intersections = collectSceneIntersections({
          raycaster: dropRaycaster,
          maxDistance: Number.POSITIVE_INFINITY,
        })

        for (const intersection of intersections) {
          if (!intersection?.point) {
            continue
          }
          if (isEditorOnlyObject(intersection.object as THREE.Object3D)) {
            continue
          }
          if (isExcludedIntersection(intersection.object as THREE.Object3D)) {
            continue
          }

          const nodeId = resolveNodeIdFromIntersection(intersection)
          if (!nodeId || excludedNodeIds.has(nodeId) || sceneStore.isNodeSelectionLocked(nodeId)) {
            continue
          }

          const baseObject = objectMap.get(nodeId)
          if (!baseObject) {
            continue
          }
          if (!sceneStore.isNodeVisible(nodeId) || !isObjectWorldVisible(baseObject)) {
            continue
          }

          const hitY = intersection.point.y
          if (!Number.isFinite(hitY)) {
            continue
          }
          bestSurfaceY = bestSurfaceY === null ? hitY : Math.max(bestSurfaceY, hitY)
          break
        }
      }

      return bestSurfaceY
    },
    getVertexSnapDelta: ({ drag, event }) => {
      const active = isVertexSnapActiveEffective.value || event.shiftKey
      if (!active) {
        pendingVertexSnapResult = null
        clearVertexSnapMarkers()
        return null
      }

      const result = snapController.update({
        event,
        selectedNodeId: drag.nodeId,
        selectedObject: drag.object,
        active,
        excludeNodeIds: new Set(sceneStore.selectedNodeIds),
        pixelThresholdPx: vertexSnapThresholdPx.value,
      })
      pendingVertexSnapResult = result
      updateVertexSnapMarkers(result)

      // Deferred snap: only apply on pointer-up.
      return null
    },
  }
)

function commitSelectionDragTransformsWithDeferredVertexSnap(dragState: any) {
  const delta = pendingVertexSnapResult?.delta ?? null
  if (delta && delta.lengthSq() > 1e-12) {
    applyWorldDeltaToSelectionDrag(dragState, delta, { allowVertical: true })
  }
  commitSelectionDragTransforms(dragState)
  pendingVertexSnapResult = null
  clearVertexSnapMarkers()
}



function emitTransformUpdates(updates: TransformUpdatePayload[]) {
  if (!updates.length) {
    return
  }

  // Capture light targets before emitting; apply after the transform updates hit the store.
  const capturedLightTargets = captureLightTargetsForTransformUpdates(updates)

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

  applyCapturedLightTargetUpdates(capturedLightTargets)
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

function commitTransformControlUpdates(): TransformUpdatePayload[] {
  const updates = buildTransformControlUpdates()
  transformControlsDirty = false
  if (!updates.length) {
    return []
  }
  emitTransformUpdates(updates)
  return updates
}

function rotateActiveSelection(nodeId: string) {
  if (sceneStore.isNodeSelectionLocked(nodeId)) {
    return
  }

  const primaryObject = objectMap.get(nodeId)
  if (!primaryObject) {
    return
  }

  const selectionIds = sceneStore.selectedNodeIds
    .filter((id) => !!id && !sceneStore.isNodeSelectionLocked(id))
  if (!selectionIds.includes(nodeId)) {
    selectionIds.push(nodeId)
  }

  const { parentMap } = buildHierarchyMaps()
  const topLevelIds = filterTopLevelSelection(selectionIds, parentMap)
  if (!topLevelIds.length) {
    return
  }

  const rotateDeltaQuaternion = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    RIGHT_CLICK_ROTATION_STEP,
  )

  const centroidWorld = new THREE.Vector3()
  const pivotWorld = new THREE.Vector3()
  let count = 0
  for (const id of topLevelIds) {
    const object = objectMap.get(id)
    if (!object) {
      continue
    }
    computeTransformPivotWorld(object, pivotWorld)
    centroidWorld.add(pivotWorld)
    count += 1
  }
  if (count <= 0) {
    return
  }
  centroidWorld.multiplyScalar(1 / count)

  const updates: TransformUpdatePayload[] = []
  const worldPosition = new THREE.Vector3()
  const worldOffset = new THREE.Vector3()

  for (const id of topLevelIds) {
    const object = objectMap.get(id)
    if (!object) {
      continue
    }

    object.updateMatrixWorld(true)
    object.getWorldPosition(worldPosition)
    worldOffset.copy(worldPosition).sub(centroidWorld).applyQuaternion(rotateDeltaQuaternion)
    worldPosition.copy(centroidWorld).add(worldOffset)

    if (object.parent) {
      object.parent.updateMatrixWorld(true)
      object.parent.worldToLocal(worldPosition)
    }
    object.position.copy(worldPosition)
    object.quaternion.premultiply(rotateDeltaQuaternion)
    object.rotation.setFromQuaternion(object.quaternion)
    object.updateMatrixWorld(true)
    syncInstancedTransform(object, true)
    syncInstancedOutlineEntryTransform(id)

    updates.push({
      id,
      position: object.position,
      rotation: toEulerLike(object.rotation),
      scale: object.scale,
    })
  }

  if (!updates.length) {
    return
  }

  updateGridHighlightFromObject(primaryObject)
  updatePlaceholderOverlayPositions()
  updateSelectionHighlights()

  const capturedLightTargets = captureLightTargetsForTransformUpdates(updates)

  const transformPayload = updates.length === 1 ? updates[0]! : updates
  emit('updateNodeTransform', transformPayload)

  applyCapturedLightTargetUpdates(capturedLightTargets)
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

function setOrbitControlOverride(active: boolean) {
  if (isOrbitControlOverrideActive === active) {
    return
  }
  isOrbitControlOverrideActive = active
  updateMapControlsEnabled()
}

function isTemporaryNavigationOverrideActive(): boolean {
  return isAltOverrideActive || isSpaceOverrideActive
}

function activateTemporaryNavigationOverride(kind: 'alt' | 'space') {
  const wasActive = isTemporaryNavigationOverrideActive()
  if (kind === 'alt') {
    if (isAltOverrideActive) {
      return
    }
    isAltOverrideActive = true
  } else {
    if (isSpaceOverrideActive) {
      return
    }
    isSpaceOverrideActive = true
  }

  if (wasActive) {
    return
  }

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

function deactivateTemporaryNavigationOverride(kind: 'alt' | 'space') {
  if (kind === 'alt') {
    if (!isAltOverrideActive) {
      return
    }
    isAltOverrideActive = false
  } else {
    if (!isSpaceOverrideActive) {
      return
    }
    isSpaceOverrideActive = false
  }

  if (isTemporaryNavigationOverrideActive()) {
    return
  }

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

function activateAltOverride() {
  activateTemporaryNavigationOverride('alt')
}

function deactivateAltOverride() {
  deactivateTemporaryNavigationOverride('alt')
}

function activateSpaceOverride() {
  activateTemporaryNavigationOverride('space')
}

function deactivateSpaceOverride() {
  deactivateTemporaryNavigationOverride('space')
}

function isAssetPlacementActiveForOverride(): boolean {
  return Boolean(
    isDragHovering.value ||
    sceneStore.draggingAssetId ||
    assetPlacementClickSessionState ||
    nodePlacementClickSessionState ||
    hasPlacementPreviewActive()
  )
}

function activateVOverride() {
  if (isVOverrideActive) {
    return
  }
  if (!isAssetPlacementActiveForOverride()) {
    return
  }
  if (isTemporaryNavigationOverrideActive()) {
    return
  }
  isVOverrideActive = true
  vOverrideSnapshotTool = props.activeTool ?? null
  if (props.activeTool !== 'select') {
    emit('changeTool', 'select')
  }
}

function deactivateVOverride() {
  if (!isVOverrideActive) {
    return
  }
  isVOverrideActive = false
  const snapshot = vOverrideSnapshotTool
  vOverrideSnapshotTool = null
  if (isTemporaryNavigationOverrideActive()) {
    return
  }
  if (snapshot && props.activeTool !== snapshot) {
    emit('changeTool', snapshot)
  }
}

function handleVOverrideKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented) {
    return
  }
  if (event.repeat) {
    return
  }
  if (event.code !== 'KeyV') {
    return
  }
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return
  }
  if (isEditableKeyboardTarget(event.target)) {
    return
  }
  if (props.previewActive) {
    return
  }
  activateVOverride()
}

function handleVOverrideKeyUp(event: KeyboardEvent) {
  if (event.code !== 'KeyV') {
    return
  }
  deactivateVOverride()
}

function handleVOverrideBlur() {
  deactivateVOverride()
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

function handleSpaceOverrideKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented) {
    return
  }
  if (event.repeat) {
    return
  }
  if (event.code !== 'Space') {
    return
  }
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return
  }
  if (isEditableKeyboardTarget(event.target)) {
    return
  }
  if (props.previewActive) {
    return
  }
  event.preventDefault()
  activateSpaceOverride()
}

function handleSpaceOverrideKeyUp(event: KeyboardEvent) {
  if (event.code !== 'Space') {
    return
  }
  deactivateSpaceOverride()
}

function handleSpaceOverrideBlur() {
  deactivateSpaceOverride()
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
const transformPivotCurrentWorldQuaternion = new THREE.Quaternion()
const transformPivotCurrentWorldScale = new THREE.Vector3(1, 1, 1)
const transformParentWorldQuaternionHelper = new THREE.Quaternion()
const transformParentWorldQuaternionInverseHelper = new THREE.Quaternion()
const transformOffsetWorldHelper = new THREE.Vector3()
const transformOffsetLocalHelper = new THREE.Vector3()
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
const selectionHighlightQuaternionHelper = new THREE.Quaternion()
const selectionHighlightDirectionHelper = new THREE.Vector3()
const selectionHighlightEulerHelper = new THREE.Euler(0, 0, 0, 'YXZ')
const selectionHighlights = new Map<string, THREE.Group>()
const outlineSelectionTargets: THREE.Object3D[] = []
// Cached raycast targets for asset placement (mesh/model/prefab).
// Built from scene node Object3Ds (excluding editor helpers/pick proxies) and refreshed on scene patches.
const placementSurfaceTargets: THREE.Object3D[] = []
const placementSurfaceTargetsByNodeId = new Map<string, THREE.Object3D[]>()
let placementSurfaceTargetsDirty = true
let placementSurfaceTargetsInstancedRevision = -1

function shouldIncludePlacementSurfaceCandidate(object: THREE.Object3D): boolean {
  const userData = object.userData as Record<string, unknown> | undefined
  if (userData?.editorOnly) {
    return false
  }
  if (userData?.instancedPickProxy) {
    return false
  }

  const candidate = object as unknown as {
    isMesh?: boolean
    isSkinnedMesh?: boolean
    isInstancedMesh?: boolean
    count?: number
  }
  if (candidate.isInstancedMesh) {
    const count = typeof candidate.count === 'number' ? candidate.count : 0
    return count > 0
  }
  return Boolean(candidate.isMesh || candidate.isSkinnedMesh)
}

function collectPlacementSurfaceTargetsFromObject(object: THREE.Object3D, out: THREE.Object3D[], parentVisible = true) {
  const currentVisible = parentVisible && object.visible
  if (!currentVisible) {
    return
  }

  if (shouldIncludePlacementSurfaceCandidate(object)) {
    out.push(object)
  }

  const childCount = object.children.length
  for (let i = 0; i < childCount; i += 1) {
    const child = object.children[i]
    if (!child) {
      continue
    }
    collectPlacementSurfaceTargetsFromObject(child, out, currentVisible)
  }
}

function refreshPlacementSurfaceTargetsForNode(nodeId: string): void {
  const object = objectMap.get(nodeId) ?? null
  if (!object) {
    if (placementSurfaceTargetsByNodeId.has(nodeId)) {
      placementSurfaceTargetsByNodeId.delete(nodeId)
      placementSurfaceTargetsDirty = true
    }
    return
  }

  const targets: THREE.Object3D[] = []
  collectPlacementSurfaceTargetsFromObject(object, targets, true)

  if (targets.length) {
    placementSurfaceTargetsByNodeId.set(nodeId, targets)
  } else {
    placementSurfaceTargetsByNodeId.delete(nodeId)
  }
  placementSurfaceTargetsDirty = true
}

function rebuildPlacementSurfaceTargetsFull(): void {
  placementSurfaceTargetsByNodeId.clear()
  objectMap.forEach((_object, nodeId) => {
    refreshPlacementSurfaceTargetsForNode(nodeId)
  })
  placementSurfaceTargetsDirty = true
}

function ensurePlacementSurfaceTargetsUpToDate(): THREE.Object3D[] {
  const instancedRevision = instancedMeshRevision.value
  if (!placementSurfaceTargetsDirty && placementSurfaceTargetsInstancedRevision === instancedRevision) {
    return placementSurfaceTargets
  }

  placementSurfaceTargets.length = 0
  const seen = new Set<THREE.Object3D>()

  placementSurfaceTargetsByNodeId.forEach((targets) => {
    for (const target of targets) {
      if (!target || seen.has(target)) {
        continue
      }
      placementSurfaceTargets.push(target)
      seen.add(target)
    }
  })

  // Include instanced meshes that are managed outside the node object hierarchy.
  const instancedTargets = collectInstancedPickTargets()
  for (const mesh of instancedTargets) {
    if (!mesh || seen.has(mesh)) {
      continue
    }
    placementSurfaceTargets.push(mesh)
    seen.add(mesh)
  }

  placementSurfaceTargetsDirty = false
  placementSurfaceTargetsInstancedRevision = instancedRevision
  return placementSurfaceTargets
}

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

type InstancedPickProxyBoundsPayload = { min: [number, number, number]; max: [number, number, number] }

function isInstancedPickProxyBoundsPayload(value: unknown): value is InstancedPickProxyBoundsPayload {
  if (!value || typeof value !== 'object') {
    return false
  }
  const payload = value as Partial<InstancedPickProxyBoundsPayload>
  return Array.isArray(payload.min) && payload.min.length === 3 && Array.isArray(payload.max) && payload.max.length === 3
}

function computeTransformPivotWorld(object: THREE.Object3D, out: THREE.Vector3): void {
  const proxy = object.userData?.instancedPickProxy as THREE.Object3D | undefined
  const proxyBoundsCandidate = proxy?.userData?.instancedPickProxyBounds as unknown

  // PickProxyManager persists `instancedPickProxyBounds` in *object-local* space.
  // Convert object-local center -> world using the node object's transform.
  if (proxy && isInstancedPickProxyBoundsPayload(proxyBoundsCandidate)) {
    instancedPivotCenterLocalHelper.fromArray(proxyBoundsCandidate.min)
    instancedPivotWorldHelper.fromArray(proxyBoundsCandidate.max)
    instancedPivotCenterLocalHelper.add(instancedPivotWorldHelper).multiplyScalar(0.5)
    object.updateMatrixWorld(true)
    out.copy(instancedPivotCenterLocalHelper)
    object.localToWorld(out)
    return
  }

  // Fallback: use the proxy geometry center if bounds payload is unavailable.
  const meshProxy = proxy as unknown as THREE.Mesh | undefined
  const geometry = meshProxy?.geometry as THREE.BufferGeometry | undefined
  if (meshProxy && geometry) {
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox()
    }
    if (geometry.boundingBox && !geometry.boundingBox.isEmpty()) {
      instancedPivotCenterLocalHelper.copy(geometry.boundingBox.getCenter(instancedPivotCenterLocalHelper))
      meshProxy.updateMatrixWorld(true)
      out.copy(instancedPivotCenterLocalHelper)
      meshProxy.localToWorld(out)
      return
    }
  }

  object.getWorldPosition(out)
}

function updateTransformControlsPivotOverride(object: THREE.Object3D): void {
  const userData = object.userData ?? (object.userData = {})
  const proxy = userData.instancedPickProxy as THREE.Object3D | undefined

  // Only override pivot when the node has a PickProxy (instanced tiling path).
  if (!proxy) {
    delete (userData as any).transformControlsPivotWorld
    return
  }

  const existing = (userData as any).transformControlsPivotWorld as THREE.Vector3 | undefined
  const pivotWorld = existing && (existing as any).isVector3 ? existing : new THREE.Vector3()
  computeTransformPivotWorld(object, pivotWorld)
  ;(userData as any).transformControlsPivotWorld = pivotWorld
}

function syncDirectionalLightTargetPivotFromNode(
  nodeId: string,
  options: { orientForRotate?: boolean } = {},
): boolean {
  const node = sceneStore.getNodeById(nodeId)
  const config = node?.light
  if (!node || !config || config.type !== 'Directional') {
    return false
  }

  const target = config.target
  directionalLightPivotWorldPositionHelper.set(
    target?.x ?? node.position.x,
    target?.y ?? node.position.y,
    target?.z ?? node.position.z,
  )

  // Place pivot under rootGroup.
  rootGroup.updateMatrixWorld(true)
  directionalLightTargetPivotObject.position.copy(directionalLightPivotWorldPositionHelper)
  rootGroup.worldToLocal(directionalLightTargetPivotObject.position)

  // Initialize orientation for rotate so the gizmo aligns with the current light direction.
  // For translate, keep world-oriented axes.
  if (options.orientForRotate) {
    const container = objectMap.get(nodeId)
    if (container) {
      container.updateMatrixWorld(true)
      container.getWorldPosition(lightTargetWorldPositionHelper)
      directionalLightInitialDirectionWorldHelper
        .copy(directionalLightPivotWorldPositionHelper)
        .sub(lightTargetWorldPositionHelper)
      if (directionalLightInitialDirectionWorldHelper.lengthSq() < 1e-12) {
        directionalLightInitialDirectionWorldHelper.set(0, -1, 0)
      } else {
        directionalLightInitialDirectionWorldHelper.normalize()
      }

      directionalLightTargetPivotObject.up.set(0, 1, 0)
      directionalLightTargetPivotObject.lookAt(
        directionalLightPivotWorldPositionHelper.clone().add(directionalLightInitialDirectionWorldHelper),
      )
    } else {
      directionalLightTargetPivotObject.quaternion.identity()
      directionalLightTargetPivotObject.rotation.set(0, 0, 0)
    }
  } else {
    directionalLightTargetPivotObject.quaternion.identity()
    directionalLightTargetPivotObject.rotation.set(0, 0, 0)
  }

  directionalLightTargetPivotObject.scale.set(1, 1, 1)
  directionalLightTargetPivotObject.updateMatrixWorld(true)
  return true
}

function beginDirectionalLightTargetPivotInteraction(nodeId: string): void {
  const node = sceneStore.getNodeById(nodeId)
  const config = node?.light
  if (!node || !config || config.type !== 'Directional') {
    directionalLightPivotEditState = null
    return
  }

  const container = objectMap.get(nodeId)
  if (!container) {
    directionalLightPivotEditState = null
    return
  }

  directionalLightTargetPivotObject.updateMatrixWorld(true)
  directionalLightTargetPivotObject.getWorldPosition(directionalLightPivotWorldPositionHelper)
  directionalLightTargetPivotObject.getWorldQuaternion(directionalLightPivotWorldQuaternionHelper)

  container.updateMatrixWorld(true)
  container.getWorldPosition(lightTargetWorldPositionHelper)

  directionalLightInitialDirectionWorldHelper
    .copy(directionalLightPivotWorldPositionHelper)
    .sub(lightTargetWorldPositionHelper)
  if (directionalLightInitialDirectionWorldHelper.lengthSq() < 1e-12) {
    directionalLightInitialDirectionWorldHelper.set(0, -1, 0)
  } else {
    directionalLightInitialDirectionWorldHelper.normalize()
  }

  directionalLightPivotEditState = {
    nodeId,
    fixedLightWorldY: lightTargetWorldPositionHelper.y,
    initialPivotWorldQuaternion: directionalLightPivotWorldQuaternionHelper.clone(),
    initialDirectionWorld: directionalLightInitialDirectionWorldHelper.clone(),
    captureHistoryPending: true,
  }
}

function endDirectionalLightTargetPivotInteraction(): void {
  directionalLightPivotEditState = null
  directionalLightTargetPivotObject.quaternion.identity()
  directionalLightTargetPivotObject.rotation.set(0, 0, 0)
  directionalLightTargetPivotObject.updateMatrixWorld(true)
}

function buildTransformGroupState(primaryId: string | null): TransformGroupState | null {
  const selectedIds = sceneStore.selectedNodeIds
    .filter((id) => !!id && !sceneStore.isNodeSelectionLocked(id))

  if (primaryId && !sceneStore.isNodeSelectionLocked(primaryId) && !selectedIds.includes(primaryId)) {
    selectedIds.push(primaryId)
  }

  if (!selectedIds.length) {
    return null
  }

  const { parentMap } = buildHierarchyMaps()
  const topLevelIds = filterTopLevelSelection(selectedIds, parentMap)
  if (!topLevelIds.length) {
    return null
  }

  const entries = new Map<string, TransformGroupEntry>()
  for (const id of topLevelIds) {
    const object = objectMap.get(id)
    if (!object) {
      continue
    }
    object.updateMatrixWorld(true)

    const pivotWorld = new THREE.Vector3()
    computeTransformPivotWorld(object, pivotWorld)

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
  }

  if (!entries.size) {
    return null
  }

  // Group pivot: average of each entry's pivot (world).
  const initialGroupPivotWorldPosition = new THREE.Vector3()
  entries.forEach((entry) => initialGroupPivotWorldPosition.add(entry.initialPivotWorldPosition))
  initialGroupPivotWorldPosition.multiplyScalar(1 / entries.size)

  const attachedObject = transformControls?.object as THREE.Object3D | null
  const initialGroupPivotWorldQuaternion = new THREE.Quaternion()
  const initialGroupPivotWorldScale = new THREE.Vector3(1, 1, 1)
  if (attachedObject) {
    attachedObject.updateMatrixWorld(true)
    attachedObject.getWorldQuaternion(initialGroupPivotWorldQuaternion)
    attachedObject.getWorldScale(initialGroupPivotWorldScale)
  }

  return {
    primaryId,
    entries,
    initialGroupPivotWorldPosition,
    initialGroupPivotWorldQuaternion,
    initialGroupPivotWorldScale,
  }
}

const draggingChangedHandler = (event: unknown) => {
  const value = (event as { value?: boolean })?.value ?? false
  if (mapControls) {
    mapControls.enabled = !value
  }

  const targetObject = transformControls?.object as THREE.Object3D | null
  const isDirectionalLightTargetPivot = Boolean((targetObject?.userData as any)?.isDirectionalLightTargetPivot)
  const isPivotTarget = Boolean(
    (targetObject?.userData as any)?.isSelectionPivot || isDirectionalLightTargetPivot,
  )
  const primaryId = sceneStore.selectedNodeId ?? null
  const primaryObject = primaryId ? (objectMap.get(primaryId) ?? null) : null

  if (!isSceneReady.value) {
    if (!value) {
      updateGridHighlightFromObject(primaryObject ?? targetObject)
    }
    return
  }

  if (!value) {
    // Dragging ends
    hasTransformLastWorldPosition = false
    if (transformControlsDirty) {
      const updates = commitTransformControlUpdates()
      if (updates.length) {
        protagonistInitialVisibilityCapture?.queueTransformUpdateIds(updates.map((update) => update.id))
      }
    }
    sceneStore.endTransformInteraction()
    if (primaryId) {
      wallRenderer.endWallDrag(primaryId)
    }
    transformGroupState = null
    if (isDirectionalLightTargetPivot) {
      endDirectionalLightTargetPivotInteraction()
    }
    updateOutlineSelectionTargets()
    updateGridHighlightFromObject(primaryObject ?? targetObject)
    updateSelectionHighlights()
    if (pendingSceneGraphSync) {
      pendingSceneGraphSync = false
      sceneStore.drainScenePatches()
      syncSceneGraph()
      refreshPlaceholderOverlays()
    }
  } else {
    // Dragging begins
    hasTransformLastWorldPosition = false
    transformControlsDirty = false
    sceneStore.beginTransformInteraction(primaryId)
    if (primaryId) {
      wallRenderer.beginWallDrag(primaryId)
    }
    transformGroupState = buildTransformGroupState(primaryId)
    if (isDirectionalLightTargetPivot && primaryId) {
      // Establish baseline direction + fixed world height for rotation.
      beginDirectionalLightTargetPivotInteraction(primaryId)
    }
    // Prime multi-binding caches before the first transform delta is applied.
    if (targetObject) {
      primeInstancedTransform(isPivotTarget ? primaryObject : targetObject)
    }
    if (transformGroupState?.entries?.size) {
      transformGroupState.entries.forEach((entry) => primeInstancedTransform(entry.object))
    }
    updateOutlineSelectionTargets()
    updateGridHighlightFromObject(primaryObject ?? targetObject)
    updateSelectionHighlights()
  }
}

// patchApplied tracking removed (unused)

function removeNodeObjects(removedIds: Set<string>): void {
  removedIds.forEach((id) => disposeNodeSubtree(id))

  // Node removals may implicitly remove descendants; rebuild cached placement targets.
  rebuildPlacementSurfaceTargetsFull()

  // Keep selection/effects/lighting consistent with the full-sync path.
  attachSelection(props.selectedNodeId, props.activeTool)
  updateOutlineSelectionTargets()
  updateSelectionHighlights()
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

function isMaterialOnlyNodePatch(patch: PendingNodePatch): boolean {
  return patch.fields.length === 1 && patch.fields[0] === 'materials'
}

function applyNodeMaterialsOnly(object: THREE.Object3D, node: SceneNode): void {
  const userData = object.userData ?? (object.userData = {})
  userData.nodeId = node.id
  userData.nodeType = node.nodeType ?? (node.light ? 'Light' : 'Mesh')
  userData.dynamicMeshType = node.dynamicMesh?.type ?? userData.dynamicMeshType ?? null
  if (node.dynamicMesh?.type === 'Floor') {
    refreshFloorRuntimeMaterials(node.id, object)
  } else if (node.materials && node.materials.length) {
    applyMaterialOverrides(object, node.materials, materialOverrideOptions)
  } else {
    resetMaterialOverrides(object)
  }
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
    if (isMaterialOnlyNodePatch(patch)) {
      applyNodeMaterialsOnly(object, node)
      continue
    }
    updateNodeObject(object, node)
    refreshPlacementSurfaceTargetsForNode(nodeId)
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
      refreshPlacementSurfaceTargetsForNode(nodeId)
      continue
    }
    if (!isMaterialOnlyNodePatch(patch) && shouldRecreateNode(object, node)) {
      if (!recreateNodeSubtree(nodeId, node, parentIdMap)) {
        syncSceneGraph()
        return true
      }
      refreshPlacementSurfaceTargetsForNode(nodeId)
      continue
    }
    if (isMaterialOnlyNodePatch(patch)) {
      applyNodeMaterialsOnly(object, node)
      continue
    }
    updateNodeObject(object, node)
    refreshPlacementSurfaceTargetsForNode(nodeId)
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
    if (!object || (!isMaterialOnlyNodePatch(patch) && shouldRecreateNode(object, node))) {
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

  // previously recorded patch flag removed

  const needsPlaceholderOverlayRefresh = shouldRefreshPlaceholderOverlaysFromPatches(patches as Array<{ type: string }>)
  if (patches.some((patch) => patch.type === 'structure')) {
    syncSceneGraph()
    sceneStore.syncAllNodeComponents()

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

  protagonistInitialVisibilityCapture?.flushAfterPatches(nodePatches)

  if (needsPlaceholderOverlayRefresh) {
    refreshPlaceholderOverlays()
  }

  updatePlaceholderOverlayPositions()
  return true
}

function flushPendingScenePatchesForInteraction(): boolean {
  if (!sceneStore.isSceneReady) {
    return false
  }
  if (shouldDeferSceneGraphSync()) {
    return false
  }
  return applyPendingScenePatches()
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

const terrainGridHelper = new TerrainGridHelper({
  getGroundObject: () => {
    const groundNode = getGroundNodeFromStore()
    if (!groundNode) {
      return null
    }
    return objectMap.get(groundNode.id) ?? getRuntimeObject(groundNode.id) ?? null
  },
})
terrainGridHelper.name = 'TerrainGridHelper'

const axesHelper = new THREE.AxesHelper(4)
axesHelper.visible = false

function getGroundNodeFromStore(): SceneNode | null {
  return sceneStore.groundNode
}

function cloneGroundSurfaceChunkMap(
  source: GroundDynamicMesh['groundSurfaceChunks'] | null | undefined,
): GroundDynamicMesh['groundSurfaceChunks'] {
  if (!source) {
    return null
  }
  const result: NonNullable<GroundDynamicMesh['groundSurfaceChunks']> = {}
  Object.entries(source).forEach(([chunkKey, chunkRef]) => {
    const normalizedKey = chunkKey.trim()
    const textureAssetId = typeof chunkRef?.textureAssetId === 'string' ? chunkRef.textureAssetId.trim() : ''
    if (!normalizedKey || !textureAssetId) {
      return
    }
    const revision = Number.isFinite(chunkRef?.revision)
      ? Math.max(0, Math.trunc(chunkRef!.revision))
      : 0
    result[normalizedKey] = {
      textureAssetId,
      revision,
    }
  })
  return Object.keys(result).length ? result : null
}

function shouldForceDenseGroundMeshForViewport(
  tool = activeBuildTool.value,
  operation = brushOperation.value,
): boolean {
  return tool === 'terrain' && operation !== null
}

const viewportForceDenseGroundMesh = ref(shouldForceDenseGroundMeshForViewport())
let pendingViewportGroundOptimizedRebuild = false
let lastGroundRenderDebugSignature: string | null = null

function applyViewportGroundRuntimeMode(definition: GroundRuntimeDynamicMesh): GroundRuntimeDynamicMesh {
  if (viewportForceDenseGroundMesh.value) {
    return setGroundRuntimeOptimizedChunksEnabled(definition, false)
  }
  return definition
}

function debugViewportGroundRenderMode(phase: string, definition: GroundRuntimeDynamicMesh): void {
  const analysis = analyzeGroundOptimizedMeshUsage(definition)
  const signature = [
    phase,
    viewportForceDenseGroundMesh.value ? 'forced-dense' : 'auto',
    analysis.reason,
    analysis.canUseOptimizedMesh ? 'optimized' : 'dense',
    analysis.optimizedChunkCells ?? 'none',
    analysis.runtimeChunkCells,
    analysis.surfaceRevision,
    analysis.runtimeHydratedHeightState,
  ].join('|')

  if (signature === lastGroundRenderDebugSignature) {
    return
  }
  lastGroundRenderDebugSignature = signature

  console.info('[SceneViewport][GroundRenderMode]', {
    phase,
    forcedDense: viewportForceDenseGroundMesh.value,
    canUseOptimizedMesh: analysis.canUseOptimizedMesh,
    reason: analysis.reason,
    runtimeChunkCells: resolveGroundRuntimeChunkCells(definition),
    optimizedChunkCells: analysis.optimizedChunkCells,
    sourceChunkCells: analysis.sourceChunkCells,
    optimizedTriangleCount: analysis.optimizedTriangleCount,
    sourceTriangleCount: analysis.sourceTriangleCount,
    surfaceRevision: analysis.surfaceRevision,
    runtimeHydratedHeightState: analysis.runtimeHydratedHeightState,
    runtimeDisableOptimizedChunks: analysis.runtimeDisableOptimizedChunks,
  })
}

function resolveGroundDynamicMeshDefinition(): GroundRuntimeDynamicMesh | null {
  const node = getGroundNodeFromStore()
  if (node?.dynamicMesh?.type === 'Ground' && sceneStore.currentSceneId) {
    const runtimeDefinition = useGroundHeightmapStore().resolveGroundRuntimeMesh(
      node.id,
      node.dynamicMesh,
    )
    const paintRuntime = useGroundPaintStore().getSceneGroundPaint(sceneStore.currentSceneId)
    if (paintRuntime && paintRuntime.nodeId === node.id) {
      return applyViewportGroundRuntimeMode({
        ...runtimeDefinition,
        terrainPaint: null,
        groundSurfaceChunks: cloneGroundSurfaceChunkMap(paintRuntime.groundSurfaceChunks),
      })
    }
    return applyViewportGroundRuntimeMode(runtimeDefinition)
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
let isSelectDragOrbitDisabled = false
let isGroundSelectionOrbitDisabled = false
let orbitDisableCount = 0
let isOrbitControlOverrideActive = false
let isAltOverrideActive = false
let isSpaceOverrideActive = false
let isVOverrideActive = false
type AltOverrideSnapshot = {
  transformTool: EditorTool | null
  wallBuildActive: boolean
  groundSelectionActive: boolean
}
let toolOverrideSnapshot: AltOverrideSnapshot | null = null
let vOverrideSnapshotTool: EditorTool | null = null

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
const warpGatePlacementPreviewController = createWarpGateEffectInstance(clampWarpGateComponentProps(null))
const warpGatePlacementPreviewGroup = new THREE.Group()
warpGatePlacementPreviewGroup.name = 'Warp Gate Preview'
warpGatePlacementPreviewGroup.visible = false
warpGatePlacementPreviewGroup.castShadow = false
warpGatePlacementPreviewGroup.receiveShadow = false
warpGatePlacementPreviewGroup.userData = {
  ...(warpGatePlacementPreviewGroup.userData ?? {}),
  editorOnly: true,
  warpGate: true,
  warpGatePreview: true,
  ignoreGridSnapping: true,
}
warpGatePlacementPreviewController.group.removeFromParent()
warpGatePlacementPreviewGroup.add(warpGatePlacementPreviewController.group)
warpGatePlacementPreviewGroup.traverse((child) => {
  child.userData = {
    ...(child.userData ?? {}),
    editorOnly: true,
    warpGate: true,
    warpGatePreview: true,
    ignoreGridSnapping: true,
  }
})
ensureUvDebugMaterialsForMissingMeshes(warpGatePlacementPreviewGroup, { tint: 0xffffff })

const dragPreviewBoundingBoxHelper = new THREE.Box3()
const dragPreviewWorldPositionHelper = new THREE.Vector3()
const dragPreviewAlignedPointHelper = new THREE.Vector3()
const placementPreviewWorldScaleHelper = new THREE.Vector3()
const placementPreviewWorldQuaternionHelper = new THREE.Quaternion()
const placementPreviewWorldEulerHelper = new THREE.Euler()

type AssetPlacementPreviewSnapshot = {
  assetId: string
  worldPosition: THREE.Vector3
  rotation: THREE.Vector3
  scale: THREE.Vector3
}

function hideWarpGatePlacementPreview(): void {
  warpGatePlacementPreviewGroup.visible = false
}

function updateWarpGatePlacementPreview(event: PointerEvent): void {
  if (activeBuildTool.value !== 'warpGate') {
    hideWarpGatePlacementPreview()
    return
  }

  if (!isStrictPointOnCanvas(event.clientX, event.clientY)) {
    hideWarpGatePlacementPreview()
    return
  }

  const placement = computePointerDropPlacement(event)
  const basePoint = computePreviewPointForPlacement(placement)
  if (!basePoint) {
    hideWarpGatePlacementPreview()
    return
  }

  const aligned = computeWorldAabbBottomAlignedPoint(basePoint, warpGatePlacementPreviewGroup) ?? basePoint
  warpGatePlacementPreviewGroup.position.copy(aligned)
  warpGatePlacementPreviewGroup.rotation.set(0, 0, 0)
  warpGatePlacementPreviewGroup.visible = true
}

function computeWorldAabbBottomAlignedPoint(
  basePoint: THREE.Vector3 | null,
  previewRoot: THREE.Object3D,
): THREE.Vector3 | null {
  if (!basePoint) {
    return null
  }

  // If there's no preview root node or it has no children, we cannot compute
  // a bottom-aligned point for the bounding box.
  if (!previewRoot.children || previewRoot.children.length === 0) {
    return null
  }

  // Ensure the preview object's world transform is up-to-date (update matrixWorld).
  // The first parameter `true` updates the localMatrix, the second `true` updates worldMatrix.
  previewRoot.updateWorldMatrix(true, true)

  // Compute the axis-aligned bounding box of the preview object in world space
  // and write the result into preallocated helper variables so we can read the
  // box min/max and determine the model's bottom Y in world space.
  setBoundingBoxFromObject(previewRoot, dragPreviewBoundingBoxHelper)

  // 如果包围盒为空（例如 geometry 丢失或没有可见几何体），则无法对齐
  if (dragPreviewBoundingBoxHelper.isEmpty()) {
    return null
  }

  // 获取预览根节点在世界空间中的原点位置（通常是 object 的 position 转换后的 world 坐标）
  // 这一步用于计算包围盒的 min 相对于对象原点的偏移量
  previewRoot.getWorldPosition(dragPreviewWorldPositionHelper)

  // 计算包围盒底部（min.y）相对于对象世界原点的垂直偏移量
  // bottomOffsetFromOriginY = (包围盒底部的世界 y) - (对象世界原点的 y)
  // 注意：这里是包围盒 min 的 y 减去对象 world position 的 y，可能为负值或正值，取决于模型原点的位置
  const bottomOffsetFromOriginY = dragPreviewBoundingBoxHelper.min.y - dragPreviewWorldPositionHelper.y

  // 将传入的基准点（通常是鼠标在地面上的点）复制到辅助向量
  dragPreviewAlignedPointHelper.copy(basePoint)

  // 将基准点的 y 调整为对齐后的 y 值：基准点 y 减去包围盒底部相对于对象原点的偏移
  // 这样得到的点表示：当把预览对象的世界原点放到该点时，对象的包围盒底部将落在原来的基准点 y 上
  dragPreviewAlignedPointHelper.y = basePoint.y - bottomOffsetFromOriginY

  // 返回一个新的 Vector3 副本，避免外部修改内部缓冲向量
  return dragPreviewAlignedPointHelper.clone()
}

function computeSpawnPointForSelectionClick(
  event: PointerEvent,
  assetId: string,
  placementSideSnap: VertexSnapResult | null,
): THREE.Vector3 {
  const placement = computePointerDropPlacement(event)
  const basePoint = computePreviewPointForPlacement(placement) ?? new THREE.Vector3(0, 0, 0)
  const canUsePreviewBounds = selectionPreviewActive && selectionPreviewAssetId === assetId
  const spawnPoint = canUsePreviewBounds
    ? (computeWorldAabbBottomAlignedPoint(basePoint, dragPreviewGroup) ?? basePoint)
    : basePoint
  if (placementSideSnap) {
    spawnPoint.add(placementSideSnap.delta)
  }
  return spawnPoint
}

function clonePlacementPreviewSnapshot(snapshot: AssetPlacementPreviewSnapshot | null): AssetPlacementPreviewSnapshot | null {
  if (!snapshot) {
    return null
  }

  return {
    assetId: snapshot.assetId,
    worldPosition: snapshot.worldPosition.clone(),
    rotation: snapshot.rotation.clone(),
    scale: snapshot.scale.clone(),
  }
}

function clearAssetPlacementPreviewSnapshot(): void {
  assetPlacementPreviewSnapshot = null
}

function setAssetPlacementPreviewSnapshot(assetId: string, previewRoot: THREE.Object3D): void {
  previewRoot.updateWorldMatrix(true, true)
  previewRoot.getWorldPosition(dragPreviewWorldPositionHelper)
  previewRoot.getWorldQuaternion(placementPreviewWorldQuaternionHelper)
  placementPreviewWorldEulerHelper.setFromQuaternion(placementPreviewWorldQuaternionHelper, 'XYZ')
  previewRoot.getWorldScale(placementPreviewWorldScaleHelper)
  assetPlacementPreviewSnapshot = {
    assetId,
    worldPosition: dragPreviewWorldPositionHelper.clone(),
    rotation: new THREE.Vector3(
      placementPreviewWorldEulerHelper.x,
      placementPreviewWorldEulerHelper.y,
      placementPreviewWorldEulerHelper.z,
    ),
    scale: placementPreviewWorldScaleHelper.clone(),
  }
}

function getAssetPlacementPreviewSnapshot(assetId: string | null): AssetPlacementPreviewSnapshot | null {
  if (!assetId || !assetPlacementPreviewSnapshot || assetPlacementPreviewSnapshot.assetId !== assetId) {
    return null
  }
  return clonePlacementPreviewSnapshot(assetPlacementPreviewSnapshot)
}

function finalizeAssetPlacementPreview(params: {
  assetId: string
  basePoint: THREE.Vector3 | null
  snapResult: PlacementSnapResult | null
}): AssetPlacementPreviewSnapshot | null {
  const { assetId, basePoint, snapResult } = params

  if (!basePoint) {
    clearAssetPlacementPreviewSnapshot()
    dragPreviewGroup.visible = false
    return null
  }

  dragPreviewGroup.rotation.set(0, placementPreviewYaw, 0)

  const aligned = computeWorldAabbBottomAlignedPoint(basePoint, dragPreviewGroup) ?? basePoint.clone()
  const finalPosition = aligned.clone()
  const bestSnap = snapResult?.best ?? null
  if (bestSnap?.delta) {
    finalPosition.add(bestSnap.delta)
  }

  dragPreviewGroup.position.copy(finalPosition)
  dragPreviewGroup.visible = true
  setAssetPlacementPreviewSnapshot(assetId, dragPreviewGroup)
  return clonePlacementPreviewSnapshot(assetPlacementPreviewSnapshot)
}

function isUserCreatedEmptyGroupForPlacement(selectedId: string | null, parentGroupId: string | null): boolean {
  if (!selectedId || parentGroupId !== selectedId) return false
  const { nodeMap } = buildHierarchyMaps()
  const selectedNode = nodeMap.get(selectedId)
  if (!selectedNode || selectedNode.nodeType !== 'Group') return false

  // Many model assets can be represented as a Group node (e.g. instancing).
  // Only treat *user-created* empty groups as placement containers.
  // If the group is backed by an asset, never apply the empty-group placement behavior.
  if (typeof (selectedNode as any).sourceAssetId === 'string' && (selectedNode as any).sourceAssetId.trim().length > 0) {
    return false
  }
  return !selectedNode.children || selectedNode.children.length === 0
}

async function spawnAssetFromSelectionClick(params: {
  assetId: string
  worldPosition: THREE.Vector3
  rotation: THREE.Vector3
  scale?: THREE.Vector3 | null
  parentGroupId: string | null
  selectedId: string | null
}): Promise<void> {
  const { assetId, worldPosition, rotation, scale, parentGroupId, selectedId } = params
  const isEmptySelectedGroup = isUserCreatedEmptyGroupForPlacement(selectedId, parentGroupId)

  if (isEmptySelectedGroup && parentGroupId) {
    await sceneStore.spawnAssetIntoEmptyGroupAtWorldTransform(assetId, parentGroupId, {
      position: worldPosition,
      rotation,
      scale: scale ?? null,
    })
    return
  }

  await sceneStore.spawnAssetAtWorldTransform(assetId, {
    position: worldPosition,
    rotation,
    scale: scale ?? null,
    parentId: parentGroupId,
    preserveWorldPosition: Boolean(parentGroupId),
  })
}

// Selection-based asset preview state: when a mesh/model/prefab is selected
let selectionPreviewActive = false
let selectionPreviewAssetId: string | null = null
let nodePlacementPreviewActive = false
let nodePlacementPreviewKey: string | null = null
let lastSelectionPreviewUpdate = 0
let lastDragHoverPreviewUpdate = 0
let placementPreviewYaw = 0
let assetPlacementPreviewSnapshot: AssetPlacementPreviewSnapshot | null = null

let lastPointerClientX = 0
let lastPointerClientY = 0
let lastPointerType: string | null = null
let selectionPreviewVisibilityRaf: number | null = null

function hasPlacementPreviewActive(): boolean {
  return selectionPreviewActive || nodePlacementPreviewActive
}

function isStrictPointOnCanvas(x: number, y: number): boolean {
  const canvas = canvasRef.value
  if (!canvas || typeof document === 'undefined') {
    return false
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return false
  }
  try {
    return document.elementFromPoint(x, y) === canvas
  } catch {
    return false
  }
}

function stopSelectionPreviewVisibilityMonitor(): void {
  if (selectionPreviewVisibilityRaf != null && typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(selectionPreviewVisibilityRaf)
  }
  selectionPreviewVisibilityRaf = null
}

function hideSelectionHoverPreview(): void {
  // Avoid interfering with drag-and-drop placement preview while dragging.
  if (isDragHovering.value) {
    return
  }
  clearAssetPlacementPreviewSnapshot()
  dragPreview.setPosition(null)
  dragPreviewGroup.visible = false
  snapController.resetPlacementSideSnap()
  clearPlacementSideSnapMarkers()
}

function cancelAssetPlacementInteraction(): boolean {
  let cancelled = false

  if (isVOverrideActive) {
    deactivateVOverride()
    cancelled = true
  }

  if (isDragHovering.value) {
    isDragHovering.value = false
    cancelled = true
  }

  if (assetPlacementClickSessionState) {
    assetPlacementClickSessionState = null
    cancelled = true
  }

  if (nodePlacementClickSessionState) {
    nodePlacementClickSessionState = null
    cancelled = true
  }

  if (selectionPreviewActive || selectionPreviewAssetId) {
    selectionPreviewActive = false
    selectionPreviewAssetId = null
    placementPreviewYaw = 0
    dragPreviewGroup.rotation.set(0, 0, 0)
    dragPreview.dispose()
    cancelled = true
  }

  if (nodePlacementPreviewActive || nodePlacementPreviewKey || pendingViewportPlacement.value) {
    nodePlacementPreviewActive = false
    nodePlacementPreviewKey = null
    pendingViewportPlacement.value = null
    viewportPlacementMenuOpen.value = false
    placementPreviewYaw = 0
    dragPreviewGroup.rotation.set(0, 0, 0)
    dragPreview.dispose()
    cancelled = true
  }

  if (sceneStore.selectedAssetId) {
    sceneStore.selectAsset(null)
    if (uiStore.activeSelectionContext === 'asset-panel') {
      uiStore.setActiveSelectionContext(null)
    }
    cancelled = true
  }

  if (uiStore.activeSelectionContext === 'viewport-add-node') {
    uiStore.setActiveSelectionContext(null)
    cancelled = true
  }

  if (cancelled) {
    stopSelectionPreviewVisibilityMonitor()
    clearAssetPlacementPreviewSnapshot()
    dragPreview.setPosition(null)
    dragPreviewGroup.visible = false
    updateGridHighlight(null)
    snapController.resetPlacementSideSnap()
    clearPlacementSideSnapMarkers()
    restoreGridHighlightForSelection()
  }

  return cancelled
}

function ensureSelectionPreviewVisibilityMonitor(): void {
  if (selectionPreviewVisibilityRaf != null) {
    return
  }
  if (typeof requestAnimationFrame === 'undefined') {
    return
  }

  selectionPreviewVisibilityRaf = requestAnimationFrame(() => {
    selectionPreviewVisibilityRaf = null
    if (!hasPlacementPreviewActive() || isDragHovering.value) {
      return
    }

    const allowed = lastPointerType === 'mouse' && isStrictPointOnCanvas(lastPointerClientX, lastPointerClientY)
    if (!allowed) {
      hideSelectionHoverPreview()
    }

    // Keep monitoring while selection preview remains active.
    ensureSelectionPreviewVisibilityMonitor()
  })
}

watch(
  () => sceneStore.selectedAssetId,
  (nextId) => {
    try {
      if (!nextId) {
        selectionPreviewActive = false
        selectionPreviewAssetId = null
        placementPreviewYaw = 0
        clearAssetPlacementPreviewSnapshot()
        dragPreviewGroup.rotation.set(0, 0, 0)
        dragPreview.dispose()
        return
      }

      // do not show selection preview while dragging assets
      if (sceneStore.draggingAssetId) {
        selectionPreviewActive = false
        selectionPreviewAssetId = null
        placementPreviewYaw = 0
        clearAssetPlacementPreviewSnapshot()
        dragPreviewGroup.rotation.set(0, 0, 0)
        dragPreview.dispose()
        return
      }

      const asset = sceneStore.getAsset(nextId)
      if (!asset) {
        selectionPreviewActive = false
        selectionPreviewAssetId = null
        placementPreviewYaw = 0
        clearAssetPlacementPreviewSnapshot()
        dragPreviewGroup.rotation.set(0, 0, 0)
        dragPreview.dispose()
        return
      }

      if (asset.type === 'model' || asset.type === 'mesh' || asset.type === 'prefab' || asset.type === 'lod') {
        selectionPreviewActive = true
        selectionPreviewAssetId = asset.id
        placementPreviewYaw = 0
        dragPreviewGroup.rotation.set(0, 0, 0)
        // prepare preview object (use existing drag preview loader)
        try {
          clearAssetPlacementPreviewSnapshot()
          dragPreview.prepare(asset.id)
        } catch (e) {
          console.warn('Failed to prepare selection preview', e)
          clearAssetPlacementPreviewSnapshot()
          dragPreview.dispose()
          selectionPreviewActive = false
          selectionPreviewAssetId = null
          placementPreviewYaw = 0
          dragPreviewGroup.rotation.set(0, 0, 0)
        }
      } else {
        selectionPreviewActive = false
        selectionPreviewAssetId = null
        placementPreviewYaw = 0
        clearAssetPlacementPreviewSnapshot()
        dragPreviewGroup.rotation.set(0, 0, 0)
        dragPreview.dispose()
      }
    } catch (err) {
      console.warn('selection preview watch failed', err)
    }
  },
)

// Also show selection preview when a scatter asset is selected from terrain store.
watch(
  () => terrainStore.scatterSelectedAsset,
  (next) => {
    try {
      if (!next) {
        // if no scatter selection, dispose preview only if it was the scatter preview
        if (selectionPreviewActive && selectionPreviewAssetId) {
          selectionPreviewActive = false
          selectionPreviewAssetId = null
          placementPreviewYaw = 0
          clearAssetPlacementPreviewSnapshot()
          dragPreviewGroup.rotation.set(0, 0, 0)
          dragPreview.dispose()
        }
        return
      }

      // do not show selection preview while dragging assets
      if (sceneStore.draggingAssetId) {
        selectionPreviewActive = false
        selectionPreviewAssetId = null
        placementPreviewYaw = 0
        clearAssetPlacementPreviewSnapshot()
        dragPreviewGroup.rotation.set(0, 0, 0)
        dragPreview.dispose()
        return
      }

      const asset = next
      if (!asset) {
        selectionPreviewActive = false
        selectionPreviewAssetId = null
        placementPreviewYaw = 0
        clearAssetPlacementPreviewSnapshot()
        dragPreviewGroup.rotation.set(0, 0, 0)
        dragPreview.dispose()
        return
      }

      if (asset.type === 'model' || asset.type === 'mesh' || asset.type === 'prefab' || asset.type === 'lod') {
        selectionPreviewActive = true
        selectionPreviewAssetId = asset.id
        placementPreviewYaw = 0
        dragPreviewGroup.rotation.set(0, 0, 0)
        try {
          clearAssetPlacementPreviewSnapshot()
          dragPreview.prepare(asset.id)
        } catch (e) {
          console.warn('Failed to prepare scatter selection preview', e)
          clearAssetPlacementPreviewSnapshot()
          dragPreview.dispose()
          selectionPreviewActive = false
          selectionPreviewAssetId = null
          placementPreviewYaw = 0
          dragPreviewGroup.rotation.set(0, 0, 0)
        }
      } else {
        selectionPreviewActive = false
        selectionPreviewAssetId = null
        placementPreviewYaw = 0
        clearAssetPlacementPreviewSnapshot()
        dragPreviewGroup.rotation.set(0, 0, 0)
        dragPreview.dispose()
      }
    } catch (err) {
      console.warn('scatter selection preview watch failed', err)
    }
  },
)

watch(
  pendingViewportPlacement,
  (next) => {
    try {
      if (!next) {
        if (nodePlacementPreviewActive || nodePlacementPreviewKey) {
          nodePlacementPreviewActive = false
          nodePlacementPreviewKey = null
          placementPreviewYaw = 0
          clearAssetPlacementPreviewSnapshot()
          dragPreviewGroup.rotation.set(0, 0, 0)
          if (selectionPreviewActive && selectionPreviewAssetId) {
            dragPreview.prepare(selectionPreviewAssetId)
          } else {
            dragPreview.dispose()
          }
        }
        return
      }

      if (sceneStore.draggingAssetId) {
        nodePlacementPreviewActive = false
        nodePlacementPreviewKey = null
        placementPreviewYaw = 0
        clearAssetPlacementPreviewSnapshot()
        dragPreviewGroup.rotation.set(0, 0, 0)
        dragPreview.dispose()
        return
      }

      const previewKey = getViewportPlacementKey(next)
      nodePlacementPreviewActive = true
      nodePlacementPreviewKey = previewKey
      placementPreviewYaw = 0
      clearAssetPlacementPreviewSnapshot()
      dragPreviewGroup.rotation.set(0, 0, 0)
      dragPreview.prepareObject(previewKey, buildViewportPlacementPreview(next))
    } catch (error) {
      console.warn('viewport placement preview watch failed', error)
      nodePlacementPreviewActive = false
      nodePlacementPreviewKey = null
      pendingViewportPlacement.value = null
      clearAssetPlacementPreviewSnapshot()
      dragPreview.dispose()
    }
  },
)


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

function resolveViewportPixelRatio(): number {
  const devicePixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  if (Boolean(environmentSettings.value.viewportPerformanceMode)) {
    return 1
  }
  return devicePixelRatio
}

function applyGridVisibility(visible: boolean) {
  terrainGridHelper.setOverlayVisible(visible)
  terrainGridHelper.visible = visible
  if (!visible) {
    updateGridHighlight(null)
    return
  }

  terrainGridController.refresh()

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

type WorldBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
  centerX: number
  centerY: number
  centerZ: number
  sizeX: number
  sizeY: number
  sizeZ: number
}

const worldAlignBoxHelper = new THREE.Box3()
const worldAlignSizeHelper = new THREE.Vector3()
const worldAlignWorldPositionHelper = new THREE.Vector3()
const worldAlignLocalPositionHelper = new THREE.Vector3()

function computeWorldBoundsForObject(object: THREE.Object3D): WorldBounds | null {
  object.updateMatrixWorld(true)
  setBoundingBoxFromObject(object, worldAlignBoxHelper)
  if (worldAlignBoxHelper.isEmpty()) {
    return null
  }

  const min = worldAlignBoxHelper.min
  const max = worldAlignBoxHelper.max
  worldAlignBoxHelper.getSize(worldAlignSizeHelper)

  return {
    minX: min.x,
    maxX: max.x,
    minY: min.y,
    maxY: max.y,
    minZ: min.z,
    maxZ: max.z,
    centerX: (min.x + max.x) * 0.5,
    centerY: (min.y + max.y) * 0.5,
    centerZ: (min.z + max.z) * 0.5,
    sizeX: worldAlignSizeHelper.x,
    sizeY: worldAlignSizeHelper.y,
    sizeZ: worldAlignSizeHelper.z,
  }
}

function applyWorldDelta(object: THREE.Object3D, deltaX: number, deltaY: number, deltaZ: number): THREE.Vector3 | null {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || !Number.isFinite(deltaZ)) {
    return null
  }

  if (Math.abs(deltaX) <= 1e-10 && Math.abs(deltaY) <= 1e-10 && Math.abs(deltaZ) <= 1e-10) {
    return null
  }

  object.updateMatrixWorld(true)
  object.getWorldPosition(worldAlignWorldPositionHelper)
  worldAlignWorldPositionHelper.x += deltaX
  worldAlignWorldPositionHelper.y += deltaY
  worldAlignWorldPositionHelper.z += deltaZ

  worldAlignLocalPositionHelper.copy(worldAlignWorldPositionHelper)
  if (object.parent) {
    object.parent.worldToLocal(worldAlignLocalPositionHelper)
  }
  object.position.copy(worldAlignLocalPositionHelper)
  object.updateMatrixWorld(true)
  return worldAlignLocalPositionHelper
}

function sortBySelectionAndAxis<T extends { id: string; axisValue: number }>(items: T[], selectionOrder: string[], ascending: boolean): T[] {
  const order = new Map<string, number>()
  selectionOrder.forEach((id, index) => order.set(id, index))
  const sign = ascending ? 1 : -1
  return items.sort((a, b) => {
    const diff = (a.axisValue - b.axisValue) * sign
    if (Math.abs(diff) > 1e-6) {
      return diff
    }
    const ai = order.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const bi = order.get(b.id) ?? Number.MAX_SAFE_INTEGER
    if (ai !== bi) {
      return ai - bi
    }
    return a.id.localeCompare(b.id)
  })
}

function collectTopLevelMovableSelection(excludeIds: Set<string>): string[] {
  const selection = sceneStore.selectedNodeIds.filter((id) => !!id && !excludeIds.has(id) && !sceneStore.isNodeSelectionLocked(id))
  if (!selection.length) {
    return []
  }
  const { parentMap } = buildHierarchyMaps()
  return filterTopLevelSelection(selection, parentMap)
}

function applyWorldAlign(mode: WorldAlignMode): void {
  const primaryId = sceneStore.selectedNodeId
  if (!primaryId) {
    return
  }
  const primaryObject = objectMap.get(primaryId)
  if (!primaryObject) {
    return
  }

  const referenceBounds = computeWorldBoundsForObject(primaryObject)
  if (!referenceBounds) {
    return
  }

  const idsToMove = collectTopLevelMovableSelection(new Set([primaryId]))
  if (!idsToMove.length) {
    return
  }

  const updates: TransformUpdatePayload[] = []

  for (const nodeId of idsToMove) {
    const object = objectMap.get(nodeId)
    if (!object) {
      continue
    }

    const bounds = computeWorldBoundsForObject(object)
    if (!bounds) {
      continue
    }

    let deltaX = 0
    let deltaY = 0
    let deltaZ = 0

    switch (mode) {
      case 'left':
        deltaX = referenceBounds.minX - bounds.minX
        break
      case 'right':
        deltaX = referenceBounds.maxX - bounds.maxX
        break
      case 'center-x':
        deltaX = referenceBounds.centerX - bounds.centerX
        break
      case 'top':
        deltaY = referenceBounds.maxY - bounds.maxY
        break
      case 'bottom':
        deltaY = referenceBounds.minY - bounds.minY
        break
      case 'center-y':
        deltaY = referenceBounds.centerY - bounds.centerY
        break
      default:
        continue
    }

    const local = applyWorldDelta(object, deltaX, deltaY, deltaZ)
    if (!local) {
      continue
    }
    updates.push({ id: nodeId, position: local.clone() })
  }

  if (!updates.length) {
    return
  }

  if (typeof sceneStore.updateNodePropertiesBatch === 'function') {
    sceneStore.updateNodePropertiesBatch(updates)
  } else {
    updates.forEach((update) => sceneStore.updateNodeProperties(update))
  }

  updateGridHighlightFromObject(primaryObject)
  updatePlaceholderOverlayPositions()
  updateSelectionHighlights()
}

function applyArrange(direction: ArrangeDirection, options?: { fixedPrimaryAsAnchor?: boolean }): void {
  const fixedPrimaryAsAnchor = options?.fixedPrimaryAsAnchor ?? true
  const selectionOrder = sceneStore.selectedNodeIds.slice()

  const primaryId = sceneStore.selectedNodeId
  if (!primaryId) {
    return
  }
  const primaryObject = objectMap.get(primaryId)
  if (!primaryObject) {
    return
  }
  const primaryBounds = computeWorldBoundsForObject(primaryObject)
  if (!primaryBounds) {
    return
  }

  const exclude = fixedPrimaryAsAnchor ? new Set([primaryId]) : new Set<string>()
  const ids = collectTopLevelMovableSelection(exclude)
  if (!ids.length) {
    return
  }

  const entries = ids
    .map((id) => {
      const object = objectMap.get(id)
      if (!object) {
        return null
      }
      const bounds = computeWorldBoundsForObject(object)
      if (!bounds) {
        return null
      }
      return { id, object, bounds }
    })
    .filter((value): value is { id: string; object: THREE.Object3D; bounds: WorldBounds } => Boolean(value))

  if (!entries.length) {
    return
  }

  if (!fixedPrimaryAsAnchor) {
    // When not fixed, keep the first item in sorted order as the anchor.
    // Include the primary in the arrange set if possible.
    const primaryEntry = (() => {
      if (sceneStore.isNodeSelectionLocked(primaryId)) {
        return null
      }
      return { id: primaryId, object: primaryObject, bounds: primaryBounds }
    })()
    if (primaryEntry) {
      entries.push(primaryEntry)
    }
  }

  const axisAscending = true
  const sorted = sortBySelectionAndAxis(
    entries.map((entry) => ({
      id: entry.id,
      axisValue: direction === 'horizontal' ? entry.bounds.centerX : entry.bounds.centerY,
      entry,
    })),
    selectionOrder,
    axisAscending,
  ).map((item) => item.entry)

  const updates: TransformUpdatePayload[] = []

  if (direction === 'horizontal') {
    const anchor = primaryBounds
    const anchorEntry = fixedPrimaryAsAnchor ? null : sorted[0] ?? null
    if (!fixedPrimaryAsAnchor && !anchorEntry) {
      return
    }
    let edge = fixedPrimaryAsAnchor ? anchor.maxX : anchorEntry!.bounds.maxX
    const anchorCenterZ = fixedPrimaryAsAnchor ? anchor.centerZ : anchorEntry!.bounds.centerZ

    const toMove = fixedPrimaryAsAnchor ? sorted : sorted.slice(1)
    for (const entry of toMove) {
      const { id, object, bounds } = entry
      // Place to the right (+X): target minX = current edge.
      const deltaX = edge - bounds.minX
      edge += bounds.sizeX
      // Horizontal arrange only uses footprint along X/Z; keep world Y unchanged.
      const deltaY = 0
      const deltaZ = (fixedPrimaryAsAnchor ? anchor.centerZ : anchorCenterZ) - bounds.centerZ
      const local = applyWorldDelta(object, deltaX, deltaY, deltaZ)
      if (!local) {
        continue
      }
      updates.push({ id, position: local.clone() })
    }
  } else {
    const anchor = primaryBounds
    // Upward expansion in screen space means decreasing Y.
    const anchorEntry = fixedPrimaryAsAnchor ? null : sorted[0] ?? null
    if (!fixedPrimaryAsAnchor && !anchorEntry) {
      return
    }
    // Vertical operations use world +Y (height).
    let edge = fixedPrimaryAsAnchor ? anchor.maxY : anchorEntry!.bounds.maxY
    const anchorCenterX = fixedPrimaryAsAnchor ? anchor.centerX : anchorEntry!.bounds.centerX
    const anchorCenterZ = fixedPrimaryAsAnchor ? anchor.centerZ : anchorEntry!.bounds.centerZ

    const orderedForUp = sortBySelectionAndAxis(
      sorted.map((entry) => ({ id: entry.id, axisValue: entry.bounds.centerY, entry })),
      selectionOrder,
      true,
    ).map((item) => item.entry)

    const toMove = fixedPrimaryAsAnchor ? orderedForUp : orderedForUp.slice(1)
    for (const entry of toMove) {
      const { id, object, bounds } = entry
      // Place upward (+Y): target minY = current edge.
      const deltaY = edge - bounds.minY
      edge += bounds.sizeY
      const deltaX = (fixedPrimaryAsAnchor ? anchor.centerX : anchorCenterX) - bounds.centerX
      const deltaZ = (fixedPrimaryAsAnchor ? anchor.centerZ : anchorCenterZ) - bounds.centerZ
      const local = applyWorldDelta(object, deltaX, deltaY, deltaZ)
      if (!local) {
        continue
      }
      updates.push({ id, position: local.clone() })
    }
  }

  if (!updates.length) {
    return
  }

  if (typeof sceneStore.updateNodePropertiesBatch === 'function') {
    sceneStore.updateNodePropertiesBatch(updates)
  } else {
    updates.forEach((update) => sceneStore.updateNodeProperties(update))
  }

  updateGridHighlightFromObject(primaryObject)
  updatePlaceholderOverlayPositions()
  updateSelectionHighlights()
}

function applyDistribute(direction: ArrangeDirection, options?: { fixedPrimaryAsAnchor?: boolean }): void {
  const fixedPrimaryAsAnchor = options?.fixedPrimaryAsAnchor ?? true
  const selectionOrder = sceneStore.selectedNodeIds.slice()

  const primaryId = sceneStore.selectedNodeId
  if (!primaryId) {
    return
  }
  const primaryObject = objectMap.get(primaryId)
  if (!primaryObject) {
    return
  }
  const primaryBounds = computeWorldBoundsForObject(primaryObject)
  if (!primaryBounds) {
    return
  }

  const exclude = fixedPrimaryAsAnchor ? new Set([primaryId]) : new Set<string>()
  const ids = collectTopLevelMovableSelection(exclude)

  if (fixedPrimaryAsAnchor) {
    if (ids.length < 2) {
      return
    }
  } else {
    if (ids.length < 2) {
      return
    }
    // Include primary when not fixed.
    if (!sceneStore.isNodeSelectionLocked(primaryId)) {
      ids.push(primaryId)
    }
    if (ids.length < 3) {
      return
    }
  }

  const entries = ids
    .map((id) => {
      const object = objectMap.get(id)
      if (!object) {
        return null
      }
      const bounds = computeWorldBoundsForObject(object)
      if (!bounds) {
        return null
      }
      return { id, object, bounds }
    })
    .filter((value): value is { id: string; object: THREE.Object3D; bounds: WorldBounds } => Boolean(value))

  if (fixedPrimaryAsAnchor) {
    if (entries.length < 2) {
      return
    }
  } else {
    if (entries.length < 3) {
      return
    }
  }

  const updates: TransformUpdatePayload[] = []

  if (direction === 'horizontal') {
    const ordered = sortBySelectionAndAxis(
      entries.map((entry) => ({ id: entry.id, axisValue: entry.bounds.centerX, entry })),
      selectionOrder,
      true,
    ).map((item) => item.entry)

    if (fixedPrimaryAsAnchor) {
      let max = Number.NEGATIVE_INFINITY
      ordered.forEach((entry) => {
        max = Math.max(max, entry.bounds.centerX)
      })
      const span = Math.max(0, max - primaryBounds.centerX)
      const step = span / (ordered.length + 1)
      ordered.forEach((entry, i) => {
        const targetCenterX = primaryBounds.centerX + step * (i + 1)
        const deltaX = targetCenterX - entry.bounds.centerX
        // Horizontal distribute only uses footprint along X/Z; keep world Y unchanged.
        const deltaY = 0
        const deltaZ = primaryBounds.centerZ - entry.bounds.centerZ
        const local = applyWorldDelta(entry.object, deltaX, deltaY, deltaZ)
        if (!local) {
          return
        }
        updates.push({ id: entry.id, position: local.clone() })
      })
    } else {
      // Standard distribute: keep endpoints fixed, distribute middles.
      const start = ordered[0]!
      const end = ordered[ordered.length - 1]!
      const span = end.bounds.centerX - start.bounds.centerX
      const step = span / (ordered.length - 1)
      for (let i = 1; i < ordered.length - 1; i += 1) {
        const entry = ordered[i]!
        const targetCenterX = start.bounds.centerX + step * i
        const deltaX = targetCenterX - entry.bounds.centerX
        const local = applyWorldDelta(entry.object, deltaX, 0, 0)
        if (!local) {
          continue
        }
        updates.push({ id: entry.id, position: local.clone() })
      }
    }
  } else {
    // Vertical distribution; upward is +Y.
    const ordered = sortBySelectionAndAxis(
      entries.map((entry) => ({ id: entry.id, axisValue: entry.bounds.centerY, entry })),
      selectionOrder,
      true,
    ).map((item) => item.entry)

    if (fixedPrimaryAsAnchor) {
      let max = Number.NEGATIVE_INFINITY
      ordered.forEach((entry) => {
        max = Math.max(max, entry.bounds.centerY)
      })
      const span = Math.max(0, max - primaryBounds.centerY)
      const step = span / (ordered.length + 1)
      ordered.forEach((entry, i) => {
        const targetCenterY = primaryBounds.centerY + step * (i + 1)
        const deltaY = targetCenterY - entry.bounds.centerY
        const deltaX = primaryBounds.centerX - entry.bounds.centerX
        const deltaZ = primaryBounds.centerZ - entry.bounds.centerZ
        const local = applyWorldDelta(entry.object, deltaX, deltaY, deltaZ)
        if (!local) {
          return
        }
        updates.push({ id: entry.id, position: local.clone() })
      })
    } else {
      const start = ordered[0]!
      const end = ordered[ordered.length - 1]!
      const span = end.bounds.centerY - start.bounds.centerY
      const step = span / (ordered.length - 1)
      for (let i = 1; i < ordered.length - 1; i += 1) {
        const entry = ordered[i]!
        const targetCenterY = start.bounds.centerY + step * i
        const deltaY = targetCenterY - entry.bounds.centerY
        const local = applyWorldDelta(entry.object, 0, deltaY, 0)
        if (!local) {
          continue
        }
        updates.push({ id: entry.id, position: local.clone() })
      }
    }
  }

  if (!updates.length) {
    return
  }

  if (typeof sceneStore.updateNodePropertiesBatch === 'function') {
    sceneStore.updateNodePropertiesBatch(updates)
  } else {
    updates.forEach((update) => sceneStore.updateNodeProperties(update))
  }

  updateGridHighlightFromObject(primaryObject)
  updatePlaceholderOverlayPositions()
  updateSelectionHighlights()
}

function handleAlignSelection(command: AlignMode | AlignCommand) {
  if (typeof command === 'string') {
    // Legacy axis align.
    alignSelection(command, { snapToGrid: false })
    return
  }

  if (!canAlignSelection.value) {
    return
  }

  switch (command.type) {
    case 'world-align':
      applyWorldAlign(command.mode)
      break
    case 'arrange':
      applyArrange(command.direction, command.options)
      break
    case 'distribute':
      applyDistribute(command.direction, command.options)
      break
    default:
      break
  }
}

function handleRotateSelection(options: SelectionRotationOptions) {
  rotateSelection(options)
}

function handleMirrorSelection(payload: { mode: 'horizontal' | 'vertical' }) {
  if (!canRotateSelection.value) {
    return
  }
  // Pivot-centered mirror: only toggle node.mirror and keep node.position unchanged.
  sceneStore.updateSelectionMirror(payload.mode)

  // When a transform tool is active, TransformControls may not immediately recompute
  // its gizmo axis after a mirror (negative scale sign) is applied. Re-attach the
  // selection once the node patches have been applied so the gizmo matches the
  // mirrored transform state without requiring tool reactivation.
  if (!transformControls) {
    return
  }
  const activeTool = props.activeTool
  if (activeTool !== 'translate' && activeTool !== 'rotate' && activeTool !== 'scale') {
    return
  }
  if (transformControls.dragging || sceneStore.activeTransformNodeId) {
    return
  }

  // Apply the mirror patch immediately so runtime objects have updated scale signs.
  if (!shouldDeferSceneGraphSync()) {
    applyPendingScenePatches()
  }

  // Force a detach/attach cycle to refresh gizmo axes.
  const selectedId = props.selectedNodeId ?? sceneStore.selectedNodeId ?? null
  transformControls.detach()

  // Re-apply mode + space explicitly (in case state is cached by the gizmo).
  transformControls.enabled = true
  applyTransformSpaceForSelection(activeTool, selectedId)
  transformControls.setMode(activeTool)

  attachSelection(selectedId, activeTool)
  transformControls.getHelper().updateMatrixWorld(true)
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

async function restoreGroundAllGuarded(): Promise<void> {
  restoreGroupdScatter()
  restoreGroundPaint()
}

async function restoreGroundScatterGuarded(): Promise<void> {
  const tokenSnapshot = sceneStore.sceneSwitchToken
  await restoreGroupdScatter()
  if (tokenSnapshot !== sceneStore.sceneSwitchToken) {
    return
  }
}

async function restoreGroundPaintGuarded(): Promise<void> {
  const tokenSnapshot = sceneStore.sceneSwitchToken
  await restoreGroundPaint()
  if (tokenSnapshot !== sceneStore.sceneSwitchToken) {
    return
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
  void restoreGroundAllGuarded()
})

// Rebind scatter instances when terrainScatter snapshot changes (e.g. planning->3D conversion).
watch(
  [isSceneReady, groundScatterRuntimeVersion, groundScatterRuntimeReason],
  ([ready, version, reason], [prevReady, prevVersion, prevReason]) => {
    if (!ready) {
      return
    }
    if (version <= 0) {
      return
    }
    if (prevReady && prevVersion === version && prevReason === reason) {
      return
    }
    if (typeof reason === 'string' && reason.startsWith('editor-local')) {
      return
    }
    void restoreGroundScatterGuarded()
  },
)

watch(
  [isSceneReady, groundPaintRuntimeVersion, groundPaintRuntimeReason],
  ([ready, version, reason], [prevReady, prevVersion, prevReason]) => {
    if (!ready) {
      return
    }
    if (version <= 0) {
      return
    }
    if (prevReady && prevVersion === version && prevReason === reason) {
      return
    }
    if (typeof reason === 'string' && reason.startsWith('editor-local')) {
      return
    }
    void restoreGroundPaintGuarded()
  },
)

watch(gridVisible, (visible) => {
  applyGridVisibility(visible)
}, { immediate: true })

watch(axesVisible, (visible) => {
  applyAxesVisibility(visible)
}, { immediate: true })

const environmentSignature = computed(() => {
  const settings = environmentSettings.value
  const background = settings.background

  const hasAnySkycubeFaceAsset =
    background.mode === 'skycube' &&
    [
      background.positiveXAssetId,
      background.negativeXAssetId,
      background.positiveYAssetId,
      background.negativeYAssetId,
      background.positiveZAssetId,
      background.negativeZAssetId,
    ].some((assetId) => typeof assetId === 'string' && assetId.trim().length > 0)

  const skycubeFormat =
    background.mode === 'skycube'
      ? background.skycubeFormat === 'zip' || background.skycubeFormat === 'faces'
        ? background.skycubeFormat
        : hasAnySkycubeFaceAsset
          ? 'faces'
          : 'zip'
      : 'zip'

  const hdriBackgroundKey =
    background.mode === 'hdri' && background.hdriAssetId
      ? computeEnvironmentAssetReloadKey(background.hdriAssetId)
      : null

  const skyCubeKeys =
    background.mode === 'skycube' && skycubeFormat !== 'zip'
      ? [
          computeEnvironmentAssetReloadKey(background.positiveXAssetId ?? null),
          computeEnvironmentAssetReloadKey(background.negativeXAssetId ?? null),
          computeEnvironmentAssetReloadKey(background.positiveYAssetId ?? null),
          computeEnvironmentAssetReloadKey(background.negativeYAssetId ?? null),
          computeEnvironmentAssetReloadKey(background.positiveZAssetId ?? null),
          computeEnvironmentAssetReloadKey(background.negativeZAssetId ?? null),
        ]
      : null

  const skycubeZipKey =
    background.mode === 'skycube' && skycubeFormat === 'zip' && background.skycubeZipAssetId
      ? computeEnvironmentAssetReloadKey(background.skycubeZipAssetId)
      : null

  return JSON.stringify({
    background: {
      mode: background.mode,
      solidColor: background.solidColor,
      gradientTopColor: background.mode === 'solidColor' ? (background.gradientTopColor ?? null) : null,
      gradientOffset: background.mode === 'solidColor' ? (background.gradientOffset ?? null) : null,
      gradientExponent: background.mode === 'solidColor' ? (background.gradientExponent ?? null) : null,
      hdriAssetId: background.hdriAssetId ?? null,
      hdriKey: hdriBackgroundKey,
      skycubeFormat: background.mode === 'skycube' ? skycubeFormat : null,
      skycubeZipAssetId: background.mode === 'skycube' ? (background.skycubeZipAssetId ?? null) : null,
      skycubeZipKey,
      positiveXAssetId: background.mode === 'skycube' ? (background.positiveXAssetId ?? null) : null,
      negativeXAssetId: background.mode === 'skycube' ? (background.negativeXAssetId ?? null) : null,
      positiveYAssetId: background.mode === 'skycube' ? (background.positiveYAssetId ?? null) : null,
      negativeYAssetId: background.mode === 'skycube' ? (background.negativeYAssetId ?? null) : null,
      positiveZAssetId: background.mode === 'skycube' ? (background.positiveZAssetId ?? null) : null,
      negativeZAssetId: background.mode === 'skycube' ? (background.negativeZAssetId ?? null) : null,
      skycubeKeys: skyCubeKeys,
    },
    orientation: {
      preset: settings.environmentOrientationPreset ?? 'yUp',
      rotationDegrees: settings.environmentRotationDegrees ?? { x: 0, y: 0, z: 0 },
    },
    ambientLightColor: settings.ambientLightColor,
    ambientLightIntensity: settings.ambientLightIntensity,
    fogMode: settings.fogMode,
    fogColor: settings.fogColor,
    fogNear: settings.fogNear,
    fogFar: settings.fogFar,
    fogDensity: settings.fogDensity,
    northDirection: settings.northDirection,
    csm: resolveEnvironmentCsmSettings(settings),
  })
})

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180
}

function applyEnvironmentTextureRotation(settings: EnvironmentSettings) {
  if (!scene) {
    return
  }
  const rot = settings.environmentRotationDegrees ?? { x: 0, y: 0, z: 0 }
  const euler = new THREE.Euler(
    degreesToRadians(rot.x ?? 0),
    degreesToRadians(rot.y ?? 0),
    degreesToRadians(rot.z ?? 0),
    'XYZ',
  )
  scene.backgroundRotation.copy(euler)
  scene.environmentRotation.copy(euler)
}

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
    ensureWallEndpointHandlesForSelectedNode()
    ensureFloorVertexHandlesForSelectedNode()
    ensureFloorCircleHandlesForSelectedNode()
  },
  { deep: false, immediate: true },
)

function resetCameraView() {
  if (!camera || !mapControls) return

  const targetY = Math.max(DEFAULT_CAMERA_TARGET.y, MIN_TARGET_HEIGHT)
  const position = new THREE.Vector3(DEFAULT_CAMERA_POSITION.x, DEFAULT_CAMERA_POSITION.y, DEFAULT_CAMERA_POSITION.z)
  const target = new THREE.Vector3(DEFAULT_CAMERA_TARGET.x, targetY, DEFAULT_CAMERA_TARGET.z)

  isApplyingCameraState = true
  camera.fov = DEFAULT_PERSPECTIVE_FOV
  camera.updateProjectionMatrix()
  refreshSceneCsmFrustums()

  mapControls.setLookAt(position, target, false)
  applyViewportCompositionOffset(true)
  lastCameraFocusRadius = Math.max(0.25, camera.position.distanceTo(target) / 10)
  syncControlsConstraintsAndSpeeds()
  updateCameraStatusDistance()
  isApplyingCameraState = false

}

const cameraResetDirectionController = createCameraResetDirectionController({
  getCamera: () => camera,
  getMapControls: () => mapControls,
  getGizmoControls: () => gizmoControls,
  getGroundNode: () => sceneStore.groundNode,
  getFallbackSceneNodes: () => props.sceneNodes,
  getSelectedNodeId: () => sceneStore.selectedNodeId,
  getSelectedNodeIds: () => getViewportSelectionFocusIds(),
  getSceneNodeById: (nodeId) => sceneStore.getNodeById(nodeId),
  getRuntimeObject: (nodeId) => objectMap.get(nodeId) ?? getRuntimeObject(nodeId),
  resolveFocusTargetFromNodeIds: (nodeIds) => resolveFocusTargetForNodeIds(nodeIds),
  getLastCameraFocusRadius: () => lastCameraFocusRadius,
  setLastCameraFocusRadius: (value) => {
    lastCameraFocusRadius = value
  },
  setApplyingCameraState: (value) => {
    isApplyingCameraState = value
  },
  syncControlsConstraintsAndSpeeds,
  getCameraControlMode: () => sceneStore.viewportSettings.cameraControlMode,
  minTargetHeight: MIN_TARGET_HEIGHT,
  minCameraHeight: MIN_CAMERA_HEIGHT,
})

function resetCameraToSelectionDirection(direction: CameraResetDirection): boolean {
  const handled = cameraResetDirectionController.resetCameraToSelectionDirection(direction)
  if (handled) {
    applyViewportCompositionOffset(true)
  }
  return handled
}

function handleResetCameraDirection(direction: CameraResetDirection) {
  resetCameraToSelectionDirection(direction)
  cameraResetMenuOpen.value = false
}

function resolveSceneNodeById(nodeId: string | null | undefined): SceneNode | null {
  if (!nodeId) {
    return null
  }
  return sceneStore.getNodeById(nodeId) ?? findSceneNode(props.sceneNodes, nodeId)
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
  flushTerrainPaintChanges(): Promise<boolean>
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
    refreshSceneCsmFrustums()
  }

  if (!camera) return

  const clampedTargetY = Math.max(state.target.y, MIN_TARGET_HEIGHT)
  const clampedPosition = new THREE.Vector3(state.position.x, state.position.y, state.position.z)
  if (clampedPosition.y < MIN_CAMERA_HEIGHT) {
    clampedPosition.y = MIN_CAMERA_HEIGHT
  }

  isApplyingCameraState = true
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.fov = state.fov
    camera.updateProjectionMatrix()
    refreshSceneCsmFrustums()
  }

  mapControls.setLookAt(
    clampedPosition,
    new THREE.Vector3(state.target.x, clampedTargetY, state.target.z),
    false,
  )
  applyViewportCompositionOffset(true)
  // Keep a best-effort scale hint so clip planes/controls stay usable even without an explicit focus action.
  lastCameraFocusRadius = Math.max(0.25, camera.position.distanceTo(mapControls.target) / 10)
  syncControlsConstraintsAndSpeeds()
  updateCameraStatusDistance()
  gizmoControls?.cameraUpdate()
  isApplyingCameraState = false
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function computeRadiusUsed(radius: number | null | undefined, fallbackDistance?: number): number {
  const fallback = typeof fallbackDistance === 'number' && Number.isFinite(fallbackDistance)
    ? Math.max(fallbackDistance / 10, 0.25)
    : 1
  const raw = radius ?? fallback
  return clampNumber(Math.max(raw, 0.001), 0.25, 20000)
}

function computeFitDistanceForSphere(params: {
  camera: THREE.PerspectiveCamera
  radius: number
  margin?: number
}): number {
  const { camera, radius, margin = 1.35 } = params
  const fovV = THREE.MathUtils.degToRad(camera.fov)
  const aspect = Math.max(camera.aspect || 1, 1e-6)
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * aspect)
  const dv = radius / Math.tan(Math.max(fovV / 2, 1e-6))
  const dh = radius / Math.tan(Math.max(fovH / 2, 1e-6))
  return Math.max(dv, dh) * margin
}

function resolveFocusTargetForNodeIds(nodeIds: string[]): { target: THREE.Vector3; radiusEstimate: number } | null {
  const focusIds = nodeIds.filter((id) => typeof id === 'string' && id.trim().length > 0)
  if (focusIds.length === 0) {
    return null
  }

  const target = new THREE.Vector3()
  const combinedBox = new THREE.Box3()
  let hasBounds = false
  const tempBox = new THREE.Box3()
  const tempVector = new THREE.Vector3()

  for (const nodeId of focusIds) {
    const candidate = sceneStore.getNodeById(nodeId)
    if (candidate?.light?.type === 'Directional' && candidate.light.target) {
      tempVector.set(candidate.light.target.x, candidate.light.target.y, candidate.light.target.z)
      if (!hasBounds) {
        combinedBox.setFromCenterAndSize(tempVector, new THREE.Vector3(0.01, 0.01, 0.01))
        hasBounds = true
      } else {
        combinedBox.expandByPoint(tempVector)
      }
      continue
    }

    const object = objectMap.get(nodeId)
    if (object) {
      object.updateWorldMatrix(true, true)
      const box = setBoundingBoxFromObject(object, tempBox)
      if (!box.isEmpty()) {
        if (!hasBounds) {
          combinedBox.copy(box)
          hasBounds = true
        } else {
          combinedBox.union(box)
        }
        continue
      }
      object.getWorldPosition(tempVector)
      if (!hasBounds) {
        combinedBox.setFromCenterAndSize(tempVector, new THREE.Vector3(0.01, 0.01, 0.01))
        hasBounds = true
      } else {
        combinedBox.expandByPoint(tempVector)
      }
      continue
    }

    const node = findSceneNode(props.sceneNodes, nodeId) ?? findSceneNode(sceneStore.nodes, nodeId)
    if (node) {
      tempVector.set(node.position.x, node.position.y, node.position.z)
      if (!hasBounds) {
        combinedBox.setFromCenterAndSize(tempVector, new THREE.Vector3(0.01, 0.01, 0.01))
        hasBounds = true
      } else {
        combinedBox.expandByPoint(tempVector)
      }
    }
  }

  if (!hasBounds || combinedBox.isEmpty()) {
    return null
  }

  combinedBox.getCenter(target)
  const sphere = new THREE.Sphere()
  combinedBox.getBoundingSphere(sphere)
  return { target, radiusEstimate: sphere.radius }
}

function getViewportSelectionFocusIds(): string[] {
  return [...new Set([
    ...sceneStore.selectedNodeIds,
    props.selectedNodeId ?? null,
  ].filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
}

function syncCameraClipPlanes(params: { target: THREE.Vector3; radiusHint?: number | null }) {
  if (!camera) return
  const distance = camera.position.distanceTo(params.target)
  const radiusUsed = computeRadiusUsed(params.radiusHint, distance)

  // Keep near/far in a reasonable ratio for depth precision across tiny assets and huge scenes.
  const near = Math.max(0.005, Math.min(radiusUsed * 0.5, distance / 50))
  const far = Math.max(200, distance + radiusUsed * 50, radiusUsed * 2000)

  if (camera instanceof THREE.PerspectiveCamera) {
    if (camera.near !== near || camera.far !== far) {
      camera.near = near
      camera.far = far
      camera.updateProjectionMatrix()
      refreshSceneCsmFrustums()
    }
  }
}

function syncControlsConstraintsAndSpeeds() {
  if (!camera || !mapControls) return

  const target = mapControls.target
  const distance = camera.position.distanceTo(target)
  const radiusUsed = computeRadiusUsed(lastCameraFocusRadius, distance)
  const mode = sceneStore.viewportSettings.cameraControlMode

  // Prevent mode switch from clamping the current distance (no surprise jumps).
  const minDistanceBase = mode === 'map'
    ? clampNumber(radiusUsed * 0.2, 0.2, 50)
    : clampNumber(radiusUsed * 0.02, 0.02, 10)
  const maxDistanceBase = mode === 'map'
    ? clampNumber(Math.max(radiusUsed * 2000, 5000), 200, 200000)
    : clampNumber(Math.max(radiusUsed * 2000, 500), 50, 200000)

  // Relax the inward clamp so repeated dolly-in doesn't immediately get blocked.
  // Use a smaller fraction of the current distance (instead of 0.95) so there's
  // a meaningful inward range before hitting the minimum constraint.
  mapControls.minDistance = Math.max(0.02, Math.min(minDistanceBase, distance * 0.5))
  mapControls.maxDistance = Math.max(maxDistanceBase, distance * 1.05)

  // Keep local-detail edits precise while making far-away browsing much faster.
  const normalizedDistance = distance / Math.max(radiusUsed, 1e-6)
  const distanceScale = normalizedDistance >= 1
    ? clampNumber(Math.pow(normalizedDistance, 0.22), 1, 1.5)
    : clampNumber(0.9 + normalizedDistance * 0.1, 0.9, 1)
  const boostScale = navigationSpeedBoostModifierActive.value ? 1.35 : 1
  const speedScale = distanceScale * boostScale

  // Slightly increased over original defaults but conservative to avoid oversensitivity
  mapControls.rotateSpeed = 0.6 * speedScale
  mapControls.zoomSpeed = 0.6
  mapControls.panSpeed = 1 * speedScale
  mapControls.keyPanSpeed = 7.5 * speedScale

  // debug logs removed

  // When users report wheel stops working, it's often because controls are disabled
  // or distance hits a clamp. Surface both conditions quickly.
  if (!mapControls.enabled) {
    // debug logs removed
  } else {
    const eps = 1e-6
    if (distance <= mapControls.minDistance + eps) {
      // debug logs removed
    }
    if (distance >= mapControls.maxDistance - eps) {
      // debug logs removed
    }
  }

  syncCameraClipPlanes({ target, radiusHint: radiusUsed })
}

function applyCameraFocus(target: THREE.Vector3, radiusEstimate: number): boolean {
  if (!camera || !mapControls) {
    return false
  }

  const clampedTargetY = Math.max(target.y, MIN_TARGET_HEIGHT)
  const focusTarget = new THREE.Vector3(target.x, clampedTargetY, target.z)
  const radiusUsed = computeRadiusUsed(radiusEstimate)

  lastCameraFocusRadius = radiusUsed

  const mode = sceneStore.viewportSettings.cameraControlMode
  const perspective = camera instanceof THREE.PerspectiveCamera ? camera : null

  let desiredDistance = mode === 'map'
    ? (perspective ? computeFitDistanceForSphere({ camera: perspective, radius: radiusUsed, margin: 1.35 }) : radiusUsed * 3)
    : radiusUsed * 1.6

  // Avoid ending up inside the target or too close to navigate.
  desiredDistance = Math.max(desiredDistance, mode === 'map' ? radiusUsed * 2 : radiusUsed * 1.2, 0.8)

  const direction = mode === 'map'
    ? new THREE.Vector3(1, 1.1, 1).normalize()
    : new THREE.Vector3(1, 0.65, 1).normalize()
  const newPosition = focusTarget.clone().addScaledVector(direction, desiredDistance)

  if (newPosition.y < MIN_CAMERA_HEIGHT) {
    newPosition.y = MIN_CAMERA_HEIGHT
  }

  isApplyingCameraState = true
  mapControls.setLookAt(newPosition, focusTarget, false)
  applyViewportCompositionOffset(true)
  syncControlsConstraintsAndSpeeds()
  isApplyingCameraState = false

  if (perspectiveCamera && camera !== perspectiveCamera) {
    perspectiveCamera.position.copy(camera.position)
    perspectiveCamera.quaternion.copy(camera.quaternion)
  }

  return true
}

function focusCameraOnSelection(nodeIds: string[]): boolean {
  const focus = resolveFocusTargetForNodeIds(nodeIds)
  if (!focus) {
    return false
  }
  return applyCameraFocus(focus.target, focus.radiusEstimate)
}

function applyCameraTopViewFocus(target: THREE.Vector3, radiusEstimate: number): boolean {
  if (!camera || !mapControls) {
    return false
  }

  const clampedTargetY = Math.max(target.y, MIN_TARGET_HEIGHT)
  const focusTarget = new THREE.Vector3(target.x, clampedTargetY, target.z)
  const radiusUsed = computeRadiusUsed(radiusEstimate)

  lastCameraFocusRadius = radiusUsed

  const perspective = camera instanceof THREE.PerspectiveCamera ? camera : null
  let desiredDistance = perspective
    ? computeFitDistanceForSphere({ camera: perspective, radius: radiusUsed, margin: 1.18 })
    : radiusUsed * 2.8
  desiredDistance = Math.max(desiredDistance, radiusUsed * 1.5, 0.8)

  // Keep a slight oblique angle so map mode constraints and depth cues remain stable.
  const direction = new THREE.Vector3(0.15, 1, 0.15).normalize()
  const newPosition = focusTarget.clone().addScaledVector(direction, desiredDistance)

  if (newPosition.y < MIN_CAMERA_HEIGHT) {
    newPosition.y = MIN_CAMERA_HEIGHT
  }

  isApplyingCameraState = true
  mapControls.setLookAt(newPosition, focusTarget, false)
  applyViewportCompositionOffset(true)
  syncControlsConstraintsAndSpeeds()
  isApplyingCameraState = false

  if (perspectiveCamera && camera !== perspectiveCamera) {
    perspectiveCamera.position.copy(camera.position)
    perspectiveCamera.quaternion.copy(camera.quaternion)
  }

  return true
}


function focusCameraOnNode(nodeId: string): boolean {
  const focus = resolveFocusTargetForNodeIds([nodeId]) ?? cameraResetDirectionController.resolveFocusTargetFromNodeId(nodeId)
  if (!focus) {
    return false
  }
  return applyCameraFocus(focus.target, focus.radiusEstimate)
}

function focusViewportSelection(): boolean {
  const focusIds = getViewportSelectionFocusIds()

  if (focusIds.length === 0) {
    return false
  }

  if (!focusCameraOnSelection(focusIds) && focusIds[0]) {
    sceneStore.requestCameraFocus(focusIds[0])
  }
  return true
}

function focusViewportVisible(): boolean {
  const focusIds = collectVisibleFocusNodeIds()
  if (focusIds.length > 0 && focusCameraOnSelection(focusIds)) {
    return true
  }

  const fallbackFocusIds = collectVisibleFocusNodeIds({ includeGround: true })
  if (fallbackFocusIds.length > 0 && focusCameraOnSelection(fallbackFocusIds)) {
    return true
  }

  resetCameraView()
  return true
}

function enterMapTopView(): boolean {
  if (!camera || !mapControls) {
    return false
  }

  if (sceneStore.viewportSettings.cameraControlMode !== 'map') {
    sceneStore.setCameraControlMode('map')
    applyCameraControlMode()
  }

  const selectedFocus = resolveFocusTargetForNodeIds(getViewportSelectionFocusIds())
  if (selectedFocus) {
    return applyCameraTopViewFocus(selectedFocus.target, selectedFocus.radiusEstimate)
  }

  const visibleFocus = resolveFocusTargetForNodeIds(collectVisibleFocusNodeIds())
  if (visibleFocus) {
    return applyCameraTopViewFocus(visibleFocus.target, visibleFocus.radiusEstimate)
  }

  const fallbackVisibleFocus = resolveFocusTargetForNodeIds(collectVisibleFocusNodeIds({ includeGround: true }))
  if (fallbackVisibleFocus) {
    return applyCameraTopViewFocus(fallbackVisibleFocus.target, fallbackVisibleFocus.radiusEstimate)
  }

  return resetCameraToSelectionDirection('pos-y')
}

function handleViewportDoubleClickNode(nodeId: string): void {
  const wasAlreadySingleSelected = sceneStore.selectedNodeIds.length === 1 && sceneStore.selectedNodeIds[0] === nodeId

  emitSelectionChange([nodeId])

  if (!wasAlreadySingleSelected) {
    return
  }

  const toolForNode = resolveBuildToolForNodeId(nodeId)
  tryEnterNodeBuildToolEditMode(nodeId, toolForNode)
}

function collectVisibleFocusNodeIds(options?: { includeGround?: boolean }): string[] {
  const includeGround = Boolean(options?.includeGround)
  const visibleIds: string[] = []
  const seen = new Set<string>()

  const visit = (nodes: SceneNode[]) => {
    for (const node of nodes) {
      const id = typeof node.id === 'string' ? node.id.trim() : ''
      if (!id) {
        continue
      }
      if (id === ENVIRONMENT_NODE_ID) {
        if (node.children?.length) {
          visit(node.children)
        }
        continue
      }
      if (!includeGround && id === GROUND_NODE_ID) {
        if (node.children?.length) {
          visit(node.children)
        }
        continue
      }
      if (sceneStore.isNodeVisible(id) && !seen.has(id)) {
        const object = objectMap.get(id) ?? null
        const pickable = object ? isObjectWorldVisible(object) : true
        if (pickable) {
          visibleIds.push(id)
          seen.add(id)
        }
      }
      if (node.children?.length) {
        visit(node.children)
      }
    }
  }

  visit(sceneStore.nodes)
  return visibleIds
}

function handleDirectionalCameraShortcut(code: string): boolean {
  if (code === 'Digit3') {
    return enterMapTopView()
  }

  const directionByCode: Partial<Record<string, CameraResetDirection>> = {
    Digit1: 'pos-x',
    Digit2: 'neg-x',
    Digit4: 'neg-y',
    Digit5: 'pos-z',
    Digit6: 'neg-z',
  }
  const direction = directionByCode[code]
  if (!direction) {
    return false
  }
  return resetCameraToSelectionDirection(direction)
}

function handleControlsChange() {
  if (!isSceneReady.value || isApplyingCameraState) return

  if (camera && mapControls && shiftOrbitPivotSessionState) {
    const session = shiftOrbitPivotSessionState
    const currentOffset = shiftOrbitOffsetHelper.copy(camera.position).sub(session.pivot)
    const currentDistance = currentOffset.length()
    if (currentDistance > 1e-6 && session.orbitDistance > 1e-6) {
      const deviation = Math.abs(currentDistance - session.orbitDistance)
      const tolerance = Math.max(1e-3, session.orbitDistance * 0.005)
      if (deviation > tolerance) {
        currentOffset.multiplyScalar(session.orbitDistance / currentDistance)
        camera.position.copy(session.pivot).add(currentOffset)
      }
    }
    mapControls.target.copy(session.pivot)
  }

  syncControlsConstraintsAndSpeeds()
  applyViewportCompositionOffset(true)
  updateCameraStatusDistance()
  gizmoControls?.cameraUpdate()
  terrainGridController.markCameraDirty()
}

function updateCameraStatusDistance() {
  if (!camera || !mapControls) {
    cameraStatusDistance.value = defaultCameraStatusDistance
    return
  }
  cameraStatusDistance.value = camera.position.distanceTo(mapControls.target)
}

function handleResetCameraStatusZoomClick() {
  if (!camera || !mapControls) return
  const target = mapControls.target.clone()
  const dir = camera.position.clone().sub(target)
  const currentDist = dir.length()
  if (currentDist < 1e-6) return
  dir.normalize().multiplyScalar(defaultCameraStatusDistance)
  const newPosition = target.clone().add(dir)
  isApplyingCameraState = true
  camera.fov = DEFAULT_PERSPECTIVE_FOV
  camera.updateProjectionMatrix()
  refreshSceneCsmFrustums()
  mapControls.setLookAt(newPosition, target, false)
  applyViewportCompositionOffset(true)
  lastCameraFocusRadius = Math.max(0.25, defaultCameraStatusDistance / 10)
  syncControlsConstraintsAndSpeeds()
  updateCameraStatusDistance()
  isApplyingCameraState = false
}

function toggleViewportCameraControlMode() {
  const nextMode = cameraControlMode.value === 'map' ? 'orbit' : 'map'
  sceneStore.setCameraControlMode(nextMode)
}

const showCameraHintsOpen = ref(false)
function toggleCameraHints() {
  showCameraHintsOpen.value = !showCameraHintsOpen.value
}

function clearShiftOrbitPivotSession(pointerId?: number) {
  if (!shiftOrbitPivotSessionState) {
    return
  }
  if (typeof pointerId === 'number' && shiftOrbitPivotSessionState.pointerId !== pointerId) {
    return
  }
  shiftOrbitPivotSessionState = null
}

function beginCameraTransition(params: {
  endPosition: THREE.Vector3
  endTarget: THREE.Vector3
  relativeOffset?: THREE.Vector3 | null
  durationMs?: number
}): boolean {
  if (!camera || !mapControls) {
    return false
  }

  const endTarget = params.endTarget.clone()
  endTarget.y = Math.max(endTarget.y, MIN_TARGET_HEIGHT)

  const endPosition = params.endPosition.clone()
  if (endPosition.y < MIN_CAMERA_HEIGHT) {
    endPosition.y = MIN_CAMERA_HEIGHT
  }

  cameraTransitionState = {
    startPosition: camera.position.clone(),
    startTarget: mapControls.target.clone(),
    endPosition,
    endTarget,
    relativeOffset: params.relativeOffset ? params.relativeOffset.clone() : null,
    startTime: performance.now(),
    duration: Math.max(0, params.durationMs ?? 0),
  }

  return true
}

function doesHitBelongToViewportSelection(hitNodeId: string | null | undefined): boolean {
  if (!hitNodeId) {
    return false
  }

  const selectionIds = getViewportSelectionFocusIds()
  if (selectionIds.length === 0) {
    return false
  }

  return selectionIds.includes(hitNodeId)
    || selectionIds.some((selectedNodeId) => sceneStore.isDescendant(selectedNodeId, hitNodeId))
}

function resolveSelectionPivotPoint(): THREE.Vector3 | null {
  const selectionFocus = resolveFocusTargetForNodeIds(getViewportSelectionFocusIds())
  return selectionFocus?.target.clone() ?? null
}

function resolveShiftOrbitPivotPoint(event: PointerEvent): THREE.Vector3 | null {
  const sceneHit = pickNodeAtPointer(event)
  if (sceneHit && doesHitBelongToViewportSelection(sceneHit.nodeId)) {
    return resolveSelectionPivotPoint() ?? sceneHit.point.clone()
  }
  if (sceneHit?.point) {
    return sceneHit.point.clone()
  }

  const selectionBoundingHit = pickActiveSelectionBoundingBoxHit(event)
  if (selectionBoundingHit?.point) {
    return resolveSelectionPivotPoint() ?? selectionBoundingHit.point.clone()
  }

  const groundPoint = new THREE.Vector3()
  if (raycastGroundPoint(event, groundPoint)) {
    return groundPoint.clone()
  }

  return null
}

function maybeBeginShiftOrbitPivotSession(event: PointerEvent): void {
  if (!camera || !mapControls || !mapControls.enabled) {
    return
  }
  if (!event.shiftKey || isApplyingCameraState || isTemporaryNavigationOverrideActive()) {
    return
  }
  if (activeBuildTool.value || uiStore.activeSelectionContext || nodePickerStore.isActive) {
    return
  }
  if (scatterEraseModeActive.value || hasPlacementPreviewActive()) {
    return
  }
  if (Boolean(transformControls?.dragging)) {
    return
  }

  const mode = sceneStore.viewportSettings.cameraControlMode
  const isRotateGesture = (mode === 'orbit' && event.button === 1) || (mode === 'map' && event.button === 2)
  if (!isRotateGesture) {
    return
  }

  const pivot = resolveShiftOrbitPivotPoint(event)
  if (!pivot) {
    return
  }

  const orbitDistance = camera.position.distanceTo(pivot)
  if (!Number.isFinite(orbitDistance) || orbitDistance <= 1e-6) {
    return
  }

  shiftOrbitPivotSessionState = {
    pointerId: event.pointerId,
    pivot,
    orbitDistance,
  }

  mapControls.target.copy(pivot)
  syncControlsConstraintsAndSpeeds()
  mapControls.update()
}

function maybeApplyShiftLeftClickFocus(event: PointerEvent): boolean {
  if (!camera || !mapControls || !mapControls.enabled) {
    return false
  }
  if (!event.shiftKey || event.button !== 0 || isApplyingCameraState || isTemporaryNavigationOverrideActive()) {
    return false
  }
  const mode = sceneStore.viewportSettings.cameraControlMode
  if (mode !== 'orbit' && mode !== 'map') {
    return false
  }
  if (activeBuildTool.value || uiStore.activeSelectionContext || nodePickerStore.isActive) {
    return false
  }
  if (scatterEraseModeActive.value || hasPlacementPreviewActive()) {
    return false
  }
  if (Boolean(transformControls?.dragging)) {
    return false
  }

  const pivot = resolveShiftOrbitPivotPoint(event)
  if (!pivot) {
    return false
  }

  const cameraOffset = new THREE.Vector3().copy(camera.position).sub(mapControls.target)
  const endTarget = pivot.clone()
  const endPosition = endTarget.clone().add(cameraOffset)

  if (!beginCameraTransition({
    endPosition,
    endTarget,
    relativeOffset: cameraOffset,
    durationMs: SHIFT_ORBIT_FOCUS_TRANSITION_MS,
  })) {
    return false
  }

  lastCameraFocusRadius = Math.max(0.25, endPosition.distanceTo(endTarget) / 10)
  return true
}

function applyCameraControlMode() {
  if (!camera || !canvasRef.value) {
    return
  }

  const cameraControlMode = sceneStore.viewportSettings.cameraControlMode
  clearShiftOrbitPivotSession()

  const domElement = canvasRef.value
  if (!mapControls) {
    mapControls = new SceneViewportCameraControls(camera, domElement)
    mapControls.target.set(DEFAULT_CAMERA_TARGET.x, DEFAULT_CAMERA_TARGET.y, DEFAULT_CAMERA_TARGET.z)
    mapControls.addEventListener('change', handleControlsChange)
  } else {
    bindControlsToCamera(camera)
  }

  mapControls.applyMode(cameraControlMode)

  // debug logs removed

  // Apply scale-aware limits/speeds without changing current camera distance.
  if (!lastCameraFocusRadius) {
    lastCameraFocusRadius = Math.max(0.25, camera.position.distanceTo(mapControls.target) / 10)
  }
  syncControlsConstraintsAndSpeeds()
  scheduleViewportCompositionUpdate(true)

  bindControlsToCamera(camera)
  if (gizmoControls && mapControls) {
    gizmoControls.attachControls(mapControls)
    gizmoControls.update()
  }
  updateMapControlsEnabled()
  mapControls.update()
  updateCameraStatusDistance()
  gizmoControls?.cameraUpdate()

}

watch(
  () => sceneStore.viewportSettings.cameraControlMode,
  () => {
    applyCameraControlMode()
  },
)

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
  const pixelRatio = resolveViewportPixelRatio()
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(width, height)
  renderer.shadowMap.enabled = Boolean(shadowsActiveInViewport.value)
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace

  scene = new THREE.Scene()
  scene.background = new THREE.Color(DEFAULT_BACKGROUND_COLOR)
  scene.fog = null

  const initialEnvironment = environmentSettings.value

  scene.add(rootGroup)
  scene.add(instancedMeshGroup)
  scene.add(instancedOutlineGroup)
  scene.add(wallDoorSelectionHighlightGroup)
  scene.add(vertexOverlayGroup)
  if (repairHoverGroup.parent !== instancedOutlineGroup) {
    instancedOutlineGroup.add(repairHoverGroup)
  }
  scene.add(terrainGridHelper)
  scene.add(axesHelper)
  scene.add(brushMesh)
  scene.add(scatterAreaPreviewGroup)
  scene.add(terrainSculptPreviewGroup)
  scene.add(scatterPreviewGroup)
  scene.add(groundSelectionGroup)
  scene.add(dragPreviewGroup)
  scene.add(warpGatePlacementPreviewGroup)
  gridHighlight = createGridHighlight()
  if (gridHighlight) {
    scene.add(gridHighlight)
  }
  applyGridVisibility(gridVisible.value)
  applyAxesVisibility(axesVisible.value)
  clearInstancedMeshes()
  instancedMeshRevision.value += 1
  stopBillboardMeshSubscription?.()
  stopInstancedMeshSubscription = subscribeInstancedMeshes((mesh) => {
    attachInstancedMesh(mesh)
    instancedMeshRevision.value += 1
  })
  stopBillboardMeshSubscription = subscribeBillboardInstancedMeshes((mesh) => {
    attachInstancedMesh(mesh)
    instancedMeshRevision.value += 1
  })

  if (pendingEnvironmentSettings) {
    void applyEnvironmentSettingsToScene(pendingEnvironmentSettings)
  } else {
    void applyEnvironmentSettingsToScene(initialEnvironment)
  }

  perspectiveCamera = new THREE.PerspectiveCamera(DEFAULT_PERSPECTIVE_FOV, width / height || 1, 0.1, 5000)
  perspectiveCamera.position.set(DEFAULT_CAMERA_POSITION.x, DEFAULT_CAMERA_POSITION.y, DEFAULT_CAMERA_POSITION.z)
  perspectiveCamera.lookAt(new THREE.Vector3(DEFAULT_CAMERA_TARGET.x, DEFAULT_CAMERA_TARGET.y, DEFAULT_CAMERA_TARGET.z))
  camera = perspectiveCamera
  ensureSceneCsmShadowRuntime()

  applyCameraControlMode()
  updateCameraStatusDistance()

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
    renderer.setPixelRatio(resolveViewportPixelRatio())
    renderer.setSize(w, h)
    postprocessing.setSize(w, h)
    if (perspectiveCamera) {
      perspectiveCamera.aspect = h === 0 ? 1 : w / h
      perspectiveCamera.updateProjectionMatrix()
      refreshSceneCsmFrustums()
    }
    ;(mapControls as any)?.handleResize?.()
    gizmoControls?.update()
    scheduleViewportCompositionUpdate(true)
  })
  resizeObserver.observe(viewportEl.value)

  renderClock.start()
  animate()
  applyCameraState(props.cameraState)
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

async function resolveAssetUrlFromCache(assetId: string): Promise<{ url: string | null } | null> {
  const normalized = normalizeCloudAssetReference(assetId)
  if (!normalized) {
    return null
  }
  const asset = sceneStore.getAsset(normalized)
  if (!asset) {
    try {
      const cachedEntry = await assetCacheStore.loadFromIndexedDb(normalized)
      if (cachedEntry?.blobUrl) {
        assetCacheStore.touch(normalized)
        return { url: cachedEntry.blobUrl }
      }
    } catch (error) {
      console.warn('[SceneViewport] Failed to restore asset from IndexedDB', normalized, error)
      return null
    }
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
    console.warn('[SceneViewport] Failed to resolve asset URL', normalized, error)
    return null
  }
}

const groundSurfacePreviewLoaders = createDefaultGroundSurfacePreviewLoaders(resolveAssetUrlFromCache)
const LIVE_TERRAIN_PAINT_SURFACE_PREVIEW_MAX_RESOLUTION = 512


function syncGroundSurfacePreviewFromLiveTerrainPaint(payload: {
  groundObject: THREE.Object3D
  groundNode: SceneNode
  dynamicMesh: GroundDynamicMesh
  previewRevision: number
  mode: 'live' | 'surface-rebuild'
  liveChunkPreviews?: GroundSurfaceLiveChunkPreview[] | null
}): void {
  const liveChunkPreviewSignature = payload.mode === 'live'
    ? (payload.liveChunkPreviews ?? []).map((entry) => `${entry.chunkKey}:${entry.revision}`).join('|')
    : ''
  const requestKey = stableSerialize({
    mode: payload.mode,
    nodeId: payload.groundNode.id,
    previewRevision: payload.previewRevision,
    groundSignature: computeGroundDynamicMeshSignature(payload.dynamicMesh),
    liveChunkPreviewCount: payload.liveChunkPreviews?.length ?? 0,
    liveChunkPreviewSignature,
  })
  if (lastTerrainPaintSurfacePreviewRequestKey === requestKey) {
    return
  }
  lastTerrainPaintSurfacePreviewRequestKey = requestKey
  bumpGroundSurfacePreviewTokenIfNeeded(requestKey)
  if (payload.mode === 'live' && payload.liveChunkPreviews?.length) {
    const applied = syncGroundSurfaceLiveChunkPreviews({
      groundObject: payload.groundObject,
      groundNode: payload.groundNode,
      dynamicMesh: payload.dynamicMesh,
      chunkPreviews: payload.liveChunkPreviews,
      maxResolution: LIVE_TERRAIN_PAINT_SURFACE_PREVIEW_MAX_RESOLUTION,
      applyToMaterialMap: true,
    })
    if (applied) {
      return
    }
  }
  syncGroundSurfacePreviewForGround(
    payload.groundObject,
    payload.groundNode,
    payload.dynamicMesh,
    groundSurfacePreviewLoaders,
    () => 0,
    {
      previewRevision: payload.previewRevision,
      maxResolution: payload.mode === 'live' ? LIVE_TERRAIN_PAINT_SURFACE_PREVIEW_MAX_RESOLUTION : undefined,
      applyToMaterialMap: true,
    },
  )
}

function resolveAssetExtension(asset: ProjectAsset | null, override?: string | null): string | null {
  const source = override ?? asset?.name ?? asset?.downloadUrl ?? asset?.description ?? asset?.id ?? ''
  return getLastExtensionFromFilenameOrUrl(source)
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
      if (isHdriLikeExtension(extension)) {
        const texture = await rgbeLoader.loadAsync(url)
        texture.mapping = THREE.EquirectangularReflectionMapping
        texture.needsUpdate = true
        return texture
      }
      // EXR not supported in all module environments; fall back to image loader.
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

function disposeHdriBackgroundResources() {
  if (scene && scene.background === backgroundTexture) {
    scene.background = null
  }
  if (backgroundTexture) {
    backgroundTexture.dispose()
    backgroundTexture = null
  }
  backgroundAssetId = null
  backgroundAssetKey = null
}

function disposeSkyCubeBackgroundResources() {
  if (scene && scene.background === skyCubeTexture) {
    scene.background = null
  }
  skyCubeZipFaceUrlCleanup?.()
  skyCubeZipFaceUrlCleanup = null
  disposeSkyCubeTexture(skyCubeTexture)
  skyCubeTexture = null
  skyCubeSourceFormat = 'faces'
  skyCubeFaceAssetIds = [null, null, null, null, null, null]
  skyCubeFaceKeys = [null, null, null, null, null, null]
  skyCubeZipAssetId = null
  skyCubeZipAssetKey = null
}

function disposeBackgroundResources() {
  disposeHdriBackgroundResources()
  disposeSkyCubeBackgroundResources()
  disposeGradientBackgroundResources()
}

function applyEnvironmentReflectionFromBackground(background: EnvironmentSettings['background']): boolean {
  if (!scene) {
    return false
  }
  void background
  // Background modes do not contribute a separate reflection environment here.
  scene.environment = null
  scene.environmentIntensity = 1
  return true
}

async function applyBackgroundSettings(background: EnvironmentSettings['background']): Promise<boolean> {
  backgroundLoadToken += 1
  const token = backgroundLoadToken

  if (!scene) {
    return false
  }

  if (background.mode === 'solidColor') {
    const gradientTopColor = typeof background.gradientTopColor === 'string' ? background.gradientTopColor.trim() : ''

    disposeHdriBackgroundResources()
    disposeSkyCubeBackgroundResources()

    if (gradientTopColor) {
      if (!gradientBackgroundDome) {
        gradientBackgroundDome = createGradientBackgroundDome({
          topColor: gradientTopColor,
          bottomColor: background.solidColor,
          offset: background.gradientOffset ?? 33,
          exponent: background.gradientExponent ?? 0.6,
        })
        gradientBackgroundDome.mesh.userData = { ...(gradientBackgroundDome.mesh.userData ?? {}), editorOnly: true }
        ;(gradientBackgroundDome.mesh as any).raycast = () => {}
        scene.add(gradientBackgroundDome.mesh)
      } else {
        gradientBackgroundDome.uniforms.topColor.value.set(gradientTopColor)
        gradientBackgroundDome.uniforms.bottomColor.value.set(background.solidColor)
        if (typeof background.gradientOffset === 'number' && Number.isFinite(background.gradientOffset)) {
          gradientBackgroundDome.uniforms.offset.value = background.gradientOffset
        }
        if (typeof background.gradientExponent === 'number' && Number.isFinite(background.gradientExponent)) {
          gradientBackgroundDome.uniforms.exponent.value = background.gradientExponent
        }
      }

      scene.background = null
      return true
    }

    disposeGradientBackgroundResources()
    scene.background = new THREE.Color(background.solidColor)
    return true
  }

  if (background.mode === 'skycube') {
    disposeGradientBackgroundResources()
    const faceAssetIds: Array<string | null> = [
      background.positiveXAssetId ?? null,
      background.negativeXAssetId ?? null,
      background.positiveYAssetId ?? null,
      background.negativeYAssetId ?? null,
      background.positiveZAssetId ?? null,
      background.negativeZAssetId ?? null,
    ]
    const hasAnyFace = faceAssetIds.some((id) => typeof id === 'string' && id.trim().length > 0)
    const skycubeFormat =
      background.skycubeFormat === 'zip' || background.skycubeFormat === 'faces'
        ? background.skycubeFormat
        : hasAnyFace
          ? 'faces'
          : 'zip'

    if (skycubeFormat === 'zip') {
      const zipAssetId = background.skycubeZipAssetId ?? null
      const zipKey = computeEnvironmentAssetReloadKey(zipAssetId)

      if (!zipAssetId) {
        disposeBackgroundResources()
        scene.background = new THREE.Color(background.solidColor)
        return true
      }

      const sameAsPrevious =
        skyCubeTexture &&
        skyCubeSourceFormat === 'zip' &&
        (zipAssetId ?? null) === (skyCubeZipAssetId ?? null) &&
        (zipKey ?? null) === (skyCubeZipAssetKey ?? null)
      if (sameAsPrevious && skyCubeTexture) {
        scene.background = skyCubeTexture
        return true
      }

      const resolved = await resolveEnvironmentAssetUrl(zipAssetId)
      const zipUrl = resolved?.url ?? null
      if (!zipUrl) {
        console.warn('[SceneViewport] SkyCube zip URL unavailable', zipAssetId)
        return false
      }

      let buffer: ArrayBuffer | null = null
      try {
        const response = await fetch(zipUrl)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        buffer = await response.arrayBuffer()
      } catch (error) {
        console.warn('[SceneViewport] Failed to fetch SkyCube zip', zipAssetId, error)
        return false
      }

      if (token !== backgroundLoadToken) {
        return false
      }

      let extracted: ReturnType<typeof extractSkycubeZipFaces>
      try {
        extracted = extractSkycubeZipFaces(buffer)
      } catch (error) {
        console.warn('[SceneViewport] Failed to unzip SkyCube zip', zipAssetId, error)
        return false
      }

      if (extracted.missingFaces.length) {
        console.warn('[SceneViewport] SkyCube zip missing faces', extracted.missingFaces)
      }

      const { urls: faceUrls, dispose: disposeFaceUrls } = buildObjectUrlsFromSkycubeZipFaces(extracted.facesInOrder)

      const loaded = await loadSkyCubeTexture(faceUrls)
      if (!loaded.texture || token !== backgroundLoadToken) {
        disposeSkyCubeTexture(loaded.texture)
        disposeFaceUrls()
        if (loaded.error) {
          console.warn('[SceneViewport] Failed to load SkyCube background from zip', loaded.error)
        }
        return false
      }

      disposeBackgroundResources()
      skyCubeTexture = loaded.texture
      skyCubeSourceFormat = 'zip'
      skyCubeZipAssetId = zipAssetId
      skyCubeZipAssetKey = zipKey
      skyCubeZipFaceUrlCleanup = disposeFaceUrls
      skyCubeFaceAssetIds = [null, null, null, null, null, null]
      skyCubeFaceKeys = [null, null, null, null, null, null]
      scene.background = skyCubeTexture
      return true
    }

    const faceTags = ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const

    const faceKeys: Array<string | null> = faceAssetIds.map((assetId) => computeEnvironmentAssetReloadKey(assetId))

    if (!hasAnyFace) {
      disposeBackgroundResources()
      scene.background = new THREE.Color(background.solidColor)
      return true
    }

    const sameAsPrevious =
      skyCubeTexture &&
      faceAssetIds.every((id, index) => (id ?? null) === (skyCubeFaceAssetIds[index] ?? null)) &&
      faceKeys.every((key, index) => (key ?? null) === (skyCubeFaceKeys[index] ?? null))
    if (sameAsPrevious && skyCubeTexture) {
      scene.background = skyCubeTexture
      return true
    }

    const faceUrls: Array<string | null> = await Promise.all(
      faceAssetIds.map(async (assetId) => {
        if (!assetId) {
          return null
        }
        const resolved = await resolveEnvironmentAssetUrl(assetId)
        return resolved?.url ?? null
      }),
    )

    for (let i = 0; i < faceUrls.length; i += 1) {
      if (faceAssetIds[i] && !faceUrls[i]) {
        console.warn('[SceneViewport] SkyCube face URL unavailable', faceTags[i], faceAssetIds[i])
      }
    }

    const loaded = await loadSkyCubeTexture(faceUrls)
    if (!loaded.texture || token !== backgroundLoadToken) {
      disposeSkyCubeTexture(loaded.texture)
      if (loaded.error) {
        console.warn('[SceneViewport] Failed to load SkyCube background', loaded.error)
      }
      return false
    }

    if (loaded.missingFaces.length) {
      console.warn('[SceneViewport] SkyCube background missing faces', loaded.missingFaces)
    }

    disposeBackgroundResources()
    skyCubeTexture = loaded.texture
    skyCubeSourceFormat = 'faces'
    skyCubeFaceAssetIds = faceAssetIds
    skyCubeFaceKeys = faceKeys
    skyCubeZipAssetId = null
    skyCubeZipAssetKey = null
    skyCubeZipFaceUrlCleanup = null
    scene.background = skyCubeTexture
    return true
  }

  if (!background.hdriAssetId) {
    disposeGradientBackgroundResources()
    disposeBackgroundResources()
    scene.background = new THREE.Color(background.solidColor)
    return true
  }

  const hdriKey = computeEnvironmentAssetReloadKey(background.hdriAssetId)

  if (backgroundTexture && backgroundAssetId === background.hdriAssetId && backgroundAssetKey === hdriKey) {
    disposeGradientBackgroundResources()
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
  backgroundAssetKey = hdriKey
  scene.background = texture
  return true
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

  const backgroundApplied = await applyBackgroundSettings(snapshot.background)
  const environmentApplied = applyEnvironmentReflectionFromBackground(snapshot.background)

  applyEnvironmentTextureRotation(snapshot)

  if (backgroundApplied && environmentApplied) {
    pendingEnvironmentSettings = null
  } else {
    pendingEnvironmentSettings = snapshot
  }
  applyRendererShadowSetting()
  syncSceneCsmSunFromEnvironment(snapshot)
  updateFogForSelection()
}

function disposeSkyResources() {
  if (scene) {
    scene.environment = null
    scene.environmentIntensity = 1
  }
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

  // updateBillboardInstanceCameraWorldPosition(camera.position) // Removed: function not defined/imported

  let controlsUpdated = false

  if (cameraTransitionState && mapControls) {
    const t_cam0 = performance.now()
    const { startTime, duration, startPosition, startTarget, endPosition, endTarget, relativeOffset } = cameraTransitionState
    const elapsed = Math.max(performance.now() - startTime, 0)
    const progress = duration === 0 ? 1 : Math.min(elapsed / duration, 1)
    const eased = easeInOutCubic(progress)

    cameraTransitionCurrentTarget.copy(startTarget).lerp(endTarget, eased)
    if (relativeOffset) {
      cameraTransitionCurrentPosition.copy(cameraTransitionCurrentTarget).add(relativeOffset)
    } else {
      cameraTransitionCurrentPosition.copy(startPosition).lerp(endPosition, eased)
    }

    const previousApplying = isApplyingCameraState
    if (!previousApplying) {
      isApplyingCameraState = true
    }

    camera.position.copy(cameraTransitionCurrentPosition)
    mapControls.target.copy(cameraTransitionCurrentTarget)
    mapControls.update()
    applyViewportCompositionOffset(true)

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
    mapControls.update(effectiveDelta)
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
  landformBuildTool.flushPreviewIfNeeded(scene)
  regionBuildTool.flushPreviewIfNeeded(scene)
  waterBuildTool.flushPreviewIfNeeded(scene)
  updatePendingBuildStartIndicator()
  ensureDisplayBoardCornerHandlesForSelectedNode()
  // Endpoint gizmos: enlarge hit area to make dragging easier in edit modes.
  roadVertexRenderer.updateScreenSize({ camera, canvas: canvasRef.value, diameterPx: 46 })
  wallEndpointRenderer.updateScreenSize({
    camera,
    canvas: canvasRef.value,
    diameterPx: 52,
    freezeCircleFacing: !!wallCircleCenterDragState || !!wallCircleRadiusDragState,
  })
  floorVertexRenderer.updateScreenSize({ camera, canvas: canvasRef.value, diameterPx: 48 })
  landformVertexRenderer.updateScreenSize({ camera, canvas: canvasRef.value, diameterPx: 48 })
  regionVertexRenderer.updateScreenSize({ camera, canvas: canvasRef.value, diameterPx: 48 })
  floorCircleHandleRenderer.updateScreenSize({
    camera,
    canvas: canvasRef.value,
    diameterPx: 54,
    freezeCircleFacing: !!floorCircleCenterDragState || !!floorCircleRadiusDragState,
  })
  displayBoardCornerHandleRenderer.updateScreenSize({ camera, canvas: canvasRef.value, diameterPx: 48 })
  waterVertexRenderer.updateScreenSize({ camera, canvas: canvasRef.value, diameterPx: 48 })
  waterCircleHandleRenderer.updateScreenSize({ camera, canvas: canvasRef.value, diameterPx: 54 })
  // Directional light target handles: keep readable in very large scenes.
  directionalLightTargetHandleManager.updateScreenSize({ camera, canvas: canvasRef.value })
  updateVertexSnapHintPulse(performance.now())
  updatePlacementSideSnapHintPulse(performance.now())
  updateDebugVertexPoints(performance.now())
  updatePlaceholderOverlayPositions()
  if (gradientBackgroundDome) {
    gradientBackgroundDome.mesh.position.copy(camera.position)
  }
  const t_mid = performance.now()
  prof.renderPrep = t_mid - t_renderPrep
  gizmoControls?.cameraUpdate()
  if (props.activeTool === 'translate') {
    // alignment hint visuals disabled
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
  if (typeof updateGroundChunkStreaming === 'function') {
    const t_gc0 = performance.now()
    updateGroundChunkStreaming()
    prof.groundStreaming = performance.now() - t_gc0
  }

  const t0_scatter = performance.now()
  updateScatterLod()
  updateInstancedCullingAndBinding()
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
  // debug bounds update removed
  sceneCsmShadowRuntime?.update()
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
  if (stopInstancedMeshSubscription) {
    stopInstancedMeshSubscription()
    stopInstancedMeshSubscription = null
  }
  if (stopBillboardMeshSubscription) {
    stopBillboardMeshSubscription()
    stopBillboardMeshSubscription = null
  }
  instanceLayoutMatrixCache.clear()
  clearInstancedMeshes()
  instancedMeshRevision.value += 1
  instancedMeshGroup.removeFromParent()
  clearInstancedOutlineEntries()
  instancedOutlineGroup.removeFromParent()
  wallDoorSelectionController.clearWallDoorSelectionHighlight()
  wallDoorSelectionHighlightGroup.removeFromParent()

  directionalLightTargetHandleManager.clear()

  resizeObserver?.disconnect()
  resizeObserver = null

  // face snap controller disposed elsewhere (feature disabled)
  hasTransformLastWorldPosition = false

  if (canvasRef.value) {
    canvasRef.value.removeEventListener('pointerdown', handlePointerDown, { capture: true })
    canvasRef.value.removeEventListener('dblclick', handleCanvasDoubleClick, { capture: true })
    canvasRef.value.removeEventListener('contextmenu', handleViewportContextMenu)
    // Wheel debug listener removed.
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
  disposeSceneCsmShadowRuntime()
  disposeBackgroundResources()

  if (gizmoControls) {
    gizmoControls.dispose()
    gizmoControls = null
  }

  groundSelectionGroup.removeFromParent()
  scatterAreaPreviewGroup.removeFromParent()
  terrainSculptPreviewGroup.removeFromParent()
  vertexOverlayGroup.removeFromParent()
  clearVertexSnapMarkers()

  if (mapControls) {
    mapControls.removeEventListener('change', handleControlsChange)
    mapControls.resetFocalOffset(false)
    mapControls.dispose()
  }
  mapControls = null
  viewportCompositionOffsetPx.set(Number.NaN, Number.NaN)
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
  hideWarpGatePlacementPreview()
  warpGatePlacementPreviewController.group.removeFromParent()
  warpGatePlacementPreviewController.dispose()
  warpGatePlacementPreviewGroup.removeFromParent()

  clearSelectionHighlights()
  disposeNodePickerHighlight()
  disposeNodeFlashIndicator()
  if (sceneStore.nodeHighlightTargetId) {
    sceneStore.clearNodeHighlightRequest(sceneStore.nodeHighlightTargetId)
  }
  releaseGroundMeshCache()
  // debug helpers removed earlier
  scene = null
  camera = null
  perspectiveCamera = null

  clearPlaceholderOverlays()
  objectMap.clear()
  resetEffectRuntimeTickers()
  wallBuildTool.dispose()
  roadBuildTool.dispose()
  floorBuildTool.dispose()
  landformBuildTool.dispose()
  regionBuildTool.dispose()
  buildStartIndicatorRenderer?.dispose()
  buildStartIndicatorRenderer = null
  waterBuildTool.dispose()
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
  const isWall = (object.userData?.dynamicMeshType as string | null | undefined) === 'Wall'

  let yaw = 0
  if (isWall) {
    // Derive yaw by projecting the object's forward vector onto XZ, explicitly ignoring pitch/roll.
    object.getWorldQuaternion(selectionHighlightQuaternionHelper)
    selectionHighlightDirectionHelper.set(0, 0, 1).applyQuaternion(selectionHighlightQuaternionHelper)
    selectionHighlightDirectionHelper.y = 0
    if (selectionHighlightDirectionHelper.lengthSq() > 1e-10) {
      selectionHighlightDirectionHelper.normalize()
      yaw = Math.atan2(selectionHighlightDirectionHelper.x, selectionHighlightDirectionHelper.z)
    } else {
      // Fallback for degenerate forward vectors.
      selectionHighlightEulerHelper.setFromQuaternion(selectionHighlightQuaternionHelper, 'YXZ')
      yaw = Number.isFinite(selectionHighlightEulerHelper.y) ? selectionHighlightEulerHelper.y : 0
    }
  }

  let useOriented = false
  if (isWall) {
    useOriented = computeOrientedGroundRectFromObject(object, yaw, selectionHighlightPositionHelper, selectionHighlightSizeHelper)
  }

  if (!useOriented) {
    setBoundingBoxFromObject(object, selectionHighlightBoundingBox)
    if (!selectionHighlightBoundingBox.isEmpty()) {
      selectionHighlightBoundingBox.getCenter(selectionHighlightPositionHelper)
      selectionHighlightBoundingBox.getSize(selectionHighlightSizeHelper)
    } else {
      object.getWorldPosition(selectionHighlightPositionHelper)
      selectionHighlightSizeHelper.setScalar(0)
    }
    yaw = 0
  }

  const width = Math.max(selectionHighlightSizeHelper.x + GRID_HIGHLIGHT_PADDING * 2, GRID_HIGHLIGHT_MIN_SIZE)
  const depth = Math.max(selectionHighlightSizeHelper.z + GRID_HIGHLIGHT_PADDING * 2, GRID_HIGHLIGHT_MIN_SIZE)

  group.position.set(selectionHighlightPositionHelper.x, GRID_HIGHLIGHT_HEIGHT, selectionHighlightPositionHelper.z)
  group.rotation.set(0, yaw, 0)

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

function shouldSuppressNodeHighlightDuringBuildOrEdit(nodeId: string | null | undefined): boolean {
  if (!nodeId) {
    return false
  }

  const node = resolveSceneNodeById(nodeId)
  const meshType = node?.dynamicMesh?.type

  if (meshType === 'Wall') {
    return activeBuildTool.value === 'wall' || wallEditNodeId.value === nodeId
  }

  if (meshType === 'Road') {
    return activeBuildTool.value === 'road' || roadEditNodeId.value === nodeId
  }

  if (meshType === 'Floor') {
    return activeBuildTool.value === 'floor' || floorEditNodeId.value === nodeId
  }

  return false
}

function updateSelectionHighlights() {
  const shouldShowSelectedHighlight = (nodeId: string | null | undefined): boolean => {
    if (!nodeId) {
      return false
    }
    if (shouldSuppressNodeHighlightDuringBuildOrEdit(nodeId)) {
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

function shouldSuppressSelectionOutlineDuringEditing(): boolean {
  return Boolean(
    transformControls?.dragging
    || sceneStore.activeTransformNodeId
    || roadVertexDragState
    || floorVertexDragState
    || floorThicknessDragState
    || floorCircleCenterDragState
    || floorCircleRadiusDragState
    || floorEdgeDragState
    || wallEndpointDragState
    || wallJointDragState
    || wallHeightDragState
    || wallCircleCenterDragState
    || wallCircleRadiusDragState
    || waterContourVertexDragState
    || waterCircleCenterDragState
    || waterCircleRadiusDragState
    || waterEdgeDragState
    || displayBoardCornerDragState
  )
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
  if (shouldSuppressSelectionOutlineDuringEditing()) {
    clearOutlineSelectionTargets()
    return
  }

  const meshSet = new Set<THREE.Object3D>()
  const activeInstancedNodeIds = new Set<string>()
  const collectNodeOutline = (id: string | null | undefined, forceHighlight = false) => {
    if (!id) {
      return
    }
    if (!forceHighlight && shouldSuppressNodeHighlightDuringBuildOrEdit(id)) {
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
  }
  const idSources: Array<string | null | undefined> = [
    ...sceneStore.selectedNodeIds,
    props.selectedNodeId,
    sceneStore.selectedNodeId,
  ]

  idSources.forEach((id) => {
    collectNodeOutline(id, false)
  })

  collectNodeOutline(autoOverlayHoverNodeId.value, true)

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
  if (deduped.length !== 1 || deduped[0] !== wallEditNodeId.value) {
    clearWallEditMode()
  }
  if (deduped.length !== 1 || deduped[0] !== roadEditNodeId.value) {
    clearRoadEditMode()
  }
  if (deduped.length !== 1 || deduped[0] !== floorEditNodeId.value) {
    clearFloorEditMode()
  }
  if (deduped.length !== 1 || deduped[0] !== waterEditNodeId.value) {
    clearWaterEditMode()
  }
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

  if (!hit) {
    sceneStore.clearSelectedRoadSegment()
    if (!isToggle && !isRange) {
      emitSelectionChange([])
    }
    return
  }

  // Single click should never select nodes. If user clicks elsewhere in scene,
  // clear current selection to avoid requiring a ground-only deselect click.
  sceneStore.clearSelectedRoadSegment()
  const hitNodeId = typeof hit?.nodeId === 'string' ? hit.nodeId : null
  if (!hitNodeId) {
    return
  }
  const hitIsCurrentlySelected = Boolean(hitNodeId && currentSelection.includes(hitNodeId))

  if (isToggle) {
    const nextSelection = hitIsCurrentlySelected
      ? currentSelection.filter((id) => id !== hitNodeId)
      : [...currentSelection, hitNodeId]
    emitSelectionChange(nextSelection)
    return
  }

  if (hitIsCurrentlySelected) {
    return
  }
  if (!isToggle && !isRange) {
    emitSelectionChange([])
  }
  void options
}

async function beginDeferredDuplicateSelectionDrag(event: PointerEvent, trackingState: PointerTrackingState) {
  const deferred = trackingState.deferredDuplicateDrag
  const fallbackDrag = trackingState.selectionDrag
  if (!deferred?.nodeIds.length) {
    return fallbackDrag as any
  }

  const duplicateIds = sceneStore.duplicateNodes(deferred.nodeIds, { select: true })
  if (!duplicateIds.length) {
    return fallbackDrag as any
  }

  const duplicateNodes = duplicateIds
    .map((id) => findSceneNode(sceneStore.nodes, id))
    .filter((node): node is SceneNode => Boolean(node))

  if (duplicateNodes.length) {
    await sceneStore.ensureSceneAssetsReady({
      nodes: duplicateNodes,
      showOverlay: false,
      refreshViewport: false,
    })
  }

  await nextTick()
  await nextTick()

  const duplicatePrimaryId =
    sceneStore.selectedNodeId && duplicateIds.includes(sceneStore.selectedNodeId)
      ? sceneStore.selectedNodeId
      : duplicateIds[0] ?? null
  if (!duplicatePrimaryId) {
    return fallbackDrag as any
  }

  const object = objectMap.get(duplicatePrimaryId) ?? null
  if (!object) {
    return fallbackDrag as any
  }

  object.updateMatrixWorld(true)
  const dragPoint = trackingState.hitResult?.point?.clone()
    ?? (() => {
      const world = new THREE.Vector3()
      object.getWorldPosition(world)
      return world
    })()

  return createSelectionDragState(duplicatePrimaryId, object, dragPoint, event) as any
}

function raycastGroundPoint(event: PointerEvent, result: THREE.Vector3): boolean {
  if (!normalizedPointerGuard.setRayFromEvent(event)) {
    return false
  }
  return !!raycaster.ray.intersectPlane(groundPlane, result)
}

function resolveBuildPlacementPoint(event: PointerEvent, result: THREE.Vector3): boolean {
  if (!isTemporaryNavigationOverrideActive()) {
    const hit = pickNodeAtPointer(event)
    if (hit?.point) {
      result.copy(hit.point)
      return true
    }
  }
  return raycastGroundPoint(event, result)
}

function isEditorOnlyIntersectionObject(object: THREE.Object3D | null): boolean {
  let current: THREE.Object3D | null = object
  while (current) {
    const userData = current.userData as Record<string, unknown> | undefined
    if (userData?.pickableEditorOnly === true) {
      return false
    }
    if (userData?.editorOnly === true) {
      return true
    }
    current = current.parent ?? null
  }
  return false
}

function resolveIntersectionWorldNormal(intersection: THREE.Intersection): THREE.Vector3 | null {
  const faceNormal = intersection.face?.normal
  if (!faceNormal) {
    return null
  }
  const worldNormal = faceNormal.clone()
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(intersection.object.matrixWorld)
  return worldNormal.applyMatrix3(normalMatrix).normalize()
}

function resolveBuildSurfaceAtPointer(event: PointerEvent): {
  point: THREE.Vector3
  normal: THREE.Vector3
  nodeId: string | null
} | null {
  if (!normalizedPointerGuard.setRayFromEvent(event)) {
    return null
  }

  const intersections = collectSceneIntersections()
  for (const intersection of intersections) {
    if (!intersection?.point) {
      continue
    }
    const nodeId = resolveNodeIdFromIntersection(intersection)
    if (!nodeId) {
      continue
    }
    if (sceneStore.isNodeSelectionLocked(nodeId) || !sceneStore.isNodeVisible(nodeId)) {
      continue
    }
    const object = objectMap.get(nodeId) ?? null
    if (!object || !isObjectWorldVisible(object) || isEditorOnlyIntersectionObject(intersection.object as THREE.Object3D)) {
      continue
    }
    return {
      point: intersection.point.clone(),
      normal: resolveIntersectionWorldNormal(intersection) ?? new THREE.Vector3(0, 1, 0),
      nodeId,
    }
  }

  const groundPoint = new THREE.Vector3()
  if (raycastGroundPoint(event, groundPoint)) {
    return {
      point: groundPoint.clone(),
      normal: new THREE.Vector3(0, 1, 0),
      nodeId: GROUND_NODE_ID,
    }
  }

  return null
}

function resolveVertexSnapTargetNodeAtPointer(event: PointerEvent): {
  nodeId: string
  runtimeObject: THREE.Object3D
} | null {
  if (!normalizedPointerGuard.setRayFromEvent(event)) {
    return null
  }

  const intersections = collectSceneIntersections()
  for (const intersection of intersections) {
    const nodeId = resolveNodeIdFromIntersection(intersection)
    if (!nodeId) {
      continue
    }
    if (sceneStore.isNodeSelectionLocked(nodeId) || !sceneStore.isNodeVisible(nodeId)) {
      continue
    }
    if (isEditorOnlyIntersectionObject(intersection.object as THREE.Object3D)) {
      continue
    }
    const runtimeObject = objectMap.get(nodeId) ?? null
    if (!runtimeObject || !isObjectWorldVisible(runtimeObject)) {
      continue
    }
    return { nodeId, runtimeObject }
  }

  return null
}

function resolveVertexSnapAtPointer(
  event: PointerEvent,
  sourceWorld: THREE.Vector3,
  activeNormal: THREE.Vector3,
): { sourceWorld: THREE.Vector3; targetWorld: THREE.Vector3 } | null {
  const target = resolveVertexSnapTargetNodeAtPointer(event)
  if (!target) {
    return null
  }

  const maxDistance = GRID_MAJOR_SPACING * 0.5
  const maxDistanceSq = maxDistance * maxDistance
  const maxVertexScan = 60000
  const worldVertex = new THREE.Vector3()
  const worldDelta = new THREE.Vector3()
  let best: THREE.Vector3 | null = null
  let bestDistanceSq = Number.POSITIVE_INFINITY

  target.runtimeObject.updateWorldMatrix(true, true)
  target.runtimeObject.traverse((child) => {
    if (bestDistanceSq <= 1e-10) {
      return
    }
    const mesh = child as THREE.Mesh
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) {
      return
    }
    if ((mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) {
      return
    }
    if (!mesh.visible || isEditorOnlyIntersectionObject(mesh) || !isObjectWorldVisible(mesh)) {
      return
    }

    const geometry = mesh.geometry as THREE.BufferGeometry | undefined
    const position = geometry?.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!position || position.itemSize < 3 || position.count <= 0) {
      return
    }

    const step = Math.max(1, Math.ceil(position.count / maxVertexScan))
    for (let index = 0; index < position.count; index += step) {
      worldVertex.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld)
      worldDelta.copy(worldVertex).sub(sourceWorld)
      const planeDistance = Math.abs(activeNormal.dot(worldDelta))
      if (planeDistance > maxDistance) {
        continue
      }
      const distanceSq = worldDelta.lengthSq()
      if (distanceSq <= maxDistanceSq && distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq
        best = worldVertex.clone()
      }
    }
  })

  if (!best) {
    return null
  }

  return {
    sourceWorld: sourceWorld.clone(),
    targetWorld: best,
  }
}

function raycastPlanePoint(event: PointerEvent, plane: THREE.Plane, result: THREE.Vector3): boolean {
  if (!normalizedPointerGuard.setRayFromEvent(event)) {
    return false
  }
  return !!raycaster.ray.intersectPlane(plane, result)
}

function createEndpointDragPlane(options: {
  mode: 'free' | 'axis'
  axisWorld: THREE.Vector3 | null
  startPointWorld: THREE.Vector3
  freePlaneNormal?: THREE.Vector3
}): THREE.Plane {
  const start = options.startPointWorld
  const plane = new THREE.Plane()

  if (options.mode === 'free' || !options.axisWorld) {
    const n = (options.freePlaneNormal ?? new THREE.Vector3(0, 1, 0)).clone().normalize()
    return plane.setFromNormalAndCoplanarPoint(n, start)
  }

  // Axis drag: plane that contains the axis and is (roughly) perpendicular to camera direction.
  const axis = options.axisWorld.clone().normalize()
  const cameraDir = new THREE.Vector3(0, 0, -1)
  if (camera) {
    camera.getWorldDirection(cameraDir)
  }

  const tmp = new THREE.Vector3()
  // normal = axis x (cameraDir x axis)
  tmp.crossVectors(cameraDir, axis)
  if (tmp.lengthSq() < 1e-8) {
    tmp.crossVectors(new THREE.Vector3(0, 1, 0), axis)
  }
  const normal = new THREE.Vector3().crossVectors(axis, tmp)
  if (normal.lengthSq() < 1e-8) {
    return plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), start)
  }
  normal.normalize()
  return plane.setFromNormalAndCoplanarPoint(normal, start)
}

function cancelBuildSessionForTool(tool: BuildTool): void {
  if (tool === 'wall' && wallBuildTool.getSession()) {
    wallBuildTool.cancel()
    return
  }
  if (tool === 'road' && roadBuildTool.getSession()) {
    roadBuildTool.cancel()
    return
  }
  if (tool === 'floor' && floorBuildTool.getSession()) {
    floorBuildTool.cancel()
    return
  }
  if (tool === 'landform' && landformBuildTool.getSession()) {
    landformBuildTool.cancel()
    return
  }
  if (tool === 'region' && regionBuildTool.getSession()) {
    regionBuildTool.cancel()
    return
  }
  if (tool === 'water' && waterBuildTool.getSession()) {
    waterBuildTool.cancel()
  }
}

function resolveBuildToolForNode(node: any): BuildTool | null {
  const dynamicMeshType = node?.dynamicMesh?.type as string | undefined
  return isWaterSurfaceNode(node)
    ? 'water'
    : isDisplayBoardNode(node)
    ? 'displayBoard'
    : dynamicMeshType === 'Wall'
    ? 'wall'
    : dynamicMeshType === 'Floor'
    ? 'floor'
    : dynamicMeshType === 'Landform'
    ? 'landform'
    : dynamicMeshType === 'Region'
    ? 'region'
    : dynamicMeshType === 'Road'
    ? 'road'
    : null
}

function resolveBuildToolForNodeId(nodeId: string | null | undefined): BuildTool | null {
  return resolveBuildToolForNode(resolveSceneNodeById(nodeId))
}

function tryEnterNodeBuildToolEditMode(nodeId: string, toolForNode: BuildTool | null): boolean {
  if (!toolForNode) {
    return false
  }
  const hitNode: any = resolveSceneNodeById(nodeId)
  const nodeLocked = Boolean(hitNode?.locked) || sceneStore.isNodeSelectionLocked(nodeId)
  if (nodeLocked) {
    return false
  }

  cancelBuildSessionForTool(toolForNode)

  if (toolForNode === 'wall') {
    enterWallEditMode(nodeId)
  } else if (toolForNode === 'road') {
    enterRoadEditMode(nodeId)
  } else if (toolForNode === 'floor') {
    enterFloorEditMode(nodeId)
  } else if (toolForNode === 'landform') {
    enterLandformEditMode(nodeId)
  } else if (toolForNode === 'region') {
    enterRegionEditMode(nodeId)
  } else if (toolForNode === 'water') {
    enterWaterEditMode(nodeId)
  }

  handleBuildToolChange(toolForNode)
  emitSelectionChange([nodeId])
  return true
}

function refreshBuildStartIndicatorAfterEditExit(event?: MouseEvent | PointerEvent): void {
  hideBuildStartIndicator()
  if (!event || !activeBuildTool.value) {
    return
  }
  if (activeBuildTool.value !== 'wall' && activeBuildTool.value !== 'road' && activeBuildTool.value !== 'floor' && activeBuildTool.value !== 'landform' && activeBuildTool.value !== 'region' && activeBuildTool.value !== 'water') {
    return
  }
  if (isTemporaryNavigationOverrideActive()) {
    return
  }
  if (activeBuildTool.value === 'wall' && isSelectedWallEditMode()) {
    return
  }
  if (activeBuildTool.value === 'road' && isSelectedRoadEditMode()) {
    return
  }
  if (activeBuildTool.value === 'floor' && isSelectedFloorEditMode()) {
    return
  }
  if (activeBuildTool.value === 'landform' && isSelectedLandformEditMode()) {
    return
  }
  if (activeBuildTool.value === 'region' && isSelectedRegionEditMode()) {
    return
  }
  if (activeBuildTool.value === 'water' && isSelectedWaterEditMode()) {
    return
  }

  const point = new THREE.Vector3()
  if (resolveBuildPlacementPoint(event as PointerEvent, point)) {
    showBuildStartIndicator(point)
  }
}

function tryExitActiveNodeBuildToolEditMode(event?: MouseEvent | PointerEvent): boolean {
  if (activeBuildTool.value === 'wall' && isSelectedWallEditMode()) {
    clearWallEditMode()
    setActiveWallEndpointHandle(null)
    wallEndpointRenderer.clearHover()
    wallEndpointRenderer.clear()
    refreshBuildStartIndicatorAfterEditExit(event)
    return true
  }
  if (activeBuildTool.value === 'road' && isSelectedRoadEditMode()) {
    clearRoadEditMode()
    setActiveRoadVertexHandle(null)
    roadVertexRenderer.clearHover()
    roadVertexRenderer.clear()
    refreshBuildStartIndicatorAfterEditExit(event)
    return true
  }
  if (activeBuildTool.value === 'floor' && isSelectedFloorEditMode()) {
    clearFloorEditMode()
    setActiveFloorVertexHandle(null)
    setActiveFloorCircleHandle(null)
    floorVertexRenderer.clearHover()
    floorCircleHandleRenderer.clearHover()
    floorVertexRenderer.clear()
    floorCircleHandleRenderer.clear()
    refreshBuildStartIndicatorAfterEditExit(event)
    return true
  }
  if (activeBuildTool.value === 'landform' && isSelectedLandformEditMode()) {
    clearLandformEditMode()
    setActiveLandformVertexHandle(null)
    landformVertexRenderer.clearHover()
    landformVertexRenderer.clear()
    refreshBuildStartIndicatorAfterEditExit(event)
    return true
  }
  if (activeBuildTool.value === 'region' && isSelectedRegionEditMode()) {
    clearRegionEditMode()
    setActiveRegionVertexHandle(null)
    regionVertexRenderer.clearHover()
    regionVertexRenderer.clear()
    refreshBuildStartIndicatorAfterEditExit(event)
    return true
  }
  if (activeBuildTool.value === 'water' && isSelectedWaterEditMode()) {
    clearWaterEditMode()
    setActiveWaterVertexHandle(null)
    setActiveWaterCircleHandle(null)
    waterVertexRenderer.clearHover()
    waterCircleHandleRenderer.clearHover()
    waterVertexRenderer.clear()
    waterCircleHandleRenderer.clear()
    refreshBuildStartIndicatorAfterEditExit(event)
    return true
  }
  if (activeBuildTool.value === 'displayBoard' && isSelectedDisplayBoardEditMode()) {
    emitSelectionChange([])
    clearDisplayBoardSizeHud()
    setActiveDisplayBoardCornerHandle(null)
    displayBoardCornerHandleRenderer.clearHover()
    displayBoardCornerHandleRenderer.clear()
    refreshBuildStartIndicatorAfterEditExit(event)
    return true
  }
  return false
}

async function handlePointerDown(event: PointerEvent) {
  const applyPointerDownResult = (result: PointerDownResult) => {
    if (result.clearPointerTrackingState) {
      pointerTrackingState = null
    }
    if (Object.prototype.hasOwnProperty.call(result, 'nextInstancedEraseDragState')) {
      instancedEraseDragState = result.nextInstancedEraseDragState ?? null
    }
    if (Object.prototype.hasOwnProperty.call(result, 'nextRoadVertexDragState')) {
      roadVertexDragState = result.nextRoadVertexDragState ?? null
    }
    if (Object.prototype.hasOwnProperty.call(result, 'nextFloorVertexDragState')) {
      floorVertexDragState = result.nextFloorVertexDragState ?? null
    }
    if (Object.prototype.hasOwnProperty.call(result, 'nextFloorThicknessDragState')) {
      floorThicknessDragState = result.nextFloorThicknessDragState ?? null
    }
    if (Object.prototype.hasOwnProperty.call(result, 'nextFloorCircleCenterDragState')) {
      floorCircleCenterDragState = result.nextFloorCircleCenterDragState ?? null
    }
    if (Object.prototype.hasOwnProperty.call(result, 'nextFloorCircleRadiusDragState')) {
      floorCircleRadiusDragState = result.nextFloorCircleRadiusDragState ?? null
    }
    if (Object.prototype.hasOwnProperty.call(result, 'nextWallEndpointDragState')) {
      wallEndpointDragState = result.nextWallEndpointDragState ?? null
    }
    if (Object.prototype.hasOwnProperty.call(result, 'nextWallJointDragState')) {
      wallJointDragState = (result as any).nextWallJointDragState ?? null
    }
    if (Object.prototype.hasOwnProperty.call(result, 'nextWallHeightDragState')) {
      wallHeightDragState = result.nextWallHeightDragState ?? null
    }
    if (Object.prototype.hasOwnProperty.call(result, 'nextWallCircleCenterDragState')) {
      wallCircleCenterDragState = (result as any).nextWallCircleCenterDragState ?? null
    }
    if (Object.prototype.hasOwnProperty.call(result, 'nextWallCircleRadiusDragState')) {
      wallCircleRadiusDragState = (result as any).nextWallCircleRadiusDragState ?? null
    }
    if (result.preventDefault) {
      event.preventDefault()
    }
    if (result.stopPropagation) {
      event.stopPropagation()
    }
    if (result.stopImmediatePropagation) {
      event.stopImmediatePropagation()
    }
    if (typeof result.capturePointerId === 'number') {
      pointerInteraction.capture(result.capturePointerId)
    }
    if (Object.prototype.hasOwnProperty.call(result, 'nextPointerTrackingState')) {
      pointerTrackingState = result.nextPointerTrackingState ?? null
    }
  }

  const guard = handlePointerDownGuards(event, {
    hasCanvas: !!canvasRef.value,
    hasCamera: !!camera,
    hasScene: !!scene,
    isAltOverrideActive: isTemporaryNavigationOverrideActive(),
  })
  if (guard) {
    applyPointerDownResult(guard)
    return
  }

  if (maybeApplyShiftLeftClickFocus(event)) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }
  maybeBeginShiftOrbitPivotSession(event)

  // Fallback for cases where build-tool pointer handlers suppress browser dblclick events.
  if (event.button === 0 && !isTemporaryNavigationOverrideActive() && event.detail >= 2) {
    if (activeBuildTool.value && tryExitActiveNodeBuildToolEditMode(event)) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
    if (activeBuildTool.value) {
      return
    }

    flushPendingScenePatchesForInteraction()
    const hit = pickNodeAtPointer(event)
    if (hit) {
      const hitNodeId = hit.nodeId
      handleViewportDoubleClickNode(hitNodeId)
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
  }

  if (
    event.button === 0 &&
    wallDoorSelectModeActive.value &&
    activeBuildTool.value === 'wall' &&
    selectedNodeIsWall.value &&
    !isTemporaryNavigationOverrideActive()
  ) {
    wallDoorRectangleSelectionState = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      moved: false,
    }
    clearWallDoorSelectionPayload()
    wallDoorSelectionController.updateWallDoorSelectionOverlayBox(wallDoorRectangleSelectionState, wallDoorSelectionOverlayBox)
    pointerInteraction.capture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  // Track middle click vs drag so we can preserve "middle click cancels tool" while
  // ensuring "middle drag pans camera" does not cancel tools on release.
  if (event.button === 1) {
    const planarPanActive = sceneStore.viewportSettings.cameraControlMode === 'map' && Boolean(mapControls?.enabled)
    middleClickSessionState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      planarPanActive,
    }

    if (planarPanActive) {
      mapControls?.beginPlanarPanGesture(event.pointerId, event.clientX, event.clientY)
    }

    if (sceneStore.viewportSettings.cameraControlMode === 'map') {
      event.preventDefault()
      return
    }
  }

  if (activeBuildTool.value === 'warpGate') {
    if (event.button === 0) {
      warpGatePlacementClickSessionState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      }
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }

    if (event.button === 2) {
      pointerInteraction.beginBuildToolRightClick(event, { roadCancelEligible: false })
      return
    }
  }

  const selectedAssetId = sceneStore.selectedAssetId
  const selectedAsset = selectedAssetId ? sceneStore.getAsset(selectedAssetId) : null
  const pendingPlacementItem = pendingViewportPlacement.value
  const canPlaceSelectedAsset =
    Boolean(selectedAssetId) &&
    Boolean(selectedAsset) &&
    (selectedAsset?.type === 'model' || selectedAsset?.type === 'mesh' || selectedAsset?.type === 'prefab' || selectedAsset?.type === 'lod') &&
    !isWallPresetAsset(selectedAsset) &&
    !sceneStore.draggingAssetId

  if (event.button === 0 && canPlaceSelectedAsset) {
    assetPlacementClickSessionState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      assetId: selectedAssetId as string,
    }
    return
  }

  if (event.button === 0 && pendingPlacementItem) {
    nodePlacementClickSessionState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      itemId: getViewportPlacementKey(pendingPlacementItem),
    }
    return
  }

  // Scatter erase mode: when a wall node is selected, erase by raycasting the wall object itself.
  // This ensures procedural wall geometry is erasable even when no instanced pick targets exist.
  if (scatterEraseModeActive.value && selectedNodeIsWall.value && event.button === 0) {
    if (normalizedPointerGuard.setRayFromEvent(event)) {
      const target = resolveSelectedWallEraseTargetFromCurrentRay()
      if (target) {
        const handled = applySelectedWallEraseTarget(target)
        if (handled) {
          const dragState: InstancedEraseDragState = {
            pointerId: event.pointerId,
            lastKey: target.dragKey,
            lastAtMs: performance.now(),
          }
          applyPointerDownResult({
            handled: true,
            clearPointerTrackingState: true,
            nextInstancedEraseDragState: dragState,
            capturePointerId: event.pointerId,
            preventDefault: true,
            stopPropagation: true,
            stopImmediatePropagation: true,
          })
          return
        }
      }
    }
  }

  const scatter = handlePointerDownScatter(event, {
    scatterEraseModeActive: scatterEraseModeActive.value,
    hasInstancedMeshes: hasInstancedMeshes.value,
    selectedNodeIsGround: selectedNodeIsGround.value,
    activeTool: props.activeTool,
    activeBuildTool: activeBuildTool.value,
    selectedNodeId: sceneStore.selectedNodeId ?? props.selectedNodeId ?? null,
    nodes: sceneStore.nodes,
    objectMap,
    isNodeSelectionLocked: (nodeId) => sceneStore.isNodeSelectionLocked(nodeId),
    findSceneNode,
    pickSceneInstancedTargetAtPointer,
    tryEraseRepairTargetAtPointer,
    beginRepairClick: (e) => pointerInteraction.beginRepairClick(e),
    handleGroundEditorPointerDown,
  })
  if (scatter) {
    applyPointerDownResult(scatter)
    return
  }

  // If the floor shape/preset menu is open, close it when the user starts drawing in the viewport.
  // Keep the menu open for rapid selection, but once the user clicks the canvas to place points,
  // it should dismiss to avoid blocking the view.
  if (event.button === 0 && activeBuildTool.value === 'floor' && floorShapeMenuOpen.value) {
    floorShapeMenuOpen.value = false
  }

  if (event.button === 0 && activeBuildTool.value === 'landform' && landformShapeMenuOpen.value) {
    landformShapeMenuOpen.value = false
  }

  // If the wall shape menu is open, close it when the user starts drawing in the viewport.
  // This prevents the menu from covering the scene while placing wall points.
  if (event.button === 0 && activeBuildTool.value === 'wall' && wallShapeMenuOpen.value) {
    wallShapeMenuOpen.value = false
  }

  if (event.button === 0 && activeBuildTool.value === 'road' && roadShapeMenuOpen.value) {
    roadShapeMenuOpen.value = false
  }

  if (event.button === 0 && activeBuildTool.value === 'water' && waterShapeMenuOpen.value) {
    waterShapeMenuOpen.value = false
  }

  if (tryOpenAutoOverlayDialog(event)) {
    return
  }

  const wallEditModeLocked = activeBuildTool.value === 'wall' && isSelectedWallEditMode()
  const floorEditModeLocked = activeBuildTool.value === 'floor' && isSelectedFloorEditMode()
  const landformEditModeLocked = activeBuildTool.value === 'landform' && isSelectedLandformEditMode()
  const regionEditModeLocked = activeBuildTool.value === 'region' && isSelectedRegionEditMode()
  const roadEditModeLocked = activeBuildTool.value === 'road' && isSelectedRoadEditMode()
  const waterEditModeLocked = activeBuildTool.value === 'water' && isSelectedWaterEditMode()
  const displayBoardEditModeLocked = activeBuildTool.value === 'displayBoard' && isSelectedDisplayBoardEditMode()

  if (activeBuildTool.value === 'region') {
    if (event.button === 0 && !isTemporaryNavigationOverrideActive()) {
      if (regionEditModeLocked && selectedNodeIsRegion.value) {
        ensureRegionVertexHandlesForSelectedNode()
      }
      if (tryBeginRegionVertexDrag(event)) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }

      if (!regionEditModeLocked) {
        regionBuildTool.handlePointerDown(event)
      }
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }

    if (event.button === 2) {
      if (!regionEditModeLocked) {
        regionBuildTool.handlePointerDown(event)
      }
      pointerInteraction.beginBuildToolRightClick(event, { roadCancelEligible: false })
      return
    }
  }

  if (activeBuildTool.value === 'landform') {
    if (event.button === 0 && !isTemporaryNavigationOverrideActive()) {
      if (landformEditModeLocked && selectedNodeIsLandform.value) {
        ensureLandformVertexHandlesForSelectedNode()
      }
      if (tryBeginLandformVertexDrag(event)) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }

      if (!landformEditModeLocked) {
        landformBuildTool.handlePointerDown(event)
      }
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }

    if (event.button === 2) {
      if (!landformEditModeLocked) {
        landformBuildTool.handlePointerDown(event)
      }
      pointerInteraction.beginBuildToolRightClick(event, { roadCancelEligible: false })
      return
    }
  }

  if (activeBuildTool.value === 'displayBoard') {
    if (event.button === 0 && !isTemporaryNavigationOverrideActive() && !displayBoardBuildTool.getSession()) {
      ensureDisplayBoardCornerHandlesForSelectedNode()
      if (tryBeginDisplayBoardCornerDrag(event)) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }
    }
    if (event.button === 0 && !isTemporaryNavigationOverrideActive()) {
      if (!displayBoardEditModeLocked && displayBoardBuildTool.handlePointerDown(event)) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }
      if (displayBoardEditModeLocked) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }
    }

    if (event.button === 2) {
      pointerInteraction.beginBuildToolRightClick(event, { roadCancelEligible: false })
      return
    }
  }

  if (activeBuildTool.value === 'water') {
    if (event.button === 0 && !isTemporaryNavigationOverrideActive()) {
      ensureWaterCircleHandlesForSelectedNode()
      ensureWaterVertexHandlesForSelectedNode()

      if (tryBeginWaterCircleDrag(event)) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }

      if (tryBeginWaterVertexDrag(event)) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }

      if (tryBeginWaterEdgeDrag(event)) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }

      if (!waterEditModeLocked) {
        waterBuildTool.handlePointerDown(event)
      }
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }

    if (event.button === 2) {
      if (!waterEditModeLocked) {
        waterBuildTool.handlePointerDown(event)
      }
      pointerInteraction.beginBuildToolRightClick(event, { roadCancelEligible: false })
      return
    }
  }

  const tools = handlePointerDownTools(event, {
    activeBuildTool: activeBuildTool.value,
    wallBuildShape: wallBuildShape.value,
    floorBuildShape: floorBuildShape.value,
    wallEditModeActive: wallEditModeLocked,
    floorEditModeActive: floorEditModeLocked,
    roadEditModeActive: roadEditModeLocked,
    floorCircleEditModeActive: isSelectedFloorCircleEditMode(),
    isAltOverrideActive: isTemporaryNavigationOverrideActive(),
    nodePickerActive: nodePickerStore.isActive,
    nodePickerCompletePick: (nodeId) => {
      if (canCompleteNodePick(nodeId)) {
        nodePickerStore.completePick(nodeId)
      }
    },
    hideNodePickerHighlight,
    pickNodeAtPointer: (e) => pickNodeAtPointer(e),
    wallBuildToolHandlePointerDown: (e) => wallBuildTool.handlePointerDown(e),
    floorBuildToolHandlePointerDown: (e) => floorBuildTool.handlePointerDown(e),
    roadBuildToolGetSession: () => roadBuildTool.getSession(),
    beginBuildToolRightClick: (e, options) => pointerInteraction.beginBuildToolRightClick(e, options),
    tryBeginFloorEdgeDrag,

    ensureFloorVertexHandlesForSelectedNode: () => ensureFloorVertexHandlesForSelectedNode(),
    pickFloorVertexHandleAtPointer,
    setActiveFloorVertexHandle,

    ensureFloorCircleHandlesForSelectedNode: () => ensureFloorCircleHandlesForSelectedNode(),
    pickFloorCircleHandleAtPointer,
    setActiveFloorCircleHandle,

    ensureRoadVertexHandlesForSelectedNode: () => ensureRoadVertexHandlesForSelectedNode(),
    pickRoadVertexHandleAtPointer,
    setActiveRoadVertexHandle,
    ensureWallEndpointHandlesForSelectedNode: () => ensureWallEndpointHandlesForSelectedNode(),
    pickWallEndpointHandleAtPointer,

    setActiveWallEndpointHandle,
    createEndpointDragPlane,
    raycastGroundPoint,
    raycastPlanePoint,

    nodes: sceneStore.nodes,
    findSceneNode,
    objectMap,
  })
  if (tools) {
    applyPointerDownResult(tools)
    return
  }

  const effectiveSelectionTool = uiStore.activeSelectionContext ? 'blocked' : props.activeTool

  // Left click should preserve click-selection semantics, but in camera-control modes
  // any press that does not land on the current selection should allow a drag camera gesture.
  // This applies to all transform tools (select/translate/rotate/scale) so the viewport
  // remains controllable even when a non-select tool is active.  Skip when the transform
  // gizmo axis is hovered (transformControls.axis is set) — that click belongs to the gizmo.
  if (event.button === 0 && effectiveSelectionTool !== 'blocked' && !transformControls?.axis) {
    const activeSelectionNode = resolveSceneNodeById(sceneStore.selectedNodeId ?? props.selectedNodeId ?? null)
    const allowBoundingBoxFallback = !isNodeExcludedFromSelectionBoundingBoxFallback(activeSelectionNode)
    const directHit = pickNodeAtPointer(event)
    const boundingBoxHit = !directHit && allowBoundingBoxFallback ? pickActiveSelectionBoundingBoxHit(event) : null
    const selectedNodeIds = sceneStore.selectedNodeIds
    const hitBelongsToSelection = Boolean(
      directHit && (
        selectedNodeIds.includes(directHit.nodeId)
        || selectedNodeIds.some((selectedNodeId) => sceneStore.isDescendant(selectedNodeId, directHit.nodeId))
      ),
    )
    const shouldStartCameraSession = !hitBelongsToSelection

    if (shouldStartCameraSession) {
      let cameraGesture: LeftEmptyClickSessionState['cameraGesture'] = 'none'
      if (Boolean(mapControls?.enabled)) {
        if (sceneStore.viewportSettings.cameraControlMode === 'map') {
          cameraGesture = 'planar-pan'
        } else if (sceneStore.viewportSettings.cameraControlMode === 'orbit') {
          cameraGesture = 'orbit-rotate'
        }
      }
      if (cameraGesture === 'planar-pan') {
        mapControls?.beginPlanarPanGesture(event.pointerId, event.clientX, event.clientY)
      } else if (cameraGesture === 'orbit-rotate') {
        mapControls?.beginTransientLeftRotateGesture()
      }
      leftEmptyClickSessionState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        clickHitResult: directHit ?? boundingBoxHit,
        cameraGesture,
      }
      return
    }
  }

  const selection = await handlePointerDownSelection(event, {
    activeTool: effectiveSelectionTool,
    selectedNodeIdProp: props.selectedNodeId ?? null,
    sceneSelectedNodeId: sceneStore.selectedNodeId ?? null,
    selectedNodeIds: sceneStore.selectedNodeIds,
    nodes: sceneStore.nodes,
    findSceneNode,
    isNodeSelectionLocked: (nodeId) => sceneStore.isNodeSelectionLocked(nodeId),
    isDescendant: (ancestorId, nodeId) => sceneStore.isDescendant(ancestorId, nodeId),
    duplicateNodes: (nodeIds, options) => sceneStore.duplicateNodes(nodeIds, options),
    ensureSceneAssetsReady: (options) => sceneStore.ensureSceneAssetsReady(options),
    nextTick,
    objectMap,
    pickNodeAtPointer,
    pickActiveSelectionBoundingBoxHit,
    transformControlsDragging: Boolean(transformControls?.dragging),
    transformControlsAxis: transformControls?.axis ?? null,
    cameraControlMode: sceneStore.viewportSettings.cameraControlMode,
    createSelectionDragState,
    disableOrbitForSelectDrag,
  })

  if (selection) {
    applyPointerDownResult(selection)

    // Only block OrbitControls left-pan when we are starting a selection drag
    // (i.e. dragging the currently selected object). Otherwise allow pan.
    if (
      event.button === 0 &&
      effectiveSelectionTool === 'select' &&
      Boolean(pointerTrackingState?.selectionDrag)
    ) {
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    return
  }
}

function handlePointerMove(event: PointerEvent) {
  // surface snap pointer updates removed (alignment hint disabled)
  lastPointerClientX = event.clientX
  lastPointerClientY = event.clientY
  lastPointerType = event.pointerType
  updateAutoOverlayHoverIndicator(event)

  // (debug hover capture removed)

  if (shiftOrbitPivotSessionState && shiftOrbitPivotSessionState.pointerId === event.pointerId && !event.shiftKey) {
    clearShiftOrbitPivotSession(event.pointerId)
  }

  if (middleClickSessionState && middleClickSessionState.pointerId === event.pointerId && !middleClickSessionState.moved) {
    const dx = event.clientX - middleClickSessionState.startX
    const dy = event.clientY - middleClickSessionState.startY
    if (Math.hypot(dx, dy) >= CLICK_DRAG_THRESHOLD_PX) {
      middleClickSessionState.moved = true
    }
  }

  if (middleClickSessionState?.pointerId === event.pointerId && middleClickSessionState.planarPanActive && middleClickSessionState.moved) {
    mapControls?.updatePlanarPanGesture(event.pointerId, event.clientX, event.clientY)
  }

  if (leftEmptyClickSessionState && leftEmptyClickSessionState.pointerId === event.pointerId && !leftEmptyClickSessionState.moved) {
    const dx = event.clientX - leftEmptyClickSessionState.startX
    const dy = event.clientY - leftEmptyClickSessionState.startY
    if (Math.hypot(dx, dy) >= CLICK_DRAG_THRESHOLD_PX) {
      leftEmptyClickSessionState.moved = true
    }
  }

  if (leftEmptyClickSessionState?.pointerId === event.pointerId && leftEmptyClickSessionState.cameraGesture === 'planar-pan' && leftEmptyClickSessionState.moved) {
    mapControls?.updatePlanarPanGesture(event.pointerId, event.clientX, event.clientY)
  }

  if (assetPlacementClickSessionState && assetPlacementClickSessionState.pointerId === event.pointerId && !assetPlacementClickSessionState.moved) {
    const dx = event.clientX - assetPlacementClickSessionState.startX
    const dy = event.clientY - assetPlacementClickSessionState.startY
    if (Math.hypot(dx, dy) >= CLICK_DRAG_THRESHOLD_PX) {
      assetPlacementClickSessionState.moved = true
    }
  }

  if (nodePlacementClickSessionState && nodePlacementClickSessionState.pointerId === event.pointerId && !nodePlacementClickSessionState.moved) {
    const dx = event.clientX - nodePlacementClickSessionState.startX
    const dy = event.clientY - nodePlacementClickSessionState.startY
    if (Math.hypot(dx, dy) >= CLICK_DRAG_THRESHOLD_PX) {
      nodePlacementClickSessionState.moved = true
    }
  }

  if (warpGatePlacementClickSessionState && warpGatePlacementClickSessionState.pointerId === event.pointerId && !warpGatePlacementClickSessionState.moved) {
    const dx = event.clientX - warpGatePlacementClickSessionState.startX
    const dy = event.clientY - warpGatePlacementClickSessionState.startY
    if (Math.hypot(dx, dy) >= CLICK_DRAG_THRESHOLD_PX) {
      warpGatePlacementClickSessionState.moved = true
    }
  }

  if (wallDoorRectangleSelectionState && wallDoorRectangleSelectionState.pointerId === event.pointerId) {
    wallDoorRectangleSelectionState.currentClientX = event.clientX
    wallDoorRectangleSelectionState.currentClientY = event.clientY
    if (!wallDoorRectangleSelectionState.moved) {
      const dx = event.clientX - wallDoorRectangleSelectionState.startClientX
      const dy = event.clientY - wallDoorRectangleSelectionState.startClientY
      if (Math.hypot(dx, dy) >= CLICK_DRAG_THRESHOLD_PX) {
        wallDoorRectangleSelectionState.moved = true
      }
    }
    wallDoorSelectionController.updateWallDoorSelectionOverlayBox(wallDoorRectangleSelectionState, wallDoorSelectionOverlayBox)
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  const applyPointerMoveResult = (result: PointerMoveResult) => {
    if (result.preventDefault) {
      event.preventDefault()
    }
    if (result.stopPropagation) {
      event.stopPropagation()
    }
    if (result.stopImmediatePropagation) {
      event.stopImmediatePropagation()
    }
  }

  // Hover highlight for endpoint gizmos (mouse only, no active drag).
  const canHoverGizmos =
    event.pointerType === 'mouse' &&
    !roadVertexDragState &&
    !floorVertexDragState &&
    !regionContourVertexDragState &&
    !landformContourVertexDragState &&
    !displayBoardCornerDragState &&
    !waterContourVertexDragState &&
    !waterCircleCenterDragState &&
    !waterCircleRadiusDragState &&
    !waterEdgeDragState &&
    !floorThicknessDragState &&
    !floorCircleCenterDragState &&
    !floorCircleRadiusDragState &&
    !wallCircleCenterDragState &&
    !wallCircleRadiusDragState &&
    !wallEndpointDragState &&
    !wallJointDragState &&
    !wallHeightDragState &&
    isStrictPointOnCanvas(event.clientX, event.clientY)

  if (canHoverGizmos) {
    ensureRoadVertexHandlesForSelectedNode()
    ensureWallEndpointHandlesForSelectedNode()
    ensureFloorVertexHandlesForSelectedNode()
    ensureLandformVertexHandlesForSelectedNode()
    ensureRegionVertexHandlesForSelectedNode()
    ensureFloorCircleHandlesForSelectedNode()
    ensureDisplayBoardCornerHandlesForSelectedNode()
    ensureWaterVertexHandlesForSelectedNode()
    ensureWaterCircleHandlesForSelectedNode()

    roadVertexRenderer.updateHover({ camera, canvas: canvasRef.value, event, pointer, raycaster })
    wallEndpointRenderer.updateHover({ camera, canvas: canvasRef.value, event, pointer, raycaster })
    floorVertexRenderer.updateHover({ camera, canvas: canvasRef.value, event, pointer, raycaster })
    landformVertexRenderer.updateHover({ camera, canvas: canvasRef.value, event, pointer, raycaster })
    regionVertexRenderer.updateHover({ camera, canvas: canvasRef.value, event, pointer, raycaster })
    floorCircleHandleRenderer.updateHover({ camera, canvas: canvasRef.value, event, pointer, raycaster })
    displayBoardCornerHandleRenderer.updateHover({ camera, canvas: canvasRef.value, event, pointer, raycaster })
    waterVertexRenderer.updateHover({ camera, canvas: canvasRef.value, event, pointer, raycaster })
    waterCircleHandleRenderer.updateHover({ camera, canvas: canvasRef.value, event, pointer, raycaster })
  } else {
    roadVertexRenderer.clearHover()
    wallEndpointRenderer.clearHover()
    floorVertexRenderer.clearHover()
    landformVertexRenderer.clearHover()
    regionVertexRenderer.clearHover()
    floorCircleHandleRenderer.clearHover()
    displayBoardCornerHandleRenderer.clearHover()
    waterVertexRenderer.clearHover()
    waterCircleHandleRenderer.clearHover()
  }

  const _moveDragCtx: any = {
    clickDragThresholdPx: CLICK_DRAG_THRESHOLD_PX,
    roadVertexDragState,
    floorVertexDragState,
    floorThicknessDragState,
    floorCircleCenterDragState,
    floorCircleRadiusDragState,
    wallEndpointDragState,
    wallJointDragState,
    wallHeightDragState,
    wallCircleCenterDragState,
    wallCircleRadiusDragState,
    raycastGroundPoint,
    raycastPlanePoint,
    groundPointerHelper,

    camera,
    floorBuildShape: floorBuildShape.value,
    syncWallPreviewGroup: ({
      previewGroup,
      definition,
      nodeId,
      previewKey,
      centerWorld,
    }: {
      previewGroup: THREE.Group | null
      definition: WallDynamicMesh
      nodeId: string | null
      previewKey: string
      centerWorld: THREE.Vector3
    }) =>
      syncWallPreviewGroupForEditor({
        previewGroup,
        definition,
        nodeId,
        previewKey,
        centerWorld,
      }),
    beginWallEditDragPreview: (nodeId: string) => {
      wallRenderer.beginWallDrag(nodeId, { suppressCommittedRender: true })
    },
    resolveRoadRenderOptionsForNodeId,
    updateRoadGroup,

    updateFloorGroup,
    refreshFloorRuntimeMaterials,
    forceRebuildFloorVertexHandles: () => ensureFloorVertexHandlesForSelectedNode({ force: true }),
    forceRebuildFloorCircleHandles: () => ensureFloorCircleHandlesForSelectedNode({ force: true }),
  }
  _moveDragCtx.setWallNodeDimensions = (nodeId: string, dimensions: { height?: number; width?: number; thickness?: number }) =>
    sceneStore.setWallNodeDimensions(nodeId, dimensions)
  _moveDragCtx.setFloorNodeThickness = (nodeId: string, thickness: number, options?: { captureHistory?: boolean }) =>
    sceneStore.setFloorNodeThickness(nodeId, thickness, options)

  // Default to hidden unless a wall drag is actively updating.
  clearWallLengthHud()
  clearFloorSizeHud()

  const dragResult = handlePointerMoveDrag(event, _moveDragCtx)
  if (dragResult) {
    updateOutlineSelectionTargets()
    updateWallLengthHudFromWallDrag()
    updateFloorSizeHudFromFloorDrag()
    applyPointerMoveResult(dragResult)
    return
  }

  if (landformContourVertexDragState && event.pointerId === landformContourVertexDragState.pointerId) {
    const state = landformContourVertexDragState
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved && Math.hypot(dx, dy) < CLICK_DRAG_THRESHOLD_PX) {
      return
    }
    state.moved = true

    if ((event.buttons & 1) === 0) {
      return
    }

    if (!state.startHitWorld) {
      if (!raycastPlanePoint(event, state.dragPlane, waterDragIntersectionHelper)) {
        return
      }
      state.startHitWorld = waterDragIntersectionHelper.clone()
    }
    if (!raycastPlanePoint(event, state.dragPlane, waterDragIntersectionHelper)) {
      return
    }

    let world = waterDragIntersectionHelper.clone()
    if (state.dragMode === 'axis' && state.axisWorld) {
      const axis = state.axisWorld.clone().normalize()
      const delta = world.clone().sub(state.startHitWorld)
      const t = axis.dot(delta)
      world = state.startHitWorld.clone().add(axis.multiplyScalar(t))
    }

    const local = state.runtimeObject.worldToLocal(world)
    const nextPoints = state.workingPoints.map(([x, z]) => [x, z] as [number, number])
    if (!nextPoints[state.vertexIndex]) {
      return
    }
    nextPoints[state.vertexIndex] = [local.x, local.z]
    state.workingPoints = nextPoints
      if (buildLandformPreviewFromLocalPoints(state.nodeId, nextPoints)) {
        ensureLandformVertexHandlesForSelectedNode({ force: true, previewPoints: nextPoints })
      }
    return
  }

  if (regionContourVertexDragState && event.pointerId === regionContourVertexDragState.pointerId) {
    const state = regionContourVertexDragState
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved && Math.hypot(dx, dy) < CLICK_DRAG_THRESHOLD_PX) {
      return
    }
    state.moved = true

    if ((event.buttons & 1) === 0) {
      return
    }

    if (!state.startHitWorld) {
      if (!raycastPlanePoint(event, state.dragPlane, waterDragIntersectionHelper)) {
        return
      }
      state.startHitWorld = waterDragIntersectionHelper.clone()
    }
    if (!raycastPlanePoint(event, state.dragPlane, waterDragIntersectionHelper)) {
      return
    }

    let world = waterDragIntersectionHelper.clone()
    if (state.dragMode === 'axis' && state.axisWorld) {
      const axis = state.axisWorld.clone().normalize()
      const delta = world.clone().sub(state.startHitWorld)
      const t = axis.dot(delta)
      world = state.startHitWorld.clone().add(axis.multiplyScalar(t))
    }

    const local = state.runtimeObject.worldToLocal(world)
    const nextPoints = state.workingPoints.map(([x, z]) => [x, z] as [number, number])
    if (!nextPoints[state.vertexIndex]) {
      return
    }
    nextPoints[state.vertexIndex] = [local.x, local.z]
    state.workingPoints = nextPoints
    if (buildRegionPreviewFromLocalPoints(state.nodeId, nextPoints)) {
      ensureRegionVertexHandlesForSelectedNode({ force: true, previewPoints: nextPoints })
    }
    return
  }

  if (waterContourVertexDragState && event.pointerId === waterContourVertexDragState.pointerId) {
    const state = waterContourVertexDragState
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved && Math.hypot(dx, dy) < CLICK_DRAG_THRESHOLD_PX) {
      return
    }
    state.moved = true

    const isLeftDown = (event.buttons & 1) !== 0
    if (!isLeftDown) {
      return
    }

    if (!state.startHitWorld) {
      if (!raycastPlanePoint(event, state.dragPlane, waterDragIntersectionHelper)) {
        return
      }
      state.startHitWorld = waterDragIntersectionHelper.clone()
    }
    if (!raycastPlanePoint(event, state.dragPlane, waterDragIntersectionHelper)) {
      return
    }

    let world = waterDragIntersectionHelper.clone()
    if (state.dragMode === 'axis' && state.axisWorld) {
      const axis = state.axisWorld.clone().normalize()
      const delta = world.clone().sub(state.startHitWorld)
      const t = axis.dot(delta)
      world = state.startHitWorld.clone().add(axis.multiplyScalar(t))
    }

    const local = state.runtimeObject.worldToLocal(world)
    const nextPoints = state.rectangleConstraint
      ? applyWaterRectangleVertexConstraint(state.rectangleConstraint, new THREE.Vector2(local.x, local.y))
      : state.workingPoints.map(([x, y]) => [x, y] as [number, number])
    if (!state.rectangleConstraint) {
      if (!nextPoints[state.vertexIndex]) {
        return
      }
      nextPoints[state.vertexIndex] = [local.x, local.y]
    }
    state.workingPoints = nextPoints
    if (buildWaterPreviewFromLocalPoints(state.runtimeObject, nextPoints)) {
      ensureWaterVertexHandlesForSelectedNode({ force: true, previewPoints: nextPoints })
    }
    return
  }

  if (landformContourVertexDragState && event.pointerId === landformContourVertexDragState.pointerId) {
    landformContourVertexDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)
    setActiveLandformVertexHandle(null)

    try {
      ensureLandformVertexHandlesForSelectedNode({ force: true })
    } catch {
      /* noop */
    }

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (waterCircleCenterDragState && event.pointerId === waterCircleCenterDragState.pointerId) {
    const state = waterCircleCenterDragState
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved && Math.hypot(dx, dy) < CLICK_DRAG_THRESHOLD_PX) {
      return
    }
    state.moved = true

    if ((event.buttons & 1) === 0) {
      return
    }
    if (!state.startHitWorld) {
      if (!raycastPlanePoint(event, state.dragPlane, waterDragIntersectionHelper)) {
        return
      }
      state.startHitWorld = waterDragIntersectionHelper.clone()
    }
    if (!raycastPlanePoint(event, state.dragPlane, waterDragIntersectionHelper)) {
      return
    }

    const delta = waterDragIntersectionHelper.clone().sub(state.startHitWorld)
    const nextCenterWorld = state.startPointWorld.clone().add(delta)
    const local = state.runtimeObject.worldToLocal(nextCenterWorld)
    const dxLocal = local.x - state.startCenterLocal.x
    const dyLocal = local.y - state.startCenterLocal.y
    const nextPoints = state.basePoints.map(([x, y]) => [x + dxLocal, y + dyLocal] as [number, number])
    state.workingPoints = nextPoints
    if (buildWaterPreviewFromLocalPoints(state.runtimeObject, nextPoints)) {
      ensureWaterCircleHandlesForSelectedNode({ force: true })
    }
    return
  }

  if (waterCircleRadiusDragState && event.pointerId === waterCircleRadiusDragState.pointerId) {
    const state = waterCircleRadiusDragState
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved && Math.hypot(dx, dy) < CLICK_DRAG_THRESHOLD_PX) {
      return
    }
    state.moved = true

    if ((event.buttons & 1) === 0) {
      return
    }
    if (!raycastPlanePoint(event, state.dragPlane, waterDragIntersectionHelper)) {
      return
    }

    const local = state.runtimeObject.worldToLocal(waterDragIntersectionHelper.clone())
    const radius = Math.hypot(local.x - state.centerLocal.x, local.y - state.centerLocal.y)
    const nextPoints = buildWaterCircleLocalPoints({
      centerX: state.centerLocal.x,
      centerY: state.centerLocal.y,
      radius,
      segments: state.segments,
    })
    state.workingPoints = nextPoints
    if (buildWaterPreviewFromLocalPoints(state.runtimeObject, nextPoints)) {
      ensureWaterCircleHandlesForSelectedNode({ force: true })
    }
    return
  }

  if (displayBoardCornerDragState && event.pointerId === displayBoardCornerDragState.pointerId) {
    const state = displayBoardCornerDragState
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved && Math.hypot(dx, dy) < CLICK_DRAG_THRESHOLD_PX) {
      return
    }
    state.moved = true

    if ((event.buttons & 1) === 0) {
      return
    }
    if (!raycastPlanePoint(event, state.dragPlane, displayBoardDragPointerHelper)) {
      return
    }

    const offset = displayBoardDragPointerHelper.clone().sub(state.oppositeCornerWorld)
    const widthRaw = offset.dot(state.axisXWorld)
    const heightRaw = offset.dot(state.axisYWorld)
    const width = Math.max(1e-3, state.draggedSide.x === 'max' ? widthRaw : -widthRaw)
    const height = Math.max(1e-3, state.draggedSide.y === 'max' ? heightRaw : -heightRaw)
    const signX = state.draggedSide.x === 'max' ? 1 : -1
    const signY = state.draggedSide.y === 'max' ? 1 : -1
    const centerWorld = state.oppositeCornerWorld.clone()
      .addScaledVector(state.axisXWorld, signX * width * 0.5)
      .addScaledVector(state.axisYWorld, signY * height * 0.5)

    applyDisplayBoardPreviewTransform(state.runtimeObject, state.parentObject, centerWorld, width, height)
    return
  }

  if (waterEdgeDragState && event.pointerId === waterEdgeDragState.pointerId) {
    const state = waterEdgeDragState
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved && Math.hypot(dx, dy) < CLICK_DRAG_THRESHOLD_PX) {
      return
    }
    state.moved = true

    if ((event.buttons & 1) === 0) {
      return
    }

    if (!raycastGroundPoint(event, groundPointerHelper)) {
      return
    }

    if (state.rectangleConstraint) {
      const local = state.runtimeObject.worldToLocal(groundPointerHelper.clone())
      const nextPoints = applyWaterRectangleEdgeConstraint(state.rectangleConstraint, new THREE.Vector2(local.x, local.y))
      state.workingPoints = nextPoints
      if (buildWaterPreviewFromLocalPoints(state.runtimeObject, nextPoints)) {
        ensureWaterVertexHandlesForSelectedNode({ force: true, previewPoints: nextPoints })
      }
      return
    }

    const pointerVec = new THREE.Vector2(groundPointerHelper.x, groundPointerHelper.z)
    const projection = state.perp.dot(pointerVec.clone().sub(state.referencePoint))
    const delta = projection - state.initialProjection
    const worldOffset = new THREE.Vector3(state.perp.x * delta, 0, state.perp.y * delta)
    const nextIndex = (state.edgeIndex + 1) % state.startPoints.length
    const nextPoints = state.startPoints.map(([x, y], index) => {
      if (index !== state.edgeIndex && index !== nextIndex) {
        return [x, y] as [number, number]
      }
      const startWorld = state.runtimeObject.localToWorld(new THREE.Vector3(x, y, 0))
      waterDragWorldHelper.copy(startWorld).add(worldOffset)
      const local = state.runtimeObject.worldToLocal(waterDragWorldHelper.clone())
      return [local.x, local.y] as [number, number]
    })
    state.workingPoints = nextPoints
    if (buildWaterPreviewFromLocalPoints(state.runtimeObject, nextPoints)) {
      ensureWaterVertexHandlesForSelectedNode({ force: true, previewPoints: nextPoints })
    }
    return
  }

  const scatter = handlePointerMoveScatter(event, {
    scatterEraseModeActive: scatterEraseModeActive.value,
    hasInstancedMeshes: hasInstancedMeshes.value,
    updateRepairHoverHighlight,
    instancedEraseDragState,
    tryEraseRepairTargetAtPointer,
    pointerInteractionUpdateMoved: (e) => pointerInteraction.updateMoved(e),
  })
  if (scatter) {
    applyPointerMoveResult(scatter)
    return
  }

  const tools = handlePointerMoveTools(event, {
    nodePickerActive: nodePickerStore.isActive,
    pickNodeAtPointer,
    updateNodePickerHighlight,
    handleGroundEditorPointerMove,
  })
  if (tools) {
    applyPointerMoveResult(tools)
    return
  }

  const floorEdge = handlePointerMoveFloorEdgeDrag(event, {
    clickDragThresholdPx: CLICK_DRAG_THRESHOLD_PX,
    floorEdgeDragState,
    raycastGroundPoint,
    groundPointerHelper,
    updateFloorGroup,
    refreshFloorRuntimeMaterials,
  })
  if (floorEdge) {
    applyPointerMoveResult(floorEdge)
    return
  }

  const buildTools = handlePointerMoveBuildTools(event, {
    displayBoardBuildToolHandlePointerMove: (e) => displayBoardBuildTool.handlePointerMove(e),
    billboardBuildToolHandlePointerMove: (e) => billboardBuildTool.handlePointerMove(e),
    landformBuildToolHandlePointerMove: (e) => landformBuildTool.handlePointerMove(e),
    regionBuildToolHandlePointerMove: (e) => regionBuildTool.handlePointerMove(e),
    waterBuildToolHandlePointerMove: (e) => waterBuildTool.handlePointerMove(e),
    floorBuildToolHandlePointerMove: (e) => floorBuildTool.handlePointerMove(e),
    wallBuildToolHandlePointerMove: (e) => wallBuildTool.handlePointerMove(e),
    roadBuildToolHandlePointerMove: (e) => roadBuildTool.handlePointerMove(e),
  })
  if (buildTools) {
    updateWallLengthHudFromWallBuild()
    updateFloorSizeHudFromFloorBuild()
    updateDisplayBoardSizeHudFromBuild()
    applyPointerMoveResult(buildTools)
    return
  }

  clearDisplayBoardSizeHud()
  updateWarpGatePlacementPreview(event)

  handlePointerMoveSelection(event, {
    clickDragThresholdPx: CLICK_DRAG_THRESHOLD_PX,
    isAltOverrideActive: isTemporaryNavigationOverrideActive(),
    pointerInteractionUpdateMoved: (e) => pointerInteraction.updateMoved(e),
    pointerTrackingState,
    transformControlsDragging: Boolean(transformControls?.dragging),
    sceneStoreBeginTransformInteraction: (nodeId) => {
      sceneStore.beginTransformInteraction(nodeId)
      updateOutlineSelectionTargets()
    },
    beginOrbitRotateGesture: (_event, trackingState) => {
      if (trackingState.cameraGesture === 'orbit-rotate') {
        mapControls?.beginOrbitRotateGesture(trackingState.pointerId, trackingState.startX, trackingState.startY)
      }
    },
    updateOrbitRotateGesture: (e, trackingState) => {
      if (trackingState.cameraGesture === 'orbit-rotate') {
        mapControls?.updateOrbitRotateGesture(trackingState.pointerId, e.clientX, e.clientY)
      }
    },
    onSelectionDragStart: (nodeId) => wallRenderer.beginWallDrag(nodeId),
    beginDeferredDuplicateDrag: (e, trackingState) => beginDeferredDuplicateSelectionDrag(e, trackingState),
    updateSelectDragPosition,
  })

  // If selection-based preview is active, update preview position to follow the mouse.
  try {
    if (hasPlacementPreviewActive() && dragPreview && canvasRef.value && camera && !isDragHovering.value) {
      ensureSelectionPreviewVisibilityMonitor()
      const hoverPreviewAllowed = event.pointerType === 'mouse' && isStrictPointOnCanvas(event.clientX, event.clientY)
      if (!hoverPreviewAllowed) {
        hideSelectionHoverPreview()
      } else {
      const now = Date.now()
      // throttle updates to ~60Hz
      if (now - lastSelectionPreviewUpdate > 8) {
        lastSelectionPreviewUpdate = now
        const placement = computePointerDropPlacement(event)
        const basePoint = computePreviewPointForPlacement(placement)
        // Keep dragPreview internal state aligned to the *surface* point so grid highlight remains correct.
        dragPreview.setPosition(basePoint)
        dragPreviewGroup.rotation.y = placementPreviewYaw
        if (basePoint) {
          const provisionalAligned = computeWorldAabbBottomAlignedPoint(basePoint, dragPreviewGroup)
          if (provisionalAligned) {
            dragPreviewGroup.position.copy(provisionalAligned)
            dragPreviewGroup.visible = true
          }

          const placementSnapActive = isVertexSnapActiveEffective.value && props.activeTool === 'select'
          const result = snapController.updatePlacementSideSnap({
            event,
            previewObject: dragPreviewGroup,
            active: placementSnapActive,
            pixelThresholdPx: vertexSnapThresholdPx.value,
            excludeNodeIds: new Set([GROUND_NODE_ID]),
          })
          updatePlacementSideSnapMarkers(result)
          if (selectionPreviewAssetId) {
            finalizeAssetPlacementPreview({
              assetId: selectionPreviewAssetId,
              basePoint,
              snapResult: result,
            })
          } else {
            clearAssetPlacementPreviewSnapshot()
          }
        } else {
          clearAssetPlacementPreviewSnapshot()
          dragPreviewGroup.visible = false
          snapController.resetPlacementSideSnap()
          clearPlacementSideSnapMarkers()
        }
      }
      }
    }
  } catch (err) {
    // non-fatal: ensure we don't break pointer handling
    console.warn('Failed to update selection preview position', err)
  }

  if (!hasPlacementPreviewActive() || !dragPreview || isDragHovering.value) {
    snapController.resetPlacementSideSnap()
    clearPlacementSideSnapMarkers()
  }
}

async function handlePointerUp(event: PointerEvent) {
  // surface snap pointer updates removed (alignment hint disabled)
  try {
    const isPointerUpOnCanvas = isStrictPointOnCanvas(event.clientX, event.clientY)
    const isPointerEventFromOverlayUi = isEventFromViewportOverlayUi(event)
    const hasViewportSession =
      pointerCaptureGuard.hasCaptured(event.pointerId) ||
      pointerTrackingState?.pointerId === event.pointerId ||
      roadVertexDragState?.pointerId === event.pointerId ||
      floorVertexDragState?.pointerId === event.pointerId ||
      regionContourVertexDragState?.pointerId === event.pointerId ||
      displayBoardCornerDragState?.pointerId === event.pointerId ||
      waterContourVertexDragState?.pointerId === event.pointerId ||
      waterCircleCenterDragState?.pointerId === event.pointerId ||
      waterCircleRadiusDragState?.pointerId === event.pointerId ||
      waterEdgeDragState?.pointerId === event.pointerId ||
      floorThicknessDragState?.pointerId === event.pointerId ||
      wallCircleCenterDragState?.pointerId === event.pointerId ||
      wallCircleRadiusDragState?.pointerId === event.pointerId ||
      wallEndpointDragState?.pointerId === event.pointerId ||
      wallJointDragState?.pointerId === event.pointerId ||
      wallHeightDragState?.pointerId === event.pointerId ||
      floorEdgeDragState?.pointerId === event.pointerId ||
      instancedEraseDragState?.pointerId === event.pointerId ||
      pointerInteraction.get()?.pointerId === event.pointerId ||
      middleClickSessionState?.pointerId === event.pointerId ||
      leftEmptyClickSessionState?.pointerId === event.pointerId ||
      assetPlacementClickSessionState?.pointerId === event.pointerId ||
      nodePlacementClickSessionState?.pointerId === event.pointerId

    const applyPointerUpResult = (result: PointerUpResult) => {
      const endedWallDragNodeIds = new Set<string>()
      if (result.clearPointerTrackingState) {
        pointerTrackingState = null
      }
      if (result.clearPointerTrackingState) {
        clearVertexSnapMarkers()
      }
      if (Object.prototype.hasOwnProperty.call(result, 'nextRoadVertexDragState')) {
        roadVertexDragState = result.nextRoadVertexDragState ?? null
      }
      if (Object.prototype.hasOwnProperty.call(result, 'nextFloorVertexDragState')) {
        floorVertexDragState = result.nextFloorVertexDragState ?? null
      }
      if (Object.prototype.hasOwnProperty.call(result, 'nextFloorThicknessDragState')) {
        floorThicknessDragState = result.nextFloorThicknessDragState ?? null
      }
      if (Object.prototype.hasOwnProperty.call(result, 'nextFloorCircleCenterDragState')) {
        floorCircleCenterDragState = result.nextFloorCircleCenterDragState ?? null
      }
      if (Object.prototype.hasOwnProperty.call(result, 'nextFloorCircleRadiusDragState')) {
        floorCircleRadiusDragState = result.nextFloorCircleRadiusDragState ?? null
      }
      if (Object.prototype.hasOwnProperty.call(result, 'nextWallEndpointDragState')) {
        if (wallEndpointDragState && !result.nextWallEndpointDragState) {
          endedWallDragNodeIds.add(wallEndpointDragState.nodeId)
        }
        wallEndpointDragState = result.nextWallEndpointDragState ?? null
      }
      if (Object.prototype.hasOwnProperty.call(result, 'nextWallJointDragState')) {
        if (wallJointDragState && !(result as any).nextWallJointDragState) {
          endedWallDragNodeIds.add(wallJointDragState.nodeId)
        }
        wallJointDragState = (result as any).nextWallJointDragState ?? null
      }
      if (Object.prototype.hasOwnProperty.call(result, 'nextWallHeightDragState')) {
        if (wallHeightDragState && !result.nextWallHeightDragState) {
          endedWallDragNodeIds.add(wallHeightDragState.nodeId)
        }
        wallHeightDragState = result.nextWallHeightDragState ?? null
      }
      if (Object.prototype.hasOwnProperty.call(result, 'nextWallCircleCenterDragState')) {
        if (wallCircleCenterDragState && !(result as any).nextWallCircleCenterDragState) {
          endedWallDragNodeIds.add(wallCircleCenterDragState.nodeId)
        }
        wallCircleCenterDragState = (result as any).nextWallCircleCenterDragState ?? null
      }
      if (Object.prototype.hasOwnProperty.call(result, 'nextWallCircleRadiusDragState')) {
        if (wallCircleRadiusDragState && !(result as any).nextWallCircleRadiusDragState) {
          endedWallDragNodeIds.add(wallCircleRadiusDragState.nodeId)
        }
        wallCircleRadiusDragState = (result as any).nextWallCircleRadiusDragState ?? null
      }
      if (Object.prototype.hasOwnProperty.call(result, 'nextInstancedEraseDragState')) {
        instancedEraseDragState = result.nextInstancedEraseDragState ?? null
      }
      if (result.clearFloorEdgeDragState) {
        floorEdgeDragState = null
      }
      if (result.preventDefault) {
        event.preventDefault()
      }
      if (result.stopPropagation) {
        event.stopPropagation()
      }
      if (result.stopImmediatePropagation) {
        event.stopImmediatePropagation()
      }

      // Any pointer-up ends active wall drag measurements.
      clearWallLengthHud()
      clearFloorSizeHud()

      endedWallDragNodeIds.forEach((nodeId) => wallRenderer.endWallDrag(nodeId))
      updateOutlineSelectionTargets()
    }

    // Canvas-only safety: only allow scene-modifying interactions (build/road/floor/scatter)
    // to commit when the pointer is released over the viewport canvas.
    //
    // We intentionally do NOT rely on `event.target === canvas` because pointer-capture can
    // retarget the event to the captured element even if the pointer is released elsewhere.
    if (isPointerEventFromOverlayUi && !hasViewportSession) {
      return
    }

    if (!isPointerUpOnCanvas) {
      // If the interaction started in the viewport, treat releasing outside as a cancellation.
      // This avoids accidental commits and also prevents a "drop" onto UI panels.
      if (hasViewportSession) {
        handlePointerCancel(event)
        return
      }
    }

    // NOTE: middle-button cancellation moved later so other tools (drag/erase/build)
    // which may use middle-button can handle the event first. If no handler
    // processed the pointerup, we'll cancel active tools below.
    if (isPointerUpOnCanvas) {
      if (wallDoorRectangleSelectionState && event.pointerId === wallDoorRectangleSelectionState.pointerId && event.button === 0) {
        const state = wallDoorRectangleSelectionState
        const bounds = wallDoorSelectionController.computeWallDoorRectangleBounds(state)
        clearWallDoorRectangleSelectionState()
        const width = bounds.right - bounds.left
        const height = bounds.bottom - bounds.top
        if (state.moved && width >= 2 && height >= 2) {
          wallDoorSelectionPayload.value = wallDoorSelectionController.buildWallDoorSelectionPayloadFromRect(bounds)
          if (wallDoorSelectionPayload.value?.length) {
            const selectedIds = Array.from(new Set(wallDoorSelectionPayload.value.map((entry) => entry.nodeId)))
            emitSelectionChange(selectedIds)
          }
        } else {
          clearWallDoorSelectionPayload()
        }
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }

      if (waterContourVertexDragState && event.pointerId === waterContourVertexDragState.pointerId && event.button === 0) {
        const state = waterContourVertexDragState
        waterContourVertexDragState = null
        pointerInteraction.releaseIfCaptured(event.pointerId)
        setActiveWaterVertexHandle(null)

        if (state.moved) {
          commitWaterContourNode(state.nodeId, state.workingPoints, resolveWaterContourBuildShape(state.nodeId))
          ensureWaterVertexHandlesForSelectedNode({ force: true })
          void nextTick(() => {
            ensureWaterVertexHandlesForSelectedNode({ force: true })
          })
        } else {
          buildWaterPreviewFromLocalPoints(state.runtimeObject, state.basePoints)
          ensureWaterVertexHandlesForSelectedNode({ force: true })
        }

        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }

      if (waterCircleCenterDragState && event.pointerId === waterCircleCenterDragState.pointerId && event.button === 0) {
        const state = waterCircleCenterDragState
        waterCircleCenterDragState = null
        pointerInteraction.releaseIfCaptured(event.pointerId)
        setActiveWaterCircleHandle(null)

        if (state.moved) {
          commitWaterContourNode(state.nodeId, state.workingPoints, 'circle')
          ensureWaterCircleHandlesForSelectedNode({ force: true })
          void nextTick(() => {
            ensureWaterCircleHandlesForSelectedNode({ force: true })
          })
        } else {
          buildWaterPreviewFromLocalPoints(state.runtimeObject, state.basePoints)
          ensureWaterCircleHandlesForSelectedNode({ force: true })
        }

        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }

      if (waterCircleRadiusDragState && event.pointerId === waterCircleRadiusDragState.pointerId && event.button === 0) {
        const state = waterCircleRadiusDragState
        waterCircleRadiusDragState = null
        pointerInteraction.releaseIfCaptured(event.pointerId)
        setActiveWaterCircleHandle(null)

        if (state.moved) {
          commitWaterContourNode(state.nodeId, state.workingPoints, 'circle')
          ensureWaterCircleHandlesForSelectedNode({ force: true })
          void nextTick(() => {
            ensureWaterCircleHandlesForSelectedNode({ force: true })
          })
        } else {
          buildWaterPreviewFromLocalPoints(state.runtimeObject, state.basePoints)
          ensureWaterCircleHandlesForSelectedNode({ force: true })
        }

        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }

      if (waterEdgeDragState && event.pointerId === waterEdgeDragState.pointerId && event.button === 0) {
        const state = waterEdgeDragState
        waterEdgeDragState = null
        pointerInteraction.releaseIfCaptured(event.pointerId)

        if (state.moved) {
          commitWaterContourNode(state.nodeId, state.workingPoints, resolveWaterContourBuildShape(state.nodeId))
          ensureWaterVertexHandlesForSelectedNode({ force: true })
          void nextTick(() => {
            ensureWaterVertexHandlesForSelectedNode({ force: true })
          })
        } else {
          buildWaterPreviewFromLocalPoints(state.runtimeObject, state.startPoints)
          ensureWaterVertexHandlesForSelectedNode({ force: true })
        }

        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }

      if (landformContourVertexDragState && event.pointerId === landformContourVertexDragState.pointerId && event.button === 0) {
        const state = landformContourVertexDragState
        landformContourVertexDragState = null
        pointerInteraction.releaseIfCaptured(event.pointerId)
        setActiveLandformVertexHandle(null)

        if (state.moved) {
          if (!commitLandformContourNode(state.nodeId, state.workingPoints)) {
            sceneStore.restoreLandformSurfaceMeshRuntime(state.nodeId)
          }
          ensureLandformVertexHandlesForSelectedNode({ force: true })
          void nextTick(() => {
            ensureLandformVertexHandlesForSelectedNode({ force: true })
          })
        } else {
          sceneStore.restoreLandformSurfaceMeshRuntime(state.nodeId)
          ensureLandformVertexHandlesForSelectedNode({ force: true })
        }

        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }

      if (regionContourVertexDragState && event.pointerId === regionContourVertexDragState.pointerId && event.button === 0) {
        const state = regionContourVertexDragState
        regionContourVertexDragState = null
        pointerInteraction.releaseIfCaptured(event.pointerId)
        setActiveRegionVertexHandle(null)

        if (state.moved) {
          if (!commitRegionContourNode(state.nodeId, state.workingPoints)) {
            buildRegionPreviewFromLocalPoints(state.nodeId, state.basePoints)
          }
          ensureRegionVertexHandlesForSelectedNode({ force: true })
          void nextTick(() => {
            ensureRegionVertexHandlesForSelectedNode({ force: true })
          })
        } else {
          buildRegionPreviewFromLocalPoints(state.nodeId, state.basePoints)
          ensureRegionVertexHandlesForSelectedNode({ force: true })
        }

        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }

      if (displayBoardCornerDragState && event.pointerId === displayBoardCornerDragState.pointerId && event.button === 0) {
        const state = displayBoardCornerDragState
        displayBoardCornerDragState = null
        pointerInteraction.releaseIfCaptured(event.pointerId)
        setActiveDisplayBoardCornerHandle(null)

        if (state.moved) {
          sceneStore.updateNodeTransform({
            id: state.nodeId,
            position: {
              x: state.runtimeObject.position.x,
              y: state.runtimeObject.position.y,
              z: state.runtimeObject.position.z,
            },
            rotation: {
              x: state.startRotation.x,
              y: state.startRotation.y,
              z: state.startRotation.z,
            },
            scale: {
              x: Math.abs(state.runtimeObject.scale.x),
              y: Math.abs(state.runtimeObject.scale.y),
              z: Math.abs(state.startScale.z),
            },
          })
          ensureDisplayBoardCornerHandlesForSelectedNode({ force: true })
          void nextTick(() => {
            ensureDisplayBoardCornerHandlesForSelectedNode({ force: true })
          })
        } else {
          restoreDisplayBoardPreviewTransform(state)
        }

        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }

      const drag = handlePointerUpDrag(event, {
        roadDefaultWidth: ROAD_DEFAULT_WIDTH,
        roadVertexDragState,
        floorVertexDragState,
        floorThicknessDragState,
        floorCircleCenterDragState,
        floorCircleRadiusDragState,
        wallEndpointDragState,
        wallJointDragState,
        wallHeightDragState,
        wallCircleCenterDragState,
        wallCircleRadiusDragState,
        floorEdgeDragState,
        findSceneNode,
        nodes: sceneStore.nodes,
        objectMap,
        sceneStoreUpdateNodeDynamicMesh: (nodeId, mesh) => sceneStore.updateNodeDynamicMesh(nodeId, mesh),
        sceneStoreUpdateWallNodeGeometry: (nodeId, payload) => sceneStore.updateWallNodeGeometry(nodeId, payload),
        pointerInteractionReleaseIfCaptured: (pointerId) => pointerInteraction.releaseIfCaptured(pointerId),
        ensureRoadVertexHandlesForSelectedNode: () => ensureRoadVertexHandlesForSelectedNode(),
        ensureFloorVertexHandlesForSelectedNode: () => ensureFloorVertexHandlesForSelectedNode(),
        ensureFloorCircleHandlesForSelectedNode: () => ensureFloorCircleHandlesForSelectedNode(),
        ensureWallEndpointHandlesForSelectedNode: (options) => ensureWallEndpointHandlesForSelectedNode(options),

        setActiveRoadVertexHandle,
        setActiveFloorVertexHandle,
        setActiveFloorCircleHandle,
        setActiveWallEndpointHandle,

        nextTick,
        resolveRoadRenderOptionsForNodeId,
        updateRoadGroup,
        updateFloorGroup,
        disposeWallPreviewGroup: (preview) => wallRenderer.disposeWallPreviewContainer(preview),
        roadBuildToolBeginBranchFromVertex: (options) => roadBuildTool.beginBranchFromVertex(options),
        wallBuildToolBeginBranchFromEndpoint: (options) => wallBuildTool.beginBranchFromEndpoint(options),
      })
      if (drag) {
        applyPointerUpResult(drag)
        return
      }

      const scatter = handlePointerUpScatter(event, {
        instancedEraseDragState,
        pointerInteractionReleaseIfCaptured: (pointerId) => pointerInteraction.releaseIfCaptured(pointerId),
        scatterEraseModeActive: scatterEraseModeActive.value,
        pointerInteractionGet: () => pointerInteraction.get(),
        pointerInteractionEnsureMoved: (e) => pointerInteraction.ensureMoved(e),
        pointerInteractionClearIfPointer: (pointerId) => pointerInteraction.clearIfPointer(pointerId),
        tryEraseRepairTargetAtPointer,
      })
      if (scatter) {
        applyPointerUpResult(scatter)
        return
      }

      const tools = handlePointerUpTools(event, {
        maybeHandleBuildToolRightClick,
        handleGroundEditorPointerUp,
        displayBoardBuildToolHandlePointerUp: (e) => displayBoardBuildTool.handlePointerUp(e),
        billboardBuildToolHandlePointerUp: (e) => billboardBuildTool.handlePointerUp(e),
        landformBuildToolHandlePointerUp: (e) => landformBuildTool.handlePointerUp(e),
        regionBuildToolHandlePointerUp: (e) => regionBuildTool.handlePointerUp(e),
        waterBuildToolHandlePointerUp: (e) => waterBuildTool.handlePointerUp(e),
        wallBuildToolHandlePointerUp: (e) => wallBuildTool.handlePointerUp(e),
        roadBuildToolHandlePointerUp: (e) => roadBuildTool.handlePointerUp(e),
        displayBoardEditModeActive: activeBuildTool.value === 'displayBoard' && isSelectedDisplayBoardEditMode(),
        waterEditModeActive: activeBuildTool.value === 'water' && isSelectedWaterEditMode(),
        wallEditModeActive: activeBuildTool.value === 'wall' && isSelectedWallEditMode(),
        roadEditModeActive: activeBuildTool.value === 'road' && isSelectedRoadEditMode(),
        floorEditModeActive: activeBuildTool.value === 'floor' && isSelectedFloorEditMode(),
        activeBuildTool: activeBuildTool.value,
        floorBuildToolHandlePointerUp: (e) => floorBuildTool.handlePointerUp(e),
      })
      if (tools) {
        clearDisplayBoardSizeHud()
        applyPointerUpResult(tools)
        return
      }
    }

    // Scatter erase mode: right-click without dragging exits erase mode.
    // Right-drag still belongs to camera orbit controls and should not cancel the mode.
    if (
      scatterEraseModeActive.value &&
      pointerTrackingState &&
      pointerTrackingState.pointerId === event.pointerId &&
      pointerTrackingState.button === 2 &&
      !pointerTrackingState.moved &&
      event.pointerType === 'mouse' &&
      isPointerUpOnCanvas
    ) {
      exitScatterEraseMode()
      pointerTrackingState = null
      pointerInteraction.clearIfKind('buildToolRightClick')
      pointerInteraction.releaseIfCaptured(event.pointerId)

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }

    // Selection-based asset preview: right click (without moving) rotates the preview.
    // Keep right-drag behavior for orbit controls by only reacting when `moved` is false.
    if (
      hasPlacementPreviewActive() &&
      pointerTrackingState &&
      pointerTrackingState.pointerId === event.pointerId &&
      pointerTrackingState.button === 2 &&
      !pointerTrackingState.moved &&
      event.pointerType === 'mouse' &&
      isPointerUpOnCanvas
    ) {
      placementPreviewYaw += RIGHT_CLICK_ROTATION_STEP
      dragPreviewGroup.rotation.y = placementPreviewYaw
      dragPreviewGroup.updateMatrixWorld(true)

      pointerTrackingState = null
      pointerInteraction.releaseIfCaptured(event.pointerId)

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }

    const selection = handlePointerUpSelection(event, {
      pointerTrackingState,
      clearPointerTrackingState: () => {
        pointerTrackingState = null
      },
      pointerInteractionReleaseIfCaptured: (pointerId) => pointerInteraction.releaseIfCaptured(pointerId),
      endOrbitRotateGesture: (trackingState) => {
        if (trackingState.cameraGesture === 'orbit-rotate') {
          mapControls?.endOrbitRotateGesture(trackingState.pointerId)
        }
      },
      transformControlsDragging: Boolean(transformControls?.dragging),
      restoreOrbitAfterSelectDrag,
      updateGridHighlightFromObject,
      commitSelectionDragTransforms: commitSelectionDragTransformsWithDeferredVertexSnap,
      sceneStoreEndTransformInteraction: () => sceneStore.endTransformInteraction(),
      updateSelectionHighlights,
      onSelectionDragEnd: (nodeId) => wallRenderer.endWallDrag(nodeId),
      activeTool: props.activeTool,
      rotateActiveSelection,
      sceneSelectedNodeId: sceneStore.selectedNodeId ?? null,
      selectedNodeIdProp: props.selectedNodeId ?? null,
      selectedNodeIds: sceneStore.selectedNodeIds,
      sceneStoreIsNodeSelectionLocked: (nodeId) => sceneStore.isNodeSelectionLocked(nodeId),
      sceneStoreIsDescendant: (ancestorId, nodeId) => sceneStore.isDescendant(ancestorId, nodeId),
      findSceneNode,
      sceneNodes: props.sceneNodes,
      pickNodeAtPointer,
      pickActiveSelectionBoundingBoxHit,
      handleClickSelection,
    })

    if (selection) {
      applyPointerUpResult(selection)
      return
    }

    // 资产面板放置：左键点击时在光标位置放置当前选中的模型/网格/预制件。
    // 注意：如果发生拖动（拖拽移动），应当触发摄像机平移而不是放置资产，因此此处仅在点击未移动时处理放置。
    if (event.button === 0 && warpGatePlacementClickSessionState?.pointerId === event.pointerId) {
      const session = warpGatePlacementClickSessionState
      warpGatePlacementClickSessionState = null

      if (!session.moved) {
        const placement = computePointerDropPlacement(event)
        const basePoint = computePreviewPointForPlacement(placement)
        if (basePoint) {
          const parentGroupId = resolveSelectedGroupDropParent()
          try {
            const created = await createWarpGateNode(sceneStore, {
              parentId: parentGroupId,
              position: basePoint,
            })
            if (created) {
              sceneStore.selectNode(created.id)
            }
          } catch (error) {
            console.warn('Failed to place Warp Gate from viewport tool', error)
          }
        }
      }

      updateWarpGatePlacementPreview(event)
      return
    }

    if (event.button === 0 && assetPlacementClickSessionState?.pointerId === event.pointerId) {
      const session = assetPlacementClickSessionState
      // 清除会话状态（click 处理一次后即无效）
      assetPlacementClickSessionState = null

      // 仅在点击未发生拖动时继续（防止误触放置）
      if (!session.moved) {
        const asset = sceneStore.getAsset(session.assetId)
        // 仅对可放置的 3D 资产执行放置逻辑
        if (asset && (asset.type === 'model' || asset.type === 'mesh' || asset.type === 'prefab' || asset.type === 'lod')) {
          // 如果当前临时顶点吸附生效并且工具处于选择模式，则尝试消费一次放置侧吸附结果
          // `consumePlacementSideSnapResult()` 会返回当前预览时计算好的吸附信息并将其内部状态标记为已消费
          const placementSideSnap = (isVertexSnapActiveEffective.value && props.activeTool === 'select')
            ? snapController.consumePlacementSideSnapResult()
            : null
          // 清除提示标记，确保 UI 不再显示旧的吸附提示
          clearPlacementSideSnapMarkers()

          try {
            const previewSnapshot = getAssetPlacementPreviewSnapshot(session.assetId)
            const fallbackPosition = computeSpawnPointForSelectionClick(event, session.assetId, placementSideSnap)
            const parentGroupId = resolveSelectedGroupDropParent()
            const rotation = previewSnapshot?.rotation ?? new THREE.Vector3(0, placementPreviewYaw, 0)
            await spawnAssetFromSelectionClick({
              assetId: session.assetId,
              worldPosition: previewSnapshot?.worldPosition ?? fallbackPosition,
              rotation,
              scale: previewSnapshot?.scale ?? null,
              parentGroupId,
              selectedId: props.selectedNodeId ?? null,
            })
          } catch (error) {
            console.warn('Failed to spawn asset from selection click', session.assetId, error)
          }
        }
      }
      return
    }

    if (event.button === 0 && nodePlacementClickSessionState?.pointerId === event.pointerId) {
      const session = nodePlacementClickSessionState
      nodePlacementClickSessionState = null

      if (!session.moved && pendingViewportPlacement.value && getViewportPlacementKey(pendingViewportPlacement.value) === session.itemId) {
        const placementSideSnap = (isVertexSnapActiveEffective.value && props.activeTool === 'select')
          ? snapController.consumePlacementSideSnapResult()
          : null
        clearPlacementSideSnapMarkers()

        try {
          const placement = computePointerDropPlacement(event)
          const basePoint = computePreviewPointForPlacement(placement) ?? new THREE.Vector3(0, 0, 0)
          if (placementSideSnap) {
            basePoint.add(placementSideSnap.delta)
          }
          const rotation = new THREE.Vector3(0, placementPreviewYaw, 0)
          await placeViewportItemAtPoint(pendingViewportPlacement.value, basePoint, rotation)
        } catch (error) {
          console.warn('Failed to place viewport item from selection click', session.itemId, error)
        }
      }
      return
    }

    // Select mode: left click on empty space clears selection (only if it was a click, not a drag-pan).
    if (event.button === 0 && leftEmptyClickSessionState?.pointerId === event.pointerId) {
      const session = leftEmptyClickSessionState
      // Clear session first to avoid re-entrancy issues.
      leftEmptyClickSessionState = null
      if (session.cameraGesture === 'planar-pan') {
        mapControls?.endPlanarPanGesture(event.pointerId)
      } else if (session.cameraGesture === 'orbit-rotate') {
        mapControls?.endTransientLeftRotateGesture()
      }

      if (!session.moved) {
        if (session.clickHitResult) {
          const clickTrackingState: PointerTrackingState = {
            pointerId: session.pointerId,
            startX: session.startX,
            startY: session.startY,
            moved: false,
            button: 0,
            hitResult: session.clickHitResult,
            selectionDrag: null,
            ctrlKey: session.ctrlKey,
            metaKey: session.metaKey,
            shiftKey: session.shiftKey,
            cameraGesture: 'none',
            transformAxis: null,
            deferredDuplicateDrag: null,
            deferredDuplicateInFlight: false,
          }
          handleClickSelection(event, clickTrackingState, {
            allowDeselectOnReselect: true,
          })
        } else {
          const isToggle = session.ctrlKey || session.metaKey
          const isRange = session.shiftKey
          sceneStore.clearSelectedRoadSegment()
          if (!isToggle && !isRange) {
            emitSelectionChange([])
          }
        }
      }
      return
    }

    // If middle mouse was released and no other handler processed the event,
    // cancel active tools and restore select, but only if this was a click (no drag).
    // In scatter/scatter-erase contexts, middle click should not cancel the tool state.
    // Middle drag is reserved for camera panning.
    if (event.button === 1 && middleClickSessionState?.pointerId === event.pointerId) {
      if (middleClickSessionState.planarPanActive) {
        mapControls?.endPlanarPanGesture(event.pointerId)
      }
      const wasDrag = Boolean(middleClickSessionState.moved)
      if (wasDrag) {
        return
      }
      const isScatterContext =
        scatterEraseModeActive.value ||
        activeBuildTool.value === 'scatter' ||
        uiStore.activeSelectionContext === 'scatter-erase'
      if (isScatterContext) {
        return
      }
      try {
        if (activeBuildTool.value) {
          cancelActiveBuildOperation()
          activeBuildTool.value = null
        }
        terrainStore.setBrushOperation(null)
        terrainStore.setScatterSelection({ asset: null, providerAssetId: null })
        sceneStore.selectAsset(null)
        uiStore.setActiveSelectionContext(null)
        sceneStore.setActiveTool('select')
      } catch (e) {
        console.warn('Failed to cancel tools on middle-click up', e)
      }
      applyPointerUpResult({ handled: true, clearPointerTrackingState: true, preventDefault: true })
      return
    }
  } finally {
    // Ensure lightweight gesture state doesn't leak across interactions.
    pointerInteraction.clearIfPointer(event.pointerId)
    snapController.reset()
    snapController.resetPlacementSideSnap()
    clearPlacementSideSnapMarkers()

    if (middleClickSessionState && middleClickSessionState.pointerId === event.pointerId) {
      if (middleClickSessionState.planarPanActive) {
        mapControls?.endPlanarPanGesture(event.pointerId)
      }
      middleClickSessionState = null
    }

    if (leftEmptyClickSessionState && leftEmptyClickSessionState.pointerId === event.pointerId) {
      if (leftEmptyClickSessionState.cameraGesture === 'planar-pan') {
        mapControls?.endPlanarPanGesture(event.pointerId)
      } else if (leftEmptyClickSessionState.cameraGesture === 'orbit-rotate') {
        mapControls?.endTransientLeftRotateGesture()
      }
      leftEmptyClickSessionState = null
    }

    if (assetPlacementClickSessionState && assetPlacementClickSessionState.pointerId === event.pointerId) {
      assetPlacementClickSessionState = null
    }
    if (nodePlacementClickSessionState && nodePlacementClickSessionState.pointerId === event.pointerId) {
      nodePlacementClickSessionState = null
    }
    if (warpGatePlacementClickSessionState && warpGatePlacementClickSessionState.pointerId === event.pointerId) {
      warpGatePlacementClickSessionState = null
    }
    if (wallDoorRectangleSelectionState && wallDoorRectangleSelectionState.pointerId === event.pointerId) {
      clearWallDoorRectangleSelectionState()
    }

    clearShiftOrbitPivotSession(event.pointerId)
  }
}

function handlePointerCancel(event: PointerEvent) {
  clearWallLengthHud()
  clearFloorSizeHud()
  deactivateVOverride()
  // Ensure any selection-hover preview is hidden when pointer is cancelled.
  stopSelectionPreviewVisibilityMonitor()
  clearAssetPlacementPreviewSnapshot()
  dragPreview.setPosition(null)
  dragPreviewGroup.visible = false
  hideWarpGatePlacementPreview()

  snapController.reset()
  snapController.resetPlacementSideSnap()
  clearVertexSnapMarkers()
  clearPlacementSideSnapMarkers()
  pendingVertexSnapResult = null
  pointerInteraction.clearIfPointer(event.pointerId)
  if (pointerTrackingState?.pointerId === event.pointerId && pointerTrackingState.cameraGesture === 'orbit-rotate') {
    mapControls?.endOrbitRotateGesture(event.pointerId)
  }
  if (pointerTrackingState?.pointerId === event.pointerId) {
    pointerTrackingState = null
  }
  if (middleClickSessionState && middleClickSessionState.pointerId === event.pointerId) {
    if (middleClickSessionState.planarPanActive) {
      mapControls?.endPlanarPanGesture(event.pointerId)
    }
    middleClickSessionState = null
  }
  if (leftEmptyClickSessionState && leftEmptyClickSessionState.pointerId === event.pointerId) {
    if (leftEmptyClickSessionState.cameraGesture === 'planar-pan') {
      mapControls?.endPlanarPanGesture(event.pointerId)
    } else if (leftEmptyClickSessionState.cameraGesture === 'orbit-rotate') {
      mapControls?.endTransientLeftRotateGesture()
    }
    leftEmptyClickSessionState = null
  }
  if (assetPlacementClickSessionState && assetPlacementClickSessionState.pointerId === event.pointerId) {
    assetPlacementClickSessionState = null
  }
  if (nodePlacementClickSessionState && nodePlacementClickSessionState.pointerId === event.pointerId) {
    nodePlacementClickSessionState = null
  }
  if (warpGatePlacementClickSessionState && warpGatePlacementClickSessionState.pointerId === event.pointerId) {
    warpGatePlacementClickSessionState = null
  }
  if (wallDoorRectangleSelectionState && wallDoorRectangleSelectionState.pointerId === event.pointerId) {
    clearWallDoorRectangleSelectionState()
  }
  clearShiftOrbitPivotSession(event.pointerId)
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
    updateOutlineSelectionTargets()
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (wallCircleCenterDragState && event.pointerId === wallCircleCenterDragState.pointerId) {
    const state = wallCircleCenterDragState
    wallCircleCenterDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)
    setActiveWallEndpointHandle(null)

    try {
      if (state.previewGroup) {
        const preview = state.previewGroup
        state.previewGroup = null
        preview.removeFromParent()
        wallRenderer.disposeWallPreviewContainer(preview)
      }
    } catch {
      /* noop */
    }

    wallRenderer.endWallDrag(state.nodeId)

    updateOutlineSelectionTargets()
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (wallCircleRadiusDragState && event.pointerId === wallCircleRadiusDragState.pointerId) {
    const state = wallCircleRadiusDragState
    wallCircleRadiusDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)
    setActiveWallEndpointHandle(null)

    try {
      if (state.previewGroup) {
        const preview = state.previewGroup
        state.previewGroup = null
        preview.removeFromParent()
        wallRenderer.disposeWallPreviewContainer(preview)
      }
    } catch {
      /* noop */
    }

    wallRenderer.endWallDrag(state.nodeId)

    updateOutlineSelectionTargets()
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (wallEndpointDragState && event.pointerId === wallEndpointDragState.pointerId) {
    const state = wallEndpointDragState
    wallEndpointDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)
    setActiveWallEndpointHandle(null)

    try {
      if (state.previewGroup) {
        const preview = state.previewGroup
        state.previewGroup = null
        preview.removeFromParent()
        wallRenderer.disposeWallPreviewContainer(preview)
      }

      const handles = state.containerObject.getObjectByName(WALL_ENDPOINT_HANDLE_GROUP_NAME) as THREE.Group | null
      if (handles?.isGroup) {
        const mesh = handles.children.find((child) => {
          const kind = child?.userData?.endpointKind
          const startIndex = Math.trunc(Number(child?.userData?.chainStartIndex))
          const endIndex = Math.trunc(Number(child?.userData?.chainEndIndex))
          return (
            (kind === state.endpointKind) &&
            startIndex === state.chainStartIndex &&
            endIndex === state.chainEndIndex
          )
        }) as THREE.Object3D | undefined
        if (mesh) {
          const local = state.containerObject.worldToLocal(state.startEndpointWorld.clone())
          mesh.position.set(local.x, local.y + WALL_ENDPOINT_HANDLE_Y_OFFSET, local.z)
        }
      }
    } catch {
      /* noop */
    }

    wallRenderer.endWallDrag(state.nodeId)

    updateOutlineSelectionTargets()
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (wallJointDragState && event.pointerId === wallJointDragState.pointerId) {
    const state = wallJointDragState
    wallJointDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)
    setActiveWallEndpointHandle(null)

    try {
      if (state.previewGroup) {
        const preview = state.previewGroup
        state.previewGroup = null
        preview.removeFromParent()
        wallRenderer.disposeWallPreviewContainer(preview)
      }

      const handles = state.containerObject.getObjectByName(WALL_ENDPOINT_HANDLE_GROUP_NAME) as THREE.Group | null
      if (handles?.isGroup) {
        const mesh = handles.children.find((child) => {
          const kind = child?.userData?.handleKind
          const startIndex = Math.trunc(Number(child?.userData?.chainStartIndex))
          const endIndex = Math.trunc(Number(child?.userData?.chainEndIndex))
          const j = Math.trunc(Number(child?.userData?.jointIndex))
          return (
            kind === 'joint' &&
            startIndex === state.chainStartIndex &&
            endIndex === state.chainEndIndex &&
            j === state.jointIndex
          )
        }) as THREE.Object3D | undefined
        if (mesh) {
          const local = state.containerObject.worldToLocal(state.startJointWorld.clone())
          mesh.position.set(local.x, local.y + WALL_ENDPOINT_HANDLE_Y_OFFSET, local.z)
        }
      }
    } catch {
      /* noop */
    }

    wallRenderer.endWallDrag(state.nodeId)

    updateOutlineSelectionTargets()
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (wallHeightDragState && event.pointerId === wallHeightDragState.pointerId) {
    const state = wallHeightDragState
    wallHeightDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)
    setActiveWallEndpointHandle(null)

    try {
      if (state.previewGroup) {
        const preview = state.previewGroup
        state.previewGroup = null
        preview.removeFromParent()
        wallRenderer.disposeWallPreviewContainer(preview)
      }

      const handles = state.containerObject.getObjectByName(WALL_ENDPOINT_HANDLE_GROUP_NAME) as THREE.Group | null
      if (handles?.isGroup) {
        const yOffset = Math.max(0.05, state.startHeight * 0.5)
        for (const child of handles.children) {
          const handleKind = child?.userData?.handleKind === 'joint' ? 'joint' : 'endpoint'
          const chainStartIndex = Math.max(0, Math.trunc(Number(child?.userData?.chainStartIndex)))
          const chainEndIndex = Math.max(chainStartIndex, Math.trunc(Number(child?.userData?.chainEndIndex)))
          const startSeg = state.baseSegmentsWorld[chainStartIndex]
          const endSeg = state.baseSegmentsWorld[chainEndIndex]
          let pointWorld: THREE.Vector3 | null = null
          if (handleKind === 'joint') {
            const jointIndex = Math.trunc(Number(child?.userData?.jointIndex))
            const seg = state.baseSegmentsWorld[jointIndex]
            if (seg) {
              pointWorld = seg.end.clone()
            }
          } else {
            const endpointKind = child?.userData?.endpointKind === 'end' ? 'end' : 'start'
            if (startSeg && endSeg) {
              pointWorld = endpointKind === 'start' ? startSeg.start.clone() : endSeg.end.clone()
            }
          }
          if (!pointWorld) continue
          const local = state.containerObject.worldToLocal(pointWorld)
          child.userData.yOffset = yOffset
          child.position.set(local.x, local.y + yOffset, local.z)
        }
      }
    } catch {
      /* noop */
    }

    wallRenderer.endWallDrag(state.nodeId)

    updateOutlineSelectionTargets()
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (floorThicknessDragState && event.pointerId === floorThicknessDragState.pointerId) {
    const state = floorThicknessDragState
    floorThicknessDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)
    setActiveFloorVertexHandle(null)
    setActiveFloorCircleHandle(null)

    try {
      const handles = state.containerObject.getObjectByName(FLOOR_VERTEX_HANDLE_GROUP_NAME) as THREE.Group | null
      if (handles?.isGroup) {
        const yOffset = FLOOR_VERTEX_HANDLE_Y + Math.max(0, state.startThickness) * 0.5
        for (const child of handles.children) {
          child.userData.yOffset = yOffset
          child.position.y = yOffset
        }
      }

      ensureFloorCircleHandlesForSelectedNode({ force: true })
    } catch {
      /* noop */
    }

    updateOutlineSelectionTargets()
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (floorCircleCenterDragState && event.pointerId === floorCircleCenterDragState.pointerId) {
    const state = floorCircleCenterDragState
    floorCircleCenterDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)
    setActiveFloorCircleHandle(null)

    try {
      updateFloorGroup(state.runtimeObject, state.baseDefinition)
      ensureFloorCircleHandlesForSelectedNode({ force: true })
    } catch {
      /* noop */
    }

    updateOutlineSelectionTargets()
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (floorCircleRadiusDragState && event.pointerId === floorCircleRadiusDragState.pointerId) {
    const state = floorCircleRadiusDragState
    floorCircleRadiusDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)
    setActiveFloorCircleHandle(null)

    try {
      updateFloorGroup(state.runtimeObject, state.baseDefinition)
      ensureFloorCircleHandlesForSelectedNode({ force: true })
    } catch {
      /* noop */
    }

    updateOutlineSelectionTargets()
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (waterContourVertexDragState && event.pointerId === waterContourVertexDragState.pointerId) {
    const state = waterContourVertexDragState
    waterContourVertexDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)
    setActiveWaterVertexHandle(null)

    try {
      buildWaterPreviewFromLocalPoints(state.runtimeObject, state.basePoints)
      ensureWaterVertexHandlesForSelectedNode({ force: true })
    } catch {
      /* noop */
    }

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (landformContourVertexDragState && event.pointerId === landformContourVertexDragState.pointerId) {
    const state = landformContourVertexDragState
    landformContourVertexDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)
    setActiveLandformVertexHandle(null)

    try {
      sceneStore.restoreLandformSurfaceMeshRuntime(state.nodeId)
      ensureLandformVertexHandlesForSelectedNode({ force: true })
    } catch {
      /* noop */
    }

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (regionContourVertexDragState && event.pointerId === regionContourVertexDragState.pointerId) {
    const state = regionContourVertexDragState
    regionContourVertexDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)
    setActiveRegionVertexHandle(null)

    try {
      buildRegionPreviewFromLocalPoints(state.nodeId, state.basePoints)
      ensureRegionVertexHandlesForSelectedNode({ force: true })
    } catch {
      /* noop */
    }

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (waterCircleCenterDragState && event.pointerId === waterCircleCenterDragState.pointerId) {
    const state = waterCircleCenterDragState
    waterCircleCenterDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)
    setActiveWaterCircleHandle(null)

    try {
      buildWaterPreviewFromLocalPoints(state.runtimeObject, state.basePoints)
      ensureWaterCircleHandlesForSelectedNode({ force: true })
    } catch {
      /* noop */
    }

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (waterCircleRadiusDragState && event.pointerId === waterCircleRadiusDragState.pointerId) {
    const state = waterCircleRadiusDragState
    waterCircleRadiusDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)
    setActiveWaterCircleHandle(null)

    try {
      buildWaterPreviewFromLocalPoints(state.runtimeObject, state.basePoints)
      ensureWaterCircleHandlesForSelectedNode({ force: true })
    } catch {
      /* noop */
    }

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

  if (activeBuildTool.value === 'displayBoard') {
    if (displayBoardBuildTool.handlePointerCancel(event)) {
      clearDisplayBoardSizeHud()
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
  }

  if (activeBuildTool.value === 'billboard') {
    if (billboardBuildTool.handlePointerCancel(event)) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
  }

  if (activeBuildTool.value === 'floor') {
    if (floorBuildTool.handlePointerCancel(event)) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
  }

  if (activeBuildTool.value === 'landform') {
    if (landformBuildTool.handlePointerCancel(event)) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
  }

  if (activeBuildTool.value === 'region') {
    if (regionBuildTool.handlePointerCancel(event)) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
  }

  if (activeBuildTool.value === 'water') {
    if (waterBuildTool.handlePointerCancel(event)) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
  }

  if (displayBoardCornerDragState && event.pointerId === displayBoardCornerDragState.pointerId) {
    const state = displayBoardCornerDragState
    displayBoardCornerDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)
    setActiveDisplayBoardCornerHandle(null)
    restoreDisplayBoardPreviewTransform(state)
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (waterEdgeDragState && event.pointerId === waterEdgeDragState.pointerId) {
    const state = waterEdgeDragState
    waterEdgeDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)
    try {
      buildWaterPreviewFromLocalPoints(state.runtimeObject, state.startPoints)
      ensureWaterVertexHandlesForSelectedNode({ force: true })
    } catch {
      /* noop */
    }
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (floorEdgeDragState && event.pointerId === floorEdgeDragState.pointerId) {
    const state = floorEdgeDragState
    floorEdgeDragState = null
    pointerInteraction.releaseIfCaptured(event.pointerId)
    const resetVertices = state.startVertices.map(([x, z]) => [x, z] as [number, number])
    state.workingDefinition.vertices = resetVertices
    updateFloorGroup(state.runtimeObject, state.workingDefinition)
    updateOutlineSelectionTargets()
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
      commitSelectionDragTransformsWithDeferredVertexSnap(dragState)
      sceneStore.endTransformInteraction()
      wallRenderer.endWallDrag(dragState.nodeId)
      updateOutlineSelectionTargets()
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
  if (nodePickerStore.isActive || isTemporaryNavigationOverrideActive()) {
    return
  }
  if (transformControls?.dragging) {
    return
  }
  if (event.ctrlKey || event.metaKey) {
    return
  }

  if (activeBuildTool.value === 'displayBoard') {
    if (displayBoardBuildTool.handleDoubleClick(event)) {
      clearDisplayBoardSizeHud()
      event.preventDefault()
      event.stopPropagation()
      return
    }
  }

  if (activeBuildTool.value === 'billboard') {
    if (billboardBuildTool.handleDoubleClick(event)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
  }

  if (activeBuildTool.value) {
    if (tryExitActiveNodeBuildToolEditMode(event)) {
      event.preventDefault()
      event.stopPropagation()
    }
    return
  }

  flushPendingScenePatchesForInteraction()
  const hit = pickNodeAtPointer(event)
  if (!hit) {
    return
  }

  const hitNodeId = hit.nodeId
  handleViewportDoubleClickNode(hitNodeId)
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

function cancelActiveBuildOperation(options?: { restoreTransformTool?: EditorTool | null }): boolean {
  exitScatterEraseMode()
  const tool = activeBuildTool.value
  if (!tool) {
    return false
  }

  const restoreTransformTool = options?.restoreTransformTool ?? null

  let handled = false
  switch (tool) {
    case 'terrain':
    case 'paint':
    case 'scatter':
      if (groundEditorHasActiveSelection()) {
        cancelGroundSelection()
      } else {
        handleBuildToolChange(null)
      }
      handled = true
      break
    case 'wall':
      if (wallBuildTool.getSession()) {
        wallBuildTool.cancel()
      }
      // Exit tool after cancel (match floor/road) so TransformToolbar becomes usable again.
      handleBuildToolChange(null)
      handled = true
      break
    case 'floor':
      if (floorBuildTool.cancel()) {
        // keep tool active? match road behavior: exit tool after cancel
      }
      handleBuildToolChange(null)
      handled = true
      break
    case 'landform':
      landformBuildTool.cancel()
      handleBuildToolChange(null)
      handled = true
      break
    case 'region':
      regionBuildTool.cancel()
      handleBuildToolChange(null)
      handled = true
      break
    case 'road':
      roadBuildTool.cancel()
      handleBuildToolChange(null)
      handled = true
      break
    case 'water':
      waterBuildTool.cancel()
      handleBuildToolChange(null)
      handled = true
      break
    case 'displayBoard':
      displayBoardBuildTool.cancel()
      clearDisplayBoardSizeHud()
      handleBuildToolChange(null)
      handled = true
      break
    case 'billboard':
      billboardBuildTool.cancel()
      handleBuildToolChange(null)
      handled = true
      break
    case 'warpGate':
      warpGatePlacementClickSessionState = null
      hideWarpGatePlacementPreview()
      handleBuildToolChange(null)
      handled = true
      break
    default:
      return false
  }

  if (handled && restoreTransformTool && restoreTransformTool !== props.activeTool) {
    emit('changeTool', restoreTransformTool)
  }

  return handled
}

function handleBuildToolChange(tool: BuildTool | null) {
  if (tool && isBuildToolBlockedDuringGroundSculptConfig(tool)) {
    // Preserve the last selected transform tool so we can restore it when exiting build via right double click.
    if (props.activeTool !== 'select') {
      transformToolBeforeBuild = props.activeTool
    }
  }
  if (activeBuildTool.value === 'floor' && tool !== 'floor') {
    floorBuildTool.cancel()
  }
  if (activeBuildTool.value === 'landform' && tool !== 'landform') {
    landformBuildTool.cancel()
  }
  if (activeBuildTool.value === 'region' && tool !== 'region') {
    regionBuildTool.cancel()
  }
  if (activeBuildTool.value === 'water' && tool !== 'water') {
    waterBuildTool.cancel()
  }
  if (activeBuildTool.value === 'displayBoard' && tool !== 'displayBoard') {
    displayBoardBuildTool.cancel()
    clearDisplayBoardSizeHud()
  }
  if (activeBuildTool.value === 'billboard' && tool !== 'billboard') {
    billboardBuildTool.cancel()
  }
  if (activeBuildTool.value === 'warpGate' && tool !== 'warpGate') {
    warpGatePlacementClickSessionState = null
    hideWarpGatePlacementPreview()
  }
  if (isGroundBuildTool(tool)) {
    exitScatterEraseMode()
    cancelGroundEditorScatterPlacement()
  }
  const accepted = buildToolsStore.setActiveBuildTool(tool)
  if (!accepted) {
    return
  }
  const desiredContext = resolveSelectionContextForBuildTool(tool)
  if (desiredContext) {
    uiStore.setActiveSelectionContext(desiredContext)
  } else if (isManagedBuildToolContext(uiStore.activeSelectionContext)) {
    uiStore.setActiveSelectionContext(null)
  }
  if (tool !== 'terrain' && (terrainStore.brushOperation ?? null)) {
    terrainStore.setBrushOperation(null)
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

type PlacementHitKind = 'surfaceHit' | 'planeFallback'
type PlacementHitResult = {
  point: THREE.Vector3
  kind: PlacementHitKind
  hitNodeId: string | null
}

function computePlacementSurfaceHit(): { point: THREE.Vector3; nodeId: string } | null {
  const targets = ensurePlacementSurfaceTargetsUpToDate()
  if (!targets.length) {
    return null
  }

  const intersections = raycaster.intersectObjects(targets, false)
  intersections.sort((a, b) => a.distance - b.distance)

  for (const intersection of intersections) {
    if (!intersection?.point) {
      continue
    }

    const objectUserData = (intersection.object as THREE.Object3D | null)?.userData as Record<string, unknown> | undefined
    if (objectUserData?.editorOnly || objectUserData?.instancedPickProxy) {
      continue
    }

    const nodeId = resolveNodeIdFromIntersection(intersection)
    if (!nodeId) {
      continue
    }

    const baseObject = objectMap.get(nodeId) ?? null
    if (!baseObject) {
      continue
    }
    if (!sceneStore.isNodeVisible(nodeId)) {
      continue
    }
    if (!isObjectWorldVisible(baseObject)) {
      continue
    }

    return { point: intersection.point.clone(), nodeId }
  }

  return null
}

function resolveGroundNodeIdForPlacement(): string | null {
  const groundNode = getGroundNodeFromStore()
  return groundNode?.id ?? null
}

const heightfieldRayMatrixHelper = new THREE.Matrix4()
const heightfieldRayHelper = new THREE.Ray()
const heightfieldRayPointHelper = new THREE.Vector3()

function intersectRayWithGroundHeightfieldWorld(ray: THREE.Ray): THREE.Vector3 | null {
  const groundDefinition = resolveGroundDynamicMeshDefinition()
  const groundNodeId = resolveGroundNodeIdForPlacement()
  if (!groundDefinition || !groundNodeId) {
    return null
  }

  const groundObject = objectMap.get(groundNodeId) ?? getRuntimeObject(groundNodeId)
  if (!groundObject) {
    return null
  }

  // Convert ray into ground-local space.
  groundObject.updateMatrixWorld(true)
  heightfieldRayMatrixHelper.copy(groundObject.matrixWorld).invert()
  heightfieldRayHelper.copy(ray).applyMatrix4(heightfieldRayMatrixHelper)

  const halfWidth = Number(groundDefinition.width) * 0.5
  const halfDepth = Number(groundDefinition.depth) * 0.5
  if (!Number.isFinite(halfWidth) || !Number.isFinite(halfDepth) || halfWidth <= 0 || halfDepth <= 0) {
    return null
  }

  const origin = heightfieldRayHelper.origin
  const dir = heightfieldRayHelper.direction

  // Intersect the ray with the ground's XZ bounds first (2D slab in X/Z).
  const EPS = 1e-8
  let tMin = 0
  let tMax = Number.POSITIVE_INFINITY

  const updateSlab = (o: number, d: number, min: number, max: number): boolean => {
    if (Math.abs(d) < EPS) {
      return o >= min && o <= max
    }
    const inv = 1 / d
    let t1 = (min - o) * inv
    let t2 = (max - o) * inv
    if (t1 > t2) {
      const tmp = t1
      t1 = t2
      t2 = tmp
    }
    tMin = Math.max(tMin, t1)
    tMax = Math.min(tMax, t2)
    return tMax >= tMin
  }

  if (!updateSlab(origin.x, dir.x, -halfWidth, halfWidth)) {
    return null
  }
  if (!updateSlab(origin.z, dir.z, -halfDepth, halfDepth)) {
    return null
  }
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMax < 0) {
    return null
  }
  if (tMin < 0) {
    tMin = 0
  }

  const cellSize = Number.isFinite(groundDefinition.cellSize) && groundDefinition.cellSize > 0
    ? groundDefinition.cellSize
    : 1
  const step = Math.max(0.25, cellSize * 0.5)
  const maxSteps = 800

  const evalF = (t: number): number => {
    const x = origin.x + dir.x * t
    const z = origin.z + dir.z * t
    const y = origin.y + dir.y * t
    const h = sampleGroundHeight(groundDefinition, x, z)
    return y - h
  }

  let prevT = tMin
  let prevF = evalF(prevT)
  if (!Number.isFinite(prevF)) {
    return null
  }
  if (prevF <= 0) {
    // Ray starts below/inside terrain; snap to heightfield at entry.
    const x = origin.x + dir.x * prevT
    const z = origin.z + dir.z * prevT
    const h = sampleGroundHeight(groundDefinition, x, z)
    heightfieldRayPointHelper.set(x, h, z)
    groundObject.localToWorld(heightfieldRayPointHelper)
    return heightfieldRayPointHelper.clone()
  }

  for (let i = 0; i < maxSteps && prevT <= tMax; i += 1) {
    const nextT = Math.min(tMax, prevT + step)
    const nextF = evalF(nextT)
    if (!Number.isFinite(nextF)) {
      return null
    }
    if (nextF <= 0) {
      // Root between prevT and nextT; refine with bisection.
      let a = prevT
      let b = nextT
      for (let j = 0; j < 18; j += 1) {
        const m = (a + b) * 0.5
        const fm = evalF(m)
        if (!Number.isFinite(fm)) {
          break
        }
        if (fm > 0) {
          a = m
        } else {
          b = m
        }
      }
      const x = origin.x + dir.x * b
      const z = origin.z + dir.z * b
      const h = sampleGroundHeight(groundDefinition, x, z)
      heightfieldRayPointHelper.set(x, h, z)
      groundObject.localToWorld(heightfieldRayPointHelper)
      return heightfieldRayPointHelper.clone()
    }
    prevT = nextT
    prevF = nextF
    if (prevT >= tMax) {
      break
    }
  }

  return null
}

function sampleHeightfieldWorldYAt(worldPosition: THREE.Vector3): number | null {
  const groundDefinition = resolveGroundDynamicMeshDefinition()
  const groundNodeId = resolveGroundNodeIdForPlacement()
  if (!groundDefinition || !groundNodeId) {
    return null
  }
  const groundObject = objectMap.get(groundNodeId) ?? getRuntimeObject(groundNodeId)
  if (!groundObject) {
    return null
  }
  const localPoint = groundObject.worldToLocal(worldPosition.clone())
  const height = sampleGroundHeight(groundDefinition, localPoint.x, localPoint.z)
  localPoint.y = height
  groundObject.localToWorld(localPoint)
  return localPoint.y
}

function computePreviewPointForPlacement(placement: PlacementHitResult | null): THREE.Vector3 | null {
  if (!placement?.point) {
    return null
  }

  const spawnPoint = placement.point.clone()
  snapVectorToGrid(spawnPoint)

  const groundNodeId = resolveGroundNodeIdForPlacement()
  const shouldSnapToHeightfield =
    placement.kind === 'planeFallback'
    || (placement.kind === 'surfaceHit' && Boolean(groundNodeId) && placement.hitNodeId === groundNodeId)

  if (shouldSnapToHeightfield) {
    const heightfieldY = sampleHeightfieldWorldYAt(spawnPoint)
    if (typeof heightfieldY === 'number' && Number.isFinite(heightfieldY)) {
      spawnPoint.y = heightfieldY
    }
  }

  return spawnPoint
}

function computeDropPlacement(event: DragEvent): PlacementHitResult | null {
  if (!camera || !canvasRef.value) return null
  const rect = canvasRef.value.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1
  const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1
  pointer.set(ndcX, ndcY)
  raycaster.setFromCamera(pointer, camera)

  // Placement modifier: hold Alt to force ground-plane placement (legacy behavior).
  // Default behavior (Alt not held): prefer snapping to visible scene surfaces.
  if (!event.altKey && !isTemporaryNavigationOverrideActive()) {
    const surfaceHit = computePlacementSurfaceHit()
    if (surfaceHit) {
      const point = surfaceHit.point.clone()
      snapVectorToGrid(point)
      return {
        point,
        kind: 'surfaceHit',
        hitNodeId: surfaceHit.nodeId,
      }
    }

    // If we have a ground heightfield, prefer intersecting the ray with it rather than the y=0 plane.
    const heightfieldHit = intersectRayWithGroundHeightfieldWorld(raycaster.ray)
    if (heightfieldHit) {
      const point = heightfieldHit.clone()
      snapVectorToGrid(point)
      return { point, kind: 'planeFallback', hitNodeId: null }
    }
  }

  const planeHit = new THREE.Vector3()
  if (raycaster.ray.intersectPlane(groundPlane, planeHit)) {
    const point = planeHit.clone()
    snapVectorToGrid(point)
    return { point, kind: 'planeFallback', hitNodeId: null }
  }
  return null
}

function computePointerDropPlacement(event: PointerEvent): PlacementHitResult | null {
  if (!camera || !canvasRef.value) return null
  const rect = canvasRef.value.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1
  const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1
  pointer.set(ndcX, ndcY)
  raycaster.setFromCamera(pointer, camera)

  // Placement modifier: hold Alt to force ground-plane placement (legacy behavior).
  // Default behavior (Alt not held): prefer snapping to visible scene surfaces.
  if (!event.altKey && !isTemporaryNavigationOverrideActive()) {
    const surfaceHit = computePlacementSurfaceHit()
    if (surfaceHit) {
      const point = surfaceHit.point.clone()
      snapVectorToGrid(point)
      return {
        point,
        kind: 'surfaceHit',
        hitNodeId: surfaceHit.nodeId,
      }
    }

    const heightfieldHit = intersectRayWithGroundHeightfieldWorld(raycaster.ray)
    if (heightfieldHit) {
      const point = heightfieldHit.clone()
      snapVectorToGrid(point)
      return { point, kind: 'planeFallback', hitNodeId: null }
    }
  }

  const planeHit = new THREE.Vector3()
  if (raycaster.ray.intersectPlane(groundPlane, planeHit)) {
    const point = planeHit.clone()
    snapVectorToGrid(point)
    return { point, kind: 'planeFallback', hitNodeId: null }
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
  if (node.dynamicMesh?.type === 'Region') {
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

function inferAssetExtension(asset: ProjectAsset | null): string | null {
  if (!asset) {
    return null
  }
  const source = asset.name || asset.downloadUrl || asset.id
  if (!source) {
    return null
  }
  return getLastExtensionFromFilenameOrUrl(source)
}

function isWallPresetAsset(asset: ProjectAsset | null): boolean {
  if (!asset) {
    return false
  }
  if (typeof asset.description === 'string' && asset.description.length > 0 && isWallPresetFilename(asset.description)) {
    return true
  }
  return inferAssetExtension(asset) === '.wall'
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
    return isVideoLikeExtension(extension)
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
    clearAssetPlacementPreviewSnapshot()
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
    clearAssetPlacementPreviewSnapshot()
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
      clearAssetPlacementPreviewSnapshot()
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
    clearAssetPlacementPreviewSnapshot()
    dragPreview.dispose()
    return
  }

  // Wall presets (.wall) are not placeable in the viewport.
  if (asset && isWallPresetAsset(asset)) {
    event.preventDefault()
    isDragHovering.value = true
    updateGridHighlight(null)
    dragPreview.dispose()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'none'
    }
    return
  }

  // For placeable 3D assets, only show preview when the pointer is strictly over the canvas
  // (i.e. not occluded by other UI).
  if (!isStrictPointOnCanvas(event.clientX, event.clientY)) {
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy'
    }
    isDragHovering.value = true
    updateGridHighlight(null)
    snapController.resetPlacementSideSnap()
    clearPlacementSideSnapMarkers()
    clearAssetPlacementPreviewSnapshot()
    dragPreview.setPosition(null)
    dragPreviewGroup.visible = false
    return
  }

  const placement = computeDropPlacement(event)
  const basePoint = computePreviewPointForPlacement(placement)
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  isDragHovering.value = true
  updateGridHighlight(basePoint, DEFAULT_GRID_HIGHLIGHT_DIMENSIONS)
  // Keep dragPreview internal state aligned to the *surface* point so grid highlight remains correct.
  dragPreview.setPosition(basePoint)
  if (info) {
    dragPreview.prepare(info.assetId)
    if (basePoint) {
      const provisionalAligned = computeWorldAabbBottomAlignedPoint(basePoint, dragPreviewGroup)
      if (provisionalAligned) {
        dragPreviewGroup.position.copy(provisionalAligned)
        dragPreviewGroup.visible = true
      }

      const now = Date.now()
      if (now - lastDragHoverPreviewUpdate > 8) {
        lastDragHoverPreviewUpdate = now
        const placementSnapActive = isVertexSnapActiveEffective.value && props.activeTool === 'select'
        const result = snapController.updatePlacementSideSnap({
          event,
          previewObject: dragPreviewGroup,
          active: placementSnapActive,
          pixelThresholdPx: vertexSnapThresholdPx.value,
          excludeNodeIds: new Set([GROUND_NODE_ID]),
        })
        updatePlacementSideSnapMarkers(result)
        finalizeAssetPlacementPreview({
          assetId: info.assetId,
          basePoint,
          snapResult: result,
        })
      }
    } else {
      clearAssetPlacementPreviewSnapshot()
      dragPreviewGroup.visible = false
      snapController.resetPlacementSideSnap()
      clearPlacementSideSnapMarkers()
    }
  } else {
    clearAssetPlacementPreviewSnapshot()
    snapController.resetPlacementSideSnap()
    clearPlacementSideSnapMarkers()
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
  deactivateVOverride()
  isDragHovering.value = false
  updateGridHighlight(null)
  snapController.resetPlacementSideSnap()
  clearPlacementSideSnapMarkers()
  clearAssetPlacementPreviewSnapshot()
  dragPreview.dispose()
  restoreGridHighlightForSelection()
}

async function handleViewportDrop(event: DragEvent) {
  if (!isAssetDrag(event)) return
  const info = resolveDragAsset(event)
  event.preventDefault()
  event.stopPropagation()
  deactivateVOverride()
  clearPlacementSideSnapMarkers()
  isDragHovering.value = false
  if (!info) {
    clearAssetPlacementPreviewSnapshot()
    dragPreview.dispose()
    sceneStore.setDraggingAssetObject(null)
    updateGridHighlight(null)
    restoreGridHighlightForSelection()
    snapController.resetPlacementSideSnap()
    return
  }

  const assetId = info.assetId
  const asset = info.asset ?? sceneStore.getAsset(assetId) ?? null
  const assetType = asset?.type ?? null
  const isTexture = assetType === 'texture' || assetType === 'image'

  if (asset && isWallPresetAsset(asset)) {
    clearAssetPlacementPreviewSnapshot()
    dragPreview.dispose()
    sceneStore.setDraggingAssetObject(null)
    updateGridHighlight(null)
    restoreGridHighlightForSelection()
    snapController.resetPlacementSideSnap()
    return
  }

  if (asset && isDisplayBoardCompatibleAsset(asset)) {
    const target = resolveDisplayBoardDropTarget(event)
    if (target) {
      await sceneStore.applyDisplayBoardAsset(target.nodeId, target.component.id, assetId, { updateMaterial: true })
      clearAssetPlacementPreviewSnapshot()
      dragPreview.dispose()
      sceneStore.setDraggingAssetObject(null)
      updateGridHighlight(null)
      restoreGridHighlightForSelection()
      snapController.resetPlacementSideSnap()
      return
    }
  }

  if (assetType === 'material') {
    const target = resolveMaterialDropTarget(event)
    if (!target) {
      console.warn('No compatible mesh found for material drop', assetId)
      clearAssetPlacementPreviewSnapshot()
      dragPreview.dispose()
      sceneStore.setDraggingAssetObject(null)
      updateGridHighlight(null)
      restoreGridHighlightForSelection()
      snapController.resetPlacementSideSnap()
      return
    }
    const applied = applyMaterialAssetToNode(target.nodeId, assetId)
    if (!applied) {
      console.warn('Failed to apply material asset to node', assetId, target.nodeId)
    }
    clearAssetPlacementPreviewSnapshot()
    dragPreview.dispose()
    sceneStore.setDraggingAssetObject(null)
    updateGridHighlight(null)
    restoreGridHighlightForSelection()
    snapController.resetPlacementSideSnap()
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
    clearAssetPlacementPreviewSnapshot()
    dragPreview.dispose()
    sceneStore.setDraggingAssetObject(null)
    updateGridHighlight(null)
    restoreGridHighlightForSelection()
    snapController.resetPlacementSideSnap()
    return
  }

  if (isTexture) {
    const target = resolveMaterialDropTarget(event)
    if (!target) {
      console.warn('No compatible mesh found for texture drop', assetId)
      clearAssetPlacementPreviewSnapshot()
      dragPreview.dispose()
      sceneStore.setDraggingAssetObject(null)
      updateGridHighlight(null)
      restoreGridHighlightForSelection()
      snapController.resetPlacementSideSnap()
      return
    }
    const applied = applyTextureAssetToNode(target.nodeId, assetId, asset?.name)
    if (!applied) {
      console.warn('Failed to apply texture asset to node', assetId, target.nodeId)
    } 
    clearAssetPlacementPreviewSnapshot()
    dragPreview.dispose()
    sceneStore.setDraggingAssetObject(null)
    updateGridHighlight(null)
    restoreGridHighlightForSelection()
    snapController.resetPlacementSideSnap()
    return
  }

  const placementSideSnap = (isVertexSnapActiveEffective.value && props.activeTool === 'select')
    ? snapController.consumePlacementSideSnapResult()
    : null

  const previewSnapshot = getAssetPlacementPreviewSnapshot(assetId)
  const placement = computeDropPlacement(event)
  const basePoint = computePreviewPointForPlacement(placement) ?? new THREE.Vector3(0, 0, 0)
  const canUsePreviewBounds = Boolean(dragPreviewGroup.children && dragPreviewGroup.children.length > 0)
  let fallbackPosition = canUsePreviewBounds
    ? (computeWorldAabbBottomAlignedPoint(basePoint, dragPreviewGroup) ?? basePoint)
    : basePoint
  if (placementSideSnap) {
    fallbackPosition.add(placementSideSnap.delta)
  }
  const parentGroupId = assetType === 'prefab' ? null : resolveSelectedGroupDropParent()
  try {
    const selectedId = props.selectedNodeId
    const isEmptySelectedGroup = (() => {
      if (!selectedId || parentGroupId !== selectedId) return false
      const { nodeMap } = buildHierarchyMaps()
      const selectedNode = nodeMap.get(selectedId)
      if (!selectedNode || selectedNode.nodeType !== 'Group') return false
      return !selectedNode.children || selectedNode.children.length === 0
    })()

    let spawnResult: { node: { id: string } } | null = null
    const worldPosition = previewSnapshot?.worldPosition ?? fallbackPosition
    const rotation = previewSnapshot?.rotation ?? new THREE.Vector3(0, placementPreviewYaw, 0)
    const scale = previewSnapshot?.scale ?? null

    if (isEmptySelectedGroup && parentGroupId) {
      spawnResult = await sceneStore.spawnAssetIntoEmptyGroupAtWorldTransform(assetId, parentGroupId, {
        position: worldPosition,
        rotation,
        scale,
      })
    } else {
      spawnResult = await sceneStore.spawnAssetAtWorldTransform(assetId, {
        position: worldPosition,
        rotation,
        scale,
        parentId: parentGroupId,
        preserveWorldPosition: Boolean(parentGroupId),
      })
    }
    void spawnResult
  } catch (error) {
    console.warn('Failed to spawn asset for drag payload', assetId, error)
  } finally {
    clearAssetPlacementPreviewSnapshot()
    dragPreview.dispose()
    sceneStore.setDraggingAssetObject(null)
    snapController.resetPlacementSideSnap()
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

function handleDirectionalLightTargetPivotTransformChange(options: {
  target: THREE.Object3D
  mode: string
  primaryId: string | null
  primaryObject: THREE.Object3D | null
}): void {
  const { target, mode, primaryId, primaryObject } = options

  if (!primaryId) {
    return
  }
  if (!prepareDirectionalLightTargetPivotWorldState(primaryId, target)) {
    return
  }

  if (mode === 'translate') {
    applyDirectionalLightTargetPivotTranslate(primaryId, primaryObject)
    return
  }

  if (mode === 'rotate') {
    applyDirectionalLightTargetPivotRotate(primaryId, primaryObject)
    return
  }
}

function prepareDirectionalLightTargetPivotWorldState(primaryId: string, target: THREE.Object3D): boolean {
  const node = sceneStore.getNodeById(primaryId)
  if (!node?.light || node.light.type !== 'Directional') {
    return false
  }

  if (!directionalLightPivotEditState || directionalLightPivotEditState.nodeId !== primaryId) {
    beginDirectionalLightTargetPivotInteraction(primaryId)
  }

  target.updateMatrixWorld(true)
  target.getWorldPosition(directionalLightPivotWorldPositionHelper)
  target.getWorldQuaternion(directionalLightPivotWorldQuaternionHelper)
  return true
}

function applyDirectionalLightTargetPivotTranslate(primaryId: string, primaryObject: THREE.Object3D | null): void {
  updateDirectionalLightTargetFromPivotWorldPosition(primaryId)
  syncDirectionalLightRealtimeFromStore(primaryId, primaryObject)
  finalizeDirectionalLightPivotEdit(primaryObject)
}

function updateDirectionalLightTargetFromPivotWorldPosition(primaryId: string): void {
  const state = directionalLightPivotEditState
  const captureHistory = Boolean(state?.captureHistoryPending)
  if (state) {
    state.captureHistoryPending = false
  }

  sceneStore.updateLightProperties(
    primaryId,
    {
      target: {
        x: directionalLightPivotWorldPositionHelper.x,
        y: directionalLightPivotWorldPositionHelper.y,
        z: directionalLightPivotWorldPositionHelper.z,
      },
    },
    { captureHistory },
  )
}

function syncDirectionalLightRealtimeFromStore(primaryId: string, primaryObject: THREE.Object3D | null): void {
  // Directly update the Three.js light target so lighting renders in
  // real-time during the drag (scene graph sync is deferred while dragging).
  if (!primaryObject) {
    return
  }
  const updatedNode = sceneStore.getNodeById(primaryId)
  if (!updatedNode) {
    return
  }
  syncLightFromNodeDuringDrag(primaryObject, updatedNode, updateLightObjectProperties)
}

function finalizeDirectionalLightPivotEdit(primaryObject: THREE.Object3D | null): void {
  updateGridHighlightFromObject(primaryObject)
  updateSelectionHighlights()
}

function computeDirectionalLightPivotCandidateDirectionWorld(state: {
  initialPivotWorldQuaternion: THREE.Quaternion
  initialDirectionWorld: THREE.Vector3
}): THREE.Vector3 {
  // Derive a new direction from the pivot's rotation delta.
  directionalLightInvQuaternionHelper.copy(state.initialPivotWorldQuaternion).invert()
  directionalLightDeltaQuaternionHelper
    .copy(directionalLightPivotWorldQuaternionHelper)
    .multiply(directionalLightInvQuaternionHelper)

  directionalLightCandidateDirectionWorldHelper
    .copy(state.initialDirectionWorld)
    .applyQuaternion(directionalLightDeltaQuaternionHelper)

  if (directionalLightCandidateDirectionWorldHelper.lengthSq() < 1e-12) {
    directionalLightCandidateDirectionWorldHelper.set(0, -1, 0)
  } else {
    directionalLightCandidateDirectionWorldHelper.normalize()
  }

  return directionalLightCandidateDirectionWorldHelper
}

function computeDirectionalLightFixedHeightSignedDistance(options: {
  directionY: number
  targetWorldY: number
  fixedWorldY: number
  maxDistance: number
}): number {
  const { directionY, targetWorldY, fixedWorldY, maxDistance } = options
  const denom = directionY
  const numerator = targetWorldY - fixedWorldY

  let d = 0
  if (!Number.isFinite(denom) || Math.abs(denom) < DIRECTIONAL_LIGHT_FIXED_HEIGHT_EPS) {
    d = Math.sign(-numerator || 1) * maxDistance
  } else {
    d = numerator / denom
  }

  if (!Number.isFinite(d)) {
    d = Math.sign(-numerator || 1) * maxDistance
  }

  return clampNumber(d, -maxDistance, maxDistance)
}

function computeDirectionalLightFixedHeightLocalPosition(options: {
  primaryObject: THREE.Object3D
  targetWorldPosition: THREE.Vector3
  directionWorld: THREE.Vector3
  signedDistance: number
  fixedWorldY: number
}): THREE.Vector3 {
  const { primaryObject, targetWorldPosition, directionWorld, signedDistance, fixedWorldY } = options

  // Place the light along the direction ray while enforcing a fixed world Y.
  transformWorldPositionBuffer.copy(targetWorldPosition)
  transformWorldPositionBuffer.addScaledVector(directionWorld, -signedDistance)
  transformWorldPositionBuffer.y = fixedWorldY

  const parent = primaryObject.parent
  if (parent) {
    parent.updateMatrixWorld(true)
    parent.worldToLocal(transformWorldPositionBuffer)
  } else {
    rootGroup.updateMatrixWorld(true)
    rootGroup.worldToLocal(transformWorldPositionBuffer)
  }

  return transformWorldPositionBuffer
}

function applyDirectionalLightTargetPivotRotate(primaryId: string, primaryObject: THREE.Object3D | null): void {
  const state = directionalLightPivotEditState
  if (!state || state.nodeId !== primaryId) {
    return
  }
  if (!primaryObject) {
    return
  }

  const directionWorld = computeDirectionalLightPivotCandidateDirectionWorld(state)
  const targetWorldY = directionalLightPivotWorldPositionHelper.y
  const fixedY = state.fixedLightWorldY
  const maxD = resolveDirectionalLightMaxFixedHeightDistance(primaryId)

  const d = computeDirectionalLightFixedHeightSignedDistance({
    directionY: directionWorld.y,
    targetWorldY,
    fixedWorldY: fixedY,
    maxDistance: maxD,
  })

  const localPosition = computeDirectionalLightFixedHeightLocalPosition({
    primaryObject,
    targetWorldPosition: directionalLightPivotWorldPositionHelper,
    directionWorld,
    signedDistance: d,
    fixedWorldY: fixedY,
  })

  // Directly update the Three.js object so the light renders in real-time
  // during the drag (scene graph sync is deferred while dragging).
  primaryObject.position.copy(localPosition)
  primaryObject.updateMatrixWorld(true)

  // Keep the directional light target fixed in world space so the sun handle
  // doesn't drift while we move the light to change direction.
  lockDirectionalLightTargetWorldPosition(
    primaryObject,
    directionalLightPivotWorldPositionHelper,
    lightTargetWorldPositionHelper,
  )

  emit('updateNodeTransform', {
    id: primaryId,
    position: {
      x: localPosition.x,
      y: localPosition.y,
      z: localPosition.z,
    },
  })

  finalizeDirectionalLightPivotEdit(primaryObject)
}

function computeTransformUpdatesForGroupTransform(options: {
  target: THREE.Object3D
  mode: string
  shouldSnapTranslate: boolean
  isActiveTranslateTool: boolean
  groupState: NonNullable<typeof transformGroupState>
}): TransformUpdatePayload[] {
  const { target, mode, shouldSnapTranslate, isActiveTranslateTool, groupState } = options

  const updates: TransformUpdatePayload[] = []
  const pivotWorld = groupState.initialGroupPivotWorldPosition

  // Current pivot transform comes from the attached object (selection pivot).
  target.getWorldPosition(transformWorldPositionBuffer)
  target.getWorldQuaternion(transformPivotCurrentWorldQuaternion)
  target.getWorldScale(transformPivotCurrentWorldScale)

  switch (mode) {
    case 'translate': {
      transformDeltaPosition.copy(transformWorldPositionBuffer).sub(pivotWorld)
      groupState.entries.forEach((entry) => {
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
        syncInstancedOutlineEntryTransform(entry.nodeId)
      })
      if (isActiveTranslateTool) {
        transformLastWorldPosition.copy(transformCurrentWorldPosition)
        hasTransformLastWorldPosition = true
      }
      break
    }
    case 'rotate': {
      transformQuaternionInverseHelper.copy(groupState.initialGroupPivotWorldQuaternion).invert()
      transformQuaternionDelta.copy(transformPivotCurrentWorldQuaternion).multiply(transformQuaternionInverseHelper)
      groupState.entries.forEach((entry) => {
        // Orbit position around pivot.
        transformOffsetWorldHelper.copy(entry.initialWorldPosition).sub(pivotWorld)
        transformOffsetWorldHelper.applyQuaternion(transformQuaternionDelta)
        transformWorldPositionBuffer.copy(pivotWorld).add(transformOffsetWorldHelper)

        transformLocalPositionHelper.copy(transformWorldPositionBuffer)
        if (entry.parent) {
          entry.parent.worldToLocal(transformLocalPositionHelper)
        }
        entry.object.position.copy(transformLocalPositionHelper)

        // Rotate orientation in world space, then convert to local.
        transformQuaternionHelper.copy(entry.initialWorldQuaternion)
        transformQuaternionHelper.premultiply(transformQuaternionDelta)

        if (entry.parent) {
          entry.parent.updateMatrixWorld(true)
          entry.parent.getWorldQuaternion(transformParentWorldQuaternionHelper)
          transformParentWorldQuaternionInverseHelper.copy(transformParentWorldQuaternionHelper).invert()
          transformQuaternionHelper.premultiply(transformParentWorldQuaternionInverseHelper)
        }

        entry.object.quaternion.copy(transformQuaternionHelper)
        entry.object.rotation.setFromQuaternion(transformQuaternionHelper)
        entry.object.updateMatrixWorld(true)
        syncInstancedTransform(entry.object, true)
        syncInstancedOutlineEntryTransform(entry.nodeId)
      })

      hasTransformLastWorldPosition = false
      break
    }
    case 'scale': {
      const initialScale = groupState.initialGroupPivotWorldScale
      transformScaleFactor.set(1, 1, 1)
      transformScaleFactor.x = initialScale.x === 0 ? 1 : transformPivotCurrentWorldScale.x / initialScale.x
      transformScaleFactor.y = initialScale.y === 0 ? 1 : transformPivotCurrentWorldScale.y / initialScale.y
      transformScaleFactor.z = initialScale.z === 0 ? 1 : transformPivotCurrentWorldScale.z / initialScale.z

      // Scale offsets in the pivot's orientation frame.
      transformQuaternionInverseHelper.copy(groupState.initialGroupPivotWorldQuaternion).invert()
      groupState.entries.forEach((entry) => {
        entry.object.scale.set(
          entry.initialScale.x * transformScaleFactor.x,
          entry.initialScale.y * transformScaleFactor.y,
          entry.initialScale.z * transformScaleFactor.z,
        )

        transformOffsetWorldHelper.copy(entry.initialWorldPosition).sub(pivotWorld)
        transformOffsetLocalHelper.copy(transformOffsetWorldHelper).applyQuaternion(transformQuaternionInverseHelper)
        transformOffsetLocalHelper.multiply(transformScaleFactor)
        transformOffsetWorldHelper.copy(transformOffsetLocalHelper).applyQuaternion(groupState.initialGroupPivotWorldQuaternion)
        transformWorldPositionBuffer.copy(pivotWorld).add(transformOffsetWorldHelper)

        transformLocalPositionHelper.copy(transformWorldPositionBuffer)
        if (entry.parent) {
          entry.parent.worldToLocal(transformLocalPositionHelper)
        }
        entry.object.position.copy(transformLocalPositionHelper)
        entry.object.updateMatrixWorld(true)
        syncInstancedTransform(entry.object, true)
        syncInstancedOutlineEntryTransform(entry.nodeId)
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

  return updates
}

function computeTransformUpdatesForSingleSelect(options: {
  target: THREE.Object3D
  mode: string
  nodeId: string
  groupState: typeof transformGroupState
  isTranslateMode: boolean
  isActiveTranslateTool: boolean
  shouldSnapTranslate: boolean
}): TransformUpdatePayload[] {
  const { target, mode, nodeId, groupState, isTranslateMode, isActiveTranslateTool } = options

  // Single-select legacy path (includes instanced pivot compensation).
  const hasPivotOverride = Boolean((target.userData as any)?.transformControlsPivotWorld?.isVector3)
  const effectiveNodeId = nodeId

  if (isTranslateMode && isActiveTranslateTool) {
    transformLastWorldPosition.copy(transformCurrentWorldPosition)
    hasTransformLastWorldPosition = true
  }

  // If TransformControls is not pivot-aware, compensate so the PickProxy center stays fixed.
  if ((mode === 'rotate' || mode === 'scale') && !hasPivotOverride) {
    const primaryEntry = groupState?.entries.get(effectiveNodeId) ?? null
    if (primaryEntry) {
      computeTransformPivotWorld(target, instancedPivotWorldHelper)
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
        syncInstancedOutlineEntryTransform(effectiveNodeId)
      }
    }
  }

  return [
    {
      id: effectiveNodeId,
      position: target.position,
      rotation: toEulerLike(target.rotation),
      scale: target.scale,
    },
  ]
}

function applyTransformChangeSingleSelectSnap(options: {
  isPivotTarget: boolean
  nodeId: string | null
  isTranslateMode: boolean
  shouldSnapTranslate: boolean
  target: THREE.Object3D
}): void {
  const { isPivotTarget, nodeId, isTranslateMode, shouldSnapTranslate, target } = options
  if (!isPivotTarget && nodeId && isTranslateMode && shouldSnapTranslate) {
    // Only snap single-select local position (legacy behavior).
    snapVectorToGridForNode(target.position, nodeId)
  }
}

function applyTransformChangeTranslateDeltaTracking(options: {
  target: THREE.Object3D
  isTranslateMode: boolean
  isActiveTranslateTool: boolean
}): void {
  const { target, isTranslateMode, isActiveTranslateTool } = options

  if (isTranslateMode && isActiveTranslateTool) {
    transformMovementDelta.set(0, 0, 0)
    if (hasTransformLastWorldPosition) {
      transformMovementDelta.copy(transformCurrentWorldPosition).sub(transformLastWorldPosition)
    }
    // surface/face alignment snapping and hint visuals disabled
    target.updateMatrixWorld(true)
    target.getWorldPosition(transformCurrentWorldPosition)
  } else {
    hasTransformLastWorldPosition = false
  }
}

function syncInstancedTransformDuringDragIfNeeded(options: {
  isPivotTarget: boolean
  nodeId: string | null
  target: THREE.Object3D
}): void {
  const { isPivotTarget, nodeId, target } = options
  if (!isPivotTarget && nodeId) {
    // Keep instanced transforms in sync during dragging when transforming a real node.
    syncInstancedTransform(target, true)
    syncInstancedOutlineEntryTransform(nodeId)
    if (target.userData?.instancedPickProxy) {
      updateTransformControlsPivotOverride(target)
    }
  }
}

function finalizeTransformChange(options: {
  updates: TransformUpdatePayload[]
  isGroupTransform: boolean
  primaryObject: THREE.Object3D | null
  target: THREE.Object3D
}): void {
  const { updates, isGroupTransform, primaryObject, target } = options

  updateGridHighlightFromObject((isGroupTransform ? primaryObject : target) ?? null)
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

function getTransformChangeContext(): {
  target: THREE.Object3D
  mode: string
  isDirectionalLightTargetPivot: boolean
  isPivotTarget: boolean
  isTranslateMode: boolean
  isActiveTranslateTool: boolean
  shouldSnapTranslate: boolean
  nodeId: string | null
  primaryId: string | null
  primaryObject: THREE.Object3D | null
} | null {
  if (!transformControls || !isSceneReady.value) {
    return null
  }
  const target = transformControls.object as THREE.Object3D | null
  if (!target) {
    return null
  }

  const isDirectionalLightTargetPivot = Boolean((target.userData as any)?.isDirectionalLightTargetPivot)
  const isPivotTarget = Boolean((target.userData as any)?.isSelectionPivot || isDirectionalLightTargetPivot)
  const mode = transformControls.getMode()
  const isTranslateMode = mode === 'translate'
  const isActiveTranslateTool = props.activeTool === 'translate'
  const shouldSnapTranslate = isTranslateMode && !isActiveTranslateTool

  const nodeId = (target.userData?.nodeId as string | undefined) ?? null
  const primaryId = sceneStore.selectedNodeId ?? nodeId
  const primaryObject = primaryId ? (objectMap.get(primaryId) ?? null) : null

  return {
    target,
    mode,
    isDirectionalLightTargetPivot,
    isPivotTarget,
    isTranslateMode,
    isActiveTranslateTool,
    shouldSnapTranslate,
    nodeId,
    primaryId,
    primaryObject,
  }
}

function isValidTransformTargetForNonPivot(isPivotTarget: boolean, nodeId: string | null): boolean {
  // Single-select requires a real node id.
  return Boolean(isPivotTarget || nodeId)
}

function updateTransformCurrentWorldPositionFromTarget(target: THREE.Object3D): void {
  target.updateMatrixWorld(true)
  target.getWorldPosition(transformCurrentWorldPosition)
}

function computeTransformUpdatesForContext(options: {
  target: THREE.Object3D
  mode: string
  nodeId: string
  isTranslateMode: boolean
  isActiveTranslateTool: boolean
  shouldSnapTranslate: boolean
}): { updates: TransformUpdatePayload[]; isGroupTransform: boolean } {
  const { target, mode, nodeId, isTranslateMode, isActiveTranslateTool, shouldSnapTranslate } = options

  const groupState = transformGroupState
  const isGroupTransform = Boolean(groupState && groupState.entries.size > 1)

  if (isGroupTransform && groupState) {
    return {
      updates: computeTransformUpdatesForGroupTransform({
        target,
        mode,
        shouldSnapTranslate,
        isActiveTranslateTool,
        groupState,
      }),
      isGroupTransform,
    }
  }

  return {
    updates: computeTransformUpdatesForSingleSelect({
      target,
      mode,
      nodeId,
      groupState,
      isTranslateMode,
      isActiveTranslateTool,
      shouldSnapTranslate,
    }),
    isGroupTransform: false,
  }
}

function handleTransformChange() {
  const ctx = getTransformChangeContext()
  if (!ctx) {
    return
  }

  const {
    target,
    mode,
    isDirectionalLightTargetPivot,
    isPivotTarget,
    isTranslateMode,
    isActiveTranslateTool,
    shouldSnapTranslate,
    nodeId,
    primaryId,
    primaryObject,
  } = ctx

  if (isDirectionalLightTargetPivot) {
    handleDirectionalLightTargetPivotTransformChange({
      target,
      mode,
      primaryId,
      primaryObject,
    })
    return
  }

  if (!isValidTransformTargetForNonPivot(isPivotTarget, nodeId)) {
    return
  }

  applyTransformChangeSingleSelectSnap({
    isPivotTarget,
    nodeId,
    isTranslateMode,
    shouldSnapTranslate,
    target,
  })

  updateTransformCurrentWorldPositionFromTarget(target)

  applyTransformChangeTranslateDeltaTracking({
    target,
    isTranslateMode,
    isActiveTranslateTool,
  })

  syncInstancedTransformDuringDragIfNeeded({
    isPivotTarget,
    nodeId,
    target,
  })

  const { updates, isGroupTransform } = computeTransformUpdatesForContext({
    target,
    mode,
    nodeId: nodeId!,
    isTranslateMode,
    isActiveTranslateTool,
    shouldSnapTranslate,
  })

  previewLandformNodesDuringTransform(updates, mode)

  finalizeTransformChange({
    updates,
    isGroupTransform,
    primaryObject,
    target,
  })
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

  // Only some light types support shadows.
  if ('castShadow' in (light as any) && typeof (config as any).castShadow === 'boolean') {
    ;(light as any).castShadow = (config as any).castShadow
  }

  applyLightShadowConfig(light, config)

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
    ensureDirectionalLightTargetHandle(light.target, config.color)
    if (typeof config.castShadow === 'boolean') {
      light.castShadow = config.castShadow
    }

  } else if (light instanceof THREE.HemisphereLight) {
    const ground = (config as any).groundColor
    if (typeof ground === 'string' && ground.length) {
      light.groundColor.set(ground)
    }
  }

  container.userData.lightType = config.type
  light.userData = { ...(light.userData ?? {}), nodeId: node.id }

  const helpers = container.children.filter((child) => (child as LightHelperObject).update && child.userData?.nodeId === node.id) as LightHelperObject[]
  helpers.forEach((entry) => entry.update?.())
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

  applyInstanceLayoutVisibilityAndAssetBinding(object, node)

  object.name = node.name
  object.position.set(node.position.x, node.position.y, node.position.z)
  object.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z)


  applyMirroredScaleToObject(object, node.scale ?? null, node.mirror)

  // InstancedMesh: for mirrored instance, clone geometry and flip tangent.w
  if ((object as any).isInstancedMesh) {
    const mesh = object as THREE.InstancedMesh
    if (node.mirror === 'horizontal' || node.mirror === 'vertical') {
      // Only clone if not already mirrored (avoid repeated clones)
      if (!mesh.userData.__harmonyMirroredGeometry) {
        const clonedGeom = cloneGeometryForMirroredInstance(mesh.geometry, node.mirror)
        mesh.geometry = clonedGeom
        mesh.userData.__harmonyMirroredGeometry = true
      }
    } else if (mesh.userData.__harmonyMirroredGeometry && !node.mirror) {
      // Restore original geometry if mirror is removed
      if (mesh.userData.__harmonyOriginalGeometry) {
        mesh.geometry = mesh.userData.__harmonyOriginalGeometry
        delete mesh.userData.__harmonyMirroredGeometry
      }
    } else if (!mesh.userData.__harmonyOriginalGeometry) {
      // Cache original geometry for restoration
      mesh.userData.__harmonyOriginalGeometry = mesh.geometry
    }
  }

  // Mirror uses negative scale sign, which flips triangle winding. Use a DoubleSide
  // mirrored-material side flip (Front<->Back) to avoid inside-out/backface artifacts.
  syncMirroredMeshMaterials(object, node.mirror === 'horizontal' || node.mirror === 'vertical', node.mirror)

  object.visible = sceneStore.isNodeVisible(node.id)

  if (object.userData?.instancedAssetId) {
    ensureInstancedPickProxy(object, node)
  } else {
    removeInstancedPickProxy(object)
  }
  applyViewPointScaleConstraint(object, node)

  const hasChildNodes = Array.isArray(node.children) && node.children.length > 0
  syncInstancedTransform(object, hasChildNodes)

  if (node.nodeType === 'Mesh' && isWaterSurfaceNode(node)) {
    const waterMetadata = getWaterSurfaceMeshMetadata(node)
    if (waterMetadata) {
      const waterContourSignature = computeWaterContourSignature(waterMetadata)
      if (userData.waterSurfaceContourSignature !== waterContourSignature) {
        const updated = updateWaterSurfaceRuntimeMesh(object, waterMetadata)
        if (updated) {
          userData.waterSurfaceContourSignature = waterContourSignature
        }
      }
    } else {
      delete userData.waterSurfaceContourSignature
    }
  }

  if (node.dynamicMesh?.type === 'Ground') {
    const groundObject = resolveGroundRuntimeObject(object)
    if (groundObject) {
      const groundData = groundObject.userData ?? (groundObject.userData = {})
      const groundDefinition = resolveGroundDynamicMeshDefinition()
      if (!groundDefinition) {
        return
      }
      const nextSignature = computeGroundDynamicMeshSignature(groundDefinition)
      if (groundData[DYNAMIC_MESH_SIGNATURE_KEY] !== nextSignature) {
        const shouldSkipSculptRefresh = groundData[GROUND_SCULPT_SKIP_REFRESH_SIGNATURE_KEY] === nextSignature
        if (!shouldSkipSculptRefresh) {
          updateGroundMesh(groundObject, groundDefinition)
        }
        groundData[DYNAMIC_MESH_SIGNATURE_KEY] = nextSignature
        if (shouldSkipSculptRefresh) {
          delete groundData[GROUND_SCULPT_SKIP_REFRESH_SIGNATURE_KEY]
        }
        syncViewportGroundChunks(groundObject, groundDefinition)

      } else if (groundData[GROUND_SCULPT_SKIP_REFRESH_SIGNATURE_KEY] === nextSignature) {
        delete groundData[GROUND_SCULPT_SKIP_REFRESH_SIGNATURE_KEY]
      }
      syncViewportGroundChunks(groundObject, groundDefinition)
    }
  } else if (node.dynamicMesh?.type === 'Wall') {
    const wallComponent = node.components?.[WALL_COMPONENT_TYPE] as
      | SceneNodeComponentState<WallComponentProps>
      | undefined
    const wallProps = clampWallProps(wallComponent?.props as Partial<WallComponentProps> | null | undefined)
    const preloadAssetIds = new Set<string>()
    ;[
      wallProps.bodyAssetId,
      wallProps.headAssetId,
      wallProps.footAssetId,
      wallProps.bodyEndCapAssetId,
      wallProps.headEndCapAssetId,
      wallProps.footEndCapAssetId,
    ].forEach((assetId) => {
      if (typeof assetId === 'string' && assetId.trim().length) {
        preloadAssetIds.add(assetId.trim())
      }
    })
    ;(wallProps.cornerModels ?? []).forEach((entry) => {
      ;[entry?.bodyAssetId, entry?.headAssetId, entry?.footAssetId].forEach((assetId) => {
        if (typeof assetId === 'string' && assetId.trim().length) {
          preloadAssetIds.add(assetId.trim())
        }
      })
    })
    for (const assetId of preloadAssetIds) {
      if (!getCachedModelObject(assetId)) {
        void ensureModelObjectCached(assetId)
      }
    }
    object.updateMatrixWorld(true)
    wallRenderer.syncWallContainer(object, node, DYNAMIC_MESH_SIGNATURE_KEY)

  } else if (node.dynamicMesh?.type === 'Floor') {
    const floorDefinition = node.dynamicMesh as FloorDynamicMesh
    let floorGroup = userData.floorGroup as THREE.Group | undefined
    if (!floorGroup) {
      floorGroup = createFloorGroup(floorDefinition)
      tagInternalRuntimeGroup(floorGroup, node.id, 'Floor')
      floorGroup.userData[DYNAMIC_MESH_SIGNATURE_KEY] = computeFloorDynamicMeshSignature(floorDefinition)
      object.add(floorGroup)
      userData.floorGroup = floorGroup
    } else {
      tagInternalRuntimeGroup(floorGroup, node.id, 'Floor')
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
      tagInternalRuntimeGroup(guideGroup, node.id, 'GuideRoute')
      guideGroup.userData[DYNAMIC_MESH_SIGNATURE_KEY] = computeGuideRouteDynamicMeshSignature(guideDefinition)
      object.add(guideGroup)
      userData.guideRouteGroup = guideGroup
    } else {
      tagInternalRuntimeGroup(guideGroup, node.id, 'GuideRoute')
      const groupData = guideGroup.userData ?? (guideGroup.userData = {})
      const nextSignature = computeGuideRouteDynamicMeshSignature(guideDefinition)
      if (groupData[DYNAMIC_MESH_SIGNATURE_KEY] !== nextSignature) {
        updateGuideRouteGroup(guideGroup, guideDefinition)
        groupData[DYNAMIC_MESH_SIGNATURE_KEY] = nextSignature
      }
    }

    void createOrUpdateGuideRouteWaypointLabels(node, object)
  } else if (node.dynamicMesh?.type === 'Region') {
    const regionDefinition = node.dynamicMesh as RegionDynamicMesh
    let regionGroup = userData.regionGroup as THREE.Group | undefined
    if (!regionGroup) {
      regionGroup = createRegionEditorGroup(regionDefinition)
      tagInternalRuntimeGroup(regionGroup, node.id, 'Region')
      regionGroup.userData[DYNAMIC_MESH_SIGNATURE_KEY] = computeRegionRuntimeSignature(regionDefinition)
      object.add(regionGroup)
      userData.regionGroup = regionGroup
    } else {
      tagInternalRuntimeGroup(regionGroup, node.id, 'Region')
      const groupData = regionGroup.userData ?? (regionGroup.userData = {})
      const nextSignature = computeRegionRuntimeSignature(regionDefinition)
      if (groupData[DYNAMIC_MESH_SIGNATURE_KEY] !== nextSignature) {
        updateRegionEditorGroup(regionGroup, regionDefinition)
        groupData[DYNAMIC_MESH_SIGNATURE_KEY] = nextSignature
      }
    }
  } else if (node.dynamicMesh?.type === 'Road') {
    const roadDefinition = node.dynamicMesh as RoadDynamicMesh
    const junctionSmoothing = resolveRoadJunctionSmoothing(node)
    const laneLines = resolveRoadLaneLinesEnabled(node)
    const shoulders = resolveRoadShouldersEnabled(node)
    const snapToTerrain = resolveRoadSnapToTerrainEnabled(node)
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

    const groundNode = getGroundNodeFromStore()
    const heightSamplerSignature = {
      snapToTerrain,
      roadPosition: node.position ?? null,
      roadRotation: node.rotation ?? null,
      groundPosition: groundNode?.position ?? null,
    }
    let roadGroup = userData.roadGroup as THREE.Group | undefined
    if (!roadGroup) {
      roadGroup = createRoadGroup(roadDefinition, roadOptions)
      tagInternalRuntimeGroup(roadGroup, node.id, 'Road')
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
      tagInternalRuntimeGroup(roadGroup, node.id, 'Road')
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

  if (node.dynamicMesh?.type === 'Floor') {
    refreshFloorRuntimeMaterials(node.id, object)
  } else if (node.materials && node.materials.length) {
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

let lastGroundChunkSetSignatureForPlacement: string | null = null
let lastGroundChunkSetSignatureCheckAt = 0

function computeGroundChunkSetSignatureForPlacement(groundObject: THREE.Object3D): string {
  let count = 0
  let hash = 0
  for (const child of groundObject.children) {
    const chunk = (child as any)?.userData?.groundChunk as { chunkRow?: number; chunkColumn?: number } | undefined
    const row = typeof chunk?.chunkRow === 'number' ? chunk.chunkRow : null
    const col = typeof chunk?.chunkColumn === 'number' ? chunk.chunkColumn : null
    if (row == null || col == null) {
      continue
    }
    count += 1
    // Order-independent, cheap rolling signature.
    hash = (hash + (((row * 73856093) ^ (col * 19349663)) | 0)) | 0
  }
  return `${count}:${hash}`
}

function syncViewportGroundChunks(groundObject: THREE.Object3D, groundDefinition: GroundRuntimeDynamicMesh): void {
  if (!areAllGroundChunksLoaded(groundObject, groundDefinition)) {
    ensureAllGroundChunks(groundObject, groundDefinition)
  }
}

function syncViewportGroundRenderMode(options: { rebuildOptimizedMesh?: boolean } = {}): void {
  const groundNode = getGroundNodeFromStore()
  if (!groundNode || groundNode.dynamicMesh?.type !== 'Ground') {
    pendingViewportGroundOptimizedRebuild = false
    return
  }

  if (options.rebuildOptimizedMesh && pendingViewportGroundOptimizedRebuild) {
    sceneStore.refreshGroundOptimizedMesh(groundNode.id)
    pendingViewportGroundOptimizedRebuild = false
  }

  const groundObject = resolveGroundRuntimeObjectFromMap(objectMap, groundNode.id) ?? undefined
  const groundDefinition = resolveGroundDynamicMeshDefinition()
  if (!groundObject || !groundDefinition) {
    return
  }

  debugViewportGroundRenderMode('sync', groundDefinition)
  updateGroundMesh(groundObject, groundDefinition)
  syncViewportGroundChunks(groundObject, groundDefinition)
}

function updateGroundChunkStreaming() {
  if (!camera) {
    return
  }

  const node = getGroundNodeFromStore()
  if (!node || node.dynamicMesh?.type !== 'Ground') {
    return
  }

  const groundObject = resolveGroundRuntimeObjectFromMap(objectMap, node.id) ?? undefined
  if (!groundObject) {
    return
  }

  const groundDefinition = resolveGroundDynamicMeshDefinition()
  if (!groundDefinition) {
    return
  }

  syncViewportGroundChunks(groundObject, groundDefinition)

  // Ground chunk meshes are streamed in/out without emitting scene patches.
  // Refresh placement raycast targets when the chunk set changes; otherwise asset placement
  // may miss the visible ground and fall back to the y=0 plane, causing cursor/placement drift.
  const now = Date.now()
  if (now - lastGroundChunkSetSignatureCheckAt < 140) {
    return
  }
  lastGroundChunkSetSignatureCheckAt = now

  const signature = computeGroundChunkSetSignatureForPlacement(groundObject)
  if (signature !== lastGroundChunkSetSignatureForPlacement) {
    lastGroundChunkSetSignatureForPlacement = signature
    refreshPlacementSurfaceTargetsForNode(node.id)
    placementSurfaceTargetsDirty = true

    // Chunk meshes stream in/out without scene patches; notify GroundEditor so
    // terrain paint preview can bind to new chunk meshes and load newly visible weightmaps.
    onGroundChunkSetChanged()
  }
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
    clearInstanceLayoutMatrixCacheForNode(nodeId)
    releaseModelInstance(nodeId)
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
    updateNodeObject(object, node)
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
  rebuildPlacementSurfaceTargetsFull()

  refreshPlaceholderOverlays()
  terrainGridController.refresh()
  refreshEffectRuntimeTickers()
  updateSelectionHighlights()
  sceneCsmShadowRuntime?.registerObject(rootGroup)
  sceneCsmShadowRuntime?.registerObject(instancedMeshGroup)
}

function disposeSceneNodes() {
  clearOutlineSelectionTargets()
  instanceLayoutMatrixCache.clear()
  clearLightHelpers()
  placementSurfaceTargetsByNodeId.clear()
  placementSurfaceTargets.length = 0
  placementSurfaceTargetsDirty = true
  placementSurfaceTargetsInstancedRevision = -1
  const nodeIds = Array.from(objectMap.keys())
  nodeIds.forEach((id) => {
    if (objectMap.has(id)) {
      disposeNodeSubtree(id)
    }
  })
  resetEffectRuntimeTickers()
}


type CapturedLightTargetUpdate = { nodeId: string; target: { x: number; y: number; z: number } }

function captureLightTargetWorldPosition(nodeId: string): CapturedLightTargetUpdate | null {
  const node = sceneStore.getNodeById(nodeId)
  const config = node?.light
  if (!config) {
    return null
  }
  if (config.type !== 'Directional' && config.type !== 'Spot') {
    return null
  }
  if (!config.target) {
    return null
  }

  const container = objectMap.get(nodeId)
  if (!container) {
    return null
  }

  const light = container.children.find((child) => (child as THREE.Light).isLight) as
    | THREE.DirectionalLight
    | THREE.SpotLight
    | undefined
  if (!light || !('target' in (light as any)) || !(light as any).target) {
    return null
  }

  try {
    ;(light as any).target.updateMatrixWorld(true)
    ;(light as any).target.getWorldPosition(lightTargetWorldPositionHelper)
    return {
      nodeId,
      target: {
        x: lightTargetWorldPositionHelper.x,
        y: lightTargetWorldPositionHelper.y,
        z: lightTargetWorldPositionHelper.z,
      },
    }
  } catch {
    return null
  }
}

function captureLightTargetsForTransformUpdates(updates: TransformUpdatePayload[]): CapturedLightTargetUpdate[] {
  const captured: CapturedLightTargetUpdate[] = []
  for (const update of updates) {
    const entry = captureLightTargetWorldPosition(update.id)
    if (entry) {
      captured.push(entry)
    }
  }
  return captured
}

function applyCapturedLightTargetUpdates(updates: CapturedLightTargetUpdate[]) {
  if (!updates.length) {
    return
  }
  updates.forEach((entry) => {
    ;(sceneStore as any).updateLightProperties(
      entry.nodeId,
      { target: entry.target },
      { captureHistory: false },
    )
  })
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

function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  return value
}

function applyLightShadowConfig(light: THREE.Light, config: SceneNode['light']): void {
  if (!config) {
    return
  }

  const anyLight = light as any
  const shadow = anyLight.shadow as THREE.LightShadow | undefined
  const shadowConfig = (config as any).shadow as Record<string, unknown> | undefined
  if (!shadow || !shadowConfig) {
    return
  }

  const shadowCamera = shadow.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera | undefined

  const mapSize = coerceFiniteNumber(shadowConfig.mapSize)
  if (mapSize !== null && mapSize > 0) {
    const size = Math.max(1, Math.round(mapSize))
    const currentX = shadow.mapSize?.x ?? 0
    const currentY = shadow.mapSize?.y ?? 0
    if (currentX !== size || currentY !== size) {
      shadow.mapSize.set(size, size)
      ;(shadow as any).map?.dispose?.()
      ;(shadow as any).map = null
    }
  }

  const bias = coerceFiniteNumber(shadowConfig.bias)
  if (bias !== null) {
    shadow.bias = bias
  }

  const normalBias = coerceFiniteNumber(shadowConfig.normalBias)
  if (normalBias !== null) {
    ;(shadow as any).normalBias = normalBias
  }

  const radius = coerceFiniteNumber(shadowConfig.radius)
  if (radius !== null) {
    shadow.radius = radius
  }

  const cameraNear = coerceFiniteNumber(shadowConfig.cameraNear)
  if (cameraNear !== null && shadowCamera) {
    shadowCamera.near = cameraNear
  }

  const cameraFar = coerceFiniteNumber(shadowConfig.cameraFar)
  if (cameraFar !== null && shadowCamera) {
    shadowCamera.far = cameraFar
  }

  if (config.type === 'Directional') {
    const orthoSize = coerceFiniteNumber(shadowConfig.orthoSize)
    const camera = shadowCamera as THREE.OrthographicCamera | undefined
    if (orthoSize !== null && camera && (camera as any).isOrthographicCamera) {
      const s = Math.max(0.01, orthoSize)
      camera.left = -s
      camera.right = s
      camera.top = s
      camera.bottom = -s
    }
  }

  shadowCamera?.updateProjectionMatrix?.()
}

function ensureDirectionalLightTargetHandle(target: THREE.Object3D, color: THREE.ColorRepresentation): void {
  directionalLightTargetHandleManager.ensure(target, {
    color,
    helperSize: DIRECTIONAL_LIGHT_HELPER_SIZE,
  })
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

  switch (config.type) {
    case 'Directional': {
      const directional = new THREE.DirectionalLight(config.color, config.intensity)
      directional.castShadow = config.castShadow ?? false
      applyLightShadowConfig(directional, config)
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
      // Visible, selectable target handle (Unity-like “sun” icon near the scene).
      // Marked editorOnly so it doesn't interfere with placement/snap surfaces, but still pickable.
      ensureDirectionalLightTargetHandle(target, config.color)
      break
    }
    case 'Point': {
      const point = new THREE.PointLight(config.color, config.intensity, config.distance ?? 0, config.decay ?? 1)
      point.castShadow = config.castShadow ?? false
      applyLightShadowConfig(point, config)
      light = point
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
      applyLightShadowConfig(spot, config)
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
    case 'Hemisphere': {
      const ground = (config as any).groundColor ?? '#444444'
      const hemi = new THREE.HemisphereLight(config.color, ground, config.intensity)
      light = hemi
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

  return container
}

function ensureUvDebugMaterialsForMissingMeshes(
  root: THREE.Object3D,
  options: { tint: THREE.ColorRepresentation; transparent?: boolean; opacity?: number },
): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh & { isMesh?: boolean }
    if (!mesh?.isMesh) {
      return
    }

    const rawMaterial = (mesh as any).material as THREE.Material | THREE.Material[] | null | undefined
    if (!rawMaterial || (Array.isArray(rawMaterial) && rawMaterial.length === 0)) {
      ;(mesh as any).material = createUvDebugMaterial({
        tint: options.tint,
        transparent: options.transparent,
        opacity: options.opacity,
        side: THREE.DoubleSide,
      })
      return
    }

    if (Array.isArray(rawMaterial)) {
      let changed = false
      const next = rawMaterial.map((entry) => {
        if (entry) {
          return entry
        }
        changed = true
        return createUvDebugMaterial({
          tint: options.tint,
          transparent: options.transparent,
          opacity: options.opacity,
          side: THREE.DoubleSide,
        })
      })
      if (changed) {
        ;(mesh as any).material = next
      }
    }
  })
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

  ensureUvDebugMaterialsForMissingMeshes(root, { tint: 0xffffff })

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

  ensureUvDebugMaterialsForMissingMeshes(root, { tint: 0xffffff })

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
      const groundDefinition = resolveGroundDynamicMeshDefinition()
      if (!groundDefinition) {
        containerData.dynamicMeshType = 'Ground'
        return container
      }
      debugViewportGroundRenderMode('create', groundDefinition)
      const groundMesh = createGroundMesh(groundDefinition)
      groundMesh.removeFromParent()
      groundMesh.userData.nodeId = node.id
      groundMesh.userData[DYNAMIC_MESH_SIGNATURE_KEY] = computeGroundDynamicMeshSignature(groundDefinition)
      syncViewportGroundChunks(groundMesh, groundDefinition)
      container.add(groundMesh)
      containerData.groundMesh = groundMesh
      containerData.dynamicMeshType = 'Ground'
    } else if (node.dynamicMesh?.type === 'Wall') {
      containerData.dynamicMeshType = 'Wall'
    } else if (node.dynamicMesh?.type === 'Road') {
      containerData.dynamicMeshType = 'Road'
      const roadDefinition = node.dynamicMesh as RoadDynamicMesh
      const junctionSmoothing = resolveRoadJunctionSmoothing(node)
      const laneLines = resolveRoadLaneLinesEnabled(node)
      const shoulders = resolveRoadShouldersEnabled(node)
      const snapToTerrain = resolveRoadSnapToTerrainEnabled(node)
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

      const groundNode = getGroundNodeFromStore()
      const heightSamplerSignature = {
        snapToTerrain,
        roadPosition: node.position ?? null,
        roadRotation: node.rotation ?? null,
        groundPosition: groundNode?.position ?? null,
      }
      const roadGroup = createRoadGroup(roadDefinition, roadOptions)
      roadGroup.removeFromParent()
      tagInternalRuntimeGroup(roadGroup, node.id, 'Road')
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
      tagInternalRuntimeGroup(floorGroup, node.id, 'Floor')
      floorGroup.userData[DYNAMIC_MESH_SIGNATURE_KEY] = computeFloorDynamicMeshSignature(floorDefinition)
      container.add(floorGroup)
      containerData.floorGroup = floorGroup
    } else if (node.dynamicMesh?.type === 'GuideRoute') {
      containerData.dynamicMeshType = 'GuideRoute'
      const guideDefinition = node.dynamicMesh as GuideRouteDynamicMesh
      const guideGroup = createGuideRouteGroup(guideDefinition)
      guideGroup.removeFromParent()
      tagInternalRuntimeGroup(guideGroup, node.id, 'GuideRoute')
      guideGroup.userData[DYNAMIC_MESH_SIGNATURE_KEY] = computeGuideRouteDynamicMeshSignature(guideDefinition)
      container.add(guideGroup)
      ;(containerData as any).guideRouteGroup = guideGroup
      void createOrUpdateGuideRouteWaypointLabels(node, container)
    } else if (node.dynamicMesh?.type === 'Region') {
      containerData.dynamicMeshType = 'Region'
      const regionDefinition = node.dynamicMesh as RegionDynamicMesh
      const regionGroup = createRegionEditorGroup(regionDefinition)
      regionGroup.removeFromParent()
      tagInternalRuntimeGroup(regionGroup, node.id, 'Region')
      regionGroup.userData[DYNAMIC_MESH_SIGNATURE_KEY] = computeRegionRuntimeSignature(regionDefinition)
      container.add(regionGroup)
      ;(containerData as any).regionGroup = regionGroup
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
          ? createUvDebugMaterial({ tint: 0xa8e6ff, transparent: true, opacity: 0.75, side: THREE.DoubleSide, metalness: 0, roughness: 1 })
          : createUvDebugMaterial({ tint: 0xffb3b3, transparent: false, opacity: 1, side: THREE.DoubleSide, metalness: 0, roughness: 1 })
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
  } else if (nodeType === 'Environment') {
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

  const userData = object.userData ?? (object.userData = {})
  userData.nodeId = node.id
  userData.nodeType = nodeType
  userData.dynamicMeshType = node.dynamicMesh?.type ?? userData.dynamicMeshType ?? null
  userData.lightType = node.light?.type ?? null
  userData.sourceAssetId = node.sourceAssetId ?? null
  userData.usesRuntimeObject = sceneStore.hasRuntimeObject(node.id)

  applyInstanceLayoutVisibilityAndAssetBinding(object, node)

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

  sceneCsmShadowRuntime?.registerObject(object)

  return object
}

function applyTransformSpaceForSelection(tool: EditorTool, primaryId: string | null): void {
  if (!transformControls) {
    return
  }
  const ids = collectTopLevelUnlockedSelectionIds(primaryId)
  const isMulti = ids.length > 1
  const nextSpace = isMulti ? 'world' : (tool === 'rotate' ? 'world' : 'local')
  transformControls.setSpace(nextSpace)
}

function collectTopLevelUnlockedSelectionIds(primaryId: string | null): string[] {
  const selectedIds = sceneStore.selectedNodeIds
    .filter((id) => !!id && !sceneStore.isNodeSelectionLocked(id))

  if (primaryId && !sceneStore.isNodeSelectionLocked(primaryId) && !selectedIds.includes(primaryId)) {
    selectedIds.push(primaryId)
  }

  if (!selectedIds.length) {
    return []
  }

  const { parentMap } = buildHierarchyMaps()
  return filterTopLevelSelection(selectedIds, parentMap)
}

function updateSelectionPivotObject(primaryId: string | null, tool: EditorTool): THREE.Vector3 | null {
  const ids = collectTopLevelUnlockedSelectionIds(primaryId)
  if (ids.length <= 1) {
    return null
  }

  const centroidWorld = new THREE.Vector3()
  let count = 0
  const pivotWorld = new THREE.Vector3()
  for (const id of ids) {
    const object = objectMap.get(id)
    if (!object) {
      continue
    }
    computeTransformPivotWorld(object, pivotWorld)
    centroidWorld.add(pivotWorld)
    count += 1
  }
  if (count <= 0) {
    return null
  }
  centroidWorld.multiplyScalar(1 / count)

  // Place pivot under rootGroup.
  rootGroup.updateMatrixWorld(true)
  selectionPivotObject.position.copy(centroidWorld)
  rootGroup.worldToLocal(selectionPivotObject.position)

  // Multi-select pivot is always world-oriented.
  void tool
  selectionPivotObject.quaternion.identity()
  selectionPivotObject.rotation.set(0, 0, 0)
  selectionPivotObject.scale.set(1, 1, 1)
  selectionPivotObject.updateMatrixWorld(true)

  return centroidWorld
}

function attachSelection(nodeId: string | null, tool: EditorTool = props.activeTool) {
  const effectiveTool = getSafeTransformTool(tool)
  const primaryId = nodeId ?? sceneStore.selectedNodeId ?? null
  const locked = primaryId ? sceneStore.isNodeSelectionLocked(primaryId) : false
  const target = !locked && primaryId ? (objectMap.get(primaryId) ?? null) : null
  updateOutlineSelectionTargets()

  if (!primaryId || locked || !target) {
    updateGridHighlight(null)
  } else {
    updateGridHighlightFromObject(target)
  }

  if (!transformControls) return

  if (!primaryId || locked) {
    transformControls.detach()
    return
  }

  if (!target) {
    transformControls.detach()
    return
  }
  if (effectiveTool === 'select') {
    transformControls.detach()
    return
  }
  // 根据当前工具选择合适的变换坐标系
  applyTransformSpaceForSelection(effectiveTool, primaryId)
  transformControls.setMode(effectiveTool)

  // Multi-select: attach to centroid pivot so the gizmo axis is centered.
  const centroidWorld = updateSelectionPivotObject(primaryId, effectiveTool)
  if (centroidWorld) {
    // Multi-select always uses world-space axis.
    transformControls.setSpace('world')
    transformControls.attach(selectionPivotObject)
    // Keep grid highlight anchored to the primary object (not the pivot).
    updateGridHighlightFromObject(target)
    return
  }

  // DirectionalLight: edit using an editor-only pivot at the light target so the gizmo stays near the scene.
  const node = sceneStore.getNodeById(primaryId)
  if (node?.light?.type === 'Directional' && (effectiveTool === 'translate' || effectiveTool === 'rotate')) {
    syncDirectionalLightTargetPivotFromNode(primaryId, { orientForRotate: effectiveTool === 'rotate' })
    transformControls.setSpace(effectiveTool === 'rotate' ? 'local' : 'world')
    transformControls.attach(directionalLightTargetPivotObject)
    // Keep highlight anchored to the actual node object.
    updateGridHighlightFromObject(target)
    return
  }

  // Single-select: for instanced tiling nodes, place the gizmo at the PickProxy-derived pivot.
  updateTransformControlsPivotOverride(target)
  transformControls.attach(target)
}


function updateToolMode(tool: EditorTool) {
  if (!transformControls) return

  const effectiveTool = getSafeTransformTool(tool)

  transformControls.enabled = effectiveTool !== 'select'

  if (effectiveTool === 'select') {
    transformControls.detach()
  } else {
    applyTransformSpaceForSelection(effectiveTool, sceneStore.selectedNodeId ?? props.selectedNodeId ?? null)
    transformControls.setMode(effectiveTool)
  }

  if (props.selectedNodeId) {
    attachSelection(props.selectedNodeId, effectiveTool)
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

function isOverlayUiElement(element: Element | null): boolean {
  if (!element) {
    return false
  }
  return Boolean(
    element.closest('.v-overlay') ||
    element.closest('.v-overlay__content') ||
    element.closest('.viewport-toolbar') ||
    element.closest('.popup-menu-card') ||
    element.closest('.ground-tool-menu__card') ||
    element.closest('.floor-shape-menu__card') ||
    element.closest('.wall-shape-menu__card') ||
    element.closest('.scatter-erase-menu__card')
  )
}

function isEventFromViewportOverlayUi(event: Event): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  for (const node of path) {
    if (node instanceof Element && isOverlayUiElement(node)) {
      return true
    }
  }
  const targetElement = event.target instanceof Element ? event.target : null
  return isOverlayUiElement(targetElement)
}

function shouldHandleViewportShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return false
  if (uiStore.isInteractionLocked('asset-import')) return false
  if (isEditableKeyboardTarget(event.target)) return false
  if (isEventFromViewportOverlayUi(event)) return false
  if (props.previewActive) return false
  return true
}

function handleViewportShortcut(event: KeyboardEvent) {
  if (!shouldHandleViewportShortcut(event)) return
  let handled = false

  if (!event.ctrlKey && !event.metaKey && event.altKey && !event.shiftKey) {
    handled = handleDirectionalCameraShortcut(event.code)
  }

  if (!handled && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    switch (event.code) {
      case 'Escape':
        if (wallDoorSelectionPayload.value || wallDoorRectangleSelectionState) {
          clearWallDoorRectangleSelectionState()
          clearWallDoorSelectionPayload()
          handled = true
        }
        if (cancelAssetPlacementInteraction()) {
          handled = true
        }
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
      case 'Delete':
      case 'Backspace': {
        if (wallDoorSelectModeActive.value && activeBuildTool.value === 'wall' && wallDoorSelectionPayload.value?.length) {
          handled = wallDoorSelectionController.applyWallDoorSelectionDelete(wallDoorSelectionPayload.value)
          if (handled) {
            clearWallDoorSelectionPayload()
          }
        }
        break
      }
      case 'KeyF': {
        handled = focusViewportSelection()
        break
      }
      case 'KeyM': {
        toggleViewportCameraControlMode()
        handled = true
        break
      }
      default: {
        const tool = transformToolKeyMap.get(event.code)
        if (tool) {
          if (isTransformToolBlockedByLandform(tool)) {
            handled = true
            break
          }
          emit('changeTool', tool)
          handled = true
        }
        break
      }
    }
  }

  if (!handled && !event.ctrlKey && !event.metaKey && event.shiftKey && !event.altKey) {
    if (event.code === 'KeyG') {
      handled = wallBuildTool.autofillFromLastCommittedSegment()
    } else if (event.code === 'KeyF') {
      handled = focusViewportVisible()
    }
  }

  if (handled) {
    event.preventDefault()
    event.stopPropagation()
  }
}

function handleScatterEraseRestoreKeyDown(event: KeyboardEvent) {
  if (!shouldHandleViewportShortcut(event)) return
  if (!scatterEraseModeActive.value) return
  if (event.key === 'Control' || event.key === 'Meta') {
    scatterEraseRestoreModifierActive.value = true
  }
}

function handleScatterEraseRestoreKeyUp(event: KeyboardEvent) {
  if (!scatterEraseModeActive.value) return
  if (event.key === 'Control' || event.key === 'Meta') {
    scatterEraseRestoreModifierActive.value = false
  }
}

function handleScatterEraseRestoreBlur() {
  scatterEraseRestoreModifierActive.value = false
}

function handleWallDoorDeleteKeyUp(event: KeyboardEvent) {
  if (!wallDoorSelectModeActive.value || activeBuildTool.value !== 'wall') {
    return
  }
  if (!wallDoorSelectionPayload.value?.length) {
    return
  }
  if (event.code !== 'Delete' && event.code !== 'Backspace') {
    return
  }
  if (isEditableKeyboardTarget(event.target)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

function handleVertexSnapShiftKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Shift') {
    return
  }
  if (isEditableKeyboardTarget(event.target)) {
    return
  }
  vertexSnapShiftModifierActive.value = true
  if (!navigationSpeedBoostModifierActive.value) {
    navigationSpeedBoostModifierActive.value = true
    syncControlsConstraintsAndSpeeds()
  }
}

function handleVertexSnapShiftKeyUp(event: KeyboardEvent) {
  if (event.key !== 'Shift') {
    return
  }
  vertexSnapShiftModifierActive.value = false
  clearBuildToolVertexSnap()
  if (navigationSpeedBoostModifierActive.value) {
    navigationSpeedBoostModifierActive.value = false
    syncControlsConstraintsAndSpeeds()
  }
}

function handleVertexSnapShiftBlur() {
  vertexSnapShiftModifierActive.value = false
  clearBuildToolVertexSnap()
  if (navigationSpeedBoostModifierActive.value) {
    navigationSpeedBoostModifierActive.value = false
    syncControlsConstraintsAndSpeeds()
  }
}

function handleRelativeAngleSnapCKeyDown(event: KeyboardEvent) {
  if (!shouldHandleViewportShortcut(event)) {
    return
  }
  if (event.repeat) {
    return
  }
  if (event.code !== 'KeyC') {
    return
  }
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return
  }
  relativeAngleSnapCModifierActive.value = true
}

function handleRelativeAngleSnapCKeyUp(event: KeyboardEvent) {
  if (event.code !== 'KeyC') {
    return
  }
  relativeAngleSnapCModifierActive.value = false
}

function handleRelativeAngleSnapCBlur() {
  relativeAngleSnapCModifierActive.value = false
}

onMounted(() => {
  initScene()
  if (canvasRef.value) {
    canvasRef.value.addEventListener('wheel', handleViewportWheel, { passive: false, capture: true })
  }
  updateToolMode(props.activeTool)
  attachSelection(props.selectedNodeId)
  updateOutlineSelectionTargets()
  updateSelectionHighlights()
    // Viewport shortcuts should trigger on keydown (avoid double-trigger on keyup,
    // and make framing/escape feel immediate).
    window.addEventListener('keydown', handleViewportShortcut, { capture: true })
  window.addEventListener('keydown', handleVertexSnapShiftKeyDown, { capture: true })
  window.addEventListener('keyup', handleVertexSnapShiftKeyUp, { capture: true })
  window.addEventListener('blur', handleVertexSnapShiftBlur, { capture: true })
    window.addEventListener('keydown', handleRelativeAngleSnapCKeyDown, { capture: true })
    window.addEventListener('keyup', handleRelativeAngleSnapCKeyUp, { capture: true })
    window.addEventListener('blur', handleRelativeAngleSnapCBlur, { capture: true })
  window.addEventListener('keydown', handleScatterEraseRestoreKeyDown, { capture: true })
  window.addEventListener('keyup', handleScatterEraseRestoreKeyUp, { capture: true })
  window.addEventListener('blur', handleScatterEraseRestoreBlur, { capture: true })
  window.addEventListener('keyup', handleWallDoorDeleteKeyUp, { capture: true })
  window.addEventListener('keydown', handleAltOverrideKeyDown, { capture: true })
  window.addEventListener('keyup', handleAltOverrideKeyUp, { capture: true })
  window.addEventListener('blur', handleAltOverrideBlur, { capture: true })
  window.addEventListener('keydown', handleSpaceOverrideKeyDown, { capture: true })
  window.addEventListener('keyup', handleSpaceOverrideKeyUp, { capture: true })
  window.addEventListener('blur', handleSpaceOverrideBlur, { capture: true })
  window.addEventListener('keydown', handleVOverrideKeyDown, { capture: true })
  window.addEventListener('keyup', handleVOverrideKeyUp, { capture: true })
  window.addEventListener('blur', handleVOverrideBlur, { capture: true })
  // face/surface snap controller event handlers removed
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', handleViewportOverlayResize, { passive: true })
  }
  scheduleToolbarUpdate()
  scheduleViewportCompositionUpdate(true)
  if (viewportEl.value && typeof ResizeObserver !== 'undefined') {
    viewportResizeObserver = new ResizeObserver(() => {
      scheduleToolbarUpdate()
      scheduleViewportCompositionUpdate(true)
    })
    viewportResizeObserver.observe(viewportEl.value)
  }
  sceneStore.ensureCurrentSceneLoaded();
})

onBeforeUnmount(() => {
  displayBoardBuildTool.dispose()
  billboardBuildTool.dispose()
  clearDisplayBoardSizeHud()
  stopSelectionPreviewVisibilityMonitor()
  if (nodePickerStore.isActive) {
    nodePickerStore.cancelActivePick('user')
  }
  disposeGroundEditor()
  groundTextureInputRef.value = null
  disposeSceneNodes()
  disposeScene()
  disposeWallDoorSelectionController()
  disposeWallEraseHoverPresenter()
  disposeCachedTextures()
  if (canvasRef.value) {
    canvasRef.value.removeEventListener('wheel', handleViewportWheel, { capture: true })
  }
  window.removeEventListener('keydown', handleViewportShortcut, { capture: true })
  window.removeEventListener('keydown', handleVertexSnapShiftKeyDown, { capture: true })
  window.removeEventListener('keyup', handleVertexSnapShiftKeyUp, { capture: true })
  window.removeEventListener('blur', handleVertexSnapShiftBlur, { capture: true })
  window.removeEventListener('keydown', handleRelativeAngleSnapCKeyDown, { capture: true })
  window.removeEventListener('keyup', handleRelativeAngleSnapCKeyUp, { capture: true })
  window.removeEventListener('blur', handleRelativeAngleSnapCBlur, { capture: true })
  window.removeEventListener('keydown', handleScatterEraseRestoreKeyDown, { capture: true })
  window.removeEventListener('keyup', handleScatterEraseRestoreKeyUp, { capture: true })
  window.removeEventListener('blur', handleScatterEraseRestoreBlur, { capture: true })
  window.removeEventListener('keyup', handleWallDoorDeleteKeyUp, { capture: true })
  window.removeEventListener('keydown', handleAltOverrideKeyDown, { capture: true })
  window.removeEventListener('keyup', handleAltOverrideKeyUp, { capture: true })
  window.removeEventListener('blur', handleAltOverrideBlur, { capture: true })
  window.removeEventListener('keydown', handleSpaceOverrideKeyDown, { capture: true })
  window.removeEventListener('keyup', handleSpaceOverrideKeyUp, { capture: true })
  window.removeEventListener('blur', handleSpaceOverrideBlur, { capture: true })
  window.removeEventListener('keydown', handleVOverrideKeyDown, { capture: true })
  window.removeEventListener('keyup', handleVOverrideKeyUp, { capture: true })
  window.removeEventListener('blur', handleVOverrideBlur, { capture: true })
  // face/surface snap controller event handlers removed
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
  if (viewportCompositionUpdateFrame !== null && typeof window !== 'undefined') {
    window.cancelAnimationFrame(viewportCompositionUpdateFrame)
    viewportCompositionUpdateFrame = null
  }
  viewportCompositionUpdateQueued = false
  viewportCompositionUpdateForce = false
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
    scheduleViewportCompositionUpdate(true)
  }
)

watch(
  () => [panelVisibility.value.inspector, panelPlacement.value.inspector],
  () => {
    scheduleToolbarUpdate()
    scheduleViewportCompositionUpdate(true)
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
  () => Boolean(environmentSettings.value.viewportPerformanceMode),
  () => {
    if (!renderer || !viewportEl.value) {
      return
    }
    renderer.setPixelRatio(resolveViewportPixelRatio())
    const w = viewportEl.value.clientWidth
    const h = viewportEl.value.clientHeight
    if (w <= 0 || h <= 0) {
      return
    }
    renderer.setSize(w, h)
    postprocessing.setPerformanceMode(Boolean(environmentSettings.value.viewportPerformanceMode))
    postprocessing.setSize(w, h)
  },
)

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
    if (!transformControls?.dragging) {
      attachSelection(props.selectedNodeId, props.activeTool)
    }
    updateOutlineSelectionTargets()
    updateSelectionHighlights()
    refreshEffectRuntimeTickers()
  }
)

watch(hasGroundNode, (isGroundPresent) => {
  if (!isGroundPresent) {
    exitScatterEraseMode()
  }
})

watch(
  () => groundPanelTab.value,
  (tab) => {
    exitScatterEraseMode()
    cancelGroundEditorScatterPlacement()

    if (!hasGroundNode.value || !isGroundBuildTool(activeBuildTool.value)) {
      return
    }

    const targetTool = resolveGroundToolFromTab(tab)
    if (activeBuildTool.value !== targetTool) {
      handleBuildToolChange(targetTool)
    }
  },
)

watch(
  () => props.activeTool,
  (tool) => {
    updateToolMode(tool)
    if (tool !== 'translate') {
      // disable snap/align hint behavior
    }
  }
)

watch(activeBuildTool, (tool, previous) => {
  handleGroundEditorBuildToolChange(tool)
  clearBuildToolVertexSnap()

  // Keep viewport side effects consistent even when the tool is activated via store (e.g. AssetPanel).
  if (isGroundBuildTool(tool)) {
    exitScatterEraseMode()
    cancelGroundEditorScatterPlacement()
    const targetTab = resolveGroundTabFromTool(tool)
    if (groundPanelTab.value !== targetTab) {
      terrainStore.setGroundPanelTab(targetTab)
    }
  }

  if (tool && isBuildToolBlockedDuringGroundSculptConfig(tool) && tool !== previous) {
    // Preserve the last selected transform tool so we can restore it when exiting build via right double click.
    if (props.activeTool !== 'select') {
      transformToolBeforeBuild = props.activeTool
    }
  }

  if (!isBuildToolBlockedDuringGroundSculptConfig(tool)) {
    pointerInteraction.clearIfKind('buildToolRightClick')
  }
  if (tool !== 'wall') {
    wallBuildTool.cancel()
  }
  if (tool !== 'road') {
    roadBuildTool.cancel()
  }
  if (tool !== 'floor') {
    floorBuildTool.cancel()
  }
  if (tool !== 'landform') {
    landformBuildTool.cancel()
  }
  if (tool !== 'region') {
    regionBuildTool.cancel()
  }
  if (tool !== 'water') {
    waterBuildTool.cancel()
  }
  if (tool !== 'displayBoard') {
    displayBoardBuildTool.cancel()
    billboardBuildTool.cancel()
    clearDisplayBoardSizeHud()
    if (displayBoardCornerDragState) {
      pointerInteraction.releaseIfCaptured(displayBoardCornerDragState.pointerId)
      restoreDisplayBoardPreviewTransform(displayBoardCornerDragState)
      displayBoardCornerDragState = null
      setActiveDisplayBoardCornerHandle(null)
    }
  }
  if (tool !== 'warpGate') {
    warpGatePlacementClickSessionState = null
    hideWarpGatePlacementPreview()
  }

  const desiredContext = resolveSelectionContextForBuildTool(tool)
  if (desiredContext) {
    if (uiStore.activeSelectionContext !== desiredContext) {
      uiStore.setActiveSelectionContext(desiredContext)
    }
  } else if (isManagedBuildToolContext(uiStore.activeSelectionContext)) {
    uiStore.setActiveSelectionContext(null)
  }
})

watch(
  [activeBuildTool, brushOperation],
  ([tool, operation], [previousTool, previousOperation]) => {
    const forceDense = shouldForceDenseGroundMeshForViewport(tool, operation)
    const previousForceDense = shouldForceDenseGroundMeshForViewport(previousTool, previousOperation)

    if (forceDense === previousForceDense) {
      return
    }

    viewportForceDenseGroundMesh.value = forceDense

    if (forceDense) {
      syncViewportGroundRenderMode()
      return
    }

    const shouldRebuildOptimizedMesh = pendingViewportGroundOptimizedRebuild
    syncViewportGroundRenderMode({ rebuildOptimizedMesh: shouldRebuildOptimizedMesh })

    if (shouldRebuildOptimizedMesh) {
      const groundNode = getGroundNodeFromStore()
      if (groundNode?.dynamicMesh?.type === 'Ground') {
        void sceneStore.saveGroundDataImmediately(groundNode.id).catch((error: unknown) => {
          console.warn('[SceneViewport] Failed to save ground data after sculpt commit', error)
        })
      }
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
  captureScreenshot,
  flushTerrainPaintChanges,
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
        :vertex-snap-enabled="isVertexSnapActiveEffective"
        :can-drop-selection="canDropSelection"
        :can-align-selection="canAlignSelection"
        :can-rotate-selection="canRotateSelection"
        :can-mirror-selection="canRotateSelection"
        :can-erase-scatter="canUseScatterEraseTool"
        :canClearAllScatterInstances="hasGroundNode"
        :has-ground-node="hasGroundNode"
        :scatter-erase-mode-active="scatterEraseModeActive"
        :scatter-erase-repair-active="scatterRepairModifierActive"
          :scatter-erase-radius="scatterEraseRadius"
          :scatter-erase-menu-open="scatterEraseMenuOpen"
          :viewport-placement-menu-open="viewportPlacementMenuOpen"
          :viewport-placement-active="viewportPlacementActive"
        :floor-shape-menu-open="floorShapeMenuOpen"
        :landform-shape-menu-open="landformShapeMenuOpen"
        :wall-shape-menu-open="wallShapeMenuOpen"
        :road-shape-menu-open="roadShapeMenuOpen"
        :wall-door-select-mode-active="wallDoorSelectModeActive"
        :water-shape-menu-open="waterShapeMenuOpen"
        :ground-terrain-menu-open="groundTerrainMenuOpen"
        :ground-paint-menu-open="groundPaintMenuOpen"
        :ground-scatter-menu-open="groundScatterMenuOpen"
        :floor-build-shape="floorBuildShape"
        :floor-regular-polygon-sides="floorRegularPolygonSides"
        :landform-build-shape="landformBuildShape"
        :landform-regular-polygon-sides="landformRegularPolygonSides"
        :wall-build-shape="wallBuildShape"
        :wall-regular-polygon-sides="wallRegularPolygonSides"
        :water-build-shape="waterBuildShape"
        :floor-brush-preset-asset-id="floorBrushPresetAssetId ?? ''"
        :landform-brush-preset-asset-id="landformBrushPresetAssetId ?? ''"
        :wall-brush-preset-asset-id="wallBrushPresetAssetId ?? ''"
        :road-brush-preset-asset-id="roadBrushPresetAssetId ?? ''"
        :ground-panel-tab="groundPanelTab"
        :ground-brush-radius="brushRadius"
        :ground-brush-strength="brushStrength"
        :ground-brush-depth="brushDepth"
        :ground-brush-slope="brushSlope"
        :ground-brush-shape="brushShape"
        :ground-brush-operation="brushOperation"
        :ground-noise-strength="groundNoiseStrength"
        :ground-noise-mode="groundNoiseMode"
        :ground-paint-asset="paintSelectedAsset"
        :ground-paint-settings="paintBrushSettings"
        :ground-scatter-category="scatterCategory"
        :ground-scatter-brush-radius="scatterBrushRadius"
        :ground-scatter-brush-shape="scatterBrushShape"
        :ground-scatter-regular-polygon-sides="scatterRegularPolygonSides"
        :ground-scatter-spacing="scatterSpacing"
        :ground-scatter-density-percent="scatterDensityPercent"
        :ground-scatter-provider-asset-id="scatterProviderAssetId ?? null"
        :build-tools-disabled="buildToolsDisabled"
        :active-build-tool="activeBuildTool"
        @drop-to-ground="dropSelectionToGround"
        @align-selection="handleAlignSelection"
        @rotate-selection="handleRotateSelection"
        @mirror-selection="handleMirrorSelection"
        @capture-screenshot="handleCaptureScreenshot"
        @change-build-tool="handleBuildToolChange"
        @select-wall-preset="handleWallPresetDialogUpdate"
        @select-floor-preset="handleFloorPresetDialogUpdate"
        @select-landform-preset="handleLandformPresetDialogUpdate"
        @select-road-preset="handleRoadPresetDialogUpdate"
        @toggle-scatter-erase="toggleScatterEraseMode"
        @toggle-wall-door-select-mode="toggleWallDoorSelectMode"
        @start-viewport-placement="handleStartViewportPlacement"
        @cancel-viewport-placement="handleCancelViewportPlacement"
          @clear-all-scatter-instances="handleClearAllScatterInstances"
          @update-scatter-erase-radius="terrainStore.setScatterEraseRadius"
          @update:viewport-placement-menu-open="handleViewportPlacementMenuOpen"
          @update:scatter-erase-menu-open="handleScatterEraseMenuOpen"
          @update:ground-terrain-menu-open="handleGroundTerrainMenuOpen"
          @update:ground-paint-menu-open="handleGroundPaintMenuOpen"
          @update:ground-scatter-menu-open="handleGroundScatterMenuOpen"
          @update:floor-shape-menu-open="handleFloorShapeMenuOpen"
          @update:landform-shape-menu-open="handleLandformShapeMenuOpen"
          @update:wall-shape-menu-open="handleWallShapeMenuOpen"
          @update:road-shape-menu-open="handleRoadShapeMenuOpen"
          @update:water-shape-menu-open="handleWaterShapeMenuOpen"
          @activate-ground-tab="handleActivateGroundTab"
          @update:ground-brush-radius="handleGroundBrushRadiusUpdate"
          @update:ground-brush-strength="handleGroundBrushStrengthUpdate"
          @update:ground-brush-depth="handleGroundBrushDepthUpdate"
          @update:ground-brush-slope="handleGroundBrushSlopeUpdate"
          @update:ground-brush-shape="handleGroundBrushShapeUpdate"
          @update:ground-brush-operation="handleGroundBrushOperationUpdate"
          @update:ground-noise-strength="handleGroundNoiseStrengthUpdate"
          @update:ground-noise-mode="handleGroundNoiseModeUpdate"
          @update:ground-paint-asset="handleGroundPaintAssetUpdate"
          @update:ground-paint-settings="handleGroundPaintSettingsUpdate"
          @update:ground-scatter-category="handleGroundScatterCategoryUpdate"
          @update:ground-scatter-brush-radius="handleGroundScatterBrushRadiusUpdate"
          @update:ground-scatter-brush-shape="handleGroundScatterBrushShapeUpdate"
          @update:ground-scatter-regular-polygon-sides="handleGroundScatterRegularPolygonSidesUpdate"
          @update:ground-scatter-spacing="handleGroundScatterSpacingUpdate"
          @update:ground-scatter-density-percent="handleGroundScatterDensityPercentUpdate"
          @ground-scatter-asset-select="handleGroundScatterAssetSelect"
          @select-floor-build-shape="handleSelectFloorBuildShape"
          @update:floor-regular-polygon-sides="handleFloorRegularPolygonSidesUpdate"
          @select-landform-build-shape="handleSelectLandformBuildShape"
          @update:landform-regular-polygon-sides="handleLandformRegularPolygonSidesUpdate"
          @select-wall-build-shape="handleSelectWallBuildShape"
            @update:wall-regular-polygon-sides="handleWallRegularPolygonSidesUpdate"
          @select-water-build-shape="handleSelectWaterBuildShape"
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

        <div v-if="wallLengthHud.visible" class="wall-length-hud">
          <div
            v-if="wallLengthHud.left.visible"
            class="wall-length-hud__label"
            :style="{ left: wallLengthHud.left.x + 'px', top: wallLengthHud.left.y + 'px' }"
          >
            {{ wallLengthHud.left.text }}
          </div>
          <div
            v-if="wallLengthHud.right.visible"
            class="wall-length-hud__label"
            :style="{ left: wallLengthHud.right.x + 'px', top: wallLengthHud.right.y + 'px' }"
          >
            {{ wallLengthHud.right.text }}
          </div>
        </div>

        <div v-if="floorSizeHud.visible" class="floor-size-hud">
          <div
            v-if="floorSizeHud.left.visible"
            class="floor-size-hud__label"
            :style="{ left: floorSizeHud.left.x + 'px', top: floorSizeHud.left.y + 'px' }"
          >
            {{ floorSizeHud.left.text }}
          </div>
          <div
            v-if="floorSizeHud.right.visible"
            class="floor-size-hud__label"
            :style="{ left: floorSizeHud.right.x + 'px', top: floorSizeHud.right.y + 'px' }"
          >
            {{ floorSizeHud.right.text }}
          </div>
        </div>

        <div v-if="displayBoardSizeHud.visible" class="floor-size-hud">
          <div
            v-if="displayBoardSizeHud.label.visible"
            class="floor-size-hud__label"
            :style="{ left: displayBoardSizeHud.label.x + 'px', top: displayBoardSizeHud.label.y + 'px' }"
          >
            {{ displayBoardSizeHud.label.text }}
          </div>
        </div>

        <div
          v-if="wallDoorSelectionOverlayBox"
          class="wall-door-selection-overlay"
          :style="{
            left: wallDoorSelectionOverlayBox.left + 'px',
            top: wallDoorSelectionOverlayBox.top + 'px',
            width: wallDoorSelectionOverlayBox.width + 'px',
            height: wallDoorSelectionOverlayBox.height + 'px',
          }"
        />
      </div>
      <div class="camera-status-hud">
        <div class="camera-status-hud__toolbar">
          <div class="camera-status-hud__controls">
          <v-btn
            :icon="cameraControlMode === 'map' ? 'mdi-map' : 'mdi-rotate-3d-variant'"
            density="compact"
            size="x-small"
            variant="text"
            class="camera-status-hud__icon-btn"
            :title="cameraControlMode === 'map' ? '地图/布局模式（点击或按 M 切换到轨道模式）' : '轨道/装配模式（点击或按 M 切换到地图模式）'"
            @click="toggleViewportCameraControlMode"
          />
          <v-btn
            icon="mdi-view-grid-outline"
            density="compact"
            size="x-small"
            variant="text"
            class="camera-status-hud__icon-btn"
            title="顶视布局（Alt+3）"
            @click="enterMapTopView"
          />
          <v-btn
            icon="mdi-crosshairs-gps"
            density="compact"
            size="x-small"
            variant="text"
            class="camera-status-hud__icon-btn"
            :title="viewportSelectionCount > 0 ? '聚焦选中（F）' : '聚焦选中（F）- 当前没有选中对象'"
            :disabled="viewportSelectionCount < 1"
            @click="focusViewportSelection"
          />
          <v-btn
            icon="mdi-fit-to-screen-outline"
            density="compact"
            size="x-small"
            variant="text"
            class="camera-status-hud__icon-btn"
            title="聚焦可见内容（Shift+F）"
            @click="focusViewportVisible"
          />
          <v-menu
            :model-value="cameraResetMenuOpen"
            location="top start"
            :offset="8"
            :open-on-click="false"
            :close-on-content-click="true"
            @update:modelValue="handleCameraResetMenuOpen"
          >
            <template #activator="{ props: menuProps }">
              <v-btn
                v-bind="menuProps"
                icon="mdi-camera"
                density="compact"
                size="x-small"
                variant="text"
                class="camera-status-hud__icon-btn"
                title="默认视角（Shift+F 聚焦可见；Alt+1..6 方向视角）"
                @click="resetCameraView"
                @contextmenu.prevent.stop="handleCameraResetMenuOpen(true)"
              />
            </template>
            <v-list density="compact" class="camera-reset-menu">
              <div
                class="popup-menu-card"
                @pointerdown.stop
                @pointerup.stop
                @mousedown.stop
                @mouseup.stop
              >
                <v-toolbar density="compact" class="menu-toolbar" height="36px">
                  <div class="toolbar-text">
                    <div class="menu-title">Camera View</div>
                  </div>
                  <v-spacer />
                  <v-btn class="menu-close-btn" icon="mdi-close" size="small" variant="text" @click="handleCameraResetMenuOpen(false)" />
                </v-toolbar>
                <div class="popup-menu-card__content">
                  <v-list-item title="正面 (+X) - Alt+1" @click="handleResetCameraDirection('pos-x')" />
                  <v-list-item title="背面 (-X) - Alt+2" @click="handleResetCameraDirection('neg-x')" />
                  <v-list-item title="顶视布局 (+Y) - Alt+3" @click="enterMapTopView" />
                  <v-list-item title="下面 (-Y) - Alt+4" @click="handleResetCameraDirection('neg-y')" />
                  <v-list-item title="左面 (+Z) - Alt+5" @click="handleResetCameraDirection('pos-z')" />
                  <v-list-item title="右面 (-Z) - Alt+6" @click="handleResetCameraDirection('neg-z')" />
                </div>
              </div>
            </v-list>
          </v-menu>
          </div>
          <span class="camera-status-hud__sep" aria-hidden="true" />
          <span class="camera-status-hud__meta-label">缩放</span>
          <button
            type="button"
            class="camera-status-hud__ratio"
            title="点击重置缩放"
            @click="handleResetCameraStatusZoomClick"
          >
            {{ cameraStatusZoomRatioText }}
          </button>
          <span class="camera-status-hud__sep" aria-hidden="true" />
          <button
            type="button"
            class="camera-status-hud__help-btn"
            :class="{ 'camera-status-hud__help-btn--active': showCameraHintsOpen }"
            title="镜头控制与导航快捷键"
            @click="toggleCameraHints"
          >?</button>
        </div>
        <Transition name="camera-hints-slide">
          <div v-if="showCameraHintsOpen" class="camera-status-hud__hints">
            <div class="camera-status-hud__hint-row">
              <span class="camera-status-hud__hint-label">鼠标</span>
              <span class="camera-status-hud__hint-text">{{ cameraPointerHintText }}</span>
            </div>
            <div class="camera-status-hud__hint-row">
              <span class="camera-status-hud__hint-label">工具</span>
              <span class="camera-status-hud__hint-text">Q 选择 · W 移动 · E 旋转 · R 缩放</span>
            </div>
            <div class="camera-status-hud__hint-row">
              <span class="camera-status-hud__hint-label">视角</span>
              <span class="camera-status-hud__hint-text">方向键 平移 · F 聚焦选中 · Shift+F 聚焦可见 · Alt+3 顶视图 · Alt+1/2/4/5/6 方向视角</span>
            </div>
            <div class="camera-status-hud__hint-row">
              <span class="camera-status-hud__hint-label">导航</span>
              <span class="camera-status-hud__hint-text">按住 Alt / Space 临时导航模式 · 按住 Shift 顶点吸附并加速</span>
            </div>
            <div class="camera-status-hud__hint-row">
              <span class="camera-status-hud__hint-label">操作</span>
              <span class="camera-status-hud__hint-text">Escape 取消选择/操作 · Delete 删除选中 · M 切换相机模式</span>
            </div>
          </div>
        </Transition>
      </div>
      <div class="csm-hud">
        <v-menu
          v-model="csmMenuOpen"
          location="top end"
          :offset="6"
          :close-on-content-click="false"
        >
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              density="compact"
              size="large"
              class="csm-hud__btn"
              :color="csmMenuOpen ? 'primary' : 'white'"
              variant="text"
              title="CSM Sun & Shadow"
            >
              <v-icon icon="mdi-white-balance-sunny" size="28" />
            </v-btn>
          </template>
          <v-list density="compact" class="csm-sun-menu">
            <div
              class="popup-menu-card csm-sun-menu__card"
              @pointerdown.stop
              @pointerup.stop
              @mousedown.stop
              @mouseup.stop
            >
         
              <CsmSunMenuContent
                :csm-enabled="resolveEnvironmentCsmSettings(environmentSettings).enabled"
                :csm-shadow-enabled="resolveEnvironmentCsmSettings(environmentSettings).shadowEnabled"
                :csm-light-color="resolveEnvironmentCsmSettings(environmentSettings).lightColor"
                :csm-light-intensity="resolveEnvironmentCsmSettings(environmentSettings).lightIntensity"
                :csm-sun-azimuth-deg="resolveEnvironmentCsmSettings(environmentSettings).sunAzimuthDeg"
                :csm-sun-elevation-deg="resolveEnvironmentCsmSettings(environmentSettings).sunElevationDeg"
                :csm-cascades="resolveEnvironmentCsmSettings(environmentSettings).cascades"
                :csm-max-far="resolveEnvironmentCsmSettings(environmentSettings).maxFar"
                :csm-shadow-map-size="resolveEnvironmentCsmSettings(environmentSettings).shadowMapSize"
                :csm-shadow-bias="resolveEnvironmentCsmSettings(environmentSettings).shadowBias"
                @update:csm-enabled="handleCsmEnabledUpdate"
                @update:csm-shadow-enabled="handleCsmShadowEnabledUpdate"
                @update:csm-light-color="handleCsmLightColorUpdate"
                @update:csm-light-intensity="handleCsmLightIntensityUpdate"
                @update:csm-sun-azimuth-deg="handleCsmSunAzimuthDegUpdate"
                @update:csm-sun-elevation-deg="handleCsmSunElevationDegUpdate"
                @update:csm-cascades="handleCsmCascadesUpdate"
                @update:csm-max-far="handleCsmMaxFarUpdate"
                @update:csm-shadow-map-size="handleCsmShadowMapSizeUpdate"
                @update:csm-shadow-bias="handleCsmShadowBiasUpdate"
              />
            </div>
          </v-list>
        </v-menu>
      </div>
        <div v-show="showProtagonistPreview" class="protagonist-preview">
          <span class="protagonist-preview__label">主角视野</span>
        </div>
        <div
          v-if="autoOverlayHoverIndicator.visible"
          class="auto-overlay-hover-badge"
          :style="{ left: autoOverlayHoverIndicator.x + 'px', top: autoOverlayHoverIndicator.y + 'px' }"
        >
          {{ autoOverlayHoverIndicator.label }}
        </div>
      <canvas
        ref="canvasRef"
        :class="[
          'viewport-canvas',
          buildToolCursorClass,
          {
              'cursor-auto-overlay': autoOverlayHoverIndicator.visible,
            'cursor-scatter-hammer': scatterRepairModifierActive,
            'cursor-scatter-erase': scatterEraseModeActive && !scatterRepairModifierActive,
          },
        ]"
      />
    </div>
    <input
      ref="groundTextureInputRef"
      class="ground-texture-input"
      type="file"
      accept="image/*"
      @change="handleGroundTextureFileChange"
    >

    <AssetPickerDialog
      v-model="wallPresetDialogOpen"
      :asset-id="wallBrushPresetAssetId ?? ''"
      assetType="prefab"
      :extensions="['wall']"
      title="Select Wall Preset"
      :anchor="wallPresetDialogAnchor"
      @update:asset="handleWallPresetDialogUpdate"
      @cancel="handleWallPresetDialogCancel"
    />

    <v-dialog v-model="autoOverlayDialogOpen" max-width="460">
      <v-card>
        <v-card-title>{{ autoOverlayDialogTitle }}</v-card-title>
        <v-card-text>
          <div v-if="autoOverlayPlan">
            <div v-if="autoOverlayPlan.supported">
              沿“{{ autoOverlayPlan.referenceNodeName || autoOverlayPlan.referenceNodeId }}”轮廓创建新的 {{ autoOverlayPlan.targetTool }}。
            </div>
            <div v-if="autoOverlayPlan.supported" class="auto-overlay-inputs" style="margin-top:12px;">
              <v-row>
                <v-col cols="6">
                  <v-text-field
                    label="水平 margin (m)"
                    type="number"
                    v-model.number="autoOverlayHorizMargin"
                    :step="0.01"
                  />
                </v-col>
                <v-col cols="6">
                  <v-text-field
                    label="垂直 margin (m)"
                    type="number"
                    v-model.number="autoOverlayVertMargin"
                    :step="0.01"
                  />
                </v-col>
              </v-row>
              <div class="text-caption text-medium-emphasis" style="margin-top:4px;">
                水平 margin 正数外扩、负数缩进；垂直 margin 正数沿轮廓方向前移、负数后移。可用于同一参考轮廓重复自动铺设时错开位置，避免覆盖。
              </div>
            </div>
            <div v-else class="text-error">{{ autoOverlayPlan.reason }}</div>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="clearAutoOverlayDialog">取消</v-btn>
          <v-btn
            color="primary"
            :disabled="autoOverlayConfirmDisabled"
            :loading="autoOverlaySubmitting"
            @click="handleConfirmAutoOverlay"
          >
            自动铺设
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
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

.wall-length-hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.wall-length-hud__label {
  position: absolute;
  transform: translate(-50%, -115%);
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(12, 15, 21, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(236, 241, 248, 0.95);
  font-size: 12px;
  line-height: 1.2;
  white-space: nowrap;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
  user-select: none;
}

.floor-size-hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.floor-size-hud__label {
  position: absolute;
  transform: translate(-50%, -135%);
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(12, 15, 21, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(236, 241, 248, 0.95);
  font-size: 12px;
  line-height: 1.2;
  white-space: nowrap;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
  user-select: none;
}

.auto-overlay-hover-badge {
  position: absolute;
  transform: translate(10px, 10px);
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.88);
  border: 1px solid rgba(94, 234, 212, 0.5);
  color: rgba(204, 251, 241, 0.98);
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  box-shadow: 0 8px 24px rgba(8, 15, 29, 0.35);
  pointer-events: none;
  user-select: none;
}

.wall-door-selection-overlay {
  position: absolute;
  border: 1px solid rgba(187, 222, 251, 0.95);
  background: rgba(130, 177, 255, 0.2);
  box-shadow: inset 0 0 0 1px rgba(187, 222, 251, 0.45);
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
  cursor: crosshair !important;
}

.viewport-canvas.cursor-road,
.viewport-canvas.cursor-road:active {
  cursor: cell !important;
}

.viewport-canvas.cursor-floor,
.viewport-canvas.cursor-floor:active {
  cursor: copy !important;
}

.viewport-canvas.cursor-water,
.viewport-canvas.cursor-water:active {
  cursor: alias !important;
}

.viewport-canvas.cursor-auto-overlay,
.viewport-canvas.cursor-auto-overlay:active {
  cursor: copy !important;
}

.viewport-canvas.cursor-display-board,
.viewport-canvas.cursor-display-board:active {
  cursor: crosshair !important;
}

.viewport-canvas.cursor-warp-gate,
.viewport-canvas.cursor-warp-gate:active {
  cursor: copy !important;
}

.viewport-canvas.cursor-scatter-erase,
.viewport-canvas.cursor-scatter-erase:active {
  cursor: url('/cursors/scatter-erase.svg') 4 20, crosshair !important;
}

.viewport-canvas.cursor-scatter-restore,
.viewport-canvas.cursor-scatter-restore:active {
  cursor: url('/cursors/scatter-restore.svg') 4 20, crosshair !important;
}

.viewport-canvas.cursor-scatter-hammer,
.viewport-canvas.cursor-scatter-hammer:active {
  cursor: url('/cursors/scatter-hammer.svg') 4 20, crosshair !important;
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

.csm-hud {
  position: absolute;
  bottom: 16px;
  right: 16px;
  z-index: 10;
  pointer-events: auto;
}

:global(.csm-sun-menu) {
  width: 260px !important;
  max-width: min(260px, 92vw) !important;
}

.csm-hud__btn {
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.6));
  background: transparent !important;
}

.csm-hud__btn :deep(.v-btn__overlay),
.csm-hud__btn :deep(.v-btn__underlay) {
  display: none !important;
}

.camera-status-hud {
  position: absolute;
  left: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0;
  min-width: 0;
  max-width: min(420px, calc(100vw - 32px));
  z-index: 9;
  pointer-events: none;
}

.camera-status-hud__hints {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  min-width: 320px;
  max-width: min(480px, calc(100vw - 32px));
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(12, 15, 21, 0.85);
  color: rgba(236, 241, 248, 0.95);
  font-size: 11px;
  line-height: 1.4;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(12px) saturate(140%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
}

.camera-hints-slide-enter-active,
.camera-hints-slide-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.camera-hints-slide-enter-from,
.camera-hints-slide-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

.camera-status-hud__toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(12, 15, 21, 0.72);
  color: rgba(236, 241, 248, 0.95);
  font-size: 11px;
  line-height: 1.25;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(10px) saturate(140%);
  pointer-events: auto;
}

.camera-status-hud__controls {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}

.camera-status-hud__sep {
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.14);
  flex: 0 0 auto;
}

.camera-status-hud__icon-btn {
  color: rgba(236, 241, 248, 0.95);
  --v-btn-height: 24px;
  min-width: 24px !important;
  width: 24px !important;
  padding: 0 !important;
}

.camera-status-hud__meta-label {
  color: rgba(160, 171, 189, 0.92);
  letter-spacing: 0.04em;
  flex: 0 0 auto;
}

.camera-status-hud__help-btn {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.18);
  margin: 0;
  padding: 0;
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(200, 210, 224, 0.9);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, border-color 0.12s;
}

.camera-status-hud__help-btn:hover {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.3);
  color: #fff;
}

.camera-status-hud__help-btn--active {
  background: rgba(134, 218, 255, 0.18);
  border-color: rgba(134, 218, 255, 0.55);
  color: rgba(174, 232, 255, 1);
}

.camera-status-hud__help-btn--active:hover {
  background: rgba(134, 218, 255, 0.28);
}

.camera-status-hud__hint-row {
  display: grid;
  grid-template-columns: 36px 1fr;
  gap: 8px;
  align-items: start;
}

.camera-status-hud__hint-label {
  color: rgba(160, 171, 189, 0.92);
  white-space: nowrap;
  letter-spacing: 0.04em;
}

.camera-status-hud__hint-text {
  color: rgba(236, 241, 248, 0.95);
  opacity: 0.92;
}

.camera-status-hud__ratio {
  appearance: none;
  border: 1px solid rgba(134, 218, 255, 0.24);
  margin: 0;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(21, 41, 52, 0.72);
  color: rgba(134, 218, 255, 0.96);
  font: inherit;
  line-height: inherit;
  cursor: pointer;
}

.camera-status-hud__ratio:hover {
  background: rgba(28, 53, 66, 0.8);
  color: rgba(174, 232, 255, 1);
}

.camera-status-hud__ratio:active {
  background: rgba(20, 44, 57, 0.88);
  color: rgba(113, 202, 246, 1);
}

.camera-status-hud__ratio:focus-visible {
  outline: 2px solid rgba(134, 218, 255, 0.72);
  outline-offset: 2px;
  border-radius: 999px;
}

@media (max-width: 720px) {
  .camera-status-hud {
    left: 12px;
    bottom: 12px;
  }

  .camera-status-hud__hints {
    min-width: 240px;
    max-width: min(320px, calc(100vw - 24px));
  }

  .camera-status-hud__hint-row {
    grid-template-columns: 1fr;
    gap: 2px;
  }
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
