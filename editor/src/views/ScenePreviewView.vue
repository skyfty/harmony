<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type ComponentPublicInstance } from 'vue'
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { FirstPersonControls } from 'three/examples/jsm/controls/FirstPersonControls.js'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { Sky } from 'three/addons/objects/Sky.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'
import Stats from 'three/examples/jsm/libs/stats.module.js'
import { SceneCloudRenderer, sanitizeCloudSettings } from '@schema/cloudRenderer'
import {
	ENVIRONMENT_NODE_ID,
	createAutoTourRuntime,
	rebuildSceneNodeIndex,
	resolveSceneNodeById,
	resolveSceneParentNodeId,
	resolveEnabledComponentState,
	type EnvironmentSettings,
	type GroundDynamicMesh,
	type LanternSlideDefinition,
	type SceneJsonExportDocument,
	PROJECT_EXPORT_BUNDLE_FORMAT,
	PROJECT_EXPORT_BUNDLE_FORMAT_VERSION,
	type ProjectExportBundle,
	type ProjectExportSceneEntry,
	unzipScenePackage,
	buildAssetOverridesFromScenePackage,
	readTextFileFromScenePackage,
	type SceneNode,
	type SceneNodeComponentState,
	type SceneMaterialTextureRef,
	type SceneSkyboxSettings,
	type Vector3Like,
} from '@harmony/schema'
 
import {
	applyMaterialOverrides,
	disposeMaterialTextures,
	type MaterialTextureAssignmentOptions,
} from '@schema/material'
import type { EnvironmentBackgroundMode } from '@/types/environment'
import type { ScenePreviewSnapshot } from '@/utils/previewChannel'
import { subscribeToScenePreview } from '@/utils/previewChannel'
import type { SceneExportOptions } from '@/types/scene-export'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import { prepareJsonSceneExport } from '@/utils/sceneExport'
import { useScenesStore } from '@/stores/scenesStore'
import { buildPackageAssetMapForExport, calculateSceneResourceSummary } from '@/stores/sceneStore'
import { buildSceneGraph, createTerrainScatterLodRuntime, type SceneGraphBuildOptions } from '@schema/sceneGraph'
import { createInstancedBvhFrustumCuller } from '@schema/instancedBvhFrustumCuller'

import ResourceCache from '@schema/ResourceCache'
import { AssetLoader } from '@schema/assetCache'
import { inferMimeTypeFromAssetId } from '@schema/assetTypeConversion'
import type { AssetCacheEntry } from '@schema/assetCache'
import { StoreBackedAssetCache } from '@/utils/storeBackedAssetCache'
import {
	buildHeightfieldShapeFromGroundNode,
	isGroundDynamicMesh,
} from '@schema/groundHeightfield'
import { updateGroundChunks } from '@schema/groundMesh'
import { buildGroundAirWallDefinitions } from '@schema/airWall'
import {
	syncTerrainPaintPreviewForGround as syncTerrainPaintPreviewForGroundShared,
	createDefaultTerrainPaintLoaders,
} from '@schema/terrainPaintPreview'
import {
	ensurePhysicsWorld as ensureSharedPhysicsWorld,
	createRigidbodyBody as createSharedRigidbodyBody,
	syncBodyFromObject as syncSharedBodyFromObject,
	syncObjectFromBody as syncSharedObjectFromBody,
	removeRigidbodyInstanceBodies,
	ensureRoadHeightfieldRigidbodyInstance,
	resolveRoadHeightfieldDebugSegments,
	isRoadDynamicMesh,
	type GroundHeightfieldCacheEntry,
	type WallTrimeshCacheEntry,
	type PhysicsContactSettings,
	type RigidbodyInstance,
	type RigidbodyMaterialEntry,
	type RigidbodyOrientationAdjustment,
	type RoadHeightfieldDebugCache,
} from '@schema/physicsEngine'
import { loadNodeObject } from '@schema/modelAssetLoader'
import {
	getCachedModelObject,
	getOrLoadModelObject,
	subscribeInstancedMeshes,
	ensureInstancedMeshesRegistered,
	allocateModelInstance,
	getModelInstanceBinding,
	releaseModelInstance,
	updateModelInstanceMatrix,
	findNodeIdForInstance,
	type ModelInstanceGroup,
	type ModelInstanceBinding,
} from '@schema/modelObjectCache'
import { addMesh as addInstancedBoundsMesh, flush as flushInstancedBounds, tick as tickInstancedBounds, clear as clearInstancedBounds, hasPending as instancedBoundsHasPending } from '@schema/instancedBoundsTracker'
import { syncContinuousInstancedModelCommitted } from '@schema/continuousInstancedModel'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { ComponentManager } from '@schema/components/componentManager'
import {
	behaviorComponentDefinition,
	guideboardComponentDefinition,
	displayBoardComponentDefinition,
	floorComponentDefinition,
	wallComponentDefinition,
	roadComponentDefinition,
	viewPointComponentDefinition,
	warpGateComponentDefinition,
	effectComponentDefinition,
	rigidbodyComponentDefinition,
	vehicleComponentDefinition,
	waterComponentDefinition,
	protagonistComponentDefinition,
	lodComponentDefinition,
	guideRouteComponentDefinition,
	autoTourComponentDefinition,
	purePursuitComponentDefinition,
	sceneStateAnchorComponentDefinition,
	GUIDEBOARD_COMPONENT_TYPE,
	GUIDEBOARD_RUNTIME_REGISTRY_KEY,
	GUIDEBOARD_EFFECT_ACTIVE_FLAG,
	WARP_GATE_RUNTIME_REGISTRY_KEY,
	WARP_GATE_EFFECT_ACTIVE_FLAG,
	RIGIDBODY_COMPONENT_TYPE,
	RIGIDBODY_METADATA_KEY,
	VEHICLE_COMPONENT_TYPE,
	AUTO_TOUR_COMPONENT_TYPE,
	WALL_COMPONENT_TYPE,
	LOD_COMPONENT_TYPE,
	clampGuideboardComponentProps,
	computeGuideboardEffectActive,
	clampVehicleComponentProps,
	clampLodComponentProps,
	DEFAULT_DIRECTION,
	DEFAULT_AXLE,
	SCENE_STATE_ANCHOR_COMPONENT_TYPE,
} from '@schema/components'
import { VehicleDriveController } from '@schema/VehicleDriveController'
import {
	FollowCameraController,
	computeFollowLerpAlpha,
	computeFollowPlacement,
	createCameraFollowState,
	getApproxDimensions,
	resetCameraFollowState,
} from '@schema/followCameraController'
import { startTourAndFollow, stopTourAndUnfollow } from '@schema/autoTourHelpers'
import { syncAutoTourActiveNodesFromRuntime, resolveAutoTourFollowNodeId } from '@schema/autoTourSync'
import { holdVehicleBrakeSafe } from '@schema/purePursuitRuntime'
import type {
	GuideboardComponentProps,
	LodComponentProps,
	RigidbodyComponentMetadata,
	RigidbodyComponentProps,
	RigidbodyPhysicsShape,
	AutoTourComponentProps,
    
	VehicleComponentProps,
	VehicleWheelProps,
	WarpGateComponentProps,
} from '@schema/components'
import { setBoundingBoxFromObject } from '@/components/editor/sceneUtils'
import {
	addBehaviorRuntimeListener,
	hasRegisteredBehaviors,
	listRegisteredBehaviorActions,
	updateBehaviorVisibility,
	resetBehaviorRuntime,
	removeBehaviorRuntimeListener,
	triggerBehaviorAction,
	resolveBehaviorEvent,
	type BehaviorRuntimeEvent,
	type BehaviorEventResolution,
	type BehaviorRuntimeListener,
} from '@schema/behaviors/runtime'
import {
	PROXIMITY_EXIT_PADDING,
	DEFAULT_OBJECT_RADIUS,
	PROXIMITY_MIN_DISTANCE,
	PROXIMITY_RADIUS_SCALE,
} from '@schema/behaviors/runtime'
import type Viewer from 'viewerjs'
import type { ViewerOptions } from 'viewerjs'


const SCENE_PREVIEW_EXPORT_OPTIONS: SceneExportOptions = {
	format: 'json',
	fileName: 'preview',
	includeLights: true,
	includeHiddenNodes: true,
	includeSkeletons: true,
	includeExtras: true,
	rotateCoordinateSystem: false,
	lazyLoadMeshes: true,
}


const terrainScatterRuntime = createTerrainScatterLodRuntime({
	lodUpdateIntervalMs: 200,
	visibilityUpdateIntervalMs: 33,
	cullGraceMs: 300,
	cullRadiusMultiplier: 1.2,
	maxBindingChangesPerUpdate: 200,
	
});

type ControlMode = 'first-person' | 'third-person'
type VehicleDriveCameraMode = 'first-person' | 'follow' | 'free'
type VehicleDriveOrbitMode = 'follow' | 'free'
const containerRef = ref<HTMLDivElement | null>(null)
const statsContainerRef = ref<HTMLDivElement | null>(null)
const statusMessage = ref('Waiting for scene data...')

const liveUpdatesDisabledSourceUrl = ref<string | null>(null)
const isLiveUpdatesDisabled = computed(() => Boolean(liveUpdatesDisabledSourceUrl.value))

function switchToLivePreviewMode(): void {
	if (typeof window === 'undefined') {
		return
	}
	try {
		const url = new URL(window.location.href)
		url.searchParams.delete('projectUrl')
		url.searchParams.delete('bundleUrl')
		url.hash = '#/preview'
		window.location.href = url.toString()
	} catch {
		// ignore
	}
}

const projectBundle = ref<ProjectExportBundle | null>(null)
const projectSceneIndex = new Map<string, ProjectExportSceneEntry>()
const liveUpdatesDisabledLabel = computed(() => {
	if (projectBundle.value) {
		return 'Live updates disabled (bundle mode).'
	}
	if (liveUpdatesDisabledSourceUrl.value === 'manual-scene-navigation') {
		return 'Live updates disabled (manual navigation).'
	}
	return 'Live updates disabled.'
})
const isPlaying = ref(true)
const controlMode = ref<ControlMode>('third-person')
const vehicleDriveCameraMode = ref<VehicleDriveCameraMode>('first-person')
const vehicleDriveOrbitMode = ref<VehicleDriveOrbitMode>('follow')
const volumePercent = ref(100)
const isFullscreen = ref(false)
const lastUpdateTime = ref<string | null>(null)
const warningMessages = ref<string[]>([])

type Vec3Tuple = [number, number, number]
type QuatTuple = [number, number, number, number]

type SceneNodeTransformSnapshot = {
	position: Vec3Tuple
	quaternion: QuatTuple
	scale: Vec3Tuple
}

type SceneViewControlSnapshot = {
	controlMode: ControlMode
	cameraViewState: { mode: CameraViewMode; watchTargetId: string | null }
	isCameraCaged: boolean
	camera: { position: Vec3Tuple; quaternion: QuatTuple; up: Vec3Tuple }
	mapTarget: Vec3Tuple | null
	lastOrbit: { position: Vec3Tuple; target: Vec3Tuple }
	lastFirstPerson: { position: Vec3Tuple; direction: Vec3Tuple }
	nodeTransforms: Record<string, SceneNodeTransformSnapshot>
}

const sceneStateById = new Map<string, SceneViewControlSnapshot>()
const previousSceneById = new Map<string, string>()

const isGroundWireframeVisible = ref(false)
const isOtherRigidbodyWireframeVisible = ref(false)
const isGroundChunkStreamingDebugVisible = ref(false)
const isInstancedCullingVisualizationVisible = ref(false)
const instancedLodFrustumCuller = createInstancedBvhFrustumCuller()
const isRendererDebugVisible = ref(false)
const isInstancingDebugVisible = ref(false)
const isGroundChunkStatsVisible = ref(false)
const isDebugOverlayVisible = computed(
	() => isRendererDebugVisible.value || isInstancingDebugVisible.value || isGroundChunkStatsVisible.value,
)

const instancedLodVisibleCount = ref(0)
const instancedLodTotalCount = ref(0)
const terrainScatterVisibleCount = ref(0)
const terrainScatterTotalCount = ref(0)
const isDebugMenuOpen = ref(false)

const rendererDebug = reactive({
	width: 0,
	height: 0,
	pixelRatio: 1,
	calls: 0,
	triangles: 0,
	geometries: 0,
	textures: 0,
	})

	const instancingDebug = reactive({
		instancedMesh: 0,
		instancedActive: 0,
		instancedInstanceCount: 0,
		instanceMatrixUploadKb: 0,
		lodVisible: 0,
	lodTotal: 0,
	scatterVisible: 0,
	scatterTotal: 0,
})

const groundChunkDebug = reactive({
	loaded: 0,
	target: 0,
	total: 0,
	pending: 0,
	unloaded: 0,
})

const rendererSizeHelper = new THREE.Vector2()
const instancedMatrixUploadMeshes = new Set<THREE.InstancedMesh>()
const isRigidbodyDebugVisible = computed(
	() => isGroundWireframeVisible.value || isOtherRigidbodyWireframeVisible.value,
)

function appendWarningMessage(message: string): void {
	const trimmed = typeof message === 'string' ? message.trim() : ''
	if (!trimmed) {
		return
	}
	const existing = warningMessages.value
	if (existing.includes(trimmed)) {
		return
	}
	warningMessages.value = [...existing, trimmed]
}


const isVolumeMenuOpen = ref(false)
const isCameraCaged = ref(false)
const memoryFallbackLabel = ref<string | null>(null)

type CameraViewMode = 'level' | 'watching'
const cameraViewState = reactive<{ mode: CameraViewMode; watchTargetId: string | null }>(
	{
		mode: 'level',
		watchTargetId: null,
	},
)

const resourceProgress = reactive({
	active: false,
	loaded: 0,
	total: 0,
	loadedBytes: 0,
	totalBytes: 0,
	label: '',
})

const sceneSwitching = ref(false)
const sceneSwitchOverlayVisible = ref(false)
const sceneSwitchFlashActive = ref(false)

const SCENE_SWITCH_OVERLAY_DELAY_MS = 110
const SCENE_SWITCH_OVERLAY_MIN_VISIBLE_MS = 160
const SCENE_SWITCH_FLASH_FADE_OUT_MS = 180

let sceneSwitchToken = 0
let sceneSwitchShowHandle = 0
let sceneSwitchHideHandle = 0
let sceneSwitchShownAt = 0

const isPreloadOverlayVisible = computed(() => resourceProgress.active || sceneSwitchOverlayVisible.value)
const isPreloadFlashVisible = computed(() => sceneSwitchOverlayVisible.value)

let forceInitialDocumentGraphOnNextSnapshot = false

function clearSceneSwitchTimers(): void {
	if (sceneSwitchShowHandle) {
		window.clearTimeout(sceneSwitchShowHandle)
		sceneSwitchShowHandle = 0
	}
	if (sceneSwitchHideHandle) {
		window.clearTimeout(sceneSwitchHideHandle)
		sceneSwitchHideHandle = 0
	}
}

function beginSceneSwitch(): number {
	const token = (sceneSwitchToken += 1)
	clearSceneSwitchTimers()
	sceneSwitching.value = true
	updateCameraControlActivation()
	updateCanvasCursor()

	sceneSwitchOverlayVisible.value = false
	sceneSwitchFlashActive.value = false
	sceneSwitchShownAt = 0

	sceneSwitchShowHandle = window.setTimeout(() => {
		if (sceneSwitchToken !== token) {
			return
		}
		sceneSwitchOverlayVisible.value = true
		sceneSwitchShownAt = performance.now()
		requestAnimationFrame(() => {
			if (sceneSwitchToken !== token) {
				return
			}
			sceneSwitchFlashActive.value = true
		})
	}, SCENE_SWITCH_OVERLAY_DELAY_MS)

	return token
}

async function endSceneSwitch(token: number): Promise<void> {
	if (sceneSwitchToken !== token) {
		return
	}
	clearSceneSwitchTimers()

	const finalize = () => {
		if (sceneSwitchToken !== token) {
			return
		}
		sceneSwitchFlashActive.value = false
		sceneSwitchHideHandle = window.setTimeout(() => {
			if (sceneSwitchToken !== token) {
				return
			}
			sceneSwitchOverlayVisible.value = false
			sceneSwitching.value = false
			updateCameraControlActivation()
			updateCanvasCursor()
		}, SCENE_SWITCH_FLASH_FADE_OUT_MS)
	}

	if (!sceneSwitchOverlayVisible.value) {
		sceneSwitching.value = false
		updateCameraControlActivation()
		updateCanvasCursor()
		return
	}

	const elapsed = sceneSwitchShownAt ? performance.now() - sceneSwitchShownAt : 0
	const remaining = Math.max(0, SCENE_SWITCH_OVERLAY_MIN_VISIBLE_MS - elapsed)
	if (remaining > 0) {
		sceneSwitchHideHandle = window.setTimeout(finalize, remaining)
		return
	}
	finalize()
}

function clearBehaviorDelayTimers(): void {
	activeBehaviorDelayTimers.forEach((handle) => window.clearTimeout(handle))
	activeBehaviorDelayTimers.clear()
}

function cleanupForUnrelatedSceneSwitch(): void {
	clearBehaviorDelayTimers()
	resetAnimationControllers()
	forceInitialDocumentGraphOnNextSnapshot = true
}

function nextSnapshotRevision(): number {
	return Math.max(Date.now(), lastSnapshotRevision + 1)
}

function waitForSnapshotApplied(expectedTimestamp: string, token: number, timeoutMs = 15000): Promise<void> {
	return new Promise((resolve) => {
		if (sceneSwitchToken !== token) {
			resolve()
			return
		}
		if (lastUpdateTime.value === expectedTimestamp) {
			resolve()
			return
		}
		let resolved = false
		let stopUpdateWatch: (() => void) | null = null
		let stopStatusWatch: (() => void) | null = null
		const resolveOnce = () => {
			if (resolved) {
				return
			}
			resolved = true
			stopUpdateWatch?.()
			stopStatusWatch?.()
			resolve()
		}
		stopStatusWatch = watch(statusMessage, (value) => {
			if (sceneSwitchToken !== token) {
				resolveOnce()
				return
			}
			if (typeof value === 'string' && value.startsWith('Failed to load scene')) {
				resolveOnce()
			}
		})
		stopUpdateWatch = watch(
			lastUpdateTime,
			(value) => {
				if (resolved) {
					return
				}
				if (sceneSwitchToken !== token) {
					resolveOnce()
					return
				}
				if (value === expectedTimestamp) {
					resolveOnce()
				}
			},
		)
		window.setTimeout(() => {
			resolveOnce()
		}, timeoutMs)
	})
}

type SceneGraphResourceProgressInfo = Parameters<NonNullable<SceneGraphBuildOptions['onProgress']>>[0]

type ResourceProgressItem = {
	id: string
	assetId: string
	label: string
	kind: SceneGraphResourceProgressInfo['kind']
	progress: number
	bytesTotal: number
	bytesLoaded: number
}

const resourceProgressItems = ref<ResourceProgressItem[]>([])
const resourceAssetInfoMap = new Map<string, { name: string; bytes: number }>()

const assetCacheStore = useAssetCacheStore()

const editorAssetCache = new StoreBackedAssetCache(assetCacheStore)
const editorAssetLoader = new AssetLoader(editorAssetCache)
let editorResourceCache: ResourceCache | null = null

let activeScenePackageAssetOverrides: SceneGraphBuildOptions['assetOverrides'] | null = null

const resourceProgressPercent = computed(() => {
	if (resourceProgress.totalBytes > 0) {
		if (!resourceProgress.totalBytes) {
			return resourceProgress.active ? 0 : 100
		}
		const ratio = resourceProgress.loadedBytes / resourceProgress.totalBytes
		return Math.min(100, Math.max(0, Math.round(ratio * 100)))
	}
	if (!resourceProgress.total) {
		return resourceProgress.active ? 0 : 100
	}
	return Math.min(100, Math.round((resourceProgress.loaded / resourceProgress.total) * 100))
})

const resourceProgressBytesLabel = computed(() => {
	if (resourceProgress.totalBytes > 0) {
		return `${formatByteSize(resourceProgress.loadedBytes)} / ${formatByteSize(resourceProgress.totalBytes)}`
	}
	if (resourceProgress.total > 0) {
		return `Loaded ${resourceProgress.loaded} / ${resourceProgress.total}`
	}
	return ''
})

function formatByteSize(value: number | null | undefined): string {
	if (!value || value <= 0) {
		return '0 B'
	}
	const units = ['B', 'KB', 'MB', 'GB', 'TB']
	let size = value
	let index = 0
	while (size >= 1024 && index < units.length - 1) {
		size /= 1024
		index += 1
	}
	const digits = index === 0 ? 0 : size >= 100 ? 0 : size >= 10 ? 1 : 2
	return `${size.toFixed(digits)} ${units[index]}`
}

function clampProgressPercent(value: number): number {
	if (!Number.isFinite(value)) {
		return 0
	}
	if (value <= 0) {
		return 0
	}
	if (value >= 100) {
		return 100
	}
	return Math.round(value)
}

function normalizeResourceProgressPercent(info: SceneGraphResourceProgressInfo, previous: number): number {
	if (typeof info.progress === 'number' && Number.isFinite(info.progress)) {
		return clampProgressPercent(info.progress)
	}
	if (info.kind !== 'asset') {
		return 100
	}
	if (typeof info.message === 'string' && info.message.trim().length) {
		const messageText = info.message.toLowerCase()
		if (
			messageText.includes('complete') ||
			messageText.includes('completed') ||
			messageText.includes('loaded') ||
			messageText.includes('finished') ||
			messageText.includes('done')
		) {
			return 100
		}
	}
	if (info.total > 0 && info.loaded >= info.total) {
		return 100
	}
	return previous
}

function updateResourceProgressDetails(info: SceneGraphResourceProgressInfo): void {
	const assetId = typeof info.assetId === 'string' ? info.assetId.trim() : ''
	if (!assetId) {
		return
	}
	const assetMeta = resourceAssetInfoMap.get(assetId)
	const fallbackLabel = info.message && info.message.trim().length ? info.message : assetId
	const label = assetMeta?.name ?? fallbackLabel
	const existingIndex = resourceProgressItems.value.findIndex((item) => item.id === assetId)
	const previousItem = existingIndex >= 0 ? resourceProgressItems.value[existingIndex] : null
	const previous = previousItem?.progress ?? 0
	const normalized = normalizeResourceProgressPercent(info, previous)
	const progress = Math.max(previous, normalized)
	const bytesTotal = assetMeta?.bytes ?? previousItem?.bytesTotal ?? 0
	let bytesLoaded = previousItem?.bytesLoaded ?? 0
	if (bytesTotal > 0) {
		const computedLoaded = Math.round((bytesTotal * progress) / 100)
		if (computedLoaded > bytesLoaded) {
			bytesLoaded = Math.min(bytesTotal, computedLoaded)
		}
	}
	const nextItem: ResourceProgressItem = {
		id: assetId,
		assetId,
		label,
		kind: info.kind,
		progress,
		bytesTotal,
		bytesLoaded,
	}
	if (existingIndex >= 0) {
		resourceProgressItems.value.splice(existingIndex, 1, nextItem)
	} else {
		resourceProgressItems.value.push(nextItem)
	}
}

function refreshResourceAssetInfo(document: SceneJsonExportDocument | null | undefined): void {
	resourceAssetInfoMap.clear()
	if (!document?.resourceSummary || !Array.isArray(document.resourceSummary.assets)) {
		return
	}
	document.resourceSummary.assets.forEach((entry) => {
		if (!entry || typeof entry.assetId !== 'string') {
			return
		}
		const assetId = entry.assetId.trim()
		if (!assetId) {
			return
		}
		const name = typeof entry.name === 'string' && entry.name.trim().length ? entry.name.trim() : assetId
		const bytes = Number.isFinite(entry.bytes) && entry.bytes > 0 ? entry.bytes : 0
		resourceAssetInfoMap.set(assetId, { name, bytes })
	})
}

const previewComponentManager = new ComponentManager()
previewComponentManager.registerDefinition(floorComponentDefinition)
previewComponentManager.registerDefinition(wallComponentDefinition)
previewComponentManager.registerDefinition(roadComponentDefinition)
previewComponentManager.registerDefinition(guideboardComponentDefinition)
previewComponentManager.registerDefinition(displayBoardComponentDefinition)
previewComponentManager.registerDefinition(viewPointComponentDefinition)
previewComponentManager.registerDefinition(warpGateComponentDefinition)
previewComponentManager.registerDefinition(effectComponentDefinition)
previewComponentManager.registerDefinition(rigidbodyComponentDefinition)
previewComponentManager.registerDefinition(vehicleComponentDefinition)
previewComponentManager.registerDefinition(waterComponentDefinition)
previewComponentManager.registerDefinition(behaviorComponentDefinition)
previewComponentManager.registerDefinition(protagonistComponentDefinition)
previewComponentManager.registerDefinition(lodComponentDefinition)
previewComponentManager.registerDefinition(guideRouteComponentDefinition)
previewComponentManager.registerDefinition(autoTourComponentDefinition)
previewComponentManager.registerDefinition(purePursuitComponentDefinition)
previewComponentManager.registerDefinition(sceneStateAnchorComponentDefinition)

const previewNodeMap = new Map<string, SceneNode>()
const previewParentMap = new Map<string, string | null>()

const behaviorRaycaster = new THREE.Raycaster()
const behaviorPointer = new THREE.Vector2()

const LAYER_BEHAVIOR_INTERACTIVE = 1
const LAYER_VEHICLE_INTERACTIVE = 2

function syncInteractionLayersForNode(nodeId: string, object?: THREE.Object3D): void {
	const target = object ?? nodeObjectMap.get(nodeId)
	if (!target) {
		return
	}

	try {
		const directActions = listRegisteredBehaviorActions(nodeId)
		const hasClick = Array.isArray(directActions) && directActions.includes('click')
		const clickableAncestor = hasClick ? nodeId : resolveClickBehaviorAncestorNodeId(nodeId)
		if (clickableAncestor) {
			target.layers.enable(LAYER_BEHAVIOR_INTERACTIVE)
		} else {
			target.layers.disable(LAYER_BEHAVIOR_INTERACTIVE)
		}
	} catch {
		// keep layer state unchanged if behavior registry is unavailable
	}

	const vehicleNodeId = resolveVehicleAncestorNodeId(nodeId)
	if (vehicleNodeId) {
		target.layers.enable(LAYER_VEHICLE_INTERACTIVE)
	} else {
		target.layers.disable(LAYER_VEHICLE_INTERACTIVE)
	}
}

const behaviorAlertVisible = ref(false)
const behaviorAlertTitle = ref('')
const behaviorAlertMessage = ref('')
const behaviorAlertToken = ref<string | null>(null)
const behaviorAlertShowConfirm = ref(true)
const behaviorAlertShowCancel = ref(false)
const behaviorAlertConfirmText = ref('Confirm')
const behaviorAlertCancelText = ref('Cancel')

const lanternOverlayVisible = ref(false)
const lanternSlides = ref<LanternSlideDefinition[]>([])
const lanternActiveSlideIndex = ref(0)
const lanternEventToken = ref<string | null>(null)

const purposeControlsVisible = ref(false)
const purposeTargetNodeId = ref<string | null>(null)
const purposeSourceNodeId = ref<string | null>(null)

type VehicleDriveControlFlags = {
	forward: boolean
	backward: boolean
	left: boolean
	right: boolean
	brake: boolean
}

type VehicleDriveInputState = {
	throttle: number
	steering: number
	brake: number
}

const vehicleDriveState = reactive({
	active: false,
	nodeId: null as string | null,
	token: null as string | null,
	vehicle: null as CANNON.RaycastVehicle | null,
	steerableWheelIndices: [] as number[],
	wheelCount: 0,
	seatNodeId: null as string | null,
	sourceEvent: null as Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }> | null,
})

const vehicleDriveUiOverride = ref<'auto' | 'show' | 'hide'>('auto')
const pendingVehicleDriveEvent = ref<Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }> | null>(null)
const vehicleDrivePromptBusy = ref(false)
const vehicleDriveExitBusy = ref(false)
const activeAutoTourNodeIds = reactive(new Set<string>())

// Auto-tour pause only affects tour (not global playback), and does not change manual-drive behavior.
const autoTourPaused = ref(false)
const autoTourPausedIsTerminal = ref(false)
const autoTourPausedNodeId = ref<string | null>(null)

const autoTourFollowNodeId = ref<string | null>(null)
const autoTourCameraFollowState = createCameraFollowState()
const autoTourCameraFollowController = new FollowCameraController()
const autoTourCameraFollowLastAnchor = new THREE.Vector3()
const autoTourCameraFollowVelocity = new THREE.Vector3()
const autoTourCameraFollowVelocityScratch = new THREE.Vector3()
let autoTourCameraFollowHasSample = false
let autoTourActiveSyncAccumSeconds = 0
const AUTO_TOUR_CAMERA_WORLD_UP = new THREE.Vector3(0, 1, 0)

const vehicleDrivePrompt = computed(() => {
	// Ensure this computed updates when the set changes.
	activeAutoTourNodeIds.size
	autoTourPaused.value
	const event = pendingVehicleDriveEvent.value
	if (!event) {
		return {
			visible: false,
			label: '',
			busy: false,
			showDrive: false,
			showAutoTour: false,
			showStopTour: false,
			showPauseTour: false,
			pauseTourLabel: '暂停巡游',
			pauseTourIcon: 'mdi-pause-circle',
		}
	}
	const targetNodeId = event.targetNodeId ?? event.nodeId
	const node = targetNodeId ? resolveNodeById(targetNodeId) : null
	const label = node?.name?.trim() || targetNodeId || 'Vehicle'
	const canDrive = Boolean(resolveVehicleComponent(node))
	const canAutoTour = Boolean(resolveAutoTourComponent(node))
	const isTouring = Boolean(targetNodeId && activeAutoTourNodeIds.has(targetNodeId))
	const hasAnyAction = isTouring || canDrive || canAutoTour
	const pauseTourLabel = autoTourPaused.value ? '继续巡游' : '暂停巡游'
	const pauseTourIcon = autoTourPaused.value ? 'mdi-play-circle' : 'mdi-pause-circle'
	return {
		visible: hasAnyAction,
		label,
		busy: vehicleDrivePromptBusy.value,
		showDrive: canDrive && !isTouring,
		showAutoTour: canAutoTour && !isTouring,
		showStopTour: isTouring,
		showPauseTour: isTouring,
		pauseTourLabel,
		pauseTourIcon,
	}
})

type LanternTextState = { text: string; loading: boolean; error: string | null }
type LanternImageState = { url: string | null; loading: boolean; error: string | null }

const lanternTextState = reactive<Record<string, LanternTextState>>({})
const lanternTextPromises = new Map<string, Promise<void>>()
const lanternImageState = reactive<Record<string, LanternImageState>>({})
const lanternImagePromises = new Map<string, Promise<void>>()
const lanternImageNaturalSize = reactive({ width: 0, height: 0 })
const lanternViewportSize = reactive({
	width: typeof window !== 'undefined' ? window.innerWidth : 1280,
	height: typeof window !== 'undefined' ? window.innerHeight : 720,
})
const lanternViewerRoot = ref<HTMLElement | ComponentPublicInstance | null>(null)
let lanternViewerInstance: Viewer | null = null
const lanternViewerOptions: ViewerOptions = {
	inline: false,
	toolbar: true,
	navbar: false,
	title: false,
	tooltip: false,
	movable: true,
	zoomable: true,
	rotatable: false,
	scalable: false,
	transition: false,
	fullscreen: true,
	zIndex: 2300,
}

function ensureEditorResourceCache(
	document: SceneJsonExportDocument,
	options: SceneGraphBuildOptions,
): ResourceCache {
	if (!editorResourceCache) {
		editorResourceCache = new ResourceCache(document, options, editorAssetLoader)
	} else {
		editorResourceCache.setContext(document, options)
	}
	return editorResourceCache
}

const activeBehaviorDelayTimers = new Map<string, number>()
const activeBehaviorAnimations = new Map<string, () => void>()
const nodeAnimationControllers = new Map<string, {
	mixer: THREE.AnimationMixer
	clips: THREE.AnimationClip[]
	defaultClip: THREE.AnimationClip | null
}>()
type BehaviorProximityCandidate = { hasApproach: boolean; hasDepart: boolean }
type BehaviorProximityStateEntry = { inside: boolean; lastDistance: number | null }
type BehaviorProximityThreshold = { enter: number; exit: number; objectId: string }

const behaviorProximityCandidates = new Map<string, BehaviorProximityCandidate>()
const behaviorProximityState = new Map<string, BehaviorProximityStateEntry>()
const behaviorProximityThresholdCache = new Map<string, BehaviorProximityThreshold>()


const rgbeLoader = new RGBELoader().setDataType(THREE.FloatType)
const exrLoader = new EXRLoader().setDataType(THREE.FloatType)
const textureLoader = new THREE.TextureLoader()
const materialTextureCache = new Map<string, THREE.Texture>()
const pendingMaterialTextureRequests = new Map<string, Promise<THREE.Texture | null>>()

// Create loaders via schema factory to centralize terrain paint asset loading logic
const terrainPaintLoaders = createDefaultTerrainPaintLoaders(resolveAssetUrlFromCache)





function syncTerrainPaintPreviewForGround(groundObject: THREE.Object3D, dynamicMesh: GroundDynamicMesh): void {
	return syncTerrainPaintPreviewForGroundShared(
		groundObject,
		dynamicMesh,
		{
			loadTerrainPaintTextureFromAssetId: terrainPaintLoaders.loadTerrainPaintTextureFromAssetId,
			loadTerrainPaintWeightmapDataFromAssetId: terrainPaintLoaders.loadTerrainPaintWeightmapDataFromAssetId,
		},
		() => terrainPaintPreviewLoadToken,
	)
}

const MAX_CONCURRENT_LAZY_LOADS = 2

type StatsInstance = {
	dom: HTMLDivElement
	showPanel: (id: number) => void
	begin: () => void
	end: () => number
	update: () => void
}

const StatsFactory = Stats as unknown as () => StatsInstance

let fpsStats: StatsInstance | null = null
let memoryStats: StatsInstance | null = null

type LazyPlaceholderState = {
	nodeId: string
	container: THREE.Object3D | null
	placeholder: THREE.Object3D
	assetId: string
	objectPath: number[] | null
	boundingSphere: THREE.Sphere | null
	loading: boolean
	loaded: boolean
	pending: Promise<void> | null
}

const lazyPlaceholderStates = new Map<string, LazyPlaceholderState>()
const deferredInstancingNodeIds = new Set<string>()
let lazyLoadMeshesEnabled = true
let activeLazyLoadCount = 0
const tempOutlineSphere = new THREE.Sphere()
const tempOutlineScale = new THREE.Vector3()

const CAMERA_HEIGHT = 1.6
const FIRST_PERSON_ROTATION_SPEED = 25
const FIRST_PERSON_MOVE_SPEED = 5
const FIRST_PERSON_LOOK_SPEED = 0.06
const FIRST_PERSON_PITCH_LIMIT = THREE.MathUtils.degToRad(75)
const tempDirection = new THREE.Vector3()
const tempTarget = new THREE.Vector3()
const tempQuaternion = new THREE.Quaternion()
const protagonistPosePosition = new THREE.Vector3()
const protagonistPoseDirection = new THREE.Vector3()
const protagonistPoseTarget = new THREE.Vector3()
const tempBox = new THREE.Box3()
const tempSphere = new THREE.Sphere()
const tempPosition = new THREE.Vector3()
const tempObserverPosition = new THREE.Vector3()
const tempCameraMatrix = new THREE.Matrix4()
const cameraViewFrustum = new THREE.Frustum()
const instancedCullingProjView = new THREE.Matrix4()
const instancedCullingFrustum = new THREE.Frustum()
const instancedCullingBox = new THREE.Box3()
const instancedCullingSphere = new THREE.Sphere()
const instancedCullingWorldPosition = new THREE.Vector3()
const VEHICLE_BRAKE_FORCE = 45
const VEHICLE_CAMERA_DEFAULT_LOOK_DISTANCE = 6
const VEHICLE_FOLLOW_DISTANCE_MIN = 4
const VEHICLE_FOLLOW_DISTANCE_MAX = 26
const skySunPosition = new THREE.Vector3()
const DEFAULT_SUN_DIRECTION = new THREE.Vector3(0.35, 1, -0.25).normalize()
const tempSunDirection = new THREE.Vector3()
const SKY_SUN_LIGHT_DISTANCE = 150
const SKY_SUN_LIGHT_MIN_HEIGHT = 10
const SKY_ENVIRONMENT_INTENSITY = 0.35
const SKY_SCALE = 2500
const DEFAULT_BACKGROUND_COLOR = 0x0d0d12
const DEFAULT_SKYBOX_SETTINGS: SceneSkyboxSettings = {
	presetId: 'clear-day',
	exposure: 0.6,
	turbidity: 4,
	rayleigh: 1.25,
	mieCoefficient: 0.0025,
	mieDirectionalG: 0.75,
	elevation: 22,
	azimuth: 145,
	clouds: null,
}
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const DEFAULT_ENVIRONMENT_BACKGROUND_COLOR = '#516175'
const DEFAULT_ENVIRONMENT_AMBIENT_COLOR = '#ffffff'
const DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY = 0.6
const DEFAULT_ENVIRONMENT_FOG_COLOR = '#516175'
const DEFAULT_ENVIRONMENT_FOG_DENSITY = 0.02
const DEFAULT_ENVIRONMENT_FOG_NEAR = 1
const DEFAULT_ENVIRONMENT_FOG_FAR = 50
const DEFAULT_ENVIRONMENT_GRAVITY = 9.81
const DEFAULT_ENVIRONMENT_RESTITUTION = 0.2
const DEFAULT_ENVIRONMENT_FRICTION = 0.3
const DEFAULT_ENVIRONMENT_SETTINGS: EnvironmentSettings = {
	background: {
		mode: 'skybox',
		solidColor: DEFAULT_ENVIRONMENT_BACKGROUND_COLOR,
		hdriAssetId: null,
	},
	ambientLightColor: DEFAULT_ENVIRONMENT_AMBIENT_COLOR,
	ambientLightIntensity: DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY,
	fogMode: 'none',
	fogColor: DEFAULT_ENVIRONMENT_FOG_COLOR,
	fogDensity: DEFAULT_ENVIRONMENT_FOG_DENSITY,
	fogNear: DEFAULT_ENVIRONMENT_FOG_NEAR,
	fogFar: DEFAULT_ENVIRONMENT_FOG_FAR,
	environmentMap: {
		mode: 'skybox',
		hdriAssetId: null,
	},
	gravityStrength: DEFAULT_ENVIRONMENT_GRAVITY,
	collisionRestitution: DEFAULT_ENVIRONMENT_RESTITUTION,
	collisionFriction: DEFAULT_ENVIRONMENT_FRICTION,
}
const CAMERA_WATCH_TWEEN_DURATION = 0.45
const CAMERA_LEVEL_TWEEN_DURATION = 0.35
type CameraLookTweenMode = 'first-person' | 'orbit'
type CameraLookTween = {
	mode: CameraLookTweenMode
	from: THREE.Vector3
	to: THREE.Vector3
	duration: number
	elapsed: number
}
let activeCameraLookTween: CameraLookTween | null = null
const assetObjectUrlCache = new Map<string, string>()
const DISPLAY_BOARD_RESOLVER_KEY = '__harmonyResolveDisplayBoardMedia'

type ResolvedAssetUrl = { url: string; mimeType?: string | null; dispose?: () => void }

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let listener: THREE.AudioListener | null = null
let rootGroup: THREE.Group | null = null
let sunDirectionalLight: THREE.DirectionalLight | null = null
let sky: Sky | null = null
let shouldRenderSkyBackground = true
let pmremGenerator: THREE.PMREMGenerator | null = null
let skyEnvironmentTarget: THREE.WebGLRenderTarget | null = null
let cloudRenderer: SceneCloudRenderer | null = null
let environmentAmbientLight: THREE.AmbientLight | null = null
let backgroundTexture: THREE.Texture | null = null
let backgroundTextureCleanup: (() => void) | null = null
let backgroundAssetId: string | null = null
let backgroundLoadToken = 0
let environmentMapTarget: THREE.WebGLRenderTarget | null = null
let environmentMapAssetId: string | null = null
let environmentMapLoadToken = 0
let firstPersonControls: FirstPersonControls | null = null
let mapControls: MapControls | null = null
let followCameraControlActive = false
let followCameraControlDirty = false
let rendererInitialized = false
let suppressControlModeApply = false
const MAP_CONTROL_DEFAULTS = {
	minDistance: 1,
	maxDistance: 200,
	enablePan: true,
}
let animationFrameHandle = 0
let currentDocument: SceneJsonExportDocument | null = null
let cachedGroundNodeId: string | null = null
let cachedGroundDynamicMesh: GroundDynamicMesh | null = null
let terrainPaintPreviewLoadToken = 0
let unsubscribe: (() => void) | null = null
let livePreviewEnabled = true
let isApplyingSnapshot = false
let queuedSnapshot: ScenePreviewSnapshot | null = null
let lastSnapshotRevision = 0
let protagonistPoseSynced = false

const CAMERA_DEPENDENT_POSITION_EPSILON = 0.02
const CAMERA_DEPENDENT_POSITION_EPSILON_SQ = CAMERA_DEPENDENT_POSITION_EPSILON * CAMERA_DEPENDENT_POSITION_EPSILON
const CAMERA_DEPENDENT_ROTATION_EPSILON = 1e-4
const CAMERA_DEPENDENT_UPDATE_INTERVAL_SECONDS = 0.12

const cameraDependentUpdatePosition = new THREE.Vector3()
const cameraDependentUpdateQuaternion = new THREE.Quaternion()
const lastCameraDependentUpdatePosition = new THREE.Vector3()
const lastCameraDependentUpdateQuaternion = new THREE.Quaternion()
let cameraDependentUpdateInitialized = false
let cameraDependentUpdateElapsed = 0

const clock = new THREE.Clock()
const instancedMeshGroup = new THREE.Group()
instancedMeshGroup.name = 'InstancedMeshes'
const instancedMeshes: THREE.InstancedMesh[] = []
let stopInstancedMeshSubscription: (() => void) | null = null

let instancedCullingVisualizationGroup: THREE.Group | null = null
let instancedCullingVisualizationMesh: THREE.InstancedMesh | null = null
let instancedCullingVisualizationGeometry: THREE.BoxGeometry | null = null
let instancedCullingVisualizationMaterial: THREE.MeshBasicMaterial | null = null
let instancedCullingVisualizationCapacity = 0
const instancedCullingVisualizationSizeHelper = new THREE.Vector3()
const instancedCullingVisualizationScaleHelper = new THREE.Vector3()
const instancedCullingVisualizationBoxScaleHelper = new THREE.Vector3()
const instancedCullingVisualizationCenterLocalHelper = new THREE.Vector3()
const instancedCullingVisualizationCenterWorldHelper = new THREE.Vector3()
const instancedCullingVisualizationVisibleColor = new THREE.Color(0x2ecc71)
const instancedCullingVisualizationCulledColor = new THREE.Color(0xe74c3c)
const instancedMatrixHelper = new THREE.Matrix4()
const instancedPositionHelper = new THREE.Vector3()
const instancedQuaternionHelper = new THREE.Quaternion()
const instancedScaleHelper = new THREE.Vector3()

type InstancedMatrixCacheEntry = {
	bindingKey: string
	elements: Float32Array
}

const instancedMatrixCache = new Map<string, InstancedMatrixCacheEntry>()

function buildModelInstanceBindingKey(binding: ModelInstanceBinding): string {
	// Slot count is typically small (LOD variants), so a compact string key is fine.
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
const rigidbodyDebugPositionHelper = new THREE.Vector3()
const rigidbodyDebugQuaternionHelper = new THREE.Quaternion()
const rigidbodyDebugScaleHelper = new THREE.Vector3()
const wheelForwardHelper = new THREE.Vector3()
const wheelAxisHelper = new THREE.Vector3()
const wheelChassisQuaternionHelper = new THREE.Quaternion()
const wheelVisualQuaternionHelper = new THREE.Quaternion()
const wheelParentWorldQuaternionHelper = new THREE.Quaternion()
const wheelParentWorldQuaternionInverseHelper = new THREE.Quaternion()
const wheelBaseQuaternionInverseHelper = new THREE.Quaternion()
const wheelSteeringQuaternionHelper = new THREE.Quaternion()
const wheelSpinQuaternionHelper = new THREE.Quaternion()
const wheelChassisPositionHelper = new THREE.Vector3()
const wheelChassisDisplacementHelper = new THREE.Vector3()
const defaultWheelAxisVector = new THREE.Vector3(DEFAULT_AXLE.x, DEFAULT_AXLE.y, DEFAULT_AXLE.z).normalize()
const VEHICLE_WHEEL_MIN_RADIUS = 0.01
const VEHICLE_WHEEL_SPIN_EPSILON = 1e-4
const VEHICLE_TRAVEL_EPSILON = 1e-5
const STEERING_WHEEL_MAX_DEGREES = 135
const STEERING_WHEEL_MAX_RADIANS = THREE.MathUtils.degToRad(STEERING_WHEEL_MAX_DEGREES)
const STEERING_WHEEL_RETURN_SPEED = 4
const STEERING_KEYBOARD_RETURN_SPEED = 7
const STEERING_KEYBOARD_CATCH_SPEED = 18
const nodeObjectMap = new Map<string, THREE.Object3D>()

function syncGroundCache(document: SceneJsonExportDocument | null): void {
	cachedGroundNodeId = null
	cachedGroundDynamicMesh = null
	cameraDependentUpdateInitialized = false
	terrainPaintPreviewLoadToken += 1
	if (!document) {
		return
	}
	const groundNode = findGroundNode(document.nodes)
	if (!groundNode || !isGroundDynamicMesh(groundNode.dynamicMesh)) {
		return
	}
	cachedGroundNodeId = groundNode.id
	cachedGroundDynamicMesh = groundNode.dynamicMesh
}

function shouldUpdateCameraDependentSystems(activeCamera: THREE.PerspectiveCamera, delta: number): boolean {
	cameraDependentUpdateElapsed += Math.max(0, delta)
	activeCamera.updateMatrixWorld(true)
	activeCamera.getWorldPosition(cameraDependentUpdatePosition)
	activeCamera.getWorldQuaternion(cameraDependentUpdateQuaternion)

	if (!cameraDependentUpdateInitialized) {
		cameraDependentUpdateInitialized = true
		cameraDependentUpdateElapsed = 0
		lastCameraDependentUpdatePosition.copy(cameraDependentUpdatePosition)
		lastCameraDependentUpdateQuaternion.copy(cameraDependentUpdateQuaternion)
		return true
	}

	const movedSq = cameraDependentUpdatePosition.distanceToSquared(lastCameraDependentUpdatePosition)
	const dot = Math.abs(cameraDependentUpdateQuaternion.dot(lastCameraDependentUpdateQuaternion))
	const rotated = 1 - dot > CAMERA_DEPENDENT_ROTATION_EPSILON
	const moved = movedSq > CAMERA_DEPENDENT_POSITION_EPSILON_SQ
	const due = isPlaying.value && cameraDependentUpdateElapsed >= CAMERA_DEPENDENT_UPDATE_INTERVAL_SECONDS

	if (!moved && !rotated && !due) {
		return false
	}

	cameraDependentUpdateElapsed = 0
	lastCameraDependentUpdatePosition.copy(cameraDependentUpdatePosition)
	lastCameraDependentUpdateQuaternion.copy(cameraDependentUpdateQuaternion)
	return true
}

let physicsWorld: CANNON.World | null = null
const rigidbodyInstances = new Map<string, RigidbodyInstance>()
const airWallBodies = new Map<string, CANNON.Body>()
type AirWallDebugEntry = {
	key: string
	halfExtents: [number, number, number]
	position: THREE.Vector3
	quaternion: THREE.Quaternion
}
const airWallDebugEntries = new Map<string, AirWallDebugEntry>()
const airWallDebugMeshes = new Map<string, THREE.Mesh>()
type RigidbodyDebugHelperCategory = 'ground' | 'rigidbody'
type RigidbodyDebugHelper = { group: THREE.Group; signature: string; category: RigidbodyDebugHelperCategory; scale: THREE.Vector3 }
const rigidbodyDebugHelpers = new Map<string, RigidbodyDebugHelper>()
const roadHeightfieldDebugCache: RoadHeightfieldDebugCache = new Map()
let rigidbodyDebugGroup: THREE.Group | null = null
let airWallDebugGroup: THREE.Group | null = null
const rigidbodyDebugMaterial = new THREE.LineBasicMaterial({
	color: 0xffc107,
	transparent: true,
	opacity: 0.9,
})
rigidbodyDebugMaterial.depthTest = false
rigidbodyDebugMaterial.depthWrite = false
const heightfieldDebugOrientationInverse = new THREE.Quaternion().setFromAxisAngle(
	new THREE.Vector3(1, 0, 0),
	Math.PI / 2,
)
const airWallDebugMaterial = new THREE.MeshBasicMaterial({
	color: 0x80c7ff,
	transparent: true,
	opacity: 0.28,
	side: THREE.DoubleSide,
	depthWrite: false,
	depthTest: false,
})

type GroundChunkUserData = {
	startRow: number
	startColumn: number
	rows: number
	columns: number
	chunkRow: number
	chunkColumn: number
}

const groundChunkDebugMeshes = new Map<string, THREE.Group>()
let groundChunkDebugGroup: THREE.Group | null = null
let groundChunkDebugBoxGeometry: THREE.BoxGeometry | null = null
let groundChunkDebugEdgesGeometry: THREE.EdgesGeometry | null = null
let groundChunkDebugLastSyncAt = 0
let groundChunkCellsEstimate: number | null = null
const groundChunkDebugBoxHelper = new THREE.Box3()
const groundChunkDebugCenterHelper = new THREE.Vector3()
const groundChunkDebugSizeHelper = new THREE.Vector3()
const groundChunkDebugRootInverseHelper = new THREE.Matrix4()
const groundChunkDebugCameraWorldHelper = new THREE.Vector3()
const groundChunkDebugCameraLocalHelper = new THREE.Vector3()

function hashStringFNV1a(input: string): number {
	let hash = 0x811c9dc5
	for (let i = 0; i < input.length; i += 1) {
		hash ^= input.charCodeAt(i)
		hash = Math.imul(hash, 0x01000193)
	}
	return hash >>> 0
}

function colorFromGroundChunkKey(key: string): THREE.Color {
	const hash = hashStringFNV1a(key)
	const hue = (hash % 360) / 360
	return new THREE.Color().setHSL(hue, 0.65, 0.55)
}

function ensureGroundChunkDebugGeometries(): void {
	if (!groundChunkDebugBoxGeometry) {
		groundChunkDebugBoxGeometry = new THREE.BoxGeometry(1, 1, 1)
	}
	if (!groundChunkDebugEdgesGeometry && groundChunkDebugBoxGeometry) {
		groundChunkDebugEdgesGeometry = new THREE.EdgesGeometry(groundChunkDebugBoxGeometry)
	}
}

function disposeGroundChunkDebugHelpers(): void {
	groundChunkDebugMeshes.forEach((group) => {
		group.traverse((object) => {
			if ((object as THREE.Mesh).isMesh) {
				const mesh = object as THREE.Mesh
				const material = mesh.material
				if (Array.isArray(material)) {
					material.forEach((entry) => entry?.dispose?.())
				} else {
					material?.dispose?.()
				}
			}
			if ((object as THREE.LineSegments).isLineSegments) {
				const line = object as THREE.LineSegments
				const material = line.material as THREE.Material | THREE.Material[]
				if (Array.isArray(material)) {
					material.forEach((entry) => entry?.dispose?.())
				} else {
					material?.dispose?.()
				}
			}
		})
		group.removeFromParent()
	})
	groundChunkDebugMeshes.clear()
	groundChunkDebugGroup?.removeFromParent()
	groundChunkDebugGroup = null
	groundChunkCellsEstimate = null
	groundChunkDebugLastSyncAt = 0
	groundChunkDebug.loaded = 0
	groundChunkDebug.target = 0
	groundChunkDebug.total = 0
	groundChunkDebug.pending = 0
	groundChunkDebug.unloaded = 0
	if (groundChunkDebugEdgesGeometry) {
		groundChunkDebugEdgesGeometry.dispose()
		groundChunkDebugEdgesGeometry = null
	}
	if (groundChunkDebugBoxGeometry) {
		groundChunkDebugBoxGeometry.dispose()
		groundChunkDebugBoxGeometry = null
	}
}

function ensureGroundChunkDebugGroup(groundObject: THREE.Object3D): THREE.Group {
	if (!groundChunkDebugGroup) {
		groundChunkDebugGroup = new THREE.Group()
		groundChunkDebugGroup.name = 'GroundChunkDebugHelpers'
	}
	if (groundChunkDebugGroup.parent !== groundObject) {
		groundObject.add(groundChunkDebugGroup)
	}
	return groundChunkDebugGroup
}

function computeTotalGroundChunkCount(definition: GroundDynamicMesh, chunkCells: number): number {
	const rows = Math.max(1, Math.trunc(definition.rows))
	const columns = Math.max(1, Math.trunc(definition.columns))
	const safeCells = Math.max(1, Math.trunc(chunkCells))
	const rowChunks = Math.ceil(rows / safeCells)
	const columnChunks = Math.ceil(columns / safeCells)
	return Math.max(1, rowChunks * columnChunks)
}

function createGroundChunkDebugEntry(key: string): THREE.Group {
	ensureGroundChunkDebugGeometries()
	const group = new THREE.Group()
	group.name = `GroundChunkDebug:${key}`
	group.userData.groundChunkDebugKey = key
	const color = colorFromGroundChunkKey(key)

	const fillMaterial = new THREE.MeshBasicMaterial({
		color,
		transparent: true,
		opacity: 0.18,
		depthTest: false,
		depthWrite: false,
	})
	const edgeMaterial = new THREE.LineBasicMaterial({
		color,
		transparent: true,
		opacity: 0.9,
		depthTest: false,
		depthWrite: false,
	})

	const fillMesh = new THREE.Mesh(groundChunkDebugBoxGeometry!, fillMaterial)
	fillMesh.name = `GroundChunkDebugFill:${key}`
	fillMesh.renderOrder = 9999
	const edgeLines = new THREE.LineSegments(groundChunkDebugEdgesGeometry!, edgeMaterial)
	edgeLines.name = `GroundChunkDebugEdges:${key}`
	edgeLines.renderOrder = 10000
	group.add(fillMesh)
	group.add(edgeLines)
	return group
}

function resolveGroundChunkRadius(definition: GroundDynamicMesh): number {
	const columns = Math.max(1, Math.trunc(definition.columns))
	const rows = Math.max(1, Math.trunc(definition.rows))
	const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
	const width = Number.isFinite(definition.width) && definition.width > 0 ? definition.width : columns * cellSize
	const depth = Number.isFinite(definition.depth) && definition.depth > 0 ? definition.depth : rows * cellSize
	const halfDiagonal = Math.sqrt(Math.max(0, width) ** 2 + Math.max(0, depth) ** 2) * 0.5
	const defaultRadius = 200
	return Math.max(80, Math.min(2000, Math.min(defaultRadius, halfDiagonal)))
}

function computeTargetGroundChunkCount(
	definition: GroundDynamicMesh,
	chunkCells: number,
	groundObject: THREE.Object3D,
	activeCamera: THREE.PerspectiveCamera,
): number {
	const columns = Math.max(1, Math.trunc(definition.columns))
	const rows = Math.max(1, Math.trunc(definition.rows))
	const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
	const width = Number.isFinite(definition.width) && definition.width > 0 ? definition.width : columns * cellSize
	const depth = Number.isFinite(definition.depth) && definition.depth > 0 ? definition.depth : rows * cellSize
	const safeCells = Math.max(1, Math.trunc(chunkCells))
	const rowChunks = Math.max(1, Math.ceil(rows / safeCells))
	const columnChunks = Math.max(1, Math.ceil(columns / safeCells))

	const chunkSizeMeters = Math.max(1e-6, safeCells * cellSize)
	const radiusMeters = resolveGroundChunkRadius(definition)
	const radiusChunks = Math.max(0, Math.ceil(radiusMeters / chunkSizeMeters))

	groundObject.updateWorldMatrix(true, false)
	groundChunkDebugRootInverseHelper.copy(groundObject.matrixWorld).invert()
	activeCamera.getWorldPosition(groundChunkDebugCameraWorldHelper)
	groundChunkDebugCameraLocalHelper.copy(groundChunkDebugCameraWorldHelper).applyMatrix4(groundChunkDebugRootInverseHelper)

	const halfWidth = width * 0.5
	const halfDepth = depth * 0.5
	const chunkColumn = Math.max(
		0,
		Math.min(columnChunks - 1, Math.floor((groundChunkDebugCameraLocalHelper.x + halfWidth) / chunkSizeMeters)),
	)
	const chunkRow = Math.max(
		0,
		Math.min(rowChunks - 1, Math.floor((groundChunkDebugCameraLocalHelper.z + halfDepth) / chunkSizeMeters)),
	)

	const minRow = Math.max(0, chunkRow - radiusChunks)
	const maxRow = Math.min(rowChunks - 1, chunkRow + radiusChunks)
	const minCol = Math.max(0, chunkColumn - radiusChunks)
	const maxCol = Math.min(columnChunks - 1, chunkColumn + radiusChunks)

	const target = (maxRow - minRow + 1) * (maxCol - minCol + 1)
	return Math.max(1, Math.min(target, rowChunks * columnChunks))
}

function syncGroundChunkStreamingDebug(
	groundObject: THREE.Object3D,
	definition: GroundDynamicMesh,
	activeCamera: THREE.PerspectiveCamera,
	options: { renderHelpers: boolean },
): void {
	const now = performance.now()
	if (now - groundChunkDebugLastSyncAt < 120) {
		return
	}
	groundChunkDebugLastSyncAt = now

	const debugRoot = options.renderHelpers ? ensureGroundChunkDebugGroup(groundObject) : null
	const keep = options.renderHelpers ? new Set<string>() : null
	let loadedChunks = 0
	let maxChunkCells = 0

	groundObject.updateWorldMatrix(true, false)
	groundChunkDebugRootInverseHelper.copy(groundObject.matrixWorld).invert()

	groundObject.traverse((object) => {
		const mesh = object as THREE.Mesh
		if (!mesh.isMesh) {
			return
		}
		const chunk = (mesh.userData?.groundChunk ?? null) as GroundChunkUserData | null
		if (!chunk) {
			return
		}
		loadedChunks += 1
		maxChunkCells = Math.max(maxChunkCells, Math.max(chunk.rows, chunk.columns))

		if (options.renderHelpers && debugRoot && keep) {
			const key = `${chunk.chunkRow}:${chunk.chunkColumn}`
			keep.add(key)

			let entry = groundChunkDebugMeshes.get(key)
			if (!entry) {
				entry = createGroundChunkDebugEntry(key)
				groundChunkDebugMeshes.set(key, entry)
				debugRoot.add(entry)
			}

			mesh.updateWorldMatrix(true, false)
			groundChunkDebugBoxHelper.setFromObject(mesh)
			groundChunkDebugBoxHelper.applyMatrix4(groundChunkDebugRootInverseHelper)
			groundChunkDebugBoxHelper.getCenter(groundChunkDebugCenterHelper)
			groundChunkDebugBoxHelper.getSize(groundChunkDebugSizeHelper)
			entry.position.copy(groundChunkDebugCenterHelper)
			entry.scale.set(
				Math.max(1e-6, groundChunkDebugSizeHelper.x),
				Math.max(1e-6, groundChunkDebugSizeHelper.y),
				Math.max(1e-6, groundChunkDebugSizeHelper.z),
			)
		}
	})

	if (options.renderHelpers && keep) {
		groundChunkDebugMeshes.forEach((entry, key) => {
			if (keep.has(key)) {
				return
			}
			entry.traverse((object) => {
				if ((object as THREE.Mesh).isMesh) {
					const mesh = object as THREE.Mesh
					const material = mesh.material
					if (Array.isArray(material)) {
						material.forEach((entryMaterial) => entryMaterial?.dispose?.())
					} else {
						material?.dispose?.()
					}
				}
				if ((object as THREE.LineSegments).isLineSegments) {
					const line = object as THREE.LineSegments
					const material = line.material as THREE.Material | THREE.Material[]
					if (Array.isArray(material)) {
						material.forEach((entryMaterial) => entryMaterial?.dispose?.())
					} else {
						material?.dispose?.()
					}
				}
			})
			entry.removeFromParent()
			groundChunkDebugMeshes.delete(key)
		})
	}

	if (maxChunkCells > 0) {
		groundChunkCellsEstimate = Math.max(groundChunkCellsEstimate ?? 0, maxChunkCells)
	}
	const total = groundChunkCellsEstimate ? computeTotalGroundChunkCount(definition, groundChunkCellsEstimate) : loadedChunks
	const target = groundChunkCellsEstimate
		? computeTargetGroundChunkCount(definition, groundChunkCellsEstimate, groundObject, activeCamera)
		: loadedChunks
	groundChunkDebug.loaded = loadedChunks
	groundChunkDebug.total = total
	groundChunkDebug.target = target
	groundChunkDebug.pending = Math.max(0, target - loadedChunks)
	groundChunkDebug.unloaded = Math.max(0, total - loadedChunks)
}

const rigidbodyMaterialCache = new Map<string, RigidbodyMaterialEntry>()
const rigidbodyContactMaterialKeys = new Set<string>()
type VehicleWheelBinding = {
	nodeId: string | null
	object: THREE.Object3D | null
	radius: number
	axleAxis: THREE.Vector3
	isFrontWheel: boolean
	wheelIndex: number
	spinAngle: number
	lastSteeringAngle: number
	baseQuaternion: THREE.Quaternion
	basePosition: THREE.Vector3
	baseScale: THREE.Vector3
}
type VehicleWheelSetupEntry = {
	config: VehicleWheelProps
	point: CANNON.Vec3
	direction: CANNON.Vec3
	axle: CANNON.Vec3
}
type VehicleInstance = {
	nodeId: string
	vehicle: CANNON.RaycastVehicle
	wheelCount: number
	steerableWheelIndices: number[]
	wheelBindings: VehicleWheelBinding[]
	forwardAxis: THREE.Vector3
	axisRight: THREE.Vector3
	axisUp: THREE.Vector3
	axisForward: THREE.Vector3
	axisRightIndex: 0 | 1 | 2
	axisUpIndex: 0 | 1 | 2
	axisForwardIndex: 0 | 1 | 2
	lastChassisPosition: THREE.Vector3
	hasChassisPositionSample: boolean
	initialChassisQuaternion: THREE.Quaternion
}
const vehicleInstances = new Map<string, VehicleInstance>()
const vehicleRaycastInWorld = new Set<string>()
const groundHeightfieldCache = new Map<string, GroundHeightfieldCacheEntry>()
const wallTrimeshCache = new Map<string, WallTrimeshCacheEntry>()
const physicsGravity = new CANNON.Vec3(0, -DEFAULT_ENVIRONMENT_GRAVITY, 0)
let physicsContactRestitution = DEFAULT_ENVIRONMENT_RESTITUTION
let physicsContactFriction = DEFAULT_ENVIRONMENT_FRICTION
const vehicleIdleFreezeLastLogMs = new Map<string, number>()
const PHYSICS_FIXED_TIMESTEP = 1 / 60
const PHYSICS_MAX_SUB_STEPS = 5
const PHYSICS_SOLVER_ITERATIONS = 18
const PHYSICS_SOLVER_TOLERANCE = 5e-4
const PHYSICS_CONTACT_STIFFNESS = 1e9
const PHYSICS_CONTACT_RELAXATION = 4
const PHYSICS_FRICTION_STIFFNESS = 1e9
const PHYSICS_FRICTION_RELAXATION = 4
const rotationState = { q: false, e: false }
const defaultFirstPersonState = {
	position: new THREE.Vector3(0, CAMERA_HEIGHT, 0),
	direction: new THREE.Vector3(0, 0, -1),
}
const defaultOrbitState = {
	position: new THREE.Vector3(8, 6, 8),
	target: new THREE.Vector3(0, 0, 0),
}
const lastFirstPersonState = {
	position: defaultFirstPersonState.position.clone(),
	direction: defaultFirstPersonState.direction.clone(),
}
const lastOrbitState = {
	position: defaultOrbitState.position.clone(),
	target: defaultOrbitState.target.clone(),
}
let animationMixers: THREE.AnimationMixer[] = []
let effectRuntimeTickers: Array<(delta: number) => void> = []

type WarpGateRuntimeRegistryEntry = {
	tick?: (delta: number) => void
	props?: Partial<WarpGateComponentProps> | null
	setPlaybackActive?: (active: boolean) => void
}

type GuideboardRuntimeRegistryEntry = {
	tick?: (delta: number) => void
	props?: Partial<GuideboardComponentProps> | null
	setPlaybackActive?: (active: boolean) => void
}

function isWarpGateEffectActive(props: Partial<WarpGateComponentProps> | null | undefined): boolean {
	if (!props) {
		return false
	}
	const nested = (props as { groundLight?: Partial<WarpGateComponentProps> | null | undefined }).groundLight
	if (nested && typeof nested === 'object') {
		return isWarpGateEffectActive(nested)
	}
	const showParticles = props.showParticles === true
	const particleCount = typeof props.particleCount === 'number' ? props.particleCount : 0
	const showBeams = props.showBeams === true
	const showRings = props.showRings === true
	return (showParticles && particleCount > 0) || showBeams || showRings
}

function isGuideboardEffectActive(props: Partial<GuideboardComponentProps> | null | undefined): boolean {
	if (!props) {
		return false
	}
	const normalized = clampGuideboardComponentProps(props)
	return computeGuideboardEffectActive(normalized)
}

function rebuildPreviewNodeMap(nodes: SceneNode[] | undefined | null): void {
	rebuildSceneNodeIndex(nodes ?? null, previewNodeMap, previewParentMap)
}

function resolveParentNodeId(nodeId: string): string | null {
	return resolveSceneParentNodeId(previewParentMap, nodeId)
}

function resolveNodeById(nodeId: string): SceneNode | null {
	return resolveSceneNodeById(previewNodeMap, nodeId)
}

function findGroundNode(nodes: SceneNode[] | undefined | null): SceneNode | null {
	if (!Array.isArray(nodes)) {
		return null
	}
	const stack: SceneNode[] = [...nodes]
	while (stack.length) {
		const node = stack.pop()
		if (!node) {
			continue
		}
		if (isGroundDynamicMesh(node.dynamicMesh)) {
			return node
		}
		if (Array.isArray(node.children) && node.children.length) {
			stack.push(...node.children)
		}
	}
	return null
}

function resolveVehicleAncestorNodeId(nodeId: string | null): string | null {
	let currentId: string | null = nodeId
	while (currentId) {
		const node = resolveNodeById(currentId)
		if (!node) {
			break
		}
		if (resolveVehicleComponent(node)) {
			return currentId
		}
		currentId = resolveParentNodeId(currentId)
	}
	return null
}

function resolveClickBehaviorAncestorNodeId(nodeId: string | null): string | null {
	let currentId: string | null = nodeId
	while (currentId) {
		try {
			const actions = listRegisteredBehaviorActions(currentId)
			if (actions.includes('click')) {
				return currentId
			}
		} catch {
			// keep searching if behavior registry is unavailable
		}
		currentId = resolveParentNodeId(currentId)
	}
	return null
}

const vehicleDriveUi = computed(() => {
	const override = vehicleDriveUiOverride.value
	const baseActive = vehicleDriveState.active
	const visible = override === 'show' ? true : override === 'hide' ? false : baseActive
	if (!visible) {
		return {
			visible: false,
			label: '',
			cameraLocked: false,
			forwardActive: false,
			backwardActive: false,
			brakeActive: false,
		}
	}
	const nodeId = vehicleDriveState.nodeId ?? ''
	const node = nodeId ? resolveNodeById(nodeId) : null
	const label = node?.name?.trim() || nodeId || 'Vehicle'
	const driveActive = vehicleDriveState.active
	return {
		visible: true,
		label,
		cameraLocked: driveActive,
		forwardActive: driveActive && vehicleDriveInputFlags.forward,
		backwardActive: driveActive && vehicleDriveInputFlags.backward,
		brakeActive: driveActive && vehicleDriveInputFlags.brake,
	}
})

const steeringWheelRef = ref<HTMLDivElement | null>(null)
const steeringWheelValue = ref(0)
const steeringKeyboardValue = ref(0)
const steeringKeyboardTarget = ref(0)
const steeringWheelState = reactive({
	dragging: false,
	pointerId: -1,
	startPointerAngle: 0,
	startWheelAngle: 0,
})
const vehicleSteeringWheelStyle = computed(() => ({
	'--steering-rotation': `${vehicleDriveInput.steering * STEERING_WHEEL_MAX_DEGREES}deg`,
}))
const vehicleSteeringAngleLabel = computed(() => `${Math.round(vehicleDriveInput.steering * STEERING_WHEEL_MAX_DEGREES)}°`)

const vehicleDriveInputFlags = reactive<VehicleDriveControlFlags>({
	forward: false,
	backward: false,
	left: false,
	right: false,
	brake: false,
})

const vehicleDriveInput = reactive<VehicleDriveInputState>({
	throttle: 0,
	steering: 0,
	brake: 0,
})

const vehicleSpeed = ref(0)
const vehicleSpeedKmh = computed(() => Math.round(vehicleSpeed.value * 3.6))

const vehicleDriveCameraRestoreState = {
	hasSnapshot: false,
	position: new THREE.Vector3(),
	target: new THREE.Vector3(),
	quaternion: new THREE.Quaternion(),
	up: new THREE.Vector3(),
	controlMode: controlMode.value as ControlMode,
	isCameraCaged: false,
	viewMode: cameraViewState.mode as CameraViewMode,
	viewTargetId: cameraViewState.watchTargetId as string | null,
}

const vehicleDriveCameraFollowState = {
	desiredPosition: new THREE.Vector3(),
	desiredTarget: new THREE.Vector3(),
	currentPosition: new THREE.Vector3(),
	currentTarget: new THREE.Vector3(),
	desiredAnchor: new THREE.Vector3(),
	currentAnchor: new THREE.Vector3(),
	anchorHoldSeconds: 0,
	lastVelocityDirection: new THREE.Vector3(0, 0, 1),
	shouldHoldAnchorForReverse: false,
	heading: new THREE.Vector3(0, 0, 1),
	initialized: false,
	localOffset: new THREE.Vector3(),
	hasLocalOffset: false,
	motionDistanceBlend: 0,
	lookaheadOffset: new THREE.Vector3(),
}

const vehicleDriveController = new VehicleDriveController(
	{
		vehicleInstances,
		rigidbodyInstances,
		nodeObjectMap,
		resolveNodeById,
		resolveRigidbodyComponent,
		resolveVehicleComponent,
		ensurePhysicsWorld,
		ensureVehicleBindingForNode,
		normalizeNodeId,
		setCameraViewState: (mode, targetId) => setCameraViewState(mode as any, targetId ?? null),
		setCameraCaging,
		updateOrbitLookTween: updateOrbitCameraLookTween,
		onResolveBehaviorToken: (token, resolution) => resolveBehaviorToken(token, resolution as any),
	},
	{
		state: vehicleDriveState as any,
		inputFlags: vehicleDriveInputFlags,
		input: vehicleDriveInput,
		cameraMode: vehicleDriveCameraMode,
		orbitMode: vehicleDriveOrbitMode,
		uiOverride: vehicleDriveUiOverride,
		promptBusy: vehicleDrivePromptBusy,
		exitBusy: vehicleDriveExitBusy,
		cameraRestoreState: vehicleDriveCameraRestoreState,
		cameraFollowState: vehicleDriveCameraFollowState,
		steeringKeyboardValue,
	},
)

function clampSteeringScalar(value: number): number {
	return THREE.MathUtils.clamp(value, -1, 1)
}

function syncVehicleSteeringValue(): void {
	const keyboardValue = steeringKeyboardValue.value
	if (keyboardValue !== 0) {
		vehicleDriveInput.steering = keyboardValue
		return
	}
	vehicleDriveInput.steering = clampSteeringScalar(steeringWheelValue.value)
}

function updateSteeringKeyboardValue(): void {
	let nextTarget = 0
	if (vehicleDriveInputFlags.left !== vehicleDriveInputFlags.right) {
		nextTarget = vehicleDriveInputFlags.left ? 1 : -1
	}
	steeringKeyboardTarget.value = nextTarget
	if (nextTarget !== 0) {
		steeringKeyboardValue.value = nextTarget
	}
}

function resetSteeringWheelValue(): void {
	steeringWheelValue.value = 0
	if (!steeringWheelState.dragging) {
		syncVehicleSteeringValue()
	}
}

function computeSteeringWheelPointerAngle(event: PointerEvent, target: HTMLElement): number {
	const bounds = target.getBoundingClientRect()
	const centerX = bounds.left + bounds.width / 2
	const centerY = bounds.top + bounds.height / 2
	const deltaX = event.clientX - centerX
	const deltaY = event.clientY - centerY
	return Math.atan2(deltaY, deltaX)
}

function setSteeringWheelDragActive(active: boolean): void {
	steeringWheelState.dragging = active
	if (!active) {
		steeringWheelState.pointerId = -1
	}
}

function handleSteeringWheelPointerDown(event: PointerEvent): void {
	if (!vehicleDriveState.active) {
		return
	}
	const wheel = steeringWheelRef.value
	if (!wheel) {
		return
	}
	const pointerAngle = computeSteeringWheelPointerAngle(event, wheel)
	steeringWheelState.startPointerAngle = pointerAngle
	steeringWheelState.startWheelAngle = steeringWheelValue.value * STEERING_WHEEL_MAX_RADIANS
	steeringWheelState.pointerId = event.pointerId
	setSteeringWheelDragActive(true)
	try {
		wheel.setPointerCapture(event.pointerId)
	} catch (_error) {
		/* noop */
	}
	event.preventDefault()
}

function applySteeringWheelAngle(angle: number): void {
	const clampedAngle = THREE.MathUtils.clamp(angle, -STEERING_WHEEL_MAX_RADIANS, STEERING_WHEEL_MAX_RADIANS)
	steeringWheelValue.value = clampSteeringScalar(clampedAngle / STEERING_WHEEL_MAX_RADIANS)
	syncVehicleSteeringValue()
}

function handleSteeringWheelPointerMove(event: PointerEvent): void {
	if (!steeringWheelState.dragging || event.pointerId !== steeringWheelState.pointerId) {
		return
	}
	const wheel = steeringWheelRef.value
	if (!wheel) {
		return
	}
	const currentAngle = computeSteeringWheelPointerAngle(event, wheel)
	const delta = currentAngle - steeringWheelState.startPointerAngle
	const nextAngle = steeringWheelState.startWheelAngle + delta
	applySteeringWheelAngle(nextAngle)
	if (event.cancelable) {
		event.preventDefault()
	}
}

function releaseSteeringWheelPointer(event?: PointerEvent): void {
	const wheel = steeringWheelRef.value
	if (wheel && steeringWheelState.pointerId !== -1) {
		try {
			wheel.releasePointerCapture(steeringWheelState.pointerId)
		} catch (_error) {
			/* noop */
		}
	}
	if (event?.cancelable) {
		event.preventDefault()
	}
	setSteeringWheelDragActive(false)
}

function handleSteeringWheelPointerUp(event: PointerEvent): void {
	if (event.pointerId !== steeringWheelState.pointerId) {
		return
	}
	releaseSteeringWheelPointer(event)
}

function approachSteeringValue(current: number, target: number, rate: number, delta: number): number {
	if (!Number.isFinite(current) || !Number.isFinite(target) || !Number.isFinite(delta) || rate <= 0 || delta <= 0) {
		return target
	}
	const difference = target - current
	if (Math.abs(difference) <= 1e-4) {
		return target
	}
	const maxStep = rate * delta
	if (Math.abs(difference) <= maxStep) {
		return target
	}
	return current + Math.sign(difference) * maxStep
}

function updateSteeringAutoCenter(delta: number): void {
	if (!Number.isFinite(delta) || delta <= 0) {
		return
	}
	let steeringChanged = false
	if (!steeringWheelState.dragging) {
		const nextWheel = approachSteeringValue(steeringWheelValue.value, 0, STEERING_WHEEL_RETURN_SPEED, delta)
		if (nextWheel !== steeringWheelValue.value) {
			steeringWheelValue.value = nextWheel
			steeringChanged = true
		}
	}
	const target = steeringKeyboardTarget.value
	const keyboardRate = target === 0 ? STEERING_KEYBOARD_RETURN_SPEED : STEERING_KEYBOARD_CATCH_SPEED
	const nextKeyboard = approachSteeringValue(steeringKeyboardValue.value, target, keyboardRate, delta)
	if (nextKeyboard !== steeringKeyboardValue.value) {
		steeringKeyboardValue.value = clampSteeringScalar(nextKeyboard)
		steeringChanged = true
	}
	if (steeringChanged) {
		syncVehicleSteeringValue()
	}
}

const vehicleDriveCameraToggleConfig = computed(() => {
	const followActive = vehicleDriveCameraMode.value === 'follow'
	return followActive
		? { icon: 'mdi-crosshairs-off', label: 'Stop following' }
		: { icon: 'mdi-crosshairs-gps', label: 'Follow driving' }
})

function setVehicleDriveUiOverride(mode: 'auto' | 'show' | 'hide'): void {
	vehicleDriveUiOverride.value = mode
}

function setVehicleDriveOrbitMode(mode: VehicleDriveOrbitMode): void {
	if (vehicleDriveOrbitMode.value === mode) {
		return
	}
	vehicleDriveOrbitMode.value = mode
	if (vehicleDriveState.active && controlMode.value === 'third-person') {
		syncVehicleDriveCameraMode()
	}
}

function toggleVehicleDriveOrbitMode(): void {
	const nextMode: VehicleDriveOrbitMode = vehicleDriveOrbitMode.value === 'follow' ? 'free' : 'follow'
	if (nextMode === 'follow') {
		resetVehicleFollowLocalOffset()
	}
	setVehicleDriveOrbitMode(nextMode)
}

function resolveGuideboardComponent(
	node: SceneNode | null | undefined,
): SceneNodeComponentState<GuideboardComponentProps> | null {
	const component = node?.components?.[GUIDEBOARD_COMPONENT_TYPE] as
		SceneNodeComponentState<GuideboardComponentProps> | undefined
	if (!component || !component.enabled) {
		return null
	}
	return component
}

function resolveGuideboardInitialVisibility(node: SceneNode | null | undefined): boolean | null {
	const component = resolveGuideboardComponent(node)
	if (!component) {
		return null
	}
	const props = component.props as GuideboardComponentProps | undefined
	return props?.initiallyVisible === true
}

function resolveRigidbodyComponent(
	node: SceneNode | null | undefined,
): SceneNodeComponentState<RigidbodyComponentProps> | null {
	return resolveEnabledComponentState<RigidbodyComponentProps>(node, RIGIDBODY_COMPONENT_TYPE)
}

function resolveVehicleComponent(
	node: SceneNode | null | undefined,
): SceneNodeComponentState<VehicleComponentProps> | null {
	return resolveEnabledComponentState<VehicleComponentProps>(node, VEHICLE_COMPONENT_TYPE)
}

function resolveAutoTourComponent(
	node: SceneNode | null | undefined,
): SceneNodeComponentState<AutoTourComponentProps> | null {
	return resolveEnabledComponentState<AutoTourComponentProps>(node, AUTO_TOUR_COMPONENT_TYPE)
}

const autoTourRuntime = createAutoTourRuntime({
	iterNodes: () => previewNodeMap.values(),
	resolveNodeById,
	nodeObjectMap,
	vehicleInstances,
	isManualDriveActive: () => vehicleDriveState.active,
	requiresExplicitStart: true,
	onDockRequestedPause: (nodeId, payload) => {
		autoTourPausedIsTerminal.value = payload.terminal === true
		autoTourPausedNodeId.value = nodeId
		if (autoTourPaused.value) {
			return
		}
		autoTourPaused.value = true
		applyAutoTourPauseForActiveNodes()
	},
	stopNodeMotion: (nodeId) => {
		const entry = rigidbodyInstances.get(nodeId) ?? null
		if (!entry) {
			return
		}
		try {
			if (entry.object) {
				syncSharedBodyFromObject(entry.body, entry.object, entry.orientationAdjustment)
			}
			entry.body.velocity.set(0, 0, 0)
			entry.body.angularVelocity.set(0, 0, 0)
			entry.body.sleep?.()
		} catch {
			// Best-effort; body may be disposed/resetting.
		}
	},
	onNodeObjectTransformUpdated: (_nodeId, object) => {
		syncInstancedTransform(object)
	},
})

function resolveLodComponent(
	node: SceneNode | null | undefined,
): SceneNodeComponentState<LodComponentProps> | null {
	const component = node?.components?.[LOD_COMPONENT_TYPE] as
		SceneNodeComponentState<LodComponentProps> | undefined
	if (!component || !component.enabled) {
		return null
	}
	return component
}

function resolveDesiredLodAssetId(node: SceneNode, object: THREE.Object3D): string | null {
	const baseAssetId = typeof node.sourceAssetId === 'string' ? node.sourceAssetId : null
	const component = resolveLodComponent(node)
	if (!component) {
		return baseAssetId
	}

	const props = clampLodComponentProps(component.props)
	const levels = props.levels
	if (!levels.length) {
		return baseAssetId
	}

	object.getWorldPosition(instancedCullingWorldPosition)
	const distance = instancedCullingWorldPosition.distanceTo(camera?.position ?? instancedCullingWorldPosition)

	let chosen: (typeof levels)[number] | null = null
	for (let i = levels.length - 1; i >= 0; i -= 1) {
		const candidate = levels[i]
		if (candidate && distance >= candidate.distance) {
			chosen = candidate
			break
		}
	}
	const chosenModelAssetId = chosen && typeof chosen.modelAssetId === 'string' ? chosen.modelAssetId : null
	return chosenModelAssetId ?? baseAssetId
}

const pendingLodModelLoads = new Map<string, Promise<void>>()

async function ensureModelObjectCached(assetId: string, sampleNode: SceneNode | null): Promise<void> {
	if (!assetId) {
		return
	}
	if (getCachedModelObject(assetId)) {
		ensureInstancedMeshesRegistered(assetId)
		return
	}
	if (pendingLodModelLoads.has(assetId)) {
		await pendingLodModelLoads.get(assetId)
		return
	}

	const task = (async () => {
		if (!editorResourceCache) {
			return
		}
		await ensureModelInstanceGroup(assetId, sampleNode, editorResourceCache)
		ensureInstancedMeshesRegistered(assetId)
	})()
		.catch((error) => {
			console.warn('[ScenePreview] Failed to preload LOD model asset', assetId, error)
		})
		.finally(() => {
			pendingLodModelLoads.delete(assetId)
		})

	pendingLodModelLoads.set(assetId, task)
	await task
}

function applyInstancedLodSwitch(nodeId: string, object: THREE.Object3D, assetId: string): void {
	const cached = getCachedModelObject(assetId)
	if (!cached) {
		const node = resolveNodeById(nodeId)
		void ensureModelObjectCached(assetId, node)
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

function ensureInstancedCullingVisualizationResources(required: number): void {
	if (!scene) {
		return
	}
	if (!instancedCullingVisualizationGroup) {
		instancedCullingVisualizationGroup = new THREE.Group()
		instancedCullingVisualizationGroup.name = 'InstancedCullingVisualization'
		instancedCullingVisualizationGroup.renderOrder = 999
		scene.add(instancedCullingVisualizationGroup)
	}
	if (!instancedCullingVisualizationGeometry) {
		instancedCullingVisualizationGeometry = new THREE.BoxGeometry(1, 1, 1)
	}
	if (!instancedCullingVisualizationMaterial) {
		instancedCullingVisualizationMaterial = new THREE.MeshBasicMaterial({
			wireframe: true,
			transparent: true,
			opacity: 0.9,
			depthTest: false,
			depthWrite: false,
			vertexColors: true,
		})
	}

	const nextCapacity = Math.max(1, required)
	if (instancedCullingVisualizationMesh && instancedCullingVisualizationCapacity >= nextCapacity) {
		return
	}

	if (instancedCullingVisualizationMesh) {
		instancedCullingVisualizationGroup.remove(instancedCullingVisualizationMesh)
		instancedCullingVisualizationMesh.dispose()
		instancedCullingVisualizationMesh = null
	}

	instancedCullingVisualizationCapacity = nextCapacity
	instancedCullingVisualizationMesh = new THREE.InstancedMesh(
		instancedCullingVisualizationGeometry,
		instancedCullingVisualizationMaterial,
		instancedCullingVisualizationCapacity,
	)
	instancedCullingVisualizationMesh.name = 'InstancedCullingBoxes'
	instancedCullingVisualizationMesh.frustumCulled = false
	instancedCullingVisualizationMesh.count = 0
	instancedCullingVisualizationMesh.renderOrder = 999
	instancedCullingVisualizationGroup.add(instancedCullingVisualizationMesh)
}

function disposeInstancedCullingVisualization(): void {
	if (instancedCullingVisualizationMesh) {
		instancedCullingVisualizationMesh.parent?.remove(instancedCullingVisualizationMesh)
		instancedCullingVisualizationMesh.dispose()
		instancedCullingVisualizationMesh = null
	}
	instancedCullingVisualizationCapacity = 0
	if (instancedCullingVisualizationGroup) {
		instancedCullingVisualizationGroup.parent?.remove(instancedCullingVisualizationGroup)
		instancedCullingVisualizationGroup.clear()
		instancedCullingVisualizationGroup = null
	}
	instancedCullingVisualizationMaterial?.dispose?.()
	instancedCullingVisualizationMaterial = null
	instancedCullingVisualizationGeometry?.dispose?.()
	instancedCullingVisualizationGeometry = null
}

function updateInstancedCullingVisualization(
	candidateIds: string[],
	candidateObjects: Map<string, THREE.Object3D>,
	visibleIds: Set<string>,
): void {
	if (!isInstancedCullingVisualizationVisible.value) {
		return
	}
	ensureInstancedCullingVisualizationResources(candidateIds.length)
	const mesh = instancedCullingVisualizationMesh
	if (!mesh) {
		return
	}
	mesh.count = candidateIds.length

	for (let i = 0; i < candidateIds.length; i += 1) {
		const nodeId = candidateIds[i]!
		const object = candidateObjects.get(nodeId)
		if (!object) {
			continue
		}
		object.updateMatrixWorld(true)
		object.matrixWorld.decompose(instancedPositionHelper, instancedQuaternionHelper, instancedCullingVisualizationScaleHelper)

		const bounds = object.userData?.instancedBounds as
			| { min?: [number, number, number]; max?: [number, number, number] }
			| undefined

		if (bounds?.min && bounds?.max) {
			instancedCullingVisualizationCenterLocalHelper
				.set(
					(bounds.min[0] ?? 0) + (bounds.max[0] ?? 0),
					(bounds.min[1] ?? 0) + (bounds.max[1] ?? 0),
					(bounds.min[2] ?? 0) + (bounds.max[2] ?? 0),
				)
				.multiplyScalar(0.5)
			instancedCullingVisualizationSizeHelper.set(
				(bounds.max[0] ?? 0) - (bounds.min[0] ?? 0),
				(bounds.max[1] ?? 0) - (bounds.min[1] ?? 0),
				(bounds.max[2] ?? 0) - (bounds.min[2] ?? 0),
			)
		} else {
			const radius = resolveInstancedProxyRadius(object)
			const size = Math.max(0, radius * 2)
			instancedCullingVisualizationCenterLocalHelper.set(0, 0, 0)
			instancedCullingVisualizationSizeHelper.set(size, size, size)
		}

		instancedCullingVisualizationCenterWorldHelper
			.copy(instancedCullingVisualizationCenterLocalHelper)
			.applyMatrix4(object.matrixWorld)

		instancedCullingVisualizationBoxScaleHelper.set(
			instancedCullingVisualizationSizeHelper.x * instancedCullingVisualizationScaleHelper.x,
			instancedCullingVisualizationSizeHelper.y * instancedCullingVisualizationScaleHelper.y,
			instancedCullingVisualizationSizeHelper.z * instancedCullingVisualizationScaleHelper.z,
		)
		instancedMatrixHelper.compose(
			instancedCullingVisualizationCenterWorldHelper,
			instancedQuaternionHelper,
			instancedCullingVisualizationBoxScaleHelper,
		)
		mesh.setMatrixAt(i, instancedMatrixHelper)
		mesh.setColorAt(
			i,
			visibleIds.has(nodeId) ? instancedCullingVisualizationVisibleColor : instancedCullingVisualizationCulledColor,
		)
	}
	mesh.instanceMatrix.needsUpdate = true
	if (mesh.instanceColor) {
		mesh.instanceColor.needsUpdate = true
	}
}

function updateInstancedCullingAndLod(): void {
	if (!camera) {
		return
	}

	camera.updateMatrixWorld(true)
	instancedCullingProjView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
	instancedCullingFrustum.setFromProjectionMatrix(instancedCullingProjView)

	// Visualization (and counters) are driven by all instanced proxy nodes, even if they don't have an LOD component.
	// This makes the debug overlay useful in scenes that don't opt into LOD-based culling.
	if (isInstancedCullingVisualizationVisible.value) {
		const visualizationIds: string[] = []
		const visualizationObjects = new Map<string, THREE.Object3D>()
		nodeObjectMap.forEach((object, nodeId) => {
			if (!object?.userData?.instancedAssetId) {
				return
			}
			visualizationIds.push(nodeId)
			visualizationObjects.set(nodeId, object)
		})
		visualizationIds.sort()
		const visualizationVisibleIds = new Set<string>()

		for (let i = 0; i < visualizationIds.length; i += 1) {
			const nodeId = visualizationIds[i]!
			const object = visualizationObjects.get(nodeId)
			if (!object) {
				continue
			}
			object.updateMatrixWorld(true)

			const bounds = object.userData?.instancedBounds as
				| { min?: [number, number, number]; max?: [number, number, number] }
				| undefined

			if (bounds?.min && bounds?.max) {
				instancedCullingBox.min.set(bounds.min[0] ?? 0, bounds.min[1] ?? 0, bounds.min[2] ?? 0)
				instancedCullingBox.max.set(bounds.max[0] ?? 0, bounds.max[1] ?? 0, bounds.max[2] ?? 0)
				instancedCullingBox.getCenter(instancedCullingWorldPosition)
				instancedCullingWorldPosition.applyMatrix4(object.matrixWorld)
			} else {
				object.getWorldPosition(instancedCullingWorldPosition)
			}

			object.matrixWorld.decompose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper)
			const scale = Math.max(instancedScaleHelper.x, instancedScaleHelper.y, instancedScaleHelper.z)
			const baseRadius = resolveInstancedProxyRadius(object)
			const radius = Number.isFinite(scale) && scale > 0 ? baseRadius * scale : baseRadius

			instancedCullingSphere.center.copy(instancedCullingWorldPosition)
			instancedCullingSphere.radius = radius
			if (instancedCullingFrustum.intersectsSphere(instancedCullingSphere)) {
				visualizationVisibleIds.add(nodeId)
			}
		}

		updateInstancedCullingVisualization(visualizationIds, visualizationObjects, visualizationVisibleIds)
	}

	const candidateIds: string[] = []
	const candidateObjects = new Map<string, THREE.Object3D>()
	nodeObjectMap.forEach((object, nodeId) => {
		if (!object?.userData?.instancedAssetId) {
			return
		}
		const node = resolveNodeById(nodeId)
		if (!node) {
			return
		}
		const lodComponent = resolveLodComponent(node)
		if (!lodComponent) {
			return
		}
		const props = clampLodComponentProps(lodComponent.props)
		if (props.enableCulling === false) {
			return
		}
		candidateIds.push(nodeId)
		candidateObjects.set(nodeId, object)
	})

	candidateIds.sort()
	instancedLodFrustumCuller.setIds(candidateIds)
	const visibleIds = instancedLodFrustumCuller.updateAndQueryVisible(instancedCullingFrustum, (id, centerTarget) => {
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

	instancedLodTotalCount.value = candidateIds.length
	instancedLodVisibleCount.value = visibleIds.size
	const scatterStats = terrainScatterRuntime.getInstanceStats()
	terrainScatterTotalCount.value = scatterStats.total
	terrainScatterVisibleCount.value = scatterStats.visible
	if (isInstancingDebugVisible.value) {
		let totalMeshes = 0
		let activeMeshes = 0
		let instanceCount = 0
		for (let i = 0; i < instancedMeshes.length; i += 1) {
			const mesh = instancedMeshes[i]
			if (!mesh) {
				continue
			}
			totalMeshes += 1
			if (mesh.count > 0) {
				activeMeshes += 1
			}
			instanceCount += Math.max(0, Math.trunc(mesh.count))
		}
		instancingDebug.instancedMesh = totalMeshes
		instancingDebug.instancedActive = activeMeshes
		instancingDebug.instancedInstanceCount = instanceCount
		instancingDebug.lodTotal = instancedLodTotalCount.value
		instancingDebug.lodVisible = instancedLodVisibleCount.value
		instancingDebug.scatterTotal = terrainScatterTotalCount.value
		instancingDebug.scatterVisible = terrainScatterVisibleCount.value
	}

	candidateIds.forEach((nodeId) => {
		const object = candidateObjects.get(nodeId)
		if (!object) {
			return
		}
		const node = resolveNodeById(nodeId)
		if (!node) {
			return
		}
		const isVisible = visibleIds.has(nodeId)
		if (!isVisible) {
			if (object.userData.__harmonyCulled !== true) {
				object.userData.__harmonyCulled = true
			}
			instancedMatrixCache.delete(nodeId)
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
			void ensureModelObjectCached(desiredAssetId, node)
			return
		}
		syncInstancedTransform(object)
	})
}

function extractRigidbodyShape(
	component: SceneNodeComponentState<RigidbodyComponentProps> | null,
): RigidbodyPhysicsShape | null {
	if (!component) {
		return null
	}
	const payload = component.metadata?.[RIGIDBODY_METADATA_KEY] as RigidbodyComponentMetadata | undefined
	return payload?.shape ?? null
}

function normalizeHexColor(value: unknown, fallback: string): string {
	if (typeof value === 'string') {
		const sanitized = value.trim()
		if (HEX_COLOR_PATTERN.test(sanitized)) {
			return `#${sanitized.slice(1).toLowerCase()}`
		}
	}
	return fallback
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	const numeric = typeof value === 'number' ? value : Number(value)
	if (!Number.isFinite(numeric)) {
		return fallback
	}
	if (numeric < min) {
		return min
	}
	if (numeric > max) {
		return max
	}
	return numeric
}

function normalizeAssetId(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null
	}
	const trimmed = value.trim()
	return trimmed.length ? trimmed : null
}

function normalizeNodeId(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null
	}
	const trimmed = value.trim()
	return trimmed.length ? trimmed : null
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectNodesByAssetId(nodes: SceneNode[] | undefined | null): Map<string, SceneNode[]> {
	const map = new Map<string, SceneNode[]>()
	if (!Array.isArray(nodes)) {
		return map
	}
	const stack: SceneNode[] = [...nodes]
	while (stack.length) {
		const node = stack.pop()
		if (!node) {
			continue
		}
		if (node.sourceAssetId) {
			if (!map.has(node.sourceAssetId)) {
				map.set(node.sourceAssetId, [])
			}
			map.get(node.sourceAssetId)!.push(node)
		}
		if (Array.isArray(node.children) && node.children.length) {
			stack.push(...node.children)
		}
	}
	return map
}

function serializeBoundingBox(box: THREE.Box3): { min: [number, number, number]; max: [number, number, number] } {
	return {
		min: [box.min.x, box.min.y, box.min.z],
		max: [box.max.x, box.max.y, box.max.z],
	}
}

async function ensureModelInstanceGroup(
	assetId: string,
	sampleNode: SceneNode | null,
	resourceCache: ResourceCache,
): Promise<ModelInstanceGroup | null> {
	if (!assetId) {
		return null
	}
	const cached = getCachedModelObject(assetId)
	if (cached) {
		return cached
	}
	try {
		const group = await getOrLoadModelObject(assetId, async () => {
			const object = await loadNodeObject(resourceCache, assetId, sampleNode?.importMetadata ?? null)
			if (!object) {
				throw new Error('Instanced mesh loader returned empty object')
			}
			return object
		})
		return group
	} catch (error) {
		console.warn('[ScenePreview] Failed to prepare instanced model', assetId, error)
		return null
	}
}

function createInstancedPreviewProxy(node: SceneNode, group: ModelInstanceGroup): THREE.Object3D | null {
	if (!node.sourceAssetId || node.sourceAssetId !== group.assetId) {
		return null
	}
	releaseModelInstance(node.id)
	const binding = allocateModelInstance(group.assetId, node.id)
	if (!binding) {
		return null
	}
	const proxy = new THREE.Object3D()
	proxy.name = node.name ?? group.object.name ?? 'Instanced Model'
	proxy.userData = {
		...(proxy.userData ?? {}),
		nodeId: node.id,
		instanced: true,
		instancedAssetId: group.assetId,
		instancedBounds: serializeBoundingBox(group.boundingBox),
	}
	updateNodeTransfrom(proxy, node)
	return proxy
}

async function prepareInstancedNodesForDocument(
	document: SceneJsonExportDocument,
	pending: Map<string, THREE.Object3D>,
	resourceCache: ResourceCache,
	options: { includeNodeIds?: Set<string>; skipNodeIds?: Set<string> } = {},
): Promise<void> {
	const includeNodeIds = options.includeNodeIds ?? null
	const skipNodeIds = options.skipNodeIds ?? null
	const grouped = collectNodesByAssetId(document.nodes ?? [])
	if (!grouped.size) {
		return
	}
	const tasks: Promise<void>[] = []
	grouped.forEach((nodes, assetId) => {
		const filteredNodes = nodes.filter((node) => {
			if (includeNodeIds && !includeNodeIds.has(node.id)) {
				return false
			}
			if (skipNodeIds && skipNodeIds.has(node.id)) {
				return false
			}
			return true
		})
		if (!filteredNodes.length) {
			return
		}
		tasks.push((async () => {
			if (!filteredNodes.length) {
				return
			}
			const group = await ensureModelInstanceGroup(assetId, filteredNodes[0] ?? null, resourceCache)
			if (!group || !group.meshes.length) {
				return
			}
			ensureInstancedMeshesRegistered(assetId)
			filteredNodes.forEach((node) => {
				const pendingObject = pending.get(node.id)
				if (pendingObject) {
					pendingObject.parent?.remove(pendingObject)
					disposeObjectResources(pendingObject)
					pending.delete(node.id)
				}
				const existingRuntime = nodeObjectMap.get(node.id) ?? null
				if (existingRuntime) {
					const existingAsset = existingRuntime.userData?.instancedAssetId as string | undefined
					if (existingAsset === assetId) {
						syncInstancedTransform(existingRuntime)
						return
					}
					removeNodeSubtree(node.id)
				}
				const proxy = createInstancedPreviewProxy(node, group)
				if (proxy) {
					pending.set(node.id, proxy)
				}
			})
		})())
	})
	await Promise.all(tasks)
}


function resolveGroundMeshObject(nodeId: string): THREE.Mesh | null {
	const container = nodeObjectMap.get(nodeId)
	if (!container) {
		return null
	}
	const directMesh = container as THREE.Mesh
	if (directMesh.isMesh) {
		return directMesh
	}
	let found: THREE.Mesh | null = null
	container.traverse((child) => {
		if (found) {
			return
		}
		const mesh = child as THREE.Mesh
		if (mesh?.isMesh) {
			found = mesh
		}
	})
	return found
}

function releaseTerrainScatterInstances(): void {
	terrainScatterRuntime.dispose()
}

async function syncTerrainScatterInstances(
	document: SceneJsonExportDocument,
	resourceCache: ResourceCache | null,
): Promise<void> {
	releaseTerrainScatterInstances()
	if (!resourceCache) {
		return
	}
	await terrainScatterRuntime.sync(document, resourceCache, resolveGroundMeshObject)
}

function attachInstancedMesh(mesh: THREE.InstancedMesh) {
	if (instancedMeshes.includes(mesh)) {
		return
	}
	mesh.layers.enable(LAYER_BEHAVIOR_INTERACTIVE)
	// InstancedMesh with shared geometry may have an undersized default bounding volume;
	// frustum culling can incorrectly hide instances far from the origin.
	mesh.frustumCulled = false
	instancedMeshes.push(mesh)
	instancedMeshGroup.add(mesh)
}

function clearInstancedMeshes() {
	instancedMeshes.splice(0, instancedMeshes.length).forEach((mesh) => {
		instancedMeshGroup.remove(mesh);
	});
	// Clear shared dirty tracking
	clearInstancedBounds();

}

function extractEnvironmentSettingsFromNodes(
	sourceNodes: SceneNode[] | null | undefined,
): EnvironmentSettings | null {
	if (!Array.isArray(sourceNodes) || !sourceNodes.length) {
		return null
	}
	const stack: SceneNode[] = [...sourceNodes]
	while (stack.length) {
		const node = stack.pop()
		if (!node) {
			continue
		}
		if (node.id === ENVIRONMENT_NODE_ID || node.nodeType === 'Environment') {
			const payload = isPlainRecord(node.userData)
				? ((node.userData as Record<string, unknown>).environment as
						| EnvironmentSettings
						| Partial<EnvironmentSettings>
						| null
						| undefined)
				: null
			return cloneEnvironmentSettingsLocal(payload ?? DEFAULT_ENVIRONMENT_SETTINGS)
		}
		if (Array.isArray(node.children) && node.children.length) {
			stack.push(...node.children)
		}
	}
	return null
}

function cloneEnvironmentSettingsLocal(
	source?: Partial<EnvironmentSettings> | EnvironmentSettings | null,
): EnvironmentSettings {
	const backgroundSource = source?.background ?? null
	const environmentMapSource = source?.environmentMap ?? null

	let backgroundMode: EnvironmentBackgroundMode = 'skybox'
	if (backgroundSource?.mode === 'hdri') {
		backgroundMode = 'hdri'
	} else if (backgroundSource?.mode === 'solidColor') {
		backgroundMode = 'solidColor'
	}
	const environmentMapMode = environmentMapSource?.mode === 'custom' ? 'custom' : 'skybox'
	let fogMode: EnvironmentSettings['fogMode'] = 'none'
	if (source?.fogMode === 'linear') {
		fogMode = 'linear'
	} else if (source?.fogMode === 'exp') {
		fogMode = 'exp'
	}

	const fogNear = clampNumber(source?.fogNear, 0, 100000, DEFAULT_ENVIRONMENT_FOG_NEAR)
	const fogFar = clampNumber(source?.fogFar, 0, 100000, DEFAULT_ENVIRONMENT_FOG_FAR)
	const normalizedFogFar = fogFar > fogNear ? fogFar : fogNear + 0.001

	return {
		background: {
			mode: backgroundMode,
			solidColor: normalizeHexColor(backgroundSource?.solidColor, DEFAULT_ENVIRONMENT_BACKGROUND_COLOR),
			hdriAssetId: normalizeAssetId(backgroundSource?.hdriAssetId ?? null),
		},
		ambientLightColor: normalizeHexColor(source?.ambientLightColor, DEFAULT_ENVIRONMENT_AMBIENT_COLOR),
		ambientLightIntensity: clampNumber(
			source?.ambientLightIntensity,
			0,
			10,
			DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY,
		),
		fogMode,
		fogColor: normalizeHexColor(source?.fogColor, DEFAULT_ENVIRONMENT_FOG_COLOR),
		fogDensity: clampNumber(source?.fogDensity, 0, 5, DEFAULT_ENVIRONMENT_FOG_DENSITY),
		fogNear,
		fogFar: normalizedFogFar,
		environmentMap: {
			mode: environmentMapMode,
			hdriAssetId: normalizeAssetId(environmentMapSource?.hdriAssetId ?? null),
		},
		gravityStrength: clampNumber(source?.gravityStrength, 0, 100, DEFAULT_ENVIRONMENT_GRAVITY),
		collisionRestitution: clampNumber(
			source?.collisionRestitution,
			0,
			1,
			DEFAULT_ENVIRONMENT_RESTITUTION,
		),
		collisionFriction: clampNumber(
			source?.collisionFriction,
			0,
			1,
			DEFAULT_ENVIRONMENT_FRICTION,
		),
	}
}

function resolveDocumentEnvironment(document: SceneJsonExportDocument | null | undefined): EnvironmentSettings {
	if (!document) {
		return cloneEnvironmentSettingsLocal(DEFAULT_ENVIRONMENT_SETTINGS)
	}
	const payload = (document as SceneJsonExportDocument & {
		environment?: Partial<EnvironmentSettings> | EnvironmentSettings | null
	}).environment
	if (payload) {
		return cloneEnvironmentSettingsLocal(payload)
	}
	const derived = extractEnvironmentSettingsFromNodes(document.nodes)
	if (derived) {
		return derived
	}
	return cloneEnvironmentSettingsLocal(DEFAULT_ENVIRONMENT_SETTINGS)
}

function resolveNodeIdFromObject(object: THREE.Object3D | null | undefined): string | null {
	let candidate: THREE.Object3D | null | undefined = object ?? null
	while (candidate) {
		const nodeId = candidate.userData?.nodeId as string | undefined
		if (nodeId) {
			return nodeId
		}
		candidate = candidate.parent
	}
	return null
}

function resolveNodeIdFromIntersection(intersection: THREE.Intersection): string | null {
	if (typeof intersection.instanceId === 'number' && intersection.instanceId >= 0) {
		const mesh = intersection.object as THREE.InstancedMesh
		const instancedNodeId = findNodeIdForInstance(mesh, intersection.instanceId)
		if (instancedNodeId) {
			return instancedNodeId
		}
	}
	return resolveNodeIdFromObject(intersection.object)
}

function attachRuntimeForNode(nodeId: string, object: THREE.Object3D): void {
	const nodeState = resolveNodeById(nodeId)
	if (!nodeState) {
		return
	}
	previewComponentManager.attachRuntime(nodeState, object)
}

function sanitizeSkyboxSettings(input: SceneSkyboxSettings): SceneSkyboxSettings {
	const ensureNumber = (candidate: unknown, fallback: number) => {
		return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback
	}
	const sanitizedClouds = sanitizeCloudSettings(input.clouds)
	return {
		presetId: input.presetId ?? DEFAULT_SKYBOX_SETTINGS.presetId,
		exposure: ensureNumber(input.exposure, DEFAULT_SKYBOX_SETTINGS.exposure),
		turbidity: ensureNumber(input.turbidity, DEFAULT_SKYBOX_SETTINGS.turbidity),
		rayleigh: ensureNumber(input.rayleigh, DEFAULT_SKYBOX_SETTINGS.rayleigh),
		mieCoefficient: ensureNumber(input.mieCoefficient, DEFAULT_SKYBOX_SETTINGS.mieCoefficient),
		mieDirectionalG: ensureNumber(input.mieDirectionalG, DEFAULT_SKYBOX_SETTINGS.mieDirectionalG),
		elevation: ensureNumber(input.elevation, DEFAULT_SKYBOX_SETTINGS.elevation),
		azimuth: ensureNumber(input.azimuth, DEFAULT_SKYBOX_SETTINGS.azimuth),
		clouds: sanitizedClouds ?? null,
	}
}

function resolveDocumentSkybox(document: SceneJsonExportDocument | null | undefined): SceneSkyboxSettings | null {
	if (!document) {
		return null
	}
	return sanitizeSkyboxSettings(document.skybox)
}

function resetAssetResolutionCaches(): void {
	clearAssetObjectUrlCache()
}

function clearAssetObjectUrlCache(): void {
	assetObjectUrlCache.forEach((url) => {
		if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
			try {
				URL.revokeObjectURL(url)
			} catch (error) {
				console.warn('[ScenePreview] Failed to revoke object URL', error)
			}
		}
	})
	assetObjectUrlCache.clear()
}

const EXTERNAL_ASSET_PATTERN = /^(https?:)?\/\//i

function isExternalAssetReference(value: string): boolean {
	return EXTERNAL_ASSET_PATTERN.test(value)
}

async function acquirePreviewAssetEntry(assetId: string): Promise<AssetCacheEntry | null> {
	const trimmed = assetId.trim()
	if (!trimmed.length) {
		return null
	}
	const cache = editorResourceCache
	if (!cache) {
		return null
	}
	try {
		return await cache.acquireAssetEntry(trimmed)
	} catch (error) {
		console.warn('[ScenePreview] Failed to acquire asset entry', trimmed, error)
		return null
	}
}

function getOrCreateObjectUrl(assetId: string, data: ArrayBuffer | Blob, mimeHint?: string): string {
	const cached = assetObjectUrlCache.get(assetId)
	if (cached) {
		return cached
	}
	const mimeType = mimeHint ?? inferMimeTypeFromAssetId(assetId) ?? 'application/octet-stream'
	const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType })
	const url = URL.createObjectURL(blob)
	assetObjectUrlCache.set(assetId, url)
	return url
}

function buildResolvedAssetUrl(assetId: string, entry: AssetCacheEntry | null): ResolvedAssetUrl | null {
	if (!entry) {
		return null
	}
	const mimeType = entry.mimeType ?? inferMimeTypeFromAssetId(assetId)
	if (entry.downloadUrl) {
		return { url: entry.downloadUrl, mimeType }
	}
	if (entry.blobUrl) {
		return { url: entry.blobUrl, mimeType }
	}
	if (entry.blob) {
		const url = getOrCreateObjectUrl(assetId, entry.blob, mimeType ?? undefined)
		return { url, mimeType }
	}
	return null
}

async function resolveAssetUrlFromCache(assetId: string): Promise<ResolvedAssetUrl | null> {
	const entry = await acquirePreviewAssetEntry(assetId)
	return buildResolvedAssetUrl(assetId, entry)
}

async function resolveAssetUrlReference(candidate: string): Promise<ResolvedAssetUrl | null> {
	const trimmed = candidate.trim()
	if (!trimmed.length) {
		return null
	}
	if (trimmed.startsWith('data:') || isExternalAssetReference(trimmed)) {
		return { url: trimmed, mimeType: inferMimeTypeFromUrl(trimmed) }
	}
	const assetId = trimmed.startsWith('asset://') ? trimmed.slice('asset://'.length) : trimmed
	return await resolveAssetUrlFromCache(assetId)
}



function inferMimeTypeFromUrl(url: string): string | null {
	const cleaned = url.split('?')[0]?.split('#')[0] ?? url
	return inferMimeTypeFromAssetId(cleaned)
}

function normalizeDisplayBoardAssetId(candidate: string): string {
	const trimmed = candidate.trim()
	if (!trimmed.length) {
		return ''
	}
	const withoutScheme = trimmed.startsWith('asset://') ? trimmed.slice('asset://'.length) : trimmed
	return withoutScheme.trim()
}

async function resolveDisplayBoardMediaSource(candidate: string): Promise<ResolvedAssetUrl | null> {
	const trimmed = candidate.trim()
	if (!trimmed.length) {
		return null
	}
	if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
		return { url: trimmed, mimeType: inferMimeTypeFromUrl(trimmed) }
	}
	const assetId = normalizeDisplayBoardAssetId(trimmed)
	if (!assetId.length) {
		return null
	}
	return await resolveAssetUrlFromCache(assetId)
}

;(globalThis as typeof globalThis & { [DISPLAY_BOARD_RESOLVER_KEY]?: typeof resolveDisplayBoardMediaSource })[
	DISPLAY_BOARD_RESOLVER_KEY
] = resolveDisplayBoardMediaSource

const formattedLastUpdate = computed(() => {
	if (!lastUpdateTime.value) {
		return ''
	}
	try {
		const date = new Date(lastUpdateTime.value)
		return date.toLocaleString()
	} catch (_error) {
		return lastUpdateTime.value
	}
})

const lanternTotalSlides = computed(() => lanternSlides.value.length)
const lanternCurrentSlide = computed(() => {
	const index = lanternActiveSlideIndex.value
	if (index < 0 || index >= lanternSlides.value.length) {
		return null
	}
	return lanternSlides.value[index] ?? null
})
const lanternHasMultipleSlides = computed(() => lanternTotalSlides.value > 1)
const lanternCurrentSlideImage = computed(() => {
	const slide = lanternCurrentSlide.value
	if (!slide?.imageAssetId) {
		return null
	}
	const assetId = slide.imageAssetId.trim()
	if (!assetId.length) {
		return null
	}
	return lanternImageState[assetId]?.url ?? null
})
const lanternCurrentSlideTextState = computed(() => {
	const slide = lanternCurrentSlide.value
	if (!slide || !slide.descriptionAssetId) {
		return null
	}
	const assetId = slide.descriptionAssetId.trim()
	if (!assetId.length) {
		return null
	}
	return getLanternTextState(assetId)
})
const lanternCurrentSlideDescription = computed(() => {
	const slide = lanternCurrentSlide.value
	if (!slide) {
		return ''
	}
	if (slide.descriptionAssetId) {
		const state = lanternCurrentSlideTextState.value
		if (state && !state.loading && !state.error) {
			return state.text
		}
		return ''
	}
	return slide.description ?? ''
})

function resetLanternImageMetrics(): void {
	lanternImageNaturalSize.width = 0
	lanternImageNaturalSize.height = 0
}

function updateLanternViewportSize(): void {
	if (typeof window === 'undefined') {
		return
	}
	lanternViewportSize.width = window.innerWidth
	lanternViewportSize.height = window.innerHeight
}

function handleLanternViewportResize(): void {
	updateLanternViewportSize()
	syncLanternViewerLater()
}

function getLanternViewerElement(): HTMLElement | null {
	const target = lanternViewerRoot.value
	if (!target) {
		return null
	}
	if (typeof (target as ComponentPublicInstance).$el !== 'undefined') {
		const element = (target as ComponentPublicInstance & { $el?: HTMLElement }).$el
		if (element) {
			return element
		}
	}
	if (target instanceof HTMLElement) {
		return target
	}
	return null
}

function resolveLanternViewer(): Viewer | null {
	if (lanternViewerInstance) {
		return lanternViewerInstance
	}
	const element = getLanternViewerElement()
	if (!element) {
		return null
	}
	const instance = (element as unknown as { $viewer?: Viewer }).$viewer
	if (instance) {
		lanternViewerInstance = instance
		return instance
	}
	return null
}

function isLanternViewerOpen(): boolean {
	if (typeof window === 'undefined') {
		return false
	}
	const viewer = resolveLanternViewer()
	if (!viewer) {
		return false
	}
	const state = viewer as unknown as { isShown?: boolean }
	return Boolean(state?.isShown)
}

function syncLanternViewer(): void {
	if (typeof window === 'undefined') {
		return
	}
	const viewer = resolveLanternViewer()
	viewer?.update?.()
}

function syncLanternViewerLater(): void {
	if (typeof window === 'undefined') {
		return
	}
	nextTick(() => {
		syncLanternViewer()
	})
}

function handleLanternImageLoad(event: Event): void {
	const target = event?.target as HTMLImageElement | null
	if (!target) {
		return
	}
	const width = target.naturalWidth || target.width || 0
	const height = target.naturalHeight || target.height || 0
	if (width > 0 && height > 0) {
		lanternImageNaturalSize.width = width
		lanternImageNaturalSize.height = height
		syncLanternViewerLater()
	}
}

function openLanternImageFullscreen(): void {
	const imageUrl = lanternCurrentSlideImage.value
	if (!imageUrl) {
		return
	}
	const fallbackPreview = () => {
		if (typeof window !== 'undefined') {
			window.open(imageUrl, '_blank', 'noopener')
		}
	}
	if (typeof window === 'undefined') {
		fallbackPreview()
		return
	}
	syncLanternViewerLater()
	nextTick(() => {
		const viewer = resolveLanternViewer()
		if (viewer && typeof viewer.view === 'function') {
			viewer.update?.()
			viewer.view(0)
			return
		}
		fallbackPreview()
	})
}

function closeLanternImageFullscreen(): void {
	if (typeof window === 'undefined') {
		return
	}
	const viewer = resolveLanternViewer()
	viewer?.hide?.()
}


watch(
	lanternSlides,
	(slidesList) => {
		const list = Array.isArray(slidesList) ? slidesList : []
		const activeTextIds = new Set<string>()
		const activeImageIds = new Set<string>()
		for (const slide of list) {
			const candidate = slide?.descriptionAssetId?.trim()
			if (candidate) {
				activeTextIds.add(candidate)
				void ensureLanternText(candidate)
			}
			const imageCandidate = slide?.imageAssetId?.trim()
			if (imageCandidate) {
				activeImageIds.add(imageCandidate)
				void ensureLanternImage(imageCandidate)
			}
		}
		if (lanternActiveSlideIndex.value >= list.length) {
			lanternActiveSlideIndex.value = list.length ? list.length - 1 : 0
		}
		Object.keys(lanternTextState).forEach((existing) => {
			if (!activeTextIds.has(existing)) {
				delete lanternTextState[existing]
			}
		})
		Object.keys(lanternImageState).forEach((existing) => {
			if (!activeImageIds.has(existing)) {
				delete lanternImageState[existing]
			}
		})
		Array.from(lanternTextPromises.keys()).forEach((existing) => {
			if (!activeTextIds.has(existing)) {
				lanternTextPromises.delete(existing)
			}
		})
		Array.from(lanternImagePromises.keys()).forEach((existing) => {
			if (!activeImageIds.has(existing)) {
				lanternImagePromises.delete(existing)
			}
		})
	},
	{ deep: true },
)

watch(
	lanternCurrentSlide,
	(slide) => {
		const assetId = typeof slide?.descriptionAssetId === 'string' ? slide.descriptionAssetId.trim() : ''
		if (assetId) {
			void ensureLanternText(assetId)
		}
		const imageAssetId = typeof slide?.imageAssetId === 'string' ? slide.imageAssetId.trim() : ''
		if (imageAssetId) {
			void ensureLanternImage(imageAssetId)
		}
		resetLanternImageMetrics()
	},
	{ immediate: true },
)

watch(
	lanternCurrentSlideImage,
	() => {
		resetLanternImageMetrics()
		closeLanternImageFullscreen()
		syncLanternViewerLater()
	},
	{ immediate: true },
)

watch(lanternOverlayVisible, (visible) => {
	if (visible) {
		updateLanternViewportSize()
		syncLanternViewerLater()
	} else {
		resetLanternImageMetrics()
		closeLanternImageFullscreen()
	}
})

watch(
	() => [lanternImageNaturalSize.width, lanternImageNaturalSize.height],
	() => {
		syncLanternViewerLater()
	},
)

watch(
	() => [lanternViewportSize.width, lanternViewportSize.height],
	() => {
		syncLanternViewerLater()
	},
)

watch(volumePercent, (value) => {
	if (!listener) {
		return
	}
	listener.setMasterVolume(Math.max(0, Math.min(1, value / 100)))
})

watch([isGroundWireframeVisible, isOtherRigidbodyWireframeVisible], ([groundEnabled, otherEnabled]) => {
	const enabled = groundEnabled || otherEnabled
	if (enabled) {
		ensureRigidbodyDebugGroup()
		syncRigidbodyDebugHelpers()
		updateRigidbodyDebugTransforms()
		setAirWallDebugVisibility(groundEnabled)
		return
	}
	disposeRigidbodyDebugHelpers()
	roadHeightfieldDebugCache.clear()
	setAirWallDebugVisibility(false)
})

watch(isRendererDebugVisible, (visible) => {
	if (visible) {
		return
	}
	rendererDebug.width = 0
	rendererDebug.height = 0
	rendererDebug.pixelRatio = 1
	rendererDebug.calls = 0
	rendererDebug.triangles = 0
	rendererDebug.geometries = 0
	rendererDebug.textures = 0
})

watch(isInstancingDebugVisible, (visible) => {
	if (visible) {
		return
	}
	instancedMatrixUploadMeshes.clear()
	instancingDebug.instancedMesh = 0
	instancingDebug.instancedActive = 0
	instancingDebug.instancedInstanceCount = 0
	instancingDebug.instanceMatrixUploadKb = 0
	instancingDebug.lodVisible = 0
	instancingDebug.lodTotal = 0
	instancingDebug.scatterVisible = 0
	instancingDebug.scatterTotal = 0
})

watch(isGroundChunkStatsVisible, (visible) => {
	if (visible) {
		return
	}
	groundChunkDebug.loaded = 0
	groundChunkDebug.target = 0
	groundChunkDebug.total = 0
	groundChunkDebug.pending = 0
	groundChunkDebug.unloaded = 0
})

watch(controlMode, (mode) => {
	if (suppressControlModeApply) {
		return
	}
	applyControlMode(mode)
})

watch(
	() => vehicleDriveState.active,
	(active) => {
		if (active && vehicleDriveUiOverride.value === 'auto') {
			setVehicleDriveUiOverride('show')
		}
	},
)

function isInputLikeElement(target: EventTarget | null): boolean {
	const element = target as HTMLElement | null
	if (!element) {
		return false
	}
	const tag = element.tagName
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
		return true
	}
	return element.isContentEditable
}

function updateCameraControlActivation(): void {
	const frozen = sceneSwitching.value
	const caged = isCameraCaged.value
	if (firstPersonControls) {
		const enableFirstPerson = !frozen && controlMode.value === 'first-person' && !caged
		firstPersonControls.enabled = enableFirstPerson
		firstPersonControls.activeLook = false // enforce keyboard-only control in first-person mode
	}
	if (mapControls) {
		mapControls.enabled = !frozen && controlMode.value === 'third-person' && !caged
	}
	updateCanvasCursor()
}

function applyAutoTourCameraInputPolicy(): void {
	if (vehicleDriveState.active) {
		return
	}
	const anyActive = activeAutoTourNodeIds.size > 0
	const shouldLock = anyActive && !autoTourPaused.value
	const shouldRotateOnly = anyActive && autoTourPaused.value

	if (shouldLock) {
		setCameraCaging(true, { force: true })
		if (mapControls) {
			mapControls.enablePan = false
			;(mapControls as any).enableRotate = false
		}
		return
	}

	setCameraCaging(false, { force: true })
	if (mapControls) {
		;(mapControls as any).enableRotate = true
		mapControls.enablePan = shouldRotateOnly ? false : MAP_CONTROL_DEFAULTS.enablePan
	}
}

function syncAutoTourCameraInputPolicyForFrame(delta: number): void {
	if (vehicleDriveState.active) {
		return
	}
	if (delta > 0) {
		autoTourActiveSyncAccumSeconds += delta
	}
	if (autoTourActiveSyncAccumSeconds >= 0.2) {
		autoTourActiveSyncAccumSeconds = 0
		syncAutoTourActiveNodesFromRuntime(activeAutoTourNodeIds, previewNodeMap.keys(), autoTourRuntime)
	}
	applyAutoTourCameraInputPolicy()
}

function updateCanvasCursor() {
	const canvas = renderer?.domElement
	if (!canvas) {
		return
	}
	if (sceneSwitching.value) {
		canvas.style.cursor = 'default'
		return
	}
	if (controlMode.value !== 'first-person') {
		const canOrbit = !isCameraCaged.value && Boolean(mapControls?.enabled)
		canvas.style.cursor = canOrbit ? 'grab' : 'default'
		return
	}
	canvas.style.cursor = 'default'
}

function applyMapControlFollowSettings(active: boolean) {
	if (!mapControls) {
		return
	}
	if (active) {
		mapControls.enablePan = false
		mapControls.minDistance = VEHICLE_FOLLOW_DISTANCE_MIN
		mapControls.maxDistance = VEHICLE_FOLLOW_DISTANCE_MAX
		return
	}
	mapControls.enablePan = MAP_CONTROL_DEFAULTS.enablePan
	mapControls.minDistance = MAP_CONTROL_DEFAULTS.minDistance
	mapControls.maxDistance = MAP_CONTROL_DEFAULTS.maxDistance
}


function setCameraCaging(enabled: boolean, options: { force?: boolean } = {}) {
	if (!options.force && vehicleDriveState.active && !enabled) {
		return
	}
	if (isCameraCaged.value === enabled) {
		return
	}
	isCameraCaged.value = enabled
	updateCameraControlActivation()
	if (!enabled && controlMode.value === 'first-person' && firstPersonControls) {
		resetFirstPersonPointerDelta()
		clampFirstPersonPitch(true)
		syncFirstPersonOrientation()
		syncLastFirstPersonStateFromCamera()
	}
}

function syncVehicleDriveCameraMode(): void {
	if (!vehicleDriveState.active) {
		if (vehicleDriveCameraMode.value !== 'first-person') {
			vehicleDriveCameraMode.value = 'first-person'
		}
		vehicleDriveCameraFollowState.initialized = false
		resetVehicleFollowLocalOffset()
		followCameraControlActive = false
		followCameraControlDirty = false
		applyMapControlFollowSettings(false)
		return
	}
	if (controlMode.value === 'first-person') {
		if (vehicleDriveCameraMode.value !== 'first-person') {
			vehicleDriveCameraMode.value = 'first-person'
		}
		vehicleDriveCameraFollowState.initialized = false
		followCameraControlActive = false
		followCameraControlDirty = false
		applyMapControlFollowSettings(false)
		setCameraCaging(true, { force: true })
		if (camera && renderer) {
			updateVehicleDriveCamera(0, { immediate: true })
		}
		return
	}
	const desiredMode: VehicleDriveCameraMode = vehicleDriveOrbitMode.value
	const modeChanged = vehicleDriveCameraMode.value !== desiredMode
	vehicleDriveCameraMode.value = desiredMode
	if (desiredMode === 'follow') {
		if (modeChanged) {
			vehicleDriveCameraFollowState.initialized = false
		}
		applyMapControlFollowSettings(true)
	} else {
		vehicleDriveCameraFollowState.initialized = false
		followCameraControlActive = false
		followCameraControlDirty = false
		applyMapControlFollowSettings(false)
	}
	setCameraCaging(false, { force: true })
	if (!camera || !renderer) {
		return
	}
	updateVehicleDriveCamera(0, {
		immediate: true,
		applyOrbitTween: desiredMode === 'follow',
	})
}

function clearBehaviorAlert() {
	behaviorAlertVisible.value = false
	behaviorAlertTitle.value = ''
	behaviorAlertMessage.value = ''
	behaviorAlertToken.value = null
	behaviorAlertShowConfirm.value = true
	behaviorAlertShowCancel.value = false
	behaviorAlertConfirmText.value = 'Confirm'
	behaviorAlertCancelText.value = 'Cancel'
}

function normalizeLanternLayout(layout: string | null | undefined): 'imageTop' | 'imageLeft' | 'imageRight' {
	switch (layout) {
		case 'imageLeft':
		case 'imageRight':
		case 'imageTop':
			return layout
		default:
			return 'imageTop'
	}
}

function normalizeLanternSlide(slide: Partial<LanternSlideDefinition> | null | undefined): LanternSlideDefinition {
	const id = typeof slide?.id === 'string' && slide.id.trim().length ? slide.id.trim() : `lantern_preview_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`
	const title = typeof slide?.title === 'string' ? slide.title.trim() : ''
	const description = typeof slide?.description === 'string' ? slide.description.trim() : ''
	const descriptionAssetId = typeof (slide as { descriptionAssetId?: unknown })?.descriptionAssetId === 'string'
		&& (slide as { descriptionAssetId: string }).descriptionAssetId.trim().length
		? (slide as { descriptionAssetId: string }).descriptionAssetId.trim()
		: null
	const imageAssetId = typeof slide?.imageAssetId === 'string' && slide.imageAssetId.trim().length ? slide.imageAssetId.trim() : null
	return {
		id,
		title,
		description,
		descriptionAssetId,
		imageAssetId,
		layout: normalizeLanternLayout(slide?.layout),
	}
}

function normalizeLanternSlides(slides: LanternSlideDefinition[] | null | undefined): LanternSlideDefinition[] {
	if (!Array.isArray(slides) || !slides.length) {
		return []
	}
	return slides.map((slide) => normalizeLanternSlide(slide))
}

function resetLanternOverlay(): void {
	lanternOverlayVisible.value = false
	lanternSlides.value = []
	lanternActiveSlideIndex.value = 0
	lanternEventToken.value = null
	closeLanternImageFullscreen()
	resetLanternImageMetrics()
}

function getLanternTextState(assetId: string): LanternTextState {
	if (!lanternTextState[assetId]) {
		lanternTextState[assetId] = {
			text: '',
			loading: false,
			error: null,
		}
	}
	return lanternTextState[assetId]!
}

function getLanternImageState(assetId: string): LanternImageState {
	if (!lanternImageState[assetId]) {
		lanternImageState[assetId] = {
			url: null,
			loading: false,
			error: null,
		}
	}
	return lanternImageState[assetId]!
}

function decodeDataUrlText(dataUrl: string): string | null {
	try {
		const commaIndex = dataUrl.indexOf(',')
		if (commaIndex === -1) {
			return null
		}
		const meta = dataUrl.slice(0, commaIndex)
		const payload = dataUrl.slice(commaIndex + 1)
		const isBase64 = /;base64/i.test(meta)
		if (isBase64 && typeof atob === 'function') {
			const binary = atob(payload)
			const length = binary.length
			const bytes = new Uint8Array(length)
			for (let index = 0; index < length; index += 1) {
				bytes[index] = binary.charCodeAt(index)
			}
			return new TextDecoder().decode(bytes)
		}
		return decodeURIComponent(payload.replace(/\+/g, ' '))
	} catch (error) {
		console.warn('Failed to decode text data URL', error)
		return null
	}
}

async function fetchTextFromUrl(source: string): Promise<string> {
	const response = await fetch(source)
	if (!response.ok) {
		throw new Error(`Failed to fetch text asset (${response.status})`)
	}
	return await response.text()
}

async function fetchArrayBufferFromUrl(source: string): Promise<ArrayBuffer> {
	const response = await fetch(source)
	if (!response.ok) {
		throw new Error(`Failed to fetch binary asset (${response.status})`)
	}
	return await response.arrayBuffer()
}

async function loadTextAssetContent(assetId: string): Promise<string | null> {
	const trimmed = assetId.trim()
	if (!trimmed.length) {
		return null
	}
	if (trimmed.startsWith('data:')) {
		return decodeDataUrlText(trimmed)
	}
	if (isExternalAssetReference(trimmed)) {
		return await fetchTextFromUrl(trimmed)
	}
	const entry = await acquirePreviewAssetEntry(trimmed)
	if (!entry) {
		return null
	}
	if (entry.blob) {
		return await entry.blob.text()
	}
	if (entry.downloadUrl) {
		return await fetchTextFromUrl(entry.downloadUrl)
	}
	return null
}

async function ensureLanternText(assetId: string): Promise<void> {
	const trimmed = assetId.trim()
	if (!trimmed.length) {
		return
	}
	if (lanternTextPromises.has(trimmed)) {
		await lanternTextPromises.get(trimmed)
		return
	}
	const promise = (async () => {
		const state = getLanternTextState(trimmed)
		state.loading = true
		state.error = null
		try {
			const text = await loadTextAssetContent(trimmed)
			if (text == null) {
				throw new Error('Unable to load text asset content')
			}
			state.text = text
		} catch (error) {
			state.error = (error as Error).message ?? 'Failed to load text asset'
			state.text = ''
		} finally {
			state.loading = false
			lanternTextPromises.delete(trimmed)
		}
	})()
	lanternTextPromises.set(trimmed, promise)
	await promise
}

async function ensureLanternImage(assetId: string): Promise<void> {
	const trimmed = assetId.trim()
	if (!trimmed.length) {
		return
	}
	if (lanternImagePromises.has(trimmed)) {
		await lanternImagePromises.get(trimmed)
		return
	}
	const promise = (async () => {
		const state = getLanternImageState(trimmed)
		state.loading = true
		state.error = null
		try {
			const resolved = await resolveAssetUrlFromCache(trimmed)
			if (!resolved) {
				throw new Error('Unable to resolve image asset')
			}
			state.url = resolved.url
		} catch (error) {
			state.error = (error as Error).message ?? 'Failed to load image asset'
			state.url = null
		} finally {
			state.loading = false
			lanternImagePromises.delete(trimmed)
		}
	})()
	lanternImagePromises.set(trimmed, promise)
	await promise
}

function closeLanternOverlay(resolution?: BehaviorEventResolution): void {
	const token = lanternEventToken.value
	resetLanternOverlay()
	closeLanternImageFullscreen()
	if (token && resolution) {
		resolveBehaviorToken(token, resolution)
	}
}

function presentLanternSlides(event: Extract<BehaviorRuntimeEvent, { type: 'lantern' }>): void {
	const slides = normalizeLanternSlides(event.params?.slides)
	if (!slides.length) {
		resolveBehaviorToken(event.token, { type: 'continue' })
		return
	}
	if (lanternEventToken.value && lanternEventToken.value !== event.token) {
		closeLanternOverlay({ type: 'abort', message: 'Lantern event replaced' })
	}
	lanternSlides.value = slides
	lanternActiveSlideIndex.value = 0
	lanternEventToken.value = event.token
	lanternOverlayVisible.value = true
}

function showPreviousLanternSlide(): void {
	if (lanternActiveSlideIndex.value > 0) {
		lanternActiveSlideIndex.value -= 1
	}
}

function showNextLanternSlide(): void {
	if (lanternActiveSlideIndex.value < lanternSlides.value.length - 1) {
		lanternActiveSlideIndex.value += 1
	}
}

function confirmLanternOverlay(): void {
	closeLanternOverlay({ type: 'continue' })
}

function cancelLanternOverlay(): void {
	if (isLanternViewerOpen()) {
		closeLanternImageFullscreen()
		return
	}
	closeLanternOverlay({ type: 'abort', message: 'User dismissed lantern slides' })
}

function presentBehaviorAlert(event: Extract<BehaviorRuntimeEvent, { type: 'show-alert' }>) {
	clearBehaviorAlert()
	behaviorAlertToken.value = event.token
	const legacyParams = event.params as typeof event.params & { title?: string; message?: string }
	const rawLegacyTitle = typeof legacyParams.title === 'string' ? legacyParams.title : ''
	const normalizedTitle = rawLegacyTitle ? rawLegacyTitle.trim() : ''
	behaviorAlertTitle.value = normalizedTitle || 'Notice'
	const legacyMessage = typeof legacyParams.message === 'string' ? legacyParams.message : ''
	const messageFallback = event.params.content ?? legacyMessage ?? ''
	behaviorAlertMessage.value = messageFallback
	const paramsWithAsset = event.params as typeof event.params & { contentAssetId?: string | null }
	const contentAssetId = typeof paramsWithAsset.contentAssetId === 'string' ? paramsWithAsset.contentAssetId.trim() : ''
	if (contentAssetId) {
		void loadBehaviorAlertContent(contentAssetId, event.token, messageFallback)
	}
	behaviorAlertShowConfirm.value = event.params.showConfirm ?? true
	behaviorAlertShowCancel.value = event.params.showCancel ?? false
	behaviorAlertConfirmText.value = (event.params.confirmText ?? 'Confirm') || 'Confirm'
	behaviorAlertCancelText.value = (event.params.cancelText ?? 'Cancel') || 'Cancel'
	if (!behaviorAlertShowConfirm.value && !behaviorAlertShowCancel.value) {
		resolveBehaviorToken(event.token, { type: 'continue' })
		return
	}
	behaviorAlertVisible.value = true
}

async function loadBehaviorAlertContent(assetId: string, token: string, fallback: string): Promise<void> {
	try {
		const text = await loadTextAssetContent(assetId)
		if (behaviorAlertToken.value !== token) {
			return
		}
		behaviorAlertMessage.value = text ?? fallback
	} catch (error) {
		console.warn('[ScenePreview] Failed to load alert text asset', error)
		if (behaviorAlertToken.value === token) {
			behaviorAlertMessage.value = fallback
		}
	}
}

function confirmBehaviorAlert() {
	const token = behaviorAlertToken.value
	clearBehaviorAlert()
	if (!token) {
		return
	}
	const followUps = resolveBehaviorEvent(token, { type: 'continue' })
	processBehaviorEvents(followUps)
}

function cancelBehaviorAlert() {
	const token = behaviorAlertToken.value
	clearBehaviorAlert()
	if (!token) {
		return
	}
	const followUps = resolveBehaviorEvent(token, { type: 'abort', message: 'User cancelled alert' })
	processBehaviorEvents(followUps)
}

function dismissBehaviorAlert() {
	clearBehaviorAlert()
}

function processBehaviorEvents(events: BehaviorRuntimeEvent[] | BehaviorRuntimeEvent | null | undefined) {
	if (!events) {
		return
	}
	const list = Array.isArray(events) ? events : [events]
	list.forEach((entry) => handleBehaviorRuntimeEvent(entry))
}

function resolveBehaviorToken(token: string, resolution: BehaviorEventResolution) {
	const followUps = resolveBehaviorEvent(token, resolution)
	processBehaviorEvents(followUps)
}

function clearDelayTimer(token: string) {
	const handle = activeBehaviorDelayTimers.get(token)
	if (handle != null) {
		window.clearTimeout(handle)
		activeBehaviorDelayTimers.delete(token)
	}
}

function stopBehaviorAnimation(token: string) {
	const cancel = activeBehaviorAnimations.get(token)
	if (!cancel) {
		return
	}
	try {
		cancel()
	} finally {
		activeBehaviorAnimations.delete(token)
	}
}

function resetEffectRuntimeTickers(): void {
	effectRuntimeTickers = []
	nodeObjectMap.forEach((object) => {
		const userData = object.userData
		if (userData && Object.prototype.hasOwnProperty.call(userData, WARP_GATE_EFFECT_ACTIVE_FLAG)) {
			delete userData[WARP_GATE_EFFECT_ACTIVE_FLAG]
		}
		if (userData && Object.prototype.hasOwnProperty.call(userData, GUIDEBOARD_EFFECT_ACTIVE_FLAG)) {
			delete userData[GUIDEBOARD_EFFECT_ACTIVE_FLAG]
		}
	})
}

function refreshEffectRuntimeTickers(): void {
	resetEffectRuntimeTickers()
	const uniqueTickers = new Set<(delta: number) => void>()
	nodeObjectMap.forEach((object) => {
		const warpGateRegistry = object.userData?.[WARP_GATE_RUNTIME_REGISTRY_KEY] as
			Record<string, WarpGateRuntimeRegistryEntry> | undefined
		const guideboardRegistry = object.userData?.[GUIDEBOARD_RUNTIME_REGISTRY_KEY] as
			Record<string, GuideboardRuntimeRegistryEntry> | undefined
		if (!warpGateRegistry && !guideboardRegistry) {
			return
		}
		const userData = object.userData ?? (object.userData = {})
		if (warpGateRegistry) {
			let warpGateSeen = false
			let warpGateActive = false
			Object.values(warpGateRegistry).forEach((entry) => {
				if (!entry) {
					return
				}
				if (typeof entry.tick === 'function') {
					uniqueTickers.add(entry.tick)
				}
				if (entry.props) {
					warpGateSeen = true
					if (isWarpGateEffectActive(entry.props)) {
						warpGateActive = true
					}
				}
			})
			if (warpGateSeen) {
				userData[WARP_GATE_EFFECT_ACTIVE_FLAG] = warpGateActive
			} else if (Object.prototype.hasOwnProperty.call(userData, WARP_GATE_EFFECT_ACTIVE_FLAG)) {
				delete userData[WARP_GATE_EFFECT_ACTIVE_FLAG]
			}
		} else if (Object.prototype.hasOwnProperty.call(userData, WARP_GATE_EFFECT_ACTIVE_FLAG)) {
			delete userData[WARP_GATE_EFFECT_ACTIVE_FLAG]
		}
		if (guideboardRegistry) {
			let guideboardSeen = false
			let guideboardActive = false
			Object.values(guideboardRegistry).forEach((entry) => {
				if (!entry) {
					return
				}
				if (typeof entry.tick === 'function') {
					uniqueTickers.add(entry.tick)
				}
				if (entry.props) {
					guideboardSeen = true
					if (isGuideboardEffectActive(entry.props)) {
						guideboardActive = true
					}
				}
			})
			if (guideboardSeen) {
				userData[GUIDEBOARD_EFFECT_ACTIVE_FLAG] = guideboardActive
			} else if (Object.prototype.hasOwnProperty.call(userData, GUIDEBOARD_EFFECT_ACTIVE_FLAG)) {
				delete userData[GUIDEBOARD_EFFECT_ACTIVE_FLAG]
			}
		} else if (Object.prototype.hasOwnProperty.call(userData, GUIDEBOARD_EFFECT_ACTIVE_FLAG)) {
			delete userData[GUIDEBOARD_EFFECT_ACTIVE_FLAG]
		}
	})
	effectRuntimeTickers = uniqueTickers.size ? Array.from(uniqueTickers) : []
}

function resetAnimationControllers(): void {
	Array.from(activeBehaviorAnimations.entries()).forEach(([token, cancel]) => {
		try {
			cancel()
		} catch (error) {
			console.warn('[ScenePreview] Failed to cancel behavior animation', error)
		} finally {
			activeBehaviorAnimations.delete(token)
		}
	})
	animationMixers.forEach((mixer) => {
		try {
			mixer.stopAllAction()
			const root = mixer.getRoot()
			if (root) {
				mixer.uncacheRoot(root)
			}
		} catch (error) {
			console.warn('[ScenePreview] Failed to reset animation mixer', error)
		}
	})
	animationMixers = []
	nodeAnimationControllers.clear()
	resetEffectRuntimeTickers()
}

function pickDefaultAnimationClip(clips: THREE.AnimationClip[]): THREE.AnimationClip | null {
	if (!Array.isArray(clips) || !clips.length) {
		return null
	}
	const finite = clips.find((clip) => Number.isFinite(clip.duration) && clip.duration > 0)
	return finite ?? clips[0] ?? null
}

function playAnimationClip(
	mixer: THREE.AnimationMixer,
	clip: THREE.AnimationClip,
	options: { loop?: boolean } = {},
): THREE.AnimationAction {
	const { loop = false } = options
	const action = mixer.clipAction(clip)
	action.reset()
	action.enabled = true
	if (loop) {
		action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY)
		action.clampWhenFinished = false
	} else {
		action.setLoop(THREE.LoopOnce, 0)
		action.clampWhenFinished = true
	}
	action.play()
	return action
}

function restartDefaultAnimation(nodeId: string): void {
	const controller = nodeAnimationControllers.get(nodeId)
	if (!controller) {
		return
	}
	const clip = controller.defaultClip ?? pickDefaultAnimationClip(controller.clips)
	if (!clip) {
		return
	}
	controller.defaultClip = clip
	playAnimationClip(controller.mixer, clip, { loop: true })
}

function startTimedAnimation(
	token: string,
	durationSeconds: number,
	onUpdate: (alpha: number) => void,
	onComplete: () => void,
): void {
	stopBehaviorAnimation(token)
	const durationMs = Math.max(0, durationSeconds) * 1000
	if (durationMs <= 0) {
		onUpdate(1)
		onComplete()
		return
	}
	const startTime = performance.now()
	let frameHandle = 0
	const cancel = () => {
		if (frameHandle) {
			cancelAnimationFrame(frameHandle)
			frameHandle = 0
		}
		activeBehaviorAnimations.delete(token)
	}
	const step = (now: number) => {
		const elapsed = Math.max(0, now - startTime)
		const alpha = Math.min(1, elapsed / durationMs)
		onUpdate(alpha)
		if (alpha >= 1) {
			cancel()
			onComplete()
			return
		}
		frameHandle = requestAnimationFrame(step)
	}
	frameHandle = requestAnimationFrame(step)
	activeBehaviorAnimations.set(token, cancel)
}

function resolveNodeFocusPoint(nodeId: string | null, fallback: THREE.Vector3): THREE.Vector3 | null {
	if (!nodeId) {
		return null
	}
	const object = nodeObjectMap.get(nodeId)
	if (!object) {
		return null
	}
	tempBox.setFromObject(object)
	if (!Number.isFinite(tempBox.min.x) || !Number.isFinite(tempBox.max.x)) {
		object.getWorldPosition(fallback)
		return fallback
	}
	tempBox.getCenter(fallback)
	return fallback
}

function resetProtagonistPoseState() {
	protagonistPoseSynced = false
}

function findProtagonistObject(): THREE.Object3D | null {
	for (const object of nodeObjectMap.values()) {
		if (object.userData?.protagonist) {
			return object
		}
	}
	return null
}

type ProtagonistPoseOptions = {
	force?: boolean
	applyToCamera?: boolean
	object?: THREE.Object3D | null
}

function syncProtagonistCameraPose(options: ProtagonistPoseOptions = {}): boolean {
	if (!options.force && protagonistPoseSynced) {
		return false
	}
	const protagonistObject = options.object ?? findProtagonistObject()
	if (!protagonistObject) {
		return false
	}
	protagonistObject.getWorldPosition(protagonistPosePosition)
	// Use protagonist's local +X as the forward direction so the initial camera
	// orientation matches the protagonist's +X axis for better scene viewing.
	protagonistObject.getWorldQuaternion(tempQuaternion)
	protagonistPoseDirection.set(1, 0, 0).applyQuaternion(tempQuaternion)
	if (protagonistPoseDirection.lengthSq() < 1e-8) {
		protagonistPoseDirection.set(1, 0, 0)
	} else {
		protagonistPoseDirection.normalize()
	}
	protagonistPosePosition.y = CAMERA_HEIGHT
	lastFirstPersonState.position.copy(protagonistPosePosition)
	lastFirstPersonState.direction.copy(protagonistPoseDirection)
	protagonistPoseSynced = true
	if (options.applyToCamera && !vehicleDriveState.active && camera) {
		if (controlMode.value === 'first-person' && firstPersonControls) {
			camera.position.copy(lastFirstPersonState.position)
			camera.position.y = CAMERA_HEIGHT
			protagonistPoseTarget.copy(camera.position).add(lastFirstPersonState.direction)
			firstPersonControls.lookAt(protagonistPoseTarget.x, protagonistPoseTarget.y, protagonistPoseTarget.z)
			clampFirstPersonPitch(true)
			syncFirstPersonOrientation()
			resetFirstPersonPointerDelta()
			syncLastFirstPersonStateFromCamera()
		} else if (mapControls) {
			// Align orbit/map controls to protagonist pose: position the camera at the protagonist
			// and set the controls' target to look in the protagonist's forward direction.
			camera.position.copy(protagonistPosePosition)
			camera.position.y = CAMERA_HEIGHT
			protagonistPoseTarget.copy(protagonistPosePosition).addScaledVector(protagonistPoseDirection, VEHICLE_CAMERA_DEFAULT_LOOK_DISTANCE)
			camera.lookAt(protagonistPoseTarget)
			mapControls.target.copy(protagonistPoseTarget)
			mapControls.update()
		}
	}
	return true
}

function resetBehaviorProximity(): void {
	behaviorProximityCandidates.clear()
	behaviorProximityState.clear()
	behaviorProximityThresholdCache.clear()
}

function removeBehaviorProximityCandidate(nodeId: string): void {
	behaviorProximityCandidates.delete(nodeId)
	behaviorProximityState.delete(nodeId)
	behaviorProximityThresholdCache.delete(nodeId)
}

function ensureBehaviorProximityState(nodeId: string): void {
	if (!behaviorProximityState.has(nodeId)) {
		behaviorProximityState.set(nodeId, { inside: false, lastDistance: null })
	}
}

// Keep the proximity candidate list aligned with the behavior runtime registry.
function syncBehaviorProximityCandidate(nodeId: string): void {
	if (!previewNodeMap.has(nodeId)) {
		removeBehaviorProximityCandidate(nodeId)
		return
	}
	const actions = listRegisteredBehaviorActions(nodeId)
	const hasApproach = actions.includes('approach')
	const hasDepart = actions.includes('depart')
	if (!hasApproach && !hasDepart) {
		removeBehaviorProximityCandidate(nodeId)
		return
	}
	behaviorProximityCandidates.set(nodeId, { hasApproach, hasDepart })
	ensureBehaviorProximityState(nodeId)
}

function refreshBehaviorProximityCandidates(): void {
	resetBehaviorProximity()
	previewNodeMap.forEach((_node, nodeId) => {
		syncBehaviorProximityCandidate(nodeId)
	})
}

const behaviorRuntimeListener: BehaviorRuntimeListener = {
	onRegistryChanged(nodeId) {
		syncBehaviorProximityCandidate(nodeId)
		syncInteractionLayersForNode(nodeId)
	},
}

function computeObjectBoundingRadius(object: THREE.Object3D): number {
	tempBox.setFromObject(object)
	const hasFiniteBounds = [
		tempBox.min.x,
		tempBox.min.y,
		tempBox.min.z,
		tempBox.max.x,
		tempBox.max.y,
		tempBox.max.z,
	].every((value) => Number.isFinite(value))
	if (!hasFiniteBounds) {
		return DEFAULT_OBJECT_RADIUS
	}
	tempBox.getBoundingSphere(tempSphere)
	return Number.isFinite(tempSphere.radius) && tempSphere.radius > 0 ? tempSphere.radius : DEFAULT_OBJECT_RADIUS
}

function resolveProximityThresholds(nodeId: string, object: THREE.Object3D): BehaviorProximityThreshold {
	const cached = behaviorProximityThresholdCache.get(nodeId)
	if (cached && cached.objectId === object.uuid) {
		return cached
	}
	const radius = computeObjectBoundingRadius(object)
	const enter = Math.max(PROXIMITY_MIN_DISTANCE, radius * PROXIMITY_RADIUS_SCALE)
	const exit = enter + PROXIMITY_EXIT_PADDING
	const nextThreshold: BehaviorProximityThreshold = {
		enter,
		exit,
		objectId: object.uuid,
	}
	behaviorProximityThresholdCache.set(nodeId, nextThreshold)
	return nextThreshold
}

function updateBehaviorProximity(): void {
	if (!camera || !behaviorProximityCandidates.size) {
		return
	}
	const cameraPosition = camera.position
	let observerPosition = cameraPosition
	let observerNodeId: string | null = null
	if (vehicleDriveState.active && vehicleDriveState.nodeId) {
		observerNodeId = vehicleDriveState.nodeId
	} else if (activeAutoTourNodeIds.size > 0) {
		observerNodeId = resolveAutoTourFollowNodeId(
			autoTourFollowNodeId.value,
			cameraViewState.watchTargetId,
			activeAutoTourNodeIds,
			previewNodeMap.keys(),
			autoTourRuntime,
		)
	}
	if (observerNodeId) {
		const observerPoint =
			resolveNodeFocusPoint(observerNodeId, tempObserverPosition) ??
			nodeObjectMap.get(observerNodeId)?.getWorldPosition(tempObserverPosition) ??
			null
		if (observerPoint) {
			observerPosition = observerPoint
		}
	}
	behaviorProximityCandidates.forEach((candidate, nodeId) => {
		const object = nodeObjectMap.get(nodeId)
		if (!object) {
			return
		}
		const thresholds = resolveProximityThresholds(nodeId, object)
		const state = behaviorProximityState.get(nodeId)
		if (!state) {
			return
		}
		const focusPoint = resolveNodeFocusPoint(nodeId, tempPosition) ?? object.getWorldPosition(tempPosition)
		const distance = focusPoint.distanceTo(observerPosition)
		if (!Number.isFinite(distance)) {
			return
		}
		if (!state.inside && distance <= thresholds.enter) {
			state.inside = true
			if (candidate.hasApproach) {
				const followUps = triggerBehaviorAction(nodeId, 'approach', {
					payload: {
						distance,
						threshold: thresholds.enter,
					},
				})
				processBehaviorEvents(followUps)
			}
		} else if (state.inside && distance >= thresholds.exit) {
			state.inside = false
			if (candidate.hasDepart) {
				const followUps = triggerBehaviorAction(nodeId, 'depart', {
					payload: {
						distance,
						threshold: thresholds.exit,
					},
				})
				processBehaviorEvents(followUps)
			}
		}
		state.lastDistance = distance
	})
}

function handleDelayEvent(event: Extract<BehaviorRuntimeEvent, { type: 'delay' }>) {
	clearDelayTimer(event.token)
	const durationMs = Math.max(0, event.seconds) * 1000
	const handle = window.setTimeout(() => {
		activeBehaviorDelayTimers.delete(event.token)
		resolveBehaviorToken(event.token, { type: 'continue' })
	}, durationMs)
	activeBehaviorDelayTimers.set(event.token, handle)
}

function handleMoveCameraEvent(event: Extract<BehaviorRuntimeEvent, { type: 'move-camera' }>) {
	const activeCamera = camera
	if (!activeCamera) {
		resolveBehaviorToken(event.token, { type: 'fail', message: 'Camera unavailable' })
		return
	}
	const focus = resolveNodeFocusPoint(event.targetNodeId ?? event.nodeId, tempTarget)
	if (!focus) {
		resolveBehaviorToken(event.token, {
			type: 'fail',
			message: 'Behavior target object not found.',
		})
		return
	}
	const focusPoint = focus.clone()
	const ownerObject = nodeObjectMap.get(event.targetNodeId ?? event.nodeId) ?? null
	if (ownerObject) {
		ownerObject.getWorldQuaternion(tempQuaternion)
	} else {
		tempQuaternion.identity()
	}
	const destination = focusPoint.clone()
	destination.y = CAMERA_HEIGHT
	const lookPoint = focusPoint.clone()
	lookPoint.y = CAMERA_HEIGHT
	const startPosition = activeCamera.position.clone()
	const orbitControls = mapControls ?? null
	const startTarget = orbitControls ? orbitControls.target.clone() : null
	const durationSeconds = Math.max(0, event.duration ?? 0)
	const updateFrame = (alpha: number) => {
		activeCamera.position.lerpVectors(startPosition, destination, alpha)
		if (orbitControls && startTarget) {
			orbitControls.target.copy(startTarget)
			orbitControls.target.lerp(lookPoint, alpha)
			orbitControls.update()
		}
		activeCamera.lookAt(lookPoint)
	}
	const finalize = () => {
		activeCamera.position.copy(destination)
		if (orbitControls) {
			orbitControls.target.copy(lookPoint)
			orbitControls.update()
		}
		activeCamera.lookAt(lookPoint)
		syncLastFirstPersonStateFromCamera()
		resolveBehaviorToken(event.token, { type: 'continue' })
	}
	startTimedAnimation(event.token, durationSeconds, updateFrame, finalize)
}

function handleSetVisibilityEvent(event: Extract<BehaviorRuntimeEvent, { type: 'set-visibility' }>) {
	const object = nodeObjectMap.get(event.targetNodeId)
	if (object) {
		object.visible = event.visible
		syncInstancedTransform(object)
	}
	const node = resolveNodeById(event.targetNodeId)
	if (node) {
		node.visible = event.visible
	}
	updateBehaviorVisibility(event.targetNodeId, event.visible)
}

function handlePlayAnimationEvent(event: Extract<BehaviorRuntimeEvent, { type: 'play-animation' }>) {
	const targetNodeId = event.targetNodeId || event.nodeId
	if (!targetNodeId) {
		if (event.token) {
			resolveBehaviorToken(event.token, { type: 'fail', message: 'Animation target missing' })
		}
		console.warn('[ScenePreview] Play animation skipped: no target node')
		return
	}
	const controller = nodeAnimationControllers.get(targetNodeId)
	if (!controller) {
		if (event.token) {
			resolveBehaviorToken(event.token, { type: 'fail', message: 'Animation target not available' })
		}
		console.warn('[ScenePreview] Play animation skipped: target node does not expose animations', {
			nodeId: targetNodeId,
		})
		return
	}
	const clips = controller.clips
	const requestedName = event.clipName && event.clipName.trim().length ? event.clipName.trim() : null
	let clip = requestedName
		? clips.find((entry) => entry.name === requestedName)
		: clips[0] ?? null
	if (!clip) {
		if (event.token) {
			resolveBehaviorToken(event.token, {
				type: 'fail',
				message: requestedName ? `Animation clip "${requestedName}" not found` : 'No animation clips available',
			})
		}
		console.warn('[ScenePreview] Play animation skipped: clip not found', {
			targetNodeId,
			requestedName,
		})
		return
	}
	const mixer = controller.mixer
	mixer.stopAllAction()
	const action = playAnimationClip(mixer, clip, { loop: Boolean(event.loop) })
	const token = event.token
	if (!token) {
		return
	}
	stopBehaviorAnimation(token)
	if (event.loop) {
		resolveBehaviorToken(token, { type: 'continue' })
		return
	}
	if (!Number.isFinite(clip.duration) || clip.duration <= 0) {
		resolveBehaviorToken(token, { type: 'continue' })
		return
	}
	const onFinished = (payload: THREE.Event & { action?: THREE.AnimationAction }) => {
		if (payload.action !== action) {
			return
		}
		mixer.removeEventListener('finished', onFinished)
		activeBehaviorAnimations.delete(token)
		restartDefaultAnimation(targetNodeId)
		resolveBehaviorToken(token, { type: 'continue' })
	}
	const cancel = () => {
		mixer.removeEventListener('finished', onFinished)
		try {
			action.stop()
		} catch (cancelError) {
			console.warn('[ScenePreview] Failed to stop animation action', cancelError)
		}
		restartDefaultAnimation(targetNodeId)
	}
	activeBehaviorAnimations.set(token, cancel)
	mixer.addEventListener('finished', onFinished)
}

function handleTriggerBehaviorEvent(event: Extract<BehaviorRuntimeEvent, { type: 'trigger-behavior' }>) {
	const targetNodeId = event.targetNodeId || event.nodeId
	if (!targetNodeId) {
		console.warn('[ScenePreview] Trigger behavior skipped: no target node')
		return
	}
	const sequenceId = event.targetSequenceId && event.targetSequenceId.trim().length ? event.targetSequenceId : null
	const followUps = triggerBehaviorAction(
		targetNodeId,
		'perform',
		{
			payload: {
				sourceNodeId: event.nodeId,
			},
		},
		sequenceId ? { sequenceId } : {},
	)
	processBehaviorEvents(followUps)
}

function setCameraViewState(mode: CameraViewMode, targetNodeId: string | null = null): void {
	cameraViewState.mode = mode
	cameraViewState.watchTargetId = mode === 'watching' ? targetNodeId : null
}

function isCameraWatchRedundant(targetNodeId: string | null): boolean {
	if (!targetNodeId) {
		return false
	}
	return cameraViewState.mode === 'watching' && cameraViewState.watchTargetId === targetNodeId
}

function performWatchFocus(targetNodeId: string | null, caging = false): { success: boolean; message?: string } {
	const activeCamera = camera
	if (!activeCamera) {
		return { success: false, message: 'Camera unavailable' }
	}
	const resolvedTarget = targetNodeId ?? null
	if (!resolvedTarget) {
		return { success: false, message: 'Target node not provided' }
	}
	if (isCameraWatchRedundant(resolvedTarget)) {
		setCameraCaging(Boolean(caging))
		return { success: true }
	}
	activeCameraLookTween = null
	const focus = resolveNodeFocusPoint(resolvedTarget, tempTarget)
	if (!focus) {
		return { success: false, message: 'Target node not found' }
	}
	const focusPoint = focus.clone()
	const orbitControls = mapControls ?? null
	const isFirstPerson = controlMode.value === 'first-person' && Boolean(firstPersonControls)
	if (isFirstPerson && firstPersonControls) {
		activeCamera.getWorldDirection(tempDirection)
		const startTarget = activeCamera.position.clone().add(tempDirection)
		if (startTarget.distanceToSquared(focusPoint) < 1e-6) {
			firstPersonControls.lookAt(focusPoint.x, focusPoint.y, focusPoint.z)
			clampFirstPersonPitch(true)
			syncFirstPersonOrientation()
			resetFirstPersonPointerDelta()
			syncLastFirstPersonStateFromCamera()
		} else {
			activeCameraLookTween = {
				mode: 'first-person',
				from: startTarget,
				to: focusPoint.clone(),
				duration: CAMERA_WATCH_TWEEN_DURATION,
				elapsed: 0,
			}
			resetFirstPersonPointerDelta()
		}
	} else if (orbitControls) {
		const startTarget = orbitControls.target.clone()
		if (startTarget.distanceToSquared(focusPoint) < 1e-6) {
			orbitControls.target.copy(focusPoint)
			orbitControls.update()
		} else {
			activeCameraLookTween = {
				mode: 'orbit',
				from: startTarget,
				to: focusPoint.clone(),
				duration: CAMERA_WATCH_TWEEN_DURATION,
				elapsed: 0,
			}
		}
	} else {
		activeCamera.lookAt(focusPoint)
		syncLastFirstPersonStateFromCamera()
	}
	setCameraCaging(Boolean(caging))
	setCameraViewState('watching', resolvedTarget)
	return { success: true }
}

function handleWatchNodeEvent(event: Extract<BehaviorRuntimeEvent, { type: 'watch-node' }>) {
	const targetId = event.targetNodeId ?? event.nodeId ?? null
	const result = performWatchFocus(targetId, event.caging)
	if (!result.success) {
		resolveBehaviorToken(event.token, { type: 'fail', message: result.message })
		return
	}
	resolveBehaviorToken(event.token, { type: 'continue' })
}

function showPurposeControls(targetNodeId: string | null, sourceNodeId: string | null): void {
	purposeSourceNodeId.value = sourceNodeId ?? null
	purposeTargetNodeId.value = targetNodeId ?? sourceNodeId ?? null
	purposeControlsVisible.value = true
}

function hidePurposeControls(): void {
	purposeControlsVisible.value = false
	purposeTargetNodeId.value = null
	purposeSourceNodeId.value = null
}

function handleShowPurposeControlsEvent(
	event: Extract<BehaviorRuntimeEvent, { type: 'show-purpose-controls' }>,
): void {
	showPurposeControls(event.targetNodeId ?? null, event.nodeId ?? null)
}

function handleHidePurposeControlsEvent(): void {
	hidePurposeControls()
}

function handlePurposeWatchClick(): void {
	const targetId = purposeTargetNodeId.value ?? purposeSourceNodeId.value
	if (!targetId) {
		console.warn('[ScenePreview] Watch button ignored: no target node available')
		return
	}
	const result = performWatchFocus(targetId, true)
	if (!result.success) {
		console.warn('[ScenePreview] Failed to move camera to watch target', result.message)
		return
	}
}

function handlePurposeResetClick(): void {
	resetCameraToLevelView()
}

function handleLookLevelEvent(event: Extract<BehaviorRuntimeEvent, { type: 'look-level' }>) {
	const activeCamera = camera
	if (!activeCamera) {
		resolveBehaviorToken(event.token, { type: 'fail', message: 'Camera unavailable' })
		return
	}
	resetCameraToLevelView()
	resolveBehaviorToken(event.token, { type: 'continue' })
}

async function ensureScenePreviewExportDocument(document: StoredSceneDocument) {
	const { packageAssetMap, assetIndex } = await buildPackageAssetMapForExport(document)
	document.packageAssetMap = packageAssetMap
	document.assetIndex = assetIndex
	document.resourceSummary = await calculateSceneResourceSummary(document, { embedResources: true })
	return await prepareJsonSceneExport(document, SCENE_PREVIEW_EXPORT_OPTIONS)
}

function isProjectExportBundle(raw: unknown): raw is ProjectExportBundle {
	if (!raw || typeof raw !== 'object') {
		return false
	}
	const candidate = raw as Partial<ProjectExportBundle>
	if (candidate.format !== PROJECT_EXPORT_BUNDLE_FORMAT) {
		return false
	}
	if (candidate.formatVersion !== PROJECT_EXPORT_BUNDLE_FORMAT_VERSION) {
		return false
	}
	if (!candidate.project || typeof candidate.project !== 'object') {
		return false
	}
	if (!Array.isArray(candidate.scenes)) {
		return false
	}
	return true
}

function isSceneJsonExportDocument(raw: unknown): raw is SceneJsonExportDocument {
	if (!raw || typeof raw !== 'object') {
		return false
	}
	const candidate = raw as Partial<SceneJsonExportDocument>
	return typeof candidate.id === 'string' && Array.isArray(candidate.nodes)
}

async function loadProjectBundleFromUrl(sourceUrl: string): Promise<void> {
	const trimmed = sourceUrl.trim()
	if (!trimmed) {
		appendWarningMessage('Missing projectUrl')
		return
	}
	activeScenePackageAssetOverrides = null
	statusMessage.value = 'Loading project...'
	try {
		const text = await fetchTextFromUrl(trimmed)
		const parsed = JSON.parse(text) as unknown
		if (!isProjectExportBundle(parsed)) {
			throw new Error('Invalid project export bundle')
		}
		projectBundle.value = parsed
		projectSceneIndex.clear()
		parsed.scenes.forEach((scene) => {
			if (scene && typeof scene.id === 'string') {
				projectSceneIndex.set(scene.id, scene)
			}
		})

		const initialId = parsed.project.defaultSceneId || parsed.project.sceneOrder?.[0] || parsed.scenes[0]?.id || ''
		if (initialId) {
			await switchToProjectScene(initialId)
		}
		statusMessage.value = ''
	} catch (error) {
		console.error('[ScenePreview] Failed to load project bundle', error)
		appendWarningMessage('Failed to load project bundle.')
		statusMessage.value = 'Failed to load project bundle.'
	}
}

async function loadScenePackageFromUrl(sourceUrl: string): Promise<void> {
	const trimmed = sourceUrl.trim()
	if (!trimmed) {
		appendWarningMessage('Missing packageUrl')
		return
	}
	statusMessage.value = 'Loading scene package...'
	try {
		const buffer = await fetchArrayBufferFromUrl(trimmed)
		const pkg = unzipScenePackage(buffer)
		activeScenePackageAssetOverrides = buildAssetOverridesFromScenePackage(pkg) as any

		const projectText = readTextFileFromScenePackage(pkg, pkg.manifest.project.path)
		const projectConfig = JSON.parse(projectText) as any

		const scenes: ProjectExportSceneEntry[] = []
		projectSceneIndex.clear()
		pkg.manifest.scenes.forEach((sceneEntry) => {
			const sceneText = readTextFileFromScenePackage(pkg, sceneEntry.path)
			const sceneRaw = JSON.parse(sceneText) as unknown
			if (!isSceneJsonExportDocument(sceneRaw)) {
				throw new Error(`Invalid scene document in package: ${sceneEntry.path}`)
			}
			const document = sceneRaw as SceneJsonExportDocument
			const id = sceneEntry.sceneId
			const entry: ProjectExportSceneEntry = {
				kind: 'embedded',
				id,
				name: document.name || id,
				createdAt: (document as any).createdAt ?? null,
				updatedAt: (document as any).updatedAt ?? null,
				document,
			}
			scenes.push(entry)
			projectSceneIndex.set(id, entry)
		})

		projectBundle.value = {
			format: PROJECT_EXPORT_BUNDLE_FORMAT,
			formatVersion: PROJECT_EXPORT_BUNDLE_FORMAT_VERSION,
			exportedAt: new Date().toISOString(),
			project: {
				id: String(projectConfig?.id ?? ''),
				name: String(projectConfig?.name ?? ''),
				defaultSceneId: (projectConfig?.defaultSceneId as string | null) ?? null,
				lastEditedSceneId: (projectConfig?.lastEditedSceneId as string | null) ?? null,
				sceneOrder: Array.isArray(projectConfig?.sceneOrder) ? projectConfig.sceneOrder : scenes.map((s) => s.id),
			},
			scenes,
		}

		const initialId =
			(projectBundle.value.project.defaultSceneId || projectBundle.value.project.sceneOrder?.[0] || scenes[0]?.id || '').trim()
		if (initialId) {
			await switchToProjectScene(initialId)
		}
		statusMessage.value = ''
	} catch (error) {
		console.error('[ScenePreview] Failed to load scene package', error)
		appendWarningMessage('Failed to load scene package.')
		statusMessage.value = 'Failed to load scene package.'
	}
}

async function switchToProjectScene(sceneId: string): Promise<void> {
	const trimmed = sceneId.trim()
	if (!trimmed) {
		appendWarningMessage('No scene provided to load.')
		return
	}
	const entry = projectSceneIndex.get(trimmed) ?? null
	if (!entry) {
		appendWarningMessage('Failed to locate scene in project bundle.')
		return
	}
	const token = beginSceneSwitch()
	try {
		statusMessage.value = 'Loading scene...'
		const timestamp = new Date().toISOString()
		if (entry.kind === 'embedded') {
			cleanupForUnrelatedSceneSwitch()
			const waitApplied = waitForSnapshotApplied(timestamp, token)
			applySnapshot({
				revision: nextSnapshotRevision(),
				document: entry.document,
				timestamp,
			})
			await waitApplied
			statusMessage.value = ''
			return
		}
		if (entry.kind === 'external') {
			const text = await fetchTextFromUrl(entry.sceneJsonUrl)
			const parsed = JSON.parse(text) as unknown
			if (!isSceneJsonExportDocument(parsed)) {
				throw new Error('Invalid scene document')
			}
			if (sceneSwitchToken !== token) {
				return
			}
			cleanupForUnrelatedSceneSwitch()
			const waitApplied = waitForSnapshotApplied(timestamp, token)
			applySnapshot({
				revision: nextSnapshotRevision(),
				document: parsed,
				timestamp,
			})
			await waitApplied
			statusMessage.value = ''
			return
		}
	} catch (error) {
		console.error('[ScenePreview] Failed to switch scene', error)
		appendWarningMessage('Failed to load scene. Please try again later.')
		statusMessage.value = 'Failed to load scene. Please try again later.'
	} finally {
		await endSceneSwitch(token)
	}
}

async function handleLoadSceneEvent(event: Extract<BehaviorRuntimeEvent, { type: 'load-scene' }>) {
	const sceneId = typeof event.sceneId === 'string' ? event.sceneId.trim() : ''
	if (!sceneId) {
		appendWarningMessage('No scene provided to load.')
		return
	}

	const shouldPushToStack = event.pushToStack === true
	if (shouldPushToStack) {
		saveCurrentSceneStateForMap(sceneId)
	}

	if (projectBundle.value) {
		await switchToProjectScene(sceneId)
		return
	}

	if (shouldPushToStack) {
		// Manual navigation should disable live preview snapshots; otherwise BroadcastChannel
		// updates can overwrite the newly loaded scene.
		ensureManualSceneNavigationMode()
	}

	const token = beginSceneSwitch()
	try {
		statusMessage.value = 'Loading scene...'
		const scenesStore = useScenesStore()
		const document = await scenesStore.loadSceneDocument(sceneId)
		if (!document) {
			appendWarningMessage('Failed to load scene document.')
			statusMessage.value = ''
			return
		}
		const exportDocument = await ensureScenePreviewExportDocument(document)
		if (sceneSwitchToken !== token) {
			return
		}
		cleanupForUnrelatedSceneSwitch()
		const timestamp = new Date().toISOString()
		const waitApplied = waitForSnapshotApplied(timestamp, token)
		applySnapshot({
			revision: nextSnapshotRevision(),
			document: exportDocument,
			timestamp,
		})
		await waitApplied
	} catch (error) {
		console.error('[ScenePreview] Failed to load scene', error)
		appendWarningMessage('Failed to load scene. Please try again later.')
		statusMessage.value = 'Failed to load scene. Please try again later.'
	} finally {
		await endSceneSwitch(token)
	}
}

const sceneStackVec3ToTuple = (value: THREE.Vector3): Vec3Tuple => [value.x, value.y, value.z]

const sceneStackApplyVec3Tuple = (target: THREE.Vector3, value: Vec3Tuple): void => {
	target.set(value[0], value[1], value[2])
}

const sceneStackQuatToTuple = (value: THREE.Quaternion): QuatTuple => [value.x, value.y, value.z, value.w]

const sceneStackApplyQuatTuple = (target: THREE.Quaternion, value: QuatTuple): void => {
	target.set(value[0], value[1], value[2], value[3])
}

function captureSceneNodeTransformSnapshot(): Record<string, SceneNodeTransformSnapshot> {
	const snapshot: Record<string, SceneNodeTransformSnapshot> = {}
	for (const [nodeId, node] of previewNodeMap.entries()) {
		const component = resolveEnabledComponentState(node, SCENE_STATE_ANCHOR_COMPONENT_TYPE)
		if (!component) {
			continue
		}
		const object = nodeObjectMap.get(nodeId)
		if (!object) {
			continue
		}
		snapshot[nodeId] = {
			position: sceneStackVec3ToTuple(object.position),
			quaternion: sceneStackQuatToTuple(object.quaternion),
			scale: sceneStackVec3ToTuple(object.scale),
		}
	}
	return snapshot
}

function applySceneNodeTransformSnapshot(snapshot: Record<string, SceneNodeTransformSnapshot>): void {
	Object.entries(snapshot).forEach(([nodeId, transform]) => {
		const object = nodeObjectMap.get(nodeId)
		if (!object) {
			return
		}
		sceneStackApplyVec3Tuple(object.position, transform.position)
		sceneStackApplyQuatTuple(object.quaternion, transform.quaternion)
		sceneStackApplyVec3Tuple(object.scale, transform.scale)
		object.updateMatrixWorld(true)
	})
}

function captureViewControlSnapshot(): SceneViewControlSnapshot | null {
	if (!camera) {
		return null
	}
	const mapTarget = mapControls ? sceneStackVec3ToTuple(mapControls.target) : null
	return {
		controlMode: controlMode.value,
		cameraViewState: {
			mode: cameraViewState.mode,
			watchTargetId: cameraViewState.watchTargetId,
		},
		isCameraCaged: isCameraCaged.value,
		camera: {
			position: sceneStackVec3ToTuple(camera.position),
			quaternion: sceneStackQuatToTuple(camera.quaternion),
			up: sceneStackVec3ToTuple(camera.up),
		},
		mapTarget,
		lastOrbit: {
			position: sceneStackVec3ToTuple(lastOrbitState.position),
			target: sceneStackVec3ToTuple(lastOrbitState.target),
		},
		lastFirstPerson: {
			position: sceneStackVec3ToTuple(lastFirstPersonState.position),
			direction: sceneStackVec3ToTuple(lastFirstPersonState.direction),
		},
		nodeTransforms: captureSceneNodeTransformSnapshot(),
	}
}

function applyViewControlSnapshot(snapshot: SceneViewControlSnapshot): void {
	if (!camera) {
		return
	}
	activeCameraLookTween = null

	// Avoid the controlMode watcher calling applyControlMode() which would overwrite
	// our restored camera pose.
	suppressControlModeApply = true
	try {
		controlMode.value = snapshot.controlMode
		cameraViewState.mode = snapshot.cameraViewState.mode
		cameraViewState.watchTargetId = snapshot.cameraViewState.watchTargetId
	} finally {
		suppressControlModeApply = false
	}

	setCameraCaging(snapshot.isCameraCaged, { force: true })

	sceneStackApplyVec3Tuple(camera.position, snapshot.camera.position)
	sceneStackApplyQuatTuple(camera.quaternion, snapshot.camera.quaternion)
	sceneStackApplyVec3Tuple(camera.up, snapshot.camera.up)
	camera.updateMatrixWorld(true)

	// Restore view caches used by applyControlMode().
	sceneStackApplyVec3Tuple(lastOrbitState.position, snapshot.lastOrbit.position)
	sceneStackApplyVec3Tuple(lastOrbitState.target, snapshot.lastOrbit.target)
	sceneStackApplyVec3Tuple(lastFirstPersonState.position, snapshot.lastFirstPerson.position)
	sceneStackApplyVec3Tuple(lastFirstPersonState.direction, snapshot.lastFirstPerson.direction)

	if (mapControls && snapshot.mapTarget) {
		sceneStackApplyVec3Tuple(mapControls.target, snapshot.mapTarget)
		mapControls.update()
	}

	if (snapshot.controlMode === 'first-person') {
		syncFirstPersonOrientation()
	}

	updateCameraControlActivation()
	updateCanvasCursor()
}

function saveCurrentSceneStateForMap(nextSceneId: string | null = null): void {
	const currentId = currentDocument?.id?.trim() ?? ''
	if (!currentId) {
		return
	}
	const trimmedNextId = nextSceneId?.trim() ?? ''
	if (trimmedNextId && currentId === trimmedNextId) {
		return
	}
	const view = captureViewControlSnapshot()
	if (!view) {
		return
	}
	sceneStateById.set(currentId, view)
	if (trimmedNextId) {
		previousSceneById.set(trimmedNextId, currentId)
	}
}

function ensureManualSceneNavigationMode(): void {
	if (!unsubscribe) {
		return
	}
	// Stop applying incoming live preview snapshots immediately.
	livePreviewEnabled = false
	try {
		unsubscribe?.()
	} finally {
		unsubscribe = null
	}
	if (!liveUpdatesDisabledSourceUrl.value) {
		liveUpdatesDisabledSourceUrl.value = 'manual-scene-navigation'
	}
}

async function restoreSceneFromSnapshot(sceneId: string, view: SceneViewControlSnapshot): Promise<void> {
	if (projectBundle.value) {
		await switchToProjectScene(sceneId)
		applyViewControlSnapshot(view)
		applySceneNodeTransformSnapshot(view.nodeTransforms)
		return
	}
	const token = beginSceneSwitch()
	try {
		statusMessage.value = 'Loading scene...'
		const scenesStore = useScenesStore()
		const document = await scenesStore.loadSceneDocument(sceneId)
		if (!document) {
			appendWarningMessage('Failed to load scene document.')
			statusMessage.value = ''
			return
		}
		const exportDocument = await ensureScenePreviewExportDocument(document)
		if (sceneSwitchToken !== token) {
			return
		}
		cleanupForUnrelatedSceneSwitch()
		const timestamp = new Date().toISOString()
		const waitApplied = waitForSnapshotApplied(timestamp, token)
		applySnapshot({
			revision: nextSnapshotRevision(),
			document: exportDocument,
			timestamp,
		})
		await waitApplied
		if (sceneSwitchToken !== token) {
			return
		}
		applyViewControlSnapshot(view)
		applySceneNodeTransformSnapshot(view.nodeTransforms)
	} catch (error) {
		console.error('[ScenePreview] Failed to restore scene', error)
		appendWarningMessage('Failed to restore scene. Please try again later.')
		statusMessage.value = 'Failed to load scene. Please try again later.'
	} finally {
		await endSceneSwitch(token)
	}
}

async function handleExitSceneEvent(): Promise<void> {
	if (sceneSwitching.value) {
		return
	}
	const currentId = currentDocument?.id?.trim() ?? ''
	if (!currentId) {
		return
	}
	const previousId = previousSceneById.get(currentId) ?? ''
	if (!previousId) {
		return
	}
	const snapshot = sceneStateById.get(previousId)
	if (!snapshot) {
		return
	}
	ensureManualSceneNavigationMode()
	await restoreSceneFromSnapshot(previousId, snapshot)
}

type DriveControlAction = keyof VehicleDriveControlFlags

const vehicleDriveKeyboardMap: Record<string, DriveControlAction> = {
	KeyW: 'forward',
	KeyS: 'backward',
	KeyA: 'left',
	KeyD: 'right',
	Space: 'brake',
}

function updateVehicleDriveInputFromFlags(): void {
	vehicleDriveInput.throttle = vehicleDriveInputFlags.forward === vehicleDriveInputFlags.backward
		? 0
		: vehicleDriveInputFlags.forward
			? 1
			: -1
	vehicleDriveInput.brake = vehicleDriveInputFlags.brake ? 1 : 0
	updateSteeringKeyboardValue()
	syncVehicleSteeringValue()
}

function resetVehicleDriveInputs(): void {
	vehicleDriveController.resetInputs()
	resetSteeringWheelValue()
	updateVehicleDriveInputFromFlags()
}

function setVehicleDriveControlFlag(action: DriveControlAction, pressed: boolean): void {
	if (!vehicleDriveState.active) {
		return
	}
	if (vehicleDriveInputFlags[action] === pressed) {
		return
	}
	vehicleDriveController.setControlFlag(action, pressed)
	updateVehicleDriveInputFromFlags()
}

function handleVehicleDriveControlPointer(
	action: DriveControlAction,
	pressed: boolean,
	event?: PointerEvent | MouseEvent | TouchEvent,
): void {
	if (event) {
		event.preventDefault()
	}
	setVehicleDriveControlFlag(action, pressed)
}

function handleVehicleDriveKeyboardInput(event: KeyboardEvent, pressed: boolean): boolean {
	if (!vehicleDriveState.active) {
		return false
	}
	if (controlMode.value !== 'third-person' || vehicleDriveCameraMode.value === 'first-person') {
		return false
	}
	const action = vehicleDriveKeyboardMap[event.code]
	if (!action) {
		return false
	}
	event.preventDefault()
	setVehicleDriveControlFlag(action, pressed)
	return true
}

function restoreVehicleDriveCameraState(): void {
	const activeCamera = camera
	if (!activeCamera) {
		vehicleDriveCameraRestoreState.hasSnapshot = false
		setCameraCaging(false, { force: true })
		return
	}
	if (vehicleDriveCameraRestoreState.hasSnapshot) {
		const restoredMode = vehicleDriveCameraRestoreState.controlMode
		if (restoredMode === 'first-person') {
			lastFirstPersonState.position.copy(vehicleDriveCameraRestoreState.position)
			tempDirection
				.copy(vehicleDriveCameraRestoreState.target)
				.sub(vehicleDriveCameraRestoreState.position)
			if (tempDirection.lengthSq() < 1e-8) {
				tempDirection.set(0, 0, -1)
			} else {
				tempDirection.normalize()
			}
			lastFirstPersonState.direction.copy(tempDirection)
		} else {
			lastOrbitState.position.copy(vehicleDriveCameraRestoreState.position)
			lastOrbitState.target.copy(vehicleDriveCameraRestoreState.target)
		}
		setCameraViewState(
			vehicleDriveCameraRestoreState.viewMode,
			vehicleDriveCameraRestoreState.viewMode === 'watching'
				? vehicleDriveCameraRestoreState.viewTargetId ?? null
				: null,
		)
		controlMode.value = restoredMode
		setCameraCaging(vehicleDriveCameraRestoreState.isCameraCaged, { force: true })
		activeCamera.up.copy(vehicleDriveCameraRestoreState.up)
		activeCamera.position.copy(vehicleDriveCameraRestoreState.position)
		activeCamera.quaternion.copy(vehicleDriveCameraRestoreState.quaternion)
		activeCamera.updateMatrixWorld(true)
		if (mapControls) {
			mapControls.target.copy(vehicleDriveCameraRestoreState.target)
			mapControls.update()
		}
	}
	vehicleDriveCameraFollowState.currentPosition.copy(activeCamera.position)
	vehicleDriveCameraFollowState.currentTarget.copy(vehicleDriveCameraRestoreState.target)
	vehicleDriveCameraFollowState.desiredPosition.copy(activeCamera.position)
	vehicleDriveCameraFollowState.desiredTarget.copy(vehicleDriveCameraRestoreState.target)
	vehicleDriveCameraFollowState.currentAnchor.copy(activeCamera.position)
	vehicleDriveCameraFollowState.desiredAnchor.copy(activeCamera.position)
	vehicleDriveCameraRestoreState.hasSnapshot = false
}

function startVehicleDriveMode(
	event: Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }>,
): { success: boolean; message?: string } {
	const targetNodeId = event.targetNodeId ?? event.nodeId ?? null
	if (!targetNodeId) {
		return { success: false, message: 'No node provided to drive.' }
	}
	if (vehicleDriveState.active) {
		stopVehicleDriveMode({ resolution: { type: 'abort', message: 'Driving state was replaced by a new script.' } })
	}
	// Capture camera settings before drive mutates controls/caging/view.
	const ctx = camera && renderer
		? { camera, mapControls: mapControls ?? undefined }
		: { camera: null as THREE.PerspectiveCamera | null }
	const result = vehicleDriveController.startDrive(event, ctx)
	if (!result.success) {
		return result
	}
	resetVehicleFollowLocalOffset()
	vehicleDriveExitBusy.value = false
	resetVehicleDriveInputs()
	activeCameraLookTween = null
	if (controlMode.value === 'first-person') {
		syncFirstPersonOrientation()
		resetFirstPersonPointerDelta()
	}
	setCameraViewState('watching', targetNodeId)
	setVehicleDriveUiOverride('show')
	syncVehicleDriveCameraMode()
	return { success: true }
}

function stopVehicleDriveMode(options: { resolution?: BehaviorEventResolution; preserveCamera?: boolean } = {}): void {
	if (!vehicleDriveState.active) {
		return
	}
	const ctx = camera && renderer
		? { camera, mapControls: mapControls ?? undefined }
		: { camera: null as THREE.PerspectiveCamera | null }

	// Use the shared controller stop to ensure vehicle physics is fully frozen and debug logs are emitted.
	vehicleDriveController.stopDrive({
		resolution: options.resolution ?? { type: 'continue' },
		preserveCamera: options.preserveCamera,
	}, ctx)

	// Keep view-local UI input state consistent.
	resetVehicleDriveInputs()
	vehicleDriveCameraFollowState.initialized = false
	resetVehicleFollowLocalOffset()
	followCameraControlActive = false
	followCameraControlDirty = false
	vehicleDriveCameraMode.value = 'first-person'
	applyMapControlFollowSettings(false)
	vehicleDriveExitBusy.value = false
	if (options.preserveCamera) {
		if (vehicleDriveCameraRestoreState.hasSnapshot) {
			controlMode.value = vehicleDriveCameraRestoreState.controlMode
			setCameraCaging(vehicleDriveCameraRestoreState.isCameraCaged, { force: true })
		} else {
			setCameraCaging(false, { force: true })
		}
		vehicleDriveCameraRestoreState.hasSnapshot = false
	} else {
		restoreVehicleDriveCameraState()
	}
	setVehicleDriveUiOverride('hide')
}

function applyVehicleDriveForces(): void {
	if (!vehicleDriveState.active || !vehicleDriveState.vehicle) {
		return
	}
	vehicleDriveController.applyForces()
}

function updateVehicleSpeedFromVehicle(): void {
	const vehicle = vehicleDriveState.vehicle
	const velocity = vehicle?.chassisBody?.velocity ?? null
	if (!velocity) {
		vehicleSpeed.value = 0
		return
	}
	const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z)
	vehicleSpeed.value = Number.isFinite(speed) ? speed : 0
}

function resetActiveVehiclePose(): boolean {
	const success = vehicleDriveController.resetPose()
	if (success) {
		vehicleDriveCameraFollowState.initialized = false
		followCameraControlDirty = true
	}
	return success
}


type VehicleDriveCameraOptions = { immediate?: boolean; applyOrbitTween?: boolean }

function updateVehicleDriveCamera(delta: number, options: VehicleDriveCameraOptions = {}): boolean {
	if (!vehicleDriveState.active || !camera) {
		return false
	}
	const followControlsDirty = followCameraControlDirty
	followCameraControlDirty = false
	const ctx = camera && renderer
		? { camera, mapControls: mapControls ?? undefined }
		: { camera: null as THREE.PerspectiveCamera | null }
	return vehicleDriveController.updateCamera(delta, ctx, { ...options, followControlsDirty })
}

function resetVehicleFollowLocalOffset(): void {
	vehicleDriveController.resetFollowCameraOffset()
}

function alignCameraToVehicleExit(): boolean {
	const ctx = camera && renderer
		? { camera, mapControls: mapControls ?? undefined }
		: { camera: null as THREE.PerspectiveCamera | null }
	const success = vehicleDriveController.alignExitCamera(ctx)
	if (success && camera) {
		lastOrbitState.position.copy(camera.position)
		if (mapControls) {
			lastOrbitState.target.copy(mapControls.target)
		} else {
			tempDirection.set(0, 0, -1)
			camera.getWorldDirection(tempDirection)
			tempTarget.copy(camera.position).addScaledVector(tempDirection, VEHICLE_CAMERA_DEFAULT_LOOK_DISTANCE)
			lastOrbitState.target.copy(tempTarget)
		}
		syncLastFirstPersonStateFromCamera()
	}
	return success
}

const VEHICLE_EXIT_LATERAL_RATIO = 0.6
const VEHICLE_EXIT_FORWARD_RATIO = 0.35
const VEHICLE_EXIT_VERTICAL_RATIO = 0.25
const VEHICLE_EXIT_LATERAL_MIN = 1.25
const VEHICLE_EXIT_FORWARD_MIN = 1.25
const VEHICLE_EXIT_VERTICAL_MIN = 0.6
const VEHICLE_CAMERA_FALLBACK_HEIGHT = 1.35
const VEHICLE_CAMERA_FALLBACK_HEIGHT_RATIO = 0.45
const VEHICLE_SIZE_FALLBACK = { width: 2.4, height: 1.4, length: 4.2 }

function alignCameraToVehicleExitForNode(nodeId: string): boolean {
	if (!camera) {
		return false
	}
	const vehicleNodeId = normalizeNodeId(nodeId)
	if (!vehicleNodeId) {
		return false
	}
	const vehicleObject = nodeObjectMap.get(vehicleNodeId) ?? null
	if (!vehicleObject) {
		return false
	}
	const instance = vehicleInstances.get(vehicleNodeId) ?? null

	vehicleObject.updateMatrixWorld(true)

	// --- seat position (fallback) ---
	tempBox.makeEmpty()
	tempBox.setFromObject(vehicleObject)
	if (!Number.isFinite(tempBox.min.x) || tempBox.isEmpty()) {
		vehicleObject.getWorldPosition(tempPosition)
		tempPosition.addScaledVector(AUTO_TOUR_CAMERA_WORLD_UP, VEHICLE_CAMERA_FALLBACK_HEIGHT)
	} else {
		tempBox.getCenter(tempPosition)
		tempBox.getSize(tempTarget)
		const upOffset = Math.max(tempTarget.y * VEHICLE_CAMERA_FALLBACK_HEIGHT_RATIO, VEHICLE_CAMERA_FALLBACK_HEIGHT)
		tempPosition.addScaledVector(AUTO_TOUR_CAMERA_WORLD_UP, upOffset)
	}

	// --- basis vectors (match VehicleDriveController.computeVehicleBasis) ---
	vehicleObject.getWorldQuaternion(tempQuaternion)
	if (instance) {
		tempDirection.copy(instance.axisForward).applyQuaternion(tempQuaternion)
		tempTarget.copy(instance.axisUp).applyQuaternion(tempQuaternion)
	} else {
		tempDirection.set(0, 0, -1).applyQuaternion(tempQuaternion)
		tempTarget.set(0, 1, 0).applyQuaternion(tempQuaternion)
	}
	if (tempDirection.lengthSq() < 1e-8) {
		tempDirection.set(0, 0, -1)
	} else {
		tempDirection.normalize()
	}
	if (tempTarget.lengthSq() < 1e-8) {
		tempTarget.copy(AUTO_TOUR_CAMERA_WORLD_UP)
	} else {
		tempTarget.normalize()
	}
	const seatForward = tempDirection
	const seatUp = tempTarget
	const seatRight = protagonistPoseDirection.copy(seatForward).cross(seatUp)
	if (seatRight.lengthSq() < 1e-8) {
		seatRight.copy(AUTO_TOUR_CAMERA_WORLD_UP).cross(seatForward)
	}
	if (seatRight.lengthSq() < 1e-8) {
		seatRight.set(1, 0, 0)
	} else {
		seatRight.normalize()
	}
	seatUp.crossVectors(seatRight, seatForward)
	if (seatUp.lengthSq() < 1e-8) {
		seatUp.copy(AUTO_TOUR_CAMERA_WORLD_UP)
	} else {
		seatUp.normalize()
	}

	// --- dimensions (match VehicleDriveController.getVehicleApproxDimensions) ---
	tempBox.makeEmpty()
	tempBox.setFromObject(vehicleObject)
	let width = VEHICLE_SIZE_FALLBACK.width
	let height = VEHICLE_SIZE_FALLBACK.height
	let length = VEHICLE_SIZE_FALLBACK.length
	if (Number.isFinite(tempBox.min.x) && !tempBox.isEmpty()) {
		tempBox.getSize(tempTarget)
		width = Math.max(tempTarget.x, VEHICLE_SIZE_FALLBACK.width)
		height = Math.max(tempTarget.y, VEHICLE_SIZE_FALLBACK.height)
		length = Math.max(tempTarget.z, VEHICLE_SIZE_FALLBACK.length)
	}
	const lateralOffset = Math.max(width * VEHICLE_EXIT_LATERAL_RATIO, VEHICLE_EXIT_LATERAL_MIN)
	const verticalOffset = Math.max(height * VEHICLE_EXIT_VERTICAL_RATIO, VEHICLE_EXIT_VERTICAL_MIN)
	const forwardOffset = Math.max(length * VEHICLE_EXIT_FORWARD_RATIO, VEHICLE_EXIT_FORWARD_MIN)

	// Camera position: left side (-right), a bit up; look a bit forward.
	tempPosition.addScaledVector(seatRight, -lateralOffset)
	tempPosition.addScaledVector(seatUp, verticalOffset)
	protagonistPoseTarget.copy(tempPosition).addScaledVector(seatForward, forwardOffset)

	camera.up.copy(seatUp)
	camera.position.copy(tempPosition)
	camera.lookAt(protagonistPoseTarget)
	camera.updateMatrixWorld(true)
	if (mapControls) {
		mapControls.target.copy(protagonistPoseTarget)
		mapControls.update()
	}

	lastOrbitState.position.copy(camera.position)
	if (mapControls) {
		lastOrbitState.target.copy(mapControls.target)
	} else {
		lastOrbitState.target.copy(protagonistPoseTarget)
	}
	syncLastFirstPersonStateFromCamera()
	return true
}

function handleVehicleDriveEvent(event: Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }>): void {
	const targetNodeId = event.targetNodeId ?? event.nodeId ?? null
	if (!targetNodeId) {
		appendWarningMessage('No node provided to drive.')
		resolveBehaviorToken(event.token, { type: 'fail', message: 'No node provided to drive.' })
		return
	}
	const targetNode = resolveNodeById(targetNodeId)
	const canDrive = Boolean(resolveVehicleComponent(targetNode))
	const canAutoTour = Boolean(resolveAutoTourComponent(targetNode))
	const isTouring = activeAutoTourNodeIds.has(targetNodeId)
	if (!isTouring && !canDrive && !canAutoTour) {
		appendWarningMessage('Target node cannot be driven or auto-toured (missing enabled components).')
		resolveBehaviorToken(event.token, {
			type: 'fail',
			message: 'Target node cannot be driven or auto-toured (missing enabled components).',
		})
		return
	}
	if (vehicleDriveState.active) {
		stopVehicleDriveMode({ resolution: { type: 'abort', message: 'Driving state was replaced by a new script.' } })
	}
	if (pendingVehicleDriveEvent.value) {
		resolveBehaviorToken(pendingVehicleDriveEvent.value.token, {
			type: 'abort',
			message: 'A new drive script was triggered; the previous request was cancelled.',
		})
	}
	pendingVehicleDriveEvent.value = event
	vehicleDrivePromptBusy.value = false
	setVehicleDriveUiOverride('hide')
	resetVehicleDriveInputs()
}

function handleVehicleDebusEvent(): void {
	if (pendingVehicleDriveEvent.value) {
		resolveBehaviorToken(pendingVehicleDriveEvent.value.token, {
			type: 'abort',
			message: 'Drive request was terminated.',
		})
		pendingVehicleDriveEvent.value = null
		vehicleDrivePromptBusy.value = false
		setVehicleDriveUiOverride('hide')
	}
	if (!vehicleDriveState.active) {
		return
	}
	stopVehicleDriveMode({ resolution: { type: 'continue' } })
}

function handleShowVehicleCockpitEvent(): void {
	setVehicleDriveUiOverride('show')
}

function handleHideVehicleCockpitEvent(): void {
	setVehicleDriveUiOverride('hide')
}

function resolveAutoTourVehicleBrakeForce(nodeId: string): number {
	const node = resolveNodeById(nodeId)
	const vehicle = resolveEnabledComponentState<VehicleComponentProps>(node, VEHICLE_COMPONENT_TYPE)
	const brakeForceMax = vehicle
		? clampVehicleComponentProps(vehicle.props).brakeForceMax
		: clampVehicleComponentProps(null).brakeForceMax
	// Match schema autoTourRuntime: hold brake strongly to avoid rolling.
	return brakeForceMax * 6
}

function applyAutoTourVehicleHoldBrake(nodeId: string): void {
	const vehicleInstance = vehicleInstances.get(nodeId) ?? null
	if (!vehicleInstance) {
		return
	}
	const brakeForce = resolveAutoTourVehicleBrakeForce(nodeId)
	holdVehicleBrakeSafe({ vehicleInstance, brakeForce })
	try {
		const chassisBody = vehicleInstance.vehicle.chassisBody
		chassisBody.velocity.set(0, 0, 0)
		chassisBody.angularVelocity.set(0, 0, 0)
		chassisBody.sleep?.()
	} catch {
		// Best-effort; vehicle may be disposed/resetting.
	}
}

function applyAutoTourRigidBodyStop(nodeId: string): void {
	const entry = rigidbodyInstances.get(nodeId) ?? null
	if (!entry) {
		return
	}
	try {
		if (entry.object) {
			syncSharedBodyFromObject(entry.body, entry.object, entry.orientationAdjustment)
		}
		entry.body.velocity.set(0, 0, 0)
		entry.body.angularVelocity.set(0, 0, 0)
		entry.body.sleep?.()
	} catch {
		// Best-effort; body may be disposed/resetting.
	}
}

function applyAutoTourPauseForActiveNodes(): void {
	const manualNodeId = vehicleDriveState.active ? vehicleDriveState.nodeId : null
	activeAutoTourNodeIds.forEach((nodeId) => {
		if (manualNodeId && manualNodeId === nodeId) {
			return
		}
		applyAutoTourVehicleHoldBrake(nodeId)
		applyAutoTourRigidBodyStop(nodeId)
	})
}

async function handleVehicleAutoTourStartClick(): Promise<void> {
	const event = pendingVehicleDriveEvent.value
	if (!event || vehicleDrivePromptBusy.value) {
		return
	}
	const targetNodeId = event.targetNodeId ?? event.nodeId ?? null
	if (!targetNodeId) {
		return
	}
	const node = resolveNodeById(targetNodeId)
	if (!resolveAutoTourComponent(node)) {
		appendWarningMessage('AutoTour component is not enabled on the target node.')
		return
	}

	vehicleDrivePromptBusy.value = true
	try {
		// Capture camera settings before auto-tour mutates controls/caging/view.
		autoTourPaused.value = false
		autoTourPausedIsTerminal.value = false
		autoTourPausedNodeId.value = null
		// Auto tour and manual drive must be mutually exclusive.
		if (vehicleDriveState.active) {
			handleHideVehicleCockpitEvent()
			stopVehicleDriveMode({ resolution: { type: 'continue' } })
		}

		resetVehicleDriveInputs()
		setVehicleDriveUiOverride('hide')
		startTourAndFollow(autoTourRuntime, targetNodeId, (n) => {
			activeAutoTourNodeIds.add(n)
			autoTourFollowNodeId.value = n
			resetCameraFollowState(autoTourCameraFollowState)
			autoTourCameraFollowVelocity.set(0, 0, 0)
			autoTourCameraFollowHasSample = false
			followCameraControlActive = false
			followCameraControlDirty = false
			setCameraViewState('watching', n)
			setCameraCaging(true, { force: true })
			applyAutoTourCameraInputPolicy()
		})

		// Behavior script tokens should not hang: auto-tour starts immediately.
		if (event.token) {
			resolveBehaviorToken(event.token, { type: 'continue' })
			pendingVehicleDriveEvent.value = { ...event, token: '' }
		}
	} finally {
		vehicleDrivePromptBusy.value = false
		applyAutoTourCameraInputPolicy()
	}
}

function handleVehicleAutoTourPauseToggleClick(): void {
	const event = pendingVehicleDriveEvent.value
	if (!event || vehicleDrivePromptBusy.value) {
		return
	}
	const targetNodeId = event.targetNodeId ?? event.nodeId ?? null
	if (!targetNodeId) {
		return
	}
	if (!activeAutoTourNodeIds.has(targetNodeId)) {
		return
	}
	const nextPaused = !autoTourPaused.value
	if (!nextPaused) {
		// Resuming: if we paused due to terminal end, first request return-to-start.
		if (autoTourPausedIsTerminal.value && autoTourPausedNodeId.value === targetNodeId) {
			autoTourRuntime.continueFromEnd(targetNodeId)
		}
		autoTourPausedIsTerminal.value = false
		autoTourPausedNodeId.value = null
		autoTourPaused.value = false
	} else {
		// Manual pause: not a terminal condition.
		autoTourPausedIsTerminal.value = false
		autoTourPausedNodeId.value = null
		autoTourPaused.value = true
		applyAutoTourPauseForActiveNodes()
	}
	applyAutoTourCameraInputPolicy()
}

function handleVehicleAutoTourStopClick(): void {
	const event = pendingVehicleDriveEvent.value
	if (!event || vehicleDrivePromptBusy.value) {
		return
	}
	const currentTourNodeId = resolveAutoTourFollowNodeId(
		autoTourFollowNodeId.value,
		cameraViewState.watchTargetId,
		activeAutoTourNodeIds,
		previewNodeMap.keys(),
		autoTourRuntime,
	)
	const promptNodeId = event.targetNodeId ?? event.nodeId ?? null
	const targetNodeId = currentTourNodeId ?? promptNodeId
	if (!targetNodeId) {
		return
	}
	vehicleDrivePromptBusy.value = true
	try {
		autoTourPaused.value = false
		autoTourPausedIsTerminal.value = false
		autoTourPausedNodeId.value = null
		stopTourAndUnfollow(autoTourRuntime, targetNodeId, (n) => {
			activeAutoTourNodeIds.delete(n)
			if (autoTourFollowNodeId.value === n) {
				autoTourFollowNodeId.value = null
				resetCameraFollowState(autoTourCameraFollowState)
				autoTourCameraFollowVelocity.set(0, 0, 0)
				autoTourCameraFollowHasSample = false
				followCameraControlActive = false
				followCameraControlDirty = false
				setCameraViewState('level', null)
			}
		})
		// Stop-tour should close the prompt and place the camera at the vehicle's left-side exit.
		pendingVehicleDriveEvent.value = null
		const aligned = alignCameraToVehicleExitForNode(targetNodeId)
		if (!aligned) {
			appendWarningMessage('Could not find the default exit position after stopping the tour.')
		}
	} finally {
		vehicleDrivePromptBusy.value = false
	}
}

async function handleVehicleDrivePromptConfirm(): Promise<void> {
	const event = pendingVehicleDriveEvent.value
	if (!event || vehicleDrivePromptBusy.value) {
		return
	}
	const targetNodeId = event.targetNodeId ?? event.nodeId ?? null
	if (targetNodeId && activeAutoTourNodeIds.has(targetNodeId)) {
		stopTourAndUnfollow(autoTourRuntime, targetNodeId, (n) => {
			activeAutoTourNodeIds.delete(n)
			if (autoTourFollowNodeId.value === n) {
				autoTourFollowNodeId.value = null
				resetCameraFollowState(autoTourCameraFollowState)
				autoTourCameraFollowVelocity.set(0, 0, 0)
				autoTourCameraFollowHasSample = false
			}
		})
	}
	if (event.sequenceId === '__manual_vehicle_drive__' && controlMode.value !== 'third-person') {
		controlMode.value = 'third-person'
	}
	vehicleDrivePromptBusy.value = true
	try {
		const result = startVehicleDriveMode(event)
		if (!result.success) {
			appendWarningMessage(result.message ?? 'Failed to start drive script.')
			resolveBehaviorToken(event.token, {
				type: 'fail',
				message: result.message ?? 'Failed to start drive script.',
			})
			pendingVehicleDriveEvent.value = null
			return
		}
		handleShowVehicleCockpitEvent()
		pendingVehicleDriveEvent.value = null
	} finally {
		vehicleDrivePromptBusy.value = false
	}
}

function handleVehicleDrivePromptClose(): void {
	const event = pendingVehicleDriveEvent.value
 	if (!event) {
 		return
 	}
	// Resolve token as an abort so scripts know the request was cancelled
	try {
		resolveBehaviorToken(event.token, { type: 'abort', message: 'User cancelled drive request' })
	} catch (_e) {
		// ignore
	}
	pendingVehicleDriveEvent.value = null
	vehicleDrivePromptBusy.value = false
	setVehicleDriveUiOverride('hide')
}

function handleVehicleDriveExitClick(): void {
	if (!vehicleDriveState.active || vehicleDriveExitBusy.value) {
		return
	}
	vehicleDriveExitBusy.value = true
	try {
		const aligned = alignCameraToVehicleExit()
		if (!aligned) {
			appendWarningMessage('Could not find the default exit position; restoring the previous view.')
		}
		handleHideVehicleCockpitEvent()
		pendingVehicleDriveEvent.value = null
		stopVehicleDriveMode({ resolution: { type: 'continue' }, preserveCamera: true })
	} finally {
		vehicleDriveExitBusy.value = false
	}
}

function handleVehicleDriveCameraToggle(): void {
	if (!vehicleDriveState.active) {
		return
	}
	if (controlMode.value !== 'third-person') {
		controlMode.value = 'third-person'
	}
	toggleVehicleDriveOrbitMode()
}

function handleVehicleDriveResetClick(): void {
	if (!vehicleDriveState.active) {
		return
	}
	const resetSuccess = resetActiveVehiclePose()
	if (!resetSuccess) {
		appendWarningMessage('Failed to reset vehicle. Please try again later.')
		return
	}
	updateVehicleDriveCamera(0, { immediate: true })
}

function handleBehaviorRuntimeEvent(event: BehaviorRuntimeEvent) {
	switch (event.type) {
		case 'delay':
			handleDelayEvent(event)
			break
		case 'move-camera':
			handleMoveCameraEvent(event)
			break
		case 'show-alert':
			presentBehaviorAlert(event)
			break
		case 'lantern':
			presentLanternSlides(event)
			break
		case 'play-animation':
			handlePlayAnimationEvent(event)
			break
		case 'trigger-behavior':
			handleTriggerBehaviorEvent(event)
			break
		case 'watch-node':
			handleWatchNodeEvent(event)
			break
		case 'show-purpose-controls':
			handleShowPurposeControlsEvent(event)
			break
		case 'hide-purpose-controls':
			handleHidePurposeControlsEvent()
			break
		case 'set-visibility':
			handleSetVisibilityEvent(event)
			break
		case 'look-level':
			handleLookLevelEvent(event)
			break
		case 'vehicle-drive':
			handleVehicleDriveEvent(event)
			break
		case 'vehicle-debus':
			handleVehicleDebusEvent()
			break
		case 'vehicle-show-cockpit':
			handleShowVehicleCockpitEvent()
			break
		case 'vehicle-hide-cockpit':
			handleHideVehicleCockpitEvent()
			break
		case 'load-scene':
			void handleLoadSceneEvent(event)
			break
		case 'exit-scene':
			void handleExitSceneEvent()
			break
		case 'sequence-complete':
			clearBehaviorAlert()
			resetLanternOverlay()
			break
		case 'sequence-error':
			clearBehaviorAlert()
			resetLanternOverlay()
			console.error('[ScenePreview] Behavior sequence error', event.message)
			break
		default:
			break
	}
}

function handleCanvasClick(event: MouseEvent) {
	if (sceneSwitching.value) {
		return
	}
	const currentRenderer = renderer
	const activeCamera = camera
	const currentScene = scene
	if (!currentRenderer || !activeCamera || !currentScene) {
		return
	}
	if (event.button !== 0) {
		return
	}
	if (event.target !== currentRenderer.domElement) {
		return
	}

	const bounds = currentRenderer.domElement.getBoundingClientRect()
	const width = bounds.width
	const height = bounds.height
	if (width <= 0 || height <= 0) {
		return
	}

	behaviorPointer.x = ((event.clientX - bounds.left) / width) * 2 - 1
	behaviorPointer.y = -((event.clientY - bounds.top) / height) * 2 + 1
	behaviorRaycaster.setFromCamera(behaviorPointer, activeCamera)
	behaviorRaycaster.layers.set(LAYER_BEHAVIOR_INTERACTIVE)
	behaviorRaycaster.layers.enable(LAYER_VEHICLE_INTERACTIVE)

	// Keep InstancedMesh bounds in sync before raycasting so recently moved instances remain pickable.
	if (instancedBoundsHasPending()) {
		flushInstancedBounds()
	}

	const raycastRoots: THREE.Object3D[] = [];
	if (rootGroup) {
		raycastRoots.push(rootGroup);
	}
	if (instancedMeshGroup) {
		raycastRoots.push(instancedMeshGroup);
	}
	if (!raycastRoots.length) {
		return;
	}
	raycastRoots.forEach((root) => root.updateMatrixWorld(true));
	
	const intersections = behaviorRaycaster.intersectObjects(raycastRoots, true)
	if (!intersections.length) {
		return
	}

	for (const intersection of intersections) {
		const resolvedId = resolveNodeIdFromIntersection(intersection)
		if (!resolvedId) {
			continue
		}

		// 1) Behavior click has priority.
		if (hasRegisteredBehaviors()) {
			const directActions = listRegisteredBehaviorActions(resolvedId)
			const behaviorTargetId = directActions.includes('click')
				? resolvedId
				: resolveClickBehaviorAncestorNodeId(resolvedId)
			if (behaviorTargetId) {
				const hitObject = nodeObjectMap.get(behaviorTargetId) ?? intersection.object
				const hitPoint = intersection.point
				const results = triggerBehaviorAction(behaviorTargetId, 'click', {
					pointerEvent: event,
					intersection: {
						object: hitObject,
						point: { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z },
					},
				})
				processBehaviorEvents(results)
				return
			}
		}

	}
}

function resetFirstPersonPointerDelta() {
	if (!firstPersonControls) {
		return
	}
	const internalControls = firstPersonControls as FirstPersonControls & { _pointerX?: number; _pointerY?: number }
	if (typeof internalControls._pointerX === 'number') {
		internalControls._pointerX = 0
	}
	if (typeof internalControls._pointerY === 'number') {
		internalControls._pointerY = 0
	}
}


function syncFirstPersonOrientation() {
	if (!firstPersonControls) {
		return
	}
	const internalControls = firstPersonControls as FirstPersonControls & { _setOrientation?: () => void }
	internalControls._setOrientation?.()
}

function syncLastFirstPersonStateFromCamera() {
	if (!camera) {
		return
	}
	lastFirstPersonState.position.copy(camera.position)
	camera.getWorldDirection(lastFirstPersonState.direction)
}

function clampFirstPersonPitch(force = false) {
	if (!camera) {
		return
	}
	if (!force && controlMode.value !== 'first-person') {
		return
	}
	tempDirection.set(0, 0, 0)
	camera.getWorldDirection(tempDirection)
	const currentPitch = Math.asin(THREE.MathUtils.clamp(tempDirection.y, -1, 1))
	const clampedPitch = THREE.MathUtils.clamp(currentPitch, -FIRST_PERSON_PITCH_LIMIT, FIRST_PERSON_PITCH_LIMIT)
	if (Math.abs(clampedPitch - currentPitch) < 1e-4) {
		return
	}
	const yaw = Math.atan2(tempDirection.x, -tempDirection.z)
	const cosPitch = Math.cos(clampedPitch)
	tempDirection.set(
		Math.sin(yaw) * cosPitch,
		Math.sin(clampedPitch),
		-Math.cos(yaw) * cosPitch,
	)
	tempTarget.copy(camera.position).add(tempDirection)
	camera.lookAt(tempTarget)
	syncFirstPersonOrientation()
	syncLastFirstPersonStateFromCamera()
}

// Reset the active camera to a level (horizontal) view without changing yaw
function resetCameraToLevelView() {
	if (!camera) {
		return
	}
	if (cameraViewState.mode === 'level') {
		setCameraCaging(false)
		return
	}
	activeCameraLookTween = null
	setCameraCaging(false)
	if (controlMode.value === 'first-person' && firstPersonControls) {
		camera.position.y = CAMERA_HEIGHT
		tempDirection.set(0, 0, 0)
		camera.getWorldDirection(tempDirection)
		const startTarget = camera.position.clone().add(tempDirection)
		const yaw = Math.atan2(tempDirection.x, -tempDirection.z)
		tempDirection.set(Math.sin(yaw), 0, -Math.cos(yaw))
		const levelTarget = camera.position.clone().add(tempDirection)
		if (startTarget.distanceToSquared(levelTarget) < 1e-6) {
			firstPersonControls.lookAt(levelTarget.x, levelTarget.y, levelTarget.z)
			clampFirstPersonPitch(true)
			syncFirstPersonOrientation()
			resetFirstPersonPointerDelta()
			syncLastFirstPersonStateFromCamera()
		} else {
			activeCameraLookTween = {
				mode: 'first-person',
				from: startTarget,
				to: levelTarget,
				duration: CAMERA_LEVEL_TWEEN_DURATION,
				elapsed: 0,
			}
			resetFirstPersonPointerDelta()
		}
	} else if (mapControls && camera) {
		const startTarget = mapControls.target.clone()
		const levelTarget = startTarget.clone()
		if (startTarget.distanceToSquared(levelTarget) < 1e-6) {
			mapControls.target.copy(levelTarget)
			mapControls.update()
			camera.lookAt(levelTarget)
			lastOrbitState.target.copy(levelTarget)
			lastOrbitState.position.copy(camera.position)
		} else {
			activeCameraLookTween = {
				mode: 'orbit',
				from: startTarget,
				to: levelTarget,
				duration: CAMERA_LEVEL_TWEEN_DURATION,
				elapsed: 0,
			}
		}
	} else {
		tempDirection.set(0, 0, 0)
		const yaw = Math.atan2(tempDirection.x, -tempDirection.z)
		tempDirection.set(Math.sin(yaw), 0, -Math.cos(yaw))
		tempTarget.copy(camera.position).add(tempDirection)
		camera.lookAt(tempTarget)
	}
	setCameraViewState('level')
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function easeInOutCubic(t: number): number {
	if (t <= 0) {
		return 0
	}
	if (t >= 1) {
		return 1
	}
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function updateOrbitCameraLookTween(delta: number): void {
	if (!activeCameraLookTween || activeCameraLookTween.mode !== 'orbit' || !mapControls) {
		return
	}
	const tween = activeCameraLookTween
	const duration = tween.duration > 0 ? tween.duration : 0.0001
	tween.elapsed = Math.min(tween.elapsed + delta, tween.duration)
	const progress = easeInOutCubic(Math.min(1, tween.elapsed / duration))
	tempTarget.copy(tween.from).lerp(tween.to, progress)
	mapControls.target.copy(tempTarget)
	if (tween.elapsed >= tween.duration) {
		mapControls.target.copy(tween.to)
		activeCameraLookTween = null
	}
}

function updateFirstPersonCameraLookTween(delta: number): void {
	if (!activeCameraLookTween || activeCameraLookTween.mode !== 'first-person' || !firstPersonControls || !camera) {
		return
	}
	const tween = activeCameraLookTween
	const duration = tween.duration > 0 ? tween.duration : 0.0001
	tween.elapsed = Math.min(tween.elapsed + delta, tween.duration)
	const progress = easeInOutCubic(Math.min(1, tween.elapsed / duration))
	tempTarget.copy(tween.from).lerp(tween.to, progress)
	firstPersonControls.lookAt(tempTarget.x, tempTarget.y, tempTarget.z)
	if (tween.elapsed >= tween.duration) {
		firstPersonControls.lookAt(tween.to.x, tween.to.y, tween.to.z)
		clampFirstPersonPitch(true)
		syncFirstPersonOrientation()
		syncLastFirstPersonStateFromCamera()
		activeCameraLookTween = null
	}
}

watch(isPlaying, (playing) => {
	animationMixers.forEach((mixer) => {
		mixer.timeScale = playing ? 1 : 0
	})
})

watch(() => statsContainerRef.value, (value) => {
	if (value) {
		setupStatsPanels()
	}
})

function applyControlMode(mode: ControlMode) {
	const activeCamera = camera
	if (!activeCamera || !renderer) {
		return
	}
	activeCameraLookTween = null
	if (vehicleDriveState.active) {
		syncVehicleDriveCameraMode()
		return
	}
	if (mode === 'first-person') {
		activeCamera.position.copy(lastFirstPersonState.position)
		activeCamera.position.y = CAMERA_HEIGHT
		const target = new THREE.Vector3().copy(lastFirstPersonState.position).add(lastFirstPersonState.direction)
		activeCamera.lookAt(target)
		clampFirstPersonPitch(true)
		syncFirstPersonOrientation()
		resetFirstPersonPointerDelta()
		syncLastFirstPersonStateFromCamera()
	} else {
		activeCamera.position.copy(lastOrbitState.position)
		mapControls?.target.copy(lastOrbitState.target)
		mapControls?.update()
	}
	updateCameraControlActivation()
}

function prepareStatsDom(element: HTMLDivElement, extraClass: string): void {
	element.classList.add('scene-preview__stats-panel', extraClass)
	element.style.position = 'relative'
	element.style.top = '0'
	element.style.left = '0'
	element.style.cursor = 'default'
	element.style.opacity = '1'
	element.style.zIndex = 'auto'
	element.style.pointerEvents = 'none'
	element.style.background = 'rgba(10, 12, 24, 0.88)'
	element.style.borderRadius = '8px'
	element.style.padding = '4px'
	element.style.margin = '0'
	const canvas = element.querySelector('canvas')
	if (canvas instanceof HTMLCanvasElement) {
		canvas.style.display = 'block'
		canvas.style.borderRadius = '6px'
		canvas.style.pointerEvents = 'none'
	}
}

function setupStatsPanels(): void {
	if (typeof window === 'undefined') {
		return
	}
	const container = statsContainerRef.value
	if (!container) {
		return
	}
	if (!memoryStats) {
		const instance = StatsFactory()
		const hasMemoryPanel = instance.dom.children.length > 2
		if (hasMemoryPanel) {
			instance.showPanel(2)
			prepareStatsDom(instance.dom, 'scene-preview__stats-panel--memory')
			container.appendChild(instance.dom)
			memoryStats = instance
			if (memoryFallbackLabel.value !== null) {
				memoryFallbackLabel.value = null
			}
		} else {
			memoryStats = null
			updateMemoryFallback()
		}
	}
	if (memoryStats?.dom.parentElement !== container) {
		container.appendChild(memoryStats!.dom)
	}
}

function teardownStatsPanels(): void {
	if (fpsStats) {
		const dom = fpsStats.dom
		dom.parentElement?.removeChild(dom)
		fpsStats = null
	}
	if (memoryStats) {
		const dom = memoryStats.dom
		dom.parentElement?.removeChild(dom)
		memoryStats = null
	}
	memoryFallbackLabel.value = null
}

function updateMemoryFallback(): void {
	if (typeof performance === 'undefined') {
		memoryFallbackLabel.value = 'Memory monitoring unavailable'
		return
	}
	const perfWithMemory = performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }
	const memory = perfWithMemory.memory
	if (!memory) {
		memoryFallbackLabel.value = 'Memory monitoring unavailable'
		return
	}
	const used = formatByteSize(memory.usedJSHeapSize)
	const limit = formatByteSize(memory.jsHeapSizeLimit)
	const nextLabel = `Memory: ${used} / ${limit}`
	if (memoryFallbackLabel.value !== nextLabel) {
		memoryFallbackLabel.value = nextLabel
	}
}

function updateMemoryStats(): void {
	if (memoryStats) {
		memoryStats.update()
		if (memoryFallbackLabel.value !== null) {
			memoryFallbackLabel.value = null
		}
		return
	}
	updateMemoryFallback()
}

function initRenderer() {
	if (rendererInitialized) {
		console.warn('[ScenePreview] Renderer already initialized; skipping initRenderer()')
		return
	}
	const host = containerRef.value
	if (!host) {
		return
	}
	hidePurposeControls()
	setupStatsPanels()
	renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false,powerPreference: 'high-performance' })
	renderer.outputColorSpace = THREE.SRGBColorSpace
	renderer.toneMapping = THREE.ACESFilmicToneMapping
	renderer.toneMappingExposure = DEFAULT_SKYBOX_SETTINGS.exposure
	renderer.shadowMap.enabled = true
	renderer.shadowMap.type = THREE.PCFSoftShadowMap
	renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2))
	pmremGenerator?.dispose()
	pmremGenerator = new THREE.PMREMGenerator(renderer)
	host.appendChild(renderer.domElement)

	scene = new THREE.Scene()
	scene.background = new THREE.Color(DEFAULT_BACKGROUND_COLOR)
	scene.environmentIntensity = SKY_ENVIRONMENT_INTENSITY
	const ambient = ensureEnvironmentAmbientLight()
	if (ambient) {
		ambient.color.set(DEFAULT_ENVIRONMENT_AMBIENT_COLOR)
		ambient.intensity = DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY
	}

	camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000)
  	camera.position.set(0, CAMERA_HEIGHT, 0)
	listener = new THREE.AudioListener()
	camera.add(listener)
  	listener.setMasterVolume(volumePercent.value / 100)
	scene.add(camera)

	rootGroup = new THREE.Group()
	rootGroup.name = 'ScenePreviewRoot'
	scene.add(rootGroup)
	scene.add(instancedMeshGroup)
	clearInstancedMeshes()
	stopInstancedMeshSubscription?.()
	stopInstancedMeshSubscription = subscribeInstancedMeshes((mesh) => {
		attachInstancedMesh(mesh)
	})
	initControls()
	updateCanvasCursor()
	renderer.domElement.addEventListener('click', handleCanvasClick)
	handleResize()

	window.addEventListener('resize', handleResize)
	document.addEventListener('fullscreenchange', handleFullscreenChange)
	window.addEventListener('keydown', handleKeyDown)
	window.addEventListener('keyup', handleKeyUp)

	startAnimationLoop()
	rendererInitialized = true
}

function initControls() {
	if (!camera || !renderer) {
		return
	}
	firstPersonControls = new FirstPersonControls(camera, renderer.domElement)
	firstPersonControls.lookSpeed = FIRST_PERSON_LOOK_SPEED
	firstPersonControls.movementSpeed = FIRST_PERSON_MOVE_SPEED
	firstPersonControls.lookVertical = true

	mapControls = new MapControls(camera, renderer.domElement)
	mapControls.enableDamping = false
	mapControls.dampingFactor = 0.08
	mapControls.maxPolarAngle = Math.PI / 2 - 0.05
	mapControls.minDistance = MAP_CONTROL_DEFAULTS.minDistance
	mapControls.maxDistance = MAP_CONTROL_DEFAULTS.maxDistance
	mapControls.enablePan = MAP_CONTROL_DEFAULTS.enablePan
	mapControls.target.copy(lastOrbitState.target)
	mapControls.addEventListener('start', () => {
		activeCameraLookTween = null
		if (vehicleDriveState.active && vehicleDriveCameraMode.value === 'follow') {
			followCameraControlActive = true
		}
	})
	mapControls.addEventListener('end', () => {
		followCameraControlActive = false
	})
	mapControls.addEventListener('change', () => {
		if (followCameraControlActive) {
			followCameraControlDirty = true
		}
	})
	applyControlMode(controlMode.value)
}

function handleResize() {
	if (!renderer || !camera || !containerRef.value) {
		return
	}
	const bounds = containerRef.value.getBoundingClientRect()
	const width = Math.max(1, bounds.width)
	const height = Math.max(1, bounds.height)
	renderer.setSize(width, height, false)
	camera.aspect = width / height
	camera.updateProjectionMatrix()
}

function handleFullscreenChange() {
	isFullscreen.value = Boolean(document.fullscreenElement)
}

function handleKeyDown(event: KeyboardEvent) {
	if (sceneSwitching.value) {
		return
	}
	if (isInputLikeElement(event.target)) {
		return
	}
	if (event.code === 'KeyQ') {
		rotationState.q = true
		return
	}
	if (event.code === 'KeyE') {
		rotationState.e = true
		return
	}
	if (handleVehicleDriveKeyboardInput(event, true)) {
		return
	}
	if (event.repeat) {
		return
	}
	switch (event.code) {
		case 'Digit1':
			controlMode.value = 'first-person'
			break
		case 'Digit3':
			controlMode.value = 'third-person'
			break
		case 'KeyP':
			event.preventDefault()
			captureScreenshot()
			break
		default:
			break
	}
}

function handleKeyUp(event: KeyboardEvent) {
	if (sceneSwitching.value) {
		return
	}
	if (isInputLikeElement(event.target)) {
		return
	}
	if (event.code === 'KeyQ') {
		rotationState.q = false
		return
	}
	if (event.code === 'KeyE') {
		rotationState.e = false
		return
	}
	if (handleVehicleDriveKeyboardInput(event, false)) {
		return
	}
}

/**
 * Per-frame camera input and control updates.
 *
 * Workflow:
 * - First-person: apply keyboard yaw (Q/E), update controls, apply look tween, clamp pitch.
 * - Orbit: update orbit look tween, update controls, persist last orbit camera+target.
 */
function updateCameraControlsForFrame(
	delta: number,
	activeCamera: THREE.PerspectiveCamera,
	followCameraActive: boolean,
): void {
	if (controlMode.value === 'first-person' && firstPersonControls && !vehicleDriveState.active) {
		const rotationDirection = Number(rotationState.q) - Number(rotationState.e)
		if (rotationDirection !== 0 && activeCameraLookTween?.mode === 'first-person') {
			activeCameraLookTween = null
		}
		if (rotationDirection !== 0) {
			const yawDegrees = rotationDirection * FIRST_PERSON_ROTATION_SPEED * delta
			const controlsInternal = firstPersonControls as FirstPersonControls & { _lon: number }
			const currentLon = controlsInternal._lon ?? 0
			const nextLon = THREE.MathUtils.euclideanModulo(currentLon + yawDegrees, 360)
			controlsInternal._lon = nextLon
		}
		firstPersonControls.update(delta)
		updateFirstPersonCameraLookTween(delta)
		clampFirstPersonPitch()
		activeCamera.position.y = CAMERA_HEIGHT
		syncLastFirstPersonStateFromCamera()
		return
	}

	if (mapControls && !followCameraActive) {
		updateOrbitCameraLookTween(delta)
		mapControls.update()
		lastOrbitState.position.copy(activeCamera.position)
		lastOrbitState.target.copy(mapControls.target)
	}
}

/**
 * Per-frame simulation updates when playback is active.
 *
 * Workflow:
 * - Components/animations/effects
 * - Vehicle forces and physics step
 * - Derived state (speed)
 */
function updatePlaybackSystemsForFrame(delta: number): void {
	previewComponentManager.update(delta)
	animationMixers.forEach((mixer) => mixer.update(delta))
	effectRuntimeTickers.forEach((tick) => {
		try {
			tick(delta)
		} catch (error) {
			console.warn('[ScenePreview] Failed to advance effect runtime', error)
		}
	})
	if (autoTourPaused.value) {
		applyAutoTourPauseForActiveNodes()
	} else {
		autoTourRuntime.update(delta)
	}
	applyVehicleDriveForces()
	stepPhysicsWorld(delta)
	updateVehicleSpeedFromVehicle()
	updateVehicleWheelVisuals(delta)
}

function updateAutoTourCameraForFrame(
	delta: number,
	followCameraActive: boolean,
	activeCamera: THREE.PerspectiveCamera,
): void {
	if (!followCameraActive) {
		return
	}
	if (vehicleDriveState.active) {
		return
	}
	// Keep in sync with runtime for script-triggered starts/stops.
	// (active tour syncing + camera input policy are handled by syncAutoTourCameraInputPolicyForFrame)
	const nodeId = resolveAutoTourFollowNodeId(
		autoTourFollowNodeId.value,
		cameraViewState.watchTargetId,
		activeAutoTourNodeIds,
		previewNodeMap.keys(),
		autoTourRuntime,
	)
	if (!nodeId) {
		if (autoTourFollowNodeId.value) {
			autoTourFollowNodeId.value = null
			resetCameraFollowState(autoTourCameraFollowState)
			autoTourCameraFollowVelocity.set(0, 0, 0)
			autoTourCameraFollowHasSample = false
		}
		return
	}
	if (autoTourFollowNodeId.value !== nodeId) {
		autoTourFollowNodeId.value = nodeId
		resetCameraFollowState(autoTourCameraFollowState)
	}
	const object = nodeObjectMap.get(nodeId) ?? null
	if (!object) {
		return
	}
	object.updateMatrixWorld(true)
	// Use bounding-box center as anchor (fallback to world position).
	tempBox.makeEmpty()
	tempBox.setFromObject(object)
	if (tempBox.isEmpty()) {
		object.getWorldPosition(tempPosition)
	} else {
		tempBox.getCenter(tempPosition)
	}

	// Pause only affects auto-tour (keep manual-drive behavior unchanged).
	// Still allow active-node sync / follow-node resolution above, but freeze camera placement updates.
	if (autoTourPaused.value) {
		return
	}

	if (!autoTourCameraFollowHasSample || delta <= 0) {
		autoTourCameraFollowLastAnchor.copy(tempPosition)
		autoTourCameraFollowVelocity.set(0, 0, 0)
		autoTourCameraFollowHasSample = true
	} else {
		const rawVelocity = autoTourCameraFollowVelocityScratch
			.copy(tempPosition)
			.sub(autoTourCameraFollowLastAnchor)
			.multiplyScalar(1 / delta)
		autoTourCameraFollowLastAnchor.copy(tempPosition)
		const alpha = computeFollowLerpAlpha(delta, 8)
		autoTourCameraFollowVelocity.lerp(rawVelocity, alpha)
	}

	object.getWorldQuaternion(tempQuaternion)

	// Prefer movement direction as heading so “behind” matches vehicle-drive behavior.
	// Many scene nodes use +X (or other) as visual forward; using quaternion axes directly can place the camera on the side.
	const planarVelocityDir = tempDirection.set(autoTourCameraFollowVelocity.x, 0, autoTourCameraFollowVelocity.z)
	if (planarVelocityDir.lengthSq() > 1e-6) {
		planarVelocityDir.normalize()
	} else {
		// Fallback: use Three.js world direction (object -Z), projected to XZ.
		object.getWorldDirection(planarVelocityDir)
		planarVelocityDir.y = 0
		if (planarVelocityDir.lengthSq() > 1e-6) {
			planarVelocityDir.normalize()
		} else {
			planarVelocityDir.set(0, 0, 1)
		}
	}

	const placement = computeFollowPlacement(getApproxDimensions(object))
	const updated = autoTourCameraFollowController.update({
		follow: autoTourCameraFollowState,
		placement,
		anchorWorld: tempPosition,
		desiredForwardWorld: planarVelocityDir,
		velocityWorld: autoTourCameraFollowVelocity,
		deltaSeconds: delta,
		ctx: { camera: activeCamera, mapControls: mapControls ?? undefined },
		worldUp: AUTO_TOUR_CAMERA_WORLD_UP,
		applyOrbitTween: true,
		followControlsDirty: followCameraControlDirty,
		onUpdateOrbitLookTween: updateOrbitCameraLookTween,
	})
	if (updated && mapControls) {
		lastOrbitState.position.copy(activeCamera.position)
		lastOrbitState.target.copy(mapControls.target)
	}
}

/**
 * Updates the vehicle drive camera and keeps orbit-state cache in sync.
 */
function updateVehicleCameraForFrame(delta: number, followCameraActive: boolean, activeCamera: THREE.PerspectiveCamera): void {
	const cameraUpdated = updateVehicleDriveCamera(delta, { applyOrbitTween: followCameraActive })
	if (followCameraActive && cameraUpdated && mapControls) {
		lastOrbitState.position.copy(activeCamera.position)
		lastOrbitState.target.copy(mapControls.target)
	}
}

/**
 * Updates systems that depend on camera pose.
 * Throttled internally by `shouldUpdateCameraDependentSystems`.
 */
function updateCameraDependentSystemsForFrame(activeCamera: THREE.PerspectiveCamera, delta: number): void {
	const shouldUpdateCameraSystems = shouldUpdateCameraDependentSystems(activeCamera, delta)
	if (!shouldUpdateCameraSystems) {
		return
	}
	terrainScatterRuntime.update(activeCamera, resolveGroundMeshObject)
	updateInstancedCullingAndLod()
	updateBehaviorProximity()
	// Keep ground chunk meshes in sync with camera position.
	if (cachedGroundNodeId && cachedGroundDynamicMesh) {
		const groundObject = nodeObjectMap.get(cachedGroundNodeId) ?? null
		if (groundObject) {
			updateGroundChunks(groundObject, cachedGroundDynamicMesh, activeCamera)
			syncTerrainPaintPreviewForGround(groundObject, cachedGroundDynamicMesh)
			if (isGroundChunkStreamingDebugVisible.value || isGroundChunkStatsVisible.value) {
				syncGroundChunkStreamingDebug(groundObject, cachedGroundDynamicMesh, activeCamera, {
					renderHelpers: isGroundChunkStreamingDebugVisible.value,
				})
			}
		}
	}
}

/**
 * Updates miscellaneous lightweight systems that are safe to run every frame.
 */
function updatePerFrameDiagnostics(delta: number): void {
	updateLazyPlaceholders(delta)
	if (isRigidbodyDebugVisible.value) {
		updateRigidbodyDebugTransforms()
	}
}

function syncRendererDebugForFrame(currentRenderer: THREE.WebGLRenderer): void {
	if (!isRendererDebugVisible.value) {
		return
	}
	const pixelRatio = Math.max(0, currentRenderer.getPixelRatio?.() ?? 1)
	currentRenderer.getSize(rendererSizeHelper)
	rendererDebug.pixelRatio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1
	rendererDebug.width = Math.max(0, Math.round(rendererSizeHelper.x * rendererDebug.pixelRatio))
	rendererDebug.height = Math.max(0, Math.round(rendererSizeHelper.y * rendererDebug.pixelRatio))
	rendererDebug.calls = currentRenderer.info?.render?.calls ?? 0
	rendererDebug.triangles = currentRenderer.info?.render?.triangles ?? 0
	rendererDebug.geometries = currentRenderer.info?.memory?.geometries ?? 0
	rendererDebug.textures = currentRenderer.info?.memory?.textures ?? 0
}

function syncInstancedMatrixUploadEstimateForFrame(): void {
	if (!isInstancingDebugVisible.value) {
		return
	}
	let bytes = 0
	instancedMatrixUploadMeshes.forEach((mesh) => {
		const array = mesh.instanceMatrix?.array as ArrayBufferView | undefined
		if (!array) {
			return
		}
		bytes += array.byteLength
	})
	instancingDebug.instanceMatrixUploadKb = Math.max(0, Math.round(bytes / 1024))
}

function startAnimationLoop() {
	if (animationFrameHandle) {
		return
	}
	const currentRenderer = renderer
	const currentScene = scene
	const activeCamera = camera
	if (!currentRenderer || !currentScene || !activeCamera) {
		return
	}
	clock.start()
	const renderLoop = () => {
		animationFrameHandle = requestAnimationFrame(renderLoop)
		fpsStats?.begin()
		const delta = clock.getDelta()
		if (isInstancingDebugVisible.value) {
			instancedMatrixUploadMeshes.clear()
		}
		// Tick shared instanced-bounds tracker (handles throttled flush)
		tickInstancedBounds(delta)

		// 1) Input / camera controls
		updateSteeringAutoCenter(delta)
		syncAutoTourCameraInputPolicyForFrame(delta)
		const vehicleFollowCameraActive = vehicleDriveState.active && vehicleDriveCameraMode.value === 'follow'
		const autoTourFollowCameraActive = Boolean(autoTourFollowNodeId.value) && !vehicleDriveState.active
		const followCameraActive = vehicleFollowCameraActive || autoTourFollowCameraActive
		updateCameraControlsForFrame(delta, activeCamera, followCameraActive)

		// 2) Simulation (only when playing)
		if (isPlaying.value) {
			updatePlaybackSystemsForFrame(delta)
		}

		// 3) Vehicle camera and camera-dependent systems
		updateAutoTourCameraForFrame(delta, autoTourFollowCameraActive, activeCamera)
		updateVehicleCameraForFrame(delta, vehicleFollowCameraActive, activeCamera)
		updateCameraDependentSystemsForFrame(activeCamera, delta)
		updatePerFrameDiagnostics(delta)
		// cloudRenderer?.update(delta)

		// 4) Render + stats
		currentRenderer.render(currentScene, activeCamera)
		syncRendererDebugForFrame(currentRenderer)
		syncInstancedMatrixUploadEstimateForFrame()
		fpsStats?.end()
		updateMemoryStats()
	}
	renderLoop()
}

function stopAnimationLoop() {
	if (animationFrameHandle) {
		cancelAnimationFrame(animationFrameHandle)
		animationFrameHandle = 0
	}
}

function disposeScene(options: { preservePreviewNodeMap?: boolean } = {}) {
	clearBehaviorDelayTimers()
	syncGroundCache(null)
	instancedMatrixCache.clear()
	cameraDependentUpdateInitialized = false
	cameraDependentUpdateElapsed = 0
	lastCameraDependentUpdatePosition.set(0, 0, 0)
	lastCameraDependentUpdateQuaternion.identity()
	releaseTerrainScatterInstances()
	resetProtagonistPoseState()
	nodeObjectMap.forEach((_object, nodeId) => {
		releaseModelInstance(nodeId)
	})
	nodeObjectMap.clear()
	if (vehicleDriveState.active) {
		stopVehicleDriveMode({ resolution: { type: 'abort', message: 'Scene reset; driving ended.' } })
	}
	autoTourRuntime.reset()
	activeAutoTourNodeIds.clear()
	autoTourFollowNodeId.value = null
	resetCameraFollowState(autoTourCameraFollowState)
	autoTourCameraFollowVelocity.set(0, 0, 0)
	autoTourCameraFollowHasSample = false
	followCameraControlActive = false
	followCameraControlDirty = false
	resetPhysicsWorld()
	if (!options.preservePreviewNodeMap) {
		previewNodeMap.clear()
	}
	previewComponentManager.reset()
	resetBehaviorRuntime()
	resetBehaviorProximity()
	resetAnimationControllers()
	disposeRigidbodyDebugHelpers()
	disposeGroundChunkDebugHelpers()
	hidePurposeControls()
	activeCameraLookTween = null
	setCameraCaging(false)
	setCameraViewState('level', null)
	dismissBehaviorAlert()
	resetLanternOverlay()
	resetAssetResolutionCaches()
	lazyPlaceholderStates.clear()
	activeLazyLoadCount = 0
	disposeInstancedCullingVisualization()
	if (!rootGroup) {
		return
	}
	const disposables: THREE.Object3D[] = []
	rootGroup.traverse((object) => {
		disposables.push(object)
	})
	disposables.forEach((object) => disposeObjectResources(object))
	rootGroup.clear()
	clearInstancedMeshes()
}

function disposeSkyEnvironment() {
	if (skyEnvironmentTarget) {
		skyEnvironmentTarget.dispose()
		skyEnvironmentTarget = null
	}
}

function disposeSkyResources() {
	disposeSkyEnvironment()
	if (!sky) {
		return
	}
	sky.parent?.remove(sky)
	const material = sky.material
	if (Array.isArray(material)) {
		material.forEach((entry) => entry?.dispose?.())
	} else {
		material?.dispose?.()
	}
	sky.geometry?.dispose?.()
	sky = null
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
	if (!scene) {
		return
	}
	if (sky) {
		if (sky.parent !== scene) {
			scene.add(sky)
		}
		syncSkyVisibility()
		return
	}
	sky = new Sky()
	sky.name = 'HarmonySky'
	sky.scale.setScalar(SKY_SCALE)
	sky.frustumCulled = false
	scene.add(sky)
	syncSkyVisibility()
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
	const sunUniform = uniforms?.sunPosition
	if (sunUniform?.value instanceof THREE.Vector3) {
		sunUniform.value.copy(skySunPosition)
	} else if (sunUniform) {
		sunUniform.value = skySunPosition.clone()
	}
	applySunDirectionToSunLight()
}

function ensureSunDirectionalLight(): THREE.DirectionalLight | null {
	if (!scene) {
		return null
	}

	if (!sunDirectionalLight) {
		const light = new THREE.DirectionalLight(0xffffff, 1.05)
		light.name = 'SkySunLight'
		light.castShadow = true
		light.shadow.mapSize.set(2048, 2048)
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

	return sunDirectionalLight
}

function applySunDirectionToSunLight() {
	const light = ensureSunDirectionalLight()
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
}

function ensureEnvironmentAmbientLight(): THREE.AmbientLight | null {
	if (!scene) {
		return null
	}
	if (!environmentAmbientLight) {
		environmentAmbientLight = new THREE.AmbientLight(
			DEFAULT_ENVIRONMENT_AMBIENT_COLOR,
			DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY,
		)
		scene.add(environmentAmbientLight)
	} else if (environmentAmbientLight.parent !== scene) {
		scene.add(environmentAmbientLight)
	}
	return environmentAmbientLight
}

function applySkyEnvironmentToScene() {
	if (!scene) {
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

function applySkyboxSettings(settings: SceneSkyboxSettings | null) {
	if (!renderer || !scene) {
		return
	}
	if (!settings) {
		disposeSkyEnvironment()
		scene.environment = null
		renderer.toneMappingExposure = DEFAULT_SKYBOX_SETTINGS.exposure
		cloudRenderer?.setSkyboxSettings(null)
		return
	}
	ensureSkyExists()
	if (!sky) {
		return
	}
	const skyMaterial = sky.material as THREE.ShaderMaterial
	const uniforms = skyMaterial.uniforms
	const assignUniform = (key: string, value: number) => {
		const uniform = uniforms?.[key]
		if (!uniform) {
			return
		}
		if (typeof uniform.value === 'number') {
			uniform.value = value
			return
		}
		if (uniform.value && typeof uniform.value === 'object' && 'setScalar' in uniform.value) {
			uniform.value.setScalar?.(value)
			return
		}
		uniform.value = value
	}
	assignUniform('turbidity', settings.turbidity)
	assignUniform('rayleigh', settings.rayleigh)
	assignUniform('mieCoefficient', settings.mieCoefficient)
	assignUniform('mieDirectionalG', settings.mieDirectionalG)
	updateSkyLighting(settings)
	renderer.toneMappingExposure = settings.exposure
	if (!pmremGenerator) {
		pmremGenerator = new THREE.PMREMGenerator(renderer)
	}
	disposeSkyEnvironment()
	const previousVisibility = sky.visible
	sky.visible = true
	skyEnvironmentTarget = pmremGenerator.fromScene(sky as unknown as THREE.Scene)
	sky.visible = previousVisibility
	syncSkyVisibility()
	applySkyEnvironmentToScene()

	if (cloudRenderer) {
		cloudRenderer.setSunPosition(skySunPosition)
		cloudRenderer.setSkyboxSettings(settings)
	} else {
		cloudRenderer = new SceneCloudRenderer({
			scene,
			assetResolver: async (source) => {
				const resolved = await resolveAssetUrlReference(source)
				if (!resolved) {
					return null
				}
				return {
					url: resolved.url,
					dispose: resolved.dispose,
				}
			},
			sunPosition: skySunPosition,
		})
		cloudRenderer.setSkyboxSettings(settings)
	}
}

function disposeBackgroundResources() {
	const previousTexture = backgroundTexture
	if (previousTexture) {
		if (scene && scene.background === previousTexture) {
			scene.background = null
		}
		previousTexture.dispose()
	}
	backgroundTexture = null
	backgroundTextureCleanup?.()
	backgroundTextureCleanup = null
	backgroundAssetId = null
}

function disposeEnvironmentTarget() {
	if (environmentMapTarget) {
		if (scene && scene.environment === environmentMapTarget.texture) {
			scene.environment = null
			scene.environmentIntensity = 1
		}
		environmentMapTarget.dispose()
	}
	environmentMapTarget = null
	environmentMapAssetId = null
}

async function loadEnvironmentTextureFromAsset(
	assetId: string,
): Promise<{ texture: THREE.Texture; dispose?: () => void } | null> {
	const resolved = await resolveAssetUrlReference(assetId)
	if (!resolved) {
		return null
	}
	const dispose = resolved.dispose
	try {
		const texture = await rgbeLoader.loadAsync(resolved.url)
		texture.mapping = THREE.EquirectangularReflectionMapping
		texture.needsUpdate = true
		return { texture, dispose }
	} catch (error) {
		console.warn('[ScenePreview] Failed to load environment texture', assetId, error)
		return null
	}
}

function applyAmbientLightSettings(settings: EnvironmentSettings) {
	const ambient = ensureEnvironmentAmbientLight()
	if (!ambient) {
		return
	}
	ambient.color.set(settings.ambientLightColor)
	ambient.intensity = settings.ambientLightIntensity
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

function applyPhysicsEnvironmentSettings(settings: EnvironmentSettings) {
	const gravity = clampNumber(settings.gravityStrength, 0, 100, DEFAULT_ENVIRONMENT_GRAVITY)
	physicsGravity.set(0, -gravity, 0)
	physicsContactRestitution = clampNumber(
		settings.collisionRestitution,
		0,
		1,
		DEFAULT_ENVIRONMENT_RESTITUTION,
	)
	physicsContactFriction = clampNumber(
		settings.collisionFriction,
		0,
		1,
		DEFAULT_ENVIRONMENT_FRICTION,
	)
	if (physicsWorld) {
		physicsWorld.gravity.set(physicsGravity.x, physicsGravity.y, physicsGravity.z)
		physicsWorld.defaultContactMaterial.friction = physicsContactFriction
		physicsWorld.defaultContactMaterial.restitution = physicsContactRestitution
		physicsWorld.defaultContactMaterial.contactEquationStiffness = 1000
	}
}

async function applyBackgroundSettings(
	background: EnvironmentSettings['background'],
): Promise<boolean> {
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
	if (background.mode !== 'hdri' || !background.hdriAssetId) {
		disposeBackgroundResources()
		scene.background = new THREE.Color(background.solidColor)
		return true
	}
	if (backgroundTexture && backgroundAssetId === background.hdriAssetId) {
		scene.background = backgroundTexture
		return true
	}
	const loaded = await loadEnvironmentTextureFromAsset(background.hdriAssetId)
	if (!loaded || token !== backgroundLoadToken) {
		if (loaded) {
			loaded.texture.dispose()
			loaded.dispose?.()
		}
		return false
	}
	disposeBackgroundResources()
	backgroundTexture = loaded.texture
	backgroundAssetId = background.hdriAssetId
	backgroundTextureCleanup = loaded.dispose ?? null
	scene.background = backgroundTexture
	return true
}

async function applyEnvironmentMapSettings(
	mapSettings: EnvironmentSettings['environmentMap'],
): Promise<boolean> {
	environmentMapLoadToken += 1
	const token = environmentMapLoadToken
	if (!scene) {
		return false
	}
	if (mapSettings.mode !== 'custom' || !mapSettings.hdriAssetId) {
		disposeEnvironmentTarget()
		if (mapSettings.mode === 'skybox') {
			applySkyEnvironmentToScene()
		} else {
			scene.environment = null
			scene.environmentIntensity = 1
		}
		return true
	}
	if (!pmremGenerator || !renderer) {
		return false
	}
	if (environmentMapTarget && environmentMapAssetId === mapSettings.hdriAssetId) {
		scene.environment = environmentMapTarget.texture
		scene.environmentIntensity = 1
		return true
	}
	const loaded = await loadEnvironmentTextureFromAsset(mapSettings.hdriAssetId)
	if (!loaded || token !== environmentMapLoadToken) {
		if (loaded) {
			loaded.texture.dispose()
			loaded.dispose?.()
		}
		return false
	}
	const target = pmremGenerator.fromEquirectangular(loaded.texture)
	loaded.dispose?.()
	loaded.texture.dispose()
	if (!target || token !== environmentMapLoadToken) {
		target?.dispose()
		return false
	}
	disposeEnvironmentTarget()
	environmentMapTarget = target
	environmentMapAssetId = mapSettings.hdriAssetId
	scene.environment = target.texture
	scene.environmentIntensity = 1
	return true
}

async function applyEnvironmentSettingsToScene(settings: EnvironmentSettings) {
	const snapshot = cloneEnvironmentSettingsLocal(settings)
	applyPhysicsEnvironmentSettings(snapshot)
	if (!scene) {
		return
	}
	applyAmbientLightSettings(snapshot)
	applyFogSettings(snapshot)
	const backgroundApplied = await applyBackgroundSettings(snapshot.background)
	const environmentApplied = await applyEnvironmentMapSettings(snapshot.environmentMap)
	void backgroundApplied
	void environmentApplied
}

function disposeEnvironmentResources() {
	disposeBackgroundResources()
	disposeEnvironmentTarget()
	backgroundLoadToken += 1
	environmentMapLoadToken += 1
	if (environmentAmbientLight) {
		environmentAmbientLight.parent?.remove(environmentAmbientLight)
		environmentAmbientLight.dispose?.()
		environmentAmbientLight = null
	}
}

function resolveTextureExtension(entry: AssetCacheEntry | null, ref: SceneMaterialTextureRef): string {
	const candidates = [entry?.filename, entry?.downloadUrl, ref.assetId]
	for (const candidate of candidates) {
		if (!candidate) {
			continue
		}
		const match = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(candidate)
		if (match && match[1]) {
			return match[1].toLowerCase()
		}
	}
	return ''
}

async function resolveMaterialTexture(ref: SceneMaterialTextureRef): Promise<THREE.Texture | null> {
	const cacheKey = ref.assetId?.trim()
	if (!cacheKey) {
		return null
	}
	if (materialTextureCache.has(cacheKey)) {
		return materialTextureCache.get(cacheKey) ?? null
	}
	if (pendingMaterialTextureRequests.has(cacheKey)) {
		return pendingMaterialTextureRequests.get(cacheKey) ?? null
	}

	const pending = (async (): Promise<THREE.Texture | null> => {
		if (!editorResourceCache) {
			return null
		}
		const entry = await editorResourceCache.acquireAssetEntry(cacheKey)
		if (!entry) {
			return null
		}
		const source = entry.blobUrl ?? entry.downloadUrl ?? ''
		if (!source) {
			return null
		}

		const extension = resolveTextureExtension(entry, ref)
		try {
			let texture: THREE.Texture
			if (extension === 'exr') {
				texture = await exrLoader.loadAsync(source)
			} else if (extension === 'hdr' || extension === 'hdri' || extension === 'rgbe') {
				texture = await rgbeLoader.loadAsync(source)
			} else {
				texture = await textureLoader.loadAsync(source)
			}
			texture.name = ref.name ?? entry.filename ?? cacheKey
			texture.colorSpace = THREE.LinearSRGBColorSpace
			texture.needsUpdate = true
			materialTextureCache.set(cacheKey, texture)
			return texture
		} catch (error) {
			console.warn('[ScenePreview] Failed to load texture', cacheKey, error)
			return null
		}
	})()

	pendingMaterialTextureRequests.set(cacheKey, pending)
	try {
		const texture = await pending
		if (!texture) {
			materialTextureCache.delete(cacheKey)
		}
		return texture
	} finally {
		pendingMaterialTextureRequests.delete(cacheKey)
	}
}

const materialOverrideOptions: MaterialTextureAssignmentOptions = {
	resolveTexture: resolveMaterialTexture,
	warn: (message) => {
		if (message) {
			console.warn('[ScenePreview] %s', message)
		}
	},
}

function disposeMaterialTextureCache() {
	materialTextureCache.forEach((texture) => texture.dispose?.())
	materialTextureCache.clear()
	pendingMaterialTextureRequests.clear()
}

function disposeObjectResources(object: THREE.Object3D) {
	const skipDispose = (object.userData as Record<string, unknown> | undefined)?.__harmonySkipDispose === true
	if (skipDispose) {
		return
	}

	const mesh = object as THREE.Mesh
	if ((mesh as any).isMesh) {
		// Instanced meshes (especially those backed by shared asset cache geometry/materials)
		// must not dispose shared resources here, otherwise later scene rebuilds will render nothing.
		if ((mesh as any).isInstancedMesh) {
			return
		}
		mesh.geometry?.dispose?.()
		const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
		materials.forEach((material) => {
			if (!material) {
				return
			}
			disposeMaterialTextures(material)
			material.dispose?.()
		})
	}
}

function removeNodeSubtree(nodeId: string) {
	const target = nodeObjectMap.get(nodeId)
	if (!target) {
		return
	}
	const ancestors: THREE.Object3D[] = []
	target.traverse((child) => {
		const id = child.userData?.nodeId as string | undefined
		if (id) {
			releaseModelInstance(id)
			nodeObjectMap.delete(id)
			removeRigidbodyInstance(id)
			previewComponentManager.removeNode(id)
			const controller = nodeAnimationControllers.get(id)
			if (controller) {
				try {
					controller.mixer.stopAllAction()
				} catch (error) {
					console.warn('[ScenePreview] Failed to stop animation mixer for removed node', error)
				}
				nodeAnimationControllers.delete(id)
			}
		}
		ancestors.push(child)
	})
	target.parent?.remove(target)
	ancestors.forEach((object) => disposeObjectResources(object))
}

function registerSubtree(object: THREE.Object3D, pending?: Map<string, THREE.Object3D>) {
	object.traverse((child) => {
		// Keep InstancedMesh visible: default bounding volumes can be too small,
		// causing frustum culling to hide instances far from origin.
		if ((child as any).isInstancedMesh) {
			child.layers.enable(LAYER_BEHAVIOR_INTERACTIVE)
			;(child as THREE.Object3D & { frustumCulled?: boolean }).frustumCulled = false
		}

		const nodeId = child.userData?.nodeId as string | undefined
		if (nodeId) {
			const existing = nodeObjectMap.get(nodeId)
			const isPlaceholder = child.userData?.lazyAsset?.placeholder === true
			const existingIsPreferred = existing && existing !== child && isPlaceholder && existing.userData?.lazyAsset?.placeholder !== true
			if (existingIsPreferred) {
				return
			}
			nodeObjectMap.set(nodeId, child)
			ensureRigidbodyBindingForObject(nodeId, child)
			pending?.delete(nodeId)
			attachRuntimeForNode(nodeId, child)
			syncInteractionLayersForNode(nodeId, child)
			const instancedAssetId = child.userData?.instancedAssetId as string | undefined
			if (instancedAssetId) {
				ensureInstancedMeshesRegistered(instancedAssetId)
				syncInstancedTransform(child)
			}
			const nodeState = resolveNodeById(nodeId)
			if (!nodeState) {
				console.warn(
					'[ScenePreview] Runtime object has nodeId missing from preview node state; runtime bindings may be incomplete',
					nodeId,
				)
			}
			const wallState = nodeState?.components?.[WALL_COMPONENT_TYPE] as SceneNodeComponentState<any> | undefined
			const isAirWall = Boolean(wallState?.enabled !== false && (wallState as any)?.props?.isAirWall)
			const initialVisibility = resolveGuideboardInitialVisibility(nodeState)
			if (initialVisibility !== null) {
				child.visible = initialVisibility
				updateBehaviorVisibility(nodeId, child.visible)
				syncInstancedTransform(child)
			}

			// Ensure air walls remain invisible even in preview.
			// Collision is handled by physics bodies and is unaffected by render visibility.
			if (isAirWall) {
				child.visible = false
				updateBehaviorVisibility(nodeId, false)
				syncInstancedTransform(child)
			}
				if (child.userData?.protagonist) {
					const protagonistCameraActive = !vehicleDriveState.active && (controlMode.value === 'first-person' || cameraViewState.mode === 'level')
					syncProtagonistCameraPose({
						object: child,
						applyToCamera: protagonistCameraActive,
					})
				}
		}
	})
}

function adoptNodeFromPending(nodeId: string, parent: THREE.Object3D, pending: Map<string, THREE.Object3D>): THREE.Object3D | null {
	const candidate = pending.get(nodeId)
	if (!candidate) {
		return null
	}
	candidate.parent?.remove(candidate)
	parent.add(candidate)
	registerSubtree(candidate, pending)
	return candidate
}

function ensureChildOrder(parent: THREE.Object3D, child: THREE.Object3D, orderIndex: number) {
	if (child.parent !== parent) {
		parent.add(child)
	}
	const managedChildren = parent.children.filter((entry) => !!entry.userData?.nodeId)
	const desiredSibling = managedChildren[orderIndex]
	const currentIndex = parent.children.indexOf(child)
	if (!desiredSibling) {
		const firstHelper = parent.children.findIndex((entry) => !entry.userData?.nodeId)
		parent.children.splice(currentIndex, 1)
		if (firstHelper === -1) {
			parent.children.push(child)
		} else {
			parent.children.splice(firstHelper, 0, child)
		}
		return
	}
	if (desiredSibling === child) {
		return
	}
	const desiredIndex = parent.children.indexOf(desiredSibling)
	if (desiredIndex === -1) {
		return
	}
	parent.children.splice(currentIndex, 1)
	parent.children.splice(Math.min(desiredIndex, parent.children.length), 0, child)
}


function syncInstancedTransform(object: THREE.Object3D | null) {
	if (!object) {
		return
	}
	object.updateMatrixWorld(true)
	const targets: THREE.Object3D[] = []
	object.traverse((child) => {
		if (child.userData?.instancedAssetId) {
			targets.push(child)
		}
	})
	if (!targets.length) {
		return
	}
	targets.forEach((target) => {
		const nodeId = target.userData?.nodeId as string | undefined
		if (!nodeId) {
			return
		}
		const binding = getModelInstanceBinding(nodeId)
		if (!binding) {
			instancedMatrixCache.delete(nodeId)
			return
		}
		removeVehicleInstance(nodeId)
		target.matrixWorld.decompose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper)
		const isVisible = target.visible !== false && target.userData?.__harmonyCulled !== true
		if (!isVisible) {
			instancedScaleHelper.setScalar(0)
		}
		instancedMatrixHelper.compose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper)
		const bindingKey = buildModelInstanceBindingKey(binding)
		const cached = instancedMatrixCache.get(nodeId)
		if (cached && cached.bindingKey === bindingKey && matrixElementsEqual(cached.elements, instancedMatrixHelper.elements)) {
			return
		}
		const nextEntry = cached ?? { bindingKey, elements: new Float32Array(16) }
		nextEntry.bindingKey = bindingKey
		copyMatrixElements(nextEntry.elements, instancedMatrixHelper.elements)
		instancedMatrixCache.set(nodeId, nextEntry)
		if (isInstancingDebugVisible.value) {
			binding.slots.forEach((slot) => {
				instancedMatrixUploadMeshes.add(slot.mesh)
			})
		}
		binding.slots.forEach((slot) => {
			addInstancedBoundsMesh(slot.mesh)
		})
		updateModelInstanceMatrix(nodeId, instancedMatrixHelper)
	})
}


function resetPhysicsWorld(): void {
	if (vehicleDriveState.active) {
		stopVehicleDriveMode({ resolution: { type: 'abort', message: 'Physics environment reset.' } })
	}
	const world = physicsWorld
	if (world) {
		vehicleInstances.forEach(({ vehicle }) => {
			try {
				vehicle.removeFromWorld(world)
			} catch (error) {
				console.warn('[ScenePreview] Failed to remove vehicle', error)
			}
		})
		rigidbodyInstances.forEach((instance) => removeRigidbodyInstanceBodies(world, instance))
		airWallBodies.forEach((body) => {
			try {
				world.removeBody(body)
			} catch (error) {
				console.warn('[ScenePreview] Failed to remove air wall body', error)
			}
		})
	}
	vehicleInstances.clear()
	vehicleRaycastInWorld.clear()
	rigidbodyInstances.clear()
	airWallBodies.clear()
	clearAirWallDebugMeshes()
	clearRigidbodyDebugHelpers()
	disposeAirWallDebugGroup()
	physicsWorld = null
	groundHeightfieldCache.clear()
	wallTrimeshCache.clear()
	rigidbodyMaterialCache.clear()
	rigidbodyContactMaterialKeys.clear()
}

const physicsContactSettings: PhysicsContactSettings = {
	contactEquationStiffness: PHYSICS_CONTACT_STIFFNESS,
	contactEquationRelaxation: PHYSICS_CONTACT_RELAXATION,
	frictionEquationStiffness: PHYSICS_FRICTION_STIFFNESS,
	frictionEquationRelaxation: PHYSICS_FRICTION_RELAXATION,
}

function ensurePhysicsWorld(): CANNON.World {
	return ensureSharedPhysicsWorld({
		world: physicsWorld,
		setWorld: (world) => {
			physicsWorld = world
		},
		gravity: physicsGravity,
		solverIterations: PHYSICS_SOLVER_ITERATIONS,
		solverTolerance: PHYSICS_SOLVER_TOLERANCE,
		contactFriction: physicsContactFriction,
		contactRestitution: physicsContactRestitution,
		contactSettings: physicsContactSettings,
		rigidbodyMaterialCache,
		rigidbodyContactMaterialKeys,
	})
}

function removeAirWalls(): void {
	const world = physicsWorld
	if (!world) {
		airWallBodies.clear()
		airWallDebugEntries.clear()
		clearAirWallDebugMeshes()
		return
	}
	airWallBodies.forEach((body) => {
		try {
			world.removeBody(body)
		} catch (error) {
			console.warn('[ScenePreview] Failed to remove air wall body', error)
		}
	})
	airWallBodies.clear()
	airWallDebugEntries.clear()
	clearAirWallDebugMeshes()
}

function syncAirWallsForDocument(sceneDocument: SceneJsonExportDocument | null): void {
	removeAirWalls()
	if (!sceneDocument) {
		return
	}
	const airWallEnabled = sceneDocument.groundSettings?.enableAirWall !== false
	const world = physicsWorld
	if (!world || !airWallEnabled) {
		return
	}
	const groundNode = findGroundNode(sceneDocument.nodes)
	if (!groundNode || !isGroundDynamicMesh(groundNode.dynamicMesh)) {
		return
	}
	const groundObject = nodeObjectMap.get(groundNode.id) ?? null
	const definitions = buildGroundAirWallDefinitions({ groundNode, groundObject })
	if (!definitions.length) {
		return
	}
	definitions.forEach((definition) => {
		const [hx, hy, hz] = definition.halfExtents
		if (![hx, hy, hz].every((value) => Number.isFinite(value) && value > 0)) {
			return
		}
		const shape = new CANNON.Box(new CANNON.Vec3(hx, hy, hz))
		const body = new CANNON.Body({ mass: 0 })
		body.type = CANNON.Body.STATIC
		if (world.defaultMaterial) {
			body.material = world.defaultMaterial
		}
		body.addShape(shape)
		body.position.copy(definition.bodyPosition)
		body.quaternion.set(
			definition.bodyQuaternion.x,
			definition.bodyQuaternion.y,
			definition.bodyQuaternion.z,
			definition.bodyQuaternion.w,
		)
		body.updateMassProperties()
		body.aabbNeedsUpdate = true
		world.addBody(body)
		airWallBodies.set(definition.key, body)
		const debugEntry: AirWallDebugEntry = {
			key: definition.key,
			halfExtents: definition.halfExtents,
			position: definition.debugPosition,
			quaternion: definition.debugQuaternion,
		}
		airWallDebugEntries.set(definition.key, debugEntry)
		if (isGroundWireframeVisible.value) {
			createAirWallDebugMesh(debugEntry)
		}
	})
}

function createRigidbodyBody(
	node: SceneNode,
	component: SceneNodeComponentState<RigidbodyComponentProps>,
	shapeDefinition: RigidbodyPhysicsShape | null,
	object: THREE.Object3D,
): { body: CANNON.Body; orientationAdjustment: RigidbodyOrientationAdjustment | null } | null {
	const world = ensurePhysicsWorld()
	return createSharedRigidbodyBody(
		{ node, component, shapeDefinition, object },
		{
			world,
			groundHeightfieldCache,
			wallTrimeshCache,
			rigidbodyMaterialCache,
			rigidbodyContactMaterialKeys,
			contactSettings: physicsContactSettings,
			loggerTag: '[ScenePreview]',
		},
	)
}

function ensureRoadRigidbodyInstance(
	node: SceneNode,
	rigidbodyComponent: SceneNodeComponentState<RigidbodyComponentProps>,
	object: THREE.Object3D,
): void {
	if (!physicsWorld || !currentDocument) {
		return
	}
	const groundNode = findGroundNode(currentDocument.nodes)
	if (!groundNode || !isGroundDynamicMesh(groundNode.dynamicMesh)) {
		removeRigidbodyInstance(node.id)
		return
	}
	const world = ensurePhysicsWorld()
	const existing = rigidbodyInstances.get(node.id) ?? null
	const result = ensureRoadHeightfieldRigidbodyInstance({
		roadNode: node,
		rigidbodyComponent,
		roadObject: object,
		groundNode,
		world,
		existingInstance: existing,
		createBody: (n, c, s, o) => createRigidbodyBody(n, c, s, o),
		loggerTag: '[ScenePreview]',
	})
	if (!result.instance) {
		if (result.shouldRemoveExisting) {
			removeRigidbodyInstance(node.id)
		}
		return
	}
	// Ensure the instance map is up-to-date for both reuse and replacement cases.
	rigidbodyInstances.set(node.id, result.instance)
}

function removeRigidbodyInstance(nodeId: string): void {
	const entry = rigidbodyInstances.get(nodeId)
	if (!entry) {
		return
	}
	removeRigidbodyInstanceBodies(physicsWorld, entry)
	rigidbodyInstances.delete(nodeId)
	groundHeightfieldCache.delete(nodeId)
	wallTrimeshCache.delete(nodeId)
	roadHeightfieldDebugCache.delete(nodeId)
	removeVehicleInstance(nodeId)
}

function clampVehicleAxisIndex(value: number): 0 | 1 | 2 {
	if (value === 1) {
		return 1
	}
	if (value === 2) {
		return 2
	}
	return 0
}

function resolveVehicleAxisVector(index: number): THREE.Vector3 {
	switch (index) {
		case 1:
			return new THREE.Vector3(0, 1, 0)
		case 2:
			return new THREE.Vector3(0, 0, 1)
		default:
			return new THREE.Vector3(1, 0, 0)
	}
}

type VehicleVectorValue = Vector3Like | number[] | null | undefined

function toFiniteVectorComponent(value: unknown): number | null {
	const numeric = typeof value === 'number' ? value : Number(value)
	return Number.isFinite(numeric) ? numeric : null
}

function normalizeVehicleVector(value: VehicleVectorValue): [number, number, number] | null {
	if (Array.isArray(value) && value.length === 3) {
		const [xRaw, yRaw, zRaw] = value
		const x = toFiniteVectorComponent(xRaw)
		const y = toFiniteVectorComponent(yRaw)
		const z = toFiniteVectorComponent(zRaw)
		if (x === null || y === null || z === null) {
			return null
		}
		return [x, y, z]
	}
	if (value && typeof value === 'object') {
		const record = value as Partial<Vector3Like>
		const x = toFiniteVectorComponent(record.x)
		const y = toFiniteVectorComponent(record.y)
		const z = toFiniteVectorComponent(record.z)
		if (x === null || y === null || z === null) {
			return null
		}
		return [x, y, z]
	}
	return null
}

function tupleToVec3(tuple: VehicleVectorValue, fallback?: Vector3Like): CANNON.Vec3 | null {
	const normalized = normalizeVehicleVector(tuple) ?? (fallback ? normalizeVehicleVector(fallback) : null)
	if (!normalized) {
		return null
	}
	const [x, y, z] = normalized
	return new CANNON.Vec3(x, y, z)
}

function isRigidbodyDebugCategoryVisible(category: RigidbodyDebugHelperCategory): boolean {
	return category === 'ground' ? isGroundWireframeVisible.value : isOtherRigidbodyWireframeVisible.value
}

function ensureRigidbodyDebugGroup(): THREE.Group | null {
	if (!scene) {
		return null
	}
	if (!rigidbodyDebugGroup) {
		rigidbodyDebugGroup = new THREE.Group()
		rigidbodyDebugGroup.name = 'RigidbodyDebugHelpers'
	}
	if (rigidbodyDebugGroup.parent !== scene) {
		scene.add(rigidbodyDebugGroup)
	}
	return rigidbodyDebugGroup
}

function ensureAirWallDebugGroup(): THREE.Group | null {
	if (!scene) {
		return null
	}
	if (!airWallDebugGroup) {
		airWallDebugGroup = new THREE.Group()
		airWallDebugGroup.name = 'AirWallDebug'
	}
	if (airWallDebugGroup.parent !== scene) {
		scene.add(airWallDebugGroup)
	}
	airWallDebugGroup.visible = isGroundWireframeVisible.value
	return airWallDebugGroup
}

function clearAirWallDebugMeshes(): void {
	airWallDebugMeshes.forEach((mesh) => {
		mesh.parent?.remove(mesh)
		mesh.geometry?.dispose?.()
	})
	airWallDebugMeshes.clear()
	if (airWallDebugGroup) {
		airWallDebugGroup.clear()
	}
}

function disposeAirWallDebugGroup(): void {
	clearAirWallDebugMeshes()
	if (airWallDebugGroup) {
		airWallDebugGroup.parent?.remove(airWallDebugGroup)
		airWallDebugGroup.clear()
		airWallDebugGroup = null
	}
}

function setAirWallDebugVisibility(visible: boolean): void {
	if (!visible) {
		// Fully remove debug rendering resources to avoid overhead.
		disposeAirWallDebugGroup()
		return
	}
	const ensured = ensureAirWallDebugGroup()
	if (ensured) {
		ensured.visible = true
	}
	// Lazily create debug meshes only when the option is enabled.
	airWallDebugEntries.forEach((entry) => createAirWallDebugMesh(entry))
	airWallDebugMeshes.forEach((mesh) => {
		mesh.visible = true
	})
}

function createAirWallDebugMesh(entry: AirWallDebugEntry): void {
	if (!isGroundWireframeVisible.value) {
		return
	}
	const group = ensureAirWallDebugGroup()
	if (!group) {
		return
	}
	const existing = airWallDebugMeshes.get(entry.key)
	if (existing) {
		existing.parent?.remove(existing)
		existing.geometry?.dispose?.()
	}
	const [hx, hy, hz] = entry.halfExtents
	const height = hy * 2
	const width = entry.key.endsWith('x') ? hz * 2 : hx * 2
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return
	}
	const geometry = new THREE.PlaneGeometry(width, height)
	const mesh = new THREE.Mesh(geometry, airWallDebugMaterial)
	mesh.name = `AirWallDebug:${entry.key}`
	mesh.renderOrder = 9999
	mesh.position.copy(entry.position)
	mesh.quaternion.copy(entry.quaternion)
	mesh.visible = isGroundWireframeVisible.value
	group.add(mesh)
	airWallDebugMeshes.set(entry.key, mesh)
}

function buildBoxDebugLines(shape: Extract<RigidbodyPhysicsShape, { kind: 'box' }>): THREE.LineSegments | null {
	const [hx, hy, hz] = shape.halfExtents
	if (![hx, hy, hz].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
		return null
	}
	const boxGeometry = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2)
	const edges = new THREE.EdgesGeometry(boxGeometry)
	boxGeometry.dispose()
	const lines = new THREE.LineSegments(edges, rigidbodyDebugMaterial)
	lines.frustumCulled = false
	return lines
}

function buildSphereDebugLines(shape: Extract<RigidbodyPhysicsShape, { kind: 'sphere' }>): THREE.LineSegments | null {
	const radius = Number(shape.radius)
	if (!Number.isFinite(radius) || radius <= 0) {
		return null
	}
	const sphereGeometry = new THREE.SphereGeometry(radius, 16, 12)
	const edges = new THREE.EdgesGeometry(sphereGeometry)
	sphereGeometry.dispose()
	const lines = new THREE.LineSegments(edges, rigidbodyDebugMaterial)
	lines.frustumCulled = false
	return lines
}

function buildCylinderDebugLines(shape: Extract<RigidbodyPhysicsShape, { kind: 'cylinder' }>): THREE.LineSegments | null {
	const radiusTop = Number(shape.radiusTop)
	const radiusBottom = Number(shape.radiusBottom)
	const height = Number(shape.height)
	if (![radiusTop, radiusBottom, height].every((value) => Number.isFinite(value) && value > 0)) {
		return null
	}
	const segments = Number.isFinite(shape.segments) ? Math.max(4, Math.min(48, Math.trunc(shape.segments ?? 16))) : 16
	const cylinderGeometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, true)
	const edges = new THREE.EdgesGeometry(cylinderGeometry)
	cylinderGeometry.dispose()
	const lines = new THREE.LineSegments(edges, rigidbodyDebugMaterial)
	lines.frustumCulled = false
	return lines
}

function sanitizeConvexFaces(
	source: unknown,
	vertexCount: number,
): { faces: number[][]; invalidCount: number } {
	const result: { faces: number[][]; invalidCount: number } = { faces: [], invalidCount: 0 }
	if (!Array.isArray(source) || vertexCount < 4) {
		return result
	}
	source.forEach((face) => {
		if (!Array.isArray(face) || face.length < 3) {
			result.invalidCount += 1
			return
		}
		const normalized: number[] = []
		let invalid = false
		for (let i = 0; i < face.length; i += 1) {
			const raw = face[i]
			const numeric = typeof raw === 'number' ? raw : Number(raw)
			if (!Number.isFinite(numeric)) {
				invalid = true
				break
			}
			const index = Math.trunc(numeric)
			if (index < 0 || index >= vertexCount) {
				invalid = true
				break
			}
			if (!normalized.length || normalized[normalized.length - 1] !== index) {
				normalized.push(index)
			}
		}
		if (invalid) {
			result.invalidCount += 1
			return
		}
		const deduped = normalized.filter((value, index, array) => array.indexOf(value) === index)
		if (deduped.length < 3) {
			result.invalidCount += 1
			return
		}
		result.faces.push(deduped)
	})
	return result
}

function buildConvexDebugLines(shape: Extract<RigidbodyPhysicsShape, { kind: 'convex' }>): THREE.LineSegments | null {
	const vertices = Array.isArray(shape.vertices) ? shape.vertices : []
	if (!vertices.length) {
		return null
	}
	const positions = new Float32Array(vertices.length * 3)
	for (let index = 0; index < vertices.length; index += 1) {
		const tuple = vertices[index]
		const [vx = 0, vy = 0, vz = 0] = tuple ?? []
		if (![vx, vy, vz].every((value) => typeof value === 'number' && Number.isFinite(value))) {
			return null
		}
		const offset = index * 3
		positions[offset] = vx
		positions[offset + 1] = vy
		positions[offset + 2] = vz
	}
	const { faces } = sanitizeConvexFaces(shape.faces, vertices.length)
	if (!faces.length) {
		return null
	}
	const indices: number[] = []
	faces.forEach((face) => {
		if (face.length < 3) {
			return
		}
		for (let i = 1; i < face.length - 1; i += 1) {
			const a = Number(face[0])
			const b = Number(face[i])
			const c = Number(face[i + 1])
			if ([a, b, c].every((value) => Number.isFinite(value))) {
				indices.push(a, b, c)
			}
		}
	})
	if (!indices.length) {
		return null
	}
	const baseGeometry = new THREE.BufferGeometry()
	baseGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
	baseGeometry.setIndex(indices)
	const edges = new THREE.EdgesGeometry(baseGeometry)
	baseGeometry.dispose()
	const lines = new THREE.LineSegments(edges, rigidbodyDebugMaterial)
	lines.frustumCulled = false
	return lines
}

function buildHeightfieldDebugLines(
	shape: Extract<RigidbodyPhysicsShape, { kind: 'heightfield' }>,
): THREE.LineSegments | null {
	if (!Array.isArray(shape.matrix) || shape.matrix.length < 2) {
		return null
	}
	const columnCount = shape.matrix.length
	let rowCount = 0
	shape.matrix.forEach((column) => {
		if (Array.isArray(column) && column.length > rowCount) {
			rowCount = column.length
		}
	})
	if (rowCount < 2) {
		return null
	}
	const width = typeof shape.width === 'number' && Number.isFinite(shape.width) ? shape.width : 0
	const depth = typeof shape.depth === 'number' && Number.isFinite(shape.depth) ? shape.depth : 0
	if (!(width > 0 && depth > 0)) {
		return null
	}
	const stepX = columnCount > 1 ? width / (columnCount - 1) : width
	// The physics heightfield is rotated -90° around X, which flips the Z direction.
	// Mirror that here so the debug lines line up with the rendered ground.
	const stepZ = rowCount > 1 ? -depth / (rowCount - 1) : -depth
	const originX = -width * 0.5
	const originZ = depth * 0.5
	const positions: number[] = []
	const sampleHeight = (columnIndex: number, rowIndex: number): number => {
		const column = shape.matrix[columnIndex]
		if (!Array.isArray(column)) {
			return 0
		}
		const value = column[rowIndex]
		if (typeof value === 'number' && Number.isFinite(value)) {
			return value
		}
		return 0
	}
	const pushSegment = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
		positions.push(ax, ay, az, bx, by, bz)
	}
	for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
		for (let columnIndex = 0; columnIndex < columnCount - 1; columnIndex += 1) {
			const ax = originX + columnIndex * stepX
			const az = originZ + rowIndex * stepZ
			const bx = ax + stepX
			const bz = az
			pushSegment(ax, sampleHeight(columnIndex, rowIndex), az, bx, sampleHeight(columnIndex + 1, rowIndex), bz)
		}
	}
	for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
		for (let rowIndex = 0; rowIndex < rowCount - 1; rowIndex += 1) {
			const ax = originX + columnIndex * stepX
			const az = originZ + rowIndex * stepZ
			const bz = az + stepZ
			pushSegment(ax, sampleHeight(columnIndex, rowIndex), az, ax, sampleHeight(columnIndex, rowIndex + 1), bz)
		}
	}
	if (!positions.length) {
		return null
	}
	const geometry = new THREE.BufferGeometry()
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3))
	const lines = new THREE.LineSegments(geometry, rigidbodyDebugMaterial)
	lines.frustumCulled = false
	return lines
}

function buildTrimeshDebugLines(trimesh: CANNON.Trimesh): THREE.LineSegments | null {
	const vertices = (trimesh as any).vertices as ArrayLike<number> | undefined
	const indices = (trimesh as any).indices as ArrayLike<number> | undefined
	if (!vertices || !indices) {
		return null
	}
	const vertexCount = Math.floor(vertices.length / 3)
	if (vertexCount < 3 || indices.length < 3) {
		return null
	}
	const baseGeometry = new THREE.BufferGeometry()
	const positions = new Float32Array(vertexCount * 3)
	for (let i = 0; i < positions.length; i += 1) {
		positions[i] = Number(vertices[i] ?? 0)
	}
	// Use 32-bit indices; avoids overflow for large meshes.
	const indexArray = new Uint32Array(indices.length)
	for (let i = 0; i < indexArray.length; i += 1) {
		indexArray[i] = (Number(indices[i] ?? 0) | 0) >>> 0
	}
	baseGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
	baseGeometry.setIndex(new THREE.BufferAttribute(indexArray, 1))
	const edges = new THREE.EdgesGeometry(baseGeometry)
	baseGeometry.dispose()
	const lines = new THREE.LineSegments(edges, rigidbodyDebugMaterial)
	lines.frustumCulled = false
	return lines
}

function computeTrimeshSignature(trimesh: CANNON.Trimesh): string {
	const vertices = (trimesh as any).vertices as ArrayLike<number> | undefined
	const indices = (trimesh as any).indices as ArrayLike<number> | undefined
	if (!vertices || !indices) {
		return 'trimesh:0:0:0'
	}
	const quantize = 1000
	let hash = 2166136261
	const fnv = (value: number) => {
		hash ^= value
		hash = Math.imul(hash, 16777619) >>> 0
	}
	for (let i = 0; i < vertices.length; i += 1) {
		const v = Number(vertices[i] ?? 0)
		const q = Number.isFinite(v) ? Math.round(v * quantize) : 0
		fnv(q | 0)
	}
	for (let i = 0; i < indices.length; i += 1) {
		fnv((Number(indices[i] ?? 0) | 0) >>> 0)
	}
	return `trimesh:${vertices.length}:${indices.length}:${hash.toString(16)}`
}

function buildRigidbodyDebugLineSegments(shape: RigidbodyPhysicsShape): THREE.LineSegments | null {
	if (shape.kind === 'box') {
		return buildBoxDebugLines(shape)
	}
	if (shape.kind === 'convex') {
		return buildConvexDebugLines(shape)
	}
	if (shape.kind === 'sphere') {
		return buildSphereDebugLines(shape)
	}
	if (shape.kind === 'cylinder') {
		return buildCylinderDebugLines(shape)
	}
	if (shape.kind === 'heightfield') {
		return buildHeightfieldDebugLines(shape)
	}
	return null
}

function computeRigidbodyShapeSignature(shape: RigidbodyPhysicsShape): string {
	if (shape.kind === 'heightfield') {
		const columnCount = Array.isArray(shape.matrix) ? shape.matrix.length : 0
		let rowCount = 0
		let hash = 0
		shape.matrix?.forEach((column) => {
			if (!Array.isArray(column)) {
				return
			}
			if (column.length > rowCount) {
				rowCount = column.length
			}
			column.forEach((value) => {
				const normalized = Math.round((typeof value === 'number' && Number.isFinite(value) ? value : 0) * 1000)
				hash = (hash * 31 + normalized) >>> 0
			})
		})
		const width = typeof shape.width === 'number' && Number.isFinite(shape.width) ? shape.width : 0
		const depth = typeof shape.depth === 'number' && Number.isFinite(shape.depth) ? shape.depth : 0
		const elementSize = typeof shape.elementSize === 'number' && Number.isFinite(shape.elementSize)
			? shape.elementSize
			: 0
		return `heightfield:${columnCount}x${rowCount}:${Math.round(width * 1000)}:${Math.round(depth * 1000)}:${Math.round(elementSize * 1000)}:${hash.toString(16)}`
	}
	return JSON.stringify(shape)
}

function removeRigidbodyDebugHelper(nodeId: string): void {
	const helper = rigidbodyDebugHelpers.get(nodeId)
	if (!helper) {
		return
	}
	helper.group.parent?.remove(helper.group)
	helper.group.traverse((child) => {
		const line = child as THREE.LineSegments
		if ((line as any).isLineSegments) {
			line.geometry?.dispose?.()
		}
	})
	helper.group.clear()
	rigidbodyDebugHelpers.delete(nodeId)
}

function clearRigidbodyDebugHelpers(): void {
	rigidbodyDebugHelpers.forEach((_helper, nodeId) => removeRigidbodyDebugHelper(nodeId))
}

function disposeRigidbodyDebugHelpers(): void {
	clearRigidbodyDebugHelpers()
	if (rigidbodyDebugGroup) {
		rigidbodyDebugGroup.parent?.remove(rigidbodyDebugGroup)
		rigidbodyDebugGroup.clear()
		rigidbodyDebugGroup = null
	}
}

function ensureRigidbodyDebugHelperForShape(
  nodeId: string,
  shape: RigidbodyPhysicsShape,
  category: RigidbodyDebugHelperCategory,
  worldScale: THREE.Vector3,
): void {
	const signature = computeRigidbodyShapeSignature(shape)
	const existing = rigidbodyDebugHelpers.get(nodeId)
	if (existing?.signature === signature) {
		return
	}
	removeRigidbodyDebugHelper(nodeId)
	const container = ensureRigidbodyDebugGroup()
	if (!container) {
		return
	}
	const lineSegments = buildRigidbodyDebugLineSegments(shape)
	if (!lineSegments) {
		return
	}
	const helperGroup = new THREE.Group()
	helperGroup.name = `RigidbodyDebugHelper:${nodeId}`
	lineSegments.name = `RigidbodyDebugLines:${nodeId}`
	lineSegments.renderOrder = 9999
	const offsetTuple = shape.kind === 'heightfield' ? [0, 0, 0] : shape.offset ?? [0, 0, 0]
	const [ox = 0, oy = 0, oz = 0] = offsetTuple
	// Offset is expressed in the same local-space units as the shape definition.
	// When applyScale is enabled we scale the whole helper group, which also scales this translation.
	lineSegments.position.set(ox, oy, oz)
	helperGroup.add(lineSegments)
	helperGroup.visible = false
	helperGroup.scale.copy(shape.applyScale ? worldScale : new THREE.Vector3(1, 1, 1))
	container.add(helperGroup)
	rigidbodyDebugHelpers.set(nodeId, { group: helperGroup, signature, category, scale: helperGroup.scale.clone() })
}

function ensureRigidbodyDebugHelperForTrimesh(
	nodeId: string,
	trimesh: CANNON.Trimesh,
	category: RigidbodyDebugHelperCategory,
): void {
	const signature = computeTrimeshSignature(trimesh)
	const existing = rigidbodyDebugHelpers.get(nodeId)
	if (existing?.signature === signature) {
		return
	}
	removeRigidbodyDebugHelper(nodeId)
	const container = ensureRigidbodyDebugGroup()
	if (!container) {
		return
	}
	const lineSegments = buildTrimeshDebugLines(trimesh)
	if (!lineSegments) {
		return
	}
	const helperGroup = new THREE.Group()
	helperGroup.name = `RigidbodyDebugHelper:${nodeId}`
	lineSegments.name = `RigidbodyDebugLines:${nodeId}`
	lineSegments.renderOrder = 9999
	// Trimesh vertices are already in body-local coordinates; scale is baked.
	lineSegments.position.set(0, 0, 0)
	helperGroup.add(lineSegments)
	helperGroup.visible = false
	helperGroup.scale.set(1, 1, 1)
	container.add(helperGroup)
	rigidbodyDebugHelpers.set(nodeId, { group: helperGroup, signature, category, scale: new THREE.Vector3(1, 1, 1) })
}

function ensureRoadHeightfieldDebugHelper(
	nodeId: string,
	entry: { signature: string; bodies: CANNON.Body[] },
): void {
	const debugEntry = resolveRoadHeightfieldDebugSegments({
		nodeId,
		signature: entry.signature,
		bodies: entry.bodies,
		cache: roadHeightfieldDebugCache,
		debugEnabled: isRigidbodyDebugVisible.value,
	})
	if (!debugEntry) {
		removeRigidbodyDebugHelper(nodeId)
		return
	}
	const signature = `heightfield-segments:${debugEntry.signature}`
	const existing = rigidbodyDebugHelpers.get(nodeId)
	if (existing?.signature === signature) {
		return
	}
	removeRigidbodyDebugHelper(nodeId)
	const container = ensureRigidbodyDebugGroup()
	if (!container) {
		return
	}
	const helperGroup = new THREE.Group()
	helperGroup.name = `RigidbodyDebugHelper:${nodeId}`
	helperGroup.visible = false
	// Heightfield debug segments are generated in world units.
	helperGroup.scale.set(1, 1, 1)
	debugEntry.segments.forEach((segment, index) => {
		const lines = buildRigidbodyDebugLineSegments(segment.shape)
		if (!lines) {
			return
		}
		lines.name = `HeightfieldDebugLines:${nodeId}:${index}`
		lines.renderOrder = 9999
		const segmentGroup = new THREE.Group()
		segmentGroup.name = `HeightfieldDebugSegment:${nodeId}:${index}`
		;(segmentGroup as any).__harmonyRoadSegmentKind = segment.shape.kind
		segmentGroup.add(lines)
		helperGroup.add(segmentGroup)
	})
	container.add(helperGroup)
	rigidbodyDebugHelpers.set(nodeId, {
		group: helperGroup,
		signature,
		category: 'rigidbody',
		scale: new THREE.Vector3(1, 1, 1),
	})
}

function refreshRigidbodyDebugHelper(nodeId: string): void {
	if (!isRigidbodyDebugVisible.value) {
		return
	}
	const node = resolveNodeById(nodeId)
	const component = resolveRigidbodyComponent(node)
	const instance = rigidbodyInstances.get(nodeId) ?? null
	const isWallNode = Boolean(node && (node.dynamicMesh as any)?.type === 'Wall')
	const roadEntry =
		instance && instance.signature && Array.isArray(instance.bodies) && instance.bodies.length > 1
			? { signature: instance.signature, bodies: instance.bodies }
			: null
	const isGroundNode = Boolean(node && isGroundDynamicMesh(node.dynamicMesh))
	if (isWallNode && instance) {
		const category: RigidbodyDebugHelperCategory = 'rigidbody'
		if (!isRigidbodyDebugCategoryVisible(category)) {
			removeRigidbodyDebugHelper(nodeId)
			return
		}
		const trimesh = instance.body.shapes.find((shape) => shape instanceof CANNON.Trimesh) as CANNON.Trimesh | undefined
		if (trimesh) {
			ensureRigidbodyDebugHelperForTrimesh(nodeId, trimesh, category)
			updateRigidbodyDebugHelperTransform(nodeId)
			return
		}
		// Fall through to component-defined shape if wall body wasn't a trimesh.
	}
	if (roadEntry) {
		const category: RigidbodyDebugHelperCategory = 'rigidbody'
		if (!isRigidbodyDebugCategoryVisible(category)) {
			removeRigidbodyDebugHelper(nodeId)
			return
		}
		ensureRoadHeightfieldDebugHelper(nodeId, roadEntry)
		updateRigidbodyDebugHelperTransform(nodeId)
		return
	}
	let shapeDefinition = extractRigidbodyShape(component)
	if (!shapeDefinition && isGroundNode && node) {
		shapeDefinition = buildHeightfieldShapeFromGroundNode(node)
	}
	if (!shapeDefinition) {
		removeRigidbodyDebugHelper(nodeId)
		return
	}
	const category: RigidbodyDebugHelperCategory = isGroundNode ? 'ground' : 'rigidbody'
	if (!isRigidbodyDebugCategoryVisible(category)) {
		removeRigidbodyDebugHelper(nodeId)
		return
	}
	const scale = new THREE.Vector3(1, 1, 1)
	if (shapeDefinition.applyScale) {
		const object = node ? nodeObjectMap.get(node.id) ?? null : null
		if (object) {
			object.updateMatrixWorld(true)
			object.getWorldScale(scale)
		}
	}
	ensureRigidbodyDebugHelperForShape(nodeId, shapeDefinition, category, scale)
	updateRigidbodyDebugHelperTransform(nodeId)
}

function updateRigidbodyDebugHelperTransform(nodeId: string): void {
	if (!isRigidbodyDebugVisible.value) {
		return
	}
	const helper = rigidbodyDebugHelpers.get(nodeId)
	if (!helper) {
		return
	}
	const instance = rigidbodyInstances.get(nodeId) ?? null
	const multiBodyEntry =
		instance && instance.signature && Array.isArray(instance.bodies) && instance.bodies.length > 1
			? { signature: instance.signature, bodies: instance.bodies }
			: null
	if (multiBodyEntry) {
		const categoryEnabled = isRigidbodyDebugCategoryVisible(helper.category)
		const object = nodeObjectMap.get(nodeId) ?? null
		const visible = object ? object.visible !== false : true
		helper.group.visible = visible && categoryEnabled
		if (!helper.group.visible) {
			return
		}
		const children = helper.group.children
		for (let i = 0; i < Math.min(children.length, multiBodyEntry.bodies.length); i += 1) {
			const child = children[i]
			const body = multiBodyEntry.bodies[i]
			if (!child || !body) {
				continue
			}
			child.position.set(body.position.x, body.position.y, body.position.z)
			rigidbodyDebugQuaternionHelper.set(
				body.quaternion.x,
				body.quaternion.y,
				body.quaternion.z,
				body.quaternion.w,
			)
			const segmentKind = (child as any).__harmonyRoadSegmentKind as string | undefined
			if (segmentKind === 'heightfield') {
				// Heightfields are rotated -90° around X in physics; undo that here so the debug
				// geometry (built in render-space convention) lies on the surface.
				rigidbodyDebugQuaternionHelper.multiply(heightfieldDebugOrientationInverse)
			}
			child.quaternion.copy(rigidbodyDebugQuaternionHelper)
			child.scale.copy(helper.scale)
			child.updateMatrixWorld(true)
		}
		return
	}
	const categoryEnabled = isRigidbodyDebugCategoryVisible(helper.category)
	const rigidbody = rigidbodyInstances.get(nodeId)
	let visible = true
	if (rigidbody) {
		helper.group.position.set(rigidbody.body.position.x, rigidbody.body.position.y, rigidbody.body.position.z)
		rigidbodyDebugQuaternionHelper.set(
			rigidbody.body.quaternion.x,
			rigidbody.body.quaternion.y,
			rigidbody.body.quaternion.z,
			rigidbody.body.quaternion.w,
		)
		if (rigidbody.orientationAdjustment) {
			rigidbodyDebugQuaternionHelper.multiply(rigidbody.orientationAdjustment.threeInverse)
		}
		helper.group.quaternion.copy(rigidbodyDebugQuaternionHelper)
		visible = rigidbody.object?.visible !== false
	} else {
		const object = nodeObjectMap.get(nodeId)
		if (!object) {
			helper.group.visible = false
			return
		}
		object.updateMatrixWorld(true)
		object.matrixWorld.decompose(rigidbodyDebugPositionHelper, rigidbodyDebugQuaternionHelper, rigidbodyDebugScaleHelper)
		helper.group.position.copy(rigidbodyDebugPositionHelper)
		helper.group.quaternion.copy(rigidbodyDebugQuaternionHelper)
		visible = object.visible !== false
	}
	helper.group.scale.copy(helper.scale)
	helper.group.visible = visible && categoryEnabled
	helper.group.updateMatrixWorld(true)
}

function updateRigidbodyDebugTransforms(): void {
	if (!isRigidbodyDebugVisible.value || !rigidbodyDebugHelpers.size) {
		return
	}
	rigidbodyDebugHelpers.forEach((_entry, nodeId) => updateRigidbodyDebugHelperTransform(nodeId))
}

function syncRigidbodyDebugHelpers(): void {
	if (!isRigidbodyDebugVisible.value) {
		return
	}
	const nodes = currentDocument?.nodes ?? []
	const rigidbodyNodes = collectRigidbodyNodes(nodes)
	const desiredIds = new Set<string>()
	rigidbodyNodes.forEach((node) => {
		desiredIds.add(node.id)
		refreshRigidbodyDebugHelper(node.id)
	})
	rigidbodyDebugHelpers.forEach((_helper, nodeId) => {
		if (!desiredIds.has(nodeId)) {
			removeRigidbodyDebugHelper(nodeId)
		}
	})
}

function createVehicleInstance(
	node: SceneNode,
	component: SceneNodeComponentState<VehicleComponentProps>,
	rigidbody: RigidbodyInstance,
): VehicleInstance | null {
	if (!physicsWorld || !rigidbody.object) {
		return null
	}
	const props = clampVehicleComponentProps(component.props)
	const rightAxis = clampVehicleAxisIndex(props.indexRightAxis)
	const upAxis = clampVehicleAxisIndex(props.indexUpAxis)
	const forwardAxis = clampVehicleAxisIndex(props.indexForwardAxis)
	const axisRightVector = resolveVehicleAxisVector(rightAxis)
	const axisUpVector = resolveVehicleAxisVector(upAxis)
	const axisForwardVector = resolveVehicleAxisVector(forwardAxis)
	const wheelEntries = (props.wheels ?? [])
		.map((wheel) => {
			const point = tupleToVec3(wheel.chassisConnectionPointLocal)
			const direction = tupleToVec3(wheel.directionLocal, DEFAULT_DIRECTION)
			const axle = tupleToVec3(wheel.axleLocal, DEFAULT_AXLE)
			if (!point || !direction || !axle) {
				return null
			}
			return { config: wheel, point, direction, axle }
		})
		.filter((entry): entry is VehicleWheelSetupEntry => Boolean(entry))
	if (!wheelEntries.length) {
		return null
	}
	const wheelCount = wheelEntries.length
	let steerableWheelIndices = wheelEntries.reduce<number[]>((indices, entry, index) => {
		if (entry.config.isFrontWheel) {
			indices.push(index)
		}
		return indices
	}, [])
	if (!steerableWheelIndices.length) {
		steerableWheelIndices = wheelCount >= 2
			? [0, 1].filter((index) => index < wheelCount)
			: Array.from({ length: wheelCount }, (_unused, index) => index)
	}
	const vehicle = new CANNON.RaycastVehicle({
		chassisBody: rigidbody.body,
		indexRightAxis: rightAxis,
		indexUpAxis: upAxis,
		indexForwardAxis: forwardAxis,
	})
	const wheelBindings: VehicleWheelBinding[] = []
	wheelEntries.forEach(({ config, point, direction, axle }, index) => {
		vehicle.addWheel({
			chassisConnectionPointLocal: point,
			directionLocal: direction,
			axleLocal: axle,
			suspensionRestLength: config.suspensionRestLength,
			suspensionStiffness: config.suspensionStiffness,
			dampingRelaxation: config.dampingRelaxation,
			dampingCompression: config.dampingCompression,
			frictionSlip: config.frictionSlip,
			maxSuspensionTravel: config.maxSuspensionTravel,
			maxSuspensionForce: config.maxSuspensionForce,
			useCustomSlidingRotationalSpeed: config.useCustomSlidingRotationalSpeed,
			customSlidingRotationalSpeed: config.customSlidingRotationalSpeed,
			isFrontWheel: config.isFrontWheel,
			rollInfluence: config.rollInfluence,
			radius: config.radius,
		})
		const axis = new THREE.Vector3(axle.x, axle.y, axle.z)
		if (axis.lengthSq() < 1e-6) {
			axis.copy(defaultWheelAxisVector)
		}
		axis.normalize()
		const wheelObject = config.nodeId ? nodeObjectMap.get(config.nodeId) ?? null : null
		const basePosition = wheelObject ? wheelObject.position.clone() : new THREE.Vector3()
		const baseScale = wheelObject ? wheelObject.scale.clone() : new THREE.Vector3(1, 1, 1)
		wheelBindings.push({
			nodeId: config.nodeId ?? null,
			object: wheelObject,
			radius: Math.max(config.radius, VEHICLE_WHEEL_MIN_RADIUS),
			axleAxis: axis,
			isFrontWheel: config.isFrontWheel === true,
			wheelIndex: index,
			spinAngle: 0,
			lastSteeringAngle: 0,
			baseQuaternion: wheelObject ? wheelObject.quaternion.clone() : new THREE.Quaternion(),
			basePosition,
			baseScale,
		})
	})
	vehicle.addToWorld(physicsWorld)
	vehicleRaycastInWorld.add(node.id)
	const initialChassisPosition = new THREE.Vector3(
		rigidbody.body.position.x,
		rigidbody.body.position.y,
		rigidbody.body.position.z,
	)
	const initialChassisQuaternion = new THREE.Quaternion(
		rigidbody.body.quaternion.x,
		rigidbody.body.quaternion.y,
		rigidbody.body.quaternion.z,
		rigidbody.body.quaternion.w,
	).normalize()
	return {
		nodeId: node.id,
		vehicle,
		wheelCount,
		steerableWheelIndices,
		wheelBindings,
		forwardAxis: axisForwardVector.clone(),
		axisRight: axisRightVector,
		axisUp: axisUpVector,
		axisForward: axisForwardVector,
		axisRightIndex: rightAxis,
		axisUpIndex: upAxis,
		axisForwardIndex: forwardAxis,
		lastChassisPosition: initialChassisPosition,
		hasChassisPositionSample: false,
		initialChassisQuaternion,
	}
}

function removeVehicleInstance(nodeId: string): void {
	const entry = vehicleInstances.get(nodeId)
	if (!entry) {
		return
	}
	if (vehicleDriveState.active && vehicleDriveState.nodeId === nodeId) {
		stopVehicleDriveMode({ resolution: { type: 'abort', message: 'Vehicle instance was removed.' } })
	}
	if (physicsWorld) {
		try {
			entry.vehicle.removeFromWorld(physicsWorld)
		} catch (error) {
			console.warn('[ScenePreview] Failed to remove vehicle instance', error)
		}
	}
	vehicleInstances.delete(nodeId)
	vehicleRaycastInWorld.delete(nodeId)
}

function ensureVehicleBindingForNode(nodeId: string): void {
	if (!physicsWorld) {
		return
	}
	const node = resolveNodeById(nodeId)
	const component = resolveVehicleComponent(node)
	if (!node || !component) {
		removeVehicleInstance(nodeId)
		return
	}
	const rigidbody = rigidbodyInstances.get(nodeId)
	if (!rigidbody || !rigidbody.object) {
		return
	}
	removeVehicleInstance(nodeId)
	const instance = createVehicleInstance(node, component, rigidbody)
	if (instance) {
		vehicleInstances.set(nodeId, instance)
	}
}

function ensureRigidbodyBindingForObject(nodeId: string, object: THREE.Object3D): void {
	if (!physicsWorld || !currentDocument) {
		return
	}
	const node = resolveNodeById(nodeId)
	const component = resolveRigidbodyComponent(node)
	const shapeDefinition = extractRigidbodyShape(component)
	const requiresMetadata = !isGroundDynamicMesh(node?.dynamicMesh)
	if (!node || !component || !object) {
		return
	}
	if (isRoadDynamicMesh(node.dynamicMesh) && (component.props as RigidbodyComponentProps | undefined)?.bodyType === 'STATIC') {
		ensureRoadRigidbodyInstance(node, component, object)
		refreshRigidbodyDebugHelper(nodeId)
		return
	}
	if (!shapeDefinition && requiresMetadata) {
		return
	}
	const existing = rigidbodyInstances.get(nodeId)
	if (existing) {
		existing.object = object
		syncSharedBodyFromObject(existing.body, object, existing.orientationAdjustment)
		ensureVehicleBindingForNode(nodeId)
		refreshRigidbodyDebugHelper(nodeId)
		return
	}
	const bodyEntry = createRigidbodyBody(node, component, shapeDefinition, object)
	if (!bodyEntry) {
		return
	}
	physicsWorld.addBody(bodyEntry.body)
	rigidbodyInstances.set(nodeId, {
		nodeId,
		body: bodyEntry.body,
		bodies: [bodyEntry.body],
		object,
		orientationAdjustment: bodyEntry.orientationAdjustment,
	})
	refreshRigidbodyDebugHelper(nodeId)
	ensureVehicleBindingForNode(nodeId)
}

function collectRigidbodyNodes(nodes: SceneNode[] | undefined | null): SceneNode[] {
	const collected: SceneNode[] = []
	if (!Array.isArray(nodes)) {
		return collected
	}
	const stack: SceneNode[] = [...nodes]
	while (stack.length) {
		const node = stack.pop()
		if (!node) {
			continue
		}
		if (resolveRigidbodyComponent(node)) {
			collected.push(node)
		}
		if (Array.isArray(node.children) && node.children.length) {
			stack.push(...node.children)
		}
	}
	return collected
}

function collectVehicleNodes(nodes: SceneNode[] | undefined | null): SceneNode[] {
	const collected: SceneNode[] = []
	if (!Array.isArray(nodes)) {
		return collected
	}
	const stack: SceneNode[] = [...nodes]
	while (stack.length) {
		const node = stack.pop()
		if (!node) {
			continue
		}
		if (resolveVehicleComponent(node)) {
			collected.push(node)
		}
		if (Array.isArray(node.children) && node.children.length) {
			stack.push(...node.children)
		}
	}
	return collected
}

function syncVehicleBindingsForDocument(document: SceneJsonExportDocument | null): void {
	if (!document || !physicsWorld) {
		if (!vehicleInstances.size) {
			return
		}
		Array.from(vehicleInstances.keys()).forEach((nodeId) => removeVehicleInstance(nodeId))
		return
	}
	const vehicleNodes = collectVehicleNodes(document.nodes)
	const desiredIds = new Set<string>()
	vehicleNodes.forEach((node) => desiredIds.add(node.id))
	vehicleInstances.forEach((_entry, nodeId) => {
		if (!desiredIds.has(nodeId)) {
			removeVehicleInstance(nodeId)
		}
	})
	vehicleNodes.forEach((node) => {
		if (!vehicleInstances.has(node.id)) {
			ensureVehicleBindingForNode(node.id)
		}
	})
}

function syncPhysicsBodiesForDocument(document: SceneJsonExportDocument | null): void {
	if (!document) {
		resetPhysicsWorld()
		syncVehicleBindingsForDocument(null)
		syncAirWallsForDocument(null)
		return
	}
	const world = ensurePhysicsWorld()
	const rigidbodyNodes = collectRigidbodyNodes(document.nodes)
	const desiredIds = new Set<string>()
	rigidbodyNodes.forEach((node) => {
		desiredIds.add(node.id)
		const component = resolveRigidbodyComponent(node)
		const shapeDefinition = extractRigidbodyShape(component)
		const object = nodeObjectMap.get(node.id) ?? null
		const requiresMetadata = !isGroundDynamicMesh(node.dynamicMesh)
		if (!component || !object) {
			return
		}
		if (isRoadDynamicMesh(node.dynamicMesh) && (component.props as RigidbodyComponentProps | undefined)?.bodyType === 'STATIC') {
			ensureRoadRigidbodyInstance(node, component, object)
			refreshRigidbodyDebugHelper(node.id)
			return
		}
		if (!shapeDefinition && requiresMetadata) {
			return
		}
		const existing = rigidbodyInstances.get(node.id)
		if (existing) {
			removeRigidbodyInstanceBodies(world, existing)
			rigidbodyInstances.delete(node.id)
		}
		const bodyEntry = createRigidbodyBody(node, component, shapeDefinition, object)
		if (!bodyEntry) {
			return
		}
		world.addBody(bodyEntry.body)
		rigidbodyInstances.set(node.id, {
			nodeId: node.id,
			body: bodyEntry.body,
			bodies: [bodyEntry.body],
			object,
			orientationAdjustment: bodyEntry.orientationAdjustment,
		})
		refreshRigidbodyDebugHelper(node.id)
	})
	rigidbodyInstances.forEach((entry, nodeId) => {
		if (!desiredIds.has(nodeId)) {
			removeRigidbodyInstanceBodies(world, entry)
			rigidbodyInstances.delete(nodeId)
			removeRigidbodyDebugHelper(nodeId)
		}
	})
	groundHeightfieldCache.forEach((_entry, nodeId) => {
		if (!desiredIds.has(nodeId)) {
			groundHeightfieldCache.delete(nodeId)
		}
	})

	syncVehicleBindingsForDocument(document)
	syncAirWallsForDocument(document)
}

function stepPhysicsWorld(delta: number): void {
	if (!physicsWorld || !rigidbodyInstances.size) {
		return
	}

	// RaycastVehicle registers postStep callbacks that can introduce micro-jitter even when idle.
	// When not in manual drive nor auto-tour, remove the vehicle from the world to fully freeze it.
	const world = physicsWorld
	vehicleInstances.forEach((instance) => {
		const nodeId = instance.nodeId
		if (!nodeId) {
			return
		}
		const manualActive = vehicleDriveState.active && vehicleDriveState.nodeId === nodeId
		const tourActive = activeAutoTourNodeIds.has(nodeId)
		const shouldBeInWorld = manualActive || tourActive
		const isInWorld = vehicleRaycastInWorld.has(nodeId)
		if (shouldBeInWorld && !isInWorld) {
			try {
				instance.vehicle.addToWorld(world)
				vehicleRaycastInWorld.add(nodeId)
			} catch (error) {
				console.warn('[ScenePreview] Failed to add vehicle to world', error)
			}
			return
		}
		if (!shouldBeInWorld && isInWorld) {
			try {
				instance.vehicle.removeFromWorld(world)
				vehicleRaycastInWorld.delete(nodeId)
			} catch (error) {
				console.warn('[ScenePreview] Failed to remove vehicle from world', error)
			}
			const chassisBody = instance.vehicle?.chassisBody
			if (chassisBody) {
				try {
					chassisBody.allowSleep = true
					chassisBody.sleepSpeedLimit = Math.max(0.05, chassisBody.sleepSpeedLimit ?? 0)
					chassisBody.sleepTimeLimit = Math.max(0.05, chassisBody.sleepTimeLimit ?? 0)
					chassisBody.velocity.set(0, 0, 0)
					chassisBody.angularVelocity.set(0, 0, 0)
					;(chassisBody as any).sleep?.()
				} catch {
					// best-effort
				}
			}
		}
	})
	try {
		physicsWorld.step(PHYSICS_FIXED_TIMESTEP, delta, PHYSICS_MAX_SUB_STEPS)
	} catch (error) {
		console.warn('[ScenePreview] Physics step failed', error)
	}

	// Ensure vehicles are truly static after exiting drive/auto-tour.
	// If a vehicle wakes up or drifts when no controller is active, hard-stop it and log for debugging.
	const nowMs = Date.now()
	vehicleInstances.forEach((instance) => {
		const nodeId = instance.nodeId
		if (!nodeId) {
			return
		}
		const manualActive = vehicleDriveState.active && vehicleDriveState.nodeId === nodeId
		const tourActive = activeAutoTourNodeIds.has(nodeId)
		if (manualActive || tourActive) {
			return
		}
		const chassisBody = instance.vehicle?.chassisBody
		if (!chassisBody) {
			return
		}
		const vx = chassisBody.velocity?.x ?? 0
		const vy = chassisBody.velocity?.y ?? 0
		const vz = chassisBody.velocity?.z ?? 0
		const wx = chassisBody.angularVelocity?.x ?? 0
		const wy = chassisBody.angularVelocity?.y ?? 0
		const wz = chassisBody.angularVelocity?.z ?? 0
		// forces/torque not needed here
		const speedSq = vx * vx + vy * vy + vz * vz
		const angSq = wx * wx + wy * wy + wz * wz
		const sleepState = (chassisBody as any).sleepState as number | undefined
		const drifting = speedSq > 1e-10 || angSq > 1e-10
		const awake = sleepState === 0
		if (!drifting && !awake) {
			return
		}

		const lastLog = vehicleIdleFreezeLastLogMs.get(nodeId) ?? 0
		if (nowMs - lastLog > 750) {
			vehicleIdleFreezeLastLogMs.set(nodeId, nowMs)
			// idle drift detected; forcing stop (no debug log)
		}
		try {
			chassisBody.allowSleep = true
			chassisBody.sleepSpeedLimit = Math.max(0.05, chassisBody.sleepSpeedLimit ?? 0)
			chassisBody.sleepTimeLimit = Math.max(0.05, chassisBody.sleepTimeLimit ?? 0)
			for (let index = 0; index < instance.wheelCount; index += 1) {
				instance.vehicle.applyEngineForce(0, index)
				instance.vehicle.setSteeringValue(0, index)
				instance.vehicle.setBrake(VEHICLE_BRAKE_FORCE, index)
			}
			chassisBody.velocity.set(0, 0, 0)
			chassisBody.angularVelocity.set(0, 0, 0)
			;(chassisBody as any).sleep?.()
		} catch {
			// best-effort
		}
	})
	rigidbodyInstances.forEach((entry) => {
		if (entry.syncObjectFromBody === false) {
			return
		}
		// AutoTour non-vehicle branch moves the render object directly; do not overwrite it from physics.
		const nodeState = resolveNodeById(entry.nodeId)
		const isAutoTourActive = activeAutoTourNodeIds.has(entry.nodeId)
		if (isAutoTourActive) {
			const vehicle = resolveEnabledComponentState<VehicleComponentProps>(nodeState, VEHICLE_COMPONENT_TYPE)
			if (!vehicle) {
				return
			}
		}
		syncSharedObjectFromBody(entry, syncInstancedTransform)
	})
}

function updateVehicleWheelVisuals(delta: number): void {
	// Only update when time advances and vehicle instances exist.
	if (delta <= 0 || !vehicleInstances.size) {
		return
	}
	vehicleInstances.forEach((instance) => {
		const { vehicle, wheelBindings } = instance
		// No wheel bindings, nothing to update.
		if (!wheelBindings.length) {
			return
		}
		const chassisBody = vehicle.chassisBody
		if (!chassisBody) {
			return
		}

		wheelChassisPositionHelper.set(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z)
		wheelChassisQuaternionHelper
			.set(chassisBody.quaternion.x, chassisBody.quaternion.y, chassisBody.quaternion.z, chassisBody.quaternion.w)
			.normalize()

		// Signed travel along the vehicle forward axis (supports reverse).
		let signedTravel = 0
		if (instance.hasChassisPositionSample) {
			wheelChassisDisplacementHelper.copy(wheelChassisPositionHelper).sub(instance.lastChassisPosition)
			wheelForwardHelper.copy(instance.axisForward).applyQuaternion(wheelChassisQuaternionHelper)
			if (wheelForwardHelper.lengthSq() < 1e-10) {
				wheelForwardHelper.set(0, 0, 1)
			} else {
				wheelForwardHelper.normalize()
			}
			signedTravel = wheelChassisDisplacementHelper.dot(wheelForwardHelper)
			if (!Number.isFinite(signedTravel) || Math.abs(signedTravel) < VEHICLE_TRAVEL_EPSILON) {
				signedTravel = 0
			}
			// Avoid huge jumps on teleports/resets.
			if (Math.abs(signedTravel) > 50) {
				signedTravel = 0
			}
		}
		instance.lastChassisPosition.copy(wheelChassisPositionHelper)
		instance.hasChassisPositionSample = true

		const wheelInfos = (vehicle as any).wheelInfos as Array<{ steering?: number }> | undefined

		wheelBindings.forEach((binding) => {
			if (!binding.nodeId) {
				return
			}
			const wheelObject = nodeObjectMap.get(binding.nodeId) ?? null
			if (!wheelObject) {
				binding.object = null
				return
			}

			// Capture base transform if the wheel object becomes available after the vehicle instance was created
			// or if the object reference changed (e.g. asset reloaded).
			if (binding.object !== wheelObject) {
				binding.object = wheelObject
				binding.basePosition.copy(wheelObject.position)
				binding.baseScale.copy(wheelObject.scale)
				binding.baseQuaternion.copy(wheelObject.quaternion)
				binding.spinAngle = 0
				binding.lastSteeringAngle = 0
			}

			// Keep wheel translation/scale stable; only rotate for steer + spin.
			wheelObject.position.copy(binding.basePosition)
			wheelObject.scale.copy(binding.baseScale)

			// Wheel roll based on chassis travel.
			if (signedTravel !== 0) {
				const radius = Math.max(binding.radius, VEHICLE_WHEEL_MIN_RADIUS)
				// Sign convention: for our wheel assets, forward travel should spin the wheel forward.
				// If visuals appear reversed, flip the travel-derived roll sign here.
				const rollDelta = -signedTravel / radius
				if (Number.isFinite(rollDelta) && Math.abs(rollDelta) > VEHICLE_WHEEL_SPIN_EPSILON) {
					binding.spinAngle += rollDelta
					// Keep angles bounded to avoid float growth.
					binding.spinAngle =
						THREE.MathUtils.euclideanModulo(binding.spinAngle + Math.PI, Math.PI * 2) - Math.PI
				}
			}

			// Steering (front/steerable wheels).
			let steeringAngle = 0
			if (binding.isFrontWheel) {
				const info = wheelInfos?.[binding.wheelIndex]
				const raw = info?.steering
				if (typeof raw === 'number' && Number.isFinite(raw)) {
					steeringAngle = raw
				} else if (vehicleDriveState.active && vehicleDriveState.vehicle === vehicle) {
					// Fallback: approximate from current input (matches controller's typical max steer).
					steeringAngle = THREE.MathUtils.clamp(vehicleDriveInput.steering, -1, 1) * THREE.MathUtils.degToRad(26)
				}
			}
			binding.lastSteeringAngle = steeringAngle

			// Build parent-space steering quaternion (around vehicle up axis).
			wheelParentWorldQuaternionHelper.identity()
			wheelParentWorldQuaternionInverseHelper.identity()
			if (wheelObject.parent) {
				wheelObject.parent.getWorldQuaternion(wheelParentWorldQuaternionHelper)
				wheelParentWorldQuaternionInverseHelper.copy(wheelParentWorldQuaternionHelper).invert()
			}
			wheelAxisHelper.copy(instance.axisUp).applyQuaternion(wheelChassisQuaternionHelper)
			if (wheelObject.parent) {
				wheelAxisHelper.applyQuaternion(wheelParentWorldQuaternionInverseHelper)
			}
			if (wheelAxisHelper.lengthSq() < 1e-10) {
				wheelAxisHelper.set(0, 1, 0)
			} else {
				wheelAxisHelper.normalize()
			}
			wheelSteeringQuaternionHelper.setFromAxisAngle(wheelAxisHelper, steeringAngle)

			// Build local-space spin quaternion (around wheel axle).
			wheelAxisHelper.copy(binding.axleAxis).applyQuaternion(wheelChassisQuaternionHelper)
			if (wheelObject.parent) {
				wheelAxisHelper.applyQuaternion(wheelParentWorldQuaternionInverseHelper)
			}
			if (wheelAxisHelper.lengthSq() < 1e-10) {
				wheelAxisHelper.copy(defaultWheelAxisVector)
				wheelAxisHelper.applyQuaternion(wheelChassisQuaternionHelper)
				if (wheelObject.parent) {
					wheelAxisHelper.applyQuaternion(wheelParentWorldQuaternionInverseHelper)
				}
			}
			if (wheelAxisHelper.lengthSq() < 1e-10) {
				wheelAxisHelper.set(1, 0, 0)
			} else {
				wheelAxisHelper.normalize()
			}
			wheelBaseQuaternionInverseHelper.copy(binding.baseQuaternion).invert()
			wheelAxisHelper.applyQuaternion(wheelBaseQuaternionInverseHelper)
			if (wheelAxisHelper.lengthSq() < 1e-10) {
				wheelAxisHelper.set(1, 0, 0)
			} else {
				wheelAxisHelper.normalize()
			}
			wheelSpinQuaternionHelper.setFromAxisAngle(wheelAxisHelper, binding.spinAngle)

			// Compose: base -> (parent-space steer) -> (local-space spin).
			wheelVisualQuaternionHelper.copy(binding.baseQuaternion)
			if (steeringAngle !== 0) {
				wheelVisualQuaternionHelper.premultiply(wheelSteeringQuaternionHelper)
			}
			if (binding.spinAngle !== 0) {
				wheelVisualQuaternionHelper.multiply(wheelSpinQuaternionHelper)
			}
			wheelObject.quaternion.copy(wheelVisualQuaternionHelper)

			syncInstancedTransform(wheelObject)
		})
	})
}

function updateNodeTransfrom(object: THREE.Object3D, node: SceneNode) {
	const skipTransformSync = activeAutoTourNodeIds.has(node.id) && !vehicleInstances.has(node.id)
	if (node.position) {
		if (!skipTransformSync) {
			object.position.set(node.position.x, node.position.y, node.position.z)
		}
	}
	if (node.rotation) {
		if (!skipTransformSync) {
			object.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z)
		}
	}
	if (node.scale) {
		object.scale.set(node.scale.x, node.scale.y, node.scale.z)
	}
	if (object.userData?.instancedAssetId) {
		syncContinuousInstancedModelCommitted({
			node,
			object,
			assetId: object.userData.instancedAssetId as string,
		})
		return
	}
	syncInstancedTransform(object)
}


function updateNodeProperties(object: THREE.Object3D, node: SceneNode) {
	if (node.name) {
		object.name = node.name
	}
	const guideboardVisibility = resolveGuideboardInitialVisibility(node)
	if (guideboardVisibility !== null) {
		object.visible = guideboardVisibility
	} else if (node.editorFlags?.editorOnly || object.userData?.hidden === true) {
		object.visible = false
	} else if (typeof node.visible === 'boolean') {
		object.visible = node.visible
	} else {
		object.visible = true
	}
	updateNodeTransfrom(object, node)
	updateBehaviorVisibility(node.id, object.visible)
	applyMaterialOverrides(object, node.materials, materialOverrideOptions)
}

type LazyAssetMetadata = {
	placeholder?: boolean
	assetId?: string | null
	objectPath?: number[] | null
	boundingSphere?: { center: { x: number; y: number; z: number }; radius: number } | null
	ownerNodeId?: string | null
} | undefined

function findLazyPlaceholderForNode(root: THREE.Object3D | null | undefined, nodeId: string): THREE.Object3D | null {
	if (!root) {
		return null
	}
	const stack: THREE.Object3D[] = [root]
	while (stack.length) {
		const current = stack.pop()
		if (!current) {
			continue
		}
		const lazyData = current.userData?.lazyAsset as LazyAssetMetadata
		if (lazyData?.placeholder) {
			const ownerId = lazyData.ownerNodeId ?? (current.userData?.nodeId as string | undefined) ?? null
			if (ownerId ? ownerId === nodeId : current === root) {
				return current
			}
		}
		if (current.children.length) {
			stack.push(...current.children)
		}
	}
	return null
}

function initializeLazyPlaceholders(document: SceneJsonExportDocument | null | undefined): void {
	lazyPlaceholderStates.clear()
	activeLazyLoadCount = 0
	if (!document || !lazyLoadMeshesEnabled) {
		return
	}
	nodeObjectMap.forEach((object, nodeId) => {
		const placeholderObject = findLazyPlaceholderForNode(object, nodeId)
		if (!placeholderObject) {
			return
		}
		const lazyData = placeholderObject.userData?.lazyAsset as LazyAssetMetadata
		if (!lazyData || !lazyData.placeholder || !lazyData.assetId) {
			return
		}
		const sphere = lazyData.boundingSphere
			? new THREE.Sphere(
				new THREE.Vector3(
					lazyData.boundingSphere.center.x,
					lazyData.boundingSphere.center.y,
					lazyData.boundingSphere.center.z,
				),
				lazyData.boundingSphere.radius,
			)
			: null
		lazyPlaceholderStates.set(nodeId, {
			nodeId,
			container: object,
			placeholder: placeholderObject,
			assetId: lazyData.assetId,
			objectPath: Array.isArray(lazyData.objectPath) ? [...lazyData.objectPath] : null,
			boundingSphere: sphere,
			loading: false,
			loaded: false,
			pending: null,
		})
	})
}

function updateLazyPlaceholders(_delta: number): void {
	if (!lazyLoadMeshesEnabled || !camera || lazyPlaceholderStates.size === 0) {
		return
	}
	camera.updateMatrixWorld(true)
	tempCameraMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
	cameraViewFrustum.setFromProjectionMatrix(tempCameraMatrix)
	lazyPlaceholderStates.forEach((state, nodeId) => {
		const container = nodeObjectMap.get(nodeId) ?? null
		if (!container) {
			lazyPlaceholderStates.delete(nodeId)
			return
		}
		state.container = container
		const placeholderObject = findLazyPlaceholderForNode(container, nodeId)
		if (!placeholderObject) {
			lazyPlaceholderStates.delete(nodeId)
			return
		}
		state.placeholder = placeholderObject
		const lazyData = placeholderObject.userData?.lazyAsset as LazyAssetMetadata
		if (!lazyData || !lazyData.placeholder || !lazyData.assetId) {
			lazyPlaceholderStates.delete(nodeId)
			return
		}
		state.assetId = lazyData.assetId
		state.objectPath = Array.isArray(lazyData.objectPath) ? [...lazyData.objectPath] : null
		if (lazyData.boundingSphere) {
			if (!state.boundingSphere) {
				state.boundingSphere = new THREE.Sphere()
			}
			state.boundingSphere.center.set(
				lazyData.boundingSphere.center.x,
				lazyData.boundingSphere.center.y,
				lazyData.boundingSphere.center.z,
			)
			state.boundingSphere.radius = lazyData.boundingSphere.radius
		} else {
			state.boundingSphere = null
		}
		if (state.loaded) {
			lazyPlaceholderStates.delete(nodeId)
			return
		}
		if (state.loading || state.pending) {
			return
		}
		if (activeLazyLoadCount >= MAX_CONCURRENT_LAZY_LOADS) {
			return
		}
		if (!shouldLoadLazyPlaceholder(state, cameraViewFrustum)) {
			return
		}
		state.loading = true
		activeLazyLoadCount += 1
		const pending = loadActualAssetForPlaceholder(state)
			.catch((error) => {
				console.warn('[ScenePreview] Failed to load detailed mesh', error)
			})
			.finally(() => {
				state.loading = false
				activeLazyLoadCount = Math.max(0, activeLazyLoadCount - 1)
				state.pending = null
			})
		state.pending = pending
	})
}

function shouldLoadLazyPlaceholder(state: LazyPlaceholderState, frustum: THREE.Frustum): boolean {
	if (!camera) {
		return false
	}
	const object = state.placeholder
	if (!object.visible) {
		return false
	}
	const worldSphere = resolveWorldBoundingSphereForPlaceholder(state, object)
	if (!worldSphere) {
		return false
	}
	return frustum.intersectsSphere(worldSphere)
}

function resolveWorldBoundingSphereForPlaceholder(state: LazyPlaceholderState, object: THREE.Object3D): THREE.Sphere | null {
	object.updateWorldMatrix(true, false)
	let baseSphere = state.boundingSphere ? state.boundingSphere.clone() : null
	const mesh = object as THREE.Mesh & { geometry?: THREE.BufferGeometry }
	const geometry = mesh.geometry as THREE.BufferGeometry | undefined
	if (!baseSphere && geometry) {
		if (!geometry.boundingSphere) {
			geometry.computeBoundingSphere()
		}
		if (geometry.boundingSphere) {
			baseSphere = geometry.boundingSphere.clone()
		}
	}
	if (baseSphere) {
		tempOutlineSphere.center.copy(baseSphere.center).applyMatrix4(object.matrixWorld)
		object.getWorldScale(tempOutlineScale)
		const maxScale = Math.max(tempOutlineScale.x, tempOutlineScale.y, tempOutlineScale.z)
		tempOutlineSphere.radius = baseSphere.radius * maxScale
		return tempOutlineSphere
	}
	const worldBox = tempBox.setFromObject(object)
	if (worldBox.isEmpty()) {
		return null
	}
	return worldBox.getBoundingSphere(tempOutlineSphere)
}

async function loadActualAssetForPlaceholder(state: LazyPlaceholderState): Promise<void> {
	const resourceCache = editorResourceCache
	const document = currentDocument
	if (!resourceCache || !document) {
		return
	}
	const node = resolveNodeById(state.nodeId)
	if (!node) {
		lazyPlaceholderStates.delete(state.nodeId)
		deferredInstancingNodeIds.delete(state.nodeId)
		return
	}
	if (deferredInstancingNodeIds.has(state.nodeId)) {
		const instanced = await applyDeferredInstancingForNode(state.nodeId)
		if (instanced) {
			state.loaded = true
			lazyPlaceholderStates.delete(state.nodeId)
			return
		}
		deferredInstancingNodeIds.delete(state.nodeId)
	}
	try {
		const detailed = await loadNodeObject(resourceCache, state.assetId, node.importMetadata ?? null)
		if (!detailed) {
			lazyPlaceholderStates.delete(state.nodeId)
			deferredInstancingNodeIds.delete(state.nodeId)
			return
		}
		detailed.position.set(0, 0, 0)

		prepareImportedObjectForPreview(detailed)
		const placeholder = state.placeholder
		const container = state.container ?? nodeObjectMap.get(state.nodeId) ?? null
		const metadata = { ...(placeholder.userData ?? {}), nodeId: state.nodeId } as Record<string, unknown>
		const lazyMetadata = { ...((metadata.lazyAsset as Record<string, unknown> | undefined) ?? {}) }
		detailed.userData = {
			...detailed.userData,
			...metadata,
			lazyAsset: {
				...lazyMetadata,
				placeholder: false,
				loaded: true,
			},
		}
		const parent = placeholder.parent
			?? (container && container !== placeholder ? container : null)
			?? rootGroup
		const insertIndex = parent ? parent.children.indexOf(placeholder) : -1
		if (parent) {
			parent.add(detailed)
			if (insertIndex >= 0) {
				parent.children.splice(parent.children.indexOf(detailed), 1)
				parent.children.splice(insertIndex, 0, detailed)
			}
		}

		if (!container || container === placeholder) {
			updateNodeProperties(detailed, node)
		} else {
			updateNodeProperties(container, node)
		}
		detailed.updateMatrixWorld(true)
		const existingObject = nodeObjectMap.get(state.nodeId)
		placeholder.parent?.remove(placeholder)
		disposeObjectResources(placeholder)
		if (!existingObject || existingObject === placeholder) {
			nodeObjectMap.delete(state.nodeId)
			registerSubtree(detailed)
		}
		state.loaded = true
		deferredInstancingNodeIds.delete(state.nodeId)
		lazyPlaceholderStates.delete(state.nodeId)
		refreshAnimations()
	} catch (error) {
		console.warn('[ScenePreview] Deferred asset load failed', error)
		lazyPlaceholderStates.delete(state.nodeId)
		deferredInstancingNodeIds.delete(state.nodeId)
	}
}

async function applyDeferredInstancingForNode(nodeId: string): Promise<boolean> {
	if (!deferredInstancingNodeIds.has(nodeId)) {
		return false
	}
	if (!currentDocument || !editorResourceCache || !rootGroup) {
		return false
	}
	const includeNodeIds = new Set<string>([nodeId])
	const pending = new Map<string, THREE.Object3D>()
	try {
		await prepareInstancedNodesForDocument(currentDocument, pending, editorResourceCache, {
			includeNodeIds,
		})
	} catch (error) {
		console.warn('[ScenePreview] Failed to prepare instanced node after lazy load', error)
		return false
	}
	if (!pending.size) {
		return false
	}
	const pendingParentIds = new Set<string>()
	pending.forEach((_object, id) => {
		const parentId = resolveParentNodeId(id)
		if (parentId && pending.has(parentId)) {
			pendingParentIds.add(id)
		}
	})
	const attachmentEntries = Array.from(pending.entries()).filter(([id]) => !pendingParentIds.has(id))
	let attached = false
	attachmentEntries.forEach(([id, object]) => {
		const parentId = resolveParentNodeId(id)
		let parentObject: THREE.Object3D | null = null
		if (parentId) {
			parentObject = nodeObjectMap.get(parentId) ?? null
		}
		if (!parentObject) {
			parentObject = rootGroup
		}
		if (!parentObject) {
			return
		}
		parentObject.add(object)
		registerSubtree(object, pending)
		attached = true
	})
	if (!attached) {
		return false
	}
	deferredInstancingNodeIds.delete(nodeId)
	return true
}

function prepareImportedObjectForPreview(object: THREE.Object3D): void {
	object.traverse((child) => {
		const mesh = child as THREE.Mesh & { material?: THREE.Material | THREE.Material[] }
		if (!(mesh as any).isMesh && !(mesh as any).isSkinnedMesh) {
			return
		}
		mesh.castShadow = true
		mesh.receiveShadow = true
		const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
		materials.forEach((material) => {
			if (!material) {
				return
			}
			const typed = material as THREE.Material & { side?: number }
			if (typeof typed.side !== 'undefined') {
				typed.side = THREE.DoubleSide
			}
			typed.needsUpdate = true
		})
	})
}

function structuralSignature(node: SceneNode | null | undefined): string {
	if (!node) {
		return ''
	}
	const type = node.nodeType ?? (node.light ? 'Light' : node.dynamicMesh ? 'Mesh' : 'Group')
	const dynamicSignature = node.dynamicMesh ? JSON.stringify(node.dynamicMesh) : ''
	const source = node.sourceAssetId ?? ''
	const lightType = node.light?.type ?? ''
	const materialSignature = node.materials ? JSON.stringify(node.materials) : ''
	return [type, dynamicSignature, source, lightType, materialSignature].join('|')
}

function reconcileNodeLists(
	parentId: string | null,
	nextNodes: SceneNode[] = [],
	previousNodes: SceneNode[] = [],
	pending: Map<string, THREE.Object3D>,
) {
	const parentObject = parentId ? nodeObjectMap.get(parentId) : rootGroup
	if (!parentObject) {
		return
	}

	const nextIdSet = new Set(nextNodes.map((node) => node.id))
	previousNodes.forEach((node) => {
		if (!nextIdSet.has(node.id)) {
			removeNodeSubtree(node.id)
		}
	})

	const previousMap = new Map(previousNodes.map((node) => [node.id, node]))

	nextNodes.forEach((node, index) => {
		const existing = nodeObjectMap.get(node.id) ?? null
		const previous = previousMap.get(node.id) ?? null
		const shouldReplace = !existing || !previous || structuralSignature(node) !== structuralSignature(previous)
		let object = existing
		if (shouldReplace) {
			if (existing) {
				removeNodeSubtree(node.id)
			}
			object = adoptNodeFromPending(node.id, parentObject, pending)
		}
		if (!object) {
			return
		}
		updateNodeProperties(object, node)
		ensureChildOrder(parentObject, object, index)
		const nextChildren = Array.isArray(node.children) ? node.children : []
		const previousChildren = previous?.children ?? []
		reconcileNodeLists(node.id, nextChildren, previousChildren, pending)
	})
}


function refreshAnimations() {
	resetAnimationControllers()

	nodeObjectMap.forEach((object, nodeId) => {
		const clips = (object as unknown as { animations?: THREE.AnimationClip[] }).animations
		if (!Array.isArray(clips) || !clips.length) {
			return
		}
		const validClips = clips.filter((clip): clip is THREE.AnimationClip => Boolean(clip))
		if (!validClips.length) {
			return
		}
		const mixer = new THREE.AnimationMixer(object)
		mixer.timeScale = isPlaying.value ? 1 : 0
		animationMixers.push(mixer)
		const defaultClip = pickDefaultAnimationClip(validClips)
		nodeAnimationControllers.set(nodeId, { mixer, clips: validClips, defaultClip })
		if (defaultClip) {
			playAnimationClip(mixer, defaultClip, { loop: true })
		}
	})

	refreshEffectRuntimeTickers()
}

function collectPendingObjects(root: THREE.Object3D): Map<string, THREE.Object3D> {
	const pendingObjects = new Map<string, THREE.Object3D>()
	root.traverse((object) => {
		const nodeId = object.userData?.nodeId as string | undefined
		if (nodeId) {
			pendingObjects.set(nodeId, object)
		}
	})
	return pendingObjects
}

function resolveInstancingSkipNodeIds(pendingObjects: Map<string, THREE.Object3D>): Set<string> | null {
	if (!lazyLoadMeshesEnabled) {
		return null
	}
	const skipIds = new Set<string>()
	pendingObjects.forEach((object, nodeId) => {
		const placeholderObject = findLazyPlaceholderForNode(object, nodeId)
		const lazyData = placeholderObject?.userData?.lazyAsset as LazyAssetMetadata
		if (lazyData?.placeholder) {
			skipIds.add(nodeId)
		}
	})
	return skipIds.size ? skipIds : null
}

function attachBuiltRootToPreview(
	previewRoot: THREE.Object3D,
	builtRoot: THREE.Object3D,
	pendingObjects: Map<string, THREE.Object3D>,
): void {
	while (builtRoot.children.length) {
		const child = builtRoot.children.shift()
		if (!child) {
			continue
		}
		previewRoot.add(child)
		registerSubtree(child, pendingObjects)
	}
}

async function applyInitialDocumentGraph(
	document: SceneJsonExportDocument,
	previewRoot: THREE.Object3D,
	builtRoot: THREE.Object3D,
	pendingObjects: Map<string, THREE.Object3D>,
	resourceCache: ResourceCache | null,
	environmentSettings: EnvironmentSettings,
): Promise<void> {
	disposeScene({ preservePreviewNodeMap: true })
	currentDocument = document
	attachBuiltRootToPreview(previewRoot, builtRoot, pendingObjects)
	syncGroundCache(document)
	// (instancing trace removed)
	await syncTerrainScatterInstances(document, resourceCache)
	refreshAnimations()
	initializeLazyPlaceholders(document)
	syncPhysicsBodiesForDocument(document)
	const protagonistCameraActive = !vehicleDriveState.active && (controlMode.value === 'first-person' || controlMode.value === 'third-person')
	syncProtagonistCameraPose({ force: true, applyToCamera: protagonistCameraActive })
	if (isRigidbodyDebugVisible.value) {
		syncRigidbodyDebugHelpers()
	}
	void applyEnvironmentSettingsToScene(environmentSettings)
}

async function applyIncrementalDocumentGraph(
	document: SceneJsonExportDocument,
	previewRoot: THREE.Object3D,
	pendingObjects: Map<string, THREE.Object3D>,
	resourceCache: ResourceCache | null,
	environmentSettings: EnvironmentSettings,
): Promise<void> {
	reconcileNodeLists(null, document.nodes ?? [], currentDocument?.nodes ?? [], pendingObjects)

	for (const [nodeId, object] of Array.from(pendingObjects.entries())) {
		if (!nodeObjectMap.has(nodeId)) {
			previewRoot.add(object)
			registerSubtree(object, pendingObjects)
		}
	}

	syncGroundCache(document)

	nodeObjectMap.forEach((object, nodeId) => {
		attachRuntimeForNode(nodeId, object)
	})
	syncPhysicsBodiesForDocument(document)
	await syncTerrainScatterInstances(document, resourceCache)
	const protagonistCameraActive = !vehicleDriveState.active && (controlMode.value === 'first-person' || controlMode.value === 'third-person')
	syncProtagonistCameraPose({ force: true, applyToCamera: protagonistCameraActive })
	if (isRigidbodyDebugVisible.value) {
		syncRigidbodyDebugHelpers()
	}

	currentDocument = document
	refreshAnimations()
	initializeLazyPlaceholders(document)
	void applyEnvironmentSettingsToScene(environmentSettings)
	// (instancing trace removed)
}

async function updateScene(document: SceneJsonExportDocument) {
	resetAssetResolutionCaches()
	releaseTerrainScatterInstances()
	resetProtagonistPoseState()
	refreshResourceAssetInfo(document)
	const skyboxSettings = resolveDocumentSkybox(document)
	applySkyboxSettings(skyboxSettings)
	const environmentSettings = resolveDocumentEnvironment(document)
	lazyLoadMeshesEnabled = document.lazyLoadMeshes !== false
	deferredInstancingNodeIds.clear()
	if (!scene || !rootGroup) {
		return
	}
	const previewRoot = rootGroup
	resourceProgress.active = true
	resourceProgress.loaded = 0
	resourceProgress.total = 0
	resourceProgress.loadedBytes = 0
	resourceProgress.totalBytes = 0
	resourceProgress.label = 'Preparing resources...'
	resourceProgressItems.value = []

	let graphResult: Awaited<ReturnType<typeof buildSceneGraph>> | null = null
	let resourceCache: ResourceCache | null = null
	try {
		const buildOptions: SceneGraphBuildOptions = {
			onProgress: (info) => {
				resourceProgress.total = info.total
				resourceProgress.loaded = info.loaded
				if (typeof info.bytesTotal === 'number' && Number.isFinite(info.bytesTotal) && info.bytesTotal > 0) {
					resourceProgress.totalBytes = info.bytesTotal
				}
				if (typeof info.bytesLoaded === 'number' && Number.isFinite(info.bytesLoaded) && info.bytesLoaded >= 0) {
					resourceProgress.loadedBytes = info.bytesLoaded
				}
				resourceProgress.label = info.message || (info.assetId ? `Loading ${info.assetId}` : '')
				updateResourceProgressDetails(info)
				const stillLoadingByCount = info.total > 0 && info.loaded < info.total
				const stillLoadingByBytes = resourceProgress.totalBytes > 0 && resourceProgress.loadedBytes < resourceProgress.totalBytes
				resourceProgress.active = stillLoadingByCount || stillLoadingByBytes
			},
			materialFactoryOptions: {
				hdrLoader: rgbeLoader,
			},
		}
		if (activeScenePackageAssetOverrides) {
			buildOptions.assetOverrides = activeScenePackageAssetOverrides
		}
		resourceCache = ensureEditorResourceCache(document, buildOptions)
		graphResult = await buildSceneGraph(document, resourceCache, buildOptions)
	} finally {
		resourceProgress.active = false
		if (resourceProgress.totalBytes > 0) {
			resourceProgress.loadedBytes = resourceProgress.totalBytes
		}
		resourceProgress.label = ''
		resourceProgressItems.value = []
	}
	if (!graphResult) {
		return
	}
	const { root, warnings } = graphResult
	// (instancing trace removed)
	warningMessages.value = warnings
	dismissBehaviorAlert()
	resetBehaviorRuntime()
	previewComponentManager.reset()
	rebuildPreviewNodeMap(document.nodes)
	refreshBehaviorProximityCandidates()

	const pendingObjects = collectPendingObjects(root)
	const instancingSkipNodeIds = resolveInstancingSkipNodeIds(pendingObjects)
	instancingSkipNodeIds?.forEach((nodeId) => {
		deferredInstancingNodeIds.add(nodeId)
	})
	if (resourceCache) {
		await prepareInstancedNodesForDocument(document, pendingObjects, resourceCache, {
			skipNodeIds: instancingSkipNodeIds ?? undefined,
		})
	}

	const applyIncremental = Boolean(currentDocument) && !forceInitialDocumentGraphOnNextSnapshot
	forceInitialDocumentGraphOnNextSnapshot = false

	if (applyIncremental) {
		await applyIncrementalDocumentGraph(
			document, 
			previewRoot,
			pendingObjects, 
			resourceCache, 
			environmentSettings)
	} else {
		await applyInitialDocumentGraph(
			document,
			previewRoot,
			root,
			pendingObjects,
			resourceCache,
			environmentSettings,
		)
	}
}

function applySnapshot(snapshot: ScenePreviewSnapshot) {
	if (snapshot.revision <= lastSnapshotRevision) {
		return
	}
	lastSnapshotRevision = snapshot.revision
	if (isApplyingSnapshot) {
		queuedSnapshot = snapshot
		return
	}
	isApplyingSnapshot = true
	statusMessage.value = 'Syncing scene data...'
	void updateScene(snapshot.document)
		.then(() => {
			lastUpdateTime.value = snapshot.timestamp
			statusMessage.value = ''
		})
		.catch((error) => {
			console.error('[ScenePreview] Failed to apply snapshot', error)
			statusMessage.value = 'Failed to load scene. Please try again later.'
		})
		.finally(() => {
			isApplyingSnapshot = false
			if (queuedSnapshot) {
				const pending = queuedSnapshot
				queuedSnapshot = null
				applySnapshot(pending)
			}
		})
}

function togglePlayback() {
	isPlaying.value = !isPlaying.value
}

function toggleGroundWireframeDebug(): void {
	isGroundWireframeVisible.value = !isGroundWireframeVisible.value
}

function toggleOtherRigidbodyWireframeDebug(): void {
	isOtherRigidbodyWireframeVisible.value = !isOtherRigidbodyWireframeVisible.value
}

function toggleGroundChunkStreamingDebug(): void {
	isGroundChunkStreamingDebugVisible.value = !isGroundChunkStreamingDebugVisible.value
	if (!isGroundChunkStreamingDebugVisible.value) {
		disposeGroundChunkDebugHelpers()
	}
}

function toggleInstancedCullingVisualization(): void {
	isInstancedCullingVisualizationVisible.value = !isInstancedCullingVisualizationVisible.value
	if (!isInstancedCullingVisualizationVisible.value) {
		disposeInstancedCullingVisualization()
	}
}

function toggleFullscreen() {
	if (!containerRef.value) {
		return
	}
	if (document.fullscreenElement) {
		void document.exitFullscreen()
	} else {
		void containerRef.value.requestFullscreen()
	}
}

function captureScreenshot() {
	const currentRenderer = renderer
	const currentScene = scene
	const activeCamera = camera
	if (!currentRenderer || !currentScene || !activeCamera) {
		return
	}
	currentRenderer.render(currentScene, activeCamera)
	const dataUrl = currentRenderer.domElement.toDataURL('image/png')
	if (!dataUrl) {
		return
	}
	const link = document.createElement('a')
	link.href = dataUrl
	link.download = `harmony-scene-${Date.now()}.png`
	document.body.appendChild(link)
	link.click()
	document.body.removeChild(link)
}


onMounted(() => {
	(globalThis as typeof globalThis & { [DISPLAY_BOARD_RESOLVER_KEY]?: typeof resolveDisplayBoardMediaSource })[
		DISPLAY_BOARD_RESOLVER_KEY
	] = resolveDisplayBoardMediaSource
	addBehaviorRuntimeListener(behaviorRuntimeListener)
	initRenderer()
	let handledInitialPayload = false
	if (typeof window !== 'undefined') {
		try {
			const url = new URL(window.location.href)
			const packageUrl = url.searchParams.get('packageUrl') || url.searchParams.get('zipUrl')
			if (packageUrl) {
				liveUpdatesDisabledSourceUrl.value = packageUrl
				handledInitialPayload = true
				void loadScenePackageFromUrl(packageUrl)
			}
			if (!handledInitialPayload) {
				const projectUrl = url.searchParams.get('projectUrl') || url.searchParams.get('bundleUrl')
				if (projectUrl) {
					liveUpdatesDisabledSourceUrl.value = projectUrl
					handledInitialPayload = true
					void loadProjectBundleFromUrl(projectUrl)
				}
			}
		} catch {
			// ignore
		}
	}
	if (!handledInitialPayload) {
		livePreviewEnabled = true
		unsubscribe = subscribeToScenePreview((snapshot) => {
			if (!livePreviewEnabled) {
				return
			}
			applySnapshot(snapshot)
		})
	}
	updateLanternViewportSize()
	if (typeof window !== 'undefined') {
		window.addEventListener('resize', handleLanternViewportResize)
	}
})

onBeforeUnmount(() => {
	rendererInitialized = false
	if (steeringWheelState.dragging) {
		releaseSteeringWheelPointer()
	}
	removeBehaviorRuntimeListener(behaviorRuntimeListener)
	activeBehaviorDelayTimers.forEach((handle) => window.clearTimeout(handle))
	activeBehaviorDelayTimers.clear()
	activeBehaviorAnimations.forEach((cancel) => {
		try {
			cancel()
		} catch (error) {
			console.warn('[ScenePreview] Failed to cancel behavior animation', error)
		}
	})
	activeBehaviorAnimations.clear()
	unsubscribe?.()
	unsubscribe = null
	stopAnimationLoop()
	teardownStatsPanels()
 	stopInstancedMeshSubscription?.()
 	stopInstancedMeshSubscription = null
	window.removeEventListener('resize', handleResize)
	document.removeEventListener('fullscreenchange', handleFullscreenChange)
	window.removeEventListener('keydown', handleKeyDown)
	window.removeEventListener('keyup', handleKeyUp)
	window.removeEventListener('resize', handleLanternViewportResize)
	disposeScene()
	disposeEnvironmentResources()
	disposeSkyResources()
	disposeMaterialTextureCache()
	pmremGenerator?.dispose()
	pmremGenerator = null
	lanternViewerInstance = null
	animationMixers.forEach((mixer) => mixer.stopAllAction())
	animationMixers = []
	if (firstPersonControls) {
		firstPersonControls.dispose()
		firstPersonControls = null
	}
	if (mapControls) {
		mapControls.dispose()
		mapControls = null
	}
	if (renderer) {
		renderer.domElement.removeEventListener('click', handleCanvasClick)
		renderer.dispose()
		renderer.domElement.remove()
		renderer = null
	}
	if (sunDirectionalLight) {
		sunDirectionalLight.parent?.remove(sunDirectionalLight)
		sunDirectionalLight.target.parent?.remove(sunDirectionalLight.target)
		sunDirectionalLight.dispose()
		sunDirectionalLight = null
	}
	editorResourceCache = null
	listener = null
	scene = null
	camera = null
	clearAssetObjectUrlCache()
	;(globalThis as typeof globalThis & { [DISPLAY_BOARD_RESOLVER_KEY]?: typeof resolveDisplayBoardMediaSource })[
		DISPLAY_BOARD_RESOLVER_KEY
	] = undefined
})
</script>

<template>
	<div class="scene-preview">
		<v-alert
			v-if="isLiveUpdatesDisabled"
			type="info"
			variant="tonal"
			density="compact"
			class="scene-preview__live-disabled"
		>
			<div class="scene-preview__live-disabled-content">
				<div class="scene-preview__live-disabled-text">
					{{ liveUpdatesDisabledLabel }}
				</div>
				<v-btn
					size="small"
					variant="text"
					color="primary"
					@click="switchToLivePreviewMode"
				>
					Switch to live preview
				</v-btn>
			</div>
		</v-alert>
		<div ref="containerRef" class="scene-preview__canvas"></div>
		<div class="scene-preview__stats">
			<div
				v-if="isDebugOverlayVisible"
				class="scene-preview__debug-overlay"
			>
				<template v-if="isRendererDebugVisible">
					<div class="scene-preview__stats-fallback">[Renderer]</div>
					<div class="scene-preview__stats-fallback">
						Viewport: {{ rendererDebug.width }}x{{ rendererDebug.height }} @PR {{ rendererDebug.pixelRatio }}
					</div>
					<div class="scene-preview__stats-fallback">
						Draw calls: {{ rendererDebug.calls }}, Tris: {{ rendererDebug.triangles }}
					</div>
					<div class="scene-preview__stats-fallback">
						GPU mem (geo/tex): {{ rendererDebug.geometries }} / {{ rendererDebug.textures }}
					</div>
				</template>
				<template v-if="isInstancingDebugVisible">
					<div class="scene-preview__stats-fallback">[Instancing]</div>
					<div class="scene-preview__stats-fallback">
						InstancedMeshes: {{ instancingDebug.instancedMesh }}
					</div>
					<div class="scene-preview__stats-fallback">
						Instanced active: {{ instancingDebug.instancedActive }}
					</div>
					<div class="scene-preview__stats-fallback">
						Instanced instances (sum mesh.count): {{ instancingDebug.instancedInstanceCount }}
					</div>
					<div class="scene-preview__stats-fallback">
						Instanced matrix upload est: {{ instancingDebug.instanceMatrixUploadKb }} KB/frame
					</div>
					<div class="scene-preview__stats-fallback">
						LOD nodes (visible/total): {{ instancingDebug.lodVisible }} / {{ instancingDebug.lodTotal }}
					</div>
					<div class="scene-preview__stats-fallback">
						Terrain scatter (visible/total): {{ instancingDebug.scatterVisible }} / {{ instancingDebug.scatterTotal }}
					</div>
				</template>
				<template v-if="isGroundChunkStatsVisible">
					<div class="scene-preview__stats-fallback">[Ground]</div>
					<div class="scene-preview__stats-fallback">
						Ground chunks (loaded/target/total): {{ groundChunkDebug.loaded }} / {{ groundChunkDebug.target }} / {{ groundChunkDebug.total }}
					</div>
					<div class="scene-preview__stats-fallback">
						Ground chunks (pending/unloaded): {{ groundChunkDebug.pending }} / {{ groundChunkDebug.unloaded }}
					</div>
				</template>
			</div>
			<div
				v-if="memoryFallbackLabel"
				class="scene-preview__stats-fallback"
			>
				{{ memoryFallbackLabel }}
			</div>
			<div ref="statsContainerRef" class="scene-preview__stats-panels"></div>
		</div>
		<div class="scene-preview__debug-menu">
			<v-menu
				v-model="isDebugMenuOpen"
				location="bottom end"
				offset="8"
				:close-on-content-click="false"
			>
				<template #activator="{ props: menuProps }">
					<v-btn
						class="scene-preview__control-button"
						v-bind="menuProps"
						icon="mdi-bug-outline"
						variant="tonal"
						color="secondary"
						size="small"
						title="Debug options"
						aria-label="Debug options"
					/>
				</template>
				<v-card class="scene-preview__debug-menu-card" elevation="10">
					<v-list density="compact" class="scene-preview__debug-list">
							<v-list-item>
								<v-checkbox
									class="scene-preview__debug-checkbox"
									label="Renderer stats"
									v-model="isRendererDebugVisible"
									hide-details
									density="compact"
									color="warning"
								/>
							</v-list-item>
							<v-list-item>
								<v-checkbox
									class="scene-preview__debug-checkbox"
									label="Instancing stats"
									v-model="isInstancingDebugVisible"
									hide-details
									density="compact"
									color="warning"
								/>
							</v-list-item>
							<v-list-item>
								<v-checkbox
									class="scene-preview__debug-checkbox"
									label="Ground streaming stats"
									v-model="isGroundChunkStatsVisible"
									hide-details
									density="compact"
									color="warning"
								/>
							</v-list-item>
						<v-list-item>
							<v-checkbox
								class="scene-preview__debug-checkbox"
								label="Frustum culling visualization"
								:model-value="isInstancedCullingVisualizationVisible"
								hide-details
								density="compact"
								color="warning"
								@update:model-value="toggleInstancedCullingVisualization"
							/>
						</v-list-item>
						<v-list-item>
							<v-checkbox
								class="scene-preview__debug-checkbox"
								label="Ground rigidbody wireframe"
								:model-value="isGroundWireframeVisible"
								hide-details
								density="compact"
								color="warning"
								@update:model-value="toggleGroundWireframeDebug"
							/>
						</v-list-item>
						<v-list-item>
							<v-checkbox
								class="scene-preview__debug-checkbox"
								label="Ground chunk debug"
								:model-value="isGroundChunkStreamingDebugVisible"
								hide-details
								density="compact"
								color="warning"
								@update:model-value="toggleGroundChunkStreamingDebug"
							/>
						</v-list-item>
						<v-list-item>
							<v-checkbox
								class="scene-preview__debug-checkbox"
								label="Other rigidbody wireframe"
								:model-value="isOtherRigidbodyWireframeVisible"
								hide-details
								density="compact"
								color="warning"
								@update:model-value="toggleOtherRigidbodyWireframeDebug"
							/>
						</v-list-item>
					</v-list>
				</v-card>
			</v-menu>
		</div>
		<div
			v-if="isPreloadOverlayVisible"
			class="scene-preview__preload-overlay"
		>
			<div
				v-if="isPreloadFlashVisible"
				class="scene-preview__transition-flash"
				:class="{ 'scene-preview__transition-flash--active': sceneSwitchFlashActive }"
			></div>
			<div
				v-if="resourceProgress.active"
				class="scene-preview__preload-card-wrap"
			>
				<v-card class="scene-preview__preload-card" elevation="12">
					<div class="scene-preview__preload-title">Loading resources...</div>
					<div class="scene-preview__progress">
						<div class="scene-preview__progress-bar">
							<div
								class="scene-preview__progress-bar-fill"
								:style="{ '--progress': `${resourceProgressPercent}%` }"
							/>
						</div>
						<div class="scene-preview__progress-stats">
							<span class="scene-preview__progress-percent">{{ resourceProgressPercent }}%</span>
							<span class="scene-preview__progress-bytes">{{ resourceProgressBytesLabel }}</span>
						</div>
					</div>
				<div
					v-if="resourceProgressItems.length"
					class="scene-preview__resource-list"
				>
					<div
						v-for="item in resourceProgressItems"
						:key="item.id"
						class="scene-preview__resource-item"
					>
						<div class="scene-preview__resource-header">
							<span class="scene-preview__resource-name">{{ item.label }}</span>
							<span class="scene-preview__resource-value">{{ item.progress }}%</span>
						</div>
							<div
								v-if="item.bytesTotal > 0"
								class="scene-preview__resource-bytes"
							>
								{{ formatByteSize(item.bytesLoaded) }} / {{ formatByteSize(item.bytesTotal) }}
							</div>
						<div class="scene-preview__progress-bar scene-preview__resource-progress-bar">
							<div
								class="scene-preview__progress-bar-fill"
								:class="{ 'scene-preview__progress-bar-fill--complete': item.progress >= 100 }"
								:style="{ '--progress': `${item.progress}%` }"
							/>
						</div>
					</div>
				</div>
				</v-card>
			</div>
		</div>
		<div
			v-if="statusMessage || formattedLastUpdate"
			class="scene-preview__update-banner"
		>
			<v-chip
				v-if="statusMessage"
				class="scene-preview__update-chip"
				color="secondary"
				variant="elevated"
				size="small"
				prepend-icon="mdi-information"
			>
				{{ statusMessage }}
			</v-chip>
			<v-chip
				v-else
				class="scene-preview__update-chip"
				color="primary"
				variant="flat"
				size="small"
				prepend-icon="mdi-update"
			>
				Last updated: {{ formattedLastUpdate }}
			</v-chip>
		</div>
		<v-alert
			v-if="warningMessages.length"
			class="scene-preview__alert"
			density="compact"
			type="warning"
			variant="tonal"
		>
			<div v-for="(message, index) in warningMessages" :key="`${message}-${index}`">
				{{ message }}
			</div>
		</v-alert>
		<div
			v-if="purposeControlsVisible"
			class="scene-preview__purpose-controls"
		>
			<v-btn
				class="scene-preview__purpose-button scene-preview__purpose-button--watch"
				:class="{ 'scene-preview__purpose-button--active': cameraViewState.mode === 'watching' }"
				prepend-icon="mdi-eye-outline"
				rounded="pill"
				variant="flat"
				:elevation="0"
				:ripple="false"
				:aria-pressed="cameraViewState.mode === 'watching'"
				title="Watch view"
				@click="handlePurposeWatchClick"
			>
				<span class="scene-preview__purpose-label">Watch</span>
			</v-btn>
			<v-btn
				class="scene-preview__purpose-button scene-preview__purpose-button--level"
				:class="{ 'scene-preview__purpose-button--active': cameraViewState.mode === 'level' }"
				prepend-icon="mdi-panorama-horizontal-outline"
				rounded="pill"
				variant="flat"
				:elevation="0"
				:ripple="false"
				:aria-pressed="cameraViewState.mode === 'level'"
				title="Reset to level"
				@click="handlePurposeResetClick"
			>
				<span class="scene-preview__purpose-label">Level</span>
			</v-btn>
		</div>
		<v-btn-group
			v-if="vehicleDrivePrompt.visible"
			class="scene-preview__drive-start-button"
			density="comfortable"
			divided
		>
			<v-btn
				v-if="vehicleDrivePrompt.showDrive"
				color="primary"
				variant="flat"
				size="large"
				prepend-icon="mdi-steering"
				:loading="vehicleDrivePrompt.busy"
				:disabled="vehicleDrivePrompt.busy"
				@click="handleVehicleDrivePromptConfirm"
			>
				Drive {{ vehicleDrivePrompt.label }}
			</v-btn>
			<v-btn
				v-if="vehicleDrivePrompt.showAutoTour"
				color="secondary"
				variant="flat"
				size="large"
				prepend-icon="mdi-map-marker-path"
				:loading="vehicleDrivePrompt.busy"
				:disabled="vehicleDrivePrompt.busy"
				@click="handleVehicleAutoTourStartClick"
			>
				自动巡游
			</v-btn>
			<v-btn
				v-if="vehicleDrivePrompt.showStopTour"
				color="warning"
				variant="flat"
				size="large"
				prepend-icon="mdi-stop-circle"
				:loading="vehicleDrivePrompt.busy"
				:disabled="vehicleDrivePrompt.busy"
				@click="handleVehicleAutoTourStopClick"
			>
				停止巡游 {{ vehicleDrivePrompt.label }}
			</v-btn>
			<v-btn
				v-if="vehicleDrivePrompt.showPauseTour"
				color="secondary"
				variant="flat"
				size="large"
				:prepend-icon="vehicleDrivePrompt.pauseTourIcon"
				:loading="vehicleDrivePrompt.busy"
				:disabled="vehicleDrivePrompt.busy"
				@click="handleVehicleAutoTourPauseToggleClick"
			>
				{{ vehicleDrivePrompt.pauseTourLabel }} {{ vehicleDrivePrompt.label }}
			</v-btn>
			<v-btn
				v-if="!vehicleDrivePrompt.showStopTour"
				color="" 
				variant="flat"
				size="large"
				:loading="false"
				@click="handleVehicleDrivePromptClose"
			>
				关闭
			</v-btn>
		</v-btn-group>
		<div
			v-if="vehicleDriveUi.visible"
			class="scene-preview__drive-panel"
		>
			<div class="scene-preview__drive-panel-inner">
				<div class="scene-preview__drive-heading">
					<v-icon icon="mdi-steering" size="18" />
					<div class="scene-preview__drive-heading-text">
						<span class="scene-preview__drive-heading-label">{{ vehicleDriveUi.label }}</span>
					</div>
					<v-btn
						v-if="vehicleDriveState.active"
						class="scene-preview__drive-camera-toggle"
						variant="text"
						size="small"
						color="secondary"
						:icon="vehicleDriveCameraToggleConfig.icon"
						:title="vehicleDriveCameraToggleConfig.label"
						:aria-label="vehicleDriveCameraToggleConfig.label"
						@click="handleVehicleDriveCameraToggle"
					/>
					<v-btn
						class="scene-preview__drive-exit"
						icon="mdi-exit-run"
						variant="text"
						size="small"
						color="secondary"
						:loading="vehicleDriveExitBusy"
						:disabled="vehicleDriveExitBusy"
						@click="handleVehicleDriveExitClick"
					/>
				</div>
				<div class="scene-preview__drive-controls">
					<div class="scene-preview__steering-column">
						<div class="scene-preview__speed-display" aria-live="polite">
							<span class="scene-preview__speed-display-value">{{ vehicleSpeedKmh }}</span>
							<span class="scene-preview__speed-display-unit">km/h</span>
						</div>
						<div
							ref="steeringWheelRef"
							class="scene-preview__steering-wheel"
							:style="vehicleSteeringWheelStyle"
							role="slider"
							aria-label="Steering wheel"
							aria-valuemin="-135"
							aria-valuemax="135"
							:aria-valuenow="Math.round(vehicleDriveInput.steering * 135)"
							@pointerdown.prevent="handleSteeringWheelPointerDown"
							@pointermove.prevent="handleSteeringWheelPointerMove"
							@pointerup.prevent="handleSteeringWheelPointerUp"
							@pointercancel.prevent="handleSteeringWheelPointerUp"
						>
							<div class="scene-preview__steering-wheel-spokes"></div>
							<div class="scene-preview__steering-wheel-hub">
								<span>{{ vehicleSteeringAngleLabel }}</span>
							</div>
						</div>
					</div>
					<div class="scene-preview__pedal-row">
						<v-btn
							class="scene-preview__pedal-button"
							:class="{ 'scene-preview__pedal-button--active': vehicleDriveUi.forwardActive }"
							variant="tonal"
							color="primary"
							size="small"
							icon="mdi-arrow-up-bold"
							title="Forward (W)"
							aria-label="Forward"
							@click.prevent
							@pointerdown.prevent="handleVehicleDriveControlPointer('forward', true, $event)"
							@pointerup.prevent="handleVehicleDriveControlPointer('forward', false, $event)"
							@pointerleave="handleVehicleDriveControlPointer('forward', false)"
							@pointercancel="handleVehicleDriveControlPointer('forward', false)"
						/>
						<v-btn
							class="scene-preview__pedal-button"
							:class="{ 'scene-preview__pedal-button--active': vehicleDriveUi.backwardActive }"
							variant="tonal"
							color="secondary"
							size="small"
							icon="mdi-arrow-down-bold"
							title="Reverse (S)"
							aria-label="Reverse"
							@click.prevent
							@pointerdown.prevent="handleVehicleDriveControlPointer('backward', true, $event)"
							@pointerup.prevent="handleVehicleDriveControlPointer('backward', false, $event)"
							@pointerleave="handleVehicleDriveControlPointer('backward', false)"
							@pointercancel="handleVehicleDriveControlPointer('backward', false)"
						/>
						<v-btn
							class="scene-preview__pedal-button"
							:class="{ 'scene-preview__pedal-button--active': vehicleDriveUi.brakeActive }"
							variant="tonal"
							color="error"
							size="small"
							icon="mdi-car-brake-alert"
							title="Brake (Space)"
							aria-label="Brake"
							@click.prevent
							@pointerdown.prevent="handleVehicleDriveControlPointer('brake', true, $event)"
							@pointerup.prevent="handleVehicleDriveControlPointer('brake', false, $event)"
							@pointerleave="handleVehicleDriveControlPointer('brake', false)"
							@pointercancel="handleVehicleDriveControlPointer('brake', false)"
						/>
						<v-btn
							class="scene-preview__pedal-button scene-preview__pedal-button--reset"
							variant="tonal"
							color="info"
							size="small"
							icon="mdi-backup-restore"
							title="Reset vehicle"
							aria-label="Reset vehicle"
							@click="handleVehicleDriveResetClick"
						/>
					</div>
				</div>
			</div>
		</div>
		<v-sheet class="scene-preview__control-bar" elevation="10">
			<div class="scene-preview__controls">
				<v-btn
					class="scene-preview__control-button"
					:icon="isPlaying ? 'mdi-pause' : 'mdi-play'"
					variant="tonal"
					color="primary"
					size="small"
					:aria-label="isPlaying ? 'Pause animation' : 'Play animation'"
					:title="isPlaying ? 'Pause animation' : 'Play animation'"
					@click="togglePlayback"
				/>
				<v-btn-toggle
					class="scene-preview__control-mode"
					v-model="controlMode"
					mandatory
					density="compact"
					:disabled="vehicleDriveUi.cameraLocked"

					rounded
				>
					<v-btn
						value="first-person"
						icon="mdi-human-greeting"
						size="small"
						:aria-label="'First-person view'"
						:title="'First-person view (Hotkey 1)'"
					/>
					<v-btn
						value="third-person"
						icon="mdi-compass"
						size="small"

						:aria-label="'Third-person view'"
						:title="'Third-person view (Hotkey 3)'"
					/>
				</v-btn-toggle>
				<v-menu
					v-model="isVolumeMenuOpen"
					location="top"

					offset="12"
					:close-on-content-click="false"
				>
					<template #activator="{ props: menuProps }">
						<v-btn
							class="scene-preview__control-button"

							v-bind="menuProps"
							icon="mdi-volume-medium"
							variant="tonal"
							color="secondary"
							size="small"
							:aria-label="`Adjust volume (${volumePercent}%)`"
							:title="`Adjust volume (${volumePercent}%)`"
						/>
					</template>
					<v-card class="scene-preview__volume-menu" elevation="8">
						<v-slider
							v-model="volumePercent"
							class="scene-preview__volume-slider"
							:max="100"
							:min="0"
							:step="5"
							direction="vertical"
							hide-details
						/>
					</v-card>
				</v-menu>
				<v-btn
					class="scene-preview__control-button"
					icon="mdi-camera"
					variant="tonal"
					color="secondary"
					size="small"
					:aria-label="'Screenshot (Hotkey P)'"
					:title="'Screenshot (Hotkey P)'"
					@click="captureScreenshot"
				/>
				<v-btn
					class="scene-preview__control-button"
					:icon="isFullscreen ? 'mdi-fullscreen-exit' : 'mdi-fullscreen'"
					variant="tonal"
					color="secondary"
					size="small"
					:aria-label="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
					:title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
					@click="toggleFullscreen"
				/>
			</div>
		</v-sheet>
		<div
			v-if="behaviorAlertVisible"
			class="scene-preview__behavior-overlay"
		>
			<div class="scene-preview__behavior-dialog">
				<h3
					v-if="behaviorAlertTitle"
					class="scene-preview__behavior-title"
				>
					{{ behaviorAlertTitle }}
				</h3>
				<p
					v-if="behaviorAlertMessage"
					class="scene-preview__behavior-message"
				>
					{{ behaviorAlertMessage }}
				</p>
				<div class="scene-preview__behavior-actions">
					<v-btn
						v-if="behaviorAlertShowCancel"
						class="scene-preview__behavior-button"
						variant="tonal"
						color="secondary"
						size="small"
						@click="cancelBehaviorAlert"
					>
						{{ behaviorAlertCancelText }}
					</v-btn>
					<v-btn
						v-if="behaviorAlertShowConfirm"
						class="scene-preview__behavior-button"
						variant="flat"
						color="primary"
						size="small"
						@click="confirmBehaviorAlert"
					>
						{{ behaviorAlertConfirmText }}
					</v-btn>
				</div>
			</div>
		</div>
		<div
			v-if="lanternOverlayVisible && lanternCurrentSlide"
			class="scene-preview__lantern-overlay"
			@click.self="cancelLanternOverlay"
		>
			<div class="scene-preview__lantern-dialog">
				<div class="scene-preview__lantern-header">
					<span class="scene-preview__lantern-progress">
						Slide {{ lanternActiveSlideIndex + 1 }} / {{ lanternTotalSlides }}
					</span>
					<v-btn
						icon="mdi-close"
						size="small"
						variant="text"
						class="scene-preview__lantern-close"
						@click="cancelLanternOverlay"
					/>
				</div>
				<div
					class="scene-preview__lantern-body"
					:class="[`layout-${lanternCurrentSlide.layout}`]"
				>
					<div
						v-if="lanternCurrentSlideImage"
						class="scene-preview__lantern-image"
						v-viewer="lanternViewerOptions"
						ref="lanternViewerRoot"
					>
						<img
							:src="lanternCurrentSlideImage"
							:alt="lanternCurrentSlide?.title || 'Lantern slide image'"
							class="scene-preview__lantern-image-content"
							@click="openLanternImageFullscreen"
							@load="handleLanternImageLoad"
						/>
					</div>
					<div class="scene-preview__lantern-text">
						<h3 v-if="lanternCurrentSlide.title" class="scene-preview__lantern-title">
							{{ lanternCurrentSlide.title }}
						</h3>
						<p
							v-if="lanternCurrentSlideTextState && lanternCurrentSlideTextState.error"
							class="scene-preview__lantern-description scene-preview__lantern-description--error"
						>
							{{ lanternCurrentSlideTextState.error }}
						</p>
						<p
							v-else-if="lanternCurrentSlideTextState && lanternCurrentSlideTextState.loading"
							class="scene-preview__lantern-description scene-preview__lantern-description--loading"
						>
							Loading description...
						</p>
						<p
							v-else-if="lanternCurrentSlideDescription"
							class="scene-preview__lantern-description"
						>
							{{ lanternCurrentSlideDescription }}
						</p>
						<div
							v-if="!lanternCurrentSlideImage && lanternCurrentSlide.imageAssetId"
							class="scene-preview__lantern-image-hint"
						>
							Image asset: {{ lanternCurrentSlide.imageAssetId }}
						</div>
					</div>
				</div>
				<div
					v-if="lanternHasMultipleSlides"
					class="scene-preview__lantern-navigation"
				>
					<v-btn
						variant="tonal"
						size="small"
						prepend-icon="mdi-chevron-left"
						:disabled="lanternActiveSlideIndex === 0"
						@click="showPreviousLanternSlide"
					>
						Previous
					</v-btn>
					<v-btn
						variant="tonal"
						size="small"
						append-icon="mdi-chevron-right"
						:disabled="lanternActiveSlideIndex >= lanternTotalSlides - 1"
						@click="showNextLanternSlide"
					>
						Next
					</v-btn>
				</div>
				<div class="scene-preview__lantern-actions">
					<v-btn
						variant="text"
						size="small"
						color="secondary"
						@click="cancelLanternOverlay"
					>
						Cancel
					</v-btn>
					<v-btn
						variant="flat"
						size="small"
						color="primary"
						@click="confirmLanternOverlay"
					>
						Continue
					</v-btn>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.scene-preview {
	position: relative;
	width: 100%;
	height: 100%;
	min-height: 100vh;
	overflow: hidden;
	background: linear-gradient(135deg, #0a0a10, #121220);
}

.scene-preview__live-disabled {
	position: absolute;
	top: 16px;
	right: 16px;
	z-index: 2300;
	max-width: min(560px, calc(100% - 32px));
	pointer-events: auto;
}

.scene-preview__live-disabled-content {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.scene-preview__live-disabled-text {
	font-size: 0.85rem;
}

.scene-preview__canvas,
.scene-preview__canvas :deep(canvas) {
	width: 100%;
	height: 100%;
	display: block;
}

.scene-preview__stats {
	position: absolute;
	top: 16px;
	left: 16px;
	display: flex;
	flex-direction: column;
	gap: 8px;
	z-index: 2200;
	pointer-events: none;
}

.scene-preview__instanced-culling-label {
	position: absolute;
	top: 16px;
	right: 16px;
	z-index: 2200;
	pointer-events: none;
}

.scene-preview__stats :deep(.scene-preview__stats-panel) {
	display: inline-block;
}

.scene-preview__stats :deep(.scene-preview__stats-panel canvas) {
	box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
	background: rgba(18, 20, 34, 0.92);
	border-radius: 6px;
}

.scene-preview__stats-fallback {
	padding: 6px 10px;
	border-radius: 8px;
	background: rgba(18, 20, 34, 0.92);
	box-shadow: 0 8px 22px rgba(0, 0, 0, 0.3);
	color: #f0f4ff;
	font-size: 0.78rem;
	font-family: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
}

.scene-preview__debug-overlay {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.scene-preview__preload-overlay {
	position: absolute;
	inset: 0;
	z-index: 2350;
	pointer-events: none;
}

.scene-preview__transition-flash {
	position: absolute;
	inset: 0;
	background: rgba(255, 255, 255, 0.28);
	opacity: 0;
	transition: opacity 160ms ease;
	pointer-events: none;
	z-index: 0;
}

.scene-preview__transition-flash--active {
	opacity: 1;
	pointer-events: auto;
}

.scene-preview__preload-card-wrap {
	position: absolute;
	top: 80px;
	left: 50%;
	transform: translateX(-50%);
	pointer-events: none;
	z-index: 1;
}

.scene-preview__preload-card {
	min-width: 240px;
	padding: 12px 16px;
	display: flex;
	flex-direction: column;
	gap: 12px;
	background: rgba(18, 18, 32, 0.92);
	box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
	border-radius: 12px;
	pointer-events: auto;
}

.scene-preview__preload-title {
	font-size: 0.95rem;
	font-weight: 600;
	text-align: center;
	color: #f5f7ff;
}

.scene-preview__progress {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.scene-preview__progress-bar {
	position: relative;
	width: 100%;
	height: 10px;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.12);
	overflow: hidden;
}

.scene-preview__progress-bar-fill {
	position: absolute;
	top: 0;
	left: 0;
	height: 100%;
	width: var(--progress, 0%);
	background: linear-gradient(90deg, #4facfe, #00f2fe, #4facfe);
	background-size: 200% 100%;
	animation: scene-preview-progress-shimmer 1.5s linear infinite;
	transition: width 0.3s ease;
	box-shadow: 0 0 12px rgba(79, 172, 254, 0.45);
}

@keyframes scene-preview-progress-shimmer {
	0% {
		background-position: 0% 0;
	}
	100% {
		background-position: 200% 0;
	}
}

@keyframes scene-preview-purpose-flow {
	0% {
		background-position: 0% 50%;
	}
	50% {
		background-position: 100% 50%;
	}
	100% {
		background-position: 0% 50%;
	}
}

@keyframes scene-preview-purpose-shine {
	0% {
		background-position: 50% 130%;
	}
	50% {
		background-position: 50% -10%;
	}
	100% {
		background-position: 50% 130%;
	}
}

.scene-preview__progress-stats {
	display: flex;
	justify-content: space-between;
	align-items: center;
	font-size: 0.8rem;
	color: rgba(245, 247, 255, 0.8);
}

.scene-preview__progress-percent {
	font-weight: 700;
	color: #5ac8ff;
}

.scene-preview__progress-bytes {
	font-family: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
}

.scene-preview__resource-list {
	display: flex;
	flex-direction: column;
	gap: 10px;
	max-height: 220px;
	overflow-y: auto;
	padding-right: 4px;
}

.scene-preview__resource-item {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 8px 10px;
	background: rgba(255, 255, 255, 0.06);
	border-radius: 10px;
	backdrop-filter: blur(6px);
}

.scene-preview__resource-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	font-size: 0.78rem;
	color: rgba(245, 247, 255, 0.85);
}

.scene-preview__resource-name {
	flex: 1 1 auto;
	margin-right: 8px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.scene-preview__resource-bytes {
	font-family: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
	font-size: 0.72rem;
	color: rgba(245, 247, 255, 0.65);
}

.scene-preview__resource-value {
	font-family: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
	font-size: 0.75rem;
	color: #5ac8ff;
}

.scene-preview__resource-progress-bar {
	height: 8px;
}

.scene-preview__progress-bar-fill--complete {
	animation: none;
	background: linear-gradient(90deg, #43e97b, #38f9d7);
	box-shadow: 0 0 12px rgba(67, 233, 123, 0.4);
}

.scene-preview__preload-label {
	font-size: 0.8rem;
	text-align: center;
	color: rgba(245, 247, 255, 0.75);
}

.scene-preview__update-banner {
	position: absolute;
	top: 16px;
	left: 50%;
	transform: translateX(-50%);
	pointer-events: none;
}

.scene-preview__update-chip {
	pointer-events: auto;
	background: rgba(18, 18, 32, 0.9);
	color: #f5f7ff;
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}

.scene-preview__mouse-hint {
	position: absolute;
	top: 64px;
	left: 50%;
	transform: translateX(-50%);
	pointer-events: none;
}

.scene-preview__mouse-hint :deep(.v-chip) {
	pointer-events: auto;
}

.scene-preview__alert {
	position: absolute;
	top: 16px;
	right: 16px;
	max-width: 320px;
	background: rgba(255, 183, 77, 0.1);
	backdrop-filter: blur(10px);
}

.scene-preview__purpose-controls {
	position: absolute;
	left: 24px;
	bottom: 24px;
	display: flex;
	flex-wrap: wrap;
	gap: 16px;
	z-index: 1900;
	pointer-events: auto;
}


.scene-preview__purpose-button {
	--purpose-accent-start: #4c6fff;
	--purpose-accent-mid: #20d4ff;
	--purpose-accent-end: #63ffd6;
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 0 28px;
	height: 56px;
	min-width: 156px;
	border-radius: 999px;
	box-sizing: border-box;
	z-index: 0;
	color: #f9fbff !important;
	background: linear-gradient(135deg, var(--purpose-accent-start), var(--purpose-accent-mid), var(--purpose-accent-end));
	background-size: 240% 240%;
	box-shadow: 0 16px 35px rgba(24, 196, 255, 0.25);
	animation: scene-preview-purpose-flow 7s ease infinite;
	transition: transform 0.3s ease, box-shadow 0.3s ease, filter 0.3s ease;
	letter-spacing: 0.04em;
	text-transform: none;
	font-weight: 600;
	filter: saturate(0.95);
	overflow: visible;
}

.scene-preview__purpose-button::before {
	content: '';
	position: absolute;
	top: 50%;
	left: 50%;
	width: calc(100% + 42px);
	height: calc(100% + 42px);
	border-radius: inherit;
	background: linear-gradient(135deg, var(--purpose-accent-start), var(--purpose-accent-mid), var(--purpose-accent-end));
	transform: translate(-50%, -50%);
	filter: blur(38px);
	opacity: 0.55;
	transition: opacity 0.35s ease, filter 0.35s ease;
	pointer-events: none;
	z-index: -2;
}

.scene-preview__purpose-button::after {
	content: '';
	position: absolute;
	inset: 2px;
	border-radius: inherit;
	border: 1px solid rgba(255, 255, 255, 0.24);
	box-shadow: inset 0 0 18px rgba(255, 255, 255, 0.12);
	opacity: 0.7;
	background-size: 140% 220%;
	background-position: 50% 130%;
	transition: opacity 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease;
	pointer-events: none;
	z-index: -1;
}

.scene-preview__purpose-button:hover {
	transform: translateY(-3px) scale(1.02);
	box-shadow: 0 22px 44px rgba(24, 196, 255, 0.4);
	filter: saturate(1.05);
}

.scene-preview__purpose-button:hover::before {
	opacity: 0.82;
	filter: blur(48px);
}

.scene-preview__purpose-button:hover::after {
	opacity: 0.92;
	border-color: rgba(255, 255, 255, 0.4);
	box-shadow: inset 0 0 22px rgba(255, 255, 255, 0.18);
}

.scene-preview__purpose-button:focus-visible {
	outline: none;
	box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.35), 0 20px 46px rgba(24, 196, 255, 0.45);
	filter: saturate(1.1);
}

.scene-preview__purpose-button:focus-visible::before {
	opacity: 0.9;
	filter: blur(56px);
}

.scene-preview__purpose-button:focus-visible::after {
	opacity: 0.96;
	border-color: rgba(255, 255, 255, 0.55);
	box-shadow: inset 0 0 26px rgba(255, 255, 255, 0.2);
}

.scene-preview__purpose-button:active {
	transform: translateY(0) scale(0.99);
}

.scene-preview__purpose-button--active {
	filter: saturate(1.12) brightness(1.03);
	box-shadow: 0 26px 58px rgba(86, 210, 255, 0.55);
	animation-duration: 4s;
}

.scene-preview__purpose-button--active::before {
	opacity: 0.95;
	filter: blur(60px);
}

.scene-preview__purpose-button--active::after {
	opacity: 1;
	border-color: rgba(255, 255, 255, 0.68);
	box-shadow: inset 0 0 28px rgba(255, 255, 255, 0.22);
	animation-duration: 3.2s;
}

.scene-preview__purpose-button--watch {
	--purpose-accent-start: #455bff;
	--purpose-accent-mid: #24c6ff;
	--purpose-accent-end: #6ffff2;
}

.scene-preview__purpose-button--level {
	--purpose-accent-start: #ff7b54;
	--purpose-accent-mid: #ffb26b;
	--purpose-accent-end: #ffd56f;
}

.scene-preview__purpose-button :deep(.v-btn__content) {
	position: relative;
	z-index: 1;
	gap: 10px;
	font-weight: 600;
	font-size: 1.05rem;
	text-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
}

.scene-preview__drive-panel {
	position: absolute;
	left: 20px;
	bottom: 20px;
	z-index: 2150;
	width: 240px;
	pointer-events: none;
}

.scene-preview__drive-start-button {
	position: absolute;
	left: 24px;
	bottom: 220px;
	z-index: 2150;
	font-weight: 600;
	letter-spacing: 0.04em;
}

.scene-preview__drive-panel-inner {
	padding: 12px 14px;
	border-radius: 18px;
	background: rgba(6, 10, 18, 0.52);
	border: 1px solid rgba(255, 255, 255, 0.1);
	box-shadow: 0 18px 38px rgba(4, 6, 12, 0.5);
	backdrop-filter: blur(16px);
	color: #f5f7ff;
	pointer-events: auto;
}

.scene-preview__drive-heading {
	display: flex;
	align-items: center;
	gap: 10px;
}

.scene-preview__drive-heading-text {
	flex: 1 1 auto;
	min-width: 0;
	display: flex;
	flex-direction: column;
}

.scene-preview__drive-heading-label {
	font-size: 0.9rem;
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.scene-preview__drive-heading-hint {
	font-size: 0.68rem;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: rgba(245, 247, 255, 0.55);
}

.scene-preview__drive-camera-toggle {
	min-width: 0;
}

.scene-preview__drive-camera-toggle :deep(.v-btn__overlay) {
	opacity: 0;
}

.scene-preview__drive-exit {
	min-width: 0;
	text-transform: none;
	font-weight: 600;
	letter-spacing: 0.04em;
}

.scene-preview__drive-exit :deep(.v-btn__content) {
	gap: 4px;
}

.scene-preview__drive-controls {
	margin-top: 12px;
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.scene-preview__steering-column {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 10px;
}

.scene-preview__speed-display {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
	color: #f5f7ff;
	text-align: center;
}

.scene-preview__speed-display-value {
	font-size: 1.4rem;
	font-weight: 600;
	color: #9fd6ff;
}

.scene-preview__speed-display-unit {
	font-size: 0.75rem;
	letter-spacing: 0.12em;
	opacity: 0.8;
}

.scene-preview__steering-wheel {
	position: relative;
	width: 120px;
	height: 120px;
	border-radius: 50%;
	background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.08), rgba(7, 10, 18, 0.95));
	border: 1px solid rgba(255, 255, 255, 0.12);
	box-shadow:
		inset 0 12px 30px rgba(0, 0, 0, 0.45),
		0 12px 22px rgba(0, 0, 0, 0.4);
	transform: rotate(var(--steering-rotation, 0deg));
	transition: transform 120ms ease;
	cursor: grab;
}

.scene-preview__steering-wheel:active {
	cursor: grabbing;
}

.scene-preview__steering-wheel::after {
	content: '';
	position: absolute;
	inset: 6px;
	border-radius: 50%;
	border: 1px dashed rgba(255, 255, 255, 0.18);
}

.scene-preview__steering-wheel-spokes {
	position: absolute;
	inset: 22px;
	border-radius: 50%;
	border: 1px solid rgba(255, 255, 255, 0.15);
	box-shadow: inset 0 0 20px rgba(255, 255, 255, 0.05);
}

.scene-preview__steering-wheel-hub {
	position: absolute;
	left: 50%;
	top: 50%;
	width: 54px;
	height: 54px;
	border-radius: 50%;
	background: rgba(15, 20, 32, 0.92);
	border: 1px solid rgba(255, 255, 255, 0.12);
	transform: translate(-50%, -50%);
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 0.8rem;
	font-weight: 600;
}

.scene-preview__steering-wheel-hub span {
	color: #9fd6ff;
	display: inline-block;
	transform: rotate(calc(-1 * var(--steering-rotation, 0deg)));
}

.scene-preview__pedal-row {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 8px;
}

.scene-preview__pedal-button {
	min-height: 38px;
	border-radius: 50%;
	aspect-ratio: 1 / 1;
	box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
}

.scene-preview__pedal-button--active {
	box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.35), 0 8px 14px rgba(0, 0, 0, 0.35);
}

.scene-preview__pedal-button--reset {
	background: rgba(63, 201, 255, 0.2) !important;
	box-shadow: inset 0 0 0 1px rgba(63, 201, 255, 0.35);
}


.scene-preview__purpose-button :deep(.v-icon) {
	font-size: 22px;
}

.scene-preview__purpose-button :deep(.v-btn__overlay),
.scene-preview__purpose-button :deep(.v-btn__underlay) {
	opacity: 0;
}

.scene-preview__purpose-label {
	position: relative;
	z-index: 1;
}

@media (max-width: 720px) {
	.scene-preview__purpose-controls {
		flex-direction: column;
		align-items: flex-start;
		gap: 12px;
		left: 16px;
		bottom: 16px;
	}

	.scene-preview__purpose-button {
		min-width: 0;
		width: 180px;
	}
}

.scene-preview__control-bar {
	position: absolute;
	bottom: 24px;
	right: 24px;
	padding: 12px;
	border-radius: 16px;
	background: rgba(18, 18, 32, 0.82);
	color: #f5f7ff;
	backdrop-filter: blur(14px);
	pointer-events: auto;
}

.scene-preview__debug-menu {
	position: absolute;
	top: 16px;
	right: 16px;
	z-index: 1200;
	pointer-events: auto;
}

.scene-preview__debug-menu-card {
	background: rgba(18, 18, 32, 0.94);
	color: #f5f7ff;
	min-width: 220px;
}

.scene-preview__debug-list {
	padding: 8px 6px;
}

.scene-preview__debug-checkbox {
	margin: 0;
}

.scene-preview__controls {
	display: flex;
	align-items: center;
	gap: 10px;
}

.scene-preview__control-button {
	flex: 0 0 auto;
}

.scene-preview__control-mode {
	flex: 0 0 auto;
}

.scene-preview__volume-menu {
	padding: 12px 18px;
	border-radius: 12px;
	background: rgba(18, 18, 32, 0.92);
	color: #f5f7ff;
}

.scene-preview__volume-slider {
	height: 160px;
}

/* Behavior overlay floats above the preview canvas */
.scene-preview__behavior-overlay {
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(0, 0, 0, 0.35);
	z-index: 2000; /* above control bar, alerts, etc. */
	pointer-events: auto;
}

.scene-preview__behavior-dialog {
	min-width: 260px;
	max-width: 80vw;
	padding: 16px 18px;
	border-radius: 12px;
	box-shadow: 0 12px 40px rgba(0,0,0,0.45);
	background: rgba(18, 18, 32, 0.96);
	backdrop-filter: blur(10px);
	color: #f5f7ff;
	text-align: center;
	z-index: 2100;
}

.scene-preview__behavior-title {
	margin: 0 0 8px;
	font-size: 16px;
	font-weight: 600;
}

.scene-preview__behavior-message {
	margin: 0 0 12px;
	font-size: 14px;
	opacity: 0.9;
}

.scene-preview__behavior-actions {
	display: flex;
	justify-content: center;
	gap: 10px;
	margin-top: 12px;
}

.scene-preview__behavior-button {
	flex: 0 0 auto;
}

.scene-preview__lantern-overlay {
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(0, 0, 0, 0.45);
	z-index: 2200;
	pointer-events: auto;
	padding: clamp(16px, 4vw, 32px);
}

.scene-preview__lantern-dialog {
	max-width: min(720px, 90vw);
	width: 100%;
	padding: 20px;
	border-radius: 16px;
	background: rgba(14, 18, 28, 0.95);
	box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
	color: #f5f7ff;
	display: flex;
	flex-direction: column;
	gap: 16px;
	backdrop-filter: blur(12px);
	max-height: calc(100vh - clamp(48px, 10vw, 96px));
	overflow: auto;
}

.scene-preview__lantern-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
}

.scene-preview__lantern-progress {
	font-size: 0.78rem;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: rgba(233, 236, 241, 0.7);
}

.scene-preview__lantern-close {
	color: rgba(233, 236, 241, 0.7);
}

.scene-preview__lantern-body {
	display: grid;
	gap: 18px;
	align-items: center;
}

.scene-preview__lantern-body.layout-imageLeft,
.scene-preview__lantern-body.layout-imageRight {
	align-items: start;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
}

.scene-preview__lantern-body.layout-imageRight {
	direction: rtl;
}

.scene-preview__lantern-body.layout-imageRight .scene-preview__lantern-text {
	direction: ltr;
}

.scene-preview__lantern-image {
	border-radius: 12px;
	overflow: hidden;
	background: rgba(255, 255, 255, 0.08);
	box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	max-height: min(65vh, 520px);
	margin: 0 auto;
}

.scene-preview__lantern-image img {
	display: block;
	width: auto;
	height: auto;
	max-width: 100%;
	max-height: 100%;
	object-fit: contain;
	margin: 0 auto;
}

.scene-preview__lantern-image-content {
	cursor: zoom-in;
}

.scene-preview__lantern-text {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.scene-preview__lantern-title {
	margin: 0;
	font-size: 1.2rem;
	font-weight: 600;
}

.scene-preview__lantern-description {
	margin: 0;
	font-size: 0.95rem;
	line-height: 1.5;
	color: rgba(233, 236, 241, 0.85);
}

.scene-preview__lantern-description--loading {
	color: rgba(233, 236, 241, 0.7);
	font-style: italic;
}

.scene-preview__lantern-description--error {
	color: #ff9e9e;
}

.scene-preview__lantern-image-hint {
	font-size: 0.78rem;
	color: rgba(233, 236, 241, 0.6);
	background: rgba(255, 255, 255, 0.06);
	padding: 6px 10px;
	border-radius: 8px;
}

.scene-preview__lantern-fullscreen {
	position: absolute;
	inset: 0;
	z-index: 2400;
	display: flex;
	align-items: center;
	justify-content: center;
	background: radial-gradient(circle at top, rgba(14, 18, 28, 0.96), rgba(4, 6, 12, 0.98));
	backdrop-filter: blur(10px);
	overflow: hidden;
}

.scene-preview__lantern-fullscreen-close {
	position: absolute;
	top: 24px;
	right: 24px;
	z-index: 1;
}

.scene-preview__lantern-fullscreen-stage {
	position: relative;
	width: 100%;
	height: 100%;
	display: flex;
	align-items: center;
	justify-content: center;
	overflow: hidden;
	touch-action: none;
	cursor: grab;
}

.scene-preview__lantern-fullscreen-stage:active {
	cursor: grabbing;
}

.scene-preview__lantern-fullscreen-image {
	display: block;
	max-width: none;
	max-height: none;
	will-change: transform;
	transition: transform 80ms ease-out;
	box-shadow: 0 28px 80px rgba(0, 0, 0, 0.5);
}

.scene-preview__lantern-navigation {
	display: flex;
	justify-content: space-between;
	gap: 12px;
}

.scene-preview__lantern-actions {
	display: flex;
	justify-content: flex-end;
	gap: 12px;
}

@media (max-width: 720px) {
	.scene-preview__lantern-body,
	.scene-preview__lantern-body.layout-imageLeft,
	.scene-preview__lantern-body.layout-imageRight {
		grid-template-columns: 1fr;
	}

	.scene-preview__lantern-dialog {
		padding: 16px;
	}

	.scene-preview__lantern-image {
		max-height: 50vh;
	}
}

@media (max-width: 768px) {
	.scene-preview__alert {
		left: 12px;
		right: 12px;
		max-width: none;
	}

	.scene-preview__control-bar {
		bottom: 16px;
		right: 16px;
		padding: 10px;
	}

	.scene-preview__controls {
		gap: 8px;
	}

	.scene-preview__volume-slider {
		height: 140px;
	}
}
</style>
