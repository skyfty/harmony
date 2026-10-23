import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'
import {
  mergeTerrainGeometries,
  type TerrainMergeOptions,
  type TerrainMergeSource,
  type TerrainMergeStats,
} from './terrainMerge'
import {
  copyRenderTargetTileToOrtho,
  planDemGrid,
  resolveDemOrthoCameraFrame,
  type DemExportPhase,
  type DemExportStageTiming,
  type DemExportFrame,
  type DemGridPlan,
} from './demExport'
import type {
  DemWorkerMergedGeometry,
  DemWorkerMergeSource,
  DemWorkerRequest,
  DemWorkerResponse,
} from './demExport.worker'
import { buildZipArchive } from './zipArchive'
import { TilesRenderer } from '3d-tiles-renderer'
import { CAMERA_FRAME } from '3d-tiles-renderer/src/three/renderer/math/Ellipsoid'
import type { Tile } from '3d-tiles-renderer/core'
import { CesiumIonAuthPlugin } from '3d-tiles-renderer/core/plugins'
import { GLTFExtensionsPlugin, TilesFadePlugin, UpdateOnChangePlugin } from '3d-tiles-renderer/three/plugins'
import stylesText from './styles.css?raw'

type Settings = { lon: number; lat: number; groundElevation: number }
type CaptureAnchor = { id: string; label: string; position: THREE.Vector3; capturedTiles: CapturableTile[] }
type CapturableTile = Tile & {
  engineData?: { scene?: THREE.Object3D | null }
  traversal?: { visible?: boolean; isLeaf?: boolean }
  internal?: { depth?: number }
}
type CapturableObject = THREE.Object3D & {
  geometry?: THREE.BufferGeometry
  material?: THREE.Material | THREE.Material[]
}
type CtrlClickFlyTargetResolver = (raycaster: THREE.Raycaster, event: PointerEvent) => THREE.Vector3 | null
type CtrlClickFlyController = {
  update: (now: number) => void
}

const app = document.querySelector<HTMLDivElement>('#app')!
const style = document.createElement('style')
style.textContent = stylesText
document.head.append(style)

app.innerHTML = `
  <div class="shell">
    <header class="hero">
      <span class="chip" id="status-chip">等待配置</span>
    </header>

    <main class="layout">
      <section class="workspace">
        <section class="panel viewer">
          <div class="viewport" id="viewport">
            <div class="viewer-overlays">
              <section class="floating-panel floating-panel--location" id="location-panel">
              
                <label>经纬度<input id="coordinate-text" type="text" inputmode="text" placeholder="29°38'38.24&quot;N 91°06'57.03&quot;E" /></label>
                <label>地面海拔 (m)<input id="ground-elevation" type="number" step="0.1" placeholder="0" /></label>
                <label class="range-label">瓦片精度 <span><strong id="precision-value">6</strong> px</span><input id="precision" type="range" min="1" max="32" step="1" value="6" /></label>
                <label>相机 Far 范围 (m)<input id="camera-far" type="number" min="50" max="10000000" step="1000" value="10000" /></label>
                                <div class="actions wide"><button id="apply-location">定位并加载</button></div>

                <div class="callout" id="config-help" hidden>
                  请在 <code>tools/3dtiles-viewer/.env.local</code> 配置 <code>VITE_TILES_URL</code>，或同时配置 <code>VITE_CESIUM_ION_TOKEN</code> 与 <code>VITE_CESIUM_ION_ASSET_ID</code>。
                </div>
              </section>

              <section class="floating-panel floating-panel--anchors" id="anchor-panel">
               
                <div class="anchor-list" id="anchor-list"></div>
                <div class="actions wide"><button id="add-anchor" disabled>添加当前相机为锚点</button></div>
              </section>
            </div>
            <div class="placeholder" id="placeholder">正在初始化实时预览…</div>
            <div class="progress-wrap progress-wrap--viewport" id="progress" hidden>
              <div class="progress"><div id="progress-bar"></div></div>
              <div class="progress-label" id="progress-label"></div>
            </div>
          </div>
        </section>

        <section class="panel glb-panel">
          <div class="panel-header">
            <h2>GLB 预览</h2>
            <div class="glb-export-actions">
              <button class="secondary" id="export-current-glb" disabled>导出完整 GLB</button>
              <button class="secondary" id="export-terrain-package" disabled>导出几何+贴图包</button>
              <button class="secondary" id="export-terrain-dem" disabled>导出 DEM 包</button>
            </div>
          </div>
          <div class="glb-export-options" id="glb-export-options">
            <label class="option"><input type="checkbox" id="opt-weld" checked /> 焊接顶点</label>
            <label class="option">ε <input type="number" id="opt-weld-epsilon" value="0.05" step="0.01" min="0.001" /></label>
            <label class="option"><input type="checkbox" id="opt-strip-skirts" checked /> 去裙边</label>
            <label class="option">贴图 ≤ <select id="opt-texture-max"><option>1024</option><option selected>2048</option><option>4096</option></select></label>
            <label class="option">质量 <input type="number" id="opt-texture-quality" value="0.8" step="0.05" min="0.3" max="0.95" /></label>
            <label class="option">DEM 分辨率 <select id="opt-dem-cell"><option value="auto" selected>自动</option><option value="1">1 m</option><option value="2">2 m</option><option value="5">5 m</option><option value="10">10 m</option></select></label>
            <label class="option"><input type="checkbox" id="opt-dem-ortho" checked /> 正射影像</label>
          </div>
          <div class="glb-preview-viewport" id="glb-preview-viewport">
            <div class="placeholder" id="glb-preview-placeholder">等待首次锚点捕获</div>
            <div class="glb-preview-progress" id="glb-preview-progress" hidden aria-live="polite">
              <div class="glb-preview-progress__row">
                <span class="glb-preview-progress__status" id="glb-preview-progress-status"></span>
                <span class="glb-preview-progress__tone" id="glb-preview-progress-tone"></span>
              </div>
              <div class="glb-preview-progress__track">
                <div class="glb-preview-progress__fill" id="glb-preview-progress-fill"></div>
              </div>
              <div class="glb-preview-progress__detail" id="glb-preview-progress-detail"></div>
              <button class="glb-preview-progress__cancel" id="glb-preview-cancel" type="button" hidden>取消导出</button>
            </div>
          </div>
        </section>
      </section>
    </main>
  </div>
`

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const viewport = $('#viewport')
const placeholder = $('#placeholder')
const statusChip = $('#status-chip')
const anchorPanel = $('#anchor-panel') as HTMLElement
const groundElevationInput = $('#ground-elevation') as HTMLInputElement
const coordinateTextInput = $('#coordinate-text') as HTMLInputElement
const precisionInput = $('#precision') as HTMLInputElement
const precisionValue = $('#precision-value')
const cameraFarInput = $('#camera-far') as HTMLInputElement
const addAnchorButton = $('#add-anchor') as HTMLButtonElement
const anchorList = $('#anchor-list')
const progress = $('#progress')
const progressBar = $('#progress-bar')
const progressLabel = $('#progress-label')
const configHelp = $('#config-help')
const exportCurrentGlbButton = $('#export-current-glb') as HTMLButtonElement
const exportTerrainPackageButton = $('#export-terrain-package') as HTMLButtonElement
const exportTerrainDemButton = $('#export-terrain-dem') as HTMLButtonElement
const demCellSizeSelect = $('#opt-dem-cell') as HTMLSelectElement
const demOrthoInput = $('#opt-dem-ortho') as HTMLInputElement
const weldEnabledInput = $('#opt-weld') as HTMLInputElement
const weldEpsilonInput = $('#opt-weld-epsilon') as HTMLInputElement
const stripSkirtsInput = $('#opt-strip-skirts') as HTMLInputElement
const textureMaxSizeSelect = $('#opt-texture-max') as HTMLSelectElement
const textureQualityInput = $('#opt-texture-quality') as HTMLInputElement
const glbPreviewViewport = $('#glb-preview-viewport')
const glbPreviewPlaceholder = $('#glb-preview-placeholder')
const glbPreviewProgress = $('#glb-preview-progress')
const glbPreviewProgressStatus = $('#glb-preview-progress-status')
const glbPreviewProgressTone = $('#glb-preview-progress-tone')
const glbPreviewProgressFill = $('#glb-preview-progress-fill')
const glbPreviewProgressDetail = $('#glb-preview-progress-detail')
const glbPreviewCancelButton = $('#glb-preview-cancel') as HTMLButtonElement

const CTRL_CLICK_FLY_DURATION_MS = 280
const CTRL_CLICK_MOVE_THRESHOLD_PX = 6

const query = new URLSearchParams(window.location.search)
const settings: Settings = {
  lon: Number(query.get('lon') ?? 118.4381361111),
  lat: Number(query.get('lat') ?? 39.8354166667),
  groundElevation: Number(query.get('ground') ?? query.get('groundElevation') ?? 89.5),
}
coordinateTextInput.value = query.has('lat') || query.has('lon')
  ? `${settings.lat}, ${settings.lon}`
  : `39°50'27.50"N 118°26'17.29"E`
groundElevationInput.value = String(settings.groundElevation)

const mainScene = new THREE.Scene()
mainScene.background = new THREE.Color('#050d18')
mainScene.add(new THREE.HemisphereLight('#c9e9ff', '#142034', 1.25))
const sun = new THREE.DirectionalLight('#fff2d4', 2.2)
sun.position.set(20, 40, 10)
mainScene.add(sun)
const cameraMarkerGroup = new THREE.Group()
cameraMarkerGroup.name = 'camera-markers'
mainScene.add(cameraMarkerGroup)

const mainCamera = new THREE.PerspectiveCamera(75, 1, 0.5, 10_000)
const mainRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false })
mainRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
mainRenderer.outputColorSpace = THREE.SRGBColorSpace
mainRenderer.toneMapping = THREE.AgXToneMapping
mainRenderer.toneMappingExposure = 1.25
viewport.append(mainRenderer.domElement)
const mainControls = new MapControls(mainCamera, mainRenderer.domElement)
mainControls.enableDamping = true
mainControls.dampingFactor = 0.05
mainControls.screenSpacePanning = false
mainControls.minDistance = 100
mainControls.maxDistance = 500
mainControls.maxPolarAngle = Math.PI
mainControls.zoomToCursor = true

const glbScene = new THREE.Scene()
glbScene.background = new THREE.Color('#020811')
glbScene.add(new THREE.HemisphereLight('#d9efff', '#18243a', 1.6))
const glbSun = new THREE.DirectionalLight('#ffffff', 2.4)
glbSun.position.set(10, 20, 10)
glbScene.add(glbSun)
const glbCaptureRoot = new THREE.Group()
glbCaptureRoot.name = 'glb-capture-root'

const defaultSkyboxUrl = new URL('./background.exr', import.meta.url).href

const glbCamera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000)
const glbRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false })
glbRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
glbRenderer.outputColorSpace = THREE.SRGBColorSpace
glbRenderer.toneMapping = THREE.AgXToneMapping
glbRenderer.toneMappingExposure = 1.25
glbPreviewViewport.prepend(glbRenderer.domElement)
const glbControls = new MapControls(glbCamera, glbRenderer.domElement)
glbControls.enableDamping = false
glbControls.dampingFactor = 0.05
glbControls.screenSpacePanning = false
glbControls.minDistance = 25
glbControls.maxDistance = 100000
glbControls.maxPolarAngle = Math.PI
glbControls.zoomToCursor = true
glbControls.rotateSpeed = 1.2
glbControls.zoomSpeed = 1.15
glbControls.panSpeed = 1.05

const mainFlyController = createCtrlClickFlyController(
  mainCamera,
  mainControls,
  mainRenderer.domElement,
  (raycaster, event) => {
    void raycaster
    const planePoint = basePosition.lengthSq() > 0 ? basePosition : mainControls.target
    const planeNormal = tmpFlyVector2.set(0, 1, 0).applyQuaternion(baseQuaternion).normalize()
    return resolvePointerPlaneTarget(mainCamera, mainRenderer.domElement, event, planePoint, planeNormal)
  },
)

const glbFlyController = createCtrlClickFlyController(
  glbCamera,
  glbControls,
  glbRenderer.domElement,
  (raycaster, event) => {
    void raycaster
    const planePoint = glbControls.target
    const planeNormal = tmpFlyVector2.set(0, 1, 0)
    return resolvePointerPlaneTarget(glbCamera, glbRenderer.domElement, event, planePoint, planeNormal)
  },
)

async function applyDefaultSkybox(): Promise<void> {
  try {
    const texture = await new EXRLoader().loadAsync(defaultSkyboxUrl)
    texture.mapping = THREE.EquirectangularReflectionMapping

    const mainPmremGenerator = new THREE.PMREMGenerator(mainRenderer)
    const mainEnvironment = mainPmremGenerator.fromEquirectangular(texture).texture
    mainPmremGenerator.dispose()

    const glbPmremGenerator = new THREE.PMREMGenerator(glbRenderer)
    const glbEnvironment = glbPmremGenerator.fromEquirectangular(texture).texture
    glbPmremGenerator.dispose()

    mainScene.background = texture
    mainScene.environment = mainEnvironment
    glbScene.background = texture
    glbScene.environment = glbEnvironment
  } catch (error) {
    console.warn('Failed to load default skybox EXR.', error)
  }
}

