<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { FirstPersonControls } from 'three/examples/jsm/controls/FirstPersonControls.js'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import type { SceneJsonExportDocument, SceneNode } from '@harmony/schema'
import type { SceneCameraState } from '@/types/scene-camera-state'
import type { ScenePreviewSnapshot } from '@/utils/previewChannel'
import { subscribeToScenePreview } from '@/utils/previewChannel'
import { buildSceneGraph } from '@schema/sceneGraph';

type ControlMode = 'first-person' | 'third-person'

const containerRef = ref<HTMLDivElement | null>(null)
const statusMessage = ref('等待场景数据...')
const isPlaying = ref(true)
const controlMode = ref<ControlMode>('first-person')
const volumePercent = ref(100)
const isFullscreen = ref(false)
const lastUpdateTime = ref<string | null>(null)
const warningMessages = ref<string[]>([])
const isFirstPersonMouseControlEnabled = ref(true)
const isVolumeMenuOpen = ref(false)

const CAMERA_HEIGHT = 1.6
const FIRST_PERSON_ROTATION_SPEED = 75
const FIRST_PERSON_MOVE_SPEED = 2
const FIRST_PERSON_LOOK_SPEED = 0.06

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let listener: THREE.AudioListener | null = null
let rootGroup: THREE.Group | null = null
let fallbackLight: THREE.HemisphereLight | null = null
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
const lastFirstPersonState = {
	position: new THREE.Vector3(0, CAMERA_HEIGHT, 0),
	direction: new THREE.Vector3(0, 0, -1),
}
const lastOrbitState = {
	position: new THREE.Vector3(8, 6, 8),
	target: new THREE.Vector3(0, 0, 0),
}
let animationMixers: THREE.AnimationMixer[] = []
let hasAppliedInitialCameraState = false

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
	if (controlMode.value === 'first-person' && firstPersonControls) {
		firstPersonControls.activeLook = enabled
		resetFirstPersonPointerDelta()
	}
	updateCanvasCursor()
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

function updateCanvasCursor() {
	const canvas = renderer?.domElement
	if (!canvas) {
		return
	}
	if (controlMode.value !== 'first-person') {
		canvas.style.cursor = mapControls?.enabled ? 'grab' : 'default'
		return
	}
	canvas.style.cursor = isFirstPersonMouseControlEnabled.value ? 'crosshair' : 'default'
}

function setFirstPersonMouseControl(enabled: boolean) {
	if (isFirstPersonMouseControlEnabled.value === enabled) {
		return
	}
	isFirstPersonMouseControlEnabled.value = enabled
	if (controlMode.value === 'first-person' && firstPersonControls) {
		firstPersonControls.activeLook = enabled
		resetFirstPersonPointerDelta()
		if (enabled) {
			syncFirstPersonOrientation()
		}
	}
	updateCanvasCursor()
}

function toggleFirstPersonMouseControl() {
	setFirstPersonMouseControl(!isFirstPersonMouseControlEnabled.value)
}

function handlePreviewPointerDown(event: PointerEvent) {
	if (controlMode.value !== 'first-person' || isFirstPersonMouseControlEnabled.value) {
		return
	}
	if (event.button !== 0) {
		return
	}
	if (event.target !== renderer?.domElement) {
		return
	}
	setFirstPersonMouseControl(true)
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
	if (mode === 'first-person') {
		mapControls && (mapControls.enabled = false)
		firstPersonControls && (firstPersonControls.enabled = true)
		if (firstPersonControls) {
			firstPersonControls.activeLook = isFirstPersonMouseControlEnabled.value
		}
		activeCamera.position.copy(lastFirstPersonState.position)
		activeCamera.position.y = CAMERA_HEIGHT
		const target = new THREE.Vector3().copy(lastFirstPersonState.position).add(lastFirstPersonState.direction)
		activeCamera.lookAt(target)
		syncFirstPersonOrientation()
		resetFirstPersonPointerDelta()
	} else {
		firstPersonControls && (firstPersonControls.enabled = false)
		mapControls && (mapControls.enabled = true)
		activeCamera.position.copy(lastOrbitState.position)
		mapControls?.target.copy(lastOrbitState.target)
		mapControls?.update()
	}
	updateCanvasCursor()
}

