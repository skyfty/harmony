import * as THREE from 'three'
import { SEASON_PARAMS, type SeasonParams } from '../core/seasonParams'
import type { SeasonId } from '../core/seasonCatalog'
import type { TreeDensityField } from '../core/placement'
import { fbm2 } from '../core/noise'

/**
 * slowroads 地表着色（按官方片元栈移植，季节由 uniform 驱动）。
 *
 * 片元顺序与 slowroads 一致：草色混合（grassColA/B × peakColA/B，由
 * noise_fine.592be1a0 的 fade 场驱动 light/dark grass 与 grassBlend）→
 * heather 混合 → 细节贴图（detailFar 远/近混合，冬季 ×0.7）→ 树冠林下
 * forest 混合 → 沙带（seasonIndex<3）→ 路肩碎石（<3；秋季树下提亮 1.8、
 * 夏季近处直接铺 roadCol）→ 陡坡岩石（rock + rockBump 凹凸扰法线）。
 *
 * 采样器预算：完整路径 12 个（fade/density + 10 层地表）；兼容模式
 * （`TERRAIN_REDUCED` define）去掉 grassVariation/rockBump/detailNear，
 * 落到 9 个，对应微信小程序低端机的纹理单元上限。
 */
export interface TerrainTextureSet {
  grass: THREE.Texture
  forest: THREE.Texture
  heather: THREE.Texture
  gravel: THREE.Texture
  rock: THREE.Texture
  sand: THREE.Texture
  detailNear: THREE.Texture
  detailFar: THREE.Texture
  rockBump: THREE.Texture
  grassVariation: THREE.Texture
  fadeNoise: THREE.Texture
}

export interface TerrainMaterialOptions {
  seed: number
  worldSize: number
  waterLevel: number
  density: TreeDensityField
  textures: TerrainTextureSet
  season: SeasonId
  /** 兼容模式：缩减采样器与细节层，供小程序低配验证。 */
  reduced?: boolean
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
  setSeason(season: SeasonId, textures: TerrainTextureSet): void
  dispose(): void
}

const DENSITY_TEXTURE_SIZE = 256

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

