import * as THREE from 'three'
import type { SlowroadsEnvironmentSettings } from '../../core'
import {
  ENVIRONMENT_CLOUD_ALTITUDE,
  ENVIRONMENT_SKY_DISTANCE,
  ENVIRONMENT_VIEW_DISTANCE,
  resolveEnvironmentPreset,
  resolveFogParams,
  resolveSkyFogParams,
  type EnvironmentPreset,
  type ResolvedFogParams,
} from '../core/environment'
import { SEASON_PARAMS } from '../core/seasonParams'
import { SHARED_TEXTURES } from '../core/seasonCatalog'
import type { SlowroadsAssetStore } from '../assets/assetStore'
import {
  applySkyFogParams,
  refreshSlowroadsFogMaterials,
  resolveFogUniformColorSpace,
  resolveHazeForCamera,
  setSlowroadsFogDisplaySpaceMode,
  setSlowroadsSkyDepthCorrection,
  setSlowroadsFogParams,
  slowroadsFogUniforms,
  writeFogUniformColors,
  type SlowroadsFogColorSet,
  type SlowroadsHazeState,
} from './fogInjection'
import { createSlowroadsSky, resolveSkyPlaneScale, type SlowroadsSkyHandle } from './sky'
import { createSlowroadsClouds, type SlowroadsCloudsHandle } from './clouds'
import { createSlowroadsStars, resolveStarSize, type SlowroadsStarsHandle } from './stars'
import { createSlowroadsSnow, type SlowroadsSnowHandle } from './snow'
import {
  reportSlowroadsSelfChecks,
  runSlowroadsEnvironmentChecks,
  runSlowroadsFogColorSpaceChecks,
  runSlowroadsFogUniformChecks,
  runSlowroadsHazeInterpolationChecks,
} from './selfCheck'
import { slowroadsSkyFogUniforms } from './fogInjection'
import { SLOWROADS_SKY_COLOR } from '../core/environment'

/**
 * 场景级 Slow Roads 环境运行时（editor / preview / viewer 三端共用）。
 *
 * - 光照：与官方 `updateSky()` 一致的三件套（颜色/强度直接取预设）：
 *   `sun = DirectionalLight(预设 sun 色, 预设 sun 强度)`、
 *   `ambient = AmbientLight(预设 ambient 色, 预设 ambient 强度)`、
 *   `hemisphere = HemisphereLight(sky = 预设 sun 色, ground = 黑, 强度 = 预设
 *   ambient 强度)`；太阳方向固定竖直向下（官方锚定载具上方 10m 的等价物，
 *   三端 CSM `syncSun((0,1000,0))`），曝光缩放统一乘在三盏灯上。
 *   阴影开关只控制投影（castShadow），不再关灯。
 * - 雾：写入共享三色雾 uniform（场景唯一雾；`scene.fog` 恒为 null）。
 *   两套尺度（第五批）：地形/植被/道路/水面/降雪走「场景组」(1000)，
 *   天空/云层/星空走「天空组」(官方 n1 = 2000)；每帧对两套各跑一次官方
 *   haze 插值。
 * - 雾色色空间（第四批）：按官方 `refreshFogUniforms` 换算到渲染输出色空间；
 *   编辑器视口经 EffectComposer（色调映射延后到 OutputPass）时，用
 *   `deferredToneMapping: true` 走反 Cineon 预补偿（见 fogInjection 注释）。
 * - 天空/云/星空/降雪：官方实现；材质来自在线资产包。
 * - 水面：proceduralLandscape 的 waterPlane 通过 `getSlowroadsWaterEnvironment()`
 *   读取本运行时发布的快照（预设水色 / 冻水 / 时间），不反向依赖。
 */

export interface SlowroadsLightingState {
  sunColor: THREE.Color
  sunIntensity: number
  ambientColor: THREE.Color
  ambientIntensity: number
  /** 半球光：官方 skyColor = 预设 sun 色、groundColor = 黑、强度 = 预设 ambient 强度。 */
  hemiColor: THREE.Color
  hemiIntensity: number
}

