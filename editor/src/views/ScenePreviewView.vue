<template>
  <div class="preview-view">
    <div ref="containerRef" class="canvas-host" />

    <div class="control-bar">
      <div class="scene-name">{{ uiState.sceneName }}</div>
      <v-btn
        icon
        variant="tonal"
        color="primary"
        density="comfortable"
        @click="togglePlayback"
      >
        <v-icon>{{ uiState.isPlaying ? 'mdi-pause' : 'mdi-play' }}</v-icon>
      </v-btn>
      <v-btn
        variant="tonal"
        color="primary"
        density="comfortable"
        @click="toggleViewMode"
      >
        <v-icon start>{{ uiState.viewMode === 'map' ? 'mdi-walk' : 'mdi-orbit-variant' }}</v-icon>
        {{ uiState.viewMode === 'map' ? '第一人称' : '自由浏览' }}
      </v-btn>
      <v-btn
        icon
        variant="tonal"
        color="primary"
        density="comfortable"
        @click="toggleAudio"
      >
        <v-icon>{{ uiState.audioMuted ? 'mdi-volume-off' : 'mdi-volume-high' }}</v-icon>
      </v-btn>
      <div class="volume-slider">
        <v-slider
          v-model="uiState.masterVolume"
          min="0"
          max="1"
          step="0.05"
          density="compact"
          hide-details
        />
      </div>
      <v-btn
        icon
        variant="tonal"
        color="primary"
        density="comfortable"
        @click="captureScreenshot"
      >
        <v-icon>mdi-camera</v-icon>
      </v-btn>
      <v-btn
        icon
        variant="tonal"
        color="primary"
        density="comfortable"
        @click="toggleFullscreen"
      >
        <v-icon>{{ uiState.isFullscreen ? 'mdi-fullscreen-exit' : 'mdi-fullscreen' }}</v-icon>
      </v-btn>
    </div>

    <transition name="fade">
      <div v-if="uiState.viewMode === 'first-person'" class="hud">
        <div>WASD / QE 移动 · 鼠标拖拽视角</div>
        <div>位置 X {{ hudState.x.toFixed(2) }} · Y {{ hudState.y.toFixed(2) }} · Z {{ hudState.z.toFixed(2) }}</div>
        <div>朝向 {{ hudHeadingLabel }}</div>
      </div>
    </transition>

    <transition name="fade">
      <div v-if="uiState.loading || uiState.error" class="overlay">
        <div class="overlay-card" :class="{ error: !!uiState.error }">
          <v-progress-circular
            v-if="uiState.loading && !uiState.error"
            indeterminate
            color="primary"
            size="46"
          />
          <v-icon v-else size="44" color="error">mdi-alert-circle-outline</v-icon>
          <div class="overlay-title">
            {{ uiState.error ? '无法加载场景' : '加载场景' }}
          </div>
          <div class="overlay-message">
            {{ uiState.error || uiState.message }}
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import * as THREE from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { FirstPersonControls } from 'three/examples/jsm/controls/FirstPersonControls.js'
import type { ScenePreviewSnapshot } from '@/utils/previewChannel'
import { subscribeToScenePreview, readStoredScenePreviewSnapshot } from '@/utils/previewChannel'
import type { SceneCameraState } from '@/types/scene-camera-state'
import { buildSceneGraph } from '@schema/sceneGraph';

const FIRST_PERSON_EYE_HEIGHT = 1.6
const FIRST_PERSON_VERTICAL_SPEED = 4

const containerRef = ref<HTMLDivElement | null>(null)

const uiState = reactive({
  sceneName: 'Scene Preview',
  loading: true,
  message: '等待保存当前场景…',
  error: '',
  viewMode: 'map' as 'map' | 'first-person',
  isPlaying: true,
  audioMuted: false,
  masterVolume: 1,
  isFullscreen: false,
})

const hudState = reactive({
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
})

const hudHeadingLabel = computed(() => `${THREE.MathUtils.euclideanModulo(hudState.heading, 360).toFixed(0)}°`)

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let mapControls: MapControls | null = null
let firstPersonControls: FirstPersonControls | null = null
let audioListener: THREE.AudioListener | null = null
let currentRoot: THREE.Object3D | null = null
let animationMixers: THREE.AnimationMixer[] = []
let animationActions: THREE.AnimationAction[] = []
let resizeObserver: ResizeObserver | null = null
let animationFrameId = 0
let buildRequestId = 0
let unsubscribe: (() => void) | null = null
let hasCameraAnchor = false
let lastSceneId: string | null = null
let lastRevision = 0
const clock = new THREE.Clock()
const firstPersonVertical = { direction: 0 }
const tempDirection = new THREE.Vector3()
const fitBox = new THREE.Box3()
const fitCenter = new THREE.Vector3()
const fitSize = new THREE.Vector3()

