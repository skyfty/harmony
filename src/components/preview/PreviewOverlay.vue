<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { Sky } from 'three/addons/objects/Sky.js'
import type { SceneSkyboxSettings } from '@/types/scene-viewport-settings'
import { cloneSkyboxSettings, DEFAULT_SKYBOX_SETTINGS } from '@/stores/skyboxPresets'

type CameraSeed = {
  position: THREE.Vector3Like
  target: THREE.Vector3Like
}

const props = defineProps<{
  src: string
  sceneName: string
  cameraSeed?: CameraSeed | null
  skyboxSettings?: SceneSkyboxSettings | null
}>()

const emit = defineEmits<{
  (event: 'ready'): void
  (event: 'close'): void
  (event: 'error', message: string): void
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const state = reactive({
  isLoading: true,
  progress: 0,
  error: '' as string | null,
  isPlaying: true,
  viewMode: 'orbit' as 'orbit' | 'first-person',
  pointerLocked: false,
  audioEnabled: false,
  isFullscreen: false,
  showLockPrompt: false,
})
const hud = reactive({
  position: new THREE.Vector3(),
  heading: 0,
})

const headingDegrees = computed(() => `${THREE.MathUtils.radToDeg(hud.heading).toFixed(0)}°`)
const progressPercent = computed(() => Math.round(state.progress * 100))
const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let orbitControls: OrbitControls | null = null
let pointerControls: PointerLockControls | null = null
let animationMixer: THREE.AnimationMixer | null = null
let animationActions: THREE.AnimationAction[] = []
let currentSceneRoot: THREE.Object3D | null = null
const clock = new THREE.Clock()
let animationFrameId = 0
let currentLoadToken = 0
const pressedKeys = new Set<string>()
let ambientContext: AudioContext | null = null
let ambientSource: AudioBufferSourceNode | null = null
let sky: Sky | null = null
let pmremGenerator: THREE.PMREMGenerator | null = null
let skyEnvironmentTarget: THREE.WebGLRenderTarget | null = null
let fallbackDirectionalLight: THREE.DirectionalLight | null = null
let ambientLight: THREE.AmbientLight | null = null
const skySunPosition = new THREE.Vector3()
let pendingSkyboxSettings: SceneSkyboxSettings | null = null
let currentSkyboxSettings = cloneSkyboxSettings(DEFAULT_SKYBOX_SETTINGS)
let minSceneY = 0

const WALK_SPEED_UNITS_PER_SECOND = 12
const VERTICAL_SPEED_UNITS_PER_SECOND = 8
const SKY_SCALE = 2500
const SKY_ENVIRONMENT_INTENSITY = 0.35
const FALLBACK_AMBIENT_INTENSITY = 0.2
const FALLBACK_DIRECTIONAL_INTENSITY = 0.65
const SKY_FALLBACK_LIGHT_DISTANCE = 75
const FIRST_PERSON_EYE_HEIGHT = 1.7
const FIRST_PERSON_TOGGLE_KEY = 'KeyF'

function reportReady() {
  emit('ready')
}

function handleError(message: string) {
  state.error = message
  emit('error', message)
}

function initRenderer() {
  if (!containerRef.value) {
    return
  }

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(containerRef.value.clientWidth, containerRef.value.clientHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  containerRef.value.appendChild(renderer.domElement)
  pmremGenerator = new THREE.PMREMGenerator(renderer)

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x101419)

  camera = new THREE.PerspectiveCamera(60, containerRef.value.clientWidth / containerRef.value.clientHeight, 0.1, 5000)
  applyCameraSeed(props.cameraSeed ?? null)
  ensureFallbackLighting()
  ensureSkyExists()
  applySkyboxSettings(props.skyboxSettings ?? currentSkyboxSettings)

  orbitControls = new OrbitControls(camera, renderer.domElement)
  orbitControls.enableDamping = true
  orbitControls.enablePan = true
  orbitControls.enableZoom = true
  orbitControls.maxDistance = 2000

  pointerControls = new PointerLockControls(camera, renderer.domElement)
  pointerControls.addEventListener('lock', () => {
    state.pointerLocked = true
    state.showLockPrompt = false
    resetKeyState()
  })
  pointerControls.addEventListener('unlock', () => {
    state.pointerLocked = false
    if (state.viewMode === 'first-person' && !isTouchDevice) {
      state.showLockPrompt = true
    }
    resetKeyState()
  })

  renderer.domElement.addEventListener('click', handleCanvasClick)
}

function disposeRenderer() {
  if (renderer) {
    renderer.domElement.removeEventListener('click', handleCanvasClick)
    renderer.dispose()
    renderer = null
  }
  animationMixer = null
  animationActions = []
  orbitControls = null
  pointerControls = null
  scene = null
  camera = null
  disposeSkyResources()
}

function disposeSceneContent() {
  if (currentSceneRoot && scene) {
    scene.remove(currentSceneRoot)
    currentSceneRoot.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh) {
        mesh.geometry?.dispose()
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((material) => material.dispose?.())
        } else {
          mesh.material?.dispose?.()
        }
      }
    })
  }
  currentSceneRoot = null
  minSceneY = 0
}

