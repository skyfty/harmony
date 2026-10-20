import * as THREE from 'three'
import {
  ENVIRONMENT_PRESETS,
  ENVIRONMENT_SKY_DISTANCE,
  ENVIRONMENT_VIEW_DISTANCE,
  TIME_OF_DAY_ORDER,
  WEATHER_ORDER,
  resolveFogDepthBlend,
  resolveFogParams,
  resolveSkyFogParams,
  type EnvironmentPreset,
  type SeasonId,
} from '../core/environment'
import { SEASON_PARAMS } from '../core/seasonParams'
import {
  SEASON_CATALOG,
  SEASON_IDS,
  SEASON_INDEX,
  SHARED_TEXTURES,
  collectSeasonTextureRefs,
  type SeasonCatalogEntry,
  type SeasonTextureRef,
} from '../core/seasonCatalog'
import {
  bushVariantEntries,
  getBushEntries,
  getConiferCardRegions,
  getGrassEntries,
} from '../core/spriteRegions'
import {
  resolveHazeForCamera,
  slowroadsDeferredDisplayChannel,
  type SlowroadsFogColorSet,
} from './fogInjection'

/**
 * Slow Roads 启动自检（平台无关子集，editor / preview / viewer 共用）。
 *
 * 覆盖 lab `src/core/selfCheck.ts` 的环境/季节/着色器源码三组断言：
 *  - 环境预设（32 套、星空/降雪不变量、天空 2000 尺度、参考预设 vFogBlend）；
 *  - 雾色输出色空间 + 编辑器（EffectComposer）预补偿还原为预设显示色；
 *  - 雾 uniform 下发值（天空组 = 天空尺度、far 2×、三色同源、天空平面 z）；
 *  - 季节贴图槽位/色彩空间/别名一致性/alphaTest 表/树卡变色乘数语义；
 *  - 树卡变色着色器源码断言 + 景观材质 uniform 覆盖审计。
 *
 * 返回结果，宿主把失败项并入面板 warnings。
 */

export interface SlowroadsSelfCheckResult {
  name: string
  ok: boolean
  detail: string
}

function createRecorder(): {
  results: SlowroadsSelfCheckResult[]
  record: (name: string, ok: boolean, detail?: string) => void
} {
  const results: SlowroadsSelfCheckResult[] = []
  const record = (name: string, ok: boolean, detail = ''): void => {
    results.push({ name, ok, detail })
  }
  return { results, record }
}

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/

/* ------------------------------- haze 插值 ------------------------------- */

/**
 * haze 层高度插值的健壮性校验（用户实测：秋·早晨低机位整片变红）。
 *
 * `resolveHazeForCamera` 的官方公式在「正 hazeHeight + 相机低于雾层基准面」时
 * `e = (1 - cameraY/hazeHeight)²` 会超过 1，`far = base.far·(1 - e·min(0.9, hazeIntensity))`
 * 反号；片元 `max(0.001, fogFar - fogNear)` 随即把 `vFogDepth` 压成 0，天空平面上顶点
 * `vHaze` 的巨值外推（±5e4 平面插值到屏幕中部 ≈ 数百）不再被 A/B 混色覆盖 → 整片红色。
 * 这里对 32 套预设 × 全机位高度范围断言「far 恒为正、far > near」。
 */
export function runSlowroadsHazeInterpolationChecks(): SlowroadsSelfCheckResult[] {
  const { results, record } = createRecorder()
  let failures = 0
  let worst = ''
  const seasons: SeasonId[] = ['spring', 'summer', 'autumn', 'winter']
  for (const season of seasons) {
    for (const timeOfDay of TIME_OF_DAY_ORDER) {
      for (const weather of WEATHER_ORDER) {
        const preset = ENVIRONMENT_PRESETS[season][timeOfDay][weather]
        for (const scale of [1, 7.54, 12]) {
          for (const viewDistance of [ENVIRONMENT_VIEW_DISTANCE, ENVIRONMENT_SKY_DISTANCE]) {
            const base = resolveFogParams(preset, viewDistance * scale)
            for (const cameraY of [-500, -50, -1, 0, 5, 20, 79, 100, 400]) {
              const resolved = resolveHazeForCamera(base, cameraY, { inHaze: false })
              const ok = Number.isFinite(resolved.far)
                && Number.isFinite(resolved.near)
                && resolved.far > 0
                && resolved.far > resolved.near
                && Number.isFinite(resolved.density)
                && resolved.density > 0
              if (!ok) {
                failures += 1
                if (!worst) {
                  worst = `${season}/${timeOfDay}/${weather} scale=${scale} view=${viewDistance} `
                    + `camY=${cameraY} near=${resolved.near.toFixed(2)} far=${resolved.far.toFixed(2)}`
                }
              }
            }
          }
        }
      }
    }
  }
  record(
    'haze interpolation keeps fog far positive and beyond near',
    failures === 0,
    failures === 0 ? '32 presets x camera heights' : `${failures} failures, first: ${worst}`,
  )
  return results
}

