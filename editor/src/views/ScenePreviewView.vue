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
import {
	ENVIRONMENT_NODE_ID,
	type EnvironmentSettings,
	type LanternSlideDefinition,
	type SceneJsonExportDocument,
	type SceneNode,
	type GroundDynamicMesh,
	type SceneNodeComponentState,
	type SceneMaterialTextureRef,
	type SceneSkyboxSettings,
} from '@harmony/schema'
import {
	applyMaterialOverrides,
	disposeMaterialOverrides,
	type MaterialTextureAssignmentOptions,
} from '@schema/material'
import type { EnvironmentBackgroundMode } from '@/types/environment'
import type { ScenePreviewSnapshot } from '@/utils/previewChannel'
import { subscribeToScenePreview } from '@/utils/previewChannel'
import { buildSceneGraph, type SceneGraphBuildOptions } from '@schema/sceneGraph'
import ResourceCache from '@schema/ResourceCache'
import { AssetLoader, AssetCache } from '@schema/assetCache'
import type { AssetCacheEntry } from '@schema/assetCache'
import {
	buildGroundHeightfieldData,
	buildHeightfieldShapeFromGroundNode,
	isGroundDynamicMesh,
	type GroundHeightfieldData,
} from '@schema/groundHeightfield'
import { loadNodeObject } from '@schema/modelAssetLoader'
import {
	getCachedModelObject,
	getOrLoadModelObject,
	subscribeInstancedMeshes,
	ensureInstancedMeshesRegistered,
	allocateModelInstance,
	releaseModelInstance,
	updateModelInstanceMatrix,
	findNodeIdForInstance,
	type ModelInstanceGroup,
} from '@schema/modelObjectCache'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { ComponentManager } from '@schema/components/componentManager'
import {
	behaviorComponentDefinition,
	guideboardComponentDefinition,
	displayBoardComponentDefinition,
	wallComponentDefinition,
	viewPointComponentDefinition,
	warpGateComponentDefinition,
	effectComponentDefinition,
	rigidbodyComponentDefinition,
	vehicleComponentDefinition,
	GUIDEBOARD_COMPONENT_TYPE,
	GUIDEBOARD_RUNTIME_REGISTRY_KEY,
	GUIDEBOARD_EFFECT_ACTIVE_FLAG,
	WARP_GATE_RUNTIME_REGISTRY_KEY,
	WARP_GATE_EFFECT_ACTIVE_FLAG,
	RIGIDBODY_COMPONENT_TYPE,
	RIGIDBODY_METADATA_KEY,
	VEHICLE_COMPONENT_TYPE,
	clampGuideboardComponentProps,
	computeGuideboardEffectActive,
	clampVehicleComponentProps,
} from '@schema/components'
import type {
	GuideboardComponentProps,
	RigidbodyComponentMetadata,
	RigidbodyComponentProps,
	RigidbodyPhysicsShape,
	RigidbodyVector3Tuple,
	VehicleComponentProps,
	VehicleVector3Tuple,
	WarpGateComponentProps,
} from '@schema/components'
import {
	addBehaviorRuntimeListener,
	hasRegisteredBehaviors,
	listRegisteredBehaviorActions,
	listInteractableObjects,
	updateBehaviorVisibility,
	resetBehaviorRuntime,
	removeBehaviorRuntimeListener,
	triggerBehaviorAction,
	resolveBehaviorEvent,
	type BehaviorRuntimeEvent,
	type BehaviorEventResolution,
	type BehaviorRuntimeListener,
} from '@schema/behaviors/runtime'
import { PROXIMITY_EXIT_PADDING, DEFAULT_OBJECT_RADIUS, PROXIMITY_MIN_DISTANCE, PROXIMITY_RADIUS_SCALE } from '@schema/behaviors/runtime'
import type Viewer from 'viewerjs'
import type { ViewerOptions } from 'viewerjs'

type ControlMode = 'first-person' | 'third-person'
const containerRef = ref<HTMLDivElement | null>(null)
const statsContainerRef = ref<HTMLDivElement | null>(null)
const statusMessage = ref('等待场景数据...')
const isPlaying = ref(true)
const controlMode = ref<ControlMode>('third-person')
const volumePercent = ref(100)
const isFullscreen = ref(false)
const lastUpdateTime = ref<string | null>(null)
const warningMessages = ref<string[]>([])
const isRigidbodyDebugVisible = ref(true)

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
const isFirstPersonMouseControlEnabled = ref(true)
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
const RESOURCE_PROGRESS_COMPLETE_PATTERNS = ['下载完成', '加载完成'] as const

const assetCacheStore = useAssetCacheStore()
// Adapter so the preview uses the shared Pinia-backed cache without duplicating downloads.
class StoreBackedAssetCache extends AssetCache {
	constructor() {
		super()
	}
	async getEntry(assetId: string): Promise<AssetCacheEntry | undefined |null> {
		let storeEntry = assetCacheStore.entries[assetId]
		if (storeEntry !== undefined && storeEntry !== null) {
			return storeEntry
		}
		// fall back to parent cache (may return undefined)
		storeEntry = await super.getEntry(assetId) ?? undefined
		if (storeEntry === undefined) {
			await assetCacheStore.loadFromIndexedDb(assetId)
			storeEntry = assetCacheStore.getEntry(assetId)
		}
		return storeEntry
	}

	hasCache(assetId: string): boolean {
		return assetCacheStore.hasCache(assetId) || super.hasCache(assetId)
	}
	createFileFromCache(assetId: string): File | null {
		return assetCacheStore.createFileFromCache(assetId)
	}
}

const editorAssetCache = new StoreBackedAssetCache()
const editorAssetLoader = new AssetLoader(editorAssetCache)
let editorResourceCache: ResourceCache | null = null

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
		return `已加载 ${resourceProgress.loaded} / ${resourceProgress.total}`
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
	if (info.message) {
		const messageText = info.message
		if (RESOURCE_PROGRESS_COMPLETE_PATTERNS.some((pattern) => messageText.includes(pattern))) {
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
previewComponentManager.registerDefinition(wallComponentDefinition)
previewComponentManager.registerDefinition(guideboardComponentDefinition)
previewComponentManager.registerDefinition(displayBoardComponentDefinition)
previewComponentManager.registerDefinition(viewPointComponentDefinition)
previewComponentManager.registerDefinition(warpGateComponentDefinition)
previewComponentManager.registerDefinition(effectComponentDefinition)
previewComponentManager.registerDefinition(rigidbodyComponentDefinition)
previewComponentManager.registerDefinition(vehicleComponentDefinition)
previewComponentManager.registerDefinition(behaviorComponentDefinition)

const previewNodeMap = new Map<string, SceneNode>()
const previewParentMap = new Map<string, string | null>()

const behaviorRaycaster = new THREE.Raycaster()
const behaviorPointer = new THREE.Vector2()

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
})

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

const vehicleDriveCameraRestoreState = {
	hasSnapshot: false,
	position: new THREE.Vector3(),
	target: new THREE.Vector3(),
	quaternion: new THREE.Quaternion(),
	controlMode: controlMode.value as ControlMode,
	isCameraCaged: false,
}

const vehicleDriveCameraFollowState = {
	desiredPosition: new THREE.Vector3(),
	desiredTarget: new THREE.Vector3(),
	currentPosition: new THREE.Vector3(),
	currentTarget: new THREE.Vector3(),
}

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
const tempBox = new THREE.Box3()
const tempSphere = new THREE.Sphere()
const tempPosition = new THREE.Vector3()
const tempVehicleSize = new THREE.Vector3()
const tempCameraMatrix = new THREE.Matrix4()
const cameraViewFrustum = new THREE.Frustum()
const VEHICLE_ENGINE_FORCE = 2200
const VEHICLE_BRAKE_FORCE = 45
const VEHICLE_STEER_ANGLE = THREE.MathUtils.degToRad(32)
const VEHICLE_CAMERA_SMOOTH = 0.12
const VEHICLE_CAMERA_OFFSET = new THREE.Vector3(0, 3.5, -8)
const VEHICLE_CAMERA_LOOK_OFFSET = new THREE.Vector3(0, 1.5, 6)
const tempVehicleCameraOffset = new THREE.Vector3()
const tempVehicleCameraLook = new THREE.Vector3()
const tempVehicleQuaternionThree = new THREE.Quaternion()
const tempVehicleCameraPosition = new THREE.Vector3()
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
}
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const DEFAULT_ENVIRONMENT_BACKGROUND_COLOR = '#516175'
const DEFAULT_ENVIRONMENT_AMBIENT_COLOR = '#ffffff'
const DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY = 0.6
const DEFAULT_ENVIRONMENT_FOG_COLOR = '#516175'
const DEFAULT_ENVIRONMENT_FOG_DENSITY = 0.02
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
	environmentMap: {
		mode: 'skybox',
		hdriAssetId: null,
	},
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
let pendingSkyboxSettings: SceneSkyboxSettings | null = null
let environmentAmbientLight: THREE.AmbientLight | null = null
let backgroundTexture: THREE.Texture | null = null
let backgroundTextureCleanup: (() => void) | null = null
let backgroundAssetId: string | null = null
let backgroundLoadToken = 0
let environmentMapTarget: THREE.WebGLRenderTarget | null = null
let environmentMapAssetId: string | null = null
let environmentMapLoadToken = 0
let pendingEnvironmentSettings: EnvironmentSettings | null = null
let firstPersonControls: FirstPersonControls | null = null
let mapControls: MapControls | null = null
let animationFrameHandle = 0
let currentDocument: SceneJsonExportDocument | null = null
let unsubscribe: (() => void) | null = null
let isApplyingSnapshot = false
let queuedSnapshot: ScenePreviewSnapshot | null = null
let lastSnapshotRevision = 0

