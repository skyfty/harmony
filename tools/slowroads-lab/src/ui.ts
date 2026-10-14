import { SEASON_IDS, SEASON_LABELS, type SeasonId } from './core/seasonCatalog'
import {
  TIME_OF_DAY_LABELS,
  TIME_OF_DAY_ORDER,
  WEATHER_LABELS,
  WEATHER_ORDER,
  type TimeOfDay,
  type Weather,
} from './core/environment'
import type { AssetSourceMode } from './lab/assetSource'

export interface LabSettings {
  seed: number
  season: SeasonId
  timeOfDay: TimeOfDay
  weather: Weather
  /** 兼容模式：纹理按 MAX_TEXTURE_SIZE 回退 @2048 变体 + 缩减地形材质。 */
  compatMode: boolean
  assetSource: AssetSourceMode
  serverBaseUrl: string
  showSurface: boolean
  showTextures: boolean
  showRoad: boolean
  showCanopy: boolean
  showGrass: boolean
  showBushes: boolean
  showTrees: boolean
  showNearTreeMeshes: boolean
  showWater: boolean
  showBarrier: boolean
  showSky: boolean
  showClouds: boolean
  showStars: boolean
  showSnow: boolean
  windEnabled: boolean
  treeDensity: number
  treeSize: number
  grassCorridor: number
  grassDensity: number
  bushDensity: number
  flowerDensity: number
  tallGrassDensity: number
  barrierDensity: number
  windStrength: number
  roadWidth: number
  flattenBand: number
  nearDistance: number
  nearTreeRadius: number
  cruiseSpeed: number
}

export const DEFAULT_LAB_SETTINGS: LabSettings = {
  seed: (Math.random() * 0xffffffff) >>> 0,
  season: 'spring',
  timeOfDay: 'day',
  weather: 'clear',
  compatMode: false,
  assetSource: 'local',
  serverBaseUrl: 'http://localhost:8097',
  showSurface: true,
  showTextures: true,
  showRoad: true,
  showCanopy: true,
  showGrass: true,
  showBushes: true,
  showTrees: true,
  showNearTreeMeshes: true,
  showWater: true,
  showBarrier: true,
  showSky: true,
  showClouds: true,
  showStars: true,
  showSnow: true,
  windEnabled: true,
  treeDensity: 1,
  treeSize: 1,
  grassCorridor: 20,
  grassDensity: 1,
  bushDensity: 0.6,
  flowerDensity: 1,
  tallGrassDensity: 1,
  barrierDensity: 0.65,
  windStrength: 1,
  roadWidth: 7,
  flattenBand: 10,
  // 官方 graphics preset（view distance = medium）的近树卡 dissolveFar = lod1Horizon(19) × 10。
  nearDistance: 190,
  nearTreeRadius: 90,
  cruiseSpeed: 14,
}

export type LabChangeKind = 'uniform' | 'placements' | 'world'

export interface LabUiCallbacks {
  onChange(kind: LabChangeKind, key: keyof LabSettings): void
  onSeasonChange(season: SeasonId): void
  onEnvironmentChange(): void
  onCompatModeChange(enabled: boolean): void
  onAssetSourceChange(mode: AssetSourceMode, baseUrl: string): void
  onRandomizeSeed(): void
  onRegenerate(): void
  onToggleCruise(): void
  onResetCamera(): void
}

export interface LabUiHandle {
  sync(): void
  setCruiseActive(active: boolean): void
  setSeasonActive(season: SeasonId): void
  setTimeOfDayActive(timeOfDay: TimeOfDay): void
  setWeatherActive(weather: Weather): void
  setSeasonLoading(season: SeasonId | null): void
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className) {
    element.className = className
  }
  if (text !== undefined) {
    element.textContent = text
  }
  return element
}

