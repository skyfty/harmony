import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { TilesRenderer, CAMERA_FRAME } from '3d-tiles-renderer'
import { CesiumIonAuthPlugin } from '3d-tiles-renderer/core/plugins'
import { GLTFExtensionsPlugin, TilesFadePlugin, UpdateOnChangePlugin } from '3d-tiles-renderer/three/plugins'
import stylesText from './styles.css?raw'

type Settings = { lon: number; lat: number; groundElevation: number; height: number }
type CameraAnchor = { id: string; label: string; position: THREE.Vector3; quaternion: THREE.Quaternion; far: number }
type ExportAnchor = { id: string; label: string; position: THREE.Vector3; quaternion: THREE.Quaternion; far: number }

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
      <section class="panel controls">
        <div class="panel-header"><h2>观察点</h2><span class="chip">固定位置</span></div>
        <label>经纬度 <input id="coordinate-text" type="text" inputmode="text" placeholder="29°38'38.24\"N 91°06'57.03\"E" /></label>
        <div class="coordinate-grid">
          <label>地面海拔 (m)<input id="ground-elevation" type="number" step="0.1" placeholder="0" /></label>
          <label>观察高度 (m)<input id="height" type="number" step="0.1" min="0" value="0" /></label>
        </div>
        <div class="actions"><button id="apply-location">定位并加载</button><button class="secondary" id="reset-location">恢复视点</button></div>

        <label class="range-label">瓦片精度 <span><strong id="precision-value">6</strong> px</span><input id="precision" type="range" min="1" max="32" step="1" value="6" /></label>
        <label>相机 Far 范围 (m)<input id="camera-far" type="number" min="50" max="10000000" step="1000" value="10000" /></label>
        <div class="actions wide"><button id="add-anchor" disabled>添加当前相机为锚点</button></div>
        <div class="anchor-list" id="anchor-list"></div>
        <div class="actions"><button id="export-glb" disabled>导出 GLB</button><button id="preview-glb" class="secondary" disabled>预览 GLB</button></div>
        <div class="progress-wrap" id="progress" hidden><div class="progress"><div id="progress-bar"></div></div><div class="progress-label" id="progress-label"></div></div>

        <div class="callout" id="config-help" hidden>
          请在 <code>tools/3dtiles-viewer/.env.local</code> 配置 <code>VITE_TILES_URL</code>，或同时配置 <code>VITE_CESIUM_ION_TOKEN</code> 与 <code>VITE_CESIUM_ION_ASSET_ID</code>。
        </div>
        <div class="stats">
          <div class="stat"><span>数据源</span><strong id="source-stat">-</strong></div>
          <div class="stat"><span>Tiles group</span><strong id="tiles-stat">-</strong></div>
          <div class="stat"><span>观察点</span><strong id="location-stat">-</strong></div>
          <div class="stat"><span>渲染器</span><strong id="renderer-stat">-</strong></div>
        </div>
      </section>

      <section class="panel viewer">
        <div class="viewport" id="viewport"><div class="placeholder" id="placeholder">正在初始化…</div></div>
      </section>
    </main>
    <div class="glb-preview" id="glb-preview" hidden>
      <div class="glb-preview-panel">
        <button id="export-current-glb" disabled>Export current GLB</button>
        <div class="panel-header"><h2>GLB 预览</h2><button class="secondary" id="close-glb-preview">关闭</button></div>
        <div class="glb-preview-viewport" id="glb-preview-viewport"><div class="placeholder" id="glb-preview-placeholder">等待 GLB 数据</div></div>
        <p class="help">拖动旋转，滚轮缩放，右键拖动平移。</p>
      </div>
    </div>
  </div>
`

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const viewport = $('#viewport')
const placeholder = $('#placeholder')
const statusChip = $('#status-chip')
const groundElevationInput = $('#ground-elevation') as HTMLInputElement
const heightInput = $('#height') as HTMLInputElement
const coordinateTextInput = $('#coordinate-text') as HTMLInputElement
const precisionInput = $('#precision') as HTMLInputElement
const precisionValue = $('#precision-value')
const cameraFarInput = $('#camera-far') as HTMLInputElement
const addAnchorButton = $('#add-anchor') as HTMLButtonElement
const anchorList = $('#anchor-list')
const sourceStat = $('#source-stat')
const tilesStat = $('#tiles-stat')
const locationStat = $('#location-stat')
const rendererStat = $('#renderer-stat')
const progress = $('#progress')
const progressBar = $('#progress-bar')
const progressLabel = $('#progress-label')
const configHelp = $('#config-help')
const exportGlbButton = $('#export-glb') as HTMLButtonElement
const exportCurrentGlbButton = $('#export-current-glb') as HTMLButtonElement
const previewGlbButton = $('#preview-glb') as HTMLButtonElement
const glbPreview = $('#glb-preview')
const closeGlbPreviewButton = $('#close-glb-preview') as HTMLButtonElement
const glbPreviewViewport = $('#glb-preview-viewport')
const glbPreviewPlaceholder = $('#glb-preview-placeholder')
const glbPreviewProgress = document.createElement('p')
glbPreviewProgress.className = 'help glb-preview-progress'
glbPreview.querySelector('.glb-preview-panel')?.append(glbPreviewProgress)
glbPreview.querySelector('.panel-header')?.append(exportCurrentGlbButton)

const query = new URLSearchParams(window.location.search)
const settings: Settings = {
  lon: Number(query.get('lon') ?? 91.1158416667),
  lat: Number(query.get('lat') ?? 29.6439555556),
  groundElevation: Number(query.get('ground') ?? query.get('groundElevation') ?? 3651.5),
  height: Number(query.get('height') ?? 0),
}
coordinateTextInput.value = query.has('lat') || query.has('lon')
  ? `${settings.lat}, ${settings.lon}`
  : `29°38'38.24"N 91°06'57.03"E`
