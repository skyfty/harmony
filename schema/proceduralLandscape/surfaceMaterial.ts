import * as THREE from 'three'
import { injectSlowroadsFog } from '../slowroads/render/fogInjection'
import { recordSlowroadsShaderAudit } from './shaderAudit'

/**
 * Slow Roads 季节地表着色（官方片元栈移植，注入到 GLB 地形的
 * MeshLambertMaterial —— 与官方同材质族，保留 CSM 阴影）。
 *
 * 片元顺序与 slowroads 一致：草色混合（grassColA/B × peakColA/B，由
 * noise_fine 的 fade 场驱动 light/dark grass 与 grassBlend）→ heather 混合 →
 * 细节贴图（detailFar 远/近混合）→ 树冠林下 forest 混合 → 沙带（seasonIndex<3）
 * → 路肩碎石（<3；秋季树下提亮 1.8、夏季近处直接铺 roadCol）→ 陡坡岩石
 * （rock + rockBump 扰法线）。
 *
 * 与 lab 的差异：
 *  - 顶点提供世界坐标/法线 + 道路压平位移（沿用既有注入），雾改走共享三色雾；
 *  - 高度项按 `uPlHeightScale` 折算（lab 世界起伏 ±40m 时恒为 4，编辑器大地形
 *    按实测起伏归一化，见 config.resolveSurfaceHeightScale）；水线参考 = uPlWaterLevel；
 *  - GLB 航拍基色由 `baseMapMode`（replace/blend）与 `uPlSurfaceStrength` 控制。
 *  - heather 与全部掩码公式与 slowroads.io 官方地形顶点着色器逐行一致
 *    （`(height + fade1*350 - 60)/500` 的 smoothstep × screen 分布）。
 *  - 官方近路位移（displacement_vertex）：路肩 16m 内沿法线加 rock_bump 微起伏
 *    （强度 0.8、uv = 世界坐标/100，`#ifndef PL_SURFACE_REDUCED` 保护兼容模式）。
 *  - 官方地表掠射边缘光（mu chunk）：接近水平视线时提亮、背光侧 darkFresnel 压暗。
 *  - 树冠色斑由 `uPlShowCanopy` 门控（关 = 不采样密度图、无林下/树影）；
 *    地表贴图由 `uPlShowTextures` 门控（关 = lab 的纯色调色板回归路径）。
 *  - 光照/合成与官方一致：`totalEmissiveRadiance = 季节色 × radiance`，并走官方
 *    合成补丁 `direct + indirect + direct × emissive`；环境项按官方变体乘
 *    `1.75 - clamp(vShadow, 0.75, 1.0)`。
 */
export interface ProceduralLandscapeSurfaceUniforms {
  uPlRoadField: THREE.IUniform<THREE.Texture | null>
  uPlForestMask: THREE.IUniform<THREE.Texture | null>
  uPlTerrainMin: THREE.IUniform<THREE.Vector2>
  uPlTerrainSize: THREE.IUniform<THREE.Vector2>
  uPlHeightMin: THREE.IUniform<number>
  uPlHeightRange: THREE.IUniform<number>
  uPlRoadFieldRange: THREE.IUniform<number>
  uPlRoadHalfWidth: THREE.IUniform<number>
  uPlRoadShoulderWidth: THREE.IUniform<number>
  uPlSurfaceStrength: THREE.IUniform<number>
  uPlUvScale: THREE.IUniform<number>
  uPlGrassTint: THREE.IUniform<THREE.Color>
  uPlForestTint: THREE.IUniform<THREE.Color>
  uPlRoadTint: THREE.IUniform<THREE.Color>
  uPlGravelTint: THREE.IUniform<THREE.Color>
  uPlRockSlope: THREE.IUniform<number>
  /** 1 = 树冠色斑（树密度图 → 林下/树影）；0 = 不采样密度图。 */
  uPlShowCanopy: THREE.IUniform<number>
  /** 1 = 采样季节地表贴图；0 = lab 的纯色调色板回归路径。 */
  uPlShowTextures: THREE.IUniform<number>
  /** 高度带归一化系数（lab 常量 ×4；编辑器按地形起伏夹在 [0.25, 4]）。 */
  uPlHeightScale: THREE.IUniform<number>
  /** 官方 lights.fresnelFactor：地表掠射边缘光强度。 */
  uPlFresnelIntensity: THREE.IUniform<number>
  /** 官方 lights.radiance：地表自发光强度（emissive = 季节色 × radiance）。 */
  uPlRadiance: THREE.IUniform<number>
  /** 官方 effects.shadowFactor：烘焙树影（vShadow）的季节系数。 */
  uPlShadowFactor: THREE.IUniform<number>
  uPlFlattenInner: THREE.IUniform<number>
  uPlFlattenOuter: THREE.IUniform<number>
  uPlFlattenStrength: THREE.IUniform<number>
  uPlWaterLevel: THREE.IUniform<number>
  uPlBaseMapBlend: THREE.IUniform<number>
  // ---- 季节资产 ----
  uPlNoiseTex: THREE.IUniform<THREE.Texture | null>
  uPlGrassTex: THREE.IUniform<THREE.Texture | null>
  uPlForestTex: THREE.IUniform<THREE.Texture | null>
  uPlHeatherTex: THREE.IUniform<THREE.Texture | null>
  uPlGravelTex: THREE.IUniform<THREE.Texture | null>
  uPlRockTex: THREE.IUniform<THREE.Texture | null>
  uPlSandTex: THREE.IUniform<THREE.Texture | null>
  uPlDetailNearTex: THREE.IUniform<THREE.Texture | null>
  uPlDetailFarTex: THREE.IUniform<THREE.Texture | null>
  uPlRockBumpTex: THREE.IUniform<THREE.Texture | null>
  uPlGrassVariation: THREE.IUniform<THREE.Texture | null>
  // ---- 季节调色板 ----
  uPlSeasonIndex: THREE.IUniform<number>
  uPlGrassColA: THREE.IUniform<THREE.Color>
  uPlGrassColB: THREE.IUniform<THREE.Color>
  uPlPeakColA: THREE.IUniform<THREE.Color>
  uPlPeakColB: THREE.IUniform<THREE.Color>
  uPlRoadCol: THREE.IUniform<THREE.Color>
}

