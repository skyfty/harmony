import * as THREE from 'three'
import { SEASON_PARAMS } from '../slowroads/core/seasonParams'
import type { SeasonId } from '../slowroads/core/seasonCatalog'
import type { SpriteRegion } from '../slowroads/core/spriteRegions'
import { injectSlowroadsFog } from '../slowroads/render/fogInjection'
import { recordSlowroadsShaderAudit } from './shaderAudit'

/**
 * slowroads 风格精灵植被（交叉面片 + 每实例图集区域 + 季节调色板），
 * 注入 MeshLambertMaterial（官方同材质族；无镜面），光照/CSM 走 three 管线，
 * 雾走共享三色雾。
 *
 * 与 slowroads-lab 逐项对齐（第一/二/三/六批）：
 *  - 每实例属性：aPlUvRect / aPlSize / aPlCell / aPlRoadProx +
 *    aPlGroundNormal（草丛/灌木受光与 fresnel 方向）+ aPlOrientation（远景树朝向基准）；
 *  - 逐层/季 alphaTest（草 .5/冬 .2、灌木 .2/冬 .3 + 随视深 0.5→0.2、
 *    近树卡阔叶 .5/针叶 .4、远景树 .6/冬 .5、护栏 .35）；
 *  - 草丛官方调色板 + 掠射边缘光（Zu）；灌木去 dapple/随机 tint，
 *    自发光 = `texel × radiance × vAO`；
 *  - 树卡变色按官方语义：顶点用噪声幅度换算成 ≈1 的乘数（柏树列 `*0.5+0.5` 兜底），
 *    片元消费 varying（把「因子当乘数」的冬季洋红缺陷钉死）；
 *  - 近树卡 = 动态 alphaTest + 距离 dissolve + 密度树影（vLeafBrightness）；
 *    远景树 = 朝相机广告牌（16 朝向列 + 角度混列 + 距离放大/下沉 + dissolve）；
 *  - 冬季阔叶积雪：近树卡 `Cu`（dotUp 平滑）、远景树 up 混白。
 *  - 合成走官方补丁 `direct + indirect + direct × totalEmissiveRadiance`。
 */

export interface FoliageShaderUniforms {
  time: THREE.IUniform<number>
  cameraPosition: THREE.IUniform<THREE.Vector3>
  nearDistance: THREE.IUniform<number>
  /** >0 时近层实例在半径内折叠（3D 近树接管）。 */
  meshRadius: THREE.IUniform<number>
}

export function createFoliageShaderUniforms(): FoliageShaderUniforms {
  return {
    time: { value: 0 },
    cameraPosition: { value: new THREE.Vector3() },
    nearDistance: { value: 190 },
    meshRadius: { value: 0 },
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
  geometry.setAttribute('aPlPlane', new THREE.BufferAttribute(planes, 1))
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), Math.SQRT2)
  return geometry
}

const VERTEX_PARS = /* glsl */ `
attribute float aPlPlane;
attribute vec4 aPlUvRect;
attribute vec2 aPlSize;
attribute float aPlCell;
attribute float aPlRoadProx;
/** 官方 per-instance groundNormal（草丛/灌木受光与 fresnel 方向）；缺省 (0,1,0)。 */
attribute vec3 aPlGroundNormal;
/** 远景树（imposter）的朝向基准角；普通层为 0。 */
attribute float aPlOrientation;
uniform float uPlTime;
uniform vec3 uPlCameraPos;
uniform float uPlNearDistance;
uniform float uPlMeshRadius;
uniform float uPlTierMode;
uniform float uPlSinglePlane;
uniform float uPlWindStrength;
uniform float uPlDistanceAlpha;
uniform float uPlPaletteMode;
/** 1 = 近树卡：官方动态 alphaTest + 距离 dissolve + 模型高度 leafBrightness。 */
uniform float uPlDynamicAlpha;
/** 1 = 远景树：官方 imposter（朝相机广告牌 + 16 朝向列 + 角度混列 + 距离放大/下沉）。 */
uniform float uPlBillboard;
uniform int uPlSeasonIndex;
uniform float uPlShadowFactor;
uniform float uPlSpecies;
uniform float uPlDissolveNear;
uniform float uPlDissolveFar;
uniform float uPlDissolveInterval;
uniform float uPlAlphaTest;
/** 1 = 用树密度图近似官方 per-instance shadow（草/灌木/近树卡）。 */
uniform float uPlUseDensityShadow;
uniform sampler2D uPlDensityMap;
uniform vec2 uPlDensityMin;
uniform vec2 uPlDensitySize;
/** 官方 effects.treeDiscolouration：噪声变色幅度（不是乘数）。 */
uniform float uPlTreeDiscolourationFactor;
/** 官方树卡变色噪声（与 dissolve 共用 noiseMap；uv = 实例世界坐标 / 256）。 */
uniform sampler2D uPlTreeDiscolourationNoise;
varying vec2 vPlUv;
varying vec2 vPlUvOffset;
varying vec2 vPlUvBlend;
varying float vPlAngleBlend;
varying float vPlCell;
varying vec3 vPlInstancePos;
varying float vPlRoadProx;
varying float vPlRadianceBlend;
varying float vPlLeafBrightness;
varying float vPlAlphaTest;
varying float vPlAO;
varying float vPlShadow;
varying float vPlDissolve;
varying vec3 vPlGroundNormal;
varying vec2 vPlCardUv;
varying float vPlTreeDiscolouration;
`