groundElevationInput.value = String(settings.groundElevation)
heightInput.value = String(settings.height)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#050d18')
scene.add(new THREE.HemisphereLight('#c9e9ff', '#142034', 1.25))
const sun = new THREE.DirectionalLight('#fff2d4', 2.2)
sun.position.set(20, 40, 10)
scene.add(sun)
const cameraMarkerGroup = new THREE.Group()
cameraMarkerGroup.name = 'camera-markers'
scene.add(cameraMarkerGroup)

const camera = new THREE.PerspectiveCamera(75, 1, 0.5, 10_000)
const previewCamera = camera
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.AgXToneMapping
renderer.toneMappingExposure = 1.25
viewport.append(renderer.domElement)
const mainControls = new MapControls(camera, renderer.domElement)
mainControls.enableDamping = true
mainControls.dampingFactor = 0.05
mainControls.screenSpacePanning = false
mainControls.minDistance = 100
mainControls.maxDistance = 500
mainControls.maxPolarAngle = Math.PI
mainControls.zoomToCursor = true
rendererStat.textContent = renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1'

let tiles: TilesRenderer | null = null
let sourceLabel = '-'
let basePosition = new THREE.Vector3()
let baseQuaternion = new THREE.Quaternion()
let yaw = 0
let pitch = 0
let exporting = false
let lastExportedGlb: ArrayBuffer | null = null
let previewRequested = false
let anchors: CameraAnchor[] = []
let glbPreviewRenderer: THREE.WebGLRenderer | null = null
let glbPreviewScene: THREE.Scene | null = null
let glbPreviewCamera: THREE.PerspectiveCamera | null = null
let glbPreviewControls: MapControls | null = null
let glbPreviewModel: THREE.Object3D | null = null
let previewSession: {
  cameras: THREE.PerspectiveCamera[]
  previousCameras: THREE.Camera[]
  previousDisplayActiveTiles: boolean
  mainCamera: {
    position: THREE.Vector3
    quaternion: THREE.Quaternion
    up: THREE.Vector3
    near: number
    far: number
    fov: number
    aspect: number
    target: THREE.Vector3
  }
  radius: number
  generation: number
  stableFrames: number
  lastSignature: string
  stable: boolean
  generationTimer: number | null
  generationInFlight: boolean
  closed: boolean
} | null = null

