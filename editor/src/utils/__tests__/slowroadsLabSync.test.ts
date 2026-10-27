/**
 * Slow Roads lab → 迁移端同步回归（第一~六批 + 补充层）。
 *
 * 覆盖：树卡变色乘数语义（冬季不再发紫）、雾色输出色空间 / 编辑器反 Cineon
 * 预补偿、天空 2000 尺度不变量、季节表（alphaTest/色彩空间/区域表）、
 * 新 props（canopy/water/barrier/wind/近树半径/花草）默认值与夹紧、
 * 高度带归一化与雾尺度自适应。
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  FOG_COLOR_SPACE_REFERENCE,
  resolveTreeDiscolouration,
  runSlowroadsEnvironmentChecks,
  runSlowroadsFogColorSpaceChecks,
  runSlowroadsSeasonChecks,
  scanTreeDiscolourationRange,
} from '@schema/slowroads/render/selfCheck'
import {
  ENVIRONMENT_PRESETS,
  resolveCameraFarForFogDistance,
  resolveFogDepthBlend,
  resolveFogParams,
  resolveSkyFogParams,
} from '@schema/slowroads/core/environment'
import { SEASON_PARAMS } from '@schema/slowroads/core/seasonParams'
import { SEASON_CATALOG } from '@schema/slowroads/core/seasonCatalog'
import {
  clampProceduralLandscapeProps,
  cloneProceduralLandscapeProps,
  createDefaultProceduralLandscapeProps,
  resolveSurfaceHeightScale,
  resolveSurfaceViewDistanceScale,
} from '@schema/proceduralLandscape/config'
import {
  collectProceduralLandscapeSurfaceMeshes,
  isProceduralLandscapeArtifact,
} from '@schema/proceduralLandscape/runtime'
import { COMPONENT_ARTIFACT_KEY } from '@schema/components'
import { slowroadsDeferredDisplayChannel } from '@schema/slowroads/render/fogInjection'

/** hex → sRGB 显示分量（与 `Color.getRGB(..., SRGBColorSpace)` 同值）。 */
function srgbHexComponents(hex: string): [number, number, number] {
  const color = new THREE.Color().set(hex)
  color.getRGB(color, THREE.SRGBColorSpace)
  return [color.r, color.g, color.b]
}

/** 一整套预设雾色的显示分量（两条管线都按 lab 语义下发这一组值）。 */
function displayComponents(preset: {
  fog: { colA: string; colB: string; colC: string | null }
}) {
  const set = (hex: string): THREE.Color => {
    const color = new THREE.Color().set(hex)
    color.getRGB(color, THREE.SRGBColorSpace)
    return color
  }
  return {
    colA: set(preset.fog.colA),
    colB: set(preset.fog.colB),
    colC: set(preset.fog.colC ?? preset.fog.colB),
  }
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
}

function srgbEncode(value: number): number {
  const v = Math.min(Math.max(value, 0), 1)
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

describe('tree discolouration semantics (batch 6)', () => {
  it('is a noise amplitude: multiplier range = 1 ± factor / 2', () => {
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      const factor = SEASON_PARAMS[season].treeDiscolouration
      const range = scanTreeDiscolourationRange(factor)
      expect(range.min).toBeCloseTo(1 - factor / 2, 6)
      expect(range.max).toBeCloseTo(1 + factor / 2, 6)
    }
  })

  it('keeps winter multipliers inside 0.9..1.1 (no green-channel crush)', () => {
    const range = scanTreeDiscolourationRange(SEASON_PARAMS.winter.treeDiscolouration)
    expect(range.min).toBeGreaterThanOrEqual(0.9 - 1e-9)
    expect(range.max).toBeLessThanOrEqual(1.1 + 1e-9)
    // 把幅度当乘数（旧缺陷）会得到 0.2：断言两者语义不同。
    expect(resolveTreeDiscolouration(0.5, 0.2)).toBe(1)
    expect(range.min).toBeGreaterThan(SEASON_PARAMS.winter.treeDiscolouration)
  })

  it('applies the cypress-column fallback (×0.5 + 0.5)', () => {
    expect(resolveTreeDiscolouration(0, 1, { cypress: true })).toBeCloseTo(0.75, 6)
    expect(resolveTreeDiscolouration(0, 1, { cypress: false })).toBeCloseTo(0.5, 6)
  })
})

