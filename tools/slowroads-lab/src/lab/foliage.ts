import * as THREE from 'three'
import type { SpriteAtlasSpec } from '../core/spriteRegions'
import { SEASON_PARAMS } from '../core/seasonParams'
import type { SeasonId } from '../core/seasonCatalog'
import { LANDSCAPE_LIGHT_GLSL } from './landscapeLighting'

/**
 * slowroads 风格精灵植被（交叉面片 + 每实例一个图集区域）：
 *  - 打包式图集（区域表来自 `spriteRegions`，含宽高比、相对高度与空位）；
 *  - 距离分层（顶点着色器按相机距离折叠不属于本层的实例，且支持“近树 3D
 *    网格接管半径”折叠，CPU 不重建）；
 *  - 草丛层按官方公式乘当季调色板（grassColA/B × peakColA/B，噪声驱动明暗），
 *    冬季按 slowroads 规则裁剪变体高度；
 *  - 树卡/远景树：官方 lit26 合成（leafEffect 含 vLeafBrightness、diffuse 与
 *    emissive 同乘 vRadianceBlend）+ 冬季阔叶积雪；
 *  - 灌木：官方保留贴图颜色的同时自发光乘 vAO，并按视深衰减 alpha（0.5→0.2）；
 *  - 裁切阈值 = 材质 alphaTest（逐层/季）与距离 alpha 取 max。
 */
export interface FoliageSharedUniforms {
  time: THREE.IUniform<number>
  cameraPosition: THREE.IUniform<THREE.Vector3>
  nearDistance: THREE.IUniform<number>
  /** >0 时近层实例在半径内折叠（3D 近树接管）。 */
  meshRadius: THREE.IUniform<number>
  /** 官方太阳方向（竖直向下）；水面对齐等仍读取该字段。 */
  sunDir: THREE.IUniform<THREE.Vector3>
  /** 官方太阳颜色 × 强度（供水面初始值；景观材质由环境控制器统一下发）。 */
  sunColor: THREE.IUniform<THREE.Color>
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
  /** 官方 per-instance groundNormal（草丛/灌木受光与 fresnel）；缺省 (0,1,0)。 */
  nx?: number
  ny?: number
  nz?: number
}

export type FoliageTier = 'near' | 'far' | 'all'

export interface FoliagePaletteOptions {
  /**
   * 'grass' = 按当季调色板给草精灵着色；
   * 'bush' = 灌木/花草：保留自身颜色，自发光乘 vAO（官方 bush 片元）；
   * 'none' = 树卡等不做调色。
   */
  mode: 'none' | 'grass' | 'bush'
  season: SeasonId
  noiseMap: THREE.Texture
  grassVariation: THREE.Texture
  detailFar: THREE.Texture
}

export interface FoliageTreeOptions {
  /**
   * 官方 `effects.treeDiscolouration`：树卡变色的**噪声幅度**，不是乘数。
   * 着色器按官方顶点分块（un / Jg）先换算成乘数
   * `disc = 1.0 + (noise(world.xz / 256.0) - 0.5) * factor`（冬季 0.2 → 0.9..1.1，
   * 春 1.5 → 0.25..1.75），再按阔叶/针叶各自的通道规则施加；柏树列另有 *0.5+0.5 兜底。
   */
  discolouration: number
  hasSnow: boolean
  /** 0 = broadleaf（冬季积雪），1 = conifer（不落雪）。 */
  species: 0 | 1
}

export interface FoliageMeshOptions {
  atlas: SpriteAtlasSpec
  tint: number
  /**
   * 官方 alphaTest（逐层/季）：草丛 .5/冬 .2、灌木 .2/冬 .3、近树卡阔叶 .5
   * 针叶 .4、远景树 .6/冬 .5（来自官方 foliage preset 与 xr() 近树材质）。
   */
  alphaTest: number
  /** 官方灌木顶点规则：视深 <10m 时 alpha≥0.5，之后 0.5→0.2（仅灌木层启用）。 */
  distanceAlpha?: boolean
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
  /**
   * 树卡/远景树 LOD：官方按距离 dissolve 交接（近树卡远距离淡出、远景树近距离隐藏），
   * `near` = 近树卡层（另开动态 alpha 与模型高度 leafBrightness），`far` = 朝相机广告牌。
   */
  card?: {
    kind: 'near' | 'far'
    dissolveNear: number
    dissolveFar: number
    dissolveInterval: number
  }
  /** 树卡 dissolve / 角度混列噪声图（官方 noise_fine）。 */
  noiseMap?: THREE.Texture
  /** 树密度图（近似官方 per-instance shadow；草丛/灌木/树卡共用）。 */
  densityMap?: THREE.Texture
  /** densityMap 覆盖的世界尺寸（米）。 */
  worldSize?: number
}

