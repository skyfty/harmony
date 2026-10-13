import * as THREE from 'three'
import { SEASON_PARAMS } from '../slowroads/core/seasonParams'
import type { SeasonId } from '../slowroads/core/seasonCatalog'
import type { SpriteRegion } from '../slowroads/core/spriteRegions'
import { injectSlowroadsFog } from '../slowroads/render/fogInjection'

/**
 * slowroads 风格精灵植被（交叉面片 + 每实例图集区域 + 季节调色板），
 * 注入 MeshStandardMaterial（保留真实光照/CSM 阴影），雾走共享三色雾。
 *
 * - 每实例属性：aPlUvRect（图集区域）、aPlSize（宽高比/相对高度）、aPlCell
 *   （变体格号，冬季裁剪）、aPlRoadProx（草丛贴近道路的明度抑制）；
 * - 距离分层（near/far/all；near 层在 3D 近树网格半径内折叠让位）；
 * - 草丛按官方公式乘当季调色板；灌木保留自身颜色 + 噪声斑驳；树卡/远景树
 *   做 leafEffect 变色与冬季阔叶积雪。
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
    nearDistance: { value: 120 },
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
uniform float uPlTime;
uniform vec3 uPlCameraPos;
uniform float uPlNearDistance;
uniform float uPlMeshRadius;
uniform float uPlTierMode;
uniform float uPlSinglePlane;
uniform float uPlWindStrength;
uniform int uPlSeasonIndex;
varying vec2 vPlUv;
varying float vPlFar;
varying float vPlTint;
varying float vPlCell;
varying vec3 vPlInstancePos;
varying float vPlRoadProx;
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
  vPlFar = plFar;
  float plCollapse = 0.0;
  if (uPlTierMode > 0.5) {
    plCollapse = plIsNear;
  } else if (uPlTierMode < -0.5) {
    plCollapse = plFar;
    plCollapse = max(plCollapse, plInsideMeshRadius);
  }
  float plPhase = fract(sin(dot(plInstWorld.xz, vec2(12.9898, 78.233))) * 43758.5453);
  vPlTint = 0.88 + 0.24 * fract(plPhase * 7.13);

  transformed.xz *= aPlSize.x;
  transformed.y *= aPlSize.y;

  // slowroads 变体裁剪：非冬季 0/1/3 号半高、2 号全高；冬季 2/3 号半高。
  float plCropY = 1.0 - 0.5 * step(0.5, abs(aPlCell - 2.0));
  if (uPlSeasonIndex == 3) {
    plCropY = step(1.5, aPlCell) * 0.5;
  }
  transformed.y *= plCropY;

  float plWind = uPlWindStrength * (1.0 - plFar) * transformed.y * transformed.y;
  transformed.x += sin(uPlTime * 1.7 + plPhase * 6.28318) * plWind;
  transformed.z += cos(uPlTime * 1.31 + plPhase * 5.17) * plWind * 0.6;
  if (plCollapse > 0.5) {
    transformed = vec3(0.0);
  }
  if (aPlPlane > 0.5 && (plFar > 0.5 || uPlSinglePlane > 0.5)) {
    transformed = vec3(0.0);
  }

  vPlUv = mix(aPlUvRect.xy, aPlUvRect.zw, uv);
  vPlCell = aPlCell;
  vPlRoadProx = aPlRoadProx;
  #ifdef USE_INSTANCING
    vPlInstancePos = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #else
    vPlInstancePos = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #endif
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
uniform float uPlTreeDiscolouration;
uniform float uPlHasSnow;
uniform float uPlSpecies;
varying vec2 vPlUv;
varying float vPlFar;
varying float vPlTint;
varying float vPlCell;
varying vec3 vPlInstancePos;
varying float vPlRoadProx;

float plScreen2(float a, float b) { return 1.0 - ((1.0 - a) * (1.0 - b)); }
`

const FRAGMENT_BODY = /* glsl */ `
{
  vec4 plTexel = texture2D(uPlAtlas, vPlUv);
  float plAlpha = mix(plTexel.a, texture2D(uPlAlphaTex, vPlUv).r, uPlHasAlphaTex);
  vec3 plColor = plTexel.rgb * uPlFoliageTint * vPlTint;

  if (uPlPaletteMode > 1.5) {
    // 灌木 / 花草：自身颜色 + 斑驳亮度（slowroads bush frag）。
    float plDapple = 1.0 + (texture2D(uPlNoiseMap, vPlInstancePos.xz / 256.0).r - 0.6);
    plColor = plTexel.rgb * plDapple * vPlTint;
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
      plColor = plTexel.rgb * plGrassCol * plDetailNoise;
    } else {
      // heather 草球：保留自身颜色 + 轻微斑驳亮度。
      if (plTexel.a < 0.98) discard;
      float plDapple = 1.0 + (texture2D(uPlNoiseMap, vPlInstancePos.xz / 10.0).r - 0.6);
      plColor = plTexel.rgb * plDapple;
    }
    plColor *= vPlTint;
  }

  // 树卡 / 远景树：leafEffect 变色 + 冬季阔叶积雪。
  if (uPlPaletteMode < 0.5) {
    float plLeafEffect = step(plColor.b * 1.5, plColor.g);
    plColor.rg *= 1.0 - (1.0 - uPlTreeDiscolouration) * plLeafEffect;
  }

  plColor *= mix(1.0, uPlFarTintScale, vPlFar);

  if (uPlHasSnow > 0.5 && uPlSpecies < 0.5) {
    float plSnowUp = 0.5;
    if (uPlHasNormalTex > 0.5) {
      vec3 plN = texture2D(uPlNormalTex, vPlUv).xyz * 2.0 - 1.0;
      plSnowUp = clamp(plN.y * 0.5 + 0.5, 0.0, 1.0);
    }
    plColor = mix(plColor, vec3(1.0), clamp(plSnowUp * 1.2, 0.0, 1.0) * 0.8);
  }

  diffuseColor = vec4(plColor, plAlpha);
}
`