const VERTEX_BODY = /* glsl */ `
#include <begin_vertex>
{
  #ifdef USE_INSTANCING
    vec4 plInstWorld = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  #else
    vec4 plInstWorld = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  #endif
  float plDist = distance(plInstWorld.xyz, uPlCameraPos);
  float plIsNear = step(plDist, uPlNearDistance);
  float plInsideMeshRadius = step(plDist, uPlMeshRadius);
  float plFar = 1.0 - plIsNear;
  float plCollapse = 0.0;
  if (uPlTierMode > 0.5) {
    plCollapse = plIsNear;
  } else if (uPlTierMode < -0.5) {
    plCollapse = plFar;
    plCollapse = max(plCollapse, plInsideMeshRadius);
  }
  // 官方树卡/远景树用距离 dissolve 接管 LOD 交接，不再做硬性分层折叠；
  // 近树卡仍在 3D 网格半径内让位。
  if (uPlDynamicAlpha > 0.5) {
    plCollapse = plInsideMeshRadius;
  } else if (uPlBillboard > 0.5) {
    plCollapse = 0.0;
  }
  float plPhase = fract(sin(dot(plInstWorld.xz, vec2(12.9898, 78.233))) * 43758.5453);

  transformed.xz *= aPlSize.x;
  transformed.y *= aPlSize.y;

  // slowroads 草丛变体裁剪：非冬季 0/1/3 号半高、2 号全高；冬季 2/3 号半高。
  // （官方只对草丛层做这条裁剪，树卡/远景树/护栏用整幅贴图。）
  if (uPlPaletteMode > 0.5 && uPlPaletteMode <= 1.5) {
    float plCropY = 1.0 - 0.5 * step(0.5, abs(aPlCell - 2.0));
    if (uPlSeasonIndex == 3) {
      plCropY = step(1.5, aPlCell) * 0.5;
    }
    transformed.y *= plCropY;
  }

  float plWind = uPlWindStrength * (1.0 - plFar) * transformed.y * transformed.y;
  transformed.x += sin(uPlTime * 1.7 + plPhase * 6.28318) * plWind;
  transformed.z += cos(uPlTime * 1.31 + plPhase * 5.17) * plWind * 0.6;
  if (plCollapse > 0.5) {
    transformed = vec3(0.0);
  }
  if (aPlPlane > 0.5 && (plFar > 0.5 || uPlSinglePlane > 0.5)) {
    transformed = vec3(0.0);
  }

  // 官方 per-instance shadow（树密度图）：草/灌木的 fresnel 与近树卡的环境调制都用它。
  float plTreeShadow = 0.0;
  float plInstanceDensity = 0.0;
  if (uPlUseDensityShadow > 0.5) {
    vec2 plDensityUv = (plInstWorld.xz - uPlDensityMin) / max(uPlDensitySize, vec2(0.0001));
    plInstanceDensity = clamp(texture2D(uPlDensityMap, plDensityUv).r * 1.15, 0.0, 1.0);
    plTreeShadow = min(1.0, plInstanceDensity * min(1.0, max(0.0, plInstWorld.y / 4.0)));
  }
  vPlShadow = plTreeShadow * uPlShadowFactor;

  vec2 plAtlasUv = mix(aPlUvRect.xy, aPlUvRect.zw, uv);
  float plDissolveRandom = 0.5 + 0.5 * fract(sin(dot(plInstWorld.zx, vec2(12.9898, 78.233))) * 43758.5453);
  float plViewDepthOrigin = -(viewMatrix * plInstWorld).z;
  vPlUvOffset = vec2(0.0);
  vPlUvBlend = vec2(0.0);
  vPlAngleBlend = 0.0;
  vPlDissolve = 0.0;

  if (uPlBillboard > 0.5) {
    // 官方 imposter：朝相机旋转 + crop/taper + 16 朝向列 + 角度混列 +
    // 距离放大 30%/下沉 4m + 距离 dissolve（近处隐藏、远处出现）。
    float plAngleToCamera = atan(plInstWorld.x - uPlCameraPos.x, plInstWorld.z - uPlCameraPos.z);
    vec2 plRotatedXz = vec2(
      cos(plAngleToCamera) * transformed.x + sin(plAngleToCamera) * transformed.z,
      cos(plAngleToCamera) * transformed.z - sin(plAngleToCamera) * transformed.x
    );
    transformed.xz = plRotatedXz;
    float plCropX = 0.8 - uPlSpecies * 0.1;
    plCropX *= 1.0 - step(0.5, uPlSpecies) * uv.y * 4.0 * 0.6;
    transformed.xz *= plCropX;
    // 官方 imposter 几何是"单格 UV"（x ∈ [0,1/16]、y ∈ [0,1/4]）；十字面片是整幅
    // UV，这里换算成单格 UV 后再套官方公式。
    vec2 plCellUv = vec2(uv.x / 16.0, uv.y * 0.25);
    plAtlasUv = vec2(((plCellUv.x * 16.0 * plCropX) + ((1.0 - plCropX) * 0.5)) / 16.0, plCellUv.y);
    vPlUvBlend = vec2(plCellUv.x * 21.32, plCellUv.y * 4.0);
    float plOriented = plAngleToCamera - aPlOrientation;
    if (plOriented > 3.141592653589793) {
      plOriented -= 3.141592653589793 * 2.0;
    } else if (plOriented < -3.141592653589793) {
      plOriented += 3.141592653589793 * 2.0;
    }
    float plTileIndex = (plOriented + 3.141592653589793) / (3.141592653589793 * 2.0 / 16.0);
    vPlUvOffset = vec2((1.0 / 16.0) * floor(plTileIndex), aPlCell / 4.0);
    vPlAngleBlend = (plTileIndex - floor(plTileIndex)) * step(plViewDepthOrigin, 400.0);
    float plImposterCamDist = clamp((plViewDepthOrigin - 200.0) / 800.0, 0.0, 1.0);
    transformed *= 1.0 + plImposterCamDist * 0.3;
    transformed.y -= plImposterCamDist * 4.0;
    vPlDissolve = 1.0 - clamp((plViewDepthOrigin - uPlDissolveNear) / uPlDissolveInterval, 0.0, 1.0);
    vPlDissolve *= plDissolveRandom;
    transformed *= 1.0 - step(0.999, vPlDissolve);
  }

  // 官方树卡变色（顶点分块）：
  //   discolouration = 1.0 + (texture2D(noiseMap, wPos.xz / 256.0).r - 0.5) * discolourationFactor;
  //   if(vMapUv.x > 0.76) discolouration = discolouration * 0.5 + 0.5;   // 柏树列兜底
  // preset.effects.treeDiscolouration 是**幅度**而非乘数：冬季 0.2 只让乘数在 0.9..1.1 之间
  // 抖动（此前误当乘数 → 绿通道被砍到 20%，只剩蓝通道 ⇒ 冬季树卡发紫）。
  vPlTreeDiscolouration = 1.0;
  if (uPlDynamicAlpha > 0.5 || uPlBillboard > 0.5) {
    vPlTreeDiscolouration = 1.0
      + (texture2D(uPlTreeDiscolourationNoise, plInstWorld.xz / 256.0).r - 0.5) * uPlTreeDiscolourationFactor;
    // 柏树列兜底只存在于近树（树卡/近树网格）路径，imposter 图集的 x 是朝向列，不做该处理。
    if (uPlBillboard < 0.5 && (plAtlasUv.x + vPlUvOffset.x) > 0.76) {
      vPlTreeDiscolouration = vPlTreeDiscolouration * 0.5 + 0.5;
    }
  }

  vPlUv = plAtlasUv;
  vPlCell = aPlCell;
  vPlRoadProx = aPlRoadProx;
  vPlInstancePos = plInstWorld.xyz;
  vPlGroundNormal = aPlGroundNormal;
  vPlCardUv = uv;
  // 官方灌木自发光权重：叶片底部渐暗（vAO = clamp(position.y, 0, .5) * 2）。
  vPlAO = clamp(position.y, 0.0, 0.5) * 2.0;

  #ifdef USE_INSTANCING
    vec4 plWorldPosition = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  #else
    vec4 plWorldPosition = modelMatrix * vec4(transformed, 1.0);
  #endif
  vec4 plMvPosition = viewMatrix * plWorldPosition;
  float plViewDepth = -plMvPosition.z;
  vPlRadianceBlend = 1.0 - clamp((plViewDepth - 50.0) / 200.0, 0.0, 1.0) * 0.33;
  vPlLeafBrightness = 1.0 - 0.25 * uPlShadowFactor * clamp((0.25 - uv.y) / 0.08, 0.0, 1.0);
  vPlAlphaTest = 0.0;
  if (uPlBillboard > 0.5) {
    // 官方 imposter：辉光权重再乘 max(0.5, leafBrightness)。
    vPlRadianceBlend *= max(0.5, vPlLeafBrightness);
  }
  // 官方灌木顶点规则：近处 0.5，随视深衰减到 0.2（仅灌木层生效）。
  if (uPlDistanceAlpha > 0.5) {
    vPlAlphaTest = plViewDepth < 10.0 ? 0.5 : max(0.2, 0.5 - (plViewDepth - 10.0) / 110.0);
  }
  if (uPlDynamicAlpha > 0.5) {
    // 官方近树卡：dissolve 由近及远 0→1；alphaTest 随距离放宽（放到 0.3/原值下限）；
    // vLeafBrightness = 1 - density × shadowFactor × saturate((10 - 模型高度m)/3)。
    vPlDissolve = clamp((plViewDepth - uPlDissolveNear) / uPlDissolveInterval, 0.0, 1.0);
    vPlDissolve *= plDissolveRandom;
    vPlAlphaTest = uPlAlphaTest;
    if (uPlDissolveFar > 200.0) {
      if (plViewDepth < uPlDissolveFar) {
        vPlAlphaTest = max(0.3, uPlAlphaTest * (1.0 - plViewDepth / (uPlDissolveFar + uPlDissolveInterval)));
      }
    } else if (plViewDepth < 200.0) {
      vPlAlphaTest = max(0.3, uPlAlphaTest * (1.0 - plViewDepth / 300.0));
    }
    float plHeightScale = 1.0;
    #ifdef USE_INSTANCING
      // 实例矩阵的 Y 轴长度 = unitSize × 实例缩放 ⇒ 单位方片的高度换算成米。
      plHeightScale = length(instanceMatrix[1].xyz);
    #endif
    float plHeightMeters = position.y * max(aPlSize.y, 0.001) * plHeightScale;
    vPlLeafBrightness = 1.0 - plInstanceDensity * uPlShadowFactor
      * clamp((10.0 - plHeightMeters) / 3.0, 0.0, 1.0);
  }
}
`

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uPlAtlas;
uniform sampler2D uPlAlphaTex;
uniform sampler2D uPlNormalTex;
uniform sampler2D uPlNoiseMap;
uniform sampler2D uPlGrassVariation;
uniform sampler2D uPlDetailFar;
uniform float uPlHasAlphaTex;
uniform float uPlHasNormalTex;
uniform float uPlPaletteMode;
uniform vec3 uPlPaletteA;
uniform vec3 uPlPaletteB;
uniform vec3 uPlPeakA;
uniform vec3 uPlPeakB;
uniform vec3 uPlFoliageTint;
uniform float uPlFarTintScale;
uniform float uPlAlphaTest;
uniform float uPlDynamicAlpha;
uniform float uPlBillboard;
uniform float uPlHasSnow;
uniform float uPlSpecies;
uniform float uPlRadiance;
uniform float uPlFresnelIntensity;
varying vec2 vPlUv;
varying vec2 vPlUvOffset;
varying vec2 vPlUvBlend;
varying float vPlAngleBlend;
varying float vPlCell;
varying vec3 vPlInstancePos;
varying float vPlRoadProx;
varying float vPlRadianceBlend;
varying float vPlLeafBrightness;
varying float vPlAlphaTest;
varying float vPlAO;
varying float vPlShadow;
varying float vPlDissolve;
varying vec3 vPlGroundNormal;
varying vec2 vPlCardUv;
varying float vPlTreeDiscolouration;

