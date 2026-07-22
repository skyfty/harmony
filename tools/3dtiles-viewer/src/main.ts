import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { TilesRenderer, CAMERA_FRAME } from '3d-tiles-renderer'
import type { Tile } from '3d-tiles-renderer/core'
import { CesiumIonAuthPlugin } from '3d-tiles-renderer/core/plugins'
import { GLTFExtensionsPlugin, TilesFadePlugin, UpdateOnChangePlugin } from '3d-tiles-renderer/three/plugins'
import stylesText from './styles.css?raw'

type Settings = { lon: number; lat: number; groundElevation: number; height: number }
type CaptureAnchor = { id: string; label: string; capturedCount: number; position: THREE.Vector3 }
type CapturableTile = Tile & {
  engineData?: { scene?: THREE.Object3D | null }
  traversal?: { visible?: boolean; isLeaf?: boolean }
  internal?: { depth?: number }
}
type CapturableObject = THREE.Object3D & {
  geometry?: THREE.BufferGeometry
  material?: THREE.Material | THREE.Material[]
}

const MAX_CAPTURE_LEAF_RADIUS = 100_000

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
        <label>经纬度 <input id="coordinate-text" type="text" inputmode="text" placeholder="29°38'38.24&quot;N 91°06'57.03&quot;E" /></label>
        <div class="coordinate-grid">
          <label>地面海拔 (m)<input id="ground-elevation" type="number" step="0.1" placeholder="0" /></label>
          <label>观察高度 (m)<input id="height" type="number" step="0.1" min="0" value="0" /></label>
        </div>
        <div class="actions"><button id="apply-location">定位并加载</button><button class="secondary" id="reset-location">恢复视点</button></div>

        <label class="range-label">瓦片精度 <span><strong id="precision-value">6</strong> px</span><input id="precision" type="range" min="1" max="32" step="1" value="6" /></label>
        <label>相机 Far 范围 (m)<input id="camera-far" type="number" min="50" max="10000000" step="1000" value="10000" /></label>
        <div class="actions wide"><button id="add-anchor" disabled>添加当前相机为锚点</button></div>
        <div class="anchor-list" id="anchor-list"></div>
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

      <section class="workspace">
        <section class="panel viewer">
          <div class="panel-header"><h2>实时预览</h2><span class="chip">Left renderer</span></div>
          <div class="viewport" id="viewport"><div class="placeholder" id="placeholder">正在初始化实时预览…</div></div>
          <p class="help">拖动旋转，滚轮缩放，右键平移。按 <code>A</code> 可添加锚点。</p>
        </section>

        <section class="panel glb-panel">
          <div class="panel-header"><h2>GLB 预览</h2><button class="secondary" id="export-current-glb" disabled>导出 GLB</button></div>
          <div class="glb-preview-viewport" id="glb-preview-viewport">
            <div class="placeholder" id="glb-preview-placeholder">等待首次锚点捕获</div>
          </div>
          <p class="help glb-preview-progress" id="glb-preview-progress">右侧场景与实时预览独立渲染。每次添加锚点都会把当前高精度叶节点复制到右侧。</p>
        </section>
      </section>
    </main>
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
const exportCurrentGlbButton = $('#export-current-glb') as HTMLButtonElement
const glbPreviewViewport = $('#glb-preview-viewport')
const glbPreviewPlaceholder = $('#glb-preview-placeholder')
const glbPreviewProgress = $('#glb-preview-progress')

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

const glbCamera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000)
const glbRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false })
glbRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
glbRenderer.outputColorSpace = THREE.SRGBColorSpace
glbRenderer.toneMapping = THREE.AgXToneMapping
glbRenderer.toneMappingExposure = 1.25
glbPreviewViewport.replaceChildren(glbRenderer.domElement)
const glbControls = new MapControls(glbCamera, glbRenderer.domElement)
glbControls.enableDamping = true
glbControls.dampingFactor = 0.05
glbControls.screenSpacePanning = false
glbControls.minDistance = 25
glbControls.maxDistance = 100000
glbControls.maxPolarAngle = Math.PI
glbControls.zoomToCursor = true