function srgbComponentsFromHex(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

function colorMatches(
  color: THREE.Color,
  expected: readonly number[],
  tolerance = 1e-3,
): boolean {
  return Math.abs(color.r - expected[0]!) < tolerance
    && Math.abs(color.g - expected[1]!) < tolerance
    && Math.abs(color.b - expected[2]!) < tolerance
}

function colorTriplet(color: THREE.Color): string {
  return `(${color.r.toFixed(4)}, ${color.g.toFixed(4)}, ${color.b.toFixed(4)})`
}

/**
 * 环境预设校验：32 套齐全、颜色/数值合法、星空只在夜晴（4 处）、降雪只在冬季
 * （5 处，含 1 个密度 0 的占位）；天空雾尺度 = 2 × 场景尺度（官方 n1）；
 * 参考预设（春·晨·晴）天空 vFogBlend = 1、场景 = 0.7778；两者的差异恰好落在
 * 「场景 fogAvg < 500」的预设上（尺度拆分的影响面）。
 */
export function runSlowroadsEnvironmentChecks(): SlowroadsSelfCheckResult[] {
  const { results, record } = createRecorder()

  let presetCount = 0
  let starsCount = 0
  let snowCount = 0
  let shapesOk = true
  let notes = ''
  for (const season of SEASON_IDS) {
    for (const time of TIME_OF_DAY_ORDER) {
      for (const weather of WEATHER_ORDER) {
        presetCount += 1
        const preset = ENVIRONMENT_PRESETS[season][time][weather]
        const colors = [
          preset.lights.sun.col,
          preset.lights.ambient.col,
          preset.fog.colA,
          preset.fog.colB,
          preset.fog.colC ?? preset.fog.colB,
          preset.water.base,
          preset.water.body,
          preset.water.highlight,
          preset.water.underwater,
          preset.clouds.highlight,
          preset.clouds.lowlight,
        ]
        if (!colors.every((color) => HEX_PATTERN.test(color))) {
          shapesOk = false
          notes = `${season}/${time}/${weather}:color`
        }
        const numbers = [
          preset.lights.sun.intensity,
          preset.lights.ambient.intensity,
          preset.fog.near,
          preset.fog.far,
          preset.clouds.shelfHeight0,
          preset.clouds.shelfHeight1,
          preset.clouds.skyScale0,
          preset.clouds.skyScale1,
        ]
        if (!numbers.every((value) => Number.isFinite(value))) {
          shapesOk = false
          notes = `${season}/${time}/${weather}:number`
        }
        const fog = resolveFogParams(preset)
        if (!(fog.far > 0 && fog.density > 0)) {
          shapesOk = false
          notes = `${season}/${time}/${weather}:fog`
        }
        if (preset.stars) {
          starsCount += 1
          if (time !== 'night' || weather !== 'clear') {
            shapesOk = false
            notes = `stars@${season}/${time}/${weather}`
          }
        }
        if (preset.snow) {
          snowCount += 1
          if (season !== 'winter') {
            shapesOk = false
            notes = `snow@${season}/${time}/${weather}`
          }
        }
      }
    }
  }
  record('environment presets complete', presetCount === 32 && shapesOk, notes)
  record('stars only night+clear', starsCount === 4, `stars=${starsCount}`)
  record('snow only winter', snowCount === 5, `snow=${snowCount}`)

  record(
    'sky fog distance = 2 x view distance (official n1)',
    ENVIRONMENT_SKY_DISTANCE === ENVIRONMENT_VIEW_DISTANCE * 2,
    `sky=${ENVIRONMENT_SKY_DISTANCE} view=${ENVIRONMENT_VIEW_DISTANCE}`,
  )

  const referencePreset = ENVIRONMENT_PRESETS.spring.morning.clear
  const referenceScene = resolveFogParams(referencePreset)
  const referenceSky = resolveSkyFogParams(referencePreset)
  const referenceSceneBlend = resolveFogDepthBlend(referenceScene.near, referenceScene.far)
  const referenceSkyBlend = resolveFogDepthBlend(referenceSky.near, referenceSky.far)
  record(
    'sky vFogBlend matches official (spring/morning/clear = 1)',
    Math.abs(referenceSkyBlend - 1) < 1e-6,
    `sky near=${referenceSky.near} far=${referenceSky.far} blend=${referenceSkyBlend.toFixed(4)}`,
  )
  record(
    'scene vFogBlend keeps view scale (spring/morning/clear = 0.7778)',
    Math.abs(referenceSceneBlend - 7.7778e-1) < 5e-4,
    `scene near=${referenceScene.near} far=${referenceScene.far} blend=${referenceSceneBlend.toFixed(4)}`,
  )

  let blendInvariantOk = true
  let blendDetail = 'ok'
  let differCount = 0
  let sceneSubUnitCount = 0
  for (const season of SEASON_IDS) {
    for (const time of TIME_OF_DAY_ORDER) {
      for (const weather of WEATHER_ORDER) {
        const preset = ENVIRONMENT_PRESETS[season][time][weather]
        const scene = resolveFogParams(preset)
        const sky = resolveSkyFogParams(preset)
        const sceneBlend = resolveFogDepthBlend(scene.near, scene.far)
        const skyBlend = resolveFogDepthBlend(sky.near, sky.far)
        if (skyBlend < sceneBlend - 1e-9) {
          blendInvariantOk = false
          blendDetail = `${season}/${time}/${weather}: sky=${skyBlend.toFixed(4)} < scene=${sceneBlend.toFixed(4)}`
        }
        if (Math.abs(skyBlend - sceneBlend) > 1e-9) {
          differCount += 1
        }
        if (sceneBlend < 1 - 1e-9) {
          sceneSubUnitCount += 1
        }
      }
    }
  }
  record('sky vFogBlend >= scene vFogBlend for all 32 presets', blendInvariantOk, blendDetail)
  record(
    'sky/scene vFogBlend differ exactly on scene fogAvg < 500 presets',
    differCount === sceneSubUnitCount,
    `differ=${differCount} sceneAvg<500=${sceneSubUnitCount}`,
  )

  return results
}

/* ---------------------------- 雾色色彩空间 ---------------------------- */

/** 参考预设（春·晨·晴）fogColorA #E496AD 的输出/线性分量（官方 Bs(i) 判据）。 */
export const FOG_COLOR_SPACE_REFERENCE = {
  hex: '#E496AD',
  srgb: [0.8941, 0.5882, 0.6784] as const,
  linear: [0.7758, 0.305, 0.4179] as const,
}

export interface FogColorSpaceCheckInput {
  preset: EnvironmentPreset
  /** 实际下发到共享 uniform 的三色雾分量（slowroadsFogUniforms 的当前值）。 */
  uniformColors: SlowroadsFogColorSet
  /**
   * 是否走了编辑器（EffectComposer + OutputPass）的延后色调映射路径：
   * true 时仍按官方/lab 语义下发 sRGB 显示分量（片元体自己负责显示空间换算）。
   */
  deferredToneMapping: boolean
  /** 延后管线下是否启用了「显示空间等价注入」（`setSlowroadsFogDisplaySpaceMode`）。 */
  displaySpaceFog?: boolean
  toneMappingExposure?: number
}

/**
 * 雾色色彩空间校验（第四批 + 显示空间等价修复）：
 *  1) 换算依赖：ColorManagement 开启时 getRGB(..., SRGBColorSpace) 还原成 hex 分量，
 *     且与线性分量明显不同（关掉色彩管理 / 直接推线性值都会失败）；
 *  2) 实际下发值：两条管线都必须等于预设的 sRGB 显示分量（lab 语义）；
 *  3) 显示空间等价注入：端到端模拟（尾体反变换 + OutputPass 的 `sRGB∘Cineon`）必须
 *     逐点还原出「显示空间混色」的结果——包括 blend = 2·sinθ > 1 的外推段，这正是
 *     旧实现（线性域反 Cineon 预补偿）把天顶压成异常深蓝的地方。
 */
export function runSlowroadsFogColorSpaceChecks(input: FogColorSpaceCheckInput): SlowroadsSelfCheckResult[] {
  const { results, record } = createRecorder()

  const converted = new THREE.Color().set(FOG_COLOR_SPACE_REFERENCE.hex)
  converted.getRGB(converted, THREE.SRGBColorSpace)
  record(
    `fog color space: ${FOG_COLOR_SPACE_REFERENCE.hex} -> output(sRGB)`,
    colorMatches(converted, FOG_COLOR_SPACE_REFERENCE.srgb),
    `got ${colorTriplet(converted)} want (${FOG_COLOR_SPACE_REFERENCE.srgb.join(', ')})`,
  )
  const linearReference = new THREE.Color().set(FOG_COLOR_SPACE_REFERENCE.hex)
  record(
    'fog color space: reference linear components',
    colorMatches(linearReference, FOG_COLOR_SPACE_REFERENCE.linear, 1e-4),
    `linear ${colorTriplet(linearReference)}`,
  )
  record(
    'fog color space: linear components differ from output space',
    !colorMatches(linearReference, FOG_COLOR_SPACE_REFERENCE.srgb, 0.02),
    `linear ${colorTriplet(linearReference)}`,
  )

  const entries: Array<[string, string, THREE.Color]> = [
    ['fogColorA', input.preset.fog.colA, input.uniformColors.colA],
    ['fogColorB', input.preset.fog.colB, input.uniformColors.colB],
    ['fogColorC', input.preset.fog.colC ?? input.preset.fog.colB, input.uniformColors.colC],
  ]
  const exposure = input.toneMappingExposure && input.toneMappingExposure > 0 ? input.toneMappingExposure : 1
  let ok = true
  let detail = ''
  for (const [key, hex, color] of entries) {
    const want = srgbComponentsFromHex(hex)
    const got: number[] = [color.r, color.g, color.b]
    const matches = Math.abs(got[0]! - want[0]) < 2e-3
      && Math.abs(got[1]! - want[1]) < 2e-3
      && Math.abs(got[2]! - want[2]) < 2e-3
    if (!matches) {
      ok = false
      detail += ` ${key}=${colorTriplet(color)} want ${hex}(${want.map((v) => v.toFixed(4)).join(', ')})`
    }
  }
  record(
    input.deferredToneMapping
      ? 'fog uniform colors are preset display components (deferred pipeline)'
      : 'fog uniform colors in output color space',
    ok,
    detail || entries.map(([key, hex]) => `${key}=${hex}`).join(', '),
  )

  if (input.deferredToneMapping) {
    // 端到端：显示空间等价注入 → 尾体 → OutputPass 必须逐点还原显示空间混色。
    const colA = srgbComponentsFromHex(input.preset.fog.colA)
    const colB = srgbComponentsFromHex(input.preset.fog.colB)
    const blends = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]
    let maxDelta = 0
    let worstBlend = 0
    for (const blend of blends) {
      for (let channel = 0; channel < 3; channel += 1) {
        const display = colA[channel]! + (colB[channel]! - colA[channel]!) * blend
        const target = Math.min(Math.max(display, 0), 1)
        const output = slowroadsDeferredDisplayChannel(target, exposure)
        maxDelta = Math.max(maxDelta, Math.abs(output - target))
        if (Math.abs(output - target) >= maxDelta) {
          worstBlend = blend
        }
      }
    }
    record(
      'display-space fog: emulated deferred output matches lab display mix (incl. blend > 1)',
      input.displaySpaceFog !== false && maxDelta <= 1 / 255 + 1e-6,
      input.displaySpaceFog === false
        ? 'display space fog disabled (deferred pipeline would fall back to linear mixing)'
        : `maxDelta=${maxDelta.toFixed(5)} (worst blend=${worstBlend}) tolerance=${(1 / 255).toFixed(5)}`,
    )
  }

  return results
}