function invalidateGlbCache(): void {
  lastExportedGlb = null
  previewGlbButton.disabled = !tiles
  exportCurrentGlbButton.disabled = true
  if (previewSession) {
    const radius = Number(cameraFarInput.value)
    stopPreviewSession()
    beginPreviewSession(Number.isFinite(radius) ? radius : 10_000)
    schedulePreviewGeneration()
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

function hidePlaceholder(): void { placeholder.hidden = true }

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
      item.map?.dispose()
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

function isValidSettings(value: Settings): boolean {
  return Number.isFinite(value.lon) && value.lon >= -180 && value.lon <= 180 && Number.isFinite(value.lat) && value.lat >= -90 && value.lat <= 90 && Number.isFinite(value.groundElevation) && Number.isFinite(value.height) && value.height >= 0
}

function parseCoordinate(value: string, axis: 'lat' | 'lon'): number {
  const normalized = value.trim().replace(/[′’]/g, "'").replace(/[″”]/g, '"').replace(/，/g, ',')
  if (!normalized) throw new Error(`${axis === 'lat' ? '纬度' : '经度'}不能为空。`)

  const hemisphere = normalized.match(/[NSEW]$/i)?.[0].toUpperCase() as 'N' | 'S' | 'E' | 'W' | undefined
  const body = normalized.replace(/[NSEW]$/i, '').trim()
  const dms = body.match(/^([+-]?\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*["″])?$/)
  const decimal = Number(body)
  let result: number

  if (dms) {
    const degrees = Number(dms[1])
    const minutes = dms[2] ? Number(dms[2]) : 0
    const seconds = dms[3] ? Number(dms[3]) : 0
    if (minutes >= 60 || seconds >= 60) throw new Error(`${axis === 'lat' ? '纬度' : '经度'}的分或秒必须小于 60。`)
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
  const normalized = value.trim().replace(/[′’]/g, "'").replace(/[″”]/g, '"')
  const dmsMatch = normalized.match(/^(.+?[NS])\s*[,;\s]+(.+?[EW])$/i)
  if (dmsMatch) return { lat: parseCoordinate(dmsMatch[1], 'lat'), lon: parseCoordinate(dmsMatch[2], 'lon') }

  const decimalParts = normalized.split(/\s*[,，;]\s*|\s+/).filter(Boolean)
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
    height: Number(heightInput.value),
  }
}

function syncUrl(value: Settings): void {
  const next = new URL(window.location.href)
  next.searchParams.set('lon', value.lon.toFixed(6))
  next.searchParams.set('lat', value.lat.toFixed(6))
  next.searchParams.set('ground', value.groundElevation.toFixed(1))
  next.searchParams.set('height', value.height.toFixed(1))
  window.history.replaceState(null, '', next)
}

function updateStats(): void {
  sourceStat.textContent = sourceLabel
  tilesStat.textContent = tiles ? `${tiles.group.children.length} objects` : '-'
  locationStat.textContent = `${settings.lat.toFixed(5)}, ${settings.lon.toFixed(5)} @ ground ${settings.groundElevation.toFixed(1)}m / camera ${(settings.groundElevation + settings.height).toFixed(1)}m`
}

function applyCameraRotation(): void {
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'))
  camera.position.copy(basePosition)
  camera.quaternion.copy(baseQuaternion).multiply(rotation)
  camera.up.set(0, 1, 0).applyQuaternion(baseQuaternion).normalize()
  camera.updateMatrixWorld()
  mainControls.target.copy(basePosition).add(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(100))
  mainControls.update()
}

function renderAnchorList(): void {
  anchorList.replaceChildren()
  for (const anchor of anchors) {
    const row = document.createElement('div')
    row.className = 'anchor-row'
    row.innerHTML = `<span>${anchor.label}</span><span class="anchor-actions"><button data-action="view">查看</button><button data-action="level">水平</button><button data-action="delete" class="secondary">删除</button></span>`
    row.querySelector('[data-action="view"]')?.addEventListener('click', () => focusAnchor(anchor, false))
    row.querySelector('[data-action="level"]')?.addEventListener('click', () => focusAnchor(anchor, true))
    row.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
      anchors = anchors.filter((item) => item.id !== anchor.id)
      renderAnchorList()
      updateCameraMarkers()
      invalidateGlbCache()
    })
    anchorList.append(row)
  }
}

function addCurrentCameraAnchor(): void {
  const anchor: CameraAnchor = {
    id: `anchor-${Date.now()}-${anchors.length}`,
    label: `锚点 ${anchors.length + 1}`,
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    far: Number(cameraFarInput.value),
  }
  anchors.push(anchor)
  renderAnchorList()
  updateCameraMarkers()
  invalidateGlbCache()
}

function focusAnchor(anchor: CameraAnchor, horizontal: boolean): void {
  camera.position.copy(anchor.position)
  camera.quaternion.copy(anchor.quaternion)
  camera.up.set(0, 1, 0).applyQuaternion(baseQuaternion).normalize()
  camera.far = anchor.far
  cameraFarInput.value = String(anchor.far)
  camera.updateProjectionMatrix()
  if (horizontal) {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(baseQuaternion).normalize()
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(anchor.quaternion)
    forward.addScaledVector(up, -forward.dot(up)).normalize()
    camera.up.copy(up)
    camera.lookAt(anchor.position.clone().add(forward))
  }
  camera.updateMatrixWorld(true)
  mainControls.target.copy(camera.position).add(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(100))
  mainControls.update()
}

function positionCamera(ellipsoid = tiles?.ellipsoid): void {
  if (!ellipsoid) return
  const radians = Math.PI / 180
  const matrix = new THREE.Matrix4()
  ellipsoid.getObjectFrame(settings.lat * radians, settings.lon * radians, settings.groundElevation + settings.height, -90 * radians, 0, 0, matrix, CAMERA_FRAME)
  matrix.decompose(basePosition, baseQuaternion, new THREE.Vector3())
  yaw = 0
  pitch = 0
  applyCameraRotation()
  updateCameraMarkers()
}

function disposeTiles(): void {
  if (previewSession) stopPreviewSession()
  if (!tiles) return
  tiles.dispose()
  scene.remove(tiles.group)
  tiles = null
  updateStats()
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
    setStatus('需要配置', 'error')
    setPlaceholder('请配置 VITE_TILES_URL，或配置 Cesium Ion Token + Asset ID', 'error')
    updateStats()
    return
  }
  configHelp.hidden = true
  setPlaceholder('正在加载 3D Tiles…', 'loading')
  setStatus('加载中…')
  disposeTiles()
  try {
    const next = new TilesRenderer(tilesUrl || undefined)
    next.errorTarget = Number(precisionInput.value)
    const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/')
    next.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }))
    next.registerPlugin(new TilesFadePlugin())
    next.registerPlugin(new UpdateOnChangePlugin())
    if (hasIon) next.registerPlugin(new CesiumIonAuthPlugin({ apiToken: ionToken, assetId: ionAssetId, autoRefreshToken: true }))
    // Place the camera as soon as the tiles renderer exists, before the first
    // frame can render at Three.js's default origin.
    positionCamera(next.ellipsoid)
    next.setCamera(camera)
    next.setResolutionFromRenderer(camera, renderer)
    next.addEventListener('load-error', (event: unknown) => {
      const message = event instanceof Error ? event.message : '3D Tiles 请求失败，请检查 URL、Token 和 CORS 配置。'
      setStatus('加载错误', 'error')
      setPlaceholder(message, 'error')
    })
    tiles = next
    sourceLabel = hasIon ? `Cesium Ion / ${ionAssetId}` : tilesUrl
    scene.add(next.group)
    positionCamera()
    hidePlaceholder()
    setStatus('已就绪', 'ok')
    exportGlbButton.disabled = false
    previewGlbButton.disabled = false
    addAnchorButton.disabled = false
    updateStats()
  } catch (error) {
    disposeTiles()
    setStatus('加载失败', 'error')
    setPlaceholder(error instanceof Error ? error.message : '无法初始化 3D Tiles', 'error')
  }
}

