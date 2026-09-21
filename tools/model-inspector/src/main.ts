import * as THREE from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'
import stylesText from './styles.css?raw'
import {
  DEFAULT_ENGINE_POST_PROCESS,
  DEFAULT_HELPER_SETTINGS,
  DEFAULT_MATERIAL_OVERRIDES,
  PIPELINE_DESCRIPTIONS,
  PIPELINE_LABELS,
  PIPELINE_MODES,
  type CameraViewId,
  type DisplayMode,
  type EnginePostProcessOptions,
  type HelperSettings,
  type MaterialOverrides,
  type ModelSource,
  type PipelineMode,
} from './types'
import {
  disposeObject3D,
  explainLoadFailure,
  formatBytes,
  loadModel,
  resolveFileExtension,
  type LoadedModel,
} from './viewer/pipeline'
import { applyMaterialState, restoreOriginalMaterials } from './viewer/materialState'
import { inspectScene, summarizeIssueCounts, type InspectionResult } from './viewer/inspect'
import { DEFAULT_STAGE_SETTINGS, Stage, type StageSettings } from './viewer/stage'
import { LAYOUT_HTML, queryLayout, type LayoutRefs } from './ui/layout'
import {
  escapeHtml,
  renderAnimations,
  renderIssues,
  renderMaterials,
  renderNodes,
  renderSummary,
  renderTextures,
} from './ui/lists'
import {
  buildGlbFileName,
  buildReport,
  buildReportFileName,
  buildScreenshotFileName,
  copyReportToClipboard,
  downloadDataUrl,
  downloadJson,
  exportNormalizedGlb,
} from './viewer/report'

type PaneStatus = 'idle' | 'loading' | 'ready' | 'error'

type PaneState = {
  status: PaneStatus
  model: LoadedModel | null
  inspection: InspectionResult | null
  error: string | null
  progress: number | null
}

type InspectorTab = 'summary' | 'nodes' | 'materials' | 'textures' | 'issues' | 'animations'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('缺少 #app 根节点')
}

const styleElement = document.createElement('style')
styleElement.textContent = stylesText
document.head.appendChild(styleElement)

app.innerHTML = LAYOUT_HTML
const ui: LayoutRefs = queryLayout(document)

const stage = new Stage(ui.viewport)
stage.start()

const panes: Record<PipelineMode, PaneState> = {
  engine: { status: 'idle', model: null, inspection: null, error: null, progress: null },
  native: { status: 'idle', model: null, inspection: null, error: null, progress: null },
}
const mixers: Record<PipelineMode, THREE.AnimationMixer | null> = { engine: null, native: null }
const actions: Record<PipelineMode, THREE.AnimationAction | null> = { engine: null, native: null }

let source: ModelSource | null = null
let sourceLabel = ''
let pipeline: PipelineMode = 'engine'
let split = false
let activeTab: InspectorTab = 'summary'
let displayMode: DisplayMode = 'original'
let overrides: MaterialOverrides = { ...DEFAULT_MATERIAL_OVERRIDES }
let helpers: HelperSettings = { ...DEFAULT_HELPER_SETTINGS }
let postProcess: EnginePostProcessOptions = { ...DEFAULT_ENGINE_POST_PROCESS }
let environmentTexture: THREE.Texture | null = null
let loadingTask = 0
let selectedNodeIndex: number | null = null
let materialStateHandle = 0

const playback = { index: 0, playing: true, speed: 1, time: 0 }

function readNumber(input: HTMLInputElement, fallback: number): number {
  const value = Number.parseFloat(input.value)
  return Number.isFinite(value) ? value : fallback
}

function currentStageSettings(): StageSettings {
  return stage.getSettings()
}

function activePane(): PaneState {
  return panes[pipeline]
}

function hasAnyModel(): boolean {
  return PIPELINE_MODES.some((mode) => Boolean(panes[mode].model))
}