function initRenderer() {
  const host = containerRef.value
  if (!host) {
    return
  }

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(host.clientWidth, host.clientHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  host.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x06090f)

  camera = new THREE.PerspectiveCamera(60, host.clientWidth / host.clientHeight, 0.1, 2000)
  camera.position.set(8, 4.5, 8)
  camera.lookAt(0, 1.2, 0)
  camera.up.set(0, 1, 0)

  audioListener = new THREE.AudioListener()
  camera.add(audioListener)
  applyMasterVolume()

  mapControls = new MapControls(camera, renderer.domElement)
  mapControls.enableDamping = true
  mapControls.dampingFactor = 0.12
  mapControls.enablePan = true
  mapControls.enableRotate = true
  mapControls.maxDistance = 500
  mapControls.update()

  firstPersonControls = new FirstPersonControls(camera, renderer.domElement)
  firstPersonControls.lookSpeed = 0.08
  firstPersonControls.movementSpeed = 6
  firstPersonControls.enabled = false
  firstPersonControls.heightSpeed = false
  firstPersonControls.verticalMin = THREE.MathUtils.degToRad(2)
  firstPersonControls.verticalMax = THREE.MathUtils.degToRad(178)

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.35)
  scene.add(ambientLight)
  const sun = new THREE.DirectionalLight(0xffffff, 0.7)
  sun.position.set(20, 35, 18)
  sun.castShadow = true
  scene.add(sun)

  renderer.domElement.addEventListener('dblclick', toggleFullscreen)

  resizeObserver = new ResizeObserver(() => handleResize())
  resizeObserver.observe(host)
}

function disposeRenderer() {
  resizeObserver?.disconnect()
  resizeObserver = null

  if (renderer) {
    renderer.domElement.removeEventListener('dblclick', toggleFullscreen)
    renderer.dispose()
    renderer.forceContextLoss?.()
    renderer.domElement.remove()
    renderer = null
  }

  animationActions = []
  animationMixers = []
  disposeCurrentSceneRoot()
  scene = null
  camera = null
  mapControls = null
  if (firstPersonControls) {
    firstPersonControls.dispose()
    firstPersonControls = null
  }
  audioListener = null
}

function handleResize() {
  const host = containerRef.value
  if (!renderer || !camera || !host) {
    return
  }
  const width = host.clientWidth
  const height = host.clientHeight
  renderer.setSize(width, height)
  camera.aspect = width / Math.max(height, 1)
  camera.updateProjectionMatrix()
  mapControls?.update()
  firstPersonControls?.handleResize()
}

function startLoop() {
  clock.start()
  animationFrameId = requestAnimationFrame(loop)
}

function stopLoop() {
  cancelAnimationFrame(animationFrameId)
}

function loop() {
  animationFrameId = requestAnimationFrame(loop)
  if (!renderer || !scene || !camera) {
    return
  }

  const delta = Math.min(clock.getDelta(), 0.1)

  if (uiState.viewMode === 'map') {
    mapControls?.update()
  } else if (uiState.viewMode === 'first-person') {
    updateFirstPerson(delta)
  }

  if (uiState.isPlaying) {
    animationMixers.forEach((mixer) => mixer.update(delta))
  }

  renderer.render(scene, camera)
}

function updateFirstPerson(delta: number) {
  if (!firstPersonControls || !camera) {
    return
  }
  firstPersonControls.update(delta)
  if (firstPersonVertical.direction !== 0) {
    camera.position.y += firstPersonVertical.direction * FIRST_PERSON_VERTICAL_SPEED * delta
  }
  if (camera.position.y < FIRST_PERSON_EYE_HEIGHT) {
    camera.position.y = FIRST_PERSON_EYE_HEIGHT
  }
  camera.rotation.z = 0
  updateHud()
}

function updateHud() {
  if (!camera) {
    return
  }
  hudState.x = camera.position.x
  hudState.y = camera.position.y
  hudState.z = camera.position.z
  camera.getWorldDirection(tempDirection)
  hudState.heading = THREE.MathUtils.radToDeg(Math.atan2(tempDirection.x, tempDirection.z))
}

function togglePlayback() {
  uiState.isPlaying = !uiState.isPlaying
  animationActions.forEach((action) => {
    action.paused = !uiState.isPlaying
  })
}

function toggleViewMode() {
  if (uiState.viewMode === 'map') {
    enterFirstPerson()
  } else {
    exitFirstPerson()
  }
}

