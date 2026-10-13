import * as THREE from 'three'
import type { EnvironmentPreset } from '../core/environment'
import { bindSlowroadsFogUniforms, slowroadsFogInjectionSource } from './fogInjection'

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
const STAR_SIZE = 0.04

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
    size: STAR_SIZE,
    forceSinglePass: true,
    depthTest: false,
    fog: true,
  })
  material.name = 'slowroads-stars-material'
  material.customProgramCacheKey = () => 'sr-stars-v1'
  material.onBeforeCompile = (shader) => {
    bindSlowroadsFogUniforms(shader.uniforms)
    shader.uniforms.horizonOpacity = uniforms.horizonOpacity
    shader.uniforms.horizonOffset = uniforms.horizonOffset
    shader.uniforms.horizonScale = uniforms.horizonScale
    const fog = slowroadsFogInjectionSource()
    shader.vertexShader = shader.vertexShader
      .replace('#include <fog_pars_vertex>', `${fog.vertexPars}\n${VERTEX_PARS}`)
      .replace('#include <fog_vertex>', fog.vertexBody)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', fog.fragmentPars)
      .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', COLOR_FRAGMENT)
      .replace('#include <fog_fragment>', `${fog.fragmentBody}\n${FOG_FRAGMENT_STARS}`)
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