/** 水面环境快照（lab `water.setEnvironment` / `setFrozen` / `setTime` 的合并形态）。 */
export interface SlowroadsWaterEnvironmentState {
  base: string
  body: string
  highlight: string
  fresnelFactor: number
  frozen: boolean
  /** 太阳高光：预设 sun 色 × 强度 × 曝光（lab 的 `sunOut`）。 */
  sunColor: THREE.Color
  timeSeconds: number
}

let waterEnvironment: SlowroadsWaterEnvironmentState | null = null

/**
 * 水面环境快照通道：环境运行时写入，proceduralLandscape 的 waterPlane 每帧读取。
 * 与 `setProceduralLandscapeEnvironment` 相同，假设同一 JS realm 只有一个活动世界。
 */
export function getSlowroadsWaterEnvironment(): SlowroadsWaterEnvironmentState | null {
  return waterEnvironment
}

let sceneViewDistanceScale = 1

/**
 * 场景雾/视距尺度倍率通道（proceduralLandscape 按地形水平尺寸下发）。
 * 官方雾尺度按 1000m 世界调参（lab 1600m 世界刚好被包住）；编辑器地形可达数十
 * 公里，直接套官方尺度会让 1km 以外整片地形变成雾色。1 = 与官方/lab 逐字一致。
 * 天空组 / 云层 / 天空平面距离同步乘该倍率（保持 sky = 2 × scene 的官方不变量）。
 */
export function setSlowroadsSceneViewDistanceScale(scale: number): void {
  sceneViewDistanceScale = Number.isFinite(scale) ? Math.min(12, Math.max(1, scale)) : 1
}

export function getSlowroadsSceneViewDistanceScale(): number {
  return sceneViewDistanceScale
}

export interface SlowroadsEnvironmentRuntimeOptions {
  scene: THREE.Scene
  camera: THREE.Camera
  /** 解析雾色 uniform 的输出色空间（官方 `Bs(renderer)`）。 */
  renderer: THREE.WebGLRenderer
  /**
   * 预设光照下发：宿主把它应用到自己的 CSM 太阳灯与 ambient/hemisphere 灯。
   * 颜色实例复用，宿主应当 copy 而非保存引用。
   */
  applyLighting?: (state: SlowroadsLightingState) => void
  assetStore: SlowroadsAssetStore
  /**
   * 场景经后处理 render target 出图（色调映射/编码延后到 OutputPass）：
   * 雾色按反 Cineon 预补偿。编辑器视口传 true；preview / viewer 直出画布不传。
   */
  deferredToneMapping?: boolean
  /**
   * 星点目标屏幕直径（物理像素）。星点世界尺寸按视口高度反解（见 `resolveStarSize`）：
   * 官方 0.01 在 dpr=1、高度 800 上下只有约 0.4 物理像素，且编辑器 FXAA 还会把
   * 亚像素亮点抹平。宿主可传略大的目标值补偿 FXAA（编辑器视口用 1.6，
   * 无 FXAA 的 preview / viewer / lab 保持 1.0 = 官方"约 1 物理像素"的原始意图）。
   */
  starSizeTargetPixels?: number
}

export interface SlowroadsEnvironmentRuntime {
  setSettings(settings: SlowroadsEnvironmentSettings): void
  /** CSM 太阳灯被外部重建/同步（如阴影配置变化）后，重新下发一次预设光照。 */
  refreshLighting(): void
  /** 运行期调整星点目标屏幕直径（物理像素，FXAA 开关切换时用）。 */
  setStarSizeTargetPixels(targetPixels: number): void
  update(deltaSeconds: number): void
  readonly activePreset: EnvironmentPreset
  /** 场景组（地形/植被/道路/水面）当前生效的雾参数（haze 插值后）。 */
  readonly activeFog: ResolvedFogParams
  /** 天空组（天空/云层/星空）当前生效的雾参数（官方 n1 = 2000 尺度）。 */
  readonly skyFog: ResolvedFogParams
  dispose(): void
}