export function createProceduralLandscapeSurfaceUniforms(): ProceduralLandscapeSurfaceUniforms {
  return {
    uPlRoadField: { value: null },
    uPlForestMask: { value: null },
    uPlTerrainMin: { value: new THREE.Vector2(0, 0) },
    uPlTerrainSize: { value: new THREE.Vector2(1, 1) },
    uPlHeightMin: { value: 0 },
    uPlHeightRange: { value: 1 },
    uPlRoadFieldRange: { value: 64 },
    uPlRoadHalfWidth: { value: 3.5 },
    uPlRoadShoulderWidth: { value: 2.5 },
    uPlSurfaceStrength: { value: 1 },
    uPlUvScale: { value: 10 },
    uPlGrassTint: { value: new THREE.Color(1, 1, 1) },
    uPlForestTint: { value: new THREE.Color(1, 1, 1) },
    uPlRoadTint: { value: new THREE.Color(1, 1, 1) },
    uPlGravelTint: { value: new THREE.Color(1, 1, 1) },
    uPlRockSlope: { value: 0.35 },
    uPlShowCanopy: { value: 1 },
    uPlShowTextures: { value: 1 },
    uPlHeightScale: { value: 4 },
    uPlFresnelIntensity: { value: 1 },
    uPlRadiance: { value: 2 },
    uPlShadowFactor: { value: 1 },
    uPlFlattenInner: { value: 6 },
    uPlFlattenOuter: { value: 10 },
    uPlFlattenStrength: { value: 1 },
    uPlWaterLevel: { value: 0 },
    uPlBaseMapBlend: { value: 0.5 },
    uPlNoiseTex: { value: null },
    uPlGrassTex: { value: null },
    uPlForestTex: { value: null },
    uPlHeatherTex: { value: null },
    uPlGravelTex: { value: null },
    uPlRockTex: { value: null },
    uPlSandTex: { value: null },
    uPlDetailNearTex: { value: null },
    uPlDetailFarTex: { value: null },
    uPlRockBumpTex: { value: null },
    uPlGrassVariation: { value: null },
    uPlSeasonIndex: { value: 0 },
    uPlGrassColA: { value: new THREE.Color('#4F9140') },
    uPlGrassColB: { value: new THREE.Color('#94AC53') },
    uPlPeakColA: { value: new THREE.Color('#B7C08C') },
    uPlPeakColB: { value: new THREE.Color('#C5875E') },
    uPlRoadCol: { value: new THREE.Color('#636260') },
  }
}

const VERTEX_HEADER = `#include <common>
uniform sampler2D uPlRoadField;
uniform sampler2D uPlRockBumpTex;
uniform vec2 uPlTerrainMin;
uniform vec2 uPlTerrainSize;
uniform float uPlHeightMin;
uniform float uPlHeightRange;
uniform float uPlRoadFieldRange;
uniform float uPlRoadHalfWidth;
uniform float uPlFlattenInner;
uniform float uPlFlattenOuter;
uniform float uPlFlattenStrength;
varying vec3 vPlWorldPosition;
varying vec3 vPlWorldNormal;
varying float vPlViewDistance;`

