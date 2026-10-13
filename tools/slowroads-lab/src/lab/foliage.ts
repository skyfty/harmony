import * as THREE from 'three'
import type { SpriteAtlasSpec } from './spriteRegions'

/**
 * slowroads 风格精灵植被：交叉面片 + 每实例一个图集区域，支持
 *  - 打包式图集（区域表由 spriteRegions 提供，含宽高比与相对高度）；
 *  - 近/远分层（顶点着色器按距离折叠不属于本层的实例，相机移动不触发 CPU 重建）；
 *  - 可选单独 alpha 遮罩与法线贴图（针叶树卡缺 alpha、阔叶树卡带法线）。
 */
export interface FoliageSharedUniforms {
  time: THREE.IUniform<number>
  cameraPosition: THREE.IUniform<THREE.Vector3>
  nearDistance: THREE.IUniform<number>
  sunDir: THREE.IUniform<THREE.Vector3>
  sunColor: THREE.IUniform<THREE.Color>
  ambient: THREE.IUniform<THREE.Color>
  windStrength: THREE.IUniform<number>
}

export interface SpriteInstance {
  x: number
  z: number
  y: number
  rotation: number
  scale: number
  /** 图集区域下标（越界会被夹到最后一个区域）。 */
  variant: number
}

export type FoliageTier = 'near' | 'far' | 'all'

export interface FoliageMeshOptions {
  atlas: SpriteAtlasSpec
  tint: number
  farTintScale: number
  /** 世界高度基准（树约 8m，草 1.6m，护栏横栏 0.35m）。 */
  unitSize: number
  shared: FoliageSharedUniforms
  /** 距离分层：near 只显示近处、far 只显示远处、all 始终显示。 */
  tier?: FoliageTier
  /** 只用单片面（护栏等薄片物体）。 */
  singlePlane?: boolean
}

export function createFoliageSharedUniforms(): FoliageSharedUniforms {
  return {
    time: { value: 0 },
    cameraPosition: { value: new THREE.Vector3() },
    nearDistance: { value: 120 },
    sunDir: { value: new THREE.Vector3(0.42, 0.72, 0.28).normalize() },
    sunColor: { value: new THREE.Color(0.62, 0.6, 0.56) },
    ambient: { value: new THREE.Color(0.55, 0.58, 0.62) },
    windStrength: { value: 0.1 },
  }
}

export function createCrossQuadGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    -0.5, 0, 0,
    0.5, 0, 0,
    0.5, 1, 0,
    -0.5, 1, 0,
    0, 0, -0.5,
    0, 0, 0.5,
    0, 1, 0.5,
    0, 1, -0.5,
  ])
  const uvs = new Float32Array([
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
  ])
  const normals = new Float32Array(24)
  for (let i = 0; i < 8; i += 1) {
    normals[i * 3 + 1] = 1
  }
  const planes = new Float32Array([0, 0, 0, 0, 1, 1, 1, 1])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('aPlane', new THREE.BufferAttribute(planes, 1))
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
  return geometry
}

const VERTEX_SHADER = `
attribute float aPlane;
attribute vec4 aUvRect;
attribute vec2 aSize;
uniform float uTime;
uniform vec3 uCameraPos;
uniform float uNearDistance;
uniform float uTierMode;
uniform float uSinglePlane;
uniform float uWindStrength;
varying vec2 vUv;
varying float vFar;
varying float vTint;
#include <fog_pars_vertex>
void main() {
  #ifdef USE_INSTANCING
    vec4 instWorld = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  #else
    vec4 instWorld = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  #endif
  float dist = distance(instWorld.xyz, uCameraPos);
  float isNear = step(dist, uNearDistance);
  float far = 1.0 - isNear;
  vFar = far;
  float collapse = 0.0;
  if (uTierMode > 0.5) {
    collapse = isNear;
  } else if (uTierMode < -0.5) {
    collapse = far;
  }
  float phase = fract(sin(dot(instWorld.xz, vec2(12.9898, 78.233))) * 43758.5453);
  vTint = 0.88 + 0.24 * fract(phase * 7.13);

  vec3 transformed = position;
  transformed.xz *= aSize.x;
  transformed.y *= aSize.y;
  float wind = uWindStrength * (1.0 - far) * transformed.y * transformed.y;
  transformed.x += sin(uTime * 1.7 + phase * 6.28318) * wind;
  transformed.z += cos(uTime * 1.31 + phase * 5.17) * wind * 0.6;
  if (collapse > 0.5) {
    transformed = vec3(0.0);
  }
  if (aPlane > 0.5 && (far > 0.5 || uSinglePlane > 0.5)) {
    transformed = vec3(0.0);
  }

  vUv = mix(aUvRect.xy, aUvRect.zw, uv);

  vec4 worldPosition = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const FRAGMENT_SHADER = `