function resize(): void {
  const width = Math.max(1, viewport.clientWidth)
  const height = Math.max(1, viewport.clientHeight)
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  tiles?.setResolutionFromRenderer(camera, renderer)
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
    setPlaceholder('经度需在 -180..180，纬度需在 -90..90，地面海拔和观察高度必须是有效数字，观察高度不能小于 0。', 'error')
    return
  }
  Object.assign(settings, next)
  syncUrl(settings)
  if (tiles) positionCamera()
  invalidateGlbCache()
  updateStats()
  setStatus(tiles ? '已定位' : '等待数据源', tiles ? 'ok' : 'idle')
}

$('#apply-location').addEventListener('click', applyLocation)
addAnchorButton.addEventListener('click', addCurrentCameraAnchor)

$('#reset-location').addEventListener('click', () => {
  coordinateTextInput.value = `${settings.lat}, ${settings.lon}`
  groundElevationInput.value = String(settings.groundElevation)
  heightInput.value = String(settings.height)
  yaw = 0
  pitch = 0
  applyCameraRotation()
})

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function setExportProgress(value: number, label: string): void {
  progress.hidden = false
  progressBar.style.width = `${Math.round(value * 100)}%`
  progressLabel.textContent = label
}

function getTileLoadStats(renderer: TilesRenderer): { loaded: number; pending: number; total: number } {
  const stats = renderer.stats as Record<string, number>
  const loaded = Math.max(0, Number(stats.loaded) || 0)
  const pending = Math.max(0, (Number(stats.queued) || 0) + (Number(stats.downloading) || 0) + (Number(stats.parsing) || 0) + (Number(stats.processing) || 0))
  return { loaded, pending, total: loaded + pending }
}

function waitForTileLoads(renderer: TilesRenderer, onProgress?: () => void, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    let minimumWaitFinished = false
    const isRendererLoading = (): boolean => Boolean((renderer as TilesRenderer & { isLoading?: boolean }).isLoading)
    const finish = () => {
      if (settled || !minimumWaitFinished) return
      const stats = getTileLoadStats(renderer)
      if (stats.pending > 0 || isRendererLoading() || renderer.loadProgress < 1) return
      settled = true
      renderer.removeEventListener('tiles-load-end', finish)
      window.clearTimeout(timeout)
      window.clearInterval(progressTimer)
      window.clearInterval(loadCheckTimer)
      resolve()
    }
    const timeout = window.setTimeout(() => {
      if (settled) return
      settled = true
      renderer.removeEventListener('tiles-load-end', finish)
      window.clearInterval(progressTimer)
      window.clearInterval(loadCheckTimer)
      resolve()
    }, timeoutMs)
    const progressTimer = window.setInterval(() => onProgress?.(), 250)
    const loadCheckTimer = window.setInterval(finish, 100)
    window.setTimeout(() => {
      minimumWaitFinished = true
      finish()
    }, 400)
    renderer.addEventListener('tiles-load-end', finish)
  })
}