float plScreen2(float a, float b) { return 1.0 - ((1.0 - a) * (1.0 - b)); }

/** 官方 grass 顶点里的 cameraDist：实例到相机的水平距离平方。 */
float plCameraDistSq(vec3 worldPos) {
  vec2 delta = worldPos.xz - cameraPosition.xz;
  return dot(delta, delta);
}
`

/**
 * 着色法线覆写（替换 `#include <normal_fragment_begin>`）：
 * 植被统一用**每实例 groundNormal**（树卡/护栏为 (0,1,0)）在视空间求受光，
 * 与 slowroads-lab 的 `ndl = dot(vGroundNormal, uSunDir)` 同款。
 *
 * 关键：**不做 DoubleSide 的背面翻转**。three 默认会把背面的 `normal` 取反，
 * 十字叶卡的背面因此 `dot(N, sun) < 0` → direct = 0（只剩环境光）→ 从任何角度看
 * 都有一片朝向相机却发黑的面；lab 的植被着色器没有这一步，两面受光一致。
 */
const FOLIAGE_NORMAL_BODY = /* glsl */ `
float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
vec3 normal = normalize(mat3(viewMatrix) * vPlGroundNormal);
vec3 nonPerturbedNormal = normal;
`

const FRAGMENT_BODY = /* glsl */ `
{
  vec4 plTexel = texture2D(uPlAtlas, vPlUv + vPlUvOffset);
  float plCutAlpha = max(uPlAlphaTest, vPlAlphaTest);
  if (uPlDynamicAlpha > 0.5) {
    // 官方近树卡：noise dissolve 抠洞，随后用动态 alphaTest 裁切。
    if (vPlDissolve > 0.999 || texture2D(uPlNoiseMap, vPlCardUv).r < vPlDissolve) discard;
    plCutAlpha = vPlAlphaTest;
  } else if (uPlBillboard > 0.5) {
    // 官方 imposter：先按视角在相邻朝向列之间混合，再按 dissolve 抠洞。
    if (vPlDissolve > 0.999) discard;
    float plBlendNoise = 0.0;
    if (vPlAngleBlend > 0.0) {
      plBlendNoise = texture2D(uPlNoiseMap, vPlUvBlend).r;
      vec2 plBlendUv = vPlUv + vPlUvOffset + vec2(1.0 / 16.0, 0.0);
      if (plBlendUv.x > 1.0) {
        plBlendUv.x -= 1.0;
      }
      plTexel = mix(plTexel, texture2D(uPlAtlas, plBlendUv), step(plBlendNoise, vPlAngleBlend));
      plTexel.a *= step(vPlDissolve, plBlendNoise);
    }
  }
  // 官方 alphaMap 走绿通道（three 语义）。
  float plAlpha = mix(plTexel.a, texture2D(uPlAlphaTex, vPlUv).g, uPlHasAlphaTex);
  if (plAlpha < plCutAlpha) discard;
  vec3 plColor = plTexel.rgb * uPlFoliageTint;

  // ---- slowroads 草丛调色板 -------------------------------------------------
  if (uPlPaletteMode > 1.5) {
    // 灌木 / 花草：官方保留贴图自身颜色（无 dapple/实例 tint），自发光乘 vAO。
    plColor = plTexel.rgb * uPlFoliageTint;
  } else if (uPlPaletteMode > 0.5) {
    if (vPlCell < 2.5) {
      vec2 plUvA = vPlInstancePos.xz / 10.0;
      vec2 plUvB = plUvA / 16.0;
      float plFade0 = texture2D(uPlNoiseMap, plUvA).r;
      float plFade1 = texture2D(uPlNoiseMap, plUvB).r;
      float plVariationVal = texture2D(uPlGrassVariation, vPlInstancePos.xz / 2000.0).r - 0.5;
      float plCloseVariation = ((1.0 - texture2D(uPlGrassVariation, vPlInstancePos.xz / 500.0).r) - 0.5);

      float plHeightVal = min(1.0, max(0.0, (vPlInstancePos.y - (30.0 + plFade1 * 40.0)) / 150.0));
      float plLightGrass = min(1.0, plHeightVal * (plFade0 + plHeightVal * 0.5));
      float plDarkGrass = min(max(0.0, (plFade1 - 0.25) * 2.0), 1.0);
      if (vPlRoadProx < 0.5 + plFade1) {
        plLightGrass *= max(0.5, vPlRoadProx / max(0.0001, 0.5 + plFade1));
      }
      float plGrassBlend = (plScreen2(plFade0, plFade1) + plDarkGrass) / 2.0;
      plGrassBlend = plGrassBlend * plGrassBlend;
      plGrassBlend = clamp(plGrassBlend + plVariationVal + plCloseVariation, 0.0, 1.0);
      float plLightGrassFactor = clamp(plLightGrass + plVariationVal - plCloseVariation, 0.0, 1.0);
      plLightGrassFactor = clamp(plLightGrassFactor * 2.0 * plTexel.r, 0.0, 1.0);
      vec3 plGrassCol = mix(
        mix(uPlPaletteA, uPlPaletteB, plGrassBlend),
        mix(uPlPeakA, uPlPeakB, plGrassBlend),
        plLightGrassFactor
      );
      float plDetailNoise = 1.0 - (1.0 - texture2D(uPlDetailFar, vPlInstancePos.xz / 500.0).r) * 0.7;
      plColor = plTexel.rgb * plGrassCol * plDetailNoise * uPlFoliageTint;
    } else {
      // heather 草球：保留自身颜色 + 轻微斑驳亮度。
      if (plTexel.a < 0.98) discard;
      float plDapple = 1.0 + (texture2D(uPlNoiseMap, vPlInstancePos.xz / 10.0).r - 0.6);
      plColor = plTexel.rgb * plDapple * uPlFoliageTint;
    }
  }

  // ---- 树卡 / 远景树：leafEffect 变色 + 冬季阔叶积雪 --------------------------
  float plLeafEffect = 0.0;
  vec3 plEmissive = vec3(0.0);
  if (uPlPaletteMode < 0.5 && uPlBillboard > 0.5) {
    // 官方 imposter 叶色：阔叶用 discolouration 直接缩放 rg 并走叶辉光；针叶只压绿。
    if (uPlSpecies < 0.5) {
      plColor.rg *= vPlTreeDiscolouration;
      plEmissive = vec3(plColor.rg * 8.0, 0.5) * uPlRadiance * vPlRadianceBlend * vPlLeafBrightness;
    } else {
      plColor.g *= vPlTreeDiscolouration;
    }
    plColor *= vPlRadianceBlend;
  } else if (uPlPaletteMode < 0.5) {
    // 官方 lit26（近树卡/护栏）：leafEffect 含 vLeafBrightness；emissive 先按未压暗的
    // 反照率计算，之后 diffuse 再整体乘 vRadianceBlend。
    plLeafEffect = step(plColor.b * 1.5, plColor.g) * vPlLeafBrightness;
    plColor.rg *= 1.0 - (1.0 - vPlTreeDiscolouration) * plLeafEffect;
    plEmissive = vec3(plColor.rg * 8.0, 0.5) * uPlRadiance * plLeafEffect * vPlRadianceBlend;
    plColor *= vPlRadianceBlend;
  }
  // 草/灌木自发光必须在 fresnel 之前取值（官方 texelColor × radiance 在 map_fragment 里）。
  if (uPlPaletteMode > 0.5) {
    if (uPlPaletteMode > 1.5) {
      // 灌木：官方 texelColor × radiance × vAO。
      plEmissive = plColor * uPlRadiance * vPlAO;
    } else {
      // 草丛：官方 texelColor × radiance（must match the ground）。
      plEmissive = plColor * uPlRadiance;
    }
  }

  // 草丛/灌木用官方 groundNormal 受光；树卡/护栏的法线沿面片向上。
  float plNdl = clamp(dot(vPlGroundNormal, vec3(0.0, 1.0, 0.0)), -1.0, 1.0) * 0.5 + 0.5;
  float plSnowUp = 0.5;
  if (uPlHasNormalTex > 0.5) {
    vec3 plN = texture2D(uPlNormalTex, vPlUv).xyz * 2.0 - 1.0;
    vec3 plBillboardNormal = normalize(vec3(plN.x * 0.55, plN.y * 0.55 + 0.8, plN.z * 0.35));
    plNdl = clamp(dot(plBillboardNormal, vec3(0.0, 1.0, 0.0)), -1.0, 1.0) * 0.5 + 0.5;
    plSnowUp = clamp(plN.y * 0.5 + 0.5, 0.0, 1.0);
  }
  if (uPlHasSnow > 0.5 && uPlSpecies < 0.5) {
    if (uPlDynamicAlpha > 0.5) {
      // 官方近树卡积雪（Cu）：朝上的树冠按 dotUp 平滑变白。
      plColor = mix(plColor, vec3(min(1.0, 0.5 + plSnowUp)), clamp((plSnowUp - 0.1) * 8.0, 0.0, 1.0));
    } else if (uPlBillboard > 0.5) {
      // 官方远景树积雪：up>0 即混白，越朝上越白。
      plColor = mix(plColor, vec3(1.0), clamp(plSnowUp * 8.0, 0.0, 1.0));
    } else {
      plColor = mix(plColor, vec3(1.0), clamp(plSnowUp * 1.2, 0.0, 1.0) * 0.8);
    }
  }

  // ---- 官方草丛掠射边缘光（Zu）：视线贴近地表时草尖提亮 + darkFresnel 压暗 ----
  if (uPlPaletteMode > 0.5 && uPlPaletteMode <= 1.5) {
    vec3 plFresnelPos = vPlInstancePos;
    plFresnelPos.y -= 1.0;
    float plFresnel = 1.0 - max(0.0, dot(normalize(cameraPosition - plFresnelPos), vPlGroundNormal));
    float plDoColor = step(vPlCell, 2.5);
    float plLightFresnel = max(0.0, (plFresnel - 0.75)) * 4.0 * clamp(vPlCardUv.y * 3.0, 0.7, 0.9);
    plLightFresnel *= plLightFresnel;
    plLightFresnel *= (1.0 - vPlShadow);
    plLightFresnel *= min(1.0, plCameraDistSq(vPlInstancePos) / 100.0);
    plLightFresnel *= uPlFresnelIntensity;
    plLightFresnel *= max(plDoColor, 0.5);
    float plDarkFresnel = 1.0 - min(1.0, plFresnel * 1.3333);
    plDarkFresnel *= uPlFresnelIntensity;
    plDarkFresnel *= 0.5;
    plDarkFresnel = 0.25 + min(0.25, max(0.0, plDarkFresnel - 0.25) * 0.5);
    plColor *= 1.0 + plLightFresnel - plDarkFresnel;
  }

  totalEmissiveRadiance = plEmissive;
  diffuseColor = vec4(plColor, plAlpha);
}
`