export function createSlowroadsEnvironmentRuntime(
  options: SlowroadsEnvironmentRuntimeOptions,
): SlowroadsEnvironmentRuntime {
  const scene = options.scene
  const camera = options.camera
  const renderer = options.renderer
  const deferredToneMapping = options.deferredToneMapping === true
  // SR 雾是场景唯一雾：标准雾彻底置空（旧场景雾设置停用，已接受的迁移决策）。
  scene.fog = null
  /**
   * 编辑器延后色调映射管线：片元体改用「显示空间等价注入」（暴露在外的 gl_FragColor
   * 是线性域，混色前先换算到显示空间、尾体再换回）；uniform 因此与 lab 一样直接
   * 下发 sRGB 显示分量。必须在任何 SR 材质首次渲染前设置并刷新已注册材质。
   */
  /**
   * 显示空间等价注入要求 OutputPass 恰好是 three 的 Cineon（尾体反的就是它）。
   * 其它色调映射（或未开启）退回旧行为：直出画布按输出色空间分量、线性域混色。
   */
  const displaySpaceFog = deferredToneMapping && renderer.toneMapping === THREE.CineonToneMapping
  setSlowroadsFogDisplaySpaceMode(displaySpaceFog)
  refreshSlowroadsFogMaterials()
  /**
   * 官方/lab 的渲染器 clear color 与 scene.background 都是固定天空色
   * `SLOWROADS_SKY_COLOR`（天空平面覆盖到 87.7°，其外的天顶锥角露出的就是这个底色；
   * 编辑器默认背景 0x516175 会露成一块深蓝）。环境运行时接管背景并在销毁时还原。
   */
  const previousBackground = scene.background
  scene.background = new THREE.Color(SLOWROADS_SKY_COLOR)

  const sky: SlowroadsSkyHandle = createSlowroadsSky()
  const clouds: SlowroadsCloudsHandle = createSlowroadsClouds(getPlaceholderTexture())
  const stars: SlowroadsStarsHandle = createSlowroadsStars()
  const snow: SlowroadsSnowHandle = createSlowroadsSnow(null)

  camera.add(sky.mesh)
  scene.add(clouds.mesh, stars.container, snow.container)

  const sceneHazeState: SlowroadsHazeState = { inHaze: false }
  const skyHazeState: SlowroadsHazeState = { inHaze: false }
  /** 工作色空间（官方 `fog.colorA/B/C`）。 */
  const fogColors: SlowroadsFogColorSet = {
    colA: new THREE.Color(1, 1, 1),
    colB: new THREE.Color(1, 1, 1),
    colC: new THREE.Color(1, 1, 1),
  }
  /** 实际下发到 shader 的雾色（输出色空间分量，或编辑器管线下的反 Cineon 预补偿值）。 */
  const fogUniformColors: SlowroadsFogColorSet = {
    colA: new THREE.Color(1, 1, 1),
    colB: new THREE.Color(1, 1, 1),
    colC: new THREE.Color(1, 1, 1),
  }
  const sunColorScratch = new THREE.Color()
  const sunOut = new THREE.Color()
  const forwardScratch = new THREE.Vector3()
  const drawingBufferSize = new THREE.Vector2()
  let lastStarSize = Number.NaN
  let starSizeTargetPixels = Number.isFinite(options.starSizeTargetPixels) && (options.starSizeTargetPixels as number) > 0
    ? (options.starSizeTargetPixels as number)
    : 1.0

  let settings: SlowroadsEnvironmentSettings | null = null
  let preset: EnvironmentPreset = resolveEnvironmentPreset({ season: 'spring', timeOfDay: 'day', weather: 'clear' })
  let baseFog: ResolvedFogParams = resolveFogParams(preset)
  let skyBaseFog: ResolvedFogParams = resolveSkyFogParams(preset)
  let lastFog: ResolvedFogParams | null = null
  let lastSkyFog: ResolvedFogParams | null = null
  let lastViewDistanceScale = Number.NaN
  /** 最近一次生效的天空平面距离（相机远裁剪面约束后的实际值）。 */
  let appliedSkyPlaneDistance = ENVIRONMENT_SKY_DISTANCE
  /** 最近一次生效的天空平面覆盖距离（= 官方 n1 × 视距倍率）。 */
  let appliedSkyCoverageDistance = ENVIRONMENT_SKY_DISTANCE
  let lastSkyCameraFar = Number.NaN
  let colorsDirty = true
  let elapsedSeconds = 0
  let disposed = false
  let textureToken = 0
  let selfChecksDone = false

  const lightingState: SlowroadsLightingState = {
    sunColor: new THREE.Color('#ffffff'),
    sunIntensity: 3,
    ambientColor: new THREE.Color('#ffffff'),
    ambientIntensity: 1,
    hemiColor: new THREE.Color('#ffffff'),
    hemiIntensity: 1,
  }
  const waterState: SlowroadsWaterEnvironmentState = {
    base: '#24292D',
    body: '#607A8A',
    highlight: '#8EAFD2',
    fresnelFactor: 1,
    frozen: false,
    sunColor: new THREE.Color('#ffffff'),
    timeSeconds: 0,
  }
  waterEnvironment = waterState

  applyPreset(preset, null)

  function applyLights(next: EnvironmentPreset, nextSettings: SlowroadsEnvironmentSettings | null): void {
    if (!options.applyLighting) {
      return
    }
    const exposure = nextSettings?.exposureScale ?? 1
    lightingState.sunColor.copy(sunColorScratch.set(next.lights.sun.col))
    lightingState.sunIntensity = next.lights.sun.intensity * exposure
    lightingState.ambientColor.set(next.lights.ambient.col)
    lightingState.ambientIntensity = next.lights.ambient.intensity * exposure
    lightingState.hemiColor.copy(sunColorScratch.set(next.lights.sun.col))
    lightingState.hemiIntensity = next.lights.ambient.intensity * exposure
    options.applyLighting(lightingState)
    // 水面太阳高光取同一套（lab：sunColor = 预设色 × 强度 × 曝光、方向竖直向下）。
    sunOut.set(next.lights.sun.col).multiplyScalar(next.lights.sun.intensity * exposure)
    waterState.sunColor.copy(sunOut)
  }

  /**
   * 换算一次雾色（状态变更时）：
   *  - 显示空间等价注入（编辑器 Cineon 延后管线）：下发 sRGB 显示分量——片元体
   *    自己负责显示空间换算与还原，与 lab 的 uniform 语义完全一致；
   *  - 其它延后色调映射：保持工作色空间分量（线性域混色，端点近似）；
   *  - 直出画布：按输出色空间分量（与 lab 逐字一致）。
   * 同时下发 OutputPass 曝光（尾体反变换需要与它一致）。
   */
  function refreshFogUniformColors(): void {
    if (!colorsDirty) {
      return
    }
    if (!deferredToneMapping) {
      writeFogUniformColors(fogColors, fogUniformColors, resolveFogUniformColorSpace(renderer))
    } else if (displaySpaceFog) {
      writeFogUniformColors(fogColors, fogUniformColors, THREE.SRGBColorSpace)
    } else {
      // 非 Cineon 的延后管线：保持工作色空间分量（不预补偿），线性域混色。
      fogUniformColors.colA.copy(fogColors.colA)
      fogUniformColors.colB.copy(fogColors.colB)
      fogUniformColors.colC.copy(fogColors.colC)
    }
    colorsDirty = false
  }

  /** OutputPass 曝光变化时同步给显示空间尾体（反变换必须与它一致）。 */
  function syncDisplaySpaceExposure(): void {
    const exposure = renderer.toneMappingExposure > 0 ? renderer.toneMappingExposure : 1
    if (slowroadsFogUniforms.srDisplayExposure.value !== exposure) {
      slowroadsFogUniforms.srDisplayExposure.value = exposure
    }
  }

  /**
   * 星点尺寸按视口（绘制缓冲）高度换算（见 `resolveStarSize`）：官方世界尺寸
   * 0.01 在 dpr=1、高度 800 上下的视口里只有约 0.4 物理像素，经 EffectComposer
   * 的 FXAA 后几乎不可见。只在尺寸变化时写入 material.size。
   */
  function syncStarSize(): void {
    renderer.getDrawingBufferSize(drawingBufferSize)
    const size = resolveStarSize(drawingBufferSize.y, renderer.getPixelRatio(), starSizeTargetPixels)
    if (size !== lastStarSize) {
      lastStarSize = size
      stars.setSize(size)
    }
  }

  function applyFog(params: ResolvedFogParams): void {
    const unchanged = !colorsDirty
      && lastFog !== null
      && lastFog.near === params.near
      && lastFog.far === params.far
      && lastFog.density === params.density
      && lastFog.hazeHeight === params.hazeHeight
      && lastFog.hazeIntensity === params.hazeIntensity
    if (unchanged) {
      return
    }
    refreshFogUniformColors()
    setSlowroadsFogParams(params, fogUniformColors)
    lastFog = params
  }

  function applySkyFog(params: ResolvedFogParams): void {
    const unchanged = !colorsDirty
      && lastSkyFog !== null
      && lastSkyFog.near === params.near
      && lastSkyFog.far === params.far
      && lastSkyFog.density === params.density
      && lastSkyFog.hazeHeight === params.hazeHeight
      && lastSkyFog.hazeIntensity === params.hazeIntensity
    if (unchanged) {
      return
    }
    refreshFogUniformColors()
    applySkyFogParams(params, fogUniformColors)
    lastSkyFog = params
  }

  /**
   * 天空组的雾密度必须取**场景组**密度（lab 等价语义）。
   *
   * lab 侧 three 的 `refreshFogUniforms` 对 `FogExp2` 只写 `fogDensity`，会把
   * `scene.fog.density`（场景尺度）覆盖进天空组；天空平面恰好挂在 2 × 场景 far 处，
   * 于是 `vFogDepth = 1 - exp(-(density · depth)²) = 1 - exp(-20)` 在 fp32 下饱和为
   * 精确的 1。这一点很关键：天空平面几何是 ±5e4，顶点 `vHaze = depth / fogFar`
   * 插值到屏幕中部 ≈ 250，若 `vFogDepth < 1`，`mix(color, fogColorC, vHaze)` 的巨值
   * 外推会按 `(1 - vFogDepth)` 泄漏进来，把天空压暗压蓝（schema 侧原用天空尺度密度
   * 0.001118 → vFogDepth = 0.9933 → 明显泄漏，lab 没有）。
   */
  function withSceneSkyDensity(params: ResolvedFogParams, sceneDensity: number): ResolvedFogParams {
    return { ...params, density: sceneDensity }
  }

  /**
   * 天空平面距离：官方 n1 = 2000 × 视距倍率。编辑器视口相机远裁剪面固定
   * （如 5000），雾尺度自适应放大后整个平面会被裁掉 —— 地平线处只剩渲染器
   * 背景色（"场景边缘一圈灰色"）。这里压进远裁剪面以内，并把
   * `skyDepthCorrection = 官方距离 / 实际距离` 交给天空顶点雾体，把雾深 / haze
   * 换算回官方距离（A/B 混色只依赖视线仰角，与平面距离无关）。
   */
  function resolveSkyPlaneDistance(official: number): number {
    const far = (camera as THREE.PerspectiveCamera).far
    if (!Number.isFinite(far) || far <= 1) {
      return official
    }
    return Math.max(200, Math.min(official, far * 0.95))
  }

  function applySkyGeometry(): void {
    const official = ENVIRONMENT_SKY_DISTANCE * sceneViewDistanceScale
    const resolved = resolveSkyPlaneDistance(official)
    // 1 = 未裁剪（与官方/lab 逐字一致）；>1 = 按官方距离做雾深等效。
    setSlowroadsSkyDepthCorrection(official / resolved)
    // 覆盖距离传「官方 n1」：几何按比例放大，保证 87.7° 覆盖角不随雾尺度倍率缩水
    // （否则 7.5× 场景天顶会露出约 16.8°、12× 约 25.6° 的空洞并显示背景色）。
    sky.setViewDistance(resolved, official)
    appliedSkyPlaneDistance = resolved
    appliedSkyCoverageDistance = official
    const cameraFar = (camera as THREE.PerspectiveCamera).far
    // 非有限 far 用哨兵值 -1（避免 NaN !== NaN 造成每帧重算）。
    lastSkyCameraFar = Number.isFinite(cameraFar) ? cameraFar : -1
    clouds.setCameraFar(cameraFar)
  }

  function applyPreset(next: EnvironmentPreset, nextSettings: SlowroadsEnvironmentSettings | null): void {
    applyLights(next, nextSettings)
    fogColors.colA.set(next.fog.colA)
    fogColors.colB.set(next.fog.colB)
    fogColors.colC.set(next.fog.colC ?? next.fog.colB)
    colorsDirty = true
    baseFog = resolveFogParams(next, ENVIRONMENT_VIEW_DISTANCE * sceneViewDistanceScale)
    skyBaseFog = resolveFogParams(next, ENVIRONMENT_SKY_DISTANCE * sceneViewDistanceScale)
    lastViewDistanceScale = sceneViewDistanceScale
    sceneHazeState.inHaze = false
    skyHazeState.inHaze = false
    lastFog = null
    lastSkyFog = null
    applyFog(baseFog)
    applySkyFog(withSceneSkyDensity(skyBaseFog, baseFog.density))
    // 天空平面挂在官方 n1 距离（= 天空尺度 fogFar，受相机远裁剪面约束），
    // 云层几何保持 300m/1000 尺度（云穹与纹理平铺对该组合是尺度不变量，见 clouds.ts）。
    applySkyGeometry()
    clouds.setState(next.clouds, ENVIRONMENT_CLOUD_ALTITUDE, ENVIRONMENT_VIEW_DISTANCE * sceneViewDistanceScale)
    waterState.base = next.water.base
    waterState.body = next.water.body
    waterState.highlight = next.water.highlight
    waterState.fresnelFactor = next.lights.fresnelFactor
    waterState.frozen = SEASON_PARAMS[nextSettings?.season ?? 'spring'].frozenWater
    applyToggles(nextSettings)
    runEnvironmentSelfChecks()
  }

  function applyToggles(nextSettings: SlowroadsEnvironmentSettings | null): void {
    const showClouds = nextSettings?.showClouds ?? true
    const showStars = nextSettings?.showStars ?? true
    const showSnow = nextSettings?.showSnow ?? true
    // 天空是唯一背景（无 fallback background），始终显示。
    sky.setVisible(true)
    clouds.setVisible(showClouds)
    stars.setConfig(showStars ? preset.stars ?? null : null)
    snow.setConfig(showSnow ? preset.snow ?? null : null)
  }

  /**
   * 启动自检（console；失败由 record 直接 console.error，同时在调用端可见）：
   * 32 套预设完整性、雾色色空间（显示空间等价注入的逐点对齐）、下发后的
   * 场景组/天空组 uniform（天空 = 官方 n1 尺度、far 2×、三色同源、天空平面 z +
   * 覆盖角几何）。
   */
  function runEnvironmentSelfChecks(): void {
    if (selfChecksDone) {
      return
    }
    selfChecksDone = true
    reportSlowroadsSelfChecks('environment', runSlowroadsEnvironmentChecks())
    reportSlowroadsSelfChecks('haze', runSlowroadsHazeInterpolationChecks())
    reportSlowroadsSelfChecks(
      'fog-color',
      runSlowroadsFogColorSpaceChecks({
        preset,
        uniformColors: {
          colA: slowroadsFogUniforms.fogColorA.value,
          colB: slowroadsFogUniforms.fogColorB.value,
          colC: slowroadsFogUniforms.fogColorC.value,
        },
        deferredToneMapping,
        toneMappingExposure: renderer.toneMappingExposure,
        displaySpaceFog,
      }),
    )
    reportSlowroadsSelfChecks(
      'fog-uniform',
      runSlowroadsFogUniformChecks({
        preset,
        cameraY: camera.position.y,
        sceneUniforms: {
          near: slowroadsFogUniforms.fogNear.value,
          far: slowroadsFogUniforms.fogFar.value,
          hazeHeight: slowroadsFogUniforms.hazeHeight.value,
          hazeIntensity: slowroadsFogUniforms.hazeIntensity.value,
        },
        skyUniforms: {
          near: slowroadsSkyFogUniforms.fogNear.value,
          far: slowroadsSkyFogUniforms.fogFar.value,
          hazeHeight: slowroadsSkyFogUniforms.hazeHeight.value,
          hazeIntensity: slowroadsSkyFogUniforms.hazeIntensity.value,
        },
        sceneColors: {
          colA: slowroadsFogUniforms.fogColorA.value,
          colB: slowroadsFogUniforms.fogColorB.value,
          colC: slowroadsFogUniforms.fogColorC.value,
        },
        skyColors: {
          colA: slowroadsSkyFogUniforms.fogColorA.value,
          colB: slowroadsSkyFogUniforms.fogColorB.value,
          colC: slowroadsSkyFogUniforms.fogColorC.value,
        },
        skyPlaneZ: sky.mesh.position.z,
        expectedSkyPlaneZ: -(appliedSkyPlaneDistance - 0.1),
        skyDepthCorrection: slowroadsSkyFogUniforms.skyDepthCorrection.value,
        skyPlaneScale: sky.mesh.scale.y / 1e5,
        expectedSkyPlaneScale: resolveSkyPlaneScale(appliedSkyCoverageDistance),
        skyDensity: slowroadsSkyFogUniforms.fogDensity.value,
        sceneDensity: slowroadsFogUniforms.fogDensity.value,
      }),
    )
  }

  /**
   * 视距尺度变化（proceduralLandscape 世界重建后下发）：重推两套雾参数、
   * 天空平面距离与云层尺度，不重建世界。
   */
  function applyViewDistanceScale(): void {
    if (sceneViewDistanceScale === lastViewDistanceScale) {
      return
    }
    lastViewDistanceScale = sceneViewDistanceScale
    baseFog = resolveFogParams(preset, ENVIRONMENT_VIEW_DISTANCE * sceneViewDistanceScale)
    skyBaseFog = resolveFogParams(preset, ENVIRONMENT_SKY_DISTANCE * sceneViewDistanceScale)
    sceneHazeState.inHaze = false
    skyHazeState.inHaze = false
    lastFog = null
    lastSkyFog = null
    applyFog(baseFog)
    applySkyFog(withSceneSkyDensity(skyBaseFog, baseFog.density))
    applySkyGeometry()
    clouds.setState(preset.clouds, ENVIRONMENT_CLOUD_ALTITUDE, ENVIRONMENT_VIEW_DISTANCE * sceneViewDistanceScale)
  }

  async function loadEnvironmentTextures(): Promise<void> {
    const token = ++textureToken
    const store = options.assetStore
    const cloudsTexture = await store.texture(SHARED_TEXTURES.clouds)
    if (token !== textureToken || disposed) {
      return
    }
    if (cloudsTexture) {
      clouds.setTexture(cloudsTexture)
    }
    const noiseTexture = await store.texture(SHARED_TEXTURES.noise)
    if (token !== textureToken || disposed) {
      return
    }
    if (noiseTexture) {
      snow.setNoiseTexture(noiseTexture)
    }
  }

  void loadEnvironmentTextures()

  return {
    get activePreset(): EnvironmentPreset {
      return preset
    },
    get activeFog(): ResolvedFogParams {
      return lastFog ?? baseFog
    },
    get skyFog(): ResolvedFogParams {
      return lastSkyFog ?? skyBaseFog
    },
    setSettings(next: SlowroadsEnvironmentSettings): void {
      if (disposed) {
        return
      }
      const stateChanged = !settings
        || settings.season !== next.season
        || settings.timeOfDay !== next.timeOfDay
        || settings.weather !== next.weather
      settings = { ...next }
      if (stateChanged) {
        preset = resolveEnvironmentPreset({
          season: next.season,
          timeOfDay: next.timeOfDay,
          weather: next.weather,
        })
        applyPreset(preset, settings)
        return
      }
      // 仅开关/曝光变化：不重算预设表，直接应用增量。
      applyLights(preset, settings)
      applyToggles(settings)
    },
    refreshLighting(): void {
      applyLights(preset, settings)
    },
    setStarSizeTargetPixels(targetPixels: number): void {
      const next = Number.isFinite(targetPixels) && targetPixels > 0 ? targetPixels : 1.0
      if (next !== starSizeTargetPixels) {
        starSizeTargetPixels = next
        lastStarSize = Number.NaN
      }
    },
    update(deltaSeconds: number): void {
      if (disposed) {
        return
      }
      elapsedSeconds += deltaSeconds
      applyViewDistanceScale()
      syncStarSize()
      if (displaySpaceFog) {
        syncDisplaySpaceExposure()
      }
      // 相机远裁剪面可能在运行中变化（场景相机切换/过渡）：天空平面与云层跟随。
      const cameraFarNow = (camera as THREE.PerspectiveCamera).far
      const cameraFarKey = Number.isFinite(cameraFarNow) ? cameraFarNow : -1
      if (
        cameraFarKey !== lastSkyCameraFar
        || Math.abs(appliedSkyPlaneDistance - resolveSkyPlaneDistance(ENVIRONMENT_SKY_DISTANCE * sceneViewDistanceScale)) > 1e-3
        || Math.abs(appliedSkyCoverageDistance - ENVIRONMENT_SKY_DISTANCE * sceneViewDistanceScale) > 1e-3
      ) {
        applySkyGeometry()
      }
      const effectiveFog = resolveHazeForCamera(baseFog, camera.position.y, sceneHazeState)
      const effectiveSkyFog = resolveHazeForCamera(skyBaseFog, camera.position.y, skyHazeState)
      applyFog(effectiveFog)
      applySkyFog(withSceneSkyDensity(effectiveSkyFog, effectiveFog.density))
      clouds.update(deltaSeconds, camera.position)
      stars.update(camera.position)
      camera.getWorldDirection(forwardScratch)
      snow.update(elapsedSeconds, camera.position, forwardScratch)
      waterState.timeSeconds = elapsedSeconds
      waterState.frozen = SEASON_PARAMS[settings?.season ?? 'spring'].frozenWater
    },
    dispose(): void {
      if (disposed) {
        return
      }
      disposed = true
      textureToken += 1
      if (waterEnvironment === waterState) {
        waterEnvironment = null
      }
      // 还原宿主背景（编辑器默认 0x516175 等）。
      scene.background = previousBackground
      setSlowroadsFogDisplaySpaceMode(false)
      refreshSlowroadsFogMaterials()
      sky.dispose()
      clouds.dispose()
      stars.dispose()
      snow.dispose()
    },
  }
}

let placeholderTexture: THREE.Texture | null = null

function getPlaceholderTexture(): THREE.Texture {
  if (!placeholderTexture) {
    const data = new Uint8Array([0, 0, 0, 0])
    placeholderTexture = new THREE.DataTexture(data, 1, 1)
    placeholderTexture.needsUpdate = true
  }
  return placeholderTexture
}