async function legacyPreloadExportArea(radius: number): Promise<Set<THREE.Object3D>> {
  if (!tiles) throw new Error('没有可导出的 3D Tiles 场景。')
  const exportScenes = new Set<THREE.Object3D>()
  const directions: Array<{ direction: THREE.Vector3; up: THREE.Vector3; topDown: boolean }> = []
  for (let azimuth = 0; azimuth < 8; azimuth += 1) {
    for (const elevation of [-30, 0, 30]) {
      const azimuthRadians = azimuth / 8 * Math.PI * 2
      const elevationRadians = elevation * Math.PI / 180
      directions.push({
        direction: new THREE.Vector3(
          Math.sin(azimuthRadians) * Math.cos(elevationRadians),
          Math.sin(elevationRadians),
          -Math.cos(azimuthRadians) * Math.cos(elevationRadians),
        ),
        up: new THREE.Vector3(0, 1, 0),
        topDown: false,
      })
    }
  }
  directions.push({ direction: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, -1), topDown: true })
  const previousCameras = [...tiles.cameras]
  const previousDisplayActiveTiles = tiles.displayActiveTiles
  const scanCameras: THREE.PerspectiveCamera[] = []

  const addScanCameras = (position: THREE.Vector3, quaternion: THREE.Quaternion, far: number): void => {
    for (const { direction, up, topDown } of directions) {
      const scanCamera = new THREE.PerspectiveCamera(camera.fov, 1, camera.near, topDown ? far * 2 : far)
      const worldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion)
      scanCamera.position.copy(position)
      if (topDown) scanCamera.position.add(worldUp.multiplyScalar(far))
      scanCamera.up.copy(up).applyQuaternion(quaternion)
      const worldDirection = direction.clone().applyQuaternion(quaternion)
      scanCamera.lookAt(topDown ? position : position.clone().add(worldDirection))
      scanCamera.updateMatrixWorld(true)
      scanCameras.push(scanCamera)
    }
  }

  // The default camera covers the low-detail fallback area. Anchor cameras are
  // added to the same traversal so the renderer can refine only where an anchor
  // sees the tiles. This preserves the renderer's REPLACE parent/child handling.
  addScanCameras(basePosition, baseQuaternion, radius)
  for (const anchor of anchors) addScanCameras(anchor.position, anchor.quaternion, anchor.far)

  tiles.displayActiveTiles = true
  try {
    for (const previousCamera of previousCameras) tiles.deleteCamera(previousCamera)
    for (const scanCamera of scanCameras) {
      tiles.setCamera(scanCamera)
      tiles.setResolutionFromRenderer(scanCamera, renderer)
      tiles.update()
      await waitForTileLoads(tiles)
      for (const child of tiles.group.children) exportScenes.add(child)
      const stats = getTileLoadStats(tiles)
      setExportProgress(0.35, `正在加载导出范围 · 已发现 ${stats.total} · 已完成 ${stats.loaded}`)
    }
    setExportProgress(0.75, `已合并最终可见瓦片 · ${exportScenes.size}`)
  } finally {
    tiles.displayActiveTiles = previousDisplayActiveTiles
    for (const scanCamera of scanCameras) tiles.deleteCamera(scanCamera)
    for (const previousCamera of previousCameras) {
      tiles.setCamera(previousCamera)
      tiles.setResolutionFromRenderer(previousCamera, renderer)
    }
  }
  return exportScenes
}

function createExportAnchors(radius: number): ExportAnchor[] {
  return [
    { id: 'base', label: 'base', position: basePosition.clone(), quaternion: baseQuaternion.clone(), far: radius },
    ...anchors.map((anchor) => ({ ...anchor, position: anchor.position.clone(), quaternion: anchor.quaternion.clone() })),
  ]
}

function createScanCameras(radius: number): THREE.PerspectiveCamera[] {
  // These cameras are deliberately short-lived copies. The user's main
  // camera is never passed to the export traversal.
  const directions: Array<{ direction: THREE.Vector3; up: THREE.Vector3; topDown: boolean }> = []
  for (let azimuth = 0; azimuth < 8; azimuth += 1) {
    for (const elevation of [-30, 0, 30]) {
      const azimuthRadians = azimuth / 8 * Math.PI * 2
      const elevationRadians = elevation * Math.PI / 180
      directions.push({
        direction: new THREE.Vector3(
          Math.sin(azimuthRadians) * Math.cos(elevationRadians),
          Math.sin(elevationRadians),
          -Math.cos(azimuthRadians) * Math.cos(elevationRadians),
        ),
        up: new THREE.Vector3(0, 1, 0),
        topDown: false,
      })
    }
  }
  directions.push({ direction: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, -1), topDown: true })
  const scanCameras: THREE.PerspectiveCamera[] = []
  const addScanCameras = (position: THREE.Vector3, quaternion: THREE.Quaternion, far: number): void => {
    for (const { direction, up, topDown } of directions) {
      const scanCamera = new THREE.PerspectiveCamera(camera.fov, 1, camera.near, topDown ? far * 2 : far)
      const worldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion)
      scanCamera.position.copy(position)
      if (topDown) scanCamera.position.add(worldUp.multiplyScalar(far))
      scanCamera.up.copy(up).applyQuaternion(quaternion)
      scanCamera.lookAt(topDown ? position : position.clone().add(direction.clone().applyQuaternion(quaternion)))
      scanCamera.updateMatrixWorld(true)
      scanCameras.push(scanCamera)
    }
  }
  addScanCameras(basePosition, baseQuaternion, radius)
  for (const anchor of anchors) addScanCameras(anchor.position, anchor.quaternion, anchor.far)
  return scanCameras
}

