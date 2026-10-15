/**
 * 显示空间等价雾注入回归测试（e01 天空对比修复）。
 *
 * 编辑器视口经 EffectComposer（RenderPass → … → OutputPass）出图，场景 pass
 * 写入 render target 时 three 关闭色调映射，Cineon/sRGB 延后到 OutputPass。
 * 官方/lab 的雾混色发生在显示空间（tonemapping → colorspace → fog），线性域
 * 混色只能对齐 `blend = 0 / 1` 两个端点，天空平面的 `2·sinθ > 1` 外推段会把
 * R/G 压到 0（天顶异常深蓝）。
 *
 * 这里断言注入文本：模式开启时片元体必须是「显示空间编码 → 官方混色公式 →
 * 尾体写回线性域」，且追加片元体（云层/星空）夹在混色与尾体之间。
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  injectSlowroadsFog,
  injectSlowroadsFogFragmentSequence,
  resolveHazeForCamera,
  setSlowroadsFogDisplaySpaceMode,
  slowroadsCineonCore,
  slowroadsCineonCoreInverse,
  slowroadsDisplayToTargetLinear,
} from '@schema/slowroads/render/fogInjection'
import { resolveSkyPlaneScale } from '@schema/slowroads/render/sky'
import { createSlowroadsStars, resolveStarSize } from '@schema/slowroads/render/stars'
import {
  ENVIRONMENT_PRESETS,
  ENVIRONMENT_SKY_DISTANCE,
  ENVIRONMENT_VIEW_DISTANCE,
  resolveFogParams,
} from '@schema/slowroads/core/environment'
import { runSlowroadsHazeInterpolationChecks } from '@schema/slowroads/render/selfCheck'

interface PatchedShader {
  uniforms: Record<string, THREE.IUniform>
  vertexShader: string
  fragmentShader: string
}

function basicShader(): PatchedShader {
  return {
    uniforms: {},
    vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader,
  }
}

afterEach(() => {
  setSlowroadsFogDisplaySpaceMode(false)
})

describe('display-space fog injection', () => {
  it('direct canvas path keeps the lab-parity bodies (no epilogue)', () => {
    const shader = basicShader()
    expect(injectSlowroadsFog(shader)).toBe(true)
    expect(shader.fragmentShader).not.toContain('#include <fog_fragment>')
    expect(shader.fragmentShader).toContain('gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(fogColorA, fogColorB')
    expect(shader.fragmentShader).not.toContain('srFogDisplayToTargetLinear')
    expect(shader.uniforms.srDisplayExposure).toBeTruthy()
  })

  it('deferred path encodes to display space, mixes like the official, then writes back', () => {
    setSlowroadsFogDisplaySpaceMode(true)
    const shader = basicShader()
    expect(injectSlowroadsFog(shader)).toBe(true)
    expect(shader.fragmentShader).toContain('srFogDisplayFromToneMapped')
    expect(shader.fragmentShader).toContain('uniform float srDisplayExposure;')
    const bodyIndex = shader.fragmentShader.indexOf('srFogDisplayFromToneMapped( gl_FragColor.rgb )') >= 0
      ? shader.fragmentShader.indexOf('srFogDisplayFromToneMapped( gl_FragColor.rgb )')
      : shader.fragmentShader.indexOf('srFogDisplayFromToneMapped(gl_FragColor.rgb)')
    const epilogueIndex = shader.fragmentShader.lastIndexOf('srFogDisplayToTargetLinear(gl_FragColor.rgb)')
    expect(bodyIndex).toBeGreaterThanOrEqual(0)
    expect(epilogueIndex).toBeGreaterThan(bodyIndex)
    // 混色公式必须与官方逐字一致（含 > 1 外推，不夹紧）。
    expect(shader.fragmentShader).toContain('* 2.0) / max(0.001, distance(vFogPos, cameraPosition)), 0.0) * vFogBlend')
  })

  it('keeps appended fragment bodies (clouds / stars) between mixing and the epilogue', () => {
    setSlowroadsFogDisplaySpaceMode(true)
    const shader = basicShader()
    expect(
      injectSlowroadsFogFragmentSequence(shader, {
        group: 'sky',
        body: 'sky',
        append: 'float cloudFogBlend = 1.0;',
      }),
    ).toBe(true)
    const mixing = shader.fragmentShader.indexOf('srSkyBlend')
    const appended = shader.fragmentShader.indexOf('cloudFogBlend')
    const epilogue = shader.fragmentShader.lastIndexOf('srFogDisplayToTargetLinear(gl_FragColor.rgb)')
    expect(mixing).toBeGreaterThanOrEqual(0)
    expect(appended).toBeGreaterThan(mixing)
    expect(epilogue).toBeGreaterThan(appended)
  })

  it('uses the colorspace-only base encoding for materials without tone mapping (water)', () => {
    setSlowroadsFogDisplaySpaceMode(true)
    const shader = basicShader()
    expect(injectSlowroadsFog(shader, { base: 'color-space' })).toBe(true)
    expect(shader.fragmentShader).toContain('srFogDisplayFromColorSpaceOnly(gl_FragColor.rgb)')
    expect(shader.fragmentShader).not.toContain('srFogDisplayFromToneMapped(gl_FragColor.rgb)')
  })

  it('analytic Cineon inverse matches the bisection inverse of the core curve', () => {
    for (const display of [0.02, 0.2, 0.5, 0.75, 0.9, 0.95]) {
      const solved = slowroadsCineonCoreInverse(display)
      // 解析解反的是「去掉 0.004 偏移后」的理性曲线；three 的 Cineon 在入口做
      // `max(0, x - 0.004)`，因此还原时要补回偏移（尾体也是这么做的）。
      expect(slowroadsCineonCore(solved + 0.004)).toBeCloseTo(display, 5)
    }
    // 高亮段（显示分量 > core(4)）也必须给出有限值，且经 OutputPass 还原回显示色。
    const restored = (() => {
      const linear = slowroadsDisplayToTargetLinear(0.99, 1)
      return Math.pow(slowroadsCineonCore(linear), 2.2)
    })()
    expect(Number.isFinite(restored)).toBe(true)
    expect(restored).toBeGreaterThan(0.97)
  })

  it('sky plane scale keeps the official coverage angle for large view distances', () => {
    expect(resolveSkyPlaneScale(ENVIRONMENT_SKY_DISTANCE)).toBeCloseTo(1, 9)
    // 7.54× 视距倍率（29km 地形自动档）与 12×（上限）。
    for (const scale of [7.54, 12]) {
      const distance = ENVIRONMENT_SKY_DISTANCE * scale
      const geometryScale = resolveSkyPlaneScale(distance)
      expect(geometryScale).toBeCloseTo(scale, 6)
      const coverage = Math.atan((5e4 * geometryScale) / distance)
      const official = Math.atan(5e4 / ENVIRONMENT_SKY_DISTANCE)
      expect(coverage).toBeGreaterThanOrEqual(official - 1e-4)
    }
  })
})

describe('haze interpolation robustness (autumn/morning low-camera red sky)', () => {
  it('keeps fog far positive and beyond near when the camera drops below the layer base', () => {
    const preset = ENVIRONMENT_PRESETS.autumn.morning.clear
    const base = resolveFogParams(preset, ENVIRONMENT_VIEW_DISTANCE)
    for (const cameraY of [-400, -80, -35, -1, 0, 20, 79, 120]) {
      const resolved = resolveHazeForCamera(base, cameraY, { inHaze: false })
      expect(resolved.far, `cameraY=${cameraY}`).toBeGreaterThan(0)
      expect(resolved.far, `cameraY=${cameraY}`).toBeGreaterThan(resolved.near)
      expect(resolved.density, `cameraY=${cameraY}`).toBeGreaterThan(0)
    }
    // 回归防护：官方公式（e 不夹紧）在 cameraY < 0 时会让 far 反号——
    // 片元 max(0.001, fogFar - fogNear) 由此把 vFogDepth 压成 0，天空平面
    // 顶点 vHaze 的巨值外推不再被 A/B 混色遮住，整片变红。
    const e = Math.pow(1 - -40 / preset.fog.hazeHeight, 2)
    const officialFar = base.far * (1 - e * Math.min(0.9, preset.fog.hazeIntensity))
    expect(officialFar).toBeLessThan(0)
  })

  it('self check covers 32 presets x sky/scene scales x camera heights', () => {
    const results = runSlowroadsHazeInterpolationChecks()
    expect(results.filter((result) => !result.ok).map((result) => `${result.name}:${result.detail}`)).toEqual([])
  })
})

describe('star size (viewport-aware visibility)', () => {
  it('resolves to the target physical pixel size across viewports and dpr', () => {
    for (const [height, dpr] of [[784, 1], [838, 1], [1440, 2], [2160, 1]] as const) {
      const size = resolveStarSize(height, dpr)
      // three: gl_PointSize = size · pixelRatio · (drawingBufferHeight / 2) / depth
      const pointSize = (size * dpr * (height / 2)) / 10
      expect(pointSize, `height=${height} dpr=${dpr}`).toBeCloseTo(1.0, 6)
    }
  })

  it('supports a custom target for the editor FXAA compensation', () => {
    const height = 784
    const size = resolveStarSize(height, 1, 1.6)
    const pointSize = size * 1 * (height / 2) / 10
    expect(pointSize).toBeCloseTo(1.6, 6)
    // 4K 画布上补偿值只比官方 0.01 略大（≈0.0148），不会变成"方块雪点"
    expect(resolveStarSize(2160, 1, 1.6)).toBeLessThan(0.016)
  })

  it('falls back to the official size and clamps degenerate viewports', () => {
    expect(resolveStarSize(Number.NaN)).toBe(0.01)
    expect(resolveStarSize(0)).toBe(0.01)
    expect(resolveStarSize(-100)).toBe(0.01)
    // 极小视口不会解出巨值（clamp 上限），极大视口不会解出不可见值（下限）。
    expect(resolveStarSize(1)).toBe(0.12)
    expect(resolveStarSize(1e6)).toBe(0.005)
  })

  it('discards point-sprite corners so enlarged stars stay round, and applies setSize', () => {
    const stars = createSlowroadsStars()
    const points = stars.container.children[0] as THREE.Points
    const material = points.material as THREE.PointsMaterial
    const parameters = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.points.vertexShader,
      fragmentShader: THREE.ShaderLib.points.fragmentShader,
    } as unknown as Parameters<typeof material.onBeforeCompile>[0]
    material.onBeforeCompile(parameters, undefined as never)
    expect(parameters.fragmentShader).toContain('gl_PointCoord')
    expect(parameters.fragmentShader).toContain('discard')
    stars.setSize(0.05)
    expect(material.size).toBeCloseTo(0.05, 6)
    stars.setSize(Number.NaN)
    expect(material.size).toBeCloseTo(0.01, 6)
    stars.dispose()
  })
})
