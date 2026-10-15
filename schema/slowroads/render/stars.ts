import * as THREE from 'three'
import type { EnvironmentPreset } from '../core/environment'
import { bindSlowroadsSkyFogUniforms, slowroadsFogInjectionSource } from './fogInjection'

/**
 * slowroads 星空（官方实现逐段移植）。夜晴专属；4000 点分 2 组按 density 显隐。
 *
 * 关键坑（lab 实测）：① 材质必须开启雾（注入的 color_fragment 读取 fogColorB，
 * 若 USE_FOG 相关文本被剥离会整体编译失败）；② three 会把 `Group.renderOrder`
 * 作为子对象排序的 `groupOrder`（第一排序键），官方在容器上设 -2 依赖其天空的
 * 更低 groupOrder；这里容器归 0，让星星按 renderOrder -5 排在天空(-10)/云(-9)
 * 之后绘制，否则会被不透明天空整片覆盖。
 */

const VERTEX_PARS = /* glsl */ `
    attribute float glow;

    varying float vGlow;
    varying float vStarHeight;
`

const VERTEX_BODY = /* glsl */ `
    vGlow = glow;
    vStarHeight = position.y;
`

const FRAGMENT_PARS = /* glsl */ `
    varying float vGlow;
    varying float vStarHeight;

    uniform float horizonOpacity;
    uniform float horizonOffset;
    uniform float horizonScale;
`

const COLOR_FRAGMENT = /* glsl */ `

// 官方星点是方形点精灵（size<1px 时看不出来）；尺寸提到 1~2 物理像素后方形边角会显脏，
// 这里按点坐标裁成圆点，观感更接近真实星点。
if (length(gl_PointCoord - vec2(0.5)) > 0.5) {
    discard;
}

diffuseColor.rgb = vec3(
    min(1.0, fogColorB.r + vGlow),
    min(1.0, fogColorB.g + vGlow),
    min(1.0, fogColorB.b + vGlow)
);

`

const FOG_FRAGMENT_STARS = /* glsl */ `
    float starFogBlend = max(horizonOpacity, min((vStarHeight - horizonOffset) / max(0.0001, horizonScale), 1.0));
    gl_FragColor.rgb = mix(fogColorA, gl_FragColor.rgb, starFogBlend);
`

export interface SlowroadsStarsHandle {
  container: THREE.Group
  /** null = 隐藏（白天/阴天）。 */
  setConfig(config: EnvironmentPreset['stars'] | null): void
  /** 星点世界尺寸（用 `resolveStarSize(viewportHeightPx, pixelRatio)` 计算）。 */
  setSize(size: number): void
  update(cameraWorldPosition: THREE.Vector3): void
  dispose(): void
}

const STAR_COUNT = 4000
const STAR_DENSITIES = 2
const STAR_RADIUS = 10

/**
 * 官方 size=0.01（约 1 物理像素）。2× 降采样截图里 1px 星点不可见，
 * 这里放大 4× 仅用于可见性；迁移端可按需恢复 0.01。
 */
/**
 * 官方 size=0.01（约 1 物理像素）；对齐官方后夜晴星空在 dpr=1 下与线上一致，
 * 截图链路若做 2× 降采样会看不到星点（与官方同条件表现相同）。
 */
const STAR_TARGET_PIXELS = 1.0
/** 视口尺寸未知时的回退值（官方尺寸）。 */
const STAR_SIZE_FALLBACK = 0.01

/**
 * 由视口（**绘制缓冲**）高度与像素比反解星点世界尺寸。
 *
 * 官方 `size = 0.01` 是**世界尺寸**：three 在 `sizeAttenuation` 下按
 * `gl_PointSize = size · pixelRatio · (drawingBufferHeight / 2) / depth` 换算，
 * 因此 4K 画布上约 1 物理像素，而 dpr=1、高度 800 上下的编辑器视口只有 ~0.4
 * 物理像素 —— 再经 EffectComposer 的 FXAA 基本被抹平（用户实测"看不清/太小"）。
 * 这里按视口高度反解，让星点在 `STAR_RADIUS` 参考深度上约 `STAR_TARGET_PIXELS`
 * 物理像素（1.0 = 官方注释里"约 1 物理像素"的原始意图；用户实测 2.2 仍偏大）。
 */