function enterFirstPerson() {
  if (!camera || !firstPersonControls) {
    return
  }
  uiState.viewMode = 'first-person'
  mapControls?.saveState()
  if (mapControls) {
    mapControls.enabled = false
  }
  firstPersonControls.enabled = true
  camera.position.y = Math.max(camera.position.y, FIRST_PERSON_EYE_HEIGHT)
  updateHud()
}

function exitFirstPerson() {
  uiState.viewMode = 'map'
  firstPersonVertical.direction = 0
  if (firstPersonControls) {
    firstPersonControls.enabled = false
  }
  if (mapControls) {
    mapControls.enabled = true
    mapControls.update()
  }
}

function toggleAudio() {
  uiState.audioMuted = !uiState.audioMuted
  applyMasterVolume()
}

function applyMasterVolume() {
  if (!audioListener) {
    return
  }
  const volume = uiState.audioMuted ? 0 : uiState.masterVolume
  audioListener.setMasterVolume(volume)
}

watch(() => uiState.masterVolume, applyMasterVolume)
watch(() => uiState.audioMuted, applyMasterVolume)

function toggleFullscreen() {
  const host = containerRef.value
  if (!host) {
    return
  }
  if (!document.fullscreenElement) {
    void host.requestFullscreen().catch(() => undefined)
  } else {
    void document.exitFullscreen().catch(() => undefined)
  }
}

function handleFullscreenChange() {
  uiState.isFullscreen = Boolean(document.fullscreenElement)
  nextTick(() => handleResize())
}