export interface FoliageMaterialSpec {
  kind: 'grass' | 'bush' | 'tree' | 'barrier'
  tier: 'near' | 'far' | 'all'
  species: 0 | 1
  singlePlane: boolean
  tint: number
  farTintScale: number
  hasAlphaTexture: boolean
  hasNormalTexture: boolean
  /** 近树卡 = 'near'（动态 alpha + dissolve）；远景树 = 'far'（广告牌）；其它 null。 */
  card: 'near' | 'far' | null
  /** 灌木：随视深的距离 alpha（0.5 → 0.2）。 */
  distanceAlpha: boolean
  /** 用树密度图近似官方 per-instance shadow（草/灌木/近树卡）。 */
  useDensityShadow: boolean
  /** 材质缓存键（含图集身份/变体集，换季/换档位时生成新材质）。 */
  key: string
}

export interface FoliageMaterialSeasonState {
  season: SeasonId
  discolouration: number
  hasSnow: boolean
}

export interface FoliageMaterialHandle {
  material: THREE.MeshLambertMaterial
  uniforms: FoliageMaterialUniforms
  /** 近树卡/远景树的 dissolve 区间（由 runtime 按 forest.nearDistance 推出）。 */
  cardUniforms: {
    uPlDissolveNear: THREE.IUniform<number>
    uPlDissolveFar: THREE.IUniform<number>
    uPlDissolveInterval: THREE.IUniform<number>
  }
  spec: FoliageMaterialSpec
}