let tiles: TilesRenderer | null = null
let sourceLabel = '-'
let basePosition = new THREE.Vector3()
let baseQuaternion = new THREE.Quaternion()
let yaw = 0
let pitch = 0
let exporting = false
let activeDemExport: { controller: AbortController; worker: DemExportWorkerClient } | null = null
let anchors: CaptureAnchor[] = []
let capturedTileNodes = new Map<Tile, THREE.Object3D>()
let glbCameraFramed = false
let glbPreviewModel: THREE.Object3D | null = null
let glbPreviewBuffer: ArrayBuffer | null = null
let glbPreviewRevision = 0
let glbPreviewRefreshPromise: Promise<void> | null = null
let glbPreviewRefreshRequested = false
let glbSkippedLargeLeafCount = 0
let glbPreviewStatusHideTimer: number | null = null
let glbPreviewCancelHandler: (() => void) | null = null
const baseFrameMatrix = new THREE.Matrix4()
const baseFrameInverse = new THREE.Matrix4()
const tmpFlyVector = new THREE.Vector3()
const tmpFlyVector2 = new THREE.Vector3()
const tmpFlyVector3 = new THREE.Vector3()
const tmpFlyVector4 = new THREE.Vector3()
const tmpFlyVectorNdc = new THREE.Vector2()
const tmpFlyPlane = new THREE.Plane()
const tmpFlyRaycaster = new THREE.Raycaster()

class DemExportCancelledError extends Error {
  constructor() {
    super('DEM 导出已取消。')
    this.name = 'AbortError'
  }
}

class DemExportWorkerClient {
  private readonly worker: Worker
  private pending: {
    expected: DemWorkerResponse['type']
    resolve: (response: DemWorkerResponse) => void
    reject: (error: Error) => void
  } | null = null
  private closed = false

  constructor(
    private readonly onProgress: (progress: Extract<DemWorkerResponse, { type: 'progress' }>) => void,
  ) {
    this.worker = new Worker(new URL('./demExport.worker.ts', import.meta.url), { type: 'module' })
    this.worker.addEventListener('message', (event: MessageEvent<DemWorkerResponse>) => {
      const response = event.data
      if (response.type === 'progress') {
        this.onProgress(response)
        return
      }
      if (response.type === 'error') {
        this.fail(new Error(response.message))
        return
      }
      if (this.pending?.expected === response.type) {
        const pending = this.pending
        this.pending = null
        pending.resolve(response)
      }
    })
    this.worker.addEventListener('error', (event) => {
      this.fail(new Error(event.message || 'DEM 导出 Worker 崩溃。'))
    })
  }

  merge(
    sources: DemWorkerMergeSource[],
    options: { weldEpsilon: number; stripSkirts: boolean; smoothNormals: boolean },
  ): Promise<DemWorkerMergedGeometry> {
    const transfer = new Set<ArrayBuffer>()
    for (const source of sources) {
      for (const values of [
        source.positions,
        ...(source.normals ? [source.normals] : []),
        source.uvs,
        source.indices,
      ]) {
        if (values.buffer instanceof ArrayBuffer) transfer.add(values.buffer)
      }
    }
    return this.request<Extract<DemWorkerResponse, { type: 'merged' }>>(
      { type: 'merge', sources, options },
      [...transfer],
    ).then((response) => response.geometry)
  }

  sample(
    plan: DemGridPlan,
    frame: DemExportFrame,
    warnings: string[],
    sourceTriangleCount: number,
  ): Promise<Extract<DemWorkerResponse, { type: 'sampled' }>['sample']> {
    return this.request<Extract<DemWorkerResponse, { type: 'sampled' }>>({
      type: 'sample',
      plan,
      frame,
      warnings,
      sourceTriangleCount,
    }).then((response) => response.sample)
  }

  finish(rgb: Uint8Array | null, createdAt: string): Promise<Uint8Array> {
    const transfer = rgb?.buffer instanceof ArrayBuffer ? [rgb.buffer] : []
    return this.request<Extract<DemWorkerResponse, { type: 'complete' }>>(
      { type: 'finish', rgb, createdAt },
      transfer,
    ).then((response) => response.zipBytes)
  }

  cancel(): void {
    if (this.closed) return
    this.closed = true
    this.pending?.reject(new DemExportCancelledError())
    this.pending = null
    this.worker.terminate()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.pending?.reject(new Error('DEM 导出连接已关闭。'))
    this.pending = null
    this.worker.terminate()
  }

  private request<T extends DemWorkerResponse>(
    message: DemWorkerRequest,
    transfer: Transferable[] = [],
  ): Promise<T> {
    if (this.closed) return Promise.reject(new DemExportCancelledError())
    if (this.pending) return Promise.reject(new Error('DEM 导出 Worker 正在处理其他请求。'))
    return new Promise<T>((resolve, reject) => {
      this.pending = {
        expected: message.type === 'merge' ? 'merged' : message.type === 'sample' ? 'sampled' : 'complete',
        resolve: (response) => resolve(response as T),
        reject,
      }
      try {
        this.worker.postMessage(message, transfer)
      } catch (error) {
        this.pending = null
        reject(error instanceof Error ? error : new Error('无法启动 DEM 导出 Worker。'))
      }
    })
  }

  private fail(error: Error): void {
    if (this.closed) return
    this.pending?.reject(error)
    this.pending = null
  }
}

function setStatus(text: string, tone: 'idle' | 'ok' | 'error' = 'idle'): void {
  statusChip.textContent = text
  statusChip.dataset.tone = tone
}

function setPlaceholder(text: string, state: 'idle' | 'loading' | 'error' = 'idle'): void {
  placeholder.textContent = text
  placeholder.dataset.state = state
  placeholder.hidden = false
}

function setGlbPlaceholder(text: string, state: 'idle' | 'loading' | 'error' = 'idle'): void {
  glbPreviewPlaceholder.textContent = text
  glbPreviewPlaceholder.dataset.state = state
  glbPreviewPlaceholder.hidden = false
}

function hidePlaceholder(): void {
  placeholder.hidden = true
}

function hideGlbPlaceholder(): void {
  glbPreviewPlaceholder.hidden = true
}

type GlbPreviewStatusTone = 'idle' | 'loading' | 'ok' | 'error'

function hideGlbPreviewStatus(): void {
  if (glbPreviewStatusHideTimer !== null) {
    window.clearTimeout(glbPreviewStatusHideTimer)
    glbPreviewStatusHideTimer = null
  }
  glbPreviewProgress.hidden = true
  glbPreviewCancelButton.hidden = true
}

function setGlbPreviewCancelHandler(handler: (() => void) | null): void {
  glbPreviewCancelHandler = handler
  glbPreviewCancelButton.hidden = handler === null
  glbPreviewCancelButton.disabled = handler === null
}

function setGlbPreviewStatus(
  text: string,
  tone: GlbPreviewStatusTone = 'idle',
  detail = '',
  autoHideMs?: number,
  progressPercent?: number,
): void {
  if (glbPreviewStatusHideTimer !== null) {
    window.clearTimeout(glbPreviewStatusHideTimer)
    glbPreviewStatusHideTimer = null
  }
  glbPreviewProgress.hidden = false
  glbPreviewProgress.dataset.state = tone
  glbPreviewProgressStatus.textContent = text
  glbPreviewProgressTone.textContent = tone === 'loading' ? '处理中' : tone === 'ok' ? '完成' : tone === 'error' ? '错误' : '提示'
  glbPreviewProgressDetail.textContent = detail
  const determinate = progressPercent !== undefined && Number.isFinite(progressPercent)
  glbPreviewProgressFill.classList.toggle('is-loading', tone === 'loading' && !determinate)
  glbPreviewProgressFill.style.width = determinate
    ? `${Math.max(0, Math.min(100, progressPercent))}%`
    : tone === 'loading'
      ? '62%'
      : tone === 'ok' || tone === 'error'
        ? '100%'
        : '42%'

  if (autoHideMs !== undefined) {
    glbPreviewStatusHideTimer = window.setTimeout(() => {
      if (glbPreviewProgress.dataset.state === tone) {
        hideGlbPreviewStatus()
      }
    }, autoHideMs)
  }
}

function syncFloatingPanelState(panel: HTMLElement, toggleButton: HTMLButtonElement, visible: boolean): void {
  panel.hidden = !visible
  toggleButton.hidden = visible
}

function resolvePointerPlaneTarget(
  camera: THREE.PerspectiveCamera,
  domElement: HTMLElement,
  event: PointerEvent,
  planePoint: THREE.Vector3,
  planeNormal: THREE.Vector3,
): THREE.Vector3 | null {
  const rect = domElement.getBoundingClientRect()
  const width = Math.max(1, rect.width)
  const height = Math.max(1, rect.height)
  const ndcX = ((event.clientX - rect.left) / width) * 2 - 1
  const ndcY = -(((event.clientY - rect.top) / height) * 2 - 1)
  tmpFlyVectorNdc.set(ndcX, ndcY)
  tmpFlyRaycaster.setFromCamera(tmpFlyVectorNdc, camera)
  tmpFlyPlane.setFromNormalAndCoplanarPoint(planeNormal, planePoint)
  return tmpFlyRaycaster.ray.intersectPlane(tmpFlyPlane, tmpFlyVector4)
}