export interface FoliageMaterialSpec {
  kind: 'grass' | 'bush' | 'tree'
  tier: 'near' | 'far' | 'all'
  species: 0 | 1
  singlePlane: boolean
  tint: number
  farTintScale: number
  hasAlphaTexture: boolean
  hasNormalTexture: boolean
  /** 材质缓存键（含图集身份/变体集，换季/换档位时生成新材质）。 */
  key: string
}

export interface FoliageMaterialSeasonState {
  season: SeasonId
  discolouration: number
  hasSnow: boolean
}

export interface FoliageMaterialHandle {
  material: THREE.MeshStandardMaterial
  uniforms: FoliageMaterialUniforms
  spec: FoliageMaterialSpec
}

export interface FoliageMaterialUniforms {
  uPlSeasonIndex: THREE.IUniform<number>
  uPlWindStrength: THREE.IUniform<number>
  uPlPaletteA: THREE.IUniform<THREE.Color>
  uPlPaletteB: THREE.IUniform<THREE.Color>
  uPlPeakA: THREE.IUniform<THREE.Color>
  uPlPeakB: THREE.IUniform<THREE.Color>
  uPlTreeDiscolouration: THREE.IUniform<number>
  uPlHasSnow: THREE.IUniform<number>
  uPlAtlas: THREE.IUniform<THREE.Texture | null>
  uPlAlphaTex: THREE.IUniform<THREE.Texture | null>
  uPlNormalTex: THREE.IUniform<THREE.Texture | null>
  uPlNoiseMap: THREE.IUniform<THREE.Texture | null>
  uPlGrassVariation: THREE.IUniform<THREE.Texture | null>
  uPlDetailFar: THREE.IUniform<THREE.Texture | null>
}

const TIER_MODE: Record<'near' | 'far' | 'all', number> = { near: -1, all: 0, far: 1 }
const PALETTE_MODE: Record<'grass' | 'bush' | 'tree', number> = { grass: 1, bush: 2, tree: 0 }