export interface FoliageMaterialUniforms {
  uPlRadiance: THREE.IUniform<number>
  uPlShadowFactor: THREE.IUniform<number>
  uPlFresnelIntensity: THREE.IUniform<number>
  uPlSeasonIndex: THREE.IUniform<number>
  uPlWindStrength: THREE.IUniform<number>
  uPlAlphaTest: THREE.IUniform<number>
  uPlPaletteA: THREE.IUniform<THREE.Color>
  uPlPaletteB: THREE.IUniform<THREE.Color>
  uPlPeakA: THREE.IUniform<THREE.Color>
  uPlPeakB: THREE.IUniform<THREE.Color>
  uPlTreeDiscolourationFactor: THREE.IUniform<number>
  uPlHasSnow: THREE.IUniform<number>
  uPlAtlas: THREE.IUniform<THREE.Texture | null>
  uPlAlphaTex: THREE.IUniform<THREE.Texture | null>
  uPlNormalTex: THREE.IUniform<THREE.Texture | null>
  uPlNoiseMap: THREE.IUniform<THREE.Texture | null>
  uPlGrassVariation: THREE.IUniform<THREE.Texture | null>
  uPlDetailFar: THREE.IUniform<THREE.Texture | null>
  uPlTreeDiscolourationNoise: THREE.IUniform<THREE.Texture | null>
  uPlDensityMap: THREE.IUniform<THREE.Texture | null>
  uPlDensityMin: THREE.IUniform<THREE.Vector2>
  uPlDensitySize: THREE.IUniform<THREE.Vector2>
}