function createCtrlClickFlyController(
  camera: THREE.PerspectiveCamera,
  controls: MapControls,
  domElement: HTMLElement,
  resolveTarget: CtrlClickFlyTargetResolver,
): CtrlClickFlyController {
  type PendingPointer = {
    pointerId: number
    startX: number
    startY: number
    moved: boolean
    captured: boolean
  }

  type ActiveFlight = {
    startedAt: number
    duration: number
    fromPosition: THREE.Vector3
    fromTarget: THREE.Vector3
    toPosition: THREE.Vector3
    toTarget: THREE.Vector3
    restoreEnabled: boolean
  }

  let pendingPointer: PendingPointer | null = null
  let activeFlight: ActiveFlight | null = null

  function releasePointerCapture(pointerId: number): void {
    if (!pendingPointer?.captured) return
    try {
      domElement.releasePointerCapture(pointerId)
    } catch {
      // Pointer capture is best-effort and can already be released by the browser.
    }
  }

  function stopPendingPointer(): void {
    if (!pendingPointer) return
    releasePointerCapture(pendingPointer.pointerId)
    pendingPointer = null
  }

  function startFlight(target: THREE.Vector3): void {
    const startPosition = camera.position.clone()
    const startTarget = controls.target.clone()
    const offset = startPosition.clone().sub(startTarget)
    if (offset.lengthSq() < 1e-6) {
      camera.getWorldDirection(tmpFlyVector).multiplyScalar(-Math.max(controls.minDistance || 1, 100))
      offset.copy(tmpFlyVector)
    }

    activeFlight = {
      startedAt: performance.now(),
      duration: CTRL_CLICK_FLY_DURATION_MS,
      fromPosition: startPosition,
      fromTarget: startTarget,
      toTarget: target.clone(),
      toPosition: target.clone().add(offset),
      restoreEnabled: activeFlight?.restoreEnabled ?? controls.enabled,
    }
    controls.enabled = false
  }

  function resolveTargetPoint(event: PointerEvent): THREE.Vector3 | null {
    const target = resolveTarget(tmpFlyRaycaster, event)
    if (target) return target
    camera.getWorldDirection(tmpFlyVector2)
    tmpFlyPlane.setFromNormalAndCoplanarPoint(tmpFlyVector2, controls.target)
    const rect = domElement.getBoundingClientRect()
    const width = Math.max(1, rect.width)
    const height = Math.max(1, rect.height)
    const ndcX = ((event.clientX - rect.left) / width) * 2 - 1
    const ndcY = -(((event.clientY - rect.top) / height) * 2 - 1)
    tmpFlyVectorNdc.set(ndcX, ndcY)
    tmpFlyRaycaster.setFromCamera(tmpFlyVectorNdc, camera)
    return tmpFlyRaycaster.ray.intersectPlane(tmpFlyPlane, tmpFlyVector3)
  }

  function onPointerDown(event: PointerEvent): void {
    if (!event.ctrlKey || event.button !== 0 || event.defaultPrevented) return
    pendingPointer = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      captured: false,
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    try {
      domElement.setPointerCapture(event.pointerId)
      pendingPointer.captured = true
    } catch {
      // Pointer capture is best-effort.
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (!pendingPointer || event.pointerId !== pendingPointer.pointerId) return
    const movedX = event.clientX - pendingPointer.startX
    const movedY = event.clientY - pendingPointer.startY
    if (movedX * movedX + movedY * movedY > CTRL_CLICK_MOVE_THRESHOLD_PX * CTRL_CLICK_MOVE_THRESHOLD_PX) {
      pendingPointer.moved = true
    }
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  function onPointerUp(event: PointerEvent): void {
    if (!pendingPointer || event.pointerId !== pendingPointer.pointerId) return
    const shouldFly = !pendingPointer.moved && event.button === 0
    event.preventDefault()
    event.stopImmediatePropagation()
    stopPendingPointer()
    if (!shouldFly) return
    const target = resolveTargetPoint(event)
    if (!target) return
    startFlight(target)
  }

  function onPointerCancel(event: PointerEvent): void {
    if (!pendingPointer || event.pointerId !== pendingPointer.pointerId) return
    event.preventDefault()
    event.stopImmediatePropagation()
    stopPendingPointer()
  }

  domElement.addEventListener('pointerdown', onPointerDown, true)
  domElement.addEventListener('pointermove', onPointerMove, true)
  domElement.addEventListener('pointerup', onPointerUp, true)
  domElement.addEventListener('pointercancel', onPointerCancel, true)

  return {
    update(now: number): void {
      if (!activeFlight) return

      const elapsed = Math.max(0, now - activeFlight.startedAt)
      const t = Math.min(1, elapsed / activeFlight.duration)
      const eased = t * t * (3 - 2 * t)

      camera.position.lerpVectors(activeFlight.fromPosition, activeFlight.toPosition, eased)
      controls.target.lerpVectors(activeFlight.fromTarget, activeFlight.toTarget, eased)
      camera.updateMatrixWorld(true)
      controls.update()

      if (t >= 1) {
        controls.enabled = activeFlight.restoreEnabled
        activeFlight = null
      }
    },
  }
}

function disposeObject3DResources(object: THREE.Object3D | null): void {
  if (!object) return
  object.traverse((node) => {
    const renderable = node as THREE.Mesh & { material?: THREE.Material | THREE.Material[]; geometry?: THREE.BufferGeometry }
    renderable.geometry?.dispose()
    const material = renderable.material
    if (!material) return
    const materials = Array.isArray(material) ? material : [material]
    for (const item of materials) {
      const record = item as THREE.Material & Record<string, unknown>
      for (const value of Object.values(record)) {
        if (value instanceof THREE.Texture) value.dispose()
      }
      item.dispose()
    }
  })
}

function updateStats(): void {
  void sourceLabel
  void tiles
  void settings
}

function isTilesReady(): boolean {
  if (!tiles) return false
  const stats = readTilesStats()
  const queued = Math.max(
    0,
    (Number(stats.queued) || 0)
      + (Number(stats.downloading) || 0)
      + (Number(stats.parsing) || 0)
      + (Number(stats.processing) || 0),
  )
  return tiles.loadProgress >= 1 && queued === 0
}

function readTilesStats(): Record<string, number> {
  if (!tiles) return {}
  return (tiles as unknown as { stats?: Record<string, number> }).stats ?? {}
}

function updateProgressUI(): void {
  if (!tiles) {
    progress.hidden = true
    setCaptureButtonState()
    return
  }
  progress.hidden = false
  progressBar.style.width = `${Math.max(0, Math.min(1, tiles.loadProgress)) * 100}%`
  const stats = readTilesStats()
  const loaded = Math.max(0, Number(stats.loaded) || 0)
  const queued = Math.max(
    0,
    (Number(stats.queued) || 0)
      + (Number(stats.downloading) || 0)
      + (Number(stats.parsing) || 0)
      + (Number(stats.processing) || 0),
  )
  progressLabel.textContent = `已加载 ${loaded} · 队列 ${queued} · 锚点 ${anchors.length} · 捕获叶节点 ${capturedTileNodes.size} · 过滤 ${glbSkippedLargeLeafCount}`
  setCaptureButtonState()
}

function syncGlbOrigin(): void {
  glbCaptureRoot.position.set(0, 0, 0)
  glbCaptureRoot.quaternion.identity()
  glbCaptureRoot.scale.set(1, 1, 1)
  glbCaptureRoot.updateMatrixWorld(true)
}

function syncGlbCameraToMainView(): void {
  const mainViewMatrix = new THREE.Matrix4().compose(mainCamera.position, mainCamera.quaternion, new THREE.Vector3(1, 1, 1))
  const localViewMatrix = baseFrameInverse.clone().multiply(mainViewMatrix)
  localViewMatrix.decompose(glbCamera.position, glbCamera.quaternion, glbCamera.scale)
  const localTarget = mainControls.target.clone().applyMatrix4(baseFrameInverse)
  glbCamera.up.set(0, 1, 0).applyQuaternion(glbCamera.quaternion).normalize()
  glbCamera.near = Math.max(0.01, mainCamera.near * 0.1)
  glbCamera.far = Math.max(1000, Number(cameraFarInput.value) || mainCamera.far)
  glbCamera.updateProjectionMatrix()
  glbControls.target.copy(localTarget)
  glbControls.maxDistance = Math.max(glbCamera.far * 0.5, 1000)
  glbControls.update()
}

function resetGlbCaptureScene(message = '等待首次锚点捕获'): void {
  for (const child of [...glbCaptureRoot.children]) glbCaptureRoot.remove(child)
  capturedTileNodes.clear()
  anchors = []
  glbCameraFramed = false
  glbSkippedLargeLeafCount = 0
  glbPreviewRevision += 1
  glbPreviewBuffer = null
  if (glbPreviewModel) {
    disposeObject3DResources(glbPreviewModel)
    glbScene.remove(glbPreviewModel)
    glbPreviewModel = null
  }
  exportCurrentGlbButton.disabled = true
  exportTerrainPackageButton.disabled = true
  exportTerrainDemButton.disabled = true
  setGlbPreviewStatus(message, 'idle', '', 1200)
  setGlbPlaceholder(message)
  renderAnchorList()
  updateCameraMarkers()
  updateProgressUI()
}

function cloneTexture(texture: THREE.Texture): THREE.Texture {
  const source = texture.image
  let image: CanvasImageSource | null = null
  const sourceKey = (texture.userData as Record<string, unknown>).__captureSourceTextureKey
    ?? texture.source?.uuid
    ?? texture.uuid

  if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
    const canvas = document.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height
    const context = canvas.getContext('2d')
    if (context) context.drawImage(source, 0, 0)
    image = canvas
  } else if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    const canvas = document.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height
    const context = canvas.getContext('2d')
    if (context) context.drawImage(source, 0, 0)
    image = canvas
  } else if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    const canvas = document.createElement('canvas')
    canvas.width = source.naturalWidth || source.width
    canvas.height = source.naturalHeight || source.height
    const context = canvas.getContext('2d')
    if (context) context.drawImage(source, 0, 0)
    image = canvas
  } else {
    image = source as CanvasImageSource | null
  }

  const next = new THREE.Texture(image)
  next.name = texture.name
  next.mapping = texture.mapping
  next.channel = texture.channel
  next.wrapS = texture.wrapS
  next.wrapT = texture.wrapT
  next.magFilter = texture.magFilter
  next.minFilter = texture.minFilter
  next.anisotropy = texture.anisotropy
  next.format = texture.format
  next.internalFormat = texture.internalFormat
  next.type = texture.type
  next.offset.copy(texture.offset)
  next.repeat.copy(texture.repeat)
  next.center.copy(texture.center)
  next.rotation = texture.rotation
  next.matrixAutoUpdate = texture.matrixAutoUpdate
  next.matrix.copy(texture.matrix)
  next.generateMipmaps = texture.generateMipmaps
  next.premultiplyAlpha = texture.premultiplyAlpha
  next.flipY = texture.flipY
  next.unpackAlignment = texture.unpackAlignment
  next.colorSpace = texture.colorSpace
  next.userData = JSON.parse(JSON.stringify(texture.userData))
  next.userData.__captureSourceTextureKey = sourceKey
  next.mipmaps = texture.mipmaps.slice(0)
  next.needsUpdate = true
  return next
}

function cloneMaterialDeep(material: THREE.Material): THREE.Material {
  const next = material.clone()
  const record = next as unknown as Record<string, unknown>
  for (const key of Object.keys(record)) {
    const value = record[key]
    if (value instanceof THREE.Texture) {
      record[key] = cloneTexture(value)
      continue
    }
    if (Array.isArray(value)) {
      record[key] = value.map((item) => item instanceof THREE.Texture ? cloneTexture(item) : item)
    }
  }
  return next
}

function cloneGeometryForExport(source: CapturableObject): THREE.BufferGeometry | null {
  if (!source.geometry) return null
  const geometry = source.geometry.clone()
  geometry.applyMatrix4(source.matrixWorld)
  return geometry
}

function getTextureCaptureKey(texture: THREE.Texture | null | undefined): string {
  if (!texture) return '-'
  const userData = texture.userData as Record<string, unknown>
  const sourceKey = userData.__captureSourceTextureKey ?? texture.source?.uuid ?? texture.uuid
  return [
    sourceKey,
    texture.name || '-',
    texture.mapping,
    texture.wrapS,
    texture.wrapT,
    texture.magFilter,
    texture.minFilter,
    texture.anisotropy,
    texture.flipY ? 1 : 0,
    texture.colorSpace || '-',
  ].join(':')
}

const TERRAIN_TEXTURE_SLOTS = [
  'map',
  'alphaMap',
  'aoMap',
  'bumpMap',
  'displacementMap',
  'emissiveMap',
  'lightMap',
  'metalnessMap',
  'normalMap',
  'roughnessMap',
] as const

type TerrainTextureSlot = (typeof TERRAIN_TEXTURE_SLOTS)[number]

interface TerrainTextureBinding {
  slot: TerrainTextureSlot
  textureId: string
  materialIndices?: number[]
  image?: string
  ktx2?: string
}

interface EncodedTerrainTexture {
  id: string
  extension: 'jpg' | 'png'
  mimeType: string
  bytes: Uint8Array
  width: number
  height: number
}

let lastTerrainMergeStats: TerrainMergeStats | null = null

function readTerrainMergeOptions(): TerrainMergeOptions {
  return {
    weldEpsilon: Number(weldEpsilonInput.value) || 0.05,
    stripSkirts: stripSkirtsInput.checked,
    smoothNormals: weldEnabledInput.checked,
  }
}

function cloneLeafNodeForExport(source: CapturableObject): THREE.Object3D {
  const clone = source.clone(false)
  const geometry = cloneGeometryForExport(source)
  if (geometry) (clone as CapturableObject).geometry = geometry
  if (source.material) {
    ;(clone as CapturableObject).material = Array.isArray(source.material)
      ? source.material.map((item) => cloneMaterialDeep(item))
      : cloneMaterialDeep(source.material)
  }
  clone.position.set(0, 0, 0)
  clone.quaternion.identity()
  clone.scale.set(1, 1, 1)
  clone.matrix.identity()
  clone.matrixAutoUpdate = false
  clone.updateMatrix()
  clone.updateMatrixWorld(true)
  return clone
}

function extractGeometryGroup(
  geometry: THREE.BufferGeometry,
  group: { start: number; count: number; materialIndex: number },
): THREE.BufferGeometry | null {
  const position = geometry.getAttribute('position')
  const indexAttribute = geometry.getIndex()
  const totalTriangles = indexAttribute
    ? Math.floor(indexAttribute.count / 3)
    : Math.floor(position.count / 3)
  const start = Math.max(0, group.start)
  const count = Math.min(group.count, totalTriangles - start)
  if (count <= 0) {
    return null
  }
  const firstIndex = start * 3
  const indexCount = count * 3

  const sub = new THREE.BufferGeometry()
  for (const name of ['position', 'normal', 'uv'] as const) {
    const attribute = geometry.getAttribute(name)
    if (attribute) {
      sub.setAttribute(name, attribute.clone())
    }
  }
  if (indexAttribute) {
    const slice = (indexAttribute.array as THREE.TypedArray).slice(firstIndex, firstIndex + indexCount)
    sub.setIndex(new THREE.BufferAttribute(slice, 1))
  } else {
    const indices = new Uint32Array(indexCount)
    for (let i = 0; i < indexCount; i += 1) {
      indices[i] = firstIndex + i
    }
    sub.setIndex(new THREE.BufferAttribute(indices, 1))
  }
  return sub
}