function ensureFallbackLighting() {
  if (!scene) {
    return
  }
  if (!ambientLight) {
    ambientLight = new THREE.AmbientLight(0xffffff, FALLBACK_AMBIENT_INTENSITY)
    scene.add(ambientLight)
  }
  if (!fallbackDirectionalLight) {
    fallbackDirectionalLight = new THREE.DirectionalLight(0xffffff, FALLBACK_DIRECTIONAL_INTENSITY)
    fallbackDirectionalLight.castShadow = true
    fallbackDirectionalLight.shadow.mapSize.set(2048, 2048)
    fallbackDirectionalLight.shadow.camera.far = 250
    scene.add(fallbackDirectionalLight)
    scene.add(fallbackDirectionalLight.target)
  }
}

function ensureSkyExists() {
  if (!scene || sky) {
    return
  }
  sky = new Sky()
  sky.name = 'PreviewSky'
  sky.scale.setScalar(SKY_SCALE)
  sky.frustumCulled = false
  scene.add(sky)
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

function updateSkyLighting(settings: SceneSkyboxSettings) {
  if (!sky || !scene) {
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

  if (!pmremGenerator && renderer) {
    pmremGenerator = new THREE.PMREMGenerator(renderer)
  }

  if (!pmremGenerator) {
    return
  }

  if (skyEnvironmentTarget) {
    skyEnvironmentTarget.dispose()
    skyEnvironmentTarget = null
  }

  skyEnvironmentTarget = pmremGenerator.fromScene(sky as unknown as THREE.Scene)
  scene.environment = skyEnvironmentTarget.texture
  scene.environmentIntensity = SKY_ENVIRONMENT_INTENSITY
}

function applySkyboxSettings(settings?: SceneSkyboxSettings | null) {
  const next = cloneSkyboxSettings(settings ?? currentSkyboxSettings)
  currentSkyboxSettings = cloneSkyboxSettings(next)

  if (!scene || !renderer) {
    pendingSkyboxSettings = cloneSkyboxSettings(next)
    return
  }

  ensureFallbackLighting()
  ensureSkyExists()

  if (!sky) {
    pendingSkyboxSettings = cloneSkyboxSettings(next)
    return
  }

  const skyMaterial = sky.material as THREE.ShaderMaterial
  const uniforms = skyMaterial.uniforms

  const assignUniform = (uniformKey: string, value: number) => {
    const uniform = uniforms[uniformKey]
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

  assignUniform('turbidity', next.turbidity)
  assignUniform('rayleigh', next.rayleigh)
  assignUniform('mieCoefficient', next.mieCoefficient)
  assignUniform('mieDirectionalG', next.mieDirectionalG)

  renderer.toneMappingExposure = next.exposure
  updateSkyLighting(next)
  pendingSkyboxSettings = null
}

function disposeSkyResources() {
  if (scene) {
    if (sky) {
      scene.remove(sky)
    }
    if (fallbackDirectionalLight) {
      scene.remove(fallbackDirectionalLight)
      scene.remove(fallbackDirectionalLight.target)
    }
    if (ambientLight) {
      scene.remove(ambientLight)
    }
  }
  sky = null
  fallbackDirectionalLight = null
  ambientLight = null
  if (skyEnvironmentTarget) {
    skyEnvironmentTarget.dispose()
    skyEnvironmentTarget = null
  }
  if (pmremGenerator) {
    pmremGenerator.dispose()
    pmremGenerator = null
  }
}

function applyCameraSeed(seed: CameraSeed | null) {
  if (!camera) {
    return
  }
  if (seed) {
    camera.position.set(seed.position.x, seed.position.y, seed.position.z)
  } else {
    camera.position.set(8, 6, 8)
  }
}

async function loadScene(url: string) {
  if (!scene || !renderer || !camera) {
    return
  }

  state.progress = 0
  state.error = null
  state.isLoading = true

  const manager = new THREE.LoadingManager()
  manager.onProgress = (_item, loaded, total) => {
    state.progress = total > 0 ? loaded / total : 0
  }

  const loader = new GLTFLoader(manager)
  const dracoLoader = new DRACOLoader(manager)
  dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/')
  loader.setDRACOLoader(dracoLoader)

  const loadToken = ++currentLoadToken

  try {
    const gltf = await loader.loadAsync(url)
    if (loadToken !== currentLoadToken) {
      return
    }

    disposeSceneContent()

    const root = gltf.scene
    currentSceneRoot = root

    root.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        const mesh = object as THREE.Mesh
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
      // Removed walkable mesh accumulation from traversal

    scene.add(root)

    if (gltf.animations.length) {
      animationMixer = new THREE.AnimationMixer(root)
      animationActions = gltf.animations.map((clip) => {
        const action = animationMixer!.clipAction(clip)
        action.play()
        return action
      })
    }

    const bounds = new THREE.Box3().setFromObject(root)
    const center = bounds.getCenter(new THREE.Vector3())
    const size = bounds.getSize(new THREE.Vector3())
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 5
    minSceneY = Number.isFinite(bounds.min.y) ? bounds.min.y : 0

    if (!props.cameraSeed) {
      camera.position.copy(center.clone().add(new THREE.Vector3(radius * 1.6, radius * 1.1, radius * 1.6)))
      camera.lookAt(center)
    } else {
      camera.lookAt(props.cameraSeed.target.x, props.cameraSeed.target.y, props.cameraSeed.target.z)
    }

    if (orbitControls) {
      const target = props.cameraSeed
        ? new THREE.Vector3(props.cameraSeed.target.x, props.cameraSeed.target.y, props.cameraSeed.target.z)
        : center
      orbitControls.target.copy(target)
      orbitControls.update()
    }

    state.progress = 1
    state.isLoading = false
    if (pendingSkyboxSettings) {
      applySkyboxSettings(pendingSkyboxSettings)
    } else {
      applySkyboxSettings(currentSkyboxSettings)
    }
    if (state.viewMode === 'first-person') {
      const minHeight = minSceneY + FIRST_PERSON_EYE_HEIGHT
      if (camera.position.y < minHeight) {
        camera.position.y = minHeight
      }
      hud.position.copy(camera.position)
    }
    reportReady()
  } catch (error) {
    console.error('Failed to load preview scene', error)
    state.isLoading = false
    handleError('Failed to load preview scene.')
  } finally {
    dracoLoader.dispose()
  }
}

function animate() {
  animationFrameId = requestAnimationFrame(animate)
  if (!renderer || !scene || !camera) {
    return
  }

  const delta = Math.min(clock.getDelta(), 0.1)

  if (state.viewMode === 'first-person') {
    updateFirstPerson(delta)
  } else if (orbitControls) {
    orbitControls.update()
  }

  if (animationMixer && state.isPlaying) {
    animationMixer.update(delta)
  }

  renderer.render(scene, camera)
}

function updateFirstPerson(delta: number) {
  if (!pointerControls || !camera) {
    return
  }

  const walkSpeed = state.pointerLocked ? WALK_SPEED_UNITS_PER_SECOND : WALK_SPEED_UNITS_PER_SECOND * 0.5
  const verticalSpeed = state.pointerLocked ? VERTICAL_SPEED_UNITS_PER_SECOND : VERTICAL_SPEED_UNITS_PER_SECOND * 0.5
  const distance = walkSpeed * delta

  const forwardInput = (pressedKeys.has('KeyW') ? 1 : 0) - (pressedKeys.has('KeyS') ? 1 : 0)
  if (forwardInput !== 0) {
    pointerControls.moveForward(forwardInput * distance)
  }

  const strafeInput = (pressedKeys.has('KeyD') ? 1 : 0) - (pressedKeys.has('KeyA') ? 1 : 0)
  if (strafeInput !== 0) {
    pointerControls.moveRight(strafeInput * distance)
  }

  const verticalDelta = verticalSpeed * delta
  const controlCamera = camera
  const upKeys = (pressedKeys.has('Space') ? 1 : 0) + (pressedKeys.has('KeyQ') ? 1 : 0)
  const downKeys =
    (pressedKeys.has('ShiftLeft') ? 1 : 0) +
    (pressedKeys.has('ShiftRight') ? 1 : 0) +
    (pressedKeys.has('KeyE') ? 1 : 0)
  const verticalInput = Math.sign(upKeys - downKeys)
  if (verticalInput !== 0) {
    controlCamera.position.y += verticalInput * verticalDelta
  }

  const minHeight = minSceneY + FIRST_PERSON_EYE_HEIGHT
  if (controlCamera.position.y < minHeight) {
    controlCamera.position.y = minHeight
  }

  hud.position.copy(camera.position)
  const look = new THREE.Vector3()
  camera.getWorldDirection(look)
  hud.heading = Math.atan2(look.x, look.z)

  if (!state.pointerLocked && !isTouchDevice) {
    state.showLockPrompt = true
  }
}

function handleResize() {
  if (!renderer || !camera || !containerRef.value) {
    return
  }
  const { clientWidth, clientHeight } = containerRef.value
  camera.aspect = clientWidth / clientHeight
  camera.updateProjectionMatrix()
  renderer.setSize(clientWidth, clientHeight)
}

function isTextInputTarget(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tagName = target.tagName
  if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
    return true
  }
  return target.isContentEditable
}

function onKeyDown(event: KeyboardEvent) {
  if (isTextInputTarget(event.target)) {
    return
  }
  if (event.code === FIRST_PERSON_TOGGLE_KEY) {
    toggleViewMode()
    event.preventDefault()
    return
  }
  if (state.viewMode !== 'first-person') {
    return
  }
  pressedKeys.add(event.code)
  if (event.code === 'Space') {
    event.preventDefault()
  }
}

function onKeyUp(event: KeyboardEvent) {
  pressedKeys.delete(event.code)
}

function resetKeyState() {
  pressedKeys.clear()
}

function handleCanvasClick() {
  if (state.viewMode === 'first-person' && pointerControls && !state.pointerLocked && !isTouchDevice) {
    pointerControls.lock()
  }
}

function togglePlay() {
  state.isPlaying = !state.isPlaying
  animationActions.forEach((action) => {
    action.paused = !state.isPlaying
  })
}

function enterFirstPerson() {
  if (!pointerControls || !camera) {
    return
  }

  state.viewMode = 'first-person'
  state.showLockPrompt = !isTouchDevice
  resetKeyState()
  const minHeight = minSceneY + FIRST_PERSON_EYE_HEIGHT
  if (camera.position.y < minHeight) {
    camera.position.y = minHeight
  }
  hud.position.copy(camera.position)
  if (orbitControls) {
    orbitControls.enabled = false
  }

  if (!isTouchDevice) {
    pointerControls.lock()
  }
}

function exitFirstPerson() {
  state.viewMode = 'orbit'
  state.showLockPrompt = false
  resetKeyState()
  if (pointerControls && state.pointerLocked) {
    pointerControls.unlock()
  }
  if (orbitControls) {
    orbitControls.enabled = true
    orbitControls.target.copy(hud.position)
    orbitControls.update()
  }
}

function toggleViewMode() {
  if (state.viewMode === 'orbit') {
    enterFirstPerson()
  } else {
    exitFirstPerson()
  }
}

function toggleFullscreen() {
  if (!containerRef.value) {
    return
  }
  if (!document.fullscreenElement) {
    void containerRef.value.requestFullscreen()
  } else {
    void document.exitFullscreen()
  }
}

function onFullscreenChange() {
  state.isFullscreen = !!document.fullscreenElement
}

function ensureAmbientAudio() {
  if (ambientContext) {
    void ambientContext.resume()
    return
  }
  ambientContext = new AudioContext()
  const buffer = ambientContext.createBuffer(1, ambientContext.sampleRate * 4, ambientContext.sampleRate)
  const data = buffer.getChannelData(0)
  for (let index = 0; index < data.length; index += 1) {
    data[index] = (Math.random() * 2 - 1) * 0.08
  }
  ambientSource = ambientContext.createBufferSource()
  ambientSource.buffer = buffer
  ambientSource.loop = true
  const gain = ambientContext.createGain()
  gain.gain.value = 0.1
  ambientSource.connect(gain).connect(ambientContext.destination)
  ambientSource.start()
}

function stopAmbientAudio() {
  ambientSource?.stop()
  ambientSource = null
  if (ambientContext) {
    ambientContext.close().catch(() => undefined)
    ambientContext = null
  }
}

function toggleAudio() {
  state.audioEnabled = !state.audioEnabled
  if (state.audioEnabled) {
    ensureAmbientAudio()
  } else {
    stopAmbientAudio()
  }
}

function cleanupAudio() {
  state.audioEnabled = false
  stopAmbientAudio()
}

function handleClose() {
  if (pointerControls && state.pointerLocked) {
    pointerControls.unlock()
  }
  resetKeyState()
  emit('close')
}

watch(
  () => props.src,
  (next) => {
    if (!next) {
      handleError('No preview source provided.')
      return
    }
    if (!scene) {
      return
    }
    void loadScene(next)
  }
)

watch(
  () => props.skyboxSettings,
  (settings) => {
    applySkyboxSettings(settings ?? currentSkyboxSettings)
  },
  { deep: true }
)

watch(
  () => props.cameraSeed,
  (seed) => {
    applyCameraSeed(seed ?? null)
    if (seed && orbitControls) {
      orbitControls.target.set(seed.target.x, seed.target.y, seed.target.z)
      orbitControls.update()
    }
  }
)

onMounted(() => {
  currentSkyboxSettings = cloneSkyboxSettings(props.skyboxSettings ?? DEFAULT_SKYBOX_SETTINGS)
  if (!props.src) {
    handleError('No preview source provided.')
    return
  }

  initRenderer()
  animate()
  void loadScene(props.src)

  window.addEventListener('resize', handleResize)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', resetKeyState)
  document.addEventListener('fullscreenchange', onFullscreenChange)
})

onBeforeUnmount(() => {
  if (pointerControls && state.pointerLocked) {
    pointerControls.unlock()
  }
  cancelAnimationFrame(animationFrameId)
  cleanupAudio()
  resetKeyState()
  window.removeEventListener('resize', handleResize)
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', resetKeyState)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  disposeRenderer()
  disposeSceneContent()
})
</script>

<template>
  <div class="preview-overlay">
    <div ref="containerRef" class="canvas-container" />

    <v-btn
      class="close-button"
      icon
      variant="tonal"
      color="primary"
      density="comfortable"
      @click="handleClose"
    >
      <v-icon>mdi-close</v-icon>
    </v-btn>

    <transition name="fade">
      <div v-if="state.isLoading" class="loading-overlay">
        <div class="loading-card">
          <div class="loading-title">Loading {{ props.sceneName }}</div>
          <v-progress-linear :model-value="progressPercent" color="primary" height="8" rounded />
          <div class="loading-percent">{{ progressPercent }}%</div>
        </div>
      </div>
    </transition>

    <transition name="fade">
      <div v-if="state.error" class="error-overlay">
        <div class="error-card">
          <v-icon size="38" color="error">mdi-alert-circle-outline</v-icon>
          <div class="error-title">Preview Unavailable</div>
          <p class="error-message">{{ state.error }}</p>
          <v-btn color="primary" variant="tonal" @click="handleClose">
            Close
          </v-btn>
        </div>
      </div>
    </transition>

    <div v-if="!state.isLoading && !state.error" class="control-bar">
      <div class="control-name">{{ props.sceneName }}</div>
      <v-btn
        icon
        variant="tonal"
        color="primary"
        density="comfortable"
        @click="togglePlay"
      >
        <v-icon>{{ state.isPlaying ? 'mdi-pause' : 'mdi-play' }}</v-icon>
      </v-btn>
      <v-btn
        variant="tonal"
        color="primary"
        density="comfortable"
        @click="toggleViewMode"
      >
        <v-icon start>{{ state.viewMode === 'orbit' ? 'mdi-walk' : 'mdi-orbit-variant' }}</v-icon>
        {{ state.viewMode === 'orbit' ? 'First Person (F)' : 'Orbit (F)' }}
      </v-btn>
      <v-btn
        icon
        variant="tonal"
        color="primary"
        density="comfortable"
        @click="toggleFullscreen"
      >
        <v-icon>{{ state.isFullscreen ? 'mdi-fullscreen-exit' : 'mdi-fullscreen' }}</v-icon>
      </v-btn>
      <v-btn
        icon
        variant="tonal"
        color="primary"
        density="comfortable"
        @click="toggleAudio"
      >
        <v-icon>{{ state.audioEnabled ? 'mdi-volume-high' : 'mdi-volume-off' }}</v-icon>
      </v-btn>
    </div>

    <transition name="fade">
      <div
        v-if="state.viewMode === 'first-person' && state.showLockPrompt && !isTouchDevice"
        class="lock-overlay"
        @click="handleCanvasClick"
      >
        <div class="lock-card">
          <v-icon size="48">mdi-mouse</v-icon>
          <span>Click to enable pointer controls</span>
        </div>
      </div>
    </transition>

    <transition name="slide-down">
      <div v-if="state.viewMode === 'first-person' && !state.error" class="hud-panel">
        <div class="hud-line">Position · X {{ hud.position.x.toFixed(2) }} Y {{ hud.position.y.toFixed(2) }} Z {{ hud.position.z.toFixed(2) }}</div>
        <div class="hud-line">Heading · {{ headingDegrees }}</div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.preview-overlay {
  position: relative;
  width: 100%;
  height: 100%;
  background: #050608;
  overflow: hidden;
}

.canvas-container {
  width: 100%;
  height: 100%;
}

.close-button {
  position: absolute;
  top: 20px;
  right: 24px;
  z-index: 5;
  background: rgba(10, 14, 22, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.loading-overlay,
.error-overlay,
.lock-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 6, 8, 0.82);
  backdrop-filter: blur(14px);
  z-index: 4;
}

.lock-overlay {
  background: rgba(8, 10, 18, 0.65);
}

.loading-card,
.error-card,
.lock-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px 36px;
  border-radius: 18px;
  background: rgba(18, 20, 28, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #f5f6fb;
  text-align: center;
}

.loading-title {
  font-weight: 600;
  letter-spacing: 0.04em;
}

.loading-percent {
  font-size: 0.9rem;
  opacity: 0.75;
}

.error-title {
  font-size: 1.3rem;
  font-weight: 600;
}

.error-message {
  margin: 0;
  opacity: 0.8;
  max-width: 320px;
}

.control-bar {
  position: absolute;
  left: 50%;
  bottom: 32px;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px 20px;
  border-radius: 999px;
  background: rgba(10, 14, 22, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(16px);
  color: #f4f6fb;
  z-index: 3;
}

.control-name {
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-size: 0.76rem;
  opacity: 0.92;
}

.hud-panel {
  position: absolute;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 18px;
  border-radius: 16px;
  background: rgba(10, 14, 22, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #f5f6fb;
  font-size: 0.85rem;
  z-index: 3;
}

.hud-line {
  white-space: nowrap;
  letter-spacing: 0.04em;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 160ms ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 180ms ease;
}

.slide-down-enter-from,
.slide-down-leave-to {
  transform: translate(-50%, -16px);
  opacity: 0;
}

@media (max-width: 768px) {
  .control-bar {
    flex-wrap: wrap;
    padding: 12px 16px;
    gap: 10px;
  }

  .hud-panel {
    top: 16px;
    font-size: 0.78rem;
  }
}
</style>