const TIER_MODE: Record<'near' | 'far' | 'all', number> = { near: -1, all: 0, far: 1 }
const PALETTE_MODE: Record<'grass' | 'bush' | 'tree' | 'barrier', number> = { grass: 1, bush: 2, tree: 0, barrier: 0 }

/** 官方逐层/季 alphaTest（近树卡固定：阔叶 .5 map alpha / 针叶 .4 alpha map）。 */
export function resolveFoliageAlphaTest(spec: FoliageMaterialSpec, season: SeasonId): number {
  const params = SEASON_PARAMS[season]
  if (spec.kind === 'grass') {
    return params.grassAlphaTest
  }
  if (spec.kind === 'bush') {
    return params.bushAlphaTest
  }
  if (spec.kind === 'barrier') {
    return 0.35
  }
  if (spec.card === 'near') {
    return spec.species === 1 ? 0.4 : 0.5
  }
  return params.imposterAlphaTest
}

export function createFoliageMaterial(
  spec: FoliageMaterialSpec,
  shared: FoliageShaderUniforms,
  season: FoliageMaterialSeasonState,
): FoliageMaterialHandle {
  const material = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    // 逐层 alpha 裁切在片元体里按 uPlAlphaTest/vPlAlphaTest 处理；
    // three 的静态 alphaTest 保持 0，避免把草 .5 / 灌木 .2 压成同一个值。
    alphaTest: 0,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  })
  material.name = `slowroads-foliage-${spec.kind}-${spec.tier}`
  const seasonUniforms: FoliageMaterialUniforms = {
    // 树卡与远景树的官方 radiance 是地表的一半（oe.radiance = lights.radiance/2）。
    uPlRadiance: { value: spec.kind === 'tree' ? 1 : 2 },
    uPlShadowFactor: { value: 1 },
    uPlFresnelIntensity: { value: 1 },
    uPlSeasonIndex: { value: 0 },
    uPlWindStrength: { value: 0.1 },
    uPlAlphaTest: { value: resolveFoliageAlphaTest(spec, season.season) },
    uPlPaletteA: { value: new THREE.Color('#ffffff') },
    uPlPaletteB: { value: new THREE.Color('#ffffff') },
    uPlPeakA: { value: new THREE.Color('#ffffff') },
    uPlPeakB: { value: new THREE.Color('#ffffff') },
    uPlTreeDiscolourationFactor: { value: season.discolouration },
    uPlHasSnow: { value: 0 },
    uPlAtlas: { value: null },
    uPlAlphaTex: { value: null },
    uPlNormalTex: { value: null },
    uPlNoiseMap: { value: null },
    uPlGrassVariation: { value: null },
    uPlDetailFar: { value: null },
    uPlTreeDiscolourationNoise: { value: null },
    uPlDensityMap: { value: null },
    uPlDensityMin: { value: new THREE.Vector2() },
    uPlDensitySize: { value: new THREE.Vector2(1, 1) },
  }
  const cardUniforms = {
    uPlDissolveNear: { value: 100 },
    uPlDissolveFar: { value: 200 },
    uPlDissolveInterval: { value: 60 },
  }
  const uniforms: Record<string, THREE.IUniform> = {
    uPlTime: shared.time,
    uPlCameraPos: shared.cameraPosition,
    uPlNearDistance: shared.nearDistance,
    uPlMeshRadius: shared.meshRadius,
    ...seasonUniforms,
    uPlTierMode: { value: TIER_MODE[spec.tier] },
    uPlSinglePlane: { value: spec.singlePlane ? 1 : 0 },
    uPlDistanceAlpha: { value: spec.distanceAlpha ? 1 : 0 },
    uPlDynamicAlpha: { value: spec.card === 'near' ? 1 : 0 },
    uPlBillboard: { value: spec.card === 'far' ? 1 : 0 },
    uPlDissolveNear: cardUniforms.uPlDissolveNear,
    uPlDissolveFar: cardUniforms.uPlDissolveFar,
    uPlDissolveInterval: cardUniforms.uPlDissolveInterval,
    uPlHasAlphaTex: { value: spec.hasAlphaTexture ? 1 : 0 },
    uPlHasNormalTex: { value: spec.hasNormalTexture ? 1 : 0 },
    uPlPaletteMode: { value: PALETTE_MODE[spec.kind] },
    uPlFoliageTint: { value: new THREE.Color(spec.tint) },
    uPlFarTintScale: { value: spec.farTintScale },
    uPlSpecies: { value: spec.species },
    uPlUseDensityShadow: { value: spec.useDensityShadow ? 1 : 0 },
  }
  material.customProgramCacheKey = () =>
    `pl-foliage-v4-${spec.kind}-${spec.tier}-${spec.singlePlane ? 1 : 0}-${spec.card ?? 'none'}`
  material.onBeforeCompile = (shader) => {
    for (const [name, uniform] of Object.entries(uniforms)) {
      shader.uniforms[name] = uniform as THREE.IUniform
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', VERTEX_BODY)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <normal_fragment_begin>', FOLIAGE_NORMAL_BODY)
      .replace('#include <map_fragment>', FRAGMENT_BODY)
      // 官方自发光合成：emissive 乘进直射项（`direct × (1 + emissive)`）。
      .replace(
        'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
        'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directDiffuse * totalEmissiveRadiance;',
      )
    injectSlowroadsFog(shader, { material })
    recordSlowroadsShaderAudit(material, shader)
  }
  const handle: FoliageMaterialHandle = { material, uniforms: seasonUniforms, cardUniforms, spec }
  applyFoliageMaterialSeason(handle, season)
  return handle
}