function setStatusChip(): void {
  const anyLoading = PIPELINE_MODES.some((mode) => panes[mode].status === 'loading')
  const anyError = PIPELINE_MODES.some((mode) => panes[mode].status === 'error')
  const ready = PIPELINE_MODES.filter((mode) => panes[mode].status === 'ready')

  if (anyLoading) {
    ui.statusChip.textContent = '加载中…'
    ui.statusChip.dataset.tone = 'warn'
    return
  }
  if (anyError) {
    ui.statusChip.textContent = '有管线加载失败'
    ui.statusChip.dataset.tone = 'error'
    return
  }
  if (ready.length) {
    ui.statusChip.textContent = `${ready.length} 条管线就绪`
    ui.statusChip.dataset.tone = 'ok'
    return
  }
  ui.statusChip.textContent = '等待加载模型'
  ui.statusChip.dataset.tone = 'subtle'
}

function paneStateHtml(mode: PipelineMode): string {
  const pane = panes[mode]
  if (pane.status === 'ready') {
    return ''
  }
  if (pane.status === 'loading') {
    const progress = pane.progress === null ? '' : ` ${Math.round(pane.progress * 100)}%`
    return `<div class="pane-state" data-status="loading"><strong>${escapeHtml(PIPELINE_LABELS[mode])} 加载中…</strong><span>读取与解析模型${progress}</span></div>`
  }
  if (pane.status === 'error') {
    return `<div class="pane-state" data-status="error"><strong>${escapeHtml(PIPELINE_LABELS[mode])} 加载失败</strong><pre>${escapeHtml(pane.error ?? '未知错误')}</pre></div>`
  }
  return `<div class="pane-state"><strong>${escapeHtml(PIPELINE_LABELS[mode])}</strong><span>尚未加载模型：选择本地文件、粘贴 URL，或拖拽到视口。</span></div>`
}

function renderPaneChrome(): void {
  const modes: PipelineMode[] = split ? ['engine', 'native'] : [pipeline]
  ui.paneLabels.innerHTML = modes
    .map((mode) => `<div class="pane-half"><span class="chip pane-label">${escapeHtml(PIPELINE_LABELS[mode])}</span></div>`)
    .join('')
  ui.paneOverlays.innerHTML = modes
    .map((mode) => `<div class="pane-half">${paneStateHtml(mode)}</div>`)
    .join('')
  if (split) {
    ui.paneOverlays.innerHTML += '<div class="split-divider"></div>'
  }
}

function renderBadges(): void {
  const badges: string[] = []
  for (const mode of PIPELINE_MODES) {
    const pane = panes[mode]
    const tone = pane.status === 'ready' ? 'ok' : pane.status === 'error' ? 'error' : pane.status === 'loading' ? 'warn' : 'subtle'
    const text = pane.status === 'ready' ? '已加载' : pane.status === 'error' ? '失败' : pane.status === 'loading' ? '加载中' : '空闲'
    if (split || mode === pipeline) {
      badges.push(`<span class="chip" data-tone="${tone}">${escapeHtml(PIPELINE_LABELS[mode])}：${text}</span>`)
    }
  }

  const model = activePane().model
  if (model && !model.engineSupported) {
    badges.push('<span class="chip" data-tone="error">引擎 loader 不支持该格式</span>')
  }
  const unsupportedNotice = model?.notices.find((notice) => notice.includes('未挂解码器'))
  if (unsupportedNotice) {
    badges.push('<span class="chip" data-tone="warn">使用了引擎未支持的压缩扩展</span>')
  }
  if (model?.notices.length) {
    badges.push(`<span class="chip subtle">${model.notices.length} 条引擎行为提示</span>`)
  }
  ui.stageBadges.innerHTML = badges.join('')
}

function renderStageTitle(): void {
  const model = activePane().model
  if (!model) {
    ui.stageTitle.textContent = sourceLabel || '尚未加载模型'
    return
  }
  ui.stageTitle.textContent = `${model.file.name} · ${formatBytes(model.file.bytes)} · ${PIPELINE_LABELS[pipeline]}`
}

function updateExportAvailability(): void {
  const ready = hasAnyModel()
  ui.exportScreenshot.disabled = !ready
  ui.exportReport.disabled = !ready
  ui.copyReport.disabled = !ready
  ui.exportGlb.disabled = !panes[pipeline].model
}

