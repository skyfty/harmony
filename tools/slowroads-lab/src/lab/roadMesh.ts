import * as THREE from 'three'
import type { TreeDensityField } from '../core/placement'
import type { RoadProfile } from '../core/roadProfile'
import { LANDSCAPE_LIGHT_GLSL } from './landscapeLighting'

/**
 * 公路贴图带（slowroads road_single 网格移植）。
 *
 * - 沿 RoadProfile 生成贴合压平地形的带状网格（左右边缘 = ±半宽，高出地形 ~2cm）；
 * - UV 按官方规则：u = 0..1 横跨整个路宽，v = 里程 / (2×路宽)（road_single 的
 *   textureStretch=2 → 每 2 倍路宽重复一次贴图）；
 * - 春/秋的 overlay（苔痕 / 落叶）强度 = saturate(道路两侧树影 × shadowFactor × 3)，
 *   即落叶在树荫下更密，与 slowroads 完全一致；冬/夏无 overlay；
 * - alphaTest 0.75（官方材质参数），粗糙边缘由底图 alpha 裁切。
 */
export interface RoadMeshOptions {
  profile: RoadProfile
  density: TreeDensityField
  sunDir: THREE.Vector3
  sunColor: THREE.Color
}

export interface RoadTextureSet {
  base: THREE.Texture
  overlay: THREE.Texture | null
}

export interface RoadMeshHandle {
  mesh: THREE.Mesh
  setSeason(textures: RoadTextureSet, shadowFactor: number): void
  dispose(): void
}

const STEP_ALONG = 2
const ROAD_LIFT = 0.02

const VERTEX_SHADER = `
#include <common>
attribute float aShadow;
uniform float uTextureStretch;
varying vec2 vRoadUv;
varying float vShadow;
varying float vViewDistance;
varying vec3 vWorldPosition;
#include <fog_pars_vertex>
void main() {
  vRoadUv = uv;
  vRoadUv.y /= uTextureStretch;
  vShadow = aShadow;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vec4 mvPosition = viewMatrix * worldPosition;
  vViewDistance = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const FRAGMENT_SHADER = `