describe('fog color space (batch 4) and editor display-space emulation', () => {
  it('reference conversion: #E496AD output vs linear components', () => {
    const converted = new THREE.Color().set(FOG_COLOR_SPACE_REFERENCE.hex)
    converted.getRGB(converted, THREE.SRGBColorSpace)
    expect(converted.r).toBeCloseTo(FOG_COLOR_SPACE_REFERENCE.srgb[0], 3)
    expect(converted.g).toBeCloseTo(FOG_COLOR_SPACE_REFERENCE.srgb[1], 3)
    expect(converted.b).toBeCloseTo(FOG_COLOR_SPACE_REFERENCE.srgb[2], 3)
    const linear = new THREE.Color().set(FOG_COLOR_SPACE_REFERENCE.hex)
    expect(Math.abs(linear.r - FOG_COLOR_SPACE_REFERENCE.srgb[0])).toBeGreaterThan(0.02)
  })

  it('direct-canvas checks pass when uniforms carry output color space components', () => {
    const preset = ENVIRONMENT_PRESETS.spring.morning.clear
    const colors = displayComponents(preset)
    const results = runSlowroadsFogColorSpaceChecks({
      preset,
      uniformColors: colors,
      deferredToneMapping: false,
    })
    expect(results.every((result) => result.ok)).toBe(true)
  })

  it('deferred (composer) checks require the display-space emulation', () => {
    const preset = ENVIRONMENT_PRESETS.spring.morning.clear
    const passing = runSlowroadsFogColorSpaceChecks({
      preset,
      uniformColors: displayComponents(preset),
      deferredToneMapping: true,
      displaySpaceFog: true,
      toneMappingExposure: 1,
    })
    expect(passing.every((result) => result.ok)).toBe(true)

    // 关掉显示空间注入（退回线性域混色）必须当场失败。
    const failing = runSlowroadsFogColorSpaceChecks({
      preset,
      uniformColors: displayComponents(preset),
      deferredToneMapping: true,
      displaySpaceFog: false,
      toneMappingExposure: 1,
    })
    expect(failing.some((result) => !result.ok)).toBe(true)
  })

  it('display-space emulation matches lab mixing for all 32 presets (incl. blend > 1)', () => {
    const blends = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]
    const tolerance = 1 / 255 + 1e-6
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      for (const timeOfDay of ['morning', 'day', 'evening', 'night'] as const) {
        for (const weather of ['clear', 'overcast'] as const) {
          const preset = ENVIRONMENT_PRESETS[season][timeOfDay][weather]
          const colA = srgbHexComponents(preset.fog.colA)
          const colB = srgbHexComponents(preset.fog.colB)
          for (const blend of blends) {
            for (let channel = 0; channel < 3; channel += 1) {
              // lab/官方：显示空间线性混色（允许 > 1 外推，最终由画布钳制）。
              const display = Math.min(Math.max(colA[channel]! + (colB[channel]! - colA[channel]!) * blend, 0), 1)
              // 编辑器：显示空间等价注入 + OutputPass 还原。
              const emulated = slowroadsDeferredDisplayChannel(display, 1)
              expect(
                Math.abs(emulated - display),
                `${season}/${timeOfDay}/${weather} blend=${blend} ch=${channel}`,
              ).toBeLessThanOrEqual(tolerance)
            }
          }
        }
      }
    }
  })

  it('legacy linear-domain inverse-Cineon precompensation is out of tolerance (regression guard)', () => {
    // 旧实现：uniform = core⁻¹(线性分量)，混色后 OutputPass 再跑 core + sRGB。
    const core = (value: number): number => {
      const x = Math.max(0, value - 0.004)
      return (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06)
    }
    const coreInverse = (value: number): number => {
      let low = 0
      let high = 4
      for (let i = 0; i < 40; i += 1) {
        const mid = (low + high) * 0.5
        if (core(mid) < value) low = mid
        else high = mid
      }
      return (low + high) * 0.5
    }
    const preset = ENVIRONMENT_PRESETS.spring.day.clear
    const linearA = srgbHexComponents(preset.fog.colA).map(srgbToLinear)
    const linearB = srgbHexComponents(preset.fog.colB).map(srgbToLinear)
    const legacyDisplay = (blend: number, channel: number): number => {
      const uniformA = coreInverse(linearA[channel]!)
      const uniformB = coreInverse(linearB[channel]!)
      return srgbEncode(core(uniformA + (uniformB - uniformA) * blend))
    }
    const colA = srgbHexComponents(preset.fog.colA)
    const colB = srgbHexComponents(preset.fog.colB)
    // 旧实现的中段偏亮（blend 0.5 时 R 偏亮 ~0.10）与 >1 外推塌陷（blend 1.5 时 G 归零）。
    for (const [blend, channel] of [[0.5, 0], [1.5, 1], [2, 1]] as const) {
      const lab = Math.min(Math.max(colA[channel]! + (colB[channel]! - colA[channel]!) * blend, 0), 1)
      expect(Math.abs(legacyDisplay(blend, channel) - lab)).toBeGreaterThan(1 / 255)
    }
  })
})

