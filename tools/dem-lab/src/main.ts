import './styles.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createBuiltInSampleDem, parseDemFile } from './dem'
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

app.innerHTML = `
  <div class="shell">
    <header class="hero">
      <div>
        <p class="eyebrow">Harmony terrain lab</p>
        <h1>DEM to Three.js mesh</h1>
        <p class="lede">Load a local GeoTIFF DEM, inspect the sampled height field, and export the generated terrain for validation.</p>
      </div>
      <div class="hero-card">
        <div class="hero-card-title">Quick path</div>
        <ol>
          <li>Choose or drop a DEM file</li>
          <li>Inspect the generated mesh</li>
          <li>Export OBJ or JSON</li>
        </ol>
      </div>
    </header>

    <main class="layout">
      <section class="panel controls">
        <div class="panel-header">
          <h2>Import</h2>
          <span class="chip" id="status-chip">Waiting for file</span>
        </div>
        <div class="actions actions-single">
          <button id="load-sample-dem">Load built-in sample DEM</button>
        </div>
        <label class="file-picker" for="dem-file-input">
          <input id="dem-file-input" type="file" accept=".tif,.tiff,image/tiff" />
          <span class="file-picker-button">Select DEM</span>
          <span class="file-picker-copy">or drop a local GeoTIFF into the target area</span>
        </label>
        <div class="drop-zone" id="drop-zone">
          <strong>Drop a DEM file here</strong>
          <span>Supported: GeoTIFF / DEM raster files</span>
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

        <div class="stats" id="stats">
          <div class="stat"><span>File</span><strong id="stat-file">-</strong></div>
          <div class="stat"><span>Raster</span><strong id="stat-size">-</strong></div>
          <div class="stat"><span>Elevation</span><strong id="stat-height">-</strong></div>
          <div class="stat"><span>Mesh</span><strong id="stat-mesh">-</strong></div>
          <div class="stat"><span>Bounds</span><strong id="stat-bounds">-</strong></div>
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
const previewImage = document.querySelector<HTMLImageElement>('#preview-image')!
const exportObjButton = document.querySelector<HTMLButtonElement>('#export-obj')!
const exportPlyButton = document.querySelector<HTMLButtonElement>('#export-ply')!
const exportJsonButton = document.querySelector<HTMLButtonElement>('#export-json')!
const loadSampleButton = document.querySelector<HTMLButtonElement>('#load-sample-dem')!
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

const axesHelper = new THREE.AxesHelper(80)
scene.add(axesHelper)

const originMarker = new THREE.Mesh(
  new THREE.SphereGeometry(4, 24, 16),
  new THREE.MeshBasicMaterial({ color: '#ff6a00' }),
)
originMarker.position.set(0, 138, 0)
scene.add(originMarker)

const terrainGroup = new THREE.Group()
scene.add(terrainGroup)

let currentObjectUrl: string | null = null

function setStatus(message: string, tone: 'idle' | 'ok' | 'error' = 'idle'): void {
  state.status = message
  statusChip.textContent = message
  statusChip.dataset.tone = tone
  debugLog('Status updated', { message, tone })
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
  statBounds.textContent = state.dem?.worldBounds
    ? `${state.dem.worldBounds.minX.toFixed(2)}, ${state.dem.worldBounds.minZ.toFixed(2)} → ${state.dem.worldBounds.maxX.toFixed(2)}, ${state.dem.worldBounds.maxZ.toFixed(2)}`
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
  controls.target.copy(center)
  camera.position.set(center.x + distance, center.y + distance * 0.75, center.z + distance)
  camera.near = Math.max(0.1, maxDim / 100)
  camera.far = Math.max(1000, maxDim * 20)
  camera.updateProjectionMatrix()
  controls.update()
  debugLog('Camera fitted to terrain', {
    center: { x: center.x, y: center.y, z: center.z },
    size: { x: size.x, y: size.y, z: size.z },
    distance,
  })
}

function updatePreview(url: string | null): void {
  if (!url) {
    previewImage.removeAttribute('src')
    debugLog('Preview cleared')
    return
  }
  previewImage.src = url
  debugLog('Preview updated', { hasPreview: true, length: url.length })
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
  debugLog('Export buttons state changed', { enabled })
}

function loadDemResult(result: Awaited<ReturnType<typeof parseDemFile>> | ReturnType<typeof createBuiltInSampleDem>): void {
  debugLog('Loading DEM result into terrain', {
    filename: result.filename,
    width: result.width,
    height: result.height,
    minElevation: result.minElevation,
    maxElevation: result.maxElevation,
    hasPreview: Boolean(result.previewDataUrl),
  })
  if (viewportPlaceholder) {
    viewportPlaceholder.hidden = true
  }
  const terrain = buildTerrainMesh(result, Number(verticalScaleInput.value) || 1)
  debugLog('Terrain mesh built', {
    vertexCount: terrain.vertexCount,
    triangleCount: terrain.triangleCount,
    boundsWidth: terrain.boundsWidth,
    boundsDepth: terrain.boundsDepth,
  })

  clearTerrain()
  terrainGroup.add(terrain.mesh)
  state.dem = result
  state.mesh = terrain.mesh
  state.terrain = terrain
  debugLog('Terrain group updated', {
    childCount: terrainGroup.children.length,
    meshVisible: terrain.mesh.visible,
    geometryType: terrain.mesh.geometry.type,
    materialType: Array.isArray(terrain.mesh.material) ? 'multiple' : terrain.mesh.material.type,
  })
  debugLog('Viewport visibility markers', {
    originMarkerVisible: originMarker.visible,
    axesHelperVisible: axesHelper.visible,
  })
  updatePreview(result.previewDataUrl)
  fitCameraToTerrain(terrain.mesh)
  updateStats()
  setButtonsEnabled(true)
}

async function loadDemFile(file: File): Promise<void> {
  try {
    debugLog('Loading external DEM file', { name: file.name, type: file.type, size: file.size })
    setStatus(`Loading ${file.name}...`)
    setButtonsEnabled(false)
    state.fileName = file.name
    updateStats()

    const dem = await parseDemFile(file)
    debugLog('External DEM parsed', {
      filename: dem.filename,
      width: dem.width,
      height: dem.height,
      minElevation: dem.minElevation,
      maxElevation: dem.maxElevation,
    })
    loadDemResult(dem)
    setStatus(`Loaded ${file.name}`, 'ok')
  } catch (error) {
    debugError('Failed to load external DEM', error)
    clearTerrain()
    state.dem = null
    state.fileName = file.name
    updatePreview(null)
    updateStats()
    setButtonsEnabled(false)
    setStatus(error instanceof Error ? error.message : 'Failed to load DEM', 'error')
  }
}

function loadSampleDem(): void {
  try {
    debugLog('Loading built-in sample DEM')
    setStatus('Loading built-in sample DEM...')
    setButtonsEnabled(false)
    const sample = createBuiltInSampleDem()
    debugLog('Built-in sample DEM generated', {
      filename: sample.filename,
      width: sample.width,
      height: sample.height,
      minElevation: sample.minElevation,
      maxElevation: sample.maxElevation,
      hasPreview: Boolean(sample.previewDataUrl),
    })
    state.fileName = sample.filename
    updateStats()
    loadDemResult(sample)
    setStatus('Loaded built-in sample DEM', 'ok')
  } catch (error) {
    debugError('Failed to load built-in sample DEM', error)
    clearTerrain()
    state.dem = null
    updatePreview(null)
    updateStats()
    setButtonsEnabled(false)
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

loadSampleDem()

function resize(): void {
  const width = viewportElement.clientWidth || 1
  const height = viewportElement.clientHeight || 1
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  debugLog('Viewport resized', { width, height })
}

window.setTimeout(() => {
  resize()
  debugLog('Deferred resize check', {
    viewportWidth: viewportElement.clientWidth,
    viewportHeight: viewportElement.clientHeight,
    canvasWidth: renderer.domElement.clientWidth,
    canvasHeight: renderer.domElement.clientHeight,
  })
}, 0)

window.addEventListener('resize', resize)
resize()

function animate(): void {
  controls.update()
  renderer.render(scene, camera)
  if (!(window as unknown as { __DEM_LAB_FIRST_FRAME_LOGGED?: boolean }).__DEM_LAB_FIRST_FRAME_LOGGED) {
    ;(window as unknown as { __DEM_LAB_FIRST_FRAME_LOGGED?: boolean }).__DEM_LAB_FIRST_FRAME_LOGGED = true
    debugLog('First frame rendered', {
      sceneChildren: scene.children.length,
      terrainChildren: terrainGroup.children.length,
      canvasSize: {
        width: renderer.domElement.width,
        height: renderer.domElement.height,
      },
    })
  }
  if ((window as unknown as { __DEM_LAB_RENDER_DIAG?: boolean }).__DEM_LAB_RENDER_DIAG) {
    debugLog('Frame rendered', {
      sceneChildren: scene.children.length,
      terrainChildren: terrainGroup.children.length,
      camera: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      target: {
        x: controls.target.x,
        y: controls.target.y,
        z: controls.target.z,
      },
      output: {
        width: renderer.domElement.width,
        height: renderer.domElement.height,
      },
    })
  }
  requestAnimationFrame(animate)
}

debugLog('DEM lab initialized', {
  viewportWidth: viewportElement.clientWidth,
  viewportHeight: viewportElement.clientHeight,
  initialStatus: state.status,
})

animate()