/** 供回归对照的纯色 fade 图（不依赖外部素材的兜底）。 */
function createFallbackFadeTexture(seed: number): THREE.DataTexture {
  const size = 128
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
uniform sampler2D uFadeNoise;
uniform sampler2D uDensityMap;
uniform sampler2D uGrassFiber;
uniform sampler2D uForest;
uniform sampler2D uHeather;
uniform sampler2D uGravel;
uniform sampler2D uRock;
uniform sampler2D uSand;
#ifndef TERRAIN_REDUCED
uniform sampler2D uRockBump;
uniform sampler2D uDetailNear;
uniform sampler2D uGrassVariation;
#endif
uniform sampler2D uDetailFar;
uniform float uUseTextures;
uniform float uWorldSize;
uniform float uWorldHalf;
uniform float uWaterLevel;
uniform int uSeasonIndex;
uniform vec3 uGrassColA;
uniform vec3 uGrassColB;
uniform vec3 uPeakColA;
uniform vec3 uPeakColB;
uniform vec3 uRoadCol;
uniform vec3 uGravelColor;
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

float saturate1(float value) { return clamp(value, 0.0, 1.0); }
float screen(float a, float b) { return 1.0 - ((1.0 - a) * (1.0 - b)); }

vec4 terrainBlend(vec4 tx1, float w1, vec4 tx2, float w2, float depth) {
  float ma = max(tx1.a + w1, tx2.a + w2) - depth;
  float b1 = max(tx1.a + w1 - ma, 0.0);
  float b2 = max(tx2.a + w2 - ma, 0.0);
  return ((tx1 * b1) + (tx2 * b2)) / (b1 + b2);
}

void main() {
  vec3 surfaceNormal = normalize(vWorldNormal);
  vec3 color = uGrassColA;
  if (uShowSurface > 0.5) {
    vec2 wUv = vWorldPosition.xz / 10.0;
    vec2 wUv100 = wUv / 10.0;
    vec2 wUv500 = vWorldPosition.xz / 500.0;
    vec2 wUv2000 = vWorldPosition.xz / 2000.0;
    vec2 wUv4000 = vWorldPosition.xz / 4000.0;

    float fade0 = texture2D(uFadeNoise, wUv).r;
    float fade1 = texture2D(uFadeNoise, wUv100).r;
    float fade2 = texture2D(uFadeNoise, wUv500).r;
    float vFade0 = fade2;
    float vFade1 = texture2D(uFadeNoise, wUv4000).r;

    // slowroads 的海拔公式按 0..300m 量级调过参；lab 世界只有 ±40m，
    // 先把“水面以上的高度”按 x4 折算回官方尺度，再走原公式。
    float heightRel = vWorldPosition.y - uWaterLevel;
    float height = heightRel * 4.0;
    float roadProx = vRoadProx;
    float hasRoadProx = step(0.00001, abs(roadProx));

    // ---- vertex-equivalent fields (slowroads ground vert) --------------------
    float vHeather = smoothstep(0.4, 1.0, ((height + vFade1 * 350.0) - 60.0) / 500.0);
    vHeather *= screen(vFade1, vFade0);
    vHeather = smoothstep(0.3, 0.6, vHeather);

    float heightVal = min(1.0, max(0.0, (height - (30.0 + vFade1 * 40.0)) / 150.0));
    float vLightGrass = min(1.0, heightVal * (vFade0 + heightVal * 0.5));

    if (roadProx > 0.0 && roadProx < 0.5 + vFade0) {
      vHeather *= roadProx / (0.5 + vFade0);
      if (uSeasonIndex < 3) {
        vLightGrass *= roadProx / (0.5 + vFade0);
      }
    }

    float vDarkGrass = min(max(0.0, (vFade1 - 0.25) * 2.0), 1.0);

    float steepness = clamp((0.98 - dot(surfaceNormal, vec3(0.0, 1.0, 0.0))) * 1.4, 0.0, 1.0);
    float underRoadFactor = 1.0 - step(0.000001, -roadProx);
    steepness *= underRoadFactor;
    vHeather *= underRoadFactor;

    float treeMask = 0.0;
    if (uShowCanopy > 0.5) {
      treeMask = clamp(texture2D(uDensityMap, (vWorldPosition.xz + uWorldHalf) / uWorldSize).r * 1.15, 0.0, 1.0);
    }
    float vShadow = min(1.0, treeMask * min(1.0, max(0.0, heightRel / 4.0)));
    float vTreeMask = vShadow;
    if (vTreeMask > 0.1) {
      vTreeMask = max(0.2, vTreeMask);
    } else {
      vTreeMask = 0.0;
    }
    if (hasRoadProx > 0.5) {
      vTreeMask *= clamp(roadProx / 2.0, 0.0, 1.0);
    }

    if (uUseTextures > 0.5) {
      // ---- 草地：调色板混合（slowroads ground frag） -------------------------
      vec4 texelColor = texture2D(uGrassFiber, wUv);

      float blendVal = 1.0 - texture2D(uDetailFar, wUv4000).r;
      float blendValB = 1.0 - texture2D(uDetailFar, wUv500).r;
      float blendValC = 1.0 - texture2D(uDetailFar, wUv100).r;
      blendValB = screen(blendValC, blendValB);
      blendValB *= min(1.0, blendVal * 10.0);
      if (uSeasonIndex == 3) {
        blendValB *= 0.7;
      }
      blendVal *= (0.6 + 0.4 * vLightGrass);
      blendVal *= 2.0;
      float depthLerpFar = saturate1(vViewDistance / 800.0);
      blendVal = blendVal * depthLerpFar + (1.0 - depthLerpFar) * blendValB;
      blendVal *= saturate1(0.4 + 0.6 * (vViewDistance / 300.0));
#ifndef TERRAIN_REDUCED
      blendVal += (1.0 - texture2D(uDetailNear, wUv100).r) * (0.7 + vLightGrass * 0.3);
#endif

      float variationVal = 0.0;
      float closeVariation = 0.0;
#ifndef TERRAIN_REDUCED
      variationVal = texture2D(uGrassVariation, wUv2000).r - 0.5;
      closeVariation = ((1.0 - texture2D(uGrassVariation, wUv500).r) - 0.5);
#else
      variationVal = (fade1 - 0.5) * 0.5;
      closeVariation = (fade0 - 0.5) * 0.5;
#endif
      float grassBlend = (screen(fade1, fade0) + vDarkGrass) / 2.0;
      grassBlend = grassBlend * grassBlend;
      grassBlend = saturate1(grassBlend + variationVal + closeVariation);
      float lightGrassFactor = saturate1(vLightGrass + variationVal - closeVariation);
      lightGrassFactor = saturate1(lightGrassFactor * 2.0 * texelColor.r);
      vec3 grassCol = mix(
        mix(uGrassColA, uGrassColB, grassBlend),
        mix(uPeakColA, uPeakColB, grassBlend),
        lightGrassFactor
      );
      texelColor.rgb *= grassCol;

      // ---- heather 混合 ------------------------------------------------------
      if (vHeather > 0.0) {
        vec4 heatherCol = texture2D(uHeather, wUv);
        float depthLerp = 0.25 + 0.75 * min(1.0, vViewDistance / 400.0);
        heatherCol = mix(heatherCol, texture2D(uHeather, wUv500), depthLerp);
        heatherCol = mix(texelColor, heatherCol, min(1.0, vHeather));
        heatherCol.a = heatherCol.r;
        texelColor.a = texelColor.g;
        texelColor = terrainBlend(texelColor, 1.0 - vHeather, heatherCol, vHeather, 0.1);
      }

      // ---- 细节叠加 ----------------------------------------------------------
      texelColor *= 1.0 - blendVal;

      // ---- 树冠林下 ----------------------------------------------------------
      vec4 forestCol = texture2D(uForest, wUv);
      forestCol.a = forestCol.r * 2.0 * fade2;
      float fTreeMask = min(1.0, vTreeMask);
      if (fTreeMask > 0.0) {
        texelColor = terrainBlend(
          texelColor,
          1.0 - fTreeMask,
          forestCol,
          fTreeMask,
          0.1 + (1.0 - fTreeMask) * fade0 * 0.9
        );
        texelColor.a = 1.0;
      }

      // ---- 水线沙带（冬季不做） ----------------------------------------------
      // 沙带仍按“水面以上真实米数”（官方就是这么量的），不要乘 4。
      float vHeight = heightRel + min(1.0, heightRel + 0.5) * (fade2 * 2.0 + (fade0 + fade2) * 0.5);
      if (vHeight < 4.0 && uSeasonIndex < 3) {
        float dark = 1.0;
        if (vHeight < 0.0) {
          texelColor = texture2D(uSand, wUv) * 0.75;
        } else {
          if (vHeight < 2.0) {
            dark = min(dark, 1.0 - (2.0 - vHeight) / 4.0);
          } else if (vHeight > 2.5) {
            dark = 1.0 - (vHeight - 2.5) / 2.0;
          }
          float lerpVal = max(0.0, (vHeight - 1.0) / 3.0);
          vec4 sandCol = texture2D(uSand, wUv);
          texelColor.a = texelColor.r;
          sandCol.a = sandCol.r;
          sandCol.rgb *= dark;
          texelColor = terrainBlend(texelColor, lerpVal, sandCol, 1.0 - lerpVal, 0.05);
        }
      }

      // ---- 路肩碎石（冬季不做；秋季树下提亮；夏季近处直接铺路面色） ----------
      if (uShowRoad > 0.5 && uSeasonIndex < 3 && hasRoadProx > 0.5) {
        if (roadProx < -0.2 && (vViewDistance > 100.0 || uSeasonIndex == 1)) {
          texelColor.rgb = uRoadCol;
        } else if (roadProx + fade2 * 0.1 < 0.5 * fade0) {
          float rp = saturate1(1.0 - (roadProx + fade2 * 0.1) / (0.5 * fade0));
          if (uSeasonIndex != 1 && vShadow > 0.0) {
            float gravelBrightness = uSeasonIndex == 2 ? 1.8 : 1.3;
            texelColor = mix(
              mix(texture2D(uGravel, wUv * 2.0), forestCol * gravelBrightness, min(1.0, vShadow * 2.0)),
              texelColor,
              smoothstep(0.0, rp, texelColor.g / rp)
            );
          } else {
            texelColor = mix(
              texture2D(uGravel, wUv * 2.0) * (0.75 + rp * rp * 0.75),
              texelColor,
              smoothstep(0.0, rp, texelColor.g / rp)
            );
          }
        }
      }

      // ---- 陡坡岩石 ----------------------------------------------------------
      if (steepness > 0.1) {
#ifndef TERRAIN_REDUCED
        float bumpCenter = texture2D(uRockBump, wUv).r;
        float bumpX = texture2D(uRockBump, wUv + vec2(0.04, 0.0)).r - bumpCenter;
        float bumpZ = texture2D(uRockBump, wUv + vec2(0.0, 0.04)).r - bumpCenter;
        surfaceNormal = normalize(surfaceNormal + vec3(-bumpX, 0.0, -bumpZ) * 2.4 * steepness);
#endif
        float steepBlend = 1.0 - steepness;
        vec4 rockTex = mix(
          texture2D(uRock, wUv),
          texture2D(uRock, wUv100),
          saturate1((vViewDistance - 20.0) / 130.0)
        );
        rockTex.a = 0.25;
        texelColor.a = 0.2 + fade2 * 0.2;
        texelColor = terrainBlend(texelColor, steepBlend, rockTex, 1.0 - steepBlend, 0.08);
        texelColor.a = 1.0;
      }

      texelColor.r = saturate1(texelColor.r);
      texelColor.g = saturate1(texelColor.g);
      texelColor.b = saturate1(texelColor.b);
      color = texelColor.rgb;
    } else {
      // 纯色回归路径（不采样外部贴图）。
      float mottle = fade1;
      color = mix(uGrassColA, uGrassColB, saturate1(fade0 * (0.6 + vLightGrass)));
      color *= 0.92 + 0.16 * mottle;
      if (uShowCanopy > 0.5 && treeMask > 0.05) {
        color = mix(color, uGrassColA * 0.35, clamp(treeMask * 1.2, 0.0, 1.0));
      }
      color = mix(color, uRockColor, smoothstep(0.35, 0.72, steepness) * 0.6);
      if (uShowRoad > 0.5) {
        float roadWeight = 1.0 - smoothstep(-0.6, 0.6, roadProx);
        float gravelWeight = (1.0 - smoothstep(0.0, 2.5, roadProx)) * (1.0 - roadWeight);
        color = mix(color, uGravelColor, gravelWeight * 0.85);
        color = mix(color, uRoadCol, roadWeight);
      }
    }
  }

  float ndl = clamp(dot(surfaceNormal, uSunDir), -1.0, 1.0) * 0.5 + 0.5;
  color *= uAmbient + uSunColor * ndl;

  gl_FragColor = vec4(color, 1.0);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`

function setPaletteUniforms(uniforms: Record<string, THREE.IUniform>, params: SeasonParams): void {
  ;(uniforms.uGrassColA!.value as THREE.Color).set(params.grassColA)
  ;(uniforms.uGrassColB!.value as THREE.Color).set(params.grassColB)
  ;(uniforms.uPeakColA!.value as THREE.Color).set(params.peakColA)
  ;(uniforms.uPeakColB!.value as THREE.Color).set(params.peakColB)
  ;(uniforms.uRoadCol!.value as THREE.Color).set(params.roadCol)
  uniforms.uSeasonIndex!.value = params.index
}

function setTextureUniforms(uniforms: Record<string, THREE.IUniform>, textures: TerrainTextureSet): void {
  uniforms.uFadeNoise!.value = textures.fadeNoise
  uniforms.uGrassFiber!.value = textures.grass
  uniforms.uForest!.value = textures.forest
  uniforms.uHeather!.value = textures.heather
  uniforms.uGravel!.value = textures.gravel
  uniforms.uRock!.value = textures.rock
  uniforms.uSand!.value = textures.sand
  uniforms.uDetailFar!.value = textures.detailFar
  uniforms.uRockBump && (uniforms.uRockBump.value = textures.rockBump)
  uniforms.uDetailNear && (uniforms.uDetailNear.value = textures.detailNear)
  uniforms.uGrassVariation && (uniforms.uGrassVariation.value = textures.grassVariation)
}

export function createTerrainMaterial(options: TerrainMaterialOptions): TerrainMaterialHandle {
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

  // Reduced mode must not sample the optional maps at all; point them at any
  // texture so the raw ShaderMaterial has valid samplers.
  const fallback = createFallbackFadeTexture(options.seed)
  const uniforms: Record<string, THREE.IUniform> = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uFadeNoise: { value: options.textures.fadeNoise },
    uDensityMap: { value: densityTexture },
    uGrassFiber: { value: options.textures.grass },
    uForest: { value: options.textures.forest },
    uHeather: { value: options.textures.heather },
    uGravel: { value: options.textures.gravel },
    uRock: { value: options.textures.rock },
    uSand: { value: options.textures.sand },
    uDetailFar: { value: options.textures.detailFar },
    uUseTextures: { value: 1 },
    uWorldSize: { value: options.worldSize },
    uWorldHalf: { value: options.worldSize * 0.5 },
    uWaterLevel: { value: options.waterLevel },
    uSeasonIndex: { value: 0 },
    uGrassColA: { value: new THREE.Color() },
    uGrassColB: { value: new THREE.Color() },
    uPeakColA: { value: new THREE.Color() },
    uPeakColB: { value: new THREE.Color() },
    uRoadCol: { value: new THREE.Color() },
    uGravelColor: { value: new THREE.Color(0x8a8378) },
    uRockColor: { value: new THREE.Color(0x6b6257) },
    uSunDir: { value: new THREE.Vector3(0.42, 0.72, 0.28).normalize() },
    uSunColor: { value: new THREE.Color(0.62, 0.6, 0.56) },
    uAmbient: { value: new THREE.Color(0.55, 0.58, 0.62) },
    uShowSurface: { value: 1 },
    uShowRoad: { value: 1 },
    uShowCanopy: { value: 1 },
  }
  if (!options.reduced) {
    uniforms.uRockBump = { value: options.textures.rockBump }
    uniforms.uDetailNear = { value: options.textures.detailNear }
    uniforms.uGrassVariation = { value: options.textures.grassVariation }
  } else {
    // Unused in the reduced shader but kept so setTextureUniforms stays simple.
    uniforms.uRockBump = { value: fallback }
    uniforms.uDetailNear = { value: fallback }
    uniforms.uGrassVariation = { value: fallback }
  }
  setPaletteUniforms(uniforms, SEASON_PARAMS[options.season])

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    defines: options.reduced ? { TERRAIN_REDUCED: 1 } : {},
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
      uniforms.uUseTextures!.value = toggles.textures ? 1 : 0
    },
    setSeason(season: SeasonId, textures: TerrainTextureSet): void {
      setPaletteUniforms(uniforms, SEASON_PARAMS[season])
      setTextureUniforms(uniforms, textures)
    },
    dispose(): void {
      densityTexture.dispose()
      fallback.dispose()
      material.dispose()
    },
  }
}
