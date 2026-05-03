import stylesText from './styles.css?raw'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createBuiltInSampleDem, parseDemBlob, parseDemFile } from './dem'
import { buildTerrainMesh, exportTerrainAsJson, exportTerrainAsObj, exportTerrainAsPly } from './terrain'

type AppState = {
  fileName: string
  status: string
  mesh: THREE.Mesh | null
  terrain: ReturnType<typeof buildTerrainMesh> | null
  dem: Awaited<ReturnType<typeof parseDemFile>> | null
}

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('App root is missing')
}

const styleElement = document.createElement('style')
styleElement.textContent = stylesText
document.head.appendChild(styleElement)

app.innerHTML = `
  <div class="shell">
    <header class="hero">
      <div>
        <p class="eyebrow">Harmony terrain lab</p>
        <h1>DEM to Three.js mesh</h1>
      </div>
    </header>

    <main class="layout">
      <section class="panel controls">
        <div class="panel-header">
          <h2>Import</h2>
          <span class="chip" id="status-chip">Waiting for file</span>
        </div>
        <div class="actions">
          <button id="load-sample-dem">Load built-in sample DEM</button>
          <button id="load-heightmap-sample">Load PNG heightmap sample</button>
        </div>
        <label class="file-picker" for="dem-file-input">
          <input id="dem-file-input" type="file" accept=".tif,.tiff,.png,image/tiff,image/png" />
          <span class="file-picker-button">Select DEM</span>
          <span class="file-picker-copy">or drop a local GeoTIFF / PNG heightmap into the target area</span>
        </label>

        <div class="drop-zone" id="drop-zone">
          <strong>Drop a DEM file here</strong>
          <span>Supported: GeoTIFF / PNG grayscale heightmaps</span>
        </div>

        <div class="field-row">
          <label for="vertical-scale">Vertical scale</label>
          <input id="vertical-scale" type="range" min="0.1" max="20" step="0.1" value="1" />
          <output id="vertical-scale-output">1.0x</output>
        </div>

        <div class="actions">
          <button id="export-obj" disabled>Export OBJ</button>
          <button id="export-ply" disabled>Export PLY</button>
          <button id="export-json" disabled>Export JSON</button>
        </div>

        <div class="import-progress" id="import-progress" hidden>
          <div class="import-progress-head">
            <span id="import-progress-label">Idle</span>
            <span id="import-progress-value">0%</span>
          </div>
          <div class="import-progress-track" aria-hidden="true">
            <div class="import-progress-bar" id="import-progress-bar"></div>
          </div>
        </div>

        <div class="stats" id="stats">
          <div class="stats-grid">
            <div class="stat"><span>File</span><strong id="stat-file">-</strong></div>
            <div class="stat"><span>Raster</span><strong id="stat-size">-</strong></div>
            <div class="stat"><span>Elevation</span><strong id="stat-height">-</strong></div>
            <div class="stat"><span>Mesh</span><strong id="stat-mesh">-</strong></div>
          </div>
          <div class="stat stat-inline">
            <span>Terrain span</span>
            <strong id="stat-bounds">-</strong>
          </div>
          <div class="stats-meta">
            <div class="stat-mini">
              <span>Import mode</span>
              <strong id="stat-mode">-</strong>
            </div>
            <div class="stat-mini">
              <span>Source bounds</span>
              <strong id="stat-source-bounds">-</strong>
            </div>
            <div class="stat-mini">
              <span>Invalid samples</span>
              <strong id="stat-invalid">-</strong>
            </div>
          </div>
        </div>

        <div class="preview-card">
          <div class="panel-header compact">
            <h2>Raster preview</h2>
          </div>
          <img id="preview-image" alt="DEM preview" />
        </div>
      </section>

      <section class="panel viewer">
        <div class="panel-header">
          <h2>Terrain viewport</h2>
          <span class="chip subtle">Three.js</span>
        </div>
        <div class="viewport" id="viewport">
          <div class="viewport-placeholder" id="viewport-placeholder">Loading built-in sample DEM...</div>
        </div>
        <p class="note">Drag to orbit, scroll to zoom, and inspect the generated surface before exporting.</p>
      </section>
    </main>
  </div>
`

const state: AppState = {
  fileName: '-',
  status: 'Waiting for file',
  mesh: null,
  terrain: null,
  dem: null,
}

