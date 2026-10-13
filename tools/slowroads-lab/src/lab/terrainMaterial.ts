import * as THREE from 'three'
import { fbm2 } from './noise'
import type { TreeDensityField } from './placement'

/**
 * slowroads-style terrain surface shading.
 *
 * 两条路径共用一套几何与光照：
 *  - `uUseTextures = 0`：原始纯色路径（草地亮暗噪声、树冠色斑、碎石路肩、沥青带），
 *    只依赖运行时生成的 fade 噪声图，用于回归对照；
 *  - `uUseTextures = 1`：slowroads 素材路径——草地纤维 + 变化图、林下腐叶、灌丛地被、
 *    碎石路肩、水线沙带、陡坡岩石（凹凸扰法线）、近/远细节与三级噪声打散。
 *
 * 采样器预算：本材质用到 16 个贴图单元（地表 13 + 运行时 fade/density + 1 张微噪声），
 * 正好压在 WebGL 常见的 16 上限；启动时会打印 `maxTextures`，若设备更低需要裁层。
 */
export interface TerrainTextureSet {
  grassFiber: THREE.Texture
  grassVariation: THREE.Texture
  forest: THREE.Texture
  heather: THREE.Texture
  gravel: THREE.Texture
  rock: THREE.Texture
  rockBump: THREE.Texture
  sand: THREE.Texture
  detailNear: THREE.Texture
  detailFar: THREE.Texture
  noiseFineA: THREE.Texture
  noiseFineB: THREE.Texture
  noiseFineC: THREE.Texture
  noiseFiner: THREE.Texture
}

export interface TerrainMaterialOptions {
  seed: number
  worldSize: number
  waterLevel: number
  density: TreeDensityField
  /** 为 null 时自动退回纯色路径。 */
  textures?: TerrainTextureSet | null
}

export interface TerrainToggles {
  surface: boolean
  road: boolean
  canopy: boolean
  textures: boolean
}

export interface TerrainMaterialHandle {
  material: THREE.ShaderMaterial
  setDensity(density: TreeDensityField): void
  setToggles(toggles: TerrainToggles): void
  dispose(): void
}

const DENSITY_TEXTURE_SIZE = 256
const FADE_TEXTURE_SIZE = 256