uniform sampler2D uMap;
uniform sampler2D uOverlay;
uniform float uHasOverlay;
${LANDSCAPE_LIGHT_GLSL}
varying vec2 vRoadUv;
varying float vShadow;
varying float vViewDistance;
varying vec3 vWorldPosition;
#include <fog_pars_fragment>
void main() {
  vec4 texelColor = texture2D(uMap, vRoadUv);
  if (texelColor.a < 0.75) {
    discard;
  }
  if (uHasOverlay > 0.5) {
    vec4 overlayCol = texture2D(uOverlay, vRoadUv);
    float overlayFactor = clamp(vShadow * uShadowFactor * 3.0, 0.0, 1.0);
    texelColor.rgb = mix(texelColor.rgb, overlayCol.rgb, overlayFactor * overlayCol.a);
  }
  // 官方道路 = Lambert + 自发光（texelColor × radiance，与地表共享），
  // 环境项按官方 vShadow 变体调制。
  float ndl = clamp(dot(vec3(0.0, 1.0, 0.0), uSunDir), -1.0, 1.0) * 0.5 + 0.5;
  // 官方路面掠射边缘光（ef chunk）：与地表同款 fresnel，但无 blendVal / uv 偏置。
  float fresnel = 1.0 - max(0.0, dot(normalize(cameraPosition - vWorldPosition), vec3(0.0, 1.0, 0.0)));
  float lightFresnel = max(0.0, (fresnel - 0.75)) * 4.0;
  lightFresnel *= lightFresnel;
  lightFresnel *= (1.0 - vShadow * uShadowFactor);
  lightFresnel *= uFresnelIntensity;
  float darkFresnel = 1.0 - min(1.0, fresnel * 1.3333);
  darkFresnel *= uFresnelIntensity;
  darkFresnel = 0.25 + min(0.25, max(0.0, darkFresnel - 0.25) * 0.5);
  vec3 albedo = texelColor.rgb * (1.0 + lightFresnel - darkFresnel);
  vec3 color = srLandscapeLight(albedo, ndl, srAmbientShadowMul(vShadow * uShadowFactor), texelColor.rgb * uRadiance);
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

export function createRoadMesh(options: RoadMeshOptions): RoadMeshHandle {
  const { profile } = options
  const step = STEP_ALONG
  const sampleCount = Math.max(2, Math.floor(profile.length / step) + 1)
  const vertexCount = sampleCount * 2
  const positions = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const normals = new Float32Array(vertexCount * 3)
  const shadows = new Float32Array(vertexCount)
  const indices = new Uint32Array((sampleCount - 1) * 6)

  const shadowLateral = profile.halfWidth + profile.shoulderWidth
  // Official mapping: v advances 1/(2*halfWidth) per metre, then the shader
  // divides by `textureStretch` (2 for the single-track set) => one texture
  // repeat every 2x road width (4x half width).
  const repeatLength = Math.max(1e-3, profile.halfWidth * 2)

  for (let i = 0; i < sampleCount; i += 1) {
    const distance = Math.min(profile.length, i * step)
    const sample = profile.sampleAt(distance)
    const perpX = -Math.sin(sample.heading)
    const perpZ = Math.cos(sample.heading)
    const v = distance / repeatLength
    for (const side of [0, 1] as const) {
      const sign = side === 0 ? 1 : -1
      const vertexIndex = i * 2 + side
      positions[vertexIndex * 3] = sample.x + perpX * sign * profile.halfWidth
      positions[vertexIndex * 3 + 1] = sample.y + ROAD_LIFT
      positions[vertexIndex * 3 + 2] = sample.z + perpZ * sign * profile.halfWidth
      normals[vertexIndex * 3 + 1] = 1
      uvs[vertexIndex * 2] = side === 0 ? 0 : 1
      uvs[vertexIndex * 2 + 1] = v
      const probeX = sample.x + perpX * sign * shadowLateral
      const probeZ = sample.z + perpZ * sign * shadowLateral
      shadows[vertexIndex] = Math.min(1, options.density.sampleUnit(probeX, probeZ) * 1.3)
    }
  }
  for (let i = 0; i < sampleCount - 1; i += 1) {
    const a = i * 2
    const b = a + 1
    const c = a + 2
    const d = a + 3
    const cursor = i * 6
    indices[cursor] = a
    indices[cursor + 1] = c
    indices[cursor + 2] = d
    indices[cursor + 3] = a
    indices[cursor + 4] = d
    indices[cursor + 5] = b
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setAttribute('aShadow', new THREE.BufferAttribute(shadows, 1))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uMap: { value: null },
      uOverlay: { value: null },
      uHasOverlay: { value: 0 },
      uShadowFactor: { value: 1 },
      uTextureStretch: { value: 2 },
      // 官方光照：环境控制器按预设统一下发。
      uSunDir: { value: options.sunDir.clone() },
      uSunColor: { value: options.sunColor.clone() },
      uAmbientColor: { value: new THREE.Color(0.22, 0.3, 0.12) },
      uHemiColor: { value: new THREE.Color(1.39, 1.36, 1.18) },
      uRadiance: { value: 2 },
      uFresnelIntensity: { value: 1 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    fog: true,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'slowroads-road-ribbon'
  material.name = 'slowroads-road-material'
  mesh.receiveShadow = false
  mesh.castShadow = false
  mesh.frustumCulled = false

  return {
    mesh,
    setSeason(textures: RoadTextureSet, shadowFactor: number): void {
      material.uniforms.uMap!.value = textures.base
      material.uniforms.uOverlay!.value = textures.overlay ?? textures.base
      material.uniforms.uHasOverlay!.value = textures.overlay ? 1 : 0
      material.uniforms.uShadowFactor!.value = shadowFactor
    },
    dispose(): void {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