describe('environment / season self checks', () => {
  it('environment presets, sky scale and blend invariants all pass', () => {
    const results = runSlowroadsEnvironmentChecks()
    const failed = results.filter((result) => !result.ok)
    expect(failed.map((result) => `${result.name}:${result.detail}`)).toEqual([])
  })

  it('spring/morning/clear keeps official sky blend (1.0) and scene blend (0.7778)', () => {
    const preset = ENVIRONMENT_PRESETS.spring.morning.clear
    const scene = resolveFogParams(preset)
    const sky = resolveSkyFogParams(preset)
    expect(resolveFogDepthBlend(sky.near, sky.far)).toBeCloseTo(1, 6)
    expect(resolveFogDepthBlend(scene.near, scene.far)).toBeCloseTo(7.7778e-1, 4)
    expect(sky.far).toBeCloseTo(scene.far * 2, 6)
  })

  it('season catalog checks pass (slots, colour spaces, alpha tests, discolouration)', () => {
    const results = runSlowroadsSeasonChecks()
    const failed = results.filter((result) => !result.ok)
    expect(failed.map((result) => `${result.name}:${result.detail}`)).toEqual([])
  })

  it('winter alpha test table matches official presets (.2/.3/.5)', () => {
    expect(SEASON_PARAMS.winter.grassAlphaTest).toBe(0.2)
    expect(SEASON_PARAMS.winter.bushAlphaTest).toBe(0.3)
    expect(SEASON_PARAMS.winter.imposterAlphaTest).toBe(0.5)
    expect(SEASON_PARAMS.spring.grassAlphaTest).toBe(0.5)
  })

  it('batch 1 colour spaces: grass fibre / conifer alpha srgb, clouds srgb-linear', () => {
    expect(SEASON_CATALOG.spring.surface.grass.colorSpace).toBe('srgb')
    expect(SEASON_CATALOG.winter.surface.grass.colorSpace).toBe('srgb')
    expect(SEASON_CATALOG.spring.trees.coniferA.colorSpace).toBe('srgb')
  })
})