export function createFoliageSharedUniforms(): FoliageSharedUniforms {
  return {
    time: { value: 0 },
    cameraPosition: { value: new THREE.Vector3() },
    nearDistance: { value: 120 },
    meshRadius: { value: 0 },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: new THREE.Color(0.84, 0.82, 0.73) },
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
#include <common>
attribute float aPlane;
attribute vec4 aUvRect;
attribute vec2 aSize;
attribute float aCell;
attribute float aRoadProx;
/** 官方 per-instance groundNormal（草丛/灌木受光与 fresnel 方向）；缺省由 JS 填 (0,1,0)。 */
attribute vec3 aGroundNormal;
/** 远景树（imposter）的朝向基准角；普通层为 0。 */
attribute float aOrientation;
uniform float uTime;
uniform vec3 uCameraPos;
uniform float uNearDistance;
uniform float uMeshRadius;
uniform float uTierMode;
uniform float uSinglePlane;
uniform float uWindStrength;
uniform float uDistanceAlpha;
uniform float uPaletteMode;
/** 1 = 近树卡：官方动态 alphaTest + 距离 dissolve + 模型高度 leafBrightness。 */
uniform float uDynamicAlpha;
/** 1 = 远景树：官方 imposter（朝相机广告牌 + 16 朝向列 + 角度混列 + 距离放大/下沉）。 */
uniform float uBillboard;
uniform int uSeasonIndex;
uniform float uShadowFactor;
uniform float uSpecies;
uniform float uDissolveNear;
uniform float uDissolveFar;
uniform float uDissolveInterval;
uniform float uAlphaTest;
/** 1 = 用 lab 的树密度图近似官方 per-instance shadow。 */
uniform float uUseDensityShadow;
uniform sampler2D uDensityMap;
uniform float uWorldSize;
uniform float uWorldHalf;
/** 官方 effects.treeDiscolouration：噪声变色幅度（不是乘数）。 */
uniform float uTreeDiscolourationFactor;
/** 官方树卡变色噪声（与 dissolve 共用 noiseMap；uv = 实例世界坐标 / 256）。 */
uniform sampler2D uTreeDiscolourationNoise;
varying vec2 vUv;
varying vec2 vUvOffset;
varying vec2 vUvBlend;
varying float vAngleBlend;
varying float vCell;
varying vec3 vInstancePos;
varying float vRoadProx;
varying float vRadianceBlend;
varying float vLeafBrightness;
varying float vAlphaTest;
varying float vAO;
varying float vShadow;
varying float vDissolve;
varying vec3 vGroundNormal;
varying vec2 vCardUv;
varying float vTreeDiscolouration;
#include <fog_pars_vertex>

const float SR_PI = 3.141592653589793;

vec2 srRotate2d(vec2 uv, float rotation) {
  return vec2(cos(rotation) * uv.x + sin(rotation) * uv.y, cos(rotation) * uv.y - sin(rotation) * uv.x);
}

float srInstanceNoise(vec2 position) {
  return fract(sin(dot(position, vec2(12.9898, 78.233))) * 43758.5453);
}

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
  float collapse = 0.0;
  if (uTierMode > 0.5) {
    collapse = isNear;
  } else if (uTierMode < -0.5) {
    collapse = far;
    // 3D 近树网格接管：近层实例在网格半径内让位。
    collapse = max(collapse, insideMeshRadius);
  }
  // 官方树卡/远景树用距离 dissolve 接管 LOD 交接，不再做硬性分层折叠；
  // 近树卡仍在 3D 网格半径内让位。
  if (uDynamicAlpha > 0.5) {
    collapse = insideMeshRadius;
  } else if (uBillboard > 0.5) {
    collapse = 0.0;
  }
  float phase = srInstanceNoise(instWorld.xz);

  vec3 transformed = position;
  transformed.xz *= aSize.x;
  transformed.y *= aSize.y;

  // slowroads 草丛变体裁剪：非冬季 0/1/3 号半高、2 号全高；冬季 2/3 号半高。
  // （官方只对草丛层做这条裁剪，树卡/远景树/护栏用整幅贴图。）
  if (uPaletteMode > 0.5 && uPaletteMode <= 1.5) {
    float cropY = 1.0 - 0.5 * step(0.5, abs(aCell - 2.0));
    if (uSeasonIndex == 3) {
      cropY = step(1.5, aCell) * 0.5;
    }
    transformed.y *= cropY;
  }

  float wind = uWindStrength * (1.0 - far) * transformed.y * transformed.y;
  transformed.x += sin(uTime * 1.7 + phase * 6.28318) * wind;
  transformed.z += cos(uTime * 1.31 + phase * 5.17) * wind * 0.6;
  if (collapse > 0.5) {
    transformed = vec3(0.0);
  }
  if (aPlane > 0.5 && (far > 0.5 || uSinglePlane > 0.5)) {
    transformed = vec3(0.0);
  }

  // 官方 per-instance shadow（树密度）：与地形同源的密度图近似，
  // 草丛/灌木的 fresnel 与树卡的环境调制都用它。
  float treeShadow = 0.0;
  float instanceDensity = 0.0;
  if (uUseDensityShadow > 0.5) {
    instanceDensity = clamp(texture2D(uDensityMap, (instWorld.xz + uWorldHalf) / uWorldSize).r * 1.15, 0.0, 1.0);
    treeShadow = min(1.0, instanceDensity * min(1.0, max(0.0, instWorld.y / 4.0)));
  }
  vShadow = treeShadow * uShadowFactor;

  vec2 atlasUv = mix(aUvRect.xy, aUvRect.zw, uv);
  float dissolveRandom = 0.5 + 0.5 * srInstanceNoise(instWorld.zx);
  float viewDepthOrigin = -(viewMatrix * instWorld).z;
  vUvOffset = vec2(0.0);
  vUvBlend = vec2(0.0);
  vAngleBlend = 0.0;
  vDissolve = 0.0;

  if (uBillboard > 0.5) {
    // 官方 imposter（Nu chunk）：朝相机旋转 + crop/taper + 16 朝向列 + 角度混列 +
    // 距离放大 30%/下沉 4m + 距离 dissolve（近处隐藏、远处出现）。
    float angleToCamera = atan(instWorld.x - uCameraPos.x, instWorld.z - uCameraPos.z);
    transformed.xz = srRotate2d(transformed.xz, angleToCamera);
    float cropX = 0.8 - uSpecies * 0.1;
    cropX *= 1.0 - step(0.5, uSpecies) * uv.y * 4.0 * 0.6;
    transformed.xz *= cropX;
    // 官方 imposter 几何是"单格 UV"（x ∈ [0,1/16]、y ∈ [0,1/4]）；lab 的十字面片是整幅
    // UV，所以这里换算成单格 UV 后再套官方公式。
    vec2 cellUv = vec2(uv.x / 16.0, uv.y * 0.25);
    atlasUv = vec2(((cellUv.x * 16.0 * cropX) + ((1.0 - cropX) * 0.5)) / 16.0, cellUv.y);
    vUvBlend = vec2(cellUv.x * 21.32, cellUv.y * 4.0);
    float oriented = angleToCamera - aOrientation;
    if (oriented > SR_PI) {
      oriented -= SR_PI * 2.0;
    } else if (oriented < -SR_PI) {
      oriented += SR_PI * 2.0;
    }
    float tileIndex = (oriented + SR_PI) / (SR_PI * 2.0 / 16.0);
    vUvOffset = vec2((1.0 / 16.0) * floor(tileIndex), aCell / 4.0);
    vAngleBlend = (tileIndex - floor(tileIndex)) * step(viewDepthOrigin, 400.0);
    float imposterCamDist = clamp((viewDepthOrigin - 200.0) / 800.0, 0.0, 1.0);
    transformed *= 1.0 + imposterCamDist * 0.3;
    transformed.y -= imposterCamDist * 4.0;
    vDissolve = 1.0 - clamp((viewDepthOrigin - uDissolveNear) / uDissolveInterval, 0.0, 1.0);
    vDissolve *= dissolveRandom;
    transformed *= 1.0 - step(0.999, vDissolve);
  }

  // 官方树卡变色（顶点分块 un / Jg）：
  //   discolouration = 1.0 + (texture2D(noiseMap, wPos.xz / 256.0).r - 0.5) * discolourationFactor;
  //   if(vMapUv.x > 0.76) discolouration = discolouration * 0.5 + 0.5;   // 柏树兜底
  // preset.effects.treeDiscolouration 是**幅度**而非乘数：冬季 0.2 只让乘数在 0.9..1.1 之间
  // 抖动（此前误当乘数 → 绿通道被砍到 20%，只剩蓝通道 ⇒ 冬季树卡发紫）。
  vTreeDiscolouration = 1.0;
  if (uDynamicAlpha > 0.5 || uBillboard > 0.5) {
    vTreeDiscolouration = 1.0
      + (texture2D(uTreeDiscolourationNoise, instWorld.xz / 256.0).r - 0.5) * uTreeDiscolourationFactor;
    // 柏树列兜底只存在于近树（树卡/近树网格）路径，imposter 图集的 x 是朝向列，不做该处理。
    if (uBillboard < 0.5 && (atlasUv.x + vUvOffset.x) > 0.76) {
      vTreeDiscolouration = vTreeDiscolouration * 0.5 + 0.5;
    }
  }

  vUv = atlasUv;
  vCell = aCell;
  vRoadProx = aRoadProx;
  vInstancePos = instWorld.xyz;
  vGroundNormal = aGroundNormal;
  vCardUv = uv;
  // 官方灌木自发光权重：叶片底部渐暗（vAO = clamp(position.y, 0, .5) * 2）。
  vAO = clamp(position.y, 0.0, 0.5) * 2.0;
  // 官方树冠辉光权重：视深衰减 + 树干变暗（uv 变体）。
  vec4 worldPosition = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  vec4 mvPosition = viewMatrix * worldPosition;
  float viewDepth = -mvPosition.z;
  vRadianceBlend = 1.0 - clamp((viewDepth - 50.0) / 200.0, 0.0, 1.0) * 0.33;
  vLeafBrightness = 1.0 - 0.25 * uShadowFactor * clamp((0.25 - uv.y) / 0.08, 0.0, 1.0);
  vAlphaTest = 0.0;
  if (uBillboard > 0.5) {
    // 官方 imposter：辉光权重再乘 max(0.5, leafBrightness)。
    vRadianceBlend *= max(0.5, vLeafBrightness);
  }
  // 官方灌木顶点规则：近处 0.5，随视深衰减到 0.2（仅灌木层生效）。
  if (uDistanceAlpha > 0.5) {
    vAlphaTest = viewDepth < 10.0 ? 0.5 : max(0.2, 0.5 - (viewDepth - 10.0) / 110.0);
  }
  if (uDynamicAlpha > 0.5) {
    // 官方近树卡：dissolve 由近及远 0→1；alphaTest 随距离放宽（放到 0.3/原值下限）；
    // vLeafBrightness = 1 - density × shadowFactor × saturate((10 - 模型高度m)/3)：
    // 密林里树木下半部最多压到 ×0.2，并同时参与 leafEffect（变色 + 叶辉光）。
    vDissolve = clamp((viewDepth - uDissolveNear) / uDissolveInterval, 0.0, 1.0);
    vDissolve *= dissolveRandom;
    vAlphaTest = uAlphaTest;
    if (uDissolveFar > 200.0) {
      if (viewDepth < uDissolveFar) {
        vAlphaTest = max(0.3, uAlphaTest * (1.0 - viewDepth / (uDissolveFar + uDissolveInterval)));
      }
    } else if (viewDepth < 200.0) {
      vAlphaTest = max(0.3, uAlphaTest * (1.0 - viewDepth / 300.0));
    }
    float heightScale = 1.0;
    #ifdef USE_INSTANCING
      // 实例矩阵的 Y 轴长度 = unitSize × 实例缩放 ⇒ 单位方片的高度换算成米。
      heightScale = length(instanceMatrix[1].xyz);
    #endif
    float heightMeters = position.y * max(aSize.y, 0.001) * heightScale;
    vLeafBrightness = 1.0 - instanceDensity * uShadowFactor
      * clamp((10.0 - heightMeters) / 3.0, 0.0, 1.0);
  }

  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const FRAGMENT_SHADER = `
${LANDSCAPE_LIGHT_GLSL}
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
uniform float uAlphaTest;
/** 官方树卡变色乘数（顶点按噪声幅度算好：≈1±factor/2）。 */
varying float vTreeDiscolouration;
uniform float uHasSnow;
uniform float uSpecies;
uniform float uHasNormalMap;
uniform float uDynamicAlpha;
uniform float uBillboard;
varying vec2 vUv;
varying vec2 vUvOffset;
varying vec2 vUvBlend;
varying float vAngleBlend;
varying float vCell;
varying vec3 vInstancePos;
varying float vRoadProx;
varying float vRadianceBlend;
varying float vLeafBrightness;
varying float vAlphaTest;
varying float vAO;
varying float vShadow;
varying float vDissolve;
varying vec3 vGroundNormal;
varying vec2 vCardUv;
#include <fog_pars_fragment>

float screen(float a, float b) { return 1.0 - ((1.0 - a) * (1.0 - b)); }

/** 官方 grass 顶点里的 cameraDist：实例到相机的水平距离平方。 */
float srCameraDistSq(vec3 worldPos) {
  vec2 delta = worldPos.xz - cameraPosition.xz;
  return dot(delta, delta);
}

void main() {
  vec4 texel = texture2D(uAtlas, vUv + vUvOffset);
  float cutAlpha = max(uAlphaTest, vAlphaTest);
  if (uDynamicAlpha > 0.5) {
    // 官方近树卡（Lu）：noise dissolve 抠洞，随后用动态 alphaTest 裁切。
    if (vDissolve > 0.999 || texture2D(uNoiseMap, vCardUv).r < vDissolve) discard;
    cutAlpha = vAlphaTest;
  } else if (uBillboard > 0.5) {
    // 官方 imposter（Bu）：先按视角在相邻朝向列之间混合，再按 dissolve 抠洞。
    if (vDissolve > 0.999) discard;
    float blendNoise = 0.0;
    if (vAngleBlend > 0.0) {
      blendNoise = texture2D(uNoiseMap, vUvBlend).r;
      vec2 blendUv = vUv + vUvOffset + vec2(1.0 / 16.0, 0.0);
      if (blendUv.x > 1.0) {
        blendUv.x -= 1.0;
      }
      texel = mix(texel, texture2D(uAtlas, blendUv), step(blendNoise, vAngleBlend));
      texel.a *= step(vDissolve, blendNoise);
    }
  }
  // 官方 alphaMap 走绿通道（three 语义）。
  float alpha = mix(texel.a, texture2D(uAlphaTex, vUv).g, uHasAlphaTex);
  if (alpha < cutAlpha) discard;
  vec3 color = texel.rgb * uTint;

  // ---- slowroads 草丛调色板 -------------------------------------------------
  if (uPaletteMode > 1.5) {
    // 灌木 / 花草：官方保留贴图自身颜色（无 dapple/实例 tint），自发光乘 vAO。
    color = texel.rgb * uTint;
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
      color = texel.rgb * grassCol * detailNoise * uTint;
    } else {
      // heather 草球：保留自身颜色 + 轻微斑驳亮度。
      if (texel.a < 0.98) discard;
      float dapple = 1.0 + (texture2D(uNoiseMap, vInstancePos.xz / 10.0).r - 0.6);
      color = texel.rgb * dapple * uTint;
    }
  }

  // ---- 树卡 / 远景树：leafEffect 变色 + 冬季阔叶积雪 --------------------------
  float leafEffect = 0.0;
  vec3 emissive = vec3(0.0);
  if (uPaletteMode < 0.5 && uBillboard > 0.5) {
    // 官方 imposter 叶色：阔叶用 discolouration 直接缩放 rg 并走叶辉光；针叶只压绿。
    if (uSpecies < 0.5) {
      color.rg *= vTreeDiscolouration;
      emissive = vec3(color.rg * 8.0, 0.5) * uRadiance * vRadianceBlend * vLeafBrightness;
    } else {
      color.g *= vTreeDiscolouration;
    }
    color *= vRadianceBlend;
  } else if (uPaletteMode < 0.5) {
    // 官方 lit26（近树卡）：leafEffect 含 vLeafBrightness；emissive 先按未压暗的反照率计算，
    // 之后 diffuse 再整体乘 vRadianceBlend。
    leafEffect = step(color.b * 1.5, color.g) * vLeafBrightness;
    color.rg *= 1.0 - (1.0 - vTreeDiscolouration) * leafEffect;
    emissive = vec3(color.rg * 8.0, 0.5) * uRadiance * leafEffect * vRadianceBlend;
    color *= vRadianceBlend;
  }
  // 草/灌木自发光必须在 fresnel 之前取值（官方 texelColor × radiance 在 map_fragment 里）。
  if (uPaletteMode > 0.5) {
    if (uPaletteMode > 1.5) {
      // 灌木：官方 texelColor × radiance × vAO。
      emissive = color * uRadiance * vAO;
    } else {
      // 草丛：官方 texelColor × radiance（must match the ground）。
      emissive = color * uRadiance;
    }
  }

  // 草丛/灌木用官方 groundNormal 受光（树卡填 (0,1,0)，与官方树卡法线近似一致）。
  float ndl = clamp(dot(vGroundNormal, uSunDir), -1.0, 1.0) * 0.5 + 0.5;
  float snowUp = 0.5;
  if (uHasNormalTex > 0.5) {
    vec3 n = texture2D(uNormalTex, vUv).xyz * 2.0 - 1.0;
    vec3 billboardNormal = normalize(vec3(n.x * 0.55, n.y * 0.55 + 0.8, n.z * 0.35));
    ndl = clamp(dot(billboardNormal, uSunDir), -1.0, 1.0) * 0.5 + 0.5;
    snowUp = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
  }
  if (uHasSnow > 0.5 && uSpecies < 0.5) {
    if (uDynamicAlpha > 0.5) {
      // 官方近树卡积雪（Cu）：朝上的树冠按 dotUp 平滑变白。
      color = mix(color, vec3(min(1.0, 0.5 + snowUp)), clamp((snowUp - 0.1) * 8.0, 0.0, 1.0));
    } else if (uBillboard > 0.5) {
      // 官方远景树积雪：up>0 即混白，越朝上越白。
      color = mix(color, vec3(1.0), clamp(snowUp * 8.0, 0.0, 1.0));
    } else {
      color = mix(color, vec3(1.0), clamp(snowUp * 1.2, 0.0, 1.0) * 0.8);
    }
  }

  // ---- 官方草丛掠射边缘光（Zu）：视线贴近地表时草尖提亮 + darkFresnel 压暗 ----
  if (uPaletteMode > 0.5 && uPaletteMode <= 1.5) {
    vec3 fresnelPos = vInstancePos;
    fresnelPos.y -= 1.0;
    float fresnel = 1.0 - max(0.0, dot(normalize(cameraPosition - fresnelPos), vGroundNormal));
    float doColor = step(vCell, 2.5);
    float lightFresnel = max(0.0, (fresnel - 0.75)) * 4.0 * clamp(vUv.y * 3.0, 0.7, 0.9);
    lightFresnel *= lightFresnel;
    lightFresnel *= (1.0 - vShadow);
    lightFresnel *= min(1.0, srCameraDistSq(vInstancePos) / 100.0);
    lightFresnel *= uFresnelIntensity;
    lightFresnel *= max(doColor, 0.5);
    float darkFresnel = 1.0 - min(1.0, fresnel * 1.3333);
    darkFresnel *= uFresnelIntensity;
    darkFresnel *= 0.5;
    darkFresnel = 0.25 + min(0.25, max(0.0, darkFresnel - 0.25) * 0.5);
    color *= 1.0 + lightFresnel - darkFresnel;
  }

  // ---- 官方光照与自发光合成 ----
  color = srLandscapeLight(color, ndl, 1.0, emissive);

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
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
  const groundNormalAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
  const orientationAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
  geometry.setAttribute('aUvRect', uvRectAttribute)
  geometry.setAttribute('aSize', sizeAttribute)
  geometry.setAttribute('aCell', cellAttribute)
  geometry.setAttribute('aRoadProx', roadProxAttribute)
  geometry.setAttribute('aGroundNormal', groundNormalAttribute)
  geometry.setAttribute('aOrientation', orientationAttribute)

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
      uNoiseMap: { value: palette?.noiseMap ?? options.noiseMap ?? atlasTexture },
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
      // 官方预设的 treeDiscolouration 是噪声幅度（顶点按 1±factor/2 换算成变色乘数）。
      uTreeDiscolourationFactor: { value: options.tree ? options.tree.discolouration : 0 },
      // 变色噪声与 dissolve 共用同一张 noiseMap（官方 Ui）；非树层因子为 0，取样被跳过。
      uTreeDiscolourationNoise: { value: options.noiseMap ?? atlasTexture },
      uHasSnow: { value: options.tree?.hasSnow ? 1 : 0 },
      uSpecies: { value: options.tree ? options.tree.species : 0 },
      uTint: { value: new THREE.Color(options.tint) },
      // 官方逐层/季 alphaTest；灌木另有随视深的距离 alpha（顶点规则）。
      uAlphaTest: { value: options.alphaTest },
      uTime: options.shared.time,
      uCameraPos: options.shared.cameraPosition,
      uNearDistance: options.shared.nearDistance,
      uMeshRadius: options.shared.meshRadius,
      uTierMode: { value: TIER_MODE[options.tier ?? 'all'] },
      uSinglePlane: { value: options.singlePlane ? 1 : 0 },
      uDistanceAlpha: { value: options.distanceAlpha ? 1 : 0 },
      // 官方树卡/远景树 LOD：近树卡 = 动态 alpha + 距离 dissolve，远景树 = 朝相机广告牌。
      uDynamicAlpha: { value: options.card?.kind === 'near' ? 1 : 0 },
      uBillboard: { value: options.card?.kind === 'far' ? 1 : 0 },
      uDissolveNear: { value: options.card?.dissolveNear ?? 100 },
      uDissolveFar: { value: options.card?.dissolveFar ?? 200 },
      uDissolveInterval: { value: Math.max(1e-3, options.card?.dissolveInterval ?? 100) },
      uUseDensityShadow: { value: options.densityMap ? 1 : 0 },
      uDensityMap: { value: options.densityMap ?? atlasTexture },
      uWorldSize: { value: options.worldSize ?? 1 },
      uWorldHalf: { value: (options.worldSize ?? 2) * 0.5 },
      // Per-mesh so grass / bush / tree can sway with different amplitudes.
      uWindStrength: { value: options.shared.windStrength.value },
      // 官方光照（环境控制器按预设下发；树卡 radiance = 地表的一半）。
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0.84, 0.82, 0.73) },
      uAmbientColor: { value: new THREE.Color(0.22, 0.3, 0.12) },
      uHemiColor: { value: new THREE.Color(1.39, 1.36, 1.18) },
      uRadiance: { value: options.tree ? 1 : 2 },
      uShadowFactor: { value: 1 },
      uFresnelIntensity: { value: 1 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    fog: true,
    // Crossed sprite cards are viewed from both sides.
    side: THREE.DoubleSide,
  })
  material.name = `slowroads-foliage-${options.palette?.mode ?? 'none'}-${options.tier ?? 'all'}`
  material.userData.radianceScale = options.tree ? 0.5 : 1

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
    // 远景树使用朝相机广告牌：实例旋转作为图集朝向基准角，矩阵本身不带旋转。
    eulerHelper.set(0, options.card?.kind === 'far' ? 0 : instance.rotation, 0)
    quaternionHelper.setFromEuler(eulerHelper)
    const scale = baseScale * instance.scale
    scaleHelper.set(scale, scale, scale)
    matrixHelper.compose(positionHelper, quaternionHelper, scaleHelper)
    mesh.setMatrixAt(i, matrixHelper)
    uvRectAttribute.setXYZW(i, region.u0, region.v0, region.u1, region.v1)
    sizeAttribute.setXY(i, region.aspect * region.heightScale, region.heightScale)
    cellAttribute.setX(i, instance.cell ?? instance.variant)
    roadProxAttribute.setX(i, instance.roadProx ?? 0)
    groundNormalAttribute.setXYZ(i, instance.nx ?? 0, instance.ny ?? 1, instance.nz ?? 0)
    orientationAttribute.setX(i, instance.rotation)
  }
  mesh.instanceMatrix.needsUpdate = true
  uvRectAttribute.needsUpdate = true
  sizeAttribute.needsUpdate = true
  cellAttribute.needsUpdate = true
  roadProxAttribute.needsUpdate = true
  groundNormalAttribute.needsUpdate = true
  orientationAttribute.needsUpdate = true
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