uniform sampler2D uAtlas;
uniform sampler2D uAlphaTex;
uniform sampler2D uNormalTex;
uniform float uHasAlphaTex;
uniform float uHasNormalTex;
uniform vec3 uTint;
uniform float uFarTintScale;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
varying vec2 vUv;
varying float vFar;
varying float vTint;
#include <fog_pars_fragment>
void main() {
  vec4 texel = texture2D(uAtlas, vUv);
  float alpha = mix(texel.a, texture2D(uAlphaTex, vUv).r, uHasAlphaTex);
  if (alpha < 0.35) discard;
  vec3 color = texel.rgb * uTint * vTint;
  color *= mix(1.0, uFarTintScale, vFar);
  float ndl = clamp(dot(vec3(0.0, 1.0, 0.0), uSunDir), -1.0, 1.0) * 0.5 + 0.5;
  if (uHasNormalTex > 0.5) {
    vec3 n = texture2D(uNormalTex, vUv).xyz * 2.0 - 1.0;
    vec3 billboardNormal = normalize(vec3(n.x * 0.55, n.y * 0.55 + 0.8, n.z * 0.35));
    ndl = clamp(dot(billboardNormal, uSunDir), -1.0, 1.0) * 0.5 + 0.5;
  }
  color *= uAmbient + uSunColor * ndl;
  gl_FragColor = vec4(color, 1.0);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`

const matrixHelper = new THREE.Matrix4()
const positionHelper = new THREE.Vector3()
const quaternionHelper = new THREE.Quaternion()
const eulerHelper = new THREE.Euler()
const scaleHelper = new THREE.Vector3()

const TIER_MODE: Record<FoliageTier, number> = { near: -1, all: 0, far: 1 }

export function createFoliageMesh(
  instances: SpriteInstance[],
  options: FoliageMeshOptions,
): THREE.InstancedMesh {
  const count = instances.length
  const geometry = createCrossQuadGeometry()
  const capacity = Math.max(1, count)
  const uvRectAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
  const sizeAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2)
  geometry.setAttribute('aUvRect', uvRectAttribute)
  geometry.setAttribute('aSize', sizeAttribute)

  // Raw ShaderMaterial 不接受 null sampler：缺少遮罩/法线时用主图集占位，
  // 由 uHasXxx 开关决定是否真正采样。
  const atlasTexture = options.atlas.texture
  const alphaTexture = options.atlas.alphaTexture ?? atlasTexture
  const normalTexture = options.atlas.normalTexture ?? atlasTexture
  const regions = options.atlas.regions
  if (!regions.length) {
    throw new Error('slowroads-lab: 图集缺少区域表')
  }

  const material = new THREE.ShaderMaterial({
    uniforms: {
      // Raw ShaderMaterial + fog: three writes into these itself.
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uAtlas: { value: atlasTexture },
      uAlphaTex: { value: alphaTexture },
      uNormalTex: { value: normalTexture },
      uHasAlphaTex: { value: options.atlas.alphaTexture ? 1 : 0 },
      uHasNormalTex: { value: options.atlas.normalTexture ? 1 : 0 },
      uTint: { value: new THREE.Color(options.tint) },
      uFarTintScale: { value: options.farTintScale },
      uTime: options.shared.time,
      uCameraPos: options.shared.cameraPosition,
      uNearDistance: options.shared.nearDistance,
      uTierMode: { value: TIER_MODE[options.tier ?? 'all'] },
      uSinglePlane: { value: options.singlePlane ? 1 : 0 },
      // Per-mesh so grass / bush / tree can sway with different amplitudes.
      uWindStrength: { value: options.shared.windStrength.value },
      uSunDir: options.shared.sunDir,
      uSunColor: options.shared.sunColor,
      uAmbient: options.shared.ambient,
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    fog: true,
    // Crossed sprite cards are viewed from both sides.
    side: THREE.DoubleSide,
  })

  const mesh = new THREE.InstancedMesh(geometry, material, capacity)
  mesh.count = count
  mesh.castShadow = false
  mesh.receiveShadow = false

  const baseScale = options.unitSize
  for (let i = 0; i < count; i += 1) {
    const instance = instances[i]!
    const region = regions[Math.min(Math.max(0, Math.round(instance.variant)), regions.length - 1)]!
    positionHelper.set(instance.x, instance.y, instance.z)
    eulerHelper.set(0, instance.rotation, 0)
    quaternionHelper.setFromEuler(eulerHelper)
    const scale = baseScale * instance.scale
    scaleHelper.set(scale, scale, scale)
    matrixHelper.compose(positionHelper, quaternionHelper, scaleHelper)
    mesh.setMatrixAt(i, matrixHelper)
    uvRectAttribute.setXYZW(i, region.u0, region.v0, region.u1, region.v1)
    sizeAttribute.setXY(i, region.aspect * region.heightScale, region.heightScale)
  }
  mesh.instanceMatrix.needsUpdate = true
  uvRectAttribute.needsUpdate = true
  sizeAttribute.needsUpdate = true
  mesh.computeBoundingSphere()
  return mesh
}

export function setFoliageWindStrength(mesh: THREE.InstancedMesh, strength: number): void {
  const material = mesh.material as THREE.ShaderMaterial
  material.uniforms.uWindStrength!.value = strength
}

export function disposeFoliageMesh(mesh: THREE.InstancedMesh | null | undefined): void {
  if (!mesh) {
    return
  }
  mesh.removeFromParent()
  mesh.geometry.dispose()
  const material = mesh.material as THREE.ShaderMaterial
  material.dispose()
}