const VERTEX_BODY = `#include <begin_vertex>
{
  vec4 plWorld4 = modelMatrix * vec4(transformed, 1.0);
  vPlWorldPosition = plWorld4.xyz;
  vPlWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
  vPlViewDistance = distance(vPlWorldPosition, cameraPosition);
  vec2 plUv = (vPlWorldPosition.xz - uPlTerrainMin) / max(uPlTerrainSize, vec2(0.0001));
  vec4 plRoadSample = texture2D(uPlRoadField, plUv);
  float plDistance = plRoadSample.r * uPlRoadFieldRange;
  float plWeight = 1.0 - smoothstep(uPlFlattenInner, uPlFlattenOuter, plDistance);
  if (plWeight > 0.001 && uPlFlattenStrength > 0.0) {
    float plEncodedHeight = plRoadSample.g * 255.0 * 256.0 + plRoadSample.b * 255.0;
    float plTargetY = uPlHeightMin + (plEncodedHeight / 65535.0) * uPlHeightRange;
    float plScaleY = max(0.0001, length(vec3(modelMatrix[0][1], modelMatrix[1][1], modelMatrix[2][1])));
    float plDelta = (plTargetY - vPlWorldPosition.y) * plWeight * uPlFlattenStrength;
    transformed.y += plDelta / plScaleY;
    vPlWorldPosition.y += plDelta;
  }
  // 官方近路位移（displacement_vertex）：路肩 16m 内沿法线加 rock_bump 微起伏，
  // uv 取原始世界坐标的 /100；强度 0.8，坡面越平越弱。兼容模式（PL_SURFACE_REDUCED）
  // 不做（低端机顶点纹理单元不可靠）。
#ifndef PL_SURFACE_REDUCED
  float plPlacementProx = plDistance - uPlRoadHalfWidth;
  if (abs(plPlacementProx) > 1e-5) {
    float plSteepV = clamp((0.98 - dot(normalize(objectNormal), vec3(0.0, 1.0, 0.0))) * 1.4, 0.0, 1.0);
    float plIntensity = clamp((16.0 - plPlacementProx) / 6.0, 0.0, 1.0) * 0.8;
    float plScaleYv = max(0.0001, length(vec3(modelMatrix[0][1], modelMatrix[1][1], modelMatrix[2][1])));
    transformed += normalize(objectNormal) * ((texture2D(uPlRockBumpTex, plWorld4.xz / 100.0).x - 0.4)
      * min(1.0, plSteepV * 3.0)) * plIntensity / plScaleYv;
  }
#endif
}`

/** 官方陡坡岩石法线扰动（normal_fragment_begin 之后注入）。 */
const NORMAL_BODY = `#include <normal_fragment_begin>
{
  float plSteepN = clamp((uPlRockSlope - dot(normalize(vPlWorldNormal), vec3(0.0, 1.0, 0.0))) * 1.6, 0.0, 1.0);
#ifndef PL_SURFACE_REDUCED
  if (plSteepN > 0.1) {
    vec2 plBumpUv = vPlWorldPosition.xz / max(uPlUvScale, 0.001);
    float plBumpCenter = texture2D(uPlRockBumpTex, plBumpUv).r;
    float plBumpX = texture2D(uPlRockBumpTex, plBumpUv + vec2(0.04, 0.0)).r - plBumpCenter;
    float plBumpZ = texture2D(uPlRockBumpTex, plBumpUv + vec2(0.0, 0.04)).r - plBumpCenter;
    normal = normalize(normal + vec3(-plBumpX, 0.0, -plBumpZ) * 2.4 * plSteepN);
  }
#endif
}`

