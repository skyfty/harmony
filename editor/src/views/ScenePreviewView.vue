<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import * as THREE from 'three'
import { FirstPersonControls } from 'three/examples/jsm/controls/FirstPersonControls.js'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { Sky } from 'three/addons/objects/Sky.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import type {
	EnvironmentSettings,
	LanternSlideDefinition,
	SceneJsonExportDocument,
	SceneNode,
	SceneNodeComponentState,
	SceneSkyboxSettings,
} from '@harmony/schema'
import type { EnvironmentBackgroundMode } from '@/types/environment'
import type { ScenePreviewSnapshot } from '@/utils/previewChannel'
import { subscribeToScenePreview } from '@/utils/previewChannel'
import { buildSceneGraph, type SceneGraphBuildOptions } from '@schema/sceneGraph'
import ResourceCache from '@schema/ResourceCache'
import { AssetCache, AssetLoader } from '@schema/assetCache'
import { loadNodeObject } from '@schema/utils/modelAssetLoader'
import { ComponentManager } from '@schema/components/componentManager'
import {
	behaviorComponentDefinition,
	guideboardComponentDefinition,
	displayBoardComponentDefinition,
	wallComponentDefinition,
	viewPointComponentDefinition,
	warpGateComponentDefinition,
	GUIDEBOARD_COMPONENT_TYPE,
} from '@schema/components'
import type { GuideboardComponentProps } from '@schema/components'
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

import {PROXIMITY_EXIT_PADDING, DEFAULT_OBJECT_RADIUS, PROXIMITY_MIN_DISTANCE, PROXIMITY_RADIUS_SCALE} from '@schema/behaviors/runtime'

type ControlMode = 'first-person' | 'third-person'

const containerRef = ref<HTMLDivElement | null>(null)
const statusMessage = ref('等待场景数据...')
const isPlaying = ref(true)
const controlMode = ref<ControlMode>('third-person')
const volumePercent = ref(100)
const isFullscreen = ref(false)
const lastUpdateTime = ref<string | null>(null)
const warningMessages = ref<string[]>([])
const isFirstPersonMouseControlEnabled = ref(true)
const isVolumeMenuOpen = ref(false)
const isCameraCaged = ref(false)

const resourceProgress = reactive({
	active: false,
	loaded: 0,
	total: 0,
	label: '',
})

const resourceProgressPercent = computed(() => {
	if (!resourceProgress.total) {
		return resourceProgress.active ? 0 : 100
	}
	return Math.min(100, Math.round((resourceProgress.loaded / resourceProgress.total) * 100))
})

const previewComponentManager = new ComponentManager()
previewComponentManager.registerDefinition(wallComponentDefinition)
previewComponentManager.registerDefinition(guideboardComponentDefinition)
previewComponentManager.registerDefinition(displayBoardComponentDefinition)
previewComponentManager.registerDefinition(viewPointComponentDefinition)
previewComponentManager.registerDefinition(warpGateComponentDefinition)
previewComponentManager.registerDefinition(behaviorComponentDefinition)

const previewNodeMap = new Map<string, SceneNode>()

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

const editorAssetCache = new AssetCache()
const editorAssetLoader = new AssetLoader(editorAssetCache)
let editorResourceCache: ResourceCache | null = null

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
const lanternActiveSlideIndex = ref(0)
const lanternEventToken = ref<string | null>(null)

const purposeControlsVisible = ref(false)
const purposeTargetNodeId = ref<string | null>(null)
const purposeSourceNodeId = ref<string | null>(null)

type LanternTextState = { text: string; loading: boolean; error: string | null }

const lanternTextState = reactive<Record<string, LanternTextState>>({})
const lanternTextPromises = new Map<string, Promise<void>>()

const activeBehaviorDelayTimers = new Map<string, number>()
const activeBehaviorAnimations = new Map<string, () => void>()
const nodeAnimationControllers = new Map<string, { mixer: THREE.AnimationMixer; clips: THREE.AnimationClip[] }>()
type BehaviorProximityCandidate = { hasApproach: boolean; hasDepart: boolean }
type BehaviorProximityStateEntry = { inside: boolean; lastDistance: number | null }
type BehaviorProximityThreshold = { enter: number; exit: number; objectId: string }