/* ---------------------------- 雾 uniform 下发 ---------------------------- */

export interface FogUniformCheckInput {
  preset: EnvironmentPreset
  cameraY: number
  /**
   * 场景视距倍率（proceduralLandscape 世界重建后下发；1 = 官方未缩放尺度）。
   * 运行时把两套雾距离都乘以该倍率，自检的期望值必须同样缩放，否则大尺度场景
   * 会误报 “sky fog uniforms use official sky scale”。
   */
  viewDistanceScale?: number
  sceneUniforms: { near: number; far: number; hazeHeight: number; hazeIntensity: number }
  skyUniforms: { near: number; far: number; hazeHeight: number; hazeIntensity: number }
  sceneColors: SlowroadsFogColorSet
  skyColors: SlowroadsFogColorSet
  /** 天空平面世界 z（lab/官方：-(n1 - 0.1)；编辑器受相机远裁剪面约束时更近）。 */
  skyPlaneZ: number | null
  /** 期望的天空平面 z（由环境运行时按「官方 n1 + 相机远裁剪面」解析）。 */
  expectedSkyPlaneZ: number
  /** skyDepthCorrection（官方距离 / 实际距离；未裁剪 = 1）。 */
  skyDepthCorrection: number
  /** 天空平面几何倍率（mesh.scale.y / 1e5）。 */
  skyPlaneScale?: number
  /** 期望的天空平面几何倍率（保持官方 87.7° 视场覆盖）。 */
  expectedSkyPlaneScale?: number
  /** 天空组当前下发的雾密度（lab 语义：取场景密度，使天空 vFogDepth 饱和为 1）。 */
  skyDensity?: number
  /** 场景组当前雾密度。 */
  sceneDensity?: number
}