function getPreviewSignature(): string {
  if (!tiles) return ''
  const stats = getTileLoadStats(tiles)
  const active = [...tiles.activeTiles].map((tile) => String((tile as { id?: string }).id ?? tile)).sort().join(',')
  const visible = [...tiles.visibleTiles].map((tile) => String((tile as { id?: string }).id ?? tile)).sort().join(',')
  return `${stats.loaded}:${stats.pending}:${tiles.loadProgress}:${active}:${visible}`
}

function updatePreviewStability(): void {
  if (!previewSession || !tiles || previewSession.closed) return
  const signature = getPreviewSignature()
  const stats = getTileLoadStats(tiles)
  const loading = Boolean((tiles as TilesRenderer & { isLoading?: boolean }).isLoading)
  if (signature === previewSession.lastSignature && stats.pending === 0 && !loading && tiles.loadProgress >= 1) {
    previewSession.stableFrames += 1
  } else {
    previewSession.stableFrames = 0
  }
  previewSession.lastSignature = signature
  previewSession.stable = previewSession.stableFrames >= 8
  glbPreviewProgress.textContent = `${previewSession.stable ? 'LOD 已稳定' : '正在持续细分…'} · 已加载 ${stats.loaded} · 队列 ${stats.pending}`
  if (previewSession.stable) schedulePreviewGeneration()
}

function beginPreviewSession(radius: number): void {
  if (!tiles) return
  stopPreviewSession()
  const session = {
    cameras: createScanCameras(radius),
    previousCameras: [...tiles.cameras],
    previousDisplayActiveTiles: tiles.displayActiveTiles,
    mainCamera: {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      up: camera.up.clone(),
      near: camera.near,
      far: camera.far,
      fov: camera.fov,
      aspect: camera.aspect,
      target: mainControls.target.clone(),
    },
    radius,
    generation: 0,
    stableFrames: 0,
    lastSignature: '',
    stable: false,
    generationTimer: null as number | null,
    generationInFlight: false,
    closed: false,
  }
  previewSession = session
  // Remove the interactive camera (and any prior renderer cameras) from the
  // traversal. Only the temporary base/anchor scan cameras below drive LOD.
  for (const previousCamera of session.previousCameras) tiles.deleteCamera(previousCamera)
  tiles.displayActiveTiles = true
  for (const scanCamera of session.cameras) {
    tiles.setCamera(scanCamera)
    tiles.setResolutionFromRenderer(scanCamera, renderer)
  }
  tiles.update()
  glbPreviewProgress.textContent = '正在注册联合扫描相机…'
}

function stopPreviewSession(): void {
  if (!previewSession || !tiles) return
  const session = previewSession
  session.closed = true
  if (session.generationTimer !== null) window.clearTimeout(session.generationTimer)
  for (const scanCamera of session.cameras) tiles.deleteCamera(scanCamera)
  tiles.displayActiveTiles = session.previousDisplayActiveTiles
  for (const previousCamera of session.previousCameras) {
    tiles.setCamera(previousCamera)
    tiles.setResolutionFromRenderer(previousCamera, renderer)
  }
  camera.position.copy(session.mainCamera.position)
  camera.quaternion.copy(session.mainCamera.quaternion)
  camera.up.copy(session.mainCamera.up)
  camera.near = session.mainCamera.near
  camera.far = session.mainCamera.far
  camera.fov = session.mainCamera.fov
  camera.aspect = session.mainCamera.aspect
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  mainControls.target.copy(session.mainCamera.target)
  mainControls.update()
  previewSession = null
}

function collectExportScenes(radius: number): Set<THREE.Object3D> {
  if (!tiles) return new Set()
  const scenes = new Set<THREE.Object3D>()
  const bounds = new THREE.Box3()
  const sphere = new THREE.Sphere()
  const exportAnchors = createExportAnchors(radius)
  for (const child of tiles.group.children) {
    child.updateMatrixWorld(true)
    bounds.setFromObject(child)
    bounds.getBoundingSphere(sphere)
    if (exportAnchors.some((anchor) => sphere.center.distanceTo(anchor.position) - sphere.radius <= anchor.far)) scenes.add(child)
  }
  return scenes
}