function collectTerrainMergeSources(root: THREE.Object3D): {
  sources: TerrainMergeSource[]
  materials: THREE.Material[]
  looseNodes: CapturableObject[]
  rawLeafNodes: CapturableObject[]
} {
  const sources: TerrainMergeSource[] = []
  const materials: THREE.Material[] = []
  const looseNodes: CapturableObject[] = []
  const rawLeafNodes: CapturableObject[] = []
  const materialIndexByUuid = new Map<string, number>()

  const registerMaterial = (material: THREE.Material): number => {
    const existing = materialIndexByUuid.get(material.uuid)
    if (existing !== undefined) {
      return existing
    }
    const index = materials.length
    materials.push(cloneMaterialDeep(material))
    materialIndexByUuid.set(material.uuid, index)
    return index
  }

  root.traverse((node) => {
    const renderable = node as CapturableObject & {
      isSprite?: boolean
      isSkinnedMesh?: boolean
      isInstancedMesh?: boolean
      isPoints?: boolean
      isLine?: boolean
    }
    if (!renderable.geometry && !renderable.isSprite) return
    if (isRenderableLeaf(node)) {
      rawLeafNodes.push(renderable)
    }
    if (
      renderable.isSprite
      || renderable.isSkinnedMesh
      || renderable.isInstancedMesh
      || renderable.isPoints
      || renderable.isLine
      || !renderable.geometry
      || !renderable.material
    ) {
      looseNodes.push(renderable)
      return
    }
    const geometry = cloneGeometryForExport(renderable)
    const hasMorphTargets = geometry?.morphAttributes
      ? Object.keys(geometry.morphAttributes).length > 0
      : false
    if (!geometry || hasMorphTargets) {
      looseNodes.push(renderable)
      return
    }
    const materialList = Array.isArray(renderable.material) ? renderable.material : [renderable.material]
    const groups = geometry.groups.length > 0
      ? geometry.groups
      : [{ start: 0, count: Infinity, materialIndex: 0 }]
    for (const group of groups) {
      const material = materialList[group.materialIndex ?? 0] ?? materialList[0]
      if (!material) {
        continue
      }
      const subGeometry = extractGeometryGroup(geometry, {
        start: group.start,
        count: group.count,
        materialIndex: group.materialIndex ?? 0,
      })
      if (!subGeometry) {
        continue
      }
      sources.push({
        geometry: subGeometry,
        materialIndex: registerMaterial(material),
      })
    }
  })

  return { sources, materials, looseNodes, rawLeafNodes }
}

function assignTerrainTextureIds(materials: THREE.Material[]): Map<THREE.Texture, string> {
  const idsByTexture = new Map<THREE.Texture, string>()
  const idsByKey = new Map<string, string>()
  let counter = 0
  for (const material of materials) {
    for (const slot of TERRAIN_TEXTURE_SLOTS) {
      const texture = (material as unknown as Record<string, unknown>)[slot]
      if (!(texture instanceof THREE.Texture)) {
        continue
      }
      const key = getTextureCaptureKey(texture)
      const existing = idsByKey.get(key)
      if (existing) {
        idsByTexture.set(texture, existing)
        continue
      }
      counter += 1
      const id = `tex-${String(counter).padStart(4, '0')}`
      idsByKey.set(key, id)
      idsByTexture.set(texture, id)
    }
  }
  return idsByTexture
}

function buildMeshTextureBindings(
  meshName: string,
  materials: THREE.Material[],
  textureIds: Map<THREE.Texture, string>,
): {
  bindings: TerrainTextureBinding[]
  slotsByTextureId: Map<string, Array<{ mesh: string; materialIndex: number; slot: TerrainTextureSlot }>>
} {
  const bindings: TerrainTextureBinding[] = []
  const slotsByTextureId = new Map<string, Array<{ mesh: string; materialIndex: number; slot: TerrainTextureSlot }>>()
  for (let materialIndex = 0; materialIndex < materials.length; materialIndex += 1) {
    const material = materials[materialIndex]
    for (const slot of TERRAIN_TEXTURE_SLOTS) {
      const texture = (material as unknown as Record<string, unknown>)[slot]
      if (!(texture instanceof THREE.Texture)) {
        continue
      }
      const textureId = textureIds.get(texture)
      if (!textureId) {
        continue
      }
      const existing = bindings.find((binding) => binding.textureId === textureId && binding.slot === slot)
      if (existing) {
        const indices = existing.materialIndices ?? []
        if (!indices.includes(materialIndex)) {
          indices.push(materialIndex)
        }
      } else {
        bindings.push({ slot, textureId, materialIndices: [materialIndex] })
      }
      const slots = slotsByTextureId.get(textureId) ?? []
      slots.push({ mesh: meshName, materialIndex, slot })
      slotsByTextureId.set(textureId, slots)
    }
  }
  return { bindings, slotsByTextureId }
}

function buildMergedCaptureRoot(): THREE.Group {
  glbCaptureRoot.updateMatrixWorld(true)
  const exportRoot = new THREE.Group()
  exportRoot.name = 'glb-export-root'
  exportRoot.matrixAutoUpdate = false
  exportRoot.matrix.identity()
  exportRoot.position.set(0, 0, 0)
  exportRoot.quaternion.identity()
  exportRoot.scale.set(1, 1, 1)

  const { sources, materials, looseNodes, rawLeafNodes } = collectTerrainMergeSources(glbCaptureRoot)
  const merged = mergeTerrainGeometries(sources, readTerrainMergeOptions())
  lastTerrainMergeStats = merged?.stats ?? null

  if (merged && materials.length > 0) {
    const textureIds = assignTerrainTextureIds(materials)
    const mergedMesh = new THREE.Mesh(
      merged.geometry,
      materials.length === 1 ? materials[0] : materials,
    )
    mergedMesh.name = 'merged-terrain'
    mergedMesh.matrixAutoUpdate = false
    mergedMesh.matrix.identity()
    mergedMesh.position.set(0, 0, 0)
    mergedMesh.quaternion.identity()
    mergedMesh.scale.set(1, 1, 1)
    mergedMesh.updateMatrix()
    mergedMesh.updateMatrixWorld(true)
    const { bindings } = buildMeshTextureBindings(mergedMesh.name, materials, textureIds)
    mergedMesh.userData.plTextureBindings = bindings
    exportRoot.add(mergedMesh)
  } else {
    const looseIdentity = new Set<CapturableObject>(looseNodes)
    for (const node of rawLeafNodes) {
      if (looseIdentity.has(node)) {
        continue
      }
      exportRoot.add(cloneLeafNodeForExport(node))
    }
  }

  for (const node of looseNodes) {
    exportRoot.add(cloneLeafNodeForExport(node))
  }

  exportRoot.updateMatrixWorld(true)
  return exportRoot
}

function copyFloatAttribute(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
  itemSize: 2 | 3,
): Float32Array | null {
  if (!attribute) return null
  if (
    attribute instanceof THREE.BufferAttribute
    && attribute.array instanceof Float32Array
    && attribute.itemSize === itemSize
    && attribute.array.length === attribute.count * itemSize
  ) {
    return attribute.array
  }

  const output = new Float32Array(attribute.count * itemSize)
  for (let index = 0; index < attribute.count; index += 1) {
    output[index * itemSize] = attribute.getX(index)
    output[index * itemSize + 1] = attribute.getY(index)
    if (itemSize === 3) {
      output[index * itemSize + 2] = attribute.getZ(index)
    }
  }
  return output
}

function toWorkerMergeSources(sources: TerrainMergeSource[]): DemWorkerMergeSource[] {
  const payloads: DemWorkerMergeSource[] = []
  for (const source of sources) {
    const positions = copyFloatAttribute(source.geometry.getAttribute('position'), 3)
    if (!positions) continue
    const normals = copyFloatAttribute(source.geometry.getAttribute('normal'), 3)
    const uvs = copyFloatAttribute(source.geometry.getAttribute('uv'), 2)
      ?? new Float32Array(source.geometry.getAttribute('position').count * 2)
    const index = source.geometry.getIndex()
    let indices: Uint32Array
    if (index?.array instanceof Uint32Array && index.itemSize === 1) {
      indices = index.array
    } else {
      const indexCount = index?.count ?? source.geometry.getAttribute('position').count
      indices = new Uint32Array(indexCount)
      for (let vertexIndex = 0; vertexIndex < indexCount; vertexIndex += 1) {
        indices[vertexIndex] = index?.getX(vertexIndex) ?? vertexIndex
      }
    }
    payloads.push({
      positions,
      normals,
      uvs,
      indices,
      materialIndex: source.materialIndex,
    })
  }
  return payloads
}

function geometryFromWorkerMerge(merged: DemWorkerMergedGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(merged.positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(merged.normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(merged.uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(merged.indices, 1))
  geometry.groups = []
  for (const group of merged.groups) {
    geometry.addGroup(group.start, group.count, group.materialIndex)
  }
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function buildDemExportRoot(
  merged: DemWorkerMergedGeometry,
  materials: THREE.Material[],
  looseNodes: CapturableObject[],
  rawLeafNodes: CapturableObject[],
): THREE.Group {
  const geometry = geometryFromWorkerMerge(merged)
  const exportRoot = new THREE.Group()
  exportRoot.name = 'glb-export-root'
  exportRoot.matrixAutoUpdate = false
  exportRoot.matrix.identity()

  const mergedMesh = new THREE.Mesh(
    geometry,
    materials.length === 1 ? materials[0] : materials,
  )
  mergedMesh.name = 'merged-terrain'
  mergedMesh.matrixAutoUpdate = false
  mergedMesh.matrix.identity()
  mergedMesh.updateMatrixWorld(true)
  const textureIds = assignTerrainTextureIds(materials)
  mergedMesh.userData.plTextureBindings = buildMeshTextureBindings(
    mergedMesh.name,
    materials,
    textureIds,
  ).bindings
  exportRoot.add(mergedMesh)

  const looseIdentity = new Set<CapturableObject>(looseNodes)
  for (const node of rawLeafNodes) {
    if (!looseIdentity.has(node)) {
      exportRoot.add(cloneLeafNodeForExport(node))
    }
  }
  for (const node of looseNodes) {
    exportRoot.add(cloneLeafNodeForExport(node))
  }
  exportRoot.updateMatrixWorld(true)
  return exportRoot
}

function isRenderableLeaf(node: THREE.Object3D): boolean {
  const renderable = node as CapturableObject & { isSprite?: boolean }
  const hasGeometry = Boolean(renderable.geometry)
  const hasMaterial = Boolean(renderable.material)
  if (!hasGeometry && !renderable.isSprite) return false
  for (const child of node.children) {
    if (isRenderableLeaf(child)) return false
  }
  return hasMaterial || renderable.isSprite === true
}

function cloneRenderableLeafForCapture(source: CapturableObject): CapturableObject | null {
  const clone = source.clone(false) as CapturableObject
  if (source.geometry) {
    const geometry = source.geometry.clone()
    clone.geometry = geometry
  }
  if (source.material) {
    clone.material = Array.isArray(source.material)
      ? source.material.map((item) => cloneMaterialDeep(item))
      : cloneMaterialDeep(source.material)
  }
  const matrix = baseFrameInverse.clone().multiply(source.matrixWorld)
  if (clone.geometry) {
    clone.geometry.applyMatrix4(matrix)
  }
  clone.position.set(0, 0, 0)
  clone.quaternion.identity()
  clone.scale.set(1, 1, 1)
  clone.matrix.identity()
  clone.matrixAutoUpdate = false
  clone.updateMatrix()
  clone.updateMatrixWorld(true)
  return clone
}

function createCapturedTileGroup(source: THREE.Object3D): THREE.Group {
  source.updateMatrixWorld(true)
  const group = new THREE.Group()
  group.matrixAutoUpdate = false
  group.matrix.identity()
  group.position.set(0, 0, 0)
  group.quaternion.identity()
  group.scale.set(1, 1, 1)
  source.traverse((node) => {
    if (!isRenderableLeaf(node)) return
    const cloned = cloneRenderableLeafForCapture(node as CapturableObject)
    if (cloned) group.add(cloned)
  })
  group.updateMatrix()
  group.updateMatrixWorld(true)
  return group
}

function recenterObject3D(root: THREE.Object3D): boolean {
  root.position.set(0, 0, 0)
  root.quaternion.identity()
  root.scale.set(1, 1, 1)
  root.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(root)
  if (box.isEmpty()) return false

  const center = box.getCenter(new THREE.Vector3())
  root.position.copy(center).multiplyScalar(-1)
  root.updateMatrixWorld(true)
  return true
}

function loadGlbPreviewFromBuffer(buffer: ArrayBuffer, revision: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const loader = new GLTFLoader()
    loader.parse(
      buffer,
      '',
      (gltf) => {
        if (revision !== glbPreviewRevision) {
          glbPreviewRefreshRequested = true
          resolve()
          return
        }

        const previewScene = gltf.scene ?? gltf.scenes?.[0]
        if (!previewScene) {
          reject(new Error('GLB 预览加载失败。'))
          return
        }

        if (glbPreviewModel) {
          disposeObject3DResources(glbPreviewModel)
          glbScene.remove(glbPreviewModel)
        }

        glbPreviewModel = previewScene
        glbPreviewModel.name = 'glb-preview-model'
        glbScene.add(glbPreviewModel)
        hideGlbPlaceholder()

        if (!glbCameraFramed) {
          syncGlbCameraToMainView()
          glbCameraFramed = true
        }

        setGlbPreviewStatus(
          'GLB 预览已同步',
          'ok',
          `捕获 ${capturedTileNodes.size} 叶节点 · 合并 ${lastTerrainMergeStats?.outputTriangleCount ?? '-'} 三角形 · 焊接 ${lastTerrainMergeStats?.weldedVertexCount ?? 0} 顶点`,
          1600,
        )
        resolve()
      },
      (error) => reject(error instanceof Error ? error : new Error('GLB 预览解析失败。')),
    )
  })
}

async function refreshGlbPreview(): Promise<void> {
  if (capturedTileNodes.size === 0) {
    glbPreviewBuffer = null
    setGlbPreviewStatus('当前视图没有可捕获的高精度叶节点', 'idle', '请先添加一个相机锚点', 1800)
    setGlbPlaceholder('当前视图没有可捕获的高精度叶节点', 'idle')
    return
  }

  glbPreviewRefreshRequested = true
  if (glbPreviewRefreshPromise) return glbPreviewRefreshPromise

  glbPreviewRefreshPromise = (async () => {
    try {
      while (glbPreviewRefreshRequested) {
        glbPreviewRefreshRequested = false
        const revision = glbPreviewRevision
        if (!glbPreviewModel) setGlbPlaceholder('正在生成 GLB 预览...', 'loading')
        setGlbPreviewStatus(
          '正在生成 GLB 预览…',
          'loading',
          `当前捕获 ${capturedTileNodes.size} 个高精度叶节点`,
        )
        const exportRoot = buildMergedCaptureRoot()
        try {
          recenterObject3D(exportRoot)
          const buffer = await exportObject3D(exportRoot)
          if (revision !== glbPreviewRevision) {
            glbPreviewRefreshRequested = true
            continue
          }
          glbPreviewBuffer = buffer.slice(0)
          await loadGlbPreviewFromBuffer(buffer, revision)
        } finally {
          disposeObject3DResources(exportRoot)
        }
      }
    } finally {
      glbPreviewRefreshPromise = null
    }
  })()

  return glbPreviewRefreshPromise
}

function createCameraMarker(position: THREE.Vector3, label: string, color: number): THREE.Group {
  const marker = new THREE.Group()
  marker.position.copy(position)

  const point = new THREE.Mesh(
    new THREE.SphereGeometry(3.5, 16, 12),
    new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false }),
  )
  point.renderOrder = 1000
  marker.add(point)

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(7, 1.1, 8, 32),
    new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false }),
  )
  ring.position.y = -4
  ring.renderOrder = 1000
  marker.add(ring)

  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const context = canvas.getContext('2d')!
  context.font = '700 28px sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = '#ffffff'
  context.strokeStyle = '#07131f'
  context.lineWidth = 8
  context.strokeText(label, canvas.width / 2, canvas.height / 2)
  context.fillText(label, canvas.width / 2, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const text = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  }))
  text.position.y = 12
  text.scale.set(28, 7, 1)
  text.renderOrder = 1001
  marker.add(text)

  return marker
}