/**
 * 雾 uniform 下发值校验（第五批）：
 *  - 天空组 = 官方 n1 尺度的基准或 haze 插值结果；
 *  - 天空 far 恒为场景 far 的 2 倍（尺度误绑会当场失败）；
 *  - 天空 vFogBlend = 官方值；
 *  - 天空组与场景组雾色同源（同一预设）；
 *  - 天空平面挂在官方 n1 距离。
 *  - 天空平面几何按覆盖距离等比放大（大尺度场景天顶不露背景色）。
 *  - 天空组密度 = 场景组密度（lab/three 的 refreshFogUniforms 语义）：天空平面
 *    因此 `vFogDepth = 1 - exp(-20)` 饱和为 1，`vHaze` 巨值外推不会泄漏。
 */
export function runSlowroadsFogUniformChecks(input: FogUniformCheckInput): SlowroadsSelfCheckResult[] {
  const { results, record } = createRecorder()
  const matches = (got: number, want: number): boolean => Math.abs(got - want) < 1e-6
  const viewDistanceScale = typeof input.viewDistanceScale === 'number'
    && Number.isFinite(input.viewDistanceScale)
    && input.viewDistanceScale > 0
    ? Math.min(16, Math.max(1, input.viewDistanceScale))
    : 1
  // 与运行时一致：天空组雾距离 = 官方 n1 × 场景视距倍率。
  const officialSkyDistance = ENVIRONMENT_SKY_DISTANCE * viewDistanceScale
  const skyBase = resolveFogParams(input.preset, officialSkyDistance)
  const skyAdjusted = resolveHazeForCamera(skyBase, input.cameraY, { inHaze: false })
  // 与 lab 相同：接受基准或当前相机高度的 haze 插值（相机在层内时 far 会缩短）。
  const numbers: Array<[string, number, number, number]> = [
    ['fogNear', input.skyUniforms.near, skyBase.near, skyAdjusted.near],
    ['fogFar', input.skyUniforms.far, skyBase.far, skyAdjusted.far],
    ['hazeHeight', input.skyUniforms.hazeHeight, skyBase.hazeHeight, skyAdjusted.hazeHeight],
    ['hazeIntensity', input.skyUniforms.hazeIntensity, skyBase.hazeIntensity, skyAdjusted.hazeIntensity],
  ]
  let paramsOk = true
  let detail = `camY=${input.cameraY.toFixed(1)}`
  for (const [key, got, wantBase, wantAdjusted] of numbers) {
    if (!matches(got, wantBase) && !matches(got, wantAdjusted)) {
      paramsOk = false
      detail += ` ${key}=${got.toFixed(4)} want ${wantBase.toFixed(4)}|${wantAdjusted.toFixed(4)}`
    }
  }
  record('sky fog uniforms use official sky scale', paramsOk, detail)

  record(
    'sky fog far = 2 x scene fog far',
    matches(input.skyUniforms.far, input.sceneUniforms.far * 2),
    `sky=${input.skyUniforms.far.toFixed(4)} scene=${input.sceneUniforms.far.toFixed(4)}`,
  )

  const blend = resolveFogDepthBlend(input.skyUniforms.near, input.skyUniforms.far)
  const wantBlend = resolveFogDepthBlend(skyBase.near, skyBase.far)
  record(
    'sky vFogBlend matches official sky scale',
    Math.abs(blend - wantBlend) < 1e-6,
    `vFogBlend=${blend.toFixed(4)} want ${wantBlend.toFixed(4)}`,
  )
  const sceneBlend = resolveFogDepthBlend(input.sceneUniforms.near, input.sceneUniforms.far)
  void sceneBlend

  if (input.skyPlaneZ === null) {
    record('sky plane hangs at official n1 distance', false, 'sky mesh missing')
  } else {
    record(
      'sky plane hangs at the resolved sky distance',
      Math.abs(input.skyPlaneZ - input.expectedSkyPlaneZ) < 1e-3,
      `z=${input.skyPlaneZ} want ${input.expectedSkyPlaneZ}`,
    )
    // 相机远裁剪面可能把平面压近：此时深度换算必须把雾深/ haze 折回官方距离。
    const resolvedDistance = Math.abs(input.skyPlaneZ + 0.1)
    const effectiveOfficial = resolvedDistance * input.skyDepthCorrection
    record(
      'sky depth correction restores the official n1 distance',
      input.skyDepthCorrection >= 1
        && Math.abs(effectiveOfficial - officialSkyDistance) < 1,
      `resolved=${resolvedDistance.toFixed(2)} correction=${input.skyDepthCorrection.toFixed(4)} official=${effectiveOfficial.toFixed(2)}`,
    )
  }

  if (typeof input.skyPlaneScale === 'number' && typeof input.expectedSkyPlaneScale === 'number') {
    // 覆盖角 = atan(5e4 · scale / resolvedDistance)：几何必须随天空尺度放大，
    // 否则倍率越大覆盖角越小，天顶会露出背景色（lab 无此问题）。
    const officialCoverage = Math.atan(5e4 / ENVIRONMENT_SKY_DISTANCE)
    const resolvedDistance = input.skyPlaneZ === null ? ENVIRONMENT_SKY_DISTANCE : Math.abs(input.skyPlaneZ + 0.1)
    const scale = Math.max(1e-6, input.skyPlaneScale)
    const coverage = Math.atan((5e4 * scale) / Math.max(1e-6, resolvedDistance))
    record(
      'sky plane geometry keeps the official coverage angle',
      Math.abs(input.skyPlaneScale - input.expectedSkyPlaneScale) < 1e-6
        && coverage >= officialCoverage - 1e-4,
      `scale=${input.skyPlaneScale.toFixed(4)} want ${input.expectedSkyPlaneScale.toFixed(4)} `
        + `coverage=${((coverage * 180) / Math.PI).toFixed(2)}° official=${((officialCoverage * 180) / Math.PI).toFixed(2)}°`,
    )
  }

  if (typeof input.skyDensity === 'number' && typeof input.sceneDensity === 'number') {
    const skyDepthSquared = Math.pow(input.skyDensity * (input.skyUniforms.far <= 0 ? 0 : 2 * (input.sceneUniforms.far || 1)), 2)
    record(
      'sky fog density follows scene density (sky vFogDepth saturates)',
      Math.abs(input.skyDensity - input.sceneDensity) < 1e-9 && skyDepthSquared > 16,
      `skyDensity=${input.skyDensity.toFixed(6)} sceneDensity=${input.sceneDensity.toFixed(6)} `
        + `(density · 2 × sceneFar)²=${skyDepthSquared.toFixed(2)}`,
    )
  }

  // 编辑器管线下天空/场景两组都持有同一个预补偿结果：只比较「同源」的一致性即可
  // （组件级等价：两组 uniform 的颜色必须逐分量相同）。
  let colorsOk = true
  let colorsDetail = 'ok'
  for (const key of ['colA', 'colB', 'colC'] as const) {
    const skyColor = input.skyColors[key]
    const sceneColor = input.sceneColors[key]
    if (!colorMatches(skyColor, [sceneColor.r, sceneColor.g, sceneColor.b], 1e-6)) {
      colorsOk = false
      colorsDetail = `${key} sky=${colorTriplet(skyColor)} scene=${colorTriplet(sceneColor)}`
    }
  }
  record('sky fog colors equal scene fog colors (same preset)', colorsOk, colorsDetail)

  return results
}