let tiles: TilesRenderer | null = null
let sourceLabel = '-'
let basePosition = new THREE.Vector3()
let baseQuaternion = new THREE.Quaternion()
let yaw = 0
let pitch = 0
let exporting = false
let anchors: CaptureAnchor[] = []
let capturedTileNodes = new Map<Tile, THREE.Object3D>()
let glbCameraFramed = false
let glbPreviewModel: THREE.Object3D | null = null
let glbPreviewBuffer: ArrayBuffer | null = null
let glbPreviewRevision = 0
let glbPreviewLoadedRevision = 0
let glbPreviewRefreshPromise: Promise<void> | null = null
let glbPreviewRefreshRequested = false
let glbSkippedLargeLeafCount = 0
const baseFrameMatrix = new THREE.Matrix4()
const baseFrameInverse = new THREE.Matrix4()

rendererStat.textContent = `${mainRenderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1'} / ${glbRenderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1'}`

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
  sourceStat.textContent = sourceLabel
  tilesStat.textContent = tiles ? `${tiles.group.children.length} objects` : '-'
  locationStat.textContent = `${settings.lat.toFixed(5)}, ${settings.lon.toFixed(5)} @ ground ${settings.groundElevation.toFixed(1)}m / camera ${(settings.groundElevation + settings.height).toFixed(1)}m`
}