/** 换季：只更新调色板/变色/积雪/alphaTest uniform，不重建材质。 */
export function applyFoliageMaterialSeason(
  handle: FoliageMaterialHandle,
  season: FoliageMaterialSeasonState,
): void {
  const spec = handle.spec
  const uniforms = handle.uniforms
  const params = SEASON_PARAMS[season.season]
  uniforms.uPlSeasonIndex.value = params.index
  uniforms.uPlPaletteA.value.set(params.grassColA)
  uniforms.uPlPaletteB.value.set(params.grassColB)
  uniforms.uPlPeakA.value.set(params.peakColA)
  uniforms.uPlPeakB.value.set(params.peakColB)
  uniforms.uPlTreeDiscolourationFactor.value = season.discolouration
  uniforms.uPlAlphaTest.value = resolveFoliageAlphaTest(spec, season.season)
  uniforms.uPlHasSnow.value = season.hasSnow && spec.kind === 'tree' && spec.species === 0 ? 1 : 0
}

/**
 * 环境光照同步（官方每季 × 时间 × 天气的 `lights.radiance` /
 * `effects.shadowFactor` / `lights.fresnelFactor`）：树卡取 radiance/2，
 * 草/灌木取全量。
 */
export function setFoliageMaterialLighting(
  handle: FoliageMaterialHandle,
  lighting: { radiance: number; shadowFactor: number; fresnel: number },
): void {
  handle.uniforms.uPlRadiance.value = lighting.radiance * (handle.spec.kind === 'tree' ? 0.5 : 1)
  handle.uniforms.uPlShadowFactor.value = lighting.shadowFactor
  handle.uniforms.uPlFresnelIntensity.value = lighting.fresnel
}

export function setFoliageMaterialCardRange(
  handle: FoliageMaterialHandle,
  range: { near: number; far: number; interval: number },
): void {
  handle.cardUniforms.uPlDissolveNear.value = range.near
  handle.cardUniforms.uPlDissolveFar.value = range.far
  handle.cardUniforms.uPlDissolveInterval.value = Math.max(1e-3, range.interval)
}

export function setFoliageMaterialTextures(
  handle: FoliageMaterialHandle,
  textures: {
    atlas: THREE.Texture
    alpha?: THREE.Texture | null
    normal?: THREE.Texture | null
    noise: THREE.Texture | null
    grassVariation: THREE.Texture | null
    detailFar: THREE.Texture | null
    cardNoise?: THREE.Texture | null
    densityMap?: THREE.Texture | null
    densityMin?: THREE.Vector2 | null
    densitySize?: THREE.Vector2 | null
  },
): void {
  handle.uniforms.uPlAtlas.value = textures.atlas
  handle.uniforms.uPlAlphaTex.value = textures.alpha ?? textures.atlas
  handle.uniforms.uPlNormalTex.value = textures.normal ?? textures.atlas
  handle.uniforms.uPlNoiseMap.value = textures.noise ?? textures.atlas
  handle.uniforms.uPlGrassVariation.value = textures.grassVariation ?? textures.atlas
  handle.uniforms.uPlDetailFar.value = textures.detailFar ?? textures.atlas
  handle.uniforms.uPlTreeDiscolourationNoise.value = textures.cardNoise ?? textures.noise ?? textures.atlas
  if (textures.densityMap !== undefined) {
    handle.uniforms.uPlDensityMap.value = textures.densityMap
  }
  if (textures.densityMin) {
    handle.uniforms.uPlDensityMin.value.copy(textures.densityMin)
  }
  if (textures.densitySize) {
    handle.uniforms.uPlDensitySize.value.copy(textures.densitySize)
  }
  handle.material.needsUpdate = true
}

export interface FoliageSpriteInstance {
  x: number
  y: number
  z: number
  rotation: number
  scale: number
  /** 图集区域；null = 空位格（实例不可见，如冬季草 0/1 号）。 */
  region: SpriteRegion | null
  /** slowroads 变体格号（裁剪规则按它生效）。 */
  cell: number
  /** d - halfWidth，草丛调色板贴近道路时的明度抑制。 */
  roadProx: number
  /** 官方 per-instance groundNormal（草/灌木受光与 fresnel）；缺省 (0,1,0)。 */
  groundNormal?: { x: number; y: number; z: number } | null
}

const matrixHelper = new THREE.Matrix4()
const positionHelper = new THREE.Vector3()
const quaternionHelper = new THREE.Quaternion()
const eulerHelper = new THREE.Euler()
const scaleHelper = new THREE.Vector3()
const groundNormalHelper = new THREE.Vector3()