/* ------------------------------- 季节表 ------------------------------- */

/**
 * 季节目录校验（季节贴图槽位完备/去重、精灵区域语义、调色板与特效参数、
 * 贴图色彩空间表 vs 官方装载表、同文件多槽位色彩空间一致、逐季 alphaTest 表、
 * 树卡变色幅度语义）。
 */
export function runSlowroadsSeasonChecks(): SlowroadsSelfCheckResult[] {
  const { results, record } = createRecorder()

  let seasonRefsOk = true
  const counts: string[] = []
  for (const season of SEASON_IDS) {
    const refs = collectSeasonTextureRefs(season)
    counts.push(`${season}:${refs.length}`)
    if (refs.length < 16) {
      seasonRefsOk = false
    }
    const ids = new Set(refs.map((ref) => ref.id))
    if (ids.size !== refs.length) {
      seasonRefsOk = false
    }
  }
  record('season texture sets complete', seasonRefsOk, counts.join(' '))

  let regionOk = true
  const regionNotes: string[] = []
  for (const season of SEASON_IDS) {
    const bushEntries = getBushEntries(season)
    const grassEntries = getGrassEntries(season)
    const conifer = getConiferCardRegions(season)
    if (!bushEntries.length || !grassEntries.length) {
      regionOk = false
      regionNotes.push(`${season}:empty-set`)
    }
    if (bushVariantEntries(season).length < 1) {
      regionOk = false
      regionNotes.push(`${season}:no-bush-cells`)
    }
    if (conifer.length < 2) {
      regionOk = false
      regionNotes.push(`${season}:conifer-cards`)
    }
    const grassCells = grassEntries.map((entry) => entry.cell)
    if (season === 'winter') {
      if (grassCells.some((cell) => cell < 2)) {
        regionOk = false
        regionNotes.push('winter:grass-cells')
      }
    } else if (![0, 1, 2, 3].every((cell) => grassCells.includes(cell))) {
      regionOk = false
      regionNotes.push(`${season}:grass-cells`)
    }
    for (const region of [...bushEntries.map((entry) => entry.region), ...grassEntries.map((entry) => entry.region), ...conifer]) {
      if (!(region.u0 >= 0 && region.u1 <= 1 && region.v0 >= 0 && region.v1 <= 1 && region.u1 > region.u0 && region.v1 > region.v0)) {
        regionOk = false
        regionNotes.push(`${season}:bounds`)
      }
    }
  }
  record('sprite regions valid', regionOk, regionNotes.join(' '))

  let paramsOk = true
  for (const season of SEASON_IDS) {
    const params = SEASON_PARAMS[season]
    if (params.index !== SEASON_INDEX[season]) {
      paramsOk = false
    }
    for (const color of [params.grassColA, params.grassColB, params.peakColA, params.peakColB, params.fieldDiscolouration, params.roadCol]) {
      if (!HEX_PATTERN.test(color)) {
        paramsOk = false
      }
    }
    if (!(params.shadowFactor > 0 && params.treeDiscolouration >= 0)) {
      paramsOk = false
    }
  }
  record('season params complete', paramsOk)
  record('winter flags', SEASON_PARAMS.winter.hasSnow && SEASON_PARAMS.winter.frozenWater)

  const colorSpaceNotes: string[] = []
  const expectSpace = (ok: boolean, note: string): void => {
    if (!ok) colorSpaceNotes.push(note)
  }
  for (const season of SEASON_IDS) {
    const entry = SEASON_CATALOG[season]
    expectSpace(entry.surface.grass.colorSpace === 'srgb', `${season}:grass`)
    expectSpace(entry.surface.forest.colorSpace === 'srgb', `${season}:forest`)
    expectSpace(entry.surface.heather.colorSpace === 'srgb', `${season}:heather`)
    expectSpace(entry.surface.gravel.colorSpace === 'srgb', `${season}:gravel`)
    expectSpace(entry.surface.rock.colorSpace === 'srgb', `${season}:rock`)
    expectSpace(entry.surface.sand.colorSpace === 'srgb', `${season}:sand`)
    expectSpace(entry.surface.detailFar.colorSpace === 'linear', `${season}:detailFar`)
    expectSpace(entry.surface.detailNear.colorSpace === (season === 'winter' ? 'srgb' : 'linear'), `${season}:detailNear`)
    expectSpace(entry.sprites.bushes.colorSpace === 'srgb', `${season}:bushes`)
    expectSpace(entry.sprites.grassSprites.colorSpace === 'srgb', `${season}:grassSprites`)
    expectSpace(entry.trees.broadleafD.colorSpace === 'srgb', `${season}:broadleafD`)
    expectSpace(entry.trees.broadleafN.colorSpace === 'linear', `${season}:broadleafN`)
    expectSpace(entry.trees.coniferM.colorSpace === 'srgb', `${season}:coniferM`)
    expectSpace(entry.trees.coniferA.colorSpace === 'srgb', `${season}:coniferA`)
    expectSpace(entry.imposters.mapA.colorSpace === 'srgb' && entry.imposters.mapB.colorSpace === 'srgb', `${season}:imposterMaps`)
    expectSpace(entry.imposters.normA.colorSpace === 'linear' && entry.imposters.normB.colorSpace === 'linear', `${season}:imposterNormals`)
    expectSpace(entry.road.single.base.colorSpace === 'srgb', `${season}:roadSingleBase`)
    expectSpace(entry.road.wide.base.colorSpace === 'srgb', `${season}:roadWideBase`)
    if (entry.road.single.overlay) {
      expectSpace(entry.road.single.overlay.colorSpace === 'srgb', `${season}:roadSingleOverlay`)
    }
    if (entry.road.wide.overlay) {
      expectSpace(entry.road.wide.overlay.colorSpace === 'srgb', `${season}:roadWideOverlay`)
    }
    // 划线贴图与墙体贴图都按 srgb 解码（官方 U(url) 默认 srgb）。
    if (entry.road.wide.paint) {
      for (const ref of [
        entry.road.wide.paint.dashed,
        entry.road.wide.paint.solid,
        entry.road.wide.paint.solidLeft,
        entry.road.wide.paint.solidRight,
        entry.road.wide.paint.mergeLeft,
        entry.road.wide.paint.mergeRight,
      ]) {
        expectSpace(ref.colorSpace === 'srgb', `${season}:roadPaint`)
      }
    }
    for (const ref of [entry.walls.barrier, entry.walls.seaWall, entry.walls.fence, entry.walls.drystone]) {
      expectSpace(ref.colorSpace === 'srgb', `${season}:wall`)
    }
  }
  record('texture color spaces match official loader', colorSpaceNotes.length === 0, colorSpaceNotes.slice(0, 6).join(', '))

  const byLogicalId = new Map<string, { colorSpace: string; slot: string }>()
  const aliasConflicts: string[] = []
  const visitRef = (slot: string, ref: SeasonTextureRef): void => {
    const previous = byLogicalId.get(ref.id)
    if (!previous) {
      byLogicalId.set(ref.id, { colorSpace: ref.colorSpace, slot })
      return
    }
    if (previous.colorSpace !== ref.colorSpace) {
      aliasConflicts.push(`${ref.id}: ${previous.slot}(${previous.colorSpace}) vs ${slot}(${ref.colorSpace})`)
    }
  }
  const walkEntry = (entry: object, prefix: string): void => {
    for (const [key, value] of Object.entries(entry)) {
      if (!value || typeof value !== 'object') {
        continue
      }
      const recordEntry = value as Record<string, unknown>
      if (typeof recordEntry.id === 'string' && typeof recordEntry.colorSpace === 'string') {
        visitRef(prefix ? `${prefix}.${key}` : key, value as SeasonTextureRef)
        continue
      }
      walkEntry(value as object, prefix ? `${prefix}.${key}` : key)
    }
  }
  for (const season of SEASON_IDS) {
    walkEntry(SEASON_CATALOG[season] satisfies SeasonCatalogEntry, season)
  }
  walkEntry(SHARED_TEXTURES, 'shared')
  record('texture aliases share one color space', aliasConflicts.length === 0, aliasConflicts.slice(0, 4).join(' | '))

  const alphaExpectation: Record<SeasonId, readonly [number, number, number]> = {
    spring: [0.5, 0.2, 0.6],
    summer: [0.5, 0.2, 0.6],
    autumn: [0.5, 0.2, 0.6],
    winter: [0.2, 0.3, 0.5],
  }
  const alphaNotes: string[] = []
  for (const season of SEASON_IDS) {
    const params = SEASON_PARAMS[season]
    const [grass, bush, imposter] = alphaExpectation[season]
    if (params.grassAlphaTest !== grass || params.bushAlphaTest !== bush || params.imposterAlphaTest !== imposter) {
      alphaNotes.push(season)
    }
  }
  record('foliage alpha tests match official presets', alphaNotes.length === 0, alphaNotes.join(','))

  // 树卡变色语义：官方 `effects.treeDiscolouration` 是噪声**幅度**，不是通道乘数。
  const discolourationNotes: string[] = []
  let winterDiscolourationOk = true
  for (const season of SEASON_IDS) {
    const factor = SEASON_PARAMS[season].treeDiscolouration
    const range = scanTreeDiscolourationRange(factor)
    const expectedMin = 1 - factor / 2
    const expectedMax = 1 + factor / 2
    if (Math.abs(range.min - expectedMin) > 1e-6 || Math.abs(range.max - expectedMax) > 1e-6) {
      discolourationNotes.push(`${season}:range(${range.min.toFixed(3)}..${range.max.toFixed(3)})`)
    }
    if (season === 'winter' && (range.min < 0.9 - 1e-6 || range.max > 1.1 + 1e-6)) {
      winterDiscolourationOk = false
    }
  }
  record(
    'tree discolouration = noise amplitude (1 ± factor/2)',
    discolourationNotes.length === 0,
    discolourationNotes.join(' '),
  )
  record(
    'winter tree discolouration stays within 0.9..1.1 (no channel crush)',
    winterDiscolourationOk,
    `winter factor=${SEASON_PARAMS.winter.treeDiscolouration} → 乘数落在 0.9..1.1；把因子当乘数（旧缺陷）会得到 0.2 并让树冠发紫`,
  )

  return results
}