export function createLabUi(
  container: HTMLElement,
  settings: LabSettings,
  callbacks: LabUiCallbacks,
): LabUiHandle {
  container.replaceChildren()
  container.append(createElement('h2', undefined, 'Slow Roads Lab'))

  // ---- Seasons --------------------------------------------------------------
  container.append(createElement('h3', undefined, '季节'))
  const seasonRow = createElement('div', 'panel__row panel__seasons')
  const seasonButtons = new Map<SeasonId, HTMLButtonElement>()
  for (const season of SEASON_IDS) {
    const button = createElement('button', undefined, SEASON_LABELS[season])
    button.addEventListener('click', () => callbacks.onSeasonChange(season))
    seasonRow.append(button)
    seasonButtons.set(season, button)
  }
  container.append(seasonRow)
  const setSeasonActive = (season: SeasonId): void => {
    for (const [id, button] of seasonButtons) {
      button.classList.toggle('is-active', id === season)
    }
  }
  const setSeasonLoading = (season: SeasonId | null): void => {
    for (const [id, button] of seasonButtons) {
      button.classList.toggle('is-loading', id === season)
      button.disabled = season !== null
    }
  }
  setSeasonActive(settings.season)

  // ---- Time of day / weather ------------------------------------------------
  container.append(createElement('h3', undefined, '时间 · 天气'))
  const timeRow = createElement('div', 'panel__row panel__seasons')
  const timeButtons = new Map<TimeOfDay, HTMLButtonElement>()
  for (const time of TIME_OF_DAY_ORDER) {
    const button = createElement('button', undefined, TIME_OF_DAY_LABELS[time])
    button.addEventListener('click', () => {
      settings.timeOfDay = time
      setTimeOfDayActive(time)
      callbacks.onEnvironmentChange()
    })
    timeRow.append(button)
    timeButtons.set(time, button)
  }
  container.append(timeRow)
  const weatherRow = createElement('div', 'panel__row panel__seasons')
  const weatherButtons = new Map<Weather, HTMLButtonElement>()
  for (const weather of WEATHER_ORDER) {
    const button = createElement('button', undefined, WEATHER_LABELS[weather])
    button.addEventListener('click', () => {
      settings.weather = weather
      setWeatherActive(weather)
      callbacks.onEnvironmentChange()
    })
    weatherRow.append(button)
    weatherButtons.set(weather, button)
  }
  container.append(weatherRow)
  const setTimeOfDayActive = (time: TimeOfDay): void => {
    for (const [id, button] of timeButtons) {
      button.classList.toggle('is-active', id === time)
    }
  }
  const setWeatherActive = (weather: Weather): void => {
    for (const [id, button] of weatherButtons) {
      button.classList.toggle('is-active', id === weather)
    }
  }
  setTimeOfDayActive(settings.timeOfDay)
  setWeatherActive(settings.weather)

  // ---- Compatibility / asset source -----------------------------------------
  container.append(createElement('h3', undefined, '运行环境'))
  const compatLabel = createElement('label')
  const compatInput = createElement('input')
  compatInput.type = 'checkbox'
  compatInput.checked = settings.compatMode
  compatInput.addEventListener('change', () => {
    settings.compatMode = compatInput.checked
    callbacks.onCompatModeChange(compatInput.checked)
  })
  compatLabel.append(compatInput, document.createTextNode('兼容模式（2048 贴图上限 + 缩减材质）'))
  container.append(compatLabel)

  const sourceRow = createElement('div', 'panel__row')
  const sourceSelect = createElement('select')
  for (const [value, label] of [['local', '本地素材'], ['server', '服务器下载']] as const) {
    const option = createElement('option', undefined, label)
    option.value = value
    option.selected = settings.assetSource === value
    sourceSelect.append(option)
  }
  const serverInput = createElement('input')
  serverInput.type = 'text'
  serverInput.value = settings.serverBaseUrl
  const applySource = (): void => {
    callbacks.onAssetSourceChange(sourceSelect.value as AssetSourceMode, serverInput.value.trim())
  }
  sourceSelect.addEventListener('change', applySource)
  serverInput.addEventListener('change', applySource)
  sourceRow.append(createElement('label', undefined, '素材来源'), sourceSelect, serverInput)
  container.append(sourceRow)

  // ---- Layer toggles --------------------------------------------------------
  const toggleSection = createElement('div', 'panel__toggles')
  const toggleDefs: Array<{ key: keyof LabSettings; label: string }> = [
    { key: 'showSurface', label: '地表混合' },
    { key: 'showTextures', label: '地表贴图' },
    { key: 'showRoad', label: '道路' },
    { key: 'showCanopy', label: '树冠色斑' },
    { key: 'showGrass', label: '草' },
    { key: 'showBushes', label: '灌木花草' },
    { key: 'showTrees', label: '树卡/远景树' },
    { key: 'showNearTreeMeshes', label: '近树 3D 网格' },
    { key: 'showWater', label: '水面' },
    { key: 'showBarrier', label: '护栏' },
    { key: 'showSky', label: '天空' },
    { key: 'showClouds', label: '云层' },
    { key: 'showStars', label: '星空' },
    { key: 'showSnow', label: '降雪' },
    { key: 'windEnabled', label: '风摆' },
  ]
  const toggleInputs = new Map<keyof LabSettings, HTMLInputElement>()
  for (const def of toggleDefs) {
    const label = createElement('label')
    const input = createElement('input')
    input.type = 'checkbox'
    input.checked = Boolean(settings[def.key])
    input.addEventListener('change', () => {
      ;(settings[def.key] as boolean) = input.checked
      callbacks.onChange('uniform', def.key)
    })
    label.append(input, document.createTextNode(def.label))
    toggleSection.append(label)
    toggleInputs.set(def.key, input)
  }
  container.append(toggleSection)

  // ---- World ---------------------------------------------------------------
  container.append(createElement('h3', undefined, '世界'))
  const seedRow = createElement('div', 'panel__row')
  const seedInput = createElement('input')
  seedInput.type = 'text'
  seedInput.value = String(settings.seed)
  const applySeedInput = (): void => {
    const parsed = Number.parseInt(seedInput.value, 10)
    settings.seed = Number.isFinite(parsed) ? parsed >>> 0 : settings.seed
    seedInput.value = String(settings.seed)
    callbacks.onChange('world', 'seed')
  }
  seedInput.addEventListener('change', applySeedInput)
  // 回车立即生效（change 只在失焦时触发，容易造成“输入框显示新种子、场景还是旧的”）。
  seedInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      applySeedInput()
    }
  })
  const randomizeButton = createElement('button', undefined, '随机')
  randomizeButton.addEventListener('click', () => {
    callbacks.onRandomizeSeed()
    seedInput.value = String(settings.seed)
  })
  const regenerateButton = createElement('button', undefined, '重新生成')
  regenerateButton.addEventListener('click', () => callbacks.onRegenerate())
  seedRow.append(createElement('label', undefined, '种子'), seedInput, randomizeButton, regenerateButton)
  container.append(seedRow)

  // ---- Sliders -------------------------------------------------------------
  interface SliderDef {
    key: keyof LabSettings
    label: string
    min: number
    max: number
    step: number
    kind: LabChangeKind
  }

  const sliderDefs: Array<{ title: string; items: SliderDef[] }> = [
    {
      title: '植被',
      items: [
        { key: 'treeDensity', label: '树密度', min: 0, max: 2, step: 0.05, kind: 'placements' },
        { key: 'treeSize', label: '树尺寸', min: 0.6, max: 1.6, step: 0.05, kind: 'placements' },
        { key: 'grassCorridor', label: '草走廊 (m)', min: 5, max: 40, step: 1, kind: 'placements' },
        { key: 'grassDensity', label: '草密度', min: 0, max: 2, step: 0.05, kind: 'placements' },
        { key: 'bushDensity', label: '灌木密度', min: 0, max: 1, step: 0.05, kind: 'placements' },
        { key: 'flowerDensity', label: '花草密度', min: 0, max: 2, step: 0.05, kind: 'placements' },
        { key: 'tallGrassDensity', label: '高草密度', min: 0, max: 2, step: 0.05, kind: 'placements' },
        { key: 'windStrength', label: '风强度', min: 0, max: 1, step: 0.05, kind: 'uniform' },
      ],
    },
    {
      title: '道路',
      items: [
        { key: 'roadWidth', label: '道路宽 (m)', min: 4, max: 12, step: 0.5, kind: 'world' },
        { key: 'flattenBand', label: '压平带 (m)', min: 4, max: 20, step: 1, kind: 'world' },
        { key: 'barrierDensity', label: '护栏密度', min: 0, max: 1, step: 0.05, kind: 'placements' },
      ],
    },
    {
      title: '相机',
      items: [
        { key: 'nearDistance', label: '近树卡距离 (m)', min: 40, max: 300, step: 5, kind: 'uniform' },
        { key: 'nearTreeRadius', label: '近树 3D 半径 (m)', min: 0, max: 300, step: 10, kind: 'uniform' },
        { key: 'cruiseSpeed', label: '巡航速度', min: 0, max: 30, step: 1, kind: 'uniform' },
      ],
    },
  ]

  const sliderInputs = new Map<keyof LabSettings, HTMLInputElement>()
  const sliderValues = new Map<keyof LabSettings, HTMLSpanElement>()
  for (const group of sliderDefs) {
    container.append(createElement('h3', undefined, group.title))
    for (const def of group.items) {
      const row = createElement('div', 'panel__row')
      const input = createElement('input')
      input.type = 'range'
      input.min = String(def.min)
      input.max = String(def.max)
      input.step = String(def.step)
      input.value = String(settings[def.key])
      const valueLabel = createElement('span', 'value', String(settings[def.key]))
      input.addEventListener('input', () => {
        ;(settings[def.key] as number) = Number(input.value)
        valueLabel.textContent = input.value
        if (def.kind !== 'world') {
          callbacks.onChange(def.kind, def.key)
        }
      })
      if (def.kind === 'world') {
        input.addEventListener('change', () => callbacks.onChange('world', def.key))
      }
      row.append(createElement('label', undefined, def.label), input, valueLabel)
      container.append(row)
      sliderInputs.set(def.key, input)
      sliderValues.set(def.key, valueLabel)
    }
  }

  // ---- Camera buttons ------------------------------------------------------
  const cameraRow = createElement('div', 'panel__row')
  const cruiseButton = createElement('button', undefined, '巡航')
  cruiseButton.addEventListener('click', () => callbacks.onToggleCruise())
  const resetButton = createElement('button', undefined, '重置视角')
  resetButton.addEventListener('click', () => callbacks.onResetCamera())
  cameraRow.append(cruiseButton, resetButton)
  container.append(cameraRow)

  container.append(createElement(
    'p',
    'panel__hint',
    '自由相机：拖拽旋转，WASD 移动，Q/E 升降，Shift 加速。四季素材来自 slowroads.io，'
    + '按官方逻辑渲染（地表调色板、落叶 overlay、冬季积雪/冻水、近树三级 LOD）。'
    + '兼容模式用于小程序低配验证（@2048 贴图 + 缩减采样器）。',
  ))

  return {
    sync(): void {
      seedInput.value = String(settings.seed)
      for (const def of toggleDefs) {
        toggleInputs.get(def.key)!.checked = Boolean(settings[def.key])
      }
      for (const group of sliderDefs) {
        for (const def of group.items) {
          const value = settings[def.key]
          sliderInputs.get(def.key)!.value = String(value)
          sliderValues.get(def.key)!.textContent = String(value)
        }
      }
      compatInput.checked = settings.compatMode
      sourceSelect.value = settings.assetSource
      serverInput.value = settings.serverBaseUrl
      setSeasonActive(settings.season)
      setTimeOfDayActive(settings.timeOfDay)
      setWeatherActive(settings.weather)
    },
    setCruiseActive(active: boolean): void {
      cruiseButton.classList.toggle('is-active', active)
    },
    setSeasonActive,
    setTimeOfDayActive,
    setWeatherActive,
    setSeasonLoading,
  }
}
