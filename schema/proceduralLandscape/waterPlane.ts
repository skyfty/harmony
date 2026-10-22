import * as THREE from 'three'
import { SLOWROADS_SKY_COLOR } from '../slowroads/core/environment'
import { injectSlowroadsFog } from '../slowroads/render/fogInjection'
import { getSlowroadsWaterEnvironment } from '../slowroads/render/environmentRuntime'
import {
  landscapeExclusionSignature,
  type LandscapeExclusionCircle,
} from './exclusion'

/**
 * 水面平面（slowroads-lab `lab/water.ts` 移植）。
 *
 * sea_waves 双方向滚动波纹 + 菲涅尔天空色 + 太阳高光；参与场景组雾，远岸自然
 * 融进天色。迁移端差异：尺寸随地形包围盒（lab 固定世界尺寸），水线 = 地形最低点
 * + `water.levelOffset`（lab 是高度场的水位常数）；环境预设（水色 / 冻水 / 时间 /
 * 太阳高光）由环境运行时的快照通道下发（`getSlowroadsWaterEnvironment`）。
 *
 * 网格是**世界空间**的水平面（挂在场景根节点，不能挂到宿主节点下——宿主的旋转
 * 会让水面倾斜）；调用方负责 `scene.add(mesh)`。
 */

export interface WaterPlaneOptions {
  /** 平面尺寸（米）——按地形水平包围盒放宽。 */
  worldSize: number
  centerX: number
  centerZ: number
  waterLevel: number
  waves: THREE.Texture
  exclusionCircles?: ReadonlyArray<LandscapeExclusionCircle>
}

export interface WaterPlaneHandle {
  mesh: THREE.Mesh
  /** 平面世界尺寸（米）——尺寸变化需要重建；贴图/水位变化可原地更新。 */
  readonly worldSize: number
  /** 水线（世界 Y）。 */
  setWaterLevel(level: number): void
  /** 换季换水波贴图（幂等；同一贴图重复下发无副作用）。 */
  setWavesTexture(texture: THREE.Texture): void
  setExclusionCircles(circles: ReadonlyArray<LandscapeExclusionCircle>): void
  /** 每帧调用：同步环境快照（水色 / 冻水 / 时间 / 太阳高光）。 */
  update(): void
  setVisible(visible: boolean): void
  dispose(): void
}

const VERTEX_SHADER = `
#include <common>
varying vec3 vWorldPosition;
varying float vViewDistance;
#include <fog_pars_vertex>
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vec4 mvPosition = viewMatrix * worldPosition;
  vViewDistance = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const FRAGMENT_SHADER = `