/* ------------------------- 树卡变色（树卡/近树/远景树） ------------------------- */

/**
 * 官方树卡变色乘数的纯函数镜像（顶点分块）：
 *   `disc = 1.0 + (noise - 0.5) * factor;  if (柏树列) disc = disc * 0.5 + 0.5;`
 * `factor` = 官方 `effects.treeDiscolouration`（幅度：春 1.5 / 夏 .9 / 秋 1.2 / 冬 .2），
 * 不是通道乘数——直接乘通道会让冬季绿通道只剩 20%，树冠发紫。
 */
export function resolveTreeDiscolouration(
  noise: number,
  factor: number,
  options?: { cypress?: boolean },
): number {
  const jittered = 1 + (noise - 0.5) * factor
  return options?.cypress ? jittered * 0.5 + 0.5 : jittered
}

/** 噪声 0..1 扫描出的乘数区间（自检用：应等于 `[1 - factor/2, 1 + factor/2]`）。 */
export function scanTreeDiscolourationRange(factor: number, steps = 64): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let index = 0; index <= steps; index += 1) {
    const value = resolveTreeDiscolouration(index / steps, factor)
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  return { min, max }
}

export interface TreeDiscolourationShaderInput {
  name: string
  vertexShader: string
  fragmentShader: string
}

