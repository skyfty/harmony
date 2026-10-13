import * as THREE from 'three'
import type { SpriteAtlasSpec } from '../core/spriteRegions'
import { SEASON_PARAMS } from '../core/seasonParams'
import type { SeasonId } from '../core/seasonCatalog'

/**
 * slowroads 风格精灵植被（交叉面片 + 每实例一个图集区域）：
 *  - 打包式图集（区域表来自 `spriteRegions`，含宽高比、相对高度与空位）；
 *  - 距离分层（顶点着色器按相机距离折叠不属于本层的实例，且支持“近树 3D
 *    网格接管半径”折叠，CPU 不重建）；
 *  - 草丛层按官方公式乘当季调色板（grassColA/B × peakColA/B，噪声驱动明暗），
 *    冬季按 slowroads 规则裁剪变体高度；
 *  - 树卡/远景树：官方 leafEffect 变色（绿像素随季节明暗）+ 冬季阔叶积雪。
 */
export interface FoliageSharedUniforms {
  time: THREE.IUniform<number>
  cameraPosition: THREE.IUniform<THREE.Vector3>
  nearDistance: THREE.IUniform<number>
  /** >0 时近层实例在半径内折叠（3D 近树接管）。 */
  meshRadius: THREE.IUniform<number>
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
  /** 图集格（cell）下标；空位格不应传入。 */
  variant: number
  /** slowroads 变体格号（裁剪规则按它生效）；缺省时回退到 variant。 */
  cell?: number
  /** d - halfWidth，草地调色板贴近道路时的明度抑制。 */
  roadProx?: number
}

export type FoliageTier = 'near' | 'far' | 'all'

export interface FoliagePaletteOptions {
  /**
   * 'grass' = 按当季调色板给草精灵着色；
   * 'bush' = 灌木/花草：保留自身颜色 + 噪声斑驳亮度；
   * 'none' = 树卡等不做调色。
   */
  mode: 'none' | 'grass' | 'bush'
  season: SeasonId
  noiseMap: THREE.Texture
  grassVariation: THREE.Texture
  detailFar: THREE.Texture
}

export interface FoliageTreeOptions {
  /** 覆盖图集 alpha 变化：leafEffect 变色强度（官方 treeDiscolouration）。 */
  discolouration: number
  hasSnow: boolean
  /** 0 = broadleaf（冬季积雪），1 = conifer（不落雪）。 */
  species: 0 | 1
}

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
  /** 草丛调色板（slowroads grass sprite 公式）。 */
  palette?: FoliagePaletteOptions
  /** 树卡/远景树变色与积雪。 */
  tree?: FoliageTreeOptions
}