function formatLogValue(value: unknown): string {
  if (value == null) return String(value)
  if (typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(3) : String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value instanceof THREE.Vector3) return `vec3(${value.x.toFixed(2)},${value.y.toFixed(2)},${value.z.toFixed(2)})`
  if (value instanceof THREE.Quaternion) return `quat(${value.x.toFixed(2)},${value.y.toFixed(2)},${value.z.toFixed(2)},${value.w.toFixed(2)})`
  if (Array.isArray(value)) return `[${value.map((item) => formatLogValue(item)).join(',')}]`
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function logSummary(event: string, details: Record<string, unknown> = {}): void {
  const tail = Object.entries(details).map(([key, value]) => `${key}=${formatLogValue(value)}`).join(' | ')
  console.log(`[3dtiles-viewer] ${event}${tail ? ` | ${tail}` : ''}`)
}

function describeObject3D(object: THREE.Object3D | null | undefined): string {
  if (!object) return '-'
  return `${object.type}${object.name ? `:${object.name}` : ''}`
}

function findFirstRenderableDescendant(object: THREE.Object3D | null | undefined): THREE.Object3D | null {
  if (!object) return null
  let match: THREE.Object3D | null = null
  object.traverse((node) => {
    if (match) return
    const renderable = node as CapturableObject & { isSprite?: boolean }
    if (renderable.geometry || renderable.isSprite) match = node
  })
  return match
}

function describeGeometry(object: THREE.Object3D | null | undefined): string {
  if (!object) return '-'
  const renderable = object as CapturableObject
  const geometry = renderable.geometry
  if (!geometry) return describeObject3D(object)
  geometry.computeBoundingSphere()
  const radius = geometry.boundingSphere?.radius ?? 0
  const vertexCount = geometry.attributes.position?.count ?? 0
  return `${describeObject3D(object)}|r=${radius.toFixed(3)}|v=${vertexCount}`
}

function updateProgressUI(): void {
  if (!tiles) {
    progress.hidden = true
    return
  }
  progress.hidden = false
  progressBar.style.width = `${Math.max(0, Math.min(1, tiles.loadProgress)) * 100}%`
  const loaded = Math.max(0, Number((tiles.stats as Record<string, number>).loaded) || 0)
  const queued = Math.max(
    0,
    (Number((tiles.stats as Record<string, number>).queued) || 0)
      + (Number((tiles.stats as Record<string, number>).downloading) || 0)
      + (Number((tiles.stats as Record<string, number>).parsing) || 0)
      + (Number((tiles.stats as Record<string, number>).processing) || 0),
  )
  progressLabel.textContent = `已加载 ${loaded} · 队列 ${queued} · 锚点 ${anchors.length} · 捕获叶节点 ${capturedTileNodes.size}`
}

function syncGlbOrigin(): void {
  glbCaptureRoot.position.set(0, 0, 0)
  glbCaptureRoot.quaternion.identity()
  glbCaptureRoot.scale.set(1, 1, 1)
  glbCaptureRoot.updateMatrixWorld(true)
}

function syncGlbCameraToMainViewLegacy(): void {
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
  logSummary('camera-sync', {
    glbPos: glbCamera.position,
    glbTarget: glbControls.target,
  })
}

function resetGlbCaptureScene(message = '等待首次锚点捕获'): void {
  for (const child of [...glbCaptureRoot.children]) glbCaptureRoot.remove(child)
  capturedTileNodes.clear()
  anchors = []
  glbCameraFramed = false
  glbSkippedLargeLeafCount = 0
  glbPreviewRevision += 1
  glbPreviewLoadedRevision = 0
  glbPreviewBuffer = null
  if (glbPreviewModel) {
    disposeObject3DResources(glbPreviewModel)
    glbScene.remove(glbPreviewModel)
    glbPreviewModel = null
  }
  exportCurrentGlbButton.disabled = true
  glbPreviewProgress.textContent = message
  setGlbPlaceholder(message)
  renderAnchorList()
  updateCameraMarkers()
  updateProgressUI()
}

function cloneTexture(texture: THREE.Texture): THREE.Texture {
  const next = texture.clone()
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

function isRenderableLeaf(node: THREE.Object3D): boolean {
  const renderable = node as CapturableObject & { isSprite?: boolean }
  const hasGeometry = Boolean(renderable.geometry)
  const hasMaterial = Boolean(renderable.material)
  if (!hasGeometry && !renderable.isSprite) return false
  for (const child of node.children) {
    if (isRenderableLeaf(child)) return false
  }
  return hasMaterial || renderable.isSprite
}

function cloneRenderableLeafForCapture(source: CapturableObject): CapturableObject | null {
  const clone = source.clone(false) as CapturableObject
  if (source.geometry) {
    const geometry = source.geometry.clone()
    geometry.computeBoundingSphere()
    const geometryRadius = geometry.boundingSphere?.radius ?? 0
    if (geometryRadius > MAX_CAPTURE_LEAF_RADIUS) return null
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
  let skippedLarge = 0
  group.matrixAutoUpdate = false
  group.matrix.identity()
  group.position.set(0, 0, 0)
  group.quaternion.identity()
  group.scale.set(1, 1, 1)
  source.traverse((node) => {
    if (!isRenderableLeaf(node)) return
    const cloned = cloneRenderableLeafForCapture(node as CapturableObject)
    if (cloned) {
      group.add(cloned)
    } else {
      skippedLarge += 1
    }
  })
  group.updateMatrix()
  group.updateMatrixWorld(true)
  ;(group as THREE.Group & { userData: { skippedLarge?: number } }).userData.skippedLarge = skippedLarge
  return group
}

function recenterGlbCaptureRoot(): boolean {
  glbCaptureRoot.position.set(0, 0, 0)
  glbCaptureRoot.quaternion.identity()
  glbCaptureRoot.scale.set(1, 1, 1)
  glbCaptureRoot.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(glbCaptureRoot)
  if (box.isEmpty()) return false

  const center = box.getCenter(new THREE.Vector3())
  glbCaptureRoot.position.copy(center).multiplyScalar(-1)
  glbCaptureRoot.updateMatrixWorld(true)
  return true
}

function frameGlbPreviewFromModel(model: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(model)
  if (box.isEmpty()) return

  const sphere = box.getBoundingSphere(new THREE.Sphere())
  const center = sphere.center.clone()
  const radius = Math.max(sphere.radius, 1)
  const halfFov = THREE.MathUtils.degToRad(glbCamera.fov * 0.5)
  const distance = radius / Math.sin(Math.max(halfFov, 0.1))
  const direction = new THREE.Vector3(1, 1, 1).normalize()

  glbCamera.position.copy(center).addScaledVector(direction, distance)
  glbCamera.near = Math.max(0.01, radius / 1000)
  glbCamera.far = Math.max(1000, radius * 100)
  glbCamera.updateProjectionMatrix()

  glbControls.target.copy(center)
  glbControls.maxDistance = Math.max(radius * 20, 1000)
  glbControls.update()

  logSummary('frame-summary', {
    state: 'framed',
    childCount: model.children.length,
    radius,
  })
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

        glbPreviewLoadedRevision = revision
        glbPreviewProgress.textContent = `GLB 预览已同步，当前捕获 ${capturedTileNodes.size} 个高精度叶节点。`
        logSummary('preview-loaded', {
          revision,
          children: glbPreviewModel.children.length,
          bytes: buffer.byteLength,
        })
        resolve()
      },
      (error) => reject(error instanceof Error ? error : new Error('GLB 预览解析失败。')),
    )
  })
}

