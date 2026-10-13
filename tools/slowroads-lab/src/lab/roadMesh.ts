import * as THREE from 'three'
import type { TreeDensityField } from '../core/placement'
import type { RoadProfile } from '../core/roadProfile'

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
  ambient: THREE.Color
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
#include <fog_pars_vertex>
void main() {
  vRoadUv = uv;
  vRoadUv.y /= uTextureStretch;
  vShadow = aShadow;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
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
uniform float uShadowFactor;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
varying vec2 vRoadUv;
varying float vShadow;
varying float vViewDistance;
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
  float ndl = clamp(dot(vec3(0.0, 1.0, 0.0), uSunDir), -1.0, 1.0) * 0.5 + 0.5;
  vec3 color = texelColor.rgb * (uAmbient + uSunColor * ndl);
  gl_FragColor = vec4(color, 1.0);
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
      uSunDir: { value: options.sunDir },
      uSunColor: { value: options.sunColor },
      uAmbient: { value: options.ambient },
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