const TREE_SHADER_NAME = /^slowroads-(foliage|near-tree)-/
/** 迁移端材质名与 uniform/varying 前缀（uPl/vPl），与 lab 的 uTree/vTree 并存兼容。 */
const TREE_DISCOLOURATION_FACTOR = /u(?:Pl)?TreeDiscolourationFactor/
const TREE_DISCOLOURATION_FORMULA = /-\s*0\.5\)\s*\*\s*u(?:Pl)?TreeDiscolourationFactor/
const TREE_DISCOLOURATION_NOISE = /texture2D\(\s*u(?:Pl)?TreeDiscolourationNoise/
const TREE_DISCOLOURATION_VARYING = /varying\s+float\s+v(?:Pl)?TreeDiscolouration\s*;/
const UNIFORM_DECLARATION_LINE = /^\s*uniform\b/

function stripGlslComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

/**
 * 树卡变色着色器断言（防回归）：因子只能出现在顶点噪声公式里一次，片元必须消费
 * `vTreeDiscolouration` varying。直接拿因子乘通道 = 冬季发紫那个缺陷，这里当场失败。
 */
export function runTreeDiscolourationShaderChecks(
  materials: TreeDiscolourationShaderInput[],
): SlowroadsSelfCheckResult[] {
  const { results, record } = createRecorder()

  const violations = new Set<string>()
  const scoped = materials.filter((material) => TREE_SHADER_NAME.test(material.name))
  for (const material of scoped) {
    const vertex = stripGlslComments(material.vertexShader)
    const fragment = stripGlslComments(material.fragmentShader)
    const factorLines = vertex
      .split('\n')
      .filter((line) => TREE_DISCOLOURATION_FACTOR.test(line) && !UNIFORM_DECLARATION_LINE.test(line))
    if (factorLines.length !== 1) {
      violations.add(`${material.name}:factor-lines=${factorLines.length}`)
      continue
    }
    const formulaLine = factorLines[0]!
    if (!TREE_DISCOLOURATION_FORMULA.test(formulaLine)) {
      violations.add(`${material.name}:factor-not-in-noise-formula`)
    }
    if (!TREE_DISCOLOURATION_NOISE.test(formulaLine)) {
      violations.add(`${material.name}:no-noise-sample`)
    }
    if (!formulaLine.includes('256.0')) {
      violations.add(`${material.name}:noise-scale-mismatch`)
    }
    if (!TREE_DISCOLOURATION_VARYING.test(fragment)) {
      violations.add(`${material.name}:fragment-missing-varying`)
    }
    if (TREE_DISCOLOURATION_FACTOR.test(fragment)) {
      violations.add(`${material.name}:fragment-uses-factor`)
    }
  }
  const violationList = [...violations]
  record(
    'tree discolouration: factor only inside vertex noise formula',
    violationList.length === 0,
    violationList.length ? violationList.slice(0, 6).join(', ') : `tree materials=${scoped.length}`,
  )

  return results
}

/* --------------------------- uniform 覆盖审计 --------------------------- */

const UNIFORM_DECLARATION = /\buniform\s+(?:lowp\s+|mediump\s+|highp\s+)?\w+\s+(\w+)\s*(\[[^\]]*\])?\s*;/g