async function encodeCurrentPreview(): Promise<ArrayBuffer> {
  if (!tiles || !previewSession) throw new Error('GLB 预览尚未初始化。')
  const exportGroup = new THREE.Group()
  const exportScenes = collectExportScenes(previewSession.radius)
  for (const sourceScene of exportScenes) exportGroup.add(sourceScene.clone(true))
  if (exportGroup.children.length === 0) throw new Error('导出范围内尚未加载到瓦片。')
  exportGroup.position.copy(basePosition).multiplyScalar(-1)
  exportGroup.updateMatrixWorld(true)
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    new GLTFExporter().parse(
      exportGroup,
      (value) => value instanceof ArrayBuffer ? resolve(value) : reject(new Error('GLB 生成结果无效。')),
      (error) => reject(error instanceof Error ? error : new Error('GLB 生成失败。')),
      { binary: true, onlyVisible: true, includeCustomExtensions: true },
    )
  })
}

function replacePreviewModel(data: ArrayBuffer): void {
  if (!glbPreviewScene) return
  new GLTFLoader().parse(data.slice(0), '', (gltf) => {
    if (!glbPreviewScene) return
    const shouldFrame = glbPreviewModel === null
    if (glbPreviewModel) glbPreviewScene.remove(glbPreviewModel)
    glbPreviewModel = gltf.scene
    glbPreviewScene.add(glbPreviewModel)
    if (shouldFrame) frameGlbPreview(glbPreviewModel)
    glbPreviewPlaceholder.hidden = true
  }, (error) => {
    glbPreviewPlaceholder.textContent = error instanceof Error ? error.message : 'GLB 加载失败'
    glbPreviewPlaceholder.dataset.state = 'error'
    glbPreviewPlaceholder.hidden = false
  })
}

async function generatePreviewGlb(): Promise<void> {
  const session = previewSession
  if (!session || session.closed || session.generationInFlight) return
  session.generationInFlight = true
  const generation = ++session.generation
  try {
    glbPreviewProgress.textContent = '正在生成 GLB…'
    const result = await encodeCurrentPreview()
    if (previewSession !== session || session.closed || generation !== session.generation) return
    lastExportedGlb = result.slice(0)
    replacePreviewModel(result)
    exportCurrentGlbButton.disabled = false
    glbPreviewProgress.textContent = session.stable ? 'GLB 已更新 · LOD 已稳定' : 'GLB 已更新 · 正在继续细分…'
  } catch (error) {
    if (previewSession === session && !session.closed) glbPreviewProgress.textContent = error instanceof Error ? error.message : 'GLB 生成失败'
  } finally {
    if (previewSession === session) {
      session.generationInFlight = false
      if (session.stable && session.generationTimer === null) schedulePreviewGeneration()
    }
  }
}

function schedulePreviewGeneration(): void {
  const session = previewSession
  if (!session || session.closed || session.generationInFlight || session.generationTimer !== null) return
  session.generationTimer = window.setTimeout(() => {
    session.generationTimer = null
    void generatePreviewGlb()
  }, session.stable ? 250 : 600)
}

async function exportCurrentGlb(): Promise<void> {
  if (exporting || !tiles || !previewSession) return
  exporting = true
  exportCurrentGlbButton.disabled = true
  try {
    const started = performance.now()
    while (previewSession && !previewSession.stable && performance.now() - started < 30_000) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 100))
    }
    if (!lastExportedGlb) {
      await generatePreviewGlb()
    }
    if (!lastExportedGlb) throw new Error('GLB 仍在生成，请稍后重试。')
    downloadBlob(new Blob([lastExportedGlb], { type: 'model/gltf-binary' }), `scene-${settings.lat.toFixed(5)}-${settings.lon.toFixed(5)}.glb`)
    glbPreviewProgress.textContent = 'GLB 导出完成'
  } catch (error) {
    glbPreviewProgress.textContent = error instanceof Error ? error.message : 'GLB 导出失败'
  } finally {
    exporting = false
    exportCurrentGlbButton.disabled = !lastExportedGlb
  }
}

function resizeGlbPreview(): void {
  if (!glbPreviewRenderer || !glbPreviewCamera) return
  const width = Math.max(1, glbPreviewViewport.clientWidth)
  const height = Math.max(1, glbPreviewViewport.clientHeight)
  glbPreviewRenderer.setSize(width, height, false)
  glbPreviewCamera.aspect = width / height
  glbPreviewCamera.updateProjectionMatrix()
}