const behaviorProximityCandidates = new Map<string, BehaviorProximityCandidate>()
const behaviorProximityState = new Map<string, BehaviorProximityStateEntry>()
const behaviorProximityThresholdCache = new Map<string, BehaviorProximityThreshold>()

const rgbeLoader = new RGBELoader().setDataType(THREE.FloatType)

const MAX_CONCURRENT_LAZY_LOADS = 2

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
const tempCameraMatrix = new THREE.Matrix4()
const cameraViewFrustum = new THREE.Frustum()
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
const ENVIRONMENT_NODE_ID = 'harmony:environment' as const
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
const packageEntryCache = new Map<string, { provider: string; value: string } | null>()
const DISPLAY_BOARD_RESOLVER_KEY = '__harmonyResolveDisplayBoardMedia'

type AssetSourceResolution =
	| { kind: 'data-url'; dataUrl: string }
	| { kind: 'remote-url'; url: string }
	| { kind: 'inline-text'; text: string }
	| { kind: 'raw'; data: ArrayBuffer }

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let listener: THREE.AudioListener | null = null
let rootGroup: THREE.Group | null = null
let fallbackLight: THREE.HemisphereLight | null = null
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
const nodeObjectMap = new Map<string, THREE.Object3D>()
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

function rebuildPreviewNodeMap(nodes: SceneNode[] | undefined | null): void {
	previewNodeMap.clear()
	if (!Array.isArray(nodes)) {
		return
	}
	const stack: SceneNode[] = [...nodes]
	while (stack.length) {
		const node = stack.pop()
		if (!node) {
			continue
		}
		previewNodeMap.set(node.id, node)
		if (Array.isArray(node.children) && node.children.length) {
			stack.push(...node.children)
		}
	}
}