const clock = new THREE.Clock()
const instancedMeshGroup = new THREE.Group()
instancedMeshGroup.name = 'InstancedMeshes'
const instancedMeshes: THREE.InstancedMesh[] = []
let stopInstancedMeshSubscription: (() => void) | null = null
const instancedMatrixHelper = new THREE.Matrix4()
const instancedPositionHelper = new THREE.Vector3()
const instancedQuaternionHelper = new THREE.Quaternion()
const instancedScaleHelper = new THREE.Vector3()
const physicsPositionHelper = new THREE.Vector3()
const physicsQuaternionHelper = new THREE.Quaternion()
const physicsScaleHelper = new THREE.Vector3()
const rigidbodyDebugPositionHelper = new THREE.Vector3()
const rigidbodyDebugQuaternionHelper = new THREE.Quaternion()
const rigidbodyDebugScaleHelper = new THREE.Vector3()
const nodeObjectMap = new Map<string, THREE.Object3D>()
type RigidbodyInstance = { nodeId: string; body: CANNON.Body; object: THREE.Object3D | null }
let physicsWorld: CANNON.World | null = null
const rigidbodyInstances = new Map<string, RigidbodyInstance>()
type RigidbodyDebugHelper = { group: THREE.Group; signature: string }
const rigidbodyDebugHelpers = new Map<string, RigidbodyDebugHelper>()
let rigidbodyDebugGroup: THREE.Group | null = null
const rigidbodyDebugMaterial = new THREE.LineBasicMaterial({
	color: 0xffc107,
	transparent: true,
	opacity: 0.9,
})
rigidbodyDebugMaterial.depthTest = false
rigidbodyDebugMaterial.depthWrite = false
type VehicleInstance = {
	nodeId: string
	vehicle: CANNON.RaycastVehicle
	wheelCount: number
	steerableWheelIndices: number[]
}
const vehicleInstances = new Map<string, VehicleInstance>()
type GroundHeightfieldCacheEntry = { signature: string; shape: CANNON.Heightfield; offset: [number, number, number] }
const groundHeightfieldCache = new Map<string, GroundHeightfieldCacheEntry>()
const physicsGravity = new CANNON.Vec3(0, -9.82, 0)
const PHYSICS_FIXED_TIMESTEP = 1 / 60
const PHYSICS_MAX_SUB_STEPS = 5
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
	previewNodeMap.clear()
	previewParentMap.clear()
	if (!Array.isArray(nodes)) {
		return
	}
	const stack: Array<{ node: SceneNode; parentId: string | null }> = nodes.map((node) => ({
		node,
		parentId: null,
	}))
	while (stack.length) {
		const entry = stack.pop()
		if (!entry) {
			continue
		}
		const { node, parentId } = entry
		previewNodeMap.set(node.id, node)
		previewParentMap.set(node.id, parentId)
		if (Array.isArray(node.children) && node.children.length) {
			node.children.forEach((child) => {
				stack.push({ node: child, parentId: node.id })
			})
		}
	}
}

function resolveParentNodeId(nodeId: string): string | null {
	return previewParentMap.get(nodeId) ?? null
}

function resolveNodeById(nodeId: string): SceneNode | null {
	return previewNodeMap.get(nodeId) ?? null
}

const vehicleDriveUi = computed(() => {
	if (!vehicleDriveState.active) {
		return {
			visible: false,
			label: '',
			cameraLocked: false,
			forwardActive: false,
			backwardActive: false,
			leftActive: false,
			rightActive: false,
			brakeActive: false,
		}
	}
	const nodeId = vehicleDriveState.nodeId ?? ''
	const node = nodeId ? resolveNodeById(nodeId) : null
	const label = (node?.name?.trim() || nodeId || 'Vehicle')
	return {
		visible: true,
		label,
		cameraLocked: true,
		forwardActive: vehicleDriveInputFlags.forward,
		backwardActive: vehicleDriveInputFlags.backward,
		leftActive: vehicleDriveInputFlags.left,
		rightActive: vehicleDriveInputFlags.right,
		brakeActive: vehicleDriveInputFlags.brake,
	}
})

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
	const component = node?.components?.[RIGIDBODY_COMPONENT_TYPE] as
		SceneNodeComponentState<RigidbodyComponentProps> | undefined
	if (!component || !component.enabled) {
		return null
	}
	return component
}

function resolveVehicleComponent(
	node: SceneNode | null | undefined,
): SceneNodeComponentState<VehicleComponentProps> | null {
	const component = node?.components?.[VEHICLE_COMPONENT_TYPE] as
		SceneNodeComponentState<VehicleComponentProps> | undefined
	if (!component || !component.enabled) {
		return null
	}
	return component
}