uniform sampler2D uWaves;
uniform float uTime;
uniform vec3 uSkyColor;
/** 官方水面三色：base = 材料底色，body = 体色，highlight = 掠射高光。 */
uniform vec3 uBase;
uniform vec3 uBody;
uniform vec3 uHighlight;
uniform float uFresnelScale;
uniform float uFrozen;
uniform vec3 uSunDir;
varying vec3 vWorldPosition;
varying float vViewDistance;
#include <fog_pars_fragment>
void main() {
  vec2 worldUv = vWorldPosition.xz;
  vec2 uvA = worldUv / 64.0 + vec2(uTime * 0.0055, uTime * 0.0042);
  vec2 uvB = worldUv / 27.0 - vec2(uTime * 0.0091, uTime * 0.0026);
  float waveA = texture2D(uWaves, uvA).r;
  float waveB = texture2D(uWaves, uvB).r;
  float wave = waveA * 0.65 + waveB * 0.35;
  float dx = texture2D(uWaves, uvA + vec2(0.03, 0.0)).r - waveA;
  float dz = texture2D(uWaves, uvA + vec2(0.0, 0.03)).r - waveA;
  vec3 rippleNormal = normalize(vec3(-dx * 1.4, 1.0, -dz * 1.4));
  // 远处水面收敛回平面，避免远景闪烁的镜面噪声。
  float rippleFade = 1.0 - smoothstep(120.0, 520.0, vViewDistance);
  rippleFade *= 1.0 - uFrozen;
  vec3 normal = normalize(mix(vec3(0.0, 1.0, 0.0), rippleNormal, rippleFade));

  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  // 官方 lit20：seaDot = 视线与水面法线的夹角项 + 波纹扰动，再混 base/body；
  // fresnelFactor 缩放高光侧强度（保持其作为整体强度系数）。
  float seaDot = dot(viewDir, normal);
  seaDot += (wave - 0.5) * 0.6 * rippleFade;
  seaDot = clamp(seaDot, 0.0, 1.0);
  float seaDotMix = 1.0 - seaDot;
  vec3 color = mix(uBase, uBody, seaDotMix * seaDotMix);
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
  color = mix(color, uSkyColor, clamp(fresnel * uFresnelScale * 0.35, 0.0, 0.6));
  // 冬季：冻结的灰白冰面，收敛波纹与高光。
  color = mix(color, mix(vec3(0.80, 0.84, 0.87), uSkyColor, 0.35), uFrozen * 0.85);
  vec3 halfDir = normalize(uSunDir + viewDir);
  float spec = pow(max(dot(normal, halfDir), 0.0), 64.0);
  color += uHighlight * spec * 1.1 * rippleFade * uFresnelScale;
  color += vec3(wave - 0.5) * 0.045 * rippleFade;

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

function createWaterGeometry(
  worldSize: number,
  centerX: number,
  centerZ: number,
  exclusionCircles: ReadonlyArray<LandscapeExclusionCircle>,
): THREE.ShapeGeometry {
  const half = worldSize * 0.5
  const shape = new THREE.Shape()
  shape.moveTo(-half, -half)
  shape.lineTo(half, -half)
  shape.lineTo(half, half)
  shape.lineTo(-half, half)
  shape.closePath()

  for (const circle of exclusionCircles) {
    const localX = circle.centerX - centerX
    // ShapeGeometry is authored in XY, then rotated -90 degrees around X.
    // A world +Z offset therefore maps to local -Y.
    const localY = -(circle.centerZ - centerZ)
    if (
      !Number.isFinite(localX)
      || !Number.isFinite(localY)
      || !Number.isFinite(circle.radius)
      || circle.radius <= 0
      || Math.abs(localX) + circle.radius >= half
      || Math.abs(localY) + circle.radius >= half
    ) {
      continue
    }
    const hole = new THREE.Path()
    const segments = Math.max(32, Math.min(128, Math.ceil(circle.radius * 2)))
    for (let index = 0; index < segments; index += 1) {
      const angle = -(index / segments) * Math.PI * 2
      const x = localX + Math.cos(angle) * circle.radius
      const y = localY + Math.sin(angle) * circle.radius
      if (index === 0) {
        hole.moveTo(x, y)
      } else {
        hole.lineTo(x, y)
      }
    }
    hole.closePath()
    shape.holes.push(hole)
  }
  return new THREE.ShapeGeometry(shape, 1)
}

export function createWaterPlane(options: WaterPlaneOptions): WaterPlaneHandle {
  let exclusionCircles = (options.exclusionCircles ?? []).slice()
  let exclusionSignature = landscapeExclusionSignature(exclusionCircles)
  let geometry = createWaterGeometry(
    options.worldSize,
    options.centerX,
    options.centerZ,
    exclusionCircles,
  )
  const waves = options.waves
  waves.wrapS = THREE.RepeatWrapping
  waves.wrapT = THREE.RepeatWrapping

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uWaves: { value: waves },
      uTime: { value: 0 },
      uSkyColor: { value: new THREE.Color(SLOWROADS_SKY_COLOR) },
      uBase: { value: new THREE.Color(0x24292d) },
      uBody: { value: new THREE.Color(0x607a8a) },
      uHighlight: { value: new THREE.Color(0x8eafd2) },
      uFresnelScale: { value: 1 },
      uFrozen: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  })
  material.name = 'slowroads-water-material'
  // 雾：场景组共享三色雾（雾体在 colorspace 之后混色，与 lab 一致）。
  // 水面片元只带 `colorspace_fragment`（无 tonemapping）：lab 侧基色只做 sRGB 编码，
  // 因此延后色调映射管线要走 `base: 'color-space'` 的显示空间等价体。
  material.onBeforeCompile = (shader) => {
    injectSlowroadsFog(shader, { base: 'color-space', material })
  }

  const mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.x = options.centerX
  mesh.position.z = options.centerZ
  mesh.position.y = options.waterLevel
  mesh.name = 'slowroads-water'
  mesh.receiveShadow = false
  mesh.castShadow = false
  mesh.frustumCulled = false

  return {
    mesh,
    get worldSize(): number {
      return options.worldSize
    },
    setWaterLevel(level: number): void {
      mesh.position.y = level
    },
    setWavesTexture(texture: THREE.Texture): void {
      if (material.uniforms.uWaves!.value === texture) {
        return
      }
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.RepeatWrapping
      material.uniforms.uWaves!.value = texture
      material.needsUpdate = true
    },
    setExclusionCircles(circles: ReadonlyArray<LandscapeExclusionCircle>): void {
      const nextSignature = landscapeExclusionSignature(circles)
      if (nextSignature === exclusionSignature) {
        return
      }
      exclusionCircles = circles.slice()
      exclusionSignature = nextSignature
      const nextGeometry = createWaterGeometry(
        options.worldSize,
        options.centerX,
        options.centerZ,
        exclusionCircles,
      )
      mesh.geometry = nextGeometry
      geometry.dispose()
      geometry = nextGeometry
    },
    update(): void {
      const state = getSlowroadsWaterEnvironment()
      if (!state) {
        return
      }
      ;(material.uniforms.uTime!.value as number) = state.timeSeconds
      ;(material.uniforms.uBase!.value as THREE.Color).set(state.base)
      ;(material.uniforms.uBody!.value as THREE.Color).set(state.body)
      ;(material.uniforms.uHighlight!.value as THREE.Color).set(state.highlight)
      material.uniforms.uFresnelScale!.value = state.fresnelFactor
      material.uniforms.uFrozen!.value = state.frozen ? 1 : 0
      ;(material.uniforms.uSunDir!.value as THREE.Vector3).set(0, 1, 0)
      // lab 的太阳高光是「预设 sun 色 × 强度 × 曝光」；uHighlight 已是预设水面高光，
      // 这里不再额外乘太阳色（lab 的 uHighlight 与 uSunColor 分离，shot 高光用 uHighlight）。
    },
    setVisible(visible: boolean): void {
      mesh.visible = visible
    },
    dispose(): void {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