function disposeCameraMarkers(): void {
  cameraMarkerGroup.traverse((object) => {
    const renderable = object as THREE.Mesh | THREE.Sprite
    if (renderable.geometry) renderable.geometry.dispose()
    const material = renderable.material
    if (!material) return
    const materials = Array.isArray(material) ? material : [material]
    for (const item of materials) {
      ;(item as THREE.Material & { map?: THREE.Texture | null }).map?.dispose()
      item.dispose()
    }
  })
  cameraMarkerGroup.clear()
}

function updateCameraMarkers(): void {
  disposeCameraMarkers()
  cameraMarkerGroup.add(createCameraMarker(basePosition, 'BASE', 0x42e8a0))
  anchors.forEach((anchor, index) => {
    cameraMarkerGroup.add(createCameraMarker(anchor.position, `A${index + 1}`, 0xff9d52))
  })
}

function parseCoordinate(value: string, axis: 'lat' | 'lon'): number {
  const normalized = value.trim()
    .replace(/[，]/g, ',')
    .replace(/[’′]/g, '\'')
    .replace(/[“”]/g, '"')

  if (!normalized) throw new Error(`${axis === 'lat' ? '纬度' : '经度'}不能为空。`)

  const hemisphere = normalized.match(/[NSEW]$/i)?.[0].toUpperCase() as 'N' | 'S' | 'E' | 'W' | undefined
  const body = normalized.replace(/[NSEW]$/i, '').trim()
  const dmsMatch = body.match(/^([+-]?\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′]?\s*)?(?:(\d+(?:\.\d+)?)\s*["″]?\s*)?$/)
  const decimal = Number(body)

  let result: number
  if (dmsMatch) {
    const degrees = Number(dmsMatch[1])
    const minutes = dmsMatch[2] ? Number(dmsMatch[2]) : 0
    const seconds = dmsMatch[3] ? Number(dmsMatch[3]) : 0
    if (minutes >= 60 || seconds >= 60) throw new Error(`${axis === 'lat' ? '纬度' : '经度'}的分和秒必须小于 60。`)
    const sign = degrees < 0 || hemisphere === 'S' || hemisphere === 'W' ? -1 : 1
    result = sign * (Math.abs(degrees) + minutes / 60 + seconds / 3600)
  } else if (Number.isFinite(decimal)) {
    result = decimal
    if (hemisphere === 'S' || hemisphere === 'W') result = -Math.abs(result)
    if (hemisphere === 'N' || hemisphere === 'E') result = Math.abs(result)
  } else {
    throw new Error(`无法解析${axis === 'lat' ? '纬度' : '经度'}：${value}`)
  }

  if (hemisphere && ((axis === 'lat' && !['N', 'S'].includes(hemisphere)) || (axis === 'lon' && !['E', 'W'].includes(hemisphere)))) {
    throw new Error(`${axis === 'lat' ? '纬度' : '经度'}的方位标记不正确。`)
  }
  return result
}

function parseCoordinatePair(value: string): { lat: number; lon: number } {
  const normalized = value.trim().replace(/[，]/g, ',')
  const dmsMatch = normalized.match(/^(.+?[NS])\s*[,;\s]+(.+?[EW])$/i)
  if (dmsMatch) return { lat: parseCoordinate(dmsMatch[1], 'lat'), lon: parseCoordinate(dmsMatch[2], 'lon') }

  const decimalParts = normalized.split(/\s*[,]\s*|\s+/).filter(Boolean)
  if (decimalParts.length === 2) {
    return { lat: parseCoordinate(decimalParts[0], 'lat'), lon: parseCoordinate(decimalParts[1], 'lon') }
  }

  throw new Error('请输入纬度和经度，例如 29.643956, 91.115842 或 29°38\'38.24"N 91°06\'57.03"E。')
}

function readSettings(): Settings {
  const coordinates = parseCoordinatePair(coordinateTextInput.value)
  return {
    lon: coordinates.lon,
    lat: coordinates.lat,
    groundElevation: Number(groundElevationInput.value),
  }
}

function isValidSettings(value: Settings): boolean {
  return Number.isFinite(value.lon)
    && value.lon >= -180
    && value.lon <= 180
    && Number.isFinite(value.lat)
    && value.lat >= -90
    && value.lat <= 90
    && Number.isFinite(value.groundElevation)
}

function syncUrl(value: Settings): void {
  const next = new URL(window.location.href)
  next.searchParams.set('lon', value.lon.toFixed(6))
  next.searchParams.set('lat', value.lat.toFixed(6))
  next.searchParams.set('ground', value.groundElevation.toFixed(1))
  next.searchParams.delete('height')
  window.history.replaceState(null, '', next)
}

function syncCameraOrbitToTarget(): void {
  mainCamera.up.set(0, 1, 0)
  mainCamera.lookAt(mainControls.target)
  mainCamera.updateMatrixWorld(true)
  mainControls.update()
}

function applyInitialOrbitView(): void {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(baseQuaternion)
  forward.y = 0
  if (forward.lengthSq() < 1e-6) {
    forward.set(0, 0, -1)
  }
  forward.normalize()
  const orbitDistance = Math.max(120, Math.min(mainControls.maxDistance * 0.4, 220))
  mainControls.target.copy(basePosition)
  mainCamera.position.copy(basePosition).add(forward.multiplyScalar(orbitDistance))
  mainCamera.position.y = basePosition.y
  syncCameraOrbitToTarget()
}

function applyCameraRotation(): void {
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'))
  mainCamera.position.copy(basePosition)
  mainCamera.quaternion.copy(baseQuaternion).multiply(rotation)
  mainCamera.up.set(0, 1, 0).applyQuaternion(baseQuaternion).normalize()
  mainCamera.updateMatrixWorld(true)
  mainControls.target.copy(basePosition).add(new THREE.Vector3(0, 0, -1).applyQuaternion(mainCamera.quaternion).multiplyScalar(100))
  mainControls.update()
}

function positionCamera(ellipsoid = tiles?.ellipsoid): void {
  if (!ellipsoid) return
  const radians = Math.PI / 180
  const matrix = new THREE.Matrix4()
  ellipsoid.getObjectFrame(
    settings.lat * radians,
    settings.lon * radians,
    settings.groundElevation,
    -90 * radians,
    0,
    0,
    matrix,
    CAMERA_FRAME,
  )
  matrix.decompose(basePosition, baseQuaternion, new THREE.Vector3())
  baseFrameMatrix.compose(basePosition, baseQuaternion, new THREE.Vector3(1, 1, 1))
  baseFrameInverse.copy(baseFrameMatrix).invert()
   yaw = 0
  pitch = 0
  applyCameraRotation()
  // applyInitialOrbitView()
  syncGlbOrigin()
  updateCameraMarkers()
}

function renderAnchorList(): void {
  anchorList.replaceChildren()
  for (const anchor of anchors) {
    const row = document.createElement('div')
    row.className = 'anchor-row'
    row.innerHTML = `
      <span>${anchor.label}</span>
      <span class="anchor-actions">
        <span class="anchor-meta">${anchor.capturedTiles.length} 个叶节点</span>
        <button class="secondary anchor-delete" type="button" data-anchor-id="${anchor.id}">删除</button>
      </span>
    `
    anchorList.append(row)
  }
}

function removeAnchor(anchorId: string): void {
  const index = anchors.findIndex((anchor) => anchor.id === anchorId)
  if (index < 0) return
  const [anchor] = anchors.splice(index, 1)
  for (const tile of anchor.capturedTiles) {
    discardCapturedTile(tile)
  }
  renderAnchorList()
  updateCameraMarkers()
  updateProgressUI()
  syncGlbPreviewAfterCaptureMutation()
}

function discardCapturedTile(tile: CapturableTile): void {
  const capturedNode = capturedTileNodes.get(tile)
  if (capturedNode) {
    glbCaptureRoot.remove(capturedNode)
    disposeObject3DResources(capturedNode)
    capturedTileNodes.delete(tile)
  }
  for (const anchor of anchors) {
    anchor.capturedTiles = anchor.capturedTiles.filter((capturedTile) => capturedTile !== tile)
  }
}

function syncGlbPreviewAfterCaptureMutation(messageIfEmpty = '当前视图没有可捕获的高精度叶节点'): void {
  if (capturedTileNodes.size === 0) {
    if (glbPreviewModel) {
      disposeObject3DResources(glbPreviewModel)
      glbScene.remove(glbPreviewModel)
      glbPreviewModel = null
    }
    glbPreviewBuffer = null
    glbPreviewRevision += 1
    glbPreviewRefreshRequested = false
    glbCameraFramed = false
    exportCurrentGlbButton.disabled = true
    exportTerrainPackageButton.disabled = true
    setGlbPlaceholder(messageIfEmpty, 'idle')
    setGlbPreviewStatus(messageIfEmpty, 'idle', '右侧预览已清空', 1800)
    return
  }

  setGlbPreviewStatus(
    '已删除锚点，正在重建 GLB 预览…',
    'loading',
    `当前保留 ${capturedTileNodes.size} 个高精度叶节点`,
  )
  glbPreviewRevision += 1
  void refreshGlbPreview()
}

function clearCapturedTiles(message = '等待首次锚点捕获'): void {
  resetGlbCaptureScene(message)
}

function setCaptureButtonState(): void {
  const ready = isTilesReady()
  addAnchorButton.disabled = !ready
  addAnchorButton.title = ready
    ? '添加当前相机为锚点'
    : tiles
      ? '瓦片仍在加载中，完成后才能添加锚点'
      : '请先加载 3D Tiles 数据源'
  exportCurrentGlbButton.disabled = exporting || capturedTileNodes.size === 0
  exportTerrainPackageButton.disabled = exporting || capturedTileNodes.size === 0
  exportTerrainDemButton.disabled = exporting || capturedTileNodes.size === 0
}

function hasVisibleDescendant(tile: CapturableTile, visibleTiles: Set<CapturableTile>): boolean {
  const children = tile.children ?? []
  for (const child of children as CapturableTile[]) {
    if (visibleTiles.has(child) || hasVisibleDescendant(child, visibleTiles)) return true
  }
  return false
}

function collectCurrentLeafTiles(): { tiles: CapturableTile[];  } {
  if (!tiles) return { tiles: [] }
  const visibleTiles = tiles.visibleTiles as Set<CapturableTile>
  const visible = [...visibleTiles]
    .filter((tile) => Boolean(tile.engineData?.scene))
    .filter((tile) => !hasVisibleDescendant(tile, visibleTiles))
  return {
    tiles: visible.sort((a, b) => (b.internal?.depth ?? 0) - (a.internal?.depth ?? 0))
  }
}

function isDescendantOf(candidate: CapturableTile, ancestor: CapturableTile): boolean {
  let current: CapturableTile | null = candidate
  while (current.parent) {
    current = current.parent as CapturableTile
    if (current === ancestor) return true
  }
  return false
}

function hasCapturedDescendant(ancestor: CapturableTile): boolean {
  for (const capturedTile of capturedTileNodes.keys() as IterableIterator<CapturableTile>) {
    if (capturedTile === ancestor) continue
    if (isDescendantOf(capturedTile, ancestor)) return true
  }
  return false
}

function hasUncapturedVisibleDescendant(ancestor: CapturableTile, visibleLeafTiles: CapturableTile[]): boolean {
  for (const visibleTile of visibleLeafTiles) {
    if (!isDescendantOf(visibleTile, ancestor)) continue
    if (!capturedTileNodes.has(visibleTile)) return true
  }
  return false
}

function pruneCoveredCapturedTiles(visibleLeafTiles: CapturableTile[]): void {
  let changed = true
  while (changed) {
    changed = false
    for (const capturedTile of [...capturedTileNodes.keys()] as CapturableTile[]) {
      if (!hasCapturedDescendant(capturedTile)) continue
      if (hasUncapturedVisibleDescendant(capturedTile, visibleLeafTiles)) continue
      discardCapturedTile(capturedTile)
      changed = true
    }
  }
}

function captureVisibleTiles(): number {
  if (!tiles) return 0
  tiles.update()
  const { tiles: candidates } = collectCurrentLeafTiles()
  const captureRadius = Math.max(mainCamera.near, Number(cameraFarInput.value) || mainCamera.far)
  let added = 0
  const capturedTilesForAnchor: CapturableTile[] = []
  let skippedLargeLeaves = 0

  for (const tile of candidates) {
    const scene = tile.engineData?.scene
    if (!scene)
       continue
    if (capturedTileNodes.has(tile)) 
      continue
    const captureBox = new THREE.Box3().setFromObject(scene)
    if (!captureBox.isEmpty()) {
      const captureSphere = captureBox.getBoundingSphere(new THREE.Sphere())
      const distanceToBase = captureSphere.center.distanceTo(basePosition)
      const intersectsCaptureRadius = distanceToBase - captureSphere.radius <= captureRadius
      const withinSizeLimit = captureSphere.radius <= captureRadius * 1.5
      if (!intersectsCaptureRadius || !withinSizeLimit) {
        skippedLargeLeaves += 1
        continue
      }
    }
    const tileGroup = createCapturedTileGroup(scene)
    if (tileGroup.children.length === 0)
       continue
    tileGroup.name = `captured-${capturedTileNodes.size + 1}`
    glbCaptureRoot.add(tileGroup)
    capturedTileNodes.set(tile, tileGroup)
    capturedTilesForAnchor.push(tile)
    added += 1
  }

  pruneCoveredCapturedTiles(candidates)
  glbSkippedLargeLeafCount += skippedLargeLeaves

  if (added > 0) {
    glbPreviewRevision += 1
    hideGlbPlaceholder()
    exportCurrentGlbButton.disabled = false
    exportTerrainPackageButton.disabled = false
    exportTerrainDemButton.disabled = false
    if (!glbCameraFramed) {
      syncGlbCameraToMainView()
      glbCameraFramed = true
    }
    setGlbPreviewStatus(
      '已捕获相机锚点',
      'loading',
      skippedLargeLeaves > 0
        ? `已捕获 ${capturedTileNodes.size} 个高精度叶节点，已过滤 ${skippedLargeLeaves} 个过大瓦片`
        : `已捕获 ${capturedTileNodes.size} 个高精度叶节点`,
    )
    void refreshGlbPreview()
  } else if (capturedTileNodes.size === 0) {
    setGlbPlaceholder('当前视图没有可捕获的高精度叶节点', 'idle')
    setGlbPreviewStatus(
      '当前视图没有可捕获的高精度叶节点',
      'idle',
      skippedLargeLeaves > 0
        ? `已过滤 ${skippedLargeLeaves} 个过大瓦片`
        : '请调整视角后重新添加锚点',
      1800,
    )
  } else {
    setGlbPreviewStatus(
      '当前视图没有新增叶节点',
      'idle',
      skippedLargeLeaves > 0
        ? `已保留之前捕获的最高精度瓦片，并过滤 ${skippedLargeLeaves} 个过大瓦片`
        : '已保留之前捕获的最高精度瓦片',
      1800,
    )
  }
  const anchorTiles = capturedTilesForAnchor.filter((tile) => capturedTileNodes.has(tile))
  if (anchorTiles.length > 0) {
    anchors.push({
      id: `anchor-${Date.now()}-${anchors.length}`,
      label: `锚点 ${anchors.length + 1}`,
      position: mainCamera.position.clone(),
      capturedTiles: anchorTiles,
    })
    renderAnchorList()
    updateCameraMarkers()
  }
  updateProgressUI()
  setCaptureButtonState()
  return added
}

function exportObject3D(object: THREE.Object3D): Promise<ArrayBuffer> {
  object.updateMatrixWorld(true)
  return new Promise<ArrayBuffer>((resolve, reject) => {
    new GLTFExporter().parse(
      object,
      (value) => value instanceof ArrayBuffer ? resolve(value) : reject(new Error('GLB 生成结果无效。')),
      (error) => reject(error instanceof Error ? error : new Error('GLB 生成失败。')),
      { binary: true, onlyVisible: true, includeCustomExtensions: true },
    )
  })
}

async function exportCurrentGlb(): Promise<void> {
  if (exporting) return
  if (capturedTileNodes.size === 0) {
    setGlbPreviewStatus('没有可导出的锚点内容', 'error', '请先添加一个锚点', 2200)
    return
  }
  exporting = true
  exportCurrentGlbButton.disabled = true
  try {
    if (!glbPreviewBuffer) throw new Error('GLB 预览还未准备好。')
    const blob = new Blob([glbPreviewBuffer], { type: 'model/gltf-binary' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `scene-${settings.lat.toFixed(5)}-${settings.lon.toFixed(5)}.glb`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    setGlbPreviewStatus('GLB 导出完成', 'ok', '文件已开始下载', 1600)
  } catch (error) {
    setGlbPreviewStatus(
      'GLB 导出失败',
      'error',
      error instanceof Error ? error.message : '请稍后重试',
      2400,
    )
  } finally {
    exporting = false
    setCaptureButtonState()
  }
}

function nextPowerOfTwoDown(value: number): number {
  if (value <= 1) return 1
  return 2 ** Math.floor(Math.log2(value))
}

async function encodeTextureToPackageFile(
  texture: THREE.Texture,
  maxSize: number,
  quality: number,
): Promise<EncodedTerrainTexture> {
  const image = texture.image
  let sourceCanvas: HTMLCanvasElement | null = null
  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
    sourceCanvas = image
  } else if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
    sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = image.width
    sourceCanvas.height = image.height
    sourceCanvas.getContext('2d')?.drawImage(image, 0, 0)
  } else if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) {
    sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = image.naturalWidth || image.width
    sourceCanvas.height = image.naturalHeight || image.height
    sourceCanvas.getContext('2d')?.drawImage(image, 0, 0)
  } else {
    sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = 2
    sourceCanvas.height = 2
  }
  if (!sourceCanvas || sourceCanvas.width <= 0 || sourceCanvas.height <= 0) {
    throw new Error('贴图无法光栅化。')
  }

  const sourceWidth = sourceCanvas.width
  const sourceHeight = sourceCanvas.height
  const largest = Math.max(sourceWidth, sourceHeight)
  const target = Math.min(maxSize, largest)
  let width = nextPowerOfTwoDown(Math.max(1, Math.round(sourceWidth * (target / largest))))
  let height = nextPowerOfTwoDown(Math.max(1, Math.round(sourceHeight * (target / largest))))
  width = Math.min(width, maxSize)
  height = Math.min(height, maxSize)

  let canvas = sourceCanvas
  if (width !== sourceWidth || height !== sourceHeight) {
    canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('无法创建贴图编码上下文。')
    }
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(sourceCanvas, 0, 0, width, height)
  }

  let hasAlpha = false
  const probe = document.createElement('canvas')
  probe.width = 64
  probe.height = 64
  const probeContext = probe.getContext('2d')
  if (probeContext) {
    probeContext.drawImage(canvas, 0, 0, 64, 64)
    const data = probeContext.getImageData(0, 0, 64, 64).data
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) {
        hasAlpha = true
        break
      }
    }
  }

  const extension = hasAlpha ? 'png' : 'jpg'
  const mimeType = hasAlpha ? 'image/png' : 'image/jpeg'
  const dataUrl = canvas.toDataURL(mimeType, hasAlpha ? undefined : Math.max(0.3, Math.min(0.95, quality)))
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return {
    id: '',
    extension: extension as 'jpg' | 'png',
    mimeType,
    bytes,
    width,
    height,
  }
}

