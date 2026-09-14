import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  createGradientBackgroundDome,
  disposeGradientBackgroundDome,
  type GradientBackgroundDome,
} from '@schema/gradientBackground'
import {
  DEFAULT_ENVIRONMENT_AMBIENT_COLOR,
  DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY,
  DEFAULT_ENVIRONMENT_BACKGROUND_COLOR,
  DEFAULT_ENVIRONMENT_GRADIENT_EXPONENT,
  DEFAULT_ENVIRONMENT_GRADIENT_OFFSET,
} from '@schema/environmentSettingsUtils'
import {
  DEFAULT_COLOR,
  DEFAULT_INTENSITY,
  DEFAULT_SHADOW_BIAS_DIRECTIONAL,
  DEFAULT_SHADOW_MAP_SIZE_DIRECTIONAL,
  DEFAULT_SHADOW_NORMAL_BIAS,
  DEFAULT_SHADOW_RADIUS,
} from '@schema/lightDefaults'
import {
  DEFAULT_SCENE_CSM_SUN_AZIMUTH_DEG,
  DEFAULT_SCENE_CSM_SUN_ELEVATION_DEG,
} from '@schema/sceneCsmDefaults'
import { PIPELINE_MODES, type CameraViewId, type HelperSettings, type PipelineMode } from '../types'

export type StageBackgroundMode = 'engine' | 'gradient' | 'transparent' | 'hdri'
export type StageToneMapping = 'none' | 'aces' | 'agx' | 'neutral' | 'reinhard' | 'linear'

export type StageSettings = {
  ambientColor: string
  ambientIntensity: number
  sunColor: string
  sunIntensity: number
  sunAzimuthDeg: number
  sunElevationDeg: number
  shadows: boolean
  background: StageBackgroundMode
  backgroundColor: string
  gradientTopColor: string
  gradientOffset: number
  gradientExponent: number
  environmentIntensity: number
  toneMapping: StageToneMapping
  exposure: number
  grid: boolean
  axes: boolean
}

export const DEFAULT_STAGE_SETTINGS: StageSettings = {
  ambientColor: DEFAULT_ENVIRONMENT_AMBIENT_COLOR,
  ambientIntensity: DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY,
  sunColor: DEFAULT_COLOR,
  sunIntensity: DEFAULT_INTENSITY,
  sunAzimuthDeg: DEFAULT_SCENE_CSM_SUN_AZIMUTH_DEG,
  sunElevationDeg: DEFAULT_SCENE_CSM_SUN_ELEVATION_DEG,
  shadows: true,
  background: 'engine',
  backgroundColor: DEFAULT_ENVIRONMENT_BACKGROUND_COLOR,
  gradientTopColor: '#1b2433',
  gradientOffset: DEFAULT_ENVIRONMENT_GRADIENT_OFFSET,
  gradientExponent: DEFAULT_ENVIRONMENT_GRADIENT_EXPONENT,
  environmentIntensity: 1,
  toneMapping: 'none',
  exposure: 1,
  grid: true,
  axes: true,
}

export const TONE_MAPPING_OPTIONS: Array<{ id: StageToneMapping; label: string }> = [
  { id: 'none', label: 'None（引擎默认）' },
  { id: 'aces', label: 'ACESFilmic' },
  { id: 'agx', label: 'AgX' },
  { id: 'neutral', label: 'Neutral' },
  { id: 'reinhard', label: 'Reinhard' },
  { id: 'linear', label: 'Linear' },
]

export const BACKGROUND_OPTIONS: Array<{ id: StageBackgroundMode; label: string }> = [
  { id: 'engine', label: '引擎纯色' },
  { id: 'gradient', label: '引擎渐变' },
  { id: 'transparent', label: '透明棋盘' },
  { id: 'hdri', label: 'HDR / EXR 环境贴图' },
]

const TONE_MAPPING_BY_ID: Record<StageToneMapping, THREE.ToneMapping> = {
  none: THREE.NoToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  linear: THREE.LinearToneMapping,
}

type PaneRuntime = {
  mode: PipelineMode
  scene: THREE.Scene
  ambient: THREE.AmbientLight
  sun: THREE.DirectionalLight
  sunTarget: THREE.Object3D
  gradientDome: GradientBackgroundDome | null
  model: THREE.Object3D | null
  modelBounds: THREE.Box3
  grid: THREE.GridHelper | null
  gridSize: number
  axes: THREE.AxesHelper | null
  boundsHelper: THREE.Box3Helper | null
  skeletonHelper: THREE.SkeletonHelper | null
  boundsTarget: THREE.Object3D | null
}