function updateViewportBackgroundAttribute(): void {
  ui.viewport.dataset.transparent = String(currentStageSettings().background === 'transparent')
}

function refreshChrome(): void {
  setStatusChip()
  renderStageTitle()
  renderBadges()
  renderPaneChrome()
  updateExportAvailability()
  updateViewportBackgroundAttribute()
  ui.pipelineHint.textContent = PIPELINE_DESCRIPTIONS[pipeline]
}

function renderInspector(): void {
  const pane = activePane()
  switch (activeTab) {
    case 'nodes':
      ui.inspectorBody.innerHTML = renderNodes(pane.inspection?.nodes ?? [])
      break
    case 'materials':
      ui.inspectorBody.innerHTML = renderMaterials(pane.inspection?.materials ?? [])
      break
    case 'textures':
      ui.inspectorBody.innerHTML = renderTextures(pane.inspection?.textures ?? [])
      break
    case 'issues': {
      const issues = pane.inspection?.issues ?? []
      ui.inspectorBody.innerHTML = renderIssues(issues, summarizeIssueCounts(issues))
      break
    }
    case 'animations':
      ui.inspectorBody.innerHTML = renderAnimations(pane.inspection?.animations ?? [], playback)
      break
    case 'summary':
    default:
      ui.inspectorBody.innerHTML = renderSummary({
        model: pane.model,
        pipeline,
        inspection: pane.inspection,
        stage: currentStageSettings(),
        errors: { engine: panes.engine.error, native: panes.native.error },
        parsePaths: { engine: panes.engine.model?.parsePath ?? null, native: panes.native.model?.parsePath ?? null },
      })
      break
  }
}

function findByTraversalIndex(root: THREE.Object3D, index: number): THREE.Object3D | null {
  let counter = 0
  let found: THREE.Object3D | null = null
  root.traverse((child) => {
    if (!found && counter === index) {
      found = child
    }
    counter += 1
  })
  return found
}

function applyMaterialStateToPanes(): void {
  for (const mode of PIPELINE_MODES) {
    const root = panes[mode].model?.root
    if (root) {
      applyMaterialState(root, displayMode, overrides)
    }
  }
}

/** Coalesces the burst of `input` events produced by colour pickers and sliders. */
function scheduleMaterialStateUpdate(): void {
  if (materialStateHandle !== 0) {
    return
  }
  materialStateHandle = requestAnimationFrame(() => {
    materialStateHandle = 0
    applyMaterialStateToPanes()
  })
}

function clearPane(mode: PipelineMode): void {
  const pane = panes[mode]
  if (mixers[mode]) {
    mixers[mode]?.stopAllAction()
    mixers[mode] = null
  }
  actions[mode] = null
  if (pane.model) {
    restoreOriginalMaterials(pane.model.root)
    stage.detachModel(mode)
    disposeObject3D(pane.model.root)
  }
  pane.model = null
  pane.inspection = null
  pane.error = null
  pane.progress = null
  pane.status = 'idle'
}

function setupAnimation(mode: PipelineMode): void {
  const pane = panes[mode]
  const model = pane.model
  if (!model) {
    return
  }
  if (mixers[mode]) {
    mixers[mode]?.stopAllAction()
  }
  mixers[mode] = model.animations.length ? new THREE.AnimationMixer(model.root) : null
  actions[mode] = null
  if (model.animations.length) {
    playback.index = Math.min(playback.index, model.animations.length - 1)
    applyAnimationClip(mode)
  }
}

function applyAnimationClip(mode: PipelineMode): void {
  const mixer = mixers[mode]
  const model = panes[mode].model
  if (!mixer || !model || !model.animations.length) {
    actions[mode] = null
    return
  }
  actions[mode]?.stop()
  const clip = model.animations[Math.min(playback.index, model.animations.length - 1)]
  if (!clip) {
    actions[mode] = null
    return
  }
  const action = mixer.clipAction(clip)
  action.reset()
  action.setLoop(THREE.LoopRepeat, Infinity)
  action.timeScale = playback.speed
  action.paused = !playback.playing
  action.play()
  action.time = Math.min(playback.time, clip.duration)
  mixer.update(0)
  actions[mode] = action
}