const FRAGMENT_HEADER = `#include <common>
uniform sampler2D uPlRoadField;
uniform sampler2D uPlForestMask;
uniform sampler2D uPlNoiseTex;
uniform sampler2D uPlGrassTex;
uniform sampler2D uPlForestTex;
uniform sampler2D uPlHeatherTex;
uniform sampler2D uPlGravelTex;
uniform sampler2D uPlRockTex;
uniform sampler2D uPlSandTex;
#ifndef PL_SURFACE_REDUCED
uniform sampler2D uPlDetailNearTex;
#endif
uniform sampler2D uPlDetailFarTex;
#ifndef PL_SURFACE_REDUCED
uniform sampler2D uPlRockBumpTex;
uniform sampler2D uPlGrassVariation;
#endif
uniform vec2 uPlTerrainMin;
uniform vec2 uPlTerrainSize;
uniform float uPlRoadFieldRange;
uniform float uPlRoadHalfWidth;
uniform float uPlRoadShoulderWidth;
uniform float uPlSurfaceStrength;
uniform float uPlUvScale;
uniform float uPlWaterLevel;
uniform float uPlHeightRange;
uniform float uPlHeightScale;
uniform float uPlBaseMapBlend;
uniform vec3 uPlGrassTint;
uniform vec3 uPlForestTint;
uniform vec3 uPlRoadTint;
uniform vec3 uPlGravelTint;
uniform float uPlRockSlope;
uniform float uPlShowCanopy;
uniform float uPlShowTextures;
uniform float uPlRadiance;
uniform float uPlShadowFactor;
uniform float uPlFresnelIntensity;
uniform int uPlSeasonIndex;
uniform vec3 uPlGrassColA;
uniform vec3 uPlGrassColB;
uniform vec3 uPlPeakColA;
uniform vec3 uPlPeakColB;
uniform vec3 uPlRoadCol;
varying vec3 vPlWorldPosition;
varying vec3 vPlWorldNormal;
varying float vPlViewDistance;

float plSaturate(float value) { return clamp(value, 0.0, 1.0); }
float plScreen(float a, float b) { return 1.0 - ((1.0 - a) * (1.0 - b)); }

/** 官方环境光树影调制（lights_fragment_end 后乘到 indirectDiffuse）。 */
float plAmbientShadow = 1.0;
/** map_fragment 里算好的季节色（normal 就绪后再应用掠射边缘光）。 */
vec3 plSeasonalColor = vec3(1.0);
float plFresnelBlendVal = 0.0;
float plShadowTerm = 0.0;

vec4 plTerrainBlend(vec4 tx1, float w1, vec4 tx2, float w2, float depth) {
  float ma = max(tx1.a + w1, tx2.a + w2) - depth;
  float b1 = max(tx1.a + w1 - ma, 0.0);
  float b2 = max(tx2.a + w2 - ma, 0.0);
  return ((tx1 * b1) + (tx2 * b2)) / max(0.0001, b1 + b2);
}`