async function refreshGlbPreview(): Promise<void> {
  if (capturedTileNodes.size === 0) {
    glbPreviewBuffer = null
    glbPreviewLoadedRevision = 0
    glbPreviewProgress.textContent = '当前视图没有可捕获的高精度叶节点。'
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
        glbPreviewProgress.textContent = '正在同步最终的 GLB 预览...'
        logSummary('preview-build', {
          revision,
          captured: capturedTileNodes.size,
          rootChildren: glbCaptureRoot.children.length,
        })
        const buffer = await exportObject3D(glbCaptureRoot)
        if (revision !== glbPreviewRevision) {
          glbPreviewRefreshRequested = true
          continue
        }
        glbPreviewBuffer = buffer.slice(0)
        await loadGlbPreviewFromBuffer(buffer, revision)
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
    height: Number(heightInput.value),
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
    && Number.isFinite(value.height)
    && value.height >= 0
}

function syncUrl(value: Settings): void {
  const next = new URL(window.location.href)
  next.searchParams.set('lon', value.lon.toFixed(6))
  next.searchParams.set('lat', value.lat.toFixed(6))
  next.searchParams.set('ground', value.groundElevation.toFixed(1))
  next.searchParams.set('height', value.height.toFixed(1))
  window.history.replaceState(null, '', next)
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
    settings.groundElevation + settings.height,
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
  syncGlbOrigin()
  updateCameraMarkers()
}

function renderAnchorList(): void {
  anchorList.replaceChildren()
  for (const anchor of anchors) {
    const row = document.createElement('div')
    row.className = 'anchor-row'
    row.innerHTML = `<span>${anchor.label}</span><span class="anchor-meta">${anchor.capturedCount} 个叶节点</span>`
    anchorList.append(row)
  }
}

function clearCapturedTiles(message = '等待首次锚点捕获'): void {
  resetGlbCaptureScene(message)
}

function setCaptureButtonState(): void {
  addAnchorButton.disabled = !tiles
  exportCurrentGlbButton.disabled = capturedTileNodes.size === 0
}

function hasVisibleDescendant(tile: CapturableTile, visibleTiles: Set<CapturableTile>): boolean {
  const children = tile.children ?? []
  for (const child of children as CapturableTile[]) {
    if (visibleTiles.has(child) || hasVisibleDescendant(child, visibleTiles)) return true
  }
  return false
}

function isCapturedDescendant(candidate: CapturableTile): boolean {
  for (const existingTile of capturedTileNodes.keys() as IterableIterator<CapturableTile>) {
    let current: CapturableTile | null = existingTile
    while (current.parent) {
      current = current.parent as CapturableTile
      if (current === candidate) return true
    }
  }
  return false
}

function removeCapturedAncestors(candidate: CapturableTile): void {
  for (const [capturedTile, capturedNode] of [...capturedTileNodes.entries()] as Array<[CapturableTile, THREE.Object3D]>) {
    let current: CapturableTile | null = candidate
    while (current.parent) {
      current = current.parent as CapturableTile
      if (current === capturedTile) {
        glbCaptureRoot.remove(capturedNode)
        capturedTileNodes.delete(capturedTile)
        break
      }
    }
  }
}

function collectCurrentLeafTiles(): CapturableTile[] {
  if (!tiles) return []
  const visibleTiles = tiles.visibleTiles as Set<CapturableTile>
  return [...visibleTiles]
    .filter((tile) => Boolean(tile.engineData?.scene))
    .filter((tile) => !hasVisibleDescendant(tile, visibleTiles))
    .sort((a, b) => (b.internal?.depth ?? 0) - (a.internal?.depth ?? 0))
}

function captureVisibleTiles(): number {
  if (!tiles) return 0
  tiles.update()
  const candidates = collectCurrentLeafTiles()
  let added = 0


  for (const tile of candidates) {
    const scene = tile.engineData?.scene
    if (!scene) continue
    if (capturedTileNodes.has(tile)) continue
    if (isCapturedDescendant(tile)) continue

    removeCapturedAncestors(tile)
    const tileGroup = createCapturedTileGroup(scene)
    const skippedLarge = (tileGroup.userData as { skippedLarge?: number }).skippedLarge ?? 0
    glbSkippedLargeLeafCount += skippedLarge
    if (tileGroup.children.length === 0) continue
    tileGroup.name = `captured-${capturedTileNodes.size + 1}`
    glbCaptureRoot.add(tileGroup)
    capturedTileNodes.set(tile, tileGroup)
    added += 1
  }

  if (added > 0) {
    glbPreviewRevision += 1
    hideGlbPlaceholder()
    exportCurrentGlbButton.disabled = false
    if (!glbCameraFramed) {
      syncGlbCameraToMainView()
      glbCameraFramed = true
    }
    void refreshGlbPreview()
    glbPreviewProgress.textContent = `已捕获 ${capturedTileNodes.size} 个高精度叶节点。`
  } else if (capturedTileNodes.size === 0) {
    setGlbPlaceholder('当前视图没有可捕获的高精度叶节点', 'idle')
    glbPreviewProgress.textContent = '当前视图没有可捕获的高精度叶节点。'
  } else {
    glbPreviewProgress.textContent = '当前视图没有新增叶节点，已保留之前捕获的最高精度瓦片。'
  }
  logSummary('capture-summary', { added, captured: capturedTileNodes.size, skippedLarge: glbSkippedLargeLeafCount, sceneChildren: glbCaptureRoot.children.length, framed: glbCameraFramed })

  const count = added > 0 ? added : 0
  if (count > 0) {
    anchors.push({
      id: `anchor-${Date.now()}-${anchors.length}`,
      label: `锚点 ${anchors.length + 1}`,
      capturedCount: count,
      position: mainCamera.position.clone(),
    })
    renderAnchorList()
    updateCameraMarkers()
  }
  updateProgressUI()
  setCaptureButtonState()
  return added
}

function frameGlbPreview(): void {
  if (!glbPreviewModel) return
  syncGlbCameraToMainView()
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
    glbPreviewProgress.textContent = '没有可导出的锚点内容。'
    return
  }
  exporting = true
  exportCurrentGlbButton.disabled = true
  try {
    await refreshGlbPreview()
    if (!glbPreviewBuffer) throw new Error('GLB 预览还未准备好。')
    const blob = new Blob([glbPreviewBuffer], { type: 'model/gltf-binary' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `scene-${settings.lat.toFixed(5)}-${settings.lon.toFixed(5)}.glb`
    link.click()
    logSummary('export-ready', { children: glbCaptureRoot.children.length, captured: capturedTileNodes.size, bytes: glbPreviewBuffer.byteLength })
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    glbPreviewProgress.textContent = 'GLB 导出完成。'
  } catch (error) {
    glbPreviewProgress.textContent = error instanceof Error ? error.message : 'GLB 导出失败。'
  } finally {
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
    logSummary('load-ready', { source: sourceLabel, visible: next.visibleTiles.size, active: next.activeTiles.size, progress: next.loadProgress })
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

function resetLocation(): void {
  coordinateTextInput.value = `${settings.lat}, ${settings.lon}`
  groundElevationInput.value = String(settings.groundElevation)
  heightInput.value = String(settings.height)
  yaw = 0
  pitch = 0
  applyCameraRotation()
  clearCapturedTiles()
}

function handleAddAnchor(): void {
  if (!tiles) return
  mainControls.update()
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
  if (event.key.toLowerCase() !== 'a') return
  event.preventDefault()
  addAnchorButton.click()
}

$('#apply-location').addEventListener('click', applyLocation)
$('#reset-location').addEventListener('click', resetLocation)
addAnchorButton.addEventListener('click', handleAddAnchor)
exportCurrentGlbButton.addEventListener('click', () => void exportCurrentGlb())

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
  tiles?.update()
  mainControls.update()
  glbControls.update()
  mainRenderer.render(mainScene, mainCamera)
  glbRenderer.render(glbScene, glbCamera)
  updateProgressUI()
  tilesStat.textContent = tiles ? `${tiles.group.children.length} objects` : '-'
  requestAnimationFrame(animate)
}

resizeMain()
resizeGlb()
loadTiles().catch((error) => {
  setStatus('初始化失败', 'error')
  setPlaceholder(error instanceof Error ? error.message : '初始化失败', 'error')
})
animate()
