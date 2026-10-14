import * as THREE from 'three'
import type { EnvironmentPreset } from '../core/environment'

/**
 * 官方 slowroads.io 景观光照（从线上包体反推，见 reference/official/ 与
 * OFFICIAL-RENDERING.md）：
 *
 *  - 灯光三件套：`DirectionalLight(预设 sun 色/强度，方向竖直向下)` +
 *    `AmbientLight(预设 ambient 色/强度)` +
 *    `HemisphereLight(sky = 预设 sun 色, ground = 黑, 强度 = 预设 ambient 强度)`；
 *  - 材质：Lambert（无镜面），`1/π` 兰伯特项；
 *  - 自发光：`totalEmissiveRadiance`（地表/草/灌木/道路 = 颜色 × radiance，
 *    树卡 = 叶辉光公式）并走官方合成补丁 `direct×(1+emissive) + indirect`；
 *  - 环境项按官方变体乘 `1.75 - clamp(vShadow, 0.75, 1.0)`（地表/道路）。
 */

export interface LandscapeLightingUniforms {
  /** 指向光源的方向（官方太阳竖直向下 → (0, 1, 0)）。 */
  sunDir: THREE.IUniform<THREE.Vector3>
  /** preset.sun.col × preset.sun.intensity（不再乘 lab 的 0.21 标定）。 */
  sunColor: THREE.IUniform<THREE.Color>
  /** preset.ambient.col × preset.ambient.intensity。 */
  ambientColor: THREE.IUniform<THREE.Color>
  /** 半球光 sky = preset.sun.col × preset.ambient.intensity（ground = 黑）。 */
  hemiColor: THREE.IUniform<THREE.Color>
  /** 官方 lights.radiance（材质按 userData.radianceScale 自行折算，树卡为 1/2）。 */
  radiance: THREE.IUniform<number>
  /** 官方 effects.shadowFactor（当季）。 */
  shadowFactor: THREE.IUniform<number>
  /** 官方 lights.fresnelFactor（地表/草丛的掠射边缘光强度）。 */
  fresnelIntensity: THREE.IUniform<number>
}

export function createLandscapeLightingUniforms(): LandscapeLightingUniforms {
  return {
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: new THREE.Color(0.84, 0.82, 0.73) },
    ambientColor: { value: new THREE.Color(0.22, 0.3, 0.12) },
    hemiColor: { value: new THREE.Color(1.39, 1.36, 1.18) },
    radiance: { value: 2 },
    shadowFactor: { value: 1 },
    fresnelIntensity: { value: 1 },
  }
}

/** 把官方三灯颜色/强度与 radiance/shadowFactor 写入共享 uniform。 */
export function applyLandscapeLightingPreset(
  uniforms: LandscapeLightingUniforms,
  preset: EnvironmentPreset,
  shadowFactor: number,
): void {
  uniforms.sunDir.value.set(0, 1, 0)
  uniforms.sunColor.value.set(preset.lights.sun.col).multiplyScalar(preset.lights.sun.intensity)
  uniforms.ambientColor.value.set(preset.lights.ambient.col).multiplyScalar(preset.lights.ambient.intensity)
  uniforms.hemiColor.value.set(preset.lights.sun.col).multiplyScalar(preset.lights.ambient.intensity)
  uniforms.radiance.value = preset.lights.radiance ?? 0
  uniforms.shadowFactor.value = shadowFactor
  uniforms.fresnelIntensity.value = preset.lights.fresnelFactor ?? 1
}

/** 将共享光照 uniform 绑定到某个材质的 uniform 表。 */
export function bindLandscapeLightingUniforms(
  uniforms: LandscapeLightingUniforms,
  target: Record<string, THREE.IUniform>,
): void {
  target.uSunDir = uniforms.sunDir as THREE.IUniform
  target.uSunColor = uniforms.sunColor as THREE.IUniform
  target.uAmbientColor = uniforms.ambientColor as THREE.IUniform
  target.uHemiColor = uniforms.hemiColor as THREE.IUniform
  target.uRadiance = uniforms.radiance as THREE.IUniform
  target.uShadowFactor = uniforms.shadowFactor as THREE.IUniform
  target.uFresnelIntensity = uniforms.fresnelIntensity as THREE.IUniform
}

/** 统一的 GLSL 片段：uniform 声明 + 官方光照求值（各材质自行提供 albedo/ndl）。 */
export const LANDSCAPE_LIGHT_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbientColor;
uniform vec3 uHemiColor;
uniform float uRadiance;
uniform float uShadowFactor;
uniform float uFresnelIntensity;

/** 官方合成：direct × (1 + emissive) + indirect；direct/indirect 均含 1/π。 */
vec3 srLandscapeLight(vec3 albedo, float ndlWrap, float ambientMul, vec3 emissive) {
  const float SR_RCP_PI = 0.3183098861837907;
  float sunNdl = clamp(ndlWrap * 2.0 - 1.0, 0.0, 1.0);
  float hemiWeight = clamp(ndlWrap, 0.0, 1.0);
  vec3 direct = uSunColor * sunNdl * albedo * SR_RCP_PI;
  vec3 ambientIrr = (uAmbientColor + uHemiColor * hemiWeight) * ambientMul;
  vec3 indirect = ambientIrr * albedo * SR_RCP_PI;
  return direct * (vec3(1.0) + emissive) + indirect;
}

/** 官方环境光树影调制（lights_fragment_begin_shadow 变体）。 */
float srAmbientShadowMul(float vShadow) {
  return 1.75 - clamp(vShadow, 0.75, 1.0);
}
`