async function encodeTerrainPackageTextures(
  root: THREE.Object3D,
  textureIds: Map<THREE.Texture, string>,
): Promise<Map<string, EncodedTerrainTexture>> {
  const uniqueTextures = new Map<string, THREE.Texture>()
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || !mesh.material) {
      return
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      for (const slot of TERRAIN_TEXTURE_SLOTS) {
        const texture = (material as unknown as Record<string, unknown>)[slot]
        if (!(texture instanceof THREE.Texture)) {
          continue
        }
        const id = textureIds.get(texture)
        if (id && !uniqueTextures.has(id)) {
          uniqueTextures.set(id, texture)
        }
      }
    }
  })

  const maxSize = Number(textureMaxSizeSelect.value) || 2048
  const quality = Number(textureQualityInput.value) || 0.8
  const encoded = new Map<string, EncodedTerrainTexture>()
  for (const [id, texture] of uniqueTextures) {
    const file = await encodeTextureToPackageFile(texture, maxSize, quality)
    file.id = id
    encoded.set(id, file)
  }
  return encoded
}

function texturelessMaterialFor(source: THREE.Material): THREE.MeshStandardMaterial {
  const record = source as THREE.Material & {
    color?: THREE.Color
    opacity?: number
    transparent?: boolean
    alphaTest?: number
    side?: THREE.Side
  }
  return new THREE.MeshStandardMaterial({
    color: record.color instanceof THREE.Color ? record.color.clone() : new THREE.Color(0xffffff),
    name: source.name,
    opacity: typeof record.opacity === 'number' ? record.opacity : 1,
    transparent: record.transparent === true,
    alphaTest: typeof record.alphaTest === 'number' ? record.alphaTest : 0,
    side: record.side ?? THREE.FrontSide,
  })
}

function cloneRootWithoutTextures(source: THREE.Object3D): THREE.Object3D {
  const clone = source.clone(false)
  const mesh = source as THREE.Mesh
  if (mesh.isMesh && mesh.material) {
    const cloneMesh = clone as THREE.Mesh
    cloneMesh.geometry = mesh.geometry.clone()
    cloneMesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((item) => texturelessMaterialFor(item))
      : texturelessMaterialFor(mesh.material)
  }
  for (const child of source.children) {
    clone.add(cloneRootWithoutTextures(child))
  }
  return clone
}

async function exportTerrainPackage(): Promise<void> {
  if (exporting) return
  if (capturedTileNodes.size === 0) {
    setGlbPreviewStatus('没有可导出的锚点内容', 'error', '请先添加一个锚点', 2200)
    return
  }
  exporting = true
  exportTerrainPackageButton.disabled = true
  exportCurrentGlbButton.disabled = true
  try {
    setGlbPreviewStatus('正在生成地形包…', 'loading', '焊接网格并编码贴图')
    const exportRoot = buildMergedCaptureRoot()
    try {
      recenterObject3D(exportRoot)

      const mergedMesh = exportRoot.getObjectByName('merged-terrain') as THREE.Mesh | undefined
      const textureIds = new Map<THREE.Texture, string>()
      if (mergedMesh?.isMesh && mergedMesh.material) {
        const materials = Array.isArray(mergedMesh.material) ? mergedMesh.material : [mergedMesh.material]
        for (const [texture, id] of assignTerrainTextureIds(materials)) {
          textureIds.set(texture, id)
        }
      }

      const encoded = await encodeTerrainPackageTextures(exportRoot, textureIds)

      if (mergedMesh?.isMesh && mergedMesh.material) {
        const materials = Array.isArray(mergedMesh.material) ? mergedMesh.material : [mergedMesh.material]
        const { bindings } = buildMeshTextureBindings(mergedMesh.name, materials, textureIds)
        for (const binding of bindings) {
          const file = encoded.get(binding.textureId)
          if (file) {
            binding.image = `textures/${binding.textureId}.${file.extension}`
          }
        }
        mergedMesh.userData.plTextureBindings = bindings
      }

      const textureless = cloneRootWithoutTextures(exportRoot)
      const glbBuffer = await exportObject3D(textureless)
      disposeObject3DResources(textureless)

      const textures = [...encoded.values()].map((file) => ({
        id: file.id,
        image: `textures/${file.id}.${file.extension}`,
        width: file.width,
        height: file.height,
        bytes: file.bytes.length,
        mimeType: file.mimeType,
      }))
      const manifest = {
        version: 1,
        glb: 'scene.glb',
        textures,
      }
      const zipEntries = [
        { name: 'scene.glb', bytes: new Uint8Array(glbBuffer) },
        ...[...encoded.values()].map((file) => ({
          name: `textures/${file.id}.${file.extension}`,
          bytes: file.bytes,
        })),
        { name: 'textures.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
      ]
      const zipBytes = buildZipArchive(zipEntries)
      const blob = new Blob([zipBytes], { type: 'application/zip' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `terrain-${settings.lat.toFixed(5)}-${settings.lon.toFixed(5)}.zip`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)

      const stats = lastTerrainMergeStats
      setGlbPreviewStatus(
        '地形包导出完成',
        'ok',
        `${encoded.size} 张贴图已外置 · 焊接 ${stats?.weldedVertexCount ?? 0} 顶点`,
        2400,
      )
    } finally {
      disposeObject3DResources(exportRoot)
    }
  } catch (error) {
    setGlbPreviewStatus(
      '地形包导出失败',
      'error',
      error instanceof Error ? error.message : '请稍后重试',
      2400,
    )
  } finally {
    exporting = false
    setCaptureButtonState()
  }
}

const ORTHO_TILE_SIZE = 1024

function readDemCellSizeOption(): number | 'auto' {
  const value = demCellSizeSelect.value
  if (value === 'auto') {
    return 'auto'
  }
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 'auto'
}

function yieldToBrowser(): Promise<void> {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0)
  })
}