export function createFoliageLayerMesh(
  instances: ReadonlyArray<FoliageSpriteInstance>,
  material: THREE.MeshLambertMaterial,
  unitSize: number,
  hostInverse: THREE.Matrix4 | null,
  options: { billboard?: boolean; capacity?: number } = {},
): THREE.InstancedMesh {
  const count = instances.length
  const requestedCapacity = Number.isFinite(options.capacity) ? Math.floor(options.capacity as number) : 0
  const capacity = Math.max(1, count, requestedCapacity)
  const geometry = createCrossQuadGeometry()
  const uvRectAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
  const sizeAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2)
  const cellAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
  const roadProxAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
  const groundNormalAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
  const orientationAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
  geometry.setAttribute('aPlUvRect', uvRectAttribute)
  geometry.setAttribute('aPlSize', sizeAttribute)
  geometry.setAttribute('aPlCell', cellAttribute)
  geometry.setAttribute('aPlRoadProx', roadProxAttribute)
  geometry.setAttribute('aPlGroundNormal', groundNormalAttribute)
  geometry.setAttribute('aPlOrientation', orientationAttribute)

  const mesh = new THREE.InstancedMesh(geometry, material, capacity)
  mesh.name = 'slowroads-foliage-layer'
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.frustumCulled = false
  writeFoliageLayerInstances(mesh, instances, unitSize, hostInverse, options.billboard === true)
  return mesh
}

/** 实例缓冲容量（= 创建时申请的 `capacity`）。 */
export function getFoliageLayerCapacity(mesh: THREE.InstancedMesh): number {
  const attribute = mesh.geometry.getAttribute('aPlUvRect') as THREE.InstancedBufferAttribute | undefined
  return attribute ? attribute.count : 0
}

/**
 * 就地重写实例（缓冲容量够用时不再重新分配几何/属性）——远景环每次重锚复用同一对
 * InstancedMesh，避免 6 万级实例的反复分配造成卡顿。超出容量的实例会被丢弃
 * （调用方负责按需扩容：`getFoliageLayerCapacity`）。
 */
export function updateFoliageLayerMesh(
  mesh: THREE.InstancedMesh | null | undefined,
  instances: ReadonlyArray<FoliageSpriteInstance>,
  unitSize: number,
  hostInverse: THREE.Matrix4 | null,
  options: { billboard?: boolean } = {},
): number {
  if (!mesh) {
    return 0
  }
  return writeFoliageLayerInstances(mesh, instances, unitSize, hostInverse, options.billboard === true)
}

function writeFoliageLayerInstances(
  mesh: THREE.InstancedMesh,
  instances: ReadonlyArray<FoliageSpriteInstance>,
  unitSize: number,
  hostInverse: THREE.Matrix4 | null,
  billboard: boolean,
): number {
  const uvRectAttribute = mesh.geometry.getAttribute('aPlUvRect') as THREE.InstancedBufferAttribute
  const sizeAttribute = mesh.geometry.getAttribute('aPlSize') as THREE.InstancedBufferAttribute
  const cellAttribute = mesh.geometry.getAttribute('aPlCell') as THREE.InstancedBufferAttribute
  const roadProxAttribute = mesh.geometry.getAttribute('aPlRoadProx') as THREE.InstancedBufferAttribute
  const groundNormalAttribute = mesh.geometry.getAttribute('aPlGroundNormal') as THREE.InstancedBufferAttribute
  const orientationAttribute = mesh.geometry.getAttribute('aPlOrientation') as THREE.InstancedBufferAttribute
  const count = Math.min(instances.length, uvRectAttribute.count)
  mesh.count = count

  for (let i = 0; i < count; i += 1) {
    const instance = instances[i]!
    if (!instance.region) {
      scaleHelper.set(0, 0, 0)
      positionHelper.set(0, -1e4, 0)
      matrixHelper.compose(positionHelper, quaternionHelper.identity(), scaleHelper)
      if (hostInverse) {
        matrixHelper.premultiply(hostInverse)
      }
      mesh.setMatrixAt(i, matrixHelper)
      uvRectAttribute.setXYZW(i, 0, 0, 0, 0)
      sizeAttribute.setXY(i, 0, 0)
      cellAttribute.setX(i, instance.cell)
      roadProxAttribute.setX(i, instance.roadProx)
      groundNormalAttribute.setXYZ(i, 0, 1, 0)
      orientationAttribute.setX(i, instance.rotation)
      continue
    }
    positionHelper.set(instance.x, instance.y, instance.z)
    // 远景树使用朝相机广告牌：实例旋转作为图集朝向基准角，矩阵本身不带旋转。
    eulerHelper.set(0, billboard ? 0 : instance.rotation, 0)
    quaternionHelper.setFromEuler(eulerHelper)
    const scale = unitSize * instance.scale
    scaleHelper.set(scale, scale, scale)
    matrixHelper.compose(positionHelper, quaternionHelper, scaleHelper)
    if (hostInverse) {
      matrixHelper.premultiply(hostInverse)
    }
    mesh.setMatrixAt(i, matrixHelper)
    uvRectAttribute.setXYZW(i, instance.region.u0, instance.region.v0, instance.region.u1, instance.region.v1)
    sizeAttribute.setXY(i, instance.region.aspect * instance.region.heightScale, instance.region.heightScale)
    cellAttribute.setX(i, instance.cell)
    roadProxAttribute.setX(i, instance.roadProx)
    const normal = instance.groundNormal
    groundNormalHelper.set(normal?.x ?? 0, normal?.y ?? 1, normal?.z ?? 0)
    groundNormalAttribute.setXYZ(i, groundNormalHelper.x, groundNormalHelper.y, groundNormalHelper.z)
    orientationAttribute.setX(i, instance.rotation)
  }
  mesh.instanceMatrix.needsUpdate = true
  uvRectAttribute.needsUpdate = true
  sizeAttribute.needsUpdate = true
  cellAttribute.needsUpdate = true
  roadProxAttribute.needsUpdate = true
  groundNormalAttribute.needsUpdate = true
  orientationAttribute.needsUpdate = true
  return count
}

export function disposeFoliageLayerMesh(mesh: THREE.InstancedMesh | null | undefined): void {
  if (!mesh) {
    return
  }
  mesh.removeFromParent()
  mesh.geometry.dispose()
  mesh.dispose()
}