function resolveNodeById(nodeId: string): SceneNode | null {
	return previewNodeMap.get(nodeId) ?? null
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
	packageEntryCache.clear()
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

function resolveAssetSource(assetId: string): AssetSourceResolution | null {
	const trimmed = assetId.trim()
	if (!trimmed.length) {
		return null
	}
	if (/^(https?:)?\/\//i.test(trimmed)) {
		return { kind: 'remote-url', url: trimmed }
	}
	if (trimmed.startsWith('data:')) {
		return { kind: 'data-url', dataUrl: trimmed }
	}
	if (!currentDocument) {
		return null
	}
	const packageMap = currentDocument.packageAssetMap ?? {}
	const embeddedKey = `local::${trimmed}`
	const embeddedValue = packageMap[embeddedKey]
	if (typeof embeddedValue === 'string' && embeddedValue.startsWith('data:')) {
		return { kind: 'data-url', dataUrl: embeddedValue }
	}
	const directValue = packageMap[trimmed]
	if (typeof directValue === 'string' && directValue.trim().length) {
		const resolved = resolvePackageEntryLike(trimmed, 'local', directValue.trim())
		if (resolved) {
			return resolved
		}
	}
	const packageEntry = getPackageEntry(trimmed, packageMap)
	if (packageEntry) {
		const resolved = resolvePackageEntryLike(trimmed, packageEntry.provider, packageEntry.value)
		if (resolved) {
			return resolved
		}
	}
	const indexResolved = resolveAssetSourceFromIndex(trimmed, packageMap)
	if (indexResolved) {
		return indexResolved
	}
	return null
}

function resolveAssetSourceFromIndex(assetId: string, packageMap: Record<string, string>): AssetSourceResolution | null {
	if (!currentDocument?.assetIndex) {
		return null
	}
	const entry = (currentDocument.assetIndex as Record<string, unknown>)[assetId]
	if (!entry || typeof entry !== 'object') {
		return null
	}
	const record = entry as Record<string, unknown>
	const inline = typeof record.inline === 'string' ? record.inline.trim() : ''
	if (inline.length) {
		if (inline.startsWith('data:')) {
			return { kind: 'data-url', dataUrl: inline }
		}
		if (/^(https?:)?\/\//i.test(inline)) {
			return { kind: 'remote-url', url: inline }
		}
		return { kind: 'inline-text', text: inline }
	}
	const directUrlCandidates = [record.url, record.downloadUrl]
	for (const candidate of directUrlCandidates) {
		if (typeof candidate === 'string') {
			const normalized = candidate.trim()
			if (normalized.length) {
				return { kind: 'remote-url', url: normalized }
			}
		}
	}
	const source = record.source
	if (source && typeof source === 'object') {
		const sourceRecord = source as Record<string, unknown>
		const sourceInline = typeof sourceRecord.inline === 'string' ? sourceRecord.inline.trim() : ''
		if (sourceInline.length) {
			if (sourceInline.startsWith('data:')) {
				return { kind: 'data-url', dataUrl: sourceInline }
			}
			if (/^(https?:)?\/\//i.test(sourceInline)) {
				return { kind: 'remote-url', url: sourceInline }
			}
			return { kind: 'inline-text', text: sourceInline }
		}
		const sourceUrlCandidates = [sourceRecord.url, sourceRecord.downloadUrl]
		for (const candidate of sourceUrlCandidates) {
			if (typeof candidate === 'string') {
				const normalized = candidate.trim()
				if (normalized.length) {
					return { kind: 'remote-url', url: normalized }
				}
			}
		}
		const providerId = typeof sourceRecord.providerId === 'string' ? sourceRecord.providerId.trim() : ''
		const originalAssetId = typeof sourceRecord.originalAssetId === 'string'
			? sourceRecord.originalAssetId.trim()
			: assetId
		let providerValue = ''
		if (typeof sourceRecord.value === 'string' && sourceRecord.value.trim().length) {
			providerValue = sourceRecord.value.trim()
		}
		if (providerId) {
			const mapKey = `${providerId}::${originalAssetId}`
			const mapped = packageMap[mapKey]
			const resolved = resolvePackageEntryLike(
				originalAssetId,
				providerId,
				typeof mapped === 'string' && mapped.trim().length ? mapped.trim() : providerValue || originalAssetId,
			)
			if (resolved) {
				return resolved
			}
		}
	}
	return null
}

function resolvePackageEntryLike(assetId: string, _provider: string, rawValue: string): AssetSourceResolution | null {
	const value = typeof rawValue === 'string' ? rawValue.trim() : ''
	if (value.startsWith('data:')) {
		return { kind: 'data-url', dataUrl: value }
	}
	if (value && /^(https?:)?\/\//i.test(value)) {
		return { kind: 'remote-url', url: value }
	}
	if (currentDocument != null) {
		const packageMap = currentDocument.packageAssetMap ?? {}
    	const key = `url::${assetId}`;
		const providerUrl = packageMap[key];
		if (typeof providerUrl === 'string' && /^(https?:)?\/\//i.test(providerUrl)) {
			return { kind: 'remote-url', url: providerUrl };
		}
	}
	if (value) {
		const buffer = base64ToArrayBuffer(value)
		if (buffer) {
			return { kind: 'raw', data: buffer }
		}
	}
	return null
}

function getPackageEntry(assetId: string, packageMap: Record<string, string>): { provider: string; value: string } | null {
	if (packageEntryCache.has(assetId)) {
		return packageEntryCache.get(assetId) ?? null
	}
	let found: { provider: string; value: string } | null = null
	for (const [key, value] of Object.entries(packageMap)) {
		if (typeof value !== 'string' || !value.trim().length) {
			continue
		}
		const separator = key.indexOf('::')
		if (separator === -1) {
			continue
		}
		const provider = key.slice(0, separator)
		const id = key.slice(separator + 2)
		if (id === assetId) {
			found = { provider, value: value.trim() }
			break
		}
	}
	packageEntryCache.set(assetId, found)
	return found
}

function base64ToArrayBuffer(value: string): ArrayBuffer | null {
	try {
		const clean = value.replace(/^data:[^,]+,/, '').replace(/\s/g, '')
		if (typeof atob === 'function') {
			const binary = atob(clean)
			const length = binary.length
			const buffer = new Uint8Array(length)
			for (let index = 0; index < length; index += 1) {
				buffer[index] = binary.charCodeAt(index)
			}
			return buffer.buffer
		}
	} catch (error) {
		console.warn('[ScenePreview] Failed to decode base64 asset', error)
	}
	return null
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

function resolveInlineTextUrl(text: string, assetId: string): { url: string; mimeType: string | null; dispose: () => void } {
	const mimeType = inferMimeTypeFromAssetId(assetId) ?? 'text/plain'
	const blob = new Blob([text], { type: mimeType })
	const url = URL.createObjectURL(blob)
	return {
		url,
		mimeType,
		dispose: () => {
			URL.revokeObjectURL(url)
		},
	}
}

async function resolveDisplayBoardMediaSource(candidate: string): Promise<{ url: string; mimeType?: string | null; dispose?: () => void } | null> {
	const trimmed = candidate.trim()
	if (!trimmed.length) {
		return null
	}
	const assetId = trimmed.startsWith('asset://') ? trimmed.slice('asset://'.length) : trimmed
	if (!assetId.length) {
		return null
	}
	const source = resolveAssetSource(assetId)
	if (!source) {
		if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
			return { url: trimmed, mimeType: inferMimeTypeFromUrl(trimmed) }
		}
		return null
	}
	switch (source.kind) {
		case 'remote-url':
			return { url: source.url, mimeType: inferMimeTypeFromUrl(source.url) }
		case 'data-url':
			return { url: source.dataUrl, mimeType: inferMimeTypeFromUrl(source.dataUrl) }
		case 'inline-text': {
			const result = resolveInlineTextUrl(source.text, assetId)
			return result
		}
		case 'raw': {
			const mimeType = inferMimeTypeFromAssetId(assetId)
			const url = getOrCreateObjectUrl(assetId, source.data, mimeType ?? undefined)
			return { url, mimeType }
		}
		default:
			return null
	}
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
const lanternCurrentSlideImage = computed(() => resolveLanternImageSource(lanternCurrentSlide.value?.imageAssetId ?? null))
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

watch(
	lanternSlides,
	(slidesList) => {
		const list = Array.isArray(slidesList) ? slidesList : []
		const activeIds = new Set<string>()
		for (const slide of list) {
			const candidate = slide?.descriptionAssetId?.trim()
			if (candidate) {
				activeIds.add(candidate)
				void ensureLanternText(candidate)
			}
		}
		Object.keys(lanternTextState).forEach((existing) => {
			if (!activeIds.has(existing)) {
				delete lanternTextState[existing]
			}
		})
		Array.from(lanternTextPromises.keys()).forEach((existing) => {
			if (!activeIds.has(existing)) {
				lanternTextPromises.delete(existing)
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
	},
	{ immediate: true },
)

watch(volumePercent, (value) => {
	if (!listener) {
		return
	}
	listener.setMasterVolume(Math.max(0, Math.min(1, value / 100)))
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
	setFirstPersonMouseControl(!isFirstPersonMouseControlEnabled.value)
}

function setCameraCaging(enabled: boolean) {
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
}

function resolveLanternImageSource(assetId: string | null): string | null {
	if (!assetId) {
		return null
	}
	const trimmed = assetId.trim()
	if (!trimmed.length) {
		return null
	}
	const resolved = resolveAssetSource(trimmed)
	if (!resolved) {
		return /^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith('data:') ? trimmed : null
	}
	switch (resolved.kind) {
		case 'data-url':
			return resolved.dataUrl
		case 'remote-url':
			return resolved.url
		case 'raw':
			return getOrCreateObjectUrl(trimmed, resolved.data)
		case 'inline-text':
			const inline = resolved.text.trim()
			if (/^(https?:)?\/\//i.test(inline) || inline.startsWith('data:')) {
				return inline
			}
			return null
		default:
			return null
	}
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
	const source = resolveAssetSource(trimmed)
	if (!source) {
		return null
	}
	switch (source.kind) {
		case 'inline-text':
			return source.text
		case 'data-url':
			return decodeDataUrlText(source.dataUrl)
		case 'remote-url':
			return await fetchTextFromUrl(source.url)
		case 'raw':
			try {
				return new TextDecoder().decode(source.data)
			} catch (error) {
				console.warn('[ScenePreview] Failed to decode text asset buffer', error)
				return null
			}
		default:
			return null
	}
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

function closeLanternOverlay(resolution?: BehaviorEventResolution): void {
	const token = lanternEventToken.value
	resetLanternOverlay()
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
	const desiredDistance = ownerObject
		? Math.max(DEFAULT_OBJECT_RADIUS, computeObjectBoundingRadius(ownerObject))
		: DEFAULT_OBJECT_RADIUS
	const destination = focusPoint.clone()
	tempDirection.copy(activeCamera.position).sub(focusPoint)
	tempDirection.y = 0
	if (tempDirection.lengthSq() < 1e-6) {
		tempDirection.set(0, 0, 1)
		tempDirection.applyQuaternion(tempQuaternion)
		tempDirection.y = 0
	}
	if (tempDirection.lengthSq() < 1e-6) {
		tempDirection.set(0, 0, 1)
	}
	tempDirection.normalize().multiplyScalar(desiredDistance)
	destination.add(tempDirection)
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
	const action = mixer.clipAction(clip)
	mixer.stopAllAction()
	action.reset()
	action.enabled = true
	if (event.loop) {
		action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY)
		action.clampWhenFinished = false
	} else {
		action.setLoop(THREE.LoopOnce, 0)
		action.clampWhenFinished = true
	}
	action.play()
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
		resolveBehaviorToken(token, { type: 'continue' })
	}
	const cancel = () => {
		mixer.removeEventListener('finished', onFinished)
		try {
			action.stop()
		} catch (cancelError) {
			console.warn('[ScenePreview] Failed to stop animation action', cancelError)
		}
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

function performWatchFocus(targetNodeId: string | null, caging = false): { success: boolean; message?: string } {
	const activeCamera = camera
	if (!activeCamera) {
		return { success: false, message: 'Camera unavailable' }
	}
	const resolvedTarget = targetNodeId ?? null
	if (!resolvedTarget) {
		return { success: false, message: 'Target node not provided' }
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
		nodeId = resolveNodeIdFromObject(intersection.object)
		if (nodeId) {
			hitObject = intersection.object
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
		levelTarget.y = camera.position.y
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
		camera.getWorldDirection(tempDirection)
		const yaw = Math.atan2(tempDirection.x, -tempDirection.z)
		tempDirection.set(Math.sin(yaw), 0, -Math.cos(yaw))
		tempTarget.copy(camera.position).add(tempDirection)
		camera.lookAt(tempTarget)
	}
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

function initRenderer() {
	const host = containerRef.value
	if (!host) {
		return
	}
	hidePurposeControls()
	renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
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

	fallbackLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.35)
	scene.add(fallbackLight)

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
		case 'KeyC':
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
		}

		updateBehaviorProximity()
		updateLazyPlaceholders(delta)

		currentRenderer.render(currentScene, activeCamera)
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
	nodeObjectMap.clear()
	if (!options.preservePreviewNodeMap) {
		previewNodeMap.clear()
	}
	previewComponentManager.reset()
	resetBehaviorRuntime()
	resetBehaviorProximity()
	resetAnimationControllers()
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
	if (fallbackLight) {
		fallbackLight.position.copy(skySunPosition.clone().multiplyScalar(50))
	}
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
	const source = resolveAssetSource(assetId)
	if (!source) {
		return null
	}
	let url: string | null = null
	let dispose: (() => void) | undefined
	switch (source.kind) {
		case 'remote-url':
			url = source.url
			break
		case 'data-url':
			url = source.dataUrl
			break
		case 'inline-text': {
			const result = resolveInlineTextUrl(source.text, assetId)
			url = result.url
			dispose = result.dispose
			break
		}
		case 'raw':
			url = getOrCreateObjectUrl(assetId, source.data)
			break
		default:
			return null
	}
	if (!url) {
		return null
	}
	try {
		const texture = await rgbeLoader.loadAsync(url)
		texture.mapping = THREE.EquirectangularReflectionMapping
		texture.needsUpdate = true
		return { texture, dispose }
	} catch (error) {
		console.warn('[ScenePreview] Failed to load environment texture', assetId, error)
		dispose?.()
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
			nodeObjectMap.delete(id)
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
			pending?.delete(nodeId)
			attachRuntimeForNode(nodeId, child)
			const nodeState = resolveNodeById(nodeId)
			const initialVisibility = resolveGuideboardInitialVisibility(nodeState)
			if (initialVisibility !== null) {
				child.visible = initialVisibility
				updateBehaviorVisibility(nodeId, child.visible)
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

function updateNodeProperties(object: THREE.Object3D, node: SceneNode) {
	if (node.name) {
		object.name = node.name
	}
	if (node.position) {
		object.position.set(node.position.x, node.position.y, node.position.z)
	}
	if (node.rotation) {
		object.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z)
	}
	if (node.scale) {
		object.scale.set(node.scale.x, node.scale.y, node.scale.z)
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
	updateBehaviorVisibility(node.id, object.visible)
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
	if (!document) {
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
	if (!camera || lazyPlaceholderStates.size === 0) {
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
		return
	}
	try {
		const detailed = await loadNodeObject(resourceCache, state.assetId, node.importMetadata ?? null)
		if (!detailed) {
			lazyPlaceholderStates.delete(state.nodeId)
			return
		}
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
		lazyPlaceholderStates.delete(state.nodeId)
		refreshAnimations()
	} catch (error) {
		console.warn('[ScenePreview] Deferred asset load failed', error)
		lazyPlaceholderStates.delete(state.nodeId)
	}
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

function refreshFallbackLighting() {
	if (!fallbackLight) {
		return
	}
	let hasLight = false
	nodeObjectMap.forEach((object) => {
		if ((object as any).isLight) {
			hasLight = true
		}
	})
	fallbackLight.visible = !hasLight
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
		nodeAnimationControllers.set(nodeId, { mixer, clips: validClips })
	})
}

async function updateScene(document: SceneJsonExportDocument) {
	resetAssetResolutionCaches()
	const skyboxSettings = resolveDocumentSkybox(document)
	applySkyboxSettings(skyboxSettings)
	const environmentSettings = resolveDocumentEnvironment(document)
	if (!scene || !rootGroup) {
		pendingEnvironmentSettings = cloneEnvironmentSettingsLocal(environmentSettings)
		return
	}
	const previewRoot = rootGroup
	resourceProgress.active = true
	resourceProgress.loaded = 0
	resourceProgress.total = 0
	resourceProgress.label = '准备加载资源...'

	let graphResult: Awaited<ReturnType<typeof buildSceneGraph>> | null = null
	try {
		const buildOptions: SceneGraphBuildOptions = {
			onProgress: (info) => {
				resourceProgress.total = info.total
				resourceProgress.loaded = info.loaded
				resourceProgress.label = info.message || (info.assetId ? `加载 ${info.assetId}` : '')
				resourceProgress.active = info.total > 0 && info.loaded < info.total
			},
			lazyLoadMeshes: true,
			materialFactoryOptions: {
				hdrLoader: rgbeLoader,
			},
		}
		const resourceCache = ensureEditorResourceCache(document, buildOptions)
		graphResult = await buildSceneGraph(document, resourceCache, buildOptions)
	} finally {
		resourceProgress.active = false
		resourceProgress.label = ''
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
		refreshFallbackLighting()
		initializeLazyPlaceholders(document)
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

	currentDocument = document
	refreshAnimations()
	refreshFallbackLighting()
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
	window.removeEventListener('resize', handleResize)
	document.removeEventListener('fullscreenchange', handleFullscreenChange)
	window.removeEventListener('keydown', handleKeyDown)
	window.removeEventListener('keyup', handleKeyUp)
	disposeScene()
	disposeEnvironmentResources()
	disposeSkyResources()
	pmremGenerator?.dispose()
	pmremGenerator = null
	pendingSkyboxSettings = null
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
		<div
			v-if="resourceProgress.active"
			class="scene-preview__preload-overlay"
		>
			<v-card class="scene-preview__preload-card" elevation="12">
				<div class="scene-preview__preload-title">资源加载中</div>
				<v-progress-linear :model-value="resourceProgressPercent" color="primary" height="6" rounded />
				<div class="scene-preview__preload-label">
					{{ resourceProgress.label || `已加载 ${resourceProgress.loaded} / ${resourceProgress.total}` }}
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
				class="scene-preview__purpose-button"
				color="primary"
				variant="elevated"
				size="small"
				@click="handlePurposeWatchClick"
			>
				观察
			</v-btn>
			<v-btn
				class="scene-preview__purpose-button"
				color="secondary"
				variant="tonal"
				size="small"
				@click="handlePurposeResetClick"
			>
				平视
			</v-btn>
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
					>
						<img :src="lanternCurrentSlideImage" :alt="lanternCurrentSlide.title || 'Lantern slide image'" />
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
	gap: 12px;
	z-index: 1900;
	pointer-events: auto;
}

.scene-preview__purpose-button {
	min-width: 0;
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