export function resolveStarSize(
  viewportHeightPx: number,
  pixelRatio = 1,
  targetPixels = STAR_TARGET_PIXELS,
): number {
  if (!Number.isFinite(viewportHeightPx) || viewportHeightPx <= 0) {
    return STAR_SIZE_FALLBACK
  }
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1
  const target = Number.isFinite(targetPixels) && targetPixels > 0 ? targetPixels : STAR_TARGET_PIXELS
  const size = (target * STAR_RADIUS) / ((viewportHeightPx / 2) * ratio)
  return Math.min(Math.max(size, 0.005), 0.12)
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

export function createSlowroadsStars(): SlowroadsStarsHandle {
  const container = new THREE.Group()
  container.name = 'slowroads-stars'
  container.renderOrder = 0

  const uniforms = {
    horizonOpacity: { value: 1 },
    horizonOffset: { value: 0 },
    horizonScale: { value: 4 },
  }
  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: STAR_SIZE_FALLBACK,
    forceSinglePass: true,
    depthTest: false,
    fog: true,
  })
  material.name = 'slowroads-stars-material'
  material.customProgramCacheKey = () => 'sr-stars-v1'
  material.onBeforeCompile = (shader) => {
    // 注意：官方 patch 的 color_fragment 会读取 fogColorB，因此材质必须 fog:true
    // 且雾体注入必须成功，否则片元编译失败（fogColorB 未声明）。
    // 第五批起星空绑「天空组」：星空只消费 fogColorA/B，两组颜色一致，观感不变。
    bindSlowroadsSkyFogUniforms(shader.uniforms)
    shader.uniforms.horizonOpacity = uniforms.horizonOpacity
    shader.uniforms.horizonOffset = uniforms.horizonOffset
    shader.uniforms.horizonScale = uniforms.horizonScale
    const fog = slowroadsFogInjectionSource()
    shader.vertexShader = shader.vertexShader
      .replace('#include <fog_pars_vertex>', `${fog.vertexPars}\n${VERTEX_PARS}`)
      .replace('#include <fog_vertex>', fog.vertexBody)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`)
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <fog_pars_fragment>',
        fog.displaySpaceEnabled ? fog.displayFragmentPars : fog.fragmentPars,
      )
      .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', COLOR_FRAGMENT)
      .replace(
        '#include <fog_fragment>',
        fog.displaySpaceEnabled
          ? `${fog.displayFragmentBody}\n${FOG_FRAGMENT_STARS}\n${fog.displayFragmentEpilogue}`
          : `${fog.fragmentBody}\n${FOG_FRAGMENT_STARS}`,
      )
  }

  const meshes: THREE.Points[] = []
  const perMesh = STAR_COUNT / STAR_DENSITIES
  const random = createSeededRandom(101)
  for (let m = 0; m < STAR_DENSITIES; m += 1) {
    const positions = new Float32Array((perMesh + 1) * 3)
    const glows = new Float32Array(perMesh + 1)
    for (let i = 0; i <= perMesh; i += 1) {
      const theta = random() * Math.PI * 2
      const zAxis = random() * 2 - 1
      const ring = Math.sqrt(Math.max(0, 1 - zAxis * zAxis))
      positions[i * 3] = Math.cos(theta) * ring * STAR_RADIUS
      positions[i * 3 + 1] = Math.abs(zAxis) * STAR_RADIUS
      positions[i * 3 + 2] = Math.sin(theta) * ring * STAR_RADIUS
      let glow = random()
      if (glow > 0.75 && random() > 0.2) {
        glow /= 2
      }
      glows[i] = glow * glow
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('glow', new THREE.BufferAttribute(glows, 1))
    const points = new THREE.Points(geometry, material)
    points.name = `slowroads-stars-${m}`
    points.renderOrder = -5
    points.frustumCulled = false
    points.visible = false
    meshes.push(points)
    container.add(points)
  }

  let enabled = false

  return {
    container,
    setConfig(config: EnvironmentPreset['stars'] | null): void {
      enabled = Boolean(config)
      for (let i = 0; i < meshes.length; i += 1) {
        meshes[i]!.visible = Boolean(config) && i < config!.density
      }
      if (config) {
        uniforms.horizonOpacity.value = config.horizonOpacity
        uniforms.horizonOffset.value = config.horizonOffset
        uniforms.horizonScale.value = config.horizonScale
      }
      container.visible = enabled
    },
    setSize(size: number): void {
      const next = Number.isFinite(size) && size > 0 ? size : STAR_SIZE_FALLBACK
      if (material.size !== next) {
        material.size = next
      }
    },
    update(cameraWorldPosition: THREE.Vector3): void {
      container.position.copy(cameraWorldPosition)
    },
    dispose(): void {
      container.removeFromParent()
      for (const points of meshes) {
        points.geometry.dispose()
      }
      material.dispose()
    },
  }
}