describe('procedural landscape props (full refactor)', () => {
  it('defaults follow lab DEFAULT_LAB_SETTINGS', () => {
    const props = createDefaultProceduralLandscapeProps({ id: 't' })
    expect(props.road.width).toBe(7)
    expect(props.road.flattenBand).toBe(10)
    expect(props.grass.corridorWidth).toBe(20)
    expect(props.bushes.density).toBe(0.6)
    // 路侧墙体（官方 WallController 四类）默认全开，石墙密度 = 官方地块概率（1.0）。
    expect(props.walls.drystone.enabled).toBe(true)
    expect(props.walls.drystone.density).toBe(1)
    expect(props.walls.fence.enabled).toBe(true)
    expect(props.walls.barrier.enabled).toBe(true)
    expect(props.walls.seaWall.enabled).toBe(true)
    expect(props.wind.enabled).toBe(true)
    expect(props.wind.strength).toBe(1)
    expect(props.canopy.enabled).toBe(true)
    expect(props.forest.enabled).toBe(true)
    expect(props.forest.nearDistance).toBe(190)
    expect(props.forest.nearTreeRadius).toBe(90)
    expect(props.forest.minScale).toBe(5)
    expect(props.forest.maxScale).toBe(12)
    expect(props.grass.flowerDensity).toBe(1)
    expect(props.grass.tallGrassDensity).toBe(1)
    expect(props.surface.textures).toBe(true)
    expect(props.surface.viewDistanceScale).toBeNull()
  })

  it('drops legacy fields and clamps the new groups', () => {
    const legacy = {
      grass: { windEnabled: false, flowerDensity: 99, tallGrassDensity: -3 },
      wind: { enabled: 'nope', strength: 12 },
      // 旧版 barrier 组（下坡落差近似）已废弃：enabled 映射到 fence/barrier/seaWall，
      // density 映射到 drystone.density，spacing/dropThreshold 一并忽略。
      barrier: { density: 0.4, spacing: 0, dropThreshold: 100 },
      water: { levelOffset: -999 },
      forest: { nearTreeRadius: 1000 },
      surface: { viewDistanceScale: 0.1 },
    } as never
    const props = clampProceduralLandscapeProps(legacy, 't')
    expect('windEnabled' in props.grass).toBe(false)
    expect(props.grass.flowerDensity).toBe(4)
    expect(props.grass.tallGrassDensity).toBe(0)
    expect(props.wind.enabled).toBe(true)
    expect(props.wind.strength).toBe(3)
    expect(props.walls.drystone.density).toBeCloseTo(0.4, 6)
    expect(props.walls.fence.enabled).toBe(true)
    expect('spacing' in props.walls.drystone).toBe(false)
    expect('dropThreshold' in props.walls.drystone).toBe(false)
    // 水线偏移夹紧放宽到 ±1000m：编辑器地形起伏可达 2000m+，
    // 旧 ±50m 无法把低地调到水面以上（水面永远被地形遮住）。
    expect(props.water.levelOffset).toBe(-999)
    expect(props.forest.nearTreeRadius).toBe(300)
    expect(props.surface.viewDistanceScale).toBe(1)
  })

  it('keeps the forest visibility switch through normalization and cloning', () => {
    const defaults = createDefaultProceduralLandscapeProps({ id: 'forest-toggle' })
    expect(clampProceduralLandscapeProps({}, 'forest-toggle').forest.enabled).toBe(true)

    const disabled = clampProceduralLandscapeProps({
      forest: { ...defaults.forest, enabled: false },
    }, 'forest-toggle')
    expect(disabled.forest.enabled).toBe(false)
    expect(cloneProceduralLandscapeProps(disabled).forest.enabled).toBe(false)
  })

  it('height-band normalization: ×4 for lab-scale relief, compressed on real terrain', () => {
    expect(resolveSurfaceHeightScale(40)).toBe(4)
    expect(resolveSurfaceHeightScale(60)).toBe(4)
    expect(resolveSurfaceHeightScale(150)).toBeCloseTo(2, 6)
    expect(resolveSurfaceHeightScale(1200)).toBeCloseTo(0.25, 6)
    expect(resolveSurfaceHeightScale(0)).toBe(4)
  })

  it('view-distance scale matches lab: extent / 3000, clamped 1..16x', () => {
    const props = createDefaultProceduralLandscapeProps({ id: 't' })
    expect(resolveSurfaceViewDistanceScale(props, 1600)).toBe(1)
    expect(resolveSurfaceViewDistanceScale(props, 3000)).toBe(1)
    expect(resolveSurfaceViewDistanceScale(props, 4000)).toBeCloseTo(4 / 3, 6)
    expect(resolveSurfaceViewDistanceScale(props, 12000)).toBe(4)
    expect(resolveSurfaceViewDistanceScale(props, 42660)).toBeCloseTo(14.22, 6)
    expect(resolveSurfaceViewDistanceScale(props, 200000)).toBe(16)
    const manual = clampProceduralLandscapeProps(
      { surface: { ...props.surface, viewDistanceScale: 4 } } as never,
      't',
    )
    expect(resolveSurfaceViewDistanceScale(manual, 200000)).toBe(4)
    const manuallyCapped = clampProceduralLandscapeProps(
      { surface: { ...props.surface, viewDistanceScale: 20 } } as never,
      't',
    )
    expect(manuallyCapped.surface.viewDistanceScale).toBe(16)
  })

  it('camera far follows the scene fog distance so fog saturates before clipping', () => {
    const base = { fallbackFar: 2000, maxFar: 30000 }
    // 环境运行时未生效（雾距 0）/无效值：退回兜底 far，小场景观感不变。
    expect(resolveCameraFarForFogDistance({ ...base, fogFar: 0 })).toBe(2000)
    expect(resolveCameraFarForFogDistance({ ...base, fogFar: Number.NaN })).toBe(2000)
    expect(resolveCameraFarForFogDistance({ ...base, fogFar: -100 })).toBe(2000)
    // 大地形示例：雾尺度 ×10.66 → 雾远端 10660m，远裁剪面 13325m（雾先收满再裁切）。
    expect(resolveCameraFarForFogDistance({ ...base, fogFar: 10660 })).toBeCloseTo(13325, 6)
    // 42.7km DEM 对齐 lab 后：场景雾远端 14220m，远裁剪面 17775m。
    expect(resolveCameraFarForFogDistance({ ...base, fogFar: 14220 })).toBeCloseTo(17775, 6)
    // 远裁剪面必须严格大于雾远端，否则又会出现硬裁切边。
    expect(resolveCameraFarForFogDistance({ ...base, fogFar: 10660 })).toBeGreaterThan(10660)
    // margin = 1 时退化为雾远端本身（仍不小于兜底 far）。
    expect(resolveCameraFarForFogDistance({ ...base, fogFar: 10660, marginFactor: 1 })).toBe(10660)
    expect(resolveCameraFarForFogDistance({ ...base, fogFar: 500, marginFactor: 1 })).toBe(2000)
    // 雾尺度上限 12×（雾远端 24km）仍在上限余量内；超限夹紧。
    expect(resolveCameraFarForFogDistance({ ...base, fogFar: 24000 })).toBe(30000)
    expect(resolveCameraFarForFogDistance({ ...base, fogFar: 40000 })).toBe(30000)
    // 小程序端兜底 1000m：无地形场景 far 仍是 1250m（≈ 现状），只有大地形才放大。
    const viewerBase = { fallbackFar: 1000, maxFar: 30000 }
    expect(resolveCameraFarForFogDistance({ ...viewerBase, fogFar: 0 })).toBe(1000)
    expect(resolveCameraFarForFogDistance({ ...viewerBase, fogFar: 1000 })).toBe(1250)
    expect(resolveCameraFarForFogDistance({ ...viewerBase, fogFar: 10660 })).toBeCloseTo(13325, 6)
  })
})