const FRAGMENT_BODY = `#include <map_fragment>
{
  plSeasonalColor = diffuseColor.rgb;
  vec2 plWorldUv = (vPlWorldPosition.xz - uPlTerrainMin) / max(uPlTerrainSize, vec2(0.0001));
  float plRoadProx = texture2D(uPlRoadField, plWorldUv).r * uPlRoadFieldRange - uPlRoadHalfWidth;
  float plHasRoadProx = step(0.00001, abs(plRoadProx));

  vec2 wUv = vPlWorldPosition.xz / max(uPlUvScale, 0.001);
  vec2 wUv100 = wUv / 10.0;
  vec2 wUv500 = vPlWorldPosition.xz / 500.0;
  vec2 wUv2000 = vPlWorldPosition.xz / 2000.0;
  vec2 wUv4000 = vPlWorldPosition.xz / 4000.0;

  float fade0 = texture2D(uPlNoiseTex, wUv).r;
  float fade1 = texture2D(uPlNoiseTex, wUv100).r;
  float fade2 = texture2D(uPlNoiseTex, wUv500).r;
  float vFade0 = fade2;
  float vFade1 = texture2D(uPlNoiseTex, wUv4000).r;
  plFresnelBlendVal = 0.0;

  // 官方高度公式按「水面以上 0..300m」调参；lab 世界起伏 ±40m 时乘 ×4 折算，
  // 编辑器真实地形按实测起伏归一化（见 config.resolveSurfaceHeightScale）。
  float heightRel = vPlWorldPosition.y - uPlWaterLevel;
  float height = heightRel * uPlHeightScale;

  // ---- 官方 heather 分布（官方地形顶点着色器逐行一致）。 ----
  float vHeather = smoothstep(0.4, 1.0, ((height + vFade1 * 350.0) - 60.0) / 500.0);
  vHeather *= plScreen(vFade1, vFade0);
  vHeather = smoothstep(0.3, 0.6, vHeather);

  float heightVal = min(1.0, max(0.0, (height - (30.0 + vFade1 * 40.0)) / 150.0));
  float vLightGrass = min(1.0, heightVal * (vFade0 + heightVal * 0.5));

  if (plRoadProx > 0.0 && plRoadProx < 0.5 + vFade0) {
    vHeather *= plRoadProx / (0.5 + vFade0);
    if (uPlSeasonIndex < 3) {
      vLightGrass *= plRoadProx / (0.5 + vFade0);
    }
  }

  float vDarkGrass = min(max(0.0, (vFade1 - 0.25) * 2.0), 1.0);

  float steepness = clamp((0.98 - dot(normalize(vPlWorldNormal), vec3(0.0, 1.0, 0.0))) * 1.4, 0.0, 1.0);
  float underRoadFactor = 1.0 - step(0.000001, -plRoadProx);
  steepness *= underRoadFactor;
  vHeather *= underRoadFactor;

  // 树冠色斑（lab showCanopy）：关闭时完全不采样密度图 —— 没有林下混合/树影，
  // 环境光也不再按树影调制。
  float treeMask = 0.0;
  if (uPlShowCanopy > 0.5) {
    treeMask = clamp(texture2D(uPlForestMask, plWorldUv).r * 1.15, 0.0, 1.0);
  }
  // 官方：vShadow = treeMask × 高度项，再乘当季 shadowFactor（顶点着色器）。
  float vShadow = min(1.0, treeMask * min(1.0, max(0.0, heightRel / 4.0)));
  vShadow *= clamp(uPlShadowFactor, 0.0, 1.0);
  plShadowTerm = vShadow;
  // 官方环境光树影调制（官方 lights_fragment_begin_shadow 变体）。
  plAmbientShadow = 1.75 - clamp(vShadow, 0.75, 1.0);
  float vTreeMask = vShadow;
  if (vTreeMask > 0.1) {
    vTreeMask = max(0.2, vTreeMask);
  } else {
    vTreeMask = 0.0;
  }
  if (plHasRoadProx > 0.5) {
    vTreeMask *= clamp(plRoadProx / 2.0, 0.0, 1.0);
  }

  // ---- 草地：调色板混合（slowroads ground frag） ----
  vec4 texelColor = texture2D(uPlGrassTex, wUv);

  float blendVal = 1.0 - texture2D(uPlDetailFarTex, wUv4000).r;
  float blendValB = 1.0 - texture2D(uPlDetailFarTex, wUv500).r;
  float blendValC = 1.0 - texture2D(uPlDetailFarTex, wUv100).r;
  blendValB = plScreen(blendValC, blendValB);
  blendValB *= min(1.0, blendVal * 10.0);
  if (uPlSeasonIndex == 3) {
    blendValB *= 0.7;
  }
  blendVal *= (0.6 + 0.4 * vLightGrass);
  blendVal *= 2.0;
  blendVal *= uPlSurfaceStrength;
  float depthLerpFar = plSaturate(vPlViewDistance / 800.0);
  blendVal = blendVal * depthLerpFar + (1.0 - depthLerpFar) * blendValB;
  blendVal *= plSaturate(0.4 + 0.6 * (vPlViewDistance / 300.0));
#ifndef PL_SURFACE_REDUCED
  blendVal += (1.0 - texture2D(uPlDetailNearTex, wUv100).r) * (0.7 + vLightGrass * 0.3) * uPlSurfaceStrength;
#endif
  plFresnelBlendVal = plSaturate(blendVal);

#ifndef PL_SURFACE_REDUCED
  float variationVal = texture2D(uPlGrassVariation, wUv2000).r - 0.5;
  float closeVariation = ((1.0 - texture2D(uPlGrassVariation, wUv500).r) - 0.5);
#else
  // 缩减路径（纹理单元受限设备）：用 fade 场近似 variation。
  float variationVal = (fade1 - 0.5) * 0.5;
  float closeVariation = (fade0 - 0.5) * 0.5;
#endif

  float grassBlend = (plScreen(fade1, fade0) + vDarkGrass) / 2.0;
  grassBlend = grassBlend * grassBlend;
  grassBlend = plSaturate(grassBlend + variationVal + closeVariation);
  float lightGrassFactor = plSaturate(vLightGrass + variationVal - closeVariation);
  lightGrassFactor = plSaturate(lightGrassFactor * 2.0 * texelColor.r);
  vec3 grassCol = mix(
    mix(uPlGrassColA, uPlGrassColB, grassBlend),
    mix(uPlPeakColA, uPlPeakColB, grassBlend),
    lightGrassFactor
  );
  texelColor.rgb *= grassCol * uPlGrassTint;

  // ---- heather 混合 ----
  if (vHeather > 0.0) {
    vec4 heatherCol = texture2D(uPlHeatherTex, wUv);
    float depthLerp = 0.25 + 0.75 * min(1.0, vPlViewDistance / 400.0);
    heatherCol = mix(heatherCol, texture2D(uPlHeatherTex, wUv500), depthLerp);
    heatherCol = mix(texelColor, heatherCol, min(1.0, vHeather));
    heatherCol.a = heatherCol.r;
    texelColor.a = texelColor.g;
    texelColor = plTerrainBlend(texelColor, 1.0 - vHeather, heatherCol, vHeather, 0.1);
  }

  // ---- 细节叠加 ----
  texelColor *= 1.0 - blendVal;

  // ---- 树冠林下 ----
  vec4 forestCol = texture2D(uPlForestTex, wUv);
  forestCol.rgb *= uPlForestTint;
  forestCol.a = forestCol.r * 2.0 * fade2;
  float fTreeMask = min(1.0, vTreeMask);
  if (fTreeMask > 0.0) {
    texelColor = plTerrainBlend(
      texelColor,
      1.0 - fTreeMask,
      forestCol,
      fTreeMask,
      0.1 + (1.0 - fTreeMask) * fade0 * 0.9
    );
    texelColor.a = 1.0;
  }

  // ---- 水线沙带（冬季不做；按真实米数） ----
  float vHeight = heightRel + min(1.0, heightRel + 0.5) * (fade2 * 2.0 + (fade0 + fade2) * 0.5);
  if (vHeight < 4.0 && uPlSeasonIndex < 3) {
    float dark = 1.0;
    if (vHeight < 0.0) {
      texelColor = texture2D(uPlSandTex, wUv) * 0.75;
    } else {
      if (vHeight < 2.0) {
        dark = min(dark, 1.0 - (2.0 - vHeight) / 4.0);
      } else if (vHeight > 2.5) {
        dark = 1.0 - (vHeight - 2.5) / 2.0;
      }
      float lerpVal = max(0.0, (vHeight - 1.0) / 3.0);
      vec4 sandCol = texture2D(uPlSandTex, wUv);
      texelColor.a = texelColor.r;
      sandCol.a = sandCol.r;
      sandCol.rgb *= dark;
      texelColor = plTerrainBlend(texelColor, lerpVal, sandCol, 1.0 - lerpVal, 0.05);
    }
  }

  // ---- 路肩碎石（冬季不做；秋季树下提亮；夏季近处直接铺路面色） ----
  if (uPlSeasonIndex < 3 && plHasRoadProx > 0.5) {
    if (plRoadProx < -0.2 && (vPlViewDistance > 100.0 || uPlSeasonIndex == 1)) {
      texelColor.rgb = uPlRoadCol * uPlRoadTint;
    } else if (plRoadProx + fade2 * 0.1 < 0.5 * fade0) {
      float rp = plSaturate(1.0 - (plRoadProx + fade2 * 0.1) / max(0.0001, 0.5 * fade0));
      if (uPlSeasonIndex != 1 && vShadow > 0.0) {
        float gravelBrightness = uPlSeasonIndex == 2 ? 1.8 : 1.3;
        vec4 plGravelTex = texture2D(uPlGravelTex, wUv * 2.0);
        plGravelTex.rgb *= uPlGravelTint;
        texelColor = mix(
          mix(plGravelTex, forestCol * gravelBrightness, min(1.0, vShadow * 2.0)),
          texelColor,
          smoothstep(0.0, rp, texelColor.g / max(0.0001, rp))
        );
      } else {
        vec4 plGravelTex = texture2D(uPlGravelTex, wUv * 2.0);
        plGravelTex.rgb *= uPlGravelTint;
        texelColor = mix(
          plGravelTex * (0.75 + rp * rp * 0.75),
          texelColor,
          smoothstep(0.0, rp, texelColor.g / max(0.0001, rp))
        );
      }
    }
  }

  // ---- 陡坡岩石 ----
  if (steepness > 0.1) {
    float steepBlend = 1.0 - steepness;
    vec4 rockTex = mix(
      texture2D(uPlRockTex, wUv),
      texture2D(uPlRockTex, wUv100),
      plSaturate((vPlViewDistance - 20.0) / 130.0)
    );
    rockTex.a = 0.25;
    texelColor.a = 0.2 + fade2 * 0.2;
    texelColor = plTerrainBlend(texelColor, steepBlend, rockTex, 1.0 - steepBlend, 0.08);
    texelColor.a = 1.0;
  }

  texelColor.r = plSaturate(texelColor.r);
  texelColor.g = plSaturate(texelColor.g);
  texelColor.b = plSaturate(texelColor.b);
  plSeasonalColor = texelColor.rgb;

  // lab 的纯色回归路径（地表贴图关闭）：不采样季节贴图，用调色板近似。
  // 岩石 / 碎石用 lab 常量色（0x6b6257 / 0x8a8378），路面带用当季 roadCol。
  if (uPlShowTextures < 0.5) {
    vec3 plFlatColor = mix(uPlGrassColA, uPlGrassColB, plSaturate(fade0 * (0.6 + vLightGrass)));
    plFlatColor *= 0.92 + 0.16 * fade1;
    if (uPlShowCanopy > 0.5 && treeMask > 0.05) {
      plFlatColor = mix(plFlatColor, uPlGrassColA * 0.35, clamp(treeMask * 1.2, 0.0, 1.0));
    }
    plFlatColor = mix(plFlatColor, vec3(0.4196, 0.3843, 0.3412), smoothstep(0.35, 0.72, steepness) * 0.6);
    if (plHasRoadProx > 0.5) {
      float plRoadWeight = 1.0 - smoothstep(-0.6, 0.6, plRoadProx);
      float plGravelWeight = (1.0 - smoothstep(0.0, 2.5, plRoadProx)) * (1.0 - plRoadWeight);
      plFlatColor = mix(plFlatColor, vec3(0.5412, 0.5137, 0.4706), plGravelWeight * 0.85);
      plFlatColor = mix(plFlatColor, uPlRoadCol * uPlRoadTint, plRoadWeight);
    }
    plSeasonalColor = plFlatColor;
  }

  #ifdef USE_MAP
    // blend 模式保留 GLB 航拍基色；replace 模式下由 uPlSurfaceStrength=1 整体覆盖。
    vec3 plBaseColor = texture2D(map, vMapUv).rgb;
    plSeasonalColor = mix(plSeasonalColor, plBaseColor, clamp(uPlBaseMapBlend, 0.0, 1.0));
  #endif

  diffuseColor.rgb = mix(diffuseColor.rgb, plSeasonalColor, clamp(uPlSurfaceStrength, 0.0, 1.0));
}`