/** Shader 源码里声明的 uniform 名（用于对照 JS 侧 uniform 表）。 */
export function collectUniformDeclarations(shaderSource: string): string[] {
  const names: string[] = []
  for (const match of stripGlslComments(shaderSource).matchAll(UNIFORM_DECLARATION)) {
    if (match[1]) {
      names.push(match[1])
    }
  }
  return names
}

export interface MaterialUniformCheckInput {
  name: string
  vertexShader: string
  fragmentShader: string
  uniformKeys: readonly string[]
}

/**
 * 材质 uniform 覆盖检查：着色器里声明的每个 uniform 都必须在 JS uniform 表里，
 * 否则 three 不会上传它（运行时恒为 0/空）——「地面过暗」就是这类静默故障。
 */
export function runMaterialUniformCoverageChecks(
  materials: MaterialUniformCheckInput[],
): SlowroadsSelfCheckResult[] {
  const { results, record } = createRecorder()

  const violations = new Set<string>()
  for (const material of materials) {
    const provided = new Set(material.uniformKeys)
    const declared = new Set([
      ...collectUniformDeclarations(material.vertexShader),
      ...collectUniformDeclarations(material.fragmentShader),
    ])
    for (const name of declared) {
      if (!provided.has(name)) {
        violations.add(`${material.name}:${name}`)
      }
    }
  }
  const violationList = [...violations]
  record(
    'landscape material uniforms covered',
    violationList.length === 0,
    violationList.length ? `missing ${violationList.slice(0, 8).join(', ')}` : `materials=${materials.length}`,
  )

  return results
}