function initRenderer() {
	const host = containerRef.value
	if (!host) {
		return
	}
	renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
	renderer.outputColorSpace = THREE.SRGBColorSpace
	renderer.toneMapping = THREE.ACESFilmicToneMapping
	renderer.shadowMap.enabled = true
	renderer.shadowMap.type = THREE.PCFSoftShadowMap
	renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2))
	host.appendChild(renderer.domElement)

	scene = new THREE.Scene()
	scene.background = new THREE.Color(0x0d0d12)

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

	const grid = new THREE.GridHelper(40, 40, 0x404050, 0x2a2a3a)
	grid.position.y = 0
	scene.add(grid)

	initControls()
	updateCanvasCursor()
	renderer.domElement.addEventListener('pointerdown', handlePreviewPointerDown)
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
	firstPersonControls.activeLook = isFirstPersonMouseControlEnabled.value
	firstPersonControls.enabled = controlMode.value === 'first-person'

	mapControls = new MapControls(camera, renderer.domElement)
	mapControls.enableDamping = false
	mapControls.dampingFactor = 0.08
	mapControls.maxPolarAngle = Math.PI / 2 - 0.05
	mapControls.minDistance = 1
	mapControls.maxDistance = 200
	mapControls.enabled = controlMode.value === 'third-person'
	mapControls.target.copy(lastOrbitState.target)
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
			if (rotationDirection !== 0) {
				const yawDegrees = rotationDirection * FIRST_PERSON_ROTATION_SPEED * delta
				const controlsInternal = firstPersonControls as FirstPersonControls & { _lon: number }
				const currentLon = controlsInternal._lon ?? 0
				const nextLon = THREE.MathUtils.euclideanModulo(currentLon + yawDegrees, 360)
				controlsInternal._lon = nextLon
			}
			firstPersonControls.update(delta)
			activeCamera.position.y = CAMERA_HEIGHT
			lastFirstPersonState.position.copy(activeCamera.position)
			activeCamera.getWorldDirection(lastFirstPersonState.direction)
		} else if (mapControls) {
			mapControls.update()
			lastOrbitState.position.copy(activeCamera.position)
			lastOrbitState.target.copy(mapControls.target)
		}

		if (isPlaying.value) {
			animationMixers.forEach((mixer) => mixer.update(delta))
		}

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

function disposeScene() {
	nodeObjectMap.clear()
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

function disposeObjectResources(object: THREE.Object3D) {
	const mesh = object as THREE.Mesh
	if ((mesh as any).isMesh) {
		mesh.geometry?.dispose?.()
		const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
		materials.forEach((material) => material?.dispose?.())
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
			nodeObjectMap.set(nodeId, child)
			pending?.delete(nodeId)
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
	if (typeof node.visible === 'boolean') {
		object.visible = node.visible
	} else {
		object.visible = true
	}
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
				if (!shouldReplace) {
					updateNodeProperties(object, node)
				}
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
	animationMixers.forEach((mixer) => {
		mixer.stopAllAction()
		mixer.uncacheRoot(mixer.getRoot())
	})
	animationMixers = []

	nodeObjectMap.forEach((object) => {
		const clips = (object as unknown as { animations?: THREE.AnimationClip[] }).animations
		if (!Array.isArray(clips) || !clips.length) {
			return
		}
		const mixer = new THREE.AnimationMixer(object)
		clips.forEach((clip) => {
			const action = mixer.clipAction(clip)
			action.play()
		})
		mixer.timeScale = isPlaying.value ? 1 : 0
		animationMixers.push(mixer)
	})
}

async function updateScene(document: SceneJsonExportDocument) {
			if (!scene || !rootGroup) {
		return
	}
			const previewRoot = rootGroup
	const { root, warnings } = await buildSceneGraph(document)
	warningMessages.value = warnings

	const pendingObjects = new Map<string, THREE.Object3D>()
	root.traverse((object) => {
		const nodeId = object.userData?.nodeId as string | undefined
		if (nodeId) {
			pendingObjects.set(nodeId, object)
		}
	})

	if (!currentDocument) {
		disposeScene()
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
			if (!hasAppliedInitialCameraState && snapshot.camera) {
				applyInitialCameraState(snapshot.camera)
				hasAppliedInitialCameraState = true
			}
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

function applyInitialCameraState(state: SceneCameraState) {
	if (!camera) {
		return
	}
	camera.position.set(state.position.x, state.position.y, state.position.z)
	const target = new THREE.Vector3(state.target.x, state.target.y, state.target.z)
	camera.lookAt(target)
	syncFirstPersonOrientation()
	if (state.fov && camera instanceof THREE.PerspectiveCamera) {
		camera.fov = state.fov
		camera.updateProjectionMatrix()
	}
	lastFirstPersonState.position.copy(camera.position)
	camera.getWorldDirection(lastFirstPersonState.direction)
	lastOrbitState.position.copy(camera.position)
	lastOrbitState.target.copy(target)
	applyControlMode(controlMode.value)
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
	initRenderer()
	unsubscribe = subscribeToScenePreview((snapshot) => {
		applySnapshot(snapshot)
	})
})

onBeforeUnmount(() => {
	unsubscribe?.()
	unsubscribe = null
	stopAnimationLoop()
	window.removeEventListener('resize', handleResize)
	document.removeEventListener('fullscreenchange', handleFullscreenChange)
	window.removeEventListener('keydown', handleKeyDown)
	window.removeEventListener('keyup', handleKeyUp)
	disposeScene()
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
		renderer.domElement.removeEventListener('pointerdown', handlePreviewPointerDown)
		renderer.dispose()
		renderer.domElement.remove()
		renderer = null
	}
	listener = null
	scene = null
	camera = null
})
</script>

<template>
	<div class="scene-preview">
		<div ref="containerRef" class="scene-preview__canvas"></div>
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