/**
 * 官方地表掠射边缘光（mu chunk）：接近水平视线时提亮、背光侧 darkFresnel 压暗。
 * 必须放在 `normal_fragment_begin/maps` 之后（`normal` 在那里才声明），并在 lights
 * 之前改掉 emissive（官方：先 fresnel 再取「色 × radiance」；GLB 基色混合同样乘该系数）。
 */
const FRESNEL_BODY = `{
  float plFresnel = 1.0 - max(0.0, dot(normalize(cameraPosition - vPlWorldPosition), normal));
  float plLightFresnel = max(0.0, (plFresnel - 0.75)) * 4.0 * (1.0 - plFresnelBlendVal * 0.5);
  plLightFresnel *= plLightFresnel;
  plLightFresnel *= (1.0 - plShadowTerm);
  plLightFresnel *= uPlFresnelIntensity;
  float plDarkFresnel = 1.0 - min(1.0, plFresnel * 1.3333);
  plDarkFresnel *= uPlFresnelIntensity;
  plDarkFresnel = 0.25 + min(0.25, max(0.0, plDarkFresnel - 0.25) * 0.5);
  float plFresnelFactor = 1.0 + plLightFresnel - plDarkFresnel;
  diffuseColor.rgb *= plFresnelFactor;
  plSeasonalColor *= plFresnelFactor;
  // 官方地表自发光：季节色 × radiance（随后由官方合成补丁乘进直射项）。
  totalEmissiveRadiance = plSeasonalColor * uPlRadiance;
}`