const fileInput = document.querySelector<HTMLInputElement>('#dem-file-input')!
const dropZone = document.querySelector<HTMLDivElement>('#drop-zone')!
const statusChip = document.querySelector<HTMLSpanElement>('#status-chip')!
const statFile = document.querySelector<HTMLElement>('#stat-file')!
const statSize = document.querySelector<HTMLElement>('#stat-size')!
const statHeight = document.querySelector<HTMLElement>('#stat-height')!
const statMesh = document.querySelector<HTMLElement>('#stat-mesh')!
const statBounds = document.querySelector<HTMLElement>('#stat-bounds')!
const statMode = document.querySelector<HTMLElement>('#stat-mode')!
const statSourceBounds = document.querySelector<HTMLElement>('#stat-source-bounds')!
const statInvalid = document.querySelector<HTMLElement>('#stat-invalid')!
const importProgressElement = document.querySelector<HTMLDivElement>('#import-progress')!
const importProgressLabel = document.querySelector<HTMLElement>('#import-progress-label')!
const importProgressValue = document.querySelector<HTMLElement>('#import-progress-value')!
const importProgressBar = document.querySelector<HTMLDivElement>('#import-progress-bar')!
const previewImage = document.querySelector<HTMLImageElement>('#preview-image')!
const exportObjButton = document.querySelector<HTMLButtonElement>('#export-obj')!
const exportPlyButton = document.querySelector<HTMLButtonElement>('#export-ply')!
const exportJsonButton = document.querySelector<HTMLButtonElement>('#export-json')!
const loadSampleButton = document.querySelector<HTMLButtonElement>('#load-sample-dem')!
const loadHeightmapSampleButton = document.querySelector<HTMLButtonElement>('#load-heightmap-sample')!
const viewportElement = document.querySelector<HTMLDivElement>('#viewport')!
const viewportPlaceholder = document.querySelector<HTMLDivElement>('#viewport-placeholder')!
const verticalScaleInput = document.querySelector<HTMLInputElement>('#vertical-scale')!
const verticalScaleOutput = document.querySelector<HTMLOutputElement>('#vertical-scale-output')!

function debugLog(message: string, details?: unknown): void {
  const stamp = new Date().toISOString()
  if (typeof details === 'undefined') {
    console.log(`[DEM Lab ${stamp}] ${message}`)
    return
  }
  const payload = typeof details === 'string' ? details : JSON.stringify(details, null, 2)
  console.log(`[DEM Lab ${stamp}] ${message} ${payload}`)
}

function debugError(message: string, error: unknown): void {
  const stamp = new Date().toISOString()
  const payload = error instanceof Error
    ? `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`
    : typeof error === 'string'
      ? error
      : JSON.stringify(error, null, 2)
  console.error(`[DEM Lab ${stamp}] ${message} ${payload}`)
}

const scene = new THREE.Scene()
scene.background = new THREE.Color('#08111f')
scene.fog = new THREE.Fog('#08111f', 80, 260)

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
camera.position.set(0, 45, 80)

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(viewportElement.clientWidth || 800, viewportElement.clientHeight || 600, false)
viewportElement.appendChild(renderer.domElement)
debugLog('Renderer initialized', {
  width: viewportElement.clientWidth || 800,
  height: viewportElement.clientHeight || 600,
  devicePixelRatio: Math.min(window.devicePixelRatio, 2),
})
debugLog('Renderer capabilities', {
  isWebGL2: renderer.capabilities.isWebGL2,
  maxTextureSize: renderer.capabilities.maxTextureSize,
  maxVertexTextures: renderer.capabilities.maxVertexTextures,
})

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.target.set(0, 0, 0)

scene.add(new THREE.AmbientLight('#cfe5ff', 1.1))
const sun = new THREE.DirectionalLight('#fff6db', 2.4)
sun.position.set(60, 100, 40)
scene.add(sun)
scene.add(new THREE.HemisphereLight('#88b7ff', '#13233d', 0.6))

const gridHelper = new THREE.GridHelper(120, 24, '#31476b', '#20314b')
scene.add(gridHelper)

const debugPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(1400, 1400, 1, 1),
  new THREE.MeshBasicMaterial({ color: '#17324d', transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
)
debugPlane.rotation.x = -Math.PI / 2
debugPlane.position.y = -12
scene.add(debugPlane)

const axesHelper = new THREE.AxesHelper(80)
scene.add(axesHelper)

const originMarker = new THREE.Mesh(
  new THREE.SphereGeometry(10, 24, 16),
  new THREE.MeshBasicMaterial({ color: '#ff6a00' }),
)
originMarker.position.set(0, 125, 0)
scene.add(originMarker)

const terrainGroup = new THREE.Group()
scene.add(terrainGroup)

let currentObjectUrl: string | null = null

function setViewportPlaceholderState(state: 'loading' | 'ready' | 'error', message?: string): void {
  if (!viewportPlaceholder) { 
    return
  }
  if (state === 'ready') {
    viewportPlaceholder.remove()
    return
  }
  viewportPlaceholder.textContent = message ?? (state === 'error' ? 'Failed to load DEM' : 'Loading built-in sample DEM...')
  viewportPlaceholder.hidden = false
  viewportPlaceholder.dataset.state = state
}

function setStatus(message: string, tone: 'idle' | 'ok' | 'error' = 'idle'): void {
  state.status = message
  statusChip.textContent = message
  statusChip.dataset.tone = tone
}

function setImportProgress(progress: { label: string; value: number | null } | null): void {
  if (!progress) {
    importProgressElement.hidden = true
    importProgressBar.style.width = '0%'
    importProgressBar.dataset.mode = ''
    importProgressLabel.textContent = 'Idle'
    importProgressValue.textContent = '0%'
    return
  }

  importProgressElement.hidden = false
  importProgressLabel.textContent = progress.label
  if (progress.value === null) {
    importProgressValue.textContent = '...'
    importProgressBar.dataset.mode = 'indeterminate'
    importProgressBar.style.width = '42%'
    return
  }

  const clamped = Math.max(0, Math.min(1, progress.value))
  importProgressValue.textContent = `${Math.round(clamped * 100)}%`
  importProgressBar.dataset.mode = 'determinate'
  importProgressBar.style.width = `${Math.max(4, clamped * 100)}%`
}

function updateStats(): void {
  statFile.textContent = state.fileName
  statSize.textContent = state.dem ? `${state.dem.width} × ${state.dem.height}` : '-'
  statHeight.textContent = state.dem && state.dem.minElevation !== null && state.dem.maxElevation !== null
    ? `${state.dem.minElevation.toFixed(2)} .. ${state.dem.maxElevation.toFixed(2)}`
    : '-'
  statMesh.textContent = state.terrain
    ? `${state.terrain.vertexCount.toLocaleString()} vertices, ${state.terrain.triangleCount.toLocaleString()} tris`
    : '-'
  statBounds.textContent = state.dem
    ? `${state.dem.renderSpace.boundsWidth.toFixed(1)} × ${state.dem.renderSpace.boundsDepth.toFixed(1)} ${state.dem.renderSpace.units === 'meters' ? 'm' : 'units'}`
    : '-'
  statMode.textContent = state.dem
    ? `${state.dem.renderSpace.source}, cell ${state.dem.renderSpace.cellSizeX.toFixed(2)} × ${state.dem.renderSpace.cellSizeZ.toFixed(2)}`
    : '-'
  statSourceBounds.textContent = state.dem?.renderSpace.sourceBoundsText ?? '-'
  statInvalid.textContent = state.dem
    ? `${state.dem.invalidSampleCount.toLocaleString()}${state.dem.noDataValue !== null ? ` (NoData ${state.dem.noDataValue})` : ''}`
    : '-'
}

function clearTerrain(): void {
  debugLog('Clearing terrain', { childCount: terrainGroup.children.length })
  while (terrainGroup.children.length > 0) {
    const child = terrainGroup.children[0]
    if (!child) break
    const object = child as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] }
    if (object.geometry) {
      object.geometry.dispose()
    }
    const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : []
    for (const material of materials) {
      material.dispose()
    }
    terrainGroup.remove(child)
  }
  state.mesh = null
  state.terrain = null
}

