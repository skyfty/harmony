import * as THREE from 'three'
import type { EnvironmentPreset } from '../core/environment'
import { bindSlowroadsFogUniforms } from './fogPatch'

/**
 * slowroads 星空（官方实现逐段移植）。
 *
 * 官方用带 `glow` 属性的 Points（半球随机方向 × 半径 10），把 4000 个点分到
 * density 组 mesh；片元把颜色设为 `min(1, fogColorB + vGlow)`（即夜空底色 +
 * 星点亮度），再按星点高度（vStarHeight）用 horizonOpacity/Offset/Scale 与
 * fogColorA 混合；容器每帧跟随相机。夜晴时随预设 density 显示。
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

// Apply fog according to angle but only far fog?
diffuseColor.rgb = vec3(
    min(1.0, fogColorB.r + vGlow),
    min(1.0, fogColorB.g + vGlow),
    min(1.0, fogColorB.b + vGlow)
);

`

const FOG_FRAGMENT = /* glsl */ `

#ifdef USE_FOG

	#ifdef FOG_EXP2

		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );

	#else

		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );

	#endif


    // fogBlend to be 1 when looking up, 0 at horizon
    float fogBlend = max(horizonOpacity, min((vStarHeight - horizonOffset)/horizonScale, 1.0));

	gl_FragColor.rgb = mix(fogColorA, gl_FragColor.rgb, fogBlend );

#endif

`

export interface StarsHandle {
  container: THREE.Group
  /** null = 隐藏（白天/阴天）。 */
  setConfig(config: EnvironmentPreset['stars'] | null): void
  update(cameraWorldPosition: THREE.Vector3): void
  dispose(): void
}

const STAR_COUNT = 4000
const STAR_DENSITIES = 2
const STAR_RADIUS = 10

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

export function createStars(): StarsHandle {
  const container = new THREE.Group()
  container.name = 'slowroads-stars'
  // 官方在容器上设 renderOrder=-2（他们的天空挂在更低 groupOrder 的容器里）。
  // lab 的天空是独立 mesh（groupOrder 0、renderOrder -10），若保留 -2 会把星星
  // 的 groupOrder 拉到 -2，排在不透明天空之前绘制、被天空整片覆盖——因此这里
  // 归 0，让星星按 renderOrder -5 排在天空(-10)/云(-9)之后、地形(0)之前。
  container.renderOrder = 0

  const uniforms = {
    horizonOpacity: { value: 1 },
    horizonOffset: { value: 0 },
    horizonScale: { value: 4 },
  }
  // 官方 size=0.01（约 1 物理像素）。lab 截图链路会 2× 降采样，1px 星点在
  // 截图里不可见；这里放大 4× 仅用于 lab 可见性，迁移端可恢复 0.01。
  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.04,
    forceSinglePass: true,
    depthTest: false,
    fog: true,
  })
  material.name = 'slowroads-stars-material'
  material.customProgramCacheKey = () => 'stars'
  material.onBeforeCompile = (shader) => {
    // 注意：官方 patch 的 color_fragment 会读取 fogColorB，因此材质必须 fog:true
    // 且场景必须挂雾（USE_FOG），否则片元编译失败（fogColorB 未声明）。
    bindSlowroadsFogUniforms(shader.uniforms)
    shader.uniforms.horizonOpacity = uniforms.horizonOpacity
    shader.uniforms.horizonOffset = uniforms.horizonOffset
    shader.uniforms.horizonScale = uniforms.horizonScale
    shader.vertexShader = shader.vertexShader.replace('#include <fog_pars_vertex>', `#include <fog_pars_vertex>\n${VERTEX_PARS}`)
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${FRAGMENT_PARS}`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', COLOR_FRAGMENT)
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', FOG_FRAGMENT)
  }

  const meshes: THREE.Points[] = []
  const perMesh = STAR_COUNT / STAR_DENSITIES
  const random = createSeededRandom(101)
  for (let m = 0; m < STAR_DENSITIES; m += 1) {
    const positions = new Float32Array((perMesh + 1) * 3)
    const glows = new Float32Array(perMesh + 1)
    for (let i = 0; i <= perMesh; i += 1) {
      // 官方 randomDirection() × radius，y<0 翻到上半球（星空只出现在上方）。
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