function captureScreenshot() {
  if (!renderer || !scene || !camera) {
    return
  }
  renderer.render(scene, camera)
  const canvas = renderer.domElement
  const fileName = `${sanitizeFileName(uiState.sceneName)}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
  if (canvas.toBlob) {
    canvas.toBlob((blob) => {
      if (!blob) {
        return
      }
      downloadBlob(blob, fileName)
    }, 'image/png')
    return
  }
  const dataUrl = canvas.toDataURL('image/png')
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  requestAnimationFrame(() => URL.revokeObjectURL(url))
}

function sanitizeFileName(name: string): string {
  const trimmed = name.trim() || 'scene'
  return trimmed.replace(/[^a-zA-Z0-9-_]+/g, '_')
}

function disposeCurrentSceneRoot() {
  if (!scene || !currentRoot) {
    return
  }
  scene.remove(currentRoot)
  currentRoot.traverse((child) => {
    const mesh = child as unknown as THREE.Mesh
    if (mesh.isMesh) {
      mesh.geometry?.dispose?.()
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material) => material?.dispose?.())
      } else {
        mesh.material?.dispose?.()
      }
    }
    if ((child as unknown as { dispose?: () => void }).dispose) {
      try {
        ;(child as unknown as { dispose: () => void }).dispose()
      } catch (_error) {
        /* noop */
      }
    }
  })
  currentRoot = null
  animationMixers = []
  animationActions = []
}

async function applySnapshot(snapshot: ScenePreviewSnapshot) {
  if (snapshot.revision <= lastRevision) {
    return
  }
  lastRevision = snapshot.revision
  if (snapshot.sceneId !== lastSceneId) {
    hasCameraAnchor = false
    lastSceneId = snapshot.sceneId
  }
  const requestId = ++buildRequestId
  uiState.loading = true
  uiState.error = ''
  uiState.message = `加载 ${snapshot.sceneName}…`
  uiState.sceneName = snapshot.sceneName
  try {
    const { root, warnings } = await buildSceneGraph(snapshot.document, { enableGround: true })
    if (requestId !== buildRequestId) {
      root.traverse((node: THREE.Object3D) => {
        const mesh = node as unknown as THREE.Mesh
        if (mesh.isMesh) {
          mesh.geometry?.dispose?.()
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((material) => material?.dispose?.())
          } else {
            mesh.material?.dispose?.()
          }
        }
      })
      return
    }
    installSceneRoot(root, snapshot)
    if (warnings.length) {
      console.warn('[ScenePreview] Build warnings', warnings)
    }
    uiState.loading = false
    uiState.message = ''
  } catch (error) {
    if (requestId !== buildRequestId) {
      return
    }
    console.error('Failed to build preview scene', error)
    uiState.error = (error as Error)?.message ?? '未知错误'
    uiState.loading = false
  }
}

function installSceneRoot(root: THREE.Object3D, snapshot: ScenePreviewSnapshot) {
  if (!scene) {
    return
  }
  disposeCurrentSceneRoot()
  currentRoot = root
  scene.add(root)
  prepareAnimations(root)
  refreshCameraAnchor(snapshot)
}

function prepareAnimations(root: THREE.Object3D) {
  animationMixers = []
  animationActions = []
  root.traverse((object) => {
    const clips = (object as unknown as { animations?: THREE.AnimationClip[] }).animations
    if (clips && clips.length) {
      const mixer = new THREE.AnimationMixer(object)
      clips.forEach((clip) => {
        const action = mixer.clipAction(clip)
        action.play()
        animationActions.push(action)
      })
      animationMixers.push(mixer)
    }
  })
}

function refreshCameraAnchor(snapshot: ScenePreviewSnapshot) {
  if (!camera || !mapControls) {
    return
  }
  if (!hasCameraAnchor && snapshot.camera) {
    applyCameraState(snapshot.camera)
    hasCameraAnchor = true
    return
  }
  if (!hasCameraAnchor && currentRoot) {
    fitBox.setFromObject(currentRoot)
    if (!fitBox.isEmpty()) {
      fitBox.getCenter(fitCenter)
      fitBox.getSize(fitSize)
      const radius = fitSize.length() || 6
      camera.position.copy(fitCenter.clone().add(new THREE.Vector3(radius * 0.8, radius * 0.6, radius * 0.8)))
      camera.lookAt(fitCenter)
      mapControls.target.copy(fitCenter)
      mapControls.update()
      hasCameraAnchor = true
    }
  }
}

function applyCameraState(state: SceneCameraState) {
  if (!camera || !mapControls) {
    return
  }
  camera.position.set(state.position.x, state.position.y, state.position.z)
  camera.lookAt(state.target.x, state.target.y, state.target.z)
  if (state.fov && camera instanceof THREE.PerspectiveCamera) {
    camera.fov = state.fov
    camera.updateProjectionMatrix()
  }
  mapControls.target.set(state.target.x, state.target.y, state.target.z)
  mapControls.update()
}

function queueSnapshot(snapshot: ScenePreviewSnapshot) {
  void applySnapshot(snapshot)
}

function handleKeyDown(event: KeyboardEvent) {
  if (uiState.viewMode !== 'first-person') {
    return
  }
  if (event.code === 'KeyQ') {
    firstPersonVertical.direction = 1
    event.preventDefault()
  } else if (event.code === 'KeyE') {
    firstPersonVertical.direction = -1
    event.preventDefault()
  }
}

function handleKeyUp(event: KeyboardEvent) {
  if (event.code === 'KeyQ' || event.code === 'KeyE') {
    firstPersonVertical.direction = 0
  }
}

onMounted(() => {
  initRenderer()
  startLoop()
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  window.addEventListener('keydown', handleKeyDown, { passive: false })
  window.addEventListener('keyup', handleKeyUp)

  const stored = readStoredScenePreviewSnapshot()
  if (stored) {
    queueSnapshot(stored)
  }

  unsubscribe = subscribeToScenePreview((snapshot) => {
    queueSnapshot(snapshot)
  })
})

onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribe = null
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keyup', handleKeyUp)
  stopLoop()
  disposeRenderer()
})
</script>

<style scoped>
.preview-view {
  position: relative;
  width: 100%;
  height: 100vh;
  background: #04070b;
  overflow: hidden;
}

.canvas-host {
  width: 100%;
  height: 100%;
}

.control-bar {
  position: absolute;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-radius: 999px;
  background: rgba(10, 14, 22, 0.74);
  border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(18px);
  color: #f0f3ff;
  z-index: 5;
}

.scene-name {
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.78rem;
  opacity: 0.85;
}

.volume-slider {
  width: 120px;
  padding-inline: 6px;
}

.hud {
  position: absolute;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 18px;
  border-radius: 16px;
  background: rgba(10, 14, 22, 0.74);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #f0f3ff;
  font-size: 0.82rem;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 5;
  text-align: center;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 7, 12, 0.78);
  backdrop-filter: blur(16px);
  z-index: 6;
}

.overlay-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 26px 38px;
  border-radius: 18px;
  background: rgba(12, 16, 24, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #f5f6fb;
  text-align: center;
}

.overlay-card.error {
  border-color: rgba(244, 67, 54, 0.4);
}

.overlay-title {
  font-weight: 600;
  letter-spacing: 0.06em;
}

.overlay-message {
  max-width: 320px;
  opacity: 0.78;
  line-height: 1.4;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 160ms ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 768px) {
  .control-bar {
    flex-wrap: wrap;
    gap: 10px;
    padding: 12px 16px;
  }

  .volume-slider {
    width: 100px;
  }

  .hud {
    top: 16px;
    font-size: 0.75rem;
  }
}
</style>