/**
 * Flat, unlit copies of the merged mesh materials used for the ortho pass so
 * the imagery is albedo-like (no tone mapping, no scene lighting).
 */
function buildOrthoMaterials(source: THREE.Material | THREE.Material[]): THREE.Material[] {
  const materials = Array.isArray(source) ? source : [source]
  return materials.map((material) => {
    const record = material as THREE.Material & {
      map?: THREE.Texture | null
      color?: THREE.Color
      transparent?: boolean
      alphaTest?: number
    }
    return new THREE.MeshBasicMaterial({
      map: record.map ?? null,
      color: record.color instanceof THREE.Color ? record.color.clone() : new THREE.Color(0xffffff),
      transparent: record.transparent === true,
      alphaTest: typeof record.alphaTest === 'number' ? record.alphaTest : 0,
      side: THREE.DoubleSide,
    })
  })
}

/**
 * Renders the merged terrain top-down with an orthographic camera into the
 * same raster layout as the DEM (row 0 = north, col 0 = west).
 */
async function renderOrthoRaster(
  renderRoot: THREE.Object3D,
  mesh: THREE.Mesh,
  plan: DemGridPlan,
  onTile: (completed: number, total: number, label: string) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (signal?.aborted) throw new DemExportCancelledError()
  if (!mesh.geometry.boundingBox) {
    mesh.geometry.computeBoundingBox()
  }
  const box = mesh.geometry.boundingBox
  if (!box || box.isEmpty()) {
    throw new Error('正射渲染失败：地形网格包围盒为空。')
  }

  const originalMaterial = mesh.material
  const orthoMaterials = buildOrthoMaterials(originalMaterial)
  mesh.material = orthoMaterials

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setClearColor(0x000000, 1)
  renderer.setSize(ORTHO_TILE_SIZE, ORTHO_TILE_SIZE, false)

  const scene = new THREE.Scene()
  scene.add(renderRoot)

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
  camera.up.set(1, 0, 0)

  const renderTopY = box.max.y + Math.max(1, (box.max.y - box.min.y) * 0.05)
  const renderBottomY = box.min.y - Math.max(1, (box.max.y - box.min.y) * 0.05)

  const rgb = new Uint8Array(plan.rows * plan.cols * 3)
  const tileCols = Math.ceil(plan.cols / ORTHO_TILE_SIZE)
  const tileRows = Math.ceil(plan.rows / ORTHO_TILE_SIZE)
  const totalTiles = tileCols * tileRows
  const renderTarget = new THREE.WebGLRenderTarget(ORTHO_TILE_SIZE, ORTHO_TILE_SIZE, { depthBuffer: true })
  renderTarget.texture.colorSpace = THREE.SRGBColorSpace
  const rgba = new Uint8Array(ORTHO_TILE_SIZE * ORTHO_TILE_SIZE * 4)

  try {
    let tileIndex = 0
    for (let tileRow = 0; tileRow < tileRows; tileRow += 1) {
      for (let tileCol = 0; tileCol < tileCols; tileCol += 1) {
        const colStart = tileCol * ORTHO_TILE_SIZE
        const rowStart = tileRow * ORTHO_TILE_SIZE
        const tileWidth = Math.min(ORTHO_TILE_SIZE, plan.cols - colStart)
        const tileHeight = Math.min(ORTHO_TILE_SIZE, plan.rows - rowStart)
        if (tileWidth <= 0 || tileHeight <= 0) {
          continue
        }

        if (signal?.aborted) throw new DemExportCancelledError()
        const cameraFrame = resolveDemOrthoCameraFrame(plan, {
          rowStart,
          colStart,
          width: ORTHO_TILE_SIZE,
          height: ORTHO_TILE_SIZE,
        })

        camera.left = cameraFrame.left
        camera.right = cameraFrame.right
        camera.top = cameraFrame.top
        camera.bottom = cameraFrame.bottom
        camera.near = 0.1
        camera.far = renderTopY - renderBottomY
        camera.position.set(cameraFrame.xCenter, renderTopY, cameraFrame.zCenter)
        camera.updateProjectionMatrix()
        camera.lookAt(cameraFrame.xCenter, renderBottomY, cameraFrame.zCenter)
        camera.updateMatrixWorld(true)

        renderer.setRenderTarget(renderTarget)
        renderer.render(scene, camera)
        await renderer.readRenderTargetPixelsAsync(
          renderTarget,
          0,
          0,
          ORTHO_TILE_SIZE,
          ORTHO_TILE_SIZE,
          rgba,
        )
        renderer.setRenderTarget(null)
        if (signal?.aborted) throw new DemExportCancelledError()

        copyRenderTargetTileToOrtho({
          rgba,
          tileWidth: ORTHO_TILE_SIZE,
          tileHeight: ORTHO_TILE_SIZE,
          rasterRowStart: rowStart,
          rasterColStart: colStart,
          rasterRows: plan.rows,
          rasterCols: plan.cols,
          rgb,
        })

        tileIndex += 1
        onTile(tileIndex, totalTiles, `渲染正射影像 ${tileIndex}/${totalTiles}`)
        await yieldToBrowser()
      }
    }
  } finally {
    scene.remove(renderRoot)
    mesh.material = originalMaterial
    for (const material of orthoMaterials) {
      material.dispose()
    }
    renderTarget.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }

  return rgb
}

const DEM_PHASE_LABELS: Record<DemExportPhase, string> = {
  prepare: '准备导出数据',
  merge: '合并地形网格',
  sample: '采样 DEM',
  'fill-dem': '填充 DEM 空洞',
  'encode-dem': '编码 DEM',
  'ortho-render': '渲染正射影像',
  'ortho-process': '处理正射影像',
  'encode-ortho': '编码正射影像',
  package: '打包 ZIP',
}

const DEM_PHASE_ORDER: DemExportPhase[] = [
  'prepare',
  'merge',
  'sample',
  'fill-dem',
  'encode-dem',
  'ortho-render',
  'ortho-process',
  'encode-ortho',
  'package',
]

const DEM_PHASE_WEIGHTS_WITH_ORTHO: Partial<Record<DemExportPhase, number>> = {
  prepare: 2,
  merge: 12,
  sample: 46,
  'fill-dem': 8,
  'encode-dem': 5,
  'ortho-render': 17,
  'ortho-process': 5,
  'encode-ortho': 3,
  package: 2,
}

const DEM_PHASE_WEIGHTS_WITHOUT_ORTHO: Partial<Record<DemExportPhase, number>> = {
  prepare: 3,
  merge: 15,
  sample: 60,
  'fill-dem': 10,
  'encode-dem': 7,
  package: 5,
}

function formatExportDuration(elapsedMs: number): string {
  if (elapsedMs < 1000) return `${Math.max(0, Math.round(elapsedMs))} ms`
  if (elapsedMs < 60_000) return `${(elapsedMs / 1000).toFixed(1)} s`
  const minutes = Math.floor(elapsedMs / 60_000)
  const seconds = Math.round((elapsedMs % 60_000) / 1000)
  return `${minutes} min ${seconds} s`
}

function createDemProgressReporter(hasOrtho: boolean, startedAt: number) {
  const weights = hasOrtho ? DEM_PHASE_WEIGHTS_WITH_ORTHO : DEM_PHASE_WEIGHTS_WITHOUT_ORTHO
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + (weight ?? 0), 0)
  const elapsedByPhase = new Map<DemExportPhase, number>()
  let current: Extract<DemWorkerResponse, { type: 'progress' }> = {
    type: 'progress',
    phase: 'prepare',
    completed: 0,
    total: 1,
    label: '准备捕获的地形数据',
  }
  let phaseStartedAt = startedAt
  let stopped = false

  const finishCurrentPhase = (now: number): void => {
    const elapsed = now - phaseStartedAt
    elapsedByPhase.set(current.phase, (elapsedByPhase.get(current.phase) ?? 0) + elapsed)
    phaseStartedAt = now
  }

  const render = (): void => {
    if (stopped) return
    const now = performance.now()
    const stageFraction = current.total > 0
      ? Math.max(0, Math.min(1, current.completed / current.total))
      : 1
    let weightedPercent = 0
    for (const phase of DEM_PHASE_ORDER) {
      const weight = weights[phase] ?? 0
      if (phase === current.phase) {
        weightedPercent += weight * stageFraction
        break
      }
      weightedPercent += weight
    }
    weightedPercent = totalWeight > 0 ? (weightedPercent / totalWeight) * 100 : 0
    const stageElapsed = elapsedByPhase.get(current.phase) ?? 0
    const runningElapsed = now - phaseStartedAt
    const totalElapsed = now - startedAt
    setGlbPreviewStatus(
      DEM_PHASE_LABELS[current.phase],
      'loading',
      `${current.label} · 阶段 ${formatExportDuration(stageElapsed + runningElapsed)} · 总 ${formatExportDuration(totalElapsed)}`,
      undefined,
      weightedPercent,
    )
  }

  const timer = window.setInterval(render, 250)
  render()
  return {
    update(progress: Extract<DemWorkerResponse, { type: 'progress' }>): void {
      if (stopped) return
      if (progress.phase !== current.phase) {
        finishCurrentPhase(performance.now())
        phaseStartedAt = performance.now()
      }
      current = progress
      render()
    },
    snapshotTimings(): DemExportStageTiming[] {
      const now = performance.now()
      const timings: DemExportStageTiming[] = []
      for (const phase of DEM_PHASE_ORDER) {
        const elapsed = (elapsedByPhase.get(phase) ?? 0) + (phase === current.phase ? now - phaseStartedAt : 0)
        if (elapsed > 0) timings.push({ phase, elapsedMs: elapsed })
      }
      return timings
    },
    stop(): void {
      if (stopped) return
      stopped = true
      window.clearInterval(timer)
    },
  }
}

function summarizeDemStageTimings(timings: DemExportStageTiming[]): string {
  const selected: DemExportPhase[] = ['merge', 'sample', 'ortho-render', 'package']
  return selected
    .map((phase) => {
      const timing = timings.find((item) => item.phase === phase)
      return timing ? `${DEM_PHASE_LABELS[phase]} ${formatExportDuration(timing.elapsedMs)}` : null
    })
    .filter((value): value is string => value !== null)
    .join(' · ')
}