function frameGlbPreview(model: THREE.Object3D): void {
  if (!glbPreviewCamera || !glbPreviewControls) return
  const box = new THREE.Box3().setFromObject(model)
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  const horizontalDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(baseQuaternion).normalize()
  const upDirection = new THREE.Vector3(0, 1, 0).applyQuaternion(baseQuaternion).normalize()
  const lookDistance = Math.max(1, Math.min(sphere.radius * 0.25, 100))
  glbPreviewCamera.position.set(0, 0, 0)
  glbPreviewCamera.up.copy(upDirection)
  glbPreviewCamera.lookAt(horizontalDirection.clone().multiplyScalar(lookDistance))
  glbPreviewCamera.near = Math.max(0.01, sphere.radius / 1000)
  glbPreviewCamera.far = Math.max(1000, sphere.radius * 100)
  glbPreviewCamera.updateProjectionMatrix()
  glbPreviewControls.target.copy(horizontalDirection).multiplyScalar(lookDistance)
  glbPreviewControls.update()
}

function closeGlbPreview(): void {
  stopPreviewSession()
  glbPreview.hidden = true
  glbPreviewControls?.dispose()
  glbPreviewRenderer?.dispose()
  glbPreviewControls = null
  glbPreviewRenderer = null
  glbPreviewScene = null
  glbPreviewCamera = null
  glbPreviewModel = null
  glbPreviewViewport.replaceChildren(glbPreviewPlaceholder)
  glbPreviewPlaceholder.hidden = false
}

async function openGlbPreview(): Promise<void> {
  if (exporting || !tiles) return
  closeGlbPreview()
  glbPreview.hidden = false
  glbPreviewPlaceholder.textContent = '正在准备动态 GLB 预览…'
  glbPreviewPlaceholder.dataset.state = 'loading'
  glbPreviewPlaceholder.hidden = false
  glbPreviewProgress.textContent = '正在启动联合扫描…'
  glbPreviewScene = new THREE.Scene()
  glbPreviewScene.background = new THREE.Color('#020811')
  glbPreviewScene.add(new THREE.HemisphereLight('#d9efff', '#18243a', 1.6))
  const light = new THREE.DirectionalLight('#ffffff', 2.4)
  light.position.set(10, 20, 10)
  glbPreviewScene.add(light)
  glbPreviewCamera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000)
  glbPreviewRenderer = new THREE.WebGLRenderer({ antialias: true })
  glbPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  glbPreviewRenderer.outputColorSpace = THREE.SRGBColorSpace
  glbPreviewViewport.replaceChildren(glbPreviewRenderer.domElement)
  glbPreviewControls = new MapControls(glbPreviewCamera, glbPreviewRenderer.domElement)
  glbPreviewControls.enableDamping = true
  glbPreviewControls.dampingFactor = 0.05
  glbPreviewControls.screenSpacePanning = false
  glbPreviewControls.minDistance = 100
  glbPreviewControls.maxDistance = 500
  glbPreviewControls.maxPolarAngle = Math.PI
  glbPreviewControls.zoomToCursor = true
  resizeGlbPreview()
  lastExportedGlb = null
  exportCurrentGlbButton.disabled = true
  beginPreviewSession(Number(cameraFarInput.value))
  schedulePreviewGeneration()
}

exportGlbButton.style.display = 'none'
exportCurrentGlbButton.addEventListener('click', () => void exportCurrentGlb())
previewGlbButton.addEventListener('click', openGlbPreview)
closeGlbPreviewButton.addEventListener('click', closeGlbPreview)
precisionInput.addEventListener('input', () => {
  const value = Number(precisionInput.value)
  precisionValue.textContent = String(value)
  invalidateGlbCache()
  if (tiles) {
    tiles.errorTarget = value
    tiles.update()
  }
})
cameraFarInput.addEventListener('input', () => {
  const value = Number(cameraFarInput.value)
  if (!Number.isFinite(value) || value <= camera.near) return
  camera.far = value
  camera.updateProjectionMatrix()
  invalidateGlbCache()
  tiles?.update()
})
window.addEventListener('resize', resize)
window.addEventListener('resize', resizeGlbPreview)

// The viewer panel can change size without a window resize (for example when
// the responsive grid changes or its layout is affected by dynamic content).
// Keep the WebGL drawing buffer and camera projection in sync with the actual
// viewport dimensions in those cases as well.
const viewportResizeObserver = new ResizeObserver(() => {
  resize()
  resizeGlbPreview()
})
viewportResizeObserver.observe(viewport)
viewportResizeObserver.observe(glbPreviewViewport)

function animate(): void {
  tiles?.update()
  updatePreviewStability()
  if (glbPreviewRenderer && glbPreviewScene && glbPreviewCamera) {
    glbPreviewControls?.update()
    glbPreviewRenderer.render(glbPreviewScene, glbPreviewCamera)
  } else {
    mainControls.update()
    renderer.render(scene, previewCamera)
  }
  tilesStat.textContent = tiles ? `${tiles.group.children.length} objects` : '-'
  requestAnimationFrame(animate)
}

resize()
loadTiles().catch((error) => {
  setStatus('初始化失败', 'error')
  setPlaceholder(error instanceof Error ? error.message : '初始化失败', 'error')
})
animate()