function fitCameraToTerrain(mesh: THREE.Mesh): void {
  const box = new THREE.Box3().setFromObject(mesh)
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  box.getSize(size)
  box.getCenter(center)
  const maxDim = Math.max(size.x, size.y, size.z, 1)
  const distance = maxDim * 1.6
  const fogNear = Math.max(20, distance * 0.35)
  const fogFar = Math.max(fogNear + 200, distance * 3)
  controls.target.copy(center)
  camera.position.set(center.x + distance, center.y + distance * 0.75, center.z + distance)
  camera.near = Math.max(0.1, maxDim / 100)
  const actualDistance = camera.position.distanceTo(controls.target)
  camera.far = Math.max(1000, actualDistance * 4, maxDim * 20)
  camera.updateProjectionMatrix()
  if (scene.fog instanceof THREE.Fog) {
    scene.fog.near = fogNear
    scene.fog.far = fogFar
  }
  controls.update()
  debugLog('Camera fitted to terrain', {
    center: { x: center.x, y: center.y, z: center.z },
    size: { x: size.x, y: size.y, z: size.z },
    distance,
    actualDistance,
    near: camera.near,
    far: camera.far,
    fogNear,
    fogFar,
  })
}

function updatePreview(url: string | null): void {
  if (!url) {
    previewImage.removeAttribute('src')
    return
  }
  previewImage.src = url
}