async function exportTerrainDemPackage(): Promise<void> {
  if (exporting) return
  if (capturedTileNodes.size === 0) {
    setGlbPreviewStatus('没有可导出的锚点内容', 'error', '请先添加一个锚点', 2200)
    return
  }

  exporting = true
  exportTerrainDemButton.disabled = true
  exportCurrentGlbButton.disabled = true
  exportTerrainPackageButton.disabled = true

  const startedAt = performance.now()
  const settingsSnapshot = { ...settings }
  const includeOrtho = demOrthoInput.checked
  const cellSize = readDemCellSizeOption()
  const createdAt = new Date().toISOString()
  const controller = new AbortController()
  const reporter = createDemProgressReporter(includeOrtho, startedAt)
  let exportRoot: THREE.Group | null = null
  let worker: DemExportWorkerClient | null = null
  let focusedPhase: DemExportPhase = 'prepare'

  const throwIfCancelled = (): void => {
    if (controller.signal.aborted) throw new DemExportCancelledError()
  }

  try {
    await yieldToBrowser()
    throwIfCancelled()
    worker = new DemExportWorkerClient((progress) => {
      focusedPhase = progress.phase
      reporter.update(progress)
    })
    activeDemExport = { controller, worker }
    setGlbPreviewCancelHandler(() => {
      if (controller.signal.aborted) return
      controller.abort()
      worker?.cancel()
      reporter.stop()
      setGlbPreviewCancelHandler(null)
      setGlbPreviewStatus(
        '正在取消 DEM 导出',
        'loading',
        `已用时 ${formatExportDuration(performance.now() - startedAt)}`,
      )
    })

    reporter.update({
      type: 'progress',
      phase: 'prepare',
      completed: 0,
      total: 1,
      label: '收集当前锚点地形',
    })
    const { sources, materials, looseNodes, rawLeafNodes } = collectTerrainMergeSources(glbCaptureRoot)
    if (sources.length === 0 || materials.length === 0) {
      throw new Error('当前锚点没有可导出的地形网格。')
    }
    const sourcePayload = toWorkerMergeSources(sources)
    throwIfCancelled()

    const mergeOptions = readTerrainMergeOptions()
    const merged = await worker.merge(sourcePayload, {
      weldEpsilon: mergeOptions.weldEpsilon ?? 0.05,
      stripSkirts: mergeOptions.stripSkirts !== false,
      smoothNormals: mergeOptions.smoothNormals !== false,
    })
    throwIfCancelled()
    lastTerrainMergeStats = merged.stats
    reporter.update({
      type: 'progress',
      phase: 'merge',
      completed: 1,
      total: 1,
      label: `地形网格合并完成 ${merged.stats.outputTriangleCount} 三角形`,
    })

    exportRoot = buildDemExportRoot(merged, materials, looseNodes, rawLeafNodes)
    const mergedMesh = exportRoot.getObjectByName('merged-terrain') as THREE.Mesh | undefined
    if (!mergedMesh || !mergedMesh.isMesh || !mergedMesh.geometry) {
      throw new Error('当前锚点没有可导出的合并地形网格。')
    }

    const { plan, warnings } = planDemGrid(mergedMesh.geometry, { cellSize })
    const frame: DemExportFrame = {
      latitudeDegrees: settingsSnapshot.lat,
      longitudeDegrees: settingsSnapshot.lon,
      groundElevationMeters: settingsSnapshot.groundElevation,
    }
    reporter.update({
      type: 'progress',
      phase: 'sample',
      completed: 0,
      total: merged.stats.outputTriangleCount,
      label: `网格 ${plan.cols}×${plan.rows} · 间距 ${plan.cellSizeMeters}m`,
    })
    await worker.sample(plan, frame, warnings, merged.stats.outputTriangleCount)
    throwIfCancelled()

    let rgb: Uint8Array | null = null
    if (includeOrtho) {
      focusedPhase = 'ortho-render'
      const tileCols = Math.ceil(plan.cols / ORTHO_TILE_SIZE)
      const tileRows = Math.ceil(plan.rows / ORTHO_TILE_SIZE)
      const totalTiles = tileCols * tileRows
      reporter.update({
        type: 'progress',
        phase: 'ortho-render',
        completed: 0,
        total: totalTiles,
        label: `准备渲染 ${totalTiles} 个正射瓦片`,
      })
      rgb = await renderOrthoRaster(
        exportRoot,
        mergedMesh,
        plan,
        (completed, total, label) => {
          focusedPhase = 'ortho-render'
          reporter.update({
            type: 'progress',
            phase: 'ortho-render',
            completed,
            total,
            label,
          })
        },
        controller.signal,
      )
    }

    throwIfCancelled()
    const zipBytes = await worker.finish(rgb, createdAt)
    throwIfCancelled()
    reporter.update({
      type: 'progress',
      phase: 'package',
      completed: 1,
      total: 1,
      label: 'ZIP 打包完成',
    })

    const blob = new Blob([zipBytes], { type: 'application/zip' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `terrain-dem-${settingsSnapshot.lat.toFixed(5)}-${settingsSnapshot.lon.toFixed(5)}.zip`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)

    const timings = reporter.snapshotTimings()
    reporter.stop()
    setGlbPreviewCancelHandler(null)
    const totalElapsed = performance.now() - startedAt
    setGlbPreviewStatus(
      'DEM 包导出完成',
      'ok',
      `${plan.cols}×${plan.rows} · ${plan.cellSizeMeters}m 间距${includeOrtho ? ' · 含正射影像' : ''} · 总 ${formatExportDuration(totalElapsed)}${summarizeDemStageTimings(timings) ? ` · ${summarizeDemStageTimings(timings)}` : ''}`,
      4200,
      100,
    )
  } catch (error) {
    reporter.stop()
    setGlbPreviewCancelHandler(null)
    const cancelled = controller.signal.aborted
      || (error instanceof Error && error.name === 'AbortError')
    if (cancelled) {
      setGlbPreviewStatus(
        'DEM 导出已取消',
        'idle',
        `未生成下载文件 · 已用时 ${formatExportDuration(performance.now() - startedAt)}`,
        3600,
        0,
      )
    } else {
      const stage = DEM_PHASE_LABELS[focusedPhase]
      setGlbPreviewStatus(
        'DEM 包导出失败',
        'error',
        `${stage}：${error instanceof Error ? error.message : '请稍后重试'} · 已用时 ${formatExportDuration(performance.now() - startedAt)}`,
        4800,
      )
    }
  } finally {
    reporter.stop()
    worker?.close()
    if (activeDemExport?.worker === worker) activeDemExport = null
    setGlbPreviewCancelHandler(null)
    disposeObject3DResources(exportRoot)
    exporting = false
    setCaptureButtonState()
  }
}

function resizeMain(): void {
  const width = Math.max(1, viewport.clientWidth)
  const height = Math.max(1, viewport.clientHeight)
  mainRenderer.setSize(width, height, false)
  mainCamera.aspect = width / height
  mainCamera.updateProjectionMatrix()
  tiles?.setResolutionFromRenderer(mainCamera, mainRenderer)
}

function resizeGlb(): void {
  const width = Math.max(1, glbPreviewViewport.clientWidth)
  const height = Math.max(1, glbPreviewViewport.clientHeight)
  glbRenderer.setSize(width, height, false)
  glbCamera.aspect = width / height
  glbCamera.updateProjectionMatrix()
}

function disposeTiles(): void {
  if (!tiles) return
  tiles.dispose()
  mainScene.remove(tiles.group)
  tiles = null
  sourceLabel = '-'
  clearCapturedTiles()
  updateStats()
  setCaptureButtonState()
}

async function loadTiles(): Promise<void> {
  const env = import.meta.env
  const tilesUrl = String(env.VITE_TILES_URL ?? '').trim()
  const ionToken = String(env.VITE_CESIUM_ION_TOKEN ?? '').trim()
  const ionAssetId = String(env.VITE_CESIUM_ION_ASSET_ID ?? '').trim()
  const hasIon = Boolean(ionToken && ionAssetId)

  if (!tilesUrl && !hasIon) {
    configHelp.hidden = false
    sourceLabel = '未配置'
    setStatus('需要配置数据源', 'error')
    setPlaceholder('请配置 VITE_TILES_URL，或配置 Cesium Ion Token + Asset ID。', 'error')
    updateStats()
    setCaptureButtonState()
    return
  }

  configHelp.hidden = true
  setPlaceholder('正在加载 3D Tiles…', 'loading')
  setStatus('加载中…')
  disposeTiles()
  clearCapturedTiles()

  try {
    const next = new TilesRenderer(tilesUrl || undefined)
    next.errorTarget = Number(precisionInput.value)
    const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/')
    next.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }))
    next.registerPlugin(new TilesFadePlugin())
    next.registerPlugin(new UpdateOnChangePlugin())
    if (hasIon) next.registerPlugin(new CesiumIonAuthPlugin({ apiToken: ionToken, assetId: ionAssetId, autoRefreshToken: true }))

    positionCamera(next.ellipsoid)
    next.setCamera(mainCamera)
    next.setResolutionFromRenderer(mainCamera, mainRenderer)
    next.addEventListener('load-error', (event: unknown) => {
      const message = event instanceof Error ? event.message : '3D Tiles 请求失败，请检查 URL、Token 和 CORS 配置。'
      setStatus('加载错误', 'error')
      setPlaceholder(message, 'error')
    })

    tiles = next
    sourceLabel = hasIon ? `Cesium Ion / ${ionAssetId}` : tilesUrl
    mainScene.add(next.group)
    positionCamera()
    hidePlaceholder()
    setStatus('已就绪', 'ok')
    addAnchorButton.disabled = false
    updateStats()
    updateProgressUI()
    setCaptureButtonState()
  } catch (error) {
    disposeTiles()
    setStatus('加载失败', 'error')
    setPlaceholder(error instanceof Error ? error.message : '无法初始化 3D Tiles。', 'error')
  }
}

function applyLocation(): void {
  let next: Settings
  try {
    next = readSettings()
  } catch (error) {
    setStatus('坐标无效', 'error')
    setPlaceholder(error instanceof Error ? error.message : '无法解析坐标。', 'error')
    return
  }

  if (!isValidSettings(next)) {
    setStatus('坐标无效', 'error')
    setPlaceholder('经度需在 -180..180，纬度需在 -90..90，地面海拔和观察高度必须是有效数字，且观察高度不能小于 0。', 'error')
    return
  }

  Object.assign(settings, next)
  syncUrl(settings)
  if (tiles) positionCamera()
  clearCapturedTiles()
  updateStats()
  setStatus(tiles ? '已定位' : '等待数据源', tiles ? 'ok' : 'idle')
}

function updateTileCameraRange(): void {
  const value = Number(cameraFarInput.value)
  if (!Number.isFinite(value) || value <= mainCamera.near) return
  mainCamera.far = value
  mainCamera.updateProjectionMatrix()
  tiles?.update()
  clearCapturedTiles()
}
function handleAddAnchor(): void {
  if (!tiles) return
  if (!isTilesReady()) {
    setStatus('瓦片加载中，暂不可添加锚点', 'idle')
    setGlbPreviewStatus(
      '瓦片加载中，暂不可添加锚点',
      'loading',
      '等待当前 3D Tiles 完全加载后再添加锚点',
      1800,
    )
    return
  }
  mainControls.update()
  setGlbPreviewStatus(
    '正在捕获相机锚点…',
    'loading',
    '正在筛选当前可见的高精度叶节点',
  )
  const added = captureVisibleTiles()
  if (added === 0 && capturedTileNodes.size === 0) {
    setStatus('没有可捕获内容', 'error')
  } else if (added > 0) {
    setStatus(`已添加锚点 ${anchors.length}`, 'ok')
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.matches('input, textarea, select, [contenteditable="true"]')
}

function handleShortcut(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.repeat) return
  if (event.altKey || event.ctrlKey || event.metaKey) return
  if (isTypingTarget(event.target)) return
  const key = event.key.toLowerCase()
  if (key === 'q') {
    event.preventDefault()
    syncGlbCameraToMainView()
    glbCameraFramed = true
    setGlbPreviewStatus(
      '右侧视角已同步',
      'ok',
      '已跟随左侧当前相机角度',
      1600,
    )
    return
  }
  if (key !== 'c') return
  event.preventDefault()
  addAnchorButton.click()
}

$('#apply-location').addEventListener('click', applyLocation)
addAnchorButton.addEventListener('click', handleAddAnchor)
exportCurrentGlbButton.addEventListener('click', () => void exportCurrentGlb())
exportTerrainPackageButton.addEventListener('click', () => void exportTerrainPackage())
exportTerrainDemButton.addEventListener('click', () => void exportTerrainDemPackage())
glbPreviewCancelButton.addEventListener('click', () => glbPreviewCancelHandler?.())
anchorList.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  const deleteButton = target.closest<HTMLButtonElement>('.anchor-delete')
  if (!deleteButton) return
  const anchorId = deleteButton.dataset.anchorId
  if (!anchorId) return
  removeAnchor(anchorId)
})
precisionInput.addEventListener('input', () => {
  const value = Number(precisionInput.value)
  precisionValue.textContent = String(value)
  if (tiles) {
    tiles.errorTarget = value
    tiles.update()
    clearCapturedTiles()
  }
})

cameraFarInput.addEventListener('input', updateTileCameraRange)
window.addEventListener('keydown', handleShortcut)
window.addEventListener('resize', () => {
  resizeMain()
  resizeGlb()
})

const viewportResizeObserver = new ResizeObserver(() => {
  resizeMain()
  resizeGlb()
})
viewportResizeObserver.observe(viewport)
viewportResizeObserver.observe(glbPreviewViewport)

function animate(): void {
  const now = performance.now()
  mainFlyController.update(now)
  glbFlyController.update(now)
  mainControls.update()
  glbControls.update()
  tiles?.update()
  mainRenderer.render(mainScene, mainCamera)
  glbRenderer.render(glbScene, glbCamera)
  updateProgressUI()
  requestAnimationFrame(animate)
}

resizeMain()
resizeGlb()

async function bootstrap(): Promise<void> {
  await applyDefaultSkybox()
  loadTiles().catch((error) => {
    setStatus('初始化失败', 'error')
    setPlaceholder(error instanceof Error ? error.message : '初始化失败', 'error')
  })
  animate()
}

void bootstrap()