async function loadPane(mode: PipelineMode, task = loadingTask): Promise<void> {
  const pane = panes[mode]
  if (!source) {
    return
  }
  const requestSource = source
  clearPane(mode)
  pane.status = 'loading'
  refreshChrome()

  try {
    const model = await loadModel({
      source: requestSource,
      mode,
      renderer: stage.renderer,
      postProcess,
      onProgress: (loaded, total) => {
        if (task !== loadingTask) {
          return
        }
        pane.progress = total > 0 ? Math.min(1, loaded / total) : null
        renderPaneChrome()
      },
    })
    if (task !== loadingTask) {
      // A newer load started while this one was parsing: drop the stale result.
      disposeObject3D(model.root)
      return
    }
    pane.model = model
    pane.status = 'ready'
    stage.attachModel(mode, model.root)
    applyMaterialState(model.root, displayMode, overrides)
    pane.inspection = inspectScene(model.root, model.animations)
    setupAnimation(mode)
    if (mode === pipeline) {
      stage.fit()
    }
  } catch (error) {
    if (task !== loadingTask) {
      return
    }
    const hint = explainLoadFailure(error)
    const message = error instanceof Error ? error.message : String(error)
    pane.status = 'error'
    pane.error = hint ? `${message}\n\n${hint}` : message
  }

  refreshChrome()
  renderInspector()
}

async function loadFromSource(next: ModelSource, label: string): Promise<void> {
  source = next
  sourceLabel = label
  loadingTask += 1
  const task = loadingTask

  const modes: PipelineMode[] = split ? ['engine', 'native'] : [pipeline]
  for (const mode of modes) {
    if (task !== loadingTask) {
      return
    }
    await loadPane(mode, task)
  }
}

function reloadEnginePane(): void {
  if (!source) {
    return
  }
  if (panes.engine.status === 'idle' && !panes.engine.model && !panes.engine.error) {
    return
  }
  void loadPane('engine', loadingTask)
}

function ensurePaneLoaded(mode: PipelineMode): void {
  if (!source) {
    return
  }
  const pane = panes[mode]
  if (pane.status === 'idle') {
    void loadPane(mode, loadingTask)
  }
}

function setNodeVisibility(index: number, visible: boolean): void {
  for (const mode of PIPELINE_MODES) {
    const root = panes[mode].model?.root
    if (!root) {
      continue
    }
    const target = findByTraversalIndex(root, index)
    if (target) {
      target.visible = visible
    }
  }
}

function frameNode(index: number): void {
  selectedNodeIndex = index
  stage.setSelectionByIndex(helpers.bounds ? index : null)
  stage.frameObjectByIndex(index)
}

function readOverridesFromUi(): void {
  overrides = {
    side: ui.overrideSide.value as MaterialOverrides['side'],
    transparent: ui.overrideTransparent.value as MaterialOverrides['transparent'],
    alphaTest: ui.overrideAlphaTest.value.trim().length ? readNumber(ui.overrideAlphaTest, 0) : null,
    flatShading: ui.overrideFlatShading.value as MaterialOverrides['flatShading'],
    depthWrite: ui.overrideDepthWrite.value as MaterialOverrides['depthWrite'],
    metalness: ui.overrideMetalness.value.trim().length ? readNumber(ui.overrideMetalness, 0) : null,
    roughness: ui.overrideRoughness.value.trim().length ? readNumber(ui.overrideRoughness, 0) : null,
    toneMapped: ui.overrideToneMapped.value as MaterialOverrides['toneMapped'],
  }
}