describe('surface injection target collection (自我物件保护)', () => {
  it('skips meshes whose own or any ancestor carries the artifact flag', () => {
    const host = new THREE.Group()
    // 真正的地形网格（无标记）→ 必须被收集。
    const terrain = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial())
    terrain.name = 'terrain'
    host.add(terrain)

    // 近树 3D 网格：只标容器（treeMeshManager.container），网格自身无标记。
    const nearTreeContainer = new THREE.Group()
    nearTreeContainer.name = 'slowroads-near-trees'
    nearTreeContainer.userData[COMPONENT_ARTIFACT_KEY] = true
    const nearTreeMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial(), 4)
    nearTreeMesh.name = 'slowroads-near-tree-0-0'
    nearTreeContainer.add(nearTreeMesh)
    host.add(nearTreeContainer)

    // 另一个自建层：网格自身带标记。
    const barrier = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial())
    barrier.userData[COMPONENT_ARTIFACT_KEY] = true
    host.add(barrier)

    expect(isProceduralLandscapeArtifact(nearTreeMesh)).toBe(true)
    expect(isProceduralLandscapeArtifact(terrain)).toBe(false)

    const collected = collectProceduralLandscapeSurfaceMeshes(host)
    expect(collected).toEqual([terrain])
  })
})