function resolveNodeScaleVector(node: SceneNode | null | undefined): { x: number; y: number; z: number } {
	const scale = node?.scale
	const normalize = (value: unknown) => {
		if (typeof value === 'number' && Number.isFinite(value)) {
			return value
		}
		return 1
	}
	return {
		x: normalize(scale?.x),
		y: normalize(scale?.y),
		z: normalize(scale?.z),
	}
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

function attachInstancedMesh(mesh: THREE.InstancedMesh) {
	if (instancedMeshes.includes(mesh)) {
		return
	}
	instancedMeshes.push(mesh)
	instancedMeshGroup.add(mesh)
}

function clearInstancedMeshes() {
	instancedMeshes.splice(0, instancedMeshes.length).forEach((mesh) => {
		instancedMeshGroup.remove(mesh)
	})
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
	const fogMode = source?.fogMode === 'exp' ? 'exp' : 'none'

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
		environmentMap: {
			mode: environmentMapMode,
			hdriAssetId: normalizeAssetId(environmentMapSource?.hdriAssetId ?? null),
		},
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

function cloneSkyboxSettings(settings: SceneSkyboxSettings): SceneSkyboxSettings {
	return { ...settings }
}

function sanitizeSkyboxSettings(input: SceneSkyboxSettings): SceneSkyboxSettings {
	const ensureNumber = (candidate: unknown, fallback: number) => {
		return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback
	}
	return {
		presetId: input.presetId ?? DEFAULT_SKYBOX_SETTINGS.presetId,
		exposure: ensureNumber(input.exposure, DEFAULT_SKYBOX_SETTINGS.exposure),
		turbidity: ensureNumber(input.turbidity, DEFAULT_SKYBOX_SETTINGS.turbidity),
		rayleigh: ensureNumber(input.rayleigh, DEFAULT_SKYBOX_SETTINGS.rayleigh),
		mieCoefficient: ensureNumber(input.mieCoefficient, DEFAULT_SKYBOX_SETTINGS.mieCoefficient),
		mieDirectionalG: ensureNumber(input.mieDirectionalG, DEFAULT_SKYBOX_SETTINGS.mieDirectionalG),
		elevation: ensureNumber(input.elevation, DEFAULT_SKYBOX_SETTINGS.elevation),
		azimuth: ensureNumber(input.azimuth, DEFAULT_SKYBOX_SETTINGS.azimuth),
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
	if (entry.arrayBuffer && entry.arrayBuffer.byteLength) {
		const url = getOrCreateObjectUrl(assetId, entry.arrayBuffer, mimeType ?? undefined)
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

function inferMimeTypeFromAssetId(assetId: string): string | null {
	const lower = assetId.toLowerCase()
	if (lower.endsWith('.png')) {
		return 'image/png'
	}
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
		return 'image/jpeg'
	}
	if (lower.endsWith('.gif')) {
		return 'image/gif'
	}
	if (lower.endsWith('.webp')) {
		return 'image/webp'
	}
	if (lower.endsWith('.svg')) {
		return 'image/svg+xml'
	}
	if (lower.endsWith('.json')) {
		return 'application/json'
	}
	if (lower.endsWith('.txt')) {
		return 'text/plain'
	}
	return null
}

function getOrCreateObjectUrl(assetId: string, data: ArrayBuffer, mimeHint?: string): string {
	const cached = assetObjectUrlCache.get(assetId)
	if (cached) {
		return cached
	}
	const mimeType = mimeHint ?? inferMimeTypeFromAssetId(assetId) ?? 'application/octet-stream'
	const blob = new Blob([data], { type: mimeType })
	const url = URL.createObjectURL(blob)
	assetObjectUrlCache.set(assetId, url)
	return url
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

watch(isRigidbodyDebugVisible, (enabled) => {
	if (enabled) {
		ensureRigidbodyDebugGroup()
		syncRigidbodyDebugHelpers()
		updateRigidbodyDebugTransforms()
		return
	}
	disposeRigidbodyDebugHelpers()
})

watch(controlMode, (mode) => {
	applyControlMode(mode)
})

watch(isFirstPersonMouseControlEnabled, (enabled) => {
	if (enabled && controlMode.value === 'first-person' && firstPersonControls && !isCameraCaged.value) {
		resetFirstPersonPointerDelta()
		clampFirstPersonPitch(true)
		syncFirstPersonOrientation()
		syncLastFirstPersonStateFromCamera()
	}
	updateCameraControlActivation()
})

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
	const caged = isCameraCaged.value
	if (firstPersonControls) {
		const enableFirstPerson = controlMode.value === 'first-person' && !caged
		firstPersonControls.enabled = enableFirstPerson
		firstPersonControls.activeLook = enableFirstPerson && isFirstPersonMouseControlEnabled.value
	}
	if (mapControls) {
		mapControls.enabled = controlMode.value === 'third-person' && !caged
	}
	updateCanvasCursor()
}

function updateCanvasCursor() {
	const canvas = renderer?.domElement
	if (!canvas) {
		return
	}
	if (controlMode.value !== 'first-person') {
		const canOrbit = !isCameraCaged.value && Boolean(mapControls?.enabled)
		canvas.style.cursor = canOrbit ? 'grab' : 'default'
		return
	}
	const allowLook = isFirstPersonMouseControlEnabled.value && !isCameraCaged.value
	canvas.style.cursor = allowLook ? 'crosshair' : 'default'
}

function setFirstPersonMouseControl(enabled: boolean) {
	if (isFirstPersonMouseControlEnabled.value === enabled) {
		return
	}
	isFirstPersonMouseControlEnabled.value = enabled
	if (enabled && controlMode.value === 'first-person' && firstPersonControls && !isCameraCaged.value) {
		resetFirstPersonPointerDelta()
		clampFirstPersonPitch(true)
		syncFirstPersonOrientation()
		syncLastFirstPersonStateFromCamera()
	}
	updateCameraControlActivation()
}

function toggleFirstPersonMouseControl() {
	if (vehicleDriveState.active) {
		return
	}
	setFirstPersonMouseControl(!isFirstPersonMouseControlEnabled.value)
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
	if (!enabled && controlMode.value === 'first-person' && firstPersonControls && isFirstPersonMouseControlEnabled.value) {
		resetFirstPersonPointerDelta()
		clampFirstPersonPitch(true)
		syncFirstPersonOrientation()
		syncLastFirstPersonStateFromCamera()
	}
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
	if (entry.arrayBuffer && entry.arrayBuffer.byteLength) {
		try {
			return new TextDecoder().decode(entry.arrayBuffer)
		} catch (error) {
			console.warn('[ScenePreview] Failed to decode text asset buffer', error)
			return null
		}
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
		const distance = focusPoint.distanceTo(cameraPosition)
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

type DriveControlAction = keyof VehicleDriveControlFlags

function updateVehicleDriveInputFromFlags(): void {
	vehicleDriveInput.throttle = vehicleDriveInputFlags.forward === vehicleDriveInputFlags.backward
		? 0
		: vehicleDriveInputFlags.forward
			? 1
			: -1
	vehicleDriveInput.steering = vehicleDriveInputFlags.left === vehicleDriveInputFlags.right
		? 0
		: vehicleDriveInputFlags.left
			? 1
			: -1
	vehicleDriveInput.brake = vehicleDriveInputFlags.brake ? 1 : 0
}

function resetVehicleDriveInputs(): void {
	vehicleDriveInputFlags.forward = false
	vehicleDriveInputFlags.backward = false
	vehicleDriveInputFlags.left = false
	vehicleDriveInputFlags.right = false
	vehicleDriveInputFlags.brake = false
	updateVehicleDriveInputFromFlags()
}

function setVehicleDriveControlFlag(action: DriveControlAction, pressed: boolean): void {
	if (!vehicleDriveState.active) {
		return
	}
	if (vehicleDriveInputFlags[action] === pressed) {
		return
	}
	vehicleDriveInputFlags[action] = pressed
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

type VehicleDrivePreparationResult = { success: true; instance: VehicleInstance } | { success: false; message: string }

function prepareVehicleDriveTarget(nodeId: string): VehicleDrivePreparationResult {
	const node = resolveNodeById(nodeId)
	if (!node) {
		return { success: false, message: '车辆目标节点不存在。' }
	}
	const hasRigidbody = Boolean(resolveRigidbodyComponent(node))
	const hasVehicle = Boolean(resolveVehicleComponent(node))
	if (!hasRigidbody || !hasVehicle) {
		return { success: false, message: '车辆节点需要同时启用 Rigidbody 与 Vehicle 组件。' }
	}
	if (!physicsWorld) {
		ensurePhysicsWorld()
	}
	ensureVehicleBindingForNode(nodeId)
	const instance = vehicleInstances.get(nodeId)
	if (!instance) {
		return { success: false, message: '目标节点尚未准备好 RaycastVehicle 实例。' }
	}
	if (!rigidbodyInstances.has(nodeId)) {
		return { success: false, message: '车辆缺少可驱动的刚体。' }
	}
	const object = nodeObjectMap.get(nodeId)
	if (!object) {
		return { success: false, message: '车辆对象尚未出现在场景中。' }
	}
	return { success: true, instance }
}

function snapshotVehicleDriveCameraState(): void {
	const activeCamera = camera
	if (!activeCamera) {
		vehicleDriveCameraRestoreState.hasSnapshot = false
		return
	}
	vehicleDriveCameraRestoreState.position.copy(activeCamera.position)
	vehicleDriveCameraRestoreState.quaternion.copy(activeCamera.quaternion)
	vehicleDriveCameraRestoreState.controlMode = controlMode.value
	vehicleDriveCameraRestoreState.isCameraCaged = isCameraCaged.value
	if (mapControls) {
		vehicleDriveCameraRestoreState.target.copy(mapControls.target)
	} else {
		activeCamera.getWorldDirection(tempDirection)
		vehicleDriveCameraRestoreState.target.copy(activeCamera.position).add(tempDirection)
	}
	vehicleDriveCameraFollowState.currentPosition.copy(activeCamera.position)
	vehicleDriveCameraFollowState.currentTarget.copy(vehicleDriveCameraRestoreState.target)
	vehicleDriveCameraFollowState.desiredPosition.copy(activeCamera.position)
	vehicleDriveCameraFollowState.desiredTarget.copy(vehicleDriveCameraRestoreState.target)
	vehicleDriveCameraRestoreState.hasSnapshot = true
}

function restoreVehicleDriveCameraState(): void {
	const activeCamera = camera
	if (!activeCamera) {
		vehicleDriveCameraRestoreState.hasSnapshot = false
		setCameraCaging(false, { force: true })
		return
	}
	if (vehicleDriveCameraRestoreState.hasSnapshot) {
		activeCamera.position.copy(vehicleDriveCameraRestoreState.position)
		activeCamera.quaternion.copy(vehicleDriveCameraRestoreState.quaternion)
		activeCamera.updateMatrixWorld(true)
		if (mapControls) {
			mapControls.target.copy(vehicleDriveCameraRestoreState.target)
			mapControls.update()
		}
		controlMode.value = vehicleDriveCameraRestoreState.controlMode
		setCameraCaging(vehicleDriveCameraRestoreState.isCameraCaged, { force: true })
	}
	vehicleDriveCameraFollowState.currentPosition.copy(activeCamera.position)
	vehicleDriveCameraFollowState.currentTarget.copy(vehicleDriveCameraRestoreState.target)
	vehicleDriveCameraRestoreState.hasSnapshot = false
}

function syncVehicleDriveCameraImmediate(): void {
	updateVehicleDriveCamera(0, { immediate: true })
}

function startVehicleDriveMode(
	event: Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }>,
): { success: boolean; message?: string } {
	const targetNodeId = event.targetNodeId ?? event.nodeId ?? null
	if (!targetNodeId) {
		return { success: false, message: '未提供要驾驶的节点。' }
	}
	if (vehicleDriveState.active) {
		stopVehicleDriveMode({ resolution: { type: 'abort', message: '驾驶状态已被新的脚本替换。' } })
	}
	const readiness = prepareVehicleDriveTarget(targetNodeId)
	if (!readiness.success) {
		return readiness
	}
	snapshotVehicleDriveCameraState()
	vehicleDriveState.active = true
	vehicleDriveState.nodeId = targetNodeId
	vehicleDriveState.vehicle = readiness.instance.vehicle
	vehicleDriveState.steerableWheelIndices = [...readiness.instance.steerableWheelIndices]
	vehicleDriveState.wheelCount = readiness.instance.wheelCount
	vehicleDriveState.token = event.token
	resetVehicleDriveInputs()
	activeCameraLookTween = null
	controlMode.value = 'third-person'
	setCameraCaging(true, { force: true })
	syncVehicleDriveCameraImmediate()
	return { success: true }
}

function stopVehicleDriveMode(options: { resolution?: BehaviorEventResolution } = {}): void {
	if (!vehicleDriveState.active) {
		return
	}
	const token = vehicleDriveState.token
	const vehicle = vehicleDriveState.vehicle
	if (vehicle) {
		try {
			for (let index = 0; index < vehicle.wheelInfos.length; index += 1) {
				vehicle.applyEngineForce(0, index)
				vehicle.setBrake(VEHICLE_BRAKE_FORCE, index)
				vehicle.setSteeringValue(0, index)
			}
		} catch (error) {
			console.warn('[ScenePreview] Failed to reset vehicle state', error)
		}
	}
	resetVehicleDriveInputs()
	vehicleDriveState.active = false
	vehicleDriveState.nodeId = null
	vehicleDriveState.vehicle = null
	vehicleDriveState.token = null
	vehicleDriveState.steerableWheelIndices = []
	vehicleDriveState.wheelCount = 0
	restoreVehicleDriveCameraState()
	if (token) {
		resolveBehaviorToken(token, options.resolution ?? { type: 'continue' })
	}
}

function ensureActiveVehicleDriveBinding(): VehicleInstance | null {
	if (!vehicleDriveState.active) {
		return null
	}
	const nodeId = vehicleDriveState.nodeId
	if (!nodeId) {
		stopVehicleDriveMode({ resolution: { type: 'abort', message: '目标节点缺失，驾驶已终止。' } })
		return null
	}
	const instance = vehicleInstances.get(nodeId)
	if (!instance || vehicleDriveState.vehicle !== instance.vehicle) {
		stopVehicleDriveMode({ resolution: { type: 'abort', message: '车辆实例已重建，驾驶已终止。' } })
		return null
	}
	const object = nodeObjectMap.get(nodeId)
	if (!object) {
		stopVehicleDriveMode({ resolution: { type: 'abort', message: '车辆对象不存在。' } })
		return null
	}
	return instance
}

function applyVehicleDriveForces(): void {
	if (!vehicleDriveState.active || !vehicleDriveState.vehicle) {
		return
	}
	const instance = ensureActiveVehicleDriveBinding()
	if (!instance) {
		return
	}
	const vehicle = instance.vehicle
	const engineForce = -vehicleDriveInput.throttle * VEHICLE_ENGINE_FORCE
	const steeringValue = vehicleDriveInput.steering * VEHICLE_STEER_ANGLE
	const brakeForce = vehicleDriveInput.brake * VEHICLE_BRAKE_FORCE
	for (let index = 0; index < vehicle.wheelInfos.length; index += 1) {
		vehicle.applyEngineForce(engineForce, index)
		const steerable = instance.steerableWheelIndices.includes(index)
		vehicle.setSteeringValue(steerable ? steeringValue : 0, index)
		vehicle.setBrake(brakeForce, index)
	}
}

function updateVehicleDriveCamera(delta: number, options: { immediate?: boolean } = {}): void {
	if (!vehicleDriveState.active) {
		return
	}
	const activeCamera = camera
	if (!activeCamera) {
		return
	}
	const nodeId = vehicleDriveState.nodeId
	if (!nodeId) {
		return
	}
	const object = nodeObjectMap.get(nodeId)
	if (!object) {
		stopVehicleDriveMode({ resolution: { type: 'abort', message: '车辆节点已被移除。' } })
		return
	}
	object.updateMatrixWorld(true)
	object.getWorldPosition(tempVehicleCameraPosition)
	object.getWorldQuaternion(tempVehicleQuaternionThree)
	tempVehicleCameraOffset.copy(VEHICLE_CAMERA_OFFSET).applyQuaternion(tempVehicleQuaternionThree)
	tempVehicleCameraLook.copy(VEHICLE_CAMERA_LOOK_OFFSET).applyQuaternion(tempVehicleQuaternionThree)
	vehicleDriveCameraFollowState.desiredPosition.copy(tempVehicleCameraPosition).add(tempVehicleCameraOffset)
	vehicleDriveCameraFollowState.desiredTarget.copy(tempVehicleCameraPosition).add(tempVehicleCameraLook)
	const alpha = options.immediate ? 1 : THREE.MathUtils.clamp(delta / VEHICLE_CAMERA_SMOOTH, 0, 1)
	vehicleDriveCameraFollowState.currentPosition.lerp(vehicleDriveCameraFollowState.desiredPosition, alpha)
	vehicleDriveCameraFollowState.currentTarget.lerp(vehicleDriveCameraFollowState.desiredTarget, alpha)
	activeCamera.position.copy(vehicleDriveCameraFollowState.currentPosition)
	activeCamera.lookAt(vehicleDriveCameraFollowState.currentTarget)
	if (mapControls) {
		mapControls.target.copy(vehicleDriveCameraFollowState.currentTarget)
		mapControls.update()
	}
	syncLastFirstPersonStateFromCamera()
}

function handleVehicleDriveEvent(event: Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }>): void {
	const result = startVehicleDriveMode(event)
	if (!result.success) {
		appendWarningMessage(result.message ?? '无法启动驾驶脚本。')
		resolveBehaviorToken(event.token, {
			type: 'fail',
			message: result.message ?? '无法启动驾驶脚本。',
		})
	}
}

function handleVehicleDebusEvent(): void {
	if (!vehicleDriveState.active) {
		return
	}
	stopVehicleDriveMode({ resolution: { type: 'continue' } })
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
		case 'sequence-complete':
			clearBehaviorAlert()
			resetLanternOverlay()
			if (event.status === 'failure' || event.status === 'aborted') {
				console.warn('[ScenePreview] Behavior sequence ended', event)
			} else {
				console.info('[ScenePreview] Behavior sequence completed', event)
			}
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

function handleBehaviorClick(event: MouseEvent) {
	const currentRenderer = renderer
	const activeCamera = camera
	if (!currentRenderer || !activeCamera || !scene) {
		return
	}
	if (event.button !== 0) {
		return
	}
	if (event.target !== currentRenderer.domElement) {
		return
	}
	if (!hasRegisteredBehaviors()) {
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
	const candidates = listInteractableObjects()
	if (!candidates.length) {
		return
	}
	const intersections = behaviorRaycaster.intersectObjects(candidates, true)
	if (!intersections.length) {
		return
	}
	let nodeId: string | null = null
	let hitObject: THREE.Object3D | null = null
	let hitPoint: THREE.Vector3 | null = null
	for (const intersection of intersections) {
		const resolvedId = resolveNodeIdFromIntersection(intersection)
		if (resolvedId) {
			nodeId = resolvedId
			hitObject = nodeObjectMap.get(resolvedId) ?? intersection.object
			hitPoint = intersection.point.clone()
			break
		}
	}
	if (!nodeId || !hitObject || !hitPoint) {
		return
	}
	const results = triggerBehaviorAction(nodeId, 'click', {
		pointerEvent: event,
		intersection: {
			object: hitObject,
			point: { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z },
		},
	})
	processBehaviorEvents(results)
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
		memoryFallbackLabel.value = '内存监控不可用'
		return
	}
	const perfWithMemory = performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }
	const memory = perfWithMemory.memory
	if (!memory) {
		memoryFallbackLabel.value = '内存监控不可用'
		return
	}
	const used = formatByteSize(memory.usedJSHeapSize)
	const limit = formatByteSize(memory.jsHeapSizeLimit)
	const nextLabel = `内存：${used} / ${limit}`
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

	applySunDirectionToSunLight()

	ensureSkyExists()
	if (pendingSkyboxSettings) {
		applySkyboxSettings(pendingSkyboxSettings)
	}
	if (pendingEnvironmentSettings) {
		void applyEnvironmentSettingsToScene(pendingEnvironmentSettings)
	}

	initControls()
	updateCanvasCursor()
	renderer.domElement.addEventListener('click', handleBehaviorClick)
	handleResize()

	window.addEventListener('resize', handleResize)
	document.addEventListener('fullscreenchange', handleFullscreenChange)
	window.addEventListener('keydown', handleKeyDown)
	window.addEventListener('keyup', handleKeyUp)

	startAnimationLoop()
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
	mapControls.minDistance = 1
	mapControls.maxDistance = 200
	mapControls.target.copy(lastOrbitState.target)
	mapControls.addEventListener('start', () => {
		activeCameraLookTween = null
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
	if (event.repeat) {
		return
	}
	const driveLocked = vehicleDriveState.active
	switch (event.code) {
		case 'Digit1':
			if (driveLocked) {
				break
			}
			controlMode.value = 'first-person'
			break
		case 'Digit3':
			if (driveLocked) {
				break
			}
			controlMode.value = 'third-person'
			break
		case 'KeyP':
			event.preventDefault()
			captureScreenshot()
			break
		case 'KeyC':
			if (driveLocked) {
				break
			}
			if (controlMode.value === 'first-person') {
				event.preventDefault()
				toggleFirstPersonMouseControl()
				// When toggling with C, reset to a level view for a consistent starting orientation
				resetCameraToLevelView()
			}
			break
		default:
			break
	}
}

function handleKeyUp(event: KeyboardEvent) {
	if (isInputLikeElement(event.target)) {
		return
	}
	if (event.code === 'KeyQ') {
		rotationState.q = false
	} else if (event.code === 'KeyE') {
		rotationState.e = false
	}
}

function startAnimationLoop() {
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
		if (controlMode.value === 'first-person' && firstPersonControls) {
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
		} else if (mapControls) {
			updateOrbitCameraLookTween(delta)
			mapControls.update()
			lastOrbitState.position.copy(activeCamera.position)
			lastOrbitState.target.copy(mapControls.target)
		}

		if (isPlaying.value) {
			animationMixers.forEach((mixer) => mixer.update(delta))
			effectRuntimeTickers.forEach((tick) => {
				try {
					tick(delta)
				} catch (error) {
					console.warn('[ScenePreview] Failed to advance effect runtime', error)
				}
			})
			applyVehicleDriveForces()
			stepPhysicsWorld(delta)
		}

		updateVehicleDriveCamera(delta)
		updateBehaviorProximity()
		updateLazyPlaceholders(delta)
		updateRigidbodyDebugTransforms()

		currentRenderer.render(currentScene, activeCamera)
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
	nodeObjectMap.forEach((_object, nodeId) => {
		releaseModelInstance(nodeId)
	})
	nodeObjectMap.clear()
	if (vehicleDriveState.active) {
		stopVehicleDriveMode({ resolution: { type: 'abort', message: '场景已重置，驾驶结束。' } })
	}
	resetPhysicsWorld()
	if (!options.preservePreviewNodeMap) {
		previewNodeMap.clear()
	}
	previewComponentManager.reset()
	resetBehaviorRuntime()
	resetBehaviorProximity()
	resetAnimationControllers()
	disposeRigidbodyDebugHelpers()
	hidePurposeControls()
	activeCameraLookTween = null
	setCameraCaging(false)
	dismissBehaviorAlert()
	resetLanternOverlay()
	resetAssetResolutionCaches()
	lazyPlaceholderStates.clear()
	activeLazyLoadCount = 0
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
		pendingSkyboxSettings = settings ? cloneSkyboxSettings(settings) : null
		return
	}
	if (!settings) {
		disposeSkyEnvironment()
		scene.environment = null
		renderer.toneMappingExposure = DEFAULT_SKYBOX_SETTINGS.exposure
		pendingSkyboxSettings = null
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
	pendingSkyboxSettings = null
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
	const density = Math.max(0, settings.fogDensity)
	if (scene.fog instanceof THREE.FogExp2) {
		scene.fog.color.copy(fogColor)
		scene.fog.density = density
	} else {
		scene.fog = new THREE.FogExp2(fogColor, density)
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

function disposeEnvironmentResources() {
	disposeBackgroundResources()
	disposeEnvironmentTarget()
	backgroundLoadToken += 1
	environmentMapLoadToken += 1
	pendingEnvironmentSettings = null
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

type MeshStandardTextureKey =
	| 'map'
	| 'normalMap'
	| 'metalnessMap'
	| 'roughnessMap'
	| 'aoMap'
	| 'emissiveMap'
	| 'displacementMap'

const STANDARD_TEXTURE_KEYS: MeshStandardTextureKey[] = [
	'map',
	'normalMap',
	'metalnessMap',
	'roughnessMap',
	'aoMap',
	'emissiveMap',
	'displacementMap',
]

function disposeMaterialTextures(material: THREE.Material | null | undefined) {
	if (!material) {
		return
	}
	disposeMaterialOverrides(material)
	const standard = material as THREE.MeshStandardMaterial &
		Partial<Record<MeshStandardTextureKey, THREE.Texture | null>>
	const materialRecord = standard as unknown as Record<string, unknown>
	STANDARD_TEXTURE_KEYS.forEach((key) => {
		const texture = standard[key]
		if (texture && typeof texture.dispose === 'function') {
			texture.dispose()
		}
		if (key in standard) {
			materialRecord[key] = null
		}
	})
}

function disposeObjectResources(object: THREE.Object3D) {
	const mesh = object as THREE.Mesh
	if ((mesh as any).isMesh) {
		mesh.geometry?.dispose?.()
		const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
		materials.forEach((material) => {
			if (!material) {
				return
			}
			disposeMaterialTextures(material)
			material.dispose?.()
		})
		const groundTexture = (mesh.userData?.groundTexture as THREE.Texture | undefined) ?? null
		if (groundTexture) {
			groundTexture.dispose?.()
			delete mesh.userData.groundTexture
		}
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
			previewNodeMap.delete(id)
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
			const instancedAssetId = child.userData?.instancedAssetId as string | undefined
			if (instancedAssetId) {
				ensureInstancedMeshesRegistered(instancedAssetId)
				syncInstancedTransform(child)
			}
			const nodeState = resolveNodeById(nodeId)
			const initialVisibility = resolveGuideboardInitialVisibility(nodeState)
			if (initialVisibility !== null) {
				child.visible = initialVisibility
				updateBehaviorVisibility(nodeId, child.visible)
				syncInstancedTransform(child)
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
	if (!object?.userData?.instancedAssetId) {
		return
	}
	const nodeId = object.userData.nodeId as string | undefined
	if (!nodeId) {
		return
	}
	object.updateMatrixWorld(true)
				removeVehicleInstance(nodeId)
	object.matrixWorld.decompose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper)
	const isVisible = object.visible !== false
	if (!isVisible) {
		instancedScaleHelper.setScalar(0)
	}
	instancedMatrixHelper.compose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper)
	updateModelInstanceMatrix(nodeId, instancedMatrixHelper)
}

function ensurePhysicsWorld(): CANNON.World {
	if (physicsWorld) {
		return physicsWorld
	}
	const world = new CANNON.World()
	world.gravity.copy(physicsGravity)
	physicsWorld = world
	return world
}

function resetPhysicsWorld(): void {
	if (vehicleDriveState.active) {
		stopVehicleDriveMode({ resolution: { type: 'abort', message: '物理环境已重置。' } })
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
		rigidbodyInstances.forEach(({ body }) => {
			try {
				world.removeBody(body)
			} catch (error) {
				console.warn('[ScenePreview] Failed to remove rigidbody', error)
			}
		})
	}
	vehicleInstances.clear()
	rigidbodyInstances.clear()
	clearRigidbodyDebugHelpers()
	physicsWorld = null
	groundHeightfieldCache.clear()
}

function resolveGroundHeightfieldShape(
	node: SceneNode,
	definition: GroundDynamicMesh,
): GroundHeightfieldCacheEntry | null {
	const nodeId = node.id
	const data: GroundHeightfieldData | null = buildGroundHeightfieldData(node, definition)
	if (!data) {
		groundHeightfieldCache.delete(nodeId)
		return null
	}
	const cached = groundHeightfieldCache.get(nodeId)
	if (cached && cached.signature === data.signature) {
		return cached
	}
	const shape = new CANNON.Heightfield(data.matrix, { elementSize: data.elementSize })
	const entry: GroundHeightfieldCacheEntry = {
		signature: data.signature,
		shape,
		offset: data.offset,
	}
	groundHeightfieldCache.set(nodeId, entry)
	return entry
}

function normalizeHeightfieldMatrix(source: unknown): number[][] | null {
	if (!Array.isArray(source) || source.length < 2) {
		return null
	}
	let maxRows = 0
	const normalizedColumns = source.map((column) => {
		if (!Array.isArray(column)) {
			return []
		}
		const normalized = column.map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0))
		if (normalized.length > maxRows) {
			maxRows = normalized.length
		}
		return normalized
	})
	if (normalizedColumns.length < 2 || maxRows < 2) {
		return null
	}
	const paddedColumns = normalizedColumns.map((column) => {
		if (column.length === maxRows) {
			return column
		}
		const padValue = column.length ? column[column.length - 1]! : 0
		while (column.length < maxRows) {
			column.push(padValue)
		}
		return column
	})
	return paddedColumns as number[][]
}

function createCannonShape(definition: RigidbodyPhysicsShape): CANNON.Shape | null {
	if (definition.kind === 'box') {
		const [x, y, z] = definition.halfExtents
		if (![x, y, z].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
			return null
		}
		return new CANNON.Box(new CANNON.Vec3(x, y, z))
	}
	if (definition.kind === 'convex') {
		const vertices = (definition.vertices ?? []).map(([vx, vy, vz]) => new CANNON.Vec3(vx, vy, vz))
		const faces = (definition.faces ?? []).map((face) => face.slice())
		if (!vertices.length || !faces.length) {
			return null
		}
		return new CANNON.ConvexPolyhedron({ vertices, faces })
	}
	if (definition.kind === 'heightfield') {
		const matrix = normalizeHeightfieldMatrix(definition.matrix)
		const elementSize = typeof definition.elementSize === 'number' && Number.isFinite(definition.elementSize)
			? definition.elementSize
			: null
		if (!matrix || !elementSize || elementSize <= 0) {
			return null
		}
		return new CANNON.Heightfield(matrix, { elementSize })
	}
	return null
}

function mapBodyType(type: RigidbodyComponentProps['bodyType']): CANNON.Body['type'] {
	switch (type) {
		case 'STATIC':
			return CANNON.Body.STATIC
		case 'KINEMATIC':
			return CANNON.Body.KINEMATIC
		case 'DYNAMIC':
	default:
			return CANNON.Body.DYNAMIC
	}
}

function syncBodyFromObject(body: CANNON.Body, object: THREE.Object3D): void {
	object.updateMatrixWorld(true)
	object.matrixWorld.decompose(physicsPositionHelper, physicsQuaternionHelper, physicsScaleHelper)
	body.position.set(physicsPositionHelper.x, physicsPositionHelper.y, physicsPositionHelper.z)
	body.quaternion.set(
		physicsQuaternionHelper.x,
		physicsQuaternionHelper.y,
		physicsQuaternionHelper.z,
		physicsQuaternionHelper.w,
	)
	body.velocity.set(0, 0, 0)
	body.angularVelocity.set(0, 0, 0)
}

function syncObjectFromBody(entry: RigidbodyInstance): void {
	const { object, body } = entry
	if (!object) {
		return
	}
	object.position.set(body.position.x, body.position.y, body.position.z)
	object.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w)
	object.updateMatrixWorld()
	syncInstancedTransform(object)
}

function createRigidbodyBody(
	node: SceneNode,
	component: SceneNodeComponentState<RigidbodyComponentProps>,
	shapeDefinition: RigidbodyPhysicsShape | null,
	object: THREE.Object3D,
): CANNON.Body | null {
	let offsetTuple: RigidbodyVector3Tuple | null = null
	let resolvedShape: CANNON.Shape | null = null
	if (isGroundDynamicMesh(node.dynamicMesh)) {
		const groundEntry = resolveGroundHeightfieldShape(node, node.dynamicMesh)
		if (groundEntry) {
			resolvedShape = groundEntry.shape
			offsetTuple = groundEntry.offset
		}
	}
	if (!resolvedShape && shapeDefinition) {
		resolvedShape = createCannonShape(shapeDefinition)
		offsetTuple = shapeDefinition.offset ?? null
	}
	if (!resolvedShape) {
		return null
	}
	const props = component.props as RigidbodyComponentProps
	const isDynamic = props.bodyType === 'DYNAMIC'
	const mass = isDynamic ? Math.max(0, props.mass ?? 0) : 0
	const body = new CANNON.Body({ mass })
	body.type = mapBodyType(props.bodyType)
	if (offsetTuple) {
		const [ox, oy, oz] = offsetTuple
		body.addShape(resolvedShape, new CANNON.Vec3(ox ?? 0, oy ?? 0, oz ?? 0))
	} else {
		body.addShape(resolvedShape)
	}
	syncBodyFromObject(body, object)
	body.updateMassProperties()
	body.linearDamping = 0.04
	body.angularDamping = 0.04
	return body
}

function removeRigidbodyInstance(nodeId: string): void {
	const entry = rigidbodyInstances.get(nodeId)
	if (!entry) {
		return
	}
	try {
		physicsWorld?.removeBody(entry.body)
	} catch (error) {
		console.warn('[ScenePreview] Failed to remove rigidbody instance', error)
	}
	rigidbodyInstances.delete(nodeId)
	groundHeightfieldCache.delete(nodeId)
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

function tupleToVec3(tuple: VehicleVector3Tuple): CANNON.Vec3 {
	const [x = 0, y = 0, z = 0] = tuple
	return new CANNON.Vec3(x, y, z)
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

function buildConvexDebugLines(shape: Extract<RigidbodyPhysicsShape, { kind: 'convex' }>): THREE.LineSegments | null {
	const vertices = Array.isArray(shape.vertices) ? shape.vertices : []
	const faces = Array.isArray(shape.faces) ? shape.faces : []
	if (!vertices.length || !faces.length) {
		return null
	}
	const positions = new Float32Array(vertices.length * 3)
	vertices.forEach(([vx = 0, vy = 0, vz = 0], index) => {
		const offset = index * 3
		positions[offset] = vx
		positions[offset + 1] = vy
		positions[offset + 2] = vz
	})
	const indices: number[] = []
	faces.forEach((face) => {
		if (!Array.isArray(face) || face.length < 3) {
			return
		}
		for (let i = 1; i < face.length - 1; i += 1) {
			indices.push(face[0], face[i], face[i + 1])
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
	const stepZ = rowCount > 1 ? depth / (rowCount - 1) : depth
	const originX = -width * 0.5
	const originZ = -depth * 0.5
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

function buildRigidbodyDebugLineSegments(shape: RigidbodyPhysicsShape): THREE.LineSegments | null {
	if (shape.kind === 'box') {
		return buildBoxDebugLines(shape)
	}
	if (shape.kind === 'convex') {
		return buildConvexDebugLines(shape)
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

function ensureRigidbodyDebugHelperForShape(nodeId: string, shape: RigidbodyPhysicsShape): void {
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
	const [ox = 0, oy = 0, oz = 0] = shape.offset ?? [0, 0, 0]
	lineSegments.position.set(ox, oy, oz)
	helperGroup.add(lineSegments)
	helperGroup.visible = false
	container.add(helperGroup)
	rigidbodyDebugHelpers.set(nodeId, { group: helperGroup, signature })
}

function refreshRigidbodyDebugHelper(nodeId: string): void {
	if (!isRigidbodyDebugVisible.value) {
		return
	}
	const node = resolveNodeById(nodeId)
	const component = resolveRigidbodyComponent(node)
	let shapeDefinition = extractRigidbodyShape(component)
	if (!shapeDefinition && node && isGroundDynamicMesh(node.dynamicMesh)) {
		shapeDefinition = buildHeightfieldShapeFromGroundNode(node)
	}
	if (!shapeDefinition) {
		removeRigidbodyDebugHelper(nodeId)
		return
	}
	ensureRigidbodyDebugHelperForShape(nodeId, shapeDefinition)
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
	const rigidbody = rigidbodyInstances.get(nodeId)
	let visible = true
	if (rigidbody) {
		helper.group.position.set(rigidbody.body.position.x, rigidbody.body.position.y, rigidbody.body.position.z)
		helper.group.quaternion.set(
			rigidbody.body.quaternion.x,
			rigidbody.body.quaternion.y,
			rigidbody.body.quaternion.z,
			rigidbody.body.quaternion.w,
		)
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
	helper.group.visible = visible
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

function buildVehicleConnectionPoint(
	rightAxis: number,
	forwardAxis: number,
	upAxis: number,
	rightValue: number,
	forwardValue: number,
	upValue: number,
): CANNON.Vec3 {
	const components: [number, number, number] = [0, 0, 0]
	components[rightAxis] = rightValue
	components[forwardAxis] = forwardValue
	components[upAxis] = upValue
	return new CANNON.Vec3(components[0], components[1], components[2])
}

function computeVehicleWheelConnectionPoints(
	object: THREE.Object3D,
	props: VehicleComponentProps,
	rightAxis: number,
	forwardAxis: number,
	upAxis: number,
): CANNON.Vec3[] {
	tempBox.makeEmpty()
	tempBox.setFromObject(object)
	if (tempBox.isEmpty()) {
		tempVehicleSize.set(2, 1, 4)
	} else {
		tempBox.getSize(tempVehicleSize)
	}
	const rightExtent = Math.max(tempVehicleSize.getComponent(rightAxis) * 0.5, props.radius * 1.25)
	const forwardExtent = Math.max(tempVehicleSize.getComponent(forwardAxis) * 0.5, props.radius * 2)
	const upExtent = Math.max(tempVehicleSize.getComponent(upAxis) * 0.5, props.radius + props.suspensionRestLength)
	const footprints = [
		{ right: rightExtent, forward: forwardExtent },
		{ right: -rightExtent, forward: forwardExtent },
		{ right: rightExtent, forward: -forwardExtent },
		{ right: -rightExtent, forward: -forwardExtent },
	]
	return footprints.map(({ right, forward }) =>
		buildVehicleConnectionPoint(rightAxis, forwardAxis, upAxis, right, forward, upExtent),
	)
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
	const connectionPoints = computeVehicleWheelConnectionPoints(
		rigidbody.object,
		props,
		rightAxis,
		forwardAxis,
		upAxis,
	)
	if (!connectionPoints.length) {
		return null
	}
	const wheelCount = connectionPoints.length
	const steerableWheelIndices = wheelCount >= 2 ? [0, 1] : connectionPoints.map((_point, index) => index)
	const vehicle = new CANNON.RaycastVehicle({
		chassisBody: rigidbody.body,
		indexRightAxis: rightAxis,
		indexUpAxis: upAxis,
		indexForwardAxis: forwardAxis,
	})
	const directionVec = tupleToVec3(props.directionLocal)
	const axleVec = tupleToVec3(props.axleLocal)
	connectionPoints.forEach((point) => {
		vehicle.addWheel({
			chassisConnectionPointLocal: point,
			directionLocal: directionVec.clone(),
			axleLocal: axleVec.clone(),
			suspensionRestLength: props.suspensionRestLength,
			suspensionStiffness: props.suspensionStiffness,
			dampingRelaxation: props.suspensionDamping,
			dampingCompression: props.suspensionCompression,
			frictionSlip: props.frictionSlip,
			rollInfluence: props.rollInfluence,
			radius: props.radius,
		})
	})
	vehicle.addToWorld(physicsWorld)
	return { nodeId: node.id, vehicle, wheelCount, steerableWheelIndices }
}

function removeVehicleInstance(nodeId: string): void {
	const entry = vehicleInstances.get(nodeId)
	if (!entry) {
		return
	}
	if (vehicleDriveState.active && vehicleDriveState.nodeId === nodeId) {
		stopVehicleDriveMode({ resolution: { type: 'abort', message: '车辆实例已被移除。' } })
	}
	if (physicsWorld) {
		try {
			entry.vehicle.removeFromWorld(physicsWorld)
		} catch (error) {
			console.warn('[ScenePreview] Failed to remove vehicle instance', error)
		}
	}
	vehicleInstances.delete(nodeId)
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

function syncVehicleInstancesForDocument(document: SceneJsonExportDocument | null): void {
	if (!document) {
		vehicleInstances.forEach((_entry, nodeId) => removeVehicleInstance(nodeId))
		vehicleInstances.clear()
		return
	}
	const vehicleNodes = collectVehicleNodes(document.nodes)
	const desiredIds = new Set(vehicleNodes.map((node) => node.id))
	vehicleNodes.forEach((node) => ensureVehicleBindingForNode(node.id))
	vehicleInstances.forEach((_entry, nodeId) => {
		if (!desiredIds.has(nodeId)) {
			removeVehicleInstance(nodeId)
		}
	})
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
	if (!shapeDefinition && requiresMetadata) {
		return
	}
	const existing = rigidbodyInstances.get(nodeId)
	if (existing) {
		existing.object = object
		syncBodyFromObject(existing.body, object)
		ensureVehicleBindingForNode(nodeId)
		refreshRigidbodyDebugHelper(nodeId)
		return
	}
	const body = createRigidbodyBody(node, component, shapeDefinition, object)
	if (!body) {
		return
	}
	physicsWorld.addBody(body)
	rigidbodyInstances.set(nodeId, { nodeId, body, object })
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

function syncPhysicsBodiesForDocument(document: SceneJsonExportDocument | null): void {
	if (!document) {
		resetPhysicsWorld()
		return
	}
	const rigidbodyNodes = collectRigidbodyNodes(document.nodes)
	if (!rigidbodyNodes.length) {
		resetPhysicsWorld()
		return
	}
	const world = ensurePhysicsWorld()
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
		if (!shapeDefinition && requiresMetadata) {
			return
		}
		const existing = rigidbodyInstances.get(node.id)
		if (existing) {
			world.removeBody(existing.body)
			rigidbodyInstances.delete(node.id)
		}
		const body = createRigidbodyBody(node, component, shapeDefinition, object)
		if (!body) {
			return
		}
		world.addBody(body)
		rigidbodyInstances.set(node.id, { nodeId: node.id, body, object })
		refreshRigidbodyDebugHelper(node.id)
	})
	rigidbodyInstances.forEach((entry, nodeId) => {
		if (!desiredIds.has(nodeId)) {
			world.removeBody(entry.body)
			rigidbodyInstances.delete(nodeId)
			removeRigidbodyDebugHelper(nodeId)
		}
	})
	groundHeightfieldCache.forEach((_entry, nodeId) => {
		if (!desiredIds.has(nodeId)) {
			groundHeightfieldCache.delete(nodeId)
		}
	})
	syncVehicleInstancesForDocument(document)
}

function stepPhysicsWorld(delta: number): void {
	if (!physicsWorld || !rigidbodyInstances.size) {
		return
	}
	physicsWorld.step(PHYSICS_FIXED_TIMESTEP, delta, PHYSICS_MAX_SUB_STEPS)
	rigidbodyInstances.forEach((entry) => syncObjectFromBody(entry))
}

function updateNodeTransfrom(object: THREE.Object3D, node: SceneNode) {
	if (node.position) {
		object.position.set(node.position.x, node.position.y, node.position.z)
	}
	if (node.rotation) {
		object.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z)
	}
	if (node.scale) {
		object.scale.set(node.scale.x, node.scale.y, node.scale.z)
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
	} else if (node.editorFlags?.editorOnly) {
		object.visible = false
	} else if (typeof node.visible === 'boolean') {
		object.visible = node.visible
	} else {
		object.visible = true
	}
	updateNodeTransfrom(object, node)
	updateBehaviorVisibility(node.id, object.visible)
	applyMaterialOverrides(object, node.materials, materialOverrideOptions)
	syncInstancedTransform(object)
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

async function updateScene(document: SceneJsonExportDocument) {
	resetAssetResolutionCaches()
	refreshResourceAssetInfo(document)
	const skyboxSettings = resolveDocumentSkybox(document)
	applySkyboxSettings(skyboxSettings)
	const environmentSettings = resolveDocumentEnvironment(document)
	lazyLoadMeshesEnabled = document.lazyLoadMeshes !== false
	deferredInstancingNodeIds.clear()
	if (!scene || !rootGroup) {
		pendingEnvironmentSettings = cloneEnvironmentSettingsLocal(environmentSettings)
		return
	}
	const previewRoot = rootGroup
	resourceProgress.active = true
	resourceProgress.loaded = 0
	resourceProgress.total = 0
	resourceProgress.loadedBytes = 0
	resourceProgress.totalBytes = 0
	resourceProgress.label = '准备加载资源...'
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
				resourceProgress.label = info.message || (info.assetId ? `加载 ${info.assetId}` : '')
				updateResourceProgressDetails(info)
				const stillLoadingByCount = info.total > 0 && info.loaded < info.total
				const stillLoadingByBytes = resourceProgress.totalBytes > 0 && resourceProgress.loadedBytes < resourceProgress.totalBytes
				resourceProgress.active = stillLoadingByCount || stillLoadingByBytes
			},
			materialFactoryOptions: {
				hdrLoader: rgbeLoader,
			},
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
	warningMessages.value = warnings
	dismissBehaviorAlert()
	resetBehaviorRuntime()
	previewComponentManager.reset()
	rebuildPreviewNodeMap(document.nodes)
	previewComponentManager.syncScene(document.nodes ?? [])
	refreshBehaviorProximityCandidates()
	nodeObjectMap.forEach((object, nodeId) => {
		attachRuntimeForNode(nodeId, object)
	})

	const pendingObjects = new Map<string, THREE.Object3D>()
	root.traverse((object) => {
		const nodeId = object.userData?.nodeId as string | undefined
		if (nodeId) {
			pendingObjects.set(nodeId, object)
		}
	})

	let instancingSkipNodeIds: Set<string> | null = null
	if (lazyLoadMeshesEnabled) {
		instancingSkipNodeIds = new Set<string>()
		pendingObjects.forEach((object, nodeId) => {
			const placeholderObject = findLazyPlaceholderForNode(object, nodeId)
			const lazyData = placeholderObject?.userData?.lazyAsset as LazyAssetMetadata
			if (lazyData?.placeholder) {
				instancingSkipNodeIds!.add(nodeId)
			}
		})
	}
	if (instancingSkipNodeIds?.size) {
		instancingSkipNodeIds.forEach((nodeId) => {
			deferredInstancingNodeIds.add(nodeId)
		})
	}
	if (resourceCache) {
		await prepareInstancedNodesForDocument(document, pendingObjects, resourceCache, {
			skipNodeIds: instancingSkipNodeIds ?? undefined,
		})
	}

	if (!currentDocument) {
		disposeScene({ preservePreviewNodeMap: true })
		while (root.children.length) {
			const child = root.children.shift()
			if (!child) {
				continue
			}
			previewRoot.add(child)
			registerSubtree(child, pendingObjects)
		}
		currentDocument = document
		refreshAnimations()
		initializeLazyPlaceholders(document)
		syncPhysicsBodiesForDocument(document)
		if (isRigidbodyDebugVisible.value) {
			syncRigidbodyDebugHelpers()
		}
		void applyEnvironmentSettingsToScene(environmentSettings)
		return
	}

	reconcileNodeLists(null, document.nodes ?? [], currentDocument.nodes ?? [], pendingObjects)

	for (const [nodeId, object] of Array.from(pendingObjects.entries())) {
		if (!nodeObjectMap.has(nodeId)) {
			previewRoot.add(object)
			registerSubtree(object, pendingObjects)
		}
	}

	syncPhysicsBodiesForDocument(document)
	if (isRigidbodyDebugVisible.value) {
		syncRigidbodyDebugHelpers()
	}

	currentDocument = document
	refreshAnimations()
	initializeLazyPlaceholders(document)
	void applyEnvironmentSettingsToScene(environmentSettings)
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
	statusMessage.value = '同步场景数据...'
	void updateScene(snapshot.document)
		.then(() => {
			lastUpdateTime.value = snapshot.timestamp
			statusMessage.value = ''
		})
		.catch((error) => {
			console.error('[ScenePreview] Failed to apply snapshot', error)
			statusMessage.value = '加载场景失败，请稍后再试'
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

function toggleRigidbodyDebugOverlay(): void {
	isRigidbodyDebugVisible.value = !isRigidbodyDebugVisible.value
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
	unsubscribe = subscribeToScenePreview((snapshot) => {
		applySnapshot(snapshot)
	})
	updateLanternViewportSize()
	if (typeof window !== 'undefined') {
		window.addEventListener('resize', handleLanternViewportResize)
	}
})

onBeforeUnmount(() => {
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
	pendingSkyboxSettings = null
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
		renderer.domElement.removeEventListener('click', handleBehaviorClick)
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
		<div ref="containerRef" class="scene-preview__canvas"></div>
		<div ref="statsContainerRef" class="scene-preview__stats">
			<div
				v-if="memoryFallbackLabel"
				class="scene-preview__stats-fallback"
			>
				{{ memoryFallbackLabel }}
			</div>
		</div>
		<div
			v-if="resourceProgress.active"
			class="scene-preview__preload-overlay"
		>
			<v-card class="scene-preview__preload-card" elevation="12">
				<div class="scene-preview__preload-title">资源加载中</div>
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
				最近更新：{{ formattedLastUpdate }}
			</v-chip>
		</div>
		<div
			v-if="controlMode === 'first-person' && !isFirstPersonMouseControlEnabled"
			class="scene-preview__mouse-hint"
		>
			<v-chip
				color="amber-darken-2"
				variant="elevated"
				size="small"
				prepend-icon="mdi-mouse-off"
			>
				鼠标视角已暂停（按 C 恢复）
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
				title="观察视角"
				@click="handlePurposeWatchClick"
			>
				<span class="scene-preview__purpose-label">观察</span>
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
				title="恢复平视"
				@click="handlePurposeResetClick"
			>
				<span class="scene-preview__purpose-label">平视</span>
			</v-btn>
		</div>
		<div
			v-if="vehicleDriveUi.visible"
			class="scene-preview__drive-panel"
		>
			<div class="scene-preview__drive-panel-header">
				<div class="scene-preview__drive-title">
					<v-icon icon="mdi-steering" size="small" />
					<span>驾驶车辆</span>
				</div>
				<span class="scene-preview__drive-node">{{ vehicleDriveUi.label }}</span>
			</div>
			<div class="scene-preview__drive-grid">
				<v-btn
					class="scene-preview__drive-button scene-preview__drive-button--wide"
					variant="tonal"
					:class="{ 'scene-preview__drive-button--active': vehicleDriveUi.forwardActive }"
					prepend-icon="mdi-arrow-up-bold"
					@click.prevent
					@pointerdown.prevent="handleVehicleDriveControlPointer('forward', true, $event)"
					@pointerup.prevent="handleVehicleDriveControlPointer('forward', false, $event)"
					@pointerleave="handleVehicleDriveControlPointer('forward', false)"
					@pointercancel="handleVehicleDriveControlPointer('forward', false)"
				>
					前进
				</v-btn>
				<v-btn
					class="scene-preview__drive-button scene-preview__drive-button--wide"
					variant="tonal"
					:class="{ 'scene-preview__drive-button--active': vehicleDriveUi.leftActive }"
					prepend-icon="mdi-arrow-left-bold"
					@click.prevent
					@pointerdown.prevent="handleVehicleDriveControlPointer('left', true, $event)"
					@pointerup.prevent="handleVehicleDriveControlPointer('left', false, $event)"
					@pointerleave="handleVehicleDriveControlPointer('left', false)"
					@pointercancel="handleVehicleDriveControlPointer('left', false)"
				>
					左转
				</v-btn>
				<v-btn
					class="scene-preview__drive-button scene-preview__drive-button--brake"
					variant="flat"
					color="red"
					:class="{ 'scene-preview__drive-button--active': vehicleDriveUi.brakeActive }"
					prepend-icon="mdi-car-brake-alert"
					@click.prevent
					@pointerdown.prevent="handleVehicleDriveControlPointer('brake', true, $event)"
					@pointerup.prevent="handleVehicleDriveControlPointer('brake', false, $event)"
					@pointerleave="handleVehicleDriveControlPointer('brake', false)"
					@pointercancel="handleVehicleDriveControlPointer('brake', false)"
				>
					刹车
				</v-btn>
				<v-btn
					class="scene-preview__drive-button"
					variant="tonal"
					:class="{ 'scene-preview__drive-button--active': vehicleDriveUi.rightActive }"
					prepend-icon="mdi-arrow-right-bold"
					@click.prevent
					@pointerdown.prevent="handleVehicleDriveControlPointer('right', true, $event)"
					@pointerup.prevent="handleVehicleDriveControlPointer('right', false, $event)"
					@pointerleave="handleVehicleDriveControlPointer('right', false)"
					@pointercancel="handleVehicleDriveControlPointer('right', false)"
				>
					右转
				</v-btn>
				<v-btn
					class="scene-preview__drive-button"
					variant="tonal"
					:class="{ 'scene-preview__drive-button--active': vehicleDriveUi.backwardActive }"
					prepend-icon="mdi-arrow-down-bold"
					@click.prevent
					@pointerdown.prevent="handleVehicleDriveControlPointer('backward', true, $event)"
					@pointerup.prevent="handleVehicleDriveControlPointer('backward', false, $event)"
					@pointerleave="handleVehicleDriveControlPointer('backward', false)"
					@pointercancel="handleVehicleDriveControlPointer('backward', false)"
				>
					后退
				</v-btn>
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
					:aria-label="isPlaying ? '暂停动画' : '播放动画'"
					:title="isPlaying ? '暂停动画' : '播放动画'"
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
						:aria-label="'第一人称视角'"
						:title="'第一人称视角 (快捷键 1)'"
					/>
					<v-btn
						value="third-person"
						icon="mdi-compass"
						size="small"

						:aria-label="'第三人称视角'"
						:title="'第三人称视角 (快捷键 3)'"
					/>
				</v-btn-toggle>
				<v-btn
					v-if="controlMode === 'first-person'"
					class="scene-preview__control-button"
					:icon="isFirstPersonMouseControlEnabled ? 'mdi-mouse' : 'mdi-mouse-off'"
					variant="tonal"
						size="small"
					:color="isFirstPersonMouseControlEnabled ? 'info' : 'warning'"
					:disabled="vehicleDriveUi.cameraLocked"
					:aria-label="isFirstPersonMouseControlEnabled ? '禁用鼠标镜头' : '启用鼠标镜头'"

					:title="isFirstPersonMouseControlEnabled ? '禁用鼠标镜头 (快捷键 C)' : '启用鼠标镜头 (快捷键 C)'"
					@click="toggleFirstPersonMouseControl"
				/>
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
							:aria-label="`调整音量 (${volumePercent}%)`"
							:title="`调整音量 (${volumePercent}%)`"
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
					:aria-label="'截图 (快捷键 P)'"
					:title="'截图 (快捷键 P)'"
					@click="captureScreenshot"
				/>
				<v-btn
					class="scene-preview__control-button"
					:icon="isRigidbodyDebugVisible ? 'mdi-cube-scan' : 'mdi-cube-outline'"
					variant="tonal"
					:color="isRigidbodyDebugVisible ? 'warning' : 'secondary'"
					size="small"
					:aria-label="isRigidbodyDebugVisible ? '隐藏刚体线框' : '显示刚体线框'"
					:title="isRigidbodyDebugVisible ? '隐藏刚体线框' : '显示刚体线框'"
					@click="toggleRigidbodyDebugOverlay"
				/>
				<v-btn
					class="scene-preview__control-button"
					:icon="isFullscreen ? 'mdi-fullscreen-exit' : 'mdi-fullscreen'"
					variant="tonal"
					color="secondary"
					size="small"
					:aria-label="isFullscreen ? '退出全屏' : '全屏'"
					:title="isFullscreen ? '退出全屏' : '全屏'"
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

.scene-preview__preload-overlay {
	position: absolute;
	top: 80px;
	left: 50%;
	transform: translateX(-50%);
	z-index: 30;
	pointer-events: none;
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
	left: 24px;
	bottom: 130px;
	z-index: 2150;
	padding: 16px;
	border-radius: 16px;
	background: rgba(8, 10, 18, 0.9);
	box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
	backdrop-filter: blur(10px);
	min-width: 240px;
	pointer-events: auto;
}

.scene-preview__drive-panel-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 12px;
}

.scene-preview__drive-title {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 0.9rem;
	font-weight: 600;
	color: #f5f7ff;
}

.scene-preview__drive-node {
	font-size: 0.8rem;
	color: rgba(255, 255, 255, 0.72);
	max-width: 160px;
	text-overflow: ellipsis;
	overflow: hidden;
	white-space: nowrap;
}

.scene-preview__drive-grid {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 10px;
	align-items: stretch;
}

.scene-preview__drive-button {
	min-height: 44px;
	font-size: 0.85rem;
	text-transform: none;
	letter-spacing: 0.02em;
}

.scene-preview__drive-button--wide {
	grid-column: span 3;
}

.scene-preview__drive-button--brake {
	grid-column: span 1;
	min-height: 48px;
}

.scene-preview__drive-button--active {
	box-shadow: 0 0 18px rgba(255, 255, 255, 0.25);
	background: linear-gradient(135deg, rgba(124, 92, 255, 0.45), rgba(173, 134, 255, 0.35)) !important;
	color: #fff !important;
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