type MaterialPatchRecord = {
  mesh: THREE.Mesh
  original: THREE.Material | THREE.Material[]
  replacement: THREE.Material | THREE.Material[]
  clones: THREE.Material[]
}

export interface ProceduralLandscapeSurfacePatch {
  patchedMaterialCount: number
  skippedMaterialCount: number
  hasInjection: boolean
  restore(): void
}

function installMaterialInjection(
  material: THREE.MeshLambertMaterial,
  uniforms: ProceduralLandscapeSurfaceUniforms,
): void {
  const originalOnBeforeCompile = material.onBeforeCompile
  const originalProgramCacheKey = material.customProgramCacheKey
  const uniformEntries = Object.entries(uniforms) as Array<[string, THREE.IUniform]>
  material.onBeforeCompile = (shader, renderer) => {
    for (const [name, uniform] of uniformEntries) {
      shader.uniforms[name] = uniform
    }
    // 纹理单元受限设备（小程序/集显 16 单元）自动走缩减路径：
    // 去掉 grassVariation/rockBump/detailNear 三个采样器。
    const reduced = (renderer?.capabilities?.maxTextures ?? 32) <= 16
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', reduced ? '#define PL_SURFACE_REDUCED\n' + VERTEX_HEADER : VERTEX_HEADER)
      .replace('#include <begin_vertex>', VERTEX_BODY)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', reduced ? '#define PL_SURFACE_REDUCED\n' + FRAGMENT_HEADER : FRAGMENT_HEADER)
      .replace('#include <normal_fragment_begin>', NORMAL_BODY)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRESNEL_BODY}`)
      .replace('#include <map_fragment>', FRAGMENT_BODY)
      // 官方环境光树影调制（与官方 lights_fragment_begin_shadow 变体等效，
      // 放在 lights_fragment_end 之后可保持 CSM 注入的 lights_fragment_begin 不变）。
      .replace(
        '#include <lights_fragment_end>',
        '#include <lights_fragment_end>\n\treflectedLight.indirectDiffuse *= plAmbientShadow;',
      )
      // 官方自发光合成：emissive 乘进直射项（`direct × (1 + emissive)`）。
      .replace(
        'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
        'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directDiffuse * totalEmissiveRadiance;',
      )
    injectSlowroadsFog(shader, { material })
    recordSlowroadsShaderAudit(material, shader)
    if (typeof originalOnBeforeCompile === 'function') {
      originalOnBeforeCompile.call(material, shader, renderer)
    }
  }
  material.customProgramCacheKey = () => {
    const baseKey = typeof originalProgramCacheKey === 'function' ? originalProgramCacheKey.call(material) : 'pl'
    return `${baseKey}|pl-seasonal-surface-v4`
  }
  material.needsUpdate = true
}

export function applyProceduralLandscapeSurfaceInjection(
  meshes: THREE.Mesh[],
  uniforms: ProceduralLandscapeSurfaceUniforms,
): ProceduralLandscapeSurfacePatch {
  const records: MaterialPatchRecord[] = []
  let patchedMaterialCount = 0
  let skippedMaterialCount = 0

  for (const mesh of meshes) {
    const original = mesh.material
    if (!original) {
      continue
    }
    const sources = Array.isArray(original) ? original : [original]
    const clones: THREE.Material[] = []
    for (const source of sources) {
      // 官方地表材质族是 Lambert（无镜面）；无论来源是 Standard 还是 unlit 的
      // MeshBasicMaterial（3D Tiles / KHR_materials_unlit），都重建为注入后的
      // MeshLambertMaterial，并继承原贴图/透明等渲染参数（供 blend 基色模式）。
      const carrier = source as THREE.Material & {
        map?: THREE.Texture | null
        color?: THREE.Color
        side?: THREE.Side
        alphaMap?: THREE.Texture | null
        transparent?: boolean
        alphaTest?: number
        opacity?: number
        vertexColors?: boolean
        depthWrite?: boolean
        depthTest?: boolean
      }
      const isRenderable = Boolean(carrier.map) || 'color' in source
      if (!isRenderable) {
        skippedMaterialCount += 1
        clones.push(source)
        continue
      }
      const clone = new THREE.MeshLambertMaterial({
        color: carrier.color ? carrier.color.clone() : new THREE.Color(0xffffff),
        map: carrier.map ?? null,
        alphaMap: carrier.alphaMap ?? null,
        side: carrier.side ?? THREE.FrontSide,
        transparent: carrier.transparent === true,
        alphaTest: typeof carrier.alphaTest === 'number' ? carrier.alphaTest : 0,
        opacity: typeof carrier.opacity === 'number' ? carrier.opacity : 1,
        vertexColors: carrier.vertexColors === true,
        depthWrite: carrier.depthWrite !== false,
        depthTest: carrier.depthTest !== false,
      })
      clone.name = source.name
      installMaterialInjection(clone, uniforms)
      clones.push(clone)
      patchedMaterialCount += 1
    }
    mesh.material = Array.isArray(original) ? clones : clones[0]!
    records.push({
      mesh,
      original,
      replacement: mesh.material,
      clones: Array.isArray(original) ? clones : [clones[0]!],
    })
  }

  return {
    patchedMaterialCount,
    skippedMaterialCount,
    hasInjection: patchedMaterialCount > 0,
    restore(): void {
      for (const record of records) {
        if (record.mesh.material === record.replacement) {
          record.mesh.material = record.original
        }
        for (const clone of record.clones) {
          const source = Array.isArray(record.original) ? record.original : [record.original]
          if (!source.includes(clone)) {
            clone.dispose()
          }
        }
      }
      records.length = 0
    },
  }
}