function applyStageSettingsFromUi(): void {
  const settings: StageSettings = {
    ...DEFAULT_STAGE_SETTINGS,
    ambientColor: ui.ambientColor.value,
    ambientIntensity: readNumber(ui.ambientIntensity, DEFAULT_STAGE_SETTINGS.ambientIntensity),
    sunColor: ui.sunColor.value,
    sunIntensity: readNumber(ui.sunIntensity, DEFAULT_STAGE_SETTINGS.sunIntensity),
    sunAzimuthDeg: readNumber(ui.sunAzimuth, DEFAULT_STAGE_SETTINGS.sunAzimuthDeg),
    sunElevationDeg: readNumber(ui.sunElevation, DEFAULT_STAGE_SETTINGS.sunElevationDeg),
    shadows: ui.shadowToggle.checked,
    background: ui.backgroundMode.value as StageSettings['background'],
    backgroundColor: ui.backgroundColor.value,
    gradientTopColor: ui.gradientTopColor.value,
    environmentIntensity: readNumber(ui.environmentIntensity, DEFAULT_STAGE_SETTINGS.environmentIntensity),
    exposure: readNumber(ui.exposure, DEFAULT_STAGE_SETTINGS.exposure),
    toneMapping: ui.toneMapping.value as StageSettings['toneMapping'],
    grid: ui.helperGrid.checked,
    axes: ui.helperAxes.checked,
  }
  stage.applySettings(settings)
  updateViewportBackgroundAttribute()
}

function syncUiFromSettings(): void {
  const settings = DEFAULT_STAGE_SETTINGS
  ui.ambientColor.value = settings.ambientColor
  ui.ambientIntensity.value = String(settings.ambientIntensity)
  ui.sunColor.value = settings.sunColor
  ui.sunIntensity.value = String(settings.sunIntensity)
  ui.sunAzimuth.value = String(settings.sunAzimuthDeg)
  ui.sunElevation.value = String(settings.sunElevationDeg)
  ui.shadowToggle.checked = settings.shadows
  ui.backgroundMode.value = settings.background
  ui.backgroundColor.value = settings.backgroundColor
  ui.gradientTopColor.value = settings.gradientTopColor
  ui.environmentIntensity.value = String(settings.environmentIntensity)
  ui.exposure.value = String(settings.exposure)
  ui.toneMapping.value = settings.toneMapping
  ui.helperGrid.checked = helpers.grid
  ui.helperAxes.checked = helpers.axes
  ui.helperBounds.checked = helpers.bounds
  ui.helperSkeleton.checked = helpers.skeleton
  ui.splitToggle.checked = split
}

function collectFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items ?? [])
  const entries = items
    .map((item) => item.webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is FileSystemEntry => Boolean(entry))

  if (!entries.length) {
    return Promise.resolve(Array.from(dataTransfer.files ?? []))
  }

  const files: File[] = []

  const readFileEntry = (entry: FileSystemFileEntry): Promise<void> =>
    new Promise((resolve) => {
      entry.file(
        (file) => {
          files.push(file)
          resolve()
        },
        () => resolve(),
      )
    })

  const readDirectoryEntry = async (entry: FileSystemDirectoryEntry): Promise<void> => {
    const reader = entry.createReader()
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) => {
        reader.readEntries(
          (results) => resolve(results),
          () => resolve([]),
        )
      })
      if (!batch.length) {
        return
      }
      for (const child of batch) {
        await readEntry(child)
      }
    }
  }

  const readEntry = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      await readFileEntry(entry as FileSystemFileEntry)
      return
    }
    if (entry.isDirectory) {
      await readDirectoryEntry(entry as FileSystemDirectoryEntry)
    }
  }

  return (async () => {
    for (const entry of entries) {
      await readEntry(entry)
    }
    return files.length ? files : Array.from(dataTransfer.files ?? [])
  })()
}