function createFadeTexture(seed: number): THREE.DataTexture {
  const size = FADE_TEXTURE_SIZE
  const data = new Uint8Array(size * size * 4)
  const fadeSeed = (seed ^ 0x2f6e2b1f) >>> 0
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = fbm2(fadeSeed, (x / size) * 8, (y / size) * 8, 4, 2.1, 0.55)
      const byte = Math.round(THREE.MathUtils.clamp(value, 0, 1) * 255)
      const index = (y * size + x) * 4
      data[index] = byte
      data[index + 1] = byte
      data[index + 2] = byte
      data[index + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

function fillDensityTexture(
  texture: THREE.DataTexture,
  density: TreeDensityField,
  worldSize: number,
): void {
  const size = DENSITY_TEXTURE_SIZE
  const data = texture.image.data as Uint8Array
  const half = worldSize * 0.5
  for (let y = 0; y < size; y += 1) {
    const z = -half + (y / (size - 1)) * worldSize
    for (let x = 0; x < size; x += 1) {
      const px = -half + (x / (size - 1)) * worldSize
      const byte = Math.round((density.classAt(px, z) / 3) * 255)
      const index = (y * size + x) * 4
      data[index] = byte
      data[index + 1] = byte
      data[index + 2] = byte
      data[index + 3] = 255
    }
  }
  texture.needsUpdate = true
}

const VERTEX_SHADER = `
attribute float aRoadProx;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vRoadProx;
varying float vViewDistance;
#include <fog_pars_vertex>
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vRoadProx = aRoadProx;
  vec4 mvPosition = viewMatrix * worldPosition;
  vViewDistance = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const FRAGMENT_SHADER = `
uniform sampler2D uFadeMap;
uniform sampler2D uDensityMap;
uniform sampler2D uGrassFiber;
uniform sampler2D uGrassVariation;
uniform sampler2D uForest;
uniform sampler2D uHeather;
uniform sampler2D uGravel;
uniform sampler2D uRock;
uniform sampler2D uRockBump;
uniform sampler2D uSand;
uniform sampler2D uDetailNear;
uniform sampler2D uDetailFar;
uniform sampler2D uNoiseFineA;
uniform sampler2D uNoiseFineB;
uniform sampler2D uNoiseFineC;
uniform sampler2D uNoiseFiner;
uniform float uUseTextures;
uniform float uWorldSize;
uniform float uWorldHalf;
uniform float uWaterLevel;
uniform vec3 uGrassColor;
uniform vec3 uGrassLightColor;
uniform vec3 uCanopyColor;
uniform vec3 uGravelColor;
uniform vec3 uRoadColor;
uniform vec3 uRockColor;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform float uShowSurface;
uniform float uShowRoad;
uniform float uShowCanopy;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vRoadProx;
varying float vViewDistance;
#include <fog_pars_fragment>

void main() {
  vec3 color = uGrassColor;
  vec3 surfaceNormal = normalize(vWorldNormal);
  if (uShowSurface > 0.5) {
    vec2 worldUv = vWorldPosition.xz;
    float heightVal = min(1.0, max(0.0, (vWorldPosition.y - uWaterLevel) / 100.0));
    float fade0 = texture2D(uFadeMap, worldUv / 800.0).r;
    float fade1 = texture2D(uFadeMap, worldUv / 6400.0).r;
    fade0 = min(max(0.0, (fade0 - 0.25) * 2.0), 1.0);
    fade1 = min(max(0.0, (fade1 - 0.25) * 2.0), 1.0);
    float lightGrass = min(1.0, max(0.0, fade1 * heightVal * (fade0 + heightVal)));
    float mottle = texture2D(uFadeMap, worldUv / 170.0).r;
    color = mix(uGrassColor, uGrassLightColor, clamp(lightGrass + (mottle - 0.5) * 0.45, 0.0, 1.0));
    color *= 0.92 + 0.16 * mottle;

    float treeMask = 0.0;
    if (uShowCanopy > 0.5) {
      treeMask = clamp(texture2D(uDensityMap, (worldUv + vec2(uWorldHalf)) / uWorldSize).r * 1.15, 0.0, 1.0);
      treeMask *= 1.0 - smoothstep(2.0, 9.0, vRoadProx);
    }

    float slope = clamp(1.0 - dot(surfaceNormal, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
    float rockWeight = smoothstep(0.35, 0.72, slope) * 0.6;

    if (uUseTextures > 0.5) {
      // ---- 草地：tint × 纤维亮度 × 大尺度变化 -------------------------------------
      float fiber = texture2D(uGrassFiber, worldUv / 6.0).r;
      float variation = texture2D(uGrassVariation, worldUv / 220.0).r;
      vec3 grass = mix(uGrassColor, uGrassLightColor, clamp((variation - 0.35) * 1.35, 0.0, 1.0));
      grass *= 0.84 + 0.32 * fiber;
      float micro = texture2D(uNoiseFiner, worldUv / 3.5).r;
      grass *= 0.95 + 0.10 * micro;
      color = grass;

      // ---- 三级噪声打散平铺重复 ---------------------------------------------------
      float breakUp = (texture2D(uNoiseFineA, worldUv / 47.0).r - 0.5) * 0.14
        + (texture2D(uNoiseFineB, worldUv / 13.0).r - 0.5) * 0.10
        + (texture2D(uNoiseFineC, worldUv / 3.1).r - 0.5) * 0.06;
      float breakUpFade = 1.0 - smoothstep(150.0, 320.0, vViewDistance);
      color *= 1.0 + breakUp * breakUpFade;

      // ---- 灌丛地被补丁（中尺度噪声，避开路面与树冠核心） --------------------------
      float heatherNoise = texture2D(uNoiseFineA, worldUv / 61.0).r;
      float heatherMask = smoothstep(0.58, 0.86, heatherNoise)
        * (1.0 - treeMask * 0.9)
        * (1.0 - rockWeight)
        * smoothstep(1.5, 8.0, vRoadProx);
      color = mix(color, texture2D(uHeather, worldUv / 12.0).rgb, heatherMask * 0.45);

      // ---- 林下腐叶：与树木密度同源 -------------------------------------------------
      if (uShowCanopy > 0.5) {
        float forestMask = clamp(treeMask * 1.1, 0.0, 1.0);
        color = mix(color, texture2D(uForest, worldUv / 9.0).rgb, forestMask * 0.85);
      }

      // ---- 水线沙带 ---------------------------------------------------------------
      float sandWeight = 1.0 - smoothstep(0.0, 2.2, vWorldPosition.y - uWaterLevel);
      color = mix(color, texture2D(uSand, worldUv / 8.0).rgb, sandWeight * 0.85);

      // ---- 陡坡岩石：贴图 + 凹凸扰法线 ---------------------------------------------
      float bumpCenter = texture2D(uRockBump, worldUv / 9.0).r;
      float bumpX = texture2D(uRockBump, (worldUv + vec2(0.4, 0.0)) / 9.0).r - bumpCenter;
      float bumpZ = texture2D(uRockBump, (worldUv + vec2(0.0, 0.4)) / 9.0).r - bumpCenter;
      surfaceNormal = normalize(surfaceNormal + vec3(-bumpX, 0.0, -bumpZ) * 2.4 * rockWeight);
      vec3 rock = texture2D(uRock, worldUv / 9.0).rgb * (0.82 + 0.36 * bumpCenter);
      color = mix(color, rock, rockWeight);

      // ---- 细节叠加：近处细颗粒 / 中远距离斑驳 -------------------------------------
      float nearDetail = (1.0 - smoothstep(6.0, 40.0, vViewDistance)) * 0.55;
      float farDetail = smoothstep(15.0, 50.0, vViewDistance) * (1.0 - smoothstep(260.0, 420.0, vViewDistance)) * 0.45;
      float detail = (texture2D(uDetailNear, worldUv / 1.2).r - 0.5) * nearDetail
        + (texture2D(uDetailFar, worldUv / 30.0).r - 0.5) * farDetail;
      color *= 1.0 + detail;
    } else {
      color = mix(color, uRockColor, rockWeight);
    }

    if (uShowRoad > 0.5) {
      float roadWeight = 1.0 - smoothstep(-0.6, 0.6, vRoadProx);
      float gravelWeight = (1.0 - smoothstep(0.0, 2.5, vRoadProx)) * (1.0 - roadWeight);
      if (uUseTextures > 0.5) {
        vec3 gravel = texture2D(uGravel, worldUv / 5.0).rgb * (0.9 + 0.2 * texture2D(uNoiseFineC, worldUv / 2.2).r);
        color = mix(color, gravel, gravelWeight * 0.9);
      } else {
        color = mix(color, uGravelColor, gravelWeight * 0.85);
      }
      float roadNoise = texture2D(uFadeMap, worldUv / 60.0).r;
      vec3 roadColor = uRoadColor * (0.94 + roadNoise * 0.12);
      if (uUseTextures > 0.5) {
        roadColor *= 0.92 + 0.16 * texture2D(uNoiseFiner, worldUv / 2.4).r;
      }
      color = mix(color, roadColor, roadWeight);
    }
  }

  float ndl = clamp(dot(surfaceNormal, uSunDir), -1.0, 1.0) * 0.5 + 0.5;
  color *= uAmbient + uSunColor * ndl;

  gl_FragColor = vec4(color, 1.0);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`

export function createTerrainMaterial(options: TerrainMaterialOptions): TerrainMaterialHandle {
  const fadeTexture = createFadeTexture(options.seed)
  const densityTexture = new THREE.DataTexture(
    new Uint8Array(DENSITY_TEXTURE_SIZE * DENSITY_TEXTURE_SIZE * 4),
    DENSITY_TEXTURE_SIZE,
    DENSITY_TEXTURE_SIZE,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  densityTexture.minFilter = THREE.LinearFilter
  densityTexture.magFilter = THREE.LinearFilter
  densityTexture.wrapS = THREE.ClampToEdgeWrapping
  densityTexture.wrapT = THREE.ClampToEdgeWrapping
  densityTexture.generateMipmaps = false
  fillDensityTexture(densityTexture, options.density, options.worldSize)

  const textures = options.textures ?? null
  const fallback = fadeTexture
  const pick = (texture: THREE.Texture | undefined): THREE.Texture => texture ?? fallback

  const uniforms: Record<string, THREE.IUniform> = {
    // A raw ShaderMaterial has to carry the fog uniforms itself; three's
    // refreshFogUniforms writes into fogColor/fogDensity whenever fog is on.
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uFadeMap: { value: fadeTexture },
    uDensityMap: { value: densityTexture },
    uGrassFiber: { value: pick(textures?.grassFiber) },
    uGrassVariation: { value: pick(textures?.grassVariation) },
    uForest: { value: pick(textures?.forest) },
    uHeather: { value: pick(textures?.heather) },
    uGravel: { value: pick(textures?.gravel) },
    uRock: { value: pick(textures?.rock) },
    uRockBump: { value: pick(textures?.rockBump) },
    uSand: { value: pick(textures?.sand) },
    uDetailNear: { value: pick(textures?.detailNear) },
    uDetailFar: { value: pick(textures?.detailFar) },
    uNoiseFineA: { value: pick(textures?.noiseFineA) },
    uNoiseFineB: { value: pick(textures?.noiseFineB) },
    uNoiseFineC: { value: pick(textures?.noiseFineC) },
    uNoiseFiner: { value: pick(textures?.noiseFiner) },
    uUseTextures: { value: textures ? 1 : 0 },
    uWorldSize: { value: options.worldSize },
    uWorldHalf: { value: options.worldSize * 0.5 },
    uWaterLevel: { value: options.waterLevel },
    uGrassColor: { value: new THREE.Color(0x6f8f42) },
    uGrassLightColor: { value: new THREE.Color(0x9db867) },
    uCanopyColor: { value: new THREE.Color(0x2f4a26) },
    uGravelColor: { value: new THREE.Color(0x8a8378) },
    uRoadColor: { value: new THREE.Color(0x737379) },
    uRockColor: { value: new THREE.Color(0x6b6257) },
    uSunDir: { value: new THREE.Vector3(0.42, 0.72, 0.28).normalize() },
    uSunColor: { value: new THREE.Color(0.62, 0.6, 0.56) },
    uAmbient: { value: new THREE.Color(0.55, 0.58, 0.62) },
    uShowSurface: { value: 1 },
    uShowRoad: { value: 1 },
    uShowCanopy: { value: 1 },
  }

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    fog: true,
  })

  return {
    material,
    setDensity(density: TreeDensityField): void {
      fillDensityTexture(densityTexture, density, options.worldSize)
    },
    setToggles(toggles: TerrainToggles): void {
      uniforms.uShowSurface!.value = toggles.surface ? 1 : 0
      uniforms.uShowRoad!.value = toggles.road ? 1 : 0
      uniforms.uShowCanopy!.value = toggles.canopy ? 1 : 0
      uniforms.uUseTextures!.value = textures && toggles.textures ? 1 : 0
    },
    dispose(): void {
      fadeTexture.dispose()
      densityTexture.dispose()
      material.dispose()
    },
  }
}