function downloadText(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function downloadBinary(filename: string, content: string, type: string): void {
  downloadText(filename, content, type)
}

function setButtonsEnabled(enabled: boolean): void {
  exportObjButton.disabled = !enabled
  exportPlyButton.disabled = !enabled
  exportJsonButton.disabled = !enabled
}

function loadDemResult(result: Awaited<ReturnType<typeof parseDemFile>> | ReturnType<typeof createBuiltInSampleDem>): void {
  setViewportPlaceholderState('ready')
  setImportProgress(null)
  const terrain = buildTerrainMesh(result, Number(verticalScaleInput.value) || 1)

  clearTerrain()
  terrainGroup.add(terrain.mesh)
  state.dem = result
  state.mesh = terrain.mesh
  state.terrain = terrain
  updatePreview(result.previewDataUrl)
  fitCameraToTerrain(terrain.mesh)
  updateStats()
  setButtonsEnabled(true)
  debugLog('DEM import diagnostics', {
    fileName: result.filename,
    raster: { width: result.width, height: result.height },
    elevation: { min: result.minElevation, max: result.maxElevation },
    renderSpace: result.renderSpace,
    invalidSampleCount: result.invalidSampleCount,
    noDataValue: result.noDataValue,
  })
}

async function loadDemFile(file: File): Promise<void> {
  try {
    setStatus(`Loading ${file.name}...`)
    setButtonsEnabled(false)
    state.fileName = file.name
    updateStats()
    setImportProgress({ label: 'Starting import', value: 0 })

    const dem = await parseDemFile(file, (progress) => {
      const value = progress.phase === 'parsing'
        ? null
        : progress.total > 0
          ? progress.loaded / progress.total
          : null
      setImportProgress({ label: progress.label, value })
    })
    loadDemResult(dem)
    setStatus(`Loaded ${file.name}`, 'ok')
  } catch (error) {
    clearTerrain()
    state.dem = null
    state.fileName = file.name
    updatePreview(null)
    updateStats()
    setButtonsEnabled(false)
    setImportProgress(null)
    setStatus(error instanceof Error ? error.message : 'Failed to load DEM', 'error')
  }
}

async function loadDemBlob(blob: Blob, filename: string, mimeType: string | null): Promise<void> {
  try {
    setStatus(`Loading ${filename}...`)
    setButtonsEnabled(false)
    state.fileName = filename
    updateStats()
    setImportProgress({ label: 'Starting import', value: 0 })

    const dem = await parseDemBlob(blob, filename, mimeType, { metersPerPixel: 20 })
    loadDemResult(dem)
    setStatus(`Loaded ${filename}`, 'ok')
  } catch (error) {
    clearTerrain()
    state.dem = null
    state.fileName = filename
    updatePreview(null)
    updateStats()
    setButtonsEnabled(false)
    setImportProgress(null)
    setStatus(error instanceof Error ? error.message : 'Failed to load DEM', 'error')
  }
}

function loadSampleDem(): void {
  try {
    setStatus('Loading built-in sample DEM...')
    setButtonsEnabled(false)
    setViewportPlaceholderState('loading', 'Loading built-in sample DEM...')
    setImportProgress({ label: 'Generating sample terrain', value: null })
    const sample = createBuiltInSampleDem()
    state.fileName = sample.filename
    updateStats()
    loadDemResult(sample)
    setStatus('Loaded built-in sample DEM', 'ok')
  } catch (error) {
    clearTerrain()
    state.dem = null
    setViewportPlaceholderState('error', error instanceof Error ? error.message : 'Failed to load built-in sample DEM')
    updatePreview(null)
    updateStats()
    setButtonsEnabled(false)
    setImportProgress(null)
    setStatus(error instanceof Error ? error.message : 'Failed to load built-in sample DEM', 'error')
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (file) {
    void loadDemFile(file)
  }
})

loadSampleButton.addEventListener('click', () => {
  loadSampleDem()
})

loadHeightmapSampleButton.addEventListener('click', () => {
  void (async () => {
    try {
      setStatus('Loading PNG heightmap sample...')
      setButtonsEnabled(false)
      setViewportPlaceholderState('loading', 'Loading PNG heightmap sample...')
      setImportProgress({ label: 'Fetching PNG heightmap sample', value: null })
      const sampleUrl = new URL('../test-fixtures/heightmap-1000m-1000m-20m.png', import.meta.url)
      const response = await fetch(sampleUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch PNG heightmap sample: ${response.status} ${response.statusText}`)
      }
      const blob = await response.blob()
      await loadDemBlob(blob, 'heightmap-1000m-1000m-20m.png', 'image/png')
      setStatus('Loaded PNG heightmap sample', 'ok')
    } catch (error) {
      clearTerrain()
      state.dem = null
      state.fileName = 'heightmap-1000m-1000m-20m.png'
      setViewportPlaceholderState('error', error instanceof Error ? error.message : 'Failed to load PNG heightmap sample')
      updatePreview(null)
      updateStats()
      setButtonsEnabled(false)
      setImportProgress(null)
      setStatus(error instanceof Error ? error.message : 'Failed to load PNG heightmap sample', 'error')
    }
  })()
})

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault()
  dropZone.dataset.active = 'true'
})

dropZone.addEventListener('dragleave', () => {
  delete dropZone.dataset.active
})

dropZone.addEventListener('drop', (event) => {
  event.preventDefault()
  delete dropZone.dataset.active
  const file = event.dataTransfer?.files?.[0]
  if (file) {
    void loadDemFile(file)
  }
})

window.addEventListener('dragover', (event) => event.preventDefault())
window.addEventListener('drop', (event) => {
  if (event.target !== dropZone) {
    event.preventDefault()
  }
})

verticalScaleInput.addEventListener('input', () => {
  const value = Number(verticalScaleInput.value) || 1
  verticalScaleOutput.textContent = `${value.toFixed(1)}x`
  if (state.dem) {
    const terrain = buildTerrainMesh(state.dem, value)
    clearTerrain()
    terrainGroup.add(terrain.mesh)
    state.mesh = terrain.mesh
    state.terrain = terrain
    fitCameraToTerrain(terrain.mesh)
    updateStats()
  }
})

exportObjButton.addEventListener('click', () => {
  if (!state.mesh || !state.dem) return
  const obj = exportTerrainAsObj(state.mesh)
  downloadText(`${state.dem.filename}.obj`, obj, 'text/plain')
})

exportPlyButton.addEventListener('click', () => {
  if (!state.mesh || !state.dem) return
  const ply = exportTerrainAsPly(state.mesh)
  downloadBinary(`${state.dem.filename}.ply`, ply, 'text/plain')
})

exportJsonButton.addEventListener('click', () => {
  if (!state.terrain || !state.dem) return
  const json = exportTerrainAsJson(state.dem, state.terrain)
  downloadText(`${state.dem.filename}.terrain.json`, json, 'application/json')
})

updatePreview(null)
updateStats()
setImportProgress(null)

setViewportPlaceholderState('loading', 'Loading built-in sample DEM...')
loadSampleDem()

function resize(): void {
  const width = viewportElement.clientWidth || 1
  const height = viewportElement.clientHeight || 1
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
}

window.setTimeout(() => {
  resize()
}, 0)

window.addEventListener('resize', resize)
resize()

function animate(): void {
  controls.update()
  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}


animate()