export type FrameStats = {
  fps: number
  drawCalls: number
  triangles: number
  textures: number
}

export type LayoutOptions = {
  split: boolean
  mode: PipelineMode
}

function findByTraversalIndex(root: THREE.Object3D, index: number): THREE.Object3D | null {
  let counter = 0
  let found: THREE.Object3D | null = null
  root.traverse((child) => {
    if (found) {
      return
    }
    if (counter === index) {
      found = child
    }
    counter += 1
  })
  return found
}

/** Engine CSM sun direction convention (schema/sceneCsm.ts). */
function resolveSunDirection(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const azimuth = THREE.MathUtils.degToRad(azimuthDeg)
  const elevation = THREE.MathUtils.degToRad(elevationDeg)
  const cosElevation = Math.cos(elevation)
  return new THREE.Vector3(
    Math.sin(azimuth) * cosElevation,
    Math.sin(elevation),
    Math.cos(azimuth) * cosElevation,
  ).normalize()
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls

  private readonly container: HTMLElement
  private readonly clock = new THREE.Clock()
  private readonly panes: Record<PipelineMode, PaneRuntime>
  private readonly frameListeners = new Set<(delta: number, elapsed: number) => void>()
  private readonly resizeObserver: ResizeObserver
  private settings: StageSettings = { ...DEFAULT_STAGE_SETTINGS }
  private layout: LayoutOptions = { split: false, mode: 'engine' }
  private environmentTexture: THREE.Texture | null = null
  private animationHandle = 0
  private disposed = false
  private fpsSamples: number[] = []
  private fps = 0
  private viewportWidth = 1
  private viewportHeight = 1

  constructor(container: HTMLElement) {
    this.container = container
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.domElement.classList.add('stage-canvas')
    container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000)
    this.camera.position.set(4, 3, 6)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = false
    this.controls.screenSpacePanning = true
    this.controls.maxPolarAngle = Math.PI
    this.controls.target.set(0, 1, 0)

    this.panes = {
      engine: this.createPane('engine'),
      native: this.createPane('native'),
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.handleResize()
    })
    this.resizeObserver.observe(container)
    this.handleResize()
    this.applySettings()
  }

  private createPane(mode: PipelineMode): PaneRuntime {
    const scene = new THREE.Scene()
    scene.name = `HarmonyModelInspector:${mode}`

    const ambient = new THREE.AmbientLight(DEFAULT_ENVIRONMENT_AMBIENT_COLOR, DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY)
    ambient.name = 'InspectorAmbientLight'

    const sun = new THREE.DirectionalLight(DEFAULT_COLOR, DEFAULT_INTENSITY)
    sun.name = 'InspectorSunLight'
    sun.castShadow = true
    sun.shadow.mapSize.set(DEFAULT_SHADOW_MAP_SIZE_DIRECTIONAL, DEFAULT_SHADOW_MAP_SIZE_DIRECTIONAL)
    sun.shadow.bias = DEFAULT_SHADOW_BIAS_DIRECTIONAL
    sun.shadow.normalBias = DEFAULT_SHADOW_NORMAL_BIAS
    sun.shadow.radius = DEFAULT_SHADOW_RADIUS

    const sunTarget = new THREE.Object3D()
    sunTarget.name = 'InspectorSunTarget'
    sun.target = sunTarget

    scene.add(ambient)
    scene.add(sun)
    scene.add(sunTarget)

    return {
      mode,
      scene,
      ambient,
      sun,
      sunTarget,
      gradientDome: null,
      model: null,
      modelBounds: new THREE.Box3(),
      grid: null,
      gridSize: 0,
      axes: null,
      boundsHelper: null,
      skeletonHelper: null,
      boundsTarget: null,
    }
  }

  start(): void {
    if (this.animationHandle) {
      return
    }
    const loop = (): void => {
      if (this.disposed) {
        return
      }
      const delta = this.clock.getDelta()
      const elapsed = this.clock.elapsedTime
      this.updateFps(delta)
      for (const listener of this.frameListeners) {
        listener(delta, elapsed)
      }
      this.controls.update()
      this.renderFrame()
      this.animationHandle = requestAnimationFrame(loop)
    }
    this.animationHandle = requestAnimationFrame(loop)
  }

  onFrame(listener: (delta: number, elapsed: number) => void): () => void {
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  private updateFps(delta: number): void {
    if (delta <= 0) {
      return
    }
    this.fpsSamples.push(delta)
    if (this.fpsSamples.length > 30) {
      this.fpsSamples.shift()
    }
    const total = this.fpsSamples.reduce((sum, value) => sum + value, 0)
    this.fps = total > 0 ? this.fpsSamples.length / total : 0
  }

  getFrameStats(): FrameStats {
    const info = this.renderer.info
    return {
      fps: this.fps,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      textures: info.memory.textures,
    }
  }

  handleResize(): void {
    const width = Math.max(1, Math.floor(this.container.clientWidth))
    const height = Math.max(1, Math.floor(this.container.clientHeight))
    this.viewportWidth = width
    this.viewportHeight = height
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  applySettings(next?: Partial<StageSettings>): void {
    this.settings = { ...this.settings, ...(next ?? {}) }
    const settings = this.settings

    this.renderer.toneMapping = TONE_MAPPING_BY_ID[settings.toneMapping]
    this.renderer.toneMappingExposure = settings.exposure
    this.renderer.shadowMap.enabled = settings.shadows

    for (const mode of PIPELINE_MODES) {
      const pane = this.panes[mode]
      pane.ambient.color.set(settings.ambientColor)
      pane.ambient.intensity = settings.ambientIntensity
      pane.sun.color.set(settings.sunColor)
      pane.sun.intensity = settings.sunIntensity
      pane.sun.castShadow = settings.shadows
      pane.scene.environmentIntensity = settings.environmentIntensity
      this.applyBackground(pane)
      this.updateHelpers(pane)
    }
    this.updateSunPlacement()
  }

  getSettings(): StageSettings {
    return { ...this.settings }
  }

  private applyBackground(pane: PaneRuntime): void {
    const settings = this.settings

    if (settings.background === 'gradient') {
      if (!pane.gradientDome) {
        pane.gradientDome = createGradientBackgroundDome({
          topColor: settings.gradientTopColor,
          bottomColor: settings.backgroundColor,
          offset: settings.gradientOffset,
          exponent: settings.gradientExponent,
        })
        pane.gradientDome.mesh.raycast = () => {}
        pane.scene.add(pane.gradientDome.mesh)
      } else {
        pane.gradientDome.uniforms.topColor.value.set(settings.gradientTopColor)
        pane.gradientDome.uniforms.bottomColor.value.set(settings.backgroundColor)
        pane.gradientDome.uniforms.offset.value = settings.gradientOffset
        pane.gradientDome.uniforms.exponent.value = settings.gradientExponent
      }
      pane.scene.background = null
    } else if (settings.background === 'hdri') {
      pane.scene.background = this.environmentTexture
    } else if (settings.background === 'transparent') {
      pane.scene.background = null
    } else {
      pane.scene.background = new THREE.Color(settings.backgroundColor)
    }

    if (settings.background !== 'gradient' && pane.gradientDome) {
      disposeGradientBackgroundDome(pane.gradientDome)
      pane.gradientDome = null
    }

    pane.scene.environment = this.environmentTexture
  }

  setEnvironmentTexture(texture: THREE.Texture | null, previous?: THREE.Texture | null): void {
    this.environmentTexture = texture
    if (previous && previous !== texture) {
      previous.dispose()
    }
    this.applySettings()
  }

  setLayout(options: LayoutOptions): void {
    this.layout = { ...options }
  }

  attachModel(mode: PipelineMode, root: THREE.Object3D): void {
    this.detachModel(mode)
    const pane = this.panes[mode]
    pane.model = root
    pane.scene.add(root)

    // Both panes get shadow flags so the comparison reflects materials and
    // geometry rather than shadow-flag differences (the engine sets them on
    // import; the native pane would otherwise stay unlit by the sun).
    root.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
    root.updateMatrixWorld(true)

    pane.modelBounds = new THREE.Box3().setFromObject(root)
    if (pane.modelBounds.isEmpty()) {
      pane.modelBounds = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1))
    }
    this.updateHelpers(pane)
    this.updateSunPlacement()
  }

  detachModel(mode: PipelineMode): void {
    const pane = this.panes[mode]
    if (!pane.model) {
      return
    }
    pane.scene.remove(pane.model)
    pane.model = null
    pane.boundsTarget = null
    pane.modelBounds = new THREE.Box3()
    this.updateHelpers(pane)
  }

  getModel(mode: PipelineMode): THREE.Object3D | null {
    return this.panes[mode].model
  }

  getModelBounds(mode: PipelineMode): THREE.Box3 {
    return this.panes[mode].modelBounds.clone()
  }

  private resolveSceneBox(): THREE.Box3 {
    const box = new THREE.Box3()
    for (const mode of PIPELINE_MODES) {
      const pane = this.panes[mode]
      if (pane.model) {
        box.union(pane.modelBounds)
      }
    }
    if (box.isEmpty()) {
      const target = this.controls.target
      return new THREE.Box3(
        new THREE.Vector3(target.x - 1, target.y - 1, target.z - 1),
        new THREE.Vector3(target.x + 1, target.y + 1, target.z + 1),
      )
    }
    return box
  }

  private updateSunPlacement(): void {
    const box = this.resolveSceneBox()
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z, 0.001)
    const distance = Math.max(maxDim * 2, 4)
    const direction = resolveSunDirection(this.settings.sunAzimuthDeg, this.settings.sunElevationDeg)

    for (const mode of PIPELINE_MODES) {
      const pane = this.panes[mode]
      pane.sun.position.copy(center).addScaledVector(direction, distance)
      pane.sunTarget.position.copy(center)
      const shadowCamera = pane.sun.shadow.camera as THREE.OrthographicCamera
      const extent = Math.max(maxDim * 0.8, 1)
      shadowCamera.left = -extent
      shadowCamera.right = extent
      shadowCamera.top = extent
      shadowCamera.bottom = -extent
      shadowCamera.near = 0.1
      shadowCamera.far = distance + maxDim * 3
      shadowCamera.updateProjectionMatrix()
      pane.sun.shadow.needsUpdate = true
    }
  }

  private updateHelpers(pane: PaneRuntime): void {
    const box = pane.model ? pane.modelBounds : this.resolveSceneBox()
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z, 1)
    const baseY = Number.isFinite(box.min.y) ? box.min.y : 0
    const gridSize = Math.max(maxDim * 2, 4)

    if (!pane.grid || Math.abs(pane.gridSize - gridSize) > gridSize * 0.05) {
      if (pane.grid) {
        pane.scene.remove(pane.grid)
        pane.grid.geometry.dispose()
        ;(pane.grid.material as THREE.Material).dispose()
      }
      pane.grid = new THREE.GridHelper(gridSize, 20, 0x4a5b70, 0x2b3644)
      ;(pane.grid.material as THREE.Material).transparent = true
      ;(pane.grid.material as THREE.Material).opacity = 0.55
      pane.gridSize = gridSize
      pane.scene.add(pane.grid)
    }
    pane.grid.position.set(center.x, baseY, center.z)
    pane.grid.visible = this.settings.grid

    if (!pane.axes) {
      pane.axes = new THREE.AxesHelper(1)
      pane.scene.add(pane.axes)
    }
    pane.axes.scale.setScalar(Math.max(maxDim * 0.35, 0.5))
    pane.axes.position.set(box.min.x, baseY, box.min.z)
    pane.axes.visible = this.settings.axes

    if (pane.boundsHelper) {
      pane.scene.remove(pane.boundsHelper)
      pane.boundsHelper.geometry.dispose()
      ;(pane.boundsHelper.material as THREE.Material).dispose()
      pane.boundsHelper = null
    }
    if (pane.boundsTarget) {
      pane.boundsHelper = new THREE.Box3Helper(new THREE.Box3().setFromObject(pane.boundsTarget), 0x8fd8ff)
      pane.boundsHelper.renderOrder = 5
      ;(pane.boundsHelper.material as THREE.Material).depthTest = false
      pane.scene.add(pane.boundsHelper)
    }
  }

  setHelpers(helpers: HelperSettings): void {
    this.applySettings({ grid: helpers.grid, axes: helpers.axes })
    for (const mode of PIPELINE_MODES) {
      const pane = this.panes[mode]
      const shouldShowSkeleton = helpers.skeleton && Boolean(pane.model)
      if (shouldShowSkeleton && pane.model) {
        if (!pane.skeletonHelper) {
          pane.skeletonHelper = new THREE.SkeletonHelper(pane.model)
          pane.scene.add(pane.skeletonHelper)
        }
      } else if (pane.skeletonHelper) {
        pane.scene.remove(pane.skeletonHelper)
        pane.skeletonHelper.dispose()
        pane.skeletonHelper = null
      }
      if (pane.skeletonHelper) {
        pane.skeletonHelper.visible = shouldShowSkeleton
      }
    }
  }

  setSelectionByIndex(index: number | null): void {
    for (const mode of PIPELINE_MODES) {
      const pane = this.panes[mode]
      pane.boundsTarget = index === null || !pane.model ? null : findByTraversalIndex(pane.model, index)
      this.updateHelpers(pane)
    }
  }

  frameObjectByIndex(index: number): void {
    for (const mode of PIPELINE_MODES) {
      const pane = this.panes[mode]
      if (!pane.model) {
        continue
      }
      const target = findByTraversalIndex(pane.model, index)
      if (!target) {
        continue
      }
      const box = new THREE.Box3().setFromObject(target)
      if (box.isEmpty()) {
        continue
      }
      this.frameBox(box)
      return
    }
  }

  fit(): void {
    this.frameBox(this.resolveSceneBox())
  }

  private frameBox(box: THREE.Box3): void {
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z, 0.001)
    const fov = THREE.MathUtils.degToRad(this.camera.fov)
    const distance = Math.max((maxDim / (2 * Math.tan(fov / 2))) * 1.4, maxDim * 0.5, 0.5)
    const direction = new THREE.Vector3(1, 0.72, 1).normalize()

    this.camera.position.copy(center).addScaledVector(direction, distance)
    this.camera.near = Math.max(distance / 5000, 0.01)
    this.camera.far = Math.max(distance * 500, maxDim * 100, 500)
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(center)
    this.controls.update()
  }

  setView(view: CameraViewId): void {
    const box = this.resolveSceneBox()
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z, 0.001)
    const fov = THREE.MathUtils.degToRad(this.camera.fov)
    const distance = Math.max((maxDim / (2 * Math.tan(fov / 2))) * 1.4, maxDim * 0.5, 0.5)

    const directions: Record<CameraViewId, THREE.Vector3> = {
      iso: new THREE.Vector3(1, 0.72, 1),
      front: new THREE.Vector3(0, 0, 1),
      back: new THREE.Vector3(0, 0, -1),
      left: new THREE.Vector3(-1, 0, 0),
      right: new THREE.Vector3(1, 0, 0),
      top: new THREE.Vector3(0, 1, 0.0001),
      bottom: new THREE.Vector3(0, -1, 0.0001),
    }

    const direction = directions[view].clone().normalize()
    this.camera.up.set(0, 1, 0)
    if (view === 'top' || view === 'bottom') {
      this.camera.up.set(0, 0, -1)
    }
    this.camera.position.copy(center).addScaledVector(direction, distance)
    this.camera.lookAt(center)
    this.controls.target.copy(center)
    this.controls.update()
  }

  private renderFrame(): void {
    const width = this.viewportWidth
    const height = this.viewportHeight
    const renderer = this.renderer

    if (this.layout.split) {
      const halfWidth = Math.floor(width / 2)
      renderer.setScissorTest(true)

      renderer.setViewport(0, 0, halfWidth, height)
      renderer.setScissor(0, 0, halfWidth, height)
      this.camera.aspect = halfWidth / height
      this.camera.updateProjectionMatrix()
      renderer.render(this.panes.engine.scene, this.camera)

      const rightWidth = width - halfWidth
      renderer.setViewport(halfWidth, 0, rightWidth, height)
      renderer.setScissor(halfWidth, 0, rightWidth, height)
      this.camera.aspect = rightWidth / height
      this.camera.updateProjectionMatrix()
      renderer.render(this.panes.native.scene, this.camera)

      renderer.setScissorTest(false)
      return
    }

    const pane = this.panes[this.layout.mode]
    renderer.setViewport(0, 0, width, height)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    renderer.render(pane.scene, this.camera)
  }

  capture(): string {
    this.renderFrame()
    return this.renderer.domElement.toDataURL('image/png')
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.animationHandle)
    this.animationHandle = 0
    this.resizeObserver.disconnect()
    this.frameListeners.clear()
    this.controls.dispose()
    for (const mode of PIPELINE_MODES) {
      const pane = this.panes[mode]
      disposeGradientBackgroundDome(pane.gradientDome)
      pane.gradientDome = null
      pane.skeletonHelper?.dispose()
      pane.boundsHelper?.geometry.dispose()
      if (pane.grid) {
        pane.grid.geometry.dispose()
        ;(pane.grid.material as THREE.Material).dispose()
        pane.grid = null
      }
      pane.axes?.dispose()
      pane.axes = null
      pane.scene.clear()
    }
    this.renderer.renderLists.dispose()
    this.environmentTexture?.dispose()
    this.environmentTexture = null
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