export function createFoliageMaterial(
  spec: FoliageMaterialSpec,
  shared: FoliageShaderUniforms,
  season: FoliageMaterialSeasonState,
): FoliageMaterialHandle {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  })
  material.name = `slowroads-foliage-${spec.kind}-${spec.tier}`
  const seasonUniforms: FoliageMaterialUniforms = {
    uPlSeasonIndex: { value: 0 },
    uPlWindStrength: { value: 0.1 },
    uPlPaletteA: { value: new THREE.Color('#ffffff') },
    uPlPaletteB: { value: new THREE.Color('#ffffff') },
    uPlPeakA: { value: new THREE.Color('#ffffff') },
    uPlPeakB: { value: new THREE.Color('#ffffff') },
    uPlTreeDiscolouration: { value: season.discolouration },
    uPlHasSnow: { value: 0 },
    uPlAtlas: { value: null },
    uPlAlphaTex: { value: null },
    uPlNormalTex: { value: null },
    uPlNoiseMap: { value: null },
    uPlGrassVariation: { value: null },
    uPlDetailFar: { value: null },
  }
  const uniforms: Record<string, THREE.IUniform> = {
    uPlTime: shared.time,
    uPlCameraPos: shared.cameraPosition,
    uPlNearDistance: shared.nearDistance,
    uPlMeshRadius: shared.meshRadius,
    ...seasonUniforms,
    uPlTierMode: { value: TIER_MODE[spec.tier] },
    uPlSinglePlane: { value: spec.singlePlane ? 1 : 0 },
    uPlHasAlphaTex: { value: spec.hasAlphaTexture ? 1 : 0 },
    uPlHasNormalTex: { value: spec.hasNormalTexture ? 1 : 0 },
    uPlPaletteMode: { value: PALETTE_MODE[spec.kind] },
    uPlFoliageTint: { value: new THREE.Color(spec.tint) },
    uPlFarTintScale: { value: spec.farTintScale },
    uPlSpecies: { value: spec.species },
  }
  material.customProgramCacheKey = () => `pl-foliage-v2-${spec.kind}-${spec.tier}-${spec.singlePlane ? 1 : 0}`
  material.onBeforeCompile = (shader) => {
    for (const [name, uniform] of Object.entries(uniforms)) {
      shader.uniforms[name] = uniform as THREE.IUniform
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', VERTEX_BODY)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <map_fragment>', FRAGMENT_BODY)
    injectSlowroadsFog(shader)
  }
  const handle: FoliageMaterialHandle = { material, uniforms: seasonUniforms, spec }
  applyFoliageMaterialSeason(handle, season)
  return handle
}

/** 换季：只更新调色板/变色/积雪 uniform，不重建材质。 */
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
  uniforms.uPlTreeDiscolouration.value = season.discolouration
  uniforms.uPlHasSnow.value = season.hasSnow && spec.kind === 'tree' && spec.species === 0 ? 1 : 0
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
  },
): void {
  handle.uniforms.uPlAtlas.value = textures.atlas
  handle.uniforms.uPlAlphaTex.value = textures.alpha ?? textures.atlas
  handle.uniforms.uPlNormalTex.value = textures.normal ?? textures.atlas
  handle.uniforms.uPlNoiseMap.value = textures.noise ?? textures.atlas
  handle.uniforms.uPlGrassVariation.value = textures.grassVariation ?? textures.atlas
  handle.uniforms.uPlDetailFar.value = textures.detailFar ?? textures.atlas
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
}

const matrixHelper = new THREE.Matrix4()
const positionHelper = new THREE.Vector3()
const quaternionHelper = new THREE.Quaternion()
const eulerHelper = new THREE.Euler()
const scaleHelper = new THREE.Vector3()

export function createFoliageLayerMesh(
  instances: ReadonlyArray<FoliageSpriteInstance>,
  material: THREE.MeshStandardMaterial,
  unitSize: number,
  hostInverse: THREE.Matrix4 | null,
): THREE.InstancedMesh {
  const count = instances.length
  const capacity = Math.max(1, count)
  const geometry = createCrossQuadGeometry()
  const uvRectAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
  const sizeAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2)
  const cellAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
  const roadProxAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
  geometry.setAttribute('aPlUvRect', uvRectAttribute)
  geometry.setAttribute('aPlSize', sizeAttribute)
  geometry.setAttribute('aPlCell', cellAttribute)
  geometry.setAttribute('aPlRoadProx', roadProxAttribute)

  const mesh = new THREE.InstancedMesh(geometry, material, capacity)
  mesh.name = 'slowroads-foliage-layer'
  mesh.count = count
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.frustumCulled = false

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
      continue
    }
    positionHelper.set(instance.x, instance.y, instance.z)
    eulerHelper.set(0, instance.rotation, 0)
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
  }
  mesh.instanceMatrix.needsUpdate = true
  uvRectAttribute.needsUpdate = true
  sizeAttribute.needsUpdate = true
  cellAttribute.needsUpdate = true
  roadProxAttribute.needsUpdate = true
  return mesh
}

export function disposeFoliageLayerMesh(mesh: THREE.InstancedMesh | null | undefined): void {
  if (!mesh) {
    return
  }
  mesh.removeFromParent()
  mesh.geometry.dispose()
  mesh.dispose()
}