export function createFoliageSharedUniforms(): FoliageSharedUniforms {
  return {
    time: { value: 0 },
    cameraPosition: { value: new THREE.Vector3() },
    nearDistance: { value: 120 },
    meshRadius: { value: 0 },
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
attribute float aCell;
attribute float aRoadProx;
uniform float uTime;
uniform vec3 uCameraPos;
uniform float uNearDistance;
uniform float uMeshRadius;
uniform float uTierMode;
uniform float uSinglePlane;
uniform float uWindStrength;
uniform int uSeasonIndex;
varying vec2 vUv;
varying float vFar;
varying float vTint;
varying float vCell;
varying vec3 vInstancePos;
varying float vRoadProx;
#include <fog_pars_vertex>
void main() {
  #ifdef USE_INSTANCING
    vec4 instWorld = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  #else
    vec4 instWorld = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  #endif
  float dist = distance(instWorld.xyz, uCameraPos);
  float isNear = step(dist, uNearDistance);
  float insideMeshRadius = step(dist, uMeshRadius);
  float far = 1.0 - isNear;
  vFar = far;
  float collapse = 0.0;
  if (uTierMode > 0.5) {
    collapse = isNear;
  } else if (uTierMode < -0.5) {
    collapse = far;
    // 3D 近树网格接管：近层实例在网格半径内让位。
    collapse = max(collapse, insideMeshRadius);
  }
  float phase = fract(sin(dot(instWorld.xz, vec2(12.9898, 78.233))) * 43758.5453);
  vTint = 0.88 + 0.24 * fract(phase * 7.13);

  vec3 transformed = position;
  transformed.xz *= aSize.x;
  transformed.y *= aSize.y;

  // slowroads 变体裁剪：非冬季 0/1/3 号半高、2 号全高；冬季 2/3 号半高。
  float cropY = 1.0 - 0.5 * step(0.5, abs(aCell - 2.0));
  if (uSeasonIndex == 3) {
    cropY = step(1.5, aCell) * 0.5;
  }
  transformed.y *= cropY;

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
  vCell = aCell;
  vRoadProx = aRoadProx;
  vInstancePos = instWorld.xyz;

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
uniform sampler2D uNoiseMap;
uniform sampler2D uGrassVariation;
uniform sampler2D uDetailFar;
uniform float uHasAlphaTex;
uniform float uHasNormalTex;
uniform float uPaletteMode;
uniform int uSeasonIndex;
uniform vec3 uPaletteA;
uniform vec3 uPaletteB;
uniform vec3 uPeakA;
uniform vec3 uPeakB;
uniform vec3 uTint;
uniform float uFarTintScale;
uniform float uTreeDiscolouration;
uniform float uHasSnow;
uniform float uSpecies;
uniform float uHasNormalMap;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
varying vec2 vUv;
varying float vFar;
varying float vTint;
varying float vCell;
varying vec3 vInstancePos;
varying float vRoadProx;
#include <fog_pars_fragment>

float screen(float a, float b) { return 1.0 - ((1.0 - a) * (1.0 - b)); }

void main() {
  vec4 texel = texture2D(uAtlas, vUv);
  float alpha = mix(texel.a, texture2D(uAlphaTex, vUv).r, uHasAlphaTex);
  if (alpha < 0.35) discard;
  vec3 color = texel.rgb * uTint * vTint;

  // ---- slowroads 草丛调色板 -------------------------------------------------
  if (uPaletteMode > 1.5) {
    // 灌木 / 花草：自身颜色 + 斑驳亮度（slowroads bush frag else 分支）。
    float dapple = 1.0 + (texture2D(uNoiseMap, vInstancePos.xz / 256.0).r - 0.6);
    color = texel.rgb * dapple * vTint;
  } else if (uPaletteMode > 0.5) {
    if (vCell < 2.5) {
      vec2 uvA = vInstancePos.xz / 10.0;
      vec2 uvB = uvA / 16.0;
      float fade0 = texture2D(uNoiseMap, uvA).r;
      float fade1 = texture2D(uNoiseMap, uvB).r;
      float variationVal = texture2D(uGrassVariation, vInstancePos.xz / 2000.0).r - 0.5;
      float closeVariation = ((1.0 - texture2D(uGrassVariation, vInstancePos.xz / 500.0).r) - 0.5);

      float heightVal = min(1.0, max(0.0, (vInstancePos.y - (30.0 + fade1 * 40.0)) / 150.0));
      float lightGrass = min(1.0, heightVal * (fade0 + heightVal * 0.5));
      float darkGrass = min(max(0.0, (fade1 - 0.25) * 2.0), 1.0);
      if (vRoadProx < 0.5 + fade1) {
        lightGrass *= max(0.5, vRoadProx / (0.5 + fade1));
      }
      float grassBlend = (screen(fade0, fade1) + darkGrass) / 2.0;
      grassBlend = grassBlend * grassBlend;
      grassBlend = clamp(grassBlend + variationVal + closeVariation, 0.0, 1.0);
      float lightGrassFactor = clamp(lightGrass + variationVal - closeVariation, 0.0, 1.0);
      lightGrassFactor = clamp(lightGrassFactor * 2.0 * texel.r, 0.0, 1.0);
      vec3 grassCol = mix(
        mix(uPaletteA, uPaletteB, grassBlend),
        mix(uPeakA, uPeakB, grassBlend),
        lightGrassFactor
      );
      float detailNoise = 1.0 - (1.0 - texture2D(uDetailFar, vInstancePos.xz / 500.0).r) * 0.7;
      color = texel.rgb * grassCol * detailNoise;
    } else {
      // heather 草球：保留自身颜色 + 轻微斑驳亮度。
      if (texel.a < 0.98) discard;
      float dapple = 1.0 + (texture2D(uNoiseMap, vInstancePos.xz / 10.0).r - 0.6);
      color = texel.rgb * dapple;
    }
    color *= vTint;
  }

  // ---- 树卡 / 远景树：leafEffect 变色 + 冬季阔叶积雪 --------------------------
  if (uPaletteMode < 0.5) {
    float leafEffect = step(color.b * 1.5, color.g);
    color.rg *= 1.0 - (1.0 - uTreeDiscolouration) * leafEffect;
  }

  color *= mix(1.0, uFarTintScale, vFar);

  float ndl = clamp(dot(vec3(0.0, 1.0, 0.0), uSunDir), -1.0, 1.0) * 0.5 + 0.5;
  float snowUp = 0.5;
  if (uHasNormalTex > 0.5) {
    vec3 n = texture2D(uNormalTex, vUv).xyz * 2.0 - 1.0;
    vec3 billboardNormal = normalize(vec3(n.x * 0.55, n.y * 0.55 + 0.8, n.z * 0.35));
    ndl = clamp(dot(billboardNormal, uSunDir), -1.0, 1.0) * 0.5 + 0.5;
    snowUp = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
  }
  if (uHasSnow > 0.5 && uSpecies < 0.5) {
    color = mix(color, vec3(1.0), clamp(snowUp * 1.2, 0.0, 1.0) * 0.8);
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
  const cellAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
  const roadProxAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
  geometry.setAttribute('aUvRect', uvRectAttribute)
  geometry.setAttribute('aSize', sizeAttribute)
  geometry.setAttribute('aCell', cellAttribute)
  geometry.setAttribute('aRoadProx', roadProxAttribute)

  const atlasTexture = options.atlas.texture
  const alphaTexture = options.atlas.alphaTexture ?? atlasTexture
  const normalTexture = options.atlas.normalTexture ?? atlasTexture
  const regions = options.atlas.regions
  if (!regions.length) {
    throw new Error('slowroads-lab: 图集缺少区域表')
  }
  const palette = options.palette
  const seasonParams = palette ? SEASON_PARAMS[palette.season] : null

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uAtlas: { value: atlasTexture },
      uAlphaTex: { value: alphaTexture },
      uNormalTex: { value: normalTexture },
      uNoiseMap: { value: palette?.noiseMap ?? atlasTexture },
      uGrassVariation: { value: palette?.grassVariation ?? atlasTexture },
      uDetailFar: { value: palette?.detailFar ?? atlasTexture },
      uHasAlphaTex: { value: options.atlas.alphaTexture ? 1 : 0 },
      uHasNormalTex: { value: options.atlas.normalTexture ? 1 : 0 },
      uHasNormalMap: { value: options.atlas.normalTexture ? 1 : 0 },
      uPaletteMode: { value: options.palette ? (options.palette.mode === 'grass' ? 1 : options.palette.mode === 'bush' ? 2 : 0) : 0 },
      uSeasonIndex: { value: seasonParams ? seasonParams.index : 0 },
      uPaletteA: { value: new THREE.Color(seasonParams ? seasonParams.grassColA : '#ffffff') },
      uPaletteB: { value: new THREE.Color(seasonParams ? seasonParams.grassColB : '#ffffff') },
      uPeakA: { value: new THREE.Color(seasonParams ? seasonParams.peakColA : '#ffffff') },
      uPeakB: { value: new THREE.Color(seasonParams ? seasonParams.peakColB : '#ffffff') },
      uTreeDiscolouration: { value: options.tree ? options.tree.discolouration : 1 },
      uHasSnow: { value: options.tree?.hasSnow ? 1 : 0 },
      uSpecies: { value: options.tree ? options.tree.species : 0 },
      uTint: { value: new THREE.Color(options.tint) },
      uFarTintScale: { value: options.farTintScale },
      uTime: options.shared.time,
      uCameraPos: options.shared.cameraPosition,
      uNearDistance: options.shared.nearDistance,
      uMeshRadius: options.shared.meshRadius,
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
    const region = regions[Math.min(Math.max(0, Math.round(instance.variant)), regions.length - 1)]
    if (!region) {
      // 空位格（冬季草 0/1 号）：实例不可见。
      scaleHelper.set(0, 0, 0)
      positionHelper.set(0, -1e4, 0)
      matrixHelper.compose(positionHelper, quaternionHelper.identity(), scaleHelper)
      mesh.setMatrixAt(i, matrixHelper)
      uvRectAttribute.setXYZW(i, 0, 0, 0, 0)
      sizeAttribute.setXY(i, 0, 0)
      cellAttribute.setX(i, instance.cell ?? instance.variant)
      roadProxAttribute.setX(i, instance.roadProx ?? 0)
      continue
    }
    positionHelper.set(instance.x, instance.y, instance.z)
    eulerHelper.set(0, instance.rotation, 0)
    quaternionHelper.setFromEuler(eulerHelper)
    const scale = baseScale * instance.scale
    scaleHelper.set(scale, scale, scale)
    matrixHelper.compose(positionHelper, quaternionHelper, scaleHelper)
    mesh.setMatrixAt(i, matrixHelper)
    uvRectAttribute.setXYZW(i, region.u0, region.v0, region.u1, region.v1)
    sizeAttribute.setXY(i, region.aspect * region.heightScale, region.heightScale)
    cellAttribute.setX(i, instance.cell ?? instance.variant)
    roadProxAttribute.setX(i, instance.roadProx ?? 0)
  }
  mesh.instanceMatrix.needsUpdate = true
  uvRectAttribute.needsUpdate = true
  sizeAttribute.needsUpdate = true
  cellAttribute.needsUpdate = true
  roadProxAttribute.needsUpdate = true
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