async function loadEnvironmentFile(file: File): Promise<void> {
  const url = URL.createObjectURL(file)
  try {
    const extension = resolveFileExtension(file.name)
    const loader = extension === 'exr' ? new EXRLoader() : new HDRLoader()
    const texture = await loader.loadAsync(url)
    texture.mapping = THREE.EquirectangularReflectionMapping
    const previous = environmentTexture
    environmentTexture = texture
    stage.setEnvironmentTexture(texture, previous)
    ui.backgroundMode.value = 'hdri'
    applyStageSettingsFromUi()
  } catch (error) {
    ui.exportHint.textContent = `环境贴图加载失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    URL.revokeObjectURL(url)
  }
}

function currentReport() {
  return buildReport({
    model: activePane().model,
    pipeline,
    inspection: activePane().inspection,
    stage: currentStageSettings(),
    engineError: panes.engine.error,
    nativeError: panes.native.error,
    engineParsePath: panes.engine.model?.parsePath ?? null,
    nativeParsePath: panes.native.model?.parsePath ?? null,
  })
}

function wireEvents(): void {
  ui.fileInput.addEventListener('change', () => {
    const files = Array.from(ui.fileInput.files ?? [])
    if (!files.length) {
      return
    }
    void loadFromSource({ kind: 'file', files }, files[0]?.name ?? '本地文件')
    ui.fileInput.value = ''
  })

  ui.urlLoad.addEventListener('click', () => {
    const url = ui.urlInput.value.trim()
    if (!url) {
      return
    }
    void loadFromSource({ kind: 'url', url }, url)
  })

  ui.urlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      ui.urlLoad.click()
    }
  })

  const setDragActive = (active: boolean): void => {
    ui.dropZone.dataset.active = String(active)
    ui.viewport.dataset.drag = String(active)
  }

  const handleDrop = (event: DragEvent): void => {
    event.preventDefault()
    setDragActive(false)
    const dataTransfer = event.dataTransfer
    if (!dataTransfer) {
      return
    }
    void collectFilesFromDataTransfer(dataTransfer).then((files) => {
      if (!files.length) {
        return
      }
      const label = files.length > 1 ? `${files[0]?.name ?? '模型'} 等 ${files.length} 个文件` : files[0]?.name ?? '模型'
      void loadFromSource({ kind: 'file', files }, label)
    })
  }

  for (const zone of [ui.dropZone, ui.viewport]) {
    zone.addEventListener('dragover', (event) => {
      event.preventDefault()
      setDragActive(true)
    })
    zone.addEventListener('dragleave', () => setDragActive(false))
    zone.addEventListener('drop', handleDrop)
  }

  ui.pipelineSwitch.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button[data-mode]') as HTMLButtonElement | null
    if (!button) {
      return
    }
    const mode = button.dataset.mode as PipelineMode
    if (mode === pipeline) {
      return
    }
    pipeline = mode
    for (const element of ui.pipelineSwitch.querySelectorAll('button')) {
      element.classList.toggle('active', element === button)
    }
    stage.setLayout({ split, mode: pipeline })
    ensurePaneLoaded(mode)
    refreshChrome()
    renderInspector()
  })

  ui.splitToggle.addEventListener('change', () => {
    split = ui.splitToggle.checked
    stage.setLayout({ split, mode: pipeline })
    if (split) {
      ensurePaneLoaded('engine')
      ensurePaneLoaded('native')
    }
    refreshChrome()
  })

  for (const [input, key] of [
    [ui.postRecenter, 'recenter'],
    [ui.postFrontSide, 'forceFrontSide'],
    [ui.postScatter, 'scatterCutout'],
  ] as Array<[HTMLInputElement, keyof EnginePostProcessOptions]>) {
    input.addEventListener('change', () => {
      postProcess = { ...postProcess, [key]: input.checked }
      reloadEnginePane()
    })
  }

  for (const input of [
    ui.ambientColor,
    ui.ambientIntensity,
    ui.sunColor,
    ui.sunIntensity,
    ui.sunAzimuth,
    ui.sunElevation,
    ui.shadowToggle,
    ui.backgroundMode,
    ui.backgroundColor,
    ui.gradientTopColor,
    ui.environmentIntensity,
    ui.exposure,
    ui.toneMapping,
  ]) {
    input.addEventListener('input', () => applyStageSettingsFromUi())
    input.addEventListener('change', () => applyStageSettingsFromUi())
  }

  ui.hdrInput.addEventListener('change', () => {
    const file = ui.hdrInput.files?.[0]
    if (file) {
      void loadEnvironmentFile(file)
    }
  })

  ui.displayMode.addEventListener('change', () => {
    displayMode = ui.displayMode.value as DisplayMode
    applyMaterialStateToPanes()
  })

  for (const input of [
    ui.overrideSide,
    ui.overrideTransparent,
    ui.overrideAlphaTest,
    ui.overrideFlatShading,
    ui.overrideDepthWrite,
    ui.overrideToneMapped,
    ui.overrideMetalness,
    ui.overrideRoughness,
  ]) {
    input.addEventListener('input', () => {
      readOverridesFromUi()
      scheduleMaterialStateUpdate()
    })
    input.addEventListener('change', () => {
      readOverridesFromUi()
      applyMaterialStateToPanes()
    })
  }

  ui.overrideReset.addEventListener('click', () => {
    overrides = { ...DEFAULT_MATERIAL_OVERRIDES }
    displayMode = 'original'
    ui.displayMode.value = 'original'
    ui.overrideSide.value = 'keep'
    ui.overrideTransparent.value = 'keep'
    ui.overrideAlphaTest.value = ''
    ui.overrideFlatShading.value = 'keep'
    ui.overrideDepthWrite.value = 'keep'
    ui.overrideToneMapped.value = 'keep'
    ui.overrideMetalness.value = ''
    ui.overrideRoughness.value = ''
    applyMaterialStateToPanes()
  })

  for (const [input, key] of [
    [ui.helperGrid, 'grid'],
    [ui.helperAxes, 'axes'],
    [ui.helperBounds, 'bounds'],
    [ui.helperSkeleton, 'skeleton'],
  ] as Array<[HTMLInputElement, keyof HelperSettings]>) {
    input.addEventListener('change', () => {
      helpers = { ...helpers, [key]: input.checked }
      stage.setHelpers(helpers)
      stage.setSelectionByIndex(helpers.bounds ? selectedNodeIndex : null)
      applyStageSettingsFromUi()
    })
  }

  ui.viewButtons.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button[data-view]') as HTMLButtonElement | null
    if (!button) {
      return
    }
    const view = button.dataset.view as CameraViewId | 'fit'
    if (view === 'fit') {
      stage.fit()
      return
    }
    stage.setView(view)
  })

  ui.inspectorTabs.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button[data-tab]') as HTMLButtonElement | null
    if (!button) {
      return
    }
    activeTab = button.dataset.tab as InspectorTab
    for (const element of ui.inspectorTabs.querySelectorAll('button')) {
      element.classList.toggle('active', element === button)
    }
    renderInspector()
  })

  ui.inspectorBody.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const frameButton = target.closest('button[data-node-frame]') as HTMLButtonElement | null
    if (frameButton) {
      frameNode(Number(frameButton.dataset.nodeFrame))
      return
    }
    if (target.id === 'animation-toggle') {
      playback.playing = !playback.playing
      for (const mode of PIPELINE_MODES) {
        const action = actions[mode]
        if (action) {
          action.paused = !playback.playing
        }
      }
      renderInspector()
    }
  })

  ui.inspectorBody.addEventListener('change', (event) => {
    const target = event.target as HTMLElement
    if (target.matches('input[data-node-visible]')) {
      const input = target as HTMLInputElement
      setNodeVisibility(Number(input.dataset.nodeVisible), input.checked)
      const pane = activePane()
      if (pane.model) {
        pane.inspection = inspectScene(pane.model.root, pane.model.animations)
        renderBadges()
      }
      return
    }
    if (target.id === 'animation-clip') {
      playback.index = Number((target as HTMLSelectElement).value)
      playback.time = 0
      for (const mode of PIPELINE_MODES) {
        applyAnimationClip(mode)
      }
      renderInspector()
    }
  })

  ui.inspectorBody.addEventListener('input', (event) => {
    const target = event.target as HTMLElement
    if (target.id === 'animation-time') {
      playback.time = Number((target as HTMLInputElement).value)
      for (const mode of PIPELINE_MODES) {
        const action = actions[mode]
        const mixer = mixers[mode]
        if (action && mixer) {
          action.time = playback.time
          mixer.update(0)
        }
      }
      const label = ui.inspectorBody.querySelector('#animation-time-label')
      if (label) {
        label.textContent = `${playback.time.toFixed(2)}s`
      }
      return
    }
    if (target.id === 'animation-speed') {
      playback.speed = Math.max(0.05, readNumber(target as HTMLInputElement, 1))
      for (const mode of PIPELINE_MODES) {
        const action = actions[mode]
        if (action) {
          action.timeScale = playback.speed
        }
      }
    }
  })

  ui.exportScreenshot.addEventListener('click', () => {
    downloadDataUrl(buildScreenshotFileName(activePane().model), stage.capture())
  })

  ui.exportReport.addEventListener('click', () => {
    const report = currentReport()
    downloadJson(buildReportFileName(activePane().model), report)
  })

  ui.copyReport.addEventListener('click', () => {
    void copyReportToClipboard(currentReport()).then(
      () => {
        ui.exportHint.textContent = '检查报告已复制到剪贴板。'
      },
      (error: unknown) => {
        ui.exportHint.textContent = `复制失败：${error instanceof Error ? error.message : String(error)}`
      },
    )
  })

  ui.exportGlb.addEventListener('click', () => {
    const pane = activePane()
    const model = pane.model
    if (!model) {
      return
    }
    ui.exportHint.textContent = '正在导出规范化 GLB…'
    restoreOriginalMaterials(model.root)
    void exportNormalizedGlb(model.root, model.animations, buildGlbFileName(model)).then(
      () => {
        applyMaterialState(model.root, displayMode, overrides)
        ui.exportHint.textContent = '已导出 GLB。注意：KTX2 转码贴图与引擎注入的调试材质可能无法完整回写。'
      },
      (error: unknown) => {
        applyMaterialState(model.root, displayMode, overrides)
        ui.exportHint.textContent = `导出失败：${error instanceof Error ? error.message : String(error)}`
      },
    )
  })

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
      return
    }
    const views: Record<string, CameraViewId> = {
      '1': 'iso',
      '2': 'front',
      '3': 'back',
      '4': 'left',
      '5': 'right',
      '6': 'top',
      '7': 'bottom',
    }
    const view = views[event.key]
    if (view) {
      stage.setView(view)
      return
    }
    if (event.key === 'r' || event.key === 'R') {
      stage.fit()
    }
  })
}

function startStatusTicker(): void {
  window.setInterval(() => {
    const stats = stage.getFrameStats()
    ui.statFps.textContent = `${stats.fps.toFixed(0)} FPS`
    ui.statDraw.textContent = `draw calls ${stats.drawCalls}`
    ui.statTriangles.textContent = `三角面 ${stats.triangles.toLocaleString('en-US')}`
    ui.statTextures.textContent = `纹理 ${stats.textures}`
    const pane = activePane()
    const bounds = pane.inspection?.bounds
    ui.statSize.textContent = bounds
      ? `尺寸 ${bounds.size[0]} × ${bounds.size[2]} × ${bounds.size[1]}`
      : '尺寸 —'
    ui.statParse.textContent = `解析 ${pane.model?.parsePath ?? '—'}`

    const action = actions[pipeline]
    if (action && playback.playing) {
      playback.time = action.time
      const slider = ui.inspectorBody.querySelector<HTMLInputElement>('#animation-time')
      const label = ui.inspectorBody.querySelector('#animation-time-label')
      if (slider) {
        slider.value = String(action.time)
      }
      if (label) {
        label.textContent = `${action.time.toFixed(2)}s`
      }
    }
  }, 500)
}

stage.onFrame((delta) => {
  for (const mode of PIPELINE_MODES) {
    const mixer = mixers[mode]
    if (mixer && playback.playing) {
      mixer.update(delta)
    }
  }
})

function bootstrap(): void {
  syncUiFromSettings()
  applyStageSettingsFromUi()
  stage.setHelpers(helpers)
  stage.setLayout({ split, mode: pipeline })
  wireEvents()
  refreshChrome()
  renderInspector()
  startStatusTicker()
}

bootstrap()
